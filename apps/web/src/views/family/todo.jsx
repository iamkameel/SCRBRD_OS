/**
 * "To do for Rohan" (GA-I20 phases A0 and A1, docs/design/GA-I20_parent_action_list.md
 * §2, §3.1, §5, §6): the second card on a parent's Home, under the next
 * fixture, for the child that is chosen and nobody else; "What you have
 * agreed" beside it; the count each child's card on Family carries; and the
 * pupil's own list (`self`, D12).
 *
 * THE READS, every one the family app already makes or a count that names
 * nobody (§5.1, D8):
 *   the fixture list (the Home's own) and, for each of his side's fixtures
 *   still to come, the answers (`availability`) and the lifts
 *   (`/api/matches/:id/lifts`, only where the lift module is on); the day's
 *   lift cards on the day (shared with the Home's day cards, read once);
 *   the requests on her own lifts as counts (`/api/lifts/requests-mine`, N3);
 *   the consents (`consents`); her own public-name answer, with its version
 *   and time (N5); and how many numbers are on record to ring
 *   (`emergency_contact_count`, N2) — never the numbers themselves, so a
 *   glance at Home is not a logged disclosure.
 * Nothing is written. The rules are lib/todo.js's; this draws what they say
 * and opens the one door each row has.
 *
 * It is made again every time the Home is opened (the Home's body is rebuilt
 * on the way back from a fixture), so a row goes when its record changes, on
 * this phone or any other, and nothing is kept on the device.
 */
import { useEffect, useState } from "react";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { readLive } from "../../lib/live.js";
import { useFeatures } from "../../lib/features.js";
import { OFF, fixturesToRead, recordOf, todoOf } from "../../lib/todo.js";
import { Action, Card, Line, OpenRow } from "./parts.jsx";

/**
 * One read per fixture, each kept as it arrives: `undefined` until it has
 * answered, `null` if it failed, the rows otherwise. `again` re-reads them
 * all. `get(id)` makes the read; a refusal it turns into OFF (a module
 * switched off) is the whole source's, so the rest are not asked.
 * @param {string[]} ids  @param {number} again  @param {(id: string) => Promise<any>} get
 */
function usePerFixture(ids, again, get) {
  const key = ids.join(",");
  const [state, setState] = useState({ key: "", got: /** @type {Record<string, any>} */ ({}) });
  useEffect(() => {
    if (!signedIn() || !key) return undefined;
    let cancelled = false;
    setState({ key, got: {} });
    for (const id of key.split(",")) {
      get(id).then((v) => {
        if (!cancelled) setState((s) => (s.key === key ? { key, got: { ...s.got, [id]: v } } : s));
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the list's identity; `get` is a module-level function
  }, [key, again]);
  return state.key === key ? state.got : {};
}

/** One read for the whole list: `undefined` while out, then what `get` said. Null `what` skips it (OFF). */
function useOnce(what, again, get) {
  const [state, setState] = useState({ what: "", again: -1, got: /** @type {any} */ (undefined) });
  useEffect(() => {
    if (!signedIn() || !what) return undefined;
    let cancelled = false;
    setState({ what, again, got: undefined });
    get().then((v) => { if (!cancelled) setState({ what, again, got: v }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `what` names the read; `get` closes over it
  }, [what, again]);
  if (!what) return OFF;
  return state.what === what && state.again === again ? state.got : undefined;
}

const answersOf = (/** @type {string} */ id) => readLive("availability", { matchId: id });
/** A lift read: its rows; OFF when the school's lift module is off; null on any other failure. */
const liftsOf = (/** @type {string} */ id) => api(`/api/matches/${id}/lifts`)
  .then((r) => r.rows ?? []).catch((e) => (e?.code === "module_disabled" ? OFF : null));
const requestsOf = () => api("/api/lifts/requests-mine")
  .then((r) => r.rows ?? []).catch((e) => (e?.code === "module_disabled" ? OFF : null));

/**
 * Every read the list makes for one child, and what the rules say of them.
 * `self` is the pupil's own list: his answers and his own consent row only.
 * `day` is the Home's day reads (lifts.jsx useLiftDay), or null where the day
 * does not apply.
 * @param {{child: any, matches: any[], matchesRead: {loading: boolean, error: any}, now: number,
 *          self?: boolean, day?: Record<string, any> | null, again?: number}} p
 */
export function useTodo({ child, matches, matchesRead, now, self = false, day = null, again = 0 }) {
  const read = matchesRead.error ? null : matchesRead.loading && !matches.length ? undefined : matches;
  const ids = fixturesToRead(read, child, now);
  const answers = usePerFixture(ids, again, answersOf);
  // The lift module, as the session's own switches say (unknown is "ask"); a
  // read that answers module_disabled says so too, and the source goes quiet.
  const { features, ready } = useFeatures();
  const liftsOn = !self && !(ready && features.lift_club === false);
  const lifts = usePerFixture(liftsOn ? ids : [], again, liftsOf);
  const requests = useOnce(liftsOn ? "lift_requests" : null, again, requestsOf);
  const liftsOff = !liftsOn || requests === OFF || Object.values(lifts).some((v) => v === OFF);
  const consents = useOnce("consents", again, () => readLive("consents"));
  const publicName = useOnce(self ? null : `public_name:${child.id}`, again,
    () => api(`/api/players/${child.id}/public-name`).catch((e) => (e?.status === 404 ? OFF : null)));
  const contacts = useOnce(self ? null : `emergency_contact_count:${child.id}`, again,
    () => readLive("emergency_contact_count", { playerId: child.id }));
  const t = todoOf({ child, matches: read, answers, now, self,
    lifts: liftsOff ? OFF : lifts, requests: liftsOff ? OFF : requests,
    day: self || !day ? OFF : day, consents, publicName, contacts });
  const record = self ? null : recordOf({ child, publicName, consents, now });
  return { t, record };
}

/** A row's two lines: who answers it, by when, and where it came from. */
function Facts({ row }) {
  return (
    <>
      <span style={{ ...T.role.body, fontWeight: 600, color: T.content.primary }}>{row.fact}</span>
      <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>
        {[row.owner, row.byWhenText].filter(Boolean).join(" · ")}
      </span>
      <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{row.sourceText}</span>
    </>
  );
}

/** A1's rows carry their rule in the test id; A0's (R1, R2) keep the fixture's, as the walks know them. */
const rowTestId = (row) => (row.rule === "R1" || row.rule === "R2" ? `todo-row-${row.matchId}` : `todo-row-${row.rule}-${row.id.split(":")[1]}`);

/**
 * @param {{child: any, matches: any[], matchesRead: {loading: boolean, error: any}, onOpen: (m: any) => void, now: number,
 *          self?: boolean, day?: Record<string, any> | null, onDayRetry?: () => void,
 *          onDoor?: (panel: "consents" | "ring") => void}} p
 */
export function TodoCard({ child, matches, matchesRead, onOpen, now, self = false, day = null, onDayRetry, onDoor }) {
  const [again, setAgain] = useState(0);
  const [showLater, setShowLater] = useState(false);
  const { t, record } = useTodo({ child, matches, matchesRead, now, self, day, again });
  if (!signedIn()) return null;
  const byId = (id) => matches.find((m) => m.id === id);
  const go = (row) => {
    const d = row.door;
    if (d.kind === "fixture") { const m = byId(d.matchId); if (m) onOpen(m); return; }
    if (d.kind === "day") {
      // The day card is on this Home, under the list: the door brings it into view.
      document.querySelector(`[data-testid="lift-day-family-${d.offerId}"]`)?.scrollIntoView({ block: "center" });
      return;
    }
    onDoor?.(d.kind);
  };
  const retry = (row) => { if (row.source === "lifts_day") onDayRetry?.(); setAgain((n) => n + 1); };
  const openRow = (row) => (
    <OpenRow key={row.id} testid={rowTestId(row)} onClick={() => go(row)} aside={row.door.label}>
      <Facts row={row}/>
    </OpenRow>
  );
  return (
    <>
      <Card label={t.label} testid="todo-card">
        <div aria-live="polite">
          <Line strong testid="todo-count">{t.line}</Line>
        </div>
        {t.rows.length > 0 && (
          <div style={{ display: "grid", gap: T.space.sm }}>
            {t.rows.map((row) => row.state === "open" ? openRow(row) : (
              <div key={row.id} data-testid={`todo-unread-${row.key}`} style={{ display: "grid", gap: T.space.sm }}>
                <Line quiet>{row.fact}</Line>
                {row.door && <div><Action onClick={() => retry(row)} testid="todo-retry">{row.door.label}</Action></div>}
              </div>
            ))}
          </div>
        )}
        {t.later.line && (
          <div style={{ display: "grid", gap: T.space.sm }}>
            <div>
              <Action pressed={showLater} onClick={() => setShowLater((v) => !v)} testid="todo-later">{t.later.line}</Action>
            </div>
            {showLater && t.later.rows.map(openRow)}
          </div>
        )}
        {t.clocked && <Line quiet testid="todo-clock">{t.clockWords}</Line>}
      </Card>
      {record && (record.lines.length > 0 || record.info.length > 0) && (
        <Card label="What you have agreed" testid="todo-record">
          {record.lines.map((l) => (
            <div key={l.key} data-testid={`todo-record-${l.key}`} style={{ display: "grid", gap: "2px" }}>
              <span style={{ ...T.role.body, color: T.content.primary }}>{l.label}: <strong>{l.words}</strong></span>
              {l.detail && <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{l.detail}</span>}
            </div>
          ))}
          {record.info.map((w) => <Line quiet key={w} testid="todo-record-info">{w}</Line>)}
          {onDoor && <div><Action onClick={() => onDoor("consents")} testid="todo-record-all">All consents</Action></div>}
        </Card>
      )}
    </>
  );
}

/**
 * "2 to do ›" on one child's card on Family (D1, D10): his own count, from
 * the same reads and rules as his Home's list, opening his Home. Never a sum.
 * @param {{child: any, matches: any[], matchesRead: {loading: boolean, error: any}, now: number, onOpen: () => void}} p
 */
export function TodoCount({ child, matches, matchesRead, now, onOpen }) {
  const { t } = useTodo({ child, matches, matchesRead, now });
  if (!signedIn()) return null;
  return (
    <OpenRow onClick={onOpen} testid={`family-todo-${child.id}`} aside="Home">
      <span style={{ ...T.role.body, fontWeight: 600 }}>{t.label}</span>
      <span data-testid={`family-todo-count-${child.id}`} style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{t.line}</span>
    </OpenRow>
  );
}

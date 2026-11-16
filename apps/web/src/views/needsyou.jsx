import { useMemo } from "react";
import { T } from "../design/tokens.js";
import { signedIn } from "../lib/api.js";
import { useNav } from "../lib/features.js";
import { headerWords } from "../lib/queue.js";
import { profile } from "../lib/session.js";
import { BentoCard } from "../ui/surfaces.jsx";
import { useQueue } from "./cockpit/useQueue.js";
import { doorsFor } from "./queueDoors.js";
import { fixFor, requestFix } from "../lib/fixNote.js";
import { holdsAsHeld } from "../lib/held.js";
import { setupLines } from "../lib/setupList.js";

/** How many rows Today shows before "See all on To resolve". */
export const NEEDS_YOU_SHOWN = 3;

/**
 * The rows Today leads with, in the queue's own order: the office's lists,
 * then results to confirm and Player of the Match to decide, then the
 * fixtures by date and team. Open rows only: a weather line is information,
 * not something that needs a person. Pure.
 * @param {ReturnType<typeof useQueue>} q
 */
export function needsYouRows(q) {
  const open = (/** @type {any[]} */ rows) => rows.filter((r) => r.state === "open");
  return [
    ...q.offices.flatMap((o) => open(o.rows)),
    ...(q.results ? open(q.results.rows) : []),
    ...(q.potm ? open(q.potm.rows) : []),
    ...q.groups.flatMap((g) => open(g.rows)),
  ];
}

/**
 * "NEEDS YOU" (EXPERIENCE_PASS §1.3, §1.9, §1.10): the first block of Today
 * when anything applies. The same rows as To resolve, from the same reads
 * (views/cockpit/useQueue.js), and each opens the same door
 * (views/queueDoors.js), which lands on the fix: this fixture's side or trip,
 * this competition's conditions, the requests, the claims or the register.
 * Drawn only for a reader who is offered To resolve (Q17: someone who can act
 * on a row), and only when a row is open or a read failed: nothing waiting
 * draws nothing, and the day sheet below says the day. A school-wide row is a
 * count, never a child's name (GA-I09 §5); the names are a tap deeper.
 *
 * The set-up list (EXPERIENCE_PASS §1.9, §2.7; Slice 6) leads it for a school with no fixtures yet: drawn from the
 * same queue rows and the rows Today already reads (`matchesAnswered`, `players`), with no read of its own.
 *
 * @param {{ role: string, matches: any[], onNav: (page: string, section?: string | null) => void,
 *           matchesAnswered?: boolean, players?: any[] }} p
 */
export function NeedsYou({ role, matches, onNav, matchesAnswered = false, players = [] }) {
  const reach = useNav(role);
  const offered = signedIn() && reach.includes("readiness");
  if (!offered) return null;
  return <NeedsYouRead role={role} reach={reach} matches={matches} onNav={onNav} matchesAnswered={matchesAnswered} players={players}/>;
}

/**
 * The set-up list's card: each line a row with its owner and one door, the door landing on its fix.
 * @param {{ lines: import("../lib/setupList.js").SetupLine[], onNav: (page: string, section?: string | null) => void }} p
 */
function SetupList({ lines, onNav }) {
  const line = { ...T.role.body, color: T.content.secondary, margin: 0 };
  const go = (/** @type {import("../lib/setupList.js").SetupLine} */ l) => () => {
    if (l.door.fix) requestFix({ page: l.door.page, find: [l.door.fix] });
    onNav(l.door.page, l.door.section ?? null);
  };
  return (
    <BentoCard level="a" title="Setting up" data-testid="setup-list">
      <div style={{ display: "grid", gap: T.space.xs }}>
        <p data-testid="setup-list-header" style={{ ...line, color: T.content.primary, fontWeight: 600 }}>
          No fixtures yet. {lines.length === 1 ? "One thing" : `${lines.length} things`} to set your school up, each gone once it is done.
        </p>
        <ul style={{ margin: 0, padding: 0, display: "grid", gap: T.space.xs }}>
          {lines.map((l) => (
            <li key={l.key} data-testid="setup-row" data-key={l.key} style={{ listStyle: "none" }}>
              <button type="button" className="os-state" data-testid={`setup-open-${l.key}`} onClick={go(l)}
                style={{ display: "block", width: "100%", minHeight: "44px", padding: `${T.space.sm} ${T.space.md}`, margin: 0, textAlign: "left", cursor: "pointer",
                  background: "transparent", color: "inherit", font: "inherit", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md }}>
                <span data-testid="setup-fact" style={{ display: "block", ...T.role.body, fontWeight: 600, color: T.content.primary, overflowWrap: "anywhere" }}>{l.fact}</span>
                <span style={{ display: "block", ...line }}>{l.owner}</span>
                <span style={{ display: "block", ...line, color: T.content.primary }}>{l.door.label} <span aria-hidden="true">›</span></span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </BentoCard>
  );
}

/** @param {{ role: string, reach: string[], matches: any[], onNav: (page: string, section?: string | null) => void, matchesAnswered: boolean, players: any[] }} p */
function NeedsYouRead({ role, reach, matches, onNav, matchesAnswered, players }) {
  const now = useMemo(() => Date.now(), []);
  const assignments = profile()?.assignments ?? null;
  // No-tap mode (review S2): opening Today makes no read the server logs against the people it names. The lifts
  // expected and the clearance register are read on To resolve, when somebody taps for them.
  const q = useQueue({ matches, assignments, now, onOpen: true });
  const byId = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  if (!q.reader) return null;
  const doorOf = doorsFor({ nav: reach, byId, assignments, onNav });
  const rows = needsYouRows(q);
  const failed = q.header.failed ?? 0;
  // The set-up list (Slice 6): only for a school with no fixtures, and only once the fixtures read has answered.
  const officeRowsOpen = q.offices.flatMap((o) => o.rows ?? []).filter((r) => r.state === "open");
  const setup = setupLines({ reach, mayDo: (c) => holdsAsHeld(role, c),
    matches: { answered: matchesAnswered, count: matches.length }, players,
    parentsWaiting: officeRowsOpen.filter((r) => /:O1P$/.test(r.id)).reduce((n, r) => n + r.count, 0),
    claimsWaiting: officeRowsOpen.filter((r) => r.rule === "O2").reduce((n, r) => n + r.count, 0) });
  const setupCard = setup ? <SetupList lines={setup} onNav={onNav}/> : null;
  // The register is read on a tap, so Today offers the tap instead of a count it did not read.
  const register = q.registerOnTap.length > 0 && reach.includes("staff")
    ? { label: "The register", go: () => { const n = fixFor("register"); if (n) requestFix(n); onNav("staff"); } } : null;
  if (!rows.length && !failed && !q.header.loading) return setupCard;
  const shown = rows.slice(0, NEEDS_YOU_SHOWN);
  const line = { ...T.role.body, color: T.content.secondary, margin: 0 };
  return (
    <>
    {setupCard}
    <BentoCard level="a" title="Needs you" data-testid="needs-you">
      <div style={{ display: "grid", gap: T.space.xs }}>
        <p data-testid="needs-you-header" aria-live="polite" style={{ ...line, color: T.content.primary, fontWeight: 600 }}>
          {q.header.loading && !rows.length ? "Reading what is waiting…" : headerWords(q.header)}
        </p>
        <ul style={{ margin: 0, padding: 0, display: "grid", gap: T.space.xs }}>
          {shown.map((r) => {
            const door = doorOf(r);
            const inner = (
              <>
                <span data-testid="needs-you-fact" style={{ display: "block", ...T.role.body, fontWeight: 600, color: T.content.primary, overflowWrap: "anywhere" }}>{r.fact}</span>
                {(r.owner || r.deadline || r.age) && (
                  <span style={{ display: "block", ...line }}>{[r.owner, r.deadline?.words ?? r.age].filter(Boolean).join(" · ")}</span>
                )}
                {door && <span data-testid="needs-you-door" style={{ display: "block", ...line, color: T.content.primary }}>{door.label} <span aria-hidden="true">›</span></span>}
              </>
            );
            return (
              <li key={r.id} data-testid="needs-you-row" data-rule={r.rule} data-kind={r.action?.kind ?? ""} data-match={r.action?.matchId ?? undefined} style={{ listStyle: "none" }}>
                {door
                  ? <button type="button" className="os-state" data-testid={`needs-you-open-${r.id}`} onClick={door.go}
                      style={{ display: "block", width: "100%", minHeight: "44px", padding: `${T.space.sm} ${T.space.md}`, margin: 0, textAlign: "left", cursor: "pointer",
                        background: "transparent", color: "inherit", font: "inherit", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md }}>{inner}</button>
                  : <div style={{ padding: `${T.space.sm} ${T.space.md}`, border: `1px solid ${T.line.subtle}`, borderRadius: T.radius.md }}>{inner}</div>}
              </li>
            );
          })}
        </ul>
        {register && (
          <button type="button" className="os-state" data-testid="needs-you-register" onClick={register.go}
            style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, justifySelf: "start", background: "transparent", color: T.content.primary,
              border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer", ...T.role.body }}>
            Check the clearance register <span aria-hidden="true">›</span>
          </button>
        )}
        {(rows.length > shown.length || failed > 0) && (
          <button type="button" className="os-state" data-testid="needs-you-all" onClick={() => onNav("readiness")}
            style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, justifySelf: "start", background: "transparent", color: T.content.primary,
              border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer", ...T.role.body, fontWeight: 600 }}>
            {rows.length > shown.length ? `See all ${rows.length} on To resolve` : "See what could not be read on To resolve"}
          </button>
        )}
      </div>
    </BentoCard>
    </>
  );
}

/**
 * "To do for Rohan" (GA-I20 phase A0, docs/design/GA-I20_parent_action_list.md
 * §2, §3.1, §6): the second card on a parent's Home, under the next fixture,
 * for the child that is chosen and nobody else.
 *
 * Every read here is one the family app already makes: the fixture list (the
 * Home's own) and, for each of his side's fixtures still to come, the answers
 * the Matches screen reads one at a time. Nothing is written. The rules are
 * lib/todo.js's; this draws what they say and opens the one door each row has,
 * the fixture, where the parent answers today.
 *
 * It is made again every time the Home is opened (the Home's body is rebuilt
 * on the way back from a fixture), so a row goes when the answer is given, on
 * this phone or any other, and nothing is kept on the device.
 */
import { useEffect, useState } from "react";
import { T } from "../../design/tokens.js";
import { signedIn } from "../../lib/api.js";
import { readLive } from "../../lib/live.js";
import { fixturesToRead, todoOf } from "../../lib/todo.js";
import { Action, Card, Line, OpenRow } from "./parts.jsx";

/**
 * One availability read per fixture, each kept as it arrives: `undefined` until
 * it has answered, `null` if it failed (readLive's own answer for a read that
 * did not), the rows otherwise. `again` re-reads them all.
 */
function useAnswers(ids, again) {
  const key = ids.join(",");
  const [state, setState] = useState({ key: "", answers: {} });
  useEffect(() => {
    if (!signedIn()) return undefined;
    let cancelled = false;
    setState({ key, answers: {} });
    for (const id of key ? key.split(",") : []) {
      readLive("availability", { matchId: id }).then((rows) => {
        if (!cancelled) setState((s) => (s.key === key ? { key, answers: { ...s.answers, [id]: rows } } : s));
      });
    }
    return () => { cancelled = true; };
  }, [key, again]);
  return state.key === key ? state.answers : {};
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

/**
 * @param {{child: any, matches: any[], matchesRead: {loading: boolean, error: any}, onOpen: (m: any) => void, now: number}} p
 */
export function TodoCard({ child, matches, matchesRead, onOpen, now }) {
  const [again, setAgain] = useState(0);
  const [showLater, setShowLater] = useState(false);
  const read = matchesRead.error ? null : matchesRead.loading && !matches.length ? undefined : matches;
  const answers = useAnswers(fixturesToRead(read, child, now), again);
  if (!signedIn()) return null;
  const t = todoOf({ child, matches: read, answers, now });
  const byId = (id) => matches.find((m) => m.id === id);
  const open = (row) => { const m = byId(row.matchId); if (m) onOpen(m); };
  return (
    <Card label={t.label} testid="todo-card">
      <div aria-live="polite">
        <Line strong testid="todo-count">{t.line}</Line>
      </div>
      {t.rows.length > 0 && (
        <div style={{ display: "grid", gap: T.space.sm }}>
          {t.rows.map((row) => row.state === "open" ? (
            <OpenRow key={row.id} testid={`todo-row-${row.matchId}`} onClick={() => open(row)} aside={row.door.label}>
              <Facts row={row}/>
            </OpenRow>
          ) : (
            <div key={row.id} data-testid={`todo-unread-${row.key}`} style={{ display: "grid", gap: T.space.sm }}>
              <Line quiet>{row.fact}</Line>
              {row.door && <div><Action onClick={() => setAgain((n) => n + 1)} testid="todo-retry">{row.door.label}</Action></div>}
            </div>
          ))}
        </div>
      )}
      {t.later.line && (
        <div style={{ display: "grid", gap: T.space.sm }}>
          <div>
            <Action pressed={showLater} onClick={() => setShowLater((v) => !v)} testid="todo-later">{t.later.line}</Action>
          </div>
          {showLater && t.later.rows.map((row) => (
            <OpenRow key={row.id} testid={`todo-row-${row.matchId}`} onClick={() => open(row)} aside={row.door.label}>
              <Facts row={row}/>
            </OpenRow>
          ))}
        </div>
      )}
      {t.clocked && <Line quiet testid="todo-clock">{t.clockWords}</Line>}
    </Card>
  );
}

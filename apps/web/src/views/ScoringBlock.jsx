import { useEffect, useState } from "react";
import { T } from "../design/tokens.js";
import { deviceMatches } from "../lib/deviceMatches.js";
import { practiceHomeRows } from "../lib/practice.js";
import { pilotHomeRows, pilotStatus } from "../lib/pilot.js";
import { lastRecord, nowItems, scoreLine, startWords } from "../lib/scorerDay.js";
import { pendingWords } from "../lib/scorerHome.js";
import { Board } from "../ui/board.jsx";
import { StateLabel } from "../ui/stateLabel.jsx";

// ══════════════════════════════════════════════════════
//  SCORING, FOR SOMEBODY WHO IS NOT A SCHOOL'S SCORER
//  (EXPERIENCE_PASS §2.5, slice 1; Q3 and Q5, Kameel 13 Nov 2026)
//
//  The block an account with no school sees first (auth/NoSchool.jsx), in
//  the order his match happens:
//
//    Now          a Practice or Pilot Match this phone is part-way through,
//                 on the one Board, and "Resume scoring". Only when there is
//                 one: a new account's first thing is "Start a match"
//    Start        the pad's own setup, at its first step (startWords()'s
//                 words, the scorer's home's): a Practice Match for anyone
//                 signed in, a Pilot Match only where SCRBRD has granted the
//                 account. The players' names are optional (Q5)
//    Your last    the last match this phone finished: what he scored, as a
//    match        plain record (§3.9), and "Scoring for a school? Join it"
//                 (§2.5 step 6, at the result, never during play)
//
//  Built to be set on another home too (Q2, slice 4: a pupil or parent who
//  scores keeps his own app, with scoring as a block on it). Everything here
//  is this phone's own stores and the account's own Pilot status; nothing
//  about a child is read, and none is named: the Board is drawn without
//  batters or bowler. It opens the pad through `onOpenPad`, the shell's,
//  which decides what may be opened.
// ══════════════════════════════════════════════════════

const card = () => ({ borderRadius: "16px", border: `1px solid ${T.line.normal}`, background: T.fill.panel, padding: "20px", marginBottom: "16px",
  display: "flex", flexDirection: "column", gap: T.space.md, minWidth: 0 });
const h2 = () => ({ ...T.role.title.md, color: T.content.primary, margin: 0 });
const line = () => ({ ...T.role.body, color: T.content.secondary, margin: 0, overflowWrap: "anywhere" });
const strong = () => ({ ...T.role.title.md, color: T.content.primary, margin: 0, overflowWrap: "anywhere" });

/** A 44px button. @param {{children: any, onClick: () => void, testId: string, tone?: "primary" | "secondary", label?: string}} p */
function Act({ children, onClick, testId, tone = "primary", label }) {
  const primary = tone === "primary";
  return (
    <button type="button" onClick={onClick} data-testid={testId} aria-label={label} className="pressBtn" style={{
      minHeight: "44px", minWidth: "44px", padding: "0 20px", borderRadius: T.radius.pill, boxSizing: "border-box",
      border: `1px solid ${primary ? "transparent" : T.line.strong}`,
      background: primary ? T.light.cobalt : "transparent", color: primary ? T.light.ink : T.content.primary,
      fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, cursor: "pointer", alignSelf: "flex-start",
    }}>{children}</button>
  );
}

/** This phone's Practice and Pilot Matches (their boards, titles and counts, never a log) and its outbox's counts. */
function usePhoneMatches() {
  const [s, setS] = useState({ loading: true, ok: true, practices: [], pilots: [], pending: null, held: null });
  useEffect(() => {
    let off = false;
    Promise.all([
      practiceHomeRows().then((rows) => ({ ok: true, rows })).catch(() => ({ ok: false, rows: [] })),
      pilotHomeRows().then((rows) => ({ ok: true, rows })).catch(() => ({ ok: false, rows: [] })),
      deviceMatches().catch(() => ({ outbox: null })),
    ]).then(([q, p, d]) => {
      if (!off) setS({ loading: false, ok: q.ok && p.ok, practices: q.rows, pilots: p.rows,
                       pending: d?.outbox?.pending ?? null, held: d?.outbox?.held ?? null });
    });
    return () => { off = true; };
  }, []);
  return s;
}

/**
 * The last match's plain record (§3.9). Shared with the scorer's home
 * (views/ScorerHomeView.jsx), which draws it in its own card.
 * @param {{record: NonNullable<ReturnType<typeof lastRecord>>, onJoin?: (() => void) | null, testId?: string}} p
 */
export function PlainRecord({ record, onJoin = null, testId = "record" }) {
  return (
    <div data-testid={testId} data-kind={record.kind} style={{ display: "flex", flexDirection: "column", gap: T.space.xs }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: `0 ${T.space.sm}` }}>
        <p style={strong()}>{record.title}</p>
        <StateLabel kind={record.kind} compact/>
      </div>
      {record.lines.length > 0 && <p style={line()} data-testid={`${testId}-score`}>{record.lines.map(scoreLine).join(" · ")}</p>}
      <p style={{ ...line(), color: T.content.primary, fontWeight: 600 }} data-testid={`${testId}-words`}>You scored {record.words}.</p>
      {onJoin && (
        <div style={{ marginTop: T.space.sm }}>
          <Act tone="secondary" testId={`${testId}-join`} onClick={onJoin}>Scoring for a school? Join it</Act>
        </div>
      )}
    </div>
  );
}

/**
 * @param {{onOpenPad: (entry: {start: "pilot"} | {resume: string}) => void, onJoin?: (() => void) | null}} p
 *   `onJoin`: where "Scoring for a school? Join it" goes (the join form on the same screen)
 */
export function ScoringBlock({ onOpenPad, onJoin = null }) {
  const phone = usePhoneMatches();
  const [pilot, setPilot] = useState({ loading: true, status: /** @type {any} */ (null) });
  useEffect(() => {
    let off = false;
    pilotStatus().catch(() => null).then((status) => { if (!off) setPilot({ loading: false, status }); });
    return () => { off = true; };
  }, []);
  const start = startWords(pilot.status, pilot.loading);
  const now = nowItems({ pilots: phone.pilots, practices: phone.practices, pending: phone.pending, held: phone.held }).filter((i) => !i.finished);
  const record = lastRecord({ practices: phone.practices, pilots: phone.pilots, pending: phone.pending, held: phone.held });

  return (
    <section data-testid="scoring-block" aria-label="Scoring" style={{ marginBottom: "4px" }}>
      {!phone.ok && (
        <p role="status" data-testid="scoring-phone-unread" style={{ ...line(), marginBottom: "12px" }}>Could not read this phone's saved matches. Nothing is deleted.</p>
      )}

      {now.length > 0 && (
        <div data-testid="start-now" style={card()}>
          <h2 style={h2()}>Now</h2>
          {now.map((it) => (
            <div key={it.key} data-testid={`now-${it.matchId}`} data-kind={it.kind} style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: `0 ${T.space.sm}` }}>
                <p style={strong()}>{it.title}</p>
                <StateLabel kind={it.kind === "pilot" ? "pilot" : "practice"} compact/>
              </div>
              {it.error
                ? <p role="alert" style={{ ...line(), color: T.semantic.criticalText }} data-testid={`now-${it.matchId}-unread`}>Could not read this match's balls on this phone. Nothing is deleted.</p>
                : it.board
                ? <Board {...it.board} size="card" compact testid={`now-${it.matchId}-board`}/>
                : <p style={line()}>No ball on the board yet.</p>}
              <p style={line()} data-testid={`now-${it.matchId}-pending`}>{it.kind === "practice" ? "Kept on this phone only: nothing is sent" : pendingWords(it.pending)}</p>
              <Act testId={`now-${it.matchId}-open`} label={`Resume scoring: ${it.title}`} onClick={() => onOpenPad({ resume: it.matchId })}>Resume scoring</Act>
            </div>
          ))}
        </div>
      )}

      <div data-testid="start-match" data-state={start.state} style={card()}>
        <h2 style={h2()}>Start a match</h2>
        <p style={line()} data-testid="start-match-note">{start.note}</p>
        <Act testId="start-match-go" label={start.action} onClick={() => onOpenPad({ start: "pilot" })}>{start.action}</Act>
      </div>

      {record && (
        <div data-testid="start-record" style={card()}>
          <h2 style={h2()}>Your last match</h2>
          <PlainRecord record={record} onJoin={onJoin} testId="start-record-match"/>
        </div>
      )}
    </section>
  );
}

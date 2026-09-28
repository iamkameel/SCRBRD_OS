import { useId, useState } from "react";
import { T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { Icon } from "../ui/icons.jsx";
import { api, signedIn } from "../lib/api.js";
import { filesConduct } from "../rbac/conduct.js";
import {
  SUSPENSION_REASONS_OFFERED, bowlerToSuspend, bowlingCandidates, replacementOptions, scopeWords,
  suspendRefusal, suspensionReasonWords, suspensionRefusalWords, suspensionsInMatch,
} from "./suspension.js";
import { recordedScopeWords } from "./suspension.js";
import { lawsEdition } from "@scrbrd/scoring";
import { Sheet } from "./ui.jsx";

/**
 * "UMPIRE SUSPENDED THE BOWLER" — the pad's sheet (Law 41; SCRBRD-094 item 2).
 *
 * One sheet, three views, in the order a scorer meets them:
 *   REASON: why, in words (the list is closed; how long is the reason's, and
 *     the sheet says it). "Record the suspension" sends bowlerSuspended().
 *   REPLACE: straight after, who finishes the over (reason "suspended"), or at
 *     an over's end who bowls the next. Only the bowlers the Laws would take
 *     are buttons; the rest are listed with why not, in words.
 *   REPORT: from the pad's menu once a suspension is in the match, and on the
 *     result screen — the umpires' report, filed as a discipline record
 *     through the existing route (db/25), the bowler and the words filled in.
 *     Nothing here opens by itself: §1a — the next ball is never held up.
 *
 * The Laws are asked before anything is offered (suspension.js); a refusal is
 * said in place, in words, and the button it holds back is disabled with it.
 * No Law clause numbers. Floors (DESIGN_DIRECTION §3.2, §3.5): nothing read
 * under 12px, nothing tapped under 44px; tokens read from T while it draws,
 * useTheme() redraws it when the theme or the colours change.
 */

const label = () => ({ ...T.role.label, color: T.content.secondary, margin: `0 0 ${T.space.sm}` });
const body = () => ({ fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.45, color: T.content.secondary, margin: 0 });

/** A choice: 48 tall, 16px, a border that says it is chosen. */
const choice = (on) => ({
  width: "100%", minHeight: "48px", padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md,
  cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: T.space.sm,
  fontFamily: T.type.body, fontSize: "16px", fontWeight: on ? 600 : 500, lineHeight: 1.3,
  color: T.content.primary, background: on ? T.surface.raised : T.surface.interactive,
  border: `${on ? 2 : 1}px solid ${on ? T.content.primary : T.line.normal}`,
});

/** The one button that records. */
const commit = (enabled) => ({
  width: "100%", minHeight: "56px", padding: `${T.space.sm} ${T.space.lg}`, borderRadius: T.radius.md,
  cursor: enabled ? "pointer" : "not-allowed", border: `1px solid ${enabled ? T.content.primary : T.line.normal}`,
  fontFamily: T.type.body, fontSize: "17px", fontWeight: 600, lineHeight: 1.25,
  background: enabled ? T.content.primary : T.surface.interactive,
  color: enabled ? T.surface.canvas : T.content.tertiary,
});

/** The Laws' answer, in place and in words. */
function Refusal({ id, words, testid = "suspend-refusal" }) {
  if (!words) return null;
  return (
    <div id={id} data-testid={testid} role="status"
      style={{ display: "flex", gap: T.space.sm, alignItems: "flex-start", padding: T.space.md, borderRadius: T.radius.md,
        border: `1px solid ${T.semantic.critical}`, background: T.surface.base }}>
      <span aria-hidden="true" style={{ color: T.semantic.criticalText, fontSize: "18px", lineHeight: 1.2 }}><Icon name="ban"/></span>
      <p style={{ ...body(), color: T.semantic.criticalText, fontWeight: 500 }}>
        <span style={{ fontWeight: 700 }}>The Laws refuse this. </span>{words}
      </p>
    </div>
  );
}

/** A bowler's line: name, and figures when he has bowled. */
const figures = (inn, id) => {
  const b = inn?.bowlers?.find((x) => x.id === id);
  return b ? `${Math.floor(b.balls / 6)}.${b.balls % 6}–${b.maidens}–${b.runs}–${b.wickets}` : null;
};

/**
 * @param {object} p
 * @param {"reason" | "replace" | "report"} [p.view]  where it opens
 * @param {any[]} p.innings   the pad's fold (foldPad)
 * @param {any[][]} p.events  the pad's log
 * @param {number} p.curIn
 * @param {string | null} [p.role]  the pad's role, for whether this account files the report
 * @param {string | null} [p.matchId]
 * @param {(reason: string) => void} p.onSuspend
 * @param {(id: string, midOver: boolean) => void} p.onReplace
 * @param {() => void} p.onClose
 */
export function SuspendSheet({ view: startView = "reason", innings, events, curIn, role = null, matchId = null,
  onSuspend, onReplace, onClose }) {
  useTheme();
  const [view, setView] = useState(startView);
  const [reason, setReason] = useState(/** @type {string | null} */ (null));
  const [typed, setTyped] = useState("");
  const refusalId = useId(), hintId = useId();
  const match = { innings, events };
  const inn = innings?.[curIn] ?? null;
  const nameOf = (id) => inn?.bowlers?.find((b) => b.id === id)?.name ?? String(id ?? "");

  // ── The replacement ──────────────────────────────────────────
  if (view === "replace") {
    const { midOver, eligible, refused } = replacementOptions(match, curIn, bowlingCandidates(inn));
    const typedCode = typed.trim() ? replacementOptions(match, curIn, [{ id: typed.trim(), name: typed.trim() }]).refused[0]?.words ?? null : null;
    const title = midOver ? "Who finishes the over?" : "Who bowls the next over?";
    return (
      <Sheet title={title} onClose={onClose}>
        <div data-testid="suspend-replace" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.lg }}>
          <p style={body()}>
            {midOver
              ? "Another bowler finishes the over. He may not have bowled any of the last over, and may not bowl the next."
              : "The over is done. Choose who bowls the next one."}
          </p>
          <section aria-label="Can bowl">
            <h3 style={label()}>Can bowl</h3>
            <div data-testid="suspend-eligible" style={{ display: "grid", gap: T.space.xs }}>
              {eligible.map((c) => (
                <button key={c.id} type="button" data-testid={`suspend-pick-${c.id}`} onClick={() => onReplace(c.id, midOver)}
                  className="pressBtn os-state" style={choice(false)}>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  {figures(inn, c.id) && <span style={{ fontFamily: T.type.mono, fontSize: "14px", color: T.content.secondary }}>{figures(inn, c.id)}</span>}
                </button>
              ))}
              {eligible.length === 0 && <p style={body()}>Nobody in the list can bowl it. Type the bowler's name below.</p>}
            </div>
          </section>
          <section aria-label="Another bowler">
            <h3 style={label()}>Another bowler</h3>
            <div style={{ display: "flex", gap: T.space.sm }}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Bowler's name" placeholder="Name"
                data-testid="suspend-typed"
                style={{ flex: 1, minWidth: 0, minHeight: "48px", padding: `0 ${T.space.md}`, borderRadius: T.radius.md,
                  border: `1px solid ${T.line.normal}`, background: T.surface.interactive, color: T.content.primary,
                  fontFamily: T.type.body, fontSize: "16px" }}/>
              <button type="button" data-testid="suspend-typed-go" disabled={!typed.trim() || !!typedCode}
                aria-describedby={typedCode ? refusalId : undefined}
                onClick={() => { if (typed.trim() && !typedCode) onReplace(typed.trim(), midOver); }} className="os-state"
                style={{ ...commit(!!typed.trim() && !typedCode), width: "auto", minHeight: "48px" }}>Bowls</button>
            </div>
            <Refusal id={refusalId} words={typedCode}/>
          </section>
          {refused.length > 0 && (
            <section aria-label="Not offered">
              <h3 style={label()}>Not offered</h3>
              <ul data-testid="suspend-refused" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: T.space.xs }}>
                {refused.map((c) => (
                  <li key={c.id} data-testid={`suspend-refused-${c.id}`}
                    style={{ padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md, border: `1px solid ${T.line.normal}`,
                      background: T.surface.base, display: "grid", gap: "2px" }}>
                    <span style={{ fontFamily: T.type.body, fontSize: "16px", fontWeight: 600, color: T.content.primary }}>{c.name}</span>
                    <span style={{ fontFamily: T.type.body, fontSize: "14px", color: T.content.secondary }}>{c.words}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </Sheet>
    );
  }

  // ── The umpires' report ──────────────────────────────────────
  if (view === "report") return <ReportView innings={innings} role={role} matchId={matchId} onClose={onClose}/>;

  // ── The reason ───────────────────────────────────────────────
  const who = bowlerToSuspend(inn);
  const code = suspendRefusal(match, curIn, who, reason);
  const words = suspensionRefusalWords(code);
  const ready = reason != null && !code;
  const hint = !code && reason == null ? "Choose the reason the umpire gave." : null;
  return (
    <Sheet title="Umpire suspended the bowler" onClose={onClose}>
      <div data-testid="suspend-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.lg }}>
        <p style={body()}>
          {who != null
            ? <><span style={{ color: T.content.primary, fontWeight: 600 }}>{nameOf(who)}</span> may not bowl again. Another bowler finishes the over.</>
            : "Nobody is bowling yet."}
        </p>
        <Refusal id={refusalId} words={words}/>
        <section aria-label="Why?">
          <h3 style={label()}>Why?</h3>
          <div role="radiogroup" aria-label="Why?" style={{ display: "grid", gap: T.space.xs }}>
            {SUSPENSION_REASONS_OFFERED.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} data-testid={`suspend-reason-${r}`}
                onClick={() => setReason(r)} className="pressBtn os-state" style={choice(reason === r)}>
                <span style={{ flex: 1 }}>{suspensionReasonWords(r)}</span>
                {reason === r && <span aria-hidden="true"><Icon name="circle-check"/></span>}
              </button>
            ))}
          </div>
          {reason != null && (
            <p data-testid="suspend-scope" style={{ ...body(), color: T.content.primary, marginTop: T.space.sm }}>
              He may not bowl again {scopeWords(reason, lawsEdition(match))}.
            </p>
          )}
        </section>
        <div style={{ display: "grid", gap: T.space.sm }}>
          <button type="button" data-testid="suspend-confirm" disabled={!ready}
            aria-describedby={code ? refusalId : hint ? hintId : undefined}
            onClick={() => { if (ready) { onSuspend(/** @type {string} */ (reason)); setView("replace"); } }}
            className="os-state" style={commit(ready)}>
            Record the suspension
          </button>
          {hint && <p id={hintId} data-testid="suspend-hint" style={{ ...body(), fontSize: "14px" }}>{hint}</p>}
        </div>
        <p style={{ ...body(), fontSize: "13px", color: T.content.tertiary }}>
          The umpires report a suspension after the match. The pad's menu has the report once it is recorded.
        </p>
      </div>
    </Sheet>
  );
}

/**
 * The offer, after the match: one line and one button, on the pad and on its
 * result screen. Never during play.
 * @param {{count: number, onOpen: () => void}} p
 */
export function ReportOffer({ count, onOpen }) {
  useTheme();
  return (
    <div data-testid="suspend-report-offer" style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap",
      padding: T.space.md, borderRadius: T.radius.md, border: `1px solid ${T.line.normal}`, background: T.surface.base, marginBottom: T.space.sm }}>
      <span aria-hidden="true" style={{ color: T.content.secondary }}><Icon name="gavel"/></span>
      <span style={{ flex: 1, minWidth: "12rem", fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.4, color: T.content.primary }}>
        {count === 1 ? "A bowler was suspended in this match." : `${count} bowlers were suspended in this match.`} The umpires report it.
      </span>
      <button type="button" data-testid="suspend-report-open" onClick={onOpen} className="pressBtn os-state"
        style={{ minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.md, cursor: "pointer",
          border: `1px solid ${T.line.strong}`, background: "transparent", color: T.content.primary,
          fontFamily: T.type.body, fontSize: "15px", fontWeight: 600 }}>
        Open the umpires' report
      </button>
    </div>
  );
}

/**
 * The umpires' report: each suspension in the match, with what the record
 * says, and — for an account that files conduct, signed in — the filing,
 * through the discipline route that already exists (POST
 * /api/players/:id/discipline, db/25; the Match Centre's "Report an
 * incident" posts the same). Row-level security decides; like that form, the
 * filer is told it landed and shown nothing back.
 */
function ReportView({ innings, role, matchId, onClose }) {
  const list = suspensionsInMatch(innings);
  const canFile = !!matchId && signedIn() && filesConduct(role);
  return (
    <Sheet title="Umpires' report" onClose={onClose}>
      <div data-testid="suspend-report" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.lg }}>
        <p style={body()}>
          The umpires report a suspension to the competition after the match. The school keeps it as a discipline record.
        </p>
        {list.length === 0 && <p style={body()}>No bowler has been suspended in this match.</p>}
        {list.map((s) => <ReportItem key={s.key} s={s} canFile={canFile} matchId={matchId}/>)}
        {!canFile && list.length > 0 && (
          <p data-testid="suspend-report-who" style={{ ...body(), color: T.content.primary }}>
            {!matchId ? "This match is on this device only, so there is no fixture to file the record against."
              : !signedIn() ? "Sign in to file the record from here. The umpires can also file it from the Match Centre: open this fixture, then Report an incident."
              : "The umpires file the record: in the Match Centre, open this fixture, then Report an incident. The words above are theirs to use."}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function ReportItem({ s, canFile, matchId }) {
  const [text, setText] = useState(s.body);
  const [state, setState] = useState(/** @type {{busy?: boolean, done?: boolean, said?: string | null}} */ ({}));
  const file = async () => {
    if (!s.playerId || !text.trim()) return;
    setState({ busy: true });
    try {
      await api(`/api/players/${s.playerId}/discipline`, { method: "POST", body: { body: text.trim(), matchId } });
      setState({ done: true });
    } catch (e) {
      const err = /** @type {any} */ (e);
      setState({ said: err?.status === 401 ? "Your session has ended. Sign in again. Nothing was recorded."
        : err?.status === 403 || err?.code === "not_permitted" ? "Refused: your role does not reach this pupil or fixture. Nothing was recorded."
        : err?.status ? `Not recorded: the server said ${err.code || `HTTP ${err.status}`}.`
        : "Could not reach the server. Nothing was recorded." });
    }
  };
  return (
    <section data-testid={`suspend-report-${s.key}`} aria-label={`${s.name}, suspended`}
      style={{ padding: T.space.md, borderRadius: T.radius.md, border: `1px solid ${T.line.normal}`, background: T.surface.base,
        display: "grid", gap: T.space.sm }}>
      <h3 style={{ margin: 0, fontFamily: T.type.body, fontSize: "16px", fontWeight: 600, color: T.content.primary }}>
        {s.name} · innings {s.innings + 1}, {s.at}
      </h3>
      <p style={body()}>{suspensionReasonWords(s.reason)}. He may not bowl again {recordedScopeWords(s.scope)}.</p>
      {canFile && s.playerId && !state.done && (
        <>
          <label style={{ ...label(), margin: 0 }} htmlFor={`sr-${s.key}`}>The record</label>
          <textarea id={`sr-${s.key}`} data-testid="suspend-report-body" value={text} onChange={(e) => setText(e.target.value)} rows={4}
            style={{ width: "100%", boxSizing: "border-box", padding: T.space.sm, borderRadius: T.radius.md, resize: "vertical",
              border: `1px solid ${T.line.normal}`, background: T.surface.interactive, color: T.content.primary,
              fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.45 }}/>
          <button type="button" data-testid="suspend-report-file" disabled={!!state.busy || !text.trim()} onClick={file}
            className="os-state" style={commit(!state.busy && !!text.trim())}>
            File it as a discipline record
          </button>
        </>
      )}
      {canFile && !s.playerId && (
        <p style={{ ...body(), fontSize: "14px" }}>
          {s.name} was typed by name, not picked from a roster, so there is no record here to file against. Report it to his school.
        </p>
      )}
      {state.done && <p role="status" data-testid="suspend-report-done" style={{ ...body(), color: T.content.primary }}>Filed. The school has it.</p>}
      {state.said && <p role="alert" data-testid="suspend-report-refused" style={{ ...body(), color: T.semantic.criticalText }}>{state.said}</p>}
    </section>
  );
}

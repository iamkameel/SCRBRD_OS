import { useId, useState } from "react";
import { T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { Icon } from "../ui/icons.jsx";
import {
  awardRefusal, pendingCredits, reasonWords, reasonsFor, refusalWords, shortRunRefusal, whereTheRunsGo,
} from "./penalty.js";
import { Sheet } from "./ui.jsx";

/**
 * PENALTY RUNS — the pad's sheet (Law 41; SCRBRD-094 item 1: the screen).
 *
 * Two ways in, one sheet:
 *   AN AWARD: which side gets the five, then what for — only the reasons that
 *     side can be awarded (PENALTY_REASON_SIDE), in words — then Award. The
 *     event is penalty({ runs: 5, toBattingTeam, reason }).
 *   A SHORT RUN: the umpire called deliberate short running. The delivery
 *     counts with no runs and five go to the fielding side: the two events of
 *     shortRunning(), recorded together through the pad's own ball path.
 *
 * The Laws are asked before anything is offered (penalty.js): a refusal is
 * said here, in words, and the button that would send it is disabled with
 * that reason — never hidden, and the event is never sent to be refused.
 * No Law clause numbers anywhere on it (Kameel is checking them).
 *
 * Floors (DESIGN_DIRECTION §3.2, §3.5): nothing read under 12px, nothing
 * tapped under 44px. Tokens are read from T while it draws; useTheme() makes
 * it draw again when the theme or the colours change.
 *
 * Out of scope, said on the sheet in one line: the umpires' report of the
 * offence to the offending side (a discipline record, db/25).
 */

const DELIVERIES = [
  { type: "run", label: "Fair ball" },
  { type: "Nb", label: "No ball" },
  { type: "Wd", label: "Wide" },
];

const label = () => ({ ...T.role.label, color: T.content.secondary, margin: `0 0 ${T.space.sm}` });
const body = () => ({ fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.45, color: T.content.secondary, margin: 0 });

/** A choice: 48 tall, 16px, a border that says it is chosen and a tick that says it twice. */
const choice = (on) => ({
  width: "100%", minHeight: "48px", padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md,
  cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: T.space.sm,
  fontFamily: T.type.body, fontSize: "16px", fontWeight: on ? 600 : 500, lineHeight: 1.3,
  color: T.content.primary, background: on ? T.surface.raised : T.surface.interactive,
  border: `${on ? 2 : 1}px solid ${on ? T.content.primary : T.line.normal}`,
});

/** The one button that records: filled when it may, flat with its reason when it may not. */
const commit = (enabled) => ({
  width: "100%", minHeight: "56px", padding: `${T.space.sm} ${T.space.lg}`, borderRadius: T.radius.md,
  cursor: enabled ? "pointer" : "not-allowed", border: `1px solid ${enabled ? T.content.primary : T.line.normal}`,
  fontFamily: T.type.body, fontSize: "17px", fontWeight: 600, lineHeight: 1.25,
  background: enabled ? T.content.primary : T.surface.interactive,
  color: enabled ? T.surface.canvas : T.content.tertiary,
});

/** The Laws' answer, in place and in words. */
function Refusal({ id, words }) {
  if (!words) return null;
  return (
    <div id={id} data-testid="penalty-refusal" role="status"
      style={{ display: "flex", gap: T.space.sm, alignItems: "flex-start", padding: T.space.md, borderRadius: T.radius.md,
        border: `1px solid ${T.semantic.critical}`, background: T.surface.base }}>
      <span aria-hidden="true" style={{ color: T.semantic.criticalText, fontSize: "18px", lineHeight: 1.2 }}><Icon name="ban"/></span>
      <p style={{ ...body(), color: T.semantic.criticalText, fontWeight: 500 }}>
        <span style={{ fontWeight: 700 }}>The Laws refuse this. </span>{words}
      </p>
    </div>
  );
}

/** What the scorer still has to choose, said under the button it is holding back. */
function Hint({ id, words }) {
  if (!words) return null;
  return <p id={id} data-testid="penalty-hint" style={{ ...body(), fontSize: "14px", color: T.content.secondary }}>{words}</p>;
}

/**
 * @param {object} p
 * @param {"award" | "shortRun"} [p.mode]  where it opens
 * @param {any[]} p.innings   the pad's fold (foldPad)
 * @param {any[][]} p.events  the pad's log
 * @param {number} p.curIn
 * @param {object} [p.ctx]    the fold's context
 * @param {{striker: any, nonStriker: any, bowler: any}} p.crease  who is in, as the next ball's event names them
 * @param {{striker?: string, nonStriker?: string, bowler?: string}} [p.names]  the same, as names
 * @param {(c: {toBattingTeam: boolean, reason: string}) => void} p.onAward
 * @param {(type: string) => void} p.onShortRun
 * @param {() => void} p.onClose
 */
export function PenaltySheet({ mode = "award", innings, events, curIn, ctx, crease, names = {}, onAward, onShortRun, onClose }) {
  useTheme();
  const [view, setView] = useState(mode);
  const [side, setSide] = useState(/** @type {boolean | null} */ (null));
  const [reason, setReason] = useState(/** @type {string | null} */ (null));
  const [delivery, setDelivery] = useState("run");
  const refusalId = useId(), hintId = useId();

  const inn = innings?.[curIn] ?? null;
  const batting = inn?.battingTeam || "The batting side";
  const fielding = inn?.bowlingTeam || "The fielding side";
  const match = { innings, events };
  const pending = pendingCredits(innings);

  const pendingLines = pending.length > 0 && (
    <div data-testid="penalty-pending" style={{ display: "grid", gap: T.space.xs }}>
      {pending.map((p) => (
        <p key={p.team} style={{ ...body(), color: T.content.primary }}>
          <Icon name="gavel"/> {p.words} (penalty runs).
        </p>
      ))}
    </div>
  );
  const reportLine = (
    <p data-testid="penalty-report-note" style={{ ...body(), fontSize: "13px", color: T.content.tertiary }}>
      The umpires report the offence to the offending side. This pad records the runs only.
    </p>
  );

  // ── A short run ─────────────────────────────────────────────
  if (view === "shortRun") {
    const code = shortRunRefusal(match, curIn, { type: delivery, value: 0, ...crease }, ctx);
    const words = refusalWords(code);
    const who = [names.striker && `Faced by ${names.striker}`, names.nonStriker && `${names.nonStriker} at the other end`,
      names.bowler && `bowled by ${names.bowler}`].filter(Boolean).join(", ");
    return (
      <Sheet title="Short run" onClose={onClose}>
        <div data-testid="short-run-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.lg }}>
          <p style={body()}>
            The umpire called deliberate short running. The delivery counts, with no runs. The batters go back to the ends
            they started from. Five penalty runs go to {fielding}.
          </p>
          <section aria-label="What was the delivery?">
            <h3 style={label()}>What was the delivery?</h3>
            <div role="radiogroup" aria-label="What was the delivery?" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: T.space.sm }}>
              {DELIVERIES.map((d) => (
                <button key={d.type} type="button" role="radio" aria-checked={delivery === d.type}
                  data-testid={`short-run-type-${d.type}`} onClick={() => setDelivery(d.type)} className="pressBtn os-state"
                  style={{ ...choice(delivery === d.type), justifyContent: "center", textAlign: "center" }}>
                  {d.label}
                </button>
              ))}
            </div>
            {delivery !== "run" && (
              <p style={{ ...body(), fontSize: "14px", marginTop: T.space.sm }}>
                The one run for a {delivery === "Nb" ? "no ball" : "wide"} still counts.
              </p>
            )}
          </section>
          {who && <p data-testid="short-run-crease" style={body()}>{who}.</p>}
          <p style={{ ...body(), color: T.content.primary }}>{whereTheRunsGo(innings, curIn, false)}</p>
          <Refusal id={refusalId} words={words}/>
          <button type="button" data-testid="short-run-confirm" disabled={!!code}
            aria-describedby={code ? refusalId : undefined}
            onClick={() => { if (!code) onShortRun(delivery); }} className="os-state" style={commit(!code)}>
            Record the ball and 5 to {fielding}
          </button>
          {mode === "award" && (
            <button type="button" data-testid="penalty-back" onClick={() => setView("award")} className="pressBtn os-state"
              style={{ ...choice(false), justifyContent: "center", background: "transparent" }}>
              Back to penalty runs
            </button>
          )}
          {pendingLines}
          {reportLine}
        </div>
      </Sheet>
    );
  }

  // ── An award ────────────────────────────────────────────────
  const reasons = side == null ? [] : reasonsFor(side);
  const code = side != null && reason != null ? awardRefusal(match, curIn, { toBattingTeam: side, reason }) : null;
  const words = refusalWords(code);
  const ready = side != null && reason != null && !code;
  const hint = side == null ? "Choose who gets the five runs." : reason == null ? "Choose what the runs are for." : null;
  const pick = (s) => { if (s !== side) { setSide(s); setReason(null); } };
  const to = side == null ? null : side ? batting : fielding;

  return (
    <Sheet title="Penalty runs" onClose={onClose}>
      <div data-testid="penalty-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.lg }}>
        <p style={body()}>Five runs, awarded by the umpires.</p>
        <section aria-label="Who gets the five runs?">
          <h3 style={label()}>Who gets the five runs?</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: T.space.sm }}>
            {[[true, "Batting side", batting, "batting"], [false, "Fielding side", fielding, "fielding"]].map(([val, what, name, id]) => (
              <button key={id} type="button" data-testid={`penalty-side-${id}`} aria-pressed={side === val}
                onClick={() => pick(val)} className="pressBtn os-state"
                style={{ ...choice(side === val), minHeight: "64px", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: "2px" }}>
                <span style={{ fontSize: "16px", fontWeight: 600 }}>{what}</span>
                <span style={{ fontSize: "15px", fontWeight: 500, color: T.content.secondary, maxWidth: "100%",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
              </button>
            ))}
          </div>
          {side != null && <p data-testid="penalty-where" style={{ ...body(), color: T.content.primary, marginTop: T.space.sm }}>{whereTheRunsGo(innings, curIn, side)}</p>}
        </section>

        {side != null && (
          <section aria-label="What for?">
            <h3 style={label()}>What for?</h3>
            <div data-testid="penalty-reasons" style={{ display: "grid", gap: T.space.xs }}>
              {side === false && (
                <button type="button" data-testid="penalty-short-run" onClick={() => setView("shortRun")} className="pressBtn os-state"
                  style={{ ...choice(false), background: T.surface.base, border: `1px dashed ${T.line.strong}` }}>
                  <span style={{ flex: 1 }}>Short run: the umpire gave five to the fielding side</span>
                  <span aria-hidden="true" style={{ color: T.content.secondary }}>›</span>
                </button>
              )}
              {reasons.map((r) => (
                <button key={r} type="button" data-testid={`penalty-reason-${r}`} aria-pressed={reason === r}
                  onClick={() => setReason(r)} className="pressBtn os-state" style={choice(reason === r)}>
                  <span style={{ flex: 1 }}>{reasonWords(r)}</span>
                  {reason === r && <span aria-hidden="true"><Icon name="circle-check"/></span>}
                </button>
              ))}
            </div>
          </section>
        )}

        <Refusal id={refusalId} words={words}/>
        <div style={{ display: "grid", gap: T.space.sm }}>
          <button type="button" data-testid="penalty-award" disabled={!ready}
            aria-describedby={code ? refusalId : hint ? hintId : undefined}
            onClick={() => { if (ready) onAward({ toBattingTeam: /** @type {boolean} */ (side), reason: /** @type {string} */ (reason) }); }}
            className="os-state" style={commit(ready)}>
            {to ? `Award 5 to ${to}` : "Award 5 penalty runs"}
          </button>
          <Hint id={hintId} words={hint}/>
        </div>
        {pendingLines}
        {reportLine}
      </div>
    </Sheet>
  );
}

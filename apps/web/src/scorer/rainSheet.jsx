import { useState } from "react";
import { T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { Sheet } from "./ui.jsx";
import { STOP_REASON, fmtOvers } from "@scrbrd/scoring";

/**
 * RAIN ON THE PAD (SCRBRD-130 R1; docs/design/SCRBRD-130_rain_and_par.md §1, §2.5).
 *
 * Three sheets and a banner, and nothing about DLS is decided here: the
 * figures are the umpires', typed as they announce them (D1). Where the
 * server's calculator has a proposal (R2) it is shown beside the field, and
 * offline there is none — the pad says so and the sheet works without it (D6).
 *
 *   StopSheet     "Play stopped": why (rain, bad light, a wet ground, other)
 *                 and, if the scorer wants, a note for the school's record
 *                 (never public). One tap and play is stopped: the position
 *                 is the log's, never typed.
 *   RainBanner    while stopped: "Play stopped (rain) at 12.3 ov, 87/3, 14:32",
 *                 Resume and End innings (rain). The ball keys are off: the one
 *                 place the pad greys out, because the Law refuses the ball.
 *   ResumeSheet   "Overs now" (the allotment in force), and in the chase
 *                 "Target now" (blank: the umpires' figure). Writes the
 *                 umpires' revision only when a figure changed, then the
 *                 resumption.
 *   RainEndSheet  The innings cut short: in the chase "Par score announced by
 *                 the umpires" (writes revision.par), then the seal, abandoned.
 *
 * Floors (DESIGN_DIRECTION §3.2, §3.5): nothing read under 12px, nothing
 * tapped under 44px; tokens read from T while it draws. No Law clause numbers.
 */

const label = () => ({ ...T.role.label, color: T.content.secondary, margin: 0 });
const body = () => ({ fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.4, color: T.content.secondary, margin: 0 });
const field = () => ({
  width: "100%", minHeight: "48px", boxSizing: /** @type {const} */ ("border-box"), padding: `0 ${T.space.md}`, borderRadius: T.radius.md,
  border: `1px solid ${T.line.normal}`, background: T.surface.interactive, color: T.content.primary,
  fontFamily: T.type.mono, fontSize: "18px",
});
const chip = (/** @type {boolean} */ on) => ({
  minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.pill, cursor: "pointer",
  fontFamily: T.type.body, fontSize: "14px", fontWeight: on ? 600 : 500, color: T.content.primary,
  background: on ? T.surface.raised : T.surface.interactive, border: `${on ? 2 : 1}px solid ${on ? T.content.primary : T.line.normal}`,
});
const primary = (/** @type {boolean} */ ok) => ({
  width: "100%", minHeight: "48px", borderRadius: T.radius.md, cursor: ok ? "pointer" : "not-allowed", opacity: ok ? 1 : 0.6,
  border: "none", background: T.content.primary, color: T.surface.base,
  fontFamily: T.type.body, fontSize: "16px", fontWeight: 700,
});
const secondary = () => ({
  minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.md, cursor: "pointer",
  border: `1px solid ${T.line.strong}`, background: T.surface.interactive, color: T.content.primary,
  fontFamily: T.type.body, fontSize: "15px", fontWeight: 600, flexShrink: 0,
});

/** The stop's reasons, as the scorer picks them. */
export const STOP_CHOICES = Object.freeze([
  { id: STOP_REASON.RAIN, label: "Rain" },
  { id: STOP_REASON.BAD_LIGHT, label: "Bad light" },
  { id: STOP_REASON.WET_GROUND, label: "Wet ground" },
  { id: STOP_REASON.OTHER, label: "Other" },
]);
/** @type {Record<string, string>} */
const REASON_WORDS = { rain: "rain", bad_light: "bad light", wet_ground: "wet ground", other: "stopped" };

/** A whole number from a field, or null. @param {string} s */
const whole = (s) => (/^\s*\d{1,4}\s*$/.test(s) ? parseInt(s, 10) : null);

/** "14:32", the device's clock, for the banner. @param {number | null | undefined} at */
export const clockOf = (at) => {
  if (typeof at !== "number") return null;
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * The banner's words: "Play stopped (rain) at 12.3 ov, 87/3, 14:32".
 * @param {{reason: string, balls: number, runs: number, wickets: number, at: number | null} | null | undefined} stopped
 */
export function stoppedWords(stopped) {
  if (!stopped) return null;
  const why = REASON_WORDS[stopped.reason] ?? "stopped";
  const when = clockOf(stopped.at);
  return `Play stopped (${why}) at ${fmtOvers(stopped.balls)} ov, ${stopped.runs}/${stopped.wickets}${when ? `, ${when}` : ""}`;
}

/**
 * The calculator's word beside a figure (R2), or what the pad says without one.
 * @param {{proposal?: string | null, offline?: boolean}} p
 */
function Proposal({ proposal, offline }) {
  const text = offline ? "No DLS calculation offline: enter the umpires' figure."
    : proposal ?? null;
  if (!text) return null;
  return <p data-testid="rain-proposal" style={{ ...body(), fontSize: "13px" }}>{text}</p>;
}

/**
 * "Play stopped": why, and a note for the record.
 * @param {{onConfirm: (o: {reason: string, note: string | null}) => void, onClose: () => void}} p
 */
export function StopSheet({ onConfirm, onClose }) {
  useTheme();
  const [reason, setReason] = useState(/** @type {string} */ (STOP_REASON.RAIN));
  const [note, setNote] = useState("");
  return (
    <Sheet title="Play stopped" onClose={onClose}>
      <div data-testid="stop-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.md }}>
        <p style={body()}>No ball is recorded until play resumes. Where play stopped is read from the scorebook.</p>
        <div>
          <p style={{ ...label(), marginBottom: T.space.xs }} id="stop-why">Why</p>
          <div role="radiogroup" aria-labelledby="stop-why" style={{ display: "flex", flexWrap: "wrap", gap: T.space.xs }}>
            {STOP_CHOICES.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={reason === c.id} data-testid={`stop-reason-${c.id}`}
                onClick={() => setReason(c.id)} className="pressBtn os-state" style={chip(reason === c.id)}>{c.label}</button>
            ))}
          </div>
        </div>
        <label style={{ display: "grid", gap: T.space.xs }}>
          <span style={label()}>Note (optional, for the school's record only)</span>
          <input data-testid="stop-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140}
            style={{ ...field(), fontFamily: T.type.body, fontSize: "15px" }}/>
        </label>
        <button type="button" data-testid="stop-confirm" className="pressBtn os-state" style={primary(true)}
          onClick={() => onConfirm({ reason, note: note.trim() || null })}>
          Stop play
        </button>
      </div>
    </Sheet>
  );
}

/**
 * While play is stopped: where, and the two ways on.
 * @param {{stopped: {reason: string, balls: number, runs: number, wickets: number, at: number | null}, isChase: boolean,
 *          onResume: () => void, onEnd: () => void}} p
 */
export function RainBanner({ stopped, isChase, onResume, onEnd }) {
  useTheme();
  return (
    <div role="status" aria-live="polite" data-testid="rain-banner"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: `${T.space.sm} ${T.space.md}`, marginBottom: T.space.md,
        padding: T.space.md, borderRadius: T.radius.md, border: `2px solid ${T.semantic.warning}`, background: T.surface.raised }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <p data-testid="rain-banner-words" style={{ margin: 0, fontFamily: T.type.body, fontSize: "15px", fontWeight: 600, color: T.content.primary }}>
          {stoppedWords(stopped)}
        </p>
        <p style={{ ...body(), fontSize: "13px" }}>
          {isChase ? "Resume with the umpires' overs and target, or end the innings with their par score."
            : "Resume with the umpires' overs, or end the innings if play cannot resume."}
        </p>
      </div>
      <div style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap" }}>
        <button type="button" data-testid="rain-resume" className="pressBtn os-state"
          style={{ ...secondary(), background: T.content.primary, color: T.surface.base, border: "none" }} onClick={onResume}>Resume</button>
        <button type="button" data-testid="rain-end" className="pressBtn os-state" style={secondary()} onClick={onEnd}>End innings (rain)</button>
      </div>
    </div>
  );
}

/**
 * Resume: the overs now, and in the chase the target now.
 * @param {{overs: number, minOvers: number, isChase: boolean, target: number | null, proposal?: string | null, offline?: boolean,
 *          onConfirm: (o: {overs: number | null, target: number | null}) => void, onClose: () => void}} p
 *   `overs`: the allotment in force; `minOvers`: the whole overs the over in progress needs (the Law's floor)
 */
export function ResumeSheet({ overs, minOvers, isChase, target, proposal = null, offline = false, onConfirm, onClose }) {
  useTheme();
  const [ov, setOv] = useState(String(overs));
  const [tg, setTg] = useState("");
  const o = whole(ov), t = tg.trim() === "" ? null : whole(tg);
  const ok = o != null && o >= Math.max(1, minOvers) && (tg.trim() === "" || (t != null && t >= 1));
  const changed = o !== overs || t != null;
  return (
    <Sheet title="Resume play" onClose={onClose}>
      <div data-testid="resume-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.md }}>
        <label style={{ display: "grid", gap: T.space.xs }}>
          <span style={label()}>Overs now (was {overs})</span>
          <input data-testid="resume-overs" inputMode="numeric" value={ov} onChange={(e) => setOv(e.target.value)} style={field()}
            aria-describedby="resume-overs-floor"/>
          <span id="resume-overs-floor" style={{ ...body(), fontSize: "12px" }}>At least {Math.max(1, minOvers)}: the overs already bowled, counting the one in progress.</span>
        </label>
        {isChase && (
          <label style={{ display: "grid", gap: T.space.xs }}>
            <span style={label()}>Target now{target != null ? ` (was ${target})` : ""}</span>
            <input data-testid="resume-target" inputMode="numeric" value={tg} onChange={(e) => setTg(e.target.value)} style={field()}
              placeholder="the umpires' figure"/>
          </label>
        )}
        <Proposal proposal={proposal} offline={offline}/>
        <button type="button" data-testid="resume-confirm" disabled={!ok} className="pressBtn os-state" style={primary(ok)}
          onClick={() => ok && onConfirm({ overs: o !== overs ? o : null, target: t })}>
          {!changed ? "Resume play" : t != null ? `Resume: ${o} overs, target ${t}` : `Resume: ${o} overs`}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The innings cut short. In the chase, the umpires' par.
 * @param {{isChase: boolean, runs: number, wickets: number, balls: number, proposal?: string | null, offline?: boolean,
 *          onConfirm: (o: {par: number | null}) => void, onClose: () => void}} p
 */
export function RainEndSheet({ isChase, runs, wickets, balls, proposal = null, offline = false, onConfirm, onClose }) {
  useTheme();
  const [par, setPar] = useState("");
  const p = par.trim() === "" ? null : whole(par);
  const ok = par.trim() === "" || p != null;
  return (
    <Sheet title="End the innings (rain)" onClose={onClose}>
      <div data-testid="rain-end-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.md }}>
        <p data-testid="rain-end-figures" style={{ ...body(), color: T.content.primary, fontSize: "15px" }}>
          The innings closes at {runs}/{wickets} after {fmtOvers(balls)} overs.
        </p>
        {isChase && (
          <label style={{ display: "grid", gap: T.space.xs }}>
            <span style={label()}>Par score announced by the umpires</span>
            <input data-testid="rain-par" inputMode="numeric" value={par} onChange={(e) => setPar(e.target.value)} style={field()}
              placeholder="the umpires' figure"/>
            <span style={{ ...body(), fontSize: "12px" }}>With a par the match is decided on it; with none it is no result.</span>
          </label>
        )}
        {isChase && <Proposal proposal={proposal} offline={offline}/>}
        <button type="button" data-testid="rain-end-confirm" disabled={!ok} className="pressBtn os-state" style={primary(ok)}
          onClick={() => ok && onConfirm({ par: p })}>
          {isChase && p != null ? `End the innings, par ${p}` : "End the innings"}
        </button>
      </div>
    </Sheet>
  );
}

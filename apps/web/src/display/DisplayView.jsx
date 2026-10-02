import { useEffect, useMemo, useRef, useState } from "react";
import { T, GLOBAL_CSS } from "../design/tokens.js";
import { Figure, INSIGHT_MS } from "../ui/board.jsx";
import { boardInsights } from "../scorer/signals.js";
import { teamOf, sidesOf } from "../lib/matchCentre.js";
import { MomentMark, OverSummary } from "../views/matchcentre/spectator.jsx";
import { useArrivals, useMoments, useTicker } from "../views/matchcentre/live.js";
import { DAYLIGHT_DIM, boardOf, clockAt, displayState } from "./data.js";
import { Chips, DisplayPanel } from "./panels.jsx";
import { useRotation } from "./Rotation.jsx";
import { FOW_MS } from "./rotation.js";

/**
 * THE GROUND DISPLAY (SCRBRD-133 G1): the Board, edge to edge and black, as a
 * fixed band; beneath it one panel at a time (display/rotation.js); a moment
 * in the Board's corner, never over the total. One component, two feeds (D11):
 *
 *   /display/:match         the public projection (display/PublicDisplay.jsx):
 *                           signed in as nothing, names by the server's rule
 *                           (D1, D3), nothing on it pressed
 *   the Match Centre's      the signed-in fold and names (views/matchcentre/
 *   Big screen              bigscreen.jsx), with its Exit button and Escape,
 *                           and Space to pause the rotation
 *
 * It reads nothing itself: what it is given is all it can show. No sponsor
 * (D13), no broadcast_state() (083 §5.2), no retirement card and no reason
 * (D8), no pressure figure (D4).
 *
 * SIZES (§2.6): every one is max(floor, vmin) — the 12px floor is the max()'s
 * first argument everywhere, so a phone in portrait never goes under it and a
 * 1080p TV reads from the boundary. THE THREE LAYOUTS are the same markup:
 * 16:9 (the total beside the team, the overs and the second line), 4:3 (the
 * same, the rows wrapping rather than shrinking), portrait (the Board stacks).
 *
 * SETTINGS (D14, the URL's): Daylight lifts board.dim one step, rules the
 * Board's rows at 2px and thickens the chips' outlines — the board's black,
 * white and lime do not move. Long dwell is 24 s a panel. Reduce motion sets
 * `data-reduce-motion` on the root, which GLOBAL_CSS turns into cuts.
 */

/** The display's sheet — a function, so the tokens are read at render, never at import (tokens.js's rule). */
const sheet = () => `
.dv-root{position:fixed;inset:0;z-index:3000;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;
  background:var(--dv-face);color:var(--dv-figure);font-family:${T.type.mono};font-variant-numeric:tabular-nums;
  padding:max(12px,2.4vmin) max(16px,3.2vmin);gap:max(8px,1.6vmin);font-size:max(12px,2.2vmin)}
.dv-root[data-public="true"]{cursor:none;user-select:none;-webkit-user-select:none}
.dv-root *{box-sizing:border-box}
.dv-board{position:relative;flex:0 0 auto;display:grid;gap:max(4px,0.8vmin);transition:opacity 1100ms ${T.motion.ease}}
.dv-top{display:flex;align-items:flex-end;justify-content:space-between;gap:max(8px,2vmin);min-width:0}
.dv-left{display:grid;gap:max(2px,0.6vmin);min-width:0}
.dv-team{font-family:${T.type.body};font-weight:700;font-size:max(14px,3.2vmin);line-height:1.15;letter-spacing:.04em;text-transform:uppercase;color:var(--dv-figure);overflow-wrap:anywhere}
.dv-overs{font-size:max(32px,10vmin);line-height:1}
.dv-overs small{font-family:${T.type.body};font-size:max(12px,2.4vmin);color:var(--dv-dim);margin-left:max(4px,1vmin)}
.dv-sub{font-family:${T.type.body};font-size:max(20px,6vmin);line-height:1.12;color:var(--dv-lime);overflow-wrap:anywhere}
.dv-total{font-size:max(56px,26vmin);line-height:.92;font-weight:500;white-space:nowrap}
.dv-total .dv-slash{color:var(--dv-dim)}
.dv-row{display:flex;flex-wrap:wrap;align-items:center;gap:max(4px,0.8vmin) max(12px,3vmin);border-top:var(--dv-rule-w) solid var(--dv-rule);padding-top:max(4px,0.8vmin)}
.dv-batters{font-size:max(16px,4.4vmin)}
.dv-batter{white-space:nowrap}
.dv-batter[data-on-strike="false"]{color:var(--dv-dim)}
.dv-mark{color:transparent;margin-right:.3em}
.dv-batter[data-on-strike="true"] .dv-mark{color:var(--dv-lime)}
.dv-bowlrow{font-size:max(16px,3.6vmin);justify-content:space-between}
.dv-name{font-family:${T.type.body};font-weight:600}
.dv-dim{color:var(--dv-dim)}
.dv-fig{font-family:${T.type.mono};font-variant-numeric:tabular-nums}
.dv-chips{display:inline-flex;flex-wrap:wrap;gap:max(4px,0.8vmin);align-items:center}
.dv-chip{display:inline-flex;align-items:center;justify-content:center;min-width:1.7em;height:1.7em;padding:0 .3em;border-radius:999px;
  font-family:${T.type.mono};font-size:max(14px,0.85em);line-height:1;white-space:nowrap;border:var(--dv-chip-w) solid transparent}
.dv-chip[data-shape="square"]{border-radius:${T.radius.sm}}
.dv-chip[data-chip="dot"]{color:var(--dv-dim)}
.dv-chip[data-chip="extra"]{border-color:var(--dv-chip-edge)}
.dv-tag{font-family:${T.type.body};font-weight:700;font-size:max(12px,2.4vmin);border:var(--dv-chip-w) solid var(--dv-lime);color:var(--dv-lime);border-radius:999px;padding:0 .6em}
.dv-insight{font-family:${T.type.body};font-size:max(12px,2.4vmin);line-height:1.3;color:var(--dv-figure);border-top:var(--dv-rule-w) solid var(--dv-rule);padding-top:max(4px,0.8vmin);margin:0}
.dv-panel{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;border-top:var(--dv-rule-w) solid var(--dv-rule);padding-top:max(8px,1.6vmin);transition:opacity 1100ms ${T.motion.ease}}
.dv-panel section{display:grid;gap:max(4px,1vmin);align-content:start}
.dv-panel p{margin:0}
.dv-title{display:block;font-family:${T.type.body};font-weight:700;font-size:max(14px,3.2vmin);line-height:1.2;letter-spacing:.06em;text-transform:uppercase;color:var(--dv-dim);margin:0}
.dv-text{font-size:max(16px,3.6vmin);line-height:1.3}
.dv-small{font-size:max(12px,2.4vmin);line-height:1.3}
.dv-list{list-style:none;margin:0;padding:0;display:grid;gap:max(4px,0.8vmin)}
.dv-over{display:flex;flex-wrap:wrap;align-items:center;gap:max(4px,0.8vmin) max(10px,2vmin);color:var(--dv-dim)}
.dv-over[data-lit="true"]{color:var(--dv-figure)}
.dv-over-no{min-width:2ch;text-align:right}
.dv-score{margin-left:auto}
.dv-grid2{display:grid;grid-template-columns:1fr 1fr;gap:max(6px,1.2vmin) max(12px,3vmin)}
.dv-share{display:grid;grid-template-columns:minmax(0,max-content) minmax(40px,1fr) max-content;align-items:center;gap:max(6px,1.2vmin)}
li.dv-share{grid-template-columns:3ch minmax(40px,1fr) max-content minmax(0,1.4fr)}
.dv-bar{display:block;height:max(8px,1.6vmin);background:var(--dv-rule);border-radius:999px;overflow:hidden}
.dv-bar>span{display:block;height:100%;background:var(--dv-lime);border-radius:999px}
.dv-table{border-collapse:collapse;width:100%}
.dv-table th,.dv-table td{text-align:right;padding:max(2px,0.4vmin) max(6px,1.2vmin);border-top:var(--dv-rule-w) solid var(--dv-rule);font-weight:400}
.dv-table th[scope="row"],.dv-table thead th:first-child{text-align:left;font-family:${T.type.body};font-weight:600}
.dv-table thead th{color:var(--dv-dim);border-top:none}
.dv-fact{display:grid;gap:max(2px,0.4vmin)}
.dv-factrow{display:flex;justify-content:space-between;gap:max(8px,1.6vmin)}
.dv-dl{margin:0;display:grid;gap:max(4px,0.8vmin)}
.dv-dl>div{display:flex;gap:max(8px,2vmin)}
.dv-dl dd{margin:0}
.dv-stale{position:absolute;right:max(16px,3.2vmin);bottom:max(8px,1.6vmin);font-family:${T.type.body};font-size:max(12px,2.4vmin);color:var(--dv-dim);background:var(--dv-face);padding:0 .4em}
.dv-gone{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:max(16px,4vmin);
  background:var(--dv-face);font-family:${T.type.body};font-size:max(20px,6vmin);color:var(--dv-figure)}
.dv-exit{position:absolute;top:max(8px,1.6vmin);right:max(8px,1.6vmin);z-index:3;min-height:48px;padding:0 ${T.space.lg};border-radius:999px;
  border:1px solid var(--dv-rule);background:var(--dv-face);color:var(--dv-figure);font-family:${T.type.body};font-size:16px;font-weight:600;cursor:pointer}
.dv-root[data-sleeping="true"] .dv-board{opacity:.4}
@keyframes dvPanelIn{from{opacity:0}to{opacity:1}}
.os-panel-in{animation:dvPanelIn ${T.motion.panel} ${T.motion.ease} both}
/* 4:3 — a projector: the same bands; the Board's rows wrap rather than shrink (flex-wrap above). */
/* Portrait — a phone on a stand, a rotated monitor: the Board stacks. */
@media (orientation: portrait){
  .dv-top{flex-direction:column;align-items:flex-start}
  .dv-batters{flex-direction:column;align-items:flex-start}
  .dv-grid2{grid-template-columns:1fr}
  li.dv-share{grid-template-columns:3ch minmax(40px,1fr) max-content}
  li.dv-share .dv-name{grid-column:1 / -1}
}
`;

/** The Tier 2 line, taking its 8 s turn — with no pause button: nothing on the ground display is pressed. */
function DisplayInsight({ lines, paused }) {
  const [turn, setTurn] = useState(0);
  const n = lines.length;
  useEffect(() => {
    if (n < 2 || paused) return undefined;
    const t = setInterval(() => setTurn((x) => x + 1), INSIGHT_MS);
    return () => clearInterval(t);
  }, [n, paused]);
  if (!n) return null;
  const at = turn % n;
  return <p key={at} className={`dv-insight${n > 1 ? " os-insight-in" : ""}`} data-testid="display-insight">{lines[at]}</p>;
}

/** The Board band (§2.2 B): team, total, overs, the second line, the pair, the stand, the bowler, this over. */
function DisplayBoard({ match, state, shownRuns, moment, overSummary, paused, announce, tp }) {
  const props = boardOf(state);
  if (!props) {
    const sides = sidesOf(match);
    return (
      <div className="dv-board" data-testid="display-board">
        <div className="dv-team">{sides.home.full} v {sides.away.full}</div>
        <p className="dv-sub" style={{ margin: 0 }}>The board opens with the first ball.</p>
      </div>
    );
  }
  const side = teamOf(match, state.inn.battingTeam);
  const insight = boardInsights(state.inn, { target: state.target, overs: state.overs });
  const marked = props.batters.some((b) => b.onStrike);
  return (
    <div className="dv-board" data-testid="display-board" aria-label={`Scoreboard: ${side.full}, ${props.total} for ${props.wickets}, ${props.overs} overs`}>
      <MomentMark moment={moment} big announce={announce}/>
      <div className="dv-top">
        <div className="dv-left">
          <div className="dv-team" data-testid="display-team">{side.full}</div>
          <div className="dv-overs"><Figure value={props.overs} testid="display-overs"/><small>overs</small></div>
          {props.sub && <div className="dv-sub" data-testid={`${tp}-sub`}>{props.sub}</div>}
        </div>
        <div className="dv-total" data-testid={`${tp}-total`}>
          <Figure value={shownRuns ?? props.total}/><span className="dv-slash">/</span><Figure value={props.wickets}/>
        </div>
      </div>
      {(props.batters.length > 0 || props.partnership) && (
        <div className="dv-row dv-batters">
          {props.batters.map((b) => (
            <span key={b.name} className="dv-batter" data-testid="display-batter" data-on-strike={!marked || b.onStrike ? "true" : "false"}>
              <span className="dv-mark" aria-hidden="true">●</span>
              {b.onStrike && <span className="sr-only">on strike: </span>}
              <span className="dv-name">{b.name}</span> <Figure value={b.runs ?? 0}/><span className="dv-dim"> ({b.balls})</span>
            </span>
          ))}
          {props.partnership && (
            <span className="dv-batter" data-testid="display-partnership"><span className="dv-name dv-dim">Partnership</span> <Figure value={props.partnership.runs}/>
              <span className="dv-dim"> ({props.partnership.balls})</span></span>
          )}
        </div>
      )}
      {(props.bowler || props.thisOver.length > 0) && (
        <div className="dv-row dv-bowlrow">
          {props.bowler && (
            <span className="dv-batter" data-testid="display-bowler"><span className="dv-name">{props.bowler.name}</span> <Figure value={`${props.bowler.wickets}/${props.bowler.runs}`}/>
              <span className="dv-dim"> ({props.bowler.overs})</span></span>
          )}
          <span className="dv-chips">
            <Chips marks={props.thisOver} label="This over"/>
            {state.inn.freeHit && <span className="dv-tag" data-testid="display-free-hit">Free hit</span>}
          </span>
        </div>
      )}
      {insight.length > 0 && <DisplayInsight lines={insight} paused={paused}/>}
      <OverSummary item={overSummary} big announce={announce}/>
    </div>
  );
}

/** More than this many new lines in one read is a gap (the TV slept, §4.4): no interrupt for what is minutes old. */
const GAP = 6;

/**
 * @param {object} p
 * @param {any} p.match            asPublicMatch()'s or the Match Centre's fixture
 * @param {any[]} p.events         the log as folded (the fold's own input)
 * @param {any} p.fold             the fold context
 * @param {any[]} p.innings        the fold's innings, played
 * @param {string | null} p.result the result as the page says it
 * @param {boolean} p.settled      play has decided it
 * @param {any[]} p.commentary     the shared generator's lines
 * @param {boolean} p.ready        the first read is in (arrivals before it are not moments)
 * @param {{theme: string, dwell: "normal" | "long", reduceMotion: boolean}} p.settings
 * @param {{stale?: boolean, okAt?: number | null, gone?: boolean, sleeping?: boolean}} [p.status]
 * @param {(() => void) | null} [p.onClose]  the signed-in big screen's way out; none on the ground display
 * @param {boolean} [p.paused]     the signed-in big screen's Space
 */
export function DisplayView({ match, events, fold, innings, result, settled, commentary, ready, settings, status = {}, onClose = null, paused = false }) {
  const state = useMemo(() => displayState({ match, innings, settled }), [match, innings, settled]);
  // The result, as one moment, only once play has decided it — through the
  // same "only while the page is open" gate as every other (MatchView's line).
  const feed = useMemo(() => (settled && result && commentary.length
    ? [...commentary, { innings: Math.max(0, state.played.length - 1), over: 0, ball: 0, kind: "result", text: result, key: `result:${match.id}` }]
    : commentary), [commentary, settled, result, match.id, state.played.length]);
  const { moment, overSummary } = useMoments(feed, ready);
  const shownRuns = useTicker(state.inn?.runs, `${match.id}:${state.index}`);
  const { panel, interrupt } = useRotation({ available: state.available, hold: state.hold, dwell: settings.dwell, paused: paused || !!status.sleeping });

  // A wicket cuts to its fall for eight seconds, then the cycle resumes
  // where it was (§2.4). A gap — the TV asleep — interrupts nothing.
  const arrived = useArrivals(commentary, ready);
  useEffect(() => {
    if (!arrived.n || arrived.items.length > GAP) return;
    if (arrived.items.some((i) => i.kind === "wicket")) interrupt("fow", FOW_MS);
  }, [arrived, interrupt]);

  const daylight = settings.theme === "daylight";
  const vars = {
    "--dv-face": T.board.face, "--dv-figure": T.board.figure, "--dv-lime": T.board.lime,
    "--dv-dim": daylight ? DAYLIGHT_DIM : T.board.dim, "--dv-rule": daylight ? "rgba(255,255,255,0.28)" : T.board.rule,
    "--dv-rule-w": daylight ? "2px" : "1px", "--dv-chip-w": daylight ? "2px" : "1px",
    "--dv-chip-edge": daylight ? T.board.figure : "transparent",
  };
  const announce = !!onClose;   // the ground display has no reader; the signed-in big screen's moments are said, as before
  return (
    <div className="dv-root" data-testid={onClose ? "mc-bigscreen" : "display"} data-public={onClose ? "false" : "true"}
      data-panel={panel ?? "none"} data-hold={state.hold ?? ""} data-theme-display={settings.theme} data-dwell={settings.dwell}
      data-sleeping={status.sleeping ? "true" : "false"} data-stale={status.stale ? "true" : "false"} data-paused={paused ? "true" : "false"}
      {...(onClose ? { role: "dialog", "aria-modal": "true", "aria-label": "Big screen: the scoreboard" } : { role: "main", "aria-label": "Ground display" })}
      style={vars}>
      <style>{sheet()}</style>
      {onClose && <ExitButton onClose={onClose}/>}
      <DisplayBoard match={match} state={state} shownRuns={shownRuns} moment={status.sleeping ? null : moment}
        overSummary={status.sleeping ? null : overSummary} paused={paused || !!status.sleeping} announce={announce}
        tp={onClose ? "mc-bigscreen" : "display"}/>
      <div className="dv-panel" data-testid="display-panel">
        {panel && (
          <div key={panel} className="os-panel-in">
            <DisplayPanel panel={panel} match={match} played={state.played} inn={state.inn} index={state.index}
              events={events} fold={fold} result={result} commentary={commentary}/>
          </div>
        )}
      </div>
      {status.stale && !status.gone && (
        <p className="dv-stale" data-testid="display-stale">Last updated {clockAt(status.okAt ?? null) ?? "earlier"} · reconnecting</p>
      )}
      {status.gone && <div className="dv-gone" data-testid="display-gone">This display is no longer available.</div>}
    </div>
  );
}

/** The signed-in big screen's labelled way out (Escape does the same). */
function ExitButton({ onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <button ref={ref} type="button" className="dv-exit pressBtn" onClick={onClose} data-testid="mc-bigscreen-close">Exit big screen</button>;
}

/**
 * A screen at a ground must not go dark mid-over: a screen wake lock where the
 * browser has one (and allows it), and the board simply carries on where it
 * does not. Re-asked when the page comes back into view.
 * @param {boolean} on
 */
export function useWakeLock(on = true) {
  useEffect(() => {
    if (!on) return undefined;
    /** @type {any} */
    let lock = null, alive = true;
    const ask = async () => {
      try {
        const nav = /** @type {any} */ (navigator);
        if (!alive || document.visibilityState !== "visible" || !nav.wakeLock) return;
        const got = await nav.wakeLock.request("screen");
        if (alive) lock = got; else got.release().catch(() => {});
      } catch { lock = null; }
    };
    const onVis = () => { if (document.visibilityState === "visible") ask(); };
    ask();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release?.().catch(() => {});
    };
  }, [on]);
}

/** The global sheet the display needs (tokens' reduced-motion block included). */
export const DisplayGlobals = () => <style>{GLOBAL_CSS}</style>;

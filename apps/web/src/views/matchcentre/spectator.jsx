import { useEffect, useRef } from "react";
import { T, contrast } from "../../design/tokens.js";
import { Figure, chipFill, chipFor } from "../../ui/board.jsx";
import { boardFromInnings } from "../../scorer/boardData.js";
import { teamOf } from "../../lib/matchCentre.js";
import { Icon } from "../../ui/icons.jsx";
import { SideName } from "./bits.jsx";

/**
 * The spectator's side of the Match Centre (Kameel's premium-feel checklist):
 * a moment on the board for a four, a six, a wicket and a milestone; a gentle
 * over summary between overs; the highlights, in order; and the board on a big
 * screen at the ground. Spectator surfaces only — the pad is built for speed
 * and trust and has none of it.
 */

/** The black or the white of the board, whichever reads better on a fill. */
const inkFor = (fill) => (contrast(fill, T.board.face) >= contrast(fill, T.board.figure) ? T.board.face : T.board.figure);

const BEAT_WORD = { four: "Four", six: "Six", wicket: "Wicket" };

/**
 * A moment, over the board's own left-hand corner — never over the total,
 * which stays where it is, and gone within a second and a half. A four, a six
 * or a wicket is a chip-coloured beat; a milestone is the board's lime, larger,
 * with its words. Reduced motion makes the entrance a cut (GLOBAL_CSS).
 */
export function MomentMark({ moment, big = false }) {
  if (!moment) return null;
  // The result — the match's own decided moment (SCRBRD-100 item 3) — reads
  // the same big, held slot a milestone does: never longer, never hiding the
  // score for more than about 1.5s (§3.6).
  const bigMark = moment.kind === "milestone" || moment.kind === "result";
  const fill = bigMark ? T.board.lime : moment.kind === "wicket" ? T.board.figure : chipFill(moment.kind);
  const ink = inkFor(fill);
  return (
    <div data-testid="mc-moment" data-kind={moment.kind} role="status" aria-live="polite"
      className={bigMark ? "mc-moment-big" : "mc-moment"}
      style={{ position: "absolute", top: big ? T.space.xl : T.space.sm, left: big ? T.space.xl : T.space.lg, zIndex: 2,
        maxWidth: bigMark ? "58%" : "none", padding: bigMark ? `${T.space.sm} ${T.space.lg}` : `${T.space.xs} ${T.space.md}`,
        borderRadius: bigMark ? T.radius.md : T.radius.pill, background: fill, color: ink, boxShadow: T.elevation.md,
        fontFamily: T.type.body, fontWeight: 700, lineHeight: 1.25,
        fontSize: big ? (bigMark ? "clamp(20px, 3.4vmin, 44px)" : "clamp(18px, 3vmin, 36px)") : (bigMark ? "16px" : "14px") }}>
      {bigMark ? moment.text : (BEAT_WORD[moment.kind] ?? moment.text)}
      {!bigMark && <span className="sr-only">: {moment.text}</span>}
    </div>
  );
}

/** "End of over 5: 9 runs. Hilton College 1XI 48/2." — the generator's own line, its first two sentences. */
export const overSummaryText = (item) => (item?.text ?? "").split(/(?<=\.)\s+/).slice(0, 2).join(" ");

/** The gentle over summary between overs: the generator's end-of-over line, for a few seconds. */
export function OverSummary({ item, big = false }) {
  if (!item) return null;
  return (
    <div data-testid="mc-over-summary" role="status" aria-live="polite" className="mc-moment"
      style={{ padding: big ? `${T.space.md} ${T.space.xl}` : `${T.space.sm} ${T.space.lg}`, borderRadius: T.radius.lg,
        background: big ? "transparent" : T.surface.raised, border: `1px solid ${big ? T.board.rule : T.line.normal}`,
        color: big ? T.board.figure : T.content.primary, fontFamily: T.type.body,
        fontSize: big ? "clamp(18px, 3vmin, 40px)" : "15px", lineHeight: 1.4 }}>
      {overSummaryText(item)}
    </div>
  );
}

/** One highlight: where it fell, its mark, its words. */
function Highlight({ item }) {
  const fill = item.kind === "milestone" ? T.board.lime : item.kind === "wicket" ? T.board.figure : chipFill(item.kind);
  const mark = item.kind === "four" ? "4" : item.kind === "six" ? "6" : item.kind === "wicket" ? "W" : <Icon name="sparkles" size={14}/>;
  return (
    <li data-testid="mc-highlight" data-kind={item.kind} data-key={item.key}
      style={{ display: "flex", gap: T.space.sm, alignItems: "flex-start", padding: `${T.space.sm} ${T.space.md}`, borderTop: `1px solid ${T.line.subtle}` }}>
      <span style={{ ...T.role.figure.sm, color: T.content.secondary, width: "40px", flexShrink: 0 }}>{item.over}.{item.ball}</span>
      <span aria-hidden="true" style={{ flexShrink: 0, width: "24px", height: "24px", borderRadius: T.radius.pill, display: "inline-flex",
        alignItems: "center", justifyContent: "center", background: fill, color: inkFor(fill), border: `1px solid ${T.line.strong}`,
        fontFamily: T.type.mono, fontSize: "13px", fontWeight: 500 }}>{mark}</span>
      <span style={{ ...T.role.body, color: T.content.primary, fontWeight: item.kind === "four" || item.kind === "six" ? 400 : 600, minWidth: 0 }}>{item.text}</span>
    </li>
  );
}

/** The kinds a highlight is. */
export const HIGHLIGHT_KINDS = new Set(["four", "six", "wicket", "milestone"]);

/** Every boundary, wicket and milestone of the match, in the order they came. */
export function Highlights({ match, innings, commentary }) {
  const items = commentary.filter((c) => HIGHLIGHT_KINDS.has(c.kind));
  if (!items.length) return null;
  const byInnings = [...new Set(items.map((i) => i.innings))];
  return (
    <section data-testid="mc-highlights" aria-label="Highlights"
      style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg, overflow: "hidden", background: T.surface.raised }}>
      <h2 style={{ ...T.role.label, color: T.content.secondary, margin: 0, padding: `${T.space.sm} ${T.space.md}`,
        borderBottom: `1px solid ${T.line.normal}`, display: "flex", gap: T.space.xs, alignItems: "center" }}>
        <Icon name="sparkles"/>Highlights
      </h2>
      {byInnings.map((n) => (
        <div key={n}>
          {byInnings.length > 1 && innings[n] && (
            <h3 style={{ ...T.role.label, color: T.content.secondary, margin: 0, padding: `${T.space.sm} ${T.space.md}`, background: T.surface.base }}>
              <SideName side={teamOf(match, innings[n].battingTeam)}/> innings
            </h3>
          )}
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.filter((i) => i.innings === n).map((i) => <Highlight key={i.key} item={i}/>)}
          </ol>
        </div>
      ))}
    </section>
  );
}

/**
 * BIG-SCREEN MODE: the board, full screen, legible from the boundary — the
 * board's own black, large tabular figures, nothing to press. It is fed by
 * the Match Centre's own live read (it refreshes itself), holds a screen wake
 * lock where the browser allows one (and carries on where it does not), and
 * leaves on Escape or its own labelled button. Signed in, like the rest of
 * the Match Centre.
 */
export function BigScreen({ match, inn, target, overs, shownRuns, moment, overSummary, line, onClose }) {
  const closeRef = useRef(null);
  // Held, not watched: the board re-renders on every live read, and the
  // lock and the focus are taken once, when it opens.
  const leave = useRef(onClose);
  leave.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); leave.current(); } };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    // A screen at a ground must not go dark mid-over. Where the browser has
    // no wake lock, or refuses one, the board simply carries on.
    let lock = null, alive = true;
    const ask = async () => {
      try {
        if (!alive || document.visibilityState !== "visible" || !navigator.wakeLock) return;
        const got = await navigator.wakeLock.request("screen");
        if (alive) lock = got; else got.release().catch(() => {});   // closed while it was asked for
      } catch { lock = null; }
    };
    const onVis = () => { if (document.visibilityState === "visible") ask(); };
    ask();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      lock?.release?.().catch(() => {});
    };
  }, []);

  const props = inn ? boardFromInnings(inn, { target, overs }) : null;
  const B = T.board;
  const side = inn ? teamOf(match, inn.battingTeam) : null;
  return (
    <div data-testid="mc-bigscreen" role="dialog" aria-modal="true" aria-label="Big screen: the scoreboard"
      style={{ position: "fixed", inset: 0, zIndex: 3000, background: B.face, color: B.figure, display: "flex", flexDirection: "column",
        padding: "clamp(16px, 4vmin, 56px)", gap: "clamp(8px, 2vmin, 24px)", overflow: "auto", fontFamily: T.type.mono,
        fontVariantNumeric: "tabular-nums" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.md }}>
        <span style={{ fontFamily: T.type.body, fontSize: "clamp(14px, 2.2vmin, 24px)", color: B.dim }}>{line}</span>
        <button ref={closeRef} type="button" onClick={onClose} data-testid="mc-bigscreen-close" className="pressBtn"
          style={{ minHeight: "48px", padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, border: `1px solid ${B.rule}`, background: "transparent",
            color: B.figure, fontFamily: T.type.body, fontSize: "16px", fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
          Exit big screen
        </button>
      </div>
      {!props ? (
        <p style={{ fontFamily: T.type.body, fontSize: "clamp(24px, 5vmin, 56px)", color: B.dim, margin: "auto" }}>The board opens with the first ball.</p>
      ) : (
        <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "clamp(8px, 2.5vmin, 32px)" }}>
          <MomentMark moment={moment} big/>
          <div style={{ fontFamily: T.type.body, fontWeight: 700, fontSize: "clamp(22px, 5vmin, 72px)", lineHeight: 1.1, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {side.full}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: T.space.lg }}>
            <span data-testid="mc-bigscreen-total" style={{ fontSize: "clamp(96px, 26vmin, 360px)", lineHeight: 0.95, fontWeight: 500 }}>
              <Figure value={shownRuns ?? props.total}/><span style={{ color: B.dim }}>/</span><Figure value={props.wickets}/>
            </span>
            <span style={{ textAlign: "right" }}>
              <span style={{ display: "block", fontSize: "clamp(40px, 10vmin, 140px)", lineHeight: 1 }}><Figure value={props.overs}/></span>
              <span style={{ display: "block", fontFamily: T.type.body, fontSize: "clamp(16px, 2.6vmin, 30px)", color: B.dim }}>overs</span>
            </span>
          </div>
          {props.sub && <div data-testid="mc-bigscreen-sub" style={{ fontFamily: T.type.body, fontSize: "clamp(22px, 5vmin, 64px)", color: B.lime }}>{props.sub}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "clamp(12px, 3vmin, 48px)", fontSize: "clamp(22px, 4.4vmin, 56px)", borderTop: `1px solid ${B.rule}`, paddingTop: "clamp(8px, 2vmin, 24px)" }}>
            {props.batters.map((b) => (
              <span key={b.name} style={{ color: b.onStrike ? B.figure : B.dim, whiteSpace: "nowrap" }}>
                <span aria-hidden="true" style={{ color: b.onStrike ? B.lime : "transparent" }}>● </span>
                {b.onStrike && <span className="sr-only">on strike: </span>}
                <span style={{ fontFamily: T.type.body }}>{b.name}</span> <Figure value={b.runs ?? 0}/>
                <span style={{ color: B.dim }}> ({b.balls})</span>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: T.space.lg, fontSize: "clamp(20px, 3.6vmin, 44px)" }}>
            {props.bowler && (
              <span style={{ whiteSpace: "nowrap" }}>
                <span style={{ fontFamily: T.type.body }}>{props.bowler.name}</span> {props.bowler.wickets}/{props.bowler.runs}
                <span style={{ color: B.dim }}> ({props.bowler.overs})</span>
              </span>
            )}
            <span style={{ display: "flex", gap: "clamp(6px, 1.2vmin, 14px)", flexWrap: "wrap" }}>
              <span className="sr-only">This over: {props.thisOver.map((m) => chipFor(m).say).join(", ")}</span>
              {props.thisOver.map((m, i) => {
                const c = chipFor(m), f = chipFill(c.kind);
                return (
                  <span key={i} aria-hidden="true" style={{ minWidth: "1.6em", height: "1.6em", padding: c.text.length > 1 ? "0 0.35em" : 0, borderRadius: T.radius.pill,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
                    background: f ?? "transparent", color: f ? inkFor(f) : B.dim, fontSize: "0.8em" }}>{c.text}</span>
                );
              })}
            </span>
          </div>
          <OverSummary item={overSummary} big/>
        </div>
      )}
    </div>
  );
}

import { T } from "../design/tokens.js";
import { cardModel } from "../lib/matchCard.js";
import { Icon } from "./icons.jsx";

/**
 * THE MATCH CARD (redesign slice 1; DESIGN_DIRECTION §2.2): one match, drawn
 * the one way on every signed-in screen, in three sizes.
 *
 *   row    a list's: the Matches list, "This week", a child's fixtures.
 *          Sits on its list's panel with a hairline under it, not a card of
 *          its own; at least 44px tall
 *   card   a first screen's: the next fixture, the last match
 *   board  the lead: a live match, with the black Board (ui/board.jsx)
 *          handed in as `board` and drawn under the two sides
 *
 * Same content, same order, at every size; the bigger sizes get more room,
 * never different facts:
 *   1. the state line: "● Live", "Sat 21 Nov · 17:25", "Result"; on the right
 *      "Updated 5 s ago" (`updated`) or, in the last hour, "in 12 min"
 *   2. the two sides, the reader's own first, each with its score and its
 *      overs' unit; the side batting marked with the bat and the word
 *   3. the status sentence (statusSentence(), lib/matchCentre.js)
 *   4. one line for the reader (`line`), only where his role has one
 *   5. one action (`action`), named for the match and the role; `also` is
 *      the one second, quieter action a role may have ("Open scorer" for a
 *      coach who scores it)
 *
 * What it says is lib/matchCard.js cardModel(), from what the screen hands
 * in. NOTHING HERE READS: the card shows only what the screen already read.
 *
 * `onOpen` makes the whole card one button (the Match Centre's details, a
 * child's fixture), lying under its content as ui/primitives.jsx Card's does,
 * so its own buttons stay their own and Tab reaches it. `children` are drawn
 * after the reader's line: what a screen keeps beside the match (the
 * answer, the ready chips), never a second copy of a fact the card says.
 *
 * `loading` draws a still skeleton of the same shape (no shimmer, so reduced
 * motion has nothing to stop); `error` draws "Couldn't load this match." and
 * a Retry in the card's place.
 */

const SIZE = {
  row:   { pad: () => `${T.space.md} 0`, gap: () => T.space.xs, name: () => ({ ...T.role.body, fontWeight: 600 }), score: () => ({ ...T.role.figure.sm }),
           sentence: () => ({ ...T.role.body, fontSize: "14px", fontWeight: 600 }) },
  card:  { pad: () => "0", gap: () => T.space.sm, name: () => ({ ...T.role.body, fontSize: "16px", fontWeight: 600 }), score: () => ({ ...T.role.figure.sm, fontSize: "16px", fontWeight: 500 }),
           sentence: () => ({ ...T.role.body, fontWeight: 600 }) },
  board: { pad: () => "0", gap: () => T.space.sm, name: () => ({ ...T.role.title.md }), score: () => ({ ...T.role.figure.md }),
           sentence: () => ({ ...T.role.body, fontSize: "16px", fontWeight: 600 }) },
};

// Functions, not constants: a token read at import time keeps the theme it was read under (design.test.mjs).
const small = () => ({ ...T.role.label, textTransform: "none", letterSpacing: 0, fontWeight: 500, color: T.content.secondary });

/** A 44px pill: the card's action. @param {{a: any, primary: boolean}} p */
function ActionButton({ a, primary }) {
  if (!a) return null;
  if (!a.onClick) return a; // a node handed in whole
  return (
    <button type="button" className="pressBtn" data-testid={a.testid} aria-label={a.aria} onClick={(e) => { e.stopPropagation(); a.onClick(e); }}
      style={{
        minHeight: "44px", minWidth: "44px", padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, cursor: "pointer",
        border: `1px solid ${primary ? "transparent" : T.line.normal}`,
        background: primary ? T.light.cobalt : "transparent",
        color: primary ? T.light.ink : T.content.primary,
        fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, overflowWrap: "anywhere", textAlign: "center",
      }}>{a.label}</button>
  );
}

/** The state line's left half: the dot and the word for a live match, never the colour alone. */
function StateWords({ state, testid }) {
  const live = state.kind === "live";
  return (
    <span data-testid={testid} data-kind={state.kind} style={{ ...T.role.label, display: "inline-flex", alignItems: "center", gap: T.space.xs,
      color: live ? T.brand.accentText : state.kind === "upcoming" ? T.content.secondary : T.content.primary }}>
      {live && <span className="live-dot" aria-hidden="true"/>}
      {state.kind === "upcoming" ? <span style={{ textTransform: "none", letterSpacing: 0 }}>{state.words}</span> : state.words}
    </span>
  );
}

/** One side: the name on the left, the score on the right; the side batting marked. */
function SideRow({ side, size, testid }) {
  const s = SIZE[size];
  return (
    <div data-testid={testid} data-end={side.end} data-batting={side.batting ? "true" : "false"}
      style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.md }}>
      <span style={{ ...s.name(), color: T.content.primary, minWidth: 0, overflowWrap: "anywhere", display: "inline-flex", alignItems: "baseline", gap: T.space.xs }}>
        <span>{side.name.full}</span>
        {side.batting && <span style={{ color: T.brand.accentText, display: "inline-flex", alignSelf: "center" }}><Icon name="bat"/><span className="sr-only">batting</span></span>}
      </span>
      {side.score && <span data-testid={testid ? `${testid}-score` : undefined} style={{ ...s.score(), color: T.content.primary, whiteSpace: "nowrap", flexShrink: 0 }}>{side.score}</span>}
    </div>
  );
}

/** The skeleton: the card's own shape, still. @param {{size: string, testid?: string}} p */
export function MatchCardSkeleton({ size = "card", testid = "match-card-loading" }) {
  const bar = (/** @type {string} */ w, /** @type {string} */ h) => <span style={{ display: "block", width: w, height: h, borderRadius: T.radius.sm, background: T.surface.interactive }}/>;
  return (
    <div data-testid={testid} role="status" aria-label="Loading the match" style={{ display: "grid", gap: SIZE[size].gap(), padding: SIZE[size].pad() }}>
      {bar("30%", "12px")}{bar("70%", size === "row" ? "16px" : "20px")}{bar("60%", size === "row" ? "16px" : "20px")}{bar("80%", "14px")}
    </div>
  );
}

/**
 * @param {{
 *   size?: "row" | "card" | "board",
 *   match: any, fold?: any, innings?: any[] | null, resultWords?: string | null, scores?: any, ownEnd?: "home" | "away" | null,
 *   official?: "provisional" | "official" | "review" | null, now?: number,
 *   updated?: import("react").ReactNode, line?: import("react").ReactNode, lineTestid?: string,
 *   action?: any, also?: any, board?: import("react").ReactNode, children?: import("react").ReactNode,
 *   onOpen?: (() => void) | null, openLabel?: string, expanded?: boolean, controls?: string,
 *   loading?: boolean, error?: boolean, onRetry?: (() => void) | null,
 *   testid?: string, statusTestid?: string, sideTestid?: string, last?: boolean, aside?: import("react").ReactNode,
 * }} p
 */
export function MatchCard({ size = "card", match, fold = null, innings = null, resultWords = null, scores = null, ownEnd = null, official = null, now,
                            updated = null, line = null, lineTestid, action = null, also = null, board = null, children = null,
                            onOpen = null, openLabel, expanded, controls, loading = false, error = false, onRetry = null,
                            testid, statusTestid, sideTestid, last = false, aside = null }) {
  const s = SIZE[size];
  const row = size === "row";
  const frame = { position: "relative", padding: s.pad(), borderBottom: row && !last ? `1px solid ${T.line.subtle}` : "none", minHeight: "44px" };
  if (loading) return <div data-testid={testid} style={frame}><MatchCardSkeleton size={size} testid={testid ? `${testid}-loading` : undefined}/></div>;
  if (error) {
    return (
      <div data-testid={testid} data-state="failed" role="alert" style={{ ...frame, display: "flex", flexWrap: "wrap", alignItems: "center", gap: T.space.sm }}>
        <span style={{ ...T.role.body, color: T.content.primary, display: "inline-flex", alignItems: "center", gap: T.space.xs }}>
          <Icon name="triangle-alert" style={{ color: T.semantic.criticalText }}/>Couldn't load this match.
        </span>
        {onRetry && <ActionButton a={{ label: "Retry", onClick: onRetry, testid: testid ? `${testid}-retry` : undefined }} primary={false}/>}
      </div>
    );
  }
  const m = cardModel({ match, fold, innings, resultWords, scores, ownEnd, official, now: now ?? Date.now() });
  const right = updated ?? m.soon;
  const body = (
    <div style={{ display: "grid", gap: s.gap() }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm, flexWrap: "wrap" }}>
        <StateWords state={m.state} testid={testid ? `${testid}-state` : undefined}/>
        {(right || aside) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.sm, marginLeft: "auto" }}>
            {right && <span data-testid={testid ? `${testid}-fresh` : undefined} style={small()}>{right}</span>}
            {aside}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gap: row ? "2px" : T.space.xs }}>
        {m.sides.map((side) => <SideRow key={side.end} side={side} size={size} testid={sideTestid ? `${sideTestid}-${side.end}` : undefined}/>)}
      </div>
      {board}
      <p data-testid={statusTestid} data-state={m.sentence.state}
        style={{ ...s.sentence(), color: m.state.kind === "live" ? T.brand.accentText : T.content.primary, margin: 0, overflowWrap: "anywhere" }}>
        {m.sentence.text}
      </p>
      {line && <p data-testid={lineTestid} style={{ ...T.role.body, fontSize: row ? "14px" : undefined, color: T.content.secondary, margin: 0, overflowWrap: "anywhere" }}>{line}</p>}
      {children}
      {(action || also) && (
        <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", alignItems: "center", marginTop: row ? 0 : T.space.xs }}>
          <ActionButton a={action} primary={!row}/>
          <ActionButton a={also} primary={false}/>
        </div>
      )}
    </div>
  );
  if (!onOpen) return <div data-testid={testid} data-size={size} data-state={m.state.kind} style={frame}>{body}</div>;
  return (
    <div data-testid={testid} data-size={size} data-state={m.state.kind} style={frame}>
      <button type="button" className="os-card-action" onClick={onOpen} aria-label={openLabel} aria-expanded={expanded} aria-controls={controls}/>
      <div className="os-card-content">{body}</div>
    </div>
  );
}

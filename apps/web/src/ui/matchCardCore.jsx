import { useEffect, useState } from "react";
import { T } from "../design/tokens.js";
import { cardModel } from "../lib/matchCard.js";
import { freshnessWords } from "../lib/announce.js";
import { Icon } from "./iconCore.jsx";

/**
 * THE MATCH CARD's drawing (redesign slices 1 and 2). Import the card from
 * ./matchCard.jsx, which adds its loading and error state; the public page
 * (public/PublicMatch.jsx) imports this, the card as it draws a match, so
 * the signed-out bundle does not carry ui/primitives.jsx and the app's whole
 * icon set for a state it never draws (tools/check-bundle.mjs, 470 KB).
 *
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
 * `loading` and `error` (./matchCard.jsx) draw slice 7's one state in the card's place: its
 * Skeleton, or "Couldn't load this match." and a Retry (ui/primitives.jsx
 * ReadState).
 */

/** The card's outer box at a size: its padding, the row's hairline, the 44px floor. @param {"row" | "card" | "board"} size @param {boolean} last */
export const cardFrame = (size, last) => ({ position: "relative", padding: SIZE[size].pad(),
  borderBottom: size === "row" && !last ? `1px solid ${T.line.subtle}` : "none", minHeight: "44px" });

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
    <span data-part="state" data-testid={testid} data-kind={state.kind} style={{ ...T.role.label, display: "inline-flex", alignItems: "center", gap: T.space.xs,
      color: live ? T.brand.accentText : state.kind === "upcoming" ? T.content.secondary : T.content.primary }}>
      {live && <span className="live-dot" aria-hidden="true"/>}
      {state.kind === "upcoming" ? <span style={{ textTransform: "none", letterSpacing: 0 }}>{state.words}</span> : state.words}
    </span>
  );
}

/** One side: the name on the left, the score on the right; the side batting marked; `mark` under its score. */
function SideRow({ side, size, testid, mark = null }) {
  const s = SIZE[size];
  return (
    // The score wraps under the name, never off the screen: at 200% zoom a phone is 188px wide (browser-narrow).
    <div data-testid={testid} data-end={side.end} data-batting={side.batting ? "true" : "false"}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: `0 ${T.space.md}` }}>
      {/* A plain run of text, not a flex box, so a long name wraps inside its column and the bat follows its last word. */}
      <span style={{ ...s.name(), color: T.content.primary, minWidth: 0, flex: "1 1 8em", overflowWrap: "anywhere", position: "relative" }}>
        {side.name.full}
        {side.batting && <span style={{ color: T.brand.accentText, marginLeft: T.space.xs, whiteSpace: "nowrap" }}><Icon name="bat"/><span className="sr-only">batting</span></span>}
      </span>
      {side.score && (
        // The runs hold together ("116/4"); the overs may break onto the next line on the narrowest phone.
        <span data-part="score" style={{ ...s.score(), color: T.content.primary, marginLeft: "auto", textAlign: "right", minWidth: 0 }}>
          {side.score.split(" · ").map((part, i) => (i
            ? <span key={i}> · {part}</span>
            : <span key={i} style={{ whiteSpace: "nowrap" }}>{part}</span>))}
        </span>
      )}
      {mark && <span data-testid="mc-score-mark" style={{ flexBasis: "100%", display: "flex", justifyContent: "flex-end" }}>{mark}</span>}
    </div>
  );
}

/**
 * @param {{
 *   size?: "row" | "card" | "board",
 *   match: any, fold?: any, innings?: any[] | null, resultSaid?: string | null, scores?: any, ownEnd?: "home" | "away" | null,
 *   official?: "provisional" | "official" | "review" | null, now?: number,
 *   updated?: import("react").ReactNode, line?: import("react").ReactNode, lineTestid?: string,
 *   action?: any, also?: any, board?: import("react").ReactNode, children?: import("react").ReactNode,
 *   onOpen?: (() => void) | null, openLabel?: string, expanded?: boolean, controls?: string, actionPrimary?: boolean | null,
 *   loading?: boolean, error?: boolean, onRetry?: (() => void) | null,
 *   testid?: string, statusTestid?: string, sideTestid?: string, last?: boolean, aside?: import("react").ReactNode,
 *   stateTestid?: string, scoresTestid?: string, mark?: {end: "home" | "away", node: import("react").ReactNode} | null,
 *   model?: ReturnType<typeof cardModel> | null,
 * }} p
 *
 * `model`: cardModel()'s answer, where the screen made it already to say the
 * same sentence elsewhere (the public page's Share); the card then says it as
 * given. `actionPrimary`: false draws the action as the quiet one, where the
 * card sits in a quiet block under a screen's lead (slice 8: one primary per
 * screen); unset, a card's action is primary and a row's is not. `mark`: one
 * small thing drawn under one side's score (the public
 * page's "Corrected" chip, GA-I36 §5), never a second figure.
 */
export function MatchCardCore({ size = "card", match, fold = null, innings = null, resultSaid = null, scores = null, ownEnd = null, official = null, now,
                            updated = null, line = null, lineTestid, action = null, also = null, board = null, children = null,
                            onOpen = null, openLabel, expanded, controls, actionPrimary = null,
                            testid, statusTestid, sideTestid, last = false, aside = null, stateTestid, scoresTestid, mark = null, model = null }) {
  const s = SIZE[size];
  const row = size === "row";
  const frame = cardFrame(size, last);
  const m = model ?? cardModel({ match, fold, innings, resultSaid, scores, ownEnd, official, now: now ?? Date.now() });
  const right = updated ?? m.soon ?? m.day;
  const body = (
    // A measure, not the panel's width: on a desktop a score sits beside its side's name, not a screen away.
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: s.gap(), maxWidth: "40rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm, flexWrap: "wrap" }}>
        <StateWords state={m.state} testid={stateTestid}/>
        {(right || aside) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.sm, marginLeft: "auto" }}>
            {right && <span data-part="fresh" style={small()}>{right}</span>}
            {aside}
          </span>
        )}
      </div>
      <div data-testid={scoresTestid} style={{ display: "grid", gap: row ? "2px" : T.space.xs }}>
        {m.sides.map((side) => <SideRow key={side.end} side={side} size={size} testid={sideTestid ? `${sideTestid}-${side.end}` : undefined}
          mark={mark && mark.end === side.end ? mark.node : null}/>)}
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
          <ActionButton a={action} primary={actionPrimary ?? !row}/>
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

/**
 * The state line's right, while a match is being played: "Updated 5 s ago",
 * ticking once a second (§2.2 item 1). `at` is the screen's last good read.
 * Its own state, so the tick re-renders these words and nothing else; not a
 * live region, so a screen reader is not told the time every second.
 * @param {{at: number | null, testid?: string}} p
 */
export function UpdatedAgo({ at, testid }) {
  const [said, setSaid] = useState(() => freshnessWords({ at }));
  useEffect(() => {
    setSaid(freshnessWords({ at }));
    if (at == null) return undefined;
    const t = setInterval(() => setSaid(freshnessWords({ at })), 1000);
    return () => clearInterval(t);
  }, [at]);
  return said ? <span data-testid={testid} style={{ fontVariantNumeric: "tabular-nums" }}>{said}</span> : null;
}

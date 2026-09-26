import { useState } from "react";
import { T } from "../design/tokens.js";

/**
 * THE BOARD — the score, drawn one way everywhere (DESIGN_DIRECTION §1).
 *
 * A school ground has one piece of information design everybody trusts: the
 * scoreboard. Black board, painted figures, a fixed vocabulary — total,
 * wickets, overs, target, batters, bowler, this over. This is that board, and
 * it is the only thing that should ever draw a score: the pad, the match-day
 * hub, the public page, the report and the parent's phone all get it from
 * here (steps 2 and 3 of the redesign wire it in; this is the foundation).
 *
 * ALWAYS BLACK. It reads only `T.board`, which does not switch with the theme:
 * black on a light page in daylight, black on a dark page under lights.
 * Figures are DM Mono and tabular, so a 142 and a 9 take the same width and
 * nothing jumps as the score moves.
 *
 * THE FLIP. When a figure's value changes it turns over — a vertical
 * half-turn, 190ms, `swift` (`motion.flip`, `.os-board-flip` in GLOBAL_CSS).
 * Nothing flips on first draw, only on a change. Reduced motion makes it a
 * cut, through the same global rule as every other animation.
 *
 * Props (every one optional except `total`):
 *   team      the batting side, e.g. "Hilton 1st XI"
 *   total     runs;  wickets  wickets down
 *   overs     as the scorer writes them, e.g. "14.2" — never "14.2 ov"
 *   sub       the line under the total: a target or the rates, in words
 *             ("Need 45 off 34 · CRR 9.91")
 *   batters   [{ name, runs, balls, onStrike }]
 *   bowler    { name, wickets, runs, overs }
 *   thisOver  the balls of the over so far, as the board shows them:
 *             ["·", "4", "1", "W", "2wd"]
 *   size      "pad" (the total at figure.board) or "card" (figure.lg)
 */

/**
 * What a figure shows next, and whether it has turned. Pure, so the rule —
 * a change turns it over, the first draw does not — is testable without a
 * browser (apps/web/test/board.test.mjs).
 */
export function nextFigure(prev, value) {
  if (prev.shown === value) return prev;
  return { shown: value, turn: prev.turn + 1 };
}

/**
 * One figure on the board. Flips when its value changes.
 *
 * `was` is the value the board showed before this one was drawn, for a board
 * that arrives mid-change (a live page re-mounting on an update): it turns
 * over from `was` to `value` on its first paint. Absent, the first draw is
 * still.
 */
export function Figure({ value, was, style, testid }) {
  const [state, setState] = useState(() => ({ shown: was === undefined ? value : was, turn: 0 }));
  // Adjusting state to a new prop during render — React's own pattern for
  // "remember the previous value" — so the flip starts on the same paint as
  // the new figure, not a frame later.
  const next = nextFigure(state, value);
  if (next !== state) setState(next);
  return (
    <span key={next.turn} data-testid={testid} data-turn={next.turn}
      className={next.turn > 0 ? "os-board-flip" : undefined}
      style={{ display: "inline-block", fontVariantNumeric: "tabular-nums", ...style }}>
      {value}
    </span>
  );
}

export function Board({ team, total, wickets, overs, sub, batters = [], bowler, thisOver = [], size = "pad", testid = "board" }) {
  // On the pad the total is figure.board, 56 on a phone and 72 on a tablet;
  // the size comes from `.os-board-total` because an inline style cannot say
  // "from 768px". On a card it is figure.lg.
  const pad = size === "pad";
  const { fontSize: _padSize, ...boardRole } = T.role.figure.board;
  const big = pad ? boardRole : T.role.figure.lg;
  // Read here, not at import: the rule for every token (tokens.js). The board
  // tokens never switch, but the rule is simpler kept without exceptions.
  const B = T.board, mono = T.type.mono;
  const said = [team, `${total ?? 0} for ${wickets ?? 0}`, overs != null ? `${overs} overs` : null].filter(Boolean).join(", ");
  return (
    <section data-testid={testid} aria-label={`Scoreboard: ${said}`}
      style={{ background: B.face, color: B.figure, borderRadius: T.radius.lg, padding: `${T.space.md} ${T.space.lg}`,
        fontFamily: mono, fontVariantNumeric: "tabular-nums", border: `1px solid ${B.rule}` }}>
      {/* The total: the team, the overs and the target or rates on the left,
          the figures on the right, as a board has them. The left column sits
          beside the total rather than under it, so the board is no taller
          than its figures need (step 2: the pad fits a phone). */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: T.space.md }}>
        <div style={{ minWidth: 0, display: "grid", gap: "2px" }}>
          <div style={{ ...T.role.label, color: B.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {team}
          </div>
          {(overs != null || sub) && (
            <div style={{ display: "flex", alignItems: "baseline", gap: `0 ${T.space.sm}`, flexWrap: "wrap" }}>
              {overs != null && (
                <span style={{ ...T.role.figure.md, color: B.figure }}>
                  <Figure value={overs} testid={`${testid}-overs`}/>
                </span>
              )}
              {sub && <span style={{ ...T.role.body, fontSize: "14px", lineHeight: 1.35, color: B.dim }} data-testid={`${testid}-sub`}>{sub}</span>}
            </div>
          )}
        </div>
        <div className={pad ? "os-board-total" : undefined} style={{ ...big, color: B.figure, whiteSpace: "nowrap", flexShrink: 0 }} data-testid={`${testid}-total`}>
          <Figure value={total ?? 0} testid={`${testid}-runs`}/>
          <span style={{ color: B.dim }}>/</span>
          <Figure value={wickets ?? 0} testid={`${testid}-wickets`}/>
        </div>
      </div>

      {(batters.length > 0 || bowler || thisOver.length > 0) && (
        <div style={{ borderTop: `1px solid ${B.rule}`, marginTop: T.space.md, paddingTop: T.space.sm, display: "grid", gap: T.space.xs }}>
          {batters.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: `${T.space.xs} ${T.space.lg}` }}>
              {batters.map((b) => (
                <span key={b.name} data-testid={`${testid}-batter`} data-on-strike={b.onStrike ? "true" : undefined}
                  style={{ ...T.role.figure.sm, color: B.figure, whiteSpace: "nowrap" }}>
                  {/* The on-strike marker is a shape as well as a colour, and is said. */}
                  <span aria-hidden="true" style={{ color: b.onStrike ? B.lime : "transparent", marginRight: T.space.xs }}>●</span>
                  {b.onStrike && <span className="sr-only">on strike: </span>}
                  <span style={{ fontFamily: T.type.body }}>{b.name}</span>{" "}
                  <Figure value={b.runs ?? 0}/>
                  {b.balls != null && <span style={{ color: B.dim }}> ({b.balls})</span>}
                </span>
              ))}
            </div>
          )}
          {(bowler || thisOver.length > 0) && (
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: T.space.sm }}>
              {bowler && (
                <span data-testid={`${testid}-bowler`} style={{ ...T.role.figure.sm, color: B.figure, whiteSpace: "nowrap" }}>
                  <span style={{ fontFamily: T.type.body }}>{bowler.name}</span>{" "}
                  <Figure value={`${bowler.wickets ?? 0}/${bowler.runs ?? 0}`}/>
                  {bowler.overs != null && <span style={{ color: B.dim }}> ({bowler.overs})</span>}
                </span>
              )}
              {thisOver.length > 0 && (
                <span data-testid={`${testid}-over`} aria-label={`This over: ${thisOver.join(" ")}`}
                  style={{ ...T.role.figure.sm, display: "inline-flex", gap: T.space.sm, color: B.figure }}>
                  {thisOver.map((b, i) => (
                    <span key={i} aria-hidden="true" style={{ color: /^[46]$/.test(String(b)) ? B.lime : /W/.test(String(b)) ? B.figure : B.dim,
                      fontWeight: /^[46W]/.test(String(b)) ? 500 : 400 }}>{b}</span>
                  ))}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { T, contrast } from "../design/tokens.js";
import { Icon } from "./icons.jsx";

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
 * ALWAYS BLACK. It reads only `T.board` (and `T.chip`, the ball chips), which
 * do not switch with the theme: black on a light page in daylight, black on a
 * dark page under lights. Figures are DM Mono and tabular, so a 142 and a 9
 * take the same width and nothing jumps as the score moves.
 *
 * THE FLIP. When a figure's value changes it turns over — a vertical
 * half-turn, 190ms, `swift` (`motion.flip`, `.os-board-flip` in GLOBAL_CSS).
 * Nothing flips on first draw, only on a change. Reduced motion makes it a
 * cut, through the same global rule as every other animation.
 *
 * STEP 3b (§10, from the 2.0 prototypes): the striker lit and the other end
 * dim, the partnership under the batters, the over as coloured chips, and one
 * rotating Tier 2 line — the `insight` — for spectator screens only. A row
 * whose data is missing is simply not drawn: no placeholders.
 *
 * Props (every one optional except `total`):
 *   team        the batting side, e.g. "Hilton 1st XI"
 *   total       runs;  wickets  wickets down
 *   overs       as the scorer writes them, e.g. "14.2" — never "14.2 ov"
 *   sub         the line under the total: a target or the rates, in words
 *               ("Need 45 off 34 · CRR 9.91")
 *   batters     [{ name, runs, balls, onStrike }]
 *   partnership { runs, balls } — the current stand, from the fold
 *   bowler      { name, wickets, runs, overs }
 *   thisOver    the balls of the over so far, as the board writes them:
 *               ["·", "4", "1", "W", "2wd", "nb", "2b", "1lb"]
 *   insight     Tier 2: lines that take turns, every 8 s ("D Erasmus needs 4
 *               for fifty"). SPECTATOR SCREENS ONLY — never the pad, where a
 *               line that changes by itself pulls the scorer's eye off the ball
 *   size        "pad" (the total at figure.board) or "card" (figure.lg)
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

const EXTRA_WORD = { wd: ["wide", "wides"], nb: ["no ball", "no ball"], b: ["bye", "byes"], lb: ["leg bye", "leg byes"] };

/**
 * One mark of "this over" as a chip: which colour it takes, what it shows and
 * what it is called aloud. Pure (board.test.mjs).
 *
 *   ·  0        a dot: no chip, a dim mark
 *   1 2 3 4 6   the prototype's colours; a 5 (and anything past 6) takes the four's
 *   W           a solid white chip, a black W — the strongest mark in every palette
 *   wd nb b lb  the wide's colour, with the word: "2wd", "nb", "5nb", "2b", "1lb"
 *
 * Every chip carries its figure or its word, so colour is never the only
 * signal (WCAG 1.4.1).
 */
export function chipFor(mark) {
  const m = String(mark ?? "").trim();
  if (m === "" || m === "·" || m === "0") return { kind: "dot", text: "·", say: "dot" };
  if (/^w$/i.test(m)) return { kind: "wicket", text: "W", say: "wicket" };
  if (/^\d+$/.test(m)) {
    const n = Number(m);
    const kind = n === 1 ? "one" : n === 2 ? "two" : n === 3 ? "three" : n === 6 ? "six" : "four";
    return { kind, text: m, say: n === 1 ? "1 run" : `${n} runs` };
  }
  const x = m.match(/^(\d*)(wd|nb|lb|b)$/i);
  if (x) {
    const [one, many] = EXTRA_WORD[x[2].toLowerCase()];
    const n = x[1] === "" ? null : Number(x[1]);
    const say = x[2].toLowerCase() === "nb"
      ? (n ? `no ball, ${n} runs` : "no ball")
      : (n ? `${n} ${n === 1 ? one : many}` : one);
    return { kind: "extra", text: m, say };
  }
  return { kind: "extra", text: m, say: m };
}

/** The black or the white of the board, whichever reads better on a chip. */
const chipInk = (fill) => (contrast(fill, T.board.face) >= contrast(fill, T.board.figure) ? T.board.face : T.board.figure);

/** A chip's fill for its kind, from the palette in force (T.chip, §3.9). */
export function chipFill(kind) {
  if (kind === "wicket") return T.board.figure;
  if (kind === "dot") return null;
  return T.chip[kind] ?? T.chip.extra;
}

function Chip({ mark }) {
  const c = chipFor(mark);
  const fill = chipFill(c.kind);
  return (
    <span aria-hidden="true" data-chip={c.kind}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
        minWidth: "24px", height: "24px", padding: c.text.length > 1 ? "0 6px" : 0, borderRadius: T.radius.pill,
        background: fill ?? "transparent", color: fill ? chipInk(fill) : T.board.dim,
        fontFamily: T.type.mono, fontSize: "14px", lineHeight: 1, fontWeight: fill ? 500 : 400,
        fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {c.text}
    </span>
  );
}

/** How long one Tier 2 line stays before the next (§10: every 8 s). */
export const INSIGHT_MS = 8000;

/**
 * Tier 2 — one line that takes turns (§10). It moves on every 8 s; it holds
 * while the pointer is over it or focus is in it; it has a real pause button
 * (WCAG 2.2.2), 44px, labelled for what it will do; and it is not a live
 * region, so a screen reader is not interrupted every 8 s. Under reduced
 * motion the new line cuts in rather than slides (GLOBAL_CSS). One line does
 * not rotate and needs no button.
 */
export function Insight({ lines = [], testid = "board-insight" }) {
  const [turn, setTurn] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const n = lines.length;
  useEffect(() => {
    if (n < 2 || paused || held) return undefined;
    const t = setInterval(() => setTurn((x) => x + 1), INSIGHT_MS);
    return () => clearInterval(t);
  }, [n, paused, held]);
  if (!n) return null;
  const B = T.board;
  const at = turn % n;
  const rotating = n > 1;
  return (
    <div data-testid={testid} data-paused={rotating ? String(paused) : undefined}
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false); }}
      style={{ display: "flex", alignItems: "center", gap: T.space.sm, borderTop: `1px solid ${B.rule}`,
        marginTop: T.space.sm, paddingTop: T.space.sm, minHeight: rotating ? "44px" : undefined }}>
      <p key={at} className={rotating ? "os-insight-in" : undefined} data-testid={`${testid}-line`}
        style={{ flex: 1, minWidth: 0, margin: 0, fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.35, color: B.figure }}>
        <span className="sr-only">{rotating ? `Insight ${at + 1} of ${n}: ` : "Insight: "}</span>
        {lines[at]}
      </p>
      {rotating && (
        <button type="button" onClick={() => setPaused((p) => !p)} data-testid={`${testid}-pause`}
          aria-label={paused ? "Play the rotating line" : "Pause the rotating line"}
          className="pressBtn"
          style={{ flexShrink: 0, width: "44px", height: "44px", padding: 0, display: "flex", alignItems: "center",
            justifyContent: "center", borderRadius: T.radius.md, cursor: "pointer", background: "transparent",
            border: `1px solid ${B.rule}`, color: B.figure, fontSize: "20px" }}>
          <Icon name={paused ? "play" : "pause"} size={20}/>
        </button>
      )}
    </div>
  );
}

export function Board({ team, total, wickets, overs, sub, batters = [], partnership, bowler, thisOver = [], insight,
  size = "pad", testid = "board" }) {
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
  // The striker lit, the other end dim (§10.3). Only when the board knows who
  // is on strike: without that, neither is dimmed.
  const marked = batters.some((b) => b.onStrike);
  const lines = (Array.isArray(insight) ? insight : insight ? [insight] : []).filter(Boolean);
  const chips = thisOver.map(chipFor);
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

      {(batters.length > 0 || partnership || bowler || chips.length > 0) && (
        <div style={{ borderTop: `1px solid ${B.rule}`, marginTop: T.space.md, paddingTop: T.space.sm, display: "grid", gap: T.space.xs }}>
          {batters.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: `${T.space.xs} ${T.space.lg}` }}>
              {batters.map((b) => {
                const lit = !marked || b.onStrike;
                return (
                  <span key={b.name} data-testid={`${testid}-batter`} data-on-strike={b.onStrike ? "true" : undefined}
                    style={{ ...T.role.figure.sm, color: lit ? B.figure : B.dim, whiteSpace: "nowrap" }}>
                    {/* The on-strike marker is a shape as well as a colour, and is said. */}
                    <span aria-hidden="true" style={{ color: b.onStrike ? B.lime : "transparent", marginRight: T.space.xs }}>●</span>
                    {b.onStrike && <span className="sr-only">on strike: </span>}
                    <span style={{ fontFamily: T.type.body }}>{b.name}</span>{" "}
                    <Figure value={b.runs ?? 0}/>
                    {b.balls != null && <span style={{ color: B.dim }}> ({b.balls})</span>}
                  </span>
                );
              })}
            </div>
          )}
          {partnership && (
            <div data-testid={`${testid}-partnership`} style={{ ...T.role.figure.sm, color: B.figure, whiteSpace: "nowrap" }}>
              <span style={{ fontFamily: T.type.body, color: B.dim }}>Partnership</span>{" "}
              <Figure value={partnership.runs ?? 0}/>
              {partnership.balls != null && <span style={{ color: B.dim }}> ({partnership.balls})</span>}
            </div>
          )}
          {(bowler || chips.length > 0) && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: T.space.sm }}>
              {bowler && (
                <span data-testid={`${testid}-bowler`} style={{ ...T.role.figure.sm, color: B.figure, whiteSpace: "nowrap" }}>
                  <span style={{ fontFamily: T.type.body }}>{bowler.name}</span>{" "}
                  <Figure value={`${bowler.wickets ?? 0}/${bowler.runs ?? 0}`}/>
                  {bowler.overs != null && <span style={{ color: B.dim }}> ({bowler.overs})</span>}
                </span>
              )}
              {chips.length > 0 && (
                <span data-testid={`${testid}-over`}
                  style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: T.space.xs, marginLeft: "auto" }}>
                  <span className="sr-only">This over: {chips.map((c) => c.say).join(", ")}</span>
                  {thisOver.map((b, i) => <Chip key={i} mark={b}/>)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {lines.length > 0 && <Insight lines={lines} testid={`${testid}-insight`}/>}
    </section>
  );
}

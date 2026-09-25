/**
 * The Board — the score, drawn one way everywhere (DESIGN_DIRECTION §1).
 *
 * Rendered through React's own server renderer, so the claims below are about
 * the markup the component produces, not about its source: that it is black
 * in BOTH themes, that its figures are the mono face and tabular, that it
 * carries every part of a scoreboard it is given, and that a figure turns over
 * when — and only when — its value changes.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/board.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { T, applyTheme, contrast } from "../src/design/tokens.js";
import { Board, Figure, nextFigure } from "../src/ui/board.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);
const html = (el) => renderToStaticMarkup(el);
// React writes inline colours as rgb(); the tokens are hex.
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const colourIn = (markup, hex) => markup.includes(hex) || markup.includes(rgb(hex));

const PROPS = {
  team: "Hilton 1st XI", total: 142, wickets: 3, overs: "14.2",
  sub: "Need 45 off 34 · CRR 9.91",
  batters: [{ name: "D Erasmus", runs: 5, balls: 1, onStrike: true }, { name: "R Pillay", runs: 17, balls: 12 }],
  bowler: { name: "K Naidoo", wickets: 1, runs: 31, overs: "3.2" },
  thisOver: ["·", "·", "4", "1", "5", "3", "·", "3"],
};

group("It is a scoreboard: every part it is given, in words a scorer would say");
const out = html(h(Board, PROPS));
ok("the team", out.includes("Hilton 1st XI"));
ok("the total and the wickets, as figures",
   /data-testid="board-runs"[^>]*>142</.test(out) && /data-testid="board-wickets"[^>]*>3</.test(out));
ok("the overs as the scorer writes them — no \"ov\" beside a figure", /data-testid="board-overs"[^>]*>14\.2</.test(out) && !/>14\.2 ?ov/.test(out));
ok("the sub-line", out.includes("Need 45 off 34 · CRR 9.91"));
ok("both batters, with runs and balls", out.includes("D Erasmus") && out.includes("R Pillay") && out.includes("(12)"));
ok("the on-strike marker, and it is said as well as drawn",
   /data-on-strike="true"[^>]*>.*?●/.test(out) && out.includes("on strike: ") && (out.match(/data-on-strike="true"/g) ?? []).length === 1);
ok("the bowler's figures", out.includes("K Naidoo") && out.includes("1/31") && out.includes("(3.2)"));
ok("this over, ball by ball, and named for a screen reader",
   out.includes('aria-label="This over: · · 4 1 5 3 · 3"') && (out.match(/aria-hidden="true"[^>]*>[·0-9W]</g) ?? []).length >= 8);
ok("the board as a whole is named", out.includes('aria-label="Scoreboard: Hilton 1st XI, 142 for 3, 14.2 overs"'));
ok("with only a total it draws only a total",
   (() => { const o = html(h(Board, { total: 0, wickets: 0 })); return !/board-batter|board-bowler|board-over"/.test(o) && /board-runs[^>]*>0</.test(o); })());

group("It is always black (decision 6)");
for (const th of ["floodlit", "daylight"]) {
  applyTheme(th);
  const o = html(h(Board, PROPS));
  ok(`${th}: the face is board.face`, colourIn(o, T.board.face) && T.board.face === "#0b0e0b");
  ok(`${th}: the figures are board.figure, the marker board.lime`, colourIn(o, T.board.figure) && colourIn(o, T.board.lime));
  // Nothing from the theme reaches it: none of the page's surfaces or inks.
  // (Under lights the page's primary and tertiary inks ARE the board's figure
  // and dim — the same hex, chosen that way — so those two are not a leak.)
  const own = new Set(Object.values(T.board));
  const leaked = [T.surface.canvas, T.surface.raised, T.surface.base, T.content.primary, T.content.secondary, T.content.tertiary]
    .filter((c) => !own.has(c) && colourIn(o, c));
  ok(`${th}: nothing of the ${th} theme is drawn on it`, leaked.length === 0, leaked.join(", "));
}
applyTheme("floodlit");
ok("the figures read on the face", ["figure", "lime", "dim"].every((k) => contrast(T.board[k], T.board.face) >= 4.5));

group("Figures are the mono face, tabular");
ok("the board is set in DM Mono with tabular figures", /font-family:&#x27;DM Mono&#x27;,monospace/.test(out) || /font-family:'DM Mono',monospace/.test(out));
ok("every figure is tabular", (out.match(/font-variant-numeric:tabular-nums/g) ?? []).length >= 6);
ok("the total on the pad takes figure.board, 56 → 72 on a tablet, by class",
   /class="os-board-total"/.test(out) && !/font-size:56px/.test(out));
ok("on a card it is figure.lg, inline", /font-size:32px/.test(html(h(Board, { ...PROPS, size: "card" }))));
ok("nothing on the board is under the 12px floor",
   (out.match(/font-size:(\d+)px/g) ?? []).every((m) => parseInt(m.slice(10), 10) >= 12), (out.match(/font-size:(\d+)px/g) ?? []).join(" "));

group("A figure turns over when its value changes, and not before");
const first = html(h(Figure, { value: 142 }));
ok("the first draw does not flip", !/os-board-flip/.test(first) && /data-turn="0"/.test(first));
const s0 = { shown: 142, turn: 0 };
ok("the same value is the same state (no re-render, no flip)", nextFigure(s0, 142) === s0);
const s1 = nextFigure(s0, 146);
ok("a new value turns it over once", s1.shown === 146 && s1.turn === 1);
ok("...and the next change again", nextFigure(s1, 147).turn === 2);
// The class is what carries the animation; the key change is what replays it.
// Through React's renderer: a figure drawn as its value moves on (`was`)
// takes the state update in render, turns once, and carries the class whose
// animation is the flip. The key changes with the turn, which is what replays
// it on the next change.
const turned = html(h(Figure, { value: 146, was: 142 }));
ok("a figure whose value has moved on turns over, once", /class="os-board-flip"/.test(turned) && /data-turn="1"/.test(turned) && />146</.test(turned));
ok("...and one drawn at the value it had does not", !/os-board-flip/.test(html(h(Figure, { value: 142, was: 142 }))));
ok("the flip is motion.flip, 190ms", T.motion.flip === "190ms");

console.log(`\n${"─".repeat(52)}\nBOARD: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

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
import { T, GLOBAL_CSS, applyTheme, contrast } from "../src/design/tokens.js";
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
ok("this over, ball by ball, and said in words to a screen reader",
   out.includes('<span class="sr-only">This over: dot, dot, 4 runs, 1 run, 5 runs, 3 runs, dot, 3 runs</span>')
   && (out.match(/data-chip="[a-z]+"[^>]*>[·0-9W]</g) ?? []).length === 8);
ok("the board as a whole is named", out.includes('aria-label="Scoreboard: Hilton 1st XI, 142 for 3, 14.2 overs"'));
ok("with only a total it draws only a total",
   (() => { const o = html(h(Board, { total: 0, wickets: 0 })); return !/board-batter|board-bowler|board-over"/.test(o) && /board-runs[^>]*>0</.test(o); })());

group("The striker lit, the other end dim (§10.3)");
{
  const tag = (name) => out.match(new RegExp(`<span[^>]*data-testid="board-batter"[^>]*>(?:(?!data-testid="board-batter").)*?${name}`))?.[0] ?? "";
  const st = tag("D Erasmus"), ns = tag("R Pillay");
  ok("the striker's name and figures are board.figure", colourIn(st.match(/style="[^"]*"/)[0], T.board.figure), st.slice(0, 160));
  ok("...the non-striker's board.dim", colourIn(ns.match(/style="[^"]*"/)[0], T.board.dim), ns.slice(0, 160));
  ok("...and the ● stays, so it is not colour alone", /data-on-strike="true"[^>]*>.*?●/.test(out));
  const none = html(h(Board, { ...PROPS, batters: PROPS.batters.map((b) => ({ ...b, onStrike: false })) }));
  ok("with no striker known, neither end is dimmed",
     (none.match(/data-testid="board-batter" style="[^"]*"/g) ?? []).every((s) => colourIn(s, T.board.figure)));
}

group("The partnership under the batters (§10.2)");
{
  const p = html(h(Board, { ...PROPS, partnership: { runs: 43, balls: 27 } }));
  const row = p.match(/data-testid="board-partnership"[\s\S]*?<\/div>/)?.[0] ?? "";
  ok("\"Partnership 43 (27)\": the runs, then the balls", /Partnership/.test(row) && />43</.test(row) && /\(27\)/.test(row), row);
  ok("...under the batters", p.indexOf("board-partnership") > p.lastIndexOf("board-batter"));
  ok("no partnership, no row — not a zero, not a dash", !/board-partnership/.test(out));
}

group("This over as chips, in the palette in force (§10, §3.9)");
{
  const { chipFor, chipFill } = await import("../src/ui/board.jsx");
  const kinds = (marks) => marks.map((m) => chipFor(m).kind).join(" ");
  ok("1 2 3 4 6 take their own colours; a 5, and anything past 6, the four's",
     kinds(["1", "2", "3", "4", "5", "6", "7"]) === "one two three four four six four");
  ok("a dot, a 0 and nothing are a dot", kinds(["·", "0", ""]) === "dot dot dot");
  ok("W is the wicket chip", kinds(["W", "w"]) === "wicket wicket");
  ok("wides, no-balls, byes and leg byes take the wide's, with their word",
     kinds(["wd", "2wd", "nb", "5nb", "2b", "1lb"]) === "extra extra extra extra extra extra");
  ok("...and are said as words", ["wd", "2wd", "nb", "5nb", "2b", "1lb"].map((m) => chipFor(m).say).join("|")
     === "wide|2 wides|no ball|no ball, 5 runs|2 byes|1 leg bye");
  // Every chip carries its figure or its word: colour is never the only signal.
  for (const m of ["1", "2", "3", "4", "5", "6", "W", "2wd", "nb", "2b", "1lb"])
    ok(`the ${m} chip shows "${m}" on it`, chipFor(m).text === m);
  const all = ["·", "1", "2", "3", "4", "5", "6", "W", "2wd", "nb", "2b", "1lb"];
  for (const v of ["standard", "redgreen", "blueyellow"]) {
    applyTheme("floodlit", v);
    const o = html(h(Board, { ...PROPS, thisOver: all }));
    const chips = [...o.matchAll(/<span aria-hidden="true" data-chip="([a-z]+)" style="([^"]*)">([^<]*)</g)];
    ok(`${v}: every mark is a chip`, chips.length === all.length, String(chips.length));
    const rgbHex = (s) => { const m = s.match(/rgb\((\d+), (\d+), (\d+)\)/); return m ? "#" + m.slice(1).map((x) => Number(x).toString(16).padStart(2, "0")).join("") : s.match(/#[0-9a-f]{6}/i)?.[0]; };
    for (const [, kind, style, text] of chips) {
      const bg = style.match(/background:([^;]+)/)?.[1], fg = style.match(/(?:^|;)color:([^;]+)/)?.[1];
      const size = parseFloat(style.match(/min-width:([\d.]+)px/)?.[1]), tall = parseFloat(style.match(/height:([\d.]+)px/)?.[1]);
      ok(`${v}: the ${text} chip is at least 24px, tabular`, size >= 24 && tall >= 24 && /tabular-nums/.test(style));
      if (kind === "dot") { ok(`${v}: the dot is unfilled and dim`, bg === "transparent" && rgbHex(fg) === T.board.dim); continue; }
      const f = rgbHex(bg), ink = rgbHex(fg);
      ok(`${v}: the ${text} chip is the palette's ${kind} (${f})`, f === chipFill(kind));
      ok(`${v}: its figure reads on it at ${contrast(ink, f).toFixed(2)}:1`, contrast(ink, f) >= 4.5);
      ok(`${v}: ...and the chip is ${contrast(f, T.board.face).toFixed(2)}:1 on the board`, contrast(f, T.board.face) >= 3);
    }
  }
  applyTheme("floodlit", "standard");
  ok("the wicket is a solid white chip with a black W",
     (() => { const m = html(h(Board, { ...PROPS, thisOver: ["W"] })).match(/data-chip="wicket" style="([^"]*)"/)?.[1] ?? "";
              return colourIn(m.match(/background:[^;]+/)[0], T.board.figure) && colourIn(m.match(/;color:[^;]+/)[0], T.board.face); })());
}

group("The Tier 2 line: spectator screens only, and it can be stopped (§10, WCAG 2.2.2)");
{
  const { INSIGHT_MS } = await import("../src/ui/board.jsx");
  const one = html(h(Board, { ...PROPS, insight: ["R Pillay needs 4 for fifty"] }));
  ok("one line is drawn, and needs no button", /R Pillay needs 4 for fifty/.test(one) && !/board-insight-pause/.test(one));
  const two = html(h(Board, { ...PROPS, insight: ["R Pillay needs 4 for fifty", "Projected 168 at 8.40 an over"] }));
  const btn = two.match(/<button[^>]*data-testid="board-insight-pause"[^>]*>/)?.[0] ?? "";
  ok("two lines take turns, the first first, with a pause button", /R Pillay needs 4 for fifty/.test(two) && !/Projected 168/.test(two) && !!btn);
  ok("...a real button, labelled for what it does", /type="button"/.test(btn) && /aria-label="Pause the rotating line"/.test(btn));
  ok("...44px square, the tap floor", /width:44px/.test(btn) && /height:44px/.test(btn));
  ok("...and the icon on it is board.figure on the face", colourIn(btn, T.board.figure) && contrast(T.board.figure, T.board.face) >= 3);
  ok("the line is not a live region (a screen reader is not interrupted every 8 s)", !/board-insight[^>]*aria-live/.test(two));
  ok("...but says where it is", /Insight 1 of 2: /.test(two));
  ok("it moves on every 8 s", INSIGHT_MS === 8000);
  ok("the new line slides in by class, which reduced motion cuts",
     /class="os-insight-in"/.test(two) && /\.os-insight-in\{animation:insightIn/.test(GLOBAL_CSS)
     && /prefers-reduced-motion: reduce\)\{[\s\S]*\.os-insight-in\{animation:none!important\}/.test(GLOBAL_CSS));
  ok("no insight, no row", !/board-insight/.test(out));
}

group("From the fold: one function for the pad and the day sheet");
{
  const { boardBall, boardFromInnings } = await import("../src/scorer/boardData.js");
  ok("a ball is written as the chip says it",
     [{ type: "run", value: 0 }, { type: "run", value: 4 }, { type: "W", value: 0 }, { type: "Wd", value: 0 }, { type: "Wd", value: 1 },
      { type: "Nb", value: 0 }, { type: "Nb", value: 4 }, { type: "B", value: 2 }, { type: "LB", value: 1 }].map(boardBall).join(" ")
     === "· 4 W wd 2wd nb 5nb 2b 1lb");
  const inn = {
    battingTeam: "Hilton 1st XI", runs: 142, wickets: 3, balls: 86, striker: "a", nonStriker: "b", bowler: "k",
    batsmen: [{ id: "a", name: "D Erasmus", runs: 5, balls: 1 }, { id: "b", name: "R Pillay", runs: 17, balls: 12 }],
    bowlers: [{ id: "k", name: "K Naidoo", wickets: 1, runs: 31, balls: 20 }],
    curPartner: { runs: 43, balls: 27, bat1: "a", bat2: "b" },
    overLog: [{ over: 14, balls: [{ type: "run", value: 4 }, { type: "Wd", value: 1 }] }],
  };
  const p = boardFromInnings(inn, { overs: 20 });
  ok("the partnership is the fold's curPartner, runs then balls", p.partnership?.runs === 43 && p.partnership?.balls === 27);
  ok("the striker is marked", p.batters.find((b) => b.onStrike)?.name === "D Erasmus");
  ok("this over is the current over's balls", p.thisOver.join(" ") === "4 2wd");
  const gone = boardFromInnings({ ...inn, nonStriker: null }, { overs: 20 });
  ok("with one of the pair out and the next not in, there is no partnership row", gone.partnership === undefined);
}

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

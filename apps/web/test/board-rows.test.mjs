/**
 * CRI-1.1: the board's two fixed rows — the last wicket ("R Naidoo c S Smith
 * b J Jones 34 (25)") and how fresh it is ("Updated 4 s ago · Live · Held 2")
 * — worked out from the fold (scorer/boardData.js lastWicketOf, lib/announce.js
 * freshnessWords) and drawn by the one Board (ui/board.jsx) the pad, the Match
 * Centre and the public page all draw. The pad draws neither row: its keys
 * must stay above the bottom bar on a 390×844 phone (§4 rule 1).
 *
 * Snapshots: each row's markup is held to a literal, and the same props give
 * the same row on all three surfaces. The public page's fold is made from a
 * log shaped as the server sends it (labels, pseudonyms), so its row says
 * what the public scorecard says — the label, never a name.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/board-rows.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inningsStart, batters, bowler, ball, retire, deriveInnings, deriveMatch, BALL_TYPE } from "@scrbrd/scoring";
import { Board, Freshness, lastWicketText } from "../src/ui/board.jsx";
import { boardFromInnings, lastWicketOf } from "../src/scorer/boardData.js";
import { agoShort, freshnessWords } from "../src/lib/announce.js";
import { foldable, unnamedToPositions } from "../src/public/publicLog.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${typeof d === "string" ? d : JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);
const html = (el) => renderToStaticMarkup(el);
/** One element's markup, by its test id: the <p …>…</p> it is. */
const rowOf = (markup, id) => markup.match(new RegExp(`<p data-testid="${id}"[^>]*>[\\s\\S]*?</p>`))?.[0] ?? null;
const textOf = (row) => (row ?? "").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const SQUAD = [{ id: "n", name: "R Naidoo" }, { id: "p", name: "K Pillay" }, { id: "c", name: "T Cele" }, { id: "m", name: "S Mthembu" }];
const open = [
  inningsStart({ battingTeam: "1XI", bowlingTeam: "Opp", squad: SQUAD, bowlingSquad: [{ id: "j", name: "J Jones" }, { id: "s", name: "S Smith" }], overs: 20 }),
  batters({ striker: "n", nonStriker: "p" }), bowler({ bowler: "j" }),
];
const ids = (evs) => evs.map((e, i) => ({ ...e, id: `e${i}` }));

group("The last wicket, from the fold");
{
  const none = deriveInnings(ids([...open, ball({ value: 4 })]));
  ok("no wicket yet: no row (a missing part is not drawn)", lastWicketOf(none) === undefined && boardFromInnings(none).lastWicket === undefined);

  const caught = deriveInnings(ids([...open, ball({ value: 4 }), ball({ value: 0 }),
    ball({ type: BALL_TYPE.WICKET, dismissal: "caught", fielder: "S Smith" })]));
  const lw = lastWicketOf(caught);
  ok("caught: the batter, the scorecard's own line, his runs and balls",
     JSON.stringify(lw) === JSON.stringify({ name: "R Naidoo", dismissal: "c S Smith b J Jones", runs: 4, balls: 3 }), lw);
  ok("...in words", lastWicketText(lw) === "R Naidoo c S Smith b J Jones 4 (3)", lastWicketText(lw));
  ok("...and on the board's props, so every screen that draws the board from the fold has it",
     JSON.stringify(boardFromInnings(caught).lastWicket) === JSON.stringify(lw));

  // A run out of the non-striker, then a bowled: the last is the bowled.
  const two = deriveInnings(ids([...open, ball({ value: 1 }),
    ball({ type: BALL_TYPE.WICKET, dismissal: "run_out", dismissed: "n", fielder: "S Smith" }),
    batters({ nonStriker: "c" }), ball({ value: 2 }), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]));
  ok("two wickets: the later one", lastWicketText(lastWicketOf(two)) === "K Pillay b J Jones 2 (3)", lastWicketText(lastWicketOf(two)));

  // A wicket with no delivery (retired out, Law 25.4.3) after a ball wicket.
  const nbw = deriveInnings(ids([...open, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }), batters({ striker: "c" }),
    ball({ value: 1 }), retire({ batter: "p", reason: "out" })]));
  ok("a wicket off no ball after one off a ball: the retirement", lastWicketText(lastWicketOf(nbw)) === "K Pillay retired out 0 (0)",
     lastWicketText(lastWicketOf(nbw)));

  // A free hit saves a bowled: no wicket, and the row stays on the one before.
  const saved = deriveInnings(ids([...open, ball({ type: BALL_TYPE.WICKET, dismissal: "caught", fielder: "S Smith" }), batters({ striker: "c" }),
    ball({ type: BALL_TYPE.NO_BALL, value: 0, nbType: "front_foot" }), ball({ type: BALL_TYPE.WICKET, value: 0, freeHit: true, dismissal: "bowled" })]));
  ok("a wicket a free hit saved is not the last wicket", saved.wickets === 1 && saved.ballLog.at(-1)?.freeHitSaved === true
     && lastWicketText(lastWicketOf(saved)) === "R Naidoo c S Smith b J Jones 0 (1)", lastWicketOf(saved));

  // A scorebook innings: no deliveries, the book's lines. Two out under one name and no row is drawn.
  const book = { fow: [{ runs: 10, wickets: 1, batsman: "Batter", overs: null }], batsmen: [
    { id: "x", name: "Batter", status: "out", dismissal: "b Bowler", runs: 3, balls: null },
    { id: "y", name: "Batter", status: "out", dismissal: "lbw b Bowler", runs: 7, balls: null }], ballLog: [], nonBallWickets: [] };
  ok("a scorebook's two wickets under one name: no guess", lastWicketOf(book) === undefined);
  const one = { ...book, batsmen: [book.batsmen[0]] };
  ok("...one under that name: his line, and no balls where the book has none", lastWicketText(lastWicketOf(one)) === "Batter b Bowler 3", lastWicketOf(one));
}

group("How fresh the board is, in words");
ok("just now, seconds, minutes, hours", agoShort(400) === "just now" && agoShort(4200) === "4 s ago" && agoShort(59_999) === "59 s ago"
   && agoShort(61_000) === "1 min ago" && agoShort(3 * 3_600_000 + 5) === "3 h ago");
ok("a clock that runs backwards is just now, never negative", agoShort(-5000) === "just now");
ok("\"Updated 4 s ago · Live · Held 2\"", freshnessWords({ at: 1_000, status: "Live", held: 2 }, 5_000) === "Updated 4 s ago · Live · Held 2");
ok("...a part not given is left out", freshnessWords({ at: 1_000, status: "Live" }, 5_000) === "Updated 4 s ago · Live"
   && freshnessWords({ status: "Live", held: 3 }) === "Live · Held 3" && freshnessWords({ held: 0 }) === "");

group("Snapshots: the rows, drawn by the one Board");
// The board's colours never switch with the theme (T.board), so its rows'
// markup is the same in Daylight and Floodlit, and is held here as it is drawn.
const LAST_WICKET_ROW = '<p data-testid="board-last-wicket" style="margin:0;font-family:&#x27;DM Sans&#x27;,sans-serif;font-size:13px;line-height:1.35;color:#f4f6f3;overflow-wrap:anywhere;font-variant-numeric:tabular-nums"><span style="color:#8a94a5">Last wicket</span> R Naidoo c S Smith b J Jones 4 (3)</p>';
const UPDATED_ROW = '<p data-testid="board-updated" style="margin:0;font-family:&#x27;DM Sans&#x27;,sans-serif;font-size:13px;line-height:1.35;color:#8a94a5;font-variant-numeric:tabular-nums">Updated 4 s ago · Live</p>';
{
  const inn = deriveInnings(ids([...open, ball({ value: 4 }), ball({ value: 0 }),
    ball({ type: BALL_TYPE.WICKET, dismissal: "caught", fielder: "S Smith" })]));
  const props = boardFromInnings(inn, { overs: 20 });
  const at = Date.now() - 4_000;
  const pad = html(h(Board, { ...props, compact: true }));
  const centre = html(h(Board, { ...props, size: "card", updated: { at, status: "Live" } }));
  const held = html(h(Board, { ...props, updated: { at, status: "Live", held: 2 } }));

  const padRow = rowOf(pad, "board-last-wicket");
  ok("a compact board's row: \"Last wicket R Naidoo c S Smith b J Jones 4 (3)\"", textOf(padRow) === "Last wicket R Naidoo c S Smith b J Jones 4 (3)", textOf(padRow));
  ok("...its markup, held to a literal (one <p>, the label dim, 13px body type)", padRow === LAST_WICKET_ROW, padRow ?? "");
  ok("the same row, byte for byte, on a compact board, the Match Centre's card and a board with a freshness row",
     padRow === rowOf(centre, "board-last-wicket") && padRow === rowOf(held, "board-last-wicket"));
  ok("a board given no `updated` draws no \"Updated\" row",
     rowOf(pad, "board-updated") === null && !/Updated/.test(pad));
  const fresh = rowOf(centre, "board-updated");
  ok("the Match Centre's row: \"Updated 4 s ago · Live\"", textOf(fresh) === "Updated 4 s ago · Live", textOf(fresh));
  ok("...with Held where a screen knows it: \"Updated 4 s ago · Live · Held 2\"", textOf(rowOf(held, "board-updated")) === "Updated 4 s ago · Live · Held 2");
  ok("...its markup, held to a literal (13px, dim, tabular, not a live region)", fresh === UPDATED_ROW, fresh ?? "");
  ok("the rows sit under the over and above the rotating line",
     centre.indexOf("board-last-wicket") > centre.indexOf("board-bowler") && centre.indexOf("board-updated") > centre.indexOf("board-last-wicket"));
  ok("nothing under 12px in either row", [padRow, fresh].every((r) => [...(r ?? "").matchAll(/font-size:(\d+)px/g)].every((m) => Number(m[1]) >= 12)));
  const bare = html(h(Board, { ...props, lastWicket: undefined }));
  ok("a board given neither row draws neither, and no rule for them", !/Last wicket|board-updated/.test(bare)
     && (bare.match(/border-top:1px solid/g) ?? []).length === (pad.match(/border-top:1px solid/g) ?? []).length - 1);
  ok("an empty `updated` draws no row", rowOf(html(h(Board, { total: 1, wickets: 0, updated: {} })), "board-updated") === null
     && !/border-top/.test(html(h(Board, { total: 1, wickets: 0, updated: {} }))));
}

group("The pad: the board without the last-wicket row (its keys stay above the bar)");
{
  const { PadBoard } = await import("../src/scorer/pad.jsx");
  const inn = deriveInnings(ids([...open, ball({ value: 4 }), ball({ value: 0 }),
    ball({ type: BALL_TYPE.WICKET, dismissal: "caught", fielder: "S Smith" })]));
  const padHtml = html(h(PadBoard, { inn, match: { overs: 20 }, target: null }));
  ok("the pad's board draws the score", /data-testid="board-runs"[^>]*>4</.test(padHtml) && /data-testid="pad-board"/.test(padHtml));
  ok("...and no last-wicket row, and no freshness row: not one row more than before CRI-1.1",
     !/board-last-wicket|board-updated|Last wicket|Updated/.test(padHtml));
  ok("...though its props carry the last wicket (the other screens draw it)", lastWicketText(boardFromInnings(inn).lastWicket) === "R Naidoo c S Smith b J Jones 4 (3)");
}

group("The screens CRI-1.1 does not cover pass no last wicket");
{
  // The coach's tab (SCRBRD-136), the captain's (SCRBRD-138, a governed
  // surface), the day sheet and the deck's day sheet draw the board from the
  // fold too; the row on them is a design change for later.
  const { readFileSync } = await import("node:fs");
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  for (const [f, needle] of [["views/cockpit/CoachTab.jsx", 'testid="coach-board"'], ["views/matchcentre/captainTab.jsx", 'testid="mc-captain-board"'],
    ["views/DashboardView.jsx", 'testid="day-board"'], ["scorer/pad.jsx", "compact/>"]]) {
    const line = src(f).split("\n").find((l) => l.includes("<Board") && l.includes(needle)) ?? "";
    ok(`${f}: its <Board> passes lastWicket={undefined}`, line.includes("lastWicket={undefined}"), line.trim());
  }
  ok("views/pitchdeck/demo.js: the deck's board props carry no last wicket", /lastWicket: undefined/.test(src("views/pitchdeck/demo.js")));
}

group("The public page: the row says the fold's labels, never a name");
{
  // The log as /api/public/matches/:id/log sends it: pseudonyms for every
  // player, squads labelled by publicName(), `people` naming only the consented.
  const A = "a1a1a1a1a1a1", B = "b2b2b2b2b2b2", C = "c3c3c3c3c3c3", X = "d4d4d4d4d4d4", F = "f6f6f6f6f6f6";
  let seq = 0;
  const ev = (o) => ({ innings: 0, seq: ++seq, id: `e${String(seq).padStart(15, "0")}`, clientTs: 1_790_000_000_000 + seq * 1000, ...o });
  const events = [
    ev({ kind: "innings_start", battingTeam: "1XI", bowlingTeam: "Kearsney College 1XI", teamKey: "1XI", bowlingTeamKey: "Kearsney College 1XI",
      squad: [{ id: A, label: "D Erasmus" }, { id: B, label: "Batter" }, { id: C, label: "Batter" }], bowlingSquad: [{ id: X, label: "Bowler" }], overs: 5 }),
    ev({ kind: "batters", striker: A, nonStriker: B }),
    ev({ kind: "bowler", bowler: X }),
    ev({ kind: "ball", type: "run", value: 1 }),
    ev({ kind: "ball", type: "W", value: 0, dismissal: "caught", fielder: F }),
    ev({ kind: "batters", striker: C }),
    ev({ kind: "ball", type: "run", value: 4 }),
    ev({ kind: "ball", type: "W", value: 0, dismissal: "caught", fielder: A }),
  ];
  const people = { [A]: "D Erasmus" };
  const fold = deriveMatch(foldable(events, people));
  unnamedToPositions(fold.innings, people);
  const props = boardFromInnings(fold.innings[0], { overs: 5 });
  const out = html(h(Board, { ...props, size: "card", testid: "mc-board", updated: { at: Date.now(), status: "Live" } }));
  const row = textOf(rowOf(out, "mc-board-last-wicket"));
  ok("an unnamed boy caught by the consented one: \"Last wicket Batter c D Erasmus b Bowler 4 (2)\"",
     row === "Last wicket Batter c D Erasmus b Bowler 4 (2)", row);
  ok("...no pseudonym in the row", ![A, B, C, X, F].some((p) => row.includes(p)));
  const first = deriveMatch(foldable(events.slice(0, 5), people));
  unnamedToPositions(first.innings, people);
  const row1 = textOf(rowOf(html(h(Board, boardFromInnings(first.innings[0], { overs: 5 }))), "board-last-wicket"));
  ok("a fielder nobody names is \"Fielder\", as the public scorecard says him", row1 === "Last wicket Batter c Fielder b Bowler 0 (1)", row1);
  ok("the freshness row names nobody: \"Updated just now · Live\"", textOf(rowOf(out, "mc-board-updated")) === "Updated just now · Live");
}

group("The tick is the row's, not the board's");
{
  // Board itself holds no state and sets no timer: the once-a-second tick is
  // Freshness's own, so it re-renders those words and nothing else.
  const src = Board.toString();
  ok("Board sets no interval and holds no state", !/setInterval|useState|useEffect/.test(src));
  ok("Freshness keeps the interval", /setInterval/.test(Freshness.toString()) && /1e3|1000/.test(Freshness.toString()));
  ok("...and no animation class on its words (nothing for reduced motion to stop)", !/className/.test(Freshness.toString()));
}

console.log(`\n${"─".repeat(52)}\nBOARD ROWS (CRI-1.1): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// "At this rate" (scorer/boardData.js atThisRate): a first innings' total if it
// keeps its run rate to the end of its overs — plain arithmetic, hidden when it
// would say nothing. The Match Centre and public walks (smoke-browser-matchcentre,
// smoke-browser-public) assert the line on a real board.
import { deriveInnings, inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";
import { atThisRate, boardFromInnings } from "../src/scorer/boardData.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

// A folded innings, by hand where the arithmetic is the point …
const inn = (runs, balls, more = {}) => ({ runs, balls, complete: false, wickets: 0, ...more });

console.log("A. The arithmetic");
ok("7 off 4 balls, 10 overs: 7 + 7/4 × 56 = 105", atThisRate(inn(7, 4), { overs: 10 }) === 105);
ok("50 off 36, 20 overs: 50 + 50/36 × 84 = 166.67 → 167", atThisRate(inn(50, 36), { overs: 20 }) === 167);
ok("10 off 7, 5 overs: 10 + 10/7 × 23 = 42.86 → 43", atThisRate(inn(10, 7), { overs: 5 }) === 43);
ok("the exact run rate over the overs left, nothing else: 6 an over from 12 balls is 120 off 20", atThisRate(inn(12, 12), { overs: 20 }) === 120);
ok("no weight for wickets: the same runs and balls give the same, with 0 or 7 down", atThisRate(inn(50, 36, { wickets: 0 }), { overs: 20 }) === atThisRate(inn(50, 36, { wickets: 7 }), { overs: 20 }));
ok("a duck so far is a projection of nought — it says what the rate says", atThisRate(inn(0, 12), { overs: 20 }) === 0);
ok("a revised limit is the limit: 40 off 24 in a 12-over innings = 40 + 40/24 × 48 = 120", atThisRate(inn(40, 24), { overs: 12 }) === 120);
ok("in the last over it is nearly the score: 99 off 119 of 120 = 99 + 99/119 = 99.83 → 100", atThisRate(inn(99, 119), { overs: 20 }) === 100);

console.log("\nB. Left off");
ok("the second innings (the required rate is on the board)", atThisRate(inn(50, 36), { overs: 20, chasing: true }) === null);
ok("no legal ball yet", atThisRate(inn(0, 0), { overs: 20 }) === null);
ok("...even with runs: a first-ball wide is a run and no ball", atThisRate(inn(1, 0), { overs: 20 }) === null);
ok("a declaration format has no over limit", ["Two-Day", "One-Day Declaration", "timed", "Declaration", "multi-day"].every((f) => atThisRate(inn(50, 36), { overs: 100, format: f }) === null));
ok("...while limited-overs formats and an unstated one show it",
   ["T20", "T10", "One-Day", "50-over", null, ""].every((f) => atThisRate(inn(50, 36), { overs: 20, format: f }) === 167));
ok("no overs to reckon against", [null, undefined, 0, -1, NaN, 12.5].every((o) => atThisRate(inn(50, 36), { overs: o }) === null));
ok("the innings is over", atThisRate(inn(150, 100, { complete: true }), { overs: 20 }) === null);
ok("...and when every ball has been bowled, whatever the flag says", atThisRate(inn(150, 120), { overs: 20 }) === null);
ok("nothing to fold", atThisRate(null, { overs: 20 }) === null && atThisRate(undefined) === null);

console.log("\nC. From a real fold");
const head = [
  inningsStart({ battingTeam: "1XI", bowlingTeam: "Opp", teamKey: "1XI", bowlingTeamKey: "Opp",
    squad: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], bowlingSquad: [{ id: "x", name: "X" }], overs: 10 }),
  batters({ striker: "a", nonStriker: "b" }), bowler({ bowler: "x" }),
];
const fold = (more) => deriveInnings([...head, ...more].map((e, i) => ({ ...e, innings: 0, id: `e${i}` })));
const four = fold([ball({ value: 4 }), ball({ value: 1 }), ball({ value: 0 }), ball({ value: 2 })]);
ok("7 off 4 legal balls folds to 7 off 4", four.runs === 7 && four.balls === 4, `${four.runs}/${four.balls}`);
ok("...and projects 105 over 10", atThisRate(four, { overs: 10 }) === 105);
const wide = fold([ball({ type: BALL_TYPE.WIDE, value: 0 })]);
ok("a first-ball wide: a run, no legal ball, no line", wide.runs === 1 && wide.balls === 0 && atThisRate(wide, { overs: 10 }) === null, `${wide.runs}/${wide.balls}`);
const wides = fold([ball({ type: BALL_TYPE.WIDE, value: 0 }), ball({ value: 1 }), ball({ value: 1 })]);
ok("a wide adds a run, not a ball: 3 off 2 → 3 + 3/2 × 58 = 90", wides.runs === 3 && wides.balls === 2 && atThisRate(wides, { overs: 10 }) === 90, `${wides.runs}/${wides.balls}`);
const done = fold(Array.from({ length: 60 }, () => ball({ value: 1 })));
ok("ten overs bowled: the innings is over, and the line is gone", done.balls === 60 && atThisRate(done, { overs: 10 }) === null, `${done.balls} ${done.complete}`);

console.log("\nD. On the board");
const plain = boardFromInnings(four, { overs: 10 });
ok("without `projected` the board is as it was", plain.sub === "CRR 10.50", plain.sub);
const shown = boardFromInnings(four, { overs: 10, projected: atThisRate(four, { overs: 10 }) });
ok("with it, the line sits beside the run rate", shown.sub === "CRR 10.50 · At this rate: 105", shown.sub);
const chase = boardFromInnings(four, { target: 120, overs: 10, projected: null });
ok("a chase is untouched", /^Need 113 off 56 · CRR 10.50 · RRR /.test(chase.sub) && !/At this rate/.test(chase.sub), chase.sub);

console.log(`\nAT THIS RATE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

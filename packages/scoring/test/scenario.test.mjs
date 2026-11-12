/**
 * Scenario controls (GA-I29 A0; docs/design/SCENARIO_AND_TREND_design.md
 * §A2–§A4): every figure S1–S10 and every sentence of A3, against the
 * design's hand figures, in whole numbers where a rounding could lie.
 *
 *   A. The figures, one per row of A2 (S1–S10), on the hand innings
 *   B. The exact comparisons: 132.6 against 133, by the rate so far and by X
 *   C. The words, one per row of A3, and the two sketches whole
 *   D. When the panel is drawn (A4), and the one minimum of 12 balls (A-D8)
 *   E. Folded logs: the last five overs (S6) with a void and penalty runs, a
 *      cut first innings, a revised chase, a nine-boy squad, and S10's
 *      "level" held to describeResult() on a revised chase (§"could not settle" 2)
 *   F. Never written: a percentage, "chance", "likely", "will", a player
 *
 *   node packages/scoring/test/scenario.test.mjs
 */
import {
  scenarioOf, scenarioHidden, scenarioBase, projectedTotal, ownRateChaseLine, openingHalves,
  runRate, totalAt, chaseAt, chaseWords, lastOvers, rateOfHalves, rateText, levelIsTie, SCENARIO_MIN_BALLS, SCENARIO_RATE, SCENARIO_FOOTNOTE,
  deriveMatch, describeResult, inningsStart, batters, bowler, ball, voidEvent, penalty, revision, playStopped,
  OUTCOME, BALL_TYPE,
} from "../src/index.mjs";
import { rainLog } from "./rain-logs.mjs";

/** @import { LogEvent } from "../src/events.mjs" */

let pass = 0, fail = 0;
/** The words one short by `short` runs, in this chase's conditions. @param {any} m  @param {number} short */
const chaseWordsOf = (m, short) => chaseWords({ reached: false, finish: 26 - short, short }, levelIsTie(m.innings[1]?.overs ?? 0, m.innings[1]?.conditions));
/** @param {string} n  @param {unknown} c  @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 600)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

/** A folded innings by hand, where the arithmetic is the point. @param {Record<string, any>} o */
const inn = (o) => ({ runs: 0, balls: 0, wickets: 0, overs: 20, complete: false, squad: [], conditions: {}, target: null, ...o });
/** The design's chase: T 133, 88 for 4 off 86 (14.2 overs) of 20. A first innings of 132 before it. */
const FIRST132 = inn({ runs: 132, balls: 120, complete: true });
const CHASE = inn({ runs: 88, balls: 86, wickets: 4, target: 133 });
/** The design's first innings: 87 for 3 off 72 (12 overs) of 20. */
const FIRST = inn({ runs: 87, balls: 72, wickets: 3 });
/** A chase, after a first innings of one less than its target (so the target is not revised). @param {any} c  @param {Record<string, any>} [o] */
const chase = (c, o = {}) => scenarioOf({ innings: [c.target === 133 ? FIRST132 : { ...FIRST132, runs: c.target - 1 }, c], index: 1, target: c.target, ...o });
/** @param {any} f  @param {Record<string, any>} [o] */
const first = (f, o = {}) => scenarioOf({ innings: [f], index: 0, ...o });
/** @param {any} s  @param {string} key */
const line = (s, key) => s?.lines.find((/** @type {any} */ l) => l.key === key)?.text ?? null;

group("A. The figures (A2)");
{
  const f = /** @type {any} */ (scenarioBase(CHASE));
  ok("S1: 6R ÷ b — 528 ÷ 86 = 6.14", runRate(88, 86)?.toFixed(2) === "6.14" && runRate(87, 72) === 7.25);
  ok("...null before a legal ball", runRate(5, 0) === null);
  ok("S2: L = N − b — 120 − 86 = 34", f.N === 120 && f.L === 34, f);
  ok("S3: wickets in hand, wicketsToEnd() − W — 10 − 4 = 6", f.inHand === 6 && f.most === 10, f);
  const s = /** @type {any} */ (chase(CHASE));
  ok("S4: need 45; RRR 270 ÷ 34 = 7.94; a ball 1.32", s.figures.need === 45 && s.figures.rrr === "7.94" && /1\.32 a ball/.test(line(s, "need") ?? ""), s.figures);
  ok("S5: round(R + X·L ÷ 6) — 87 + 7.5 × 48 ÷ 6 = 147", totalAt(87, 48, rateOfHalves(15)) === 147);
  ok("...at the rate so far it is R·N ÷ b — 87 × 120 ÷ 72 = 145", totalAt(87, 48, { r: 87, q: 72 }) === 145);
  ok("...at the last five overs' 41 in 30: 87 + 41 × 48 ÷ 30 = 152.6 → 153", totalAt(87, 48, { r: 41, q: 30 }) === 153);
  ok("S7: X = 8.0, 12·88 + 16·34 = 1600 ≥ 1596: reached in ⌈270 ÷ 8⌉ = 34, none to spare",
     JSON.stringify(chaseAt(88, 133, 34, rateOfHalves(16))) === JSON.stringify({ reached: true, balls: 34, spare: 0 }));
  ok("...X = 8.5: ⌈31.76⌉ = 32 balls, 2 to spare", JSON.stringify(chaseAt(88, 133, 34, rateOfHalves(17))) === JSON.stringify({ reached: true, balls: 32, spare: 2 }));
  ok("...X = 9.0: 30 balls, 4 to spare", /** @type {any} */ (chaseAt(88, 133, 34, rateOfHalves(18))).spare === 4);
  ok("...X = 7.5: short, ⌊88 + 42.5⌋ = 130, 3 short", JSON.stringify(chaseAt(88, 133, 34, rateOfHalves(15))) === JSON.stringify({ reached: false, finish: 130, short: 3 }));
  ok("S8: at the rate so far, 88·120 = 10 560 < 133·86 = 11 438: ⌊122.79⌋ = 122, 11 short",
     JSON.stringify(chaseAt(88, 133, 34, { r: 88, q: 86 })) === JSON.stringify({ reached: false, finish: 122, short: 11 }));
  ok("...the last five overs' 41 in 30: reached in ⌈45·30 ÷ 41⌉ = 33, 1 to spare",
     JSON.stringify(chaseAt(88, 133, 34, { r: 41, q: 30 })) === JSON.stringify({ reached: true, balls: 33, spare: 1 }));
  ok("...a rate of nought never gets there", /** @type {any} */ (chaseAt(88, 133, 34, { r: 0, q: 12 })).reached === false);
  const out = /** @type {any} */ (chase(inn({ runs: 60, balls: 114, wickets: 2, target: 100 })));
  ok("S9: need 40 > 6 × 6 = 36: out of reach off the bat", /more than six off every ball/.test(line(out, "need") ?? ""), out?.lines);
  const exactly = /** @type {any} */ (chase(inn({ runs: 64, balls: 114, wickets: 2, target: 100 })));
  ok("...need 36 off 6 is not (six sixes)", !/more than six/.test(line(exactly, "need") ?? ""), line(exactly, "need"));
  ok("S10: level at need = 1", /^Scores level/.test(line(chase(inn({ runs: 132, balls: 111, wickets: 5, target: 133 })), "need") ?? ""));
  ok("...the last ball at L = 1", /^Last ball/.test(line(chase(inn({ runs: 130, balls: 119, wickets: 5, target: 133 })), "need") ?? ""));
}

group("A2. One rate formatter (S1): the board's CRR and RRR, the insight and the panel say one figure");
{
  ok("81 off 80 balls is 6.07 (the board's own figure, not 6.08)", rateText(81, 80) === "6.07");
  ok("...in the panel's first innings", line(first(inn({ runs: 81, balls: 80 })), "own")?.startsWith("At their rate so far (6.07 an over)"), line(first(inn({ runs: 81, balls: 80 })), "own"));
  ok("...and in projectedTotal(), which the insight and \"At this rate\" read", projectedTotal(inn({ runs: 81, balls: 80 }))?.crr === "6.07");
  ok("...as a required rate: need 81 off 80 is 6.07", /^Needs 81 off 80 balls: 6\.07 an over/.test(line(chase(inn({ runs: 52, balls: 40, target: 133 })), "need") ?? ""),
     line(chase(inn({ runs: 52, balls: 40, target: 133 })), "need"));
  ok("no ball, no rate", rateText(5, 0) === null);
}

group("B. Exact, never rounded up (A2: 132.6 against 133)");
{
  // 34 off 20 of 13 overs projects 34 × 78 ÷ 20 = 132.6.
  const c = inn({ runs: 34, balls: 20, wickets: 1, overs: 13, target: 133 });
  ok("the rate so far: 34·78 = 2652 < 133·20 = 2660, so not reached — though 132.6 rounds to 133",
     JSON.stringify(chaseAt(34, 133, 58, { r: 34, q: 20 })) === JSON.stringify({ reached: false, finish: 132, short: 1 }));
  ok('...the words: "they would finish on 132, 1 short: scores level"',
     line(chase(c), "own") === "At their rate so far (10.20 an over): they would finish on 132, 1 short: scores level", line(chase(c), "own"));
  // 66 off 13 of 10 overs at 8.5: 66 + 17 × 47 ÷ 12 = 132.58.
  const x = inn({ runs: 66, balls: 13, wickets: 0, overs: 10, target: 133 });
  ok("at X = 8.5: 12·66 + 17·47 = 1591 < 1596, not reached; ⌊132.58⌋ = 132",
     JSON.stringify(chaseAt(66, 133, 47, rateOfHalves(17))) === JSON.stringify({ reached: false, finish: 132, short: 1 }));
  ok("...the stepper's line says so", line(chase(x, { halves: 17 }), "at") === "If they score at 8.5 an over: they would finish on 132, 1 short: scores level",
     line(chase(x, { halves: 17 }), "at"));
  ok("...and at 9.0: 1584 + 18·47 = 1638 ≥ 1596, reached in ⌈12·67 ÷ 18⌉ = 45, 2 to spare",
     line(chase(x, { halves: 18 }), "at") === "If they score at 9.0 an over: they would get there with 2 balls to spare");
  ok("the opening rate is the RRR rounded UP to the half: 12·67 ÷ 47 = 17.1 → 9.0 (the least that gets there)",
     openingHalves({ R: 66, b: 13, L: 47 }, 133) === 18 && /** @type {any} */ (chase(x)).halves === 18);
  ok("...in the design's chase 7.94 → 8.0", openingHalves({ R: 88, b: 86, L: 34 }, 133) === 16);
  ok("...a first innings opens on the rate so far to the nearest half: 7.25 → 7.5", openingHalves({ R: 87, b: 72, L: 48 }, null) === 15);
  ok("...nought runs opens at the least, 0.5", openingHalves({ R: 0, b: 12, L: 108 }, null) === 1);
  ok("...a required rate past 18 opens at 18.0", openingHalves({ R: 10, b: 100, L: 20 }, 133) === 36);
  ok("the stepper holds 0.5 to 18.0", SCENARIO_RATE.min === 0.5 && SCENARIO_RATE.max === 18 && SCENARIO_RATE.step === 0.5);
  ok("...a rate outside it is not taken: the opening stands", /** @type {any} */ (chase(CHASE, { halves: 37 })).halves === 16
     && /** @type {any} */ (chase(CHASE, { halves: 0 })).halves === 16 && /** @type {any} */ (chase(CHASE, { halves: 15.5 })).halves === 16);
}

group("C. The words (A3)");
{
  const s = /** @type {any} */ (first(FIRST));
  ok("the first innings, at the rate so far", line(s, "own") === "At their rate so far (7.25 an over): 145 off 20 overs", line(s, "own"));
  ok("...the stepper at 7.5", line(s, "at") === "If they score at 7.5 an over: 147", line(s, "at"));
  ok("...its three parts, the rate between the buttons", JSON.stringify(s.lines.find((/** @type {any} */ l) => l.key === "at").stepper)
     === JSON.stringify({ lead: "If they score at", rate: "7.5", tail: "an over: 147" }));
  ok('..."7 wickets in hand · 48 balls left (8 overs)"', line(s, "hand") === "7 wickets in hand · 48 balls left (8 overs)", line(s, "hand"));
  ok("...the source line's window and basis: 12 of 20 overs, from 72 balls", s.source.window === "12 of 20 overs" && s.source.balls === 72, s.source);
  ok("...the footnote", s.footnote === "Arithmetic on the score so far, not a forecast. It does not allow for wickets still to fall.");

  const c = /** @type {any} */ (chase(CHASE));
  ok('the chase: "Needs 45 off 34 balls: 7.94 an over, 1.32 a ball"', line(c, "need") === "Needs 45 off 34 balls: 7.94 an over, 1.32 a ball", line(c, "need"));
  ok('..."6 wickets in hand"', line(c, "hand") === "6 wickets in hand");
  ok('..."At their rate so far (6.14 an over): they would finish on 122, 11 short"',
     line(c, "own") === "At their rate so far (6.14 an over): they would finish on 122, 11 short", line(c, "own"));
  ok('..."If they score at 8.0 an over: they would get there off the last ball"',
     line(c, "at") === "If they score at 8.0 an over: they would get there off the last ball", line(c, "at"));
  ok("...in the sketch's order", c.lines.map((/** @type {any} */ l) => l.key).join() === "need,hand,own,at", c.lines.map((/** @type {any} */ l) => l.key));
  ok("...window 14.2 of 20 overs, from 86 balls", c.source.window === "14.2 of 20 overs" && c.source.balls === 86);

  ok('reached with balls to spare: "they would get there with 4 balls to spare"',
     line(chase(CHASE, { halves: 18 }), "at") === "If they score at 9.0 an over: they would get there with 4 balls to spare");
  ok('...one: "with 1 ball to spare"', ownRateChaseLine(inn({ runs: 100, balls: 60, overs: 20, target: 198 }), { target: 198 })
     === "At their rate so far (10.00 an over): they would get there with 1 ball to spare");
  ok('short: "they would finish on 122, 11 short"', /they would finish on 122, 11 short$/.test(line(c, "own") ?? ""));
  ok("CRR nought after 12 balls: the S8 line is left out, the stepper offered",
     (() => { const z = /** @type {any} */ (chase(inn({ runs: 0, balls: 12, target: 133 }))); return line(z, "own") === null && line(z, "at") != null; })());
  ok('out of reach: "Needs 40 off 6 balls: more than six off every ball, so only extras can get there."',
     line(chase(inn({ runs: 60, balls: 114, wickets: 2, target: 100 })), "need") === "Needs 40 off 6 balls: more than six off every ball, so only extras can get there.");
  ok("...and the stepper is still offered, arithmetic like the others",
     line(chase(inn({ runs: 60, balls: 114, wickets: 2, target: 100 }), { halves: 36 }), "at") === "If they score at 18.0 an over: they would finish on 78, 22 short");
  ok('scores level, balls left: "Scores level. Needs 1 off 9 balls"',
     line(chase(inn({ runs: 132, balls: 111, wickets: 5, target: 133 })), "need") === "Scores level. Needs 1 off 9 balls");
  ok('the last ball: "Last ball: 3 to win, 2 to tie"', line(chase(inn({ runs: 130, balls: 119, wickets: 5, target: 133 })), "need") === "Last ball: 3 to win, 2 to tie");
  ok('...need 1: "Last ball: 1 to win; scores are level"', line(chase(inn({ runs: 132, balls: 119, wickets: 5, target: 133 })), "need") === "Last ball: 1 to win; scores are level");
  ok('one wicket left: "1 wicket in hand", no other word', line(chase(inn({ runs: 88, balls: 86, wickets: 9, target: 133 })), "hand") === "1 wicket in hand");
  ok("...and in a first innings, with the balls", line(first(inn({ runs: 87, balls: 114, wickets: 9 })), "hand") === "1 wicket in hand · 6 balls left (1 over)");
  ok("the footnote beside the par estimate", /** @type {any} */ (chase(CHASE, { estimate: true })).footnote
     === "Arithmetic on the score so far, not a forecast. The par estimate above is a separate reading of this ground's par.");
  ok("...the two footnotes, as A3 gives them", SCENARIO_FOOTNOTE.plain.startsWith("Arithmetic on the score so far, not a forecast. ")
     && SCENARIO_FOOTNOTE.withEstimate.endsWith("separate reading of this ground's par."));
  const stopped = /** @type {any} */ (chase({ ...CHASE, stopped: { balls: 86 } }));
  ok('play stopped: the first line, "Play stopped. These use the target and overs as they stand."',
     stopped.lines[0].key === "stopped" && stopped.lines[0].text === "Play stopped. These use the target and overs as they stand.");
  ok("...and the panel stays", line(stopped, "need") != null && line(stopped, "at") != null);
  const nr = /** @type {any} */ (chase(inn({ runs: 30, balls: 30, overs: 8, target: 70, conditions: { "result.min_overs_per_side": 10 } })));
  ok('a short chase that would be a no result: "Under this match\'s conditions, a chase of fewer than 10 overs that runs out of overs short of the target is a no result."',
     line(nr, "no_result") === "Under this match's conditions, a chase of fewer than 10 overs that runs out of overs short of the target is a no result.", nr?.lines);
  ok("...not where the chase has the overs", line(chase(inn({ runs: 30, balls: 30, overs: 10, target: 70, conditions: { "result.min_overs_per_side": 10 } })), "no_result") === null);
}

group("D. When it is drawn (A4), and the one minimum (A-D8)");
{
  ok("the minimum is 12 legal balls", SCENARIO_MIN_BALLS === 12);
  ok("11 balls: not drawn", first(inn({ runs: 10, balls: 11 })) === null && scenarioHidden({ inn: inn({ runs: 10, balls: 11 }) }) === "too_few_balls");
  ok("12 balls: drawn", first(inn({ runs: 10, balls: 12 })) !== null);
  ok("...and every projection follows it: projectedTotal() at 11 and 12", projectedTotal(inn({ runs: 10, balls: 11 })) === null
     && projectedTotal(inn({ runs: 10, balls: 12 }))?.runs === 100);
  ok("...the chase's own-rate line too", ownRateChaseLine(inn({ runs: 10, balls: 11, target: 133 }), { target: 133 }) === null
     && ownRateChaseLine(inn({ runs: 10, balls: 12, target: 133 }), { target: 133 }) != null);
  ok("a declaration or timed match: none", ["Two-Day", "timed", "One-Day Declaration"].every((format) => first(FIRST, { format }) === null));
  ok("...a limited-overs one, or one unstated: drawn", ["T20", "One-Day", null].every((format) => first(FIRST, { format }) !== null));
  ok("a super over: none", first({ ...FIRST, superOver: 1 }) === null);
  ok("a scorebook's innings: none", first({ ...FIRST, summarised: { runs: 87 } }) === null);
  ok("a completed innings: none", first({ ...FIRST, complete: true }) === null);
  ok("the innings break: none", first(FIRST, { atBreak: true }) === null);
  ok("a decided match: none", chase(CHASE, { decided: true }) === null);
  ok("a chase with the target reached: none", chase(inn({ runs: 133, balls: 86, target: 133 })) === null);
  ok("no balls left: none", first(inn({ runs: 150, balls: 120 })) === null);
  ok("no allotment to reckon against: none", first(inn({ runs: 50, balls: 36, overs: null })) === null);
  ok("an allotment given by the board stands over the innings' own", /** @type {any} */ (first(inn({ runs: 50, balls: 36, overs: null }), { overs: 10 })).source.window === "6 of 10 overs");
}

/** @param {number} t  runs in an over of six legal balls, `w` of them wickets first @param {number} [w] @returns {(number | "W")[]} */
const over = (t, w = 0) => {
  const n = 6 - w, base = Math.floor(t / n), more = t - base * n;
  return [...Array.from({ length: w }, () => /** @type {"W"} */ ("W")), ...Array.from({ length: n }, (_, i) => base + (i < more ? 1 : 0))];
};
/** @param {number} n  @param {number} v */
const runs = (n, v) => Array.from({ length: n }, () => v);

group("E. Folded logs");
{
  // The design's first innings: 46 at the end of the 7th over, 87/3 off 12.
  const steps = [...over(6, 1), ...over(6), ...over(7, 1), ...over(7), ...over(6, 1), ...over(7), ...over(7),
                 ...over(8), ...over(8), ...over(8), ...over(8), ...over(9)];
  const log = rainLog([{ bat: "1XI", bowl: "Kearsney", overs: 20, steps, seal: false }]);
  const m = deriveMatch(log);
  const i0 = m.innings[0];
  ok("the log folds to 87/3 off 72", i0?.runs === 87 && i0.wickets === 3 && i0.balls === 72, i0 && [i0.runs, i0.wickets, i0.balls]);
  const five = lastOvers(log, {}, 0, i0);
  ok("S6: overs 8 to 12, 41 in 30 balls", JSON.stringify(five) === JSON.stringify({ runs: 41, balls: 30, from: 8, to: 12 }), five);
  const s = /** @type {any} */ (scenarioOf({ innings: m.innings, index: 0, events: log }));
  ok('"At the last five overs\' rate (8.20 an over, 30 balls): 153"', line(s, "five") === "At the last five overs' rate (8.20 an over, 30 balls): 153", line(s, "five"));
  ok("...the first innings' sketch, line for line",
     JSON.stringify(s.lines.map((/** @type {any} */ l) => l.text)) === JSON.stringify([
       "At their rate so far (7.25 an over): 145 off 20 overs",
       "At the last five overs' rate (8.20 an over, 30 balls): 153",
       "If they score at 7.5 an over: 147",
       "7 wickets in hand · 48 balls left (8 overs)",
     ]), s.lines.map((/** @type {any} */ l) => l.text));
  ok("...without the log, the S6 line is left out", line(scenarioOf({ innings: m.innings, index: 0 }), "five") === null);

  // A ball in the 13th over, voided: the fold and every figure are as before.
  const extra = { ...ball({ type: BALL_TYPE.RUN, value: 6 }), innings: 0, id: "extra-6", clientTs: 1 };
  const voided = [...log, extra, { ...voidEvent({ target: "extra-6" }), innings: 0, id: "void-6", clientTs: 2 }];
  const mv = deriveMatch(voided);
  ok("a void leaves the fold, and the panel says what it said", JSON.stringify(scenarioOf({ innings: mv.innings, index: 0, events: voided })?.lines)
     === JSON.stringify(s.lines), scenarioOf({ innings: mv.innings, index: 0, events: voided })?.lines);
  // A void inside the window: the six in the 12th over's last ball goes, and so does a ball of the window.
  const lastBall = log.filter((e) => e.kind === "ball").at(-1);
  const inWindow = [...log, { ...voidEvent({ target: /** @type {any} */ (lastBall).id }), innings: 0, id: "void-last", clientTs: 3 }];
  const mw = deriveMatch(inWindow);
  ok("...a void inside the window moves it: 11.5, and the last five completed are overs 7 to 11",
     mw.innings[0]?.balls === 71 && lastOvers(inWindow, {}, 0, mw.innings[0])?.from === 7, lastOvers(inWindow, {}, 0, mw.innings[0]));
  // Five penalty runs to the batting side in the 10th over: in R, and in the window.
  const at10 = log.findIndex((e, k) => e.kind === "ball" && log.slice(0, k + 1).filter((x) => x.kind === "ball").length === 57);
  const pen = [...log.slice(0, at10), { ...penalty({ runs: 5, toBattingTeam: true, reason: "helmet_struck" }), innings: 0, id: "pen-5", clientTs: 4 }, ...log.slice(at10)];
  const mp = deriveMatch(pen);
  ok("penalty runs count as the fold counts them: 92, and 46 in the last five", mp.innings[0]?.runs === 92
     && lastOvers(pen, {}, 0, mp.innings[0])?.runs === 46, [mp.innings[0]?.runs, lastOvers(pen, {}, 0, mp.innings[0])]);
  // At exactly five overs the window is the innings from its start; at four, there is none.
  const fiveOvers = rainLog([{ bat: "1XI", bowl: "Kearsney", overs: 20, steps: runs(30, 1), seal: false }]);
  const f5 = deriveMatch(fiveOvers).innings[0];
  ok("five overs completed: the window is overs 1 to 5, from the start", JSON.stringify(lastOvers(fiveOvers, {}, 0, f5)) === JSON.stringify({ runs: 30, balls: 30, from: 1, to: 5 }));
  const fourOvers = rainLog([{ bat: "1XI", bowl: "Kearsney", overs: 20, steps: runs(29, 1), seal: false }]);
  ok("...four overs and five balls: none", lastOvers(fourOvers, {}, 0, deriveMatch(fourOvers).innings[0]) === null);

  // A first innings the umpires cut to 16 with no stop open.
  const cut = [...log, { ...revision({ overs: 16, reason: "rain" }), innings: 0, id: "cut-16", clientTs: 5 }];
  const mc = deriveMatch(cut);
  const sc = /** @type {any} */ (scenarioOf({ innings: mc.innings, index: 0, events: cut }));
  ok('a cut first innings: "116 off 16 overs (revised from 20)" (87 × 96 ÷ 72)', line(sc, "own") === "At their rate so far (7.25 an over): 116 off 16 overs (revised from 20)", line(sc, "own"));
  ok("...the balls left are the new allotment's", line(sc, "hand") === "7 wickets in hand · 24 balls left (4 overs)" && sc.source.window === "12 of 16 overs", [line(sc, "hand"), sc.source]);

  // A chase revised by the umpires: 30 to win off 5 overs, stopped at 1.0 and cut to 4 overs, 26 to win.
  const rev = rainLog([{ bat: "1XI", bowl: "Kearsney", overs: 5, steps: runs(30, 1) },
                       { bat: "Kearsney", bowl: "1XI", overs: 5, target: 31,
                         steps: [...runs(6, 1), { stop: "rain" }, { rev: { overs: 4, target: 26 } }, { resume: true }, ...runs(7, 1)], seal: false }]);
  const mr = deriveMatch(rev);
  const sr = /** @type {any} */ (scenarioOf({ innings: mr.innings, index: 1, target: mr.innings[1]?.target ?? null, events: rev }));
  ok("a revised chase: 13 off 13, 26 to win off 4 overs", mr.innings[1]?.runs === 13 && mr.innings[1]?.target === 26 && mr.innings[1]?.overs === 4,
     mr.innings[1] && [mr.innings[1].runs, mr.innings[1].target, mr.innings[1].overs]);
  ok('...the S4 line takes the suffix: "Needs 13 off 11 balls (revised): 7.09 an over, 1.18 a ball"',
     line(sr, "need") === "Needs 13 off 11 balls (revised): 7.09 an over, 1.18 a ball", line(sr, "need"));
  ok('...and one more line: "If play stops again the umpires may change the target and the overs."',
     line(sr, "again") === "If play stops again the umpires may change the target and the overs.", sr?.lines);
  // The lead, 12 Nov: the tie words follow describeResult()'s tie rule, revised target or not (below: 25 against a revised 26 is a tie).
  ok('...one short of a revised target is "scores level", as describeResult() calls it a tie',
     line(scenarioOf({ innings: mr.innings, index: 1, target: 26, halves: 14 }), "at") === "If they score at 7.0 an over: they would finish on 25, 1 short: scores level",
     line(scenarioOf({ innings: mr.innings, index: 1, target: 26, halves: 14 }), "at"));
  const dls = rainLog([{ bat: "1XI", bowl: "Kearsney", overs: 5, steps: runs(30, 1) },
                       { bat: "Kearsney", bowl: "1XI", overs: 5, target: 31,
                         steps: [...runs(6, 1), { stop: "rain" }, { rev: { overs: 4, target: 26 } }, { resume: true }, ...runs(7, 1)], seal: false }],
                      { conditions: { "target.method": "dls_standard" } });
  const md = deriveMatch(dls, { conditions: { "target.method": "dls_standard" } });
  ok('...under DLS: "(DLS)"', /^Needs 13 off 11 balls \(DLS\): /.test(line(scenarioOf({ innings: md.innings, index: 1, target: 26 }), "need") ?? ""),
     line(scenarioOf({ innings: md.innings, index: 1, target: 26 }), "need"));

  // §"could not settle" 2: T − 1 is a tie under describeResult() — unrevised, and after an umpires' revision.
  const tieRev = rainLog([{ bat: "1XI", bowl: "Kearsney", overs: 5, steps: runs(30, 1) },
                          { bat: "Kearsney", bowl: "1XI", overs: 5, target: 31,
                            steps: [...runs(6, 1), { stop: "rain" }, { rev: { overs: 4, target: 26 } }, { resume: true }, ...runs(17, 1), 2] }]);
  const tr = deriveMatch(tieRev);
  ok("describeResult(): a revised chase that ends on T − 1 (25 against 26) is a tie", tr.innings[1]?.runs === 25
     && describeResult(tr.innings)?.outcome === OUTCOME.TIE, [tr.innings[1]?.runs, describeResult(tr.innings)?.outcome]);
  const tieFlat = rainLog([{ bat: "1XI", bowl: "Kearsney", overs: 5, steps: runs(30, 1) }, { bat: "Kearsney", bowl: "1XI", overs: 5, steps: runs(30, 1) }]);
  ok("...and an unrevised one on T − 1 (30 against 31)", describeResult(deriveMatch(tieFlat).innings)?.outcome === OUTCOME.TIE);
  ok("...and the last ball says the tie, revised: \"Last ball: 3 to win, 2 to tie\"",
     line(scenarioOf({ innings: deriveMatch(rainLog([{ bat: "1XI", bowl: "Kearsney", overs: 5, steps: runs(30, 1) },
       { bat: "Kearsney", bowl: "1XI", overs: 5, target: 31, steps: [...runs(6, 1), { stop: "rain" }, { rev: { overs: 4, target: 26 } }, { resume: true }, ...runs(17, 1)], seal: false }])).innings,
       index: 1, target: 26 }), "need") === "Last ball: 3 to win, 2 to tie");

  // Under the match's fewest overs (result.min_overs_per_side 5), a chase cut to 4 overs that ends one short
  // is a NO RESULT, not a tie: the panel says no tie, and describeResult() agrees.
  const MIN5 = { "result.min_overs_per_side": 5 };
  const cutPlans = (/** @type {(number | "W" | {stop: string} | {resume: true} | {rev: {overs?: number, target?: number}})[]} */ tail, /** @type {false | undefined} */ seal) => rainLog([
    { bat: "1XI", bowl: "Kearsney", overs: 5, steps: runs(30, 1) },
    { bat: "Kearsney", bowl: "1XI", overs: 5, target: 31, steps: [...runs(6, 1), { stop: "rain" }, { rev: { overs: 4, target: 26 } }, { resume: true }, ...tail], seal }],
    { conditions: MIN5 });
  const cutNow = deriveMatch(cutPlans(runs(17, 1), false), { conditions: MIN5 });
  const sm = /** @type {any} */ (scenarioOf({ innings: cutNow.innings, index: 1, target: 26 }));
  ok("a chase cut to 4 overs under a minimum of 5, 3 off the last ball: \"Last ball: 3 to win\", no tie", line(sm, "need") === "Last ball: 3 to win", line(sm, "need"));
  ok("...and the no-result line says why", line(sm, "no_result") === "Under this match's conditions, a chase of fewer than 5 overs that runs out of overs short of the target is a no result.", sm?.lines);
  ok("...no line of it says \"tie\" or \"scores level\"", sm.lines.every((/** @type {any} */ l) => !/\btie\b|scores level/.test(l.text)), sm.lines.map((/** @type {any} */ l) => l.text));
  ok("...one short at a stepper rate: \"1 short\", no \"scores level\"", line(scenarioOf({ innings: cutNow.innings, index: 1, target: 26, halves: 1 }), "at") === "If they score at 0.5 an over: they would finish on 23, 3 short"
     && chaseWordsOf(cutNow, 1) === "they would finish on 25, 1 short", chaseWordsOf(cutNow, 1));
  const cutEnd = deriveMatch(cutPlans([...runs(17, 1), 2], undefined), { conditions: MIN5 });
  ok("describeResult(): ending on 25 against 26 there is a no result", cutEnd.innings[1]?.runs === 25
     && describeResult(cutEnd.innings, { conditions: MIN5 })?.outcome === OUTCOME.NO_RESULT, [cutEnd.innings[1]?.runs, describeResult(cutEnd.innings, { conditions: MIN5 })?.outcome]);
  ok("ownRateChaseLine() keeps the same rule (no \"scores level\" under the minimum)", levelIsTie(4, MIN5) === false && levelIsTie(5, MIN5) === true && levelIsTie(4, {}) === true);

  // A nine-boy squad: eight wickets end the innings, so 3 down is 5 in hand.
  const nine = Array.from({ length: 9 }, (_, k) => ({ id: `u${k}`, name: `U ${k + 1}` }));
  /** @type {LogEvent[]} */
  const j = [inningsStart({ battingTeam: "U13A", bowlingTeam: "Opp", squad: nine, bowlingSquad: [], overs: 10 }),
             batters({ striker: "u0", nonStriker: "u1" }), bowler({ bowler: "x" })];
  for (let k = 0; k < 15; k++) j.push(ball({ type: k < 3 ? BALL_TYPE.WICKET : BALL_TYPE.RUN, value: k < 3 ? 0 : 1, ...(k < 3 ? { dismissal: "bowled" } : {}) }));
  const jl = j.map((e, k) => ({ ...e, innings: 0, id: `nine-${k}`, clientTs: k }));
  const mj = deriveMatch(jl);
  const sj = /** @type {any} */ (scenarioOf({ innings: mj.innings, index: 0 }));
  ok("a nine-boy squad: 3 down off 15 is \"5 wickets in hand\"", mj.innings[0]?.wickets === 3 && line(sj, "hand") === "5 wickets in hand · 45 balls left (7.3 overs)", line(sj, "hand"));
  ok("...7 down, \"1 wicket in hand\"", line(first(inn({ runs: 40, balls: 30, wickets: 7, overs: 10, squad: nine })), "hand")?.startsWith("1 wicket in hand · "));

  // The stopped flag from the fold, the panel kept.
  const st = [...log, { ...playStopped({ reason: "rain", at: 9 }), innings: 0, id: "stop-1", clientTs: 9 }];
  const ms = deriveMatch(st);
  ok("play stopped, from the fold: the first line, and the rest kept", /** @type {any} */ (scenarioOf({ innings: ms.innings, index: 0, events: st }))?.lines[0]?.key === "stopped"
     && line(scenarioOf({ innings: ms.innings, index: 0, events: st }), "five") != null);
}

group("F. Never written");
{
  const NEVER = /%|\bchance\b|\blikely\b|\bfavourite|\bon track\b|\bshould\b|\bwill\b/i;
  const all = [
    first(FIRST), chase(CHASE), chase(CHASE, { halves: 18 }), chase(CHASE, { estimate: true }), chase(inn({ runs: 60, balls: 114, target: 100 })),
    chase(inn({ runs: 132, balls: 111, target: 133 })), chase(inn({ runs: 130, balls: 119, target: 133 })), first(inn({ runs: 87, balls: 114, wickets: 9 })),
  ].flatMap((s) => [...(s?.lines ?? []).map((/** @type {any} */ l) => l.text), s?.footnote ?? ""]);
  ok(`no percentage, "chance", "likely", "favourites", "on track", "should" or "will" in ${all.length} lines`, all.length > 30 && all.every((t) => !NEVER.test(t)),
     all.filter((t) => NEVER.test(t)));
  ok("the lines are conditional: \"would\", never \"will\"", all.filter((t) => /they would/.test(t)).length >= 5);
  ok("no line carries a player's name: the scenario reads the innings' figures only", all.every((t) => !/Erasmus|Pillay|Botha|U \d/.test(t)));
}

console.log(`\nSCENARIO: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

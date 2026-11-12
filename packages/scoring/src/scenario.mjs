/**
 * SCRBRD — scenario controls (GA-I29; docs/design/SCENARIO_AND_TREND_design.md
 * Part A). Kameel, 11 Nov 2026: "probability and forecasts are based
 * scoring-rates and overs and what's achievable etc."
 *
 * Arithmetic on the innings' own record and nothing else (A-D1): a rate times
 * balls, a difference, a count. Nothing is fitted, nothing reads another
 * match, and nothing here prints a percentage (A-D2): the par estimate
 * (CRI-1.8, pressure.mjs parEstimate()) is the board's one percentage and is
 * not touched. The words are conditional ("they would finish on 122"), never
 * a forecast (A-D3).
 *
 *   S1  run rate so far          6R ÷ b
 *   S2  balls left               L = N − b
 *   S3  wickets in hand          wicketsToEnd() − W
 *   S4  needed, required rate    T − R; 6·need ÷ L; need ÷ L
 *   S5  a first innings at X     round(R + X·L ÷ 6)
 *   S6  the last five overs      6·(R_k − R_{k−5}) ÷ (b_k − b_{k−5}), completed overs
 *   S7  a chase at X             reached when 6R + X·L ≥ 6T, exactly
 *   S8  a chase at its own rate  S7 with X = S1, exactly: R·N ≥ T·b
 *   S9  out of reach off the bat need > 6L
 *   S10 level, and the last ball need = 1; L = 1
 *
 * R the runs (extras and penalty runs in, as the fold adds them), b the legal
 * balls, N the allotment as it now stands (`inn.overs × 6`, revised if the
 * umpires revised it), W the wickets, T the target as it stands (revised
 * where it was). A rate is carried as a fraction — r runs in q balls — so
 * every comparison is in whole numbers: X in halves is h runs in 12 balls,
 * the rate so far R runs in b balls, the last five overs' r₅ in b₅. At 132.6
 * projected against 133 the exact test says "not reached", where rounding
 * would say "reached" (A2: "the chase must take the exact one").
 *
 * THIS MODULE is what every surface draws — the board's "At this rate", the
 * "Projected" insight and the chase's own-rate line, the ground display's
 * rotation — and so it is in the public page's static graph. The panel's own
 * sentences (S4, S6, S9, S10, the stepper, the footnote) are
 * scenario-panel.mjs's, which only the lazy panel imports.
 *
 * One minimum (A-D8, Q3): nothing is projected before 12 legal balls, on any
 * surface. Team level only (A-D6): no function here reads or writes a
 * player's name. Pure: the fold in, figures and words out.
 */
import { wicketsToEnd } from "./replay.mjs";
import { formatKind } from "./format.mjs";

/** No projection, on any surface, before this many legal balls (A-D8, Q3: two overs). */
export const SCENARIO_MIN_BALLS = 12;

/** The stepper's rates, runs an over: 0.5 to 18.0 in halves (A2). */
export const SCENARIO_RATE = Object.freeze({ step: 0.5, min: 0.5, max: 18 });

/** @param {number} a  @param {number} b  whole numbers, b > 0: ⌈a ÷ b⌉ */
const ceilDiv = (a, b) => Math.ceil(a / b);
/** @param {number} a  @param {number} b  whole numbers, b > 0: a ÷ b to the nearest, a half up */
const roundDiv = (a, b) => Math.floor((2 * a + b) / (2 * b));
/** @param {number} n  @param {string} one  @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * A rate in runs an over, two places — "7.94" — from r runs in q legal balls.
 * THE one formatter for a run rate and a required rate on every screen: the
 * board's CRR and RRR (scorer/format.js RR(), boardData.js chaseLine(),
 * lib/par.js), the insight and the scenario panel, so one rate is never two
 * figures on one screen (81 off 80 is 6.07 everywhere). Null with no ball.
 * @param {number} r  @param {number} q
 */
export function rateText(r, q) {
  if (!(q > 0)) return null;
  return (((r / q) * 6) || 0).toFixed(2);
}

/**
 * A rate as runs in balls: `{r, q}`, r ≥ 0 runs every q > 0 legal balls.
 * @typedef {{r: number, q: number}} Rate
 */

/** X runs an over, in halves (h = 2X), as a rate: h runs in 12 balls. @param {number} h @returns {Rate} */
export const rateOfHalves = (h) => ({ r: h, q: 12 });

/**
 * The innings' figures the scenarios stand on, or null where there is
 * nothing to divide: no innings, no allotment, no legal ball.
 * @param {any} inn  a folded innings
 * @param {number | null} [overs]  its allotment; the innings' own (`inn.overs`) when not given
 */
export function scenarioBase(inn, overs = null) {
  if (!inn) return null;
  const ov = Number.isInteger(overs) ? /** @type {number} */ (overs) : inn.overs;
  if (!Number.isInteger(ov) || ov <= 0) return null;
  const R = inn.runs ?? 0, b = inn.balls ?? 0, N = ov * 6;
  const most = wicketsToEnd(inn);
  return { R, b, N, L: N - b, W: inn.wickets ?? 0, inHand: Math.max(0, most - (inn.wickets ?? 0)), most, overs: ov };
}

/** S1: runs an over so far, or null before a legal ball. @param {number} R  @param {number} b */
export const runRate = (R, b) => (b > 0 ? (6 * R) / b : null);

/**
 * S5: a first innings' total at a rate, to its allotment, to the nearest run.
 * @param {number} R  @param {number} L  @param {Rate} rate
 */
export const totalAt = (R, L, { r, q }) => roundDiv(R * q + r * L, q);

/**
 * S7: a chase at a rate, to its allotment. Reached when R + r·L ÷ q ≥ T,
 * compared in whole numbers; then the balls it takes, ⌈need·q ÷ r⌉, and the
 * balls to spare. Short: the total it would finish on, never rounded up
 * (⌊R + r·L ÷ q⌋), and the runs short of the target.
 * @param {number} R  @param {number} T  @param {number} L  @param {Rate} rate
 * @returns {{reached: true, balls: number, spare: number} | {reached: false, finish: number, short: number}}
 */
export function chaseAt(R, T, L, { r, q }) {
  const need = T - R;
  if (need <= 0) return { reached: true, balls: 0, spare: L };
  if (r > 0 && R * q + r * L >= T * q) {
    const balls = ceilDiv(need * q, r);
    return { reached: true, balls, spare: L - balls };
  }
  const finish = Math.floor((R * q + r * L) / q);
  return { reached: false, finish, short: T - finish };
}

/**
 * The fewest overs a chase may be allotted and still be decided when it runs
 * out of overs short (`result.min_overs_per_side`), or null where the match's
 * conditions set none.
 * @param {Readonly<Record<string, unknown>> | null | undefined} conditions
 */
export function minOversOf(conditions) {
  const least = conditions?.["result.min_overs_per_side"];
  return typeof least === "number" && Number.isInteger(least) && least > 0 ? least : null;
}

/**
 * May the panel say "scores level" and "to tie" of a chase that ends one
 * short? Exactly where describeResult() would call it a tie (replay.mjs: one
 * short of the target as it stands, revised or not, is a tie) — and not where
 * the chase's allotment is under `result.min_overs_per_side`, which makes it
 * a no result first. The panel and the result never disagree.
 * @param {number} overs  the chase's allotment  @param {Readonly<Record<string, unknown>> | null | undefined} conditions
 */
export function levelIsTie(overs, conditions) {
  const least = minOversOf(conditions);
  return !(least != null && overs < least);
}

/**
 * "with 4 balls to spare", "off the last ball", "they would finish on 122, 11
 * short", and one short ": scores level" where that is a tie (levelIsTie()).
 * @param {ReturnType<typeof chaseAt>} c  @param {boolean} tie
 */
export function chaseWords(c, tie) {
  if (c.reached) return c.spare > 0 ? `they would get there with ${plural(c.spare, "ball", "balls")} to spare` : "they would get there off the last ball";
  return `they would finish on ${c.finish}, ${c.short} short${c.short === 1 && tie ? ": scores level" : ""}`;
}

/**
 * Whether the panel is drawn (A4), and why not.
 * @param {{inn: any, target?: number | null, overs?: number | null, format?: unknown, decided?: boolean, atBreak?: boolean}} o
 * @returns {string | null}  null: drawn; else the reason it is not
 */
export function scenarioHidden({ inn, target = null, overs = null, format = null, decided = false, atBreak = false }) {
  if (!inn) return "no_innings";
  if (formatKind(format) === "declaration") return "declaration";
  if (inn.superOver != null) return "super_over";
  if (inn.summarised != null) return "scorebook";
  if (inn.complete) return "complete";
  if (atBreak) return "break";
  if (decided) return "decided";
  const f = scenarioBase(inn, overs);
  if (!f) return "no_allotment";
  if (f.b < SCENARIO_MIN_BALLS) return "too_few_balls";
  if (f.L <= 0) return "no_balls_left";
  if (target != null && target - f.R <= 0) return "target_reached";
  return null;
}

/**
 * The first innings' projection at its own rate, at the one minimum: what
 * the board's "At this rate" and the "Projected" insight say. Null where the
 * panel would be left off (scenarioHidden()) or in a chase.
 * @param {any} inn  @param {{overs?: number | null, format?: unknown, chasing?: boolean}} [o]
 * @returns {{runs: number, crr: string, overs: number} | null}
 */
export function projectedTotal(inn, { overs = null, format = null, chasing = false } = {}) {
  if (chasing || scenarioHidden({ inn, overs, format })) return null;
  const f = /** @type {NonNullable<ReturnType<typeof scenarioBase>>} */ (scenarioBase(inn, overs));
  return { runs: totalAt(f.R, f.L, { r: f.R, q: f.b }), crr: /** @type {string} */ (rateText(f.R, f.b)), overs: f.overs };
}

/**
 * The chase's line at its own rate (S8), as the board's insight rotation and
 * the ground display say it: "At their rate so far (6.14 an over): they
 * would finish on 122, 11 short". Null where the panel would be left off,
 * and when no run is scored yet (A3: "the S8 line is left out").
 * @param {any} inn  @param {{target: number | null, overs?: number | null, format?: unknown}} o
 */
export function ownRateChaseLine(inn, { target, overs = null, format = null }) {
  if (target == null || scenarioHidden({ inn, target, overs, format })) return null;
  const f = /** @type {NonNullable<ReturnType<typeof scenarioBase>>} */ (scenarioBase(inn, overs));
  if (f.R <= 0) return null;
  return `At their rate so far (${rateText(f.R, f.b)} an over): ${chaseWords(chaseAt(f.R, target, f.L, { r: f.R, q: f.b }), levelIsTie(f.overs, inn.conditions))}`;
}

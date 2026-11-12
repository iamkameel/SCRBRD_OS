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
 * One minimum (A-D8, Q3): nothing is projected before 12 legal balls, on any
 * surface. `atThisRate()` (apps/web scorer/boardData.js) and the board's
 * "Projected" insight (scorer/signals.js boardInsights()) are this module's
 * callers.
 *
 * Team level only (A-D6): no function here reads or writes a player's name.
 * Pure: the fold (and, for S6, the log) in, figures and words out.
 */
import { revisedTargetMethod, wicketsToEnd } from "./replay.mjs";
import { inningsAtOverEnds, inningsAtStart, rainTouched } from "./pressure.mjs";
import { formatKind } from "./format.mjs";
import { oversOf } from "./potm.mjs";

/** No projection, on any surface, before this many legal balls (A-D8, Q3: two overs). */
export const SCENARIO_MIN_BALLS = 12;

/** The stepper's rates, runs an over: 0.5 to 18.0 in halves (A2). */
export const SCENARIO_RATE = Object.freeze({ step: 0.5, min: 0.5, max: 18 });

/** The last five overs (S6): completed overs. */
export const LAST_OVERS = 5;

/** What the footnote says (A3). */
export const SCENARIO_FOOTNOTE = Object.freeze({
  plain: "Arithmetic on the score so far, not a forecast. It does not allow for wickets still to fall.",
  withEstimate: "Arithmetic on the score so far, not a forecast. The par estimate above is a separate reading of this ground's par.",
});

const H_MIN = SCENARIO_RATE.min * 2, H_MAX = SCENARIO_RATE.max * 2;

/** @param {number} a  @param {number} b  whole numbers, b > 0: ⌈a ÷ b⌉ */
const ceilDiv = (a, b) => Math.ceil(a / b);
/** @param {number} a  @param {number} b  whole numbers, b > 0: a ÷ b to the nearest, a half up */
const roundDiv = (a, b) => Math.floor((2 * a + b) / (2 * b));
/** @param {number} n  @param {string} one  @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** A rate in runs an over, two places: "7.94". @param {number} r  @param {number} q */
const perOver = (r, q) => ((6 * r) / q).toFixed(2);
/** A stepper rate, one place: "8.0". @param {number} h  halves */
const halvesText = (h) => (h / 2).toFixed(1);
/** @param {number} h */
const clampHalves = (h) => Math.min(H_MAX, Math.max(H_MIN, h));

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
 * S6: the last five completed overs, from the log as it now stands: runs and
 * legal balls between the end of over k − 5 (or the innings' start, when
 * k = 5) and the end of over k, each folded as pressure.mjs chaseRates()
 * folds them, so penalty runs and voids count as the fold counts them. Null
 * before five overs are completed, or with no log.
 * @param {any[] | null | undefined} events  the match's log
 * @param {any} ctx  the fold context
 * @param {number} n  the innings' place in deriveMatch()'s list
 * @param {any} inn  that innings, folded whole
 * @returns {{runs: number, balls: number, from: number, to: number} | null}  `from`..`to` the overs, 1-based
 */
export function lastOvers(events, ctx, n, inn) {
  if (!Array.isArray(events) || !inn || inn.summarised != null) return null;
  const k = Math.floor((inn.balls ?? 0) / 6);
  if (k < LAST_OVERS) return null;
  const ends = inningsAtOverEnds(events, ctx ?? {}, n, { only: k > LAST_OVERS ? [k, k - LAST_OVERS] : [k] });
  const last = ends.find((e) => e.over === k)?.innings?.[n];
  const back = k > LAST_OVERS ? ends.find((e) => e.over === k - LAST_OVERS)?.innings?.[n]
    : inningsAtStart(events, ctx ?? {}, n, inn)?.[n] ?? { runs: 0, balls: 0 };
  if (!last || !back) return null;
  const runs = (last.runs ?? 0) - (back.runs ?? 0), balls = (last.balls ?? 0) - (back.balls ?? 0);
  if (!(balls > 0)) return null;
  return { runs, balls, from: k - LAST_OVERS + 1, to: k };
}

/**
 * "20 overs", or the allotment the umpires cut, as boardData.js rainLine()
 * says it: "16 overs (revised from 20)", or "(revised)" where the figure
 * before is not on the fold.
 * @param {any} inn  @param {number} overs
 */
function allotmentWords(inn, overs) {
  const moved = (inn.interruptions ?? []).find((/** @type {any} */ i) => i.oversAtResume != null && i.oversAtResume !== i.oversAtStop);
  const from = Number.isInteger(inn.startOvers) && inn.startOvers !== overs ? inn.startOvers
    : moved && moved.oversAtStop !== overs ? moved.oversAtStop : null;
  const revised = from != null || inn.revised?.overs != null || moved != null || (inn.overCuts?.length ?? 0) > 0;
  return `${plural(overs, "over", "overs")}${from != null ? ` (revised from ${from})` : revised ? " (revised)" : ""}`;
}

/** "with 4 balls to spare", "off the last ball", "they would finish on 122, 11 short". @param {ReturnType<typeof chaseAt>} c  @param {boolean} levelWords */
function chaseWords(c, levelWords) {
  if (c.reached) return c.spare > 0 ? `they would get there with ${plural(c.spare, "ball", "balls")} to spare` : "they would get there off the last ball";
  return `they would finish on ${c.finish}, ${c.short} short${c.short === 1 && levelWords ? ": scores level" : ""}`;
}

/**
 * The stepper's opening rate, in halves (A2): in a first innings the rate so
 * far to the nearest half; in a chase the required rate rounded UP to the
 * next half — the smallest rate offered that gets there.
 * @param {{R: number, b: number, L: number}} f  @param {number | null} target
 */
export function openingHalves({ R, b, L }, target) {
  if (target != null) {
    const need = target - R;
    return clampHalves(need > 0 && L > 0 ? ceilDiv(12 * need, L) : H_MIN);
  }
  return clampHalves(b > 0 ? roundDiv(12 * R, b) : H_MIN);
}

/** A rate the stepper may hold, in halves, or null. @param {unknown} h */
const validHalves = (h) => (Number.isInteger(h) && /** @type {number} */ (h) >= H_MIN && /** @type {number} */ (h) <= H_MAX ? /** @type {number} */ (h) : null);

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
  return { runs: totalAt(f.R, f.L, { r: f.R, q: f.b }), crr: perOver(f.R, f.b), overs: f.overs };
}

/**
 * Was the chase's target revised (rain), so that "scores level" is left off
 * the short-by-one line (A3: "Short by one, unrevised target")? From the
 * match's innings where the caller has them (replay.mjs
 * revisedTargetMethod(), the result's own rule); else the innings' own
 * record of a revision or a par.
 * @param {any} inn  @param {any[] | null} innings  @param {Readonly<Record<string, unknown>>} conditions
 */
function targetRevised(inn, innings, conditions) {
  if (Array.isArray(innings)) return revisedTargetMethod(innings.filter((x) => x != null && x.superOver == null), conditions) != null;
  return inn.revised?.target != null || inn.par != null;
}

/**
 * The chase's line at its own rate (S8), as the board's insight rotation and
 * the ground display say it: "At their rate so far (6.14 an over): they
 * would finish on 122, 11 short". Null where the panel would be left off,
 * and when no run is scored yet (A3: "the S8 line is left out").
 * @param {any} inn  @param {{target: number | null, overs?: number | null, format?: unknown, innings?: any[] | null}} o
 */
export function ownRateChaseLine(inn, { target, overs = null, format = null, innings = null }) {
  if (target == null || scenarioHidden({ inn, target, overs, format })) return null;
  const f = /** @type {NonNullable<ReturnType<typeof scenarioBase>>} */ (scenarioBase(inn, overs));
  if (f.R <= 0) return null;
  const conditions = inn.conditions ?? {};
  return `At their rate so far (${perOver(f.R, f.b)} an over): ${chaseWords(chaseAt(f.R, target, f.L, { r: f.R, q: f.b }), !targetRevised(inn, innings, conditions))}`;
}

/**
 * @typedef {object} ScenarioLine
 * @property {string} key   "stopped" | "own" | "five" | "at" | "hand" | "need" | "no_result" | "again"
 * @property {string} text  the whole sentence
 * @property {{lead: string, rate: string, tail: string}} [stepper]  the "at" line in its three parts, the rate between the buttons
 */

/**
 * @typedef {object} Scenario
 * @property {"first_innings" | "chase"} kind
 * @property {ScenarioLine[]} lines   in the order the panel reads
 * @property {string} footnote
 * @property {{window: string, balls: number}} source  the <SourceLine>'s Window and Basis
 * @property {number} halves    the stepper's rate, in halves (2X)
 * @property {number} opening   where the stepper opens, in halves
 * @property {{min: number, max: number}} bounds  in halves
 * @property {Record<string, number | string | null>} figures  S1–S4 and S6, for a test or a caption
 */

/**
 * The scenario panel (A2, A3): every line in its words, or null where it is
 * not drawn (A4).
 *
 * @param {object} o
 * @param {any[]} o.innings   the match's innings as folded (deriveMatch()'s list)
 * @param {number} o.index    the innings on the board
 * @param {number | null} [o.target]   the chase's target as it stands (matchChaseOf()); null in a first innings
 * @param {number | null} [o.overs]    the allotment as the board reads it (`inn.overs`, else the fixture's)
 * @param {unknown} [o.format]         match.format
 * @param {number | null} [o.halves]   the reader's rate, in halves; null: the opening rate
 * @param {any[] | null} [o.events]    the log, for the last five overs (S6); null leaves that line out
 * @param {any} [o.ctx]                the fold context
 * @param {boolean} [o.decided]        play has decided the match
 * @param {boolean} [o.atBreak]        the innings break
 * @param {boolean} [o.estimate]       the par estimate is on the board (the footnote says they are separate)
 * @returns {Scenario | null}
 */
export function scenarioOf({ innings, index, target = null, overs = null, format = null, halves = null, events = null, ctx = {},
                             decided = false, atBreak = false, estimate = false }) {
  const inn = innings?.[index];
  if (scenarioHidden({ inn, target, overs, format, decided, atBreak })) return null;
  const f = /** @type {NonNullable<ReturnType<typeof scenarioBase>>} */ (scenarioBase(inn, overs));
  const { R, b, N, L } = f;
  const conditions = inn.conditions ?? ctx?.conditions ?? {};
  const opening = openingHalves(f, target);
  const h = validHalves(halves) ?? opening;
  const X = rateOfHalves(h);
  const crr = { r: R, q: b };
  const five = lastOvers(events, ctx, index, inn);
  const fiveRate = five ? perOver(five.runs, five.balls) : null;
  const fiveHead = five ? `At the last five overs' rate (${fiveRate} an over, ${plural(five.balls, "ball", "balls")})` : null;
  /** @type {ScenarioLine[]} */
  const lines = [];
  if (inn.stopped != null) lines.push({ key: "stopped", text: "Play stopped. These use the target and overs as they stand." });
  const at = (/** @type {string} */ tail) => {
    const lead = "If they score at", rate = halvesText(h), unit = "an over";
    lines.push({ key: "at", text: `${lead} ${rate} ${unit}: ${tail}`, stepper: { lead, rate, tail: `${unit}: ${tail}` } });
  };
  const ovL = oversOf(L);
  const ballsLeft = `${plural(L, "ball left", "balls left")} (${ovL === "1" ? "1 over" : `${ovL} overs`})`;
  const hand = plural(f.inHand, "wicket in hand", "wickets in hand");

  if (target == null) {
    lines.push({ key: "own", text: `At their rate so far (${perOver(R, b)} an over): ${totalAt(R, L, crr)} off ${allotmentWords(inn, f.overs)}` });
    if (five) lines.push({ key: "five", text: `${fiveHead}: ${totalAt(R, L, { r: five.runs, q: five.balls })}` });
    at(String(totalAt(R, L, X)));
    lines.push({ key: "hand", text: `${hand} · ${ballsLeft}` });
  } else {
    const need = target - R;
    const rained = rainTouched(innings, conditions);
    const method = conditions?.["target.method"];
    const suffix = rained ? (method === "dls_standard" ? " (DLS)" : " (revised)") : "";
    const level = !targetRevised(inn, innings, conditions);
    const off = `off ${plural(L, "ball", "balls")}${suffix}`;
    let head;
    if (L === 1) head = need === 1 ? "Last ball: 1 to win; scores are level" : `Last ball: ${need} to win, ${need - 1} to tie`;
    else if (need > 6 * L) head = `Needs ${need} ${off}: more than six off every ball, so only extras can get there.`;
    else if (need === 1) head = `Scores level. Needs 1 ${off}`;
    else head = `Needs ${need} ${off}: ${perOver(need, L)} an over, ${(need / L).toFixed(2)} a ball`;
    lines.push({ key: "need", text: head });
    lines.push({ key: "hand", text: hand });
    if (R > 0) lines.push({ key: "own", text: `At their rate so far (${perOver(R, b)} an over): ${chaseWords(chaseAt(R, target, L, crr), level)}` });
    if (five) lines.push({ key: "five", text: `${fiveHead}: ${chaseWords(chaseAt(R, target, L, { r: five.runs, q: five.balls }), level)}` });
    at(chaseWords(chaseAt(R, target, L, X), level));
    const least = conditions?.["result.min_overs_per_side"];
    if (typeof least === "number" && Number.isInteger(least) && least > 0 && f.overs < least) {
      lines.push({ key: "no_result", text: `Under this match's conditions, a chase of fewer than ${least} overs that falls short is a no result.` });
    }
    if (rained) lines.push({ key: "again", text: "If play stops again the umpires may change the target and the overs." });
  }
  return {
    kind: target == null ? "first_innings" : "chase",
    lines,
    footnote: estimate ? SCENARIO_FOOTNOTE.withEstimate : SCENARIO_FOOTNOTE.plain,
    source: { window: `${oversOf(b)} of ${f.overs} overs`, balls: b },
    halves: h, opening, bounds: { min: H_MIN, max: H_MAX },
    figures: {
      runs: R, balls: b, allotted: N, left: L, wickets: f.W, inHand: f.inHand, crr: perOver(R, b),
      need: target == null ? null : target - R, rrr: target == null ? null : perOver(target - R, L),
      lastFive: fiveRate, lastFiveBalls: five?.balls ?? null,
    },
  };
}

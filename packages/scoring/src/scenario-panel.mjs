/**
 * SCRBRD — the scenario panel's sentences (GA-I29 A1;
 * docs/design/SCENARIO_AND_TREND_design.md §A2–§A4): every line the
 * Match Centre's Scenarios panel reads, from scenario.mjs's arithmetic.
 *
 * A module of its own because only the panel draws these, and the panel is a
 * lazy chunk of the public page (apps/web views/matchcentre/scenario.jsx):
 * what every surface needs — "At this rate", the insight lines — stays in
 * scenario.mjs, in the public page's static graph, and these follow the panel
 * into its chunk (tools/check-bundle.mjs holds that graph to its ceiling).
 *
 * Pure: the fold (and, for the last five overs, the log) in, words out.
 */
import { rainTouched, inningsAtOverEnds, inningsAtStart } from "./pressure.mjs";
import { oversOf } from "./potm.mjs";
import {
  SCENARIO_RATE, rateText, rateOfHalves, scenarioBase, scenarioHidden, totalAt, chaseAt, chaseWords, levelIsTie, minOversOf,
} from "./scenario.mjs";

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
/** A stepper rate, one place: "8.0". @param {number} h  halves */
const halvesText = (h) => (h / 2).toFixed(1);
/** @param {number} h */
const clampHalves = (h) => Math.min(H_MAX, Math.max(H_MIN, h));
/** @param {number} r  @param {number} q  q > 0 */
const perOver = (r, q) => /** @type {string} */ (rateText(r, q));

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
 * @param {{runs: number, balls: number} | null} [o.five]  lastOvers()'s answer, where the caller has it already (it folds the log)
 * @param {boolean} [o.decided]        play has decided the match
 * @param {boolean} [o.atBreak]        the innings break
 * @param {boolean} [o.estimate]       the par estimate is on the board (the footnote says they are separate)
 * @returns {Scenario | null}
 */
export function scenarioOf({ innings, index, target = null, overs = null, format = null, halves = null, events = null, ctx = {},
                             five = undefined, decided = false, atBreak = false, estimate = false }) {
  const inn = innings?.[index];
  if (scenarioHidden({ inn, target, overs, format, decided, atBreak })) return null;
  const f = /** @type {NonNullable<ReturnType<typeof scenarioBase>>} */ (scenarioBase(inn, overs));
  const { R, b, N, L } = f;
  const conditions = inn.conditions ?? ctx?.conditions ?? {};
  const opening = openingHalves(f, target);
  const h = validHalves(halves) ?? opening;
  const X = rateOfHalves(h);
  const crr = { r: R, q: b };
  const last = five === undefined ? lastOvers(events, ctx, index, inn) : five;
  const fiveRate = last ? perOver(last.runs, last.balls) : null;
  const fiveHead = last ? `At the last five overs' rate (${fiveRate} an over, ${plural(last.balls, "ball", "balls")})` : null;
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
    if (last) lines.push({ key: "five", text: `${fiveHead}: ${totalAt(R, L, { r: last.runs, q: last.balls })}` });
    at(String(totalAt(R, L, X)));
    lines.push({ key: "hand", text: `${hand} · ${ballsLeft}` });
  } else {
    const need = target - R;
    const rained = rainTouched(innings, conditions);
    const method = conditions?.["target.method"];
    const suffix = rained ? (method === "dls_standard" ? " (DLS)" : " (revised)") : "";
    // One short is a tie where describeResult() says so, revised target or not; under the
    // match's fewest overs it is a no result, and nothing here says "tie" (levelIsTie()).
    const tie = levelIsTie(f.overs, conditions);
    const off = `off ${plural(L, "ball", "balls")}${suffix}`;
    let head;
    if (L === 1) head = need === 1 ? "Last ball: 1 to win; scores are level" : `Last ball: ${need} to win${tie ? `, ${need - 1} to tie` : ""}`;
    else if (need > 6 * L) head = `Needs ${need} ${off}: more than six off every ball, so only extras can get there.`;
    else if (need === 1) head = `Scores level. Needs 1 ${off}`;
    else head = `Needs ${need} ${off}: ${perOver(need, L)} an over, ${(need / L).toFixed(2)} a ball`;
    lines.push({ key: "need", text: head });
    lines.push({ key: "hand", text: hand });
    if (R > 0) lines.push({ key: "own", text: `At their rate so far (${perOver(R, b)} an over): ${chaseWords(chaseAt(R, target, L, crr), tie)}` });
    if (last) lines.push({ key: "five", text: `${fiveHead}: ${chaseWords(chaseAt(R, target, L, { r: last.runs, q: last.balls }), tie)}` });
    at(chaseWords(chaseAt(R, target, L, X), tie));
    const least = minOversOf(conditions);
    if (least != null && f.overs < least) {
      // describeResult(): a no result only when the chase runs out of overs short; all out short is a win by runs.
      lines.push({ key: "no_result", text: `Under this match's conditions, a chase of fewer than ${least} overs that runs out of overs short of the target is a no result.` });
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
      lastFive: fiveRate, lastFiveBalls: last?.balls ?? null,
    },
  };
}

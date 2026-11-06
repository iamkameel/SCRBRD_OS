/**
 * SCRBRD — Player of the Match suggestions, from the facts (Recognition R6).
 *
 * docs/design/RECOGNITION_design.md D17 and D18: the coach (and, with R7, the
 * captain) sees two or three suggestions from R1's facts, each with the
 * figures that make it a suggestion, and decides. This module only reads:
 * it never decides, never pre-selects, and never ranks a boy who is not on
 * the side's sheet. The suggestions and the awardee's figures are what the
 * decision stores as `derived_from` (db/142), so R10 can tell later whether
 * a correction moved them.
 *
 * THE BASIS, SAID ON THE SCREEN. Batting and bowling only, until fielding is
 * scored (P2): BASIS_WORDS is the line, and `basis` is what is stored.
 *
 * THE ORDER. A plain, stated weighting, not a model: runs off the bat, plus
 * twenty for each wicket. Ties go to more wickets, then more runs, then the
 * fewer balls used (faced, then bowled), then the id, so the same log gives
 * the same suggestions on every device. A boy with nothing to his name
 * (no run, no wicket) is never suggested.
 *
 * PURE. No database, no clock, no network.
 */

/** @import { Facts } from "./facts.mjs" */

/** Stored on the decision as `derived_from.basis`. */
export const POTM_BASIS = "batting_bowling";
/** The line under the heading, until fielding is scored (D17). */
export const BASIS_WORDS = "Based on batting and bowling only.";
/** How many the sheet shows at most (D17: "two or three"). */
export const POTM_SUGGESTIONS = 3;
/** A wicket's weight against a run. */
export const WICKET_WEIGHT = 20;

/**
 * @typedef {object} MatchFigures
 * @property {string} playerId
 * @property {{runs: number, balls: number | null, out: boolean} | null} bat   summed over his innings
 * @property {{wickets: number, runs: number, balls: number} | null} bowl
 */

/** Overs as the board writes them: 22 balls is "3.4". @param {number} balls */
export function oversOf(balls) {
  const n = Math.max(0, Math.trunc(balls));
  return n % 6 ? `${Math.floor(n / 6)}.${n % 6}` : `${n / 6}`;
}

/**
 * Each listed player's figures in the match: runs (balls, * when not out)
 * and wickets/runs (overs), summed over the match's innings.
 * @param {Facts} facts  deriveFacts()'s answer
 * @param {Iterable<string>} ids  the side's sheet
 * @returns {MatchFigures[]}  in the order of `ids`
 */
export function matchFigures(facts, ids) {
  return [...ids].map((id) => {
    const bats = facts.batting.filter((b) => b.player === id);
    const bowls = facts.bowling.filter((b) => b.player === id);
    const bat = bats.length ? {
      runs: bats.reduce((s, b) => s + b.runs, 0),
      balls: bats.some((b) => b.balls == null) ? null : bats.reduce((s, b) => s + /** @type {number} */ (b.balls), 0),
      out: bats.every((b) => b.out),
    } : null;
    const bowl = bowls.length ? {
      wickets: bowls.reduce((s, b) => s + b.wickets, 0),
      runs: bowls.reduce((s, b) => s + b.runs, 0),
      balls: bowls.reduce((s, b) => s + b.balls, 0),
    } : null;
    return { playerId: id, bat, bowl };
  });
}

/**
 * A boy's figures in words: "63 (48)", "31* (22)", "3/18 (4)", or both,
 * "63 (48) · 1/14 (3)". "Did not bat or bowl" when he did neither.
 * @param {MatchFigures} f
 */
export function figuresWords(f) {
  const parts = [];
  if (f.bat) parts.push(`${f.bat.runs}${f.bat.out ? "" : "*"}${f.bat.balls == null ? "" : ` (${f.bat.balls})`}`);
  if (f.bowl) parts.push(`${f.bowl.wickets}/${f.bowl.runs} (${oversOf(f.bowl.balls)})`);
  return parts.length ? parts.join(" · ") : "Did not bat or bowl";
}

/** @param {MatchFigures} f */
const weight = (f) => (f.bat?.runs ?? 0) + WICKET_WEIGHT * (f.bowl?.wickets ?? 0);

/**
 * The suggestions: at most `n` of the side's sheet, in the stated order, each
 * with its figures in words. Never a boy with no run and no wicket.
 * @param {Facts} facts
 * @param {Iterable<string>} ids  the side's sheet (never the other side's)
 * @param {number} [n]
 * @returns {{playerId: string, figures: string}[]}
 */
export function suggestPlayerOfMatch(facts, ids, n = POTM_SUGGESTIONS) {
  return matchFigures(facts, ids)
    .filter((f) => weight(f) > 0)
    .sort((a, b) => weight(b) - weight(a)
      || (b.bowl?.wickets ?? 0) - (a.bowl?.wickets ?? 0)
      || (b.bat?.runs ?? 0) - (a.bat?.runs ?? 0)
      || (a.bat?.balls ?? Infinity) - (b.bat?.balls ?? Infinity)
      || (a.bowl?.balls ?? Infinity) - (b.bowl?.balls ?? Infinity)
      || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0))
    .slice(0, Math.max(0, n))
    .map((f) => ({ playerId: f.playerId, figures: figuresWords(f) }));
}

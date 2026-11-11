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
 * THE BASIS, SAID ON THE SCREEN. Fielding counts once it is scored (P2,
 * RECOGNITION R12): when every catch, stumping and run out of the match
 * names its fielders (the facts' `unattributed` is nought), the basis is
 * POTM_BASIS_FIELDING and D17's line is dropped (basisWords() is null).
 * Otherwise — a log from before the pad named fielders, a wicket whose
 * fielder was not named, a scorebook card — fielding is unknown, not
 * nought: the basis is POTM_BASIS, batting and bowling only, and
 * BASIS_WORDS says so. `basis` is what the decision stores, so a later
 * re-derive (R10) reads the match on the basis it was decided on.
 *
 * THE ORDER. A plain, stated weighting, not a model: runs off the bat, plus
 * twenty for each wicket, plus — on the fielding basis — ten for each catch,
 * stumping and run out (FIELDING_WEIGHT: half a wicket; each fielder of a
 * run out his ten, the contribution rule). Ties go to more wickets, then
 * more runs, then more fielding, then the fewer balls used (faced, then
 * bowled), then the id, so the same log gives the same suggestions on every
 * device. A boy with nothing to his name is never suggested.
 *
 * PURE. No database, no clock, no network.
 */

/** @import { Facts } from "./facts.mjs" */

/** Stored on the decision as `derived_from.basis`: batting and bowling only. */
export const POTM_BASIS = "batting_bowling";
/** ...and with fielding, where every fielding wicket names its fielders (R12). */
export const POTM_BASIS_FIELDING = "batting_bowling_fielding";
/** The bases a decision may store (db/150 accepts these two). */
export const POTM_BASES = Object.freeze([POTM_BASIS, POTM_BASIS_FIELDING]);
/** The line under the heading when fielding is not counted (D17). */
export const BASIS_WORDS = "Based on batting and bowling only.";
/** A catch's, a stumping's or a run out's weight against a run. */
export const FIELDING_WEIGHT = 10;

/**
 * The basis a match's suggestions are read on: with fielding when every
 * catch, stumping and run out it holds names its fielders, else batting and
 * bowling only. Facts from before R12 (no `unattributed`) are the old basis.
 * @param {Pick<Facts, "unattributed"> | {unattributed?: number}} facts
 * @returns {string}  one of POTM_BASES
 */
export const potmBasis = (facts) => (facts?.unattributed === 0 ? POTM_BASIS_FIELDING : POTM_BASIS);
/**
 * D17's line for a basis: said while fielding is not counted, dropped (null)
 * once it is.
 * @param {string} basis  @returns {string | null}
 */
export const basisWords = (basis) => (basis === POTM_BASIS_FIELDING ? null : BASIS_WORDS);
/** How many the sheet shows at most (D17: "two or three"). */
export const POTM_SUGGESTIONS = 3;
/** A wicket's weight against a run. */
export const WICKET_WEIGHT = 20;

/**
 * @typedef {object} MatchFigures
 * @property {string} playerId
 * @property {{runs: number, balls: number | null, out: boolean} | null} bat   summed over his innings
 * @property {{wickets: number, runs: number, balls: number} | null} bowl
 * @property {{catches: number, stumpings: number, runOuts: number} | null} [field]  on the fielding basis only
 */

/** Overs as the board writes them: 22 balls is "3.4". @param {number} balls */
export function oversOf(balls) {
  const n = Math.max(0, Math.trunc(balls));
  return n % 6 ? `${Math.floor(n / 6)}.${n % 6}` : `${n / 6}`;
}

/**
 * Each listed player's figures in the match: runs (balls, * when not out)
 * and wickets/runs (overs), summed over the match's innings, and on the
 * fielding basis his catches, stumpings and run outs.
 * @param {Facts} facts  deriveFacts()'s answer
 * @param {Iterable<string>} ids  the side's sheet
 * @param {string} [basis]  potmBasis(facts) unless a stored decision says which
 * @returns {MatchFigures[]}  in the order of `ids`
 */
export function matchFigures(facts, ids, basis = potmBasis(facts)) {
  const fielding = basis === POTM_BASIS_FIELDING;
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
    const fields = fielding ? (facts.fielding ?? []).filter((x) => x.player === id) : [];
    const field = fields.length ? {
      catches: fields.reduce((s, x) => s + x.catches, 0),
      stumpings: fields.reduce((s, x) => s + x.stumpings, 0),
      runOuts: fields.reduce((s, x) => s + x.runOuts, 0),
    } : null;
    return { playerId: id, bat, bowl, ...(fielding ? { field } : {}) };
  });
}

/** "2 catches", "1 stumping", "1 run out": a count and its word. @param {number} n @param {string} one @param {string} many */
const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * A boy's figures in words: "63 (48)", "31* (22)", "3/18 (4)", or both,
 * "63 (48) · 1/14 (3)", and on the fielding basis his fielding after them,
 * "12 (9) · 2 catches · 1 run out". "Did not bat or bowl" when he did
 * neither and fielded nothing to his name.
 * @param {MatchFigures} f
 */
export function figuresWords(f) {
  const parts = [];
  if (f.bat) parts.push(`${f.bat.runs}${f.bat.out ? "" : "*"}${f.bat.balls == null ? "" : ` (${f.bat.balls})`}`);
  if (f.bowl) parts.push(`${f.bowl.wickets}/${f.bowl.runs} (${oversOf(f.bowl.balls)})`);
  if (f.field?.catches) parts.push(counted(f.field.catches, "catch", "catches"));
  if (f.field?.stumpings) parts.push(counted(f.field.stumpings, "stumping", "stumpings"));
  if (f.field?.runOuts) parts.push(counted(f.field.runOuts, "run out", "run outs"));
  return parts.length ? parts.join(" · ") : "Did not bat or bowl";
}

/** @param {MatchFigures} f */
const fieldingOf = (f) => (f.field ? f.field.catches + f.field.stumpings + f.field.runOuts : 0);
/** @param {MatchFigures} f */
const weight = (f) => (f.bat?.runs ?? 0) + WICKET_WEIGHT * (f.bowl?.wickets ?? 0) + FIELDING_WEIGHT * fieldingOf(f);

/**
 * The suggestions: at most `n` of the side's sheet, in the stated order, each
 * with its figures in words. Never a boy with nothing to his name.
 * @param {Facts} facts
 * @param {Iterable<string>} ids  the side's sheet (never the other side's)
 * @param {number} [n]
 * @param {string} [basis]  potmBasis(facts) unless a stored decision says which
 * @returns {{playerId: string, figures: string}[]}
 */
export function suggestPlayerOfMatch(facts, ids, n = POTM_SUGGESTIONS, basis = potmBasis(facts)) {
  return matchFigures(facts, ids, basis)
    .filter((f) => weight(f) > 0)
    .sort((a, b) => weight(b) - weight(a)
      || (b.bowl?.wickets ?? 0) - (a.bowl?.wickets ?? 0)
      || (b.bat?.runs ?? 0) - (a.bat?.runs ?? 0)
      || fieldingOf(b) - fieldingOf(a)
      || (a.bat?.balls ?? Infinity) - (b.bat?.balls ?? Infinity)
      || (a.bowl?.balls ?? Infinity) - (b.bowl?.balls ?? Infinity)
      || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0))
    .slice(0, Math.max(0, n))
    .map((f) => ({ playerId: f.playerId, figures: figuresWords(f) }));
}

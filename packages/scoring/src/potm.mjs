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
 * THE POINTS (CRI-3.3, Kameel 19 Nov 2026: simple points). Runs off the
 * bat, plus twenty for each wicket, plus ten for each catch, stumping and
 * run out the log credits to him (each fielder of a run out his ten, the
 * contribution rule). The card shows its working, "42 runs + 2 wickets (40)
 * + 1 catch (10) = 92" (workingWords()), to the person deciding only (the
 * API's door), and it decides nothing: a person still chooses. A fairer,
 * weighted version is for after 30 pilot matches, not here.
 *
 * FIELDING, ONLY WHERE THE LOG NAMES IT. A fielder is credited only where
 * the wicket names him by reference (facts' `fielding`, fieldingCredits());
 * a catch, stumping or run out that names nobody credits nobody, and the
 * card says so plainly (unnamedWords(facts.unattributed)). The basis is
 * POTM_BASIS_FIELDING once the log names any fielder (credited > 0), so a
 * named fielder is never dropped because another wicket named no one; a log
 * that names nobody — every log from before the pad named fielders, a
 * scorebook card — is POTM_BASIS, batting and bowling only, and BASIS_WORDS
 * says so. `basis` is what the decision stores, so a later re-derive (R10,
 * db/150's match_award_figures) reads the match on the basis it was decided
 * on; figuresWords() is that mirror's words, unchanged.
 *
 * A TIE IS A TIE. The order is the points and nothing else: boys on the
 * same points are marked `tied` and listed in id order (the same on every
 * device; no hidden second rule decides who is "first"). Where a tie runs
 * past the last place shown, potmCard() names the rest in `alsoTied`, so a
 * boy level on points is never silently left off. A boy with nothing to
 * his name is never suggested.
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
 * The basis a match's suggestions are read on: with fielding once its log
 * names any fielder (CRI-3.3: credit a fielder wherever the log names one),
 * else batting and bowling only. Facts from before R12 (no counts) are the
 * old basis.
 * @param {{unattributed?: number, credited?: number}} facts
 * @returns {string}  one of POTM_BASES
 */
export const potmBasis = (facts) => ((facts?.credited ?? 0) > 0 ? POTM_BASIS_FIELDING : POTM_BASIS);
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

/**
 * A boy's points and their parts (CRI-3.3): runs off the bat, twenty a
 * wicket, ten a catch, stumping or run out. Fielding counts only where
 * matchFigures() read it (the fielding basis).
 * @param {MatchFigures} f
 */
export function potmPoints(f) {
  const runs = f.bat?.runs ?? 0, wickets = f.bowl?.wickets ?? 0;
  const catches = f.field?.catches ?? 0, stumpings = f.field?.stumpings ?? 0, runOuts = f.field?.runOuts ?? 0;
  return { runs, wickets, catches, stumpings, runOuts,
           total: runs + WICKET_WEIGHT * wickets + FIELDING_WEIGHT * (catches + stumpings + runOuts) };
}

/**
 * The working, in words: "42 runs + 2 wickets (40) + 1 catch (10) = 92".
 * Only the parts he has; "0 points" when he has none.
 * @param {MatchFigures} f
 */
export function workingWords(f) {
  const p = potmPoints(f);
  const parts = [];
  if (p.runs) parts.push(counted(p.runs, "run", "runs"));
  if (p.wickets) parts.push(`${counted(p.wickets, "wicket", "wickets")} (${WICKET_WEIGHT * p.wickets})`);
  if (p.catches) parts.push(`${counted(p.catches, "catch", "catches")} (${FIELDING_WEIGHT * p.catches})`);
  if (p.stumpings) parts.push(`${counted(p.stumpings, "stumping", "stumpings")} (${FIELDING_WEIGHT * p.stumpings})`);
  if (p.runOuts) parts.push(`${counted(p.runOuts, "run out", "run outs")} (${FIELDING_WEIGHT * p.runOuts})`);
  return parts.length ? `${parts.join(" + ")} = ${p.total}` : "0 points";
}

/**
 * How the points are counted, in a line, on the basis they were read on.
 * @param {string} basis
 */
export const ruleWords = (basis) => (basis === POTM_BASIS_FIELDING
  ? `Points: runs, plus ${WICKET_WEIGHT} a wicket, plus ${FIELDING_WEIGHT} a catch, stumping or run out.`
  : `Points: runs, plus ${WICKET_WEIGHT} a wicket.`);

/**
 * The card's plain line for the match's catches, stumpings and run outs
 * that named no fielder (facts' `unattributed`): nobody is credited for
 * them. Null when there are none.
 * @param {number | null | undefined} n
 * @returns {string | null}
 */
export function unnamedWords(n) {
  const k = Math.max(0, Math.trunc(Number(n) || 0));
  if (!k) return null;
  return k === 1 ? "1 dismissal in this match names no fielder, so no fielder is credited for it."
    : `${k} dismissals in this match name no fielder, so no fielder is credited for them.`;
}

/**
 * @typedef {object} PotmSuggestion
 * @property {string} playerId
 * @property {string} figures   figuresWords()
 * @property {number} points
 * @property {string} working   workingWords()
 * @property {boolean} tied     another boy on the sheet has the same points
 */

/**
 * The suggestion card: at most `n` of the side's sheet by points, each with
 * its figures and working; `alsoTied`, the boys past the last place shown
 * on the same points as it (never silently left off); and the count of
 * dismissals that named no fielder.
 * @param {import("./facts.mjs").Facts} facts
 * @param {Iterable<string>} ids  the side's sheet (never the other side's)
 * @param {number} [n]
 * @param {string} [basis]  potmBasis(facts) unless a stored decision says which
 * @returns {{basis: string, suggestions: PotmSuggestion[], alsoTied: PotmSuggestion[], unnamed: number}}
 */
export function potmCard(facts, ids, n = POTM_SUGGESTIONS, basis = potmBasis(facts)) {
  const all = matchFigures(facts, ids, basis)
    .map((f) => ({ f, points: potmPoints(f).total }))
    .filter((x) => x.points > 0)
    .sort((a, b) => b.points - a.points || (a.f.playerId < b.f.playerId ? -1 : a.f.playerId > b.f.playerId ? 1 : 0));
  /** @type {Map<number, number>} */ const on = new Map();
  for (const x of all) on.set(x.points, (on.get(x.points) ?? 0) + 1);
  /** @param {{f: MatchFigures, points: number}} x @returns {PotmSuggestion} */
  const item = (x) => ({ playerId: x.f.playerId, figures: figuresWords(x.f), points: x.points, working: workingWords(x.f),
                         tied: (on.get(x.points) ?? 0) > 1 });
  const k = Math.max(0, Math.trunc(n));
  const shown = all.slice(0, k);
  const last = shown[shown.length - 1];
  const alsoTied = last ? all.slice(k).filter((x) => x.points === last.points) : [];
  return { basis, suggestions: shown.map(item), alsoTied: alsoTied.map(item), unnamed: Math.max(0, facts?.unattributed ?? 0) };
}

/**
 * The suggestions: at most `n` of the side's sheet by points, each with its
 * figures in words and its working (potmCard()'s list).
 * @param {import("./facts.mjs").Facts} facts
 * @param {Iterable<string>} ids  the side's sheet (never the other side's)
 * @param {number} [n]
 * @param {string} [basis]  potmBasis(facts) unless a stored decision says which
 * @returns {PotmSuggestion[]}
 */
export function suggestPlayerOfMatch(facts, ids, n = POTM_SUGGESTIONS, basis = potmBasis(facts)) {
  return potmCard(facts, ids, n, basis).suggestions;
}

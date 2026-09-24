/**
 * SCRBRD — pure aggregation for Season Awards / MVP (SCRBRD-084).
 *
 * Takes the rows `usePlayersWithCareer()` already returns — players merged
 * with their career figures, scoped by RLS the same way every other read in
 * this product is — and ranks them. Nothing here reads the network, and
 * nothing here invents a figure: a player who has not batted has no `avg`
 * (asCareer, lib/live.js) and this file never turns that into a zero.
 *
 * THE FLOOR IS THE PACKAGE'S, NOT A SECOND ONE HERE. `battingIndex` and
 * `bowlingIndex` (packages/scoring/src/rating.mjs) refuse a rating below
 * MIN_BALLS_FACED / MIN_BALLS_BOWLED, returning `{value: null, reason}`
 * instead. `bestBattingAverages`, `bestBowlingEconomies` and `mvpRanking`
 * all read that `value` and drop a null rather than ranking on the reason
 * or a raw average — a batter four innings into a season does not outrank
 * one who has actually proven a number over a real sample. `topRunScorers`
 * and `topWicketTakers` are the exception on purpose: a season's leading
 * run-scorer is a plain count nobody's sample size disqualifies, the same
 * way a league table does not refuse to name whoever scored the most.
 *
 * ONE SEASON, BY WHAT THE READ ITSELF SCOPES TO. `career` has no season
 * parameter — it is every match this reader may see (see the read's own
 * comment in services/api/read/read-api.mjs) — and the pilot's seed carries
 * exactly one school season, so that is what these figures roll up today.
 * A school with two seasons of history would need a season-scoped read
 * before this could split them, which is the STOP this backlog item
 * names rather than a server route invented here.
 */
import { battingIndex, bowlingIndex } from "@scrbrd/scoring";

const round1 = (v) => Math.round(v * 10) / 10;

/** @param {any} p  a row from usePlayersWithCareer() */
export function playerIndices(p) {
  return {
    batting: battingIndex({ runs: p.runs, ballsFaced: p.ballsFaced, dismissals: p.dismissals }),
    bowling: bowlingIndex({ runsConceded: p.runsConceded, ballsBowled: p.ballsBowled, wickets: p.wkts }),
  };
}

/**
 * One MVP score from the two indices battingIndex/bowlingIndex allow —
 * never a blend with a zero standing in for the discipline nobody has
 * enough of a sample for (the same rule adjustedRating() states for the
 * coach/performance blend: "a blend also hides that one half may be
 * missing"). An all-rounder with both is the mean of the two, on the same
 * 1-20 scale either alone already sits on — not the sum, which would let a
 * genuine all-rounder outscore a specialist twice as good at the one thing
 * he does.
 * @param {{batting: {value: number|null}, bowling: {value: number|null}}} indices
 * @returns {number | null}
 */
export function mvpScore({ batting, bowling }) {
  const b = batting?.value, w = bowling?.value;
  if (b == null && w == null) return null;
  if (b == null) return w;
  if (w == null) return b;
  return round1((b + w) / 2);
}

/** @param {any[]} players @param {{team?: string|null, school?: string|null}} [opts] */
const scoped = (players, { team = null, school = null } = {}) =>
  players.filter((p) => (team == null || p.team === team) && (school == null || p.school === school));

/**
 * The season's leading run-scorers. A plain count — no sample floor, the way
 * a league's own top-scorer column has none.
 */
export function topRunScorers(players, opts = {}) {
  return scoped(players, opts)
    .filter((p) => (p.runs ?? 0) > 0)
    .sort((a, b) => (b.runs ?? 0) - (a.runs ?? 0) || (b.avg ?? 0) - (a.avg ?? 0))
    .slice(0, opts.limit ?? 10);
}

/** The season's leading wicket-takers, ties broken by the tighter economy. */
export function topWicketTakers(players, opts = {}) {
  return scoped(players, opts)
    .filter((p) => (p.wkts ?? 0) > 0)
    .sort((a, b) => (b.wkts ?? 0) - (a.wkts ?? 0) || (a.econ ?? Infinity) - (b.econ ?? Infinity))
    .slice(0, opts.limit ?? 10);
}

/**
 * Best batting index — the average/strike-rate blend battingIndex() computes
 * — for whoever clears MIN_BALLS_FACED. Below the floor, absent, not last.
 */
export function bestBattingAverages(players, opts = {}) {
  return scoped(players, opts)
    .map((p) => ({ player: p, index: battingIndex({ runs: p.runs, ballsFaced: p.ballsFaced, dismissals: p.dismissals }) }))
    .filter((x) => x.index.value != null)
    .sort((a, b) => /** @type {number} */ (b.index.value) - /** @type {number} */ (a.index.value))
    .slice(0, opts.limit ?? 10);
}

/** Best bowling index for whoever clears MIN_BALLS_BOWLED. */
export function bestBowlingEconomies(players, opts = {}) {
  return scoped(players, opts)
    .map((p) => ({ player: p, index: bowlingIndex({ runsConceded: p.runsConceded, ballsBowled: p.ballsBowled, wickets: p.wkts }) }))
    .filter((x) => x.index.value != null)
    .sort((a, b) => /** @type {number} */ (b.index.value) - /** @type {number} */ (a.index.value))
    .slice(0, opts.limit ?? 10);
}

/**
 * The MVP table: every player with at least one index the package did not
 * refuse, ranked by mvpScore(). A player below both floors is not on this
 * list at all — never a zero at the bottom of it.
 */
export function mvpRanking(players, opts = {}) {
  return scoped(players, opts)
    .map((p) => { const indices = playerIndices(p); return { player: p, indices, score: mvpScore(indices) }; })
    .filter((x) => x.score != null)
    .sort((a, b) => /** @type {number} */ (b.score) - /** @type {number} */ (a.score))
    .slice(0, opts.limit ?? 10);
}

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
 * ONE SEASON, BY WHAT THE READ ITSELF SCOPES TO (SCRBRD-086). `career` is
 * every match this reader may see; `career_by_season` is the same figures
 * with a row per player per school season, the season being the one each
 * MATCH is in — decided in Postgres by the rule the fixture list uses
 * (school_season_of(), db/44), never worked out here from a date or a
 * clock. The functions below only pick a season out of what that read
 * returned and hand its rows to the rankings, which then apply the sample
 * floor to that season's balls: a boy with twenty balls in each of two
 * seasons is below the floor in both, whatever his career says.
 */
import { MIN_BALLS_BOWLED, MIN_BALLS_FACED, battingIndex, bowlingIndex } from "@scrbrd/scoring";

/** The option value for every season at once — the `career` read, unchanged. */
export const ALL_SEASONS = "all";

/**
 * Which seasons have figures, newest first, and which of them is current —
 * both exactly as `career_by_season` said. `current` is null when the
 * current season has no figures yet: the read only has rows for a season
 * somebody played in, and a season with nothing in it is never offered.
 * @param {{season?: string|null, currentSeason?: boolean}[]} rows  asSeasonCareer() rows
 * @returns {{ seasons: string[], current: string|null }}
 */
export function awardSeasons(rows) {
  const seasons = [...new Set(rows.map((r) => r.season).filter((s) => typeof s === "string" && s))]
    .sort((a, b) => b.localeCompare(a));
  const current = rows.find((r) => r.currentSeason && r.season)?.season ?? null;
  return { seasons, current };
}

/**
 * The season the Awards tab opens on: the current one when it has figures;
 * otherwise the most recent one that does (the first week of January shows
 * last season's awards rather than an empty page); otherwise every season.
 * @param {{ seasons: string[], current: string|null }} choice  from awardSeasons()
 */
export function defaultAwardSeason({ seasons, current }) {
  if (current && seasons.includes(current)) return current;
  return seasons[0] ?? ALL_SEASONS;
}

/**
 * The ranking input for one season: that season's rows, each laid over the
 * reader's own row for the player (name, school name) the way
 * usePlayersWithCareer() lays `career` over it. The season row carries every
 * figure the rankings read, so nothing from another season survives into it;
 * and nobody without a row in the season is in it at all.
 * @param {any[]} players     usePlayersWithCareer() rows (may be empty while loading)
 * @param {any[]} seasonRows  asSeasonCareer() rows, every season
 * @param {string} season
 */
export function playersForSeason(players, seasonRows, season) {
  const byId = new Map(players.map((p) => [p.id, p]));
  return seasonRows
    .filter((r) => r.season === season)
    .map((r) => { const p = byId.get(r.id); return p ? { ...p, ...r, name: p.name ?? r.name } : r; });
}

const round1 = (v) => Math.round(v * 10) / 10;

/** @param {any} p  a row from usePlayersWithCareer() */
export function playerIndices(p) {
  return {
    batting: battingIndex({ runs: p.runs, ballsFaced: p.ballsFaced, dismissals: p.dismissals, runsWithoutBalls: p.runsWithoutBalls }),
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
export const scoped = (players, { team = null, school = null } = {}) =>
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
    .map((p) => ({ player: p, index: battingIndex({ runs: p.runs, ballsFaced: p.ballsFaced, dismissals: p.dismissals, runsWithoutBalls: p.runsWithoutBalls }) }))
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

// ── Who sees a ranking, and what it says it is (recognition R5b, D23, A15) ──
//
// docs/design/RECOGNITION_design.md §6.1: "a pupil may see a record and its
// holders; he may not see his team-mates ordered by a figure, and neither
// may his parent. Staff may, because selecting a side is their job and the
// figures are labelled with their method." STEP4 §6: "no leaderboard of the
// team's parents' children on a family screen."

/**
 * The roles that are playing, or belonging to someone who does — the
 * "playing" family of design/roles.js's ROLE_IDENTITY, written out here so
 * this file stays a plain module the walks import. A test holds the two to
 * the same list (apps/web/test/season-awards.test.mjs).
 */
export const PLAYING_ROLES = Object.freeze(["player", "guardian", "spectator", "selfaccess"]);

/**
 * Whether a person whose roles are `held` is shown a list of players ordered
 * by a figure: the Season Awards tab's five lists, the MVP figure, the Top
 * Performers lists. Only when one role he holds is not a playing one — a
 * coach who is also a parent keeps them; a pupil (player, selfaccess), a
 * `player` with no file of his own, a parent, a parent who also follows the
 * school as a spectator, do not. Nobody held, nobody shown.
 *
 * Presentation only, like every gate in the shell: it decides what is drawn,
 * never what a read returns. The career reads a ranking is built from are
 * the API's and the database's to decide.
 * @param {readonly string[]} held  the roles actually held (or the demo persona's)
 */
export function showsRankings(held) {
  return (held ?? []).some((r) => typeof r === "string" && r && !PLAYING_ROLES.includes(r));
}

/**
 * The method of each ranking, in plain words, for the staff who see it
 * (D22: "ordered by the metric with its minimum qualification stated").
 * `season` is the Awards tab's choice: a season's label, or ALL_SEASONS.
 * @param {"runs"|"wickets"|"batting"|"bowling"|"mvp"|"average"|"wicketCount"} kind
 * @param {string|null} [season]
 */
export function rankingMethod(kind, season = null) {
  const over = season == null ? "" : season === ALL_SEASONS ? " across every season on record" : ` in the ${season} school season`;
  switch (kind) {
    case "runs": return `Ranked by runs scored${over}, most first; level on runs, the higher average first. No minimum number of balls.`;
    case "wickets": return `Ranked by wickets taken${over}, most first; level on wickets, the lower economy first. No minimum number of balls.`;
    case "batting": return `Ranked by the batting index${over} (average and strike rate together, out of 20), highest first. Only players who have faced at least ${MIN_BALLS_FACED} balls.`;
    case "bowling": return `Ranked by the bowling index${over} (economy and balls per wicket together, out of 20), highest first. Only players who have bowled at least ${MIN_BALLS_BOWLED} balls.`;
    case "mvp": return `Ranked by the batting and bowling index${over}, averaged where a player has both, highest first. Only players who have faced ${MIN_BALLS_FACED} balls or bowled ${MIN_BALLS_BOWLED}; never a rating either index refused.`;
    case "average": return `Ranked by batting average${over}, highest first. No minimum number of innings or balls.`;
    case "wicketCount": return `Ranked by wickets taken${over}, most first. No minimum number of balls.`;
    default: return "";
  }
}

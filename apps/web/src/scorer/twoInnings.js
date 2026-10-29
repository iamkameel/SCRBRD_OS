/**
 * A Two-Day: two innings a side, scored live (Kameel, 28 Oct 2026, the Laws
 * audit Q1, F2). The pad's own match runs innings 1 → the break → innings 2
 * → the result; a match whose playing conditions say two innings a side
 * (`format.innings_per_side` = 2) runs all four, as the Laws check now lets
 * it (laws.mjs matchDecided()). This is the pad's half, pure, so a test can
 * hold it (apps/web/test/wicket-asks.test.mjs):
 *
 *   twoInningsMatch(conditions)   is it one
 *   nextInningsPlan(innings, i)   who bats in match innings i (1, 2 or 3),
 *                                 with what squads, and the fourth's target —
 *                                 the innings_start's fields
 *   inningsDecided(innings)       an innings win after the third: no fourth
 *
 * Who bats: the second innings is the side that bowled the first; the third
 * is the side that batted first, or — when its captain enforces the
 * follow-on (Law 14) — the side that batted second, again; the fourth is the
 * other. Only the fourth is a chase: its target is the runs it trails by, plus
 * one. The second innings has no target: a total passed there ends nothing.
 */

/** @param {Record<string, unknown> | null | undefined} conditions */
export const twoInningsMatch = (conditions) => conditions?.["format.innings_per_side"] === 2;

const keyOf = (x) => String(x?.teamKey ?? x?.battingTeam ?? "").trim().toLowerCase();

/**
 * The side of innings `x`, as the next innings_start writes it, batting.
 * @param {any} x
 */
const sideOf = (x) => ({
  battingTeam: x.battingTeam, bowlingTeam: x.bowlingTeam,
  teamKey: x.teamKey ?? x.battingTeam, bowlingTeamKey: x.bowlingTeamKey ?? x.bowlingTeam,
  squad: x.squad ?? [], bowlingSquad: x.bowlingSquad ?? [], twelfthMan: x.twelfthMan ?? null,
});
/** The other side of innings `x`, batting. @param {any} x */
const otherOf = (x) => ({
  battingTeam: x.bowlingTeam, bowlingTeam: x.battingTeam,
  teamKey: x.bowlingTeamKey ?? x.bowlingTeam, bowlingTeamKey: x.teamKey ?? x.battingTeam,
  squad: x.bowlingSquad ?? [], bowlingSquad: x.squad ?? [], twelfthMan: null,
});

/**
 * The runs a side has, over the innings given, by its key.
 * @param {any[]} list @param {string} key
 */
const runsFor = (list, key) => list.filter((x) => x && keyOf(x) === key).reduce((n, x) => n + (x.runs ?? 0), 0);

/**
 * The innings_start's sides (and the fourth's target) for match innings `i`
 * of a two-innings match, from the innings before it.
 * @param {any[]} innings  the folded innings, by index
 * @param {1 | 2 | 3} i
 * @param {{followOn?: boolean}} [o]  the third innings only: the side that batted second bats again
 * @returns {null | (ReturnType<typeof sideOf> & {target: number | null, lead: number})}
 */
export function nextInningsPlan(innings, i, { followOn = false } = {}) {
  const [i0, i1, i2] = innings;
  if (!i0) return null;
  if (i === 1) return { ...otherOf(i0), target: null, lead: 0 };
  if (i === 2) {
    if (!i1) return null;
    const side = followOn ? sideOf(i1) : sideOf(i0);
    // The side batting third's lead (negative: behind) on first innings.
    const lead = (followOn ? i1.runs - i0.runs : i0.runs - i1.runs);
    return { ...side, target: null, lead };
  }
  if (i === 3) {
    if (!i1 || !i2) return null;
    const side = otherOf(i2);
    const mine = runsFor([i0, i1, i2], keyOf({ teamKey: side.teamKey }));
    const theirs = runsFor([i0, i1, i2], keyOf(i2));
    return { ...side, target: theirs - mine + 1, lead: mine - theirs };
  }
  return null;
}

/**
 * The first-innings lead of the side that batted first — the follow-on is
 * theirs to enforce only when they lead (Law 14; the margin is the umpires'
 * and the captains' to apply, and the pad records what they decided).
 * @param {any[]} innings
 */
export const firstInningsLead = (innings) => (innings[0] && innings[1] ? innings[0].runs - innings[1].runs : 0);

/**
 * Is the match over after its third innings — the side batting third all out
 * still behind, an innings win? The Laws check's own test (laws.mjs
 * matchDecided()), so the pad never offers a fourth innings it would refuse.
 * @param {any[]} innings
 */
export function inningsDecided(innings) {
  const [i0, i1, i2] = innings;
  if (!(i0?.complete && i1?.complete && i2?.complete && i2.endReason === "all_out")) return false;
  const twice = keyOf(i2);
  const list = [i0, i1, i2];
  return list.filter((x) => keyOf(x) !== twice).reduce((n, x) => n + x.runs, 0)
       - list.filter((x) => keyOf(x) === twice).reduce((n, x) => n + x.runs, 0) > 0;
}

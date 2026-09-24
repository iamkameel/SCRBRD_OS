/**
 * SCRBRD — pure derivations for the Post-Match Report (SCRBRD-082).
 *
 * Every figure here is folded from `Innings[]` — the shape `deriveMatch()` /
 * `deriveInnings()` in @scrbrd/scoring already return — never recomputed from
 * a different rule. A key moment, a milestone-over or a "best figures" pick
 * that disagreed with the scorecard beside it would be worse than none, for
 * the same reason packages/scoring/src/phases.mjs gives for deriving phases
 * from the fold rather than a second pass over the ball log with its own
 * arithmetic.
 *
 * WHAT THIS DOES NOT DO: read a match, call an API, or touch React. It takes
 * the innings the caller already derived and returns plain data, so it can be
 * asserted against directly (test/postMatchReport.test.mjs) without a
 * database, a browser, or a mock fixture standing in for a real one.
 */
import { BALL_TYPE, OFF_THE_BAT, fmtOvers, isLegal } from "@scrbrd/scoring";

/**
 * The best batting line across a whole match — every innings' batsmen pooled,
 * ranked by runs and then by fewer balls (the faster of two equal scores).
 * Null when nobody has batted yet.
 * @param {any[]} innings
 */
export function matchBestBatting(innings = []) {
  const all = innings.flatMap((inn, i) => (inn?.batsmen ?? []).map((b) => ({ ...b, innings: i })));
  if (!all.length) return null;
  return [...all].sort((a, b) => b.runs - a.runs || a.balls - b.balls)[0];
}

/**
 * The best bowling figures across a whole match — most wickets, then fewest
 * runs conceded. Null when nobody with a wicket or a ball bowled is on record
 * — which is an honest answer for an innings the seed, or the log, never
 * attributed to a bowler (see db/98_seed_pilot.sql's note on bowler_id being
 * nullable for an opposition bowler this platform holds no row for).
 * @param {any[]} innings
 */
export function matchBestBowling(innings = []) {
  const all = innings.flatMap((inn, i) => (inn?.bowlers ?? []).map((b) => ({ ...b, innings: i })));
  const withBalls = all.filter((b) => b.balls > 0 || b.wickets > 0);
  if (!withBalls.length) return null;
  return [...withBalls].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
}

/**
 * The over a batter's score first reached `threshold`, read off the ball log
 * rather than guessed from the final total — the same reason phases.mjs reads
 * `ballLog` instead of recomputing from the innings' running total.
 *
 * `OFF_THE_BAT` is the fold's own set (a run, a wicket ball, or a no-ball
 * struck) — the exact three ball types that move `Batter.runs` in the fold
 * (replay.mjs's BALL case). A second, hand-written list here is how a
 * milestone-over could disagree with the runs column beside it.
 *
 * @param {any} inn  one derived innings
 * @param {string} batterId
 * @param {number} threshold  50 or 100
 * @returns {string | null}  "12.3", or null if the total never reaches it
 */
export function milestoneOver(inn, batterId, threshold) {
  let runs = 0;
  let legalBalls = 0;
  for (const b of inn?.ballLog ?? []) {
    const legal = isLegal(b.type ?? BALL_TYPE.RUN);
    if (b.strikerId === batterId && OFF_THE_BAT.has(b.type ?? BALL_TYPE.RUN)) {
      runs += b.value ?? 0;
      if (runs >= threshold) return fmtOvers(legal ? legalBalls + 1 : legalBalls);
    }
    if (legal) legalBalls += 1;
  }
  return null;
}

/**
 * Every wicket, fifty, hundred and five-wicket haul in the match, in the
 * order it happened — innings first, then over. This is the "key moments"
 * feed a report can print as a timeline.
 *
 * A milestone is read off the innings the fold already produced: `fow` for
 * a wicket (it already carries the score and the over), `batsmen`/`bowlers`
 * for a fifty, a hundred or a five-for. Nothing here invents an over for a
 * wicket — `fow[].overs` is the fold's own — and `milestoneOver` above is
 * the only place a fifty or a hundred's over is derived, so the two can never
 * print two different answers for the same ball.
 *
 * @param {any[]} innings
 */
export function keyMoments(innings = []) {
  /** @type {{kind: string, innings: number, over: string | null, label: string}[]} */
  const moments = [];
  innings.forEach((inn, i) => {
    if (!inn) return;
    for (const w of inn.fow ?? []) {
      moments.push({
        kind: "wicket", innings: i, over: w.overs,
        label: `${w.batsman} out — ${w.runs}/${w.wickets}`,
      });
    }
    for (const b of inn.batsmen ?? []) {
      if (b.runs >= 100) {
        moments.push({ kind: "hundred", innings: i, over: milestoneOver(inn, b.id, 100),
          label: `${b.name} brings up a century` });
      } else if (b.runs >= 50) {
        moments.push({ kind: "fifty", innings: i, over: milestoneOver(inn, b.id, 50),
          label: `${b.name} brings up fifty` });
      }
    }
    for (const bw of inn.bowlers ?? []) {
      if (bw.wickets >= 5) {
        moments.push({ kind: "five-for", innings: i, over: fmtOvers(bw.balls),
          label: `${bw.name} takes five — ${bw.wickets}/${bw.runs}` });
      }
    }
  });
  const overNum = (s) => (s == null ? Infinity : Number(s));
  return moments.sort((a, b) => a.innings - b.innings || overNum(a.over) - overNum(b.over));
}

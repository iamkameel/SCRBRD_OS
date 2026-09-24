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
import { BALL_TYPE, DISMISSAL_LABEL, fmtOvers, isLegal, runsOffBat } from "@scrbrd/scoring";

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
 * `runsOffBat()` is the fold's own rule for whose runs a delivery's are — a
 * run, a wicket ball, or a no-ball struck, and not a no-ball's byes or leg
 * byes (SCRBRD-068) — the exact rule that moves `Batter.runs` in the fold
 * (replay.mjs's BALL case). A second, hand-written list here is how a
 * milestone-over could disagree with the runs column beside it: it used to
 * be the set of ball types, which counted four byes off a no-ball towards a
 * fifty the scorecard does not give him.
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
    const off = b.strikerId === batterId ? runsOffBat(b) : 0;
    if (off > 0) {
      runs += off;
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
 * A wicket with no ball — retired out, timed out (SCRBRD-081) — is in `fow`
 * like any other, at the score and the over it fell, because the fold puts it
 * there. What `fow` does not say is how, and "out" alone reads as if a ball
 * took it; `nonBallWickets` is the fold's record of which those were, so the
 * line says "retired out" or "timed out" and carries the dismissal.
 *
 * @param {any[]} innings
 */
export function keyMoments(innings = []) {
  /** @type {{kind: string, innings: number, over: string | null, label: string, dismissal?: string}[]} */
  const moments = [];
  innings.forEach((inn, i) => {
    if (!inn) return;
    // The name `fow` carries for each, exactly as the fold wrote it there.
    /** @type {Map<string, string>} */
    const nonBall = new Map();
    for (const nb of inn.nonBallWickets ?? []) {
      nonBall.set(inn.batsmen?.find((b) => b.id === nb.batter)?.name ?? "?", nb.dismissal);
    }
    for (const w of inn.fow ?? []) {
      const how = nonBall.get(w.batsman);
      moments.push({
        kind: "wicket", innings: i, over: w.overs,
        label: `${w.batsman} ${how ? DISMISSAL_LABEL[how].toLowerCase() : "out"} — ${w.runs}/${w.wickets}`,
        ...(how ? { dismissal: how } : {}),
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

/**
 * SCRBRD — player rating: the coach's judgement, and what the ball log says.
 *
 * A player's rating has two inputs and they are NOT the same kind of thing.
 *
 *   The COACH'S ASSESSMENT is a judgement. It is subjective, it is attributed
 *   to a named person on a named date, it covers things no scorer records
 *   (temperament, footwork, whether a fifteen-year-old is coachable), and it
 *   is the reason a development record exists at all.
 *
 *   The PERFORMANCE INDEX is arithmetic over the ball log. It is objective, it
 *   is reproducible, it has no opinion, and it can only speak about the two
 *   disciplines the log actually records.
 *
 * HOW THEY COMBINE: THE COACH SETS THE STARTING POSITION, EVIDENCE MOVES IT
 * ────────────────────────────────────────────────────────────────────────
 * They are not averaged at a fixed weight, and that distinction is the whole
 * design. A coach watches a boy in the nets and rates him — technique,
 * footwork, temperament — and that judgement is the ANCHOR. From then on the
 * rating SELF-ADJUSTS away from it as the player's own match record
 * accumulates.
 *
 * So the weight is not a constant; it is a function of how much evidence there
 * is. Thirty balls faced barely moves the number, because thirty balls barely
 * says anything. Five hundred balls moves it a long way, because by then the
 * ball log knows more about what this player actually does than one afternoon
 * in the nets did.
 *
 * A fixed 60/40 blend gets both ends wrong. It lets four innings drag a
 * carefully-considered assessment down by 40% of the gap, and it stops a
 * season of evidence from ever fully answering back.
 *
 * WHAT IS NEVER LOST
 * ──────────────────
 * The coach's number. It is returned beside the adjusted one, along with the
 * DRIFT between them — because the moment a coach disagrees with a rating, in
 * front of a parent, the only useful question is "what moved it, and by how
 * much?" A single blended number cannot answer that. This one can, and the
 * answer is arithmetic over deliveries the child actually faced.
 *
 * A blend also hides that one half may be missing. A player with four innings
 * has no meaningful index, and averaging a real assessment with a fabricated
 * one produces a number that is confidently wrong. Below the sample floor the
 * rating IS the coach's number, unmoved.
 *
 * WHAT IS NOT HERE
 * ────────────────
 * There is no fielding index and no keeping index, because ball_event records
 * neither. A catch appears only inside free-text dismissal wording, and
 * nothing in the platform measures a sprint. Those two disciplines are
 * coach-assessed or they are absent — inventing them from batting numbers
 * would be exactly the fabrication this module exists to avoid.
 */

/**
 * Calibration, and it is CALIBRATION rather than fact.
 *
 * Named STAT_ANCHORS, not ANCHORS, because the rubric has anchors too and they
 * are a different kind of thing: those are sentences describing what a coach
 * should see at a score, these are the statistic-to-score curve. Both are
 * star-exported from the package index, and two `ANCHORS` under a star export
 * do not clash loudly — ESM drops an ambiguous name silently, so the import
 * would simply be undefined at the first call site to reach for it.
 *
 * These anchors say what the 1-20 scale means for South African schools T20
 * cricket — the SAME scale a coach assesses on, because the two numbers are
 * compared and adjusted against each other and a rating on two scales is not a
 * rating. They are a starting position, chosen to put a solid first-team
 * player around 13 and to make 18+ genuinely rare. They are
 * deliberately in one exported object so a director of sport can argue with
 * them and change them without touching the arithmetic below.
 *
 * Each is a list of [statistic, score] points, interpolated between and
 * clamped at the ends.
 */
export const STAT_ANCHORS = Object.freeze({
  // Batting average. Higher is better.
  battingAverage: [[0, 1], [10, 5], [15, 8], [30, 13], [50, 18], [70, 20]],
  // Strike rate, runs per 100 balls. Higher is better.
  battingStrikeRate: [[50, 2], [90, 8], [120, 13], [150, 18], [180, 20]],
  // Economy, runs per over. LOWER is better, so the points descend.
  bowlingEconomy: [[4.5, 20], [6.0, 16], [7.5, 11], [9.0, 6], [12.0, 1]],
  // Bowling strike rate, balls per wicket. LOWER is better.
  bowlingStrikeRate: [[12, 20], [18, 16], [24, 12], [30, 8], [42, 3]],
});

/**
 * How much of the batting index is the average rather than the strike rate.
 *
 * 0.6 says an average matters more than a strike rate, which is the right
 * emphasis for age-group cricket where the job is usually to bat time. A T20
 * specialist competition would want this lower.
 */
export const BATTING_AVERAGE_WEIGHT = 0.6;

/**
 * The smallest sample that produces an index at all.
 *
 * Below these, the function returns null with a reason rather than a number.
 * This is the single most important guard here: a boy who faced one ball and
 * hit it for six has a strike rate of 600, and without a floor the platform
 * would put a 100 next to a child's name on the strength of one delivery. A
 * school would be right never to trust it again.
 */
export const MIN_BALLS_FACED = 30;   // roughly five overs at the crease
export const MIN_BALLS_BOWLED = 36;  // six overs

/** Sample sizes at which an index stops being provisional. */
const CONFIDENCE_STEPS = { batting: [30, 90, 240], bowling: [36, 120, 300] };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Interpolate a statistic onto the 1-20 scale using an anchor table.
 *
 * Handles both directions: a descending table (economy, where lower is better)
 * works without a separate code path, because the interpolation only cares
 * that the statistic axis is monotonic.
 */
export function scoreFrom(anchors, value) {
  if (value == null || !Number.isFinite(value)) return null;
  const pts = anchors;
  const ascending = pts[pts.length - 1][0] > pts[0][0];
  const lo = ascending ? pts[0] : pts[pts.length - 1];
  const hi = ascending ? pts[pts.length - 1] : pts[0];
  if (value <= Math.min(pts[0][0], pts[pts.length - 1][0])) return ascending ? lo[1] : pts[0][1];
  if (value >= Math.max(pts[0][0], pts[pts.length - 1][0])) return ascending ? hi[1] : pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const within = x0 <= x1 ? value >= x0 && value <= x1 : value <= x0 && value >= x1;
    if (!within) continue;
    if (x1 === x0) return y1;
    return round1(y0 + ((value - x0) / (x1 - x0)) * (y1 - y0));
  }
  return null;
}

const confidence = (kind, sample) => {
  const [min, fair, good] = CONFIDENCE_STEPS[kind];
  if (sample < min) return "none";
  if (sample < fair) return "low";
  if (sample < good) return "fair";
  return "good";
};

/**
 * Batting, from the career counts the read path returns.
 *
 * @param {{runs:number, ballsFaced:number, dismissals:number}} c
 * @returns {{value:number|null, confidence:string, reason:string|null, parts:object}}
 *   `value` is null whenever the sample cannot support a number. `parts`
 *   carries the working, so a screen can show why the score is what it is
 *   rather than asserting it.
 */
export function battingIndex(c = {}) {
  const runs = Number(c.runs ?? 0);
  const balls = Number(c.ballsFaced ?? 0);
  const outs = Number(c.dismissals ?? 0);

  if (balls < MIN_BALLS_FACED) {
    return { value: null, confidence: "none",
             reason: `only ${balls} balls faced; ${MIN_BALLS_FACED} needed`,
             parts: { ballsFaced: balls } };
  }

  const strikeRate = (runs * 100) / balls;
  const srScore = scoreFrom(STAT_ANCHORS.battingStrikeRate, strikeRate);

  // Never out is not the same as no data. The average is genuinely undefined,
  // so the index leans entirely on the strike rate and says so, rather than
  // treating runs/0 as infinity or runs/1 as an average.
  if (outs === 0) {
    return { value: srScore, confidence: "low",
             reason: "never dismissed, so there is no average — strike rate only",
             parts: { runs, ballsFaced: balls, strikeRate: round1(strikeRate), average: null,
                      averageScore: null, strikeRateScore: srScore } };
  }

  const average = runs / outs;
  const avgScore = scoreFrom(STAT_ANCHORS.battingAverage, average);
  const value = round1(avgScore * BATTING_AVERAGE_WEIGHT + srScore * (1 - BATTING_AVERAGE_WEIGHT));
  return {
    value, confidence: confidence("batting", balls), reason: null,
    parts: { runs, ballsFaced: balls, dismissals: outs,
             average: round1(average), strikeRate: round1(strikeRate),
             averageScore: avgScore, strikeRateScore: srScore,
             averageWeight: BATTING_AVERAGE_WEIGHT },
  };
}

/**
 * Bowling, from the career counts.
 *
 * @param {{runsConceded:number, ballsBowled:number, wickets:number}} c
 */
export function bowlingIndex(c = {}) {
  const conceded = Number(c.runsConceded ?? 0);
  const balls = Number(c.ballsBowled ?? 0);
  const wkts = Number(c.wickets ?? 0);

  if (balls < MIN_BALLS_BOWLED) {
    return { value: null, confidence: "none",
             reason: `only ${balls} balls bowled; ${MIN_BALLS_BOWLED} needed`,
             parts: { ballsBowled: balls } };
  }

  const economy = (conceded * 6) / balls;
  const ecoScore = scoreFrom(STAT_ANCHORS.bowlingEconomy, economy);

  // A tight spell with no wickets is a real thing and should not read as a
  // failure, so economy carries it alone rather than dividing by zero.
  if (wkts === 0) {
    return { value: ecoScore, confidence: "low",
             reason: "no wickets yet, so there is no strike rate — economy only",
             parts: { runsConceded: conceded, ballsBowled: balls, economy: round1(economy),
                      strikeRate: null, economyScore: ecoScore, strikeRateScore: null } };
  }

  const strikeRate = balls / wkts;
  const srScore = scoreFrom(STAT_ANCHORS.bowlingStrikeRate, strikeRate);
  const value = round1((ecoScore + srScore) / 2);
  return {
    value, confidence: confidence("bowling", balls), reason: null,
    parts: { runsConceded: conceded, ballsBowled: balls, wickets: wkts,
             economy: round1(economy), strikeRate: round1(strikeRate),
             economyScore: ecoScore, strikeRateScore: srScore },
  };
}

/**
 * The coach's own number for a discipline: the mean of the attribute scores
 * that discipline draws on (see DISCIPLINES in rubric.mjs).
 *
 * Returns null rather than 0 for a discipline nobody has assessed, because an
 * unassessed player and a player rated zero are different claims and only one
 * of them has ever been made about anybody.
 */
export function coachIndex(categoryScores = {}) {
  const vals = Object.values(categoryScores).filter((v) => Number.isFinite(v));
  if (!vals.length) return { value: null, metrics: 0 };
  return { value: round1(vals.reduce((a, b) => a + b, 0) / vals.length), metrics: vals.length };
}

/**
 * How much evidence the coach's eye is worth, in deliveries.
 *
 * The one number that decides how fast a rating leaves its anchor. Performance
 * takes weight `sample / (sample + COACH_PRIOR_BALLS)`, so at 120 balls faced
 * the two are level, and either side of that the larger body of evidence
 * carries more.
 *
 * 120 is a starting position, not a fact, and it is exported so a director of
 * sport can argue with it. Two things recommend it. It puts the halfway point
 * at roughly the sample where battingIndex() stops calling itself provisional,
 * so the coach keeps the louder voice for exactly as long as the index is
 * shaky. And it reproduces the fixed 60/40 blend this replaced at 80 balls
 * faced — about a season of age-group cricket — so the model does not lurch
 * on the day it is adopted; it simply stops being frozen there.
 *
 * Raise it and coaches hold sway longer. Lower it and the log answers back
 * sooner. Set it to 0 and the coach's assessment is decoration.
 */
export const COACH_PRIOR_BALLS = 120;

/**
 * The rating, its anchor, and how far the evidence has moved it.
 *
 * `sample` is the DELIVERIES BEHIND THE PERFORMANCE INDEX — balls faced for
 * batting, balls bowled for bowling — and it must be measured over the same
 * period as `performance`.
 *
 * WHICH PERIOD IS THE CALLER'S DECISION, AND IT MATTERS. The honest window is
 * "since the assessment being anchored on": when a coach looks again in
 * September, their new number already contains everything they saw before it,
 * and feeding three seasons of old match data back in would dilute the fresh
 * judgement they just made. The career views in db/02_schema_scoring.sql are
 * LIFETIME aggregates, so anything wired to them today anchors on the latest
 * assessment while feeding it evidence that predates it. That is a known
 * approximation, not a design.
 *
 * When one side is missing the rating IS the other side, and `basis` says so —
 * never a blend with a zero standing in for the absent input, which would halve
 * the rating of every player nobody has assessed yet.
 */
export function adjustedRating({ coach = null, performance = null, sample = 0,
                                 priorBalls = COACH_PRIOR_BALLS } = {}) {
  const c = Number.isFinite(coach) ? coach : null;
  const p = Number.isFinite(performance) ? performance : null;
  const n = Number.isFinite(sample) && sample > 0 ? sample : 0;

  if (c == null && p == null) {
    return { value: null, basis: "none", coach: null, performance: null,
             sample: n, performanceWeight: 0, drift: null,
             explanation: "No assessment and not enough match data yet." };
  }
  if (p == null) {
    return { value: c, basis: "coach", coach: c, performance: null,
             sample: n, performanceWeight: 0, drift: 0,
             explanation: "The coach's assessment, unmoved: not enough match data to adjust it yet." };
  }
  if (c == null) {
    return { value: p, basis: "performance", coach: null, performance: p,
             sample: n, performanceWeight: 1, drift: null,
             explanation: "Derived from match data. No coach assessment to anchor it." };
  }

  // The shrinkage itself. With no evidence the weight is 0 and the rating is
  // exactly the coach's number; it approaches the performance index from below
  // and never reaches it, because a coach's judgement is never worth nothing.
  const w = priorBalls <= 0 ? 1 : n / (n + priorBalls);
  const value = round1(c + (p - c) * w);
  const drift = round1(value - c);
  const pct = Math.round(w * 100);
  return {
    value, basis: "adjusted", coach: c, performance: p, sample: n,
    performanceWeight: Math.round(w * 1000) / 1000, drift,
    explanation: drift === 0
      ? `The coach rated ${c}; ${n} deliveries of match data agree.`
      : `The coach rated ${c}; ${n} deliveries of match data (${pct}% weight) `
        + `have moved it ${drift > 0 ? "up" : "down"} to ${value}.`,
  };
}

// Which disciplines a performance index can speak to lives in rubric.mjs, with
// the attribute set it is defined over. It is NOT re-exported here: the
// package index star-exports both files, and a name exported from two modules
// is dropped rather than reported.

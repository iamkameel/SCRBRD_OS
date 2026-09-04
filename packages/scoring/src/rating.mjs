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
 * WHY THEY ARE NEVER SILENTLY BLENDED
 * ───────────────────────────────────
 * The obvious thing is to average them into one number and show that. Do not.
 * The moment a coach disagrees with a rating — and they will, in front of a
 * parent — the only useful question is "which half moved?", and a blended
 * number cannot answer it. Worse, a blend hides that one half may be missing:
 * a player with four innings has no meaningful index, and averaging a real
 * assessment with a fabricated one produces a number that is confidently
 * wrong.
 *
 * So both halves are computed separately, both are returned, and `composite()`
 * states its own working. A screen may show one number; it must be able to
 * show where it came from.
 *
 * WHAT IS NOT HERE
 * ────────────────
 * There is no fielding index and no fitness index, because ball_event records
 * neither. A catch appears only inside free-text dismissal wording, and
 * nothing in the platform measures a sprint. Those two categories are
 * coach-assessed or they are absent — inventing them from batting numbers
 * would be exactly the fabrication this module exists to avoid.
 */

/**
 * Calibration, and it is CALIBRATION rather than fact.
 *
 * These anchors say what a score of 40, 65, 90 and 100 mean for South African
 * schools T20 cricket. They are a starting position, chosen to put a solid
 * first-team player around 65 and to make 90+ genuinely rare. They are
 * deliberately in one exported object so a director of sport can argue with
 * them and change them without touching the arithmetic below.
 *
 * Each is a list of [statistic, score] points, interpolated between and
 * clamped at the ends.
 */
export const ANCHORS = Object.freeze({
  // Batting average. Higher is better.
  battingAverage: [[0, 0], [10, 25], [15, 40], [30, 65], [50, 90], [70, 100]],
  // Strike rate, runs per 100 balls. Higher is better.
  battingStrikeRate: [[50, 10], [90, 40], [120, 65], [150, 90], [180, 100]],
  // Economy, runs per over. LOWER is better, so the points descend.
  bowlingEconomy: [[4.5, 100], [6.0, 80], [7.5, 55], [9.0, 30], [12.0, 5]],
  // Bowling strike rate, balls per wicket. LOWER is better.
  bowlingStrikeRate: [[12, 100], [18, 80], [24, 60], [30, 40], [42, 15]],
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
 * Interpolate a statistic onto a 0-100 score using an anchor table.
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
  const srScore = scoreFrom(ANCHORS.battingStrikeRate, strikeRate);

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
  const avgScore = scoreFrom(ANCHORS.battingAverage, average);
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
  const ecoScore = scoreFrom(ANCHORS.bowlingEconomy, economy);

  // A tight spell with no wickets is a real thing and should not read as a
  // failure, so economy carries it alone rather than dividing by zero.
  if (wkts === 0) {
    return { value: ecoScore, confidence: "low",
             reason: "no wickets yet, so there is no strike rate — economy only",
             parts: { runsConceded: conceded, ballsBowled: balls, economy: round1(economy),
                      strikeRate: null, economyScore: ecoScore, strikeRateScore: null } };
  }

  const strikeRate = balls / wkts;
  const srScore = scoreFrom(ANCHORS.bowlingStrikeRate, strikeRate);
  const value = round1((ecoScore + srScore) / 2);
  return {
    value, confidence: confidence("bowling", balls), reason: null,
    parts: { runsConceded: conceded, ballsBowled: balls, wickets: wkts,
             economy: round1(economy), strikeRate: round1(strikeRate),
             economyScore: ecoScore, strikeRateScore: srScore },
  };
}

/**
 * The coach's own number for a category: the mean of their metric scores.
 *
 * Returns null rather than 0 for a category nobody has assessed, because an
 * unassessed player and a player rated zero are different claims and only one
 * of them has ever been made about anybody.
 */
export function coachIndex(categoryScores = {}) {
  const vals = Object.values(categoryScores).filter((v) => Number.isFinite(v));
  if (!vals.length) return { value: null, metrics: 0 };
  return { value: round1(vals.reduce((a, b) => a + b, 0) / vals.length), metrics: vals.length };
}

/**
 * One number, and its working.
 *
 * The default weight leans to the coach, deliberately. A performance index is
 * a measure of output in matches the child happened to be picked for, and a
 * fourteen-year-old batting at eight in a strong side has no way to move it. A
 * coach can see what the log cannot.
 *
 * When one half is missing the composite IS the other half, and `basis` says
 * so — never a blend with a zero standing in for the absent input, which would
 * halve the rating of every player who has not yet been assessed.
 */
export const COACH_WEIGHT = 0.6;

export function composite({ coach = null, performance = null, coachWeight = COACH_WEIGHT } = {}) {
  const c = Number.isFinite(coach) ? coach : null;
  const p = Number.isFinite(performance) ? performance : null;

  if (c == null && p == null) {
    return { value: null, basis: "none", coach: null, performance: null, coachWeight,
             explanation: "No assessment and not enough match data yet." };
  }
  if (p == null) {
    return { value: c, basis: "coach", coach: c, performance: null, coachWeight,
             explanation: "The coach's assessment. Not enough match data for a performance index yet." };
  }
  if (c == null) {
    return { value: p, basis: "performance", coach: null, performance: p, coachWeight,
             explanation: "Derived from match data. No coach assessment on record yet." };
  }
  return {
    value: round1(c * coachWeight + p * (1 - coachWeight)),
    basis: "both", coach: c, performance: p, coachWeight,
    explanation: `${Math.round(coachWeight * 100)}% coach assessment, `
               + `${Math.round((1 - coachWeight) * 100)}% match performance.`,
  };
}

/** Categories a performance index can speak to. The other two are coach-only. */
export const DERIVABLE_CATEGORIES = Object.freeze(["batting", "bowling"]);
export const COACH_ONLY_CATEGORIES = Object.freeze(["fielding", "fitness"]);

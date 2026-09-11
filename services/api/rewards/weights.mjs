/**
 * SCRBRD — the rewards algorithm's coefficients, and why this file is here and
 * not in packages/.
 *
 * THIS MODULE MUST NEVER BE REACHABLE FROM apps/web. Everything under
 * packages/ is imported by the client, and everything the client imports is in
 * a bundle, which is a text file on a stranger's laptop. The names below
 * describe the SHAPE of the algorithm — that it weighs growth against current
 * rating at all is the interesting part — so the names are as confidential as
 * the numbers. tools/check-bundle.mjs reads the built client and fails if any
 * of them appears in it; that assertion is the only thing that makes this
 * paragraph true, rather than merely intended.
 *
 * NO VALUES ARE IN THIS FILE. They live in reward_weight, behind a platform
 * capability, versioned by the date they took effect, and are read one at a
 * time through a SECURITY DEFINER accessor — see the long note in db/08. A
 * default value here would be the coefficient, in code, committed.
 *
 * HONEST ABOUT THE BOUNDARY: reward_weight_at() is granted to the application
 * role, because the computation runs as whoever asked for a player's figure and
 * that person may not read the table. So any code in this service CAN obtain a
 * coefficient. The boundary is therefore our own code, not the database — which
 * is why there is no read resource and no read route for these values, and why
 * a walk asserts both. The database narrows it as far as it can; the rest is
 * this file staying where it is.
 */

/**
 * The terms of the composite, and what each is for.
 *
 * Written down because a weighted sum whose terms nobody can name is a number
 * nobody can defend, and the first parent to ask "why did my son get less than
 * his" deserves an answer in words. What stays private is the WEIGHTS, not the
 * existence of the terms — but the names travel with the weights here because
 * the two together are the algorithm, and a client has no use for either.
 */
export const WEIGHT_KEYS = Object.freeze({
  // Impact-adjusted performance, not runs. The ImpactEngine reading — pressure
  // and opposition already normalise for context — folded out of the ball log
  // on replay, never a stored figure.
  performance: "reward.performance",
  // Where the boy is now, on the absolute 1-20 rubric, age-benchmarked at read
  // time exactly as the rubric does it.
  rating: "reward.rating",
  // How much evidence that rating rests on, and how fresh. A 16 anchored last
  // week across eight attributes is worth more than a 16 from one assessment
  // in February, and this term is what says so.
  evidence: "reward.evidence",
  // THE TERM THAT MAKES THIS DIFFERENT FROM EVERY FANTASY-POINTS SYSTEM. The
  // change in absolute rubric score over elapsed time, which our rubric was
  // built to make comparable across ages — so a boy going from 4 to 9 on the
  // cover drive can out-earn a boy who was always a 15 and stayed there.
  growth: "reward.growth",
  // The ceiling on any one window's contribution. This is the anti-farming
  // term: without it a single unbeaten hundred against a weak side dominates a
  // term, and the incentive becomes the slog rather than the cricket.
  windowCap: "reward.window_cap",
  // How much the side's own result scales an individual's figure. Their
  // version has no such term, which is why it pays a boy to play for himself.
  teamGate: "reward.team_gate",
});

/**
 * One coefficient, in force on a date.
 *
 * `client` is a connection already carrying somebody's principal — this does
 * not open its own, because a helper that connects on its own behalf is a
 * helper that has forgotten whose question it is answering.
 *
 * Returns null when no coefficient has ever been set for the key, and the
 * caller must treat that as "cannot compute", never as zero: a missing growth
 * weight silently turning the growth term off would produce a plausible figure
 * built on three terms instead of four, and nothing on screen would say so.
 */
export async function weightAt(client, key, onDate = null) {
  const { rows } = await client.query(
    `select reward_weight_at($1, coalesce($2::date, current_date)) as value`, [key, onDate]);
  const v = rows[0]?.value;
  return v == null ? null : Number(v);
}

/**
 * Every coefficient the algorithm needs, or a list of the ones that are missing.
 *
 * Deliberately NOT a SQL function returning the set — db/08 says why: a
 * function that returns the set is the algorithm in one call, and a single
 * reachable call is a smaller thing to leak than six. Looping here keeps that
 * property and costs six index lookups.
 *
 * A partial answer is refused rather than filled in. An award computed with a
 * term missing is not a smaller award, it is a different algorithm.
 */
export async function weightsFor(client, onDate = null) {
  const out = {};
  const missing = [];
  for (const [name, key] of Object.entries(WEIGHT_KEYS)) {
    const v = await weightAt(client, key, onDate);
    if (v == null) missing.push(key); else out[name] = v;
  }
  return missing.length ? { ok: false, missing } : { ok: true, weights: out };
}

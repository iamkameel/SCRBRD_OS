/**
 * SCRBRD — recording a coach's assessment.
 *
 * The half of a player's rating that a ball log cannot produce. A coach rates
 * technique, temperament, footwork and the rest; the performance index in
 * packages/scoring/src/rating.mjs handles what the log does say, and the two
 * are kept apart on purpose.
 *
 * AUTHORIZATION IS NOT HERE
 * ─────────────────────────
 * This handler checks no capability and no scope. player_skill carries an
 * INSERT policy requiring player.development.write against the player's own
 * school and CURRENT team — the anchors resolve through the player row — so a
 * coach records assessments for the side they coach and Postgres refuses
 * anything else. A check here would be a second opinion that can drift from
 * the first, and the first is the one that runs.
 *
 * What this layer does do is shape: reject a malformed body loudly rather than
 * writing a half-row, and record WHO assessed and WHEN, because an assessment
 * with no author is not a judgement anybody can stand behind.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

/** Categories and the metrics each may carry. */
export const ASSESSMENT_SHAPE = Object.freeze({
  batting:  ["technique", "power", "footwork", "running", "temperament"],
  bowling:  ["accuracy", "line", "variations", "pace", "stamina"],
  fielding: ["catching", "groundwork", "throwing", "positioning"],
  fitness:  ["speed", "agility", "endurance", "strength"],
});

const err = (code, status = 400) => Object.assign(new Error(code), { status });

/**
 * Validate before touching the database.
 *
 * A free-text metric would quietly create a new row type nobody renders, and
 * the UNIQUE key on (player, date, category, metric) would then never collide
 * with the real one — so the same assessment could be recorded twice under a
 * typo and both would show.
 */
export function validateAssessment(body) {
  const scores = body?.scores;
  if (!scores || typeof scores !== "object" || Array.isArray(scores))
    throw err("scores_required");

  const rows = [];
  for (const [category, metrics] of Object.entries(scores)) {
    const allowed = ASSESSMENT_SHAPE[category];
    if (!allowed) throw err(`unknown_category:${category}`);
    if (!metrics || typeof metrics !== "object") throw err(`bad_category:${category}`);
    for (const [metric, raw] of Object.entries(metrics)) {
      if (!allowed.includes(metric)) throw err(`unknown_metric:${category}.${metric}`);
      const score = Number(raw);
      if (!Number.isInteger(score) || score < 0 || score > 100)
        throw err(`bad_score:${category}.${metric}`);
      rows.push({ category, metric, score });
    }
  }
  if (!rows.length) throw err("no_scores");
  return rows;
}

/**
 * Record an assessment.
 *
 * Upserts on (player, date, category, metric): a coach revising a rating on the
 * same day is correcting themselves, not filing a second opinion. A rating on
 * a LATER date is a new row, because the history is the point of a development
 * record — the trend is what a coach is actually looking at.
 */
export async function recordAssessment(pool, secret, bearer, playerId, body) {
  const rows = validateAssessment(body);
  const assessedOn = body?.assessedOn || null;
  const note = body?.note ?? null;

  return runAsPrincipal(pool, secret, bearer, async (client) => {
    let written = 0;
    for (const r of rows) {
      const res = await client.query(
        `insert into player_skill
           (player_id, assessed_on, assessed_by, category, metric, score, note)
         values ($1, coalesce($2::date, current_date), app_user_id(), $3, $4, $5, $6)
         on conflict (player_id, assessed_on, category, metric)
         do update set score = excluded.score,
                       note = excluded.note,
                       assessed_by = excluded.assessed_by
         returning id`,
        [playerId, assessedOn, r.category, r.metric, r.score, note]);
      written += res.rowCount;
    }
    // Zero rows written with no error means every INSERT was refused by the
    // row-level policy. Reported as a refusal rather than as a success with
    // nothing in it — a coach who is told "saved" and finds nothing there has
    // been lied to about a permission decision.
    if (written === 0) throw err("not_permitted", 403);
    return { playerId, assessedOn, recorded: written };
  });
}

export function assessmentRoutes({ pool, secret }) {
  return {
    // POST /players/:id/assessment { assessedOn?, note?, scores: { batting: { technique: 80, … } } }
    record: async (req, res) => {
      try {
        res.json(await recordAssessment(
          pool, secret, req.headers?.authorization, req.params.id, req.body || {}));
      } catch (e) {
        // 42501 is the policy refusing the write outright.
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}

/**
 * SCRBRD — recording a coach's assessment.
 *
 * The half of a player's rating that a ball log cannot produce. A coach rates
 * footwork, composure, natural fitness and the rest; the performance index in
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
import { TREE, SCALE_MIN, SCALE_MAX, DISCIPLINES } from "@scrbrd/scoring";

/**
 * Groups and the attributes each may carry — TAKEN FROM THE RUBRIC, not
 * restated here.
 *
 * It used to be a copy, and a copy of a vocabulary is a vocabulary that
 * diverges: the write path would accept an attribute the rubric had renamed,
 * store it, and nothing would render it. The rubric is the one place the
 * attribute set is decided.
 */
export const ASSESSMENT_SHAPE = TREE;

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
      // 1-20, integers. Not 0: an attribute nobody has is not a thing, and
      // not fractional: a coach who cannot defend 13 against 14 certainly
      // cannot defend 13.5.
      const score = Number(raw);
      if (!Number.isInteger(score) || score < SCALE_MIN || score > SCALE_MAX)
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

/** The most a single note may move a rating. Mirrors the CHECK on the column. */
export const NOTE_ADJUSTMENT_LIMIT = 3;

/**
 * Validate a development note.
 *
 * The prose is not inspected beyond being non-empty — it is a coach's writing
 * and this is not the place to have opinions about it. The SIGNAL is inspected
 * closely, because it is the part that moves a number attached to a child's
 * name.
 */
export function validateNote(body) {
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) throw err("body_required");
  if (text.length > 4000) throw err("body_too_long");

  const discipline = body?.aboutDiscipline ?? null;
  if (discipline !== null && !Object.hasOwn(DISCIPLINES, discipline))
    throw err(`unknown_discipline:${discipline}`);

  let adjustment = body?.adjustment ?? null;
  if (adjustment !== null && adjustment !== undefined) {
    adjustment = Number(adjustment);
    if (!Number.isInteger(adjustment)) throw err("bad_adjustment");
    if (Math.abs(adjustment) > NOTE_ADJUSTMENT_LIMIT) throw err("adjustment_too_large");
    // An adjustment with nothing to adjust is a number with no subject. Refused
    // rather than stored and ignored, because stored-and-ignored is how a coach
    // comes to believe they moved a rating they did not move.
    if (!discipline) throw err("adjustment_needs_a_discipline");
    if (adjustment === 0) adjustment = null;
  } else adjustment = null;

  return { text, discipline, adjustment, observedOn: body?.observedOn || null };
}

/**
 * Write one.
 *
 * school_id is taken from the PLAYER inside the statement rather than from the
 * caller's payload. A row whose tenant the writer chooses is a row that can be
 * filed against the wrong school, and the policy anchors on it.
 */
export async function recordNote(pool, secret, bearer, playerId, body) {
  const n = validateNote(body);
  return runAsPrincipal(pool, secret, bearer, async (client) => {
    const { rows } = await client.query(
      `insert into development_note
         (player_id, school_id, author_id, body, about_discipline, adjustment, observed_on)
       select $1, player_school($1), app_user_id(), $2, $3, $4,
              coalesce($5::date, current_date)
        where player_school($1) is not null
       returning id, observed_on`,
      [playerId, n.text, n.discipline, n.adjustment, n.observedOn]);
    if (!rows.length) throw err("not_permitted", 403);
    return { playerId, id: rows[0].id, observedOn: rows[0].observed_on };
  });
}

/** Revise your own. The trigger refuses somebody else's. */
export async function reviseNote(pool, secret, bearer, noteId, body) {
  const n = validateNote(body);
  return runAsPrincipal(pool, secret, bearer, async (client) => {
    const { rows } = await client.query(
      `update development_note
          set body = $2, about_discipline = $3, adjustment = $4
        where id = $1
       returning id`,
      [noteId, n.text, n.discipline, n.adjustment]);
    if (!rows.length) throw err("not_permitted", 403);
    return { id: rows[0].id };
  });
}

export function developmentNoteRoutes({ pool, secret }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      const status = (e.code === "42501" || e.code === "45001") ? 403 : (e.status || 500);
      // 42501 is row-level security: this player is not yours. 45001 is the
      // note trigger: the player is yours and the note is somebody else's.
      const msg = e.code === "45001" ? "not_the_author"
                : e.code === "42501" ? "not_permitted"
                : (e.message || "error");
      res.status(status).json({ error: msg });
    }
  };
  return {
    // POST /players/:id/notes { body, aboutDiscipline?, adjustment?, observedOn? }
    write: handle((req) => recordNote(
      pool, secret, req.headers?.authorization, req.params.id, req.body || {})),
    // PATCH /notes/:id { body, aboutDiscipline?, adjustment? }
    revise: handle((req) => reviseNote(
      pool, secret, req.headers?.authorization, req.params.id, req.body || {})),
  };
}

export function assessmentRoutes({ pool, secret }) {
  return {
    // POST /players/:id/assessment { assessedOn?, note?, scores: { technical: { footwork: 14, … } } }
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


/**
 * Asking another coach about one of their players, and answering.
 *
 * Both handlers do the same thing every other write path here does: nothing.
 * The INSERT policy on access_request decides who may ask, and
 * access_request_decide() checks the decider's authority over that player's
 * current side before it creates anything. A check in JavaScript would be a
 * second opinion that can drift from the one that actually runs.
 */
export function accessRequestRoutes({ pool, secret }) {
  const REASONS = new Set(["promotion", "fill_in", "selection", "other"]);
  return {
    // POST /players/:id/access-request { forTeam, reason, note? }
    ask: async (req, res) => {
      try {
        const { forTeam, reason, note } = req.body || {};
        if (!forTeam) throw err("for_team_required");
        if (!REASONS.has(reason)) throw err("bad_reason");
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization,
          async (client) => {
            const { rows } = await client.query(
              // player_school() rather than a join, because the requester
              // cannot read the player row — that is the entire reason they
              // are asking. A join here returns no rows and the request is
              // refused for a reason that has nothing to do with permission.
              `insert into access_request
                 (player_id, school_id, for_team, requested_by, reason, note)
               values ($1, player_school($1), $2, app_user_id(), $3, $4)
               returning id, state`,
              [req.params.id, forTeam, reason, note ?? null]);
            // No row and no error means the policy refused, or the player is
            // one this caller cannot even see. Either way it is a refusal, and
            // reporting it as a successful no-op would leave a coach waiting
            // for an answer to a question nobody was asked.
            if (!rows[0]) throw err("not_permitted", 403);
            return rows[0];
          });
        res.json(out);
      } catch (e) {
        const status = e.code === "23505" ? 409 : e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({
          error: e.code === "23505" ? "already_asked"
               : e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },

    // POST /access-requests/:id/decide { grant: true|false, note?, days? }
    decide: async (req, res) => {
      try {
        const { grant, note, days } = req.body || {};
        if (typeof grant !== "boolean") throw err("grant_required");
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization,
          async (client) => {
            const { rows } = await client.query(
              `select * from access_request_decide($1, $2, $3, $4)`,
              [req.params.id, grant, note ?? null, Number.isInteger(days) ? days : 14]);
            return rows[0] || { ok: false, reason: "no_result" };
          });
        res.status(out.ok ? 200 : 403).json(out);
      } catch (e) {
        res.status(e.status || 500).json({ error: e.message || "error" });
      }
    },
  };
}


/**
 * Guardian links, over HTTP.
 *
 * The five functions behind these were built, falsified and covered by 55
 * assertions — and had NO ROUTE. A registrar could not establish, verify or end
 * a guardian link from the application at all, which made the POPIA obligation
 * they satisfy unreachable by the only people who need it.
 *
 * Each handler does what every write path here does: nothing. Authority,
 * self-creation, the coach-of-this-player rule and the last-verified-link rule
 * are all checked inside the functions, under the caller's identity.
 */
export function guardianLinkRoutes({ pool, secret }) {
  const call = (sql, params) => (req) => runAsPrincipal(
    pool, secret, req.headers?.authorization,
    async (client) => {
      const { rows } = await client.query(sql, params(req));
      const r = rows[0] ?? { ok: false, reason: "no_result" };
      if (r.ok === false) { const e = err(r.reason || "refused", 403); throw e; }
      return r;
    });
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };
  return {
    // POST /players/:id/guardians { guardianId, relationship? }
    establish: handle(call(
      `select * from guardian_link_establish($1, $2, $3)`,
      (req) => [req.body?.guardianId, req.params.id, req.body?.relationship || "parent"])),
    // POST /players/:id/guardians/verify { guardianId, consentVersion?, note? }
    verify: handle(call(
      `select * from guardian_link_verify($1, $2, $3, $4)`,
      (req) => [req.body?.guardianId, req.params.id,
                req.body?.consentVersion || null, req.body?.note || null])),
    // POST /players/:id/guardians/revoke { guardianId, note? }
    revoke: handle(call(
      `select * from guardian_link_revoke($1, $2, $3)`,
      (req) => [req.body?.guardianId, req.params.id, req.body?.note || null])),
    // POST /players/:id/guardians/consent { guardianId, consentVersion }
    consent: handle(call(
      `select * from guardian_consent_record($1, $2, $3)`,
      (req) => [req.body?.guardianId, req.params.id, req.body?.consentVersion])),
    // POST /players/:id/guardians/withdraw { guardianId }
    withdraw: handle(call(
      `select * from guardian_consent_withdraw($1, $2)`,
      (req) => [req.body?.guardianId, req.params.id])),
  };
}

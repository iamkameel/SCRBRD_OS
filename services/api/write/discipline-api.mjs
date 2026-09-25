/**
 * SCRBRD — filing and progressing a disciplinary matter (SCRBRD-053).
 *
 * Two writers, and they are not the same job. An `official` files what
 * happened on the field, under an appointment that names one fixture. A
 * `directorofsport` files a school-side conduct matter and is the person who
 * concludes either kind. Both hold `discipline.write`; what separates them is
 * the scope of the assignment carrying it, which is app_can()'s answer and
 * not this file's.
 *
 * AUTHORIZATION IS NOT HERE
 * ─────────────────────────
 * disciplinary_record carries INSERT and UPDATE policies requiring
 * discipline.write against the row's school, the player's current side and —
 * this is the one that matters for an umpire — the fixture the row names
 * (db/25). A check here would be a second opinion that can drift from the
 * first, and the first is the one that runs.
 *
 * NO `RETURNING`, ANYWHERE, AND THAT IS NOT AN OVERSIGHT
 * ─────────────────────────────────────────────────────
 * `official` holds discipline.write and NOT discipline.read — the split
 * separation.test.mjs §11.4 already asserts from the other side for
 * schooladmin. Postgres applies the SELECT policy to any row an INSERT or
 * UPDATE returns, so `returning id` would have refused the one writer this
 * capability exists for, after accepting the write, with the misleading
 * message "new row violates row-level security policy". Verified against
 * Postgres 16 with a two-policy probe table before this was written, not
 * assumed from the documentation.
 *
 * So both handlers report rowCount, exactly as clearance-api and kit-api do,
 * and a writer who may not read the record is told it landed without being
 * handed a key to it.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler, Pool } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

/** The states a matter can be in. Mirrors the CHECK on the column. */
export const DISCIPLINE_STATES = Object.freeze(["open", "concluded", "withdrawn"]);

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });

/**
 * Validate an incident before touching the database.
 *
 * The prose is not inspected beyond being non-empty and bounded — it is
 * somebody's account of what happened and this is not the place to have
 * opinions about it. The fixture is not checked against the player's school
 * either: the INSERT policy's fixture anchor already refuses a match the
 * writer's appointment does not cover, and a second rule here would be a
 * different rule sooner or later.
 * @param {any} body  the request body as sent; validated here
 */
export function validateIncident(body) {
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) throw err("body_required");
  if (text.length > 4000) throw err("body_too_long");
  return { text, matchId: body?.matchId || null, occurredOn: body?.occurredOn || null };
}

/**
 * Validate a progression.
 *
 * At least one field, because an UPDATE that changes nothing still stamps
 * updated_at and would read as somebody having looked at the matter and
 * decided something. The pairing rule — a matter that is no longer open has
 * to say what happened — is the CHECK constraint's, not this function's: it
 * needs the row's existing outcome, and reading the row to validate a write
 * is how a handler starts making authorization decisions of its own.
 * @param {any} body  the request body as sent; validated here
 */
export function validateProgress(body) {
  const state = body?.state ?? null;
  if (state !== null && !DISCIPLINE_STATES.includes(state)) throw err(`unknown_state:${state}`);
  const trim = (/** @type {unknown} */ v) => (typeof v === "string" ? v.trim() || null : null);
  const outcome = trim(body?.outcome);
  const text = trim(body?.body);
  if (text !== null && text.length > 4000) throw err("body_too_long");
  if (state === null && outcome === null && text === null) throw err("nothing_to_change");
  return { state, outcome, text };
}

/**
 * File one.
 *
 * school_id comes from the PLAYER inside the statement rather than from the
 * caller's payload, the same way a development note's does: a row whose tenant
 * the writer chooses is a row that can be filed against the wrong school, and
 * the policy anchors on it. player_school() is SECURITY DEFINER, so it
 * answers for an umpire who holds no capability to read the roster.
 * @param {Pool} pool
 * @param {string} secret
 * @param {string | undefined} bearer  the Authorization header, as sent
 * @param {string | undefined} playerId
 * @param {any} body  the request body as sent; validated here
 */
export async function recordIncident(pool, secret, bearer, playerId, body) {
  const n = validateIncident(body);
  return runAsPrincipal(pool, secret, bearer, async (client) => {
    const { rowCount } = await client.query(
      `insert into disciplinary_record
         (player_id, school_id, match_id, recorded_by, body, occurred_on)
       select $1, player_school($1), $2, app_user_id(), $3,
              coalesce($4::date, current_date)
        where player_school($1) is not null`,
      [playerId, n.matchId, n.text, n.occurredOn]);
    // Zero rows written with no error means the player is not one this writer
    // can even resolve a school for. A refusal, not a success with nothing in
    // it — somebody told "filed" who finds nothing there has been lied to
    // about a permission decision.
    if (!rowCount) throw err("not_permitted", 403);
    return { playerId, recorded: rowCount };
  });
}

/** Progress one. The trigger refuses somebody else's account of it. * @param {Pool} pool
 * @param {string} secret
 * @param {string | undefined} bearer  the Authorization header, as sent
 * @param {string | undefined} id
 * @param {any} body  the request body as sent; validated here
 */
export async function progressMatter(pool, secret, bearer, id, body) {
  const n = validateProgress(body);
  return runAsPrincipal(pool, secret, bearer, async (client) => {
    const { rowCount } = await client.query(
      `update disciplinary_record
          set state   = coalesce($2, state),
              outcome = coalesce($3, outcome),
              body    = coalesce($4, body)
        where id = $1`,
      [id, n.state, n.outcome, n.text]);
    if (!rowCount) throw err("not_permitted", 403);
    return { id, updated: rowCount };
  });
}

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function disciplineRoutes({ pool, secret }) {
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      // Four refusals with four different fixes, and a handler that collapsed
      // them would leave whoever hit one unable to tell which. 42501 is
      // row-level security: this child, this school or this fixture is not
      // yours. 45001 is the trigger: the matter is yours to progress and the
      // account of it is somebody else's. 45002 is the trigger again: a
      // record does not move to another child. 23514 is the CHECK: a matter
      // was closed without saying what happened.
      const status = ["42501", "45001", "45002"].includes(e.code) ? 403
                   : e.code === "23514" ? 400
                   : (e.status || 500);
      const msg = e.code === "45001" ? "not_the_author"
                : e.code === "45002" ? "subject_is_fixed"
                : e.code === "42501" ? "not_permitted"
                : e.code === "23514" ? "outcome_required"
                : (e.message || "error");
      res.status(status).json({ error: msg });
    }
  };
  return {
    // POST /players/:id/discipline { body, matchId?, occurredOn? }
    file: handle((req) => recordIncident(
      pool, secret, req.headers?.authorization, req.params.id, req.body || {})),
    // PATCH /discipline/:id { state?, outcome?, body? }
    progress: handle((req) => progressMatter(
      pool, secret, req.headers?.authorization, req.params.id, req.body || {})),
  };
}

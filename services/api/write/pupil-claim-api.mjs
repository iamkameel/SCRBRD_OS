/**
 * SCRBRD — "I am a pupil here": the pupil's claim and the office's answer
 * (SCRBRD-140, the honesty model, Migration A; db/163).
 *
 * A boy under 18 who has signed in with Google may say which school he is
 * at and who he is. It asks for nothing and opens nothing (Kameel, 18 Nov,
 * Q3): his account stays the account with no school, reading what a
 * stranger reads (db/99 §141), and the office matches him to the roster by
 * hand, which recognises him and still opens nothing. Recognised, he sees
 * his school's safeguarding card and may raise a concern (Q8). His account
 * is kept 30 days from his last claim while a yes is sought, then removed
 * by a person (Q9); his screen says so from the first day.
 *
 * WHAT THIS FILE DECIDES: nothing. Every route calls one db/163 function
 * under the caller's own identity; the function decides who may and
 * answers a code, which becomes a status here and words on the screen
 * (apps/web/src/lib/pupilClaim.js).
 *
 * THE DATE OF BIRTH. POST /api/pupil/claim takes `born` (YYYY-MM-DD), for
 * the family list's match (Migration C). It goes to the database as a bind
 * parameter, is compared there and dropped (Q2), and is never written to a
 * log here: no route logs a request body, and an error is logged by its
 * SQLSTATE through safeErr(), never its parameters.
 *
 * Routes (all signed in; a pad's resume credential reaches nothing here):
 *   GET  /api/pupil/state                 his own: { claim: null | { state, schoolId, schoolName, name, year,
 *                                           saidOn, sentOn, keepUntil, safeguarding } }
 *   POST /api/pupil/claim { schoolId, name, year?, born? }   { ok: true } or { error }
 *   POST /api/pupil/remove                his own account, now (only an account that is nothing but a claim)
 *   GET  /api/pupil-claims?schoolId=      the office's Pupil claims list: { rows }
 *   POST /api/pupil-claims/:id/recognise { playerId }
 *   POST /api/pupil-claims/:id/decline
 *   POST /api/pupil-claims/clear { schoolId }   the accounts past their 30 days: { removed }
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { safeErr } from "../log-safe.mjs";
/** @import { RouteDeps, Handler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Each answer of the claim's doors, with its status. @type {Record<string, number>} */
export const PUPIL_CLAIM_STATUS = Object.freeze({
  not_signed_in: 401,
  not_permitted: 403,
  ask_your_school_office: 403,
  request_cooldown: 409,
  no_such_school: 404,
  name_required: 422,
  year_too_long: 422,
  born_invalid: 422,
  already_recognised: 409,
  already_answered: 409,
  player_not_at_that_school: 422,
  player_has_an_account: 409,
  player_is_an_adult: 409,
  player_required: 422,
  not_a_claim: 409,
  // db/163 B1: the account raised a safeguarding concern and is kept for it.
  kept: 409,
});

/** A my_pupil_state() row, as his screen reads it. @param {any} r */
export const pupilState = (r) => (r ? {
  state: String(r.state),
  schoolId: String(r.school_id),
  schoolName: String(r.school_name),
  name: String(r.typed_name),
  year: r.typed_year == null ? null : String(r.typed_year),
  saidOn: String(r.said_under_18_on ?? ""),
  sentOn: String(r.sent_on ?? ""),
  keepUntil: r.keep_until == null ? null : String(r.keep_until),
  safeguarding: r.safeguarding === true,
} : null);

/** A pupil_claims() row, as the office's list reads it. @param {any} r */
export const officeClaim = (r) => ({
  id: String(r.id),
  accountName: r.account_name == null ? null : String(r.account_name),
  address: r.address == null ? null : String(r.address),
  name: String(r.typed_name),
  year: r.typed_year == null ? null : String(r.typed_year),
  firstAt: r.first_claim_at ? new Date(r.first_claim_at).toISOString() : null,
  lastAt: r.last_claim_at ? new Date(r.last_claim_at).toISOString() : null,
  state: String(r.state),
  keepUntil: r.keep_until == null ? null : String(r.keep_until),
  playerId: r.player_id == null ? null : String(r.player_id),
  playerName: r.player_name == null ? null : String(r.player_name),
  knownBy: r.known_by_name == null ? null : String(r.known_by_name),
  knownAt: r.known_at ? new Date(r.known_at).toISOString() : null,
});

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function pupilClaimRoutes({ pool, secret }) {
  const err = (/** @type {string} */ code, /** @type {number} */ status) => Object.assign(new Error(code), { code, status });
  /** @param {(client: any, req: any) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try {
      res.json(await runAsPrincipal(pool, secret, req.headers?.authorization, (client) => fn(client, req)));
    } catch (/** @type {any} */ e) {
      if (e.code === "22P02" || e.code === "22007" || e.code === "22008") return res.status(400).json({ error: "bad_request" });
      if (e.status && typeof e.code === "string") return res.status(e.status).json({ error: e.code });
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
      console.error("pupil claim →", safeErr(e));
      res.status(500).json({ error: "error" });
    }
  };
  /** (ok, reason) → the answer, or a refusal with its status. @param {any} r */
  const verdict = (r) => {
    if (r?.ok) return { ok: true };
    const code = r?.reason || "refused";
    throw err(code, PUPIL_CLAIM_STATUS[code] ?? 422);
  };
  const idOf = (/** @type {any} */ req) => {
    const id = String(req.params?.id ?? "");
    if (!UUID.test(id)) throw err("not_permitted", 403);
    return id;
  };
  const schoolOf = (/** @type {unknown} */ v) => {
    const s = String(v ?? "");
    if (!UUID.test(s)) throw err("no_such_school", 404);
    return s;
  };

  return {
    state: handle(async (client) => {
      // The days as the database writes them (YYYY-MM-DD), never a Date: pg would read a date at local midnight.
      const { rows } = await client.query(`select state, school_id, school_name, typed_name, typed_year, said_under_18_on::text, sent_on::text,
                                                 keep_until::text, safeguarding from my_pupil_state()`);
      return { claim: pupilState(rows[0]) };
    }),

    claim: handle(async (client, req) => {
      const b = req.body || {};
      const school = schoolOf(b.schoolId);
      const name = typeof b.name === "string" ? b.name.slice(0, 200) : "";
      const year = typeof b.year === "string" ? b.year.slice(0, 100) : null;
      // Compared in the database and dropped there (Q2). Not a real date: refused, as one in the future is.
      let born = null;
      if (b.born != null && b.born !== "") {
        // A real day of the calendar: 2012-02-30 is not one (Date would roll it into March).
        const d = typeof b.born === "string" && DAY.test(b.born) ? new Date(`${b.born}T00:00:00Z`) : null;
        if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== b.born) throw err("born_invalid", 422);
        born = b.born;
      }
      const { rows } = await client.query(`select * from pupil_claim_send($1, $2, $3, $4::date)`, [school, name, year, born]);
      return verdict(rows[0]);
    }),

    removeSelf: handle(async (client) => {
      const { rows } = await client.query(`select * from pupil_claim_remove_self()`);
      return { ...verdict(rows[0]), removed: true };
    }),

    list: handle(async (client, req) => {
      const school = schoolOf(req.query?.schoolId);
      const { rows } = await client.query(`select id, account_id, account_name, address, typed_name, typed_year, first_claim_at, last_claim_at, state,
                                                 keep_until::text, player_id, player_name, known_by_name, known_at, decided_at from pupil_claims($1)`, [school]);
      return { rows: rows.map(officeClaim) };
    }),

    recognise: handle(async (client, req) => {
      const id = idOf(req);
      const player = String(req.body?.playerId ?? "");
      if (!UUID.test(player)) throw err("player_required", 422);
      const { rows } = await client.query(`select * from pupil_claim_recognise($1, $2)`, [id, player]);
      return verdict(rows[0]);
    }),

    decline: handle(async (client, req) => {
      const { rows } = await client.query(`select * from pupil_claim_decline($1)`, [idOf(req)]);
      return verdict(rows[0]);
    }),

    clear: handle(async (client, req) => {
      const school = schoolOf(req.body?.schoolId);
      const { rows: [r] } = await client.query(`select pupil_claim_clear($1) as n`, [school]);
      return { removed: Number(r?.n ?? 0) };
    }),
  };
}

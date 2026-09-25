/**
 * SCRBRD — support access: an hour, at one school, on the record.
 *
 * platform.support.impersonate governed nothing for as long as it existed
 * (SEC-P2-03). This is what it governs now. A platform administrator holds
 * no school's roles and reads none of a school's records; a support ticket
 * about one school is answered by BEGINNING a session — one role, at one
 * school, for the minutes asked (sixty by default, four hours at most) —
 * which is a real role_assignment with an hour hand the decision functions
 * read on every statement (db/22, db/23). It stops by itself. The school's
 * own office can stop it sooner. Every read made under it is stamped with
 * the session in that school's access_log, and the session itself — who,
 * which school, which role, why — is a row the school's auditor can read.
 *
 * Both routes answer with the function's own verdict, like enrol_person():
 * a refusal is a fact the caller shows the person, not a 500.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler, CaughtError } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
/** @type {Record<string, number>} */
const STATUS = { not_permitted: 403, school_unknown: 404, no_such_access: 404 };

/** @param {ApiResponse} res @param {CaughtError} e */
const fail = (res, e) => {
  // The team-scoped CHECK on role_assignment: a coach must name a side.
  if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
  // Not a uuid where one was expected.
  if (e.code === "22P02") return res.status(400).json({ error: "bad_request" });
  const status = e.code === "42501" ? 403 : (e.status || 500);
  res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
};

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function supportAccessRoutes({ pool, secret }) {
  return {
    // POST /api/support/access { schoolId, role, reason, team?, minutes? }
    begin: async (req, res) => {
      try {
        const b = req.body || {};
        await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const { rows } = await client.query(
            `select * from support_access_begin($1, $2, $3, $4, $5)`,
            [b.schoolId ?? null, b.role ?? null, b.reason ?? null, b.team ?? null, b.minutes ?? 60]);
          const r = rows[0] ?? { ok: false, reason: "no_result" };
          if (!r.ok) throw err(r.reason || "refused", STATUS[r.reason] ?? 422);
          res.json({ id: r.id, expiresAt: r.expires_at });
        });
      } catch (/** @type {any} */ e) { fail(res, e); }
    },

    // POST /api/support/access/:id/end
    end: async (req, res) => {
      try {
        await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const { rows } = await client.query(`select * from support_access_end($1)`, [req.params.id]);
          const r = rows[0] ?? { ok: false, reason: "no_result" };
          if (!r.ok) throw err(r.reason || "refused", STATUS[r.reason] ?? 422);
          res.json({ ok: true, ...(r.reason ? { note: r.reason } : {}) });
        });
      } catch (/** @type {any} */ e) { fail(res, e); }
    },
  };
}

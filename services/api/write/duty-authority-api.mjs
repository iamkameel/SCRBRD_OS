/**
 * SCRBRD — a duty and the authority it rests on (SCRBRD-034, db/34).
 *
 * Three routes over three definer functions, and nothing decided here:
 *
 *   POST /api/duties/:id/link              duty_link()     — make the duty's
 *                                           fixture-scoped assignment and link it
 *   POST /api/duties/:id/suspend {reason}  duty_suspend()  — pause it
 *   POST /api/duties/:id/lift    {reason}  duty_lift()     — restore it
 *
 * Who may do each (the school office: user.role.assign at the school, and
 * app_may_grant for the two that give authority) is the database's answer,
 * returned as a reason the screen shows — like support_access_begin(), a
 * refusal is a fact for the person, not a 500. The reason for a suspension or
 * a lift is required by the function and by the table; the check here only
 * saves a round trip.
 *
 * Deliberately NOT module-gated. Taking a scorer's authority away must never
 * depend on whether somebody switched the officials module off.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler, CaughtError } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
/** @type {Record<string, number>} */
const STATUS = {
  not_permitted: 403, no_such_duty: 404,
  reason_required: 400, reason_too_long: 400,
  duty_withdrawn: 409, already_linked: 409, already_suspended: 409, not_suspended: 409,
  duty_suspended: 409, not_linked: 409, assignment_not_live: 409, own_duty: 403,
  no_account: 422,
};

/** @param {ApiResponse} res @param {CaughtError} e */
const fail = (res, e) => {
  // Not a uuid where one was expected.
  if (e.code === "22P02") return res.status(400).json({ error: "bad_request" });
  // A guard trigger refusing the shape of a link.
  if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
  const status = e.code === "42501" ? 403 : (e.status || 500);
  res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
};

const reasonOf = (/** @type {any} */ body) => {   // the request body, unvalidated
  const r = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!r) throw err("reason_required");
  if (r.length > 2000) throw err("reason_too_long");
  return r;
};

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function dutyAuthorityRoutes({ pool, secret }) {
  /**
   * @param {ApiRequest} req @param {ApiResponse} res
   * @param {string} sql @param {unknown[]} params
   * @param {(row: any) => unknown} shape  the function's result row → the answer
   */
  const verdict = async (req, res, sql, params, shape) => {
    await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
      const { rows } = await client.query(sql, params);
      const r = rows[0] ?? { ok: false, reason: "no_result" };
      if (!r.ok) throw err(r.reason || "refused", STATUS[r.reason] ?? 422);
      res.json(shape(r));
    });
  };
  return {
    link: async (req, res) => {
      try {
        await verdict(req, res, `select * from duty_link($1)`, [req.params.id],
          (r) => ({ dutyId: req.params.id, assignmentId: r.assignment_id }));
      } catch (/** @type {any} */ e) { fail(res, e); }
    },
    suspend: async (req, res) => {
      try {
        const reason = reasonOf(req.body);
        await verdict(req, res, `select * from duty_suspend($1, $2)`, [req.params.id, reason],
          () => ({ dutyId: req.params.id, suspended: true }));
      } catch (/** @type {any} */ e) { fail(res, e); }
    },
    lift: async (req, res) => {
      try {
        const reason = reasonOf(req.body);
        await verdict(req, res, `select * from duty_lift($1, $2)`, [req.params.id, reason],
          () => ({ dutyId: req.params.id, suspended: false }));
      } catch (/** @type {any} */ e) { fail(res, e); }
    },
  };
}

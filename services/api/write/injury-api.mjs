/**
 * SCRBRD — the physio's injury record and its reviews (GA-I19 slice A, db/111).
 *
 * WHAT THIS FILE DECIDES: nothing. Each route calls one SECURITY DEFINER
 * function under the caller's own identity, and the function decides: that
 * she holds medical.write over the boy, that the Injuries module is on for
 * her at his school, that she is not his family (Q6), that she is not under a
 * support session or a pad's credential, and every rule of the record — a
 * next review named on every review that does not clear him (Q10), a cleared
 * injury never reopened. A refusal is a word the screen shows, not a 500.
 *
 * There is NO health-consent gate here (D6, Q2): an injury record stands
 * under the guardian-link consent, as the information officer confirmed.
 *
 *   POST /api/injuries
 *     { playerId, injuryType, severity, dateInjured, restricted?, rtwDate?,
 *       nextReviewOn, emergencyServices?, notes?, recursInjuryId? }
 *     → { ok: true, id }
 *   POST /api/injuries/:id/reviews
 *     { phaseAfter, restrictedAfter?, rtwDateAfter?, nextReviewOn?, note? }
 *     → { ok: true, id }
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler, CaughtError } from "../api-types.mjs" */

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });

/**
 * The functions' refusals, by HTTP status. Anything not named here is a rule
 * of the record the physio can correct in the form: 422 with the word.
 * @type {Record<string, number>}
 */
const STATUS = {
  not_signed_in: 401,
  not_permitted: 403, not_under_support: 403, module_off: 403,
  no_such_player: 404, no_such_injury: 404,
};

/** @param {ApiResponse} res @param {CaughtError} e */
const fail = (res, e) => {
  // A malformed uuid or date reaches Postgres as a cast error.
  if (e.code === "22P02" || e.code === "22007" || e.code === "22008") return res.status(400).json({ error: "bad_request" });
  if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
  res.status(e.status || 500).json({ error: e.message || "error" });
};

/** @param {unknown} v */
const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
/** A calendar date, or null when absent; anything else is refused by name. @param {unknown} v @param {string} code */
const day = (v, code) => {
  const s = text(v);
  if (s == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw err(code);
  return s;
};
/** true, false, or null when absent. @param {unknown} v @param {string} code */
const flag = (v, code) => {
  if (v == null) return null;
  if (typeof v !== "boolean") throw err(code);
  return v;
};

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function injuryRoutes({ pool, secret }) {
  /**
   * One function call under the caller's identity; its (ok, reason, id) row
   * becomes the answer.
   * @param {ApiRequest} req @param {ApiResponse} res @param {string} sql @param {unknown[]} params
   */
  const call = async (req, res, sql, params) => {
    const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
      const { rows: [r] } = await client.query(sql, params);
      return r;
    });
    if (!out?.ok) {
      const reason = out?.reason || "refused";
      return res.status(STATUS[reason] ?? 422).json({ error: reason });
    }
    res.json({ ok: true, id: out.id });
  };

  return {
    // POST /api/injuries — the physio records an injury, and its first review.
    record: async (/** @type {ApiRequest} */ req, /** @type {ApiResponse} */ res) => {
      try {
        const b = req.body || {};
        const playerId = text(b.playerId);
        if (!playerId) throw err("player_required");
        await call(req, res,
          `select ok, reason, injury_id as id
             from injury_record($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [playerId, text(b.injuryType), text(b.severity), day(b.dateInjured, "date_injured_invalid"),
           flag(b.restricted, "restricted_invalid"), day(b.rtwDate, "rtw_date_invalid"),
           day(b.nextReviewOn, "next_review_on_invalid"), flag(b.emergencyServices, "emergency_services_invalid"),
           text(b.notes), text(b.recursInjuryId)]);
      } catch (/** @type {any} */ e) { fail(res, e); }
    },

    // POST /api/injuries/:id/reviews — a later look at an open injury.
    review: async (/** @type {ApiRequest} */ req, /** @type {ApiResponse} */ res) => {
      try {
        const b = req.body || {};
        await call(req, res,
          `select ok, reason, review_id as id
             from injury_review_record($1, $2, $3, $4, $5, $6)`,
          [req.params.id, text(b.phaseAfter), flag(b.restrictedAfter, "restricted_invalid"),
           day(b.rtwDateAfter, "rtw_date_invalid"), day(b.nextReviewOn, "next_review_on_invalid"), text(b.note)]);
      } catch (/** @type {any} */ e) { fail(res, e); }
    },
  };
}

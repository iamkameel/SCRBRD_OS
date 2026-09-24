/**
 * SCRBRD — a high school's own ceiling on an Open-band bowler's overs.
 *
 * The platform's own directive (db/08, bowling_directive) leaves the Open
 * band unrestricted: U17 and U18 play Open division at school level, and an
 * Open-division club side may field grown men who need no such rule. A high
 * school may put its own ceiling on it anyway — one row per school, opt in,
 * unset means no cap exactly as it always did.
 *
 * bowling_ceiling_school_only() in db/08 refuses the row for anything that
 * is not kind = 'school'; that refusal is the authority, this route is only
 * the shape of the request. See bowling_directive_for() for where it feeds
 * into a boy's effective limit, and its trigger for who may write it.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const overs = (/** @type {unknown} */ v, /** @type {number} */ max, /** @type {string} */ code) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw err(code);
  return n;
};

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function workloadRoutes({ pool, secret }) {
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_school" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };
  return {
    // POST /api/bowling-ceiling { schoolId, maxOversPerSpell?, maxOversPerDay? }
    ceiling: handle(async (req) => {
      const b = req.body || {};
      if (!UUID.test(String(b.schoolId ?? ""))) throw err("school_required");
      const spell = overs(b.maxOversPerSpell, 30, "max_overs_per_spell_invalid");
      const day = overs(b.maxOversPerDay, 60, "max_overs_per_day_invalid");
      if (spell == null && day == null) throw err("a_ceiling_names_at_least_one_limit");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into bowling_ceiling_open (school_id, max_overs_per_spell, max_overs_per_day)
           values ($1, $2, $3)
           on conflict (school_id) do update
             set max_overs_per_spell = excluded.max_overs_per_spell, max_overs_per_day = excluded.max_overs_per_day
           returning school_id, max_overs_per_spell, max_overs_per_day, set_by, set_at`,
          [b.schoolId, spell, day]);
        if (!rows.length) throw err("not_permitted", 403);
        const r = rows[0];
        return { schoolId: r.school_id, maxOversPerSpell: r.max_overs_per_spell, maxOversPerDay: r.max_overs_per_day,
                 setBy: r.set_by, setAt: r.set_at };
      });
    }),
  };
}

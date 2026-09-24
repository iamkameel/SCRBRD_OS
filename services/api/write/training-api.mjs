/**
 * SCRBRD — scheduling a training session, which had a table and no route.
 *
 * training_session has existed since the workload piece landed, written
 * under team.manage exactly as the drill library and the kit register are
 * (db/08, packages/policy/src/tables.mjs). Nobody had put a route in front
 * of it, so the "Create Session" button on the training screen closed its
 * own modal and threw the form away — the same shape of gap the drill and
 * kit forms closed earlier in this branch.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = ["technical", "skills", "batting", "bowling", "fielding", "fitness", "match-prep"];
const clean = (/** @type {unknown} */ v, /** @type {number} */ max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function trainingRoutes({ pool, secret }) {
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_school_or_ground" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };
  return {
    // POST /api/training { schoolId, teamCode, title, startsAt, durationMin,
    //                       sessionType, venue?, groundId?, notes? }
    schedule: handle(async (req) => {
      const b = req.body || {};
      if (!UUID.test(String(b.schoolId ?? ""))) throw err("school_required");
      const team = clean(b.teamCode, 8);
      if (!team || !/^[A-Z0-9]{2,8}$/.test(team)) throw err("team_required");
      const title = clean(b.title, 80);
      if (!title || title.length < 3) throw err("title_required");
      if (!TYPES.includes(b.sessionType)) throw err("session_type_invalid");
      const when = b.startsAt ? new Date(b.startsAt) : null;
      if (!when || Number.isNaN(when.getTime())) throw err("starts_at_invalid");
      const minutes = Number(b.durationMin);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) throw err("duration_invalid");
      const groundId = b.groundId && UUID.test(String(b.groundId)) ? b.groundId : null;

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into training_session (school_id, team_code, title, starts_at, duration_min,
                                          venue, ground_id, session_type, notes)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id, school_id, team_code, title, starts_at`,
          [b.schoolId, team, title, when.toISOString(), minutes,
           clean(b.venue, 60), groundId, b.sessionType, clean(b.notes, 300)]);
        if (!rows.length) throw err("not_permitted", 403);
        const s = rows[0];
        return { id: s.id, schoolId: s.school_id, teamCode: s.team_code, title: s.title, startsAt: s.starts_at };
      });
    }),
  };
}

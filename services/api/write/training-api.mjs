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
// The register's words. Not `injured` (GA-I26a AH-D9): see attendance below.
const ATTENDANCE = ["present", "late", "excused", "absent"];
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
  /**
   * A session this person may read and manage, or a refusal that says which:
   * 404 for one he cannot read, 403 for one he reads and may not change. A
   * refusal only, asked with the capability the table's own policies ask, so
   * an empty plan (delete, insert nothing) is not reported as saved to
   * somebody the policy would have stopped.
   * @param {import("../api-types.mjs").Db} client @param {string} id
   */
  const mayManage = async (client, id) => {
    const { rows: [t] } = await client.query(
      `select app_can('team.manage', t.school_id, t.team_code,
                      '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid) as may
         from training_session t where t.id = $1`, [id]);
    if (!t) throw err("no_such_session", 404);
    if (!t.may) throw err("not_permitted", 403);
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

    // POST /api/training/:id/plan { drills: [{ drillId, minutes? }] }
    //
    // The side's plan, keyed to the drill library (GA-I26a §1.3, db/105),
    // replaced whole: the rows go and the new ones come in, in order, in one
    // transaction. It names no boy. training_session_drill's policies decide
    // (team.manage through the session) and its trigger refuses another
    // school's drill (23514 → 422). POST rather than the design's PUT: the
    // dispatcher reads a body for POST and PATCH, and the browser's CORS list
    // allows no PUT.
    plan: handle(async (req) => {
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) throw err("session_required");
      const drills = req.body?.drills;
      if (!Array.isArray(drills) || drills.length > 20) throw err("drills_invalid");
      const rows = drills.map((/** @type {any} */ d, i) => {
        if (!d || !UUID.test(String(d.drillId ?? ""))) throw err("drill_required");
        const minutes = d.minutes == null || d.minutes === "" ? null : Number(d.minutes);
        if (minutes !== null && (!Number.isInteger(minutes) || minutes < 5 || minutes > 180)) throw err("minutes_invalid");
        return { drill_id: d.drillId, position: i + 1, minutes };
      });
      if (new Set(rows.map((r) => r.drill_id)).size !== rows.length) throw err("drill_repeated");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        await mayManage(client, id);
        await client.query(`delete from training_session_drill where session_id = $1`, [id]);
        if (rows.length) {
          await client.query(
            `insert into training_session_drill (session_id, drill_id, position, minutes)
             select $1, d.drill_id, d.position, d.minutes
               from jsonb_to_recordset($2::jsonb) as d(drill_id uuid, position smallint, minutes smallint)`,
            [id, JSON.stringify(rows)]);
        }
        return { sessionId: id, drills: rows.length };
      });
    }),

    // POST /api/training/:id/attendance { rows: [{ playerId, status }] }
    //
    // The register, which had a table and a policy and no route (GA-I26a
    // §1.4, AH-D9). present, late, excused or absent; never `injured`, which
    // is a health word on a list the side reads (422 status_not_accepted; and
    // db/105's RESTRICTIVE rule refuses it under this role whatever sends it).
    // Upserted per boy. A boy of another school is refused rather than filed.
    attendance: handle(async (req) => {
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) throw err("session_required");
      const list = req.body?.rows;
      if (!Array.isArray(list) || list.length < 1 || list.length > 60) throw err("rows_invalid");
      for (const r of list) {
        if (!r || !UUID.test(String(r.playerId ?? ""))) throw err("player_required");
        if (r.status === "injured") throw err("status_not_accepted", 422);
        if (!ATTENDANCE.includes(r.status)) throw err("status_invalid");
      }
      if (new Set(list.map((/** @type {any} */ r) => r.playerId)).size !== list.length) throw err("player_repeated");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        await mayManage(client, id);
        let written = 0;
        for (const r of list) {
          const res = await client.query(
            `insert into training_attendance (session_id, player_id, status)
             select $1, $2, $3
              where player_school($2) = (select t.school_id from training_session t where t.id = $1)
             on conflict (session_id, player_id)
             do update set status = excluded.status, recorded_at = now()
             returning player_id`,
            [id, r.playerId, r.status]);
          if (!res.rowCount) throw err("player_not_at_this_school", 422);
          written += res.rowCount;
        }
        return { sessionId: id, recorded: written };
      });
    }),
  };
}

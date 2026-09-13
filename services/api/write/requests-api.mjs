/**
 * SCRBRD — asking for a role, and answering.
 *
 * Nobody assigns themselves anything. A stranger onboards into an account
 * with nothing in it and a pending request; a person already here asks for
 * another role the same way; somebody who may grant that role at that
 * school answers through decide_role_request(), which checks the
 * decider's authority itself. See the note above role_request in db/08.
 *
 * /api/onboard and /api/schools are the two unauthenticated routes in this
 * service, and both run through SECURITY DEFINER functions that do one
 * narrow thing. Onboarding does not say whether the email was already
 * known: the answer is "requested" either way.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v, max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

export function requestRoutes({ pool, secret }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      if (e.code === "23514") return res.status(422).json({ error: "not_requestable", detail: e.message });
      if (e.code === "23505") return res.status(422).json({ error: "already_pending" });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_school" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };
  const fields = (b) => {
    const role = String(b.role ?? "").trim();
    if (!/^[a-z]{3,30}$/.test(role)) throw err("role_invalid");
    if (!UUID.test(String(b.schoolId ?? ""))) throw err("school_required");
    const team = clean(b.teamCode, 8);
    if (team && !/^[A-Z0-9]{2,8}$/.test(team)) throw err("team_code_invalid");
    return { role, school: b.schoolId, team, note: clean(b.note, 300) };
  };

  return {
    // GET /api/schools — id and name, for choosing one.
    schools: handle(async () => ({ rows: (await pool.query(`select * from public_schools()`)).rows })),

    // POST /api/onboard { email, name, role, schoolId, teamCode?, note? } — unauthenticated
    onboard: handle(async (req) => {
      const b = req.body || {};
      const f = fields(b);
      const email = String(b.email ?? "").trim();
      const name = String(b.name ?? "").trim();
      if (name.length < 2) throw err("name_required");
      await pool.query(`select onboard_request($1, $2, $3, $4, $5, $6)`, [email, name, f.role, f.school, f.team, f.note]);
      return { requested: true };
    }),

    // POST /api/requests { role, schoolId, teamCode?, playerId?, note? } — a signed-in person asks for another role
    request: handle(async (req) => {
      const b = req.body || {};
      const f = fields(b);
      const player = b.playerId == null ? null : String(b.playerId);
      if (player && !UUID.test(player)) throw err("player_invalid");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into role_request (person_id, role, school_id, team_code, player_id, note)
           values (app_user_id(), $1, $2, $3, $4, $5) returning id, state`, [f.role, f.school, f.team, player, f.note]);
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id, state: rows[0].state };
      });
    }),

    // POST /api/requests/:id/withdraw
    withdraw: handle(async (req) =>
      runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rowCount } = await client.query(
          `update role_request set state = 'withdrawn' where id = $1 and state = 'pending'`, [req.params.id]);
        return { withdrawn: rowCount };
      })),

    // POST /api/requests/:id/decide { grant: boolean, note?, playerId?, teamCode? }
    decide: handle(async (req) => {
      const b = req.body || {};
      if (typeof b.grant !== "boolean") throw err("grant_required");
      const player = b.playerId == null ? null : String(b.playerId);
      if (player && !UUID.test(player)) throw err("player_invalid");
      const team = clean(b.teamCode, 8);
      if (team && !/^[A-Z0-9]{2,8}$/.test(team)) throw err("team_code_invalid");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(`select * from decide_role_request($1, $2, $3, $4, $5)`,
                                            [req.params.id, b.grant, clean(b.note, 300), player, team]);
        const r = rows[0] ?? { ok: false, reason: "no_result" };
        if (r.ok === false) throw err(r.reason || "refused",
          r.reason === "no_such_request" ? 404 : r.reason === "not_permitted" ? 403 : 422);
        return { id: req.params.id, state: b.grant ? "granted" : "declined", assignmentId: r.assignment_id };
      });
    }),
  };
}

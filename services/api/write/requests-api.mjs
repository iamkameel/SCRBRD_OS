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
 *
 * ENROLMENT is the same machinery pointed the other way — the office opening
 * an account for somebody already in the building, instead of waiting to be
 * asked. See enrol_person() in db/08 for why it answers a request rather than
 * writing the assignment itself.
 */
import { runAsPrincipal, issueLoginCode } from "../auth/auth-db.mjs";
import { SELF_REGISTRABLE_ROLES } from "@scrbrd/policy/roles";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (/** @type {unknown} */ v, /** @type {number} */ max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
// The roles that belong to no school (db/86). Not asked for; assigned.
const PLATFORM_ROLES = Object.freeze(["superadmin", "platformadmin"]);

// A refusal from enrol_person() that is not about authority is not a 403.
// The office is told what cannot be done — this email is another school's,
// this pupil already has an account — rather than that it lacks permission.
/** @type {Record<string, number>} */
const ENROL_STATUS = {
  not_permitted: 403,
  no_such_player: 404,
  player_already_has_an_account: 409,
  email_belongs_to_another_school: 409,
  // db/86: superadmin and platformadmin belong to no school, and an
  // enrolment is always at one. Not a permission problem: nobody may.
  platform_role_needs_no_school: 422,
};

// Ending a role (db/77, role_assignment_end()). Each refusal, its status and
// the sentence the office reads. The words are the screen's: EndRoleButton
// (apps/web/src/views/endrole.jsx) shows `detail` as it comes. None of them
// repeats the reason the office gave.
/** @type {Record<string, [number, string]>} */
export const END_ROLE_REFUSALS = {
  not_signed_in:      [401, "Sign in again to end a role."],
  reason_required:    [422, "Say why this role is ending, in at least ten characters. It goes on the school's record, not to the person."],
  reason_too_long:    [422, "Keep the reason under 2,000 characters."],
  no_such_assignment: [404, "That role is not on the record."],
  not_permitted:      [403, "You cannot end this role. Only somebody who may appoint it at this school can end it — and a parent's role, only somebody who manages guardian links."],
  already_ended:      [409, "This role has already ended."],
  owners_key:         [403, "The owner's key is not ended from a screen."],
  superadmin_only:    [403, "This person holds the owner's key. Only another holder of it may end their roles."],
  last_admin:         [409, "This is your last role that can appoint people here. Ask someone else to end it, so the school is never left without anyone who can."],
  own_dso:            [403, "You cannot end your own safeguarding appointment. The principal or the provincial DSO ends it."],
  dso_blocked:        [409, "This appointment cannot be ended from here. Ask the provincial DSO."],
  support_session:    [409, "This is a support session. End it from the support screen, which closes its record too."],
  last_verified_link: [409, "This is the last verified parent or guardian of a child under eighteen. Link and verify the new guardian first, then end this role."],
  refused:            [409, "The database refused to end this role."],
};

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function requestRoutes({ pool, secret }) {
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      // db/86's constraint is named for its refusal code; say it as the
      // functions do, whichever door reached it.
      if (e.code === "23514" && e.constraint === "platform_role_needs_no_school") return res.status(422).json({ error: e.constraint });
      if (e.code === "23514") return res.status(422).json({ error: "not_requestable", detail: e.message });
      if (e.code === "23505") return res.status(422).json({ error: "already_pending" });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_school" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };
  const fields = (/** @type {any} */ b) => {   // the request body, unvalidated
    const role = String(b.role ?? "").trim();
    if (!/^[a-z]{3,30}$/.test(role)) throw err("role_invalid");
    if (!UUID.test(String(b.schoolId ?? ""))) throw err("school_required");
    const team = clean(b.teamCode, 8);
    if (team && !/^[A-Z0-9]{2,8}$/.test(team)) throw err("team_code_invalid");
    return { role, school: b.schoolId, team, note: clean(b.note, 300) };
  };
  // db/86: superadmin and platformadmin belong to no school, and a request is
  // always at one, so granting one never works (decide_role_request refuses).
  // Refused when it is FILED, not left pending for an answer that cannot
  // come — and, on /api/onboard, before onboard_request() opens an account
  // labelled with a platform role for a stranger. The same code the enrol
  // path's refusal uses (ENROL_STATUS), so the screens say it one way.
  const refusePlatformRole = (/** @type {string} */ role) => {
    if (PLATFORM_ROLES.includes(role)) throw err("platform_role_needs_no_school", 422);
  };

  return {
    // GET /api/schools — id and name, for choosing one.
    schools: handle(async () => ({ rows: (await pool.query(`select * from public_schools()`)).rows })),

    // POST /api/onboard { email, name, role, schoolId, teamCode?, note? } — unauthenticated
    onboard: handle(async (req) => {
      const b = req.body || {};
      const f = fields(b);
      refusePlatformRole(f.role);
      // A stranger asks only for what the sign-up screens offer. onboard_request()
      // labels the new account with this role, so anything else (`principal`,
      // `dso`, …) is refused here, before the database is asked anything.
      if (!SELF_REGISTRABLE_ROLES.includes(f.role)) throw err("role_not_self_registrable", 422);
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
      refusePlatformRole(f.role);
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

    // POST /api/users { email, name, role, schoolId, teamCode?, playerId?, note?, withCode? }
    //
    // The office enrolling somebody already on the roster. With `withCode` the
    // login code is issued in the same breath and returned ONCE — there is no
    // email channel yet, so the office reads it off the screen and hands it
    // over on paper, which is exactly how the existing invite route works.
    //
    // A failure to issue the code does NOT fail the enrolment: the account is
    // real either way, and the office can ask for a code again. Saying the
    // account was not created because the code could not be printed would be
    // a lie about what is in the database.
    enrol: handle(async (req) => {
      const b = req.body || {};
      const f = fields(b);
      const email = String(b.email ?? "").trim();
      const name = String(b.name ?? "").trim();
      if (name.length < 2) throw err("name_required");
      const player = b.playerId == null ? null : String(b.playerId);
      if (player && !UUID.test(player)) throw err("player_invalid");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `select * from enrol_person($1, $2, $3, $4, $5, $6, $7)`,
          [email, name, f.role, f.school, f.team, player, f.note]);
        const r = rows[0] ?? { ok: false, reason: "no_result" };
        if (r.ok === false) throw err(r.reason || "refused", ENROL_STATUS[r.reason] ?? 422);
        const out = { userId: r.user_id, assignmentId: r.assignment_id };
        if (b.withCode !== true) return out;
        try {
          const { code, expiresAt } = await issueLoginCode(client, secret, { email });
          return { ...out, code, expiresAt };
        } catch (/** @type {any} */ e) {
          return { ...out, code: null, codeError: e.message || "code_not_issued" };
        }
      });
    }),

    // POST /api/assignments/:id/end { reason }
    //
    // Ending one role: role_assignment_end() (db/77) decides everything —
    // who may (whoever may grant it there), who may not (the owner's key, a
    // superadmin's roles from below, your own last key, your own DSO
    // appointment, a minor's last verified guardian) — and answers with a
    // code, which this turns into a status and the office's words. The row
    // is withdrawn, never deleted; the person is told, without the reason.
    endAssignment: async (req, res) => {
      const id = String(req.params?.id ?? "");
      if (!UUID.test(id)) return res.status(404).json({ error: "no_such_assignment", detail: END_ROLE_REFUSALS.no_such_assignment[1] });
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
      try {
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) =>
          (await client.query(`select * from role_assignment_end($1, $2)`, [id, reason])).rows[0]);
        if (r?.ok) return res.json({ id, ended: true });
        const code = r?.reason || "refused";
        const [status, words] = END_ROLE_REFUSALS[code] ?? END_ROLE_REFUSALS.refused;
        return res.status(status).json({ error: code, detail: words });
      } catch (/** @type {any} */ e) {
        const status = e.code === "42501" ? 403 : (e.status || 500);
        return res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error"),
                                          ...(status === 403 ? { detail: END_ROLE_REFUSALS.not_permitted[1] } : {}) });
      }
    },

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

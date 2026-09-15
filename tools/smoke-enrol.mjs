#!/usr/bin/env node
/**
 * The office opening an account for somebody already in the building.
 *
 * Settings showed the pilot the shape of the problem plainly: "On a roster,
 * no account — 16 of 18. These people appear in Squad and Profiles and hold a
 * passport, but cannot sign in." Every one of those boys already had a player
 * row. What none of them had was an app_user, and nothing in the product made
 * one. `+ Add User` pushed an object into React state and forgot it on reload.
 *
 * onboard_request() is the PULL path and it works — a stranger asks, the
 * school answers. It is no use here. A school arriving with a roster cannot
 * wait for sixteen children to find the onboarding screen.
 *
 * What this walk proves:
 *
 *   1. the office enrols a boy who is already on the roster, and the account
 *      is LINKED to his player row — that link is what lets him read himself
 *   2. the capability decides, not the role name, and not seniority
 *   3. a refusal leaves NOTHING behind: no half-made account, no unanswered
 *      request. This is the guardian_link_establish() lesson — a plpgsql
 *      RETURN is not a rollback — and the reason enrolment writes inside a
 *      subtransaction
 *   4. the login code is issued once and is the only moment it is readable
 *   5. the enrolled boy can actually sign in with it and read his own record
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-enrol.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8871;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

// U13A boys the seed leaves without an account — the population this exists for.
const MAHLANGU = "aaaaaaaa-0000-0000-0000-000000000011";
const SITHOLE  = "aaaaaaaa-0000-0000-0000-000000000012";
const KHUMALO  = "aaaaaaaa-0000-0000-0000-000000000013";
const PILLAY   = "aaaaaaaa-0000-0000-0000-000000000005";  // already has an account
const ADULT    = "aaaaaaaa-0000-0000-0000-000000000003";  // S Naidoo, past eighteen

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-enrol-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-enrol" } })).body?.token;
const enrol = (token, body) => api("/api/users", { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const accounts = async (email) =>
  (await q(`select count(*)::int n from app_user where lower(email) = lower($1)`, [email]))[0].n;
const openRequests = async (email) =>
  (await q(`select count(*)::int n from role_request r join app_user u on u.id = r.person_id
             where lower(u.email) = lower($1)`, [email]))[0].n;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const registrar = await login("registrar@example.invalid");   // schooladmin, Hilton
  const coach     = await login("coach@example.invalid");       // 1XI coach
  const parent    = await login("parent@example.invalid");      // guardian
  const regWes    = await login("registrar.wes@example.invalid");

  group("A boy on the roster, and no way to sign in");
  const before = await q(
    `select count(*)::int n from player p
      where p.school_id = $1
        and not exists (select 1 from app_user u where u.player_id = p.id)`, [HIL]);
  ok("the seed really does hold players with no account — the walk is not proving a vacuum",
     before[0].n > 0);

  group("The capability decides who may enrol");
  const body = (email, name, player, team) => ({
    email, name, role: "player", schoolId: HIL, teamCode: team, playerId: player });
  ok("a coach may not open an account — user.role.assign is not a coaching capability",
     (await enrol(coach, body("a@example.invalid", "A One", MAHLANGU, "U13A"))).status === 403);
  ok("nor may a guardian",
     (await enrol(parent, body("b@example.invalid", "B Two", MAHLANGU, "U13A"))).status === 403);
  ok("nor may another school's office, for a boy who is not theirs",
     [403, 404, 422].includes((await enrol(regWes, body("c@example.invalid", "C Three", MAHLANGU, "U13A"))).status));
  ok("an unauthenticated request is refused rather than silently ignored",
     [401, 403].includes((await enrol(undefined, body("d@example.invalid", "D Four", MAHLANGU, "U13A"))).status));
  ok("...and not one of those attempts left an account behind",
     (await accounts("a@example.invalid")) === 0 && (await accounts("b@example.invalid")) === 0
     && (await accounts("c@example.invalid")) === 0 && (await accounts("d@example.invalid")) === 0);

  group("The office can, and the account is linked to the boy");
  const made = await enrol(registrar, body("l.mahlangu@example.invalid", "L Mahlangu", MAHLANGU, "U13A"));
  ok("the registrar enrols him", made.status === 200 && !!made.body?.userId);
  const row = (await q(`select player_id, school_id, role, active from app_user where id = $1`, [made.body.userId]))[0];
  ok("...and the account NAMES HIS PLAYER ROW — the link is the whole point",
     row?.player_id === MAHLANGU);
  ok("...at his own school", row?.school_id === HIL);
  ok("...and is live", row?.active === true);

  const asg = await q(`select role, team_code from role_assignment where person_id = $1 order by role`, [made.body.userId]);
  ok("he holds the team role, scoped to his side",
     asg.some((a) => a.role === "player" && a.team_code === "U13A"));
  ok("...and the self-access pair that lets him read his own record, which a team role alone does not",
     asg.some((a) => a.role === "selfaccess"));

  const req = await q(`select state, decided_by from role_request r where r.person_id = $1`, [made.body.userId]);
  ok("the enrolment is on the record as a request somebody answered, not a silent insert",
     req.length === 1 && req[0].state === "granted" && req[0].decided_by != null);

  group("A refusal leaves nothing behind");
  // Each of these is refused at a different depth: the first two before any
  // write, the third INSIDE decide_role_request() — after the account row has
  // already been written. Only the subtransaction makes the third clean, and
  // it is the one that would rot quietly.
  ok("a pupil who already has an account is refused",
     (await enrol(registrar, body("second@example.invalid", "Second Claim", PILLAY, "1XI"))).body?.error
       === "player_already_has_an_account");
  ok("...as a conflict, not as a permission problem",
     (await enrol(registrar, body("second2@example.invalid", "Second Claim", PILLAY, "1XI"))).status === 409);
  ok("a coach enrolled with no side is refused — a coach is a coach OF something",
     (await enrol(registrar, { email: "nc@example.invalid", name: "N Coach", role: "coach", schoolId: HIL }))
       .body?.error === "team_required");
  ok("...and that refusal, which happens AFTER the account row is written, still leaves none",
     (await accounts("nc@example.invalid")) === 0 && (await openRequests("nc@example.invalid")) === 0);
  ok("a guardian for a player who has turned eighteen is refused",
     (await enrol(registrar, { email: "adult@example.invalid", name: "A Naidoo", role: "guardian",
                               schoolId: HIL, playerId: ADULT })).body?.error === "player_is_an_adult");
  ok("...leaving no account either", (await accounts("adult@example.invalid")) === 0);
  ok("an email already belonging to another school is refused rather than quietly moved",
     (await enrol(registrar, { email: "coach.wes@example.invalid", name: "Wes Coach", role: "coach",
                               schoolId: HIL, teamCode: "U13A" })).body?.error === "email_belongs_to_another_school");
  ok("a malformed email never reaches the database",
     (await enrol(registrar, body("not-an-email", "N E", SITHOLE, "U13A"))).body?.error === "email_invalid");

  group("The code is issued once, and it works");
  const withCode = await enrol(registrar, { ...body("j.sithole@example.invalid", "J Sithole", SITHOLE, "U13A"),
                                            withCode: true });
  ok("the office asks for a code and gets one", withCode.status === 200 && typeof withCode.body?.code === "string");
  ok("...with an expiry, so a code left on a desk does not work forever", !!withCode.body?.expiresAt);
  const stored = await q(`select code_hash from login_code where user_id = $1`, [withCode.body.userId]);
  ok("...and what is STORED is not the code — this is the only moment it is readable",
     stored.length === 1 && stored[0].code_hash !== withCode.body.code);

  const redeemed = await api("/api/auth/redeem", { method: "POST",
    body: { email: "j.sithole@example.invalid", code: withCode.body.code, deviceId: "his-phone" } });
  ok("the boy signs in with it", redeemed.status === 200 && !!redeemed.body?.token);
  const self = await api(`/api/read/players?playerId=${SITHOLE}`, { token: redeemed.body.token });
  ok("...and reads his own record, which is what the account was for",
     (self.body?.rows ?? []).some((p) => p.id === SITHOLE));
  const spent = await api("/api/auth/redeem", { method: "POST",
    body: { email: "j.sithole@example.invalid", code: withCode.body.code, deviceId: "another-phone" } });
  ok("...and the code cannot be spent twice", spent.status !== 200);

  group("Enrolling without a code still makes a real account");
  const noCode = await enrol(registrar, body("b.khumalo@example.invalid", "B Khumalo", KHUMALO, "U13A"));
  ok("no code is returned when none was asked for", noCode.status === 200 && noCode.body?.code === undefined);
  ok("...but the account is there", (await accounts("b.khumalo@example.invalid")) === 1);
  const later = await api("/api/auth/invite", { method: "POST", token: registrar,
                                                body: { email: "b.khumalo@example.invalid" } });
  ok("...and a code can be issued for it afterwards, through the route that already existed",
     later.status === 200 && typeof later.body?.code === "string");

  group("The roster gap actually closes");
  const after = await q(
    `select count(*)::int n from player p
      where p.school_id = $1
        and not exists (select 1 from app_user u where u.player_id = p.id)`, [HIL]);
  ok("three enrolments, three fewer boys without an account", after[0].n === before[0].n - 3);

} catch (e) {
  fail++; console.log("\n  ✗ the walk threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`ENROLMENT SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

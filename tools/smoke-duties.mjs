#!/usr/bin/env node
/**
 * A duty, the authority it rests on, and the pause (SCRBRD-034, db/34–35).
 *
 * The appointment on a fixture (match_official) and the permission to act on
 * it (role_assignment) were two records nothing joined: standing a scorer down
 * left their scoring authority where it was, and there was no way to pause it
 * short of ending it for good. This walk drives the join through the API:
 *
 *   1. the school office links a duty — and nobody else can
 *   2. the link is the whole of the scorer's authority, at that fixture
 *   3. suspending needs a reason, is the office's, and takes it all away
 *   4. the scorer learns THAT they are suspended, and not why
 *   5. lifting needs a reason, is the office's, and gives it back
 *   6. re-saving the sheet with the scorer on it keeps the link
 *   7. a sheet without them withdraws the duty, and that revokes the authority
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-duties.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8854;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c, detail = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, detail); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-duties-secret" },
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
  method: "POST", body: { email, deviceId: "device-duties" } })).body?.token;
const rows = async (resource, token, query = "") =>
  (await api(`/api/read/${resource}${query}`, { token })).body?.rows ?? [];
const duty = (id, verb, token, body) => api(`/api/duties/${id}/${verb}`, { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const head      = await login("sarah@example.invalid");       // directorofsport: officiating.assign AND user.role.assign
  const registrar = await login("registrar@example.invalid");   // schooladmin: the office
  const principal = await login("principal@example.invalid");   // user.role.assign, may not appoint a scorer
  const coach     = await login("coach@example.invalid");

  // A scorer with an account and nothing else: no assignment anywhere, so
  // every read they make is decided by the one this walk links.
  const stamp = Date.now();
  const scorerId = (await q(
    `insert into app_user (school_id, email, name, role) values ($1, $2, 'W Walker', 'scorer') returning id`,
    [HIL, `duty-walk-${stamp}@example.invalid`]))[0].id;
  const scorer = await login(`duty-walk-${stamp}@example.invalid`);
  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Duty Walk XI', now() + interval '4 days','T20',20,'scheduled') returning id`,
    [HIL]))[0].id;
  const seesFixture = async () => (await rows("matches", scorer)).some((r) => r.id === m);

  const first = await api(`/api/matches/${m}/officials`, { method: "POST", token: head, body: { officials: [
    { duty: "scorer", name: "W Walker", personId: scorerId },
    { duty: "umpire", name: "A Stander" },
  ] } });
  ok("the director of sport appoints a scorer with an account", first.status === 200, JSON.stringify(first.body));
  const sheet = await rows("officials", registrar, `?matchId=${m}`);
  const D = sheet.find((r) => r.duty === "scorer");
  const U = sheet.find((r) => r.duty === "umpire");
  ok("the office reads the duty by id, unlinked", D?.id && D.linked === false && D.suspended === false, JSON.stringify(D));

  group("1–2. Linking is the office's, and the link is the whole of the authority");
  ok("the appointment alone grants the scorer nothing", !(await seesFixture()));
  let r = await duty(D.id, "link", coach);
  ok("a coach cannot link a duty: 403", r.status === 403 && r.body?.error === "not_permitted", JSON.stringify(r.body));
  r = await duty(D.id, "link", principal);
  ok("nor a principal, who may not appoint a scorer: 403", r.status === 403, JSON.stringify(r.body));
  r = await duty(D.id, "link", scorer);
  ok("nor the scorer themselves: 403", r.status === 403, JSON.stringify(r.body));
  r = await duty(U.id, "link", registrar);
  ok("a duty naming nobody with an account has nothing to link: 422", r.status === 422 && r.body?.error === "no_account", JSON.stringify(r.body));
  r = await duty(D.id, "link", registrar);
  ok("the office links it", r.status === 200 && r.body?.assignmentId, JSON.stringify(r.body));
  const A = r.body?.assignmentId;
  const [row] = await q(`select person_id, role, school_id, fixture_id, team_code, active, created_by
                           from role_assignment where id = $1`, [A]);
  ok("...making an assignment of exactly the duty's shape",
     row?.person_id === scorerId && row.role === "scorer" && row.school_id === HIL
       && row.fixture_id === m && row.team_code === null && row.active === true, JSON.stringify(row));
  ok("...granted in the office's name", !!row?.created_by);
  ok("linking twice is refused, not repeated: 409", (await duty(D.id, "link", registrar)).status === 409);
  ok("now the scorer reads their fixture", await seesFixture());
  ok("the sheet says the duty is linked",
     (await rows("officials", registrar, `?matchId=${m}`)).find((x) => x.id === D.id)?.linked === true);

  group("3–4. Suspending: a reason, the office, and nothing left");
  r = await duty(D.id, "suspend", registrar, {});
  ok("no reason, no suspension: 400", r.status === 400 && r.body?.error === "reason_required", JSON.stringify(r.body));
  r = await duty(D.id, "suspend", registrar, { reason: "   " });
  ok("a blank reason is no reason: 400", r.status === 400 && r.body?.error === "reason_required");
  r = await duty(D.id, "suspend", coach, { reason: "Not his call" });
  ok("a coach cannot suspend: 403", r.status === 403, JSON.stringify(r.body));
  r = await duty(D.id, "suspend", registrar, { reason: "Parent complaint about the scorebook" });
  ok("the office suspends, with a reason", r.status === 200, JSON.stringify(r.body));
  ok("...and the scorer no longer reads the fixture", !(await seesFixture()));
  const mine = (await rows("assignments", scorer)).find((x) => x.id === A);
  ok("the scorer is told the assignment is suspended — still active, not revoked",
     mine?.suspended === true && mine?.active === true, JSON.stringify(mine));
  ok("...and is not told why", (await rows("duty_suspensions", scorer)).length === 0);
  const rec = (await rows("duty_suspensions", registrar, `?dutyId=${D.id}`))[0];
  ok("the office's record says who, when and why",
     rec?.reason === "Parent complaint about the scorebook" && rec?.suspended_by_name === "B Naicker"
       && rec?.suspended_at && rec?.lifted_at === null, JSON.stringify(rec));
  ok("a coach reads none of it", (await rows("duty_suspensions", coach)).length === 0);
  const seen = (await rows("officials", coach, `?matchId=${m}`)).find((x) => x.id === D.id);
  ok("anyone who reads the sheet sees THAT the duty is suspended", seen?.suspended === true, JSON.stringify(seen));

  group("5. Lifting: a reason, whoever could have appointed them, and it all comes back");
  r = await duty(D.id, "lift", principal, { reason: "Restoring" });
  ok("a principal may pause a scorer but not restore one: 403", r.status === 403, JSON.stringify(r.body));
  r = await duty(D.id, "lift", scorer, { reason: "I am fine" });
  ok("the scorer cannot lift their own suspension: 403", r.status === 403, JSON.stringify(r.body));
  r = await duty(D.id, "lift", registrar, {});
  ok("no reason, no lift: 400", r.status === 400 && r.body?.error === "reason_required");
  r = await duty(D.id, "lift", registrar, { reason: "Scorebook checked, no fault" });
  ok("the office lifts it", r.status === 200, JSON.stringify(r.body));
  ok("...and the scorer reads the fixture again", await seesFixture());
  const closed = (await rows("duty_suspensions", registrar, `?dutyId=${D.id}`))[0];
  ok("the record now carries the lift beside the suspension",
     closed?.lift_reason === "Scorebook checked, no fault" && closed?.lifted_by_name === "B Naicker"
       && closed?.reason === "Parent complaint about the scorebook", JSON.stringify(closed));
  ok("the same assignment, never deactivated",
     (await q(`select active, revoked_at from role_assignment where id = $1`, [A]))[0]?.active === true);
  ok("lifting again is refused: 409", (await duty(D.id, "lift", registrar, { reason: "again" })).status === 409);

  group("6–7. The sheet: kept when the scorer is on it, revoked when they are not");
  r = await api(`/api/matches/${m}/officials`, { method: "POST", token: head, body: { officials: [
    { duty: "scorer", name: "W Walker", personId: scorerId },
    { duty: "umpire", name: "A Stander" },
    { duty: "umpire", name: "B Second" },
  ] } });
  ok("adding a second umpire re-saves the sheet", r.status === 200 && r.body?.kept === 1, JSON.stringify(r.body));
  const kept = (await rows("officials", registrar, `?matchId=${m}`)).find((x) => x.duty === "scorer");
  ok("...and the linked scorer's duty is the same row, still linked", kept?.id === D.id && kept?.linked === true, JSON.stringify(kept));
  ok("...so the scorer keeps their authority", await seesFixture());
  ok("the umpire was replaced as before", (await rows("officials", registrar, `?matchId=${m}`)).filter((x) => x.duty === "umpire").length === 2);

  r = await api(`/api/matches/${m}/officials`, { method: "POST", token: head, body: { officials: [
    { duty: "umpire", name: "A Stander" },
  ] } });
  ok("a sheet without the scorer is accepted", r.status === 200, JSON.stringify(r.body));
  const [gone] = await q(`select active, revoked_by, revoked_at from role_assignment where id = $1`, [A]);
  ok("withdrawing the duty revoked its assignment, in the director's name",
     gone?.active === false && gone?.revoked_at && gone?.revoked_by, JSON.stringify(gone));
  ok("...and the scorer no longer reads the fixture", !(await seesFixture()));
  ok("a withdrawn duty cannot be suspended: 409",
     (await duty(D.id, "suspend", registrar, { reason: "too late" })).status === 409);

  group("Nothing here answers for a duty that is not there");
  ok("an unknown duty: 404", (await duty("00000000-0000-0000-0000-0000000000ff", "link", registrar)).status === 404);
  ok("a malformed id: 400", (await duty("not-a-uuid", "link", registrar)).status === 400);
  ok("an unauthenticated request: 401/403",
     [401, 403].includes((await duty(D.id, "suspend", undefined, { reason: "x" })).status));
} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`DUTIES SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

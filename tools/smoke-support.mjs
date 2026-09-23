#!/usr/bin/env node
/**
 * Support access: an hour, at one school, on the record (SCRBRD-012).
 *
 * A platform administrator holds no school's roles and reads nothing of a
 * school. This walk opens the one door there is — support_access_begin() —
 * over HTTP, and proves what the audit asked for: the session is one role
 * at one school, it stops by itself, the school can stop it sooner, and
 * every read made under it is stamped in the school's own log.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-support.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8836;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const NIL = "00000000-0000-0000-0000-000000000000";
const REASON = "ticket 4411: roster import failing at Hilton";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-support-secret" },
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
  method: "POST", body: { email, deviceId: "device-support" } })).body?.token;
const read  = async (r, token) => (await api(`/api/read/${r}`, { token })).body?.rows ?? [];
const begin = (token, body) => api("/api/support/access", { method: "POST", token, body });
const end   = (token, id) => api(`/api/support/access/${id}/end`, { method: "POST", token });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const plat  = await login("platform@example.invalid");   // platformadmin, no school
  const sarah = await login("sarah@example.invalid");      // director of sport at Hilton
  const coach = await login("coach@example.invalid");
  const [{ id: PLAT_ID }] = await q(`select id from app_user where email = 'platform@example.invalid'`);

  group("A platform administrator stops at the schoolhouse door");
  ok("...reads no roster", (await read("players", plat)).length === 0);
  ok("...and no injuries", (await read("injuries", plat)).length === 0);

  group("Beginning support access is refused for the right reasons");
  const refusals = [
    ["somebody without the capability",  sarah, { schoolId: HIL, role: "directorofsport", reason: REASON }, 403, "not_permitted"],
    ["a platform role at a school",      plat,  { schoolId: HIL, role: "platformadmin",   reason: REASON }, 422, "role_not_supportable"],
    ["the owner's key",                  plat,  { schoolId: HIL, role: "superadmin",      reason: REASON }, 422, "role_not_supportable"],
    ["a parent's role",                  plat,  { schoolId: HIL, role: "guardian",        reason: REASON }, 422, "role_needs_subject"],
    ["a role that does not exist",       plat,  { schoolId: HIL, role: "wizard",          reason: REASON }, 422, "role_unknown"],
    ["no reason worth reading",          plat,  { schoolId: HIL, role: "directorofsport", reason: "fix" },  422, "reason_required"],
    ["zero minutes",                     plat,  { schoolId: HIL, role: "directorofsport", reason: REASON, minutes: 0 },   422, "minutes_out_of_range"],
    ["more than four hours",             plat,  { schoolId: HIL, role: "directorofsport", reason: REASON, minutes: 241 }, 422, "minutes_out_of_range"],
    ["a school that does not exist",     plat,  { schoolId: NIL, role: "directorofsport", reason: REASON }, 404, "school_unknown"],
    ["a coach with no side named",       plat,  { schoolId: HIL, role: "coach",           reason: REASON }, 422, "refused"],
  ];
  for (const [what, token, body, status, error] of refusals) {
    const r = await begin(token, body);
    ok(`${what} is refused (${status} ${error})`, r.status === status && r.body?.error === error);
  }
  ok("...and none of those left a session behind",
     (await q(`select count(*)::int n from support_access`))[0].n === 0);

  group("The door opens: one role, one school, an hour");
  const opened = await begin(plat, { schoolId: HIL, role: "directorofsport", reason: REASON });
  ok("a session begins", opened.status === 200 && opened.body?.id);
  const S = opened.body?.id;
  const minutes = (new Date(opened.body?.expiresAt) - Date.now()) / 60000;
  ok("...for sixty minutes by default", minutes > 59 && minutes <= 60);
  const roster = await read("players", plat);
  ok("the roster is readable now", roster.length > 0);
  ok("...and only Hilton's", roster.every((p) => p.school_id === HIL));
  const injuries = await read("injuries", plat);
  const rosterIds = new Set(roster.map((p) => p.id));
  ok("a director's overview of injuries too — every one a Hilton boy's",
     injuries.length > 0 && injuries.every((i) => rosterIds.has(i.player_id)));
  ok("...but not the physio's notes — the role's tier, not the platform's", injuries.every((i) => i.notes == null));
  await read("matches", plat);
  const twice = await begin(plat, { schoolId: HIL, role: "directorofsport", reason: REASON });
  ok("the same session cannot be issued twice", twice.status === 422 && twice.body?.error === "already_live");

  group("Every read under it is on the school's record, stamped with the session");
  const log = await read("access_log", sarah);
  const mine = log.filter((l) => l.person_id === PLAT_ID);
  ok("the school's auditor sees the support person's reads", mine.length >= 3);
  ok("...each stamped with the session", mine.every((l) => l.support_access_id === S));
  ok("...including the fixture list, which is nobody's disclosure when a coach reads it",
     mine.some((l) => l.resource === "matches"));
  ok("...and the injuries, filed under Hilton though the rows name no school",
     mine.some((l) => l.resource === "injuries" && l.school_id === HIL));
  ok("...and marked platform-wide as well: the reader's key answers to no school, whichever door they came through",
     mine.every((l) => l.platform_wide === true));
  const asPlat = await read("support_access", plat);
  ok("the support person sees their own session", asPlat.length === 1 && asPlat[0].mine === true && asPlat[0].live === true);
  const asSarah = await read("support_access", sarah);
  ok("the school's auditor sees it too, with the reason", asSarah.length === 1 && asSarah[0].reason === REASON);
  ok("a coach does not", (await read("support_access", coach)).length === 0);

  group("The school ends it");
  const byCoach = await end(coach, S);
  ok("a coach cannot", byCoach.status === 403);
  const bySchool = await end(sarah, S);
  ok("the school's office can", bySchool.status === 200);
  ok("...and the door is shut", (await read("players", plat)).length === 0);
  const again = await end(sarah, S);
  ok("ending it twice is safe", again.status === 200 && again.body?.note === "already_ended");
  const closed = (await read("support_access", sarah))[0];
  ok("the record says when it ended and that it is no longer live", closed?.ended_at && closed.live === false);
  ok("a session that does not exist is a 404", (await end(sarah, NIL)).status === 404);

  group("Expiry is live: no job, no window");
  const second = await begin(plat, { schoolId: HIL, role: "directorofsport", reason: "ticket 4412: the second look at Hilton" });
  ok("a second session begins once the first has ended", second.status === 200);
  ok("...and reads", (await read("players", plat)).length > 0);
  const liveAt = async () => ((await api("/api/session", { token: plat })).body?.assignments ?? [])
    .filter((a) => a.school === HIL && a.role === "directorofsport");
  const shown = await liveAt();
  ok("the workspace shows the session, with when it stops (SCRBRD-034)",
     shown.length === 1 && Math.abs(new Date(shown[0].expiresAt) - new Date(second.body.expiresAt)) < 1000);
  await q(`update role_assignment a set expires_at = now() - interval '1 second'
             from support_access s where s.id = $1 and a.id = s.assignment_id`, [second.body.id]);
  ok("past its hour it reads nothing — app_can() evaluated the clock on this very statement",
     (await read("players", plat)).length === 0);
  ok("...and reports itself as no longer live",
     (await read("support_access", plat)).find((s) => s.id === second.body.id)?.live === false);
  ok("...and the workspace stops showing it — sessionProfile reads the hour hand too (SCRBRD-034)",
     (await liveAt()).length === 0);

  group("An hour hand carries a reason, however it is written (SCRBRD-034, db/30)");
  // role_assignment_write lets the school's office INSERT an assignment, and
  // used to let it set expires_at with no reason and no support record. The
  // deferred check refuses it at COMMIT — so the whole statement fails.
  const [{ id: WATCHER }] = await q(`select id from app_user where email = 'watcher@example.invalid'`);
  const [{ id: SARAH_ID }] = await q(`select id from app_user where email = 'sarah@example.invalid'`);
  const asSarahDirect = async (sql, params) => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role scrbrd_app");
      await c.query("select set_config('app.user_id', $1, true)", [SARAH_ID]);
      await c.query(sql, params);
      await c.query("commit");
      return null;
    } catch (e) { await c.query("rollback").catch(() => {}); return e; } finally { c.release(); }
  };
  const direct = await asSarahDirect(
    `insert into role_assignment (person_id, role, school_id, expires_at) values ($1, 'analyst', $2, now() + interval '1 hour')`,
    [WATCHER, HIL]);
  ok("a time-boxed grant with no support session is refused at commit",
     direct?.code === "23514" && /no support session/.test(direct?.message ?? ""));
  ok("...and left nothing behind",
     (await q(`select count(*)::int n from role_assignment where person_id = $1 and expires_at is not null`, [WATCHER]))[0].n === 0);

  group("Nothing else moved");
  ok("an ordinary appointment, with no hour hand, is untouched", (await read("players", sarah)).length > 0);
} catch (e) {
  ok(`the support walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nSUPPORT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

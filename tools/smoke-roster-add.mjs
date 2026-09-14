#!/usr/bin/env node
/**
 * Two forms that used to close their own modal and throw the form away:
 * adding a boy to the roster one at a time, and putting a session on the
 * training calendar. Both had a table and a policy already; neither had a
 * route. This walk is the route.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-roster-add.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
const PORT = 8874, BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);
const server = spawn(process.execPath, ["services/api/server.mjs"], { env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-roster-add" }, stdio: ["ignore", "pipe", "pipe"] });
const serverErr = []; server.stderr.on("data", (d) => serverErr.push(d.toString()));
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-roster-add" } })).body?.token;
const rows = async (path, tok) => (await api(path, { token: tok })).body?.rows ?? [];
const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) { try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const head = await login("sarah@example.invalid");          // directorofsport, Hilton
  const coach = await login("coach@example.invalid");         // coach, Hilton 1XI
  const wesHead = await login("registrar.wes@example.invalid"); // schooladmin, Westville
  const watcher = await login("watcher@example.invalid");

  group("A boy joins the roster, once — the office's job, not the coach's");
  {
    const add = (tok, body) => api("/api/players", { method: "POST", token: tok, body });
    const r = await add(head, { schoolId: HIL, fullName: "Themba Nkosi", teamCode: "U15A", playingRole: "bowler", battingStyle: "right-hand", born: "2011-03-14" });
    ok("the director of sport adds him", r.status === 200 && r.body?.id);
    const boyId = r.body?.id;
    ok("...he is really in the database, at the right school", (await q(`select school_id, team_code, playing_role from player where id = $1`, [boyId]))[0]?.school_id === HIL);
    ok("...and the roster read carries him", (await rows("/api/read/players", head)).some((p) => p.id === boyId));

    ok("a coach cannot — the roster is not his to write", [403, 401].includes((await add(coach, { schoolId: HIL, fullName: "Second Boy", teamCode: "U15A" })).status));
    ok("a spectator cannot", [403, 401].includes((await add(watcher, { schoolId: HIL, fullName: "Third Boy", teamCode: "U15A" })).status));
    ok("Westville's admin cannot add him at Hilton", [403, 401].includes((await add(wesHead, { schoolId: HIL, fullName: "Fourth Boy", teamCode: "U15A" })).status));

    const dupe = await add(head, { schoolId: HIL, fullName: "themba nkosi", teamCode: "U16A" });
    ok("the same name at the same school is refused, not silently doubled", dupe.status === 422 && dupe.body?.error === "already_on_the_roster");
    ok("...and there is still only one of him", Number((await q(`select count(*)::int c from player where school_id = $1 and lower(full_name) = 'themba nkosi'`, [HIL]))[0].c) === 1);

    ok("a name too short is refused", (await add(head, { schoolId: HIL, fullName: "T", teamCode: "U15A" })).status === 400);
    ok("an unknown playing role is refused", (await add(head, { schoolId: HIL, fullName: "Fifth Boy", teamCode: "U15A", playingRole: "captain" })).status === 400);
    ok("a malformed team code is refused", (await add(head, { schoolId: HIL, fullName: "Sixth Boy", teamCode: "u15a!" })).status === 400);
    ok("no school named is refused", (await add(head, { fullName: "Seventh Boy" })).status === 400);
  }

  group("A session goes on the calendar, under the same authority as kit and drills");
  {
    const schedule = (tok, body) => api("/api/training", { method: "POST", token: tok, body });
    const r = await schedule(coach, { schoolId: HIL, teamCode: "1XI", title: "Pre-season fitness block", sessionType: "fitness",
      startsAt: "2026-11-02T15:30:00.000Z", durationMin: 75, venue: "Main Field", notes: "Bleep test, then throw-downs" });
    ok("the coach schedules one for his own side", r.status === 200 && r.body?.id);
    const sessionId = r.body?.id;
    ok("...it is really on the calendar, with the school stamped by the policy, not the caller", (await q(`select school_id, team_code, session_type from training_session where id = $1`, [sessionId]))[0]?.school_id === HIL);
    ok("...and the training read carries it", (await rows("/api/read/training", coach)).some((s) => s.id === sessionId));

    ok("a spectator cannot schedule one", [403, 401].includes((await schedule(watcher, { schoolId: HIL, teamCode: "1XI", title: "Nope", sessionType: "fitness", startsAt: "2026-11-03T10:00:00.000Z", durationMin: 60 })).status));
    ok("Westville's admin cannot schedule one at Hilton", [403, 401].includes((await schedule(wesHead, { schoolId: HIL, teamCode: "1XI", title: "Nope", sessionType: "fitness", startsAt: "2026-11-03T10:00:00.000Z", durationMin: 60 })).status));

    ok("a title too short is refused", (await schedule(coach, { schoolId: HIL, teamCode: "1XI", title: "Hi", sessionType: "fitness", startsAt: "2026-11-04T10:00:00.000Z", durationMin: 60 })).status === 400);
    ok("an unknown session type is refused", (await schedule(coach, { schoolId: HIL, teamCode: "1XI", title: "Something real", sessionType: "yoga", startsAt: "2026-11-04T10:00:00.000Z", durationMin: 60 })).status === 400);
    ok("a garbage date is refused", (await schedule(coach, { schoolId: HIL, teamCode: "1XI", title: "Something real", sessionType: "fitness", startsAt: "not a date", durationMin: 60 })).status === 400);
    ok("a duration outside the constraint's range is refused", (await schedule(coach, { schoolId: HIL, teamCode: "1XI", title: "Something real", sessionType: "fitness", startsAt: "2026-11-04T10:00:00.000Z", durationMin: 900 })).status === 400);
    ok("no team named is refused", (await schedule(coach, { schoolId: HIL, title: "Something real", sessionType: "fitness", startsAt: "2026-11-04T10:00:00.000Z", durationMin: 60 })).status === 400);
  }

  ok("the server logged no errors", serverErr.join("").trim() === "");
  if (serverErr.length) console.log(serverErr.join("").slice(0, 600));
} catch (e) {
  fail++;
  console.log("  ✗ threw:", e.message);
} finally {
  server.kill();
  await pool.end();
}
console.log(`\n${"─".repeat(52)}\nROSTER-ADD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

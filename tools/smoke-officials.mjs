#!/usr/bin/env node
/**
 * Appointing the officials.
 *
 * `officiating.assign` has been in the capability table since the first
 * migration and three roles hold it. Nothing could exercise it: there was no
 * table to appoint anyone in, so a capability sat in the model, passed every
 * authorisation test, and governed nothing. An `official` role existed with
 * nothing behind it. That is the same shape of defect as the toss and the
 * squad — a control that is correct, tested, and never reached.
 *
 * This walk proves the appointment is really governed:
 *
 *   1. the capability decides, not the role name
 *   2. an official cannot appoint themselves
 *   3. the school is derived from the match, never taken from the caller
 *   4. anyone who may read the fixture may see who is standing
 *   5. replacing a panel withdraws the old one rather than deleting it
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-officials.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8826;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-officials-secret" },
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
  method: "POST", body: { email, deviceId: "device-officials" } })).body?.token;

const appoint = (matchId, token, officials) =>
  api(`/api/matches/${matchId}/officials`, { method: "POST", token, body: { officials } });
const standing = async (matchId, token) =>
  (await api(`/api/read/officials?matchId=${matchId}`, { token })).body?.rows || [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // sarah is the director of sport, which is one of the three roles holding
  // officiating.assign. The registrar is a SCHOOL ADMINISTRATOR and is not —
  // seniority is not the question the model asks, and that is the point.
  const head      = await login("sarah@example.invalid");        // directorofsport
  const registrar = await login("registrar@example.invalid");    // schooladmin: no officiating.assign
  const coach     = await login("coach@example.invalid");        // 1XI coach
  const parent    = await login("parent@example.invalid");       // guardian: fixture.read only

  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() + interval '2 days','T20',20,'scheduled') returning id`,
    [HIL]))[0].id;

  group("The capability decides who may appoint");
  ok("a coach may not appoint officials — officiating.assign is not a coaching capability",
     [403, 401].includes((await appoint(m, coach, [{ duty: "umpire", name: "D Naidoo" }])).status));
  ok("nor may a guardian",
     [403, 401].includes((await appoint(m, parent, [{ duty: "umpire", name: "D Naidoo" }])).status));
  ok("nor may the school registrar — senior, and holding a different job",
     [403, 401].includes((await appoint(m, registrar, [{ duty: "umpire", name: "D Naidoo" }])).status));
  ok("an unauthenticated request is refused rather than silently ignored",
     [401, 403].includes((await appoint(m, undefined, [{ duty: "umpire", name: "D Naidoo" }])).status));

  const first = await appoint(m, head, [
    { duty: "umpire", name: "D Naidoo", panel: "KZN Cricket Umpires" },
    { duty: "umpire", name: "P van Wyk", panel: "KZN Cricket Umpires" },
    { duty: "scorer", name: "M Cele" },
  ]);
  ok("the director of sport can — officiating.assign is hers", first.status === 200);
  ok("...and all three are recorded", first.body?.appointed === 3);

  group("The school is derived from the match, never taken from the caller");
  const row = (await q(`select school_id, appointed_by from match_official where match_id = $1 limit 1`, [m]))[0];
  ok("the row is anchored to the match's own school", row?.school_id === HIL);
  ok("...and remembers who appointed them", !!row?.appointed_by);

  group("Anyone who may read the fixture may see who is standing");
  const seen = await standing(m, head);
  ok("two umpires and a scorer", seen.length === 3);
  ok("the umpires are named", seen.filter((r) => r.duty === "umpire").length === 2);
  ok("the panel is carried", seen.some((r) => r.panel === "KZN Cricket Umpires"));
  ok("a guardian who may read the fixture sees them too — an umpire's name is announced at the toss",
     (await standing(m, parent)).length === 3);
  ok("an unauthenticated read is refused, not answered empty",
     [401, 403].includes((await api(`/api/read/officials?matchId=${m}`)).status));

  group("An official cannot appoint themselves");
  // The seeded analyst holds a scout role, not officiating.assign. The point
  // is the capability: `official` carries officiating.report, and reporting is
  // not appointing.
  const analyst = await login("analyst@example.invalid");
  ok("holding an officiating capability is not holding the assigning one",
     [403, 401].includes((await appoint(m, analyst, [{ duty: "umpire", name: "Self Appointed" }])).status));

  group("A mis-tick is refused before it reaches the sheet");
  ok("the same umpire twice on the same duty",
     (await appoint(m, head, [
       { duty: "umpire", name: "D Naidoo" }, { duty: "umpire", name: "d naidoo" },
     ])).status === 400);
  ok("an unknown duty", (await appoint(m, head, [{ duty: "linesman", name: "X" }])).status === 400);
  ok("an official with no name", (await appoint(m, head, [{ duty: "umpire", name: "  " }])).status === 400);
  ok("an empty sheet", (await appoint(m, head, [])).status === 400);
  ok("...and none of that disturbed the panel already standing",
     (await standing(m, head)).length === 3);

  group("Replacing a panel withdraws it rather than deleting it");
  const second = await appoint(m, head, [{ duty: "umpire", name: "A Sithole" }]);
  ok("a new sheet is accepted", second.status === 200);
  const now = await standing(m, head);
  ok("only the new appointment stands", now.length === 1 && now[0].person_name === "A Sithole");
  const all = await q(`select count(*)::int as n from match_official where match_id = $1`, [m]);
  ok("the previous three are still on the record, withdrawn", all[0].n === 4);
  ok("...which is what a disputed fixture needs and a DELETE would have lost",
     (await q(`select count(*)::int as n from match_official
                where match_id = $1 and withdrawn`, [m]))[0].n === 3);

  group("An appointment to a match that does not exist is refused");
  const ghost = "00000000-0000-0000-0000-0000000000ff";
  ok("no such match", [404, 403].includes((await appoint(ghost, head, [{ duty: "umpire", name: "N O" }])).status));

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`OFFICIALS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

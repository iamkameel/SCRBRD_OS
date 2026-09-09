#!/usr/bin/env node
/**
 * Naming the side, which is where the safeguarding checks actually live.
 *
 * `match_squad` carries two BEFORE triggers — age eligibility and registration
 * — and NOTHING IN THE PRODUCT EVER WROTE THAT TABLE. The scorer's setup wizard
 * kept the XI in React state and put it into an `innings_start` event, so a
 * coach could pick a fifteen-year-old for a U13 fixture, or a child with no
 * verified guardian and no consent, and the app would score it happily. Both
 * rules were correct, falsified, covered by thirty assertions, and bypassed.
 *
 * That is the worst shape a safeguarding control can take: one that exists,
 * passes its tests, and never runs. This walk is the route that makes them run.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-squad.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8809;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL     = "11111111-1111-1111-1111-111111111111";
const P_1XI   = "aaaaaaaa-0000-0000-0000-000000000001";  // James Whitfield, far too old for U13
const GUARDIAN = "88888888-0000-0000-0000-0000000000e1";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-squad-secret" },
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
  method: "POST", body: { email, deviceId: "device-squad" } })).body?.token;
const pick = (match, token, side, players) =>
  api(`/api/matches/${match}/squad`, { method: "POST", token, body: { side, players } });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const live = async (match) =>
  (await q(`select player_id, batting_no from match_squad
             where match_id = $1 and not withdrawn order by batting_no`, [match]));

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const head  = await login("sarah@example.invalid");        // directorofsport: team.select
  const reg   = await login("registrar@example.invalid");    // guardian.link.manage
  const medic = await login("medical@example.invalid");      // neither
  const wes   = await login("registrar.wes@example.invalid");

  const [m] = await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'U13A','Michaelhouse', now() + interval '3 days','T20',20,'scheduled') returning id`,
    [HIL]);
  const u13 = await q(`select id, full_name from player where team_code = 'U13A' order by full_name`);
  const squad = u13.map((p, i) => ({ playerId: p.id, battingNo: i + 1 }));

  group("A child with no guardian is not selected");
  // The seed leaves the U13A side unlinked on purpose. This is the state the
  // registration rule exists for, and the first time the product can hit it.
  const unregistered = await pick(m.id, head, "home", squad);
  ok("the selection is refused", unregistered.status === 400);
  ok("...and names the boy, not just 'invalid'",
     /cannot select B Khumalo/.test(unregistered.body?.detail ?? ""));
  ok("...and says what is missing", /verified guardian link and consent/.test(unregistered.body?.detail ?? ""));
  ok("...and nothing was written", (await live(m.id)).length === 0);

  group("Register them, through the routes a registrar actually has");
  await q(`insert into app_user (id, school_id, email, name, role)
           values ($1,$2,'squad.parent@example.invalid','A Parent','parent')`, [GUARDIAN, HIL]);
  for (const p of u13) {
    await api(`/api/players/${p.id}/guardians`, { method: "POST", token: reg,
      body: { guardianId: GUARDIAN, relationship: "parent" } });
    await api(`/api/players/${p.id}/guardians/verify`, { method: "POST", token: reg,
      body: { guardianId: GUARDIAN, consentVersion: "popia-2026-01" } });
  }
  const good = await pick(m.id, head, "home", squad);
  ok("now the side is accepted", good.status === 200);
  ok("...and all three are on it", good.body?.selected === 3);
  ok("...in the batting order given", (await live(m.id)).map((r) => r.batting_no).join() === "1,2,3");

  group("A fifteen-year-old is still not selected for a U13 match");
  const overAge = await pick(m.id, head, "home", [...squad, { playerId: P_1XI, battingNo: 4 }]);
  ok("the selection is refused", overAge.status === 400);
  ok("...and says the age and the limit",
     /on 1 January and cannot play U13A: the limit is 13/.test(overAge.body?.detail ?? ""));
  // The whole write is one transaction, so a side refused half-way leaves the
  // previous side standing rather than a side of three-and-a-bit.
  ok("...and the side that was already picked survives intact", (await live(m.id)).length === 3);

  group("Replacing a side withdraws, it does not delete");
  const two = squad.slice(0, 2);
  const replaced = await pick(m.id, head, "home", two);
  ok("a shorter side is accepted", replaced.status === 200);
  ok("...and only those two are live", (await live(m.id)).length === 2);
  ok("...while the dropped boy is kept, marked withdrawn",
     (await q(`select withdrawn from match_squad where match_id=$1 and player_id=$2`,
              [m.id, u13[2].id]))[0].withdrawn === true);
  ok("...and the read path shows the live side only",
     ((await api(`/api/read/match_squad?matchId=${m.id}`, { token: head })).body?.rows ?? []).length === 2);
  ok("...and records who picked it",
     (await q(`select selected_by from match_squad where match_id=$1 and not withdrawn limit 1`,
              [m.id]))[0].selected_by === "88888888-0000-0000-0000-000000000007");

  group("A boy who becomes ineligible AFTER selection can still be taken out");
  // The trigger that stops him getting in must not also stop him leaving. Both
  // triggers return early on a withdrawal for exactly this case.
  await pick(m.id, head, "home", squad);
  await api(`/api/players/${u13[0].id}/guardians/withdraw`, { method: "POST", token: reg,
    body: { guardianId: GUARDIAN } });
  const nowUnregistered = await q(
    `select registration_state from player_guardian_status where player_id = $1`, [u13[0].id]);
  ok("consent is withdrawn, so he is no longer registered",
     nowUnregistered[0].registration_state === "pending_consent");
  const withoutHim = await pick(m.id, head, "home", squad.slice(1));
  ok("...and the side can be named without him", withoutHim.status === 200);
  ok("...leaving him withdrawn rather than stuck in the XI",
     (await q(`select withdrawn from match_squad where match_id=$1 and player_id=$2`,
              [m.id, u13[0].id]))[0].withdrawn === true);
  // ...and he cannot be put back while unregistered.
  ok("he cannot be re-selected while unregistered",
     (await pick(m.id, head, "home", squad)).status === 400);

  group("Naming a side is authorised like everything else");
  ok("medical staff cannot pick a team",
     (await pick(m.id, medic, "home", squad.slice(1))).status === 403);
  ok("another school's office cannot pick this side",
     (await pick(m.id, wes, "home", squad.slice(1))).status === 403);
  ok("an unsigned request cannot either",
     (await pick(m.id, null, "home", squad.slice(1))).status === 401);

  group("The request itself has to make sense");
  ok("a side must be home or away",
     (await pick(m.id, head, "sideways", squad.slice(1))).body?.error === "side_must_be_home_or_away");
  ok("an empty side is refused",
     (await pick(m.id, head, "home", [])).body?.error === "players_required");
  ok("the same boy twice is refused",
     (await pick(m.id, head, "home", [squad[1], squad[1]])).body?.error === "duplicate_player");
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", e.message);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:\n" + serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nSQUAD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

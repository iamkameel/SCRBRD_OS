#!/usr/bin/env node
/**
 * The scorecard a viewer opens from Match Centre.
 *
 * ScorecardModal (apps/web/src/views/shared.jsx) used to build the numbers a
 * signed-in viewer sees from a seeded RNG keyed on the final score STRING —
 * seed.js's own header calls that "the demo-mode stand-in for the production
 * event stream... should be deleted when the real replay lands, not adapted."
 * The live scorer moved off it long ago; the viewing modal never did, so
 * anyone who was not the scorer themselves was shown an invented dismissal
 * order and invented shot-by-shot figures for a match that really happened.
 *
 * This walk proves the replacement: the same fromRow()/deriveInnings() fold
 * the live scorer and /read/phases already use, fed by the same
 * GET /matches/:id/events route, reproduces exactly the innings that was
 * written — nothing more, nothing invented — and that the route is not open
 * to just anyone.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-scorecard.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { fromRow, deriveInnings } from "@scrbrd/scoring";

const PORT = 8824;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-scorecard-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { token } = {}) => {
  const res = await fetch(BASE + path, {
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => {
  const res = await fetch(`${BASE}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, deviceId: "device-scorecard" }) });
  return (await res.json().catch(() => null))?.token;
};

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const head = await login("sarah@example.invalid");
  const su = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  const [p1, p2] = await q(`select id, full_name from player where team_code = '1XI' limit 2`);

  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() - interval '1 day','T20',20,'complete') returning id`,
    [HIL]))[0].id;

  const stamp = `${Date.now()}-${Math.random()}`;
  let seq = 0;
  const write = async (kind, { ballType = null, value = null, strikerId = null, payload = {} } = {}) => {
    seq += 1;
    await q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                               idempotency_key, client_seq, client_ts, kind, ball_type, value, striker_id, payload)
       values ($1,$2,$3,1,0,$4,'device-scorecard',$5,$3,now(),$6,$7,$8,$9,$10::jsonb)`,
      [m, HIL, seq, su, `scorecard-${stamp}-${seq}`, kind, ballType, value, strikerId, JSON.stringify(payload)]);
  };

  // A real, short innings: an opening pair, a boundary, a dot, a wicket. Every
  // run here is even (or zero) so the strike never rotates before the
  // wicket — an odd run mid-over would hand the dismissal to the OTHER
  // batter, which is exactly the kind of attribution bug a fold like this
  // exists to get right and a careless fixture would paper over.
  await write("innings_start", { payload: {
    battingTeam: "Hilton College", bowlingTeam: "Michaelhouse",
    teamKey: "Hilton College", bowlingTeamKey: "Michaelhouse",
    squad: [{ id: p1.id, name: p1.full_name }, { id: p2.id, name: p2.full_name }],
    bowlingSquad: [], overs: 20,
  } });
  await write("batters", { payload: { striker: p1.id, nonStriker: p2.id } });
  await write("ball", { ballType: "run", value: 4, strikerId: p1.id });
  await write("ball", { ballType: "run", value: 2, strikerId: p1.id });
  await write("ball", { ballType: "run", value: 0, strikerId: p1.id });
  await write("ball", { ballType: "W", value: 0, strikerId: p1.id, payload: { dismissal: "Bowled" } });

  group("A viewer who may read this fixture can read its ball log");
  const res = await api(`/api/matches/${m}/events`, { token: head });
  ok("the events route answers", res.status === 200);
  const rows = res.body?.events || [];
  ok("every event that was written comes back, in order", rows.length === 6);

  group("The replay agrees with what was actually scored — not a guess from a score string");
  const evs = rows.map(fromRow);
  const inn0 = deriveInnings(evs.filter((e) => e.innings === 0));
  ok("the batting side is the one named on the real innings_start, not invented",
     inn0.battingTeam === "Hilton College" && inn0.bowlingTeam === "Michaelhouse");
  ok("runs match exactly what was bowled", inn0.runs === 6);
  ok("wickets match exactly what was bowled", inn0.wickets === 1);
  ok("legal balls match exactly what was bowled", inn0.balls === 4);
  ok("the boundary is credited to the batter who actually hit it",
     inn0.batsmen.find((b) => b.id === p1.id)?.fours === 1);
  ok("the dismissal mode survives the round trip — 'Bowled' renders as the scorecard's own shorthand",
     /^b\b/i.test(inn0.batsmen.find((b) => b.id === p1.id)?.dismissal ?? ""));

  group("An unplayed fixture reports nothing, never an invented one");
  const empty = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() + interval '1 day','T20',20,'scheduled') returning id`,
    [HIL]))[0].id;
  const er = await api(`/api/matches/${empty}/events`, { token: head });
  ok("no events, not a seeded reconstruction", (er.body?.events || []).length === 0);

  group("An unauthenticated request is refused, not answered with an empty truth");
  ok("no token, no read", [401, 403].includes((await api(`/api/matches/${m}/events`)).status));

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`SCORECARD SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

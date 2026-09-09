#!/usr/bin/env node
/**
 * The rest of the prematch checklist: batting order, weather, pitch report.
 *
 * Three findings in one walk.
 *
 * BATTING ORDER was a defect in shipped code. `batting_no` was an
 * unconstrained smallint, so a coach could name two number threes, or a number
 * 47, and the scorer's setup screen would take whichever the sort returned
 * first. Squad selection went out with that hole in it.
 *
 * WEATHER and the PITCH REPORT are the fourth and fifth instances of the
 * pattern this branch keeps closing: a table with a read query and no way on
 * earth to write it. The scorer's wizard showed a weather step that went
 * nowhere.
 *
 * Unlike the toss, conditions stay writable once play has started. Weather
 * changes — that is the reason for recording it — and a scorer who cannot
 * write "rain arrived at 3pm" has been handed something worse than a notebook.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-conditions.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8811;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-conditions-secret" },
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
  method: "POST", body: { email, deviceId: "device-cond" } })).body?.token;

const pick    = (m, t, side, players) => api(`/api/matches/${m}/squad`,   { method: "POST", token: t, body: { side, players } });
const weather = (m, t, body)          => api(`/api/matches/${m}/weather`, { method: "POST", token: t, body });
const pitch   = (m, t, body)          => api(`/api/matches/${m}/pitch`,   { method: "POST", token: t, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const head   = await login("sarah@example.invalid");     // directorofsport
  const scorer = await login("scorer@example.invalid");    // scoring.start, no facility.manage
  const parent = await login("parent@example.invalid");

  const newMatch = async (team = "1XI") => (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,$2,'Michaelhouse', now() + interval '1 day','T20',20,'scheduled') returning id`,
    [HIL, team]))[0].id;

  // Only the players the seed leaves REGISTERED. Selection eligibility is
  // smoke-squad's subject, not this walk's — a side half of whose members the
  // registration trigger refuses would fail these assertions for the wrong
  // reason, which is exactly the trap smoke-access fell into once already.
  const xi = await q(
    `select p.id from player p
       join player_guardian_status s on s.player_id = p.id
      where p.team_code = '1XI' and s.registration_state = 'active'
      order by p.full_name`);

  // ── BATTING ORDER ────────────────────────────────────────────
  group("A batting order is an order");
  ok("the seed leaves enough registered players to order", xi.length >= 5);
  const m = await newMatch();
  const inOrder = xi.map((p, i) => ({ playerId: p.id, battingNo: i + 1 }));
  ok("a side numbered from one is accepted", (await pick(m, head, "home", inOrder)).status === 200);
  const stored = await q(
    `select batting_no from match_squad where match_id = $1 and not withdrawn order by batting_no`, [m]);
  ok("and every position is filled, in order",
     stored.length === xi.length && stored.every((r, i) => r.batting_no === i + 1));
  // The boundary. Eleven is the last legal position because every team code in
  // this product names an XI.
  const mB = await newMatch();
  ok("number eleven is legal",
     (await pick(mB, head, "home", [{ playerId: xi[0].id, battingNo: 11 }])).status === 200);
  ok("number twelve is not",
     (await pick(mB, head, "home", [{ playerId: xi[0].id, battingNo: 12 }])).status === 400);

  // The defect. Two number threes used to be accepted silently.
  const m2 = await newMatch();
  const twoThrees = xi.slice(0, 4).map((p, i) => ({ playerId: p.id, battingNo: i === 3 ? 3 : i + 1 }));  // 1,2,3,3
  const dup = await pick(m2, head, "home", twoThrees);
  ok("two boys at number three is refused", dup.status === 400);
  ok("and named as a doubled position, not a generic error", dup.body?.error === "duplicate_batting_no");
  ok("nothing was written", (await q(`select 1 from match_squad where match_id = $1`, [m2])).length === 0);

  const m3 = await newMatch();
  ok("a number 47 is refused",
     (await pick(m3, head, "home", [{ playerId: xi[0].id, battingNo: 47 }])).status === 400);
  ok("so is a number 0",
     (await pick(m3, head, "home", [{ playerId: xi[0].id, battingNo: 0 }])).status === 400);
  ok("and a fractional position",
     (await pick(m3, head, "home", [{ playerId: xi[0].id, battingNo: 3.5 }])).status === 400);
  // A twelfth man does not bat. Naming one at six is a mis-tick, not a plan.
  ok("a twelfth man cannot be given a position",
     (await pick(m3, head, "home", [{ playerId: xi[0].id, battingNo: 6, twelfth: true }])).status === 400);

  group("Reordering a side that is already named");
  // The squad route withdraws the side and re-inserts it, so the partial index
  // must not collide with the order the side is being changed FROM.
  const reversed = xi.map((p, i) => ({ playerId: p.id, battingNo: xi.length - i }));
  ok("the order can be reversed wholesale", (await pick(m, head, "home", reversed)).status === 200);
  const after = await q(
    `select player_id, batting_no from match_squad
      where match_id = $1 and not withdrawn order by batting_no`, [m]);
  ok("and the new order stands",
     after.length === xi.length && after[0].player_id === xi[xi.length - 1].id);
  // Reserves are legitimate: in the squad, no position yet.
  const withReserve = [...xi.slice(0, 3).map((p, i) => ({ playerId: p.id, battingNo: i + 1 })),
                       { playerId: xi[3].id }];
  ok("a squad member with no position is allowed", (await pick(m, head, "home", withReserve)).status === 200);
  ok("...and more than one of them, which a unique index would have blocked",
     (await pick(m, head, "home", [...withReserve, { playerId: xi[4].id }])).status === 200);

  // ── WEATHER ──────────────────────────────────────────────────
  group("The weather, which nothing could write until now");
  const w = await weather(m, head, {
    condition: "Overcast", tempC: 19, humidityPct: 78, windKph: 22,
    windDir: "SSW", uvIndex: 3, rainChancePct: 60, forecast: "Clearing by noon",
  });
  ok("it is recorded", w.status === 200);
  ok("the condition comes back", w.body?.condition === "Overcast");
  ok("and the numbers", w.body?.temp_c === 19 && w.body?.rain_chance_pct === 60);
  ok("playable defaults to true rather than to nothing", w.body?.playable === true);
  ok("calling a match off is a deliberate false",
     (await weather(m, head, { condition: "Heavy rain", playable: false })).body?.playable === false);
  ok("a reading with no condition is refused", (await weather(m, head, {})).status === 400);
  ok("an impossible humidity is refused",
     (await weather(m, head, { condition: "Fine", humidityPct: 140 })).status === 400);
  ok("and a UV index off the scale",
     (await weather(m, head, { condition: "Fine", uvIndex: 99 })).status === 400);
  ok("a second reading replaces the first, it does not stack",
     (await q(`select 1 from match_weather where match_id = $1`, [m])).length === 1);

  // ── PITCH REPORT ─────────────────────────────────────────────
  group("The pitch report");
  const pr = await pitch(m, head, {
    surface: "firm", grass: "light", bounce: "even", pace: "medium",
    favours: "seam", coversOn: false, notes: "Rolled Thursday. Slight dampness on a good length.",
  });
  ok("it is recorded", pr.status === 200);
  ok("the surface comes back", pr.body?.surface === "firm");
  ok("and what the square is expected to reward", pr.body?.favours === "seam");
  ok("a partial report is accepted — three boxes beat none",
     (await pitch(await newMatch(), head, { surface: "damp" })).status === 200);
  ok("a report of nothing at all is refused", (await pitch(await newMatch(), head, {})).status === 400);
  ok("an invented surface is refused", (await pitch(m, head, { surface: "spongy" })).status === 400);
  ok("an invented bounce is refused", (await pitch(m, head, { bounce: "trampoline" })).status === 400);
  ok("one report per match", (await q(`select 1 from match_pitch_report where match_id = $1`, [m])).length === 1);
  ok("who filed it is recorded",
     !!(await q(`select reported_by from match_pitch_report where match_id = $1`, [m]))[0].reported_by);

  group("Conditions are authorised, and separately from each other");
  const m4 = await newMatch();
  ok("a parent cannot record the weather", (await weather(m4, parent, { condition: "Fine" })).status === 403);
  ok("a parent cannot file a pitch report", (await pitch(m4, parent, { surface: "firm" })).status === 403);
  // The two capabilities are genuinely different. A scorer starts matches; a
  // groundsman describes squares. Neither implies the other.
  ok("a scorer cannot file a pitch report — that is facility.manage",
     (await pitch(m4, scorer, { surface: "firm" })).status === 403);
  ok("nothing was written by any of them",
     (await q(`select 1 from match_pitch_report where match_id = $1`, [m4])).length === 0);

  group("Conditions stay writable once play has started");
  // The toss freezes at the first delivery. Weather must not: it changes, and
  // that is the reason for recording it at all.
  const scorerUser = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  await q(
    `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id,
                             device_id, idempotency_key, client_seq, client_ts, kind, payload)
     values ($1, $2, 1, 1, 1, $3, 'device-cond', $4, 1, now(), 'ball', '{}'::jsonb)`,
    [m, HIL, scorerUser, `cond-smoke-${Date.now()}-${Math.random()}`]);
  ok("rain at three o'clock is still recordable",
     (await weather(m, head, { condition: "Rain", playable: false })).status === 200);
  ok("and the pitch report can still be corrected",
     (await pitch(m, head, { surface: "damp", notes: "Rain from 15:00." })).status === 200);

  group("Conditions reach the read path");
  const read = await api(`/api/read/pitch_report?matchId=${m}`, { token: head });
  ok("the pitch report reads back", read.body?.rows?.[0]?.surface === "damp");
  const wx = await api("/api/read/weather", { token: head });
  ok("the weather reads back", wx.body?.rows?.some((r) => r.match_id === m && r.condition === "Rain"));

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`CONDITIONS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

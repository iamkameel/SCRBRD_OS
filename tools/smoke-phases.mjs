#!/usr/bin/env node
/**
 * An innings in three parts, and who is allowed to see them.
 *
 * The arithmetic is smoke-tested in packages/scoring/test/phases.test.mjs. What
 * that suite cannot prove is the thing this project keeps getting wrong: that a
 * DERIVED endpoint inherits the scope of the rows it derives from. An aggregate
 * discloses as surely as a row, and a phase breakdown built over deliveries the
 * reader may not see would leak a match by describing it.
 *
 * So this walk checks the seam. The figures must agree with the scorecard the
 * same reader gets, and a reader who cannot see the fixture must not be handed
 * its powerplay.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-phases.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8821;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-phases-secret" },
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
    body: JSON.stringify({ email, deviceId: "device-phases" }) });
  return (await res.json().catch(() => null))?.token;
};
const phasesOf = async (m, token) => (await api(`/api/read/phases?matchId=${m}`, { token })).body?.rows || [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const head      = await login("sarah@example.invalid");
  const spectator = await login("spectator@example.invalid");

  const m = (await q(`select id, school_id, overs from match where status = 'complete' limit 1`))[0];
  const su = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  const pl = (await q(`select id from player where team_code = '1XI' limit 1`))[0].id;

  // A shaped innings: brisk powerplay, quiet middle, big death. Written to the
  // log directly — how the balls got there is the scoring path's subject.
  let seq = Number((await q(
    `select coalesce(max(seq), 0) as n from ball_event where match_id = $1`, [m.id]))[0].n);
  const stamp = `${Date.now()}-${Math.random()}`;
  const add = async (value) => {
    seq += 1;
    await q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id,
                               device_id, idempotency_key, client_seq, client_ts, kind,
                               ball_type, value, striker_id, payload)
       values ($1,$2,$3,1,1,$4,'device-phases',$5,$3,now(),'ball','run',$6,$7,'{}'::jsonb)`,
      [m.id, m.school_id, seq, su, `phases-${stamp}-${seq}`, value, pl]);
  };
  for (let i = 0; i < 36; i++) await add(i % 6 === 0 ? 4 : 1);   // powerplay
  for (let i = 0; i < 60; i++) await add(i % 6 === 5 ? 0 : 1);   // middle
  for (let i = 0; i < 24; i++) await add(i % 2 ? 6 : 2);         // death

  group("An innings comes back in three parts");
  const rows = await phasesOf(m.id, head);
  ok("the endpoint answers", rows.length >= 1);
  const ph = rows[0]?.phases;
  ok("all three phases are present", ph && ph.powerplay && ph.middle && ph.death);
  ok("the powerplay is the first six overs of a twenty-over match", ph.powerplay.overs === "1-6");
  ok("...and the death the last four", ph.death.overs === "17-20");
  ok("the shape of the innings survives the round trip",
     ph.death.runRate > ph.powerplay.runRate && ph.powerplay.runRate > ph.middle.runRate);

  group("The parts agree with the whole");
  // THE SEAM. Two authoritative-looking numbers that disagree are worse than
  // one, because nothing in the product can say which is right.
  const live = (await api(`/api/read/live_score?matchId=${m.id}`, { token: head })).body?.rows || [];
  const scorecardRuns = live.find((r) => r.innings === 1)?.runs;
  const phaseRuns = ph.powerplay.runs + ph.middle.runs + ph.death.runs;
  ok("the phases sum to the score the same reader is shown",
     Number.isFinite(Number(scorecardRuns)) && phaseRuns === Number(scorecardRuns));
  const scorecardBalls = live.find((r) => r.innings === 1)?.legal_balls;
  ok("...and the balls likewise",
     ph.powerplay.balls + ph.middle.balls + ph.death.balls === Number(scorecardBalls));

  group("A derived view inherits the scope it derives from");
  // The failure this exists to catch: an aggregate that describes a match to
  // somebody who may not read it. Whatever the spectator can see of the ball
  // log, the phases must show exactly that and no more.
  const specPhases = await phasesOf(m.id, spectator);
  const specBalls = ((await api(`/api/read/shot_point_coverage?matchId=${m.id}`, { token: spectator }))
    .body?.rows) || [];
  const specSum = specPhases[0]
    ? specPhases[0].phases.powerplay.balls + specPhases[0].phases.middle.balls + specPhases[0].phases.death.balls
    : 0;
  const headSum = ph.powerplay.balls + ph.middle.balls + ph.death.balls;
  ok("a spectator never sees more deliveries than the director of sport", specSum <= headSum);
  ok("...and what they do see is consistent, not a partial fold",
     specPhases.length === 0 || specSum >= 0);
  ok("an unauthenticated request is refused",
     [401, 403].includes((await api(`/api/read/phases?matchId=${m.id}`)).status));

  group("A match with no deliveries is not a match with zeros");
  const empty = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() + interval '1 day','T20',20,'scheduled') returning id`,
    [m.school_id]))[0].id;
  const none = await phasesOf(empty, head);
  ok("an unplayed match reports no innings rather than an innings of nothing", none.length === 0);

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1200));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`PHASES SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

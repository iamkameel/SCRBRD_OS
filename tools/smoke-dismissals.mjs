#!/usr/bin/env node
/**
 * The dismissal breakdown, and the one law it exists to keep.
 *
 * player_dismissal_breakdown / player_wicket_breakdown (db/26) group the same
 * rows player_dismissals and player_bowling_career already fold into a single
 * count. The arithmetic is trivial; the thing worth a real database for is
 * the law dismissal_is_bowlers() encodes — a run out is not the bowler's —
 * and the seed alone cannot exercise it: every wicket db/98 carries has
 * bowler_id NULL, because the bowler in that innings is a Maritzburg player
 * with no row in a Hilton-only roster (see the seed's own comment). So this
 * writes synthetic deliveries directly, the way smoke-rating.mjs already
 * does for the same reason, crediting one real bowler with five methods —
 * bowled, caught, stumped, lbw, and a run out — and asks the read path
 * whether it kept the run out off his figures.
 *
 * The second half is the falsification the task asked for, kept rather than
 * thrown away: the view is broken on purpose — the same defect this file
 * exists to catch, a run out credited to the bowler — re-read to prove the
 * assertion above would actually have failed against it, then restored and
 * re-read to prove the restore worked. A test that has never been watched to
 * fail is a test nobody knows the shape of.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-dismissals.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";

const PORT = 8804;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL     = "11111111-1111-1111-1111-111111111111";
const MATCH   = "77777777-0000-0000-0000-000000000001";     // smoke-rating's match; a scheduled/complete fixture is fine, this never touches its innings
const BOWLER  = "aaaaaaaa-0000-0000-0000-000000000001";      // James Whitfield, 1XI
// S Naidoo, 1XI — chosen because the seed's own 96-ball over credits him with
// no real dismissal (Bekker is bowled at n=34, Cele caught at n=71; Naidoo's
// range, n 35-55, has neither): the synthetic five below are his only ones,
// so the "five, exactly" assertion is not fighting a real dismissal already
// on his record. The point is the arithmetic, not the cricket.
const STRIKER = "aaaaaaaa-0000-0000-0000-000000000003";
const U_COACH = "88888888-0000-0000-0000-000000000004";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-dismissals-secret" },
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
  method: "POST", body: { email, deviceId: "device-dismissals" } })).body?.token;
const breakdown = async (token) => (await api("/api/read/dismissal_breakdown", { token })).body?.rows ?? [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

// Five methods, one bowler, one non-bowler's-wicket among them. seq/idempotency
// namespaced so this can be cleaned up (and re-run) without touching anything
// else the seed or another smoke walk wrote.
const METHODS = ["bowled", "caught", "stumped", "run_out", "lbw"];
async function writeSyntheticOver() {
  for (let i = 0; i < METHODS.length; i++) {
    await q(
      `insert into ball_event
         (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
          idempotency_key, client_seq, client_ts, kind, ball_type, value,
          striker_id, bowler_id, dismissal)
       values ($1,$2,$3,1,0,$4,'device-dismissals',$5,$3,now(),
               'ball','W',0,$6,$7,$8)`,
      [MATCH, HIL, 9500 + i, U_COACH, `dismissals-smoke-${i}`, STRIKER, BOWLER, METHODS[i]]);
  }
}
async function cleanupSyntheticOver() {
  await q(`delete from ball_event where idempotency_key like 'dismissals-smoke-%'`);
}

// The exact defect this file exists to catch: every method credited to the
// bowler, run_out included. Same shape as db/26's real view, one line cut.
const BROKEN_WICKET_VIEW = `
  CREATE OR REPLACE VIEW player_wicket_breakdown WITH (security_invoker = true) AS
  SELECT b.bowler_id AS player_id, b.dismissal, count(*) AS wickets
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.ball_type = 'W' AND b.bowler_id IS NOT NULL
   GROUP BY b.bowler_id, b.dismissal;`;
// Read straight off the shipped file rather than retyping it a second time,
// so "restore" cannot itself drift from what db/26 actually says.
const REAL_VIEW_SQL = readFileSync(
  new URL("../db/26_dismissal_breakdown.sql", import.meta.url), "utf8")
  .split(/(?=CREATE OR REPLACE VIEW player_wicket_breakdown)/)[1]
  .split(/(?=-- CAUGHT AND BOWLED)/)[0];

try {
  for (let i = 0; i < 60; i++) {
    try { const h = await api("/api/health"); if (h.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const coach = await login("coach@example.invalid");

  await cleanupSyntheticOver();
  await writeSyntheticOver();

  group("A bowler's wickets, by method — a run out is not one of them");
  const rows = await breakdown(coach);
  const bowlerRows = rows.filter((r) => r.side === "bowling" && r.player_id === BOWLER);
  const strikerRows = rows.filter((r) => r.side === "batting" && r.player_id === STRIKER);

  ok("the bowler has exactly four wicket-type rows, not five",
     bowlerRows.length === 4);
  ok("...and they are the four dismissal_is_bowlers() credits",
     ["bowled", "caught", "stumped", "lbw"].every((m) =>
       bowlerRows.some((r) => r.dismissal === m && Number(r.count) === 1)));
  ok("...and run_out is not among them at all",
     !bowlerRows.some((r) => r.dismissal === "run_out"));
  ok("...four wickets, total, not five",
     bowlerRows.reduce((s, r) => s + Number(r.count), 0) === 4);

  ok("the batter's dismissals include all five methods, run_out included",
     strikerRows.length === 5 && strikerRows.some((r) => r.dismissal === "run_out" && Number(r.count) === 1));
  ok("...five dismissals total, because every method is a real way to be out",
     strikerRows.reduce((s, r) => s + Number(r.count), 0) === 5);

  group("The breakdown agrees with the flat counts it refines");
  const career = (await api("/api/read/career", { token: coach })).body?.rows ?? [];
  const bowlerCareer = career.find((c) => c.player_id === BOWLER);
  const strikerCareer = career.find((c) => c.player_id === STRIKER);
  ok("bowling: sum(breakdown) === player_bowling_career.wickets",
     Number(bowlerCareer?.wickets) === bowlerRows.reduce((s, r) => s + Number(r.count), 0));
  ok("batting: sum(breakdown) === player_dismissals.dismissals",
     Number(strikerCareer?.dismissals) === strikerRows.reduce((s, r) => s + Number(r.count), 0));

  group("FALSIFY: credit every method to the bowler, run_out included");
  await pool.query(BROKEN_WICKET_VIEW);
  const brokenRows = (await breakdown(coach)).filter((r) => r.side === "bowling" && r.player_id === BOWLER);
  ok("under the broken view, the run out DOES show up as the bowler's wicket",
     brokenRows.some((r) => r.dismissal === "run_out"));
  ok("...which is exactly what the assertion above exists to catch — five wickets, not four",
     brokenRows.reduce((s, r) => s + Number(r.count), 0) === 5);

  group("Restore, from the file that ships");
  ok("db/26 actually defines player_wicket_breakdown with the guard in place",
     /dismissal_is_bowlers\(b\.dismissal\)/.test(REAL_VIEW_SQL));
  await pool.query(REAL_VIEW_SQL);
  const restoredRows = (await breakdown(coach)).filter((r) => r.side === "bowling" && r.player_id === BOWLER);
  ok("restored: run_out is gone again", !restoredRows.some((r) => r.dismissal === "run_out"));
  ok("restored: back to four wickets", restoredRows.reduce((s, r) => s + Number(r.count), 0) === 4);
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", e.message);
} finally {
  await cleanupSyntheticOver().catch(() => {});
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:\n" + serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nDISMISSAL BREAKDOWN SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

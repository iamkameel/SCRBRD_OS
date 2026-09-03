#!/usr/bin/env node
/**
 * The read path, against a real database.
 *
 * This exists because the read suite cannot do what it looks like it does. It
 * runs against a fake pool that answers any query with canned rows, which
 * proves the handler does no RBAC of its own — a real and useful claim — but
 * makes it structurally incapable of noticing that the SQL is wrong, or that a
 * view is handing back rows the policies would have refused.
 *
 * Both of those had happened:
 *
 *   - `matches` named six columns that have never existed on the table, so
 *     every call returned SQLSTATE 42703 and the fixture list could not load.
 *     31 assertions passed the whole time.
 *
 *   - the *_masked views ran as their OWNER, who owns the tables underneath
 *     them and therefore bypasses row-level security. player_masked returned
 *     every player at every school — through the one object the read path is
 *     required to use for personal information, and invisibly, because the
 *     leaked rows were still column-masked and so looked exactly right.
 *
 * So this asks the real server, as real seeded people, and checks both that
 * the queries run and that different people get different answers.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-read.mjs
 */
import { spawn } from "node:child_process";

const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-read-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, token) => {
  const res = await fetch(BASE + path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => {
  const res = await fetch(`${BASE}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, deviceId: "device-read-smoke" }),
  });
  return (await res.json()).token;
};
const read = async (resource, token) => {
  const r = await api(`/api/read/${resource}`, token);
  if (r.status !== 200) throw new Error(`${resource}: ${JSON.stringify(r.body)}`);
  return r.body.rows;
};

try {
  for (let i = 0; i < 60; i++) {
    try { const h = await api("/api/health"); if (h.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach = await login("coach@example.invalid");     // U19A only
  const scorer = await login("scorer@example.invalid");   // school-wide, no medical
  const medic = await login("medical@example.invalid");
  const guardian = await login("parent@example.invalid"); // one child

  // ── Every query runs ────────────────────────────────────────────
  group("Every wired query actually runs");
  for (const resource of ["matches", "players", "injuries", "competitions"]) {
    let ran = true, err = null;
    try { await read(resource, medic); } catch (e) { ran = false; err = e.message; }
    ok(`${resource} returns rows rather than a SQL error${ran ? "" : ` — ${err}`}`, ran);
  }

  // ── The heat map's filter lives in SQL, not in report code ──────
  group("Shot placement");
  const MATCH = "77777777-0000-0000-0000-000000000001";
  let pointsRan = true, covRan = true;
  try { await read(`shot_points?matchId=${MATCH}`, coach); } catch { pointsRan = false; }
  try { await read(`shot_point_coverage?matchId=${MATCH}`, coach); } catch { covRan = false; }
  ok("the point-era query runs", pointsRan);
  ok("the coverage query runs", covRan);
  const cov = covRan ? (await read(`shot_point_coverage?matchId=${MATCH}`, coach))[0] : null;
  ok("coverage is reportable rather than inferred",
     cov !== null && "points" in cov && "sector_era" in cov);
  // Nothing has been captured as a point yet, and the seed carries no balls —
  // so the honest answer is zero, not a synthesised one.
  ok("a match with no point-era balls returns none, not fabricated ones",
     (await read(`shot_points?matchId=${MATCH}`, coach)).length === 0);

  // ── The same query, different answers ───────────────────────────
  group("The same query, scoped per person");
  const coachMatches = await read("matches", coach);
  const scorerMatches = await read("matches", scorer);
  ok("a team-scoped coach sees only their team's fixtures",
     coachMatches.length > 0 && coachMatches.every((m) => m.team_code === "U19A"));
  ok("a school-scoped scorer sees more of them", scorerMatches.length > coachMatches.length);
  ok("nobody sees another school's fixtures",
     [...coachMatches, ...scorerMatches].every((m) => m.school_id === HIL));
  ok("the fixture carries what a match centre needs",
     coachMatches.every((m) => m.id && m.opponent && m.starts_at && m.status));

  // ── Views must not smuggle rows past the policies ───────────────
  group("Masked views filter rows as well as columns");
  const coachPlayers = await read("players", coach);
  ok("the coach's roster is their own team", coachPlayers.length > 0);
  ok("...and contains nobody from another school",
     !coachPlayers.some((p) => p.school_id === WES));

  // The guardian case is the sharpest: their assignment names one child, so
  // the roster is one row. A view running as its owner returned all eight.
  const guardianPlayers = await read("players", guardian);
  ok("a guardian's roster is only their own child", guardianPlayers.length === 1);

  // ── Columns, per row, per capability ────────────────────────────
  group("Sensitive columns are masked per capability");
  ok("the scorer reads a player without their date of birth",
     (await read("players", scorer)).every((p) => p.born == null));
  ok("...and the guardian reads their own child's",
     guardianPlayers.every((p) => p.born != null));

  const medicInjuries = await read("injuries", medic);
  const coachInjuries = await read("injuries", coach);
  ok("the physio reads clinical notes", medicInjuries.some((i) => i.notes));
  ok("the coach reads that a player is unavailable", coachInjuries.length > 0);
  ok("...but not the diagnosis behind it", coachInjuries.every((i) => i.notes == null));
  ok("the scorer reads no injuries at all", (await read("injuries", scorer)).length === 0);

  // ── Default deny ────────────────────────────────────────────────
  group("Default deny");
  const anon = await api("/api/read/players");
  ok("an unauthenticated read is refused", anon.status === 401);
  const nonsense = await api("/api/read/nonsense", coach);
  ok("an unknown resource is a 404, not an empty list", nonsense.status === 404);
} catch (e) {
  ok(`the read walk threw: ${e.message?.slice(0, 120)}`, false);
} finally {
  server.kill("SIGTERM");
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 10).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nREAD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

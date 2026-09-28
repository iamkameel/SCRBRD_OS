#!/usr/bin/env node
/**
 * SCRBRD-110 phase 1 over HTTP: the nets band and the health consent (db/60).
 *
 * db/99 section 38 proves the database. This walks the routes a screen uses,
 * as the seed's people, and asks what only the API can answer:
 *
 *   1. THE SWITCH. POST /api/load-entry is refused as module_disabled until
 *      the platform grants workload_monitoring to Hilton; so are the reads.
 *   2. THE BAND. The 1st XI coach records a session for two boys in one
 *      request; R Pillay records his own band for the same session. His
 *      figure is the one the load read counts, once, marked as an estimate —
 *      and he has no health consent. A net with a count and a paper match
 *      with a band are refused in words, and a retry with the same
 *      Idempotency-Key writes once.
 *   3. WHO. A pupil on the same side reads no load and records none; his
 *      parent records none.
 *   4. THE CONSENT. His parent says yes and no through the consents route and
 *      reads it back in the `consents` read; his coach cannot answer for him.
 *   5. THE OLD SCREEN. The workload read still carries what the Training
 *      screen draws, with the new figures after it.
 *
 * Leaves the database as it found it.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-load.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8895);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, 1XI, sixteen
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001"; // James Whitfield, 1XI
const VERSION = "health-monitoring-2026-09";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-load-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body, key } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
               ...(key ? { "idempotency-key": key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null), replayed: res.headers.get("idempotent-replayed") };
};
const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-load" } })).body?.token;

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;
let session = null;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const coach = await login("coach@example.invalid");
  const pillay = await login("pillay@example.invalid");
  const parent = await login("parent@example.invalid");
  const pupil = await login("spectator@example.invalid");   // a `player` at Hilton: a team-mate
  ok("the coach, the boy, his parent and a team-mate sign in", coach && pillay && parent && pupil);

  // Today's nets, at six in the morning.
  [{ id: session }] = await q(
    `insert into training_session (school_id, team_code, title, starts_at, duration_min, session_type)
     values ($1, '1XI', 'Walk: seamers at the nets', (sa_today()::timestamp + interval '6 hours') at time zone 'Africa/Johannesburg', 60, 'bowling')
     returning id`, [HIL]);

  // ── 1. The switch ──────────────────────────────────────────────
  group("1. Off until the platform grants it");
  const off = await api("/api/load-entry", { method: "POST", token: coach,
    body: { trainingSessionId: session, entries: [{ playerId: PILLAY, band: "12_24" }] } });
  ok("a nets band is refused while the module is off", off.status === 403 && off.body?.error === "module_disabled", JSON.stringify(off.body));
  const offRead = await api(`/api/read/load?playerId=${PILLAY}`, { token: coach });
  ok("...and so is the load read", offRead.status === 403 && offRead.body?.error === "module_disabled", JSON.stringify(offRead.body));
  await q(`insert into feature_grant (key, school_id, granted, note) values ('workload_monitoring', $1, true, 'smoke-load')
           on conflict (key, school_id) do update set granted = true`, [HIL]);

  // ── 2. The band ────────────────────────────────────────────────
  group("2. A band per boy, his own figure counting once");
  const grp = await api("/api/load-entry", { method: "POST", token: coach, key: "smoke-load-group-1",
    body: { trainingSessionId: session, entries: [
      { playerId: PILLAY, band: "12_24", effort: "medium", minutes: 45 },
      { playerId: WHITFIELD, band: "lt12", effort: "low" }] } });
  ok("the coach records the session for two boys in one request", grp.status === 200 && grp.body?.rows?.length === 2, JSON.stringify(grp.body));
  ok("...stamped as staff, on the session's day, effort as 6",
     grp.body?.rows?.every((r) => r.recordedAs === "staff" && r.trainingSessionId === session) && grp.body.rows[0].rpe === 6);
  const again = await api("/api/load-entry", { method: "POST", token: coach, key: "smoke-load-group-1",
    body: { trainingSessionId: session, entries: [
      { playerId: PILLAY, band: "12_24", effort: "medium", minutes: 45 },
      { playerId: WHITFIELD, band: "lt12", effort: "low" }] } });
  const [{ n: written }] = await q(`select count(*)::int n from load_entry where training_session_id = $1`, [session]);
  ok("a retry with the same Idempotency-Key writes once", again.status === 200 && again.replayed === "true" && written === 2,
     `${again.status} ${again.replayed} ${written}`);
  const mine = await api("/api/load-entry", { method: "POST", token: pillay,
    body: { playerId: PILLAY, kind: "nets", trainingSessionId: session, band: "24_36", effort: "high", minutes: 50 } });
  ok("R Pillay records his own band for the same session, as himself",
     mine.status === 200 && mine.body?.recordedAs === "self" && mine.body?.rpe === 9, JSON.stringify(mine.body));
  const counted = await api("/api/load-entry", { method: "POST", token: pillay,
    body: { playerId: PILLAY, kind: "nets", onDate: new Date().toISOString().slice(0, 10), band: "12_24", units: 20 } });
  ok("a net with a count is refused, by the table's rule",
     counted.status === 422 && counted.body?.reason === "load_entry_band_or_count", JSON.stringify(counted.body));
  const paper = await api("/api/load-entry", { method: "POST", token: pillay,
    body: { playerId: PILLAY, kind: "match_elsewhere", onDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10), band: "24_36" } });
  ok("a paper-scored match with a band is refused", paper.status === 422 && paper.body?.reason === "load_entry_band_or_count", JSON.stringify(paper.body));
  const badEffort = await api("/api/load-entry", { method: "POST", token: pillay,
    body: { playerId: PILLAY, kind: "nets", trainingSessionId: session, band: "24_36", effort: 7 } });
  ok("an effort that is not low, medium or high is refused by name", badEffort.status === 400 && badEffort.body?.error === "effort_is_low_medium_or_high");

  const load = await api(`/api/read/load?playerId=${PILLAY}`, { token: coach });
  const row = load.body?.rows?.[0];
  ok("the coach reads his load: today's session counts once, and it is his 30",
     load.status === 200 && row?.units_7d - row?.match_units_7d === 30, JSON.stringify(row && { u: row.units_7d, m: row.match_units_7d }));
  ok("...marked as an estimate, with a word, and 'not monitored' (no health consent)",
     row?.estimated_7d === true && typeof row?.load_word === "string" && row?.monitored === false);
  const weeks = await api(`/api/read/load_weeks?playerId=${PILLAY}&weeks=8`, { token: coach });
  const thisWeek = weeks.body?.rows?.at(-1);
  ok("the chart has 8 weeks, this one an estimate", weeks.body?.rows?.length === 8 && thisWeek?.estimated === true && thisWeek?.units >= 30,
     JSON.stringify(thisWeek));
  const own = await api(`/api/read/load?playerId=${PILLAY}`, { token: pillay });
  ok("R Pillay reads his own load", own.body?.rows?.length === 1);

  // ── 3. Who ─────────────────────────────────────────────────────
  group("3. A team-mate and a parent read and record no load");
  const mate = await api(`/api/read/load?playerId=${PILLAY}`, { token: pupil });
  const mateWeeks = await api(`/api/read/load_weeks?playerId=${PILLAY}`, { token: pupil });
  ok("a pupil at the school reads no load and no chart", mate.status === 200 && mate.body?.rows?.length === 0 && mateWeeks.body?.rows?.length === 0);
  const mateWrite = await api("/api/load-entry", { method: "POST", token: pupil,
    body: { playerId: PILLAY, kind: "nets", trainingSessionId: session, band: "36plus" } });
  ok("...and records none for him", mateWrite.status === 403 && mateWrite.body?.error === "not_permitted", JSON.stringify(mateWrite.body));
  const parentWrite = await api("/api/load-entry", { method: "POST", token: parent,
    body: { playerId: PILLAY, kind: "nets", trainingSessionId: session, band: "36plus" } });
  ok("his parent records no nets band", parentWrite.status === 403, JSON.stringify(parentWrite.body));
  const parentLoad = await api(`/api/read/load?playerId=${PILLAY}`, { token: parent });
  ok("...and reads no load by standing", parentLoad.body?.rows?.length === 0);

  // ── 4. The consent ─────────────────────────────────────────────
  group("4. His parent's answer, and nobody else's");
  const before = await api("/api/read/consents", { token: parent });
  const c0 = before.body?.rows?.find((r) => r.player_id === PILLAY);
  ok("the consents read shows his parent R Pillay, not answered, off", c0?.kind === "health" && c0?.state === "not_answered" && c0?.live === false,
     JSON.stringify(c0));
  const coachSays = await api(`/api/players/${PILLAY}/consents/health`, { method: "POST", token: coach, body: { yes: true, version: VERSION } });
  ok("his coach cannot answer for him", coachSays.status === 403 && coachSays.body?.error === "not_permitted", JSON.stringify(coachSays.body));
  const selfSays = await api(`/api/players/${PILLAY}/consents/health`, { method: "POST", token: pillay, body: { yes: true, version: VERSION } });
  ok("...nor he at sixteen", selfSays.status === 422 && selfSays.body?.error === "not_yet_eighteen", JSON.stringify(selfSays.body));
  const yes = await api(`/api/players/${PILLAY}/consents/health`, { method: "POST", token: parent, body: { yes: true, version: VERSION } });
  ok("his parent says yes", yes.status === 200 && yes.body?.ok === true, JSON.stringify(yes.body));
  const c1 = (await api("/api/read/consents", { token: parent })).body?.rows?.find((r) => r.player_id === PILLAY);
  ok("...and reads it back: on, by her", c1?.state === "given" && c1?.live === true && c1?.by_you === true, JSON.stringify(c1));
  const dup = await api(`/api/players/${PILLAY}/consents/health`, { method: "POST", token: parent, body: { yes: true, version: VERSION } });
  ok("the same yes twice is already given", dup.status === 409 && dup.body?.error === "already_given");
  const loadNow = (await api(`/api/read/load?playerId=${PILLAY}`, { token: coach })).body?.rows?.[0];
  ok("the coach's read now says monitored", loadNow?.monitored === true);
  const his = (await api("/api/read/consents", { token: pillay })).body?.rows?.find((r) => r.player_id === PILLAY);
  ok("R Pillay sees it on his own row, read-only until eighteen", his?.relation === "self" && his?.live === true
     && his?.can_say_yes === false && his?.ask_at_18 === false, JSON.stringify(his));
  const no = await api(`/api/players/${PILLAY}/consents/health`, { method: "POST", token: parent, body: { yes: false, version: VERSION } });
  const c2 = (await api("/api/read/consents", { token: parent })).body?.rows?.find((r) => r.player_id === PILLAY);
  ok("she withdraws it: off on the next read", no.status === 200 && c2?.state === "withdrawn" && c2?.live === false, JSON.stringify(c2));
  const coachConsents = await api("/api/read/consents", { token: coach });
  ok("a coach has no consents to answer for", coachConsents.body?.rows?.length === 0);
  const noAnswer = await api(`/api/players/${PILLAY}/consents/health`, { method: "POST", token: parent, body: { version: VERSION } });
  ok("a request with no answer is refused", noAnswer.status === 400 && noAnswer.body?.error === "no_answer");

  // ── 5. The old screen ──────────────────────────────────────────
  group("5. The workload read the Training screen draws");
  const wl = await api("/api/read/workload?teamCode=1XI", { token: coach });
  const w = wl.body?.rows?.find((r) => r.player_id === PILLAY);
  ok("it still carries what the screen draws", w && ["overs_7d", "overs_28d", "acwr", "load_state", "longest_spell_7d", "breaches_28d",
     "sessions_7d", "minutes_7d", "clause_code"].every((k) => k in w), JSON.stringify(w && Object.keys(w)));
  ok("...with the new figures after them", w && w.units_7d >= 30 && w.estimated_7d === true && typeof w.load_word === "string" && w.monitored === false,
     JSON.stringify(w && { u: w.units_7d, e: w.estimated_7d, word: w.load_word, m: w.monitored }));
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.message);
} finally {
  // As it found it: the rows this walk wrote, and the grant.
  await q(`delete from load_entry where player_id in ($1, $2)`, [PILLAY, WHITFIELD]).catch(() => {});
  await q(`delete from health_monitoring_consent where player_id = $1`, [PILLAY]).catch(() => {});
  await q(`delete from feature_grant where key = 'workload_monitoring' and school_id = $1`, [HIL]).catch(() => {});
  if (session) await q(`delete from training_session where id = $1`, [session]).catch(() => {});
  server.kill();
  await pool.end();
}
if (fail && serverErr.length) console.log(serverErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nLOAD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * Reading the other side, ahead of a fixture — the one deliberate crossing of
 * the tenant line, and the three bounds that make it a preparation rather
 * than a file on another school's children.
 *
 *   1. OFF BY DEFAULT. The platform switches it on per school; a school
 *      cannot decide to start reading its rivals.
 *   2. A HEAD-TO-HEAD FIXTURE the reader's team is in, or nothing. Not a
 *      refusal — nothing, because a reason confirms the fixture exists.
 *   3. A WINDOW. Opens fourteen days before the start, closes at the start.
 *   4. CRICKET COLUMNS AND AGGREGATES. Name, role, styles, and what the log
 *      says. Never born, id, address, fitness, injury, notes.
 *   5. THE WHOLE LOG, GRADED. Every fixture the player has been logged in,
 *      with the evidence behind each figure named, and the figure withheld
 *      below the floor.
 *   6. EVERY READ IS WRITTEN DOWN against the school that was read.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-opposition.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8865;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const MKHIZE = "bbbbbbbb-0000-0000-0000-000000000001";   // Westville 1XI
const BOTHA  = "bbbbbbbb-0000-0000-0000-000000000002";   // Westville 1XI

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-opposition-secret" },
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
  method: "POST", body: { email, deviceId: "device-opposition" } })).body?.token;
const context = (m, token) => api(`/api/read/opposition_context?matchId=${m}`, { token });
const squad   = (m, token) => api(`/api/read/opposition_squad?matchId=${m}`, { token });
const rows = (r) => r.body?.rows ?? [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

/** A fixture, hosted by `home`, against a tenant side or a typed name. */
const fixture = async (home, homeTeam, { awaySchool = null, awayTeam = null, opponent = "x",
                                          days, status = "scheduled" }) =>
  (await q(`insert into match (school_id, team_code, away_school_id, away_team_code, opponent,
                               starts_at, sport, format, overs, status)
            values ($1,$2,$3,$4,$5, now() + make_interval(days => $6), 'cricket','T20',20,$7)
            returning id`, [home, homeTeam, awaySchool, awayTeam, opponent, days, status]))[0].id;

/** n legal deliveries into a match's log, as the migration owner. */
let seqBase = 0;
const balls = async (matchId, hostSchool, n, { striker, bowler = null, nonStriker = null, wicketsAt = [] }) => {
  const scorer = (await q(`select id from app_user where email='scorer@example.invalid'`))[0].id;
  const pattern = [0, 1, 0, 4, 0, 1, 2, 0];
  for (let i = 1; i <= n; i++) {
    const isW = wicketsAt.includes(i);
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                                     idempotency_key, client_seq, client_ts, kind, ball_type, value,
                                     striker_id, non_striker_id, bowler_id, dismissal, dismissed_id)
             values ($1,$2,$3,1,1,$4,'d',$5,$3, now(),'ball',$6,$7,$8,$9,$10,$11,$12)`,
      [matchId, hostSchool, seqBase + i, scorer, `opp-${matchId}-${seqBase + i}`,
       isW ? "W" : "run", isW ? 0 : pattern[i % pattern.length],
       striker, nonStriker, bowler, isW ? "bowled" : null, isW ? striker : null]);
  }
  seqBase += n;
};

/** One statement under a person's own policies, rolled back; id resolved first. */
async function asPerson(email, sql, params = []) {
  const { rows: who } = await pool.query(`select id from app_user where email = $1`, [email]);
  const c = await pool.connect();
  try {
    await c.query("BEGIN"); await c.query("SET LOCAL ROLE scrbrd_app");
    await c.query("SELECT set_config('app.user_id', $1, true)", [who[0]?.id ?? null]);
    const r = await c.query(sql, params); await c.query("ROLLBACK");
    return { ok: true, rows: r.rows };
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); return { ok: false, code: e.code, message: e.message }; }
  finally { c.release(); }
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach    = await login("coach@example.invalid");       // Hilton 1XI
  const coach2   = await login("coach2@example.invalid");      // Hilton 2XI — not in the fixture
  const wesCoach = await login("coach.wes@example.invalid");   // Westville 1XI
  const scout    = await login("analyst@example.invalid");     // seeded as a SCOUT, not an analyst
  const parent   = await login("parent@example.invalid");
  const watcher  = await login("watcher@example.invalid");
  const platform = await login("platform@example.invalid");
  const hilBoy   = (await q(`select id from player where school_id=$1 and team_code='1XI'
                              order by full_name limit 1`, [HIL]))[0].id;

  // ── The history the intelligence is derived from ──
  // A past Hilton–Westville match: Westville bowled (Botha, 36 balls) and
  // batted (Mkhize, 12 balls). A past Westville–Kearsney match, Kearsney not a
  // tenant: Mkhize batted 32 balls with no bowler on record.
  const past  = await fixture(HIL, "1XI", { awaySchool: WES, awayTeam: "1XI", days: -20, status: "complete" });
  await balls(past, HIL, 36, { striker: hilBoy, bowler: BOTHA, wicketsAt: [18] });
  await balls(past, HIL, 12, { striker: MKHIZE, nonStriker: BOTHA, bowler: hilBoy });
  const kears = await fixture(WES, "1XI", { opponent: "Kearsney 1st XI", days: -10, status: "complete" });
  await balls(kears, WES, 32, { striker: MKHIZE, nonStriker: BOTHA, wicketsAt: [30] });
  // Ten balls for Botha, so the "figure withheld below the floor" case is a
  // non-zero sample rather than an empty one. The first draft never had him
  // face a ball and then asserted he was 'insufficient'; he was 'none', and
  // the walk was right to say so.
  await balls(kears, WES, 10, { striker: BOTHA, nonStriker: MKHIZE });
  // The fixtures being prepared for.
  const soon   = await fixture(HIL, "1XI", { awaySchool: WES, awayTeam: "1XI", days: 7 });
  const later  = await fixture(HIL, "1XI", { awaySchool: WES, awayTeam: "1XI", days: 40 });
  const solo   = await fixture(HIL, "1XI", { opponent: "Michaelhouse 1st XI", days: 7 });

  group("Off by default, and off means off");
  {
    const r = await context(soon, coach);
    ok("with the feature off the API refuses the read", r.status === 403 && r.body?.error === "module_disabled");
    // Belt and braces: the function itself says so, for a psql session that
    // never met the API's module gate.
    const f = await asPerson("coach@example.invalid", `select reason from opposition_side($1)`, [soon]);
    ok("...and so does the function underneath", f.ok && f.rows[0]?.reason === "feature_off");
    ok("a school cannot switch it on for itself",
       [403, 401].includes((await api("/api/admin/features/opposition", { method: "POST",
         token: await login("registrar@example.invalid"), body: { enabled: true, reason: "we want it" } })).status));
    ok("the platform can", (await api("/api/admin/features/opposition", { method: "POST", token: platform,
         body: { enabled: true, reason: "Pilot: Hilton and Westville, window rule walked through" } })).status === 200);
  }

  group("A head-to-head fixture you are in, or nothing");
  {
    const home = rows(await context(soon, coach));
    ok("the home coach has standing", home.length === 1 && home[0].my_side === "home");
    ok("...and is told who the other side is", home[0].their_label === "Westville Boys' High 1XI");
    const away = rows(await context(soon, wesCoach));
    ok("the away coach has standing too", away.length === 1 && away[0].my_side === "away");
    ok("...facing the host", away[0].their_label === "Hilton College 1XI");
    // Not a refusal with a reason. A reason confirms the fixture exists.
    ok("a coach of another side at the host school gets nothing", rows(await context(soon, coach2)).length === 0);
    ok("...and neither does a parent", rows(await context(soon, parent)).length === 0);
    ok("...nor a spectator", rows(await context(soon, watcher)).length === 0);
    // The seeded 'analyst' account is a SCOUT. Talent scouting is a different
    // capability with opposite consent semantics, and holding it buys nothing
    // here — which is the whole reason the module is not called scouting.
    ok("...nor a scout, whose capability is a different thing", rows(await context(soon, scout)).length === 0);
    ok("nothing at all reaches a spectator's squad read", rows(await squad(soon, watcher)).length === 0);
  }

  group("A window: fourteen days before, until the first ball");
  {
    const far = rows(await context(later, coach))[0];
    ok("a fixture forty days out is not yet open", far?.open === false && far?.reason === "not_yet_open");
    ok("...and says when it opens", !!far?.opens_at);
    ok("...with no squad to read", rows(await squad(later, coach)).length === 0);
    // A closed window says how much there WOULD be to read only if we let it.
    ok("...and does not count what it is not showing", far?.deliveries_analysed === null);
    const gone = rows(await context(past, coach))[0];
    ok("a fixture that has been played is closed", gone?.open === false && gone?.reason === "fixture_started");
    ok("...with no squad either", rows(await squad(past, coach)).length === 0);
    const none = rows(await context(solo, coach))[0];
    ok("a school not on SCRBRD has nothing to read", none?.open === false && none?.reason === "opponent_not_on_scrbrd");
    const now = rows(await context(soon, coach))[0];
    ok("a fixture next week is open", now?.open === true && now?.reason === "open");
  }

  group("Cricket columns, and nothing else about a child");
  {
    const s = rows(await squad(soon, coach));
    ok("the other side's players come back", s.length === 2);
    const keys = Object.keys(s[0]);
    for (const k of ["full_name", "playing_role", "batting_style", "bowling_style", "team_code"]) {
      ok(`...with ${k}`, keys.includes(k));
    }
    // fitness looks like a cricket column and is not: 'rehab' is a clinical
    // state. The rest are a child's personal information.
    for (const k of ["born", "id_number", "address", "guardian", "fitness", "height", "weight",
                     "email", "phone", "hometown", "injury_type", "notes"]) {
      ok(`...and never ${k}`, !keys.includes(k));
    }
  }

  group("The whole log, graded, with the figure withheld below the floor");
  {
    const s = rows(await squad(soon, coach));
    const mk = s.find((r) => r.player_id === MKHIZE);
    const kb = s.find((r) => r.player_id === BOTHA);
    // Every fixture he was logged in — the one against us AND the one against
    // Kearsney — which is the grant as decided.
    ok("Mkhize's balls span both his fixtures", mk?.balls === 44 && mk?.innings === 2);
    ok("...graded low, not insufficient", mk?.batting_evidence === "low");
    ok("...so his strike rate is stated", typeof Number(mk?.strike_rate) === "number" && mk?.strike_rate !== null);
    ok("...and his dismissal counted once", mk?.dismissals === 1);
    // Ten balls is a coin toss with decimals.
    ok("Botha has batted too little to be read", kb?.batting_evidence === "insufficient");
    ok("...so no strike rate is stated for him", kb?.strike_rate === null && kb?.balls > 0);
    ok("...while his bowling, 36 balls, is", kb?.balls_bowled === 36 && kb?.bowling_evidence === "low");
    ok("...with an economy and the wicket", kb?.economy !== null && kb?.wickets === 1);
    ok("the side is ordered by what they have scored", s[0].player_id === MKHIZE);
    const ctx = rows(await context(soon, coach))[0];
    ok("the header counts the games analysed", ctx?.games_analysed === 2);
    ok("...and the deliveries", ctx?.deliveries_analysed === 90);
  }

  group("A player with no log is listed, and says so");
  {
    // A boy in the side nobody has logged is a fact the reader needs — "we
    // know nothing about their number seven" — not a row that quietly vanishes.
    const newBoy = (await q(`insert into player (school_id, team_code, full_name)
                             values ($1,'1XI','N Ntuli') returning id`, [WES]))[0].id;
    const s = rows(await squad(soon, coach));
    const nb = s.find((r) => r.player_id === newBoy);
    ok("he is on the list", !!nb);
    ok("...with the evidence labelled none", nb?.batting_evidence === "none" && nb?.bowling_evidence === "none");
    ok("...and no invented figure", nb?.strike_rate === null && nb?.economy === null && nb?.balls === 0);
  }

  group("Every read is written down, against the school that was read");
  {
    const coachId = (await q(`select id from app_user where email='coach@example.invalid'`))[0].id;
    const log = await q(`select school_id, record_ids, fields from access_log
                          where person_id = $1 and resource = 'opposition_squad'
                          order by occurred_at desc limit 1`, [coachId]);
    ok("the Hilton coach's read is in the log", log.length === 1);
    // Against WESTVILLE — the school whose children were read — so a parent
    // there asking "who has looked at my son" finds it in their school's log.
    ok("...filed against Westville, not Hilton", log[0]?.school_id === WES);
    ok("...naming the boys who were read", (log[0]?.record_ids ?? []).includes(MKHIZE));
    ok("...and what about them", (log[0]?.fields ?? []).includes("full_name"));

    await squad(soon, wesCoach);
    const wesId = (await q(`select id from app_user where email='coach.wes@example.invalid'`))[0].id;
    const log2 = await q(`select school_id, record_ids from access_log
                           where person_id = $1 and resource = 'opposition_squad'
                           order by occurred_at desc limit 1`, [wesId]);
    ok("the Westville coach's read is filed against Hilton", log2[0]?.school_id === HIL);
    ok("...naming Hilton's boys", (log2[0]?.record_ids ?? []).includes(hilBoy));
    // Nothing in the closed-window reads reached the log, because nothing was
    // disclosed.
    ok("a closed window logs no disclosure",
       (await q(`select count(*)::int c from access_log where resource='opposition_squad'
                  and record_count = 0`))[0].c === 0);
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`OPPOSITION SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

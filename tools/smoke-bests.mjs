#!/usr/bin/env node
/**
 * Personal bests (RECOGNITION R5, db/141), over HTTP: /api/read/personal_bests.
 *
 *   1. A BEST IS DERIVED FROM THE LOG, per class group, format and side: his
 *      highest innings and best bowling in VERIFIED matches. A friendly's
 *      figure is the Friendly group's, never the School Records one (D24);
 *      a match the scorer has not sealed is "awaiting verification" and no
 *      best; a tie keeps both dates.
 *   2. IT IS READ UNDER player.performance.read AT HIS SIDE (D1, D22): the
 *      boy, his guardian, his side's coach, the principal. Not the office,
 *      not a scorer, not another side's coach, not another boy's parent, not
 *      another school, not the signed-out public (A11). Never a file.
 *   3. A CORRECTION MOVES IT: a voided ball breaks the seal, the figure
 *      leaves the bests, and once sealed again it counts as corrected.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-bests.mjs
 *
 * The figures are written as the owner, as the scorer's pad would have
 * written them; every reader is a seeded account signed in through the API.
 * Names are the seed's and STEP4's invented ones.
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8850);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const SCORER = "88888888-0000-0000-0000-000000000006";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, 1XI

let pass = 0, fail = 0;
const ok = (n, c, detail = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, detail); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-bests-secret" },
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
  method: "POST", body: { email, deviceId: "device-bests" } })).body?.token;
const bests = async (tok, id = PILLAY) => {
  const r = await api(`/api/read/personal_bests?playerId=${id}`, { token: tok });
  return { status: r.status, rows: r.body?.rows ?? [] };
};
/** "metric/group/figure/opponent" for each best row, sorted. */
const lines = (rows) => rows.filter((r) => r.best).map((r) =>
  `${r.metric}/${r.class_group}/${r.metric === "batting" ? r.runs : `${r.wickets}-${r.runs_conceded}`}/${r.opponent}`).sort().join(" ");

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;

/** One event as the pad writes it; its idempotency key back. */
async function ev(m, inn, kind, { t = null, v = null, s = null, b = null, payload = {} } = {}) {
  const [{ seq }] = await q(`select coalesce(max(seq), 0) + 1 as seq from ball_event where match_id = $1`, [m]);
  const key = `bests:${m}:${seq}`;
  await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                   client_seq, client_ts, kind, ball_type, value, dismissal, striker_id, bowler_id, payload)
           values ($1, $2, $3, 1, $4, $5, 'walk-bests', $6, $3, now(), $7, $8, $9, $10, $11, $12, $13)`,
          [m, HIL, seq, inn, SCORER, key, kind, t, v, t === "W" ? "bowled" : null, s, b, payload]);
  return key;
}
/** The scorer's seal on an innings as the log stands now. */
async function seal(m, inn) {
  const [c] = await q(`select coalesce(sum(value), 0)::int runs, (count(*) filter (where ball_type = 'W'))::int wickets, count(*)::int balls
                         from ball_event_live where match_id = $1 and innings = $2 and kind = 'ball'`, [m, inn]);
  await ev(m, inn, "innings_end", { payload: { reason: "declared", confirmed: c } });
}
/** An innings: a list of runs off the bat ("W" a wicket), to striker s off bowler b. Its balls' keys. */
async function innings(m, inn, bat, bowl, balls, { s = null, b = null, sealed = true } = {}) {
  const squad = Array.from({ length: 11 }, (_, i) => ({ id: `bests-${i + 1}`, name: `Bests ${i + 1}` }));
  await ev(m, inn, "innings_start", { payload: { battingTeam: bat, bowlingTeam: bowl, squad, overs: 20 } });
  const keys = [];
  for (const x of balls) keys.push(await ev(m, inn, "ball", x === "W" ? { t: "W", v: 0, s, b } : { t: "run", v: x, s, b }));
  if (sealed) await seal(m, inn);
  return keys;
}
async function fixture(opponent, daysAgo, competition) {
  const [{ id }] = await q(
    `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status, competition_id)
     values ($1, '1XI', $2, now() - ($3 || ' days')::interval, 'cricket', 'T20', 20, 'complete', $4) returning id`,
    [HIL, opponent, String(daysAgo), competition]);
  await q(`insert into match_squad (match_id, player_id, side, batting_no) values ($1, $2, 'home', 1)`, [id, PILLAY]);
  return id;
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // His season: 63 v DHS and 3/18 v Kearsney in the league, 71 in a friendly,
  // and 90 in a league match the scorer has not sealed yet.
  const [{ id: league }] = await q(`insert into competition (school_id, name, comp_type, format, level)
                                    values ($1, 'Bests League', 'league', 'T20', 'school') returning id`, [HIL]);
  await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, '1XI', 'Hilton 1st XI')`, [league, HIL]);
  const sixtyThree = [6, 6, 6, 6, 6, 6, 6, 6, 6, 4, 4, 1];               // 63, its last ball a single
  const dhs = await fixture("DHS", 20, league);
  const dhsKeys = await innings(dhs, 0, "1XI", "DHS", sixtyThree, { s: PILLAY });
  const kearsney = await fixture("Kearsney", 13, league);
  await innings(kearsney, 0, "1XI", "Kearsney", [4, 4, 4], { s: PILLAY });
  await innings(kearsney, 1, "Kearsney", "1XI", ["W", 6, "W", 4, "W", 4, 4, 0], { b: PILLAY });
  const friendly = await fixture("Old Boys", 9, null);
  await innings(friendly, 0, "1XI", "Old Boys", [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 5], { s: PILLAY });   // 71
  const unsealed = await fixture("Maritzburg College", 2, league);
  await innings(unsealed, 0, "1XI", "Maritzburg College", Array(15).fill(6), { s: PILLAY, sealed: false });  // 90

  const self      = await login("pillay@example.invalid");
  const parent    = await login("parent@example.invalid");
  const coach     = await login("coach@example.invalid");        // 1XI
  const principal = await login("principal@example.invalid");
  const coach2    = await login("coach2@example.invalid");       // 2XI
  const registrar = await login("registrar@example.invalid");    // the office
  const scorer    = await login("scorer@example.invalid");
  const other     = await login("parent.whitfield@example.invalid");
  const wesCoach  = await login("coach.wes@example.invalid");
  const all = "batting/friendly/71/Old Boys batting/school_records/63/DHS bowling/school_records/3-18/Kearsney";

  group("A best is derived from the log, per class group");
  {
    const { status, rows } = await bests(self);
    ok("the boy reads his own bests", status === 200 && lines(rows) === all, lines(rows));
    ok("...his School Records best is 63, not the friendly's 71",
       rows.find((r) => r.best && r.metric === "batting" && r.class_group === "school_records")?.runs === 63);
    ok("...the friendly's 71 is the Friendly group's", rows.some((r) => r.best && r.class_group === "friendly" && r.runs === 71));
    const wait = rows.filter((r) => !r.verified);
    ok("...the unsealed 90 comes back awaiting verification, never best",
       wait.length === 1 && wait[0].runs === 90 && wait[0].best === false && wait[0].opponent === "Maritzburg College");
    ok("...each row names the side he played for and the format", rows.every((r) => r.side_code === "1XI" && r.format === "T20"));
    ok("...and a not-out is said, not hidden", rows.find((r) => r.opponent === "DHS")?.not_out === true);
    ok("...with the match's own date", rows.every((r) => /^\d{4}-\d{2}-\d{2}/.test(String(r.played_on))));
  }

  group("It is read under player.performance.read at his side");
  {
    for (const [who, tok] of [["his guardian", parent], ["his side's coach", coach], ["the principal", principal]]) {
      const { rows } = await bests(tok);
      ok(`${who} reads them`, lines(rows) === all, lines(rows));
    }
    for (const [who, tok] of [["the office", registrar], ["a scorer", scorer], ["the 2XI's coach", coach2],
                              ["another boy's parent", other], ["another school's coach", wesCoach]]) {
      const { status, rows } = await bests(tok);
      ok(`${who} reads none`, status === 200 && rows.length === 0, `${status} ${rows.length}`);
    }
    // The office reads his career figures, so the gate, not the log, is what held.
    const career = (await api("/api/read/career", { token: registrar })).body?.rows ?? [];
    ok("...though the office reads his runs in the career read", (career.find((r) => r.player_id === PILLAY)?.runs ?? 0) >= 63 + 12 + 71);
    ok("signed out, nothing", (await bests(undefined)).status === 401);
    ok("a read without a boy is refused", (await api("/api/read/personal_bests", { token: coach })).status === 400);
    const ex = await api("/api/export/personal_bests", { token: principal });
    ok("never a file", ex.status === 403, String(ex.status));
  }

  group("A tie keeps both dates");
  {
    const again = await fixture("Westville Boys' High", 6, league);
    await innings(again, 0, "1XI", "Westville Boys' High", sixtyThree, { s: PILLAY });
    const { rows } = await bests(self);
    const top = rows.filter((r) => r.best && r.metric === "batting" && r.class_group === "school_records");
    ok("63 and 63 are both his best, each on its own day",
       top.length === 2 && new Set(top.map((r) => String(r.played_on))).size === 2, JSON.stringify(top.map((r) => r.opponent)));
  }

  group("A correction moves it");
  {
    await ev(dhs, 0, "void", { payload: { target: dhsKeys[dhsKeys.length - 1] } });   // the single was a dot
    let { rows } = await bests(self);
    const dhsRow = rows.find((r) => r.opponent === "DHS");
    ok("the corrected innings is awaiting verification until the scorer seals again",
       dhsRow?.verified === false && dhsRow?.best === false && dhsRow?.runs === 62, JSON.stringify(dhsRow));
    ok("...and the other 63 is his best alone",
       rows.filter((r) => r.best && r.metric === "batting" && r.class_group === "school_records").map((r) => r.opponent).join() === "Westville Boys' High");
    await seal(dhs, 0);
    ({ rows } = await bests(self));
    ok("sealed again, the 62 is verified, and not his best",
       !rows.some((r) => r.opponent === "DHS"), JSON.stringify(rows.filter((r) => r.opponent === "DHS")));
  }

  if (serverErr.join("").match(/Error|error/)) console.log(serverErr.join("").slice(-1500));
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e?.stack ?? e);
  console.log(serverErr.join("").slice(-1500));
} finally {
  server.kill();
  await pool.end();
}
console.log(`\n${fail === 0 ? "✓" : "✗"} smoke-bests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * School record boards (RECOGNITION R9, db/143), over HTTP:
 * /api/read/record_boards and POST /api/record-minimums.
 *
 *   1. A BOARD IS DERIVED FROM THE LOG, per metric, class group and format,
 *      anchored on the side the performance was for: the holder, joint
 *      holders and former holders of VERIFIED matches with a result from
 *      play. A friendly's figure is the Friendly board's; an unsealed match
 *      awaits verification; a rate board is off until the school publishes
 *      a minimum.
 *   2. WHO READS IT (D22, D23): staff of the side the full board with this
 *      season's ordered list; a pupil of the side the chronology alone; his
 *      parent, the office, a scorer, another side's coach, another school,
 *      the platform's owner and the signed-out public nothing. Never a file.
 *   3. THE NOTICE (D25): when a match is finished and verified, a record it
 *      takes from an earlier one is noticed to the side — no recipient, read
 *      by the side, not by a scout.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-records.mjs
 *
 * The figures are written as the owner, as the scorer's pad would have
 * written them; every reader is a seeded account signed in through the API.
 * Names are the seed's and STEP4's invented ones.
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8839);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const SCORER = "88888888-0000-0000-0000-000000000006";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, 1XI

let pass = 0, fail = 0;
const ok = (n, c, detail = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, detail); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-records-secret" },
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
  method: "POST", body: { email, deviceId: "device-records" } })).body?.token;
const boards = async (tok, team = "1XI") => {
  const r = await api(`/api/read/record_boards?schoolId=${HIL}&teamCode=${team}`, { token: tok });
  return { status: r.status, rows: r.body?.rows ?? [] };
};
/** One board as "line:figure:name" lines, in the read's order. */
const board = (rows, metric = "highest_innings", grp = "school_records", fmt = "T20") => rows
  .filter((r) => r.metric === metric && r.class_group === grp && r.format === fmt)
  .map((r) => r.line === "board" ? `board:${r.state}`
    : `${r.line}${r.place ? "#" + r.place : ""}:${metric === "best_bowling" ? `${r.wickets}/${r.runs_conceded}` : `${r.runs}${r.not_out ? "*" : ""}`}:${r.player_name}`)
  .join(" ");

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;

/** One event as the pad writes it; its idempotency key back. */
async function ev(m, inn, kind, { t = null, v = null, s = null, b = null, payload = {} } = {}) {
  const [{ seq }] = await q(`select coalesce(max(seq), 0) + 1 as seq from ball_event where match_id = $1`, [m]);
  const key = `records:${m}:${seq}`;
  await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                   client_seq, client_ts, kind, ball_type, value, dismissal, striker_id, bowler_id, payload)
           values ($1, $2, $3, 1, $4, $5, 'walk-records', $6, $3, now(), $7, $8, $9, $10, $11, $12, $13)`,
          [m, HIL, seq, inn, SCORER, key, kind, t, v, t === "W" ? "bowled" : null, s, b, payload]);
  return key;
}
/** The scorer's seal on an innings as the log stands now. */
async function seal(m, inn, reason = "declared") {
  const [c] = await q(`select coalesce(sum(value), 0)::int runs, (count(*) filter (where ball_type = 'W'))::int wickets, count(*)::int balls
                         from ball_event_live where match_id = $1 and innings = $2 and kind = 'ball'`, [m, inn]);
  await ev(m, inn, "innings_end", { payload: { reason, confirmed: c } });
}
const squad = Array.from({ length: 11 }, (_, i) => ({ id: `records-${i + 1}`, name: `Records ${i + 1}` }));
/** A match of the 1XI: his innings (runs off the bat, "W" a wicket), then the visitors all out. */
async function match(opponent, daysAgo, competition, balls, striker, { sealed = true } = {}) {
  const [{ id }] = await q(
    `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status, competition_id)
     values ($1, '1XI', $2, now() - ($3 || ' days')::interval, 'cricket', 'T20', 20, 'live', $4) returning id`,
    [HIL, opponent, String(daysAgo), competition]);
  await ev(id, 0, "innings_start", { payload: { battingTeam: "1XI", bowlingTeam: opponent, squad, overs: 20 } });
  for (const x of balls) await ev(id, 0, "ball", x === "W" ? { t: "W", v: 0, s: striker } : { t: "run", v: x, s: striker });
  if (sealed) await seal(id, 0);
  await ev(id, 1, "innings_start", { payload: { battingTeam: opponent, bowlingTeam: "1XI", squad, overs: 20 } });
  for (let i = 0; i < 10; i++) await ev(id, 1, "ball", { t: "W", v: 0 });
  await seal(id, 1, "all_out");
  // Finished, as the scorer's finish sets it: the record notice fires here.
  await q(`update match set status = 'complete' where id = $1`, [id]);
  return id;
}
const sixes = (n, ...tail) => [...Array(n).fill(6), ...tail];

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const [{ id: league }] = await q(`insert into competition (school_id, name, comp_type, format, level)
                                    values ($1, 'Records League', 'league', 'T20', 'school') returning id`, [HIL]);
  await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, '1XI', 'Hilton 1st XI')`, [league, HIL]);
  const [{ id: naidoo }] = await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
                                    values ($1, '1XI', 'K Naidoo', 1439, 'batter', make_date(extract(year from now())::int - 17, 4, 1)) returning id`, [HIL]);

  // K Naidoo 71 v DHS; R Pillay 87* v Kearsney (the record taken); a friendly
  // 120 of Naidoo's; and Naidoo's 150 the scorer has not sealed.
  const dhs = await match("DHS", 30, league, sixes(11, 4, 1), naidoo);
  const kearsney = await match("Kearsney", 20, league, sixes(14, 3), PILLAY);
  const friendly = await match("Old Boys", 15, null, sixes(20), naidoo);
  await match("Maritzburg College", 5, league, sixes(25), naidoo, { sealed: false });

  const self      = await login("pillay@example.invalid");
  const mate      = await login("spectator@example.invalid");    // a `player` on the 1XI
  const parent    = await login("parent@example.invalid");
  const coach     = await login("coach@example.invalid");        // 1XI
  const principal = await login("principal@example.invalid");
  const director  = await login("sarah@example.invalid");
  const coach2    = await login("coach2@example.invalid");       // 2XI
  const registrar = await login("registrar@example.invalid");    // the office
  const scorer    = await login("scorer@example.invalid");
  const scout     = await login("analyst@example.invalid");      // the seed's scout
  const watcher   = await login("watcher@example.invalid");      // a spectator
  const wesCoach  = await login("coach.wes@example.invalid");
  const owner     = await login("owner@example.invalid");        // superadmin, platform-wide
  const HI = "board:standing holder:87*:R Pillay former:71*:K Naidoo";

  group("A board is derived from the log, anchored on the side");
  {
    const { status, rows } = await boards(coach);
    const got = board(rows).replace(/ season.*$/, "");
    ok("the 1XI's coach reads its highest innings: Pillay's 87* holds it, Naidoo's 71* before it", status === 200 && got === HI, got);
    ok("...the friendly's 120 is the Friendly board's, not School Records'",
       board(rows, "highest_innings", "friendly").startsWith("board:standing holder:120*:K Naidoo") && !got.includes("120"));
    ok("...the unsealed 150 is on no board, and is counted as awaiting",
       !rows.some((r) => r.runs === 150)
       && rows.find((r) => r.line === "board" && r.metric === "highest_innings" && r.class_group === "school_records")?.awaiting === 1);
    ok("...the coverage is the first counted match's",
       /^\d{4}-\d{2}-\d{2}/.test(String(rows.find((r) => r.line === "board")?.coverage_since)));
    ok("...rate boards are off until the school publishes a minimum",
       board(rows, "best_strike_rate") === "board:no_minimum" && board(rows, "best_economy") === "");
    ok("...and the 2XI's board holds none of it", (await boards(coach, "2XI")).rows.length === 0);
  }

  group("Who reads it: staff the full board, a pupil the chronology, a family nothing");
  {
    for (const [who, tok] of [["the 1XI's coach", coach], ["the principal", principal], ["the director of sport", director]]) {
      const { rows } = await boards(tok);
      ok(`${who} reads the full board, with this season's list`,
         rows[0]?.reader_view === "full" && rows.some((r) => r.line === "season"), `${rows[0]?.reader_view} ${rows.length}`);
    }
    for (const [who, tok] of [["the holder himself", self], ["a team-mate", mate]]) {
      const { rows } = await boards(tok);
      ok(`${who} reads the chronology: the holder and the former holder`, board(rows) === HI, board(rows));
      ok("...and never an ordered list of his side", rows.every((r) => r.reader_view === "chronology" && r.line !== "season"));
    }
    for (const [who, tok] of [["his parent", parent], ["the office", registrar], ["a scorer", scorer], ["the 2XI's coach", coach2],
                              ["a scout", scout], ["a spectator", watcher], ["Westville's coach", wesCoach], ["the platform's owner", owner]]) {
      const { status, rows } = await boards(tok);
      ok(`${who} reads no board`, status === 200 && rows.length === 0, `${status} ${rows.length}`);
    }
    ok("signed out, nothing", (await boards(undefined)).status === 401);
    ok("a read without a side is refused", (await api(`/api/read/record_boards?schoolId=${HIL}`, { token: coach })).status === 400);
    ok("...or with a side that is not one", (await api(`/api/read/record_boards?schoolId=${HIL}&teamCode=X';--`, { token: coach })).status === 400);
    const ex = await api("/api/export/record_boards", { token: principal });
    ok("never a file", ex.status === 403, String(ex.status));
  }

  group("A minimum switches a rate board on; the office may, a coach may not");
  {
    const set = (tok, minBalls, metric = "best_strike_rate") =>
      api("/api/record-minimums", { method: "POST", token: tok, body: { schoolId: HIL, metric, format: "T20", minBalls } });
    let r = await set(coach, 15);
    ok("a coach is refused", r.status === 403 && r.body?.error === "not_permitted", JSON.stringify(r));
    r = await set(owner, 15);
    ok("the platform's owner is refused (D7)", r.status === 403, JSON.stringify(r));
    r = await set(registrar, 15, "highest_innings");
    ok("a board with no minimum takes none", r.status === 400 && r.body?.error === "metric_has_no_minimum", JSON.stringify(r));
    r = await set(registrar, 15);
    ok("the office publishes fifteen balls", r.status === 200 && r.body?.minBalls === 15, JSON.stringify(r));
    let rows = (await boards(coach)).rows;
    ok("...the strike-rate board stands: Pillay's 87* off 15, the 71* off 13 too few balls",
       board(rows, "best_strike_rate").startsWith("board:standing holder:87*:R Pillay")
       && !board(rows, "best_strike_rate").includes("Naidoo"), board(rows, "best_strike_rate"));
    r = await set(registrar, null);
    rows = (await boards(coach)).rows;
    ok("...taken down, the board is off again", r.status === 200 && board(rows, "best_strike_rate") === "board:no_minimum");
  }

  group("A record is noticed to the side at verification");
  {
    const [n] = await q(`select title, scope_level, team_code, recipient_id, required_capability from notification
                          where subject_id = $1 and title like 'School record%'`, [kearsney]);
    ok("finishing the Kearsney match noticed the record to the 1XI",
       n?.title === "School record · Highest innings 1XI T20: 87* R Pillay" && n.scope_level === "team" && n.team_code === "1XI",
       JSON.stringify(n));
    ok("...to nobody alone", n && n.recipient_id === null);
    ok("...the first record (DHS) and the friendly's are not noticed",
       (await q(`select 1 from notification where subject_id = any($1) and title ~ '^(School|Friendly) record'`, [[dhs, friendly]])).length === 0);
    const reads = async (tok) => ((await api("/api/read/notifications", { token: tok })).body?.rows ?? [])
      .some((x) => /^School record/.test(x.title ?? ""));
    ok("the side reads it: the holder and his coach", await reads(self) && await reads(coach));
    ok("...a scout does not", !(await reads(scout)));
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
console.log(`\n${fail === 0 ? "✓" : "✗"} smoke-records: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

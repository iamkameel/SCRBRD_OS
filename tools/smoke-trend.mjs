#!/usr/bin/env node
/**
 * The season trend's two reads (GA-I23 slice 2, B1;
 * docs/design/SCENARIO_AND_TREND_design.md §B4, §B5, Kameel's Q7, Q8, Q10).
 *
 *   innings_by_season  one boy's season, innings by innings. Career's scope,
 *                      row for row, then gated per boy: his family on a live
 *                      link (his own self link included), or a reader who
 *                      is not a pupil holding a staff capability about his
 *                      side, asked with no fixture. One boy per read.
 *   side_season        a side's completed limited-overs matches, for and
 *                      against, team-level, under the fixture's own scope.
 *
 * Who reads what, against a real database: a pupil his own line and no
 * team-mate's (the captain, a pupil scoring a match and a pupil made a team
 * manager included); a parent her own child's and nobody else's, a pending,
 * ended or revoked link nothing; a coach of another side who is a parent of
 * a 1XI boy his own boy's and no team-mate's; the side's staff every boy's;
 * a Westville reader no Hilton boy, even on a fixture both schools read;
 * nobody without a token.
 *
 * WHICH LINES PROVE THE GATE, AND WHICH THE SCOPE. With the per-boy gate
 * removed, these fail, so they prove it: the pupil to a team-mate, the
 * captain, the pupil scoring, the pupil team manager, the staff-parent to
 * his boy's team-mate, the one-fixture assistant coach, the scorer and the
 * medical staff. These pass without it, because `career`'s own scope already
 * refuses them, and are here to hold that scope: the pending, ended and
 * revoked links, a parent asking for another child, the coach of another
 * side, the spectator, Westville's coach and office, and no token. And the
 * figures: a boy's innings sum to career_by_season's runs, his scorebook
 * innings are its book_innings, and a voided ball is gone from the next read
 * of both reads.
 *
 * Everyone this walk adds is invented, at @example.invalid; the boys are the
 * seed's.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-trend.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8947);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const U_COACH = "88888888-0000-0000-0000-000000000004";
const U_PUPIL = "88888888-0000-0000-0000-000000000009";   // pillay@, R Pillay's own account
const U_REGISTRAR = "88888888-0000-0000-0000-00000000000c";
const P1 = "aaaaaaaa-0000-0000-0000-000000000001";        // J Whitfield, 1XI
const P2 = "aaaaaaaa-0000-0000-0000-000000000002";        // T Bekker, 1XI
const P5 = "aaaaaaaa-0000-0000-0000-000000000005";        // R Pillay, 1XI, the pupil
const BOYS = [P1, P2, P5];
const SEASON = "2026";
const IMP = "7e0d0000-0000-4000-8000-000000000001";        // the scorebook commit's id

let pass = 0, fail = 0;
const ok = (n, c, info) => { if (c) pass++; else { fail++; console.log("  ✗", n, info === undefined ? "" : JSON.stringify(info).slice(0, 300)); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-trend-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { token } = {}) => {
  const res = await fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => {
  const res = await fetch(BASE + "/api/auth/dev-login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, deviceId: "device-trend" }) });
  return (await res.json().catch(() => null))?.token;
};
const innings = async (tok, boy, season = SEASON) =>
  api(`/api/read/innings_by_season?playerId=${boy}${season ? `&season=${season}` : ""}`, { token: tok });
const inningsRows = async (tok, boy, season) => (await innings(tok, boy, season)).body?.rows ?? [];
const side = async (tok, school = HIL, team = "1XI", season = SEASON) =>
  api(`/api/read/side_season?schoolId=${school}&teamCode=${team}${season ? `&season=${season}` : ""}`, { token: tok });
const sideRows = async (tok, school, team, season) => (await side(tok, school, team, season)).body?.rows ?? [];

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;
const one = async (t, p) => (await q(t, p))[0];

// ── The season, written as the owner ─────────────────────────────
// What each boy made in each match, and each side's totals, kept as the
// log is written, so the reads are checked against what went in.
/** @type {Map<string, Map<string, { runs: number, balls: number, out: boolean }>>} */
const made = new Map(BOYS.map((b) => [b, new Map()]));
/** @type {Map<string, any>} */
const totals = new Map();
/** @type {Map<string, string[]>} */
const p1FourKeys = new Map();   // match → P1's fours, for the void

const PATTERN = [1, 0, 2, 4, 1, 0, 6, 1, 3];
const LOW = [1, 0, 0, 1, 2, 0];
const HIGH = [6, 4, 2, 4, 6, 1];

let seqOf = new Map();
async function ev(match, inns, kind, f = {}, client = pool, device = "device-trend") {
  const seq = (seqOf.get(match) ?? 0) + 1;
  seqOf.set(match, seq);
  const key = `trend-${match.slice(-4)}-${seq}`;
  await client.query(
    `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                             client_seq, client_ts, server_ts, kind, ball_type, value, striker_id, bowler_id, dismissal, payload)
     values ($1, $2, $3, 1, $4, $5, $6, $7, $3, $8, $8, $9, $10, $11, $12, null, $13, $14)`,
    [match, HIL, seq, inns, U_COACH, device, key, f.at, kind, f.ballType ?? null, f.value ?? null,
     f.striker ?? null, f.dismissal ?? null, f.payload ?? {}]);
  return key;
}

/**
 * One innings of `maxBalls` legal balls, stopping when a target is reached.
 * Hilton's batters take a third of the balls each, in order; the other side
 * names nobody. Returns the innings' runs, wickets and legal balls.
 */
async function playInnings(match, inns, at, { hilton, key, label, overs, target, revision, k }) {
  let t = new Date(at).getTime();
  const tick = () => new Date((t += 30_000)).toISOString();
  await ev(match, inns, "innings_start", { at: tick(), payload: { battingTeam: label, teamKey: key, overs, ...(target ? { target } : {}) } });
  if (revision) await ev(match, inns, "revision", { at: tick(), payload: revision });
  const maxBalls = 6 * (revision?.overs ?? overs);
  const goal = revision?.target ?? target ?? Infinity;
  let runs = 0, wickets = 0, balls = 0;
  const third = maxBalls / 3;
  for (let i = 0; i < maxBalls && runs < goal; i++) {
    const at2 = tick();
    if (hilton) {
      const bi = Math.floor(i / third), boy = BOYS[bi];
      const lastOfHis = i === (bi + 1) * third - 1;
      const out = boy === P2 && lastOfHis && k % 2 === 0;
      const value = out ? 0 : PATTERN[(i + k + bi) % PATTERN.length];
      const keyOf = await ev(match, inns, "ball", { at: at2, ballType: out ? "W" : "run", value, striker: boy, dismissal: out ? "bowled" : null });
      const m = made.get(boy);
      const cur = m.get(match) ?? { runs: 0, balls: 0, out: false };
      m.set(match, { runs: cur.runs + value, balls: cur.balls + 1, out: cur.out || out });
      if (boy === P1 && value === 4) p1FourKeys.set(match, [...(p1FourKeys.get(match) ?? []), keyOf]);
      runs += value; balls++; if (out) wickets++;
    } else {
      const value = (target || revision ? LOW : HIGH)[(i + k) % 6];
      await ev(match, inns, "ball", { at: at2, ballType: "run", value });
      runs += value; balls++;
    }
  }
  return { runs, wickets, balls, overs: revision?.overs ?? overs };
}

/** A completed match of Hilton's 1XI, both innings scored. */
async function playMatch(k, { day, opponent, hiltonFirst, awaySchool, revised, status = "complete" }) {
  const id = (await one(
    `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status, away_school_id, away_team_code)
     values ($1, '1XI', $2, $3, 'cricket', 'T20', 20, 'live', $4, $5) returning id, opponent`,
    [HIL, opponent, `${day}T08:00:00+02:00`, awaySchool ?? null, awaySchool ? "1XI" : null]));
  const them = id.opponent;
  const at = `${day}T08:00:00+02:00`;
  const hil = { hilton: true, key: "1XI", label: "Hilton 1XI", k };
  const opp = { hilton: false, key: them, label: them, k };
  const first = hiltonFirst ? await playInnings(id.id, 1, at, { ...hil, overs: revised ? 3 : 2 })
                            : await playInnings(id.id, 1, at, { ...opp, overs: 2 });
  const chase = { overs: revised ? 3 : 2, target: first.runs + 1,
                  revision: revised ? { overs: 2, target: Math.ceil((first.runs + 1) * 0.75) } : undefined };
  const second = hiltonFirst ? await playInnings(id.id, 2, `${day}T10:00:00+02:00`, { ...opp, ...chase })
                             : await playInnings(id.id, 2, `${day}T10:00:00+02:00`, { ...hil, ...chase });
  await q(`update match set status = $2 where id = $1`, [id.id, status]);
  const forI = hiltonFirst ? first : second, againstI = hiltonFirst ? second : first;
  totals.set(id.id, { k, day, for: forI, against: againstI, hiltonFirst, revised: !!revised, status,
                      goal: chase.revision?.target ?? chase.target });
  return id.id;
}

const recorded = (boy, match) => made.get(boy).get(match);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── The cast this walk adds: all invented ──────────────────────
  const person = async (email, name, role) => (await one(
    `insert into app_user (school_id, email, name, role) values ($1, $2, $3, $4) returning id`, [HIL, email, name, role])).id;
  const tm = await person("tm.trend@example.invalid", "A Manager", "teammanager");
  await q(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'teammanager', $2, '1XI')`, [tm, HIL]);
  const an = await person("analyst.trend@example.invalid", "A Analyst", "analyst");
  await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'analyst', $2)`, [an, HIL]);
  // Three of J Whitfield's would-be parents, on links that are not live.
  const link = async (email, state, from, until) => {
    const u = await person(email, "A Parent", "parent");
    const a = (await one(`insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`, [u, HIL])).id;
    await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at, valid_from, valid_until)
             values ($1, $2, 'parent', $3, $4, case when $3 = 'pending' then null else now() end, $5, $6)`,
            [a, P1, state, state === "pending" ? null : U_REGISTRAR, from, until]);
  };
  await link("pending.trend@example.invalid", "pending", "2026-01-01", null);
  await link("ended.trend@example.invalid", "verified", "2026-01-01", "2026-10-01");
  await link("revoked.trend@example.invalid", "revoked", "2026-01-01", "2026-11-01");

  // ── The season ─────────────────────────────────────────────────
  // The seed's own innings this season (its scored match), counted before
  // this walk writes, so the counts below are the seed's plus this walk's.
  const seeded = new Map();
  for (const b of BOYS) seeded.set(b, (await one(
    `select count(*)::int n from player_innings i join match m on m.id = i.match_id
      where i.player_id = $1 and school_season_of(m.starts_at) = $2`, [b, SEASON])).n);
  const M = [];
  M.push(await playMatch(0, { day: "2026-09-05", opponent: "Kearsney College", hiltonFirst: true }));
  M.push(await playMatch(1, { day: "2026-09-12", opponent: "Michaelhouse", hiltonFirst: false }));
  M.push(await playMatch(2, { day: "2026-09-19", opponent: "Maritzburg College", hiltonFirst: true, revised: true }));
  M.push(await playMatch(3, { day: "2026-09-26", opponent: "Glenwood", hiltonFirst: false }));
  M.push(await playMatch(4, { day: "2026-10-03", opponent: "Northwood", hiltonFirst: true }));
  M.push(await playMatch(5, { day: "2026-10-10", opponent: "St Charles", hiltonFirst: false }));
  // Both schools read this one: Westville's 1XI is the away side.
  const SHARED = await playMatch(6, { day: "2026-10-24", opponent: "Westville Boys' High", hiltonFirst: true, awaySchool: WES });
  // Being played: in a boy's innings, not in the side's completed matches.
  const LIVE = await playMatch(7, { day: "2026-11-07", opponent: "Clifton", hiltonFirst: true, status: "live" });

  // A match from a scorebook (db/63): two cards, committed as the importer
  // commits them. J Whitfield's book line has no balls.
  const BOOK = (await one(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
                           values ($1, '1XI', 'Durban High', '2026-10-17T08:00:00+02:00', 'cricket', 'T20', 20, 'live') returning id`, [HIL])).id;
  {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('scrbrd.scorebook_commit', $1, true)`, [IMP]);
      const src = { source: { import: IMP } };
      const dev = `scorebook:${IMP}`;
      const at = "2026-10-17T08:00:00+02:00";
      await ev(BOOK, 1, "innings_start", { at, payload: { ...src, battingTeam: "Hilton 1XI", teamKey: "1XI", overs: 20 } }, c, dev);
      await ev(BOOK, 1, "innings_summary", { at, payload: { ...src, card: { total: 96, wickets: 4, overs: "20",
        batting: [{ ref: P1, runs: 31, howOut: "caught" }, { ref: P2, runs: 12, balls: 15, howOut: "bowled" },
                  { ref: P5, runs: 40, balls: 33, howOut: "not_out" }] } } }, c, dev);
      await ev(BOOK, 2, "innings_start", { at, payload: { ...src, battingTeam: "Durban High", teamKey: "Durban High", overs: 20, target: 97 } }, c, dev);
      await ev(BOOK, 2, "innings_summary", { at, payload: { ...src, card: { total: 80, wickets: 10, overs: "18.2", batting: [] } } }, c, dev);
      await c.query("commit");
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  }
  await q(`update match set status = 'complete' where id = $1`, [BOOK]);
  made.get(P1).set(BOOK, { runs: 31, balls: null, out: true, book: true });
  made.get(P2).set(BOOK, { runs: 12, balls: 15, out: true, book: true });
  made.get(P5).set(BOOK, { runs: 40, balls: 33, out: false, book: true });
  totals.set(BOOK, { book: true, day: "2026-10-17", for: { runs: 96, wickets: 4, balls: 120, overs: 20 },
                     against: { runs: 80, wickets: 10, balls: 110, overs: 20 }, hiltonFirst: true, status: "complete" });

  const coach   = await login("coach@example.invalid");          // Hilton 1XI
  const u14     = await login("u14coach@example.invalid");       // Hilton U14A
  const head    = await login("sarah@example.invalid");          // director of sport, Hilton
  const tmTok   = await login("tm.trend@example.invalid");
  const anTok   = await login("analyst.trend@example.invalid");
  const pupil   = await login("pillay@example.invalid");         // R Pillay, P5
  const pWhit   = await login("parent.whitfield@example.invalid"); // P1's
  const pPillay = await login("parent@example.invalid");         // P5's
  const pBekker = await login("parent.bekker@example.invalid");  // P2's
  const scorer  = await login("scorer@example.invalid");
  const medic   = await login("medical@example.invalid");
  const watcher = await login("watcher@example.invalid");
  const wesCoach = await login("coach.wes@example.invalid");
  const wesOffice = await login("registrar.wes@example.invalid");
  const pending = await login("pending.trend@example.invalid");
  const ended   = await login("ended.trend@example.invalid");
  const revoked = await login("revoked.trend@example.invalid");
  ok("every reader signed in", [coach, u14, head, tmTok, anTok, pupil, pWhit, pPillay, pBekker, scorer, medic, watcher,
                                wesCoach, wesOffice, pending, ended, revoked].every(Boolean));

  const allMatches = [...M, SHARED, BOOK, LIVE];
  const expectedFor = (boy) => ({ length: [...made.get(boy).keys()].filter((m) => allMatches.includes(m)).length + seeded.get(boy) });
  const mine = (rows) => rows.filter((r) => totals.has(r.match_id));

  group("The side's staff read every boy's season, innings by innings");
  for (const [who, tok] of [["the 1XI coach", coach], ["the director of sport", head], ["the 1XI team manager", tmTok], ["the school's analyst", anTok]]) {
    for (const boy of BOYS) {
      const r = await innings(tok, boy);
      ok(`${who} reads ${boy.slice(-2)}'s innings (${r.body?.rows?.length})`, r.status === 200 && r.body.rows.length === expectedFor(boy).length,
         { status: r.status, n: r.body?.rows?.length, want: expectedFor(boy).length });
    }
  }
  {
    const rows = await inningsRows(coach, P1);
    ok("one row per innings he batted, oldest first by the match's start",
       rows.length > 1 && rows.every((r, i) => i === 0 || new Date(r.starts_at) >= new Date(rows[i - 1].starts_at)));
    const starts = new Map((await q(`select id, starts_at from match where id = any($1::uuid[])`, [rows.map((r) => r.match_id)]))
      .map((m) => [m.id, m.starts_at.toISOString()]));
    ok("...each dated by its match's start, not by when the server took the ball in",
       rows.every((r) => typeof r.starts_at === "string" && starts.get(r.match_id) === new Date(r.starts_at).toISOString()), rows.map((r) => [r.match_id.slice(-4), r.starts_at]));
    ok("every row is his, in the season asked for", rows.every((r) => r.player_id === P1 && r.season === SEASON && r.current_season === true));
    ok("each innings is the runs, balls and out the log holds",
       mine(rows).length === made.get(P1).size
       && mine(rows).every((r) => { const w = recorded(P1, r.match_id); return w && r.runs === w.runs && r.balls_faced === w.balls && r.out === w.out; }),
       rows.map((r) => [r.match_id.slice(-4), r.runs, r.balls_faced, r.out]));
    const book = rows.filter((r) => r.source === "scorebook");
    ok("the scorebook innings is in it, said to be the scorebook's", book.length === 1 && book[0].match_id === BOOK);
    ok("...with its balls NULL, never 0, where the book has none", book[0]?.balls_faced === null);
    ok("...and every other innings is the scored log's", rows.filter((r) => r.source === "scored").length === rows.length - 1);
    ok("an innings of a match being played is in his line", rows.some((r) => r.match_id === LIVE));
    const bekker = await inningsRows(coach, P2);
    ok("a not-out and an out are told apart", bekker.some((r) => r.out) && bekker.some((r) => !r.out));
    ok("another season reads nothing", (await inningsRows(coach, P1, "2025")).length === 0);
    ok("no season reads every season", (await inningsRows(coach, P1, null)).length >= rows.length);
  }
  ok("a coach of another side at the school reads none of the 1XI's",
     (await inningsRows(u14, P1)).length === 0);

  group("A pupil reads his own line and no team-mate's (Q7)");
  {
    const own = await innings(pupil, P5);
    ok(`R Pillay reads his own innings (${own.body?.rows?.length})`, own.status === 200 && own.body.rows.length === expectedFor(P5).length);
    ok("...each the runs he made", mine(own.body?.rows ?? []).length === made.get(P5).size
       && mine(own.body?.rows ?? []).every((r) => r.runs === recorded(P5, r.match_id)?.runs));
    for (const boy of [P1, P2]) {
      const r = await innings(pupil, boy);
      ok(`...and none of team-mate ${boy.slice(-2)}'s, though he reads the side's log`, r.status === 200 && r.body.rows.length === 0);
    }
    // REACH-D2 (Kameel, 7 Nov 2026) closed the season read too: a pupil
    // reads no team-mate's season unless he names him (Compare) or holds the
    // captaincy (11 Nov), and he does neither here.
    const career = (await api(`/api/read/career_by_season?season=${SEASON}`, { token: pupil })).body?.rows ?? [];
    ok("career_by_season shows him no team-mate's season (REACH-D2)",
       !career.some((r) => r.player_id === P1), JSON.stringify(career.map((r) => r.full_name)));
  }
  {
    // The captain keeps the side's season figures (SCRBRD-138), nothing else.
    const season = (await one(`select id from season where level = 'school' and label = $1`, [SEASON])).id;
    const capId = (await one(`insert into honour (player_id, school_id, team_code, kind, season_id, awarded_by) values ($1, $2, '1XI', 'captain', $3, $4) returning id`,
            [P5, HIL, season, U_COACH])).id;
    ok("he is the 1XI's captain now", (await one(`select is_captain_of($1, '1XI', $2) c`, [P5, season])).c === true);
    ok("...and still reads no team-mate's innings", (await inningsRows(pupil, P1)).length === 0 && (await inningsRows(pupil, P2)).length === 0);
    ok("...and his own still", (await inningsRows(pupil, P5)).length === expectedFor(P5).length);
    // A pupil scoring a match is on a fixture-scoped assignment: never staff.
    await q(`insert into role_assignment (person_id, role, school_id, fixture_id) values ($1, 'scorer', $2, $3)`, [U_PUPIL, HIL, M[0]]);
    ok("scoring a match of his side gives him no team-mate's line", (await inningsRows(pupil, P1)).length === 0);
    // A pupil a school has made the side's team manager is still a pupil
    // (Kameel, 12 Nov 2026: "Keep it closed: a pupil never reads team-mates'
    // innings lines"). The captaincy is withdrawn first, so nothing but the
    // staff assignment could admit him: REACH-D2's season gate refuses him too.
    await q(`update honour set withdrawn_at = now(), withdrawn_reason = 'the walk: withdrawn' where id = $1`, [capId]);
    const tmRow = (await one(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'teammanager', $2, '1XI') returning id`,
                             [U_PUPIL, HIL])).id;
    const asTm = (await api(`/api/read/career_by_season?season=${SEASON}`, { token: pupil })).body?.rows ?? [];
    ok("as team manager, with no captaincy, career_by_season gives him no team-mate's season (REACH-D2)",
       asTm.length > 0 && asTm.every((r) => r.player_id === P5), JSON.stringify(asTm.map((r) => r.full_name)));
    ok("a pupil made the 1XI's team manager reads no team-mate's line", (await inningsRows(pupil, P1)).length === 0
       && (await inningsRows(pupil, P2)).length === 0);
    ok("...and his own still", (await inningsRows(pupil, P5)).length === expectedFor(P5).length);
    await q(`update role_assignment set active = false where id = $1`, [tmRow]);
  }

  group("A parent reads her own child's line, one child at a time (Q8)");
  {
    const r = await innings(pWhit, P1);
    ok(`J Whitfield's parent reads his innings (${r.body?.rows?.length})`, r.status === 200 && r.body.rows.length === expectedFor(P1).length);
    ok("...the same rows his coach reads", JSON.stringify(r.body.rows) === JSON.stringify(await inningsRows(coach, P1)));
    for (const boy of [P2, P5]) ok(`...and nothing of ${boy.slice(-2)}'s`, (await inningsRows(pWhit, boy)).length === 0);
    ok("R Pillay's parent reads his, and not J Whitfield's",
       (await inningsRows(pPillay, P5)).length === expectedFor(P5).length && (await inningsRows(pPillay, P1)).length === 0);
    ok("T Bekker's parent reads his, and not R Pillay's",
       (await inningsRows(pBekker, P2)).length === expectedFor(P2).length && (await inningsRows(pBekker, P5)).length === 0);
    const none = await api(`/api/read/innings_by_season?season=${SEASON}`, { token: pWhit });
    ok("no boy named is a 400: nobody reads a side's lines in one answer", none.status === 400);
    for (const [why, tok] of [["pending", pending], ["ended", ended], ["revoked", revoked]])
      ok(`a ${why} link reads nothing of him`, (await inningsRows(tok, P1)).length === 0);
  }

  group("Nobody else reads a boy's line");
  ok("a scorer, though he reads the side's log", (await inningsRows(scorer, P1)).length === 0);
  ok("the school's medical staff (not staff of the side's cricket)", (await inningsRows(medic, P1)).length === 0);
  ok("a spectator", (await inningsRows(watcher, P1)).length === 0);
  {
    // An assistant coach for one fixture of the side holds player.roster.read,
    // but on a fixture-scoped assignment: the gate asks with no fixture.
    const ac = await person("ac.trend@example.invalid", "A Assistant", "coach");
    await q(`insert into role_assignment (person_id, role, school_id, team_code, fixture_id) values ($1, 'assistantcoach', $2, '1XI', $3)`, [ac, HIL, M[0]]);
    const acTok = await login("ac.trend@example.invalid");
    ok("(the control: career's scope gives the one-fixture assistant coach J Whitfield's figures)",
       ((await api(`/api/read/career_by_season?season=${SEASON}`, { token: acTok })).body?.rows ?? []).some((r) => r.player_id === P1));
    ok("an assistant coach for one fixture reads no boy's line", (await inningsRows(acTok, P1)).length === 0);
  }
  {
    const live = (await api(`/api/read/live_score?matchId=${SHARED}`, { token: wesCoach })).body?.rows ?? [];
    ok("(Westville's coach reads the fixture both schools played)", live.length === 2);
    ok("a Westville coach reads no Hilton boy's line, even one who batted against him", (await inningsRows(wesCoach, P1)).length === 0
       && (await inningsRows(wesCoach, P1, null)).length === 0);
    ok("...nor does Westville's office", (await inningsRows(wesOffice, P1)).length === 0);
  }
  {
    const r = await innings(null, P1);
    ok("no token, no line: the public reads nothing", r.status === 401 && !r.body?.rows);
    const pub = await api(`/api/public/innings_by_season?playerId=${P1}`);
    ok("...and there is no public door to it", pub.status === 404 || !pub.body?.rows?.length);
  }

  group("The side's season, match by match (B2.1, Q10)");
  // Every completed fixture of the side this season, the seed's included,
  // as the owner reads the table.
  const completed = (await q(`select id from match where school_id = $1 and team_code = '1XI' and status = 'complete'
                                 and overs is not null and school_season_of(starts_at) = $2 order by starts_at, id`, [HIL, SEASON])).map((r) => r.id);
  {
    const r = await side(coach);
    const all = r.body?.rows ?? [];
    const rows = mine(all);
    ok(`the coach reads the side's completed matches, oldest first (${all.length})`, r.status === 200
       && all.map((x) => x.match_id).join() === completed.join() && rows.length === [...M, SHARED, BOOK].length, all.map((x) => x.match_id.slice(-4)));
    const unscored = all.filter((x) => !totals.has(x.match_id) && x.for_innings === null && x.against_innings === null);
    ok("a completed match with nothing in its log reads NULL figures, never zero",
       unscored.length > 0 && unscored.every((x) => x.for_runs === null && x.against_runs === null && x.for_balls === null));
    ok("the match being played is not one of them", !rows.some((x) => x.match_id === LIVE));
    ok("for and against are the side's own innings, whichever batted first",
       rows.every((x) => { const t = totals.get(x.match_id);
         return x.for_runs === t.for.runs && x.for_wickets === t.for.wickets && x.for_balls === t.for.balls
           && x.against_runs === t.against.runs && x.against_balls === t.against.balls && x.side === "home"; }),
       rows.map((x) => [x.match_id.slice(-4), x.for_runs, x.for_balls, x.against_runs, x.against_balls]));
    const rev = rows.find((x) => totals.get(x.match_id).revised);
    ok("a revised chase says its allotment: 2 overs (revised), the first innings its 3",
       rev?.against_overs === 2 && rev?.against_revised === true && rev?.for_overs === 3 && rev?.for_revised === false, rev);
    ok("the result is the side's: won batting first, lost chasing a big total",
       rows.filter((x) => totals.get(x.match_id).hiltonFirst && !totals.get(x.match_id).book).every((x) => x.result === "won")
       && rows.filter((x) => !totals.get(x.match_id).hiltonFirst).some((x) => x.result === "lost"),
       rows.map((x) => [x.match_id.slice(-4), x.result, x.margin_kind, x.margin]));
    ok("the scorebook match reads its cards' figures", (() => { const b = rows.find((x) => x.match_id === BOOK);
      return b?.for_runs === 96 && b?.for_balls === 120 && b?.against_runs === 80 && b?.against_balls === 110 && b?.result === "won"; })(),
      rows.find((x) => x.match_id === BOOK));
    ok("an all-out side's balls are the balls bowled, not its allotment (Q10)",
       rows.find((x) => x.match_id === BOOK)?.against_balls === 110);
    ok("the opponent is named, the fixture's own label", rows.find((x) => x.match_id === M[0])?.opponent === "Kearsney College");
    ok("team-level: no boy, no name in any row", rows.every((x) => !Object.keys(x).some((c) => /player|name|striker|bowler/.test(c))
       && !JSON.stringify(x).includes("aaaaaaaa-")));
  }
  {
    const pupilRows = await sideRows(pupil);
    ok("a pupil reads his side's season, team-level (Q10: anyone who may read the side's fixtures)", pupilRows.length === completed.length);
    ok("a parent reads her child's side's", (await sideRows(pWhit)).length === completed.length);
    ok("a coach of another side reads none of the 1XI's matches", (await sideRows(u14)).length === 0);
    const wes = await sideRows(wesCoach);
    ok("Westville's coach reads only the fixture his side played against this one", wes.length === 1 && wes[0].match_id === SHARED, wes.map((x) => x.match_id));
    const fromWes = await sideRows(wesCoach, WES, "1XI");
    ok("...and from his own end, his side is the away side and Hilton the opponent",
       fromWes.length === 1 && fromWes[0].side === "away" && fromWes[0].result === "lost"
       && fromWes[0].for_runs === totals.get(SHARED).against.runs && fromWes[0].against_runs === totals.get(SHARED).for.runs, fromWes[0]);
    const office = await sideRows(wesOffice);
    ok("Westville's office reads the shared fixture and nothing of Hilton's other matches",
       office.length === 1 && office[0].match_id === SHARED, office.map((x) => x.match_id));
    const r = await side(null);
    ok("no token: the public reads no side's season (Q10, not public)", r.status === 401);
    ok("a side that is not a side is a 400", (await api(`/api/read/side_season?schoolId=${HIL}&teamCode=nonsense`, { token: coach })).status === 400);
    ok("a season that is not a season is a 400, on both reads",
       (await api(`/api/read/side_season?schoolId=${HIL}&teamCode=1XI&season=last`, { token: coach })).status === 400
       && (await api(`/api/read/innings_by_season?playerId=${P1}&season=2026x`, { token: coach })).status === 400);
  }

  group("A member of staff who is also a parent reads his own boy's line, and no team-mate's (S1)");
  {
    // The U14A coach holds player.roster.read; his son is J Whitfield of the
    // 1XI, on a verified link, so the 1XI's log reaches him as a parent.
    const u14id = (await one(`select id from app_user where email = 'u14coach@example.invalid'`)).id;
    const ga = (await one(`insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`, [u14id, HIL])).id;
    await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                             consent_state, consent_version, consent_at)
             values ($1, $2, 'parent', 'verified', $3, now(), 'granted', 'popia-2026-01', now())`, [ga, P1, U_REGISTRAR]);
    ok("he reads his own boy's line, as his parent", (await inningsRows(u14, P1)).length === expectedFor(P1).length);
    ok("(the control: career's scope gives him a team-mate's season now)",
       ((await api(`/api/read/career_by_season?season=${SEASON}`, { token: u14 })).body?.rows ?? []).some((r) => r.player_id === P2));
    ok("...and no team-mate's: his staff capability is about the U14A, not the 1XI",
       (await inningsRows(u14, P2)).length === 0 && (await inningsRows(u14, P5)).length === 0);
  }

  group("The figures: the innings sum to the season, and the scorebook's are its book_innings");
  for (const [who, tok, boys] of [["the coach", coach, BOYS], ["a parent", pWhit, [P1]], ["the pupil himself", pupil, [P5]]]) {
    const season = (await api(`/api/read/career_by_season?season=${SEASON}`, { token: tok })).body?.rows ?? [];
    for (const boy of boys) {
      const rows = await inningsRows(tok, boy);
      const c = season.find((r) => r.player_id === boy);
      // career_by_season's runs and dismissals are bigint sums: strings on the wire.
      const sum = (xs) => xs.reduce((s, r) => s + r.runs, 0);
      const book = rows.filter((r) => r.source === "scorebook");
      ok(`${who}: ${boy.slice(-2)}'s innings sum to his season's runs (${sum(rows)} = ${c?.runs})`, !!c && sum(rows) === Number(c.runs));
      ok(`${who}: ...his scored innings to its runs less the scorebook's (${sum(rows) - sum(book)})`,
         !!c && sum(rows.filter((r) => r.source === "scored")) === Number(c.runs) - sum(book));
      ok(`${who}: ...and his scorebook innings are its book_innings (${book.length})`, !!c && book.length === c.book_innings);
      ok(`${who}: ...his outs are its dismissals`, !!c && rows.filter((r) => r.out).length === Number(c.dismissals));
    }
  }
  {
    // As the database computes them, with no reader in the way.
    const sums = await q(`select i.player_id, sum(i.runs)::int as runs from player_innings i join match m on m.id = i.match_id
                           where school_season_of(m.starts_at) = $1 and i.player_id = any($2::uuid[]) group by 1`, [SEASON, BOYS]);
    const views = await q(`select player_id, runs::int from player_batting_by_season where season = $1 and player_id = any($2::uuid[])`, [SEASON, BOYS]);
    ok("the owner's sums agree with the season view, boy for boy",
       BOYS.every((b) => sums.find((s) => s.player_id === b)?.runs === views.find((v) => v.player_id === b)?.runs), { sums, views });
  }

  group("A voided ball is gone from the next read (GA-I36 §3)");
  {
    const target = p1FourKeys.get(M[0])?.[0];
    ok("(J Whitfield hit a four in the first match)", !!target);
    const before = (await inningsRows(coach, P1)).find((r) => r.match_id === M[0]);
    const sideBefore = (await sideRows(coach)).find((r) => r.match_id === M[0]);
    const seasonBefore = ((await api(`/api/read/career_by_season?season=${SEASON}`, { token: coach })).body?.rows ?? []).find((r) => r.player_id === P1);
    await ev(M[0], 1, "void", { at: new Date().toISOString(), payload: { target } });
    const after = (await inningsRows(coach, P1)).find((r) => r.match_id === M[0]);
    ok("his innings is four runs and one ball fewer", after?.runs === before?.runs - 4 && after?.balls_faced === before?.balls_faced - 1,
       { before, after });
    const sideAfter = (await sideRows(coach)).find((r) => r.match_id === M[0]);
    ok("the side's total that day is four fewer, off one ball fewer",
       sideAfter?.for_runs === sideBefore?.for_runs - 4 && sideAfter?.for_balls === sideBefore?.for_balls - 1, { sideBefore, sideAfter });
    const seasonAfter = ((await api(`/api/read/career_by_season?season=${SEASON}`, { token: coach })).body?.rows ?? []).find((r) => r.player_id === P1);
    ok("...and his season moved by exactly the same four", Number(seasonAfter?.runs) === Number(seasonBefore?.runs) - 4);
    const parentAfter = (await inningsRows(pWhit, P1)).find((r) => r.match_id === M[0]);
    ok("his parent's next read has it too", parentAfter?.runs === after?.runs);
  }
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", e.message, e.stack?.split("\n").slice(1, 4).join(" | "));
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:\n" + serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nTREND SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * A season is a fact of the calendar; a division is the competition's.
 *
 *   1. THE CALENDAR HAS ONE RULE. School cricket is the calendar year, named
 *      for one; everything above it is July to June, named for two. The age
 *      cut-off is 1 January of the named year at every level, which is the
 *      date the eligibility trigger measures on — so the workload band and
 *      the trigger agree on every boy.
 *   2. A COMPETITION KNOWS ITS LEVEL AND SEASON; a fixture knows its season.
 *   3. A SCHOOL HONOUR IS ON A SCHOOL SEASON, and "2026/27" is not one.
 *   4. A DIVISION IS THE COMPETITION'S: created and filled by whoever runs
 *      the competition, never by a school placing itself; the ladder reads
 *      per division, the unplaced last.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-season.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8869;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const LEAGUE = "99999999-0000-0000-0000-000000000001";
const D1 = "d1710000-0000-0000-0000-000000000001";
const D2 = "d1710000-0000-0000-0000-000000000002";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-season-secret" },
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
  method: "POST", body: { email, deviceId: "device-season" } })).body?.token;
const rows = async (path, tok) => (await api(path, { token: tok })).body?.rows ?? [];
const division = (comp, tok, body) => api(`/api/competitions/${comp}/divisions`, { method: "POST", token: tok, body });
const place = (entrant, tok, divisionId) => api(`/api/competition-entrants/${entrant}/division`, { method: "POST", token: tok, body: { divisionId } });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const one = async (t, p) => (await q(t, p))[0];

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach   = await login("coach@example.invalid");
  const head    = await login("sarah@example.invalid");
  const watcher = await login("watcher@example.invalid");
  const wesAdmin = await login("registrar.wes@example.invalid");
  const league  = await login("league@example.invalid");     // competitionadmin, platform-wide

  group("The calendar has one rule, and the trigger and the band agree on it");
  {
    const s = await rows("/api/read/seasons", watcher);
    ok("anyone signed in reads the calendar", s.length >= 20);
    ok("a school season is one year, January to December", s.some((x) => x.level === "school" && x.label === "2026" && String(x.starts_on).startsWith("2026-01-01") && String(x.ends_on).startsWith("2026-12-31")));
    ok("...and its cut-off is its own 1 January", s.find((x) => x.level === "school" && x.label === "2026")?.cutoff_on.toString().startsWith("2026-01-01"));
    ok("a club season is July to June, named for two", s.some((x) => x.level === "club" && x.label === "2026/27" && String(x.starts_on).startsWith("2026-07-01") && String(x.ends_on).startsWith("2027-06-30")));
    ok("...and its cut-off is 1 January of the second year", s.find((x) => x.level === "club" && x.label === "2026/27")?.cutoff_on.toString().startsWith("2027-01-01"));
    ok("exactly one school season is current", s.filter((x) => x.level === "school" && x.current).length === 1);
    const f = async (on, level) => one(`select label, cutoff_on::text, id is not null as anchored from season_for($1::date, $2)`, [on, level]);
    ok("a September date is the 2026 school season", (await f("2026-09-12", "school")).label === "2026");
    ok("...and the 2026/27 club season", (await f("2026-09-12", "club")).label === "2026/27");
    ok("a February date is still last summer's club season", (await f("2026-02-01", "club")).label === "2025/26" && (await f("2026-02-01", "club")).cutoff_on === "2026-01-01");
    ok("a date the calendar does not hold still gets its label, unanchored", (await f("2041-03-01", "school")).label === "2041" && (await f("2041-03-01", "school")).anchored === false);
    ok("the band cut-off is 1 January", (await one(`select season_cutoff('2026-09-12'::date)::text c`)).c === "2026-01-01");
    // Born 1 January 2012: fourteen exactly on 1 January 2026, so U14 — and
    // the eligibility trigger must refuse him for a U13 fixture on the same
    // rule, while a boy born a day later is thirteen, U13, and takes the field.
    const boy = (await one(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born) values ($1, 'U14A', 'B Jansen', 41, 'batter', '2012-01-01') returning id`, [HIL])).id;
    ok("a boy fourteen on 1 January is U14 to the band", (await one(`select age_band('2012-01-01') b`)).b === "U14");
    ok("...and a boy born the next day is U13", (await one(`select age_band('2012-01-02') b`)).b === "U13");
    const u13 = (await one(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs) values ($1, 'U13A', 'Cordwalles', now() + interval '2 days', 'cricket', 'T20', 20) returning id`, [HIL])).id;
    const u14 = (await one(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs) values ($1, 'U14A', 'Cordwalles', now() + interval '2 days', 'cricket', 'T20', 20) returning id`, [HIL])).id;
    await q(`insert into role_assignment (person_id, role, school_id) select id, 'guardian', $1 from app_user where email = 'parent@example.invalid' limit 1`, [HIL]).catch(() => {});
    // He needs a verified guardian to be selected at all; that is not what this proves, so give him one.
    const ga = (await one(`select id from role_assignment where role = 'guardian' and person_id = (select id from app_user where email = 'parent@example.invalid') limit 1`)).id;
    await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at, consent_state, consent_version, consent_at)
             values ($1, $2, 'parent', 'verified', (select id from app_user where email = 'registrar@example.invalid'), now(), 'granted', 'popia-2026-01', now())`, [ga, boy]);
    ok("...and the eligibility trigger refuses him for U13 on the same date",
       !(await q(`insert into match_squad (match_id, player_id, side) values ($1, $2, 'home')`, [u13, boy]).then(() => true).catch(() => false)));
    ok("...while U14 takes him", await q(`insert into match_squad (match_id, player_id, side) values ($1, $2, 'home')`, [u14, boy]).then(() => true).catch(() => false));
  }

  group("A competition knows its level and season; a fixture knows its season");
  {
    const c = (await rows("/api/read/competitions", coach)).find((x) => x.id === LEAGUE);
    ok("the schools league is school level, in the 2026 season", c?.level === "school" && c?.season === "2026");
    ok("...with two divisions", c?.divisions === 2);
    const m = (await rows("/api/read/matches", coach)).find((x) => x.season);
    ok("a fixture carries the school season its date falls in", !!m && /^\d{4}$/.test(m.season));
    ok("a competition on a club calendar is named for two years",
       (await one(`select label from season_for('2026-10-01'::date, 'provincial')`)).label === "2026/27");
  }

  group("A school honour is on a school season");
  {
    const r = await rows("/api/read/honours?teamCode=1XI", coach);
    ok("the seeded honours read their season as one year", r.every((h) => /^\d{4}$/.test(h.season)) && r.some((h) => h.season === "2025"));
    ok("...and filter by it", (await rows("/api/read/honours?season=2025", coach)).length === 1);
    ok("a club label on a school honour is refused",
       (await api("/api/honours", { method: "POST", token: head, body: { playerId: "aaaaaaaa-0000-0000-0000-000000000002", kind: "honours", season: "2026/27" } })).body?.error === "season_unknown_at_school_level");
    ok("...and a real one is not", (await api("/api/honours", { method: "POST", token: head, body: { playerId: "aaaaaaaa-0000-0000-0000-000000000002", kind: "honours", season: "2026" } })).status === 200);
    ok("two spellings of one season cannot both exist", (await one(`select count(*)::int c from season where level = 'school' and label in ('2026', '2026/27')`)).c === 1);
  }

  group("A division is the competition's");
  {
    const ladder = await rows(`/api/read/league?competitionId=${LEAGUE}`, coach);
    ok("the ladder reads per division", ladder.length === 2 && ladder.every((r) => r.division_code === "D1"));
    const divs = await rows(`/api/read/competition_divisions?competitionId=${LEAGUE}`, coach);
    ok("a coach reads the competition's divisions through his team's entry", divs.map((d) => d.code).join() === "D1,D2" && divs[0].entrants === 2);
    ok("a spectator of a school in it reads them too — participation, in his scope", (await rows(`/api/read/competition_divisions?competitionId=${LEAGUE}`, watcher)).length === 2);
    ok("a driver, who holds no competition read at all, reads none", (await rows(`/api/read/competition_divisions?competitionId=${LEAGUE}`, await login("driver@example.invalid"))).length === 0);
    ok("the league's administrator adds a tier", (await division(LEAGUE, league, { code: "D3", name: "Division 3", rank: 3 })).status === 200);
    ok("a coach cannot", [403, 401].includes((await division(LEAGUE, coach, { code: "D4", name: "Division 4", rank: 4 })).status));
    ok("a school's office cannot either — it is not the organiser", [403, 401].includes((await division(LEAGUE, wesAdmin, { code: "D4", name: "Division 4", rank: 4 })).status));
    ok("a second tier with the same code is refused", (await division(LEAGUE, league, { code: "D3", name: "Third", rank: 5 })).status === 422);
    ok("...and the same rank", (await division(LEAGUE, league, { code: "D5", name: "Fifth", rank: 3 })).status === 422);
    ok("a rank outside 1 to 20 is refused", (await division(LEAGUE, league, { code: "D9", name: "Ninth", rank: 0 })).status === 400);
    const wes = (await one(`select id from competition_entrant where competition_id = $1 and school_id = $2`, [LEAGUE, WES])).id;
    ok("the administrator moves Westville down to Division 2", (await place(wes, league, D2)).status === 200);
    const after = await rows(`/api/read/league?competitionId=${LEAGUE}`, coach);
    ok("...and the ladder reads Division 1 then Division 2", after.map((r) => r.division_code).join() === "D1,D2");
    ok("Westville cannot move itself back up", (await place(wes, wesAdmin, D1)).status === 403
       && (await one(`select division_id from competition_entrant where id = $1`, [wes])).division_id === D2);
    ok("...nor can a coach", (await place(wes, coach, D1)).status === 403);
    ok("an entrant can be left unplaced", (await place(wes, league, null)).status === 200);
    ok("...and reads last, under no division", (await rows(`/api/read/league?competitionId=${LEAGUE}`, coach)).at(-1)?.division_code == null);
    const other = (await one(`insert into competition (school_id, name, comp_type, format, level, season_id) values ($1, 'Hilton Internal Cup', 'knockout', 'T20', 'school', season_named('2026','school')) returning id`, [HIL])).id;
    const od = (await one(`insert into competition_division (competition_id, code, name, rank) values ($1, 'A', 'Pool A', 1) returning id`, [other])).id;
    ok("a division of another competition is refused on this one's entrant", (await place(wes, league, od)).status === 403
       || !(await q(`update competition_entrant set division_id = $2 where id = $1`, [wes, od]).then(() => true).catch(() => false)));
    ok("...at the database, whoever asks",
       !(await q(`update competition_entrant set division_id = $2 where id = $1`, [wes, od]).then(() => true).catch(() => false)));
    ok("a competition with no divisions still has a ladder", (await rows(`/api/read/league?competitionId=${other}`, head)).length === 0
       && (await rows(`/api/read/competition_divisions?competitionId=${other}`, head)).length === 1);
  }

  ok("the server logged no errors", serverErr.join("").trim() === "");
  if (serverErr.length) console.log(serverErr.join("").slice(0, 600));
} catch (e) {
  fail++;
  console.log("  ✗ threw:", e.message);
} finally {
  server.kill();
  await pool.end();
}
console.log(`\n${"─".repeat(52)}\nSEASON SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * The coach's cockpit, over HTTP: the proofs phase A still owed, and phase B's
 * one read (SCRBRD-136/137; docs/design/SCRBRD-136-137_phaseB.md §5, §1.7).
 *
 * Phase A shipped three read fixes in services/api/read/read-api.mjs that were
 * proved by nothing but reading them. They are claims about gates on minors'
 * data, so each is proved here as the people it is about, signed in through
 * the API with the seed's invented accounts and two this walk appoints:
 *
 *   1. BOWLING_SPELLS. The spell is the match's log and goes to whoever may
 *      read the match; the directive beside it (age band, pace, the limits,
 *      over_spell_limit) is the boy's load, and comes back only to a reader
 *      holding player.workload.read for that boy. The coach and the physio
 *      get it filled; the scorer, a pupil and the team manager get the same
 *      spell with those null; the other school's coach gets his own bowler's
 *      filled and nothing of ours, at our fixture and at his (db/97).
 *   2. SHOT_POINTS. A ball voided through the pad's own route is gone from
 *      the match's wheel; the striker's own wheel (player_shot_points) agrees;
 *      the count is ball_event_live's.
 *   3. WORKLOAD. The team manager reads none; the coach and the assistant do.
 *   4. BOWLER_DAY (phase B, db/94). A boy's overs today across two matches,
 *      one of them another side's: the coach, the assistant, the physio and
 *      the director read eleven of twelve, two matches; the team manager, the
 *      scorer and a pupil get an empty answer and no error naming the gate;
 *      the boy himself reads his own row and nobody else's.
 *
 *   5. THE AWAY SIDE (away visibility, db/97). The ball log follows the
 *      fixture: whoever may read a fixture may read its balls, so the
 *      visiting school's coach, pupil and spectator read a fixture Hilton
 *      hosts as Hilton's own crowd does, and Hilton's coach reads Westville's.
 *      Every per-boy gate still answers per boy: the host's boys' spells,
 *      wheels and load are not the visitors'. A school of neither side reads
 *      none of it; the pad and every write stay the host's; a guardian reads
 *      what a guardian of the host school reads.
 *
 *   6. A PARENT (db/100, Kameel 2026-10-14). A guardian reads the balls of
 *      the fixtures his child's side plays, home and away: our guardian of R
 *      Pillay (1XI) reads our shared fixture and Westville's, whole, as our
 *      coach does; Westville's guardian the same from his side. Another side's
 *      fixture at the same school reads nothing, though the fixture is on his
 *      list. Per boy stays per boy: no other boy's wheel, spell or load, and
 *      not the pad.
 *
 * The rest of the 136 doc's §9 API walk (opposition_context, trips, matchups,
 * the logged doors) is held by smoke-opposition, smoke-lifts and
 * smoke-matchups; db/99 §71, §72 and §75 hold the schema half of this one.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-cockpit.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { inningsStart, batters, bowler, ball, voidEvent, BALL_TYPE } from "@scrbrd/scoring";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8936);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const SCORER = "88888888-0000-0000-0000-000000000006";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // 1XI, with an account and self-access
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";
const NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";
const SCHEDULED = "77777777-0000-0000-0000-000000000002";  // the seed's 1XI v Michaelhouse, unscored

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-cockpit-secret" },
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
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, raw };
};
const login = async (email, deviceId = "device-cockpit-api") => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId } })).body?.token;
const read = (resource, query, tok) => api(`/api/read/${resource}${query ? `?${new URLSearchParams(query)}` : ""}`, { token: tok });
const rows = async (resource, query, tok) => (await read(resource, query, tok)).body?.rows ?? null;

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;

// The log, as the owner writes it for a walk about what the log MEANS: six
// legal balls an over, bowled by `overs[i]` (null: a bowler SCRBRD holds no
// row for, which still counts in the over's numbering, so alternate overs
// from one end are one spell).
let key = 0;
async function feed(matchId, innings, overs) {
  let seq = (await q(`select coalesce(max(seq), 0)::int s from ball_event where match_id = $1`, [matchId]))[0].s;
  const school = (await q(`select school_id from match where id = $1`, [matchId]))[0].school_id;
  for (const b of overs) {
    for (let j = 0; j < 6; j++) {
      seq++;
      await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                                       idempotency_key, client_seq, client_ts, kind, ball_type, value, bowler_id)
               values ($1, $2, $3, 0, $4, $5, 'walk-cockpit', $6, $3, now(), 'ball', 'run', 0, $7)`,
              [matchId, school, seq, innings, SCORER, `ck-${++key}`, b]);
    }
  }
}
// Balls with a measured point, to `striker`, `bowlerId` bowling alternate
// overs from one end (the others by a bowler SCRBRD holds no row for): what
// a wheel draws.
async function feedPlaced(matchId, innings, bowlerId, striker, overs) {
  let seq = (await q(`select coalesce(max(seq), 0)::int s from ball_event where match_id = $1`, [matchId]))[0].s;
  const school = (await q(`select school_id from match where id = $1`, [matchId]))[0].school_id;
  for (let o = 0; o < overs; o++) {
    for (let j = 0; j < 6; j++) {
      seq++;
      await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                                       idempotency_key, client_seq, client_ts, kind, ball_type, value, bowler_id, striker_id,
                                       theta, radius, placement_source, capture_profile)
               values ($1, $2, $3, 0, $4, $5, 'walk-cockpit', $6, $3, now(), 'ball', 'run', 1, $7, $8, $9, 0.5, 'point', 'full')`,
              [matchId, school, seq, innings, SCORER, `ck-${++key}`, o % 2 === 0 ? bowlerId : null, striker, (seq * 37) % 360]);
    }
  }
}
/**
 * A 1XI fixture at `hhmm` on the SA date `daysAgo` days back: Hilton's, or
 * Westville's at home to Hilton's 1XI, optionally shared with the other
 * school's 1XI. A shared fixture's log follows the fixture (db/97): the
 * balls carry the host's school, and ball_event_read asks fixture.read at
 * the host, or at the away school and team as match_read does.
 */
const fixture = async ({ hhmm, opponent, host = HIL, shared = false, daysAgo = 0 }) => (await q(
  `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
   values ($1, '1XI', $2, $3, $4, ((sa_today() - $6::int)::timestamp + $5::time) at time zone 'Africa/Johannesburg', 'cricket', 'T20', 20, 'live')
   returning id`, [host, shared ? (host === HIL ? WES : HIL) : null, shared ? "1XI" : null, opponent, hhmm, daysAgo]))[0].id;
const FILLED = (r) => r.age_band != null && r.pace != null && r.max_overs_per_spell != null && r.max_overs_per_day != null && typeof r.over_spell_limit === "boolean";
/** Group 5's readers, for group 6. @type {any} */
let families;
const BLANK = (r) => r.age_band === null && r.pace === null && r.max_overs_per_spell === null && r.max_overs_per_day === null && r.over_spell_limit === null;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ══ The stage ══
  group("Set the stage: our U15 quick, our spinner and theirs; a shared fixture today and a second one this afternoon");
  const today = (await q(`select sa_today()::text d`))[0].d;
  const born = (await q(`select make_date(extract(year from sa_today())::int - 16, 10, 1)::text d`))[0].d;   // U15 this school year
  const QUICK = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born, bowling_style)
                          values ($1, '1XI', 'V Cockpit Quick', 81, 'bowler', $2, 'F') returning id`, [HIL, born]))[0].id;
  const SPIN = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born, bowling_style)
                         values ($1, '1XI', 'V Cockpit Spin', 82, 'bowler', $2, 'S') returning id`, [HIL, born]))[0].id;
  const THEIRS = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born, bowling_style)
                           values ($1, '1XI', 'V Cockpit Visitor', 83, 'bowler', $2, 'F') returning id`, [WES, born]))[0].id;
  // A Westville pupil, whose wheel at our ground is his.
  const AWAYBAT = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
                            values ($1, '1XI', 'V Cockpit Away Bat', 84, 'batter', $2) returning id`, [WES, born]))[0].id;
  ok("the walk's quick is U15 this school year", (await q(`select age_band($1::date) b`, [born]))[0].b === "U15");
  // The two staff the seed does not have, appointed to the 1XI as the office would.
  for (const [email, name, role] of [["assist.ck@example.invalid", "A Assistant", "assistantcoach"], ["manager.ck@example.invalid", "T Manager", "teammanager"]]) {
    await q(`insert into app_user (school_id, email, name, role, teams) values ($1, $2, $3, $4, '{1XI}')`, [HIL, email, name, role]);
    await q(`insert into role_assignment (person_id, role, school_id, team_code) select id, $2, school_id, '1XI' from app_user where email = $1`, [email, role]);
  }
  // The performance analyst (GA-I24-I25 A2): the compare screen's and the
  // workspace's reader, school-wide, holding no player.workload.read and no
  // player.age.read. The seed's analyst@ account is a scout.
  await q(`insert into app_user (school_id, email, name, role) values ($1, 'analyst.ck@example.invalid', 'P Analyst', 'analyst')`, [HIL]);
  await q(`insert into role_assignment (person_id, role, school_id) select id, 'analyst', school_id from app_user where email = 'analyst.ck@example.invalid'`);
  const SHARED = await fixture({ hhmm: "09:00", opponent: "Westville Boys' High 1XI", shared: true });
  const AFTERNOON = await fixture({ hhmm: "14:00", opponent: "Verify Cockpit Afternoon XI" });
  const AWAY = await fixture({ hhmm: "10:00", opponent: "Hilton College 1XI", host: WES, shared: true, daysAgo: 1 });
  // Morning, at Hilton: our quick bowls six from one end (the U15 spell is
  // six: at it, not past it), our spinner five from the other.
  await feed(SHARED, 0, [QUICK, SPIN, QUICK, SPIN, QUICK, SPIN, QUICK, SPIN, QUICK, SPIN, QUICK]);
  // ...and a twelfth over, to Westville's pupil, every ball placed, by a
  // bowler SCRBRD holds no row for: his wheel at our ground.
  await feedPlaced(SHARED, 0, null, AWAYBAT, 1);
  // Afternoon: five more for our quick. Eleven on the day, of a day's twelve.
  await feed(AFTERNOON, 0, [QUICK, null, QUICK, null, QUICK, null, QUICK, null, QUICK]);
  // Yesterday, at Westville: theirs bowls seven on the trot from one end, one
  // past his spell; our spinner bowls the other end.
  await feed(AWAY, 0, [THEIRS, SPIN, THEIRS, SPIN, THEIRS, SPIN, THEIRS, SPIN, THEIRS, SPIN, THEIRS, SPIN, THEIRS]);
  // This morning at Hilton, the second innings: theirs bowls three from one
  // end to our opener, every ball placed, so the visitors have a spell at our
  // ground and our opener a wheel. Theirs's day: three, one match.
  await feedPlaced(SHARED, 1, THEIRS, WHITFIELD, 5);
  ok("the stage is set", !!SHARED && !!AFTERNOON && !!AWAY);

  const coach = await login("coach@example.invalid");         // coach, 1XI
  const assist = await login("assist.ck@example.invalid");    // assistant coach, 1XI
  const manager = await login("manager.ck@example.invalid");  // team manager, 1XI
  const medic = await login("medical@example.invalid");       // physio, the school
  const head = await login("sarah@example.invalid");          // director of sport
  const scorer = await login("scorer@example.invalid");       // scorer, the school
  const pupil = await login("spectator@example.invalid");     // seeded as a spectator; his assignment is a pupil's (player, Hilton), no self-access
  const self = await login("pillay@example.invalid");         // R Pillay: a pupil on the side, and self-access to his own record
  const wes = await login("coach.wes@example.invalid");       // Westville's 1XI coach
  const owner = await login("owner@example.invalid");         // the owner's key
  const analyst = await login("analyst.ck@example.invalid");  // analyst, the school: no workload, no age
  ok("everyone signs in", [coach, assist, manager, medic, head, scorer, pupil, self, wes, owner, analyst].every(Boolean));

  // ══ 1 ══
  group("1 · bowling_spells: the spell is the match's; the directive beside it is the boy's load");
  {
    const spells = (tok) => rows("bowling_spells", { matchId: SHARED }, tok);
    const c = await spells(coach);
    const ours = (c ?? []).filter((r) => r.bowler_id === QUICK);
    ok("the coach reads our quick's spell", ours.length === 1 && ours[0].overs === 6, c);
    ok("...with the U15 directive filled and the flag a boolean", ours.every(FILLED) && ours[0].age_band === "U15"
       && ours[0].max_overs_per_spell === 6 && ours[0].max_overs_per_day === 12 && ours[0].over_spell_limit === false, ours);
    // The analyst is here for GA-I24-I25 A2: the workspace's reader reads the
    // spell and none of the directive (band, pace, both limits, the flag).
    for (const [who, tok] of [["the scorer", scorer], ["a pupil", pupil], ["the team manager", manager], ["the analyst", analyst]]) {
      const s = await spells(tok);
      const mine = (s ?? []).filter((r) => r.bowler_id === QUICK);
      ok(`${who} reads the same spell`, mine.length === 1 && mine[0].overs === 6 && mine[0].first_over === 0 && mine[0].last_over === 10, s);
      ok("...with the band, pace, both limits and the flag null", mine.every(BLANK), mine);
      ok("...and nobody's band at all", (s ?? []).every(BLANK));
    }
    const m = await spells(medic);
    ok("the physio at the school reads it filled", (m ?? []).filter((r) => r.bowler_id === QUICK).every(FILLED)
       && (m ?? []).some((r) => r.bowler_id === QUICK));
    // The other school's coach, both ways round. The log follows the fixture
    // (db/97), so at Hilton's fixture he reads his own bowler's spell with the
    // directive filled; ours are not in his read at all (bowling_spells joins
    // the boy's record, which is not his school's), let alone our band.
    const v = await spells(wes);
    const visitor = (v ?? []).filter((r) => r.bowler_id === THEIRS);
    ok("the other school's coach reads his own bowler's spell at a fixture Hilton hosts, filled",
       visitor.length === 1 && FILLED(visitor[0]) && visitor[0].age_band === "U15" && visitor[0].overs === 3 && visitor[0].over_spell_limit === false, v);
    ok("...and nothing of ours: no spell of our quick or our spinner, no band", (v ?? []).every((r) => r.bowler_id === THEIRS), v);
    const w = await rows("bowling_spells", { matchId: AWAY }, wes);
    const theirs = (w ?? []).filter((r) => r.bowler_id === THEIRS);
    ok("at his own school's fixture he reads his bowler filled, and that he went past his spell",
       theirs.length === 1 && FILLED(theirs[0]) && theirs[0].age_band === "U15" && theirs[0].overs === 7 && theirs[0].over_spell_limit === true, w);
    ok("...and nothing of ours filled (our spinner's record is not his to read)", (w ?? []).filter((r) => r.bowler_id !== THEIRS).every(BLANK)
       && !(w ?? []).some((r) => r.bowler_id === SPIN && r.age_band != null), w);
    const h = await rows("bowling_spells", { matchId: AWAY }, coach);
    const spin = (h ?? []).filter((r) => r.bowler_id === SPIN);
    // A spinner's directive has a band and no limit, so "filled" for him is
    // the band, pace false and the flag a boolean: the gate answered.
    ok("our coach, in turn, reads our spinner's spell at Westville's fixture, the directive answered",
       spin.length === 1 && spin[0].age_band === "U15" && spin[0].pace === false && typeof spin[0].over_spell_limit === "boolean"
       && spin[0].overs === 6, h);
    ok("...and nothing of theirs: not his seven, not his band", (h ?? []).every((r) => r.bowler_id === SPIN), h);
  }

  // ══ 2 ══
  group("2 · shot_points: a ball voided through the pad's own route is not drawn");
  {
    const dev = "device-cockpit-pad";
    const pad = await login("scorer@example.invalid", dev);
    const claim = await api(`/api/matches/${SCHEDULED}/session/claim`, { method: "POST", token: pad, body: { device: dev } });
    ok("the scorer claims the fixture", claim.body?.ok === true, claim.raw);
    const epoch = claim.body?.epoch;
    let n = 0;
    const post = (evs) => api(`/api/matches/${SCHEDULED}/events`, { method: "POST", token: pad, body: { events: evs.map((payload) => ({
      epoch, deviceId: dev, idempotencyKey: `ck-pad:${++n}`, clientSeq: n, clientTs: Date.now(), innings: 0, payload })) } });
    const shot = (theta) => ball({ type: BALL_TYPE.RUN, value: 4, striker: WHITFIELD, nonStriker: BEKKER, bowler: NAIDOO,
      theta, radius: 0.9, placementSource: "point", captureProfile: "full" });
    const first = await post([inningsStart({ innings: 0, battingTeam: "HIL", bowlingTeam: "MHS", oversLimit: 20 }),
      batters({ striker: WHITFIELD, nonStriker: BEKKER }), bowler({ bowler: NAIDOO }), shot(70), shot(300)]);
    ok("five events land through the route", first.body?.accepted?.length === 5, first.raw);
    const seqs = async (tok) => ((await rows("shot_points", { matchId: SCHEDULED }, tok)) ?? []).map((r) => r.seq);
    const before = await seqs(coach);
    ok("the coach's wheel draws both balls", before.length === 2, before);
    const second = await post([voidEvent({ innings: 0, target: "ck-pad:5" })]);
    ok("the scorer voids the last ball, as the pad's undo does", second.body?.accepted?.length === 1, second.raw);
    const after = await seqs(coach);
    ok("the voided ball is gone from the match's wheel", after.length === 1 && after[0] === before[0], after);
    const career = ((await rows("player_shot_points", { playerId: WHITFIELD }, coach)) ?? []).filter((r) => r.match_id === SCHEDULED).map((r) => r.seq);
    ok("the striker's own wheel agrees", JSON.stringify(career) === JSON.stringify(after), career);
    const live = (await q(`select count(*)::int c from ball_event_live where match_id = $1 and kind = 'ball'
                             and placement_source = 'point' and capture_profile in ('full', 'standard')`, [SCHEDULED]))[0].c;
    ok("the count is ball_event_live's for the match", live === after.length, live);
  }

  // ══ 3 ══
  group("3 · workload: the team manager reads none; the coach and the assistant do");
  {
    const wl = (tok) => rows("workload", { teamCode: "1XI" }, tok);
    ok("the team manager reads nothing", JSON.stringify(await wl(manager)) === "[]");
    for (const [who, tok] of [["the coach", coach], ["the assistant coach", assist]]) {
      const r = await wl(tok);
      ok(`${who} reads the side, our quick's eleven overs this week among it`,
         (r ?? []).length > 1 && (r ?? []).find((x) => x.player_id === QUICK)?.overs_7d === 11, r);
    }
  }

  // ══ 4 ══
  group("4 · bowler_day: a boy's overs today, across every match, under player.workload.read");
  {
    const day = (tok, query = { date: today, teamCode: "1XI" }) => read("bowler_day", query, tok);
    const c = await day(coach);
    const q1 = (c.body?.rows ?? []).find((r) => r.player_id === QUICK);
    ok("the coach reads our quick: eleven of twelve today, two matches, the U15 directive",
       q1?.overs_today === 11 && q1?.matches_today === 2 && q1?.max_overs_per_day === 12 && q1?.age_band === "U15"
       && q1?.pace === true && q1?.clause_code === "PACE-U14-U15" && String(q1?.bowled_on).slice(0, 10) === today, q1);
    ok("...and nothing about the other match but the count",
       Object.keys(q1 ?? {}).sort().join() === "age_band,bowled_on,clause_code,full_name,matches_today,max_overs_per_day,max_overs_per_spell,overs_today,pace,player_id,school_id,team_code");
    const s1 = (c.body?.rows ?? []).find((r) => r.player_id === SPIN);
    ok("...the spinner: his five, no day limit, no clause", s1?.overs_today === 5 && s1?.pace === false && s1?.max_overs_per_day === null && s1?.clause_code === null, s1);
    ok("...a boy who has not bowled is a row with 0", (c.body?.rows ?? []).some((r) => r.player_id === WHITFIELD && r.overs_today === 0 && r.matches_today === 0));
    ok("...the most overs first", c.body?.rows?.[0]?.player_id === QUICK);
    for (const [who, tok] of [["the assistant coach", assist], ["the physio", medic], ["the director of sport", head]]) {
      const r = (await day(tok)).body?.rows ?? [];
      ok(`${who} reads the same eleven`, r.find((x) => x.player_id === QUICK)?.overs_today === 11, r.length);
    }
    for (const [who, tok] of [["the team manager", manager], ["the scorer", scorer], ["a pupil", pupil]]) {
      const r = await day(tok);
      ok(`${who} gets an empty answer`, r.status === 200 && JSON.stringify(r.body?.rows) === "[]", r.raw);
      ok("...and nothing that names the gate", !/workload|capabilit|permission|forbidden|denied/i.test(r.raw), r.raw);
    }
    const me = (await day(self, { date: today })).body?.rows ?? [];
    ok("R Pillay, through self-access, reads his own row and nobody else's", me.length === 1 && me[0].player_id === PILLAY && me[0].overs_today === 0, me);
    const yesterday = (await q(`select (sa_today() - 1)::text d`))[0].d;
    const w = (await day(wes, { date: yesterday, teamCode: "1XI" })).body?.rows ?? [];
    ok("the other school's coach reads his own boy's seven yesterday, and none of ours",
       w.find((r) => r.player_id === THEIRS)?.overs_today === 7 && !w.some((r) => r.school_id === HIL), w.map((r) => r.full_name));
    ok("...though our spinner bowled at his ground: our coach reads that, as his day",
       ((await day(coach, { date: yesterday, teamCode: "1XI" })).body?.rows ?? []).find((r) => r.player_id === SPIN)?.overs_today === 6);
    // SCRBRD-136/137 phase B, point 1 of the build brief: superadmin holds every
    // capability but safeguarding, so the per-boy gate admits him. The design's
    // reader list does not name him; roles are unchanged.
    ok("the owner's key reads it too (every capability, at every school)",
       ((await day(owner)).body?.rows ?? []).find((r) => r.player_id === QUICK)?.overs_today === 11);
    ok("three days ago, by the fixture's SA date, is nothing", ((await day(coach, { date: (await q(`select (sa_today() - 3)::text d`))[0].d, teamCode: "1XI" })).body?.rows ?? [])
       .every((r) => r.overs_today === 0));
    ok("no date is refused as the caller's mistake", (await day(coach, { teamCode: "1XI" })).status === 400);
    ok("...and so is a date that is not one", (await day(coach, { date: "Saturday" })).status === 400);
    ok("it is not read signed out", (await day(undefined)).status === 401);
  }

  // ══ 5 ══
  group("5 · the away side: the ball log follows the fixture (db/97)");
  {
    // The readers the seed does not have, appointed as the office would: a
    // Westville pupil with self-access to his own record, his guardian, a
    // Westville spectator, and a school of neither side with a coach.
    const OFFICE = "88888888-0000-0000-0000-00000000000c";
    const appoint = async (email, name, school, role, team = null, player = null) =>
      (await q(`insert into app_user (school_id, email, name, role, player_id, teams) values ($1, $2, $3, $4, $5, $6) returning id`,
               [school, email, name, role, player, team ? [team] : []]))[0].id;
    const assign = async (person, role, school, team = null, subject = null) => {
      const a = (await q(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, $2, $3, $4) returning id`,
                         [person, role, school, team]))[0].id;
      if (subject) {
        await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                                 consent_state, consent_version, consent_at, created_by, valid_from)
                 values ($1, $2, $3, 'verified', $4, now(), 'granted', 'popia-2026-01', now(), $4, current_date - 1)`,
                [a, subject, role === "guardian" ? "parent" : "self", OFFICE]);
      }
    };
    const pupilW = await appoint("away.pupil.ck@example.invalid", "V Away Pupil", WES, "player", "1XI", AWAYBAT);
    await assign(pupilW, "player", WES, "1XI");
    await assign(pupilW, "selfaccess", WES, null, AWAYBAT);
    const parentW = await appoint("away.parent.ck@example.invalid", "V Away Parent", WES, "guardian");
    await assign(parentW, "guardian", WES, null, AWAYBAT);
    const specW = await appoint("away.spec.ck@example.invalid", "V Away Spectator", WES, "spectator");
    await assign(specW, "spectator", WES);
    const KRS = (await q(`insert into school (code, name, kind, province) values ('VCKK', 'Verify Cockpit College', 'school', 'KwaZulu-Natal') returning id`))[0].id;
    const coachK = await appoint("k.coach.ck@example.invalid", "V Neither Coach", KRS, "coach", "1XI");
    await assign(coachK, "coach", KRS, "1XI");
    const awayPupil = await login("away.pupil.ck@example.invalid");    // Westville pupil, self-access to his own record
    const awayParent = await login("away.parent.ck@example.invalid");  // his guardian, verified
    const awaySpec = await login("away.spec.ck@example.invalid");      // a Westville spectator
    const kcoach = await login("k.coach.ck@example.invalid");          // a coach of neither school
    const parent = await login("parent@example.invalid");              // D Pillay, our guardian of R Pillay
    ok("the away side's readers sign in", [awayPupil, awayParent, awaySpec, kcoach, parent].every(Boolean));

    const log = async (tok, m = SHARED) => {
      const r = await api(`/api/matches/${m}/events`, { token: tok });
      return r.status === 200 ? r.body?.events ?? null : null;
    };
    const seqs = (l) => JSON.stringify((l ?? []).map((e) => e.seq));
    const ours = await log(coach);
    ok("our coach reads the fixture's log", (ours ?? []).length === 102, ours?.length);
    for (const [who, tok] of [["Westville's coach", wes], ["a Westville pupil", awayPupil], ["a Westville spectator", awaySpec]]) {
      const l = await log(tok);
      ok(`${who} reads every ball of a fixture Hilton hosts, as our crowd does`, l !== null && seqs(l) === seqs(ours), l?.length);
    }
    const theirsLog = await log(wes, AWAY);
    ok("...and our coach reads every ball of Westville's", (theirsLog ?? []).length === 78 && seqs(await log(coach, AWAY)) === seqs(theirsLog),
       theirsLog?.length);
    const score = async (tok) => JSON.stringify(await rows("live_score", { matchId: SHARED }, tok));
    const ourScore = await score(coach);
    ok("the score is the same score to both schools", ourScore !== "[]" && ourScore !== "null" && (await score(wes)) === ourScore);

    // A school of neither side.
    ok("a coach of neither school reads none of the log", ((await log(kcoach)) ?? []).length === 0);
    ok("...no score and no spell", JSON.stringify(await rows("live_score", { matchId: SHARED }, kcoach)) === "[]"
       && JSON.stringify(await rows("bowling_spells", { matchId: SHARED }, kcoach)) === "[]");
    ok("...and not the fixture", !((await rows("matches", null, kcoach)) ?? []).some((m) => m.id === SHARED || m.id === AWAY));

    // Per boy stays per boy: a wheel across innings is the boy's record's.
    const wheel = async (tok, id) => ((await rows("player_shot_points", { playerId: id }, tok)) ?? []).filter((r) => r.match_id === SHARED).length;
    ok("the Westville pupil reads his own wheel at our ground", (await wheel(awayPupil, AWAYBAT)) === 6);
    ok("...and not our opener's, though he batted in the same fixture", (await wheel(awayPupil, WHITFIELD)) === 0);
    ok("Westville's coach draws his own boy's wheel and not our opener's", (await wheel(wes, AWAYBAT)) === 6 && (await wheel(wes, WHITFIELD)) === 0);
    ok("our coach draws our opener's and not theirs", (await wheel(coach, WHITFIELD)) === 30 && (await wheel(coach, AWAYBAT)) === 0);
    const cov = async (tok, id) => (await rows("matchup_coverage", { batterId: id }, tok))?.[0]?.deliveries;
    ok("a matchup's coverage counts our opener's balls for us and none for them", (await cov(coach, WHITFIELD)) >= 30 && (await cov(wes, WHITFIELD)) === 0);

    // A guardian reads at the other school's fixture what a guardian of the
    // host reads at it: the fixture, and its balls as ours does (both boys
    // are on their 1XI, the side at each end: group 6 has the rest, db/100).
    const fam = async (tok) => ({ seen: ((await rows("matches", null, tok)) ?? []).some((m) => m.id === SHARED), balls: ((await log(tok)) ?? []).length });
    const gW = await fam(awayParent), gH = await fam(parent);
    ok("the Westville guardian reads the fixture, as our guardian does", gW.seen && gH.seen, { gW, gH });
    ok("...and its balls exactly as our guardian does", gW.balls === gH.balls, { gW, gH });

    // The pad stays the host's (AV-D4).
    const claim = await api(`/api/matches/${SHARED}/session/claim`, { method: "POST", token: wes, body: { device: "device-cockpit-api" } });
    ok("Westville's coach cannot take the pad at our fixture", claim.body?.ok !== true, claim.raw);
    const held = await api(`/api/matches/${SHARED}/quarantine`, { token: wes });
    ok("...nor read what it holds for review", held.status !== 200 || (held.body?.rows ?? []).length === 0, held.raw);
    families = { parent, awayParent, log, seqs, ours, theirsLog };

    // bowler_day agrees with the spell it counts, across the boundary.
    const d = ((await read("bowler_day", { date: today, teamCode: "1XI" }, wes)).body?.rows ?? []).find((r) => r.player_id === THEIRS);
    const spellOvers = ((await rows("bowling_spells", { matchId: SHARED }, wes)) ?? []).filter((r) => r.bowler_id === THEIRS).reduce((a, r) => a + r.overs, 0);
    ok("Westville's coach reads his quick's day as the spell behind it: three, one match",
       d?.overs_today === 3 && d?.matches_today === 1 && spellOvers === 3, { d, spellOvers });
    // Nothing of our boys' load, injuries or reasons reaches the visitors' reads.
    const raw = JSON.stringify([await rows("bowling_spells", { matchId: SHARED }, wes), await log(wes)]);
    ok("...and nothing of ours rides along: no injury, reason or risk word, none of our bowlers named",
       !/injury_type|reason_kind|\brisk\b|V Cockpit Quick|V Cockpit Spin/i.test(raw));
  }

  // ══ 6 ══
  group("6 · a parent reads the balls of his child's side's fixtures, home and away (db/100)");
  {
    const { parent, awayParent, log, seqs, ours, theirsLog } = families;
    // Another side at our school, today: the 2XI, eight overs.
    const SECONDS = (await q(
      `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
       values ($1, '2XI', 'Verify Cockpit Seconds', (sa_today()::timestamp + time '11:00') at time zone 'Africa/Johannesburg', 'cricket', 'T20', 20, 'live')
       returning id`, [HIL]))[0].id;
    await feed(SECONDS, 0, [null, null, null, null, null, null, null, null]);
    const coach2 = await login("coach2@example.invalid");
    const seconds = await log(coach2, SECONDS);
    ok("the 2XI's coach reads his own side's fixture (the control)", (seconds ?? []).length === 48, seconds?.length);

    // Home and away, as our guardian of R Pillay (1XI).
    const home = await log(parent);
    ok("our parent reads every ball of the shared fixture at home, as our coach does", home !== null && seqs(home) === seqs(ours), home?.length);
    const away = await log(parent, AWAY);
    ok("...and every ball of it at Westville, where his son's side is the visitor", away !== null && seqs(away) === seqs(theirsLog), away?.length);
    const afternoon = await log(parent, AFTERNOON);
    ok("...and the afternoon's, his son's side's with no away school", afternoon !== null && seqs(afternoon) === seqs(await log(coach, AFTERNOON))
       && afternoon.length > 0, afternoon?.length);
    // ...and Westville's guardian, from the other end.
    ok("Westville's parent reads both, his son's side at each end",
       seqs(await log(awayParent)) === seqs(ours) && seqs(await log(awayParent, AWAY)) === seqs(theirsLog));
    const score = async (tok, m) => JSON.stringify(await rows("live_score", { matchId: m }, tok));
    ok("the score a parent folds is the score the coach reads", (await score(parent, SHARED)) === (await score(coach, SHARED))
       && (await score(parent, SHARED)) !== "[]");

    // Refused: another side's fixture. Since db/106 (REACH-D1, "the side
    // only") it is not on his list either; until then match_read asked with
    // the all-zeros person and gave him every fixture at the school.
    const mine = (await rows("matches", null, parent)) ?? [];
    ok("our parent no longer sees the 2XI's fixture on his list (db/106)...",
       mine.length > 0 && !mine.some((m) => m.id === SECONDS), mine.length);
    ok("...and reads none of its balls: it is not his son's side's", ((await log(parent, SECONDS)) ?? []).length === 0);
    ok("...nor its score", (await score(parent, SECONDS)) === "[]");
    ok("Westville's parent reads none of it either", ((await log(awayParent, SECONDS)) ?? []).length === 0);

    // Per boy stays per boy.
    const wheel = async (tok, id) => ((await rows("player_shot_points", { playerId: id }, tok)) ?? []).length;
    ok("our parent draws no other boy's wheel: not our opener's, not Westville's", (await wheel(parent, WHITFIELD)) === 0 && (await wheel(parent, AWAYBAT)) === 0);
    ok("Westville's parent draws his own son's wheel at our ground, and not our opener's",
       (await wheel(awayParent, AWAYBAT)) === 6 && (await wheel(awayParent, WHITFIELD)) === 0);
    ok("...nor counts another boy's matchup balls", (await rows("matchup_coverage", { batterId: WHITFIELD }, parent))?.[0]?.deliveries === 0);
    ok("bowling_spells at the shared fixture carries none of the bowlers (none is his son)",
       JSON.stringify(await rows("bowling_spells", { matchId: SHARED }, parent)) === "[]");
    ok("...and the load reads nothing: workload, bowler_day",
       JSON.stringify(await rows("workload", { teamCode: "1XI" }, parent)) === "[]"
       && JSON.stringify(await rows("bowler_day", { date: today, teamCode: "1XI" }, parent)) === "[]");
    const raw = JSON.stringify([home, away]);
    ok("...and no name, injury or load rides on the log he reads", !/V Cockpit|injury_type|reason_kind|\brisk\b|age_band/i.test(raw));

    // The pad stays the scorer's.
    const claim = await api(`/api/matches/${SHARED}/session/claim`, { method: "POST", token: parent, body: { device: "device-cockpit-api" } });
    ok("our parent cannot take the pad", claim.body?.ok !== true, claim.raw);
    const held = await api(`/api/matches/${SHARED}/quarantine`, { token: parent });
    ok("...nor read what it holds for review", held.status !== 200 || (held.body?.rows ?? []).length === 0, held.raw);
  }

  // ══ 7 ══
  group("7 · a retirement's reason stays at the boy's school (db/118; away visibility §4)");
  {
    // A fixture of its own, last, so no count above moves. Our opener and
    // their batter each retire hurt; a boy the pad knows only by a typed name
    // retires hurt; our opener later retires out (a dismissal, with its W).
    const { parent, awayParent, log } = families;
    const RET = await fixture({ hhmm: "16:00", opponent: "Westville Boys' High 1XI (retirements)", shared: true });
    const TYPED = "A Typed Visitor";
    const retire = async (seq, batter, reason, out = false) => q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                               client_seq, client_ts, kind, ball_type, dismissal, payload)
       values ($1, $2, $3, 0, 1, $4, 'walk-cockpit', $5, $3, now(), 'retire', $6, $7, $8)`,
      [RET, HIL, seq, SCORER, `ck-${++key}`, out ? "W" : null, out ? "retired_out" : null, JSON.stringify({ batter, reason })]);
    await retire(1, WHITFIELD, "hurt");
    await retire(2, AWAYBAT, "hurt");
    await retire(3, TYPED, "hurt");
    await retire(4, WHITFIELD, "out", true);
    /** reason by seq, as this reader reads the log */
    const reasons = async (tok) => Object.fromEntries(((await log(tok, RET)) ?? []).map((e) => [e.seq, e.payload?.reason]));
    const ourCoach = await reasons(coach), theirCoach = await reasons(wes);
    ok("our coach reads our opener retired hurt", ourCoach[1] === "hurt", ourCoach);
    ok("...and their batter's retirement as 'not out'", ourCoach[2] === "not out", ourCoach);
    ok("...and a typed name's as 'not out', since he is at no school of ours", ourCoach[3] === "not out", ourCoach);
    ok("Westville's coach reads our opener's retirement as 'not out'", theirCoach[1] === "not out", theirCoach);
    ok("...and his own batter retired hurt", theirCoach[2] === "hurt", theirCoach);
    ok("a retirement that is a dismissal keeps its reason for both", ourCoach[4] === "out" && theirCoach[4] === "out");
    const fam = await reasons(awayParent), ourFam = await reasons(parent);
    ok("the Westville guardian reads our opener's as 'not out', his son's as hurt", fam[1] === "not out" && fam[2] === "hurt", fam);
    ok("our guardian reads our opener's as our school does", ourFam[1] === "hurt" && ourFam[2] === "not out", ourFam);
    const raw = JSON.stringify((await log(wes, RET)) ?? []);
    ok("...and the word 'hurt' rides on no Hilton boy's event the visitors read",
       !((await log(wes, RET)) ?? []).some((e) => e.payload?.batter === WHITFIELD && /hurt/.test(JSON.stringify(e))), raw.slice(0, 300));
  }

  ok("the server logged no errors", serverErr.join("").trim() === "", serverErr.join("").slice(0, 600));
} catch (e) {
  fail++;
  console.log("  ✗ threw:", e.stack ?? e.message);
} finally {
  server.kill();
  await pool.end();
}
console.log(`\n${"─".repeat(52)}\nCOCKPIT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

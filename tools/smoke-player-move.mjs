#!/usr/bin/env node
/**
 * db/112 over HTTP: a moved pupil follows his new side (SR-1), and a boy
 * playing up reads the balls of the match he is picked for.
 *
 * db/99 §89 proves the trigger, the correction and the policy as the
 * application role. This walks the route the office actually uses —
 * POST /api/players/:id/team — and reads as the boy through the API:
 *
 *   1. Before: R Pillay (1XI) reads the 1st XI's fixture, nets, plan and
 *      balls, and none of the U16B's.
 *   2. The director of sport moves him to the U16B. His `player` role on the
 *      1XI is ended (kept, stamped with her) and one is made on the U16B (by
 *      her); his self-access role is untouched.
 *   3. After: he reads the U16B's fixture, nets, plan and balls, and none of
 *      the 1st XI's — but the one 1st XI match whose sheet names him, which
 *      he now plays up into: its fixture and every ball of it.
 *   4. His mother reads the same side he does.
 *   5. The route still refuses a move to no side, and nothing changes.
 *
 * And db/117 (SEASON_ROLLOVER S2, the dated side; db/99 §94 is its proof):
 *   6. After the move his mother still reads the 1XI's fixture, bus, nets,
 *      plan and balls of last month (D1), not the 1XI's bus ahead, and none
 *      of the U16B's rows from before he joined (Q2); he keeps the same
 *      season's fixture, bus, nets, balls and plan (db/117 header §4:
 *      Kameel, 22 October 2026, his old side's posts and plans of his time).
 *   7. The move voided his mother's seat on a lift to the 1XI's fixture
 *      ahead (SR-4), kept the one to the match whose sheet names him, and
 *      told her and the driver once each.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-player-move.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8862);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, the seed's pupil on the 1XI
const FROM = "1XI";
const TO = "U16B";                                       // a seeded side with its own coach

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log("  ✗", n, extra ?? ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-player-move-secret" },
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
  method: "POST", body: { email, deviceId: "device-player-move" } })).body?.token;

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;

/** What a reader reads of the staged rows, through the API, by label. */
const reads = async (token, s) => {
  const label = (id) => Object.keys(s).find((k) => s[k] === id);
  const pick = (rows) => (rows ?? []).map((r) => label(r.id)).filter(Boolean).sort().join(" ");
  const fixtures = pick((await api("/api/read/matches", { token })).body?.rows);
  const training = pick((await api("/api/read/training", { token })).body?.rows);
  const plans = pick((await api("/api/read/news", { token })).body?.rows);
  const balls = [];
  for (const k of ["fOld", "fNew", "fUp"]) {
    const r = await api(`/api/matches/${s[k]}/events`, { token });
    if ((r.body?.events ?? []).length) balls.push(`${k}:${r.body.events.length}`);
  }
  return `fixtures [${fixtures}] training [${training}] plans [${plans}] balls [${balls.join(" ")}]`;
};

/** Six balls on a fixture, as the pad's server writes them (as the owner). */
const bowl = async (match, scorer, tag) => {
  for (let i = 1; i <= 6; i++) {
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                                     idempotency_key, client_seq, client_ts, kind, ball_type, value)
             select $1, m.school_id, $2, 0, 0, $3, 'smoke-player-move', $4, $2, now(), 'ball', 'run', 0
               from match m where m.id = $1`, [match, i, scorer, `spm-${tag}-${i}`]);
  }
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const idOf = async (email) => (await q(`select id from app_user where email = $1`, [email]))[0]?.id;
  const SARAH = await idOf("sarah@example.invalid");       // director of sport, and the U16B's coach
  const COACH = await idOf("coach@example.invalid");       // the 1XI's coach
  const BOY = await idOf("pillay@example.invalid");
  const head = await login("sarah@example.invalid");
  const boy = await login("pillay@example.invalid");
  ok("the director and the boy can sign in", !!head && !!boy);
  ok("the boy is on the 1XI to begin with", (await q(`select team_code from player where id = $1`, [PILLAY]))[0]?.team_code === FROM);
  const mother = (await q(`select u.email from role_assignment a
                             join assignment_subject g on g.assignment_id = a.id and g.verification_state = 'verified'
                             join app_user u on u.id = a.person_id
                            where a.role = 'guardian' and a.active and g.player_id = $1
                            order by u.email limit 1`, [PILLAY]))[0]?.email;
  ok("the boy has a verified parent to read beside him", !!mother);
  const mum = await login(mother);
  const roles = async () => (await q(`select role, team_code, active, created_by, revoked_by, revoked_at
                                        from role_assignment where person_id = $1 and role in ('player', 'selfaccess')
                                       order by role, active, team_code`, [BOY]));
  const selfBefore = JSON.stringify((await roles()).filter((r) => r.role === "selfaccess"));

  // The stage, as the owner: a fixture, nets and a plan for each side, a
  // 1XI fixture whose sheet names him (the one he will play up into), and
  // six balls on each fixture. Dated ahead, so none is a seeded row.
  const D = new Date(Date.now() + 5 * 86400e3).toISOString();
  const s = {};
  const fixture = async (team, opp) => (await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
       values ($1, $2, $3, $4, 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL, team, opp, D]))[0].id;
  s.fOld = await fixture(FROM, "Smoke Move Old Side");
  s.fNew = await fixture(TO, "Smoke Move New Side");
  s.fUp = await fixture(FROM, "Smoke Move Playing Up");
  await q(`insert into match_squad (match_id, player_id, side, batting_no) values ($1, $2, 'home', 1)`, [s.fUp, PILLAY]);
  for (const k of ["fOld", "fNew", "fUp"]) await bowl(s[k], SARAH, k);
  const nets = async (team) => (await q(`insert into training_session (school_id, team_code, title, starts_at, duration_min, session_type)
       values ($1, $2, $3, $4, 60, 'batting') returning id`, [HIL, team, `Smoke move ${team} nets`, D]))[0].id;
  s.sOld = await nets(FROM);
  s.sNew = await nets(TO);
  const plan = async (team, match, author) => (await q(`insert into news_post (scope, school_id, team_code, kind, fixture_id, title, body, published_at, author_id)
       values ('team', $1, $2, 'plan', $3, $4, 'Smoke move: meet at the pavilion', now() - interval '1 minute', $5) returning id`,
       [HIL, team, match, `Smoke move ${team} plan`, author]))[0].id;
  s.pOld = await plan(FROM, s.fOld, COACH);
  s.pNew = await plan(TO, s.fNew, SARAH);

  // The dated side (db/117), as the owner, apart from `s` so groups 1-5 read
  // as they did: rows of last month for both sides (the boy has been on the
  // 1XI since the seed's 15 January), and his mother's seats on lifts to two
  // 1XI fixtures ahead — fOld (the side he will leave) and fUp (whose sheet
  // names him), driven by the 1XI's coach.
  const P = new Date(Date.now() - 10 * 86400e3).toISOString();
  const d = {};
  d.fPast = (await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
       values ($1, $2, 'Smoke Move Last Month', $3, 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL, FROM, P]))[0].id;
  d.fNewPast = (await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
       values ($1, $2, 'Smoke Move New Side Last Month', $3, 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL, TO, P]))[0].id;
  await bowl(d.fPast, SARAH, "fPast");
  d.tPast = (await q(`insert into trip (match_id, school_id, pickup) values ($1, $2, 'Smoke move gate') returning id`, [d.fPast, HIL]))[0].id;
  d.tOld = (await q(`insert into trip (match_id, school_id, pickup) values ($1, $2, 'Smoke move gate') returning id`, [s.fOld, HIL]))[0].id;
  d.sPast = (await q(`insert into training_session (school_id, team_code, title, starts_at, duration_min, session_type)
       values ($1, $2, 'Smoke move last month nets', $3, 60, 'batting') returning id`, [HIL, FROM, P]))[0].id;
  d.pPast = (await q(`insert into news_post (scope, school_id, team_code, kind, fixture_id, title, body, published_at, author_id)
       values ('team', $1, $2, 'plan', $3, 'Smoke move last month plan', 'Smoke move: last month', $4::timestamptz - interval '1 day', $5)
       returning id`, [HIL, FROM, d.fPast, P, COACH]))[0].id;
  const MUM = await idOf(mother);
  const decl = (await q(`insert into lift_driver_declaration (person_id, school_id, vehicle_description, registration, seats, licence_held,
                                                              insured, roadworthy, belts, code_acknowledged, policy_version, expires_on)
       values ($1, $2, 'Smoke move estate', 'SMOKE GP', 3, true, true, true, true, true, 1, current_date + 300) returning id`, [COACH, HIL]))[0].id;
  const link = (await q(`select g.assignment_id, g.id from assignment_subject g join role_assignment a on a.id = g.assignment_id
                          where a.person_id = $1 and a.role = 'guardian' and g.player_id = $2 limit 1`, [MUM, PILLAY]))[0];
  for (const k of ["fOld", "fUp"]) {
    const o = (await q(`insert into lift_offer (school_id, match_id, team_code, leg, driver_id, declaration_id, seats, meet_kind, meet_at, fixture_starts_at)
         select $1, m.id, $2, 'out', $3, $4, 3, 'school', m.starts_at - interval '90 minutes', m.starts_at from match m where m.id = $5
         returning id`, [HIL, FROM, COACH, decl, s[k]]))[0].id;
    d["seat_" + k] = (await q(`insert into lift_seat (offer_id, player_id, consent_by, guardian_assignment_id, guardian_link_id, requested_by, state)
         values ($1, $2, 'guardian', $3, $4, $5, 'requested') returning id`, [o, PILLAY, link.assignment_id, link.id, MUM]))[0].id;
  }
  /** What a reader reads of the dated rows, through the API, by label. */
  const readsDated = async (token) => {
    const label = (id) => Object.keys(d).find((k) => d[k] === id);
    const pick = (rows) => (rows ?? []).map((r) => label(r.id)).filter(Boolean).sort().join(" ");
    const balls = (await api(`/api/matches/${d.fPast}/events`, { token })).body?.events?.length ?? 0;
    return `fixtures [${pick((await api("/api/read/matches", { token })).body?.rows)}]`
      + ` trips [${pick((await api("/api/read/trips", { token })).body?.rows)}]`
      + ` training [${pick((await api("/api/read/training", { token })).body?.rows)}]`
      + ` plans [${pick((await api("/api/read/news", { token })).body?.rows)}] balls [fPast:${balls}]`;
  };
  const datedBefore = { boy: await readsDated(boy), mum: await readsDated(mum) };

  group("1 · Before: on the 1XI he reads the 1XI's, and none of the U16B's");
  {
    const got = await reads(boy, s);
    ok("the boy reads the 1XI's fixtures, nets, plan and balls", got === "fixtures [fOld fUp] training [sOld] plans [pOld] balls [fOld:6 fUp:6]", got);
    const g = await reads(mum, s);
    ok("...as his mother does", g === got, g);
  }

  group("2 · The director moves him to the U16B, and his role follows");
  {
    const r = await api(`/api/players/${PILLAY}/team`, { method: "POST", token: head, body: { teamCode: TO } });
    ok("the move is made", r.status === 200 && r.body?.teamCode === TO, JSON.stringify(r.body));
    ok("...and the history says where he came from", r.body?.previous?.teamCode === FROM);
    const p = (await roles()).filter((x) => x.role === "player");
    const live = p.filter((x) => x.active), ended = p.filter((x) => !x.active);
    ok("one live player role, on the U16B", live.length === 1 && live[0].team_code === TO, JSON.stringify(p));
    ok("...made by the director", live[0]?.created_by === SARAH);
    ok("the 1XI role is ended and kept, stamped with her and the time",
       ended.some((x) => x.team_code === FROM && x.revoked_by === SARAH && x.revoked_at !== null), JSON.stringify(ended));
    ok("his self-access role is untouched", JSON.stringify((await roles()).filter((x) => x.role === "selfaccess")) === selfBefore);
    ok("no live player role anywhere names no side",
       (await q(`select count(*)::int c from role_assignment where role = 'player' and active and team_code is null`))[0].c === 0);
  }

  group("3 · After: he reads the U16B's, and of the 1XI only the match he plays up into");
  {
    const got = await reads(boy, s);
    ok("the boy reads the U16B's fixture, nets, plan and balls, and the 1XI match whose sheet names him, with every ball",
       got === "fixtures [fNew fUp] training [sNew] plans [pNew] balls [fNew:6 fUp:6]", got);
    const old = await api(`/api/matches/${s.fOld}/events`, { token: boy });
    ok("...and not one ball of his old side's other match", (old.body?.events ?? []).length === 0, JSON.stringify(old.body).slice(0, 200));
  }

  group("4 · His mother reads the side he reads");
  {
    const g = await reads(mum, s);
    ok("the same fixtures, nets, plan and balls", g === "fixtures [fNew fUp] training [sNew] plans [pNew] balls [fNew:6 fUp:6]", g);
  }

  group("5 · The route never moves him to no side");
  {
    const r = await api(`/api/players/${PILLAY}/team`, { method: "POST", token: head, body: { teamCode: "" } });
    ok("an empty side is refused", r.status === 400 && r.body?.error === "team_required", JSON.stringify(r.body));
    const p = (await roles()).filter((x) => x.role === "player" && x.active);
    ok("...and his role is still on the U16B", p.length === 1 && p[0].team_code === TO);
  }

  group("6 · The dated side (db/117): his mother keeps the 1XI's last month, and gains none of the U16B's");
  {
    const want = "fixtures [fPast] trips [tOld tPast] training [sPast] plans [pPast] balls [fPast:6]";
    ok("before the move, his mother reads the 1XI's last month and its bus ahead", datedBefore.mum === want, datedBefore.mum);
    ok("...and so does he", datedBefore.boy === want, datedBefore.boy);
    const g = await readsDated(mum);
    ok("after it, she still reads the 1XI's fixture, bus, nets, plan and balls of last month, not its bus ahead, and nothing of the U16B's before he joined",
       g === "fixtures [fPast] trips [tPast] training [sPast] plans [pPast] balls [fPast:6]", g);
    const b = await readsDated(boy);
    // He keeps his old season's fixture, bus, nets and balls by branch (5),
    // and its plan of last month by news_post_read_old_side (db/117 §4,
    // Kameel 22 October 2026). The U16B's past is not his: since db/129 his
    // `player` role reads the U16B only from the day he joined it (Q2), as
    // his mother does.
    ok("he still reads the 1XI's fixture, bus, nets, plan and balls of last month, and nothing of the U16B's before he joined",
       b === "fixtures [fPast] trips [tPast] training [sPast] plans [pPast] balls [fPast:6]", b);
  }

  group("7 · The move voided his mother's seat to the side he left, and told her");
  {
    const seat = async (id) => (await q(`select state, ended_by from lift_seat where id = $1`, [id]))[0];
    const old = await seat(d.seat_fOld), up = await seat(d.seat_fUp);
    ok("the seat to the 1XI's fixture ahead is void, ended by the director", old?.state === "void" && old?.ended_by === SARAH, JSON.stringify(old));
    ok("...the seat to the match whose sheet names him stands", up?.state === "requested", JSON.stringify(up));
    const told = async (id) => (await q(`select title from notification where recipient_id = $1 and kind = 'lift' and subject_id = $2`, [id, s.fOld])).map((r) => r.title).join(" / ");
    ok("his mother is told, once", (await told(MUM)) === "A seat on a lift was withdrawn", await told(MUM));
    ok("...and the driver, once, without why", (await told(COACH)) === "A seat was withdrawn", await told(COACH));
  }
} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`PLAYER MOVE SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

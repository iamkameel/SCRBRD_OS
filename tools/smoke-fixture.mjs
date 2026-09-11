#!/usr/bin/env node
/**
 * One fixture, two schools — and a route to arrange it, which never existed.
 *
 * `opponent` was free text. That is right for a school SCRBRD does not host
 * and it breaks the moment BOTH schools are tenants: one Saturday becomes two
 * unrelated rows, one at each school, and nothing joins them. No shared
 * ladder; no real head-to-head, because the derby read grouped on a string;
 * no away side's availability or team sheet; and both offices typing the same
 * fixture in twice.
 *
 * It is also the precondition for anything positional. A passport that can say
 * "top decile of U15 batters in KZN against pace" needs fixtures that span
 * tenants.
 *
 *   1. BOTH SCHOOLS READ ONE ROW, through the same capability asked at each
 *      side's scope. Neither gains anything it did not already hold.
 *   2. THE HOST OWNS THE RECORD. The away school reads and cannot move it.
 *   3. EACH SIDE NAMES ITS OWN XI AND ONLY ITS OWN.
 *   4. THE AWAY SIDE'S NAME IS STAMPED, NOT TYPED, so two spellings of one
 *      rival cannot become two rivals.
 *   5. NOTHING ABOUT THE OLD PATH CHANGES. A free-text opponent behaves
 *      exactly as before, which is what made this safe to land.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-fixture.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8857;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-fixture-secret" },
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
  method: "POST", body: { email, deviceId: "device-fixture" } })).body?.token;
const arrange = (token, body) => api("/api/fixtures", { method: "POST", token, body });
const amend = (id, token, body) => api(`/api/fixtures/${id}`, { method: "POST", token, body });
const fixtures = async (token) => (await api("/api/read/matches", { token })).body?.rows ?? [];
const pick = (m, token, side, players) =>
  api(`/api/matches/${m}/squad`, { method: "POST", token, body: { side, players } });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const soon = (days) => new Date(Date.now() + days * 864e5).toISOString();

/** One statement under a person's own policies, rolled back.
 *
 *  Two things here are load-bearing and both were got wrong first time.
 *
 *  SET LOCAL ROLE, because the migration role owns these tables and row-level
 *  security does not apply to an owner — without it the assertion proves
 *  nothing at all.
 *
 *  And THE ID IS RESOLVED BEFORE THE ROLE SWITCH. The first version passed an
 *  email and resolved it inside, which meant the subselect ran as scrbrd_app
 *  with no principal set yet, could not read app_user (its policy is
 *  `id = app_user_id()`), returned NULL, and set the principal to nobody. Every
 *  assertion then "passed" by seeing zero rows — including the ones meant to
 *  prove somebody CAN see something, which is how it was noticed. */
async function asPerson(email, sql, params = []) {
  const { rows: who } = await pool.query(`select id from app_user where email = $1`, [email]);
  const id = who[0]?.id ?? null;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE scrbrd_app");
    await c.query("SELECT set_config('app.user_id', $1, true)", [id]);
    const r = await c.query(sql, params);
    await c.query("ROLLBACK");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return { ok: false, code: e.code, message: e.message };
  } finally { c.release(); }
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const head    = await login("sarah@example.invalid");       // directorofsport, Hilton
  const coach   = await login("coach@example.invalid");       // Hilton 1XI
  const wesCoach= await login("coach.wes@example.invalid");   // Westville 1XI
  const wesAdmin= await login("registrar.wes@example.invalid");
  const watcher = await login("watcher@example.invalid");     // Hilton spectator

  group("A fixture can be arranged, which until now took a database client");
  {
    // fixture.update has been a capability in five roles with nothing it could
    // be exercised on — the same shape as the three transport capabilities
    // before they had a module.
    const r = await arrange(head, {
      schoolId: HIL, teamCode: "1XI", startsAt: soon(7),
      opponent: "Michaelhouse 1st XI", format: "T20", overs: 20 });
    ok("a director of sport can arrange one", r.status === 200);
    ok("...against a school that is not on SCRBRD", r.body?.opponent === "Michaelhouse 1st XI");
    ok("...and is told it is not shared", r.body?.sharedWithOpponent === false);
    ok("a spectator cannot arrange one", [403, 401].includes((await arrange(watcher, {
      schoolId: HIL, teamCode: "1XI", startsAt: soon(7), opponent: "Anyone" })).status));
    ok("nor can a coach at another school", [403, 401].includes((await arrange(wesCoach, {
      schoolId: HIL, teamCode: "1XI", startsAt: soon(7), opponent: "Anyone" })).status));

    ok("an away side has to be named", (await arrange(head, {
      schoolId: HIL, teamCode: "1XI", startsAt: soon(7) })).status === 400);
    // Two answers to one question. Picking a winner here would mean the API
    // quietly deciding which school a fixture is against.
    ok("...and named once", (await arrange(head, {
      schoolId: HIL, teamCode: "1XI", startsAt: soon(7),
      opponent: "Michaelhouse", awaySchoolId: WES, awayTeamCode: "1XI" })).status === 400);
    ok("a tenant away side needs its team", (await arrange(head, {
      schoolId: HIL, teamCode: "1XI", startsAt: soon(7), awaySchoolId: WES })).status === 400);
    ok("an unreadable date is refused", (await arrange(head, {
      schoolId: HIL, teamCode: "1XI", startsAt: "next Tuesday-ish", opponent: "X" })).status === 400);
  }

  group("Against a school that is also on SCRBRD, it is one row");
  {
    const r = await arrange(head, {
      schoolId: HIL, teamCode: "1XI", startsAt: soon(9),
      awaySchoolId: WES, awayTeamCode: "1XI", format: "T20", overs: 50 });
    ok("the fixture is arranged", r.status === 200);
    ok("...and says so", r.body?.sharedWithOpponent === true);
    // STAMPED, NOT TYPED. A typed name beside a school id is two sources of
    // truth for one fact, and the typed one drifts — which is how one rival
    // became two in the derby record.
    ok("the away side's name is stamped from the school",
       r.body?.opponent === "Westville Boys' High 1XI");
    const m = r.body.id;

    const hiltonSees = (await fixtures(coach)).find((f) => f.id === m);
    const wesSees    = (await fixtures(wesCoach)).find((f) => f.id === m);
    ok("the home coach sees it", !!hiltonSees);
    // THE UNLOCK. Before this the away school could not see the match it was
    // playing, so it kept its own copy and nothing joined them.
    ok("the away coach sees THE SAME ROW", !!wesSees && wesSees.id === hiltonSees.id);
    // A shared row means school_id is "the host", not "us" — so each side is
    // told which end it is at, by the same decision function that handed it
    // the row.
    ok("...and each is told which end they are at",
       hiltonSees.my_side === "home" && wesSees.my_side === "away");
    ok("...with both sides named, from either end",
       wesSees.home_label === "Hilton College 1XI"
       && wesSees.away_label === "Westville Boys' High 1XI");
    // The away school's coaches are not attached to the host, so they cannot
    // read its row in `school` — the label comes through a definer function
    // that returns a name and nothing else.
    // AND THE REASON THE LABEL NEEDS A DEFINER FUNCTION, asserted rather than
    // asserted about: the away coach genuinely cannot read the host school's
    // row, so a plain join would have given them a fixture against a uuid.
    const hostRow = await asPerson("coach.wes@example.invalid",
      `select count(*)::int c from school where id = $1`, [HIL]);
    ok("the away coach cannot read the host school's record",
       hostRow.ok && hostRow.rows[0].c === 0);
    ok("...and still gets the host's name on the fixture",
       typeof wesSees.home_label === "string" && wesSees.home_label.includes("Hilton"));
    ok("...while their own school is readable to them",
       (await asPerson("coach.wes@example.invalid",
          `select count(*)::int c from school where id = $1`, [WES])).rows[0].c === 1);

    // A coach scoped to another TEAM at the host school is not a participant
    // either. Team scope is not school scope.
    ok("a coach of another side at the host school does not see it",
       !(await fixtures(await login("coach2@example.invalid"))).some((f) => f.id === m));
    ok("a Hilton spectator sees it as a Hilton fixture",
       (await fixtures(watcher)).some((f) => f.id === m));

    group("The host owns the record");
    {
      ok("the host can move it", (await amend(m, head, { startsAt: soon(10) })).status === 200);
      // An away school that could edit the fixture could move the venue or the
      // time of somebody else's Saturday. Asking is a conversation.
      ok("the away school cannot move it",
         [403, 401].includes((await amend(m, wesCoach, { startsAt: soon(11) })).status));
      ok("...nor its administrator",
         [403, 401].includes((await amend(m, wesAdmin, { status: "abandoned" })).status));
      ok("...and it did not move",
         new Date((await q(`select starts_at from match where id=$1`, [m]))[0].starts_at)
           .toISOString().slice(0, 10) === soon(10).slice(0, 10));
      ok("a change with nothing in it is refused", (await amend(m, head, {})).status === 400);
      ok("an unknown status is refused", (await amend(m, head, { status: "rained-off" })).status === 400);
    }

    group("Each side names its own XI, and only its own");
    {
      const hilBoy = (await q(
        `select p.id from player p join player_guardian_status g on g.player_id = p.id
          where p.school_id = $1 and p.team_code = '1XI' and g.registration_state = 'active'
          order by p.full_name limit 1`, [HIL]))[0];
      const wesBoy = (await q(
        `select p.id from player p join player_guardian_status g on g.player_id = p.id
          where p.school_id = $1 and p.team_code = '1XI' and g.registration_state = 'active'
          order by p.full_name limit 1`, [WES]))[0];
      ok("both schools have a registered boy", !!hilBoy && !!wesBoy);

      ok("the home coach names the home side",
         (await pick(m, coach, "home", [{ playerId: hilBoy.id, battingNo: 1 }])).status === 200);
      // THE ASSERTION THE SIDE-FOLLOWING ANCHOR EXISTS FOR. Anchoring both
      // sides on the host would let a home coach name the opposition's XI.
      ok("the home coach cannot name the away side",
         [403, 401, 422].includes(
           (await pick(m, coach, "away", [{ playerId: wesBoy.id, battingNo: 1 }])).status));
      ok("the away coach names the away side",
         (await pick(m, wesCoach, "away", [{ playerId: wesBoy.id, battingNo: 1 }])).status === 200);
      ok("...and cannot name the home side",
         [403, 401, 422].includes(
           (await pick(m, wesCoach, "home", [{ playerId: hilBoy.id, battingNo: 2 }])).status));
      const sides = await q(
        `select side, count(*)::int c from match_squad
          where match_id = $1 and not withdrawn group by side order by side`, [m]);
      ok("the fixture ends up with one name on each side",
         sides.length === 2 && sides.every((r) => r.c === 1));
    }
  }

  group("A fixture against a school SCRBRD does not host has no away sheet");
  {
    const solo = (await arrange(head, {
      schoolId: HIL, teamCode: "1XI", startsAt: soon(12), opponent: "Michaelhouse 1st XI" })).body;
    const boy = (await q(
      `select p.id from player p join player_guardian_status g on g.player_id = p.id
        where p.school_id = $1 and p.team_code = '1XI' and g.registration_state = 'active'
        order by p.full_name limit 1`, [HIL]))[0];
    // Their roster is their own school's business, exactly as their
    // registration and eligibility are — and the refusal says so rather than
    // "not permitted".
    const away = await pick(solo.id, coach, "away", [{ playerId: boy.id }]);
    ok("nobody may write the opposition's team sheet", away.status !== 200);
    ok("...and the reason is stated", /not a school on SCRBRD/.test(JSON.stringify(away.body)));
    ok("the home side is unaffected",
       (await pick(solo.id, coach, "home", [{ playerId: boy.id, battingNo: 1 }])).status === 200);
  }

  group("A side cannot play itself, and a played fixture cannot change opponent");
  {
    const self = await q(
      `insert into match (school_id, team_code, away_school_id, away_team_code,
                          opponent, starts_at, sport, format, overs)
       values ($1,'1XI',$1,'1XI','x', now() + interval '3 days','cricket','T20',20)`, [HIL])
      .then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e.code }));
    ok("a fixture against yourself is refused", !self.ok && self.code === "23514");

    const m = (await arrange(head, {
      schoolId: HIL, teamCode: "1XI", startsAt: soon(13),
      awaySchoolId: WES, awayTeamCode: "1XI" })).body.id;
    await q(`insert into ball_event (match_id, school_id, seq, epoch, scorer_user_id, device_id,
                                     idempotency_key, client_seq, client_ts, kind)
             values ($1,$2,1,1,(select id from app_user where email='scorer@example.invalid'),
                     'd','fx1',1, now(), 'ball')`, [m, HIL]);
    const moved = await q(`update match set away_school_id = null, away_team_code = null
                            where id = $1`, [m])
      .then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e.code, message: e.message }));
    // Every derived figure — the scorecard, the ladder, a boy's average
    // against that school — was computed against whoever the away side was.
    ok("a played fixture's opponent is frozen", !moved.ok && moved.code === "23514");
    ok("...and says why", /ball log/.test(moved.message));
  }

  group("One rival, however it is spelled");
  {
    // The derby read grouped on the opponent string, so an office that typed
    // the name two ways had half a record under each.
    const a = (await arrange(head, { schoolId: HIL, teamCode: "1XI", startsAt: soon(20),
      awaySchoolId: WES, awayTeamCode: "1XI" })).body;
    await q(`update school set name = 'Westville Boys High' where id = $1`, [WES]);
    const b = (await arrange(head, { schoolId: HIL, teamCode: "1XI", startsAt: soon(21),
      awaySchoolId: WES, awayTeamCode: "1XI" })).body;
    ok("a renamed school stamps a different label", a.opponent !== b.opponent);
    ok("...but both fixtures name the same rival",
       (await q(`select count(distinct away_school_id)::int c from match
                  where id = any($1::uuid[])`, [[a.id, b.id]]))[0].c === 1);
    // The identity is the id; the string is only a label.
    const keys = await q(
      `select count(distinct coalesce(away_school_id::text, opponent))::int c
         from match where id = any($1::uuid[])`, [[a.id, b.id]]);
    ok("...and the derby read groups them as one", keys[0].c === 1);
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`FIXTURE SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

#!/usr/bin/env node
/**
 * The derby: what a school remembers about a rivalry.
 *
 * scrbrd-beta-2 stored the tally — totalClashes, winsA, winsB, draws — on the
 * rivalry row. This derives every number from the fixtures and stores only the
 * two things no query could produce: the name of the fixture and the year it
 * started. A scorecard corrected in March moves the record here; there it
 * would have left a stale count with nothing able to say which number was
 * right.
 *
 * The three properties this walk exists to hold:
 *
 *   1. THE TALLY IS DERIVED. Change a result, and the record changes with it.
 *   2. THE TALLY IS SCOPED. It counts the fixtures the READER may see, like
 *      every other aggregate here. An accurate record computed over matches
 *      somebody cannot see would disclose that those matches exist.
 *   3. AN UNKNOWN RESULT IS REPORTED, NOT GUESSED. Who won is read from the
 *      toss; a match whose toss was never recorded has a known score and an
 *      unknowable winner, and is counted as undecided rather than assigned.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-derby.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8827;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-derby-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { token } = {}) => {
  const res = await fetch(BASE + path, {
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => {
  const res = await fetch(`${BASE}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, deviceId: "device-derby" }) });
  return (await res.json().catch(() => null))?.token;
};
const record = async (token, opponent) =>
  (await api(`/api/read/derby_record?opponent=${encodeURIComponent(opponent)}`, { token })).body?.rows || [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const head   = await login("sarah@example.invalid");     // directorofsport
  const coach  = await login("coach@example.invalid");     // 1XI only
  const scorer = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;

  const OPP = `Derbyshire College ${Date.now()}`;
  let seq = 0;
  const stamp = `${Date.now()}-${Math.random()}`;

  /**
   * One completed fixture, scored for real.
   *
   * `homeRuns`/`awayRuns` are what each side made; the toss decides which of
   * them batted first, so the derived winner has to come out right whichever
   * way round the innings were bowled.
   */
  const playedMatch = async ({ team = "1XI", homeRuns, awayRuns, homeBatsFirst = true, daysAgo = 10, toss = true }) => {
    const m = (await q(
      `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
       values ($1,$2,$3, now() - ($4 || ' days')::interval,'T20',20,'complete') returning id`,
      [HIL, team, OPP, String(daysAgo)]))[0].id;
    if (toss) {
      // won_by 'home' + 'bat' means home bats first; 'home' + 'bowl' means away does.
      await q(
        `insert into match_toss (match_id, school_id, won_by, decision, called_by, called_at)
         values ($1, $2, 'home', $3, $4, now())`,
        [m, HIL, homeBatsFirst ? "bat" : "bowl", scorer]);
    }
    const innings = homeBatsFirst ? [homeRuns, awayRuns] : [awayRuns, homeRuns];
    for (let i = 0; i < innings.length; i++) {
      for (let r = 0; r < innings[i]; r++) {
        seq += 1;
        await q(
          `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                                   idempotency_key, client_seq, client_ts, kind, ball_type, value, payload)
           values ($1,$2,$3,1,$4,$5,'device-derby',$6,$3,now(),'ball','run',1,'{}'::jsonb)`,
          [m, HIL, seq, i, scorer, `derby-${stamp}-${seq}`]);
      }
    }
    return m;
  };

  group("The record is counted from the fixtures, not stored beside them");
  await playedMatch({ homeRuns: 120, awayRuns: 90,  homeBatsFirst: true,  daysAgo: 30 }); // won
  await playedMatch({ homeRuns: 80,  awayRuns: 110, homeBatsFirst: true,  daysAgo: 25 }); // lost
  await playedMatch({ homeRuns: 100, awayRuns: 100, homeBatsFirst: true,  daysAgo: 20 }); // tied
  let r = (await record(head, OPP))[0];
  ok("the rivalry appears once the fixtures exist", !!r);
  ok("three played", r?.played === 3);
  ok("one won", r?.won === 1);
  ok("one lost", r?.lost === 1);
  ok("one tied", r?.tied === 1);
  ok("nothing invented in between", r?.undecided === 0);

  group("Chasing is not the same as scoring more first");
  // The same scores with the innings the other way round must give the same
  // winner. Getting this wrong reverses every chase in the archive.
  await playedMatch({ homeRuns: 150, awayRuns: 149, homeBatsFirst: false, daysAgo: 15 });
  r = (await record(head, OPP))[0];
  ok("a successful chase is a win, not a loss", r?.won === 2 && r?.lost === 1);

  group("An unknowable result is reported, never assigned");
  await playedMatch({ homeRuns: 130, awayRuns: 60, daysAgo: 12, toss: false });
  r = (await record(head, OPP))[0];
  ok("a match with no toss cannot be attributed to either side", r?.undecided === 1);
  ok("...and is still counted as played", r?.played === 5);
  ok("...without being quietly handed to the higher score", r?.won === 2);

  group("The name is stored because nothing can derive it");
  ok("no name until somebody gives one", r?.title === null);
  await q(`insert into derby (school_id, opponent, title, since_year) values ($1,$2,$3,$4)`,
          [HIL, OPP, "The Long Room Match", 1892]);
  r = (await record(head, OPP))[0];
  ok("the fixture has a name", r?.title === "The Long Room Match");
  ok("...and a founding year no query could have produced", r?.since_year === 1892);
  ok("naming it did not change a single number", r?.played === 5 && r?.won === 2);

  group("The last few encounters come back with it");
  ok("at most five, newest first", Array.isArray(r?.recent) && r.recent.length === 5);
  ok("each one carries how it went", r.recent.every((e) => typeof e.result === "string"));
  ok("...and the scores it was decided on",
     r.recent.every((e) => e.first_runs != null || e.result === "undecided"));

  group("The tally is the reader's, like every other aggregate here");
  // A 1XI coach is scoped to one team. The record they get must cover the
  // fixtures they can see and no others — an aggregate discloses as surely as
  // a row, so a "complete" record would tell them about matches they may not
  // read.
  await playedMatch({ team: "U15A", homeRuns: 70, awayRuns: 40, daysAgo: 8 });
  const forHead  = (await record(head, OPP))[0];
  const forCoach = (await record(coach, OPP))[0];
  ok("the director of sport counts the U15A fixture too", forHead?.played === 6);
  ok("the 1XI coach's record is not larger than the director's",
     (forCoach?.played ?? 0) <= forHead.played);
  ok("...and the difference is the fixtures outside their scope",
     (forCoach?.played ?? 0) < forHead.played);
  ok("an unauthenticated request is refused rather than answered",
     [401, 403].includes((await api(`/api/read/derby_record?opponent=${encodeURIComponent(OPP)}`)).status));

  group("Correcting a result moves the record, which is the whole point");
  // The tied match, corrected the only way this schema allows: the log is
  // append-only and enforced by trigger, so runs are not edited away — a
  // `void` event is appended naming the ball it undoes, and ball_event_live
  // stops counting it. An UPDATE here is refused outright, which is how the
  // first version of this test found out it was cheating.
  const tied = (await q(
    `select id from match where opponent = $1 and status = 'complete'
      order by starts_at limit 1 offset 2`, [OPP]))[0].id;
  const doomed = await q(
    `select idempotency_key from ball_event
      where match_id = $1 and innings = 1 order by seq desc limit 10`, [tied]);
  for (const d of doomed) {
    seq += 1;
    await q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                               idempotency_key, client_seq, client_ts, kind, payload)
       values ($1,$2,$3,1,1,$4,'device-derby',$5,$3,now(),'void',$6::jsonb)`,
      [tied, HIL, seq, scorer, `derby-void-${stamp}-${seq}`,
       JSON.stringify({ target: d.idempotency_key, reason: "smoke_correction" })]);
  }
  r = (await record(head, OPP))[0];
  ok("ten runs taken back off the chase ends the tie", r?.tied === 0);
  // Four, not three: the U15A fixture added a win just above. Getting this
  // wrong the first time is the reason the walk asserts a whole tally rather
  // than one number — a single figure read in isolation looks right far too
  // easily.
  ok("...and the side batting first now has the win", r?.won === 4);
  ok("...with the number of matches played unchanged — a correction is not a deletion",
     r?.played === 6);

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`DERBY SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

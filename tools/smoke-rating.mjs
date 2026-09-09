#!/usr/bin/env node
/**
 * A coach's number, and the ball log arguing with it.
 *
 * The rating model says a coach's assessment is the ANCHOR and match evidence
 * moves the rating away from it, weighted by how much evidence there is. That
 * arithmetic is unit-tested. What is NOT testable in a unit test is the thing
 * most likely to be wrong: which deliveries count.
 *
 * The evidence that may move a rating is what happened SINCE the coach last
 * looked. A judgement made in September already contains everything its author
 * saw before September, so feeding older cricket back in dilutes the fresh
 * judgement they just made — silently, and in a direction nobody would notice.
 *
 * So the assertions worth reading here are about the WINDOW:
 *
 *   balls before the assessment do not move it
 *   balls after it do
 *   a fresh assessment re-anchors and discards the evidence it already contains
 *   the two disciplines anchor independently
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-rating.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8803;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL     = "11111111-1111-1111-1111-111111111111";
const P_OWN   = "aaaaaaaa-0000-0000-0000-000000000001";  // James Whitfield, 1XI
const P_MATE  = "aaaaaaaa-0000-0000-0000-000000000002";  // T Bekker, 1XI
const U_COACH = "88888888-0000-0000-0000-000000000004";
const MATCH   = "77777777-0000-0000-0000-000000000001";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-rating-secret" },
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
  method: "POST", body: { email, deviceId: "device-rating" } })).body?.token;
const ratings = async (token) => (await api("/api/read/ratings", { token })).body?.rows ?? [];
const ratingFor = async (token, player) =>
  (await ratings(token)).find((r) => r.player_id === player);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

let seq = 5000;
/** Put deliveries in the log at a chosen moment, as the owner. */
async function logBalls(player, { runs, balls, daysAgo, outs = 0 }) {
  for (let i = 0; i < balls; i++) {
    seq++;
    const isOut = i < outs;
    await q(
      `insert into ball_event
         (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
          idempotency_key, client_seq, client_ts, server_ts, kind, ball_type,
          value, striker_id, bowler_id, dismissal)
       values ($1,$2,$3,1,0,$4,'device-rating',$5,$3, now(),
               now() - make_interval(days => $6), 'ball', $7, $8, $9, null, $10)`,
      [MATCH, HIL, seq, U_COACH, `rating-${seq}`, daysAgo,
       isOut ? "W" : "run", isOut ? 0 : Math.round(runs / Math.max(1, balls - outs)),
       player, null]);
  }
}

const assess = (player, token, scores, assessedOn) =>
  api(`/api/players/${player}/assessment`, {
    method: "POST", token, body: { assessedOn, scores } });

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const coach = await login("coach@example.invalid");
  const watcher = await login("watcher@example.invalid");

  // A clean slate for this player: the seed carries an assessment already.
  await q(`delete from player_skill where player_id = $1`, [P_OWN]);
  await q(`delete from ball_event where striker_id = $1 or bowler_id = $1`, [P_OWN]);

  group("Cricket nobody has assessed is a rating with no anchor");
  await logBalls(P_OWN, { runs: 300, balls: 200, daysAgo: 60, outs: 10 });
  const noAnchor = await ratingFor(coach, P_OWN);
  ok("the rating exists on match data alone", noAnchor?.batting.value != null);
  ok("...and says it has no coach behind it", noAnchor.batting.basis === "performance");
  ok("...and reports no drift, because there is nothing to have drifted from",
     noAnchor.batting.drift === null);

  group("An assessment anchors it, and discards what it already contains");
  // Dated TODAY, so all 200 balls above are older than the anchor.
  const a = await assess(P_OWN, coach, { technical: { footwork: 17, timing: 17, power: 16 } });
  ok("the coach records an assessment", a.status === 200);
  const anchored = await ratingFor(coach, P_OWN);
  ok("the rating becomes the coach's number", anchored.batting.value === 16.7);
  ok("...unmoved, because every ball predates the judgement",
     anchored.batting.drift === 0 && anchored.batting.basis === "coach");
  // THE ASSERTION THIS FILE EXISTS FOR. Those 200 balls are still in the log
  // and still in the lifetime career view; they are simply not evidence about
  // a judgement made after them.
  const lifetime = await q(
    `select balls_faced from player_batting_career where player_id = $1`, [P_OWN]);
  ok("...though the deliveries are still on the record",
     Number(lifetime[0]?.balls_faced) === 200);
  ok("...and the rating names the day it was anchored",
     anchored.batting.anchoredOn?.slice(0, 10) === new Date().toISOString().slice(0, 10));

  group("Cricket played SINCE the assessment moves it");
  // A poor run, after the assessment. Dated in the future rather than the past,
  // because "since" is what is being tested and today's anchor is midnight.
  await q(
    `insert into ball_event
       (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
        idempotency_key, client_seq, client_ts, server_ts, kind, ball_type,
        value, striker_id)
     select $1,$2, 6000 + g, 1, 0, $3, 'device-rating', 'after-' || g, 6000 + g,
            now(), now() + interval '1 hour', 'ball',
            case when g <= 12 then 'W' else 'run' end,
            case when g <= 12 then 0 else 1 end, $4
       from generate_series(1, 120) g`,
    [MATCH, HIL, U_COACH, P_OWN]);
  const moved = await ratingFor(coach, P_OWN);
  ok("the rating has moved", moved.batting.drift !== 0);
  ok("...downwards, because the evidence is poor", moved.batting.drift < 0);
  ok("...and the coach's number is still there beside it", moved.batting.coach === 16.7);
  ok("...and it says what moved it", /deliveries of match data/.test(moved.batting.explanation));
  ok("...weighted by the evidence since the anchor, not the lifetime total",
     moved.batting.sample === 120);
  // 120 balls against a prior of 120 is exactly half weight — the one point on
  // the curve that can be checked by hand.
  ok("...at half weight, which is what 120 against a prior of 120 means",
     moved.batting.performanceWeight === 0.5);

  group("Re-assessing re-anchors, and the poor run stops counting");
  const b = await assess(P_OWN, coach, { technical: { footwork: 15 } },
                         new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10));
  ok("a later assessment is accepted", b.status === 200);
  const reanchored = await ratingFor(coach, P_OWN);
  ok("the anchor moves to the newer judgement", reanchored.batting.anchoredOn?.slice(0, 10)
     === new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10));
  ok("...taking the latest score for each attribute, not only the newest row",
     reanchored.batting.attributes === 3);
  ok("...and the rating is unmoved again, because the coach has now seen it all",
     reanchored.batting.drift === 0);

  group("The two disciplines anchor independently");
  // He has never bowled and has never been assessed on it.
  ok("an unbowled, unassessed discipline has no rating",
     reanchored.bowling.value === null && reanchored.bowling.basis === "none");
  ok("...and its anchor is its own, not the batting one",
     reanchored.bowling.anchoredOn === null && reanchored.batting.anchoredOn !== null);

  group("A rating is scoped like everything else");
  const seen = await ratings(coach);
  ok("the 1st XI coach reads their own side", seen.some((r) => r.player_id === P_MATE));
  const spectator = await ratings(watcher);
  ok("a spectator reads no ratings at all", spectator.length === 0);
  // A coach who cannot read another side's assessments gets no coach half —
  // not somebody else's number.
  const otherSide = seen.find((r) => r.player_id === "aaaaaaaa-0000-0000-0000-000000000006");
  ok("...and a player in another side discloses no assessment",
     !otherSide || otherSide.batting.coach === null);

  group("And the disclosure is logged");
  await q(`delete from access_log`);
  await ratings(coach);
  const logged = await q(`select * from access_log where resource = 'ratings'`);
  ok("reading ratings writes an entry", logged.length === 1);
  ok("...naming the children it was about", (logged[0]?.record_ids ?? []).includes(P_OWN));
  ok("...and that a coach's judgement was among what came back",
     (logged[0]?.fields ?? []).includes("batting.coach"));
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", e.message);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:\n" + serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nRATING SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

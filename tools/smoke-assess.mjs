#!/usr/bin/env node
/**
 * Recording a coach's assessment, against a real database.
 *
 * A coach is the half of a player's rating a ball log cannot produce. This
 * walk proves they can record one for the side they coach, that the same
 * request is refused for a side they do not, and that nothing in the handler
 * is deciding either — player_skill's INSERT policy is.
 *
 * The refusal case is the one that matters. A write path that silently writes
 * nothing and reports success is worse than one that errors: a coach is told
 * the assessment is saved, and it is not there in the morning.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-assess.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { battingIndex, bowlingIndex, coachIndex, adjustedRating } from "@scrbrd/scoring";

const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const P_OWN  = "aaaaaaaa-0000-0000-0000-000000000001";  // J Whitfield, 1XI
const P_U16B = "aaaaaaaa-0000-0000-0000-000000000006";  // K Dlamini, U16B
const P_WES  = "bbbbbbbb-0000-0000-0000-000000000001";  // D Mkhize, Westville

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-assess-secret" },
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
  method: "POST", body: { email, deviceId: "device-assess" } })).body?.token;
const assess = (playerId, token, body) =>
  api(`/api/players/${playerId}/assessment`, { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const dbq = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach   = await login("coach@example.invalid");     // 1XI
  const medic   = await login("medical@example.invalid");
  const parent  = await login("parent@example.invalid");
  const pupil   = await login("pillay@example.invalid");

  group("A coach records an assessment for the side they coach");
  const good = await assess(P_OWN, coach, {
    note: "Strong through the off side; work on rotating strike.",
    scores: { technical: { footwork: 16, timing: 15, power: 14, catching: 15 },
              mental:    { concentration: 17, composure: 15 } },
  });
  ok("the assessment is accepted", good.status === 200);
  ok("...and reports how many metrics were recorded", good.body?.recorded === 6);

  // Scoped to TODAY. The seed already carries assessments for this player from
  // a month ago — the first version of this walk counted the whole table and
  // failed against its own fixture, which is a test bug and would have been an
  // easy one to "fix" by loosening the assertion instead of reading the seed.
  const stored = await dbq(
    `select category, metric, score, assessed_by is not null as attributed
       from player_skill
      where player_id = $1 and assessed_on = current_date
      order by category, metric`, [P_OWN]);
  ok("six rows are in the database", stored.length === 6);
  ok("every one names who assessed", stored.every((r) => r.attributed));
  ok("the scores are what was sent",
     stored.find((r) => r.metric === "footwork")?.score === 16);

  group("Revising on the same day corrects; a later date is history");
  const revised = await assess(P_OWN, coach, {
    scores: { technical: { footwork: 18 } },
  });
  ok("a same-day revision is accepted", revised.status === 200);
  const after = await dbq(
    `select score from player_skill
      where player_id = $1 and category = 'technical' and metric = 'footwork'
        and assessed_on = current_date`, [P_OWN]);
  ok("...and replaces rather than duplicating", after.length === 1 && after[0].score === 18);

  const later = await assess(P_OWN, coach, {
    assessedOn: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
    scores: { technical: { footwork: 19 } },
  });
  ok("a later date is a new assessment", later.status === 200);
  // Three now: the seeded one from a month ago, today's, and next month's.
  const history = await dbq(
    `select count(*)::int n from player_skill
      where player_id = $1 and category = 'technical' and metric = 'footwork'`, [P_OWN]);
  ok("...so the trend survives, which is the point of the record", history[0].n === 3);

  group("And nowhere else");
  // The 1st XI coach does not coach U16B. Same request, same capability, and the
  // policy anchors resolve through the player's CURRENT side.
  const otherSide = await assess(P_U16B, coach, { scores: { technical: { footwork: 12 } } });
  ok("a coach cannot assess a player in another side", otherSide.status === 403);
  ok("...and is told so, rather than told it saved",
     otherSide.body?.error === "not_permitted");
  const leaked = await dbq(
    `select count(*)::int n from player_skill
      where player_id = $1 and assessed_on = current_date`, [P_U16B]);
  ok("...and nothing was written", leaked[0].n === 0);

  const otherSchool = await assess(P_WES, coach, { scores: { technical: { footwork: 12 } } });
  ok("nor a player at another school", otherSchool.status === 403);

  group("Nor can anyone without the capability");
  // A physiotherapist holds the whole medical record and no development write.
  ok("medical staff cannot rate a player's footwork",
     (await assess(P_OWN, medic, { scores: { technical: { footwork: 10 } } })).status === 403);
  ok("a parent cannot rate their own child",
     (await assess(P_OWN, parent, { scores: { technical: { footwork: 19 } } })).status === 403);
  ok("a pupil cannot rate themselves",
     (await assess(P_OWN, pupil, { scores: { technical: { footwork: 19 } } })).status === 403);
  ok("an unauthenticated request is refused",
     (await assess(P_OWN, null, { scores: { technical: { footwork: 9 } } })).status === 401);

  group("A malformed assessment is refused before it reaches the table");
  for (const [name, body] of [
    ["an unknown category",  { scores: { sorcery: { x: 50 } } }],
    ["an unknown attribute", { scores: { technical: { vibes: 12 } } }],
    ["an unknown group",     { scores: { spiritual: { footwork: 12 } } }],
    ["an attribute in the wrong group", { scores: { physical: { footwork: 12 } } }],
    ["a score above 20",     { scores: { technical: { footwork: 21 } } }],
    ["a score of zero",      { scores: { technical: { footwork: 0 } } }],
    ["a negative score",     { scores: { technical: { footwork: -1 } } }],
    ["a non-integer score",  { scores: { technical: { footwork: 13.5 } } }],
    ["the old 0-100 scale",  { scores: { technical: { footwork: 82 } } }],
    ["no scores at all",     { scores: {} }],
    ["no body",              {}],
  ]) {
    const r = await assess(P_OWN, coach, body);
    ok(`${name} is refused`, r.status === 400);
  }
  const untouched = await dbq(
    `select count(*)::int n from player_skill
      where player_id = $1 and assessed_on = current_date`, [P_OWN]);
  ok("...and none of them left a partial row", untouched[0].n === 6);

  group("The two halves of a rating stay apart");
  // The coach's number and the ball log's number are computed separately and
  // combined explicitly. A blend that hid which half moved would be useless the
  // first time a coach disagreed with it in front of a parent.
  const [career] = await dbq(
    `select coalesce(bat.runs,0) runs, coalesce(bat.balls_faced,0) balls,
            coalesce(d.dismissals,0) outs
       from player p
       left join player_batting_career bat on bat.player_id = p.id
       left join player_dismissals d on d.player_id = p.id
      where p.id = $1`, [P_OWN]);
  const perf = battingIndex({ runs: career.runs, ballsFaced: career.balls, dismissals: career.outs });
  const rows = await dbq(
    `select metric, score from player_skill
      where player_id = $1 and category = 'technical' and assessed_on = current_date`, [P_OWN]);
  const coachNum = coachIndex(Object.fromEntries(rows.map((r) => [r.metric, r.score])));

  ok("the coach's number comes from their own metrics", coachNum.value !== null);
  // The seed has no balls in this fixture, so the index correctly refuses.
  ok("the performance index refuses a player with no match data", perf.value === null);
  // The coach's number is the ANCHOR, and match evidence moves it. Here there
  // is no evidence at all, so it must not move — and `sample` is the real
  // balls_faced off the career view rather than a literal, because the number
  // the model shrinks against has to be the number the ball log actually
  // produces.
  const c = adjustedRating({ coach: coachNum.value, performance: perf.value,
                             sample: career.balls });
  ok("with no match data the rating is the assessment, unmoved", c.value === coachNum.value);
  ok("...and reports no drift rather than halving them",
     c.basis === "coach" && c.drift === 0);
  ok("...and no weight has passed to a performance index that does not exist",
     c.performanceWeight === 0);
} catch (e) {
  ok(`the assessment walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nASSESSMENT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

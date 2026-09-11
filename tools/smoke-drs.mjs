#!/usr/bin/env node
/**
 * DRS, and the switch that keeps it off.
 *
 * The review panel is correct and is not yet trustworthy, which are different
 * things. "Pitching in line" and "would have hit leg stump" are ball-tracking
 * outputs; until there are cameras on a school ground, every value a person
 * could enter is a judgement. Shipping it switched on would put a
 * Hawk-Eye-shaped screen in front of a parent over a number an umpire guessed.
 *
 * So this walk holds two things, and the second is the one that matters:
 *
 *   1. THE FEATURE WORKS. Turn it on and a review records correctly, with the
 *      Law 36 components and — always — how they were known.
 *   2. THE SWITCH IS REAL. Off means off for everybody, including a caller who
 *      never loads the UI. A feature whose only guard is a hidden button is a
 *      feature everyone with a fetch call still has.
 *
 * And the third, which is the reason the flag exists at all: a review can
 * never be recorded without saying whether a person judged it, a replay showed
 * it, or a tracking system measured it.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-drs.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8829;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-drs-secret" },
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
  method: "POST", body: { email, deviceId: "device-drs" } })).body?.token;

const setFlag = (key, token, body) =>
  api(`/api/admin/features/${key}`, { method: "POST", token, body });
const review = (matchId, token, body) =>
  api(`/api/matches/${matchId}/drs`, { method: "POST", token, body });
// The raw response as well as the rows: asserting that a read is REFUSED
// needs the status, and a helper that returns [] for both "no reviews" and
// "the feature is off" cannot tell those apart.
const reviewsRaw = (matchId, token) =>
  api(`/api/read/drs_reviews?matchId=${matchId}`, { token });
const reviews = async (matchId, token) =>
  (await reviewsRaw(matchId, token)).body?.rows || [];
const flags = async (token) =>
  (await api("/api/read/feature_flags", { token })).body?.rows || [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

const A_REVIEW = {
  ballSeq: 1, calledBy: "fielding", onField: "not_out", outcome: "overturned",
  pitching: "in_line", impact: "in_line", wickets: "hitting", shotOffered: false,
  evidenceSource: "umpire_eye", notes: "Struck on the back leg, playing back.",
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const platform = await login("platform@example.invalid");   // platform.feature.manage
  const head     = await login("sarah@example.invalid");      // directorofsport: scoring.correct
  const scorer   = await login("scorer@example.invalid");     // scoring.correct
  const parent   = await login("parent@example.invalid");     // fixture.read only
  const su = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;

  // A completed match with one delivery to review.
  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() - interval '1 day','T20',20,'complete') returning id`,
    [HIL]))[0].id;
  await q(
    `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                             idempotency_key, client_seq, client_ts, kind, ball_type, value, payload)
     values ($1,$2,1,1,0,$3,'device-drs',$4,1,now(),'ball','W',0,'{}'::jsonb)`,
    [m, HIL, su, `drs-${Date.now()}-${Math.random()}`]);

  group("It ships switched off, and says why");
  const declared = (await flags(head)).find((f) => f.key === "drs_review");
  ok("the flag exists without anybody creating it", !!declared);
  ok("...and it is off", declared?.enabled === false);
  ok("...with a reason a person can read in a year's time",
     /ball-tracking|cameras/i.test(declared?.reason || ""));

  group("Off means off for everybody, not just for people who use the screen");
  // The whole point. This request never touched a UI.
  const blocked = await review(m, head, A_REVIEW);
  ok("a director of sport holding scoring.correct is still refused", blocked.status === 409);
  ok("...and told which switch, rather than 'invalid'", blocked.body?.error === "feature_disabled");
  ok("...with a message naming the flag and who can move it",
     /feature_flag\.drs_review/.test(blocked.body?.detail || "") &&
     /platform\.feature\.manage/.test(blocked.body?.detail || ""));
  ok("a scorer likewise", (await review(m, scorer, A_REVIEW)).status === 409);
  ok("nothing was written", (await reviews(m, head)).length === 0);

  group("Only a platform capability can move the switch");
  ok("a director of sport cannot enable it",
     [403, 401].includes((await setFlag("drs_review", head,
       { enabled: true, reason: "we would like it on" })).status));
  ok("nor a scorer",
     [403, 401].includes((await setFlag("drs_review", scorer,
       { enabled: true, reason: "we would like it on" })).status));
  ok("nor an unauthenticated caller",
     [401, 403].includes((await setFlag("drs_review", undefined,
       { enabled: true, reason: "we would like it on" })).status));
  ok("...and it is still off", (await flags(head)).find((f) => f.key === "drs_review")?.enabled === false);

  group("Turning something on requires saying what changed");
  // Off needs no explanation. On overrides somebody's decision that the
  // feature was not yet trustworthy, and should have to justify itself.
  ok("enabling with no reason is refused",
     (await setFlag("drs_review", platform, { enabled: true })).status === 400);
  ok("enabling with a blank one likewise",
     (await setFlag("drs_review", platform, { enabled: true, reason: "   " })).status === 400);

  const on = await setFlag("drs_review", platform,
    { enabled: true, reason: "Ball-tracking installed at the No.1 ground for the pilot." });
  ok("the platform administrator can, with a reason", on.status === 200);
  ok("...and the switch records who moved it",
     !!(await q(`select changed_by from feature_flag where key = 'drs_review'`))[0]?.changed_by);

  group("With it on, a review records — and always says how it was known");
  const rec = await review(m, head, A_REVIEW);
  ok("the review is accepted", rec.status === 200);
  ok("...and carries its evidence source back", rec.body?.evidence_source === "umpire_eye");
  const [row] = await reviews(m, head);
  ok("the Law 36 components are recorded",
     row?.pitching === "in_line" && row?.impact === "in_line" && row?.wickets === "hitting");
  ok("...along with what the umpire had given and what the review did to it",
     row?.on_field === "not_out" && row?.outcome === "overturned");
  ok("a guardian who may read the fixture sees it — the decision was announced",
     (await reviews(m, parent)).length === 1);

  group("A review that will not say how it was known is not recorded");
  // The single rule this feature exists to keep. Without it a screen can render
  // an umpire's opinion in the visual language of a measurement.
  const { evidenceSource, ...blind } = A_REVIEW;
  ok("no evidence source, no review",
     (await review(m, head, { ...blind, ballSeq: 1 })).status === 400);
  ok("...and an invented one is refused too",
     (await review(m, head, { ...A_REVIEW, evidenceSource: "hawkeye" })).status === 400);
  ok("the honest row is untouched",
     (await reviews(m, head))[0]?.evidence_source === "umpire_eye");

  group("The rest of the vocabulary is closed, and the delivery must exist");
  ok("an unknown outcome", (await review(m, head, { ...A_REVIEW, outcome: "maybe" })).status === 400);
  ok("an unknown pitching", (await review(m, head, { ...A_REVIEW, pitching: "somewhere" })).status === 400);
  ok("a review of a ball nobody bowled",
     [404, 400].includes((await review(m, head, { ...A_REVIEW, ballSeq: 999 })).status));
  ok("a review by somebody who may not correct a scorecard",
     [403, 401].includes((await review(m, parent, { ...A_REVIEW })).status));

  group("One review per delivery; a second corrects the first");
  const again = await review(m, head, { ...A_REVIEW, outcome: "upheld", evidenceSource: "video_replay" });
  ok("the correction is accepted", again.status === 200);
  const all = await reviews(m, head);
  ok("there is still one review of that ball", all.length === 1);
  ok("...and it is the corrected one", all[0]?.outcome === "upheld");
  ok("...whose evidence source moved with it", all[0]?.evidence_source === "video_replay");

  group("Switching it back off stops new reviews without erasing old ones");
  // A flag governs what may be recorded, never what was. Deleting history
  // because a feature was withdrawn would be a worse fabrication than the one
  // the flag exists to prevent.
  //
  // WHAT "WITHOUT ERASING" MEANS CHANGED, and this assertion changed with it.
  // Reviews used to stay READABLE with the feature off, because a flag then
  // gated only writes. Modules and features now gate their reads too — that is
  // what "switch off Injuries" has to mean if the setting is to be worth
  // anything — so a school that turns DRS off stops seeing DRS panels on old
  // scorecards as well as new ones. That is not erasure and the difference is
  // the whole point: the rows are untouched, and switching it back on brings
  // them back exactly as they were. Asserted both ways below, which is a
  // stronger statement of the original principle than "still readable" was.
  ok("the platform administrator switches it off",
     (await setFlag("drs_review", platform, { enabled: false, reason: "Cameras removed for winter." })).status === 200);
  ok("a new review is refused again", (await review(m, head, { ...A_REVIEW, ballSeq: 1 })).status === 409);
  ok("...and the reviews stop being served", (await reviewsRaw(m, head)).status === 403);
  ok("...but NOTHING WAS DELETED",
     (await q(`select count(*)::int c from drs_review where match_id = $1`, [m]))[0].c === 1);
  ok("...and switching it on again brings the record back untouched",
     (await setFlag("drs_review", platform, { enabled: true, reason: "Cameras back." })).status === 200
       && (await reviews(m, head)).length === 1
       && (await reviews(m, head))[0]?.outcome === "upheld");
  await setFlag("drs_review", platform, { enabled: false, reason: "Cameras removed for winter." });

  group("An unknown feature is off, not on");
  // A typo in a flag name must never switch something on for the platform.
  ok("feature_enabled() of a name nobody declared is false",
     (await q(`select feature_enabled('no_such_feature') as on`))[0].on === false);

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`DRS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

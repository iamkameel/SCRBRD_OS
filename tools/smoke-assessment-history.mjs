#!/usr/bin/env node
/**
 * GA-I26a over HTTP: corrections, the coaching point, the target, the side's
 * plan, the register and "since the last look" (db/104, db/105).
 *
 * db/99 §81 and §82 prove the policies and the functions as each person. This
 * walk proves the half they cannot reach: the routes and their statuses, the
 * reads as the API runs them (withdrawn rows left out of `skills` and the
 * ratings, struck in the history), every read of a boy's judgement landing in
 * the access log against him, `injured` refused by the register's route and
 * read back as `excused`, and the CSV export refusing every development read
 * (it served `skills`, `ratings` and `notes` before this build).
 *
 * The boy is R Pillay (1XI), who has an account (player + selfaccess) and a
 * parent (parent@). Three staff the seed lacks are added as the owner: a
 * second 1XI coach, the 1XI assistant coach and the 1XI team manager.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-assessment-history.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8926);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const P_SELF = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, 1XI, an account of his own
const P_OWN  = "aaaaaaaa-0000-0000-0000-000000000001";   // J Whitfield, 1XI
const P_WES  = "bbbbbbbb-0000-0000-0000-000000000001";   // D Mkhize, Westville
const SEEDED_SESSION = "7a717000-0000-0000-0000-000000000001";   // R Pillay's row there says `injured`

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-assessment-history-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
/** @type {string[]} */
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

/** @param {string} path @param {{ method?: string, token?: string | null, body?: unknown }} [o] */
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: /** @type {any} */ (parsed) };
};
const login = async (/** @type {string} */ email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-ah" } })).body?.token;
const post = (/** @type {string} */ path, /** @type {string} */ token, /** @type {unknown} */ body) =>
  api(path, { method: "POST", token, body });
/** @returns {Promise<any[]>} */
const read = async (/** @type {string} */ r, /** @type {string} */ token, qs = "") =>
  (await api(`/api/read/${r}${qs}`, { token })).body?.rows ?? [];
const day = (/** @type {number} */ n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (/** @type {string} */ t, /** @type {unknown[]} */ p = []) => (await pool.query(t, p)).rows;
/** Add a person at Hilton with one role, as the owner, and return his address. */
const person = async (/** @type {string} */ tag, /** @type {string} */ role, /** @type {string | null} */ team) => {
  const email = `ah.${tag}@example.invalid`;
  const [u] = await q(`insert into app_user (school_id, email, name, role, teams) values ($1, $2, $3, $4, $5)
                       on conflict (email) do update set name = excluded.name returning id`,
                      [HIL, email, `AH ${tag}`, role, team ? [team] : []]);
  await q(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, $2, $3, $4)`,
          [u.id, role, HIL, team]);
  return email;
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const coach     = await login("coach@example.invalid");       // 1XI
  const coach2    = await login(await person("coach2", "coach", "1XI"));
  const assistant = await login(await person("assistant", "assistantcoach", "1XI"));
  const manager   = await login(await person("manager", "teammanager", "1XI"));
  const pupil     = await login("pillay@example.invalid");      // R Pillay himself
  const parent    = await login("parent@example.invalid");      // his parent
  const head      = await login("sarah@example.invalid");       // director of sport
  const principal = await login("principal@example.invalid");
  const office    = await login("registrar@example.invalid");
  const owner     = await login("owner@example.invalid");
  const D5 = day(-5);

  group("A score keeps its assessor (db/104)");
  {
    const r = await post(`/api/players/${P_SELF}/assessment`, coach,
      { assessedOn: D5, scores: { technical: { againstPace: 9, footwork: 10 } } });
    ok("the coach rates the boy's batting", r.status === 200 && r.body?.recorded === 2);
    ok("...and corrects himself the same day", (await post(`/api/players/${P_SELF}/assessment`, coach,
      { assessedOn: D5, scores: { technical: { footwork: 11 } } })).status === 200);
    const clash = await post(`/api/players/${P_SELF}/assessment`, coach2,
      { assessedOn: D5, scores: { technical: { footwork: 6 } } });
    ok("a colleague's same-day rating is refused, and says why", clash.status === 403 && clash.body?.error === "not_the_assessor");
    const [row] = await q(`select s.score, u.email from player_skill s join app_user u on u.id = s.assessed_by
                            where s.player_id = $1 and s.metric = 'footwork' and s.assessed_on = $2`, [P_SELF, D5]);
    ok("...and the coach's row is untouched, still his", row?.score === 11 && row?.email === "coach@example.invalid");
    ok("the colleague rates on a row of his own", (await post(`/api/players/${P_SELF}/assessment`, coach2,
      { scores: { technical: { lineAndLength: 12 } } })).status === 200);
  }

  group("A wrong score is withdrawn: the ratings stop counting it, the history keeps it struck");
  {
    const before = (await read("ratings", coach)).find((x) => x.player_id === P_OWN);
    const r = await post(`/api/players/${P_OWN}/assessment`, coach, { scores: { technical: { footwork: 2 } } });
    ok("the coach rates the wrong boy", r.status === 200);
    const wrong = (await read("ratings", coach)).find((x) => x.player_id === P_OWN);
    ok("...and the rating moves", wrong?.batting?.coachAssessed !== before?.batting?.coachAssessed);
    const id = (await read("skills", coach)).find((s) => s.player_id === P_OWN && s.metric === "footwork" && s.score === 2)?.id;
    ok("`skills` gives the score its id", typeof id === "string");
    ok("the boy may not withdraw it", (await post(`/api/skills/${id}/withdraw`, pupil, { reason: "not mine" })).status === 403);
    ok("...nor the assistant", (await post(`/api/skills/${id}/withdraw`, assistant, { reason: "not mine" })).status === 403);
    const bare = await post(`/api/skills/${id}/withdraw`, coach, {});
    ok("a withdrawal without a reason is refused", bare.status === 400 && bare.body?.error === "reason_required");
    ok("the coach withdraws it, with why", (await post(`/api/skills/${id}/withdraw`, coach, { reason: "rated the wrong boy" })).status === 200);
    const again = await post(`/api/skills/${id}/withdraw`, coach, { reason: "again" });
    ok("...once", again.status === 409 && again.body?.error === "already_withdrawn");
    const after = (await read("ratings", coach)).find((x) => x.player_id === P_OWN);
    ok("the rating is back where it stood, on the same anchor",
       after?.batting?.coachAssessed === before?.batting?.coachAssessed && after?.batting?.anchoredOn === before?.batting?.anchoredOn);
    ok("`skills` no longer returns it", !(await read("skills", coach)).some((s) => s.id === id));
    await q(`delete from access_log`);
    const hist = await read("skills_history", coach, `?playerId=${P_OWN}`);
    const struck = hist.find((s) => s.id === id);
    ok("`skills_history` returns it struck, with who and why",
       struck?.withdrawn_at && struck?.withdrawn_reason === "rated the wrong boy" && struck?.assessed_by_name && struck?.withdrawn_by_name);
    ok("...and only this boy's rows", hist.length > 1 && hist.every((s) => s.player_id === P_OWN));
    const [log] = await q(`select record_count, fields from access_log where resource = 'skills_history'`);
    ok("...and the read is in the access log, against him", log?.record_count === 1 && log?.fields?.includes("score"));
    ok("the boy reads his own history", (await read("skills_history", pupil, `?playerId=${P_SELF}`)).length >= 2);
    ok("...his parent none of it", (await read("skills_history", parent, `?playerId=${P_SELF}`)).length === 0);
  }

  group("A coaching point is a note: the coach writes it, the staff read it, the boy does not");
  /** @type {string} */
  let pointId = "";
  {
    const skillId = (await read("skills", coach)).find((s) => s.player_id === P_SELF && s.metric === "againstPace")?.id;
    const point = (/** @type {string} */ token, body = "front foot is late to the pitch", evidence = { read: "skills", params: { skillId } }) =>
      post(`/api/players/${P_SELF}/coaching-points`, token, { body, evidence });
    const r = await point(coach);
    ok("the coach writes a point on the score", r.status === 200 && typeof r.body?.id === "string");
    pointId = r.body?.id;
    for (const [who, t] of /** @type {[string, string][]} */ ([["the assistant", assistant], ["the director", head], ["the boy", pupil], ["his parent", parent]]))
      ok(`${who} may not write one`, (await point(t)).status === 403);
    const word = await point(coach, "a hamstring niggle, so no short balls");
    ok("a never-word is refused", word.status === 422 && word.body?.error === "forbidden_word");
    const named = await point(coach, "plays across the line like T Bekker");
    ok("a team-mate named in full is refused", named.status === 422 && named.body?.error === "names_another_boy");
    const tier = await point(coach, "late on the pull", { read: "matchups", rule: "S11", asOf: new Date().toISOString(), text: ["line"] });
    ok("a card's lines on an S11 point are refused by the CHECK", tier.status === 422);
    await q(`delete from access_log`);
    ok("the coach reads it", (await read("coaching_points", coach, `?playerId=${P_SELF}`)).some((p) => p.id === pointId));
    const [log] = await q(`select record_count, fields from access_log where resource = 'coaching_points'`);
    ok("...and the read is logged, the body named", log?.record_count === 1 && log?.fields?.includes("body"));
    for (const [who, t] of /** @type {[string, string][]} */ ([["the assistant", assistant], ["the director", head], ["the principal", principal]]))
      ok(`${who} reads it`, (await read("coaching_points", t)).some((p) => p.id === pointId));
    for (const [who, t] of /** @type {[string, string][]} */ ([["the boy", pupil], ["his parent", parent], ["the team manager", manager], ["the owner's key", owner]]))
      ok(`${who} reads none`, (await read("coaching_points", t)).length === 0 && !(await read("notes", t)).some((n) => n.id === pointId));
    const edit = await api(`/api/notes/${pointId}`, { method: "PATCH", token: coach, body: { body: "front foot very late" } });
    ok("a point is not edited", edit.status === 409 && edit.body?.error === "withdraw_not_edit");
    ok("the boy may not withdraw it", (await post(`/api/notes/${pointId}/withdraw`, pupil, {})).status === 403);
    ok("the director withdraws it", (await post(`/api/notes/${pointId}/withdraw`, head, {})).status === 200);
    ok("...once", (await post(`/api/notes/${pointId}/withdraw`, head, {})).status === 409);
    ok("...and it is still there, struck", (await read("coaching_points", coach)).find((p) => p.id === pointId)?.withdrawn_at);
    pointId = (await point(coach, "gets across too early to the short ball")).body?.id;
  }

  group("A target: the coach sets it, the boy reads it, his parent does not (db/105)");
  /** @type {string} */
  let targetId = "";
  const TD = (await q(`select id from drill where school_id is null and name = 'Throw-downs'`))[0].id;
  const SP = (await q(`select id from drill where school_id is null and name = 'Short-pitch defence'`))[0].id;
  {
    const set = (/** @type {string} */ t, /** @type {object} */ b) => post(`/api/players/${P_SELF}/targets`, t, b);
    const base = { category: "technical", metric: "againstPace", targetScore: 12, dueOn: day(40), drillId: TD, noteId: pointId };
    ok("an attribute the rubric lacks is refused", (await set(coach, { ...base, metric: "vibes" })).status === 400);
    const there = await set(coach, { ...base, targetScore: 9 });
    ok("a target where he already stands is refused", there.status === 422 && there.body?.error === "already_there");
    ok("the assistant may not set one", (await set(assistant, base)).status === 403);
    ok("...nor the team manager", (await set(manager, base)).status === 403);
    const r = await set(coach, base);
    ok("the coach sets one", r.status === 200 && typeof r.body?.id === "string");
    targetId = r.body?.id;
    await q(`delete from access_log`);
    const mine = (await read("targets", pupil, `?playerId=${P_SELF}`)).find((t) => t.id === targetId);
    ok("the boy reads his target, standing at 9", mine?.target_score === 12 && mine?.standing_score === 9 && mine?.drill_name === "Throw-downs");
    ok("...and not the reasoning behind it", mine && mine.note_id === null);
    ok("...and the read is logged against him",
       (await q(`select 1 from access_log where resource = 'targets' and $1 = any(record_ids)`, [P_SELF])).length === 1);
    ok("the coach reads the reasoning's id", (await read("targets", coach, `?playerId=${P_SELF}`)).find((t) => t.id === targetId)?.note_id === pointId);
    for (const [who, t] of /** @type {[string, string][]} */ ([["his parent", parent], ["the principal", principal], ["the team manager", manager]]))
      ok(`${who} reads none`, (await read("targets", t, `?playerId=${P_SELF}`)).length === 0);
    const footwork = await set(coach, { category: "technical", metric: "footwork", targetScore: 14 });
    ok("the boy may not withdraw a target", (await post(`/api/targets/${footwork.body?.id}/withdraw`, pupil, { reason: "x" })).status === 403);
    ok("the coach withdraws one, with why",
       (await post(`/api/targets/${footwork.body?.id}/withdraw`, coach, { reason: "the wrong attribute" })).status === 200);
  }

  group("The side's plan and its register (db/105)");
  /** @type {string[]} */
  const sessions = [];
  {
    for (const d of [-3, -1]) {
      const [s] = await q(`insert into training_session (school_id, team_code, title, starts_at, duration_min, session_type)
                           values ($1, '1XI', $2, now() + ($3 || ' days')::interval, 90, 'batting') returning id`,
                          [HIL, `AH nets ${d}`, String(d)]);
      sessions.push(s.id);
    }
    const [s3, s1] = sessions;
    const plan = (/** @type {string} */ t, /** @type {string} */ id, /** @type {object[]} */ drills) => post(`/api/training/${id}/plan`, t, { drills });
    ok("the coach plans a session from the library", (await plan(coach, s3, [{ drillId: TD }, { drillId: SP, minutes: 10 }])).status === 200);
    ok("...and another", (await plan(coach, s1, [{ drillId: TD }])).status === 200);
    // The team manager holds no team.manage (the lead's review, fact 1): the
    // design's §3.2 has him writing the plan; the bundle does not. See the
    // build report.
    ok("the team manager may not plan (his bundle holds no team.manage)", (await plan(manager, s3, [{ drillId: TD }])).status === 403);
    ok("...nor the assistant", (await plan(assistant, s3, [{ drillId: TD }])).status === 403);
    ok("...nor a parent", (await plan(parent, s3, [{ drillId: TD }])).status === 403);
    const [wes] = await q(`insert into drill (school_id, name, category, duration_min) values ('22222222-2222-2222-2222-222222222222', 'AH Westville drill', 'batting', 20) returning id`);
    ok("another school's drill is refused", (await plan(coach, s1, [{ drillId: wes.id }])).status === 422);
    ok("...and the plan it would have replaced stands", (await read("training_plan", coach, `?sessionId=${s1}`)).length === 1);
    ok("a drill twice is refused", (await plan(coach, s1, [{ drillId: TD }, { drillId: TD }])).status === 400);
    ok("the parent reads the side's plan", (await read("training_plan", parent, `?sessionId=${s3}`)).length === 2);
    ok("...and the boy, and the team manager",
       (await read("training_plan", pupil, `?sessionId=${s3}`)).length === 2 && (await read("training_plan", manager, `?sessionId=${s3}`)).length === 2);

    const mark = (/** @type {string} */ t, /** @type {string} */ id, /** @type {object[]} */ rows) => post(`/api/training/${id}/attendance`, t, { rows });
    const inj = await mark(coach, s3, [{ playerId: P_SELF, status: "injured" }]);
    ok("`injured` is refused by the register's route", inj.status === 422 && inj.body?.error === "status_not_accepted");
    ok("the coach marks the boy present", (await mark(coach, s3, [{ playerId: P_SELF, status: "present" }])).status === 200);
    ok("...and re-marks him (an upsert, one row)", (await mark(coach, s3, [{ playerId: P_SELF, status: "present" }])).status === 200
       && (await q(`select count(*)::int n from training_attendance where session_id = $1`, [s3]))[0].n === 1);
    ok("a parent may not take the register", (await mark(parent, s3, [{ playerId: P_SELF, status: "present" }])).status === 403);
    ok("...nor the team manager", (await mark(manager, s3, [{ playerId: P_SELF, status: "present" }])).status === 403);
    const visitor = await mark(coach, s3, [{ playerId: P_WES, status: "present" }]);
    ok("another school's boy is not filed on the register", visitor.status === 422 || visitor.status === 403);
    const seeded = (await read("training_attendance", coach, `?sessionId=${SEEDED_SESSION}`)).find((r) => r.player_id === P_SELF);
    ok("the row written `injured` before db/105 reads `excused`", seeded?.status === "excused");
    ok("...and no row reads `injured` to anybody",
       !(await read("training_attendance", coach)).some((r) => r.status === "injured")
       && !(await read("training_attendance", parent)).some((r) => r.status === "injured"));
  }

  group("Since the last look");
  {
    const rows = await read("development_since", coach, `?playerId=${P_SELF}`);
    const bat = rows.find((r) => r.discipline === "batting");
    ok("one row per discipline", rows.length === 4);
    ok("batting is anchored on the coach's look five days ago", String(bat?.anchor).slice(0, 10) === D5);
    ok("...two sessions since, one with a register, present at one",
       bat?.sessions === 2 && bat?.registered === 1 && bat?.present === 1 && bat?.late === 0);
    ok("...throw-downs twice, short-pitch once",
       JSON.stringify(bat?.drills?.map((/** @type {any} */ d) => [d.name, d.times])) === JSON.stringify([["Throw-downs", 2], ["Short-pitch defence", 1]]));
    const t = bat?.targets?.[0];
    ok("...the target's drill ran twice and he was there for one", t?.target_score === 12 && t?.drillRan === 2 && t?.drillAttended === 1);
    ok("...and the panel says no absence and no health word", !/absent|injured|missed/i.test(JSON.stringify(rows)));
    const boy = (await read("development_since", pupil, `?playerId=${P_SELF}`)).find((r) => r.discipline === "batting");
    ok("the boy reads the same panel", boy?.sessions === 2 && boy?.targets?.[0]?.drillAttended === 1);
    ok("his parent reads none of it", (await read("development_since", parent, `?playerId=${P_SELF}`)).length === 0);
    ok("...nor the team manager", (await read("development_since", manager, `?playerId=${P_SELF}`)).length === 0);
    const bowl = rows.find((r) => r.discipline === "bowling");
    ok("a discipline rated today has an empty window", bowl?.sessions === 0);
  }

  group("A judgement does not leave as a file (AH-D4)");
  {
    await q(`delete from access_log`);
    for (const r of ["skills", "skills_history", "ratings", "notes", "coaching_points", "targets", "development_since"]) {
      const e = await api(`/api/export/${r}${r === "development_since" ? `?playerId=${P_SELF}` : ""}`, { token: coach });
      ok(`the export of ${r} is refused`, e.status === 403 && e.body?.error === "not_exported");
    }
    ok("...and nothing was read to refuse it", (await q(`select count(*)::int n from access_log`))[0].n === 0);
    const roster = await api("/api/export/players", { token: office });
    ok("the office still exports its roster", roster.status === 200 && String(roster.body).includes("full_name"));
    ok("the training calendar still exports", (await api("/api/export/training", { token: coach })).status === 200);
  }
} catch (/** @type {any} */ e) {
  ok(`the walk threw: ${e.message?.slice(0, 200)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nASSESSMENT HISTORY SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

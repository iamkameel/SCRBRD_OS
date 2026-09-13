#!/usr/bin/env node
/**
 * What a coach writes about a child, and who may read it.
 *
 * The attribute set is 33 numbers and a child is not. "Gone quiet since his
 * father started coming to matches" has no column, is legitimate coaching, and
 * is frequently the reason a rating moved.
 *
 * TWO THINGS THIS WALK EXISTS TO PIN.
 *
 * The first is the audience. A note is narrower than the ratings beside it: the
 * pupil can read his own attribute scores and must not read the prose. That
 * asymmetry was asked for, it is a policy decision rather than a technical one,
 * and it carries a POPIA exposure — a data subject generally has a right of
 * access to information held about them. So every read is logged, and the
 * boundary is asserted from both sides rather than assumed.
 *
 * The second is that NOTHING PARSES THE PROSE. A note that is meant to move a
 * rating carries the signal explicitly. A system that read a coach's sentence
 * and decided a number from it would be inventing a judgement and attributing
 * it to a named person.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-notes.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8804;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const P_OWN   = "aaaaaaaa-0000-0000-0000-000000000001";  // James Whitfield, 1XI
const P_SELF  = "aaaaaaaa-0000-0000-0000-000000000005";  // R Pillay, 1XI, has an account
const P_U16B  = "aaaaaaaa-0000-0000-0000-000000000006";  // K Dlamini, another side
const U_COACH = "88888888-0000-0000-0000-000000000004";
const U_HEAD  = "88888888-0000-0000-0000-000000000007";
const APP_DB  = process.env.APP_DATABASE_URL || "postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-notes-secret" },
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
  method: "POST", body: { email, deviceId: "device-notes" } })).body?.token;
const write = (player, token, body) => api(`/api/players/${player}/notes`, { method: "POST", token, body });
const revise = (id, token, body) => api(`/api/notes/${id}`, { method: "PATCH", token, body });
const read = async (r, token) => (await api(`/api/read/${r}`, { token })).body?.rows ?? [];
const ratingFor = async (token, player) =>
  (await read("ratings", token)).find((x) => x.player_id === player);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const coach   = await login("coach@example.invalid");    // 1XI
  const coach2  = await login("coach2@example.invalid");   // 2XI, not this side
  const head    = await login("sarah@example.invalid");    // directorofsport
  const pupil   = await login("pillay@example.invalid");   // a 1XI player, self-access
  const parent  = await login("parent@example.invalid");   // R Pillay's guardian
  const medic   = await login("medical@example.invalid");

  // The seed carries notes of its own, so the browser walk has something to
  // render. This walk asserts on counts and adjustments, so it owns its
  // fixture rather than assuming an empty one — the first run after those
  // seed rows landed failed four assertions for exactly that reason.
  await q(`delete from development_note where player_id = any($1::uuid[])`,
          [[P_OWN, P_SELF, P_U16B]]);

  group("A coach writes about their own player");
  const narrative = await write(P_OWN, coach, {
    body: "Has gone quiet in the sheds since his father started coming to matches. Worth a word.",
  });
  ok("a narrative note is accepted", narrative.status === 200);
  ok("...and comes back with an id", !!narrative.body?.id);

  group("Authorship is taken from the session, never from the payload");
  const forged = await write(P_OWN, coach, {
    body: "A note claiming to be somebody else's.",
    authorId: "88888888-0000-0000-0000-000000000007",
  });
  ok("a note naming another author is still accepted", forged.status === 200);
  const forgedRow = (await q(`select author_id from development_note where id = $1`, [forged.body.id]))[0];
  ok("...and recorded against the person who actually wrote it",
     forgedRow.author_id === U_COACH);

  // The line above passes because recordNote() never forwards authorId, which
  // makes it a statement about the write path and NOT about the trigger behind
  // it. The trigger is the thing that holds if a second write path is ever
  // added, so it is exercised where it actually applies: an INSERT that names
  // somebody else, through the unprivileged application role.
  const app = new pg.Pool({ connectionString: APP_DB });
  const c = await app.connect();
  try {
    await c.query("select set_config('app.user_id', $1, false)", [U_COACH]);
    const [direct] = (await c.query(
      `insert into development_note (player_id, school_id, author_id, body)
       values ($1, player_school($1), $2, 'Filed under the head of sport''s name.')
       returning id, author_id`,
      [P_OWN, U_HEAD])).rows;
    ok("a direct INSERT naming another author is overwritten by the trigger",
       direct.author_id === U_COACH);
  } finally { c.release(); await app.end().catch(() => {}); }

  group("And nowhere else");
  ok("a coach cannot write about another side's player",
     (await write(P_U16B, coach, { body: "Not mine to write about." })).status === 403);
  ok("...nor can the 2nd XI coach write about a 1st XI player",
     (await write(P_OWN, coach2, { body: "Not mine either." })).status === 403);
  ok("medical staff hold no note capability at all",
     (await write(P_OWN, medic, { body: "Not a coaching judgement." })).status === 403);

  group("The audience is narrower than the ratings beside it");
  await write(P_SELF, coach, { body: "Struggling with the short ball; nervous against pace." });
  // Rated as well as written about, so there is a number of his OWN to read.
  // This used to pass on a team-mate's ratings, back when the player role
  // read development records across the side; it does not, and the seed has
  // no ratings for him.
  await api(`/api/players/${P_SELF}/assessment`, { method: "POST", token: coach,
    body: { scores: { technical: { footwork: 11 } } } });
  const pupilSkills = await read("skills", pupil);
  const pupilNotes  = await read("notes", pupil);
  // The asymmetry, from both sides. A pupil MAY read his own numbers.
  ok("a pupil reads his own attribute scores", pupilSkills.length > 0 && pupilSkills.every((r) => r.player_id === P_SELF));
  ok("...and none of the prose written about him", pupilNotes.length === 0);
  ok("a guardian reads no notes about their child", (await read("notes", parent)).length === 0);
  ok("the coach of that side does", (await read("notes", coach)).some((n) => n.player_id === P_SELF));
  ok("...and so does the head of sport", (await read("notes", head)).length > 0);
  ok("a coach of another side does not",
     !(await read("notes", coach2)).some((n) => n.player_id === P_SELF));
  ok("...and the note names who wrote it, not just a uuid",
     (await read("notes", coach)).every((n) => !!n.author_name));

  group("A note may carry a signal, and the prose is never parsed");
  const before = await ratingFor(coach, P_OWN);
  ok("the narrative notes moved nothing", before.batting.noteAdjustment === 0);
  ok("...though the coach's assessment is there to be moved", before.batting.coachAssessed != null);
  const signalled = await write(P_OWN, coach, {
    body: "Won't play the pull shot since he was hit at Kearsney.",
    aboutDiscipline: "batting", adjustment: -2,
  });
  ok("a note with an explicit signal is accepted", signalled.status === 200);
  const after = await ratingFor(coach, P_OWN);
  ok("...and it moves the coach's half", after.batting.noteAdjustment === -2);
  ok("...leaving the assessment itself untouched beside it",
     after.batting.coachAssessed === before.batting.coachAssessed);
  ok("...and the anchor is the assessment plus the note",
     after.batting.coach === before.batting.coachAssessed - 2);
  ok("...and it says how many notes are behind that", after.batting.noteCount === 1);
  // Only the discipline it names.
  ok("a batting note does not move bowling", after.bowling.noteAdjustment === 0);

  group("A signal must be a signal");
  ok("an adjustment beyond the cap is refused",
     (await write(P_OWN, coach, { body: "x", aboutDiscipline: "batting", adjustment: 9 }))
       .body?.error === "adjustment_too_large");
  // Stored-and-ignored is how a coach comes to believe they moved a rating they
  // did not move.
  ok("an adjustment with no discipline is refused rather than ignored",
     (await write(P_OWN, coach, { body: "x", adjustment: 2 }))
       .body?.error === "adjustment_needs_a_discipline");
  ok("an unknown discipline is refused",
     (await write(P_OWN, coach, { body: "x", aboutDiscipline: "fitness", adjustment: 1 }))
       .body?.error === "unknown_discipline:fitness");
  ok("an empty note is refused", (await write(P_OWN, coach, { body: "   " })).body?.error === "body_required");

  group("A fresh assessment supersedes the notes behind it");
  // The note above is dated today. An assessment dated tomorrow re-anchors, and
  // a note the coach wrote BEFORE looking again is already inside the judgement
  // they have just made.
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await api(`/api/players/${P_OWN}/assessment`, {
    method: "POST", token: coach,
    body: { assessedOn: tomorrow, scores: { technical: { footwork: 15 } } } });
  const reanchored = await ratingFor(coach, P_OWN);
  ok("the anchor moves to the newer assessment",
     reanchored.batting.anchoredOn?.slice(0, 10) === tomorrow);
  ok("...and the older note stops counting", reanchored.batting.noteAdjustment === 0);
  ok("...and is still on the record", (await read("notes", coach)).some((n) => n.adjustment === -2));

  group("A note belongs to the coach who wrote it");
  const mine = (await read("notes", coach)).find((n) => n.player_id === P_SELF);
  ok("its author may revise it",
     (await revise(mine.id, coach, { body: "Revised: worked on it in the nets, improving." })).status === 200);
  const revised = (await q(`select body, updated_at from development_note where id = $1`, [mine.id]))[0];
  ok("...and the revision is recorded as such", revised.updated_at != null);
  // The head of sport can READ it and must not be able to rewrite it under the
  // coach's name.
  ok("somebody else who can read it cannot rewrite it",
     (await revise(mine.id, head, { body: "Not mine to edit." })).status === 403);
  ok("...and is told why", (await revise(mine.id, head, { body: "x" })).body?.error === "not_the_author");
  ok("...and the text is unchanged",
     (await q(`select body from development_note where id = $1`, [mine.id]))[0].body === revised.body);

  group("Nothing here can be erased");
  const n = (await q(`select count(*)::int n from pg_policy
                       where polrelid = 'development_note'::regclass and polcmd = 'd'`))[0].n;
  ok("there is no delete policy on notes", n === 0);

  group("And every read of one is logged");
  await q(`delete from access_log`);
  await read("notes", coach);
  const logged = await q(`select * from access_log where resource = 'notes'`);
  ok("reading notes writes an entry", logged.length === 1);
  ok("...naming the children written about",
     (logged[0]?.record_ids ?? []).includes(P_OWN));
  ok("...and that the prose itself was disclosed",
     (logged[0]?.fields ?? []).includes("body"));
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
console.log(`\n${"─".repeat(52)}\nDEVELOPMENT NOTE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

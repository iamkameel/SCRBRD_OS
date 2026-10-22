#!/usr/bin/env node
/**
 * GA-I19 slice A over HTTP: the physio's injury record, its reviews and her
 * worklist (db/111), with SG-12's injury half (slice C).
 *
 * db/99 section 88 proves the database. This walks the routes the screens
 * will use, as the seed's people, and asks what only the API can answer:
 *
 *   1. THE RECORD. The physio records an injury for James Whitfield through
 *      POST /api/injuries; the `injuries` read carries its author and its
 *      next review; its first review is the recording; his coach is told.
 *   2. THE REFUSALS, in words: no next review, one in the past, a severity
 *      outside the three, no injury named, a return before the injury, a
 *      date that is not a date, a boy who is not there; and the coach, the
 *      parent, the boy, the director and the principal, who hold no
 *      medical.write; and a physio who is the boy's mother (Q6).
 *   3. THE REVIEW. A step to rehab, refused without a next review (Q10) and
 *      when clearing names one; nobody else may; an injury that is not there.
 *   4. THE TIERS, through `injury_reviews`: the coach, the director and the
 *      principal (READERS Q9, db/116) read the phase and never the note; the
 *      boy's parent and the boy read the note; a pupil and
 *      another side's coach read nothing.
 *   5. THE WORKLIST: the physio's alone, each row with its reason; nobody
 *      else holds a row of it; both reads are logged.
 *   6. CLEARED: "Cleared to play" for the coach, the boy fit again, and the
 *      cleared injury not reviewed again.
 *   7. SG-12: a severe injury tells the DSO, naming nobody; the coach is not
 *      told that.
 *   8. LEFT: the `injuries` read marks a boy who left the school, for the
 *      office, and `injury_reviews` marks the recording; the physio, his
 *      coach and the head read nothing of it once he has gone (READERS Q3,
 *      db/116).
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-injury.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8897);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001"; // James Whitfield, 1XI, uninjured in the seed
const NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";    // S Naidoo, 1XI
const HAMSTRING = "cccccccc-0000-0000-0000-000000000001"; // R Pillay's, in the seed
// Calendar days in Johannesburg, as sa_today() counts them: a UTC date is a
// day behind for two hours after South African midnight, and the doors judge
// "in the future" and "already past" by sa_today().
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-injury-secret" },
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
  method: "POST", body: { email, deviceId: "device-injury" } })).body?.token;
const rows = async (what, token) => (await api(`/api/read/${what}`, { token })).body?.rows ?? [];
const record = (token, body) => api("/api/injuries", { method: "POST", token, body });
const review = (token, id, body) => api(`/api/injuries/${id}/reviews`, { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;

const A_HAMSTRING = { playerId: WHITFIELD, injuryType: "Grade 1 hamstring strain", severity: "moderate",
                      dateInjured: day(-1), rtwDate: day(21), nextReviewOn: day(7),
                      notes: "Smoke clinical: eccentric programme from day three." };

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // A second physio at Hilton who is James Whitfield's mother (Q6). Made as
  // the owner: appointments and links are other walks' business.
  const [{ id: MUM }] = await q(
    `insert into app_user (school_id, email, name, role) values ($1, 'smoke.mumphysio@example.invalid', 'Smoke Mumphysio', 'medical')
     returning id`, [HIL]);
  await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'medical', $2), ($1, 'guardian', $2)`, [MUM, HIL]);
  await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                           consent_state, consent_version, consent_at, created_by)
           select a.id, $2, 'parent', 'verified', '88888888-0000-0000-0000-00000000000c', now(), 'granted', 'popia-2026-01', now(),
                  '88888888-0000-0000-0000-00000000000c'
             from role_assignment a where a.person_id = $1 and a.role = 'guardian'`, [MUM, WHITFIELD]);

  const physio = await login("medical@example.invalid");
  const coach = await login("coach@example.invalid");        // C Hendricks, 1XI
  const coach2 = await login("coach2@example.invalid");      // P Moodley, 2XI
  const parent = await login("parent@example.invalid");      // D Pillay, R Pillay's guardian
  const pillay = await login("pillay@example.invalid");      // R Pillay, himself
  const pupil = await login("spectator@example.invalid");    // a pupil (`player`) at Hilton
  const director = await login("sarah@example.invalid");
  const principal = await login("principal@example.invalid");
  const dso = await login("dso@example.invalid");
  const mum = await login("smoke.mumphysio@example.invalid");
  ok("everybody signs in", [physio, coach, coach2, parent, pillay, pupil, director, principal, dso, mum].every(Boolean));
  const [{ id: PHYSIO_ID }] = await q(`select id from app_user where email = 'medical@example.invalid'`);

  // ── 1. The record ──────────────────────────────────────────────
  group("1. The physio records an injury");
  const made = await record(physio, A_HAMSTRING);
  ok("POST /api/injuries records it", made.status === 200 && made.body?.ok && made.body?.id, JSON.stringify(made.body));
  const ID = made.body?.id;
  const mine = (await rows("injuries", physio)).find((r) => r.id === ID);
  ok("...the injuries read carries its author, its next review and no emergency",
     mine?.recorded_by === PHYSIO_ID && String(mine?.next_review_on).slice(0, 10) === day(7) && mine?.emergency_services === false,
     JSON.stringify(mine));
  const first = await rows(`injury_reviews?injuryId=${ID}`, physio);
  ok("...and its one review is the recording, by her", first.length === 1 && first[0].reviewed_by === PHYSIO_ID && first[0].phase_after === "active");
  ok("...and his coach is told", (await rows("notifications", coach)).some((n) => n.kind === "injury" && n.subject_id === ID && n.title === "Injury recorded"));

  // ── 2. The refusals ────────────────────────────────────────────
  group("2. Refused, in words");
  const say = [
    ["no next review",           { nextReviewOn: undefined },          422, "next_review_required"],
    ["a next review already past", { nextReviewOn: day(-1) },          422, "next_review_in_past"],
    ["a severity outside the three", { severity: "mild" },             422, "severity_invalid"],
    ["no injury named",          { injuryType: "  " },                 422, "injury_type_required"],
    ["a return before the injury", { rtwDate: day(-5) },               422, "return_before_injury"],
    ["an injury in the future",  { dateInjured: day(1) },              422, "date_injured_in_future"],
    ["a date that is not a date", { nextReviewOn: "next Tuesday" },    400, "next_review_on_invalid"],
    ["a boy who is not there",   { playerId: "aaaaaaaa-0000-0000-0000-0000000000ff" }, 404, "no_such_player"],
  ];
  for (const [what, change, status, error] of say) {
    const r = await record(physio, { ...A_HAMSTRING, injuryType: "Side strain", ...change });
    ok(`${what}: ${status} ${error}`, r.status === status && r.body?.error === error, `${r.status} ${JSON.stringify(r.body)}`);
  }
  for (const [who, token] of [["the coach", coach], ["the parent", parent], ["the boy", pillay], ["a pupil", pupil],
                              ["the director", director], ["the principal", principal], ["the DSO", dso]]) {
    const r = await record(token, { ...A_HAMSTRING, playerId: "aaaaaaaa-0000-0000-0000-000000000005", injuryType: "Side strain" });
    ok(`${who} records nothing: 403 not_permitted`, r.status === 403 && r.body?.error === "not_permitted", `${r.status} ${JSON.stringify(r.body)}`);
  }
  const own = await record(mum, { ...A_HAMSTRING, injuryType: "Side strain" });
  ok("a physio who is his mother records nothing about him: 422 family_cannot_record",
     own.status === 422 && own.body?.error === "family_cannot_record", `${own.status} ${JSON.stringify(own.body)}`);
  ok("...nor reviews him", (await review(mum, ID, { phaseAfter: "rehab", nextReviewOn: day(7) })).body?.error === "family_cannot_record");
  ok("...and none of it was written",
     (await q(`select count(*)::int n from injury where injury_type = 'Side strain'`))[0].n === 0);

  // ── 3. The review ──────────────────────────────────────────────
  group("3. A review");
  const step = await review(physio, ID, { phaseAfter: "rehab", nextReviewOn: day(5), note: "Smoke: strengthening, week two." });
  ok("POST /api/injuries/:id/reviews records a step to rehab", step.status === 200 && step.body?.id, JSON.stringify(step.body));
  const refusals = [
    ["no next review on a review that does not clear him", { phaseAfter: "rehab" }, 422, "next_review_required"],
    ["a next review on one that clears him", { phaseAfter: "cleared", nextReviewOn: day(7) }, 422, "cleared_has_no_next_review"],
    ["a cleared boy left restricted", { phaseAfter: "cleared", restrictedAfter: true }, 422, "cleared_is_not_restricted"],
    ["a phase outside the three", { phaseAfter: "returning", nextReviewOn: day(7) }, 422, "phase_invalid"],
  ];
  for (const [what, body, status, error] of refusals) {
    const r = await review(physio, ID, body);
    ok(`${what}: ${status} ${error}`, r.status === status && r.body?.error === error, `${r.status} ${JSON.stringify(r.body)}`);
  }
  ok("the coach reviews nothing: 403 not_permitted",
     (await review(coach, ID, { phaseAfter: "cleared" })).body?.error === "not_permitted");
  const gone = await review(physio, "dddddddd-0000-0000-0000-000000000000", { phaseAfter: "rehab", nextReviewOn: day(7) });
  ok("an injury that is not there: 404 no_such_injury", gone.status === 404 && gone.body?.error === "no_such_injury");
  ok("an id that is not an id: 400", (await review(physio, "not-an-id", { phaseAfter: "rehab", nextReviewOn: day(7) })).status === 400);

  // ── 4. The tiers ───────────────────────────────────────────────
  group("4. The history, at each reader's tier");
  const by = async (token, id = ID) => rows(`injury_reviews?injuryId=${id}`, token);
  const coachSees = await by(coach);
  ok("his coach reads the two reviews, phase and clock", coachSees.length === 2 && coachSees.every((r) => r.phase_after && r.next_review_on));
  ok("...the first marked as the recording, the step not", coachSees[0]?.is_recording === true && coachSees[1]?.is_recording === false);
  ok("...and never the note or who wrote it", coachSees.every((r) => r.note == null && r.reviewed_by == null));
  const dirSees = await by(director);
  ok("the director reads the phase and never the note", dirSees.length === 2 && dirSees.every((r) => r.phase_after && r.note == null && r.reviewed_by == null));
  // The principal: status and nature (READERS_child_data Q9, Kameel, 21 Oct
  // 2026, later than GA-I19 D3; db/116 restores medical.nature.read).
  const headSees = await by(principal);
  ok("the principal reads each review's phase and clock, and never the note or who wrote it",
     headSees.length === 2 && headSees.every((r) => r.reviewed_at && r.restricted_after === true && r.phase_after
                                                     && r.next_review_on && r.note == null && r.reviewed_by == null));
  const headRow = (await rows("injuries", principal)).find((r) => r.id === ID);
  ok("...and of the injury, that he is out, until when, what and how bad",
     headRow && headRow.restricted === true && headRow.rtw_date && headRow.date_injured
     && headRow.injury_type && headRow.severity && headRow.phase && headRow.next_review_on,
     JSON.stringify(headRow));
  ok("...and his fitness word", (await rows("players", principal)).find((p) => p.id === WHITFIELD)?.fitness === "rehab");
  ok("another side's coach reads none", (await by(coach2)).length === 0);
  ok("a pupil reads none (K3)", (await by(pupil)).length === 0);
  ok("the DSO reads none", (await by(dso)).length === 0);
  // R Pillay's seed hamstring, reviewed by the physio, read by his parent and himself.
  const pr = await review(physio, HAMSTRING, { phaseAfter: "rehab", nextReviewOn: day(4), note: "Smoke: running from Monday." });
  ok("the physio reviews R Pillay's hamstring", pr.status === 200);
  for (const [who, token] of [["his parent", parent], ["the boy himself", pillay]]) {
    const seen = await by(token, HAMSTRING);
    ok(`${who} reads the note`, seen.length === 1 && seen[0].note === "Smoke: running from Monday." && seen[0].reviewed_by === PHYSIO_ID);
  }
  ok("his parent reads nothing of James Whitfield's", (await by(parent)).length === 0);

  // ── 5. The worklist ────────────────────────────────────────────
  group("5. The worklist is the physio's");
  const list = await rows("injury_worklist", physio);
  const w = list.find((r) => r.injury_id === ID);
  ok("the physio's list has James Whitfield's injury, due in five days", w?.reason === "due" && String(w?.due_on).slice(0, 10) === day(5), JSON.stringify(w));
  ok("...and R Pillay's, due in four", list.find((r) => r.injury_id === HAMSTRING)?.reason === "due");
  for (const [who, token] of [["the coach", coach], ["the director", director], ["the principal", principal],
                              ["the parent", parent], ["the boy", pillay], ["the DSO", dso]]) {
    const r = await api("/api/read/injury_worklist", { token });
    ok(`${who} has no row of it`, r.status === 200 && (r.body?.rows ?? []).length === 0, `${r.status} ${JSON.stringify(r.body)}`);
  }
  ok("the mother-physio's list leaves her son off", !(await rows("injury_worklist", mum)).some((r) => r.player_id === WHITFIELD));
  const logged = await q(`select resource, fields from access_log where person_id = $1 and resource in ('injury_worklist', 'injury_reviews')`, [PHYSIO_ID]);
  ok("both reads are on the record, with what came back",
     logged.some((l) => l.resource === "injury_worklist" && l.fields.includes("reason"))
     && logged.some((l) => l.resource === "injury_reviews" && l.fields.includes("reviewed_by")), JSON.stringify(logged));

  // ── 6. Cleared ─────────────────────────────────────────────────
  group("6. Cleared to play");
  const clear = await review(physio, ID, { phaseAfter: "cleared", note: "Smoke: full training." });
  ok("the physio clears him", clear.status === 200, JSON.stringify(clear.body));
  ok("...his coach is told", (await rows("notifications", coach)).some((n) => n.subject_id === ID && n.title === "Cleared to play"));
  const after = (await rows("injuries", coach)).find((r) => r.id === ID);
  ok("...the row is cleared, unrestricted, with no next review", after?.phase === "cleared" && after?.restricted === false && after?.next_review_on == null);
  ok("...and he is fit again", (await rows("players", coach)).find((p) => p.id === WHITFIELD)?.fitness === "fit");
  ok("...and off the worklist", !(await rows("injury_worklist", physio)).some((r) => r.injury_id === ID));
  const again = await review(physio, ID, { phaseAfter: "rehab", nextReviewOn: day(7) });
  ok("a cleared injury is not reviewed again: 422 injury_cleared", again.status === 422 && again.body?.error === "injury_cleared");

  // ── 7. SG-12 ───────────────────────────────────────────────────
  group("7. A serious injury tells the DSO, naming nobody");
  const sev = await record(physio, { playerId: NAIDOO, injuryType: "Compound wrist fracture", severity: "severe",
                                     dateInjured: day(0), rtwDate: day(60), nextReviewOn: day(3) });
  ok("the physio records a severe injury", sev.status === 200);
  const told = (await rows("notifications", dso)).filter((n) => n.kind === "safeguarding" && n.title === "A serious injury has been recorded");
  ok("the DSO is told, once", told.length === 1, JSON.stringify(told));
  const [stored] = await q(`select title, body, subject_id, subject_person_id, team_code from notification where id = $1`, [told[0]?.id]);
  ok("...in words that name no child, no diagnosis and no id",
     stored && !/Naidoo|fracture|wrist|[0-9a-f]{8}-[0-9a-f]{4}/i.test(stored.title + stored.body)
     && stored.subject_id === null && stored.subject_person_id === null && stored.team_code === null, JSON.stringify(stored));
  ok("the coach is not told that", !(await rows("notifications", coach)).some((n) => n.kind === "safeguarding"));
  ok("...though he is told the injury, as before", (await rows("notifications", coach)).some((n) => n.subject_id === sev.body?.id && n.title === "Injury recorded"));

  // ── 8. Left the school ─────────────────────────────────────────
  group("8. A boy who leaves is marked for the office, and cut from the staff who treated him");
  const stayed = (await rows("injuries", coach)).find((r) => r.id === ID);
  ok("a boy still at school is not marked", stayed?.left_school === false && stayed?.left_on == null, JSON.stringify(stayed));
  await q(`update team_membership set left_on = sa_today() where player_id = $1 and left_on is null`, [NAIDOO]);
  const today = (await q(`select sa_today()::text d`))[0].d;
  // READERS_child_data Q3 (Kameel, 21 Oct 2026; db/116): ACCOUNT_LIFECYCLE
  // Q9 governs a departed boy's clinical record over GA-I19 D11. The office
  // and his family read it, marked; the physio, his coach and the head (not
  // the office's key) are cut, until he enrols again.
  const office = await login("registrar@example.invalid");
  const r = (await rows("injuries", office)).find((x) => x.id === sev.body?.id);
  ok("the office reads him as left the school today", r?.left_school === true && String(r?.left_on).slice(0, 10) === today, JSON.stringify(r && { left: r.left_school, on: r.left_on }));
  for (const [who, token] of [["the physio", physio], ["his coach", coach], ["the principal", principal]])
    ok(`${who} reads no injury of a boy who has left`, !(await rows("injuries", token)).some((x) => x.id === sev.body?.id));
  const reviewsOf = async (token) => (await api(`/api/read/injury_reviews?injuryId=${sev.body?.id}`, { token })).body?.rows ?? [];
  ok("...nor its reviews, which the office still reads",
     (await reviewsOf(physio)).length === 0 && (await reviewsOf(office)).length > 0);
  ok("...and a pupil still reads no row of his", !(await rows("injuries", pupil)).some((x) => x.id === sev.body?.id));
} catch (e) {
  ok(`the injury walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nINJURY SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

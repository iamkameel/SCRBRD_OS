#!/usr/bin/env node
/**
 * The gaps db/10 and db/11 could only warn about, over the real API.
 *
 * db/99_rls_verify.sql already proves dob_gaps() as SQL, against the two
 * fixtures the file already carries. This walk proves the other half: the
 * HTTP route a person actually uses. POST /api/players/:id/date-of-birth is
 * new — nothing has ever written player.born after the row was created — and
 * it needs its own walk for the same reason every write route here gets one:
 * a capability check that is correct in the model and never exercised over
 * HTTP is a check nobody has actually run.
 *
 *   1. dob_gaps() answers per capability, not per role name
 *   2. the write closes a gap and refuses to overwrite an existing birthday
 *   3. resolveBirthDate()'s refusals arrive as the same codes the client reads
 *   4. capturing a birthday and re-establishing a guardian link is one
 *      sequence, through two existing, separately-authorized routes
 *   5. db/172: a date that disagrees with the ID number on his record is
 *      refused at capture; correcting a recorded date is the office's alone,
 *      through POST …/date-of-birth/correction; every change is read back
 *      through GET …/date-of-birth/changes, by the office only
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-dob-gaps.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { bornFromSaId } from "@scrbrd/policy/sa-id";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8827);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const HIL       = "11111111-1111-1111-1111-111111111111";
const P_INJURED = "aaaaaaaa-0000-0000-0000-000000000005";  // R Pillay, 1XI — guardian: D Pillay
const PARENT    = "88888888-0000-0000-0000-000000000005";  // D Pillay
const P_U13     = "aaaaaaaa-0000-0000-0000-000000000013";  // B Khumalo, U13A — unlinked
const P_U16     = "aaaaaaaa-0000-0000-0000-000000000006";  // K Dlamini, U16B — no ID number on file

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log("  ✗", n, extra ?? ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-dob-gaps-secret" },
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
  method: "POST", body: { email, deviceId: "device-dob-gaps" } })).body?.token;

const gaps = async (token) => (await api("/api/read/dob_gaps", { token })).body?.rows || [];
const capture = (playerId, token, body) =>
  api(`/api/players/${playerId}/date-of-birth`, { method: "POST", token, body });
const correct = (playerId, token, body) =>
  api(`/api/players/${playerId}/date-of-birth/correction`, { method: "POST", token, body });
const changes = (playerId, token) => api(`/api/players/${playerId}/date-of-birth/changes`, { token });
const relink = (playerId, token, body) =>
  api(`/api/players/${playerId}/guardians`, { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

// db/11's constraint stands from the moment migrate seeds the demo database,
// so this is the only way to reach the state it exists to prevent — the same
// trick db/99_rls_verify.sql's own _born_constraint() plays, done here
// directly because that helper is only ever created by --verify and this
// walk gets a plain --reset --seed.
const dropBornConstraint = () => pool.query(`alter table player drop constraint if exists player_born_required`);
const restoreBornConstraint = () => pool.query(
  `alter table player add constraint player_born_required check (born is not null) not valid`);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const registrar = await login("registrar@example.invalid");  // schooladmin: user.role.assign, guardian.link.manage, player.profile.manage
  const coach     = await login("coach@example.invalid");      // 1XI coach: none of the three
  const director  = await login("sarah@example.invalid");      // director of sport: player.profile.manage, not the office
  const principal = await login("principal@example.invalid");  // guardian.link.manage, not the office
  const wesOffice = await login("registrar.wes@example.invalid");
  // R Pillay's ID number is on file (db/98); the date it carries is the only
  // date of birth db/172 lets anyone record for him.
  const pillayId = (await q(`select id_number from player where id = $1`, [P_INJURED]))[0].id_number;
  const pillayBorn = bornFromSaId(pillayId);
  ok("the fixture: R Pillay has an ID number that carries a date", !!pillayBorn, String(pillayId));

  // ── The fixture: R Pillay loses his birthday, and his live guardian
  // link with it — exactly db/10's effect, produced the same way rather than
  // asserted for the test's sake.
  const linkBefore = (await q(
    `select s.id, s.relationship, s.valid_until from assignment_subject s
       join role_assignment a on a.id = s.assignment_id and a.role = 'guardian'
      where a.person_id = $1 and s.player_id = $2`, [PARENT, P_INJURED]))[0];
  // Live: open, because R Pillay is at school (db/62), or dated ahead.
  ok("the fixture starts with a live guardian link to build the walk on",
     linkBefore && (linkBefore.valid_until === null || new Date(linkBefore.valid_until) > new Date()), JSON.stringify(linkBefore));

  await dropBornConstraint();
  await pool.query(`update player set born = null where id = $1`, [P_INJURED]);
  // Wound back to its own start date, exactly as db/99's _expire_link()
  // does: subject_dates requires valid_from <= valid_until, and the seed
  // links start today, so "yesterday" is not a date this row can hold.
  await pool.query(`update assignment_subject set valid_until = valid_from where id = $1`, [linkBefore.id]);
  await restoreBornConstraint();

  group("dob_gaps() answers per capability, not per role name");
  const asRegistrar = await gaps(registrar);
  ok("a plain gap: no date of birth on record",
     asRegistrar.some((r) => r.kind === "no_dob" && r.player_id === P_INJURED));
  ok("...and the guardian link db/10 would have had to end",
     asRegistrar.some((r) => r.kind === "guardian_link_ended" && r.player_id === P_INJURED
       && r.guardian_id === PARENT && r.relationship === linkBefore.relationship));
  const asCoach = await gaps(coach);
  ok("a coach — who holds neither user.role.assign nor guardian.link.manage — sees neither row",
     !asCoach.some((r) => r.player_id === P_INJURED));
  ok("an unauthenticated read is refused, not answered empty",
     [401, 403].includes((await api("/api/read/dob_gaps")).status));

  group("resolveBirthDate()'s refusals arrive as the same codes the client reads");
  ok("neither a birthday nor an ID number", (await capture(P_INJURED, registrar, {})).body?.error === "date_of_birth_required");
  ok("the wrong shape", (await capture(P_INJURED, registrar, { born: "2011/04/07" })).body?.error === "born_must_be_yyyy_mm_dd");
  ok("outside a school pupil's plausible age", (await capture(P_INJURED, registrar, { born: "1970-01-01" })).body?.error === "born_not_plausible_for_a_school_pupil");
  ok("none of that captured anything",
     (await q(`select born from player where id = $1`, [P_INJURED]))[0].born === null);

  group("who may write it is the row's own policy, not this route's");
  ok("a coach — player.profile.manage is not a coaching capability — is refused",
     [403, 401].includes((await capture(P_INJURED, coach, { born: "2013-06-01" })).status));
  ok("...and nothing landed", (await q(`select born from player where id = $1`, [P_INJURED]))[0].born === null);
  ok("an unauthenticated write is refused rather than silently ignored",
     [401, 403].includes((await capture(P_INJURED, undefined, { born: "2013-06-01" })).status));

  group("the write closes a gap and refuses to reopen a birthday already captured");
  // db/172: the ID number already on his record decides, not only one typed beside the date.
  // To one who may not read ID numbers, the refusal says neither that one is
  // on file nor what it carries (review N1).
  const notReader = await capture(P_INJURED, director, { born: "2013-06-01" });
  ok("the director of sport is told only that the office must record it",
     notReader.status === 422 && notReader.body?.error === "born_needs_the_office", JSON.stringify(notReader.body));
  const against = await capture(P_INJURED, registrar, { born: "2013-06-01" });
  ok("a date that disagrees with the ID number on his record is refused, by the database",
     against.status === 422 && against.body?.error === "id_number_disagrees_with_date_of_birth", JSON.stringify(against.body));
  ok("...and nothing landed", (await q(`select born from player where id = $1`, [P_INJURED]))[0].born === null);
  const captured = await capture(P_INJURED, registrar, { born: pillayBorn });
  ok("the office captures the date his ID number carries", captured.status === 200 && captured.body?.born === pillayBorn, JSON.stringify(captured.body));
  ok("...and it is on the record", (await q(`select to_char(born,'YYYY-MM-DD') b from player where id = $1`, [P_INJURED]))[0].b === pillayBorn);
  const again = await capture(P_INJURED, registrar, { born: "2010-01-01" });
  ok("capturing it a second time is refused — WHERE born IS NULL, not a check that could be forgotten",
     again.status === 403 && again.body?.error === "not_permitted", JSON.stringify(again.body));
  ok("...and the first birthday stands", (await q(`select to_char(born,'YYYY-MM-DD') b from player where id = $1`, [P_INJURED]))[0].b === pillayBorn);
  const pillayLog = await changes(P_INJURED, registrar);
  ok("the capture is on his record of changes, and so is the owner's clearing it for this walk",
     pillayLog.status === 200 && pillayLog.body?.changes?.[0]?.how === "capture" && pillayLog.body.changes[0].became === pillayBorn
       && pillayLog.body.changes[0].was === null && /\S/.test(pillayLog.body.changes[0].by ?? "")
       && pillayLog.body.changes.some((c) => c.how === "owner" && c.became === null), JSON.stringify(pillayLog.body));

  group("closing the birthday gap closes both rows dob_gaps() showed — the guardian link needs its own step");
  const afterCapture = await gaps(registrar);
  ok("no date of birth gap is gone", !afterCapture.some((r) => r.kind === "no_dob" && r.player_id === P_INJURED));
  ok("the guardian-link-ended row is gone too — its condition is p.born IS NULL, the same fact just closed",
     !afterCapture.some((r) => r.kind === "guardian_link_ended" && r.player_id === P_INJURED));
  const linkCountBefore = (await q(
    `select count(*)::int n from assignment_subject s
       join role_assignment a on a.id = s.assignment_id and a.role = 'guardian'
      where a.person_id = $1 and s.player_id = $2`, [PARENT, P_INJURED]))[0].n;

  group("re-establishing the link is the second, separately-authorized call");
  const relinked = await relink(P_INJURED, registrar, { guardianId: PARENT, relationship: linkBefore.relationship });
  ok("the same guardian, the same relationship, now that the birthday exists", relinked.status === 200 && relinked.body?.ok === true, JSON.stringify(relinked.body));
  const linkCountAfter = (await q(
    `select count(*)::int n from assignment_subject s
       join role_assignment a on a.id = s.assignment_id and a.role = 'guardian'
      where a.person_id = $1 and s.player_id = $2`, [PARENT, P_INJURED]))[0].n;
  ok("a new link was recorded rather than the ended one being revived", linkCountAfter === linkCountBefore + 1);
  // Since db/62 a link made for a pupil at school is open until he leaves
  // (and ends at the later of that day and his majority); one made for a boy
  // out of school ends on the new birthday's own majority. R Pillay is at
  // school, so it is open — and asserted with the reason it may be.
  const newLink = (await q(
    `select s.valid_until, still_at_school(s.player_id) as at_school from assignment_subject s
       join role_assignment a on a.id = s.assignment_id and a.role = 'guardian'
      where a.person_id = $1 and s.player_id = $2
      order by s.created_at desc limit 1`, [PARENT, P_INJURED]))[0];
  ok("...open while he is at school, not ended and not dated past his majority",
     newLink.valid_until === null && newLink.at_school === true, JSON.stringify(newLink));

  group("an ID number is enough on its own — the same door the roster form uses");
  await dropBornConstraint();
  await pool.query(`update player set born = null where id = $1`, [P_U13]);
  await restoreBornConstraint();
  ok("B Khumalo is now a plain gap", (await gaps(registrar)).some((r) => r.kind === "no_dob" && r.player_id === P_U13));
  const byId = await capture(P_U13, registrar, { idNumber: "1104075800085" });
  ok("the birthday is read out of the ID number", byId.status === 200 && byId.body?.bornFrom === "id_number", JSON.stringify(byId.body));
  ok("...the date it decodes to", (await q(`select to_char(born,'YYYY-MM-DD') b from player where id = $1`, [P_U13]))[0].b === "2011-04-07");
  ok("...and the number itself is kept", (await q(`select id_number from player where id = $1`, [P_U13]))[0].id_number === "1104075800085");
  ok("the gap is gone", !(await gaps(registrar)).some((r) => r.player_id === P_U13));

  group("correcting a recorded date is the office's, and every change is kept (db/172)");
  const u16 = (await q(`select to_char(born,'YYYY-MM-DD') b from player where id = $1`, [P_U16]))[0].b;
  const u16New = `${u16.slice(0, 5)}${u16.slice(5, 7) === "03" ? "04" : "03"}${u16.slice(7)}`;
  for (const [who, token] of [["a coach", coach], ["the director of sport", director], ["the principal", principal],
                              ["another school's office", wesOffice]]) {
    const r = await correct(P_U16, token, { born: u16New });
    ok(`${who} may not correct it`, r.status === 403 && r.body?.error === "not_permitted", JSON.stringify(r.body));
    const h = await changes(P_U16, token);
    ok(`...nor read its changes`, h.status === 403, JSON.stringify(h.body));
  }
  ok("an unauthenticated correction is refused", [401, 403].includes((await correct(P_U16, undefined, { born: u16New })).status));
  ok("...and his date stands", (await q(`select to_char(born,'YYYY-MM-DD') b from player where id = $1`, [P_U16]))[0].b === u16);
  ok("the wrong shape is refused before the database is asked",
     (await correct(P_U16, registrar, { born: "2011/04/07" })).body?.error === "born_must_be_yyyy_mm_dd");
  ok("...and a date outside a pupil's age", (await correct(P_U16, registrar, { born: "1970-01-01" })).body?.error === "born_not_plausible_for_a_school_pupil");
  ok("a player id that is not one is not found", (await correct("not-a-player", registrar, { born: u16New })).status === 404);
  const fixed = await correct(P_U16, registrar, { born: u16New });
  ok("the office corrects it", fixed.status === 200 && fixed.body?.born === u16New && fixed.body?.was === u16 && fixed.body?.unchanged === false,
     JSON.stringify(fixed.body));
  ok("...and the record says so", (await q(`select to_char(born,'YYYY-MM-DD') b from player where id = $1`, [P_U16]))[0].b === u16New);
  const same = await correct(P_U16, registrar, { born: u16New });
  ok("the date already on record is answered unchanged", same.status === 200 && same.body?.unchanged === true, JSON.stringify(same.body));
  const log = await changes(P_U16, registrar);
  ok("the office reads one change: before, after, how, by whom",
     log.status === 200 && log.body?.born === u16New && log.body?.changes?.length === 1
       && log.body.changes[0].was === u16 && log.body.changes[0].became === u16New
       && log.body.changes[0].how === "correction" && /\S/.test(log.body.changes[0].by ?? ""), JSON.stringify(log.body));
  // B Khumalo now carries 1104075800085: only its own date may stand.
  const offId = await correct(P_U13, registrar, { born: "2011-04-08" });
  ok("a correction that disagrees with his ID number is refused",
     offId.status === 422 && offId.body?.error === "id_number_disagrees_with_date_of_birth", JSON.stringify(offId.body));
  ok("...and his date stands", (await q(`select to_char(born,'YYYY-MM-DD') b from player where id = $1`, [P_U13]))[0].b === "2011-04-07");
  ok("the refusals wrote nothing to his record of changes",
     (await q(`select count(*)::int n from player_born_change where player_id = $1 and how = 'correction'`, [P_U13]))[0].n === 0);

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`DOB GAPS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

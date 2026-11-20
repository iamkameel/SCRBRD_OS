#!/usr/bin/env node
/**
 * The office opening an account for somebody already in the building.
 *
 * Settings showed the pilot the shape of the problem plainly: "On a roster,
 * no account — 16 of 18. These people appear in Squad and Profiles and hold a
 * passport, but cannot sign in." Every one of those boys already had a player
 * row. What none of them had was an app_user, and nothing in the product made
 * one. `+ Add User` pushed an object into React state and forgot it on reload.
 *
 * onboard_request() is the PULL path and it works — a stranger asks, the
 * school answers. It is no use here. A school arriving with a roster cannot
 * wait for sixteen children to find the onboarding screen.
 *
 * What this walk proves:
 *
 *   1. the office enrols a boy who is already on the roster, and the account
 *      is LINKED to his player row — that link is what lets him read himself
 *   2. the capability decides, not the role name, and not seniority
 *   3. a refusal leaves NOTHING behind: no half-made account, no unanswered
 *      request. This is the guardian_link_establish() lesson — a plpgsql
 *      RETURN is not a rollback — and the reason enrolment writes inside a
 *      subtransaction
 *   4. the login code is issued once and is the only moment it is readable
 *   5. the enrolled boy can actually sign in with it and read his own record
 *   6. a platform role is never given at a school (db/86): the platform
 *      account and the owner are refused platformadmin and superadmin there,
 *      by name, with nothing left behind — the 200 the RBAC diagnosis of
 *      2026-10-07 found
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-enrol.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8871);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

// U13A boys the seed leaves without an account — the population this exists for.
const MAHLANGU = "aaaaaaaa-0000-0000-0000-000000000011";
const SITHOLE  = "aaaaaaaa-0000-0000-0000-000000000012";
const KHUMALO  = "aaaaaaaa-0000-0000-0000-000000000013";
const PILLAY   = "aaaaaaaa-0000-0000-0000-000000000005";  // already has an account
const ADULT    = "aaaaaaaa-0000-0000-0000-000000000003";  // S Naidoo, past eighteen

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-enrol-secret" },
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
  method: "POST", body: { email, deviceId: "device-enrol" } })).body?.token;
const enrol = (token, body) => api("/api/users", { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const accounts = async (email) =>
  (await q(`select count(*)::int n from app_user where lower(email) = lower($1)`, [email]))[0].n;
const openRequests = async (email) =>
  (await q(`select count(*)::int n from role_request r join app_user u on u.id = r.person_id
             where lower(u.email) = lower($1)`, [email]))[0].n;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const registrar = await login("registrar@example.invalid");   // schooladmin, Hilton
  const coach     = await login("coach@example.invalid");       // 1XI coach
  const parent    = await login("parent@example.invalid");      // guardian
  const regWes    = await login("registrar.wes@example.invalid");

  group("A boy on the roster, and no way to sign in");
  const before = await q(
    `select count(*)::int n from player p
      where p.school_id = $1
        and not exists (select 1 from app_user u where u.player_id = p.id)`, [HIL]);
  ok("the seed really does hold players with no account — the walk is not proving a vacuum",
     before[0].n > 0);

  group("The capability decides who may enrol");
  const body = (email, name, player, team) => ({
    email, name, role: "player", schoolId: HIL, teamCode: team, playerId: player });
  ok("a coach may not open an account — user.role.assign is not a coaching capability",
     (await enrol(coach, body("a@example.invalid", "A One", MAHLANGU, "U13A"))).status === 403);
  ok("nor may a guardian",
     (await enrol(parent, body("b@example.invalid", "B Two", MAHLANGU, "U13A"))).status === 403);
  ok("nor may another school's office, for a boy who is not theirs",
     [403, 404, 422].includes((await enrol(regWes, body("c@example.invalid", "C Three", MAHLANGU, "U13A"))).status));
  ok("an unauthenticated request is refused rather than silently ignored",
     [401, 403].includes((await enrol(undefined, body("d@example.invalid", "D Four", MAHLANGU, "U13A"))).status));
  ok("...and not one of those attempts left an account behind",
     (await accounts("a@example.invalid")) === 0 && (await accounts("b@example.invalid")) === 0
     && (await accounts("c@example.invalid")) === 0 && (await accounts("d@example.invalid")) === 0);

  group("The office can, and the account is linked to the boy");
  const made = await enrol(registrar, body("l.mahlangu@example.invalid", "L Mahlangu", MAHLANGU, "U13A"));
  ok("the registrar enrols him", made.status === 200 && !!made.body?.userId);
  const row = (await q(`select player_id, school_id, role, active from app_user where id = $1`, [made.body.userId]))[0];
  ok("...and the account NAMES HIS PLAYER ROW — the link is the whole point",
     row?.player_id === MAHLANGU);
  ok("...at his own school", row?.school_id === HIL);
  ok("...and is live", row?.active === true);

  const asg = await q(`select role, team_code from role_assignment where person_id = $1 order by role`, [made.body.userId]);
  ok("he holds the team role, scoped to his side",
     asg.some((a) => a.role === "player" && a.team_code === "U13A"));
  ok("...and the self-access pair that lets him read his own record, which a team role alone does not",
     asg.some((a) => a.role === "selfaccess"));

  const req = await q(`select state, decided_by from role_request r where r.person_id = $1`, [made.body.userId]);
  ok("the enrolment is on the record as a request somebody answered, not a silent insert",
     req.length === 1 && req[0].state === "granted" && req[0].decided_by != null);

  group("A refusal leaves nothing behind");
  // Each of these is refused at a different depth: the first two before any
  // write, the third INSIDE decide_role_request() — after the account row has
  // already been written. Only the subtransaction makes the third clean, and
  // it is the one that would rot quietly.
  ok("a pupil who already has an account is refused",
     (await enrol(registrar, body("second@example.invalid", "Second Claim", PILLAY, "1XI"))).body?.error
       === "player_already_has_an_account");
  ok("...as a conflict, not as a permission problem",
     (await enrol(registrar, body("second2@example.invalid", "Second Claim", PILLAY, "1XI"))).status === 409);
  ok("a coach enrolled with no side is refused — a coach is a coach OF something",
     (await enrol(registrar, { email: "nc@example.invalid", name: "N Coach", role: "coach", schoolId: HIL }))
       .body?.error === "team_required");
  ok("...and that refusal, which happens AFTER the account row is written, still leaves none",
     (await accounts("nc@example.invalid")) === 0 && (await openRequests("nc@example.invalid")) === 0);
  ok("a guardian for a player who has turned eighteen is refused",
     (await enrol(registrar, { email: "adult@example.invalid", name: "A Naidoo", role: "guardian",
                               schoolId: HIL, playerId: ADULT })).body?.error === "player_is_an_adult");
  ok("...leaving no account either", (await accounts("adult@example.invalid")) === 0);
  ok("an email already belonging to another school is refused rather than quietly moved",
     (await enrol(registrar, { email: "coach.wes@example.invalid", name: "Wes Coach", role: "coach",
                               schoolId: HIL, teamCode: "U13A" })).body?.error === "email_belongs_to_another_school");
  ok("a malformed email never reaches the database",
     (await enrol(registrar, body("not-an-email", "N E", SITHOLE, "U13A"))).body?.error === "email_invalid");

  group("The signed form on file names who signed it, and when (db/169, D)");
  // The tick with nobody named is refused, and the whole enrolment with it.
  const unsigned = await enrol(registrar, { ...body("j.sithole@example.invalid", "J Sithole", SITHOLE, "U13A"),
                                            withCode: true, formOnFile: true });
  ok("a tick naming nobody is refused", unsigned.status === 422 && unsigned.body?.error === "form_form_signer_required");
  ok("...and rolls the enrolment back: no account", (await accounts("j.sithole@example.invalid")) === 0);
  const futureForm = await enrol(registrar, { ...body("j.sithole@example.invalid", "J Sithole", SITHOLE, "U13A"),
                                              formOnFile: true, formSignedBy: "M Sithole", formSignedOn: "2999-01-01" });
  ok("a form dated after today is refused", futureForm.status === 422 && futureForm.body?.error === "form_form_date_invalid");
  ok("a pupil's role naming no boy is refused before anything is asked (A)",
     (await enrol(registrar, { email: "noboy@example.invalid", name: "No Boy", role: "player", schoolId: HIL, teamCode: "U13A" })).body?.error === "player_required");

  group("The code is issued once, and it works");
  // db/169 (Q12, D): the office ticks "The signed consent form is on file" for a boy under 18, with who signed it and when.
  const signedOn = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const withCode = await enrol(registrar, { ...body("j.sithole@example.invalid", "J Sithole", SITHOLE, "U13A"),
                                            withCode: true, formOnFile: true, formSignedBy: "M Sithole", formSignedOn: signedOn });
  {
    const rec = await q(`select how, form_signed_by, form_signed_on::text as d from pupil_signin_consent where player_id = $1 and answer = 'yes'`, [SITHOLE]);
    ok("the form is on record with its signer and its day", rec.length === 1 && rec[0].how === "office" && rec[0].form_signed_by === "M Sithole" && rec[0].d === signedOn, JSON.stringify(rec));
  }
  ok("the office asks for a code and gets one", withCode.status === 200 && typeof withCode.body?.code === "string");
  ok("...with an expiry, so a code left on a desk does not work forever", !!withCode.body?.expiresAt);
  const stored = await q(`select code_hash from login_code where user_id = $1`, [withCode.body.userId]);
  ok("...and what is STORED is not the code — this is the only moment it is readable",
     stored.length === 1 && stored[0].code_hash !== withCode.body.code);

  const redeemed = await api("/api/auth/redeem", { method: "POST",
    body: { email: "j.sithole@example.invalid", code: withCode.body.code, deviceId: "his-phone" } });
  ok("the boy signs in with it", redeemed.status === 200 && !!redeemed.body?.token);
  const self = await api(`/api/read/players?playerId=${SITHOLE}`, { token: redeemed.body.token });
  ok("...and reads his own record, which is what the account was for",
     (self.body?.rows ?? []).some((p) => p.id === SITHOLE));
  const spent = await api("/api/auth/redeem", { method: "POST",
    body: { email: "j.sithole@example.invalid", code: withCode.body.code, deviceId: "another-phone" } });
  ok("...and the code cannot be spent twice", spent.status !== 200);

  group("His own sign-in, as the office reads and answers it (db/169: S4, D, E, S5, S10)");
  {
    const st = await api(`/api/players/${SITHOLE}/own-signin`, { token: registrar });
    ok("the office reads the form's signer and day", st.status === 200 && st.body?.ownSignIn?.office === true
       && st.body.ownSignIn.formSignedBy === "M Sithole" && st.body.ownSignIn.formSignedOn === signedOn, JSON.stringify(st.body));
    ok("a coach reads nothing of it", (await api(`/api/players/${SITHOLE}/own-signin`, { token: coach })).status === 403);
    ok("a coach records no withdrawal", (await api(`/api/players/${SITHOLE}/own-signin/office`, { method: "POST", token: coach, body: { withdrawn: true } })).status === 403);
    const wd = await api(`/api/players/${SITHOLE}/own-signin/office`, { method: "POST", token: registrar, body: { withdrawn: true } });
    ok("the office records a withdrawal: closed", wd.status === 200 && wd.body?.inForce === false, JSON.stringify(wd.body));
    const noSigner = await api(`/api/players/${SITHOLE}/own-signin/office`, { method: "POST", token: registrar, body: { formOnFile: true } });
    ok("a new form naming nobody is refused", noSigner.status === 422 && noSigner.body?.error === "form_signer_required");
    const again = await api(`/api/players/${SITHOLE}/own-signin/office`, { method: "POST", token: registrar,
      body: { formOnFile: true, formSignedBy: "M Sithole", formSignedOn: signedOn } });
    ok("a new form, named and dated, opens him again", again.status === 200 && again.body?.inForce === true && again.body?.held === null, JSON.stringify(again.body));
    const retry = await api(`/api/players/${SITHOLE}/own-signin/office`, { method: "POST", token: registrar, body: { retry: true } });
    ok("trying again with nothing waiting is answered, not refused", retry.status === 200 && retry.body?.inForce === true);
    ok("'This account is not him' is the office's: a coach is refused",
       (await api(`/api/pupil-claims/00000000-0000-4000-8000-000000000001/not-him`, { method: "POST", token: coach })).status === 403);
  }

  group("Enrolling without a code still makes a real account");
  const noCode = await enrol(registrar, body("b.khumalo@example.invalid", "B Khumalo", KHUMALO, "U13A"));
  ok("no code is returned when none was asked for", noCode.status === 200 && noCode.body?.code === undefined);
  ok("...but the account is there", (await accounts("b.khumalo@example.invalid")) === 1);
  const later = await api("/api/auth/invite", { method: "POST", token: registrar,
                                                body: { email: "b.khumalo@example.invalid" } });
  ok("...and a code can be issued for it afterwards, through the route that already existed",
     later.status === 200 && typeof later.body?.code === "string");

  group("A platform role belongs to no school (db/86)");
  // The RBAC diagnosis of 2026-10-07: each of these answered 200, and wrote
  // a platform role scoped to a school — a superadmin there holds every
  // school capability, medical and PII included.
  const platform = await login("platform@example.invalid");   // platformadmin, no school
  const owner    = await login("owner@example.invalid");      // superadmin, no school
  const platformAt = (token, email, role, schoolId) => enrol(token, { email, name: "V86 Platform", role, schoolId });
  const refusals = [
    ["the platform account, a platformadmin at Westville", await platformAt(platform, "v86.p.wes@example.invalid", "platformadmin", WES)],
    ["the platform account, a platformadmin at Hilton",    await platformAt(platform, "v86.p.hil@example.invalid", "platformadmin", HIL)],
    ["the owner, a superadmin at Westville",                await platformAt(owner,    "v86.o.wes@example.invalid", "superadmin",    WES)],
    ["the owner, a platformadmin at Westville",             await platformAt(owner,    "v86.o.pla@example.invalid", "platformadmin", WES)],
  ];
  for (const [who, r] of refusals) {
    ok(`${who} is refused, 422 platform_role_needs_no_school (was ${r.status} ${r.body?.error ?? ""})`,
       r.status === 422 && r.body?.error === "platform_role_needs_no_school");
  }
  ok("...and none of those left an account behind",
     (await accounts("v86.p.wes@example.invalid")) + (await accounts("v86.p.hil@example.invalid"))
     + (await accounts("v86.o.wes@example.invalid")) + (await accounts("v86.o.pla@example.invalid")) === 0);
  ok("no platform role on the record names a school",
     (await q(`select count(*)::int n from role_assignment
                where role in ('superadmin', 'platformadmin') and school_id is not null`))[0].n === 0);
  ok("the two tenant-less keys the seed writes are still live",
     (await q(`select count(*)::int n from role_assignment
                where role in ('superadmin', 'platformadmin') and school_id is null and active`))[0].n === 2);
  const coachWes = await enrol(platform, { email: "v86.coach@example.invalid", name: "V86 Coach", role: "coach",
                                           schoolId: WES, teamCode: "U14A" });
  ok("the platform account still enrols an ordinary role at a school", coachWes.status === 200 && !!coachWes.body?.userId);

  group("Add role names the account, not its email (db/122)");
  // Kameel, 29 Oct 2026: "Close both doors, and add-role uses the account
  // id". A pupil's login email is the office's alone (db/118), so the
  // director of sport, who may give a pupil's account the scorer's role, is
  // not given his address; she names the account by its id, and the server
  // reads the address itself and never sends it back.
  const sarah = await login("sarah@example.invalid");   // director of sport, Hilton
  const PILLAY_ACCOUNT = "88888888-0000-0000-0000-000000000009";
  const byId = await enrol(sarah, { userId: PILLAY_ACCOUNT, role: "scorer", schoolId: HIL });
  ok(`the director of sport adds a role to the pupil's account by its id (was ${byId.status} ${byId.body?.error ?? ""})`,
     byId.status === 200 && byId.body?.userId === PILLAY_ACCOUNT && !!byId.body?.assignmentId);
  ok("...and the answer carries no address", !JSON.stringify(byId.body).includes("@"));
  ok("...and the role is on his account, the one she named",
     (await q(`select count(*)::int n from role_assignment where person_id = $1 and role = 'scorer' and active`, [PILLAY_ACCOUNT]))[0].n === 1);
  ok("...with no second account made", (await accounts("pillay@example.invalid")) === 1);
  const unseen = await enrol(sarah, { userId: "88888888-0000-0000-0000-0000000000ff", role: "scorer", schoolId: HIL });
  ok(`an account she cannot read is not one she can add a role to (was ${unseen.status})`, unseen.status === 403);
  const coachBy = await enrol(coach, { userId: PILLAY_ACCOUNT, role: "scorer", schoolId: HIL });
  ok(`nor may a coach, by id any more than by email (was ${coachBy.status})`, coachBy.status === 403);
  ok("a malformed account id never reaches the database",
     (await enrol(sarah, { userId: "not-a-uuid", role: "scorer", schoolId: HIL })).status === 400);

  group("A pupil's sign-in code is the office's, named by the account (db/122 §1d)");
  // Kameel, 29 Oct 2026, on the read-through: issuing a pupil's code belongs
  // to the office alone, the door that reads his address; "Issue a code"
  // names the account by its id, as Add role does.
  const invite = (token, body) => api("/api/auth/invite", { method: "POST", token, body });
  const dosCode = await invite(sarah, { userId: PILLAY_ACCOUNT });
  ok(`the director of sport is not issued the pupil's code (was ${dosCode.status} ${dosCode.body?.error ?? ""})`,
     dosCode.status >= 400 && dosCode.body?.error === "office_only" && !dosCode.body?.code);
  ok("...nor by his address, which she was never given",
     (await invite(sarah, { email: "pillay@example.invalid" })).body?.error === "office_only");
  const officeCode = await invite(registrar, { userId: PILLAY_ACCOUNT });
  ok(`the office issues it, by the account's id (was ${officeCode.status} ${officeCode.body?.error ?? ""})`,
     officeCode.status === 200 && typeof officeCode.body?.code === "string" && !JSON.stringify(officeCode.body).includes("@"));
  const dosAdult = await invite(sarah, { userId: "88888888-0000-0000-0000-00000000000a" });
  ok(`...and the director still issues an adult's she may grant, by id (was ${dosAdult.status} ${dosAdult.body?.error ?? ""})`,
     dosAdult.status === 200 && typeof dosAdult.body?.code === "string");
  ok("an account the caller cannot read is refused, by id",
     (await invite(sarah, { userId: "88888888-0000-0000-0000-0000000000ff" })).body?.error === "not_permitted");

  // ...and so is opening his account: POST /api/users refuses her before
  // enrol_person() writes anything, so no account is left made with no code.
  const [{ id: UNENROLLED, team_code: UNENROLLED_TEAM }] = await q(
    `select p.id::text, p.team_code from player p
      where p.school_id = $1 and p.team_code is not null
        and not exists (select 1 from app_user u where u.player_id = p.id)
      order by p.id limit 1`, [HIL]);
  const dosEnrol = await enrol(sarah, { ...body("v122.pupil@example.invalid", "V Pupil", UNENROLLED, UNENROLLED_TEAM), withCode: true });
  ok(`the director of sport may not open a pupil's account (was ${dosEnrol.status} ${dosEnrol.body?.error ?? ""})`,
     dosEnrol.status === 403 && dosEnrol.body?.error === "office_only" && !dosEnrol.body?.code);
  ok("...nor without a code: the account is the office's to open",
     (await enrol(sarah, body("v122.pupil@example.invalid", "V Pupil", UNENROLLED, UNENROLLED_TEAM))).body?.error === "office_only");
  ok("...and neither left an account, or a request, behind",
     (await accounts("v122.pupil@example.invalid")) === 0 && (await openRequests("v122.pupil@example.invalid")) === 0
     && (await q(`select count(*)::int n from app_user where player_id = $1`, [UNENROLLED]))[0].n === 0);
  const rolesBefore = (await q(`select count(*)::int n from role_assignment where person_id = $1`, [PILLAY_ACCOUNT]))[0].n;
  const codesBefore = (await q(`select count(*)::int n from login_code where user_id = $1`, [PILLAY_ACCOUNT]))[0].n;
  const dosAddCode = await enrol(sarah, { userId: PILLAY_ACCOUNT, role: "official", schoolId: HIL, withCode: true });
  ok(`a role by his id WITH a code is refused her too (was ${dosAddCode.status} ${dosAddCode.body?.error ?? ""})`,
     dosAddCode.status === 403 && dosAddCode.body?.error === "office_only" && !dosAddCode.body?.code);
  ok("...before anything was written: no role added, no code made",
     (await q(`select count(*)::int n from role_assignment where person_id = $1`, [PILLAY_ACCOUNT]))[0].n === rolesBefore
     && (await q(`select count(*)::int n from login_code where user_id = $1`, [PILLAY_ACCOUNT]))[0].n === codesBefore);
  const dosStaff = await enrol(sarah, { email: "v122.coach@example.invalid", name: "V Coach", role: "coach",
                                        schoolId: HIL, teamCode: "U13A", withCode: true });
  ok(`an adult's enrolment by the director, with a code, is unchanged (was ${dosStaff.status} ${dosStaff.body?.error ?? ""})`,
     dosStaff.status === 200 && !!dosStaff.body?.userId && typeof dosStaff.body?.code === "string");

  group("The roster gap actually closes");
  const after = await q(
    `select count(*)::int n from player p
      where p.school_id = $1
        and not exists (select 1 from app_user u where u.player_id = p.id)`, [HIL]);
  ok("three enrolments, three fewer boys without an account", after[0].n === before[0].n - 3);

} catch (e) {
  fail++; console.log("\n  ✗ the walk threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`ENROLMENT SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

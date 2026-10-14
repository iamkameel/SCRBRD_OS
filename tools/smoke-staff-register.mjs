#!/usr/bin/env node
/**
 * The school staff register, over HTTP (SCRBRD-140 phase 2, db/92), and the
 * declined-parent-claim notice and request cooldown (db/93).
 *
 * Named apart from tools/smoke-register.mjs, which is the officials register.
 * The server is started with FIREBASE_TEST_KEYS, a JWK set this walk
 * generates (smoke-signup.mjs's arrangement), so a fixture Google account can
 * sign in without touching Google. What the walk proves, through the server
 * the app talks to (docs/design/SCRBRD-140_phase2_register.md §8 item 6):
 *
 *   1. the office checks a staff.csv with bad rows: every problem in words,
 *      nothing written; then imports a clean one
 *   2. a fixture Google account claims: "You're in", with no role chosen; on
 *      its very next read the squad is there; the office sees the row claimed
 *   3. the office ends both roles; a second claim grants nothing and reads
 *      as the ordinary request path
 *   4. an uploader whose own role has since ended grants nothing: the claim
 *      reads the same, and the request waits for the office
 *   5. the register is the office's: a coach reads none of it and may not
 *      upload or withdraw; withdraw, and the redaction count
 *   6. a declined parent claim tells the DSO, naming nobody, and not the
 *      office; three in thirty days pause the asker — POST /api/requests and
 *      the register's claim say so in words, signed-out onboarding does not;
 *      the office may not lift it, the DSO does
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-staff-register.mjs
 */
import { spawn } from "node:child_process";
import { generateKeyPairSync, createSign } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8992);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const PROJECT = "scrbrd-os-test";
const RUN = Date.now().toString(36);
const WHY = "Left the school at the end of term.";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);
/** A refusal or an answer in a sentence, not a raw code. */
const inWords = (s) => typeof s === "string" && /\s/.test(s) && !/_/.test(s);

// ── The walk's own "Google" ──
const dir = mkdtempSync(join(tmpdir(), "scrbrd-register-"));
const keyFile = join(dir, "keys.json");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
writeFileSync(keyFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "walk-1", alg: "RS256", use: "sig" }] }));
const b64 = (s) => Buffer.from(s).toString("base64url");
const idToken = (uid, email) => {
  const t = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, email, email_verified: true,
                    name: "Walk Person", iat: t - 5, exp: t + 3600, auth_time: t - 5, firebase: { sign_in_provider: "google.com" } };
  const input = `${b64(JSON.stringify({ alg: "RS256", kid: "walk-1", typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
  const s = createSign("RSA-SHA256"); s.update(input);
  return `${input}.${s.sign(privateKey).toString("base64url")}`;
};

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-staff-register-secret", FIREBASE_TEST_KEYS: keyFile,
         PUBLIC_TRUST_PROXY_HOPS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

let addr = 0;
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.92.0.${(addr++ % 250) + 1}`,
               ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-register" } })).body?.token;
/** A Google account new to SCRBRD: its token. */
const google = async (uid, email) => {
  const r = await api("/api/auth/firebase", { method: "POST", body: { idToken: idToken(uid, email), deviceId: "device-register" } });
  return r.status === 200 ? r.body.token : null;
};
const upload = (token, body) => api(`/api/register/${HIL}`, { method: "POST", token, body });
const claim = (token) => api("/api/join/register-claim", { method: "POST", token, body: { schoolId: HIL } });
const HEAD = "name,email,role,team_code,valid_until";

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;
const assignmentOf = async (email, role) => (await q(
  `select a.id from role_assignment a join app_user u on u.id = a.person_id
    where lower(u.email) = lower($1) and a.role = $2 and a.active order by a.created_at limit 1`, [email, role]))[0]?.id;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const office = await login("registrar@example.invalid");     // schooladmin, Hilton
  const head = await login("principal@example.invalid");       // principal, Hilton
  const coach = await login("coach@example.invalid");          // coach, Hilton 1XI
  const dso = await login("dso@example.invalid");              // DSO, Hilton
  ok("the office, the principal, a coach and the DSO sign in", !!(office && head && coach && dso));

  group("1. Check, then import: every problem in words, all or nothing");
  const STAFF = `walk.staff.${RUN}@example.invalid`;
  {
    const bad = [HEAD, `Walk Staff,${STAFF},coach,U14A,`, "Walk Parent,walk.parent@example.invalid,guardian,,",
                 "Walk Nurse,walk.nurse@example.invalid,medical,,", "Walk Head,walk.head@example.invalid,principal,,",
                 "Walk Sideless,walk.sideless@example.invalid,coach,,", `Walk Staff,${STAFF},coach,U14A,`].join("\n");
    const r = await upload(office, { csv: bad, commit: true });
    const at = (line) => r.body?.rows?.find((x) => x.line === line);
    ok("a file with bad rows answers 200, not ok, nothing committed", r.status === 200 && r.body?.ok === false && r.body?.committed === false, r.body);
    ok("the good row is fine", at(2)?.ok === true && at(2)?.words === null, at(2));
    ok("a parent's row says where parents are linked",
       /^Row 3: a parent is linked by the office from a request/.test(at(3)?.words ?? ""), at(3));
    ok("a role the office may not grant is not listable here (medical)", at(4)?.problem === "not_grantable_here" && inWords(at(4)?.words), at(4));
    ok("...nor the principal", at(5)?.words === "Row 5: 'Principal' is not a role you can list here.", at(5));
    ok("a coach needs a side", at(6)?.words === "Row 6: a coach needs a side.", at(6));
    ok("the same row twice names the first line", at(7)?.words === "Row 7: the same person, role and side is on line 2.", at(7));
    const sensitive = await upload(head, { rows: [{ name: "Walk Nurse", email: "walk.nurse@example.invalid", role: "medical" }] });
    ok("over the ceiling, even for the principal: medical staff are added from People",
       sensitive.body?.rows?.[0]?.words === "Row 1: Medical Staff is added from People, not from the register.", sensitive.body);
    const none = (await q(`select count(*)::int n from school_register where email = $1`, [STAFF]))[0].n;
    ok("nothing was written", none === 0, none);
    const good = await upload(office, { csv: [HEAD, `Walk Staff,${STAFF},coach,U14A,`, `Walk Staff,${STAFF},scorer,,`].join("\n"), commit: true });
    ok("a clean file imports, with one upload id and a row id each",
       good.status === 200 && good.body?.committed && !!good.body?.uploadId && good.body.rows.every((x) => x.ok && x.rowId), good.body);
    const list = await api(`/api/register/${HIL}?state=open`, { token: office });
    ok("the office reads both rows open, with who listed them",
       list.status === 200 && list.body.rows.filter((x) => x.email === STAFF && x.state === "open" && x.uploaded_by_name === "B Naicker").length === 2, list.body);
  }

  group("2. A Google account claims what the office listed");
  const staffTok = await google(`walk-staff-${RUN}`, STAFF);
  ok("the staff member signs in with Google, to an account with no school", !!staffTok);
  {
    const r = await claim(staffTok);
    ok("You're in, with no role chosen", r.status === 200 && r.body?.words === "You're in. The office listed you as Coach (U14A) and Scorer."
       && r.body.granted.length === 2 && r.body.requested.length === 0, r.body);
    const session = await api("/api/session", { token: staffTok });
    ok("on the next request the session holds both roles at Hilton",
       session.body?.assignments?.filter((a) => a.school === HIL && ["coach", "scorer"].includes(a.role)).length === 2, session.body?.assignments);
    const squad = await api("/api/read/players", { token: staffTok });
    ok("on its very next read, with the same token, the squad is there", squad.status === 200 && squad.body?.rows?.length > 0, squad.status);
    const list = await api(`/api/register/${HIL}?state=claimed`, { token: office });
    ok("the office sees both rows claimed, granted", list.body?.rows?.filter((x) => x.email === STAFF && x.outcome === "granted").length === 2, list.body);
    const people = await api("/api/read/assignments", { token: office });
    const mine = people.body?.rows?.find((a) => a.role === "coach" && a.team_code === "U14A" && a.granted_note?.startsWith("from the staff register, row "));
    ok("People's appointments read carries the register's note", !!mine, people.status);
    const notices = await api("/api/read/notifications", { token: office });
    ok("the office is told who joined", notices.body?.rows?.some((n) => n.title === "Joined from the staff register"), notices.status);
  }

  group("3. Ended, then claimed again: the ordinary request path");
  {
    for (const role of ["coach", "scorer"]) {
      const id = await assignmentOf(STAFF, role);
      const r = await api(`/api/assignments/${id}/end`, { method: "POST", token: office, body: { reason: WHY } });
      ok(`the office ends the ${role}'s role`, r.status === 200 && r.body?.ended, r.body);
    }
    const again = await claim(staffTok);
    ok("a second claim grants nothing and reads as no row at all",
       again.status === 200 && again.body?.granted.length === 0 && again.body?.requested.length === 0 && again.body?.words === null, again.body);
    // Listed again: the recent ending is a warning, and the import needs its tick.
    const warn = await upload(office, { rows: [{ name: "Walk Staff", email: STAFF, role: "scorer" }] });
    const w = warn.body?.rows?.[0];
    ok("listing him again warns that his role ended", w?.ok && w?.warning === "recently_ended"
       && /^Ended \d{1,2} [A-Z][a-z]+ \((Coach \(U14A\)|Scorer)\)\. List anyway\?$/.test(w?.warningWords ?? "")
       && /^\d{4}-\d{2}-\d{2}$/.test(w?.endedOn ?? "") && !!w?.ack, w);
    const unticked = await upload(office, { rows: [{ name: "Walk Staff", email: STAFF, role: "scorer" }], commit: true });
    ok("...and the import refuses it unticked", unticked.body?.committed === false && unticked.body.rows[0].problem === "warning_not_acknowledged", unticked.body);
    const ticked = await upload(office, { rows: [{ name: "Walk Staff", email: STAFF, role: "scorer" }], commit: true, acknowledged: [w?.ack] });
    ok("...and takes it ticked", ticked.body?.committed === true, ticked.body);
  }

  group("4. An uploader who has since left grants nothing");
  const OFF2 = `walk.office.${RUN}@example.invalid`;
  const LATE = `walk.late.${RUN}@example.invalid`;
  {
    const enrol = await api("/api/users", { method: "POST", token: head, body: { email: OFF2, name: "Walk Office", role: "schooladmin", schoolId: HIL } });
    ok("the principal enrols a second office", enrol.status === 200 && !!enrol.body?.assignmentId, enrol.body);
    const office2 = await login(OFF2);
    const up = await upload(office2, { rows: [{ name: "Walk Late", email: LATE, role: "scorer" }], commit: true });
    ok("the second office lists a scorer", up.body?.committed === true, up.body);
    const end = await api(`/api/assignments/${enrol.body?.assignmentId}/end`, { method: "POST", token: head, body: { reason: WHY } });
    ok("the principal ends the second office's role", end.status === 200, end.body);
    const lateTok = await google(`walk-late-${RUN}`, LATE);
    const r = await claim(lateTok);
    ok("the claim grants nothing, in the same words as no row",
       r.status === 200 && r.body?.granted.length === 0 && r.body?.requested.length === 0 && r.body?.words === null, r.body);
    const session = await api("/api/session", { token: lateTok });
    ok("...holds nothing", (session.body?.assignments ?? []).length === 0, session.body?.assignments);
    const reqs = await api("/api/read/role_requests", { token: office });
    ok("...and the request waits in the office's Requests, noting the row",
       reqs.body?.rows?.some((x) => x.email === LATE && x.state === "pending" && /^from the staff register, row /.test(x.note ?? "")), reqs.body?.rows?.length);
    const list = await api(`/api/register/${HIL}?state=claimed`, { token: office });
    ok("the row reads requested, the uploader's authority lapsed",
       list.body?.rows?.some((x) => x.email === LATE && x.outcome === "requested" && x.outcome_reason === "uploader_authority_lapsed"), list.body);
  }

  group("5. The register is the office's");
  {
    const read = await api(`/api/register/${HIL}`, { token: coach });
    ok("a coach reads none of it", read.status === 200 && read.body?.rows?.length === 0, read.body);
    const dsoRead = await api(`/api/register/${HIL}`, { token: dso });
    ok("nor does the DSO", dsoRead.status === 200 && dsoRead.body?.rows?.length === 0, dsoRead.body);
    const up = await upload(coach, { rows: [{ name: "Walk X", email: "walk.x@example.invalid", role: "scorer" }], commit: true });
    ok("a coach may not upload, and is told so in words", up.status === 403 && up.body?.error === "not_permitted" && inWords(up.body?.detail), up.body);
    const anon = await api(`/api/register/${HIL}`);
    ok("no session, no register", [401, 403].includes(anon.status), anon);
    const fresh = await upload(office, { rows: [{ name: "Walk Gone", email: `walk.gone.${RUN}@example.invalid`, role: "scorer" }], commit: true });
    const rowId = fresh.body?.rows?.[0]?.rowId;
    const byCoach = await api(`/api/register/rows/${rowId}/withdraw`, { method: "POST", token: coach });
    ok("a coach may not withdraw a row", byCoach.status === 403 && inWords(byCoach.body?.detail), byCoach.body);
    const wd = await api(`/api/register/rows/${rowId}/withdraw`, { method: "POST", token: office });
    ok("the office withdraws it", wd.status === 200 && wd.body?.withdrawn === true, wd.body);
    const twice = await api(`/api/register/rows/${rowId}/withdraw`, { method: "POST", token: office });
    ok("...once", twice.status === 409 && twice.body?.error === "already_withdrawn" && inWords(twice.body?.detail), twice.body);
    await q(`update school_register set withdrawn_at = now() - interval '91 days' where id = $1`, [rowId]);
    const due = await api(`/api/register/${HIL}/redact`, { token: office });
    ok("ninety-one days on, it is due to be cleared", due.status === 200 && due.body?.rows?.some((x) => x.id === rowId), due.body);
    const cleared = await api(`/api/register/${HIL}/redact`, { method: "POST", token: office });
    ok("Clear clears it", cleared.status === 200 && cleared.body?.cleared >= 1, cleared.body);
    const row = (await q(`select name, email, role from school_register where id = $1`, [rowId]))[0];
    ok("...its name and address gone, its role kept", row?.name === "Redacted" && row?.email.startsWith("redacted+") && row?.role === "scorer", row);
    const coachClear = await api(`/api/register/${HIL}/redact`, { method: "POST", token: coach });
    ok("a coach may not clear", coachClear.status === 403, coachClear.body);
  }

  group("6. A declined parent claim, and the cooldown");
  const ASKER = `walk.asker.${RUN}@example.invalid`;
  {
    const asker = await google(`walk-asker-${RUN}`, ASKER);
    const decline = async () => {
      const r = await api("/api/requests", { method: "POST", token: asker,
                                             body: { role: "guardian", schoolId: HIL, note: "For my son Walk Kidninetythree" } });
      const d = await api(`/api/requests/${r.body?.id}/decide`, { method: "POST", token: office, body: { grant: false } });
      return d.status === 200 && d.body?.state === "declined";
    };
    ok("the office declines a parent's request", await decline());
    const list = await api("/api/read/notifications", { token: dso });
    const notice = list.body?.rows?.find((n) => n.title === "A parent claim was declined" && n.kind === "safeguarding");
    ok("the DSO is told", !!notice, list.body?.rows?.map((n) => n.title));
    const opened = await api(`/api/notifications/${notice?.id}/read`, { method: "POST", token: dso });
    const body = opened.body?.notice?.body ?? "";
    ok("...in a notice that names nobody", opened.status === 200 && /The office can tell you who asked\./.test(body)
       && !/Kidninetythree|Walk|asker/i.test(body), opened.body);
    const officeList = await api("/api/read/notifications", { token: office });
    ok("...which the office does not read", !officeList.body?.rows?.some((n) => n.id === notice?.id), officeList.status);
    ok("a second decline", await decline());
    ok("a third decline", await decline());
    const asked = await api("/api/requests", { method: "POST", token: asker, body: { role: "scorer", schoolId: HIL } });
    ok("the asker is paused, and told so in words", asked.status === 409 && asked.body?.error === "request_cooldown"
       && asked.body?.detail === "You can't send a request right now. Ask the school office.", asked.body);
    const onboard = await api("/api/onboard", { method: "POST", body: { email: ASKER, name: "Walk Asker", role: "scorer", schoolId: HIL } });
    ok("signed out, onboarding says nothing of it", onboard.status === 200 && onboard.body?.requested === true, onboard.body);
    await upload(office, { rows: [{ name: "Walk Asker", email: ASKER, role: "scorer" }], commit: true });
    const c = await claim(asker);
    ok("the register's claim says the same", c.status === 409 && c.body?.error === "request_cooldown" && inWords(c.body?.detail), c.body);
    const pause = (await api("/api/read/notifications", { token: dso })).body?.rows?.find((n) => n.title === "An account has been paused from asking");
    ok("the DSO is told of the pause", !!pause?.subject_id, pause);
    const byOffice = await api(`/api/cooldowns/${pause?.subject_id}/lift`, { method: "POST", token: office, body: { note: "Spoke to them." } });
    ok("the office may not lift it", byOffice.status === 403 && inWords(byOffice.body?.detail), byOffice.body);
    const byDso = await api(`/api/cooldowns/${pause?.subject_id}/lift`, { method: "POST", token: dso, body: { note: "Spoke to the family." } });
    ok("the DSO lifts it", byDso.status === 200 && byDso.body?.lifted === true, byDso.body);
    const after = await claim(asker);
    ok("...and the claim grants", after.status === 200 && after.body?.words === "You're in. The office listed you as Scorer.", after.body);
  }
} catch (e) {
  fail++; console.log("\n  ✗ the walk threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  rmSync(dir, { recursive: true, force: true });
  console.log("\n" + "─".repeat(52));
  console.log(`STAFF-REGISTER SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

#!/usr/bin/env node
/**
 * The audit log, over HTTP (SCRBRD-132 B2, db/79 and db/80).
 *
 * GET /api/read/audit_log is Management's "Audit log" tab, and audit_log()
 * decides everything behind it. What this walk proves, through the server
 * the app talks to:
 *
 *   1. the school office (audit.read) reads its own school's log, newest
 *      first, and a role it ended is on it: who ended it, whose, which role —
 *      and not the reason
 *   2. a child is named by initials, as actor and as subject, never whole
 *   3. no safeguarding row reaches it
 *   4. every read of it is on the record: one access_log row per call, for
 *      the office, for another school's office asking about Hilton, for a
 *      coach, and for the platform reading across schools (not two)
 *   5. another school's office reads none of Hilton's rows, even by naming
 *      Hilton; a coach, holding no audit.read, reads nothing
 *   6. a page, then the page after it by (at, key), with no row repeated; a
 *      kind filter narrows to that kind
 *   7. a malformed filter is refused in words the client can act on (400);
 *      no session, no log
 *   8. a role GRANTED is on it too (db/80): who granted it, whose, which —
 *      the same `role` kind as an ending, keyed role:<id>:granted beside the
 *      ending's role:<id>; a pupil's grant in initials; a seeded grant with
 *      no actor; a support hour listed once, as support, never as a grant;
 *      and the DSO (audit.read without the office's key) reads only his own
 *      grant, as role_assignment's own policy would let him
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-audit-log.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8979);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WHY = "Moved to another school at the end of the walk's term.";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-audit-log-secret" },
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
  method: "POST", body: { email, deviceId: "device-audit-log" } })).body?.token;
const log = (token, query = "") => api(`/api/read/audit_log${query}`, { token });

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;
const reads = async (email, school) => Number((await q(
  `select count(*) from access_log l join app_user u on u.id = l.person_id
    where l.resource = 'audit_log' and lower(u.email) = lower($1) and l.school_id is not distinct from $2::uuid`,
  [email, school]))[0].count);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const office   = await login("registrar@example.invalid");      // schooladmin, Hilton: audit.read
  const officeW  = await login("registrar.wes@example.invalid");  // schooladmin, Westville
  const coach    = await login("coach@example.invalid");          // coach, Hilton: no audit.read
  const platform = await login("platform@example.invalid");       // platformadmin, every school

  // A pupil made up for this walk, with an account, who reads his own record
  // — and a safeguarding read at Hilton, both filed as the server files them.
  const [pupil] = await q(
    `insert into player (school_id, team_code, full_name, surname, squad_no, playing_role, born)
     values ($1, 'U15A', 'Walkthrough Auditwalk Boy', 'Boy', 979, 'batter', current_date - interval '15 years')
     returning id`, [HIL]);
  const [pupilUser] = await q(
    `insert into app_user (school_id, email, name, role, player_id)
     values ($1, 'audit.walk.pupil@example.invalid', 'Walkthrough Auditwalk Boy', 'player', $2) returning id`, [HIL, pupil.id]);
  await q(`insert into access_log (school_id, person_id, resource, record_ids, record_count, fields)
           values ($1, $2, 'players', array[$3::uuid], 1, '{born}'),
                  ($1, $2, 'safeguarding_concern', array[gen_random_uuid()], 1, '{account}')`,
          [HIL, pupilUser.id, pupil.id]);

  group("The office reads its school's log, and a role it ended is on it");
  const made = await api("/api/users", { method: "POST", token: office, body: {
    email: "audit.walk.coach@example.invalid", name: "E Auditcoach", role: "coach", schoolId: HIL, teamCode: "U15A" } });
  ok("the office enrols a coach", made.status === 200 && !!made.body?.assignmentId, made.body);
  const ended = await api(`/api/assignments/${made.body?.assignmentId}/end`, { method: "POST", token: office, body: { reason: WHY } });
  ok("...and ends his role with a reason", ended.status === 200 && ended.body?.ended === true, ended.body);
  const before = await reads("registrar@example.invalid", HIL);
  const first = await log(office);
  const rows = first.body?.rows ?? [];
  ok("the office reads the audit log", first.status === 200 && rows.length > 0, first.body);
  ok("...newest first", rows.every((r, i) => i === 0 || rows[i - 1].at >= r.at), rows.map((r) => r.at));
  ok("...Hilton's rows only", rows.every((r) => r.school_id === HIL), rows.map((r) => r.school_id));
  const role = rows.find((r) => r.kind === "role" && r.subject === "E Auditcoach" && r.key === `role:${made.body?.assignmentId}`);
  ok("the ended role is on it: who, whose, which", role?.action === "Ended a role: Coach (U15A)" && role?.actor === "B Naicker", role);
  ok("...and not why", !JSON.stringify(first.body).includes("walk's term"), role);

  group("A child is named by initials");
  const own = rows.find((r) => r.kind === "access" && r.action === "Read players" && r.subjectKind === "pupil");
  ok("his read of his own record is on it, actor and subject in initials", own?.actor === "W A Boy" && own?.subject === "W A Boy", own);
  ok("...and his name is nowhere whole", !JSON.stringify(first.body).includes("Walkthrough Auditwalk"));

  group("No safeguarding row");
  ok("nothing whose resource is safeguarding's", rows.every((r) => !String(r.detail?.resource ?? "").startsWith("safeguarding")
     && !/safeguarding/i.test(r.action)), rows.filter((r) => /safeguarding/i.test(JSON.stringify(r))));

  group("Every read is on the record");
  ok("the office's read left exactly one access_log row", await reads("registrar@example.invalid", HIL) === before + 1);
  const again = await log(office, "?kinds=access&limit=200");
  ok("...and the next read shows it, as the audit log", (again.body?.rows ?? []).some((r) => r.action === "Read the audit log" && r.actor === "B Naicker"), again.body);
  const disclosed = await q(`select count(*) from access_log where resource = 'audit_log' and record_ids @> array[$1::uuid]`, [pupil.id]);
  ok("...naming the child its rows named", Number(disclosed[0].count) >= 1);
  const pBefore = await reads("platform@example.invalid", HIL);
  const plat = await log(platform, `?schoolId=${HIL}`);
  ok("the platform reads Hilton's log by naming it", plat.status === 200 && (plat.body?.rows ?? []).length > 0, plat.body);
  ok("...and leaves one row for it, not two", await reads("platform@example.invalid", HIL) === pBefore + 1);

  group("Another school's office, and a coach, read nothing of Hilton's");
  const wBefore = await reads("registrar.wes@example.invalid", HIL);
  const wes = await log(officeW, `?schoolId=${HIL}`);
  ok("Westville's office naming Hilton reads nothing", wes.status === 200 && (wes.body?.rows ?? []).length === 0, wes.body);
  ok("...and the asking is on the record", await reads("registrar.wes@example.invalid", HIL) === wBefore + 1);
  const wesOwn = await log(officeW);
  ok("...its own log has none of Hilton's rows", (wesOwn.body?.rows ?? []).every((r) => r.school_id !== HIL), wesOwn.body);
  const cBefore = await reads("coach@example.invalid", HIL);
  const co = await log(coach);
  ok("a coach reads nothing", co.status === 200 && (co.body?.rows ?? []).length === 0, co.body);
  ok("...and the asking is on the record", await reads("coach@example.invalid", HIL) === cBefore + 1);

  group("Paged, and filtered");
  const p1 = await log(office, "?limit=2");
  const last = p1.body?.rows?.[1];
  const p2 = await log(office, `?limit=3&before=${encodeURIComponent(last?.at ?? "")}&beforeKey=${encodeURIComponent(last?.key ?? "")}`);
  const k1 = (p1.body?.rows ?? []).map((r) => r.key), k2 = (p2.body?.rows ?? []).map((r) => r.key);
  ok("a page of two, then three strictly older, with no repeat",
     k1.length === 2 && k2.length === 3 && !k2.some((k) => k1.includes(k))
     && (p2.body?.rows ?? []).every((r) => r.at <= last.at), { k1, k2 });
  const onlyRoles = await log(office, "?kinds=role");
  ok("a kind filter reads that kind alone", (onlyRoles.body?.rows ?? []).length > 0
     && onlyRoles.body.rows.every((r) => r.kind === "role"), onlyRoles.body);
  const future = await log(office, `?since=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`);
  ok("a date filter after today reads nothing", future.status === 200 && (future.body?.rows ?? []).length === 0, future.body);

  group("A role granted is on it too (db/80)");
  // His player role, as a seed or a migration makes one: nobody's act.
  const [boyRole] = await q(`insert into role_assignment (person_id, role, school_id, team_code, valid_from)
                             values ($1, 'player', $2, 'U15A', current_date) returning id`, [pupilUser.id, HIL]);
  // An hour of support at Hilton: an assignment, and the support row it is.
  const sup = await api("/api/support/access", { method: "POST", token: platform,
    body: { schoolId: HIL, role: "schooladmin", reason: "audit walk: is a support hour listed once?" } });
  ok("the platform opens a support hour at Hilton", sup.status === 200 && !!sup.body?.id, sup.body);
  const [supRow] = await q(`select assignment_id from support_access where id = $1`, [sup.body?.id]);
  const roleRows = (await log(office, "?kinds=role,support&limit=200")).body?.rows ?? [];
  const granted = roleRows.find((r) => r.key === `role:${made.body?.assignmentId}:granted`);
  ok("the coach's grant is on it: who, whose, which",
     granted?.kind === "role" && granted?.action === "Granted a role: Coach (U15A)" && granted?.actor === "B Naicker"
     && granted?.subject === "E Auditcoach" && granted?.subjectKind === "person", granted);
  ok("...its detail is the role and the side, nothing else",
     JSON.stringify(granted?.detail) === JSON.stringify({ role: "coach", team: "U15A" }), granted?.detail);
  ok("...beside its ending, under the ending's own key",
     roleRows.some((r) => r.key === `role:${made.body?.assignmentId}` && r.action === "Ended a role: Coach (U15A)"));
  const boyGrant = roleRows.find((r) => r.key === `role:${boyRole.id}:granted`);
  ok("a pupil's grant names him by initials, and nobody granted it",
     boyGrant?.subject === "W A Boy" && boyGrant?.actor === null && boyGrant?.action === "Granted a role: Player (U15A)", boyGrant);
  ok("...his name nowhere whole", !JSON.stringify(roleRows).includes("Walkthrough Auditwalk"));
  ok("the support hour is one support row", roleRows.filter((r) => r.key === `support:${sup.body?.id}:began`).length === 1,
     roleRows.filter((r) => r.kind === "support").map((r) => r.key));
  ok("...and never a grant", !roleRows.some((r) => r.key.startsWith(`role:${supRow?.assignment_id}`)), supRow);
  await api(`/api/support/access/${sup.body?.id}/end`, { method: "POST", token: platform });
  const dso = await login("dso@example.invalid");                 // dso, Hilton: audit.read, not the office's key
  const dsoRows = (await log(dso, "?kinds=role&limit=200")).body?.rows ?? [];
  const dsoGrants = dsoRows.filter((r) => r.key.endsWith(":granted"));
  ok("the DSO reads his own grant and nobody else's", dsoGrants.length >= 1 && dsoGrants.every((r) => r.subject === "N Dube"),
     dsoGrants.map((r) => `${r.subject}: ${r.action}`));

  group("Refusals");
  const badKind = await log(office, "?kinds=gossip");
  ok("an unknown kind is refused", badKind.status === 400 && badKind.body?.error === "bad_param:kinds", badKind.body);
  const badSchool = await log(office, "?schoolId=hilton");
  ok("a school that is not an id is refused", badSchool.status === 400 && badSchool.body?.error === "bad_param:schoolId", badSchool.body);
  const badLimit = await log(office, "?limit=5000");
  ok("a page of five thousand is refused", badLimit.status === 400 && badLimit.body?.error === "bad_param:limit", badLimit.body);
  const nobody = await log(undefined);
  ok("no session, no log", nobody.status === 401 && !nobody.body?.rows, nobody);
} catch (e) {
  fail++;
  console.log("  ✗ the walk itself failed:", e.message);
} finally {
  server.kill();
  await pool.end();
}

if (fail && serverErr.length) console.log("\nserver stderr:\n" + serverErr.join("").slice(-2000));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

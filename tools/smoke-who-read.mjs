#!/usr/bin/env node
/**
 * "Who read my child's record", rehearsed over HTTP (pilot item 7;
 * docs/pilot/WHO_READ_RUNBOOK.md).
 *
 * A parent asks which staff read their child's record, and when. The office
 * must answer in five minutes. This walk does what the runbook says, on the
 * seed data, through the server the app talks to:
 *
 *   1. a staff member reads the child's restricted record (a medic reads his
 *      injuries), so there is something to find
 *   2. the office (audit.read) asks about ONE child: GET /api/read/access_log
 *      ?playerId=<child>, and gets the list of reads: who, what, which
 *      fields, when, and how (own school, platform, support)
 *   3. the list is that child's and nobody else's, newest first, the reader
 *      named; the medic's read of his injuries is on it
 *   4. a safeguarding read naming the child never shows (db/57), and a read
 *      of another child is not on his list
 *   5. a coach, holding no audit.read, is refused: no rows
 *   6. another school's office sees none of it
 *   7. the office's own question is on the record, naming the child
 *   8. the whole rehearsal takes seconds, far inside five minutes
 *   9. the owner's key reading the child's file (his passport, his name, the
 *      fixture's availability and readiness) is on the same list: a row for
 *      each, naming him, under Hilton, as the key, marked platform-wide
 *      (Kameel, 5 Nov 2026, the guardian's terms Q6; db/139)
 *  10. off the read path too (PLATFORM_CONTROLS slice 6a, db/167): the key
 *      opening his public name and his guardians' answers, the team sheet,
 *      his own account and a notice about him is on the same list, and every
 *      read the key made reads "SCRBRD platform", never a person's name; a
 *      school reader's same reads write nothing new
 *  11. a read whose row cannot be written is refused, 503 not_logged, for the
 *      key alone; the office reading the same page is answered (review S1)
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-who-read.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8983);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const P_INJURED = "aaaaaaaa-0000-0000-0000-000000000005";
const P_OTHER = "aaaaaaaa-0000-0000-0000-000000000001";
const MATCH = "77777777-0000-0000-0000-000000000001";        // Hilton's, P_INJURED's side
const FIVE_MINUTES_MS = 5 * 60 * 1000;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-who-read-secret" },
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
  method: "POST", body: { email, deviceId: "device-who-read" } })).body?.token;
const aboutChild = (token, id) => api(`/api/read/access_log?playerId=${id}`, { token });

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const medic   = await login("medical@example.invalid");        // reads injuries: a restricted read
  const office  = await login("registrar@example.invalid");      // schooladmin, Hilton: audit.read
  const officeW = await login("registrar.wes@example.invalid");  // schooladmin, Westville
  const coach   = await login("coach@example.invalid");          // coach, Hilton: no audit.read
  const owner   = await login("owner@example.invalid");          // superadmin: the owner's key

  const started = Date.now();
  await q(`delete from access_log`);

  group("Something to find: a staff member reads the child's restricted record");
  const injuries = await api("/api/read/injuries", { token: medic });
  ok("the medic reads the injury record", injuries.status === 200 && (injuries.body?.rows ?? []).length > 0, injuries.status);
  const [medicRow] = await q(`select id from app_user where lower(email) = 'medical@example.invalid'`);
  // A safeguarding read that names the child, and a read of another child,
  // both filed as the server files them.
  await q(`insert into access_log (school_id, person_id, resource, record_ids, record_count, fields)
           values ($1, $2, 'safeguarding_concern', array[$3::uuid], 1, '{account}'),
                  ($1, $2, 'players', array[$4::uuid], 1, '{born}')`, [HIL, medicRow.id, P_INJURED, P_OTHER]);

  group("The owner's key reads his file");
  const OWNER_READS = [`passport?playerId=${P_INJURED}`, `passport_name?playerId=${P_INJURED}`,
                       `availability?matchId=${MATCH}`, `readiness?matchId=${MATCH}`];
  for (const path of OWNER_READS) {
    const r = await api(`/api/read/${path}`, { token: owner });
    ok(`the key reads ${path.split("?")[0]}`, r.status === 200 && (r.body?.rows ?? []).length > 0, r.status);
  }
  const [ownerRow] = await q(`select id from app_user where lower(email) = 'owner@example.invalid'`);

  group("The owner's key opens his record off the read path (slice 6a, db/167)");
  const PUPIL = "88888888-0000-0000-0000-000000000009";   // his own account (self-access to him)
  const OFF_PATH = [[`/api/players/${P_INJURED}/public-name`, "public_name"], [`/api/matches/${MATCH}/sheet`, "fixture_sheet"],
                    [`/api/auth/users/${PUPIL}/preview`, "account_preview"], ["/api/read/notifications", "notifications"]];
  for (const [path] of OFF_PATH) {
    const r = await api(path, { token: owner });
    ok(`the key opens ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, r.status === 200 && r.body != null, r.status);
  }
  // A school reader's same reads off the read path are not logged (unchanged).
  const [{ n: before }] = await q(`select count(*)::int n from access_log`);
  const offOwn = await api(`/api/players/${P_INJURED}/public-name`, { token: office });
  const sheetOwn = await api(`/api/matches/${MATCH}/sheet`, { token: office });
  const [{ n: after }] = await q(`select count(*)::int n from access_log`);
  ok("the office's own reads of the same pages write nothing", offOwn.status === 200 && sheetOwn.status === 200 && after === before,
     { before, after, a: offOwn.status, b: sheetOwn.status });
  const coachSheet = await api(`/api/matches/${MATCH}/sheet`, { token: coach });
  ok("...and a coach reading the sheet is answered, never refused for the log", coachSheet.status === 200, coachSheet);
  // The key's rows, as the database holds them: the answer below must carry
  // each of them with no person's id or name on it.
  const keyRowIds = new Set((await q(`select id from access_log where person_id = $1`, [ownerRow.id])).map((r) => r.id));
  const isKey = (/** @type {any} */ r) => keyRowIds.has(r.id);

  group("The office asks about ONE child");
  const ans = await aboutChild(office, P_INJURED);
  const rows = ans.body?.rows ?? [];
  ok("the office gets an answer", ans.status === 200 && rows.length > 0, ans.body);
  ok("...every read on it names this child", rows.every((r) => (r.record_ids ?? []).includes(P_INJURED)), rows.map((r) => r.record_ids));
  ok("...each names the reader, or says it was the platform",
     rows.every((r) => r.person_name || r.platform_wide === true), rows.map((r) => r.person_name));
  ok("...with the time, the resource and how the reader arrived",
     rows.every((r) => r.occurred_at && r.resource && typeof r.platform_wide === "boolean"), rows[0]);
  ok("...newest first", rows.every((r, i) => i === 0 || rows[i - 1].occurred_at >= r.occurred_at));
  ok("...Hilton's rows only", rows.every((r) => r.school_id === HIL));
  const mine = rows.find((r) => r.resource === "injuries" && r.person_id === medicRow.id);
  ok("the medic's read of his injuries is on the list", !!mine, rows.map((r) => r.resource));
  ok("...with the fields that came back", Array.isArray(mine?.fields), mine);

  for (const path of OWNER_READS) {
    const res = path.split("?")[0];
    const theirs = rows.filter((r) => r.resource === res && isKey(r));
    ok(`the key's read of ${res} is on his list, as the key, platform-wide`,
       theirs.length === 1 && theirs[0].platform_wide === true && theirs[0].support_access_id == null
         && theirs[0].school_id === HIL,
       theirs);
  }
  ok("...and the medic's read is still logged as a school reader's", mine?.platform_wide === false, mine);
  for (const [, res] of OFF_PATH) {
    const theirs = rows.filter((r) => r.resource === res && isKey(r));
    ok(`the key's ${res} read is on his list at Hilton, platform-wide`,
       theirs.length === 1 && theirs[0].platform_wide === true && theirs[0].school_id === HIL, theirs);
  }
  const theKey = rows.filter(isKey);
  ok(`every read the key made (${theKey.length}) reads "SCRBRD platform", the platform as the reader, with no person's id`,
     theKey.length >= OWNER_READS.length + OFF_PATH.length
       && theKey.every((r) => r.person_name === "SCRBRD platform" && r.reader_role === "SCRBRD platform" && r.person_id == null),
     theKey.map((r) => [r.person_name, r.person_id]));
  const [ownerName] = await q(`select name, email from app_user where id = $1`, [ownerRow.id]);
  ok("...and his name, email and id are nowhere in the answer",
     !JSON.stringify(rows).includes(ownerName.name) && !JSON.stringify(rows).toLowerCase().includes(ownerName.email.toLowerCase())
       && !JSON.stringify(rows).includes(ownerRow.id));
  ok("...while the medic is named as herself, not the platform", mine?.person_name && mine.person_name !== "SCRBRD platform" && mine.reader_role == null, mine);

  group("What it never shows");
  ok("no safeguarding read, though one names him", rows.every((r) => !String(r.resource).startsWith("safeguarding")), rows.map((r) => r.resource));
  ok("another child's read is not on his list", rows.every((r) => !(r.record_ids ?? []).includes(P_OTHER) || (r.record_ids ?? []).includes(P_INJURED)));
  ok("...and his own list holds no row for the other child alone", !rows.some((r) => (r.record_ids ?? []).length === 1 && r.record_ids[0] === P_OTHER));

  group("Who may ask");
  const refused = await aboutChild(coach, P_INJURED);
  ok("a coach, with no audit.read, gets no rows", (refused.body?.rows ?? []).length === 0, { status: refused.status, body: refused.body });
  const noSession = await aboutChild(undefined, P_INJURED);
  ok("no session, no answer", noSession.status === 401 || noSession.status === 403, noSession.status);
  const wes = await aboutChild(officeW, P_INJURED);
  ok("another school's office sees none of Hilton's reads", (wes.body?.rows ?? []).every((r) => r.school_id !== HIL), wes.body);

  group("The question is itself on the record");
  const asked = await q(`select count(*)::int n from access_log l join app_user u on u.id = l.person_id
                          where l.resource = 'access_log' and lower(u.email) = 'registrar@example.invalid'
                            and l.record_ids @> array[$1::uuid]`, [P_INJURED]);
  ok("the office's question names the child in the log", asked[0].n >= 1, asked);

  group("A read the record cannot take is not sent (review S1, db/167's strict writer)");
  // Rows of the key's public-name read made unwritable for a moment, as the
  // owner, then put back: the key is refused with nothing of the child in the
  // answer, and the office reading the same page is answered as before.
  await q(`create or replace function _who_read_refuse() returns trigger language plpgsql as
           $f$ begin raise exception 'who-read: this row cannot be written'; end $f$`);
  await q(`create trigger access_log_who_read_refuse before insert on access_log
           for each row when (new.resource = 'public_name') execute function _who_read_refuse()`);
  try {
    const refused = await api(`/api/players/${P_INJURED}/public-name`, { token: owner });
    ok("the key's read whose row cannot be written is refused: 503 not_logged, and nothing of the child",
       refused.status === 503 && refused.body?.error === "not_logged" && !JSON.stringify(refused.body).includes(P_INJURED), refused);
    const still = await api(`/api/players/${P_INJURED}/public-name`, { token: office });
    ok("...while the office, a school reader, is answered", still.status === 200 && still.body?.playerId === P_INJURED, still.status);
  } finally {
    await q(`drop trigger if exists access_log_who_read_refuse on access_log`);
    await q(`drop function if exists _who_read_refuse()`);
  }
  const again = await api(`/api/players/${P_INJURED}/public-name`, { token: owner });
  ok("...and with the row writable again the key is answered", again.status === 200, again.status);

  group("Five minutes");
  const took = Date.now() - started;
  ok(`the rehearsal took ${(took / 1000).toFixed(1)} s, inside five minutes`, took < FIVE_MINUTES_MS);
} catch (e) {
  fail++;
  console.log("  ✗ the walk crashed —", e?.stack ?? e);
} finally {
  server.kill();
  await pool.end().catch(() => {});
  if (fail && serverErr.length) console.log("\nserver stderr:\n" + serverErr.join("").slice(-1500));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

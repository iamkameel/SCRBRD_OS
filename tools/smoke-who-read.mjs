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

  group("The office asks about ONE child");
  const ans = await aboutChild(office, P_INJURED);
  const rows = ans.body?.rows ?? [];
  ok("the office gets an answer", ans.status === 200 && rows.length > 0, ans.body);
  ok("...every read on it names this child", rows.every((r) => (r.record_ids ?? []).includes(P_INJURED)), rows.map((r) => r.record_ids));
  ok("...each names the reader", rows.every((r) => r.person_name), rows.map((r) => r.person_name));
  ok("...with the time, the resource and how the reader arrived",
     rows.every((r) => r.occurred_at && r.resource && typeof r.platform_wide === "boolean"), rows[0]);
  ok("...newest first", rows.every((r, i) => i === 0 || rows[i - 1].occurred_at >= r.occurred_at));
  ok("...Hilton's rows only", rows.every((r) => r.school_id === HIL));
  const mine = rows.find((r) => r.resource === "injuries" && r.person_id === medicRow.id);
  ok("the medic's read of his injuries is on the list", !!mine, rows.map((r) => r.resource));
  ok("...with the fields that came back", Array.isArray(mine?.fields), mine);

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

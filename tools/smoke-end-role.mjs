#!/usr/bin/env node
/**
 * Ending a role, over HTTP (SCRBRD-132 C1, db/77).
 *
 * A role could be added from a screen (POST /api/users) and only ended by
 * SQL. POST /api/assignments/:id/end { reason } is the other half, and
 * role_assignment_end() decides everything behind it. What this walk proves,
 * through the server the app talks to:
 *
 *   1. the office enrols a coach, ends his role with a reason, and he holds
 *      nothing on his very next request — his session lists no role and the
 *      roster read is empty
 *   2. who may not grant a role may not end it, and each refusal comes back
 *      with words: the coach himself, the office for a medical appointment,
 *      another school's office
 *   3. the reason is required, in at least ten characters
 *   4. the ended row stays on the office's appointments read, marked ended,
 *      with who ended it; the reason is on the audit row and nowhere the
 *      coach can read; the coach is told, without the reason
 *   5. the guardian link's rule: a minor's last verified parent is not ended
 *   6. nobody ends their own last key, and nobody ends the owner's key
 *   7. no session, no end; a malformed id is not an assignment
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-end-role.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8977);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // a minor; parent@ is his one verified parent
const WHY = "Moved to coach at another school from next term.";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-end-role-secret" },
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
  method: "POST", body: { email, deviceId: "device-end-role" } })).body?.token;
const end = (token, id, reason) => api(`/api/assignments/${id}/end`, { method: "POST", token, body: { reason } });
/** A refusal says what it is, in a sentence, and is not a raw code. */
const inWords = (r) => typeof r.body?.detail === "string" && /\s/.test(r.body.detail) && !/_/.test(r.body.detail);

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

  const registrar = await login("registrar@example.invalid");      // schooladmin, Hilton
  const regWes    = await login("registrar.wes@example.invalid");  // schooladmin, Westville
  const platform  = await login("platform@example.invalid");       // platformadmin, no school
  const owner     = await login("owner@example.invalid");          // the owner's key

  group("Granted, then ended, then holding nothing");
  const made = await api("/api/users", { method: "POST", token: registrar, body: {
    email: "end.walk.coach@example.invalid", name: "E Walkcoach", role: "coach", schoolId: HIL, teamCode: "U15A" } });
  ok("the office enrols a coach for the U15A", made.status === 200 && !!made.body?.assignmentId, made.body);
  const A = made.body.assignmentId, U = made.body.userId;
  const coach = await login("end.walk.coach@example.invalid");
  const before = await api("/api/session", { token: coach });
  ok("...and his session lists the role", (before.body?.assignments ?? []).some((a) => a.id === A), before.body);
  const rosterBefore = await api("/api/read/players", { token: coach });
  ok("...and he reads the roster", rosterBefore.status === 200 && (rosterBefore.body?.rows ?? []).length > 0, rosterBefore.status);

  group("Who may not grant it may not end it, and is told so in words");
  const self = await end(coach, A, WHY);
  ok("the coach cannot end his own appointment", self.status === 403 && self.body?.error === "not_permitted", self.body);
  ok("...and is told why, in words", inWords(self), self.body);
  const medic = await assignmentOf("medical@example.invalid", "medical");
  const med = await end(registrar, medic, WHY);
  ok("the office cannot end a medical appointment it could not have made",
     !!medic && med.status === 403 && med.body?.error === "not_permitted" && inWords(med), med.body);
  const wes = await end(regWes, A, WHY);
  ok("another school's office cannot end a Hilton coach", wes.status === 403 && wes.body?.error === "not_permitted", wes.body);

  group("The reason is required");
  const short = await end(registrar, A, "left");
  ok("four letters are refused", short.status === 422 && short.body?.error === "reason_required" && inWords(short), short.body);
  const none = await api(`/api/assignments/${A}/end`, { method: "POST", token: registrar, body: {} });
  ok("...and no reason at all", none.status === 422 && none.body?.error === "reason_required", none.body);

  group("Ended");
  const done = await end(registrar, A, WHY);
  ok("the office ends it", done.status === 200 && done.body?.ended === true, done.body);
  const after = await api("/api/session", { token: coach });
  ok("his very next request lists no role", after.status === 200 && (after.body?.assignments ?? []).length === 0, after.body);
  const rosterAfter = await api("/api/read/players", { token: coach });
  ok("...and the roster read gives him nobody", (rosterAfter.body?.rows ?? []).length === 0, rosterAfter.body);
  const again = await end(registrar, A, WHY);
  ok("a second end is refused: it has already ended", again.status === 409 && again.body?.error === "already_ended", again.body);

  group("On the record, and told");
  const list = await api(`/api/read/assignments?personId=${U}`, { token: registrar });
  const row = (list.body?.rows ?? []).find((r) => r.id === A);
  ok("the ended row stays on the office's appointments read", !!row, list.body);
  ok("...marked ended, by the office, when", row?.active === false && row?.revoked_by_name === "B Naicker" && !!row?.revoked_at, row);
  const audit = await q(`select reason, ended_by, notice_id from role_assignment_ending where assignment_id = $1`, [A]);
  ok("the audit row holds the reason", audit.length === 1 && audit[0].reason === WHY && !!audit[0].notice_id, audit);
  const mine = await api(`/api/read/assignments?personId=${U}`, { token: coach });
  ok("...and his own read of the appointment does not carry it",
     (mine.body?.rows ?? []).length === 1 && !JSON.stringify(mine.body).includes("another school"), mine.body);
  const notes = await api("/api/read/notifications", { token: coach });
  const notice = (notes.body?.rows ?? []).find((n) => n.title === "A role of yours has ended");
  ok("he is told, with no role left to read notices through", !!notice, notes.body);
  ok("...which role, where", /Coach role \(U15A\) at Hilton College/.test(notice?.body ?? ""), notice?.body);
  ok("...and not why", !JSON.stringify(notes.body).includes("another school"), notice?.body);
  const regNotes = await api("/api/read/notifications", { token: registrar });
  ok("the notice is his: the office does not read it",
     !(regNotes.body?.rows ?? []).some((n) => n.id === notice?.id), regNotes.status);

  group("A guardian role keeps the guardian link's rules");
  const parentA = await assignmentOf("parent@example.invalid", "guardian");
  const parent = await end(registrar, parentA, WHY);
  ok("the last verified parent of a boy under eighteen is not ended",
     parent.status === 409 && parent.body?.error === "last_verified_link" && inWords(parent), parent.body);
  const stillLive = await q(`select live_links from player_guardian_status where player_id = $1`, [PILLAY]);
  ok("...and his link is as it was", stillLive[0]?.live_links === 1, stillLive);
  const plat = await end(platform, parentA, WHY);
  ok("the platform, which manages no guardian links, is refused", plat.status === 403 && plat.body?.error === "not_permitted", plat.body);

  group("Nobody locks themselves out, and the owner's key is not ended here");
  const platA = await assignmentOf("platform@example.invalid", "platformadmin");
  const lone = await end(platform, platA, WHY);
  ok("the platform administrator cannot end his only key", lone.status === 409 && lone.body?.error === "last_admin" && inWords(lone), lone.body);
  const ownerA = (await q(`select a.id from role_assignment a join app_user u on u.id = a.person_id
                           where u.email = 'owner@example.invalid' and a.role = 'superadmin' and a.school_id is null`))[0]?.id;
  const key = await end(owner, ownerA, WHY);
  ok("the owner's key is not ended, even by itself", key.status === 403 && key.body?.error === "owners_key" && inWords(key), key.body);
  const byPlat = await end(platform, ownerA, WHY);
  ok("...nor by the platform", byPlat.status === 403, byPlat.body);

  group("No session, no end");
  const anon = await end(undefined, A, WHY);
  ok("an unauthenticated request is refused", [401, 403].includes(anon.status), anon);
  const junk = await end(registrar, "not-a-uuid", WHY);
  ok("a malformed id is not an assignment", junk.status === 404 && junk.body?.error === "no_such_assignment", junk.body);
  const ghost = await end(registrar, "00000000-0000-4000-8000-000000000077", WHY);
  ok("...nor is one that does not exist", ghost.status === 404 && inWords(ghost), ghost.body);
} catch (e) {
  fail++; console.log("\n  ✗ the walk threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`END-ROLE SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

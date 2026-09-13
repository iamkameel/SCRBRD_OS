#!/usr/bin/env node
/**
 * Nobody assigns themselves anything.
 *
 *   1. A STRANGER ONBOARDS INTO NOTHING: an account, no assignments, one
 *      pending request. Signing in shows the request and nothing else.
 *   2. A REQUEST IS READ BY ITS OWNER AND BY WHOEVER COULD ANSWER IT.
 *   3. ANSWERING NEEDS BOTH: user.role.assign at the school AND being a
 *      granter of that role. The office grants a coach; it cannot grant a
 *      principal; a coach cannot grant anybody.
 *   4. A GRANT IS AN ASSIGNMENT, stamped from the session; a pupil gets his
 *      self-access pair and his roster link; a guardian's link is verified by
 *      the decider and consent stays the family's.
 *   5. ASKING TWICE IS ONE REQUEST; withdrawing is the requester's; a role
 *      nobody may grant cannot be asked for.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-requests.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8870;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-requests-secret" },
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
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-requests" } })).body?.token;
const requests = async (tok) => (await api("/api/read/role_requests", { token: tok })).body?.rows ?? [];
const onboard = (body) => api("/api/onboard", { method: "POST", body });
const ask = (tok, body) => api("/api/requests", { method: "POST", token: tok, body });
const decide = (id, tok, body) => api(`/api/requests/${id}/decide`, { method: "POST", token: tok, body });
const session = async (tok) => (await api("/api/session", { token: tok })).body;

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const registrar = await login("registrar@example.invalid");   // schooladmin: assigns, grants coach/player/guardian…
  const principal = await login("principal@example.invalid");   // grants directorofsport, schooladmin…
  const coach     = await login("coach@example.invalid");
  const wesAdmin  = await login("registrar.wes@example.invalid");
  const idOf = async (email) => (await q(`select id from app_user where lower(email) = $1`, [email]))[0]?.id;

  group("A stranger onboards into nothing");
  {
    ok("the schools are listed by name, to anyone", ((await api("/api/schools")).body?.rows ?? []).some((s) => s.name === "Hilton College"));
    const r = await onboard({ email: "New.Coach@example.invalid", name: "L Mthethwa", role: "coach", schoolId: HIL, teamCode: "U15A", note: "Joining in January." });
    ok("a stranger asks to coach the U15A", r.status === 200 && r.body?.requested === true);
    const uid = await idOf("new.coach@example.invalid");
    ok("...and has an account", !!uid);
    ok("...with no assignments", (await q(`select count(*)::int c from role_assignment where person_id = $1`, [uid]))[0].c === 0);
    const tok = await login("new.coach@example.invalid");
    ok("...that can sign in", !!tok);
    const s = await session(tok);
    ok("...to a session with nothing in it", Array.isArray(s?.assignments) && s.assignments.length === 0);
    const mine = await requests(tok);
    ok("...and sees their own request, pending", mine.length === 1 && mine[0].state === "pending" && mine[0].mine === true && mine[0].role === "coach" && mine[0].team_code === "U15A");
    ok("...and cannot decide it", (await decide(mine[0].id, tok, { grant: true })).status === 403);
    ok("...and reads no roster", ((await api("/api/read/players", { token: tok })).body?.rows ?? []).length === 0);
    ok("asking twice is one request", (await onboard({ email: "new.coach@example.invalid", name: "L Mthethwa", role: "coach", schoolId: HIL, teamCode: "U15A" })).status === 200
       && (await q(`select count(*)::int c from role_request where person_id = $1`, [uid]))[0].c === 1);
    ok("a known email gets a request, not a second account", (await onboard({ email: "coach@example.invalid", name: "P Hendricks", role: "scorer", schoolId: HIL })).status === 200
       && (await q(`select count(*)::int c from app_user where email = 'coach@example.invalid'`))[0].c === 1);
    ok("a bad email is refused", (await onboard({ email: "not an email", name: "X Y", role: "coach", schoolId: HIL })).status === 422);
    ok("a role nobody may grant cannot be asked for", (await onboard({ email: "who@example.invalid", name: "X Y", role: "systemarchitect", schoolId: HIL })).status === 422);
    ok("...nor a school that does not exist", (await onboard({ email: "who@example.invalid", name: "X Y", role: "coach", schoolId: "00000000-0000-0000-0000-00000000dead" })).status === 404);
  }

  group("A request is read by its owner and by whoever could answer it");
  {
    const reg = await requests(registrar);
    ok("the office reads the pending requests at its school", reg.some((r) => r.email === "new.coach@example.invalid" && r.decidable === true));
    ok("...the coach's request too, which it may not grant", reg.some((r) => r.email === "coach@example.invalid" && r.role === "scorer"));
    ok("a coach reads only his own", (await requests(coach)).every((r) => r.mine === true && r.email === "coach@example.invalid"));
    ok("another school's office reads none", (await requests(wesAdmin)).length === 0);
    const other = await onboard({ email: "head.wannabe@example.invalid", name: "P Ambitious", role: "directorofsport", schoolId: HIL });
    ok("a request for director of sport is made", other.status === 200);
    const reqs = await requests(principal);
    ok("...the principal could answer it", reqs.some((r) => r.role === "directorofsport" && r.decidable === true));
    ok("...the office does not see it at all: reading follows granting", !(await requests(registrar)).some((r) => r.role === "directorofsport"));
  }

  group("Answering needs both the capability and the granter");
  {
    const id = (await requests(registrar)).find((r) => r.email === "new.coach@example.invalid").id;
    ok("a coach cannot grant a coach", (await decide(id, coach, { grant: true })).status === 403);
    ok("another school's office cannot", (await decide(id, wesAdmin, { grant: true })).status === 403);
    const dos = (await requests(principal)).find((r) => r.role === "directorofsport").id;
    ok("the office cannot grant a director of sport", (await decide(dos, registrar, { grant: true })).status === 403);
    ok("...the principal declines him, with a reason", (await decide(dos, principal, { grant: false, note: "We have one." })).status === 200
       && (await q(`select state, decided_note, decided_by from role_request where id = $1`, [dos]))[0].state === "declined");
    ok("...and a decided request is not decided again", (await decide(dos, principal, { grant: true })).status === 422);
    // A coach is a coach of a side. This request named the U15A; one that
    // names none is granted only by naming one.
    await onboard({ email: "sideless@example.invalid", name: "R Sideless", role: "coach", schoolId: HIL });
    const sideless = (await requests(registrar)).find((r) => r.email === "sideless@example.invalid").id;
    ok("a coach request with no side is not granted as a coach of everything", (await decide(sideless, registrar, { grant: true })).body?.error === "team_required");
    ok("...and is granted once the office names the side", (await decide(sideless, registrar, { grant: true, teamCode: "2XI" })).status === 200
       && (await q(`select team_code from role_assignment where person_id = (select id from app_user where email = 'sideless@example.invalid')`))[0].team_code === "2XI");
    const g = await decide(id, registrar, { grant: true, note: "Welcome." });
    ok("the office grants the coach", g.status === 200 && g.body?.assignmentId);
    const a = (await q(`select role, school_id, team_code, created_by, active from role_assignment where id = $1`, [g.body.assignmentId]))[0];
    ok("...an assignment exists, as asked", a.role === "coach" && a.school_id === HIL && a.team_code === "U15A" && a.active);
    ok("...stamped from the session, not the request", a.created_by === await idOf("registrar@example.invalid"));
    ok("...and the request says who and when", (await q(`select decided_by, assignment_id from role_request where id = $1`, [id]))[0].assignment_id === g.body.assignmentId);
    const tok = await login("new.coach@example.invalid");
    ok("the new coach now has a session with a side in it", (await session(tok)).assignments.some((x) => x.role === "coach" && x.team === "U15A"));
    ok("...and cannot grant himself anything more", (await ask(tok, { role: "schooladmin", schoolId: HIL })).status === 200
       && (await decide((await requests(tok)).find((r) => r.state === "pending").id, tok, { grant: true })).status === 403);
  }

  group("A pupil gets both; a guardian's link is verified but not consented");
  {
    await onboard({ email: "boy@example.invalid", name: "T Bekker", role: "player", schoolId: HIL, teamCode: "1XI" });
    const boyTok = await login("boy@example.invalid");
    const req = (await requests(boyTok))[0];
    ok("a pupil's request without a roster match cannot be granted as nobody", (await decide(req.id, registrar, { grant: true, playerId: "aaaaaaaa-0000-0000-0000-00000000dead" })).status === 422);
    const g = await decide(req.id, registrar, { grant: true, playerId: "aaaaaaaa-0000-0000-0000-000000000002" });   // T Bekker's row
    ok("the office matches him to his roster row and grants", g.status === 200);
    const uid = await idOf("boy@example.invalid");
    ok("...he is linked to his row", (await q(`select player_id from app_user where id = $1`, [uid]))[0].player_id === "aaaaaaaa-0000-0000-0000-000000000002");
    const roles = (await q(`select role from role_assignment where person_id = $1 order by role`, [uid])).map((r) => r.role);
    ok("...and holds both the team role and his own record", roles.join() === "player,selfaccess");
    ok("...with himself as the subject", (await q(`select relationship, verification_state, consent_state from assignment_subject s join role_assignment a on a.id = s.assignment_id where a.person_id = $1 and a.role = 'selfaccess'`, [uid]))[0]?.relationship === "self");
    const own = (await api("/api/read/skills", { token: await login("boy@example.invalid") })).body?.rows ?? [];
    ok("...so he reads his own ratings, and only his", own.every((r) => r.player_id === "aaaaaaaa-0000-0000-0000-000000000002"));

    await onboard({ email: "mum@example.invalid", name: "S Pillay", role: "guardian", schoolId: HIL });
    const mumTok = await login("mum@example.invalid");
    const mreq = (await requests(mumTok))[0];
    ok("a guardian's request cannot be granted without naming the child", (await decide(mreq.id, registrar, { grant: true })).status === 422);
    ok("...nor with a child from another school", (await decide(mreq.id, registrar, { grant: true, playerId: "bbbbbbbb-0000-0000-0000-000000000001" })).status === 422);
    ok("...and is granted naming him", (await decide(mreq.id, registrar, { grant: true, playerId: PILLAY })).status === 200);
    const link = (await q(`select s.relationship, s.verification_state, s.verified_by, s.consent_state from assignment_subject s join role_assignment a on a.id = s.assignment_id where a.person_id = $1`, [await idOf("mum@example.invalid")]))[0];
    ok("...verified by the office, consent still the family's to give", link.relationship === "parent" && link.verification_state === "verified"
       && link.verified_by === await idOf("registrar@example.invalid") && link.consent_state === "pending");
  }

  group("Withdrawing is the requester's");
  {
    const tok = await login("new.coach@example.invalid");
    const pending = (await requests(tok)).find((r) => r.state === "pending");
    ok("the office cannot withdraw it for him", (await api(`/api/requests/${pending.id}/withdraw`, { method: "POST", token: registrar })).body?.withdrawn === 0);
    ok("he withdraws it himself", (await api(`/api/requests/${pending.id}/withdraw`, { method: "POST", token: tok })).body?.withdrawn === 1);
    ok("...and it is not decided after that", (await decide(pending.id, registrar, { grant: true })).status === 422);
    ok("a withdrawn request is not resurrected", !(await q(`set local role scrbrd_app; update role_request set state = 'pending' where id = $1`, [pending.id]).then(() => true).catch(() => false)));
  }

  ok("the server logged no errors", serverErr.join("").trim() === "");
  if (serverErr.length) console.log(serverErr.join("").slice(0, 600));
} catch (e) {
  fail++;
  console.log("  ✗ threw:", e.message);
} finally {
  server.kill();
  await pool.end();
}
console.log(`\n${"─".repeat(52)}\nREQUESTS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

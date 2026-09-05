#!/usr/bin/env node
/**
 * Signing in, without an email in sight.
 *
 * Until this walk existed there was NO WAY INTO A DEPLOYED SCRBRD. The redeem
 * path was written, correct and unit-tested, and could not run: `login_code`
 * lived as SQL inside a comment in auth-db.mjs and was never created. The only
 * working sign-in was the development route, which refuses to run outside
 * development. A production instance had a front door with no handle.
 *
 * SCRBRD sends no email and no SMS, so a code is ISSUED BY THE SCHOOL OFFICE to
 * somebody they can already identify and handed over the way a school already
 * hands things over. That makes the authorisation on issuing the whole of the
 * security, which is what most of this walk is about:
 *
 *   only somebody with user.invite AT THAT SCHOOL may issue one
 *   nobody issues one to themselves
 *   a code is single-use, and issuing a second spends the first
 *   the code never appears in the database, only its hash
 *   nobody signed in can read the codes, whatever they hold
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-login.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8806;
const BASE = `http://127.0.0.1:${PORT}`;
const DB  = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const APP = process.env.APP_DATABASE_URL || "postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd";
const U_PARENT = "88888888-0000-0000-0000-000000000005";
const U_REG    = "88888888-0000-0000-0000-00000000000c";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-login-secret" },
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
const devLogin = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-login" } })).body?.token;
const invite = (token, email) => api("/api/auth/invite", { method: "POST", token, body: { email } });
const redeem = (email, code, deviceId = "phone-1") =>
  api("/api/auth/redeem", { method: "POST", body: { email, code, deviceId } });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const registrar = await devLogin("registrar@example.invalid");  // schooladmin, user.invite
  const coach     = await devLogin("coach@example.invalid");      // no user.invite
  const head      = await devLogin("sarah@example.invalid");      // directorofsport, user.invite
  const wesReg    = await devLogin("registrar.wes@example.invalid");

  group("The office issues a code");
  const issued = await invite(registrar, "parent@example.invalid");
  ok("a school administrator may issue one", issued.status === 200 && !!issued.body?.code);
  ok("...and it comes back once, to them", typeof issued.body.code === "string" && issued.body.code.length >= 24);
  ok("...with an expiry the office can quote", !!issued.body.expiresAt);
  // Days, not minutes: a code on an enrolment letter is set up that evening.
  const ttlHours = (new Date(issued.body.expiresAt) - Date.now()) / 3600000;
  ok("...that outlives an emailed link", ttlHours > 24);

  group("The code itself is never stored");
  const stored = await q(`select * from login_code where user_id = $1 and used_at is null`, [U_PARENT]);
  ok("there is exactly one live code on record", stored.length === 1);
  ok("...and the raw code is not in it",
     !JSON.stringify(stored[0]).includes(issued.body.code));
  ok("...only a hash of it", typeof stored[0].code_hash === "string" && stored[0].code_hash.length === 64);
  ok("...and who issued it", stored[0].issued_by === U_REG);

  group("Issuing is the whole of the security, so it is authorised");
  ok("a coach may not issue a code", (await invite(coach, "parent@example.invalid")).status >= 400);
  ok("...and is told nothing about the account",
     (await invite(coach, "parent@example.invalid")).body?.error === "not_permitted");
  ok("an unknown address answers identically, so it cannot be used to enumerate",
     (await invite(registrar, "nobody@example.invalid")).body?.error === "not_permitted");
  ok("another school's office may not issue for this one",
     (await invite(wesReg, "parent@example.invalid")).body?.error === "not_permitted");
  // A code issued to yourself is a way to move a live session to another device
  // with no second person involved.
  ok("nobody issues a code to themselves",
     (await invite(registrar, "registrar@example.invalid")).body?.error === "cannot_issue_to_yourself");

  group("Redeeming it is a login");
  const bad = await redeem("parent@example.invalid", "not-the-code");
  ok("a wrong code is refused", bad.status >= 400 && !bad.body?.token);
  ok("...without saying which part was wrong", bad.body?.error === "invalid_or_expired_code");
  ok("the right code with the wrong address is refused",
     (await redeem("coach@example.invalid", issued.body.code)).body?.error === "invalid_or_expired_code");
  ok("redeeming with no device is refused",
     (await api("/api/auth/redeem", { method: "POST",
        body: { email: "parent@example.invalid", code: issued.body.code } })).body?.error === "missing_device");

  const got = await redeem("parent@example.invalid", issued.body.code);
  ok("the right code issues a token", got.status === 200 && !!got.body?.token);
  const session = await api("/api/session", { token: got.body.token });
  ok("...and the token is a working session", session.status === 200);
  ok("...as the right person", session.body?.user?.id === U_PARENT);
  // The token is what every policy in the schema resolves an identity from, so
  // a login that produced a session with the wrong scope would be worse than
  // one that failed.
  const players = (await api("/api/read/players", { token: got.body.token })).body?.rows ?? [];
  ok("...with that person's own scope and no more", players.length === 1);

  group("A code is spent when it is used");
  ok("the same code cannot be redeemed twice",
     (await redeem("parent@example.invalid", issued.body.code)).body?.error === "invalid_or_expired_code");
  ok("...and the row says when it was spent",
     (await q(`select used_at from login_code where id = $1`, [stored[0].id]))[0].used_at != null);

  group("Issuing a second code spends the first");
  const first = await invite(head, "parent@example.invalid");
  const second = await invite(head, "parent@example.invalid");
  ok("both are issued", !!first.body?.code && !!second.body?.code);
  ok("the first no longer works",
     (await redeem("parent@example.invalid", first.body.code, "phone-2")).body?.error === "invalid_or_expired_code");
  ok("...and the second does",
     !!(await redeem("parent@example.invalid", second.body.code, "phone-2")).body?.token);

  group("Nobody signed in can read the codes");
  // A person who can list login codes can become anybody at their school, so
  // the table has row-level security on and NO policy at all: every read and
  // write happens in the login path, through SECURITY DEFINER functions.
  const n = (await q(`select count(*)::int n from pg_policy
                       where polrelid = 'login_code'::regclass`))[0].n;
  ok("login_code has no policy whatsoever", n === 0);
  const app = new pg.Pool({ connectionString: APP });
  const c = await app.connect();
  try {
    await c.query("select set_config('app.user_id', $1, false)", [U_REG]);
    const rows = (await c.query("select * from login_code")).rows;
    ok("...so even the office that issued them reads none", rows.length === 0);
  } finally { c.release(); await app.end().catch(() => {}); }

  group("The development door is still shut in production");
  ok("dev-login is refused when it is not enabled", true === (await (async () => {
    const p2 = 8807;
    const s2 = spawn(process.execPath, ["services/api/server.mjs"], {
      env: { ...process.env, PORT: String(p2), NODE_ENV: "production",
             SESSION_SECRET: "smoke-login-secret-2", ALLOW_DEV_LOGIN: "" },
      stdio: ["ignore", "pipe", "pipe"] });
    try {
      for (let i = 0; i < 60; i++) {
        try { const r = await fetch(`http://127.0.0.1:${p2}/api/health`); if (r.ok) break; } catch { /* not up */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      const r = await fetch(`http://127.0.0.1:${p2}/api/auth/dev-login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "registrar@example.invalid", deviceId: "x" }) });
      const b = await r.json().catch(() => null);
      return !b?.token;
    } finally { s2.kill("SIGTERM"); }
  })()));
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
console.log(`\n${"─".repeat(52)}\nLOGIN SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

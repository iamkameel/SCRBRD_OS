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
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8806);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const APP = appUrl();
const U_PARENT = "88888888-0000-0000-0000-000000000005";
const U_REG    = "88888888-0000-0000-0000-00000000000c";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
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
  const head      = await devLogin("sarah@example.invalid");      // directorofsport, user.invite, may not appoint a parent
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

  // A code makes the issuer able to sign in as that person, so the office
  // issues one only to an account whose every role it could appoint itself
  // (db/81's re-emit of login_code_issue()). The director of sport holds
  // user.invite and may not appoint a parent: before db/81 she could become
  // one — and give a family's consents in its name.
  group("Only to somebody the issuer could appoint");
  ok("the director of sport may not issue a parent's code",
     (await invite(head, "parent@example.invalid")).body?.error === "not_permitted");
  ok("...nor the office the principal's",
     (await invite(registrar, "principal@example.invalid")).body?.error === "not_permitted");
  ok("...nor the DSO's: the office never reads a concern",
     (await invite(registrar, "dso@example.invalid")).body?.error === "not_permitted");

  group("Issuing a second code spends the first");
  const first = await invite(registrar, "parent@example.invalid");
  const second = await invite(registrar, "parent@example.invalid");
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

  // ── GA-I03: a session ends when it is ended (db/85) ──────────────
  // A token is thirty minutes of being somebody. Before db/85 nothing could
  // end one early: signing out, the office disabling the account, removing a
  // sign-in — a copy of the token kept working until it expired.
  const codeFor = async (email, deviceId) => {
    const c = await invite(registrar, email);
    return (await redeem(email, c.body?.code, deviceId)).body?.token;
  };
  const who = async (token) => {
    const r = await api("/api/session", { token });
    return r.status === 200 ? r.body?.user?.id : r.status + " " + (r.body?.error ?? "");
  };
  const refused = async (token) => {
    const r = await api("/api/session", { token });
    return r.status === 401 && r.body?.error === "session_revoked";
  };

  group("Signing out ends the session on this device (GA-I03)");
  const out1 = await codeFor("parent@example.invalid", "phone-out-1");
  const out1b = await codeFor("parent@example.invalid", "phone-out-1");
  const out2 = await codeFor("parent@example.invalid", "phone-out-2");
  ok("the parent is signed in twice on one phone and once on another",
     (await who(out1)) === U_PARENT && (await who(out1b)) === U_PARENT && (await who(out2)) === U_PARENT);
  const signedOut = await api("/api/auth/sign-out", { method: "POST", token: out1 });
  ok("signing out answers", signedOut.status === 200 && signedOut.body?.ok === true);
  ok("the token, used after sign-out, is refused: 401 session_revoked", await refused(out1));
  ok("...on a read as well", (await api("/api/read/players", { token: out1 })).status === 401);
  ok("...and so is the older token from the same phone", await refused(out1b));
  ok("the other phone is still signed in", (await who(out2)) === U_PARENT);
  const out3 = await codeFor("parent@example.invalid", "phone-out-1");
  ok("a fresh sign-in on the phone that signed out works", (await who(out3)) === U_PARENT);

  group("Sign out everywhere (GA-I03)");
  const ev1 = await codeFor("parent@example.invalid", "phone-ev-1");
  const ev2 = await codeFor("parent@example.invalid", "phone-ev-2");
  ok("without a session it is refused",
     (await api("/api/auth/sign-out-everywhere", { method: "POST" })).status === 401);
  const everywhere = await api("/api/auth/sign-out-everywhere", { method: "POST", token: ev1 });
  ok("signing out everywhere answers", everywhere.status === 200 && everywhere.body?.signedOut === true);
  ok("...the token that asked is refused", await refused(ev1));
  ok("...and every older token, on every phone",
     (await refused(ev2)) && (await refused(out2)) && (await refused(out3)));
  ok("...but nobody else's", (await who(registrar)) === U_REG);
  const ev3 = await codeFor("parent@example.invalid", "phone-ev-1");
  ok("a fresh sign-in afterwards works", (await who(ev3)) === U_PARENT);

  group("The office disables the account (GA-I03)");
  const dis1 = await codeFor("parent@example.invalid", "phone-dis-1");
  ok("the parent is signed in", (await who(dis1)) === U_PARENT);
  // A reason on each (account lifecycle slice 2, db/90).
  const disable = (token, id = U_PARENT) => api(`/api/auth/users/${id}/disable`, { method: "POST", token, body: { reason: "Login walk: a phone left on the bus" } });
  const enable = (token, id = U_PARENT) => api(`/api/auth/users/${id}/enable`, { method: "POST", token, body: { reason: "Login walk: the phone came back" } });
  let r = await disable(coach);
  ok("a coach may not disable an account", r.status === 403 && r.body?.error === "not_permitted");
  r = await disable(head);
  ok("...nor the director of sport a parent's (she could not appoint one)", r.status === 403 && r.body?.error === "not_permitted");
  r = await disable(wesReg);
  ok("...nor another school's office", r.status === 403 && r.body?.error === "not_permitted");
  r = await disable(registrar, U_REG);
  ok("...nor the office its own", r.status === 403 && r.body?.error === "cannot_disable_yourself");
  ok("...and the parent is still signed in after all of those", (await who(dis1)) === U_PARENT);
  r = await disable(registrar);
  ok("the school office disables the parent's account", r.status === 200 && r.body?.active === false);
  ok("the parent's token is refused on the next request", await refused(dis1));
  ok("...and the one from before", await refused(ev3));
  ok("nobody can issue the account a code while it is disabled",
     (await invite(registrar, "parent@example.invalid")).body?.error === "not_permitted");
  ok("...nor sign in to it by the development door",
     (await api("/api/auth/dev-login", { method: "POST", body: { email: "parent@example.invalid", deviceId: "x" } })).status === 401);
  r = await enable(registrar);
  ok("the office enables it again", r.status === 200 && r.body?.active === true);
  ok("...and the old token stays dead", await refused(dis1));
  const dis2 = await codeFor("parent@example.invalid", "phone-dis-1");
  ok("a fresh sign-in after it is enabled works", (await who(dis2)) === U_PARENT);
  // The owner may also set app_user.active by hand in the SQL editor (since
  // db/90 the application cannot). The rule is a trigger, so that ends
  // sessions too.
  await q(`update app_user set active = false where id = $1`, [U_PARENT]);
  ok("an account disabled by a plain UPDATE ends its sessions too", await refused(dis2));
  await q(`update app_user set active = true where id = $1`, [U_PARENT]);
  ok("...and stays signed out when it is enabled again", await refused(dis2));
  const dis3 = await codeFor("parent@example.invalid", "phone-dis-1");
  ok("...until a fresh sign-in", (await who(dis3)) === U_PARENT);

  group("A token from before db/85 (no session) is refused");
  {
    const [h, p] = dis3.split(".");
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    ok("a token names its session and the epoch it was issued under",
       typeof claims.sid === "string" && Number.isInteger(claims.sep));
    const { createHmac } = await import("node:crypto");
    const bare = Buffer.from(JSON.stringify({ ...claims, sid: undefined, sep: undefined })).toString("base64url");
    const sig = createHmac("sha256", "smoke-login-secret").update(`${h}.${bare}`).digest("base64url");
    const old = await api("/api/session", { token: `${h}.${bare}.${sig}` });
    ok("a correctly signed token without one is 401 incomplete_claims", old.status === 401 && old.body?.error === "incomplete_claims");
    const other = Buffer.from(JSON.stringify({ ...claims, sid: "00000000-0000-4000-8000-000000000000" })).toString("base64url");
    const sig2 = createHmac("sha256", "smoke-login-secret").update(`${h}.${other}`).digest("base64url");
    ok("...and one naming a session that was never issued is 401", await refused(`${h}.${other}.${sig2}`));
    const behind = Buffer.from(JSON.stringify({ ...claims, sep: claims.sep - 1 })).toString("base64url");
    const sig3 = createHmac("sha256", "smoke-login-secret").update(`${h}.${behind}`).digest("base64url");
    ok("...and one naming an earlier epoch is 401", await refused(`${h}.${behind}.${sig3}`));
  }

  group("Role revocation still takes effect on the next request");
  {
    const before = (await api("/api/read/players", { token: dis3 })).body?.rows ?? [];
    ok("the parent reads his child", before.length === 1);
    await q(`update role_assignment set active = false where person_id = $1 and role = 'guardian' and active`, [U_PARENT]);
    const after = await api("/api/read/players", { token: dis3 });
    ok("...and, the moment the office withdraws the role, nothing — on the same token",
       after.status === 200 && (after.body?.rows ?? []).length === 0);
    ok("...which is still a session: the role went, not the sign-in", (await who(dis3)) === U_PARENT);
  }

  group("The development door is still shut in production");
  ok("dev-login is refused when it is not enabled", true === (await (async () => {
    const p2 = port(8807);
    const s2 = spawn(process.execPath, ["services/api/server.mjs"], {
      env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(p2), NODE_ENV: "production",
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

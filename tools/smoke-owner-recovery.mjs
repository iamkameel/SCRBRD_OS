#!/usr/bin/env node
/**
 * A way back in for the owner that does not run through the SQL Editor.
 *
 * Every other account's code is reissued by whoever holds user.invite at
 * their school; the owner answers to no school, so there is no office for
 * theirs. POST /api/auth/owner/recover (services/api/write/owner-recovery-api.mjs)
 * is that office — off by default, on only with OWNER_RECOVERY_SECRET set,
 * and its only gate beyond that is owner_recovery_issue() (db/18): the
 * account named must already hold a live, platform-wide superadmin
 * assignment. It cannot create that assignment or touch any other account.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-owner-recovery.mjs
 */
import { spawn } from "node:child_process";

const OWNER = "owner@example.invalid";      // superadmin, school_id NULL — see db/98_seed_pilot.sql
const NOT_OWNER = "coach@example.invalid";  // a real account, but not a platform-wide superadmin
const RECOVERY_SECRET = "smoke-recovery-secret-do-not-use-in-real-life";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

async function withServer(port, env, fn) {
  const server = spawn(process.execPath, ["services/api/server.mjs"], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "development", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverErr = [];
  server.stderr.on("data", (d) => serverErr.push(d.toString()));
  const api = async (path, { method = "GET", body, headers = {} } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    for (let i = 0; i < 60; i++) {
      try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    await fn(api);
  } catch (e) {
    ok(`the recovery walk threw on port ${port}: ${e.message?.slice(0, 160)}`, false);
  } finally {
    server.kill("SIGTERM");
    if (fail && serverErr.length) { console.log("\nServer stderr:"); console.log(serverErr.join("").split("\n").slice(0, 12).join("\n")); }
  }
}

const recover = (api, email, secretHeader) => api("/api/auth/owner/recover", {
  method: "POST",
  headers: secretHeader === undefined ? {} : { "x-owner-recovery-secret": secretHeader },
  body: { email },
});

try {
  group("Off by default — the same posture as ALLOW_DEV_LOGIN");
  await withServer(8890, { SESSION_SECRET: "smoke-recovery-a" }, async (api) => {
    const noEnv = await recover(api, OWNER, RECOVERY_SECRET);
    ok("with OWNER_RECOVERY_SECRET unset on the server, the route is a 501", noEnv.status === 501 && noEnv.body?.error === "recovery_not_configured", JSON.stringify(noEnv.body));
  });

  await withServer(8891, { SESSION_SECRET: "smoke-recovery-b", OWNER_RECOVERY_SECRET: RECOVERY_SECRET }, async (api) => {
    group("Wrong key, no email, and no header are all refused before the database is asked");
    const wrongKey = await recover(api, OWNER, "not-the-secret");
    ok("the wrong recovery key is refused: not_permitted", wrongKey.status === 403 && wrongKey.body?.error === "not_permitted", JSON.stringify(wrongKey.body));
    const noHeader = await recover(api, OWNER, undefined);
    ok("no header at all is refused the same way, not treated as empty-string-matches", noHeader.status === 403);
    const noEmail = await api("/api/auth/owner/recover", { method: "POST", headers: { "x-owner-recovery-secret": RECOVERY_SECRET }, body: {} });
    ok("no email is a 400, distinct from a wrong secret", noEmail.status === 400 && noEmail.body?.error === "email_required");

    group("The gate is the assignment, not the address");
    const notOwner = await recover(api, NOT_OWNER, RECOVERY_SECRET);
    ok("a real account with no platform-wide superadmin is refused: not_owner", notOwner.status === 404 && notOwner.body?.error === "not_owner", JSON.stringify(notOwner.body));
    const noSuchAccount = await recover(api, "nobody-at-all@example.invalid", RECOVERY_SECRET);
    ok("an address with no account at all is refused the SAME way — no enumeration", noSuchAccount.status === 404 && noSuchAccount.body?.error === "not_owner");

    group("The right key, for the owner, works");
    const first = await recover(api, OWNER, RECOVERY_SECRET);
    ok("the owner gets a fresh code", first.status === 200 && typeof first.body?.code === "string" && first.body.code.length > 10, JSON.stringify(first.body));
    ok("...good for about 24 hours", Math.abs(new Date(first.body.expiresAt) - Date.now() - 24 * 3600 * 1000) < 60_000);

    const redeemed = await api("/api/auth/redeem", { method: "POST", body: { email: OWNER, code: first.body.code, deviceId: "recovery-laptop" } });
    ok("the code signs the owner in", redeemed.status === 200 && !!redeemed.body?.token, JSON.stringify(redeemed.body));
    const me = await api("/api/session", { headers: { authorization: `Bearer ${redeemed.body?.token}` } });
    ok("...to a platform-wide superadmin session", (me.body?.assignments ?? []).some((a) => a.role === "superadmin" && a.school == null), JSON.stringify(me.body?.assignments));

    group("A second recovery replaces the first, rather than stacking codes");
    const second = await recover(api, OWNER, RECOVERY_SECRET);
    ok("running it again mints a fresh code", second.status === 200 && second.body.code !== first.body.code);
    const staleRedeem = await api("/api/auth/redeem", { method: "POST", body: { email: OWNER, code: first.body.code, deviceId: "recovery-phone" } });
    ok("the earlier code is spent, not just superseded", staleRedeem.status !== 200, JSON.stringify(staleRedeem.body));
    const freshRedeem = await api("/api/auth/redeem", { method: "POST", body: { email: OWNER, code: second.body.code, deviceId: "recovery-phone" } });
    ok("the fresh one works", freshRedeem.status === 200 && !!freshRedeem.body?.token);
  });
} finally {
  console.log(`\n${"─".repeat(52)}\nOWNER RECOVERY SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

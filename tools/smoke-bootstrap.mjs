#!/usr/bin/env node
/**
 * The owner's key, minted from outside the platform.
 *
 * Nobody inside SCRBRD may appoint an owner: platformadmin cannot grant
 * superadmin (db/99), and a person cannot issue themselves a code. So the
 * only honest path onto a real database is tools/bootstrap.mjs --owner, run
 * by the operator with the API's SESSION_SECRET. This walk runs it exactly
 * that way against the walk's own database and then does what the operator
 * would do next: types the code in, and reads across every school.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-bootstrap.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import pg from "pg";

const PORT = 8885, BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const SECRET = "smoke-bootstrap-secret";
const EMAIL = "owner-of-record@example.invalid";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "", SESSION_SECRET: SECRET },
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
const bootstrap = (...flags) => {
  const r = spawnSync(process.execPath, ["tools/bootstrap.mjs", ...flags],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: DB, SESSION_SECRET: SECRET } });
  return { status: r.status, out: r.stdout + r.stderr, code: r.stdout.match(/Login code[^:]*: (\S+)/)?.[1] ?? null };
};
const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  group("The owner's key is minted from outside");
  const first = bootstrap("--owner", "--email", EMAIL, "--name", "Owner Of Record");
  ok("bootstrap --owner runs", first.status === 0, first.out.slice(0, 300));
  ok("...says what it did", /owner's key — every capability, every school/.test(first.out), first.out.slice(0, 200));
  ok("...and prints a code, once", Boolean(first.code));
  const keys = await q(`select a.role, a.school_id from role_assignment a join app_user u on u.id = a.person_id
                         where lower(u.email) = lower($1) and a.active`, [EMAIL]);
  ok("the assignment is superadmin with no school", keys.length === 1 && keys[0].role === "superadmin" && keys[0].school_id === null, JSON.stringify(keys));
  const stored = await q(`select code_hash from login_code lc join app_user u on u.id = lc.user_id where lower(u.email) = lower($1) and used_at is null`, [EMAIL]);
  ok("the database holds the hash, never the code", stored.length === 1 && stored[0].code_hash !== first.code);

  group("...and opens every door");
  const redeemed = await api("/api/auth/redeem", { method: "POST", body: { email: EMAIL, code: first.code, deviceId: "owner-laptop" } });
  ok("the code signs the owner in", redeemed.status === 200 && Boolean(redeemed.body?.token), JSON.stringify(redeemed.body));
  const token = redeemed.body?.token;
  const me = await api("/api/session", { token });
  ok("the session carries a platform-wide superadmin assignment",
     (me.body?.assignments ?? []).some((a) => a.role === "superadmin" && a.school_id == null), JSON.stringify(me.body?.assignments));
  const players = await api("/api/read/players", { token });
  const schools = new Set((players.body?.rows ?? []).map((r) => r.school_id));
  ok("the owner reads every school's roster", players.status === 200 && schools.size >= 2, `status ${players.status}, ${schools.size} schools`);
  ok("...through the mask, not around it — protected columns present",
     (players.body?.rows ?? []).some((r) => r.born && r.guardian));
  const again = await api("/api/auth/redeem", { method: "POST", body: { email: EMAIL, code: first.code, deviceId: "owner-phone" } });
  ok("the code was single-use", again.status !== 200);

  group("Running it again is the recovery path");
  const second = bootstrap("--owner", "--email", EMAIL, "--name", "Owner Of Record");
  ok("a second run mints a fresh code", second.status === 0 && second.code && second.code !== first.code);
  const keys2 = await q(`select count(*)::int n from role_assignment a join app_user u on u.id = a.person_id
                          where lower(u.email) = lower($1) and a.active and a.role = 'superadmin'`, [EMAIL]);
  ok("...and does not stack a second key", keys2[0].n === 1);
  const r2 = await api("/api/auth/redeem", { method: "POST", body: { email: EMAIL, code: second.code, deviceId: "owner-phone" } });
  ok("the fresh code works", r2.status === 200);

  group("The ordinary first person is still ordinary");
  const ops = bootstrap("--email", "ops-of-record@example.invalid", "--name", "Platform Ops");
  const opsKeys = await q(`select a.role from role_assignment a join app_user u on u.id = a.person_id
                            where lower(u.email) = 'ops-of-record@example.invalid' and a.active`);
  ok("without --owner, platformadmin and nothing more", ops.status === 0 && opsKeys.length === 1 && opsKeys[0].role === "platformadmin", JSON.stringify(opsKeys));
} catch (e) {
  ok(`the bootstrap walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBOOTSTRAP SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

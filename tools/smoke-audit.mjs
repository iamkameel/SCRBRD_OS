#!/usr/bin/env node
/**
 * Who read what about a child.
 *
 * The table SCRBRD produces to the Information Regulator, or to a parent who
 * asks who has been reading their child's record. This walk proves the entries
 * are written, that they record what was ACTUALLY RECEIVED rather than what was
 * asked for, and that the log is not something the reader can forge, suppress
 * or read back.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-audit.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8802;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const P_INJURED = "aaaaaaaa-0000-0000-0000-000000000005";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-audit-secret" },
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
  method: "POST", body: { email, deviceId: "device-audit" } })).body?.token;
const read = async (r, token) => (await api(`/api/read/${r}`, { token })).body?.rows ?? [];

const pool = new pg.Pool({ connectionString: DB });
// The application role, connected as the API connects. Its privileges are the
// subject of the immutability assertions below, so they must not be inherited
// from whoever ran the migrations.
const APP = process.env.APP_DATABASE_URL || "postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd";
const appPool = new pg.Pool({ connectionString: APP });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach   = await login("coach@example.invalid");
  const medic   = await login("medical@example.invalid");
  const watcher = await login("watcher@example.invalid");
  const head    = await login("sarah@example.invalid");   // directorofsport, holds audit.read

  await q(`delete from access_log`);

  group("A disclosure is logged");
  await read("injuries", medic);
  const medicEntries = await q(`select * from access_log where resource = 'injuries'`);
  ok("reading clinical records writes an entry", medicEntries.length === 1);
  ok("...naming who read it", medicEntries[0]?.person_id === "88888888-0000-0000-0000-000000000003");
  ok("...and which children it was about",
     (medicEntries[0]?.record_ids ?? []).includes(P_INJURED));
  ok("...and that the notes were among what came back",
     (medicEntries[0]?.fields ?? []).includes("notes"));
  ok("...with the device it was read on", medicEntries[0]?.device_id === "device-audit");

  group("It records what was RECEIVED, not what was asked for");
  // Masking is per row and per capability, so the same query returns different
  // columns to different people. Logging the query would record a disclosure
  // that never happened.
  await q(`delete from access_log`);
  await read("injuries", coach);
  const coachEntry = (await q(`select * from access_log where resource='injuries'`))[0];
  ok("the coach's read is logged too", !!coachEntry);
  ok("...and names the notes they DID receive",
     (coachEntry?.fields ?? []).includes("notes"));

  // A spectator receives no injury rows at all, so nothing was disclosed and
  // nothing should be written. A log that records attempts rather than
  // disclosures fills with noise and stops being read.
  await q(`delete from access_log`);
  await read("injuries", watcher);
  ok("a read that returned nothing writes no entry",
     (await q(`select count(*)::int n from access_log`))[0].n === 0);

  group("Opening a screen is not a disclosure");
  await q(`delete from access_log`);
  await read("matches", coach);
  ok("a fixture list writes no entry",
     (await q(`select count(*)::int n from access_log`))[0].n === 0);

  group("The log cannot be forged, suppressed, or read by its subject");
  await q(`delete from access_log`);
  await read("players", coach);
  const before = (await q(`select count(*)::int n from access_log`))[0].n;
  ok("a roster read carrying dates of birth is logged", before > 0);

  // The application role has no INSERT, UPDATE or DELETE policy on the table.
  // The only way a row appears is the SECURITY DEFINER function.
  for (const [what, sql] of [
    ["forge an entry", `insert into access_log (person_id, resource) values ('88888888-0000-0000-0000-000000000004','players')`],
    ["alter an entry", `update access_log set fields = '{}'`],
    ["delete an entry", `delete from access_log`],
  ]) {
    let refused = false;
    // A REAL connection as scrbrd_app, not `set local role` from the owner's.
    // The two are not equivalent: role-switching inside a session whose
    // bootstrap user is a superuser left the UPDATE case passing vacuously on
    // CI, where POSTGRES_USER is created SUPERUSER and cannot be demoted — the
    // bootstrap user is forbidden from dropping the attribute. Connecting the
    // way the API actually connects makes the assertion mean the same thing
    // everywhere, and tests the path production uses rather than a proxy for it.
    const c = await appPool.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('app.user_id','88888888-0000-0000-0000-000000000004',true)`);
      const r = await c.query(sql);
      // Refusal has TWO shapes and only one of them throws. A missing table
      // privilege raises; a missing POLICY does not — row-level security just
      // filters the statement down to nothing, and `UPDATE 0` comes back as an
      // ordinary success. Asserting only on the exception let the UPDATE case
      // pass for the wrong reason, so what is checked here is the property
      // itself: the log is unaltered, however the database chose to say so.
      refused = r.rowCount === 0;
      await c.query("rollback");
    } catch { refused = true; await c.query("rollback").catch(() => {}); }
    finally { c.release(); }
    ok(`the application role cannot ${what}`, refused);
  }

  // A log the reader can read tells them exactly what to avoid next time.
  ok("the coach cannot read the log", (await read("access_log", coach)).length === 0);
  ok("nor a spectator", (await read("access_log", watcher)).length === 0);
  const audit = await read("access_log", head);
  ok("someone holding audit.read can", audit.length > 0);

  group("The question a parent actually asks");
  const aboutChild = (await api(`/api/read/access_log?playerId=${P_INJURED}`, { token: head })).body?.rows ?? [];
  ok("everything read about one child can be answered",
     aboutChild.length > 0 && aboutChild.every((r) => (r.record_ids ?? []).includes(P_INJURED)));
  ok("...naming the reader", aboutChild.every((r) => r.person_name));
} catch (e) {
  ok(`the audit walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
  await appPool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nAUDIT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

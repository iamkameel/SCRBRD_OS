#!/usr/bin/env node
/**
 * A 200 means a row. The answer leaves after COMMIT.
 *
 * Every write handler answers from inside its transaction, and for as long
 * as the response shim wrote straight to the socket, the 200 could reach the
 * client before the row was committed. Usually nobody noticed. Sometimes a
 * walk that read the database on the very next line missed the row
 * (roster-add, intermittently, on CI). And a COMMIT that refused — a deferred
 * constraint, a serialisation failure — had already been answered "saved".
 *
 * Nothing about that is visible at normal speed, so this walk slows COMMIT
 * down and then makes it refuse, with DEFERRABLE INITIALLY DEFERRED
 * constraint triggers that fire only at commit time. The race becomes a
 * certainty, and so does the assertion.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-commit.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8838;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-commit-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body, headers = {} } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, replayed: res.headers.get("idempotent-replayed") === "true", body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-commit" } })).body?.token;

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const boy = (name) => ({ schoolId: HIL, fullName: name, teamCode: "U15A", playingRole: "bowler",
                         battingStyle: "R", bowlingArm: "L", bowlingStyle: "F", born: "2011-03-14" });
const exists = async (id) => (await q(`select 1 from player where id = $1`, [id])).length === 1;

// Commit-time hooks. A CONSTRAINT TRIGGER that is DEFERRABLE INITIALLY
// DEFERRED runs when the transaction commits, not when the row is written —
// which is exactly the moment this walk is about.
const atCommit = async (body) => {
  await q(`drop trigger if exists player_at_commit on player`);
  if (!body) return;
  await q(`create or replace function _at_commit() returns trigger as $$ begin ${body} return null; end $$ language plpgsql`);
  await q(`create constraint trigger player_at_commit after insert on player
             deferrable initially deferred for each row execute function _at_commit()`);
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const head = await login("sarah@example.invalid");   // director of sport, Hilton
  const add = (name, headers) => api("/api/players", { method: "POST", token: head, body: boy(name), headers });

  group("The answer leaves after COMMIT");
  await atCommit(`perform pg_sleep(0.4);`);
  {
    const t0 = Date.now();
    const r = await add("Slow Commit");
    const dt = Date.now() - t0;
    ok("the write is answered 200", r.status === 200 && r.body?.id);
    ok("...and the row is there the moment the 200 arrives", await exists(r.body?.id));
    ok(`...because the answer waited for COMMIT (${dt} ms, commit took 400)`, dt >= 380);
  }

  group("A COMMIT that refuses is not a 200");
  await atCommit(`raise exception 'refused at commit by a deferred check';`);
  {
    const r = await add("Deferred Refusal");
    ok("the client is told it failed", r.status >= 500);
    ok("...and nothing was saved", (await q(`select 1 from player where full_name = 'Deferred Refusal'`)).length === 0);
  }

  group("A retry after a refused COMMIT writes for real");
  // Idempotency receipts are written from the answer that was SENT. Written
  // from the handler's first word, inside the transaction, a refused commit
  // left a 200 receipt behind and the retry was "saved" with nothing saved.
  {
    const key = `commit-${Date.now()}`;
    const first = await add("Retried Boy", { "idempotency-key": key });
    ok("the first attempt fails at commit", first.status >= 500);
    await atCommit(null);
    const second = await add("Retried Boy", { "idempotency-key": key });
    ok("the retry with the same key is not answered from a receipt", second.status === 200 && !second.replayed);
    ok("...and this time the row is there", await exists(second.body?.id));
    const third = await add("Retried Boy", { "idempotency-key": key });
    ok("...and a further retry IS answered from the receipt of the write that stood", third.replayed && third.body?.id === second.body?.id);
    ok("...with one row, not two", (await q(`select count(*)::int n from player where full_name = 'Retried Boy'`))[0].n === 1);
  }

  group("Nothing else moved");
  {
    const t0 = Date.now();
    const r = await add("Ordinary Boy");
    ok("an ordinary write is answered 200, quickly, with its row", r.status === 200 && await exists(r.body?.id) && Date.now() - t0 < 2000);
    const denied = await api("/api/players", { method: "POST", token: await login("watcher@example.invalid"), body: boy("Nobody") });
    ok("a refusal is still a refusal", denied.status === 403 || denied.status === 401);
  }
} catch (e) {
  ok(`the commit walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  await atCommit(null).catch(() => {});
  await q(`drop function if exists _at_commit()`).catch(() => {});
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nCOMMIT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

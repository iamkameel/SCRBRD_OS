#!/usr/bin/env node
/**
 * Disabling and enabling an account, through the API (account lifecycle,
 * slice 1). No migration: the `accounts` read is new, the two routes are
 * db/85's, and who may act is db/81's auth_office_refusal(), unchanged.
 *
 *   1. `accounts` lists every account the reader may read, disabled ones
 *      included; `users` keeps its `where active`. A coach (no user.read)
 *      reads only himself. The office's read is on the access log, naming
 *      the accounts it read; the coach's read of himself is not.
 *   2. The office disables a coach: his token is refused on its next request,
 *      on a read as well; he cannot sign in; he stays on `accounts`, marked
 *      not active, and leaves `users`; every role he held is still held.
 *   3. The office enables him: his old token stays dead, and he signs in
 *      again — by the development door and by a code the office issues.
 *   4. The office is refused for the principal and the DSO (not_permitted),
 *      and nothing about either account moves.
 *   5. Nobody can disable or enable themselves: the office, the principal,
 *      the owner's key (cannot_disable_yourself). A coach may not disable
 *      anybody.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-accounts.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8933);
const BASE = `http://127.0.0.1:${PORT}`;
const U_COACH     = "88888888-0000-0000-0000-000000000004";   // C Hendricks, 1XI
const U_REG       = "88888888-0000-0000-0000-00000000000c";   // B Naicker, the school office
const U_PRINCIPAL = "88888888-0000-0000-0000-000000000016";
const U_DSO       = "88888888-0000-0000-0000-000000000057";
const HILTON      = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-accounts-secret" },
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
const devLogin = async (email, deviceId = "device-accounts") =>
  api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } });
const tokenFor = async (email, deviceId) => (await devLogin(email, deviceId)).body?.token;
const read = (token, resource) => api(`/api/read/${resource}`, { token });
const disable = (token, id) => api(`/api/auth/users/${id}/disable`, { method: "POST", token });
const enable = (token, id) => api(`/api/auth/users/${id}/enable`, { method: "POST", token });
const who = async (token) => {
  const r = await api("/api/session", { token });
  return r.status === 200 ? r.body?.user?.id : `${r.status} ${r.body?.error ?? ""}`;
};
const revoked = async (token) => {
  const r = await api("/api/session", { token });
  return r.status === 401 && r.body?.error === "session_revoked";
};

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;
const activeOf = async (id) => (await q(`select active from app_user where id = $1`, [id]))[0]?.active;
const rolesOf = async (id) => (await q(
  `select role, school_id, team_code from role_assignment where person_id = $1 and active order by role, team_code`, [id]))
  .map((r) => `${r.role}:${r.team_code ?? ""}`).join(",");
const accountsLogged = async (person) => (await q(
  `select record_ids, fields, school_id from access_log where resource = 'accounts' and person_id = $1 order by occurred_at`, [person]));

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const office    = await tokenFor("registrar@example.invalid");
  const principal = await tokenFor("principal@example.invalid");
  const owner     = await tokenFor("owner@example.invalid");
  const coach1    = await tokenFor("coach@example.invalid", "coach-phone");
  const coach2    = await tokenFor("coach@example.invalid", "coach-tablet");
  ok("the office, the principal, the owner and the coach (on two devices) are signed in",
     (await who(office)) === U_REG && (await who(principal)) === U_PRINCIPAL && !!owner
     && (await who(coach1)) === U_COACH && (await who(coach2)) === U_COACH);

  // ── 1. The read ────────────────────────────────────────────────
  group("accounts: every account the reader may read; users keeps `where active`");
  const before = await read(office, "accounts");
  const rows = before.body?.rows ?? [];
  const dbCount = Number((await q(`select count(*) from app_user where school_id = $1`, [HILTON]))[0].count);
  ok("the office reads it", before.status === 200 && rows.length > 0, before.status);
  ok("...every account at its school, and only its school's",
     rows.filter((r) => r.school_id === HILTON).length === dbCount && rows.every((r) => r.school_id === HILTON),
     `${rows.length} rows, ${dbCount} at Hilton`);
  ok("...in the users read's columns, with `active` and `mine`",
     ["id", "school_id", "email", "name", "role", "active", "last_seen_at", "teams", "player_id", "mine"].every((c) => c in (rows[0] ?? {})));
  ok("...its own row marked mine, and only that one",
     rows.filter((r) => r.mine).map((r) => r.id).join() === U_REG);
  const logged0 = await accountsLogged(U_REG);
  ok("the office's read is on the access log, at its school, naming the accounts read (not its own) and the email column",
     logged0.length === 1 && logged0[0].school_id === HILTON && logged0[0].record_ids.includes(U_COACH)
     && !logged0[0].record_ids.includes(U_REG) && logged0[0].fields.includes("email"),
     JSON.stringify(logged0.map((l) => [l.school_id, l.record_ids.length, l.fields])));
  const mine = await read(coach1, "accounts");
  ok("a coach (no user.read) reads his own account and nobody else's",
     mine.status === 200 && (mine.body?.rows ?? []).length === 1 && mine.body.rows[0].id === U_COACH && mine.body.rows[0].mine === true);
  ok("...and reading only himself writes nothing to the log", (await accountsLogged(U_COACH)).length === 0);
  ok("signed out, the read is refused", (await api("/api/read/accounts")).status === 401);

  // ── 2. Disable ─────────────────────────────────────────────────
  group("The office disables the coach: every device signed out, every role kept");
  const rolesBefore = await rolesOf(U_COACH);
  ok("the coach holds his roles", rolesBefore.includes("coach:1XI"), rolesBefore);
  let r = await disable(office, U_COACH);
  ok("the office disables the coach's account", r.status === 200 && r.body?.active === false, JSON.stringify(r.body));
  ok("...and the database says so", (await activeOf(U_COACH)) === false);
  ok("the coach's token is refused on its next request: 401 session_revoked", await revoked(coach1));
  ok("...on a read as well", (await read(coach1, "players")).status === 401);
  ok("...and the token on his other device", await revoked(coach2));
  ok("he cannot sign in while disabled", (await devLogin("coach@example.invalid", "coach-new")).status === 401);
  ok("...and the office cannot issue him a code",
     (await api("/api/auth/invite", { method: "POST", token: office, body: { email: "coach@example.invalid" } })).body?.error === "not_permitted");
  ok("every role he held is still held (disabling is not a dismissal)", (await rolesOf(U_COACH)) === rolesBefore, await rolesOf(U_COACH));
  const after = (await read(office, "accounts")).body?.rows ?? [];
  const row = after.find((x) => x.id === U_COACH);
  ok("he stays on accounts, marked not active", !!row && row.active === false);
  ok("...and leaves users, which the pickers read", !((await read(office, "users")).body?.rows ?? []).some((x) => x.id === U_COACH));
  ok("disabling twice is harmless", (await disable(office, U_COACH)).body?.active === false);

  // ── 3. Enable ──────────────────────────────────────────────────
  group("The office enables him, and he signs in again");
  r = await enable(office, U_COACH);
  ok("the office enables the coach's account", r.status === 200 && r.body?.active === true, JSON.stringify(r.body));
  ok("...and the database says so", (await activeOf(U_COACH)) === true);
  ok("his old tokens stay dead: enabling signs nobody back in", (await revoked(coach1)) && (await revoked(coach2)));
  const again = await tokenFor("coach@example.invalid", "coach-phone");
  ok("he signs in again", (await who(again)) === U_COACH);
  ok("...and reads what a coach reads", (await read(again, "players")).status === 200);
  const code = await api("/api/auth/invite", { method: "POST", token: office, body: { email: "coach@example.invalid" } });
  const redeemed = await api("/api/auth/redeem", { method: "POST", body: { email: "coach@example.invalid", code: code.body?.code, deviceId: "coach-tablet" } });
  ok("...and by a code the office issues", !!code.body?.code && (await who(redeemed.body?.token)) === U_COACH);
  ok("he holds every role he held before", (await rolesOf(U_COACH)) === rolesBefore);
  ok("he is back on users", ((await read(office, "users")).body?.rows ?? []).some((x) => x.id === U_COACH));
  ok("both acts are on the record, by the office",
     (await q(`select resource from access_log where person_id = $1 and record_ids @> array[$2::uuid]
                 and resource in ('auth.account_disabled', 'auth.account_enabled')`, [U_REG, U_COACH])).length >= 2);

  // ── 4. Refused ─────────────────────────────────────────────────
  group("The office is refused for the principal and the DSO");
  r = await disable(office, U_PRINCIPAL);
  ok("the office may not disable the principal: not_permitted, in words",
     r.status === 403 && r.body?.error === "not_permitted" && /school office that enrolled them/.test(r.body?.detail ?? ""), JSON.stringify(r.body));
  ok("...nor enable the principal's account", (await enable(office, U_PRINCIPAL)).body?.error === "not_permitted");
  ok("...nor disable the DSO", (await disable(office, U_DSO)).body?.error === "not_permitted");
  ok("...and both are still active", (await activeOf(U_PRINCIPAL)) === true && (await activeOf(U_DSO)) === true);
  ok("...and the principal is still signed in", (await who(principal)) === U_PRINCIPAL);
  ok("a coach may not disable anybody", (await disable(again, U_REG)).body?.error === "not_permitted" && (await activeOf(U_REG)) === true);

  // ── 5. Never yourself ──────────────────────────────────────────
  group("Nobody can disable or enable themselves");
  for (const [name, token, id] of [["the office", office, U_REG], ["the principal", principal, U_PRINCIPAL],
                                   ["the owner's key", owner, (await q(`select id from app_user where email = 'owner@example.invalid'`))[0].id],
                                   ["the coach", again, U_COACH]]) {
    const d = await disable(token, id);
    const e = await enable(token, id);
    ok(`${name}: cannot_disable_yourself, in words, both ways`,
       d.status === 403 && d.body?.error === "cannot_disable_yourself" && e.body?.error === "cannot_disable_yourself"
       && /your own account/.test(d.body?.detail ?? ""), JSON.stringify(d.body));
    ok(`...and ${name} is still signed in`, (await who(token)) === id);
  }
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
console.log(`\n${"─".repeat(52)}\nACCOUNTS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

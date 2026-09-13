#!/usr/bin/env node
/** A boy's cricket record travels on the family's say-so, and says where each line came from. */
import { spawn } from "node:child_process";
import pg from "pg";
const PORT = 8872, BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const WES = "22222222-2222-2222-2222-222222222222";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005", WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);
const server = spawn(process.execPath, ["services/api/server.mjs"], { env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-passport" }, stdio: ["ignore", "pipe", "pipe"] });
const serverErr = []; server.stderr.on("data", (d) => serverErr.push(d.toString()));
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-passport" } })).body?.token;
const passport = async (id, tok) => (await api(`/api/read/passport?playerId=${id}`, { token: tok })).body?.rows ?? [];
const consent = (tok, playerId, schoolId) => api("/api/passport/consent", { method: "POST", token: tok, body: { playerId, schoolId } });
const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
try {
  for (let i = 0; i < 60; i++) { try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const parent = await login("parent@example.invalid"), coach = await login("coach@example.invalid"), wes = await login("coach.wes@example.invalid");
  const otherMum = await login("parent.whitfield@example.invalid"), boy = await login("pillay@example.invalid"), watcher = await login("watcher@example.invalid");

  group("The record stays home until the family says otherwise");
  {
    ok("a coach at another school reads nothing of the boy", (await passport(PILLAY, wes)).length === 0);
    ok("his own coach reads his passport", (await passport(PILLAY, coach)).length > 0);
    ok("his family reads it", (await passport(PILLAY, parent)).length > 0 && (await passport(PILLAY, boy)).length > 0);
    ok("a spectator reads none", (await passport(PILLAY, watcher)).length === 0);
    ok("a coach cannot consent for a boy", [403, 401].includes((await consent(coach, PILLAY, WES)).status));
    ok("another family cannot consent for him", [403, 401].includes((await consent(otherMum, PILLAY, WES)).status));
    ok("the other school cannot help itself", [403, 401].includes((await consent(wes, PILLAY, WES)).status));
    const c = await consent(parent, PILLAY, WES);
    ok("his mother names Westville", c.status === 200);
    ok("...stamped from her session", (await q(`select granted_by from passport_consent where id = $1`, [c.body.id]))[0].granted_by === (await q(`select id from app_user where email = 'parent@example.invalid'`))[0].id);
    ok("...naming it twice is once", (await consent(parent, PILLAY, WES)).status === 422);
    const seen = await passport(PILLAY, wes);
    ok("and now Westville's coach reads his cricket record", seen.length > 0);
    ok("...every line says where it came from", seen.every((l) => l.source_school === "Hilton College" && l.recorded_by));
    ok("...and how sure to be", seen.every((l) => ["derived", "verified", "asserted", "seeded"].includes(l.confidence)));
    ok("...a cap and a milestone are derived", seen.some((l) => l.family === "cap" && l.confidence === "derived"));
    ok("...nothing medical, nothing from his file, no note", !JSON.stringify(seen).match(/injur|address|id_number|note/i));
    ok("...and Whitfield's stays home", (await passport(WHITFIELD, wes)).length === 0);
    ok("the family sees what it has granted", (await api("/api/read/passport_consents", { token: parent })).body?.rows?.some((x) => x.to_school_id === WES && x.withdrawn_at === null));
    ok("...and so does the school named", (await api("/api/read/passport_consents", { token: wes })).body?.rows?.length === 1);
    ok("Westville cannot withdraw it", (await api(`/api/passport/consent/${c.body.id}/withdraw`, { method: "POST", token: wes })).body?.withdrawn === 0);
    ok("his mother withdraws it", (await api(`/api/passport/consent/${c.body.id}/withdraw`, { method: "POST", token: parent })).body?.withdrawn === 1);
    ok("...and Westville reads nothing again", (await passport(PILLAY, wes)).length === 0);
    ok("...a withdrawn consent is not revived", !(await q(`set local role scrbrd_app; update passport_consent set withdrawn_at = null where id = $1`, [c.body.id]).then(() => true).catch(() => false)));
    ok("...but may be granted again", (await consent(parent, PILLAY, WES)).status === 200 && (await passport(PILLAY, wes)).length > 0);
  }
  group("Provenance is honest about who stood behind a line");
  {
    const lines = await passport(WHITFIELD, coach);
    ok("a seeded honour with nobody's signature says so", lines.some((l) => l.family === "honour" && l.confidence === "seeded" && /nobody on record/.test(l.recorded_by)));
    const head = await login("sarah@example.invalid");
    await api("/api/honours", { method: "POST", token: head, body: { playerId: WHITFIELD, kind: "honours", season: "2026" } });
    ok("an honour signed by a named person is verified, and names her", (await passport(WHITFIELD, coach)).some((l) => l.family === "honour" && l.confidence === "verified" && /Sarah Mokoena/.test(l.recorded_by)));
    await api(`/api/players/${WHITFIELD}/assessment`, { method: "POST", token: coach, body: { scores: { mental: { composure: 12 } } } });
    ok("a rating is asserted by the coach who gave it", (await passport(WHITFIELD, coach)).some((l) => l.family === "rating" && l.confidence === "asserted" && l.recorded_by && !/nobody/.test(l.recorded_by)));
  }
  ok("the server logged no errors", serverErr.join("").trim() === "");
} catch (e) { fail++; console.log("  ✗ threw:", e.message); }
finally { server.kill(); await pool.end(); }
console.log(`\n${"─".repeat(52)}\nPASSPORT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

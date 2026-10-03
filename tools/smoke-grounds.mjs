#!/usr/bin/env node
/**
 * Making a ground: POST /api/grounds (PILOT_LOAD.md gap 4), over HTTP.
 *
 * Until this route the pilot school's grounds went in as SQL on the owner's
 * key. The route is the table's own insert policy and nothing more:
 * facility.manage at that school, which is what editing a ground's ends or
 * parent already needs.
 *
 *   1. the office makes a ground, and a pitch on it, and reads them back
 *   2. what is malformed is refused before anything is written, and the
 *      same name at the same school is refused rather than made twice
 *   3. a coach (no facility.manage) and another school's office are refused,
 *      and nothing is written
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-grounds.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8917);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-grounds-secret" },
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
  method: "POST", body: { email, deviceId: "device-grounds" } })).body?.token;
const make = (token, body) => api("/api/grounds", { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const grounds = async () => (await pool.query(`select count(*)::int n from ground`)).rows[0].n;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const office    = await login("registrar@example.invalid");      // schooladmin: facility.manage
  const coach     = await login("coach@example.invalid");          // no facility.manage
  const wesOffice = await login("registrar.wes@example.invalid");  // facility.manage, at Westville

  group("1. The office makes a ground, and a pitch on it");
  let field;
  {
    const r = await make(office, { schoolId: HIL, name: "  Fake  Top Field ", surface: "grass" });
    field = r.body?.id;
    ok("made (200), the name tidied", r.status === 200 && !!field && r.body?.name === "Fake Top Field");
    ok("...at that school, no parent", r.body?.schoolId === HIL && r.body?.parentId === null && r.body?.surface === "grass");
    const p = await make(office, { schoolId: HIL, name: "Fake Top Field Pitch 2", parentId: field });
    ok("a pitch on it", p.status === 200 && p.body?.parentId === field && p.body?.surface === null);
    const read = (await api("/api/read/grounds", { token: office })).body?.rows ?? [];
    ok("both read back on the ground read",
       read.some((g) => g.id === field) && read.some((g) => g.id === p.body?.id && g.parent_id === field));
  }

  group("2. What is malformed is refused, and nothing is written");
  {
    const before = await grounds();
    const no = async (body, status, error) => {
      const r = await make(office, body);
      return r.status === status && r.body?.error === error;
    };
    ok("no school", await no({ name: "Fake Field" }, 400, "school_required"));
    ok("a name of one letter", await no({ schoolId: HIL, name: "F" }, 400, "name_invalid"));
    ok("a name that is not text", await no({ schoolId: HIL, name: 7 }, 400, "name_invalid"));
    ok("a surface over 40", await no({ schoolId: HIL, name: "Fake Field", surface: "x".repeat(41) }, 400, "surface_invalid"));
    ok("a parent that is not an id", await no({ schoolId: HIL, name: "Fake Field", parentId: "top" }, 400, "parent_invalid"));
    ok("a parent that is no ground", await no({ schoolId: HIL, name: "Fake Field",
      parentId: "00000000-0000-0000-0000-00000000abcd" }, 422, "parent_invalid"));
    const dup = await make(office, { schoolId: HIL, name: "fake top field" });
    ok("the same name at the same school, any case: 409 naming the one there",
       dup.status === 409 && dup.body?.error === "ground_exists" && dup.body?.detail === field);
    ok("...and not one ground was written", (await grounds()) === before);
  }

  group("3. Without facility.manage at that school, refused");
  {
    const before = await grounds();
    const c = await make(coach, { schoolId: HIL, name: "Fake Coach Field" });
    ok("a coach is refused (403)", c.status === 403 && c.body?.error === "not_permitted");
    const w = await make(wesOffice, { schoolId: HIL, name: "Fake Westville Field" });
    ok("another school's office is refused this school's ground (403)", w.status === 403);
    ok("unauthenticated is refused", [401, 403].includes((await make(undefined, { schoolId: HIL, name: "Fake Field" })).status));
    const pw = await make(wesOffice, { schoolId: "22222222-2222-2222-2222-222222222222", name: "Fake West Pitch", parentId: field });
    ok("a pitch on another school's field is refused", pw.status === 422 && pw.body?.error === "parent_invalid");
    ok("...and not one ground was written", (await grounds()) === before);
  }
} catch (e) {
  fail++;
  console.log("  ✗ walk threw:", e?.stack || e);
} finally {
  server.kill();
  await pool.end();
}

if (fail && serverErr.length) console.log(serverErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nGROUNDS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

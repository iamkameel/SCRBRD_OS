#!/usr/bin/env node
/** Drills are the platform's and the school's; kit is the school's, and a boy holds it until he gives it back. */
import { spawn } from "node:child_process";
import pg from "pg";
const PORT = 8871, BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const BATS = "e0170000-0000-0000-0000-000000000001";   // 3 bats
const MACHINE = "e0170000-0000-0000-0000-000000000003";
const P1 = "aaaaaaaa-0000-0000-0000-000000000001", P2 = "aaaaaaaa-0000-0000-0000-000000000002", P3 = "aaaaaaaa-0000-0000-0000-000000000003", P4 = "aaaaaaaa-0000-0000-0000-000000000004";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005", WESBOY = "bbbbbbbb-0000-0000-0000-000000000001";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);
const server = spawn(process.execPath, ["services/api/server.mjs"], { env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-kit" }, stdio: ["ignore", "pipe", "pipe"] });
const serverErr = []; server.stderr.on("data", (d) => serverErr.push(d.toString()));
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-kit" } })).body?.token;
const rows = async (path, tok) => (await api(path, { token: tok })).body?.rows ?? [];
const issue = (eq, tok, playerId) => api(`/api/equipment/${eq}/issue`, { method: "POST", token: tok, body: { playerId } });
const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
try {
  for (let i = 0; i < 60; i++) { try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const coach = await login("coach@example.invalid"), parent = await login("parent@example.invalid"), watcher = await login("watcher@example.invalid");
  const wes = await login("coach.wes@example.invalid"), registrar = await login("registrar@example.invalid");
  const head = await login("sarah@example.invalid");   // director of sport: team.manage, which a coach does not hold

  group("The drill library is the platform's and the school's");
  {
    const mine = await rows("/api/read/drills", coach);
    ok("a coach reads the platform's drills and his school's", mine.filter((d) => d.school_id === null).length === 10 && mine.some((d) => d.name === "Pavilion end yorkers"));
    ok("another school's coach reads the platform's, not Hilton's", !(await rows("/api/read/drills", wes)).some((d) => d.name === "Pavilion end yorkers"));
    ok("a spectator reads the platform's", (await rows("/api/read/drills", watcher)).length >= 10);
    const r = await api("/api/drills", { method: "POST", token: head, body: { schoolId: HIL, name: "Two-ball catching", category: "fielding", durationMin: 10 } });
    ok("the director of sport adds one for the school", r.status === 200 && (await q(`select created_by from drill where id = $1`, [r.body.id]))[0].created_by);
    ok("...a coach, who does not manage the side, cannot", [403, 401].includes((await api("/api/drills", { method: "POST", token: coach, body: { schoolId: HIL, name: "Coach drill", category: "fielding", durationMin: 10 } })).status));
    ok("...a spectator cannot", [403, 401].includes((await api("/api/drills", { method: "POST", token: watcher, body: { schoolId: HIL, name: "Nope drill", category: "fielding", durationMin: 10 } })).status));
    ok("...nor the director at another school", [403, 401].includes((await api("/api/drills", { method: "POST", token: head, body: { schoolId: "22222222-2222-2222-2222-222222222222", name: "Nope drill", category: "fielding", durationMin: 10 } })).status));
    ok("a category outside the vocabulary is refused", (await api("/api/drills", { method: "POST", token: head, body: { schoolId: HIL, name: "Nope", category: "yoga", durationMin: 10 } })).status === 400);
    ok("nobody writes a platform drill", !(await q(`set local role scrbrd_app; insert into drill (name, category, duration_min) values ('x y z', 'batting', 10)`).then(() => true).catch(() => false)));
  }

  group("Kit is the school's, and a boy holds it until he gives it back");
  {
    const kit = await rows("/api/read/equipment", coach);
    ok("the coach reads the school's kit, with how many are out", kit.length === 3 && kit.every((k) => k.out === 0));
    ok("another school's coach reads none of it", (await rows("/api/read/equipment", wes)).length === 0);
    const a = await issue(BATS, head, P1), b = await issue(BATS, head, P2), c = await issue(BATS, head, P3);
    ok("three bats go out to three boys", [a, b, c].every((r) => r.status === 200));
    const d = await issue(BATS, head, P4);
    ok("a fourth is refused: all three are out", d.status === 422 && /all 3/.test(d.body?.detail ?? ""));
    ok("...and the count says so", (await rows("/api/read/equipment", coach)).find((k) => k.id === BATS)?.out === 3);
    ok("kit is not issued to another school's boy", (await issue(MACHINE, head, WESBOY)).status === 422);
    ok("a coach, who does not manage the side, issues nothing", [403, 401].includes((await issue(MACHINE, coach, P1)).status));
    ok("a spectator issues nothing", [403, 401].includes((await issue(MACHINE, watcher, P1)).status));
    ok("the boy gives it back", (await api(`/api/equipment-issues/${a.body.id}/return`, { method: "POST", token: head })).body?.returned === 1);
    ok("...and the fourth boy gets it", (await issue(BATS, head, P4)).status === 200);
    ok("returning twice returns nothing", (await api(`/api/equipment-issues/${a.body.id}/return`, { method: "POST", token: head })).body?.returned === 0);
    await issue(MACHINE, registrar, PILLAY);
    const parents = await rows("/api/read/equipment_issues", parent);
    ok("a parent reads what their own child holds and nobody else's", parents.length === 1 && parents[0].player_id === PILLAY);
    ok("the coach reads the open issues, oldest returned last", (await rows("/api/read/equipment_issues", coach)).every((i) => i.returned_on === null) && (await rows("/api/read/equipment_issues?all=1", coach)).some((i) => i.returned_on !== null));
    ok("issued_by is stamped from the session", (await q(`select issued_by from equipment_issue where id = $1`, [b.body.id]))[0].issued_by === (await q(`select id from app_user where email = 'sarah@example.invalid'`))[0].id);
  }
  ok("the server logged no errors", serverErr.join("").trim() === "");
} catch (e) { fail++; console.log("  ✗ threw:", e.message); }
finally { server.kill(); await pool.end(); }
console.log(`\n${"─".repeat(52)}\nKIT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

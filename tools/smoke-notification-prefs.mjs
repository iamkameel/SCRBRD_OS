#!/usr/bin/env node
/**
 * NOTIFICATIONS S4 (D20, D21; db/120): a person switches push off for a kind,
 * or a parent for a kind about one of his children, and nobody else's —
 * through POST /api/notifications/prefs and GET /api/read/my_notification_prefs.
 *
 * What it walks: the switches each person is offered (a parent per child, a
 * pupil with his quiet hours, a coach); his own row written and read back;
 * another family's child refused; a body naming somebody else writes the
 * caller's own row; safeguarding, welfare and system refused in words; a
 * per-child row for a kind never about a child refused; and Notices the same
 * before and after a mute. db/99 §95 proves the table's rules beneath it;
 * services/api/notify/push-decision.test.mjs proves what a row does to a push.
 *
 *   node tools/smoke-notification-prefs.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
const PORT = port(8999), BASE = `http://127.0.0.1:${PORT}`;
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005", WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";
let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, /** @type {unknown} */ d = undefined) => {
  if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : JSON.stringify(d)); }
};
const group = (/** @type {string} */ t) => console.log("\n" + t);
const server = spawn(process.execPath, ["services/api/server.mjs"], { env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-notification-prefs" }, stdio: ["ignore", "pipe", "pipe"] });
/** @type {string[]} */
const serverErr = []; server.stderr.on("data", (d) => serverErr.push(d.toString()));
/** @param {string} path @param {{ method?: string, token?: string, body?: unknown }} [o] */
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (/** @type {string} */ email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-prefs" } })).body?.token;
/** @param {string} tok @returns {Promise<any[]>} */
const choices = async (tok) => (await api("/api/read/my_notification_prefs", { token: tok })).body?.rows ?? [];
/** @param {string} tok @param {Record<string, unknown>} body */
const set = (tok, body) => api("/api/notifications/prefs", { method: "POST", token: tok, body });
const line = (/** @type {any[]} */ rows) => rows.map((r) => `${r.kind}${r.subject_player_id ? "@" + (r.subject_player_id === PILLAY ? "P" : r.subject_player_id === WHITFIELD ? "W" : "?") : ""}${r.push ? "" : "(off)"}`).join(",");
const notices = async (/** @type {string} */ tok) => ((await api("/api/read/notifications", { token: tok })).body?.rows ?? []).map((/** @type {any} */ n) => n.id).sort().join(",");
const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (/** @type {string} */ t, /** @type {unknown[]} */ p = []) => (await pool.query(t, p)).rows;
const idOf = async (/** @type {string} */ email) => (await q(`select id from app_user where email = $1`, [email]))[0]?.id;
try {
  for (let i = 0; i < 60; i++) { try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  // A second run starts where the first did: no preferences for the walk's people.
  const people = ["parent@example.invalid", "parent.whitfield@example.invalid", "spectator@example.invalid", "coach@example.invalid"];
  await q(`delete from notification_pref where person_id in (select id from app_user where email = any($1))`, [people]);
  const parent = await login("parent@example.invalid"), otherMum = await login("parent.whitfield@example.invalid");
  const pupil = await login("spectator@example.invalid"), coach = await login("coach@example.invalid");
  const parentId = await idOf("parent@example.invalid"), otherMumId = await idOf("parent.whitfield@example.invalid");

  group("Each person is offered the switches D20 gives them, all on");
  {
    const p = await choices(parent);
    ok("a parent: notice and fixture for all, recognition, availability and lift for his own boy",
       line(p) === "notice,fixture,recognition@P,availability@P,lift@P", line(p));
    ok("...his boy named, and no other family's child", p.filter((r) => r.subject_player_id).every((r) => r.subject_player_id === PILLAY && !!r.player_name));
    ok("...and no quiet hours (an adult)", p.every((r) => r.quiet_hours === false));
    const o = await choices(otherMum);
    ok("the other mother: her own boy, not his", o.some((r) => r.subject_player_id === WHITFIELD) && !o.some((r) => r.subject_player_id === PILLAY), line(o));
    const s = await choices(pupil);
    ok("a pupil: notice, recognition, fixture, availability, nobody's child", line(s) === "notice,recognition,fixture,availability", line(s));
    ok("...and his quiet hours apply (D21)", s.length > 0 && s.every((r) => r.quiet_hours === true));
    const c = await choices(coach);
    ok("a coach: notice, recognition, fixture", line(c) === "notice,recognition,fixture", line(c));
    ok("...no quiet hours", c.every((r) => r.quiet_hours === false));
    ok("nobody signed in reads nothing", [401, 403].includes((await api("/api/read/my_notification_prefs")).status));
  }

  group("His own row, and nobody else's");
  {
    const before = await notices(parent);
    const r = await set(parent, { kind: "recognition", subjectPlayerId: PILLAY, push: false });
    ok("a parent switches recognition off for his boy", r.status === 200 && r.body?.push === false && r.body?.pushOnly === true, r);
    ok("...and reads it back off", line(await choices(parent)).includes("recognition@P(off)"));
    ok("...the rest still on", line(await choices(parent)) === "notice,fixture,recognition@P(off),availability@P,lift@P");
    ok("Notices reads the same list after the mute (D20: push only)", (await notices(parent)) === before);
    const whit = await set(parent, { kind: "recognition", subjectPlayerId: WHITFIELD, push: false });
    ok("another family's boy is refused", whit.status === 403, whit);
    ok("...a pupil cannot write one about a boy who is not him", (await set(pupil, { kind: "recognition", subjectPlayerId: PILLAY, push: false })).status === 403);
    ok("...nor a coach about a boy on his side", (await set(coach, { kind: "lift", subjectPlayerId: PILLAY, push: false })).status === 403);
    const forged = await set(parent, { kind: "fixture", push: false, personId: otherMumId, person_id: otherMumId });
    ok("a body naming the other mother writes the caller's own row", forged.status === 200);
    const rows = await q(`select person_id, kind, subject_player_id, push from notification_pref where person_id = any($1)`, [[parentId, otherMumId]]);
    ok("...two rows, both his", rows.length === 2 && rows.every((x) => x.person_id === parentId), rows);
    ok("...and the other mother's switches are untouched", !line(await choices(otherMum)).includes("(off)"));
    const again = await set(parent, { kind: "recognition", subjectPlayerId: PILLAY, push: true });
    ok("on again is the same row, not a second", again.status === 200 && again.body?.push === true
       && (await q(`select count(*)::int as n from notification_pref where person_id = $1`, [parentId]))[0].n === 2);
    ok("nobody signed in writes nothing", [401, 403].includes((await set("", { kind: "notice", push: false })).status));
  }

  group("Locked kinds, in words");
  {
    for (const kind of ["safeguarding", "welfare", "system"]) {
      const r = await set(parent, { kind, push: false });
      ok(`${kind} cannot be switched off`, r.status === 422 && r.body?.error === "kind_locked" && /Always on: safety and welfare notices\./.test(r.body?.detail ?? ""), r);
    }
    ok("an unknown kind is refused", (await set(parent, { kind: "gossip", push: false })).status === 400);
    ok("a notice is never about one child, so no per-child row for it",
       (await set(parent, { kind: "notice", subjectPlayerId: PILLAY, push: false })).body?.error === "kind_not_per_child");
    ok("push must be said", (await set(parent, { kind: "notice", push: "no" })).status === 400);
    ok("none of those wrote a row", (await q(`select count(*)::int as n from notification_pref where person_id = $1`, [parentId]))[0].n === 2);
  }
  ok("the server logged no errors", serverErr.join("").trim() === "", serverErr.join(""));
  await q(`delete from notification_pref where person_id in (select id from app_user where email = any($1))`, [people]);
} catch (/** @type {any} */ e) { fail++; console.log("  ✗ threw:", e.message); }
finally { server.kill(); await pool.end(); }
console.log(`\n${"─".repeat(52)}\nNOTIFICATION PREFS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

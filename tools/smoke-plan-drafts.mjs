#!/usr/bin/env node
/**
 * The coach's unsent plan over HTTP (db/110; Kameel, 15 Oct 2026, final):
 *   - a plan never sent is its author's to change and to delete;
 *   - a withdrawn plan is his to change and send again, never to delete;
 *   - a plan out with the side is not changed in place.
 * db/99 §87 proves the rules in the database; services/api/write/news-api.test.mjs
 * holds what the routes owe. This walks them as people: the 1XI's coach
 * (the author), the director of sport and the office (who are not), the
 * captain and his mother.
 *
 *   node tools/migrate.mjs --reset --seed && node tools/smoke-plan-drafts.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8997), BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d === "" ? "" : JSON.stringify(d)); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], { env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT),
  NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-plan-drafts" }, stdio: ["ignore", "pipe", "pipe"] });
/** @type {string[]} */
const serverErr = []; server.stderr.on("data", (d) => serverErr.push(d.toString()));
/** @param {string} path @param {{ method?: string, token?: string, body?: unknown }} [o] */
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: /** @type {any} */ (await res.json().catch(() => null)) };
};
/** @param {string} email */
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-plan-drafts" } })).body?.token;
const pool = new pg.Pool({ connectionString: ownerUrl() });
/** @param {string} t @param {unknown[]} [p] */
const q = async (t, p) => (await pool.query(t, p)).rows;
/** The row as the owner sees it, or null when it is gone. @param {string} id */
const row = async (id) => (await q(`select kind, body, urgency, published_at, first_sent_at from news_post where id = $1`, [id]))[0] ?? null;

try {
  for (let i = 0; i < 60; i++) { try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const coach = await login("coach@example.invalid"), director = await login("sarah@example.invalid"), office = await login("registrar@example.invalid");
  const captain = await login("pillay@example.invalid"), mother = await login("parent@example.invalid");
  const FIX = (await q(`select id from match where school_id = $1 and team_code = '1XI' and starts_at > now() order by starts_at limit 1`, [HIL]))[0]?.id;
  ok("the walk has the 1XI's next fixture to plan for", !!FIX);
  const write = (/** @type {string} */ body, publish = false) => api("/api/news", { method: "POST", token: coach, body: {
    scope: "team", schoolId: HIL, teamCode: "1XI", kind: "plan", fixtureId: FIX, title: "The plan: v the visitors", body, publish } });
  /** @param {string} token @param {string} id @param {unknown} body */
  const edit = (token, id, body) => api(`/api/news/${id}/edit`, { method: "POST", token, body });
  /** @param {string} token @param {string} id */
  const del = (token, id) => api(`/api/news/${id}/delete`, { method: "POST", token, body: {} });

  group("A plan never sent: its author's to change and to delete");
  {
    const d = await write("Bat first if we win it.");
    ok("the coach saves a draft plan", d.status === 200 && d.body?.published === false, d.body);
    const D = d.body?.id;
    const e = await edit(coach, D, { body: "Bowl first if we win it.", urgency: "medium" });
    ok("he changes its words and how loud it goes", e.status === 200 && e.body?.published === false && e.body?.wasSent === false, e.body);
    const r = await row(D);
    ok("...and it is stored so, still never sent", r?.body === "Bowl first if we win it." && r?.urgency === "medium" && r?.published_at === null && r?.first_sent_at === null, r);
    const mine = (await api(`/api/read/news?fixtureId=${FIX}`, { token: coach })).body?.rows ?? [];
    ok("...his read says it was never sent", mine.some((n) => n.id === D && n.wasSent === false && n.urgency === "medium"), mine.map((n) => [n.id === D, n.wasSent]));
    for (const [who, token] of [["the director of sport", director], ["the office", office], ["the captain", captain], ["his mother", mother]]) {
      const x = await edit(token, D, { body: "Not theirs to change." });
      const y = await del(token, D);
      ok(`${who} can neither change it nor delete it (no such draft)`, x.status === 404 && y.status === 404 && (await row(D))?.body === "Bowl first if we win it.", [x.status, y.status]);
    }
    const w = await edit(coach, D, { body: "Rest Naidoo, his hamstring." });
    ok("a change with a refused word is refused, the word named, nothing changed", w.status === 422 && w.body?.words?.[0]?.word === "hamstring"
       && (await row(D))?.body === "Bowl first if we win it.", w.body);
    const gone = await del(coach, D);
    ok("he deletes it", gone.status === 200 && gone.body?.deleted === true && (await row(D)) === null, gone.body);
    ok("...a second delete finds nothing", (await del(coach, D)).status === 404);
  }

  group("A plan out with the side: not changed in place, and kept");
  /** @type {string} */
  let P = "";
  {
    const s = await write("Bat first if we win it. Captain opens.", true);
    P = s.body?.id;
    ok("the coach sends a plan", s.status === 200 && s.body?.published === true, s.body);
    const r0 = await row(P);
    ok("...dated when it went", r0?.first_sent_at !== null && String(r0?.first_sent_at) === String(r0?.published_at), r0);
    const e = await edit(coach, P, { body: "Bowl first after all." });
    ok("changing it while it is out is refused, in words: withdraw it first", e.status === 409 && e.body?.error === "plan_sent" && /Withdraw it first/.test(e.body?.message ?? ""), e.body);
    const d = await del(coach, P);
    ok("deleting it is refused: a plan that was sent is kept", d.status === 409 && d.body?.error === "plan_kept" && /cannot be deleted/.test(d.body?.message ?? ""), d.body);
    ok("...and it stands as sent", (await row(P))?.body === "Bat first if we win it. Captain opens.");
  }

  group("A withdrawn plan: changed and sent again, never deleted");
  {
    const w = await api(`/api/news/${P}/withdraw`, { method: "POST", token: coach, body: {} });
    ok("the coach withdraws it", w.status === 200 && w.body?.published === false, w.body);
    const r1 = await row(P);
    ok("...it keeps its first date", r1?.published_at === null && r1?.first_sent_at !== null, r1);
    const mine = (await api(`/api/read/news?fixtureId=${FIX}`, { token: coach })).body?.rows ?? [];
    ok("...his read says it was sent once", mine.some((n) => n.id === P && n.wasSent === true && n.published_at === null));
    const d = await del(coach, P);
    ok("deleting it is refused: kept", d.status === 409 && d.body?.error === "plan_kept" && (await row(P)) !== null, d.body);
    const x = await edit(director, P, { body: "Not hers to change." });
    ok("the director of sport cannot change it", x.status === 404 && (await row(P))?.body === "Bat first if we win it. Captain opens.");
    const e = await edit(coach, P, { body: "Bowl first after all. Captain opens.", send: true });
    ok("the coach changes it and sends it again, in one go", e.status === 200 && e.body?.published === true && e.body?.wasSent === true, e.body);
    const r2 = await row(P);
    ok("...live, with the new words, its first date where it was", r2?.published_at !== null && r2?.body === "Bowl first after all. Captain opens."
       && String(r2?.first_sent_at) === String(r1?.first_sent_at), r2);
    const sent = await q(`select body, retracted_at is not null as retracted from notification
                           where kind = 'notice' and subject_kind = 'news' and subject_id = $1 and retracts_id is null
                           order by published_at, (retracted_at is null)`, [P]);
    ok("both sendings stand in its notices: the first retracted with its words, the second live with the new",
       sent.length === 2 && sent[0].body === "Bat first if we win it. Captain opens." && sent[0].retracted === true
       && sent[1].body === "Bowl first after all. Captain opens." && sent[1].retracted === false, sent);
    const theirs = (await api(`/api/read/news?fixtureId=${FIX}`, { token: captain })).body?.rows ?? [];
    ok("the captain reads the plan sent again, its author named", theirs.length === 1 && theirs[0].body === "Bowl first after all. Captain opens."
       && theirs[0].author_name === "C Hendricks", theirs.map((n) => [n.body, n.author_name]));
  }

  ok("the server logged no errors", serverErr.join("").trim() === "", serverErr.join("").slice(0, 300));
} catch (/** @type {any} */ e) { fail++; console.log("  ✗ threw:", e.message); }
finally { server.kill(); await pool.end(); }
console.log(`\n${"─".repeat(52)}\nPLAN DRAFTS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

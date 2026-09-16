#!/usr/bin/env node
/**
 * A retry writes once.
 *
 * Every write route now honours an Idempotency-Key header (db/15, the
 * dispatcher in server.mjs). This walk sends the same newsfeed post twice
 * with the same key on a route that had no natural unique key at all — the
 * one that showed a parent the same post twice — and reads how many rows
 * there are.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-idempotency.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8887, BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-idempotency-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
const api = async (path, { method = "GET", token, body, headers = {} } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, replayed: res.headers.get("idempotent-replayed") === "true", body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-idem" } })).body?.token;
const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const stamp = Date.now();
const post = (token, key, title, teamCode = "1XI") => api("/api/news", { method: "POST", token, headers: key ? { "idempotency-key": key } : {},
  body: { scope: "team", schoolId: "11111111-1111-1111-1111-111111111111", teamCode, title, body: "Bus leaves 07:00.", publish: true } });

try {
  for (let i = 0; i < 60; i++) { try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  const coach = await login("coach@example.invalid");
  const coach2 = await login("coach2@example.invalid");
  const rows = (title) => q(`select id from news_post where title = $1`, [title]);

  group("The same key twice is one post");
  const title = `Away day ${stamp}`;
  const first = await post(coach, `idem-${stamp}-1`, title);
  ok("the first post lands", first.status === 200 && first.body?.id, JSON.stringify(first.body));
  const second = await post(coach, `idem-${stamp}-1`, title);
  ok("the retry gets the same answer", second.status === 200 && second.body?.id === first.body?.id, JSON.stringify(second.body));
  ok("...marked as a replay", second.replayed === true && first.replayed === false);
  ok("...and there is ONE row", (await rows(title)).length === 1, `${(await rows(title)).length} rows`);

  group("Without a key, the old behaviour: twice is twice");
  const t2 = `Kit day ${stamp}`;
  await post(coach, null, t2); await post(coach, null, t2);
  ok("two posts, two rows", (await rows(t2)).length === 2);

  group("A key is the person's, not the platform's");
  const t3 = `Fixture change ${stamp}`;
  const other = await post(coach2, `idem-${stamp}-1`, t3, "2XI");   // the 2XI coach reuses the 1XI coach's key text, on their own team
  ok("another person with the same key text is not handed the first person's receipt", other.status === 200 && other.body?.id !== first.body?.id, JSON.stringify(other.body));
  ok("...and their post is real", (await rows(t3)).length === 1);

  group("A key reused for a different request is refused, not answered");
  const wrong = await api(`/api/news/${first.body.id}/withdraw`, { method: "POST", token: coach, headers: { "idempotency-key": `idem-${stamp}-1` } });
  ok("422 idempotency_key_reused", wrong.status === 422 && wrong.body?.error === "idempotency_key_reused", JSON.stringify(wrong.body));
  const stillThere = await q(`select published_at from news_post where id = $1`, [first.body.id]);
  ok("...and the withdraw did not run", stillThere[0]?.published_at != null);

  group("A refusal is remembered too — the handler does not run twice to say no twice");
  const bad = await api("/api/news", { method: "POST", token: coach, headers: { "idempotency-key": `idem-${stamp}-bad` }, body: { scope: "team", title: "" } });
  const badAgain = await api("/api/news", { method: "POST", token: coach, headers: { "idempotency-key": `idem-${stamp}-bad` }, body: { scope: "team", title: "" } });
  ok("a 4xx replays as the same 4xx", bad.status >= 400 && bad.status < 500 && badAgain.status === bad.status && badAgain.replayed === true, `${bad.status} then ${badAgain.status}`);

  group("The receipt is stored under the person, and only they can read it");
  const receipts = await q(`select person_id, route, status from request_replay where key = $1`, [`idem-${stamp}-1`]);
  ok("two receipts for the shared key text — one per person", receipts.length === 2 && new Set(receipts.map((r) => r.person_id)).size === 2, JSON.stringify(receipts));
  ok("...each naming the route", receipts.every((r) => r.route === "POST /api/news"), JSON.stringify(receipts.map((r) => r.route)));
} catch (e) {
  ok(`the idempotency walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}
if (fail && serverErr.length) { console.log("\nServer stderr:"); console.log(serverErr.join("").split("\n").slice(0, 12).join("\n")); }
console.log(`\n${"─".repeat(52)}\nIDEMPOTENCY SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

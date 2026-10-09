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
 * And the three ways the first version of that layer still wrote twice or
 * answered wrongly (GA-I01): eight copies of one keyed post sent AT ONCE,
 * which all found no receipt and all wrote; the same key sent with a changed
 * body, which was answered from the first body's receipt as if saved; and a
 * crash after the post committed but before its receipt did, which left the
 * post and no receipt, so the retry wrote a second. The crash is real: the
 * walk holds request_replay so the receipt cannot be written, waits until
 * the server is stuck exactly there, and SIGKILLs it.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-idempotency.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8887), BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const serverErr = [];
// Started twice: once, and again after the crash below kills it.
const start = () => {
  const s = spawn(process.execPath, ["services/api/server.mjs"], {
    env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-idempotency-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  s.stderr.on("data", (d) => serverErr.push(d.toString()));
  return s;
};
let server = start();
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async () => { for (let i = 0; i < 60; i++) { try { const r = await api("/api/health"); if (r.body?.db === "ok") return; } catch { /* not up */ } await sleep(250); } };

try {
  await up();
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
  // Since S2 a sent post writes its notice (db/91's trigger): a retry is one
  // post, so it is one notice in everybody's Notices, not two.
  const notices = await q(`select count(*)::int c from notification where kind = 'notice' and subject_kind = 'news' and subject_id = $1`, [first.body?.id]);
  ok("...and ONE notice", notices[0]?.c === 1, `${notices[0]?.c} notices`);

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
  // The route, then the request's fingerprint: what the key was spent on.
  ok("...each naming the route and the request's fingerprint",
     receipts.every((r) => /^POST \/api\/news sha256:[0-9a-f]{64}$/.test(r.route)), JSON.stringify(receipts.map((r) => r.route)));

  group("Eight copies of one keyed post, sent at once, are one post");
  {
    const t = `Burst ${stamp}`;
    // The race made certain rather than likely: each insert takes 300 ms, so
    // all eight are in flight together. Without this the first could finish
    // while the other seven were still opening connections, and the walk
    // passed against the code it exists to catch.
    await q(`create or replace function _slow_news() returns trigger as $$ begin perform pg_sleep(0.3); return new; end $$ language plpgsql`);
    await q(`create trigger slow_news before insert on news_post for each row execute function _slow_news()`);
    const burst = await Promise.all(Array.from({ length: 8 }, () => post(coach, `idem-${stamp}-burst`, t)));
    await q(`drop trigger slow_news on news_post; drop function _slow_news()`);
    const n = (await rows(t)).length;
    ok("exactly one notice", n === 1, `${n} notices`);
    const ids = new Set(burst.map((r) => r.body?.id));
    ok("all eight answered 200 with the same notice", burst.every((r) => r.status === 200) && ids.size === 1,
       JSON.stringify(burst.map((r) => [r.status, r.body?.id ?? r.body?.error])));
    ok("...one of them written, seven replayed", burst.filter((r) => !r.replayed).length === 1,
       `${burst.filter((r) => !r.replayed).length} not replayed`);
  }

  group("The same key with a changed body is refused, not answered from the first");
  {
    const key = `idem-${stamp}-changed`, t = `Original ${stamp}`, t2 = `Changed ${stamp}`;
    const first = await post(coach, key, t);
    ok("the first post lands", first.status === 200 && first.body?.id);
    const changed = await post(coach, key, t2);
    ok("422 idempotency_key_payload_mismatch", changed.status === 422 && changed.body?.error === "idempotency_key_payload_mismatch",
       `${changed.status} ${JSON.stringify(changed.body)}`);
    ok("...not passed off as a replay of the first", changed.replayed === false);
    ok("...and the changed post was not written", (await rows(t2)).length === 0);
    // The fingerprint is of the request, not of its spelling: the same fields
    // in another order are the same post.
    const reordered = await api("/api/news", { method: "POST", token: coach, headers: { "idempotency-key": key },
      body: { publish: true, body: "Bus leaves 07:00.", title: t, teamCode: "1XI", schoolId: "11111111-1111-1111-1111-111111111111", scope: "team" } });
    ok("the same body with its fields reordered replays the first answer",
       reordered.status === 200 && reordered.replayed && reordered.body?.id === first.body?.id, JSON.stringify(reordered.body));
    ok("...one row", (await rows(t)).length === 1);
  }

  group("Every deferrable check starts deferred (a keyed write puts ALL DEFERRED back after each call)");
  {
    const early = await q(`select conrelid::regclass::text t, conname from pg_constraint where condeferrable and not condeferred`);
    ok("no DEFERRABLE INITIALLY IMMEDIATE constraint or constraint trigger in the schema", early.length === 0,
       `${JSON.stringify(early)} — auth-db.mjs runAsUnit must restore these by name instead`);
  }

  group("A crash between the post and its receipt: nothing saved, nothing acknowledged, the retry writes once");
  {
    const key = `idem-${stamp}-crash`, t = `Crash ${stamp}`;
    // Hold request_replay so no receipt can be written. EXCLUSIVE lets a
    // SELECT through (the receipt lookup) and stops an INSERT.
    const holder = await pool.connect();
    await holder.query("begin");
    await holder.query("lock table request_replay in exclusive mode");
    const sent = post(coach, key, t).then((r) => ({ r }), (e) => ({ e }));
    let stuck = false;
    for (let i = 0; i < 80 && !stuck; i++) {
      stuck = (await q(`select count(*)::int n from pg_locks l join pg_class c on c.oid = l.relation
                         where c.relname = 'request_replay' and not l.granted`))[0].n > 0;
      if (!stuck) await sleep(100);
    }
    ok("the server reached the receipt (the post is written, the receipt is not)", stuck);
    const died = new Promise((r) => server.once("exit", r));
    server.kill("SIGKILL");
    await died;
    await holder.query("rollback");
    holder.release();
    const answer = await sent;
    ok("the client was never told it was saved", !answer.r || answer.r.status >= 500, JSON.stringify(answer.r?.body));
    // The dead server's backend ends its transaction once it finds its
    // client gone; wait for that before counting.
    for (let i = 0; i < 50; i++) {
      if (!(await q(`select 1 from pg_stat_activity where datname = current_database() and usename = 'scrbrd_app'`)).length) break;
      await sleep(100);
    }
    ok("no notice outlived the crash without its receipt", (await rows(t)).length === 0, `${(await rows(t)).length} notices`);
    server = start();
    await up();
    const retry = await post(coach, key, t);
    ok("the retry writes it", retry.status === 200 && retry.body?.id && !retry.replayed, JSON.stringify(retry.body));
    ok("...once", (await rows(t)).length === 1, `${(await rows(t)).length} notices`);
    const again = await post(coach, key, t);
    ok("...and the next retry is answered from its receipt", again.replayed && again.body?.id === retry.body?.id);
    ok("...still one notice", (await rows(t)).length === 1);
  }
} catch (e) {
  ok(`the idempotency walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}
if (fail && serverErr.length) { console.log("\nServer stderr:"); console.log(serverErr.join("").split("\n").slice(0, 12).join("\n")); }
console.log(`\n${"─".repeat(52)}\nIDEMPOTENCY SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

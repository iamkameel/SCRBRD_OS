#!/usr/bin/env node
/**
 * A post's urgency and its withdrawal door: notifications slice S2
 * (docs/design/NOTIFICATIONS.md D9, D10, D11), with no database.
 *
 * The route validates shape and hands the row to Postgres; db/91's trigger
 * writes the notice and news_post_withdraw() decides who may take a post
 * back. So this holds what the route itself owes: an urgency that is never
 * "high" reaches no connection, the one it accepts is the one it inserts,
 * and a withdrawal asks the function, with the post's id and nothing else.
 * db/99 §70 and tools/smoke-push.mjs walk the rest against a real database.
 *
 *   node services/api/write/news-api.test.mjs
 */
import { newsRoutes, URGENCY } from "./news-api.mjs";
import { signToken } from "../auth/auth.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const SECRET = "news-api-test-secret";
const USER = "00000000-0000-4000-8000-000000000001";
const SESSION = "00000000-0000-4000-8000-0000000000aa";
const BEARER = `Bearer ${signToken({ userId: USER, deviceId: "test-device", sessionId: SESSION, epoch: 0 }, SECRET)}`;
const SCHOOL = "11111111-1111-1111-1111-111111111111";
const POST = "33333333-3333-4333-8333-333333333333";

/** A pool that fails the test if anything takes a connection from it. */
const untouchable = {
  touched: false,
  async connect() { this.touched = true; throw new Error("the pool was touched"); },
  async query() { this.touched = true; throw new Error("the pool was touched"); },
};

/** @param {{ withdraw?: any }} o */
function fakePool({ withdraw = null } = {}) {
  /** @type {{ sql: string, params: any[] }[]} */
  const asked = [];
  const client = {
    async query(/** @type {string} */ sql, /** @type {any[]} */ params = []) {
      asked.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
      if (sql.includes("app_session_begin")) return { rows: [{}] };
      if (sql.includes("insert into news_post")) {
        return { rows: [{ id: POST, scope: params[0], published_at: params[6] ? new Date(0) : null, urgency: params[7] }] };
      }
      if (sql.includes("news_post_withdraw(")) return { rows: withdraw ? [withdraw] : [] };
      throw new Error("unexpected statement: " + sql.slice(0, 60));
    },
    release() {},
  };
  return { asked, async connect() { return client; }, async query() { throw new Error("pool.query"); } };
}

/** Run a handler as the server would, and keep what it answered. */
async function call(/** @type {any} */ handler, /** @type {any} */ body, headers = {}, params = {}) {
  const out = { status: 200, body: /** @type {any} */ (null) };
  const res = {
    status(/** @type {number} */ s) { out.status = s; return res; },
    json(/** @type {any} */ b) { out.body = b; return res; },
  };
  await handler({ body, headers, params }, res);
  return out;
}

const post = (/** @type {Record<string, unknown>} */ extra = {}) => ({
  scope: "school", schoolId: SCHOOL, title: "Nets moved", body: "Nets are on the B field this week.", ...extra });

group("A. How loud a post is (D9)");
{
  ok("low and medium, never high", URGENCY.join() === "low,medium");
  const routes = newsRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET });
  for (const urgency of ["high", "HIGH", "screaming", 2]) {
    const r = await call(routes.publish, post({ urgency }), { authorization: BEARER });
    ok(`urgency ${JSON.stringify(urgency)} is refused`, r.status === 400 && r.body?.error === "urgency_invalid");
  }
  ok("...before any connection", untouchable.touched === false);

  for (const [given, stored] of /** @type {[unknown, string][]} */ ([[undefined, "low"], [null, "low"], ["", "low"], ["low", "low"], ["medium", "medium"]])) {
    const pool = fakePool();
    const r = await call(newsRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).publish,
                         post(given === undefined ? {} : { urgency: given }), { authorization: BEARER });
    const ins = pool.asked.find((a) => a.sql.includes("insert into news_post"));
    ok(`urgency ${JSON.stringify(given)} is inserted as ${stored}`, r.status === 200 && ins?.params[7] === stored && r.body?.urgency === stored);
  }
  // The route writes no notice: the post's trigger does (db/91).
  const pool = fakePool();
  await call(newsRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).publish, post({ urgency: "medium" }), { authorization: BEARER });
  ok("the route itself writes no notice", !pool.asked.some((a) => /notification/.test(a.sql)));
}

group("B. Withdrawing a post asks news_post_withdraw() (D11)");
{
  const routes = newsRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET });
  const bad = await call(routes.withdraw, undefined, { authorization: BEARER }, { id: "x'; drop table news_post; --" });
  ok("an id that is no uuid is no notice, before any connection", bad.status === 404 && bad.body?.error === "no_such_notice" && untouchable.touched === false);

  /** @type {any[]} */
  const changed = [];
  const taken = fakePool({ withdraw: { ok: true, reason: null } });
  const r = await call(newsRoutes({ pool: /** @type {any} */ (taken), secret: SECRET, onChange: (n) => changed.push(n) }).withdraw,
                       undefined, { authorization: BEARER }, { id: POST.toUpperCase() });
  ok("a withdrawal the function allows is taken", r.status === 200 && r.body?.id === POST && r.body?.published === false);
  const asked = taken.asked.find((a) => a.sql.includes("news_post_withdraw("));
  ok("...asked of the function, with the post's id", !!asked && asked.params.join() === POST);
  ok("...not by an UPDATE of its own", !taken.asked.some((a) => /update news_post/i.test(a.sql)));
  ok("...and the public cache is told", changed.length === 1 && changed[0].k === "news" && changed[0].id === POST);

  const refused = fakePool({ withdraw: { ok: false, reason: "no_such_notice" } });
  /** @type {any[]} */
  const quiet = [];
  const x = await call(newsRoutes({ pool: /** @type {any} */ (refused), secret: SECRET, onChange: (n) => quiet.push(n) }).withdraw,
                       undefined, { authorization: BEARER }, { id: POST });
  ok("somebody who may not is told there is no such notice", x.status === 404 && x.body?.error === "no_such_notice");
  ok("...and nothing is told it changed", quiet.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

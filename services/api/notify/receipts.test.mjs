#!/usr/bin/env node
/**
 * Opening a notice and "Mark all read" (NOTIFICATIONS.md D16, D17), with no
 * database: a fake client answers what receipts-api.mjs asks and keeps a list,
 * so the test can say what was written and what was not. db/99 §68 proves the
 * same rules in Postgres (a receipt is the reader's own, for a notice he can
 * see; the stub; the logged open); tools/smoke-summary.mjs walks them through
 * the running API on two devices.
 *
 *   node services/api/notify/receipts.test.mjs
 */
import { receiptRoutes, GONE } from "./receipts-api.mjs";
import { signToken } from "../auth/auth.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const SECRET = "receipts-test-secret";
const USER = "00000000-0000-4000-8000-000000000001";
const SESSION = "00000000-0000-4000-8000-0000000000aa";
const BEARER = `Bearer ${signToken({ userId: USER, deviceId: "test-device", sessionId: SESSION, epoch: 0 }, SECRET)}`;
const NOTICE = "22222222-2222-4222-8222-222222222222";

/**
 * @param {{ notice?: any, unread?: number, marked?: number }} o
 */
function fakePool({ notice = null, unread = 3, marked = 2 } = {}) {
  /** @type {{ sql: string, params: any[] }[]} */
  const asked = [];
  const client = {
    async query(/** @type {string} */ sql, /** @type {any[]} */ params = []) {
      asked.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
      if (sql.includes("app_session_begin")) return { rows: [{}] };
      if (sql.includes("notification_by_id(")) return { rows: [{ notice }] };
      if (sql.includes("insert into notification_read")) return { rows: [], rowCount: marked };
      if (sql.includes("from my_notifications where not read")) return { rows: [{ unread }] };
      throw new Error("unexpected statement: " + sql.slice(0, 60));
    },
    release() {},
  };
  return { asked, async connect() { return client; }, async query() { throw new Error("pool.query"); } };
}
/** A pool that fails the test if anything takes a connection from it. */
const untouchable = { touched: false,
  async connect() { this.touched = true; throw new Error("touched"); }, async query() { this.touched = true; throw new Error("touched"); } };

async function call(/** @type {any} */ handler, /** @type {any} */ params, headers = { authorization: BEARER }) {
  const out = { status: 200, body: /** @type {any} */ (null) };
  const res = {
    status(/** @type {number} */ s) { out.status = s; return res; },
    json(/** @type {any} */ b) { out.body = b; return res; },
  };
  await handler({ body: {}, headers, params }, res);
  return out;
}
const inserts = (/** @type {any} */ pool) => pool.asked.filter((/** @type {any} */ a) => a.sql.includes("insert into notification_read"));

group("A. Opening a notice reads it and marks it read, as the reader");
{
  const row = { id: NOTICE, withdrawn: false, kind: "injury", title: "Injury recorded", body: "The body.", tiered: true, read: false };
  const pool = fakePool({ notice: row, unread: 4 });
  const r = await call(receiptRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).open, { id: NOTICE });
  ok("the notice comes back with its body", r.status === 200 && r.body?.notice?.body === "The body.");
  ok("...marked read", r.body?.notice?.read === true);
  ok("...with the reader's unread count from the view", r.body?.unread === 4);
  const ins = inserts(pool);
  ok("one receipt is written", ins.length === 1);
  ok("...for this notice", ins[0]?.params[0] === NOTICE);
  ok("...as app_user_id(), never an id from the request", /values \(\$1::uuid, app_user_id\(\)\)/.test(ins[0]?.sql ?? ""));
  ok("...once: a second open writes nothing new", /on conflict do nothing/.test(ins[0]?.sql ?? ""));
  ok("the body is read through notification_by_id() (it logs a tiered open)",
     pool.asked.some((a) => a.sql.includes("notification_by_id($1::uuid)")));
  ok("everything ran in one transaction", pool.asked.some((a) => a.sql.trim() === "BEGIN") && pool.asked.some((a) => a.sql.trim() === "COMMIT"));
}

group("B. Not yours, expired, never existed: one answer (D16)");
{
  const pool = fakePool({ notice: null });
  const r = await call(receiptRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).open, { id: NOTICE });
  ok("404", r.status === 404);
  ok("...in D16's one sentence", r.body?.error === "no_such_notification" && r.body?.detail === GONE);
  ok("...and no receipt is written", inserts(pool).length === 0);
  const bad = await call(receiptRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET }).open, { id: "not-a-uuid" });
  ok("a malformed id is the same answer", bad.status === 404 && bad.body?.detail === GONE);
  ok("...decided before a connection is taken", !untouchable.touched);
}

group("C. A retracted notice opens as its stub, and is not marked (D19)");
{
  const stub = { id: NOTICE, withdrawn: true, retracted_at: "2026-10-03T08:00:00Z", withdrawal_id: null };
  const pool = fakePool({ notice: stub, unread: 1 });
  const r = await call(receiptRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).open, { id: NOTICE });
  ok("the stub comes back as the database said it", r.status === 200 && r.body?.notice?.withdrawn === true
     && !("title" in r.body.notice) && !("body" in r.body.notice));
  ok("...with the count", r.body?.unread === 1);
  ok("...and no receipt", inserts(pool).length === 0);
}

group("D. Mark all read: the reader's own list");
{
  const pool = fakePool({ marked: 5, unread: 0 });
  const r = await call(receiptRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).readAll, {});
  ok("answers how many it marked, and the count after", r.status === 200 && r.body?.marked === 5 && r.body?.unread === 0);
  const ins = inserts(pool)[0]?.sql ?? "";
  ok("...from my_notifications, the reader's own list", /select id, app_user_id\(\) from my_notifications where not read/.test(ins));
  ok("...never naming a person from the request", !/\$\d/.test(ins));
  ok("...once", /on conflict do nothing/.test(ins));
}

group("E. Signed out");
{
  const pool = fakePool({ notice: { id: NOTICE, withdrawn: false } });
  const r = await call(receiptRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).readAll, {}, {});
  ok("no token, no receipt", r.status === 401 && inserts(pool).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

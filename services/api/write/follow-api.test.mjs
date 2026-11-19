#!/usr/bin/env node
/**
 * The follow list's routes (EXPERIENCE_PASS Q8, slice 3b; db/160), with no
 * database: every refusal follow_school() can answer has a status here; a
 * caller with no session reaches nothing; the list is read as the caller and
 * nobody else; the Today is the public pages' own list, kept to the caller's
 * schools by their codes, and asks the database nothing about anybody else.
 *
 * What db/160 decides (whose rows, which school, the limit) is proved live
 * by db/99 §137; the filter's own rule by services/api/public/public.test.mjs.
 *
 *   node services/api/write/follow-api.test.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { followRoutes, FOLLOW_STATUS, followedRow } from "./follow-api.mjs";
import { signToken } from "../auth/auth.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, typeof d === "string" ? d : JSON.stringify(d)); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SQL = readFileSync(join(ROOT, "db", "160_followed_schools.sql"), "utf8");
const SECRET = "follow-api-test-secret";
const USER = "00000000-0000-4000-8000-0000000000f1";
const BEARER = `Bearer ${signToken({ userId: USER, deviceId: "test-device", sessionId: "00000000-0000-4000-8000-0000000000aa", epoch: 0 }, SECRET)}`;
const V160 = "33333333-3333-4333-8333-333333333160";

/**
 * A pool whose client answers db/160's doors and remembers every statement
 * and the principal it ran as.
 * @param {{ follow?: any, list?: any[], removed?: number }} o
 */
function fakePool({ follow = { ok: true, reason: null, school_id: V160, school_name: "Verify Onesixty College" }, list = [], removed = 1 } = {}) {
  /** @type {{ sql: string, params: any[] }[]} */
  const asked = [];
  /** @type {string[]} */
  const users = [];
  const client = {
    async query(/** @type {string} */ sql, /** @type {any[]} */ params = []) {
      asked.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim()) || /savepoint/i.test(sql)) return { rows: [] };
      if (sql.includes("app_session_begin")) { users.push(params[0]); return { rows: [{}] }; }
      if (/set_config/.test(sql)) return { rows: [] };
      if (sql.includes("from follow_school(")) return { rows: follow ? [follow] : [] };
      if (sql.includes("from followed_schools()")) return { rows: list };
      if (sql.includes("delete from followed_school")) return { rows: [], rowCount: removed };
      throw new Error("unexpected statement: " + sql.slice(0, 80));
    },
    release() {},
  };
  return { asked, users, touched: () => asked.length > 0, async connect() { return client; }, async query() { throw new Error("pool.query"); } };
}

async function call(/** @type {any} */ handler, /** @type {any} */ body = {}, headers = {}, params = {}) {
  const out = { status: 200, body: /** @type {any} */ (null) };
  const res = { status(/** @type {number} */ s) { out.status = s; return res; }, json(/** @type {any} */ b) { out.body = b; return res; } };
  await handler({ body, headers, params }, res);
  return out;
}

/** @type {string[][]} */
let todayAsked = [];
const today = async (/** @type {string[]} */ codes) => {
  todayAsked.push(codes);
  const all = [{ id: "f1", side: "V160" }, { id: "f2", side: "WES" }, { id: "f3", side: "HIL" }];
  return { asOf: "2026-11-15", fixtures: all.filter((f) => codes.includes(f.side)) };
};

group("A. Every refusal db/160's door answers has a status");
{
  const reasons = [...new Set([...SQL.matchAll(/SELECT false, '([a-z_]+)'/g)].map((m) => m[1]))];
  ok("follow_school() names its refusals", reasons.length >= 4, reasons.join());
  for (const r of reasons) ok(`${r} has a status`, Number.isInteger(FOLLOW_STATUS[r]) && FOLLOW_STATUS[r] >= 400);
  for (const r of Object.keys(FOLLOW_STATUS)) ok(`${r} is a refusal db/160 answers`, reasons.includes(r));
  ok("a row reads as id, code, name and the day, nothing else",
     JSON.stringify(followedRow({ school_id: V160, code: "V160", name: "Verify Onesixty College", followed_on: "2026-11-15", extra: "x" }))
     === JSON.stringify({ id: V160, code: "V160", name: "Verify Onesixty College", since: "2026-11-15" }));
}

group("B. Signed out, nothing is reached");
{
  const pool = fakePool();
  const routes = followRoutes({ pool: /** @type {any} */ (pool), secret: SECRET, today });
  todayAsked = [];
  for (const [name, h, body, params] of /** @type {[string, any, any, any][]} */ ([
    ["list", routes.list, {}, {}], ["follow", routes.follow, { code: "V160" }, {}],
    ["unfollow", routes.unfollow, {}, { id: V160 }], ["today", routes.today, {}, {}]])) {
    const r = await call(h, body, {}, params);
    ok(`${name} with no token is 401`, r.status === 401, r);
  }
  ok("...and no statement ran, and no public list was asked for", !pool.touched() && todayAsked.length === 0);
}

group("C. Following, as the caller");
{
  const pool = fakePool();
  const routes = followRoutes({ pool: /** @type {any} */ (pool), secret: SECRET, today });
  const r = await call(routes.follow, { code: " V160 " }, { authorization: BEARER });
  ok("a code follows, and the school is named", r.status === 200 && r.body.ok === true && r.body.school.name === "Verify Onesixty College" && r.body.school.id === V160, r.body);
  const q = pool.asked.find((a) => a.sql.includes("follow_school("));
  ok("...through db/160's door, with the code trimmed and following true", !!q && q.params.length === 1 && q.params[0] === "V160" && /follow_school\(\$1, true\)/.test(q.sql), q);
  ok("...as the signed-in caller", pool.users.length === 1 && pool.users[0] === USER, pool.users);
  for (const bad of ["", "  ", "V160; drop table school", "x".repeat(40), 7, null]) {
    const before = pool.asked.length;
    const b = await call(routes.follow, { code: bad }, { authorization: BEARER });
    ok(`a code ${JSON.stringify(bad)} is not a school, and asks nothing`, b.status === 404 && b.body.error === "no_such_school" && pool.asked.length === before, b);
  }
  for (const [reason, status] of Object.entries(FOLLOW_STATUS)) {
    const p = fakePool({ follow: { ok: false, reason, school_id: null, school_name: null } });
    const x = await call(followRoutes({ pool: /** @type {any} */ (p), secret: SECRET, today }).follow, { code: "V160" }, { authorization: BEARER });
    ok(`${reason} is ${status}`, x.status === status && x.body.error === reason, x);
  }
}

group("D. The list, and stopping");
{
  const pool = fakePool({ list: [{ school_id: V160, code: "V160", name: "Verify Onesixty College", followed_on: "2026-11-15" }] });
  const routes = followRoutes({ pool: /** @type {any} */ (pool), secret: SECRET, today });
  const l = await call(routes.list, {}, { authorization: BEARER });
  ok("the caller's list", l.status === 200 && l.body.schools.length === 1 && l.body.schools[0].since === "2026-11-15", l.body);
  ok("...read through followed_schools(), which takes no person", pool.asked.some((a) => /from followed_schools\(\)/.test(a.sql) && a.params.length === 0));
  const u = await call(routes.unfollow, {}, { authorization: BEARER }, { id: V160 });
  ok("stopping removes the caller's row, under the table's own row security", u.status === 200 && u.body.removed === 1
     && pool.asked.some((a) => /^delete from followed_school where school_id = \$1$/.test(a.sql) && a.params[0] === V160), u);
  const bad = await call(routes.unfollow, {}, { authorization: BEARER }, { id: "not-a-uuid" });
  ok("...an id that is not one is 404", bad.status === 404);
  ok("every statement ran as the caller", pool.users.every((x) => x === USER));
}

group("E. The Today: the public list, kept to the caller's schools");
{
  const pool = fakePool({ list: [{ school_id: V160, code: "V160", name: "Verify Onesixty College", followed_on: "2026-11-15" }] });
  todayAsked = [];
  const t = await call(followRoutes({ pool: /** @type {any} */ (pool), secret: SECRET, today }).today, {}, { authorization: BEARER });
  ok("the fixtures of the schools followed, and no other", t.status === 200 && JSON.stringify(t.body.fixtures.map((/** @type {any} */ f) => f.id)) === '["f1"]', t.body);
  ok("...asked of the public pages by code alone", todayAsked.length === 1 && JSON.stringify(todayAsked[0]) === '["V160"]', todayAsked);
  ok("...with the list, and the day", t.body.asOf === "2026-11-15" && t.body.schools[0].code === "V160");
  const none = await call(followRoutes({ pool: /** @type {any} */ (fakePool()), secret: SECRET, today }).today, {}, { authorization: BEARER });
  ok("following nothing: an empty Today", none.status === 200 && none.body.fixtures.length === 0, none.body);
  const off = await call(followRoutes({ pool: /** @type {any} */ (fakePool()), secret: SECRET, today: async () => null }).today, {}, { authorization: BEARER });
  ok("public pages off: no fixtures, said as null", off.status === 200 && off.body.fixtures === null, off.body);
}

console.log(`\n${"─".repeat(52)}\nFOLLOW API: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

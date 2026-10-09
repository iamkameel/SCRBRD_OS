#!/usr/bin/env node
/**
 * The closed routes, the report, the pointer, and the expired notice:
 * notifications slices S0 and S2 (docs/design/NOTIFICATIONS.md D6, D9, D11,
 * D14), with no database.
 *
 * The two closed routes answer 410 before a connection is taken, so a pool
 * that throws when touched proves it. Where the work reaches the database, a
 * fake client answers the handful of statements push-api.mjs sends, and
 * records them, so the test can also say what was NOT asked: an expired
 * notice never reaches the address book or the wire. tools/smoke-push.mjs and
 * db/99 §70 walk the same rules against a real database.
 *
 *   node services/api/notify/push-api.test.mjs
 */
import { readFileSync } from "node:fs";
import { buildPayload, fanOut, echoTransport, notificationRoutes, CLOSED } from "./push-api.mjs";
import { SUBJECT_KINDS } from "@scrbrd/policy/notifications";
import { signToken } from "../auth/auth.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const SECRET = "push-api-test-secret";
const USER = "00000000-0000-4000-8000-000000000001";
const SESSION = "00000000-0000-4000-8000-0000000000aa";
const BEARER = `Bearer ${signToken({ userId: USER, deviceId: "test-device", sessionId: SESSION, epoch: 0 }, SECRET)}`;
const SCHOOL = "11111111-1111-1111-1111-111111111111";
const NOTICE = "22222222-2222-4222-8222-222222222222";

/** A pool that fails the test if anything takes a connection from it. */
const untouchable = {
  touched: false,
  async connect() { this.touched = true; throw new Error("the pool was touched"); },
  async query() { this.touched = true; throw new Error("the pool was touched"); },
};

/**
 * A pool whose one client answers what push-api.mjs asks, and keeps a list.
 * @param {{ notice?: any, gate?: boolean, report?: any }} o
 */
function fakePool({ notice = null, gate = true, report = null } = {}) {
  /** @type {{ sql: string, params: any[] }[]} */
  const asked = [];
  const client = {
    async query(/** @type {string} */ sql, /** @type {any[]} */ params = []) {
      asked.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
      if (sql.includes("app_session_begin")) return { rows: [{}] };
      if (sql.includes("from notification where id")) return { rows: notice ? [notice] : [] };
      if (sql.includes("app_can(")) return { rows: [{ ok: gate }] };
      if (sql.includes("push_candidates")) return { rows: [] };
      if (sql.includes("notification_report(")) return { rows: report ? [report] : [] };
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

const good = (/** @type {Record<string, unknown>} */ extra = {}) => ({
  schoolId: SCHOOL, scopeLevel: "school", kind: "notice",
  title: "Nets moved", body: "Nets are on the B field this week.", ...extra });

group("A. Every push is a pointer (D6, D14)");
{
  // A row marked public, with words that would be a disclosure on a lock
  // screen. The old builder sent these in full; the column now chooses nothing.
  const row = { id: NOTICE, is_public: true, kind: "injury", urgency: "medium",
                title: "Player update", body: "A hamstring strain, grade 2." };
  const p = buildPayload(row);
  const wire = JSON.stringify(p.message);
  ok("a public row travels as a pointer", p.kind === "pointer");
  ok("...with the fixed title", p.message.notification.title === "SCRBRD");
  ok("...and the fixed line", p.message.notification.body === "You have a new notice.");
  ok("...not the notice's title", !wire.includes("Player update"));
  ok("...nor its body", !wire.includes("hamstring"));
  ok("...nor its kind", !wire.includes("injury"));
  ok("...nor its urgency", !wire.includes("medium"));
  ok("...only the id to fetch it with",
     Object.keys(p.message.data).join() === "notificationId" && p.message.data.notificationId === NOTICE);
  ok("a restricted row is the same pointer",
     JSON.stringify(buildPayload({ ...row, is_public: false })) === JSON.stringify(p));
  ok("the id travels as a string", buildPayload({ id: 42 }).message.data.notificationId === "42");
}

group("B. The publish and push routes are closed, before any connection (D9)");
{
  const routes = notificationRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET, transport: echoTransport() });
  // What the S0 lock let through, and what it refused: all of it is 410 now.
  const bodies = [good(), good({ urgency: "medium" }), good({ kind: "injury" }), good({ isPublic: true }),
                  good({ subjectPersonId: NOTICE }), {}, null];
  for (const b of bodies) {
    for (const headers of [{ authorization: BEARER }, {}]) {
      const r = await call(routes.publish, b, headers);
      ok(`publish ${JSON.stringify(b)?.slice(0, 40)} ${headers.authorization ? "signed in" : "signed out"} is 410`,
         r.status === 410 && r.body?.error === "gone");
    }
  }
  const pub = await call(routes.publish, good(), { authorization: BEARER });
  ok("...saying where a person's words go now", pub.body?.detail === CLOSED.publish && /POST \/api\/news/.test(pub.body.detail));
  const push = await call(routes.push, undefined, { authorization: BEARER }, { id: NOTICE });
  ok("pushing by hand is 410", push.status === 410 && push.body?.error === "gone");
  ok("...in words", push.body?.detail === CLOSED.push && push.body.detail.length > 20);
  ok("...signed out too", (await call(routes.push, undefined, {}, { id: NOTICE })).status === 410);
  ok("neither took a connection", untouchable.touched === false);
}

group("C. Reporting a notice (D11)");
{
  const routes = notificationRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET });
  const notUuid = await call(routes.report, undefined, { authorization: BEARER }, { id: "not-a-notice" });
  ok("an id that is no uuid is no notice", notUuid.status === 404 && notUuid.body?.error === "no_such_notice");
  const anon = await call(routes.report, undefined, {}, { id: NOTICE });
  ok("an unsigned caller is refused for the token", anon.status === 401 && anon.body?.error === "missing_token");
  ok("...and neither took a connection", untouchable.touched === false);

  const taken = fakePool({ report: { ok: true, reason: null, unheld: false } });
  const r = await call(notificationRoutes({ pool: /** @type {any} */ (taken), secret: SECRET }).report,
                       { reason: "ignored", personId: USER }, { authorization: BEARER }, { id: NOTICE.toUpperCase() });
  ok("a report is taken", r.status === 200 && r.body?.reported === true && r.body?.unheld === false);
  ok("...and says nothing else: no id, no name", Object.keys(r.body).sort().join() === "reported,unheld");
  const asked = taken.asked.find((a) => a.sql.includes("notification_report("));
  ok("the database is asked, with the notice's id and nothing from the body",
     !!asked && asked.params.length === 1 && asked.params[0] === NOTICE);
  ok("...as the caller, in a transaction", taken.asked.some((a) => a.sql.includes("app_session_begin")) && taken.asked.some((a) => a.sql.trim() === "COMMIT"));

  const unheld = fakePool({ report: { ok: true, reason: null, unheld: true } });
  const u = await call(notificationRoutes({ pool: /** @type {any} */ (unheld), secret: SECRET }).report,
                       undefined, { authorization: BEARER }, { id: NOTICE });
  ok("a school with no DSO is said to be unheld", u.status === 200 && u.body?.unheld === true);

  for (const [reason, status] of /** @type {[string, number][]} */ ([["no_such_notice", 404], ["not_reportable", 422],
                                                                     ["already_reported", 409], ["not_permitted", 403]])) {
    const pool = fakePool({ report: { ok: false, reason, unheld: null } });
    const x = await call(notificationRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).report,
                         undefined, { authorization: BEARER }, { id: NOTICE });
    ok(`${reason} is ${status}`, x.status === status && x.body?.error === reason);
  }
}

group("D. The shared list (D1, D5)");
{
  ok("welfare and news are subject kinds", SUBJECT_KINDS.includes("welfare") && SUBJECT_KINDS.includes("news"));
  // The CHECK db/89 re-added is what the database holds now
  // (packages/policy/test/notifications.test.mjs holds the two equal).
  const sql = readFileSync(new URL("../../../db/89_notification_contract.sql", import.meta.url), "utf8");
  const m = sql.match(/notification_subject_kind_known\s+CHECK \(subject_kind IN \(([^)]*)\)\)/);
  const stored = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  ok("db/89's CHECK was found", stored.length > 0);
  ok("...and the route's list is the database's", stored.sort().join() === [...SUBJECT_KINDS].sort().join());
}

group("E. An expired notice is not sent");
{
  const base = { id: NOTICE, school_id: SCHOOL, team_code: null, scope_level: "school", kind: "notice",
                 urgency: "medium", title: "T", body: "B", is_public: false, subject_person_id: null };

  const expiredPool = fakePool({ notice: { ...base, expires_at: new Date(Date.now() - 60_000), expired: true } });
  const echo = echoTransport();
  let refused = /** @type {any} */ (null);
  try {
    await fanOut({ pool: /** @type {any} */ (expiredPool), secret: SECRET, bearer: BEARER,
                   notificationId: NOTICE, transport: echo });
  } catch (e) { refused = e; }
  ok("an expired notice is refused", refused?.message === "notice_expired" && refused?.status === 410);
  ok("...nothing went on the wire", echo.sent.length === 0);
  ok("...and nobody's devices were looked up", !expiredPool.asked.some((a) => a.sql.includes("push_candidates")));
  const read = expiredPool.asked.find((a) => a.sql.includes("from notification where id"));
  ok("the read selects expires_at and asks the database's clock",
     /expires_at/.test(read?.sql ?? "") && /now\(\)/.test(read?.sql ?? ""));

  // The gate comes first: a caller who may not publish learns nothing more.
  const ungated = fakePool({ notice: { ...base, expired: true }, gate: false });
  let code = null;
  try { await fanOut({ pool: /** @type {any} */ (ungated), secret: SECRET, bearer: BEARER, notificationId: NOTICE, transport: echoTransport() }); }
  catch (e) { code = /** @type {any} */ (e).message; }
  ok("a caller who may not push it is told not_permitted, not that it expired", code === "not_permitted");

  const live = fakePool({ notice: { ...base, expires_at: null, expired: false } });
  const out = await fanOut({ pool: /** @type {any} */ (live), secret: SECRET, bearer: BEARER,
                             notificationId: NOTICE, transport: echoTransport() });
  ok("a notice with no expiry goes on to the address book",
     live.asked.some((a) => a.sql.includes("push_candidates")) && out.considered === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

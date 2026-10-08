#!/usr/bin/env node
/**
 * The publish route's lock, the pointer, and the expired notice: notifications
 * slice S0 (docs/design/NOTIFICATIONS.md D6, D12, D14), with no database.
 *
 * Every refusal the lock makes is decided before a connection is taken, so a
 * pool that throws when touched proves it. Where the work reaches the
 * database, a fake client answers the handful of statements push-api.mjs
 * sends, and records them, so the test can also say what was NOT asked: a
 * locked field never reaches the insert, and an expired notice never reaches
 * the address book or the wire. tools/smoke-push.mjs walks the same rules
 * against a real database.
 *
 *   node services/api/notify/push-api.test.mjs
 */
import { readFileSync } from "node:fs";
import { buildPayload, fanOut, echoTransport, notificationRoutes,
         LOCKED_FIELDS, PUBLISH_KIND, PUBLISH_URGENCY } from "./push-api.mjs";
import { SUBJECT_KINDS, SUBJECT_KINDS_NOT_YET_STORED } from "@scrbrd/policy/notifications";
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
 * @param {{ notice?: any, gate?: boolean, insert?: (sql: string, params: any[]) => any }} o
 */
function fakePool({ notice = null, gate = true, insert } = {}) {
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
      if (sql.includes("insert into notification")) {
        if (insert) return insert(sql, params);
        return { rows: [{ id: NOTICE, school_id: SCHOOL, scope_level: params[2],
                          required_capability: "news.read", is_public: false,
                          published_at: new Date(0) }] };
      }
      throw new Error("unexpected statement: " + sql.slice(0, 60));
    },
    release() {},
  };
  return { asked, async connect() { return client; }, async query() { throw new Error("pool.query"); } };
}

/** Run a handler as the server would, and keep what it answered. */
async function call(/** @type {any} */ handler, /** @type {any} */ body, headers = {}) {
  const out = { status: 200, body: /** @type {any} */ (null) };
  const res = {
    status(/** @type {number} */ s) { out.status = s; return res; },
    json(/** @type {any} */ b) { out.body = b; return res; },
  };
  await handler({ body, headers, params: {} }, res);
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

group("B. The publish route is locked, before any connection (D12)");
{
  const publish = notificationRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET, transport: null }).publish;
  ok("the lock names four fields",
     Object.keys(LOCKED_FIELDS).sort().join() === "isPublic,recipientId,requiredCapability,subjectPersonId");

  for (const [field, [code]] of Object.entries(LOCKED_FIELDS)) {
    // Refused when present, whatever the value: false and null included.
    for (const value of ["x", true, false, null]) {
      const r = await call(publish, good({ [field]: value }), { authorization: BEARER });
      ok(`${field}: ${JSON.stringify(value)} is refused as ${code}`, r.status === 422 && r.body?.error === code);
      ok(`...in words`, typeof r.body?.detail === "string" && r.body.detail.length > 20);
    }
  }
  // isPublic alone would have travelled in full before S0.
  const pub = await call(publish, good({ isPublic: true }), { authorization: BEARER });
  ok("a public notice cannot be published", pub.status === 422 && pub.body.error === "is_public_not_accepted");

  ok("the only kind is notice", PUBLISH_KIND === "notice");
  for (const kind of ["fixture", "injury", "welfare", "safeguarding", "system", "Notice", "notices"]) {
    const r = await call(publish, good({ kind }), { authorization: BEARER });
    ok(`kind "${kind}" is refused`, r.status === 422 && r.body?.error === "kind_must_be_notice");
  }
  ok("no kind is refused", (await call(publish, good({ kind: "" }))).body?.error === "kind_required");

  ok("urgency is at most medium", PUBLISH_URGENCY.join() === "low,medium");
  const high = await call(publish, good({ urgency: "high" }), { authorization: BEARER });
  ok("high is refused", high.status === 422 && high.body?.error === "urgency_too_high" && !!high.body?.detail);
  ok("an unknown urgency is refused",
     (await call(publish, good({ urgency: "screaming" }))).body?.error === "urgency_invalid");
  ok("an unknown subject kind is refused",
     (await call(publish, good({ subjectKind: "gossip" }))).body?.error === "subject_kind_invalid");
  ok("the old vocabulary checks stand",
     (await call(publish, good({ scopeLevel: "province" }))).body?.error === "scope_level_invalid"
     && (await call(publish, good({ scopeLevel: "team" }))).body?.error === "team_required_for_team_scope"
     && (await call(publish, good({ title: " " }))).body?.error === "title_required");
  ok("...and none of it took a connection", untouchable.touched === false);

  // Past the lock, the route asks who is calling before anything else.
  const anon = await call(publish, good({ subjectKind: "welfare", urgency: "medium" }));
  ok("welfare is in the route's list: an unsigned caller is refused for the token, not the subject",
     anon.status === 401 && anon.body?.error === "missing_token");
}

group("C. What a locked notice writes, and welfare said in words");
{
  const pool = fakePool();
  const publish = notificationRoutes({ pool: /** @type {any} */ (pool), secret: SECRET, transport: null }).publish;
  const r = await call(publish, good({ urgency: "medium", subjectKind: "training" }), { authorization: BEARER });
  ok("a notice is published", r.status === 200 && r.body?.id === NOTICE);
  ok("...as news.read and not public", r.body?.requiredCapability === "news.read" && r.body?.isPublic === false);
  const ins = pool.asked.find((a) => a.sql.includes("insert into notification"));
  ok("the insert names none of the locked columns",
     !!ins && !/required_capability\s*,|is_public\s*,|subject_person_id|recipient_id/.test(ins.sql.split("values")[0]));
  ok("...and writes the kind itself, not the body's", ins?.params[3] === "notice");

  // Until S1 the database's CHECK does not know welfare.
  const refusing = fakePool({ insert: () => { throw Object.assign(new Error("violates check constraint"),
    { code: "23514", constraint: "notification_subject_kind_check" }); } });
  const p2 = notificationRoutes({ pool: /** @type {any} */ (refusing), secret: SECRET, transport: null }).publish;
  const w = await call(p2, good({ subjectKind: "welfare" }), { authorization: BEARER });
  ok("a welfare notice refused by the database is said so", w.status === 422 && w.body?.error === "subject_kind_not_yet_stored");
  ok("...in words that name the slice", /welfare/.test(w.body?.detail ?? "") && /S1/.test(w.body?.detail ?? ""));
  ok("...and the transaction rolled back", refusing.asked.some((a) => a.sql.trim() === "ROLLBACK"));
  // Any other CHECK is the database's own refusal, unchanged.
  const other = await call(p2, good({ subjectKind: "match" }), { authorization: BEARER });
  ok("another subject kind's refusal is not dressed as welfare's", other.body?.error === "invalid_notice");
}

group("D. The shared list (D1, D5)");
{
  ok("welfare is a subject kind", SUBJECT_KINDS.includes("welfare"));
  ok("...that the database does not store yet", SUBJECT_KINDS_NOT_YET_STORED.join() === "welfare");
  // The CHECK in db/08 (frozen) is what the database holds until S1 re-adds it.
  const sql = readFileSync(new URL("../../../db/08_schema_programme.sql", import.meta.url), "utf8");
  const m = sql.match(/subject_kind text CHECK \(subject_kind IN \(([^)]*)\)\)/);
  const stored = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  ok("db/08's CHECK was found", stored.length > 0);
  ok("every kind the database stores is in the shared list", stored.every((k) => SUBJECT_KINDS.includes(k)));
  ok("...and the list is the database's plus what waits for S1",
     [...stored, ...SUBJECT_KINDS_NOT_YET_STORED].sort().join() === [...SUBJECT_KINDS].sort().join());
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

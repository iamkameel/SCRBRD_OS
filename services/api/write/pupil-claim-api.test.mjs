#!/usr/bin/env node
/**
 * "I am a pupil here" (db/168): the claim's routes, with no database.
 *
 *   - a typed date of birth is dropped, never passed on to the database,
 *     until Migration C has something to compare it with (re-review open
 *     point 2): it is in no statement and no parameter, valid or not;
 *   - his own Remove, for an account kept for a safeguarding concern,
 *     answers exactly as any other account that is not a claim does
 *     (re-review S3(a)): whoever holds his phone learns nothing;
 *   - signed out, nothing is reached.
 *
 * What db/168 decides is proved live by db/99 §141.
 *
 *   node services/api/write/pupil-claim-api.test.mjs
 */
import { pupilClaimRoutes, PUPIL_CLAIM_STATUS } from "./pupil-claim-api.mjs";
import { signToken } from "../auth/auth.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, typeof d === "string" ? d : JSON.stringify(d)); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const SECRET = "pupil-claim-api-test-secret";
const USER = "00000000-0000-4000-8000-0000000001a3";
const BEARER = `Bearer ${signToken({ userId: USER, deviceId: "test-device", sessionId: "00000000-0000-4000-8000-0000000000ab", epoch: 0 }, SECRET)}`;
const HIL = "11111111-1111-1111-1111-111111111111";

/** A pool answering db/168's two doors used here; it remembers every statement and parameter. @param {{ remove?: any }} o */
function fakePool({ remove = { ok: true, reason: null } } = {}) {
  /** @type {{ sql: string, params: any[] }[]} */
  const asked = [];
  const client = {
    async query(/** @type {string} */ sql, /** @type {any[]} */ params = []) {
      asked.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim()) || /savepoint/i.test(sql)) return { rows: [] };
      if (sql.includes("app_session_begin")) return { rows: [{}] };
      if (/set_config/.test(sql)) return { rows: [] };
      if (sql.includes("pupil_claim_send(")) return { rows: [{ ok: true, reason: null }] };
      if (sql.includes("pupil_claim_remove_self(")) return { rows: [remove] };
      throw new Error("unexpected statement: " + sql.slice(0, 80));
    },
    release() {},
  };
  return { asked, async connect() { return client; }, async query() { throw new Error("pool.query"); } };
}
async function call(/** @type {any} */ handler, /** @type {any} */ body = {}, headers = {}) {
  const out = { status: 200, body: /** @type {any} */ (null) };
  const res = { status(/** @type {number} */ s) { out.status = s; return res; }, json(/** @type {any} */ b) { out.body = b; return res; } };
  await handler({ body, headers, params: {} }, res);
  return out;
}

group("A. A typed date of birth: a real day goes to the family list (db/174) as one date parameter; anything else is dropped");
for (const born of ["2012-07-19", "2012-02-30", "not a date", 20120719, null]) {
  const real = born === "2012-07-19";
  const pool = fakePool();
  const routes = pupilClaimRoutes({ pool: /** @type {any} */ (pool), secret: SECRET });
  const r = await call(routes.claim, { schoolId: HIL, name: "Test Pupil", year: "Grade 9", born }, { authorization: BEARER });
  const sent = pool.asked.find((a) => a.sql.includes("pupil_claim_send("));
  ok(`born ${JSON.stringify(born)}: the claim is sent, the same answer`, r.status === 200 && r.body?.ok === true, r);
  ok(`...with four parameters, the date a real day or null`, !!sent && sent.params.length === 4
     && JSON.stringify(sent.params) === JSON.stringify([HIL, "Test Pupil", "Grade 9", real ? "2012-07-19" : null]), sent);
  ok("...and the date in no statement's text, and nothing that is not a real day anywhere",
     !pool.asked.some((a) => a.sql.includes("2012")) && (real || !JSON.stringify(pool.asked).includes("2012")) && !JSON.stringify(pool.asked).includes("not a date"));
}
ok("a date that cannot be a pupil's is a 422 with words", PUPIL_CLAIM_STATUS.born_invalid === 422);

group("B. Remove, for an account kept for a safeguarding concern, answers as any non-claim does");
{
  const kept = await call(pupilClaimRoutes({ pool: /** @type {any} */ (fakePool({ remove: { ok: false, reason: "kept" } })), secret: SECRET }).removeSelf, {}, { authorization: BEARER });
  const other = await call(pupilClaimRoutes({ pool: /** @type {any} */ (fakePool({ remove: { ok: false, reason: "not_a_claim" } })), secret: SECRET }).removeSelf, {}, { authorization: BEARER });
  ok("kept answers not_a_claim", kept.status === 409 && kept.body?.error === "not_a_claim", kept);
  ok("...exactly as an account that is not a claim does", JSON.stringify(kept) === JSON.stringify(other), [kept, other]);
  ok("...and the word 'kept' never reaches the client", !JSON.stringify(kept).includes("kept") && !("kept" in PUPIL_CLAIM_STATUS));
  const done = await call(pupilClaimRoutes({ pool: /** @type {any} */ (fakePool()), secret: SECRET }).removeSelf, {}, { authorization: BEARER });
  ok("a claim's own account is removed", done.status === 200 && done.body?.removed === true, done);
}

group("C. Signed out, nothing is reached");
{
  const pool = fakePool();
  const routes = pupilClaimRoutes({ pool: /** @type {any} */ (pool), secret: SECRET });
  for (const [name, h] of /** @type {[string, any][]} */ ([["claim", routes.claim], ["removeSelf", routes.removeSelf], ["state", routes.state]])) {
    const r = await call(h, { schoolId: HIL, name: "Test Pupil" });
    ok(`${name} with no token is 401`, r.status === 401, r);
  }
  ok("...and no statement ran", pool.asked.length === 0);
}

console.log(`\n${"─".repeat(52)}\nPUPIL CLAIM API: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

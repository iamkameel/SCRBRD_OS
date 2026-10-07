/**
 * A retry writes once — atomically (db/15, GA-I01).
 *
 * A write that carries an Idempotency-Key is one transaction from end to end
 * (runAsUnit in auth/auth-db.mjs):
 *
 *   1. CLAIM THE KEY. A transaction-scoped advisory lock on (person, key):
 *      a second copy of the same request waits here until the first has
 *      committed or rolled back, then reads what it left. Waiting is bounded
 *      (CLAIM_WAIT); past it the copy is told the key is still in flight
 *      (409), rather than holding a connection indefinitely.
 *   2. LOOK FOR THE RECEIPT. Found, for the same route and the same request,
 *      it is the answer, replayed, and nothing runs. Found for a different
 *      route, or for a different body on this one, it is refused (422): a
 *      key names one request, and answering a changed request from the
 *      first one's receipt would tell the client "saved" about something
 *      that was not.
 *   3. RUN THE HANDLER inside the same transaction. Its runAsPrincipal()
 *      calls join it, so its rows are written but not committed.
 *   4. WRITE THE RECEIPT beside them, and COMMIT both. A 5xx, or no answer at
 *      all, rolls everything back instead: no rows and no receipt, so a
 *      retry runs the handler afresh.
 *
 * The answer leaves only after step 4 has committed. A crash anywhere before
 * that commits nothing, and the client was told nothing — there is no moment
 * at which the row exists without its receipt.
 *
 * THE FINGERPRINT RIDES IN `route`. request_replay (db/15) already stores
 * what a key was spent on, in a text column, and compares it; the request's
 * fingerprint is a finer statement of the same fact, so it is appended there
 * ("POST /api/news sha256:…") rather than given a column of its own. No
 * migration, no paste. A receipt written before this change has no
 * fingerprint and is compared on the route alone, as it always was; receipts
 * are a day's worth of retries, so those age out on their own.
 */
import { createHash } from "node:crypto";
import { runAsUnit } from "../auth/auth-db.mjs";
/** @import { Pool } from "../api-types.mjs" */

/** How long a second copy of a request waits for the first to finish. */
export const CLAIM_WAIT = "5s";

/**
 * JSON with every object's keys in order, so the same request spelled in a
 * different order is the same request. Arrays keep their order: in a body,
 * order in a list means something.
 * @param {unknown} v
 * @returns {string}
 */
export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = /** @type {Record<string, unknown>} */ (v);
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/**
 * What one request IS, for the purpose of a key: the route (with its ids),
 * the query and the body. Headers are not part of it — a retry may carry a
 * fresh token.
 * @param {{ route: string, query?: Record<string, string>, body?: unknown }} req
 */
export function fingerprint({ route, query = {}, body = {} }) {
  return createHash("sha256").update(canonical({ route, query, body })).digest("hex");
}

/** "POST /api/news sha256:ab…" → { route, fp }; a receipt from before has fp null. */
const split = (/** @type {string} */ stored) => {
  const m = / sha256:([0-9a-f]{64})$/.exec(stored);
  return m ? { route: stored.slice(0, m.index), fp: m[1] } : { route: stored, fp: null };
};

/**
 * @typedef {{ status: number, body: unknown }} Answer
 * @typedef {{ kind: "replayed", answer: Answer } | { kind: "refused", answer: Answer } | { kind: "ran", answer: Answer | null, committed: boolean }} Outcome
 */

/**
 * Run one keyed write as a unit.
 * @param {object} a
 * @param {Pool} a.pool
 * @param {string} a.secret
 * @param {string} a.bearer
 * @param {string} a.key        the Idempotency-Key, as sent
 * @param {string} a.route      "POST /api/news" (with its ids)
 * @param {string} a.fp         fingerprint() of the request
 * @param {() => Promise<Answer | null>} a.run   runs the handler; resolves with the answer it recorded
 * @returns {Promise<Outcome>}
 */
export async function keyedWrite({ pool, secret, bearer, key, route, fp, run }) {
  return runAsUnit(pool, secret, bearer, async (c, principal, unit) => {
    // 1. The claim. lock_timeout bounds the wait and is put back at once, so
    //    nothing the handler does inherits it.
    const { rows: [was] } = await c.query(`select current_setting('lock_timeout') as v`);
    await c.query(`select set_config('lock_timeout', $1, true)`, [CLAIM_WAIT]);
    try {
      // Keyed on the verified principal, not app_user_id(): a NULL there would make the lock a no-op.
      await c.query(`select pg_advisory_xact_lock(hashtext('scrbrd.request_replay'), hashtext($2 || ':' || $1))`, [key, String(principal.userId)]);
    } catch (/** @type {any} */ e) {
      if (e.code === "55P03") return { commit: false, value: /** @type {Outcome} */ ({ kind: "refused", answer: { status: 409, body: { error: "idempotency_key_in_flight" } } }) };
      throw e;
    }
    await c.query(`select set_config('lock_timeout', $1, true)`, [was.v]);

    // 2. The receipt, read after the claim: under READ COMMITTED this
    //    statement sees whatever the copy before it committed.
    const { rows: [seen] } = await c.query(`select route, status, body from request_replay where key = $1`, [key]);
    if (seen) {
      const s = split(seen.route);
      if (s.route !== route) {
        return { commit: false, value: /** @type {Outcome} */ ({ kind: "refused", answer: { status: 422, body: { error: "idempotency_key_reused", route: s.route } } }) };
      }
      if (s.fp !== null && s.fp !== fp) {
        return { commit: false, value: /** @type {Outcome} */ ({ kind: "refused", answer: { status: 422, body: { error: "idempotency_key_payload_mismatch", route: s.route } } }) };
      }
      return { commit: false, value: /** @type {Outcome} */ ({ kind: "replayed", answer: { status: seen.status, body: seen.body } }) };
    }

    // 3. The handler, joined to this transaction.
    const answer = await run();
    await unit.close();

    // 4. Only an answer the handler stood behind is kept. Anything else —
    //    a 5xx, or silence — keeps nothing, so the retry runs afresh.
    if (!answer || answer.status >= 500) return { commit: false, value: /** @type {Outcome} */ ({ kind: "ran", answer, committed: false }) };
    await c.query(`insert into request_replay (person_id, key, route, status, body)
                   values (app_user_id(), $1, $2, $3, $4)`,
                  [key, `${route} sha256:${fp}`, answer.status, JSON.stringify(answer.body ?? null)]);
    return { commit: true, value: /** @type {Outcome} */ ({ kind: "ran", answer, committed: true }) };
  });
}

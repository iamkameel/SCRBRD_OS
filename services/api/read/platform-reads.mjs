/**
 * THE OWNER'S KEY OFF THE READ PATH (PLATFORM_CONTROLS slice 6a, db/167).
 *
 * read-api.mjs puts a platform-wide reader's every read on the record (db/20)
 * and a support session's the same way (db/22). The GET routes outside
 * /api/read/ wrote nothing for anybody, so the owner's key reading a child's
 * public name and his guardians' answers, the team sheet, the ball log or a
 * pupil's account left no row at his school. server.mjs names those routes
 * (PLATFORM_LOGGED) and, after one answers, hands this the answer it is about
 * to send. log_platform_read() (db/167) decides the rest in one statement:
 * nothing for a school reader; for the key, a platform administrator or a
 * support session, one row per school, naming each child whose id came back.
 *
 * The answer leaves only after the row is written. A row that cannot be
 * written is not a read that happened quietly: the caller is refused instead
 * (server.mjs answers 503 not_logged).
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { Pool } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** At most this many ids are offered to the database per answer. */
export const MAX_SEEN = 5000;

/**
 * @typedef {object} PlatformRead
 * @property {string} resource   the name the row is filed under
 * @property {"match" | "account"} [subject]  what the route's :id is
 * @property {boolean} [squad]   the answer names the fixture's boys by name, not id
 */

/**
 * Every id in an answer, lower-cased, once each, at most MAX_SEEN.
 * @param {unknown} body
 * @returns {string[]}
 */
export function uuidsIn(body) {
  const text = JSON.stringify(body ?? null) ?? "";
  return [...new Set((text.match(UUIDS) ?? []).map((s) => s.toLowerCase()))].slice(0, MAX_SEEN);
}

/**
 * The arguments log_platform_read() is called with for one answer.
 * @param {PlatformRead} def
 * @param {string | undefined} id  the route's first capture group
 * @param {unknown} body
 * @returns {[string, string[], string | null, string | null, boolean]}
 */
export function platformReadArgs(def, id, body) {
  const subject = id && UUID.test(id) ? id.toLowerCase() : null;
  const seen = uuidsIn(body);
  if (subject && !seen.includes(subject)) seen.push(subject);
  return [def.resource, seen,
          def.subject === "match" ? subject : null,
          def.subject === "account" ? subject : null,
          def.squad === true && def.subject === "match"];
}

/**
 * Put one answer on the record, as the caller. Writes nothing for a school
 * reader (the function returns at once); throws when it cannot write.
 * @param {Pool} pool @param {string} secret @param {string} bearer
 * @param {PlatformRead} def @param {string | undefined} id @param {unknown} body
 */
export async function logPlatformRead(pool, secret, bearer, def, id, body) {
  await runAsPrincipal(pool, secret, bearer, async (client) => {
    await client.query(`select log_platform_read($1, $2::uuid[], $3::uuid, $4::uuid, $5)`,
      platformReadArgs(def, id, body));
  });
}

/**
 * THE OWNER'S KEY OFF THE READ PATH (PLATFORM_CONTROLS slice 6a, db/167).
 *
 * read-api.mjs puts a platform-wide reader's every read on the record (db/20)
 * and a support session's the same way (db/22). The GET routes outside
 * /api/read/ wrote nothing for anybody, so the owner's key reading a child's
 * public name and his guardians' answers, the team sheet, the ball log or a
 * pupil's account left no row at his school. server.mjs names those routes
 * (PLATFORM_LOGGED). Before one runs it asks isPlatformReader() — once per
 * session every PLATFORM_TTL_MS, so a school reader pays one small query a
 * half-minute and nothing else, and is never refused for the log. For a
 * platform-wide caller or one in a support session, after the route answers
 * it hands this the answer it is about to send; log_platform_read() (db/167)
 * writes one row per school, naming each child whose id came back, through a
 * strict writer: a row that cannot be written refuses the answer (server.mjs
 * answers 503 not_logged) rather than sending it unrecorded.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { Pool } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A field that carries an id: `id`, `…Id`, `…_id`. Nothing else is read. */
const ID_KEY = /^(id|.+Id|.+_id)$/;

/** At most this many ids are offered to the database per answer; past it the rows say record_ids_cut. */
export const MAX_SEEN = 20000;

/**
 * @typedef {object} PlatformRead
 * @property {string} resource   the name the row is filed under
 * @property {"match" | "account"} [subject]  what the route's :id is
 * @property {boolean} [squad]   the answer names the fixture's boys by name, not id
 */

/**
 * The ids in an answer's id-shaped fields (`id`, `…Id`, `…_id`, a value or a
 * list of values) and the keys of a map keyed by id, lower-cased, once each,
 * at most MAX_SEEN. Never an id from
 * free text: a note or a label is somebody's words, and an id typed into one
 * is not a child the answer was about (review S5).
 * @param {unknown} body
 * @returns {{ ids: string[], cut: boolean }}
 */
export function uuidsIn(body) {
  /** @type {Set<string>} */
  const found = new Set();
  let cut = false;
  const take = (/** @type {unknown} */ v) => {
    if (typeof v !== "string" || !UUID.test(v)) return;
    if (found.size >= MAX_SEEN) { if (!found.has(v.toLowerCase())) cut = true; return; }
    found.add(v.toLowerCase());
  };
  /** @param {unknown} node */
  const walk = (node) => {
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    if (node === null || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      // A map keyed by id (the ground's labels: { <player id>: "D Erasmus" }).
      take(k);
      if (ID_KEY.test(k)) {
        if (Array.isArray(v)) v.forEach(take); else take(v);
      }
      if (v !== null && typeof v === "object") walk(v);
    }
  };
  walk(body);
  return { ids: [...found], cut };
}

/**
 * The arguments log_platform_read() is called with for one answer.
 * @param {PlatformRead} def
 * @param {string | undefined} id  the route's first capture group
 * @param {unknown} body
 * @returns {[string, string[], string | null, string | null, boolean, boolean]}
 */
export function platformReadArgs(def, id, body) {
  const subject = id && UUID.test(id) ? id.toLowerCase() : null;
  const { ids, cut } = uuidsIn(body);
  if (subject && !ids.includes(subject)) ids.push(subject);
  return [def.resource, ids,
          def.subject === "match" ? subject : null,
          def.subject === "account" ? subject : null,
          def.squad === true && def.subject === "match",
          cut];
}

/** How long one session's answer to "is this the platform?" is kept. */
export const PLATFORM_TTL_MS = 30_000;
const MAX_KEPT = 10_000;
/** @type {Map<string, { platform: boolean, at: number }>} */
const kept = new Map();

/**
 * Is the caller platform-wide, or in a support session? Asked once per
 * session (its token) every PLATFORM_TTL_MS; a refused or unreadable token
 * throws, as the route itself would. A platform assignment given in the
 * middle of a session is seen within PLATFORM_TTL_MS; one that lapses is
 * harmless meanwhile (the database writes nothing for a school reader).
 * @param {Pool} pool @param {string} secret @param {string} bearer
 * @param {() => number} [now]
 * @returns {Promise<boolean>}
 */
export async function isPlatformReader(pool, secret, bearer, now = Date.now) {
  const hit = kept.get(bearer);
  if (hit && now() - hit.at < PLATFORM_TTL_MS) return hit.platform;
  const platform = await runAsPrincipal(pool, secret, bearer, async (client) => {
    const { rows: [r] } = await client.query(
      `select app_is_platform_wide() or app_support_access_id() is not null as platform`);
    return r?.platform === true;
  });
  if (kept.size >= MAX_KEPT) kept.clear();
  kept.set(bearer, { platform, at: now() });
  return platform;
}

/** For tests: forget every kept answer. */
export function forgetPlatformReaders() { kept.clear(); }

/**
 * Put one answer on the record, as the caller. Throws when the row cannot be
 * written (db/167's writer has no exception handler).
 * @param {Pool} pool @param {string} secret @param {string} bearer
 * @param {PlatformRead} def @param {string | undefined} id @param {unknown} body
 */
export async function logPlatformRead(pool, secret, bearer, def, id, body) {
  await runAsPrincipal(pool, secret, bearer, async (client) => {
    await client.query(`select log_platform_read($1, $2::uuid[], $3::uuid, $4::uuid, $5, $6)`,
      platformReadArgs(def, id, body));
  });
}

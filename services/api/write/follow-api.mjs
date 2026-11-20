/**
 * SCRBRD — the follow list (EXPERIENCE_PASS Q8, slice 3b; db/160).
 *
 * A signed-in person keeps a list of schools whose PUBLIC matches lead his
 * Today. No role and no office step: following opens no new read, and a
 * follower sees what a stranger with the link sees. The list is his alone
 * (db/160's row security on app_user_id(); followed_schools() answers the
 * caller's own rows), and nothing here answers about anybody else's.
 *
 * THE TODAY IS FILTERED HERE, NOT IN SQL (the lead's call, slice 3b). The
 * public read, public_live_fixtures(), stays unaware of accounts: the
 * follower's Today is that read, served from the public pages' own cache as
 * nobody, kept to the fixtures one of whose schools is on the caller's list
 * (publicPages().followedToday()). A school that stops listing has left the
 * public read already, so it leaves his Today at once.
 *
 * Nothing is pushed (Q23 waits for push delivery, NOTIFICATIONS S3).
 *
 * Routes (all signed in; a pad's resume credential reaches nothing here,
 * db/160's doors and the table's pad guards refuse it):
 *   GET    /api/follows            { schools: [{ id, code, name, since }] }
 *   POST   /api/follows { code } | { schoolId }   follow: { ok, reason?, school?: { id, name } }
 *   DELETE /api/follows/:id        stop following: { removed }
 *   GET    /api/follows/today      { asOf, fixtures, schools }, or { fixtures: null } while the public pages are off
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { safeErr } from "../log-safe.mjs";
/** @import { Pool, IdHandler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A school's code as the school table holds it ("HIL", "verify-051"): short, plain. */
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/** follow_school()'s refusals, with their status. */
/** @type {Record<string, number>} */
export const FOLLOW_STATUS = Object.freeze({ not_signed_in: 401, no_answer: 400, no_such_school: 404, too_many: 409 });

/** A followed_schools() row, as the screens read it. @param {any} r */
export const followedRow = (r) => ({
  id: String(r.school_id), code: String(r.code), name: String(r.name),
  since: String(r.followed_on ?? ""),   // YYYY-MM-DD, the database's own text
});

/**
 * @param {{ pool: Pool, secret: string, today: (codes: string[]) => Promise<{asOf: string | null, fixtures: any[]} | null> }} deps
 *   `today` is the public pages' followedToday(): the public list kept to these schools.
 * @returns {Record<string, IdHandler>}
 */
export function followRoutes({ pool, secret, today }) {
  /** @param {(req: any) => Promise<unknown>} fn @returns {IdHandler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (!e.status) console.error("follows →", safeErr(e));
      res.status(e.status || 500).json({ error: e.status ? (e.code || e.message) : "error" });
    }
  };
  /** @param {any} req @param {(client: any) => Promise<any>} fn */
  const as = (req, fn) => runAsPrincipal(pool, secret, req.headers?.authorization, fn);
  const err = (/** @type {string} */ code, /** @type {number} */ status) => Object.assign(new Error(code), { code, status });
  /** The caller's own list. @param {any} c */
  const list = async (c) => (await c.query(`select school_id, code, name, followed_on::text as followed_on from followed_schools()`)).rows.map(followedRow);

  return {
    list: handle((req) => as(req, async (c) => ({ schools: await list(c) }))),

    follow: handle((req) => {
      // { code } from a match's link, or { schoolId } from the join form's
      // "I just want to follow matches" (Q10, db/168's follow_school_by_id():
      // the join list names schools by id). The same door either way.
      const schoolId = typeof req.body?.schoolId === "string" ? req.body.schoolId.trim() : "";
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
      if (schoolId ? !UUID.test(schoolId) : !CODE.test(code)) throw err("no_such_school", 404);
      return as(req, async (c) => {
        const { rows } = schoolId
          ? await c.query(`select ok, reason, school_id, school_name from follow_school_by_id($1)`, [schoolId])
          : await c.query(`select ok, reason, school_id, school_name from follow_school($1, true)`, [code]);
        const r = rows[0];
        if (!r?.ok) throw err(r?.reason ?? "refused", FOLLOW_STATUS[r?.reason] ?? 409);
        return { ok: true, school: { id: String(r.school_id), name: String(r.school_name) } };
      });
    }),

    // Under the table's own row security: the caller's row, or nothing.
    unfollow: handle((req) => {
      const id = String(req.params?.id ?? "");
      if (!UUID.test(id)) throw err("not_found", 404);
      return as(req, async (c) => ({ removed: (await c.query(`delete from followed_school where school_id = $1`, [id])).rowCount ?? 0 }));
    }),

    today: handle(async (req) => {
      const schools = await as(req, list);
      const t = await today(schools.map((/** @type {any} */ s) => s.code));
      return t ? { asOf: t.asOf, fixtures: t.fixtures, schools } : { asOf: null, fixtures: null, schools };
    }),
  };
}

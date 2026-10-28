/**
 * SCRBRD — switching push off, or on again, for one kind of notice, or one
 * kind about one child (NOTIFICATIONS.md D20; slice S4; db/120).
 *
 * POST /api/notifications/prefs { kind, subjectPlayerId?, push }
 *
 * Nothing here decides who may: the row is written AS THE CALLER, and the
 * table's own policy (db/120) holds it to his own person and, for a row about
 * a child, to a child he is family of (is_family_of()). person_id comes from
 * the principal and never from the body. The kind is checked here only to
 * answer in words: a locked kind is refused by the database's CHECK as well.
 *
 * A preference governs push only. It hides nothing from Notices, the badge
 * or a parent's action list; the answer says so, so the screen can.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { KINDS, MUTABLE_KINDS, PER_CHILD_KINDS } from "@scrbrd/policy/notifications";
/** @import { ApiRequest, Handler, Pool } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The words for a kind that is always pushed when it matters (D20). */
export const ALWAYS_ON = "Always on: safety and welfare notices.";

/** @param {string} code @param {number} [status] @param {string} [detail] */
const err = (code, status = 400, detail = undefined) =>
  Object.assign(new Error(code), { status, ...(detail ? { detail } : {}) });

/**
 * @param {{ pool: Pool, secret: string }} deps
 * @returns {Record<string, Handler>}
 */
export function prefRoutes({ pool, secret }) {
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      // 42501: the policy refused (a child who is not his); 23514: a CHECK.
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
      if (e.code === "23514") return res.status(422).json({ error: "kind_locked", detail: ALWAYS_ON });
      res.status(e.status || 500).json({ error: e.message || "error", ...(e.status && e.detail ? { detail: e.detail } : {}) });
    }
  };

  return {
    set: handle(async (req) => {
      const b = req.body || {};
      const kind = String(b.kind ?? "");
      if (!KINDS.includes(kind)) throw err("kind_unknown");
      if (!MUTABLE_KINDS.includes(kind)) throw err("kind_locked", 422, ALWAYS_ON);
      if (typeof b.push !== "boolean") throw err("push_must_be_true_or_false");
      const child = b.subjectPlayerId == null || b.subjectPlayerId === "" ? null : String(b.subjectPlayerId);
      if (child !== null && !UUID.test(child)) throw err("subject_player_invalid");
      if (child !== null && !PER_CHILD_KINDS.includes(kind)) throw err("kind_not_per_child");

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows: [row] } = await client.query(
          `insert into notification_pref (person_id, kind, subject_player_id, push)
           values (app_user_id(), $1, $2::uuid, $3)
           on conflict (person_id, kind, (coalesce(subject_player_id, '00000000-0000-0000-0000-000000000000'::uuid)))
             do update set push = excluded.push
           returning kind, subject_player_id, push, updated_at`,
          [kind, child, b.push]);
        if (!row) throw err("not_permitted", 403);
        return { kind: row.kind, subjectPlayerId: row.subject_player_id, push: row.push,
                 updatedAt: row.updated_at, pushOnly: true };
      });
    }),
  };
}

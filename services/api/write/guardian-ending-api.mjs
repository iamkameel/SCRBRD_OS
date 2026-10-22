/**
 * Ending one guardian link, with a kind and a reason (account lifecycle slice
 * 3, db/109; docs/design/ACCOUNT_LIFECYCLE.md §4, D13 and D14).
 *
 *   POST /api/players/:id/guardians/:link/revoke  { kind, reason }
 *
 * The handler does nothing but ask. guardian_link_revoke(link, kind, reason)
 * decides, under the caller's own identity: guardian.link.manage at the
 * child's school, never your own link, the link still live, never the last
 * verified link of a minor, a kind the office may choose, a reason of ten
 * characters or more. It records the ending (guardian_link_ending), tells the
 * guardian without the child's name or the reason, and lets the existing rules
 * take what goes with the link: his public name, the health consent through
 * it, her lift seats.
 *
 * The link must be this child's. That is asked under row-level security: a
 * caller who may not read the link is told no_such_link, the same answer as
 * for a link that does not exist, so a stranger learns nothing either way.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, Handler } from "../api-types.mjs" */

/** The refusals, by what each means: not every one is a refusal of authority. */
/** @type {Record<string, number>} */
export const REVOKE_STATUS = Object.freeze({
  not_signed_in: 401,
  not_permitted: 403,
  own_link: 403,
  no_such_link: 404,
  no_open_link: 409,
  last_verified_link: 409,
  kind_required: 422,
  kind_not_allowed: 422,
  reason_required: 422,
  reason_too_long: 422,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {RouteDeps} deps @returns {{ revoke: Handler }} */
export function guardianEndingRoutes({ pool, secret }) {
  return {
    revoke: async (req, res) => {
      const player = String(req.params.id ?? "");
      const link = String(req.params.sub ?? "");
      if (!UUID.test(player) || !UUID.test(link)) return void res.status(404).json({ error: "no_such_link" });
      const kind = typeof req.body?.kind === "string" ? req.body.kind : null;
      const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
      try {
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const { rows } = await client.query(
            `select * from guardian_link_revoke(
               (select g.id from assignment_subject g where g.id = $2::uuid and g.player_id = $1::uuid),
               $3::text, $4::text)`,
            [player, link, kind, reason]);
          return rows[0] ?? { ok: false, reason: "no_result" };
        });
        if (out.ok) return void res.json({ ok: true });
        res.status(REVOKE_STATUS[out.reason] ?? 403).json({ error: out.reason || "refused" });
      } catch (/** @type {any} */ e) {
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}

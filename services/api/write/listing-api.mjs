/**
 * SCRBRD — a school's listing on the public home page (SCRBRD-142 phase 2).
 *
 * public_listing_set() (db/82) is the door; this is its button's route, beside
 * publication-api.mjs and built the same way. Signed in, as the caller: the
 * function checks broadcast.publish at the school with no team (a school-wide
 * holder — the director of sport, the office), as the names-off switch does.
 * Nothing here decides who may.
 *
 *   GET  /api/schools/:id/listing   { schoolId, listed, setAt, mayChange } for
 *                                   a broadcast.publish holder at the school
 *                                   (any side of it); 404 for anybody else,
 *                                   the same as for a school that does not
 *                                   exist
 *   POST /api/schools/:id/listing   { listed: bool }
 *
 * Off until switched on: a school with no row is not listed (PUBLIC_DATA
 * §1.1). Listed, its fixtures appear on the home page only once it has also
 * published them (rule 7 as amended, D1a); listing alone shows nothing.
 *
 * NEVER SERVED STALE AFTER IT ANSWERS, as publication-api.mjs: once
 * public_listing_set() has committed, `onChange` (public-api.mjs's changed(),
 * wired in server.mjs) drops the public cache before the answer is written.
 * Its note is {k: "school"}, a kind the cache does not key by, so the whole
 * cache drops — the home page's list and every match it held. db/82's
 * trigger sends the same note to every other API instance.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, IdHandler } from "../api-types.mjs" */

const NIL = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {RouteDeps & {onChange?: (note: {k: string, id: string}) => void}} deps
 *   `onChange`: what a committed change is told to, before the answer
 * @returns {Record<string, IdHandler>}
 */
export function listingRoutes({ pool, secret, onChange }) {
  return {
    read: async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
      try {
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select app_can('broadcast.publish', s.id, '*'::text, $2::uuid, $2::uuid) as reads,
                  app_can('broadcast.publish', s.id, null::text, $2::uuid, $2::uuid) as may_change,
                  l.listed, l.set_at
             from school s
             left join public_listing l on l.school_id = s.id
            where s.id = $1`, [id, NIL])).rows[0]);
        // The switch is the school's publishers' to see; to anybody else this
        // school's setting is not there at all.
        if (!r?.reads) return res.status(404).json({ error: "not_found" });
        res.json({ schoolId: id.toLowerCase(), listed: r.listed === true,
                   setAt: r.set_at ? new Date(r.set_at).toISOString() : null, mayChange: r.may_change === true });
      } catch (/** @type {any} */ e) {
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },
    set: async (req, res) => {
      const id = String(req.params.id ?? "");
      const { listed } = req.body ?? {};
      if (!UUID.test(id)) return res.status(404).json({ error: "no_such_school" });
      if (typeof listed !== "boolean") return res.status(400).json({ error: "no_answer" });
      try {
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select ok, reason from public_listing_set($1, $2)`, [id, listed])).rows[0]);
        if (!r?.ok) {
          const status = r?.reason === "not_permitted" ? 403 : r?.reason === "no_such_school" ? 404 : 422;
          return res.status(status).json({ error: r?.reason ?? "refused" });
        }
        // Committed (runAsPrincipal has returned): drop the public cache now,
        // not when the notification gets here.
        onChange?.({ k: "school", id: id.toLowerCase() });
        res.json({ ok: true, schoolId: id.toLowerCase(), listed });
      } catch (/** @type {any} */ e) {
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },
  };
}

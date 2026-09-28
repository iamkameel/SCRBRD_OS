/**
 * SCRBRD — publishing a side of a fixture (SCRBRD-083 phase 1).
 *
 * fixture_publish() (db/47) has existed since the records did; this is its
 * button's route. Signed in, as the caller: the function checks that he holds
 * broadcast.publish at THAT side's school and team, so the away school's
 * publisher cannot publish the home side, nor the home school's the away
 * (L5, each school speaks for its own children). Nothing here decides who may.
 *
 *   GET  /api/matches/:id/publication   each side's state as this reader may
 *                                       read it (fixture_publication's own
 *                                       policy: fixture.read at that side),
 *                                       and whether he may change it
 *   POST /api/matches/:id/publication   { side: "home" | "away", published: bool }
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, IdHandler } from "../api-types.mjs" */

/** @param {RouteDeps} deps @returns {Record<string, IdHandler>} */
export function publicationRoutes({ pool, secret }) {
  return {
    read: async (req, res) => {
      try {
        const rows = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select s.side,
                  coalesce(f.published, false) as published,
                  s.school_id is not null as on_platform,
                  s.school_id is not null
                    and app_can('broadcast.publish', s.school_id, s.team_code,
                                '00000000-0000-0000-0000-000000000000'::uuid, m.id) as may_publish
             from match m
             cross join lateral (values ('home', m.school_id, m.team_code),
                                        ('away', m.away_school_id, m.away_team_code)) as s(side, school_id, team_code)
             left join fixture_publication f on f.match_id = m.id and f.side = s.side
            where m.id = $1
            order by s.side desc`, [req.params.id])).rows);
        res.json({ matchId: req.params.id, sides: rows });
      } catch (/** @type {any} */ e) {
        if (e.code === "22P02") return res.status(404).json({ error: "not_found" });
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },
    set: async (req, res) => {
      const { side, published } = req.body ?? {};
      if (side !== "home" && side !== "away") return res.status(400).json({ error: "unknown_side" });
      if (typeof published !== "boolean") return res.status(400).json({ error: "no_answer" });
      try {
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select ok, reason from fixture_publish($1, $2, $3)`, [req.params.id, side, published])).rows[0]);
        if (!r?.ok) {
          const status = r?.reason === "not_permitted" ? 403 : r?.reason === "no_such_fixture" ? 404 : 422;
          return res.status(status).json({ error: r?.reason ?? "refused" });
        }
        res.json({ ok: true, side, published });
      } catch (/** @type {any} */ e) {
        if (e.code === "22P02") return res.status(404).json({ error: "no_such_fixture" });
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },
  };
}

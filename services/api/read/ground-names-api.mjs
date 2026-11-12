/**
 * SCRBRD — whom the big screen at the ground may name, and by what label
 * (PUBLIC_BY_TERMS §2.5, slice 1; Kameel, 12 Nov 2026, 21:00: "we should be
 * masking the names of any boy that doesn't have a public profile").
 *
 *   GET /api/matches/:id/ground-names   { matchId, labels: { <player id>: "D Erasmus" } }
 *
 * THE SAME RULE AS THE PUBLIC PAGE, NOT A SECOND ONE. The boys the public
 * live page of this match would name, with the label it would name them by:
 * public_match_people() (db/59, the facts the public log reads, its
 * published-fixture test included) through redact.mjs nameFor(), the same
 * publicName() call the public log makes. It is asked whether or not the
 * public pages are switched on (PUBLIC_PAGES): the question is whether the
 * public page WOULD name him, so a boy with no public name is never named
 * on the screen before the pages go live either. A fixture no school has
 * published names nobody, as on the public page.
 *
 * THE SAME GATE AS ground_screen_sides() (db/153), and nothing of its own:
 * a reader that function answers no rows — not the host's staff, a pupil,
 * a pad credential, a roster-mover who may not read the mark, signed out
 * (refused before anything is read) — gets no labels. Asked as the caller,
 * in the same transaction as the facts.
 *
 * LABELS ONLY. The label the public page would show, keyed by the player id
 * the signed-in log carries (the screen lines it up with its squads). No
 * reason, no consent, no mark, no date, no name beyond the label: the name
 * columns go no further than nameFor(). A boy left out is shown by position.
 *
 * What a host staff reader can infer (READERS_child_data K: a coach reads no
 * consent): which boys the public page would not name. The crowd sees the
 * same on the screen. Recorded in the PR for the red-team.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { nameFor } from "../public/redact.mjs";
/** @import { RouteDeps, IdHandler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The labels, from public_match_people()'s rows: nameFor() on the day each
 * row was served, and nothing for a boy it does not name.
 * @param {any[]} people  @returns {Record<string, string>}
 */
export function groundLabels(people) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const p of Array.isArray(people) ? people : []) {
    const label = nameFor(p, p?.served_on);
    if (label && typeof p?.player_id === "string" && UUID.test(p.player_id)) out[p.player_id] = label;
  }
  return out;
}

/** @param {RouteDeps} deps @returns {Record<string, IdHandler>} */
export function groundNamesRoutes({ pool, secret }) {
  return {
    read: async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) return res.status(404).json({ error: "no_such_fixture" });
      try {
        const labels = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          // ground_screen_sides()'s gate, asked as the caller: no rows, no labels.
          const gate = (await client.query(`select count(*)::int as n from ground_screen_sides($1)`, [id])).rows[0];
          if (!gate?.n) return {};
          return groundLabels((await client.query(`select * from public_match_people($1)`, [id])).rows);
        });
        res.json({ matchId: id, labels });
      } catch (/** @type {any} */ e) {
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },
  };
}

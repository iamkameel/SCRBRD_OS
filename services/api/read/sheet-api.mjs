/**
 * SCRBRD — a fixture's team sheet, names and order (REACH R-H, db/131).
 *
 *   GET /api/matches/:id/sheet   { matchId, rows: [{ side, battingNo, twelfth, name }] }
 *
 * Kameel, 27 Sep 2026 (STEP4 Q10): a parent sees the team sheet before the
 * match — "signed in, her own child's side and fixture only, the named
 * players and their order — names only, no profiles, ages or photos". The
 * database decides who: fixture_sheet() (db/131), as the caller, answers each
 * end of the fixture only to a reader who may read some boy on that end's
 * sheet (match_squad_read's own question), and returns four columns. This
 * route passes them on and adds nothing: no player id, no school, no age.
 *
 * Nothing is public here. A signed-out request is refused before anything is
 * read (runAsPrincipal), and a reader the function does not admit — a
 * spectator, a parent of another side — gets an empty list, the same answer
 * as a fixture whose sheet is not out yet: the route does not say which.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, IdHandler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {RouteDeps} deps @returns {Record<string, IdHandler>} */
export function sheetRoutes({ pool, secret }) {
  return {
    read: async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) return res.status(404).json({ error: "no_such_fixture" });
      try {
        const rows = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select side, batting_no, twelfth, name from fixture_sheet($1)`, [id])).rows);
        res.json({
          matchId: id,
          rows: rows.map((/** @type {any} */ r) => ({ side: r.side, battingNo: r.batting_no, twelfth: r.twelfth, name: r.name })),
        });
      } catch (/** @type {any} */ e) {
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },
  };
}

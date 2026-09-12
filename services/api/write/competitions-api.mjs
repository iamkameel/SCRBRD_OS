/**
 * SCRBRD — a competition's tiers, and who sits in which.
 *
 * Two acts. Creating a division is a write to competition_division under
 * its own policy: competition.manage at the organiser's school, which for a
 * shared league with no organising school is only a platform-wide
 * competition administrator. Placing an entrant in a division goes through
 * place_entrant() in db/08 under the same capability — NOT through the
 * entrant's own update policy, which is the school's and would let a school
 * promote itself.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function competitionRoutes({ pool, secret }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      if (e.code === "23514") return res.status(422).json({ error: "invalid_division", detail: e.message });
      if (e.code === "23505") return res.status(422).json({ error: "division_already_exists", detail: e.detail });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_competition" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  return {
    // POST /api/competitions/:id/divisions { code, name, rank }
    division: handle(async (req) => {
      const b = req.body || {};
      const code = String(b.code ?? "").trim();
      if (!/^[A-Za-z0-9 ]{1,12}$/.test(code)) throw err("code_invalid");
      const name = String(b.name ?? "").trim();
      if (name.length < 2 || name.length > 60) throw err("name_invalid");
      const rank = Number(b.rank);
      if (!Number.isInteger(rank) || rank < 1 || rank > 20) throw err("rank_must_be_1_to_20");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into competition_division (competition_id, code, name, rank)
           values ($1, $2, $3, $4) returning id, competition_id, code, name, rank`,
          [req.params.id, code, name, rank]);
        if (!rows.length) throw err("not_permitted", 403);
        const d = rows[0];
        return { id: d.id, competitionId: d.competition_id, code: d.code, name: d.name, rank: d.rank };
      });
    }),

    // POST /api/competition-entrants/:id/division { divisionId | null }
    place: handle(async (req) => {
      const d = req.body?.divisionId ?? null;
      if (d !== null && !UUID.test(String(d))) throw err("division_invalid");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(`select * from place_entrant($1, $2)`, [req.params.id, d]);
        const r = rows[0] ?? { ok: false, reason: "no_result" };
        if (r.ok === false) throw err(r.reason || "refused", r.reason === "no_such_entrant" ? 404 : 403);
        return { entrantId: req.params.id, divisionId: d };
      });
    }),
  };
}

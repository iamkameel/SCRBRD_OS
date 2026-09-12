/**
 * SCRBRD — awarding honours and keeping the caps ledger.
 *
 * Three acts on an honour: award it, withdraw it with a reason, and say
 * whether it may go on a public board. There is no edit — a wrong honour is
 * withdrawn and awarded again, and the board shows both. One act on caps:
 * setting where a side's ledger starts, the caps it awarded before the
 * platform was counting. Cap numbers themselves are derived from the team
 * sheets and cannot be typed in; milestones are derived from the ball log
 * and cannot be typed in either. Nothing here is a points total.
 *
 * WHO MAY: the tables' policies, under recognition.manage — the director of
 * sport, the principal, the school office. A refused write is an empty
 * result, not a branch here. school_id and team_code are stamped from the
 * player, awarded_by from the session; the request supplies none of them.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });
const KINDS = ["colours", "half_colours", "honours", "captain", "vice_captain", "player_of_season", "award"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEASON = /^\d{4}(\/\d{2})?$/;
const isoDate = (v, code) => {
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw err(code);
  return s;
};

export function recognitionRoutes({ pool, secret }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      // 23514 is the table's own rule — an unnamed award, an edit after the
      // fact — and 23505 is the one-a-season index. Both say which.
      if (e.code === "23514") return res.status(422).json({ error: "invalid_honour", detail: e.message });
      if (e.code === "23505") return res.status(422).json({ error: "already_awarded_this_season", detail: e.detail });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_player" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  return {
    // POST /api/honours { playerId, kind, name?, season, citation?, awardedOn?, isPublic? }
    award: handle(async (req) => {
      const b = req.body || {};
      if (!UUID.test(String(b.playerId ?? ""))) throw err("player_required");
      if (!KINDS.includes(b.kind)) throw err("kind_invalid");
      const name = b.name == null || String(b.name).trim() === "" ? null : String(b.name).trim();
      if (b.kind === "award" && !name) throw err("award_needs_a_name");
      if (name && (name.length < 3 || name.length > 80)) throw err("name_invalid");
      const season = String(b.season ?? "").trim();
      if (!SEASON.test(season)) throw err("season_must_be_yyyy_or_yyyy_slash_yy");
      const citation = b.citation == null || String(b.citation).trim() === "" ? null : String(b.citation).trim().slice(0, 300);
      const awardedOn = isoDate(b.awardedOn, "awarded_on_must_be_yyyy_mm_dd");
      const isPublic = b.isPublic === true;

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into honour (player_id, kind, name, season, citation, awarded_on, is_public)
           values ($1, $2, $3, $4, $5, coalesce($6::date, sa_today()), $7)
           returning id, player_id, school_id, team_code, kind, name, season, citation, awarded_on, is_public, awarded_by`,
          [b.playerId, b.kind, name, season, citation, awardedOn, isPublic]);
        if (!rows.length) throw err("not_permitted", 403);
        const h = rows[0];
        return { id: h.id, playerId: h.player_id, schoolId: h.school_id, teamCode: h.team_code, kind: h.kind,
                 name: h.name, season: h.season, citation: h.citation, awardedOn: String(h.awarded_on).slice(0, 10),
                 isPublic: h.is_public, awardedBy: h.awarded_by };
      });
    }),

    // POST /api/honours/:id/withdraw { reason }
    withdraw: handle(async (req) => {
      const reason = String(req.body?.reason ?? "").trim();
      if (reason.length < 3 || reason.length > 200) throw err("reason_required");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rowCount } = await client.query(
          `update honour set withdrawn_at = now(), withdrawn_reason = $2
            where id = $1 and withdrawn_at is null`, [req.params.id, reason]);
        // "Not yours" and "already withdrawn" are the same silence: confirming
        // an honour id exists for a boy the caller may not read is the leak.
        return { withdrawn: rowCount };
      });
    }),

    // POST /api/honours/:id/public { isPublic }
    setPublic: handle(async (req) => {
      if (typeof req.body?.isPublic !== "boolean") throw err("is_public_required");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rowCount } = await client.query(
          `update honour set is_public = $2 where id = $1 and withdrawn_at is null`, [req.params.id, req.body.isPublic]);
        return { updated: rowCount };
      });
    }),

    // POST /api/cap-baselines { schoolId, teamCode, capsBefore, asOf, note? }
    baseline: handle(async (req) => {
      const b = req.body || {};
      if (!UUID.test(String(b.schoolId ?? ""))) throw err("school_required");
      const team = String(b.teamCode ?? "").trim();
      if (!/^[A-Z0-9]{2,8}$/.test(team)) throw err("team_code_invalid");
      const caps = Number(b.capsBefore);
      if (!Number.isInteger(caps) || caps < 0 || caps > 100000) throw err("caps_before_invalid");
      const asOf = isoDate(b.asOf, "as_of_must_be_yyyy_mm_dd");
      if (!asOf) throw err("as_of_required");
      const note = b.note == null || String(b.note).trim() === "" ? null : String(b.note).trim().slice(0, 200);
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into cap_baseline (school_id, team_code, caps_before, as_of, note)
           values ($1, $2, $3, $4, $5)
           on conflict (school_id, team_code) do update
             set caps_before = excluded.caps_before, as_of = excluded.as_of, note = excluded.note
           returning school_id, team_code, caps_before, as_of, set_by`,
          [b.schoolId, team, caps, asOf, note]);
        if (!rows.length) throw err("not_permitted", 403);
        const r = rows[0];
        return { schoolId: r.school_id, teamCode: r.team_code, capsBefore: r.caps_before, asOf: String(r.as_of).slice(0, 10), setBy: r.set_by };
      });
    }),
  };
}

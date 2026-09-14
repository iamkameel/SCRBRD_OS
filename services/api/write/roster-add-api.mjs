/**
 * SCRBRD — a boy joins the school's roster, one at a time.
 *
 * Until now a player could only be created by the CSV import
 * (services/api/io/import-api.mjs) — fine for the start of a season, useless
 * for the boy who transfers in on a Tuesday in June. This is the same
 * dedupe rule the import uses, at the scale of one form: a name that already
 * exists at the school is an ambiguous target, not a thing to guess about,
 * so it is refused by name rather than silently creating a second row.
 *
 * player.profile.manage is the write capability — directorofsport,
 * schooladmin, sportsadmin — the same trio the import runs under. Nothing
 * here decides who may add a player; the insert policy on `player` does,
 * and an empty result is the refusal.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["batter", "bowler", "allrounder", "keeper"];
const clean = (v, max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

export function rosterAddRoutes({ pool, secret }) {
  return {
    // POST /api/players { schoolId, fullName, teamCode?, squadNo?, playingRole?,
    //                     battingStyle?, bowlingStyle?, born? }
    add: async (req, res) => {
      try {
        const b = req.body || {};
        if (!UUID.test(String(b.schoolId ?? ""))) throw err("school_required");
        const fullName = clean(b.fullName, 80);
        if (!fullName || fullName.length < 2) throw err("name_required");
        const team = clean(b.teamCode, 8);
        if (team && !/^[A-Z0-9]{2,8}$/.test(team)) throw err("team_code_invalid");
        if (b.playingRole != null && b.playingRole !== "" && !ROLES.includes(b.playingRole)) throw err("role_invalid");
        let squadNo = null;
        if (b.squadNo != null && b.squadNo !== "") {
          squadNo = Number(b.squadNo);
          if (!Number.isInteger(squadNo) || squadNo < 0 || squadNo > 999) throw err("squad_no_invalid");
        }
        let born = null;
        if (b.born != null && b.born !== "") {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.born))) throw err("born_must_be_yyyy_mm_dd");
          born = String(b.born);
        }

        await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          // Same rule as the bulk import: nought found is an insert, one
          // found is a refusal naming the boy already on the books, and the
          // office decides from there rather than the form guessing.
          const { rows: existing } = await client.query(
            `select id from player where school_id = $1 and lower(btrim(full_name)) = lower($2)`,
            [b.schoolId, fullName]);
          if (existing.length) throw err("already_on_the_roster", 422);

          const { rows } = await client.query(
            `insert into player (school_id, team_code, full_name, squad_no, playing_role,
                                  batting_style, bowling_style, born)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             returning id, school_id, team_code, full_name`,
            [b.schoolId, team, fullName, squadNo, b.playingRole || null,
             clean(b.battingStyle, 30), clean(b.bowlingStyle, 30), born]);
          if (!rows.length) throw err("not_permitted", 403);
          const p = rows[0];
          res.json({ id: p.id, schoolId: p.school_id, teamCode: p.team_code, fullName: p.full_name });
        });
      } catch (e) {
        if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
        if (e.code === "23503") return res.status(404).json({ error: "no_such_school" });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}

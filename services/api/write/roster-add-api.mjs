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
import { resolveBirthDate } from "@scrbrd/policy/date-of-birth";

const err = (code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["batter", "bowler", "allrounder", "keeper"];
// The same closed vocabularies the CHECK constraints on player enforce —
// validated here too, so a bad value gets one clean sentence back rather than
// a raw Postgres constraint-violation message. R/L for the hand and the arm,
// F/M/S for pace vs spin — an arm and a pace are independent facts, which is
// why they are two fields.
const HAND = ["R", "L"];
const PACE = ["F", "M", "S"];
const clean = (v, max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
const oneOf = (v, allowed, code) => {
  if (v == null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  if (!allowed.includes(s)) throw err(code);
  return s;
};

export function rosterAddRoutes({ pool, secret }) {
  return {
    // POST /api/players { schoolId, fullName, teamCode?, squadNo?, playingRole?,
    //                     battingStyle?, bowlingArm?, bowlingStyle?, born?, idNumber? }
    //
    // born OR idNumber is now REQUIRED — see resolveBirthDate(). A boy entered
    // without one is a boy whose family can never be linked, because the
    // guardian rules refuse a link they cannot put an end date on, and the
    // office would not find that out until a parent asked why they cannot see
    // their son.
    add: async (req, res) => {
      try {
        const b = req.body || {};
        if (!UUID.test(String(b.schoolId ?? ""))) throw err("school_required");
        const fullName = clean(b.fullName, 80);
        if (!fullName || fullName.length < 2) throw err("name_required");
        const team = clean(b.teamCode, 8);
        if (team && !/^[A-Z0-9]{2,8}$/.test(team)) throw err("team_code_invalid");
        if (b.playingRole != null && b.playingRole !== "" && !ROLES.includes(b.playingRole)) throw err("role_invalid");
        const battingStyle = oneOf(b.battingStyle, HAND, "batting_style_invalid");
        const bowlingArm = oneOf(b.bowlingArm, HAND, "bowling_arm_invalid");
        const bowlingStyle = oneOf(b.bowlingStyle, PACE, "bowling_style_invalid");
        let squadNo = null;
        if (b.squadNo != null && b.squadNo !== "") {
          squadNo = Number(b.squadNo);
          if (!Number.isInteger(squadNo) || squadNo < 0 || squadNo > 999) throw err("squad_no_invalid");
        }
        // The plausibility window and the yyyy-mm-dd rule used to live here as
        // eleven lines the CSV import did not have. They are shared now: one
        // rule, three doors.
        const dob = resolveBirthDate({ born: b.born, idNumber: b.idNumber });
        // 400, like every other field refusal on this route — a batting hand
        // outside R/L is a 400 here and a birthday outside the plausible window
        // is the same kind of answer.
        if (!dob.ok) throw err(dob.reason);
        const { born, idNumber } = dob;

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
                                  batting_style, bowling_arm, bowling_style, born, id_number)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             returning id, school_id, team_code, full_name`,
            [b.schoolId, team, fullName, squadNo, b.playingRole || null,
             battingStyle, bowlingArm, bowlingStyle, born, idNumber]);
          if (!rows.length) throw err("not_permitted", 403);
          const p = rows[0];
          res.json({ id: p.id, schoolId: p.school_id, teamCode: p.team_code, fullName: p.full_name,
                     // Where the birthday came from, and anything worth a second
                     // look. A warning the server keeps to itself is not a warning.
                     bornFrom: dob.source, ...(dob.warning ? { warning: dob.warning } : {}) });
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

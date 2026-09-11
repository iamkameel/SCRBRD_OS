/**
 * SCRBRD — arranging a fixture, which until now could only be done in SQL.
 *
 * `match` has been the centre of this schema since the first commit and there
 * has never been a route that creates one. Fixtures arrived by seed or by
 * migration, which means fixture.update — a capability in five roles — has sat
 * in the model with nothing it could be exercised on, the same way the three
 * transport capabilities did before they had a module. A school-sport platform
 * whose most basic act requires a database client is not finished.
 *
 * THE AWAY SIDE IS NAMED ONE OF TWO WAYS, and the route makes you choose:
 *
 *   opponent: "Michaelhouse 1st XI"      — a school SCRBRD does not host.
 *                                          Free text, exactly as before.
 *   awaySchoolId + awayTeamCode          — a school that IS a tenant. Then the
 *                                          fixture is ONE row both schools
 *                                          read, and `opponent` is stamped from
 *                                          the away school's name by a trigger
 *                                          rather than typed.
 *
 * Supplying both is refused rather than reconciled. They are two answers to
 * one question and picking a winner here would mean the API quietly deciding
 * which school a fixture is against.
 *
 * EVERY AUTHORIZATION ANSWER COMES FROM THE POLICY. This validates vocabulary
 * and shape; whether this person may arrange a fixture for that school and
 * team is decided by match_insert in db/09, and an empty result is the
 * refusal. Notably the away school is NOT checked for permission — arranging a
 * fixture against Westville does not require anything at Westville, exactly as
 * putting "Michaelhouse" in a text box never did. What the away school gets is
 * the ability to READ it, which is the point.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });

const STATUS = ["scheduled", "live", "complete", "abandoned"];

export function fixtureRoutes({ pool, secret }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      // 23514 is one of the fixture's own rules — a sport the school has not
      // been granted, an over count on a hockey match, a side playing itself,
      // a played fixture whose opponent somebody tried to change. Every one of
      // those messages names the thing that is wrong, so they are passed
      // through rather than flattened.
      if (e.code === "23514") return res.status(422).json({ error: "invalid_fixture", detail: e.message });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_school_ground_or_sport", detail: e.message });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  /** The away side, validated into the one shape the database takes. */
  const awaySide = (b) => {
    const named = b.awaySchoolId != null && String(b.awaySchoolId) !== "";
    const typed = b.opponent != null && String(b.opponent).trim() !== "";
    if (named && typed) throw err("name_the_away_side_once");
    if (named) {
      if (!b.awayTeamCode || !String(b.awayTeamCode).trim()) throw err("away_team_required");
      // opponent is stamped by the trigger; a placeholder is sent only because
      // the column is NOT NULL and the trigger runs after the value arrives.
      return { school: b.awaySchoolId, team: String(b.awayTeamCode).trim(), label: "pending" };
    }
    if (!typed) throw err("opponent_required");
    return { school: null, team: null, label: String(b.opponent).trim().slice(0, 120) };
  };

  return {
    // POST /api/fixtures { schoolId, teamCode, startsAt, sport?, groundId?,
    //                      format?, overs?, opponent? | awaySchoolId+awayTeamCode }
    create: handle(async (req) => {
      const b = req.body || {};
      if (!b.schoolId) throw err("school_required");
      if (!b.teamCode || !String(b.teamCode).trim()) throw err("team_required");
      if (!b.startsAt) throw err("starts_at_required");
      const when = new Date(b.startsAt);
      if (Number.isNaN(when.getTime())) throw err("starts_at_invalid");
      const sport = b.sport == null || b.sport === "" ? "cricket" : String(b.sport);
      const status = b.status ?? "scheduled";
      if (!STATUS.includes(status)) throw err("status_invalid");

      // Cricket's two columns, and the database's constraints behind them. The
      // shape is checked here so a sportsmaster is told which field is wrong
      // rather than reading a constraint name.
      const cricket = sport === "cricket";
      const format = b.format == null || b.format === "" ? (cricket ? "T20" : null) : String(b.format);
      if (cricket && !format) throw err("format_required_for_cricket");
      let overs = null;
      if (b.overs != null && b.overs !== "") {
        if (!cricket) throw err("overs_are_a_cricket_unit");
        overs = Number(b.overs);
        if (!Number.isInteger(overs) || overs < 1 || overs > 120) throw err("overs_invalid");
      } else if (cricket) {
        overs = 20;
      }

      const away = awaySide(b);

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into match (school_id, team_code, away_school_id, away_team_code,
                              opponent, ground_id, starts_at, sport, format, overs, status)
           values ($1, btrim($2), $3, $4, $5, $6, $7, $8, $9, $10, $11)
           returning id, school_id, team_code, away_school_id, away_team_code,
                     opponent, starts_at, sport, format, overs, status`,
          [b.schoolId, b.teamCode, away.school, away.team, away.label,
           b.groundId ?? null, when.toISOString(), sport, format, overs, status]);
        if (!rows.length) throw err("not_permitted", 403);
        const m = rows[0];
        return { id: m.id, school: m.school_id, team: m.team_code,
                 awaySchool: m.away_school_id, awayTeam: m.away_team_code,
                 opponent: m.opponent, startsAt: m.starts_at, sport: m.sport,
                 format: m.format, overs: m.overs, status: m.status,
                 // Said back explicitly, because it is the thing a sportsmaster
                 // arranging a derby wants to know: is the other school going
                 // to see this, or am I keeping my own copy?
                 sharedWithOpponent: m.away_school_id != null };
      });
    }),

    // POST /api/fixtures/:id { startsAt?, groundId?, status? }
    //
    // Rescheduling and calling a match off. Deliberately NOT the away side or
    // the sport: both are frozen by triggers once there is a ball log, and
    // before that they are better corrected by arranging the right fixture
    // than by mutating the wrong one into it.
    amend: handle(async (req) => {
      const b = req.body || {};
      const when = b.startsAt == null ? null : new Date(b.startsAt);
      if (when && Number.isNaN(when.getTime())) throw err("starts_at_invalid");
      if (b.status != null && !STATUS.includes(b.status)) throw err("status_invalid");
      if (when === null && b.groundId === undefined && b.status == null) throw err("nothing_to_change");

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `update match
              set starts_at = coalesce($2::timestamptz, starts_at),
                  ground_id = case when $3::boolean then $4::uuid else ground_id end,
                  status    = coalesce($5, status)
            where id = $1
           returning id, starts_at, ground_id, status`,
          [req.params.id, when ? when.toISOString() : null,
           b.groundId !== undefined, b.groundId ?? null, b.status ?? null]);
        // No row is either "no such fixture" or "not yours to move", and the
        // API must not distinguish them: telling somebody a fixture exists at a
        // school they have no assignment at is the disclosure.
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id, startsAt: rows[0].starts_at,
                 ground: rows[0].ground_id, status: rows[0].status };
      });
    }),
  };
}

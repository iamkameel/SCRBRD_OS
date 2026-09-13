/**
 * SCRBRD — moving a boy between sides, with the date it took effect.
 *
 * There was no route for this. A boy's side changed through the CSV import or
 * not at all, which is how a promotion in March became a re-import of a
 * spreadsheet — and, until team_membership existed, an overwrite of where he
 * had been.
 *
 * THE ROUTE WRITES THE COLUMN, AND ONLY THE COLUMN. It updates player.team_code
 * exactly as the import does; the history row is the trigger's, and this file
 * has no INSERT into team_membership at all. If it did, there would be two
 * places history is written and the second would drift from the first. What
 * this route adds over a raw UPDATE is the three things the column cannot
 * carry — WHEN it took effect — handed to the trigger through a
 * transaction-local setting, the same channel the seed uses to date the
 * pilot's sides to January.
 *
 * WHO MAY MOVE HIM is the player policy's answer, not this file's: the UPDATE
 * is refused by row-level security under player.profile.manage, and an empty
 * result is the refusal. A move INTO a side the mover does not hold is allowed
 * when the row they are updating is in a side they do — the history is still
 * recorded, with definer rights, because the record is of an act already
 * permitted. See player_team_history() in db/08.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });

export function rosterRoutes({ pool, secret }) {
  return {
    // POST /api/players/:id/team { teamCode, effectiveOn? }
    //
    // No reason and no note, deliberately. team_membership records 'joined' or
    // 'moved' and nothing richer, because "promoted" is a judgement about
    // direction that a column write does not carry — see the table's own note
    // in db/08. What a coach thinks of the move belongs in a development note,
    // which already exists and is already governed.
    move: async (req, res) => {
      try {
        const b = req.body || {};
        const team = String(b.teamCode ?? "").trim();
        if (!team) throw err("team_required");
        // A date, not a timestamp: a selection decision belongs to a day. Left
        // empty it is today; given, it may be in the past (a decision recorded
        // late) and the trigger refuses one earlier than the membership it
        // would close. The future is refused here: a side a boy WILL be in is
        // a plan, and this table records what happened.
        let on = null;
        if (b.effectiveOn != null && b.effectiveOn !== "") {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.effectiveOn))) throw err("effective_on_invalid");
          on = String(b.effectiveOn);
          if (on > new Date().toISOString().slice(0, 10)) throw err("effective_on_in_future");
        }

        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          // Transaction-local, so nothing outlives this request; unset, the
          // trigger dates the move today.
          await client.query(`select set_config('app.effective_on', $1, true)`, [on ?? ""]);
          const { rows } = await client.query(
            `update player set team_code = $2 where id = $1
             returning id, team_code`, [req.params.id, team]);
          if (!rows.length) throw err("not_permitted", 403);
          const { rows: hist } = await client.query(
            `select team_code, joined_on, left_on from team_membership
              where player_id = $1 and sport = 'cricket'
              order by joined_on desc, created_at desc limit 2`,
            [req.params.id]);
          return {
            playerId: rows[0].id, teamCode: rows[0].team_code,
            effectiveOn: hist[0]?.joined_on ?? null,
            previous: hist[1] ? { teamCode: hist[1].team_code, leftOn: hist[1].left_on } : null,
          };
        });
        res.json(out);
      } catch (e) {
        // 23514 is the trigger refusing a backdate earlier than the membership
        // it would close, and its message says which dates collided.
        if (e.code === "23514") return res.status(422).json({ error: "invalid_move", detail: e.message });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}

/**
 * SCRBRD — the one door back from a NULL date of birth.
 *
 * db/11 refuses a new player with no birthday and db/10 ends a guardian link
 * that cannot be given an end date without one, and both of them told the
 * office to fix it and left them nowhere to do it: there was no route that
 * ever wrote player.born after the row was created. dob_gaps()
 * (services/api/read/read-api.mjs) surfaces the boys this happened to; this
 * is the write that closes the gap it names.
 *
 * WRITES ONLY WHERE born IS NULL. That is the WHERE clause, not a check in
 * this file, so two people fixing the same gap resolve to whichever request
 * the database sees first — the second gets not_permitted rather than quietly
 * overwriting a birthday somebody already captured. CORRECTING an existing,
 * wrong date of birth is a different and larger decision: it can move a
 * guardian's access, an age-band eligibility, a clearance window, and it
 * stays out of reach of this route on purpose.
 *
 * player.profile.manage is the write capability, the same one that governs
 * player_update in db/09 — this route asks nothing of RBAC that the row's own
 * policy does not already decide.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { resolveBirthDate } from "@scrbrd/policy/date-of-birth";

const err = (code, status = 400) => Object.assign(new Error(code), { status });

export function dobCaptureRoutes({ pool, secret }) {
  return {
    // POST /api/players/:id/date-of-birth { born?, idNumber? }
    capture: async (req, res) => {
      try {
        const b = req.body || {};
        const dob = resolveBirthDate({ born: b.born, idNumber: b.idNumber });
        if (!dob.ok) throw err(dob.reason);
        const { born, idNumber } = dob;

        await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const { rows } = await client.query(
            `update player set born = $2, id_number = coalesce(id_number, $3)
              where id = $1 and born is null
              returning id, school_id, team_code, full_name`,
            [req.params.id, born, idNumber]);
          if (!rows.length) throw err("not_permitted", 403);
          const p = rows[0];
          // `born`, not p.born: the DATE column comes back through pg as a
          // JS Date and JSON.stringify renders it as a full UTC timestamp —
          // the same yyyy-mm-dd resolveBirthDate() already resolved is what
          // the caller sent and what a screen should echo back.
          res.json({ id: p.id, schoolId: p.school_id, teamCode: p.team_code, fullName: p.full_name,
                     born, bornFrom: dob.source, ...(dob.warning ? { warning: dob.warning } : {}) });
        });
      } catch (e) {
        if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}

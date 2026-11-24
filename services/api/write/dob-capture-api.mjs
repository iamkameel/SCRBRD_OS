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
 *
 * CORRECTING ONE IS THE OFFICE'S (Kameel, 20 Nov 2026: "The office corrects
 * it; every change is audited"). db/172 gives it one door,
 * player_born_correct(), which this file's `correct` calls, and a record of
 * every change, written by a trigger on the column so that no route can
 * write born without it. The same trigger refuses a date of birth that
 * disagrees with the ID number on file, whoever writes it, so the capture
 * below meets that rule too: the date it is given is compared with the
 * number already on his record, not only with one typed beside it.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { resolveBirthDate, BORN_REFUSED_BY_DB } from "@scrbrd/policy/date-of-birth";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * db/172's trigger refusals, by name: the reason a screen reads, and the status.
 * @param {any} e
 * @returns {{ status: number, error: string } | null}
 */
export function bornRefusal(e) {
  if (!e || !BORN_REFUSED_BY_DB.includes(e.message)) return null;
  return { status: e.message === "born_correction_is_the_office" ? 403 : 422, error: e.message };
}

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
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
      } catch (/** @type {any} */ e) {
        const named = bornRefusal(e);
        if (named) return res.status(named.status).json({ error: named.error });
        if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },

    // POST /api/players/:id/date-of-birth/correction { born }
    // The office changes a date already on record (or fills one). The format
    // and the age band are resolveBirthDate()'s, as at every door; who may,
    // and the ID number on file, are the database's (player_born_correct()).
    correct: async (req, res) => {
      try {
        const id = String(req.params.id ?? "");
        if (!UUID.test(id)) throw err("not_found", 404);
        const b = req.body || {};
        // The date alone: an ID number is not corrected here, so one typed
        // beside it would be a second, unchecked claim.
        const dob = resolveBirthDate({ born: b.born });
        if (!dob.ok) throw err(dob.reason);
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const { rows } = await client.query(
            `select ok, reason, to_char(was, 'YYYY-MM-DD') as was, to_char(born, 'YYYY-MM-DD') as born
               from player_born_correct($1::uuid, $2::date)`, [id, dob.born]);
          return rows[0];
        });
        if (!out?.ok) {
          const reason = out?.reason || "refused";
          throw err(reason, reason === "not_permitted" ? 403 : 422);
        }
        res.json({ id, born: out.born, was: out.was, unchanged: out.reason === "unchanged" });
      } catch (/** @type {any} */ e) {
        const named = bornRefusal(e);
        if (named) return res.status(named.status).json({ error: named.error });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },

    // GET /api/players/:id/date-of-birth/changes
    // The office's read: the date on record now, and every change to it,
    // newest first. Anyone else is refused, not answered empty.
    changes: async (req, res) => {
      try {
        const id = String(req.params.id ?? "");
        if (!UUID.test(id)) throw err("not_found", 404);
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const [p] = (await client.query(
            `select to_char(m.born, 'YYYY-MM-DD') as born, player_born_office(m.school_id) as office
               from player_masked m where m.id = $1`, [id])).rows;
          if (!p?.office) return null;
          const { rows } = await client.query(
            `select at, to_char(was, 'YYYY-MM-DD') as was, to_char(became, 'YYYY-MM-DD') as became, how, by_name
               from player_born_changes($1::uuid)`, [id]);
          return { born: p.born, changes: rows.map((r) => ({ at: r.at, was: r.was, became: r.became, how: r.how, by: r.by_name })) };
        });
        if (!out) throw err("not_permitted", 403);
        res.json(out);
      } catch (/** @type {any} */ e) {
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}

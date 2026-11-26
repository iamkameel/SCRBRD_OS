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
 *
 * THREE REFUSED TRIES A DAY (Kameel, 26 Nov 2026, Q2). "Record it" stays open
 * to a caller who may manage the boy. Each try the database refuses is
 * recorded (db/176's player_born_refused(): who, when, which boy, never the
 * date), and from anyone but his school's office, after three in the school's
 * day no try is taken for him until the next (born_tries_used, 429), whatever
 * the date. The office is not counted: it reads the ID number on file.
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
  // born_needs_the_office stays a 422: it is also the answer a caller who may
  // not read ID numbers is given for a date that disagrees with one on file.
  return { status: e.message.endsWith("_is_the_office") || e.message === "id_number_needs_the_office" || e.message === "born_own_child" ? 403 : 422,
           error: e.message };
}

/**
 * born_links_to_review()'s columns (db/176), the days as the database writes
 * them (YYYY-MM-DD), never a Date: pg would read a date at local midnight.
 */
const LINK_COLS = `l.player_id, l.full_name, l.team_code, l.link_id, l.guardian_name,
                   to_char(l.ends_on, 'YYYY-MM-DD') as ends_on, l.why,
                   to_char(l.old_of_age_on, 'YYYY-MM-DD') as old_of_age_on,
                   to_char(l.of_age_on, 'YYYY-MM-DD') as of_age_on, l.corrected_at`;

/**
 * One row of born_links_to_review() (db/176), in the route's words.
 * @param {any} r
 */
export const linkRow = (r) => ({
  playerId: r.player_id, fullName: r.full_name, teamCode: r.team_code ?? null,
  linkId: r.link_id, guardianName: r.guardian_name ?? null,
  endsOn: r.ends_on ?? null, why: r.why, oldOfAgeOn: r.old_of_age_on ?? null, ofAgeOn: r.of_age_on ?? null,
  correctedAt: r.corrected_at ?? null,
});

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function dobCaptureRoutes({ pool, secret }) {
  return {
    // POST /api/players/:id/date-of-birth { born?, idNumber? }
    capture: async (req, res) => {
      let office = false;
      /** @type {any} */ let refused = null;
      try {
        const b = req.body || {};
        const dob = resolveBirthDate({ born: b.born, idNumber: b.idNumber });
        if (!dob.ok) throw err(dob.reason);
        const { born, idNumber } = dob;

        await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          // Asked before the write, while the transaction can still answer:
          // a refusal against the ID number on file is said in those words to
          // the office alone (review N1).
          office = (await client.query(
            `select player_born_office(m.school_id) as office from player_masked m where m.id = $1`,
            [req.params.id])).rows[0]?.office === true;
          // An ID number, first or not, is the office's to write (db/173;
          // Kameel, 25 Nov 2026). Refused before the write, so the answer is
          // the same whether or not one is already on his record.
          if (idNumber && !office) throw err("id_number_needs_the_office", 403);
          // Q2: no try once three are refused today, from anyone but the
          // office. NULL (one who may not manage him) goes on to the write,
          // which his row's policy refuses as before.
          if (!office) {
            const left = (await client.query(`select player_born_tries_left($1) as n`, [req.params.id])).rows[0]?.n;
            if (left === 0) throw err("born_tries_used", 429);
          }
          // The write under a savepoint, so a refusal of the database's is
          // recorded in this same transaction and the record commits.
          await client.query("SAVEPOINT born_try");
          /** @type {any[]} */ let rows;
          try {
            ({ rows } = await client.query(
              `update player set born = $2, id_number = coalesce(id_number, $3)
                where id = $1 and born is null
                returning id, school_id, team_code, full_name`,
              [req.params.id, born, idNumber]));
          } catch (/** @type {any} */ e) {
            if (!bornRefusal(e)) throw e;
            await client.query("ROLLBACK TO SAVEPOINT born_try");
            await client.query(`select player_born_refused($1)`, [req.params.id]);
            refused = e;
            return;
          }
          await client.query("RELEASE SAVEPOINT born_try");
          if (!rows.length) throw err("not_permitted", 403);
          const p = rows[0];
          // `born`, not p.born: the DATE column comes back through pg as a
          // JS Date and JSON.stringify renders it as a full UTC timestamp —
          // the same yyyy-mm-dd resolveBirthDate() already resolved is what
          // the caller sent and what a screen should echo back.
          res.json({ id: p.id, schoolId: p.school_id, teamCode: p.team_code, fullName: p.full_name,
                     born, bornFrom: dob.source, ...(dob.warning ? { warning: dob.warning } : {}) });
        });
        if (refused) throw refused;
      } catch (/** @type {any} */ e) {
        const named = bornRefusal(e);
        if (named?.error === "id_number_disagrees_with_date_of_birth" && !office) {
          return res.status(422).json({ error: "born_needs_the_office" });
        }
        if (named) return res.status(named.status).json({ error: named.error });
        if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },

    // POST /api/players/:id/date-of-birth/correction { born, reason }
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
        // Why, in the office's words (Kameel, 25 Nov 2026). Required by the
        // door for a correction, and not asked for filling a missing date
        // (review B N8); words, at least one letter or digit (N1).
        const typed = typeof b.reason === "string" ? b.reason.trim() : "";
        const why = /[\p{L}\p{N}]/u.test(typed) ? typed : null;
        if (why && why.length > 200) throw err("reason_too_long");
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const { rows } = await client.query(
            `select ok, reason, to_char(was, 'YYYY-MM-DD') as was, to_char(born, 'YYYY-MM-DD') as born
               from player_born_correct($1::uuid, $2::date, $3::text)`, [id, dob.born, why]);
          const r = rows[0];
          // db/176 (the re-dating design §3.2, Q4; Kameel, 25 Nov 2026): the
          // guardian links whose end date the old date set, listed for the
          // office to act on, in the same transaction as the change. Nothing
          // about them is changed here.
          if (r?.ok && r.reason !== "unchanged") {
            const links = (await client.query(
              `select ${LINK_COLS} from player_masked p cross join lateral born_links_to_review(p.school_id, p.id) l where p.id = $1::uuid`,
              [id])).rows;
            return { ...r, links: links.map(linkRow) };
          }
          return r;
        });
        if (!out?.ok) {
          const reason = out?.reason || "refused";
          throw err(reason, reason === "not_permitted" ? 403 : 422);
        }
        res.json({ id, born: out.born, was: out.was, unchanged: out.reason === "unchanged", links: out.links ?? [] });
      } catch (/** @type {any} */ e) {
        const named = bornRefusal(e);
        if (named) return res.status(named.status).json({ error: named.error });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },

    // GET /api/schools/:id/coming-of-age
    // "Coming of age" (db/173; Kameel, 25 Nov 2026, Q2): the boys at the
    // school who are 18, or will be within 60 days, on a date no office person
    // wrote or confirmed. The school's office alone; anyone else is refused.
    comingOfAge: async (req, res) => {
      try {
        const school = String(req.params.id ?? "");
        if (!UUID.test(school)) throw err("not_found", 404);
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const [o] = (await client.query(`select player_born_office($1::uuid) as office`, [school])).rows;
          if (o?.office !== true) return null;
          const { rows } = await client.query(
            `select player_id, full_name, team_code, to_char(born, 'YYYY-MM-DD') as born, to_char(of_age_on, 'YYYY-MM-DD') as of_age_on,
                    how, written_at from born_unconfirmed($1::uuid)`, [school]);
          return rows.map((r) => ({ playerId: r.player_id, fullName: r.full_name, teamCode: r.team_code, born: r.born,
                                    ofAgeOn: r.of_age_on, how: r.how ?? null, writtenAt: r.written_at ?? null }));
        });
        if (!out) throw err("not_permitted", 403);
        res.json({ rows: out });
      } catch (/** @type {any} */ e) {
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },

    // GET /api/schools/:id/date-of-birth/links
    // db/176 (the re-dating design §3.2, Q4; Kameel, 25 Nov 2026): every
    // guardian link at the school whose end date a since-corrected date of
    // birth set, for the office to reopen or end by its own act. The school's
    // office alone; anyone else is refused.
    linksToReview: async (req, res) => {
      try {
        const school = String(req.params.id ?? "");
        if (!UUID.test(school)) throw err("not_found", 404);
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const [o] = (await client.query(`select player_born_office($1::uuid) as office`, [school])).rows;
          if (o?.office !== true) return null;
          const { rows } = await client.query(`select ${LINK_COLS} from born_links_to_review($1::uuid) l`, [school]);
          return rows.map(linkRow);
        });
        if (!out) throw err("not_permitted", 403);
        res.json({ rows: out });
      } catch (/** @type {any} */ e) {
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },

    // POST /api/players/:id/date-of-birth/confirm
    // The office's "Confirm his date" (db/173): the date on record, checked.
    confirm: async (req, res) => {
      try {
        const id = String(req.params.id ?? "");
        if (!UUID.test(id)) throw err("not_found", 404);
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) =>
          (await client.query(`select ok, reason from player_born_confirm($1::uuid)`, [id])).rows[0]);
        if (!r?.ok) {
          const reason = r?.reason || "refused";
          throw err(reason, reason === "not_permitted" ? 403 : 422);
        }
        res.json({ id, confirmed: true, unchanged: r.reason === "unchanged" });
      } catch (/** @type {any} */ e) {
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
            `select at, to_char(was, 'YYYY-MM-DD') as was, to_char(became, 'YYYY-MM-DD') as became, how, by_name, reason
               from player_born_changes($1::uuid)`, [id]);
          return { born: p.born, changes: rows.map((r) => ({ at: r.at, was: r.was, became: r.became, how: r.how, by: r.by_name,
                                                              reason: r.reason ?? null })) };
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

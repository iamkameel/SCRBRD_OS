/**
 * SCRBRD — a child's name on the public pages: the family's consent, the
 * never-public mark, and a school's names-off switch per age group
 * (SCRBRD-083, PUBLIC_DATA §4 C1–C5; docs/pilot/PILOT_LOAD gap 5).
 *
 * The doors are db/47's (and db/62's re-emitted consent): each checks its own
 * authority, and this file only calls them as the caller. Nothing here decides
 * who may.
 *
 *   public_name_consent_set()  a verified guardian for his own child; the pupil
 *                              from eighteen; the office (guardian.link.manage)
 *                              on a named guardian's behalf, from a form for a
 *                              "yes", on the family's word for a "no"
 *   player_never_public_set()  player.public.withhold (principal, school
 *   player_never_public_end()  office, director of sport)
 *   public_names_off_set()     broadcast.publish at the school, school-wide
 *
 *   GET  /api/players/:id/public-name       what this reader may see of it:
 *          `mine`       his own answer, when he answers for the child
 *          `guardians`  each guardian's answer, for the office
 *          `mark`       the mark and its reason, for player.public.withhold
 *        404 for a reader who may see none of the three
 *   POST /api/players/:id/public-name       { yes, version, guardianId?, formName?, formDate? }
 *   POST /api/players/:id/never-public      { reason }
 *   POST /api/players/:id/never-public/end
 *   GET  /api/schools/:id/public-names      each age group's names-off switch
 *   POST /api/schools/:id/public-names      { ageGroup, off }
 *
 * THE REASON FOR A MARK is read from player_never_public under its own policy,
 * which admits only player.public.withhold, and only asked for when the reader
 * holds it: nobody else's answer carries even the word "reason".
 *
 * NEVER SERVED STALE AFTER IT ANSWERS, as publication-api.mjs: once a door
 * has committed, `onChange` (public-api.mjs's changed()) drops the public
 * cache before the answer is written. A child's change is {k: "player"},
 * which drops every fixture whose log holds him; a school's switch is
 * {k: "school"}, which drops everything. db/59's triggers send the same notes
 * to every other API instance.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { initialAndSurname } from "@scrbrd/policy/public";
/** @import { RouteDeps, IdHandler } from "../api-types.mjs" */

const NIL = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The longest consent version label and admission-form name a record takes. */
export const MAX_VERSION = 64;
export const MAX_FORM_NAME = 200;
/** db/47's vocabulary for an age group (public_names_off's CHECK). */
export const AGE_GROUPS = Object.freeze(["U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18", "U19", "open"]);

/** @type {Record<string, number>} */
const STATUS = {
  not_signed_in: 401, not_permitted: 403, no_such_player: 404, no_such_school: 404,
  no_verified_link: 404, already_given: 409, already_marked: 409, not_marked: 409,
};

/** @param {unknown} v */
const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());

/**
 * A record as the screens read it: where it stands, when, and who made the
 * last act on it as one word — "you", "guardian" (the giver himself) or
 * "office" — and whether a "yes" came from a form. Never who recorded it by
 * name, nor through which link (N4).
 *
 * `version` and `recordedAt` (GA-I20 A1, N5): the wording the answer was
 * given to and the moment the record was made, as the record holds them, so
 * "What you have agreed" can say "v… · 14 Jan 2026 14:02". Both null when
 * nobody has answered.
 * @param {any} r  a public_name_consent row, or undefined
 * @param {string|null} me  the reader's own id
 * @param {string|null} giver  the giver's own id
 */
function answer(r, me, giver) {
  if (!r) return { state: "not_answered", givenOn: null, endedOn: null, fromForm: false, actor: null, version: null, recordedAt: null };
  const state = r.ended_on == null ? "given" : r.end_reason;
  const actorId = state === "withdrawn" ? r.ended_by : r.recorded_by;
  return { state, givenOn: r.given_on, endedOn: r.ended_on, fromForm: r.form_name != null,
           actor: actorId === me ? "you" : actorId === giver ? "guardian" : "office",
           version: r.version ?? null, recordedAt: r.recorded_at ?? null };
}

/** A refusal from one of the doors, as an answer. */
const refuse = (/** @type {any} */ res, /** @type {any} */ r) =>
  res.status(STATUS[r?.reason] ?? 422).json({ error: r?.reason ?? "refused" });

/** @param {any} res @param {any} e */
const fail = (res, e) => {
  if (e.code === "22P02" || e.code === "22007" || e.code === "22008") return res.status(400).json({ error: "bad_request" });
  res.status(e.status || 500).json({ error: e.code || e.message });
};

/**
 * @param {RouteDeps & {onChange?: (note: {k: string, id: string}) => void}} deps
 *   `onChange`: what a committed change is told to, before the answer
 * @returns {Record<string, IdHandler>}
 */
export function publicNameRoutes({ pool, secret, onChange }) {
  const changed = (/** @type {string} */ k, /** @type {string} */ id) => onChange?.({ k, id: id.toLowerCase() });
  return {
    // GET /api/players/:id/public-name
    read: async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
      try {
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client, principal) => {
          const q = async (/** @type {string} */ t, /** @type {any[]} */ p) => (await client.query(t, p)).rows;
          const [p] = await q(
            `select p.id, p.full_name, p.surname, p.known_as,
                    app_can('guardian.link.manage', p.school_id, '*'::text, $2::uuid, $2::uuid) as office,
                    app_can('player.public.withhold', p.school_id, p.team_code, p.id, $2::uuid) as withhold
               from player p where p.id = $1`, [id, NIL]);
          if (!p) return null;
          const me = principal.userId;
          // His own live, verified link to this child — a guardian's, or the
          // pupil's own — in my_children's terms. Through it, his latest act.
          const [link] = await q(
            `select s.id, a.role
               from role_assignment a
               join assignment_subject s on s.assignment_id = a.id
              where a.person_id = app_user_id() and s.player_id = $1
                and a.role in ('guardian', 'selfaccess')
                and a.active
                and (a.valid_from  is null or a.valid_from  <= current_date)
                and (a.valid_until is null or a.valid_until >  current_date)
                and (a.expires_at  is null or a.expires_at  >  now())
                and s.verification_state = 'verified'
                and s.valid_from <= current_date
                and (s.valid_until is null or s.valid_until > current_date)
                and (case when a.role = 'selfaccess' then s.relationship = 'self'
                          else s.relationship is distinct from 'self' end)
              order by (a.role = 'guardian') desc, s.verified_at desc nulls last
              limit 1`, [id]);
          let mine = null;
          if (link) {
            const [r] = await q(
              `select * from public_name_consent where player_id = $1 and giver_link_id = $2
                order by seq desc limit 1`, [id, link.id]);
            mine = { as: link.role === "selfaccess" ? "pupil" : "guardian", ...answer(r, me, me) };
          }
          // The office: each guardian with a live, verified link, and that
          // guardian's latest act. Only asked of a reader who records them.
          let guardians = null;
          if (p.office) {
            const rows = await q(
              `select distinct on (s.id) a.person_id, u.name, c.*
                 from assignment_subject s
                 join role_assignment a on a.id = s.assignment_id and a.role = 'guardian' and a.active
                 join app_user u on u.id = a.person_id
                 left join public_name_consent c on c.giver_link_id = s.id and c.player_id = s.player_id
                where s.player_id = $1
                  and (a.valid_from  is null or a.valid_from  <= current_date)
                  and (a.valid_until is null or a.valid_until >  current_date)
                  and (a.expires_at  is null or a.expires_at  >  now())
                  and s.verification_state = 'verified'
                  and s.relationship is distinct from 'self'
                  and s.valid_from <= current_date
                  and (s.valid_until is null or s.valid_until > current_date)
                order by s.id, c.seq desc nulls last`, [id]);
            // The office's list is as it was: where each answer stands, not the
            // wording or the moment (those are the giver's own, on `mine`).
            guardians = rows.map((r) => {
              const { version: _v, recordedAt: _t, ...a } = answer(r.id ? r : undefined, me, r.person_id);
              return { guardianId: r.person_id, name: r.name, ...a };
            })
              .sort((a, b) => String(a.name).localeCompare(String(b.name)));
          }
          // The mark: asked only of a holder, and read under its own policy.
          let mark = null;
          if (p.withhold) {
            const [m] = await q(
              `select reason, set_on from player_never_public
                where player_id = $1 and ended_on is null`, [id]);
            mark = m ? { marked: true, reason: m.reason, setOn: m.set_on } : { marked: false };
          }
          return { p, mine, guardians, mark };
        });
        if (!out || (!out.mine && !out.guardians && !out.mark)) return res.status(404).json({ error: "not_found" });
        const { p, mine, guardians, mark } = out;
        res.json({ playerId: p.id, label: initialAndSurname(p.full_name, { surname: p.surname, knownAs: p.known_as }),
                   mine, guardians, mark });
      } catch (/** @type {any} */ e) { fail(res, e); }
    },

    // POST /api/players/:id/public-name
    consent: async (req, res) => {
      const id = String(req.params.id ?? "");
      const b = req.body ?? {};
      if (!UUID.test(id)) return res.status(404).json({ error: "no_such_player" });
      if (typeof b.yes !== "boolean") return res.status(400).json({ error: "no_answer" });
      const guardian = text(b.guardianId), formDate = text(b.formDate);
      if (guardian != null && !UUID.test(guardian)) return res.status(400).json({ error: "bad_request" });
      if (formDate != null && !DAY.test(formDate)) return res.status(400).json({ error: "form_date_invalid" });
      // The record is kept for as long as the child is on the books, and the
      // table bounds neither column: a version is a short label, a form a name.
      if ((text(b.version) ?? "").length > MAX_VERSION) return res.status(400).json({ error: "version_too_long" });
      if ((text(b.formName) ?? "").length > MAX_FORM_NAME) return res.status(400).json({ error: "form_name_too_long" });
      try {
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select ok, reason from public_name_consent_set($1, $2, $3, $4, $5, $6)`,
          [id, b.yes, text(b.version), guardian, text(b.formName), formDate])).rows[0]);
        if (!r?.ok) return refuse(res, r);
        changed("player", id);
        res.json({ ok: true, yes: b.yes });
      } catch (/** @type {any} */ e) { fail(res, e); }
    },

    // POST /api/players/:id/never-public
    mark: async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) return res.status(404).json({ error: "no_such_player" });
      const reason = text(req.body?.reason);
      if (reason != null && reason.length > 1000) return res.status(400).json({ error: "reason_too_long" });
      try {
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select ok, reason from player_never_public_set($1, $2)`, [id, reason])).rows[0]);
        if (!r?.ok) return refuse(res, r);
        changed("player", id);
        res.json({ ok: true, marked: true });
      } catch (/** @type {any} */ e) { fail(res, e); }
    },

    // POST /api/players/:id/never-public/end
    unmark: async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) return res.status(404).json({ error: "no_such_player" });
      try {
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select ok, reason from player_never_public_end($1)`, [id])).rows[0]);
        if (!r?.ok) return refuse(res, r);
        changed("player", id);
        res.json({ ok: true, marked: false });
      } catch (/** @type {any} */ e) { fail(res, e); }
    },

    // GET /api/schools/:id/public-names
    namesOff: async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
      try {
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const [s] = (await client.query(
            `select s.kind,
                    app_can('fixture.read', s.id, '*'::text, $2::uuid, $2::uuid) as reads,
                    app_can('broadcast.publish', s.id, null::text, $2::uuid, $2::uuid) as may_change
               from school s where s.id = $1`, [id, NIL])).rows;
          if (!s?.reads) return null;
          const rows = (await client.query(
            `select age_group, names_off, set_at from public_names_off where school_id = $1`, [id])).rows;
          return { s, rows };
        });
        // The switch is the school's own; to anybody else it is not there.
        if (!out) return res.status(404).json({ error: "not_found" });
        const set = new Map(out.rows.map((r) => [r.age_group, r]));
        // A school fields U9–U16 and the ranked sides (db/47 §4); anything
        // else — a union's representative U17–U19 — every group. A switch
        // already set is always shown.
        const groups = AGE_GROUPS.filter((g) => out.s.kind !== "school" || !/^U1[789]$/.test(g) || set.has(g));
        res.json({ schoolId: id.toLowerCase(), mayChange: out.s.may_change === true,
                   groups: groups.map((g) => ({ ageGroup: g, namesOff: set.get(g)?.names_off === true,
                                               setAt: set.get(g)?.set_at ? new Date(set.get(g).set_at).toISOString() : null })) });
      } catch (/** @type {any} */ e) { fail(res, e); }
    },

    // POST /api/schools/:id/public-names
    setNamesOff: async (req, res) => {
      const id = String(req.params.id ?? "");
      const { ageGroup, off } = req.body ?? {};
      if (!UUID.test(id)) return res.status(404).json({ error: "no_such_school" });
      if (typeof off !== "boolean") return res.status(400).json({ error: "no_answer" });
      try {
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select ok, reason from public_names_off_set($1, $2, $3)`, [id, text(ageGroup), off])).rows[0]);
        if (!r?.ok) return refuse(res, r);
        changed("school", id);
        res.json({ ok: true, ageGroup, off });
      } catch (/** @type {any} */ e) { fail(res, e); }
    },
  };
}

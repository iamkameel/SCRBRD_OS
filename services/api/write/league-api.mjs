/**
 * SCRBRD — making a league: the competition, its entrants, and its first
 * conditions (SCRBRD-123, added to phase 2 on Kameel's say, 2026-09-30).
 *
 * Until this, a competition existed only by seed: no route created one, none
 * entered a side, and the web's "+ New Competition" had nothing to call. The
 * planner (planner-api.mjs) needs leagues to plan. The schema and every rule
 * of who may do what is db/67_fixture_planner.sql §8a–8c; the contract, for
 * the wizard, is docs/design/SCRBRD-123_planner.md §5.7.
 *
 *   create        competition.manage at the organiser (its own write
 *                 capability); the creator is thereby its manager
 *                 (competition_conditions_manager(), db/61)
 *   entrants      the organiser invites a school's team; the school — whoever
 *                 arranges that side's fixtures, never the organiser — accepts
 *                 or declines. Only accepted entrants are planned or published.
 *   conditions    version 1 as a draft, from the platform's defaults or copied
 *                 from a competition the caller may read; publishing is db/61's
 *
 * This layer checks shape and passes each write to the SECURITY DEFINER
 * function that decides it. Every refusal is { error, detail? }: 403
 * not_permitted (never saying whether the thing exists), 400 malformed, 422
 * the rest.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, Handler, Db } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} code @param {number} [status] @param {unknown} [detail] */
const err = (code, status = 400, detail = undefined) => Object.assign(new Error(code), { status, detail });

/** A definer function's (ok, reason, detail) row. @param {any} r */
function answer(r) {
  if (!r) throw err("no_result", 500);
  if (r.ok) return r;
  throw err(r.reason ?? "refused", r.reason === "not_permitted" ? 403 : 422, r.detail ?? undefined);
}

/** A text field: a string or nothing. @param {unknown} v @param {string} code */
const text = (v, code) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") throw err(code);
  return v;
};

/** An entrant row as the screens read it. @param {any} e */
const entrantOut = (e) => ({
  id: e.id, competitionId: e.competition_id, schoolId: e.school_id, teamCode: e.team_code ?? null,
  name: e.display_name, status: e.status, divisionId: e.division_id ?? null,
  invitedAt: e.invited_at ?? null, respondedAt: e.responded_at ?? null,
});

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function leagueRoutes({ pool, secret }) {
  /** @param {(req: any) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
      if (e.code === "22P02") return res.status(400).json({ error: "malformed" });
      const status = e.status || 500;
      if (status >= 500) console.error("league →", e.code || "", e.message);
      res.status(status).json({ error: e.message || "error", ...(e.detail !== undefined ? { detail: e.detail } : {}) });
    }
  };
  /** @param {any} req */
  const as = (req) => req.headers?.authorization;
  /** @param {unknown} v */
  const uuid = (v) => { const s = String(v ?? ""); if (!UUID.test(s)) throw err("not_found", 404); return s; };
  /** @param {any} req */
  const idOf = (req) => uuid(req.params?.id);

  /** @param {Db} client @param {string} id */
  const competitionOut = async (client, id) => {
    const { rows } = await client.query(
      `select c.id, c.school_id, c.name, c.comp_type, c.format, c.age_group, c.gender, c.level, s.label as season,
              competition_conditions_manager(c.id) as manage
         from competition c left join season s on s.id = c.season_id where c.id = $1`, [id]);
    if (!rows.length) throw err("not_permitted", 403);
    const c = rows[0];
    return { id: c.id, organiserSchoolId: c.school_id ?? null, name: c.name, compType: c.comp_type, format: c.format ?? null,
             ageGroup: c.age_group ?? null, gender: c.gender ?? null, level: c.level, season: c.season ?? null, canManage: c.manage === true };
  };

  /** @param {any} req @param {boolean} accept */
  const respond = (req, accept) => runAsPrincipal(pool, secret, as(req), async (client) => {
    const { rows } = await client.query(`select * from competition_entrant_respond($1, $2)`, [idOf(req), accept]);
    return { ok: true, status: answer(rows[0]).status };
  });

  return {
    // POST /api/competitions { name, organiserSchoolId?, compType?, format?, ageGroup?, gender?, level?, season? }
    //   → the competition. refusals: not_permitted, support_session, organiser_invalid, name_invalid,
    //   comp_type_invalid, level_invalid, format_invalid, label_too_long, season_unknown
    create: handle(async (req) => {
      const b = req.body || {};
      const organiser = b.organiserSchoolId == null || b.organiserSchoolId === "" ? null : String(b.organiserSchoolId);
      if (organiser != null && !UUID.test(organiser)) throw err("organiser_invalid");
      const fields = ["name", "compType", "format", "ageGroup", "gender", "level", "season"].map((k) => text(b[k], `${k}_invalid`));
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from competition_create($1, $2, $3, $4, $5, $6, $7, $8)`, [organiser, ...fields]);
        return competitionOut(client, answer(rows[0]).competition_id);
      });
    }),

    // POST /api/competitions/:id { name?, season? } → the competition
    //   refusals: not_permitted, has_fixtures, name_invalid, season_unknown
    amend: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      const name = text(b.name, "name_invalid"), season = text(b.season, "season_invalid");
      if (name == null && season == null) throw err("nothing_to_change");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from competition_amend($1, $2, $3)`, [id, name, season]);
        answer(rows[0]);
        return competitionOut(client, id);
      });
    }),

    // GET /api/competitions/:id/entrants → { canManage, entrants: [entrant] }
    //   As competition_entrant's own policy lets the reader see them.
    entrants: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(
          `select * from competition_entrant where competition_id = $1 order by status, display_name, id`, [id]);
        const { rows: m } = await client.query(`select competition_conditions_manager($1) as m`, [id]);
        return { canManage: m[0]?.m === true, entrants: rows.map(entrantOut) };
      });
    }),

    // GET /api/competitions/:id/schools → { schools: [{ id, name, code }] }
    //   Who the manager may invite: every school, by name and code. Nothing to anybody else.
    schools: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from competition_invitable_schools($1)`, [id]);
        return { schools: rows.map((r) => ({ id: r.school_id, name: r.name, code: r.code })) };
      });
    }),

    // POST /api/competitions/:id/entrants { schoolId, teamCode, displayName? } → { ok, id, status, detail? }
    //   refusals: not_permitted, school_invalid, team_invalid, display_name_invalid.
    //   The same team again: its row as it stands ("already"), or invited afresh after a decline.
    invite: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      const school = UUID.test(String(b.schoolId ?? "")) ? String(b.schoolId) : null;
      if (!school) throw err("school_invalid");
      const team = text(b.teamCode, "team_invalid"), name = text(b.displayName, "display_name_invalid");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from competition_entrant_invite($1, $2, $3, $4)`, [id, school, team, name]);
        const r = answer(rows[0]);
        return { ok: true, id: r.entrant_id, status: r.status, ...(r.detail ? { detail: r.detail } : {}) };
      });
    }),

    // GET /api/competition-invitations → { invitations: [{ ...entrant, competitionName, organiserSchoolId }] }
    //   The invitations the caller may answer (competition_entrant_acceptor()).
    invitations: handle(async (req) => runAsPrincipal(pool, secret, as(req), async (client) => {
      const { rows } = await client.query(
        `select e.*, c.name as competition_name, c.school_id as organiser
           from competition_entrant e join competition c on c.id = e.competition_id
          where e.status = 'invited' and competition_entrant_acceptor(e.id)
          order by e.invited_at, e.id`);
      return { invitations: rows.map((r) => ({ ...entrantOut(r), competitionName: r.competition_name, organiserSchoolId: r.organiser ?? null })) };
    })),

    // POST /api/competition-entrants/:id/accept → { ok, status: "accepted" }
    // POST /api/competition-entrants/:id/decline → { ok, status: "declined" }
    //   refusals: not_permitted (including the competition's own manager), support_session, not_invited
    accept: handle(async (req) => respond(req, true)),
    decline: handle(async (req) => respond(req, false)),

    // POST /api/competitions/:id/playing-conditions/start
    //   { from: "defaults" | "competition", sourceCompetitionId?, title?, effectiveFrom? }
    //   → { ok, setId, version: 1, entered }
    //   refusals: not_permitted, from_invalid, already_started, source_invalid,
    //   source_has_no_conditions, title_invalid, effective_from_invalid
    startConditions: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      const source = b.sourceCompetitionId == null || b.sourceCompetitionId === "" ? null : String(b.sourceCompetitionId);
      if (source != null && !UUID.test(source)) throw err("source_invalid");
      const eff = b.effectiveFrom == null || b.effectiveFrom === "" ? null : String(b.effectiveFrom);
      if (eff != null && (!DAY.test(eff) || Number.isNaN(Date.parse(eff)))) throw err("effective_from_invalid");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from condition_set_start($1, $2, $3, $4, $5::date)`,
          [id, text(b.from, "from_invalid"), source, text(b.title, "title_invalid"), eff]);
        const r = answer(rows[0]);
        return { ok: true, setId: r.set_id, version: r.version, entered: r.entered };
      });
    }),
  };
}

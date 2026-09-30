/**
 * SCRBRD — a competition's playing conditions (SCRBRD-114, phase 1).
 *
 * The design is docs/design/SCRBRD-114_playing_conditions.md; the schema and
 * every rule are db/61_playing_conditions.sql. This layer validates shape and
 * passes each write to the SECURITY DEFINER function that decides it —
 * competition.conditions.manage over the competition's organiser, a draft
 * before publishing, a publish never dated today or earlier, never by a
 * support session — and returns its answer. It holds no rule of its own:
 * a check here would be a second opinion that can drift from the one that
 * runs.
 *
 * "Playing conditions", not "conditions": /api/matches/:id/weather and
 * /pitch are the other kind (the conditions both sides play in), and the
 * paths keep the two apart.
 *
 * Every refusal is { error: <reason>, detail? }: 403 not_permitted (which
 * never says whether the competition or version exists), 422 for the rest,
 * each reason named in the route's comment. The conditions screen (a Sonnet
 * build over this) words them.
 *
 * Dates are plain YYYY-MM-DD strings (to_char in the query), never a JS Date:
 * node-postgres would turn a Postgres date into midnight in the server's zone.
 *
 * Names beside ids (createdByName and the like) are read as app_user's own
 * policy allows the reader: a reader who may not read that user gets null, and
 * the screen says "another administrator". No definer function widens it.
 *
 * Reads are the tables' own policies (db/61): the catalogue to anyone signed
 * in; published and withdrawn versions to whoever may reach the competition
 * (competition.read), drafts to its conditions managers only; a match's
 * document and its departures to whoever may read the fixture.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { fixtureFormatFrom } from "@scrbrd/scoring";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler, IdHandler, IdRequest } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const err = (/** @type {string} */ code, status = 400, /** @type {unknown} */ detail = undefined) =>
  Object.assign(new Error(code), { status, detail });

/**
 * A definer function's (ok, reason, detail) row, as the route's answer:
 * the row's extra columns when ok, else a refusal.
 * @param {any} r
 */
function answer(r) {
  if (!r) throw err("no_result", 500);
  if (r.ok) return r;
  throw err(r.reason ?? "refused", r.reason === "not_permitted" ? 403 : 422, r.detail ?? undefined);
}

/** @param {any} v @param {string} code */
const day = (v, code) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !DAY.test(v) || Number.isNaN(Date.parse(v))) throw err(code);
  return v;
};

/** A version, as the screen reads it. @param {any} s @param {any[]} values */
const setOut = (s, values) => ({
  id: s.id, competitionId: s.competition_id, version: s.version, title: s.title,
  effectiveFrom: s.effective_day, status: s.status, supersedes: s.supersedes ?? null,
  createdBy: s.created_by, createdByName: s.created_by_name ?? null, createdAt: s.created_at,
  publishedBy: s.published_by ?? null, publishedByName: s.published_by_name ?? null, publishedAt: s.published_at ?? null,
  withdrawnBy: s.withdrawn_by ?? null, withdrawnByName: s.withdrawn_by_name ?? null,
  withdrawnAt: s.withdrawn_at ?? null, withdrawnNote: s.withdrawn_note ?? null,
  values: values.filter((v) => v.set_id === s.id).map((v) => ({
    key: v.key, ageBand: v.age_band === "" ? null : v.age_band, value: v.value, status: v.status,
    sourceDocument: v.source_document ?? null, sourceClause: v.source_clause ?? null,
    sourceDate: v.source_day ?? null, sourceNote: v.source_note ?? null,
    enteredBy: v.entered_by, enteredByName: v.entered_by_name ?? null, enteredAt: v.entered_at,
  })),
});

/** @param {RouteDeps} deps @returns {Record<string, Handler | IdHandler>} */
export function playingConditionsRoutes({ pool, secret }) {
  /** @param {(req: any) => Promise<unknown>} fn @returns {IdHandler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
      if (e.code === "23514") return res.status(422).json({ error: "value_invalid", detail: e.message });
      if (e.code === "22P02") return res.status(400).json({ error: "malformed" });
      const status = e.status || 500;
      if (status >= 500) console.error("playing-conditions →", e.code || "", e.message);
      res.status(status).json({ error: e.message || "error", ...(e.detail !== undefined ? { detail: e.detail } : {}) });
    }
  };
  /** @param {any} req */
  const as = (req) => req.headers?.authorization;
  /** @param {any} req */
  const idOf = (req) => { const id = String(req.params?.id ?? ""); if (!UUID.test(id)) throw err("not_found", 404); return id; };

  return {
    // GET /api/playing-conditions/catalogue
    //   → { keys: [{ key, part, type, unit, values, byAgeBand, platformDefault, readers, reserved }] }
    catalogue: handle(async (req) => runAsPrincipal(pool, secret, as(req), async (client) => {
      const { rows } = await client.query(
        `select key, part, value_type, unit, enum_values, by_age_band, platform_default, readers, clause_code
           from playing_condition_key order by sort_order, key`);
      const { rows: bands } = await client.query(
        `select age_band from bowling_directive where age_band <> 'unknown' order by age_band`);
      return {
        keys: rows.map((r) => ({ key: r.key, part: r.part, type: r.value_type, unit: r.unit ?? null, values: r.enum_values ?? null,
                                 byAgeBand: r.by_age_band, platformDefault: r.platform_default ?? null, readers: r.readers,
                                 reserved: (r.readers ?? []).length === 0, clauseCode: r.clause_code ?? null })),
        ageBands: bands.map((b) => b.age_band),
      };
    })),

    // GET /api/competitions/entered?schoolId=&teamCode=
    //   → { rows: [{ id, name, format, ageGroup }] }
    //   The competitions a side has entered, as the reader may see them — what
    //   the fixture screen offers beside "a friendly" (db/61 refuses any other).
    entered: handle(async (req) => {
      const school = String(req.query?.schoolId ?? "");
      if (!UUID.test(school)) throw err("school_required");
      const team = req.query?.teamCode ? String(req.query.teamCode) : null;
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(
          `select distinct c.id, c.name, c.format, c.age_group
             from competition_entrant e join competition c on c.id = e.competition_id
            where e.school_id = $1 and e.team_code is not distinct from $2
            order by c.name`, [school, team]);
        return { rows: rows.map((r) => ({ id: r.id, name: r.name, format: r.format ?? null, ageGroup: r.age_group ?? null })) };
      });
    }),

    // GET /api/competitions/:id/playing-conditions
    //   → { competitionId, canManage, inForceToday: setId | null, sets: [version, newest first] }
    //   Drafts appear only for a conditions manager.
    list: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows: sets } = await client.query(
          `select s.*, to_char(s.effective_from, 'YYYY-MM-DD') as effective_day, cu.name as created_by_name, pu.name as published_by_name, wu.name as withdrawn_by_name
             from condition_set s
             left join app_user cu on cu.id = s.created_by
             left join app_user pu on pu.id = s.published_by
             left join app_user wu on wu.id = s.withdrawn_by
            where s.competition_id = $1 order by s.version desc`, [id]);
        const { rows: values } = sets.length
          ? await client.query(
              `select v.*, to_char(v.source_date, 'YYYY-MM-DD') as source_day, u.name as entered_by_name
                 from condition_value v left join app_user u on u.id = v.entered_by
                where v.set_id = any($1::uuid[]) order by v.key, v.age_band`, [sets.map((s) => s.id)])
          : { rows: [] };
        const { rows: m } = await client.query(
          `select competition_conditions_manager($1) as manage, condition_set_for($1, sa_today()) as today`, [id]);
        return { competitionId: id, canManage: m[0]?.manage === true, inForceToday: m[0]?.today ?? null,
                 sets: sets.map((s) => setOut(s, values)) };
      });
    }),

    // GET /api/competitions/:id/playing-conditions/preview?on=YYYY-MM-DD
    //   → { competitionId, on, set: { id, version, title, effectiveFrom } | null,
    //       values: { key: value }, prefill: { format, overs } }
    //   The version in force on that day (the fixture's start day), for the
    //   fixture screen to pre-fill its format and overs from (design §2.3).
    preview: handle(async (req) => {
      const id = idOf(req);
      const on = day(req.query?.on, "on_invalid") ?? null;
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows: c } = await client.query(`select id, format from competition where id = $1`, [id]);
        if (!c.length) throw err("not_permitted", 403);
        const { rows: s } = await client.query(
          `select s.id, s.version, s.title, to_char(s.effective_from, 'YYYY-MM-DD') as effective_day
             from condition_set s where s.id = condition_set_for($1, coalesce($2::date, sa_today()))`, [id, on]);
        /** @type {Record<string, unknown>} */
        const values = {};
        if (s.length) {
          const { rows: v } = await client.query(`select key, age_band, value from condition_value where set_id = $1`, [s[0].id]);
          for (const r of v) {
            if (r.age_band === "") values[r.key] = r.value;
            else values[r.key] = { .../** @type {object} */ (values[r.key] ?? {}), [r.age_band]: r.value };
          }
        }
        return { competitionId: id, on: on ?? null,
                 set: s.length ? { id: s[0].id, version: s[0].version, title: s[0].title, effectiveFrom: s[0].effective_day } : null,
                 values, prefill: fixtureFormatFrom(values, c[0].format ?? null) };
      });
    }),

    // POST /api/competitions/:id/playing-conditions { title, effectiveFrom }
    //   → { ok, setId, version }       a new draft, numbered next
    //   refusals: not_permitted, title_invalid, effective_from_required, effective_from_invalid
    draft: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      const eff = day(b.effectiveFrom, "effective_from_invalid");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from condition_set_draft($1, $2, $3)`, [id, b.title ?? null, eff]);
        const r = answer(rows[0]);
        return { ok: true, setId: r.set_id, version: r.version };
      });
    }),

    // POST /api/condition-sets/:id/new-version → { ok, setId, version }
    //   A draft copying every figure of this version, `supersedes` it.
    newVersion: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from condition_set_new_version($1)`, [id]);
        const r = answer(rows[0]);
        return { ok: true, setId: r.set_id, version: r.version };
      });
    }),

    // POST /api/condition-sets/:id { title?, effectiveFrom? } → { ok }
    //   A draft's title and date. refusals: not_permitted, published_is_immutable, title_invalid
    amend: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      const eff = day(b.effectiveFrom, "effective_from_invalid");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from condition_set_amend($1, $2, $3)`, [id, b.title ?? null, eff]);
        answer(rows[0]);
        return { ok: true };
      });
    }),

    // POST /api/condition-sets/:id/values
    //   { key, ageBand?, value, status: "confirmed" | "unconfirmed",
    //     sourceDocument?, sourceClause?, sourceDate?, sourceNote? } → { ok }
    //   One figure, with its citation; the same key and band again replaces it.
    //   refusals: not_permitted, published_is_immutable, no_such_key, status_invalid,
    //             citation_required (a confirmed figure names document, clause and date),
    //             value_invalid (detail says why), source_date_invalid
    enter: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      if (typeof b.key !== "string" || b.key === "") throw err("key_required");
      if (!("value" in b)) throw err("value_required");
      const date = day(b.sourceDate, "source_date_invalid");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(
          `select * from condition_value_enter($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
          [id, b.key, b.ageBand ?? "", JSON.stringify(b.value), b.status ?? null,
           b.sourceDocument ?? null, b.sourceClause ?? null, date, b.sourceNote ?? null]);
        answer(rows[0]);
        return { ok: true };
      });
    }),

    // POST /api/condition-sets/:id/values/clear { key, ageBand? } → { ok }
    clear: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      if (typeof b.key !== "string" || b.key === "") throw err("key_required");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from condition_value_clear($1, $2, $3)`, [id, b.key, b.ageBand ?? ""]);
        answer(rows[0]);
        return { ok: true };
      });
    }),

    // POST /api/condition-sets/:id/publish → { ok }
    //   refusals: not_permitted, support_session, not_a_draft,
    //             effective_from_not_future (never today or earlier: D2),
    //             effective_from_behind_latest
    publish: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from condition_set_publish($1)`, [id]);
        answer(rows[0]);
        return { ok: true };
      });
    }),

    // POST /api/condition-sets/:id/withdraw { note } → { ok }
    //   A draft, or a published version not yet in force.
    //   refusals: not_permitted, support_session, note_required, already_withdrawn,
    //             in_force (a version in force is corrected by a new version)
    withdraw: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from condition_set_withdraw($1, $2)`, [id, req.body?.note ?? null]);
        answer(rows[0]);
        return { ok: true };
      });
    }),

    // GET /api/matches/:id/playing-conditions
    //   → { matchId, doc, sources, docHash, fixed, applies, setId, setVersion, setTitle,
    //       overrides: [{ key, ageBand, value, reason, setBy, setAt }] }
    //   The frozen document, or the preview (fixed false) until the first ball.
    match: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from match_playing_conditions($1)`, [id]);
        if (!rows.length) throw err("not_permitted", 403);
        const r = rows[0];
        const { rows: o } = await client.query(
          `select key, age_band, value, reason, set_by, set_at from match_condition_override where match_id = $1 order by key, age_band`, [id]);
        return { matchId: id, doc: r.doc, sources: r.sources, docHash: r.doc_hash, fixed: r.fixed, applies: r.applies,
                 setId: r.set_id ?? null, setVersion: r.set_version ?? null, setTitle: r.set_title ?? null,
                 overrides: o.map((x) => ({ key: x.key, ageBand: x.age_band === "" ? null : x.age_band, value: x.value,
                                            reason: x.reason, setBy: x.set_by, setAt: x.set_at })) };
      });
    }),

    // POST /api/matches/:id/playing-conditions/override { key, ageBand?, value, reason } → { ok }
    //   A departure for this fixture before play (D9); value null takes it out.
    //   The competition's conditions manager, or for a friendly the home school's fixture.update.
    //   refusals: not_permitted, conditions_fixed (after the first ball: the umpires' revision),
    //             no_such_key, reason_required, value_invalid
    override: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      if (typeof b.key !== "string" || b.key === "") throw err("key_required");
      if (!("value" in b)) throw err("value_required");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(
          `select * from match_condition_override_set($1, $2, $3, $4::jsonb, $5)`,
          [id, b.key, b.ageBand ?? "", b.value === null ? null : JSON.stringify(b.value), b.reason ?? null]);
        answer(rows[0]);
        return { ok: true };
      });
    }),
  };
}

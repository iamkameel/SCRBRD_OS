/**
 * SCRBRD — match results and the league table (SCRBRD-114 phase 3a).
 *
 * The design is docs/design/SCRBRD-114_phase3_results_super_over.md §2 and §6;
 * the schema and every rule are db/69_results_and_table.sql. This layer
 * validates shape, passes each write to the SECURITY DEFINER function that
 * decides it, and puts results into words with the one rule the fold uses
 * (@scrbrd/scoring resultFromRow() and resultWords()). It holds no rule of
 * its own.
 *
 *   GET  /api/matches/:id/result                        the result, in words
 *   POST /api/matches/:id/result-decision               conceded · walkover · awarded
 *   POST /api/result-decisions/:id/withdraw             with a note
 *   GET  /api/competitions/:id/standings                the table, its results,
 *                                                       its adjustments
 *   POST /api/competitions/:id/adjustments              a points adjustment
 *   POST /api/points-adjustments/:id/withdraw           with a note
 *   POST /api/matches/:id/playing-conditions/refix-table  a played match's table figures
 *
 * Every refusal is { error: <reason>, detail? }: 403 not_permitted (which never
 * says whether the thing exists), 422 for the rest, each named by db/69.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { resultFromRow, resultWords } from "@scrbrd/scoring";
/** @import { RouteDeps, Handler, IdHandler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (/** @type {string} */ code, status = 400, /** @type {unknown} */ detail = undefined) =>
  Object.assign(new Error(code), { status, detail });

/** A definer function's (ok, reason, detail) row: the row when ok, else a refusal. @param {any} r */
function answer(r) {
  if (!r) throw err("no_result", 500);
  if (r.ok) return r;
  throw err(r.reason ?? "refused", r.reason === "not_permitted" ? 403 : 422, r.detail ?? undefined);
}

/**
 * A result row (match_result() or competition_results()) as the screens read
 * it, in words, each side named by its label.
 * @param {any} row  @param {{home: string, away: string}} names  @param {boolean} [reasons]
 */
export function resultOut(row, names, reasons = true) {
  const r = resultFromRow(row);
  if (!r) return null;
  const text = resultWords(r, { reasons, nameOf: (key, side) => (side === "home" || side === "away" ? names[side]
    : key != null && String(key).trim().toLowerCase() === String(row.home_key ?? "").trim().toLowerCase() ? names.home : names.away) });
  return {
    outcome: r.outcome, marginKind: r.marginKind, margin: r.marginValue, decidedBy: r.decidedBy, winnerSide: r.winnerSide,
    playOutcome: r.playOutcome, decisionApplied: r.decisionApplied,
    decision: r.decision ? { id: row.decision?.id ?? null, kind: r.decision.kind, side: r.decision.side,
                             overridesPlay: r.decision.overridesPlay === true, ...(reasons ? { reason: r.decision.reason } : {}),
                             decidedAt: row.decision?.at ?? null } : null,
    text, resultHash: row.result_hash ?? null,
  };
}

/** @param {RouteDeps} deps @returns {Record<string, Handler | IdHandler>} */
export function resultsRoutes({ pool, secret }) {
  /** @param {(req: any) => Promise<unknown>} fn @returns {IdHandler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
      if (e.code === "23514") return res.status(422).json({ error: "value_invalid", detail: e.message });
      if (e.code === "22P02") return res.status(400).json({ error: "malformed" });
      const status = e.status || 500;
      if (status >= 500) console.error("results →", e.code || "", e.message);
      res.status(status).json({ error: e.message || "error", ...(e.detail !== undefined ? { detail: e.detail } : {}) });
    }
  };
  /** @param {any} req */
  const as = (req) => req.headers?.authorization;
  /** @param {any} req */
  const idOf = (req) => { const id = String(req.params?.id ?? ""); if (!UUID.test(id)) throw err("not_found", 404); return id; };

  return {
    // GET /api/matches/:id/result
    //   → { matchId, status, home, away, result: { outcome, marginKind, margin, decidedBy, winnerSide,
    //       playOutcome, decisionApplied, decision, text, resultHash }, innings, canDecide }
    //   For a reader of the fixture: match_result() runs as its caller.
    result: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows: m } = await client.query(
          `select m.id, m.status, m.team_code, m.opponent, m.competition_id,
                  coalesce(fixture_side_label(m.school_id, m.team_code), m.team_code, 'Home') as home_label,
                  coalesce(fixture_side_label(m.away_school_id, m.away_team_code), m.opponent) as away_label
             from match m where m.id = $1`, [id]);
        if (!m.length) throw err("not_permitted", 403);
        const { rows } = await client.query(`select * from match_result($1)`, [id]);
        const { rows: d } = await client.query(`select match_result_decider($1) as may`, [id]);
        const names = { home: m[0].home_label, away: m[0].away_label };
        const row = rows[0] ? { ...rows[0], home_key: m[0].team_code ?? "Home" } : null;
        return { matchId: id, status: m[0].status, competitionId: m[0].competition_id ?? null, home: names.home, away: names.away,
                 result: row ? resultOut(row, names) : null,
                 innings: (row?.innings ?? []).map((/** @type {any} */ i) => ({ innings: i.innings, side: i.side, runs: i.runs, wickets: i.wickets,
                   balls: i.balls, overs: i.overs, endReason: i.end_reason, complete: i.complete })),
                 canDecide: d[0]?.may === true };
      });
    }),

    // POST /api/matches/:id/result-decision { kind, side, reason, overridesPlay? } → { ok, id }
    //   refusals: not_permitted, support_session, kind_invalid, side_invalid, reason_required,
    //             override_not_award, needs_play, already_decided
    decide: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from match_result_decide($1, $2, $3, $4, $5)`,
          [id, b.kind ?? null, b.side ?? null, b.reason ?? null, b.overridesPlay === true]);
        const r = answer(rows[0]);
        return { ok: true, id: r.decision_id };
      });
    }),

    // POST /api/result-decisions/:id/withdraw { note } → { ok }
    //   refusals: not_permitted, support_session, note_required, already_withdrawn
    withdrawDecision: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from match_result_decision_withdraw($1, $2)`, [id, req.body?.note ?? null]);
        answer(rows[0]);
        return { ok: true };
      });
    }),

    // GET /api/competitions/:id/standings
    //   → { competitionId, basis, order, headToHeadListed, overRateKind, canAdjust,
    //       rows: [{ entrantId, divisionId, division, side, schoolId, teamCode, played, won, lost, tied, drawn,
    //               noResult, points, adjustmentPoints, nrr, runsFor, ballsFor, runsAgainst, ballsAgainst, rank,
    //               conditionsAdjusted }],
    //       results: [{ matchId, startsAt, status, home, away, counted, conditionsAdjusted, canDecide, ...result }],
    //       adjustments: [{ id, entrantId, side, matchId, kind, points, reason, sourceClause, setBy, setByName, setAt,
    //                       withdrawnAt, withdrawnNote }],
    //       versions: [{ id, version, title, effectiveFrom }] }   published versions, for a re-fix
    //   For whoever can reach the competition (competition_visible(), db/08).
    standings: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows: c } = await client.query(`select id, name from competition where id = $1`, [id]);
        if (!c.length) throw err("not_permitted", 403);
        const { rows: st } = await client.query(
          `select s.*, d.name as division_name, d.rank as division_rank
             from competition_standing s left join competition_division d on d.id = s.division_id
            where s.competition_id = $1
            order by d.rank nulls last, s.rank, s.display_name`, [id]);
        const { rows: res } = await client.query(
          `select r.*, match_result_decider(r.match_id) as may_decide from competition_results($1) r`, [id]);
        const { rows: adj } = await client.query(
          `select a.*, e.display_name, u.name as set_by_name
             from competition_points_adjustment a
             join competition_entrant e on e.id = a.entrant_id
             left join app_user u on u.id = a.set_by
            where a.competition_id = $1 order by a.set_at desc, a.id`, [id]);
        const { rows: m } = await client.query(
          `select competition_conditions_manager($1) as manage, competition_over_rate_kind($1, null) as over_rate`, [id]);
        const { rows: v } = await client.query(
          `select s.id, s.version, s.title, to_char(s.effective_from, 'YYYY-MM-DD') as effective_day
             from condition_set s where s.competition_id = $1 and s.status = 'published' order by s.version desc`, [id]);
        const num = (/** @type {any} */ x) => (x == null ? null : Number(x));
        return {
          competitionId: id, name: c[0].name,
          basis: st[0]?.basis ?? null, order: st[0]?.table_order ?? ["points", "wins", "nrr"],
          headToHeadListed: st[0]?.head_to_head_listed === true,
          overRateKind: m[0]?.over_rate ?? "none", canAdjust: m[0]?.manage === true,
          rows: st.map((s) => ({
            entrantId: s.entrant_id, divisionId: s.division_id ?? null, division: s.division_name ?? null,
            side: s.display_name, schoolId: s.school_id, teamCode: s.team_code,
            played: s.played, won: s.won, lost: s.lost, tied: s.tied, drawn: s.drawn, noResult: s.no_result,
            points: num(s.points), adjustmentPoints: num(s.adjustment_points), nrr: num(s.nrr),
            runsFor: s.runs_for, ballsFor: s.balls_for, runsAgainst: s.runs_against, ballsAgainst: s.balls_against,
            rank: s.rank, conditionsAdjusted: s.conditions_adjusted,
          })),
          results: res.map((r) => ({
            matchId: r.match_id, startsAt: r.starts_at, status: r.status, home: r.home_label, away: r.away_label,
            counted: r.counted === true, conditionsAdjusted: r.conditions_adjusted === true, canDecide: r.may_decide === true,
            played: (r.innings ?? []).length > 0, documented: r.table_doc != null,
            ...resultOut({ ...r, home_key: r.home_team_code ?? "Home" }, { home: r.home_label, away: r.away_label }),
          })),
          adjustments: adj.map((a) => ({
            id: a.id, entrantId: a.entrant_id, side: a.display_name, matchId: a.match_id ?? null, kind: a.kind,
            points: Number(a.points), reason: a.reason, sourceClause: a.source_clause ?? null,
            setBy: a.set_by, setByName: a.set_by_name ?? null, setAt: a.set_at,
            withdrawnAt: a.withdrawn_at ?? null, withdrawnNote: a.withdrawn_note ?? null,
          })),
          versions: v.map((x) => ({ id: x.id, version: x.version, title: x.title, effectiveFrom: x.effective_day })),
        };
      });
    }),

    // POST /api/competitions/:id/adjustments { entrantId, matchId?, kind, points, reason, sourceClause? } → { ok, id }
    //   refusals: not_permitted, support_session, kind_invalid, points_invalid, reason_required,
    //             entrant_invalid, match_invalid, over_rate_not_points
    adjust: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      if (typeof b.entrantId !== "string" || !UUID.test(b.entrantId)) throw err("entrant_invalid", 422);
      if (b.matchId != null && (typeof b.matchId !== "string" || !UUID.test(b.matchId))) throw err("match_invalid", 422);
      const points = Number(b.points);
      if (!Number.isFinite(points)) throw err("points_invalid", 422);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from competition_points_adjust($1, $2, $3, $4, $5, $6, $7)`,
          [id, b.entrantId, b.matchId ?? null, b.kind ?? null, points, b.reason ?? null, b.sourceClause ?? null]);
        const r = answer(rows[0]);
        return { ok: true, id: r.adjustment_id };
      });
    }),

    // POST /api/points-adjustments/:id/withdraw { note } → { ok }
    withdrawAdjustment: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from competition_points_adjustment_withdraw($1, $2)`, [id, req.body?.note ?? null]);
        answer(rows[0]);
        return { ok: true };
      });
    }),

    // POST /api/matches/:id/playing-conditions/refix-table { setId, reason } → { ok }
    //   refusals: not_permitted, support_session, reason_required, no_document, set_invalid
    refixTable: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      if (typeof b.setId !== "string" || !UUID.test(b.setId)) throw err("set_invalid", 422);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from match_conditions_refix_table($1, $2, $3)`, [id, b.setId, b.reason ?? null]);
        answer(rows[0]);
        return { ok: true };
      });
    }),
  };
}

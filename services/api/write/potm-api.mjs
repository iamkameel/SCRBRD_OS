/**
 * SCRBRD — Player of the Match, the coach's path (RECOGNITION R6, db/142).
 *
 *   GET  /api/matches/:id/player-of-match
 *        → { matchId, basis, sides: [{ side, schoolId, teamCode, label, opponent, heading, verified, headSeq,
 *              mayAward, refusal, standing, mayWithdraw, suggestions, sheet }] }
 *   POST /api/matches/:id/player-of-match            { playerId, headSeq } → { ok, honourId }
 *   POST /api/matches/:id/player-of-match/withdraw   { honourId, kind, reason } → { ok }
 *
 * WHO. Every rule is db/142's: match_award_state() answers a side only to a
 * holder of recognition.match.award over it (the side's coach, the director
 * of sport, the principal), as himself; match_award() refuses a boy not on
 * that side's sheet, a match not verified, a second standing award, the boy
 * himself, and a guardian of the boy (naming who decides instead). Nobody
 * else gets a side, so nobody else is offered a button the server would
 * refuse (§7: "a button the server would refuse" is a word the coach never
 * sees).
 *
 * THE SUGGESTIONS (D17). R1's facts (deriveFacts()) over the match's log as
 * the caller reads it, the side's sheet the only roster, packages/scoring's
 * suggestPlayerOfMatch(): two or three, figures in words, never
 * pre-selected, "Based on batting and bowling only." until fielding is
 * scored: where every catch, stumping and run out of the match names its
 * fielders (RECOGNITION R12, potmBasis()), fielding counts and the line is
 * dropped (`basis` null; `basisKey` says which). The award stores them, and
 * the basis, as derived_from, worked out again here at the head the coach saw: when the
 * log has moved since, the door refuses `stale` and the sheet reads again.
 *
 * WHAT IS NEVER SENT. Another side's sheet; a reason (withdrawal reasons are
 * written here and read by nobody through this route); who else was looked at.
 */
import { deriveFacts, fromRow, suggestPlayerOfMatch, matchFigures, figuresWords, basisWords, potmBasis, POTM_BASIS, FACTS_VERSION } from "@scrbrd/scoring";
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { EVENT_COLUMNS_SEEN, matchFoldContext } from "./events-api.mjs";
import { safeErr } from "../log-safe.mjs";
/** @import { RouteDeps, IdHandler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (/** @type {string} */ code, status = 400, /** @type {unknown} */ detail = undefined) =>
  Object.assign(new Error(code), { status, detail });

/** Every answer the doors give, in the words the sheet shows (§7, "the coach"). */
export const POTM_WORDS = Object.freeze({
  not_permitted: "You may not decide Player of the Match for this side.",
  not_on_sheet: "He is not on this side's sheet for the match.",
  cannot_award_yourself: "You cannot award yourself.",
  guardian_conflict_directorofsport: "You are his guardian, so the director of sport decides.",
  guardian_conflict_principal: "You are his guardian, so the principal decides.",
  not_verified: "Player of the Match is decided once the match is finished and the scorer has sealed every innings.",
  already_awarded: "This side's Player of the Match is already decided.",
  no_season: "The school calendar holds no season for this match's date.",
  stale: "The scorecard changed while you were deciding. The suggestions are read again: look, then decide.",
  derived_from_invalid: "The suggestions could not be read. Nothing was changed.",
  already_withdrawn: "It has already been withdrawn.",
  kind_invalid: "Say whether it is withdrawn after a scorecard correction or for another reason.",
  reason_required: "Say why, in 3 to 200 characters. The reason is kept for the school; nobody on the side reads it.",
});

/** The refusal's words, a guardian's naming who decides instead. @param {string} reason @param {string | null} detail */
export function potmWords(reason, detail = null) {
  const key = reason === "guardian_conflict" ? `guardian_conflict_${detail === "principal" ? "principal" : "directorofsport"}` : reason;
  return POTM_WORDS[/** @type {keyof typeof POTM_WORDS} */ (key)] ?? "Could not decide it; nothing was changed.";
}

/** @param {RouteDeps} deps @returns {Record<string, IdHandler>} */
export function potmRoutes({ pool, secret }) {
  /** @param {(req: any) => Promise<unknown>} fn @returns {IdHandler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted", message: POTM_WORDS.not_permitted });
      if (e.code === "22P02") return res.status(400).json({ error: "malformed" });
      // db/144's honour_tie_nomination(): an award while the captain's
      // nomination is open answers it, never by its nominee's guardian or by
      // the nominator; refused at the table, said in words here.
      if (e.code === "23514" && e.message === "nomination_guardian_conflict") {
        return res.status(422).json({ error: "guardian_conflict", detail: e.detail ?? null, message: potmWords("guardian_conflict", e.detail ?? null) });
      }
      if (e.code === "23514" && e.message === "decider_is_nominator") {
        return res.status(422).json({ error: "decider_is_nominator", message: "You made this nomination, so another coach decides." });
      }
      const status = e.status || 500;
      if (status >= 500) { console.error("potm →", safeErr(e)); return res.status(status).json({ error: "error" }); }
      res.status(status).json({ error: e.message || "error", ...(e.detail !== undefined ? { detail: e.detail } : {}),
                                message: potmWords(e.message, /** @type {string | null} */ (e.detail ?? null)) });
    }
  };
  /** @param {any} req */
  const as = (req) => req.headers?.authorization;
  /** @param {any} req */
  const idOf = (req) => { const id = String(req.params?.id ?? ""); if (!UUID.test(id)) throw err("not_found", 404); return id; };

  /**
   * One side's sheet, its figures and its suggestions, from the log as this
   * caller reads it.
   * @param {any} client @param {string} id @param {any[]} sides  match_award_state() rows
   */
  async function working(client, id, sides) {
    if (!sides.length) return new Map();
    const { rows: evs } = await client.query(`select ${EVENT_COLUMNS_SEEN} from ball_event where match_id = $1 order by seq`, [id]);
    const ctx = await matchFoldContext(client, id);
    const { rows: sheet } = await client.query(
      `select s.side, s.player_id, s.batting_no, p.full_name
         from match_squad s join player p on p.id = s.player_id
        where s.match_id = $1 and not s.withdrawn
        order by s.side, s.batting_no nulls last, p.full_name`, [id]);
    /** @typedef {{side: string, player_id: string, batting_no: number | null, full_name: string}} SheetRow */
    /** @type {SheetRow[]} */
    const rowsOf = sheet;
    /** @type {Map<string, {sheet: any[], suggestions: any[], figures: Map<string, string>, basis: string}>} */
    const out = new Map();
    for (const s of sides) {
      const mine = rowsOf.filter((x) => x.side === s.side);
      const ids = mine.map((x) => x.player_id);
      const facts = deriveFacts(evs.map(fromRow), ids, { ctx: /** @type {any} */ (ctx) });
      // RECOGNITION R12: fielding counts where every fielding wicket names
      // its fielders (potmBasis), and the decision stores which.
      const basis = potmBasis(facts);
      const figures = new Map(matchFigures(facts, ids, basis).map((f) => [f.playerId, figuresWords(f)]));
      const names = new Map(mine.map((x) => [x.player_id, x.full_name]));
      const conflicts = new Set(s.conflicts ?? []);
      // D10: a boy whose guardian the reader is cannot be chosen, and the
      // line says who decides instead.
      const conflictWords = potmWords("guardian_conflict", s.instead ?? null);
      out.set(s.side, {
        figures, basis,
        suggestions: suggestPlayerOfMatch(facts, ids, undefined, basis).map((x) => ({ ...x, name: names.get(x.playerId) ?? null,
          conflict: conflicts.has(x.playerId), conflictWords: conflicts.has(x.playerId) ? conflictWords : null })),
        sheet: mine.map((x) => ({ playerId: x.player_id, name: x.full_name, figures: figures.get(x.player_id) ?? null,
          conflict: conflicts.has(x.player_id), conflictWords: conflicts.has(x.player_id) ? conflictWords : null })),
      });
    }
    return out;
  }

  return {
    state: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from match_award_state($1)`, [id]);
        const work = await working(client, id, rows);
        // One log, one basis for every side of it; D17's line, or none once
        // fielding is counted (RECOGNITION R12).
        const basis = [...work.values()][0]?.basis ?? POTM_BASIS;
        return {
          matchId: id, basis: basisWords(basis), basisKey: basis,
          sides: rows.map((r) => ({
            side: r.side, schoolId: r.school_id, teamCode: r.team_code, label: r.side_label, opponent: r.opponent_label,
            heading: r.heading, verified: r.verified === true, headSeq: r.head_seq,
            mayAward: r.can_award === true, refusal: r.refusal ?? null,
            refusalWords: r.refusal && r.refusal !== "already_awarded" ? potmWords(r.refusal) : null,
            standing: r.honour_id ? { honourId: r.honour_id, playerId: r.player_id, name: r.player_name,
                                      awardedAt: r.awarded_at, decidedBy: r.decided_by_name } : null,
            mayWithdraw: r.can_withdraw === true,
            suggestions: r.can_award ? work.get(r.side)?.suggestions ?? [] : [],
            sheet: r.can_award ? work.get(r.side)?.sheet ?? [] : [],
          })),
        };
      });
    }),

    award: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      if (!UUID.test(String(b.playerId ?? ""))) throw err("player_required");
      if (!Number.isInteger(b.headSeq) || b.headSeq < 0) throw err("head_seq_required");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows: st } = await client.query(`select * from match_award_state($1)`, [id]);
        const work = await working(client, id, st);
        // The side the boy is on, if the caller decides for it; the door says
        // which refusal it is either way.
        const side = [...work.entries()].find(([, w]) => w.sheet.some((/** @type {any} */ x) => x.playerId === b.playerId));
        const derived = {
          version: 1, basis: side ? side[1].basis : POTM_BASIS, factsVersion: FACTS_VERSION, headSeq: b.headSeq,
          suggestions: side ? side[1].suggestions.map((/** @type {any} */ x) => ({ playerId: x.playerId, figures: x.figures })) : [],
          awardee: { playerId: b.playerId, figures: side ? side[1].figures.get(b.playerId) ?? "Did not bat or bowl" : "" },
        };
        const { rows } = await client.query(`select * from match_award($1, $2, $3::jsonb)`, [id, b.playerId, JSON.stringify(derived)]);
        const r = rows[0];
        if (!r) throw err("no_result", 500);
        if (!r.ok) throw err(r.reason, r.reason === "not_permitted" ? 403 : 422, r.detail ?? undefined);
        return { ok: true, honourId: r.honour_id };
      });
    }),

    withdraw: handle(async (req) => {
      idOf(req);
      const b = req.body || {};
      if (!UUID.test(String(b.honourId ?? ""))) throw err("honour_required");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from match_award_withdraw($1, $2, $3)`,
          [b.honourId, typeof b.kind === "string" ? b.kind : null, typeof b.reason === "string" ? b.reason : null]);
        const r = rows[0];
        if (!r) throw err("no_result", 500);
        if (!r.ok) throw err(r.reason, r.reason === "not_permitted" ? 403 : 422, r.detail ?? undefined);
        return { ok: true };
      });
    }),
  };
}

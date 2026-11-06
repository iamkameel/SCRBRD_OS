/**
 * SCRBRD — Player of the Match, the captain's nomination (RECOGNITION R7, db/144).
 *
 *   GET  /api/matches/:id/player-of-match/nomination
 *        → { matchId, basis, captain: [side…], staff: [side…] }
 *          captain: the sides the caller captains this season, as himself (D17):
 *            { side, heading, nominatedAs, coachName, mayNominate, refusal, refusalWords,
 *              closesAt, headSeq, suggestions, sheet, mine }
 *          staff: the sides whose nomination the caller reads as the side's staff (D8, D18):
 *            { side, nominationId, nomineeId, nomineeName, nominatedAs, status, nominatedAt,
 *              closesAt, decidedAt, decidedBy, honourId, mayDecide, refusal, refusalWords }
 *   POST /api/matches/:id/player-of-match/nomination          { playerId, headSeq } → { ok, nominationId }
 *   POST /api/matches/:id/player-of-match/nomination/decide   { nominationId, action, playerId?, headSeq } → { ok, honourId }
 *   GET  /api/player-of-match/to-decide                       → { rows } (the To-resolve list)
 *
 * WHO. Every rule is db/144's. captain_nomination_state() answers a side only
 * to the pupil who captains it this season, signed in as himself;
 * captain_nominate() is D16's nine tests; match_nomination_state() answers the
 * side's staff; match_nomination_decide() is R6's deciders, never the
 * nominee's guardian, never the nominator; confirm and choose go through R6's
 * match_award(), which writes the honour and tells the side.
 *
 * WHAT THE CAPTAIN IS SENT (D17). The same suggestions the coach sees (R1's
 * facts, packages/scoring's suggestPlayerOfMatch(), "Based on batting and
 * bowling only."), the rest of his own side's sheet without him, and his own
 * nomination's state. Never the other side's boys, never a reason, never a
 * verdict word. The sheet and the names are the door's (short names, as the
 * side's notice says them); the figures are worked out from the log as he
 * reads it, as the scorecard he already reads.
 *
 * WHAT HE WRITES. Ids and figures. There is no text field to send.
 */
import { deriveFacts, fromRow, suggestPlayerOfMatch, matchFigures, figuresWords, BASIS_WORDS, POTM_BASIS, FACTS_VERSION } from "@scrbrd/scoring";
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { EVENT_COLUMNS_SEEN, matchFoldContext } from "./events-api.mjs";
import { potmWords } from "./potm-api.mjs";
import { safeErr } from "../log-safe.mjs";
/** @import { RouteDeps, IdHandler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (/** @type {string} */ code, status = 400, /** @type {unknown} */ detail = undefined) =>
  Object.assign(new Error(code), { status, detail });

/**
 * What the captain is told, in §7's words ("the captain"). Never "rejected",
 * "declined" or "overruled"; never the coach's reason.
 */
export const CAPTAIN_WORDS = Object.freeze({
  not_permitted: "Only the side's captain, signed in as himself, nominates.",
  not_captain: "Only the side's captain nominates.",
  captain_on_sheet: "The captain is playing, so he nominates.",
  not_on_sheet: "You are not on this match's sheet, so the coach decides.",
  nominee_not_on_sheet: "Choose a team-mate on this match's sheet.",
  cannot_nominate_yourself: "You cannot choose yourself.",
  not_verified: "You can nominate once the scorer has sealed the match.",
  already_awarded: "Player of the Match is decided.",
  window_closed: "The time to nominate has passed. The coach decides.",
  already_nominated: "Your nomination is with the coach.",
  already_decided: "The coach has decided.",
  no_season: "The school calendar holds no season for this match's date.",
  stale: "The scorecard changed. The suggestions are read again: look, then nominate.",
  derived_from_invalid: "The suggestions could not be read. Nothing was sent.",
});

/** What the coach is told about a nomination he cannot act on, or a refused act (§7, "the coach"). */
export const NOMINATION_WORDS = Object.freeze({
  lapsed: "The captain's window closed before anyone decided. Decide without the nomination.",
  already_decided: "This nomination is decided.",
  decided: "This nomination is decided.",
  action_invalid: "Confirm, choose another, or record no award.",
  decider_is_nominator: "You made this nomination, so another coach decides.",
  player_required: "Choose the player first.",
  nomination_open: "The captain's nomination is open: decide it from the nomination.",
});

/** @param {string} reason */
export const captainWords = (reason) => CAPTAIN_WORDS[/** @type {keyof typeof CAPTAIN_WORDS} */ (reason)] ?? "Could not send it; nothing was changed.";
/** @param {string} reason @param {string | null} detail */
export function nominationWords(reason, detail = null) {
  return NOMINATION_WORDS[/** @type {keyof typeof NOMINATION_WORDS} */ (reason)] ?? potmWords(reason, detail);
}

/** @param {RouteDeps} deps @returns {Record<string, IdHandler>} */
export function nominationRoutes({ pool, secret }) {
  /** @param {(req: any) => Promise<unknown>} fn @param {(r: string, d: string | null) => string} words @returns {IdHandler} */
  const handle = (fn, words) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted", message: words("not_permitted", null) });
      if (e.code === "22P02") return res.status(400).json({ error: "malformed" });
      // db/144's honour_tie_nomination(): R6's door, used while a nomination is open, by its nominee's guardian.
      if (e.code === "23514" && e.message === "nomination_guardian_conflict") {
        return res.status(422).json({ error: "guardian_conflict", detail: e.detail ?? null, message: potmWords("guardian_conflict", e.detail ?? null) });
      }
      if (e.code === "23514" && e.message === "decider_is_nominator") {
        return res.status(422).json({ error: "decider_is_nominator", message: nominationWords("decider_is_nominator") });
      }
      const status = e.status || 500;
      if (status >= 500) { console.error("nomination →", safeErr(e)); return res.status(status).json({ error: "error" }); }
      res.status(status).json({ error: e.message || "error", ...(e.detail !== undefined ? { detail: e.detail } : {}),
                                message: words(e.message, /** @type {string | null} */ (e.detail ?? null)) });
    }
  };
  /** @param {any} req */
  const as = (req) => req.headers?.authorization;
  /** @param {any} req */
  const idOf = (req) => { const id = String(req.params?.id ?? ""); if (!UUID.test(id)) throw err("not_found", 404); return id; };

  /**
   * One side's suggestions and figures, from the log as this caller reads it,
   * over the roster the door gave (the sheet, as ids).
   * @param {any} client @param {string} id @param {string[]} roster
   */
  async function working(client, id, roster) {
    const { rows: evs } = await client.query(`select ${EVENT_COLUMNS_SEEN} from ball_event where match_id = $1 order by seq`, [id]);
    const ctx = await matchFoldContext(client, id);
    const facts = deriveFacts(evs.map(fromRow), roster, { ctx: /** @type {any} */ (ctx) });
    const figures = new Map(matchFigures(facts, roster).map((f) => [f.playerId, figuresWords(f)]));
    return { figures, suggestions: suggestPlayerOfMatch(facts, roster) };
  }

  /** The side's full sheet, as ids, through the door that answered the side (his own id first). @param {any} s @param {string | null} me */
  const rosterOf = (s, me) => [...new Set([...(me ? [me] : []), ...(s.sheet ?? []).map((/** @type {any} */ x) => x.playerId)])];

  /** The captain's sides, worked. @param {any} client @param {string} id */
  async function captainSides(client, id) {
    const { rows } = await client.query(`select * from captain_nomination_state($1)`, [id]);
    const out = [];
    for (const r of rows) {
      const sheet = Array.isArray(r.sheet) ? r.sheet : [];
      const mine = r.self_id ?? null;
      /** @type {any[]} */
      let suggestions = [];
      /** @type {Map<string, string>} */
      let figures = new Map();
      if (r.may_nominate) {
        const w = await working(client, id, rosterOf({ sheet }, mine));
        figures = w.figures;
        const names = new Map(sheet.map((/** @type {any} */ x) => [x.playerId, x.name]));
        // The coach's suggestions, as he sees them; the captain's own name is
        // left off his list (he cannot choose himself), never re-ranked.
        suggestions = w.suggestions.filter((x) => names.has(x.playerId)).map((x) => ({ ...x, name: names.get(x.playerId) }));
      }
      out.push({
        side: r.side, heading: r.heading, nominatedAs: r.nominated_as, coachName: r.coach_name ?? null,
        mayNominate: r.may_nominate === true, refusal: r.refusal ?? null,
        refusalWords: r.refusal ? captainWords(r.refusal) : null,
        closesAt: r.closes_at, headSeq: r.head_seq,
        suggestions,
        sheet: sheet.map((/** @type {any} */ x) => ({ playerId: x.playerId, name: x.name, figures: figures.get(x.playerId) ?? null })),
        mine: r.nomination_id ? {
          nominationId: r.nomination_id, nomineeName: r.nominee_name, status: r.status,
          nominatedAt: r.nominated_at, decidedAt: r.decided_at, closesAt: r.closes_at,
          award: r.award_name ? { name: r.award_name, awardedAt: r.awarded_at, same: r.award_player_id === r.nominee_id } : null,
        } : null,
      });
    }
    return out;
  }

  return {
    state: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const captain = await captainSides(client, id);
        const { rows } = await client.query(`select * from match_nomination_state($1)`, [id]);
        return {
          matchId: id, basis: BASIS_WORDS, captain,
          staff: rows.map((r) => ({
            side: r.side, nominationId: r.nomination_id, nomineeId: r.nominee_id, nomineeName: r.nominee_name,
            nominatedAs: r.nominated_as, status: r.status, nominatedAt: r.nominated_at, closesAt: r.closes_at,
            decidedAt: r.decided_at, decidedBy: r.decided_by_name ?? null, honourId: r.honour_id ?? null,
            mayDecide: r.may_decide === true, refusal: r.refusal ?? null,
            refusalWords: r.refusal && r.refusal !== "decided" ? nominationWords(r.refusal, r.instead ?? null) : null,
          })),
        };
      });
    }, captainWords),

    nominate: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      if (!UUID.test(String(b.playerId ?? ""))) throw err("nominee_not_on_sheet");
      if (!Number.isInteger(b.headSeq) || b.headSeq < 0) throw err("stale");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows: st } = await client.query(`select * from captain_nomination_state($1)`, [id]);
        const s = st.find((r) => r.may_nominate && Array.isArray(r.sheet));
        /** @type {{version: number, basis: string, factsVersion: number, headSeq: number, suggestions: {playerId: string, figures: string}[], nominee: {playerId: string, figures: string}}} */
        let derived = { version: 1, basis: POTM_BASIS, factsVersion: FACTS_VERSION, headSeq: b.headSeq, suggestions: [], nominee: { playerId: b.playerId, figures: "" } };
        if (s) {
          const w = await working(client, id, rosterOf({ sheet: s.sheet }, s.self_id ?? null));
          derived = { ...derived,
            suggestions: w.suggestions.map((x) => ({ playerId: x.playerId, figures: x.figures })),
            nominee: { playerId: b.playerId, figures: w.figures.get(b.playerId) ?? "Did not bat or bowl" } };
        }
        const { rows } = await client.query(`select * from captain_nominate($1, $2, $3::jsonb)`, [id, b.playerId, JSON.stringify(derived)]);
        const r = rows[0];
        if (!r) throw err("no_result", 500);
        if (!r.ok) throw err(r.reason, r.reason === "not_permitted" ? 403 : 422);
        return { ok: true, nominationId: r.nomination_id };
      });
    }, captainWords),

    decide: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      if (!UUID.test(String(b.nominationId ?? ""))) throw err("not_permitted", 403);
      const action = typeof b.action === "string" ? b.action : null;
      if (action !== "no_award" && (!Number.isInteger(b.headSeq) || b.headSeq < 0)) throw err("stale", 422);
      if (b.playerId != null && !UUID.test(String(b.playerId))) throw err("player_required");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        let derived = null;
        if (action === "confirm" || action === "choose") {
          // R6's working, for the award match_award() writes: the side's
          // sheet as the caller reads it (he is the side's decider), its
          // suggestions and the awardee's figures, at the head he saw.
          const { rows: st } = await client.query(`select * from match_nomination_state($1)`, [id]);
          const s = st.find((r) => r.nomination_id === b.nominationId);
          const awardee = action === "confirm" ? s?.nominee_id : b.playerId;
          const { rows: sheet } = await client.query(
            `select s.player_id from match_squad s where s.match_id = $1 and s.side = $2 and not s.withdrawn`, [id, s?.side ?? "home"]);
          const roster = sheet.map((x) => x.player_id);
          const w = await working(client, id, roster);
          derived = { version: 1, basis: POTM_BASIS, factsVersion: FACTS_VERSION, headSeq: b.headSeq,
            suggestions: w.suggestions.map((x) => ({ playerId: x.playerId, figures: x.figures })),
            awardee: { playerId: awardee ?? null, figures: awardee ? w.figures.get(awardee) ?? "Did not bat or bowl" : "" } };
        }
        const { rows } = await client.query(`select * from match_nomination_decide($1, $2, $3, $4::jsonb)`,
          [b.nominationId, action, b.playerId ?? null, derived ? JSON.stringify(derived) : null]);
        const r = rows[0];
        if (!r) throw err("no_result", 500);
        if (!r.ok) throw err(r.reason, r.reason === "not_permitted" ? 403 : 422, r.detail ?? undefined);
        return { ok: true, honourId: r.honour_id ?? null };
      });
    }, nominationWords),

    toDecide: handle(async (req) => runAsPrincipal(pool, secret, as(req), async (client) => {
      const { rows } = await client.query(`select * from nominations_to_decide()`);
      return { rows: rows.map((r) => ({
        nominationId: r.nomination_id, matchId: r.match_id, startsAt: r.starts_at, side: r.side, sideLabel: r.side_label,
        heading: r.heading, nomineeName: r.nominee_name, nominatedAs: r.nominated_as, closesAt: r.closes_at,
      })) };
    }), nominationWords),
  };
}

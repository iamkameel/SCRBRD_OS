/**
 * SCRBRD — Colours: the side's coach nominates, the school decides
 * (RECOGNITION R8, db/146).
 *
 *   GET  /api/colours/nominations                → { sides: [side…], rows: [nomination…] }
 *        sides: the sides the caller nominates for (the side's coach), so a
 *        screen offers only the boys the door would take
 *        every Colours nomination the caller reads (D8): his own, and those of
 *        the sides he is staff of or the school he decides or records at,
 *        open first, each with whether he may decide it now and, if not, why,
 *        in §7's words for the coach and the deciders
 *   POST /api/colours/nominations                { playerId, kind, rationale? } → { ok, nominationId }
 *   POST /api/colours/nominations/:id/decide     { action: "award" | "no_award", citation? } → { ok, honourId }
 *
 * WHO. Every rule is db/146's: recognition.colours.nominate over the boy's
 * side (the side's coach) to nominate, never himself; recognition.decide at
 * the school (the director of sport, the principal) to decide, never the
 * coach who nominated, never a guardian of the boy either way (D10, Kameel
 * 6 Nov 2026), who is told who decides instead. The award is the ordinary
 * honour row, decided_by the decider (D5).
 *
 * THE WORDS (D2). The rationale is read by the side's staff and the school's
 * deciders; the citation by his side and his parents. Both pass the one
 * writer-side list (packages/policy/src/words.mjs) before anything is
 * written, and a hit is refused back to the writer with the words named.
 * Nothing about a nomination is told to anybody: a boy never learns he was
 * nominated and not chosen (D8).
 */
import { refusedWords } from "@scrbrd/policy/words";
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { wordsRefusal } from "./recognition-api.mjs";
import { safeErr } from "../log-safe.mjs";
/** @import { RouteDeps, IdHandler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["colours", "half_colours"];
export const TEXT_MIN = 3, TEXT_MAX = 300;
const err = (/** @type {string} */ code, status = 400, /** @type {Record<string, unknown>} */ extra = {}) =>
  Object.assign(new Error(code), { status, extra });

/**
 * What the coach and the deciders are told (§7: "the coach", "the office").
 * Never "approve your own"; never a button the server would refuse.
 */
export const COLOURS_WORDS = Object.freeze({
  not_permitted: "Only the side's coach nominates a boy of his side, and only the director of sport or the principal decides.",
  kind_invalid: "Choose Full colours or Half colours.",
  player_required: "Choose the boy first.",
  cannot_nominate_yourself: "You cannot nominate yourself.",
  cannot_award_yourself: "You cannot decide your own Colours.",
  no_season: "The school calendar holds no season for today.",
  already_awarded: "He already holds them this season.",
  already_nominated: "He is already nominated for them this season. The school is deciding.",
  rationale_invalid: `Say why in ${TEXT_MIN} to ${TEXT_MAX} characters, or leave it empty.`,
  citation_invalid: `Write the citation in ${TEXT_MIN} to ${TEXT_MAX} characters, or leave it empty.`,
  already_decided: "This nomination is decided.",
  decided: "This nomination is decided.",
  action_invalid: "Award, or record no award.",
  decider_is_nominator: "You made this nomination, so another of the school's deciders decides.",
});

/** @param {string | null} instead */
const guardianWords = (instead) =>
  `You are his guardian, so ${instead === "principal" ? "the principal" : "the director of sport"} decides.`;

/** @param {string} reason @param {string | null} detail */
export function coloursWords(reason, detail = null) {
  if (reason === "guardian_conflict") return guardianWords(detail);
  return COLOURS_WORDS[/** @type {keyof typeof COLOURS_WORDS} */ (reason)] ?? "Could not send it; nothing was changed.";
}

/** "Full colours" | "Half colours" */
export const kindWords = (/** @type {string} */ kind) => (kind === "half_colours" ? "Half colours" : "Full colours");

/** @param {RouteDeps} deps @returns {Record<string, IdHandler>} */
export function coloursRoutes({ pool, secret }) {
  /** @param {(req: any) => Promise<unknown>} fn @returns {IdHandler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted", message: coloursWords("not_permitted") });
      if (e.code === "22P02") return res.status(400).json({ error: "malformed" });
      // honour_colours_answer() (db/146): the same row checks at the table.
      if (e.code === "23514" && e.message === "colours_guardian_conflict") {
        return res.status(422).json({ error: "guardian_conflict", detail: e.detail ?? null, message: guardianWords(e.detail ?? null) });
      }
      if (e.code === "23514" && e.message === "decider_is_nominator") {
        return res.status(422).json({ error: "decider_is_nominator", message: coloursWords("decider_is_nominator") });
      }
      const status = e.status || 500;
      if (status >= 500) { console.error("colours →", safeErr(e)); return res.status(status).json({ error: "error" }); }
      res.status(status).json({ error: e.message || "error", ...(e.extra ?? {}),
                                message: e.extra?.message ?? coloursWords(e.message, /** @type {string | null} */ (e.extra?.detail ?? null)) });
    }
  };
  /** @param {any} req */
  const as = (req) => req.headers?.authorization;
  /** @param {unknown} v @returns {string | null} */
  const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());

  return {
    list: handle(async (req) => runAsPrincipal(pool, secret, as(req), async (client) => {
      const { rows } = await client.query(`select * from colours_nominations()`);
      const { rows: sides } = await client.query(`select * from colours_sides()`);
      return {
        // The sides he nominates for: the sheet offers only their boys.
        sides: sides.map((s) => ({ schoolId: s.school_id, teamCode: s.team_code, sideLabel: s.side_label })),
        rows: rows.map((r) => ({
          nominationId: r.nomination_id, kind: r.kind, kindWords: kindWords(r.kind), season: r.season,
          schoolId: r.school_id, teamCode: r.team_code, sideLabel: r.side_label,
          nomineeId: r.nominee_id, nomineeName: r.nominee_name, nominatedBy: r.nominated_by_name ?? null, mine: r.mine === true,
          rationale: r.rationale ?? null, status: r.status, nominatedAt: r.nominated_at, decidedAt: r.decided_at,
          decidedBy: r.decided_by_name ?? null, honourId: r.honour_id ?? null,
          mayDecide: r.may_decide === true, refusal: r.refusal ?? null,
          refusalWords: r.refusal && r.refusal !== "decided" && r.refusal !== "not_permitted" ? coloursWords(r.refusal, r.instead ?? null) : null,
        })),
      };
    })),

    nominate: handle(async (req) => {
      const b = req.body || {};
      if (!UUID.test(String(b.playerId ?? ""))) throw err("player_required");
      if (!KINDS.includes(b.kind)) throw err("kind_invalid");
      const rationale = text(b.rationale);
      if (rationale && (rationale.length < TEXT_MIN || rationale.length > TEXT_MAX)) throw err("rationale_invalid");
      const hits = refusedWords(rationale);
      if (hits.length) {
        throw err("rationale_refused", 422, { words: hits.map((h) => h.word),
          message: wordsRefusal(hits, "A rationale", "the side's staff and the school's deciders") });
      }
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from colours_nominate($1, $2, $3)`, [b.playerId, b.kind, rationale]);
        const r = rows[0];
        if (!r) throw err("no_result", 500);
        if (!r.ok) throw err(r.reason, r.reason === "not_permitted" ? 403 : 422);
        return { ok: true, nominationId: r.nomination_id };
      });
    }),

    decide: handle(async (req) => {
      const id = String(req.params?.id ?? "");
      if (!UUID.test(id)) throw err("not_permitted", 403);
      const b = req.body || {};
      const action = typeof b.action === "string" ? b.action : null;
      if (action !== "award" && action !== "no_award") throw err("action_invalid");
      const citation = action === "award" ? text(b.citation) : null;
      if (citation && (citation.length < TEXT_MIN || citation.length > TEXT_MAX)) throw err("citation_invalid");
      const hits = refusedWords(citation);
      if (hits.length) {
        throw err("citation_refused", 422, { words: hits.map((h) => h.word),
          message: wordsRefusal(hits, "A citation", "his side and his parents") });
      }
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from colours_decide($1, $2, $3)`, [id, action, citation]);
        const r = rows[0];
        if (!r) throw err("no_result", 500);
        if (!r.ok) throw err(r.reason, r.reason === "not_permitted" ? 403 : 422, { detail: r.detail ?? null });
        return { ok: true, honourId: r.honour_id ?? null };
      });
    }),
  };
}

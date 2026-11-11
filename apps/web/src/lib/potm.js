/**
 * Player of the Match on the staff sheet: the words (RECOGNITION R6,
 * docs/design/RECOGNITION_design.md §7 "the coach", D18, D21; db/142).
 *
 * The server decides every rule and words every refusal (potm-api.mjs
 * POTM_WORDS); this holds the sheet's own sentences, so the screen and its
 * tests read one copy.
 */
import { whenWords } from "./official.js";

/** "R Pillay" from "Rohan Pillay": the initial and the surname, as db/142's match_award_short(). */
export function potmShortName(name) {
  const s = String(name ?? "").trim().replace(/\s+/g, " ");
  const m = /^(\S)\S*\s+(?:.*\s)?(\S+)$/.exec(s);
  return m ? `${m[1]} ${m[2]}` : s;
}

/** The confirm sheet's one sentence (§7). */
export const confirmWords = (name) => `This awards Player of the Match to ${potmShortName(name)} and tells the side.`;

/** The two kinds of withdrawal (D21), and what each tells the side. */
export const WITHDRAW_KINDS = Object.freeze([
  Object.freeze({ kind: "correction", label: "After a scorecard correction",
    says: "The side is told the award was withdrawn after the scorecard was corrected. Nobody is named." }),
  Object.freeze({ kind: "other", label: "For another reason",
    says: "The side's notice is taken back and nothing more is said. The school speaks to the family in person." }),
]);

/** The reason's limits, as the door has them. */
export const POTM_REASON_MIN = 3, POTM_REASON_MAX = 200;

/**
 * The standing award as staff read it: "Player of the Match: Rohan Pillay ·
 * decided by Sarah Botha, 20:15, 4 Oct". Staff see the name (§2.3).
 * @param {{name?: string | null, decidedBy?: string | null, awardedAt?: string | null} | null} s
 * @param {number} [now]
 */
export function standingWords(s, now = Date.now()) {
  if (!s) return null;
  const when = s.awardedAt ? whenWords(s.awardedAt, now) : null;
  return `Player of the Match: ${s.name ?? "a player"}`
    + (s.decidedBy ? ` · decided by ${s.decidedBy}` : "") + (when ? `, ${when}` : "");
}

/** What a refused act says when the server sent no words. */
export const FALLBACK = "Could not reach the server; nothing was changed.";

/**
 * RECOGNITION R10 (db/148, D19): a correction moved what a standing award
 * stood on, and the award returns to its decider. §7 "the coach": "The
 * figures this award cited have changed: 104 (71) → 99 (70). Withdraw, or
 * let it stand." The figures are the ones the award cited and the ones the
 * log holds now; the result is said only once the scorer has sealed again.
 * @param {{figuresBefore?: string | null, figuresNow?: string | null, resultMoved?: boolean} | null} r
 * @returns {string | null}
 */
export function reviewWords(r) {
  if (!r) return null;
  const moved = r.figuresBefore != null && r.figuresNow != null && r.figuresBefore !== r.figuresNow;
  const head = moved && r.resultMoved ? `The figures this award cited have changed: ${r.figuresBefore} → ${r.figuresNow}, and so has the result.`
    : moved ? `The figures this award cited have changed: ${r.figuresBefore} → ${r.figuresNow}.`
    : r.resultMoved ? "The result this award was decided on has changed."
    : `The scorecard was corrected after this award; the figures it cited read ${r.figuresNow ?? r.figuresBefore ?? "the same"} again.`;
  return `${head} Withdraw, or let it stand.`;
}

/** What letting it stand says, done. */
export const STOOD_WORDS = "It stands. The review is closed with your name; the side is told nothing.";

/**
 * The decider's To-resolve rows (GA-I09 O7, D19): one per open review the
 * reader may act on, "Player of the Match to review · V Boy1 · the scorecard
 * was corrected", with its one door to the fixture's sheet. The read decides
 * who sees a row (db/148 recognition_reviews_open()). `rows` is the read's
 * answer, `null` a read that failed.
 * @param {{rows: any[] | null, error?: string | null}} o
 */
export function reviewRows({ rows, error = null }) {
  if (rows == null) {
    return { rows: [], unread: [{ id: "potm-review:read", rule: "read", state: /** @type {const} */ ("could_not_read"), read: "potm-review",
      fact: "Could not read the awards to review", count: 0, source: null, owner: null, deadline: null, age: null,
      action: { kind: "retry", label: "Try again" }, error }], open: 0, failed: 1 };
  }
  const out = rows.map((r) => ({
    id: `potm-review:${r.reviewId}`, rule: "P2", state: /** @type {const} */ ("open"), count: 1,
    fact: `Player of the Match to review · ${potmShortName(r.playerName)} · the scorecard was corrected`,
    source: "a scorecard correction", owner: "you", deadline: null, age: null,
    action: { kind: "result", label: "Review it", matchId: r.matchId },
  }));
  return { rows: out, unread: [], open: out.length, failed: 0 };
}

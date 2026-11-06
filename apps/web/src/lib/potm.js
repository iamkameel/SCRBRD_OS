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

/**
 * THE MATCH FORMAT, AND WHETHER A NO-BALL GIVES A FREE HIT (SCRBRD-113).
 *
 * The free hit is not in the Laws of Cricket (the 4th Edition's text has no
 * such thing, nor had the 3rd): it is a playing condition of limited-overs
 * cricket. Decided by Kameel (2026-09-27), for South African school cricket:
 *
 *   - a LIMITED-OVERS match (T20, 50-over, any format whose innings are
 *     limited to a number of overs) gives a free hit after a no-ball;
 *   - a DECLARATION or TIMED match, one-day or multi-day, does not: there a
 *     no-ball is its penalty run and an extra delivery, nothing more.
 *
 * THE FORMAT is the fixture's (`match.format`, db/00: free text, required for
 * cricket, "T20" by default), which the fold is told as FoldContext.format by
 * whoever holds the fixture — the server always (it reads it beside the log),
 * the pad for a fixture opened from the server, the Match Centre from the
 * events read. SQL asks the same question of the same column
 * (free_hits_apply(), db/54). A match with no format stated — a fold told
 * nothing, the pad's own match, a fixture row with none — keeps what every
 * match had before this: a free hit after every no-ball. This is a
 * correction, not a change of Edition: it follows the stored format and not
 * the match date, so an old declaration match now folds as one.
 *
 * The formats the fixture screen offers (views/fixtures.jsx) are
 * MATCH_FORMAT's. Other spellings a fixture may carry are read by
 * formatKind() — "50-over" and "multi-day" are db/00's own — and anything it
 * does not know is limited-overs (a free hit), as today.
 */

/** The formats the fixture screen offers, as `match.format` stores them. */
export const MATCH_FORMAT = Object.freeze({
  T20: "T20",
  ONE_DAY: "One-Day",                          // 50 overs an innings: limited
  ONE_DAY_DECLARATION: "One-Day Declaration",  // a timed day, declarations: no free hit
  TWO_DAY: "Two-Day",                          // declarations: no free hit
});

/**
 * The spellings of a declaration or timed format, lower-cased with the
 * spaces closed up: every one of these, and nothing else, is a match with no
 * free hit. db/54's free_hits_apply() holds the same list, and its proof and
 * edition.test.mjs check the two against each other.
 * @type {ReadonlySet<string>}
 */
export const DECLARATION_FORMATS = new Set([
  "one-day declaration", "one day declaration", "declaration", "timed", "timed match",
  "two-day", "two day", "three-day", "three day", "four-day", "four day", "five-day", "five day",
  "multi-day", "multi day", "test",
]);

/** A format as it is compared: lower case, the spaces closed up. @param {unknown} format */
const spelled = (format) => (typeof format === "string" ? format.trim().toLowerCase().replace(/\s+/g, " ") : "");

/**
 * What kind of match a format is: "declaration" (declaration or timed, one
 * day or more), "limited" (any other format stated), or null when none is.
 * @param {unknown} format  `match.format`, as stored
 * @returns {"limited" | "declaration" | null}
 */
export function formatKind(format) {
  const s = spelled(format);
  if (s === "") return null;
  return DECLARATION_FORMATS.has(s) ? "declaration" : "limited";
}

/**
 * Does a no-ball give a free hit in a match of this format? Everywhere but a
 * declaration or timed match — and in a match whose format nobody stated, as
 * before. The one question the fold (replay.mjs), the pad's sheets and
 * banner (through the fold's `inn.freeHits`), the commentary and SQL
 * (free_hits_apply(), db/54) all ask.
 * @param {unknown} format
 * @returns {boolean}
 */
export function freeHitsApply(format) {
  return formatKind(format) !== "declaration";
}

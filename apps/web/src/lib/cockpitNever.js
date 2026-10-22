/**
 * WHAT THE COCKPIT NEVER SAYS (SCRBRD-136 §3.7; SCRBRD-137 §4.4). Words only,
 * kept apart from the code they police so the code may be searched for them.
 */

/**
 * The words that would make the tab or the feed a leak: a clinical nature, a
 * wellness word, a guideline, a ratio, a win chance, a percentage beside a
 * figure. The browser walk reads every word of the rendered tab and drawer
 * against this; the unit tests read the rules' own sentences against it. A
 * coach HAS availability and restriction, and the load sentence says
 * "diagnosis": those are removed before the check (LOAD_SENTENCE in
 * lib/cockpit.js), not allowed in general.
 */
export const NEVER_ON_THE_COCKPIT =
  /\brisk\b|danger|unsafe|wellness|check-?in|soreness|\bflag\b|guideline|hamstring|shoulder|fracture|sprain|strain|concussion|tendon|impingement|grade [123]|ewma|\bacwr\b|\bratio\b|diagnos|win chance|chance of winning|probab|threat|pressure|\d\s?%/i;

/**
 * Fields the cockpit's code must never read (D4, D5, D6, D7): the reason an
 * absence was given, an injury's nature, a ratio, a wellness flag, whether a
 * boy is monitored. apps/web/test/cockpit.test.mjs and signals.test.mjs scan
 * the code, comments removed, for every one.
 */
export const FORBIDDEN_FIELDS = Object.freeze([
  "reason_kind", "reasonKind", "injury_type", "injuryType", "severity", "acwr", "ewma_ratio", "ewmaRatio",
  "open_flag", "openFlag", "monitored", "wellness",
  // GA-I19 D5 (db/111): the physio's clock and a serious injury's mark never
  // reach the cockpit or the queue; the coach reads status there, nothing more.
  "next_review_on", "nextReviewOn", "emergency_services", "emergencyServices",
  "phase_after", "phaseAfter", "review_reason", "reviewReason",
]);

/**
 * No rule keys a card to the other side's boy (away visibility §7, AV3).
 * Since db/97 a shared fixture's log is the visitors' to read as well, so its
 * balls name both sides' boys by id: the bowler of every ball, the striker
 * and the non-striker. The feed's rules are about our side, and a card keyed
 * to one of their ids would be a card about another school's child.
 *
 * So these ids never appear in lib/signals.js at all; the one id a rule may
 * key a card to from a read of the log is a spell's `bowlerId`, and only in
 * S2b, where it is the bowler of OUR fielding innings and the directive
 * beside him answered (which it does only for a boy whose load the reader
 * may read). signals.test.mjs holds the module to both, statically, and the
 * rules to it with the other side's rows as the reads return them.
 */
export const OTHER_SIDE_IDS = Object.freeze([
  "bowler_id", "striker_id", "non_striker_id", "dismissed_id", "strikerId", "nonStrikerId", "nonStriker", "dismissedId",
  "batterId", "batter_id", "bowlerName", "batterName",
]);

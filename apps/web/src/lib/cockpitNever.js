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
]);

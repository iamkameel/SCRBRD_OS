/**
 * SCRBRD — the notification vocabulary, said once.
 *
 * docs/design/NOTIFICATIONS.md D1: the lists live here and every other place
 * reads them. db/89_notification_contract.sql carries the same lists as
 * CHECKs, and packages/policy/test/notifications.test.mjs reads that file and
 * fails if the two disagree.
 */

/** D1: what a notice is. Nine, and nothing else. */
export const KINDS = Object.freeze([
  "injury", "recognition", "welfare", "safeguarding", "system",
  "availability", "fixture", "lift", "notice",
]);

/** D5: what a notice may be about. `welfare` and `news` arrived with db/89. */
export const SUBJECT_KINDS = Object.freeze([
  "match", "injury", "training", "transport", "facility",
  "skills", "system", "competition", "selection", "welfare", "news",
]);

/** D18: the three words a retraction may carry. */
export const RETRACTION_KINDS = Object.freeze(["correction", "withdrawn", "superseded"]);

/**
 * D2, the parts the database enforces (db/89): how long a notice lives when
 * its writer did not say, and which retraction word fits which kind. A kind
 * whose `retract` is empty is never taken back; a changed record writes its
 * own notice instead. (`superseded` is also the word for un-saying a
 * "withdrawn" notice whose original stands again, D19, whatever its kind.)
 *
 * `lives` is a number of days from publication, or the fixture the notice is
 * about: "start" (availability), "start+7" (fixture), "meet+1" (lift). A
 * subject that cannot be found falls back to thirty days.
 * @type {Readonly<Record<string, Readonly<{ lives: number | string, retract: readonly string[] }>>>}
 */
export const CONTRACT = Object.freeze({
  injury:       Object.freeze({ lives: 90,        retract: Object.freeze([]) }),
  recognition:  Object.freeze({ lives: 180,       retract: Object.freeze(["correction"]) }),
  welfare:      Object.freeze({ lives: 30,        retract: Object.freeze(["correction"]) }),
  safeguarding: Object.freeze({ lives: 30,        retract: Object.freeze([]) }),
  system:       Object.freeze({ lives: 180,       retract: Object.freeze([]) }),
  availability: Object.freeze({ lives: "start",   retract: Object.freeze([]) }),
  fixture:      Object.freeze({ lives: "start+7", retract: Object.freeze(["superseded"]) }),
  lift:         Object.freeze({ lives: "meet+1",  retract: Object.freeze([]) }),
  notice:       Object.freeze({ lives: 60,        retract: Object.freeze(["withdrawn"]) }),
});

/**
 * D4: a notice a person wrote is about nobody, for nobody, never high, and
 * read with news.read alone. The publish route's lock (S0) and the trigger
 * say the same thing.
 */
export const NOTICE_URGENCY = Object.freeze(["low", "medium"]);

/**
 * D17: a row behind a capability other than news.read lists its title only;
 * its body is read on open, and the open is logged.
 * @param {{ tiered?: boolean, required_capability?: string }} n
 */
export const isTiered = (n) =>
  n.tiered ?? (n.required_capability != null && n.required_capability !== "news.read");

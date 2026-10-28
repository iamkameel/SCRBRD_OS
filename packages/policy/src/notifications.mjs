/**
 * SCRBRD — the notification vocabulary, said once.
 *
 * docs/design/NOTIFICATIONS.md D1: the lists live here and every other place
 * reads them. db/89_notification_contract.sql carries the same lists as
 * CHECKs (the kinds and the lives as db/116 re-wrote them), and
 * packages/policy/test/notifications.test.mjs reads the latest file that
 * writes each and fails if the two disagree.
 */

/**
 * D1: what a notice is. Ten, and nothing else. `compromise` joined on 21 Oct
 * 2026 (INCIDENTS_AND_BREACHES D9; READERS_child_data Q8; db/116): a notice
 * that a child's data was, or may have been, seen by somebody who should not
 * have seen it. With `system`, the one kind the system itself writes to one
 * pupil — and only to a pupil of eighteen or more, his own data subject; under
 * eighteen his guardians are told (SG-9, db/116's trigger).
 */
export const KINDS = Object.freeze([
  "injury", "recognition", "welfare", "safeguarding", "system",
  "availability", "fixture", "lift", "notice", "compromise",
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
  // Two years, with the register; never taken back (a later fact is a second
  // notice): INCIDENTS D9.
  compromise:   Object.freeze({ lives: 730,       retract: Object.freeze([]) }),
});

/**
 * D1's `fixture`: "a fixture published, moved, cancelled, or a round decided"
 * — and, since OFFICIAL_RESULT (db/114, §3 "notices"), a result made official
 * or reopened. No new kind and no new CHECK: these are the words
 * result_official_notices() writes, to each side's team scope under
 * fixture.read, naming no child, no person and no reason. `official` is low
 * and is retracted `superseded`, saying nothing, when the result reopens;
 * `reopened` (a correction, a decision, a status change, the confirmer's
 * withdrawal) is medium and is the one thing said.
 */
export const RESULT_NOTICES = Object.freeze({
  official: Object.freeze({ urgency: "low", title: "Official result · ", says: "was confirmed at " }),
  reopened: Object.freeze({ urgency: "medium", title: "Result reopened · ", says: "is no longer official: ",
                            ends: "It will be confirmed again." }),
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

/**
 * D20 (db/120): the kinds a person may switch push off for — the union of
 * D20's "may switch off" column — and, of those, the ones a parent may switch
 * off for one child (the kinds that are ever about one child). Every other
 * kind is always pushed when it is medium or high: safeguarding, welfare and
 * system as D20 says; injury, which D20 offers to nobody; and compromise
 * (db/116). db/120's two CHECKs carry the same lists, and
 * packages/policy/test/notifications.test.mjs fails if they disagree.
 */
export const MUTABLE_KINDS = Object.freeze(["notice", "recognition", "fixture", "availability", "lift"]);
export const PER_CHILD_KINDS = Object.freeze(["recognition", "availability", "lift"]);

/**
 * D21: a pupil's medium pushes wait between these hours on this clock, and
 * go at `to`. Platform-fixed: not a school's setting, not the pupil's.
 */
export const QUIET_HOURS = Object.freeze({ from: 21, to: 6, timeZone: "Africa/Johannesburg" });

/**
 * SCRBRD — the notification vocabulary, said once.
 *
 * docs/design/NOTIFICATIONS.md D1: the lists live here and every other place
 * reads them. Slice S0 brings only `SUBJECT_KINDS`; S1 adds the kinds, the
 * per-kind contract, and the migration whose CHECKs a unit test holds to this
 * file.
 *
 * `welfare` is here before the database knows it (S0, "code only"). Until S1
 * re-adds the CHECK on notification.subject_kind (db/08), the database refuses
 * a welfare row, and the publish route says so in words rather than as a
 * bare constraint name. See `SUBJECT_KINDS_NOT_YET_STORED`.
 */

/** What a notice may be about. */
export const SUBJECT_KINDS = Object.freeze([
  "match", "injury", "training", "transport", "facility",
  "skills", "system", "competition", "selection", "welfare",
]);

/** In this list and not yet in the database's CHECK: refused there until S1. */
export const SUBJECT_KINDS_NOT_YET_STORED = Object.freeze(["welfare"]);

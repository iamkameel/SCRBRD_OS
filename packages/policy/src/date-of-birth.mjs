/**
 * SCRBRD — how a pupil's date of birth is established, in one place.
 *
 * "A DOB / ID number is required for all players and officials. Age tracking
 * is vital." That decision has to hold at every door into the player table or
 * it holds at none of them, and there are three: the Add Player form, the bulk
 * CSV import, and whatever comes next. Three copies of the rule is three
 * chances for them to disagree, and the one that drifts is the one nobody
 * tests — the import, which is also the one that creates four hundred rows at
 * a time.
 *
 * WHY THIS MATTERS MORE THAN A FORM VALIDATION. The guardian rules now REFUSE
 * to link a parent to a child whose date of birth is unknown, because a link
 * with no end date is what they exist to prevent. So a boy entered without one
 * is a boy whose family cannot be given access at all — and the office does
 * not find out at the point they made the mistake, they find out weeks later
 * when a parent asks why they cannot see their son. The rule belongs upstream,
 * where the record is created.
 *
 * THE SLASH IN "DOB / ID NUMBER" IS AN OR, AND IT IS THE USEFUL READING. A
 * South African ID number's first six digits ARE the date of birth, so a
 * school that has the ID has the birthday whether or not anybody typed it
 * separately. Requiring both would be asking for the same fact twice; taking
 * either, and checking them against each other when both arrive, is the rule
 * that actually serves an office working from a class list.
 */
import { readSaId, bornFromSaId } from "./sa-id.mjs";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date of birth is read back at least as far as when this boy's school
 * career began. A school cannot enrol a newborn and a school sport pupil is
 * not fifty — this catches a fat-fingered year (2101, or 1901) rather than
 * policing an exact age band, which is the selection trigger's job.
 */
export const PLAUSIBLE_YEARS = Object.freeze({ min: 3, max: 25 });

// Officials are adults; the same check with a different window and a
// different reason, so the message a screen shows says "an official", not
// "a school pupil".
export const PLAUSIBLE_YEARS_OFFICIAL = Object.freeze({ min: 16, max: 90 });

/**
 * Establish a date of birth from what the office actually typed.
 *
 * @param {{born?: string|null, idNumber?: string|null}} input
 * @param {Date} [today]
 * @param {{plausible?: {min: number, max: number}, notPlausible?: string}} [window]
 *   the age band and refusal reason; defaults to a school pupil's
 * @returns {{ok: true, born: string, idNumber: string|null, source: "typed"|"id_number",
 *            warning?: string, reason?: undefined, field?: undefined}
 *         | {ok: false, reason: string, field: "born"|"id_number",
 *            born?: undefined, idNumber?: undefined, source?: undefined, warning?: undefined}}
 *
 * `source` says which of the two the date came from, so a caller can tell the
 * office "we took his birthday from the ID number" rather than appearing to
 * invent one.
 */
export function resolveBirthDate({ born, idNumber } = {}, today = new Date(),
                                 { plausible = PLAUSIBLE_YEARS, notPlausible = "born_not_plausible_for_a_school_pupil" } = {}) {
  const typed = born == null || born === "" ? null : String(born).trim();
  const id = idNumber == null || idNumber === "" ? null : String(idNumber).replace(/\s/g, "");

  if (typed === null && id === null) {
    return { ok: false, reason: "date_of_birth_required", field: "born" };
  }

  let warning;
  let fromId = null;
  if (id !== null) {
    const read = readSaId(id, today);
    // Unreadable means unreadable — the wrong length, a non-digit, or six
    // leading digits that are not a date anybody was born on. There is no
    // salvaging that, and storing it would put a number in the most dangerous
    // column in the schema that nothing can ever check again.
    if (!read.ok) {
      return { ok: false, reason: "id_number_unreadable", field: "id_number" };
    }
    // A failed check digit is NOT a refusal, and that is deliberate rather
    // than lax. readSaId() is explicit that such a number "is still a number a
    // person can act on and the caller is the one who decides": the first six
    // digits carry the birthday and do not depend on the checksum, and older
    // and naturalised numbers do fail it. So it is surfaced for the office to
    // look at twice, and the record is not held hostage to it.
    if (read.checkDigitValid === false) warning = "id_number_check_digit_failed";
    fromId = bornFromSaId(id, today);
  }

  if (typed !== null && !YYYY_MM_DD.test(typed)) {
    return { ok: false, reason: "born_must_be_yyyy_mm_dd", field: "born" };
  }

  // Both given: they must agree. Two different birthdays for one child is not
  // a field to pick between — it is a sign that one of them belongs to
  // somebody else, and the office is the only one who can say which.
  if (typed !== null && fromId !== null && typed !== fromId) {
    return { ok: false, reason: "id_number_disagrees_with_date_of_birth", field: "id_number" };
  }

  const resolved = typed ?? fromId;
  const at = Date.parse(`${resolved}T00:00:00Z`);
  if (Number.isNaN(at)) {
    return { ok: false, reason: "born_must_be_yyyy_mm_dd", field: "born" };
  }
  const years = (today.getTime() - at) / (365.2425 * 86400000);
  if (!(years >= plausible.min && years <= plausible.max)) {
    return { ok: false, reason: notPlausible, field: typed ? "born" : "id_number" };
  }

  return {
    ok: true,
    // Not null: both-absent returned above, and a null here would have parsed
    // to NaN and been refused as not YYYY-MM-DD.
    born: /** @type {string} */ (resolved),
    idNumber: id,
    source: typed !== null ? "typed" : "id_number",
    ...(warning ? { warning } : {}),
  };
}

/** The office's words for each refusal, so three screens do not invent three. */
/** @type {Readonly<Record<string, string>>} */
export const BIRTH_DATE_MESSAGE = Object.freeze({
  date_of_birth_required:
    "A date of birth is required — type one, or give the ID number and we will read it from that.",
  born_must_be_yyyy_mm_dd: "A date of birth must be written as 2011-04-07.",
  born_not_plausible_for_a_school_pupil:
    `That date makes this person under ${PLAUSIBLE_YEARS.min} or over ${PLAUSIBLE_YEARS.max}. Check the year.`,
  born_not_plausible_for_an_official:
    `That date makes this official under ${PLAUSIBLE_YEARS_OFFICIAL.min} or over ${PLAUSIBLE_YEARS_OFFICIAL.max}. Check the year.`,
  id_number_unreadable: "That ID number is not thirteen digits starting with a date of birth.",
  id_number_disagrees_with_date_of_birth:
    "The ID number carries a different date of birth to the one typed. One of them belongs to somebody else.",
  id_number_check_digit_failed:
    "Saved, but that ID number fails its own check digit — worth reading back against the document.",
});

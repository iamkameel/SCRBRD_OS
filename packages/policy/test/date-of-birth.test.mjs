/**
 * The rule that a pupil's date of birth is known, proved once so three write
 * paths cannot each believe something slightly different.
 *
 * The cases that matter are the disagreements and the refusals: a form that
 * accepts anything is the state this replaces, and a rule that only ever says
 * yes is indistinguishable from no rule.
 */
import { resolveBirthDate, BIRTH_DATE_MESSAGE, PLAUSIBLE_YEARS, PLAUSIBLE_YEARS_OFFICIAL } from "../src/date-of-birth.mjs";

let pass = 0, fail = 0;
// The third argument is accepted and NOT printed — one call below passes a
// detail this helper has always dropped. Left as found; see the typecheck notes.
/** @param {string} n @param {unknown} c @param {string} [_detail] */
const ok = (n, c, _detail) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

// Fixed, so the plausibility window does not drift the suite with the calendar
// the way the seed's birthdates once did.
const TODAY = new Date("2026-09-15T00:00:00Z");
const r = (/** @type {Parameters<typeof resolveBirthDate>[0]} */ i) => resolveBirthDate(i, TODAY);

// Checksum-valid, generated rather than invented: 2011-04-07.
const VALID_ID = "1104075800085";

group("One of the two is required, and neither is guessed");
{
  ok("nothing at all is refused", r({}).ok === false && r({}).reason === "date_of_birth_required");
  ok("...and the refusal names the field a form should highlight", r({}).field === "born");
  ok("empty strings are nothing, not values",
     r({ born: "", idNumber: "" }).reason === "date_of_birth_required");
  ok("a typed date alone is enough", r({ born: "2011-04-07" }).ok === true);
  ok("an ID number alone is enough", r({ idNumber: VALID_ID }).ok === true);
}

group("The ID number carries the birthday, so it is read rather than re-asked");
{
  const out = r({ idNumber: VALID_ID });
  ok("the date comes out of the first six digits", out.born === "2011-04-07");
  ok("...and says so, so the office is not shown a date nobody typed",
     out.source === "id_number");
  ok("a typed date is used as typed", r({ born: "2011-04-07" }).source === "typed");
  ok("the number is kept, whitespace and all removed",
     r({ idNumber: " 1104 0758 00085 " }).idNumber === VALID_ID);
}

group("Two birthdays for one child is not a field to pick between");
{
  const clash = r({ born: "2012-01-01", idNumber: VALID_ID });
  ok("disagreement is refused", clash.ok === false
     && clash.reason === "id_number_disagrees_with_date_of_birth");
  ok("...pointing at the ID number, which is the one that can be checked against a document",
     clash.field === "id_number");
  ok("agreement passes", r({ born: "2011-04-07", idNumber: VALID_ID }).ok === true);
}

group("A number that cannot be read is refused rather than stored");
{
  ok("too short", r({ idNumber: "123" }).reason === "id_number_unreadable");
  ok("not digits", r({ idNumber: "abcdefghijklm" }).reason === "id_number_unreadable");
  ok("six leading digits that are not a date",
     r({ idNumber: "9913325800081" }).reason === "id_number_unreadable");
  // 31 February reads as a date to a careless parser and is not one.
  ok("a date nobody was born on", r({ idNumber: "1102315800087" }).reason === "id_number_unreadable");
}

group("A failed check digit is a warning, not a refusal");
{
  // Deliberate: readSaId() says such a number "is still a number a person can
  // act on", the birthday does not depend on the checksum, and older and
  // naturalised numbers do fail it. Refusing would lock out real children.
  const bad = r({ idNumber: "1104075800089" });
  ok("it is accepted", bad.ok === true);
  ok("...with the birthday still read", bad.born === "2011-04-07");
  ok("...and the office told to look twice", bad.warning === "id_number_check_digit_failed");
  ok("a good number carries no warning", r({ idNumber: VALID_ID }).warning === undefined);
}

group("A fat-fingered year is caught");
{
  ok("the year 1901", r({ born: "1901-01-01" }).reason === "born_not_plausible_for_a_school_pupil");
  ok("a date in the future", r({ born: "2101-01-01" }).reason === "born_not_plausible_for_a_school_pupil");
  ok("a newborn", r({ born: "2026-06-01" }).reason === "born_not_plausible_for_a_school_pupil");
  ok("...and the window is the one the module publishes",
     PLAUSIBLE_YEARS.min === 3 && PLAUSIBLE_YEARS.max === 25);
  // A twelve-year-old is the point of the exercise and must not be caught by it.
  ok("a twelve-year-old is fine", r({ born: "2014-03-02" }).ok === true);
  ok("a school-leaver is fine", r({ born: "2008-03-02" }).ok === true);
}

group("The date must be written the one way the database reads");
{
  ok("day-first is refused", r({ born: "07/04/2011" }).reason === "born_must_be_yyyy_mm_dd");
  ok("...as is a month name", r({ born: "7 April 2011" }).reason === "born_must_be_yyyy_mm_dd");
}

group("Every refusal has words the office can read");
{
  /** @type {Set<string>} */
  const reasons = new Set();
  for (const input of [{}, { born: "07/04/2011" }, { born: "1901-01-01" },
                       { idNumber: "123" }, { born: "2012-01-01", idNumber: VALID_ID }]) {
    const out = r(input);
    if (out.ok === false) reasons.add(out.reason);
  }
  reasons.add("id_number_check_digit_failed");
  const missing = [...reasons].filter((x) => !BIRTH_DATE_MESSAGE[x]);
  ok(`all ${reasons.size} outcomes are spelled out`, missing.length === 0, missing.join(", "));
}

console.log("\n" + "─".repeat(52));
// An official is an adult: the same check, a wider window, its own reason.
{
  const adult = resolveBirthDate({ born: "1979-03-02" }, new Date("2026-09-16"), { plausible: PLAUSIBLE_YEARS_OFFICIAL, notPlausible: "born_not_plausible_for_an_official" });
  ok("a 47-year-old is a plausible official", adult.ok === true);
  ok("...and not a plausible pupil", resolveBirthDate({ born: "1979-03-02" }, new Date("2026-09-16")).ok === false);
  const child = resolveBirthDate({ born: "2014-03-02" }, new Date("2026-09-16"), { plausible: PLAUSIBLE_YEARS_OFFICIAL, notPlausible: "born_not_plausible_for_an_official" });
  ok("a twelve-year-old is refused as an official, with the official's reason", child.ok === false && child.reason === "born_not_plausible_for_an_official");
}

console.log(`DATE OF BIRTH: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

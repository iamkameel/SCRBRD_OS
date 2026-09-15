/**
 * The South African ID number, and the date of birth inside it.
 *
 * This module is load-bearing in a way that is easy to underrate: the age it
 * extracts decides which side a boy may be picked for, the day a guardian's
 * access ends, and whether a bowler falls under the fast-bowling directive. A
 * quietly wrong century here is a fourteen-year-old in a U13 side and a
 * parent still reading a grown adult's medical records.
 *
 * So the check digits below are computed from the algorithm and then asserted
 * against numbers whose correctness is established independently — by
 * construction, and by the round trip — rather than by trusting the same
 * function twice.
 */
import { luhnCheckDigit, resolveCentury, readSaId, bornFromSaId, bornAgreesWithSaId }
  from "@scrbrd/policy/sa-id";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

// A fixed "today", so every boundary below is reachable on any day of the
// year rather than only when the calendar happens to cooperate.
const TODAY = new Date(Date.UTC(2026, 8, 15));

// ══════════════════════════════════════════════════════════════════
group("The check digit is Luhn, and it is computed not guessed");

// Built by construction: take a body, compute its digit, and the whole
// thirteen must then verify. If luhnCheckDigit were wrong in a consistent
// direction this still passes — which is why the known-good cases follow.
const body = "790412501208";
const d = luhnCheckDigit(body);
ok("a check digit is a single digit", Number.isInteger(d) && d >= 0 && d <= 9);
ok("...and the number it completes verifies", readSaId(body + d, TODAY).checkDigitValid === true);

// Known-good: these are the seeded officials' numbers, whose digits were
// computed independently of this module when the seed was written.
for (const id of ["7904125012084", "8206035183081", "6811275244089", "9102195305086", "7508305461084"]) {
  ok(`${id} verifies`, readSaId(id, TODAY).checkDigitValid === true);
}

// The failure this exists to catch: a transposed pair, which is the commonest
// way a number is mistyped off a form.
const transposed = "7904125012048";           // last two of the valid number swapped
ok("a transposed pair fails the check digit", readSaId(transposed, TODAY).checkDigitValid === false);
ok("...but the number is still READABLE, and says so",
   readSaId(transposed, TODAY).ok === true,
   "a bad check digit must not make the number unreadable — the schema refuses to block a registration over one");

// ══════════════════════════════════════════════════════════════════
group("The century is resolved by who could actually be alive");

ok("a schoolboy's 09 is 2009, not 1909",
   resolveCentury(9, 3, 14, TODAY)?.getUTCFullYear() === 2009);
ok("an adult official's 68 is 1968",
   resolveCentury(68, 11, 27, TODAY)?.getUTCFullYear() === 1968);
// The hinge: a two-digit year that has not happened yet in this century must
// fall back to the last one rather than producing an unborn person.
ok("a year still in the future this century falls back a hundred years",
   resolveCentury(99, 1, 1, TODAY)?.getUTCFullYear() === 1999);
ok("...and one that has just happened does not",
   resolveCentury(26, 1, 1, TODAY)?.getUTCFullYear() === 2026);

// Dates that do not exist. JavaScript's Date rolls these forward silently —
// 31 February becomes 3 March — so a validator that does not check the round
// trip accepts them and invents a birthday.
ok("31 February is not a date of birth", resolveCentury(8, 2, 31, TODAY) === null);
ok("31 April is not either", resolveCentury(8, 4, 31, TODAY) === null);
ok("month 13 is not either", resolveCentury(8, 13, 1, TODAY) === null);
ok("29 February in a leap year IS", resolveCentury(8, 2, 29, TODAY)?.getUTCDate() === 29);
ok("...and in a non-leap year is not", resolveCentury(9, 2, 29, TODAY) === null);

// ══════════════════════════════════════════════════════════════════
group("Reading a number, and refusing one that cannot be read");

const r = readSaId("7904125012084", TODAY);
ok("the date of birth comes out of the number", bornFromSaId("7904125012084", TODAY) === "1979-04-12");
ok("...as does the sex the sequence encodes", r.sex === "male");
ok("...and citizenship", r.citizen === true);
ok("a sequence below 5000 reads female", readSaId("7904124012089", TODAY).sex === "female");

ok("twelve digits is refused", readSaId("790412501208", TODAY).ok === false);
ok("fourteen is refused", readSaId("79041250120840", TODAY).ok === false);
ok("letters are refused", readSaId("79041250120AB", TODAY).ok === false);
ok("an empty value is refused", readSaId("", TODAY).ok === false);
ok("null is refused rather than thrown at", readSaId(null, TODAY).ok === false);
ok("a six-digit prefix that is not a date is refused",
   readSaId("9913995012081", TODAY).ok === false);
ok("...and the refusal says which half was wrong",
   /date of birth/.test(readSaId("9913995012081", TODAY).reason ?? ""));

// ══════════════════════════════════════════════════════════════════
//
// The comparison the write paths actually make. A date of birth and an ID
// number are two statements of the same fact, so a school supplying both has
// handed over something checkable — and a disagreement is a question for a
// person, not something to resolve by preferring one silently.
group("A typed date of birth is checked against the number");

const agree = bornAgreesWithSaId("1979-04-12", "7904125012084", TODAY);
ok("agreement is reported as checked", agree.checked === true && agree.agree === true);

const disagree = bornAgreesWithSaId("1979-04-21", "7904125012084", TODAY);
ok("a disagreement is caught", disagree.checked === true && disagree.agree === false);
ok("...and names both sides, so somebody can tell which is wrong",
   disagree.typed === "1979-04-21" && disagree.fromId === "1979-04-12");

// A day out is the realistic error — a transposed day, or a form filled in
// from memory — and it must not slip through.
ok("one day out is still a disagreement",
   bornAgreesWithSaId("1979-04-13", "7904125012084", TODAY).agree === false);

// Absence is not disagreement. Whether the fields are REQUIRED is a separate
// decision made by the caller; this function only compares what it is given.
ok("no id number is nothing to check, not a failure",
   bornAgreesWithSaId("1979-04-12", null, TODAY).checked === false);
ok("no date of birth is nothing to check either",
   bornAgreesWithSaId(null, "7904125012084", TODAY).checked === false);
ok("an unreadable number is nothing to check, and flags itself",
   bornAgreesWithSaId("1979-04-12", "not-an-id", TODAY).unreadable === true);

// A full timestamp is what a database column hands back; it must compare the
// same as the date string a form supplies.
ok("a timestamp compares by its date half",
   bornAgreesWithSaId("1979-04-12T00:00:00.000Z", "7904125012084", TODAY).agree === true);

console.log(`\n${"─".repeat(52)}\nSA ID: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

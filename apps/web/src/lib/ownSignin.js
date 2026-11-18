/**
 * "Allow his own sign-in" (SCRBRD-140 honesty model, Migration B; db/164):
 * the words the family and the office read about a boy's own sign-in, and
 * the words for each refusal of its doors.
 *
 * A boy under 18 reads his own page only while a yes is in force: a
 * guardian's "Allow his own sign-in", or the office's record that the
 * school's signed form is on file (Kameel, 18 Nov, Q5). One yes opens it;
 * only the person who gave it, or the office, closes it (Q6). From eighteen
 * it is his.
 *
 * Pure: no fetch, no DOM. The screen is views/family/childfile.jsx's
 * OwnSignIn; the API is services/api/write/pupil-signin-api.mjs.
 */

/**
 * One sentence of where his own sign-in stands, for his family.
 * @param {{ inForce: boolean, adult: boolean, bornKnown: boolean, yesHow: string | null, yesBy: string | null,
 *           yesAt: string | null, yours: boolean, canAllow: boolean, canStop: boolean } | null} s
 * @param {string} name   how the family calls him
 * @param {string} place  "school" (the words' w.place)
 */
export function ownSigninWords(s, name, place = "school") {
  if (!s) return "";
  if (s.adult) return `${name} is 18. His own sign-in is his.`;
  if (!s.bornKnown) return `The ${place} has no date of birth for ${name}, so his own sign-in stays closed. Ask the ${place} office to record it.`;
  if (!s.inForce) return `${name} cannot sign in to his own page. Until someone says yes he sees only what the public sees.`;
  const when = s.yesAt ? ` on ${dayOf(s.yesAt)}` : "";
  if (s.yours) return `You allowed ${name}'s own sign-in${when}. You can stop it at any time.`;
  if (s.yesHow === "guardian") return `${name}'s other guardian allowed his own sign-in${when}. Only they, or the ${place} office, can stop it.`;
  return `The ${place} office has ${name}'s signed consent form on file${when}, so his own sign-in is allowed. Ask the office to stop it.`;
}

/** A day as the family reads it: 18 November 2026. @param {string} iso */
function dayOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });
}

/** Each refusal of the family's tap, in words. */
export const OWN_SIGNIN_REFUSALS = Object.freeze({
  not_permitted: "Only his verified parent or guardian can answer this.",
  player_is_an_adult: "He is 18: his own sign-in is his.",
  terms_not_agreed: "Agree to the school's terms first, then you can allow his own sign-in.",
  no_date_of_birth: "The school has no date of birth for him yet. Ask the school office to record it.",
  not_yours_to_stop: "This yes was not yours. Ask the school office.",
  fallback: "That did not go through. Try again.",
});

/** The office's tick on a grant (Q12), and its refusals. */
export const FORM_ON_FILE = Object.freeze({
  label: "The signed consent form is on file",
  hint: "For a pupil under 18. Without it his account is opened but his own page waits for a parent's or guardian's yes.",
  form_no_date_of_birth: "This pupil has no date of birth on the school's list. Record it first, then tick the form.",
  form_not_permitted: "Only the school office and the principal can record the signed form.",
});

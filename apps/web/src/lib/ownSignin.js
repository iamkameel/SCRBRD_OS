/**
 * "Allow his own sign-in" (SCRBRD-140 honesty model, Migration B; db/169):
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
 * One sentence of where his own sign-in stands, for his family. Each says
 * only what was attested (the red-team's S3): her own tap; the other
 * guardian's tap; a form the office recorded as on file, signed on a day
 * (never by whom: that is the office's to read); or the stamp the school
 * carried over when it enrolled him, which attests no form at all and is
 * hers to stop (Kameel, 20 Nov, B).
 * @param {{ agreed?: boolean, inForce: boolean, adult: boolean, bornKnown: boolean, yesHow: string | null, yesBy: string | null,
 *           yesAt: string | null, formSignedOn?: string | null, yours: boolean, canAllow: boolean, canStop: boolean,
 *           held?: boolean } | null} s
 * @param {string} name   how the family calls him
 * @param {string} place  "school" (the words' w.place)
 */
export function ownSigninWords(s, name, place = "school") {
  if (!s) return "";
  // N11: until she has agreed to the terms she is told only that.
  if (s.agreed === false) return `Agree to the ${place}'s terms first. Then you can see, and answer, whether ${name} may sign in to his own page.`;
  if (s.adult) return `${name} is 18. His own sign-in is his.`;
  if (!s.bornKnown) return `The ${place} has no date of birth for ${name}, so his own sign-in stays closed. Ask the ${place} office to record it.`;
  if (!s.inForce) return `${name} cannot sign in to his own page. Until someone says yes he sees only what the public sees.`;
  const when = s.yesAt ? ` on ${dayOf(s.yesAt)}` : "";
  if (s.yours) return `You allowed ${name}'s own sign-in${when}. You can stop it at any time.`;
  if (s.yesHow === "guardian") return `${name}'s other guardian allowed his own sign-in${when}. Only they, or the ${place} office, can stop it.`;
  if (s.yesHow === "enrolled") {
    return `The ${place} office opened ${name}'s own sign-in when it enrolled him${when}. No signed consent form was recorded with it.`
      + (s.canStop ? " You can stop it at any time." : ` Ask the ${place} office to stop it.`);
  }
  const signed = s.formSignedOn ? `, signed on ${dayOf(s.formSignedOn)},` : "";
  return `The ${place} office recorded that it has a consent form for ${name}${signed} on file, so his own sign-in is allowed. Ask the office to stop it.`;
}

/**
 * S5: a yes is in force, but his account (recognised by the office) could
 * not be opened by it yet. Why, in words; NULL when nothing waits.
 * @param {string | null | undefined} held   the door's answer (team_required, …), or true from the state read
 * @param {string} name
 */
export function heldWords(held, name) {
  if (!held) return null;
  if (held === "team_required") return `The yes is recorded, but ${name}'s account could not be opened yet: the school has no side for him on its list. Ask the school office to put him in a side, then try again.`;
  if (held === "player_has_an_account") return `The yes is recorded, but another account is already ${name}'s. Ask the school office.`;
  return `The yes is recorded, but ${name}'s account has not been opened yet. Try again, or ask the school office.`;
}

/** A day as the family reads it: 18 November 2026. @param {string} iso (a time, or a YYYY-MM-DD day) */
function dayOf(iso) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
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

/** The office's tick on a grant (Q12), with who signed the form and when (D), and its refusals. */
export const FORM_ON_FILE = Object.freeze({
  label: "The signed consent form is on file",
  hint: "For a pupil under 18. Without it his account is opened but his own page waits for a parent's or guardian's yes.",
  signedBy: "Signed by (the parent or guardian, as on the form; optional)",
  signedOn: "Date the form was signed (optional)",
  form_no_date_of_birth: "This pupil has no date of birth on the school's list. Record it first, then tick the form.",
  form_not_permitted: "Only the school office and the principal can record the signed form.",
  form_form_signer_invalid: "Who signed the form needs two letters or more, as written on it, or leave it blank.",
  form_form_date_invalid: "The date the form was signed cannot be after today, or before he was born.",
});

/**
 * What the form's two fields need before it is sent (D: both optional until
 * counsel has read them; TODO(counsel): required then): who signed it, when
 * given, two letters or more; the day, when given, a date.
 * @param {{ signedBy?: string, signedOn?: string }} f
 */
export function formReady(f) {
  const by = String(f?.signedBy ?? "").trim(), on = String(f?.signedOn ?? "");
  return (by === "" || by.length >= 2) && (on === "" || /^\d{4}-\d{2}-\d{2}$/.test(on));
}

/**
 * The office's own row for a boy (S4, E): where his own sign-in stands, in
 * the office's words, and what its withdrawal does and does not do.
 * @param {{ inForce: boolean, adult: boolean, bornKnown: boolean, yesHow: string | null, yesBy: string | null, yesAt: string | null,
 *           formSignedBy?: string | null, formSignedOn?: string | null, held?: boolean } | null} s
 * @param {string} name
 */
export function officeSigninWords(s, name) {
  if (!s) return "";
  if (s.adult) return `${name} is 18: his own sign-in is his, and needs no form.`;
  if (!s.bornKnown) return `No date of birth is on record for ${name}, so his own sign-in stays closed whatever is on file. Record it first.`;
  if (!s.inForce) return `${name}'s own sign-in is closed: no yes is in force.`;
  const when = s.yesAt ? ` on ${dayOf(s.yesAt)}` : "";
  if (s.yesHow === "guardian") return `${s.yesBy ?? "A guardian"} allowed ${name}'s own sign-in${when}.`;
  if (s.yesHow === "enrolled") return `${name}'s own sign-in was opened when he was enrolled${when}, before forms were recorded. No form is recorded for it.`;
  const by = s.formSignedBy ? ` signed by ${s.formSignedBy}` : "";
  const on = s.formSignedOn ? ` on ${dayOf(s.formSignedOn)}` : "";
  const unsaid = !s.formSignedBy && !s.formSignedOn ? " Who signed it, and when, were not recorded." : "";
  return `A consent form${by}${on} is on file, recorded by ${s.yesBy ?? "the school office"}${when}.${unsaid}`;
}

/** E (Kameel, 20 Nov): what a withdrawal does, and what it does not, said before the tap. */
export const OFFICE_WITHDRAW = Object.freeze({
  button: "Record a withdrawal",
  says: "Recording a withdrawal closes his own sign-in now, whoever said yes before. It does not hold against a yes given afterwards: any of his verified parents or guardians who has agreed to the school's terms may allow it again. To keep him out whatever is said later, end his roles or disable his account.",
  // D1 (Kameel, 25 Nov): the case the line above covers in general, said once more where it is easiest to miss: one
  // parent withdraws, and the other, still linked, says yes that evening.
  otherParent: "Also end the other parent's link, or their yes reopens it.",
  done: "Withdrawal recorded. His own sign-in is closed.",
  retry: "Open his account now",
});

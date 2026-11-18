/**
 * SCRBRD — "I am a pupil here" (SCRBRD-140, the honesty model, Migration A;
 * db/163). The pure half of the pupil's claim form, his basic view and the
 * office's Pupil claims list: what each state is called, what each refusal
 * says, and what is sent. No React and no network, so apps/web/test holds
 * every sentence to the design.
 *
 * THE RULE THE WORDS KEEP (design §0): what a person says about himself can
 * only narrow what he sees. So nothing here promises a page, a team or a
 * figure: a claim asks for nothing and opens nothing (Q3). Each sentence
 * says exactly what the school has checked, and nothing else:
 *
 *   with the office   "Sent to the school. Somebody there will answer."
 *                     (§2.4's sentence for everyone the school has not
 *                     matched, whatever the reason)
 *   recognised        "Your school knows this is you. A parent or guardian
 *                     needs to say yes before your own page opens."
 *   declined          the school has answered; never why
 *
 * HOW A YES COMES, TODAY. Until the honesty model's Migration B, a parent's
 * yes is the school's signed consent form, which the office records when it
 * enrols his account. So the "how" line names the form and the office, and
 * not yet "look under Family", which has nothing to tap until B ships.
 *
 * Q9: the account is kept 30 days from his last claim (or from the school's
 * answer, if later) while the office decides, then removed with the schools
 * he follows; his screen says so from the first day (keepWords()). Nobody
 * asks a parent in Migration A: the words say the office decides, on the
 * signed form, and change with Migration B. An account that raised a
 * safeguarding concern is kept (db/163 B1): no date, and his own Remove
 * answers as any account that is not a claim does, in words that tell
 * whoever holds his phone nothing (re-review S3(a)).
 */

export const NAME_MAX = 80;
export const YEAR_MAX = 20;

const clean = (/** @type {unknown} */ v) => String(v ?? "").replace(/\s+/g, " ").trim();

/** The join form's pupil kind, under "I am under 18": what is asked, and why. */
export const CLAIM_FORM = Object.freeze({
  title: "Tell your school who you are",
  intro: "Type your name as the school would have it. The school office checks it against the school's own list. Nothing about you is opened by this: not your team, not your matches, not your record.",
  keep: "Sending this tells SCRBRD that this account belongs to a pupil under 18. It then asks for nothing else. It is kept for 30 days while the school office decides: your own page opens only once the office has a parent's or guardian's signed consent form. If it has not opened by then, the account is removed, with the schools you follow.",
  under13: "If you are under 13, Google will not give you an account: ask your school office for a sign-in code instead.",
});

/**
 * What his claim sends, or why not yet. The name and the year are what he
 * typed, tidied; no date of birth is asked for (nothing compares it until
 * the family list exists, design §2.3, and a child is asked only what is used).
 * @param {string | null} schoolId
 * @param {{ name?: string, year?: string }} f
 * @returns {{ ok: true, body: { schoolId: string, name: string, year: string | null } } | { ok: false, problem: string }}
 */
export function buildClaim(schoolId, f = {}) {
  if (!schoolId) return { ok: false, problem: "Choose your school first." };
  const name = clean(f.name);
  if (name.length < 2 || !/\p{L}.*\p{L}/u.test(name)) return { ok: false, problem: CLAIM_WORDS.name_required };
  if (name.length > NAME_MAX) return { ok: false, problem: "Keep your name to 80 letters or fewer." };
  const year = clean(f.year);
  if (year.length > YEAR_MAX) return { ok: false, problem: CLAIM_WORDS.year_too_long };
  return { ok: true, body: { schoolId, name, year: year || null } };
}

/** Each refusal of POST /api/pupil/claim, in the screen's words. None says anything about the school's list. */
export const CLAIM_WORDS = Object.freeze({
  name_required: "Type your name, as the school would have it.",
  year_too_long: "Keep your year or team to 20 letters or fewer.",
  no_such_school: "That school could not be chosen. Choose it again from the list.",
  request_cooldown: "This account can't send anything to a school yet. Ask the school office.",
  ask_your_school_office: "This account cannot send a pupil's claim. Ask your school office.",
  already_recognised: "Your school already knows this is you.",
  already_answered: "The school has already answered. Ask the school office.",
  not_signed_in: "You were signed out. Sign in again to send it.",
  missing_token: "You were signed out. Sign in again to send it.",
  token_expired: "You were signed out. Sign in again to send it.",
});
const CLAIM_FALLBACK = "That was not sent. Try again, or ask your school office.";
const UNREACHABLE = "Could not reach SCRBRD. Check your connection and try again; nothing was sent.";

/** @param {any} e */
export function claimWords(e) {
  if (e?.status === undefined || e?.status === null) return UNREACHABLE;
  return /** @type {Record<string, string>} */ (CLAIM_WORDS)[e?.code] ?? CLAIM_FALLBACK;
}

/** "2026-12-18" → "18 December 2026". Not a Date: the database's own day, as written. */
export function dayWords(/** @type {string | null | undefined} */ day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ""));
  if (!m) return "";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * His state in one true sentence, and how a yes comes (§3.3's left column).
 * @param {{ state: string, schoolName?: string } | null} claim
 * @returns {{ title: string, line: string, how: string | null }}
 */
export function stateWords(claim) {
  const at = claim?.schoolName || "your school";
  switch (claim?.state) {
    case "with_office":
      return { title: "Sent to the school", line: `Somebody at ${at} will answer.`, how: null };
    case "recognised":
      return { title: "Your school knows this is you.", line: "A parent or guardian needs to say yes before your own page opens.",
               how: `Ask a parent or guardian to give the office at ${at} the school's signed consent form, or ask the office.` };
    case "declined":
      return { title: "The school has answered", line: "Your own page will not open from this claim. If you think that is wrong, ask the school office.", how: null };
    case "open":
      return { title: "Your own page is open", line: "Sign out, then sign in again, to see it.", how: null };
    default:
      return { title: "", line: "", how: null };
  }
}

/**
 * Q9, from the first day: how long the account is kept, and what then.
 * @param {{ state: string, keepUntil: string | null } | null} claim
 */
export function keepWords(claim) {
  if (!claim?.keepUntil) return null;
  const until = dayWords(claim.keepUntil);
  if (claim.state === "declined") return `This account is kept until ${until}, 30 days from the school's answer. Then it is removed, with the schools you follow.`;
  return `This account is kept until ${until}, 30 days from your last claim, while the school office decides. Your own page opens only once the office has a parent's or guardian's signed consent form. If it has not opened by then, the account is removed, with the schools you follow.`;
}

/** "Remove this account" (his own way out, now): the question asked first, and the refusals. */
export const REMOVE_WORDS = Object.freeze({
  ask: "Remove this account now? Its sign-in and the schools you follow go with it. You can sign in with Google again later and start afresh.",
  done: "This account has been removed.",
  // Also what an account kept for a safeguarding concern reads (db/163 B1; the API answers it as this):
  // neutral, because whoever holds his phone may be the adult the concern is about (re-review S3(a)).
  not_a_claim: "This account can't be removed from here. Ask a teacher you trust.",
  fallback: "The account was not removed. Try again.",
});

// ── The office's Pupil claims list ────────────────────────────────────

/** A claim's state, in the office's words. */
export const OFFICE_STATE_WORDS = Object.freeze({
  with_office: "Waiting for you",
  recognised: "Recognised: waiting for a parent's or guardian's yes",
  declined: "Declined",
  open: "Opened",
});

/** What the office is told before it decides. */
export const OFFICE_INTRO = "A pupil under 18 signed in with Google and said he is at this school. Recognising him matches his account to his place on your list: it opens nothing, not his team, his matches or his record. His own page opens when a parent's or guardian's signed consent form is on file and you enrol his account. If you do not know him, decline: the school's safeguarding officers are told that a claim was declined, without his name. An account is kept 30 days from its last claim, or from your answer; one shown with no date is kept until further notice.";

/** Each refusal of recognise and decline, in the office's words. */
export const OFFICE_WORDS = Object.freeze({
  not_permitted: "Only the school office and the principal answer pupil claims.",
  already_answered: "Somebody has already answered this claim. The list has been read again.",
  player_not_at_that_school: "That pupil is not on this school's list.",
  player_has_an_account: "That pupil already has an account, or another claim is recognised as him. Nothing here joins two accounts: if he is signing in with Google, his own account's request is on the Google sign-ins list.",
  player_is_an_adult: "By the school's list that pupil is 18 or older, so he needs no parent's yes. Enrol his account from People with the address shown here.",
  player_required: "Choose his place on the school's list first.",
});
const OFFICE_FALLBACK = "That did not go through. Try again.";

/** @param {any} e */
export function officeWords(e) {
  if (e?.status === undefined || e?.status === null) return "Could not reach SCRBRD. Check your connection and try again.";
  return /** @type {Record<string, string>} */ (OFFICE_WORDS)[e?.code] ?? OFFICE_FALLBACK;
}

/** "N accounts are past their 30 days": the clear button's words. @param {number} n */
export function clearWords(n) {
  return n === 1 ? "Remove 1 account past its 30 days" : `Remove ${n} accounts past their 30 days`;
}

/**
 * The roster rows a claim may be matched to: this school's, searched by the
 * typed letters, in name order. The office reads its own roster; nothing is
 * shown to the pupil.
 * @param {{ id: string, name: string, school?: string, team?: string }[]} players
 * @param {string} school
 * @param {string} q
 */
export function rosterMatches(players, school, q) {
  const t = clean(q).toLowerCase();
  return (players ?? [])
    .filter((p) => p.school === school && (!t || String(p.name ?? "").toLowerCase().includes(t)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, 50);
}

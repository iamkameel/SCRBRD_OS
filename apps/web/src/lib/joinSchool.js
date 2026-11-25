/**
 * SCRBRD — joining a school from an account that has none (SCRBRD-140 §5).
 *
 * A person who has just signed in with Google is nobody in particular: no
 * assignment, nothing to see. They pick a school and say who they are, and that
 * becomes ONE ordinary role request (POST /api/requests) that somebody at the
 * school answers. This file is the pure half of that screen: which kinds of
 * person there are, what each one's request is, and what is said back.
 *
 * THREE RULES, each held by apps/web/test/signin.test.mjs:
 *
 *   1. NOBODY ASSIGNS THEMSELVES ANYTHING. Every kind ends in a request, never
 *      a role, or in something that opens nothing: "I just want to follow
 *      matches" follows the school at once (Q10, db/168; a follow grants no
 *      read), and a pupil under 18 says who he is (rule 3). Nothing here is
 *      automatic: not for a parent, not for a pupil, and not for staff either.
 *      A member of staff whose office listed them in the staff register is
 *      granted by the SERVER (POST /api/join/register-claim, db/92), on the
 *      address Google verified; this form only asks.
 *   2. A PARENT'S CLAIM ON A CHILD NEVER LOOKS A CHILD UP (§5.3). The child is
 *      free text — a name as the family writes it, a relationship, a year —
 *      travelling in the request's note for the office to match by hand. No
 *      list of pupils is fetched, there is no autocomplete, and the answer is
 *      the same sentence whoever the child is. The screen never says "found",
 *      "not found", "no such pupil" or anything shaped like them: a form that
 *      did would be an oracle for which children attend a school.
 *      THE FAMILY LIST (db/174, Kameel 18 Nov 2026, Q1 and Q2): one optional
 *      field, his date of birth. It travels beside the request as `born`,
 *      never in the note, and the server compares it with the school's own
 *      list for the address Google verified and drops it. Where the school
 *      listed her for that child and switched the list on, she is linked at
 *      once and reads the terms next ("You're linked"); anything else, for
 *      whatever reason, reads the one sentence a request always reads.
 *   3. A PUPIL UNDER EIGHTEEN ASKS FOR NO ROLE (SCRBRD-140 honesty model, Q3,
 *      Kameel 18 Nov 2026). He may say "I am a pupil here": a pupil's claim
 *      (POST /api/pupil/claim, db/168, lib/pupilClaim.js), which asks for
 *      nothing and opens nothing. It puts his account in the basic view and
 *      a row in front of the office, and from then on the account asks for
 *      nothing at all. Opening his own page is still the school's and a
 *      parent's decision. The eighteen-year-old still at school may ask for
 *      `player` himself, and the office names his roster row. (Under 13,
 *      Google will not give him an account at all: he signs in with a code.)
 */
import { SELF_REGISTRABLE_STAFF_ROLES } from "@scrbrd/policy/roles";

/**
 * Roles a member of staff may ask for here, from the policy's self-registrable
 * list, the join screen's contract (the retired /api/onboard was held to it too). The server also checks
 * each one (role_request_grantable).
 */
export const STAFF_ROLES = SELF_REGISTRABLE_STAFF_ROLES;

/** The four kinds of person, in the order the screen offers them. */
export const KINDS = Object.freeze([
  { id: "staff",    label: "I work at the school",         hint: "A coach, scorer, manager, physio or the office." },
  { id: "parent",   label: "I am a parent or guardian",    hint: "To follow your child's matches and answers." },
  { id: "pupil",    label: "I am a pupil",                 hint: "Tell your school who you are." },
  { id: "follower", label: "I just want to follow matches", hint: "Its public scores, fixtures and results. Nothing is asked of the school." },
]);

export const RELATIONSHIPS = Object.freeze(["Mother", "Father", "Guardian", "Other"]);

export const NOTE_MAX = 300;

/**
 * A date of birth as typed in a date field: YYYY-MM-DD and a real day, or
 * null. Only ever sent as `born`; never put in a note.
 * @param {unknown} v
 */
export function bornField(v) {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s ? s : null;
}

/** The optional field (Q2), in the words Kameel decided. */
export const BORN_FIELD = Object.freeze({
  parent: "His date of birth (lets the school's list confirm you at once)",
  pupil: "Your date of birth (lets the school's list confirm you at once)",
  hint: "Optional. It is checked against the school's own list and not kept.",
});
export const CHILD_MAX = 80;
export const YEAR_MAX = 20;
export const EXTRA_MAX = 160;

const clean = (/** @type {unknown} */ v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * A parent's description of the child, for the office to match by hand.
 * Exactly what she typed, in a fixed order; not a key into anything.
 * @param {{ child?: string, relationship?: string, year?: string }} f
 */
export function parentNote({ child, relationship, year }) {
  const parts = [`Child: ${clean(child).slice(0, CHILD_MAX)}`, `Relationship: ${clean(relationship)}`];
  if (clean(year)) parts.push(`Year: ${clean(year).slice(0, YEAR_MAX)}`);
  return parts.join(" · ").slice(0, NOTE_MAX);
}

/**
 * The request a kind of person sends, or why not yet.
 * @param {string} kind
 * @param {string | null} schoolId
 * @param {Record<string, string>} f  the form: role, extra, child, relationship, year, adult
 * @returns {{ ok: true, body: { role: string, schoolId: string, note: string | null } } | { ok: false, problem: string }}
 */
export function buildRequest(kind, schoolId, f = {}) {
  if (!schoolId) return { ok: false, problem: "Choose your school first." };
  if (kind === "staff") {
    if (!STAFF_ROLES.includes(f.role)) return { ok: false, problem: "Choose what you do at the school." };
    return { ok: true, body: { role: f.role, schoolId, note: clean(f.extra).slice(0, EXTRA_MAX) || null } };
  }
  if (kind === "parent") {
    if (clean(f.child).length < 2) return { ok: false, problem: "Type your child's name, as the school would have it." };
    if (!RELATIONSHIPS.includes(f.relationship)) return { ok: false, problem: "Say how you are related to your child." };
    const born = bornField(f.born);
    return { ok: true, body: { role: "guardian", schoolId, note: parentNote(f), ...(born ? { born } : {}) } };
  }
  if (kind === "pupil") {
    // Only an adult still at school asks for a role; under 18 he sends a pupil's claim instead (rule 3).
    if (f.adult !== "yes") return { ok: false, problem: "A pupil under 18 asks for no role. Tell your school who you are instead, or ask the office for a sign-in code." };
    const born = bornField(f.born);
    return { ok: true, body: { role: "player", schoolId, note: clean(f.extra).slice(0, EXTRA_MAX) || null, ...(born ? { born } : {}) } };
  }
  // Q10: following is not a request. The spectator request ("Ask the school for
  // its signed-in view") is asked from a followed school's card (spectatorAsk()).
  if (kind === "follower") return { ok: false, problem: "Following a school asks nothing of it: press Follow." };
  return { ok: false, problem: "Say who you are first." };
}

/**
 * What a refusal from POST /api/requests is called, in the screen's words.
 * None says anything about a child or an account.
 */
export const JOIN_WORDS = {
  already_pending: "Your request is already with the school office. No need to send it again. The answer will show on this page.",
  // db/93: the account's own state, said as that and nothing more. It never
  // says why and never names anyone (design SCRBRD-140 phase 2 §4.2).
  request_cooldown: "This account can't send a request yet. The school's safeguarding lead can lift that. Ask the school office to put you in touch.",
  no_such_school: "That school could not be selected. Choose it again from the list.",
  school_required: "Choose your school first.",
  role_invalid: "Say who you are first.",
  not_requestable: "That cannot be asked for from here. Ask your school office.",
  not_permitted: "You cannot ask for that. Ask your school office.",
  platform_role_needs_no_school: "That role belongs to SCRBRD, not to a school, so it cannot be asked for here. Choose what you do at the school.",
  role_not_self_registrable: "That role is given by the school, not asked for when you sign up. Choose what you do at the school, or ask your school office.",
  missing_token: "You were signed out. Sign in again to ask.",
  token_expired: "You were signed out. Sign in again to ask.",
};
const JOIN_FALLBACK = "That request was not sent. Try again, or ask your school office.";
const JOIN_UNREACHABLE = "Could not reach SCRBRD. Check your connection and try again. Nothing was sent.";

/** @param {any} e */
export function joinWords(e) {
  if (e?.status === undefined || e?.status === null) return JOIN_UNREACHABLE;
  return JOIN_WORDS[e?.code] ?? JOIN_FALLBACK;
}

/**
 * What a failed withdraw is called. POST /api/requests/:id/withdraw answers
 * { withdrawn: 0 } when the request is no longer waiting (it was answered
 * first, or it is not yours): that is not a withdrawal, and is said as such.
 */
export const WITHDRAW_WORDS = {
  not_waiting: "That request is no longer waiting, so it could not be withdrawn. Your requests have been read again.",
  missing_token: "You were signed out. Sign in again to withdraw it.",
  token_expired: "You were signed out. Sign in again to withdraw it.",
  not_permitted: "You cannot withdraw that request.",
};
const WITHDRAW_FALLBACK = "That request was not withdrawn. Try again, or ask your school office.";
const WITHDRAW_UNREACHABLE = "Could not reach SCRBRD. Check your connection and try again; the request may still be waiting.";

/** @param {any} e */
export function withdrawWords(e) {
  if (e?.status === undefined || e?.status === null) return WITHDRAW_UNREACHABLE;
  return WITHDRAW_WORDS[e?.code] ?? WITHDRAW_FALLBACK;
}

/** True when the server's reply says a request was really withdrawn. @param {any} r */
export const withdrew = (r) => Number(r?.withdrawn) > 0;

/**
 * What is said after a request is sent. The same sentence whatever the
 * parent typed: it cannot tell her whether her child is on a list.
 * @param {string} kind  @param {string} schoolName
 */
export function sentWords(kind, schoolName) {
  const at = schoolName || "the school";
  if (kind === "parent") {
    return `Your request has gone to ${at}. Somebody there will answer. Nothing about any child is shown to you until the school has checked who you are.`;
  }
  if (kind === "pupil") {
    return `Your request has gone to ${at}. The office will match it to your place on the school's list and answer.`;
  }
  if (kind === "staff") return `Your request has gone to ${at}. Somebody there will answer it, and you will see the answer here.`;
  return `Your request has gone to ${at}. Somebody there will answer it, and you will see the answer here.`;
}

/**
 * What the family list's match says (db/174, design §2.4). `family` is the
 * server's: 'linked' (a parent, her link written, the terms next), 'in' (a
 * pupil of 18 given his own account); anything else is null, and the
 * screen says sentWords() as it always has.
 * @param {unknown} family
 */
export function familyWords(family) {
  if (family === "linked") return { title: "You're linked", text: "Read and agree to the school's terms. Nothing about your child is shown to you until you have." };
  if (family === "in") return { title: "You're in", text: "The school's list confirmed you." };
  return null;
}

/**
 * Q10: "Ask the school for its signed-in view", from a followed school's card:
 * the spectator request the join form's follower kind used to send. The
 * office decides, as before, and what a spectator reads is unchanged.
 * @param {string} schoolId
 */
export const spectatorAsk = (schoolId) => ({ role: "spectator", schoolId, note: null });

/**
 * What the words on a request in the list say, by its state.
 * @param {string} state
 */
export const REQUEST_STATE_WORDS = Object.freeze({
  pending: "waiting for an answer",
  granted: "the school said yes",
  declined: "the school said no",
  withdrawn: "withdrawn",
});

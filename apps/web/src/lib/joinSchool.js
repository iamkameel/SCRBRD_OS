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
 *      a role. Nothing here is automatic: not for staff (the register that
 *      would let an office pre-approve its staff is phase 2, with no route yet),
 *      not for a parent, not for a pupil.
 *   2. A PARENT'S CLAIM ON A CHILD NEVER LOOKS A CHILD UP (§5.3). The child is
 *      free text — a name as the family writes it, a relationship, a year —
 *      travelling in the request's note for the office to match by hand. No
 *      list of pupils is fetched, there is no autocomplete, and the answer is
 *      the same sentence whoever the child is. The screen never says "found",
 *      "not found", "no such pupil" or anything shaped like them: a form that
 *      did would be an oracle for which children attend a school.
 *   3. A PUPIL UNDER EIGHTEEN DOES NOT ASK FOR HIMSELF. His account is the
 *      school's and a parent's decision; the screen says whom to ask. The
 *      eighteen-year-old still at school may ask for `player` himself, and the
 *      office names his roster row. (Under 13, Google will not give him an
 *      account at all: he signs in with a code.)
 */

/** Roles a member of staff may ask for here. The server also checks each one (role_request_grantable). */
export const STAFF_ROLES = Object.freeze([
  "coach", "assistantcoach", "teammanager", "scorer", "medical", "facilities", "directorofsport", "schooladmin",
]);

/** The four kinds of person, in the order the screen offers them. */
export const KINDS = Object.freeze([
  { id: "staff",    label: "I work at the school",         hint: "A coach, scorer, manager, physio or the office." },
  { id: "parent",   label: "I am a parent or guardian",    hint: "To follow your child's matches and answers." },
  { id: "pupil",    label: "I am a pupil",                 hint: "Your school office sets up a pupil's account." },
  { id: "follower", label: "I just want to follow matches", hint: "Scores, fixtures and results." },
]);

export const RELATIONSHIPS = Object.freeze(["Mother", "Father", "Guardian", "Other"]);

export const NOTE_MAX = 300;
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
    return { ok: true, body: { role: "guardian", schoolId, note: parentNote(f) } };
  }
  if (kind === "pupil") {
    // Only an adult still at school asks for himself; anyone else is sent to the office.
    if (f.adult !== "yes") return { ok: false, problem: "A pupil under 18 is set up by the school office. Ask them for a sign-in code." };
    return { ok: true, body: { role: "player", schoolId, note: clean(f.extra).slice(0, EXTRA_MAX) || null } };
  }
  if (kind === "follower") return { ok: true, body: { role: "spectator", schoolId, note: null } };
  return { ok: false, problem: "Say who you are first." };
}

/**
 * What a refusal from POST /api/requests is called, in the screen's words.
 * None says anything about a child or an account.
 */
export const JOIN_WORDS = {
  already_pending: "You already have a request in for this. Somebody at the school will answer it.",
  no_such_school: "That school could not be selected. Choose it again from the list.",
  school_required: "Choose your school first.",
  role_invalid: "Say who you are first.",
  not_requestable: "That cannot be asked for from here. Ask your school office.",
  not_permitted: "You cannot ask for that. Ask your school office.",
  platform_role_needs_no_school: "That role belongs to SCRBRD, not to a school, so it cannot be asked for here. Choose what you do at the school.",
  missing_token: "You were signed out. Sign in again to ask.",
  token_expired: "You were signed out. Sign in again to ask.",
};
const JOIN_FALLBACK = "That request was not sent. Try again, or ask your school office.";
const JOIN_UNREACHABLE = "Could not reach SCRBRD. Check your connection and try again; nothing was sent.";

/** @param {any} e */
export function joinWords(e) {
  if (e?.status === undefined || e?.status === null) return JOIN_UNREACHABLE;
  return JOIN_WORDS[e?.code] ?? JOIN_FALLBACK;
}

/**
 * What is said after a request is sent. The same sentence whatever the
 * parent typed: it cannot tell her whether her child is on a list.
 * @param {string} kind  @param {string} schoolName
 */
export function sentWords(kind, schoolName) {
  const at = schoolName || "the school";
  if (kind === "parent") {
    return `Your request has gone to ${at}. The school office will check with you before anything is linked to your account: nothing is linked automatically, and nothing about any child is shown to you until they have.`;
  }
  if (kind === "pupil") {
    return `Your request has gone to ${at}. The office will match it to your place on the school's list and answer.`;
  }
  if (kind === "staff") return `Your request has gone to ${at}. Somebody there will answer it, and you will see the answer here.`;
  return `Your request has gone to ${at}. Somebody there will answer it, and you will see the answer here.`;
}

/**
 * What a pupil under eighteen is told instead of a form.
 */
export const PUPIL_UNDER_18 = Object.freeze({
  title: "A pupil's account is set up by the school office",
  lines: [
    "Ask your school office for a sign-in code. They set up a pupil's account, with a parent's consent where you are under 18.",
    "If you are under 13 you sign in with a code, not with Google.",
    "A parent who already has an account here can also ask the office to set you up.",
  ],
});

/**
 * What the words on a request in the list say, by its state.
 * @param {string} state
 */
export const REQUEST_STATE_WORDS = Object.freeze({
  pending: "waiting for an answer",
  granted: "granted",
  declined: "declined",
  withdrawn: "withdrawn",
});

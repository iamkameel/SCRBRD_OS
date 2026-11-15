/**
 * SCRBRD — "Ask SCRBRD to add my school" (EXPERIENCE_PASS §2.7, Q22; db/158).
 *
 * An account with no school whose school is not in the join list writes a
 * short note: the school's name, its town, and what they do there. A person
 * on the platform reads it and answers. This file is the pure half of the
 * screens: the job list, the request a note becomes, and every sentence said
 * back. Held by apps/web/test/school-ask.test.mjs.
 *
 * THREE RULES:
 *   1. THE NOTE ADDS NO SCHOOL AND LINKS NOBODY. Its answer says so: once
 *      SCRBRD has added the school, the person joins it from the list like
 *      anybody else, and a person at the school answers that.
 *   2. NOTHING ABOUT A CHILD. The job is a choice from a list, and there is no
 *      free text beyond the school's name and town. "I am a pupil" is not on
 *      the list: a pupil is sent to a teacher.
 *   3. PLAIN WORDS FOR WHAT HAPPENS NEXT, in every state.
 */

/** What the asker does at the school, as db/158's CHECK has the codes. */
export const JOBS = Object.freeze([
  { id: "coach",   label: "I coach cricket there" },
  { id: "teacher", label: "I teach there" },
  { id: "sport",   label: "I run sport there" },
  { id: "office",  label: "I work in the school office" },
  { id: "head",    label: "I lead the school (principal or deputy)" },
  { id: "parent",  label: "My child is at the school" },
  { id: "other",   label: "Something else" },
]);
const JOB_IDS = JOBS.map((j) => j.id);

/** As db/158 holds them, after the spaces are tidied. */
export const NAME_MAX = 120;
export const TOWN_MAX = 80;
/** How many open requests one account may have at once (db/158's cap). */
export const OPEN_MAX = 3;
/** How long an unanswered request stays open (ACCOUNT_LIFECYCLE §6.2). */
export const OPEN_DAYS = 90;

const clean = (/** @type {unknown} */ v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * The note a form becomes, or why not yet.
 * @param {{ name?: string, town?: string, job?: string }} f
 * @returns {{ ok: true, body: { schoolName: string, town: string, job: string } } | { ok: false, problem: string }}
 */
export function buildAsk(f = {}) {
  const name = clean(f.name), town = clean(f.town);
  if (name.length < 2) return { ok: false, problem: "Type the school's name." };
  if (name.length > NAME_MAX) return { ok: false, problem: `Keep the school's name under ${NAME_MAX} characters.` };
  if (town.length < 2) return { ok: false, problem: "Type the town the school is in." };
  if (town.length > TOWN_MAX) return { ok: false, problem: `Keep the town under ${TOWN_MAX} characters.` };
  if (!JOB_IDS.includes(String(f.job ?? ""))) return { ok: false, problem: "Choose what you do at the school." };
  return { ok: true, body: { schoolName: name, town, job: /** @type {string} */ (f.job) } };
}

/** The form's own line, under its heading. */
export const ASK_INTRO = "Tell us its name and town. A person at SCRBRD reads every request and answers it here. Nothing about your school goes public, and you are not linked to anything, until a person has checked it.";
/** For somebody who is a pupil, who does not ask for himself. */
export const ASK_PUPIL = "If you are a pupil, ask a teacher or the school office to send this.";

/** What is said once a note is sent. */
export function askSentWords(/** @type {string} */ name) {
  return `Sent to SCRBRD. A person will read it and answer here, under Your requests. If we add ${clean(name) || "the school"}, you will find it in the list above and can ask to join it. Meanwhile you can score a match on this phone.`;
}

/** A refusal from POST /api/school-requests, in the screen's words. */
export const ASK_WORDS = {
  has_school: "Your account already belongs to a school, so this is not the place to ask. Your school's office can write to SCRBRD.",
  name_required: "Type the school's name.",
  town_required: "Type the town the school is in.",
  job_invalid: "Choose what you do at the school.",
  already_asked: "You have already asked us to add that school. Its answer will show here, under Your requests.",
  too_many_open: `You have ${OPEN_MAX} requests waiting for an answer. When one is answered you can send another.`,
  not_signed_in: "You were signed out. Sign in again to ask.",
  missing_token: "You were signed out. Sign in again to ask.",
  token_expired: "You were signed out. Sign in again to ask.",
};
const ASK_FALLBACK = "That request was not sent. Try again in a moment.";
const ASK_UNREACHABLE = "Could not reach SCRBRD. Check your connection and try again; nothing was sent.";

/** @param {any} e */
export function askWords(e) {
  if (e?.status === undefined || e?.status === null) return ASK_UNREACHABLE;
  return /** @type {Record<string, string>} */ (ASK_WORDS)[e?.code] ?? ASK_FALLBACK;
}

/** Each state of a request, as the asker reads it: what it means and what comes next. */
export const ASK_STATE_WORDS = {
  open: "With SCRBRD. A person will read it and answer here.",
  added: "SCRBRD has added this school. Find it in the list under Join a school and ask to join it.",
  declined: "SCRBRD has not added this school. Your school's office can write to SCRBRD about it.",
  lapsed: `No answer in ${OPEN_DAYS} days, so this request has closed. You can ask again.`,
};

/** The job's words, for the platform's list. @param {string} id */
export const jobLabel = (id) => JOBS.find((j) => j.id === id)?.label ?? id;

/** The platform's own line, above its list: marking a request adds nothing. */
export const PLATFORM_INTRO = "Marking a request added does not add the school. Add the school and its first office account the usual way, then mark it added, so the person finds it in the list.";

/** A refusal from POST /api/school-requests/:id/decide, in the platform's words. */
export const DECIDE_WORDS = {
  not_permitted: "Only the platform answers these.",
  state_invalid: "Answer with Added or Decline.",
  no_such_request: "That request is not on the record.",
  already_decided: "That request was already answered. The list has been read again.",
  lapsed: `That request had waited ${OPEN_DAYS} days and closed. The person can ask again.`,
};
const DECIDE_FALLBACK = "That answer was not saved. Try again.";

/** @param {any} e */
export function schoolDecideWords(e) {
  if (e?.status === undefined || e?.status === null) return "Could not reach SCRBRD. Check your connection; nothing was saved.";
  return /** @type {Record<string, string>} */ (DECIDE_WORDS)[e?.code] ?? DECIDE_FALLBACK;
}

/** What the platform reads after its own answer. @param {"added" | "declined"} state @param {string} name */
export function schoolDecidedWords(state, name) {
  return state === "added"
    ? `Marked added. The person reads that ${clean(name)} is on SCRBRD and can ask to join it.`
    : `Declined. The person will read that SCRBRD has not added ${clean(name)}.`;
}

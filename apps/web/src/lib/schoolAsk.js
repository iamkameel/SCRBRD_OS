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
import { SCHOOLS_EMAIL } from "./contact.js";

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
export const NAME_MAX = 80;
export const TOWN_MAX = 80;
/** How many open requests one account may have at once (db/158's cap). */
export const OPEN_MAX = 3;
/** How long an unanswered request stays open (ACCOUNT_LIFECYCLE §6.2). */
export const OPEN_DAYS = 90;
/** What the asker is told: answered within a week (Kameel, 15 Nov). */
export const ANSWER_DAYS = 7;

/**
 * A request's age for the platform's list: whole days since it was asked,
 * the words, and whether it is past the week the asker was promised.
 * @param {string | null | undefined} requestedAt  @param {number} [now]
 * @returns {{ days: number, words: string, late: boolean }}
 */
export function askAge(requestedAt, now = Date.now()) {
  const ms = Date.parse(String(requestedAt ?? ""));
  const days = Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / 86400000)) : 0;
  const words = days === 0 ? "asked today" : days === 1 ? "asked 1 day ago" : `asked ${days} days ago`;
  return { days, words, late: days > ANSWER_DAYS };
}

// Every run of spaces, the no-break ones included, is one space (db/158).
const clean = (/** @type {unknown} */ v) => String(v ?? "").replace(/[\s\u00A0\u2007\u202F]+/g, " ").trim();
// What db/158 refuses in a name or a town: a control character, a soft
// hyphen, a zero-width, joiner or bidi character, or a byte-order mark. Read
// on what was typed, before the spaces are folded.
const UNSEEN = /[\p{Cc}\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;
// Two letters or digits at least, in any script.
const WORDISH = /[\p{L}\p{N}].*[\p{L}\p{N}]/u;
const chars = (/** @type {string} */ v) => [...v].length;

/**
 * The note a form becomes, or why not yet, with the field to fix.
 * @param {{ name?: string, town?: string, job?: string }} f
 * @returns {{ ok: true, body: { schoolName: string, town: string, job: string } } | { ok: false, problem: string, field: "name" | "town" | "job" }}
 */
export function buildAsk(f = {}) {
  const name = clean(f.name), town = clean(f.town);
  if (chars(name) < 2 || !WORDISH.test(name)) return { ok: false, field: "name", problem: "Type the school's name." };
  if (chars(name) > NAME_MAX) return { ok: false, field: "name", problem: `Keep the school's name under ${NAME_MAX} characters.` };
  if (UNSEEN.test(String(f.name ?? ""))) return { ok: false, field: "name", problem: "The school's name has a hidden character in it. Type it again rather than pasting it." };
  if (chars(town) < 2 || !WORDISH.test(town)) return { ok: false, field: "town", problem: "Type the town the school is in." };
  if (chars(town) > TOWN_MAX) return { ok: false, field: "town", problem: `Keep the town under ${TOWN_MAX} characters.` };
  if (UNSEEN.test(String(f.town ?? ""))) return { ok: false, field: "town", problem: "The town has a hidden character in it. Type it again rather than pasting it." };
  if (!JOB_IDS.includes(String(f.job ?? ""))) return { ok: false, field: "job", problem: "Choose what you do at the school." };
  return { ok: true, body: { schoolName: name, town, job: /** @type {string} */ (f.job) } };
}

/** The form's own line, under its heading. */
export const ASK_INTRO = "Tell us its name and town. A person at SCRBRD reads every request and answers it here. Nothing about your school goes public, and you are not linked to anything, until a person has checked it.";
/** For somebody who is a pupil, who does not ask for himself. */
export const ASK_PUPIL = "If you are a pupil, ask a teacher or the school office to send this.";

/** What is said once a note is sent. */
export function askSentWords(/** @type {string} */ name) {
  return `Sent to SCRBRD. We'll answer within a week, here under Your requests. If we add ${clean(name) || "the school"}, you will find it in the list above and can ask to join it. Meanwhile you can score a match on this phone.`;
}

/** A refusal from POST /api/school-requests, in the screen's words. */
export const ASK_WORDS = {
  // Kameel, 15 Nov: a pupil's account may not ask; it is told to ask a teacher.
  ask_a_teacher: "Ask a teacher to send this.",
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
  open: "Waiting: a person at SCRBRD will read it and answer here.",
  added: "SCRBRD has added this school. Find it in the list under Join a school and ask to join it.",
  declined: `SCRBRD has not added this school. Your school's office can write to SCRBRD about it at ${SCHOOLS_EMAIL}.`,
  lapsed: `No answer in ${OPEN_DAYS} days, so this request has closed. You can ask again.`,
};

/** The job's words, for the platform's list. @param {string} id */
export const jobLabel = (id) => JOBS.find((j) => j.id === id)?.label ?? id;

/** The platform's own line, above its list: marking a request adds nothing. */
/** A platform administrator's own request, on her list: somebody else answers it (db/158 own_request). */
export const OWN_WORDS = "Your own request, asked before you joined the platform. Somebody else at SCRBRD answers it.";

export const PLATFORM_INTRO = "Marking a request added does not add the school. Add the school and its first office account the usual way, then mark it added, so the person finds it in the list.";

/** A refusal from POST /api/school-requests/:id/decide, in the platform's words. */
export const DECIDE_WORDS = {
  not_permitted: "Only the platform answers these.",
  state_invalid: "Answer with Added or Decline.",
  no_such_request: "That request is not on the record.",
  own_request: "That is your own request. Somebody else at SCRBRD answers it.",
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

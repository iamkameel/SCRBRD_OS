/**
 * The Injuries screen's words and counts (GA-I19 design, D7).
 *
 * The database keeps three phases and three severities (db/00_schema_core.sql,
 * the CHECKs on `injury`). The screen shows those and no others: a clinical
 * sub-phase (immobilisation, strengthening, return to bowl) is the physio's
 * note, not a state. apps/web/test/injuries.test.mjs reads the CHECKs from the
 * schema and fails if these tables drift from them.
 *
 * `phase` and `severity` are the nature tier (medical.nature.read) and arrive
 * NULL for a status-only reader; `restricted` is the status tier. A count of
 * phases is drawn only where the phase was read: "Out" is the status fact.
 */

/** Database phase → the word the screen shows. */
const PHASE_WORDS = { active: "Injured", rehab: "Rehabilitating", cleared: "Cleared" };

/** Database severity → the word the screen shows. */
const SEVERITY_WORDS = { minor: "Minor", moderate: "Moderate", severe: "Severe" };

/** A phase word, or null where the phase was not read or is not one of ours. */
const phaseWord = (phase) => (Object.hasOwn(PHASE_WORDS, phase) ? PHASE_WORDS[phase] : null);

/** A severity word, or null where the severity was not read or is not one of ours. */
const severityWord = (severity) => (Object.hasOwn(SEVERITY_WORDS, severity) ? SEVERITY_WORDS[severity] : null);

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * The tile counts for a set of injury rows.
 *
 *   injured        phase = 'active'
 *   rehab          phase = 'rehab'
 *   out            restricted (the status tier; what a status-only reader gets)
 *   returningSoon  rtw within 7 days of `now`
 *
 * `natureTier` says whether this reader holds medical.nature.read. When not,
 * `injured` and `rehab` are null: the phase is not theirs to count, and a zero
 * made of NULLs would be a figure nobody made.
 */
function injuryCounts(rows, { natureTier, now }) {
  const withPhase = (p) => rows.filter((i) => i.phase === p).length;
  return {
    injured: natureTier ? withPhase("active") : null,
    rehab: natureTier ? withPhase("rehab") : null,
    out: rows.filter((i) => i.restricted).length,
    returningSoon: rows.filter((i) => {
      const d = (new Date(i.rtw) - now) / DAY_MS;
      return d >= 0 && d <= 7;
    }).length,
  };
}

// ══════════════════════════════════════════════════════
//  GA-I19 slice B: the physio's screens (words and dates only)
//
//  Nothing here decides who may see or do anything. The server's functions and
//  the masked views do that (db/111). These are the words a refusal becomes,
//  the dates a form offers, and the one sentence a worklist row is.
//
//  THE WORD "REVIEW" is the physio's. A coach, the director, the principal and
//  a parent read a dated history of the physio's looks at the boy, and none of
//  them is shown a review, a due date or a count (D5): `seenWord` is what the
//  history calls a look for them. tools/smoke-browser-injuries.mjs reads the
//  coach's and the director's Injuries screen and fails on the word.
// ══════════════════════════════════════════════════════

/** The first 10 characters of a date or timestamp, or null. @param {unknown} v */
const day10 = (v) => (v ? String(v).slice(0, 10) : null);

/**
 * Today in South Africa as YYYY-MM-DD: the date the database's sa_today()
 * would give. Not the browser's own zone, so a phone set to another zone does
 * not offer a "next review" the server will call past.
 * @param {Date} [now]
 */
function saToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A calendar date plus n days, as YYYY-MM-DD. @param {string} iso @param {number} n */
function addDaysIso(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from one calendar date to another (b - a). @param {string} a @param {string} b */
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / DAY_MS);

/** The two shortcuts the next-review field offers (Q10): a deadline the physio chooses, never a default. */
const NEXT_REVIEW_SHORTCUTS = Object.freeze([7, 14]);

/** An injury that is still open: not cleared. A NULL phase (status tier) is judged by `restricted`. @param {{phase?: string | null, restricted?: boolean}} i */
const isOpenInjury = (i) => (i.phase ? i.phase !== "cleared" : Boolean(i.restricted));

/**
 * The words on the worklist, one reason per row (D3). `daysOver` is how many
 * days past the date the row is; `dueOn` the date the reason is about. These
 * are the physio's words and are drawn only for medical.write.
 * @param {{reason: string, dueOn?: string | null, daysOver?: number}} w
 * @param {(iso: string) => string} fmt  the date as a person reads it
 */
function reasonLine(w, fmt) {
  const n = w.daysOver ?? 0;
  const plural = (/** @type {number} */ k) => `${k} day${k === 1 ? "" : "s"}`;
  switch (w.reason) {
    case "overdue":        return `Review overdue by ${plural(n)}${w.dueOn ? ` (was ${fmt(w.dueOn)})` : ""}`;
    case "return_passed":  return `Return date passed ${plural(n)} ago, and still restricted${w.dueOn ? ` (${fmt(w.dueOn)})` : ""}`;
    case "due":            return `Review due ${w.dueOn ? fmt(w.dueOn) : "soon"}`;
    case "no_return_date": return "Restricted, and no return date set";
    case "new":            return "Newly recorded, not yet reviewed";
    default:               return "Needs a look";
  }
}

/** Reasons in the order the list is kept, most pressing first (db/111 section 8). */
const REASON_ORDER = Object.freeze(["overdue", "return_passed", "due", "no_return_date", "new"]);

/**
 * What a refusal from the two doors is, in a sentence the physio can act on.
 * Every code is a word the function or the route chose (injury-api.mjs); one
 * that is not here is said plainly, with its code, and nothing is claimed
 * saved. None of them names a child.
 */
const REFUSAL = Object.freeze({
  not_signed_in: "Your session has ended. Sign in again; nothing was saved.",
  not_permitted: "Your role cannot record or review injuries for this boy.",
  not_under_support: "Not available while the platform's support team is looking at your school.",
  module_off: "Your school has switched Injuries off.",
  family_cannot_record: "You are this boy's parent here, so another physio records and reviews his injury. You can read it as his parent.",
  no_such_player: "That boy is not one you can record for.",
  no_such_injury: "That injury could not be found.",
  player_required: "Choose the boy.",
  injury_type_required: "Say what the injury is.",
  injury_type_too_long: "Shorten what the injury is to 200 characters.",
  severity_invalid: "Choose minor, moderate or severe.",
  date_injured_required: "Say the day he was injured.",
  date_injured_in_future: "He cannot have been injured on a day that has not come yet.",
  date_injured_invalid: "The day he was injured is not a date.",
  return_before_injury: "The return date is before the day he was injured.",
  rtw_date_invalid: "The return date is not a date.",
  next_review_required: "Choose the date you will look at him next.",
  next_review_in_past: "The next review must be today or later.",
  next_review_on_invalid: "The next review date is not a date.",
  cleared_has_no_next_review: "A boy who is cleared has no next review. Clear the date.",
  cleared_is_not_restricted: "A cleared boy is not restricted.",
  injury_cleared: "This injury is already cleared. If he is hurt again, record a new injury.",
  phase_invalid: "Choose Injured, Rehabilitating or Cleared.",
  review_before_last: "A newer review is already on record. Reload and try again.",
  recurs_not_his: "That earlier injury is not his.",
  recurs_an_open_injury: "That earlier injury is still open.",
  restricted_invalid: "Restricted is yes or no.",
  emergency_services_invalid: "Emergency services is yes or no.",
  bad_request: "Something in the form is not valid. Check the dates.",
});

/** @param {{code?: string, status?: number} | null | undefined} e */
const injurySay = (e) => (e?.code && Object.hasOwn(REFUSAL, e.code) ? REFUSAL[/** @type {keyof typeof REFUSAL} */ (e.code)]
  : e?.status ? `Not saved. The server said ${e.code || `HTTP ${e.status}`}.`
  : "Could not reach the server. Nothing was saved.");

/**
 * What a history row calls a look at the boy, for everybody who is not the
 * physio (see the note above on the word). The first row is the recording.
 * @param {boolean} first
 */
const seenWord = (first) => (first ? "Recorded" : "Seen by the physio");

/**
 * A boy who has left the school, from the `memberships` read (the existing
 * read: no widening). He has left when he has at least one membership and
 * none of them is current. Nothing known about him is not "left": a read that
 * returned no rows for him says nothing, and nothing is marked (D11).
 * @param {string} playerId @param {{player?: string, playerId?: string, current: boolean}[]} memberships
 */
function hasLeftSchool(playerId, memberships) {
  const mine = memberships.filter((m) => (m.playerId ?? m.player) === playerId);
  return mine.length > 0 && !mine.some((m) => m.current);
}

export {
  NEXT_REVIEW_SHORTCUTS, PHASE_WORDS, REASON_ORDER, REFUSAL, SEVERITY_WORDS,
  addDaysIso, day10, daysBetween, hasLeftSchool, injuryCounts, injurySay, isOpenInjury,
  phaseWord, reasonLine, saToday, seenWord, severityWord,
};

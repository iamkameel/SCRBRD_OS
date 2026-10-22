/**
 * The official result, in words (docs/design/OFFICIAL_RESULT.md D11, §2).
 *
 * The state is the server's alone — GET /api/matches/:id/official for a
 * reader of the fixture, the public result's `official` for the signed-out
 * page — both read off db/114's match_official_state(): a confirmation pinned
 * to the log's head and the result's hash, so a correction makes the result
 * provisional again by itself. This module only says it: which StateLabel
 * kind, and the short line after it. Nothing here decides a state.
 *
 * Two audiences, and only staff see two of the words:
 *   the public and a family   "Provisional", "Provisional · corrected 18:42",
 *                             "Official result · confirmed 20:15, 11 Oct" —
 *                             the time only, team-level, never who, never a
 *                             reason, never "under review" (Q3)
 *   staff                     the role word ("confirmed by the organiser"),
 *                             the dispute ("disputed by Westville Boys' High
 *                             1XI, 12 Oct · under review"), what a provisional
 *                             result waits on, and "was official … reopened …"
 *
 * Pure, and small: the public bundle carries it.
 */

const HOUR = 3600e3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sa = (/** @type {number} */ ms) => new Date(ms + 2 * HOUR);

/**
 * "20:15" on the fixture's clock (SAST) when it is today there, else
 * "20:15, 11 Oct" (§2: "the date once it is not today").
 * @param {string | number | null | undefined} at  @param {number} [now]
 * @returns {string | null}
 */
export function whenWords(at, now = Date.now()) {
  const ms = typeof at === "number" ? at : at ? Date.parse(at) : NaN;
  if (!Number.isFinite(ms)) return null;
  const d = sa(ms), n = sa(now);
  const clock = d.toISOString().slice(11, 16);
  const sameDay = d.toISOString().slice(0, 10) === n.toISOString().slice(0, 10);
  return sameDay ? clock : `${clock}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The role words D11 gives staff for who confirmed (confirmed_as). */
export const ROLE_WORDS = Object.freeze({
  organiser: "the organiser",
  home_school: "the home school",
  away_school: "the away school",
  platform: "the platform",
});

/** What a provisional result waits on, for staff (D6's blockers). */
export const BLOCK_WORDS = Object.freeze({
  innings_unsealed: "an innings is not sealed by the scorer",
  amendment_pending: "a correction is awaiting approval",
  ball_held: "a late ball is held for a decision",
});

/** Why it was reopened, for staff (D9's reasons, and D14's withdrawal). */
const REOPENED_BY = Object.freeze({
  correction: "reopened by a correction",
  decision: "reopened by a decision on the result",
  status: "reopened when the match's status changed",
});

/**
 * The signed-out page's label for a result: null while the match is not
 * decided, else provisional or official, with the time.
 * @param {{official?: boolean, officialAt?: string | null, outcome?: string} | null | undefined} result  the public result
 * @param {string | null | undefined} status  the fixture's status
 * @param {number} [now]
 * @returns {{kind: "provisional" | "official", why: string | null} | null}
 */
export function publicOfficial(result, status, now = Date.now()) {
  if (!result || result.outcome === "in_progress" || status === "live" || status === "upcoming" || status === "scheduled") return null;
  if (result.official === true) {
    const w = whenWords(result.officialAt ?? null, now);
    return { kind: "official", why: w ? `confirmed ${w}` : null };
  }
  return { kind: "provisional", why: null };
}

/**
 * The Match Centre's label, from GET /api/matches/:id/official.
 * @param {any} o  the route's answer
 * @param {{home?: string | null, away?: string | null}} [names]  the sides' labels, for "disputed by …"
 * @param {number} [now]
 * @returns {{kind: "provisional" | "review" | "official", why: string | null} | null}
 */
export function officialWords(o, names = {}, now = Date.now()) {
  if (!o || !o.state || o.state === "not_finished") return null;
  const t = (/** @type {any} */ x) => whenWords(x, now);
  if (o.state === "official") {
    if (!o.staff) return { kind: "official", why: o.confirmedAt ? `confirmed ${t(o.confirmedAt)}` : null };
    const who = ROLE_WORDS[/** @type {keyof typeof ROLE_WORDS} */ (o.confirmedAs)] ?? null;
    return { kind: "official", why: [who ? `confirmed by ${who}` : "confirmed", t(o.confirmedAt)].filter(Boolean).join(", ") };
  }
  if (o.state === "under_review" && o.staff) {
    const by = o.disputedAs === "away_school" ? names.away : o.disputedAs === "home_school" ? names.home
      : ROLE_WORDS[/** @type {keyof typeof ROLE_WORDS} */ (o.disputedAs)] ?? null;
    return { kind: "review", why: [`disputed${by ? ` by ${by}` : ""}`, t(o.disputedAt)].filter(Boolean).join(", ") };
  }
  // Provisional (and, for anybody who is not staff, under review: the server
  // already says it so).
  const reopened = o.lapsedAt ?? o.withdrawnAt ?? null;
  // D11: a family reads "Provisional · corrected 18:42" for a result reopened
  // by a change to it; a withdrawn confirmation is not a correction, and the
  // server gives them no time for one.
  if (!o.staff) return { kind: "provisional", why: o.lapsedAt ? `corrected ${t(o.lapsedAt)}` : null };
  if (reopened && o.wasOfficialAt) {
    const how = o.lapsedAt ? REOPENED_BY[/** @type {keyof typeof REOPENED_BY} */ (o.lapsedReason)] ?? "reopened" : "the confirmation was withdrawn";
    return { kind: "provisional", why: `was official ${t(o.wasOfficialAt)} · ${how} ${t(reopened)} · needs confirming again` };
  }
  const waits = BLOCK_WORDS[/** @type {keyof typeof BLOCK_WORDS} */ (o.blockedBy)];
  return { kind: "provisional", why: waits ? waits : "awaiting confirmation" };
}

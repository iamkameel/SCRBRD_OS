/**
 * Notices as a list a person reads (DESIGN_DIRECTION Flow C, redesign slice 17), said once for the two screens that
 * draw it: the one Notices screen (views/NotificationsView.jsx: the staff's and the pupil's) and the parent's
 * (views/family/family.jsx FamilyNotices).
 *
 *   - byDay(): the list in day groups, "Today", "Yesterday", then "Mon 23 Nov". The day is JOHANNESBURG's
 *     (lib/saTime.js), never the device's zone and never UTC's: a notice sent at 00:30 SAST is today's, though it
 *     is still yesterday in UTC until 02:00.
 *   - schoolOf(): a notice names its school only when the reader's notices come from more than one (a parent with
 *     a child at each of two schools). Each school's rows stay that school's: nothing here adds them up, merges
 *     them or counts them apart (NOTIFICATIONS.md D7, GA-I20 D10). The one count is the server's.
 *   - subjectLink(): where an opened notice's subject lives in this reader's app, in one place: "See the fixture",
 *     "See his health history". A link is offered only for a destination the reader's menu already has, and it
 *     only navigates: it grants nothing, and the screen it opens asks its own read, which refuses what is not his.
 *
 * Presentation only. Nothing here decides who receives a notice (my_notifications, under RLS, does), and nothing
 * here filters the list: what the server sent is what is drawn.
 */
import { saClock, saDate } from "./saTime.js";
import { humanDate } from "./format.js";
import { confirmsResult } from "./notifications.js";
import { profile } from "./session.js";
import { requestResult } from "./cockpitNav.js";
import { requestFix } from "./fixNote.js";
import { doorTo, fixtureDoorTo } from "./family.js";

// ── Day groups ───────────────────────────────────────────────────────

/** The SA day before an SA day: "2026-03-01" → "2026-02-28". @param {string} day "YYYY-MM-DD" */
export function dayBefore(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A day group's words: "Today", "Yesterday", or the weekday and the date in words ("Mon 23 Nov"), with the year
 * when it is not this one ("Tue 30 Dec 2025"). "Today" is today in Johannesburg.
 * @param {string} day  an SA day, "YYYY-MM-DD"  @param {number} [now]
 */
export function dayWords(day, now = Date.now()) {
  const today = saDate(now);
  if (!today) return humanDate(day);
  if (day === today) return "Today";
  if (day === dayBefore(today)) return "Yesterday";
  const words = humanDate(day);
  return day.slice(0, 4) === today.slice(0, 4) ? words : `${words} ${day.slice(0, 4)}`;
}

/**
 * The list in day groups, newest day first; inside a day the rows keep the order they came in (the server's,
 * newest first). A row with no date it can be placed by (the demonstration's "2h ago") is in a last group with no
 * heading.
 * @template R
 * @param {R[] | null | undefined} rows
 * @param {number} [now]
 * @param {(r: R) => unknown} [at]  when a row was sent
 * @returns {{ day: string | null, words: string | null, rows: R[] }[]}
 */
export function byDay(rows, now = Date.now(), at = (r) => /** @type {any} */ (r)?.time) {
  /** @type {Map<string, { day: string | null, words: string | null, rows: R[] }>} */
  const groups = new Map();
  for (const r of rows ?? []) {
    const day = saDate(at(r));
    const key = day ?? "";
    if (!groups.has(key)) groups.set(key, { day, words: day ? dayWords(day, now) : null, rows: [] });
    groups.get(key)?.rows.push(r);
  }
  return [...groups.values()].sort((a, b) => (a.day == null ? 1 : b.day == null ? -1 : b.day.localeCompare(a.day)));
}

/**
 * When in its day a notice was sent, on the SA clock: "14:05". A day-only date says nothing more than its group;
 * a time the demonstration wrote in words ("2h ago") is said as written.
 * @param {unknown} at
 */
export function timeWords(at) {
  const clock = saClock(at);
  if (clock) return clock;
  if (saDate(at)) return "";
  return at ? String(at) : "";
}

// ── The school ───────────────────────────────────────────────────────

/**
 * The names of the schools this person holds an assignment at (the session's own profile), and of the schools of
 * the children handed in (a parent's my_children rows): id → name. Never an authorization answer.
 * @param {{ school?: string | null, schoolName?: string | null }[]} [also]
 * @returns {Map<string, string>}
 */
export function schoolNames(also = []) {
  const names = new Map();
  const add = (/** @type {any} */ id, /** @type {any} */ name) => { if (id && name && !names.has(id)) names.set(id, String(name)); };
  for (const a of profile()?.assignments ?? []) add(a.school, a.schoolName);
  for (const k of also ?? []) add(k?.school, k?.schoolName);
  return names;
}

/**
 * Which school a notice names: none when every notice the reader holds is from one school (the usual case, and
 * the school is then said by everything else on the screen); its school's name when they come from two or more.
 * A school whose name this session does not hold is not named at all, never by its id.
 * @param {{ school?: string | null }[]} rows  the reader's notices, as held
 * @param {Map<string, string>} names  schoolNames()
 * @returns {(n: { school?: string | null }) => string | null}
 */
export function schoolOf(rows, names) {
  const ids = new Set((rows ?? []).map((n) => n?.school).filter(Boolean));
  if (ids.size < 2) return () => null;
  return (n) => (n?.school ? names.get(n.school) ?? null : null);
}

// ── The subject ──────────────────────────────────────────────────────

/**
 * @typedef {{ to: string, words: string, match?: string, child?: string | null, door?: { child: string, panel: string }, find?: string }} SubjectLink
 * @typedef {{ persona: "family" | "pupil" | null, nav: string[], kids?: { id: string }[], self?: string | null }} Reader
 */

/**
 * Where an opened notice's subject lives in this reader's app, or null. The one map from `subject_kind` to a
 * destination, per reader:
 *
 *   reader   match (a fixture, a result, a fifty,   injury                                   news (a post)
 *            a lift, a bowling directive)
 *   staff    Match Centre, on that fixture          Injuries, at that injury                  the Newsfeed
 *   parent   her Matches, on that fixture           Family, his Health, for her own child     (no destination)
 *   pupil    his Matches, on that fixture           Me, for his own injury alone              (no destination)
 *
 * Offered only where the reader's menu (useNav) already holds that destination; a parent's and a pupil's are only
 * ever their own app's, never a staff screen. Nothing for a notice with no subject, for the system's "A notice was
 * withdrawn" (it points at what was taken back), for a safeguarding notice (a DSO's has its own "Open the inbox")
 * or a "decided, confirm the result" notice (its own "Confirm the result"), and for the other subjects (training,
 * transport, a facility, skills, the system, a competition, a selection, welfare), which have no one screen to open.
 * @param {any} n  a row from asNotification()
 * @param {Reader} reader
 * @returns {SubjectLink | null}
 */
export function subjectLink(n, { persona, nav, kids = [], self = null }) {
  if (!n || !n.subjectKind || !n.subjectId) return null;
  if (n.retracts || n.type === "safeguarding" || confirmsResult(n)) return null;
  const has = (/** @type {string} */ k) => (nav ?? []).includes(k);
  const kind = n.subjectKind;
  if (persona === "family") {
    const child = (kids ?? []).some((k) => k.id === n.subjectPerson) ? n.subjectPerson : null;
    if (kind === "match" && has("fixtures")) return { to: "fixtures", words: "See the fixture", match: n.subjectId, child };
    if (kind === "injury" && has("family") && child) {
      return { to: "family", words: "See his health history", door: { child, panel: "health" }, find: `[data-testid="family-open-health-${child}"]` };
    }
    return null;
  }
  if (persona === "pupil") {
    if (kind === "match" && has("mymatches")) return { to: "mymatches", words: "See the fixture", match: n.subjectId };
    if (kind === "injury" && has("me") && self && n.subjectPerson === self) return { to: "me", words: "See your health history" };
    return null;
  }
  if (kind === "match" && has("matches")) return { to: "matches", words: "See the fixture", match: n.subjectId };
  if (kind === "injury" && has("injuries")) return { to: "injuries", words: "See the injury", find: `[data-testid="injury-${n.subjectId}"]` };
  if (kind === "news" && has("news")) return { to: "news", words: "See the post" };
  return null;
}

/**
 * Follow a subject link: leave the note the destination takes when it opens (the Match Centre's fixture, the
 * family's fixture or his Health, the row to land on), then go there. The note asks for nothing the destination's
 * own read does not give; a fixture not in its list is simply not opened.
 * @param {SubjectLink} link  @param {(page: string) => void} onNav
 */
export function followSubject(link, onNav) {
  if (link.to === "matches" && link.match) requestResult(link.match);
  if ((link.to === "fixtures" || link.to === "mymatches") && link.match) fixtureDoorTo(link.match, link.child ?? null);
  if (link.door) doorTo(link.door.child, link.door.panel);
  if (link.find) requestFix({ page: link.to, find: [link.find] });
  onNav(link.to);
}

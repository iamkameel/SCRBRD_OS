/**
 * The family and pupil apps' plain helpers (redesign step 4, phase A;
 * docs/design/STEP4_parent_pupil.md §2–§3).
 *
 * NOTHING HERE DECIDES WHAT ANYBODY MAY SEE. Every row these helpers sort
 * has already been returned by the server under the reader's own policy.
 * What they do is keep a screen about ONE child: every list a card draws is
 * narrowed here to the child the screen is about, because a parent who is
 * also on the staff reads her school's whole side, and "nothing on the screen
 * names another child" (§3.1, DESIGN_DIRECTION §6) has to hold for her too.
 */
import { roleGrants } from "@scrbrd/policy/roles";
import { PERSONA_NAV, ROLES } from "../design/roles.js";
import { profile } from "./session.js";
import { sidesOf } from "./matchCentre.js";

/**
 * Does this person hold a capability through ANY assignment they actually
 * have — the courtesy that decides whether to OFFER a control (a declaration,
 * a contact's edit), never whether it succeeds: the write's own policy does
 * that. Signed out, the demo persona and the roles it comes with.
 */
export function holds(role, capability) {
  const held = profile()?.assignments?.map((a) => a.role);
  const roles = held?.length ? held : [role, ...(ROLES[role]?.also ?? [])];
  return roles.some((r) => roleGrants(r, capability));
}

/**
 * The pupil's own player row: the person his own-record assignment names.
 * Read off the session's assignments (layout, not authority — the reads
 * behind it are re-authorised), as the assignment of a pupil-persona role
 * that names somebody. Null in the demonstration.
 */
export function ownRecordId() {
  const roles = PERSONA_NAV.pupil.roles;
  const a = (profile()?.assignments ?? []).find((x) => roles.includes(x.role) && Array.isArray(x.subjects) && x.subjects.length);
  return a?.subjects?.[0] ?? null;
}

/** Is this fixture one of this child's side's — at either end of a shared fixture? */
export function isTheirs(m, child) {
  if (!m || !child) return false;
  return (m.schoolId === child.school && m.homeTeam === child.team)
      || (m.awaySchoolId != null && m.awaySchoolId === child.school && m.awayTeamCode === child.team);
}

/** Which end of the fixture the child's side is at. */
export const endOf = (m, child) => (m.schoolId === child.school && m.homeTeam === child.team ? "home" : "away");

/** The other side, named: the opponent as the child's family says it. */
export function opponentOf(m, child) {
  const s = sidesOf(m);
  return endOf(m, child) === "home" ? s.away.full : s.home.full;
}

const startKey = (m) => m.startsAt ? String(m.startsAt) : `${m.date ?? ""}T${m.time ?? "00:00"}`;

/**
 * The child's side's fixtures: in play, still to come (soonest first), and
 * played (latest first). `now` is the caller's clock in ms, passed in so the
 * screens and their tests agree on what "still to come" means.
 */
export function fixturesOf(matches, child, now) {
  const mine = (matches ?? []).filter((m) => isTheirs(m, child));
  const t = (m) => Date.parse(m.startsAt ?? `${m.date}T${m.time ?? "00:00"}Z`);
  // A fixture still marked scheduled whose day has gone by is not "coming
  // up": it was played and not yet closed, or not played. It is listed with
  // the played ones, where its scorecard (or the lack of one) says which.
  const gone = (m) => m.status === "upcoming" && t(m) < now - 6 * 3600e3;
  return {
    live: mine.filter((m) => m.status === "live"),
    upcoming: mine.filter((m) => m.status === "upcoming" && !gone(m))
                  .sort((a, b) => startKey(a).localeCompare(startKey(b))),
    played: mine.filter((m) => m.status === "complete" || gone(m)).sort((a, b) => startKey(b).localeCompare(startKey(a))),
  };
}

/**
 * How a batter was out, as one word or two and NO NAME. The fold's dismissal
 * line ("c Bekker b Naidoo") names two other children, and a line on a
 * family's Home names none (§3.1): the method is the family's, the names are
 * the scorecard's (P4).
 */
export function howOutWord(dismissal) {
  const d = String(dismissal ?? "").trim().toLowerCase();
  if (!d) return "out";
  if (d.startsWith("retired hurt")) return "retired hurt";
  if (d.startsWith("retired")) return "retired out";
  if (d.startsWith("run out")) return "run out";
  if (/^c(\s*&\s*|\s+and\s+)b\b/.test(d)) return "caught and bowled";
  if (d.startsWith("c ") || d.startsWith("caught")) return "caught";
  if (d.startsWith("lbw")) return "lbw";
  if (d.startsWith("st ") || d.startsWith("stumped")) return "stumped";
  if (d.startsWith("hit wicket")) return "hit wicket";
  if (d.startsWith("b ") || d.startsWith("bowled")) return "bowled";
  if (d.startsWith("obstruct")) return "obstructing the field";
  if (d.startsWith("hit the ball twice") || d.startsWith("hit twice")) return "hit the ball twice";
  if (d.startsWith("timed out")) return "timed out";
  return "out";
}

const oversOf = (balls) => (balls % 6 === 0 ? String(balls / 6) : `${Math.floor(balls / 6)}.${balls % 6}`);

/**
 * One player's line in one match, from the fold: "17 off 12, run out ·
 * 2 for 18 off 4". Null when he neither batted nor bowled. Words about him
 * only — no other name appears in it.
 */
export function lineFor(innings, playerId) {
  if (!playerId) return null;
  const parts = [];
  for (const inn of innings ?? []) {
    const b = inn?.batsmen?.find((x) => x.id === playerId);
    if (b && (b.balls > 0 || b.runs > 0 || b.status === "out" || b.status === "retired")) {
      const off = b.balls != null ? ` off ${b.balls}` : "";
      parts.push(b.status === "out" ? `${b.runs}${off}, ${howOutWord(b.dismissal)}`
        : b.status === "retired" ? `${b.runs}${off}, ${howOutWord(b.dismissal ?? "retired hurt")}`
        : `${b.runs} not out${off ? ` (${b.balls})` : ""}`);
    }
  }
  for (const inn of innings ?? []) {
    const w = inn?.bowlers?.find((x) => x.id === playerId);
    if (w && w.balls > 0) parts.push(`${w.wickets} for ${w.runs} off ${oversOf(w.balls)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/** The child the family app opens on: the one remembered on this device, else the nearest fixture's, else the first. */
export function chooseChild(children, matches, remembered, now) {
  if (!children?.length) return null;
  const kept = children.find((c) => c.id === remembered);
  if (kept) return kept;
  let best = null, bestAt = Infinity;
  for (const c of children) {
    const next = fixturesOf(matches, c, now).upcoming[0];
    const at = next ? Date.parse(next.startsAt ?? `${next.date}T00:00Z`) : Infinity;
    if (at < bestAt) { best = c; bestAt = at; }
  }
  return best ?? children[0];
}

const KEY = "scrbrd.family.child";
/** The child chosen on this device, remembered as the theme is. Storage may be refused; that is fine. */
export function recallChild() {
  try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; }
}
export function rememberChild(id) {
  try { if (id) globalThis.localStorage?.setItem(KEY, id); } catch { /* private window */ }
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2029-03-14" → "14 Mar 2029". */
export function longDate(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The guardianship line on the parent's own Family card (P6, §3.3), from the
 * link's own end date — never from a birthday. Open while the child is at
 * school (db/62); a date otherwise.
 */
export function linkEndWords(child, w) {
  const name = child.knownAs || child.name;
  if (child.until) return `Your link to ${name} on SCRBRD ends on ${longDate(child.until)}.`;
  return `Your link to ${name} on SCRBRD stays open while ${name} is at the ${w?.place ?? "school"}. `
    + "When that ends it closes, on the day or on the eighteenth birthday, whichever is later.";
}

/** Notices for ONE child's Home: about that child, or about nobody in particular at that child's place and side. */
export function noticesFor(notices, child) {
  return (notices ?? []).filter((n) =>
    (n.subjectPerson == null || n.subjectPerson === child.id)
    && (n.school == null || n.school === child.school)
    && (n.team == null || n.team === child.team));
}

/**
 * The family screen's empty state for a parent whose request is with the
 * office (§3.3): her own pending guardian requests, each said as pending, with
 * the school's name from the public list and her own note. Never a child's
 * name from the platform: the player row is not hers to read until the link
 * is verified. "This does not mean it was approved."
 *
 * @param {any[] | null | undefined} requests  the role_requests read
 * @param {number} now
 * @returns {{id: string, words: string, note: string | null}[]}
 */
export function pendingWords(requests, now) {
  return (Array.isArray(requests) ? requests : [])
    .filter((r) => r.mine && r.state === "pending" && r.role === "guardian")
    .map((r) => {
      const asked = Date.parse(r.requestedAt ?? "");
      const days = !Number.isFinite(asked) ? null : Math.max(0, Math.floor((now - asked) / 864e5));
      const ago = days == null ? "" : days === 0 ? " · asked today" : ` · asked ${days} day${days === 1 ? "" : "s"} ago`;
      return {
        id: r.id,
        words: `Your request to be linked to a child at ${r.schoolName || "the school"} is with the office${ago}. `
          + "This does not mean it was approved. When the office verifies the link, your child appears here.",
        note: r.note ? String(r.note) : null,
      };
    });
}

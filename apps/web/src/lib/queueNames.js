/**
 * THE COACH'S OWN SIDE, BY NAME (redesign slice 11 follow-up; Kameel, 25 Nov:
 * "His OWN side's rows may name the boy, never a diagnosis or reason;
 * school-wide rows, the director's and the office's rows stay counts"; and
 * later the same day: "name boys only for 'has not answered' and 'marked
 * unavailable'; restricted stays a count, the name a tap deeper").
 *
 * The queue's rows are counts by design (GA-I09 §5, D8) and lib/queue.js holds
 * no name. This module words two of them again, for one reader only: a coach,
 * assistant coach or team manager whose own team assignment is that fixture's
 * side. Only the family's own facts are named: who has not answered (S7) and
 * who is marked unavailable (S3). A restricted boy is the injury record's
 * status tier, a health fact, so that row stays a count ("1 restricted boy on
 * the sheet") on Today, where anyone beside the phone reads it; its name is on
 * the side the row opens. The names come from the readiness read the queue
 * already made for the fixture, the same rows his Coach tab lists by name,
 * through the same sets the queue counts (cockpit.js `unanswered`, `onSheetAs`),
 * so the names and the count are one fact. Nothing is read here, and nothing
 * but `name` is taken from a row: never a reason, a note, an injury's nature
 * or a return date. Where the names do not account for the whole count, the
 * row keeps its count. Pure.
 */
import { TEAM_SCOPED_ROLES } from "@scrbrd/policy/roles";
import { onSheetAs, unanswered } from "./cockpit.js";

/** The roles that run one side (the pupil, team-scoped too, is no reader of the queue). */
const SIDE_STAFF = TEAM_SCOPED_ROLES.filter((r) => r !== "player");

/**
 * Is this fixture's side his own: ONE assignment in a side's staff role, for this school's team, naming no person
 * and no single fixture. A school-wide coach, the director and the office are not (their rows stay counts).
 * @param {any[] | null | undefined} assignments  @param {{school: string | null, team: string | null}} group
 */
export function ownSide(assignments, group) {
  if (!group?.school || !group.team) return false;
  return (assignments ?? []).some((a) => !!a && SIDE_STAFF.includes(a.role) && a.school === group.school && a.team === group.team
    && !a.fixture && (a.subjects?.length ?? 0) === 0);
}

/** "T Bekker", "T Bekker and R Pillay", "T Bekker, R Pillay and 5 more". @param {string[]} names @param {number} count */
export function nameList(names, count) {
  const shown = names.slice(0, 2);
  const more = count - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length === 2 ? `${shown[0]} and ${shown[1]}` : shown[0];
}

/**
 * A row's fact with names, for his own side, or null to keep the count. S7: everyone asked who has not answered;
 * S3: those on the sheet marked unavailable. A restricted row is never named here (null: it keeps its count). Names
 * only: the reason an absence was given, a note, an injury and a return date are never taken.
 * @param {{rule: string, id: string, count: number}} row
 * @param {any[] | null | undefined} readiness  the readiness read the queue made for this fixture
 * @param {{team: string | null, end: "home" | "away", status: boolean}} side
 * @returns {string | null}
 */
export function namedFact(row, readiness, side) {
  if (!readiness) return null;
  const set = row.rule === "S7" ? unanswered(readiness, side.team)
    : row.id.endsWith(":S3:unavailable") ? onSheetAs(readiness, side.end, { status: side.status }, "unavailable")
    : null;
  if (!set || set.length !== row.count || !row.count) return null;
  const names = set.map((r) => (typeof r.name === "string" ? r.name.trim() : "")).filter(Boolean);
  if (names.length !== set.length) return null;
  const who = nameList(names, set.length);
  const one = set.length === 1;
  if (row.rule === "S7") return `${who} ${one ? "has" : "have"} not answered`;
  return `${who} ${one ? "is" : "are"} marked unavailable`;
}

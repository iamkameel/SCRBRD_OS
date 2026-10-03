/**
 * Staff, from the school's role assignments.
 *
 * The Staff screen used to read the `staff` and `coach` tables, which nothing
 * writes: an office enrols a coach, a scorer or a physio through Settings →
 * People, and that makes an app_user and a role_assignment, never a row there.
 * So the screen was empty at any real school. It now reads what People reads,
 * the `users` read and the `assignments` read (lib/people.js joins them), and
 * keeps the people who hold a role that is a staff role.
 *
 * This decides nothing about authority. Both reads are row-scoped in Postgres
 * for the reader: what comes back here is what this person may see, and a
 * reader who may read accounts but not their appointments gets each account
 * with the one role it carries. A person with no staff role, a parent or a
 * pupil, is not in the list, and the clearance register beside it is the
 * server's own.
 *
 * Pure: the day is an argument.
 */
import { liveRoles, peopleWithRoles } from "./people.js";

/**
 * Roles that are not a post at the school: the family's, the pupil's, the
 * spectator's, the enquiry key, the platform's own, and the old account word
 * "parent" that an account row may still carry. Everything else in the
 * policy's vocabulary is somebody the school appointed.
 */
export const NOT_STAFF = new Set(["guardian", "parent", "player", "selfaccess", "spectator", "enquiry", "superadmin", "platformadmin"]);

/**
 * One entry per account that holds a staff role now (live or paused), with
 * only those roles: `{ id, name, email, teams, lastSeen, status, roles }`.
 * Sorted by name. A person who coaches and is also a parent is here once, as
 * a coach.
 * @param {any[]} users the `users` read's rows, adapted
 * @param {any[]} assignments the `assignments` read's rows, adapted
 * @param {string} today YYYY-MM-DD
 */
export function staffFrom(users, assignments, today) {
  return peopleWithRoles(users, assignments, today)
    .map((p) => ({ id: p.id, name: p.name, email: p.email ?? null, school: p.school ?? null, teams: p.teams ?? [],
                   lastSeen: p.lastLogin ?? null, status: p.status,
                   roles: liveRoles(p).filter((r) => !NOT_STAFF.has(r.role)) }))
    .filter((p) => p.roles.length > 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** The roles present among these people, once each, for the filter. */
export const rolesPresent = (staff) => [...new Set(staff.flatMap((p) => p.roles.map((r) => r.role)))];

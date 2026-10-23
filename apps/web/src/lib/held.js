/**
 * What the signed-in person holds, for presentation (GA-I07).
 *
 * The shell badges a person with ONE role, and the navigation is drawn from
 * every role they hold (lib/features.js useNav). A view that gated a control
 * on the badge alone therefore hid, from a coach who is also a director of
 * sport, a button the menu had just led them to. These answer from the roles
 * held, so the gate and the menu agree.
 *
 * Presentation only, exactly as rbac holdsCapability is: it decides what to
 * DRAW. Every read and write is authorised again by the server against the
 * same assignments, so a wrong answer here shows or hides a control and
 * cannot grant anything.
 */
import { roleGrants } from "@scrbrd/policy/roles";
import { holdsCapability } from "../rbac/index.js";
import { profile } from "./session.js";

/** The distinct roles of the signed-in person's assignments; empty in the demo. */
export function heldRoles() {
  return [...new Set((profile()?.assignments ?? []).map((a) => a.role).filter(Boolean))];
}

/** The teams of the signed-in person's assignments, in the order they hold them; empty in the demo. */
export function heldTeams() {
  return [...new Set((profile()?.assignments ?? []).map((a) => a.team).filter(Boolean))];
}

/**
 * Does the person hold this capability through ANY role they hold? In the
 * demo, which has no assignments, it is rbac's answer for the badge role.
 * @param {string} role  the badge role the shell chose
 * @param {string} capability
 * @param {string[]} [held]  the held roles; read from the session by default (the test passes them)
 */
export function holdsAsHeld(role, capability, held = heldRoles()) {
  return held.length ? held.some((r) => roleGrants(r, capability)) : holdsCapability(role, capability);
}

/*
 * WHOSE CONSENTS THIS PERSON READS (REACH R-B, db/115). Presentation only,
 * like everything above: it decides which boys a consent card lists and what
 * its empty state says, so that a boy whose decision the server will not
 * show this reader is not drawn as "no decision recorded". The rows
 * themselves come from the server under the table's own policy; a wrong
 * answer here mislabels a line and grants nothing.
 */

/** The links that make a person a boy's family: db/08's is_family_of() reads these two, verified. */
const FAMILY_LINKS = Object.freeze(["guardian", "selfaccess"]);

/**
 * The boys the signed-in person is family of: the ones his guardian or
 * self-access links name (the session lists only live links).
 * @param {any[]} [assignments]  the session's assignments; read from it by default (the test passes them)
 * @returns {Set<string>}
 */
export function familyOf(assignments = profile()?.assignments ?? []) {
  return new Set(assignments.filter((a) => FAMILY_LINKS.includes(a.role)).flatMap((a) => a.subjects ?? []));
}

/**
 * Does one assignment reach this boy for this capability, as app_can() scopes
 * it: his school, his side (unless the question is school-wide), and, if it
 * names anybody, him.
 */
function reaches(a, capability, player, wholeSchool) {
  if (FAMILY_LINKS.includes(a.role) || !roleGrants(a.role, capability)) return false;
  if (a.school && a.school !== player.school) return false;
  if (!wholeSchool && a.team && a.team !== player.team) return false;
  const named = a.subjects ?? [];
  return named.length === 0 || named.includes(player.id);
}

/**
 * May this person read this boy's scouting decision? player_scouting_consent_read
 * (db/115): his family, the office at his school (guardian.link.manage), and
 * his own side's coach (player.development.read at his side). In the demo,
 * which has no assignments, every boy on the screen.
 * @param {{ id: string, school?: string | null, team?: string | null }} player
 * @param {any[]} [assignments]
 */
export function readsScoutingOf(player, assignments = profile()?.assignments ?? []) {
  if (!assignments.length) return true;
  if (familyOf(assignments).has(player.id)) return true;
  return assignments.some((a) => reaches(a, "guardian.link.manage", player, true)
                              || reaches(a, "player.development.read", player, false));
}

/**
 * Whose passport consents does this person read? passport_consent_read
 * (db/115): a boy's family reads the schools it has named ("family"); the
 * office of a school named (guardian.link.manage there) reads the consents
 * naming that school ("office"); a coach, a pupil, or a parent of another
 * family reads none (null). In the demo, "family", as the screen always drew.
 * @param {any[]} [assignments]
 * @returns {"family" | "office" | null}
 */
export function passportConsentReader(assignments = profile()?.assignments ?? []) {
  if (!assignments.length || familyOf(assignments).size > 0) return "family";
  return assignments.some((a) => !FAMILY_LINKS.includes(a.role) && roleGrants(a.role, "guardian.link.manage")) ? "office" : null;
}

/**
 * Does the person hold this capability through an assignment that could reach
 * THIS player? An assignment about named people (`selfaccess`, `guardian`)
 * reaches only the players it names, so a pupil who holds
 * `player.development.read` for himself does not hold it for the team-mate he
 * taps in a list. Presentation only, as above: it decides whether a screen
 * asks, and the server decides what it answers. In the demo, rbac's answer.
 * @param {string} role  @param {string} capability  @param {string | null | undefined} playerId
 * @param {{ role?: string, subjects?: string[] }[]} [assignments]  the session's by default (the test passes them)
 */
export function holdsForPlayer(role, capability, playerId, assignments = profile()?.assignments ?? []) {
  if (!assignments.length) return holdsCapability(role, capability);
  if (!playerId) return false;
  return assignments.some((a) => !!a.role && roleGrants(a.role, capability)
    && (!(a.subjects?.length) || a.subjects.includes(playerId)));
}

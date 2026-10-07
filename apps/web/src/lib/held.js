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

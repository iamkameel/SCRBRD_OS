/**
 * Who is SHOWN the disciplinary record, and who is offered the form to file one.
 *
 * Courtesy only: row-level security on disciplinary_record (db/25) is the real
 * guard, and these answers decide what to draw, never what to allow.
 *
 * STAFF ONLY, BY PRODUCT DECISION. The database lets a pupil read his own
 * record — `selfaccess` holds discipline.read, for the same right-of-access
 * reason it holds his medical file — and nothing here changes that. What the
 * product owner decided is that the app does not draw it for him yet: a live
 * matter about yourself, shown on a screen with no one beside you to explain
 * it, is a conversation the school should have first. So the read side is
 * drawn for a persona that holds discipline.read AND whose figures are not
 * about one person.
 *
 * THE PERSONA, NOT THE ROLE STRING. The shell lays a pupil out as `player`,
 * which holds no discipline capability at all; the capability comes with the
 * `selfaccess` assignment every pupil carries beside it (ROLE_IDENTITY.also in
 * design/roles.js). Asking only about `player` would make the pupil clause
 * below dead code that passed by accident — so the question is asked of the
 * whole persona, and it is the `readsOwnRecord` clause that keeps him out.
 * rbac.test.mjs pins both halves.
 */
import { holdsCapability, readsOwnRecord } from "./index.js";
import { ROLES } from "../design/roles.js";

/** The role the shell was laid out for, and the roles it always comes with. */
const persona = (role) => [role, ...(ROLES[role]?.also ?? [])];
const personaHolds = (role, cap) => persona(role).some((r) => holdsCapability(r, cap));

/** Draw the Conduct tab: a staff reader of the record. */
export function readsConduct(role) {
  return personaHolds(role, "discipline.read") && !persona(role).some(readsOwnRecord);
}

/** Offer a form to file (and, beside a readable matter, progress) one. */
export function filesConduct(role) {
  return personaHolds(role, "discipline.write");
}

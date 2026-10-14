import { ROLES } from "../design/roles.js";

/**
 * Which role to draw the workspace with, when someone holds several.
 *
 * A placeholder for the real thing. The workspace is meant to be assembled
 * from ALL of a person's assignments — Sarah is a director of sport at one
 * school and a guardian at another, and neither view is the whole truth.
 * Until the dashboard engine exists, the shell needs one role to lay out
 * navigation, so this picks the widest. It affects presentation only: every
 * request is authorised server-side against every assignment, so choosing
 * wrong shows the wrong menu, never the wrong data.
 */
export function primaryRole(p) {
  const held = (p?.assignments ?? []).map(a => a.role).filter(r => ROLES[r]);
  // Widest first. Every policy role has an identity now, so an unranked one
  // still lands somewhere real rather than on ROLES[undefined] — which is
  // what an empty shell looked like: signed in, no navigation, no name.
  // The owner's key is the widest of all and was missing, so an account
  // holding it beside the platform's landed as the platform and was never
  // offered the roles only the owner may appoint.
  const RANK = ["superadmin","platformadmin","principal","directorofsport","schooladmin","sportsadmin",
                "coach","assistantcoach","teammanager","analyst","scorer","medical",
                "guardian","player"];
  return RANK.find(r => held.includes(r)) ?? held[0] ?? "spectator";
}

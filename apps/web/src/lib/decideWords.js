/**
 * What the office is told when it answers a role request (Management →
 * Requests → Grant / Decline), in the screen's words.
 *
 * POST /api/requests/:id/decide answers a refusal with a code, from
 * decide_role_request() (db/62, db/86) or from the route's own checks. Every
 * code that can come back has a plain sentence here. None names a child.
 * A success is said only after the server's reply.
 */

export const DECIDE_WORDS = {
  no_such_request: "That request could not be found. It may have been withdrawn. The list has been read again.",
  already_decided: "Somebody has already answered this request. The list has been read again.",
  not_permitted: "You cannot answer this request.",
  team_required: "A coach belongs to a side. Choose which side, then grant it.",
  player_required: "Choose which player this is for, then grant it.",
  player_not_at_that_school: "That player is not at this school. Choose the player again.",
  player_date_of_birth_required: "That player has no date of birth on the roster, so a guardian cannot be linked yet. Add it to the roster, then grant it.",
  player_is_an_adult: "That player is 18 or older, so a guardian cannot be linked to them.",
  platform_role_needs_no_school: "That role belongs to the platform, not to a school. A school cannot grant it.",
  grant_required: "That answer was not understood. Try Grant or Decline again.",
  player_invalid: "That player was not understood. Choose the player again.",
  team_code_invalid: "That side was not understood. Choose the side again.",
  missing_token: "You were signed out. Sign in again to answer requests.",
  token_expired: "You were signed out. Sign in again to answer requests.",
};
const DECIDE_FALLBACK = "That request was not answered. Try again, or ask the platform office.";
const DECIDE_UNREACHABLE = "SCRBRD could not be reached. The request may or may not have been answered. Check the list before trying again.";

/**
 * A refusal in words: by code, else the server's own `detail`, else what we
 * know without it. Never a raw code.
 * @param {any} e
 */
export function decideWords(e) {
  if (e?.code && DECIDE_WORDS[e.code]) return DECIDE_WORDS[e.code];
  if (e?.detail) return e.detail;
  if (e?.status) return DECIDE_FALLBACK;
  return DECIDE_UNREACHABLE;
}

/**
 * The line said after the server's reply.
 * @param {boolean} grant  @param {string} roleLabel  @param {string | null | undefined} team
 */
export function decidedWords(grant, roleLabel, team) {
  if (!grant) return "Declined.";
  return `Granted: ${roleLabel}${team ? ` at ${team}` : ""}.`;
}

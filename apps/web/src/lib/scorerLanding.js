/**
 * Which home a signed-in account lands on: the scorer's, or the day sheet.
 *
 * A leaf on purpose: App.jsx asks this at sign-in, so it is in the entry
 * graph, and lib/scorerHome.js, which re-exports both names, is the scorer's
 * home's own and is not (29 Oct, the entry trim). See lib/scorerHome.js for
 * what the home lists and why.
 */

/** The capability a claim asks for (db/33). */
export const SCORE_CAPABILITY = "scoring.start";

/**
 * Does this account land on the scorer's home rather than the day sheet?
 *
 * By capability, never by role name (ADR 0003): it may start scoring, and it
 * neither picks a side (team.select) nor reads a side's roster
 * (player.roster.read). That is the scorer's bundle and no other today: the
 * coach, assistant coach, sports admin and director of sport, who also score,
 * keep the day sheet and its match-day card. A person holding a scorer role
 * beside a coaching one keeps the day sheet too: the roles held are asked.
 * @param {(capability: string) => boolean} holds  holdsAsHeld bound to the badge role
 */
export function scorerLanding(holds) {
  return holds(SCORE_CAPABILITY) && !holds("team.select") && !holds("player.roster.read");
}

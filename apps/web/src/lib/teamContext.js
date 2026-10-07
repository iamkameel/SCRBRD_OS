/**
 * Which side a roster screen opens on (GA-I07).
 *
 * Squad and Analytics opened on "1XI" and filtered by it, so a coach of U15A
 * saw an empty roster until he found the tab. The side is now chosen from what
 * the person actually has: the team they hold an assignment for, else the first
 * team the rows they were given contain. A choice they made stays, for as long
 * as that team is still among the rows.
 *
 * Presentation: it picks a tab. The rows were already scoped by the server and
 * this removes nothing from them.
 */
import { compareTeams } from "@scrbrd/policy/teams";

/** The distinct teams in a set of rows, in team-sheet order (1st XI first, U16 before U15). @param {{team?: string | null}[]} rows */
export function teamsOf(rows) {
  return [...new Set((rows ?? []).map((r) => r?.team).filter(Boolean))].sort(compareTeams);
}

/**
 * The team to show.
 *
 * @param {{ teams: string[], held?: string[], chosen?: string | null }} o
 *   `teams`  the teams the scoped rows contain
 *   `held`   the teams the person holds an assignment for, in the order held
 *   `chosen` what they picked, if they did
 * @returns {string | null}  null while there are no rows to name a team
 */
export function pickTeam({ teams, held = [], chosen = null }) {
  if (chosen && teams.includes(chosen)) return chosen;
  return held.find((t) => teams.includes(t)) ?? teams[0] ?? null;
}

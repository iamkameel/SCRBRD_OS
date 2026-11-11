import { authorize } from "@scrbrd/policy/authorize";

/**
 * CRI-1.4: "Enter scoring" on the match page (docs/design/CRICINFO_GAP_PLAN.md
 * §6, Sprint 1; the Full audit's §3: "a scorer's match should offer an
 * explicit Enter scoring action only when authorised; reading a match must
 * never silently transfer the user into edit/scoring state").
 *
 * WHO IS OFFERED IT. A person one of whose assignments, in force now, grants
 * the capability the scoring routes themselves ask for — `scoring.edit`, the
 * ball log's write (db/02: ball_event's insert policy, quarantine and undo all
 * ask `app_can('scoring.edit', match_school(m), match_team(m), NULL, m)`) —
 * and covers THIS fixture: its home school, its home team and the fixture
 * itself, exactly the four arguments the database passes. The decision is
 * `authorize()` from @scrbrd/policy, the module the RLS is generated from, so
 * the button and the database ask one question. No new capability, and no
 * role named: an assignment is asked what it grants.
 *
 * WHAT IT IS NOT. It decides what to DRAW. The pad's claim (POST
 * /api/matches/:id/session/claim) and every ball after it are decided again by
 * the database; a wrong answer here offers a button that is then refused, and
 * cannot let anyone score. Reading the match page never claims, never opens
 * the pad, and never asks the scoring routes anything: the pad opens only from
 * this button's own tap (MatchView → onOpenScorer).
 *
 * Pure, with no other import, so apps/web/test/enter-scoring.test.mjs proves
 * the rule for every role in roles.mjs under plain node.
 */

/** The capability the button stands on: the scoring routes' own. */
export const ENTER_SCORING_CAPABILITY = "scoring.edit";

/** The states of a fixture the pad can be entered in: being played, or yet to be. */
export const ENTERABLE = Object.freeze(["live", "upcoming"]);

/**
 * The resource a fixture's scoring is about, as the database names it:
 * match_school() is the home school, match_team() the home team's code
 * (the match row's `team_code`, the Match Centre's `homeTeam`), and the
 * fixture itself, which a scorer's single-fixture assignment narrows to.
 * Null when the row cannot say which school it is (a demonstration fixture):
 * a resource with no school is covered by no school's assignment.
 * @param {any} match  the Match Centre's fixture row (lib/live.js)
 * @returns {{school: string, team: string | null, fixture: string} | null}
 */
export function scoringResource(match) {
  if (!match?.id || !match.schoolId) return null;
  return { school: match.schoolId, team: match.homeTeam ?? null, fixture: match.id };
}

/**
 * Is "Enter scoring" offered on this fixture's page? Fails closed: no
 * assignments, no fixture, a fixture with no school, one that is finished or
 * abandoned — no button.
 * @param {import("@scrbrd/policy/authorize").Assignment[] | null | undefined} assignments  the session's (lib/session.js profile())
 * @param {any} match
 * @param {Date | string | number} [at]
 * @returns {boolean}
 */
export function mayEnterScoring(assignments, match, at = new Date()) {
  if (!ENTERABLE.includes(match?.status)) return false;
  const resource = scoringResource(match);
  if (!resource) return false;
  return authorize({ assignments: assignments ?? [], capability: ENTER_SCORING_CAPABILITY, resource, at }).allowed;
}

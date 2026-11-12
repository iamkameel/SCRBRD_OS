import { roleGrants, SUBJECT_SCOPED_ROLES } from "@scrbrd/policy/roles";
import { endCovered } from "./cockpit.js";

/**
 * CRI-2.5: who reads a match's whole analysis on the signed-in Analytics tab,
 * and who its three spectator charts (docs/design/CRICINFO_GAP_PLAN.md
 * Sprint 2; the Lessons audit: "the public analytics surface is small").
 *
 * THE CAPABILITY is `analytics.read` ("See aggregate analysis",
 * packages/policy): the one the Analytics module and Compare open under. A
 * role is never named: an assignment is asked what it grants. It must be one
 * that is about a side or a school, never one that names a person (a
 * guardian's, a pupil's own, an enquiry), and it must cover this fixture's
 * side as the Coach tab's does (endCovered(), lib/cockpit.js) — or be
 * platform-wide (no school). Everyone else, a parent, a pupil, a spectator,
 * has the three: the worm with its wickets, runs per over, and the
 * partnerships. Fails closed: no assignments, the three.
 *
 * This is layout, not authority: the charts draw the fold of a log every
 * signed-in reader of the fixture already has, and the per-player wheel's
 * own gate (family mode, tabs.jsx) stands inside the whole analysis.
 */
export const FULL_ANALYSIS_CAPABILITY = "analytics.read";

/**
 * @param {{role: string, school: string | null, team: string | null, fixture?: string | null, subjects?: string[]}[] | null | undefined} assignments
 * @param {any} match  the Match Centre's fixture row
 * @returns {boolean}
 */
export function fullAnalysis(assignments, match) {
  if (!match?.id) return false;
  return (assignments ?? []).some((a) => {
    if (!a?.role || SUBJECT_SCOPED_ROLES.includes(a.role) || (a.subjects?.length ?? 0) > 0) return false;
    if (!roleGrants(a.role, FULL_ANALYSIS_CAPABILITY)) return false;
    if (a.fixture && a.fixture !== match.id) return false;
    if (!a.school && !a.team) return true;          // platform-wide
    return endCovered(a, match) != null;
  });
}

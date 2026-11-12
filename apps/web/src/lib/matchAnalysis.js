import { PERSONA_NAV } from "../design/roles.js";
import { heldRoles } from "./features.js";

/**
 * CRI-2.5: which of the signed-in Analytics tab's layouts a reader is drawn
 * (docs/design/CRICINFO_GAP_PLAN.md Sprint 2; the Lessons audit: "the public
 * analytics surface is small").
 *
 * PRESENTATION, NOT ACCESS (the lead's call, 13 Nov 2026). Every reader of a
 * fixture already reads its whole ball log; the three-chart view only draws
 * less of it. So it is decided as the shell decides which app to lay out —
 * by persona, from the roles this session holds (heldRoles(), lib/features.js,
 * the set personaOf() reads) — and no capability or grant changes:
 *
 *   - a reader whose every role is a family's or a pupil's (the personas'
 *     roles, PERSONA_NAV: guardian; player and selfaccess) or a follower's
 *     (spectator) has the three: the worm with its wickets, runs per over and
 *     the partnerships;
 *   - anybody holding any other role, which is every staff role — coaches and
 *     assistant coaches, team managers, scorers, admins, medical — keeps every
 *     chart. A coach who is also a parent holds a staff role, so he keeps them.
 *
 * Fails open to the whole analysis when nothing is held (a demonstration with
 * no role): it is what the tab drew before CRI-2.5.
 */
export const THREE_CHART_ROLES = Object.freeze(new Set([
  ...Object.values(PERSONA_NAV).flatMap((p) => p.roles),
  "spectator",
]));

/**
 * @param {string[]} roles  the roles held
 * @returns {boolean}  true: the whole analysis; false: the three charts
 */
export function fullAnalysisFor(roles) {
  const held = [...new Set(roles ?? [])].filter(Boolean);
  return !held.length || !held.every((r) => THREE_CHART_ROLES.has(r));
}

/** The session's own: the roles it holds, or the demonstration's persona. @param {string} role  the shell's badge role */
export const fullAnalysis = (role) => fullAnalysisFor(heldRoles(role));

/**
 * SCRBRD — roles as capability bundles.
 *
 * A role is a human-readable name for a set of capabilities. It carries no
 * scope: `coach` says what a coach may do, never which team. Scope lives on
 * the assignment, and the two are only ever evaluated together
 * (authorize.mjs).
 *
 * Two consequences worth keeping in mind when editing this file:
 *
 *   - Adding a role cannot widen anyone's access, because access is decided on
 *     capabilities and assignments, not on names.
 *   - Adding a capability to a role widens it for EVERY assignment of that
 *     role, at every school. That is the change to review carefully — in
 *     particular anything in SENSITIVE.
 *
 * The scoring capabilities are opt-in and fail closed. A role that does not
 * name `scoring.edit` cannot score, so a new role can never accidentally
 * acquire live scoring rights; the failure mode is a role that cannot score
 * (visible immediately, reported at once) rather than one that silently can.
 */

import { ALL_CAPABILITIES, isCapability } from "./capabilities.mjs";

// The floor for anyone attached to a team. facility.read is here because
// knowing WHERE a fixture is played is not sensitive — it is on the team
// sheet — and withholding it left coaches, managers and assistants unable to
// open the Fields view at all.
const READ_TEAM = ["team.read", "fixture.read", "player.profile.read", "news.read", "facility.read", "competition.read"];

// A bundle is written as a list because that reads well, but it MEANS a set:
// spreading READ_TEAM and then naming one of its capabilities again is a
// harmless authorial redundancy. It is deduplicated below rather than policed,
// because the alternative is a duplicate-key error at migration time — the
// failure is loud, but it is a long way from the line that caused it.
const BUNDLES = {
  // ── Platform ──
  // Operating the platform is not a licence to read a school's confidential
  // records. Support access to those goes through
  // platform.support.impersonate, which is time-boxed and audited.
  platformadmin: [
    "platform.health.read", "platform.tenant.manage", "platform.support.impersonate",
    "school.read", "user.read", "audit.read", "competition.read", "news.read",
  ],

  // ── Institution leadership ──
  principal: [
    ...READ_TEAM, "school.read", "user.read", "analytics.read",
    "competition.read", "discipline.read", "facility.read", "invoice.read",
    "player.performance.read", "medical.status.read", "audit.read",
  ],
  directorofsport: [
    ...READ_TEAM, "school.read", "user.read", "user.invite",
    "team.manage", "team.select", "fixture.create", "fixture.update", "fixture.cancel",
    "player.profile.manage", "player.performance.read", "player.development.read",
    "medical.status.read", "discipline.read", "discipline.write",
    "analytics.read", "competition.read", "facility.read", "facility.manage",
    "transport.read", "officiating.assign",
    "scoring.start", "scoring.edit", "scoring.finalise", "scoring.correct",
    "news.publish.team", "news.publish.school", "audit.read",
  ],
  schooladmin: [
    ...READ_TEAM, "school.read", "school.manage", "user.read", "user.invite", "user.role.assign",
    "team.manage", "fixture.create", "fixture.update", "fixture.cancel",
    "player.profile.manage", "player.pii.read", "medical.status.read",
    "discipline.read", "facility.read", "facility.manage",
    "transport.read", "transport.manage", "invoice.read",
    "competition.read", "news.publish.school", "audit.read",
  ],
  sportsadmin: [
    ...READ_TEAM, "user.read", "team.manage", "team.select",
    "fixture.create", "fixture.update", "fixture.cancel", "officiating.assign",
    "player.profile.manage", "medical.status.read",
    "facility.read", "facility.manage", "transport.read", "transport.manage",
    "competition.read", "news.publish.team", "news.publish.school",
    "scoring.start", "scoring.edit", "scoring.finalise",
  ],

  // ── Coaching ──
  // A coach sees availability, never the diagnosis.
  coach: [
    ...READ_TEAM, "team.select",
    "player.performance.read", "player.performance.write",
    "player.development.read", "player.development.write",
    "medical.status.read", "analytics.read", "transport.read",
    "scoring.start", "scoring.edit", "scoring.finalise",
    "news.publish.team",
  ],
  assistantcoach: [
    ...READ_TEAM, "player.performance.read", "player.development.read",
    "medical.status.read", "transport.read",
    "scoring.start", "scoring.edit",
  ],
  teammanager: [
    ...READ_TEAM, "team.select", "medical.status.read",
    "transport.read", "news.publish.team",
  ],

  // ── Matchday ──
  // A scorer's assignment is normally narrowed to a single fixture, so
  // scoring one match never becomes standing access to a squad.
  scorer: ["fixture.read", "team.read", "news.read", "scoring.start", "scoring.edit", "scoring.finalise", "scoring.correct"],
  official: ["fixture.read", "team.read", "news.read", "officiating.report", "discipline.write"],

  // ── The people the data is about ──
  player: [
    "fixture.read", "team.read", "news.read", "facility.read", "competition.read",
    "player.profile.read", "player.performance.read", "player.development.read",
    "medical.status.read", "transport.read",
  ],
  // A guardian's assignment carries `children`, so every capability here
  // reaches only their own children — including at a different school, which
  // the previous single-school session could not express at all.
  guardian: [
    "fixture.read", "team.read", "news.read", "facility.read", "competition.read",
    "player.profile.read", "player.pii.read", "player.performance.read",
    "medical.status.read", "transport.read", "invoice.read",
  ],

  // ── Read-only observers ──
  // Not in the September 2026 architecture note, which listed neither. Both
  // are retained because the product has a surface for each: an Analytics
  // module, and a public match centre. Flagged for a decision rather than
  // dropped silently — removing them would leave those two screens with no
  // role that can open them.
  analyst: [
    "team.read", "fixture.read", "news.read", "player.profile.read",
    "player.performance.read", "analytics.read", "competition.read",
  ],
  // Deliberately the thinnest bundle in the file. No player profiles, so a
  // spectator never reaches a minor's record even in summary.
  spectator: ["fixture.read", "news.read", "competition.read"],

  // ── Specialists ──
  medical: [
    "team.read", "fixture.read", "news.read", "player.profile.read",
    "medical.status.read", "medical.details.read", "medical.write",
  ],
  finance: ["school.read", "news.read", "invoice.read", "invoice.manage", "user.read"],
  transportcoordinator: ["fixture.read", "team.read", "news.read", "transport.read", "transport.manage"],
  driver: ["news.read", "transport.read", "transport.drive"],
  facilities: ["fixture.read", "news.read", "facility.read", "facility.manage"],
  media: ["fixture.read", "team.read", "news.read", "player.profile.read", "player.performance.read", "news.publish.school", "news.publish.team"],
  scout: ["fixture.read", "team.read", "news.read", "player.profile.read", "player.performance.read", "scouting.read", "scouting.write"],
  competitionadmin: [
    "fixture.read", "fixture.update", "fixture.cancel", "team.read", "news.read",
    "competition.read", "competition.manage", "officiating.assign",
    "discipline.read", "scoring.correct", "news.publish.competition",
  ],
};

export const ROLE_CAPABILITIES = Object.freeze(
  Object.fromEntries(Object.entries(BUNDLES).map(([r, caps]) => [r, Object.freeze([...new Set(caps)])])),
);

export const ROLES = Object.freeze(Object.keys(ROLE_CAPABILITIES));

// Frozen index, so a decision is a Set lookup rather than a linear scan.
const INDEX = Object.freeze(
  Object.fromEntries(Object.entries(ROLE_CAPABILITIES).map(([r, caps]) => [r, new Set(caps)])),
);

/** Does this role name include this capability? Scope is NOT considered here. */
export function roleGrants(role, capability) {
  return INDEX[role]?.has(capability) ?? false;
}

/** Roles that may score, derived rather than listed — canScore's successor. */
export const SCORING_ROLES = Object.freeze(ROLES.filter((r) => roleGrants(r, "scoring.edit")));

/** Every capability named by some role but not defined. Guards typos. */
export function unknownCapabilities() {
  const bad = [];
  for (const [role, caps] of Object.entries(ROLE_CAPABILITIES))
    for (const c of caps) if (!isCapability(c)) bad.push(`${role}: ${c}`);
  return bad;
}

/** Capabilities no role grants — dead weight, or a role still to be written. */
export function ungrantedCapabilities() {
  const granted = new Set(Object.values(ROLE_CAPABILITIES).flat());
  return ALL_CAPABILITIES.filter((c) => !granted.has(c));
}

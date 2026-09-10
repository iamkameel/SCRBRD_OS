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

/**
 * Roles whose assignment MUST name a team.
 *
 * A NULL team_code widens to every team in the school. That is correct for a
 * head of sport and wrong for a coach: a coach reaches a player's medical
 * information because they coach that player's current side — the injury
 * policy derives its team anchor from player.team_code — so a coach assignment
 * with no team is a coach who reads every child at the school.
 *
 * Emitted as a CHECK constraint on role_assignment, so it is enforced by the
 * database rather than by whoever is creating assignments that day.
 */
export const TEAM_SCOPED_ROLES = Object.freeze(["coach", "assistantcoach", "teammanager"]);

/**
 * Roles whose assignment MUST name at least one person.
 *
 * The mirror image of the rule above, and it closes a hole that was open for
 * as long as assignment_subject has existed. An assignment naming nobody is
 * "about nobody in particular", which is correct for a coach — that is how
 * they reach a squad — and catastrophic for a guardian: a guardian row with no
 * subject rows is a parent who reads every child at the school.
 *
 * Not a CHECK constraint, because the fact lives in another table and a row
 * has to exist before its subjects can. It is enforced where it cannot be
 * skipped instead — inside app_can(), which refuses these roles outright when
 * the assignment names nobody. A half-written guardian link therefore grants
 * nothing rather than granting everything.
 */
export const SUBJECT_SCOPED_ROLES = Object.freeze(["guardian", "selfaccess", "enquiry"]);

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
    "platform.feature.manage",
    // Also the school-side one, which sounds like a widening and is the
    // opposite: school.feature.manage can only HIDE, and somebody who may
    // grant a school a module can certainly hide one. Without it the platform
    // account cannot reach the modules screen at all, since that destination
    // is gated on the wider of the two capabilities.
    "school.feature.manage",
    "scouting.accredit",
    "school.read", "user.read", "audit.read", "competition.read", "news.read",
  ],

  // ── Institution leadership ──
  principal: [
    "school.feature.manage",
    ...READ_TEAM, "school.read", "user.read", "analytics.read",
    "competition.read", "discipline.read", "facility.read", "invoice.read",
    "player.performance.read", "medical.status.read", "medical.nature.read", "audit.read",
    "player.age.read", "player.roster.read", "guardian.link.manage",
    "player.note.read", "scoring.amend.approve",
  ],
  directorofsport: [
    ...READ_TEAM, "school.read", "user.read", "user.invite",
    "team.manage", "team.select", "fixture.create", "fixture.update", "fixture.cancel",
    "player.profile.manage", "player.performance.read", "player.development.read",
    "player.note.read", "player.note.write",
    "medical.status.read", "medical.nature.read", "player.age.read", "player.roster.read",
    "discipline.read", "discipline.write",
    "analytics.read", "competition.read", "facility.read", "facility.manage",
    "transport.read", "officiating.assign", "broadcast.publish",
    "sponsorship.read",
    "scoring.start", "scoring.edit", "scoring.finalise", "scoring.correct",
    "scoring.amend.approve",
    "news.publish.team", "news.publish.school", "audit.read",
  ],
  schooladmin: [
    // school.feature.manage: hiding a module from this school or from one of
    // its people. It sits beside school.manage because it is the same job —
    // configuring the institution — and it can only ever take something away.
    "school.feature.manage",
    ...READ_TEAM, "school.read", "school.manage", "user.read", "user.invite", "user.role.assign",
    "team.manage", "fixture.create", "fixture.update", "fixture.cancel",
    "sponsorship.read", "sponsorship.manage",
    "player.profile.manage", "player.pii.read", "player.biometric.read",
    "player.age.read", "player.identity.read", "guardian.link.manage",
    "player.roster.read",
    "medical.status.read", "medical.nature.read",
    "discipline.read", "facility.read", "facility.manage",
    "transport.read", "transport.manage", "invoice.read",
    "competition.read", "news.publish.school", "audit.read",
  ],
  sportsadmin: [
    ...READ_TEAM, "user.read", "team.manage", "team.select",
    "fixture.create", "fixture.update", "fixture.cancel", "officiating.assign",
    "broadcast.publish",
    "player.profile.manage", "medical.status.read", "medical.nature.read", "player.age.read",
    "player.roster.read", "facility.read", "facility.manage", "transport.read", "transport.manage",
    "competition.read", "news.publish.team", "news.publish.school",
    "scoring.start", "scoring.edit", "scoring.finalise",
  ],

  // ── Coaching ──
  //
  // A coach holds the FULL medical record for the side they coach, clinical
  // notes included, at your instruction. The model can express a narrower line
  // — for a long time it drew one, on the reasoning that picking a team needs
  // availability and not a physiotherapist's write-up — and the argument for
  // the wider one is that a school coach IS the person managing a child's load
  // week to week, and making them phone the physio to find out whether a
  // shoulder may bowl is a worse outcome than them reading it.
  //
  // What keeps this safe is scope, not tier. A coach assignment must name a
  // team (assignment_team_scoped), and the injury policy anchors on the
  // player's CURRENT side — so this is the notes for the children they
  // actually coach, this term, and nobody else's. It is not school-wide, and
  // it stops the moment a player changes side.
  coach: [
    ...READ_TEAM, "team.select",
    "player.performance.read", "player.performance.write",
    "player.development.read", "player.development.write",
    "player.note.read", "player.note.write",
    "medical.status.read", "medical.nature.read", "medical.details.read",
    "player.age.read", "player.roster.read",
    "player.access.request", "player.access.grant",
    "analytics.read", "transport.read",
    "scoring.start", "scoring.edit", "scoring.finalise",
    "news.publish.team",
  ],
  assistantcoach: [
    ...READ_TEAM, "player.performance.read", "player.development.read",
    "player.note.read", "player.note.write",
    "medical.status.read", "medical.nature.read", "medical.details.read",
    "player.age.read", "player.roster.read",
    "player.access.request", "player.access.grant",
    "transport.read", "scoring.start", "scoring.edit",
  ],
  teammanager: [
    ...READ_TEAM, "team.select", "medical.status.read", "medical.nature.read",
    "player.age.read", "player.roster.read",
    "transport.read", "news.publish.team",
  ],

  // ── Matchday ──
  // A scorer's assignment is normally narrowed to a single fixture, so
  // scoring one match never becomes standing access to a squad.
  // player.profile.read is not incidental here: match_squad is governed by it,
  // and a scorer who cannot read the squad cannot name a striker. A scorer
  // still holds none of the sensitive splits — no PII, no medical, no
  // discipline — so they see the team sheet and the sporting profile behind it
  // and nothing else about the child.
  scorer: ["fixture.read", "team.read", "news.read", "player.profile.read",
           "scoring.start", "scoring.edit", "scoring.finalise", "scoring.correct"],
  official: ["fixture.read", "team.read", "news.read", "officiating.report", "discipline.write"],

  // ── The people the data is about ──
  // A pupil knows WHO is unavailable and until when — they need that to read a
  // team sheet — and not what is wrong with them. medical.status.read without
  // medical.nature.read is exactly that line: `injury_type` ("Grade 2
  // hamstring strain"), `severity` and `phase` are masked, `rtw_date` and
  // `restricted` are not.
  //
  // It costs a pupil sight of their OWN diagnosis too, because a capability is
  // held at a scope and this model has no way for a player assignment to mean
  // "myself only" — only guardian assignments carry a person list. A pupil
  // learns their diagnosis from the physio rather than from the app, which is
  // the safe side of that limitation to be on.
  player: [
    "fixture.read", "team.read", "news.read", "facility.read", "competition.read",
    "player.profile.read", "player.performance.read", "player.development.read",
    "medical.status.read", "transport.read",
  ],
  // WHAT A GRANTED REQUEST BUYS.
  //
  // When a coach asks another coach about a player and is told yes, the answer
  // is not a note in a workflow table — it is an ASSIGNMENT, with this role, a
  // single named player in assignment_subject, and a valid_until. Everything
  // the model already does then applies: the scope is enforced by the same
  // app_can() as everything else, revocation is immediate, and it expires on
  // its own without anybody remembering to tidy up.
  //
  // The bundle is deliberately two capabilities. The question being answered
  // is "is this boy available on Saturday" — availability and a name — and NOT
  // what is wrong with him, which stays with the coach who actually coaches
  // him. A granted enquiry can never carry medical.nature.read, because the
  // role does not name it and a grant cannot exceed the role it grants.
  enquiry: ["player.profile.read", "medical.status.read"],

  // YOUR OWN FILE.
  //
  // A pupil holds `player` for the things that are about the team — the
  // fixture list, the squad, who is available on Saturday — and that
  // assignment is school- and team-scoped, so it reaches every team mate. It
  // therefore cannot also carry the capabilities that read a medical record,
  // or every pupil would read every other pupil's.
  //
  // So self-access is its OWN assignment, named in assignment_subject as being
  // about exactly one person: the holder. The model's central rule does the
  // rest — a capability held through one assignment is only ever applied
  // within that same assignment's scope — so these capabilities reach that one
  // player row and stop.
  //
  // It carries the clinical notes as well as the nature. A person reading
  // their own health record is not a disclosure; under POPIA it is a data
  // subject exercising a right of access, and a platform that holds a child's
  // physiotherapy notes and will not show them to the child is on the wrong
  // side of that.
  selfaccess: [
    "player.profile.read", "player.pii.read", "player.biometric.read",
    "player.performance.read", "player.development.read",
    "medical.status.read", "medical.nature.read", "medical.details.read",
    "player.age.read", "player.identity.read",
    "discipline.read",
  ],

  // A guardian's assignment carries `children`, so every capability here
  // reaches only their own children — including at a different school, which
  // the previous single-school session could not express at all.
  guardian: [
    "fixture.read", "team.read", "news.read", "facility.read", "competition.read",
    "player.profile.read", "player.pii.read", "player.biometric.read",
    "player.performance.read",
    // Their own children only — the assignment names them. A parent reading
    // their child's physiotherapy report is the ordinary case, not an
    // exception; the school would hand them the same letter.
    "medical.status.read", "medical.nature.read", "medical.details.read",
    "player.age.read", "player.identity.read",
    "transport.read", "invoice.read",
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
    "team.read", "fixture.read", "news.read", "player.profile.read", "player.age.read",
    // Height and weight are clinical inputs — a rehabilitation load is
    // calculated from them.
    "player.biometric.read",
    "medical.status.read", "medical.nature.read", "medical.details.read", "medical.write",
  ],
  finance: ["school.read", "news.read", "invoice.read", "invoice.manage", "user.read",
            "sponsorship.read", "sponsorship.manage", "sponsorship.finance.read"],
  transportcoordinator: ["fixture.read", "team.read", "news.read", "transport.read", "transport.manage"],
  driver: ["news.read", "transport.read", "transport.drive"],
  facilities: ["fixture.read", "news.read", "facility.read", "facility.manage"],
  media: ["fixture.read", "team.read", "news.read", "player.profile.read", "player.performance.read", "news.publish.school", "news.publish.team"],
  // NOT player.profile.read or player.performance.read. Those are scoped to a
  // role_assignment's own school/team — and a scout's assignment is typically
  // school=NULL to reach across schools at all, which is the whole point of
  // the role. Held alongside those two capabilities, a school=NULL scout would
  // read every child's full profile at every school, consent or not: the exact
  // loophole this pairing of capabilities existed to look like it prevented
  // while doing nothing of the kind. What a scout may see instead is
  // scouting_candidates() — name, team, career figures — for players who have
  // been explicitly, individually opted in by a guardian, and only once the
  // scout's OWN accreditation has been verified. See db/08_schema_programme.sql.
  scout: ["fixture.read", "team.read", "news.read", "scouting.read", "scouting.write"],
  competitionadmin: [
    "fixture.read", "fixture.update", "fixture.cancel", "team.read", "news.read",
    "competition.read", "competition.manage", "officiating.assign",
    "discipline.read", "scoring.correct", "scoring.amend.approve",
    "news.publish.competition",
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

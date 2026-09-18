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

import { ALL_CAPABILITIES, isCapability, CAPABILITIES, SENSITIVE } from "./capabilities.mjs";

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
  // ── The owner's key ──
  //
  // EVERY capability, platform-wide. This is the operator's own account, and
  // it is the one role in the model that is not least-privilege: it exists so
  // whoever runs SCRBRD can always reach in, including on the day the model
  // itself is what is broken.
  //
  // Derived from ALL_CAPABILITIES rather than typed out, which is the only
  // part of this that is not a judgement call: a hand-written list of eighty
  // capabilities silently stops being "everything" the first time somebody
  // adds the eighty-second, and a masterkey that quietly lost a key is worse
  // than no masterkey, because nobody finds out until they need it.
  //
  // WHAT THIS COSTS, said plainly rather than left for someone to discover:
  // this role reads every child's medical, disciplinary and PII record at
  // every school on the platform, and nothing records that it did. That is
  // the deliberate difference from `platformadmin` below, which stops at the
  // schoolhouse door and reaches a school's confidential records only through
  // platform.support.impersonate — time-boxed and audited, and since db/22
  // real: support_access_begin() issues one role at one school for an hour,
  // and every read under it is stamped in that school's log. That path is
  // built; this key is what it replaces, and the reason to stop using it.
  superadmin: [...ALL_CAPABILITIES],

  // ── Platform ──
  // Operating the platform is not a licence to read a school's confidential
  // records. Support access to those goes through
  // platform.support.impersonate: support_access_begin() (db/22), one role
  // at one school, sixty minutes by default, four hours at most, ended by
  // the school if it wants, every read under it on the school's record.
  platformadmin: [
    "platform.health.read", "platform.tenant.manage", "platform.support.impersonate",
    "platform.feature.manage",
    "platform.reward.manage",
    // The recovery path needs a key. Without user.role.assign the platform
    // account can see a school that has locked itself out and do nothing about
    // it — see GRANTABLE_ROLES at the foot of this file for why that matters
    // more than the extra surface it adds.
    "user.role.assign",
    // Also the school-side one, which sounds like a widening and is the
    // opposite: school.feature.manage can only HIDE, and somebody who may
    // grant a school a module can certainly hide one. Without it the platform
    // account cannot reach the modules screen at all, since that destination
    // is gated on the wider of the two capabilities.
    "school.feature.manage",
    "scouting.accredit",
    // The officials register is union data, not school data, so it is held
    // platform-wide by construction: app_can() has no wildcard for school, so
    // a school-scoped assignment can never satisfy an untenanted row. The
    // platform holds it for the same reason it holds user.role.assign — a
    // recovery path when a union has nobody able to act.
    "officiating.registry.manage",
    "school.read", "user.read", "audit.read", "competition.read", "news.read",
  ],

  // ── Institution leadership ──
  principal: ["recognition.manage", "player.workload.manage", "clearance.read", "clearance.manage",
    "school.feature.manage",
    // The waiver, and nobody else at a school holds it — see the capability's
    // own note for why it is kept away from the people who place the boards.
    //
    // With sponsorship.manage beside it, because a waiver attaches to the
    // placement it permits: without the ability to write one, the head could
    // authorise a conflicting board and have nowhere to record it. That does
    // put both halves in one pair of hands, and deliberately — the control is
    // not that the signer is powerless, it is that the signature is theirs,
    // in prose, on the row. The office and the director of sport, who are the
    // ones under commercial pressure to place the board, still cannot.
    "sponsorship.exclusivity.waive", "sponsorship.read", "sponsorship.manage",
    // Appointments. A head who cannot appoint a physiotherapist has to ask the
    // platform to do it, which is a support ticket for a routine hire — and
    // GRANTABLE_ROLES below deliberately keeps the clinical and commercial
    // appointments away from the school office, so somebody at the school has
    // to be able to make them. Which roles this reaches is that list's answer,
    // not this line's.
    "user.role.assign",
    ...READ_TEAM, "school.read", "user.read", "analytics.read",
    "competition.read", "discipline.read", "facility.read", "invoice.read",
    "player.performance.read", "medical.status.read", "medical.nature.read", "audit.read",
    "player.age.read", "player.roster.read", "guardian.link.manage",
    "player.note.read", "scoring.amend.approve",
  ],
  directorofsport: ["recognition.manage", "player.workload.read", "player.workload.manage", "clearance.read", "clearance.manage",
    "availability.read", "availability.declare",
    // Same reasoning as the principal above: the person who runs a school's
    // sport appoints its coaching and medical staff. Bounded by
    // GRANTABLE_ROLES, which does not include schooladmin or principal — a
    // director of sport cannot appoint their own supervisor.
    "user.role.assign",
    ...READ_TEAM, "school.read", "user.read", "user.invite",
    "team.manage", "team.select", "fixture.create", "fixture.update", "fixture.cancel",
    "player.profile.manage", "player.performance.read", "player.development.read",
    "player.note.read", "player.note.write",
    "medical.status.read", "medical.nature.read", "player.age.read", "player.roster.read", "player.emergency.read", "player.emergency.manage",
    "discipline.read", "discipline.write",
    "analytics.read", "competition.read", "facility.read", "facility.manage",
    "transport.read", "officiating.assign", "broadcast.publish",
    "sponsorship.read",
    "scoring.start", "scoring.edit", "scoring.finalise", "scoring.correct",
    "scoring.amend.approve",
    "news.publish.team", "news.publish.school", "audit.read",
    "opposition.read",
  ],
  schooladmin: ["recognition.manage", "player.workload.manage", "clearance.read", "clearance.manage",
    "availability.read", "availability.declare",
    // school.feature.manage: hiding a module from this school or from one of
    // its people. It sits beside school.manage because it is the same job —
    // configuring the institution — and it can only ever take something away.
    "school.feature.manage",
    ...READ_TEAM, "school.read", "school.manage", "user.read", "user.invite", "user.role.assign",
    "team.manage", "fixture.create", "fixture.update", "fixture.cancel",
    "sponsorship.read", "sponsorship.manage",
    "player.profile.manage", "player.pii.read", "player.biometric.read",
    "player.age.read", "player.identity.read", "guardian.link.manage",
    "player.roster.read", "player.emergency.read", "player.emergency.manage",
    "medical.status.read", "medical.nature.read",
    "discipline.read", "facility.read", "facility.manage",
    "transport.read", "transport.manage", "invoice.read",
    "competition.read", "news.publish.school", "audit.read",
  ],
  sportsadmin: ["clearance.read",
    "availability.read", "availability.declare",
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
  // ADR 0002 (decided): a coach gets an OVERVIEW, not the full record. He
  // needs to know what the injury is and when the boy is expected back — the
  // nature tier, `injury_type` / `severity` / `phase`, plus `rtw_date` and
  // `restricted` which sit under the status tier below it — because that is
  // what picking a side week to week actually requires. The physio's clinical
  // notes and who is treating the boy (`notes`, `physio` — medical.details.read)
  // do not travel to the touchline; a coach without them still phones the
  // physio for the write-up, which is the safe side to be on. This replaces
  // an earlier, wider grant that held medical.details.read too — see ADR 0002
  // for why it was narrowed and what a coach lost.
  //
  // What keeps the nature tier itself safe is scope, not tier on its own. A
  // coach assignment must name a team (assignment_team_scoped), and the
  // injury policy anchors on the player's CURRENT side — so this is the
  // children they actually coach, this term, and nobody else's. It is not
  // school-wide, and it stops the moment a player changes side.
  coach: ["player.workload.read",
    "availability.read", "availability.declare",
    ...READ_TEAM, "team.select",
    // The kit and the drill library, for his own school. Not the roster or
    // the fixture list — those stay under the capabilities above; this is
    // narrowly what the club calls "running the equipment room and nets".
    "team.manage",
    "player.performance.read", "player.performance.write",
    "player.development.read", "player.development.write",
    "player.note.read", "player.note.write",
    "medical.status.read", "medical.nature.read",
    "player.age.read", "player.roster.read", "player.emergency.read",
    "player.access.request", "player.access.grant",
    "analytics.read", "transport.read",
    "scoring.start", "scoring.edit", "scoring.finalise",
    "news.publish.team", "opposition.read",
  ],
  assistantcoach: ["player.workload.read",
    "availability.read", "availability.declare",
    ...READ_TEAM, "player.performance.read", "player.development.read",
    "player.note.read", "player.note.write",
    "medical.status.read", "medical.nature.read",
    "player.age.read", "player.roster.read", "player.emergency.read",
    "player.access.request", "player.access.grant",
    "transport.read", "scoring.start", "scoring.edit", "opposition.read",
  ],
  teammanager: [
    "availability.read", "availability.declare",
    ...READ_TEAM, "team.select", "medical.status.read", "medical.nature.read",
    "player.age.read", "player.roster.read", "player.emergency.read",
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
  // scoring.amend.request and not scoring.amend.approve: the scorer files the
  // correction to a locked match and somebody else signs it (db/24).
  scorer: ["fixture.read", "team.read", "news.read", "player.profile.read",
           "scoring.start", "scoring.edit", "scoring.finalise", "scoring.correct",
           "scoring.amend.request"],
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
  // THE THINGS ABOUT THE TEAM. Not player.development.read: this role is
  // held across a side, and a boy does not read a team-mate's attribute
  // scores for playing in the same XI. His own come through selfaccess,
  // which names him and nobody else — every pupil holds both, and the
  // client draws his menu from both.
  player: [
    "availability.declare",
    "fixture.read", "team.read", "news.read", "facility.read", "competition.read",
    "player.profile.read", "player.performance.read",
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
  selfaccess: ["player.workload.read",
    "availability.read", "availability.declare",
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
    "availability.read", "availability.declare",
    "fixture.read", "team.read", "news.read", "facility.read", "competition.read",
    "player.profile.read", "player.pii.read", "player.emergency.read", "player.emergency.manage", "player.biometric.read",
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
    // The performance analyst is who the opposition dossier is FOR.
    "opposition.read",
  ],
  // Deliberately the thinnest bundle in the file. No player profiles, so a
  // spectator never reaches a minor's record even in summary.
  spectator: ["fixture.read", "news.read", "competition.read"],

  // ── Specialists ──
  medical: ["player.workload.read",
    "team.read", "fixture.read", "news.read", "player.profile.read", "player.age.read", "player.emergency.read",
    // Height and weight are clinical inputs — a rehabilitation load is
    // calculated from them.
    "player.biometric.read",
    "medical.status.read", "medical.nature.read", "medical.details.read", "medical.write",
  ],
  finance: ["school.read", "news.read", "invoice.read", "invoice.manage", "user.read",
            "sponsorship.read", "sponsorship.manage", "sponsorship.finance.read"],
  transportcoordinator: ["clearance.read", "fixture.read", "team.read", "news.read", "transport.read", "transport.manage", "player.emergency.read"],
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
    // Whoever appoints officials across a league is the one who keeps the
    // panel: accreditation, grade and whether somebody still stands at all.
    "officiating.registry.manage",
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

/**
 * WHICH ROLES EACH GRANTER MAY HAND OUT.
 *
 * user.role.assign says a person may make appointments. It never said WHICH
 * appointments, and that gap was a privilege escalation: a school
 * administrator could appoint themselves `medical` and read their pupils'
 * physiotherapy notes, or appoint themselves `platformadmin` and — because
 * app_holds() did not look at the assignment's tenant — move a platform-wide
 * feature switch. Both were reachable with one INSERT that the policy allowed,
 * because the policy asked only whether they could appoint anybody at all.
 *
 * WHY A LIST AND NOT A RULE. The obvious rule is "a granter cannot grant a
 * capability they do not themselves hold". It was measured before being
 * written, and it is unusable: under it a school administrator could not
 * appoint a COACH, which is the single most common thing they do. A safeguard
 * that stops the platform working is not a safeguard — it is the other half of
 * the failure this is guarding against, where the check is permanently false
 * and the person who could fix it is locked out behind the same check.
 *
 * So the answer is a declaration: explicit, reviewable in one place, and
 * impossible to widen by accident. "Who can appoint a physiotherapist?" is
 * answered by reading this, and changing the answer is a diff somebody sees.
 *
 * THE FLOOR, AND WHY IT IS NOT EMPTY. Nobody may grant a role carrying a
 * platform capability except from a platform-scoped assignment — that is
 * enforced separately, by PLATFORM_ONLY in capabilities.mjs. This list is the
 * tenant-level question sitting on top of it.
 */
export const GRANTABLE_ROLES = Object.freeze({
  // The school office. Appointments that run a school's cricket: coaching
  // staff, team management, the people who score and officiate, pupils and
  // their families.
  //
  // NOT `medical` — a physiotherapist's appointment reaches a child's clinical
  // notes, and the person who signs that off should be the one accountable for
  // clinical access, not the office that manages logins. NOT `finance`, which
  // reaches contract values. NOT `principal` or `directorofsport`, which are
  // appointments a school makes rather than a system administrator. And never
  // `platformadmin`.
  schooladmin: [
    "coach", "assistantcoach", "teammanager", "scorer", "official",
    "player", "guardian", "selfaccess", "spectator", "enquiry",
    "transportcoordinator", "driver", "facilities", "media", "analyst",
  ],

  // Leadership appoints leadership, and the clinical and commercial roles the
  // school office deliberately cannot. A director of sport hiring a
  // physiotherapist is a real appointment made by a real person; a school
  // administrator quietly adding it to their own account is not.
  principal: [
    "directorofsport", "sportsadmin", "schooladmin", "medical", "finance",
    "coach", "assistantcoach", "teammanager", "facilities",
  ],
  directorofsport: [
    "coach", "assistantcoach", "teammanager", "scorer", "official",
    "medical", "player", "analyst", "facilities", "media",
  ],

  // THE RECOVERY PATH, and the reason it exists at all.
  //
  // A platform with no way back in is one bad appointment away from being
  // unreachable — which is exactly how the previous build was lost: its
  // permission check compared role LABELS against stored role CODES, so the
  // check was permanently false, and the only account that could have repaired
  // it was gated behind the same check. Somebody has to be able to reach in
  // from outside a school and fix it, and that somebody is the platform
  // account, holding a tenant-less assignment nobody inside a school can
  // create.
  platformadmin: Object.keys(ROLE_CAPABILITIES).filter((r) => r !== "superadmin"),

  // The owner's key appoints anything, including another owner's key. It is
  // excluded from platformadmin's list above on purpose: a platform account
  // that may grant `superadmin` IS a superadmin, one assignment away, and the
  // distinction between the two roles would be decorative. The first one is
  // seeded directly against the database by whoever owns the deployment.
  superadmin: Object.keys(ROLE_CAPABILITIES),
});

/** May `granter` appoint somebody to `role`? Default deny, as everywhere. */
export function mayGrantRole(granter, role) {
  return (GRANTABLE_ROLES[granter] ?? []).includes(role);
}

/** Roles nobody can appoint. A role that exists and cannot be given is a lockout. */
export function ungrantableRoles() {
  const grantable = new Set(Object.values(GRANTABLE_ROLES).flat());
  return ROLES.filter((r) => !grantable.has(r));
}

// ── What a role may NOT do, and who decides instead ──────────────
//
// SCRBRD-033. Every screen in this product tells a person what they can do.
// Nothing told them where their authority stops, or who to go to when it does,
// and both of those are answerable from the policy without anybody writing
// prose per role.
//
// THE LIST IS DELIBERATELY NOT THE COMPLEMENT. A role holds between two and
// eighty-one capabilities, so "everything you cannot do" runs to seventy-odd
// lines for a scorer and tells them nothing. Two candidate narrowings were
// measured against the real roster before this was written:
//
//   sensitive-not-held      3 to 9 items per role   ← this one
//   held-by-few-roles      11 to 13 items per role, mostly irrelevant
//                          (a coach does not need telling he cannot drive a
//                          minibus or manage an invoice)
//
// The first is small, and it is the boundary that actually matters: the
// capabilities that reach a child's contact details, identity, body, notes or
// clinical record. A coach learning from this screen that the clinical record
// is the medical officer's, the boy's parent's and the boy's own is ADR 0002
// rendered as help rather than as a refusal at the moment he needed it.
//
// The hand-off is derived the same way. Whoever holds the capability IS the
// answer to "then who", so there is no protocol to maintain: change the
// policy and this changes with it.
const HANDOFF_EXCLUDED = new Set(["superadmin", "platformadmin"]);

/**
 * The sensitive capabilities `role` does not hold, each naming who does.
 *
 * @param {string} role
 * @returns {{capability: string, what: string, askInstead: string[]}[]}
 */
export function boundaries(role) {
  const held = new Set(ROLE_CAPABILITIES[role] ?? []);
  return SENSITIVE
    .filter((c) => !held.has(c))
    .map((capability) => ({
      capability,
      what: CAPABILITIES[capability],
      // The break-glass accounts are left out on purpose. "Ask the platform
      // owner" is not advice a coach can act on, and naming them here would
      // make an escalation path out of an account that exists so that nothing
      // is ever truly locked out.
      askInstead: ROLES.filter((r) => !HANDOFF_EXCLUDED.has(r) && r !== role
                                   && ROLE_CAPABILITIES[r].includes(capability)),
    }));
}

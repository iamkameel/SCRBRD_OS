/**
 * SCRBRD — capabilities.
 *
 * A capability is a verb on a resource: "may this person read a player's
 * performance record". It says nothing about WHERE that applies. Where is the
 * assignment's job (see authorize.mjs), and keeping the two apart is the whole
 * point of this model.
 *
 * Why not role names
 * ──────────────────
 * The previous model asked `role === "coach"` and answered with a scope
 * *category* ("team"), never a scope *anchor* (which team). It could not
 * express a person who coaches one team, parents a child in another, and
 * scores a third — and it could not express a guardian with children at two
 * schools at all, because the session carried a single school.
 *
 * Roles still exist, and people still speak in them. They are now names for
 * bundles of capabilities (roles.mjs), and the authorization decision is made
 * on capabilities, so adding a role never silently widens access and renaming
 * one never changes it.
 *
 * Naming: `<domain>.<subject>.<action>`, action last. Where a domain has a
 * safe summary and a sensitive detail, they are separate capabilities —
 * `medical.status.read` (available / unavailable) is not
 * `medical.nature.read` (a hamstring strain) is not `medical.details.read`
 * (the physio's clinical notes). A pupil gets only the first about a team
 * mate; a head of sport the first two; the coach of that child's own side, the
 * child's parent, the child themselves and medical staff get all three.
 *
 * The tiers are what make that expressible. Getting the boundary wrong once —
 * the diagnosis living in the availability tier, so a pupil read it — is what
 * added the middle one, and being able to move a role between tiers without
 * moving a column is what the split buys.
 */

export const CAPABILITIES = {
  // ── Institution & identity ──
  "school.read":                 "See the institution's profile and settings",
  "school.manage":               "Change institution settings",
  "user.read":                   "See people and their roles",
  "user.invite":                 "Invite people",
  "user.role.assign":            "Grant and revoke role assignments",
  "audit.read":                  "Read the audit log",

  // ── Squad & people ──
  "team.read":                   "See teams and squads",
  "team.manage":                 "Create and change teams",
  "team.select":                 "Pick a matchday squad",
  // AVAILABILITY, and deliberately not medical.status.read.
  //
  // Whether a boy is FIT is the physio's judgement. Whether he is AVAILABLE is
  // his family's statement, and a fit boy can be at a funeral. Reusing the
  // medical tier for it would mean either a coach writing into a clinical
  // record or a physio speaking for a family, and both are wrong.
  //
  // The read is narrower than team.read on purpose: "unavailable, family" is a
  // small window into a child's home life, and it belongs to the people
  // picking the side rather than to everyone who can see a team sheet.
  "availability.read":           "See who has said they are available",
  "availability.declare":       "Say whether a player is available for a fixture",
  "player.profile.read":         "See a player's sporting profile",
  "player.profile.manage":       "Change a player's sporting profile",
  // Personal information about a minor: date of birth, guardian, address,
  // height, weight, house. Separate from the profile on purpose.
  "player.pii.read":             "See a player's personal information",
  // NOT part of player.pii.read, and the split is the point. The people who
  // need a parent's number are the ones AROUND the child on a Saturday — the
  // coach on the bus, the team manager, the physio — and none of them holds
  // the child's file, nor should they: an address and an ID number are the
  // office's. Before this, a coach at an away fixture could not reach a
  // parent, because the only number was inside a capability he was rightly
  // refused.
  "player.emergency.read":       "Reach a player's emergency contacts",
  "player.emergency.manage":     "Keep a player's emergency contacts",
  // Whether an adult who works with children has been checked, and when the
  // check runs out. The register names adults, not children, but it states
  // which adults the school has NOT checked, which is not for a coach to read
  // about a colleague — so it is not part of the staff floor.
  // How much a boy has bowled and trained, against the directive for his
  // age, and the breaches on his name. Narrower than player.development.read
  // on purpose: that one is held by the pupil ROLE across a side, and a
  // reading of a team-mate's body is not a thing to hand a fourteen-year-old
  // because he plays in the same XI. The boy reaches his own through
  // self-access; the physio holds it because this is injury prevention.
  "player.workload.read":        "See a player's bowling and training load",
  // Awarding colours and honours, and keeping the caps ledger's starting
  // point. A school decision, not a coach's: honours are read by everyone
  // who reads the roster, and written by the people who sign the board.
  "recognition.manage":          "Award honours and keep the caps ledger",
  "clearance.read":              "See whether an adult's clearances are current",
  "clearance.manage":            "Record and revoke an adult's clearances",
  "player.performance.read":     "See a player's match figures",
  "player.performance.write":    "Record player performance",
  "player.development.read":     "See development notes and skill ratings",
  "player.development.write":    "Write development notes and skill ratings",
  // A COACH'S OWN WRITING ABOUT A CHILD, and narrower than the ratings it sits
  // beside. player.development.read is held by the pupil and by self-access —
  // a boy may read his own attribute scores, which is right. A note is a
  // different kind of record: prose, candid, and often about things the
  // attribute set has no number for. "He has gone quiet since his father
  // started coming to matches" is a legitimate coaching observation, is the
  // reason a rating moved, and is not a sentence to hand a fourteen-year-old
  // through a phone.
  //
  // Held by the coaches of the side a child currently plays for, and by
  // leadership. Not the pupil, not the guardian.
  //
  // THAT ASYMMETRY IS A POLICY DECISION, NOT A TECHNICAL ONE, and it carries a
  // POPIA exposure worth naming: a data subject, or the competent person
  // acting for a minor, generally has a right of access to personal
  // information held about them. A note store that is structurally invisible
  // to both is a store that cannot answer a subject-access request without
  // someone deciding, case by case, to open it. Every read of one is logged
  // for exactly that reason.
  "player.note.read":            "Read a coach's development notes on a player",
  "player.note.write":           "Write development notes on a player",

  // ── Fixtures & scoring ──
  "fixture.read":                "See fixtures",
  "fixture.create":              "Create fixtures",
  "fixture.update":              "Change fixtures",
  "fixture.cancel":              "Postpone or cancel fixtures",
  "scoring.start":               "Claim the scoring token for a match",
  "scoring.edit":                "Append ball events",
  "scoring.finalise":            "Close an innings or lock a match",
  // TWO CAPABILITIES, because the spec asks for an approval and an approval one
  // person can give themselves is a formality. `scoring.correct` is held by the
  // scorer — they are the person who noticed the mistake — and the approval is
  // deliberately not.
  "scoring.correct":             "Request a correction to a completed match",
  "scoring.amend.approve":       "Approve a correction to a completed match",
  "officiating.assign":          "Assign match officials",
  "officiating.report":          "File a match official's report",

  // ── Health ──
  // THREE TIERS, not two. The split used to be availability vs the clinical
  // record, and it put the diagnosis in the wrong half: `injury_type` reads
  // "Grade 2 hamstring strain", and it sat behind medical.status.read, which
  // the `player` bundle holds. A pupil could read what was wrong with a
  // teammate.
  //
  //   status  — is this player available, and until when. What you need to
  //             know that someone is not playing on Saturday.
  //   nature  — WHAT the injury is and how bad. What you need to manage a
  //             squad: bowling loads, selection, return-to-play planning.
  //   details — the clinical record: the physio's notes and who is treating
  //             them. A minor's health information, POPIA-sensitive. Held by
  //             medical staff, the child, their parent, and the coach of the
  //             side that child currently plays for — the last of those by
  //             SCOPE rather than by tier: a coach assignment must name a
  //             team, so it is the notes for the children they actually
  //             coach.
  "medical.status.read":         "See whether a player is available",
  "medical.nature.read":         "See what the injury is and how severe",
  "medical.details.read":        "See diagnosis and clinical notes",
  "medical.write":               "Record injuries, rehab and clearance",

  // ── A minor's identity, split three ways ──
  // These were one capability, player.pii.read, and that was too coarse. Age
  // and identity are different facts with different reasons to be seen:
  //
  //   age      — a coach picking a U13 side MUST know how old a boy is, or
  //              they cannot avoid selecting a fifteen-year-old into it. This
  //              is operational, not administrative.
  //   pii      — contact details, address, guardian, physical measurements.
  //              What a coach does not need to pick a team.
  //   identity — the national ID number. Needed for registration and for a
  //              union's paperwork, and by nobody else. It is the single most
  //              dangerous field about a child in the schema: it is durable,
  //              unique and useful to a fraudster for the rest of their life.
  // The roster: that a child exists, which side they are in, what they play.
  // Deliberately NOT a tier of personal information — it is row visibility, so
  // a coach can find a player in another team to ask about, consider one for a
  // trial, or be told one is ageing out of the band below. What they then see
  // of that child is still decided per column, per row, by the capabilities
  // below.
  "player.roster.read":          "See every player at the school, in outline",
  "player.age.read":             "See a player's date of birth and age",
  // Height and weight. Personal information about a child's body rather than a
  // way to reach them, which is why it is not in the contact group: a strength
  // and conditioning coach needs one and has no business with the other.
  "player.biometric.read":       "See a player's height and weight",
  "player.identity.read":        "See a player's national ID number",

  // ── The link between a child and the adult responsible for them ──
  // POPIA does not let a school process a minor's information on the strength
  // of somebody asserting they are the parent. The link is a record with a
  // state: captured, then VERIFIED by the school against something — a birth
  // certificate, an ID, an admission file — and separately CONSENTED to.
  //
  // One capability, not two, and that is a decision rather than an oversight:
  // capture and verification are different acts and deserve different holders,
  // but WHO verifies is a school's own governance and not something this model
  // should invent. The states are separate, the acts are separate calls, and
  // `verified_by` names a person — so splitting the capability later changes a
  // grant and nothing else.
  "guardian.link.manage":        "Record, verify and end a child's guardian links",

  // ── Asking another coach ──
  // A coach reaches a player through the side they coach. When a player is
  // wanted for a different side — a promotion, or a fill-in on Saturday — the
  // requesting coach has no scope over them and the model correctly says no.
  // These two capabilities are the way that "no" becomes "ask", rather than
  // becoming a reason to widen everybody.
  "player.access.request":       "Ask another coach about one of their players",
  "player.access.grant":         "Decide such a request for your own side",

  // ── Conduct ──
  "discipline.read":             "See disciplinary matters",
  "discipline.write":            "Record and progress disciplinary matters",

  // ── Operations ──
  "transport.read":              "See transport arrangements",
  "transport.manage":            "Plan trips, vehicles and drivers",
  "transport.drive":             "Operate an assigned trip",
  "facility.read":               "See grounds and bookings",
  "facility.manage":             "Manage grounds and bookings",

  // ── Money ──
  "invoice.read":                "See invoices",
  "invoice.manage":              "Raise and reconcile invoices",
  // Sponsorship, split three ways because the three facts have different
  // audiences. A sponsor's name and logo are meant to be seen — that is what
  // the sponsor is paying for. What they PAID is commercially confidential,
  // and a coach who can see a boundary board has no business seeing the
  // contract behind it.
  "sponsorship.read":            "See who is sponsoring what",
  "sponsorship.manage":          "Agree and place sponsorships",
  // Overriding a category exclusivity somebody was sold.
  //
  // Deliberately NOT held by sponsorship.manage. The people who place boards
  // are the people under pressure to place this one, and a promise that the
  // person who wants to break it can also waive is not a promise. beta-2's
  // model called this a school board waiver, which is the right instinct: it
  // belongs to whoever answers for the school, not to whoever runs its
  // commercial diary.
  "sponsorship.exclusivity.waive": "Waive a sponsor's category exclusivity, in writing",
  "sponsorship.finance.read":    "See sponsorship contract values and revenue share",

  // ── Competition ──
  "competition.read":            "See competitions and standings",
  "competition.manage":          "Administer a competition",

  // ── Publishing ──
  "news.read":                   "Read news and headlines",
  "news.publish.team":           "Publish to a team",
  "news.publish.school":         "Publish to an institution",
  "news.publish.competition":    "Publish to a competition",
  // Putting a fixture on a screen the public can watch. Deliberately its own
  // capability and NOT fixture.update: scheduling a match and broadcasting one
  // are different acts with different consequences, and the second one puts
  // children in front of an audience that is not at the ground.
  "broadcast.publish":           "Put a fixture on a public broadcast overlay",

  // ── Analysis ──
  "analytics.read":              "See aggregate analysis",
  // OPPOSITION, which is not scouting. Scouting is talent identification with
  // a guardian's consent and an accredited scout; this is the other thing — a
  // school reading what another school's players did, so its coaches can plan
  // a fixture. The subject never consented and never will, which is why every
  // grant of it is bounded three ways in db/08: to a HEAD-TO-HEAD FIXTURE the
  // reader's team is actually in, to a WINDOW before that fixture opens, and
  // to CRICKET COLUMNS AND AGGREGATES — a name and a record, never a person.
  "opposition.read":             "Read the opposition's playing record ahead of a fixture you are in",
  "scouting.read":               "See scouting reports and watchlists",
  "scouting.write":              "Write scouting reports",

  // ── Platform ──
  // Deliberately narrow. Operating the platform is not a licence to browse
  // a school's medical, disciplinary or family records; support access to
  // those is granted explicitly, time-boxed, and audited.
  "platform.health.read":        "See platform health and error rates",
  "platform.tenant.manage":      "Onboard and configure tenants",
  // A scout account claims an organisation on registration; this is what lets
  // that claim be checked before it means anything. Deliberately separate
  // from scouting.read/write, which the scout role holds for itself — nobody
  // should be able to verify their OWN accreditation.
  "scouting.accredit":           "Verify or suspend a scout's accreditation",
  "platform.support.impersonate":"Time-boxed, audited support access",
  // Turn a product feature on or off across the platform. Separate from
  // tenant.manage because it is not a claim about any tenant: it says what the
  // product currently offers anybody. DRS is the first of these — the review
  // panel is built, and stays off until there is ball-tracking to feed it.
  "platform.feature.manage":     "Enable or disable a product feature platform-wide",
  // The coefficients of the rewards algorithm. A PLATFORM capability and not a
  // school one, because the algorithm is the platform's and the same everywhere
  // — a school that could set its own weights could inflate its own boys'
  // standing in a comparison that spans schools, which is the one thing the
  // figure is for.
  "platform.reward.manage":      "Set the coefficients of the rewards algorithm",
  // Turn a module off for this school, or for one person at it.
  //
  // ONE DIRECTION ONLY, and the constraint is structural rather than written
  // down here: the table this capability writes (feature_suppression) has no
  // column that could mean "on". So a school administrator can hide Analytics
  // from a coach and cannot grant themselves a module the platform did not
  // grant them, whatever a future edit to a policy might allow.
  //
  // Not an authorization capability despite how it reads. Suppressing a module
  // removes information from somebody who was already entitled to it; it can
  // never hand anybody a row they could not already read.
  "school.feature.manage":       "Turn a module off for this school, or for one of its people",
};

/**
 * Capabilities that belong to NO TENANT, and may only be held through an
 * assignment that belongs to no tenant either.
 *
 * THIS EXISTS BECAUSE OF A REAL ESCALATION, found by probing rather than by
 * reading. app_holds() answers "does this person hold this capability
 * anywhere", with the scope arms deliberately removed — which is correct for a
 * decision that has no tenant to compare against. What it did not do was ask
 * whether the ASSIGNMENT carrying the capability had a tenant. So a school
 * administrator, who holds user.role.assign at their own school, could insert
 * one row:
 *
 *     role_assignment(themselves, 'platformadmin', school_id = their school)
 *
 * and app_holds('platform.feature.manage') then returned true, because it
 * never looked at school_id. From there they could unlock a feature the
 * platform had locked, across every school on the platform.
 *
 * A platform capability held through a school-scoped assignment is a
 * contradiction: the assignment says "at this school" and the capability says
 * "there is no school". Naming them here makes app_holds() refuse that
 * combination, which closes the amplifier at its source rather than at each of
 * the eight call sites.
 *
 * scouting.write is deliberately NOT here even though it goes through
 * app_holds: a scout IS attached to a school, and requiring a tenant-less
 * assignment would stop scouting working entirely. The test is whether the
 * DECISION has a tenant, not whether the call site is convenient.
 */
export const PLATFORM_ONLY = Object.freeze([
  "platform.health.read",
  "platform.tenant.manage",
  "platform.support.impersonate",
  "platform.feature.manage",
  // Accrediting an external scouting organisation is not a claim about any one
  // school's roster — see scout_accreditation_decide() in db/08.
  "scouting.accredit",
  // Same test applied: "what is the growth coefficient" has no tenant in it.
  "platform.reward.manage",
]);

export const ALL_CAPABILITIES = Object.freeze(Object.keys(CAPABILITIES));

/** Capabilities that expose a minor's sensitive information. */
export const SENSITIVE = Object.freeze([
  "player.note.read",
  "player.pii.read",
  // An adult's name and number, tied to a named minor. Logged like the rest.
  "player.emergency.read",
  "player.biometric.read",
  // The ID number of a minor. More sensitive than anything else here: a
  // diagnosis heals, an address changes, a South African ID number is issued
  // once and is useful to a fraudster for the rest of that child's life.
  "player.identity.read",
  // The nature of a minor's injury is health information about a child, so it
  // belongs here even though it is a tier below the clinical notes.
  "medical.nature.read",
  "medical.details.read",
  "discipline.read",
  "discipline.write",
]);

export const isCapability = (c) => Object.hasOwn(CAPABILITIES, c);

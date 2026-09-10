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
  "player.profile.read":         "See a player's sporting profile",
  "player.profile.manage":       "Change a player's sporting profile",
  // Personal information about a minor: date of birth, guardian, address,
  // height, weight, house. Separate from the profile on purpose.
  "player.pii.read":             "See a player's personal information",
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
};

export const ALL_CAPABILITIES = Object.freeze(Object.keys(CAPABILITIES));

/** Capabilities that expose a minor's sensitive information. */
export const SENSITIVE = Object.freeze([
  "player.note.read",
  "player.pii.read",
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

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

  // ── Fixtures & scoring ──
  "fixture.read":                "See fixtures",
  "fixture.create":              "Create fixtures",
  "fixture.update":              "Change fixtures",
  "fixture.cancel":              "Postpone or cancel fixtures",
  "scoring.start":               "Claim the scoring token for a match",
  "scoring.edit":                "Append ball events",
  "scoring.finalise":            "Close an innings or lock a match",
  "scoring.correct":             "Submit or approve a scoring correction",
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

  // ── Competition ──
  "competition.read":            "See competitions and standings",
  "competition.manage":          "Administer a competition",

  // ── Publishing ──
  "news.read":                   "Read news and headlines",
  "news.publish.team":           "Publish to a team",
  "news.publish.school":         "Publish to an institution",
  "news.publish.competition":    "Publish to a competition",

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
  "platform.support.impersonate":"Time-boxed, audited support access",
};

export const ALL_CAPABILITIES = Object.freeze(Object.keys(CAPABILITIES));

/** Capabilities that expose a minor's sensitive information. */
export const SENSITIVE = Object.freeze([
  "player.pii.read",
  // The nature of a minor's injury is health information about a child, so it
  // belongs here even though it is a tier below the clinical notes.
  "medical.nature.read",
  "medical.details.read",
  "discipline.read",
  "discipline.write",
]);

export const isCapability = (c) => Object.hasOwn(CAPABILITIES, c);

/**
 * SCRBRD — physical tables, and the capabilities that govern them.
 *
 * This is the bridge between the abstract model (capabilities.mjs,
 * roles.mjs, authorize.mjs) and the database. It says, for each table that
 * carries security weight:
 *
 *   - which capability governs reading and writing it
 *   - how a row's scope anchors resolve (school / team / person / fixture)
 *   - which columns are masked, and behind which capability
 *
 * Both surfaces are generated from here: the SQL policies in
 * db/02_rls_policies.sql, and the client read layer. They cannot drift,
 * because there is one definition.
 *
 * On masking: a masked column is gated by its OWN capability, evaluated per
 * row. That is stronger than the previous model, where masking was decided
 * once per role for the whole query. A physio sees clinical notes for players
 * their assignment covers and nothing outside it, from the same view, without
 * the application choosing which view to read.
 */

/**
 * A NOTE ON DERIVED ANCHORS, because it is load-bearing and not obvious.
 *
 * Several tables here resolve a scope anchor through a subquery — an injury's
 * team comes from `(SELECT p.team_code FROM player p WHERE p.id = …)`, and a
 * skill assessment's school likewise. Those subqueries run inside a row-level
 * policy, and they are THEMSELVES subject to row-level security on the table
 * they read.
 *
 * So when the caller cannot read the anchor's source row, the subquery yields
 * NULL — and a NULL on a resource narrows. The effect is defence in depth that
 * fails closed: a 1XI coach is kept out of a U16B player's assessment twice
 * over, once because the team anchor does not match and once because they
 * cannot read the player row the anchor is derived from, so it never resolves
 * at all.
 *
 * Worth knowing when reading a falsification that does not fail. Widening the
 * team anchor on player_skill alone leaves the refusal intact, because the
 * player policy is still making the anchor NULL; both have to be widened
 * before the write goes through. That is the correct behaviour and a confusing
 * afternoon if you do not expect it.
 */
export const TABLES = {
  // ── Tenancy and directory ────────────────────────────────────────────
  school: {
    // A tenant list. Nothing in here is confidential on its own — a school's
    // name and province are public — but with RLS off the table answered
    // "who else uses SCRBRD?" to anyone with a login, which is a commercial
    // disclosure the platform has no business making.
    read:  "school.read",
    write: "school.manage",
    // No team, person or fixture key: a school is not about any of them.
    anchors: { school: "id" },
    // Everyone attached to a school can see that school, whether or not they
    // hold school.read: a guardian needs their child's school to have a name.
    // Scoped to the assignments the person actually holds.
    visibleWhen: `EXISTS (SELECT 1 FROM role_assignment a
                           WHERE a.person_id = app_user_id() AND a.active
                             AND (a.school_id IS NULL OR a.school_id = school.id))`,
    masked: {},
  },

  app_user: {
    // Names and email addresses for every person on the platform, minors
    // included. With RLS off this was a cross-tenant directory: one login and
    // the whole user table, every school.
    read:  "user.read",
    write: "user.role.assign",
    anchors: { school: "school_id", team: null, person: "id" },
    // You can always read yourself. Without this the session profile route
    // could not fetch the signed-in person's own name, because user.read is a
    // leadership capability and most people do not hold it.
    visibleWhen: "id = app_user_id()",
    masked: {},
  },

  player: {
    read:  "player.profile.read",
    write: "player.profile.manage",
    anchors: { school: "school_id", team: "team_code", person: "id" },
    // The roster. A named exception that widens WHICH ROWS a coach sees, from
    // their own squad to every child at the school — and nothing about which
    // columns, which the mask groups below still decide per row.
    //
    // Without it a coach cannot find a player in another side to ask about,
    // cannot consider one for a trial, and cannot be told that a boy is about
    // to age out of the band below them. The access-request workflow in
    // particular had no starting point: you cannot request access to someone
    // you cannot see exists.
    visibleWhen: `app_can('player.roster.read', player.school_id, '*'::text,
                          '00000000-0000-0000-0000-000000000000'::uuid,
                          '00000000-0000-0000-0000-000000000000'::uuid)`,
    // A minor's personal information, in three tiers rather than one.
    //
    // `born` used to sit with the contact details, which meant a coach could
    // not see how old a boy was — and a coach picking a U13 side who cannot
    // see an age cannot avoid selecting a fifteen-year-old into it. Age is
    // operational information for anyone who selects a team, so it has its own
    // capability and the people who pick sides hold it.
    //
    // The ID number is the opposite direction. It is the most dangerous field
    // about a child anywhere in this schema — issued once, never changed, and
    // useful to a fraudster for the rest of their life — and it is needed for
    // registration and a union's paperwork by nobody but the school office. A
    // coach does not see it.
    // A ROSTER, and the reason the two mask groups exist.
    //
    // Every coach at the school can see that a child exists, which team they
    // are in, what they play and how old they are. That is what a coach needs
    // to find a player to ask about, to consider one for a trial, and to avoid
    // putting a fifteen-year-old in a U13 side.
    //
    // Everything else stays with the side that boy actually plays for. The
    // difference is not a second table or a second query — it is the TEAM
    // anchor on the mask: `masked` compares the row's team to the reader's
    // assignment, `maskedAnyTeam` does not.
    maskedAnyTeam: {
      // Age is the roster tier: needed school-wide by anyone who selects or
      // trials, which under the eligibility rules is every coach.
      "player.age.read": ["born"],
    },
    masked: {
      // The ID number never widens, not even for the school office's own
      // coaches. It is anchored like everything else and held by almost
      // nobody.
      "player.identity.read": ["id_number"],
      // Contact and household. What a coach does not need to pick a team.
      "player.pii.read": [
        "email", "phone", "hometown", "houseatschool", "address", "guardian",
      ],
      // Height and weight, split out of the contact group. They are personal
      // information about a child's body rather than a way to reach them, and
      // the two were only ever together because one role denied them as a raw
      // list. A role that needs a bowler's height for load management does not
      // thereby need his home address.
      "player.biometric.read": ["height", "weight"],
    },
  },

  coach: {
    read:  "user.read",
    write: "user.role.assign",
    anchors: { school: "school_id", team: "team_code", person: "id" },
    masked: { "player.pii.read": ["email", "phone", "born", "hometown", "address"] },
  },

  staff: {
    // Staff carry no team anchor, so a team-scoped assignment reaches none of
    // them — a coach does not get a staff directory by virtue of coaching.
    read:  "user.read",
    write: "user.role.assign",
    anchors: { school: "school_id", team: null, person: "id" },
    masked: { "player.pii.read": ["email", "phone", "born", "hometown", "address"] },
  },

  injury: {
    // Reading an injury row is reading AVAILABILITY — that a player is out,
    // and until when. This split is the reason a coach can pick a side without
    // reading a child's clinical record.
    //
    // The split used to be two-way, and the boundary was in the wrong place.
    // `injury_type` reads "Grade 2 hamstring strain" — it IS the diagnosis —
    // and it sat unmasked behind medical.status.read, which the `player`
    // bundle holds. A pupil could read what was wrong with a teammate. Only
    // `notes` and `physio` were protected, so the tier that was supposed to
    // separate availability from clinical information was letting the clinical
    // fact through in a column called "type".
    //
    // Three tiers now. Unmasked here is availability alone: date_injured,
    // rtw_date and restricted — that someone is out, and until when.
    read:  "medical.status.read",
    write: "medical.write",
    anchors: {
      school: "school_id",
      team:   "(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)",
      person: "player_id",
    },
    masked: {
      // WHAT the injury is and how bad. Needed to manage a squad — bowling
      // loads, selection, return-to-play — so everyone who picks or manages a
      // side holds it, and a guardian holds it for their own children. A pupil
      // does not.
      "medical.nature.read": ["injury_type", "severity", "phase"],
      // The clinical record itself. A minor's health information. Medical
      // staff, the child, their parent, and the coach of the side that child
      // currently plays for — the last by scope: a coach assignment must name
      // a team and the anchors below resolve through the player, so a coach
      // reads the notes for their own squad and nobody else's.
      "medical.details.read": ["notes", "physio"],
    },
  },

  match: {
    read:  "fixture.read",
    write: "fixture.update",
    anchors: { school: "school_id", team: "team_code", fixture: "id" },
    masked: {},
  },

  ground: {
    // Where a fixture is played. Not sensitive — it is on the team sheet —
    // but it was one of four tables sitting with RLS switched off, which is a
    // different thing from a table deliberately open. facility.read is in the
    // floor bundle, so everyone attached to the school still sees it.
    read:  "facility.read",
    write: "facility.manage",
    anchors: { school: "school_id" },
    masked: {},
  },

  match_squad: {
    // The team sheet: which named minors are in which match squad. Reading it
    // is reading a list of children, and it had no policy at all.
    //
    // Governed by player.profile.read rather than fixture.read, because that
    // is what it is: a roster of identified minors, not a fixture detail. The
    // difference is a spectator, who holds fixture.read and should see the
    // score without also receiving a list of children by name and school.
    //
    // Every anchor is derived from the match, because the row itself carries
    // no school or team column. Deriving them is not optional under the
    // asymmetric NULL rule — a resource that does not state its school is
    // covered by no school-scoped assignment, so leaving them NULL would deny
    // everyone rather than fail open, and the squad would simply never load.
    read:  "player.profile.read",
    write: "team.select",
    anchors: {
      school:  "(SELECT m.school_id FROM match m WHERE m.id = match_squad.match_id)",
      team:    "(SELECT m.team_code FROM match m WHERE m.id = match_squad.match_id)",
      person:  "player_id",
      fixture: "match_id",
    },
    masked: {},
  },

  competition: {
    // Previously ungoverned: `competitions` sat in NON_TABLE, so no policy was
    // generated and the read path carried no predicate — any authenticated
    // principal could read every institution's competitions.
    //
    // The modelling limit noted here — that a competition was readable only by
    // the school that created the row, so a genuinely shared league had to be
    // created platform-scoped with school_id NULL — is closed by
    // competition_entrant below. Visibility now derives from PARTICIPATION:
    // you can read a league you have a team in, evaluated in YOUR scope, not
    // the organiser's. The exception is written as a capability check rather
    // than bare existence, so entering a competition does not hand a person
    // who holds no competition.read a competition they could not otherwise
    // see — participation decides WHICH leagues are in reach, never WHETHER
    // the person may read leagues at all.
    read:  "competition.read",
    write: "competition.manage",
    anchors: { school: "school_id" },
    visibleWhen: "competition_visible(competition.id)",
    masked: {},
  },

  competition_entrant: {
    // Who is IN a league, and their standing in it. One row per team per
    // competition; the log table the League screen's ladder is derived from.
    //
    // Read and write part company here, and that is the point of the table.
    //
    // WRITING a ladder row is a tenant act: only Westville may edit Westville's
    // record, so the capability check is anchored to the row's own school.
    // READING one is not — a log with one row in it is not a log. So the read
    // side ORs in competition_visible(), which asks whether this person can
    // reach the COMPETITION, through the organiser or through any entrant.
    //
    // Safe because a ladder row carries nothing personal: a school, a team
    // code, and a points total. The row that WOULD be sensitive — the squad
    // that played — is in match_squad behind player.profile.read.
    read:  "competition.read",
    write: "competition.manage",
    visibleWhen: "competition_visible(competition_entrant.competition_id)",
    anchors: { school: "school_id", team: "(COALESCE(competition_entrant.team_code, '*'::text))" },
    masked: {},
  },

  training_session: {
    // A scheduled session: when, where, which team, run by whom. Not personal
    // data — it is on the noticeboard — which is why it is governed by
    // team.read and separated from the attendance register below.
    //
    // The split matters. Merging the two would mean a parent could not learn
    // that training moved to 06:30 without also being handed a list of every
    // child who attended, and a coach could not see the schedule for a team
    // they cover without the same. It is the same shape as injury: the
    // AVAILABILITY fact is widely readable, the roster of named minors is not.
    read:  "team.read",
    write: "team.manage",
    anchors: { school: "school_id", team: "team_code" },
    masked: {},
  },

  training_attendance: {
    // The register: which named minors were at which session. Reading it is
    // reading a list of children, so it is governed by player.profile.read —
    // not by team.read, which a spectator-adjacent role can hold.
    //
    // Anchors are derived from the session, because the row carries no school
    // or team column of its own. Deriving them is not optional under the
    // asymmetric NULL rule: a resource that does not state its school is
    // covered by no school-scoped assignment, so leaving them NULL would deny
    // everyone rather than fail open. Same reasoning as match_squad.
    read:  "player.profile.read",
    write: "team.manage",
    anchors: {
      school: "(SELECT t.school_id FROM training_session t WHERE t.id = training_attendance.session_id)",
      team:   "(SELECT t.team_code FROM training_session t WHERE t.id = training_attendance.session_id)",
      person: "player_id",
    },
    masked: {},
  },

  development_note: {
    // A coach's own writing about a child, and narrower than the ratings it
    // sits beside. player_skill is readable by the pupil — a boy may read his
    // own attribute scores, which is right. A note is a different record:
    // prose, candid, and frequently about things the attribute set has no
    // number for. It is held by the coaches of the side that child CURRENTLY
    // plays for, and by leadership, and by nobody else.
    //
    // Anchors resolve through the player, exactly as the assessments and the
    // injury record do, so a team-scoped coach reaches their own squad's notes
    // and stops there. A coach who loses the side loses the notes with it.
    read:  "player.note.read",
    write: "player.note.write",
    anchors: {
      school: "school_id",
      team:   "(SELECT p.team_code FROM player p WHERE p.id = development_note.player_id)",
      person: "player_id",
    },
  },

  player_skill: {
    // Development assessments — a coach's numeric judgement of a named child.
    // Governed by its own capability, player.development.read, which neither
    // spectator nor guardian holds: a parent reads their child's PROFILE and
    // their availability, and a coaching assessment of their technique is not
    // a document the platform hands over without the school choosing to.
    //
    // Anchors resolve through the player, so a team-scoped coach reaches their
    // own squad's assessments and no further.
    read:  "player.development.read",
    write: "player.development.write",
    anchors: {
      school: "(SELECT p.school_id FROM player p WHERE p.id = player_skill.player_id)",
      team:   "(SELECT p.team_code FROM player p WHERE p.id = player_skill.player_id)",
      person: "player_id",
    },
    masked: {},
  },

  notification: {
    // A notice, and the single hardest table in the schema to get right.
    //
    // The rule it exists to enforce: a notification can REDUCE what someone
    // receives and must never EXPAND what they may know. A notice whose body
    // reads "Theo Pretorius cleared for light training" is a medical
    // disclosure wearing a bell icon, and news.read is a floor capability that
    // very nearly everyone holds. Governing this table by news.read alone
    // would mean the notification feed became a side channel around every
    // other policy in this file — the exact thing the architecture note
    // forbids when it says a school administrator cannot grant themselves
    // notification access to information they cannot reach through RBAC.
    //
    // So each row DECLARES the capability its subject matter requires, and the
    // read policy demands BOTH: news.read to receive notices at all, AND the
    // row's own capability, evaluated in the SAME scope. A medical notice
    // needs medical.status.read; a fixture notice needs fixture.read; a
    // general one names news.read and adds nothing. required_capability is a
    // foreign key onto the generated capability catalogue, so a typo cannot
    // silently become a notice nobody can read.
    //
    // Publishing is scope-shaped for the same reason: the write capability is
    // derived from the row's own scope_level, so news.publish.team lets a
    // coach post to their team and does not let them post to the school.
    read:  "news.read",
    readAlso: "(notification.required_capability)",
    write: "('news.publish.' || notification.scope_level)",
    // A school-wide notice carries no team, and a NULL team narrows — which
    // would hide every school notice from every team-scoped coach. It is
    // ANY_SCOPE, declared, because a school notice genuinely is not about one
    // team.
    // A school-wide notice carries no team, and a notice about nobody in
    // particular carries no person. Both are COALESCE'd to ANY_SCOPE rather
    // than passed as NULL, because a NULL on a resource NARROWS — a school
    // notice with a null team would be invisible to every team-scoped coach.
    //
    // The person anchor is what keeps an injury alert from reaching a guardian
    // scoped to a different child: with it, their subject list has something
    // to fail against.
    anchors: {
      school: "school_id",
      team:   "(COALESCE(notification.team_code, '*'::text))",
      person: "(COALESCE(notification.subject_person_id, '00000000-0000-0000-0000-000000000000'::uuid))",
    },
    masked: {},
  },

  match_toss: {
    // Who won the toss and what they chose.
    //
    // This declaration is the fix for a real bug. The toss shipped with its
    // policies HAND-WRITTEN into db/09_rls_policies.sql — a generated file
    // whose header says not to — and they survived exactly as long as nobody
    // ran `pnpm rls:generate`. The first regeneration silently dropped row
    // security from match_toss altogether. Nothing but the "every table has
    // row security on" assertion in smoke-toss would have noticed.
    //
    // Read is fixture.read because a toss is announced: everyone who can see
    // the fixture can see who won it, parents on the boundary included.
    // Writing is scoring.start — the capability held by whoever opens the
    // match, which is the person standing there when the coin lands. It is
    // deliberately NOT fixture.update: that is for rescheduling and renaming
    // fixtures, and a scorer neither holds it nor should.
    read:  "fixture.read",
    write: "scoring.start",
    anchors: {
      school:  "(SELECT m.school_id FROM match m WHERE m.id = match_toss.match_id)",
      team:    "(SELECT m.team_code FROM match m WHERE m.id = match_toss.match_id)",
      fixture: "match_id",
    },
    masked: {},
  },

  derby: {
    // The NAME of a rivalry, not its record — the tally is derived. Read by
    // anyone who can read a fixture, since a derby's name is the least private
    // thing a school owns: it is on the blazer. Written under fixture.update,
    // the capability of the people who schedule and manage fixtures, because
    // naming the annual match against Michaelhouse is fixture administration
    // and not a competition-wide or platform decision.
    read:  "fixture.read",
    write: "fixture.update",
    anchors: { school: "school_id" },
    masked: {},
  },

  ground_condition: {
    // The groundsman's own record. facility.manage to write — the person who
    // rolled the square is the one who can describe it, the same reasoning as
    // the pitch report — and facility.read to see it, which is in the floor
    // bundle: a captain deciding whether to bring spinners, and a parent
    // asking whether Saturday will drain in time, both legitimately want it.
    //
    // Anchored through the ground rather than on its own school_id, though
    // that column exists and is NOT NULL. The column makes a write against a
    // ground that is not there fail loudly; the subquery is what the predicate
    // uses, because a denormalised anchor can drift from the row it claims and
    // an RLS predicate must not be able to.
    read:  "facility.read",
    write: "facility.manage",
    anchors: {
      school: "(SELECT g.school_id FROM ground g WHERE g.id = ground_condition.ground_id)",
    },
    masked: {},
  },

  match_official: {
    // Who is standing. Read by anyone who can read the fixture: the umpires'
    // names are announced at the toss, printed on the scorecard and known to
    // both sides — treating them as confidential would be a fiction, and the
    // fixture scope already decides who may know the match exists at all.
    //
    // Written under officiating.assign, which three roles already hold and
    // none could exercise until this table existed. Deliberately NOT
    // fixture.update: appointing officials and rescheduling a fixture are
    // different jobs, and a competition administrator who appoints panels
    // across a league should not thereby be able to move other schools'
    // matches.
    //
    // An official cannot appoint themselves — `official` carries
    // officiating.report, not officiating.assign. Same reasoning as the pitch
    // report above: closing that gap by widening either capability would hand
    // one job to the holders of the other.
    read:  "fixture.read",
    write: "officiating.assign",
    anchors: {
      school:  "(SELECT m.school_id FROM match m WHERE m.id = match_official.match_id)",
      team:    "(SELECT m.team_code FROM match m WHERE m.id = match_official.match_id)",
      fixture: "match_id",
    },
    masked: {},
  },

  match_pitch_report: {
    // The state of the square before play. Read by anyone who can read the
    // fixture — captains and coaches need it before the toss, and it discloses
    // nothing about a person. Written under facility.manage, which is the
    // grounds staff's capability: the groundsman prepared the pitch and is the
    // one who can describe it.
    //
    // An umpire cannot file one. `official` carries officiating.report, not
    // facility.manage, and widening either capability to close that gap would
    // hand grounds management to officials or officiating to groundsmen. If
    // umpires should file pitch reports, that is a third capability and a
    // deliberate decision, not a quiet edit here.
    //
    // The school anchor is a subquery on the match, not the row's own
    // school_id, even though that column exists and is NOT NULL. The column is
    // there to make a write against a non-existent match fail loudly; the
    // subquery is there because a denormalised anchor can drift from the match
    // it claims and an RLS predicate must not be able to.
    read:  "fixture.read",
    write: "facility.manage",
    anchors: {
      school:  "(SELECT m.school_id FROM match m WHERE m.id = match_pitch_report.match_id)",
      team:    "(SELECT m.team_code FROM match m WHERE m.id = match_pitch_report.match_id)",
      fixture: "match_id",
    },
    masked: {},
  },

  match_weather: {
    // Conditions at a fixture. Carries nothing personal, but it is keyed to a
    // match and must not be readable by someone who cannot read the match —
    // otherwise the weather table quietly answers "does this school have a
    // fixture on Saturday?" to anyone who asks. Anchors derive from the match,
    // exactly as the fixture's own policy computes them.
    read:  "fixture.read",
    write: "fixture.update",
    anchors: {
      school:  "(SELECT m.school_id FROM match m WHERE m.id = match_weather.match_id)",
      team:    "(SELECT m.team_code FROM match m WHERE m.id = match_weather.match_id)",
      fixture: "match_id",
    },
    masked: {},
  },
};

/**
 * Every masked column on a table, whichever group it is in.
 *
 * Two groups exist because the TEAM anchor differs — `masked` compares the
 * row's team to the reader's assignment, `maskedAnyTeam` does not — and that
 * distinction matters only to whoever is building the app_can() call. To
 * everybody else, "which columns are masked and behind what" is one question
 * with one answer, and asking it in two places is how the client and the
 * database came to disagree about `born` the moment the second group appeared.
 */
export function maskedColumns(def) {
  const out = {};
  for (const src of [def?.masked ?? {}, def?.maskedAnyTeam ?? {}])
    for (const [cap, cols] of Object.entries(src)) out[cap] = [...(out[cap] ?? []), ...cols];
  return out;
}

/** Tables whose rows a given capability can mask columns on. */
export const MASKED_TABLES = Object.entries(TABLES)
  .filter(([, def]) => Object.keys(def.masked ?? {}).length
                    || Object.keys(def.maskedAnyTeam ?? {}).length)
  .map(([t]) => t);

/** Every capability referenced here, for cross-checking against roles.mjs. */
/**
 * A capability slot is either a literal name or a SQL expression computing one
 * at row level (written parenthesised, the same convention the anchors use).
 * Only literals can be cross-checked against roles.mjs — an expression names
 * whatever the row says, which is the point of it.
 */
export const isCapabilityExpression = (c) => typeof c === "string" && c.startsWith("(");

/** Every capability NAMED here, for cross-checking against roles.mjs. */
export function referencedCapabilities() {
  const out = new Set();
  const add = (c) => { if (c && !isCapabilityExpression(c)) out.add(c); };
  for (const def of Object.values(TABLES)) {
    add(def.read);
    add(def.readAlso);
    add(def.write);
    for (const c of Object.keys(def.masked ?? {})) out.add(c);
    for (const c of Object.keys(def.maskedAnyTeam ?? {})) out.add(c);
  }
  return [...out].sort();
}

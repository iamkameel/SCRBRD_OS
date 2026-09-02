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
    // A minor's personal information. A coach reads the sporting profile and
    // none of this; a guardian reads it for their own children only, because
    // their assignment's scope reaches no further.
    masked: {
      "player.pii.read": [
        "email", "phone", "born", "hometown", "houseatschool",
        "address", "guardian", "height", "weight",
      ],
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
    // and until when. The diagnosis lives behind medical.details.read and is
    // masked below. This split is the reason a coach can pick a side without
    // reading a child's clinical record.
    read:  "medical.status.read",
    write: "medical.write",
    anchors: {
      school: "school_id",
      team:   "(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)",
      person: "player_id",
    },
    masked: { "medical.details.read": ["notes", "physio"] },
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
    // It is governed now, but note the modelling limit: a competition organised
    // by one school is readable by that school. A genuinely shared league (a
    // KZN schools competition spanning several clients) needs a
    // competition_entrant join table so visibility derives from participation
    // rather than from who created the row. Until that exists, a shared league
    // must be created with school_id NULL, which makes it platform-scoped.
    read:  "competition.read",
    write: "competition.manage",
    anchors: { school: "school_id" },
    masked: {},
  },
};

/** Tables whose rows a given capability can mask columns on. */
export const MASKED_TABLES = Object.entries(TABLES)
  .filter(([, def]) => Object.keys(def.masked ?? {}).length)
  .map(([t]) => t);

/** Every capability referenced here, for cross-checking against roles.mjs. */
export function referencedCapabilities() {
  const out = new Set();
  for (const def of Object.values(TABLES)) {
    if (def.read) out.add(def.read);
    if (def.write) out.add(def.write);
    for (const c of Object.keys(def.masked ?? {})) out.add(c);
  }
  return [...out].sort();
}

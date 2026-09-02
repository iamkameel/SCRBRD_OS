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
    anchors: { school: "school_id", team: null },
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

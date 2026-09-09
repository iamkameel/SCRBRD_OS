-- ════════════════════════════════════════════════════════════════
--  SCRBRD — Core schema
--
--  The institution, its people, and its fixtures. Everything the
--  scoring migrations reference by foreign key, and every table the
--  generated RLS policies in 02 attach to.
--
--  Apply first: 00 → 01 → 02 → 03, then 99 to verify.
--
--  POPIA note: nearly every data subject here is a MINOR. The columns
--  carrying personal information are exactly those named in
--  RESOURCE_TABLES.columns in packages/policy/src/policy.mjs, and they
--  are reachable only through the generated *_masked views. Add a
--  sensitive column here and you must add it there, or it will be
--  served unmasked.
-- ════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ── Institution ─────────────────────────────────────────────────
-- "Institution" is the defined term covering schools, clubs, academies,
-- unions, federations, leagues and associations. The table is named
-- `school` because every RLS policy scopes through it, and each references it by
-- that name; the `kind` column carries the distinction that matters,
-- because schools and clubs sit under different POPIA consent
-- frameworks (enrolment relationship vs. membership terms + s35
-- parental consent).
CREATE TABLE school (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,            -- HIL, WES
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'school'
                CHECK (kind IN ('school','club','academy','union','federation','league','association')),
  province    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Retention for a churned tenant is an open decision (POPIA
  -- minimisation vs. dataset continuity genuinely conflict here).
  -- Recorded, not enforced.
  archived_at timestamptz
);

-- ── Identity ────────────────────────────────────────────────────
CREATE TABLE app_user (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid REFERENCES school(id) ON DELETE RESTRICT,
  email        text NOT NULL UNIQUE,
  name         text NOT NULL,
  role         text NOT NULL,                  -- one of the 17 POLICY roles
  player_id    uuid,                           -- set for role 'player'; FK added after player
  child_ids    uuid[] NOT NULL DEFAULT '{}',   -- set for role 'parent'
  teams        text[] NOT NULL DEFAULT '{}',   -- team codes this user is scoped to
  active       boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app_user (school_id);
CREATE INDEX ON app_user (lower(email));

-- ── People ──────────────────────────────────────────────────────
-- The PII columns below are the ones the generated player_masked view
-- nulls per role. A finance admin may see billing but never a minor's
-- date of birth, height, weight, house or guardian.
CREATE TABLE player (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  team_code     text,                          -- 1XI, U16B … the team scope anchor
  full_name     text NOT NULL,
  squad_no      smallint,
  playing_role  text,                          -- batter | bowler | allrounder | keeper
  batting_style text,
  bowling_style text,
  fitness       text NOT NULL DEFAULT 'fit'
                  CHECK (fitness IN ('fit','injured','rehab','unavailable')),
  -- ── personal information (masked, in three tiers) ──
  -- born is behind player.age.read, which everyone who selects a side holds:
  -- a coach picking a U13 team who cannot see an age cannot avoid putting a
  -- fifteen-year-old in it.
  born          date,
  -- The national ID number, behind player.identity.read and held by the school
  -- office alone. The most dangerous field about a child in this schema:
  -- issued once, never changed, and useful to a fraudster for the rest of
  -- their life. A coach has no reason to see it and does not.
  --
  -- Format is checked but the number is NOT validated against its Luhn digit
  -- here: a schema constraint that rejects a real child's real ID because it
  -- was mistyped upstream blocks a registration at the worst moment. Validate
  -- on the way in, store what the school gives you.
  id_number     text CHECK (id_number IS NULL OR id_number ~ '^[0-9]{13}$'),
  email         text,
  phone         text,
  hometown      text,
  houseAtSchool text,
  address       text,
  guardian      jsonb,                         -- {name, relation, phone, email}
  height        smallint,                      -- cm
  weight        smallint,                      -- kg
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON player (school_id);
CREATE INDEX ON player (school_id, team_code);

ALTER TABLE app_user
  ADD CONSTRAINT app_user_player_fk FOREIGN KEY (player_id) REFERENCES player(id) ON DELETE SET NULL;

CREATE TABLE coach (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  team_code  text,
  name       text NOT NULL,
  title      text,                             -- Head Coach, Assistant …
  email      text,
  phone      text,
  born       date,
  hometown   text,
  address    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON coach (school_id);

-- Staff carry no team anchor: the RLS policy passes NULL::text for team,
-- so a team-scoped role sees no staff rows at all.
CREATE TABLE staff (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  name       text NOT NULL,
  duty       text,                             -- medical, groundskeeper, driver …
  email      text,
  phone      text,
  born       date,
  hometown   text,
  address    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON staff (school_id);

-- ── Clinical ────────────────────────────────────────────────────
-- `notes` and `physio` are the clinical fields. Medical staff see them;
-- a coach sees availability but not diagnosis; a headmaster sees the
-- injury but not the clinical detail. That is enforced by injury_masked,
-- never by the application.
--
-- Deliberately carries NO personal information of its own — it links to
-- a player. Duplicating a minor's guardian details onto a clinical row
-- would be exactly the data spread POPIA minimisation forbids.
CREATE TABLE injury (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  injury_type text NOT NULL,
  severity    text NOT NULL DEFAULT 'moderate'
                CHECK (severity IN ('minor','moderate','severe')),
  date_injured date NOT NULL,
  rtw_date    date,                            -- projected return to play
  phase       text NOT NULL DEFAULT 'active'
                CHECK (phase IN ('active','rehab','cleared')),
  restricted  boolean NOT NULL DEFAULT true,   -- unavailable for selection
  notes       text,                            -- clinical
  physio      text,                            -- clinical
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON injury (school_id);
CREATE INDEX ON injury (player_id);

-- ── Fixtures ────────────────────────────────────────────────────
CREATE TABLE ground (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  name       text NOT NULL,
  surface    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ground (school_id);

CREATE TABLE match (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  team_code     text,                          -- the home team's scope anchor
  opponent      text NOT NULL,
  ground_id     uuid REFERENCES ground(id) ON DELETE SET NULL,
  starts_at     timestamptz NOT NULL,
  format        text NOT NULL DEFAULT 'T20',
  overs         smallint NOT NULL DEFAULT 20,
  status        text NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','live','complete','abandoned')),
  -- The toss is NOT here. It was — as `toss_won_by text` holding a school's
  -- display name — and it moved to match_toss in 02_schema_scoring.sql. Two
  -- reasons, both written up there: a free-text winner could not be tied to
  -- either side actually playing, so who bats first was not computable; and
  -- `match` is governed by fixture.update, which a scorer does not hold and
  -- should not, though a scorer is exactly who watches the coin land.
  -- No score column, by design. The score is derived from ball_event —
  -- see db/01_schema_scoring.sql and packages/scoring/src/replay.mjs.
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON match (school_id);
CREATE INDEX ON match (school_id, starts_at DESC);

-- Which players are in a match squad. The scoring event log references
-- players directly, so this is the team sheet, not a scoring structure.
CREATE TABLE match_squad (
  match_id   uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  side       text NOT NULL CHECK (side IN ('home','away')),
  -- The batting order, and it is an ORDER: 1 to 11, at most one boy per
  -- position. Unconstrained this was a smallint, which let a coach name two
  -- number threes, or a number 47, and the scorer's setup screen would then
  -- pick whichever the sort happened to return first. The uniqueness is
  -- enforced by an index below, because it only applies to the side as it
  -- currently stands.
  --
  -- NULL is legitimate and means "in the squad, no position yet" — a reserve,
  -- or a side named on Tuesday whose order is settled on Saturday morning.
  --
  -- The upper bound is 11 because every team code in this product names an XI.
  -- A 12-a-side festival would need this raised deliberately, which is the
  -- point of writing it down rather than leaving the column open.
  batting_no smallint CHECK (batting_no IS NULL OR batting_no BETWEEN 1 AND 11),
  twelfth    boolean NOT NULL DEFAULT false,
  -- A boy taken OUT of the side is withdrawn, not deleted. No table in this
  -- schema has a DELETE policy for any role (§12.5) and this one is not going
  -- to be the exception: changing an XI is an ordinary Friday afternoon, and
  -- the row that says he was picked and then pulled is the only record that a
  -- selection happened at all.
  --
  -- It also keeps the two triggers below honest. Every read of a squad filters
  -- on this; a reader that forgets shows a side of thirteen.
  withdrawn  boolean NOT NULL DEFAULT false,
  selected_by uuid REFERENCES app_user(id),
  selected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX ON match_squad (match_id) WHERE NOT withdrawn;
-- One boy per position, per side, in the side as it currently stands.
-- Partial on both counts: a withdrawn row keeps the number it had (that is the
-- record of what the order WAS), and an unplaced squad member has no number to
-- collide over. Without the WHERE, re-selecting a side would collide with its
-- own withdrawn history and no coach could ever reorder anything.
CREATE UNIQUE INDEX match_squad_batting_order
  ON match_squad (match_id, side, batting_no)
  WHERE NOT withdrawn AND batting_no IS NOT NULL;

-- ── Competitions ────────────────────────────────────────────────
-- Read by read-api.mjs's `competitions` query.
--
-- ⚠️ NOT row-level secured. `competitions` is listed in NON_TABLE in
-- packages/policy/src/policy.mjs, so the generator emits no policy for
-- this table, and read-api's query carries no school predicate. Any
-- authenticated principal can therefore read every school's
-- competitions.
--
-- This is left as-is deliberately rather than silently school-scoped,
-- because the correct answer is a product decision, not a mechanical
-- one: a KZN schools league is inherently multi-tenant — several client
-- schools share one competition — so scoping it to a single school would
-- be wrong for exactly the rows that matter most. Resolve it (probably a
-- competition_entrant join table with visibility derived from
-- participation) before a second school goes live.
CREATE TABLE competition (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid REFERENCES school(id) ON DELETE CASCADE,  -- organiser; NULL = external body
  name       text NOT NULL,
  comp_type  text,                             -- league | knockout | festival
  format     text,                             -- T20 | 50-over | multi-day
  age_group  text,
  gender     text,
  season     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON competition (school_id);

-- ════════════════════════════════════════════════════════════════
--  AUTHORIZATION — capability + scoped assignment
--
--  See docs/adr/0001-scoped-assignments.md. The short version:
--  authority is a set of assignments, each naming a role (a bundle of
--  capabilities) and a scope. A request is allowed if ONE SINGLE
--  assignment both grants the capability and covers the resource —
--  never a union across assignments.
--
--  app_user.role is retained for now as the legacy single-role field
--  and is being retired; role_assignment is authoritative.
-- ════════════════════════════════════════════════════════════════

-- role → capability, generated from packages/policy/src/roles.mjs by
-- services/api/rls/generate-rls.mjs. Never hand-edit; rows are replaced
-- wholesale on regeneration.
CREATE TABLE role_capability (
  role       text NOT NULL,
  capability text NOT NULL,
  PRIMARY KEY (role, capability)
);
CREATE INDEX ON role_capability (capability);

-- One row per (person, role, scope). A person holds as many as they need:
-- Director of Sport at one school, coach of one team, guardian of a child at
-- another school. Each is evaluated independently.
CREATE TABLE role_assignment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role        text NOT NULL,
  -- Scope. NULL widens at that level: school_id NULL is platform-wide,
  -- team_code NULL is every team in the school. A NULL on the RESOURCE is
  -- never a wildcard — see app_can() in 02_rls_policies.sql.
  school_id   uuid REFERENCES school(id) ON DELETE CASCADE,
  team_code   text,
  season      text,
  fixture_id  uuid REFERENCES match(id) ON DELETE CASCADE,
  -- Validity. Revocation is immediate: app_can() reads these on every
  -- evaluation rather than trusting anything carried in the session.
  active      boolean NOT NULL DEFAULT true,
  valid_from  date,
  valid_until date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user(id),
  CONSTRAINT assignment_dates CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until)
);
-- The constraint that a coach assignment must name a team is NOT here: it is
-- generated into db/01_authz.sql from TEAM_SCOPED_ROLES in
-- packages/policy/src/roles.mjs, so the list cannot drift from the model. A
-- copy here would be a second place to forget.
CREATE INDEX ON role_assignment (person_id) WHERE active;
CREATE INDEX ON role_assignment (school_id, team_code);
CREATE INDEX ON role_assignment (role);

-- WHO an assignment is about.
--
-- An assignment with rows here reaches ONLY these people. It is what lets one
-- person be a guardian at two institutions without either relationship
-- reaching the other's records — and, since the same sentence is true of a
-- pupil's access to their own file, it is what lets a player read their own
-- medical record without reading anybody else's.
--
-- It was called guardian_child, which described one of its two uses and made
-- the second look like a special case. It is not: the rule is "this assignment
-- is about these named people", and a guardian's children and a pupil's own
-- record are both instances of it. An assignment with NO rows here is about
-- nobody in particular and is scoped by school and team alone — except for the
-- roles that only mean anything ABOUT somebody (SUBJECT_SCOPED_ROLES in
-- packages/policy/src/roles.mjs), which app_can() refuses outright rather than
-- widening. A guardian naming no child is not a school-wide guardian.
--
-- IT IS ALSO THE GUARDIAN LINK, and there is deliberately no second table.
-- A `guardian_link` alongside this one would be a second answer to the only
-- question that matters — may this person reach this child — and the two would
-- drift the first time somebody wrote to one and not the other. A revoked link
-- with a live subject row is not a bug that gets noticed; it is a parent who
-- still reads a record after the school revoked the relationship.
--
-- So the lifecycle lives here, on the link itself, and app_can() reads it.
CREATE TABLE assignment_subject (
  -- Surrogate, so a revoked link can be kept beside the one that replaced it.
  -- The real rule — one OPEN link per person per child — is the partial unique
  -- index below.
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES role_assignment(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  -- What the relationship IS. Not derivable from the role — `guardian` says
  -- somebody is responsible for this child and not whether they are the
  -- mother, an aunt or a court-appointed guardian, and the school verifying
  -- the link is verifying a specific claim.
  relationship  text CHECK (relationship IN
                  ('parent','guardian','grandparent','sibling','self','enquiry','other')),
  -- VERIFICATION — the school checked this claim against something.
  --
  -- 'pending' is the DEFAULT on purpose. A link nobody has verified grants
  -- nothing, so a half-written registration, an import, or a workflow that
  -- forgets to finish fails closed. The cost is that every path which
  -- legitimately creates a live link must say so explicitly, which is the
  -- point.
  verification_state text NOT NULL DEFAULT 'pending'
                  CHECK (verification_state IN ('pending','verified','rejected','revoked')),
  verified_by   uuid REFERENCES app_user(id),
  verified_at   timestamptz,
  verified_note text,
  -- CONSENT — separate from verification, because they are separate facts. A
  -- school can be certain who a child's mother is and still not have her
  -- consent to process his information. Verification governs ACCESS; consent
  -- governs whether the child is processed at all (player_guardian_status).
  consent_state text NOT NULL DEFAULT 'pending'
                  CHECK (consent_state IN ('pending','granted','withdrawn')),
  consent_version text,
  consent_at    timestamptz,
  -- END-DATED, NEVER DELETED. §12.9's rule about assignments is the same rule
  -- here: a link that is gone cannot be audited, and "who was allowed to read
  -- this child's record in March" is a question a school has to be able to
  -- answer in September.
  valid_from    date NOT NULL DEFAULT current_date,
  valid_until   date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES app_user(id),
  PRIMARY KEY (assignment_id, player_id, id),
  CONSTRAINT subject_verified_names_a_verifier
    CHECK (verification_state <> 'verified'
           OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT subject_consent_names_a_version
    CHECK (consent_state <> 'granted'
           OR (consent_version IS NOT NULL AND consent_at IS NOT NULL)),
  CONSTRAINT subject_dates CHECK (valid_until IS NULL OR valid_from <= valid_until)
);
CREATE INDEX ON assignment_subject (player_id);
-- One OPEN link per person per child. `valid_until IS NULL` rather than a
-- comparison against today, because an index predicate must be immutable; a
-- link end-dated in the future therefore blocks a second one, which is the
-- answer you want anyway.
CREATE UNIQUE INDEX assignment_subject_one_open_link
  ON assignment_subject (assignment_id, player_id)
  WHERE verification_state IN ('pending','verified') AND valid_until IS NULL;

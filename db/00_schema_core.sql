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
-- `school` because every RLS policy and app_school_id() references it by
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
  team_code     text,                          -- U19A, U16B … the team scope anchor
  full_name     text NOT NULL,
  squad_no      smallint,
  playing_role  text,                          -- batter | bowler | allrounder | keeper
  batting_style text,
  bowling_style text,
  fitness       text NOT NULL DEFAULT 'fit'
                  CHECK (fitness IN ('fit','injured','rehab','unavailable')),
  -- ── personal information (masked) ──
  email         text,
  phone         text,
  born          date,
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
  toss_won_by   text,
  toss_decision text CHECK (toss_decision IN ('bat','bowl')),
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
  batting_no smallint,
  twelfth    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (match_id, player_id)
);

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
-- schools share one competition — so `school_id = app_school_id()` would
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

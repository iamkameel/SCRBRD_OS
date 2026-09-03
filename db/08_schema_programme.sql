-- ════════════════════════════════════════════════════════════════
--  SCRBRD — the programme schema: training, development, notices,
--  league standings, and conditions.
--
--  These five areas existed in the product for months and in the database not
--  at all. The views read them straight out of a mock module, which meant the
--  browser was deciding who could see a child's development assessment, a
--  training register, and a notification feed — decisions with no server
--  behind them and no policy anywhere. This file is the other half of closing
--  that: the tables, so the policies generated from packages/policy/ have
--  something to attach to.
--
--  ORDERING: every governed table must exist BEFORE db/09_rls_policies.sql
--  runs, because that file ALTERs each one to enable row-level security. That
--  is why the generated policies moved from 03 to 09 — the invariant is
--  "tables first, policies last", and a schema file that lands after the
--  policies is a table with no policy on it, which is precisely the failure
--  mode that left app_user readable across every tenant.
-- ════════════════════════════════════════════════════════════════

-- ── Who is in a league ──────────────────────────────────────────
-- Closes the limitation recorded against `competition` in packages/policy/src/
-- tables.mjs: visibility used to derive from who CREATED the competition, so a
-- genuine inter-school league had to be created platform-scoped (school_id
-- NULL) to be readable by its own entrants. It now derives from participation.
CREATE TABLE competition_entrant (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  school_id      uuid NOT NULL REFERENCES school(id),
  team_code      text,
  -- A display name, because the entrant is "Hilton U19A" to a reader and a
  -- (school_id, team_code) pair to the schema. Free text, because a fixture
  -- list includes schools that are not SCRBRD tenants.
  display_name   text NOT NULL,
  played         smallint NOT NULL DEFAULT 0 CHECK (played  >= 0),
  won            smallint NOT NULL DEFAULT 0 CHECK (won     >= 0),
  lost           smallint NOT NULL DEFAULT 0 CHECK (lost    >= 0),
  drawn          smallint NOT NULL DEFAULT 0 CHECK (drawn   >= 0),
  no_result      smallint NOT NULL DEFAULT 0 CHECK (no_result >= 0),
  points         smallint NOT NULL DEFAULT 0,
  net_run_rate   numeric(5,3),
  UNIQUE (competition_id, school_id, team_code),
  -- The results have to add up. A ladder that disagrees with itself is worse
  -- than no ladder, because someone will act on it.
  CONSTRAINT entrant_results_sum CHECK (won + lost + drawn + no_result = played)
);
CREATE INDEX ON competition_entrant (competition_id);
CREATE INDEX ON competition_entrant (school_id, team_code);

-- Is this competition in reach at all?
--
-- A league table is a SHARED record. Anchoring an entrant row to its own
-- school is right for who may EDIT it and wrong for who may read it: a Hilton
-- coach anchored to Hilton reads exactly one row of a seven-team ladder, which
-- is not a ladder. Visibility has to derive from the competition, and the
-- competition's readers are its organiser plus everyone who entered it.
--
-- SECURITY DEFINER, and that is the load-bearing part rather than an
-- optimisation. Writing this as an EXISTS inside the two policies instead
-- would make competition's policy read competition_entrant and
-- competition_entrant's policy read competition — mutually recursive, which
-- Postgres refuses at query time with "infinite recursion detected in policy
-- for relation". Running as the owner steps outside RLS to answer the
-- question, exactly as match_school() and match_team() do for the scoring
-- policies.
--
-- It still asks app_can() for every candidate scope, so entering a competition
-- does not hand a league to someone who holds no competition.read anywhere —
-- participation decides WHICH leagues are in reach, never WHETHER this person
-- may read leagues at all.
CREATE OR REPLACE FUNCTION competition_visible(p_competition uuid) RETURNS boolean AS $$
  SELECT EXISTS (
           SELECT 1 FROM competition c
            WHERE c.id = p_competition
              AND app_can('competition.read', c.school_id, '*'::text,
                          '00000000-0000-0000-0000-000000000000'::uuid,
                          '00000000-0000-0000-0000-000000000000'::uuid))
      OR EXISTS (
           SELECT 1 FROM competition_entrant e
            WHERE e.competition_id = p_competition
              AND app_can('competition.read', e.school_id,
                          COALESCE(e.team_code, '*'::text),
                          '00000000-0000-0000-0000-000000000000'::uuid,
                          '00000000-0000-0000-0000-000000000000'::uuid))
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION competition_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_visible(uuid) TO PUBLIC;

-- ── Training ────────────────────────────────────────────────────
-- Split deliberately in two. The SESSION is a noticeboard fact — when, where,
-- which team — and is governed by team.read. The REGISTER is a list of named
-- minors and is governed by player.profile.read. Merging them would mean a
-- parent could not learn that training moved to 06:30 without also receiving
-- every child who was there.
CREATE TABLE training_session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES school(id),
  team_code    text NOT NULL,
  title        text NOT NULL,
  starts_at    timestamptz NOT NULL,
  duration_min smallint NOT NULL CHECK (duration_min BETWEEN 1 AND 600),
  venue        text,
  ground_id    uuid REFERENCES ground(id),
  coach_id     uuid REFERENCES coach(id),
  session_type text NOT NULL CHECK (session_type IN
                 ('technical','skills','batting','bowling','fielding','fitness','match-prep')),
  drills       text[] NOT NULL DEFAULT '{}',
  notes        text,
  cancelled    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON training_session (school_id, team_code, starts_at DESC);

CREATE TABLE training_attendance (
  session_id uuid NOT NULL REFERENCES training_session(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'present'
             CHECK (status IN ('present','absent','excused','injured','late')),
  -- Why someone was absent can be a medical fact. It is not stored here: the
  -- register records attendance, and the reason lives in the injury record
  -- behind medical.status.read, where the policy for it already exists.
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, player_id)
);
CREATE INDEX ON training_attendance (player_id);

-- ── Development assessments ─────────────────────────────────────
-- Long form rather than a JSON blob per player. A blob cannot be masked, cannot
-- be indexed by metric, and cannot record WHEN a judgement was made — and the
-- whole point of a development record is the trend, not the current number.
CREATE TABLE player_skill (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  assessed_on date NOT NULL DEFAULT current_date,
  assessed_by uuid REFERENCES app_user(id),
  category    text NOT NULL CHECK (category IN ('batting','bowling','fielding','fitness')),
  metric      text NOT NULL,
  score       smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  note        text,
  UNIQUE (player_id, assessed_on, category, metric)
);
CREATE INDEX ON player_skill (player_id, assessed_on DESC);

-- ── Notices ─────────────────────────────────────────────────────
-- The table that most needed a policy and had none.
--
-- news.read is a floor capability: nearly every role holds it. If that were
-- the only gate, the notification feed would be a side channel around every
-- other policy in this schema — "Theo Pretorius cleared for light training" is
-- a medical disclosure with a bell icon on it. So each row declares the
-- capability its SUBJECT MATTER requires, and the generated policy demands
-- both, in the same scope.
--
-- The rule this encodes, from the architecture note: a subscription can REDUCE
-- what someone receives. It can never EXPAND what they may know.
CREATE TABLE notification (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES school(id),
  -- NULL means the notice is not about one team. The generated policy
  -- COALESCEs this to the ANY_SCOPE sentinel rather than passing NULL, because
  -- a NULL on a resource NARROWS — a school-wide notice with a null team would
  -- be invisible to every team-scoped coach in the school.
  team_code text,
  scope_level text NOT NULL CHECK (scope_level IN ('school','team','competition')),
  kind      text NOT NULL,
  urgency   text NOT NULL DEFAULT 'low' CHECK (urgency IN ('low','medium','high')),
  title     text NOT NULL,
  body      text NOT NULL,
  -- The capability the CONTENT requires, on top of news.read. A foreign key
  -- rather than free text: a typo here fails closed, which is safe, but it
  -- fails silently — nobody receives the notice and the publisher is never
  -- told. The catalogue is generated in db/01_authz.sql from the same model
  -- the roles are.
  required_capability text NOT NULL DEFAULT 'news.read' REFERENCES capability(name),
  -- Public-facing surfaces read ONLY where this is true. It is a separate
  -- decision from the capability gate above and never a substitute for it: a
  -- row can be public and still carry a capability, and both are checked.
  is_public boolean NOT NULL DEFAULT false,
  -- What the notice is ABOUT, when it is about something. Nullable and
  -- unenforced by design: a notice may reference a fixture that is later
  -- cancelled, and the notice should survive to say so.
  subject_kind text CHECK (subject_kind IN ('match','injury','training','transport','facility','skills','system','competition')),
  subject_id   uuid,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES app_user(id),
  expires_at   timestamptz,
  CONSTRAINT notification_team_scope CHECK (scope_level <> 'team' OR team_code IS NOT NULL),
  -- A public notice may not carry a restricted subject. Belt and braces
  -- alongside the capability gate: if it is going on a public match centre,
  -- news.read is the most it may require.
  CONSTRAINT notification_public_is_general CHECK (NOT is_public OR required_capability = 'news.read')
);
CREATE INDEX ON notification (school_id, published_at DESC);
CREATE INDEX ON notification (school_id, team_code, published_at DESC);
CREATE INDEX ON notification (published_at DESC) WHERE is_public;

-- Read state is PER PERSON, so it cannot live on the notice. Its own table,
-- keyed by the reader, and deliberately NOT governed by a capability: marking
-- your own notice read is not an authorization question, and the rows you can
-- create are constrained to your own id by the policy in 09.
CREATE TABLE notification_read (
  notification_id uuid NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
  person_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, person_id)
);

-- ── Conditions ──────────────────────────────────────────────────
-- Keyed to a fixture and scoped through it. Nothing here is personal, but a
-- weather table readable by anyone would quietly answer "does this school have
-- a fixture on Saturday?", so it inherits the fixture's policy rather than
-- being left open on the grounds that rain is not confidential.
CREATE TABLE match_weather (
  match_id      uuid PRIMARY KEY REFERENCES match(id) ON DELETE CASCADE,
  condition     text NOT NULL,
  temp_c        smallint,
  humidity_pct  smallint CHECK (humidity_pct BETWEEN 0 AND 100),
  wind_kph      smallint CHECK (wind_kph >= 0),
  wind_dir      text,
  uv_index      smallint CHECK (uv_index BETWEEN 0 AND 15),
  rain_chance_pct smallint CHECK (rain_chance_pct BETWEEN 0 AND 100),
  forecast      text,
  playable      boolean NOT NULL DEFAULT true,
  observed_at   timestamptz NOT NULL DEFAULT now()
);

-- ── The one policy in this file that is written by hand ─────────
-- Everything else here is governed by db/09_rls_policies.sql, generated from
-- packages/policy/. notification_read is not, because it is not governed by a
-- CAPABILITY at all — it is governed by identity. "Have I read this?" is a
-- question only I can answer about myself, and there is no scope, no role and
-- no assignment involved.
--
-- Forcing it through the capability model would make it worse, not better: the
-- nearest fit is news.read, and a school-wide news.read would then let one
-- person see WHICH notices another person has opened. That is a surveillance
-- affordance nobody asked for, arrived at by trying to be consistent.
--
-- Same pattern as the scoring tables in 02, which are also hand-written for
-- the same reason: their rule is a state machine, not a capability.
ALTER TABLE notification_read ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_read_read ON notification_read
  FOR SELECT USING (person_id = app_user_id());

-- You may only mark a notice read AS YOURSELF, and only a notice you can
-- actually see: the EXISTS re-enters the notification policy rather than
-- trusting the id handed in, so this table cannot be used to probe which
-- notification ids exist.
CREATE POLICY notification_read_insert ON notification_read
  FOR INSERT WITH CHECK (
    person_id = app_user_id()
    AND EXISTS (SELECT 1 FROM notification n WHERE n.id = notification_read.notification_id)
  );

CREATE POLICY notification_read_update ON notification_read
  FOR UPDATE USING (person_id = app_user_id())
           WITH CHECK (person_id = app_user_id());

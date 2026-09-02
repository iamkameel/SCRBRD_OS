-- SCRBRD — Row-Level Security & column masking
-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.
-- Regenerate with `pnpm rls:generate`. Companion: db/00_schema_core.sql, db/01_schema_scoring.sql.
--
-- Model: capability + scoped assignment (docs/adr/0001-scoped-assignments.md).
-- 50 capabilities across 20 roles.
-- Roles that may score: directorofsport, sportsadmin, coach, assistantcoach, scorer

-- Principal helpers. app_user_id() is set from the signed token on every
-- request; everything else about a person's authority is looked up.
CREATE OR REPLACE FUNCTION app_player_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.player_id', true), '')::uuid $$ LANGUAGE sql STABLE;

-- ══════════════════════════════════════════════════════════════════
--  The authorization decision
-- ══════════════════════════════════════════════════════════════════
-- app_can(capability, school, team, person, fixture)
--
-- TRUE when ONE SINGLE assignment held by the current user both grants the
-- capability and covers the resource. Never a union across assignments: a
-- capability held through one assignment is only ever applied within that
-- same assignment's scope.
--
-- Scope semantics, which are asymmetric on purpose:
--   NULL on the ASSIGNMENT widens  — school_id NULL is platform-wide,
--                                    team_code NULL is every team in the school.
--   NULL on the RESOURCE narrows   — a row that does not state its school is
--                                    NOT covered by a school-scoped assignment.
-- The second half is what makes a query that forgot its scope fail closed
-- instead of matching everything.
--
-- SECURITY DEFINER because role_assignment is itself RLS-protected: a person
-- may not read other people's assignments, but the decision must read their
-- own. STABLE so it is evaluated once per statement per argument set.
CREATE OR REPLACE FUNCTION app_can(
  p_capability text,
  p_school     uuid DEFAULT NULL,
  p_team       text DEFAULT NULL,
  p_person     uuid DEFAULT NULL,
  p_fixture    uuid DEFAULT NULL
) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc
        ON rc.role = a.role
       AND rc.capability = p_capability
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       -- institution
       AND (a.school_id IS NULL OR (p_school IS NOT NULL AND a.school_id = p_school))
       -- team
       AND (a.team_code IS NULL OR (p_team IS NOT NULL AND a.team_code = p_team))
       -- single fixture (scorers, match officials)
       AND (a.fixture_id IS NULL OR (p_fixture IS NOT NULL AND a.fixture_id = p_fixture))
       -- guardian: an assignment listing children reaches ONLY those children
       AND (
         NOT EXISTS (SELECT 1 FROM guardian_child g WHERE g.assignment_id = a.id)
         OR (p_person IS NOT NULL AND EXISTS (
               SELECT 1 FROM guardian_child g
                WHERE g.assignment_id = a.id AND g.player_id = p_person))
       )
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION app_can(text, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can(text, uuid, text, uuid, uuid) TO PUBLIC;

-- Live-scoring capability, for the ball_event policies in 01_schema_scoring.sql.
-- Derived from the role bundles rather than listed, so a role can never
-- acquire scoring rights without naming scoring.edit.
CREATE OR REPLACE FUNCTION can_score(p_role text) RETURNS boolean AS $$
  SELECT p_role IN ('directorofsport', 'sportsadmin', 'coach', 'assistantcoach', 'scorer')
$$ LANGUAGE sql IMMUTABLE;

-- ══════════════════════════════════════════════════════════════════
--  Role → capability bundles
-- ══════════════════════════════════════════════════════════════════
-- Replaced wholesale on every regeneration.
DELETE FROM role_capability;
INSERT INTO role_capability (role, capability) VALUES
  ('platformadmin', 'platform.health.read'),
  ('platformadmin', 'platform.tenant.manage'),
  ('platformadmin', 'platform.support.impersonate'),
  ('platformadmin', 'school.read'),
  ('platformadmin', 'user.read'),
  ('platformadmin', 'audit.read'),
  ('platformadmin', 'competition.read'),
  ('platformadmin', 'news.read'),
  ('principal', 'team.read'),
  ('principal', 'fixture.read'),
  ('principal', 'player.profile.read'),
  ('principal', 'news.read'),
  ('principal', 'school.read'),
  ('principal', 'user.read'),
  ('principal', 'analytics.read'),
  ('principal', 'competition.read'),
  ('principal', 'discipline.read'),
  ('principal', 'facility.read'),
  ('principal', 'invoice.read'),
  ('principal', 'player.performance.read'),
  ('principal', 'medical.status.read'),
  ('principal', 'audit.read'),
  ('directorofsport', 'team.read'),
  ('directorofsport', 'fixture.read'),
  ('directorofsport', 'player.profile.read'),
  ('directorofsport', 'news.read'),
  ('directorofsport', 'school.read'),
  ('directorofsport', 'user.read'),
  ('directorofsport', 'user.invite'),
  ('directorofsport', 'team.manage'),
  ('directorofsport', 'team.select'),
  ('directorofsport', 'fixture.create'),
  ('directorofsport', 'fixture.update'),
  ('directorofsport', 'fixture.cancel'),
  ('directorofsport', 'player.profile.manage'),
  ('directorofsport', 'player.performance.read'),
  ('directorofsport', 'player.development.read'),
  ('directorofsport', 'medical.status.read'),
  ('directorofsport', 'discipline.read'),
  ('directorofsport', 'discipline.write'),
  ('directorofsport', 'analytics.read'),
  ('directorofsport', 'competition.read'),
  ('directorofsport', 'facility.read'),
  ('directorofsport', 'facility.manage'),
  ('directorofsport', 'transport.read'),
  ('directorofsport', 'officiating.assign'),
  ('directorofsport', 'scoring.start'),
  ('directorofsport', 'scoring.edit'),
  ('directorofsport', 'scoring.finalise'),
  ('directorofsport', 'scoring.correct'),
  ('directorofsport', 'news.publish.team'),
  ('directorofsport', 'news.publish.school'),
  ('directorofsport', 'audit.read'),
  ('schooladmin', 'team.read'),
  ('schooladmin', 'fixture.read'),
  ('schooladmin', 'player.profile.read'),
  ('schooladmin', 'news.read'),
  ('schooladmin', 'school.read'),
  ('schooladmin', 'school.manage'),
  ('schooladmin', 'user.read'),
  ('schooladmin', 'user.invite'),
  ('schooladmin', 'user.role.assign'),
  ('schooladmin', 'team.manage'),
  ('schooladmin', 'fixture.create'),
  ('schooladmin', 'fixture.update'),
  ('schooladmin', 'fixture.cancel'),
  ('schooladmin', 'player.profile.manage'),
  ('schooladmin', 'player.pii.read'),
  ('schooladmin', 'medical.status.read'),
  ('schooladmin', 'discipline.read'),
  ('schooladmin', 'facility.read'),
  ('schooladmin', 'facility.manage'),
  ('schooladmin', 'transport.read'),
  ('schooladmin', 'transport.manage'),
  ('schooladmin', 'invoice.read'),
  ('schooladmin', 'competition.read'),
  ('schooladmin', 'news.publish.school'),
  ('schooladmin', 'audit.read'),
  ('sportsadmin', 'team.read'),
  ('sportsadmin', 'fixture.read'),
  ('sportsadmin', 'player.profile.read'),
  ('sportsadmin', 'news.read'),
  ('sportsadmin', 'user.read'),
  ('sportsadmin', 'team.manage'),
  ('sportsadmin', 'team.select'),
  ('sportsadmin', 'fixture.create'),
  ('sportsadmin', 'fixture.update'),
  ('sportsadmin', 'fixture.cancel'),
  ('sportsadmin', 'officiating.assign'),
  ('sportsadmin', 'player.profile.manage'),
  ('sportsadmin', 'medical.status.read'),
  ('sportsadmin', 'facility.read'),
  ('sportsadmin', 'facility.manage'),
  ('sportsadmin', 'transport.read'),
  ('sportsadmin', 'transport.manage'),
  ('sportsadmin', 'competition.read'),
  ('sportsadmin', 'news.publish.team'),
  ('sportsadmin', 'news.publish.school'),
  ('sportsadmin', 'scoring.start'),
  ('sportsadmin', 'scoring.edit'),
  ('sportsadmin', 'scoring.finalise'),
  ('coach', 'team.read'),
  ('coach', 'fixture.read'),
  ('coach', 'player.profile.read'),
  ('coach', 'news.read'),
  ('coach', 'team.select'),
  ('coach', 'player.performance.read'),
  ('coach', 'player.performance.write'),
  ('coach', 'player.development.read'),
  ('coach', 'player.development.write'),
  ('coach', 'medical.status.read'),
  ('coach', 'analytics.read'),
  ('coach', 'transport.read'),
  ('coach', 'scoring.start'),
  ('coach', 'scoring.edit'),
  ('coach', 'scoring.finalise'),
  ('coach', 'news.publish.team'),
  ('assistantcoach', 'team.read'),
  ('assistantcoach', 'fixture.read'),
  ('assistantcoach', 'player.profile.read'),
  ('assistantcoach', 'news.read'),
  ('assistantcoach', 'player.performance.read'),
  ('assistantcoach', 'player.development.read'),
  ('assistantcoach', 'medical.status.read'),
  ('assistantcoach', 'transport.read'),
  ('assistantcoach', 'scoring.start'),
  ('assistantcoach', 'scoring.edit'),
  ('teammanager', 'team.read'),
  ('teammanager', 'fixture.read'),
  ('teammanager', 'player.profile.read'),
  ('teammanager', 'news.read'),
  ('teammanager', 'team.select'),
  ('teammanager', 'medical.status.read'),
  ('teammanager', 'transport.read'),
  ('teammanager', 'news.publish.team'),
  ('scorer', 'fixture.read'),
  ('scorer', 'team.read'),
  ('scorer', 'news.read'),
  ('scorer', 'scoring.start'),
  ('scorer', 'scoring.edit'),
  ('scorer', 'scoring.finalise'),
  ('scorer', 'scoring.correct'),
  ('official', 'fixture.read'),
  ('official', 'team.read'),
  ('official', 'news.read'),
  ('official', 'officiating.report'),
  ('official', 'discipline.write'),
  ('player', 'fixture.read'),
  ('player', 'team.read'),
  ('player', 'news.read'),
  ('player', 'player.profile.read'),
  ('player', 'player.performance.read'),
  ('player', 'player.development.read'),
  ('player', 'medical.status.read'),
  ('player', 'transport.read'),
  ('guardian', 'fixture.read'),
  ('guardian', 'team.read'),
  ('guardian', 'news.read'),
  ('guardian', 'player.profile.read'),
  ('guardian', 'player.pii.read'),
  ('guardian', 'player.performance.read'),
  ('guardian', 'medical.status.read'),
  ('guardian', 'transport.read'),
  ('guardian', 'invoice.read'),
  ('medical', 'team.read'),
  ('medical', 'fixture.read'),
  ('medical', 'news.read'),
  ('medical', 'player.profile.read'),
  ('medical', 'medical.status.read'),
  ('medical', 'medical.details.read'),
  ('medical', 'medical.write'),
  ('finance', 'school.read'),
  ('finance', 'news.read'),
  ('finance', 'invoice.read'),
  ('finance', 'invoice.manage'),
  ('finance', 'user.read'),
  ('transportcoordinator', 'fixture.read'),
  ('transportcoordinator', 'team.read'),
  ('transportcoordinator', 'news.read'),
  ('transportcoordinator', 'transport.read'),
  ('transportcoordinator', 'transport.manage'),
  ('driver', 'news.read'),
  ('driver', 'transport.read'),
  ('driver', 'transport.drive'),
  ('facilities', 'fixture.read'),
  ('facilities', 'news.read'),
  ('facilities', 'facility.read'),
  ('facilities', 'facility.manage'),
  ('media', 'fixture.read'),
  ('media', 'team.read'),
  ('media', 'news.read'),
  ('media', 'player.profile.read'),
  ('media', 'player.performance.read'),
  ('media', 'news.publish.school'),
  ('media', 'news.publish.team'),
  ('scout', 'fixture.read'),
  ('scout', 'team.read'),
  ('scout', 'news.read'),
  ('scout', 'player.profile.read'),
  ('scout', 'player.performance.read'),
  ('scout', 'scouting.read'),
  ('scout', 'scouting.write'),
  ('competitionadmin', 'fixture.read'),
  ('competitionadmin', 'fixture.update'),
  ('competitionadmin', 'fixture.cancel'),
  ('competitionadmin', 'team.read'),
  ('competitionadmin', 'news.read'),
  ('competitionadmin', 'competition.read'),
  ('competitionadmin', 'competition.manage'),
  ('competitionadmin', 'officiating.assign'),
  ('competitionadmin', 'discipline.read'),
  ('competitionadmin', 'scoring.correct'),
  ('competitionadmin', 'news.publish.competition');

-- ══════════════════════════════════════════════════════════════════
--  The assignment tables themselves
-- ══════════════════════════════════════════════════════════════════
-- A person may read their own assignments — the context switcher needs them —
-- and nobody else's. Granting and revoking goes through user.role.assign.
ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_assignment_read  ON role_assignment;
DROP POLICY IF EXISTS role_assignment_write ON role_assignment;

CREATE POLICY role_assignment_read ON role_assignment
  FOR SELECT USING (
    person_id = app_user_id()
    OR app_can('user.role.assign', school_id, team_code, NULL, NULL)
  );
CREATE POLICY role_assignment_write ON role_assignment
  FOR INSERT WITH CHECK (app_can('user.role.assign', school_id, team_code, NULL, NULL));

ALTER TABLE guardian_child ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guardian_child_read ON guardian_child;
CREATE POLICY guardian_child_read ON guardian_child
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.id = guardian_child.assignment_id
       AND (a.person_id = app_user_id()
            OR app_can('user.role.assign', a.school_id, a.team_code, NULL, NULL))
  ));

-- role_capability is generated reference data, readable by all, written only
-- by the generator running as the migration user.
ALTER TABLE role_capability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_capability_read ON role_capability;
CREATE POLICY role_capability_read ON role_capability FOR SELECT USING (true);

-- ══════════════════════════════════════════════════════════════════
--  Per-table row-level security
-- ══════════════════════════════════════════════════════════════════

-- player — read: player.profile.read · write: player.profile.manage
ALTER TABLE player ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_read   ON player;
DROP POLICY IF EXISTS player_insert ON player;
DROP POLICY IF EXISTS player_update ON player;
DROP POLICY IF EXISTS player_delete ON player;

CREATE POLICY player_read ON player
  FOR SELECT USING (app_can('player.profile.read', player.school_id, player.team_code, player.id, NULL::uuid));

CREATE POLICY player_insert ON player
  FOR INSERT WITH CHECK (app_can('player.profile.manage', player.school_id, player.team_code, player.id, NULL::uuid));

CREATE POLICY player_update ON player
  FOR UPDATE USING (app_can('player.profile.manage', player.school_id, player.team_code, player.id, NULL::uuid))
           WITH CHECK (app_can('player.profile.manage', player.school_id, player.team_code, player.id, NULL::uuid));

-- coach — read: user.read · write: user.role.assign
ALTER TABLE coach ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_read   ON coach;
DROP POLICY IF EXISTS coach_insert ON coach;
DROP POLICY IF EXISTS coach_update ON coach;
DROP POLICY IF EXISTS coach_delete ON coach;

CREATE POLICY coach_read ON coach
  FOR SELECT USING (app_can('user.read', coach.school_id, coach.team_code, coach.id, NULL::uuid));

CREATE POLICY coach_insert ON coach
  FOR INSERT WITH CHECK (app_can('user.role.assign', coach.school_id, coach.team_code, coach.id, NULL::uuid));

CREATE POLICY coach_update ON coach
  FOR UPDATE USING (app_can('user.role.assign', coach.school_id, coach.team_code, coach.id, NULL::uuid))
           WITH CHECK (app_can('user.role.assign', coach.school_id, coach.team_code, coach.id, NULL::uuid));

-- staff — read: user.read · write: user.role.assign
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_read   ON staff;
DROP POLICY IF EXISTS staff_insert ON staff;
DROP POLICY IF EXISTS staff_update ON staff;
DROP POLICY IF EXISTS staff_delete ON staff;

CREATE POLICY staff_read ON staff
  FOR SELECT USING (app_can('user.read', staff.school_id, NULL::text, staff.id, NULL::uuid));

CREATE POLICY staff_insert ON staff
  FOR INSERT WITH CHECK (app_can('user.role.assign', staff.school_id, NULL::text, staff.id, NULL::uuid));

CREATE POLICY staff_update ON staff
  FOR UPDATE USING (app_can('user.role.assign', staff.school_id, NULL::text, staff.id, NULL::uuid))
           WITH CHECK (app_can('user.role.assign', staff.school_id, NULL::text, staff.id, NULL::uuid));

-- injury — read: medical.status.read · write: medical.write
ALTER TABLE injury ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS injury_read   ON injury;
DROP POLICY IF EXISTS injury_insert ON injury;
DROP POLICY IF EXISTS injury_update ON injury;
DROP POLICY IF EXISTS injury_delete ON injury;

CREATE POLICY injury_read ON injury
  FOR SELECT USING (app_can('medical.status.read', injury.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury.player_id), injury.player_id, NULL::uuid));

CREATE POLICY injury_insert ON injury
  FOR INSERT WITH CHECK (app_can('medical.write', injury.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury.player_id), injury.player_id, NULL::uuid));

CREATE POLICY injury_update ON injury
  FOR UPDATE USING (app_can('medical.write', injury.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury.player_id), injury.player_id, NULL::uuid))
           WITH CHECK (app_can('medical.write', injury.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury.player_id), injury.player_id, NULL::uuid));

-- match — read: fixture.read · write: fixture.update
ALTER TABLE match ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_read   ON match;
DROP POLICY IF EXISTS match_insert ON match;
DROP POLICY IF EXISTS match_update ON match;
DROP POLICY IF EXISTS match_delete ON match;

CREATE POLICY match_read ON match
  FOR SELECT USING (app_can('fixture.read', match.school_id, match.team_code, NULL::uuid, match.id));

CREATE POLICY match_insert ON match
  FOR INSERT WITH CHECK (app_can('fixture.update', match.school_id, match.team_code, NULL::uuid, match.id));

CREATE POLICY match_update ON match
  FOR UPDATE USING (app_can('fixture.update', match.school_id, match.team_code, NULL::uuid, match.id))
           WITH CHECK (app_can('fixture.update', match.school_id, match.team_code, NULL::uuid, match.id));

-- competition — read: competition.read · write: competition.manage
ALTER TABLE competition ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competition_read   ON competition;
DROP POLICY IF EXISTS competition_insert ON competition;
DROP POLICY IF EXISTS competition_update ON competition;
DROP POLICY IF EXISTS competition_delete ON competition;

CREATE POLICY competition_read ON competition
  FOR SELECT USING (app_can('competition.read', competition.school_id, NULL::text, NULL::uuid, NULL::uuid));

CREATE POLICY competition_insert ON competition
  FOR INSERT WITH CHECK (app_can('competition.manage', competition.school_id, NULL::text, NULL::uuid, NULL::uuid));

CREATE POLICY competition_update ON competition
  FOR UPDATE USING (app_can('competition.manage', competition.school_id, NULL::text, NULL::uuid, NULL::uuid))
           WITH CHECK (app_can('competition.manage', competition.school_id, NULL::text, NULL::uuid, NULL::uuid));

-- ══════════════════════════════════════════════════════════════════
--  Column-masking views
-- ══════════════════════════════════════════════════════════════════

-- player_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as `SELECT t.*, CASE …`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_player$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'player.school_id',
                            'player.team_code',
                            'player.id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('email', 'player.pii.read'), ('phone', 'player.pii.read'), ('born', 'player.pii.read'), ('hometown', 'player.pii.read'), ('houseatschool', 'player.pii.read'), ('address', 'player.pii.read'), ('guardian', 'player.pii.read'), ('height', 'player.pii.read'), ('weight', 'player.pii.read')) AS g(column_name, capability)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'player';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build player_masked: table player not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW player_masked WITH (security_barrier = true) AS SELECT %s FROM player',
    cols);
END
$mask_player$;

-- coach_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as `SELECT t.*, CASE …`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_coach$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'coach.school_id',
                            'coach.team_code',
                            'coach.id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('email', 'player.pii.read'), ('phone', 'player.pii.read'), ('born', 'player.pii.read'), ('hometown', 'player.pii.read'), ('address', 'player.pii.read')) AS g(column_name, capability)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'coach';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build coach_masked: table coach not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW coach_masked WITH (security_barrier = true) AS SELECT %s FROM coach',
    cols);
END
$mask_coach$;

-- staff_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as `SELECT t.*, CASE …`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_staff$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'staff.school_id',
                            'NULL::text',
                            'staff.id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('email', 'player.pii.read'), ('phone', 'player.pii.read'), ('born', 'player.pii.read'), ('hometown', 'player.pii.read'), ('address', 'player.pii.read')) AS g(column_name, capability)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'staff';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build staff_masked: table staff not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW staff_masked WITH (security_barrier = true) AS SELECT %s FROM staff',
    cols);
END
$mask_staff$;

-- injury_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as `SELECT t.*, CASE …`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_injury$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'injury.school_id',
                            '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)',
                            'injury.player_id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('notes', 'medical.details.read'), ('physio', 'medical.details.read')) AS g(column_name, capability)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'injury';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build injury_masked: table injury not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW injury_masked WITH (security_barrier = true) AS SELECT %s FROM injury',
    cols);
END
$mask_injury$;

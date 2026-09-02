-- SCRBRD — Row-Level Security & column masking
-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.
-- Regenerate with `pnpm rls:generate`. Companion: db/01_authz.sql.
-- Model: capability + scoped assignment (docs/adr/0001-scoped-assignments.md).
-- Roles that may score: directorofsport, sportsadmin, coach, assistantcoach, scorer

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

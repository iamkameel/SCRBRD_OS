-- ════════════════════════════════════════════════════════════════
--  SCRBRD — RLS live verification
--
--  Run AFTER applying schema_scoring.sql + rls_policies.sql against a
--  real database with seed data. This is the proof that RLS actually
--  fires — the .mjs tests prove the policy logic; this proves Postgres
--  enforces it. Uses plain assertions (no pgTAP dependency); each block
--  RAISEs on failure so a clean run = all green.
--
--  Usage:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f rls_verify.sql
--
--  Assumes seed data:
--    school HIL; player p1 (team U19A, no injury), p5 (team U19A, injury i1);
--    a spectator user, an analyst user, a coach of U19A, a parent of p5.
--  Adjust the fixture UUIDs below to your seed.
-- ════════════════════════════════════════════════════════════════

\set QUIET on
SET client_min_messages = warning;

-- Helper: run a query AS a given principal by setting session vars, then
-- assert a row-count expectation. Everything runs in one txn and rolls back.
BEGIN;

-- The API connects as a NON-superuser role that RLS applies to.
-- (superusers bypass RLS — never run the app as one.)
CREATE ROLE scrbrd_app NOLOGIN;
SET ROLE scrbrd_app;

-- ---- principals (edit UUIDs to match seed) ----
-- Convention: set_config mirrors what the API sets from the JWT.
CREATE OR REPLACE FUNCTION _as(role text, school uuid, player uuid DEFAULT NULL,
                                children text DEFAULT '', teams text DEFAULT '')
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.role', role, true);
  PERFORM set_config('app.school_id', school::text, true);
  PERFORM set_config('app.user_id', gen_random_uuid()::text, true);
  PERFORM set_config('app.player_id', coalesce(player::text,''), true);
  PERFORM set_config('app.child_ids', children, true);
  PERFORM set_config('app.teams', teams, true);
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION _assert(cond boolean, msg text) RETURNS void AS $$
BEGIN IF NOT cond THEN RAISE EXCEPTION 'RLS ASSERT FAILED: %', msg; END IF; END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  HIL  uuid := (SELECT id FROM school WHERE code = 'HIL');
  P1   uuid := (SELECT id FROM player WHERE full_name LIKE 'James Whitfield%');
  P5   uuid := (SELECT id FROM player WHERE team_code = 'U19A' AND id IN (SELECT player_id FROM injury) LIMIT 1);
  n    int;
BEGIN
  -- 1. Spectator: no injuries, no player PII rows leaked
  PERFORM _as('spectator', HIL);
  SELECT count(*) INTO n FROM injury;
  PERFORM _assert(n = 0, 'spectator sees injuries');
  -- spectator can see match rows (school scope)
  SELECT count(*) INTO n FROM match;
  PERFORM _assert(n > 0, 'spectator cannot see any matches (should see school matches)');

  -- 2. Analyst: sees players, but PII columns are NULL via the masked view
  PERFORM _as('analyst', HIL);
  SELECT count(*) INTO n FROM player;
  PERFORM _assert(n > 0, 'analyst sees no players (should see school players)');
  SELECT count(*) INTO n FROM player_masked WHERE born IS NOT NULL;
  PERFORM _assert(n = 0, 'analyst PII (born) NOT masked in player_masked');
  SELECT count(*) INTO n FROM player_masked WHERE full_name IS NOT NULL;
  PERFORM _assert(n > 0, 'analyst masked-out non-PII (name) — over-masking');

  -- 3. Medical: sees injuries WITH clinical notes
  PERFORM _as('medical', HIL);
  SELECT count(*) INTO n FROM injury;
  PERFORM _assert(n > 0, 'medical cannot see injuries');
  SELECT count(*) INTO n FROM injury_masked WHERE notes IS NOT NULL;
  PERFORM _assert(n > 0, 'medical clinical notes wrongly masked');

  -- 4. Assistant: sees injuries but clinical notes masked
  PERFORM _as('assistant', HIL, NULL, '', 'U19A');
  SELECT count(*) INTO n FROM injury_masked WHERE notes IS NOT NULL;
  PERFORM _assert(n = 0, 'assistant clinical notes NOT masked');

  -- 5. Coach: only own-team (U19A) players
  PERFORM _as('coach', HIL, NULL, '', 'U19A');
  SELECT count(*) INTO n FROM player WHERE team_code <> 'U19A';
  PERFORM _assert(n = 0, 'coach sees players outside own team');
  SELECT count(*) INTO n FROM player WHERE team_code = 'U19A';
  PERFORM _assert(n > 0, 'coach sees no own-team players');

  -- 6. Parent: only own child's injuries (P5), nothing else
  PERFORM _as('parent', HIL, NULL, P5::text, 'U19A');
  SELECT count(*) INTO n FROM injury WHERE player_id <> P5;
  PERFORM _assert(n = 0, 'parent sees injuries of other children');

  -- 7. Write protection: analyst cannot insert a player
  PERFORM _as('analyst', HIL);
  BEGIN
    INSERT INTO player (id, school_id, team_code, full_name)
    VALUES (gen_random_uuid(), HIL, 'U19A', 'Injected');
    PERFORM _assert(false, 'analyst INSERT into player succeeded (should be blocked)');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL; -- expected: RLS WITH CHECK blocks it
  END;

  RAISE NOTICE 'ALL RLS LIVE ASSERTIONS PASSED';
END $$;

ROLLBACK;
\set QUIET off

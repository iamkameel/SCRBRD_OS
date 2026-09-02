-- ════════════════════════════════════════════════════════════════
--  SCRBRD — RLS live verification
--
--  The .mjs suites prove the policy logic against fakes. This proves
--  POSTGRES ENFORCES IT, which is a different claim and the only one
--  that matters in production.
--
--  Everything runs as an unprivileged role inside one transaction and
--  rolls back. A clean run prints ALL RLS LIVE ASSERTIONS PASSED.
--
--  Usage:  node tools/migrate.mjs --reset --seed --verify
--          psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/99_rls_verify.sql
--
--  Fixtures come from 98_seed_pilot.sql.
-- ════════════════════════════════════════════════════════════════

\set QUIET on
SET client_min_messages = warning;

BEGIN;

-- Everything below runs as scrbrd_app — the SAME role the API connects as,
-- created and granted by db/05_app_role.sql rather than invented here. That
-- matters: a verifier that builds its own lookalike role proves the policies
-- are correct for a role nothing uses. A table's OWNER bypasses row-level
-- security entirely, so testing as the owner would pass every assertion below
-- while enforcing nothing.
DO $role_exists$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrbrd_app') THEN
    RAISE EXCEPTION 'scrbrd_app does not exist — apply db/05_app_role.sql first';
  END IF;
END $role_exists$;

-- Postgres 16 no longer lets a CREATEROLE role SET ROLE to a role it created
-- without an explicit membership carrying the SET option.
DO $grant$
BEGIN
  EXECUTE format('GRANT scrbrd_app TO %I WITH SET TRUE', current_user);
EXCEPTION WHEN duplicate_object OR invalid_grant_operation THEN NULL;
END $grant$;

-- Become a person. Only the user id is set: everything about their authority
-- is looked up from role_assignment, so a session cannot claim a role it does
-- not hold. These helpers are created BEFORE dropping privilege, because
-- scrbrd_app has no CREATE on schema public.
CREATE OR REPLACE FUNCTION _as(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.user_id', p_user::text, true);
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION _assert(cond boolean, msg text) RETURNS void AS $$
BEGIN IF NOT cond THEN RAISE EXCEPTION 'RLS ASSERT FAILED: %', msg; END IF; END $$ LANGUAGE plpgsql;

-- Revoke an assignment as the table owner. Created here, before privilege is
-- dropped, because the unprivileged role cannot SET ROLE back up — which is
-- itself the correct behaviour and worth not weakening just to write a test.
CREATE OR REPLACE FUNCTION _revoke(p_person uuid) RETURNS void AS $$
  UPDATE role_assignment SET active = false WHERE person_id = p_person;
$$ LANGUAGE sql SECURITY DEFINER;

-- From here on we are the unprivileged application role, so every read below
-- is subject to RLS exactly as it would be through the API.
SET ROLE scrbrd_app;

-- Surface the closing NOTICE. Without this the file sets client_min_messages
-- to warning and a fully green run prints nothing at all, which is
-- indistinguishable from a run that silently did no work.
SET client_min_messages = notice;

DO $$
DECLARE
  HIL       uuid := '11111111-1111-1111-1111-111111111111';
  WES       uuid := '22222222-2222-2222-2222-222222222222';
  U_COACH   uuid := '88888888-0000-0000-0000-000000000004';  -- coach of U19A
  U_PARENT  uuid := '88888888-0000-0000-0000-000000000005';  -- guardian of R Pillay
  U_MEDICAL uuid := '88888888-0000-0000-0000-000000000003';
  U_SCOUT   uuid := '88888888-0000-0000-0000-000000000002';
  U_SCORER  uuid := '88888888-0000-0000-0000-000000000006';
  U_SARAH   uuid := '88888888-0000-0000-0000-000000000007';  -- 4 assignments, 2 schools
  P_INJURED uuid := 'aaaaaaaa-0000-0000-0000-000000000005';  -- R Pillay, U19A
  P_U16B    uuid := 'aaaaaaaa-0000-0000-0000-000000000006';  -- K Dlamini, U16B
  P_WES     uuid := 'bbbbbbbb-0000-0000-0000-000000000001';  -- D Mkhize, Westville
  P_WES2    uuid := 'bbbbbbbb-0000-0000-0000-000000000002';  -- K Botha, Westville
  n int;
BEGIN
  -- ── 1. Nobody is anybody by default ────────────────────────────
  PERFORM set_config('app.user_id', '', true);
  SELECT count(*) INTO n FROM player;
  PERFORM _assert(n = 0, 'an unidentified session can read players');
  SELECT count(*) INTO n FROM match;
  PERFORM _assert(n = 0, 'an unidentified session can read matches');

  -- ── 2. A team coach is confined to their team ──────────────────
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM player WHERE team_code <> 'U19A';
  PERFORM _assert(n = 0, 'coach sees players outside their own team');
  SELECT count(*) INTO n FROM player WHERE team_code = 'U19A';
  PERFORM _assert(n > 0, 'coach sees none of their own team');
  SELECT count(*) INTO n FROM player WHERE school_id = WES;
  PERFORM _assert(n = 0, 'coach reaches across the tenant boundary');

  -- The §36 case: an AGGREGATE must obey the same scope as a row read.
  -- A count over the school shown to a team coach has already leaked.
  SELECT count(*) INTO n FROM player;
  PERFORM _assert(n = (SELECT count(*) FROM player WHERE team_code = 'U19A'),
                  'coach total count exceeds their team scope');

  -- ── 3. Availability is not diagnosis ───────────────────────────
  SELECT count(*) INTO n FROM injury;
  PERFORM _assert(n > 0, 'coach cannot see that a player is unavailable');
  SELECT count(*) INTO n FROM injury_masked WHERE notes IS NOT NULL;
  PERFORM _assert(n = 0, 'coach can read clinical notes');
  SELECT count(*) INTO n FROM injury_masked WHERE physio IS NOT NULL;
  PERFORM _assert(n = 0, 'coach can read physio notes');
  SELECT count(*) INTO n FROM injury_masked WHERE rtw_date IS NOT NULL;
  PERFORM _assert(n > 0, 'return-to-play date wrongly masked from the coach');

  PERFORM _as(U_MEDICAL);
  SELECT count(*) INTO n FROM injury_masked WHERE notes IS NOT NULL;
  PERFORM _assert(n > 0, 'medical staff cannot read clinical notes');

  -- ── 4. A minor's PII ───────────────────────────────────────────
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM player_masked WHERE born IS NOT NULL;
  PERFORM _assert(n = 0, 'coach can read a minor date of birth');
  SELECT count(*) INTO n FROM player_masked WHERE guardian IS NOT NULL;
  PERFORM _assert(n = 0, 'coach can read guardian details');
  SELECT count(*) INTO n FROM player_masked WHERE full_name IS NOT NULL;
  PERFORM _assert(n > 0, 'over-masking: coach cannot read player names');

  PERFORM _as(U_SCOUT);
  SELECT count(*) INTO n FROM player_masked WHERE born IS NOT NULL;
  PERFORM _assert(n = 0, 'scout can read a minor date of birth');

  -- ── 5. A guardian reaches their own children and no further ────
  PERFORM _as(U_PARENT);
  SELECT count(*) INTO n FROM player WHERE id <> P_INJURED;
  PERFORM _assert(n = 0, 'guardian sees children who are not theirs');
  SELECT count(*) INTO n FROM player WHERE id = P_INJURED;
  PERFORM _assert(n = 1, 'guardian cannot see their own child');
  SELECT count(*) INTO n FROM injury WHERE player_id <> P_INJURED;
  PERFORM _assert(n = 0, 'guardian sees another child injury');
  -- A guardian may read their own child's PII, unlike the coach above.
  SELECT count(*) INTO n FROM player_masked WHERE born IS NOT NULL;
  PERFORM _assert(n = 1, 'guardian cannot read their own child date of birth');
  -- …but not the clinical detail behind it.
  SELECT count(*) INTO n FROM injury_masked WHERE notes IS NOT NULL;
  PERFORM _assert(n = 0, 'guardian can read clinical notes');

  -- ── 6. Sarah: four assignments across two institutions ─────────
  -- The case the previous single-role, single-school session could not
  -- express at all.
  PERFORM _as(U_SARAH);
  -- Director of Sport reaches every Hilton player…
  -- Every Hilton player, including the U16B side she does not coach and the
  -- U19A side she has no assignment over: Director of Sport is school-scoped.
  SELECT count(*) INTO n FROM player WHERE school_id = HIL;
  PERFORM _assert(n = 6, 'Director of Sport does not reach the whole school');
  SELECT count(*) INTO n FROM player WHERE school_id = HIL AND team_code = 'U19A';
  PERFORM _assert(n = 5, 'Director of Sport misses a team she does not coach');
  -- …and guardianship reaches exactly one child at the OTHER school…
  SELECT count(*) INTO n FROM player WHERE school_id = WES;
  PERFORM _assert(n = 1, 'cross-school guardian scope is wrong');
  SELECT count(*) INTO n FROM player WHERE id = P_WES;
  PERFORM _assert(n = 1, 'Sarah cannot see her Westville child');
  -- …and NOT the other Westville players. This is the union bug: staff
  -- authority at Hilton must not travel to Westville with her.
  SELECT count(*) INTO n FROM player WHERE id = P_WES2;
  PERFORM _assert(n = 0, 'staff authority leaked across the tenant boundary');

  -- Her Hilton coaching assignment must not widen the Westville relationship.
  SELECT count(*) INTO n FROM injury WHERE school_id = WES;
  PERFORM _assert(n = 0, 'Sarah sees Westville injuries');

  -- ── 7. Scoring one match is not standing squad access ──────────
  PERFORM _as(U_SCORER);
  SELECT count(*) INTO n FROM match;
  PERFORM _assert(n > 0, 'scorer cannot see fixtures');
  SELECT count(*) INTO n FROM injury;
  PERFORM _assert(n = 0, 'scorer can read injuries');
  SELECT count(*) INTO n FROM player_masked WHERE born IS NOT NULL;
  PERFORM _assert(n = 0, 'scorer can read a minor date of birth');

  -- ── 8. Writes are refused, not silently dropped ────────────────
  PERFORM _as(U_SCOUT);
  BEGIN
    INSERT INTO player (id, school_id, team_code, full_name)
    VALUES (gen_random_uuid(), HIL, 'U19A', 'Injected');
    PERFORM _assert(false, 'scout INSERT into player succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  PERFORM _as(U_COACH);
  BEGIN
    UPDATE player SET full_name = 'Renamed' WHERE school_id = WES;
    PERFORM _assert((SELECT count(*) FROM player WHERE full_name = 'Renamed') = 0,
                    'coach updated a row in another school');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- ── 9. The four tables that had no policy at all ──────────────
  -- school, app_user, ground and match_squad ran with row-level security
  -- switched OFF. Nothing was misconfigured; they were simply never listed,
  -- and an unlisted table is wide open rather than closed. These assertions
  -- exist so that a table dropping out of the policy source is a failing
  -- test rather than a silent disclosure.
  PERFORM _assert(
    (SELECT bool_and(relrowsecurity) FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'),
    'some table in public has row-level security disabled');

  -- app_user was a cross-tenant directory: every name and email, one login.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM app_user WHERE school_id = WES;
  PERFORM _assert(n = 0, 'coach can read users at another school');
  SELECT count(*) INTO n FROM app_user WHERE id = U_COACH;
  PERFORM _assert(n = 1, 'a person cannot read their own user record');

  -- ...and it stays closed for someone whose role does not include user.read.
  PERFORM _as(U_SCORER);
  SELECT count(*) INTO n FROM app_user WHERE id <> U_SCORER;
  PERFORM _assert(n = 0, 'scorer can read other user records');

  -- school: the tenant list. Attached schools only.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM school WHERE id = WES;
  PERFORM _assert(n = 0, 'coach can enumerate another tenant');
  SELECT count(*) INTO n FROM school WHERE id = HIL;
  PERFORM _assert(n = 1, 'coach cannot see their own school');
  -- Sarah is a guardian at Westville as well, so she legitimately sees both.
  PERFORM _as(U_SARAH);
  SELECT count(*) INTO n FROM school;
  PERFORM _assert(n = 2, 'a guardian at two schools cannot see both');

  -- match_squad: a list of named minors, anchored through its match.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM match_squad;
  PERFORM _assert(n > 0, 'coach cannot read their own team sheet');

  -- A scorer must be able to name a striker, so they read the squad too.
  PERFORM _as(U_SCORER);
  SELECT count(*) INTO n FROM match_squad;
  PERFORM _assert(n > 0, 'scorer cannot read the squad they are scoring');

  -- The sharpest case: a guardian's assignment lists their children, so the
  -- person anchor narrows a whole team sheet down to the one row that is
  -- theirs. Same table, same query, one row.
  PERFORM _as(U_PARENT);
  SELECT count(*) INTO n FROM match_squad;
  PERFORM _assert(n = 1, 'guardian sees more of the team sheet than their own child');
  SELECT count(*) INTO n FROM match_squad WHERE player_id = P_INJURED;
  PERFORM _assert(n = 1, 'guardian cannot see their own child on the team sheet');

  -- The ANY_SCOPE regression. A fixture names no person, so a guardian's
  -- child list has nothing to constrain — and before app_can() could say
  -- "this dimension does not apply", every guardian was denied every fixture.
  -- A parent could not see when their own child was playing.
  PERFORM _as(U_PARENT);
  SELECT count(*) INTO n FROM match;
  PERFORM _assert(n > 0, 'guardian cannot see any fixture');
  SELECT count(*) INTO n FROM match WHERE school_id = WES;
  PERFORM _assert(n = 0, 'guardian sees fixtures at a school they are not attached to');

  -- ground: not sensitive, but scoped like everything else.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM ground WHERE school_id = WES;
  PERFORM _assert(n = 0, 'coach can read another school''s grounds');

  -- ── 10. Revocation takes effect immediately ────────────────────
  -- This is the property the SECURITY DEFINER lookup was chosen for. Nothing
  -- about authority is carried in the session, so deactivating an assignment
  -- applies on the very next statement rather than at next login.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM player;
  PERFORM _assert(n > 0, 'coach starts with no visible players');

  PERFORM _revoke('88888888-0000-0000-0000-000000000004');

  SELECT count(*) INTO n FROM player;
  PERFORM _assert(n = 0, 'a revoked assignment still grants access');

  RAISE NOTICE 'ALL RLS LIVE ASSERTIONS PASSED';
END $$;

ROLLBACK;
\set QUIET off

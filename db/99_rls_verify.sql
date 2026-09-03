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
  -- The falsifying principal for the notification capability gate. It has to
  -- be a real spectator: the user seeded as spectator@example.invalid holds a
  -- PLAYER assignment, and the player bundle includes medical.status.read, so
  -- it would pass the assertion below for the wrong reason and prove nothing.
  U_WATCHER uuid := '88888888-0000-0000-0000-000000000008';
  -- Seeded as spectator@example.invalid, but the ASSIGNMENT is role `player`
  -- at Hilton — a pupil. The one principal that separates the availability
  -- tier from the nature tier.
  U_PUPIL   uuid := '88888888-0000-0000-0000-000000000001';
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

  -- The coach picks a side, so they need to know it is a hamstring and how bad.
  SELECT count(*) INTO n FROM injury_masked WHERE injury_type IS NOT NULL;
  PERFORM _assert(n > 0, 'coach cannot read what the injury is — they cannot manage a load');
  SELECT count(*) INTO n FROM injury_masked WHERE severity IS NOT NULL;
  PERFORM _assert(n > 0, 'coach cannot read how severe an injury is');

  PERFORM _as(U_MEDICAL);
  SELECT count(*) INTO n FROM injury_masked WHERE notes IS NOT NULL;
  PERFORM _assert(n > 0, 'medical staff cannot read clinical notes');

  -- ── 3b. A pupil knows WHO is out, not WHAT is wrong ─────────────
  -- The tier that was missing. `injury_type` reads "Grade 2 hamstring strain"
  -- — it IS the diagnosis — and it sat unmasked behind medical.status.read,
  -- which the player bundle holds. A pupil could read what was wrong with a
  -- teammate. Only notes and physio were protected, so the split meant to
  -- separate availability from clinical information was letting the clinical
  -- fact through in a column called "type".
  PERFORM _as(U_PUPIL);
  SELECT count(*) INTO n FROM injury_masked;
  PERFORM _assert(n > 0, 'a pupil cannot see that a team mate is unavailable at all');
  SELECT count(*) INTO n FROM injury_masked WHERE rtw_date IS NOT NULL;
  PERFORM _assert(n > 0, 'a pupil cannot see when a team mate is expected back');
  SELECT count(*) INTO n FROM injury_masked WHERE restricted IS NOT NULL;
  PERFORM _assert(n > 0, 'a pupil cannot see that a team mate is restricted');

  SELECT count(*) INTO n FROM injury_masked WHERE injury_type IS NOT NULL;
  PERFORM _assert(n = 0, 'a pupil can read WHAT is wrong with a team mate');
  SELECT count(*) INTO n FROM injury_masked WHERE severity IS NOT NULL;
  PERFORM _assert(n = 0, 'a pupil can read how severe a team mate''s injury is');
  SELECT count(*) INTO n FROM injury_masked WHERE phase IS NOT NULL;
  PERFORM _assert(n = 0, 'a pupil can read a team mate''s rehabilitation stage');
  SELECT count(*) INTO n FROM injury_masked WHERE notes IS NOT NULL;
  PERFORM _assert(n = 0, 'a pupil can read clinical notes');

  -- A parent needs to know what is wrong with their OWN child. Their
  -- assignment names that child, so the capability reaches no further — the
  -- same row, read by the same policy, answers differently for them than for
  -- the pupil above.
  PERFORM _as(U_PARENT);
  SELECT count(*) INTO n FROM injury_masked WHERE injury_type IS NOT NULL;
  PERFORM _assert(n = 1, 'a guardian cannot read what is wrong with their own child');

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

  -- ── 9. Views do not smuggle rows past the policies ─────────────
  -- A view runs with the permissions of its OWNER unless it says otherwise,
  -- and the owner of these owns the tables underneath them — so row-level
  -- security was evaluated as a role that bypasses it, and player_masked
  -- returned EVERY player at EVERY school to anyone who could select from it.
  -- Through the one object the read path is REQUIRED to use for personal
  -- information, and invisibly: the leaked rows were still column-masked, so
  -- each one looked exactly right.
  PERFORM _assert(
    (SELECT bool_and(reloptions::text LIKE '%security_invoker%')
       FROM pg_class WHERE relkind = 'v' AND relnamespace = 'public'::regnamespace),
    'a view in public runs as its owner and bypasses row-level security');

  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM player_masked WHERE school_id = WES;
  PERFORM _assert(n = 0, 'the masked view leaks another school''s players');
  -- The view and the table it wraps must agree about WHICH rows exist; they
  -- may only disagree about which columns are readable.
  PERFORM _assert(
    (SELECT count(*) FROM player_masked) = (SELECT count(*) FROM player),
    'player_masked and player disagree about which rows exist');

  PERFORM _as(U_SCOUT);
  PERFORM _assert((SELECT count(*) FROM injury_masked) = (SELECT count(*) FROM injury),
                  'injury_masked and injury disagree about which rows exist');

  -- ── 10. The four tables that had no policy at all ──────────────
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

  -- ── 11. The programme tables ───────────────────────────────────
  -- Five areas that existed in the product and not in the database, so the
  -- browser was deciding all of them. Each assertion below is a decision that
  -- used to be made in JavaScript.

  -- training_session is a noticeboard fact, scoped to the team it is for.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM training_session;
  PERFORM _assert(n = 1, 'U19A coach should see exactly their own team''s session');
  SELECT count(*) INTO n FROM training_session WHERE team_code = 'U16B';
  PERFORM _assert(n = 0, 'U19A coach can read a U16B training session');

  -- The register is the sensitive half, and it is governed separately. A
  -- guardian holds player.profile.read but their assignment reaches only their
  -- own children, so they get the row for R Pillay and not the one for
  -- J Whitfield — from the same table, in the same session.
  PERFORM _as(U_PARENT);
  SELECT count(*) INTO n FROM training_attendance;
  PERFORM _assert(n = 1, 'guardian should see exactly their own child''s attendance row');
  SELECT count(*) INTO n FROM training_attendance WHERE player_id = P_INJURED;
  PERFORM _assert(n = 1, 'guardian cannot see their own child''s attendance');

  -- A guardian may read the SESSION (team.read, school-wide assignment) while
  -- reading only one row of the REGISTER. That asymmetry is the entire reason
  -- the two are separate tables.
  SELECT count(*) INTO n FROM training_session;
  PERFORM _assert(n > 1, 'guardian should still see the training schedule itself');

  -- player_skill: a coach's assessment of a named child. The guardian holds no
  -- player.development.read at all, so this is empty for them — a parent reads
  -- their child's profile and availability, not a coaching judgement of them.
  PERFORM _as(U_PARENT);
  SELECT count(*) INTO n FROM player_skill;
  PERFORM _assert(n = 0, 'guardian can read development assessments');

  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM player_skill;
  PERFORM _assert(n = 2, 'U19A coach should see their own squad''s assessments only');
  SELECT count(*) INTO n FROM player_skill WHERE player_id = P_U16B;
  PERFORM _assert(n = 0, 'U19A coach can read a U16B player''s assessment');

  -- ── 11b. A notification is not permission ──────────────────────
  -- The one that matters most. news.read is a floor capability; if it were the
  -- only gate, the feed would be a side channel around every policy above.
  -- Each row declares the capability its SUBJECT MATTER requires and the
  -- policy demands both, in the same scope.

  -- The player-role principal holds news.read and NOT medical.status.read.
  PERFORM _as(U_WATCHER);
  SELECT count(*) INTO n FROM notification WHERE id = '40170000-0000-0000-0000-000000000001';
  PERFORM _assert(n = 1, 'a general school notice did not reach someone holding news.read');
  SELECT count(*) INTO n FROM notification WHERE id = '40170000-0000-0000-0000-000000000002';
  PERFORM _assert(n = 0,
    'a MEDICAL notice reached a principal with no medical.status.read — the notification feed is a way around RLS');

  -- The medical officer holds both, school-wide.
  PERFORM _as(U_MEDICAL);
  SELECT count(*) INTO n FROM notification WHERE id = '40170000-0000-0000-0000-000000000002';
  PERFORM _assert(n = 1, 'the medical officer cannot read a medical notice');

  -- Scope still applies on top of the capability: the U19A coach holds
  -- medical.status.read and reads the U19A medical notice, but must not
  -- receive the U16B team notice even though it only requires news.read.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM notification WHERE id = '40170000-0000-0000-0000-000000000002';
  PERFORM _assert(n = 1, 'U19A coach cannot read their own team''s medical notice');
  SELECT count(*) INTO n FROM notification WHERE id = '40170000-0000-0000-0000-000000000003';
  PERFORM _assert(n = 0, 'U19A coach received a U16B team notice');

  -- A school-wide notice carries team_code NULL. A NULL on a resource NARROWS,
  -- so without the COALESCE to ANY_SCOPE in the generated policy this would be
  -- invisible to every team-scoped person in the school.
  SELECT count(*) INTO n FROM notification WHERE id = '40170000-0000-0000-0000-000000000001';
  PERFORM _assert(n = 1, 'a school-wide notice is invisible to a team-scoped coach');

  -- Publishing is scope-shaped. The coach holds news.publish.team and not
  -- news.publish.school, so a school-level notice must be refused.
  BEGIN
    INSERT INTO notification (school_id, team_code, scope_level, kind, title, body)
    VALUES (HIL, NULL, 'school', 'system', 'Unauthorised', 'Should not commit');
    PERFORM _assert(false, 'a coach published a SCHOOL notice holding only news.publish.team');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ...and the team notice they may publish goes through.
  INSERT INTO notification (school_id, team_code, scope_level, kind, title, body)
  VALUES (HIL, 'U19A', 'team', 'training', 'Nets moved', 'Nets 1-3 at 14:30.');

  -- The catalogue must not be writable by the application role: a row here
  -- would let a notice declare a capability the model never defined.
  BEGIN
    INSERT INTO capability (name) VALUES ('invented.capability');
    PERFORM _assert(false, 'the application role can write the capability catalogue');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ── 11c. Participation, not authorship, decides a league ───────
  -- The competition is seeded with school_id NULL because that was the only
  -- way a shared league could be readable before competition_entrant existed.
  -- What is new is that the ladder itself is scoped and readable whole: a
  -- team-scoped coach must see BOTH entrants, or the log has one row in it.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM competition_entrant
   WHERE competition_id = '99999999-0000-0000-0000-000000000001';
  PERFORM _assert(n = 2, 'a team-scoped coach cannot read the full league ladder');

  -- Weather inherits the fixture's policy rather than being left open on the
  -- grounds that rain is not confidential.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM match_weather;
  PERFORM _assert(n = 1, 'coach cannot read conditions for their own fixture');

  -- ── 11d. Read state is per person and not a capability ─────────
  PERFORM _as(U_COACH);
  INSERT INTO notification_read (notification_id, person_id)
  VALUES ('40170000-0000-0000-0000-000000000001', U_COACH);
  BEGIN
    INSERT INTO notification_read (notification_id, person_id)
    VALUES ('40170000-0000-0000-0000-000000000001', U_MEDICAL);
    PERFORM _assert(false, 'one person marked a notice read on another person''s behalf');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM _as(U_MEDICAL);
  SELECT count(*) INTO n FROM notification_read;
  PERFORM _assert(n = 0, 'one person can see which notices another person has opened');

  -- ── 12. Revocation takes effect immediately ────────────────────
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

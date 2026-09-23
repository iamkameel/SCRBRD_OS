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

-- Reach past RLS to state a fact about the whole table. Used only where the
-- claim IS "no such row exists anywhere" — an assertion scoped to what one
-- reader can see could not tell an empty table from a well-hidden row.
CREATE OR REPLACE FUNCTION _count_open_guardian_links() RETURNS integer AS $$
  SELECT count(*)::int FROM assignment_subject s
    JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
   WHERE s.valid_until IS NULL;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION _count_guardian_assignments(p_person uuid) RETURNS integer AS $$
  SELECT count(*)::int FROM role_assignment
   WHERE person_id = p_person AND role = 'guardian';
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION _count_subjects(p_player uuid) RETURNS integer AS $$
  SELECT count(*)::int FROM assignment_subject WHERE player_id = p_player;
$$ LANGUAGE sql SECURITY DEFINER;

-- db/11 forbids a player with no date of birth, so the state the guardian
-- guard exists for can no longer be CREATED — only inherited. The constraint
-- is NOT VALID, which is the whole point: rows written before it are still
-- there, and guardian_link_establish() still has to refuse them. Lifting the
-- constraint for one INSERT is how that legacy row is reproduced honestly,
-- rather than deleting an assertion because the happy path got safer.
--
-- Safe because the whole file runs inside one transaction and ends in
-- ROLLBACK: the constraint is restored either way, including on a failure.
CREATE OR REPLACE FUNCTION _born_constraint(p_on boolean) RETURNS void AS $$
BEGIN
  IF p_on THEN
    ALTER TABLE player ADD CONSTRAINT player_born_required CHECK (born IS NOT NULL) NOT VALID;
  ELSE
    ALTER TABLE player DROP CONSTRAINT IF EXISTS player_born_required;
  END IF;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION _count_accounts(p_email text) RETURNS integer AS $$
  SELECT count(*)::int FROM app_user WHERE lower(email) = lower(p_email);
$$ LANGUAGE sql SECURITY DEFINER;

-- Move a child's eighteenth birthday, or take their date of birth away. Both
-- are owner-only edits, and both roll back with the transaction.
CREATE OR REPLACE FUNCTION _set_born(p_player uuid, p_born date) RETURNS void AS $$
  UPDATE player SET born = p_born WHERE id = p_player;
$$ LANGUAGE sql SECURITY DEFINER;

-- Wind a live link's end date back to a date already past. This is how the
-- "expiry is live, there is no cron" claim is made falsifiable: nothing runs
-- between this and the read that follows it except app_can() itself.
CREATE OR REPLACE FUNCTION _expire_link(p_player uuid) RETURNS void AS $$
  UPDATE assignment_subject s SET valid_until = s.valid_from
    FROM role_assignment a
   WHERE a.id = s.assignment_id AND a.role = 'guardian' AND s.player_id = p_player;
$$ LANGUAGE sql SECURITY DEFINER;

-- Wind a support session's hour hand back to a second ago (SCRBRD-012). The
-- same claim as _expire_link, about the same rule: the decision functions
-- read expires_at on every statement, and nothing else has to run.
CREATE OR REPLACE FUNCTION _expire_support(p_id uuid) RETURNS void AS $$
  UPDATE role_assignment a SET expires_at = now() - interval '1 second'
    FROM support_access s
   WHERE s.id = p_id AND a.id = s.assignment_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- SCRBRD-059. The handover section starts from no session at all, whatever a
-- demonstration left on that match, and lets a lease lapse the way ninety
-- seconds of silence would. scoring_session has no UPDATE or DELETE policy by
-- design — transitions go through the definer functions — so both are owner
-- edits, and both roll back with the transaction.
CREATE OR REPLACE FUNCTION _scoring_session_reset(p_match uuid) RETURNS void AS $$
  DELETE FROM scoring_session WHERE match_id = p_match;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION _lapse_scoring_lease(p_match uuid) RETURNS void AS $$
  UPDATE scoring_session SET lease_until = now() - interval '1 minute' WHERE match_id = p_match;
$$ LANGUAGE sql SECURITY DEFINER;

-- SCRBRD-034. A fixture's status is what duty_status() (db/30) and the
-- completion gate (db/33) read, and moving it is an owner edit here — the
-- section needs one match walked scheduled → live → complete → abandoned.
CREATE OR REPLACE FUNCTION _set_match_status(p_match uuid, p_status text) RETURNS void AS $$
  UPDATE match SET status = p_status WHERE id = p_match;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION _lease_until(p_match uuid) RETURNS timestamptz AS $$
  SELECT lease_until FROM scoring_session WHERE match_id = p_match;
$$ LANGUAGE sql SECURITY DEFINER;

-- Two appointments on the handover section's match (U16B v Kearsney): the
-- seeded scorer, holding an account, so a handover can name him as the one
-- who passed the pen on — and an umpire already stood down.
INSERT INTO match_official (id, match_id, school_id, duty, person_name, person_id, withdrawn) VALUES
  ('d0730000-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'scorer', 'A Wessels', '88888888-0000-0000-0000-000000000006', false),
  ('d0730000-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'umpire', 'A Stood-Down Umpire', NULL, true)
ON CONFLICT DO NOTHING;

-- Fixtures this file needs that a database seeded before them never received.
-- Production was seeded once and has taken apply-NN bundles since, so the
-- verify bundle cannot assume the current db/98. Written as the owner, before
-- privilege drops, and rolled back with everything else; a no-op where the
-- seed already has them. The umpire: SCRBRD-053's one-fixture official.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-000000000023', '11111111-1111-1111-1111-111111111111',
   'e.ndlovu@example.invalid', 'E Ndlovu', 'official')
ON CONFLICT DO NOTHING;
INSERT INTO role_assignment (id, person_id, role, school_id, team_code, fixture_id) VALUES
  ('a5510000-0000-0000-0000-000000000023', '88888888-0000-0000-0000-000000000023', 'official',
   '11111111-1111-1111-1111-111111111111', NULL, '77777777-0000-0000-0000-000000000004')
ON CONFLICT DO NOTHING;

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
  U_COACH   uuid := '88888888-0000-0000-0000-000000000004';  -- coach of 1XI
  U_PARENT  uuid := '88888888-0000-0000-0000-000000000005';  -- guardian of R Pillay
  U_MEDICAL uuid := '88888888-0000-0000-0000-000000000003';
  U_SCOUT   uuid := '88888888-0000-0000-0000-000000000002';
  U_SCORER  uuid := '88888888-0000-0000-0000-000000000006';
  U_SARAH   uuid := '88888888-0000-0000-0000-000000000007';  -- 4 assignments, 2 schools
  U_PLAT    uuid := '88888888-0000-0000-0000-000000000014';  -- platformadmin, no school
  U_OWNER   uuid := '88888888-0000-0000-0000-000000000022';  -- superadmin, every capability
  -- For the newsfeed. NOT U_COACH: section 8 revokes his assignments to prove
  -- revocation narrows, and this file is one transaction, so he holds nothing
  -- by the time the news block runs.
  U_COACH2  uuid := '88888888-0000-0000-0000-00000000000a';  -- 2XI coach: team tier only
  U_MEDIC   uuid := '88888888-0000-0000-0000-000000000003';  -- news.read, no publish tier
  O_UMPIRE  uuid;                                            -- seeded into the register below
  v_born    date;
  v_level   text;
  P_INJURED uuid := 'aaaaaaaa-0000-0000-0000-000000000005';  -- R Pillay, 1XI
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
  -- R Pillay: the injured 1XI player, with an account and a self-access
  -- assignment naming their own player row.
  U_SELF    uuid := '88888888-0000-0000-0000-000000000009';
  P_OTHER   uuid := 'aaaaaaaa-0000-0000-0000-000000000002';  -- T Bekker, also injured
  I_OWN     uuid := 'cccccccc-0000-0000-0000-000000000001';  -- R Pillay's injury, 1XI
  I_U16B    uuid := 'cccccccc-0000-0000-0000-000000000003';  -- K Dlamini's injury, U16B
  -- The majority fixtures. S Naidoo is seeded past eighteen ON PURPOSE (see
  -- 98_seed_pilot.sql), so his guardian link is the one that has already
  -- ended. B Khumalo is U13A with no guardian link at all, which leaves him
  -- free to be linked and re-linked by the assertions below without
  -- disturbing anything else the file asserts.
  U_REGISTRAR uuid := '88888888-0000-0000-0000-00000000000c';  -- holds guardian.link.manage
  U_NAIDOO  uuid := '88888888-0000-0000-0000-000000000012';  -- parent of an adult
  U_BURSAR  uuid := '88888888-0000-0000-0000-000000000015';  -- holds no guardian assignment
  P_ADULT   uuid := 'aaaaaaaa-0000-0000-0000-000000000003';  -- S Naidoo, eighteen
  P_U13     uuid := 'aaaaaaaa-0000-0000-0000-000000000013';  -- B Khumalo, unlinked
  v_ok      boolean;
  v_reason  text;
  S_ID      uuid;         -- a support session (SCRBRD-012)
  S_EXP     timestamptz;
  -- The disciplinary record (SCRBRD-053) — the accounts this file did not
  -- already name. The six grants on discipline.read/write are four distinct
  -- scope shapes: school-scoped, subject-scoped (a pupil's own), one-fixture
  -- (an umpire's appointment) and no-school-at-all (platform-wide).
  U_HEAD_M  uuid := '88888888-0000-0000-0000-000000000016';  -- principal, Hilton
  U_LEAGUE  uuid := '88888888-0000-0000-0000-000000000021';  -- competitionadmin, NO school
  U_UMPIRE  uuid := '88888888-0000-0000-0000-000000000023';  -- official, ONE fixture
  U_WES_ADM uuid := '88888888-0000-0000-0000-00000000000d';  -- schooladmin, Westville
  M_STOOD   uuid := '77777777-0000-0000-0000-000000000004';  -- the match he umpired
  M_OTHER   uuid := '77777777-0000-0000-0000-000000000002';  -- one he did not
  D_ID      uuid;
  -- SCRBRD-059: a match nothing else here scores, so the section owns its session.
  M_HANDOVER uuid := '77777777-0000-0000-0000-000000000003';
  v_epoch   integer;
  v_code    text;
  v_state   text;
  -- SCRBRD-034: the two appointments seeded above, and what a handover needs.
  O_SCORER  uuid := 'd0730000-0000-0000-0000-000000000001';
  O_STOOD   uuid := 'd0730000-0000-0000-0000-000000000002';
  v_until   timestamptz;
  v_runs    int;
  v_wkts    int;
  v_balls   int;
  A_ID      uuid;
  n int;
BEGIN
  -- ── 1. Nobody is anybody by default ────────────────────────────
  PERFORM set_config('app.user_id', '', true);
  SELECT count(*) INTO n FROM player;
  PERFORM _assert(n = 0, 'an unidentified session can read players');
  SELECT count(*) INTO n FROM match;
  PERFORM _assert(n = 0, 'an unidentified session can read matches');

  -- ── 2. The roster: rows widen to the school, columns do not ────
  -- A coach used to see only their own squad, full stop. That made the
  -- access-request workflow unusable — you cannot ask about a player you
  -- cannot see exists — and made it impossible to be told a boy in the band
  -- below is ageing up.
  --
  -- So ROW visibility widens to the whole school, and COLUMN visibility does
  -- not. The boundary did not disappear; it moved to where it belongs.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM player WHERE team_code = '1XI';
  PERFORM _assert(n > 0, 'coach sees none of their own team');
  SELECT count(*) INTO n FROM player WHERE team_code <> '1XI';
  PERFORM _assert(n > 0, 'coach cannot see the rest of the school roster');

  -- The tenant boundary is untouched, and this is the assertion that matters
  -- most about the widening: a roster is school-wide, never platform-wide.
  SELECT count(*) INTO n FROM player WHERE school_id = WES;
  PERFORM _assert(n = 0, 'coach reaches across the tenant boundary');

  -- Columns still answer to the team. Age is roster-tier and readable across
  -- the school — a coach considering a trial needs it, and so does anyone
  -- avoiding a fifteen-year-old in a U13 side.
  SELECT count(*) INTO n FROM player_masked WHERE team_code <> '1XI' AND born IS NOT NULL;
  PERFORM _assert(n > 0, 'age is not readable across the roster — trials and eligibility both need it');
  -- Everything else is not.
  SELECT count(*) INTO n FROM player_masked WHERE team_code <> '1XI' AND address IS NOT NULL;
  PERFORM _assert(n = 0, 'a coach reads the home address of a child in another side');
  SELECT count(*) INTO n FROM player_masked WHERE team_code <> '1XI' AND guardian IS NOT NULL;
  PERFORM _assert(n = 0, 'a coach reads the guardian details of a child in another side');
  SELECT count(*) INTO n FROM player_masked WHERE id_number IS NOT NULL;
  PERFORM _assert(n = 0, 'a coach reads a national ID number');

  -- And the roster does not become a way around the request workflow: seeing
  -- that a child exists is not seeing whether they are fit to play.
  SELECT count(*) INTO n FROM injury_masked i
    JOIN player p ON p.id = i.player_id WHERE p.team_code <> '1XI';
  PERFORM _assert(n = 0, 'the roster leaked another side''s medical information');

  -- The §36 case: an AGGREGATE must obey the same scope as a row read. It
  -- still does — what changed is the scope, not the rule. A coach's count is
  -- now their SCHOOL, because the roster made the rows visible, and it must
  -- still stop dead at the tenant boundary.
  --
  -- This assertion previously compared against their own team, and the roster
  -- turned it red. That is the assertion working: a widening that no test
  -- notices is a widening nobody reviewed.
  SELECT count(*) INTO n FROM player;
  PERFORM _assert(n = (SELECT count(*) FROM player WHERE school_id = HIL),
                  'coach total count exceeds their school');
  -- And the school is not the platform: Westville's players are outside it,
  -- which the tenant assertion above already proved by row and this proves by
  -- count. An aggregate leaks as surely as a row.
  -- Derived from the fixture rather than a literal: the seed grows, and a
  -- hardcoded 6 turns red the next time somebody adds a player, which trains
  -- people to edit the number instead of reading the assertion.
  PERFORM _assert(n = (SELECT count(*) FROM player WHERE school_id = HIL),
                  'the coach''s count is not every Hilton player');
  PERFORM _assert(n > (SELECT count(*) FROM player WHERE school_id = HIL AND team_code = '1XI'),
                  'the roster is no wider than the coach''s own side');

  -- ── 3. The coach of the side holds an OVERVIEW, not the full record ──
  -- ADR 0002 (decided): a coach reads the nature tier — what the injury is,
  -- how severe, when he is expected back — for the children they coach, and
  -- not the physio's clinical write-up. What keeps the nature tier itself
  -- safe is SCOPE, not tier: a coach assignment must name a team, and the
  -- injury policy anchors through player.team_code, so the reach is their
  -- own current squad and stops there. Every assertion in this block is
  -- about that boundary, plus the one tier that stays shut regardless of it.
  SELECT count(*) INTO n FROM injury;
  PERFORM _assert(n > 0, 'coach cannot see that a player is unavailable');
  SELECT count(*) INTO n FROM injury_masked WHERE notes IS NOT NULL;
  PERFORM _assert(n = 0, 'coach reads the clinical notes — ADR 0002 keeps those with the physio');
  SELECT count(*) INTO n FROM injury_masked WHERE physio IS NOT NULL;
  PERFORM _assert(n = 0, 'coach sees who is treating their own player — not part of the overview');
  SELECT count(*) INTO n FROM injury_masked WHERE rtw_date IS NOT NULL;
  PERFORM _assert(n > 0, 'return-to-play date wrongly masked from the coach');

  -- The line that matters now that the nature tier is open to them: their
  -- OWN side.
  --
  -- Addressed by injury id, NOT by joining to player and filtering on
  -- team_code. That join was the first version of this assertion and it could
  -- not fail: the coach's player policy already drops a U16B player, so the
  -- join removed the row whatever the injury policy said. It was testing the
  -- wrong policy, and widening the injury team anchor to ANY_SCOPE — which
  -- really does hand the coach all three injuries — left it green.
  SELECT count(*) INTO n FROM injury_masked WHERE id = I_U16B;
  PERFORM _assert(n = 0, 'a coach reads an injury outside the side they coach');
  SELECT count(*) INTO n FROM injury_masked WHERE id = I_U16B AND injury_type IS NOT NULL;
  PERFORM _assert(n = 0, 'a coach reads the nature of an injury outside the side they coach');
  -- …while their own side's nature is there, so this is a boundary and not a
  -- blanket refusal.
  SELECT count(*) INTO n FROM injury_masked WHERE id = I_OWN AND injury_type IS NOT NULL;
  PERFORM _assert(n = 1, 'a coach cannot read the nature of an injury for a player they coach');
  -- And the clinical notes are shut on their OWN side too — not merely at
  -- the team boundary above, which a details-tier grant could satisfy on its
  -- own and leave this hole open.
  SELECT count(*) INTO n FROM injury_masked WHERE id = I_OWN AND notes IS NOT NULL;
  PERFORM _assert(n = 0, 'a coach reads the clinical notes for a player they coach');

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

  -- ── 3c. Your own file ──────────────────────────────────────────
  -- A pupil holds `player` for the things that are about the team, and that
  -- assignment reaches every team mate — so it cannot carry the capabilities
  -- that read a medical record. Self-access is its own assignment, named in
  -- assignment_subject as being about exactly one person, and the model's
  -- central rule does the rest: a capability applies only within the scope of
  -- the assignment granting it.
  PERFORM _as(U_SELF);

  -- Their own record, in full — nature AND the physiotherapy notes. A person
  -- reading their own health record is not a disclosure.
  SELECT count(*) INTO n FROM injury_masked
   WHERE player_id = P_INJURED AND injury_type IS NOT NULL;
  PERFORM _assert(n = 1, 'a player cannot read what is wrong with themselves');
  SELECT count(*) INTO n FROM injury_masked
   WHERE player_id = P_INJURED AND notes IS NOT NULL;
  PERFORM _assert(n = 1, 'a player cannot read their own clinical notes');
  SELECT count(*) INTO n FROM injury_masked
   WHERE player_id = P_INJURED AND physio IS NOT NULL;
  PERFORM _assert(n = 1, 'a player cannot see who is treating them');

  -- And nobody else's. This is the assertion the second seeded injury exists
  -- for: with one injury in the fixture, "reads their own" and "reads
  -- everything" are the same answer.
  SELECT count(*) INTO n FROM injury_masked
   WHERE player_id = P_OTHER AND injury_type IS NOT NULL;
  PERFORM _assert(n = 0, 'self-access reads another player''s diagnosis');
  SELECT count(*) INTO n FROM injury_masked
   WHERE player_id = P_OTHER AND notes IS NOT NULL;
  PERFORM _assert(n = 0, 'self-access reads another player''s clinical notes');

  -- They still see that the other player is UNAVAILABLE, through their
  -- separate `player` assignment. The two assignments are doing different
  -- jobs at different scopes, in the same session, on the same table.
  SELECT count(*) INTO n FROM injury_masked WHERE player_id = P_OTHER;
  PERFORM _assert(n = 1, 'a player cannot see that a team mate is unavailable');

  -- Their own PII, likewise: their date of birth is theirs.
  SELECT count(*) INTO n FROM player_masked WHERE id = P_INJURED AND born IS NOT NULL;
  PERFORM _assert(n = 1, 'a player cannot read their own date of birth');
  SELECT count(*) INTO n FROM player_masked WHERE id = P_OTHER AND born IS NOT NULL;
  PERFORM _assert(n = 0, 'self-access leaks a team mate''s date of birth');

  -- ── 3d. A coach reaches the team they coach, not the school ────
  -- A NULL team_code widens to every team in the school. Right for a head of
  -- sport, wrong for a coach: a coach reaches a player's medical information
  -- because they coach that player's CURRENT side. Enforced as a constraint
  -- rather than a convention, so it cannot be got wrong when an assignment is
  -- created at half past four on a Friday.
  -- Asserted on the constraint itself rather than by attempting an insert:
  -- scrbrd_app cannot write role_assignment anyway, so an insert here would be
  -- refused for the wrong reason and the assertion would pass while the
  -- constraint was missing.
  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conrelid = 'role_assignment'::regclass
     AND conname  = 'assignment_team_scoped';
  PERFORM _assert(n = 1, 'the constraint keeping a coach inside their own team is missing');

  SELECT count(*) INTO n
    FROM pg_get_constraintdef(
           (SELECT oid FROM pg_constraint
             WHERE conrelid = 'role_assignment'::regclass
               AND conname = 'assignment_team_scoped')) AS d(def)
   WHERE d.def LIKE '%coach%' AND d.def LIKE '%team_code IS NOT NULL%';
  PERFORM _assert(n = 1, 'the constraint exists but does not cover coaches');

  -- And nothing in the data slipped through before it existed.
  SELECT count(*) INTO n FROM role_assignment
   WHERE role IN ('coach','assistantcoach','teammanager') AND team_code IS NULL;
  PERFORM _assert(n = 0, 'a coach assignment with no team is present in the data');

  -- ── 4. A minor's PII ───────────────────────────────────────────
  PERFORM _as(U_COACH);
  -- A coach picking a U13 side who cannot see an age cannot avoid putting a
  -- fifteen-year-old in it. Age is operational information for anyone who
  -- selects a team, so it has its own capability and they hold it.
  SELECT count(*) INTO n FROM player_masked WHERE born IS NOT NULL;
  PERFORM _assert(n > 0, 'coach cannot read a date of birth — they cannot check eligibility');
  -- And the tier above it is still shut. The ID number is the most dangerous
  -- field about a child in this schema: issued once, never changed, useful to
  -- a fraudster for life. The school office holds it and nobody else.
  SELECT count(*) INTO n FROM player_masked WHERE id_number IS NOT NULL;
  PERFORM _assert(n = 0, 'coach can read a minor''s national ID number');
  SELECT count(*) INTO n FROM player_masked WHERE guardian IS NOT NULL;
  PERFORM _assert(n = 0, 'coach can read guardian details');
  SELECT count(*) INTO n FROM player_masked WHERE address IS NOT NULL;
  PERFORM _assert(n = 0, 'coach can read a minor''s home address');
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
  -- …and the clinical detail behind it, for their own child. A parent reading
  -- their child's physiotherapy report is the ordinary case, not an exception
  -- — the school would hand them the same letter. Their assignment names that
  -- child, so it goes no further, which the row count above already proved.
  SELECT count(*) INTO n FROM injury_masked WHERE notes IS NOT NULL;
  PERFORM _assert(n = 1, 'a guardian cannot read their own child''s clinical notes');

  -- ── 6. Sarah: four assignments across two institutions ─────────
  -- The case the previous single-role, single-school session could not
  -- express at all.
  PERFORM _as(U_SARAH);
  -- Director of Sport reaches every Hilton player…
  -- Every Hilton player, including the U16B side she does not coach and the
  -- 1XI side she has no assignment over: Director of Sport is school-scoped.
  -- Counted against the fixture, not a literal, for the same reason as the
  -- coach's roster above: the seed grows, and a hardcoded number trains people
  -- to edit the count rather than read the claim.
  -- Asserted on NAMED players rather than a count. The count version compared
  -- a query against itself — both sides run under the same policy, so it was
  -- true for every input including one where she saw nobody.
  --
  -- She coaches U16B and is Director of Sport. So: the U16B player she coaches,
  -- AND a 1XI player she has no assignment over, both reachable — which is the
  -- actual claim, that the school-scoped role reaches past the team-scoped one.
  SELECT count(*) INTO n FROM player WHERE id = P_U16B;
  PERFORM _assert(n = 1, 'Director of Sport cannot see the side she coaches');
  SELECT count(*) INTO n FROM player WHERE id = P_INJURED;
  PERFORM _assert(n = 1, 'Director of Sport does not reach a team she does not coach');
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
    VALUES (gen_random_uuid(), HIL, '1XI', 'Injected');
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

  -- ── 10b. An injury alerts the circle of care, and only them ────
  -- A trigger on `injury` publishes a notice declaring medical.nature.read and
  -- naming the player it is about. Nobody is listed as a recipient anywhere:
  -- the audience falls out of the capability model, and these assertions are
  -- how we know it lands where you would want it to.
  -- Counted against the fixture rather than a fixed number, so adding an
  -- injury to the seed cannot quietly make these pass for the wrong reason.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND required_capability = 'medical.nature.read';
  PERFORM _assert(
    n = (SELECT count(*) FROM injury i JOIN player p ON p.id = i.player_id
          WHERE p.team_code = '1XI'),
    'the coach was not alerted to exactly their own side''s injuries');
  -- Specifically: not the U16B one.
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND subject_person_id = P_U16B;
  PERFORM _assert(n = 0, 'a coach was alerted about a player in another side');

  PERFORM _as(U_MEDICAL);
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND required_capability = 'medical.nature.read';
  PERFORM _assert(n = (SELECT count(*) FROM injury), 'medical staff were not alerted to every injury');

  -- The parent of ONE child. Their assignment names that child, so the person
  -- anchor on the notice has something to fail against — without it, a notice
  -- is about nobody in particular and every guardian in the team receives an
  -- alert about somebody else's child.
  PERFORM _as(U_PARENT);
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND subject_person_id = P_INJURED;
  PERFORM _assert(n = 1, 'the guardian was not alerted about their own child');
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND subject_person_id = P_OTHER;
  PERFORM _assert(n = 0, 'a guardian was alerted about somebody else''s child');

  -- The player themselves, through self-access.
  PERFORM _as(U_SELF);
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND subject_person_id = P_INJURED
     AND required_capability = 'medical.nature.read';
  PERFORM _assert(n = 1, 'a player was not told about their own injury');
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND subject_person_id = P_OTHER;
  PERFORM _assert(n = 0, 'self-access received an alert about a team mate');

  -- And NOT a team mate. The player bundle holds medical.status.read and not
  -- medical.nature.read, so the nature-tier alert does not reach them — while
  -- the status-tier availability notice does. The tier decides the audience.
  PERFORM _as(U_PUPIL);
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND required_capability = 'medical.nature.read';
  PERFORM _assert(n = 0, 'a team mate was alerted to what is wrong with a player');
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND required_capability = 'medical.status.read';
  PERFORM _assert(n = 1, 'a team mate was not told the player is unavailable');

  -- A spectator holds neither.
  PERFORM _as(U_WATCHER);
  SELECT count(*) INTO n FROM notification WHERE kind = 'injury';
  PERFORM _assert(n = 0, 'a spectator received an injury alert');

  -- ── 10c. A fifteen-year-old cannot be picked for a U13 side ────
  -- "U13" means thirteen AND UNDER. Getting this wrong is a safeguarding
  -- failure before it is a competitive one, so it is enforced by a trigger
  -- rather than by whichever screen happens to be writing the squad.
  --
  -- Asserted as the OWNER, deliberately: the trigger is the subject here, and
  -- running as scrbrd_app would have the row-level policy refuse the write
  -- first, which would pass this block for the wrong reason.
  PERFORM _as(U_COACH);

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'match_squad'::regclass AND tgname = 'match_squad_is_age_eligible';
  PERFORM _assert(n = 1, 'the age-eligibility trigger is missing from match_squad');

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
   WHERE nsp.nspname = 'public' AND p.proname = 'match_squad_age_eligible' AND p.prosecdef;
  PERFORM _assert(n = 1,
    'the eligibility check is not SECURITY DEFINER — it cannot read a masked date of birth');

  -- ── 10b. A minor with no verified guardian is not selected ─────
  -- §12.2. The rule is enforced at selection because that is where a school
  -- ACTS on a child's data, and it reads a DERIVED state rather than a flag:
  -- a child is registered, or is not, according to the links that exist now.
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'match_squad'::regclass AND tgname = 'match_squad_is_registered';
  PERFORM _assert(n = 1, 'the registration trigger is missing from match_squad');

  SELECT count(*) INTO n FROM pg_views WHERE schemaname = 'public'
     AND viewname = 'player_guardian_status';
  PERFORM _assert(n = 1, 'player_guardian_status is missing');

  -- A view runs as its OWNER unless told otherwise, and this one reads
  -- `player`. Without security_invoker the office would see every child at
  -- every school through it.
  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'player_guardian_status'
     AND reloptions @> ARRAY['security_invoker=true'];
  PERFORM _assert(n = 1, 'player_guardian_status is not security_invoker');

  -- The link table has a read policy and NO write policy at all: every write
  -- goes through a SECURITY DEFINER function that checks its own authority.
  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid = 'assignment_subject'::regclass AND polcmd <> 'r';
  PERFORM _assert(n = 0, 'assignment_subject has a write policy — links must go through the functions');

  -- ── 11. The programme tables ───────────────────────────────────
  -- Five areas that existed in the product and not in the database, so the
  -- browser was deciding all of them. Each assertion below is a decision that
  -- used to be made in JavaScript.

  -- training_session is a noticeboard fact, scoped to the team it is for.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM training_session;
  PERFORM _assert(n = 1, '1XI coach should see exactly their own team''s session');
  SELECT count(*) INTO n FROM training_session WHERE team_code = 'U16B';
  PERFORM _assert(n = 0, '1XI coach can read a U16B training session');

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

  -- Asserted as the PROPERTY rather than as a count. This read `n = 2`, which
  -- was true of the seed on the day it was written and stopped being true when
  -- the seed gained two more attribute rows for the same 1XI boy — so a
  -- verifier meant to catch a scope leak failed for a reason that had nothing
  -- to do with scope, and the only way to keep it passing was to keep editing
  -- a number. What it is actually for is: every row this coach can see belongs
  -- to a team they coach, and there is at least one, so an empty result cannot
  -- pass for a clean one.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM player_skill;
  PERFORM _assert(n > 0, '1XI coach sees no assessments at all');
  SELECT count(*) INTO n
    FROM player_skill s JOIN player p ON p.id = s.player_id
   WHERE p.team_code <> '1XI';
  PERFORM _assert(n = 0, '1XI coach should see their own squad''s assessments only');
  SELECT count(*) INTO n FROM player_skill WHERE player_id = P_U16B;
  PERFORM _assert(n = 0, '1XI coach can read a U16B player''s assessment');

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

  -- Scope still applies on top of the capability: the 1XI coach holds
  -- medical.status.read and reads the 1XI medical notice, but must not
  -- receive the U16B team notice even though it only requires news.read.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM notification WHERE id = '40170000-0000-0000-0000-000000000002';
  PERFORM _assert(n = 1, '1XI coach cannot read their own team''s medical notice');
  SELECT count(*) INTO n FROM notification WHERE id = '40170000-0000-0000-0000-000000000003';
  PERFORM _assert(n = 0, '1XI coach received a U16B team notice');

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
  VALUES (HIL, '1XI', 'team', 'training', 'Nets moved', 'Nets 1-3 at 14:30.');

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

  -- ── SCRBRD-039. What an innings declared it would capture ─────
  -- db/31's two views derive the declaration from innings_start rows and grade
  -- placement against it. Two things to prove against the real policies:
  --
  --   - The seed's one scored innings (Maritzburg, …0004) declared nothing,
  --     like every innings before SCRBRD-039, and must read EXACTLY as db/08's
  --     count-only label always graded it — the backward-compatibility claim,
  --     live, on sector-era and point-era balls together.
  --   - The views are the caller's view of the log and nothing more: every
  --     innings they name is one whose rows the reader can see, and a
  --     principal with no assignment sees none.
  --
  -- What a DECLARED innings reads is driven through the real API, lease and
  -- epoch in tools/smoke-fold.mjs; it cannot be written from here without
  -- holding a scoring session.
  PERFORM _as(U_COACH);
  DECLARE
    m_seed uuid := '77777777-0000-0000-0000-000000000004';
    r      record;
    v_pts  bigint;
    v_plc  bigint;
  BEGIN
    SELECT count(*) FILTER (WHERE placement_source = 'point'),
           count(*) FILTER (WHERE theta IS NOT NULL OR seg IS NOT NULL)
      INTO v_pts, v_plc
      FROM ball_event_live WHERE match_id = m_seed AND innings = 0 AND kind = 'ball';
    PERFORM _assert(v_pts > 0 AND v_plc > v_pts,
      'the coach cannot see the seeded innings (points and sector-era balls) the declared-profile checks read');
    SELECT * INTO r FROM innings_placement_evidence WHERE match_id = m_seed AND innings = 0;
    PERFORM _assert(r.match_id IS NOT NULL, 'innings_placement_evidence does not show the coach his own side''s innings');
    PERFORM _assert(r.declared_profile IS NULL,
      format('an innings with no declaration reads as declared %s', r.declared_profile));
    PERFORM _assert(r.points = v_pts AND r.placed = v_plc,
      format('innings_placement_evidence counts %s points / %s placed; the log holds %s / %s', r.points, r.placed, v_pts, v_plc));
    PERFORM _assert(r.point_evidence = evidence_label(v_pts) AND r.placement_evidence = evidence_label(v_plc),
      format('an undeclared innings no longer reads as before: %s / %s, db/08 says %s / %s',
             r.point_evidence, r.placement_evidence, evidence_label(v_pts), evidence_label(v_plc)));
    PERFORM _assert(NOT EXISTS (SELECT 1 FROM innings_placement_evidence WHERE point_evidence = 'not_captured'
                                                                         OR placement_evidence = 'not_captured')
                    AND NOT EXISTS (SELECT 1 FROM innings_declared_profile),
      'the seed declared nothing, yet something in it is excused as not captured');
    PERFORM _assert(NOT EXISTS (
        SELECT 1 FROM innings_placement_evidence e
         WHERE NOT EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = e.match_id AND b.innings = e.innings)),
      'innings_placement_evidence names an innings whose log the reader cannot see');
  END;
  PERFORM _as('00000000-0000-0000-0000-0000000000de');
  SELECT count(*) INTO n FROM innings_placement_evidence;
  PERFORM _assert(n = 0, format('a principal with no assignment sees %s innings of placement evidence', n));
  SELECT count(*) INTO n FROM innings_declared_profile;
  PERFORM _assert(n = 0, format('a principal with no assignment sees %s capture declarations', n));

  -- ── 12. Revocation takes effect immediately ────────────────────
  -- This is the property the SECURITY DEFINER lookup was chosen for. Nothing
  -- about authority is carried in the session, so deactivating an assignment
  -- applies on the very next statement rather than at next login.
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM player;
  PERFORM _assert(n > 0, 'coach starts with no visible players');
  -- ── The owner's recovery function only ever refreshes the owner's key ──
  --
  -- db/18. Two things to prove: it exists, and its ONE gate holds — a real
  -- account with no platform-wide superadmin assignment is refused the same
  -- way as an address that does not exist at all, never handed a code.
  PERFORM _assert(to_regprocedure('owner_recovery_issue(text,text,integer)') IS NOT NULL,
    'owner_recovery_issue() is missing — the owner has no way back in but psql');
  DECLARE
    r_owner    record;
    r_notowner record;
    r_nobody   record;
  BEGIN
    SELECT * INTO r_owner    FROM owner_recovery_issue('owner@example.invalid', 'verify-hash-owner', 3600);
    SELECT * INTO r_notowner FROM owner_recovery_issue('coach@example.invalid', 'verify-hash-notowner', 3600);
    SELECT * INTO r_nobody   FROM owner_recovery_issue('nobody-at-all@example.invalid', 'verify-hash-nobody', 3600);
    PERFORM _assert(r_owner.ok = true, 'the seeded owner cannot recover their own key');
    PERFORM _assert(r_notowner.ok = false AND r_notowner.reason = 'not_owner',
      'a real account with no platform-wide superadmin was handed a recovery code');
    PERFORM _assert(r_nobody.ok = false AND r_nobody.reason = 'not_owner',
      'an address with no account was answered differently than a real non-owner — that is enumeration');
    -- Leaves no live code the demonstration didn't already expect: undo the
    -- write this verification made, on the account it touched.
    UPDATE login_code SET used_at = now()
     WHERE code_hash IN ('verify-hash-owner') AND used_at IS NULL;
  END;

  -- ── A scorer sees their own quarantined balls ────────────────
  -- db/17. Placed before the coach's assignment is revoked below. Without this, an INSERT ... ON CONFLICT into quarantine failed the
  -- SELECT-policy check for any scorer who could not otherwise read the
  -- table, and a coach's stale ball was lost with a 42501.
  PERFORM _as(U_COACH);
  PERFORM set_config('app.device_id', 'verify-device', true);
  INSERT INTO ball_event_quarantine (match_id, school_id, submitted_epoch, current_epoch, scorer_user_id, device_id, idempotency_key, body)
  SELECT m.id, m.school_id, 9, 1, U_COACH, 'verify-device', 'verify:quarantine:own', '{}'::jsonb
    FROM match m WHERE m.school_id = '11111111-1111-1111-1111-111111111111' AND m.team_code = '1XI' LIMIT 1
  ON CONFLICT (idempotency_key) DO NOTHING;
  SELECT count(*) INTO n FROM ball_event_quarantine WHERE idempotency_key = 'verify:quarantine:own';
  PERFORM _assert(n = 1, 'a coach cannot quarantine (and then see) their own stale ball');

  PERFORM set_config('app.device_id', '', true);


  PERFORM _revoke('88888888-0000-0000-0000-000000000004');

  SELECT count(*) INTO n FROM player;
  PERFORM _assert(n = 0, 'a revoked assignment still grants access');

  -- ── 13. The officials register: open by name, closed by person ──
  -- The register is the one table here that belongs to no school, so it is
  -- the one place the tenant model cannot do the work. What replaces it: a
  -- read anybody signed in may make, a WRITE nobody but a platform-wide
  -- holder may make, and a masked view that keeps the person behind the name.
  PERFORM _as(U_PLAT);
  INSERT INTO official (full_name, born, id_number, email, phone, panel)
  VALUES ('V Pillay', '1982-06-03', '8206035000089', 'v.pillay@example.invalid',
          '+27 82 555 0100', 'KZN Cricket Umpires Association')
  RETURNING id INTO O_UMPIRE;
  INSERT INTO official_accreditation (official_id, level, issued_by, valid_from, valid_until)
  VALUES (O_UMPIRE, 'level2', 'KZNCUA', current_date - 400, current_date + 200);

  -- A school-scoped principal reads the panel. This is deliberate, not a
  -- leak: a director of sport about to appoint somebody has to see who is on
  -- it and at what grade, and the names are announced at the toss anyway.
  PERFORM _as(U_SARAH);
  SELECT count(*) INTO n FROM official WHERE id = O_UMPIRE;
  PERFORM _assert(n = 1, 'a school cannot see the officials register at all');

  -- ...and reads NOTHING that makes them a person. This is the assertion the
  -- masked view exists for: same row, same reader, columns withheld.
  SELECT born INTO v_born FROM official_masked WHERE id = O_UMPIRE;
  PERFORM _assert(v_born IS NULL, 'a school reads an official''s date of birth');
  SELECT count(*) INTO n FROM official_masked
   WHERE id = O_UMPIRE AND (id_number IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL);
  PERFORM _assert(n = 0, 'a school reads an official''s ID number or contact details');

  -- The union does read them, or the register would hold nothing usable.
  PERFORM _as(U_PLAT);
  SELECT born INTO v_born FROM official_masked WHERE id = O_UMPIRE;
  PERFORM _assert(v_born IS NOT NULL, 'the register holder cannot read a date of birth');

  -- WRITING is the boundary that matters most. Sarah holds officiating.assign
  -- — she appoints officials to fixtures all season — and that must not let
  -- her put somebody on the panel or change what they are accredited to
  -- stand. Appointing from a panel and deciding the panel are different jobs.
  PERFORM _as(U_SARAH);
  BEGIN
    INSERT INTO official (full_name, born) VALUES ('Self Appointed', '1990-01-01');
    PERFORM _assert(false, 'a school-scoped role can add somebody to the officials register');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE official SET panel = 'Rewritten' WHERE id = O_UMPIRE;
    PERFORM _assert(NOT FOUND, 'a school-scoped role can edit the officials register');
  END;

  -- The grade is a span, so it answers "today", and stops answering when it
  -- lapses. A register that cannot tell those apart cannot refuse an
  -- appointment, which is the whole reason for keeping one.
  SELECT official_level(O_UMPIRE) INTO v_level;
  PERFORM _assert(v_level = 'level2', 'a current accreditation does not read as current');
  SELECT official_level(O_UMPIRE, current_date + 500) INTO v_level;
  PERFORM _assert(v_level IS NULL, 'a lapsed accreditation still reads as current');

  -- ── A pupil without a date of birth cannot be written ─────────
  --
  -- The API refuses one at both doors, and this is the floor under that: a
  -- direct INSERT, a script, a future write path nobody has thought of yet.
  -- It matters because guardian_link_establish() refuses a link it cannot put
  -- an end date on, so a boy with no birthday is a boy whose family can never
  -- reach his record — and the office would not learn that until a parent
  -- asked.
  PERFORM _assert(EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'player_born_required' AND convalidated),
    'the date-of-birth constraint is missing or was never validated');

  -- ── How a batter is out is a closed list ──────────────────────
  --
  -- db/13: the dismissal column admits the eleven in the Laws and nothing
  -- else, validated over every row already here. A stray spelling used to
  -- credit the bowler with a wicket that was never his.
  PERFORM _assert(EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ball_event_dismissal_known' AND convalidated),
    'the dismissal vocabulary constraint is missing or was never validated');

  -- ── Quarantine has a way out ──────────────────────────────────
  -- db/14. The door is a SECURITY DEFINER function that checks its own
  -- authority; the walk tools/smoke-quarantine.mjs exercises who may open it.
  PERFORM _assert(to_regprocedure('quarantine_resolve(bigint,boolean,jsonb,text)') IS NOT NULL,
    'quarantine_resolve() is missing — a quarantined ball has no way out');

  -- ── Every definer function names its search path ───────────────
  -- db/16. A SECURITY DEFINER function without a pinned search_path runs the
  -- owner's privileges over whatever schema a caller can put first. This
  -- verifier's own helpers (the _-prefixed ones above) are created inside this
  -- transaction and rolled back with it, so they are left out of the count.
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prosecdef AND p.proname NOT LIKE '\_%'
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%');
  PERFORM _assert(n = 0,
    n || ' SECURITY DEFINER function(s) do not pin search_path — add "SET search_path = pg_catalog, public, pg_temp" or re-run db/16');

  -- ── A receipt is its owner's ──────────────────────────────────
  -- db/15. The idempotency layer remembers a write's response per person;
  -- another person with the same key must see nothing, or one account's
  -- receipt would answer another's request.
  PERFORM _as(U_COACH2);
  INSERT INTO request_replay (person_id, key, route, status, body)
  VALUES (U_COACH2, 'verify-key', 'POST /api/verify', 200, '{"ok":true}'::jsonb);
  PERFORM _as(U_MEDIC);
  SELECT count(*) INTO n FROM request_replay WHERE key = 'verify-key';
  PERFORM _assert(n = 0, 'a receipt is readable by somebody who is not its owner');
  BEGIN
    INSERT INTO request_replay (person_id, key, route, status, body)
    VALUES (U_COACH2, 'verify-key-2', 'POST /api/verify', 200, '{}'::jsonb);
    PERFORM _assert(false, 'a receipt can be written under another person''s name');
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM _as(U_COACH2);
  SELECT count(*) INTO n FROM request_replay WHERE key = 'verify-key';
  PERFORM _assert(n = 1, 'the owner cannot read back their own receipt');

  BEGIN
    INSERT INTO player (school_id, team_code, full_name) VALUES (HIL, '1XI', 'No Birthday');
    PERFORM _assert(false, 'a player was written with no date of birth');
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL;
  END;

  -- ── Guardianship ends at eighteen ──────────────────────────────
  --
  -- A guardian's access is co-ownership of a CHILD's record. The model had no
  -- way to say that: both creation paths wrote valid_until NULL, so a parent
  -- linked to a thirteen-year-old still read medical status, injury nature and
  -- the full passport when that person was thirty. These assertions are what
  -- stop it going back.

  -- Not one open-ended guardian link survives the seed. Asked of the whole
  -- table rather than of one reader's view, because "I cannot see one" and
  -- "there is not one" are different claims and only the second is the point.
  PERFORM _assert(_count_open_guardian_links() = 0,
    'a guardian link was created with no end date');

  -- The date is the child's eighteenth birthday, not an approximation of it.
  SELECT count(*) INTO n FROM assignment_subject s
    JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
    JOIN player p ON p.id = s.player_id
   WHERE s.valid_until <> greatest(majority_on(p.born), s.valid_from);
  PERFORM _assert(n = 0, 'a guardian link ends on some date other than the child''s majority');

  -- The live half: a parent of a minor still reads their child today. Asserted
  -- alongside the expiry rather than trusting section 5, so that a change which
  -- expired EVERY link would fail here instead of passing quietly.
  PERFORM _as(U_PARENT);
  SELECT count(*) INTO n FROM player_masked WHERE id = P_INJURED AND born IS NOT NULL;
  PERFORM _assert(n = 1, 'a guardian of a minor cannot read their own child');

  -- The dead half, and the reason the seed carries an adult: a parent whose
  -- child has turned eighteen reads nothing of that child. Not a redacted row
  -- — no row.
  PERFORM _as(U_NAIDOO);
  SELECT count(*) INTO n FROM player_masked WHERE id = P_ADULT;
  PERFORM _assert(n = 0, 'a guardian still reads the record of a child who has turned eighteen');
  SELECT count(*) INTO n FROM injury;
  PERFORM _assert(n = 0, 'an expired guardian link still reaches injuries');

  -- ── The two refusals, and what a refusal must not leave behind ──
  PERFORM _as(U_REGISTRAR);

  -- Linking a guardian to someone already grown is refused. The office cannot
  -- re-open access to an adult's record by making a fresh link.
  --
  -- assignment_subject's own CHECK (valid_from <= valid_until) is a backstop
  -- here — removing the guard below does not let the link through, it makes
  -- the INSERT abort on a constraint violation instead. That is exactly the
  -- difference the guard buys: a named refusal the API can turn into a 422,
  -- rather than an exception that takes the caller's transaction with it.
  SELECT ok, reason INTO v_ok, v_reason
    FROM guardian_link_establish(U_BURSAR, P_ADULT, 'parent');
  PERFORM _assert(NOT v_ok AND v_reason = 'player_is_an_adult',
    'a guardian can be linked to a player who has turned eighteen');

  -- A refusal must leave NOTHING behind. guardian_link_establish() creates the
  -- guardian assignment before it reaches the subject row, and a plpgsql
  -- RETURN is not a rollback — so a guard placed after that INSERT would answer
  -- false and still leave a live guardian assignment standing, naming nobody.
  -- This is the assertion that catches it being moved back.
  PERFORM _assert(_count_guardian_assignments(U_BURSAR) = 0,
    'a refused guardian link left an assignment behind');

  -- No date of birth, no link. Guardianship is precisely where the age has to
  -- be known, and the honest answer is to refuse rather than assume.
  --
  -- The constraint is lifted for the one INSERT because db/11 now forbids this
  -- state outright. That does NOT make the guard below redundant: db/11 is
  -- NOT VALID, so a database that held such a boy before it landed holds him
  -- still, and he is exactly the child whose family must not be quietly given
  -- open-ended access. Restored immediately after.
  PERFORM _born_constraint(false);
  PERFORM _set_born(P_U13, NULL);
  PERFORM _born_constraint(true);
  SELECT ok, reason INTO v_ok, v_reason
    FROM guardian_link_establish(U_BURSAR, P_U13, 'parent');
  PERFORM _assert(NOT v_ok AND v_reason = 'player_date_of_birth_required',
    'a guardian was linked to a child with no recorded date of birth');
  PERFORM _assert(_count_guardian_assignments(U_BURSAR) = 0,
    'a link refused for want of a date of birth left an assignment behind');

  -- Restore the date, and the same call now succeeds and ends on his birthday.
  PERFORM _set_born(P_U13, (current_date - interval '13 years')::date);
  SELECT ok INTO v_ok FROM guardian_link_establish(U_BURSAR, P_U13, 'parent');
  PERFORM _assert(v_ok, 'a guardian cannot be linked to a thirteen-year-old');
  PERFORM _assert(_count_subjects(P_U13) = 1, 'the link was not recorded');

  -- And asking twice says so, rather than writing a second row. This is not
  -- housekeeping: `already_linked` used to be decided by valid_until IS NULL,
  -- which no link satisfies now that every one of them carries an end date,
  -- so the duplicate would have gone in unnoticed.
  SELECT ok, reason INTO v_ok, v_reason
    FROM guardian_link_establish(U_BURSAR, P_U13, 'parent');
  PERFORM _assert(NOT v_ok AND v_reason = 'already_linked',
    'linking the same guardian to the same child twice was not refused');
  PERFORM _assert(_count_subjects(P_U13) = 1,
    'a duplicate guardian subject row was written for a child already linked');

  -- The two structural claims again, now that a link has been made THROUGH THE
  -- FUNCTION rather than by the seed. Asked twice on purpose: the first pair
  -- above runs before any link is created here, so on its own it only ever
  -- proves the seed carries end dates, and guardian_link_establish() could
  -- quietly go back to writing NULL without a single assertion turning red.
  PERFORM _assert(_count_open_guardian_links() = 0,
    'guardian_link_establish created a link with no end date');
  SELECT count(*) INTO n FROM assignment_subject s
    JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
    JOIN player p ON p.id = s.player_id
   WHERE s.valid_until <> greatest(majority_on(p.born), s.valid_from);
  PERFORM _assert(n = 0,
    'guardian_link_establish ended a link on some date other than the child''s majority');

  -- ── dob_gaps(): the two facts db/10 and db/11 could only log ────
  --
  -- Reuses P_U13 (B Khumalo) exactly as he stands after the block above: born
  -- restored, one live guardian link to U_BURSAR. Nothing below him is read
  -- again in this file, so nothing here needs to leave him as it found him.
  PERFORM _assert(to_regprocedure('dob_gaps()') IS NOT NULL,
    'dob_gaps() is missing — a NULL date of birth is invisible outside a migration log');

  -- A plain gap, with his guardian link left standing and still years from
  -- its own majority date. This is the case dob_gaps() must NOT confuse with
  -- an ended link: every link carries a future end date now, and a query that
  -- tested valid_until IS NOT NULL alone would call this one ended too.
  PERFORM _born_constraint(false);
  PERFORM _set_born(P_U13, NULL);
  PERFORM _born_constraint(true);
  PERFORM _as(U_REGISTRAR);
  SELECT count(*) INTO n FROM dob_gaps() WHERE kind = 'no_dob' AND player_id = P_U13;
  PERFORM _assert(n = 1, 'dob_gaps() did not surface a player with no date of birth');
  SELECT count(*) INTO n FROM dob_gaps() WHERE kind = 'guardian_link_ended' AND player_id = P_U13;
  PERFORM _assert(n = 0, 'dob_gaps() called a link years from its own end date "ended"');
  PERFORM _as(U_BURSAR);
  SELECT count(*) INTO n FROM dob_gaps() WHERE player_id = P_U13;
  PERFORM _assert(n = 0,
    'dob_gaps() showed a data-quality gap to somebody holding neither user.role.assign nor guardian.link.manage');

  -- The other half: the link wound back to its own start date — db/10's own
  -- effect, produced the same way _expire_link() proves expiry live above —
  -- with the birthday still missing. p.born IS NULL and s.valid_until in the
  -- past is the exact signature dob_gaps() reads, not a state asserted for
  -- the test's sake.
  PERFORM _expire_link(P_U13);
  PERFORM _as(U_REGISTRAR);
  SELECT count(*) INTO n FROM dob_gaps()
   WHERE kind = 'guardian_link_ended' AND player_id = P_U13
     AND guardian_id = U_BURSAR AND relationship = 'parent';
  PERFORM _assert(n = 1, 'dob_gaps() did not surface a guardian link ended for want of a date of birth');
  PERFORM _as(U_BURSAR);
  SELECT count(*) INTO n FROM dob_gaps() WHERE player_id = P_U13;
  PERFORM _assert(n = 0, 'dob_gaps() showed an ended guardian link to somebody holding neither capability');

  -- Restored. Nothing later reads P_U13 again, but leaving a child's own
  -- birthday nulled for the rest of the run is not a state worth risking.
  PERFORM _set_born(P_U13, (current_date - interval '13 years')::date);

  -- EXPIRY IS LIVE. Nothing runs between the two reads below but app_can(),
  -- which evaluates valid_until on every call — so there is no window in which
  -- a link is past its date and still working, and no scheduled job whose
  -- failure would silently hold access open.
  --
  -- LAST, because it deliberately winds a good link back to a date already
  -- past. Run earlier it would leave R Pillay's row failing the whole-table
  -- checks above, and the honest fix for that is to do it after them rather
  -- than to teach those checks to ignore a row.
  PERFORM _as(U_PARENT);
  SELECT count(*) INTO n FROM player_masked WHERE id = P_INJURED;
  PERFORM _assert(n = 1, 'the fixture for the expiry assertion is not readable to begin with');
  PERFORM _expire_link(P_INJURED);
  SELECT count(*) INTO n FROM player_masked WHERE id = P_INJURED;
  PERFORM _assert(n = 0, 'a guardian link past its end date still reads the child');

  -- ── Enrolment leaves nothing behind when it is refused ────────
  --
  -- enrol_person() writes the account, then answers the request through
  -- decide_role_request(). A refusal from that second step arrives with the
  -- account already on the table, so the writes sit in a subtransaction and
  -- the refusal is raised rather than returned.
  --
  -- THIS ASSERTION HAS TO LIVE HERE, in direct SQL, and that is the whole
  -- reason it was moved. Over HTTP withPrincipal() wraps every request in
  -- BEGIN/COMMIT and rolls back on a thrown error, so the API path discards
  -- the orphan whatever enrol_person() does — the walk in tools/smoke-enrol.mjs
  -- CANNOT fail on it, and it was checked: removing the subtransaction leaves
  -- all 31 of its assertions green. A guard nothing can falsify is a guard
  -- nobody will keep, so the falsifying assertion belongs where a caller is
  -- not wrapped in somebody else's transaction.
  PERFORM _as(U_REGISTRAR);
  -- Refused inside decide_role_request(), AFTER the account row is written:
  -- a coach is a coach of a side, and this one names none.
  SELECT ok, reason INTO v_ok, v_reason
    FROM enrol_person('orphan.coach@example.invalid', 'O Coach', 'coach', HIL, NULL, NULL, NULL);
  PERFORM _assert(NOT v_ok AND v_reason = 'team_required',
    'a coach was enrolled with no side');
  PERFORM _assert(_count_accounts('orphan.coach@example.invalid') = 0,
    'a refused enrolment left a half-made account behind');

  -- And the same call, given the side it was missing, does make one.
  SELECT ok INTO v_ok
    FROM enrol_person('real.coach@example.invalid', 'R Coach', 'coach', HIL, 'U13A', NULL, NULL);
  PERFORM _assert(v_ok, 'the office cannot enrol a coach of a named side');
  PERFORM _assert(_count_accounts('real.coach@example.invalid') = 1,
    'the enrolment did not create an account');

  -- ── The owner's key reaches every tenant ──────────────────────
  --
  -- `superadmin` holds all 82 capabilities on an assignment naming no school.
  -- It is the one role in the model that is not least-privilege, and these
  -- assertions are what stop it becoming one by accident: a bundle that
  -- quietly stopped being "everything" would leave the operator locked out of
  -- the thing they most need to reach, and nobody would find out until the day
  -- it mattered.
  PERFORM _assert(
    (SELECT count(*) FROM role_capability WHERE role = 'superadmin')
      = (SELECT count(*) FROM capability),
    'the owner''s key does not hold every capability');

  PERFORM _as(U_OWNER);

  -- Across tenants, which is the part a school-scoped role can never do:
  -- app_can() has no wildcard for school, so this works only because the
  -- assignment names none.
  SELECT count(DISTINCT school_id) INTO n FROM player_masked;
  PERFORM _assert(n >= 2, 'the owner''s key does not reach every school');

  -- Through the masking, not merely around the row filter. A reader who sees
  -- the row and a redacted column has not reached the record.
  SELECT count(*) INTO n FROM player_masked
   WHERE id = P_INJURED AND born IS NOT NULL AND guardian IS NOT NULL;
  PERFORM _assert(n = 1, 'the owner''s key reads a player row but not its protected columns');
  SELECT count(*) INTO n FROM injury;
  PERFORM _assert(n > 0, 'the owner''s key cannot read injuries');

  -- AND IT IS STILL RLS, not a bypass. The rows arrive because the policies
  -- said yes to this principal, which is why signing out of the role takes the
  -- access away — a superuser connection would not behave like this.
  PERFORM set_config('app.user_id', '', true);
  SELECT count(*) INTO n FROM player_masked;
  PERFORM _assert(n = 0, 'the owner''s key is a connection privilege rather than an assignment');

  -- Nobody mints an owner's key from inside the platform account. platformadmin
  -- is the recovery path and may grant every OTHER role; letting it grant this
  -- one would make the two roles the same thing, one assignment apart.
  PERFORM _assert(NOT EXISTS (
    SELECT 1 FROM role_grantable WHERE granter = 'platformadmin' AND role = 'superadmin'),
    'the platform account can appoint an owner''s key');
  PERFORM _assert(EXISTS (
    SELECT 1 FROM role_grantable WHERE granter = 'superadmin' AND role = 'platformadmin'),
    'the owner''s key cannot appoint a platform account');

  -- ── The newsfeed: three tiers, three audiences ────────────────
  --
  -- news.read and the three publish capabilities were in the model from the
  -- first migration with nothing behind them. These assertions are what makes
  -- the tiers mean something: each is a different AUDIENCE, derived from the
  -- post's anchor, and a tier reaching the same people as the one above it
  -- would not be worth having as its own capability.
  --
  -- NOT the 1XI coach, though he is the obvious reader for a 1XI notice:
  -- section 8 above revokes his assignments to prove revocation narrows, and
  -- this file is one transaction, so he holds nothing by the time it gets
  -- here. The first draft of this block used him and reported zero rows for
  -- every tier — which read like a broken policy and was a dead principal.
  PERFORM _as(U_SARAH);
  SELECT count(*) INTO n FROM news_post WHERE scope = 'team';
  PERFORM _assert(n = 1, 'the director of sport cannot read a side''s notice');
  SELECT count(*) INTO n FROM news_post WHERE scope = 'school';
  PERFORM _assert(n >= 1, 'the director of sport cannot read the school''s notice');
  -- The competition post belongs to NO school. It reaches her because her
  -- school is entered — app_can() has no wildcard for school, so this works
  -- only through competition_entrant.
  SELECT count(*) INTO n FROM news_post WHERE scope = 'competition';
  PERFORM _assert(n = 1, 'a league notice does not reach a school entered in it');

  -- A DRAFT IS NOT A NOTICE. The unsent school post is Sarah''s, and she is
  -- the only person who has it.
  SELECT count(*) INTO n FROM news_post WHERE published_at IS NULL;
  PERFORM _assert(n = 1, 'an author cannot see their own draft');
  PERFORM _as(U_MEDIC);
  SELECT count(*) INTO n FROM news_post WHERE published_at IS NULL;
  PERFORM _assert(n = 0, 'an unsent draft is readable by somebody who did not write it');

  -- A team notice reaches THAT side. Westville''s office administers another
  -- tenant: it reads neither Hilton''s team post nor Hilton''s school post,
  -- and does read the league notice, because Westville is entered in it.
  PERFORM _as('88888888-0000-0000-0000-00000000000d'::uuid);
  SELECT count(*) INTO n FROM news_post WHERE school_id = HIL;
  PERFORM _assert(n = 0, 'another school reads this school''s notices');
  SELECT count(*) INTO n FROM news_post WHERE scope = 'competition';
  PERFORM _assert(n = 1, 'a league notice does not reach the other school entered in it');

  -- ── The tier is the scope, and it is enforced on the write ────
  -- The 2XI coach holds news.publish.team and not news.publish.school. He
  -- cannot reach the whole school by naming a different anchor: the INSERT
  -- policy reads the anchor to decide which capability to demand.
  PERFORM _as(U_COACH2);
  BEGIN
    INSERT INTO news_post (scope, school_id, title, body, published_at)
    VALUES ('school', HIL, 'A coach speaks for the school', 'Not his to send.', now());
    PERFORM _assert(false, 'a coach posted a notice to the whole school');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- ...and can post to his own side.
  INSERT INTO news_post (scope, school_id, team_code, title, body, published_at)
  VALUES ('team', HIL, '2XI', 'Bus leaves at seven', 'Front gate.', now());
  SELECT count(*) INTO n FROM news_post WHERE title = 'Bus leaves at seven';
  PERFORM _assert(n = 1, 'a coach cannot post to his own side');
  -- The byline is the session, not the caller''s word for it.
  SELECT count(*) INTO n FROM news_post
   WHERE title = 'Bus leaves at seven' AND author_id = U_COACH2;
  PERFORM _assert(n = 1, 'the author was not stamped from the session');

  -- news.read WITHOUT a tier is the shape twenty-three of twenty-five roles
  -- have: read everything meant for you, publish nothing.
  PERFORM _as(U_MEDIC);
  BEGIN
    INSERT INTO news_post (scope, school_id, title, body, published_at)
    VALUES ('school', HIL, 'The physio speaks for the school', 'No.', now());
    PERFORM _assert(false, 'a role with no publish tier published a school notice');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ── A module switched off is off in the database too ────────────
  --
  -- SCRBRD-014. The module gate is two gates reading one function: the read
  -- API refuses a resource a module owns, the write dispatcher refuses a
  -- route tagged with it, both through my_feature_enabled(), both over HTTP,
  -- both walked by tools/smoke-modules.mjs. This is the half an HTTP walk
  -- cannot reach: the resolver itself, under the policies, as the people
  -- concerned — and the one place the database gates a write on a flag by
  -- itself, a fixture in a sport the school has not been granted: refused,
  -- granted, allowed, on a direct INSERT.
  --
  -- Said plainly, because it is the boundary: injury, training_session,
  -- player_skill and the rest carry no trigger of their own. Their only door
  -- is the API and the route tag is the gate. A write that reaches Postgres
  -- some other way is carrying the schema owner's credentials, and a product
  -- switch is not what stands between that and the data.
  PERFORM _as(U_MEDICAL);
  PERFORM _assert(my_feature_enabled('injuries'),
    'Injuries reads as off for the physio before anybody switched it off');
  PERFORM _as(U_REGISTRAR);
  INSERT INTO feature_suppression (key, school_id, hidden_by, reason)
  VALUES ('injuries', HIL, U_REGISTRAR, 'verify: switched off');
  PERFORM _as(U_MEDICAL);
  PERFORM _assert(NOT my_feature_enabled('injuries'),
    'a school hid Injuries and the resolver still answers on for its physio');
  -- Off at any school you belong to is off. Sarah is Hilton's head of sport
  -- and a Westville parent; Westville did not hide anything, and she is still
  -- refused — the safe direction, and the one the API collapses to.
  PERFORM _as(U_SARAH);
  PERFORM _assert(NOT my_feature_enabled('injuries'),
    'a person assigned at two schools reads a module one of them hid');
  PERFORM _as('88888888-0000-0000-0000-00000000000d'::uuid);   -- Westville's registrar
  PERFORM _assert(my_feature_enabled('injuries'),
    'hiding a module at one school hid it at the other');
  -- A coach cannot lift it: school.feature.manage, at that school. The
  -- UPDATE policy filters rather than raises, so the proof is that it is
  -- still off afterwards.
  PERFORM _as(U_COACH2);
  UPDATE feature_suppression SET lifted_at = now(), lifted_by = U_COACH2
   WHERE key = 'injuries' AND school_id = HIL AND lifted_at IS NULL;
  PERFORM _as(U_MEDICAL);
  PERFORM _assert(NOT my_feature_enabled('injuries'),
    'a coach lifted a suppression his school administrator made');
  PERFORM _as(U_REGISTRAR);
  UPDATE feature_suppression SET lifted_at = now(), lifted_by = U_REGISTRAR
   WHERE key = 'injuries' AND school_id = HIL AND lifted_at IS NULL;
  PERFORM _as(U_MEDICAL);
  PERFORM _assert(my_feature_enabled('injuries'),
    'the school lifted the suppression and Injuries stayed off');

  -- The write the database gates itself. Hockey ships off; the platform
  -- grants it; the same INSERT then goes through.
  PERFORM _as(U_REGISTRAR);
  BEGIN
    INSERT INTO match (school_id, team_code, opponent, starts_at, sport, status)
    VALUES (HIL, '1XI', 'Kearsney', now() + interval '3 days', 'hockey', 'scheduled');
    PERFORM _assert(false, 'a fixture was written in a sport the school has not been granted');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM _as(U_PLAT);
  INSERT INTO feature_grant (key, school_id, granted, changed_by)
  VALUES ('sport_hockey', HIL, true, U_PLAT);
  PERFORM _as(U_REGISTRAR);
  INSERT INTO match (school_id, team_code, opponent, starts_at, sport, status)
  VALUES (HIL, '1XI', 'Kearsney', now() + interval '3 days', 'hockey', 'scheduled');
  SELECT count(*) INTO n FROM match WHERE sport = 'hockey' AND opponent = 'Kearsney';
  PERFORM _assert(n = 1, 'the platform granted hockey and the fixture was still refused');

  -- ── A read across every tenant is on the record ────────────────
  -- SCRBRD-026. The owner's key and a platform administrator's reach every
  -- school; db/20 makes the log say so, decided at write time by the same
  -- liveness rule as everything else about the reader.
  PERFORM _as(U_OWNER);
  PERFORM _assert(app_is_platform_wide(), 'the owner does not read as platform-wide');
  PERFORM _as(U_PLAT);
  PERFORM _assert(app_is_platform_wide(), 'a platform administrator does not read as platform-wide');
  PERFORM _as(U_REGISTRAR);
  PERFORM _assert(NOT app_is_platform_wide(), 'a school administrator reads as platform-wide');
  PERFORM _as(U_SARAH);
  PERFORM _assert(NOT app_is_platform_wide(), 'two school assignments add up to the platform');
  -- The row carries the answer, stamped by the function and not by the
  -- caller: the same call, from the owner and from the school's own office.
  PERFORM _as(U_OWNER);
  PERFORM log_restricted_read('players', ARRAY[P_INJURED], ARRAY['born'], HIL);
  PERFORM _as(U_REGISTRAR);
  PERFORM log_restricted_read('players', ARRAY[P_INJURED], ARRAY['born'], HIL);
  -- Read back as the school's own auditor: both rows are theirs to see, and
  -- exactly one of them is a read from outside the school.
  PERFORM _as(U_SARAH);   -- director of sport at Hilton: audit.read
  SELECT count(*) INTO n FROM access_log
   WHERE school_id = HIL AND resource = 'players' AND person_id = U_OWNER AND platform_wide;
  PERFORM _assert(n = 1,
    'the owner''s read of a school''s roster is not marked platform-wide in that school''s log');
  SELECT count(*) INTO n FROM access_log
   WHERE school_id = HIL AND resource = 'players' AND person_id = U_REGISTRAR AND NOT platform_wide;
  PERFORM _assert(n = 1, 'a school''s own read of its own roster was marked platform-wide');


  -- ── SCRBRD-012: support access is an hour, at one school, on the record ──
  --
  -- platformadmin holds no school's roles, so a platform administrator reads
  -- nothing of a school. support_access_begin() hands them ONE role at ONE
  -- school for the minutes asked, as a real assignment with an hour hand —
  -- role_assignment.expires_at (db/22) — that app_can() reads on every
  -- statement (db/23). Every read under it is stamped in the school's log,
  -- and the school's own office can end it.
  PERFORM _as(U_PLAT);
  SELECT count(*) INTO n FROM player_masked WHERE school_id = HIL;
  PERFORM _assert(n = 0, 'a platform administrator reads a school''s roster without support access');

  -- Refusals first, each for its own reason.
  PERFORM _as(U_SARAH);
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_begin(HIL, 'schooladmin', 'ticket 4411: roster import failing');
  PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted', 'somebody without platform.support.impersonate began a support session');
  PERFORM _as(U_PLAT);
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_begin(HIL, 'platformadmin', 'ticket 4411: roster import failing');
  PERFORM _assert(NOT v_ok AND v_reason = 'role_not_supportable', 'a platform role was issued at a school');
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_begin(HIL, 'superadmin', 'ticket 4411: roster import failing');
  PERFORM _assert(NOT v_ok AND v_reason = 'role_not_supportable', 'the owner''s key was issued as support');
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_begin(HIL, 'guardian', 'ticket 4411: roster import failing');
  PERFORM _assert(NOT v_ok AND v_reason = 'role_needs_subject', 'support was issued as somebody''s parent');
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_begin(HIL, 'nosuchrole', 'ticket 4411: roster import failing');
  PERFORM _assert(NOT v_ok AND v_reason = 'role_unknown', 'a role that does not exist was issued');
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_begin(HIL, 'schooladmin', 'fix');
  PERFORM _assert(NOT v_ok AND v_reason = 'reason_required', 'a support session began with no reason worth reading');
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_begin(HIL, 'schooladmin', 'ticket 4411: roster import failing', NULL, 0);
  PERFORM _assert(NOT v_ok AND v_reason = 'minutes_out_of_range', 'a support session of no minutes began');
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_begin(HIL, 'schooladmin', 'ticket 4411: roster import failing', NULL, 241);
  PERFORM _assert(NOT v_ok AND v_reason = 'minutes_out_of_range', 'a support session longer than four hours began');
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_begin('00000000-0000-0000-0000-000000000000', 'schooladmin', 'ticket 4411: roster import failing');
  PERFORM _assert(NOT v_ok AND v_reason = 'school_unknown', 'support was issued at a school that does not exist');

  -- The door opens: one role, one school, sixty minutes.
  SELECT ok, reason, id, expires_at INTO v_ok, v_reason, S_ID, S_EXP
    FROM support_access_begin(HIL, 'schooladmin', 'ticket 4411: roster import failing');
  PERFORM _assert(v_ok, 'a platform administrator could not begin support access: ' || coalesce(v_reason, '?'));
  PERFORM _assert(S_EXP > now() + interval '59 minutes' AND S_EXP <= now() + interval '60 minutes',
    'the default support session is not an hour');
  SELECT count(*) INTO n FROM player_masked WHERE school_id = HIL;
  PERFORM _assert(n > 0, 'support access at Hilton reads nothing of Hilton');
  SELECT count(*) INTO n FROM player_masked WHERE school_id = WES;
  PERFORM _assert(n = 0, 'support access at Hilton reads Westville');
  PERFORM _assert(app_support_access_id(HIL) = S_ID, 'the live session is not the one reported for Hilton');
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_begin(HIL, 'schooladmin', 'ticket 4411: roster import failing');
  PERFORM _assert(NOT v_ok AND v_reason = 'already_live', 'the same support session was issued twice');

  -- Every read under it is on the record, stamped with the session, in the
  -- school's own log — and the session record is theirs to read.
  PERFORM log_restricted_read('players', ARRAY[P_INJURED], ARRAY['born'], HIL);
  PERFORM _as(U_SARAH);   -- audit.read at Hilton
  -- Both stamps at once: platform_wide says WHO read (a key that answers to
  -- no school, db/20), support_access_id says THROUGH WHICH DOOR.
  SELECT count(*) INTO n FROM access_log
   WHERE school_id = HIL AND person_id = U_PLAT AND support_access_id = S_ID AND platform_wide;
  PERFORM _assert(n = 1, 'a read under support access is not stamped with the session in the school''s log');
  SELECT count(*) INTO n FROM support_access WHERE id = S_ID;
  PERFORM _assert(n = 1, 'the school''s auditor cannot see the support session at their school');
  PERFORM _as(U_COACH);
  SELECT count(*) INTO n FROM support_access WHERE id = S_ID;
  PERFORM _assert(n = 0, 'a coach can read the support session record');

  -- The school ends it. Not the platform: the school.
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_end(S_ID);
  PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted', 'a coach ended a support session');
  PERFORM _as(U_SARAH);   -- user.role.assign at Hilton
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_end(S_ID);
  PERFORM _assert(v_ok, 'the school''s office could not end a support session at their school');
  PERFORM _as(U_PLAT);
  SELECT count(*) INTO n FROM player_masked WHERE school_id = HIL;
  PERFORM _assert(n = 0, 'an ended support session still reads the school');
  SELECT ok, reason INTO v_ok, v_reason FROM support_access_end(S_ID);
  PERFORM _assert(v_ok AND v_reason = 'already_ended', 'ending a session twice is not safe');
  PERFORM _as(U_SARAH);
  SELECT count(*) INTO n FROM support_access WHERE id = S_ID AND ended_by = U_SARAH AND ended_at IS NOT NULL;
  PERFORM _assert(n = 1, 'the record does not say who ended the session');

  -- EXPIRY IS LIVE. Wind the hour hand back and read again: no job, no window.
  PERFORM _as(U_PLAT);
  SELECT ok, reason, id INTO v_ok, v_reason, S_ID
    FROM support_access_begin(HIL, 'schooladmin', 'ticket 4412: the second look');
  PERFORM _assert(v_ok, 'a second support session could not begin after the first ended');
  SELECT count(*) INTO n FROM player_masked WHERE school_id = HIL;
  PERFORM _assert(n > 0, 'the second support session reads nothing');
  PERFORM _expire_support(S_ID);
  SELECT count(*) INTO n FROM player_masked WHERE school_id = HIL;
  PERFORM _assert(n = 0, 'a support session past its hour still reads the school');
  PERFORM _assert(app_support_access_id(HIL) IS NULL, 'an expired session is still reported as live');
  -- ...and an ordinary appointment, with no hour hand, is untouched by any of it.
  PERFORM _as(U_SARAH);
  SELECT count(*) INTO n FROM player_masked WHERE school_id = HIL;
  PERFORM _assert(n > 0, 'the hour hand stopped an ordinary appointment');

  -- ── SCRBRD-034 (db/30): an hour hand always carries a reason ──
  --
  -- expires_at is the support session's hour hand, and support_access_begin()
  -- will not issue one without a reason. role_assignment_write let the
  -- school's office write one directly — an INSERT naming expires_at, or an
  -- UPDATE moving a live session's hour forward — with no reason and no
  -- record. db/30's check is DEFERRED to commit, because the support path
  -- writes the assignment before the record; this file ends in ROLLBACK and
  -- never commits, so each assertion fires the pending check on the spot
  -- with SET CONSTRAINTS ... IMMEDIATE.
  --
  -- The support path itself passes: a session issued, checked at once. The
  -- same statement also fires the checks queued by every begin and every
  -- _expire_support() above — winding an hour hand BACK stays within what
  -- was issued.
  PERFORM _as(U_PLAT);
  SELECT ok, reason, id INTO v_ok, v_reason, S_ID
    FROM support_access_begin(HIL, 'schooladmin', 'ticket 4413: the third look, checked at once');
  PERFORM _assert(v_ok, 'a support session could not begin under the expiry check: ' || coalesce(v_reason, '?'));
  SET CONSTRAINTS role_assignment_expiry_has_reason IMMEDIATE;
  SET CONSTRAINTS role_assignment_expiry_has_reason DEFERRED;

  -- A direct time-boxed grant: the office may appoint an analyst, and may
  -- not give the appointment an hour hand with nothing saying why.
  PERFORM _as(U_SARAH);   -- user.role.assign at Hilton; directorofsport may grant analyst
  BEGIN
    INSERT INTO role_assignment (person_id, role, school_id, expires_at)
    VALUES (U_WATCHER, 'analyst', HIL, now() + interval '1 hour');
    SET CONSTRAINTS role_assignment_expiry_has_reason IMMEDIATE;
    PERFORM _assert(false, 'a time-boxed assignment was written with no support session behind it');
  EXCEPTION WHEN check_violation THEN
    PERFORM _assert(SQLERRM LIKE '%no support session%', 'the direct grant was refused for another reason: ' || SQLERRM);
  END;
  SET CONSTRAINTS role_assignment_expiry_has_reason DEFERRED;
  -- The same appointment with no hour hand is an ordinary one, and is not
  -- this check's business. Undone by raising past it, so U_WATCHER keeps
  -- holding nothing for the assertions that rely on that.
  BEGIN
    INSERT INTO role_assignment (person_id, role, school_id)
    VALUES (U_WATCHER, 'analyst', HIL);
    SET CONSTRAINTS role_assignment_expiry_has_reason IMMEDIATE;
    RAISE EXCEPTION USING ERRCODE = 'ZZ034', MESSAGE = 'undo';
  EXCEPTION WHEN sqlstate 'ZZ034' THEN NULL;
  END;
  SET CONSTRAINTS role_assignment_expiry_has_reason DEFERRED;

  -- Moving a live session's hour FORWARD is a longer session than the reason
  -- was given for. The school's office holds the UPDATE policy over it.
  SELECT s.assignment_id, s.expires_at INTO A_ID, v_until FROM support_access s WHERE s.id = S_ID;
  PERFORM _assert(A_ID IS NOT NULL, 'the school''s auditor cannot see the live support session');
  BEGIN
    UPDATE role_assignment SET expires_at = v_until + interval '1 day' WHERE id = A_ID;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM _assert(n = 1, 'the office could not reach the support assignment at all — the next assertion would prove nothing');
    SET CONSTRAINTS role_assignment_expiry_has_reason IMMEDIATE;
    PERFORM _assert(false, 'a support session''s hour was extended past what its reason was given for');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET CONSTRAINTS role_assignment_expiry_has_reason DEFERRED;
  -- ...nor taken OFF, which would make the hour's support permanent while the
  -- support record still reads as over.
  SELECT s.assignment_id INTO A_ID FROM support_access s WHERE s.id = S_ID;
  BEGIN
    UPDATE role_assignment SET expires_at = NULL WHERE id = A_ID;
    PERFORM _assert(false, 'a support session''s hour was removed, making it permanent');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM _assert((SELECT expires_at FROM role_assignment WHERE id = A_ID) IS NOT NULL,
    'the support assignment lost its hour');
  -- ...an ordinary appointment cannot be given one after the fact either.
  SELECT a.id INTO A_ID FROM role_assignment a
   WHERE a.person_id = U_COACH2 AND a.active AND a.expires_at IS NULL LIMIT 1;
  BEGIN
    UPDATE role_assignment SET expires_at = now() + interval '1 hour' WHERE id = A_ID;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM _assert(n = 1, 'the office could not reach the 2XI coach''s appointment — the next assertion would prove nothing');
    SET CONSTRAINTS role_assignment_expiry_has_reason IMMEDIATE;
    PERFORM _assert(false, 'an ordinary appointment was given an hour hand with no reason');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET CONSTRAINTS role_assignment_expiry_has_reason DEFERRED;
  -- The session this block opened is ended, so nothing below inherits it.
  SELECT ok INTO v_ok FROM support_access_end(S_ID);
  PERFORM _assert(v_ok, 'the school could not end the third support session');

  -- ── SCRBRD-054: a correction takes two people, in the database ──
  --
  -- db/02's INSERT policy on scoring_amendment asked for `scoring.correct`,
  -- which the director of sport holds for session recovery and which also
  -- made her the requester of the corrections she approves. db/24 moved the
  -- request onto `scoring.amend.request`, held by the scorer. Proven here as
  -- Postgres enforces it, not as roles.mjs describes it: Sarah, who approves,
  -- cannot file; the scorer, who files, can — and Sarah still holds what
  -- `scoring.correct` recovers, because taking that away was the wrong fix.
  PERFORM _assert(
    NOT EXISTS (SELECT 1 FROM role_capability
                 WHERE role IN ('directorofsport', 'competitionadmin')
                   AND capability = 'scoring.amend.request'),
    'an approver holds the request as well');
  PERFORM _assert(
    (SELECT count(*) FROM role_capability
      WHERE role IN ('directorofsport', 'competitionadmin') AND capability = 'scoring.correct') = 2,
    'session recovery was withdrawn from the roles that need it at the ground');
  PERFORM _as(U_SARAH);
  BEGIN
    INSERT INTO scoring_amendment (match_id, school_id, target_key, reason, requested_by)
    VALUES ('77777777-0000-0000-0000-000000000001', HIL, 'verify-key', 'Filed by an approver.', U_SARAH);
    PERFORM _assert(false, 'a director of sport filed an amendment request');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM _as(U_SCORER);
  INSERT INTO scoring_amendment (match_id, school_id, target_key, reason, requested_by)
  VALUES ('77777777-0000-0000-0000-000000000001', HIL, 'verify-key', 'Filed by the scorer.', U_SCORER);
  SELECT count(*) INTO n FROM scoring_amendment WHERE target_key = 'verify-key' AND requested_by = U_SCORER;
  PERFORM _assert(n = 1, 'the scorer could not file an amendment request');

  -- ── SCRBRD-053: the disciplinary record, and the six grants on it ──
  --
  -- `discipline.read` and `discipline.write` sat in the catalogue and in six
  -- role bundles gating nothing at all. db/25 is the record they now gate,
  -- and the point of asserting it here rather than in the model suites is
  -- that the policy is HAND-WRITTEN: the table is born after db/09, so
  -- generate-rls.mjs never sees it, and nothing but these assertions and the
  -- ones inside db/25 would notice if a predicate were wrong.
  --
  -- Nobody without the capability, first — AND THE PRINCIPAL MATTERS HERE.
  -- Medical staff are the one seeded account at Hilton whose refusal is
  -- attributable to the capability and to nothing else: the assignment is
  -- school-scoped with a NULL team, names no subject and names no fixture, so
  -- every other dimension of app_can() passes and only `discipline.write`
  -- is missing. A coach would be refused twice over — no capability AND a
  -- team anchor that is not his side — which tables.mjs's own note on derived
  -- anchors warns about: the falsification that does not fail because
  -- something else was already refusing. Granting `medical` the read and
  -- watching this block go red is how that was checked rather than assumed.
  PERFORM _as(U_MEDICAL);
  BEGIN
    INSERT INTO disciplinary_record (player_id, school_id, recorded_by, body)
    VALUES (P_INJURED, HIL, U_MEDICAL, 'Filed by somebody with no disciplinary authority.');
    PERFORM _assert(false, 'medical staff filed a disciplinary record');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- THE UMPIRE'S APPOINTMENT IS ONE FIXTURE, and that is the whole of his
  -- authority here. app_can() refuses a fixture-scoped assignment on a row
  -- that does not state the same fixture, so the match he stood at is the
  -- only match he can file about — and a row naming no fixture at all is
  -- refused too, because NULL on the resource narrows.
  PERFORM _as(U_UMPIRE);
  BEGIN
    INSERT INTO disciplinary_record (player_id, school_id, match_id, recorded_by, body)
    VALUES (P_INJURED, HIL, M_OTHER, U_UMPIRE, 'Filed about a fixture he did not stand at.');
    PERFORM _assert(false, 'an official filed an incident at a fixture he was not appointed to');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO disciplinary_record (player_id, school_id, recorded_by, body)
    VALUES (P_INJURED, HIL, U_UMPIRE, 'Filed against the school at large.');
    PERFORM _assert(false, 'an official filed a matter with no fixture behind it');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO disciplinary_record (player_id, school_id, match_id, recorded_by, body)
  VALUES (P_INJURED, HIL, M_STOOD, U_UMPIRE, 'Dissent at the umpire''s decision; sent from the field.');

  -- ...AND HE CANNOT READ IT BACK. `official` holds discipline.write and not
  -- discipline.read — the mirror of schooladmin, who reads and cannot write.
  -- This is also why neither write path uses RETURNING: Postgres applies the
  -- SELECT policy to a row an INSERT returns, so `returning id` would have
  -- refused the writer this capability exists for.
  SELECT count(*) INTO n FROM disciplinary_record;
  PERFORM _assert(n = 0, 'an official can read the disciplinary record he filed');

  -- Authorship is the session's, never the payload's.
  PERFORM _as(U_SARAH);
  SELECT id INTO D_ID FROM disciplinary_record WHERE match_id = M_STOOD;
  PERFORM _assert(
    (SELECT recorded_by FROM disciplinary_record WHERE id = D_ID) = U_UMPIRE,
    'the record does not name the person who actually filed it');

  -- The school-side readers, each for its own scope reason.
  SELECT count(*) INTO n FROM disciplinary_record WHERE id = D_ID;
  PERFORM _assert(n = 1, 'the director of sport cannot read a record at her own school');
  PERFORM _as(U_HEAD_M);
  SELECT count(*) INTO n FROM disciplinary_record WHERE id = D_ID;
  PERFORM _assert(n = 1, 'the principal cannot read a record at his own school');
  -- A pupil reads HIS OWN and nobody else's: `selfaccess` is subject-scoped,
  -- so the person anchor on the row has to be the child his assignment names.
  PERFORM _as(U_SELF);
  SELECT count(*) INTO n FROM disciplinary_record WHERE id = D_ID;
  PERFORM _assert(n = 1, 'a pupil cannot read his own disciplinary record');
  -- Another pupil, and medical staff: both school-scoped with a NULL team and
  -- no subject, so the capability is the only thing refusing either of them.
  PERFORM _as(U_PUPIL);
  SELECT count(*) INTO n FROM disciplinary_record;
  PERFORM _assert(n = 0, 'another pupil at the school reads it');
  PERFORM _as(U_MEDICAL);
  SELECT count(*) INTO n FROM disciplinary_record;
  PERFORM _assert(n = 0, 'medical staff read a disciplinary record');
  -- A coach is refused twice — no capability, and a team anchor that is not
  -- his side. Worth asserting because it is the case a school would actually
  -- worry about, and worth labelling because it would keep passing if the
  -- capability check were removed.
  PERFORM _as(U_COACH2);
  SELECT count(*) INTO n FROM disciplinary_record;
  PERFORM _assert(n = 0, 'a coach reads another side''s disciplinary record');
  -- The tenant line holds: Westville's office reads Westville's.
  PERFORM _as(U_WES_ADM);
  SELECT count(*) INTO n FROM disciplinary_record;
  PERFORM _assert(n = 0, 'another school''s administrator reads Hilton''s disciplinary record');

  -- PLATFORM-WIDE BY CONSTRUCTION, NOT BY EXCEPTION. A competition
  -- administrator's assignment names no school, and a NULL school on the
  -- ASSIGNMENT widens to every school — so the league reads this without a
  -- line anywhere saying so, and every read of it is stamped platform_wide by
  -- log_restricted_read() (db/20) for the same reason.
  PERFORM _as(U_LEAGUE);
  SELECT count(*) INTO n FROM disciplinary_record WHERE id = D_ID;
  PERFORM _assert(n = 1, 'the competition administrator cannot read a record across schools');
  PERFORM _assert(app_is_platform_wide(), 'a competition administrator is not treated as a platform-wide reader');

  -- THE ACCOUNT IS THE AUTHOR'S; THE OUTCOME IS THE SCHOOL'S. The director of
  -- sport did not write this and may not rewrite it, and she is exactly the
  -- person who has to be able to conclude it.
  PERFORM _as(U_SARAH);
  BEGIN
    UPDATE disciplinary_record SET body = 'Rewritten by somebody else.' WHERE id = D_ID;
    PERFORM _assert(false, 'a non-author rewrote the account of a disciplinary matter');
  EXCEPTION WHEN sqlstate '45001' THEN NULL;
  END;
  BEGIN
    UPDATE disciplinary_record SET player_id = P_U16B WHERE id = D_ID;
    PERFORM _assert(false, 'a disciplinary record was re-filed against another child');
  EXCEPTION WHEN sqlstate '45002' THEN NULL;
  END;
  BEGIN
    UPDATE disciplinary_record SET state = 'concluded' WHERE id = D_ID;
    PERFORM _assert(false, 'a matter was concluded without saying what happened');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE disciplinary_record SET state = 'concluded',
         outcome = 'Two matches missed; apology delivered to the umpire.' WHERE id = D_ID;
  SELECT count(*) INTO n FROM disciplinary_record
   WHERE id = D_ID AND state = 'concluded' AND recorded_by = U_UMPIRE AND updated_at IS NOT NULL;
  PERFORM _assert(n = 1, 'the school could not conclude a matter an official filed');

  -- Nothing here can be erased, at either layer.
  PERFORM _assert(
    NOT EXISTS (SELECT 1 FROM pg_policy
                 WHERE polrelid = 'disciplinary_record'::regclass AND polcmd = 'd'),
    'disciplinary_record has a delete policy');

  -- ── 14. A plain claim cannot jump a handover (SCRBRD-059, db/28) ─
  -- The scoring screen makes a plain scoring_claim() on ordinary mount. While
  -- a handover is armed or being verified that claim must be refused by the
  -- DATABASE, naming the state — the client's own pre-check is a courtesy a
  -- direct API call never meets. Driven through the real functions, as the
  -- scorer (outgoing, device a) and Sarah (incoming, device b; she also holds
  -- scoring.correct, which the recovery at the end needs).
  PERFORM _scoring_session_reset(M_HANDOVER);
  PERFORM _as(U_SCORER);
  SELECT c.ok, c.epoch INTO v_ok, v_epoch FROM scoring_claim(M_HANDOVER, 'verify-059-a') c;
  PERFORM _assert(v_ok AND v_epoch = 1, 'the scorer could not claim an idle match');
  SELECT a.ok, a.code INTO v_ok, v_code FROM scoring_arm_handover(M_HANDOVER, 'verify-059-a', 0, false) a;
  PERFORM _assert(v_ok AND v_code ~ '^\d{6}$', 'the scorer could not arm a handover');

  -- Armed: another device's plain claim is refused as handover_pending.
  PERFORM _as(U_SARAH);
  SELECT c.ok, c.reason, c.epoch INTO v_ok, v_reason, v_epoch FROM scoring_claim(M_HANDOVER, 'verify-059-b') c;
  PERFORM _assert(NOT v_ok AND v_reason = 'handover_pending' AND v_epoch = 1,
    format('a plain claim jumped an armed handover (ok=%s reason=%s)', v_ok, v_reason));
  SELECT count(*) INTO n FROM scoring_session
   WHERE match_id = M_HANDOVER AND state = 'handover_pending' AND handover_code = v_code AND epoch = 1;
  PERFORM _assert(n = 1, 'a refused claim still disturbed the armed handover');
  -- The arming device's string, sent by somebody else, is not the arming holder.
  SELECT c.reason INTO v_reason FROM scoring_claim(M_HANDOVER, 'verify-059-a') c;
  PERFORM _assert(v_reason IS NOT DISTINCT FROM 'handover_pending',
    'another user claimed an armed handover by naming the arming device');
  -- Not lease-gated: nothing refreshes the outgoing lease once it is armed.
  PERFORM _lapse_scoring_lease(M_HANDOVER);
  SELECT c.reason INTO v_reason FROM scoring_claim(M_HANDOVER, 'verify-059-b') c;
  PERFORM _assert(v_reason IS NOT DISTINCT FROM 'handover_pending',
    'an armed handover was claimable once the outgoing lease lapsed');

  -- The arming device and user taking it back is the client's cancel
  -- (apps/web/src/lib/handover.js) and must keep working.
  PERFORM _as(U_SCORER);
  SELECT c.ok, c.epoch INTO v_ok, v_epoch FROM scoring_claim(M_HANDOVER, 'verify-059-a') c;
  PERFORM _assert(v_ok AND v_epoch = 2, 'the arming device could not take its own handover back');
  SELECT state::text INTO v_state FROM scoring_session WHERE match_id = M_HANDOVER;
  PERFORM _assert(v_state = 'active', 'cancelling a handover left the session ' || coalesce(v_state, 'unreadable'));

  -- Verifying: refused as verifying — the claimant, the outgoing device, lease or no lease.
  SELECT a.code INTO v_code FROM scoring_arm_handover(M_HANDOVER, 'verify-059-a', 0, false) a;
  PERFORM _as(U_SARAH);
  SELECT h.ok INTO v_ok FROM scoring_claim_handover(M_HANDOVER, 'verify-059-b', v_code) h;
  PERFORM _assert(v_ok, 'Sarah could not claim the handover with its code');
  SELECT c.ok, c.reason, c.epoch INTO v_ok, v_reason, v_epoch FROM scoring_claim(M_HANDOVER, 'verify-059-b') c;
  PERFORM _assert(NOT v_ok AND v_reason = 'verifying' AND v_epoch = 2,
    format('the claimant skipped its own verification with a plain claim (ok=%s reason=%s)', v_ok, v_reason));
  PERFORM _as(U_SCORER);
  SELECT c.reason INTO v_reason FROM scoring_claim(M_HANDOVER, 'verify-059-a') c;
  PERFORM _assert(v_reason IS NOT DISTINCT FROM 'verifying',
    'the outgoing device claimed back past a verification in progress');
  PERFORM _lapse_scoring_lease(M_HANDOVER);
  SELECT c.reason INTO v_reason FROM scoring_claim(M_HANDOVER, 'verify-059-a') c;
  PERFORM _assert(v_reason IS NOT DISTINCT FROM 'verifying',
    'a verification in progress was claimable once the lease lapsed');
  SELECT count(*) INTO n FROM scoring_session
   WHERE match_id = M_HANDOVER AND state = 'verifying' AND epoch = 2 AND claimant_device = 'verify-059-b';
  PERFORM _assert(n = 1, 'a refused claim still disturbed the verification');

  -- Recovery is unchanged: force-release once the lease has lapsed, then claim.
  PERFORM _as(U_SARAH);
  SELECT f.ok INTO v_ok FROM scoring_force_release(M_HANDOVER) f;
  PERFORM _assert(v_ok, 'a stalled verification could not be force-released');
  PERFORM _as(U_SCORER);
  SELECT c.ok, c.epoch INTO v_ok, v_epoch FROM scoring_claim(M_HANDOVER, 'verify-059-a') c;
  PERFORM _assert(v_ok AND v_epoch = 4, 'the released match could not be claimed fresh');
  -- And the live-lease refusal is exactly what it was.
  PERFORM _as(U_SARAH);
  SELECT c.ok, c.reason INTO v_ok, v_reason FROM scoring_claim(M_HANDOVER, 'verify-059-b') c;
  PERFORM _assert(NOT v_ok AND v_reason = 'lease_active', 'a live lease is no longer refused as lease_active');

  -- ── 15. A duty's lifecycle, and completion ends scoring (SCRBRD-034) ─
  -- db/30's duty_status() derives each state from a fact already on record;
  -- db/33 makes a complete match unscorable for everyone. One fixture walked
  -- through its life: the scorer appointment seeded above (A Wessels, who
  -- holds an account) and an umpire already stood down. Sarah reads.
  PERFORM _scoring_session_reset(M_HANDOVER);
  PERFORM _as(U_SARAH);
  PERFORM _assert(duty_status(O_SCORER) = 'pending',
    'a scheduled fixture''s scorer is not pending: ' || coalesce(duty_status(O_SCORER), 'NULL'));
  PERFORM _assert(duty_status(O_STOOD) = 'revoked', 'a withdrawn appointment is not revoked');
  -- Only to a reader who may see the appointment: Westville's office may not.
  PERFORM _as(U_WES_ADM);
  PERFORM _assert(duty_status(O_SCORER) IS NULL, 'duty_status answered a reader who cannot see the fixture');
  PERFORM _as(U_SARAH);

  PERFORM _set_match_status(M_HANDOVER, 'live');
  PERFORM _assert(duty_status(O_SCORER) = 'active', 'a live fixture''s scorer is not active');
  PERFORM _assert(duty_status(O_STOOD) = 'revoked', 'a stood-down umpire came back to life when play began');

  -- The scorer hands the pen to Sarah: delegated, while she holds it.
  PERFORM _as(U_SCORER);
  SELECT c.ok INTO v_ok FROM scoring_claim(M_HANDOVER, 'verify-034-a') c;
  PERFORM _assert(v_ok, 'the scorer could not claim a live fixture');
  PERFORM _assert(duty_status(O_SCORER) = 'active', 'the scorer holding the pen is not active');
  SELECT a.code INTO v_code FROM scoring_arm_handover(M_HANDOVER, 'verify-034-a', 0, false) a;
  PERFORM _as(U_SARAH);
  SELECT h.ok INTO v_ok FROM scoring_claim_handover(M_HANDOVER, 'verify-034-b', v_code) h;
  PERFORM _assert(v_ok, 'Sarah could not claim the scorer''s handover');
  -- A wrong reading answers with the server's own count; the right one follows.
  SELECT v.exp_runs, v.exp_wkts, v.exp_balls INTO v_runs, v_wkts, v_balls
    FROM scoring_verify_takeover(M_HANDOVER, 'verify-034-b', -1, -1, -1) v;
  SELECT v.ok INTO v_ok FROM scoring_verify_takeover(M_HANDOVER, 'verify-034-b', v_runs, v_wkts, v_balls) v;
  PERFORM _assert(v_ok, 'Sarah could not complete the takeover');
  PERFORM _assert(duty_status(O_SCORER) = 'delegated',
    'the scorer who handed the pen over is not delegated: ' || coalesce(duty_status(O_SCORER), 'NULL'));
  -- The scorer reads the fixture and not scoring_audit (audit.read is the
  -- office's) — and is told the same thing about his own duty.
  PERFORM _as(U_SCORER);
  SELECT count(*) INTO n FROM scoring_audit WHERE match_id = M_HANDOVER;
  PERFORM _assert(n = 0, 'the scorer reads scoring_audit — the next assertion would prove nothing');
  PERFORM _assert(duty_status(O_SCORER) IS NOT DISTINCT FROM 'delegated',
    'a reader without audit.read is told something different about the same duty: ' || coalesce(duty_status(O_SCORER), 'NULL'));
  -- He takes it back once her lease lapses: holding it again is active.
  PERFORM _lapse_scoring_lease(M_HANDOVER);
  PERFORM _as(U_SCORER);
  SELECT c.ok INTO v_ok FROM scoring_claim(M_HANDOVER, 'verify-034-a') c;
  PERFORM _assert(v_ok, 'the scorer could not take a lapsed token back');
  PERFORM _assert(duty_status(O_SCORER) = 'active', 'a scorer holding the pen again is still delegated');

  -- ── Completion ends scoring (db/33) ──
  -- Arm a handover and put another one mid-verification first, so both of
  -- the handover functions meet a complete match with work in flight.
  SELECT a.code INTO v_code FROM scoring_arm_handover(M_HANDOVER, 'verify-034-a', 0, false) a;
  PERFORM _assert(v_code IS NOT NULL, 'the scorer could not arm a handover on a live fixture');
  PERFORM _set_match_status(M_HANDOVER, 'complete');
  PERFORM _as(U_SARAH);
  SELECT h.ok, h.reason INTO v_ok, v_reason FROM scoring_claim_handover(M_HANDOVER, 'verify-034-b', v_code) h;
  PERFORM _assert(NOT v_ok AND v_reason = 'match_complete',
    format('a handover was claimed on a complete match (ok=%s reason=%s)', v_ok, v_reason));
  PERFORM _set_match_status(M_HANDOVER, 'live');
  SELECT h.ok INTO v_ok FROM scoring_claim_handover(M_HANDOVER, 'verify-034-b', v_code) h;
  PERFORM _assert(v_ok, 'the handover could not be claimed once the fixture was live again');
  PERFORM _set_match_status(M_HANDOVER, 'complete');
  SELECT v.ok, v.reason INTO v_ok, v_reason
    FROM scoring_verify_takeover(M_HANDOVER, 'verify-034-b', v_runs, v_wkts, v_balls) v;
  PERFORM _assert(NOT v_ok AND v_reason = 'match_complete',
    format('a takeover was verified on a complete match (ok=%s reason=%s)', v_ok, v_reason));
  SELECT count(*) INTO n FROM scoring_session
   WHERE match_id = M_HANDOVER AND state = 'verifying' AND claimant_device = 'verify-034-b';
  PERFORM _assert(n = 1, 'a refused takeover still moved the session');

  -- The plain claim: refused for everyone, the supervisor included, once
  -- the session is idle and nothing else would stand in the way.
  PERFORM _lapse_scoring_lease(M_HANDOVER);
  SELECT f.ok INTO v_ok FROM scoring_force_release(M_HANDOVER) f;
  PERFORM _assert(v_ok, 'a session on a complete match could not be force-released — that is how one is tidied');
  SELECT c.ok, c.reason INTO v_ok, v_reason FROM scoring_claim(M_HANDOVER, 'verify-034-b') c;
  PERFORM _assert(NOT v_ok AND v_reason = 'match_complete',
    format('the director of sport claimed a complete match (ok=%s reason=%s)', v_ok, v_reason));
  PERFORM _as(U_SCORER);
  SELECT c.ok, c.reason INTO v_ok, v_reason FROM scoring_claim(M_HANDOVER, 'verify-034-a') c;
  PERFORM _assert(NOT v_ok AND v_reason = 'match_complete',
    format('the appointed scorer claimed a complete match (ok=%s reason=%s)', v_ok, v_reason));
  SELECT count(*) INTO n FROM scoring_session WHERE match_id = M_HANDOVER AND state = 'idle';
  PERFORM _assert(n = 1, 'a refused claim on a complete match still took the token');

  -- The lease: a token held when the result is declared is not extended.
  -- Live again, the scorer claims; complete, the very next check refuses —
  -- while the lease is still running, which is the case that matters.
  PERFORM _set_match_status(M_HANDOVER, 'live');
  SELECT c.ok, c.epoch INTO v_ok, v_epoch FROM scoring_claim(M_HANDOVER, 'verify-034-a') c;
  PERFORM _assert(v_ok, 'the scorer could not claim the fixture back while live');
  SELECT l.holds INTO v_ok FROM scoring_lease_check(M_HANDOVER, 'verify-034-a', v_epoch) l;
  PERFORM _assert(v_ok, 'the token holder''s lease check fails on a live fixture');
  PERFORM _set_match_status(M_HANDOVER, 'complete');
  v_until := _lease_until(M_HANDOVER);
  SELECT l.holds, l.state INTO v_ok, v_state FROM scoring_lease_check(M_HANDOVER, 'verify-034-a', v_epoch) l;
  PERFORM _assert(NOT v_ok AND v_state = 'match_complete',
    format('a lease was honoured on a complete match (holds=%s state=%s)', v_ok, v_state));
  PERFORM _assert(_lease_until(M_HANDOVER) = v_until, 'a lease was extended on a complete match');
  PERFORM _assert(duty_status(O_SCORER) = 'completed', 'a finished fixture''s scorer is not completed');

  -- Corrections are the amendment path, and completion leaves it open.
  INSERT INTO scoring_amendment (match_id, school_id, target_key, reason, requested_by)
  VALUES (M_HANDOVER, HIL, 'verify-034-key', 'Filed after the result was declared.', U_SCORER);
  SELECT count(*) INTO n FROM scoring_amendment WHERE target_key = 'verify-034-key' AND match_id = M_HANDOVER;
  PERFORM _assert(n = 1, 'completion shut the amendment request as well');

  PERFORM _set_match_status(M_HANDOVER, 'abandoned');
  PERFORM _assert(duty_status(O_SCORER) = 'expired', 'an abandoned fixture''s scorer is not expired');
  PERFORM _assert(duty_status(O_STOOD) = 'revoked', 'withdrawn does not outrank the fixture''s end');

  RAISE NOTICE 'ALL RLS LIVE ASSERTIONS PASSED';
END $$;

ROLLBACK;
\set QUIET off

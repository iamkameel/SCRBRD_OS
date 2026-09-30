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
-- IS NOT TRUE, not NOT: a condition that comes out NULL — a comparison against
-- a value SELECT ... INTO found no row for — is a check that never ran, and
-- `IF NOT NULL` does not raise. That let an assertion pass vacuously.
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'RLS ASSERT FAILED: % (condition was %)', msg, coalesce(cond::text, 'NULL'); END IF; END $$ LANGUAGE plpgsql;

-- Revoke an assignment as the table owner. Created here, before privilege is
-- dropped, because the unprivileged role cannot SET ROLE back up — which is
-- itself the correct behaviour and worth not weakening just to write a test.
CREATE OR REPLACE FUNCTION _revoke(p_person uuid) RETURNS void AS $$
  UPDATE role_assignment SET active = false WHERE person_id = p_person;
$$ LANGUAGE sql SECURITY DEFINER;

-- Reach past RLS to state a fact about the whole table. Used only where the
-- claim IS "no such row exists anywhere" — an assertion scoped to what one
-- reader can see could not tell an empty table from a well-hidden row.
--
-- Since db/62 a guardian link is open while the child is at school, so the
-- claim is no longer "none is open-ended" but "none is open-ended without
-- cause": an open link belongs to a minor, or to a pupil still_at_school().
-- The first counts the ones that break that; the second counts the ones
-- that keep it, so the rule is seen to be in use and not merely unbroken.
CREATE OR REPLACE FUNCTION _count_open_guardian_links() RETURNS integer AS $$
  SELECT count(*)::int FROM assignment_subject s
    JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
    JOIN player p ON p.id = s.player_id
   WHERE s.valid_until IS NULL
     AND NOT coalesce(majority_on(p.born) > current_date, false)
     AND NOT still_at_school(p.id);
$$ LANGUAGE sql SECURITY DEFINER;

-- The end dates of one person's guardian links to one child, as the owner
-- reads them (NULL: open), newest first.
CREATE OR REPLACE FUNCTION _guardian_link_ends(p_player uuid, p_person uuid) RETURNS SETOF date AS $$
  SELECT s.valid_until FROM assignment_subject s
    JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
   WHERE s.player_id = p_player AND a.person_id = p_person
   ORDER BY s.created_at DESC, s.id;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION _count_open_pupil_links() RETURNS integer AS $$
  SELECT count(*)::int FROM assignment_subject s
    JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
   WHERE s.valid_until IS NULL AND still_at_school(s.player_id);
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

-- §28 (db/50). A fresh fixture copied from another — same school, team,
-- sport and format, nothing scored, no toss — so the pad's credential is
-- tested on a match nothing else here has touched. And the three facts about
-- a credential only the owner can state: why it ended, how many one-time ids
-- it has spent, and a match day already over.
CREATE OR REPLACE FUNCTION _db50_fixture(p_id uuid, p_src uuid) RETURNS void AS $$
  INSERT INTO match SELECT (jsonb_populate_record(NULL::match,
    to_jsonb(m) || jsonb_build_object('id', p_id, 'status', 'scheduled'))).* FROM match m WHERE m.id = p_src;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _db50_reason(p_credential uuid) RETURNS text AS $$
  SELECT coalesce(revoked_reason, 'live') FROM pad_resume_credential WHERE id = p_credential;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _db50_jtis(p_credential uuid) RETURNS integer AS $$
  SELECT count(*)::int FROM pad_resume_jti WHERE credential_id = p_credential;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _db50_expire(p_credential uuid) RETURNS void AS $$
  UPDATE pad_resume_credential SET issued_at = now() - interval '2 days', expires_at = now() - interval '1 second'
   WHERE id = p_credential;
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

-- db/42: what the milestone trigger wrote. The claim is "the trigger wrote no
-- such row", which a reader's policy could not tell from a hidden one.
CREATE OR REPLACE FUNCTION _count_milestones(p_player uuid, p_kind text, p_match uuid) RETURNS integer AS $$
  SELECT count(*)::int FROM milestone_notice WHERE player_id = p_player AND kind = p_kind AND match_id = p_match;
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

-- SCRBRD-034 (section 15). A scorer with an account and NO assignment at all,
-- appointed to a fixture nothing else here touches — so every read that
-- passes or fails for them passes or fails because of the one assignment the
-- office links, and for no other reason. The appointment is written as the
-- owner, the way the seed writes appointments; the link, the suspension and
-- the lift are made below as the application role, through the functions.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-00000000034a', '11111111-1111-1111-1111-111111111111',
   'duty34@example.invalid', 'D Duty', 'scorer')
ON CONFLICT DO NOTHING;
INSERT INTO match (id, school_id, team_code, opponent, starts_at, format, overs, status) VALUES
  ('77777777-0000-0000-0000-00000000034a', '11111111-1111-1111-1111-111111111111', '1XI',
   'Verify 034 XI', now() + interval '3 days', 'T20', 20, 'scheduled')
ON CONFLICT DO NOTHING;
INSERT INTO match_official (id, match_id, school_id, duty, person_name, person_id) VALUES
  ('0d000000-0000-0000-0000-00000000034a', '77777777-0000-0000-0000-00000000034a',
   '11111111-1111-1111-1111-111111111111', 'scorer', 'D Duty', '88888888-0000-0000-0000-00000000034a'),
  -- A second, never linked: the link guard is asserted on a duty with no live
  -- link to protect, so it cannot pass for that reason instead.
  ('0d000000-0000-0000-0000-00000000034b', '77777777-0000-0000-0000-00000000034a',
   '11111111-1111-1111-1111-111111111111', 'umpire', 'D Duty', '88888888-0000-0000-0000-00000000034a')
ON CONFLICT DO NOTHING;

-- The application role holds no privilege on match_official.assignment_id,
-- so the link's SHAPE guard can only be reached as the owner. This is that
-- reach, for the assertions that the guard refuses a wrong link however it is
-- written.
CREATE OR REPLACE FUNCTION _link_raw(p_duty uuid, p_assignment uuid) RETURNS void AS $$
  UPDATE match_official SET assignment_id = p_assignment WHERE id = p_duty;
$$ LANGUAGE sql SECURITY DEFINER;

-- db/37. "No held ball is still waiting for a person although the same event
-- is already in the log" is a claim about the whole table, so it is counted
-- past RLS, like the guardian-link count above.
CREATE OR REPLACE FUNCTION _count_open_held_copies() RETURNS integer AS $$
  SELECT count(*)::int FROM ball_event_quarantine q
    JOIN ball_event b ON b.idempotency_key = q.idempotency_key AND b.match_id = q.match_id
   WHERE q.resolved_at IS NULL
     AND (q.fingerprint IS NULL OR q.fingerprint = b.fingerprint);
$$ LANGUAGE sql SECURITY DEFINER;

-- db/38. Whether a transaction holds a row lock on a match's scoring_session
-- row: SELECT ... FOR UPDATE stamps the row's xmax with the locker, so a row
-- this transaction has just created (xmax 0) reads non-zero once something has
-- locked it. Read past RLS: the claim is about the row, not about who may see it.
CREATE OR REPLACE FUNCTION _session_xmax(p_match uuid) RETURNS text AS $$
  SELECT xmax::text FROM scoring_session WHERE match_id = p_match;
$$ LANGUAGE sql SECURITY DEFINER;

-- db/39. R Pillay (1XI, with a selfaccess assignment naming himself) called up
-- to the U16B fixture his team assignment cannot see, beside a U16B boy's own
-- declaration for the same Saturday; a second non-1XI fixture for him to
-- declare against as himself; and a trip arranged for the seeded driver, for
-- the case db/39 deliberately leaves alone. Owner-written, rolled back.
INSERT INTO match (id, school_id, team_code, opponent, starts_at, format, overs, status) VALUES
  ('77777777-0000-0000-0000-000000000039', '11111111-1111-1111-1111-111111111111', 'U15A',
   'Verify 039 XI', now() + interval '5 days', 'T20', 20, 'scheduled')
ON CONFLICT DO NOTHING;
INSERT INTO match_availability (match_id, player_id, school_id, status, reason_kind) VALUES
  ('77777777-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000005',
   '11111111-1111-1111-1111-111111111111', 'available', NULL),
  ('77777777-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000006',
   '11111111-1111-1111-1111-111111111111', 'unavailable', 'family')
ON CONFLICT DO NOTHING;
INSERT INTO trip (id, match_id, school_id, driver_id, pickup) VALUES
  ('39390000-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', '88888888-0000-0000-0000-000000000017', 'db/99: the withheld case')
ON CONFLICT DO NOTHING;
INSERT INTO match_pitch_report (match_id, school_id, surface, favours) VALUES
  ('77777777-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'firm', 'seam')
ON CONFLICT DO NOTHING;

-- db/41. A second driver at the same school (a test-only account, like the
-- umpire above), and three fixtures: A's today (with a second bus on it, which
-- B drives), B's today (with a bus nobody is named on), and A's in ten days.
-- The squads (named in the section itself, by _pick_41, so no earlier count
-- of a team sheet moves) are J Whitfield, whom the seed gives an emergency
-- contact and whose registration nothing earlier in this file touches, so
-- each manifest has something in it to leak. Owner-written, rolled back.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-00000000041b', '11111111-1111-1111-1111-111111111111',
   'driver41b@example.invalid', 'B Second-Driver', 'driver')
ON CONFLICT DO NOTHING;
INSERT INTO role_assignment (id, person_id, role, school_id, team_code) VALUES
  ('a5510000-0000-0000-0000-00000000041b', '88888888-0000-0000-0000-00000000041b', 'driver',
   '11111111-1111-1111-1111-111111111111', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO match (id, school_id, team_code, opponent, starts_at, format, overs, status) VALUES
  ('77777777-0000-0000-0000-0000000041a0', '11111111-1111-1111-1111-111111111111', '1XI',
   'Verify 041 A XI', now() + interval '3 hours', 'T20', 20, 'scheduled'),
  ('77777777-0000-0000-0000-0000000041b0', '11111111-1111-1111-1111-111111111111', '2XI',
   'Verify 041 B XI', now() + interval '3 hours', 'T20', 20, 'scheduled'),
  ('77777777-0000-0000-0000-0000000041f0', '11111111-1111-1111-1111-111111111111', '1XI',
   'Verify 041 F XI', now() + interval '10 days', 'T20', 20, 'scheduled')
ON CONFLICT DO NOTHING;
INSERT INTO trip (id, match_id, school_id, driver_id, depart_at, pickup) VALUES
  ('41410000-0000-0000-0000-00000000000a', '77777777-0000-0000-0000-0000000041a0',
   '11111111-1111-1111-1111-111111111111', '88888888-0000-0000-0000-000000000017',
   now() + interval '2 hours', 'db/99: A''s bus'),
  ('41410000-0000-0000-0000-0000000000a2', '77777777-0000-0000-0000-0000000041a0',
   '11111111-1111-1111-1111-111111111111', '88888888-0000-0000-0000-00000000041b',
   now() + interval '2 hours', 'db/99: B''s bus to A''s fixture'),
  -- The office's own schooladmin at the wheel of a third bus to A's fixture:
  -- somebody who reads the fixture in his own right and also drives, whom
  -- db/41's restrictive policy must leave exactly as he was.
  ('41410000-0000-0000-0000-0000000000a3', '77777777-0000-0000-0000-0000000041a0',
   '11111111-1111-1111-1111-111111111111', '88888888-0000-0000-0000-00000000000c',
   now() + interval '2 hours', 'db/99: the office drives too'),
  ('41410000-0000-0000-0000-00000000000b', '77777777-0000-0000-0000-0000000041b0',
   '11111111-1111-1111-1111-111111111111', '88888888-0000-0000-0000-00000000041b',
   now() + interval '2 hours', 'db/99: B''s bus'),
  ('41410000-0000-0000-0000-00000000000c', '77777777-0000-0000-0000-0000000041b0',
   '11111111-1111-1111-1111-111111111111', NULL,
   now() + interval '2 hours', 'db/99: nobody named'),
  ('41410000-0000-0000-0000-00000000000f', '77777777-0000-0000-0000-0000000041f0',
   '11111111-1111-1111-1111-111111111111', '88888888-0000-0000-0000-000000000017',
   now() + interval '10 days', 'db/99: A''s bus, a fortnight off')
ON CONFLICT DO NOTHING;

-- Past RLS: the trips a person is named on; the fixtures of his live ones;
-- what a manifest holds; whether a mark landed.
CREATE OR REPLACE FUNCTION _count_trips_driven_by(p_user uuid) RETURNS integer AS $$
  SELECT count(*)::int FROM trip WHERE driver_id = p_user;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _count_matches_driven_by(p_user uuid) RETURNS integer AS $$
  SELECT count(DISTINCT match_id)::int FROM trip WHERE driver_id = p_user AND cancelled_at IS NULL;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _manifest_size(p_trip uuid) RETURNS integer AS $$
  SELECT count(*)::int
    FROM trip t JOIN match_squad s ON s.match_id = t.match_id AND NOT s.withdrawn
    JOIN player p ON p.id = s.player_id AND p.school_id = t.school_id
    JOIN emergency_contact c ON c.player_id = p.id AND c.active
   WHERE t.id = p_trip;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _pick_41() RETURNS void AS $$
  INSERT INTO match_squad (match_id, player_id, side) VALUES
    ('77777777-0000-0000-0000-0000000041a0', 'aaaaaaaa-0000-0000-0000-000000000001', 'home'),
    ('77777777-0000-0000-0000-0000000041b0', 'aaaaaaaa-0000-0000-0000-000000000001', 'home'),
    ('77777777-0000-0000-0000-0000000041f0', 'aaaaaaaa-0000-0000-0000-000000000001', 'home')
  ON CONFLICT DO NOTHING;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _trip_departed(p_trip uuid) RETURNS boolean AS $$
  SELECT departed_at IS NOT NULL FROM trip WHERE id = p_trip;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _cancel_trip(p_trip uuid) RETURNS void AS $$
  UPDATE trip SET cancelled_at = now() WHERE id = p_trip;
$$ LANGUAGE sql SECURITY DEFINER;
-- What the CURRENT person could read of match and trip before db/41, computed
-- from the policies db/09 shipped: match_read's two arms, and trip_read with
-- its anchor subquery — which resolves exactly when match_read passes, and
-- otherwise hands app_can() a NULL school and team.
CREATE OR REPLACE FUNCTION _match_read_09(m match) RETURNS boolean AS $$
  SELECT app_can('fixture.read', m.school_id, m.team_code, '00000000-0000-0000-0000-000000000000'::uuid, m.id)
      OR app_can('fixture.read', m.away_school_id, m.away_team_code, '00000000-0000-0000-0000-000000000000'::uuid, m.id);
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _count_match_before_41() RETURNS integer AS $$
  SELECT count(*)::int FROM match m WHERE _match_read_09(m);
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _count_trip_before_41() RETURNS integer AS $$
  SELECT count(*)::int FROM trip t JOIN match m ON m.id = t.match_id
   WHERE app_can('transport.read',
                 CASE WHEN _match_read_09(m) THEN m.school_id END,
                 CASE WHEN _match_read_09(m) THEN m.team_code END,
                 '00000000-0000-0000-0000-000000000000'::uuid, t.match_id);
$$ LANGUAGE sql SECURITY DEFINER;

-- db/43. A ball with no type and a wicket with no method are refused at the
-- door now (the trigger ball_event_names_its_delivery), so the rows a
-- database stored before it cannot be CREATED — only inherited, the position
-- _born_constraint is in for db/11. Lifting the door for one INSERT is how
-- such a row is reproduced honestly; it goes back on at once, and the file
-- rolls back either way. Written as the owner, as a row past the API's own
-- door would have been. Before db/43 there is no door to lift.
CREATE OR REPLACE FUNCTION _insert_past_the_door(p_rows jsonb) RETURNS integer AS $$
DECLARE n integer;
  v_door boolean := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                             AND tgname = 'ball_event_names_its_delivery' AND tgenabled = 'O');
BEGIN
  IF v_door THEN EXECUTE 'ALTER TABLE ball_event DISABLE TRIGGER ball_event_names_its_delivery'; END IF;
  INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                          client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id, dismissed_id,
                          dismissal, payload)
  SELECT r.match_id, match_school(r.match_id), r.seq, r.epoch, r.innings, r.scorer_user_id, r.device_id,
         r.idempotency_key, r.client_seq, now(), r.kind, r.ball_type, r.value, r.striker_id, r.bowler_id,
         r.dismissed_id, r.dismissal, coalesce(r.payload, '{}'::jsonb)
    FROM jsonb_populate_recordset(null::ball_event, p_rows) r;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF v_door THEN EXECUTE 'ALTER TABLE ball_event ENABLE TRIGGER ball_event_names_its_delivery'; END IF;
  RETURN n;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- db/43, db/46. opposition_squad() opens only for a scheduled fixture a side
-- is in, inside its window (opposition_window_days(), five days since db/46),
-- with the feature on (db/08). A Hilton–Westville 1XI fixture p_days out, and
-- the feature on; owner-written, rolled back with everything else. §21 reads
-- a squad through one a day inside the window; §24 puts one either side of
-- the window's edge.
CREATE OR REPLACE FUNCTION _opposition_fixture(p_days integer) RETURNS uuid AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at,
                     sport, format, overs, status)
  VALUES ('11111111-1111-1111-1111-111111111111', '1XI',
          '22222222-2222-2222-2222-222222222222', '1XI', 'Westville Boys'' High', now() + make_interval(days => p_days),
          'cricket', 'T20', 20, 'scheduled')
  RETURNING id INTO v_id;
  UPDATE feature_flag SET enabled = true, locked = false WHERE key = 'opposition';
  DELETE FROM feature_suppression WHERE key = 'opposition';
  DELETE FROM feature_grant WHERE key = 'opposition';
  RETURN v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Past RLS, because each claim below is "exactly these rows and no others",
-- and an RLS-scoped count cannot tell the rows that exist from the rows shown.
CREATE OR REPLACE FUNCTION _count_availability_of(p_player uuid) RETURNS integer AS $$
  SELECT count(*)::int FROM match_availability WHERE player_id = p_player;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _count_rows(p_table text) RETURNS integer AS $$
DECLARE n int;
BEGIN EXECUTE format('SELECT count(*)::int FROM %I', p_table) INTO n; RETURN n; END
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- db/44 (section 22). Figures that straddle school seasons. Three Hilton 2XI
-- players; three 2XI fixtures — one in the 2025 school season, one starting
-- at 23:30 UTC on 31 December 2025 (01:30 on 1 January 2026 in Johannesburg,
-- so the 2026 season), one in 2026 — each carrying the same fifteen events,
-- which between them exercise every rule the career views follow; and a
-- Westville fixture in 2024, in which one delivery is bowled by a Hilton boy.
-- Written as the owner, but only when section 22 calls this — after every
-- other section, none of whose counts it may move — and rolled back with
-- everything else.
CREATE OR REPLACE FUNCTION _seed_44() RETURNS void AS $$
DECLARE
  HIL uuid := '11111111-1111-1111-1111-111111111111';
  WES uuid := '22222222-2222-2222-2222-222222222222';
  A   uuid := 'aaaaaaaa-0000-0000-0000-00000000044a';
  B   uuid := 'aaaaaaaa-0000-0000-0000-00000000044b';
  C   uuid := 'aaaaaaaa-0000-0000-0000-00000000044c';
  m   record;
  v_door boolean := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                             AND tgname = 'ball_event_names_its_delivery' AND tgenabled = 'O');
BEGIN
  INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
    (A, HIL, '2XI', 'V44 Opener',  44, 'batter', (current_date - interval '16 years')::date),
    (B, HIL, '2XI', 'V44 Partner', 45, 'batter', (current_date - interval '16 years')::date),
    (C, HIL, '2XI', 'V44 Seamer',  46, 'bowler', (current_date - interval '16 years')::date);
  INSERT INTO match (id, school_id, team_code, opponent, starts_at, format, overs, status) VALUES
    ('77777777-0000-0000-0000-000000044025', HIL, '2XI', 'Verify 044 (2025)',     '2025-06-14 09:00:00+02', 'T20', 20, 'complete'),
    ('77777777-0000-0000-0000-0000000440e0', HIL, '2XI', 'Verify 044 (New Year)', '2025-12-31 23:30:00+00', 'T20', 20, 'complete'),
    ('77777777-0000-0000-0000-000000044026', HIL, '2XI', 'Verify 044 (2026)',     '2026-03-07 09:00:00+02', 'T20', 20, 'complete'),
    ('77777777-0000-0000-0000-000000044024', WES, '1XI', 'Verify 044 (2024)',     '2024-03-09 09:00:00+02', 'T20', 20, 'complete');
  -- Per fixture, A on strike and B at the other end, C bowling:
  --    k  event                                    batting            dismissals        bowling
  --    1  run 4                                    A 4, a four        -                 4
  --    2  no-ball, 4 off the bat                   A 4, a four        -                 5, a no-ball
  --    3  W lbw — on the free hit 2 earned         A faced it         SAVED             legal, no wicket
  --    4  no-ball, 4 byes (nbRuns)                 A faced, 0         -                 1, a no-ball (db/52)
  --    5  wide, 1                                  not faced          -                 2, a wide
  --    6  run 6 (the free hit, carried by 5)       A 6, a six         -                 6
  --    7  leg bye, 1                               A faced, 0         -                 legal, 0
  --    8  W run out, B out at the other end        A faced            B                 legal, not his
  --    9  retire marked W, retired out, A          an innings of A's  A                 -
  --   10  a delivery with no ball type, 2, B       B 2, faced (a run) -                 2, legal
  --   11  W with no method, B                      B faced            B                 legal, nobody's wicket
  --   12  run 1, no striker on file                nobody's           -                 1
  --   13  run 2, B ...                             (voided)
  --   14  ... taken back by a void of 13           nothing            nothing           nothing
  --   15  retire, hurt, B (no W marker)            nothing            nothing           -
  -- One fixture: A 1 match, 14 runs, 7 balls, 2 fours, 1 six, 1 dismissal;
  -- B 1 match, 2 runs, 2 balls, 2 dismissals; C 1 match, 21 conceded, 8 legal
  -- balls, 1 wide, 2 no-balls, no wicket. 2025 holds one fixture, 2026 two.
  -- Rows 10 and 11 are the shapes db/43's door refuses, so they go in with the
  -- door lifted, as _insert_past_the_door() does: a legacy row, read as the
  -- fold reads it (db/43).
  IF v_door THEN EXECUTE 'ALTER TABLE ball_event DISABLE TRIGGER ball_event_names_its_delivery'; END IF;
  FOR m IN SELECT * FROM (VALUES ('77777777-0000-0000-0000-000000044025'::uuid, '2025'),
                                 ('77777777-0000-0000-0000-0000000440e0'::uuid, 'ny'),
                                 ('77777777-0000-0000-0000-000000044026'::uuid, '2026')) AS f(id, tag) LOOP
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value,
                            striker_id, bowler_id, dismissed_id, dismissal, payload)
    SELECT m.id, HIL, x.k, 1, 0, '88888888-0000-0000-0000-000000000006', 'verify-044',
           'verify:044:' || m.tag || ':' || x.k, x.k, now(), x.kind, x.bt, x.v,
           x.striker, x.bowler, x.dismissed, x.dis, x.pl
      FROM (VALUES
        ( 1, 'ball',   'run', 4,    A,    C,    NULL::uuid, NULL,          '{}'::jsonb),
        ( 2, 'ball',   'Nb',  4,    A,    C,    NULL,       NULL,          '{}'::jsonb),
        ( 3, 'ball',   'W',   0,    A,    C,    NULL,       'lbw',         '{}'::jsonb),
        ( 4, 'ball',   'Nb',  4,    A,    C,    NULL,       NULL,          '{"nbRuns":"byes"}'::jsonb),
        ( 5, 'ball',   'Wd',  1,    A,    C,    NULL,       NULL,          '{}'::jsonb),
        ( 6, 'ball',   'run', 6,    A,    C,    NULL,       NULL,          '{}'::jsonb),
        ( 7, 'ball',   'LB',  1,    A,    C,    NULL,       NULL,          '{}'::jsonb),
        ( 8, 'ball',   'W',   0,    A,    C,    B,          'run_out',     '{}'::jsonb),
        ( 9, 'retire', 'W',   NULL, NULL, NULL, NULL,       'retired_out', jsonb_build_object('batter', A, 'reason', 'out')),
        (10, 'ball',   NULL,  2,    B,    C,    NULL,       NULL,          '{}'::jsonb),
        (11, 'ball',   'W',   0,    B,    C,    NULL,       NULL,          '{}'::jsonb),
        (12, 'ball',   'run', 1,    NULL, C,    NULL,       NULL,          '{}'::jsonb),
        (13, 'ball',   'run', 2,    B,    C,    NULL,       NULL,          '{}'::jsonb),
        (14, 'void',   NULL,  NULL, NULL, NULL, NULL,       NULL,          jsonb_build_object('target', 'verify:044:' || m.tag || ':13')),
        (15, 'retire', NULL,  NULL, NULL, NULL, NULL,       NULL,          jsonb_build_object('batter', B, 'reason', 'hurt'))
      ) AS x(k, kind, bt, v, striker, bowler, dismissed, dis, pl);
  END LOOP;
  IF v_door THEN EXECUTE 'ALTER TABLE ball_event ENABLE TRIGGER ball_event_names_its_delivery'; END IF;
  -- Westville, 2024: D Mkhize bats, K Botha bowls — and one delivery by C.
  INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                          idempotency_key, client_seq, client_ts, kind, ball_type, value,
                          striker_id, bowler_id, dismissal, payload)
  SELECT '77777777-0000-0000-0000-000000044024', WES, x.k, 1, 0, '88888888-0000-0000-0000-000000000006',
         'verify-044', 'verify:044:wes:' || x.k, x.k, now(), 'ball', x.bt, x.v,
         'bbbbbbbb-0000-0000-0000-000000000001', x.bowler, x.dis, '{}'::jsonb
    FROM (VALUES (1, 'run', 4, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, NULL),
                 (2, 'run', 1, C,                                            NULL),
                 (3, 'W',   0, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'bowled')) AS x(k, bt, v, bowler, dis);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- db/44 (section 22). Deliveries stamped with a school that is not their
-- fixture's. The season views file a delivery under its MATCH's season,
-- reading the match under the caller's policy, and that covers every
-- delivery the caller may read exactly when this is zero (db/44's header
-- has the argument). Nothing in the schema forces it — every writer stamps
-- match_school() — so it is counted, past RLS, because the claim is about
-- the whole log, including a production log this file is pasted against.
CREATE OR REPLACE FUNCTION _count_ball_school_mismatch() RETURNS integer AS $$
  SELECT count(*)::int FROM ball_event b JOIN match m ON m.id = b.match_id
   WHERE b.school_id IS DISTINCT FROM m.school_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- db/44 (section 22). Every player whose lifetime figures, as the CURRENT
-- reader sees them, are not the sum of that reader's figures season by
-- season: batting, bowling and dismissals, every column. SECURITY INVOKER —
-- deliberately, like everything it reads — so it answers for whoever
-- section 22 has become. No rows is the invariant holding.
CREATE OR REPLACE FUNCTION _career_season_drift()
RETURNS TABLE (family text, player_id uuid, lifetime text, by_season text) AS $$
  SELECT 'batting', coalesce(l.player_id, s.player_id),
         row(l.matches, l.runs, l.balls_faced, l.fours, l.sixes, l.last_ball_at)::text,
         row(s.matches, s.runs, s.balls_faced, s.fours, s.sixes, s.last_ball_at)::text
    FROM player_batting_career l
    FULL JOIN (SELECT b.player_id, sum(b.matches) AS matches, sum(b.runs) AS runs,
                      sum(b.balls_faced) AS balls_faced, sum(b.fours) AS fours, sum(b.sixes) AS sixes,
                      max(b.last_ball_at) AS last_ball_at
                 FROM player_batting_by_season b GROUP BY b.player_id) s ON s.player_id = l.player_id
   WHERE (l.matches, l.runs, l.balls_faced, l.fours, l.sixes, l.last_ball_at)
         IS DISTINCT FROM (s.matches, s.runs, s.balls_faced, s.fours, s.sixes, s.last_ball_at)
  UNION ALL
  SELECT 'bowling', coalesce(l.player_id, s.player_id),
         row(l.matches, l.runs_conceded, l.legal_balls, l.wides, l.no_balls, l.wickets)::text,
         row(s.matches, s.runs_conceded, s.legal_balls, s.wides, s.no_balls, s.wickets)::text
    FROM player_bowling_career l
    FULL JOIN (SELECT b.player_id, sum(b.matches) AS matches, sum(b.runs_conceded) AS runs_conceded,
                      sum(b.legal_balls) AS legal_balls, sum(b.wides) AS wides, sum(b.no_balls) AS no_balls,
                      sum(b.wickets) AS wickets
                 FROM player_bowling_by_season b GROUP BY b.player_id) s ON s.player_id = l.player_id
   WHERE (l.matches, l.runs_conceded, l.legal_balls, l.wides, l.no_balls, l.wickets)
         IS DISTINCT FROM (s.matches, s.runs_conceded, s.legal_balls, s.wides, s.no_balls, s.wickets)
  UNION ALL
  SELECT 'dismissals', coalesce(l.player_id, s.player_id), l.dismissals::text, s.dismissals::text
    FROM player_dismissals l
    FULL JOIN (SELECT d.player_id, sum(d.dismissals) AS dismissals
                 FROM player_dismissals_by_season d GROUP BY d.player_id) s ON s.player_id = l.player_id
   WHERE l.dismissals IS DISTINCT FROM s.dismissals
$$ LANGUAGE sql STABLE;

-- db/47 (section 25). The public-data records. A sports administrator at
-- Westville (a test-only account, like the umpire above), so the away school
-- has somebody who may publish its own side; and a Hilton 1XI v Westville 1XI
-- fixture ten days out that nothing else here touches. Owner-written, rolled
-- back with everything else.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-00000000047a', '22222222-2222-2222-2222-222222222222',
   'sport47@example.invalid', 'W Publisher', 'sportsadmin')
ON CONFLICT DO NOTHING;
INSERT INTO role_assignment (id, person_id, role, school_id, team_code) VALUES
  ('a5510000-0000-0000-0000-00000000047a', '88888888-0000-0000-0000-00000000047a', 'sportsadmin',
   '22222222-2222-2222-2222-222222222222', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO match (id, school_id, team_code, away_school_id, away_team_code, opponent, starts_at,
                   format, overs, status) VALUES
  ('77777777-0000-0000-0000-000000000047', '11111111-1111-1111-1111-111111111111', '1XI',
   '22222222-2222-2222-2222-222222222222', '1XI', 'Westville Boys'' High', now() + interval '10 days',
   'T20', 20, 'scheduled')
ON CONFLICT DO NOTHING;

-- Past RLS: what db/47's tables hold for one child, whatever a reader sees.
-- The claims below are "the refused write left nothing" and "the withdrawal
-- ended a row, it did not delete one", which a reader's policy could not
-- tell from a hidden row.
CREATE OR REPLACE FUNCTION _consent_rows(p_player uuid) RETURNS integer AS $$
  SELECT count(*)::int FROM public_name_consent WHERE player_id = p_player;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _consent_open_rows(p_player uuid) RETURNS integer AS $$
  SELECT count(*)::int FROM public_name_consent WHERE player_id = p_player AND ended_on IS NULL;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _consent_last(p_player uuid) RETURNS public_name_consent AS $$
  SELECT * FROM public_name_consent WHERE player_id = p_player ORDER BY seq DESC LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _mark_rows(p_player uuid) RETURNS integer AS $$
  SELECT count(*)::int FROM player_never_public WHERE player_id = p_player;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION _born_of(p_player uuid) RETURNS date AS $$
  SELECT born FROM player WHERE id = p_player;
$$ LANGUAGE sql SECURITY DEFINER;
-- H Whitfield is also made guardian of the 2XI boy section 22 seeds, so a
-- consent record exists about a boy the 2XI coach actually coaches: "a coach
-- cannot read it" is then about his own player, not somebody else's.
CREATE OR REPLACE FUNCTION _link_47(p_player uuid) RETURNS void AS $$
  INSERT INTO assignment_subject (assignment_id, player_id, relationship, verification_state,
                                  verified_by, verified_at, consent_state, consent_version, consent_at, created_by)
  VALUES ('a5510000-0000-0000-0000-000000000010', p_player, 'parent', 'verified',
          '88888888-0000-0000-0000-00000000000c', now(), 'granted', 'popia-2026-01', now(),
          '88888888-0000-0000-0000-00000000000c');
$$ LANGUAGE sql SECURITY DEFINER;
-- db/49 (section 27). Every player whose lifetime figures, as the CURRENT
-- reader sees them, are not what the per-player functions say — the three
-- views exactly as db/02 defined them over player_batting_since(),
-- player_bowling_since() and player_dismissals_since() with no window, which
-- db/49 left untouched. SECURITY INVOKER, like _career_season_drift(), so it
-- answers for whoever section 27 has become. No rows is the invariant.
CREATE OR REPLACE FUNCTION _career_lifetime_drift()
RETURNS TABLE (family text, player_id uuid, one_pass text, per_player text) AS $$
  SELECT 'batting', coalesce(l.player_id, o.player_id),
         row(l.matches, l.runs, l.balls_faced, l.fours, l.sixes, l.last_ball_at)::text,
         row(o.matches, o.runs, o.balls_faced, o.fours, o.sixes, o.last_ball_at)::text
    FROM player_batting_career l
    FULL JOIN (SELECT p.id AS player_id, c.* FROM player p CROSS JOIN LATERAL player_batting_since(p.id, NULL) c
                WHERE c.matches > 0) o ON o.player_id = l.player_id
   WHERE (l.matches, l.runs, l.balls_faced, l.fours, l.sixes, l.last_ball_at)
         IS DISTINCT FROM (o.matches, o.runs, o.balls_faced, o.fours, o.sixes, o.last_ball_at)
  UNION ALL
  SELECT 'bowling', coalesce(l.player_id, o.player_id),
         row(l.matches, l.runs_conceded, l.legal_balls, l.wides, l.no_balls, l.wickets)::text,
         row(o.matches, o.runs_conceded, o.legal_balls, o.wides, o.no_balls, o.wickets)::text
    FROM player_bowling_career l
    FULL JOIN (SELECT p.id AS player_id, c.* FROM player p CROSS JOIN LATERAL player_bowling_since(p.id, NULL) c
                WHERE c.matches > 0) o ON o.player_id = l.player_id
   WHERE (l.matches, l.runs_conceded, l.legal_balls, l.wides, l.no_balls, l.wickets)
         IS DISTINCT FROM (o.matches, o.runs_conceded, o.legal_balls, o.wides, o.no_balls, o.wickets)
  UNION ALL
  SELECT 'dismissals', coalesce(l.player_id, o.player_id), l.dismissals::text, o.dismissals::text
    FROM player_dismissals l
    FULL JOIN (SELECT p.id AS player_id, player_dismissals_since(p.id, NULL) AS dismissals FROM player p
                WHERE player_dismissals_since(p.id, NULL) > 0) o ON o.player_id = l.player_id
   WHERE l.dismissals IS DISTINCT FROM o.dismissals
$$ LANGUAGE sql STABLE;

-- db/51 (section 29). The two figures the milestone trigger reads, as the
-- trigger reads them — as the owner, past RLS, which is who a SECURITY
-- DEFINER trigger is — against player_innings, the composition it read
-- before: every innings in the log, and every player's career, including a
-- player with none. No rows is the invariant.
CREATE OR REPLACE FUNCTION _milestone_figure_drift()
RETURNS TABLE (figure text, player_id uuid, match_id uuid, innings smallint, own_balls bigint, player_innings numeric) AS $$
  SELECT 'innings', i.player_id, i.match_id, i.innings,
         innings_runs_off_bat(i.player_id, i.match_id, i.innings), coalesce(i.runs, 0)
    FROM player_innings i
   WHERE innings_runs_off_bat(i.player_id, i.match_id, i.innings) IS DISTINCT FROM coalesce(i.runs, 0)
  UNION ALL
  SELECT 'career', p.id, NULL, NULL, career_runs_off_bat(p.id), c.runs
    FROM player p
    CROSS JOIN LATERAL (SELECT coalesce(sum(i.runs), 0) AS runs FROM player_innings i WHERE i.player_id = p.id) c
   WHERE career_runs_off_bat(p.id) IS DISTINCT FROM c.runs
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/51 (section 29). A school of its own, three boys and three fixtures,
-- scored one INSERT per delivery as a match arrives, raising every notice
-- the trigger writes: the batter's fifty and hundred in two fixtures and 500
-- career runs in the second (the first fixture's first six voided, a
-- no-ball's byes, a retirement, and a run out at the other end in each of
-- the last two, one of them in a fixture where he never faces; and a second
-- innings in the second fixture, as a two-innings match gives him, with a
-- fifty of its own beside the 402 of his first); the bowler's
-- hat-trick and five-for in two fixtures (a saved lbw on a free hit and a
-- run out between) and 25 career wickets. Returns the notices, in the order
-- written. Owner-written; the file rolls it back with everything else.
CREATE OR REPLACE FUNCTION _milestone_fixture_51() RETURNS text AS $$
DECLARE
  S  uuid := '51515151-0000-0000-0000-000000000051';
  U  uuid := '88888888-0000-0000-0000-000000000051';
  MA uuid := '77777777-0000-0000-0000-0000000051a0';
  MB uuid := '77777777-0000-0000-0000-0000000051b0';
  MC uuid := '77777777-0000-0000-0000-0000000051c0';
  A  uuid := 'aaaaaaaa-0000-0000-0000-00000000051a';
  B  uuid := 'aaaaaaaa-0000-0000-0000-00000000051b';
  C  uuid := 'aaaaaaaa-0000-0000-0000-00000000051c';
  x  record;
  v  text;
BEGIN
  INSERT INTO school (id, code, name) VALUES (S, 'verify-051', 'Verify 051');
  INSERT INTO app_user (id, email, name, role, school_id) VALUES (U, 'verify51@example.invalid', 'V51 Scorer', 'coach', S);
  INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
    (A, S, '1XI', 'V51 Opener',  1, 'batter', (current_date - interval '16 years')::date),
    (B, S, '1XI', 'V51 Partner', 2, 'batter', (current_date - interval '16 years')::date),
    (C, S, '1XI', 'V51 Seamer',  3, 'bowler', (current_date - interval '16 years')::date);
  INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
    (MA, S, '1XI', 'Verify 051 A', now() - interval '21 days', 'cricket', 'T20', 20, 'complete'),
    (MB, S, '1XI', 'Verify 051 B', now() - interval '14 days', 'cricket', 'T20', 20, 'complete'),
    (MC, S, '1XI', 'Verify 051 C', now() - interval '7 days',  'cricket', 'T20', 20, 'complete');
  FOR x IN
    SELECT e.m, e.inn, e.kind, e.bt, e.v, e.striker, e.bowler, e.dismissed, e.dis,
           CASE WHEN e.kind = 'void' THEN jsonb_build_object('target', 'verify:051:' || e.m || ':1') ELSE e.pl END AS pl,
           row_number() OVER (PARTITION BY e.m ORDER BY e.ord, g)::int AS seq
      FROM (VALUES
        ( 1, MA, 0, 'ball',   'run', 6,    A,    NULL::uuid, NULL::uuid, NULL,          '{}'::jsonb,         1),
        ( 2, MA, 0, 'void',   NULL,  NULL, NULL, NULL,       NULL,       NULL,          '{}'::jsonb,         1),
        ( 3, MA, 0, 'ball',   'run', 6,    A,    NULL,       NULL,       NULL,          '{}'::jsonb,        17),
        ( 4, MA, 0, 'ball',   'Nb',  4,    A,    NULL,       NULL,       NULL,          '{"nbRuns":"byes"}', 1),
        ( 5, MA, 0, 'retire', 'W',   NULL, NULL, NULL,       NULL,       'retired_out', jsonb_build_object('batter', A, 'reason', 'out'), 1),
        ( 6, MA, 1, 'ball',   'W',   0,    B,    C,          NULL,       'bowled',      '{}'::jsonb,         5),
        ( 7, MB, 0, 'ball',   'run', 6,    A,    NULL,       NULL,       NULL,          '{}'::jsonb,        67),
        ( 8, MB, 0, 'ball',   'W',   0,    A,    NULL,       B,          'run_out',     '{}'::jsonb,         1),
        ( 9, MB, 1, 'ball',   'Nb',  0,    B,    C,          NULL,       NULL,          '{}'::jsonb,         1),
        (10, MB, 1, 'ball',   'W',   0,    B,    C,          NULL,       'lbw',         '{}'::jsonb,         1),
        (11, MB, 1, 'ball',   'W',   0,    B,    C,          NULL,       'run_out',     '{}'::jsonb,         1),
        (12, MB, 1, 'ball',   'W',   0,    B,    C,          NULL,       'bowled',      '{}'::jsonb,        20),
        (13, MB, 2, 'ball',   'run', 6,    A,    NULL,       NULL,       NULL,          '{}'::jsonb,         9),
        (14, MC, 0, 'ball',   'W',   0,    B,    NULL,       A,          'run_out',     '{}'::jsonb,         1)
      ) AS e(ord, m, inn, kind, bt, v, striker, bowler, dismissed, dis, pl, times)
      CROSS JOIN LATERAL generate_series(1, e.times) AS g
     ORDER BY e.m = MC, e.m = MB, e.ord, g
  LOOP
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value,
                            striker_id, bowler_id, dismissed_id, dismissal, payload)
    VALUES (x.m, S, x.seq, 1, x.inn, U, 'verify-051', 'verify:051:' || x.m || ':' || x.seq, x.seq, now(),
            x.kind, x.bt, x.v, x.striker, x.bowler, x.dismissed, x.dis, x.pl);
  END LOOP;
  SELECT string_agg(format('%s:%s:%s:%s:%s',
                           CASE n.player_id WHEN A THEN 'A' WHEN B THEN 'B' ELSE 'C' END, n.kind,
                           CASE n.match_id WHEN MA THEN 'a' WHEN MB THEN 'b' ELSE 'c' END, n.innings, n.value),
                    ' ' ORDER BY n.ctid)
    INTO v FROM (SELECT ctid, * FROM milestone_notice WHERE player_id IN (A, B, C)) n;
  RETURN v;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/53 (section 31). A batter retired out who resumes with the opposing
-- captain's consent (Law 25.4.3). Two Hilton 2XI fixtures, written as the
-- owner when section 31 calls this and rolled back with everything else:
--   M1  "the db/53 fixture" (replay.test.mjs): A hits 4 and retires out; C
--       comes in, a dot, bowled; A back with consent (k6), hits 2.
--   M2  A retires out and a consented return names somebody else (C) — the
--       retirement stands; a typed-name batter retires out and returns with
--       consent — his retirement is taken back as a player's is.
-- _void_53() then undoes M1's return, as a scorer's undo would.
CREATE OR REPLACE FUNCTION _seed_53() RETURNS void AS $$
DECLARE
  HIL uuid := '11111111-1111-1111-1111-111111111111';
  A   uuid := 'aaaaaaaa-0000-0000-0000-00000000053a';
  B   uuid := 'aaaaaaaa-0000-0000-0000-00000000053b';
  C   uuid := 'aaaaaaaa-0000-0000-0000-00000000053c';
  D   uuid := 'aaaaaaaa-0000-0000-0000-00000000053d';
  M1  uuid := '77777777-0000-0000-0000-000000053001';
  M2  uuid := '77777777-0000-0000-0000-000000053002';
BEGIN
  INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
    (A, HIL, '2XI', 'V53 Opener',  53, 'batter', (current_date - interval '16 years')::date),
    (B, HIL, '2XI', 'V53 Partner', 54, 'batter', (current_date - interval '16 years')::date),
    (C, HIL, '2XI', 'V53 Three',   55, 'batter', (current_date - interval '16 years')::date),
    (D, HIL, '2XI', 'V53 Seamer',  56, 'bowler', (current_date - interval '16 years')::date);
  INSERT INTO match (id, school_id, team_code, opponent, starts_at, format, overs, status) VALUES
    (M1, HIL, '2XI', 'Verify 053 (consent)',       '2026-03-14 09:00:00+02', 'T20', 20, 'complete'),
    (M2, HIL, '2XI', 'Verify 053 (not his return)', '2026-03-21 09:00:00+02', 'T20', 20, 'complete');
  INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                          idempotency_key, client_seq, client_ts, kind, ball_type, value,
                          striker_id, non_striker_id, bowler_id, dismissal, payload)
  SELECT x.m, HIL, x.k, 1, 0, '88888888-0000-0000-0000-000000000006', 'verify-053',
         'verify:053:' || x.m || ':' || x.k, x.k, now(), x.kind, x.bt, x.v,
         x.striker, x.ns, x.bowler, x.dis, x.pl
    FROM (VALUES
      (M1, 1, 'ball',    'run', 4,    A,    B,          D,          NULL,          '{}'::jsonb),
      (M1, 2, 'retire',  'W',   NULL, NULL, NULL,       NULL,       'retired_out', jsonb_build_object('batter', A, 'reason', 'out')),
      (M1, 3, 'batters', NULL,  NULL, C,    NULL::uuid, NULL::uuid, NULL,          '{}'::jsonb),
      (M1, 4, 'ball',    'run', 0,    C,    B,          D,          NULL,          '{}'::jsonb),
      (M1, 5, 'ball',    'W',   0,    C,    B,          D,          'bowled',      '{}'::jsonb),
      (M1, 6, 'batters', NULL,  NULL, A,    NULL,       NULL,       NULL,          '{"captainConsent":true}'::jsonb),
      (M1, 7, 'ball',    'run', 2,    A,    B,          D,          NULL,          '{}'::jsonb),
      (M2, 1, 'ball',    'run', 1,    A,    B,          D,          NULL,          '{}'::jsonb),
      (M2, 2, 'retire',  'W',   NULL, NULL, NULL,       NULL,       'retired_out', jsonb_build_object('batter', A, 'reason', 'out')),
      (M2, 3, 'batters', NULL,  NULL, C,    NULL,       NULL,       NULL,          '{"captainConsent":true}'::jsonb),
      (M2, 4, 'retire',  'W',   NULL, NULL, NULL,       NULL,       'retired_out', '{"batter":"A Typed Boy","reason":"out"}'::jsonb),
      (M2, 5, 'batters', NULL,  NULL, NULL, NULL,       NULL,       NULL,          '{"nonStriker":"A Typed Boy","captainConsent":true}'::jsonb)
    ) AS x(m, k, kind, bt, v, striker, ns, bowler, dis, pl);
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION _void_53() RETURNS void AS $$
  INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                          idempotency_key, client_seq, client_ts, kind, payload)
  VALUES ('77777777-0000-0000-0000-000000053001', '11111111-1111-1111-1111-111111111111', 8, 1, 0,
          '88888888-0000-0000-0000-000000000006', 'verify-053',
          'verify:053:77777777-0000-0000-0000-000000053001:8', 8, now(), 'void',
          jsonb_build_object('target', 'verify:053:77777777-0000-0000-0000-000000053001:6'));
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/54 (SCRBRD-113). A school, a T20 match with a delivery fielded
-- illegally and a hat-trick across a delivery that does not count, and a T20
-- and a One-Day Declaration match each with a no-ball and then a bowled:
-- owner-written, rolled back with everything else, read through every reader
-- db/54 moved. The same fixture db/54's own proof builds; this one proves it
-- on every verify paste, after every file since.
CREATE OR REPLACE FUNCTION _laws_fixture_54() RETURNS text AS $$
DECLARE
  S uuid := gen_random_uuid(); U uuid := gen_random_uuid();
  MA uuid := gen_random_uuid(); MT uuid := gen_random_uuid(); MD uuid := gen_random_uuid();
  PX uuid := gen_random_uuid(); PY uuid := gen_random_uuid(); BA uuid := gen_random_uuid(); BC uuid := gen_random_uuid();
  v text;
BEGIN
  INSERT INTO school (id, code, name) VALUES (S, 'verify-054', 'Verify 054');
  INSERT INTO app_user (id, email, name, role, school_id) VALUES (U, 'verify54@example.invalid', 'V54 Scorer', 'coach', S);
  INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
    (PX, S, '1XI', 'V54 Opener',  1, 'batter', (current_date - interval '16 years')::date),
    (PY, S, '1XI', 'V54 Partner', 2, 'batter', (current_date - interval '16 years')::date),
    (BA, S, '1XI', 'V54 Seamer',  3, 'bowler', (current_date - interval '16 years')::date),
    (BC, S, '1XI', 'V54 Spinner', 4, 'bowler', (current_date - interval '16 years')::date);
  INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
    (MA, S, '1XI', 'Verify 054', now() - interval '7 days', 'cricket', 'T20', 20, 'complete'),
    (MT, S, '1XI', 'Verify 054 T20', now() - interval '6 days', 'cricket', 'T20', 20, 'complete'),
    (MD, S, '1XI', 'Verify 054 declaration', now() - interval '5 days', 'cricket', 'One-Day Declaration', 100, 'complete');
  INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                          idempotency_key, client_seq, client_ts, kind, ball_type, value,
                          striker_id, non_striker_id, bowler_id, dismissal, payload)
  SELECT x.m, S, x.k, 1, 0, U, 'verify-054', 'verify:054:' || x.m || ':' || x.k, x.k, now(), x.kind, x.bt, x.v,
         CASE WHEN x.kind = 'ball' THEN PX END, CASE WHEN x.kind = 'ball' THEN PY END,
         CASE x.who WHEN 'A' THEN BA WHEN 'C' THEN BC END, x.dis, x.pl
    FROM (VALUES
      (MA,  1, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
      (MA,  2, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
      (MA,  3, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
      (MA,  4, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
      (MA,  5, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
      (MA,  6, 'ball',    'run', 2,    'A', NULL,     '{"notInOver":"illegal_fielding"}'::jsonb),
      (MA,  7, 'penalty', NULL,  NULL, NULL, NULL,    '{"runs":5,"toBattingTeam":true,"reason":"illegal_fielding"}'::jsonb),
      (MA,  8, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
      (MA,  9, 'ball',    'W',   0,    'C', 'bowled', '{}'::jsonb),
      (MA, 10, 'ball',    'W',   0,    'C', 'bowled', '{}'::jsonb),
      (MA, 11, 'ball',    'run', 0,    'C', NULL,     '{"notInOver":"distracting_striker"}'::jsonb),
      (MA, 12, 'penalty', NULL,  NULL, NULL, NULL,    '{"runs":5,"toBattingTeam":true,"reason":"distracting_striker"}'::jsonb),
      (MA, 13, 'ball',    'W',   0,    'C', 'bowled', '{}'::jsonb),
      (MT,  1, 'ball',    'Nb',  0,    'A', NULL,     '{}'::jsonb),
      (MT,  2, 'ball',    'W',   0,    'A', 'bowled', '{}'::jsonb),
      (MD,  1, 'ball',    'Nb',  0,    'A', NULL,     '{}'::jsonb),
      (MD,  2, 'ball',    'W',   0,    'A', 'bowled', '{}'::jsonb)
    ) AS x(m, k, kind, bt, v, who, dis, pl);
  SELECT concat_ws(' ',
           (SELECT 'live' || row(l.runs, l.wickets, l.legal_balls)::text FROM match_live_score l WHERE l.match_id = MA AND l.innings = 0),
           (SELECT 'folded' || row(f.runs, f.wickets, f.legal_balls)::text FROM innings_score_as_folded(MA, 0::smallint) f),
           (SELECT 'overs(' || string_agg(format('%s:%s:%s/%s', CASE o.bowler_id WHEN BA THEN 'A' ELSE 'C' END,
                                                  o.over_no, o.legal_balls, o.deliveries), ' ' ORDER BY o.over_no, o.bowler_id = BC) || ')'
              FROM bowler_over o WHERE o.match_id = MA),
           (SELECT 'hattrick(' || coalesce(string_agg(CASE h.player_id WHEN BC THEN 'C' ELSE 'A' END || '@' || h.completed_at_seq, ','), '') || ')'
              FROM bowler_hat_trick h WHERE h.match_id = MA),
           (SELECT 'career(' || string_agg(l.legal_balls::text, ',' ORDER BY l.player_id = BC) || ')'
              FROM player_bowling_career l WHERE l.player_id IN (BA, BC)),
           (SELECT 't20(' || l.wickets || ',' || ball_on_free_hit(MT, 0::smallint, 2)::text || ')' FROM match_live_score l WHERE l.match_id = MT),
           (SELECT 'declaration(' || l.wickets || ',' || ball_on_free_hit(MD, 0::smallint, 2)::text || ','
                   || (SELECT f.wickets FROM innings_score_as_folded(MD, 0::smallint) f) || ','
                   || (SELECT b.wickets FROM bowler_innings_figures b WHERE b.match_id = MD AND b.player_id = BA) || ')'
              FROM match_live_score l WHERE l.match_id = MD))
    INTO v;
  RETURN v;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/56 (K4). Two scorers at Hilton, owner-written and rolled back with
-- everything else: R Pillay (the pupil, under eighteen, whose account already
-- holds `player` and `selfaccess`) is also given `scorer`; and an account for
-- S Naidoo (eighteen, seeded past majority on purpose) holds `player` and
-- `scorer`. The register must leave the first off and keep the second on.
CREATE OR REPLACE FUNCTION _seed_56() RETURNS void AS $$
DECLARE
  HIL uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  INSERT INTO role_assignment (person_id, role, school_id, team_code) VALUES
    ('88888888-0000-0000-0000-000000000009', 'scorer', HIL, NULL);
  INSERT INTO app_user (id, school_id, email, name, role, player_id) VALUES
    ('88888888-0000-0000-0000-000000000056', HIL, 'naidoo.v56@example.invalid', 'S Naidoo', 'player',
     'aaaaaaaa-0000-0000-0000-000000000003');
  INSERT INTO role_assignment (person_id, role, school_id, team_code) VALUES
    ('88888888-0000-0000-0000-000000000056', 'player', HIL, '1XI'),
    ('88888888-0000-0000-0000-000000000056', 'scorer', HIL, NULL);
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A police clearance recorded BEFORE db/56 to run five years, as db/08
-- allowed: written with db/56's age rule off for this one insert (the owner,
-- rolled back with everything else), so the section does not depend on which
-- seed a database carries. On the seeded scorer, who holds none.
CREATE OR REPLACE FUNCTION _legacy_56() RETURNS uuid AS $$
DECLARE v_id uuid;
BEGIN
  ALTER TABLE adult_clearance DISABLE TRIGGER adult_clearance_csa_age;
  INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on, note)
    VALUES ('88888888-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'police_clearance',
            'PCC-V56-LEGACY', sa_today() - 400, sa_today() - 400 + 1825, 'Verify 056: before CSA''s 24 months')
    RETURNING id INTO v_id;
  ALTER TABLE adult_clearance ENABLE TRIGGER adult_clearance_csa_age;
  RETURN v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Put a driver on a trip for the seeded 1XI v Michaelhouse fixture, as the
-- office would, and say what the driver guard answered: 'ok' or its refusal.
CREATE OR REPLACE FUNCTION _trip_56(p_driver uuid) RETURNS text AS $$
BEGIN
  INSERT INTO trip (match_id, school_id, driver_id, pickup)
    VALUES ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', p_driver, 'Verify 056');
  RETURN 'ok';
EXCEPTION WHEN check_violation THEN
  RETURN SQLERRM;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/57 (section 35). The safeguarding fixture, owner-written and rolled back
-- with everything else, so the section does not depend on which seed a
-- database carries: the KwaZulu-Natal union (found, or made), a school in
-- that province with no DSO and one teacher, a DSO at Westville, a second
-- DSO at Hilton, a DSO at the union (the PDSO), and two accounts with no
-- appointment yet — one the principal appoints below, one a support session
-- is simulated for. Returns the union.
CREATE OR REPLACE FUNCTION _seed_57() RETURNS uuid AS $$
DECLARE
  HIL     uuid := '11111111-1111-1111-1111-111111111111';
  WES     uuid := '22222222-2222-2222-2222-222222222222';
  V57     uuid := '57570000-0000-0000-0000-000000000001';
  v_union uuid;
BEGIN
  SELECT s.id INTO v_union FROM school s WHERE s.kind = 'union' AND lower(btrim(s.province)) = 'kwazulu-natal';
  IF v_union IS NULL THEN
    INSERT INTO school (id, code, name, kind, province)
      VALUES ('57570000-0000-0000-0000-0000000000a1', 'verify-057-union', 'Verify 057 KZN Cricket Union', 'union', 'KwaZulu-Natal')
      RETURNING id INTO v_union;
  END IF;
  INSERT INTO school (id, code, name, kind, province) VALUES
    (V57, 'verify-057', 'Verify 057 School', 'school', 'KwaZulu-Natal'),
    -- A province with no union: nobody above to hold a concern. One school
    -- there with no DSO, and one with two.
    ('57570000-0000-0000-0000-000000000002', 'verify-057b', 'Verify 057 Far School', 'school', 'Verify 057 Province'),
    ('57570000-0000-0000-0000-000000000003', 'verify-057c', 'Verify 057 Far School Two', 'school', 'Verify 057 Province');
  INSERT INTO app_user (id, school_id, email, name, role) VALUES
    ('88888888-0000-0000-0000-000000005701', HIL, 'dso1.v57@example.invalid', 'V57 DSO One', 'dso'),
    ('88888888-0000-0000-0000-000000005702', HIL, 'dso2.v57@example.invalid', 'V57 DSO Two', 'dso'),
    ('88888888-0000-0000-0000-000000005703', WES, 'dso.wes.v57@example.invalid', 'V57 DSO Westville', 'dso'),
    ('88888888-0000-0000-0000-000000005704', v_union, 'pdso.v57@example.invalid', 'V57 Provincial DSO', 'dso'),
    ('88888888-0000-0000-0000-000000005705', V57, 'teacher.v57@example.invalid', 'V57 Teacher', 'coach'),
    ('88888888-0000-0000-0000-000000005706', NULL, 'support.v57@example.invalid', 'V57 Support', 'platformadmin'),
    ('88888888-0000-0000-0000-000000005707', '57570000-0000-0000-0000-000000000002', 'teacher2.v57@example.invalid', 'V57 Far Teacher', 'coach'),
    ('88888888-0000-0000-0000-000000005708', '57570000-0000-0000-0000-000000000003', 'dso.far.v57@example.invalid', 'V57 Far DSO', 'dso'),
    ('88888888-0000-0000-0000-000000005709', '57570000-0000-0000-0000-000000000003', 'teacher3.v57@example.invalid', 'V57 Far Teacher Two', 'coach'),
    ('88888888-0000-0000-0000-000000005710', '57570000-0000-0000-0000-000000000003', 'dso2.far.v57@example.invalid', 'V57 Far DSO Two', 'dso');
  INSERT INTO role_assignment (person_id, role, school_id, team_code) VALUES
    ('88888888-0000-0000-0000-000000005702', 'dso', HIL, NULL),
    ('88888888-0000-0000-0000-000000005703', 'dso', WES, NULL),
    ('88888888-0000-0000-0000-000000005704', 'dso', v_union, NULL),
    ('88888888-0000-0000-0000-000000005705', 'coach', V57, '1XI'),
    ('88888888-0000-0000-0000-000000005707', 'coach', '57570000-0000-0000-0000-000000000002', '1XI'),
    ('88888888-0000-0000-0000-000000005708', 'dso', '57570000-0000-0000-0000-000000000003', NULL),
    ('88888888-0000-0000-0000-000000005709', 'coach', '57570000-0000-0000-0000-000000000003', '1XI'),
    ('88888888-0000-0000-0000-000000005710', 'dso', '57570000-0000-0000-0000-000000000003', NULL);
  RETURN v_union;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Where a concern went, by its reference: the holding institution's code,
-- what it is about, and whether it is unheld. The claim is about the row,
-- which no reader's policy could tell from a hidden one.
CREATE OR REPLACE FUNCTION _route_57(p_ref text) RETURNS text AS $$
  SELECT format('%s/%s/%s', t.code, c.about_kind, c.unheld::text)
    FROM safeguarding_concern c JOIN school t ON t.id = c.tenant_id WHERE c.reference = p_ref
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE FUNCTION _concern_57(p_ref text) RETURNS uuid AS $$
  SELECT c.id FROM safeguarding_concern c WHERE c.reference = p_ref
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The two clocks and a share's end need time to pass; the record's own
-- triggers refuse the edit, so they are stepped round for one statement.
CREATE OR REPLACE FUNCTION _age_concern_57(p_id uuid, p_hours integer) RETURNS void AS $$
BEGIN
  ALTER TABLE safeguarding_concern DISABLE TRIGGER safeguarding_concern_fixed;
  UPDATE safeguarding_concern SET raised_at = now() - make_interval(hours => p_hours) WHERE id = p_id;
  ALTER TABLE safeguarding_concern ENABLE TRIGGER safeguarding_concern_fixed;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE FUNCTION _expire_share_57(p_id uuid) RETURNS void AS $$
BEGIN
  ALTER TABLE safeguarding_share DISABLE TRIGGER safeguarding_share_append_only;
  UPDATE safeguarding_share SET shared_at = now() - interval '2 hours', open_until = now() - interval '1 minute' WHERE id = p_id;
  ALTER TABLE safeguarding_share ENABLE TRIGGER safeguarding_share_append_only;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- SG-9: a notice to one person, as the system writes one. 'ok' or 'refused'.
CREATE OR REPLACE FUNCTION _notice_57(p_person uuid, p_kind text) RETURNS text AS $$
BEGIN
  INSERT INTO notification (school_id, scope_level, kind, title, body, recipient_id)
    VALUES ('11111111-1111-1111-1111-111111111111', 'school', p_kind, 'Verify 057', 'Verify 057', p_person);
  RETURN 'ok';
EXCEPTION WHEN check_violation THEN
  RETURN 'refused';
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The owner's key with the capability row granted back, and taken away again:
-- the platform-wide cut, on its own.
CREATE OR REPLACE FUNCTION _owner_grant_57(p_on boolean) RETURNS void AS $$
BEGIN
  IF p_on THEN
    INSERT INTO role_capability (role, capability) VALUES ('superadmin', 'safeguarding.concern.read') ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM role_capability WHERE role = 'superadmin' AND capability LIKE 'safeguarding.%';
  END IF;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A support session as `dso`, which support_access_begin() refuses to issue:
-- written by the owner as that function would have, for an account with NO
-- platform-wide assignment, so the support cut is tested on its own. p_end
-- ends it again (the assignment stays live), which is the control.
CREATE OR REPLACE FUNCTION _support_dso_57(p_end boolean) RETURNS void AS $$
DECLARE v_asg uuid;
BEGIN
  IF p_end THEN
    UPDATE support_access SET ended_at = now(), ended_by = actor_id
     WHERE actor_id = '88888888-0000-0000-0000-000000005706' AND ended_at IS NULL;
    RETURN;
  END IF;
  INSERT INTO role_assignment (person_id, role, school_id, active, valid_from, expires_at)
    VALUES ('88888888-0000-0000-0000-000000005706', 'dso', '11111111-1111-1111-1111-111111111111', true, current_date, now() + interval '1 hour')
    RETURNING id INTO v_asg;
  INSERT INTO support_access (actor_id, school_id, role, reason, assignment_id, expires_at)
    VALUES ('88888888-0000-0000-0000-000000005706', '11111111-1111-1111-1111-111111111111', 'dso',
            'Verify 057: a session support may not be issued', v_asg, now() + interval '1 hour');
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/59 (section 37). Two fixtures for the signed-out read path, written as
-- the owner: Hilton 1XI v Westville 1XI (both on SCRBRD, live) and Hilton 1XI
-- v Kearsney College (not on SCRBRD, finished, its names typed). Five boys of
-- their own, so nothing earlier sections did to the seed's consents can
-- decide an answer here: one to consent, one to consent and mark, one with
-- nothing recorded, one fourteen or so playing up in the 1st XI (names off
-- for his own age group), and a Westville boy who consents while Westville
-- has not published. Each consenting boy has a verified guardian of his own.
-- Returns the ids, by name.
CREATE OR REPLACE FUNCTION _seed_59() RETURNS jsonb AS $$
DECLARE
  HIL uuid := '11111111-1111-1111-1111-111111111111';
  WES uuid := '22222222-2222-2222-2222-222222222222';
  SCORER uuid := '88888888-0000-0000-0000-000000000006';
  ids jsonb := '{}';
  r record;
  v_p uuid; v_u uuid; v_a uuid; m_on uuid; m_off uuid;
  s int := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('named',  'Andile Named',     HIL, 17, true),
      ('marked', 'Brandon Marked',   HIL, 17, true),
      ('none',   'Craig Nothing',    HIL, 16, false),
      ('up',     'Dumisani Playsup', HIL, 13, true),
      ('wes',    'Ethan Westville',  WES, 17, true)) AS v(k, nm, school, age, consent)
  LOOP
    INSERT INTO player (school_id, team_code, full_name, surname, squad_no, playing_role, born)
    VALUES (r.school, '1XI', r.nm, split_part(r.nm, ' ', 2), 90 + s, 'batter',
            current_date - make_interval(years => r.age) - interval '40 days')
    RETURNING id INTO v_p;
    s := s + 1;
    ids := ids || jsonb_build_object(r.k, v_p);
    IF r.consent THEN
      INSERT INTO app_user (school_id, email, name, role)
      VALUES (r.school, 'guardian59.' || r.k || '@example.invalid', 'Parent ' || r.k, 'guardian') RETURNING id INTO v_u;
      INSERT INTO role_assignment (person_id, role, school_id) VALUES (v_u, 'guardian', r.school) RETURNING id INTO v_a;
      INSERT INTO assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                      consent_state, consent_version, consent_at, created_by, valid_from)
      VALUES (v_a, v_p, 'parent', 'verified', v_u, now() - interval '30 days', 'granted', 'popia-2026-01',
              now() - interval '30 days', v_u, current_date - 30);
      ids := ids || jsonb_build_object('g_' || r.k, v_u);
    END IF;
  END LOOP;

  INSERT INTO match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
  VALUES (HIL, '1XI', WES, '1XI', 'Westville Boys'' High 1XI', now() - interval '1 hour', 'cricket', 'T10', 10, 'live')
  RETURNING id INTO m_on;
  INSERT INTO match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
  VALUES (HIL, '1XI', 'Kearsney College 1XI', now() - interval '3 days', 'cricket', 'T5', 5, 'complete')
  RETURNING id INTO m_off;
  ids := ids || jsonb_build_object('m_on', m_on, 'm_off', m_off);

  -- M_ON: the squads (four Hilton boys and a typed one; the Westville boy),
  -- two deliveries, a Law 41 suspension, a retirement "hurt".
  INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq,
                          client_ts, kind, payload, ball_type, value, striker_id, non_striker_id, bowler_id, seg, dismissal)
  VALUES
    (m_on, HIL, 1, 1, 0, SCORER, 'v59', 'v59-on-1', 1, now(), 'innings_start', jsonb_build_object(
       'battingTeam', '1XI', 'bowlingTeam', 'Westville Boys'' High 1XI', 'overs', 10, 'twelfthMan', 'Twelfth Fiftynine',
       'captureProfile', 'full',
       'squad', jsonb_build_array(jsonb_build_object('id', ids->>'named', 'name', 'Andile Named'),
                                  jsonb_build_object('id', ids->>'marked', 'name', 'Brandon Marked'),
                                  jsonb_build_object('id', ids->>'none', 'name', 'Craig Nothing'),
                                  jsonb_build_object('id', ids->>'up', 'name', 'Dumisani Playsup'),
                                  jsonb_build_object('id', 'Typed Fiftynine', 'name', 'Typed Fiftynine')),
       'bowlingSquad', jsonb_build_array(jsonb_build_object('id', ids->>'wes', 'name', 'Ethan Westville'))),
     NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    (m_on, HIL, 2, 1, 0, SCORER, 'v59', 'v59-on-2', 2, now(), 'batters', '{}', NULL, NULL,
       (ids->>'named')::uuid, (ids->>'marked')::uuid, NULL, NULL, NULL),
    (m_on, HIL, 3, 1, 0, SCORER, 'v59', 'v59-on-3', 3, now(), 'bowler', '{}', NULL, NULL, NULL, NULL, (ids->>'wes')::uuid, NULL, NULL),
    (m_on, HIL, 4, 1, 0, SCORER, 'v59', 'v59-on-4', 4, now(), 'ball', '{"shot": "drive"}', 'run', 4,
       (ids->>'named')::uuid, (ids->>'marked')::uuid, (ids->>'wes')::uuid, 9, NULL),
    (m_on, HIL, 5, 1, 0, SCORER, 'v59', 'v59-on-5', 5, now(), 'ball', jsonb_build_object('fielder', 'Typed Fiftynine'), 'W', 0,
       (ids->>'named')::uuid, (ids->>'marked')::uuid, (ids->>'wes')::uuid, NULL, 'caught'),
    (m_on, HIL, 6, 1, 0, SCORER, 'v59', 'v59-on-6', 6, now(), 'bowler_suspended',
       '{"reason": "dangerous_bowling", "scope": "innings"}', NULL, NULL, NULL, NULL, (ids->>'wes')::uuid, NULL, NULL),
    (m_on, HIL, 7, 1, 0, SCORER, 'v59', 'v59-on-7', 7, now(), 'retire',
       jsonb_build_object('batter', ids->>'marked', 'reason', 'hurt'), NULL, NULL, NULL, NULL, NULL, NULL, NULL);

  -- M_OFF: Hilton against typed names.
  INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq,
                          client_ts, kind, payload, ball_type, value, striker_id, bowler_id)
  VALUES
    (m_off, HIL, 1, 1, 0, SCORER, 'v59', 'v59-off-1', 1, now(), 'innings_start', jsonb_build_object(
       'battingTeam', '1XI', 'bowlingTeam', 'Kearsney College 1XI', 'overs', 5,
       'squad', jsonb_build_array(jsonb_build_object('id', ids->>'named', 'name', 'Andile Named')),
       'bowlingSquad', jsonb_build_array('Kearsney Bowlerone')), NULL, NULL, NULL, NULL),
    (m_off, HIL, 2, 1, 0, SCORER, 'v59', 'v59-off-2', 2, now(), 'ball', '{"bowler": "Kearsney Bowlerone"}', 'run', 1,
       (ids->>'named')::uuid, NULL);
  RETURN ids;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/60 (section 38). SCRBRD-110 phase 1: the nets band and the consent.
-- Written as the owner and rolled back. Four U15A boys of their own at
-- Hilton, so nothing earlier sections did to the seed's people can decide an
-- answer here: a bowler (16) with no health consent, a boy about to turn
-- eighteen, a boy for the constructed EWMA series and one more. Their own
-- coach, a coach of another side, a physio, a strength-and-conditioning
-- coach, a team-mate, an office, a platform account for support, the
-- bowler's own account (self-access), the turning boy's account, and two
-- parents: the turning boy's (her link is made in the section, through
-- guardian_link_establish(), so it ends where that function ends it: open
-- while he is at school, since db/62) and one of the fourth boy. A training
-- session today, a match the bowler bowled in two days ago (thirteen deliveries: twelve legal and a
-- wide), and a hamstring on his record with a physio's note.
-- workload_monitoring is NOT granted here: the section proves the switch first.
CREATE OR REPLACE FUNCTION _seed_60() RETURNS jsonb AS $$
DECLARE
  HIL    uuid := '11111111-1111-1111-1111-111111111111';
  SCORER uuid := '88888888-0000-0000-0000-000000000006';
  ids    jsonb := '{}';
  r      record;
  v_u    uuid; v_a uuid; v_p uuid; v_m uuid; v_t uuid;
  s      int := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('bowler',  'Bongani Bowlsixty',     16, 'F'),
      ('turning', 'Themba Turnseighteen',  17, 'F'),
      ('ewma',    'Ewan Ewmasixty',        15, 'F'),
      ('other',   'Oscar Othersixty',      15, 'M')) AS v(k, nm, age, style)
  LOOP
    INSERT INTO player (school_id, team_code, full_name, surname, squad_no, playing_role, born, bowling_style)
    VALUES (HIL, 'U15A', r.nm, split_part(r.nm, ' ', 2), 60 + s, 'bowler',
            (current_date - make_interval(years => r.age) - interval '40 days')::date, r.style)
    RETURNING id INTO v_p;
    s := s + 1;
    ids := ids || jsonb_build_object('p_' || r.k, v_p);
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
      ('coach',  'coach',         'U15A', false),
      ('coach2', 'coach',         'U16A', false),
      ('physio', 'medical',       NULL,   false),
      ('fit',    'fitness',       NULL,   false),
      ('mate',   'player',        'U15A', false),
      ('office', 'schooladmin',   NULL,   false),
      ('plat',   'platformadmin', NULL,   true),
      ('mum',    'guardian',      NULL,   false),
      ('mum2',   'guardian',      NULL,   false),
      ('boy',    'selfaccess',    NULL,   false),
      ('turner', 'selfaccess',    NULL,   false)) AS v(k, role, team, platform)
  LOOP
    INSERT INTO app_user (school_id, email, name, role)
    VALUES (CASE WHEN r.platform THEN NULL ELSE HIL END, 'v60.' || r.k || '@example.invalid', 'V60 ' || r.k, r.role)
    RETURNING id INTO v_u;
    -- The turning boy's mother is appointed by guardian_link_establish() in
    -- the section; the rest hold their role now.
    IF r.k <> 'mum' THEN
      INSERT INTO role_assignment (person_id, role, school_id, team_code)
      VALUES (v_u, r.role, CASE WHEN r.platform THEN NULL ELSE HIL END, r.team)
      RETURNING id INTO v_a;
      ids := ids || jsonb_build_object('a_' || r.k, v_a);
    END IF;
    ids := ids || jsonb_build_object('u_' || r.k, v_u);
  END LOOP;
  -- The bowler's own account plays in the side as well, as R Pillay's does.
  INSERT INTO role_assignment (person_id, role, school_id, team_code)
  VALUES ((ids->>'u_boy')::uuid, 'player', HIL, 'U15A');

  -- Who each subject-scoped assignment is about. Verified by the office, the
  -- terms agreed; a parent's link ends at his majority, as
  -- guardian_link_establish() writes it today.
  INSERT INTO assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                  consent_state, consent_version, consent_at, created_by, valid_from, valid_until)
  VALUES
    ((ids->>'a_boy')::uuid,    (ids->>'p_bowler')::uuid,  'self',   'verified', (ids->>'u_office')::uuid, now(), 'granted',
     'popia-2026-01', now(), (ids->>'u_office')::uuid, current_date - 30, NULL),
    ((ids->>'a_turner')::uuid, (ids->>'p_turning')::uuid, 'self',   'verified', (ids->>'u_office')::uuid, now(), 'granted',
     'popia-2026-01', now(), (ids->>'u_office')::uuid, current_date - 30, NULL),
    ((ids->>'a_mum2')::uuid,   (ids->>'p_other')::uuid,   'parent', 'verified', (ids->>'u_office')::uuid, now(), 'granted',
     'popia-2026-01', now(), (ids->>'u_office')::uuid, current_date - 30,
     majority_on((SELECT born FROM player WHERE id = (ids->>'p_other')::uuid)));

  -- Today's nets, at six in the morning.
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, session_type)
  VALUES (HIL, 'U15A', 'Seamers at the nets', (sa_today()::timestamp + interval '6 hours') AT TIME ZONE 'Africa/Johannesburg',
          60, 'bowling')
  RETURNING id INTO v_t;
  ids := ids || jsonb_build_object('ts', v_t);

  -- Two days ago: a match the log scored, and two overs from the bowler, with
  -- a wide in the first.
  INSERT INTO match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
  VALUES (HIL, 'U15A', 'Sixty College U15A', ((sa_today() - 2)::timestamp + interval '10 hours') AT TIME ZONE 'Africa/Johannesburg',
          'cricket', 'T20', 20, 'complete')
  RETURNING id INTO v_m;
  ids := ids || jsonb_build_object('m', v_m, 'm_on', sa_today() - 2);
  FOR s IN 1..13 LOOP
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, ball_type, value, bowler_id, striker_id)
    VALUES (v_m, HIL, s, 0, 0, SCORER, 'v60', 'v60-' || s, s, now(), 'ball',
            CASE WHEN s = 3 THEN 'Wd' ELSE 'run' END, CASE WHEN s = 3 THEN 1 ELSE 0 END,
            (ids->>'p_bowler')::uuid, (ids->>'p_other')::uuid);
  END LOOP;

  -- A hamstring, with the physio's note on it.
  INSERT INTO injury (school_id, player_id, injury_type, severity, date_injured, phase, restricted, notes, physio)
  VALUES (HIL, (ids->>'p_bowler')::uuid, 'Hamstring strain', 'minor', current_date - 20, 'cleared', false,
          'Grade 1; eccentric programme, review in two weeks', 'V60 physio');
  RETURN ids;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The module switch for Hilton, as the platform would grant it.
CREATE OR REPLACE FUNCTION _v60_grant(p_on boolean) RETURNS void AS $$
  INSERT INTO feature_grant (key, school_id, granted, note)
  VALUES ('workload_monitoring', '11111111-1111-1111-1111-111111111111', p_on, 'verify db/60')
  ON CONFLICT (key, school_id) DO UPDATE SET granted = excluded.granted;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- health_consent_live() and health_retention_due() are the database's own in
-- this phase (not the application's), so the section asks through these.
CREATE OR REPLACE FUNCTION _v60_live(p uuid) RETURNS boolean AS $$ SELECT health_consent_live(p) $$
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE FUNCTION _v60_due(p uuid) RETURNS date AS $$ SELECT health_retention_due(p) $$
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- load_day is not the application's either (db/60): one boy's day, as its owner reads it.
CREATE OR REPLACE FUNCTION _v60_day(p uuid, d date) RETURNS SETOF load_day AS $$
  SELECT * FROM load_day WHERE player_id = p AND on_date = d $$
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Wind a boy's whole history back so that TODAY is his eighteenth birthday:
-- his date of birth, his parents' links (dated as guardian_link_establish()
-- dated them) and every consent recorded about him move back together, so
-- a "yes" given at seventeen is still a yes given while he was a child.
CREATE OR REPLACE FUNCTION _v60_turn_eighteen(p uuid) RETURNS void AS $$
DECLARE d int;
BEGIN
  SELECT majority_on(born) - current_date INTO d FROM player WHERE id = p;
  UPDATE player SET born = born - d WHERE id = p;
  UPDATE assignment_subject SET valid_from = valid_from - d, valid_until = valid_until - d,
                                verified_at = verified_at - make_interval(days => d), consent_at = consent_at - make_interval(days => d)
   WHERE player_id = p AND relationship IS DISTINCT FROM 'self';
  UPDATE health_monitoring_consent SET given_on = given_on - d, form_date = form_date - d,
                                       recorded_at = recorded_at - make_interval(days => d)
   WHERE player_id = p;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- What phase 0 (db/62) does to an enrolled pupil's parent: her link stays
-- open. Section 38 held it open by hand before db/62 landed; it now asks
-- whether db/62 left it so.
CREATE OR REPLACE FUNCTION _v38_link_open(p uuid, mum uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM assignment_subject s JOIN role_assignment a ON a.id = s.assignment_id
                  WHERE s.player_id = p AND a.person_id = mum AND a.role = 'guardian' AND s.valid_until IS NULL)
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- He leaves the school system (his last school membership closes today), and comes back.
CREATE OR REPLACE FUNCTION _v60_leave(p uuid) RETURNS void AS $$
  UPDATE team_membership SET left_on = current_date WHERE player_id = p AND left_on IS NULL;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE FUNCTION _v60_rejoin(p uuid) RETURNS void AS $$
  INSERT INTO team_membership (player_id, school_id, sport, team_code, joined_on, reason)
  SELECT id, school_id, 'cricket', team_code, current_date, 'moved' FROM player WHERE id = p;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The constructed series, recorded by his coach on the days named (days
-- ago, band), through the table's own stamp.
CREATE OR REPLACE FUNCTION _v60_series(p uuid, coach uuid) RETURNS void AS $$
DECLARE r record;
BEGIN
  PERFORM set_config('app.user_id', coach::text, true);
  FOR r IN SELECT * FROM (VALUES (40, '24_36'), (27, '24_36'), (20, '24_36'), (13, '24_36'),
                                 (6, '36plus'), (3, '36plus'), (1, '36plus'), (0, '12_24')) AS v(ago, band) LOOP
    INSERT INTO load_entry (player_id, kind, on_date, band, rpe, minutes)
    VALUES (p, 'nets', sa_today() - r.ago, r.band, 6, 40);
  END LOOP;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The same EWMA the other way: the recursion the design describes, seeded at
-- zero ninety days back, one day at a time — against load_summary()'s closed
-- form.
CREATE OR REPLACE FUNCTION _v60_ewma(p uuid, OUT acute numeric, OUT chronic numeric) AS $$
  WITH RECURSIVE days AS (
    SELECT g AS k, (sa_today() - 89 + g) AS d FROM generate_series(0, 89) g),
  series AS (
    SELECT days.k, coalesce((SELECT sum(l.units) FROM load_day l
                              WHERE l.player_id = p AND l.sport_code = 'cricket' AND l.on_date = days.d), 0)::numeric AS u
      FROM days),
  ew AS (
    SELECT s.k, 0.25 * s.u AS a, (2.0 / 29) * s.u AS c FROM series s WHERE s.k = 0
    UNION ALL
    SELECT s.k, 0.25 * s.u + 0.75 * ew.a, (2.0 / 29) * s.u + (27.0 / 29) * ew.c
      FROM ew JOIN series s ON s.k = ew.k + 1)
  SELECT a, c FROM ew WHERE k = 89
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/61 (section 39). Playing conditions per competition, phase 1
-- (SCRBRD-114). A festival Hilton organises (Hilton 1XI entered), and five
-- fixtures in it or beside it, dated from the South African today: a T20 on
-- day +3, a One-Day Declaration on day +7, a T20 on day +8, a Two-Day
-- friendly on day +3, and a T20 friendly scored "before db/61" — a no-ball
-- then a bowled, and no document — for the seed-wide comparison to be able
-- to go red. Returns the ids, by name.
CREATE OR REPLACE FUNCTION _seed_61() RETURNS jsonb AS $$
DECLARE
  HIL uuid := '11111111-1111-1111-1111-111111111111';
  SCORER uuid := '88888888-0000-0000-0000-000000000006';
  c uuid; ids jsonb := '{}'; m uuid; r record;
BEGIN
  INSERT INTO competition (school_id, name, comp_type, format, age_group, level)
  VALUES (HIL, 'Verify 061 Festival', 'festival', 'T20', '1XI', 'school') RETURNING id INTO c;
  INSERT INTO competition_entrant (competition_id, school_id, team_code, display_name) VALUES (c, HIL, '1XI', 'Hilton 1st XI');
  ids := ids || jsonb_build_object('c', c);
  FOR r IN SELECT * FROM (VALUES
      ('t20',  c,    3, 'T20', 20::smallint),
      ('decl', c,    7, 'One-Day Declaration', 100::smallint),
      ('late', c,    8, 'T20', 20::smallint),
      ('fr',   NULL, 3, 'Two-Day', 80::smallint),
      ('old',  NULL, -9, 'T20', 20::smallint)) AS v(k, comp, days, fmt, ov)
  LOOP
    INSERT INTO match (school_id, team_code, opponent, starts_at, sport, format, overs, status, competition_id)
    VALUES (HIL, '1XI', 'Verify 061 ' || r.k, ((sa_today() + r.days)::timestamp + interval '10 hours') AT TIME ZONE 'Africa/Johannesburg',
            'cricket', r.fmt, r.ov, CASE WHEN r.k = 'old' THEN 'complete' ELSE 'scheduled' END, r.comp)
    RETURNING id INTO m;
    ids := ids || jsonb_build_object(r.k, m);
  END LOOP;
  PERFORM _log_61((ids->>'old')::uuid);
  RETURN ids;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A no-ball, then the striker bowled, written as the owner (as db/54's proof
-- writes): the two deliveries every free-hit question turns on.
CREATE OR REPLACE FUNCTION _log_61(p_match uuid) RETURNS void AS $$
  INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq,
                          client_ts, kind, ball_type, value, striker_id, non_striker_id, bowler_id, dismissal, payload)
  SELECT p_match, '11111111-1111-1111-1111-111111111111', x.k, 1, 0, '88888888-0000-0000-0000-000000000006', 'verify-061',
         'v61:' || p_match || ':' || x.k, x.k, now(), 'ball', x.bt, 0,
         'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
         'aaaaaaaa-0000-0000-0000-000000000003', x.dis, '{}'::jsonb
    FROM (VALUES (1, 'Nb', NULL), (2, 'W', 'bowled')) AS x(k, bt, dis)
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- An owner's statement, for the claims that are about the schema itself (a
-- CHECK, a trigger) and not about who may reach it: the SQLSTATE, or 'ok'.
CREATE OR REPLACE FUNCTION _owner_61(p_sql text) RETURNS text AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN others THEN RETURN SQLSTATE;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Every figure the SQL readers keep about every scored innings, as one
-- string: the live score, the handover's count, the balls each bowler's
-- overs hold, and each delivery's free hit. Read as the owner: the claim is
-- about the whole log.
CREATE OR REPLACE FUNCTION _figures_61() RETURNS text AS $$
  SELECT string_agg(format('%s/%s %s %s %s %s', l.match_id, l.innings, row(l.runs, l.wickets, l.legal_balls)::text,
                           (SELECT row(f.runs, f.wickets, f.legal_balls)::text FROM innings_score_as_folded(l.match_id, l.innings::smallint) f),
                           (SELECT sum(o.legal_balls) FROM bowler_over o WHERE o.match_id = l.match_id AND o.innings = l.innings),
                           (SELECT count(*) FILTER (WHERE ball_on_free_hit(b.match_id, b.innings, b.seq)) FROM ball_event b
                             WHERE b.match_id = l.match_id AND b.innings = l.innings)), ' ' ORDER BY l.match_id, l.innings)
    FROM match_live_score l
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Give every scored match with no document one (p_mode 'resolved': what the
-- resolver would have fixed; 'flipped': the other free hit), or take those
-- rows away again ('none'). The rows it writes are marked (fixed_by NULL,
-- sources {"verify": 61}) so 'none' removes exactly them.
CREATE OR REPLACE FUNCTION _seed_rows_61(p_mode text) RETURNS integer AS $$
DECLARE n integer := 0; r record; d jsonb;
BEGIN
  DELETE FROM match_conditions WHERE sources = '{"verify": 61}'::jsonb;
  IF p_mode = 'none' THEN RETURN 0; END IF;
  FOR r IN SELECT m.id, m.format FROM match m
            WHERE EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = m.id)
              AND NOT EXISTS (SELECT 1 FROM match_conditions c WHERE c.match_id = m.id) LOOP
    SELECT c.doc INTO d FROM match_conditions_compute(r.id) c;
    IF p_mode = 'flipped' THEN
      d := jsonb_set(d, '{play,format.free_hit}', to_jsonb(NOT free_hits_apply(r.format)));
    END IF;
    INSERT INTO match_conditions (match_id, doc, sources, doc_hash) VALUES (r.id, d, '{"verify": 61}', '');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/62 (section 40). SCRBRD-110 phase 0: the guardian link past eighteen,
-- and SCRBRD-083 §6.3 (option C) on top of it. Written as the owner and
-- rolled back. Hilton boys of their own, so nothing earlier sections did to
-- the seed's people can decide an answer here:
--   pupil  17, 1XI — two parents; turns eighteen at school
--   adult  17, 1XI — turns eighteen at school, then leaves
--   minor  16, 1XI — leaves as a minor, comes back, leaves, turns eighteen
--   late   17, 1XI — out of the school system when his link is made, then enrols
--   grown  18 and four months, 1XI — no link, and none can be made
--   club   17, at a CLUB (kind 'club') — not the school system
--   rpupil, rclub, radult — the same three cases through the other door: a
--          parent's role_request, granted by the office (decide_role_request())
-- A club, its office, Hilton's office, the pupil's own account, and one
-- parent each (two for the pupil). Links are made in the section, through
-- guardian_link_establish() and guardian_link_verify(), as the offices.
CREATE OR REPLACE FUNCTION _seed_62() RETURNS jsonb AS $$
DECLARE
  HIL  uuid := '11111111-1111-1111-1111-111111111111';
  CLUB uuid;
  ids  jsonb := '{}';
  r    record;
  v_u  uuid; v_a uuid; v_p uuid;
  s    int := 0;
BEGIN
  INSERT INTO school (code, name, kind, province) VALUES ('V62C', 'Verify Sixty-Two Cricket Club', 'club', 'KwaZulu-Natal')
  RETURNING id INTO CLUB;
  ids := ids || jsonb_build_object('club', CLUB);

  FOR r IN SELECT * FROM (VALUES
      ('pupil', 'Pieter Pupilsixtytwo', 17, 40, 'hil'),
      ('adult', 'Andile Adultsixtytwo', 17, 60, 'hil'),
      ('minor', 'Mike Minorsixtytwo',   16, 40, 'hil'),
      ('late',  'Liam Latesixtytwo',    17, 40, 'hil'),
      ('grown', 'Gary Grownsixtytwo',   18, 120, 'hil'),
      ('club',  'Craig Clubsixtytwo',   17, 40, 'club'),
      ('rpupil', 'Ryan Requestpupil',   17, 40, 'hil'),
      ('rclub',  'Rory Requestclub',    17, 40, 'club'),
      ('radult', 'Riaan Requestadult',  18, 120, 'hil')) AS v(k, nm, age, days, at)
  LOOP
    INSERT INTO player (school_id, team_code, full_name, surname, squad_no, playing_role, born)
    VALUES (CASE r.at WHEN 'hil' THEN HIL ELSE CLUB END, '1XI', r.nm, split_part(r.nm, ' ', 2), 620 + s, 'batter',
            (current_date - make_interval(years => r.age) - make_interval(days => r.days))::date)
    RETURNING id INTO v_p;
    s := s + 1;
    ids := ids || jsonb_build_object('p_' || r.k, v_p);
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
      ('office',  'schooladmin', 'hil',  'schooladmin'),
      ('coffice', 'schooladmin', 'club', 'schooladmin'),
      ('mum',     NULL,          'hil',  'guardian'),
      ('dad',     NULL,          'hil',  'guardian'),
      ('amum',    NULL,          'hil',  'guardian'),
      ('mmum',    NULL,          'hil',  'guardian'),
      ('lmum',    NULL,          'hil',  'guardian'),
      ('gmum',    NULL,          'hil',  'guardian'),
      ('cmum',    NULL,          'club', 'guardian'),
      ('rmum',    NULL,          'hil',  'guardian'),
      ('rcmum',   NULL,          'club', 'guardian'),
      ('ramum',   NULL,          'hil',  'guardian'),
      ('self',    'selfaccess',  'hil',  'player')) AS v(k, role, at, urole)
  LOOP
    INSERT INTO app_user (school_id, email, name, role)
    VALUES (CASE r.at WHEN 'hil' THEN HIL ELSE CLUB END, 'v62.' || r.k || '@example.invalid', 'V62 ' || r.k, r.urole)
    RETURNING id INTO v_u;
    ids := ids || jsonb_build_object('u_' || r.k, v_u);
    IF r.role IS NOT NULL THEN
      INSERT INTO role_assignment (person_id, role, school_id)
      VALUES (v_u, r.role, CASE r.at WHEN 'hil' THEN HIL ELSE CLUB END)
      RETURNING id INTO v_a;
      ids := ids || jsonb_build_object('a_' || r.k, v_a);
    END IF;
  END LOOP;
  -- The pupil's own account: his verified link to himself.
  INSERT INTO assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                  consent_state, consent_version, consent_at, created_by, valid_from)
  VALUES ((ids->>'a_self')::uuid, (ids->>'p_pupil')::uuid, 'self', 'verified', (ids->>'u_office')::uuid, now(),
          'granted', 'popia-2026-01', now(), (ids->>'u_office')::uuid, current_date - 30);
  -- Three parents who asked through onboarding, each naming the child: the
  -- office will grant them through decide_role_request(), the other door.
  FOR r IN SELECT * FROM (VALUES ('rpupil', 'rmum', 'hil'), ('rclub', 'rcmum', 'club'), ('radult', 'ramum', 'hil')) AS v(p, u, at) LOOP
    INSERT INTO role_request (person_id, role, school_id, player_id, note)
    VALUES ((ids->>('u_' || r.u))::uuid, 'guardian', CASE r.at WHEN 'hil' THEN HIL ELSE CLUB END,
            (ids->>('p_' || r.p))::uuid, 'verify db/62: I am his parent')
    RETURNING id INTO v_a;
    ids := ids || jsonb_build_object('r_' || r.p, v_a);
  END LOOP;
  RETURN ids;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/62's two triggers are deferred to the end of the transaction, and this
-- file ends in ROLLBACK, so section 40 fires them where the claim needs them
-- — on exactly the statements the application's transaction would commit.
CREATE OR REPLACE FUNCTION _v62_fire() RETURNS void AS $$
BEGIN
  SET CONSTRAINTS team_membership_closes_guardian_links, team_membership_opens_guardian_links IMMEDIATE;
  SET CONSTRAINTS team_membership_closes_guardian_links, team_membership_opens_guardian_links DEFERRED;
END $$ LANGUAGE plpgsql;

-- Wind a boy's whole history back d days: his date of birth, his parents'
-- links, both consents recorded about him and his memberships' start move
-- back together — so a "yes" given at seventeen is still a yes given while
-- he was a child, and a link that was to end on his birthday ends d days
-- sooner. A closed membership's left_on is not moved: the day he left is the
-- day it happened.
CREATE OR REPLACE FUNCTION _v62_older(p uuid, d int) RETURNS void AS $$
BEGIN
  UPDATE player SET born = born - d WHERE id = p;
  UPDATE assignment_subject SET valid_from = valid_from - d, valid_until = valid_until - d,
                                verified_at = verified_at - make_interval(days => d), consent_at = consent_at - make_interval(days => d)
   WHERE player_id = p AND relationship IS DISTINCT FROM 'self';
  UPDATE health_monitoring_consent SET given_on = given_on - d, ended_on = ended_on - d, form_date = form_date - d,
                                       recorded_at = recorded_at - make_interval(days => d), ended_at = ended_at - make_interval(days => d)
   WHERE player_id = p;
  UPDATE public_name_consent SET given_on = given_on - d, ended_on = ended_on - d, form_date = form_date - d,
                                 recorded_at = recorded_at - make_interval(days => d), ended_at = ended_at - make_interval(days => d)
   WHERE player_id = p;
  UPDATE team_membership SET joined_on = joined_on - d WHERE player_id = p;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ...by as many days as make TODAY his eighteenth birthday.
CREATE OR REPLACE FUNCTION _v62_turn_eighteen(p uuid) RETURNS void AS $$
  SELECT _v62_older(p, (SELECT majority_on(born) - current_date FROM player WHERE id = p))
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A move between sides, as the move route makes one: player.team_code, and
-- db/08's history trigger closes the old membership and opens the new.
CREATE OR REPLACE FUNCTION _v62_move(p uuid, team text) RETURNS void AS $$
  UPDATE player SET team_code = team WHERE id = p;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- One guardian's link to one child, as the owner reads it: ended or open, and to when.
CREATE OR REPLACE FUNCTION _v62_link(p uuid, mum uuid, OUT open boolean, OUT until date) AS $$
  SELECT s.valid_until IS NULL, s.valid_until FROM assignment_subject s
    JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
   WHERE s.player_id = p AND a.person_id = mum
   ORDER BY s.created_at DESC, s.id LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

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
  -- The falsifying principal for the notification capability gate. It is a
  -- real spectator: the user seeded as spectator@example.invalid holds a
  -- PLAYER assignment. (The player bundle held medical.status.read until
  -- db/55; it holds no medical tier now, but a spectator is still the plainer
  -- principal for "news.read and nothing medical".)
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

  -- SCRBRD-034: the duty, its fixture, its scorer, and the assignment linked.
  U_DUTY    uuid := '88888888-0000-0000-0000-00000000034a';
  M_DUTY    uuid := '77777777-0000-0000-0000-00000000034a';
  D_DUTY    uuid := '0d000000-0000-0000-0000-00000000034a';
  D_DUTY2   uuid := '0d000000-0000-0000-0000-00000000034b';  -- same fixture, never linked
  A_DUTY    uuid;
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

  -- ── 3b. A pupil reads no team-mate's injury at all (K3, db/55) ────
  -- It used to be "who is out, not what is wrong": the player bundle held
  -- medical.status.read, so a pupil read every team-mate's date_injured,
  -- rtw_date and restricted. CSA p52: a child's medical needs are "not in
  -- general view to other ... children". db/55 withdrew it; the row itself is
  -- now out of his reach, at every tier. (Section 33 has the rest of K3.)
  PERFORM _as(U_PUPIL);
  SELECT count(*) INTO n FROM injury_masked;
  PERFORM _assert(n = 0, 'a pupil reads a team-mate''s injury row — that he is out, and until when (K3)');
  SELECT count(*) INTO n FROM injury;
  PERFORM _assert(n = 0, 'a pupil reads the injury table under his player assignment (K3)');

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

  -- Nor that the other player is out at all. Their separate `player`
  -- assignment reaches the side, and since db/55 (K3, CSA p52) it carries no
  -- medical tier, so the row itself is out of reach: the two assignments do
  -- different jobs at different scopes, in the same session, and only the
  -- one naming him reads an injury.
  SELECT count(*) INTO n FROM injury_masked WHERE player_id = P_OTHER;
  PERFORM _assert(n = 0, 'a player sees that a team mate is unavailable (K3)');

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
  --
  -- Asked as "no row but their own child's", not "exactly one row": the child
  -- may be on more than one team sheet (a database that has run the contacts
  -- walk has him on several), and every one of those is rightly the
  -- guardian's to see. Counting rows made the check depend on how many
  -- fixtures the boy was picked for; counting OTHER boys' rows is the leak.
  PERFORM _as(U_PARENT);
  SELECT count(*) INTO n FROM match_squad WHERE player_id <> P_INJURED;
  PERFORM _assert(n = 0, 'guardian sees another child on the team sheet');
  SELECT count(*) INTO n FROM match_squad WHERE player_id = P_INJURED;
  PERFORM _assert(n >= 1, 'guardian cannot see their own child on the team sheet');

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

  -- And NOT a team mate, at either tier. The player bundle holds no medical
  -- tier since db/55 (K3), so neither the nature-tier alert nor the
  -- status-tier availability notice reaches another pupil. The tier decides
  -- the audience.
  PERFORM _as(U_PUPIL);
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND required_capability = 'medical.nature.read';
  PERFORM _assert(n = 0, 'a team mate was alerted to what is wrong with a player');
  SELECT count(*) INTO n FROM notification
   WHERE kind = 'injury' AND required_capability = 'medical.status.read';
  PERFORM _assert(n = 0, 'a team mate was told the player is unavailable (K3)');

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
  -- A held event carries its fingerprint (db/36); the write path computes it.
  INSERT INTO ball_event_quarantine (match_id, school_id, submitted_epoch, current_epoch, scorer_user_id, device_id, idempotency_key, body, fingerprint)
  SELECT m.id, m.school_id, 9, 1, U_COACH, 'verify-device', 'verify:quarantine:own', '{}'::jsonb, 'verify-fingerprint'
    FROM match m WHERE m.school_id = '11111111-1111-1111-1111-111111111111' AND m.team_code = '1XI' LIMIT 1
  ON CONFLICT (idempotency_key) DO NOTHING;
  SELECT count(*) INTO n FROM ball_event_quarantine WHERE idempotency_key = 'verify:quarantine:own';
  PERFORM _assert(n = 1, 'a coach cannot quarantine (and then see) their own stale ball');

  -- ── db/36: an idempotency key names ONE event ──────────────────
  -- The write path answers "duplicate" only when the stored event's
  -- fingerprint matches the one it is holding, and "conflict" otherwise. That
  -- is only as good as the fingerprint: present on every row, stamped by the
  -- database for EVERY writer (the seed below wrote its balls with plain SQL,
  -- as scoring_amendment_decide and quarantine_resolve do), and blind to how
  -- an event arrived but not to what it says.
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = 'ball_event'::regclass AND attname = 'fingerprint' AND attnotnull;
  PERFORM _assert(n = 1, 'ball_event.fingerprint is nullable: an event can be stored that no retry can be compared with');
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'ball_event'::regclass AND tgname = 'zz_ball_event_fingerprint' AND tgenabled = 'O';
  PERFORM _assert(n = 1, 'the trigger that stamps ball_event.fingerprint is missing or disabled');
  -- BEFORE triggers fire in name order; one after it could change the row
  -- the fingerprint was taken of. (tgtype: 2 = BEFORE, 4 = INSERT.)
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'ball_event'::regclass AND NOT tgisinternal
     AND (tgtype & 2) = 2 AND (tgtype & 4) = 4 AND tgname > 'zz_ball_event_fingerprint';
  PERFORM _assert(n = 0, 'a BEFORE INSERT trigger on ball_event runs after the fingerprint is taken');
  SELECT count(*) INTO n FROM ball_event;
  PERFORM _assert(n > 0, 'no ball_event rows are visible here to check fingerprints against');
  SELECT count(*) INTO n FROM ball_event b WHERE b.fingerprint IS DISTINCT FROM ball_event_fingerprint(b);
  PERFORM _assert(n = 0, 'a stored event carries a fingerprint that is not the canonical one');
  -- Blind to provenance: a retry under a new epoch, device, seq or clock is
  -- the same event, or every honest retry after a claim is a conflict.
  SELECT count(*) INTO n FROM ball_event b
   WHERE ball_event_fingerprint(b) <> ball_event_fingerprint(jsonb_populate_record(b, jsonb_build_object(
           'seq', b.seq + 1000, 'epoch', b.epoch + 1, 'device_id', 'another-device', 'client_seq', 0,
           'client_ts', now(), 'server_ts', now(), 'recovered', NOT b.recovered, 'id', b.id + 100000)));
  PERFORM _assert(n = 0, 'the fingerprint changes with how an event arrived — an honest retry would be refused');
  -- ...and not blind to content: one more run is a different event.
  SELECT count(*) INTO n FROM ball_event b
   WHERE ball_event_fingerprint(b) = ball_event_fingerprint(jsonb_populate_record(b, jsonb_build_object(
           'value', coalesce(b.value, 0) + 1)));
  PERFORM _assert(n = 0, 'two events that differ by a run share a fingerprint — a changed ball would pass as a retry');
  -- A NEW held event must carry one; only rows held before db/36 may not.
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'ball_event_quarantine'::regclass
     AND tgname = 'ball_event_quarantine_fingerprint_required' AND tgenabled = 'O';
  PERFORM _assert(n = 1, 'the trigger requiring a held event''s fingerprint is missing or disabled');
  BEGIN
    INSERT INTO ball_event_quarantine (match_id, school_id, submitted_epoch, current_epoch, scorer_user_id, device_id, idempotency_key, body)
    SELECT m.id, m.school_id, 9, 1, U_COACH, 'verify-device', 'verify:quarantine:nofp', '{}'::jsonb
      FROM match m WHERE m.school_id = '11111111-1111-1111-1111-111111111111' AND m.team_code = '1XI' LIMIT 1;
    PERFORM _assert(false, 'a new held event was stored with no fingerprint');
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;

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

  -- Not one guardian link survives the seed open-ended without cause. Since
  -- db/62 (SCRBRD-110 §7.4) a link is open while the child is at school —
  -- the seed's pupils' links are, and the second assertion says so — and
  -- ends at the later of his majority and his leaving. So the claim is: an
  -- open link is a minor's or a pupil's, never an adult's out of school.
  -- Asked of the whole table rather than of one reader's view, because "I
  -- cannot see one" and "there is not one" are different claims and only
  -- the second is the point.
  PERFORM _assert(_count_open_guardian_links() = 0,
    'a guardian link is open-ended for an adult who is not at school');
  PERFORM _assert(_count_open_pupil_links() > 0,
    'no pupil at school has an open guardian link: db/62''s rule is not in use');

  -- Where a link has a date, it is the child's eighteenth birthday, not an
  -- approximation of it (a NULL date is the open link above, which <> skips).
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

  -- Restore the date, and the same call now succeeds: open, because he is
  -- at school (db/62); his own birthday for a boy who is not (section 40).
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
  -- proves the seed's links, and guardian_link_establish() could quietly
  -- write NULL for the wrong child without a single assertion turning red.
  -- (Section 40 asks the same of a boy who is NOT at school: his birthday.)
  PERFORM _assert(_count_open_guardian_links() = 0,
    'guardian_link_establish created an open-ended link for an adult out of school');
  SELECT count(*) INTO n FROM _guardian_link_ends(P_U13, U_BURSAR) e WHERE e IS NULL;
  PERFORM _assert(n = 1 AND _count_subjects(P_U13) = 1,
    'guardian_link_establish did not leave a pupil''s link open while he is at school');
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
  -- Every capability but one domain: safeguarding.* is the owner's key's one
  -- carve-out (roles.mjs, db/57; CSA p63). Section 35 proves it reads no
  -- concern even when the rows are granted back.
  PERFORM _assert(
    (SELECT count(*) FROM role_capability WHERE role = 'superadmin')
      = (SELECT count(*) FROM capability WHERE name NOT LIKE 'safeguarding.%')
    AND NOT EXISTS (SELECT 1 FROM role_capability WHERE role = 'superadmin' AND capability LIKE 'safeguarding.%'),
    'the owner''s key does not hold every capability outside safeguarding.*, or holds one inside it');

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

  -- ── Rulebook clauses: anyone signed in reads, nobody writes (SCRBRD-041, db/32)
  -- Reference material under the directive's own predicate. The spectator is
  -- the narrowest signed-in principal there is; if he reads the clause, so
  -- does everyone who can read the limit it explains.
  PERFORM set_config('app.user_id', '', true);
  SELECT count(*) INTO n FROM rulebook_clause;
  PERFORM _assert(n = 0, 'an unidentified session can read rulebook clauses');
  SELECT count(*) INTO n FROM rulebook_clause_age;
  PERFORM _assert(n = 0, 'an unidentified session can read the ages a clause applies to');

  PERFORM _as(U_WATCHER);
  SELECT count(*) INTO n FROM rulebook_clause;
  PERFORM _assert(n >= 7, format('a spectator reads %s rulebook clauses, not the seven db/32 seeds', n));
  -- Every limit he can read cites a clause he can read, for its own band.
  SELECT count(*) INTO n FROM bowling_directive d
    JOIN rulebook_clause_age a ON a.clause_code = d.clause_code AND a.age_band = d.age_band
    JOIN rulebook_clause c ON c.code = d.clause_code;
  PERFORM _assert(n = (SELECT count(*) FROM bowling_directive) AND n = 6,
    format('only %s of the directive''s limits cite a readable clause for their band', n));
  SELECT count(*) INTO n FROM bowling_directive WHERE age_band = 'U13' AND clause_code = 'PACE-U13';
  PERFORM _assert(n = 1, 'the U13 limit does not cite PACE-U13');

  -- Not even the owner's key writes the rulebook through the application: the
  -- privilege is revoked AND there is no write policy, so the refusal is the
  -- same whichever layer a later file loosens first.
  PERFORM _as(U_OWNER);
  BEGIN
    INSERT INTO rulebook_clause (code, title, category, severity, source, body)
    VALUES ('VERIFY-X', 'Written through the application', 'Conduct', 'Guideline', 'db/99 assertion',
            'A clause the application role must never be able to write, whoever it is acting for.');
    PERFORM _assert(false, 'the application role inserted a rulebook clause');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE rulebook_clause SET severity = 'Guideline' WHERE code = 'PACE-U13';
    PERFORM _assert(false, 'the application role downgraded a mandatory clause');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO rulebook_clause_age (clause_code, age_band) VALUES ('PACE-OPEN', 'U13');
    PERFORM _assert(false, 'the application role widened a clause to another age band');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM _assert(
    NOT EXISTS (SELECT 1 FROM pg_policy
                 WHERE polrelid IN ('rulebook_clause'::regclass, 'rulebook_clause_age'::regclass)
                   AND polcmd <> 'r'),
    'a rulebook table has a write policy');

  -- ── 16. A duty, the authority it rests on, and the pause (SCRBRD-034) ─
  -- db/34 links a match duty to a fixture-scoped assignment the office makes;
  -- db/35 teaches the decision functions to read a suspension. The claims:
  -- only the office links, suspends and lifts; a reason is required each way;
  -- a suspended assignment grants NOTHING, read or write, through every
  -- decision function; lifting restores it without reactivating anything;
  -- withdrawing the duty revokes it.
  --
  -- The appointment alone grants nothing — that was the gap.
  PERFORM _as(U_DUTY);
  SELECT count(*) INTO n FROM match WHERE id = M_DUTY;
  PERFORM _assert(n = 0, 'an appointment with no linked assignment let its scorer read the fixture');

  -- Only the school office links. A coach, another school's office, the duty's
  -- own scorer, and a principal — who holds user.role.assign but may not
  -- appoint a scorer (GRANTABLE_ROLES) — are all refused.
  FOREACH v_code IN ARRAY ARRAY[U_COACH2::text, U_WES_ADM::text, U_DUTY::text, U_HEAD_M::text] LOOP
    PERFORM _as(v_code::uuid);
    SELECT l.ok, l.reason INTO v_ok, v_reason FROM duty_link(D_DUTY) l;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted',
      format('%s linked a duty to an assignment (ok=%s reason=%s)', v_code, v_ok, v_reason));
  END LOOP;
  PERFORM _as(U_REGISTRAR);
  SELECT l.ok, l.assignment_id INTO v_ok, A_DUTY FROM duty_link(D_DUTY) l;
  PERFORM _assert(v_ok AND A_DUTY IS NOT NULL, 'the school office could not link a duty');
  SELECT count(*) INTO n FROM role_assignment
   WHERE id = A_DUTY AND person_id = U_DUTY AND role = 'scorer' AND school_id = HIL
     AND fixture_id = M_DUTY AND team_code IS NULL AND active AND created_by = U_REGISTRAR;
  PERFORM _assert(n = 1, 'the linked assignment is not exactly the duty''s shape, granted by the office');
  SELECT l.reason INTO v_reason FROM duty_link(D_DUTY) l;
  PERFORM _assert(v_reason = 'already_linked', 'a live link was replaced by a second one');

  -- The link now grants the duty's authority, at that fixture and no other.
  PERFORM _as(U_DUTY);
  SELECT count(*) INTO n FROM match WHERE id = M_DUTY;
  PERFORM _assert(n = 1, 'a linked scorer cannot read their own fixture');
  PERFORM _assert(app_can('scoring.edit', HIL, '1XI', NULL, M_DUTY), 'a linked scorer cannot score their fixture');
  PERFORM _assert(NOT app_can('scoring.edit', HIL, '1XI', NULL, M_OTHER), 'a linked scorer can score a fixture they were not appointed to');

  -- Nobody writes the link around duty_link(). The director of sport holds
  -- officiating.assign AND user.role.assign and may update the appointment;
  -- the league holds officiating.assign everywhere. Neither can touch the
  -- column: the application role has no privilege on it.
  FOREACH v_code IN ARRAY ARRAY[U_SARAH::text, U_LEAGUE::text] LOOP
    PERFORM _as(v_code::uuid);
    BEGIN
      UPDATE match_official SET assignment_id = NULL WHERE id = D_DUTY;
      PERFORM _assert(false, format('%s unlinked a duty directly', v_code));
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      UPDATE match_official SET assignment_id = 'a5510000-0000-0000-0000-000000000023' WHERE id = D_DUTY2;
      PERFORM _assert(false, format('%s linked a duty directly, around duty_link()', v_code));
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  -- A linked appointment keeps what it is about, for anyone who may edit it.
  PERFORM _as(U_SARAH);
  BEGIN
    UPDATE match_official SET person_id = U_SCORER WHERE id = D_DUTY;
    PERFORM _assert(false, 'a linked appointment was re-pointed at somebody else');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- And the SHAPE holds however the column is written — even as the owner.
  -- E Ndlovu's official assignment is the right role for an umpire and the
  -- wrong person at the wrong fixture; a live link is not dropped.
  BEGIN
    PERFORM _link_raw(D_DUTY2, 'a5510000-0000-0000-0000-000000000023');
    PERFORM _assert(false, 'a duty was linked to another person''s assignment at another fixture');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM _link_raw(D_DUTY, NULL);
    PERFORM _assert(false, 'a duty was unlinked from a live assignment');
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Suspending: the office only, and never without a reason.
  PERFORM _as(U_COACH2);
  SELECT s.ok, s.reason INTO v_ok, v_reason FROM duty_suspend(D_DUTY, 'Not the coach''s call') s;
  PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted', 'a coach suspended a duty');
  PERFORM _as(U_DUTY);
  SELECT s.ok, s.reason INTO v_ok, v_reason FROM duty_suspend(D_DUTY, 'Standing myself down') s;
  PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted', 'a scorer suspended their own duty');
  PERFORM _as(U_REGISTRAR);
  SELECT s.ok, s.reason INTO v_ok, v_reason FROM duty_suspend(D_DUTY, '   ') s;
  PERFORM _assert(NOT v_ok AND v_reason = 'reason_required', 'a duty was suspended with a blank reason');
  SELECT s.ok, s.reason INTO v_ok, v_reason FROM duty_suspend(D_DUTY, NULL) s;
  PERFORM _assert(NOT v_ok AND v_reason = 'reason_required', 'a duty was suspended with no reason');
  -- Nobody writes the record around the function.
  BEGIN
    INSERT INTO duty_suspension (duty_id, assignment_id, school_id, suspended_by, reason)
    VALUES (D_DUTY, A_DUTY, HIL, U_REGISTRAR, 'Written round the function');
    PERFORM _assert(false, 'the application role wrote a suspension directly');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT s.ok INTO v_ok FROM duty_suspend(D_DUTY, 'Complaint about the scorebook under review') s;
  PERFORM _assert(v_ok, 'the school office could not suspend a linked duty');
  PERFORM _assert(duty_status(D_DUTY) = 'suspended', 'a suspended duty does not read as suspended: ' || coalesce(duty_status(D_DUTY), 'NULL'));
  SELECT count(*) INTO n FROM duty_suspension
   WHERE duty_id = D_DUTY AND assignment_id = A_DUTY AND suspended_by = U_REGISTRAR
     AND reason = 'Complaint about the scorebook under review' AND lifted_at IS NULL;
  PERFORM _assert(n = 1, 'the suspension did not record who, when and why');
  -- A principal holds user.role.assign, so may pause a duty (answered as
  -- already suspended, not as not permitted)…
  PERFORM _as(U_HEAD_M);
  SELECT s.reason INTO v_reason FROM duty_suspend(D_DUTY, 'Also pausing it') s;
  PERFORM _assert(v_reason = 'already_suspended',
    format('a principal was refused a suspension for the wrong reason (%s)', v_reason));

  -- WHILE SUSPENDED, THE ASSIGNMENT GRANTS NOTHING. A real read under
  -- fixture.read, a real write decision, and all three decision functions.
  PERFORM _as(U_DUTY);
  SELECT count(*) INTO n FROM match WHERE id = M_DUTY;
  PERFORM _assert(n = 0, 'a suspended scorer still reads the fixture');
  SELECT count(*) INTO n FROM match_official WHERE match_id = M_DUTY;
  PERFORM _assert(n = 0, 'a suspended scorer still reads the fixture''s appointments');
  PERFORM _assert(NOT app_can('scoring.edit', HIL, '1XI', NULL, M_DUTY), 'a suspended scorer may still score');
  PERFORM _assert(NOT app_holds('scoring.edit'), 'app_holds() still counts a suspended assignment');
  -- app_may_grant() carries the same line (db/35's own check asserts it), but
  -- no role a duty can rest on grants anything, so there is no live claim to
  -- make about it here that would not pass for the wrong reason.
  -- The scorer is told they are suspended, and not why.
  PERFORM _assert(assignment_suspended(A_DUTY), 'a suspended scorer cannot see that they are suspended');
  SELECT count(*) INTO n FROM duty_suspension;
  PERFORM _assert(n = 0, 'a suspended scorer reads the office''s reason');
  -- …and nobody but the office can lift it.
  SELECT l.ok, l.reason INTO v_ok, v_reason FROM duty_lift(D_DUTY, 'I am fine now') l;
  PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted', 'a scorer lifted their own suspension');
  -- …and a principal, who could pause it, cannot restore a role they may not appoint.
  PERFORM _as(U_HEAD_M);
  SELECT l.ok, l.reason INTO v_ok, v_reason FROM duty_lift(D_DUTY, 'Restoring') l;
  PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted', 'a principal lifted a scorer''s suspension');
  PERFORM _as(U_REGISTRAR);
  PERFORM _assert(duty_suspended(D_DUTY), 'duty_suspended() does not report the open suspension');
  SELECT l.ok, l.reason INTO v_ok, v_reason FROM duty_lift(D_DUTY, '') l;
  PERFORM _assert(NOT v_ok AND v_reason = 'reason_required', 'a suspension was lifted without a reason');

  -- LIFTING RESTORES IT, and restores it by closing the record, not by
  -- touching the assignment: same row, never deactivated, nothing reactivated.
  SELECT l.ok INTO v_ok FROM duty_lift(D_DUTY, 'Scorebook checked; no fault found') l;
  PERFORM _assert(v_ok, 'the school office could not lift a suspension');
  PERFORM _assert(duty_status(D_DUTY) <> 'suspended', 'a lifted duty still reads as suspended');
  SELECT count(*) INTO n FROM duty_suspension
   WHERE duty_id = D_DUTY AND lifted_by = U_REGISTRAR AND lifted_at IS NOT NULL
     AND lift_reason = 'Scorebook checked; no fault found'
     AND reason = 'Complaint about the scorebook under review';
  PERFORM _assert(n = 1, 'the lift did not record who, when and why beside the suspension');
  SELECT count(*) INTO n FROM role_assignment WHERE id = A_DUTY AND active AND revoked_at IS NULL;
  PERFORM _assert(n = 1, 'suspending or lifting touched the assignment''s active flag');
  PERFORM _as(U_DUTY);
  SELECT count(*) INTO n FROM match WHERE id = M_DUTY;
  PERFORM _assert(n = 1, 'lifting a suspension did not restore the scorer''s read');
  PERFORM _assert(app_can('scoring.edit', HIL, '1XI', NULL, M_DUTY), 'lifting a suspension did not restore scoring');
  PERFORM _assert(NOT assignment_suspended(A_DUTY), 'a lifted suspension still reads as suspended');

  -- WITHDRAWING THE DUTY REVOKES THE AUTHORITY, in the same statement, by
  -- whoever withdraws it — the director of sport through officiating.assign.
  PERFORM _as(U_SARAH);
  UPDATE match_official SET withdrawn = true WHERE id = D_DUTY;
  SELECT count(*) INTO n FROM role_assignment
   WHERE id = A_DUTY AND NOT active AND revoked_by = U_SARAH AND revoked_at IS NOT NULL;
  PERFORM _assert(n = 1, 'withdrawing a linked duty did not revoke its assignment');
  PERFORM _as(U_DUTY);
  SELECT count(*) INTO n FROM match WHERE id = M_DUTY;
  PERFORM _assert(n = 0, 'a withdrawn scorer still reads the fixture');
  PERFORM _as(U_SARAH);
  BEGIN
    UPDATE match_official SET withdrawn = false WHERE id = D_DUTY;
    PERFORM _assert(false, 'a withdrawn linked appointment was reinstated over a revoked assignment');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM _as(U_REGISTRAR);
  SELECT s.reason INTO v_reason FROM duty_suspend(D_DUTY, 'Too late') s;
  PERFORM _assert(v_reason = 'duty_withdrawn', 'a withdrawn duty could be suspended');
  SELECT l.reason INTO v_reason FROM duty_link(D_DUTY) l;
  PERFORM _assert(v_reason = 'duty_withdrawn', 'a withdrawn duty could be linked again');

  -- ── 17. Quarantine's loose ends (SCRBRD-071, db/37) ────────────
  -- Three guarantees the database holds; the fourth — that a released ball
  -- meets the Laws — is the API's (lawsRefusal() cannot run in SQL), and
  -- tools/smoke-quarantine.mjs drives it end to end.
  --
  -- (a) A released ball keeps contact and trajectory, and (b) takes the live
  --     path's per-match lock before it reads max(seq), so a live batch can
  --     neither race it for a seq nor append after it unjudged. Behaviour is
  --     proved in the walk; here, that the function in the database is the
  --     one db/37 wrote.
  PERFORM _assert(pg_get_functiondef('quarantine_resolve(bigint,boolean,jsonb,text)'::regprocedure)
                    ~ 'p_row->>''contact''.*p_row->>''trajectory''',
    'quarantine_resolve() drops contact and trajectory from a released ball');
  PERFORM _assert(pg_get_functiondef('quarantine_resolve(bigint,boolean,jsonb,text)'::regprocedure)
                    ~ 'FROM scoring_session s WHERE s.match_id = q.match_id FOR UPDATE',
    'quarantine_resolve() no longer takes the per-match lock the live write path takes');
  PERFORM _assert(EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ball_event_quarantine_resolution_check'
                            AND pg_get_constraintdef(oid) LIKE '%superseded%'),
    'a held row cannot be closed as superseded');

  -- (c) A key written live closes its held copy, in the same statement, for
  --     every writer: a ball held under a stale token and re-sent by the
  --     device that now holds the token is not left for a person to
  --     "release" into a log that already has it.
  PERFORM _assert(EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                            AND tgname = 'ball_event_supersedes_held' AND tgenabled = 'O'),
    'the trigger that closes a held copy of a key written live is missing or disabled');
  PERFORM _assert(_count_open_held_copies() = 0,
    'a held ball is still waiting for a person although the same event is already in the log');
  PERFORM _scoring_session_reset(M_HANDOVER);
  PERFORM _as(U_SCORER);
  PERFORM set_config('app.device_id', 'verify-037', true);
  SELECT c.ok, c.epoch INTO v_ok, v_epoch FROM scoring_claim(M_HANDOVER, 'verify-037') c;
  PERFORM _assert(v_ok, 'the scorer could not claim the match the db/37 section scores');
  DECLARE
    v_ball jsonb := jsonb_build_object('match_id', M_HANDOVER, 'innings', 0, 'kind', 'ball',
                                       'ball_type', 'run', 'value', 2, 'payload', '{}'::jsonb);
    v_res  text;
    v_by   uuid;
  BEGIN
    -- Held under a stale epoch with the fingerprint the write path computes;
    -- a second key held saying something else.
    INSERT INTO ball_event_quarantine (match_id, school_id, submitted_epoch, current_epoch, scorer_user_id,
                                       device_id, idempotency_key, body, fingerprint)
    VALUES (M_HANDOVER, match_school(M_HANDOVER), v_epoch + 5, v_epoch, U_SCORER, 'verify-037',
            'verify:037:same', '{}'::jsonb,
            ball_event_fingerprint(jsonb_populate_record(null::ball_event, v_ball))),
           (M_HANDOVER, match_school(M_HANDOVER), v_epoch + 5, v_epoch, U_SCORER, 'verify-037',
            'verify:037:other', '{}'::jsonb, 'verify-037-a-different-event');
    -- ...then both keys written live, the way appendEvents writes a row.
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value, payload)
    SELECT M_HANDOVER, match_school(M_HANDOVER), 9000 + k, v_epoch, r.innings, U_SCORER, 'verify-037',
           key, k, now(), r.kind, r.ball_type, r.value, r.payload
      FROM jsonb_populate_record(null::ball_event, v_ball) r,
           (VALUES (1, 'verify:037:same'), (2, 'verify:037:other')) AS x(k, key);
    -- IS NOT DISTINCT FROM, and counts: _assert() passes a NULL condition,
    -- so a comparison with a row that is not there would pass vacuously.
    SELECT resolution, resolved_by INTO v_res, v_by FROM ball_event_quarantine WHERE idempotency_key = 'verify:037:same';
    PERFORM _assert(v_res IS NOT DISTINCT FROM 'superseded' AND v_by IS NOT DISTINCT FROM U_SCORER,
      format('writing a held key live left its held copy %s (by %s), not superseded', coalesce(v_res, 'open'), v_by));
    -- A different event under the key is a conflict — the write path refuses
    -- it before it gets here — and if one is ever written, it stays held for a
    -- person rather than being closed as if it were the same ball.
    SELECT count(*) INTO n FROM ball_event_quarantine
     WHERE idempotency_key = 'verify:037:other' AND resolved_at IS NULL AND resolution IS NULL;
    PERFORM _assert(n = 1, 'a held event was closed by a DIFFERENT event written under its key');
  END;
  PERFORM set_config('app.device_id', '', true);

  -- ── 18. An approved amendment takes the per-match lock (SCRBRD-076, db/38) ──
  -- scoring_amendment_decide() appended its void without the lock the live
  -- path and a release take, so a live batch that had folded the log could
  -- append after the void unjudged. That the void meets the Laws is the API's
  -- (lawsRefusal() cannot run in SQL); tools/smoke-amend.mjs walks it. Here:
  -- the function in the database is db/38's, it locks, and it still answers
  -- every reason db/02 gave, in db/02's order.
  PERFORM _assert(pg_get_functiondef('scoring_amendment_decide(uuid,boolean,text)'::regprocedure)
                    ~ 'FROM scoring_session s WHERE s.match_id = a.match_id FOR UPDATE.*INSERT INTO ball_event',
    'scoring_amendment_decide() does not take the per-match lock before it appends its void');
  PERFORM _assert(EXISTS (SELECT 1 FROM pg_proc
                           WHERE oid = 'scoring_amendment_decide(uuid,boolean,text)'::regprocedure
                             AND prosecdef
                             AND 'search_path=pg_catalog, public, pg_temp' = ANY (proconfig)),
    'scoring_amendment_decide() lost its pinned search_path (db/16) when db/38 replaced it');
  PERFORM _scoring_session_reset(M_HANDOVER);
  PERFORM _as(U_SCORER);
  SELECT c.ok INTO v_ok FROM scoring_claim(M_HANDOVER, 'verify-038') c;
  PERFORM _assert(v_ok, 'the scorer could not claim the match the db/38 section amends');
  PERFORM _assert(_session_xmax(M_HANDOVER) = '0',
    format('the db/38 section''s session row is locked before anything amends it (xmax %s)', _session_xmax(M_HANDOVER)));
  DECLARE
    A_LIVE  uuid;   -- the scorer's request, approved by somebody else
    A_OWN   uuid;   -- the owner's, decided by the owner
    A_GONE  uuid;   -- a second request on a delivery already voided
    v_void  text;
  BEGIN
    -- The ball section 17 wrote live, and one after it: the amendment voids
    -- the OLDER one, which is what an amendment is for.
    INSERT INTO scoring_amendment (match_id, school_id, target_key, reason, requested_by)
    VALUES (M_HANDOVER, match_school(M_HANDOVER), 'verify:037:same', 'db/38: the lock', U_SCORER)
    RETURNING id INTO A_LIVE;

    -- (1) before (2): the scorer holds no approval at all, so deciding his
    --     own request is not_permitted — not the self-approval guard.
    SELECT d.reason INTO v_reason FROM scoring_amendment_decide(A_LIVE, true) d;
    PERFORM _assert(v_reason IS NOT DISTINCT FROM 'not_permitted',
      format('the scorer deciding his own request was answered %s, not not_permitted', coalesce(v_reason, 'NULL')));
    PERFORM _assert(_session_xmax(M_HANDOVER) = '0',
      'a caller with no standing over the match took its per-match lock');

    PERFORM _as(U_SARAH);
    SELECT d.reason INTO v_reason FROM scoring_amendment_decide(gen_random_uuid(), true) d;
    PERFORM _assert(v_reason IS NOT DISTINCT FROM 'no_such_amendment',
      format('an amendment that does not exist was answered %s', coalesce(v_reason, 'NULL')));

    SELECT d.ok, d.reason, d.void_key INTO v_ok, v_reason, v_void
      FROM scoring_amendment_decide(A_LIVE, true, 'db/38') d;
    PERFORM _assert(v_ok AND v_void IS NOT DISTINCT FROM 'amendment:' || A_LIVE::text,
      format('the director of sport could not approve the scorer''s amendment (%s)', coalesce(v_reason, 'NULL')));
    -- THE LOCK. Taken by the approval, held to this transaction's end.
    PERFORM _assert(_session_xmax(M_HANDOVER) <> '0',
      'approving an amendment appended to the log without the per-match lock the live path takes');
    SELECT count(*) INTO n FROM ball_event
     WHERE idempotency_key = v_void AND kind = 'void' AND device_id = 'amendment'
       AND scorer_user_id = U_SCORER AND payload->>'approved_by' = U_SARAH::text
       AND payload->>'target' = 'verify:037:same'
       AND seq = (SELECT max(seq) FROM ball_event WHERE match_id = M_HANDOVER);
    PERFORM _assert(n = 1, 'the void is not the requester''s, approved by the approver, at the end of the log');

    SELECT d.reason INTO v_reason FROM scoring_amendment_decide(A_LIVE, true) d;
    PERFORM _assert(v_reason IS NOT DISTINCT FROM 'already_approved',
      format('an approved amendment decided again was answered %s', coalesce(v_reason, 'NULL')));

    -- (3) a delivery already voided is not live.
    PERFORM _as(U_SCORER);
    INSERT INTO scoring_amendment (match_id, school_id, target_key, reason, requested_by)
    VALUES (M_HANDOVER, match_school(M_HANDOVER), 'verify:037:same', 'db/38: again', U_SCORER)
    RETURNING id INTO A_GONE;
    PERFORM _as(U_SARAH);
    SELECT d.reason INTO v_reason FROM scoring_amendment_decide(A_GONE, true) d;
    PERFORM _assert(v_reason IS NOT DISTINCT FROM 'no_such_live_delivery',
      format('voiding a delivery already voided was answered %s', coalesce(v_reason, 'NULL')));
    SELECT d.ok INTO v_ok FROM scoring_amendment_decide(A_GONE, false, 'db/38: nothing to void') d;
    SELECT count(*) INTO n FROM scoring_amendment WHERE id = A_GONE AND state = 'declined' AND decided_by = U_SARAH;
    PERFORM _assert(v_ok AND n = 1, 'the director of sport could not decline an amendment');

    -- (2) nobody approves their own, whatever they hold: the owner holds
    --     both halves.
    PERFORM _as(U_OWNER);
    INSERT INTO scoring_amendment (match_id, school_id, target_key, reason, requested_by)
    VALUES (M_HANDOVER, match_school(M_HANDOVER), 'verify:037:other', 'db/38: my own', U_OWNER)
    RETURNING id INTO A_OWN;
    SELECT d.reason INTO v_reason FROM scoring_amendment_decide(A_OWN, true) d;
    PERFORM _assert(v_reason IS NOT DISTINCT FROM 'cannot_approve_your_own',
      format('the owner deciding their own amendment was answered %s', coalesce(v_reason, 'NULL')));
  END;
  PERFORM set_config('app.device_id', '', true);

  -- ── db/39. Fixture anchors through match_school()/match_team() ──
  --
  -- Seven tables' anchors moved from a subquery on `match` under the caller's
  -- RLS to the SECURITY DEFINER helpers. docs/rls-anchor-audit.md is the
  -- audit: for six of them no role's access changes, and for
  -- match_availability exactly one thing does — a pupil's selfaccess
  -- assignment reaches his OWN declarations for fixtures his team assignment
  -- cannot see. Each claim below is that and nothing more.
  DECLARE
    M_U16B  uuid := '77777777-0000-0000-0000-000000000003';  -- U16B v Kearsney; R Pillay is 1XI
    M_39    uuid := '77777777-0000-0000-0000-000000000039';  -- U15A, nothing else here touches it
    U_DRIVE uuid := '88888888-0000-0000-0000-000000000017';  -- B Ngcobo: transport.read, no fixture.read
    t       text;
    who     uuid;
  BEGIN
    -- Every policy db/39 made still reads the helpers — a later file that put
    -- a subquery back would pass db/39's own check and fail here.
    SELECT count(*) INTO n FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname IN ('match_toss_read', 'match_toss_insert', 'match_toss_update',
                          'match_broadcast_read', 'match_broadcast_insert', 'match_broadcast_update',
                          'drs_review_read', 'drs_review_insert', 'drs_review_update',
                          'match_official_read', 'match_official_insert', 'match_official_update',
                          'match_pitch_report_read', 'match_pitch_report_insert', 'match_pitch_report_update',
                          'match_weather_read', 'match_weather_insert', 'match_weather_update',
                          'match_availability_read', 'match_availability_insert', 'match_availability_update')
       AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%match_school(%'
       AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%FROM match %';
    PERFORM _assert(n = 21, format('%s of db/39''s 21 policies anchor through match_school() — expected all of them', n));

    -- (1) THE BLIND CASE, NOW SEEING. R Pillay's team assignment is 1XI, so
    --     he cannot read the U16B fixture — and before db/39 that also hid his
    --     own availability for it, because the anchor came back NULL.
    PERFORM _as(U_SELF);
    SELECT count(*) INTO n FROM match WHERE id = M_U16B;
    PERFORM _assert(n = 0, 'the pupil reads the U16B fixture itself — the anchor must stay metadata, not a way to the match');
    SELECT count(*) INTO n FROM match_availability WHERE match_id = M_U16B AND player_id = P_INJURED;
    PERFORM _assert(n = 1, 'a pupil cannot read his own availability for a fixture his team assignment cannot see');
    -- Tried here, before the reads below, so it is this write's own policy
    -- that answers: an UPDATE also passes through the read policy, and a
    -- widened read would otherwise be caught first and this line never ran.
    UPDATE match_availability SET status = 'available' WHERE match_id = M_U16B AND player_id = P_U16B;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM _assert(n = 0, 'a pupil changed another boy''s availability');
    -- (2) ...and nothing more: not the U16B boy's statement beside it, and in
    --     total exactly his own rows — every one of them, no one else's.
    SELECT count(*) INTO n FROM match_availability WHERE match_id = M_U16B AND player_id <> P_INJURED;
    PERFORM _assert(n = 0, 'a pupil reads another boy''s availability ("unavailable, family") through the resolved anchor');
    SELECT count(*) INTO n FROM match_availability;
    PERFORM _assert(n = _count_availability_of(P_INJURED),
      format('a pupil reads %s availability rows; his own number %s', n, _count_availability_of(P_INJURED)));

    -- (3) THE WRITE. He may make his own statement about that Saturday...
    BEGIN
      INSERT INTO match_availability (match_id, player_id, school_id, status, declared_by)
      VALUES (M_39, P_INJURED, HIL, 'available', U_SELF);
      v_ok := true;
    EXCEPTION WHEN insufficient_privilege THEN v_ok := false;
    END;
    PERFORM _assert(v_ok, 'a pupil cannot declare his own availability for a fixture his team assignment cannot see');
    -- (4) ...and not anybody else's, however the anchor resolves.
    BEGIN
      INSERT INTO match_availability (match_id, player_id, school_id, status, declared_by)
      VALUES (M_39, P_U16B, HIL, 'unavailable', U_SELF);
      v_ok := true;
    EXCEPTION WHEN insufficient_privilege THEN v_ok := false;
    END;
    PERFORM _assert(NOT v_ok, 'a pupil declared availability for another boy');

    -- (5) THE SIX WHOSE ACCESS DOES NOT CHANGE. Read under fixture.read, which
    --     is the match's own check, so a row is visible only where its fixture
    --     is — for every principal here, including the driver and the pupil
    --     who each hold something on a fixture-anchored table but not the
    --     fixture. If the resolved anchor ever became a way around the match,
    --     this is where it shows.
    PERFORM _assert(_count_rows('match_toss') > 0 AND _count_rows('match_weather') > 0
                    AND _count_rows('match_official') > 0 AND _count_rows('match_pitch_report') > 0,
      'db/39''s no-change claim has nothing to be tested against — a table is empty');
    FOREACH who IN ARRAY ARRAY[U_DRIVE, U_SELF, U_PUPIL, U_WATCHER, U_COACH2, U_SCORER,
                               U_UMPIRE, U_MEDIC, U_BURSAR, U_WES_ADM, U_HEAD_M]::uuid[] LOOP
      PERFORM _as(who);
      FOREACH t IN ARRAY ARRAY['match_toss', 'match_broadcast', 'drs_review', 'match_official',
                               'match_pitch_report', 'match_weather'] LOOP
        EXECUTE format('SELECT count(*) FROM %I x WHERE NOT EXISTS (SELECT 1 FROM match m WHERE m.id = x.match_id)', t)
          INTO n;
        PERFORM _assert(n = 0, format('%s reads %s %s row(s) for a fixture they cannot read', who, n, t));
      END LOOP;
    END LOOP;
    -- The driver in particular: he reads none of them at all.
    PERFORM _as(U_DRIVE);
    SELECT (SELECT count(*) FROM match_toss) + (SELECT count(*) FROM match_weather)
         + (SELECT count(*) FROM match_official) + (SELECT count(*) FROM match_pitch_report)
      INTO n;
    PERFORM _assert(n = 0, format('the driver reads %s fixture-condition row(s) with no fixture.read', n));

    -- (6) WITHHELD, ON PURPOSE. trip keeps its subquery: resolving it would
    --     show a school-wide driver every trip at the school, not his own
    --     (docs/rls-anchor-audit.md, "trip"). db/41 gave the named driver his
    --     own trips instead (its section below); the tripwire that stays here
    --     is that he reads none he is not driving.
    SELECT count(*) INTO n FROM trip WHERE driver_id IS DISTINCT FROM U_DRIVE;
    PERFORM _assert(n = 0, format('the driver reads %s trip(s) he is not driving: trip was withheld from db/39 — see docs/rls-anchor-audit.md', n));
  END;

  -- ── db/41. A driver reaches his own trips, and no other ──
  --
  -- trip_contacts() used to hand the manifest — every travelling child's
  -- parents' numbers — to anybody holding transport.drive at the school, for
  -- any trip there within a day; trip_mark() let them mark any trip there, and
  -- anybody at all mark a trip with no driver named. The read went the other
  -- way: a driver saw no trip, not even his own. Each claim is one half of
  -- that, and the last is that nobody else's view of trip or match moved.
  DECLARE
    U_DRIVE  uuid := '88888888-0000-0000-0000-000000000017';  -- driver A (the seed's)
    U_DRIVE2 uuid := '88888888-0000-0000-0000-00000000041b';  -- driver B, same school
    T_A      uuid := '41410000-0000-0000-0000-00000000000a';  -- A's bus, today
    T_A2     uuid := '41410000-0000-0000-0000-0000000000a2';  -- B's bus to A's fixture
    T_A3     uuid := '41410000-0000-0000-0000-0000000000a3';  -- the office's bus to A's fixture
    T_B      uuid := '41410000-0000-0000-0000-00000000000b';  -- B's bus, today
    T_N      uuid := '41410000-0000-0000-0000-00000000000c';  -- nobody named
    T_F      uuid := '41410000-0000-0000-0000-00000000000f';  -- A's bus, ten days off
    M_A      uuid := '77777777-0000-0000-0000-0000000041a0';
    M_B      uuid := '77777777-0000-0000-0000-0000000041b0';
    M_F      uuid := '77777777-0000-0000-0000-0000000041f0';
    who      uuid;
  BEGIN
    PERFORM _pick_41();
    PERFORM _assert(_manifest_size(T_A) > 0 AND _manifest_size(T_B) > 0 AND _manifest_size(T_F) > 0,
      'db/41''s manifests have nobody on them — the contact assertions below would pass vacuously');

    -- (1) THE READ. A reads his trips — all of them, and nobody else's: not
    --     B's bus at the same school, and not B's second bus to A's own
    --     fixture, which trip_read's anchor would resolve once A can read
    --     that fixture (trip_driver_own_only is what stops it).
    PERFORM _as(U_DRIVE);
    SELECT count(*) INTO n FROM trip WHERE id = T_A;
    PERFORM _assert(n = 1, 'the driver cannot read the trip he is driving');
    SELECT count(*) INTO n FROM trip WHERE id = T_B;
    PERFORM _assert(n = 0, 'the driver reads another driver''s trip at his school');
    SELECT count(*) INTO n FROM trip WHERE id IN (T_A2, T_A3);
    PERFORM _assert(n = 0, format('the driver reads %s other bus(es) to his own fixture', n));
    SELECT count(*) INTO n FROM trip;
    PERFORM _assert(n = _count_trips_driven_by(U_DRIVE),
      format('the driver reads %s trip(s); he is named on %s', n, _count_trips_driven_by(U_DRIVE)));

    -- (2) THE FIXTURE, for the day-of screen: his live trips' fixtures and no
    --     other — and the fixture only, not what hangs off it.
    SELECT count(*) INTO n FROM match WHERE id = M_A;
    PERFORM _assert(n = 1, 'the driver cannot read the fixture of the trip he is driving');
    SELECT count(*) INTO n FROM match WHERE id = M_B;
    PERFORM _assert(n = 0, 'the driver reads the fixture of another driver''s trip');
    SELECT count(*) INTO n FROM match;
    PERFORM _assert(n = _count_matches_driven_by(U_DRIVE),
      format('the driver reads %s fixture(s); he drives to %s', n, _count_matches_driven_by(U_DRIVE)));
    SELECT (SELECT count(*) FROM match_squad) + (SELECT count(*) FROM match_toss)
         + (SELECT count(*) FROM match_availability) + (SELECT count(*) FROM emergency_contact)
      INTO n;
    PERFORM _assert(n = 0, format('the driver reads %s squad/toss/availability/contact row(s) through a fixture he can now see', n));

    -- (3) THE MANIFEST. His own bus, inside the window; nothing for B's bus,
    --     nothing for the other bus to his own fixture, nothing ten days out.
    SELECT count(*) INTO n FROM trip_contacts(T_A);
    PERFORM _assert(n = _manifest_size(T_A),
      format('the driver reads %s of the %s contact rows on his own bus today', n, _manifest_size(T_A)));
    SELECT count(*) INTO n FROM trip_contacts(T_B);
    PERFORM _assert(n = 0, format('the driver reads %s emergency contact(s) off another driver''s bus', n));
    SELECT count(*) INTO n FROM trip_contacts(T_A2);
    PERFORM _assert(n = 0, format('the driver reads %s emergency contact(s) off the other bus to his fixture', n));
    SELECT count(*) INTO n FROM trip_contacts(T_N);
    PERFORM _assert(n = 0, format('the driver reads %s emergency contact(s) off a bus nobody is named on', n));
    SELECT count(*) INTO n FROM trip_contacts(T_F);
    PERFORM _assert(n = 0, format('the driver reads %s emergency contact(s) ten days before his trip', n));

    -- (4) THE MARKS. Not B's bus, not the other bus to his fixture, not a bus
    --     nobody is named on; his own, yes.
    SELECT m.reason INTO v_reason FROM trip_mark(T_B, 'departed') m;
    PERFORM _assert(v_reason IS NOT DISTINCT FROM 'not_this_driver',
      format('the driver marking another driver''s trip was answered %s', coalesce(v_reason, 'ok')));
    SELECT m.reason INTO v_reason FROM trip_mark(T_A2, 'departed') m;
    PERFORM _assert(v_reason IS NOT DISTINCT FROM 'not_this_driver',
      format('the driver marking the other bus to his fixture was answered %s', coalesce(v_reason, 'ok')));
    SELECT m.reason INTO v_reason FROM trip_mark(T_N, 'departed') m;
    PERFORM _assert(v_reason IS NOT DISTINCT FROM 'not_this_driver',
      format('the driver marking a trip nobody is named on was answered %s', coalesce(v_reason, 'ok')));
    SELECT m.ok INTO v_ok FROM trip_mark(T_A, 'departed') m;
    PERFORM _assert(v_ok AND _trip_departed(T_A), 'the driver could not mark his own trip departed');
    -- A trip with no driver named was open to ANYBODY: db/08's gate came out
    -- NULL, and IF NOT NULL does not refuse.
    FOREACH who IN ARRAY ARRAY[U_PARENT, U_WATCHER, U_COACH2]::uuid[] LOOP
      PERFORM _as(who);
      SELECT m.reason INTO v_reason FROM trip_mark(T_N, 'departed') m;
      PERFORM _assert(v_reason IS NOT DISTINCT FROM 'not_this_driver',
        format('%s marking a trip nobody is named on was answered %s', who, coalesce(v_reason, 'ok')));
    END LOOP;
    PERFORM _assert(NOT _trip_departed(T_N), 'a trip nobody is named on was marked departed');
    -- The office stands in for a driver who did not mark.
    PERFORM _as(U_REGISTRAR);
    SELECT m.ok INTO v_ok FROM trip_mark(T_B, 'departed') m;
    PERFORM _assert(v_ok AND _trip_departed(T_B), 'a transport.manage holder could not mark a trip departed');

    -- (5) B, the mirror: his two buses, his manifest, not A's.
    PERFORM _as(U_DRIVE2);
    SELECT count(*) INTO n FROM trip;
    PERFORM _assert(n = 2 AND n = _count_trips_driven_by(U_DRIVE2),
      format('driver B reads %s trip(s); he is named on %s', n, _count_trips_driven_by(U_DRIVE2)));
    SELECT count(*) INTO n FROM trip_contacts(T_B);
    PERFORM _assert(n = _manifest_size(T_B), format('driver B reads %s contact rows on his own bus', n));
    SELECT count(*) INTO n FROM trip_contacts(T_A);
    PERFORM _assert(n = 0, format('driver B reads %s emergency contact(s) off A''s bus', n));
    -- ...and once his driver assignment is revoked, the trips still naming
    -- him give him nothing: no read, no fixture, no manifest, no mark.
    PERFORM _revoke(U_DRIVE2);
    SELECT (SELECT count(*) FROM trip) + (SELECT count(*) FROM match) INTO n;
    PERFORM _assert(n = 0, format('a revoked driver still reads %s trip/fixture row(s)', n));
    SELECT count(*) INTO n FROM trip_contacts(T_A2);
    PERFORM _assert(n = 0, format('a revoked driver reads %s emergency contact(s) off his own bus', n));
    SELECT m.reason INTO v_reason FROM trip_mark(T_A2, 'departed') m;
    PERFORM _assert(v_reason IS NOT DISTINCT FROM 'not_this_driver',
      format('a revoked driver marking the trip that names him was answered %s', coalesce(v_reason, 'ok')));

    -- (6) A cancelled trip no longer shows him its fixture — but he still
    --     reads the trip itself, so the screen can say it is off. That row
    --     is trip_driver_own_read's alone: with the fixture hidden, trip_read's
    --     anchor comes back NULL (for a live trip it resolves through the
    --     fixture he can now read, so the two policies overlap there).
    PERFORM _cancel_trip(T_F);
    PERFORM _as(U_DRIVE);
    SELECT count(*) INTO n FROM match WHERE id = M_F;
    PERFORM _assert(n = 0, 'the driver reads the fixture of a cancelled trip');
    SELECT count(*) INTO n FROM trip WHERE id = T_F;
    PERFORM _assert(n = 1, 'the driver cannot read his own cancelled trip');

    -- (7) NOBODY ELSE MOVED. For every other principal here, what they read
    --     of match and trip is exactly what db/09's policies gave them.
    FOREACH who IN ARRAY ARRAY[U_PARENT, U_SARAH, U_REGISTRAR, U_WATCHER, U_SELF, U_PUPIL,
                               U_COACH2, U_SCORER, U_MEDIC, U_BURSAR, U_WES_ADM, U_HEAD_M,
                               U_UMPIRE, U_LEAGUE, U_PLAT, U_OWNER]::uuid[] LOOP
      PERFORM _as(who);
      SELECT count(*) INTO n FROM match;
      PERFORM _assert(n = _count_match_before_41(),
        format('%s reads %s fixture(s); db/09 gave %s', who, n, _count_match_before_41()));
      SELECT count(*) INTO n FROM trip;
      PERFORM _assert(n = _count_trip_before_41(),
        format('%s reads %s trip(s); db/09 gave %s', who, n, _count_trip_before_41()));
    END LOOP;
    -- ...and the transport office still sees every bus — including the ones
    -- on a fixture its schooladmin is himself driving to.
    PERFORM _as(U_REGISTRAR);
    SELECT count(*) INTO n FROM trip WHERE id IN (T_A, T_A2, T_A3, T_B, T_N, T_F);
    PERFORM _assert(n = 6, format('the transport office, driving one of them, reads %s of db/41''s 6 trips', n));
  END;

  -- ── 19. A player's SQL figures follow the fold (SCRBRD-068/081, db/40) ──
  -- Balls written live, old shapes beside new, and every career reader asked
  -- what moved. Deltas, read before and after, so whatever an earlier section
  -- left in the log cannot pass or fail this one. Every figure is coalesced
  -- to a number before it is compared: _assert() refuses a NULL, and a
  -- missing row is a figure of 0 here, not a check that never ran.
  --
  --   old  a no-ball for 4 with no nbRuns          off the bat: 4 runs, a four
  --   new  a no-ball, 4 byes     (nbRuns byes)     not his: 0 runs, no four
  --   new  a no-ball, 6 leg byes (nbRuns leg_byes) not his: 0 runs, no six
  --   old  a W ball naming timed_out               a ball, his dismissal, not the bowler's
  --   new  retire marked W, retired_out, P_BAT     his dismissal, no ball, no bowler
  --   new  retire marked W, timed_out,   P_OUT     his dismissal, an innings of 0 (0)
  --   new  retire marked W, a typed name           nobody's (not a player id)
  --   old  retire, reason out, NO W marker, P_OUT  not a wicket (as in the fold)
  PERFORM _scoring_session_reset(M_HANDOVER);
  PERFORM _as(U_SCORER);
  PERFORM set_config('app.device_id', 'verify-040', true);
  SELECT c.ok, c.epoch INTO v_ok, v_epoch FROM scoring_claim(M_HANDOVER, 'verify-040') c;
  PERFORM _assert(v_ok, 'the scorer could not claim the match the db/40 section scores');
  DECLARE
    P_BAT  uuid := 'aaaaaaaa-0000-0000-0000-000000000006';  -- K Dlamini
    P_OUT  uuid := 'aaaaaaaa-0000-0000-0000-000000000011';  -- L Mahlangu, never faced a ball
    P_BOWL uuid := 'bbbbbbbb-0000-0000-0000-000000000002';  -- K Botha
    bat0 record; bat1 record; bow0 record; bow1 record;
    d_bat0 bigint; d_bat1 bigint; d_out0 bigint; d_out1 bigint; d_all0 bigint; d_all1 bigint;
    m_out0 bigint; m_out1 bigint; bw0 bigint; bw1 bigint;
    k_ro0 bigint; k_ro1 bigint; k_to0 bigint; k_to1 bigint; k_out0 bigint; k_out1 bigint;
    inn_out record;
  BEGIN
    PERFORM _as(U_OWNER);
    SELECT coalesce(b.runs, 0) AS runs, coalesce(b.balls_faced, 0) AS balls, coalesce(b.fours, 0) AS fours,
           coalesce(b.sixes, 0) AS sixes INTO bat0 FROM player_batting_since(P_BAT, NULL) b;
    SELECT coalesce(w.runs_conceded, 0) AS runs, coalesce(w.legal_balls, 0) AS balls,
           coalesce(w.no_balls, 0) AS nb, coalesce(w.wickets, 0) AS wkts INTO bow0 FROM player_bowling_since(P_BOWL, NULL) w;
    d_bat0 := coalesce(player_dismissals_since(P_BAT, NULL), 0);
    d_out0 := coalesce(player_dismissals_since(P_OUT, NULL), 0);
    SELECT coalesce(sum(dismissals), 0) INTO d_all0 FROM player_dismissals;
    SELECT coalesce((SELECT matches FROM player_batting_career WHERE player_id = P_OUT), 0) INTO m_out0;
    SELECT coalesce(sum(wickets), 0) INTO bw0 FROM player_wicket_breakdown WHERE player_id = P_BOWL;
    SELECT coalesce(sum(dismissals) FILTER (WHERE dismissal = 'retired_out'), 0),
           coalesce(sum(dismissals) FILTER (WHERE dismissal = 'timed_out'), 0)
      INTO k_ro0, k_to0 FROM player_dismissal_breakdown WHERE player_id = P_BAT;
    SELECT coalesce(sum(dismissals), 0) INTO k_out0 FROM player_dismissal_breakdown
     WHERE player_id = P_OUT AND dismissal = 'timed_out';

    PERFORM _as(U_SCORER);
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value,
                            striker_id, bowler_id, dismissal, payload)
    SELECT M_HANDOVER, match_school(M_HANDOVER), 9400 + x.k, v_epoch, 0, U_SCORER, 'verify-040',
           'verify:040:' || x.k, x.k, now(), x.kind, x.bt, x.v,
           CASE WHEN x.kind = 'ball' THEN P_BAT END, CASE WHEN x.kind = 'ball' THEN P_BOWL END,
           x.dis, x.pl
      FROM (VALUES
        (1, 'ball',   'Nb', 4,    NULL,          '{}'::jsonb),
        (2, 'ball',   'Nb', 4,    NULL,          '{"nbRuns":"byes"}'::jsonb),
        (3, 'ball',   'Nb', 6,    NULL,          '{"nbRuns":"leg_byes"}'::jsonb),
        (4, 'ball',   'W',  0,    'timed_out',   '{}'::jsonb),
        (5, 'retire', 'W',  NULL, 'retired_out', jsonb_build_object('batter', P_BAT, 'reason', 'out')),
        (6, 'retire', 'W',  NULL, 'timed_out',   jsonb_build_object('batter', P_OUT, 'reason', 'timed_out')),
        (7, 'retire', 'W',  NULL, 'retired_out', '{"batter":"An Opposition Boy","reason":"out"}'::jsonb),
        (8, 'retire', NULL, NULL, NULL,          jsonb_build_object('batter', P_OUT, 'reason', 'out'))
      ) AS x(k, kind, bt, v, dis, pl);

    PERFORM _as(U_OWNER);
    SELECT coalesce(b.runs, 0) AS runs, coalesce(b.balls_faced, 0) AS balls, coalesce(b.fours, 0) AS fours,
           coalesce(b.sixes, 0) AS sixes INTO bat1 FROM player_batting_since(P_BAT, NULL) b;
    SELECT coalesce(w.runs_conceded, 0) AS runs, coalesce(w.legal_balls, 0) AS balls,
           coalesce(w.no_balls, 0) AS nb, coalesce(w.wickets, 0) AS wkts INTO bow1 FROM player_bowling_since(P_BOWL, NULL) w;
    d_bat1 := coalesce(player_dismissals_since(P_BAT, NULL), 0);
    d_out1 := coalesce(player_dismissals_since(P_OUT, NULL), 0);
    SELECT coalesce(sum(dismissals), 0) INTO d_all1 FROM player_dismissals;
    SELECT coalesce((SELECT matches FROM player_batting_career WHERE player_id = P_OUT), 0) INTO m_out1;
    SELECT coalesce(sum(wickets), 0) INTO bw1 FROM player_wicket_breakdown WHERE player_id = P_BOWL;
    SELECT coalesce(sum(dismissals) FILTER (WHERE dismissal = 'retired_out'), 0),
           coalesce(sum(dismissals) FILTER (WHERE dismissal = 'timed_out'), 0)
      INTO k_ro1, k_to1 FROM player_dismissal_breakdown WHERE player_id = P_BAT;
    SELECT coalesce(sum(dismissals), 0) INTO k_out1 FROM player_dismissal_breakdown
     WHERE player_id = P_OUT AND dismissal = 'timed_out';
    SELECT coalesce(i.runs, -1) AS runs, coalesce(i.balls_faced, -1) AS balls, coalesce(i.out, false) AS out
      INTO inn_out FROM player_innings i WHERE i.player_id = P_OUT AND i.match_id = M_HANDOVER AND i.innings = 0;

    -- (a) Whose runs: runsOffBat(). Only the no-ball hit for four is his.
    PERFORM _assert(bat1.runs - bat0.runs = 4,
      format('a no-ball''s byes / leg byes were credited to the batter: +%s runs, expected +4 (the no-ball off the bat only)', bat1.runs - bat0.runs));
    PERFORM _assert(bat1.fours - bat0.fours = 1 AND bat1.sixes - bat0.sixes = 0,
      format('a no-ball''s byes / leg byes were counted as the batter''s boundary: +%s fours, +%s sixes, expected +1, +0',
             bat1.fours - bat0.fours, bat1.sixes - bat0.sixes));
    -- (b) ...and every no-ball is still a ball he faced; the old W ball is one
    --     too; a retirement is not.
    PERFORM _assert(bat1.balls - bat0.balls = 4,
      format('balls faced moved by %s, expected 4 (three no-balls and the old W ball; no retirement)', bat1.balls - bat0.balls));
    -- (c) The bowler is debited a no-ball's penalty run and the runs off the
    --     bat, not its byes or leg byes (Law 21.15, db/52): 5 + 1 + 1; the
    --     old timed-out W ball is a legal ball of his and not his wicket; a
    --     retirement is no ball and nobody's wicket.
    PERFORM _assert(bow1.runs - bow0.runs = 7 AND bow1.nb - bow0.nb = 3,
      format('the bowler was charged %s runs for %s no-balls, expected 7 for 3 (a no-ball''s byes and leg byes are not his, db/52)',
             bow1.runs - bow0.runs, bow1.nb - bow0.nb));
    PERFORM _assert(bow1.balls - bow0.balls = 1 AND bow1.wkts - bow0.wkts = 0 AND bw1 - bw0 = 0,
      format('the bowler''s legal balls / wickets / wicket breakdown moved by %s / %s / %s, expected 1 / 0 / 0',
             bow1.balls - bow0.balls, bow1.wkts - bow0.wkts, bw1 - bw0));
    -- (d) A retirement marked W is a dismissal of payload.batter — beside the
    --     old W ball naming timed_out, which still is one.
    PERFORM _assert(d_bat1 - d_bat0 = 2,
      format('the batter''s dismissals moved by %s, expected 2 (the old timed-out W ball and a retirement marked W)', d_bat1 - d_bat0));
    PERFORM _assert(d_out1 - d_out0 = 1,
      format('a batter timed out without facing a ball has %s more dismissals, expected 1 (and the unmarked retire none)', d_out1 - d_out0));
    -- (e) Nobody else: a typed name is not a player, and an unmarked retire
    --     with reason out is not a wicket (retirementDismissal()).
    PERFORM _assert(d_all1 - d_all0 = 3,
      format('dismissals across every player moved by %s, expected 3', d_all1 - d_all0));
    -- (f) A timed-out batter played an innings: 0 (0), out.
    PERFORM _assert(inn_out.runs = 0 AND inn_out.balls = 0 AND inn_out.out,
      format('a batter timed out has no innings of 0 (0), out: %s',
             CASE WHEN inn_out.out IS NULL THEN 'no row' ELSE inn_out::text END));
    PERFORM _assert(m_out1 - m_out0 = 1,
      format('a batter timed out has %s more batting matches, expected 1', m_out1 - m_out0));
    -- (g) By method.
    PERFORM _assert(k_ro1 - k_ro0 = 1 AND k_to1 - k_to0 = 1 AND k_out1 - k_out0 = 1,
      format('the dismissal breakdown moved retired_out %s / timed_out %s / timed_out (never faced) %s, expected 1 / 1 / 1',
             k_ro1 - k_ro0, k_to1 - k_to0, k_out1 - k_out0));
  END;
  PERFORM set_config('app.device_id', '', true);

  -- ── 20. A wicket the free hit saved is no wicket in SQL (db/42) ─────
  -- The fold saves a batter dismissed off a free hit by a bowler's method
  -- (standsOnFreeHit); every SQL reader now asks ball_wicket_stands() the
  -- same question. One over, on the match §19 scores and with the pen §19
  -- claimed, then a handover. Deltas, read before and after, coalesced to a
  -- number: _assert() refuses a NULL. Each assertion's label names what it
  -- guards; each was run once, alone, against the pre-db/42 definition of
  -- what it names (or the rule broken the way it says) and failed.
  --
  --    k  delivery                      striker  the fold
  --    1  a dot                          BAT     (whatever came before, no free hit now)
  --    2  W bowled                       BAT     stands, the bowler's
  --    3  W caught                       BAT     stands, the bowler's
  --    4  no-ball                        BAT     free hit
  --    5  W lbw                          SAVE    SAVED — and it breaks the hat-trick
  --    6  no-ball                        SAVE    free hit
  --    7  wide                           SAVE    carries the free hit
  --    8  W stumped                      SAVE    SAVED
  --    9  no-ball                        BAT     free hit
  --   10  W run out                      BAT     stands on a free hit, not the bowler's
  --   11  no-ball                        BAT     ...taken back by
  --   12  void of 11                             so no free hit
  --   13  W bowled                       BAT     stands, the bowler's
  --   14  no-ball                        SAVE    free hit
  --   15  W hit wicket                   SAVE    SAVED (and consumes the free hit)
  --   16  W caught                       BAT     stands, the bowler's
  --
  -- Five wickets stand (2, 3, 10, 13, 16); four are the bowler's, so no
  -- five-for; three are saved, all SAVE's, who is not out. Before db/42 the
  -- SQL counted eight, seven of them the bowler's, a five-for, a hat-trick
  -- completed at k = 5, and SAVE out three times.
  PERFORM set_config('app.device_id', 'verify-040', true);
  DECLARE
    P_BAT  uuid := 'aaaaaaaa-0000-0000-0000-000000000006';  -- K Dlamini
    P_SAVE uuid := 'aaaaaaaa-0000-0000-0000-000000000012';  -- J Sithole: on strike for every saved ball
    P_BOWL uuid := 'bbbbbbbb-0000-0000-0000-000000000002';  -- K Botha
    live0 bigint; live1 bigint; all0 bigint; fig0 bigint; fig1 bigint; bow0 bigint; bow1 bigint;
    wb0 record; wb1 record; sv0 bigint; sv1 bigint; bt0 bigint; bt1 bigint; sk0 bigint; sk1 bigint;
    hat0 bigint; hat1 bigint; five0 int; five1 int; hn0 int; hn1 int; save_out boolean; save_faced bigint;
    x record;
  BEGIN
    PERFORM _as(U_OWNER);
    live0 := coalesce((SELECT wickets FROM match_live_score WHERE match_id = M_HANDOVER AND innings = 0), 0);
    all0  := coalesce((SELECT sum(wickets) FROM match_live_score WHERE match_id = M_HANDOVER), 0);
    fig0  := coalesce((SELECT wickets FROM bowler_innings_figures
                        WHERE player_id = P_BOWL AND match_id = M_HANDOVER AND innings = 0), 0);
    bow0  := coalesce((SELECT wickets FROM player_bowling_since(P_BOWL, NULL)), 0);
    SELECT coalesce(sum(wickets) FILTER (WHERE dismissal IN ('bowled', 'caught')), 0) AS mine,
           coalesce(sum(wickets) FILTER (WHERE dismissal IN ('lbw', 'stumped', 'hit_wicket')), 0) AS saved
      INTO wb0 FROM player_wicket_breakdown WHERE player_id = P_BOWL;
    sv0 := coalesce(player_dismissals_since(P_SAVE, NULL), 0);
    bt0 := coalesce(player_dismissals_since(P_BAT, NULL), 0);
    sk0 := coalesce((SELECT sum(dismissals) FROM player_dismissal_breakdown WHERE player_id = P_SAVE), 0);
    hat0 := (SELECT count(*) FROM bowler_hat_trick WHERE player_id = P_BOWL AND match_id = M_HANDOVER AND innings = 0);
    five0 := _count_milestones(P_BOWL, 'five_for', M_HANDOVER);
    hn0   := _count_milestones(P_BOWL, 'hat_trick', M_HANDOVER);

    -- One statement per delivery, as they arrive: the milestone trigger is
    -- AFTER ROW, and in one multi-row INSERT every row's trigger would see
    -- the whole over — the five-for below could never be reached at five.
    PERFORM _as(U_SCORER);
    FOR x IN SELECT * FROM (VALUES
        ( 1, 'ball', 'run', NULL,         'bat',  '{}'::jsonb),
        ( 2, 'ball', 'W',   'bowled',     'bat',  '{}'::jsonb),
        ( 3, 'ball', 'W',   'caught',     'bat',  '{}'::jsonb),
        ( 4, 'ball', 'Nb',  NULL,         'bat',  '{}'::jsonb),
        ( 5, 'ball', 'W',   'lbw',        'save', '{}'::jsonb),
        ( 6, 'ball', 'Nb',  NULL,         'save', '{}'::jsonb),
        ( 7, 'ball', 'Wd',  NULL,         'save', '{}'::jsonb),
        ( 8, 'ball', 'W',   'stumped',    'save', '{}'::jsonb),
        ( 9, 'ball', 'Nb',  NULL,         'bat',  '{}'::jsonb),
        (10, 'ball', 'W',   'run_out',    'bat',  '{}'::jsonb),
        (11, 'ball', 'Nb',  NULL,         'bat',  '{}'::jsonb),
        (12, 'void', NULL,  NULL,         NULL,   '{"target":"verify:042:11"}'::jsonb),
        (13, 'ball', 'W',   'bowled',     'bat',  '{}'::jsonb),
        (14, 'ball', 'Nb',  NULL,         'save', '{}'::jsonb),
        (15, 'ball', 'W',   'hit_wicket', 'save', '{}'::jsonb),
        (16, 'ball', 'W',   'caught',     'bat',  '{}'::jsonb)
      ) AS v(k, kind, bt, dis, who, pl) ORDER BY k
    LOOP
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value,
                              striker_id, bowler_id, dismissal, payload)
      VALUES (M_HANDOVER, match_school(M_HANDOVER), 9500 + x.k, v_epoch, 0, U_SCORER, 'verify-040',
              'verify:042:' || x.k, 9500 + x.k, now(), x.kind, x.bt, CASE WHEN x.kind = 'ball' THEN 0 END,
              CASE x.who WHEN 'bat' THEN P_BAT WHEN 'save' THEN P_SAVE END,
              CASE WHEN x.kind = 'ball' THEN P_BOWL END, x.dis, x.pl);
    END LOOP;

    PERFORM _as(U_OWNER);
    live1 := coalesce((SELECT wickets FROM match_live_score WHERE match_id = M_HANDOVER AND innings = 0), 0);
    fig1  := coalesce((SELECT wickets FROM bowler_innings_figures
                        WHERE player_id = P_BOWL AND match_id = M_HANDOVER AND innings = 0), 0);
    bow1  := coalesce((SELECT wickets FROM player_bowling_since(P_BOWL, NULL)), 0);
    SELECT coalesce(sum(wickets) FILTER (WHERE dismissal IN ('bowled', 'caught')), 0) AS mine,
           coalesce(sum(wickets) FILTER (WHERE dismissal IN ('lbw', 'stumped', 'hit_wicket')), 0) AS saved
      INTO wb1 FROM player_wicket_breakdown WHERE player_id = P_BOWL;
    sv1 := coalesce(player_dismissals_since(P_SAVE, NULL), 0);
    bt1 := coalesce(player_dismissals_since(P_BAT, NULL), 0);
    sk1 := coalesce((SELECT sum(dismissals) FROM player_dismissal_breakdown WHERE player_id = P_SAVE), 0);
    hat1 := (SELECT count(*) FROM bowler_hat_trick WHERE player_id = P_BOWL AND match_id = M_HANDOVER AND innings = 0);
    five1 := _count_milestones(P_BOWL, 'five_for', M_HANDOVER);
    hn1   := _count_milestones(P_BOWL, 'hat_trick', M_HANDOVER);
    SELECT coalesce(i.out, true), coalesce(i.balls_faced, 0) INTO save_out, save_faced
      FROM player_innings i WHERE i.player_id = P_SAVE AND i.match_id = M_HANDOVER AND i.innings = 0;

    -- (rule) The fold's flag, ball by ball: wides carry it, a void takes its
    -- no-ball away, a legal ball consumes it, a no-ball earns it.
    PERFORM _assert(ball_on_free_hit(M_HANDOVER, 0::smallint, 9505) AND ball_on_free_hit(M_HANDOVER, 0::smallint, 9510)
                    AND ball_on_free_hit(M_HANDOVER, 0::smallint, 9515),
      'db/42 (rule): a ball straight after a no-ball is not on a free hit');
    -- (rule-wide)
    PERFORM _assert(coalesce(ball_on_free_hit(M_HANDOVER, 0::smallint, 9508), false),
      'db/42 (rule-wide): a wide did not carry the free hit to the next ball');
    -- (rule-void)
    PERFORM _assert(NOT coalesce(ball_on_free_hit(M_HANDOVER, 0::smallint, 9513), true),
      'db/42 (rule-void): a no-ball that was taken back still earned a free hit');
    -- (rule-consumed)
    PERFORM _assert(NOT coalesce(ball_on_free_hit(M_HANDOVER, 0::smallint, 9516), true)
                    AND NOT coalesce(ball_on_free_hit(M_HANDOVER, 0::smallint, 9502), true),
      'db/42 (rule-consumed): a legal ball did not consume the free hit');
    -- (rule-methods) Only the six non-delivery methods stand; a NULL method does not.
    PERFORM _assert((SELECT bool_and(dismissal_stands_on_free_hit(d) = (d IN ('run_out', 'handled_ball', 'obstructing_field',
                                                                                'timed_out', 'retired_out', 'hit_twice')))
                       FROM unnest(ARRAY['bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'handled_ball',
                                         'obstructing_field', 'timed_out', 'retired_out', 'hit_twice']) d)
                    AND dismissal_stands_on_free_hit(NULL) IS NOT DISTINCT FROM false,
      'db/42 (rule-methods): the methods that stand on a free hit are not events.mjs NON_DELIVERY');
    -- (a) match_live_score
    PERFORM _assert(live1 - live0 = 5,
      format('db/42 (a) match_live_score: wickets moved by %s, expected 5 (three were saved by the free hit)', live1 - live0));
    -- (c) bowler_innings_figures
    PERFORM _assert(fig1 - fig0 = 4,
      format('db/42 (c) bowler_innings_figures: the bowler''s wickets moved by %s, expected 4', fig1 - fig0));
    -- (d) player_bowling_since
    PERFORM _assert(bow1 - bow0 = 4,
      format('db/42 (d) player_bowling_since: the bowler''s career wickets moved by %s, expected 4', bow1 - bow0));
    -- (e) player_wicket_breakdown
    PERFORM _assert(wb1.mine - wb0.mine = 4 AND wb1.saved - wb0.saved = 0,
      format('db/42 (e) player_wicket_breakdown: bowled/caught moved by %s, lbw/stumped/hit wicket by %s, expected 4 and 0',
             wb1.mine - wb0.mine, wb1.saved - wb0.saved));
    -- (f) player_dismissals_since
    PERFORM _assert(sv1 - sv0 = 0 AND bt1 - bt0 = 5,
      format('db/42 (f) player_dismissals_since: the saved batter''s dismissals moved by %s (expected 0), the other''s by %s (expected 5)',
             sv1 - sv0, bt1 - bt0));
    -- (g) player_dismissal_breakdown
    PERFORM _assert(sk1 - sk0 = 0,
      format('db/42 (g) player_dismissal_breakdown: the saved batter has %s more lines of how he got out, expected 0', sk1 - sk0));
    -- (h) player_innings
    PERFORM _assert(save_faced >= 5 AND NOT save_out,
      format('db/42 (h) player_innings: the batter every free hit saved reads out=%s after %s balls faced', save_out, save_faced));
    -- (i) bowler_hat_trick
    PERFORM _assert(hat1 - hat0 = 0,
      format('db/42 (i) bowler_hat_trick: a hat-trick completed by a saved ball (%s new)', hat1 - hat0));
    -- (j) the five-for notice (milestone_watch over bowler_innings_figures)
    PERFORM _assert(five1 - five0 = 0,
      format('db/42 (j) milestone five_for: announced for four wickets and three saved balls (%s)', five1 - five0));
    -- (k) the hat-trick notice (milestone_watch and bowler_hat_trick)
    PERFORM _assert(hn1 - hn0 = 0,
      format('db/42 (k) milestone hat_trick: announced for a saved ball (%s)', hn1 - hn0));

    -- (b) scoring_verify_takeover: the pen goes to Sarah, who states the
    -- fold's count — five more wickets — and the server expects the same.
    PERFORM _as(U_SCORER);
    SELECT a.code INTO v_code FROM scoring_arm_handover(M_HANDOVER, 'verify-040', 0, false) a;
    PERFORM _assert(v_code IS NOT NULL, 'db/42: the scorer could not arm a handover after the free-hit over');
    PERFORM _as(U_SARAH);
    SELECT h.ok INTO v_ok FROM scoring_claim_handover(M_HANDOVER, 'verify-042-b', v_code) h;
    PERFORM _assert(v_ok, 'db/42: Sarah could not claim the handover after the free-hit over');
    SELECT v.exp_runs, v.exp_wkts, v.exp_balls INTO v_runs, v_wkts, v_balls
      FROM scoring_verify_takeover(M_HANDOVER, 'verify-042-b', -1, -1, -1) v;
    -- (b) scoring_verify_takeover
    PERFORM _assert(v_wkts - all0 = 5,
      format('db/42 (b) scoring_verify_takeover: expects %s more wickets than before the over, the fold says 5 — the handover could never verify',
             v_wkts - all0));
    SELECT v.ok INTO v_ok FROM scoring_verify_takeover(M_HANDOVER, 'verify-042-b', v_runs, all0::int + 5, v_balls) v;
    -- (b) scoring_verify_takeover
    PERFORM _assert(v_ok, 'db/42 (b) scoring_verify_takeover: the fold''s count did not verify after a saved wicket');
  END;
  PERFORM set_config('app.device_id', '', true);

  -- ── 21. The last places SQL disagreed with the fold (db/43) ─────────
  -- Who is out is the fold's `dismissed ?? striker`; the opposition's balls
  -- faced, boundaries and runs conceded are the fold's; a ball with no type
  -- is a run and a wicket with no method is nobody's; and a new row of either
  -- shape is refused at the door. Eleven balls written live on the match §19
  -- and §20 score, under a fresh claim, then two legacy rows written past the
  -- door as the owner. Figures read before, after the live balls ("mid") and
  -- after the legacy rows, as deltas, coalesced to a number: _assert()
  -- refuses a NULL. Each assertion's label names what it guards; each was run
  -- once, alone, against the definitions db/43 replaced (a database at db/42)
  -- — (rule) against db/13's dismissal_is_bowlers() — and failed.
  --
  --    k  delivery                        striker  who is out       the fold
  --    1  W run out, none run             S1       N0               N0: an innings of 0 (0), out
  --    2  W run out, 1 run, bowler's end  S1       NF               NF out, having faced §20's over
  --    3  W run out, none run             S1       a typed name     nobody here; S1 not out
  --    4  no-ball, 4 off the bat          MK                        his four, a ball faced; 5 to BO
  --    5  no-ball, 4 byes                 MK                        no four, a ball faced; 1 to BO (db/52)
  --    6  no-ball, 6 leg byes             MK                        no six, a ball faced; 1 to BO (db/52)
  --    7  wide, 4 run                     MK                        no ball faced, no four; 5 to BO
  --    8  4 byes                          MK                        a ball faced, no four; 0 to BO
  --    9  4 leg byes                      MK                        a ball faced, no four; 0 to BO
  --   10  6                               MK                        his six
  --   11  wide                            MK                        1 to BO
  --      ── mid ──
  --   12  NO TYPE, 3 (legacy)             MK                        a run: a legal ball, 3 to him and BO
  --   13  W, NO METHOD (legacy)           MK                        MK out; nobody's wicket
  --
  -- Before db/43: N0 had no innings, NF read not out, S1 read out (the typed
  -- name filed against him); MK had faced 3 balls with 4 fours, BO conceded
  -- 25; the no-type ball was no legal ball and nobody's runs; the wicket with
  -- no method was BO's; and either could be written anew.
  PERFORM _scoring_session_reset(M_HANDOVER);
  PERFORM _as(U_SCORER);
  PERFORM set_config('app.device_id', 'verify-043', true);
  SELECT c.ok, c.epoch INTO v_ok, v_epoch FROM scoring_claim(M_HANDOVER, 'verify-043') c;
  PERFORM _assert(v_ok, 'the scorer could not claim the match the db/43 section scores');
  DECLARE
    S1 uuid := 'aaaaaaaa-0000-0000-0000-000000000002';  -- T Bekker: on strike for three run outs at the other end
    N0 uuid := 'aaaaaaaa-0000-0000-0000-000000000013';  -- B Khumalo: run out at the far end, never faced a ball
    NF uuid := 'aaaaaaaa-0000-0000-0000-000000000012';  -- J Sithole: faced §20's over, not out, run out here
    MK uuid := 'bbbbbbbb-0000-0000-0000-000000000001';  -- D Mkhize, Westville: the opposition's batter
    BO uuid := 'bbbbbbbb-0000-0000-0000-000000000002';  -- K Botha, Westville: the opposition's bowler
    M_OPP uuid;
    x record; v_con text;
    i_n0 record; i_nf record; i_s1 record;
    d_n0_0 bigint; d_nf_0 bigint; d_s1_0 bigint; d_n0_1 bigint; d_nf_1 bigint; d_s1_1 bigint;
    k_n0_0 bigint; k_nf_0 bigint; k_s1_0 bigint; k_n0_1 bigint; k_nf_1 bigint; k_s1_1 bigint;
    m_n0_0 bigint; m_n0_1 bigint; b_s1_0 record; b_s1_1 record;
    o0 record; o1 record; o2 record;   -- the opposition's figures (MK batting, BO bowling): before, mid, after
    l1 record; l2 record;               -- match_live_score, innings 0: mid, after
    w1 record; w2 record;               -- player_bowling_since(BO): mid, after
    f1 record; f2 record;               -- bowler_innings_figures(BO, this innings): mid, after
    wb1 bigint; wb2 bigint;             -- BO's wicket breakdown, method not recorded: mid, after
  BEGIN
    -- A day inside the window, whatever the window is: this section is about
    -- the figures the squad read returns, and §24 about when it opens.
    M_OPP := _opposition_fixture(opposition_window_days() - 1);
    PERFORM _as(U_OWNER);
    d_n0_0 := coalesce(player_dismissals_since(N0, NULL), 0);
    d_nf_0 := coalesce(player_dismissals_since(NF, NULL), 0);
    d_s1_0 := coalesce(player_dismissals_since(S1, NULL), 0);
    k_n0_0 := coalesce((SELECT sum(dismissals) FROM player_dismissal_breakdown WHERE player_id = N0 AND dismissal = 'run_out'), 0);
    k_nf_0 := coalesce((SELECT sum(dismissals) FROM player_dismissal_breakdown WHERE player_id = NF AND dismissal = 'run_out'), 0);
    k_s1_0 := coalesce((SELECT sum(dismissals) FROM player_dismissal_breakdown WHERE player_id = S1), 0);
    m_n0_0 := coalesce((SELECT matches FROM player_batting_since(N0, NULL)), 0);
    SELECT coalesce(max(b.runs), 0) AS runs, coalesce(max(b.balls_faced), 0) AS balls INTO b_s1_0 FROM player_batting_since(S1, NULL) b;
    SELECT coalesce(max(o.balls) FILTER (WHERE o.player_id = MK), 0) AS balls,
           coalesce(max(o.runs) FILTER (WHERE o.player_id = MK), 0) AS runs,
           coalesce(max(o.fours) FILTER (WHERE o.player_id = MK), 0) AS fours,
           coalesce(max(o.sixes) FILTER (WHERE o.player_id = MK), 0) AS sixes,
           coalesce(max(o.dismissals) FILTER (WHERE o.player_id = MK), 0) AS dismissals,
           coalesce(max(o.balls_bowled) FILTER (WHERE o.player_id = BO), 0) AS balls_bowled,
           coalesce(max(o.runs_conceded) FILTER (WHERE o.player_id = BO), 0) AS runs_conceded,
           coalesce(max(o.wickets) FILTER (WHERE o.player_id = BO), 0) AS wickets,
           count(*) FILTER (WHERE o.player_id IN (MK, BO)) AS seen
      INTO o0 FROM opposition_squad(M_OPP) o;
    PERFORM _assert(o0.seen = 2, 'db/43: the opposition''s squad could not be read for the section''s fixture');

    -- One statement per delivery, as they arrive (the milestone trigger is AFTER ROW).
    PERFORM _as(U_SCORER);
    FOR x IN SELECT * FROM (VALUES
        ( 1, 'W',   0, 'S1', 'N0', 'run_out', '{}'::jsonb),
        ( 2, 'W',   1, 'S1', 'NF', 'run_out', '{"outAt":"bowler_end"}'::jsonb),
        ( 3, 'W',   0, 'S1', NULL, 'run_out', '{"dismissed":"A Typed Boy"}'::jsonb),
        ( 4, 'Nb',  4, 'MK', NULL, NULL,      '{}'::jsonb),
        ( 5, 'Nb',  4, 'MK', NULL, NULL,      '{"nbRuns":"byes"}'::jsonb),
        ( 6, 'Nb',  6, 'MK', NULL, NULL,      '{"nbRuns":"leg_byes"}'::jsonb),
        ( 7, 'Wd',  4, 'MK', NULL, NULL,      '{}'::jsonb),
        ( 8, 'B',   4, 'MK', NULL, NULL,      '{}'::jsonb),
        ( 9, 'LB',  4, 'MK', NULL, NULL,      '{}'::jsonb),
        (10, 'run', 6, 'MK', NULL, NULL,      '{}'::jsonb),
        (11, 'Wd',  0, 'MK', NULL, NULL,      '{}'::jsonb)
      ) AS v(k, bt, val, who, outp, dis, pl) ORDER BY k
    LOOP
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value,
                              striker_id, bowler_id, dismissed_id, dismissal, payload)
      VALUES (M_HANDOVER, match_school(M_HANDOVER), 9600 + x.k, v_epoch, 0, U_SCORER, 'verify-043',
              'verify:043:' || x.k, 9600 + x.k, now(), 'ball', x.bt, x.val,
              CASE x.who WHEN 'S1' THEN S1 WHEN 'MK' THEN MK END, BO,
              CASE x.outp WHEN 'N0' THEN N0 WHEN 'NF' THEN NF END, x.dis, x.pl);
    END LOOP;

    PERFORM _as(U_OWNER);
    d_n0_1 := coalesce(player_dismissals_since(N0, NULL), 0);
    d_nf_1 := coalesce(player_dismissals_since(NF, NULL), 0);
    d_s1_1 := coalesce(player_dismissals_since(S1, NULL), 0);
    k_n0_1 := coalesce((SELECT sum(dismissals) FROM player_dismissal_breakdown WHERE player_id = N0 AND dismissal = 'run_out'), 0);
    k_nf_1 := coalesce((SELECT sum(dismissals) FROM player_dismissal_breakdown WHERE player_id = NF AND dismissal = 'run_out'), 0);
    k_s1_1 := coalesce((SELECT sum(dismissals) FROM player_dismissal_breakdown WHERE player_id = S1), 0);
    m_n0_1 := coalesce((SELECT matches FROM player_batting_since(N0, NULL)), 0);
    SELECT coalesce(max(b.runs), 0) AS runs, coalesce(max(b.balls_faced), 0) AS balls INTO b_s1_1 FROM player_batting_since(S1, NULL) b;
    SELECT true AS found, i.runs, i.balls_faced AS balls, i.out INTO i_n0
      FROM player_innings i WHERE i.player_id = N0 AND i.match_id = M_HANDOVER AND i.innings = 0;
    SELECT true AS found, i.runs, i.balls_faced AS balls, i.out INTO i_nf
      FROM player_innings i WHERE i.player_id = NF AND i.match_id = M_HANDOVER AND i.innings = 0;
    SELECT true AS found, i.runs, i.balls_faced AS balls, i.out INTO i_s1
      FROM player_innings i WHERE i.player_id = S1 AND i.match_id = M_HANDOVER AND i.innings = 0;
    SELECT coalesce(max(o.balls) FILTER (WHERE o.player_id = MK), 0) AS balls,
           coalesce(max(o.runs) FILTER (WHERE o.player_id = MK), 0) AS runs,
           coalesce(max(o.fours) FILTER (WHERE o.player_id = MK), 0) AS fours,
           coalesce(max(o.sixes) FILTER (WHERE o.player_id = MK), 0) AS sixes,
           coalesce(max(o.dismissals) FILTER (WHERE o.player_id = MK), 0) AS dismissals,
           coalesce(max(o.balls_bowled) FILTER (WHERE o.player_id = BO), 0) AS balls_bowled,
           coalesce(max(o.runs_conceded) FILTER (WHERE o.player_id = BO), 0) AS runs_conceded,
           coalesce(max(o.wickets) FILTER (WHERE o.player_id = BO), 0) AS wickets
      INTO o1 FROM opposition_squad(M_OPP) o;
    SELECT coalesce(max(legal_balls), 0) AS balls, coalesce(max(runs), 0) AS runs, coalesce(max(wickets), 0) AS wickets
      INTO l1 FROM match_live_score WHERE match_id = M_HANDOVER AND innings = 0;
    SELECT coalesce(max(w.runs_conceded), 0) AS runs, coalesce(max(w.legal_balls), 0) AS balls,
           coalesce(max(w.wickets), 0) AS wickets INTO w1 FROM player_bowling_since(BO, NULL) w;
    SELECT coalesce(max(f.wickets), 0) AS wickets, coalesce(max(f.runs_conceded), 0) AS runs
      INTO f1 FROM bowler_innings_figures f WHERE f.player_id = BO AND f.match_id = M_HANDOVER AND f.innings = 0;
    wb1 := coalesce((SELECT sum(wickets) FROM player_wicket_breakdown WHERE player_id = BO AND dismissal IS NULL), 0);

    -- The legacy rows: what a database stored before the door.
    PERFORM _insert_past_the_door(jsonb_build_array(
      jsonb_build_object('match_id', M_HANDOVER, 'seq', 9612, 'epoch', v_epoch, 'innings', 0, 'scorer_user_id', U_SCORER,
                         'device_id', 'verify-043', 'idempotency_key', 'verify:043:12', 'client_seq', 9612,
                         'kind', 'ball', 'ball_type', NULL, 'value', 3, 'striker_id', MK, 'bowler_id', BO),
      jsonb_build_object('match_id', M_HANDOVER, 'seq', 9613, 'epoch', v_epoch, 'innings', 0, 'scorer_user_id', U_SCORER,
                         'device_id', 'verify-043', 'idempotency_key', 'verify:043:13', 'client_seq', 9613,
                         'kind', 'ball', 'ball_type', 'W', 'value', 0, 'striker_id', MK, 'bowler_id', BO, 'dismissal', NULL)));

    SELECT coalesce(max(o.balls) FILTER (WHERE o.player_id = MK), 0) AS balls,
           coalesce(max(o.runs) FILTER (WHERE o.player_id = MK), 0) AS runs,
           coalesce(max(o.dismissals) FILTER (WHERE o.player_id = MK), 0) AS dismissals,
           coalesce(max(o.balls_bowled) FILTER (WHERE o.player_id = BO), 0) AS balls_bowled,
           coalesce(max(o.runs_conceded) FILTER (WHERE o.player_id = BO), 0) AS runs_conceded,
           coalesce(max(o.wickets) FILTER (WHERE o.player_id = BO), 0) AS wickets
      INTO o2 FROM opposition_squad(M_OPP) o;
    SELECT coalesce(max(legal_balls), 0) AS balls, coalesce(max(runs), 0) AS runs, coalesce(max(wickets), 0) AS wickets
      INTO l2 FROM match_live_score WHERE match_id = M_HANDOVER AND innings = 0;
    SELECT coalesce(max(w.runs_conceded), 0) AS runs, coalesce(max(w.legal_balls), 0) AS balls,
           coalesce(max(w.wickets), 0) AS wickets INTO w2 FROM player_bowling_since(BO, NULL) w;
    SELECT coalesce(max(f.wickets), 0) AS wickets, coalesce(max(f.runs_conceded), 0) AS runs
      INTO f2 FROM bowler_innings_figures f WHERE f.player_id = BO AND f.match_id = M_HANDOVER AND f.innings = 0;
    wb2 := coalesce((SELECT sum(wickets) FROM player_wicket_breakdown WHERE player_id = BO AND dismissal IS NULL), 0);

    -- (a) player_innings: the non-striker run out before he faced a ball
    PERFORM _assert(coalesce(i_n0.found AND i_n0.runs = 0 AND i_n0.balls = 0 AND i_n0.out, false),
      format('db/43 (a) player_innings: a batter run out at the non-striker''s end before he faced a ball has no innings of 0 (0), out: %s',
             CASE WHEN i_n0.found IS NULL THEN 'no row' ELSE i_n0::text END));
    -- (b) player_innings: the non-striker run out after facing
    PERFORM _assert(coalesce(i_nf.found AND i_nf.balls >= 1 AND i_nf.out, false),
      format('db/43 (b) player_innings: a batter run out at the non-striker''s end after facing %s ball(s) reads out=%s',
             coalesce(i_nf.balls::text, 'no'), coalesce(i_nf.out::text, 'no row')));
    -- (c) player_innings: the striker of those balls
    PERFORM _assert(coalesce(i_s1.found AND i_s1.runs = 1 AND i_s1.balls = 3 AND NOT i_s1.out, false),
      format('db/43 (c) player_innings: the striker of three run outs at the other end — one of a batter SCRBRD holds no row for — reads %s, expected 1 (3), not out',
             CASE WHEN i_s1.found IS NULL THEN 'no row' ELSE i_s1::text END));
    -- (d) player_dismissals_since
    PERFORM _assert(d_n0_1 - d_n0_0 = 1 AND d_nf_1 - d_nf_0 = 1 AND d_s1_1 - d_s1_0 = 0,
      format('db/43 (d) player_dismissals_since: dismissals moved by %s (never faced), %s (had faced), %s (the striker); expected 1, 1, 0',
             d_n0_1 - d_n0_0, d_nf_1 - d_nf_0, d_s1_1 - d_s1_0));
    -- (e) player_dismissal_breakdown
    PERFORM _assert(k_n0_1 - k_n0_0 = 1 AND k_nf_1 - k_nf_0 = 1 AND k_s1_1 - k_s1_0 = 0,
      format('db/43 (e) player_dismissal_breakdown: run-out lines moved by %s and %s, the striker''s by %s; expected 1, 1, 0',
             k_n0_1 - k_n0_0, k_nf_1 - k_nf_0, k_s1_1 - k_s1_0));
    -- (f) player_batting_since
    PERFORM _assert(m_n0_1 - m_n0_0 = 1 AND b_s1_1.runs - b_s1_0.runs = 1 AND b_s1_1.balls - b_s1_0.balls = 3,
      format('db/43 (f) player_batting_since: the batter run out before facing has %s more batting matches (expected 1); the striker %s more runs off %s more balls (expected 1 off 3)',
             m_n0_1 - m_n0_0, b_s1_1.runs - b_s1_0.runs, b_s1_1.balls - b_s1_0.balls));
    -- (g) opposition_squad: balls faced
    PERFORM _assert(o1.balls - o0.balls = 6,
      format('db/43 (g) opposition_squad balls: the batter faced %s more balls, expected 6 (three no-balls, a bye, a leg bye, a six; not the wides)',
             o1.balls - o0.balls));
    -- (h) opposition_squad: fours and sixes
    PERFORM _assert(o1.fours - o0.fours = 1 AND o1.sixes - o0.sixes = 1 AND o1.runs - o0.runs = 10,
      format('db/43 (h) opposition_squad fours/sixes: %s fours, %s sixes and %s runs more, expected 1, 1 and 10 (off the bat only: no byes, leg byes, wide or no-ball byes to the rope)',
             o1.fours - o0.fours, o1.sixes - o0.sixes, o1.runs - o0.runs));
    -- (i) opposition_squad: runs conceded
    PERFORM _assert(o1.runs_conceded - o0.runs_conceded = 20 AND o1.balls_bowled - o0.balls_bowled = 6,
      format('db/43 (i) opposition_squad runs_conceded: the bowler conceded %s more off %s more balls, expected 20 off 6 (a wide is the penalty run and every run off it; a no-ball the penalty run and the runs off the bat, not its byes or leg byes, db/52)',
             o1.runs_conceded - o0.runs_conceded, o1.balls_bowled - o0.balls_bowled));
    -- (j) match_live_score: the legacy rows
    PERFORM _assert(l2.balls - l1.balls = 2 AND l2.runs - l1.runs = 3 AND l2.wickets - l1.wickets = 1,
      format('db/43 (j) match_live_score: a ball with no type and a wicket with no method moved the legal balls / runs / wickets by %s / %s / %s; expected 2 / 3 / 1',
             l2.balls - l1.balls, l2.runs - l1.runs, l2.wickets - l1.wickets));
    -- (k) player_bowling_since: the legacy rows
    PERFORM _assert(w2.runs - w1.runs = 3 AND w2.balls - w1.balls = 2 AND w2.wickets - w1.wickets = 0,
      format('db/43 (k) player_bowling_since: the legacy rows moved the bowler''s runs / legal balls / wickets by %s / %s / %s; expected 3 / 2 / 0',
             w2.runs - w1.runs, w2.balls - w1.balls, w2.wickets - w1.wickets));
    -- (l) bowler_innings_figures: the legacy rows
    PERFORM _assert(f2.wickets - f1.wickets = 0 AND f2.runs - f1.runs = 3,
      format('db/43 (l) bowler_innings_figures: the legacy rows moved the bowler''s wickets / runs in the innings by %s / %s; expected 0 / 3',
             f2.wickets - f1.wickets, f2.runs - f1.runs));
    -- (m) player_wicket_breakdown: the legacy wicket
    PERFORM _assert(wb2 - wb1 = 0,
      format('db/43 (m) player_wicket_breakdown: a wicket with no method was filed as the bowler''s (%s more)', wb2 - wb1));
    -- (n) opposition_squad: the legacy rows
    PERFORM _assert(o2.balls - o1.balls = 2 AND o2.runs - o1.runs = 3 AND o2.dismissals - o1.dismissals = 0
                    AND o2.balls_bowled - o1.balls_bowled = 2 AND o2.runs_conceded - o1.runs_conceded = 3
                    AND o2.wickets - o1.wickets = 0,
      format('db/43 (n) opposition_squad: the legacy rows moved the batter''s balls / runs / dismissals by %s / %s / %s (expected 2 / 3 / 0) and the bowler''s balls / runs / wickets by %s / %s / %s (expected 2 / 3 / 0)',
             o2.balls - o1.balls, o2.runs - o1.runs, o2.dismissals - o1.dismissals,
             o2.balls_bowled - o1.balls_bowled, o2.runs_conceded - o1.runs_conceded, o2.wickets - o1.wickets));
    -- (rule) the rules themselves
    PERFORM _assert(dismissal_is_bowlers(NULL) IS NOT DISTINCT FROM false
                    AND dismissal_stands_on_free_hit(NULL) IS NOT DISTINCT FROM false
                    AND ball_type_as_folded('ball', NULL) IS NOT DISTINCT FROM 'run'
                    AND ball_type_as_folded('retire', NULL) IS NULL
                    AND ball_dismissed_batter(S1, NULL, '{"dismissed":"A Typed Boy"}'::jsonb) IS NULL
                    AND ball_dismissed_batter(S1, NULL, '{}'::jsonb) IS NOT DISTINCT FROM S1
                    AND ball_dismissed_batter(S1, N0, '{}'::jsonb) IS NOT DISTINCT FROM N0,
      'db/43 (rule): a wicket with no method is the bowler''s or stands on a free hit, a ball with no type is not a run, or who is out is not `dismissed ?? striker`');

    -- (door-type) and (door-method): a client that writes either now is
    -- refused by the table itself, whoever it is — 23514, naming the rule,
    -- as a CHECK would (db/43's trigger).
    PERFORM _as(U_SCORER);
    v_con := NULL;
    BEGIN
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id)
      VALUES (M_HANDOVER, match_school(M_HANDOVER), 9620, v_epoch, 0, U_SCORER, 'verify-043',
              'verify:043:door-type', 9620, now(), 'ball', NULL, 1, MK, BO);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    END;
    -- (door-type)
    PERFORM _assert(v_con IS NOT DISTINCT FROM 'ball_event_ball_has_type',
      format('db/43 (door-type): a new ball with no type was %s', coalesce('refused by ' || v_con, 'written')));
    v_con := NULL;
    BEGIN
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id)
      VALUES (M_HANDOVER, match_school(M_HANDOVER), 9621, v_epoch, 0, U_SCORER, 'verify-043',
              'verify:043:door-method', 9621, now(), 'ball', 'W', 0, MK, BO);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    END;
    -- (door-method)
    PERFORM _assert(v_con IS NOT DISTINCT FROM 'ball_event_wicket_has_method',
      format('db/43 (door-method): a new wicket ball with no method was %s', coalesce('refused by ' || v_con, 'written')));
  END;
  PERFORM set_config('app.device_id', '', true);

  -- ── 22. Career figures by season (SCRBRD-086, db/44) ───────────────
  -- The season views are the lifetime views one grain finer: grouped by the
  -- school season each match is in, on the Johannesburg calendar, and read
  -- as the caller. _seed_44() (above) writes the fixture: three Hilton 2XI
  -- matches — 2025, New Year (23:30 UTC on 31 December 2025), 2026 — of the
  -- same fifteen events, and a Westville match in 2024 with one delivery by
  -- a Hilton boy. The log by now also holds everything sections 19 and 20
  -- wrote (no-ball byes, retirements, free-hit saves, a void), so the
  -- invariant below runs over those rules too. Every figure is compared as
  -- a row or a count: _assert() refuses a NULL, so a missing row fails
  -- rather than passing. Each assertion's label names what it guards; each
  -- was run once, alone (every other db/44 assertion switched off), with
  -- db/44 broken the way this table says, and failed for that reason:
  --
  --   (a)   a season view without security_invoker; and one run as its owner
  --         over ball_event itself (an unidentified session read 11 rows)
  --   (b)   a season view without security_invoker (the Westville reader
  --         saw the Hilton boy's row)
  --   (c)   school_season_of() on the UTC date (New Year filed in 2025)
  --   (d1)  batting runs and fours by `value`, as before db/40
  --   (d2)  a delivery with no ball type counted as a ball faced (before
  --         db/43; since db/43 it IS a run and a ball faced, as the fold
  --         reads it, and (d2) holds that — db/43's §21 falsifies it)
  --   (d3)  the dismissals view without ball_wicket_stands()
  --   (d4)  the bowling view without ball_wicket_stands()
  --   (e0)  one Hilton-fixture delivery stamped with Westville's school
  --   (e)   one reader's composition drifting (a NULL ball type counted as
  --         a legal ball); the retirement branch dropped; deliveries counted
  --         as matches; and every match in one season, for the span check
  PERFORM _seed_44();
  DECLARE
    P44_A  uuid := 'aaaaaaaa-0000-0000-0000-00000000044a';  -- on strike
    P44_B  uuid := 'aaaaaaaa-0000-0000-0000-00000000044b';  -- the other end
    P44_C  uuid := 'aaaaaaaa-0000-0000-0000-00000000044c';  -- bowling; once at Westville
    M44_NY uuid := '77777777-0000-0000-0000-0000000440e0';  -- 01:30 on 1 January 2026, Johannesburg
    who    uuid;
    x      record;
    y      record;
    n      bigint;
    n2     bigint;
    n3     bigint;
    n4     bigint;
    detail text;
  BEGIN
    -- (a) Every season view runs as its caller, and so reads nothing for a
    --     session that is nobody. The catalog is asked as well as the rows:
    --     a view that lost security_invoker would still read DELIVERIES as
    --     its caller — it reaches them through ball_event_live, which is
    --     invoker — while reading match and player as its owner, past their
    --     policies. No row count here can see that; (b) is what it looks
    --     like from the other school.
    SELECT count(*) INTO n3 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'v'
       AND c.relname IN ('player_batting_by_season', 'player_bowling_by_season', 'player_dismissals_by_season')
       AND 'security_invoker=true' = ANY (c.reloptions);
    SELECT count(*) INTO n4 FROM pg_proc p
     WHERE p.oid = to_regprocedure('school_season_of(timestamptz)') AND NOT p.prosecdef;
    PERFORM set_config('app.user_id', '', true);
    SELECT (SELECT count(*) FROM player_batting_by_season) + (SELECT count(*) FROM player_bowling_by_season)
         + (SELECT count(*) FROM player_dismissals_by_season) INTO n;
    PERFORM _as(U_OWNER);
    SELECT (SELECT count(*) FROM player_batting_by_season) + (SELECT count(*) FROM player_bowling_by_season)
         + (SELECT count(*) FROM player_dismissals_by_season) INTO n2;
    -- (a) nobody by default
    PERFORM _assert(n3 = 3 AND n4 = 1 AND n = 0 AND n2 > 0,
      format('db/44 (a) nobody by default: %s of the 3 season views are security_invoker and %s of 1 season function runs as its caller; '
             || 'an unidentified session read %s rows of career figures by season (the owner reads %s)', n3, n4, n, n2));

    -- (b) A coach at one school reads nothing of another's through them. The
    --     Westville fixture is in 2024, a season no Hilton fixture is in, and
    --     one of its deliveries is a Hilton boy's: a Hilton coach reads no
    --     2024 row at all — not his own boy's either, from a match he cannot
    --     read — and no Westville player; the Westville administrator reads
    --     his own boys' 2024 figures and nothing of Hilton's. The owner reads
    --     all of it, so none of this passes for want of a row.
    PERFORM _as(U_OWNER);
    SELECT count(*) INTO n FROM player_bowling_by_season WHERE player_id = P44_C AND season = '2024';
    PERFORM _as(U_COACH2);
    SELECT (SELECT count(*) FROM player_batting_by_season    WHERE season = '2024' OR player_id IN (P_WES, P_WES2))
         + (SELECT count(*) FROM player_bowling_by_season    WHERE season = '2024' OR player_id IN (P_WES, P_WES2))
         + (SELECT count(*) FROM player_dismissals_by_season WHERE season = '2024' OR player_id IN (P_WES, P_WES2))
      INTO n2;
    PERFORM _as(U_WES_ADM);
    SELECT (SELECT count(*) FROM player_batting_by_season    WHERE player_id = P_WES  AND season = '2024')
         + (SELECT count(*) FROM player_bowling_by_season    WHERE player_id = P_WES2 AND season = '2024')
         + (SELECT count(*) FROM player_dismissals_by_season WHERE player_id = P_WES  AND season = '2024')
      INTO n3;
    SELECT (SELECT count(*) FROM player_batting_by_season    WHERE player_id IN (P44_A, P44_B, P44_C))
         + (SELECT count(*) FROM player_bowling_by_season    WHERE player_id IN (P44_A, P44_B, P44_C))
         + (SELECT count(*) FROM player_dismissals_by_season WHERE player_id IN (P44_A, P44_B, P44_C))
      INTO n4;
    -- (b) school A sees nothing of school B
    PERFORM _assert(n = 1 AND n2 = 0 AND n3 = 3 AND n4 = 0,
      format('db/44 (b) school A sees nothing of school B: the owner reads %s 2024 row(s) for the Hilton boy who bowled at Westville (expected 1); '
             || 'the Hilton 2XI coach reads %s rows from Westville''s fixture or players (expected 0); '
             || 'the Westville administrator reads %s of his own boys'' three 2024 rows and %s of Hilton''s (expected 3 and 0)', n, n2, n3, n4));

    -- (c) The Johannesburg calendar: the New Year fixture is in 2026, though
    --     its UTC date is still 31 December 2025 — the fixture straddles the
    --     line, so this can tell the two rules apart. The matches read files
    --     it with the same function.
    PERFORM _as(U_SCORER);
    SELECT school_season_of(m.starts_at) AS season, (m.starts_at AT TIME ZONE 'UTC')::date AS utc_day
      INTO x FROM match m WHERE m.id = M44_NY;
    -- (c) the Johannesburg calendar
    PERFORM _assert(x.season = '2026' AND x.utc_day = date '2025-12-31',
      format('db/44 (c) the Johannesburg calendar: a fixture at 01:30 on 1 January 2026 in Johannesburg (UTC day %s) is filed in season %s, expected 2026',
             x.utc_day, x.season));

    -- (d) The figures, season by season, as the school's scorer reads them:
    --     one fixture in 2025, two in 2026 (the New Year one among them).
    SELECT (SELECT row(matches, runs, balls_faced, fours, sixes)::text FROM player_batting_by_season
             WHERE player_id = P44_A AND season = '2025') AS y2025,
           (SELECT row(matches, runs, balls_faced, fours, sixes)::text FROM player_batting_by_season
             WHERE player_id = P44_A AND season = '2026') AS y2026 INTO x;
    -- (d1) batting by season: runs, fours and sixes off the bat
    PERFORM _assert(x.y2025 = '(1,14,7,2,1)' AND x.y2026 = '(2,28,14,4,2)',
      format('db/44 (d1) batting by season: the opener''s (matches, runs, balls, fours, sixes) are %s in 2025 and %s in 2026, expected (1,14,7,2,1) and (2,28,14,4,2) — '
             || 'a no-ball''s byes are not his runs or his boundary, a wide is not a ball he faced, and the New Year fixture is 2026''s',
             coalesce(x.y2025, 'no row'), coalesce(x.y2026, 'no row')));
    SELECT (SELECT row(matches, runs, balls_faced, fours, sixes)::text FROM player_batting_by_season
             WHERE player_id = P44_B AND season = '2025') AS y2025,
           (SELECT row(matches, runs, balls_faced, fours, sixes)::text FROM player_batting_by_season
             WHERE player_id = P44_B AND season = '2026') AS y2026 INTO x;
    -- (d2) batting by season: a delivery with no type is a run; one taken back is nothing
    PERFORM _assert(x.y2025 = '(1,2,2,0,0)' AND x.y2026 = '(2,4,4,0,0)',
      format('db/44 (d2) batting by season: the partner''s (matches, runs, balls, fours, sixes) are %s in 2025 and %s in 2026, expected (1,2,2,0,0) and (2,4,4,0,0) — '
             || 'a delivery with no ball type is a run, as the fold reads it (db/43), and a voided run is nothing to anybody',
             coalesce(x.y2025, 'no row'), coalesce(x.y2026, 'no row')));
    SELECT (SELECT row(a.dismissals, b.dismissals)::text
              FROM player_dismissals_by_season a, player_dismissals_by_season b
             WHERE a.player_id = P44_A AND a.season = '2025' AND b.player_id = P44_B AND b.season = '2025') AS y2025,
           (SELECT row(a.dismissals, b.dismissals)::text
              FROM player_dismissals_by_season a, player_dismissals_by_season b
             WHERE a.player_id = P44_A AND a.season = '2026' AND b.player_id = P44_B AND b.season = '2026') AS y2026 INTO x;
    -- (d3) dismissals by season: the free hit saves, a retirement marked W does not
    PERFORM _assert(x.y2025 = '(1,2)' AND x.y2026 = '(2,4)',
      format('db/44 (d3) dismissals by season: (opener, partner) are %s in 2025 and %s in 2026, expected (1,2) and (2,4) — '
             || 'an lbw on a free hit is no dismissal, a retirement marked W is one, a run out at the other end is the non-striker''s, a W with no method still dismisses its batter',
             coalesce(x.y2025, 'no row'), coalesce(x.y2026, 'no row')));
    SELECT (SELECT row(matches, runs_conceded, legal_balls, wides, no_balls, wickets)::text FROM player_bowling_by_season
             WHERE player_id = P44_C AND season = '2025') AS y2025,
           (SELECT row(matches, runs_conceded, legal_balls, wides, no_balls, wickets)::text FROM player_bowling_by_season
             WHERE player_id = P44_C AND season = '2026') AS y2026 INTO x;
    -- (d4) bowling by season: every run of a wide is his, a no-ball's run and its runs off the bat (not its byes,
    --      db/52); a saved, a run-out or a methodless wicket is not
    PERFORM _assert(x.y2025 = '(1,21,8,1,2,0)' AND x.y2026 = '(2,42,16,2,4,0)',
      format('db/44 (d4) bowling by season: the seamer''s (matches, conceded, legal balls, wides, no-balls, wickets) are %s in 2025 and %s in 2026, expected (1,21,8,1,2,0) and (2,42,16,2,4,0) — '
             || 'a no-ball''s byes are not his (db/52); a delivery with no type is a legal ball and its runs his; an lbw the free hit saved, a run out and a W with no method are not his wickets (db/43)',
             coalesce(x.y2025, 'no row'), coalesce(x.y2026, 'no row')));

    -- (e0) Its precondition, over the whole log: every delivery carries its
    --      fixture's school, so a delivery a reader may see is of a fixture
    --      the reader may see, and filing it under the fixture's season
    --      drops nothing.
    n := _count_ball_school_mismatch();
    n2 := _count_rows('ball_event');
    -- (e0) every delivery is its fixture's school's
    PERFORM _assert(n = 0 AND n2 > 0,
      format('db/44 (e0) every delivery is its fixture''s school''s: %s of %s deliveries carry another school, '
             || 'and a reader who may see one of those may not see its fixture — its season figures would leave it out', n, n2));

    -- (e) THE INVARIANT. For every player each of seven principals may read,
    --     the figures summed over seasons are the lifetime figures, column
    --     by column, across the whole log — the seed's innings, sections 19
    --     and 20, and this fixture. The owner reads every school; the
    --     director, the scorer and the 2XI coach read Hilton at three
    --     different widths; the Westville administrator reads Westville; the
    --     1XI pupil reads his own side's deliveries; and a guardian, whose
    --     assignment is about one child, reads fixtures but no deliveries
    --     (ball_event_read asks about nobody in particular), so must get
    --     nothing from either side.
    FOREACH who IN ARRAY ARRAY[U_OWNER, U_SARAH, U_SCORER, U_COACH2, U_WES_ADM, U_PARENT, U_SELF] LOOP
      PERFORM _as(who);
      SELECT count(*), string_agg(format('%s %s: lifetime %s, by season %s', d.family, d.player_id, d.lifetime, d.by_season), '; ')
        INTO n, detail FROM _career_season_drift() d;
      -- (e) the invariant
      PERFORM _assert(n = 0,
        format('db/44 (e) the invariant, as %s: %s figure(s) are not the sum of their seasons — %s', who, n, left(detail, 600)));
    END LOOP;
    -- ...and it held over something: the fixture's three boys each have two
    -- seasons to add up, for every Hilton reader who can see the 2XI.
    FOREACH who IN ARRAY ARRAY[U_OWNER, U_SARAH, U_SCORER, U_COACH2] LOOP
      PERFORM _as(who);
      SELECT (SELECT count(DISTINCT season) FROM player_batting_by_season    WHERE player_id = P44_A)
           + (SELECT count(DISTINCT season) FROM player_dismissals_by_season WHERE player_id = P44_B)
           + (SELECT count(DISTINCT season) FROM player_bowling_by_season    WHERE player_id = P44_C AND season <> '2024')
        INTO n;
      -- (e) the invariant, over two seasons
      PERFORM _assert(n = 6,
        format('db/44 (e) the invariant, as %s: the fixture''s three boys span %s player-seasons, expected 6 — the sums above were not over two seasons', who, n));
    END LOOP;
  END;
  PERFORM set_config('app.user_id', '', true);

  -- ── 23. A handover verifies this innings, penalties included (SCRBRD-088, db/45) ──
  -- The incoming scorer states the scoreboard's figures for the innings being
  -- played, and the fold keeps them per innings with penalty awards in the
  -- total. On the match §19–§21 score (every earlier row innings 0), under a
  -- fresh claim: penalty and retirement rows in the first innings, then a
  -- second innings, then a first-innings ball written at a later seq (as a
  -- release from quarantine writes one), then a handover. Deltas and exact
  -- rows, coalesced or compared as text: _assert() refuses a NULL. Each
  -- assertion's label names what it guards; each was run once, alone, with
  -- db/45 broken the way this table says, and failed for that reason:
  --
  --   (current)       match_current_innings() as the innings of the highest
  --                   seq (the late first-innings ball took it back to 0)
  --   (penalty)       penalty_runs_as_folded() returning 0 for every row, as
  --                   `value` alone did; and, separately, with the
  --                   `toBattingTeam` test dropped
  --   (wickets)       innings_score_as_folded() counting every row marked W,
  --                   as ball_wicket_stands() alone did
  --   (innings)       the helper summing every innings up to this one
  --   (nobody)        innings_score_as_folded() and match_current_innings()
  --                   as SECURITY DEFINER, search path pinned (so the db/16
  --                   check above does not catch it first)
  --   (verify-expects) scoring_verify_takeover() as db/42 left it
  --   (audit)         the mismatch's audit row without its innings
  --   (verify-old)    a check that also accepts the match's totals
  --   (verify-penalty) a check that also accepts this innings without its
  --                   penalty runs
  --   (verify-ok)     a check that refuses every statement in a second innings
  --
  --    k  innings  row                                        the fold, this innings
  --    1  0        penalty, 5 to the batting side             +5
  --    2  0        penalty, no runs named                     +5 (`runs ?? 5`)
  --    3  0        penalty, 5 to the fielding side            nothing
  --    4  0        penalty, runs 2, `value` 3 on the row      +2 — value is read on deliveries only
  --    5  0        retire marked W, retired out               a wicket
  --    6  0        retire marked W, method `bowled`, hurt     no wicket: not a retirement dismissal
  --   10  1        innings_start                              the second innings is current, 0/0 off 0
  --   11  1        6                                          6, a legal ball
  --   12  1        W bowled                                   a wicket, a legal ball
  --   13  1        no-ball, 1 run                             2 (the leg bye is on its free hit)
  --   14  1        penalty, 5 to the batting side             5
  --   15  1        penalty, 5 to the fielding side            nothing
  --   16  1        leg bye, 1                                 1, a legal ball
  --   17  1        4                                          ...taken back by
  --   18  1        void of 17                                 nothing
  --   19  0        1, written last                            the first innings' — the second is still current
  --
  -- The second innings reads 14/1 off 3. Before db/45 the check expected the
  -- match: every innings' `value` and every row marked W.
  PERFORM _scoring_session_reset(M_HANDOVER);
  PERFORM _as(U_SCORER);
  PERFORM set_config('app.device_id', 'verify-045', true);
  SELECT c.ok, c.epoch INTO v_ok, v_epoch FROM scoring_claim(M_HANDOVER, 'verify-045') c;
  PERFORM _assert(v_ok, 'the scorer could not claim the match the db/45 section scores');
  DECLARE
    B1 uuid := 'aaaaaaaa-0000-0000-0000-000000000006';  -- K Dlamini
    B2 uuid := 'aaaaaaaa-0000-0000-0000-000000000012';  -- J Sithole
    BO uuid := 'bbbbbbbb-0000-0000-0000-000000000002';  -- K Botha
    x record;
    cur0 smallint; cur1 smallint; cur2 smallint; cur3 smallint;
    f0 record; f1 record; f2 record; g record;
    n bigint; n2 bigint;
    old_runs bigint; old_wkts bigint; old_balls bigint;
    v_detail jsonb;
  BEGIN
    PERFORM _as(U_OWNER);
    cur0 := match_current_innings(M_HANDOVER);
    SELECT * INTO f0 FROM innings_score_as_folded(M_HANDOVER, 0::smallint);
    SELECT count(*) INTO n FROM ball_event_live WHERE match_id = M_HANDOVER AND innings <> 0;
    PERFORM _assert(n = 0 AND f0.runs IS NOT NULL,
      format('db/45: the section expects a match scored in its first innings only (%s rows elsewhere, runs %s)', n, f0.runs));

    PERFORM _as(U_SCORER);
    FOR x IN SELECT * FROM (VALUES
        ( 1, 0, 'penalty', NULL,  NULL::text, NULL::int, NULL, '{"runs":5,"toBattingTeam":true,"reason":"ball tampering"}'::jsonb),
        ( 2, 0, 'penalty', NULL,  NULL,       NULL,      NULL, '{"reason":"time wasting"}'::jsonb),
        ( 3, 0, 'penalty', NULL,  NULL,       NULL,      NULL, '{"runs":5,"toBattingTeam":false,"reason":"pitch damage"}'::jsonb),
        ( 4, 0, 'penalty', NULL,  NULL,       3,         NULL, '{"runs":2,"toBattingTeam":true}'::jsonb),
        ( 5, 0, 'retire',  'W',   'retired_out', NULL,   NULL, jsonb_build_object('batter', 'aaaaaaaa-0000-0000-0000-000000000006', 'reason', 'out')),
        ( 6, 0, 'retire',  'W',   'bowled',   NULL,      NULL, jsonb_build_object('batter', 'aaaaaaaa-0000-0000-0000-000000000012', 'reason', 'hurt'))
      ) AS v(k, inn, kind, bt, dis, val, who, pl) ORDER BY k
    LOOP
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value, dismissal, payload)
      VALUES (M_HANDOVER, match_school(M_HANDOVER), 9700 + x.k, v_epoch, x.inn, U_SCORER, 'verify-045',
              'verify:045:' || x.k, 9700 + x.k, now(), x.kind, x.bt, x.val, x.dis, x.pl);
    END LOOP;
    PERFORM _as(U_OWNER);
    cur1 := match_current_innings(M_HANDOVER);
    SELECT * INTO f1 FROM innings_score_as_folded(M_HANDOVER, 0::smallint);

    -- The second innings, then a first-innings ball at the highest seq.
    PERFORM _as(U_SCORER);
    FOR x IN SELECT * FROM (VALUES
        (10, 1, 'innings_start', NULL, NULL::text, NULL::int, NULL, '{"battingTeam":"Kearsney","bowlingTeam":"Hilton U16B","overs":20}'::jsonb),
        (11, 1, 'ball', 'run', NULL,     6,    'b1', '{}'::jsonb),
        (12, 1, 'ball', 'W',   'bowled', 0,    'b1', '{}'::jsonb),
        (13, 1, 'ball', 'Nb',  NULL,     1,    'b2', '{}'::jsonb),
        (14, 1, 'penalty', NULL, NULL,   NULL, NULL, '{"runs":5,"toBattingTeam":true}'::jsonb),
        (15, 1, 'penalty', NULL, NULL,   NULL, NULL, '{"runs":5,"toBattingTeam":false}'::jsonb),
        (16, 1, 'ball', 'LB',  NULL,     1,    'b2', '{}'::jsonb),
        (17, 1, 'ball', 'run', NULL,     4,    'b2', '{}'::jsonb),
        (18, 1, 'void', NULL,  NULL,     NULL, NULL, '{"target":"verify:045:17"}'::jsonb)
      ) AS v(k, inn, kind, bt, dis, val, who, pl) ORDER BY k
    LOOP
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value,
                              striker_id, bowler_id, dismissal, payload)
      VALUES (M_HANDOVER, match_school(M_HANDOVER), 9700 + x.k, v_epoch, x.inn, U_SCORER, 'verify-045',
              'verify:045:' || x.k, 9700 + x.k, now(), x.kind, x.bt, x.val,
              CASE x.who WHEN 'b1' THEN B1 WHEN 'b2' THEN B2 END,
              CASE WHEN x.kind = 'ball' THEN BO END, x.dis, x.pl);
    END LOOP;
    PERFORM _as(U_OWNER);
    cur2 := match_current_innings(M_HANDOVER);
    PERFORM _as(U_SCORER);
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id)
    VALUES (M_HANDOVER, match_school(M_HANDOVER), 9719, v_epoch, 0, U_SCORER, 'verify-045',
            'verify:045:19', 9719, now(), 'ball', 'run', 1, B1, BO);
    PERFORM _as(U_OWNER);
    cur3 := match_current_innings(M_HANDOVER);
    SELECT * INTO f2 FROM innings_score_as_folded(M_HANDOVER, 0::smallint);
    SELECT * INTO g  FROM innings_score_as_folded(M_HANDOVER, 1::smallint);
    -- What the check used to expect: the match, by `value`, every row marked W.
    SELECT sum(CASE WHEN b.ball_type IN ('Wd','Nb') THEN 1 + coalesce(b.value,0) ELSE coalesce(b.value,0) END),
           sum(CASE WHEN ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal) THEN 1 ELSE 0 END),
           sum(CASE WHEN b.kind = 'ball' AND b.ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END)
      INTO old_runs, old_wkts, old_balls
      FROM ball_event_live b WHERE b.match_id = M_HANDOVER;

    -- (current) the innings the log has reached — not the innings of its last seq
    PERFORM _assert(cur0 = 0 AND cur1 = 0 AND cur2 = 1 AND cur3 = 1,
      format('db/45 (current): the current innings read %s, %s, %s, %s — expected 0 before the second innings, 0 after first-innings penalties, '
             || '1 once it opened, and still 1 after a first-innings ball written at a later seq', cur0, cur1, cur2, cur3));
    -- (penalty) the first innings: +5, +5, nothing to the fielding side, +2 not +5, and the late ball's 1
    PERFORM _assert(f1.runs - f0.runs = 12 AND f2.runs - f0.runs = 13 AND f2.legal_balls - f0.legal_balls = 1,
      format('db/45 (penalty): the first innings'' runs moved by %s and %s (expected 12 and 13) and its legal balls by %s (expected 1) — '
             || 'penalty runs are `runs ?? 5` to the batting side, nothing to the fielding side, and a row''s `value` counts on a delivery only',
             f1.runs - f0.runs, f2.runs - f0.runs, f2.legal_balls - f0.legal_balls));
    -- (wickets) a retirement the fold reads as a dismissal is a wicket; a W marker on any other retirement is not
    PERFORM _assert(f1.wickets - f0.wickets = 1,
      format('db/45 (wickets): the first innings'' wickets moved by %s for one retired out and one retirement marked W with method bowled, expected 1',
             f1.wickets - f0.wickets));
    -- (innings) the second innings alone, as the fold totals it
    PERFORM _assert(row(g.runs, g.wickets, g.legal_balls)::text = '(14,1,3)',
      format('db/45 (innings): the second innings reads %s, expected (14,1,3) — 6, a wicket, a no-ball and its run, five penalty runs, a leg bye; '
             || 'the fielding side''s penalty and a voided four are nothing', row(g.runs, g.wickets, g.legal_balls)::text));

    -- (nobody) The helpers read as their caller: an unidentified session and
    --          another school's office read nothing of this Hilton fixture.
    PERFORM set_config('app.user_id', '', true);
    SELECT count(*) INTO n FROM innings_score_as_folded(M_HANDOVER, 1::smallint) f
     WHERE f.runs <> 0 OR f.wickets <> 0 OR f.legal_balls <> 0;
    n := n + match_current_innings(M_HANDOVER);
    PERFORM _as(U_WES_ADM);
    SELECT count(*) INTO n2 FROM innings_score_as_folded(M_HANDOVER, 1::smallint) f
     WHERE f.runs <> 0 OR f.wickets <> 0 OR f.legal_balls <> 0;
    n2 := n2 + match_current_innings(M_HANDOVER);
    -- (nobody)
    PERFORM _assert(n = 0 AND n2 = 0,
      format('db/45 (nobody): an unidentified session read %s and the Westville administrator %s of a Hilton fixture''s innings through the helpers, expected 0 and 0',
             n, n2));

    -- The pen goes to Sarah in the second innings.
    PERFORM _as(U_SCORER);
    SELECT a.code INTO v_code FROM scoring_arm_handover(M_HANDOVER, 'verify-045', 0, false) a;
    PERFORM _assert(v_code IS NOT NULL, 'db/45: the scorer could not arm a handover in the second innings');
    PERFORM _as(U_SARAH);
    SELECT h.ok INTO v_ok FROM scoring_claim_handover(M_HANDOVER, 'verify-045-b', v_code) h;
    PERFORM _assert(v_ok, 'db/45: Sarah could not claim the handover in the second innings');

    -- (verify-expects) a wrong reading answers with this innings' figures
    SELECT v.ok, v.exp_runs, v.exp_wkts, v.exp_balls INTO v_ok, v_runs, v_wkts, v_balls
      FROM scoring_verify_takeover(M_HANDOVER, 'verify-045-b', -1, -1, -1) v;
    PERFORM _assert(NOT v_ok AND row(v_runs, v_wkts, v_balls)::text = '(14,1,3)',
      format('db/45 (verify-expects): a wrong reading was answered with %s, expected this innings'' (14,1,3)', row(v_runs, v_wkts, v_balls)::text));
    -- (audit) and the refusal is on the record, naming the innings
    PERFORM _as(U_OWNER);
    SELECT a.detail INTO v_detail FROM scoring_audit a
     WHERE a.match_id = M_HANDOVER AND a.event = 'handover_verify_failed' ORDER BY a.id DESC LIMIT 1;
    PERFORM _assert(v_detail->>'innings' = '1' AND v_detail->'expected'->>'runs' = '14',
      format('db/45 (audit): the refusal''s audit detail is %s, expected the second innings and its 14 runs', coalesce(v_detail::text, 'no row')));
    -- (verify-old) the match's totals, which the check used to want, are refused
    PERFORM _as(U_SARAH);
    SELECT v.ok INTO v_ok FROM scoring_verify_takeover(M_HANDOVER, 'verify-045-b', old_runs::int, old_wkts::int, old_balls::int) v;
    PERFORM _assert(NOT v_ok AND row(old_runs, old_wkts, old_balls)::text <> '(14,1,3)',
      format('db/45 (verify-old): the match''s totals %s verified', row(old_runs, old_wkts, old_balls)::text));
    -- (verify-penalty) this innings without its penalty runs is refused
    SELECT v.ok INTO v_ok FROM scoring_verify_takeover(M_HANDOVER, 'verify-045-b', 9, 1, 3) v;
    PERFORM _assert(NOT v_ok, 'db/45 (verify-penalty): the second innings without its five penalty runs verified');
    -- (verify-ok) the fold's figures hand the pen over
    SELECT v.ok, v.epoch INTO v_ok, n FROM scoring_verify_takeover(M_HANDOVER, 'verify-045-b', 14, 1, 3) v;
    PERFORM _assert(v_ok AND n = v_epoch + 1,
      format('db/45 (verify-ok): the second innings'' 14/1 off 3 did not verify (ok %s, epoch %s after %s)', v_ok, n, v_epoch));
  END;
  PERFORM set_config('app.device_id', '', true);
  PERFORM set_config('app.user_id', '', true);

  -- ── 24. The opposition window is five days (SCRBRD-091, db/46) ──────
  -- Kameel, 2026-09-25: "14 days seems excessive; 5-7 days would be more
  -- than appropriate". Five, and one window for everything the dossier opens,
  -- squad and figures alike. The edge from both sides, read by a coach of a
  -- side actually playing (the Westville 1XI, the away side): four days out
  -- the window is open and the squad reads; six days out it is not yet open,
  -- says when it will be, and discloses nothing — no squad, no count. The
  -- number itself is asserted last, so a window moved off five goes red on
  -- the edge it moved, not only on the constant.
  DECLARE
    U_WES_COACH uuid := '88888888-0000-0000-0000-00000000001a';  -- S Pillay, coach, Westville 1XI
    M_FOUR uuid; M_SIX uuid;
    s4 record; s6 record; c6 record;
    q4 int; q6 int;
  BEGIN
    M_FOUR := _opposition_fixture(4);
    M_SIX  := _opposition_fixture(6);
    PERFORM _as(U_WES_COACH);
    SELECT s.open, s.reason, s.my_school INTO s4 FROM opposition_side(M_FOUR) s;
    SELECT s.open, s.reason, s.opens_at, s.closes_at INTO s6 FROM opposition_side(M_SIX) s;
    SELECT count(*) INTO q4 FROM opposition_squad(M_FOUR);
    SELECT count(*) INTO q6 FROM opposition_squad(M_SIX);
    SELECT c.open, c.reason, c.games_analysed, c.deliveries_analysed INTO c6 FROM opposition_context(M_SIX) c;

    -- (four) inside the window: open, and their squad reads
    PERFORM _assert(s4.open AND s4.reason = 'open' AND s4.my_school = WES AND q4 > 0,
      format('db/46 (four): a fixture four days out answered open %s, reason %s, %s squad rows — expected open, with Hilton''s 1XI to read',
             s4.open, s4.reason, q4));
    -- (six) outside it: not yet open, saying when, and nothing read
    PERFORM _assert(s6.open = false AND s6.reason = 'not_yet_open' AND s6.opens_at > now() AND q6 = 0
                    AND c6.open = false AND c6.reason = 'not_yet_open'
                    AND c6.games_analysed IS NULL AND c6.deliveries_analysed IS NULL,
      format('db/46 (six): a fixture six days out answered open %s, reason %s, opening %s, %s squad rows, context %s — '
             || 'expected not_yet_open, opening at a time still to come, no squad and no counts', s6.open, s6.reason, s6.opens_at, q6, c6::text));
    -- (value) five days, the decision
    PERFORM _assert(opposition_window_days() = 5,
      format('db/46 (value): opposition_window_days() answers %s, expected 5', opposition_window_days()));
  END;
  PERFORM set_config('app.user_id', '', true);

  -- ── 25. The records the public-data rule reads (SCRBRD-083, db/47) ──
  -- docs/policy/PUBLIC_DATA.md §4 and §6 step 2. Every write goes through a
  -- door that checks its own authority, and each refusal below is asserted to
  -- have left nothing behind (counted past RLS). What a stranger's page will
  -- read, public_name_facts(), is asserted to carry the three facts the rule
  -- needs and never a date of birth, a reason or a guardian.
  DECLARE
    U_WHIT    uuid := '88888888-0000-0000-0000-000000000010';  -- H Whitfield, guardian of James
    U_BEKKER  uuid := '88888888-0000-0000-0000-000000000011';  -- A Bekker, guardian of T Bekker
    U_WES_PUB uuid := '88888888-0000-0000-0000-00000000047a';  -- sportsadmin, Westville (above)
    P_JW      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';  -- James Whitfield, 1XI, sixteen
    P_2XI     uuid := 'aaaaaaaa-0000-0000-0000-00000000044a';  -- V44 Opener, 2XI (section 22)
    M_47      uuid := '77777777-0000-0000-0000-000000000047';  -- Hilton 1XI v Westville 1XI
    C_KZN     uuid := '99999999-0000-0000-0000-000000000001';  -- the shared league, no organiser
    V         text := 'public-names-2026-09';
    v_today   text := to_char(sa_today(), 'YYYY-MM-DD');
    v_facts   jsonb;
    v_row     public_name_consent;
    v_grp     text;
    v_born    date;
    v_raised  boolean;
    who       uuid;
  BEGIN
    -- ── Consent: who may give it ──
    -- (guardian) a verified guardian consents for his own child
    PERFORM _as(U_WHIT);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_JW, true, V) s;
    PERFORM _assert(v_ok, format('db/47 (guardian): a verified guardian could not consent for his own child (%s)', v_reason));
    v_row := _consent_last(P_JW);
    PERFORM _assert(v_row.given_by = 'guardian' AND v_row.given_on = sa_today() AND v_row.ended_on IS NULL
                    AND v_row.recorded_by = U_WHIT AND v_row.form_name IS NULL,
      format('db/47 (guardian): the record is not his, today''s and open: %s', row(v_row.given_by, v_row.given_on, v_row.ended_on, v_row.recorded_by)::text));
    -- ...and for the 2XI boy he is also guardian of
    PERFORM _link_47(P_2XI);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_2XI, true, V) s;
    PERFORM _assert(v_ok, format('db/47 (guardian-2): a verified guardian could not consent for his second child (%s)', v_reason));
    -- (other-child) ...and cannot write another child's
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_OTHER, true, V) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted' AND _consent_rows(P_OTHER) = 0,
      format('db/47 (other-child): a guardian of one child wrote another''s consent (ok %s, %s, %s rows)', v_ok, v_reason, _consent_rows(P_OTHER)));
    -- ...nor pass himself off as the office to do it
    SELECT s.ok, s.reason INTO v_ok, v_reason
      FROM public_name_consent_set(P_OTHER, true, V, U_BEKKER, 'Admission form', current_date) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted' AND _consent_rows(P_OTHER) = 0,
      format('db/47 (other-child-office): a guardian recorded another family''s consent as the office (ok %s, %s)', v_ok, v_reason));

    -- (minor) a pupil under eighteen cannot give his own
    PERFORM _as(U_SELF);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_INJURED, true, V) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_yet_eighteen' AND _consent_rows(P_INJURED) = 0,
      format('db/47 (minor): a pupil of sixteen gave his own consent (ok %s, %s, %s rows)', v_ok, v_reason, _consent_rows(P_INJURED)));
    -- (eighteen) ...and can from his birthday (C6): his date of birth moved
    -- back, as the owner, so R Pillay is nineteen
    v_born := _born_of(P_INJURED);
    PERFORM _set_born(P_INJURED, (current_date - interval '19 years')::date);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_INJURED, true, V) s;
    PERFORM _assert(v_ok, format('db/47 (eighteen): a pupil of nineteen could not give his own consent (%s)', v_reason));
    v_facts := public_name_facts(P_INJURED);
    PERFORM _assert(v_facts -> 'consents' @> jsonb_build_array(jsonb_build_object('by', 'pupil', 'competent', true, 'givenOn', v_today)),
      format('db/47 (eighteen): his own consent is not in the facts as competent: %s', v_facts));
    -- (competent-live) competence is worked out on every read, from the
    -- record as it stands: put his birthday back and the same consent is one
    -- a sixteen-year-old gave, which counts for nothing
    PERFORM _set_born(P_INJURED, v_born);
    v_facts := public_name_facts(P_INJURED);
    PERFORM _assert(v_facts -> 'consents' @> jsonb_build_array(jsonb_build_object('by', 'pupil', 'competent', false)),
      format('db/47 (competent-live): a consent given "at eighteen" by a boy the record says is sixteen still counts: %s', v_facts));

    -- ── The office, from its own forms (C1) ──
    PERFORM _as(U_REGISTRAR);
    -- (form-required) a yes from the office names the form
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_OTHER, true, V, U_BEKKER) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'form_required' AND _consent_rows(P_OTHER) = 0,
      format('db/47 (form-required): the office recorded a consent naming no form (ok %s, %s)', v_ok, v_reason));
    -- (form-future) ...signed on a day that has happened
    SELECT s.ok, s.reason INTO v_ok, v_reason
      FROM public_name_consent_set(P_OTHER, true, V, U_BEKKER, 'Admission form 2026', current_date + 30) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'form_in_future' AND _consent_rows(P_OTHER) = 0,
      format('db/47 (form-future): the office recorded a form dated next month (ok %s, %s)', v_ok, v_reason));
    -- (office) ...and records it, on the guardian's behalf, form and date named
    SELECT s.ok, s.reason INTO v_ok, v_reason
      FROM public_name_consent_set(P_OTHER, true, V, U_BEKKER, 'Admission form 2026', current_date - 30) s;
    v_row := _consent_last(P_OTHER);
    PERFORM _assert(v_ok AND v_row.given_by = 'guardian' AND v_row.form_name = 'Admission form 2026'
                    AND v_row.form_date = current_date - 30 AND v_row.recorded_by = U_REGISTRAR
                    AND v_row.given_on = sa_today(),
      format('db/47 (office): the office could not record a guardian''s consent from its form (ok %s, %s, %s)',
             v_ok, v_reason, row(v_row.given_by, v_row.form_name, v_row.form_date, v_row.recorded_by, v_row.given_on)::text));
    -- (office-no-link) ...but only for a guardian with a verified link to him
    SELECT s.ok, s.reason INTO v_ok, v_reason
      FROM public_name_consent_set(P_OTHER, true, V, U_WHIT, 'Admission form 2026', current_date) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'no_verified_link',
      format('db/47 (office-no-link): the office recorded a consent from somebody who is not his guardian (ok %s, %s)', v_ok, v_reason));
    -- (other-office) another school's office cannot
    PERFORM _as(U_WES_ADM);
    SELECT s.ok, s.reason INTO v_ok, v_reason
      FROM public_name_consent_set(P_JW, false, V, U_WHIT) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted' AND _consent_open_rows(P_JW) = 1,
      format('db/47 (other-office): Westville''s office withdrew a Hilton child''s consent (ok %s, %s)', v_ok, v_reason));
    -- (coach) nor can a coach, either way in
    PERFORM _as(U_COACH2);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_JW, false, V, U_WHIT) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted',
      format('db/47 (coach): a coach recorded a guardian''s answer (ok %s, %s)', v_ok, v_reason));
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_JW, true, V) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted',
      format('db/47 (coach): a coach consented for a boy he is no guardian of (ok %s, %s)', v_ok, v_reason));
    -- (direct) the application has no way to write the table but the door
    -- (a write that gets past the privilege and fails on anything else has
    -- still got through the door, and is reported as such)
    PERFORM _as(U_REGISTRAR);
    v_raised := false;
    BEGIN
      INSERT INTO public_name_consent (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on, recorded_by)
      SELECT P_U16B, 'guardian', g.assignment_id, g.id, V, sa_today(), U_REGISTRAR
        FROM assignment_subject g WHERE g.player_id = P_U16B LIMIT 1;
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
              WHEN OTHERS THEN v_raised := false;
    END;
    PERFORM _assert(v_raised AND _consent_rows(P_U16B) = 0, 'db/47 (direct): the office wrote public_name_consent without its door');

    -- ── Who reads a consent record ──
    PERFORM _as(U_WHIT);
    SELECT count(*) INTO n FROM public_name_consent;
    PERFORM _assert(n = 2, format('db/47 (read-own): a guardian reads %s consent records, expected his own two', n));
    PERFORM _as(U_REGISTRAR);
    SELECT count(*) INTO n FROM public_name_consent WHERE player_id IN (P_JW, P_2XI, P_OTHER, P_INJURED);
    PERFORM _assert(n = 4, format('db/47 (read-office): the office reads %s of the school''s 4 consent records', n));
    -- (read-coach) not even the record about a boy in the side he coaches
    PERFORM _as(U_COACH2);
    SELECT count(*) INTO n FROM public_name_consent;
    PERFORM _assert(n = 0 AND _consent_rows(P_2XI) = 1,
      format('db/47 (read-coach): the 2XI coach reads %s consent records — they name a child''s guardian', n));

    -- ── A "no" is immediate, and ends a record rather than deleting it (C3) ──
    PERFORM _as(U_WHIT);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_JW, false, V) s;
    v_facts := public_name_facts(P_JW);
    PERFORM _assert(v_ok AND _consent_rows(P_JW) = 1 AND _consent_open_rows(P_JW) = 0
                    AND v_facts -> 'consents' = jsonb_build_array(jsonb_build_object(
                          'by', 'guardian', 'competent', true, 'givenOn', v_today, 'endedOn', v_today)),
      format('db/47 (withdraw): a withdrawal did not end the one record today (ok %s, %s rows, facts %s)', v_ok, _consent_rows(P_JW), v_facts));
    -- (same-day) consenting again the same day names him again: the facts
    -- carry his latest act, not a tie with his own withdrawal
    SELECT s.ok INTO v_ok FROM public_name_consent_set(P_JW, true, V) s;
    v_facts := public_name_facts(P_JW);
    PERFORM _assert(v_ok AND _consent_rows(P_JW) = 2 AND jsonb_array_length(v_facts -> 'consents') = 1
                    AND v_facts #>> '{consents,0,endedOn}' IS NULL,
      format('db/47 (same-day): a same-day consent after a withdrawal is not his latest act (%s rows, facts %s)', _consent_rows(P_JW), v_facts));
    -- (again) a second yes to the same wording is refused, not duplicated
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_JW, true, V) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'already_given' AND _consent_open_rows(P_JW) = 1,
      format('db/47 (again): a repeated consent was written (ok %s, %s)', v_ok, v_reason));
    -- (adult) a guardian answers for a minor: James made nineteen, as the
    -- owner, with his guardian's link still open (he is at school, db/62).
    -- Under option C (SCRBRD-083 §6.3, db/62) the guardian's "yes" is
    -- refused for the reason, and the consent given today is not a competent
    -- one. A guardian's "no" is theirs to give only while he is at school:
    -- with his membership closed and the link not yet dated (the close is
    -- deferred to the end of the transaction), the old link still says live
    -- and the "no" is refused as before. Section 40 proves the "no" a
    -- guardian may give. Made sixteen again, and back in his side, the
    -- consent is competent again.
    v_born := _born_of(P_JW);
    PERFORM _set_born(P_JW, (current_date - interval '19 years')::date);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_JW, true, V || '-adult') s;
    v_facts := public_name_facts(P_JW);
    PERFORM _assert(NOT v_ok AND v_reason = 'adult_consents_for_himself' AND _consent_open_rows(P_JW) = 1
                    AND v_facts #> '{consents,0,competent}' = 'false'::jsonb,
      format('db/47 (adult): a guardian named, or counted for, a boy of nineteen (ok %s, %s, facts %s)', v_ok, v_reason, v_facts));
    PERFORM _v60_leave(P_JW);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_JW, false, V) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'player_is_an_adult' AND _consent_open_rows(P_JW) = 1,
      format('db/47 (adult): a guardian answered for a boy of nineteen who is not at school (ok %s, %s)', v_ok, v_reason));
    PERFORM _v60_rejoin(P_JW);
    PERFORM _set_born(P_JW, v_born);
    PERFORM _assert(public_name_facts(P_JW) #> '{consents,0,competent}' = 'true'::jsonb,
      'db/47 (adult): the consent is not competent again once he is sixteen');
    -- (refused) a "no" with nothing open is a record that ends the day it begins
    PERFORM _as(U_SARAH);
    SELECT s.ok INTO v_ok FROM public_name_consent_set(P_U16B, false, V) s;
    v_row := _consent_last(P_U16B);
    PERFORM _assert(v_ok AND v_row.end_reason = 'refused' AND v_row.given_on = sa_today() AND v_row.ended_on = sa_today(),
      format('db/47 (refused): a refusal is not a record ending the day it begins: %s', row(v_row.end_reason, v_row.given_on, v_row.ended_on)::text));

    -- ── The never-public mark (C5) ──
    -- (mark-coach) a coach cannot set one
    PERFORM _as(U_COACH2);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM player_never_public_set(P_2XI, 'verify-047: coach') s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted' AND _mark_rows(P_2XI) = 0,
      format('db/47 (mark-coach): a coach set a never-public mark (ok %s, %s)', v_ok, v_reason));
    -- (mark-dos) the director of sport can, with a reason
    PERFORM _as(U_SARAH);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM player_never_public_set(P_2XI, '   ') s;
    PERFORM _assert(NOT v_ok AND v_reason = 'no_reason', format('db/47 (mark-reason): a mark with no reason was set (%s)', v_reason));
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM player_never_public_set(P_2XI, 'verify-047: a protection order') s;
    PERFORM _assert(v_ok, format('db/47 (mark-dos): the director of sport could not set a mark (%s)', v_reason));
    v_facts := public_name_facts(P_2XI);
    PERFORM _assert((v_facts ->> 'neverPublic')::boolean,
      format('db/47 (mark-facts): the facts do not carry the mark: %s', v_facts));
    -- (reason-coach) the reason is unreadable by the coach of that boy's own side
    PERFORM _as(U_COACH2);
    SELECT count(*) INTO n FROM player_never_public;
    PERFORM _assert(n = 0, format('db/47 (reason-coach): the 2XI coach reads %s never-public mark(s), reason and all', n));
    -- ...or by a guardian, or by another school's office
    FOREACH who IN ARRAY ARRAY[U_WHIT, U_WES_ADM, U_WES_PUB, U_WATCHER] LOOP
      PERFORM _as(who);
      SELECT count(*) INTO n FROM player_never_public;
      PERFORM _assert(n = 0, format('db/47 (reason-others): %s reads %s never-public mark(s)', who, n));
    END LOOP;
    -- ...and readable by the people who set such marks
    FOREACH who IN ARRAY ARRAY[U_SARAH, U_REGISTRAR, U_HEAD_M] LOOP
      PERFORM _as(who);
      SELECT count(*) INTO n FROM player_never_public WHERE player_id = P_2XI AND reason = 'verify-047: a protection order';
      PERFORM _assert(n = 1, format('db/47 (reason-setters): %s, who may set a mark, cannot read this one', who));
    END LOOP;
    -- (facts-clean) the facts carry the three keys, the consents their four,
    -- and never the reason, a date of birth or a guardian
    PERFORM set_config('app.user_id', '', true);
    FOREACH who IN ARRAY ARRAY[P_2XI, P_JW, P_INJURED, P_OTHER, P_U16B] LOOP
      v_facts := public_name_facts(who);
      PERFORM _assert(
        (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_facts) k) = ARRAY['consents', 'namesOff', 'neverPublic']
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_facts -> 'consents') c
                         WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c) k)
                               <> ARRAY['by', 'competent', 'endedOn', 'givenOn'])
        AND v_facts::text NOT LIKE '%protection order%'
        AND v_facts::text NOT LIKE ('%' || to_char(_born_of(who), 'YYYY-MM-DD') || '%')
        AND v_facts::text !~* ('born|reason|guardian_|link|form|recorded|' || U_WHIT::text || '|' || U_BEKKER::text),
        format('db/47 (facts-clean): the facts about %s carry more than the rule needs: %s', who, v_facts));
    END LOOP;

    -- ── Names off, per age group (C4) ──
    PERFORM _as(U_COACH2);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_names_off_set(HIL, 'open', true) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted',
      format('db/47 (names-coach): a coach switched names off for an age group (ok %s, %s)', v_ok, v_reason));
    -- K Dlamini: U16B by registration, younger by birth. 'open' switched off
    -- names him when he plays in his own sides and not when he plays up into
    -- the 1st XI (the side's age group, §5a).
    v_grp := birth_age_group(_born_of(P_U16B));
    PERFORM _assert(v_grp NOT IN ('U16', 'open'), format('db/47: K Dlamini''s own age group is %s — the fixture needs one that is neither his side''s nor open', v_grp));
    PERFORM _as(U_SARAH);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_names_off_set(HIL, 'open', true) s;
    PERFORM _assert(v_ok, format('db/47 (names-dos): the director of sport could not switch names off (%s)', v_reason));
    PERFORM _assert(NOT (public_name_facts(P_U16B) ->> 'namesOff')::boolean
                    AND NOT (public_name_facts(P_U16B, 'U16B') ->> 'namesOff')::boolean,
      'db/47 (names-own): switching the open age group off unnamed a boy playing in his own U16B');
    PERFORM _assert((public_name_facts(P_U16B, '1XI') ->> 'namesOff')::boolean,
      'db/47 (names-side): a boy playing up into the 1st XI was named with the open age group switched off');
    -- (names-birth) his own age group by birth holds him back in any side
    SELECT s.ok INTO v_ok FROM public_names_off_set(HIL, v_grp, true) s;
    PERFORM _assert(v_ok AND (public_name_facts(P_U16B, 'U16B') ->> 'namesOff')::boolean,
      format('db/47 (names-birth): %s switched off did not hold back a %s boy playing U16B', v_grp, v_grp));
    -- (names-back) switched back on, the switch is off again
    SELECT s.ok INTO v_ok FROM public_names_off_set(HIL, v_grp, false) s;
    PERFORM _assert(v_ok AND NOT (public_name_facts(P_U16B, 'U16B') ->> 'namesOff')::boolean,
      'db/47 (names-back): switching an age group back did not name him again');
    -- (names-school) Westville's switches are not Hilton's: D Mkhize is named
    PERFORM _assert(NOT (public_name_facts(P_WES, '1XI') ->> 'namesOff')::boolean,
      'db/47 (names-school): Hilton''s open switch held back a Westville boy');
    PERFORM _as(U_COACH2);
    SELECT count(*) INTO n FROM public_names_off WHERE school_id = HIL;
    PERFORM _assert(n = 2, format('db/47 (names-read): a coach reads %s of his school''s 2 names-off settings', n));

    -- ── Publishing, side by side (L1, L5) ──
    -- (publish-default) nothing is published until somebody publishes it
    PERFORM _assert(NOT fixture_side_published(M_47, 'home') AND NOT fixture_side_published(M_47, 'away')
                    AND NOT competition_published(C_KZN),
      'db/47 (publish-default): a fixture or competition nobody published reads as published');
    PERFORM _assert((SELECT column_default FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'fixture_publication' AND column_name = 'published') = 'false'
                    AND (SELECT column_default FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'competition_publication' AND column_name = 'published') = 'false',
      'db/47 (publish-default): a publication row does not default to unpublished');
    -- (away-home) the away school cannot publish the home side...
    PERFORM _as(U_WES_PUB);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM fixture_publish(M_47, 'home', true) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted' AND NOT fixture_side_published(M_47, 'home'),
      format('db/47 (away-home): Westville published Hilton''s side (ok %s, %s)', v_ok, v_reason));
    -- (away-own) ...and publishes its own
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM fixture_publish(M_47, 'away', true) s;
    PERFORM _assert(v_ok AND fixture_side_published(M_47, 'away') AND NOT fixture_side_published(M_47, 'home'),
      format('db/47 (away-own): Westville could not publish its own side, or doing so published Hilton''s (ok %s, %s)', v_ok, v_reason));
    -- (home-away) the home school cannot publish the away side either
    PERFORM _as(U_SARAH);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM fixture_publish(M_47, 'away', false) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted' AND fixture_side_published(M_47, 'away'),
      format('db/47 (home-away): Hilton unpublished Westville''s side (ok %s, %s)', v_ok, v_reason));
    SELECT s.ok INTO v_ok FROM fixture_publish(M_47, 'home', true) s;
    PERFORM _assert(v_ok AND fixture_side_published(M_47, 'home'), 'db/47 (home-own): Hilton could not publish its own side');
    -- (off-platform) a side whose school is not on the platform has nobody to publish it
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM fixture_publish(M_DUTY, 'away', true) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'side_not_on_platform',
      format('db/47 (off-platform): a side with no school on the platform was published (ok %s, %s)', v_ok, v_reason));
    -- (publish-coach) a coach and the office do not publish
    FOREACH who IN ARRAY ARRAY[U_COACH2, U_REGISTRAR] LOOP
      PERFORM _as(who);
      SELECT s.ok INTO v_ok FROM fixture_publish(M_47, 'home', false) s;
      PERFORM _assert(NOT v_ok AND fixture_side_published(M_47, 'home'),
        format('db/47 (publish-coach): %s, who holds no broadcast.publish, unpublished a side', who));
    END LOOP;
    -- (competition) the league's page: its administrator, and nobody at a school
    FOREACH who IN ARRAY ARRAY[U_SARAH, U_COACH2, U_REGISTRAR] LOOP
      PERFORM _as(who);
      SELECT s.ok INTO v_ok FROM competition_publish(C_KZN, true) s;
      PERFORM _assert(NOT v_ok AND NOT competition_published(C_KZN),
        format('db/47 (competition-others): %s published a league it does not run', who));
    END LOOP;
    PERFORM _as(U_LEAGUE);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM competition_publish(C_KZN, true) s;
    PERFORM _assert(v_ok AND competition_published(C_KZN),
      format('db/47 (competition): the league administrator could not publish its page (%s)', v_reason));
    -- (publication-read) each school reads its own side's row
    PERFORM _as(U_WES_PUB);
    SELECT count(*) INTO n FROM fixture_publication WHERE match_id = M_47;
    PERFORM _assert(n = 1, format('db/47 (publication-read): Westville reads %s publication rows of the fixture, expected its own', n));

    -- ── The mark ends; the row stays ──
    PERFORM _as(U_COACH2);
    SELECT s.ok INTO v_ok FROM player_never_public_end(P_2XI) s;
    PERFORM _assert(NOT v_ok AND (public_name_facts(P_2XI) ->> 'neverPublic')::boolean,
      'db/47 (end-coach): a coach ended a never-public mark');
    PERFORM _as(U_HEAD_M);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM player_never_public_end(P_2XI) s;
    PERFORM _assert(v_ok AND NOT (public_name_facts(P_2XI) ->> 'neverPublic')::boolean AND _mark_rows(P_2XI) = 1,
      format('db/47 (end): the principal''s ending did not lift the mark and keep its row (ok %s, %s, %s rows)', v_ok, v_reason, _mark_rows(P_2XI)));

    -- ── Signed out: nothing (§1 "public" means signed out) ──
    PERFORM set_config('app.user_id', '', true);
    FOREACH v_grp IN ARRAY ARRAY['public_name_consent', 'player_never_public', 'public_names_off',
                                 'fixture_publication', 'competition_publication'] LOOP
      EXECUTE format('SELECT count(*) FROM %I', v_grp) INTO n;
      PERFORM _assert(n = 0 AND _count_rows(v_grp) > 0,
        format('db/47 (signed-out): an unauthenticated session reads %s of %s''s %s rows', n, v_grp, _count_rows(v_grp)));
    END LOOP;
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set(P_JW, false, V) s;
    PERFORM _assert(NOT v_ok AND v_reason = 'not_signed_in',
      format('db/47 (signed-out): an unauthenticated session answered for a child (%s)', v_reason));
    SELECT s.ok INTO v_ok FROM fixture_publish(M_47, 'home', false) s;
    PERFORM _assert(NOT v_ok, 'db/47 (signed-out): an unauthenticated session unpublished a fixture');
    SELECT s.ok INTO v_ok FROM player_never_public_set(P_JW, 'signed out') s;
    PERFORM _assert(NOT v_ok, 'db/47 (signed-out): an unauthenticated session set a never-public mark');
  END;
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.device_id', '', true);

  -- ── 26. Penalty runs to the fielding side, in every total (SCRBRD-094, db/48) ──
  -- Law 41.17.4, as the fold credits it: five to the fielding side go to its
  -- most recently completed innings, or, if it has not batted, to its next,
  -- which opens on them; a chase's target rises with an award made after it
  -- was set, unless the umpires typed it. On §23's match, which it leaves at
  -- 14/1 off 3 in the second innings (Kearsney), with a five to the fielding
  -- side — Hilton U16B, who have no innings yet — in it (row 15), and one in
  -- the first innings, whose innings_start was never written (row 3: an
  -- innings with no side, so nobody's). The pen goes back to the scorer, then:
  --
  --    k  innings  row                                        the fold
  --   20  2        innings_start, Hilton U16B bat             row 15's five: they open on 5
  --   21  2        3                                          8/0 off 1
  --   22  2        penalty, 5 to the fielding side            Kearsney's second innings: 14 → 19
  --   23  3        innings_start, Kearsney bat, target 20     the target 20
  --   24  3        penalty, 5 to the fielding side            Hilton's innings 2: 13; the target 25
  --   25  3        revision, target 40                        the umpires' 40
  --   26  3        penalty, no runs named, to the fielding    Hilton's innings 2: 18; the target stays 40
  --   27  3        2                                          2/0 off 1
  --
  -- A handover in the third innings expects the carried five. Each assertion
  -- was run once, alone, with db/48 broken the way its label says, and failed
  -- for that reason:
  --
  --   (last)     penalty_credit_as_folded() never crediting an earlier innings
  --   (next)     ...never crediting a later one
  --   (live)     match_live_score without the batting side's penalties
  --   (handover) innings_score_as_folded() without the credit
  --   (target)   innings_target_as_folded() not raised by an award
  --   (typed)    ...raised even when the umpires typed it
  --   (after)    match_live_score without the credit
  --   (nobody)   the helpers as SECURITY DEFINER, search path pinned
  DECLARE
    e int;
    t20 int; t25 int; t40 int;
    g1 record; g2 record; g2b record; g3 record;
    l1 bigint; l2 bigint; l2b bigint;
    c1 int; c2 int;
    v_without boolean; v_with boolean;
    n int; n2 int;
    x record;
  BEGIN
    -- The pen from Sarah (§23's holder) back to the scorer, in the second innings.
    PERFORM _as(U_SARAH);
    SELECT a.code INTO v_code FROM scoring_arm_handover(M_HANDOVER, 'verify-045-b', 0, false) a;
    PERFORM _as(U_SCORER);
    SELECT h.ok INTO v_ok FROM scoring_claim_handover(M_HANDOVER, 'verify-048', v_code) h;
    SELECT v.ok, v.epoch INTO v_ok, e FROM scoring_verify_takeover(M_HANDOVER, 'verify-048', 14, 1, 3) v;
    PERFORM _assert(v_ok, 'db/48: the scorer could not take the pen back at 14/1 off 3 in the second innings');
    -- The live score before anything is credited to that innings: its own
    -- deliveries and row 14's five to the batting side.
    PERFORM _as(U_OWNER);
    SELECT l.runs INTO l1 FROM match_live_score l WHERE l.match_id = M_HANDOVER AND l.innings = 1;
    PERFORM _as(U_SCORER);
    PERFORM set_config('app.device_id', 'verify-048', true);
    FOR x IN SELECT * FROM (VALUES
        (20, 2, 'innings_start', NULL::text, NULL::int, '{"battingTeam":"Hilton U16B","bowlingTeam":"Kearsney","overs":20}'::jsonb),
        (21, 2, 'ball',    'run', 3,    '{}'::jsonb),
        (22, 2, 'penalty', NULL,  NULL, '{"runs":5,"toBattingTeam":false,"reason":"pitch_damage"}'::jsonb)
      ) AS v(k, inn, kind, bt, val, pl) ORDER BY k
    LOOP
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value, payload)
      VALUES (M_HANDOVER, match_school(M_HANDOVER), 9700 + x.k, e, x.inn, U_SCORER, 'verify-048',
              'verify:048:' || x.k, 9700 + x.k, now(), x.kind, x.bt, x.val, x.pl);
    END LOOP;
    PERFORM _as(U_OWNER);
    SELECT * INTO g2 FROM innings_score_as_folded(M_HANDOVER, 2::smallint);
    c1 := penalty_credit_as_folded(M_HANDOVER, 1::smallint);
    c2 := penalty_credit_as_folded(M_HANDOVER, 2::smallint);

    -- (last) Kearsney's second innings, completed, is credited the five Hilton's third made
    PERFORM _assert(c1 = 5,
      format('db/48 (last): %s runs credited to Kearsney''s innings, expected 5 — the award Hilton''s innings made to them', c1));
    -- (next) Hilton's third innings is credited the five Kearsney's made while Hilton had not batted
    PERFORM _assert(c2 = 5,
      format('db/48 (next): %s runs credited to Hilton''s innings, expected 5 — the award it opens on', c2));
    -- (live) the live score has the batting side's own penalty runs (row 14), as the fold's total does
    PERFORM _assert(l1 = 14,
      format('db/48 (live): match_live_score read %s for Kearsney''s innings, expected the fold''s 14 — six, a no-ball and its run, five penalty runs, a leg bye', l1));

    -- (handover) The pen to Sarah in the third innings: the carried five are on the board.
    PERFORM _as(U_SCORER);
    SELECT a.code INTO v_code FROM scoring_arm_handover(M_HANDOVER, 'verify-048', 0, false) a;
    PERFORM _as(U_SARAH);
    SELECT h.ok INTO v_ok FROM scoring_claim_handover(M_HANDOVER, 'verify-048-b', v_code) h;
    PERFORM _assert(v_ok, 'db/48: Sarah could not claim the handover in the third innings');
    SELECT v.ok INTO v_without FROM scoring_verify_takeover(M_HANDOVER, 'verify-048-b', 3, 0, 1) v;
    SELECT v.ok INTO v_with FROM scoring_verify_takeover(M_HANDOVER, 'verify-048-b', 8, 0, 1) v;
    -- (handover)
    PERFORM _assert(NOT v_without AND v_with AND row(g2.runs, g2.wickets, g2.legal_balls)::text = '(8,0,1)',
      format('db/48 (handover): the third innings reads %s; without its carried five it verified %s, with them %s — expected (8,0,1), refused, then verified',
             row(g2.runs, g2.wickets, g2.legal_balls)::text, v_without, v_with));

    -- And back to the scorer, for the fourth innings: a chase with a target.
    PERFORM _as(U_SARAH);
    SELECT a.code INTO v_code FROM scoring_arm_handover(M_HANDOVER, 'verify-048-b', 0, false) a;
    PERFORM _as(U_SCORER);
    SELECT h.ok INTO v_ok FROM scoring_claim_handover(M_HANDOVER, 'verify-048-c', v_code) h;
    SELECT v.ok, v.epoch INTO v_ok, e FROM scoring_verify_takeover(M_HANDOVER, 'verify-048-c', 8, 0, 1) v;
    PERFORM _assert(v_ok, 'db/48: the scorer could not take the pen back at 8/0 off 1 in the third innings');
    PERFORM set_config('app.device_id', 'verify-048-c', true);
    FOR x IN SELECT * FROM (VALUES
        (23, 3, 'innings_start', NULL::text, NULL::int, '{"battingTeam":"Kearsney","bowlingTeam":"Hilton U16B","overs":20,"target":20}'::jsonb),
        (24, 3, 'penalty',  NULL,  NULL, '{"runs":5,"toBattingTeam":false,"reason":"time_wasting"}'::jsonb),
        (25, 3, 'revision', NULL,  NULL, '{"target":40,"reason":"rain"}'::jsonb),
        (26, 3, 'penalty',  NULL,  NULL, '{"toBattingTeam":false,"reason":"protected_area"}'::jsonb),
        (27, 3, 'ball',     'run', 2,    '{}'::jsonb)
      ) AS v(k, inn, kind, bt, val, pl) ORDER BY k
    LOOP
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value, payload)
      VALUES (M_HANDOVER, match_school(M_HANDOVER), 9700 + x.k, e, x.inn, U_SCORER, 'verify-048-c',
              'verify:048:' || x.k, 9700 + x.k, now(), x.kind, x.bt, x.val, x.pl);
      IF x.k = 23 THEN t20 := innings_target_as_folded(M_HANDOVER, 3::smallint); END IF;
      IF x.k = 24 THEN t25 := innings_target_as_folded(M_HANDOVER, 3::smallint); END IF;
    END LOOP;
    t40 := innings_target_as_folded(M_HANDOVER, 3::smallint);
    PERFORM _as(U_OWNER);
    SELECT * INTO g1 FROM innings_score_as_folded(M_HANDOVER, 1::smallint);
    SELECT * INTO g2b FROM innings_score_as_folded(M_HANDOVER, 2::smallint);
    SELECT * INTO g3 FROM innings_score_as_folded(M_HANDOVER, 3::smallint);
    SELECT l.runs INTO l2 FROM match_live_score l WHERE l.match_id = M_HANDOVER AND l.innings = 1;
    SELECT l.runs INTO l2b FROM match_live_score l WHERE l.match_id = M_HANDOVER AND l.innings = 2;

    -- (target) the chase opened at 20 and an award to the side that set it made it 25
    PERFORM _assert(t20 = 20 AND t25 = 25,
      format('db/48 (target): the fourth innings'' target read %s, then %s — expected 20, then 25 after five to the fielding side', t20, t25));
    -- (typed) the umpires' 40 does not move with a later award
    PERFORM _assert(t40 = 40,
      format('db/48 (typed): the target read %s after the umpires'' 40 and another award, expected 40', t40));
    -- (after) every total, as the fold's: Kearsney's second innings 19 (its 14 and
    --         Hilton's award); Hilton's third 18 (the five it opened on, a 3, and
    --         both awards the chase made); the chase itself neither
    PERFORM _assert(g1.runs = 19 AND l2 = 19 AND g2b.runs = 18 AND l2b = 18
                    AND row(g3.runs, g3.wickets, g3.legal_balls)::text = '(2,0,1)',
      format('db/48 (after): Kearsney''s second innings read %s (live %s), expected 19; Hilton''s third %s (live %s), expected 18; '
             || 'the fourth %s, expected (2,0,1)', g1.runs, l2, g2b.runs, l2b, row(g3.runs, g3.wickets, g3.legal_balls)::text));

    -- (nobody) An unidentified session and another school's office read none of it through the helpers.
    PERFORM set_config('app.user_id', '', true);
    n := coalesce(penalty_credit_as_folded(M_HANDOVER, 2::smallint), -1)
       + coalesce(innings_target_as_folded(M_HANDOVER, 3::smallint), 0);
    PERFORM _as(U_WES_ADM);
    n2 := coalesce(penalty_credit_as_folded(M_HANDOVER, 2::smallint), -1)
        + coalesce(innings_target_as_folded(M_HANDOVER, 3::smallint), 0);
    -- (nobody)
    PERFORM _assert(n = 0 AND n2 = 0,
      format('db/48 (nobody): an unidentified session read %s and the Westville administrator %s of a Hilton fixture''s credits and target, expected 0 and 0',
             n, n2));
  END;
  PERFORM set_config('app.device_id', '', true);
  PERFORM set_config('app.user_id', '', true);
  -- ── 27. A career in one pass over the log (db/49) ───────────────────
  -- The three lifetime views were one pass of ball_event per PLAYER (db/02,
  -- over the *_since() functions), so the policy on ball_event ran players ×
  -- balls times and the `career` read outgrew the client's ten seconds. db/49
  -- made each one pass, grouped by player — db/44's season views without the
  -- season — and left the functions as they were. They are the reference:
  -- for every player each of eight readers may read, the views are what the
  -- functions say, column by column, over the whole log — the seed, sections
  -- 19 to 23 and §22's fixture, which between them carry every rule (no-ball
  -- byes, retirements marked W, free-hit saves, voids, run outs at the other
  -- end, typed names, a ball with no type, a wicket with no method). §22's
  -- (e) holds the season views to the same lifetime views, so the three
  -- readers of one composition cannot drift apart. Each assertion's label
  -- names what it guards. db/49 was broken each of these ways, one at a
  -- time, and the whole file run; what went red first is recorded, because
  -- an earlier section often catches a composition that moved before this
  -- one is reached — which is the point of having three readers held to one:
  --
  --   the batting view over player_batting_since() again  → (one-pass)
  --   the bowling view without security_invoker           → §22 (e), as the
  --                                                          director; (one-pass)
  --                                                          names it too
  --   the batting view without its retirement arm         → §19 (a batter timed
  --                                                          out has no innings)
  --   the dismissals view without ball_wicket_stands()    → §22 (e)
  --   the bowling view counting a run out as the bowler's → §22 (e)
  --   the batting view's second arm without its NULLIF    → nothing, by design
  --                                                          (below)
  --
  -- and (same) alone, over a generated log (tools/bench-career.mjs --load),
  -- went red for the last two as the owner and the director, and stayed
  -- green for a Westville reader and a pupil, who could see none of it.
  --
  -- The NULLIF on the batting view's second arm changes no figure: `faced`
  -- is false there, so its row adds nothing to runs, balls, fours or sixes,
  -- and count(DISTINCT), max() ignore a repeat. It is kept so the view reads
  -- as db/44's does, row for row. The dismissals view's NULLIF is load-bearing
  -- and (same) catches it dropped only if a retirement and a wicket ball were
  -- ever one row, which they cannot be; db/44's header has the argument.
  DECLARE
    who uuid;
    n bigint; n2 bigint; n3 bigint; n4 bigint;
    detail text;
  BEGIN
    SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'v'
       AND c.relname IN ('player_batting_career', 'player_bowling_career', 'player_dismissals')
       AND 'security_invoker=true' = ANY (c.reloptions)
       AND pg_get_viewdef(c.oid) !~ '_since\(';
    -- (one-pass) three invoker views, none of them a function call per player
    PERFORM _assert(n = 3,
      format('db/49 (one-pass): %s of the 3 lifetime views are security_invoker and read the log in one pass, expected 3', n));

    PERFORM set_config('app.user_id', '', true);
    SELECT (SELECT count(*) FROM player_batting_career) + (SELECT count(*) FROM player_bowling_career)
         + (SELECT count(*) FROM player_dismissals) INTO n;
    -- (nobody) an unidentified session reads nothing through them
    PERFORM _assert(n = 0,
      format('db/49 (nobody): an unidentified session read %s rows of lifetime figures, expected 0', n));

    -- (same) THE INVARIANT, as eight readers: the owner (every school), the
    -- director, the scorer and the 2XI coach (Hilton at three widths), the
    -- Westville administrator, the 1XI pupil, a guardian (fixtures, no
    -- deliveries) and nobody at all.
    FOREACH who IN ARRAY ARRAY[U_OWNER, U_SARAH, U_SCORER, U_COACH2, U_WES_ADM, U_PARENT, U_SELF] LOOP
      PERFORM _as(who);
      SELECT count(*), string_agg(format('%s %s: one pass %s, per player %s', d.family, d.player_id, d.one_pass, d.per_player), '; ')
        INTO n, detail FROM _career_lifetime_drift() d;
      -- (same)
      PERFORM _assert(n = 0,
        format('db/49 (same), as %s: %s lifetime figure(s) are not what the per-player functions say — %s', who, n, left(detail, 600)));
    END LOOP;
    PERFORM set_config('app.user_id', '', true);
    SELECT count(*) INTO n FROM _career_lifetime_drift();
    -- (same), as nobody
    PERFORM _assert(n = 0, format('db/49 (same), as nobody: %s lifetime figure(s) differ', n));

    -- (over) ...and it held over something: the owner and the director read
    -- batting, bowling and dismissals for §22's three boys, whose log carries
    -- every rule, and the Westville administrator reads his own boys.
    PERFORM _as(U_OWNER);
    SELECT (SELECT count(*) FROM player_batting_career WHERE player_id IN ('aaaaaaaa-0000-0000-0000-00000000044a', 'aaaaaaaa-0000-0000-0000-00000000044b'))
         + (SELECT count(*) FROM player_bowling_career WHERE player_id = 'aaaaaaaa-0000-0000-0000-00000000044c')
         + (SELECT count(*) FROM player_dismissals     WHERE player_id IN ('aaaaaaaa-0000-0000-0000-00000000044a', 'aaaaaaaa-0000-0000-0000-00000000044b'))
      INTO n;
    PERFORM _as(U_SARAH);
    SELECT (SELECT count(*) FROM player_batting_career WHERE player_id IN ('aaaaaaaa-0000-0000-0000-00000000044a', 'aaaaaaaa-0000-0000-0000-00000000044b'))
         + (SELECT count(*) FROM player_bowling_career WHERE player_id = 'aaaaaaaa-0000-0000-0000-00000000044c')
         + (SELECT count(*) FROM player_dismissals     WHERE player_id IN ('aaaaaaaa-0000-0000-0000-00000000044a', 'aaaaaaaa-0000-0000-0000-00000000044b'))
      INTO n2;
    SELECT count(*) INTO n3 FROM player_batting_career;
    PERFORM _as(U_WES_ADM);
    SELECT (SELECT count(*) FROM player_batting_career WHERE player_id = P_WES)
         + (SELECT count(*) FROM player_bowling_career WHERE player_id = P_WES2) INTO n4;
    -- (over)
    PERFORM _assert(n = 5 AND n2 = 5 AND n3 > 2 AND n4 = 2,
      format('db/49 (over): the owner reads %s and the director %s of §22''s five lifetime rows (expected 5 and 5), the director %s batting rows in all '
             || '(expected more than §22''s two), the Westville administrator %s of his two boys'' rows (expected 2)', n, n2, n3, n4));
  END;
  PERFORM set_config('app.user_id', '', true);

  -- ── 28. The pad's resume credential (SCRBRD-078 option B, db/50) ────
  -- A request signed with the credential runs as the scorer, on his phone,
  -- with app.scope = 'pad' and app.match_id — its match. db/50 narrows that
  -- principal at two layers: app_can() (fixture.read and scoring.edit, on its
  -- fixture, and nothing else; app_holds/app_may_grant false) and a
  -- RESTRICTIVE pad_scope_<cmd> policy on every table behind RLS. Each claim
  -- below is one of those, on two fixtures nothing else here touches (F1 and
  -- F2, copies of M_HANDOVER), and then every way a credential ends.
  --
  -- Each labelled assertion was falsified once — the one thing it guards
  -- broken, as the owner, on a fresh seed, and the whole file run — and each
  -- was the FIRST assertion in the file to go red:
  --
  --   (guards)          pad_scope_select dropped from sport
  --   (definers)        a new SECURITY DEFINER function asking fixture.read
  --   (issue-holder)    pad_resume_issue() without its token-holder check
  --   (issue-shape)     pad_jwk_is_public_p256() answering true
  --   (reissued)        the 'reissued' UPDATE and the one-live index gone
  --   (reads-log)       both layers on ball_event: a permissive policy true
  --                     under pad scope, and its pad_scope_select true
  --   (reads-toss)      the same, on match_toss
  --   (reads-else)      pad_scope_select on sport made true (a policy that
  --                     never asks app_can(): only the guard stands there)
  --   (writes-toss)     both layers on match_toss UPDATE
  --   (writes-other)    both layers on ball_event INSERT
  --   (writes-own)      ball_event's INSERT carve-out removed
  --   (writes-own-row)  pad_scope_insert on request_replay made true
  --   (arm)             scoring_arm_handover() without db/50's first line
  --   (doors)           app_can() restored to db/35's (no pad guard)
  --   (holds)           app_holds() restored to db/35's
  --   (reclaim)         pad_resume_reclaim() without its own-match check
  --   (spend)           pad_resume_spend() without its replay refusal
  --   (end-claimed)     the scoring_session UPDATE trigger dropped
  --   (end-handover)    the trigger revoking on ANY state change (so arming
  --                     ended it)
  --   (end-release)     a force-release recorded as token_moved
  --   (end-sign-out)    pad_resume_sign_out() revoking nothing
  --   (end-office)      pad_resume_revoke() asking scoring.edit, not user.invite
  --   (end-day)         pad_resume_ended() without the expiry arm
  --   (end-match)       the match.status trigger dropped
  --
  -- Several are closed at BOTH layers (app_can() and the restrictive guard);
  -- for those the break had to take both away before anything could read or
  -- write, which is the point of having two.
  DECLARE
    F1  uuid := '77777777-0000-0000-0000-00000000050a';
    F2  uuid := '77777777-0000-0000-0000-00000000050b';
    DEV text := 'verify-050';
    JWK jsonb := '{"kty":"EC","crv":"P-256","x":"MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4","y":"4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM"}';
    C1  uuid; C1b uuid; C2 uuid; C3 uuid; C4 uuid; C5 uuid; C6 uuid; C7 uuid;
    e1  integer; e2 integer;
    n   bigint; n2 bigint;
    t   record;
    x   record;
    detail text;
  BEGIN
    PERFORM _db50_fixture(F1, M_HANDOVER);
    PERFORM _db50_fixture(F2, M_HANDOVER);

    -- (guards) Every table behind RLS carries a restrictive pad guard for
    -- every command a permissive policy there admits. db/50 checked this when
    -- it ran; a table added since without pad_scope_guard_install() is here.
    SELECT count(*), string_agg(format('%s.%s', c.relname, cm.cmd), ', ') INTO n, detail
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     CROSS JOIN (VALUES ('r', 'select'), ('a', 'insert'), ('w', 'update'), ('d', 'delete')) AS cm(code, cmd)
     WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
       AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive AND p.polcmd IN ('*', cm.code::"char"))
       AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND NOT p.polpermissive
                          AND p.polname = 'pad_scope_' || cm.cmd AND p.polcmd = cm.code::"char");
    -- (guards)
    PERFORM _assert(n = 0, format('db/50 (guards): %s command(s) behind RLS have no pad guard: %s', n, detail));

    -- (definers) The SECURITY DEFINER functions that ask about one of the
    -- credential's own capabilities (fixture.read, scoring.edit) — or the
    -- scoring.start it lacks — by name: app_can() narrows every one to the
    -- credential's match, so each is a door the credential may reach there,
    -- and db/50's header says why each is safe. A new one is a new door, and
    -- fails here until somebody has looked at it and added it to this list.
    SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO detail
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prosecdef
       -- not app_can() itself (its guard names both), nor this file's own helpers
       AND p.proname <> 'app_can' AND p.proname !~ '^_'
       AND (p.prosrc LIKE '%''fixture.read''%' OR p.prosrc LIKE '%''scoring.edit''%' OR p.prosrc LIKE '%''scoring.start''%');
    -- match_fold_context (db/54): the fixture's start and format, the two
    -- facts the fold is told, for the credential's own match only.
    -- match_conditions_fix, match_conditions_resolve, match_playing_conditions
    -- (db/61, SCRBRD-114): the playing conditions the fold is told, read for
    -- the credential's own match (fixture.read), and fixed on its first event
    -- by the append the credential already makes (scoring.edit) — a league's
    -- published figures, nothing about a person, and no other match's.
    PERFORM _assert(detail = 'duty_status,duty_suspended,match_conditions_fix,match_conditions_resolve,match_fold_context,'
                             || 'match_playing_conditions,pad_resume_issue,pad_resume_reclaim,scoring_arm_handover,scoring_claim,'
                             || 'scoring_claim_handover,scoring_lease_check,scoring_verify_takeover,trip_fixture_driver_only',
      format('db/50 (definers): the definer functions asking a pad capability by name are %s — a new one needs looking at', detail));

    -- ── Issued to the phone that holds the token, and only then ──
    PERFORM _scoring_session_reset(F1);
    PERFORM _as(U_SCORER);
    PERFORM set_config('app.device_id', DEV, true);
    SELECT i.reason INTO v_reason FROM pad_resume_issue(F1, repeat('1', 64), JWK) i;
    -- (issue-holder)
    PERFORM _assert(v_reason = 'not_token_holder', format('db/50 (issue-holder): a credential was issued with no claim (%s)', v_reason));
    SELECT c.ok, c.epoch INTO v_ok, e1 FROM scoring_claim(F1, DEV) c;
    PERFORM _assert(v_ok, 'db/50: the scorer could not claim the fixture §28 scores');
    SELECT c.ok, c.epoch INTO v_ok, e2 FROM scoring_claim(F2, DEV) c;
    PERFORM _assert(v_ok, 'db/50: the scorer could not claim the second fixture §28 scores');
    SELECT i.reason INTO v_reason FROM pad_resume_issue(F1, repeat('1', 64), JWK || '{"d":"870MB6gfuTJ4HtUnUvYMyJpr5eUZNP4Bk43bVdj3eAE"}') i;
    SELECT i.reason INTO detail FROM pad_resume_issue(F1, 'not-a-hash', JWK) i;
    -- (issue-shape)
    PERFORM _assert(v_reason = 'bad_key' AND detail = 'bad_credential',
      format('db/50 (issue-shape): a private key read %s and a malformed hash %s, expected bad_key and bad_credential', v_reason, detail));
    SELECT i.credential INTO C1 FROM pad_resume_issue(F1, repeat('1', 64), JWK) i;
    SELECT i.credential INTO C1b FROM pad_resume_issue(F1, repeat('2', 64), JWK) i;
    -- (reissued) one live credential per person, phone and match
    PERFORM _assert(C1 IS NOT NULL AND C1b IS NOT NULL AND _db50_reason(C1) = 'reissued' AND _db50_reason(C1b) = 'live',
      format('db/50 (reissued): the first credential is %s and the second %s, expected reissued and live', _db50_reason(C1), _db50_reason(C1b)));

    -- ── Reads: its match's log, session and toss, and nothing else ──
    -- A toss on F1, by the scorer signed in, so there is one to read — and a
    -- ball on F2 (which he holds too), so there is another match's log.
    INSERT INTO match_toss (match_id, school_id, won_by, decision, called_by)
    VALUES (F1, match_school(F1), 'home', 'bat', U_SCORER);
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, payload)
    VALUES (F2, match_school(F2), 1, e2, 0, U_SCORER, DEV, 'verify:050:f2:1', 1, now(), 'innings_start', '{}'::jsonb);
    SELECT count(*) INTO n2 FROM ball_event WHERE match_id <> F1;
    PERFORM set_config('app.scope', 'pad', true);
    PERFORM set_config('app.match_id', F1::text, true);
    SELECT count(*) INTO n FROM ball_event WHERE match_id <> F1;
    -- (reads-log) another match's balls: none, where the same scorer signed in reads them
    PERFORM _assert(n = 0 AND n2 > 0,
      format('db/50 (reads-log): as a credential for F1 the scorer read %s balls of other matches (signed in: %s)', n, n2));
    SELECT count(*) INTO n FROM match_toss WHERE match_id = F1;
    SELECT count(*) INTO n2 FROM (SELECT 1 FROM match_toss WHERE match_id <> F1 UNION ALL SELECT 1 FROM scoring_session WHERE match_id <> F1) o;
    -- (reads-toss) its toss and session, and no other match's
    PERFORM _assert(n = 1 AND n2 = 0 AND (SELECT count(*) FROM scoring_session WHERE match_id = F1) = 1,
      format('db/50 (reads-toss): its toss read %s (expected 1), other matches'' tosses and sessions %s (expected 0)', n, n2));
    -- (reads-else) every other table behind RLS the application may read:
    -- nothing at all — the pupils, the medical record, the scorer's own rows,
    -- the fixture itself and its squad, availability and officials included.
    n := 0; detail := '';
    FOR t IN SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
                AND c.relname NOT IN ('ball_event', 'ball_event_quarantine', 'scoring_session', 'match_toss')
                AND has_table_privilege('scrbrd_app', c.oid, 'SELECT')
              ORDER BY 1 LOOP
      EXECUTE format('SELECT count(*) FROM %I', t.relname) INTO n2;
      IF n2 > 0 THEN n := n + n2; detail := detail || format('%s %s; ', t.relname, n2); END IF;
    END LOOP;
    PERFORM _assert(n = 0, format('db/50 (reads-else): a credential read %s rows beyond its match''s log: %s', n, left(detail, 400)));
    PERFORM set_config('app.scope', '', true);
    SELECT (SELECT count(*) FROM player) + (SELECT count(*) FROM match) + (SELECT count(*) FROM app_user) INTO n;
    PERFORM set_config('app.scope', 'pad', true);
    -- (reads-else), the control: signed in, the same scorer reads them
    PERFORM _assert(n > 0, 'db/50 (reads-else): the control read nothing signed in, so the pad''s nothing proved nothing');

    -- ── Writes: its match's events, and nothing else ──
    -- (writes-toss) the toss is read, never written, with a credential. F1
    -- has no ball yet, so nothing but the two layers stands in the way.
    BEGIN
      UPDATE match_toss SET decision = 'bowl' WHERE match_id = F1;
      GET DIAGNOSTICS n = ROW_COUNT;
      PERFORM _assert(n = 0, 'db/50 (writes-toss): a credential changed its match''s toss');
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, payload)
      VALUES (F2, match_school(F2), 2, e2, 0, U_SCORER, DEV, 'verify:050:f2:2', 2, now(), 'innings_start', '{}'::jsonb);
      -- (writes-other) the scorer holds F2's token on this phone, signed in: only the pad scope stops this
      PERFORM _assert(false, 'db/50 (writes-other): a credential for F1 wrote a ball on F2');
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    detail := NULL;
    BEGIN
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, payload)
      VALUES (F1, match_school(F1), 1, e1, 0, U_SCORER, DEV, 'verify:050:f1:1', 1, now(), 'innings_start', '{}'::jsonb);
    EXCEPTION WHEN insufficient_privilege THEN detail := SQLERRM;
    END;
    SELECT count(*) INTO n FROM ball_event WHERE match_id = F1;
    -- (writes-own) its own match's ball, under the token, goes in
    PERFORM _assert(n = 1, format('db/50 (writes-own): the credential''s ball on F1 is %s rows, expected 1 (%s)', n, detail));
    BEGIN
      INSERT INTO request_replay (person_id, key, route, status, body)
      VALUES (U_SCORER, 'verify:050:replay', 'POST /x', 200, '{}'::jsonb);
      -- (writes-own-row) a policy that asks only who the caller is: the restrictive guard closes it
      PERFORM _assert(false, 'db/50 (writes-own-row): a credential wrote a row of its person''s own (request_replay)');
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- ── The doors: app_can() narrowed, and the one claim a credential makes ──
    SELECT a.reason INTO v_reason FROM scoring_arm_handover(F1, DEV, 0, false) a;
    -- (arm) arming asks scoring.edit, which the credential has: db/50's guard refuses it
    PERFORM _assert(v_reason = 'no_capability', format('db/50 (arm): a credential armed a handover (%s)', v_reason));
    SELECT (SELECT c.reason FROM scoring_claim(F1, DEV) c) || '/' || (SELECT h.reason FROM scoring_claim_handover(F1, DEV, '000000') h)
           || '/' || (SELECT v.reason FROM scoring_verify_takeover(F1, DEV, 0, 0, 0) v) || '/' || (SELECT f.reason FROM scoring_force_release(F1) f)
      INTO detail;
    v_ok := false;
    BEGIN
      PERFORM scoring_lease_check(F2, DEV, e2);
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
    END;
    -- (doors) app_can() itself, and every door that asks it: a direct claim,
    -- a handover claimed or verified, a force-release, another match's
    -- heartbeat — refused; its own two capabilities on its own fixture — not
    PERFORM _assert(detail = 'no_capability/no_capability/no_capability/no_capability' AND v_ok
                    AND NOT app_can('fixture.read', match_school(F2), match_team(F2), NULL, F2)
                    AND NOT app_can('player.read', HIL, NULL, '00000000-0000-0000-0000-000000000000'::uuid, NULL)
                    AND NOT app_can('scoring.start', match_school(F1), match_team(F1), NULL, F1)
                    AND app_can('scoring.edit', match_school(F1), match_team(F1), NULL, F1)
                    AND app_can('fixture.read', match_school(F1), match_team(F1), NULL, F1),
      format('db/50 (doors): claim/handover-claim/verify/force-release answered %s, another match''s heartbeat refused: %s, '
             || 'or app_can() answered outside the credential''s two capabilities on its fixture', detail, v_ok));
    SELECT l.holds INTO v_ok FROM scoring_lease_check(F1, DEV, e1) l;
    -- the control: its own heartbeat holds
    PERFORM _assert(v_ok, 'db/50 (doors): the credential''s heartbeat does not hold its own lease');
    -- (holds) nothing platform-wide, nothing to grant, no second credential
    PERFORM _assert(NOT app_holds('fixture.read') AND NOT app_may_grant('scorer')
                    AND (SELECT i.reason FROM pad_resume_issue(F1, repeat('3', 64), JWK) i) = 'not_permitted'
                    AND pad_resume_sign_out() = 0,
      'db/50 (holds): under pad scope app_holds/app_may_grant answered true, or a credential minted or signed out');
    SELECT c.ok, c.epoch INTO v_ok, n FROM pad_resume_reclaim(F1) c;
    SELECT c.reason INTO v_reason FROM pad_resume_reclaim(F2) c;
    -- (reclaim) its own token taken back (the next generation), never another match's
    PERFORM _assert(v_ok AND n = e1 + 1 AND v_reason = 'not_permitted' AND _db50_reason(C1b) = 'live'
                    AND current_setting('app.scope', true) = 'pad',
      format('db/50 (reclaim): F1 %s at %s (expected true at %s), F2 %s, credential %s, scope after %s',
             v_ok, n, e1 + 1, v_reason, _db50_reason(C1b), current_setting('app.scope', true)));
    e1 := e1 + 1;

    -- ── Spending a one-time id ──
    SELECT s.ok INTO v_ok FROM pad_resume_spend(C1b, 'verify-050-jti-0001') s;
    SELECT s.reason INTO v_reason FROM pad_resume_spend(C1b, 'verify-050-jti-0001') s;
    SELECT s.reason INTO detail FROM pad_resume_spend(C1b, 'short') s;
    -- (spend) once, and never again
    PERFORM _assert(v_ok AND v_reason = 'replay' AND detail = 'bad_jti' AND _db50_jtis(C1b) = 1,
      format('db/50 (spend): first %s, again %s, a short id %s, %s kept', v_ok, v_reason, detail, _db50_jtis(C1b)));
    PERFORM set_config('app.scope', '', true);
    PERFORM set_config('app.match_id', '', true);

    -- ── Every way it ends ──
    -- (end-claimed) another phone claims after the lease lapsed: the token moved
    PERFORM _lapse_scoring_lease(F1);
    PERFORM set_config('app.device_id', 'verify-050-other', true);
    SELECT c.ok INTO v_ok FROM scoring_claim(F1, 'verify-050-other') c;
    PERFORM set_config('app.device_id', DEV, true);
    PERFORM set_config('app.scope', 'pad', true);
    PERFORM set_config('app.match_id', F1::text, true);
    SELECT c.reason INTO v_reason FROM pad_resume_reclaim(F1) c;
    PERFORM set_config('app.scope', '', true);
    PERFORM set_config('app.match_id', '', true);
    PERFORM _assert(v_ok AND _db50_reason(C1b) = 'token_moved' AND v_reason = 'token_moved',
      format('db/50 (end-claimed): the other phone claimed %s; the credential is %s and its re-claim %s', v_ok, _db50_reason(C1b), v_reason));

    -- (end-handover) armed, the credential stands; taken over, it ends
    SELECT i.credential INTO C2 FROM pad_resume_issue(F2, repeat('4', 64), JWK) i;
    SELECT a.ok, a.code INTO v_ok, v_code FROM scoring_arm_handover(F2, DEV, 0, false) a;
    detail := _db50_reason(C2);
    PERFORM _as(U_SARAH);
    PERFORM set_config('app.device_id', 'verify-050-sarah', true);
    PERFORM scoring_claim_handover(F2, 'verify-050-sarah', v_code);
    SELECT v.ok INTO v_ok FROM scoring_verify_takeover(F2, 'verify-050-sarah', 0, 0, 0) v;
    PERFORM _assert(v_ok AND detail = 'live' AND _db50_reason(C2) = 'token_moved',
      format('db/50 (end-handover): taken over %s; armed %s, then %s', v_ok, detail, _db50_reason(C2)));

    -- (end-release) force-released: it ends
    SELECT i.credential INTO C3 FROM pad_resume_issue(F2, repeat('5', 64), JWK) i;
    PERFORM _lapse_scoring_lease(F2);
    SELECT f.ok INTO v_ok FROM scoring_force_release(F2) f;
    PERFORM _assert(C3 IS NOT NULL AND v_ok AND _db50_reason(C3) = 'released',
      format('db/50 (end-release): issued %s, released %s, then %s', C3 IS NOT NULL, v_ok, _db50_reason(C3)));

    -- (end-sign-out) the phone signs out: its credentials end, nobody else's
    PERFORM _as(U_SCORER);
    PERFORM set_config('app.device_id', DEV, true);
    SELECT c.ok INTO v_ok FROM scoring_claim(F2, DEV) c;
    SELECT i.credential INTO C4 FROM pad_resume_issue(F2, repeat('6', 64), JWK) i;
    n := pad_resume_sign_out();
    PERFORM _assert(v_ok AND n = 1 AND _db50_reason(C4) = 'signed_out' AND _db50_reason(C3) = 'released',
      format('db/50 (end-sign-out): signed out %s, the credential %s', n, _db50_reason(C4)));

    -- (end-office) the school office ends it, under user.invite at the match's
    -- school — and nobody else can: not the scorer, not the 2XI coach, not
    -- Westville's office. The office reads the table; the scorer does not.
    SELECT i.credential INTO C5 FROM pad_resume_issue(F2, repeat('7', 64), JWK) i;
    SELECT count(*) INTO n2 FROM pad_resume_credential;
    detail := (SELECT r.reason FROM pad_resume_revoke(F2) r);
    PERFORM _as(U_COACH2);
    detail := detail || '/' || (SELECT r.reason FROM pad_resume_revoke(F2) r);
    PERFORM _as(U_WES_ADM);
    detail := detail || '/' || (SELECT r.reason FROM pad_resume_revoke(F2) r);
    v_state := _db50_reason(C5);
    PERFORM _as(U_REGISTRAR);
    SELECT count(*) INTO n FROM pad_resume_credential WHERE match_id IN (F1, F2);
    SELECT r.revoked INTO e2 FROM pad_resume_revoke(F2) r;
    PERFORM _assert(detail = 'not_permitted/not_permitted/not_permitted' AND v_state = 'live' AND n2 = 0 AND n >= 5
                    AND e2 = 1 AND _db50_reason(C5) = 'office',
      format('db/50 (end-office): scorer/2XI coach/Westville answered %s (credential then %s); the scorer read %s rows, the office %s; '
             || 'the office revoked %s and it is %s', detail, v_state, n2, n, e2, _db50_reason(C5)));

    -- (end-day) past midnight, Johannesburg: expired, whatever else is true
    PERFORM _as(U_SCORER);
    PERFORM set_config('app.device_id', DEV, true);
    SELECT i.credential INTO C6 FROM pad_resume_issue(F2, repeat('8', 64), JWK) i;
    PERFORM _db50_expire(C6);
    SELECT l.ended INTO v_reason FROM pad_resume_lookup(repeat('8', 64)) l;
    SELECT s.reason INTO detail FROM pad_resume_spend(C6, 'verify-050-jti-0002') s;
    PERFORM _assert(v_reason = 'expired' AND detail = 'expired',
      format('db/50 (end-day): looked up %s, spent %s, expected expired and expired', v_reason, detail));

    -- (end-match) the match completes: it ends, and none is issued after
    SELECT i.credential INTO C7 FROM pad_resume_issue(F2, repeat('9', 64), JWK) i;
    PERFORM _as(U_SARAH);
    UPDATE match SET status = 'complete' WHERE id = F2;
    PERFORM _as(U_SCORER);
    SELECT i.reason INTO v_reason FROM pad_resume_issue(F2, repeat('a', 64), JWK) i;
    PERFORM _assert(C7 IS NOT NULL AND _db50_reason(C7) = 'match_complete' AND v_reason = 'match_complete',
      format('db/50 (end-match): the credential is %s, a new issue %s', _db50_reason(C7), v_reason));
  END;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.match_id', '', true);
  PERFORM set_config('app.device_id', '', true);
  PERFORM set_config('app.user_id', '', true);

  -- ── 29. The milestone trigger reads the striker's own balls (SCRBRD-097, db/51) ──
  -- milestone_watch() asked player_innings for the striker's innings and his
  -- career on every scoring ball, and the career question read every
  -- delivery in the log through two of its three arms — the bulk load's
  -- players × balls. db/51 asks two helpers instead, each a sum of runs off
  -- the bat over the balls he faced: the only arm that carries runs. They
  -- are held here to the composition they replace, as the trigger reads it
  -- (the owner, past RLS): every innings in the log — the seed, sections 19
  -- to 23, §22's and this section's fixtures, which carry voids, no-ball
  -- byes, retirements marked W and run outs at the other end, including an
  -- innings with no ball faced in it — and every player's career. And the
  -- trigger is held to the notices it calls, one INSERT per delivery. Each
  -- assertion's label names what it guards; db/51 was broken each of these
  -- ways, one at a time, and the whole file run. Each first stops db/51's own
  -- self-check (named on the right); each was run again with that check
  -- lifted, to see this section go red on its own:
  --
  --   milestone_watch() reading player_innings again         → (shape)    db/51: still reads player_innings
  --   career_runs_off_bat() executable by PUBLIC              → (shape)    db/51: executable by PUBLIC
  --   career_runs_off_bat() over ball_event, voids included   → (same)     db/51: the fixture's figures
  --                                                             (§19–§23's voided balls, and this fixture's)
  --   career_runs_off_bat() without its coalesce              → (same)     db/51: the fixture's figures
  --   innings_runs_off_bat() without its innings              → (notices)  db/51: the fixture's notices
  --                                                             (no fifty in the second innings)
  --   the career threshold compared against the innings figure → (notices) db/51: the fixture's notices
  --   the five-for asked of the bowler's career               → (notices)  db/51: the fixture's notices
  DECLARE
    n bigint;
    detail text;
    v_want text := 'A:fifty:a:0:54 A:hundred:a:0:102 C:hat_trick:a:1:3 C:five_for:a:1:5 '
                || 'A:fifty:b:0:54 A:hundred:b:0:102 A:career_runs:b:0:500 '
                || 'C:hat_trick:b:1:3 C:five_for:b:1:5 C:career_wickets:b:0:25 A:fifty:b:2:54';
  BEGIN
    SELECT count(*) INTO n FROM pg_proc p
     WHERE p.oid IN ('innings_runs_off_bat(uuid,uuid,smallint)'::regprocedure, 'career_runs_off_bat(uuid)'::regprocedure)
       AND NOT p.prosecdef
       AND NOT has_function_privilege('scrbrd_app', p.oid, 'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE');
    -- (shape) the trigger no longer reads player_innings; the two helpers are invoker, and nobody's but the owner's
    PERFORM _assert(n = 2 AND (SELECT prosrc FROM pg_proc WHERE oid = 'milestone_watch()'::regprocedure) !~ 'player_innings',
      format('db/51 (shape): %s of the 2 helpers are invoker and callable by nobody but the owner (expected 2); '
             || 'milestone_watch() reads player_innings: %s', n,
             (SELECT prosrc FROM pg_proc WHERE oid = 'milestone_watch()'::regprocedure) ~ 'player_innings'));

    -- (notices) one INSERT per delivery, every kind the trigger writes
    detail := _milestone_fixture_51();
    PERFORM _assert(detail IS NOT DISTINCT FROM v_want,
      format('db/51 (notices): the fixture raised %s, expected %s', detail, v_want));

    -- (same) THE INVARIANT, over the whole log, this section's fixture included
    SELECT count(*), string_agg(format('%s %s/%s/%s: own balls %s, player_innings %s', d.figure, d.player_id,
                                       d.match_id, d.innings, d.own_balls, d.player_innings), '; ')
      INTO n, detail FROM _milestone_figure_drift() d;
    PERFORM _assert(n = 0,
      format('db/51 (same): %s figure(s) the milestone trigger reads are not what player_innings says — %s', n, left(detail, 600)));
  END;
  -- ── 30. A no-ball's byes and leg byes are not the bowler's (Law 21.15, db/52) ──
  -- The rule as the current Code has it: a no-ball's penalty run and the runs
  -- off the bat are debited to the bowler; runs not off the bat are byes or
  -- leg byes, and not his. ball_runs_to_bowler() is runsToBowler() in SQL
  -- (packages/scoring/src/events.mjs), and every reader of a bowler's runs
  -- asks it. §19, §22 and db/43's fixture above carry no-ball byes and leg
  -- byes and were moved to it; this section holds the rule itself, that every
  -- reader asks it, and that they agree over the whole log — the seed and
  -- every fixture above. db/52 was broken each of these ways and this file
  -- run: the no-ball arm charging 1 + value again (→ rule, and §19/§22/db/43's
  -- figures); player_bowling_career summing the old CASE (→ readers, same).
  DECLARE
    n bigint;
    detail text;
  BEGIN
    -- (rule) runsToBowler()'s table (replay.test.mjs, K)
    PERFORM _assert(ball_runs_to_bowler('Nb', 4, '{"nbRuns":"byes"}') = 1
                    AND ball_runs_to_bowler('Nb', 3, '{"nbRuns":"leg_byes"}') = 1
                    AND ball_runs_to_bowler('Nb', 4, '{}') = 5 AND ball_runs_to_bowler('Nb', 0, '{}') = 1
                    AND ball_runs_to_bowler('Wd', 2, '{}') = 3 AND ball_runs_to_bowler('B', 4, '{}') = 0
                    AND ball_runs_to_bowler('LB', 1, '{}') = 0 AND ball_runs_to_bowler('run', 6, '{}') = 6
                    AND ball_runs_to_bowler('W', 1, '{}') = 1,
      'db/52 (rule): ball_runs_to_bowler() is not runsToBowler() — a no-ball is its penalty run and the runs off the bat, never its byes or leg byes');

    -- (readers) the five that charge a bowler all ask it
    SELECT count(*), string_agg(o, ', ') INTO n, detail FROM (
      SELECT 'player_bowling_since' AS o, prosrc AS src FROM pg_proc WHERE oid = 'player_bowling_since(uuid,timestamptz)'::regprocedure
      UNION ALL SELECT 'opposition_squad', prosrc FROM pg_proc WHERE oid = 'opposition_squad(uuid)'::regprocedure
      UNION ALL SELECT 'bowler_innings_figures', pg_get_viewdef('bowler_innings_figures'::regclass)
      UNION ALL SELECT 'player_bowling_by_season', pg_get_viewdef('player_bowling_by_season'::regclass)
      UNION ALL SELECT 'player_bowling_career', pg_get_viewdef('player_bowling_career'::regclass)) d
     WHERE d.src NOT LIKE '%ball_runs_to_bowler(%';
    PERFORM _assert(n = 0, format('db/52 (readers): %s do(es) not charge the bowler through ball_runs_to_bowler(): %s', n, coalesce(detail, '')));

    -- (same) over the whole log, as this reader sees it: the lifetime view,
    -- the windowed function, the seasons summed and the innings summed
    SELECT count(*), string_agg(k, '; ') INTO n, detail FROM (
      SELECT 'career/since ' || coalesce(l.player_id, o.player_id) AS k
        FROM player_bowling_career l
        FULL JOIN (SELECT p.id AS player_id, c.* FROM player p CROSS JOIN LATERAL player_bowling_since(p.id, NULL) c
                    WHERE c.matches > 0) o ON o.player_id = l.player_id
       WHERE l.runs_conceded IS DISTINCT FROM o.runs_conceded
      UNION ALL
      SELECT 'career/seasons ' || l.player_id
        FROM player_bowling_career l
        JOIN (SELECT player_id, sum(runs_conceded) AS runs FROM player_bowling_by_season GROUP BY player_id) x
          ON x.player_id = l.player_id
       WHERE l.runs_conceded IS DISTINCT FROM x.runs
      UNION ALL
      SELECT 'career/innings ' || l.player_id
        FROM player_bowling_career l
        JOIN (SELECT player_id, sum(runs_conceded) AS runs FROM bowler_innings_figures GROUP BY player_id) f
          ON f.player_id = l.player_id
       WHERE l.runs_conceded IS DISTINCT FROM f.runs) d;
    PERFORM _assert(n = 0, format('db/52 (same): %s bowler figure(s) disagree between the readers — %s', n, left(coalesce(detail, ''), 600)));
  END;

  -- ── 31. Retired out, back with the opposing captain's consent (Law 25.4.3, db/53) ──
  -- A `retire` marked W is a wicket from the moment it is recorded; a later
  -- live `batters` row naming the same batter with captainConsent takes it
  -- back, as the fold does (replay.mjs). ball_event_live reads such a
  -- retirement as no wicket (ball type and dismissal NULL), so every reader
  -- follows: the live score, the handover's count, player_innings, the
  -- dismissal readers. Read as the owner of the platform, under RLS.
  -- _seed_53() writes the fixtures; _void_53() undoes M1's return. db/53 was
  -- broken each of these ways and this file run, with db/53's own proof
  -- lifted (it refuses all but the third itself):
  --   the view's CASEs answering false (no retirement ever resumed) → (b)
  --   retirement_resumed() ignoring voids                          → (c)
  --   retirement_resumed() not checking the batter                 → (b): A's career
  --     lost M2's retirement, which C's return does not take back
  --   retirement_resumed() reading payload names only (not the id columns) → (b)
  PERFORM set_config('app.user_id', '', true);
  PERFORM _seed_53();
  PERFORM _as(U_OWNER);
  DECLARE
    A  uuid := 'aaaaaaaa-0000-0000-0000-00000000053a';
    C  uuid := 'aaaaaaaa-0000-0000-0000-00000000053c';
    M1 uuid := '77777777-0000-0000-0000-000000053001';
    M2 uuid := '77777777-0000-0000-0000-000000053002';
    got text;
  BEGIN
    -- (a) the view asks the rule
    PERFORM _assert((SELECT count(*) FROM regexp_matches(pg_get_viewdef('ball_event_live'::regclass), 'retirement_resumed\(', 'g')) = 2,
      'db/53 (a): ball_event_live does not read a resumed retirement through retirement_resumed()');

    -- (b) M1, "the db/53 fixture": 6 for 1, A not out, his dismissal gone
    SELECT concat_ws(' ',
             (SELECT 'live' || row(s.runs, s.wickets, s.legal_balls)::text FROM match_live_score s WHERE s.match_id = M1 AND s.innings = 0),
             (SELECT 'handover' || row(f.runs, f.wickets, f.legal_balls)::text FROM innings_score_as_folded(M1, 0::smallint) f),
             (SELECT 'A' || row(i.runs, i.balls_faced, i.out)::text FROM player_innings i WHERE i.player_id = A AND i.match_id = M1),
             (SELECT 'C' || row(i.runs, i.balls_faced, i.out)::text FROM player_innings i WHERE i.player_id = C AND i.match_id = M1),
             'dismissals' || row(coalesce((SELECT d.dismissals FROM player_dismissals d WHERE d.player_id = A), 0),
                                 coalesce((SELECT sum(d.dismissals) FROM player_dismissal_breakdown d WHERE d.player_id = A), 0))::text)
      INTO got;
    -- A's career: one dismissal, M2's retirement that stands — not M1's.
    PERFORM _assert(got = 'live(6,1,4) handover(6,1,4) A(6,2,f) C(0,2,t) dismissals(1,1)',
      format('db/53 (b): the consented return reads %s, the fold reads live(6,1,4) handover(6,1,4) A(6,2,f) C(0,2,t) dismissals(1,1)', got));

    -- (d) M2: a consented return for somebody else leaves A's retirement
    --     standing; a typed name's is taken back
    SELECT concat_ws(' ',
             (SELECT 'live' || row(s.wickets)::text FROM match_live_score s WHERE s.match_id = M2 AND s.innings = 0),
             (SELECT 'A' || row(i.out)::text FROM player_innings i WHERE i.player_id = A AND i.match_id = M2),
             (SELECT 'typed' || row(coalesce(l.ball_type, '-'))::text FROM ball_event_live l WHERE l.match_id = M2 AND l.seq = 4))
      INTO got;
    PERFORM _assert(got = 'live(1) A(t) typed(-)',
      format('db/53 (d): a return naming another batter, or a typed name''s, reads %s; expected live(1) A(t) typed(-)', got));

    -- (c) the return undone: A is out again
    PERFORM _void_53();
    SELECT concat_ws(' ',
             (SELECT 'live' || row(s.wickets)::text FROM match_live_score s WHERE s.match_id = M1 AND s.innings = 0),
             (SELECT 'A' || row(i.out)::text FROM player_innings i WHERE i.player_id = A AND i.match_id = M1))
      INTO got;
    PERFORM _assert(got = 'live(2) A(t)', format('db/53 (c): with the return voided, M1 reads %s; expected live(2) A(t)', got));
  END;

  -- ── 32. A delivery that does not count in the over; the free hit by the format (SCRBRD-113, db/54) ──
  -- Law 17.3.2.5: a delivery under 24.4, 28.2, 41.4 or 41.5 is not one of the
  -- six (payload.notInOver); ball_counts_in_over() is countsInOver() in SQL,
  -- and every reader of the balls of the over asks it. The free hit is a
  -- limited-overs playing condition: none in a declaration or timed match
  -- (free_hits_apply(), freeHitsApply() in SQL), so ball_on_free_hit() asks
  -- the match's format. The fixture (_laws_fixture_54()) is db/54's own; the
  -- invariants run over the whole log this reader sees. db/54 was broken each
  -- of these ways and this file run: bowler_over counting a delivery that
  -- does not count (→ fixture, same), player_bowling_career keeping the old
  -- CASE (→ readers, same), ball_on_free_hit() not asking the format
  -- (→ fixture, readers).
  -- Read as the owner of the platform, named here: the invariants compare
  -- every match, whoever the section before left in the session. With no
  -- principal they compared nothing (an empty user sees no row), and passed.
  -- Once they compared, they found the db/45 section's first innings: a
  -- retire marked W with method bowled, which the live score counted and the
  -- handover's count, as the fold, did not; and a penalty row carrying a
  -- value, which the live score added. db/54 (4) makes the live score count
  -- as the handover does. Broken each way and this file run: the old live
  -- score (→ same, 81/15 against 78/14), its wickets alone (→ same, 15
  -- against 14), its runs alone (→ same, 81 against 78), and the old live
  -- score with no principal set here (→ same, the count below); db/54's own
  -- proof refuses the old live score on its refused rows first.
  PERFORM _as(U_OWNER);
  DECLARE
    n bigint;
    detail text;
    v_want text := 'live(12,3,9) folded(12,3,9) overs(A:0:6/7 C:1:3/4) hattrick(C@13) career(8,3) '
                || 't20(0,true) declaration(1,false,1,1)';
  BEGIN
    -- (rule) countsInOver()'s table (edition.test.mjs, E) and freeHitsApply()'s (G)
    PERFORM _assert(ball_counts_in_over('run', '{}') AND ball_counts_in_over('B', '{}') AND ball_counts_in_over('W', '{}')
                    AND NOT ball_counts_in_over('Wd', '{}') AND NOT ball_counts_in_over('Nb', '{}')
                    AND NOT ball_counts_in_over('run', '{"notInOver":"illegal_fielding"}')
                    AND NOT ball_counts_in_over('LB', '{"notInOver":"obstructing_batter"}')
                    AND ball_counts_in_over('run', '{"notInOver":"helmet_struck"}')
                    AND ball_counts_in_over(NULL, '{}') IS NULL,
      'db/54 (rule): ball_counts_in_over() is not countsInOver() — a delivery under 24.4, 28.2, 41.4 or 41.5 is not one of the six');
    PERFORM _assert(free_hits_apply('T20') AND free_hits_apply('One-Day') AND free_hits_apply(NULL) AND free_hits_apply('50-over')
                    AND NOT free_hits_apply('One-Day Declaration') AND NOT free_hits_apply('Two-Day')
                    AND NOT free_hits_apply(' multi-day ') AND NOT free_hits_apply('Timed'),
      'db/54 (rule): free_hits_apply() is not freeHitsApply() — no free hit in a declaration or timed match, one in every other');

    -- (readers) every reader of the balls of the over asks the rule; the free hit asks the format
    SELECT count(*), string_agg(o, ', ') INTO n, detail FROM (
      SELECT 'match_live_score' AS o, pg_get_viewdef('match_live_score'::regclass) AS src
      UNION ALL SELECT 'innings_score_as_folded', prosrc FROM pg_proc WHERE oid = 'innings_score_as_folded(uuid,smallint)'::regprocedure
      UNION ALL SELECT 'bowler_over', pg_get_viewdef('bowler_over'::regclass)
      UNION ALL SELECT 'bowler_hat_trick', pg_get_viewdef('bowler_hat_trick'::regclass)
      UNION ALL SELECT 'player_bowling_since', prosrc FROM pg_proc WHERE oid = 'player_bowling_since(uuid,timestamptz)'::regprocedure
      UNION ALL SELECT 'opposition_squad', prosrc FROM pg_proc WHERE oid = 'opposition_squad(uuid)'::regprocedure
      UNION ALL SELECT 'player_bowling_by_season', pg_get_viewdef('player_bowling_by_season'::regclass)
      UNION ALL SELECT 'player_bowling_career', pg_get_viewdef('player_bowling_career'::regclass)) d
     WHERE d.src NOT LIKE '%ball_counts_in_over(%';
    PERFORM _assert(n = 0, format('db/54 (readers): %s do(es) not count the balls of the over through ball_counts_in_over(): %s', n, coalesce(detail, '')));
    PERFORM _assert((SELECT prosrc FROM pg_proc WHERE oid = 'ball_on_free_hit(uuid,smallint,integer)'::regprocedure) LIKE '%match_free_hits_apply(p_match)%',
      'db/54 (readers): ball_on_free_hit() does not ask the match''s format');

    -- (fixture) db/54's, read through every reader it moved
    detail := _laws_fixture_54();
    PERFORM _assert(detail IS NOT DISTINCT FROM v_want, format('db/54 (fixture): the fixture reads %s, the fold reads %s', detail, v_want));

    -- (same) over the whole log, as the owner sees it: the live score and
    -- the handover check's count, innings by innings — runs, wickets and
    -- balls of the over; a bowler's career balls and the overs he bowled.
    -- And that there is a whole log to compare: an empty session passes.
    SELECT count(*), string_agg(k, '; ') INTO n, detail FROM (
      SELECT 'live/folded ' || l.match_id || '/' || l.innings
             || ' ' || row(l.runs, l.wickets, l.legal_balls)::text || ' vs ' || row(f.runs, f.wickets, f.legal_balls)::text AS k
        FROM match_live_score l CROSS JOIN LATERAL innings_score_as_folded(l.match_id, l.innings::smallint) f
       WHERE l.legal_balls IS DISTINCT FROM f.legal_balls::bigint OR l.wickets IS DISTINCT FROM f.wickets::bigint
          OR l.runs IS DISTINCT FROM f.runs::bigint
      UNION ALL
      SELECT 'career/overs ' || c.player_id
        FROM player_bowling_career c
        JOIN (SELECT bowler_id, sum(legal_balls) AS balls FROM bowler_over GROUP BY bowler_id) o ON o.bowler_id = c.player_id
       WHERE c.legal_balls IS DISTINCT FROM o.balls) d;
    PERFORM _assert(n = 0, format('db/54 (same): %s figure(s) disagree between the readers — %s', n, left(coalesce(detail, ''), 600)));
    SELECT count(*) INTO n FROM match_live_score;
    PERFORM _assert(n >= 10, format('db/54 (same): this section sees %s innings in the live score — the comparison compared nothing', n));

    -- (context) how the server folds a match: its start and format, for a
    -- caller who may read the fixture, and nothing for one who may not
    PERFORM _as(U_SCORER);
    SELECT count(*), max(format) INTO n, detail FROM match_fold_context('77777777-0000-0000-0000-000000000002');
    PERFORM _assert(n = 1 AND detail = 'T20', format('db/54 (context): the scorer reads %s row(s) of the fixture''s fold context (%s), expected its one', n, detail));
    PERFORM _as(U_WES_ADM);
    SELECT count(*) INTO n FROM match_fold_context('77777777-0000-0000-0000-000000000002');
    PERFORM _assert(n = 0, format('db/54 (context): another school''s admin reads %s row(s) of a fixture he may not read', n));
  END;

  -- ── 33. A pupil reads no team-mate's injury status (K3, db/55) ──────
  -- CSA Safeguarding Policy p52 item 6: a child's medical needs are for
  -- "staff and coaches who need it, but not in general view to other ...
  -- children". db/55 withdrew medical.status.read from `player` (held across
  -- a side, by children). `enquiry` keeps it (Kameel, 2026-09-28): a grant is
  -- coach to coach, for one named player, and both ends are staff. Each
  -- refusal below is paired with a read that proves the principal is live,
  -- so a zero is the capability refusing and not an empty fixture. db/55 was
  -- undone (its role_capability row put back) and this file run: (pupil)
  -- failed, and 3b and 11 above with it; the enquiry's row was deleted and
  -- (enquiry) failed.
  DECLARE
    n       bigint;
    v_req   uuid;
    v_ok    boolean;
    v_why   text;
    v_asg   uuid;
    I_OTHER uuid := 'cccccccc-0000-0000-0000-000000000002';  -- T Bekker's injury, 1XI
  BEGIN
    -- (catalogue) the pupil's row is gone, and nobody else's went with it
    PERFORM _assert(NOT EXISTS (SELECT 1 FROM role_capability
                                 WHERE role = 'player' AND capability = 'medical.status.read'),
      'db/55 (catalogue): player still holds medical.status.read');
    PERFORM _assert((SELECT count(*) FROM role_capability
                      WHERE capability = 'medical.status.read'
                        AND role IN ('coach', 'assistantcoach', 'teammanager', 'medical', 'enquiry', 'guardian', 'selfaccess',
                                     'principal', 'directorofsport', 'schooladmin', 'sportsadmin')) = 11,
      'db/55 (catalogue): a role that needs the status tier lost it');

    -- (pupil) R Pillay, 1XI, injured, beside T Bekker, 1XI, also injured. His
    -- player assignment is the 1XI's; his selfaccess names him alone.
    PERFORM _as(U_SELF);
    SELECT count(*) INTO n FROM injury_masked WHERE player_id = P_INJURED AND injury_type IS NOT NULL AND notes IS NOT NULL;
    PERFORM _assert(n = 1, format('db/55 (pupil): R Pillay reads %s of his own injury rows at every tier, expected 1 — selfaccess must still reach him', n));
    SELECT count(*) INTO n FROM injury_masked WHERE player_id = P_OTHER;
    PERFORM _assert(n = 0, format('db/55 (pupil): R Pillay reads %s row(s) of his 1XI team-mate''s injury — that he is out, and until when', n));
    SELECT count(*) INTO n FROM injury_masked WHERE player_id <> P_INJURED;
    PERFORM _assert(n = 0, format('db/55 (pupil): R Pillay reads %s injury row(s) about somebody else', n));
    SELECT count(*) INTO n FROM player_masked WHERE id = P_OTHER;
    PERFORM _assert(n = 1, 'db/55 (pupil): R Pillay cannot read his team-mate''s profile at all — the refusal above proves nothing');
    -- a pupil school-wide, with no selfaccess: nothing, and the team sheet still
    PERFORM _as(U_PUPIL);
    SELECT count(*) INTO n FROM injury_masked;
    PERFORM _assert(n = 0, format('db/55 (pupil): a pupil reads %s injury row(s) at his school', n));
    SELECT count(*) INTO n FROM player_masked WHERE id IN (P_INJURED, P_OTHER);
    PERFORM _assert(n = 2, 'db/55 (pupil): a pupil cannot read the side at all — the refusal above proves nothing');

    -- (staff) whoever should, still does
    PERFORM _as(U_MEDICAL);
    SELECT count(*) INTO n FROM injury_masked WHERE id IN (I_OWN, I_OTHER) AND notes IS NOT NULL;
    PERFORM _assert(n = 2, format('db/55 (staff): the physio reads %s of the two 1XI injuries in full', n));
    PERFORM _as(U_SARAH);   -- directorofsport, school-wide
    SELECT count(*) INTO n FROM injury_masked WHERE id IN (I_OWN, I_OTHER) AND rtw_date IS NOT NULL AND injury_type IS NOT NULL;
    PERFORM _assert(n = 2, format('db/55 (staff): the director of sport reads %s of the two 1XI injuries, status and nature', n));
    -- (A guardian's read of his own child is 3b's, above: by this point in
    -- the file earlier sections have moved U_PARENT's link.)

    -- (enquiry) the 2XI coach asks for R Pillay (1XI) and is told yes: the
    -- granted assignment reaches his profile and whether he is out, and until
    -- when — and not what is wrong with him, nor any team-mate of his
    PERFORM _as(U_COACH2);
    SELECT count(*) INTO n FROM injury_masked WHERE player_id = P_INJURED;
    PERFORM _assert(n = 0, 'db/55 (enquiry): the 2XI coach reads a 1XI injury before any grant');
    INSERT INTO access_request (player_id, school_id, for_team, requested_by, reason)
      VALUES (P_INJURED, HIL, '2XI', U_COACH2, 'fill_in') RETURNING id INTO v_req;
    PERFORM _as(U_OWNER);   -- holds player.access.grant everywhere
    SELECT d.ok, d.reason, d.assignment INTO v_ok, v_why, v_asg FROM access_request_decide(v_req, true, NULL, 14) d;
    PERFORM _assert(v_ok AND v_asg IS NOT NULL, format('db/55 (enquiry): the grant was refused (%s)', v_why));
    PERFORM _as(U_COACH2);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_INJURED;
    PERFORM _assert(n = 1, 'db/55 (enquiry): the granted enquiry does not reach the boy''s profile');
    SELECT count(*) INTO n FROM injury_masked WHERE player_id = P_INJURED AND rtw_date IS NOT NULL;
    PERFORM _assert(n = 1, format('db/55 (enquiry): a granted enquiry reads %s of the boy''s injury status rows, expected 1 — that he is out, and until when (Kameel, 2026-09-28)', n));
    SELECT count(*) INTO n FROM injury_masked WHERE player_id = P_INJURED AND (injury_type IS NOT NULL OR notes IS NOT NULL);
    PERFORM _assert(n = 0, 'db/55 (enquiry): a granted enquiry reads what is wrong with the boy');
    SELECT count(*) INTO n FROM injury_masked WHERE player_id <> P_INJURED;
    PERFORM _assert(n = 0, format('db/55 (enquiry): a granted enquiry reads %s injury row(s) about somebody other than the boy granted', n));
  END;

  -- ── 34. The clearance register to CSA's rules (K4, SG-7, db/56) ─────
  -- CSA's Safeguarding Policy: the Sexual Offences Register, the Child
  -- Protection Register and a criminal check for every adult coach,
  -- administrator and official, each no older than 24 months (p19, p24–26),
  -- a first criminal check no older than six months (p26), the Safeguarding
  -- Awareness Certificate annually (p22). Written as the office writes them —
  -- the registrar, under RLS, through db/08's stamp trigger and db/56's age
  -- rule. db/56 was broken each of these ways and this file run: the ages
  -- table emptied (→ (age), (first)); the first-police rule counting a
  -- revoked row as held (→ (first)); clearance_register() without the pupil
  -- exclusion (→ (pupil)); the requirement rows left out (→ (roles), and the
  -- register's own counts).
  DECLARE
    n       bigint;
    v_err   text;
    v_id    uuid;
    U_DRV   uuid := '88888888-0000-0000-0000-000000000017';  -- B Ngcobo, driver; police current
    U_V56   uuid := '88888888-0000-0000-0000-000000000056';  -- S Naidoo, eighteen: player and scorer
    d       date := sa_today();
  BEGIN
    -- (roles) every adult role is asked for the three checks, the SAC and the
    -- acknowledgement; a pupil's and a parent's roles for nothing
    PERFORM _as(U_REGISTRAR);
    SELECT count(DISTINCT role) INTO n FROM clearance_requirement
     WHERE kind = 'sexual_offences_register'
       AND role IN ('coach', 'assistantcoach', 'teammanager', 'medical', 'driver', 'transportcoordinator',
                    'official', 'scorer', 'facilities', 'media', 'scout', 'schooladmin', 'sportsadmin',
                    'directorofsport', 'principal');
    PERFORM _assert(n = 15, format('db/56 (roles): %s of the 15 adult roles are asked for the Sexual Offences Register', n));
    SELECT count(*) INTO n FROM clearance_requirement
     WHERE role IN ('player', 'selfaccess', 'guardian', 'spectator', 'enquiry');
    PERFORM _assert(n = 0, 'db/56 (roles): a pupil''s or a parent''s role is asked for a clearance');
    SELECT count(*) INTO n FROM clearance_register(HIL)
     WHERE person_id = U_SCORER AND kind IN ('police_clearance', 'child_protection', 'sexual_offences_register',
                                             'safeguarding_awareness', 'safeguarding_acknowledgement')
       AND status = 'missing';
    PERFORM _assert(n = 5, format('db/56 (roles): the scorer, an adult, is missing %s of the five checks CSA asks of him, expected all five', n));

    -- (age) a check runs at most its kind's maximum; exactly the maximum is accepted
    BEGIN
      INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on)
        VALUES (U_COACH2, HIL, 'child_protection', 'CPR-V56-001', d - 10, d - 10 + 761);
      v_err := NULL;
    EXCEPTION WHEN check_violation THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err LIKE '%runs at most 731 days%', format('db/56 (age): a 25-month Child Protection Register clearance was not refused (%s)', coalesce(v_err, 'accepted')));
    BEGIN
      INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on)
        VALUES (U_COACH2, HIL, 'sexual_offences_register', 'NRSO-V56-001', d - 10, d - 10 + 732);
      v_err := NULL;
    EXCEPTION WHEN check_violation THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err LIKE '%runs at most 731 days%', format('db/56 (age): a Sexual Offences Register clearance of 732 days was not refused (%s)', coalesce(v_err, 'accepted')));
    INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on)
      VALUES (U_COACH2, HIL, 'sexual_offences_register', 'NRSO-V56-002', d - 10, d - 10 + 731) RETURNING id INTO v_id;
    PERFORM _assert(v_id IS NOT NULL, 'db/56 (age): a Sexual Offences Register clearance of exactly 24 months was refused');
    SELECT count(*) INTO n FROM clearance_register(HIL)
     WHERE person_id = U_COACH2 AND kind = 'sexual_offences_register' AND status = 'current';
    PERFORM _assert(n = 1, 'db/56 (age): the recorded Sexual Offences Register clearance does not read current on the register');
    BEGIN
      INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on)
        VALUES (U_COACH2, HIL, 'safeguarding_awareness', 'SAC-V56-001', d, d + 367);
      v_err := NULL;
    EXCEPTION WHEN check_violation THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err LIKE '%runs at most 366 days%', format('db/56 (age): a Safeguarding Awareness Certificate of 367 days was not refused (%s)', coalesce(v_err, 'accepted')));
    -- a kind with no CSA maximum keeps db/08's outer bound only
    INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on)
      VALUES (U_COACH2, HIL, 'safeguarding_acknowledgement', 'ANNEX-G-V56', d, d + 1000) RETURNING id INTO v_id;
    PERFORM _assert(v_id IS NOT NULL, 'db/56 (age): a signed acknowledgement, which has no CSA maximum, was refused');

    -- (first) a first police clearance at the school no older than six months;
    -- a renewal is not held to it
    BEGIN
      INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on)
        VALUES (U_BURSAR, HIL, 'police_clearance', 'PCC-V56-001', d - 214, d - 214 + 700);
      v_err := NULL;
    EXCEPTION WHEN check_violation THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err LIKE '%first police clearance must be no older than 183 days%',
      format('db/56 (first): a first police clearance issued seven months ago was not refused (%s)', coalesce(v_err, 'accepted')));
    INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on)
      VALUES (U_DRV, HIL, 'police_clearance', 'PCC-V56-002', d - 214, d - 214 + 700) RETURNING id INTO v_id;
    PERFORM _assert(v_id IS NOT NULL, 'db/56 (first): a renewal issued seven months ago was refused as though it were a first');
    INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on)
      VALUES (U_BURSAR, HIL, 'police_clearance', 'PCC-V56-003', d - 183, d - 183 + 700) RETURNING id INTO v_id;
    PERFORM _assert(v_id IS NOT NULL, 'db/56 (first): a first police clearance exactly six months old was refused');
    -- a revoked row is not a check held: revoke the bursar's, and a first rule applies again
    UPDATE adult_clearance SET revoked_at = now(), revoked_reason = 'Verify 056: wrong person' WHERE id = v_id;
    BEGIN
      INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on)
        VALUES (U_BURSAR, HIL, 'police_clearance', 'PCC-V56-004', d - 214, d - 214 + 700);
      v_err := NULL;
    EXCEPTION WHEN check_violation THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err LIKE '%first police clearance%',
      format('db/56 (first): with only a revoked row held, a seven-month-old police clearance was taken as a renewal (%s)', coalesce(v_err, 'accepted')));

    -- (legacy) a five-year row recorded before db/56 reads current until its
    -- date, and is revoked like any other
    PERFORM set_config('app.user_id', '', true);
    v_id := _legacy_56();
    PERFORM _as(U_REGISTRAR);
    SELECT count(*) INTO n FROM adult_clearance
     WHERE id = v_id AND expires_on - issued_on > 731 AND revoked_at IS NULL;
    PERFORM _assert(n = 1, 'db/56 (legacy): the office cannot read the five-year police clearance recorded before db/56');
    SELECT count(*) INTO n FROM clearance_register(HIL)
     WHERE person_id = U_SCORER AND kind = 'police_clearance' AND clearance_id = v_id AND status = 'current';
    PERFORM _assert(n = 1, 'db/56 (legacy): a police clearance recorded before db/56 to run five years no longer reads current until its date');
    UPDATE adult_clearance SET revoked_at = now(), revoked_reason = 'Verify 056: re-checked under CSA' WHERE id = v_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM _assert(n = 1, 'db/56 (legacy): the office cannot revoke a row older than CSA''s 24 months');
    SELECT count(*) INTO n FROM clearance_register(HIL)
     WHERE person_id = U_SCORER AND kind = 'police_clearance' AND status = 'revoked';
    PERFORM _assert(n = 1, 'db/56 (legacy): the revoked five-year row does not read revoked');

    -- (reference) the ages are readable by anyone signed in, and written by nobody
    SELECT count(*) INTO n FROM clearance_kind_max_days;
    PERFORM _assert(n = 5, format('db/56 (reference): the office reads %s of the five CSA maxima', n));
    BEGIN
      INSERT INTO clearance_kind_max_days (kind, max_days, source) VALUES ('first_aid', 30, 'verify');
      v_err := NULL;
    EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err IS NOT NULL, 'db/56 (reference): the office wrote a CSA maximum');
    PERFORM set_config('app.user_id', '', true);
    SELECT count(*) INTO n FROM clearance_kind_max_days;
    PERFORM _assert(n = 0, format('db/56 (reference): a caller with no session reads %s CSA maxima', n));

    -- (pupil) a pupil who scores is not an adult missing his checks; an
    -- eighteen-year-old who plays and scores is
    PERFORM _seed_56();
    PERFORM _as(U_REGISTRAR);
    SELECT count(*) INTO n FROM clearance_register(HIL) WHERE person_id = U_SELF;
    PERFORM _assert(n = 0, format('db/56 (pupil): the register asks R Pillay, a pupil who scores, for %s clearance(s)', n));
    SELECT count(*) INTO n FROM clearance_register(HIL) WHERE person_id = U_V56 AND role = 'scorer' AND status = 'missing';
    PERFORM _assert(n = 5, format('db/56 (pupil): the register asks S Naidoo, eighteen, who plays and scores, for %s of the five checks — the pupil exclusion reaches an adult', n));

    -- (trip) nothing refuses from the paste: the driver has none of the new
    -- kinds, and the guard, which refuses only a KNOWN lapse, lets him drive
    PERFORM set_config('app.user_id', '', true);
    v_err := _trip_56(U_DRV);
    PERFORM _assert(v_err = 'ok', format('db/56 (trip): a driver missing only the new CSA checks was refused a trip (%s)', v_err));
    -- ...and a new kind he holds, once lapsed, refuses as a lapsed police clearance does (db/08's rule)
    PERFORM _as(U_REGISTRAR);
    INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on)
      VALUES (U_DRV, HIL, 'safeguarding_awareness', 'SAC-V56-002', d - 400, d - 35);
    PERFORM set_config('app.user_id', '', true);
    v_err := _trip_56(U_DRV);
    PERFORM _assert(v_err LIKE '%Safeguarding Awareness Certificate expired%',
      format('db/56 (trip): a driver whose recorded certificate lapsed was not refused as db/08''s guard refuses (%s)', v_err));
  END;

  -- ── 35. Safeguarding, phase 1: the DSO and the concern record (db/57) ──
  -- CSA Safeguarding Policy p15–17, p52, p63; docs/design/SAFEGUARDING_DSO.md
  -- §9.1. Nobody but a DSO of the institution that HOLDS a concern reads it:
  -- not the coach, the parent, the office, the principal, the director of
  -- sport, the league, the owner's key, the platform, a support session, the
  -- adult it names — and the audit log does not say it exists. The four
  -- layers are proved one at a time: (owner-cut) and (support-cut) take the
  -- others away and show the one left still holds, and (named) is the case
  -- where only the fourth stands between a DSO and a concern about him.
  -- Falsified once per class against a live database (section 35 alone, so
  -- no earlier section caught it first), each going red at the assertion
  -- named: safeguarding.concern.read granted to principal, schooladmin,
  -- directorofsport, guardian (→ zero); to coach with the policy's team
  -- widened to '*' (→ zero); to competitionadmin and to platformadmin with
  -- the platform cut dropped (→ zero; with the cut kept, only (catalogue)
  -- fired); the platform cut dropped (→ owner-cut); the support cut dropped
  -- (→ support-cut); the named cut dropped, the log's names-me check
  -- removed, the named DSO sent the tenant-wide notice (→ named); the
  -- policy made app_holds() (→ dso); the access_log policy dropped, the
  -- recipient cut dropped, the notices' platform cut dropped, the insert cut
  -- dropped, the SG-9 trigger off, the two role_assignment triggers off,
  -- receipts unfiltered, support allowed to begin as dso, routing blind to a
  -- named DSO and to leadership, a share returning the reporter or ignoring
  -- revocation, the office's rule removed (each → its own letter). A share
  -- outliving the close needed both of its guards removed: the close revokes
  -- every share, and share_open() also refuses a closed concern.
  DECLARE
    n        bigint;
    n2       bigint;
    n3       bigint;
    v_ok     boolean;
    v_why    text;
    v_err    text;
    v_ref1   text;  -- a parent, about his child and the physio
    v_ref2   text;  -- the 2XI coach, about the principal
    v_ref3   text;  -- a pupil, about Hilton's second DSO
    v_ref4   text;  -- a teacher at a school with no DSO
    v_ref5   text;  -- a teacher where there is nobody at all
    v_ref6   text;  -- a DSO, recording a report from The Guardian's app
    v_ref7   text;  -- a teacher, about his school's DSO, with nobody above
    v_unheld boolean;
    v_id1    uuid;
    v_id2    uuid;
    v_share  uuid;
    v_asg    uuid;
    v_json   jsonb;
    v_date   date;
    v_union  uuid;
    i        integer;
    who      uuid[];
    what     text[];
    U_DSO1   uuid := '88888888-0000-0000-0000-000000005701';  -- appointed by the principal below
    U_DSO2   uuid := '88888888-0000-0000-0000-000000005702';  -- Hilton's second DSO
    U_DSOW   uuid := '88888888-0000-0000-0000-000000005703';  -- Westville's DSO
    U_PDSO   uuid := '88888888-0000-0000-0000-000000005704';  -- the union's DSO
    U_V57    uuid := '88888888-0000-0000-0000-000000005705';  -- teacher, school with no DSO
    U_SUP57  uuid := '88888888-0000-0000-0000-000000005706';  -- a support session, simulated
    U_FAR    uuid := '88888888-0000-0000-0000-000000005707';  -- teacher, no union in his province
    U_FDSO   uuid := '88888888-0000-0000-0000-000000005708';  -- a DSO there, named in #7
    U_FAR2   uuid := '88888888-0000-0000-0000-000000005709';  -- a teacher there
    U_FDSO2  uuid := '88888888-0000-0000-0000-000000005710';  -- the other DSO there
    V57C     uuid := '57570000-0000-0000-0000-000000000003';
    U_BEKKER uuid := '88888888-0000-0000-0000-000000000011';  -- A Bekker, guardian of T Bekker
    V57      uuid := '57570000-0000-0000-0000-000000000001';
    V57B     uuid := '57570000-0000-0000-0000-000000000002';
  BEGIN
    PERFORM set_config('app.user_id', '', true);
    v_union := _seed_57();


    -- (appoint) the principal appoints a DSO; the office and the director of
    -- sport cannot; nobody makes a DSO with no institution, or with a team
    PERFORM _as(U_HEAD_M);
    INSERT INTO role_assignment (person_id, role, school_id) VALUES (U_DSO1, 'dso', HIL);
    PERFORM _as(U_DSO1);
    SELECT count(*) INTO n FROM role_assignment WHERE person_id = U_DSO1 AND role = 'dso' AND school_id = HIL AND active;
    PERFORM _assert(n = 1, 'db/57 (appoint): the principal could not appoint a DSO');
    FOREACH v_asg IN ARRAY ARRAY[U_REGISTRAR, U_SARAH] LOOP
      PERFORM _as(v_asg);
      BEGIN
        INSERT INTO role_assignment (person_id, role, school_id) VALUES (U_BURSAR, 'dso', HIL);
        v_err := NULL;
      EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM; END;
      PERFORM _assert(v_err IS NOT NULL, format('db/57 (appoint): %s appointed a DSO', v_asg));
    END LOOP;
    PERFORM _as(U_PLAT);
    BEGIN
      INSERT INTO role_assignment (person_id, role, school_id) VALUES (U_BURSAR, 'dso', NULL);
      v_err := NULL;
    EXCEPTION WHEN check_violation THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err LIKE '%must name a school%', format('db/57 (appoint): a DSO with no institution was not refused (%s)', coalesce(v_err, 'accepted')));
    BEGIN
      INSERT INTO role_assignment (person_id, role, school_id, team_code) VALUES (U_BURSAR, 'dso', HIL, '1XI');
      v_err := NULL;
    EXCEPTION WHEN check_violation THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err LIKE '%names no team%', format('db/57 (appoint): a team-scoped DSO was not refused (%s)', coalesce(v_err, 'accepted')));
    -- (support) support may not take a DSO into a school
    SELECT s.ok, s.reason INTO v_ok, v_why FROM support_access_begin(HIL, 'dso', 'Verify 057: read the concerns') s;
    PERFORM _assert(NOT v_ok AND v_why = 'role_not_supportable', format('db/57 (support): a support session as dso was %s', coalesce(v_why, 'issued')));

    -- (raise) anybody signed in raises, at a school he belongs to; a child only if he can see him
    PERFORM _as(U_BEKKER);
    SELECT r.reason INTO v_why FROM safeguarding_concern_raise(HIL, 'child', ARRAY['bullying'], 'suspicion',
      'He comes home from nets upset and will not say why.', 'told', p_subject_player => P_U16B) r;
    PERFORM _assert(v_why = 'child_not_visible', format('db/57 (raise): a parent named a child he cannot see (%s)', coalesce(v_why, 'accepted')));
    SELECT r.reason INTO v_why FROM safeguarding_concern_raise(WES, 'child', ARRAY['bullying'], 'suspicion',
      'He comes home from nets upset and will not say why.', 'told') r;
    PERFORM _assert(v_why = 'not_your_school', format('db/57 (raise): a Hilton parent raised at Westville (%s)', coalesce(v_why, 'accepted')));
    SELECT r.reason INTO v_why FROM safeguarding_concern_raise(HIL, 'child', ARRAY['bullying'], 'suspicion',
      'A report The Guardian passed on to the school.', 'anonymous_app') r;
    PERFORM _assert(v_why = 'anonymous_app_is_recorded_by_a_dso', format('db/57 (raise): a parent recorded an anonymous-app report (%s)', coalesce(v_why, 'accepted')));
    -- #1: a parent, about his child, naming the physio
    SELECT r.ok, r.reference, r.unheld INTO v_ok, v_ref1, v_unheld FROM safeguarding_concern_raise(HIL, 'adult', ARRAY['physical', 'psychological'],
      'suspicion', 'He says the physio grabbed his arm hard in the change room and shouted at him.', 'told',
      p_subject_player => P_OTHER, p_subject_person => U_MEDICAL, p_occurred_where => 'Pavilion change room') r;
    PERFORM _assert(v_ok AND v_ref1 ~ '^SG-[0-9A-Z]{4}-[0-9]{4}$' AND NOT v_unheld, format('db/57 (raise): the parent''s concern was not taken (%s)', v_ref1));
    -- #2: the 2XI coach, about the principal (ticked "an adult"; the principal's appointment makes it leadership)
    PERFORM _as(U_COACH2);
    SELECT r.ok, r.reference INTO v_ok, v_ref2 FROM safeguarding_concern_raise(HIL, 'adult', ARRAY['psychological'],
      'suspicion', 'The head shouts at the U13 boys on the touchline and they are frightened of him.', 'witness',
      p_subject_person => U_HEAD_M) r;
    PERFORM _assert(v_ok, 'db/57 (raise): the coach''s concern about the principal was not taken');
    -- #3: a pupil, about Hilton's second DSO
    PERFORM _as(U_SELF);
    SELECT r.ok, r.reference INTO v_ok, v_ref3 FROM safeguarding_concern_raise(HIL, 'adult', ARRAY['sexual_harassment'],
      'suspicion', 'The DSO sends me messages late at night that make me uncomfortable.', 'victim',
      p_subject_person => U_DSO2) r;
    PERFORM _assert(v_ok, 'db/57 (raise): the pupil''s concern about the DSO was not taken');
    -- #4: a teacher at a school with no DSO; #5: one where nobody above has one either
    PERFORM _as(U_V57);
    SELECT r.ok, r.reference INTO v_ok, v_ref4 FROM safeguarding_concern_raise(V57, 'child', ARRAY['neglect'],
      'recognised', 'A boy in my side has come to nets hungry every day this week.', 'witness') r;
    PERFORM _assert(v_ok, 'db/57 (raise): a concern at a school with no DSO was not taken');
    PERFORM _as(U_FAR);
    SELECT r.ok, r.reference, r.unheld INTO v_ok, v_ref5, v_unheld FROM safeguarding_concern_raise(V57B, 'unknown', ARRAY['other'],
      'suspicion', 'Something is wrong on the bus home and the boys will not say what.', 'other') r;
    PERFORM _assert(v_ok AND v_unheld, 'db/57 (raise): a concern with nobody above was not written, or not marked unheld');
    -- #7: a teacher, about his school's DSO, with nobody above: held at the
    -- school by the other DSO, and the one it names is not told
    PERFORM _as(U_FAR2);
    SELECT r.ok, r.reference INTO v_ok, v_ref7 FROM safeguarding_concern_raise(V57C, 'dso', ARRAY['psychological'],
      'suspicion', 'The DSO humiliates the younger boys in front of the side.', 'witness', p_subject_person => U_FDSO) r;
    PERFORM _assert(v_ok, 'db/57 (raise): a concern about the DSO with nobody above was not taken');

    -- (route) the school holds a child's and leadership's; the union holds the DSO's and the DSO-less school's
    PERFORM set_config('app.user_id', '', true);
    PERFORM _assert(_route_57(v_ref1) = 'HIL/adult/false', format('db/57 (route): #1 went to %s', _route_57(v_ref1)));
    PERFORM _assert(_route_57(v_ref2) = 'HIL/leadership/false', format('db/57 (route): #2 went to %s — the principal''s appointment did not make it leadership', _route_57(v_ref2)));
    PERFORM _assert(_route_57(v_ref3) LIKE '%/dso/false' AND _route_57(v_ref3) NOT LIKE 'HIL/%', format('db/57 (route): #3, about a DSO, went to %s', _route_57(v_ref3)));
    PERFORM _assert(_route_57(v_ref4) NOT LIKE 'verify-057/%' AND _route_57(v_ref4) LIKE '%/child/false', format('db/57 (route): #4, at a school with no DSO, went to %s', _route_57(v_ref4)));
    PERFORM _assert(_route_57(v_ref5) = 'verify-057b/unknown/true', format('db/57 (route): #5, with nobody above, went to %s', _route_57(v_ref5)));
    PERFORM _assert(_route_57(v_ref7) = 'verify-057c/dso/true', format('db/57 (route): #7, about a DSO with nobody above, went to %s', _route_57(v_ref7)));
    v_id1 := _concern_57(v_ref1);
    v_id2 := _concern_57(v_ref2);

    -- (dso) Hilton's DSOs read Hilton's two, reporter and notes included; not the union's
    FOREACH v_asg IN ARRAY ARRAY[U_DSO1, U_DSO2] LOOP
      PERFORM _as(v_asg);
      SELECT count(*) INTO n FROM safeguarding_concern WHERE reference IN (v_ref1, v_ref2);
      SELECT count(*) INTO n2 FROM safeguarding_concern_reporter r JOIN safeguarding_concern c ON c.id = r.concern_id
       WHERE c.reference IN (v_ref1, v_ref2);
      SELECT count(*) INTO n3 FROM safeguarding_concern WHERE reference IN (v_ref3, v_ref4, v_ref5);
      PERFORM _assert(n = 2 AND n2 = 2 AND n3 = 0, format('db/57 (dso): a Hilton DSO reads %s of Hilton''s two, %s reporters, %s held elsewhere', n, n2, n3));
      SELECT count(*) INTO n FROM notification WHERE kind = 'safeguarding';
      PERFORM _assert(n = 2, format('db/57 (dso): a Hilton DSO has %s safeguarding notices, expected Hilton''s two', n));
      SELECT count(*) INTO n FROM access_log WHERE resource = 'safeguarding_concern_raise' AND school_id = HIL;
      PERFORM _assert(n = 2, format('db/57 (dso): a Hilton DSO sees %s of the two raises on the log', n));
    END LOOP;
    -- (named-dso) the DSO a concern is about reads it nowhere: it went above him
    PERFORM _as(U_DSO2);
    SELECT count(*) INTO n FROM safeguarding_concern WHERE reference = v_ref3;
    PERFORM _assert(n = 0, 'db/57 (named-dso): Hilton''s second DSO reads the concern about himself');
    -- (named) where nobody above can hold it, the other DSO reads it and is
    -- told; the DSO it names reads nothing of it, and is not told
    PERFORM _as(U_FDSO2);
    SELECT count(*) INTO n FROM safeguarding_concern WHERE reference = v_ref7;
    SELECT count(*) INTO n2 FROM notification WHERE kind = 'safeguarding' AND recipient_id = U_FDSO2;
    PERFORM _assert(n = 1 AND n2 = 1, format('db/57 (named): the other DSO reads %s of the concern about his colleague, with %s notice', n, n2));
    PERFORM _as(U_FDSO);
    SELECT (SELECT count(*) FROM safeguarding_concern) + (SELECT count(*) FROM safeguarding_concern_reporter)
         + (SELECT count(*) FROM safeguarding_concern_note) + (SELECT count(*) FROM safeguarding_share) INTO n;
    SELECT count(*) INTO n2 FROM notification WHERE kind = 'safeguarding';
    SELECT count(*) INTO n3 FROM access_log WHERE resource LIKE 'safeguarding%';
    PERFORM _assert(n = 0 AND n2 = 0 AND n3 = 0 AND safeguarding_concern_open(_concern_57(v_ref7)) IS NULL
                    AND NOT EXISTS (SELECT 1 FROM safeguarding_inbox()),
      format('db/57 (named): the DSO a concern names reads %s rows, %s notices, %s log rows of it', n, n2, n3));

    -- (union) the union's DSO reads what is held there, and a leadership notice — never the school's record
    PERFORM _as(U_PDSO);
    SELECT count(*) INTO n FROM safeguarding_concern WHERE reference IN (v_ref3, v_ref4);
    SELECT count(*) INTO n2 FROM safeguarding_concern WHERE reference IN (v_ref1, v_ref2, v_ref5);
    PERFORM _assert(n = 2 AND n2 = 0, format('db/57 (union): the provincial DSO reads %s of the two held at the union and %s held elsewhere', n, n2));
    SELECT count(*) INTO n FROM notification WHERE kind = 'safeguarding';
    SELECT count(*) INTO n2 FROM notification WHERE kind = 'safeguarding' AND body LIKE '%leadership of Hilton College%';
    PERFORM _assert(n = 3 AND n2 = 1, format('db/57 (union): the provincial DSO has %s notices (expected 3), %s about Hilton''s leadership (expected 1)', n, n2));
    PERFORM _assert(safeguarding_concern_open(v_id2) IS NULL, 'db/57 (union): the provincial DSO opened the leadership concern the school holds');
    -- (other-dso) Westville's DSO reads none of Hilton's
    PERFORM _as(U_DSOW);
    SELECT count(*) INTO n FROM safeguarding_concern;
    SELECT count(*) INTO n2 FROM notification WHERE kind = 'safeguarding';
    PERFORM _assert(n = 0 AND n2 = 0, format('db/57 (other-dso): Westville''s DSO reads %s concerns and %s notices', n, n2));

    -- (zero) everyone else reads nothing of it: a row, a hidden log row, a notice.
    -- A row on the log that is NOT a safeguarding read is written first, so an
    -- auditor's zero below is the policy, not an empty log.
    PERFORM _as(U_COACH2);
    PERFORM log_restricted_read('players', ARRAY[P_OTHER], ARRAY['born'], HIL);
    who  := ARRAY[U_COACH2, U_BEKKER, U_REGISTRAR, U_HEAD_M, U_SARAH, U_LEAGUE, U_OWNER, U_PLAT, U_MEDICAL, U_SELF, U_V57, U_FAR];
    what := ARRAY['the 2XI coach (a reporter)', 'the parent of the named child (a reporter)', 'the office', 'the principal (named)',
                  'the director of sport', 'the league', 'the owner''s key', 'the platform', 'the physio (named)',
                  'the pupil (a reporter)', 'the teacher (a reporter)', 'the far teacher (a reporter)'];
    FOR i IN 1 .. array_length(who, 1) LOOP
      PERFORM _as(who[i]);
      SELECT (SELECT count(*) FROM safeguarding_concern) + (SELECT count(*) FROM safeguarding_concern_reporter)
           + (SELECT count(*) FROM safeguarding_concern_note) + (SELECT count(*) FROM safeguarding_share) INTO n;
      SELECT count(*) INTO n2 FROM access_log WHERE resource LIKE 'safeguarding%';
      SELECT count(*) INTO n3 FROM notification WHERE kind = 'safeguarding';
      PERFORM _assert(n = 0 AND n2 = 0 AND n3 = 0,
        format('db/57 (zero): %s reads %s safeguarding rows, %s hidden log rows, %s safeguarding notices', what[i], n, n2, n3));
      PERFORM _assert(safeguarding_concern_open(v_id1) IS NULL AND safeguarding_family(v_id1) IS NULL
                      AND NOT EXISTS (SELECT 1 FROM safeguarding_inbox()),
        format('db/57 (zero): %s opened a concern through a function', what[i]));
    END LOOP;
    -- ...and the auditors among them still read the rest of the log (the zero is the cut, not an empty log)
    FOREACH v_asg IN ARRAY ARRAY[U_REGISTRAR, U_HEAD_M, U_SARAH, U_OWNER, U_PLAT] LOOP
      PERFORM _as(v_asg);
      SELECT count(*) INTO n FROM access_log WHERE resource = 'players' AND school_id = HIL;
      PERFORM _assert(n >= 1, format('db/57 (hidden): an auditor (%s) reads no log at all — the zero above proves nothing', v_asg));
    END LOOP;
    -- ...and the physio, named, is a live account: she reads the injuries she treats
    PERFORM _as(U_MEDICAL);
    SELECT count(*) INTO n FROM injury_masked WHERE notes IS NOT NULL;
    PERFORM _assert(n > 0, 'db/57 (zero): the physio reads no injury — her zero above proves nothing');

    -- (support) a support session, as a coach and as the office, reads nothing either
    PERFORM _as(U_PLAT);
    FOREACH v_why IN ARRAY ARRAY['coach', 'schooladmin'] LOOP
      SELECT s.ok, s.reason INTO v_ok, v_err FROM support_access_begin(HIL, v_why, 'Verify 057: ticket 5757 about the roster',
                                                                       CASE v_why WHEN 'coach' THEN '2XI' END) s;
      PERFORM _assert(v_ok OR v_err = 'already_live', format('db/57 (support): a session as %s was not begun (%s)', v_why, v_err));
    END LOOP;
    PERFORM _assert(app_support_access_id(HIL) IS NOT NULL, 'db/57 (support): no support session is live at Hilton');
    SELECT (SELECT count(*) FROM safeguarding_concern) + (SELECT count(*) FROM safeguarding_concern_note) INTO n;
    SELECT count(*) INTO n2 FROM access_log WHERE resource LIKE 'safeguarding%';
    SELECT count(*) INTO n3 FROM notification WHERE kind = 'safeguarding';
    PERFORM _assert(n = 0 AND n2 = 0 AND n3 = 0, format('db/57 (support): a support session reads %s rows, %s hidden log rows, %s notices', n, n2, n3));

    -- (owner-cut) the owner's key with the capability granted back still reads nothing:
    -- the platform-wide cut on its own
    PERFORM set_config('app.user_id', '', true);
    PERFORM _owner_grant_57(true);
    PERFORM _as(U_OWNER);
    PERFORM _assert(app_can('safeguarding.concern.read', HIL, NULL::text, '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid),
      'db/57 (owner-cut): the owner''s key does not hold the capability granted back — the zero below proves nothing');
    SELECT count(*) INTO n FROM safeguarding_concern;
    SELECT count(*) INTO n2 FROM access_log WHERE resource LIKE 'safeguarding%';
    SELECT count(*) INTO n3 FROM notification WHERE kind = 'safeguarding';
    PERFORM _assert(n = 0 AND n2 = 0 AND n3 = 0 AND safeguarding_concern_open(v_id1) IS NULL,
      format('db/57 (owner-cut): the owner''s key, holding the capability, reads %s concerns, %s hidden log rows, %s notices', n, n2, n3));
    PERFORM set_config('app.user_id', '', true);
    PERFORM _owner_grant_57(false);

    -- (support-cut) a session as dso, for an account with no platform-wide
    -- assignment, reads nothing; ended, the same assignment reads Hilton's
    PERFORM _support_dso_57(false);
    PERFORM _as(U_SUP57);
    PERFORM _assert(NOT app_is_platform_wide() AND app_support_access_id(HIL) IS NOT NULL,
      'db/57 (support-cut): the simulated session is not a support session without a platform-wide assignment');
    SELECT count(*) INTO n FROM safeguarding_concern;
    SELECT count(*) INTO n2 FROM access_log WHERE resource LIKE 'safeguarding%';
    SELECT count(*) INTO n3 FROM notification WHERE kind = 'safeguarding';
    PERFORM _assert(n = 0 AND n2 = 0 AND n3 = 0 AND safeguarding_concern_open(v_id1) IS NULL,
      format('db/57 (support-cut): a support session as dso reads %s concerns, %s hidden log rows, %s notices', n, n2, n3));
    PERFORM set_config('app.user_id', '', true);
    PERFORM _support_dso_57(true);
    PERFORM _as(U_SUP57);
    SELECT count(*) INTO n FROM safeguarding_concern WHERE reference IN (v_ref1, v_ref2);
    SELECT count(*) INTO n3 FROM notification WHERE kind = 'safeguarding';
    PERFORM _assert(n = 2 AND n3 >= 2, format('db/57 (support-cut): with the session ended the same assignment reads %s of Hilton''s two and %s notices — the zero above proves nothing', n, n3));
    PERFORM set_config('app.user_id', '', true);
    PERFORM _revoke(U_SUP57);

    -- (receipt) the reporter keeps a reference and a time, and nothing else
    PERFORM _as(U_BEKKER);
    SELECT count(*), max(reference) INTO n, v_why FROM my_concern_receipts();
    PERFORM _assert(n = 1 AND v_why = v_ref1, format('db/57 (receipt): the parent has %s receipts (%s), expected his one', n, v_why));
    PERFORM _as(U_SELF);
    SELECT count(*), max(reference) INTO n, v_why FROM my_concern_receipts();
    PERFORM _assert(n = 1 AND v_why = v_ref3, format('db/57 (receipt): the pupil has %s receipts (%s), expected his one', n, v_why));
    PERFORM _as(U_DSO1);
    SELECT count(*) INTO n FROM my_concern_receipts();
    PERFORM _assert(n = 0, 'db/57 (receipt): a DSO has a receipt for a concern somebody else raised');

    -- (contacts) the card: Hilton's DSOs to a Hilton parent; the union's at a school with none
    PERFORM _as(U_BEKKER);
    SELECT count(*) INTO n FROM dso_contacts(HIL) WHERE held_at = 'school' AND name IN ('V57 DSO One', 'V57 DSO Two');
    PERFORM _assert(n = 2, format('db/57 (contacts): a Hilton parent sees %s of Hilton''s two DSOs', n));
    SELECT count(*) INTO n FROM dso_contacts(WES);
    PERFORM _assert(n = 0, 'db/57 (contacts): a Hilton parent reads Westville''s DSOs');
    PERFORM _as(U_V57);
    SELECT count(*) INTO n FROM dso_contacts() WHERE held_at = 'union' AND name = 'V57 Provincial DSO';
    PERFORM _assert(n = 1, 'db/57 (contacts): a school with no DSO is not shown the union''s');

    -- (open) the DSO opens the record — account, reporter — and the read is on the log
    PERFORM _as(U_DSO1);
    v_json := safeguarding_concern_open(v_id1);
    PERFORM _assert(v_json->>'account' LIKE '%grabbed his arm%' AND v_json->'reporter'->>'name' = 'A Bekker'
                    AND v_json->'subjectPlayer'->>'name' = 'T Bekker' AND NOT (v_json ? 'born'),
      format('db/57 (open): the DSO''s open is not the record (%s)', left(v_json::text, 200)));
    SELECT count(*) INTO n FROM access_log WHERE resource = 'safeguarding_concern' AND v_id1 = ANY (record_ids);
    PERFORM _assert(n = 1, format('db/57 (open): the DSO''s open left %s log rows, expected 1', n));
    -- (family) the child's guardians and contacts, through the open concern, logged
    v_json := safeguarding_family(v_id1);
    PERFORM _assert(v_json->'guardians' @> '[{"name": "A Bekker"}]'::jsonb,
      format('db/57 (family): the DSO does not reach the child''s guardian (%s)', v_json::text));
    SELECT count(*) INTO n FROM access_log WHERE resource = 'safeguarding_family' AND v_id1 = ANY (record_ids);
    PERFORM _assert(n = 1, 'db/57 (family): the DSO''s reach into the family is not on the log');

    -- (clock) 24 hours, red after; the NDSO informed stops it; a report from The Guardian's app runs 72
    SELECT count(*) INTO n FROM safeguarding_inbox() WHERE reference = v_ref1 AND clock_hours = 24 AND NOT overdue;
    PERFORM _assert(n = 1, 'db/57 (clock): a fresh concern is not on a 24-hour clock, or is already overdue');
    PERFORM set_config('app.user_id', '', true);
    PERFORM _age_concern_57(v_id1, 25);
    PERFORM _as(U_DSO1);
    SELECT count(*) INTO n FROM safeguarding_inbox() WHERE reference = v_ref1 AND overdue AND hours_open >= 25;
    PERFORM _assert(n = 1, 'db/57 (clock): a concern 25 hours old is not overdue');
    SELECT r.ok INTO v_ok FROM safeguarding_note(v_id1, 'ndso_informed', 'NDSO told by phone at 09:10') r;
    SELECT count(*) INTO n FROM safeguarding_inbox() WHERE reference = v_ref1 AND clock_stopped AND NOT overdue;
    PERFORM _assert(v_ok AND n = 1, 'db/57 (clock): informing the NDSO did not stop the clock');
    SELECT r.ok, r.reference INTO v_ok, v_ref6 FROM safeguarding_concern_raise(HIL, 'unknown', ARRAY['bullying'], 'suspicion',
      'The Guardian passed on an anonymous report of bullying in the U14 side.', 'anonymous_app') r;
    SELECT count(*) INTO n FROM safeguarding_inbox() WHERE reference = v_ref6 AND clock_hours = 72;
    PERFORM _assert(v_ok AND n = 1, 'db/57 (clock): a report from The Guardian''s app is not on a 72-hour clock');
    SELECT count(*) INTO n FROM access_log WHERE resource = 'safeguarding_inbox';
    PERFORM _assert(n >= 1, 'db/57 (clock): the inbox read is not on the log');

    -- (share) need to know: to a named person, the parts named, until a date, and never the reporter
    SELECT r.reason INTO v_why FROM safeguarding_share(v_id1, U_SELF, ARRAY['summary'], now() + interval '1 day', 'The boy needs to know it is being handled') r;
    PERFORM _assert(v_why = 'recipient_is_pupil', format('db/57 (share): a share to a pupil was %s', coalesce(v_why, 'made')));
    SELECT r.reason INTO v_why FROM safeguarding_share(v_id1, U_MEDICAL, ARRAY['summary'], now() + interval '1 day', 'She should know what is said of her') r;
    PERFORM _assert(v_why = 'recipient_is_subject', format('db/57 (share): a share to the adult it names was %s', coalesce(v_why, 'made')));
    SELECT r.reason INTO v_why FROM safeguarding_share(v_id1, U_SARAH, ARRAY['summary'], now() + interval '31 days', 'The director of sport runs the fixture list') r;
    PERFORM _assert(v_why = 'open_until_out_of_range', format('db/57 (share): a 31-day share was %s', coalesce(v_why, 'made')));
    SELECT r.ok, r.share_id INTO v_ok, v_share FROM safeguarding_share(v_id1, U_SARAH, ARRAY['summary', 'account'],
      now() + interval '1 day', 'The director of sport must keep the physio away from the U16s this week') r;
    PERFORM _assert(v_ok, 'db/57 (share): the DSO could not share with the director of sport');
    PERFORM _as(U_SARAH);
    SELECT count(*) INTO n FROM notification WHERE kind = 'safeguarding' AND recipient_id = U_SARAH;
    PERFORM _assert(n = 1, format('db/57 (share): the director of sport has %s share notices, expected 1', n));
    SELECT (SELECT count(*) FROM safeguarding_concern) + (SELECT count(*) FROM safeguarding_share) INTO n;
    PERFORM _assert(n = 0, 'db/57 (share): a share opened the tables to its person');
    SELECT count(*) INTO n FROM my_safeguarding_shares() WHERE id = v_share;
    v_json := safeguarding_share_open(v_share);
    PERFORM _assert(n = 1 AND v_json->>'account' LIKE '%grabbed his arm%' AND v_json ? 'summary'
                    AND NOT (v_json ? 'child') AND NOT (v_json ? 'actions') AND NOT (v_json ? 'reporter')
                    AND v_json::text NOT LIKE '%A Bekker%',
      format('db/57 (share): the share did not open to exactly what was named (%s)', left(v_json::text, 300)));
    PERFORM _as(U_HEAD_M);
    SELECT count(*) INTO n FROM notification WHERE kind = 'safeguarding';
    PERFORM _assert(n = 0 AND safeguarding_share_open(v_share) IS NULL,
      'db/57 (share): the principal reads the director of sport''s share, or its notice');
    PERFORM _as(U_DSO1);
    SELECT count(*) INTO n FROM access_log WHERE resource = 'safeguarding_share' AND v_share = ANY (record_ids);
    PERFORM _assert(n = 1, 'db/57 (share): opening a share is not on the log');
    -- ...and it closes: on revocation, on expiry, and with the concern, on the next statement
    SELECT r.ok INTO v_ok FROM safeguarding_share_revoke(v_share) r;
    PERFORM _as(U_SARAH);
    PERFORM _assert(v_ok AND safeguarding_share_open(v_share) IS NULL AND NOT EXISTS (SELECT 1 FROM my_safeguarding_shares()),
      'db/57 (share): a revoked share still opens');
    PERFORM _as(U_DSO1);
    SELECT r.share_id INTO v_share FROM safeguarding_share(v_id1, U_SARAH, ARRAY['summary'], now() + interval '1 day', 'A second share, to let lapse') r;
    PERFORM set_config('app.user_id', '', true);
    PERFORM _expire_share_57(v_share);
    PERFORM _as(U_SARAH);
    PERFORM _assert(safeguarding_share_open(v_share) IS NULL, 'db/57 (share): a lapsed share still opens');
    PERFORM _as(U_DSO1);
    SELECT r.share_id INTO v_share FROM safeguarding_share(v_id1, U_SARAH, ARRAY['summary'], now() + interval '1 day', 'A third share, to end with the concern') r;
    PERFORM _as(U_SARAH);
    PERFORM _assert(safeguarding_share_open(v_share) IS NOT NULL, 'db/57 (share): the third share does not open — the closes below prove nothing');
    PERFORM _as(U_DSO1);
    SELECT r.ok, r.retain_until INTO v_ok, v_date FROM safeguarding_close(v_id1, 'supported', false, 'Physio moved to the 1XI only') r;
    PERFORM _assert(v_ok AND v_date = ((now() AT TIME ZONE 'Africa/Johannesburg') + interval '3 years')::date,
      format('db/57 (close): the close was refused or kept it until %s, not three years', v_date));
    PERFORM _as(U_SARAH);
    PERFORM _assert(safeguarding_share_open(v_share) IS NULL, 'db/57 (share): a share outlived its concern''s close');
    -- the account is written once
    PERFORM _as(U_DSO1);
    BEGIN
      UPDATE safeguarding_concern SET account = 'Changed by the DSO afterwards.' WHERE id = v_id2;
      v_err := NULL;
    EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err IS NOT NULL, 'db/57 (share): the application edited a concern''s account');

    -- (notice) SG-9: a private notice to a pupil is the system's alone; and
    -- nobody publishes a safeguarding notice through the publish route
    PERFORM set_config('app.user_id', '', true);
    PERFORM _assert(_notice_57(U_SELF, 'news') = 'refused', 'db/57 (notice): a private news notice to a pupil was written');
    PERFORM _assert(_notice_57(U_SELF, 'system') = 'ok', 'db/57 (notice): the system''s own notice to a pupil was refused');
    PERFORM _assert(_notice_57(U_SARAH, 'news') = 'ok', 'db/57 (notice): a private notice to an adult was refused');
    PERFORM _as(U_SARAH);
    BEGIN
      INSERT INTO notification (school_id, scope_level, kind, title, body, required_capability)
        VALUES (HIL, 'school', 'safeguarding', 'A safeguarding concern has been raised', 'Forged', 'safeguarding.concern.read');
      v_err := NULL;
    EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err IS NOT NULL, 'db/57 (notice): the director of sport published a safeguarding notice');
    INSERT INTO notification (school_id, scope_level, kind, title, body) VALUES (HIL, 'school', 'news', 'Verify 057', 'Ordinary');
    SELECT count(*) INTO n FROM notification WHERE title = 'Verify 057' AND kind = 'news' AND recipient_id IS NULL;
    PERFORM _assert(n = 1, 'db/57 (notice): the director of sport cannot publish an ordinary notice — the refusal above proves nothing');

    -- (guard) the principal, named in an open leadership concern, cannot end a
    -- DSO's appointment, by any column; neither can the office, ever; the
    -- provincial DSO can; a DSO at the school cannot
    PERFORM _as(U_HEAD_M);
    SELECT a.id INTO v_asg FROM role_assignment a WHERE a.person_id = U_DSO2 AND a.role = 'dso' AND a.active;
    PERFORM _assert(v_asg IS NOT NULL, 'db/57 (guard): the principal cannot read the DSO''s appointment');
    BEGIN
      UPDATE role_assignment SET active = false WHERE id = v_asg;
      v_err := NULL;
    EXCEPTION WHEN check_violation THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err LIKE '%cannot be ended from here%', format('db/57 (guard): the principal ended a DSO''s appointment (%s)', coalesce(v_err, 'ended')));
    BEGIN
      UPDATE role_assignment SET valid_until = current_date WHERE id = v_asg;
      v_err := NULL;
    EXCEPTION WHEN check_violation THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err LIKE '%cannot be ended from here%', format('db/57 (guard): the principal dated out a DSO''s appointment (%s)', coalesce(v_err, 'dated out')));
    PERFORM _as(U_REGISTRAR);
    BEGIN
      UPDATE role_assignment SET active = false WHERE id = v_asg;
      v_err := NULL;
    EXCEPTION WHEN check_violation THEN v_err := SQLERRM; END;
    PERFORM _assert(v_err LIKE '%cannot be ended from here%', format('db/57 (guard): the office ended a DSO''s appointment (%s)', coalesce(v_err, 'ended')));
    PERFORM _as(U_DSO1);
    SELECT e.ok, e.reason INTO v_ok, v_why FROM safeguarding_dso_end(v_asg) e;
    PERFORM _assert(NOT v_ok AND v_why = 'not_permitted', 'db/57 (guard): a DSO at the school ended another''s appointment');
    PERFORM _as(U_PDSO);
    SELECT e.ok INTO v_ok FROM safeguarding_dso_end(v_asg) e;
    PERFORM _as(U_DSO2);
    SELECT count(*) INTO n FROM safeguarding_concern;
    PERFORM _assert(v_ok AND n = 0, format('db/57 (guard): the provincial DSO could not end the appointment, or it still reads %s', n));
    -- with the leadership concern closed, the principal may end one again
    PERFORM _as(U_DSO1);
    SELECT r.ok INTO v_ok FROM safeguarding_close(v_id2, 'handed_to_union', true) r;
    PERFORM _assert(v_ok, 'db/57 (guard): the DSO could not close the leadership concern');
    PERFORM _as(U_HEAD_M);
    SELECT a.id INTO v_asg FROM role_assignment a WHERE a.person_id = U_DSO1 AND a.role = 'dso' AND a.active;
    UPDATE role_assignment SET active = false WHERE id = v_asg;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM _assert(n = 1, 'db/57 (guard): with nothing open that names him, the principal cannot end a DSO''s appointment');

    -- (catalogue) the four capabilities are dso's alone; the owner's key holds
    -- none. Last, so a falsification that grants one elsewhere is caught by
    -- the reads above first.
    PERFORM _assert((SELECT string_agg(DISTINCT role, ',') FROM role_capability WHERE capability LIKE 'safeguarding.%') = 'dso',
      'db/57 (catalogue): a role other than dso holds a safeguarding capability');
    PERFORM _assert((SELECT count(*) FROM role_capability WHERE role = 'dso' AND capability LIKE 'safeguarding.%') = 4,
      'db/57 (catalogue): dso does not hold the four safeguarding capabilities');
  END;

  -- ── 36. A boy's fitness is his health (SCRBRD-117, db/58) ─────────
  -- player.fitness was unmasked under player.profile.read, which a pupil holds
  -- across his side. Masked behind medical.status.read on his own team: a
  -- team-mate and another side's coach read NULL, the physio, his coach's
  -- tier, his parent and he himself read it. db/58 undone (fitness taken out
  -- of the mask list) and this file run: (pupil) and (coach) failed.
  DECLARE
    n       bigint;
    v_fit   text;
    U_BEKKER uuid := '88888888-0000-0000-0000-000000000011';
  BEGIN
    -- (pupil) a pupil reads the side, and nobody's fitness but his own
    PERFORM _as(U_PUPIL);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_INJURED AND fitness IS NULL;
    PERFORM _assert(n = 1, 'db/58 (pupil): a pupil reads a team-mate''s fitness, or cannot read the side at all');
    SELECT count(*) INTO n FROM player_masked WHERE fitness IS NOT NULL;
    PERFORM _assert(n = 0, format('db/58 (pupil): a pupil reads %s players'' fitness', n));
    PERFORM _as(U_SELF);
    SELECT fitness INTO v_fit FROM player_masked WHERE id = P_INJURED;
    SELECT count(*) INTO n FROM player_masked WHERE id <> P_INJURED AND fitness IS NOT NULL;
    PERFORM _assert(v_fit = 'injured' AND n = 0, format('db/58 (pupil): R Pillay reads his own fitness as %s and %s team-mates''', v_fit, n));
    -- (coach) another side's coach sees the boy on the roster and not his
    -- fitness. The U14A coach: section 33 granted the 2XI coach an enquiry
    -- for R Pillay, which reads the status tier (db/55 as amended).
    PERFORM _as('88888888-0000-0000-0000-00000000000b'::uuid);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_INJURED AND fitness IS NULL;
    PERFORM _assert(n = 1, 'db/58 (coach): the U14A coach reads a 1XI boy''s fitness, or cannot see him on the roster');
    -- (staff) the physio and the director of sport read it; a parent reads his own child's
    FOREACH v_fit IN ARRAY ARRAY[U_MEDICAL::text, U_SARAH::text] LOOP
      PERFORM _as(v_fit::uuid);
      SELECT count(*) INTO n FROM player_masked WHERE id = P_INJURED AND fitness = 'injured';
      PERFORM _assert(n = 1, format('db/58 (staff): %s does not read R Pillay''s fitness', v_fit));
    END LOOP;
    PERFORM _as(U_BEKKER);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_OTHER AND fitness IS NOT NULL;
    PERFORM _assert(n = 1, 'db/58 (staff): A Bekker does not read his own son''s fitness');
  END;

  PERFORM set_config('app.user_id', '', true);

  -- ── 37. The signed-out read path (SCRBRD-083 phase 1, db/59) ──
  -- A public request runs as nobody: app.user_id empty, every base table
  -- denied, and only db/59's four SECURITY DEFINER reads answer — and only
  -- for a fixture with a published side. What they return is the rule's
  -- inputs for the API (it applies publicName() and the pseudonyms; see
  -- services/api/public/); here it is held that the inputs are the right
  -- ones: each boy's facts for HIS side, his side's publication, no date of
  -- birth, no reason, no kind that is a conduct matter, and that a
  -- withdrawal, a mark and a publication flip change the next call.
  DECLARE
    ids      jsonb := _seed_59();
    M_ON     uuid;
    M_OFF    uuid;
    U_OFFICE uuid := '88888888-0000-0000-0000-00000000000c';   -- registrar, guardian.link.manage at Hilton
    v_facts  jsonb;
    v_pub    boolean;
    v_grp    text;
    v_keys   text;
    t        text;
    h        record;
  BEGIN
    M_ON := (ids->>'m_on')::uuid;
    M_OFF := (ids->>'m_off')::uuid;
    PERFORM set_config('app.user_id', '', true);

    -- (unpublished) nothing, for nobody and for a signed-in reader alike
    SELECT (SELECT count(*) FROM public_match_header(M_ON)) + (SELECT count(*) FROM public_match_log(M_ON, 0))
         + (SELECT count(*) FROM public_match_people(M_ON)) + (SELECT count(*) FROM public_shot_sectors(M_ON)) INTO n;
    PERFORM _assert(n = 0, format('db/59 (unpublished): a fixture nobody published answered %s rows', n));
    PERFORM _as(U_SARAH);
    SELECT count(*) INTO n FROM public_match_log(M_ON, 0);
    PERFORM _assert(n = 0, format('db/59 (unpublished-signed-in): a signed-in reader got %s public rows of an unpublished fixture', n));

    -- the rule's records, through their own doors — starting from every
    -- Hilton age group named (section 25 leaves some switched off)
    PERFORM _as(U_SARAH);
    FOR v_grp IN SELECT o.age_group FROM public_names_off o WHERE o.school_id = HIL AND o.names_off LOOP
      PERFORM public_names_off_set(HIL, v_grp, false);
    END LOOP;
    PERFORM _as((ids->>'g_named')::uuid);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set((ids->>'named')::uuid, true, 'public-names-2026-09') s;
    PERFORM _assert(v_ok, format('db/59: the named boy''s guardian could not consent (%s)', v_reason));
    FOREACH t IN ARRAY ARRAY['marked', 'up', 'wes'] LOOP
      PERFORM _as((ids->>('g_' || t))::uuid);
      SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_name_consent_set((ids->>t)::uuid, true, 'public-names-2026-09') s;
      PERFORM _assert(v_ok, format('db/59: %s''s guardian could not consent (%s)', t, v_reason));
    END LOOP;
    PERFORM _as(U_SARAH);
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM player_never_public_set((ids->>'marked')::uuid, 'a court order') s;
    PERFORM _assert(v_ok, format('db/59: the mark could not be set (%s)', v_reason));
    v_grp := birth_age_group(_born_of((ids->>'up')::uuid));
    PERFORM _assert(v_grp IS NOT NULL AND v_grp NOT IN ('open'), format('db/59: the boy playing up is %s by birth', v_grp));
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM public_names_off_set(HIL, v_grp, true) s;
    PERFORM _assert(v_ok, format('db/59: names could not be switched off for %s (%s)', v_grp, v_reason));
    SELECT s.ok, s.reason INTO v_ok, v_reason FROM fixture_publish(M_ON, 'home', true) s;
    PERFORM _assert(v_ok, format('db/59: Hilton could not publish its side (%s)', v_reason));

    -- (signed-out) nobody reads a base table; the definers answer
    PERFORM set_config('app.user_id', '', true);
    FOREACH t IN ARRAY ARRAY['player', 'match', 'ball_event', 'public_name_consent', 'player_never_public',
                             'fixture_publication', 'assignment_subject', 'match_toss', 'school'] LOOP
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      PERFORM _assert(n = 0 AND _count_rows(t) > 0, format('db/59 (signed-out): nobody reads %s of %s''s %s rows', n, t, _count_rows(t)));
    END LOOP;
    SELECT * INTO h FROM public_match_header(M_ON);
    PERFORM _assert(h.home_published AND NOT h.away_published AND h.away_on_platform AND h.home_label = 'Hilton College 1XI'
                    AND h.served_on = to_char(sa_today(), 'YYYY-MM-DD'),
      format('db/59 (header): %s', row(h.home_published, h.away_published, h.away_on_platform, h.home_label, h.served_on)::text));

    -- (people) each boy the log names, his facts for his side, his side's publication
    SELECT count(*) INTO n FROM public_match_people(M_ON);
    PERFORM _assert(n = 5, format('db/59 (people): %s people for a log naming four Hilton boys, a typed one and a Westville boy — expected 5 (no typed name)', n));
    SELECT string_agg(DISTINCT k, ',' ORDER BY k) INTO v_keys FROM public_match_people(M_ON) pp, jsonb_object_keys(pp.facts) k;
    PERFORM _assert(v_keys = 'consents,namesOff,neverPublic', format('db/59 (facts-clean): the facts carry %s', v_keys));
    SELECT pp.facts, pp.school_published INTO v_facts, v_pub FROM public_match_people(M_ON) pp WHERE pp.player_id = (ids->>'named')::uuid;
    PERFORM _assert(v_pub AND v_facts->'consents'->0->>'competent' = 'true' AND v_facts->'consents'->0->>'endedOn' IS NULL
                    AND (v_facts->>'neverPublic')::boolean = false AND (v_facts->>'namesOff')::boolean = false,
      format('db/59 (named): %s, published %s', v_facts, v_pub));
    SELECT pp.facts INTO v_facts FROM public_match_people(M_ON) pp WHERE pp.player_id = (ids->>'marked')::uuid;
    PERFORM _assert((v_facts->>'neverPublic')::boolean, format('db/59 (marked): the mark is not in his facts: %s', v_facts));
    SELECT pp.facts INTO v_facts FROM public_match_people(M_ON) pp WHERE pp.player_id = (ids->>'none')::uuid;
    PERFORM _assert(jsonb_array_length(v_facts->'consents') = 0, format('db/59 (nothing): %s', v_facts));
    SELECT pp.facts INTO v_facts FROM public_match_people(M_ON) pp WHERE pp.player_id = (ids->>'up')::uuid;
    PERFORM _assert((v_facts->>'namesOff')::boolean, format('db/59 (playing up): names off for his own age group did not hold him back: %s', v_facts));
    SELECT pp.school_published INTO v_pub FROM public_match_people(M_ON) pp WHERE pp.player_id = (ids->>'wes')::uuid;
    PERFORM _assert(NOT v_pub, 'db/59 (L5): the Westville boy reads as published while only Hilton published');

    -- (log) every event but the Law 41 suspension, every field by name
    SELECT count(*) INTO n FROM public_match_log(M_ON, 0);
    PERFORM _assert(n = 6, format('db/59 (log): %s events, expected the 7 written less the suspension', n));
    SELECT count(*) INTO n FROM public_match_log(M_ON, 0) l WHERE l.kind = 'bowler_suspended';
    PERFORM _assert(n = 0, 'db/59 (log): a Law 41 suspension of one boy reached the public log');
    SELECT string_agg(DISTINCT k, ',') INTO v_keys FROM public_match_log(M_ON, 0) l, jsonb_object_keys(l.detail) k
     WHERE k NOT IN ('battingTeam', 'bowlingTeam', 'teamKey', 'bowlingTeamKey', 'squad', 'bowlingSquad', 'overs', 'target',
                     'striker', 'nonStriker', 'bowler', 'dismissed', 'captainConsent', 'fielder', 'freeHit', 'nbRuns', 'nbType',
                     'outAt', 'facesNext', 'notInOver', 'runs', 'toBattingTeam', 'batter', 'reason', 'confirmed');
    PERFORM _assert(v_keys IS NULL, format('db/59 (log): the detail carries %s', v_keys));
    SELECT count(*) INTO n FROM public_match_log(M_ON, 0) l WHERE l.detail ? 'twelfthMan' OR l.detail ? 'captureProfile' OR l.detail ? 'shot';
    PERFORM _assert(n = 0, 'db/59 (log): the twelfth man, a capture profile or a shot reached the public log');
    SELECT count(*) INTO n FROM public_match_log(M_ON, 4);
    PERFORM _assert(n = 2, format('db/59 (since): %s events after seq 4, expected 2', n));
    SELECT count(*) INTO n FROM public_shot_sectors(M_ON) WHERE sector = 9 AND runs = 4 AND shots = 1;
    PERFORM _assert(n = 1, 'db/59 (sectors): the four through sector 9 is not the team''s');

    -- (off-platform) a typed opposition is nobody's to name
    PERFORM _as(U_SARAH);
    SELECT s.ok INTO v_ok FROM fixture_publish(M_OFF, 'home', true) s;
    PERFORM set_config('app.user_id', '', true);
    SELECT * INTO h FROM public_match_header(M_OFF);
    PERFORM _assert(NOT h.away_on_platform AND h.away_label = 'Kearsney College 1XI',
      format('db/59 (off-platform): %s', row(h.away_on_platform, h.away_label)::text));
    SELECT count(*) INTO n FROM public_match_people(M_OFF);
    PERFORM _assert(n = 1, format('db/59 (off-platform): %s people, expected only the Hilton boy — typed names have no row', n));

    -- (flips) the next call sees each change
    PERFORM _as(U_OFFICE);
    SELECT s.ok, s.reason INTO v_ok, v_reason
      FROM public_name_consent_set((ids->>'named')::uuid, false, 'public-names-2026-09', (ids->>'g_named')::uuid) s;
    PERFORM _assert(v_ok, format('db/59: the office could not withdraw a consent (%s)', v_reason));
    PERFORM set_config('app.user_id', '', true);
    SELECT pp.facts INTO v_facts FROM public_match_people(M_ON) pp WHERE pp.player_id = (ids->>'named')::uuid;
    PERFORM _assert(v_facts->'consents'->0->>'endedOn' = to_char(sa_today(), 'YYYY-MM-DD'),
      format('db/59 (withdrawal): the next call still has a live consent: %s', v_facts));
    PERFORM _as(U_SARAH);
    PERFORM player_never_public_end((ids->>'marked')::uuid);
    PERFORM set_config('app.user_id', '', true);
    SELECT pp.facts INTO v_facts FROM public_match_people(M_ON) pp WHERE pp.player_id = (ids->>'marked')::uuid;
    PERFORM _assert(NOT (v_facts->>'neverPublic')::boolean, format('db/59 (mark ended): %s', v_facts));
    PERFORM _as(U_SARAH);
    PERFORM fixture_publish(M_ON, 'home', false);
    PERFORM set_config('app.user_id', '', true);
    SELECT (SELECT count(*) FROM public_match_header(M_ON)) + (SELECT count(*) FROM public_match_log(M_ON, 0))
         + (SELECT count(*) FROM public_match_people(M_ON)) + (SELECT count(*) FROM public_shot_sectors(M_ON)) INTO n;
    PERFORM _assert(n = 0, format('db/59 (withdrawn): a fixture Hilton took back down answered %s rows', n));

    -- (grants) the application, and not PUBLIC or a managed host's API roles
    FOREACH t IN ARRAY ARRAY['public_match_header(uuid)', 'public_match_log(uuid,integer)', 'public_match_people(uuid)',
                             'public_shot_sectors(uuid)'] LOOP
      PERFORM _assert(has_function_privilege('scrbrd_app', t::regprocedure, 'EXECUTE')
                      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                                       WHERE p.oid = t::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
                      AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
                                         AND has_function_privilege(r.oid, t::regprocedure, 'EXECUTE')),
        format('db/59 (grants): %s is not the application''s alone', t));
    END LOOP;
  END;

  -- ── 38. Workload phase 1: consent and the count (SCRBRD-110, db/60) ──
  -- The nets band is ordinary processing: a coach records it for a boy with no
  -- health consent, and his figure is an estimate. The table refuses a count
  -- for a net and a band for a paper-scored match. One figure per session,
  -- the bowler's own over the coach's; a paper match on a day the log scored
  -- is marked, not dropped. The EWMA word agrees with workload()'s thresholds
  -- and with the recursion it is the closed form of. The consent: a parent's
  -- yes for a boy of seventeen, and what happens on his eighteenth birthday —
  -- phase 0's rule since db/62 (see the note at (12)). A team-mate, another
  -- side's coach and a parent read and write no load; the fitness coach reads
  -- a load chart and not an injury's notes; a support session reads no
  -- consent and records none.
  DECLARE
    ids     jsonb := _seed_60();
    P_B     uuid; P_T uuid; P_E uuid; P_O uuid;   -- bowler, turning 18, EWMA series, other
    U_C     uuid; U_C2 uuid; U_PH uuid; U_FIT uuid; U_MATE uuid; U_OFF uuid; U_PL uuid;
    U_MUM   uuid; U_MUM2 uuid; U_BOY uuid; U_TURN uuid;
    TS      uuid;
    D_MATCH date;
    V       text := 'health-monitoring-2026-09';
    e_staff uuid; e_self uuid; e_fix uuid;
    rec     record;
    c       record;
    w       record;
    v_con   text;
    v_msg   text;
    v_word  text;
    v_ratio numeric;
    ew      record;
    S_ID    uuid;
    k       int;
  BEGIN
    P_B := (ids->>'p_bowler')::uuid; P_T := (ids->>'p_turning')::uuid;
    P_E := (ids->>'p_ewma')::uuid;   P_O := (ids->>'p_other')::uuid;
    U_C := (ids->>'u_coach')::uuid;  U_C2 := (ids->>'u_coach2')::uuid; U_PH := (ids->>'u_physio')::uuid;
    U_FIT := (ids->>'u_fit')::uuid;  U_MATE := (ids->>'u_mate')::uuid; U_OFF := (ids->>'u_office')::uuid;
    U_PL := (ids->>'u_plat')::uuid;  U_MUM := (ids->>'u_mum')::uuid;   U_MUM2 := (ids->>'u_mum2')::uuid;
    U_BOY := (ids->>'u_boy')::uuid;  U_TURN := (ids->>'u_turner')::uuid;
    TS := (ids->>'ts')::uuid;        D_MATCH := (ids->>'m_on')::date;

    -- (1) The switch arrives off: a coach's nets band is refused until the
    -- platform grants workload_monitoring to his school.
    PERFORM _as(U_C);
    BEGIN
      INSERT INTO load_entry (player_id, kind, training_session_id, band) VALUES (P_B, 'nets', TS, '12_24');
      v_msg := 'accepted';
    EXCEPTION WHEN check_violation THEN v_msg := SQLERRM;
    END;
    PERFORM _assert(v_msg = 'workload_monitoring_off', format('db/60 (switch): a nets band with the module off was %s', v_msg));
    PERFORM _v60_grant(true);

    -- (2) A nets band for a boy WITHOUT health consent is accepted, stamped
    -- as the coach's (staff), dated by the session, and his figure says
    -- "estimate".
    PERFORM _assert(NOT _v60_live(P_B), 'db/60 (fixture): the bowler has a live health consent');
    PERFORM _as(U_C);
    INSERT INTO load_entry (player_id, kind, training_session_id, band, rpe, minutes)
    VALUES (P_B, 'nets', TS, '12_24', 6, 45) RETURNING id INTO e_staff;
    SELECT * INTO rec FROM load_entry WHERE id = e_staff;
    PERFORM _assert(rec.recorded_as = 'staff' AND rec.recorded_by = U_C AND rec.on_date = sa_today()
                    AND rec.school_id = HIL AND rec.units IS NULL,
      format('db/60 (stamp): the coach''s row is %s', row(rec.recorded_as, rec.recorded_by = U_C, rec.on_date, rec.school_id = HIL)::text));
    SELECT * INTO rec FROM load_summary(P_B);
    PERFORM _assert(rec.units_7d = 18 + 13 AND rec.match_units_7d = 13 AND rec.estimated_7d AND NOT rec.monitored,
      format('db/60 (estimate): the coach reads %s for the bowler', row(rec.units_7d, rec.match_units_7d, rec.estimated_7d, rec.monitored)::text));
    SELECT count(*) INTO n FROM load_weeks(P_B) wk WHERE wk.week_start <= sa_today() AND wk.week_end >= sa_today() AND wk.estimated AND wk.units >= 18;
    PERFORM _assert(n = 1, 'db/60 (chart): this week''s bar is not drawn as an estimate');

    -- (3) A nets entry with a count is refused, and so is a paper-scored
    -- match with a band: nobody can be asked to count a net.
    v_con := NULL;
    BEGIN
      INSERT INTO load_entry (player_id, kind, training_session_id, band, units) VALUES (P_B, 'nets', TS, '12_24', 20);
    EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    END;
    PERFORM _assert(v_con = 'load_entry_band_or_count', format('db/60 (count): a net with a count was %s', coalesce(v_con, 'accepted')));
    v_con := NULL;
    BEGIN
      INSERT INTO load_entry (player_id, kind, on_date, units) VALUES (P_B, 'nets', sa_today(), 20);
    EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    END;
    PERFORM _assert(v_con = 'load_entry_band_or_count', 'db/60 (count): a net with a count and no band was accepted');
    v_con := NULL;
    BEGIN
      INSERT INTO load_entry (player_id, kind, on_date, band) VALUES (P_B, 'match_elsewhere', D_MATCH, '24_36');
    EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    END;
    PERFORM _assert(v_con = 'load_entry_band_or_count', 'db/60 (count): a paper-scored match with a band was accepted');
    v_msg := NULL;
    BEGIN
      INSERT INTO load_entry (player_id, kind, on_date, band) VALUES (P_B, 'nets', sa_today() + 1, '12_24');
    EXCEPTION WHEN check_violation THEN v_msg := SQLERRM;
    END;
    PERFORM _assert(v_msg = 'load_entry_in_future', 'db/60 (stamp): a net tomorrow was accepted');

    -- (4) The bowler's own band for the same session: the session counts
    -- once, and it is HIS figure — not the coach's, not the two added, not
    -- the larger.
    PERFORM _as(U_BOY);
    INSERT INTO load_entry (player_id, kind, training_session_id, band, rpe, minutes)
    VALUES (P_B, 'nets', TS, '24_36', 9, 50) RETURNING id INTO e_self;
    SELECT * INTO rec FROM load_entry WHERE id = e_self;
    PERFORM _assert(rec.recorded_as = 'self' AND rec.recorded_by = U_BOY, format('db/60 (self): the boy''s row is %s', rec.recorded_as));
    SELECT * INTO rec FROM _v60_day(P_B, sa_today());
    PERFORM _assert(rec.entered_units = 30 AND rec.sessions = 1 AND rec.estimated AND rec.minutes = 50 AND rec.au = 450,
      format('db/60 (one figure): today reads %s, expected his 30 once', row(rec.entered_units, rec.sessions, rec.minutes, rec.au)::text));
    -- The coach corrects his own figure: still the boy's that counts.
    PERFORM _as(U_C);
    INSERT INTO load_entry (player_id, kind, training_session_id, band, supersedes)
    VALUES (P_B, 'nets', TS, '36plus', e_staff) RETURNING id INTO e_fix;
    SELECT * INTO rec FROM _v60_day(P_B, sa_today());
    PERFORM _assert(rec.entered_units = 30, format('db/60 (one figure): a coach''s correction displaced the boy''s figure (%s)', rec.entered_units));
    -- A correction replaces one's own figure only.
    PERFORM _as(U_BOY);
    v_msg := NULL;
    BEGIN
      INSERT INTO load_entry (player_id, kind, training_session_id, band, supersedes) VALUES (P_B, 'nets', TS, 'lt12', e_fix);
    EXCEPTION WHEN check_violation THEN v_msg := SQLERRM;
    END;
    PERFORM _assert(v_msg = 'supersedes_another_session', 'db/60 (correction): the boy replaced the coach''s figure');
    INSERT INTO load_entry (player_id, kind, training_session_id, band, supersedes) VALUES (P_B, 'nets', TS, 'lt12', e_self);
    SELECT * INTO rec FROM _v60_day(P_B, sa_today());
    PERFORM _assert(rec.entered_units = 6, format('db/60 (correction): his corrected figure reads %s, expected 6', rec.entered_units));
    -- The row is never changed in place.
    v_msg := NULL;
    BEGIN
      UPDATE load_entry SET band = '36plus' WHERE id = e_self;
    EXCEPTION WHEN insufficient_privilege THEN v_msg := 'refused';
    END;
    PERFORM _assert(v_msg = 'refused', 'db/60 (never updated): the application changed a load entry');

    -- (5) A paper-scored match on a day the log already scored for him is
    -- marked, not refused and not dropped.
    INSERT INTO load_entry (player_id, kind, on_date, units) VALUES (P_B, 'match_elsewhere', D_MATCH, 24);
    SELECT * INTO rec FROM _v60_day(P_B, D_MATCH);
    PERFORM _assert(rec.match_units = 13 AND rec.entered_units = 24 AND rec.units = 37 AND rec.possibly_doubled AND NOT rec.estimated,
      format('db/60 (doubled): the scored day reads %s', row(rec.match_units, rec.entered_units, rec.possibly_doubled, rec.estimated)::text));
    SELECT * INTO rec FROM load_summary(P_B);
    PERFORM _assert(rec.possibly_doubled_7d AND D_MATCH = ANY (rec.possibly_doubled_on),
      'db/60 (doubled): his summary does not mark the day');
    SELECT count(*) INTO n FROM _v60_day(P_B, sa_today()) d WHERE d.possibly_doubled;
    PERFORM _assert(n = 0, 'db/60 (doubled): a nets day was marked as possibly counted twice');

    -- (6) workload(): the old columns, in their order, meaning what they meant.
    PERFORM _assert(pg_get_function_result('workload(text)'::regprocedure) LIKE
      'TABLE(player_id uuid, full_name text, team_code text, school_id uuid, age_band text, pace boolean, '
      'max_overs_per_spell smallint, max_overs_per_day smallint, overs_7d integer, overs_28d integer, '
      'longest_spell_7d integer, breaches_28d integer, last_bowled_on date, sessions_7d integer, minutes_7d integer, '
      'sessions_28d integer, minutes_28d integer, acwr numeric, load_state text, units_7d integer, units_28d integer, '
      'estimated_7d boolean, ewma_ratio numeric, load_word text, monitored boolean)',
      'db/60 (workload): workload()''s row is not db/08''s with six columns after it');
    PERFORM _as(U_C);
    SELECT * INTO w FROM workload('U15A') x WHERE x.player_id = P_B;
    PERFORM _assert(w.overs_7d = 2 AND w.overs_28d = 2 AND w.acwr = 4.00 AND w.load_state = 'spike'
                    AND w.units_7d = 6 + 13 + 24 AND w.estimated_7d AND NOT w.monitored,
      format('db/60 (workload): the bowler''s row is %s', row(w.overs_7d, w.overs_28d, w.acwr, w.load_state, w.units_7d, w.estimated_7d, w.monitored)::text));

    -- (7) The EWMA and its word, on a constructed series: load_summary()'s
    -- closed form against the recursion the design describes, and its word
    -- against workload()'s own thresholds, copied here from db/08.
    PERFORM _v60_series(P_E, U_C);
    PERFORM _as(U_C);
    SELECT * INTO ew FROM _v60_ewma(P_E);
    SELECT * INTO rec FROM load_summary(P_E);
    v_ratio := round(ew.acute / ew.chronic, 2);
    PERFORM _assert(rec.ewma_ratio = v_ratio AND rec.ewma_acute = round(ew.acute, 2) AND rec.ewma_chronic = round(ew.chronic, 2),
      format('db/60 (ewma): the summary reads %s, the recursion %s', row(rec.ewma_acute, rec.ewma_chronic, rec.ewma_ratio)::text,
             row(round(ew.acute, 2), round(ew.chronic, 2), v_ratio)::text));
    v_word := CASE WHEN v_ratio > 1.5 THEN 'spike' WHEN v_ratio >= 1.2 THEN 'rising' WHEN v_ratio < 0.8 THEN 'light' ELSE 'steady' END;
    PERFORM _assert(rec.load_word = v_word AND rec.units_7d = 144 AND rec.units_28d = 234 AND rec.estimated_28d AND rec.ratio_estimated,
      format('db/60 (word): %s at ratio %s, workload()''s thresholds say %s', rec.load_word, v_ratio, v_word));
    SELECT * INTO w FROM workload('U15A') x WHERE x.player_id = P_E;
    PERFORM _assert(w.ewma_ratio = rec.ewma_ratio AND w.load_word = rec.load_word AND w.units_7d = rec.units_7d,
      format('db/60 (word): the list says %s and the profile %s', row(w.ewma_ratio, w.load_word)::text, row(rec.ewma_ratio, rec.load_word)::text));
    SELECT count(*) INTO n FROM generate_series(0, 300) g
     WHERE load_ratio_word(g / 100.0) IS DISTINCT FROM
           CASE WHEN g / 100.0 > 1.5 THEN 'spike' WHEN g / 100.0 >= 1.2 THEN 'rising'
                WHEN g / 100.0 < 0.8 THEN 'light' ELSE 'steady' END;
    PERFORM _assert(n = 0, format('db/60 (word): %s ratios between 0 and 3 read a different word from workload()''s', n));
    SELECT count(*) INTO n FROM load_summary(P_E) x
     WHERE x.load_word ~* '(risk|danger|injur|unsafe)' OR x.baseline_word ~* '(risk|danger|injur|unsafe)';
    PERFORM _assert(n = 0, 'db/60 (word): a word names the body');
    -- A baseline needs six weeks with load: this one has three in weeks 3-14.
    PERFORM _assert(rec.baseline_week IS NULL AND rec.baseline_weeks_needed = 3,
      format('db/60 (baseline): %s', row(rec.baseline_week, rec.baseline_weeks_needed)::text));

    -- (8) Who reads and writes a load: a team-mate nothing, another side's
    -- coach nothing, a parent nothing.
    PERFORM _as(U_MATE);
    SELECT (SELECT count(*) FROM load_entry) + (SELECT count(*) FROM load_summary(P_B))
         + (SELECT count(*) FROM load_weeks(P_B)) + (SELECT count(*) FROM workload('U15A'))
         + (SELECT count(*) FROM health_monitoring_consent) + (SELECT count(*) FROM my_health_consents()) INTO n;
    PERFORM _assert(n = 0, format('db/60 (team-mate): a player on the same side read %s rows', n));
    v_msg := NULL;
    BEGIN
      INSERT INTO load_entry (player_id, kind, training_session_id, band) VALUES (P_B, 'nets', TS, '12_24');
    EXCEPTION WHEN insufficient_privilege THEN v_msg := 'refused';
    END;
    PERFORM _assert(v_msg = 'refused', 'db/60 (team-mate): a player recorded a team-mate''s load');
    v_msg := NULL;
    BEGIN
      PERFORM 1 FROM load_day;
    EXCEPTION WHEN insufficient_privilege THEN v_msg := 'refused';
    END;
    PERFORM _assert(v_msg = 'refused', 'db/60 (load_day): the application reads load_day around the per-boy check');
    PERFORM _as(U_C2);
    SELECT (SELECT count(*) FROM load_entry WHERE player_id = P_B) + (SELECT count(*) FROM load_summary(P_B)) INTO n;
    PERFORM _assert(n = 0, format('db/60 (other side): the U16A coach read %s rows of a U15A boy''s load', n));
    v_msg := NULL;
    BEGIN
      INSERT INTO load_entry (player_id, kind, training_session_id, band) VALUES (P_B, 'nets', TS, '12_24');
    EXCEPTION WHEN insufficient_privilege THEN v_msg := 'refused';
    END;
    PERFORM _assert(v_msg = 'refused', 'db/60 (other side): the U16A coach recorded a U15A boy''s load');
    PERFORM _as(U_MUM2);
    SELECT (SELECT count(*) FROM load_entry) + (SELECT count(*) FROM load_summary(P_O)) INTO n;
    PERFORM _assert(n = 0, 'db/60 (parent): a parent reads her son''s nets load by standing');
    v_msg := NULL;
    BEGIN
      INSERT INTO load_entry (player_id, kind, on_date, band) VALUES (P_O, 'nets', sa_today(), '12_24');
    EXCEPTION WHEN insufficient_privilege THEN v_msg := 'refused';
    END;
    PERFORM _assert(v_msg = 'refused', 'db/60 (parent): a parent recorded a nets band');
    -- The boy records his own and nobody else's.
    PERFORM _as(U_BOY);
    v_msg := NULL;
    BEGIN
      INSERT INTO load_entry (player_id, kind, on_date, band) VALUES (P_O, 'nets', sa_today(), '12_24');
    EXCEPTION WHEN insufficient_privilege THEN v_msg := 'refused';
    END;
    PERFORM _assert(v_msg = 'refused', 'db/60 (self): a boy recorded another boy''s load');
    SELECT count(*) INTO n FROM load_summary(P_B);
    PERFORM _assert(n = 1, 'db/60 (self): the boy cannot read his own load');

    -- (9) The fitness coach reads a load chart and records a band; of an
    -- injury he reads what it is, never the physio's notes.
    PERFORM _as(U_FIT);
    SELECT (SELECT count(*) FROM load_summary(P_B)) INTO n;
    SELECT count(*) INTO k FROM load_weeks(P_B);
    PERFORM _assert(n = 1 AND k = 26, format('db/60 (fitness): the chart is %s summary, %s weeks', n, k));
    INSERT INTO load_entry (player_id, kind, on_date, band) VALUES (P_O, 'training', sa_today(), 'lt12') RETURNING recorded_as INTO v_msg;
    PERFORM _assert(v_msg = 'staff', 'db/60 (fitness): the fitness coach''s band is not staff');
    SELECT count(*) INTO n FROM injury_masked i WHERE i.player_id = P_B AND i.injury_type = 'Hamstring strain' AND i.notes IS NULL AND i.physio IS NULL;
    PERFORM _assert(n = 1, 'db/60 (fitness): the fitness coach reads the physio''s notes, or not the injury''s nature');
    PERFORM _as(U_PH);
    SELECT count(*) INTO n FROM injury_masked i WHERE i.player_id = P_B AND i.notes IS NOT NULL;
    PERFORM _assert(n = 1, 'db/60 (fitness): the physio does not read her own note (the test would prove nothing)');

    -- (10) The consent at seventeen. The office records the link and its
    -- terms through db/08's own functions, so the link ends where
    -- guardian_link_establish() ends it today.
    PERFORM _as(U_OFF);
    SELECT ok, reason INTO v_ok, v_reason FROM guardian_link_establish(U_MUM, P_T, 'parent');
    PERFORM _assert(v_ok, format('db/60 (link): the office could not link the mother (%s)', v_reason));
    SELECT ok, reason INTO v_ok, v_reason FROM guardian_link_verify(U_MUM, P_T, 'popia-2026-01');
    PERFORM _assert(v_ok, format('db/60 (link): the office could not verify the mother (%s)', v_reason));
    -- Who may not answer: another child's parent, his coach, the boy himself at seventeen.
    PERFORM _as(U_MUM2);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, true, V);
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted', format('db/60 (consent): another boy''s parent answered (%s)', v_reason));
    PERFORM _as(U_C);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, true, V);
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted', format('db/60 (consent): his coach answered (%s)', v_reason));
    PERFORM _as(U_TURN);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, true, V);
    PERFORM _assert(NOT v_ok AND v_reason = 'not_yet_eighteen', format('db/60 (consent): the boy answered at seventeen (%s)', v_reason));
    SELECT * INTO c FROM my_health_consents() x WHERE x.player_id = P_T;
    PERFORM _assert(c.relation = 'self' AND c.state = 'not_answered' AND NOT c.can_say_yes AND NOT c.can_say_no AND NOT c.ask_at_18,
      format('db/60 (consent): the boy''s own row at seventeen is %s', row(c.relation, c.state, c.can_say_yes, c.ask_at_18)::text));
    -- The office from the admission form: a yes names the form.
    PERFORM _as(U_OFF);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, true, V, U_MUM);
    PERFORM _assert(NOT v_ok AND v_reason = 'form_required', format('db/60 (consent): the office said yes with no form (%s)', v_reason));
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, true, V, U_MUM, 'Admission form 2026', sa_today());
    PERFORM _assert(v_ok, format('db/60 (consent): the office could not record the form (%s)', v_reason));
    PERFORM _assert(_v60_live(P_T), 'db/60 (consent): a parent''s yes for a boy of seventeen is not live');
    PERFORM _as(U_MUM);
    SELECT * INTO c FROM my_health_consents() x WHERE x.player_id = P_T;
    PERFORM _assert(c.relation = 'guardian' AND c.state = 'given' AND c.from_form AND c.can_say_no AND c.can_say_yes,
      format('db/60 (consent): the mother''s row is %s', row(c.relation, c.state, c.from_form)::text));
    -- She withdraws: dead on the next statement. She says yes again: live.
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, false, V);
    PERFORM _assert(v_ok AND NOT _v60_live(P_T), format('db/60 (withdrawn): %s, live %s', v_reason, _v60_live(P_T)));
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, true, V);
    PERFORM _assert(v_ok AND _v60_live(P_T), format('db/60 (consent): the mother''s own yes (%s)', v_reason));
    SELECT * INTO c FROM my_health_consents() x WHERE x.player_id = P_T;
    PERFORM _assert(c.state = 'given' AND c.by_you AND NOT c.from_form AND c.retention_due IS NULL,
      format('db/60 (consent): after her yes, %s', row(c.state, c.by_you, c.from_form, c.retention_due)::text));
    SELECT count(*) INTO n FROM health_monitoring_consent WHERE player_id = P_T;
    PERFORM _assert(n = 2, format('db/60 (records): the mother reads %s of her own records, expected 2', n));
    -- The records have one door.
    v_msg := NULL;
    BEGIN
      UPDATE health_monitoring_consent SET ended_on = NULL WHERE player_id = P_T;
    EXCEPTION WHEN insufficient_privilege THEN v_msg := 'refused';
    END;
    PERFORM _assert(v_msg = 'refused', 'db/60 (records): the application edited a consent record');
    PERFORM _as(U_C);
    SELECT count(*) INTO n FROM health_monitoring_consent;
    PERFORM _assert(n = 0, 'db/60 (records): a coach reads who agreed to health monitoring');
    SELECT x.monitored INTO v_ok FROM workload('U15A') x WHERE x.player_id = P_T;
    PERFORM _assert(v_ok, 'db/60 (workload): the coach''s list does not show the boy as monitored');
    -- The nets band never waited on any of it (2), and does not now.

    -- (11) A support session, as the office, reads no consent and records none.
    PERFORM _as(U_PL);
    SELECT s.ok, s.reason, s.id INTO v_ok, v_reason, S_ID
      FROM support_access_begin(HIL, 'schooladmin', 'ticket 6060: the consent screen shows the wrong date') s;
    PERFORM _assert(v_ok, format('db/60 (support): the session did not begin (%s)', v_reason));
    SELECT (SELECT count(*) FROM health_monitoring_consent) + (SELECT count(*) FROM my_health_consents()) INTO n;
    PERFORM _assert(n = 0, format('db/60 (support): a support session read %s consent rows', n));
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, false, V, U_MUM);
    PERFORM _assert(NOT v_ok AND v_reason = 'not_under_support', format('db/60 (support): a support session recorded a consent (%s)', v_reason));
    PERFORM support_access_end(S_ID);
    PERFORM _assert(_v60_live(P_T), 'db/60 (support): the refused support write changed the consent');

    -- (12) The eighteenth birthday. His whole history moves back together, so
    -- the mother's yes was given while he was a child and today is the day.
    PERFORM _v60_turn_eighteen(P_T);
    -- ┌─ PHASE 0'S RULE (db/62; flipped from "today's rule" when it landed).
    -- │  guardian_link_establish() wrote her link OPEN, because he is an
    -- │  enrolled pupil, so it does not end on his birthday; her consent
    -- │  counts through a link that is live today, so it carries on while he
    -- │  is at school — no pause in collection (§7.4, Q7). Before db/62 her
    -- │  link ended here, the consent with it, and these read the other way.
    PERFORM _assert(_v38_link_open(P_T, U_MUM), 'db/60 (18, phase 0): guardian_link_establish() did not leave an enrolled pupil''s link open');
    PERFORM _assert(_v60_live(P_T), 'db/60 (18, phase 0): a parent''s pre-18 consent lapsed on his birthday while he is at school');
    PERFORM _as(U_MUM);
    SELECT * INTO c FROM my_health_consents() x WHERE x.player_id = P_T;
    PERFORM _assert(c.relation = 'guardian' AND c.live AND c.state = 'given' AND NOT c.can_say_yes AND c.can_say_no,
      format('db/60 (18, phase 0): the mother''s row after his birthday is %s', row(c.relation, c.live, c.state, c.can_say_yes, c.can_say_no)::text));
    -- └─ end of the assertions phase 0 flipped.
    -- Her yes after eighteen is refused, for the reason, whatever her link says.
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, true, V || '-b');
    PERFORM _assert(NOT v_ok AND v_reason = 'adult_consents_for_himself', format('db/60 (18): her yes after eighteen: %s', v_reason));
    PERFORM _as(U_OFF);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, true, V || '-b', U_MUM, 'Admission form 2026', sa_today());
    PERFORM _assert(NOT v_ok AND v_reason = 'adult_consents_for_himself', format('db/60 (18): the office''s yes for her after eighteen: %s', v_reason));
    -- He is asked, once — and until he answers, collection carries on on hers.
    PERFORM _as(U_TURN);
    SELECT * INTO c FROM my_health_consents() x WHERE x.player_id = P_T;
    PERFORM _assert(c.relation = 'self' AND c.adult AND c.ask_at_18 AND c.state = 'given' AND c.live AND c.can_say_yes AND c.parent_said_yes,
      format('db/60 (18): his own row is %s', row(c.relation, c.adult, c.ask_at_18, c.state, c.live)::text));

    -- (13) With the link open past the birthday, as phase 0 leaves it for an
    -- enrolled pupil: her pre-18 yes is live while he is at school, dead
    -- when he is not in the school system (a club member, or left), live
    -- again when he is back; her yes is still refused; and once he declines,
    -- only his record counts. The link was held open by hand here before
    -- db/62; it is open already, so this now asserts what db/62 wrote.
    -- (Section 40 fires db/62's triggers on his leaving; here the leave is
    -- the membership alone, so the consent's own at-school test is proved.)
    PERFORM _assert(_v38_link_open(P_T, U_MUM), 'db/60 (18, phase 0): the link is not open past his birthday');
    PERFORM _assert(_v60_live(P_T), 'db/60 (18, phase 0): her yes is not live on his birthday while he is at school');
    PERFORM _v60_leave(P_T);
    PERFORM _assert(NOT _v60_live(P_T), 'db/60 (18, phase 0): her yes is live for an adult out of the school system');
    PERFORM _v60_rejoin(P_T);
    PERFORM _assert(_v60_live(P_T), 'db/60 (18, phase 0): her yes is not live again when he is back at school');
    PERFORM _as(U_MUM);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, true, V || '-b');
    PERFORM _assert(NOT v_ok AND v_reason = 'adult_consents_for_himself', format('db/60 (18, phase 0): her yes with a live link: %s', v_reason));
    PERFORM _as(U_TURN);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, false, V);
    PERFORM _assert(v_ok AND NOT _v60_live(P_T), format('db/60 (18): he declines — %s, live %s', v_reason, _v60_live(P_T)));
    SELECT * INTO c FROM my_health_consents() x WHERE x.player_id = P_T;
    PERFORM _assert(c.state = 'refused' AND c.given_by = 'self' AND NOT c.ask_at_18,
      format('db/60 (18): after he declines, %s', row(c.state, c.given_by, c.ask_at_18)::text));
    -- Her "no" is still hers to give while her link is live; it changes nothing now.
    PERFORM _as(U_MUM);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, false, V);
    PERFORM _assert(v_ok AND NOT _v60_live(P_T), format('db/60 (18): her no after eighteen: %s', v_reason));
    PERFORM _as(U_TURN);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, true, V);
    PERFORM _assert(v_ok AND _v60_live(P_T), format('db/60 (18): his own yes (%s)', v_reason));

    -- (14) When the rows would fall due: never while live or at school;
    -- twelve months after the later of the consent's end and his leaving.
    PERFORM _assert(_v60_due(P_T) IS NULL, 'db/60 (retention): a live consent has a due date');
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_T, false, V);
    PERFORM _assert(v_ok AND _v60_due(P_T) IS NULL, 'db/60 (retention): a boy still at school has a due date');
    PERFORM _v60_leave(P_T);
    -- sa_today(), not current_date: health_retention_due() counts from the
    -- database's own today (Africa/Johannesburg), and between 22:00 and
    -- midnight UTC the two are a day apart — the consent ended on sa_today().
    PERFORM _assert(_v60_due(P_T) = (sa_today() + interval '12 months')::date,
      format('db/60 (retention): due %s, expected twelve months from today', _v60_due(P_T)));
    PERFORM _assert(_v60_due(P_B) IS NULL, 'db/60 (retention): a boy with no consent recorded has a due date');
  END;

  -- ── 39. Playing conditions per competition, phase 1 (SCRBRD-114, db/61) ──
  -- The design's phase 1 "proves" (docs/design/SCRBRD-114_playing_conditions.md
  -- §9), on a festival Hilton organises and five fixtures (_seed_61()). The
  -- JavaScript half is packages/scoring/test/conditions.test.mjs, which pins
  -- the same catalogue and parity strings; the API half is
  -- tools/smoke-playing-conditions.mjs (the write path and the pad's
  -- credential fixing the document, the handover's hash).
  --
  -- Each labelled assertion was falsified once — the thing it guards broken
  -- in db/61, the database rebuilt and this file run — and went red (three
  -- at db/61's own proof first, which runs before this file can):
  --   (catalogue)   a catalogue row's readers changed in db/61 and not in conditions.mjs
  --   (deny)        the CHECK's deny-list taken off the key (db/61's proof first)
  --   (immutable)   condition_value_guard() not asking the version's status
  --   (retroactive) condition_set_publish() comparing < sa_today() for <=
  --   (support)     condition_set_publish() without its support check
  --   (scorer)      condition_set_read admitting any signed-in reader
  --   (entrant)     match_competition_entered() not asking for the home side
  --   (fix)         match_conditions_fix() not refusing a scored match
  --   (override)    match_condition_override_set() not asking for a row: the
  --                 override table's own trigger refused it, the second wall
  --   (frozen)      match_conditions_guard() not comparing the play part (db/61's proof first)
  --   (parity)      match_free_hits_apply() back to db/54's (db/61's proof first)
  --   (seed)        _seed_rows_61('resolved') writing the other free hit
  DECLARE
    ids jsonb;
    C uuid; M_T20 uuid; M_DECL uuid; M_LATE uuid; M_FR uuid; M_OLD uuid;
    V1 uuid; V2 uuid; VX uuid;
    n bigint;
    got text; f0 text; f1 text; f2 text;
    h1 text; h2 text;
    pc record;
    v_ver smallint;
    t text;
    CATALOGUE text :=
         'format.kind|play|enum|-|limited,declaration,timed|-|-|pad,fold,laws,sql; '
      || 'format.overs_per_innings|play|int|overs|-|-|-|pad,fold,sql,table; '
      || 'format.innings_per_side|play|int|-|-|-|-|fold,pad; '
      || 'format.free_hit|play|bool|-|-|-|-|pad,fold,laws,sql; '
      || 'bowling.max_overs_per_bowler_innings|play|int|overs|-|-|-|pad,sql; '
      || 'bowling.limit|play|object|overs|-|band|-|sql,pad; '
      || 'result.min_overs_per_side|play|int|overs|-|-|-|pad,sql; '
      || 'result.tie_break|play|enum|-|none,super_over|-|"none"|fold,table; '
      || 'points.win|table|int|points|-|-|-|table; '
      || 'points.tie|table|int|points|-|-|-|table; '
      || 'points.draw|table|int|points|-|-|-|table; '
      || 'points.no_result|table|int|points|-|-|-|table; '
      || 'points.loss|table|int|points|-|-|-|table; '
      || 'points.abandoned|table|int|points|-|-|-|table; '
      || 'bonus.kind|table|enum|-|none,run_rate_ratio,batting_bowling|-|"none"|table; '
      || 'bonus.params|table|object|-|-|-|-|table; '
      || 'nrr.method|table|enum|-|standard|-|"standard"|table; '
      || 'table.order|table|list|-|points,wins,nrr,head_to_head,fewer_losses|-|["points", "wins", "nrr"]|table; '
      || 'over_rate.kind|table|enum|-|none,points,runs|-|"none"|table; '
      || 'eligibility.age_on|sheet|date|-|-|-|-|selection,sql; '
      || 'eligibility.max_age_open|sheet|int|years|-|-|-|selection,sql; '
      || 'eligibility.bona_fide_scholar|sheet|bool|-|-|-|false|selection,pad; '
      || 'over.max_balls|play|int|balls|-|-|-|-; '
      || 'over.free_hit_falls_away_on_last_ball|play|bool|-|-|-|-|-; '
      || 'batting.retire_at_runs|play|int|runs|-|-|-|-; '
      || 'pitch.length_m|play|int|m|-|-|-|-; '
      || 'ball.weight_g|play|int|g|-|-|-|-; '
      || 'fielding.powerplay|play|object|-|-|-|-|-; '
      || 'target.method|play|enum|-|umpires_revision|-|"umpires_revision"|-; '
      || 'bowling.rest_overs_between_spells|play|int|overs|-|-|-|-; '
      || 'eligibility.max_overage_players|sheet|int|-|-|-|-|-';
  BEGIN
    ids := _seed_61();
    C := (ids->>'c')::uuid; M_T20 := (ids->>'t20')::uuid; M_DECL := (ids->>'decl')::uuid;
    M_LATE := (ids->>'late')::uuid; M_FR := (ids->>'fr')::uuid; M_OLD := (ids->>'old')::uuid;

    -- (catalogue) the table serialises to conditions.test.mjs's CATALOGUE, read by anyone signed in
    PERFORM _as(U_SCORER);
    SELECT string_agg(concat_ws('|', k.key, k.part, k.value_type, coalesce(k.unit, '-'),
                                coalesce(array_to_string(k.enum_values, ','), '-'), CASE WHEN k.by_age_band THEN 'band' ELSE '-' END,
                                coalesce(k.platform_default::text, '-'),
                                CASE WHEN cardinality(k.readers) = 0 THEN '-' ELSE array_to_string(k.readers, ',') END),
                      '; ' ORDER BY k.sort_order, k.key) INTO got
      FROM playing_condition_key k;
    PERFORM _assert(got = CATALOGUE, format('db/61 (catalogue): the table reads %s', got));
    -- (deny) the schema refuses a key that would need a child's race, whoever writes it
    PERFORM _assert(_owner_61($q$INSERT INTO playing_condition_key (key, part, value_type, readers) VALUES ('quota.black_players', 'sheet', 'int', '{}')$q$) = '23514'
                    AND _owner_61($q$INSERT INTO playing_condition_key (key, part, value_type, readers) VALUES ('transformation.targets', 'sheet', 'int', '{}')$q$) = '23514',
      'db/61 (deny): a quota key was taken into the catalogue');
    PERFORM _assert(NOT has_table_privilege('scrbrd_app', 'playing_condition_key', 'INSERT'),
      'db/61 (deny): the application may write the catalogue');

    -- (parity) the readers over conditions.test.mjs's list (PARITY)
    SELECT string_agg(format('%s:%s/%s', k, play_free_hit(d, f)::text, play_overs(d, o)), ' ' ORDER BY k) INTO got
      FROM (VALUES ('a', '{}'::jsonb, 'T20', 20), ('b', '{}', 'Two-Day', NULL), ('c', '{}', NULL, NULL),
                   ('d', '{"format.free_hit": false}', 'T20', 20), ('e', '{"format.free_hit": true}', 'One-Day Declaration', 100),
                   ('f', '{"format.free_hit": false}', NULL, NULL), ('g', '{"format.overs_per_innings": 25}', 'T20', NULL),
                   ('h', '{"format.overs_per_innings": 25}', 'T20', 20), ('i', '{"format.free_hit": "no"}', 'T20', 20),
                   ('j', '{"format.overs_per_innings": 0}', 'Two-Day', NULL),
                   ('k', '{"format.free_hit": true, "format.overs_per_innings": 50}', 'multi-day', NULL)) AS x(k, d, f, o);
    PERFORM _assert(got = 'a:true/20 b:false/20 c:true/20 d:false/20 e:true/100 f:false/20 g:true/25 h:true/20 i:true/20 j:false/20 k:true/50',
      format('db/61 (parity): the readers read %s', got));

    -- (seed) every scored log folds byte for byte alike with no document and
    -- with the document the resolver would fix; the other free hit moves it
    f0 := _figures_61();
    PERFORM _assert(_seed_rows_61('resolved') >= 2, 'db/61 (seed): no scored match to give a document to');
    f1 := _figures_61();
    PERFORM _assert(f1 = f0, format('db/61 (seed): a document saying what the format says moved a figure: %s against %s', left(f1, 300), left(f0, 300)));
    PERFORM _seed_rows_61('flipped');
    f2 := _figures_61();
    PERFORM _assert(f2 <> f0, 'db/61 (seed): the other free hit moved nothing — the comparison compares nothing');
    PERFORM _seed_rows_61('none');
    PERFORM _assert(_figures_61() = f0, 'db/61 (seed): taking the rows away did not restore the figures');

    -- A version, by the league (competitionadmin, platform-wide): drafted,
    -- a figure entered, published from day +2.
    PERFORM _as(U_LEAGUE);
    SELECT d.set_id, d.version INTO V1, v_ver FROM condition_set_draft(C, 'Verify 061 v1', sa_today() + 2) d;
    PERFORM _assert(V1 IS NOT NULL AND v_ver = 1, 'db/61: the league could not draft version 1');
    PERFORM _assert((SELECT e.ok FROM condition_value_enter(V1, 'format.free_hit', '', 'false', 'unconfirmed') e),
      'db/61: the league could not enter a figure');
    PERFORM _assert((SELECT e.reason FROM condition_value_enter(V1, 'bowling.max_overs_per_bowler_innings', '', '4', 'confirmed') e) = 'citation_required',
      'db/61: a confirmed figure was taken with no citation');
    PERFORM _assert((SELECT e.ok FROM condition_value_enter(V1, 'bowling.max_overs_per_bowler_innings', '', '4', 'confirmed',
                                                            'Verify 061 bye-laws', '7.3', sa_today() - 10) e),
      'db/61: a cited figure was refused');

    -- (scorer) a scorer reads no version, no figure — draft or published
    PERFORM _as(U_SCORER);
    SELECT count(*) INTO n FROM condition_set;
    PERFORM _assert(n = 0 AND _count_rows('condition_set') > 0, format('db/61 (scorer): a scorer reads %s of condition_set', n));
    -- A director of sport at the organising school reads no draft either.
    PERFORM _as(U_SARAH);
    SELECT count(*) INTO n FROM condition_set WHERE id = V1;
    PERFORM _assert(n = 0, 'db/61: a draft is read by somebody who does not manage the conditions');
    PERFORM _assert((SELECT d.reason FROM condition_set_draft(C, 'Not mine', sa_today() + 2) d) = 'not_permitted',
      'db/61: a school''s director of sport drafted a league''s conditions');

    -- (retroactive) never dated today or earlier
    PERFORM _as(U_LEAGUE);
    SELECT d.set_id INTO VX FROM condition_set_draft(C, 'Verify 061 dated today', sa_today()) d;
    PERFORM _assert((SELECT p.reason FROM condition_set_publish(VX) p) = 'effective_from_not_future',
      'db/61 (retroactive): a version dated today was published');
    PERFORM condition_set_amend(VX, NULL, sa_today() - 1);
    PERFORM _assert((SELECT p.reason FROM condition_set_publish(VX) p) = 'effective_from_not_future',
      'db/61 (retroactive): a version dated yesterday was published');
    PERFORM _assert((SELECT w.ok FROM condition_set_withdraw(VX, 'Verify 061: dated wrongly') w), 'db/61: a draft could not be withdrawn');

    -- (support) a support session reaches Hilton as competitionadmin, and
    -- may draft, but never publishes
    PERFORM _as(U_PLAT);
    SELECT ok, reason, id INTO v_ok, v_reason, S_ID FROM support_access_begin(HIL, 'competitionadmin', 'ticket 5114: festival conditions');
    PERFORM _assert(v_ok, format('db/61 (support): the session was not issued (%s)', v_reason));
    PERFORM _assert((SELECT p.reason FROM condition_set_publish(V1) p) = 'support_session',
      'db/61 (support): a support session published a competition''s conditions');
    PERFORM _assert((SELECT w.reason FROM condition_set_withdraw(V1, 'support tidying up') w) = 'support_session',
      'db/61 (support): a support session withdrew a competition''s conditions');
    PERFORM support_access_end(S_ID);

    PERFORM _as(U_LEAGUE);
    PERFORM _assert((SELECT p.ok FROM condition_set_publish(V1) p), 'db/61: the league could not publish version 1');
    -- (immutable) a published figure never changes; a change is a new version
    PERFORM _assert((SELECT e.reason FROM condition_value_enter(V1, 'format.free_hit', '', 'true', 'unconfirmed') e) = 'published_is_immutable',
      'db/61 (immutable): a published figure was re-entered');
    -- A value that would be valid in a draft, so only the version's status
    -- can refuse it.
    PERFORM _assert(_owner_61(format($q$UPDATE condition_value SET value = 'true' WHERE set_id = %L AND key = 'format.free_hit'$q$, V1)) = '23514',
      'db/61 (immutable): the owner changed a published figure straight at the table');
    PERFORM _assert(_owner_61(format($q$DELETE FROM condition_value WHERE set_id = %L$q$, V1)) = '23514'
                    AND _owner_61(format($q$UPDATE condition_set SET effective_from = effective_from + 1 WHERE id = %L$q$, V1)) = '23514',
      'db/61 (immutable): the owner deleted a published figure, or moved a published version''s date');
    SELECT d.set_id INTO V2 FROM condition_set_new_version(V1) d;
    PERFORM _assert((SELECT count(*) FROM condition_value WHERE set_id = V2) = (SELECT count(*) FROM condition_value WHERE set_id = V1)
                    AND (SELECT supersedes FROM condition_set WHERE id = V2) = V1,
      'db/61 (immutable): the new version did not copy the old');
    PERFORM condition_value_enter(V2, 'format.free_hit', '', 'true', 'unconfirmed');
    PERFORM condition_set_amend(V2, NULL, sa_today() + 6);
    PERFORM _assert((SELECT p.ok FROM condition_set_publish(V2) p), 'db/61: the league could not publish version 2');

    -- The start day decides: T20 on day +3 is under v1 (published before v2,
    -- and v2 does not reach back); the declaration on day +7 and the T20 on
    -- day +8 under v2.
    PERFORM _as(U_SARAH);
    SELECT * INTO pc FROM match_playing_conditions(M_T20);
    PERFORM _assert(pc.set_version = 1 AND NOT pc.fixed AND pc.applies AND (pc.doc->'play'->>'format.free_hit')::boolean = false,
      format('db/61 (day): the day +3 fixture resolves %s', row(pc.set_version, pc.fixed, pc.doc->'play')::text));
    PERFORM _assert((SELECT set_id FROM match_playing_conditions(M_LATE)) = V2 AND (SELECT set_id FROM match_playing_conditions(M_DECL)) = V2,
      format('db/61 (day): the day +7 and +8 fixtures resolve versions %s and %s, not the second published',
             (SELECT set_version FROM match_playing_conditions(M_DECL)), (SELECT set_version FROM match_playing_conditions(M_LATE))));
    -- A friendly: the platform's defaults and the fixture.
    SELECT * INTO pc FROM match_playing_conditions(M_FR);
    PERFORM _assert(pc.set_id IS NULL AND pc.doc->'play'->'format.free_hit' = 'false' AND pc.doc->'play'->>'format.kind' = 'declaration'
                    AND pc.doc->'play'->'format.overs_per_innings' = '80' AND pc.doc->'table'->>'nrr.method' = 'standard'
                    AND pc.sources->'format.free_hit'->>'from' = 'fixture' AND pc.sources->'points.win'->>'from' = 'platform_default',
      format('db/61 (friendly): %s', pc.doc::text));

    -- (entrant) a fixture in a competition its side never entered is refused
    BEGIN
      INSERT INTO match (school_id, team_code, opponent, starts_at, sport, format, overs, competition_id)
      VALUES (HIL, 'U16B', 'Verify 061 not entered', now() + interval '3 days', 'cricket', 'T20', 20, C);
      PERFORM _assert(false, 'db/61 (entrant): a U16B fixture was arranged in a league only the 1st XI entered');
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- A departure before play, by the league, with its reason.
    PERFORM _as(U_LEAGUE);
    PERFORM _assert((SELECT o.ok FROM match_condition_override_set(M_T20, 'bowling.max_overs_per_bowler_innings', '', '3', 'Verify 061: shortened spells') o),
      'db/61: the league could not depart from its conditions before play');

    -- (fix) the first event fixes it — as the scorer the write path runs as —
    -- and a later version, override or change of competition moves nothing.
    -- A match scored with no document is never given one (D4).
    PERFORM _as(U_SCORER);
    SELECT count(*) INTO n FROM match_conditions WHERE match_id = M_T20;
    PERFORM _assert(n = 0, 'db/61 (fix): a document before the first event');
    PERFORM _assert((SELECT fx.fixed FROM match_conditions_fix(M_T20) fx) AND (SELECT fx.fixed FROM match_conditions_fix(M_DECL) fx),
      'db/61 (fix): the scorer could not fix the documents');
    PERFORM _assert((SELECT fx.reason FROM match_conditions_fix(M_OLD) fx) = 'scored_before_conditions'
                    AND NOT EXISTS (SELECT 1 FROM match_conditions WHERE match_id = M_OLD),
      'db/61 (fix): a match scored before db/61 was given a document');
    PERFORM _as(U_PARENT);
    PERFORM _assert((SELECT fx.reason FROM match_conditions_fix(M_LATE) fx) = 'not_permitted',
      'db/61 (fix): somebody who may not score the match fixed its conditions');
    -- The scorer reads the document of a match he may read (fixture.read).
    PERFORM _as(U_SCORER);
    PERFORM _log_61(M_T20);
    PERFORM _log_61(M_DECL);
    SELECT doc_hash INTO h1 FROM match_conditions WHERE match_id = M_T20;
    PERFORM _assert(h1 = (SELECT md5(doc::text) FROM match_conditions WHERE match_id = M_T20)
                    AND (SELECT (doc->'play'->>'bowling.max_overs_per_bowler_innings')::int FROM match_conditions WHERE match_id = M_T20) = 3,
      'db/61 (fix): the fixed document is not the resolved one, or its hash is not md5(doc::text)');
    -- (override) refused once fixed
    PERFORM _as(U_LEAGUE);
    PERFORM _assert((SELECT o.reason FROM match_condition_override_set(M_T20, 'format.free_hit', '', 'true', 'Verify 061: too late now') o) = 'conditions_fixed',
      'db/61 (override): a departure was taken after the first ball');
    -- A later version does not touch it.
    SELECT d.set_id INTO VX FROM condition_set_new_version(V2) d;
    PERFORM condition_set_amend(VX, NULL, sa_today() + 9);
    PERFORM condition_set_publish(VX);
    PERFORM _assert((SELECT doc_hash FROM match_conditions WHERE match_id = M_T20) = h1, 'db/61: a later version moved a fixed document');
    -- (frozen) the play part never changes, even for the owner
    PERFORM _assert(_owner_61(format($q$UPDATE match_conditions SET doc = jsonb_set(doc, '{play,format.free_hit}', 'true') WHERE match_id = %L$q$, M_T20)) = '23514',
      'db/61 (frozen): a fixed play document changed');
    -- ...nor the competition it was played under.
    PERFORM _assert(_owner_61(format($q$UPDATE match SET competition_id = NULL WHERE id = %L$q$, M_T20)) = '23514',
      'db/61: a scored fixture changed competition');

    -- (parity) the frozen document decides the free hit, both ways round,
    -- in every SQL reader: a T20 under free_hit = false stands the bowled
    -- after the no-ball; a declaration under free_hit = true saves it. The
    -- fold reads the same (conditions.test.mjs, D).
    PERFORM _as(U_OWNER);
    SELECT string_agg(format('%s(%s,%s,%s,%s)', x.label,
             (SELECT l.wickets FROM match_live_score l WHERE l.match_id = x.m AND l.innings = 0),
             (SELECT f.wickets FROM innings_score_as_folded(x.m, 0::smallint) f),
             (SELECT sum(o.legal_balls) FROM bowler_over o WHERE o.match_id = x.m),
             ball_on_free_hit(x.m, 0::smallint, 2)::text), ' ' ORDER BY x.label) INTO got
      FROM (VALUES ('decl', M_DECL), ('old', M_OLD), ('t20', M_T20)) AS x(label, m);
    PERFORM _assert(got = 'decl(0,0,1,true) old(0,0,1,true) t20(1,1,1,false)',
      format('db/61 (parity): the readers read %s', got));
    PERFORM _assert((SELECT fixed FROM match_playing_conditions(M_T20)) AND NOT (SELECT applies FROM match_playing_conditions(M_OLD)),
      'db/61: a fold would apply the wrong document');

    -- The grants: the application's alone.
    FOREACH t IN ARRAY ARRAY['match_playing_conditions(uuid)', 'match_conditions_fix(uuid)', 'match_conditions_resolve(uuid)',
                             'condition_set_publish(uuid)', 'public_match_conditions(uuid)'] LOOP
      PERFORM _assert(has_function_privilege('scrbrd_app', t::regprocedure, 'EXECUTE')
                      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                                       WHERE p.oid = t::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE'),
        format('db/61 (grants): %s is not the application''s alone', t));
    END LOOP;
    PERFORM _assert(NOT has_function_privilege('scrbrd_app', 'match_conditions_compute(uuid)', 'EXECUTE'),
      'db/61 (grants): the application may compute a match''s document with no guard');
  END;

  -- ── 40. The guardian link past eighteen (SCRBRD-110 phase 0, db/62) ──
  -- §9's phase 0 row: a pupil's link is open on his eighteenth birthday and
  -- app_can() still grants his parent; a club member's ends on the birthday
  -- as before; a minor who leaves keeps it until his birthday; an adult who
  -- leaves loses it that day; a boy re-enrolled, or enrolled after his link
  -- was made, has it re-opened; a new link for an adult is still refused.
  -- All of it through either door: guardian_link_establish(), and a granted
  -- role_request (decide_role_request(); Kameel, 2026-09-30). (db/10
  -- unchanged is the ledger's and shipped.test's: migrate.mjs refuses a
  -- changed file, and tools/smoke-link18.mjs compares
  -- db/10's hash with db/SHIPPED.sha256 and the ledger.) Then the two
  -- consents on top of it: her health "yes" carries on at eighteen while he
  -- is at school and dies when he leaves; her "yes" after eighteen is refused
  -- and her "no" is not; his own answer governs once given. And option C
  -- for the public name (SCRBRD-083 §6.3): after eighteen she may take his
  -- name off, never put it on, and her "no" beats the other parent's "yes".
  --
  -- db/62's triggers are deferred to the end of the transaction; _v62_fire()
  -- fires them where the application's transaction would commit.
  --
  -- Each guard in db/62 was broken once, the database rebuilt and this file
  -- run, and went red — at the first assertion able to see it, which for
  -- some is an earlier section's:
  --   establish writes the birthday for a pupil  → "did not leave a pupil's link open" (guardianship block)
  --   establish's adult refusal taken out        → "a guardian can be linked to a player who has turned eighteen"
  --   decide_role_request writes the birthday    → (request)
  --   the triggers INITIALLY IMMEDIATE           → db/62's own proof; with that cut too, "no pupil at school has
  --                                                an open guardian link", and (move) in tools/smoke-link18.mjs
  --   the CLOSE doing nothing                    → (leaves)
  --   the CLOSE ending a minor's on the day      → (minor)
  --   the OPEN doing nothing                     → "no pupil at school has an open guardian link" (the seed's)
  --   the OPEN re-opening any ended link         → "a guardian still reads ... turned eighteen" (S Naidoo's)
  --   her "no" after 18 refused (db/47's rule)   → (no-18)
  --   her "yes" after 18 taken                   → section 25's (adult)
  --   the facts without the refusal arm          → (facts)
  --   option C's not-at-school refusal cut       → section 25's (adult)
  --   the data step doing nothing                → db/62's own proof, in the paste rehearsal (on a fresh
  --                                                database the step has nothing to do)
  DECLARE
    ids     jsonb := _seed_62();
    HIL     uuid := '11111111-1111-1111-1111-111111111111';
    ZERO    uuid := '00000000-0000-0000-0000-000000000000';
    CLUB    uuid;
    P_PUP   uuid; P_ADU uuid; P_MIN uuid; P_LATE uuid; P_GROWN uuid; P_CLUB uuid;
    P_RPUP  uuid; P_RCLUB uuid; P_RADU uuid; U_RMUM uuid; U_RCMUM uuid; U_RAMUM uuid;
    U_OFF   uuid; U_COFF uuid; U_MUM uuid; U_DAD uuid; U_AMUM uuid; U_MMUM uuid;
    U_LMUM  uuid; U_GMUM uuid; U_CMUM uuid; U_SELF uuid;
    V       text := 'health-monitoring-2026-09';
    VP      text := 'public-name-2026-09';
    l       record;
    v_facts jsonb;
    v_body  text;
  BEGIN
    CLUB := (ids->>'club')::uuid;
    P_PUP := (ids->>'p_pupil')::uuid;  P_ADU := (ids->>'p_adult')::uuid; P_MIN := (ids->>'p_minor')::uuid;
    P_LATE := (ids->>'p_late')::uuid;  P_GROWN := (ids->>'p_grown')::uuid; P_CLUB := (ids->>'p_club')::uuid;
    U_OFF := (ids->>'u_office')::uuid; U_COFF := (ids->>'u_coffice')::uuid;
    U_MUM := (ids->>'u_mum')::uuid;    U_DAD := (ids->>'u_dad')::uuid;     U_AMUM := (ids->>'u_amum')::uuid;
    U_MMUM := (ids->>'u_mmum')::uuid;  U_LMUM := (ids->>'u_lmum')::uuid;   U_GMUM := (ids->>'u_gmum')::uuid;
    U_CMUM := (ids->>'u_cmum')::uuid;  U_SELF := (ids->>'u_self')::uuid;
    P_RPUP := (ids->>'p_rpupil')::uuid; P_RCLUB := (ids->>'p_rclub')::uuid; P_RADU := (ids->>'p_radult')::uuid;
    U_RMUM := (ids->>'u_rmum')::uuid;  U_RCMUM := (ids->>'u_rcmum')::uuid; U_RAMUM := (ids->>'u_ramum')::uuid;
    -- The seed's memberships were opened in this transaction; what the
    -- application's commit would do to them happens now, before anything
    -- is asked. Liam is then out of the school system when his link is made.
    PERFORM _v62_fire();
    PERFORM _v60_leave(P_LATE);
    PERFORM _v62_fire();

    -- (open) The offices link the parents, as db/08's functions do. A pupil's
    -- link is open; the club member's, and the boy out of school's, end on
    -- the eighteenth birthday exactly as before.
    PERFORM _as(U_OFF);
    FOR l IN SELECT * FROM (VALUES (U_MUM, P_PUP), (U_DAD, P_PUP), (U_AMUM, P_ADU), (U_MMUM, P_MIN), (U_LMUM, P_LATE)) AS v(g, p) LOOP
      SELECT ok, reason INTO v_ok, v_reason FROM guardian_link_establish(l.g, l.p, 'parent');
      PERFORM _assert(v_ok, format('db/62 (link): Hilton''s office could not link a parent (%s)', v_reason));
      SELECT ok, reason INTO v_ok, v_reason FROM guardian_link_verify(l.g, l.p, 'popia-2026-01');
      PERFORM _assert(v_ok, format('db/62 (link): Hilton''s office could not verify a parent (%s)', v_reason));
    END LOOP;
    PERFORM _as(U_COFF);
    SELECT ok, reason INTO v_ok, v_reason FROM guardian_link_establish(U_CMUM, P_CLUB, 'parent');
    PERFORM _assert(v_ok, format('db/62 (link): the club''s office could not link a parent (%s)', v_reason));
    SELECT ok, reason INTO v_ok, v_reason FROM guardian_link_verify(U_CMUM, P_CLUB, 'popia-2026-01');
    PERFORM _assert(v_ok, format('db/62 (link): the club''s office could not verify a parent (%s)', v_reason));
    SELECT string_agg(format('%s:%s', x.k, coalesce((_v62_link(x.p, x.g)).until::text, 'open')), ' ' ORDER BY x.k) INTO v_body
      FROM (VALUES ('adult', P_ADU, U_AMUM), ('club', P_CLUB, U_CMUM), ('dad', P_PUP, U_DAD), ('late', P_LATE, U_LMUM),
                   ('minor', P_MIN, U_MMUM), ('pupil', P_PUP, U_MUM)) AS x(k, p, g);
    PERFORM _assert(v_body = format('adult:open club:%s dad:open late:%s minor:open pupil:open',
                                    majority_on(_born_of(P_CLUB)), majority_on(_born_of(P_LATE))),
      format('db/62 (open): the links were written %s', v_body));

    -- (grown) A new link is never made for an adult, at school or not.
    PERFORM _as(U_OFF);
    SELECT ok, reason INTO v_ok, v_reason FROM guardian_link_establish(U_GMUM, P_GROWN, 'parent');
    PERFORM _assert(NOT v_ok AND v_reason = 'player_is_an_adult' AND _count_guardian_assignments(U_GMUM) = 0
                    AND _count_subjects(P_GROWN) = 0,
      format('db/62 (grown): a parent was linked to a pupil of eighteen (%s, %s)', v_ok, v_reason));

    -- (request) The other door: the office grants a parent's role_request
    -- (decide_role_request(), and enrol_person() through it). The same rule:
    -- open for a pupil at school, his birthday for a club member, and never
    -- a guardian for an adult — refused, leaving nothing behind.
    PERFORM _as(U_OFF);
    SELECT ok, reason INTO v_ok, v_reason FROM decide_role_request((ids->>'r_rpupil')::uuid, true, 'verify db/62');
    PERFORM _assert(v_ok, format('db/62 (request): Hilton''s office could not grant a parent''s request (%s)', v_reason));
    PERFORM _as(U_COFF);
    SELECT ok, reason INTO v_ok, v_reason FROM decide_role_request((ids->>'r_rclub')::uuid, true, 'verify db/62');
    PERFORM _assert(v_ok, format('db/62 (request): the club''s office could not grant a parent''s request (%s)', v_reason));
    PERFORM _assert((_v62_link(P_RPUP, U_RMUM)).open
                    AND (_v62_link(P_RCLUB, U_RCMUM)).until = majority_on(_born_of(P_RCLUB)),
      format('db/62 (request): a granted request wrote the pupil''s link %s and the club member''s %s',
             coalesce((_v62_link(P_RPUP, U_RMUM)).until::text, 'open'), coalesce((_v62_link(P_RCLUB, U_RCMUM)).until::text, 'open')));
    PERFORM _as(U_OFF);
    SELECT ok, reason INTO v_ok, v_reason FROM decide_role_request((ids->>'r_radult')::uuid, true, 'verify db/62');
    PERFORM _assert(NOT v_ok AND v_reason = 'player_is_an_adult' AND _count_guardian_assignments(U_RAMUM) = 0
                    AND _count_subjects(P_RADU) = 0,
      format('db/62 (request): a parent''s request for a pupil of eighteen was granted (%s, %s)', v_ok, v_reason));

    -- Before eighteen: the pupil's mother says yes to health monitoring; his
    -- father says yes to his name on public pages and his mother says
    -- nothing; Andile's mother says yes to health monitoring.
    PERFORM _as(U_MUM);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_PUP, true, V);
    PERFORM _assert(v_ok AND _v60_live(P_PUP), format('db/62 (consent): the mother''s yes at seventeen (%s)', v_reason));
    PERFORM _as(U_DAD);
    SELECT ok, reason INTO v_ok, v_reason FROM public_name_consent_set(P_PUP, true, VP);
    PERFORM _assert(v_ok, format('db/62 (consent): the father''s public-name yes at seventeen (%s)', v_reason));
    PERFORM _as(U_AMUM);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_ADU, true, V);
    PERFORM _assert(v_ok AND _v60_live(P_ADU), format('db/62 (consent): Andile''s mother''s yes at seventeen (%s)', v_reason));

    -- (eighteen) Today is the pupil's, Andile's and the club member's
    -- eighteenth birthday.
    PERFORM _v62_turn_eighteen(P_PUP);
    PERFORM _v62_turn_eighteen(P_ADU);
    PERFORM _v62_turn_eighteen(P_CLUB);
    PERFORM _v62_turn_eighteen(P_RPUP);
    PERFORM _v62_turn_eighteen(P_RCLUB);
    -- The pupil's link is open on his birthday, and app_can() still grants
    -- his mother: his record and his roster row.
    PERFORM _assert((_v62_link(P_PUP, U_MUM)).open AND (_v62_link(P_PUP, U_DAD)).open,
      'db/62 (eighteen): a pupil''s guardian link is not open on his eighteenth birthday');
    PERFORM _as(U_MUM);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_PUP;
    PERFORM _assert(n = 1 AND app_can('player.profile.read', HIL, '1XI', P_PUP, ZERO),
      format('db/62 (eighteen): app_can() refused a pupil''s mother on his eighteenth birthday (%s rows)', n));
    -- The club member's ends on the birthday, as it always has.
    PERFORM _assert((_v62_link(P_CLUB, U_CMUM)).until = current_date,
      format('db/62 (club): the club member''s link ends %s, not on his birthday', (_v62_link(P_CLUB, U_CMUM)).until));
    PERFORM _as(U_CMUM);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_CLUB;
    PERFORM _assert(n = 0 AND NOT app_can('player.profile.read', CLUB, '1XI', P_CLUB, ZERO),
      'db/62 (club): a club member''s parent still reads him on his eighteenth birthday');
    -- (request) ...and the same through the other door: the granted parent of
    -- the pupil keeps him on his birthday; the club member's does not.
    PERFORM _as(U_RMUM);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_RPUP;
    PERFORM _assert(n = 1 AND (_v62_link(P_RPUP, U_RMUM)).open AND app_can('player.profile.read', HIL, '1XI', P_RPUP, ZERO),
      format('db/62 (request): a granted parent lost her pupil son on his eighteenth birthday (%s rows)', n));
    PERFORM _as(U_RCMUM);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_RCLUB;
    PERFORM _assert(n = 0 AND (_v62_link(P_RCLUB, U_RCMUM)).until = current_date,
      'db/62 (request): a granted club parent still reads him on his eighteenth birthday');

    -- (health) Her pre-18 yes is live on his birthday while he is at school;
    -- her yes after it is refused; her "no" after it works; and his own
    -- answer, once given, is the only one that counts.
    PERFORM _assert(_v60_live(P_PUP), 'db/62 (health): her pre-18 yes lapsed on his birthday while he is at school');
    PERFORM _as(U_MUM);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_PUP, true, V || '-b');
    PERFORM _assert(NOT v_ok AND v_reason = 'adult_consents_for_himself', format('db/62 (health): her yes after eighteen: %s', v_reason));
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_PUP, false, V);
    PERFORM _assert(v_ok AND NOT _v60_live(P_PUP), format('db/62 (health): her no after eighteen: %s, live %s', v_reason, _v60_live(P_PUP)));
    PERFORM _as(U_SELF);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_PUP, true, V);
    PERFORM _assert(v_ok AND _v60_live(P_PUP), format('db/62 (health): his own yes after her no: %s', v_reason));
    PERFORM _as(U_MUM);
    SELECT ok, reason INTO v_ok, v_reason FROM health_monitoring_consent_set(P_PUP, false, V);
    PERFORM _assert(v_ok AND _v60_live(P_PUP), format('db/62 (health): her later no outvoted his own yes: %s, live %s', v_reason, _v60_live(P_PUP)));

    -- Option C. (carries) His father's standing pre-18 yes still names him;
    -- (yes-18) his mother may not newly put his name on, herself or through
    -- the office's form; (no-18) she may take it off — a refusal, with
    -- nothing of hers open — and (facts) it counts, and is the latest act,
    -- so it beats the father's yes.
    v_facts := public_name_facts(P_PUP);
    PERFORM _assert(jsonb_array_length(v_facts -> 'consents') = 1
                    AND v_facts #> '{consents,0,competent}' = 'true'::jsonb AND v_facts #>> '{consents,0,endedOn}' IS NULL,
      format('db/62 (carries): the father''s pre-18 yes does not carry on at eighteen: %s', v_facts));
    PERFORM _as(U_MUM);
    SELECT ok, reason INTO v_ok, v_reason FROM public_name_consent_set(P_PUP, true, VP);
    PERFORM _assert(NOT v_ok AND v_reason = 'adult_consents_for_himself',
      format('db/62 (yes-18): a parent put an adult''s name on public pages (%s, %s)', v_ok, v_reason));
    PERFORM _as(U_OFF);
    SELECT ok, reason INTO v_ok, v_reason FROM public_name_consent_set(P_PUP, true, VP, U_MUM, 'Admission form 2026', sa_today());
    PERFORM _assert(NOT v_ok AND v_reason = 'adult_consents_for_himself',
      format('db/62 (yes-18): the office put an adult''s name on for his parent (%s, %s)', v_ok, v_reason));
    PERFORM _as(U_MUM);
    SELECT ok, reason INTO v_ok, v_reason FROM public_name_consent_set(P_PUP, false, VP);
    PERFORM _assert(v_ok, format('db/62 (no-18): a parent could not take her adult son''s name off while he is at school (%s)', v_reason));
    v_facts := public_name_facts(P_PUP);
    SELECT count(*) INTO n FROM jsonb_array_elements(v_facts -> 'consents') x
     WHERE x ->> 'by' = 'guardian' AND (x ->> 'competent')::boolean
       AND x ->> 'givenOn' = to_char(sa_today(), 'YYYY-MM-DD') AND x ->> 'endedOn' = to_char(sa_today(), 'YYYY-MM-DD');
    PERFORM _assert(n = 1 AND jsonb_array_length(v_facts -> 'consents') = 2
                    AND (SELECT x ->> 'givenOn' FROM jsonb_array_elements(v_facts -> 'consents') x
                          WHERE (x ->> 'competent')::boolean ORDER BY x ->> 'givenOn' DESC LIMIT 1) = to_char(sa_today(), 'YYYY-MM-DD'),
      format('db/62 (facts): her no after eighteen is not a competent, latest act beside his father''s yes: %s', v_facts));
    -- (his) He speaks for himself: his own yes is a competent record, and
    -- from it his records alone govern (publicName(), unchanged).
    PERFORM _as(U_SELF);
    SELECT ok, reason INTO v_ok, v_reason FROM public_name_consent_set(P_PUP, true, VP);
    v_facts := public_name_facts(P_PUP);
    PERFORM _assert(v_ok AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_facts -> 'consents') x
                                      WHERE x ->> 'by' = 'pupil' AND (x ->> 'competent')::boolean AND x ->> 'endedOn' IS NULL),
      format('db/62 (his): his own yes at eighteen is not a competent, open record (%s): %s', v_reason, v_facts));

    -- (move) Ten days after his birthday, an adult pupil moved from one side
    -- to another keeps his parent: the move closes a membership and opens
    -- one, and the link is judged on what the transaction leaves — at school.
    -- (Judged statement by statement it would end on the moving day, which is
    -- not his birthday, and nothing would re-open it.)
    PERFORM _v62_older(P_ADU, 10);
    PERFORM _v62_move(P_ADU, '2XI');
    PERFORM _v62_fire();
    PERFORM _assert((_v62_link(P_ADU, U_AMUM)).open AND _v60_live(P_ADU),
      format('db/62 (move): moving an adult pupil between sides ended his parent''s link (until %s)', (_v62_link(P_ADU, U_AMUM)).until));

    -- (leaves) An adult who leaves loses his parent that day — her access,
    -- and the health consent that ran through it; and his public name is no
    -- longer hers to answer for.
    PERFORM _v60_leave(P_ADU);
    PERFORM _v62_fire();
    PERFORM _assert((_v62_link(P_ADU, U_AMUM)).until = current_date,
      format('db/62 (leaves): an adult''s link, on the day he left, ends %s', coalesce((_v62_link(P_ADU, U_AMUM)).until::text, 'never')));
    PERFORM _as(U_AMUM);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_ADU;
    PERFORM _assert(n = 0 AND NOT app_can('player.profile.read', HIL, '2XI', P_ADU, ZERO),
      'db/62 (leaves): the parent of an adult who has left still reads him');
    PERFORM _assert(NOT _v60_live(P_ADU), 'db/62 (leaves): her health consent outlived her link when he left');
    SELECT ok, reason INTO v_ok, v_reason FROM public_name_consent_set(P_ADU, false, VP);
    PERFORM _assert(NOT v_ok AND v_reason = 'not_permitted', format('db/62 (leaves): her no after he left (%s)', v_reason));
    PERFORM _as(U_OFF);
    SELECT ok, reason INTO v_ok, v_reason FROM public_name_consent_set(P_ADU, false, VP, U_AMUM);
    PERFORM _assert(NOT v_ok AND v_reason = 'no_verified_link', format('db/62 (leaves): the office''s no for her after he left (%s)', v_reason));
    -- (never) ...and coming back does not bring it back: it ended on the day
    -- he left, not on his birthday, and a new one cannot be made for an adult.
    PERFORM _v60_rejoin(P_ADU);
    PERFORM _v62_fire();
    PERFORM _assert((_v62_link(P_ADU, U_AMUM)).until = current_date,
      format('db/62 (never): an adult''s link ended on his leaving re-opened when he came back (%s)', coalesce((_v62_link(P_ADU, U_AMUM)).until::text, 'open')));

    -- (minor) A minor who leaves keeps his parent until his birthday.
    PERFORM _v60_leave(P_MIN);
    PERFORM _v62_fire();
    PERFORM _assert((_v62_link(P_MIN, U_MMUM)).until = majority_on(_born_of(P_MIN)),
      format('db/62 (minor): a minor''s link, when he left, ends %s, not on his birthday', coalesce((_v62_link(P_MIN, U_MMUM)).until::text, 'never')));
    PERFORM _as(U_MMUM);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_MIN;
    PERFORM _assert(n = 1, 'db/62 (minor): a minor''s parent lost him the day he left school');
    -- (back) He comes back: open again.
    PERFORM _v60_rejoin(P_MIN);
    PERFORM _v62_fire();
    PERFORM _assert((_v62_link(P_MIN, U_MMUM)).open, 'db/62 (back): a boy re-enrolled did not have his link re-opened');
    -- He leaves again, and turns eighteen out of school: it ends on the day.
    PERFORM _v60_leave(P_MIN);
    PERFORM _v62_fire();
    PERFORM _v62_turn_eighteen(P_MIN);
    PERFORM _assert((_v62_link(P_MIN, U_MMUM)).until = current_date,
      format('db/62 (minor): out of school, his link does not end on his eighteenth birthday (%s)', (_v62_link(P_MIN, U_MMUM)).until));
    PERFORM _as(U_MMUM);
    SELECT count(*) INTO n FROM player_masked WHERE id = P_MIN;
    PERFORM _assert(n = 0, 'db/62 (minor): the parent of a boy who left at sixteen still reads him on his eighteenth birthday');
    -- (back) The boy enrolled after his link was made.
    PERFORM _assert((_v62_link(P_LATE, U_LMUM)).until = majority_on(_born_of(P_LATE)),
      'db/62 (back): the late boy''s link, made out of school, does not end on his birthday');
    PERFORM _v60_rejoin(P_LATE);
    PERFORM _v62_fire();
    PERFORM _assert((_v62_link(P_LATE, U_LMUM)).open, 'db/62 (back): a boy enrolled after his link was made did not have it re-opened');

    -- Nothing here left the table holding an adult's open link out of school.
    PERFORM _assert(_count_open_guardian_links() = 0,
      'db/62: a guardian link is open-ended for an adult who is not at school');
  END;

  PERFORM set_config('app.user_id', '', true);

  RAISE NOTICE 'ALL RLS LIVE ASSERTIONS PASSED';
END $$;

ROLLBACK;
\set QUIET off

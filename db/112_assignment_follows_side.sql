-- ══════════════════════════════════════════════════════════════════
--  112 · A moved pupil follows his new side (SR-1), and a boy playing up
--        reads the balls of the match he is picked for
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Two things, both about which side a pupil reads as:
--
--   1. SR-1 (docs/design/SEASON_ROLLOVER.md §1.2, §8; Kameel decided its
--      questions on 15 October 2026, as recommended). The player row is the
--      truth; the boy's `player` assignment follows it.
--   2. The playing-up ball log (Kameel, 15 October 2026: yes). db/106 (e)
--      gave a boy playing up the fixture he is picked for, and said "he reads
--      the fixture and not yet its balls". This gives him its balls, by the
--      same rule.
--
-- Its proof is db/99 §89; the HTTP walk is tools/smoke-player-move.mjs.
--
-- ── 1 · THE GAP ─────────────────────────────────────────────────────
-- A pupil's side is stored twice: on his `player` row (player.team_code),
-- which the move route (services/api/write/roster-api.mjs) and the CSV import
-- write, and on his `player` role assignment (role_assignment.team_code),
-- which role_request_grant_as() writes once, at grant, and nothing moves.
-- So after Hilton moves a boy from U14A to U15A, app_can()'s team test for
-- his `player` assignment (db/50: a.team_code = p_team) still answers for
-- U14A: he reads U14A's fixtures, posts, plans, bus and nets as one of its
-- players, and none of U15A's, while his mother (whose link names him, and
-- whose reach follows player.team_code) reads U15A's.
--
-- ── 2 · THE RULE ───────────────────────────────────────────────────
-- When a boy's side changes, every live `player` assignment of HIS accounts
-- at his school follows it:
--   to a side      the assignment is carried to the new side;
--   to no side     the assignment is ENDED (active = false: kept, with its
--                  dates and provenance, never deleted). Never a NULL side:
--                  db/108's CHECK (role_assignment_player_team_scoped) forbids
--                  a live `player` row with no team, because a pupil with no
--                  side reads every side at his school.
--
-- HIS ACCOUNTS, exactly the set db/106's my_own_boy() computes, asked the
-- other way round: an account whose app_user.player_id is the boy, or which
-- holds a live (active, in date, not past its hour) `selfaccess` assignment
-- whose subject names him, verified and in date. Never a guardian's, a
-- coach's, or anybody his unnamed `player` assignment reaches. An account
-- that is ALSO another boy at the same school (two boys on one account: not
-- a shape any door writes) is left alone: it has no one side to follow, and
-- moving it for one boy would move it away from the other's.
--
-- WHICH ASSIGNMENTS: role 'player', active, at the boy's school (the player
-- row's school_id), naming no fixture (a fixture-scoped appointment is about
-- that fixture's side, not his), with no expiry hour (a time-boxed row ends
-- at its hour; db/22's support sessions lend no `player` role). Guardian,
-- selfaccess and every other role are never touched; nor are any
-- assignment_subject rows.
--
-- ── 3 · HOW IT CARRIES: END AND RE-APPOINT, NOT RE-POINT ───────────
-- The design's sketch was `UPDATE role_assignment SET team_code = …`. db/01's
-- role_assignment_revoke_only() refuses that, for every caller, the owner
-- included: "an assignment may be deactivated, not re-pointed; withdraw this
-- one and make the appointment you meant". db/01 is frozen, and that rule is
-- right: a re-pointed row would carry its old provenance onto a side it was
-- never granted for. So a carry is that rule's honest form, in one step:
--   the old row is ENDED   active = false; db/01's trigger stamps revoked_at
--                          and revoked_by (the mover, or NULL for the owner)
--   a new row is OPENED    the same person, role, school, season and dates,
--                          at the new side; db/01's role_assignment_granter
--                          stamps created_at and created_by (the mover)
-- so the record reads: appointed to U14A at grant; ended and re-appointed to
-- U15A on the day of the move, by the person who moved him, with the
-- team_membership row (db/08) beside it saying when it took effect. No
-- role_assignment_ending row is written: that is role_assignment_end()'s
-- audit of an office's decision to end a role, with its reason and a notice
-- to the person (db/77); a move is not that decision, and the boy is told
-- nothing new. If a live row at the new side already exists for that person
-- with the same season and dates, no second one is opened.
--
-- ── 4 · THE DOORS ──────────────────────────────────────────────────
--   player_own_accounts(player)   his accounts (§2), as the owner
--   player_assignment_carry(player, school, team)
--                                  ends and re-opens, as above; answers
--                                  (ended, opened)
--   player_assignment_follows_side()   AFTER UPDATE OF team_code, school_id
--                                  ON player: the carry, when the side or the
--                                  school changed. A sibling of db/08's
--                                  player_moves_are_recorded, which is not
--                                  touched (the design's "or a sibling
--                                  trigger in the same migration").
--   player_assignment_disagreements()  every live carryable assignment whose
--                                  side is not his player row's: the one
--                                  question the correction, the self-check
--                                  and db/99 §89 ask
--   player_assignment_correct()   the one-time correction, below
-- All five are SECURITY DEFINER (as the history trigger is: the mover holds
-- player.profile.manage, not user.role.assign, and must not need it), with a
-- pinned path, and executable by NOBODY but their owner: the application
-- never calls them, and role_assignment gains no policy.
--
-- WHY A MOVER WHO MAY NOT GRANT MAY CARRY. The carry grants nothing new: the
-- person already held a `player` role at that school, granted by someone who
-- could; it opens at exactly the side the roster now says, which the mover
-- was already permitted to write (player_update, db/09). His family's reach
-- already follows that write (db/106); this makes the boy's own reach agree.
--
-- ── 5 · THE ONE-TIME CORRECTION ────────────────────────────────────
-- Any live assignment that disagrees with player.team_code TODAY (a boy moved
-- before this file) is carried by the same rule, once, in the paste:
-- carried to his side, or ended if he has none. Guarded and idempotent:
--   - it acts only on player_assignment_disagreements(), so a second paste
--     finds none and changes nothing;
--   - it names what it did (a NOTICE: the count, each assignment, the old and
--     the new side) and checks after itself that none is left;
--   - role_assignment is locked (SHARE ROW EXCLUSIVE, lock_timeout 10s) for
--     the length of that one block, so no grant lands between the question
--     and the answer.
-- The seed (db/98) holds two live `player` assignments: the seeded pupil
-- R Pillay's (1XI, which is his side) and spectator@'s (1XI, an account that
-- is no boy). The correction finds none to fix there. Production's count is
-- unknown until the paste: the NOTICE says it.
--
-- ── 6 · THE PLAYING-UP BALL LOG ────────────────────────────────────
-- ball_event_read (db/100) gains a fourth branch, the shape of db/106's (4):
--   my_own_sheet_fixtures()  the fixtures whose sheet names the reader
--       himself (my_own_boy(): his account's player, or his live verified
--       self-access link), not withdrawn, at HIS OWN school's end, where he
--       holds fixture.read about himself at his own side (his `player`
--       assignment, kept on his side by §1-§5). db/106's branch (4) word for
--       word, as a set of fixture ids; db/100's branch shape:
--       `match_id = ANY ((SELECT my_own_sheet_fixtures())::uuid[])`, an
--       InitPlan, once per scan.
-- So the boy playing up reads that match's balls, and no other match of the
-- older side; a withdrawn boy reads none of it; nobody his unnamed `player`
-- assignment reaches (a team-mate on no sheet) gains anything. db/100's three
-- branches are kept word for word, and my_child_fixtures() is not touched:
-- a guardian's reads are unchanged (my_own_boy() names nobody for her, so the
-- new branch is empty for every guardian).
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   + five functions (above) and one function for the policy,
--     my_own_sheet_fixtures(), executable by scrbrd_app alone
--   + one trigger on player, player_assignment_follows_side
--   ball_event_read: dropped and created again with the fourth branch, in the
--     paste's one transaction (guarded: it must be db/100's, or already this
--     file's)
--   role_assignment: the correction's rows, if any (NOTICE), and nothing else
-- No table, column, index, grant on a table, or capability. db/01, db/08's
-- trigger, db/100's my_child_fixtures(), db/106's helpers, db/108's CHECK and
-- role_request_grant_as() are not touched. A second paste changes nothing.

-- ── 0 · What this file relies on is there ──────────────────────────
DO $needs$
BEGIN
  IF to_regprocedure('player_team_membership_log()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('player') AND tgname = 'player_moves_are_recorded') THEN
    RAISE EXCEPTION 'db/112: db/08''s team_membership trigger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('role_assignment')
                    AND conname = 'role_assignment_player_team_scoped' AND convalidated) THEN
    RAISE EXCEPTION 'db/112: db/108''s role_assignment_player_team_scoped is missing or not validated; apply db/108 first';
  END IF;
  IF to_regprocedure('my_own_boy()') IS NULL OR to_regprocedure('my_child_fixtures()') IS NULL
     OR to_regprocedure('role_assignment_revoke_only()') IS NULL THEN
    RAISE EXCEPTION 'db/112: db/01, db/100 or db/106 is missing; apply them first';
  END IF;
END $needs$;


-- ── 1 · His accounts ───────────────────────────────────────────────
-- my_own_boy() asked the other way round (header §2). As the owner.
CREATE OR REPLACE FUNCTION player_own_accounts(p_player uuid) RETURNS SETOF uuid AS $$
  SELECT m.person
    FROM (SELECT u.id FROM app_user u WHERE u.player_id = p_player
          UNION
          SELECT a.person_id
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
           WHERE g.player_id = p_player
             AND a.role = 'selfaccess' AND a.active
             AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
             AND (a.valid_until IS NULL OR a.valid_until >  current_date)
             AND (a.expires_at  IS NULL OR a.expires_at  >  now())
             AND g.verification_state = 'verified'
             AND g.valid_from <= current_date
             AND (g.valid_until IS NULL OR g.valid_until > current_date)) m(person)
   -- ...and is no other boy at his school, by either spelling.
   WHERE NOT EXISTS (SELECT 1 FROM app_user u
                       JOIN player q ON q.id = u.player_id
                      WHERE u.id = m.person AND q.id <> p_player
                        AND q.school_id = (SELECT b.school_id FROM player b WHERE b.id = p_player))
     AND NOT EXISTS (SELECT 1
                       FROM role_assignment a
                       JOIN assignment_subject g ON g.assignment_id = a.id
                       JOIN player q ON q.id = g.player_id
                      WHERE a.person_id = m.person AND q.id <> p_player
                        AND q.school_id = (SELECT b.school_id FROM player b WHERE b.id = p_player)
                        AND a.role = 'selfaccess' AND a.active
                        AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
                        AND (a.valid_until IS NULL OR a.valid_until >  current_date)
                        AND (a.expires_at  IS NULL OR a.expires_at  >  now())
                        AND g.verification_state = 'verified'
                        AND g.valid_from <= current_date
                        AND (g.valid_until IS NULL OR g.valid_until > current_date))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 2 · The carry ──────────────────────────────────────────────────
-- End each live carryable `player` assignment of his accounts at p_school
-- that is not at p_team; open it again at p_team unless p_team is NULL (then
-- it stays ended) or an equal live row is already there. Header §3.
CREATE OR REPLACE FUNCTION player_assignment_carry(p_player uuid, p_school uuid, p_team text,
                                                   OUT ended integer, OUT opened integer) AS $$
DECLARE
  r role_assignment%ROWTYPE;
BEGIN
  ended := 0; opened := 0;
  IF p_player IS NULL OR p_school IS NULL THEN
    RETURN;
  END IF;
  FOR r IN SELECT a.* FROM role_assignment a
            WHERE a.role = 'player' AND a.active
              AND a.school_id = p_school
              AND a.fixture_id IS NULL AND a.expires_at IS NULL
              AND a.team_code IS DISTINCT FROM p_team
              AND a.person_id IN (SELECT player_own_accounts(p_player))
            ORDER BY a.created_at, a.id
            FOR UPDATE OF a LOOP
    -- Ended, not re-pointed (db/01's rule); its trigger stamps the who and when.
    UPDATE role_assignment SET active = false WHERE id = r.id;
    ended := ended + 1;
    IF p_team IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM role_assignment b
          WHERE b.person_id = r.person_id AND b.role = 'player' AND b.active
            AND b.school_id = p_school AND b.team_code = p_team
            AND b.fixture_id IS NULL AND b.expires_at IS NULL
            AND b.season IS NOT DISTINCT FROM r.season
            AND b.valid_from IS NOT DISTINCT FROM r.valid_from
            AND b.valid_until IS NOT DISTINCT FROM r.valid_until) THEN
      INSERT INTO role_assignment (person_id, role, school_id, team_code, season, valid_from, valid_until)
      VALUES (r.person_id, 'player', p_school, p_team, r.season, r.valid_from, r.valid_until);
      opened := opened + 1;
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · The trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION player_assignment_follows_side() RETURNS trigger AS $$
BEGIN
  IF NEW.team_code IS NOT DISTINCT FROM OLD.team_code
     AND NEW.school_id IS NOT DISTINCT FROM OLD.school_id THEN
    RETURN NULL;
  END IF;
  PERFORM player_assignment_carry(NEW.id, NEW.school_id, NEW.team_code);
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS player_assignment_follows_side ON player;
CREATE TRIGGER player_assignment_follows_side
  AFTER UPDATE OF team_code, school_id ON player
  FOR EACH ROW EXECUTE FUNCTION player_assignment_follows_side();


-- ── 4 · The disagreements, and the one-time correction ─────────────
-- Every live carryable assignment of a boy's own accounts, at his school,
-- whose side is not his player row's. The candidates are the boys an account
-- names (app_user.player_id, or a self-access subject).
CREATE OR REPLACE FUNCTION player_assignment_disagreements()
RETURNS TABLE (assignment_id uuid, person_id uuid, player_id uuid, school_id uuid,
               assignment_team text, player_team text) AS $$
  SELECT a.id, a.person_id, p.id, p.school_id, a.team_code, p.team_code
    FROM player p
    JOIN role_assignment a
      ON a.role = 'player' AND a.active AND a.school_id = p.school_id
     AND a.fixture_id IS NULL AND a.expires_at IS NULL
     AND a.team_code IS DISTINCT FROM p.team_code
   WHERE p.id IN (SELECT u.player_id FROM app_user u WHERE u.player_id IS NOT NULL
                  UNION
                  SELECT g.player_id FROM role_assignment s JOIN assignment_subject g ON g.assignment_id = s.id
                   WHERE s.role = 'selfaccess' AND s.active)
     AND a.person_id IN (SELECT player_own_accounts(p.id))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Carry each disagreeing boy once. Answers what it did, one row per boy.
CREATE OR REPLACE FUNCTION player_assignment_correct()
RETURNS TABLE (player_id uuid, school_id uuid, player_team text, ended integer, opened integer, was text) AS $$
DECLARE
  b record;
  v_end integer;
  v_open integer;
BEGIN
  FOR b IN SELECT d.player_id AS pid, d.school_id AS sid, d.player_team AS team,
                  string_agg(DISTINCT d.assignment_team, ',' ORDER BY d.assignment_team) AS was_on
             FROM player_assignment_disagreements() d
            GROUP BY d.player_id, d.school_id, d.player_team
            ORDER BY d.school_id, d.player_id LOOP
    SELECT x.ended, x.opened INTO v_end, v_open FROM player_assignment_carry(b.pid, b.sid, b.team) x;
    player_id := b.pid; school_id := b.sid; player_team := b.team;
    ended := v_end; opened := v_open; was := b.was_on;
    RETURN NEXT;
  END LOOP;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Nobody but the owner calls any of them: not PUBLIC, not the application,
-- not a managed host's API roles.
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['player_own_accounts(uuid)', 'player_assignment_carry(uuid,uuid,text)',
                           'player_assignment_follows_side()', 'player_assignment_disagreements()',
                           'player_assignment_correct()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['scrbrd_app', 'anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;

DO $correct$
DECLARE
  n_boys int := 0; n_end int := 0; n_open int := 0;
  v_list text;
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
  LOCK TABLE role_assignment IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*), coalesce(sum(x.ended), 0), coalesce(sum(x.opened), 0),
         string_agg(format('%s at %s: %s -> %s (ended %s, opened %s)',
                           x.player_id, coalesce(s.code, x.school_id::text), x.was,
                           coalesce(x.player_team, 'no side'), x.ended, x.opened), '; ')
    INTO n_boys, n_end, n_open, v_list
    FROM player_assignment_correct() x
    LEFT JOIN school s ON s.id = x.school_id;
  IF n_boys = 0 THEN
    RAISE NOTICE 'db/112: every live player assignment already follows its boy''s side; nothing to correct';
  ELSE
    RAISE NOTICE 'db/112: corrected % boy(s): ended % player assignment(s), opened % at the side the roster says: %',
      n_boys, n_end, n_open, v_list;
  END IF;
  IF EXISTS (SELECT 1 FROM player_assignment_disagreements()) THEN
    RAISE EXCEPTION 'db/112: after the correction a live player assignment still disagrees with its boy''s side';
  END IF;
END $correct$;


-- ── 5 · The boy playing up reads the balls of the match he is picked for ──
-- db/106's branch (4), as a set: the reader is the boy on the sheet, not
-- withdrawn, at his own school's end, asked about himself at his own side.
CREATE OR REPLACE FUNCTION my_own_sheet_fixtures() RETURNS uuid[] AS $$
  SELECT coalesce(array_agg(DISTINCT m.id), '{}'::uuid[])
    FROM player p
    JOIN match_squad s ON s.player_id = p.id AND NOT s.withdrawn
    JOIN match m ON m.id = s.match_id
                AND p.school_id = CASE WHEN s.side = 'home' THEN m.school_id ELSE m.away_school_id END
   WHERE p.id = ANY (my_own_boy())
     AND app_can('fixture.read', p.school_id, p.team_code, p.id, m.id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
DO $sheet_grants$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION my_own_sheet_fixtures() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION my_own_sheet_fixtures() TO scrbrd_app;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION my_own_sheet_fixtures() FROM %I', r);
    END IF;
  END LOOP;
END $sheet_grants$;

-- The policy must be db/100's (its text as Postgres prints it) or already
-- this file's; anything else is a version this was not written against.
DO $guard$
DECLARE
  q text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO q FROM pg_policy p
   WHERE p.polrelid = 'ball_event'::regclass AND p.polname = 'ball_event_read';
  IF q IS DISTINCT FROM
       '(app_can(''fixture.read''::text, school_id, match_team(match_id), NULL::uuid, match_id) OR (EXISTS ( SELECT 1' || chr(10)
    || '   FROM match m' || chr(10)
    || '  WHERE ((m.id = ball_event.match_id) AND (m.away_school_id IS NOT NULL) AND app_can(''fixture.read''::text, m.away_school_id, m.away_team_code, NULL::uuid, ball_event.match_id)))) OR (match_id = ANY (( SELECT my_child_fixtures() AS my_child_fixtures)::uuid[])))'
     AND position('my_own_sheet_fixtures()' IN coalesce(q, '')) = 0 THEN
    RAISE EXCEPTION 'db/112: ball_event_read is not db/100''s any more; add the playing-up branch to the version now in place: %', coalesce(q, 'missing');
  END IF;
END $guard$;

DROP POLICY IF EXISTS ball_event_read ON ball_event;

-- Reading the ball log is reading the fixture: whoever may see the match may
-- see how it is going, at either side's school; a parent sees how his child's
-- side's match is going, asked about his child (db/100); and a boy playing up
-- sees the match he is on the sheet of, asked about himself (this file).
CREATE POLICY ball_event_read ON ball_event
  FOR SELECT USING (
    app_can('fixture.read', ball_event.school_id, match_team(ball_event.match_id), NULL, ball_event.match_id)
    OR EXISTS (SELECT 1 FROM match m
                WHERE m.id = ball_event.match_id
                  AND m.away_school_id IS NOT NULL
                  AND app_can('fixture.read', m.away_school_id, m.away_team_code, NULL, ball_event.match_id))
    OR ball_event.match_id = ANY ((SELECT my_child_fixtures())::uuid[])
    OR ball_event.match_id = ANY ((SELECT my_own_sheet_fixtures())::uuid[])
  );


-- ── 6 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE
  q text;
  f text;
  v_fn text;
  v_block text :=
       '  -- db/108: a pupil is a pupil OF A SIDE (role_assignment_player_team_scoped).' || chr(10)
    || '  -- No side named by the request or the decider: his own side on the roster,' || chr(10)
    || '  -- at this school. None there either: refused by name, before anything is' || chr(10)
    || '  -- written, as a coach with no side is.' || chr(10)
    || '  IF r.role = ''player'' AND v_team IS NULL THEN' || chr(10)
    || '    SELECT p.team_code INTO v_team FROM player p WHERE p.id = v_player AND p.school_id = r.school_id;' || chr(10)
    || '    IF v_team IS NULL THEN' || chr(10)
    || '      RETURN QUERY SELECT false, ''team_required'', NULL::uuid; RETURN;' || chr(10)
    || '    END IF;' || chr(10)
    || '  END IF;' || chr(10);
BEGIN
  -- The trigger, enabled, on the side and the school, after the row is written.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'player'::regclass AND t.tgname = 'player_assignment_follows_side'
                    AND t.tgfoid = to_regprocedure('player_assignment_follows_side()') AND t.tgenabled = 'O'
                    AND pg_get_triggerdef(t.oid) LIKE '%AFTER UPDATE OF team_code, school_id ON public.player FOR EACH ROW%') THEN
    RAISE EXCEPTION 'db/112: the trigger player_assignment_follows_side is missing, disabled or not what this file wrote';
  END IF;
  -- db/08's history trigger is still there beside it, untouched.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('player_team_membership_log()'))
       IS DISTINCT FROM '8e2d778b50699caf2894ce7499ea01e1' THEN
    RAISE EXCEPTION 'db/112: db/08''s player_team_membership_log() moved';
  END IF;
  -- The doors: definers with a pinned path, the owner's alone.
  FOREACH v_fn IN ARRAY ARRAY['player_own_accounts(uuid)', 'player_assignment_carry(uuid,uuid,text)',
                              'player_assignment_follows_side()', 'player_assignment_disagreements()',
                              'player_assignment_correct()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}')))
       OR has_function_privilege('public', to_regprocedure(v_fn), 'EXECUTE')
       OR has_function_privilege('scrbrd_app', to_regprocedure(v_fn), 'EXECUTE') THEN
      RAISE EXCEPTION 'db/112: % is not a pinned definer, or someone but its owner may call it', v_fn;
    END IF;
  END LOOP;
  -- The carry never writes a NULL side, and never re-points a row.
  SELECT prosrc INTO f FROM pg_proc WHERE oid = to_regprocedure('player_assignment_carry(uuid,uuid,text)');
  IF position('IF p_team IS NOT NULL AND NOT EXISTS' IN f) = 0
     OR position('UPDATE role_assignment SET active = false WHERE id = r.id;' IN f) = 0
     OR f ~* 'set\s+team_code' THEN
    RAISE EXCEPTION 'db/112: player_assignment_carry() does not end-and-reopen as this file wrote it';
  END IF;
  -- Nothing on the record disagrees any more.
  IF EXISTS (SELECT 1 FROM player_assignment_disagreements()) THEN
    RAISE EXCEPTION 'db/112: a live player assignment disagrees with its boy''s side';
  END IF;
  -- db/108's CHECK holds, and its door is db/92's body with db/108's one
  -- block (db/108's md5 guard, asked again).
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'role_assignment'::regclass AND c.conname = 'role_assignment_player_team_scoped' AND c.convalidated)
     IS DISTINCT FROM 'CHECK (((role <> ''player''::text) OR (team_code IS NOT NULL) OR (NOT active)))'
     OR EXISTS (SELECT 1 FROM role_assignment WHERE role = 'player' AND team_code IS NULL AND active) THEN
    RAISE EXCEPTION 'db/112: db/108''s CHECK is not what it was, or a live player assignment names no side';
  END IF;
  SELECT prosrc INTO f FROM pg_proc WHERE oid = to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)');
  IF position(v_block IN f) = 0 OR md5(replace(f, v_block, '')) IS DISTINCT FROM 'a9a5a09414e0629d70c873fcbeb99f75' THEN
    RAISE EXCEPTION 'db/112: role_request_grant_as() is not db/92''s body with db/108''s block';
  END IF;
  -- The log's read: db/100's three branches, once each, and the fourth.
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO q FROM pg_policy p
   WHERE p.polrelid = 'ball_event'::regclass AND p.polname = 'ball_event_read' AND p.polcmd = 'r' AND p.polpermissive;
  IF q IS NULL
     OR (length(q) - length(replace(q, 'match_team(', ''))) / length('match_team(') <> 1
     OR position('app_can(''fixture.read''::text, m.away_school_id, m.away_team_code, NULL::uuid, ball_event.match_id)' IN q) = 0
     OR position('my_child_fixtures()' IN q) = 0
     OR position('my_own_sheet_fixtures()' IN q) = 0
     OR position('00000000-0000-0000-0000-000000000000' IN q) > 0 THEN
    RAISE EXCEPTION 'db/112: ball_event_read is not the policy this file wrote: %', coalesce(q, 'missing');
  END IF;
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'ball_event'::regclass AND p.polcmd IN ('r', '*') AND p.polpermissive) <> 1 THEN
    RAISE EXCEPTION 'db/112: ball_event has a second permissive read policy';
  END IF;
  -- The guardian's helper is db/100's, not widened; db/106's my_own_boy() too.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('my_child_fixtures()')) IS DISTINCT FROM '78db5a4d195937ed800efc92e0489516'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('my_own_boy()')) IS DISTINCT FROM '3625d4d2bb4ff10dff38f467f4850d0e' THEN
    RAISE EXCEPTION 'db/112: my_child_fixtures() (db/100) or my_own_boy() (db/106) moved';
  END IF;
  -- The new helper: the sheet, not withdrawn, his own end, about himself.
  SELECT p.prosrc INTO f FROM pg_proc p
   WHERE p.oid = to_regprocedure('my_own_sheet_fixtures()') AND p.prosecdef AND p.provolatile = 's'
     AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'));
  IF f IS NULL
     OR position('JOIN match_squad s ON s.player_id = p.id AND NOT s.withdrawn' IN f) = 0
     OR position('p.school_id = CASE WHEN s.side = ''home'' THEN m.school_id ELSE m.away_school_id END' IN f) = 0
     OR position('p.id = ANY (my_own_boy())' IN f) = 0
     OR position('app_can(''fixture.read'', p.school_id, p.team_code, p.id, m.id)' IN f) = 0
     OR position('00000000-0000-0000-0000-000000000000' IN f) > 0
     OR has_function_privilege('public', to_regprocedure('my_own_sheet_fixtures()'), 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', to_regprocedure('my_own_sheet_fixtures()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'db/112: my_own_sheet_fixtures() is missing, not a pinned stable definer for scrbrd_app, or does not ask what it says';
  END IF;
  -- No other policy on the log or the pad's tables asks it.
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polrelid IN ('ball_event'::regclass, 'scoring_session'::regclass,
                                   'ball_event_quarantine'::regclass, 'scoring_audit'::regclass)
                AND p.polname <> 'ball_event_read'
                AND concat(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) LIKE '%my\_own\_sheet\_fixtures%') THEN
    RAISE EXCEPTION 'db/112: a policy other than ball_event_read asks my_own_sheet_fixtures()';
  END IF;
END $check$;

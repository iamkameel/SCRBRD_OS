-- ══════════════════════════════════════════════════════════════════
--  100 · A parent reads the ball log of his child's side's matches
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's decision, 2026-10-14 (in chat), asked "Should
-- guardians read the ball log of their child's matches?": "Yes, in its own
-- migration" — a guardian reads the balls of fixtures his child's side plays,
-- home and away; per-boy figures (workload, other boys' wheels) stay gated as
-- today. Its proof is db/99 §77; the API walk is tools/smoke-cockpit.mjs's
-- group 6. Builds on db/97, whose two branches are kept here word for word.
--
-- WHY. ball_event_read (db/02, db/97) asks app_can('fixture.read', …) with a
-- NULL person: the log asks about nobody in particular. For a guardian, whose
-- assignment names his children (SUBJECT_SCOPED_ROLES), app_can() refuses a
-- question about nobody, so a parent read no ball of any fixture, home or
-- away (db/99 §22 and §75 recorded it), while the parent's screens (STEP 4;
-- the away-visibility design §5 and §9 item 4) fold the log for his child's
-- line and the board.
--
-- NOT match_read's all-zeros person. match_read (db/09) asks with
-- '00000000-…', which for a subject-scoped role means "any fixture at a school
-- where he names a live child". A guardian's assignment is school-wide (no
-- team: guardian_link_establish() writes one per parent per school), so the
-- zeros here would open every fixture at the school, every side's, which is
-- wider than Kameel decided. The guardian branch names the child instead.
--
-- THE RULE. A third branch: the reader's assignments name a child, the child
-- is on the fixture's side at one end, and app_can('fixture.read', <that
-- end's school>, <that end's team>, <the child>, <the fixture>) answers yes.
-- The question is asked about the child, so app_can()'s own subject clause
-- decides: a link that is verified, started and not ended, on an active,
-- in-date, unsuspended assignment at that end's school. A link that ends or
-- is revoked closes the branch on the next query, as every other read of a
-- child does.
--
-- "ON THE SIDE" is the child's team OR the fixture's team sheet:
--   team   the child's own side at that end: player.school_id and
--          player.team_code are the end's school and team. The fixtures his
--          side plays, whether or not he is picked that week or the sheet is
--          named yet (a parent follows his son's side as the side's pupils
--          do: the pupil's own `player` assignment is his team's).
--   sheet  a match_squad row naming the child at that end, not withdrawn.
--          A boy playing up (a U14 called into the 1st XI) plays a fixture
--          that is not his team's; the team alone would hide from his parent
--          the one match he played that day. The sheet is also what keeps a
--          boy's past fixtures for an old side once he has moved up.
-- Either alone is wrong for one family: the team alone hides the playing-up
-- match; the sheet alone hides the side's matches until a coach names the
-- XI, and every match he is twelfth man for is still his side's. Neither
-- reaches a side the child is not on: another side's fixture at the same
-- school reads nothing (the 2XI's match is not the 1XI boy's parent's), and
-- the child must be the end's school's boy, so a fixture elsewhere reads
-- nothing either.
--
-- THE SHAPE: one definer helper, my_child_fixtures(), and the policy's third
-- branch `match_id = ANY ((SELECT my_child_fixtures())::uuid[])`. The
-- sub-select is an InitPlan: the helper runs once per scan of the log, not
-- once per ball. Measured on the seed (median of 31, EXPLAIN ANALYZE, in
-- one rolled-back transaction: the seed's 96-ball 1XI match and two copies,
-- one shared with Westville and one as the 2XI; ms, execution + planning;
-- run to run the same read moves by a few ms):
--
--                                               db/97          this
--   Hilton's coach, his own match              5.1 + 0.3      7.8 + 0.4
--   Westville's coach, the shared copy        23.8 + 0.3     16.8 + 0.3
--   Westville's coach, a Hilton-only fixture   4.3 + 0.3      4.9 + 0.2   (refused)
--   Hilton's 1XI coach, the 2XI copy           4.1 + 0.3      5.9 + 0.3   (refused)
--   the parent, his son's fixture              4.2 (none)     9.6 (96)
--   the parent, the 2XI copy                   4.5 + 0.3      6.3 + 0.3   (refused)
--   Hilton's coach, the whole log             11.0 + 0.3     13.7 + 0.3
--   Hilton's coach, a career view             45.9 + 3.4     53.8 + 4.4
--   the parent, a career view                 27.0 (none)    75.2 (192 balls read)
--
-- A refused ball costs a probe of an array; the helper itself costs a
-- reader whose links name nobody one index lookup, and a guardian about 5 ms
-- on the seed (app_can() for each fixture of his child's side), once per
-- scan. That last grows with the fixtures his child's side has played.
--
-- The first build wrote the branch as an invoker `match_id IN (SELECT …)`
-- over role_assignment, assignment_subject, player, match and match_squad
-- under the reader's row security. It was right and too dear: each of those
-- five tables' own policies (and theirs) was planned into every reference to
-- ball_event, and the career views reference it several times (ball_event_live
-- asks the log again for voids and innings starts), so planning a coach's
-- career read went from 3 ms to 19 and running it from 48 to 74 (a median of
-- fifteen), for a reader the branch gives nothing. The helper is planned as
-- one call.
--
-- WHY A DEFINER IS SAFE HERE. db/97 declined a definer helper because the one
-- it was offered took a match id and would have answered anyone "which school
-- is this fixture against". This one takes no argument and answers only for
-- the caller (app_user_id()), only about the people his own live links name,
-- and only with fixtures app_can('fixture.read', …, <that child>, …) admits:
-- the same gate, about the same child, that player_read and match_squad_read
-- would have asked of him had it been an invoker (each is app_can() about the
-- child, at his school), and every fixture it returns is one match_read
-- already shows him. Under pad scope app_can() answers only the pad's own
-- fixture, as it does everywhere. It is EXECUTE for scrbrd_app alone, the one
-- role that reads ball_event under row security.
--
-- WHO ELSE IT ADMITS. The candidates are the people the caller's own links
-- name; app_can() then asks fixture.read about that person at that end's
-- school and team. For an assignment naming nobody (every staff, pupil and
-- spectator role) a question about a person reads as a question about nobody,
-- so the branch admits nothing the host and away branches did not: the same
-- anchors. selfaccess and enquiry hold no fixture.read, so a pupil playing up
-- reads what he read before. In practice, a guardian, and a guardian only.
--
-- WHAT IT OPENS. Every read of the log is security_invoker down to
-- ball_event, so the parent's Match Centre (family mode) and fixture cards
-- (GET /api/matches/:id/events, folded on the client), live_score, phases
-- and shot_points answer him for his child's fixtures. The per-boy
-- gates on top of the log keep asking per boy: player_shot_points,
-- matchup_coverage, matchups and the career views join `player`, which he
-- reads for his own child only; bowling_spells joins `player` too, and the
-- directive beside a spell asks player.workload.read, which a guardian does
-- not hold; workload(), load_summary() and bowler_day() ask it per boy. So
-- he reads his child's wheel and career across the fixtures he may read, and
-- no other boy's.
--
-- WHAT IT NEVER OPENS. The pad's tables keep their host-only policies:
-- scoring_session (session_read), ball_event_quarantine (quarantine_read and
-- its siblings) and scoring_audit (audit_read). Every write is unchanged.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   my_child_fixtures(): a new function, SECURITY DEFINER, STABLE, no
--   argument; EXECUTE revoked from PUBLIC and granted to scrbrd_app.
--   ball_event_read on ball_event: dropped and re-created with the guardian
--   branch. The host and away branches are db/97's, unchanged. No table,
--   column or row is added or changed; no other policy is touched. CREATE OR
--   REPLACE, DROP POLICY IF EXISTS then CREATE POLICY, in the paste's one
--   transaction, so a second paste changes nothing.

-- The fixtures a child the caller's own live links name is on, at either
-- end: his side's (his team at that end's school), or the team sheet's (not
-- withdrawn). Asked of app_can() about the child; see the header.
CREATE OR REPLACE FUNCTION my_child_fixtures() RETURNS uuid[] AS $$
  SELECT coalesce(array_agg(DISTINCT x.id), '{}'::uuid[])
    FROM (SELECT m.id
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN match m ON m.school_id = p.school_id
           WHERE a.person_id = app_user_id() AND a.active
             AND g.verification_state = 'verified'
             AND (m.team_code = p.team_code
                  OR EXISTS (SELECT 1 FROM match_squad s
                              WHERE s.match_id = m.id AND s.player_id = p.id
                                AND s.side = 'home' AND NOT s.withdrawn))
             AND app_can('fixture.read', m.school_id, m.team_code, p.id, m.id)
          UNION ALL
          SELECT m.id
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN match m ON m.away_school_id = p.school_id
           WHERE a.person_id = app_user_id() AND a.active
             AND g.verification_state = 'verified'
             AND (m.away_team_code = p.team_code
                  OR EXISTS (SELECT 1 FROM match_squad s
                              WHERE s.match_id = m.id AND s.player_id = p.id
                                AND s.side = 'away' AND NOT s.withdrawn))
             AND app_can('fixture.read', m.away_school_id, m.away_team_code, p.id, m.id)) x
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION my_child_fixtures() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_child_fixtures() TO scrbrd_app;

DROP POLICY IF EXISTS ball_event_read ON ball_event;

-- Reading the ball log is reading the fixture: whoever may see the match may
-- see how it is going, at either side's school; and a parent sees how his
-- child's side's match is going, asked about his child.
CREATE POLICY ball_event_read ON ball_event
  FOR SELECT USING (
    app_can('fixture.read', ball_event.school_id, match_team(ball_event.match_id), NULL, ball_event.match_id)
    OR EXISTS (SELECT 1 FROM match m
                WHERE m.id = ball_event.match_id
                  AND m.away_school_id IS NOT NULL
                  AND app_can('fixture.read', m.away_school_id, m.away_team_code, NULL, ball_event.match_id))
    OR ball_event.match_id = ANY ((SELECT my_child_fixtures())::uuid[])
  );


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  q text;
  w text;
  f text;
  n int;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid), p.polcmd::text || p.polpermissive::text
    INTO q, w
    FROM pg_policy p WHERE p.polrelid = 'ball_event'::regclass AND p.polname = 'ball_event_read';
  IF q IS NULL THEN
    RAISE EXCEPTION 'db/100: ball_event_read is missing';
  END IF;
  -- A permissive SELECT policy, as db/02's and db/97's were.
  IF w IS DISTINCT FROM 'rtrue' THEN
    RAISE EXCEPTION 'db/100: ball_event_read is not a permissive SELECT policy (%)', w;
  END IF;
  -- db/97's host branch, once, and its away branch, and the guardian branch.
  n := (length(q) - length(replace(q, 'match_team(', ''))) / length('match_team(');
  IF n <> 1 OR position('away_school_id IS NOT NULL' IN q) = 0
     OR position('app_can(''fixture.read''::text, m.away_school_id, m.away_team_code, NULL::uuid, ball_event.match_id)' IN q) = 0 THEN
    RAISE EXCEPTION 'db/100: ball_event_read''s host and away branches are not db/97''s (match_team( % time(s)): %', n, q;
  END IF;
  IF position('my_child_fixtures()' IN q) = 0 OR position('00000000-0000-0000-0000-000000000000' IN q) > 0 THEN
    RAISE EXCEPTION 'db/100: ball_event_read has no guardian branch, or asks with the all-zeros person: %', q;
  END IF;
  -- The helper asks about the child (p.id) at both ends, from the team and
  -- from the sheet, never with the all-zeros person that would open the
  -- whole school; a definer, stable, for scrbrd_app and not for PUBLIC.
  SELECT p.prosrc INTO f FROM pg_proc p WHERE p.oid = to_regprocedure('my_child_fixtures()')
     AND p.prosecdef AND p.provolatile = 's';
  IF f IS NULL
     OR position('app_can(''fixture.read'', m.school_id, m.team_code, p.id, m.id)' IN f) = 0
     OR position('app_can(''fixture.read'', m.away_school_id, m.away_team_code, p.id, m.id)' IN f) = 0
     OR position('match_squad' IN f) = 0 OR position('NOT s.withdrawn' IN f) = 0
     OR position('a.person_id = app_user_id()' IN f) = 0
     OR position('00000000-0000-0000-0000-000000000000' IN f) > 0 THEN
    RAISE EXCEPTION 'db/100: my_child_fixtures() is missing, not a stable definer, or does not ask about the child';
  END IF;
  IF has_function_privilege('public', to_regprocedure('my_child_fixtures()'), 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', to_regprocedure('my_child_fixtures()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'db/100: my_child_fixtures() is executable by PUBLIC, or not by scrbrd_app';
  END IF;
  -- The writes and the pad's tables are the host's, untouched: no other
  -- policy on the log or the pad's tables names the away side or the helper.
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid IN ('ball_event'::regclass, 'scoring_session'::regclass,
                            'ball_event_quarantine'::regclass, 'scoring_audit'::regclass)
         AND p.polname <> 'ball_event_read'
         AND (concat(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) LIKE '%away\_%'
              OR concat(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) LIKE '%my\_child\_fixtures%')) > 0 THEN
    RAISE EXCEPTION 'db/100: a policy other than ball_event_read on the log or the pad''s tables names the away side or the helper';
  END IF;
  -- And ball_event still has exactly one permissive read policy: a second
  -- would widen this one without this file saying so.
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'ball_event'::regclass AND p.polcmd IN ('r', '*') AND p.polpermissive) <> 1 THEN
    RAISE EXCEPTION 'db/100: ball_event has a second permissive read policy';
  END IF;
END $check$;

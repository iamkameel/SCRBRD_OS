-- ══════════════════════════════════════════════════════════════════
--  101 · News to the side: who reads a team post, and the team sheet
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Two decisions of Kameel's (2026-10-14, in chat), after
-- db/96's proof (db/99 §76 (others)) found what db/12's read policy let
-- through. Its proof is db/99 §78.
--
--   1. "Ordinary team posts (not plans) reach every parent at the school and
--      every follower today, which contradicts db/12's own comment. Should
--      ordinary team posts get the same narrowing?" — "Yes, in its own
--      migration." A post to a side (scope 'team', any kind) and its notice
--      reach the side and nobody wider, as db/96 does for a plan: news.read
--      and team.read at the side, a guardian through a child on it, its
--      author always. A school post and a league post are unchanged.
--
--   2. "A boy playing up: does he read his match's plan?" — "Yes: the team
--      sheet counts too." A boy named on a fixture's team sheet (match_squad,
--      at the plan's end, not withdrawn) and his guardians read that
--      fixture's plan and its notice, even when his own side is another one.
--      Nothing else of the side he plays up for: not its other plans, not its
--      ordinary posts.
--
-- WHY db/12 REACHED WIDER (db/96 §4 says it at length). A guardian's
-- assignment is school-wide and names his children; app_can() asked about
-- nobody in particular answers yes for him at every team, so the parent of a
-- U15B boy read U15A's posts. news.read is also held school-wide by roles
-- that read no side (team.read): spectator (a follower), finance,
-- sponsorship, driver, facilities. db/12's comment ("the parent of a boy in
-- that side, and not the parent of a boy in another one") did not hold.
--
-- WHAT THIS FILE ADDS
--   news_sheet_reach(fixture, school, team)  the reader is a boy, or the
--       guardian of a boy, named on that fixture's sheet at the end where
--       (school, team) plays, not withdrawn, of that school; and holds
--       news.read and team.read about that boy at the boy's own side
--   news_team_notice_reach(post)  a notice about a post: true unless the
--       post is a team post this reader does not reach
--   news_notice_sheet(post, school, team)  a notice about a plan at that
--       side, and the reader reaches the plan through the sheet
--   news_post_team_side       RESTRICTIVE, SELECT on news_post (decision 1)
--   notification_team_side    RESTRICTIVE, SELECT on notification (decision 1)
--   news_post_read_sheet      PERMISSIVE, SELECT on news_post: a published
--                             plan, to the sheet (decision 2)
--   notification_read_sheet   PERMISSIVE, SELECT on notification: the plan's
--                             notice and its "withdrawn" notice, to the
--                             sheet (decision 2)
-- AND CHANGES, with nothing removed
--   news_post_plan_side (db/96)  ALTER POLICY: its USING gains the sheet.
--       A RESTRICTIVE policy is ANDed with every other, so without this the
--       new permissive read would be refused by db/96's own narrowing. ALTER,
--       not DROP and CREATE: the tool that pastes this hangs on a statement
--       that removes an object, and an ALTER run twice changes nothing.
--   news_notice_reach(post) (db/96)  CREATE OR REPLACE: a plan's notice
--       also reaches the sheet. Its signature, volatility, owner rights and
--       grants are db/96's. notification_plan_side (db/96) calls it and is
--       not touched.
--   notification_report(notice) (db/91)  CREATE OR REPLACE: "any reader of
--       a person's notice" may report it (CSA SG-9 rule 4), and its reader
--       test was db/09's read policy re-asked as the owner, so it still let a
--       parent of another side report a side's notice he no longer reads, and
--       would refuse the boy playing up the plan's notice he does read. Its
--       reader test is now the read policies' own (§3); every other line,
--       its signature and its grants are db/91's.
--   news_plan_reach(school, team) (db/96) is reused as it stands: it is
--       "the side", for a post as for a plan.
--
-- WHY A PERMISSIVE POLICY FOR THE SHEET. Decision 2 WIDENS who reads a plan:
-- the boy playing up holds his assignment at his own side, so db/12's
-- news_post_read (news.read at the plan's side) refuses him, and a
-- RESTRICTIVE policy can only take away. The new permissive reads are drawn
-- as narrowly as the decision: kind 'plan' only, published only, the one
-- fixture, the one end, a boy linked to the reader by name (his own account,
-- or a live verified link from the reader's guardian, selfaccess or player
-- assignment), never a boy's coach or anybody else who reaches the boy
-- without naming him. db/99 §78 proves it reaches nobody else.
--
-- THE TWELFTH MAN IS ON THE SHEET; A WITHDRAWN BOY IS NOT. match_squad.twelfth
-- is a named boy, so he reads the plan; withdrawn = true is how a coach takes
-- a boy off (the API's update), and his read goes with it, as it does when
-- the row is deleted.
--
-- EXISTING ROWS. No row is inserted, changed or deleted. Every school post,
-- league post and notice not about a team post reads exactly as before. A
-- team post, and its notice, stop reading to a guardian of a boy on another
-- side and to the school-wide roles that read no side, on the paste.
--
-- NOTHING IS REMOVED. Functions CREATE OR REPLACE; db/96's policy ALTERed in
-- place; each new policy created inside a DO block only when pg_policies does
-- not have it. Safe to run twice. Nothing here grants a write: the grants are
-- EXECUTE on the functions, and every policy is FOR SELECT. (The one write
-- the file touches is db/91's report, which writes what it wrote before, to
-- fewer people's taps.)
--
-- WHO MAY CALL WHAT
--   news_sheet_reach(uuid, uuid, text)        scrbrd_app (the policies, as the caller)
--   news_team_notice_reach(uuid)              scrbrd_app (likewise)
--   news_notice_sheet(uuid, uuid, text)       scrbrd_app (likewise)
--   news_notice_reach(uuid)                   as db/96 left it
--   notification_report(uuid)                 as db/91 left it (scrbrd_app)
-- And none to PUBLIC, nor to a managed host's anon/authenticated roles.

-- ── 0 · What it needs ──────────────────────────────────────────────
DO $needs$
BEGIN
  IF to_regprocedure('news_plan_reach(uuid,text)') IS NULL
     OR to_regprocedure('news_notice_reach(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'news_post'
                       AND policyname = 'news_post_plan_side') THEN
    RAISE EXCEPTION 'db/101: the plan to the side (db/96) is missing; apply db/96 first';
  END IF;
END $needs$;

-- ── 1 · The sheet (decision 2) ─────────────────────────────────────
-- Read as the owner: the sheet, the roster and the links are rows the
-- reader's own policies may not show him, and a policy that asks must not
-- depend on what the caller can see of them. It answers yes or no.
CREATE OR REPLACE FUNCTION news_sheet_reach(p_fixture uuid, p_school uuid, p_team text) RETURNS boolean AS $$
  SELECT p_fixture IS NOT NULL AND app_user_id() IS NOT NULL AND EXISTS (
    SELECT 1
      FROM match m
      JOIN match_squad s ON s.match_id = m.id AND NOT s.withdrawn
      JOIN player p      ON p.id = s.player_id AND p.school_id = p_school
     WHERE m.id = p_fixture
       -- the plan's end of the fixture, and that end's sheet
       AND ((s.side = 'home' AND m.school_id = p_school AND m.team_code = p_team)
         OR (s.side = 'away' AND m.away_school_id = p_school AND m.away_team_code = p_team))
       -- the boy is the reader, or the reader's child, by name
       AND (EXISTS (SELECT 1 FROM app_user u WHERE u.id = app_user_id() AND u.player_id = p.id)
            OR EXISTS (SELECT 1
                         FROM role_assignment a
                         JOIN assignment_subject g ON g.assignment_id = a.id
                        WHERE a.person_id = app_user_id()
                          AND a.role IN ('guardian', 'selfaccess', 'player')
                          AND a.active
                          AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
                          AND (a.valid_until IS NULL OR a.valid_until >  current_date)
                          AND (a.expires_at  IS NULL OR a.expires_at  >  now())
                          AND NOT EXISTS (SELECT 1 FROM duty_suspension d
                                           WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
                          AND g.player_id = p.id
                          AND g.verification_state = 'verified'
                          AND g.valid_from <= current_date
                          AND (g.valid_until IS NULL OR g.valid_until > current_date)))
       -- and the reader reads news, and the side, about that boy at his own side
       AND app_can('news.read', p.school_id, p.team_code, p.id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND app_can('team.read', p.school_id, p.team_code, p.id, '00000000-0000-0000-0000-000000000000'::uuid))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_sheet_reach(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_sheet_reach(uuid, uuid, text) TO scrbrd_app;

-- A notice about a post (its notice, and the "withdrawn" notice about it):
-- true unless the post is a team post this reader does not reach. Its author
-- always does; a plan also reaches its sheet. Read as the owner, as db/96's
-- news_notice_reach() is.
CREATE OR REPLACE FUNCTION news_team_notice_reach(p_post uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT CASE WHEN n.scope <> 'team' THEN true
                               WHEN n.author_id = app_user_id() THEN true
                               WHEN news_plan_reach(n.school_id, n.team_code) THEN true
                               WHEN n.kind = 'plan' THEN news_sheet_reach(n.fixture_id, n.school_id, n.team_code)
                               ELSE false END
                     FROM news_post n WHERE n.id = p_post), true)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_team_notice_reach(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_team_notice_reach(uuid) TO scrbrd_app;

-- db/96's, with the sheet: a notice about a post is true unless the post is
-- a plan this reader reaches neither as its side nor through its sheet.
CREATE OR REPLACE FUNCTION news_notice_reach(p_post uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT CASE WHEN n.kind <> 'plan' THEN true
                               WHEN n.author_id = app_user_id() THEN true
                               WHEN news_plan_reach(n.school_id, n.team_code) THEN true
                               ELSE news_sheet_reach(n.fixture_id, n.school_id, n.team_code) END
                     FROM news_post n WHERE n.id = p_post), true)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_notice_reach(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_notice_reach(uuid) TO scrbrd_app;

-- The permissive half for a notice: the row is about a plan of THIS side
-- (the notice's own school and team, which db/91 and db/89 copy from the
-- post) and the reader reaches the plan through its sheet. Published or
-- withdrawn: the "withdrawn" notice tells the boy who was told.
CREATE OR REPLACE FUNCTION news_notice_sheet(p_post uuid, p_school uuid, p_team text) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM news_post n
                  WHERE n.id = p_post AND n.kind = 'plan' AND n.scope = 'team'
                    AND n.school_id = p_school AND n.team_code = p_team
                    AND news_sheet_reach(n.fixture_id, n.school_id, n.team_code))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_notice_sheet(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_notice_sheet(uuid, uuid, text) TO scrbrd_app;

-- ── 2 · The policies ───────────────────────────────────────────────
-- db/96's narrowing of a plan, with the sheet beside the side. The only
-- object of db/96's this file touches; db/96's file is not edited.
ALTER POLICY news_post_plan_side ON news_post
  USING (kind <> 'plan' OR author_id = app_user_id() OR news_plan_reach(school_id, team_code)
         OR news_sheet_reach(fixture_id, school_id, team_code));

DO $side_policies$
BEGIN
  -- Decision 1: a team post, of any kind, to the side and nobody wider.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'news_post'
                    AND policyname = 'news_post_team_side') THEN
    CREATE POLICY news_post_team_side ON news_post AS RESTRICTIVE
      FOR SELECT USING (scope <> 'team' OR author_id = app_user_id() OR news_plan_reach(school_id, team_code)
                        OR (kind = 'plan' AND news_sheet_reach(fixture_id, school_id, team_code)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_team_side') THEN
    CREATE POLICY notification_team_side ON notification AS RESTRICTIVE
      FOR SELECT USING (kind <> 'notice' OR subject_kind IS DISTINCT FROM 'news' OR subject_id IS NULL
                        OR news_team_notice_reach(subject_id));
  END IF;
  -- Decision 2: a published plan, and its notices, to the boys on its sheet
  -- and their guardians.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'news_post'
                    AND policyname = 'news_post_read_sheet') THEN
    CREATE POLICY news_post_read_sheet ON news_post
      FOR SELECT USING (kind = 'plan' AND scope = 'team'
                        AND published_at IS NOT NULL AND published_at <= now()
                        AND news_sheet_reach(fixture_id, school_id, team_code));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_read_sheet') THEN
    CREATE POLICY notification_read_sheet ON notification
      FOR SELECT USING (kind = 'notice' AND subject_kind = 'news' AND subject_id IS NOT NULL
                        AND required_capability = 'news.read' AND subject_person_id IS NULL
                        AND news_notice_sheet(subject_id, school_id, team_code));
  END IF;
END $side_policies$;

-- ── 3 · Reporting a notice: its readers, as the policies now draw them ──
-- db/91's notification_report() is "any reader of a person's notice" (CSA
-- SG-9 rule 4), and decides who that is as the owner, by asking app_can()
-- what db/09's read policy asks. That was the whole read until db/96: since
-- db/96 a parent of another side could still report a plan's notice he no
-- longer reads, given its id, and since this file the boy playing up, who
-- reads the plan's notice and is shown its Report button, would be refused
-- as a notice that is not there. So the reader test is the policies' own:
-- (notification_read OR notification_read_sheet) AND notification_plan_side
-- AND notification_team_side, beside db/57's recipient cut as db/91 had it.
-- Every other line is db/91's, verbatim; its grants are kept.
CREATE OR REPLACE FUNCTION notification_report(p_id uuid) RETURNS TABLE (ok boolean, reason text, unheld boolean) AS $$
DECLARE
  v_me  uuid := app_user_id();
  n     notification%ROWTYPE;
  ZERO  uuid := '00000000-0000-0000-0000-000000000000';
  v_aud text;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::boolean; RETURN;
  END IF;
  SELECT * INTO n FROM notification WHERE id = p_id;
  -- Only what this person may read now, as the read policies (db/09, db/96,
  -- db/101) and db/57's recipient cut decide it, neither expired nor
  -- retracted: anything else answers as a notice that is not there, the
  -- same for all of them.
  IF NOT FOUND
     OR n.retracted_at IS NOT NULL
     OR (n.expires_at IS NOT NULL AND n.expires_at <= now())
     OR (n.recipient_id IS NOT NULL AND n.recipient_id <> v_me)
     OR NOT coalesce(
          ((app_can('news.read', n.school_id, coalesce(n.team_code, '*'), coalesce(n.subject_person_id, ZERO), ZERO)
            AND app_can(n.required_capability, n.school_id, coalesce(n.team_code, '*'), coalesce(n.subject_person_id, ZERO), ZERO))
           OR (n.kind = 'notice' AND n.subject_kind = 'news' AND n.subject_id IS NOT NULL
               AND n.required_capability = 'news.read' AND n.subject_person_id IS NULL
               AND news_notice_sheet(n.subject_id, n.school_id, n.team_code)))
          AND (n.kind <> 'notice' OR n.subject_kind IS DISTINCT FROM 'news' OR n.subject_id IS NULL
               OR (news_notice_reach(n.subject_id) AND news_team_notice_reach(n.subject_id))), false) THEN
    RETURN QUERY SELECT false, 'no_such_notice'::text, NULL::boolean; RETURN;
  END IF;
  -- A person's words, and not the system's own "A notice was withdrawn".
  IF n.kind <> 'notice' OR n.retracts_id IS NOT NULL THEN
    RETURN QUERY SELECT false, 'not_reportable'::text, NULL::boolean; RETURN;
  END IF;

  -- Once per person per notice, and two taps at once are one.
  PERFORM pg_advisory_xact_lock(hashtextextended('notification_report:' || v_me::text || ':' || n.id::text, 0));
  IF EXISTS (SELECT 1 FROM access_log l
              WHERE l.person_id = v_me AND l.resource = 'safeguarding.notice_report'
                AND l.record_ids @> ARRAY[n.id]) THEN
    RETURN QUERY SELECT false, 'already_reported'::text, NULL::boolean; RETURN;
  END IF;

  v_aud := CASE n.scope_level WHEN 'team' THEN 'the ' || n.team_code
                              WHEN 'school' THEN 'the whole school'
                              ELSE 'the league' END;
  INSERT INTO notification (school_id, scope_level, kind, urgency, title, body, required_capability,
                            subject_kind, subject_id)
  VALUES (n.school_id, 'school', 'safeguarding', 'high', 'A notice was reported at your school',
          format('Someone reported the notice posted to %s on %s. It is in Notices: read it, and take it up with whoever posted it. Its author or the school''s office can withdraw it.',
                 v_aud, to_char(n.published_at AT TIME ZONE 'Africa/Johannesburg', 'FMDD FMMonth')),
          'safeguarding.concern.read',
          CASE WHEN n.subject_kind = 'news' THEN 'news' END,
          CASE WHEN n.subject_kind = 'news' THEN n.subject_id END);

  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count, fields, device_id)
  VALUES (n.school_id, v_me, 'safeguarding.notice_report', ARRAY[n.id], 1, '{}'::text[], app_device_id());

  RETURN QUERY SELECT true, NULL::text, NOT EXISTS (SELECT 1 FROM dso_people_at(n.school_id));
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_report(uuid) TO scrbrd_app;

-- A managed host's API roles reach none of it.
DO $managed$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION news_sheet_reach(uuid, uuid, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION news_team_notice_reach(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION news_notice_sheet(uuid, uuid, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION news_notice_reach(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION notification_report(uuid) FROM %I', r);
    END IF;
  END LOOP;
END $managed$;

-- ── 4 · Refuse to commit a file that did not do what it says ───────
DO $check$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND cmd = 'SELECT'
        AND ((permissive = 'RESTRICTIVE' AND (tablename, policyname) IN
               (('news_post', 'news_post_team_side'), ('notification', 'notification_team_side'),
                ('news_post', 'news_post_plan_side'), ('notification', 'notification_plan_side')))
          OR (permissive = 'PERMISSIVE' AND (tablename, policyname) IN
               (('news_post', 'news_post_read_sheet'), ('notification', 'notification_read_sheet'))))) <> 6 THEN
    RAISE EXCEPTION 'db/101: the side''s six read policies are not all in place';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'news_post'
                    AND policyname = 'news_post_plan_side' AND qual LIKE '%news_sheet_reach(%') THEN
    RAISE EXCEPTION 'db/101: news_post_plan_side does not read the sheet';
  END IF;
END $check$;

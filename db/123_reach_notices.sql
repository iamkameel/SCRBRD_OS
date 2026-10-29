-- ══════════════════════════════════════════════════════════════════
--  123 · Notices follow the side (REACH group R-E: O-N)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN: two read questions, one RESTRICTIVE and one PERMISSIVE read
-- policy on `notification` built on them, and the report door's reader test
-- given both. The design is
-- docs/design/REACH_parent_pupil.md §3.2 (class B: "a notice with a team and
-- no child — 'training moved', 'team sheet published' — follows the side"),
-- §4 O-N, §5 item 10 and §6.5, decided by Kameel on 14 October 2026, with
-- his two decisions of 29 October below. Its proof is db/99 §100.
--
-- THE GAP (O-N). db/09's notification_read asks app_can() at the notice's
-- school and team about COALESCE(subject_person_id, zeros). A guardian's
-- assignment is school-wide and names his children; asked about nobody in
-- particular (zeros) it answers yes at every team, so the parent of a U13B
-- boy read U15A's "result reopened", "knockout side changed", "training
-- moved", the seed's 1st XI "Availability update". db/101 closed this for a
-- notice about a news post (notification_team_side); every other notice with
-- a team and no child stayed school-wide for families.
--
-- §5 ITEM 10, RUN 29 Oct 2026 (the gate). The notification rows in use,
-- (kind, subject_kind, required_capability, team set, child set, recipient):
--   on a database at db/121 with the pilot seed (db/98):
--     notice/news/news.read             team, no child  1  "Nets moved to Thursday": db/101 (exempt here)
--     notice/news/news.read             school-wide     1  unchanged
--     notice/training/news.read         team, no child  1  "U16B training moved": FOLLOWS THE SIDE
--     injury/injury/medical.status.read team, no child  1  "Availability update", 1XI: FOLLOWS THE SIDE
--     injury/injury/medical.nature.read team, child     3  follows the child (unchanged)
--     system/system/news.read           school-wide     1  unchanged
--   (no row named a recipient)
--   and the writers in the schema (every INSERT INTO notification):
--     fixture/match/fixture.read, team, no child, no recipient:
--       db/72 progression_check() ("A knockout fixture's side has changed"),
--       db/114 result_official_notices(), to both ends  FOLLOW THE SIDE
--     db/89 notification_retract() copies the row it withdraws (kind, team,
--       subject, child, recipient), so "A notice was withdrawn" follows
--       whatever its notice followed
--     notice/news/news.read: db/91 news_post_notice()   exempt (db/96, db/101)
--     a child named: db/65 availability, db/70/76 lifts, db/113 milestones
--       and welfare breaches                            unchanged (the child)
--     a recipient named: db/57, db/77, db/90, db/92, db/109, db/114's
--       administrators, db/65, db/70/76                 unchanged (him only)
--     team NULL: db/57, db/93, db/111, db/116 safeguarding; db/114's
--       competition notice; db/77/90/92 system           unchanged (school)
--   No row or writer of any other shape was found. The rule below is written
--   on the row's shape, not on its kind, so a writer added later is narrowed
--   the same way the day it lands.
--
-- KAMEEL'S TWO DECISIONS OF 29 OCT 2026 (Build Board, 16:56 SAST), on the
-- two points this file first left open:
--   1. A boy playing up: "Yes: he and his parents get that match's notices
--      too." A fixture notice for a match whose team sheet names him reaches
--      him and his family, as his plan rule of 14 Oct does (db/101 decision 2).
--   2. Which day's side: "Keep the ones from when he was in that side." A
--      side notice is read by whoever was in that side on the notice's day:
--      db/117's dated side, side_reach_on() on the day it was published, not
--      today's.
--   What that gives, for a boy who moved off a side: he and his parents keep
--   that side's notices published while he was on it, and lose the ones
--   published after. His PARENTS do not gain the new side's notices from
--   before he joined (their reach is through him, on the notice's day). The
--   BOY HIMSELF does read the new side's earlier notices, through the
--   `player` assignment that names nobody and follows him to the side
--   (db/112), as db/117 left his new side's earlier fixtures and posts: that
--   is the design (db/117 header §4: "for a boy who has not moved, (5) is a
--   subset of (1)"), not changed here. A match notice also follows its
--   fixture's end (fixture_end_reach(): the side on the fixture's day, and
--   its sheet), so "result reopened" for a match he played in stays his.
--
-- WHAT THIS FILE ADDS
--   notice_follows_side(...)   the cut, as one question: true for a notice
--       with no team, a child, a recipient, of kind 'safeguarding', or about
--       a news post (each exempt, unchanged: the school's; follows the child,
--       db/09's argument; him only, db/57; db/57's own rules; follows the
--       post, db/96/db/101); otherwise true when
--         side_reach_on(required_capability, school, team, zeros, the
--             notice's day)   (decision 2: the side's staff, its players,
--             school-wide staff and an admitted spectator by an assignment
--             naming nobody; a guardian through a child on that side that
--             day; the boy himself, on it that day)
--         OR, for a notice about a match, fixture_end_reach(required_capability,
--             match, school, team)   (decision 1: that end on the fixture's
--             day, and the boy on its sheet and his family)
--   notice_side_read(...)   the read db/09's policy cannot give the boy
--       himself: db/09 asks news.read at the notice's side, which a pupil
--       holds only at his own (db/108, db/112). True for a team notice with
--       no child and no recipient, not safeguarding, when
--         (a) the reader is the boy, the notice's side was his on its day by
--             a membership he has since left (db/117's news_own_old_side(),
--             which also asks news.read and team.read about himself at his
--             own side now), and he holds its capability that day
--             (side_reach_on(), branch (5)); or
--         (b) it is about a match, not a post's notice, and fixture_end_reach()
--             admits him for news.read and for its capability (his sheet,
--             branch (4))
--   notification_follows_side   RESTRICTIVE, SELECT on notification:
--       notice_follows_side() of the row. ANDed with every read; nobody gains
--       a row by it.
--   notification_read_side      PERMISSIVE, SELECT on notification:
--       notice_side_read() of the row. It reaches only the boy himself, and
--       every restrictive policy still applies to it.
--   db/09's policy is frozen and not touched.
-- AND CHANGES, with nothing removed
--   notification_report(notice) (db/101)  re-emitted in place with two
--       clauses, so its reader test stays "the policies' own" (db/101): the
--       new permissive read beside db/09's and db/101's, and the new cut
--       beside db/101's. Without them a parent of another side, given a side
--       notice's id, is told "not_reportable" (the notice exists) where he
--       should be told "no_such_notice"; and the boy who moved, who reads
--       his old side's post notice, could not report it. Guarded: the body
--       must be db/101's (its folded md5), each anchor must appear exactly
--       once, and after the swap the body is the old one with exactly those
--       clauses and the same rights, settings and grants.
--
-- A SECOND PASTE changes nothing (the functions are replaced with
-- themselves; the policies are created only if absent and checked as
-- written; the re-emit returns once its clauses are in place).


-- ── 0 · What this file stands on ──────────────────────────────────
DO $guard$
BEGIN
  IF to_regprocedure('side_reach(text,uuid,text,uuid)') IS NULL
     OR to_regprocedure('side_reach_on(text,uuid,text,uuid,date)') IS NULL THEN
    RAISE EXCEPTION 'db/123: side_reach() is not db/117''s dated one; apply db/106 and db/117 first';
  END IF;
  IF to_regprocedure('notification_report(uuid)') IS NULL
     OR to_regprocedure('news_team_notice_reach(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/123: db/101''s notification_report() or news_team_notice_reach() is missing; apply db/101 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_recipient_only' AND permissive = 'RESTRICTIVE')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_team_side' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/123: db/57''s recipient cut or db/101''s notification_team_side is missing';
  END IF;
  -- A policy of this name that is not this file's: refuse, do not paper over.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                AND policyname = 'notification_follows_side'
                AND (permissive <> 'RESTRICTIVE' OR cmd <> 'SELECT'
                     OR qual NOT LIKE '%notice_follows_side(%')) THEN
    RAISE EXCEPTION 'db/123: a notification_follows_side policy is on the table and is not this file''s';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                AND policyname = 'notification_read_side'
                AND (permissive <> 'PERMISSIVE' OR cmd <> 'SELECT' OR qual NOT LIKE '%notice_side_read(%')) THEN
    RAISE EXCEPTION 'db/123: a notification_read_side policy is on the table and is not this file''s';
  END IF;
  IF to_regprocedure('fixture_end_reach(text,uuid,uuid,text)') IS NULL
     OR to_regprocedure('news_own_old_side(uuid,text,date)') IS NULL
     OR to_regprocedure('sa_date(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'db/123: fixture_end_reach() (db/106) or news_own_old_side(), sa_date() (db/117) is missing';
  END IF;
END $guard$;


-- ── 1 · The two questions ─────────────────────────────────────────
-- Arguments are the row's columns, so the policies and the report door ask
-- the one question. Definers with a pinned path, as db/101's are: they read
-- membership and sheets the reader's own policy may not show him.
CREATE OR REPLACE FUNCTION notice_follows_side(p_cap text, p_school uuid, p_team text, p_kind text,
                                               p_subject_kind text, p_subject uuid, p_child uuid,
                                               p_recipient uuid, p_at timestamptz)
RETURNS boolean AS $$
  SELECT p_team IS NULL OR p_child IS NOT NULL OR p_recipient IS NOT NULL
      OR p_kind = 'safeguarding'
      OR (p_kind = 'notice' AND p_subject_kind = 'news' AND p_subject IS NOT NULL)
      -- decision 2: the side on the notice's day
      OR side_reach_on(p_cap, p_school, p_team, '00000000-0000-0000-0000-000000000000'::uuid, sa_date(p_at))
      -- decision 1: a match's notice, to that end of the match and its sheet
      OR (p_subject_kind = 'match' AND p_subject IS NOT NULL
          AND fixture_end_reach(p_cap, p_subject, p_school, p_team))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION notice_side_read(p_cap text, p_school uuid, p_team text, p_kind text,
                                            p_subject_kind text, p_subject uuid, p_child uuid,
                                            p_recipient uuid, p_at timestamptz)
RETURNS boolean AS $$
  SELECT p_team IS NOT NULL AND p_child IS NULL AND p_recipient IS NULL AND p_kind <> 'safeguarding'
     AND (-- (a) decision 2: the boy, his side on the notice's day, since left
          (news_own_old_side(p_school, p_team, sa_date(p_at))
           AND side_reach_on(p_cap, p_school, p_team, '00000000-0000-0000-0000-000000000000'::uuid, sa_date(p_at)))
          -- (b) decision 1: the boy on that match's sheet
       OR (p_subject_kind = 'match' AND p_subject IS NOT NULL AND p_kind <> 'notice'
           AND fixture_end_reach('news.read', p_subject, p_school, p_team)
           AND fixture_end_reach(p_cap, p_subject, p_school, p_team)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION notice_follows_side(text, uuid, text, text, text, uuid, uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION notice_side_read(text, uuid, text, text, text, uuid, uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notice_follows_side(text, uuid, text, text, text, uuid, uuid, uuid, timestamptz) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION notice_side_read(text, uuid, text, text, text, uuid, uuid, uuid, timestamptz) TO scrbrd_app;
GRANT SELECT ON notification TO scrbrd_app;

-- A managed host's API roles reach none of it.
DO $managed$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION notice_follows_side(text, uuid, text, text, text, uuid, uuid, uuid, timestamptz) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION notice_side_read(text, uuid, text, text, text, uuid, uuid, uuid, timestamptz) FROM %I', r);
    END IF;
  END LOOP;
END $managed$;

DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_follows_side') THEN
    CREATE POLICY notification_follows_side ON notification AS RESTRICTIVE
      FOR SELECT USING (notice_follows_side(required_capability, school_id, team_code, kind, subject_kind,
                                            subject_id, subject_person_id, recipient_id, published_at));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_read_side') THEN
    CREATE POLICY notification_read_side ON notification
      FOR SELECT USING (notice_side_read(required_capability, school_id, team_code, kind, subject_kind,
                                         subject_id, subject_person_id, recipient_id, published_at));
  END IF;
END $policy$;


-- ── 2 · Reporting a notice: its readers, as the policies now draw them ──
DO $reemit$
DECLARE
  v_fn  text := 'notification_report(uuid)';
  v_a1  text := '               AND news_notice_sheet(n.subject_id, n.school_id, n.team_code)))';
  v_n1  text :=
       '               AND news_notice_sheet(n.subject_id, n.school_id, n.team_code))' || chr(10)
    || '           -- db/123: the side''s notice, read by the boy who moved or plays up' || chr(10)
    || '           OR notice_side_read(n.required_capability, n.school_id, n.team_code, n.kind, n.subject_kind,' || chr(10)
    || '                               n.subject_id, n.subject_person_id, n.recipient_id, n.published_at))';
  v_a2  text :=
       '               OR (news_notice_reach(n.subject_id) AND news_team_notice_reach(n.subject_id))), false) THEN';
  v_n2  text :=
       '               OR (news_notice_reach(n.subject_id) AND news_team_notice_reach(n.subject_id)))' || chr(10)
    || '          -- db/123: a notice with a team and no child follows the side' || chr(10)
    || '          AND notice_follows_side(n.required_capability, n.school_id, n.team_code, n.kind, n.subject_kind,' || chr(10)
    || '                                  n.subject_id, n.subject_person_id, n.recipient_id, n.published_at), false) THEN';
  v_src text; v_want text; v_def text; v_cfg text; v_acl text; v_sec boolean;
BEGIN
  SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef
    INTO v_src, v_cfg, v_acl, v_sec
    FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn);
  IF position('-- db/123: a notice with a team and no child follows the side' IN v_src) > 0 THEN
    RETURN;   -- already in place: a second run
  END IF;
  IF md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g')) IS DISTINCT FROM '42fec4a278f7a92c420c3efd3547f198' THEN   -- db/101's
    RAISE EXCEPTION 'db/123: % is not db/101''s any more; add the side clauses to the version now in place and move its hash', v_fn;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_a1, ''))) / length(v_a1) <> 1
     OR (length(v_src) - length(replace(v_src, v_a2, ''))) / length(v_a2) <> 1 THEN
    RAISE EXCEPTION 'db/123: % does not carry each of its two anchors exactly once', v_fn;
  END IF;
  v_want := replace(replace(v_src, v_a1, v_n1), v_a2, v_n2);
  v_def := pg_get_functiondef(to_regprocedure(v_fn));
  EXECUTE replace(replace(v_def, v_a1, v_n1), v_a2, v_n2);
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM v_want
     OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM v_cfg
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM v_acl
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM v_sec THEN
    RAISE EXCEPTION 'db/123: re-emitting % changed more than the side clauses', v_fn;
  END IF;
END $reemit$;


-- ── 3 · What this file promised, checked in the same paste ─────────
DO $check$
DECLARE v_q text; v_r text;
BEGIN
  SELECT qual INTO v_q FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'notification' AND policyname = 'notification_follows_side'
     AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT';
  SELECT qual INTO v_r FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'notification' AND policyname = 'notification_read_side'
     AND permissive = 'PERMISSIVE' AND cmd = 'SELECT';
  IF v_q IS DISTINCT FROM 'notice_follows_side(required_capability, school_id, team_code, kind, subject_kind, subject_id, subject_person_id, recipient_id, published_at)'
     OR v_r IS DISTINCT FROM 'notice_side_read(required_capability, school_id, team_code, kind, subject_kind, subject_id, subject_person_id, recipient_id, published_at)' THEN
    RAISE EXCEPTION 'db/123: the two policies read % and %', coalesce(v_q, '(missing)'), coalesce(v_r, '(missing)');
  END IF;
  -- db/09's read and the cuts beside it are all still there.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification' AND cmd = 'SELECT'
        AND ((permissive = 'PERMISSIVE' AND policyname IN ('notification_read', 'notification_read_sheet', 'notification_read_side'))
          OR (permissive = 'RESTRICTIVE' AND policyname IN ('notification_recipient_only', 'notification_safeguarding_uncut',
                                                            'notification_plan_side', 'notification_team_side',
                                                            'notification_follows_side')))) <> 8 THEN
    RAISE EXCEPTION 'db/123: notification''s read policies are not the eight expected';
  END IF;
  -- The two questions ask what the decisions say: the notice's day, the
  -- match's end, the moved boy's old side.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('notice_follows_side(text,uuid,text,text,text,uuid,uuid,uuid,timestamptz)')
                    AND prosecdef AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))
                    AND prosrc LIKE '%side_reach_on(p_cap, p_school, p_team, %, sa_date(p_at))%'
                    AND prosrc LIKE '%fixture_end_reach(p_cap, p_subject, p_school, p_team)%')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('notice_side_read(text,uuid,text,text,text,uuid,uuid,uuid,timestamptz)')
                    AND prosecdef AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))
                    AND prosrc LIKE '%news_own_old_side(p_school, p_team, sa_date(p_at))%'
                    AND prosrc LIKE '%fixture_end_reach(''news.read'', p_subject, p_school, p_team)%') THEN
    RAISE EXCEPTION 'db/123: notice_follows_side() or notice_side_read() is not this file''s';
  END IF;
  -- The report door asks both, is still a definer with a pinned path, and is
  -- the application's to call and nobody else's.
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE oid = to_regprocedure('notification_report(uuid)')
                    AND prosecdef
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))
                    AND prosrc LIKE '%OR notice_side_read(n.required_capability,%'
                    AND prosrc LIKE '%AND notice_follows_side(n.required_capability,%') THEN
    RAISE EXCEPTION 'db/123: notification_report() does not ask the side';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', to_regprocedure('notification_report(uuid)'), 'EXECUTE')
     OR has_function_privilege('public', to_regprocedure('notification_report(uuid)'), 'EXECUTE')
     OR has_function_privilege('public', to_regprocedure('notice_follows_side(text,uuid,text,text,text,uuid,uuid,uuid,timestamptz)'), 'EXECUTE')
     OR has_function_privilege('public', to_regprocedure('notice_side_read(text,uuid,text,text,text,uuid,uuid,uuid,timestamptz)'), 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', to_regprocedure('notice_follows_side(text,uuid,text,text,text,uuid,uuid,uuid,timestamptz)'), 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', to_regprocedure('notice_side_read(text,uuid,text,text,text,uuid,uuid,uuid,timestamptz)'), 'EXECUTE')
     OR NOT has_table_privilege('scrbrd_app', 'notification', 'SELECT') THEN
    RAISE EXCEPTION 'db/123: the application''s grants on notification and its read questions are not as written';
  END IF;
END $check$;

-- ══════════════════════════════════════════════════════════════════
--  123 · Notices follow the side (REACH group R-E: O-N)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN: one RESTRICTIVE read policy on `notification`, and the
-- report door's reader test given the same clause. The design is
-- docs/design/REACH_parent_pupil.md §3.2 (class B: "a notice with a team and
-- no child — 'training moved', 'team sheet published' — follows the side"),
-- §4 O-N, §5 item 10 and §6.5, decided by Kameel on 14 October 2026. Its
-- proof is db/99 §100.
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
-- WHAT THIS FILE ADDS
--   notification_follows_side   RESTRICTIVE, SELECT on notification. A
--       notice with a team, no child and no recipient is read only by whom
--       side_reach(required_capability, school_id, team_code, zeros) admits
--       (db/106, dated by db/117: the side today): the side's staff, its
--       players, school-wide staff and an admitted spectator (an assignment
--       naming nobody), a guardian through a child on that side, the boy
--       himself. Exempt, each unchanged:
--         team_code NULL                 a school or competition notice
--         subject_person_id set          follows the child (db/09's argument)
--         recipient_id set               him only (db/57's recipient cut)
--         kind 'safeguarding'            db/57's own rules, untouched
--         a notice about a news post     follows the post (db/96, db/101),
--                                        and the boy on the sheet keeps the
--                                        plan's notice (db/101 decision 2)
--       RESTRICTIVE, so it is ANDed with db/09's permissive read and every
--       other; nobody gains a row. db/09's policy is frozen and not touched.
-- AND CHANGES, with nothing removed
--   notification_report(notice) (db/101)  re-emitted in place with one
--       clause: the same rule, in the reader test db/101 wrote as "the
--       policies' own". Without it a parent of another side, given a side
--       notice's id, is told "not_reportable" (the notice exists) where he
--       should be told "no_such_notice". Guarded: the body must be db/101's
--       (its folded md5), the anchor must appear exactly once, and after the
--       swap the body is the old one with exactly that clause and the same
--       rights, settings and grants.
--
-- A SECOND PASTE changes nothing (the policy is created only if absent and
-- checked as written; the re-emit returns once its clause is in place).
--
-- OPEN, for Kameel (not decided here; §6.5 says side_reach with zeros):
--   * the boy playing up (db/101 decision 2, db/106 (3)): a fixture notice
--     about a match he is on the sheet for reaches his own side, not him nor
--     his parents; fixture_end_reach() on subject_id would add them.
--   * the side is today's (zeros), not the notice's day: a boy moved off U15A
--     no longer reads U15A's notices of last week.


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
                     OR qual NOT LIKE '%side_reach(required_capability, school_id, team_code, ''00000000-0000-0000-0000-000000000000''::uuid)%')) THEN
    RAISE EXCEPTION 'db/123: a notification_follows_side policy is on the table and is not this file''s';
  END IF;
END $guard$;


-- ── 1 · The rule: a team notice with no child follows the side ─────
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_follows_side') THEN
    CREATE POLICY notification_follows_side ON notification AS RESTRICTIVE
      FOR SELECT USING (team_code IS NULL OR subject_person_id IS NOT NULL OR recipient_id IS NOT NULL
                        OR kind = 'safeguarding'
                        OR (kind = 'notice' AND subject_kind = 'news' AND subject_id IS NOT NULL)
                        OR side_reach(required_capability, school_id, team_code,
                                      '00000000-0000-0000-0000-000000000000'::uuid));
  END IF;
END $policy$;

-- The application asks it as itself (a policy runs its functions as the
-- reader). db/106 granted it; said again so this file stands on its own.
GRANT EXECUTE ON FUNCTION side_reach(text, uuid, text, uuid) TO scrbrd_app;
GRANT SELECT ON notification TO scrbrd_app;


-- ── 2 · Reporting a notice: its readers, as the policies now draw them ──
DO $reemit$
DECLARE
  v_fn     text := 'notification_report(uuid)';
  v_anchor text :=
       '               OR (news_notice_reach(n.subject_id) AND news_team_notice_reach(n.subject_id))), false) THEN';
  v_new    text :=
       '               OR (news_notice_reach(n.subject_id) AND news_team_notice_reach(n.subject_id)))' || chr(10)
    || '          -- db/123: a notice with a team and no child follows the side' || chr(10)
    || '          -- (notification_follows_side, word for word).' || chr(10)
    || '          AND (n.team_code IS NULL OR n.subject_person_id IS NOT NULL OR n.recipient_id IS NOT NULL' || chr(10)
    || '               OR n.kind = ''safeguarding''' || chr(10)
    || '               OR (n.kind = ''notice'' AND n.subject_kind = ''news'' AND n.subject_id IS NOT NULL)' || chr(10)
    || '               OR side_reach(n.required_capability, n.school_id, n.team_code, ZERO)), false) THEN';
  v_src text; v_def text; v_cfg text; v_acl text; v_sec boolean;
BEGIN
  SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef
    INTO v_src, v_cfg, v_acl, v_sec
    FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn);
  IF position('-- db/123: a notice with a team and no child follows the side' IN v_src) > 0 THEN
    RETURN;   -- already in place: a second run
  END IF;
  IF md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g')) IS DISTINCT FROM '42fec4a278f7a92c420c3efd3547f198' THEN   -- db/101's
    RAISE EXCEPTION 'db/123: % is not db/101''s any more; add the side clause to the version now in place and move its hash', v_fn;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'db/123: % does not carry its anchor exactly once', v_fn;
  END IF;
  v_def := pg_get_functiondef(to_regprocedure(v_fn));
  EXECUTE replace(v_def, v_anchor, v_new);
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM replace(v_src, v_anchor, v_new)
     OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM v_cfg
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM v_acl
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM v_sec THEN
    RAISE EXCEPTION 'db/123: re-emitting % changed more than the side clause', v_fn;
  END IF;
END $reemit$;


-- ── 3 · What this file promised, checked in the same paste ─────────
DO $check$
DECLARE v_q text;
BEGIN
  SELECT qual INTO v_q FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'notification' AND policyname = 'notification_follows_side'
     AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT';
  IF v_q IS NULL
     OR v_q NOT LIKE '%team_code IS NULL%'
     OR v_q NOT LIKE '%subject_person_id IS NOT NULL%'
     OR v_q NOT LIKE '%recipient_id IS NOT NULL%'
     OR v_q NOT LIKE '%''safeguarding''%'
     OR v_q NOT LIKE '%''news''%'
     OR v_q NOT LIKE '%side_reach(required_capability, school_id, team_code, ''00000000-0000-0000-0000-000000000000''::uuid)%' THEN
    RAISE EXCEPTION 'db/123: notification_follows_side reads %', coalesce(v_q, '(missing, or not a restrictive SELECT)');
  END IF;
  -- db/09's read and the restrictive cuts beside it are all still there.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification' AND cmd = 'SELECT'
        AND ((permissive = 'PERMISSIVE' AND policyname IN ('notification_read', 'notification_read_sheet'))
          OR (permissive = 'RESTRICTIVE' AND policyname IN ('notification_recipient_only', 'notification_safeguarding_uncut',
                                                            'notification_plan_side', 'notification_team_side',
                                                            'notification_follows_side')))) <> 7 THEN
    RAISE EXCEPTION 'db/123: notification''s read policies are not the seven expected';
  END IF;
  -- The report door asks it, is still a definer with a pinned path, and is
  -- the application's to call and nobody else's.
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE oid = to_regprocedure('notification_report(uuid)')
                    AND prosecdef
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))
                    AND prosrc LIKE '%OR side_reach(n.required_capability, n.school_id, n.team_code, ZERO)), false) THEN%') THEN
    RAISE EXCEPTION 'db/123: notification_report() does not ask the side';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', to_regprocedure('notification_report(uuid)'), 'EXECUTE')
     OR has_function_privilege('public', to_regprocedure('notification_report(uuid)'), 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', to_regprocedure('side_reach(text,uuid,text,uuid)'), 'EXECUTE')
     OR NOT has_table_privilege('scrbrd_app', 'notification', 'SELECT') THEN
    RAISE EXCEPTION 'db/123: the application''s grants on notification, notification_report() or side_reach() are not as they were';
  END IF;
END $check$;

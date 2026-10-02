-- ══════════════════════════════════════════════════════════════════
--  77 · Ending a role (SCRBRD-132 C1)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. A role can be added from a screen (POST /api/users,
-- enrol_person() and decide_role_request() in db/08) and could not be ended
-- from one: staff leave, a coach changes sides, a parent's role ends, and the
-- only way to say so was SQL by hand. db/01's role_assignment_revoke policy
-- made the UPDATE possible and nothing called it. Design note:
-- docs/design/SCRBRD-132_end_a_role.md.
--
-- WHAT IS HERE
--
--   role_assignment_end(assignment, reason)
--       The one door. SECURITY DEFINER, search_path pinned, answers rather
--       than raises: (ok, reason). It ENDS one assignment by the table's own
--       withdrawal columns — active goes false, and db/01's
--       role_assignment_revoke_only() stamps revoked_by and revoked_at from
--       the session, as it does for every withdrawal. Nothing is deleted, and
--       valid_until is not touched (db/34's role_assignment_linked_guard keeps
--       a duty's authority in the duty's shape; active alone is enough, since
--       every liveness test in the schema begins `a.active`).
--   role_assignment_ending
--       THE AUDIT ROW: one per assignment ended here — who, when, and the
--       reason, which must be at least ten characters (support_access's
--       floor, db/22). db/34's duty_suspension is the pattern: written only by
--       the function, SELECT-only to the application, row-scoped to whoever
--       holds user.role.assign over the assignment's scope or audit.read at
--       its school. NOT to the person whose role ended: the reason is the
--       office's words about them (a disciplinary hearing, a complaint), and
--       the office tells them; it is on the record if they ask for it.
--   A notice to the person, kind 'system' (SG-9, db/57: a private notice to
--       a pupil must be the system's own): the role, the school and the date.
--       Never the reason. And a permissive SELECT policy so they can read it
--       even when the role that ended was their last one at that school —
--       admitted only through role_end_notice_is_mine(), which asks the audit
--       row, so the publish route cannot forge a notice into that door.
--
-- GRANT AUTHORITY, AT ONE SCHOOL: app_may_grant_at(role, school). A grant
-- asks two questions: app_can('user.role.assign', school, ...) (may this
-- person appoint anybody here?) and app_may_grant(role) (may they appoint
-- somebody to this role?). db/01's app_may_grant() answers the second across
-- EVERY assignment the caller holds, at every school. So a school
-- administrator at Hilton who is principal at Westville passed both questions
-- for a `medical` appointment at Hilton: the scope through Hilton's office,
-- the role through Westville's principal. app_may_grant_at() answers the
-- second question at the first one's school: the assignment whose role lists
-- p_role in role_grantable must itself be at that school, or tenant-less (the
-- platform). It is live by the same rule (active, dated, not past its hour,
-- not suspended), false under a pad credential, and keeps db/01's
-- platform-only floor. Every caller moves to it here: role_assignment_write
-- (the INSERT policy every grant passes), role_request_read (db/08: who sees
-- a request to decide), decide_role_request() (db/62) and enrol_person()
-- (db/08), db/34's duty_link() and duty_lift(), db/57's
-- dso_appointment_guard(), role_assignment_end() below, and the read API's
-- `decidable`. Each function is re-emitted from the body now in place, with
-- the one call replaced; the body is md5-guarded, so this refuses to run over
-- a version it was not written against. db/01's app_may_grant(text) stays
-- defined, frozen with db/01, and nothing calls it: the check at the foot
-- asserts that.
--
-- WHO MAY END ONE: whoever may grant that role at that school, asked the way
-- a grant now asks it:
--   app_can('user.role.assign', school, '*', ANY, ANY) AND app_may_grant_at(role, school).
-- The platform is in that set already (a platform-wide user.role.assign
-- reaches every school). A platform-wide assignment is ended only from a
-- platform-wide one: with no school, both questions match only a tenant-less
-- assignment.
--
-- WHO MAY NOT, whatever they hold:
--   owners_key      The owner's key — a platform-wide superadmin assignment,
--                   db/18's and db/99's test — is not ended here by anybody.
--                   It is the way back in; losing it is a deployment problem.
--   superadmin_only An assignment held by somebody who holds a live
--                   superadmin assignment is ended only by a superadmin. A
--                   platform administrator does not unpick the owner's roles.
--   last_admin      Nobody ends their own assignment carrying
--                   user.role.assign when no other live, permanent one of
--                   theirs carries it over the same school. (A support
--                   session's hour does not count as another.)
--   own_dso         Nobody ends their own DSO appointment. A DSO who steps
--                   down asks the principal or the provincial DSO, so the
--                   step is somebody else's act on the record — a DSO cannot
--                   take themselves out from under a concern by their own
--                   hand. db/57's dso_appointment_guard() still runs on the
--                   UPDATE for everybody else (only the principal, the
--                   platform, or the DSO above; never while a leadership or
--                   DSO concern naming the person ending it, or nobody, is
--                   open); its refusal comes back as dso_blocked, in its own
--                   generic words.
--   support_session An hour of support (db/22) is ended by
--                   support_access_end(), which closes its record too.
--
-- A GUARDIAN ROLE DOES NOT BYPASS THE GUARDIAN LINK'S RULES. db/08's
-- guardian_link_revoke() is the act on a link, and its two rules apply here:
-- the caller must ALSO hold guardian.link.manage at the school (so the
-- platform administrator, who may grant `guardian` but holds no
-- guardian.link.manage, asks the school), and the LAST VERIFIED LINK OF A
-- MINOR is not ended (last_verified_link): link the new guardian first.
--
-- AN ENDED ASSIGNMENT TAKES ITS LIVE LINKS WITH IT. Every live link it names
-- (pending or verified, not yet ended) is marked revoked and dated to today,
-- as guardian_link_revoke() marks one. Readers that ask whether a LINK is live
-- without asking whether its assignment is — player_guardian_link_counts()
-- behind player_guardian_status, guardian_link_verify(), the consent
-- functions — would otherwise go on counting a parent whose role had ended.
-- db/62's re-open never touches a revoked link.
--
-- NOTHING ELSE MOVES. app_can(), app_holds() and app_may_grant() already
-- refuse an inactive assignment on the next statement; db/99 §56 proves it.
--
-- search_path pinned on every function (db/16). Safe to run twice.


-- ── 0 · Grant authority, at one school ─────────────────────────────
CREATE OR REPLACE FUNCTION app_may_grant_at(p_role text, p_school uuid) RETURNS boolean AS $$
  SELECT NOT app_pad_scoped() AND EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_grantable g ON g.granter = a.role AND g.role = p_role
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       -- THE SCOPE: the granting assignment is at this school, or the
       -- platform's. No school asked about matches only the platform.
       AND (a.school_id IS NULL OR (p_school IS NOT NULL AND a.school_id = p_school))
       -- db/01's floor: a role carrying a platform capability is handed out
       -- only from an assignment that belongs to no school.
       AND (a.school_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM role_capability rc
                JOIN capability c ON c.name = rc.capability AND c.platform_only
               WHERE rc.role = p_role))
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION app_may_grant_at(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_may_grant_at(text, uuid) TO scrbrd_app;

-- The functions that asked app_may_grant(role), re-emitted from the body in
-- place with that one call scoped. Guarded: each body must be the version
-- named (its md5), and the call must appear in it exactly once. A body that
-- already carries the scoped call is left as it is, so the file runs twice.
-- After the rewrite the new body must be the old one with exactly that
-- replacement, and the function keeps its signature, rights and settings.
DO $reemit$
DECLARE
  r      record;
  v_src  text;
  v_def  text;
  v_cfg  text;
  v_acl  text;
  v_sec  boolean;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('decide_role_request(uuid,boolean,text,uuid,text)', 'd392898c0744e7a098938cd7a35159d2', 'db/62',
       'app_may_grant(r.role)', 'app_may_grant_at(r.role, r.school_id)'),
      ('enrol_person(text,text,text,uuid,text,uuid,text)', '58fcf21bbe50fccdd96ce78a94637006', 'db/08',
       'app_may_grant(p_role)', 'app_may_grant_at(p_role, p_school)'),
      ('duty_link(uuid)', 'e522905f36616a48e38d8bc5807b7f37', 'db/34',
       'app_may_grant(v_role)', 'app_may_grant_at(v_role, d.school_id)'),
      ('duty_lift(uuid,text)', '456bec5a4767ac4fd5608477b5daf1e7', 'db/34',
       'app_may_grant(v_role)', 'app_may_grant_at(v_role, d.school_id)'),
      ('dso_appointment_guard()', 'c3fb714ee0ef1ad05c2a7816e2343fa6', 'db/57',
       'app_may_grant(''dso'')', 'app_may_grant_at(''dso'', OLD.school_id)')) AS x(fn, h, src, old_call, new_call)
  LOOP
    SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef
      INTO v_src, v_cfg, v_acl, v_sec
      FROM pg_proc p WHERE p.oid = r.fn::regprocedure;
    IF position(r.new_call IN v_src) > 0 AND position(r.old_call IN v_src) = 0 THEN
      CONTINUE;   -- already scoped: a second run
    END IF;
    IF md5(v_src) IS DISTINCT FROM r.h THEN
      RAISE EXCEPTION 'db/77: % is not %''s any more; scope its app_may_grant() call in the version now in place and move its hash',
        r.fn, r.src;
    END IF;
    IF (length(v_src) - length(replace(v_src, r.old_call, ''))) / length(r.old_call) <> 1 THEN
      RAISE EXCEPTION 'db/77: % does not call % exactly once', r.fn, r.old_call;
    END IF;
    v_def := pg_get_functiondef(r.fn::regprocedure);
    EXECUTE replace(v_def, r.old_call, r.new_call);
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM replace(v_src, r.old_call, r.new_call)
       OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_cfg
       OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_acl
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_sec THEN
      RAISE EXCEPTION 'db/77: re-emitting % changed more than its app_may_grant() call', r.fn;
    END IF;
  END LOOP;
END $reemit$;

-- The two policies that asked it, as they were with the call scoped.
-- role_assignment_write (db/01): every INSERT of an appointment.
DROP POLICY IF EXISTS role_assignment_write ON role_assignment;
CREATE POLICY role_assignment_write ON role_assignment
  FOR INSERT WITH CHECK (
    app_can('user.role.assign', school_id, team_code, NULL, NULL)
    AND app_may_grant_at(role, school_id)
  );
-- role_request_read (db/08): who sees a request is who may decide it.
DROP POLICY IF EXISTS role_request_read ON role_request;
CREATE POLICY role_request_read ON role_request
  FOR SELECT USING (
    person_id = app_user_id()
    OR (app_can('user.role.assign', school_id, '*'::text,
                '00000000-0000-0000-0000-000000000000'::uuid,
                '00000000-0000-0000-0000-000000000000'::uuid)
        AND app_may_grant_at(role, school_id))
  );


-- ── 1 · The audit row ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_assignment_ending (
  assignment_id uuid PRIMARY KEY REFERENCES role_assignment(id) ON DELETE CASCADE,
  -- The assignment's own scope and subject, copied, so the row reads alone
  -- and its policy needs no join.
  person_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role          text NOT NULL,
  school_id     uuid REFERENCES school(id) ON DELETE CASCADE,
  team_code     text,
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10 AND length(reason) <= 2000),
  ended_by      uuid NOT NULL REFERENCES app_user(id),
  ended_at      timestamptz NOT NULL DEFAULT now(),
  -- The notice the person was sent, when there was a school to send it at.
  notice_id     uuid REFERENCES notification(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS role_assignment_ending_school_idx ON role_assignment_ending (school_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS role_assignment_ending_notice_idx ON role_assignment_ending (notice_id) WHERE notice_id IS NOT NULL;

ALTER TABLE role_assignment_ending ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_assignment_ending_read ON role_assignment_ending;
CREATE POLICY role_assignment_ending_read ON role_assignment_ending
  FOR SELECT USING (
    app_can('user.role.assign', school_id, team_code, NULL, NULL)
    OR app_can('audit.read', school_id, '*'::text,
               '00000000-0000-0000-0000-000000000000'::uuid,
               '00000000-0000-0000-0000-000000000000'::uuid)
  );
-- A pad credential reads none of it (db/50).
SELECT pad_scope_guard_install('role_assignment_ending'::regclass);
-- Written by role_assignment_end() alone.
GRANT SELECT ON role_assignment_ending TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON role_assignment_ending FROM scrbrd_app;


-- ── 2 · The notice's own door ──────────────────────────────────────
-- TRUE for a notice role_assignment_end() wrote to the caller about their own
-- ended assignment. Definer, because the caller may not read the audit row;
-- it answers only this one bit, about a notice addressed to them.
CREATE OR REPLACE FUNCTION role_end_notice_is_mine(p_notice uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM role_assignment_ending e
     WHERE e.notice_id = p_notice AND e.person_id = app_user_id())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP POLICY IF EXISTS notification_role_ended ON notification;
CREATE POLICY notification_role_ended ON notification
  FOR SELECT USING (
    kind = 'system' AND recipient_id = app_user_id() AND role_end_notice_is_mine(id)
  );


-- ── 3 · Role names, as the screens say them (apps/web/src/design/roles.js) ──
CREATE OR REPLACE FUNCTION role_words(p_role text) RETURNS text AS $$
  SELECT CASE p_role
    WHEN 'superadmin' THEN 'Super Admin'           WHEN 'platformadmin' THEN 'Platform Admin'
    WHEN 'principal' THEN 'Principal'              WHEN 'directorofsport' THEN 'Director of Sport'
    WHEN 'schooladmin' THEN 'School Admin'         WHEN 'sportsadmin' THEN 'Sports Admin'
    WHEN 'coach' THEN 'Coach'                      WHEN 'assistantcoach' THEN 'Assistant Coach'
    WHEN 'teammanager' THEN 'Team Manager'         WHEN 'player' THEN 'Player'
    WHEN 'guardian' THEN 'Parent / Guardian'       WHEN 'spectator' THEN 'Spectator'
    WHEN 'selfaccess' THEN 'My Record'             WHEN 'enquiry' THEN 'Enquiry Access'
    WHEN 'scorer' THEN 'Scorer'                    WHEN 'official' THEN 'Match Official'
    WHEN 'analyst' THEN 'Performance Analyst'      WHEN 'scout' THEN 'Scout'
    WHEN 'medical' THEN 'Medical Staff'            WHEN 'fitness' THEN 'Strength & Conditioning'
    WHEN 'transportcoordinator' THEN 'Transport Coordinator'
    WHEN 'driver' THEN 'Driver'                    WHEN 'facilities' THEN 'Groundskeeper'
    WHEN 'finance' THEN 'Finance Admin'            WHEN 'sponsorship' THEN 'Sponsorship'
    WHEN 'media' THEN 'Media'                      WHEN 'competitionadmin' THEN 'Competition Admin'
    WHEN 'dso' THEN 'Safeguarding Officer'
    ELSE p_role END
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;


-- ── 4 · The door ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION role_assignment_end(p_assignment uuid, p_reason text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  a        role_assignment%ROWTYPE;
  v_me     uuid := app_user_id();
  v_why    text := btrim(coalesce(p_reason, ''));
  v_school uuid;
  v_name   text;
  v_notice uuid;
  v_player uuid;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  IF length(v_why) < 10 THEN RETURN QUERY SELECT false, 'reason_required'; RETURN; END IF;
  IF length(v_why) > 2000 THEN RETURN QUERY SELECT false, 'reason_too_long'; RETURN; END IF;

  SELECT * INTO a FROM role_assignment r WHERE r.id = p_assignment FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_assignment'; RETURN; END IF;

  -- Authority FIRST, so nothing below tells a stranger anything about the
  -- row: the same two questions a grant asks, both at the row's school.
  IF NOT (app_can('user.role.assign', a.school_id, '*'::text,
                  '00000000-0000-0000-0000-000000000000'::uuid,
                  '00000000-0000-0000-0000-000000000000'::uuid)
          AND app_may_grant_at(a.role, a.school_id)) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;

  IF NOT a.active THEN RETURN QUERY SELECT false, 'already_ended'; RETURN; END IF;

  -- The owner's key: never here.
  IF a.role = 'superadmin' AND a.school_id IS NULL THEN
    RETURN QUERY SELECT false, 'owners_key'; RETURN;
  END IF;

  -- A superadmin's roles, only by a superadmin.
  IF EXISTS (SELECT 1 FROM role_assignment s
              WHERE s.person_id = a.person_id AND s.role = 'superadmin' AND s.active
                AND (s.valid_from  IS NULL OR s.valid_from  <= current_date)
                AND (s.valid_until IS NULL OR s.valid_until >  current_date)
                AND (s.expires_at  IS NULL OR s.expires_at  >  now()))
     AND NOT EXISTS (SELECT 1 FROM role_assignment s
                      WHERE s.person_id = v_me AND s.role = 'superadmin' AND s.active
                        AND (s.valid_from  IS NULL OR s.valid_from  <= current_date)
                        AND (s.valid_until IS NULL OR s.valid_until >  current_date)
                        AND (s.expires_at  IS NULL OR s.expires_at  >  now())
                        AND NOT EXISTS (SELECT 1 FROM duty_suspension d
                                         WHERE d.assignment_id = s.id AND d.lifted_at IS NULL)) THEN
    RETURN QUERY SELECT false, 'superadmin_only'; RETURN;
  END IF;

  -- An hour of support closes through its own record.
  IF EXISTS (SELECT 1 FROM support_access s WHERE s.assignment_id = a.id) THEN
    RETURN QUERY SELECT false, 'support_session'; RETURN;
  END IF;

  IF a.role = 'dso' AND a.person_id = v_me THEN
    RETURN QUERY SELECT false, 'own_dso'; RETURN;
  END IF;

  -- The last key in your own hand over this school.
  IF a.person_id = v_me
     AND EXISTS (SELECT 1 FROM role_capability rc
                  WHERE rc.role = a.role AND rc.capability = 'user.role.assign')
     AND NOT EXISTS (
       SELECT 1 FROM role_assignment o
         JOIN role_capability rc ON rc.role = o.role AND rc.capability = 'user.role.assign'
        WHERE o.person_id = v_me AND o.id <> a.id AND o.active
          AND o.expires_at IS NULL
          AND (o.valid_from  IS NULL OR o.valid_from  <= current_date)
          AND (o.valid_until IS NULL OR o.valid_until >  current_date)
          AND NOT EXISTS (SELECT 1 FROM duty_suspension d
                           WHERE d.assignment_id = o.id AND d.lifted_at IS NULL)
          AND (o.school_id IS NULL OR o.school_id IS NOT DISTINCT FROM a.school_id)) THEN
    RETURN QUERY SELECT false, 'last_admin'; RETURN;
  END IF;

  -- The guardian link's own rules (guardian_link_revoke(), db/08).
  IF a.role = 'guardian' THEN
    IF NOT app_can('guardian.link.manage', a.school_id, '*'::text,
                   '00000000-0000-0000-0000-000000000000'::uuid,
                   '00000000-0000-0000-0000-000000000000'::uuid) THEN
      RETURN QUERY SELECT false, 'not_permitted'; RETURN;
    END IF;
    SELECT g.player_id INTO v_player
      FROM assignment_subject g
      JOIN player_guardian_status s ON s.player_id = g.player_id
     WHERE g.assignment_id = a.id
       AND g.verification_state = 'verified'
       AND g.valid_from <= current_date
       AND (g.valid_until IS NULL OR g.valid_until > current_date)
       AND s.is_minor AND s.live_links <= 1
     LIMIT 1;
    IF v_player IS NOT NULL THEN
      RETURN QUERY SELECT false, 'last_verified_link'; RETURN;
    END IF;
  END IF;

  -- The writes. A trigger's refusal (db/57's DSO guard) rolls the block back
  -- and comes back as an answer.
  BEGIN
    UPDATE assignment_subject g
       SET verification_state = 'revoked',
           valid_until        = greatest(g.valid_from, current_date)
     WHERE g.assignment_id = a.id
       AND g.verification_state IN ('pending', 'verified')
       AND (g.valid_until IS NULL OR g.valid_until > current_date);

    UPDATE role_assignment SET active = false WHERE id = a.id;
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT false, CASE WHEN a.role = 'dso' THEN 'dso_blocked' ELSE 'refused' END;
    RETURN;
  END;

  -- The notice: the role, the school, the date. Never the reason. A
  -- platform-wide assignment is told at the person's own school, if any.
  SELECT u.school_id INTO v_school FROM app_user u WHERE u.id = a.person_id;
  v_school := coalesce(a.school_id, v_school);
  IF v_school IS NOT NULL THEN
    SELECT s.name INTO v_name FROM school s WHERE s.id = v_school;
    INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                              required_capability, is_public, subject_kind, subject_id, recipient_id)
    VALUES (v_school, NULL, 'school', 'system', 'medium', 'A role of yours has ended',
            'Your ' || role_words(a.role) || ' role'
              || CASE WHEN a.team_code IS NOT NULL THEN ' (' || a.team_code || ')' ELSE '' END
              || CASE WHEN a.school_id IS NULL THEN ' on the platform' ELSE ' at ' || coalesce(v_name, 'your school') END
              || ' ended on ' || to_char(current_date, 'FMDD FMMonth YYYY')
              || '. If you did not expect this, ask the school office.',
            'news.read', false, 'system', a.id, a.person_id)
    RETURNING id INTO v_notice;
  END IF;

  INSERT INTO role_assignment_ending (assignment_id, person_id, role, school_id, team_code,
                                      reason, ended_by, notice_id)
  VALUES (a.id, a.person_id, a.role, a.school_id, a.team_code, v_why, v_me, v_notice);

  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 5 · Grants ─────────────────────────────────────────────────────
DO $grants$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION role_assignment_end(uuid, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION role_assignment_end(uuid, text) TO scrbrd_app;
  -- Called from the notification policy, so the application role runs it.
  REVOKE ALL ON FUNCTION role_end_notice_is_mine(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION role_end_notice_is_mine(uuid) TO scrbrd_app;
  REVOKE ALL ON FUNCTION role_words(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION role_words(text) TO scrbrd_app;
  -- A managed host's API roles (Supabase grants new objects to them).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION role_assignment_end(uuid, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION role_end_notice_is_mine(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION role_words(text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION app_may_grant_at(text, uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON role_assignment_ending FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── 6 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §56 and walked through the API by
-- tools/smoke-end-role.mjs.
DO $check$
DECLARE f text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'role_assignment_ending'::regclass) THEN
    RAISE EXCEPTION 'db/77: role_assignment_ending is not under row-level security';
  END IF;
  IF has_table_privilege('scrbrd_app', 'role_assignment_ending', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'role_assignment_ending', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'role_assignment_ending', 'DELETE') THEN
    RAISE EXCEPTION 'db/77: the application may write role_assignment_ending';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'role_assignment_ending'
                AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'db/77: role_assignment_ending has a write policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'role_assignment_ending'
                    AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/77: role_assignment_ending has no RESTRICTIVE pad_scope_select (db/50)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_role_ended' AND permissive = 'PERMISSIVE' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'db/77: notification_role_ended is missing';
  END IF;
  -- The cuts on notification still stand over the new door.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
         AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
         AND policyname IN ('notification_recipient_only', 'notification_safeguarding_uncut', 'pad_scope_select')) <> 3 THEN
    RAISE EXCEPTION 'db/77: a RESTRICTIVE cut on notification is missing';
  END IF;
  -- Grant authority is asked at one school, everywhere: no function and no
  -- policy calls db/01's app_may_grant(text) any more (comments aside).
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO f
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname <> 'app_may_grant'
     AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'app_may_grant\s*\(';
  IF f IS NOT NULL THEN RAISE EXCEPTION 'db/77: still asking the unscoped app_may_grant(): %', f; END IF;
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO f FROM pg_policies
   WHERE schemaname = 'public' AND coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'app_may_grant\s*\(';
  IF f IS NOT NULL THEN RAISE EXCEPTION 'db/77: a policy still asks the unscoped app_may_grant(): %', f; END IF;
  FOREACH f IN ARRAY ARRAY['role_assignment_end(uuid,text)', 'role_end_notice_is_mine(uuid)', 'role_words(text)',
                           'app_may_grant_at(text,uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/77: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/77: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  -- The triggers the function relies on to stamp and to guard.
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'role_assignment'::regclass AND NOT tgisinternal
         AND tgname IN ('role_assignment_revoke_guard', 'role_assignment_dso_guard', 'role_assignment_linked_guard')) <> 3 THEN
    RAISE EXCEPTION 'db/77: a trigger role_assignment_end() relies on is missing';
  END IF;
END $check$;

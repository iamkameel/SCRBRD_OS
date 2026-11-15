-- ══════════════════════════════════════════════════════════════════
--  161 · "The school has answered your request": one notice to the
--        waiting parent, the same words for a yes and a no
--        (EXPERIENCE_PASS Q15, slice 4)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/redesign/EXPERIENCE_PASS.md §2.6 steps 4
-- to 6, Q15 (decided 13 Nov 2026, as recommended) and Slice 4's Migration
-- row: "a db/NN writes one `system` notice to the asker (`recipient_id`),
-- with the same words whether the answer was yes or no: 'The school has
-- answered your request', saying nothing of the answer (her requests list
-- already says 'granted' or 'declined', lib/joinSchool.js:178-183); the
-- push a pointer (NOTIFICATIONS D14). The decline's own `safeguarding`
-- notice still reaches only the DSOs (db/93), unchanged."
--
-- WHY. Nothing told a parent the office had answered. guardian_link_verify()
-- (db/08:987-1035, its only definition) updates the link and nothing else;
-- the grant door that verifies a parent's request (role_request_grant_as(),
-- db/92) writes the link and no notice; a decline tells the school's DSOs
-- and not the asker (db/93).
--
-- THE NOTICE. kind 'system', urgency 'medium', subject_kind 'system',
-- recipient_id the asker, required_capability 'news.read', not public, at
-- the request's (or the link's) school: db/109's notice, to the letter of
-- its pattern (db/109:290-301). Its words never change with the answer:
--   title  The school has answered your request
--   body   The office at <school> has answered your request to be linked
--          to a child. Open SCRBRD to see its answer.
-- No child is named, and the request's own note is never copied. The
-- school may be named, as db/109's notice names it: the parent named it
-- herself when she asked. The answer is on her requests list (the no-school
-- home) or in her Family, never in the notice. No push: there is no push
-- delivery yet (notification_push_job does not exist, NOTIFICATIONS S3), so
-- this is an in-app notice; when delivery ships, the push is D14's pointer.
--
-- WHO RECEIVES IT. The asker, and nobody else: db/57's RESTRICTIVE
-- notification_recipient_only already cuts every reader but the recipient,
-- and the read door below admits her alone. NEVER A PUPIL: db/57 refuses a
-- private notice to a pupil unless it is the system's; this file goes
-- further and writes none at all to an account person_is_pupil() says is a
-- pupil (the lead's rule for slice 4). A guardian request is never a
-- pupil's in practice; the rule is written down so it stays so.
--
-- WHEN. Once per answer:
--   (a) a guardian role request goes from 'pending' to 'granted' or
--       'declined', by whatever door (decide_role_request(),
--       register_claim(), role_request_grant_as()): an AFTER UPDATE OF state
--       trigger on role_request, beside db/93's, which it does not touch.
--       A request the asker withdrew is not an answer: no notice.
--   (b) the office verifies a link it established and the parent has been
--       waiting on (guardian_link_verify()): re-emitted below, its db/08
--       body verbatim, with the notice written after the one row it
--       verified. db/08 is frozen, so the function is re-emitted here, not
--       edited there, behind an md5 guard on the live body: a body that is
--       neither db/08's (as db/128 left it) nor this file's refuses the paste. Its signature,
--       its answers and its grants are unchanged.
-- Nothing is backfilled: an answer given before the paste wrote no notice
-- and writes none now.
--
-- WHAT IT DOES NOT COVER. A pending link the office ends instead of
-- verifying goes through guardian_link_revoke() (db/109), whose own notice
-- says "A link to a child has ended", with its date. That is db/109's, as
-- decided for links that end; for a link that was never verified it tells
-- the answer. It is left for Kameel (the lead's report), not changed here.
--
-- Q10, THE TEAM SHEET (Kameel, 15 Nov: "eleven"): no SQL here. STEP4 Q10's
-- shape, the eleven, names and batting order, to a verified, live guardian
-- of a boy on that end's sheet, that fixture and that end only, is already
-- db/131's fixture_sheet() (REACH R-H), shipped, proved by db/99 §109. db/99
-- §139 (sheet) proves it again for the cases Kameel's answer names: a pending
-- link, an ended link, a boy on no sheet, the other school's guardian, the
-- other end; each red with the read's gate taken out.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   + school_answer_subject_is_mine(uuid)  the read door: true when the
--       notice's subject is a guardian role request of the caller's, or a
--       guardian link of the caller's. A definer (the caller may read
--       neither row once she holds no role at that school), search_path
--       pinned, answers that one bit and nothing else.
--   + policy notification_answered on notification, FOR SELECT, permissive:
--       kind 'system', subject_kind 'system', the fixed title, addressed to
--       the caller, and its subject hers. db/57's RESTRICTIVE cuts still
--       apply on top of it.
--   + school_answered_notice()  the trigger function for (a); owner-only:
--       a trigger function is called by its trigger, never by the
--       application, so it is granted to nobody (db/57's and db/93's
--       trigger functions likewise).
--   + trigger role_request_answered_notice on role_request.
--   ~ guardian_link_verify(uuid, uuid, text, text)  re-emitted, as (b).
--   Every function: REVOKE ALL FROM PUBLIC; the door and the verify
--   function GRANT EXECUTE TO scrbrd_app by name; nothing to anon,
--   authenticated or service_role (db/157's rule), and the check at the
--   foot reads the grants back from the ACLs.
--
-- No table, column or row moves. Safe to run twice: a second paste changes
-- nothing. One transaction (the paste runs the file inside one; no BEGIN or
-- COMMIT here). Its proof is db/99 §139; the walk is smoke-browser-read's
-- waiting parent.


-- ── 0 · What this file stands on, and the body it re-emits ─────────
DO $guard$
DECLARE v_src text;
BEGIN
  IF to_regprocedure('app_user_id()') IS NULL OR to_regprocedure('person_is_pupil(uuid)') IS NULL
     OR to_regprocedure('player_school(uuid)') IS NULL OR to_regprocedure('api_role_reach(name)') IS NULL
     OR to_regprocedure('guardian_link_verify(uuid,uuid,text,text)') IS NULL
     OR to_regclass('role_request') IS NULL OR to_regclass('notification') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'notification'::regclass AND attname = 'recipient_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'db/161: app_user_id() (db/01), person_is_pupil() or notification.recipient_id (db/57), player_school() or guardian_link_verify() (db/08), or api_role_reach() (db/157) is missing; apply them first';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = 'guardian_link_verify(uuid,uuid,text,text)'::regprocedure;
  -- A second paste finds this file's own body; anything else must be db/08's as db/128 left it.
  IF position('db/161' IN v_src) = 0 AND md5(v_src) IS DISTINCT FROM '129a9ee450e14dd3cbb11f63ee7b1aef' THEN
    RAISE EXCEPTION 'db/161: guardian_link_verify() is not db/08''s as db/128 left it (md5 %); factor the version now in place and move this hash', md5(v_src);
  END IF;
END $guard$;


-- ── 1 · The words, once ────────────────────────────────────────────
-- The one place the notice's words are written: the trigger, the re-emitted
-- verify and the read door's title test all call it, so the three cannot
-- drift apart. IMMUTABLE on its argument; it reads nothing.
CREATE OR REPLACE FUNCTION school_answered_words(p_school_name text, OUT title text, OUT body text) AS $$
  SELECT 'The school has answered your request'::text,
         'The office at ' || coalesce(nullif(btrim(p_school_name), ''), 'the school')
           || ' has answered your request to be linked to a child. Open SCRBRD to see its answer.'
$$ LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 2 · The notice, written ─────────────────────────────────────────
-- Internal: one notice to p_person about p_subject at p_school, unless the
-- person is a pupil. Owner-only; called by the trigger and the verify door.
CREATE OR REPLACE FUNCTION school_answered_notice_write(p_person uuid, p_school uuid, p_subject uuid) RETURNS void AS $$
DECLARE w record;
BEGIN
  IF p_person IS NULL OR p_school IS NULL OR p_subject IS NULL OR person_is_pupil(p_person) THEN RETURN; END IF;
  SELECT * INTO w FROM school_answered_words((SELECT s.name FROM school s WHERE s.id = p_school));
  INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                            required_capability, is_public, subject_kind, subject_id, recipient_id)
  VALUES (p_school, NULL, 'school', 'system', 'medium', w.title, w.body,
          'news.read', false, 'system', p_subject, p_person);
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- (a) A guardian request answered, yes or no, by any door.
CREATE OR REPLACE FUNCTION school_answered_notice() RETURNS trigger AS $$
BEGIN
  PERFORM school_answered_notice_write(NEW.person_id, NEW.school_id, NEW.id);
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER role_request_answered_notice
  AFTER UPDATE OF state ON role_request
  FOR EACH ROW
  WHEN (OLD.state = 'pending' AND NEW.state IN ('granted', 'declined') AND NEW.role = 'guardian')
  EXECUTE FUNCTION school_answered_notice();


-- (b) guardian_link_verify(), the live body verbatim to its last refusal:
-- db/08's, with db/128's one change (current_date read as sa_today(), the
-- SA day; db/99 §105 holds every body to it). Then (db/161) the notice to
-- the guardian about the link just verified.
CREATE OR REPLACE FUNCTION guardian_link_verify(
  p_guardian        uuid,
  p_player          uuid,
  p_consent_version text DEFAULT NULL,
  p_note            text DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_school uuid;
  v_rows   int;
  v_link   uuid;
BEGIN
  v_school := player_school(p_player);
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'no_such_player'; RETURN; END IF;

  IF NOT app_can('guardian.link.manage', v_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;

  -- No check for a missing session: app_can() above compares app_user_id()
  -- against role_assignment.person_id, and NULL matches nothing, so a
  -- sessionless caller is already refused as 'not_permitted'.
  IF p_guardian = app_user_id() THEN RETURN QUERY SELECT false, 'self_verified'; RETURN; END IF;

  UPDATE assignment_subject g
     SET verification_state = 'verified',
         verified_by        = app_user_id(),
         verified_at        = now(),
         verified_note      = p_note,
         consent_state      = CASE WHEN p_consent_version IS NULL
                                   THEN g.consent_state ELSE 'granted' END,
         consent_version    = coalesce(p_consent_version, g.consent_version),
         consent_at         = CASE WHEN p_consent_version IS NULL
                                   THEN g.consent_at ELSE now() END
   WHERE g.player_id = p_player
     -- LIVE, not "open-ended". Every guardian link now ends at the child's
     -- majority, so `valid_until IS NULL` selects nothing and this would
     -- quietly stop finding the link it is meant to act on.
     AND (g.valid_until IS NULL OR g.valid_until > sa_today())
     AND g.verification_state = 'pending'
     AND EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.id = g.assignment_id
                    AND a.person_id = p_guardian AND a.role = 'guardian');
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN RETURN QUERY SELECT false, 'no_pending_link'; RETURN; END IF;

  -- db/161 (Q15): the parent was waiting on this link; tell her the office
  -- has answered, in the words that never say what the answer was. The
  -- link this call verified, by who verified it and when (now()).
  SELECT g.id INTO v_link
    FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id
   WHERE g.player_id = p_player AND a.person_id = p_guardian AND a.role = 'guardian'
     AND g.verification_state = 'verified' AND g.verified_by = app_user_id() AND g.verified_at = now()
   ORDER BY g.id LIMIT 1;
  PERFORM school_answered_notice_write(p_guardian, v_school, v_link);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · The read door ──────────────────────────────────────────────
-- TRUE when p_subject is a guardian role request of the caller's, or a
-- guardian link of the caller's. A definer: a parent who was declined holds
-- no role at the school and reads neither row. One bit, about her own.
CREATE OR REPLACE FUNCTION school_answer_subject_is_mine(p_subject uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND p_subject IS NOT NULL AND (
    EXISTS (SELECT 1 FROM role_request r
             WHERE r.id = p_subject AND r.person_id = app_user_id() AND r.role = 'guardian')
    OR EXISTS (SELECT 1 FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id
                WHERE g.id = p_subject AND a.person_id = app_user_id() AND a.role = 'guardian'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Made only where missing (db/109's and db/160's pattern), so a second paste
-- leaves the catalogue as it was.
DO $door$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification'::regclass AND polname = 'notification_answered') THEN
    CREATE POLICY notification_answered ON notification
      FOR SELECT USING (
        kind = 'system' AND subject_kind = 'system' AND recipient_id = app_user_id()
        AND title = (school_answered_words(NULL)).title
        AND school_answer_subject_is_mine(subject_id)
      );
  END IF;
END $door$;


-- ── 4 · Who may call them ──────────────────────────────────────────
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['school_answered_words(text)', 'school_answered_notice_write(uuid,uuid,uuid)',
                           'school_answered_notice()', 'school_answer_subject_is_mine(uuid)',
                           'guardian_link_verify(uuid,uuid,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  -- The policy's two functions run as the reader; the verify door is the office's.
  FOREACH f IN ARRAY ARRAY['school_answered_words(text)', 'school_answer_subject_is_mine(uuid)',
                           'guardian_link_verify(uuid,uuid,text,text)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['school_answered_words(text)', 'school_answered_notice_write(uuid,uuid,uuid)',
                               'school_answered_notice()', 'school_answer_subject_is_mine(uuid)',
                               'guardian_link_verify(uuid,uuid,text,text)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── 5 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE v text; r text; want text;
BEGIN
  -- Every function a definer with the pinned search_path, granted exactly as section 4 says.
  FOREACH r IN ARRAY ARRAY['school_answered_words(text)', 'school_answered_notice_write(uuid,uuid,uuid)',
                           'school_answered_notice()', 'school_answer_subject_is_mine(uuid)',
                           'guardian_link_verify(uuid,uuid,text,text)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = r::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/161: % is not a definer with a pinned search_path', r;
    END IF;
    want := CASE WHEN r IN ('school_answered_notice_write(uuid,uuid,uuid)', 'school_answered_notice()') THEN NULL ELSE 'scrbrd_app:EXECUTE' END;
    SELECT string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',')
      INTO v FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = r::regprocedure AND x.grantee <> p.proowner;
    IF v IS DISTINCT FROM want THEN
      RAISE EXCEPTION 'db/161: % is granted % (wanted %)', r, coalesce(v, '(nothing)'), coalesce(want, '(nothing)');
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM api_role_reach('public') x WHERE x ~ '(school_answered_|school_answer_subject_is_mine|guardian_link_verify)') THEN
    RAISE EXCEPTION 'db/161: PUBLIC reaches the notice''s functions';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
       AND EXISTS (SELECT 1 FROM api_role_reach(r::name) x WHERE x ~ '(school_answered_|school_answer_subject_is_mine|guardian_link_verify)') THEN
      RAISE EXCEPTION 'db/161: % reaches the notice''s functions', r;
    END IF;
  END LOOP;

  -- The words: one title, the answer in neither.
  IF (school_answered_words('X')).title IS DISTINCT FROM 'The school has answered your request'
     OR (school_answered_words('X')).body ~* '\m(granted|declined|approved|refused|verified|yes|no)\M' THEN
    RAISE EXCEPTION 'db/161: the notice''s words say the answer, or changed';
  END IF;

  -- The trigger, on the answer only, for a guardian's request only.
  SELECT pg_get_triggerdef(t.oid) INTO v FROM pg_trigger t
   WHERE t.tgrelid = 'role_request'::regclass AND t.tgname = 'role_request_answered_notice' AND NOT t.tgisinternal;
  IF v IS NULL OR v !~ 'AFTER UPDATE OF state ON public\.role_request'
     OR v !~ $re$\(\(old\.state = 'pending'::text\) AND \(new\.state = ANY \(ARRAY\['granted'::text, 'declined'::text\]\)\) AND \(new\.role = 'guardian'::text\)\)$re$ THEN
    RAISE EXCEPTION 'db/161: role_request_answered_notice is %', coalesce(v, '(missing)');
  END IF;

  -- The verify door writes the notice, and db/08's body is otherwise intact.
  SELECT prosrc INTO v FROM pg_proc WHERE oid = 'guardian_link_verify(uuid,uuid,text,text)'::regprocedure;
  IF position('school_answered_notice_write(p_guardian, v_school, v_link)' IN v) = 0
     OR position('self_verified' IN v) = 0 OR position('no_pending_link' IN v) = 0 THEN
    RAISE EXCEPTION 'db/161: guardian_link_verify() is not this file''s';
  END IF;

  -- The door: one permissive SELECT policy, the caller's own answered notice.
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v FROM pg_policy p
   WHERE p.polrelid = 'notification'::regclass AND p.polname = 'notification_answered' AND p.polpermissive AND p.polcmd = 'r';
  IF v IS NULL OR v !~ 'recipient_id = app_user_id\(\)' OR v !~ 'school_answer_subject_is_mine\(subject_id\)' THEN
    RAISE EXCEPTION 'db/161: notification_answered is %', coalesce(v, '(missing)');
  END IF;

  -- Signed out, the door answers nothing.
  IF nullif(current_setting('app.user_id', true), '') IS NULL
     AND school_answer_subject_is_mine(gen_random_uuid()) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'db/161: signed out, the read door answered';
  END IF;
END $check$;

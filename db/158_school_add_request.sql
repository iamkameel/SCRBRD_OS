-- ==================================================================
--  158 - "Ask SCRBRD to add my school" (EXPERIENCE_PASS Q22)
-- ==================================================================
--
-- HAND-WRITTEN. The design is docs/redesign/EXPERIENCE_PASS.md section 2.7 ("A school
-- not on SCRBRD") and section 5 Q22, decided by Kameel on 13 Nov 2026 as
-- recommended: "a short note (the school, its town, the person's job)
-- answered by a person, and a match to score meanwhile". Slice 3's Migration
-- row, item (2): "a row with the school's name, town and the person's job,
-- read by the platform alone". Its proof is db/99 section 136; the screens are
-- apps/web/src/auth/schoolAsk.jsx (the note, and the asker's own rows under
-- "Your requests") and apps/web/src/views/schoolRequests.jsx (the platform's
-- list); the route is POST /api/school-requests (services/api/write/
-- requests-api.mjs).
--
-- -- 1 - WHAT A REQUEST IS -----------------------------------------
-- Any signed-in account whose school is not in the join list writes three
-- things: the school's name, its town, and what they do there, chosen from a
-- short list (no free text beyond the two names, each at most 80 characters,
-- so there is little room to type anything about a child into them). The row records who asked
-- (app_user_id()) and when. The platform (platform.tenant.manage: superadmin
-- and platformadmin, no school) reads it and answers it: "added" or
-- "declined", with who decided and when.
--
-- IT CREATES NO SCHOOL AND LINKS NOBODY. Answering "added" writes the answer
-- and nothing else: a person on the platform adds the school by the existing
-- path (a school row and its first office account, enrolled with a code,
-- section 2.7), and the asker then joins it from the join list like anybody else,
-- through a role_request a person at the school decides.
--
-- -- 2 - WHO MAY ASK -----------------------------------------------
-- Any signed-in account (Kameel, 15 Nov 2026, "schoolreq-who: any-account"):
-- one with no school, and one already at a school asking for another. Never
-- under a pad's credential. A platform administrator may ask too, and never
-- answers her own (section 5, own_request). Refusals, each a code the route turns
-- into words:
--   not_signed_in   no app_user_id(), a pad's credential, or a disabled account
--   ask_a_teacher   a pupil's account (a live player or selfaccess role):
--                   "A pupil's account may not ask; it is told to ask a
--                   teacher" (Kameel, 15 Nov 2026, "schoolreq-pupil"), so a
--                   pupil's name never reaches the platform's list
--   name_required   the school's name, 2 to 80 characters after trimming,
--                   with two letters or digits at least, and no control,
--                   zero-width or bidi character (a name that reads blank or
--                   backwards in the platform's list is refused)
--   town_required   the town, 2 to 80, by the same rule
-- Spaces, the no-break ones included, are folded to one before the test.
--   job_invalid     not one of the list below
--   already_asked   an open request of theirs names this school and town
--   too_many_open   THE CAP: three open requests per account at once
-- An open request counts against the cap until it is answered or lapses.
-- The cap and the duplicate test are taken under a per-account advisory
-- lock, so two taps at once cannot both pass it.
--
-- -- 3 - RETENTION (docs/design/ACCOUNT_LIFECYCLE.md section 6.2) ----------
-- The rule is section 6.2's "sessions, codes, claims" row, the one for a person's
-- pending ask that a person answers: a pending claim is kept ninety days and
-- is then expired. So an open request ninety days old reads "lapsed"
-- (school_add_request_shown()), no longer counts against the cap, and can no
-- longer be answered; the asker may ask again. Nothing runs on a clock
-- (ACCOUNT_LIFECYCLE section 6.5, db/62's rule): the state is read, not written.
-- The rows themselves go with the account, as section 6.2's "sign-ins" row does:
-- ON DELETE CASCADE from app_user here, and the account's erasure
-- (account_erase(), SCRBRD-140 section 3.8, ACCOUNT_LIFECYCLE section 6.3, not built yet)
-- must delete them with its auth_identity rows.
--
-- AN ANSWERED REQUEST (Kameel, 15 Nov 2026, "schoolreq-keep:
-- 90d-after-answer"; ACCOUNT_LIFECYCLE section 6.2): "An answered request to add a
-- school is deleted 90 days after the answer." Nothing runs on a clock here
-- either, as lifts' purge is a person's act (db/76 lift_purge()). So, as
-- the lapse is: ninety days after decided_at the row is unreadable (the read
-- policy and school_add_requester() both cut it), and
-- school_add_request_purge(), the owner's alone, deletes every row past the
-- cut and answers how many.
--
-- AN UNANSWERED REQUEST (Kameel, 15 Nov 2026, "schoolreq-lapsed:
-- 90d-after-lapse"; ACCOUNT_LIFECYCLE section 6.2): "An unanswered request
-- lapses after 90 days and is deleted 90 days after it lapses." So an open
-- row is unreadable 180 days after requested_at, by the same two cuts, and
-- the same purge deletes it.
--
-- THE PURGE (Kameel, 15 Nov 2026, "schoolreq-purge: lead-monthly";
-- DEPLOYING.md): the lead runs it monthly, with the paste routine, and logs
-- each run on the Build Board.
--
-- -- 4 - WHO READS -------------------------------------------------
-- RLS, one permissive policy: the asker's own rows (person_id =
-- app_user_id()), so "Your requests" can show them, and the platform's
-- (app_holds('platform.tenant.manage'), a platform-only capability, so only
-- an assignment that belongs to no school carries it). db/50's RESTRICTIVE
-- pad guard on the read. Nobody else: not a school's office, not another
-- account. The application holds SELECT and nothing else on the table; no
-- policy admits a write, and every write is one of the two definers below.
-- Who asked is read through school_add_requester(), for the asker and the
-- platform alone (role_requester()'s shape, db/81): an asker's app_user row
-- is not the platform's to read under RLS.
--
-- HAND-WRITTEN, NOT GENERATED. packages/policy/src/tables.mjs and
-- services/api/rls/generate-rls.mjs (TABLES_ADDED_SINCE_09) generate the
-- policies of a table anchored at a school and governed by app_can() at it.
-- This one belongs to no school: it is governed by identity (the asker's own
-- rows) and a platform-only capability, as notification_pref (db/120),
-- school_register (db/92) and pending_claim (db/81) are, and like them its
-- policy is written here and named in neither file. db/01 and db/09 do not
-- move.
--
-- -- 5 - NOT PUBLIC'S, AND NOT A MANAGED HOST'S (db/157) ----------
-- Every function here: REVOKE ALL FROM PUBLIC, then GRANT EXECUTE TO
-- scrbrd_app by name, but the purge, which is the owner's alone. The table: no grant to PUBLIC, anon, authenticated or
-- service_role, taken back by name where those roles exist. The check at the
-- foot reads every ACL with aclexplode() and db/157's api_role_reach().
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   table      + school_add_request (empty): RLS on, one read policy and
--                db/50's pad guard on it; SELECT for the application and
--                nothing else
--   functions  + school_add_request_shown(text, timestamptz)   the state as read
--              + school_add_request_ask(text, text, text)      the asker's door
--              + school_add_request_decide(uuid, text)         the platform's door
--              + school_add_requester(uuid)                    who asked
--              + school_add_request_purge()     answered rows past ninety days,
--                                               deleted; the owner's alone
-- No other table, column, row, policy or grant moves. No BEGIN or COMMIT; a
-- second paste changes nothing.
--
-- SCHEMA FIRST. The API built with it serves POST /api/school-requests,
-- POST /api/school-requests/:id/decide and GET /api/read/school_add_requests;
-- the file is in services/api/expected-migrations.json, so that API refuses
-- to start against a database without it.
--
-- search_path pinned on every function (db/16).


-- -- 0 - What this file stands on ----------------------------------
DO $guard$
BEGIN
  IF to_regprocedure('app_user_id()') IS NULL
     OR to_regprocedure('app_holds(text)') IS NULL
     OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('sa_today()') IS NULL
     OR to_regprocedure('pad_scope_guard_install(regclass)') IS NULL THEN
    RAISE EXCEPTION 'db/158: app_user_id(), app_holds(), app_pad_scoped(), sa_today() or pad_scope_guard_install() is missing; apply db/01 to db/157 first';
  END IF;
  -- db/157's probe: the check at the foot proves nothing here is PUBLIC's
  -- or a managed host's API role's with it.
  IF to_regprocedure('api_role_reach(name)') IS NULL THEN
    RAISE EXCEPTION 'db/158: api_role_reach() is missing; apply db/157 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM capability WHERE name = 'platform.tenant.manage' AND platform_only) THEN
    RAISE EXCEPTION 'db/158: platform.tenant.manage is not a platform-only capability';
  END IF;
END $guard$;


-- -- 1 - The table -------------------------------------------------
-- Under a lock_timeout: the foreign keys take a lock on app_user for the one
-- statement. A paste that is not granted it in ten seconds stops and changes
-- nothing: paste it again.
DO $table$
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
  CREATE TABLE IF NOT EXISTS school_add_request (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    school_name  text NOT NULL,
    town         text NOT NULL,
    -- What the asker does at the school. A list, not free text: the
    -- screen's words for it are apps/web/src/lib/schoolAsk.js JOBS.
    job          text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    -- The platform's answer. "lapsed" is read, never written (header section 3).
    state        text NOT NULL DEFAULT 'open',
    decided_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
    decided_at   timestamptz,
    CONSTRAINT school_add_request_state CHECK (state IN ('open', 'added', 'declined')),
    CONSTRAINT school_add_request_job CHECK (job IN ('coach', 'teacher', 'sport', 'office', 'head', 'parent', 'other')),
    CONSTRAINT school_add_request_name CHECK (char_length(school_name) BETWEEN 2 AND 80 AND school_name = btrim(school_name)),
    CONSTRAINT school_add_request_town CHECK (char_length(town) BETWEEN 2 AND 80 AND town = btrim(town)),
    CONSTRAINT school_add_request_decided CHECK ((state = 'open') = (decided_at IS NULL))
  );
END $table$;
CREATE INDEX IF NOT EXISTS school_add_request_person_idx ON school_add_request (person_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS school_add_request_open_idx ON school_add_request (requested_at) WHERE state = 'open';

COMMENT ON TABLE school_add_request IS
  'EXPERIENCE_PASS Q22 (db/158): a signed-in account asking SCRBRD to add a school: name, town, job. Read by the asker and the platform (platform.tenant.manage) alone; written only by school_add_request_ask() and school_add_request_decide(). Creates no school and links nobody.';


-- -- 2 - Read by the asker and the platform alone ------------------
-- Made only where missing, so a second paste leaves the catalogue exactly as
-- it was (a policy dropped and made again is a new row); the check at the
-- foot refuses one that reads anything else.
ALTER TABLE school_add_request ENABLE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'school_add_request'::regclass AND polname = 'school_add_request_read') THEN
    CREATE POLICY school_add_request_read ON school_add_request
      FOR SELECT USING ((person_id = app_user_id() OR app_holds('platform.tenant.manage'))
                        AND ((decided_at IS NULL AND requested_at > now() - interval '180 days')
                             OR decided_at > now() - interval '90 days'));
  END IF;
  -- db/50's RESTRICTIVE pad guard, on the one command a policy admits.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'school_add_request'::regclass AND polname = 'pad_scope_select') THEN
    PERFORM pad_scope_guard_install('school_add_request'::regclass);
  END IF;
END $policies$;

-- The application reads; it writes nothing but through the two definers.
-- Said here rather than left to db/06's default privileges, so a later
-- default cannot widen it.
REVOKE ALL ON school_add_request FROM PUBLIC;
REVOKE ALL ON school_add_request FROM scrbrd_app;
GRANT SELECT ON school_add_request TO scrbrd_app;


-- -- 3 - The state as read (header section 3) -----------------------------
-- An open request ninety days old has lapsed: it is shown so, no longer
-- counts against the cap and can no longer be answered. The cap, the
-- decision and the reads all ask this, so they cannot disagree.
CREATE OR REPLACE FUNCTION school_add_request_shown(p_state text, p_requested_at timestamptz) RETURNS text AS $$
  SELECT CASE WHEN p_state = 'open' AND p_requested_at <= now() - interval '90 days' THEN 'lapsed' ELSE p_state END
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION school_add_request_shown(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION school_add_request_shown(text, timestamptz) TO scrbrd_app;


-- -- 4 - The asker's door (header section 2) ------------------------------
CREATE OR REPLACE FUNCTION school_add_request_ask(p_school text, p_town text, p_job text)
RETURNS TABLE (ok boolean, reason text, request_id uuid) AS $$
DECLARE
  v_me     uuid := app_user_id();
  -- Every run of spaces, the no-break ones (U+00A0, U+2007, U+202F) too, is one space.
  v_school text := btrim(regexp_replace(coalesce(p_school, ''), '[\s\u00A0\u2007\u202F]+', ' ', 'g'));
  v_town   text := btrim(regexp_replace(coalesce(p_town, ''), '[\s\u00A0\u2007\u202F]+', ' ', 'g'));
  -- What a name may not hold: a control character, a soft hyphen, or a
  -- zero-width, joiner, bidi embedding, override or isolate, or a byte-order
  -- mark (U+200B-U+200F, U+202A-U+202E, U+2060-U+2064, U+2066-U+2069, U+FEFF).
  v_unseen text := '[[:cntrl:]\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]';
  v_id     uuid;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() OR NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = v_me AND u.active) THEN
    RETURN QUERY SELECT false, 'not_signed_in'::text, NULL::uuid; RETURN;
  END IF;
  -- A pupil's account: a live player or selfaccess role, by the liveness
  -- sessionProfile() reads. A paused one still counts.
  IF EXISTS (SELECT 1 FROM role_assignment a
              WHERE a.person_id = v_me AND a.active AND a.role IN ('player', 'selfaccess')
                AND (a.valid_from  IS NULL OR a.valid_from  <= sa_today())
                AND (a.valid_until IS NULL OR a.valid_until >  sa_today())
                AND (a.expires_at  IS NULL OR a.expires_at  >  now())) THEN
    RETURN QUERY SELECT false, 'ask_a_teacher'::text, NULL::uuid; RETURN;
  END IF;
  IF char_length(v_school) NOT BETWEEN 2 AND 80 OR v_school ~ v_unseen
     OR v_school !~ '[[:alnum:]].*[[:alnum:]]' THEN
    RETURN QUERY SELECT false, 'name_required'::text, NULL::uuid; RETURN;
  END IF;
  IF char_length(v_town) NOT BETWEEN 2 AND 80 OR v_town ~ v_unseen
     OR v_town !~ '[[:alnum:]].*[[:alnum:]]' THEN
    RETURN QUERY SELECT false, 'town_required'::text, NULL::uuid; RETURN;
  END IF;
  IF p_job IS NULL OR p_job NOT IN ('coach', 'teacher', 'sport', 'office', 'head', 'parent', 'other') THEN
    RETURN QUERY SELECT false, 'job_invalid'::text, NULL::uuid; RETURN;
  END IF;

  -- One account's asks, one at a time: the duplicate and the cap below are
  -- read and written under this lock, so two at once cannot both pass.
  PERFORM pg_advisory_xact_lock(hashtext('school_add_request'), hashtext(v_me::text));
  IF EXISTS (SELECT 1 FROM school_add_request r
              WHERE r.person_id = v_me
                AND school_add_request_shown(r.state, r.requested_at) = 'open'
                AND lower(r.school_name) = lower(v_school) AND lower(r.town) = lower(v_town)) THEN
    RETURN QUERY SELECT false, 'already_asked'::text, NULL::uuid; RETURN;
  END IF;
  IF (SELECT count(*) FROM school_add_request r
       WHERE r.person_id = v_me AND school_add_request_shown(r.state, r.requested_at) = 'open') >= 3 THEN
    RETURN QUERY SELECT false, 'too_many_open'::text, NULL::uuid; RETURN;
  END IF;

  INSERT INTO school_add_request (person_id, school_name, town, job)
  VALUES (v_me, v_school, v_town, p_job)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION school_add_request_ask(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION school_add_request_ask(text, text, text) TO scrbrd_app;


-- -- 5 - The platform's door ---------------------------------------
-- "added" or "declined", once, on an open request that has not lapsed, by a
-- holder of platform.tenant.manage (app_holds() refuses a pad's credential),
-- never on their own request. It writes the answer, who gave it and when, and nothing else: no school,
-- no role, no link (header section 1).
CREATE OR REPLACE FUNCTION school_add_request_decide(p_request uuid, p_state text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me uuid := app_user_id();
  r    school_add_request;
BEGIN
  -- A disabled account answers nothing: app_holds() reads the assignment,
  -- not the account (ACCOUNT_LIFECYCLE: disabling keeps the roles).
  IF v_me IS NULL OR NOT app_holds('platform.tenant.manage')
     OR NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = v_me AND u.active) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('added', 'declined') THEN
    RETURN QUERY SELECT false, 'state_invalid'::text; RETURN;
  END IF;
  SELECT * INTO r FROM school_add_request WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_such_request'::text; RETURN;
  END IF;
  -- Nobody answers their own: an asker made a platform administrator before
  -- the answer came does not decide it (separation of duties).
  IF r.person_id = v_me THEN
    RETURN QUERY SELECT false, 'own_request'::text; RETURN;
  END IF;
  IF r.state <> 'open' THEN
    RETURN QUERY SELECT false, 'already_decided'::text; RETURN;
  END IF;
  IF school_add_request_shown(r.state, r.requested_at) = 'lapsed' THEN
    RETURN QUERY SELECT false, 'lapsed'::text; RETURN;
  END IF;
  UPDATE school_add_request SET state = p_state, decided_by = v_me, decided_at = now() WHERE id = p_request;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION school_add_request_decide(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION school_add_request_decide(uuid, text) TO scrbrd_app;


-- -- 6 - Who asked: for the asker and the platform alone -----------
CREATE OR REPLACE FUNCTION school_add_requester(p_request uuid)
RETURNS TABLE (name text, email text) AS $$
  SELECT u.name, u.email
    FROM school_add_request r JOIN app_user u ON u.id = r.person_id
   WHERE r.id = p_request AND NOT app_pad_scoped()
     AND (r.person_id = app_user_id() OR app_holds('platform.tenant.manage'))
     AND ((r.decided_at IS NULL AND r.requested_at > now() - interval '180 days')
          OR r.decided_at > now() - interval '90 days')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION school_add_requester(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION school_add_requester(uuid) TO scrbrd_app;


-- -- 6b - The answered rows' end (header section 3): the owner's alone -----
-- Deletes every answered request ninety days past its answer, and every
-- unanswered one ninety days past its lapse (180 days after it was asked),
-- and answers how many.
-- Run by the owner, as SELECT school_add_request_purge(); nothing calls it on
-- a clock, and the application may not.
CREATE OR REPLACE FUNCTION school_add_request_purge() RETURNS integer AS $$
DECLARE n integer;
BEGIN
  DELETE FROM school_add_request
   WHERE (decided_at IS NOT NULL AND decided_at <= now() - interval '90 days')
      OR (decided_at IS NULL AND requested_at <= now() - interval '180 days');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION school_add_request_purge() FROM PUBLIC;
REVOKE ALL ON FUNCTION school_add_request_purge() FROM scrbrd_app;


-- -- 7 - Not a managed host's API roles (db/157) -------------------
DO $revoke_api_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF to_regrole(r) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON school_add_request FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION school_add_request_shown(text, timestamptz) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION school_add_request_ask(text, text, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION school_add_request_decide(uuid, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION school_add_requester(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION school_add_request_purge() FROM %I', r);
    END IF;
  END LOOP;
END $revoke_api_roles$;


-- -- Refuse to commit a file that did not do what it says -----------
DO $check$
DECLARE
  v_n   int;
  v_q   text;
  v_unseen text;
  v_fold   text;
  v     text;
  f     text;
  fns   text[] := ARRAY['school_add_request_shown(text,timestamp with time zone)',
                        'school_add_request_ask(text,text,text)',
                        'school_add_request_decide(uuid,text)',
                        'school_add_requester(uuid)'];
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'school_add_request'::regclass) THEN
    RAISE EXCEPTION 'db/158: row security is off on school_add_request';
  END IF;
  -- One permissive policy, the read, and it reads the asker's own and the platform's.
  SELECT count(*) INTO v_n FROM pg_policy p WHERE p.polrelid = 'school_add_request'::regclass AND p.polpermissive;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'db/158: school_add_request has % permissive policies, not one', v_n;
  END IF;
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_q FROM pg_policy p
   WHERE p.polrelid = 'school_add_request'::regclass AND p.polname = 'school_add_request_read' AND p.polcmd = 'r' AND p.polpermissive;
  IF v_q IS DISTINCT FROM '(((person_id = app_user_id()) OR app_holds(''platform.tenant.manage''::text)) AND ((decided_at IS NULL) OR (decided_at > (now() - ''90 days''::interval))))' THEN
    RAISE EXCEPTION 'db/158: school_add_request_read reads %', coalesce(v_q, '(missing)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = 'school_add_request'::regclass AND NOT p.polpermissive
                    AND p.polname = 'pad_scope_select' AND p.polcmd = 'r'
                    AND pg_get_expr(p.polqual, p.polrelid) ~ '^\(?NOT app_pad_scoped\(\)\)?$') THEN
    RAISE EXCEPTION 'db/158: school_add_request has no pad guard on its read (db/50)';
  END IF;

  -- The table's ACL, read entry by entry: its owner, and the application's
  -- SELECT, and nobody and nothing else.
  SELECT string_agg(coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type, ', ') INTO v
    FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   WHERE c.oid = 'school_add_request'::regclass
     AND a.grantee <> c.relowner
     AND NOT (a.grantee = 'scrbrd_app'::regrole AND a.privilege_type = 'SELECT');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/158: school_add_request grants %', v;
  END IF;
  IF NOT has_table_privilege('scrbrd_app', 'school_add_request', 'SELECT') THEN
    RAISE EXCEPTION 'db/158: the application cannot read school_add_request';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute t, aclexplode(t.attacl) a
              WHERE t.attrelid = 'school_add_request'::regclass AND t.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'db/158: a column of school_add_request carries a grant of its own';
  END IF;

  -- Each function's ACL: its owner, and the application's EXECUTE, and
  -- nobody else; the search_path pinned; the three doors definers.
  FOREACH f IN ARRAY fns LOOP
    SELECT string_agg(coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type, ', ') INTO v
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = f::regprocedure
       AND a.grantee <> p.proowner
       AND NOT (a.grantee = 'scrbrd_app'::regrole AND a.privilege_type = 'EXECUTE');
    IF v IS NOT NULL THEN
      RAISE EXCEPTION 'db/158: % grants %', f, v;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/158: the application cannot call %', f;
    END IF;
    IF NOT ('search_path=pg_catalog, public, pg_temp' = ANY (coalesce((SELECT proconfig FROM pg_proc WHERE oid = f::regprocedure), '{}'))) THEN
      RAISE EXCEPTION 'db/158: % has no pinned search_path', f;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE prosecdef
        AND oid IN ('school_add_request_ask(text,text,text)'::regprocedure,
                    'school_add_request_decide(uuid,text)'::regprocedure,
                    'school_add_requester(uuid)'::regprocedure)) <> 3 THEN
    RAISE EXCEPTION 'db/158: a door is not SECURITY DEFINER';
  END IF;
  -- The purge: the owner's alone, by every grantee in its ACL; pinned; not a definer.
  SELECT string_agg(coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type, ', ') INTO v
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid = 'school_add_request_purge()'::regprocedure AND a.grantee <> p.proowner;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/158: school_add_request_purge() grants %', v;
  END IF;
  IF (SELECT prosecdef OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}')))
        FROM pg_proc WHERE oid = 'school_add_request_purge()'::regprocedure) THEN
    RAISE EXCEPTION 'db/158: school_add_request_purge() is a definer or has no pinned search_path';
  END IF;

  -- The two patterns as they were pasted, read out of the ask's own body and
  -- run: a paste that lost or changed a character (a clipboard, a web
  -- console) is refused here rather than at the first ask. A zero-width
  -- space (chr(8203)) and a right-to-left override (chr(8238)) are hidden;
  -- "Hoerskool" with its e-diaeresis (chr(235)) and a plain name are not;
  -- no-break spaces (chr(160), chr(8239)) fold to one space and trim.
  SELECT substring(prosrc FROM 'v_unseen text := ''([^'']*)'''),
         substring(prosrc FROM 'v_school text := btrim\(regexp_replace\(coalesce\(p_school, ''''\), ''([^'']*)''')
    INTO v_unseen, v_fold
    FROM pg_proc WHERE oid = 'school_add_request_ask(text,text,text)'::regprocedure;
  IF v_unseen IS NULL OR v_fold IS NULL
     OR NOT ('Verify' || chr(8203) || 'High') ~ v_unseen
     OR NOT ('Verify ' || chr(8238) || 'loohcS') ~ v_unseen
     OR ('Ho' || chr(235) || 'rskool ' || chr(203) || 'landskraal') ~ v_unseen
     OR 'Verify High' ~ v_unseen
     OR btrim(regexp_replace(chr(160) || ' Verify' || chr(160) || chr(160) || 'High' || chr(8239), v_fold, ' ', 'g')) <> 'Verify High'
     OR btrim(regexp_replace('Verify' || chr(9) || 'High', v_fold, ' ', 'g')) <> 'Verify High' THEN
    RAISE EXCEPTION 'db/158: the ask''s hidden-character or space-folding pattern does not do what it says (unseen %, fold %)',
      coalesce(v_unseen, '(missing)'), coalesce(v_fold, '(missing)');
  END IF;
  IF ('Ho' || chr(235) || 'rskool') !~ '[[:alnum:]].*[[:alnum:]]' THEN
    RAISE EXCEPTION 'db/158: the two-letters test refuses an accented name';
  END IF;

  -- And as db/157 reads reach: nothing of this file's for PUBLIC, nor for a
  -- managed host's API roles where they exist.
  SELECT string_agg(g || ': ' || x, '; ') INTO v
    FROM unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) g
   CROSS JOIN LATERAL api_role_reach(g::name) x
   WHERE (g = 'public' OR to_regrole(g) IS NOT NULL)
     AND (x ~ '(^|[ .])school_add_request' OR x ~ 'school_add_requester');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/158: reached beyond the application: %', v;
  END IF;
END $check$;

-- ══════════════════════════════════════════════════════════════════
--  160 · The follow list: the schools whose public matches lead a
--        person's Today (EXPERIENCE_PASS Q8, slice 3b)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/redesign/EXPERIENCE_PASS.md §1.9, §2.2,
-- §2.4, §3.8, Q8 (decided 13 Nov 2026, as recommended) and the slice's
-- Migration row, item (3): "a row per account and school, read and written
-- by its owner alone (RLS on app_user_id()), holding nothing but the two ids
-- and a date; it grants no read, and the Today it feeds reads only
-- public_live_fixtures() filtered by it."
--
-- WHAT FOLLOWING IS, AND IS NOT. A personal list of schools whose PUBLIC
-- matches lead this account's Today. No role, no office step, no new read:
-- a follower sees what a stranger with the link sees. The Today is the
-- public read (public_live_fixtures(), unaware of accounts) filtered in the
-- API to the schools on the caller's own list (services/api/write/
-- follow-api.mjs); a school that stops listing, or a fixture it withdraws,
-- leaves it at once because it leaves the public read. Nothing is pushed
-- (Q23 waits for push delivery).
--
-- WHO READS A LIST: its owner, and nobody else. Not the school followed,
-- not the office, not the platform: no capability arm, no definer that
-- answers about another account. A pupil's account may follow too, and the
-- list says nothing about him to anyone. It is never public (packages/
-- policy/src/public.mjs NEVER_PUBLIC, the whole table).
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   + followed_school (person_id, school_id, followed_on)  the list. The
--       name is neither db/112's follows_side nor db/123's
--       notice_follows_side, nor the "follower" kind of the join form
--       (lib/joinSchool.js), which is a request for the spectator role.
--       RLS on: SELECT and DELETE of the caller's own rows (person_id =
--       app_user_id()), and db/50's RESTRICTIVE pad guards on both, so a
--       pad's resume credential reads and removes nothing. No INSERT or
--       UPDATE for the application: a follow is made by follow_school(),
--       which stamps the day and checks the school. The application holds
--       SELECT and DELETE and nothing else; PUBLIC and a managed host's
--       anon, authenticated and service_role hold nothing.
--   + follow_school(text, boolean)  the door: follow (true) or stop
--       following (false) the school with that code, as the caller. A
--       definer (it reads school past the caller's row security: an account
--       with no school reads no school row), search_path pinned; refuses
--       with no session or under a pad's credential; refuses an archived or
--       unknown school with one answer; at most 50 schools a person. Answers
--       the school's id and name, which public_schools() already gives
--       anybody signed in.
--   + followed_schools()  the caller's own list with each school's code and
--       name, for the screens and for the API's filter (the public match
--       header names a side's school by its code). A definer for the same
--       reason; the caller's rows only, nothing under a pad.
--   Both functions: REVOKE ALL FROM PUBLIC, GRANT EXECUTE TO scrbrd_app by
--   name, revoked from the three API roles (db/157's rule).
--
-- RETENTION (ACCOUNT_LIFECYCLE §6.2, the row this file adds there): with
-- the account. A row goes when its app_user row is deleted (ON DELETE
-- CASCADE), and account_erase() (SCRBRD-140 §3.8, not built yet) deletes
-- the account's rows with its sign-ins; a school's removal removes its rows
-- too. Disabling an account keeps the list, as it keeps everything else, so
-- re-enabling gives it back.
--
-- RLS: hand-written, as every owner-only table since db/01 is
-- (notification_pref, db/120; device_push_token, db/08): such a table is
-- not in packages/policy/src/tables.mjs, whose capability rules db/09 and
-- TABLES_ADDED_SINCE_09 (services/api/rls/generate-rls.mjs) generate, so
-- db/01 and db/09 stay as they shipped.
--
-- No other table, column, row, policy or grant moves. Safe to run twice: a
-- second paste changes nothing. One transaction (the paste runs the file
-- inside one; no BEGIN or COMMIT here). Its proof is db/99 §137; the walks
-- are browser-first-run and smoke-public.


-- ── 0 · What this file stands on ──────────────────────────────────
DO $guard$
BEGIN
  IF to_regprocedure('app_user_id()') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('pad_scope_guard_install(regclass)') IS NULL OR to_regprocedure('sa_today()') IS NULL
     OR to_regprocedure('api_role_reach(name)') IS NULL OR to_regprocedure('public_live_fixtures()') IS NULL THEN
    RAISE EXCEPTION 'db/160: app_user_id() (db/01), app_pad_scoped() or pad_scope_guard_install() (db/50), sa_today() (db/128), api_role_reach() (db/157) or public_live_fixtures() (db/82) is missing; apply them first';
  END IF;
END $guard$;


-- ── 1 · The list ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS followed_school (
  person_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  followed_on date NOT NULL DEFAULT sa_today(),
  PRIMARY KEY (person_id, school_id)
);
CREATE INDEX IF NOT EXISTS followed_school_school_idx ON followed_school (school_id);

COMMENT ON TABLE followed_school IS
  'EXPERIENCE_PASS Q8 (db/160): the schools whose public matches lead this account''s Today. Its owner''s alone; never public; removed with the account.';


-- ── 2 · Its owner's alone ─────────────────────────────────────────
ALTER TABLE followed_school ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS followed_school_read ON followed_school;
CREATE POLICY followed_school_read ON followed_school
  FOR SELECT USING (person_id = app_user_id());

DROP POLICY IF EXISTS followed_school_delete ON followed_school;
CREATE POLICY followed_school_delete ON followed_school
  FOR DELETE USING (person_id = app_user_id());

-- Closed to a pad's resume credential, as every table behind RLS since db/50.
SELECT pad_scope_guard_install('followed_school'::regclass) AS pad_guards;

-- db/06's default privileges gave the application SELECT, INSERT and UPDATE.
-- A follow is made through follow_school() alone; a row never changes.
REVOKE ALL ON followed_school FROM PUBLIC;
REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON followed_school FROM scrbrd_app;
GRANT SELECT, DELETE ON followed_school TO scrbrd_app;


-- ── 3 · The door ──────────────────────────────────────────────────
/**
 * Follow (p_on true) or stop following (false) the school whose code is
 * p_code, as the caller. One answer for a code that names no school and for
 * an archived one. At most 50 schools a person (too_many); following a
 * school already followed, or stopping one not followed, changes nothing
 * and answers ok.
 */
CREATE OR REPLACE FUNCTION follow_school(p_code text, p_on boolean)
RETURNS TABLE (ok boolean, reason text, school_id uuid, school_name text) AS $$
DECLARE
  v_me     uuid := app_user_id();
  v_school uuid;
  v_name   text;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() THEN
    RETURN QUERY SELECT false, 'not_signed_in', NULL::uuid, NULL::text; RETURN;
  END IF;
  IF p_on IS NULL THEN RETURN QUERY SELECT false, 'no_answer', NULL::uuid, NULL::text; RETURN; END IF;
  SELECT s.id, s.name INTO v_school, v_name
    FROM school s WHERE s.code = btrim(coalesce(p_code, '')) AND s.archived_at IS NULL;
  IF v_school IS NULL THEN
    RETURN QUERY SELECT false, 'no_such_school', NULL::uuid, NULL::text; RETURN;
  END IF;
  IF p_on THEN
    -- Serialise one person's follows, so two at once cannot pass the limit.
    PERFORM pg_advisory_xact_lock(hashtextextended('followed_school:' || v_me::text, 0));
    IF NOT EXISTS (SELECT 1 FROM followed_school f WHERE f.person_id = v_me AND f.school_id = v_school)
       AND (SELECT count(*) FROM followed_school f WHERE f.person_id = v_me) >= 50 THEN
      RETURN QUERY SELECT false, 'too_many', NULL::uuid, NULL::text; RETURN;
    END IF;
    INSERT INTO followed_school (person_id, school_id, followed_on) VALUES (v_me, v_school, sa_today())
    ON CONFLICT ON CONSTRAINT followed_school_pkey DO NOTHING;
  ELSE
    DELETE FROM followed_school f WHERE f.person_id = v_me AND f.school_id = v_school;
  END IF;
  RETURN QUERY SELECT true, NULL::text, v_school, v_name;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The caller's own list: each school's id, code and name, and the day. */
CREATE OR REPLACE FUNCTION followed_schools()
RETURNS TABLE (school_id uuid, code text, name text, followed_on date) AS $$
  SELECT f.school_id, s.code, s.name, f.followed_on
    FROM followed_school f JOIN school s ON s.id = f.school_id
   WHERE f.person_id = app_user_id() AND app_user_id() IS NOT NULL AND NOT app_pad_scoped()
   ORDER BY s.name, f.school_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 4 · Who may call them: the application, and nobody else ───────
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['follow_school(text,boolean)', 'followed_schools()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON followed_school FROM %I', r);
      FOREACH f IN ARRAY ARRAY['follow_school(text,boolean)', 'followed_schools()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── 5 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE v text; n int; r text;
BEGIN
  -- The table: three columns, the two ids and a date, and nothing else.
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum) INTO v
    FROM pg_attribute a WHERE a.attrelid = 'followed_school'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v IS DISTINCT FROM 'person_id uuid, school_id uuid, followed_on date' THEN
    RAISE EXCEPTION 'db/160: followed_school holds %', v;
  END IF;
  -- Removed with the account, and with the school.
  IF (SELECT count(*) FROM pg_constraint c
       WHERE c.conrelid = 'followed_school'::regclass AND c.contype = 'f' AND c.confdeltype = 'c'
         AND c.confrelid IN ('app_user'::regclass, 'school'::regclass)) <> 2 THEN
    RAISE EXCEPTION 'db/160: followed_school is not removed with its account and its school (ON DELETE CASCADE)';
  END IF;

  -- Row security, and exactly two permissive policies, each the owner's.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'followed_school'::regclass) THEN
    RAISE EXCEPTION 'db/160: row security is off on followed_school';
  END IF;
  SELECT string_agg(p.polname || ':' || p.polcmd::text || ':' || pg_get_expr(p.polqual, p.polrelid), ' | ' ORDER BY p.polname) INTO v
    FROM pg_policy p WHERE p.polrelid = 'followed_school'::regclass AND p.polpermissive;
  IF v IS DISTINCT FROM 'followed_school_delete:d:(person_id = app_user_id()) | followed_school_read:r:(person_id = app_user_id())' THEN
    RAISE EXCEPTION 'db/160: followed_school''s permissive policies are %', coalesce(v, '(none)');
  END IF;
  SELECT count(*) INTO n FROM pg_policy p
   WHERE p.polrelid = 'followed_school'::regclass AND NOT p.polpermissive
     AND (p.polname, p.polcmd) IN (('pad_scope_select', 'r'), ('pad_scope_delete', 'd'))
     AND pg_get_expr(p.polqual, p.polrelid) ~ '^\(?NOT app_pad_scoped\(\)\)?$';
  IF n <> 2 OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'followed_school'::regclass AND NOT p.polpermissive) <> 2 THEN
    RAISE EXCEPTION 'db/160: followed_school has % of its two pad guards (db/50), or others', n;
  END IF;

  -- The grants, read from the ACLs: the owner, and scrbrd_app's SELECT and
  -- DELETE; nobody else, PUBLIC included.
  SELECT string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY x.privilege_type)
    INTO v FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
   WHERE c.oid = 'followed_school'::regclass AND x.grantee <> c.relowner;
  IF v IS DISTINCT FROM 'scrbrd_app:DELETE,scrbrd_app:SELECT' THEN
    RAISE EXCEPTION 'db/160: followed_school is granted %', coalesce(v, '(nothing)');
  END IF;
  FOREACH r IN ARRAY ARRAY['follow_school(text,boolean)', 'followed_schools()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = r::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/160: % is not a definer with a pinned search_path', r;
    END IF;
    SELECT string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',')
      INTO v FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = r::regprocedure AND x.grantee <> p.proowner;
    IF v IS DISTINCT FROM 'scrbrd_app:EXECUTE' THEN
      RAISE EXCEPTION 'db/160: % is granted %', r, coalesce(v, '(nothing)');
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM api_role_reach('public') x WHERE x ~ '(followed_school|follow_school|followed_schools)\b') THEN
    RAISE EXCEPTION 'db/160: PUBLIC reaches the follow list or its doors';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
       AND EXISTS (SELECT 1 FROM api_role_reach(r::name) x WHERE x ~ '(followed_school|follow_school|followed_schools)\b') THEN
      RAISE EXCEPTION 'db/160: % reaches the follow list or its doors', r;
    END IF;
  END LOOP;

  -- Signed out, the doors answer nothing and change nothing.
  IF nullif(current_setting('app.user_id', true), '') IS NULL THEN
    IF EXISTS (SELECT 1 FROM followed_schools())
       OR (SELECT f.ok FROM follow_school('HIL', true) f) IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'db/160: signed out, a door answered or wrote';
    END IF;
  END IF;
END $check$;

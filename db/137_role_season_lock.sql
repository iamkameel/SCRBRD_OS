-- ══════════════════════════════════════════════════════════════════
--  137 · An appointment's season is fixed when it is made, and a
--        change to it would be on the record
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The follow-up to db/132 §2 that Kameel approved on 4 Nov
-- 2026 ("do both follow-ups next", the db/132 card): lock a role
-- assignment's season as db/132 locked its fixture and dates.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
--   ~ role_assignment_revoke_only() (db/132)  one guard more, after db/01's
--       re-point guard: role_assignment.season is never changed by an update,
--       from a season to another, to none, or from none to one. Refused,
--       check_violation, "an appointment's season is fixed; end it and
--       appoint again", for every caller, the owner included, as db/01
--       refuses a new person or school. Nothing writes season after insert
--       today (db/27 and db/112 set it on INSERT; no UPDATE of role_assignment
--       in db/08, db/22, db/34, db/57, db/77, db/109 or the API names it), so
--       no path that works now stops working. Every other line is db/132's,
--       patched in place.
--   ~ role_assignment_change_log() (db/132)  'season' joins the four values
--       before and after in was and became; every other line is db/132's.
--   ~ role_assignment_change_logged (db/132)  the AFTER UPDATE trigger also
--       fires when season moves. The guard above means only an owner who has
--       set it aside could move one; if that is ever done, it is one row in
--       role_assignment_change like any other change, by whom and when.
--   audit_log() is not touched: it reads was and became whole.
--
-- ── WHO MAY CALL WHAT ───────────────────────────────────────────────
-- As db/132 left them. role_assignment_revoke_only() is db/01's trigger
-- function, not a definer, its search_path pinned (db/132). The log function
-- is a definer, pinned, callable by nobody (no PUBLIC, no scrbrd_app, none of
-- a managed host's anon, authenticated or service_role). CREATE OR REPLACE
-- keeps both ACLs; the log function's revokes are said again below.
--
-- EXISTING ROWS. Nothing changed or deleted; no table created.
-- Safe to run twice: the bodies are patched only when they are still
-- db/132's (a body already this file's is left), the trigger is CREATE OR
-- REPLACE, and grants end where they began. Nothing is dropped (the paste
-- tool hangs on DROP); the two pg_temp helpers go with the session.
--
-- SCHEMA FIRST. No API change goes with it; it is in
-- services/api/expected-migrations.json. Its proof is db/99 §115.
--
-- THE GUARD keys on pg_proc.prosrc as db/132–db/134 do: the md5 of the live
-- body, its whitespace folded, must be db/132's or this file's.


-- ── 0 · What this file was written against ─────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._v137_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regclass('role_assignment_change') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'role_assignment'::regclass
                       AND attname = 'season' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'db/137: role_assignment.season (db/00) or role_assignment_change (db/132) is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('role_assignment_revoke_only()', '2b5af14563d406167228bac1536505b2', '6fdb65120e00bd3d4781c4476cdcbc42', 'db/132'),
      ('role_assignment_change_log()',  '470e14e8090416a76e48d5df49cadc8d', '81b2f69e42eee1cce41b420587d44f6d', 'db/132'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/137: % (%) is not there to re-create', r.fn, r.src;
    END IF;
    v_md5 := pg_temp._v137_fold(v_src);
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/137: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
END $guard$;

-- One body, one change: `needle` must stand in it exactly `times` times, and
-- each becomes `repl`. Re-emitted through pg_get_functiondef(), so the
-- signature, options and grants stand; a body already this file's is left.
CREATE OR REPLACE FUNCTION pg_temp._v137_patch(p_fn text, p_needle text, p_repl text, p_times integer) RETURNS void AS $$
DECLARE v_src text; v_n integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn::regprocedure;
  IF position(p_repl IN v_src) > 0 THEN RETURN; END IF;
  v_n := (length(v_src) - length(replace(v_src, p_needle, ''))) / length(p_needle);
  IF v_n <> p_times THEN
    RAISE EXCEPTION 'db/137: % holds its needle % times, not %: look before replacing it', p_fn, v_n, p_times;
  END IF;
  EXECUTE replace(pg_get_functiondef(p_fn::regprocedure), p_needle, p_repl);
END $$ LANGUAGE plpgsql;


-- ══════════════════════════════════════════════════════════════════
--  1 · The season is fixed
-- ══════════════════════════════════════════════════════════════════
SELECT pg_temp._v137_patch('role_assignment_revoke_only()',
$n$  -- The provenance is part of the record, not part of the row's editable$n$,
$r$  -- db/137: the season is the appointment too. Next season's coach is a
  -- new appointment, not this one carried over.
  IF NEW.season IS DISTINCT FROM OLD.season THEN
    RAISE EXCEPTION 'an appointment''s season is fixed; end it and appoint again'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The provenance is part of the record, not part of the row's editable$r$, 1);


-- ══════════════════════════════════════════════════════════════════
--  2 · And a change to it is on the record
-- ══════════════════════════════════════════════════════════════════
SELECT pg_temp._v137_patch('role_assignment_change_log()',
$n$'expires', OLD.expires_at)$n$,
$r$'expires', OLD.expires_at, 'season', OLD.season)$r$, 1);
SELECT pg_temp._v137_patch('role_assignment_change_log()',
$n$'expires', NEW.expires_at)$n$,
$r$'expires', NEW.expires_at, 'season', NEW.season)$r$, 1);

CREATE OR REPLACE TRIGGER role_assignment_change_logged AFTER UPDATE ON role_assignment
  FOR EACH ROW WHEN (OLD.fixture_id  IS DISTINCT FROM NEW.fixture_id
                  OR OLD.valid_from  IS DISTINCT FROM NEW.valid_from
                  OR OLD.valid_until IS DISTINCT FROM NEW.valid_until
                  OR OLD.expires_at  IS DISTINCT FROM NEW.expires_at
                  OR OLD.season      IS DISTINCT FROM NEW.season)   -- db/137
  EXECUTE FUNCTION role_assignment_change_log();


-- ══════════════════════════════════════════════════════════════════
--  Who may call what: as db/132 left it
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION role_assignment_change_log() FROM PUBLIC;
  REVOKE ALL ON FUNCTION role_assignment_change_log() FROM scrbrd_app;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION role_assignment_change_log() FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
--  What this file promised, checked in the same paste
-- ══════════════════════════════════════════════════════════════════
-- The behaviour is asserted live in db/99 §115.
DO $check$
DECLARE r text; v_md5 text; v_def text;
BEGIN
  v_md5 := pg_temp._v137_fold((SELECT prosrc FROM pg_proc WHERE oid = 'role_assignment_revoke_only()'::regprocedure));
  IF v_md5 <> '6fdb65120e00bd3d4781c4476cdcbc42' THEN
    RAISE EXCEPTION 'db/137: role_assignment_revoke_only() is not this file''s after the paste (md5 %)', v_md5;
  END IF;
  v_md5 := pg_temp._v137_fold((SELECT prosrc FROM pg_proc WHERE oid = 'role_assignment_change_log()'::regprocedure));
  IF v_md5 <> '81b2f69e42eee1cce41b420587d44f6d' THEN
    RAISE EXCEPTION 'db/137: role_assignment_change_log() is not this file''s after the paste (md5 %)', v_md5;
  END IF;
  -- Pinned as before: the guard as the invoker, the log as its owner.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'role_assignment_revoke_only()'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'role_assignment_change_log()'::regprocedure) THEN
    RAISE EXCEPTION 'db/137: the guard became a definer, or the log stopped being one';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN ('role_assignment_revoke_only()'::regprocedure, 'role_assignment_change_log()'::regprocedure)
                AND NOT ('search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}')))) THEN
    RAISE EXCEPTION 'db/137: the guard or the log does not pin its search_path';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
              WHERE p.oid = 'role_assignment_change_log()'::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'role_assignment_change_log()', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/137: role_assignment_change_log() is callable by PUBLIC or the application';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.rolname = r
                  AND has_function_privilege(ro.oid, 'role_assignment_change_log()'::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/137: role_assignment_change_log() is executable by a managed host''s API role (%)', r;
    END IF;
  END LOOP;
  -- Both triggers stand, enabled, and the log fires on a season.
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'role_assignment'::regclass AND NOT tgisinternal AND tgenabled <> 'D'
        AND tgname IN ('role_assignment_revoke_guard', 'role_assignment_change_logged')) <> 2 THEN
    RAISE EXCEPTION 'db/137: the guard or the log trigger on role_assignment is missing or disabled';
  END IF;
  SELECT pg_get_triggerdef(oid) INTO v_def FROM pg_trigger
   WHERE tgrelid = 'role_assignment'::regclass AND tgname = 'role_assignment_change_logged';
  IF position('old.season IS DISTINCT FROM new.season' IN v_def) = 0 THEN
    RAISE EXCEPTION 'db/137: role_assignment_change_logged does not fire on a season: %', v_def;
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'role_assignment_revoke_only()'::regprocedure) ~* '\mcurrent_date\M'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'role_assignment_change_log()'::regprocedure) ~* '\mcurrent_date\M' THEN
    RAISE EXCEPTION 'db/137: the guard or the log reads the database''s day (db/128)';
  END IF;
END $check$;

-- ══════════════════════════════════════════════════════════════════
--  139 · Every row of the access log written by the owner's key says
--        it was the platform's read
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel, 5 Nov 2026 (the Build Board, the guardian's terms
-- Q6, "as recommended"): the platform owner's key (`superadmin`) reads a
-- child's record outside safeguarding and recognition; log those reads,
-- like every other read of a child's record is logged, rather than word
-- the exception into the terms. ACCESS_REQUESTS §2 already says the key's
-- read "is logged like every other"; PLATFORM_CONTROLS slice 6a is this.
--
-- ── WHAT WAS FOUND ──────────────────────────────────────────────────
-- No early return, capability shortcut or RLS bypass skips the log for the
-- key: log_restricted_read() (db/22) writes for any signed-in caller, and
-- read-api.mjs has logged every platform-wide read since db/20. Two gaps
-- remained, and this file closes the second:
--   1. read-api.mjs filed a platform-wide read whose rows carry no school_id
--      under no school, naming no child (his passport, his availability and
--      readiness, his load, a squad, his honours), so the office asking
--      "who read his record" could not find it. Fixed in the read path
--      (the same commit series), not here.
--   2. Seven definers write access_log with a plain INSERT, not through
--      log_restricted_read(), and leave platform_wide at its default, false
--      (db/63 and db/66 a scorebook page, with both sides' boys' names in
--      handwriting; db/81 an act on a sign-in; db/91, db/93 and db/101
--      safeguarding rows the key cannot reach; db/92 the staff register).
--      The key's read of a scorebook page was written under the school and
--      his own id, but read in the office's log, and in the parent's view
--      INCIDENTS D20 maps from platform_wide, as an ordinary school reader's.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
-- A BEFORE INSERT trigger on access_log stamps platform_wide true when the
-- row is the caller's own read (person_id = app_user_id()) and the caller
-- holds a live platform-wide assignment (app_is_platform_wide(), db/22's
-- liveness rule, the one log_restricted_read() already applies). It only
-- ever turns the stamp on: a row already stamped, a row written about
-- somebody else, and every school reader's row are left exactly as the
-- writer wrote them. Nothing is read or written that was not before; no
-- grant, policy, capability or role changes; the seven definers are not
-- re-created. Rows already written are not touched: the trigger edits a
-- row before it exists, and the log is not rewritten.
--
-- WHAT IT CHANGES ON A LIVE DATABASE (production holds test data only)
--   function access_log_platform_stamp(): new; a pinned SECURITY DEFINER
--     trigger function, executable by nobody but its owner
--   trigger access_log_platform_stamp BEFORE INSERT ON access_log: new
-- No table, column, capability, role or policy. A second paste changes
-- nothing.
--
-- Its proof is db/99 §117: the key's scorebook-page read is stamped, a
-- school reader's is not, and the key's read of a child through
-- log_restricted_read() lands in the office's log naming him.
-- Not to be pasted before it is reviewed.
--
-- THE GUARD keys on pg_proc.prosrc as db/134 does: a function of this name
-- already there must be this file's (the md5 of its body, whitespace folded).


-- ── 0 · Refuse to run against what this file was not written for ───
DO $guard$
DECLARE v_src text; v_md5 text;
BEGIN
  IF to_regclass('access_log') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'access_log'::regclass
                       AND attname = 'platform_wide' AND NOT attisdropped)
     OR to_regprocedure('app_is_platform_wide()') IS NULL
     OR to_regprocedure('app_user_id()') IS NULL THEN
    RAISE EXCEPTION 'db/139: access_log.platform_wide or app_is_platform_wide() (db/20, db/22) is missing; apply them first';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure('access_log_platform_stamp()');
  IF v_src IS NOT NULL THEN
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 <> '8ca03c011e714eff51fb075ddbe87eba' THEN
      RAISE EXCEPTION 'db/139: access_log_platform_stamp() is not this file''s (md5 % of its folded body); look before replacing it', v_md5;
    END IF;
  END IF;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · The stamp
-- ══════════════════════════════════════════════════════════════════
/**
 * Before an access_log row is written: when it records the caller's own
 * read and the caller is platform-wide now (the owner's key, a platform
 * administrator), it says so. Only ever turns platform_wide on.
 */
CREATE OR REPLACE FUNCTION access_log_platform_stamp() RETURNS trigger AS $$
BEGIN
  IF NOT NEW.platform_wide AND NEW.person_id = app_user_id() AND app_is_platform_wide() THEN
    NEW.platform_wide := true;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS access_log_platform_stamp ON access_log;
CREATE TRIGGER access_log_platform_stamp BEFORE INSERT ON access_log
  FOR EACH ROW EXECUTE FUNCTION access_log_platform_stamp();


-- ══════════════════════════════════════════════════════════════════
-- §2 · Grants: nobody's (a trigger function is never called by name)
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['access_log_platform_stamp()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'access_log_platform_stamp()'::regprocedure
                    AND p.prosecdef AND p.provolatile = 'v'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/139: access_log_platform_stamp() is not a VOLATILE SECURITY DEFINER with a pinned search_path';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
              WHERE p.oid = 'access_log_platform_stamp()'::regprocedure AND x.privilege_type = 'EXECUTE'
                AND x.grantee <> p.proowner)
     OR (SELECT proacl FROM pg_proc WHERE oid = 'access_log_platform_stamp()'::regprocedure) IS NULL THEN
    RAISE EXCEPTION 'db/139: access_log_platform_stamp() is executable by someone other than its owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'access_log'::regclass AND t.tgname = 'access_log_platform_stamp'
                    AND t.tgfoid = 'access_log_platform_stamp()'::regprocedure
                    AND t.tgenabled = 'O' AND NOT t.tgisinternal
                    -- BEFORE (2), INSERT (4), ROW (1); nothing else.
                    AND t.tgtype = 7) THEN
    RAISE EXCEPTION 'db/139: the access_log_platform_stamp trigger is not BEFORE INSERT FOR EACH ROW on access_log';
  END IF;
END $check$;

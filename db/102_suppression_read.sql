-- ══════════════════════════════════════════════════════════════════
--  102 · Who a module was hidden from is the school's to read
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN: an RLS policy, a column privilege and one definer function.
-- Its proof is db/99 §79; the API walk is tools/smoke-modules.mjs.
--
-- THE LEAK (found by the lead on 2026-10-14; production held no named row,
-- so nothing had been read). feature_suppression (db/08) records a module
-- hidden from a school, or from ONE NAMED PERSON at it (person_id), with an
-- optional free-text reason of up to 1,000 characters and who hid it. Its
-- read policy was "anybody signed in" (db/08), narrowed by db/81 to "anybody
-- enrolled anywhere" (app_enrolled()). The only gate on GET /api/read/:resource
-- is row security, so `module_suppressions` returned, for any schoolId, the
-- people a module had been hidden from, their names, and the reason a school
-- administrator wrote about them, to any parent, pupil or follower at any
-- school. "Injuries hidden from Mr X: under investigation" is the kind of row
-- this table exists to hold.
--
-- WHAT CHANGES
--
--   1. ROWS. feature_suppression_read is replaced:
--        a school-wide row (person_id NULL): as before, anybody enrolled.
--          It says only that a school switched a module off; the modules
--          screen's "Hidden by this school" reads it, and a platform
--          administrator choosing a school's settings reads it.
--        a NAMED row (person_id set): a holder of school.feature.manage AT
--          THAT SCHOOL (the test the insert and update policies already use,
--          db/08), or the named person himself. Nobody else: not another
--          teacher at the school, not a parent, a pupil, a follower, nor the
--          administrator of another school.
--
--   2. THE REASON. A named person reads THAT the module is hidden from him,
--      not WHY. A reason is a manager's note about a person, written for the
--      people who manage the setting, and its likeliest contents ("pending a
--      safeguarding review", "parents complained") are exactly what must not
--      reach the person the note is about, or a child reading over his
--      shoulder. Row security cannot hide one column of a row it shows, so:
--        - scrbrd_app loses SELECT on feature_suppression.reason (it keeps
--          SELECT on every other column, and INSERT and UPDATE as before:
--          writing a reason is unchanged);
--        - feature_suppression_reason(id), SECURITY DEFINER, returns the
--          reason to whoever may read it: on a named row, a holder of
--          school.feature.manage at that school; on a school-wide row,
--          whoever may read the row (anybody enrolled, as before).
--      `module_suppressions` (services/api/read/read-api.mjs) reads the
--      reason through it. A manager's screen is unchanged.
--
--   3. NOTHING ELSE MOVES. feature_enabled(key, school, person) and
--      my_feature_enabled(key) (db/08) are SECURITY DEFINER and read this
--      table as its owner, so the module gate in readResource, the fixture
--      sport trigger and every module resolution give the same answer as
--      before: a module hidden from a person is still hidden for him, and
--      still not hidden for anybody else (db/99 §79 proves both). The write
--      routes (services/api/write/scouting-api.mjs) are a manager's, who
--      reads every row he writes.
--
-- FEATURE_GRANT, LOOKED AT AND LEFT. Its rows are a school's plan: key,
-- school, granted, a platform note and changed_by (a platform account). No
-- column names a school's person or a child, so it keeps its read policy;
-- the report to Kameel says what its note may still disclose across schools.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   policy feature_suppression_read: replaced (the narrowing above)
--   feature_suppression: SELECT taken from scrbrd_app (and from a managed
--     host's anon/authenticated, where they hold it) and granted back on
--     every column but `reason`
--   + function feature_suppression_reason(uuid), SECURITY DEFINER, pinned
--     search_path, executable by scrbrd_app alone
-- No table, no row. DROP POLICY IF EXISTS, CREATE OR REPLACE and a
-- revoke-then-grant, so a second paste changes nothing.


-- ── 0 · Refuse to replace a policy this file was not written against ──
-- db/81 left it reading app_enrolled(); a second paste finds this file's own.
-- Anything else means somebody moved it since, and that change is not
-- overwritten blind.
DO $guard$
DECLARE v_qual text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_qual
    FROM pg_policy p WHERE p.polrelid = 'feature_suppression'::regclass
     AND p.polname = 'feature_suppression_read';
  IF v_qual IS NOT NULL
     AND v_qual <> 'app_enrolled()'
     AND v_qual NOT LIKE '%school.feature.manage%' THEN
    RAISE EXCEPTION 'db/102: feature_suppression_read reads % — not what db/81 left; look before replacing it', v_qual;
  END IF;
END $guard$;


-- ── 1 · The rows ───────────────────────────────────────────────────
DROP POLICY IF EXISTS feature_suppression_read ON feature_suppression;
CREATE POLICY feature_suppression_read ON feature_suppression
  AS PERMISSIVE FOR SELECT TO public
  USING (
    -- The school switched a module off: not about anybody.
    (person_id IS NULL AND app_enrolled())
    -- A module hidden from one person: the school's managers, and him.
    OR (person_id IS NOT NULL
        AND (person_id = app_user_id()
             OR app_can('school.feature.manage', school_id, NULL, NULL, NULL)))
  );


-- ── 2 · The reason: not a column the application reads ─────────────
-- Revoke the table-wide SELECT (db/06's default privilege) and grant it back
-- column by column. A column added to this table later is not readable until
-- somebody grants it, which is the direction to fail in.
REVOKE SELECT ON feature_suppression FROM scrbrd_app;
GRANT SELECT (id, key, school_id, person_id, hidden_by, hidden_at, lifted_at, lifted_by)
  ON feature_suppression TO scrbrd_app;

-- A managed host's API roles get table privileges by default privilege. Row
-- security already gives them nothing (no app.user_id), and they get no more
-- of the reason than the application does.
DO $platform_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
       AND (has_table_privilege(r, 'feature_suppression', 'SELECT')
            OR has_column_privilege(r, 'feature_suppression', 'reason', 'SELECT')) THEN
      EXECUTE format('REVOKE SELECT ON feature_suppression FROM %I', r);
      EXECUTE format('GRANT SELECT (id, key, school_id, person_id, hidden_by, hidden_at, lifted_at, lifted_by) '
                     'ON feature_suppression TO %I', r);
    END IF;
  END LOOP;
END $platform_roles$;

/**
 * The reason written on one suppression, to whoever may read it.
 *
 * A named row's reason is a manager's note about that person: a holder of
 * school.feature.manage at the row's school reads it, and the person it names
 * does not (he reads, through the row, that the module is hidden from him).
 * A school-wide row's reason goes to whoever may read the row, which is what
 * it was before db/102. NULL otherwise, and NULL for an id that is not a row:
 * the two are not told apart, so this is no way to ask whether a suppression
 * exists.
 *
 * SECURITY DEFINER because scrbrd_app holds no SELECT on the column; the test
 * is inside, against the row's own school.
 */
CREATE OR REPLACE FUNCTION feature_suppression_reason(p_id uuid) RETURNS text AS $$
  SELECT s.reason
    FROM feature_suppression s
   WHERE s.id = p_id
     AND CASE WHEN s.person_id IS NULL THEN app_enrolled()
              ELSE app_can('school.feature.manage', s.school_id, NULL, NULL, NULL)
         END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION feature_suppression_reason(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION feature_suppression_reason(uuid) TO scrbrd_app;

DO $revoke_platform_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION feature_suppression_reason(uuid) FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  v_qual text;
  v_n    int;
BEGIN
  -- The policy, as Postgres stores it. Exact text: a policy that reads
  -- differently is not the one this file proves.
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_qual
    FROM pg_policy p
   WHERE p.polrelid = 'feature_suppression'::regclass AND p.polname = 'feature_suppression_read'
     AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = '{0}';
  IF v_qual IS DISTINCT FROM
       '(((person_id IS NULL) AND app_enrolled()) OR ((person_id IS NOT NULL) AND ((person_id = app_user_id()) OR '
       'app_can(''school.feature.manage''::text, school_id, NULL::text, NULL::uuid, NULL::uuid))))' THEN
    RAISE EXCEPTION 'db/102: feature_suppression_read reads %', coalesce(v_qual, '(missing, or not a permissive SELECT for everyone)');
  END IF;

  -- And it is the only way to read a row: a second permissive SELECT policy
  -- would be OR-ed with it and undo the narrowing.
  SELECT count(*) INTO v_n FROM pg_policy p
   WHERE p.polrelid = 'feature_suppression'::regclass AND p.polcmd IN ('r', '*') AND p.polpermissive;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'db/102: feature_suppression has % permissive policies that read it, not one', v_n;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'feature_suppression'::regclass) THEN
    RAISE EXCEPTION 'db/102: row security is off on feature_suppression';
  END IF;

  -- The reason is not the application's to select; every other column is.
  IF has_column_privilege('scrbrd_app', 'feature_suppression', 'reason', 'SELECT') THEN
    RAISE EXCEPTION 'db/102: scrbrd_app can still select feature_suppression.reason';
  END IF;
  IF NOT (has_column_privilege('scrbrd_app', 'feature_suppression', 'person_id', 'SELECT')
          AND has_column_privilege('scrbrd_app', 'feature_suppression', 'lifted_at', 'SELECT')
          AND has_table_privilege('scrbrd_app', 'feature_suppression', 'INSERT')
          AND has_table_privilege('scrbrd_app', 'feature_suppression', 'UPDATE')) THEN
    RAISE EXCEPTION 'db/102: scrbrd_app lost more of feature_suppression than its reason';
  END IF;

  -- The reason's one door: a stable definer with a pinned path, asking the
  -- manage capability at the row's school, executable by scrbrd_app and not
  -- by PUBLIC.
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE oid = 'feature_suppression_reason(uuid)'::regprocedure AND prosecdef AND provolatile = 's'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))
                    AND prosrc LIKE '%app_can(''school.feature.manage'', s.school_id%') THEN
    RAISE EXCEPTION 'db/102: feature_suppression_reason is not the stable definer this file writes';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'feature_suppression_reason(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/102: the application cannot call feature_suppression_reason';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
              WHERE p.oid = 'feature_suppression_reason(uuid)'::regprocedure
                AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'db/102: feature_suppression_reason is executable by PUBLIC';
  END IF;
END $check$;

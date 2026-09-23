-- ══════════════════════════════════════════════════════════════════
--  29 · The API can ask which migrations this database has (SCRBRD-066)
-- ══════════════════════════════════════════════════════════════════
--
-- On 2026-09-23 production's API and client were running the code from
-- merged PRs #30 and #31 while the database was still at db/23: db/24–db/27
-- had never been pasted. Every screen that reached for a table or function
-- those files create would have answered 42P01 / 42883 for as long as nobody
-- looked. DEPLOYING.md says "schema first, always"; nothing enforced it —
-- the deploy workflow ships the API and the client on every push to main
-- whatever state the database is in.
--
-- So the API now refuses to start when the database is missing a migration
-- the code was built against (services/api/schema-guard.mjs, the list in
-- services/api/expected-migrations.json). On Cloud Run and Render a revision
-- that fails to start never takes traffic, so a deploy that is ahead of its
-- schema leaves the previous, working revision serving instead of a broken one.
--
-- The ledger that knows is schema_migration, written by tools/migrate.mjs and
-- by the paste bundles. It has row-level security on and no policy, on
-- purpose (the application role reads none of it; db/99 insists on that
-- shape for every table), so scrbrd_app cannot simply SELECT it. This is the
-- narrowest door: one SECURITY DEFINER function returning the applied NAMES
-- and nothing else — no hashes, no commit notes, no timestamps — executable
-- by the application role and nobody else.
--
-- It follows that production must have THIS file before the API that checks
-- for it is deployed. That is the rule working, not a special case: the API
-- names db/29 in its expected list, and refuses to start without it.
--
-- Safe to run twice.

CREATE OR REPLACE FUNCTION schema_migrations_applied()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT name FROM schema_migration ORDER BY name $$;

COMMENT ON FUNCTION schema_migrations_applied() IS
  'Names of the db/NN migrations recorded in schema_migration. Read by the API at boot to refuse serving code the schema has not caught up with (SCRBRD-066).';

-- A new function is executable by PUBLIC unless that is taken away, and on a
-- managed host the platform's API roles can inherit it from there. Only the
-- application role needs it.
REVOKE ALL ON FUNCTION schema_migrations_applied() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION schema_migrations_applied() TO scrbrd_app;

-- Supabase grants EXECUTE on new functions in public to its own API roles by
-- default privilege, directly rather than through PUBLIC, so the REVOKE above
-- does not reach them. Where those roles exist, take it back from them too;
-- elsewhere this does nothing.
DO $revoke_platform_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION schema_migrations_applied() FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;

-- ── Assertion ──────────────────────────────────────────────────────
-- What this file promised, checked in the same paste. A DO block raises, so
-- the transaction the operator wrapped this in rolls back rather than leaving
-- half of it applied. That the server actually refuses on a short ledger is
-- asserted live by tools/smoke-schema-guard.mjs.
DO $check$
DECLARE
  f oid := to_regprocedure('schema_migrations_applied()');
BEGIN
  IF f IS NULL THEN
    RAISE EXCEPTION 'db/29: schema_migrations_applied() is missing';
  END IF;
  IF pg_get_function_result(f) IS DISTINCT FROM 'SETOF text' THEN
    RAISE EXCEPTION 'db/29: schema_migrations_applied returns %, not the shape the API reads', pg_get_function_result(f);
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'db/29: schema_migrations_applied is not SECURITY DEFINER — the application role would read an empty ledger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
                  WHERE p.oid = f AND c = 'search_path=pg_catalog, public, pg_temp') THEN
    RAISE EXCEPTION 'db/29: schema_migrations_applied does not pin its search_path';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/29: the application role cannot call schema_migrations_applied';
  END IF;
  -- Grantee 0 in an ACL is PUBLIC.
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = f AND a.grantee = 0) THEN
    RAISE EXCEPTION 'db/29: schema_migrations_applied is executable by PUBLIC';
  END IF;
  -- It returns names, not the ledger: nothing that could widen it to hashes
  -- or notes without this assertion being edited in a later file.
  IF (SELECT prosrc FROM pg_proc WHERE oid = f) !~ '^\s*SELECT name FROM schema_migration ORDER BY name\s*$' THEN
    RAISE EXCEPTION 'db/29: schema_migrations_applied returns something other than the applied names';
  END IF;
END $check$;

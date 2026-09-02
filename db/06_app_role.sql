-- ════════════════════════════════════════════════════════════════
--  SCRBRD — the role the application connects as
--
--  Row-level security does not apply to a table's OWNER. That is Postgres
--  behaviour, not a misconfiguration, and it means an application connected as
--  the owner runs with every policy in this schema silently inert — every
--  policy still listed, still generated, still tested, and enforcing nothing.
--
--  This was not hypothetical. The API connected as the owner, and the gate-3
--  smoke test caught it the only way it can be caught: a medical officer, who
--  holds no scoring capability, successfully appended a ball to a live match.
--  Every unit test passed while that was true, because the fakes prove the
--  policy logic and only a real connection proves the policy applies.
--
--  So: the application gets its own unprivileged role. It owns nothing, it may
--  not create anything, and it holds exactly the verbs the read and write paths
--  use. Migrations and seeding still run as the owner.
--
--  The second half of this fix is in services/api/server.mjs, which refuses to
--  start on a connection that can bypass RLS. A defence that depends on
--  everyone remembering to set DATABASE_URL correctly is not a defence.
-- ════════════════════════════════════════════════════════════════

DO $create_app_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrbrd_app') THEN
    -- The password is for local development only. In any deployed environment
    -- this role is created by the operator with a secret from a real store,
    -- and this branch does nothing because the role already exists.
    CREATE ROLE scrbrd_app LOGIN PASSWORD 'scrbrd_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $create_app_role$;

-- Checked rather than assumed: a role created by hand somewhere along the way
-- must not carry either attribute, and only a superuser can strip them — so
-- this refuses to proceed rather than pretending to have fixed it.
DO $check_app_role$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolbypassrls INTO r FROM pg_roles WHERE rolname = 'scrbrd_app';
  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION
      'scrbrd_app has SUPERUSER or BYPASSRLS; every row-level policy would be inert for it';
  END IF;
END $check_app_role$;

GRANT USAGE ON SCHEMA public TO scrbrd_app;

-- No DELETE anywhere. Records about minors are deactivated, never removed, so
-- an audit trail survives — the policy generator emits no DELETE policy for
-- the same reason, and this makes it true at the privilege layer too.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO scrbrd_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO scrbrd_app;

-- The SECURITY DEFINER state-machine functions. They enforce the transitions
-- themselves and check capability first, which is why the application is given
-- no direct write access to scoring_session at all.
--
-- Scoped to functions this schema owns. `GRANT ... ON ALL FUNCTIONS` also
-- sweeps up whatever an extension installed into public (pgcrypto puts about
-- forty here), which both warns on every run and hands out more than intended.
DO $grant_functions$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f.sig);
  END LOOP;
END $grant_functions$;

-- Anything added by a later migration is covered without a follow-up grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO scrbrd_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO scrbrd_app;

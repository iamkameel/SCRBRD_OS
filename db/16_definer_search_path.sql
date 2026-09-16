-- ══════════════════════════════════════════════════════════════════
--  16 · Every SECURITY DEFINER function names its search path
-- ══════════════════════════════════════════════════════════════════
--
-- Eighty functions run as the schema owner — app_can(), the session
-- transitions, enrolment, the amendment and quarantine doors — and not one
-- said which schemas it would resolve names in. Postgres' own guidance for a
-- definer function is to pin search_path, because a caller who can create an
-- object in a schema searched before the intended one can have the owner's
-- privileges execute their code. Today scrbrd_app cannot create anything
-- anywhere, which is the only reason this was not exploitable; that is a
-- privilege configuration living outside the migrations, and the day a
-- grant widens it, eighty doors open at once.
--
-- So every definer function in public is pinned here, in one statement over
-- the catalogue rather than eighty edits: pg_catalog first, then public, and
-- pg_temp LAST — named explicitly, because an unlisted pg_temp is searched
-- FIRST by default, which is exactly the hole. A function written later
-- without the pin fails the verifier (db/99), which says what to add.
DO $$
DECLARE f record; n integer := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp', f.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'search_path pinned on % SECURITY DEFINER function(s)', n;
END $$;

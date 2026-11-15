-- ══════════════════════════════════════════════════════════════════
--  157 · A managed host's API roles reach nothing in public
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel, 14 Nov 2026: "both". He switches the managed
-- host's own Data API off in its dashboard; this file is the defence in
-- depth. SCRBRD never uses that API: the application connects as
-- scrbrd_app (db/06) and migrations run as the schema's owner. Supabase
-- ships the roles anon, authenticated and service_role for it, and its
-- default privileges grant them every new table, sequence and function
-- in public. After this file none of the three can execute a function, or
-- read or write a table, view, column or sequence of SCRBRD's in public,
-- by its own grant or through PUBLIC.
--
-- THE DESIGN (the smallest change that closes every path):
--   (b) Object by object. Every grant the three roles hold on SCRBRD's
--       objects in public is revoked: functions, relations, columns, and
--       their own grants on the schema. Then PUBLIC: a function (or
--       relation) PUBLIC may use is usable by anon, so PUBLIC's grant goes
--       too, and first scrbrd_app is granted, by name, exactly what it
--       reached through PUBLIC alone. scrbrd_app's reach and the owner's
--       are taken before and compared after, strictly.
--   (c) Default privileges. The grants SCRBRD's owner's default privileges
--       give the three roles, in public or for every schema, are removed.
--       Postgres's own default (PUBLIC executes a new function) is NOT
--       changed: db/06 gives scrbrd_app no default on functions, and every
--       migration chooses per function, so changing it would change what
--       SCRBRD itself does. A new function left PUBLIC's is refused by
--       db/99 §135 instead.
--   (a) is not taken. PUBLIC's USAGE on schema public stays: with (b) it
--       reaches none of SCRBRD's functions or relations, and removing it
--       would reach every role on the host, the platform's own services
--       among them, which cannot be proven unchanged from here.
--   service_role is included. SCRBRD's API holds its key for Storage only
--   (services/api/io/object-store.mjs calls /storage/v1 and nothing else;
--   its objects live in schema storage), and it bypasses row-level
--   security, so it is the one whose leaked key would read the most.
--
-- WHAT IS SCRBRD'S. An object in public whose owner is the owner of the
-- ledger, schema_migration (the role that pastes and migrates), and whose
-- owner the paster may act for; the schema's own grants where the paster
-- may act for the schema's owner; default privileges of that same owner.
-- Anything else (another application's object, the platform's own default
-- privileges, a schema owned by a role the paster is not) is LEFT:
-- api_role_reach() reports it as a row beginning "left", with the reason,
-- and the file names every such row in a NOTICE. One exception refuses the
-- paste, named: another owner's view over SCRBRD's relations that PUBLIC or
-- the three may read, since it can show a child's record.
--
-- Two functions stay, owner-only: api_role_reach(role), what a role may do
-- in public, and api_roles_close(p_keep_app), the sweep, so db/99 can prove
-- it and an owner can run it again should a host grant again. Run later,
-- SELECT api_roles_close() takes PUBLIC's grants WITHOUT handing them to
-- scrbrd_app: what PUBLIC holds by then is a mistake to read, not a reach
-- to keep (read api_role_reach('public') first). Only this file passes true.
--
-- Safe where the three roles do not exist (local, CI). A second paste
-- changes nothing: the sweep finds nothing and returns 0. The snapshot, the
-- sweep and the proof are one DO block, so a paste run statement by
-- statement (the rebuild bundle, psql without -1) is still all or nothing.
-- Its proof is db/99 §135.

-- ── 1 · What a role may do in public ──────────────────────────────
-- One row per privilege: on the schema, each function, each relation and
-- each column. Through PUBLIC and memberships included, as Postgres decides
-- it; 'public' names PUBLIC itself. A privilege on an object that is not
-- SCRBRD's, and a grant or default privilege naming the role that the
-- caller may not take back, is a row beginning "left", with its reason.
CREATE OR REPLACE FUNCTION api_role_reach(p_role name) RETURNS SETOF text
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  WITH o AS (
    SELECT coalesce((SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.schema_migration')),
                    (SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user)) AS owner
  ), ours AS (
    SELECT o.owner, pg_has_role(current_user, o.owner, 'USAGE') AS acts FROM o
  ), sch AS (
    SELECT s.nspowner, pg_has_role(current_user, s.nspowner, 'USAGE') AS acts, s.nspacl
      FROM pg_namespace s WHERE s.nspname = 'public'
  )
  SELECT CASE WHEN k.p = 'USAGE' OR sch.acts THEN 'schema public ' || k.p
              ELSE format('left schema public %s: schema public''s owner %s is not a role %s acts for',
                          k.p, sch.nspowner::regrole, current_user) END
    FROM sch CROSS JOIN unnest(ARRAY['USAGE', 'CREATE']) k(p)
   WHERE has_schema_privilege(p_role, 'public', k.p)
  UNION ALL
  SELECT CASE WHEN p.proowner = ours.owner AND ours.acts THEN 'function ' || p.oid::regprocedure::text || ' EXECUTE'
              ELSE format('left function %s EXECUTE: its owner %s is not SCRBRD''s owner %s, or not one %s acts for',
                          p.oid::regprocedure, p.proowner::regrole, ours.owner::regrole, current_user) END
    FROM pg_proc p, ours
   WHERE p.pronamespace = 'public'::regnamespace
     AND has_function_privilege(p_role, p.oid, 'EXECUTE')
  UNION ALL
  SELECT CASE WHEN c.relowner = ours.owner AND ours.acts THEN 'relation ' || c.oid::regclass::text || ' ' || k.p
              ELSE format('left relation %s %s: its owner %s is not SCRBRD''s owner %s, or not one %s acts for',
                          c.oid::regclass, k.p, c.relowner::regrole, ours.owner::regrole, current_user) END
    FROM ours, pg_class c
    CROSS JOIN LATERAL unnest(CASE WHEN c.relkind = 'S' THEN ARRAY['USAGE', 'SELECT', 'UPDATE']
                                   ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] END) k(p)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(p_role, c.oid, k.p)
              ELSE has_table_privilege(p_role, c.oid, k.p) END
  UNION ALL
  SELECT CASE WHEN c.relowner = ours.owner AND ours.acts
              THEN 'column ' || c.oid::regclass::text || '.' || quote_ident(a.attname) || ' ' || k.p
              ELSE format('left column %s.%I %s: its owner %s is not SCRBRD''s owner %s, or not one %s acts for',
                          c.oid::regclass, a.attname, k.p, c.relowner::regrole, ours.owner::regrole, current_user) END
    FROM ours, pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) k(p)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND has_column_privilege(p_role, c.oid, a.attnum, k.p)
  UNION ALL
  SELECT DISTINCT format('left grant on schema public to %s: schema public''s owner %s is not a role %s acts for',
                         p_role, sch.nspowner::regrole, current_user)
    FROM sch, aclexplode(sch.nspacl) a
   WHERE NOT sch.acts AND a.grantee = (SELECT r.oid FROM pg_roles r WHERE r.rolname = p_role)
  UNION ALL
  SELECT DISTINCT format('left default privilege of %s %s on %s to %s: %s is not SCRBRD''s owner %s, or not one %s acts for',
                         d.defaclrole::regrole,
                         CASE WHEN d.defaclnamespace = 0 THEN 'in every schema' ELSE 'in schema public' END,
                         d.defaclobjtype, p_role, d.defaclrole::regrole, ours.owner::regrole, current_user)
    FROM ours, pg_default_acl d, aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace IN (0, 'public'::regnamespace)
     AND a.grantee = (SELECT r.oid FROM pg_roles r WHERE r.rolname = p_role)
     AND NOT (d.defaclrole = ours.owner AND ours.acts)
$$;

-- ── 2 · The sweep ─────────────────────────────────────────────────
-- Returns how many statements it ran: 0 means there was nothing to close.
-- p_keep_app: grant scrbrd_app by name what it reached through PUBLIC alone,
-- before PUBLIC's grant goes. This file passes true; a later run should not.
CREATE OR REPLACE FUNCTION api_roles_close(p_keep_app boolean DEFAULT false) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  api oid[] := ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'));
  app oid := CASE WHEN p_keep_app THEN to_regrole('scrbrd_app') END;
  ours oid := coalesce((SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.schema_migration')),
                       (SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user));
  o record;
  n integer := 0;
BEGIN
  IF NOT pg_has_role(current_user, ours, 'USAGE') THEN
    RAISE NOTICE 'db/157: % may not act for SCRBRD''s owner %, so nothing is closed', current_user, ours::regrole;
    RETURN 0;
  END IF;

  -- (b) The three roles' own grants on the schema, where the paster may act
  -- for its owner, and on every object of SCRBRD's in public.
  FOR o IN
    SELECT DISTINCT 'SCHEMA' AS k, 'public' AS obj, a.grantee
      FROM pg_namespace s, aclexplode(s.nspacl) a
     WHERE s.nspname = 'public' AND a.grantee = ANY (api)
       AND pg_has_role(current_user, s.nspowner, 'USAGE')
    UNION
    SELECT DISTINCT 'ROUTINE', p.oid::regprocedure::text, a.grantee
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.pronamespace = 'public'::regnamespace AND a.grantee = ANY (api) AND p.proowner = ours
    UNION
    SELECT DISTINCT CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, c.oid::regclass::text, a.grantee
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND a.grantee = ANY (api) AND c.relowner = ours
    UNION
    -- A table's REVOKE ALL takes its columns' grants with it.
    SELECT DISTINCT 'TABLE', c.oid::regclass::text, a.grantee
      FROM pg_class c JOIN pg_attribute t ON t.attrelid = c.oid, aclexplode(t.attacl) a
     WHERE c.relnamespace = 'public'::regnamespace AND a.grantee = ANY (api) AND c.relowner = ours
  LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM %s', o.k, o.obj, o.grantee::regrole);
    n := n + 1;
  END LOOP;

  -- (b) PUBLIC's CREATE on the schema, where the paster may act for its owner.
  IF EXISTS (SELECT 1 FROM pg_namespace s, aclexplode(s.nspacl) a
              WHERE s.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
                AND pg_has_role(current_user, s.nspowner, 'USAGE')) THEN
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    n := n + 1;
  END IF;

  -- (b) PUBLIC's functions: scrbrd_app keeps, by name, what it reached
  -- through PUBLIC (p_keep_app); then PUBLIC's grant goes.
  FOR o IN
    SELECT p.oid::regprocedure::text AS sig,
           NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = app AND a.privilege_type = 'EXECUTE') AS app_needs
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proowner = ours
       AND has_function_privilege('public', p.oid, 'EXECUTE')
  LOOP
    IF app IS NOT NULL AND o.app_needs THEN
      EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO scrbrd_app', o.sig);
      n := n + 1;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC', o.sig);
    n := n + 1;
  END LOOP;

  -- (b) PUBLIC's relations and columns, the same way.
  IF app IS NOT NULL THEN
    FOR o IN
      SELECT DISTINCT c.oid::regclass::text AS obj, CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS k,
             a.privilege_type AS priv, NULL::name AS col
        FROM pg_class c, aclexplode(c.relacl) a
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
         AND a.grantee = 0 AND c.relowner = ours
      UNION
      SELECT DISTINCT c.oid::regclass::text, 'TABLE', a.privilege_type, t.attname
        FROM pg_class c JOIN pg_attribute t ON t.attrelid = c.oid, aclexplode(t.attacl) a
       WHERE c.relnamespace = 'public'::regnamespace AND a.grantee = 0 AND c.relowner = ours
      ORDER BY 1, 4 NULLS FIRST
    LOOP
      EXECUTE format('GRANT %s %s ON %s %s TO scrbrd_app', o.priv,
                     CASE WHEN o.col IS NULL THEN '' ELSE format('(%I)', o.col) END, o.k, o.obj);
      n := n + 1;
    END LOOP;
  END IF;
  FOR o IN
    SELECT DISTINCT c.oid::regclass::text AS obj, CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS k
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relowner = ours
       AND (EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0)
            OR EXISTS (SELECT 1 FROM pg_attribute t, aclexplode(t.attacl) a WHERE t.attrelid = c.oid AND a.grantee = 0))
  LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC', o.k, o.obj);
    n := n + 1;
  END LOOP;

  -- (c) SCRBRD's owner's default privileges naming the three roles, in
  -- public or for every schema.
  FOR o IN
    SELECT DISTINCT d.defaclnamespace AS ns, d.defaclobjtype AS t, a.grantee::regrole AS whom
      FROM pg_default_acl d, aclexplode(d.defaclacl) a
     WHERE d.defaclnamespace IN (0, 'public'::regnamespace) AND a.grantee = ANY (api) AND d.defaclrole = ours
       AND d.defaclobjtype IN ('r', 'S', 'f', 'T', 'n')
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %s %s REVOKE ALL ON %s FROM %s',
                   ours::regrole, CASE WHEN o.ns = 0 THEN '' ELSE 'IN SCHEMA public' END,
                   CASE o.t WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS'
                            WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS' END,
                   o.whom);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- The two are the owner's alone: every grantee but the owner is taken off
-- them (PUBLIC, and whoever the owner's default privileges named) before the
-- snapshot, so the sweep below does not hand them to scrbrd_app.
DO $own$
DECLARE g record;
BEGIN
  FOR g IN
    SELECT DISTINCT p.oid::regprocedure::text AS f, a.grantee
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid IN ('api_role_reach(name)'::regprocedure, 'api_roles_close(boolean)'::regprocedure)
       AND a.grantee <> p.proowner
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', g.f,
                   CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END);
  END LOOP;
END $own$;

-- ── 3 · Before, close, after: one block, so it is all or nothing ────
DO $close$
DECLARE
  before text[];
  after text[];
  v text;
  n integer;
  ours oid := coalesce((SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.schema_migration')),
                       (SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user));
BEGIN
  -- Before: what SCRBRD's own roles may do today.
  SELECT array_agg(r.rolname || ': ' || x ORDER BY r.rolname, x) INTO before
    FROM pg_roles r CROSS JOIN LATERAL api_role_reach(r.rolname) x
   WHERE r.rolname IN ('scrbrd_app', current_user);
  IF (SELECT count(*) FROM unnest(before) x WHERE x LIKE 'scrbrd\_app: %') = 0 THEN
    RAISE EXCEPTION 'db/157: the snapshot of scrbrd_app''s reach is empty, so the comparison would prove nothing';
  END IF;

  n := api_roles_close(true);
  RAISE NOTICE 'db/157: % statement(s) closed what the managed host''s API roles reached', n;

  -- What is left, and why: named, never refused.
  SELECT string_agg(r || ': ' || x, '; ' ORDER BY r, x) INTO v
    FROM unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) r
   CROSS JOIN LATERAL api_role_reach(r) x
   WHERE (r = 'public' OR to_regrole(r) IS NOT NULL) AND x LIKE 'left %';
  IF v IS NOT NULL THEN
    RAISE NOTICE 'db/157: left, not SCRBRD''s to close: %', v;
  END IF;

  -- The one thing left that is refused: another owner's view over SCRBRD's
  -- relations that PUBLIC or the three may read. It can show a child's
  -- record however tight SCRBRD's own grants are, so it stops the paste,
  -- named, for a person to remove or re-own.
  SELECT string_agg(DISTINCT vw.oid::regclass::text || ' (owner ' || vw.relowner::regrole::text || ', over '
                    || t.oid::regclass::text || ')', '; ') INTO v
    FROM pg_class vw
    JOIN pg_rewrite w ON w.ev_class = vw.oid
    JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = w.oid AND d.refclassid = 'pg_class'::regclass
    JOIN pg_class t ON t.oid = d.refobjid
   WHERE vw.relkind IN ('v', 'm') AND vw.relowner <> ours AND t.oid <> vw.oid
     AND t.relnamespace = 'public'::regnamespace AND t.relowner = ours
     AND EXISTS (SELECT 1 FROM unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) r
                  WHERE (r = 'public' OR to_regrole(r) IS NOT NULL)
                    AND has_schema_privilege(r, vw.relnamespace, 'USAGE')
                    AND (has_table_privilege(r, vw.oid, 'SELECT') OR has_any_column_privilege(r, vw.oid, 'SELECT')));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/157: another owner''s view over SCRBRD''s data is readable by PUBLIC or a managed host''s API role: %', v;
  END IF;

  -- PUBLIC and the three reach nothing of SCRBRD's but the schema's USAGE,
  -- and may create nothing in it.
  SELECT string_agg(r || ': ' || x, '; ' ORDER BY r, x) INTO v
    FROM unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) r
   CROSS JOIN LATERAL api_role_reach(r) x
   WHERE (r = 'public' OR to_regrole(r) IS NOT NULL) AND x <> 'schema public USAGE' AND x NOT LIKE 'left %';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/157: still reached: %', left(v, 3000);
  END IF;

  -- No grant on an object of SCRBRD's, and no default privilege of its
  -- owner, names the three roles.
  SELECT string_agg(x, '; ' ORDER BY x) INTO v FROM (
    SELECT p.oid::regprocedure::text || ' → ' || a.grantee::regrole::text AS x
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proowner = ours
       AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))
    UNION
    SELECT c.oid::regclass::text || ' → ' || a.grantee::regrole::text
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relowner = ours
       AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))
    UNION
    SELECT 'default ' || d.defaclobjtype::text || ' → ' || a.grantee::regrole::text
      FROM pg_default_acl d, aclexplode(d.defaclacl) a
     WHERE d.defaclnamespace IN (0, 'public'::regnamespace) AND d.defaclobjtype IN ('r', 'S', 'f', 'T', 'n')
       AND d.defaclrole = ours
       AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))) q;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/157: a grant or default privilege of SCRBRD''s still names a managed host''s API role: %', left(v, 3000);
  END IF;

  -- SCRBRD's own roles reach exactly what they reached before.
  SELECT array_agg(r.rolname || ': ' || x ORDER BY r.rolname, x) INTO after
    FROM pg_roles r CROSS JOIN LATERAL api_role_reach(r.rolname) x
   WHERE r.rolname IN ('scrbrd_app', current_user);
  SELECT string_agg(d, '; ' ORDER BY d) INTO v FROM (
    (SELECT '-' || x AS d FROM unnest(before) x EXCEPT SELECT '-' || x FROM unnest(after) x)
    UNION ALL
    (SELECT '+' || x FROM unnest(after) x EXCEPT SELECT '+' || x FROM unnest(before) x)) q;
  IF v IS NOT NULL OR cardinality(before) <> cardinality(after) THEN
    RAISE EXCEPTION 'db/157: a SCRBRD role''s reach moved: %', left(coalesce(v, 'a count'), 3000);
  END IF;

  -- The two functions are the owner's alone, and the sweep has nothing left.
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid IN ('api_role_reach(name)'::regprocedure, 'api_roles_close(boolean)'::regprocedure)
                AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'db/157: api_role_reach() or api_roles_close() is executable by a role other than its owner';
  END IF;
  IF api_roles_close(true) <> 0 THEN
    RAISE EXCEPTION 'db/157: a second sweep still found something to close';
  END IF;
END $close$;

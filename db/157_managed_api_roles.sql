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
-- read or write a table, view, column or sequence in public, by its own
-- grant or through PUBLIC.
--
-- THE DESIGN (the smallest change that closes every path):
--   (b) Object by object. Every grant the three roles hold in public is
--       revoked: functions, relations, columns, and their own USAGE on the
--       schema. Then PUBLIC: a function (or relation) PUBLIC may use is
--       usable by anon, so PUBLIC's grant goes too, and first scrbrd_app is
--       granted, by name, exactly what it reached through PUBLIC alone.
--       scrbrd_app's reach is snapshotted before and compared after, below.
--   (c) Default privileges. The grants Supabase's defaults give the three
--       roles on new objects in public are removed, for every role this
--       file may act for. Postgres's own default (PUBLIC executes a new
--       function) is NOT changed: db/06 gives scrbrd_app no default on
--       functions, and every migration chooses per function, so changing
--       it would change what SCRBRD itself does. A new function left
--       PUBLIC's is refused by db/99 §135 instead.
--   (a) is not taken. PUBLIC's USAGE on schema public stays: with (b) it
--       reaches no function or relation, removing it would reach every
--       role on the host (the platform's own services among them, which
--       cannot be proven unchanged from here), and only the schema's owner
--       may remove it. The three roles' OWN grant on the schema goes.
--   service_role is included. SCRBRD's API holds its key for Storage only
--   (services/api/io/object-store.mjs calls /storage/v1 and nothing else;
--   its objects live in schema storage), and it bypasses row-level
--   security, so it is the one whose leaked key would read the most.
--
-- Two functions stay, owner-only: api_role_reach(role), what a role may do
-- in public, and api_roles_close(), the sweep, so db/99 can prove it and an
-- owner can run it again (SELECT api_roles_close()) should a host grant
-- again. Safe where the three roles do not exist (local, CI). A second
-- paste changes nothing: the sweep finds nothing and returns 0.
--
-- One transaction: the paste runs the file inside one, so there is no
-- BEGIN or COMMIT here. Its proof is db/99 §135.

-- ── 1 · What a role may do in public ──────────────────────────────
-- One row per privilege: on the schema, each function, each relation and
-- each column. Through PUBLIC and memberships included, as Postgres decides
-- it; 'public' names PUBLIC itself.
CREATE OR REPLACE FUNCTION api_role_reach(p_role name) RETURNS SETOF text
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT 'schema public ' || s.p
    FROM unnest(ARRAY['USAGE', 'CREATE']) s(p)
   WHERE has_schema_privilege(p_role, 'public', s.p)
  UNION ALL
  SELECT 'function ' || p.oid::regprocedure::text || ' EXECUTE'
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND has_function_privilege(p_role, p.oid, 'EXECUTE')
  UNION ALL
  SELECT 'relation ' || c.oid::regclass::text || ' ' || k.p
    FROM pg_class c
    CROSS JOIN LATERAL unnest(CASE WHEN c.relkind = 'S' THEN ARRAY['USAGE', 'SELECT', 'UPDATE']
                                   ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] END) k(p)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(p_role, c.oid, k.p)
              ELSE has_table_privilege(p_role, c.oid, k.p) END
  UNION ALL
  SELECT 'column ' || c.oid::regclass::text || '.' || quote_ident(a.attname) || ' ' || k.p
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) k(p)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND has_column_privilege(p_role, c.oid, a.attnum, k.p)
$$;

-- ── 2 · The sweep ─────────────────────────────────────────────────
-- Returns how many statements it ran: 0 means there was nothing to close.
CREATE OR REPLACE FUNCTION api_roles_close() RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  api oid[] := ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'));
  app oid := to_regrole('scrbrd_app');
  o record;
  n integer := 0;
BEGIN
  -- (b) The three roles' own grants, wherever they are held in public.
  FOR o IN
    SELECT DISTINCT 'SCHEMA' AS k, 'public' AS obj, a.grantee
      FROM pg_namespace s, aclexplode(s.nspacl) a
     WHERE s.nspname = 'public' AND a.grantee = ANY (api)
       AND pg_has_role(current_user, s.nspowner, 'USAGE')
    UNION
    SELECT DISTINCT 'ROUTINE', p.oid::regprocedure::text, a.grantee
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.pronamespace = 'public'::regnamespace AND a.grantee = ANY (api)
       AND pg_has_role(current_user, p.proowner, 'USAGE')
    UNION
    SELECT DISTINCT CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, c.oid::regclass::text, a.grantee
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND a.grantee = ANY (api) AND pg_has_role(current_user, c.relowner, 'USAGE')
    UNION
    -- A table's REVOKE ALL takes its columns' grants with it.
    SELECT DISTINCT 'TABLE', c.oid::regclass::text, a.grantee
      FROM pg_class c JOIN pg_attribute t ON t.attrelid = c.oid, aclexplode(t.attacl) a
     WHERE c.relnamespace = 'public'::regnamespace AND a.grantee = ANY (api)
       AND pg_has_role(current_user, c.relowner, 'USAGE')
  LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM %s', o.k, o.obj, o.grantee::regrole);
    n := n + 1;
  END LOOP;

  -- (b) PUBLIC's functions: scrbrd_app keeps, by name, what it reached
  -- through PUBLIC; then PUBLIC's grant goes.
  FOR o IN
    SELECT p.oid::regprocedure::text AS sig,
           NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = app AND a.privilege_type = 'EXECUTE') AS app_needs
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND has_function_privilege('public', p.oid, 'EXECUTE')
       AND pg_has_role(current_user, p.proowner, 'USAGE')
  LOOP
    IF app IS NOT NULL AND o.app_needs THEN
      EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO scrbrd_app', o.sig);
      n := n + 1;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC', o.sig);
    n := n + 1;
  END LOOP;

  -- (b) PUBLIC's relations and columns, the same way. None today; a table
  -- granted to PUBLIC later is closed rather than left.
  FOR o IN
    SELECT DISTINCT c.oid::regclass::text AS obj, CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS k,
           a.privilege_type AS priv, NULL::name AS col
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND a.grantee = 0 AND pg_has_role(current_user, c.relowner, 'USAGE')
    UNION
    SELECT DISTINCT c.oid::regclass::text, 'TABLE', a.privilege_type, t.attname
      FROM pg_class c JOIN pg_attribute t ON t.attrelid = c.oid, aclexplode(t.attacl) a
     WHERE c.relnamespace = 'public'::regnamespace AND a.grantee = 0
       AND pg_has_role(current_user, c.relowner, 'USAGE')
    ORDER BY 1, 4 NULLS FIRST
  LOOP
    IF app IS NOT NULL THEN
      EXECUTE format('GRANT %s %s ON %s %s TO scrbrd_app', o.priv,
                     CASE WHEN o.col IS NULL THEN '' ELSE format('(%I)', o.col) END, o.k, o.obj);
      n := n + 1;
    END IF;
  END LOOP;
  FOR o IN
    SELECT DISTINCT c.oid::regclass::text AS obj, CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS k
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND pg_has_role(current_user, c.relowner, 'USAGE')
       AND (EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0)
            OR EXISTS (SELECT 1 FROM pg_attribute t, aclexplode(t.attacl) a WHERE t.attrelid = c.oid AND a.grantee = 0))
  LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC', o.k, o.obj);
    n := n + 1;
  END LOOP;

  -- (c) Default privileges naming the three roles, in public or for every
  -- schema, for each creating role this file may act for.
  FOR o IN
    SELECT DISTINCT d.defaclrole::regrole AS who, d.defaclnamespace AS ns, d.defaclobjtype AS t, a.grantee::regrole AS whom
      FROM pg_default_acl d, aclexplode(d.defaclacl) a
     WHERE d.defaclnamespace IN (0, 'public'::regnamespace) AND a.grantee = ANY (api)
       AND pg_has_role(current_user, d.defaclrole, 'MEMBER')
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %s %s REVOKE ALL ON %s FROM %s',
                   o.who, CASE WHEN o.ns = 0 THEN '' ELSE 'IN SCHEMA public' END,
                   CASE o.t WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS'
                            WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS' END,
                   o.whom);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- The two are the owner's alone: taken from PUBLIC before the snapshot,
-- so the sweep below does not hand them to scrbrd_app.
DO $own$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['api_role_reach(name)', 'api_roles_close()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['scrbrd_app', 'anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $own$;

-- ── 3 · Before: what SCRBRD's own roles may do today ───────────────
CREATE TEMP TABLE _v157_before ON COMMIT DROP AS
  SELECT r.rolname, x.reach
    FROM pg_roles r CROSS JOIN LATERAL api_role_reach(r.rolname) x(reach)
   WHERE r.rolname IN ('scrbrd_app', current_user);

-- ── 4 · Close ─────────────────────────────────────────────────────
DO $close$
BEGIN
  RAISE NOTICE 'db/157: % statement(s) closed what the managed host''s API roles reached', api_roles_close();
END $close$;

-- ── 5 · After: refuse to commit a file that did not do what it says ──
DO $after$
DECLARE v text;
BEGIN
  -- The three roles reach no function, relation or column in public.
  SELECT string_agg(r.rolname || ': ' || x.reach, '; ' ORDER BY r.rolname, x.reach) INTO v
    FROM pg_roles r CROSS JOIN LATERAL api_role_reach(r.rolname) x(reach)
   WHERE r.rolname IN ('anon', 'authenticated', 'service_role') AND x.reach !~ '^schema ';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/157: a managed host''s API role still reaches %', left(v, 3000);
  END IF;
  -- Nor does PUBLIC, which every one of them is.
  SELECT string_agg(x.reach, '; ' ORDER BY x.reach) INTO v
    FROM api_role_reach('public') x(reach) WHERE x.reach !~ '^schema ';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/157: PUBLIC still reaches %', left(v, 3000);
  END IF;
  -- Their own grant on the schema is gone, where this file acts for its owner.
  SELECT string_agg(a.grantee::regrole::text, ', ') INTO v
    FROM pg_namespace s, aclexplode(s.nspacl) a
   WHERE s.nspname = 'public' AND pg_has_role(current_user, s.nspowner, 'USAGE')
     AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/157: % still hold(s) a grant on schema public', v;
  END IF;
  -- No default privilege this file may act for names them.
  SELECT string_agg(DISTINCT d.defaclrole::regrole::text || ' ' || d.defaclobjtype::text || ' → ' || a.grantee::regrole::text, '; ') INTO v
    FROM pg_default_acl d, aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace IN (0, 'public'::regnamespace) AND pg_has_role(current_user, d.defaclrole, 'MEMBER')
     AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/157: a default privilege still grants a managed host''s API role: %', v;
  END IF;
  -- SCRBRD's own roles reach exactly what they reached before.
  SELECT string_agg(d, '; ' ORDER BY d) INTO v FROM (
    (SELECT '-' || rolname || ': ' || reach AS d FROM _v157_before
     EXCEPT
     SELECT '-' || r.rolname || ': ' || x.reach FROM pg_roles r CROSS JOIN LATERAL api_role_reach(r.rolname) x(reach)
      WHERE r.rolname IN ('scrbrd_app', current_user))
    UNION ALL
    (SELECT '+' || r.rolname || ': ' || x.reach FROM pg_roles r CROSS JOIN LATERAL api_role_reach(r.rolname) x(reach)
      WHERE r.rolname IN ('scrbrd_app', current_user)
     EXCEPT
     SELECT '+' || rolname || ': ' || reach FROM _v157_before)) q;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/157: a SCRBRD role''s reach moved: %', left(v, 3000);
  END IF;
  IF (SELECT count(*) FROM _v157_before WHERE rolname = 'scrbrd_app') = 0 THEN
    RAISE EXCEPTION 'db/157: the snapshot of scrbrd_app''s reach is empty, so the comparison proved nothing';
  END IF;
  -- The two functions are the owner's alone, and the sweep has nothing left.
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid IN ('api_role_reach(name)'::regprocedure, 'api_roles_close()'::regprocedure)
                AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'db/157: api_role_reach() or api_roles_close() is executable by a role other than its owner';
  END IF;
  IF api_roles_close() <> 0 THEN
    RAISE EXCEPTION 'db/157: a second sweep still found something to close';
  END IF;
END $after$;

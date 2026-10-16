-- ══════════════════════════════════════════════════════════════════
--  SCRBRD — apply 107_official_register_closed.sql to a database that already has the rest
-- ══════════════════════════════════════════════════════════════════
--
--  For the Supabase SQL Editor. Nothing here tears anything down: it is the
--  one migration and its ledger row, exactly what `node tools/migrate.mjs`
--  would apply to this database. Refuses to run twice, and refuses to run
--  ahead of its predecessor.
DO $apply$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migration WHERE name = '107_official_register_closed.sql') THEN
    RAISE EXCEPTION '107_official_register_closed.sql is already in this database''s ledger — nothing to do';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migration WHERE name = '106_reach_side.sql') THEN
    RAISE EXCEPTION '106_reach_side.sql has not been applied here — apply it first, or use the rebuild bundle';
  END IF;
END $apply$;

-- A database ledgered by a bundle from before SCRBRD-025 has no note column
-- yet; this reaches it either way.
ALTER TABLE schema_migration ADD COLUMN IF NOT EXISTS note text;

-- ── 107_official_register_closed.sql ──
-- ══════════════════════════════════════════════════════════════════
--  107 · The officials register and the platform's grant notes, closed
--        (REACH group R-C: O4 and O2)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN: three read policies, one helper and two definer reads. The
-- design is docs/design/REACH_parent_pupil.md §4 rows O4 and O2, §5 item 6,
-- §6.3, and §7 REACH-D5, decided by Kameel on 14 October 2026 ("Yes, close
-- it"); the grant note is his decision of the same day ("as recommended").
-- Its proof is db/99 §84; the API walks are tools/smoke-register.mjs,
-- tools/smoke-officials.mjs and tools/smoke-modules.mjs.
--
-- THE GAP (O4). `official` (db/08) holds an umpire's or a scorer's date of
-- birth, South African ID number, email and phone. Its read policy was
-- "anybody signed in" (db/08), narrowed by db/81 to app_enrolled(): every
-- enrolled person at every school, pupils and parents included, read every
-- row raw. The API was safe by one route's discipline (it read
-- official_masked, a security_invoker view that nulls the four columns for
-- everyone but the register's keeper), and the table was one join away in
-- any route written tomorrow. A pupil who scores is an official
-- (PUBLIC_DATA §5a), so the table can hold a child's ID number. The project's
-- own rule for the public pages (SCRBRD-083 §1 item 4: "allowlist, never
-- denylist; a field added later reaches nobody until somebody puts it on a
-- list") is the right rule for a table of ID numbers too.
--
-- THE GAP (O2). feature_grant's note is the platform's free-text note about
-- one school's plan ("Plan lapsed", "Included in their plan"). Its read
-- policy was app_enrolled() with no school, so `module_settings`
-- (services/api/read/read-api.mjs) returned it, as grant_note, for whatever
-- schoolId the caller asked: any parent or pupil at any school read any other
-- school's commercial note. db/102 looked at it and left it for this file.
--
-- WHAT CHANGES
--
--   1. official_read: the register's keeper, and the official himself.
--        app_can('officiating.registry.manage')  — the gate official_insert,
--          official_update and official_masked already use: no scope
--          arguments, so it resolves to "holds it platform-wide" (the union
--          or the league that keeps the register), never a school.
--        OR his own row, where the register links one to his account
--          (person_id): his own date of birth and ID number are his.
--      Nobody else reads a row of the table: not a pupil, a parent, a coach,
--      a principal, nor another school.
--   2. official_accreditation_read: the same two. A grade with no name is
--      an opaque id; the panel below carries the grade to everyone who needs
--      it, computed as the owner.
--   3. official_panel(p_official uuid DEFAULT NULL) — THE OPEN READ, and the
--      narrowest shape that serves every reader who legitimately needs an
--      official's name: a SECURITY DEFINER function that NAMES its columns
--      (the SCRBRD-083 public_*() pattern) and returns exactly
--        id, full_name, panel, active, level, accredited_until,
--        accreditations, linked
--      to anybody enrolled (app_enrolled(), as the table was), and nothing to
--      a pad credential (db/50's cut, which a definer would otherwise step
--      round). `level` is official_level() today; `linked` says whether he has
--      an account here, never which. Never born, id_number, email, phone,
--      person_id, created_by. A column added to `official` later reaches
--      nobody through it until somebody adds it here. Why a function and not
--      a view: a security_invoker view over a closed table returns nothing;
--      an owner-run view has no place to put the app_enrolled() gate except
--      a WHERE that every reader then depends on remembering. One reader per
--      route uses it: the register (`official_register`) and the appoint
--      route (POST /api/matches/:id/officials), which asks for one id.
--   4. official_conflict(p_official uuid, p_match uuid) — the appoint route's
--      one other question about an official: does his linked account hold a
--      live role at the match's school? It needed person_id, which the panel
--      does not give. Answered as the owner but over exactly the
--      role_assignment rows the caller could read himself
--      (role_assignment_read's predicate, db/01: his own, or those he holds
--      user.role.assign over), so it answers what the route's own query
--      answered before this file and nothing more. NULL to anybody not
--      enrolled and to a pad credential; false for an unlinked official.
--   5. feature_grant_read: a school's own people, and the platform.
--        app_enrolled_at(school_id) — signed in and holding, AT THAT SCHOOL,
--          an assignment app_can() would honour (app_enrolled()'s test with
--          the school named; a helper added here, below);
--        OR app_holds('platform.feature.manage') — the platform, which
--          writes the rows (feature_grant_insert/update ask the same).
--      The whole row rather than the note alone: whether another school pays
--      for a module is no more another school's business than why. Nothing
--      that resolves a module moves: feature_enabled(), my_feature_enabled(),
--      scorebook_reader_on() and match_sport_is_enabled() are SECURITY
--      DEFINER and read the table as its owner, so the module gate, the
--      fixture-sport trigger and `module_settings`' `resolved` column answer
--      as before (db/99 §84 proves it). `module_settings` asked for another
--      school now returns school_granted and grant_note NULL.
--
-- WHAT IS LEFT. official_masked (db/08) stays: it is security_invoker, so
-- over the closed table it now returns rows only to the keeper (who sees
-- every column) and to an official reading his own row (masked to him, as
-- before). Nothing in the application reads it after this file. db/08's
-- comments above official_read describe the old rule; this header replaces
-- them.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   policy official_read, official_accreditation_read, feature_grant_read:
--     replaced (the narrowings above); guarded, each must read as db/81 left
--     it (app_enrolled()) or as this file writes it, or nothing is changed
--   + function app_enrolled_at(uuid)
--   + function official_panel(uuid)
--   + function official_conflict(uuid, uuid)
--     each SECURITY DEFINER, STABLE, search_path pinned, executable by
--     scrbrd_app alone (not PUBLIC, not a managed host's anon/authenticated)
-- No table, no column, no row, no grant on a table. A second paste changes
-- nothing. Each DROP/CREATE POLICY takes a brief lock on its table.
--
-- SCHEMA FIRST. The API built with this file reads official_panel() and
-- official_conflict(); an older database has neither (42883). The file is in
-- services/api/expected-migrations.json, so that API refuses to start
-- without it.


-- ── 0 · Refuse to replace policies this file was not written against ──
-- db/81 left each reading app_enrolled(); a second paste finds this file's
-- own. Anything else means somebody moved one since, and that change is not
-- overwritten blind.
DO $guard$
DECLARE r record; v_qual text;
BEGIN
  IF to_regprocedure('app_enrolled()') IS NULL THEN
    RAISE EXCEPTION 'db/107: app_enrolled() (db/81) is missing; apply db/81 first';
  END IF;
  IF to_regprocedure('app_pad_scoped()') IS NULL OR to_regprocedure('official_level(uuid,date)') IS NULL
     OR to_regprocedure('match_school(uuid)') IS NULL OR to_regprocedure('app_holds(text)') IS NULL THEN
    RAISE EXCEPTION 'db/107: app_pad_scoped(), official_level(), match_school() or app_holds() is missing';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('official',               'official_read',               'officiating.registry.manage'),
      ('official_accreditation', 'official_accreditation_read', 'officiating.registry.manage'),
      ('feature_grant',          'feature_grant_read',          'app_enrolled_at(')) AS x(tbl, pol, mine)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_qual
      FROM pg_policy p WHERE p.polrelid = to_regclass(r.tbl) AND p.polname = r.pol;
    IF v_qual IS NOT NULL AND v_qual <> 'app_enrolled()' AND position(r.mine IN v_qual) = 0 THEN
      RAISE EXCEPTION 'db/107: %.% reads % — not what db/81 left; look before replacing it', r.tbl, r.pol, v_qual;
    END IF;
  END LOOP;
END $guard$;


-- ── 1 · Enrolled at one school ─────────────────────────────────────
/**
 * app_enrolled(), at one school: signed in AND holding, at p_school, an
 * assignment app_can() would honour — live, in its dates, not past its hour,
 * not suspended, and for a role that is only about somebody (guardian,
 * selfaccess, enquiry) naming a live, verified person. db/81's body with one
 * line added (a.school_id = p_school). A platform-wide assignment (school
 * NULL) is not "at" any school: the platform's reads ask their own question.
 */
CREATE OR REPLACE FUNCTION app_enrolled_at(p_school uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND p_school IS NOT NULL AND EXISTS (
    SELECT 1
      FROM role_assignment a
     WHERE a.person_id = app_user_id()
       AND a.school_id = p_school
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       AND (a.role <> ALL (ARRAY['guardian', 'selfaccess', 'enquiry']::text[])
            OR EXISTS (SELECT 1 FROM assignment_subject g
                        WHERE g.assignment_id = a.id
                          AND g.verification_state = 'verified'
                          AND g.valid_from <= current_date
                          AND (g.valid_until IS NULL OR g.valid_until > current_date)))
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 2 · The register: its keeper, and the official himself ─────────
DROP POLICY IF EXISTS official_read ON official;
CREATE POLICY official_read ON official
  AS PERMISSIVE FOR SELECT TO public
  USING (
    app_can('officiating.registry.manage')
    OR (person_id IS NOT NULL AND person_id = app_user_id())
  );

DROP POLICY IF EXISTS official_accreditation_read ON official_accreditation;
CREATE POLICY official_accreditation_read ON official_accreditation
  AS PERMISSIVE FOR SELECT TO public
  USING (
    app_can('officiating.registry.manage')
    -- His own grades: the row of `official` he reads is his own (above).
    OR EXISTS (SELECT 1 FROM official o
                WHERE o.id = official_accreditation.official_id
                  AND o.person_id = app_user_id())
  );


-- ── 3 · The panel: a name and a grade, to anybody enrolled ─────────
/**
 * The officials panel, by name. Every official on the register (or the one
 * asked for), with the columns a school appointing somebody needs and no
 * other: who, which panel, standing or retired, the grade held today
 * (official_level(): NULL once every accreditation has lapsed), the latest
 * date an accreditation runs to, how many he has held (so "lapsed" and
 * "never accredited" can be told apart), and whether he has an account here.
 *
 * NOT born, id_number, email, phone, person_id, created_by or created_at:
 * the columns are named, so a column added to `official` later reaches
 * nobody through here until it is named too.
 *
 * SECURITY DEFINER because the table is closed to everybody but its keeper
 * (official_read above). Gated inside: anybody enrolled (app_enrolled(), the
 * rule the table itself had), and never a pad credential (db/50 cuts the pad
 * from `official`; a definer would otherwise step round that cut).
 */
CREATE OR REPLACE FUNCTION official_panel(p_official uuid DEFAULT NULL)
RETURNS TABLE (id uuid, full_name text, panel text, active boolean, level text,
               accredited_until date, accreditations integer, linked boolean) AS $$
  SELECT o.id, o.full_name, o.panel, o.active,
         official_level(o.id),
         (SELECT max(a.valid_until) FROM official_accreditation a WHERE a.official_id = o.id),
         (SELECT count(*)::int FROM official_accreditation a WHERE a.official_id = o.id),
         o.person_id IS NOT NULL
    FROM official o
   WHERE app_enrolled() AND NOT app_pad_scoped()
     AND (p_official IS NULL OR o.id = p_official)
   ORDER BY o.full_name, o.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Does this official's linked account hold a live role at the match's school?
 * The appoint route's conflict-of-interest flag (services/api/write/
 * events-api.mjs). Answered over exactly the role_assignment rows the CALLER
 * could read himself (role_assignment_read, db/01: his own, or those he holds
 * user.role.assign over), which is what the route's own query answered when
 * it read official_masked.person_id under his identity — so this tells
 * nobody anything the route did not already tell him.
 *
 * false for an official with no account (the route reports that as "cannot
 * be checked", from the panel's `linked`); NULL to anybody not enrolled and
 * to a pad credential.
 */
CREATE OR REPLACE FUNCTION official_conflict(p_official uuid, p_match uuid) RETURNS boolean AS $$
  SELECT CASE WHEN NOT app_enrolled() OR app_pad_scoped() THEN NULL
         ELSE coalesce((
           SELECT o.person_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM role_assignment ra
                     WHERE ra.person_id = o.person_id AND ra.active
                       AND ra.school_id = match_school(p_match)
                       AND (ra.valid_until IS NULL OR ra.valid_until > current_date)
                       AND (ra.person_id = app_user_id()
                            OR app_can('user.role.assign', ra.school_id, ra.team_code, NULL, NULL)))
             FROM official o WHERE o.id = p_official), false)
         END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 4 · A school's plan: its own people, and the platform ──────────
DROP POLICY IF EXISTS feature_grant_read ON feature_grant;
CREATE POLICY feature_grant_read ON feature_grant
  AS PERMISSIVE FOR SELECT TO public
  USING (
    app_enrolled_at(school_id)
    OR app_holds('platform.feature.manage')
  );


-- ── 5 · The functions are the application's alone ──────────────────
REVOKE ALL ON FUNCTION app_enrolled_at(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION official_panel(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION official_conflict(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enrolled_at(uuid) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION official_panel(uuid) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION official_conflict(uuid, uuid) TO scrbrd_app;

DO $revoke_platform_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION app_enrolled_at(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION official_panel(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION official_conflict(uuid, uuid) FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;

COMMENT ON FUNCTION official_panel(uuid) IS
  'The officials panel by name and grade, to anybody enrolled; never born, id_number, email, phone or person_id (db/107, REACH-D5).';
COMMENT ON FUNCTION app_enrolled_at(uuid) IS
  'app_enrolled(), at one school: signed in and holding there an assignment app_can() would honour (db/107).';


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  r      record;
  v_qual text;
  v_n    int;
  v_cols text;
BEGIN
  -- The policies, as Postgres stores them. Exact text: a policy that reads
  -- differently is not the one this file proves.
  FOR r IN SELECT * FROM (VALUES
      ('official', 'official_read',
       '(app_can(''officiating.registry.manage''::text) OR ((person_id IS NOT NULL) AND (person_id = app_user_id())))'),
      ('official_accreditation', 'official_accreditation_read',
       '(app_can(''officiating.registry.manage''::text) OR (EXISTS ( SELECT 1' || chr(10)
       || '   FROM official o' || chr(10)
       || '  WHERE ((o.id = official_accreditation.official_id) AND (o.person_id = app_user_id())))))'),
      ('feature_grant', 'feature_grant_read',
       '(app_enrolled_at(school_id) OR app_holds(''platform.feature.manage''::text))')) AS x(tbl, pol, want)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_qual
      FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tbl) AND p.polname = r.pol
       AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = '{0}';
    IF v_qual IS DISTINCT FROM r.want THEN
      RAISE EXCEPTION 'db/107: %.% reads %', r.tbl, r.pol, coalesce(v_qual, '(missing, or not a permissive SELECT for everyone)');
    END IF;
    -- And it is the only way to read a row: a second permissive SELECT
    -- policy would be OR-ed with it and undo the narrowing.
    SELECT count(*) INTO v_n FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tbl) AND p.polcmd IN ('r', '*') AND p.polpermissive;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'db/107: % has % permissive policies that read it, not one', r.tbl, v_n;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(r.tbl)) THEN
      RAISE EXCEPTION 'db/107: row security is off on %', r.tbl;
    END IF;
  END LOOP;

  -- The panel's columns: exactly these, in this order. The never-list is
  -- checked by name as well, so a reordering that slipped one in is named.
  SELECT string_agg(a.n, ',' ORDER BY a.i) INTO v_cols
    FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(n, m, i)
   WHERE p.oid = to_regprocedure('official_panel(uuid)') AND a.m = 't';
  IF v_cols IS DISTINCT FROM 'id,full_name,panel,active,level,accredited_until,accreditations,linked' THEN
    RAISE EXCEPTION 'db/107: official_panel() returns %', coalesce(v_cols, '(nothing)');
  END IF;
  IF v_cols ~ '(^|,)(born|id_number|email|phone|person_id|created_by)(,|$)' THEN
    RAISE EXCEPTION 'db/107: official_panel() returns a column on the never-list: %', v_cols;
  END IF;

  -- The doors: stable definers with a pinned path, executable by scrbrd_app
  -- and by nobody else.
  FOR r IN SELECT x FROM unnest(ARRAY['app_enrolled_at(uuid)', 'official_panel(uuid)', 'official_conflict(uuid,uuid)']) x LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = to_regprocedure(r.x) AND prosecdef AND provolatile = 's'
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/107: % is not a stable SECURITY DEFINER with a pinned path', r.x;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', to_regprocedure(r.x), 'EXECUTE') THEN
      RAISE EXCEPTION 'db/107: the application cannot call %', r.x;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                WHERE p.oid = to_regprocedure(r.x) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname IN ('anon', 'authenticated')
                     AND has_function_privilege(g.oid, to_regprocedure(r.x), 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/107: % is executable by PUBLIC or a managed host''s API role', r.x;
    END IF;
  END LOOP;
  -- The panel and the conflict flag refuse the pad and anybody not enrolled.
  IF (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('official_panel(uuid)')) NOT LIKE '%app_enrolled() AND NOT app_pad_scoped()%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('official_conflict(uuid,uuid)')) NOT LIKE '%NOT app_enrolled() OR app_pad_scoped()%' THEN
    RAISE EXCEPTION 'db/107: official_panel() or official_conflict() lost its gate';
  END IF;
END $check$;


-- ── the ledger row, with the hash the migrator would record and the commit
--    this bundle was generated from ──
INSERT INTO schema_migration (name, sha256, note) VALUES ('107_official_register_closed.sql', 'c98c12f957142b6aab318428d4ba3e2dcdd81dc90659b44ca05bd9505c1dd3de', '4789aebecc8b499ccc6eb7dc528735825c05d706');

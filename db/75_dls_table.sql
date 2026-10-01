-- ══════════════════════════════════════════════════════════════════
--  75 · The DLS Standard Edition resource table: storage, provenance,
--       loading, the frozen reference (SCRBRD-130 phase R2)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-130_rain_and_par.md §3–§4,
-- built to D5–D7 as decided (Kameel, 2026-09-30); permission to use the
-- table granted by the school (Kameel) for the pilot, 2026-10-01. Its §9
-- records the build.
--
-- NO NUMBER OF THE TABLE IS IN THIS FILE, OR IN ANY FILE OF THE REPOSITORY
-- (D5). The table is reference data that must NOT be a migration: an
-- operator holding platform.reference.manage loads it from the official
-- source (a CSV held outside the repository) through
-- POST /api/admin/dls-tables, which calls dls_table_load() below; reviews
-- the structural report; and publishes. packages/scoring/test/dls.test.mjs
-- greps the repository for a literal resource row, and db/99 §54 proves
-- every rule here on the synthetic table alone ("SYNTHETIC — tests only",
-- which dls_table_publish() refuses to publish).
--
-- WHAT IS HERE.
--   platform.reference.manage          the capability (platform-only): the
--                                      platform administrator's and the owner's
--   dls_resource_table                 one row per version: grain, size,
--                                      provenance, the permission and who
--                                      confirmed it, the content hash, status
--                                      (draft → published → withdrawn), and
--                                      who loaded, published, withdrew it
--   dls_resource                       its cells: R(b, w) in tenths of a percent
--   dls_table_guard / dls_resource_guard  a published table never changes: a
--                                      correction is a new version; withdrawal
--                                      keeps every row (a match whose document
--                                      names it still reads it)
--   dls_table_problems(grain, max, cells)  the structural checks (§4.3), the
--                                      same codes as dls.mjs structuralProblems()
--   dls_canonical_text(table)          "b,w,tenths\n" in (b, w) order — the
--                                      string dls.mjs canonicalText() builds;
--                                      the content hash is its sha256
--   dls_table_load(meta, cells)        a draft, refused on any structural
--                                      problem or missing provenance
--   dls_table_publish(t)               refuses a SYNTHETIC title, re-checks
--   dls_table_withdraw(t, note)
--   dls_tables()                       the list, with provenance and no cell,
--                                      for the operator
--   dls_table_for_match(m)             the table a match's document names
--                                      (target.dls_table), else the current
--                                      published one (`current`), WITH its cells,
--                                      for the server's calculator only: the
--                                      API never returns a cell (D6); for
--                                      whoever may read the match's result
--   target.dls_table                   the catalogue key (play, object, the
--                                      platform's): match_conditions_compute()
--                                      fills it from the published table in
--                                      force at fixing, sources 'platform', so
--                                      a match reads one table forever; a
--                                      competition or a fixture never sets it
--
-- RLS. Both tables: row-level security on and no policy, no grant to the
-- application. Every read and write is a SECURITY DEFINER function above,
-- each behind its own guard.

-- ── 0 · What this file replaces, before it does ───────────────────
DO $guard$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'match_conditions_compute(uuid)'::regprocedure)
     IS DISTINCT FROM '77d5096eef15abe956f32cb95c8eea5b' THEN
    RAISE EXCEPTION 'db/75: match_conditions_compute(uuid) is not db/69''s any more; merge this file''s marked block into the version now in place and move its hash';
  END IF;
END $guard$;
DROP TABLE IF EXISTS _db75_before;
CREATE TEMP TABLE _db75_before AS
SELECT jsonb_build_object(
         'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef, 'volatility', p.provolatile, 'strict', p.proisstrict,
         'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
         'language', p.prolang) AS shape
  FROM pg_proc p WHERE p.oid = 'match_conditions_compute(uuid)'::regprocedure;

-- ── 1 · The capability ─────────────────────────────────────────────
INSERT INTO capability (name) VALUES ('platform.reference.manage') ON CONFLICT (name) DO NOTHING;
UPDATE capability SET platform_only = true WHERE name = 'platform.reference.manage';
INSERT INTO role_capability (role, capability) VALUES
  ('superadmin',    'platform.reference.manage'),
  ('platformadmin', 'platform.reference.manage')
ON CONFLICT DO NOTHING;

-- ── 2 · The tables ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dls_resource_table (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition                 text NOT NULL DEFAULT 'standard' CHECK (edition = 'standard'),   -- never the Professional Edition
  version                 smallint NOT NULL CHECK (version >= 1),
  title                   text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
  grain                   text NOT NULL CHECK (grain IN ('ball', 'over')),
  max_balls               smallint NOT NULL CHECK (max_balls > 0 AND max_balls % 6 = 0),
  source_publisher        text NOT NULL CHECK (length(btrim(source_publisher)) >= 2),
  source_document         text NOT NULL CHECK (length(btrim(source_document)) >= 2),
  source_edition_date     date NOT NULL,
  permission_note         text NOT NULL CHECK (length(btrim(permission_note)) >= 20),
  permission_confirmed_by uuid NOT NULL REFERENCES app_user(id),
  permission_confirmed_at timestamptz NOT NULL,
  content_hash            text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  row_count               integer NOT NULL CHECK (row_count > 0),
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
  supersedes              uuid REFERENCES dls_resource_table(id),
  loaded_by               uuid NOT NULL REFERENCES app_user(id),
  loaded_at               timestamptz NOT NULL DEFAULT now(),
  published_by            uuid REFERENCES app_user(id),
  published_at            timestamptz,
  withdrawn_by            uuid REFERENCES app_user(id),
  withdrawn_at            timestamptz,
  withdrawn_note          text,
  UNIQUE (edition, version),
  CONSTRAINT dls_table_published_dated CHECK (status = 'draft' OR (published_by IS NOT NULL AND published_at IS NOT NULL)),
  CONSTRAINT dls_table_withdrawn_says_why CHECK (status <> 'withdrawn'
    OR (withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL AND length(btrim(coalesce(withdrawn_note, ''))) >= 10))
);
COMMENT ON TABLE dls_resource_table IS
  'SCRBRD-130 R2: a version of the DLS Standard Edition resource table, with its source and the permission to use it. Loaded by an operator, never by a migration (D5).';

CREATE TABLE IF NOT EXISTS dls_resource (
  table_id        uuid NOT NULL REFERENCES dls_resource_table(id) ON DELETE CASCADE,
  balls_remaining smallint NOT NULL CHECK (balls_remaining >= 0),
  wickets_lost    smallint NOT NULL CHECK (wickets_lost BETWEEN 0 AND 9),
  resource_tenths smallint NOT NULL CHECK (resource_tenths BETWEEN 0 AND 1000),
  PRIMARY KEY (table_id, balls_remaining, wickets_lost)
);

-- A published table never changes: its cells and its identity are fixed;
-- the one move left is published → withdrawn, with who, when and why.
CREATE OR REPLACE FUNCTION dls_table_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'a published DLS table is never deleted: withdraw it' USING ERRCODE = 'check_violation', CONSTRAINT = 'dls_table_kept';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'a DLS table begins as a draft' USING ERRCODE = 'check_violation', CONSTRAINT = 'dls_table_begins_draft';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.id <> OLD.id OR NEW.edition <> OLD.edition OR NEW.version <> OLD.version OR NEW.title <> OLD.title
    OR NEW.grain <> OLD.grain OR NEW.max_balls <> OLD.max_balls OR NEW.content_hash <> OLD.content_hash OR NEW.row_count <> OLD.row_count
    OR NEW.source_publisher <> OLD.source_publisher OR NEW.source_document <> OLD.source_document
    OR NEW.source_edition_date <> OLD.source_edition_date OR NEW.permission_note <> OLD.permission_note
    OR NEW.permission_confirmed_by <> OLD.permission_confirmed_by OR NEW.permission_confirmed_at <> OLD.permission_confirmed_at
    OR NEW.supersedes IS DISTINCT FROM OLD.supersedes OR NEW.loaded_by <> OLD.loaded_by OR NEW.loaded_at <> OLD.loaded_at
    OR NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR (OLD.status = 'withdrawn')
    OR NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'withdrawn'))) THEN
    RAISE EXCEPTION 'a published DLS table never changes: a correction is a new version' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'dls_table_published_immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dls_table_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS dls_table_guard ON dls_resource_table;
CREATE TRIGGER dls_table_guard BEFORE INSERT OR UPDATE OR DELETE ON dls_resource_table
  FOR EACH ROW EXECUTE FUNCTION dls_table_guard();

CREATE OR REPLACE FUNCTION dls_resource_guard() RETURNS trigger AS $$
DECLARE v_status text;
BEGIN
  SELECT t.status INTO v_status FROM dls_resource_table t WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.table_id ELSE NEW.table_id END;
  -- A draft being deleted takes its cells with it; nothing else moves a cell
  -- of a table that is not a draft.
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'a published DLS table never changes: a correction is a new version' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'dls_resource_published_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.table_id <> OLD.table_id THEN
    RAISE EXCEPTION 'a cell belongs to its table' USING ERRCODE = 'check_violation', CONSTRAINT = 'dls_resource_published_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dls_resource_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS dls_resource_guard ON dls_resource;
CREATE TRIGGER dls_resource_guard BEFORE INSERT OR UPDATE OR DELETE ON dls_resource
  FOR EACH ROW EXECUTE FUNCTION dls_resource_guard();

ALTER TABLE dls_resource_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE dls_resource ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dls_resource_table, dls_resource FROM scrbrd_app;
REVOKE ALL ON dls_resource_table, dls_resource FROM PUBLIC;

-- ── 3 · The structural checks, and the canonical text ──────────────
-- What is wrong with a table, as dls.mjs structuralProblems() names it
-- (§4.3). `p_cells` is a jsonb array of [b, w, tenths].
CREATE OR REPLACE FUNCTION dls_table_problems(p_grain text, p_max integer, p_cells jsonb) RETURNS text[] AS $$
DECLARE
  v_out   text[] := '{}';
  v_step  integer;
  v_want  integer;
  v_got   integer;
  v_bad   boolean;
BEGIN
  IF p_grain IS NULL OR p_grain NOT IN ('ball', 'over') OR p_max IS NULL OR p_max <= 0 OR p_max % 6 <> 0 THEN
    RETURN ARRAY['grain'];
  END IF;
  IF jsonb_typeof(p_cells) IS DISTINCT FROM 'array' THEN RETURN ARRAY['missing_cell']; END IF;
  v_step := CASE p_grain WHEN 'over' THEN 6 ELSE 1 END;
  v_want := (p_max / v_step + 1) * 10;
  CREATE TEMP TABLE IF NOT EXISTS _dls_cells (b integer, w integer, t numeric, ok boolean) ON COMMIT DROP;
  DELETE FROM _dls_cells;
  INSERT INTO _dls_cells
  SELECT CASE WHEN jsonb_typeof(e->0) = 'number' THEN (e->>0)::numeric END::integer,
         CASE WHEN jsonb_typeof(e->1) = 'number' THEN (e->>1)::numeric END::integer,
         CASE WHEN jsonb_typeof(e->2) = 'number' THEN (e->>2)::numeric END,
         jsonb_typeof(e) = 'array' AND jsonb_array_length(e) = 3
           AND jsonb_typeof(e->0) = 'number' AND jsonb_typeof(e->1) = 'number' AND jsonb_typeof(e->2) = 'number'
    FROM jsonb_array_elements(p_cells) e;
  -- every cell its grain needs, once, and none it does not
  SELECT count(DISTINCT (b, w)) FILTER (WHERE ok AND b BETWEEN 0 AND p_max AND b % v_step = 0 AND w BETWEEN 0 AND 9),
         bool_or(NOT ok OR b NOT BETWEEN 0 AND p_max OR b % v_step <> 0 OR w NOT BETWEEN 0 AND 9) OR count(*) <> count(DISTINCT (b, w))
    INTO v_got, v_bad FROM _dls_cells;
  IF v_got <> v_want OR coalesce(v_bad, false) THEN v_out := v_out || 'missing_cell'::text; END IF;
  IF EXISTS (SELECT 1 FROM _dls_cells WHERE ok AND (t <> trunc(t) OR t < 0 OR t > 1000)) THEN v_out := v_out || 'out_of_range'::text; END IF;
  IF 'missing_cell' = ANY (v_out) THEN RETURN v_out; END IF;
  IF EXISTS (SELECT 1 FROM _dls_cells WHERE b = 0 AND t <> 0) THEN v_out := v_out || 'not_zero_at_end'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM _dls_cells WHERE b = p_max AND w = 0 AND t = 1000) THEN v_out := v_out || 'not_full_at_start'::text; END IF;
  IF EXISTS (SELECT 1 FROM (SELECT t, lag(t) OVER (PARTITION BY w ORDER BY b) AS before FROM _dls_cells) x WHERE x.t < x.before) THEN
    v_out := v_out || 'not_rising_in_balls'::text; END IF;
  IF EXISTS (SELECT 1 FROM (SELECT t, lag(t) OVER (PARTITION BY b ORDER BY w) AS before FROM _dls_cells) x WHERE x.t > x.before) THEN
    v_out := v_out || 'not_falling_in_wickets'::text; END IF;
  RETURN v_out;
END $$ LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dls_table_problems(text, integer, jsonb) FROM PUBLIC;

-- "b,w,tenths\n" per stored cell, in (b, w) order: dls.mjs canonicalText().
CREATE OR REPLACE FUNCTION dls_canonical_text(p_table uuid) RETURNS text AS $$
  SELECT coalesce(string_agg(r.balls_remaining || ',' || r.wickets_lost || ',' || r.resource_tenths || E'\n', ''
                             ORDER BY r.balls_remaining, r.wickets_lost), '')
    FROM dls_resource r WHERE r.table_id = p_table
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dls_canonical_text(uuid) FROM PUBLIC;

-- ── 4 · Loading, publishing, withdrawing ──────────────────────────
-- Whoever holds platform.reference.manage (platform-only: held through no
-- school), as himself — never a pad's credential or a support session.
CREATE OR REPLACE FUNCTION dls_operator() RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND app_support_access_id() IS NULL
     AND app_holds('platform.reference.manage')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dls_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dls_operator() TO scrbrd_app;

-- A draft from an official source. Answers rather than raises:
-- (ok, reason, detail, table_id, content_hash, row_count, problems).
--   not_permitted · provenance_required · permission_note_required (twenty
--   characters or more: who gave it, for what use, when) · version_taken ·
--   structure (problems lists the checks that failed)
-- `p_meta`: title, version (else the next), grain, maxBalls, sourcePublisher,
-- sourceDocument, sourceEditionDate, permissionNote. `p_cells`: [[b, w, tenths], …].
CREATE OR REPLACE FUNCTION dls_table_load(p_meta jsonb, p_cells jsonb)
RETURNS TABLE (ok boolean, reason text, detail text, table_id uuid, content_hash text, row_count integer, problems text[]) AS $$
DECLARE
  v_problems text[];
  v_version  integer;
  v_id       uuid;
  v_hash     text;
  v_n        integer;
BEGIN
  IF NOT dls_operator() THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid, NULL::text, NULL::integer, NULL::text[]; RETURN;
  END IF;
  IF length(btrim(coalesce(p_meta->>'title', ''))) < 3 OR length(btrim(coalesce(p_meta->>'sourcePublisher', ''))) < 2
     OR length(btrim(coalesce(p_meta->>'sourceDocument', ''))) < 2 OR coalesce(p_meta->>'sourceEditionDate', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN QUERY SELECT false, 'provenance_required', 'a title, the publisher, the document and its edition date',
      NULL::uuid, NULL::text, NULL::integer, NULL::text[]; RETURN;
  END IF;
  IF length(btrim(coalesce(p_meta->>'permissionNote', ''))) < 20 THEN
    RETURN QUERY SELECT false, 'permission_note_required', 'who gave permission, for what use, and when, in twenty characters or more',
      NULL::uuid, NULL::text, NULL::integer, NULL::text[]; RETURN;
  END IF;
  v_problems := dls_table_problems(p_meta->>'grain',
                  CASE WHEN jsonb_typeof(p_meta->'maxBalls') = 'number' THEN (p_meta->>'maxBalls')::numeric::integer END, p_cells);
  IF cardinality(v_problems) > 0 THEN
    RETURN QUERY SELECT false, 'structure', array_to_string(v_problems, ', '), NULL::uuid, NULL::text, NULL::integer, v_problems; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.dls_table'));
  v_version := CASE WHEN jsonb_typeof(p_meta->'version') = 'number' THEN (p_meta->>'version')::numeric::integer
                    ELSE (SELECT coalesce(max(t.version), 0) + 1 FROM dls_resource_table t WHERE t.edition = 'standard') END;
  IF EXISTS (SELECT 1 FROM dls_resource_table t WHERE t.edition = 'standard' AND t.version = v_version) OR v_version < 1 THEN
    RETURN QUERY SELECT false, 'version_taken', format('version %s', v_version), NULL::uuid, NULL::text, NULL::integer, NULL::text[]; RETURN;
  END IF;
  INSERT INTO dls_resource_table (version, title, grain, max_balls, source_publisher, source_document, source_edition_date,
                                  permission_note, permission_confirmed_by, permission_confirmed_at, content_hash, row_count, loaded_by)
  VALUES (v_version, btrim(p_meta->>'title'), p_meta->>'grain', (p_meta->>'maxBalls')::numeric::integer,
          btrim(p_meta->>'sourcePublisher'), btrim(p_meta->>'sourceDocument'), (p_meta->>'sourceEditionDate')::date,
          btrim(p_meta->>'permissionNote'), app_user_id(), now(), repeat('0', 64), jsonb_array_length(p_cells), app_user_id())
  RETURNING id INTO v_id;
  -- The cells, from the argument: never a literal (the D5 grep).
  INSERT INTO dls_resource (table_id, balls_remaining, wickets_lost, resource_tenths)
  SELECT v_id, (e->>0)::integer, (e->>1)::integer, (e->>2)::integer FROM jsonb_array_elements(p_cells) e;
  v_hash := encode(sha256(convert_to(dls_canonical_text(v_id), 'UTF8')), 'hex');
  SELECT count(*) INTO v_n FROM dls_resource r WHERE r.table_id = v_id;
  UPDATE dls_resource_table SET content_hash = v_hash, row_count = v_n WHERE id = v_id;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id, v_hash, v_n, '{}'::text[];
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dls_table_load(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dls_table_load(jsonb, jsonb) TO scrbrd_app;

-- Publish a draft: (ok, reason, detail). not_permitted · not_found ·
-- not_draft · synthetic_title (the tests' table is never published) ·
-- structure (re-checked) · hash_moved (the cells are not what was hashed).
-- It supersedes the newest table published before it.
CREATE OR REPLACE FUNCTION dls_table_publish(p_table uuid)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE t dls_resource_table%ROWTYPE; v_problems text[]; v_cells jsonb;
BEGIN
  IF NOT dls_operator() THEN RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.dls_table'));
  SELECT * INTO t FROM dls_resource_table x WHERE x.id = p_table FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_found', NULL::text; RETURN; END IF;
  IF t.status <> 'draft' THEN RETURN QUERY SELECT false, 'not_draft', t.status; RETURN; END IF;
  IF upper(btrim(t.title)) LIKE 'SYNTHETIC%' THEN
    RETURN QUERY SELECT false, 'synthetic_title', 'the synthetic table is for tests only and is never published'; RETURN;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_array(r.balls_remaining, r.wickets_lost, r.resource_tenths)), '[]') INTO v_cells
    FROM dls_resource r WHERE r.table_id = p_table;
  v_problems := dls_table_problems(t.grain, t.max_balls, v_cells);
  IF cardinality(v_problems) > 0 THEN RETURN QUERY SELECT false, 'structure', array_to_string(v_problems, ', '); RETURN; END IF;
  IF encode(sha256(convert_to(dls_canonical_text(p_table), 'UTF8')), 'hex') <> t.content_hash THEN
    RETURN QUERY SELECT false, 'hash_moved', NULL::text; RETURN;
  END IF;
  UPDATE dls_resource_table SET status = 'published', published_by = app_user_id(), published_at = now(),
         supersedes = coalesce(t.supersedes, (SELECT x.id FROM dls_resource_table x WHERE x.edition = 'standard'
                                                AND x.status = 'published' ORDER BY x.version DESC LIMIT 1))
   WHERE id = p_table;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dls_table_publish(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dls_table_publish(uuid) TO scrbrd_app;

-- Withdraw a published table, with a note: its rows stay, and every match
-- whose document names it still reads it (the screen says "since withdrawn").
CREATE OR REPLACE FUNCTION dls_table_withdraw(p_table uuid, p_note text)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE t dls_resource_table%ROWTYPE;
BEGIN
  IF NOT dls_operator() THEN RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN; END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 10 THEN RETURN QUERY SELECT false, 'note_required', 'say why, in ten characters or more'; RETURN; END IF;
  SELECT * INTO t FROM dls_resource_table x WHERE x.id = p_table FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_found', NULL::text; RETURN; END IF;
  IF t.status <> 'published' THEN RETURN QUERY SELECT false, 'not_published', t.status; RETURN; END IF;
  UPDATE dls_resource_table SET status = 'withdrawn', withdrawn_by = app_user_id(), withdrawn_at = now(), withdrawn_note = btrim(p_note)
   WHERE id = p_table;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dls_table_withdraw(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dls_table_withdraw(uuid, text) TO scrbrd_app;

-- The tables and their provenance, never a cell, for the operator.
CREATE OR REPLACE FUNCTION dls_tables()
RETURNS TABLE (id uuid, version smallint, title text, grain text, max_balls smallint, status text,
               source_publisher text, source_document text, source_edition_date date, permission_note text,
               permission_confirmed_at timestamptz, content_hash text, row_count integer, supersedes uuid,
               loaded_at timestamptz, published_at timestamptz, withdrawn_at timestamptz, withdrawn_note text) AS $$
  SELECT t.id, t.version, t.title, t.grain, t.max_balls, t.status, t.source_publisher, t.source_document, t.source_edition_date,
         t.permission_note, t.permission_confirmed_at, t.content_hash, t.row_count, t.supersedes,
         t.loaded_at, t.published_at, t.withdrawn_at, t.withdrawn_note
    FROM dls_resource_table t
   WHERE dls_operator()
   ORDER BY t.version DESC
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dls_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dls_tables() TO scrbrd_app;

-- ── 5 · The table a match's calculator reads (server-side only, D6) ─
-- The table the match's frozen document names (target.dls_table), else
-- the newest published one (`current`: the screen says so, §3.6). With its
-- cells, for the read API's calculator: no route returns them. For whoever
-- may read the match's result.
CREATE OR REPLACE FUNCTION dls_table_for_match(p_match uuid)
RETURNS TABLE (id uuid, version smallint, title text, grain text, max_balls smallint, status text, content_hash text,
               current boolean, cells jsonb) AS $$
  WITH named AS (
    SELECT (c.doc->'play'->'target.dls_table'->>'id')::uuid AS id
      FROM match_conditions c
     WHERE c.match_id = p_match AND jsonb_typeof(c.doc->'play'->'target.dls_table') = 'object'
  ),
  chosen AS (
    SELECT t.*, false AS current FROM dls_resource_table t JOIN named n ON n.id = t.id WHERE t.status IN ('published', 'withdrawn')
    UNION ALL
    SELECT t.*, true FROM dls_resource_table t
     WHERE NOT EXISTS (SELECT 1 FROM named) AND t.edition = 'standard' AND t.status = 'published'
       AND t.version = (SELECT max(x.version) FROM dls_resource_table x WHERE x.edition = 'standard' AND x.status = 'published')
  )
  SELECT t.id, t.version, t.title, t.grain, t.max_balls, t.status, t.content_hash, t.current,
         (SELECT coalesce(jsonb_agg(jsonb_build_array(r.balls_remaining, r.wickets_lost, r.resource_tenths)
                                    ORDER BY r.balls_remaining, r.wickets_lost), '[]') FROM dls_resource r WHERE r.table_id = t.id)
    FROM chosen t
   WHERE match_result_readable(p_match)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dls_table_for_match(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dls_table_for_match(uuid) TO scrbrd_app;

-- ── 6 · The catalogue key: the platform's, never a competition's ──
INSERT INTO playing_condition_key (key, part, value_type, unit, enum_values, by_age_band, platform_default, readers, sort_order) VALUES
  ('target.dls_table', 'play', 'object', NULL, NULL, false, NULL, '{pad,sql}', 92)
ON CONFLICT (key) DO NOTHING;

-- A competition's version or a fixture's departure never names the table: the
-- resolver fills it from the platform's published table at fixing.
CREATE OR REPLACE FUNCTION condition_platform_key_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.key = 'target.dls_table' THEN
    RAISE EXCEPTION 'target.dls_table is the platform''s: the published DLS table in force when the match is fixed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'condition_platform_key';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION condition_platform_key_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS condition_platform_key_guard ON condition_value;
CREATE TRIGGER condition_platform_key_guard BEFORE INSERT OR UPDATE ON condition_value
  FOR EACH ROW EXECUTE FUNCTION condition_platform_key_guard();
DROP TRIGGER IF EXISTS condition_platform_key_guard ON match_condition_override;
CREATE TRIGGER condition_platform_key_guard BEFORE INSERT OR UPDATE ON match_condition_override
  FOR EACH ROW EXECUTE FUNCTION condition_platform_key_guard();

-- ── 7 · Freezing the reference: db/69's resolver, with one marked block ─
-- db/69's match_conditions_compute(), line for line, but for the block that
-- fills target.dls_table from the newest published Standard table, sources
-- 'platform'. A match fixed with no table published has none, for ever, and
-- reads the current table with the words saying so (§3.6).
CREATE OR REPLACE FUNCTION match_conditions_compute(p_match uuid)
RETURNS TABLE (set_id uuid, set_version smallint, doc jsonb, sources jsonb) AS $$
DECLARE
  m        match%ROWTYPE;
  v_day    date;
  v_set    condition_set%ROWTYPE;
  k        playing_condition_key%ROWTYPE;
  v_val    jsonb;
  v_src    jsonb;
  v_parts  jsonb := '{"play": {}, "table": {}, "sheet": {}}';
  v_srcs   jsonb := '{}';
  v_row    condition_value%ROWTYPE;
  v_ovr    match_condition_override%ROWTYPE;
  v_fixture jsonb;
  v_band   jsonb;
  v_bsrc   jsonb;
BEGIN
  SELECT * INTO m FROM match WHERE id = p_match;
  IF NOT FOUND THEN RETURN; END IF;
  v_day := (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date;
  IF m.competition_id IS NOT NULL THEN
    SELECT * INTO v_set FROM condition_set s WHERE s.id = condition_set_for(m.competition_id, v_day);
  END IF;
  FOR k IN SELECT * FROM playing_condition_key ORDER BY sort_order, key LOOP
    v_val := NULL; v_src := NULL; v_fixture := NULL;
    -- 1. the platform's default
    IF k.platform_default IS NOT NULL THEN
      v_val := k.platform_default;
      v_src := jsonb_build_object('from', 'platform_default', 'status', 'unconfirmed');
    END IF;
    -- 2. the version in force
    IF v_set.id IS NOT NULL THEN
      IF k.by_age_band THEN
        v_band := NULL; v_bsrc := NULL;
        FOR v_row IN SELECT * FROM condition_value cv WHERE cv.set_id = v_set.id AND cv.key = k.key ORDER BY cv.age_band LOOP
          v_band := coalesce(v_band, '{}') || jsonb_build_object(v_row.age_band, v_row.value);
          v_bsrc := coalesce(v_bsrc, '{}') || jsonb_build_object(v_row.age_band, jsonb_strip_nulls(jsonb_build_object(
                      'from', 'set', 'status', v_row.status, 'version', v_set.version,
                      'document', v_row.source_document, 'clause', v_row.source_clause, 'date', v_row.source_date)));
        END LOOP;
        IF v_band IS NOT NULL THEN v_val := v_band; v_src := v_bsrc; END IF;
      ELSE
        SELECT * INTO v_row FROM condition_value cv WHERE cv.set_id = v_set.id AND cv.key = k.key AND cv.age_band = '';
        IF FOUND THEN
          v_val := v_row.value;
          v_src := jsonb_strip_nulls(jsonb_build_object('from', 'set', 'status', v_row.status, 'version', v_set.version,
                     'document', v_row.source_document, 'clause', v_row.source_clause, 'date', v_row.source_date));
        END IF;
      END IF;
    END IF;
    -- 3. the fixture: what the umpires agreed on the day, and what the
    --    fixture screen shows. The free hit follows the version when it
    --    states one, else the format, as today.
    v_fixture := CASE k.key
      WHEN 'format.kind' THEN
        CASE WHEN btrim(coalesce(m.format, '')) = '' THEN NULL
             WHEN free_hits_apply(m.format) THEN '"limited"'::jsonb ELSE '"declaration"'::jsonb END
      WHEN 'format.overs_per_innings' THEN to_jsonb(m.overs::integer)
      WHEN 'format.innings_per_side' THEN
        -- db/69: two innings a side for a two-day or longer match only.
        CASE WHEN btrim(coalesce(m.format, '')) = '' THEN NULL
             WHEN lower(regexp_replace(btrim(m.format), '\s+', ' ', 'g')) IN
                  ('two-day', 'two day', 'three-day', 'three day', 'four-day', 'four day', 'five-day', 'five day',
                   'multi-day', 'multi day', 'test') THEN '2'::jsonb
             ELSE '1'::jsonb END
      WHEN 'format.free_hit' THEN
        CASE WHEN v_src->>'from' = 'set' THEN NULL ELSE to_jsonb(free_hits_apply(m.format)) END
    END;
    IF v_fixture IS NOT NULL AND jsonb_typeof(v_fixture) <> 'null' THEN
      v_val := v_fixture;
      v_src := jsonb_build_object('from', 'fixture', 'status', 'confirmed');
    END IF;
    -- 4. the fixture's own departures, each with its reason
    IF k.by_age_band THEN
      FOR v_ovr IN SELECT * FROM match_condition_override o WHERE o.match_id = p_match AND o.key = k.key ORDER BY o.age_band LOOP
        v_val := CASE WHEN jsonb_typeof(v_val) = 'object' THEN v_val ELSE '{}' END || jsonb_build_object(v_ovr.age_band, v_ovr.value);
        v_src := CASE WHEN jsonb_typeof(v_src) = 'object' AND v_src->>'from' IS NULL THEN v_src ELSE '{}' END
                 || jsonb_build_object(v_ovr.age_band, jsonb_build_object('from', 'override', 'status', 'confirmed', 'reason', v_ovr.reason));
      END LOOP;
    ELSE
      SELECT * INTO v_ovr FROM match_condition_override o WHERE o.match_id = p_match AND o.key = k.key AND o.age_band = '';
      IF FOUND THEN
        v_val := v_ovr.value;
        v_src := jsonb_build_object('from', 'override', 'status', 'confirmed', 'reason', v_ovr.reason);
      END IF;
    END IF;
    -- ── SCRBRD-130 R2 (§4.4): the DLS table in force at fixing, the platform's ──
    IF k.key = 'target.dls_table' THEN
      SELECT jsonb_build_object('id', t.id, 'version', t.version, 'hash', t.content_hash) INTO v_val
        FROM dls_resource_table t
       WHERE t.edition = 'standard' AND t.status = 'published'
       ORDER BY t.version DESC LIMIT 1;
      v_src := CASE WHEN v_val IS NOT NULL THEN jsonb_build_object('from', 'platform', 'status', 'confirmed') END;
    END IF;
    -- ── end SCRBRD-130 R2 ──
    IF v_val IS NOT NULL THEN
      v_parts := jsonb_set(v_parts, ARRAY[k.part], (v_parts->k.part) || jsonb_build_object(k.key, v_val));
    END IF;
    -- A key a reader consults says where its figure came from, stated or not.
    IF v_src IS NOT NULL THEN
      v_srcs := v_srcs || jsonb_build_object(k.key, v_src);
    ELSIF cardinality(k.readers) > 0 THEN
      v_srcs := v_srcs || jsonb_build_object(k.key, jsonb_build_object('from', 'platform_default', 'status', 'unconfirmed'));
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_set.id, v_set.version, jsonb_build_object('v', 1) || v_parts, v_srcs;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_conditions_compute(uuid) FROM PUBLIC;

-- ── 8 · Grants ────────────────────────────────────────────────────
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON dls_resource_table, dls_resource FROM %I', r);
      FOREACH f IN ARRAY ARRAY['dls_operator()', 'dls_table_load(jsonb,jsonb)', 'dls_table_publish(uuid)',
                               'dls_table_withdraw(uuid,text)', 'dls_tables()', 'dls_table_for_match(uuid)',
                               'dls_table_problems(text,integer,jsonb)', 'dls_canonical_text(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;

-- ── 9 · The proof ────────────────────────────────────────────────
-- Built and rolled back; db/99 §54 is the fuller proof under the
-- application role. Here, as the owner: the resolver kept its shape; the
-- structural checks on a four-cell sliver; a published table's cell refuses
-- to move.
DO $check$
DECLARE
  v_user uuid := gen_random_uuid();
  v_t    uuid;
  v_ok   boolean;
BEGIN
  IF (SELECT jsonb_build_object(
            'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
            'definer', p.prosecdef, 'volatility', p.provolatile, 'strict', p.proisstrict,
            'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
            'language', p.prolang) FROM pg_proc p WHERE p.oid = 'match_conditions_compute(uuid)'::regprocedure)
     IS DISTINCT FROM (SELECT shape FROM _db75_before) THEN
    RAISE EXCEPTION 'db/75: match_conditions_compute changed shape';
  END IF;
  IF has_table_privilege('scrbrd_app', 'dls_resource', 'SELECT') OR has_table_privilege('scrbrd_app', 'dls_resource_table', 'SELECT') THEN
    RAISE EXCEPTION 'db/75: the application reads a DLS table directly';
  END IF;
  -- A 6-ball table by the over: (0, 6) × 10 wickets; R(6,w) = 1000 − 100w.
  IF cardinality(dls_table_problems('over', 6, (SELECT jsonb_agg(jsonb_build_array(b, w, CASE WHEN b = 0 THEN 0 ELSE 1000 - 100 * w END))
                                                  FROM generate_series(0, 6, 6) b, generate_series(0, 9) w))) <> 0
     OR dls_table_problems('over', 6, '[]'::jsonb) <> ARRAY['missing_cell']
     OR dls_table_problems('inning', 6, '[]'::jsonb) <> ARRAY['grain'] THEN
    RAISE EXCEPTION 'db/75: the structural checks misjudge a sliver';
  END IF;
  BEGIN
    INSERT INTO app_user (id, email, name, role) VALUES (v_user, 'db75-' || v_user || '@example.invalid', 'db/75 proof', 'scorer');
    INSERT INTO dls_resource_table (version, title, grain, max_balls, source_publisher, source_document, source_edition_date,
                                    permission_note, permission_confirmed_by, permission_confirmed_at, content_hash, row_count, loaded_by)
    SELECT 999, 'SYNTHETIC — db/75 proof', 'over', 6, 'db/75', 'db/75 proof', DATE '2026-10-01',
           'db/75 proof: rolled back, nobody''s permission', v_user, now(), repeat('a', 64), 20, v_user
    RETURNING id INTO v_t;
    INSERT INTO dls_resource (table_id, balls_remaining, wickets_lost, resource_tenths)
    SELECT v_t, b, w, CASE WHEN b = 0 THEN 0 ELSE 1000 - 100 * w END FROM generate_series(0, 6, 6) b, generate_series(0, 9) w;
    UPDATE dls_resource_table SET status = 'published', published_by = v_user, published_at = now() WHERE id = v_t;
    BEGIN
      UPDATE dls_resource SET resource_tenths = 999 WHERE table_id = v_t AND balls_remaining = 6 AND wickets_lost = 0;
      v_ok := true;
    EXCEPTION WHEN check_violation THEN v_ok := false;
    END;
    IF v_ok THEN RAISE EXCEPTION 'db/75: a published table''s cell moved'; END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ075', MESSAGE = 'db/75: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ075' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM dls_resource_table WHERE version = 999) THEN RAISE EXCEPTION 'db/75: the proof left something behind'; END IF;
END $check$;

DROP TABLE _db75_before;

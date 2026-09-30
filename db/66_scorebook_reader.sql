-- ══════════════════════════════════════════════════════════════════
--  66 · The scorebook importer, phase 4: the reader (SCRBRD-120)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-120_scorebook_importer.md
-- §6 (the reader contract) and D8 (the reader is a third-party operator: it
-- ships only behind its own switch, nothing is sent until the information
-- officer signs, and only the pages are sent — never a roster). Phase 1 is
-- db/63 as built (§9.2, §9.4); this file applies after db/63 and db/64 and
-- depends on nothing later. §9.5 records it as built.
--
-- WHAT IS HERE.
--
--   feature `scorebook_reader`  a FEATURE inside the scorebook_import module,
--                               off. It is on for a school only through a
--                               platform grant FOR THAT SCHOOL: the platform
--                               default switched on (or locked on) turns it on
--                               for nobody (scorebook_reader_on()). The
--                               information officer's sign-off is the
--                               precondition of every grant
--                               (docs/policy/SCOREBOOK_READER_SIGNOFF.md).
--   scorebook_import.reading_*  who pressed Read, when, for which innings, and
--                               the state to go back to if the read fails.
--   scorebook_import.read_by    THE PROCESSING RECORD (POPIA s17): one entry
--                               per time pages left the platform — provider,
--                               model, time, the sha256 of every page sent, the
--                               innings asked for, the outcome and who pressed
--                               Read. Written whether the read succeeded or
--                               not: a page sent is a page sent. Kept with the
--                               import's rows after the photos are deleted.
--   scorebook_import.read_cells what the screen needs to tint and point: per
--                               innings read, per cell, the reader's
--                               confidence, the page, the box on it, and the
--                               value the reader put in the card (a figure, a
--                               code, or the ref the API chose — never a name
--                               as read), so a cell the person has since
--                               changed is no longer tinted as the reader's.
--   scorebook_reader_may()      may this caller have this import read: a
--                               writer, the module on, the reader on for the
--                               school. False to everybody else.
--   scorebook_import_read_start()  draft/review/returned → reading, the live
--                               pages' keys to the API, one access_log row per
--                               page (the photo leaves the store for the
--                               reader), before a byte is fetched.
--   scorebook_import_read_done()   reading → review with the read card added
--                               (as a `read` revision authored by the person
--                               who pressed Read), or back where it was when
--                               the reader could not read it; read_by written
--                               either way when pages were sent.
--
-- WHO. As db/63: every function decides who (scorebook_may(): signed in, not
-- a pad's credential, not a support session, scoring.import.write over the
-- fixture), asks the module for the fixture's school, and answers rather than
-- raises. The reader's card is a draft like a typed one: every cell still
-- needs a person's tick before a submit (the ticks are not carried over — a
-- read cell starts unticked), and a person who pressed Read has authored the
-- card, so scorebook_authored() (db/63, which counts `read`) keeps them from
-- confirming it.
--
-- NOT HERE: the provider. The API (services/api/ai/scorebook-reader.mjs) is
-- the only thing that talks to it, and it sends the page photos and a hint
-- (the innings, the balls per over), nothing else. This file cannot stop an
-- API from sending more; it records what was sent and refuses a record that
-- names a page the import does not have.
--
-- search_path is pinned on every function (db/16). Idempotent. db/99 §44 is
-- the proof with principals.

-- ── 1 · The switch ─────────────────────────────────────────────────
INSERT INTO feature_flag (key, kind, label, enabled, reason) VALUES
  ('scorebook_reader', 'feature', 'Scorebook reader', false,
   'SCRBRD-120 phase 4 (D8): photos of a scorebook''s pages are sent to a third-party AI model to pre-fill the card. '
   'Off until the information officer signs docs/policy/SCOREBOOK_READER_SIGNOFF.md; then granted per school, '
   'only where that school''s privacy notice names the processing. The platform default turns it on for nobody.')
ON CONFLICT (key) DO NOTHING;

-- ── 2 · The columns ────────────────────────────────────────────────
ALTER TABLE scorebook_import ADD COLUMN IF NOT EXISTS reading_from    text;
ALTER TABLE scorebook_import ADD COLUMN IF NOT EXISTS reading_by      uuid REFERENCES app_user(id);
ALTER TABLE scorebook_import ADD COLUMN IF NOT EXISTS reading_since   timestamptz;
ALTER TABLE scorebook_import ADD COLUMN IF NOT EXISTS reading_innings smallint;
ALTER TABLE scorebook_import ADD COLUMN IF NOT EXISTS read_cells      jsonb NOT NULL DEFAULT '{}';
COMMENT ON COLUMN scorebook_import.read_by IS
  'SCRBRD-120 D8: the processing record — one entry per time pages were sent to the reader: {provider, model, at, pageHashes[], innings, outcome, by}.';
COMMENT ON COLUMN scorebook_import.read_cells IS
  'SCRBRD-120 §6.3: per innings read, per cell path: {c: confidence, p: page, b: box [x,y,w,h] as fractions of the page, v: the value placed}. No name as read.';

DO $cons$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reading_rows_say_who' AND conrelid = 'scorebook_import'::regclass) THEN
    ALTER TABLE scorebook_import ADD CONSTRAINT reading_rows_say_who CHECK (state <> 'reading'
      OR (reading_by IS NOT NULL AND reading_since IS NOT NULL AND reading_innings BETWEEN 0 AND 3
          AND reading_from IN ('draft', 'review', 'returned')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'read_by_is_a_list' AND conrelid = 'scorebook_import'::regclass) THEN
    ALTER TABLE scorebook_import ADD CONSTRAINT read_by_is_a_list CHECK (read_by IS NULL OR jsonb_typeof(read_by) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'read_cells_is_a_map' AND conrelid = 'scorebook_import'::regclass) THEN
    ALTER TABLE scorebook_import ADD CONSTRAINT read_cells_is_a_map CHECK (jsonb_typeof(read_cells) = 'object');
  END IF;
END $cons$;

-- ── 3 · Is the reader on ───────────────────────────────────────────
-- For one school: the feature through its three levels (feature_enabled():
-- the platform, the school's grant, a suppression) AND a grant written for
-- THIS school by the platform. So a platform default switched on, or locked
-- on, sends nobody's pages; only a school the platform granted it to — after
-- the sign-off — has a reader, and a school or a person suppressing it has
-- none.
CREATE OR REPLACE FUNCTION scorebook_reader_on(p_school uuid) RETURNS boolean AS $$
  SELECT coalesce(feature_enabled('scorebook_reader', p_school, app_user_id()), false)
     AND EXISTS (SELECT 1 FROM feature_grant g WHERE g.key = 'scorebook_reader' AND g.school_id = p_school AND g.granted)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- How long a read may be "in progress" before anybody may start another or
-- give up on it (the API gives the provider sixty seconds; a crashed API
-- leaves the import reading, and this is how it is let go).
CREATE OR REPLACE FUNCTION scorebook_read_stale() RETURNS interval AS $$
  SELECT interval '5 minutes'
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- May the caller have this import read? A writer of it, the module on, the
-- reader on for its school. False for anybody else — no import is named.
CREATE OR REPLACE FUNCTION scorebook_reader_may(p_import uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT scorebook_may('scoring.import.write', i.match_id)
                      AND coalesce(feature_enabled('scorebook_import', i.school_id, app_user_id()), false)
                      AND scorebook_reader_on(i.school_id)
                     FROM scorebook_import i WHERE i.id = p_import), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 4 · Read: start ────────────────────────────────────────────────
/**
 * The writer pressed Read for one innings. The import goes to `reading`
 * (every write of db/63 refuses it until the read is done), and the API is
 * told the live pages' keys, hashes and types to fetch and send. One
 * access_log row per page, written here, before the photo is fetched: the
 * record of "who caused this photo to leave the store" exists even if the
 * API then fails. Optimistic on the version, as a save is: a read never
 * lands on a card somebody else has saved since the screen loaded.
 * A read already in progress is refused (`reading`) until it is older than
 * scorebook_read_stale(), after which a writer may start again.
 */
CREATE OR REPLACE FUNCTION scorebook_import_read_start(p_import uuid, p_innings integer, p_version integer)
RETURNS TABLE (ok boolean, reason text, detail text, pages jsonb) AS $$
DECLARE i scorebook_import%ROWTYPE; v_pages jsonb;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.write', i.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::jsonb; RETURN;
  END IF;
  IF NOT feature_enabled('scorebook_import', i.school_id, app_user_id()) THEN
    RETURN QUERY SELECT false, 'module_disabled', NULL::text, NULL::jsonb; RETURN;
  END IF;
  IF NOT scorebook_reader_on(i.school_id) THEN
    RETURN QUERY SELECT false, 'reader_off', 'the scorebook reader is not on for this school', NULL::jsonb; RETURN;
  END IF;
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import FOR UPDATE;
  IF i.state = 'reading' AND i.reading_since > now() - scorebook_read_stale() THEN
    RETURN QUERY SELECT false, 'reading', i.reading_since::text, NULL::jsonb; RETURN;
  END IF;
  IF i.state NOT IN ('draft', 'review', 'returned', 'reading') THEN
    RETURN QUERY SELECT false, 'not_editable', i.state, NULL::jsonb; RETURN;
  END IF;
  IF p_version IS DISTINCT FROM i.version THEN
    RETURN QUERY SELECT false, 'version_conflict', i.version::text, NULL::jsonb; RETURN;
  END IF;
  IF p_innings IS NULL OR p_innings NOT BETWEEN 0 AND 3 THEN
    RETURN QUERY SELECT false, 'innings_invalid', 'an innings from 0 to 3', NULL::jsonb; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(i.card) e WHERE e->'innings' = to_jsonb(p_innings)) THEN
    RETURN QUERY SELECT false, 'innings_on_card', 'remove that innings from the card first', NULL::jsonb; RETURN;
  END IF;
  IF jsonb_array_length(i.card) >= 4 THEN
    RETURN QUERY SELECT false, 'card_full', 'four innings at most', NULL::jsonb; RETURN;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('pageNo', pg.page_no, 'key', pg.object_key, 'sha256', pg.sha256, 'mime', pg.mime)
                            ORDER BY pg.page_no), '[]')
    INTO v_pages
    FROM scorebook_import_page pg
   WHERE pg.import_id = p_import AND pg.removed_at IS NULL AND pg.deleted_at IS NULL;
  IF jsonb_array_length(v_pages) = 0 THEN
    RETURN QUERY SELECT false, 'no_pages', 'add the page photos first', NULL::jsonb; RETURN;
  END IF;
  UPDATE scorebook_import
     SET state = 'reading',
         reading_from = CASE WHEN i.state = 'reading' THEN i.reading_from ELSE i.state END,
         reading_by = app_user_id(), reading_since = now(), reading_innings = p_innings
   WHERE id = p_import;
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count, fields, device_id)
  SELECT i.school_id, app_user_id(), 'scorebook_page', ARRAY[i.id], 1, ARRAY['page:' || (p->>'pageNo'), 'to:reader'], app_device_id()
    FROM jsonb_array_elements(v_pages) p;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_pages;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 5 · Read: done ─────────────────────────────────────────────────
/**
 * The reader answered, or could not.
 *
 * p_outcome 'read': p_card is the read card (one innings, the one asked for,
 * already turned into a ScorebookCard by the API: our boys matched to the
 * roster there or left for the person, the opposition typed), p_typed the
 * new typed names it uses, p_cells the per-cell record for the screen. The
 * card is added to the import's list, its cells unticked, the state
 * `review`, and a `read` revision is written — authored by the person who
 * pressed Read.
 *
 * Any other outcome (unavailable, refused, timeout, not_sent): nothing is
 * added, the import goes back to the state it was read from (so the person
 * types the card, §6.4), and a `read` revision says it was not read.
 *
 * Either way, when p_provider is given — the pages were sent — read_by gains
 * the processing record: provider, model, time, the pages' hashes (each one
 * of this import's live pages, or the record is refused), the innings, the
 * outcome, and who. Only the person who pressed Read finishes the read; a
 * read left longer than scorebook_read_stale() may be given up on by any
 * writer (an outcome other than 'read').
 */
CREATE OR REPLACE FUNCTION scorebook_import_read_done(
  p_import uuid, p_card jsonb, p_typed jsonb, p_cells jsonb,
  p_provider text, p_model text, p_page_hashes text[], p_outcome text)
RETURNS TABLE (ok boolean, reason text, detail text, version integer) AS $$
DECLARE
  i        scorebook_import%ROWTYPE;
  v        integer;
  v_n      integer;
  v_record jsonb;
  v_checked jsonb;
  v_note   text;
  uuid_re  text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.write', i.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::integer; RETURN;
  END IF;
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import FOR UPDATE;
  IF i.state <> 'reading' THEN RETURN QUERY SELECT false, 'not_reading', i.state, i.version; RETURN; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('read', 'unavailable', 'refused', 'timeout', 'not_sent') THEN
    RETURN QUERY SELECT false, 'outcome_invalid', NULL::text, i.version; RETURN;
  END IF;
  IF i.reading_by IS DISTINCT FROM app_user_id()
     AND NOT (p_outcome <> 'read' AND i.reading_since <= now() - scorebook_read_stale()) THEN
    RETURN QUERY SELECT false, 'not_yours', 'the person who pressed Read finishes it', i.version; RETURN;
  END IF;
  -- The processing record, when anything was sent.
  IF p_provider IS NOT NULL THEN
    IF p_provider !~ '^[a-z0-9][a-z0-9._-]{0,31}$' OR p_model IS NULL OR p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$' THEN
      RETURN QUERY SELECT false, 'record_invalid', 'a provider and a model, by their codes', i.version; RETURN;
    END IF;
    IF cardinality(coalesce(p_page_hashes, '{}')) = 0
       OR EXISTS (SELECT 1 FROM unnest(p_page_hashes) h
                   WHERE NOT EXISTS (SELECT 1 FROM scorebook_import_page pg
                                      WHERE pg.import_id = p_import AND pg.sha256 = h AND pg.removed_at IS NULL AND pg.deleted_at IS NULL)) THEN
      RETURN QUERY SELECT false, 'pages_unknown', 'the record names a page this import does not have', i.version; RETURN;
    END IF;
    v_record := jsonb_build_object('provider', p_provider, 'model', p_model, 'at', now(),
                                   'pageHashes', to_jsonb(ARRAY(SELECT DISTINCT h FROM unnest(p_page_hashes) h ORDER BY h)),
                                   'innings', i.reading_innings, 'outcome', p_outcome, 'by', app_user_id());
  ELSIF p_outcome = 'read' THEN
    RETURN QUERY SELECT false, 'record_invalid', 'a read names its provider and model', i.version; RETURN;
  END IF;

  IF p_outcome = 'read' THEN
    -- The card: one innings, the one asked for, not already on the card.
    IF jsonb_typeof(p_card) IS DISTINCT FROM 'object'
       OR p_card->'innings' IS DISTINCT FROM to_jsonb(i.reading_innings::integer)
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_card) k WHERE k NOT IN
                   ('v', 'innings', 'battingSide', 'batting', 'didNotBat', 'bowling', 'extras', 'total', 'wickets',
                    'overs', 'fallOfWickets', 'endReason', 'unreconciled'))
       OR octet_length(p_card::text) + octet_length(coalesce(p_typed, '{}')::text) + octet_length(coalesce(p_cells, '{}')::text) > 200000 THEN
      RETURN QUERY SELECT false, 'card_shape', 'one card, for the innings asked for', i.version; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(i.card) e WHERE e->'innings' = p_card->'innings') OR jsonb_array_length(i.card) >= 4 THEN
      RETURN QUERY SELECT false, 'innings_on_card', NULL::text, i.version; RETURN;
    END IF;
    -- The opposition's names as the reader read them: t:<n> to 1–80
    -- characters, never an id (a model must never link an identity), and a
    -- key already on the import only with its own spelling.
    IF jsonb_typeof(coalesce(p_typed, '{}'::jsonb)) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_each(coalesce(p_typed, '{}'::jsonb)) t
                   WHERE t.key !~ '^t:\d{1,3}$' OR jsonb_typeof(t.value) <> 'string'
                      OR length(btrim(t.value #>> '{}')) NOT BETWEEN 1 AND 80
                      OR (t.value #>> '{}') ~* uuid_re
                      OR (i.typed ? t.key AND i.typed->>t.key IS DISTINCT FROM t.value #>> '{}')) THEN
      RETURN QUERY SELECT false, 'typed_invalid', 't:<n> to a name of 1 to 80 characters, never an id', i.version; RETURN;
    END IF;
    IF jsonb_typeof(coalesce(p_cells, '{}'::jsonb)) <> 'object' THEN
      RETURN QUERY SELECT false, 'cells_invalid', NULL::text, i.version; RETURN;
    END IF;
    v_n := jsonb_array_length(i.card);
    -- The read cells start unticked: the reader's confidence is never a tick.
    SELECT coalesce(jsonb_object_agg(c.key, c.value), '{}') INTO v_checked
      FROM jsonb_each(coalesce((SELECT r.checked FROM scorebook_import_revision r WHERE r.import_id = p_import
                                 ORDER BY r.version DESC LIMIT 1), '{}'::jsonb)) c
     WHERE c.key NOT LIKE v_n || '.%';
    UPDATE scorebook_import
       SET card = i.card || jsonb_build_array(p_card),
           typed = i.typed || coalesce(p_typed, '{}'::jsonb),
           read_cells = i.read_cells || jsonb_build_object(i.reading_innings::text, coalesce(p_cells, '{}'::jsonb)),
           read_by = CASE WHEN v_record IS NULL THEN i.read_by ELSE coalesce(i.read_by, '[]'::jsonb) || jsonb_build_array(v_record) END,
           state = 'review', reading_from = NULL, reading_by = NULL, reading_since = NULL, reading_innings = NULL
     WHERE id = p_import;
    v_note := format('innings %s read by %s (%s), %s page(s)', i.reading_innings + 1, p_provider, p_model, cardinality(p_page_hashes));
    v := scorebook_revise(p_import, 'read', v_checked, v_note);
  ELSE
    UPDATE scorebook_import
       SET read_by = CASE WHEN v_record IS NULL THEN i.read_by ELSE coalesce(i.read_by, '[]'::jsonb) || jsonb_build_array(v_record) END,
           state = i.reading_from, reading_from = NULL, reading_by = NULL, reading_since = NULL, reading_innings = NULL
     WHERE id = p_import;
    v_note := format('innings %s not read (%s)%s', i.reading_innings + 1, p_outcome,
                     CASE WHEN p_provider IS NULL THEN ': nothing was sent' ELSE format(': sent to %s (%s)', p_provider, p_model) END);
    v := scorebook_revise(p_import, 'read', NULL, v_note);
  END IF;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 6 · Grants ─────────────────────────────────────────────────────
DO $grants$
DECLARE f text; r text;
  app text[] := ARRAY[
    'scorebook_reader_may(uuid)', 'scorebook_import_read_start(uuid,integer,integer)',
    'scorebook_import_read_done(uuid,jsonb,jsonb,jsonb,text,text,text[],text)'];
  internal text[] := ARRAY['scorebook_reader_on(uuid)', 'scorebook_read_stale()'];
BEGIN
  FOREACH f IN ARRAY app LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  FOREACH f IN ARRAY internal LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY app || internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;

-- ── 7 · The proof ────────────────────────────────────────────────
-- Built and rolled back; db/99 §44 is the fuller proof, with principals.
DO $check$
DECLARE
  v_school uuid := gen_random_uuid();
BEGIN
  -- 1. The switch arrives off, unlocked (so a per-school grant can open it),
  -- and a feature.
  IF (SELECT row(enabled, locked, kind)::text FROM feature_flag WHERE key = 'scorebook_reader') IS DISTINCT FROM '(f,f,feature)' THEN
    RAISE EXCEPTION 'db/66: the scorebook_reader switch is not off, unlocked, a feature';
  END IF;
  -- 2. The platform default turned on sends nobody's pages: only a grant for
  -- the school does, and a suppression still closes it.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db66-' || v_school, 'db/66 proof');
    UPDATE feature_flag SET enabled = true WHERE key = 'scorebook_reader';
    IF scorebook_reader_on(v_school) THEN RAISE EXCEPTION 'db/66: the platform default turned the reader on for a school'; END IF;
    UPDATE feature_flag SET locked = true WHERE key = 'scorebook_reader';
    IF scorebook_reader_on(v_school) THEN RAISE EXCEPTION 'db/66: the platform default, locked on, turned the reader on for a school'; END IF;
    UPDATE feature_flag SET enabled = false, locked = false WHERE key = 'scorebook_reader';
    INSERT INTO feature_grant (key, school_id, granted, note) VALUES ('scorebook_reader', v_school, true, 'db/66 proof');
    IF NOT scorebook_reader_on(v_school) THEN RAISE EXCEPTION 'db/66: a grant for the school did not turn the reader on'; END IF;
    INSERT INTO feature_suppression (key, school_id, reason) VALUES ('scorebook_reader', v_school, 'db/66 proof');
    IF scorebook_reader_on(v_school) THEN RAISE EXCEPTION 'db/66: a school''s suppression did not turn the reader off'; END IF;
    DELETE FROM feature_suppression WHERE key = 'scorebook_reader' AND school_id = v_school;
    IF NOT scorebook_reader_on(v_school) THEN RAISE EXCEPTION 'db/66: the grant did not stand once the suppression went'; END IF;
    UPDATE feature_grant SET granted = false WHERE key = 'scorebook_reader' AND school_id = v_school;
    IF scorebook_reader_on(v_school) THEN RAISE EXCEPTION 'db/66: a revoked grant left the reader on'; END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ066', MESSAGE = 'db/66: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ066' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school)
     OR (SELECT row(enabled, locked)::text FROM feature_flag WHERE key = 'scorebook_reader') IS DISTINCT FROM '(f,f)' THEN
    RAISE EXCEPTION 'db/66: the proof left something behind';
  END IF;
  -- 3. Nothing the application may not reach.
  IF has_function_privilege('scrbrd_app', 'scorebook_reader_on(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/66: the application may call scorebook_reader_on() directly';
  END IF;
END $check$;

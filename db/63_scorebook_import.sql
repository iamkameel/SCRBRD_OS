-- ══════════════════════════════════════════════════════════════════
--  63 · The scorebook importer, phase 1: the record, by hand (SCRBRD-120)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, with a GENERATED block for the three tables' policies. The
-- design is docs/design/SCRBRD-120_scorebook_importer.md (Fable,
-- 2026-09-30; D1–D13 decided by Kameel as recommended). This file is its
-- phase 1 (§8): a scorer photographs a paper scorebook, types the card beside
-- the photos, a second person confirms it, and the card becomes three events
-- per innings in the match's log. No OCR (phase 4), no careers or tables
-- (phase 2), no workload (phase 3).
--
-- WHAT IS HERE.
--
--   scoring.import.read / .write / .confirm   the capabilities (ADDED_SINCE_01):
--                             write — scorer, coach, assistantcoach (those who
--                             may score a match live); confirm — directorofsport,
--                             competitionadmin (those who approve an amendment);
--                             read — both; superadmin all three.
--   feature `scorebook_import` a MODULE, off until the platform grants it per
--                             school (D13). Every function below asks it again.
--   scorebook_import          one import of one match: its state, its cards
--                             (one per innings), the typed names, who typed,
--                             who submitted, who confirmed, what was written.
--   scorebook_import_page     a photo's record: its key in the object store
--                             (services/api/io/object-store.mjs), hash, size.
--                             The row outlives the photo: "there were four
--                             pages, deleted on this day" is the audit.
--   scorebook_import_revision every card as it stood, who and when (§4.5).
--   summary_reconciles()      the card's shape and arithmetic, in SQL: the same
--                             answers as summaryRefusal() (packages/scoring
--                             summary.mjs) over the same PARITY list, so no
--                             client can skip the check.
--   the state functions       open, page_add, page_remove, save, submit, return, commit,
--                             abandon (§4.3; not the two _read_* of phase 4),
--                             page_open (every photo read logged in
--                             access_log), purge_due and page_purged (§5.3).
--   ball_event                a new kind, innings_summary (D2), written by
--                             scorebook_import_commit() and by nothing else —
--                             a trigger refuses it (and any event naming a
--                             scorebook as its device) from any other door.
--   innings_score_as_folded(), match_live_score
--                             read a summarised innings from its summary (§2.4):
--                             runs, wickets and legal balls as the fold has them.
--   public_match_log()        serves an innings_summary's card, and never the
--                             typed names, the source or the reviewer's note.
--
-- WHO. Every write is a SECURITY DEFINER function that decides who, refuses
-- a support session (db/22) and a pad's resume credential (db/50), and writes
-- a revision; scrbrd_app holds SELECT on the three tables and nothing else.
-- The two-person rule is the role catalogue's (no role holds both write and
-- confirm: separation.test.mjs) AND the import's own: the submitter and
-- anybody who authored a revision of the card may not confirm or return it
-- (cannot_confirm_your_own), and the confirmer cannot edit — a person holding
-- both through two assignments who edits has made themself an author. A
-- match in a competition is confirmed by the league (a holder of
-- competition.conditions.manage over it, as well as the confirm capability
-- over the match): the school's director of sport confirms a match in no
-- competition (§4.1).
--
-- THE COMMIT (§4.3), in the amendment route's shape (db/38): the API route
-- (services/api/write/scorebook-api.mjs) opens a savepoint and calls
-- scorebook_import_commit(), which decides who, takes the live path's lock
-- (the scoring_session row, then match_conditions_lock(), through
-- match_conditions_fix()), fixes the match's playing conditions under the
-- version in force on its start day (SCRBRD-114), writes innings_start,
-- innings_summary and innings_end per card with keys derived from the import
-- (scorebook:<import>:<innings>:start|summary|end), completes the match (D10),
-- audits, and marks the import confirmed. The route then folds the log and
-- asks the Laws and the seal about each event, and rolls back to the
-- savepoint with the reason in words if any is refused. SQL cannot run the
-- Laws; the route can; the pair is one transaction.
--
-- A MATCH ALREADY COMPLETE takes an import only when a confirmed import
-- completed it: the correction of a wrong import is an amendment voiding its
-- summary, then a new import (D10, §2.6). A match completed on the pad is
-- never imported over (the Laws' LIVE_INNINGS would refuse every innings; this
-- refuses it first, as match_complete).
--
-- THE PHOTOS never touch the database: the API strips their metadata, stores
-- them privately and records the key here. They are deleted thirty days after
-- confirmation, at once on abandonment, and thirty days after the last touch
-- of a stale draft (D7); the rows stay.
--
-- WHERE THIS DIFFERS FROM THE DESIGN'S LETTER, and why (docs/design §9.2):
--   - `.write` is held by scorer, coach and assistantcoach: the design named
--     the holders of scoring.amend.request and listed teammanager too, but
--     only the scorer holds that capability, and a teammanager may not score
--     at all. The safer reading: whoever may score the match live.
--   - Pages are the stripped original (JPEG or PNG, metadata removed), not a
--     re-encoded JPEG: no image library in the API. `mime` is recorded.
--   - A saved card moves a draft or a returned import to `review`; adding a
--     page does not change the state.
--   - team_code, match_id and school_id are stamped on the page and revision
--     rows too, so their policies anchor like the import's.
--   - resolve_entries (the workload ticks) is phase 3: a non-empty list is
--     refused here.
--
-- search_path is pinned on every function (db/16). Every function the
-- application calls is granted to scrbrd_app and taken back from PUBLIC and a
-- managed host's API roles. Idempotent where it can honestly be; the proof at
-- the end builds its own rows and rolls them back. db/99 §41 is the fuller
-- proof, with principals, on every verify paste.

-- ── 0 · The capabilities ───────────────────────────────────────────
INSERT INTO capability (name) VALUES ('scoring.import.read') ON CONFLICT (name) DO NOTHING;
INSERT INTO capability (name) VALUES ('scoring.import.write') ON CONFLICT (name) DO NOTHING;
INSERT INTO capability (name) VALUES ('scoring.import.confirm') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('scorer',           'scoring.import.read'),
  ('scorer',           'scoring.import.write'),
  ('coach',            'scoring.import.read'),
  ('coach',            'scoring.import.write'),
  ('assistantcoach',   'scoring.import.read'),
  ('assistantcoach',   'scoring.import.write'),
  ('directorofsport',  'scoring.import.read'),
  ('directorofsport',  'scoring.import.confirm'),
  ('competitionadmin', 'scoring.import.read'),
  ('competitionadmin', 'scoring.import.confirm'),
  ('superadmin',       'scoring.import.read'),
  ('superadmin',       'scoring.import.write'),
  ('superadmin',       'scoring.import.confirm')
ON CONFLICT DO NOTHING;

-- ── 1 · The module ─────────────────────────────────────────────────
-- A MODULE, arriving off (D13): the platform grants it per school.
INSERT INTO feature_flag (key, kind, label, enabled, reason) VALUES
  ('scorebook_import', 'module', 'Scorebook import', false,
   'SCRBRD-120: a match scored on paper, imported from photos of the book and confirmed by a second person. '
   'Stores photos of two schools'' children''s names, so it is granted per school, never assumed.')
ON CONFLICT (key) DO NOTHING;

-- ── 2 · Small rules, shared ─────────────────────────────────────────
-- Legal balls in "overs.balls" as a book writes it, six to the over; NULL for
-- anything else. ballsOfOvers() in replay.mjs, in SQL.
CREATE OR REPLACE FUNCTION scorebook_overs_balls(p_text text) RETURNS integer AS $$
  SELECT CASE WHEN btrim(p_text) ~ '^\d{1,3}(\.[0-5])?$'
              THEN split_part(btrim(p_text), '.', 1)::integer * 6 + coalesce(nullif(split_part(btrim(p_text), '.', 2), '')::integer, 0)
         END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- The same, of a jsonb value: a string only.
CREATE OR REPLACE FUNCTION scorebook_balls(p_value jsonb) RETURNS integer AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'string' THEN scorebook_overs_balls(p_value #>> '{}') END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- A whole number from nought to 9999 (summary.mjs isCount).
CREATE OR REPLACE FUNCTION scorebook_is_count(p_value jsonb) RETURNS boolean AS $$
  SELECT coalesce(jsonb_typeof(p_value) = 'number'
                  AND (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
                  AND (p_value #>> '{}')::numeric BETWEEN 0 AND 9999, false)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- A player id, or a typed key t:<n> (summary.mjs isRef).
CREATE OR REPLACE FUNCTION scorebook_is_ref(p_value jsonb) RETURNS boolean AS $$
  SELECT coalesce(jsonb_typeof(p_value) = 'string'
                  AND ((p_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       OR (p_value #>> '{}') ~ '^t:\d{1,3}$'), false)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- A card's ending → the innings_end reason (summary.mjs CARD_END_REASON).
CREATE OR REPLACE FUNCTION scorebook_end_reason(p_end text) RETURNS text AS $$
  SELECT CASE p_end WHEN 'all_out' THEN 'all_out' WHEN 'overs' THEN 'overs_complete' WHEN 'target' THEN 'target_reached'
                    WHEN 'declared' THEN 'declared' WHEN 'time' THEN 'time' WHEN 'other' THEN 'other' END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- Which side of a fixture is the importing school's: its home side, or both
-- sides of a fixture between two of its own teams.
CREATE OR REPLACE FUNCTION scorebook_ours(p_match uuid) RETURNS text AS $$
  SELECT CASE WHEN m.away_school_id = m.school_id THEN 'both' ELSE 'home' END FROM match m WHERE m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- How long a photo is kept once its import is confirmed, and a draft left
-- untouched before it is abandoned (D7; the information officer's number).
CREATE OR REPLACE FUNCTION scorebook_page_retention() RETURNS interval AS $$
  SELECT interval '30 days'
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- ── 3 · The arithmetic, in SQL ──────────────────────────────────────
/**
 * summaryRefusal() (summary.mjs) as its codes: sorted, once each, empty for a
 * card that may be recorded. Shape first, and a card that is not one is
 * answered for its shape alone. p_ours: 'home', 'away', 'both', or NULL to
 * ask nothing about sides. db/99 §41 and tools/smoke-scorebook.mjs hold the
 * two to the PARITY list (packages/scoring/test/scorebook-cards.mjs).
 */
CREATE OR REPLACE FUNCTION summary_reconciles(p_card jsonb, p_typed jsonb, p_ours text) RETURNS text[] AS $$
DECLARE
  c        jsonb := p_card;
  typed    jsonb := CASE WHEN jsonb_typeof(p_typed) = 'object' THEN p_typed ELSE '{}'::jsonb END;
  codes    text[] := '{}';
  shape    boolean := false;
  r        jsonb;
  k        text;
  i        integer;
  v        jsonb;
  bat_ours boolean;
  bowl_ours boolean;
  diff     numeric;
  last     numeric := 0;
  fow_bad  boolean := false;
  charged  text[] := ARRAY['bowled', 'caught', 'lbw', 'stumped', 'hit_wicket'];
  how      text[] := ARRAY['bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'handled_ball',
                           'obstructing_field', 'timed_out', 'retired_out', 'hit_twice', 'not_out', 'retired_hurt'];
  uuid_re  text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  -- ── Shape ──
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RETURN ARRAY['card_shape']; END IF;
  shape := EXISTS (SELECT 1 FROM jsonb_object_keys(c) x WHERE x NOT IN
             ('v', 'innings', 'battingSide', 'batting', 'didNotBat', 'bowling', 'extras', 'total', 'wickets',
              'overs', 'fallOfWickets', 'endReason', 'unreconciled'))
    OR c->'v' IS DISTINCT FROM '1'::jsonb
    OR NOT (jsonb_typeof(c->'innings') = 'number' AND (c->>'innings')::numeric IN (0, 1, 2, 3))
    OR coalesce(c->>'battingSide', '') NOT IN ('home', 'away') OR jsonb_typeof(c->'battingSide') <> 'string'
    OR NOT scorebook_is_count(c->'total')
    OR NOT (jsonb_typeof(c->'wickets') = 'number' AND (c->>'wickets')::numeric IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
    OR scorebook_balls(c->'overs') IS NULL
    OR jsonb_typeof(c->'endReason') IS DISTINCT FROM 'string' OR scorebook_end_reason(c->>'endReason') IS NULL;
  IF jsonb_typeof(c->'extras') IS DISTINCT FROM 'object' THEN shape := true;
  ELSE
    shape := shape OR EXISTS (SELECT 1 FROM jsonb_object_keys(c->'extras') x WHERE x NOT IN ('byes', 'legByes', 'wides', 'noBalls', 'penalty'));
    FOREACH k IN ARRAY ARRAY['byes', 'legByes', 'wides', 'noBalls', 'penalty'] LOOP
      IF NOT (c->'extras' ? k AND (jsonb_typeof(c->'extras'->k) = 'null' OR scorebook_is_count(c->'extras'->k))) THEN shape := true; END IF;
    END LOOP;
  END IF;
  IF NOT (c ? 'unreconciled') THEN shape := true;
  ELSIF jsonb_typeof(c->'unreconciled') <> 'null' AND NOT (
      jsonb_typeof(c->'unreconciled') = 'object'
      AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(c->'unreconciled') x WHERE x NOT IN ('runs', 'note'))
      AND jsonb_typeof(c->'unreconciled'->'runs') = 'number'
      AND (c->'unreconciled'->>'runs')::numeric = trunc((c->'unreconciled'->>'runs')::numeric)
      AND abs((c->'unreconciled'->>'runs')::numeric) <= 9999
      AND jsonb_typeof(c->'unreconciled'->'note') = 'string'
      AND length(btrim(c->'unreconciled'->>'note')) >= 3 AND length(c->'unreconciled'->>'note') <= 200) THEN
    shape := true;
  END IF;
  FOREACH k IN ARRAY ARRAY['batting', 'didNotBat', 'bowling', 'fallOfWickets'] LOOP
    IF jsonb_typeof(c->k) IS DISTINCT FROM 'array' OR jsonb_array_length(c->k) > 15 THEN shape := true; END IF;
  END LOOP;
  IF shape THEN RETURN ARRAY['card_shape']; END IF;

  FOR r, i IN SELECT x.e, x.n::integer - 1 FROM jsonb_array_elements(c->'batting') WITH ORDINALITY AS x(e, n) LOOP
    IF jsonb_typeof(r) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) x WHERE x NOT IN ('order', 'ref', 'howOut', 'fielderRef', 'bowlerRef', 'runs', 'balls', 'fours', 'sixes'))
       OR r->'order' IS DISTINCT FROM to_jsonb(i + 1)
       OR NOT scorebook_is_ref(r->'ref')
       OR jsonb_typeof(r->'howOut') IS DISTINCT FROM 'string' OR NOT ((r->>'howOut') = ANY (how))
       OR NOT (r ? 'fielderRef' AND (jsonb_typeof(r->'fielderRef') = 'null' OR scorebook_is_ref(r->'fielderRef')))
       OR NOT (r ? 'bowlerRef' AND (jsonb_typeof(r->'bowlerRef') = 'null' OR scorebook_is_ref(r->'bowlerRef')))
       OR NOT scorebook_is_count(r->'runs')
       OR NOT (r ? 'balls' AND (jsonb_typeof(r->'balls') = 'null' OR scorebook_is_count(r->'balls')))
       OR NOT (r ? 'fours' AND (jsonb_typeof(r->'fours') = 'null' OR scorebook_is_count(r->'fours')))
       OR NOT (r ? 'sixes' AND (jsonb_typeof(r->'sixes') = 'null' OR scorebook_is_count(r->'sixes'))) THEN
      RETURN ARRAY['card_shape'];
    END IF;
  END LOOP;
  FOR r IN SELECT e FROM jsonb_array_elements(c->'didNotBat') e LOOP
    IF NOT scorebook_is_ref(r) THEN RETURN ARRAY['card_shape']; END IF;
  END LOOP;
  FOR r IN SELECT e FROM jsonb_array_elements(c->'bowling') e LOOP
    IF jsonb_typeof(r) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) x WHERE x NOT IN ('ref', 'overs', 'maidens', 'runs', 'wickets', 'wides', 'noBalls'))
       OR NOT scorebook_is_ref(r->'ref') OR scorebook_balls(r->'overs') IS NULL
       OR NOT scorebook_is_count(r->'runs') OR NOT scorebook_is_count(r->'wickets')
       OR NOT (r ? 'maidens' AND (jsonb_typeof(r->'maidens') = 'null' OR scorebook_is_count(r->'maidens')))
       OR NOT (r ? 'wides' AND (jsonb_typeof(r->'wides') = 'null' OR scorebook_is_count(r->'wides')))
       OR NOT (r ? 'noBalls' AND (jsonb_typeof(r->'noBalls') = 'null' OR scorebook_is_count(r->'noBalls'))) THEN
      RETURN ARRAY['card_shape'];
    END IF;
  END LOOP;
  FOR r IN SELECT e FROM jsonb_array_elements(c->'fallOfWickets') e LOOP
    IF jsonb_typeof(r) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) x WHERE x NOT IN ('wicket', 'score', 'ref', 'over'))
       OR NOT (jsonb_typeof(r->'wicket') = 'number' AND (r->>'wicket')::numeric IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
       OR NOT (r ? 'score' AND (jsonb_typeof(r->'score') = 'null' OR scorebook_is_count(r->'score')))
       OR NOT (r ? 'ref' AND (jsonb_typeof(r->'ref') = 'null' OR scorebook_is_ref(r->'ref')))
       OR NOT (r ? 'over' AND (jsonb_typeof(r->'over') = 'null' OR scorebook_balls(r->'over') IS NOT NULL)) THEN
      RETURN ARRAY['card_shape'];
    END IF;
  END LOOP;

  -- ── The names ──
  -- A typed key names somebody only when the import has its spelling.
  IF EXISTS (
       SELECT 1 FROM (
         SELECT e->>'ref' AS ref FROM jsonb_array_elements(c->'batting') e
         UNION ALL SELECT e->>'fielderRef' FROM jsonb_array_elements(c->'batting') e
         UNION ALL SELECT e->>'bowlerRef' FROM jsonb_array_elements(c->'batting') e
         UNION ALL SELECT e #>> '{}' FROM jsonb_array_elements(c->'didNotBat') e
         UNION ALL SELECT e->>'ref' FROM jsonb_array_elements(c->'bowling') e
         UNION ALL SELECT e->>'ref' FROM jsonb_array_elements(c->'fallOfWickets') e) x
        WHERE x.ref IS NOT NULL AND NOT coalesce(x.ref ~* uuid_re
              OR (x.ref ~ '^t:\d{1,3}$' AND jsonb_typeof(typed->x.ref) = 'string' AND btrim(typed->>x.ref) <> ''), false)) THEN
    codes := array_append(codes, 'ref_unknown');
  END IF;

  -- Our side from the roster, theirs typed (D6).
  IF p_ours IS NOT NULL THEN
    bat_ours := p_ours = 'both' OR p_ours = c->>'battingSide';
    bowl_ours := p_ours = 'both' OR p_ours <> c->>'battingSide';
    IF EXISTS (
         SELECT 1 FROM (
           SELECT e->>'ref' AS ref, bat_ours AS ours FROM jsonb_array_elements(c->'batting') e
           UNION ALL SELECT e #>> '{}', bat_ours FROM jsonb_array_elements(c->'didNotBat') e
           UNION ALL SELECT e->>'ref', bowl_ours FROM jsonb_array_elements(c->'bowling') e
           UNION ALL SELECT e->>'bowlerRef', bowl_ours FROM jsonb_array_elements(c->'batting') e
           UNION ALL SELECT e->>'fielderRef', bowl_ours FROM jsonb_array_elements(c->'batting') e) x
          WHERE x.ref IS NOT NULL
            AND CASE WHEN x.ours THEN x.ref !~* uuid_re ELSE p_ours <> 'both' AND x.ref ~* uuid_re END) THEN
      codes := array_append(codes, 'ref_side');
    END IF;
  END IF;

  IF (SELECT count(*) <> count(DISTINCT ref) FROM (
        SELECT e->>'ref' AS ref FROM jsonb_array_elements(c->'batting') e
        UNION ALL SELECT e #>> '{}' FROM jsonb_array_elements(c->'didNotBat') e) x)
     OR (SELECT count(*) <> count(DISTINCT e->>'ref') FROM jsonb_array_elements(c->'bowling') e) THEN
    codes := array_append(codes, 'ref_repeated');
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(c->'batting') e
              WHERE CASE WHEN (e->>'howOut') = ANY (charged)
                         THEN e->>'bowlerRef' IS NULL
                              OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c->'bowling') w WHERE w->>'ref' = e->>'bowlerRef')
                         ELSE e->>'bowlerRef' IS NOT NULL END) THEN
    codes := array_append(codes, 'dismissal_bowler');
  END IF;

  -- ── The sums ──
  diff := (c->>'total')::numeric
        - (SELECT coalesce(sum((e->>'runs')::numeric), 0) FROM jsonb_array_elements(c->'batting') e)
        - (SELECT coalesce(sum((c->'extras'->>x)::numeric), 0) FROM unnest(ARRAY['byes', 'legByes', 'wides', 'noBalls', 'penalty']) x);
  IF jsonb_typeof(c->'unreconciled') = 'null' THEN
    IF diff <> 0 THEN codes := array_append(codes, 'batting_plus_extras'); END IF;
  ELSIF (c->'unreconciled'->>'runs')::numeric <> diff OR diff = 0 THEN
    codes := array_append(codes, 'unreconciled_wrong');
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(c->'batting') e WHERE e->>'howOut' NOT IN ('not_out', 'retired_hurt'))
     <> (c->>'wickets')::numeric THEN
    codes := array_append(codes, 'wickets_mismatch');
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(c->'bowling') w
              WHERE (w->>'wickets')::numeric <> (SELECT count(*) FROM jsonb_array_elements(c->'batting') e
                                                  WHERE e->>'bowlerRef' = w->>'ref' AND (e->>'howOut') = ANY (charged))) THEN
    codes := array_append(codes, 'bowler_wickets');
  END IF;

  IF jsonb_typeof(c->'extras'->'byes') = 'number' AND jsonb_typeof(c->'extras'->'legByes') = 'number'
     AND jsonb_typeof(c->'extras'->'penalty') = 'number'
     AND (SELECT coalesce(sum((w->>'runs')::numeric), 0) FROM jsonb_array_elements(c->'bowling') w)
         + (c->'extras'->>'byes')::numeric + (c->'extras'->>'legByes')::numeric + (c->'extras'->>'penalty')::numeric
         <> (c->>'total')::numeric THEN
    codes := array_append(codes, 'bowling_plus_byes');
  END IF;

  IF (SELECT coalesce(sum(scorebook_balls(w->'overs')), 0) FROM jsonb_array_elements(c->'bowling') w) <> scorebook_balls(c->'overs') THEN
    codes := array_append(codes, 'balls_mismatch');
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(c->'batting') e
              WHERE 4 * coalesce((e->>'fours')::numeric, 0) + 6 * coalesce((e->>'sixes')::numeric, 0) > (e->>'runs')::numeric) THEN
    codes := array_append(codes, 'boundaries_exceed_runs');
  END IF;

  -- The fall of wickets, where the book has one.
  IF jsonb_array_length(c->'fallOfWickets') > 0 THEN
    fow_bad := jsonb_array_length(c->'fallOfWickets') <> (c->>'wickets')::numeric;
    FOR v, i IN SELECT x.e, x.n::integer FROM jsonb_array_elements(c->'fallOfWickets') WITH ORDINALITY AS x(e, n) LOOP
      IF (v->>'wicket')::numeric <> i THEN fow_bad := true; END IF;
      IF jsonb_typeof(v->'score') = 'number' THEN
        IF (v->>'score')::numeric < last OR (v->>'score')::numeric > (c->>'total')::numeric THEN fow_bad := true; END IF;
        last := (v->>'score')::numeric;
      END IF;
      IF v->>'ref' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c->'batting') e WHERE e->>'ref' = v->>'ref') THEN
        fow_bad := true;
      END IF;
    END LOOP;
    IF (SELECT count(e->>'ref') <> count(DISTINCT e->>'ref') FROM jsonb_array_elements(c->'fallOfWickets') e) THEN fow_bad := true; END IF;
    IF fow_bad THEN codes := array_append(codes, 'fall_of_wickets'); END IF;
  END IF;

  RETURN ARRAY(SELECT DISTINCT x FROM unnest(codes) x ORDER BY x);
END $$ LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

-- ── 4 · The tables ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scorebook_import (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES school(id),
  match_id         uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  team_code        text,                                  -- the fixture's, stamped
  state            text NOT NULL DEFAULT 'draft'
                   CHECK (state IN ('draft', 'reading', 'review', 'submitted', 'returned', 'confirmed', 'abandoned')),
  card             jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(card) = 'array' AND jsonb_array_length(card) <= 4),
  typed            jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(typed) = 'object'),
  read_by          jsonb,                                 -- phase 4: the processing record (POPIA s17)
  version          integer NOT NULL DEFAULT 1,           -- the latest revision's
  created_by       uuid NOT NULL REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  touched_at       timestamptz NOT NULL DEFAULT now(),   -- the latest revision's time: a stale draft's clock
  submitted_by     uuid REFERENCES app_user(id),
  submitted_at     timestamptz,
  returned_by      uuid REFERENCES app_user(id),
  returned_at      timestamptz,
  returned_note    text,
  confirmed_by     uuid REFERENCES app_user(id),
  confirmed_at     timestamptz,
  confirm_note     text,
  unreconciled_acknowledged boolean,
  abandoned_by     uuid REFERENCES app_user(id),
  abandoned_at     timestamptz,
  applied_keys     text[],
  pages_purged_at  timestamptz,
  CONSTRAINT confirmed_rows_name_their_events CHECK (state <> 'confirmed'
    OR (applied_keys IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CONSTRAINT two_people CHECK (confirmed_by IS NULL OR confirmed_by <> submitted_by),
  CONSTRAINT submitted_rows_say_who CHECK (state NOT IN ('submitted', 'confirmed') OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
  CONSTRAINT abandoned_rows_say_when CHECK (state <> 'abandoned' OR abandoned_at IS NOT NULL)
);
COMMENT ON TABLE scorebook_import IS
  'SCRBRD-120: one import of a paper scorebook into one match. Written only by the scorebook_import_* functions (db/63).';
-- One open import per match: a second is refused (import_open).
CREATE UNIQUE INDEX IF NOT EXISTS scorebook_import_one_open ON scorebook_import (match_id)
  WHERE state IN ('draft', 'reading', 'review', 'submitted', 'returned');
CREATE INDEX IF NOT EXISTS scorebook_import_school_idx ON scorebook_import (school_id, state);

CREATE TABLE IF NOT EXISTS scorebook_import_page (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id   uuid NOT NULL REFERENCES scorebook_import(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES school(id),
  match_id    uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  team_code   text,
  page_no     smallint NOT NULL CHECK (page_no BETWEEN 1 AND 99),
  object_key  text NOT NULL UNIQUE
              CHECK (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'),
  mime        text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes       integer NOT NULL CHECK (bytes BETWEEN 1 AND 8388608),
  width       integer CHECK (width BETWEEN 1 AND 20000),
  height      integer CHECK (height BETWEEN 1 AND 20000),
  added_by    uuid NOT NULL REFERENCES app_user(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  -- Taken off the import by a writer while it could still be edited (a wrong
  -- photo): out of the import at once, its photo then deleted like any other
  -- (deleted_at), and the row kept. Its number is not given to another page.
  removed_at  timestamptz,
  removed_by  uuid REFERENCES app_user(id),
  deleted_at  timestamptz,
  UNIQUE (import_id, page_no),
  CONSTRAINT removed_rows_say_who CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
COMMENT ON TABLE scorebook_import_page IS
  'SCRBRD-120: a photo of a scorebook page, by its key in the private store. The row outlives the photo (deleted_at).';
-- The same photo twice on one import is refused by its hash; a photo removed
-- by mistake may be added again.
CREATE UNIQUE INDEX IF NOT EXISTS scorebook_import_page_once ON scorebook_import_page (import_id, sha256)
  WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS scorebook_import_revision (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id   uuid NOT NULL REFERENCES scorebook_import(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES school(id),
  match_id    uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  team_code   text,
  version     integer NOT NULL CHECK (version >= 1),
  card        jsonb NOT NULL,
  typed       jsonb NOT NULL,
  checked     jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(checked) = 'object'),
  action      text NOT NULL CHECK (action IN ('create', 'pages', 'read', 'save', 'submit', 'return', 'confirm', 'abandon')),
  note        text,
  actor_id    uuid NOT NULL REFERENCES app_user(id),
  at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, version)
);
COMMENT ON TABLE scorebook_import_revision IS
  'SCRBRD-120: every scorebook card as it stood, who and when. Never updated.';

-- The fixture's school, team and match, stamped on every row from the
-- fixture (or its import), never taken from a caller. An import's identity
-- does not change; a confirmed or abandoned import changes only to record
-- its photos purged; a page changes only to record it removed from its
-- import (once) and its photo deleted; a revision never changes.
CREATE OR REPLACE FUNCTION scorebook_import_guard() RETURNS trigger AS $$
DECLARE m match%ROWTYPE; i scorebook_import%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'scorebook_import' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT * INTO m FROM match x WHERE x.id = NEW.match_id;
      NEW.school_id := m.school_id; NEW.team_code := m.team_code;
      RETURN NEW;
    END IF;
    IF NEW.id <> OLD.id OR NEW.match_id <> OLD.match_id OR NEW.school_id <> OLD.school_id
       OR NEW.team_code IS DISTINCT FROM OLD.team_code OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'an import''s identity does not change' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.state IN ('confirmed', 'abandoned')
       AND (to_jsonb(NEW) - 'pages_purged_at') IS DISTINCT FROM (to_jsonb(OLD) - 'pages_purged_at') THEN
      RAISE EXCEPTION 'a % import does not change', OLD.state USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- page and revision: stamped from their import
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO i FROM scorebook_import x WHERE x.id = NEW.import_id;
    NEW.school_id := i.school_id; NEW.match_id := i.match_id; NEW.team_code := i.team_code;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'scorebook_import_page' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
     AND (to_jsonb(NEW) - 'deleted_at') = (to_jsonb(OLD) - 'deleted_at') THEN
    RETURN NEW;
  END IF;
  -- Removed from the import, once, before its photo is deleted.
  IF TG_TABLE_NAME = 'scorebook_import_page' AND OLD.removed_at IS NULL AND OLD.deleted_at IS NULL
     AND NEW.removed_at IS NOT NULL AND NEW.removed_by IS NOT NULL
     AND (to_jsonb(NEW) - 'removed_at' - 'removed_by') = (to_jsonb(OLD) - 'removed_at' - 'removed_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% rows do not change', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION scorebook_import_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS scorebook_import_guard ON scorebook_import;
CREATE TRIGGER scorebook_import_guard BEFORE INSERT OR UPDATE ON scorebook_import
  FOR EACH ROW EXECUTE FUNCTION scorebook_import_guard();
DROP TRIGGER IF EXISTS scorebook_import_guard ON scorebook_import_page;
CREATE TRIGGER scorebook_import_guard BEFORE INSERT OR UPDATE ON scorebook_import_page
  FOR EACH ROW EXECUTE FUNCTION scorebook_import_guard();
DROP TRIGGER IF EXISTS scorebook_import_guard ON scorebook_import_revision;
CREATE TRIGGER scorebook_import_guard BEFORE INSERT OR UPDATE ON scorebook_import_revision
  FOR EACH ROW EXECUTE FUNCTION scorebook_import_guard();

-- ── 5 · Who may read them: generated from tables.mjs ───────────────
-- Read under scoring.import.read at the fixture's school, team and match;
-- the import and its revisions also under audit.read (the card and its
-- history, never a page). The generated write policies are unreachable: the
-- application holds no INSERT, UPDATE or DELETE (below).
-- ┌── GENERATED from packages/policy/src/tables.mjs by services/api/rls/generate-rls.mjs (TABLES_ADDED_SINCE_09). DO NOT EDIT BY HAND; `pnpm rls:generate` rewrites it.

-- scorebook_import — read: scoring.import.read · write: scoring.import.write
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE scorebook_import ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scorebook_import_read   ON scorebook_import;
DROP POLICY IF EXISTS scorebook_import_insert ON scorebook_import;
DROP POLICY IF EXISTS scorebook_import_update ON scorebook_import;
DROP POLICY IF EXISTS scorebook_import_delete ON scorebook_import;

CREATE POLICY scorebook_import_read ON scorebook_import
  FOR SELECT USING ((app_can('scoring.import.read', scorebook_import.school_id, scorebook_import.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import.match_id))
    OR (app_can('audit.read', scorebook_import.school_id, scorebook_import.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import.match_id)));

CREATE POLICY scorebook_import_insert ON scorebook_import
  FOR INSERT WITH CHECK (app_can('scoring.import.write', scorebook_import.school_id, scorebook_import.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import.match_id));

CREATE POLICY scorebook_import_update ON scorebook_import
  FOR UPDATE USING (app_can('scoring.import.write', scorebook_import.school_id, scorebook_import.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import.match_id))
           WITH CHECK (app_can('scoring.import.write', scorebook_import.school_id, scorebook_import.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import.match_id));

-- scorebook_import_page — read: scoring.import.read · write: scoring.import.write
ALTER TABLE scorebook_import_page ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scorebook_import_page_read   ON scorebook_import_page;
DROP POLICY IF EXISTS scorebook_import_page_insert ON scorebook_import_page;
DROP POLICY IF EXISTS scorebook_import_page_update ON scorebook_import_page;
DROP POLICY IF EXISTS scorebook_import_page_delete ON scorebook_import_page;

CREATE POLICY scorebook_import_page_read ON scorebook_import_page
  FOR SELECT USING (app_can('scoring.import.read', scorebook_import_page.school_id, scorebook_import_page.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import_page.match_id));

CREATE POLICY scorebook_import_page_insert ON scorebook_import_page
  FOR INSERT WITH CHECK (app_can('scoring.import.write', scorebook_import_page.school_id, scorebook_import_page.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import_page.match_id));

CREATE POLICY scorebook_import_page_update ON scorebook_import_page
  FOR UPDATE USING (app_can('scoring.import.write', scorebook_import_page.school_id, scorebook_import_page.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import_page.match_id))
           WITH CHECK (app_can('scoring.import.write', scorebook_import_page.school_id, scorebook_import_page.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import_page.match_id));

-- scorebook_import_revision — read: scoring.import.read · write: scoring.import.write
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE scorebook_import_revision ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scorebook_import_revision_read   ON scorebook_import_revision;
DROP POLICY IF EXISTS scorebook_import_revision_insert ON scorebook_import_revision;
DROP POLICY IF EXISTS scorebook_import_revision_update ON scorebook_import_revision;
DROP POLICY IF EXISTS scorebook_import_revision_delete ON scorebook_import_revision;

CREATE POLICY scorebook_import_revision_read ON scorebook_import_revision
  FOR SELECT USING ((app_can('scoring.import.read', scorebook_import_revision.school_id, scorebook_import_revision.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import_revision.match_id))
    OR (app_can('audit.read', scorebook_import_revision.school_id, scorebook_import_revision.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import_revision.match_id)));

CREATE POLICY scorebook_import_revision_insert ON scorebook_import_revision
  FOR INSERT WITH CHECK (app_can('scoring.import.write', scorebook_import_revision.school_id, scorebook_import_revision.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import_revision.match_id));

CREATE POLICY scorebook_import_revision_update ON scorebook_import_revision
  FOR UPDATE USING (app_can('scoring.import.write', scorebook_import_revision.school_id, scorebook_import_revision.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import_revision.match_id))
           WITH CHECK (app_can('scoring.import.write', scorebook_import_revision.school_id, scorebook_import_revision.team_code, '00000000-0000-0000-0000-000000000000'::uuid, scorebook_import_revision.match_id));

-- └── END GENERATED

-- Written only by the functions below. Two layers, as db/60 does for its
-- records: no grant, and no policy a grant would reach.
GRANT SELECT ON scorebook_import, scorebook_import_page, scorebook_import_revision TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON scorebook_import, scorebook_import_page, scorebook_import_revision FROM scrbrd_app;

-- Never under a support session at the school (§4.2): a support session may
-- neither write, confirm, nor read a page — nor the card.
DO $cut$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['scorebook_import', 'scorebook_import_page', 'scorebook_import_revision'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_not_support', t);
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (app_support_access_id(%I.school_id) IS NULL)$p$,
                   t || '_not_support', t, t);
  END LOOP;
END $cut$;

-- db/50: a pad resume credential reads none of the three.
SELECT pad_scope_guard_install('scorebook_import'::regclass)
     + pad_scope_guard_install('scorebook_import_page'::regclass)
     + pad_scope_guard_install('scorebook_import_revision'::regclass) AS pad_guards;

-- ── 6 · The log's new kind: written by the commit alone ─────────────
-- innings_summary carries no delivery: no type, no value, no player column,
-- a card. And any event of a scorebook's — its kind, or a device named for
-- an import — is refused unless scorebook_import_commit() is writing it for
-- that import, as the table's owner (the application role never is). The
-- live path therefore cannot write a summary a second person did not
-- confirm, whatever a client sends. What a CHECK would raise, so the write
-- path's per-event refusal handles it. Named to fire before
-- zz_ball_event_fingerprint, and changes nothing in NEW.
CREATE OR REPLACE FUNCTION ball_event_scorebook_door() RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'innings_summary' OR NEW.device_id LIKE 'scorebook:%' THEN
    IF current_user::text IS DISTINCT FROM (SELECT c.relowner::regrole::text FROM pg_class c WHERE c.oid = 'ball_event'::regclass)
       OR nullif(current_setting('scrbrd.scorebook_commit', true), '') IS DISTINCT FROM (NEW.payload->'source'->>'import')
       OR NEW.device_id IS DISTINCT FROM 'scorebook:' || (NEW.payload->'source'->>'import') THEN
      RAISE EXCEPTION 'ball_event: a scorebook''s events are written by scorebook_import_commit() alone (match %, key %)',
        NEW.match_id, NEW.idempotency_key
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'ball_event', CONSTRAINT = 'ball_event_scorebook_door';
    END IF;
  END IF;
  IF NEW.kind = 'innings_summary'
     AND (NEW.ball_type IS NOT NULL OR NEW.value IS NOT NULL OR NEW.striker_id IS NOT NULL OR NEW.non_striker_id IS NOT NULL
          OR NEW.bowler_id IS NOT NULL OR NEW.dismissed_id IS NOT NULL OR NEW.dismissal IS NOT NULL
          OR jsonb_typeof(NEW.payload->'card') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'ball_event: an innings summary is a card, not a delivery (match %, key %)', NEW.match_id, NEW.idempotency_key
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'ball_event', CONSTRAINT = 'ball_event_summary_is_a_card';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION ball_event_scorebook_door() FROM PUBLIC;
DROP TRIGGER IF EXISTS ball_event_scorebook_door ON ball_event;
CREATE TRIGGER ball_event_scorebook_door BEFORE INSERT ON ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_scorebook_door();

-- ── 7 · Who may: the checks every function asks ────────────────────
-- A person, as themself: signed in, not a pad's credential, not a support
-- session at the school.
CREATE OR REPLACE FUNCTION scorebook_actor_ok(p_school uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND app_support_access_id(p_school) IS NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- May the caller type (write) or sign (confirm) an import of this match?
-- Confirm, for a match in a competition, is the league's (§4.1).
CREATE OR REPLACE FUNCTION scorebook_may(p_cap text, p_match uuid) RETURNS boolean AS $$
  SELECT coalesce((
    SELECT scorebook_actor_ok(m.school_id)
       AND app_can(p_cap, m.school_id, m.team_code, NULL::uuid, m.id)
       AND (p_cap <> 'scoring.import.confirm' OR m.competition_id IS NULL OR competition_conditions_manager(m.competition_id))
      FROM match m WHERE m.id = p_match), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- What the caller may do with the imports of this match, by the checks the
-- functions themselves ask (scorebook_may()), so a screen draws exactly what
-- will be allowed and infers nothing from a role: write (type, add or remove
-- a page, submit), confirm (sign or return; the two-person rule is still the
-- functions' to refuse), read (open an import and its pages), and audit (the
-- card and its history under audit.read, never a page). The module, for the
-- fixture's own school — told only to a caller who may do one of the four,
-- so it says nothing about a school to anybody else. Every answer is false
-- for a match that does not exist or that the caller cannot reach.
CREATE OR REPLACE FUNCTION scorebook_caller_may(p_match uuid)
RETURNS TABLE (may_write boolean, may_confirm boolean, may_read boolean, may_audit boolean, module boolean) AS $$
DECLARE m match%ROWTYPE; w boolean; c boolean; rd boolean; a boolean;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND THEN RETURN QUERY SELECT false, false, false, false, false; RETURN; END IF;
  w := scorebook_may('scoring.import.write', p_match);
  c := scorebook_may('scoring.import.confirm', p_match);
  rd := scorebook_may('scoring.import.read', p_match);
  -- As the import's read policy asks it, behind the same support and pad cut.
  a := scorebook_actor_ok(m.school_id)
       AND app_can('audit.read', m.school_id, m.team_code, '00000000-0000-0000-0000-000000000000'::uuid, m.id);
  RETURN QUERY SELECT w, c, rd, a,
    (w OR c OR rd OR a) AND coalesce(feature_enabled('scorebook_import', m.school_id, app_user_id()), false);
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Has the caller authored this import's card — opened it, added a page,
-- saved or submitted it? Then they may not confirm or return it (§4.2).
CREATE OR REPLACE FUNCTION scorebook_authored(p_import uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM scorebook_import i WHERE i.id = p_import AND (i.submitted_by = app_user_id() OR i.created_by = app_user_id()))
      OR EXISTS (SELECT 1 FROM scorebook_import_revision r
                  WHERE r.import_id = p_import AND r.actor_id = app_user_id()
                    AND r.action IN ('create', 'pages', 'read', 'save', 'submit'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A revision: the import's card, typed names and ticks as they now stand.
CREATE OR REPLACE FUNCTION scorebook_revise(p_import uuid, p_action text, p_checked jsonb DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS integer AS $$
DECLARE i scorebook_import%ROWTYPE; v_checked jsonb;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  v_checked := coalesce(p_checked, (SELECT r.checked FROM scorebook_import_revision r WHERE r.import_id = p_import
                                     ORDER BY r.version DESC LIMIT 1), '{}'::jsonb);
  INSERT INTO scorebook_import_revision (import_id, school_id, match_id, team_code, version, card, typed, checked, action, note, actor_id)
  VALUES (p_import, i.school_id, i.match_id, i.team_code, i.version + 1, i.card, i.typed, v_checked, p_action, p_note, app_user_id());
  UPDATE scorebook_import SET version = i.version + 1, touched_at = now() WHERE id = p_import;
  RETURN i.version + 1;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Every ref a card list names, row by row: a batter, his fielder and bowler,
-- a name that did not bat, a bowler, a fall of wicket's batter. A player id
-- or a typed key t:<n>, as the card has it; whatever is not a list is none.
CREATE OR REPLACE FUNCTION scorebook_card_refs(p_cards jsonb) RETURNS SETOF text AS $$
  SELECT x.ref
    FROM jsonb_array_elements(public_json_array(p_cards)) c,
         LATERAL (SELECT e->>'ref' AS ref FROM jsonb_array_elements(public_json_array(c->'batting')) e
                  UNION ALL SELECT e->>'fielderRef' FROM jsonb_array_elements(public_json_array(c->'batting')) e
                  UNION ALL SELECT e->>'bowlerRef' FROM jsonb_array_elements(public_json_array(c->'batting')) e
                  UNION ALL SELECT e #>> '{}' FROM jsonb_array_elements(public_json_array(c->'didNotBat')) e
                  UNION ALL SELECT e->>'ref' FROM jsonb_array_elements(public_json_array(c->'bowling')) e
                  UNION ALL SELECT e->>'ref' FROM jsonb_array_elements(public_json_array(c->'fallOfWickets')) e) x
   WHERE x.ref IS NOT NULL
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

-- Why a card list may not be submitted or committed for this match, or NULL:
-- the arithmetic of each card, one card per innings, and every player id on
-- it a boy of the importing school (a typed name is never a player row, D6).
CREATE OR REPLACE FUNCTION scorebook_cards_problem(p_import uuid, OUT reason text, OUT detail text) AS $$
DECLARE i scorebook_import%ROWTYPE; c jsonb; v_codes text[]; v_ours text;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  v_ours := scorebook_ours(i.match_id);
  IF jsonb_array_length(i.card) = 0 THEN reason := 'no_card'; RETURN; END IF;
  IF (SELECT count(DISTINCT e->>'innings') <> count(*) FROM jsonb_array_elements(i.card) e) THEN
    reason := 'innings_twice'; detail := 'one card per innings'; RETURN;
  END IF;
  FOR c IN SELECT e FROM jsonb_array_elements(i.card) e LOOP
    v_codes := summary_reconciles(c, i.typed, v_ours);
    IF cardinality(v_codes) > 0 THEN
      reason := 'card_refused'; detail := format('innings %s: %s', c->>'innings', array_to_string(v_codes, ',')); RETURN;
    END IF;
  END LOOP;
  IF EXISTS (
       SELECT 1 FROM scorebook_card_refs(i.card) x(ref)
        WHERE public_ref_uuid(x.ref) IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM player p WHERE p.id = public_ref_uuid(x.ref) AND p.school_id = i.school_id)) THEN
    reason := 'not_our_player'; detail := 'every player chosen from the roster is one of the school''s own'; RETURN;
  END IF;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 8 · The state functions (§4.3) ─────────────────────────────────
-- Each answers rather than raises (a refusal is a fact the screen shows):
-- (ok, reason, detail, ...). None names an import or a match to a caller who
-- may not reach it: 'not_permitted' for both "no such" and "not yours".

-- Open an import for a fixture that exists (D13: no new way to make a match).
CREATE OR REPLACE FUNCTION scorebook_import_open(p_match uuid)
RETURNS TABLE (ok boolean, reason text, detail text, import_id uuid) AS $$
DECLARE m match%ROWTYPE; v_open uuid; v_id uuid;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.write', p_match) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid; RETURN;
  END IF;
  IF NOT feature_enabled('scorebook_import', m.school_id, app_user_id()) THEN
    RETURN QUERY SELECT false, 'module_disabled', 'scorebook_import is not on for this school; the platform grants it', NULL::uuid; RETURN;
  END IF;
  IF m.sport <> 'cricket' THEN RETURN QUERY SELECT false, 'not_cricket', NULL::text, NULL::uuid; RETURN; END IF;
  IF m.starts_at > now() THEN
    RETURN QUERY SELECT false, 'not_yet_played', 'a scorebook is imported after the match', NULL::uuid; RETURN;
  END IF;
  IF m.status = 'abandoned' THEN RETURN QUERY SELECT false, 'match_abandoned', NULL::text, NULL::uuid; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.scorebook_import'), hashtext(p_match::text));
  IF m.status = 'complete' AND NOT EXISTS (SELECT 1 FROM scorebook_import x WHERE x.match_id = p_match AND x.state = 'confirmed') THEN
    RETURN QUERY SELECT false, 'match_complete', 'a completed match is corrected by an amendment', NULL::uuid; RETURN;
  END IF;
  SELECT x.id INTO v_open FROM scorebook_import x
   WHERE x.match_id = p_match AND x.state IN ('draft', 'reading', 'review', 'submitted', 'returned');
  IF FOUND THEN RETURN QUERY SELECT false, 'import_open', v_open::text, v_open; RETURN; END IF;
  INSERT INTO scorebook_import (school_id, match_id, created_by) VALUES (m.school_id, p_match, app_user_id())
  RETURNING id INTO v_id;
  INSERT INTO scorebook_import_revision (import_id, school_id, match_id, team_code, version, card, typed, checked, action, actor_id)
  VALUES (v_id, m.school_id, p_match, m.team_code, 1, '[]', '{}', '{}', 'create', app_user_id());
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A page's record, once the API has stored its stripped photo under a key
-- naming this import (<school>/<import>/<uuid>.<ext>). At most twelve live
-- pages (an assumption, §5.2); a photo already added is refused by its hash.
-- A page's number is one more than any the import has had, a removed page's
-- included: numbers are never reused, so "page 3" names one photo for good.
CREATE OR REPLACE FUNCTION scorebook_import_page_add(
  p_import uuid, p_key text, p_sha256 text, p_bytes integer, p_width integer, p_height integer, p_mime text)
RETURNS TABLE (ok boolean, reason text, detail text, page_id uuid, page_no smallint) AS $$
DECLARE i scorebook_import%ROWTYPE; v_no smallint; v_id uuid;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.write', i.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid, NULL::smallint; RETURN;
  END IF;
  IF NOT feature_enabled('scorebook_import', i.school_id, app_user_id()) THEN
    RETURN QUERY SELECT false, 'module_disabled', NULL::text, NULL::uuid, NULL::smallint; RETURN;
  END IF;
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import FOR UPDATE;
  IF i.state NOT IN ('draft', 'review', 'returned') THEN
    RETURN QUERY SELECT false, 'not_editable', i.state, NULL::uuid, NULL::smallint; RETURN;
  END IF;
  IF p_key IS NULL OR p_key NOT LIKE i.school_id::text || '/' || i.id::text || '/%' THEN
    RETURN QUERY SELECT false, 'key_invalid', NULL::text, NULL::uuid, NULL::smallint; RETURN;
  END IF;
  IF (SELECT count(*) FROM scorebook_import_page pg
       WHERE pg.import_id = p_import AND pg.deleted_at IS NULL AND pg.removed_at IS NULL) >= 12 THEN
    RETURN QUERY SELECT false, 'too_many_pages', 'twelve pages at most', NULL::uuid, NULL::smallint; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM scorebook_import_page pg WHERE pg.import_id = p_import AND pg.sha256 = p_sha256 AND pg.removed_at IS NULL) THEN
    RETURN QUERY SELECT false, 'duplicate_page', NULL::text, NULL::uuid, NULL::smallint; RETURN;
  END IF;
  SELECT coalesce(max(pg.page_no), 0) + 1 INTO v_no FROM scorebook_import_page pg WHERE pg.import_id = p_import;
  INSERT INTO scorebook_import_page (import_id, school_id, match_id, team_code, page_no, object_key, mime, sha256, bytes, width, height, added_by)
  VALUES (p_import, i.school_id, i.match_id, i.team_code, v_no, p_key, p_mime, p_sha256, p_bytes, p_width, p_height, app_user_id())
  RETURNING id INTO v_id;
  PERFORM scorebook_revise(p_import, 'pages');
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id, v_no;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A wrong photo taken off the import, by whoever may add one, while the
-- import can still be edited. The row says so at once (the page is no longer
-- served, counted or offered), and a 'pages' revision names it, so removing a
-- page makes an author as adding one does (scorebook_authored()). Its photo is
-- then deleted as the purge deletes one: scorebook_import_purge_due() names a
-- removed page until scorebook_page_purged() records its object gone, so a
-- store that failed to delete it is asked again, by the API straight after
-- and by the platform's daily run. No page is renumbered.
CREATE OR REPLACE FUNCTION scorebook_import_page_remove(p_import uuid, p_page_no integer)
RETURNS TABLE (ok boolean, reason text, detail text, version integer) AS $$
DECLARE i scorebook_import%ROWTYPE; pg scorebook_import_page%ROWTYPE; v integer;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.write', i.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::integer; RETURN;
  END IF;
  IF NOT feature_enabled('scorebook_import', i.school_id, app_user_id()) THEN
    RETURN QUERY SELECT false, 'module_disabled', NULL::text, NULL::integer; RETURN;
  END IF;
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import FOR UPDATE;
  IF i.state NOT IN ('draft', 'review', 'returned') THEN
    RETURN QUERY SELECT false, 'not_editable', i.state, NULL::integer; RETURN;
  END IF;
  SELECT * INTO pg FROM scorebook_import_page x WHERE x.import_id = p_import AND x.page_no = p_page_no FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_page', NULL::text, NULL::integer; RETURN; END IF;
  IF pg.removed_at IS NOT NULL THEN RETURN QUERY SELECT false, 'page_removed', NULL::text, NULL::integer; RETURN; END IF;
  IF pg.deleted_at IS NOT NULL THEN RETURN QUERY SELECT false, 'page_deleted', NULL::text, NULL::integer; RETURN; END IF;
  UPDATE scorebook_import_page SET removed_at = now(), removed_by = app_user_id() WHERE id = pg.id;
  v := scorebook_revise(p_import, 'pages', NULL, format('page %s removed', pg.page_no));
  RETURN QUERY SELECT true, NULL::text, NULL::text, v;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The card as the person has typed it so far, with the ticks (§6.3).
-- Optimistic on the version: a save over somebody else's is refused.
CREATE OR REPLACE FUNCTION scorebook_import_save(p_import uuid, p_card jsonb, p_typed jsonb, p_checked jsonb, p_version integer)
RETURNS TABLE (ok boolean, reason text, detail text, version integer) AS $$
DECLARE i scorebook_import%ROWTYPE; v integer;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.write', i.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::integer; RETURN;
  END IF;
  IF NOT feature_enabled('scorebook_import', i.school_id, app_user_id()) THEN
    RETURN QUERY SELECT false, 'module_disabled', NULL::text, NULL::integer; RETURN;
  END IF;
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import FOR UPDATE;
  IF i.state NOT IN ('draft', 'review', 'returned') THEN
    RETURN QUERY SELECT false, 'not_editable', i.state, i.version; RETURN;
  END IF;
  IF p_version IS DISTINCT FROM i.version THEN
    RETURN QUERY SELECT false, 'version_conflict', i.version::text, i.version; RETURN;
  END IF;
  IF jsonb_typeof(p_card) IS DISTINCT FROM 'array' OR jsonb_array_length(p_card) > 4
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_card) e WHERE jsonb_typeof(e) <> 'object')
     OR jsonb_typeof(p_typed) IS DISTINCT FROM 'object' OR jsonb_typeof(p_checked) IS DISTINCT FROM 'object'
     OR octet_length(p_card::text) + octet_length(p_typed::text) + octet_length(p_checked::text) > 200000 THEN
    RETURN QUERY SELECT false, 'card_shape', 'a list of at most four cards, the typed names and the ticks', i.version; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_typed) t
              WHERE t.key !~ '^t:\d{1,3}$' OR jsonb_typeof(t.value) <> 'string'
                 OR length(btrim(t.value #>> '{}')) NOT BETWEEN 1 AND 80) THEN
    RETURN QUERY SELECT false, 'typed_invalid', 't:<n> to a name of 1 to 80 characters', i.version; RETURN;
  END IF;
  UPDATE scorebook_import SET card = p_card, typed = p_typed,
         state = CASE WHEN state IN ('draft', 'returned') THEN 'review' ELSE state END
   WHERE id = p_import;
  v := scorebook_revise(p_import, 'save', p_checked);
  RETURN QUERY SELECT true, NULL::text, NULL::text, v;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- For the second person. Every cell ticked is the route's to check (it runs
-- the same list the screen does, uncheckedCells()); the arithmetic and the
-- players are checked here too, so no client can skip them.
CREATE OR REPLACE FUNCTION scorebook_import_submit(p_import uuid, p_version integer)
RETURNS TABLE (ok boolean, reason text, detail text, version integer) AS $$
DECLARE i scorebook_import%ROWTYPE; p record; v integer;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.write', i.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::integer; RETURN;
  END IF;
  IF NOT feature_enabled('scorebook_import', i.school_id, app_user_id()) THEN
    RETURN QUERY SELECT false, 'module_disabled', NULL::text, NULL::integer; RETURN;
  END IF;
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import FOR UPDATE;
  IF i.state NOT IN ('review', 'returned') THEN RETURN QUERY SELECT false, 'not_submittable', i.state, i.version; RETURN; END IF;
  IF p_version IS DISTINCT FROM i.version THEN
    RETURN QUERY SELECT false, 'version_conflict', i.version::text, i.version; RETURN;
  END IF;
  SELECT * INTO p FROM scorebook_cards_problem(p_import);
  IF p.reason IS NOT NULL THEN RETURN QUERY SELECT false, p.reason, p.detail, i.version; RETURN; END IF;
  UPDATE scorebook_import SET state = 'submitted', submitted_by = app_user_id(), submitted_at = now() WHERE id = p_import;
  v := scorebook_revise(p_import, 'submit');
  RETURN QUERY SELECT true, NULL::text, NULL::text, v;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The confirmer sends it back with a note, and edits nothing (§4.2).
CREATE OR REPLACE FUNCTION scorebook_import_return(p_import uuid, p_note text)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE i scorebook_import%ROWTYPE;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.confirm', i.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF scorebook_authored(p_import) THEN RETURN QUERY SELECT false, 'cannot_confirm_your_own', NULL::text; RETURN; END IF;
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import FOR UPDATE;
  IF i.state <> 'submitted' THEN RETURN QUERY SELECT false, 'not_submitted', i.state; RETURN; END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 10 THEN
    RETURN QUERY SELECT false, 'note_required', 'say what to look at, in ten characters or more'; RETURN;
  END IF;
  UPDATE scorebook_import SET state = 'returned', returned_by = app_user_id(), returned_at = now(), returned_note = btrim(p_note)
   WHERE id = p_import;
  PERFORM scorebook_revise(p_import, 'return', NULL, btrim(p_note));
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The commit (§4.3, the amendment route's shape; see the header). Writes,
 * per card in innings order, innings_start (the pad's shape: sides, squads
 * of ids for our boys and typed keys for theirs, overs, the target of a
 * chase; no capture profile — nothing was captured), innings_summary (the
 * card, the typed names this card uses, the source) and innings_end (the
 * card's ending, confirmed against the card's own figures). All three carry
 * payload.source = {kind: scorebook, import, checkedBy, confirmedBy}, are
 * authored by the submitter (the person who checked the cells), come from
 * device 'scorebook:<import>' and take the match's epoch, as db/38's void
 * does. Then the match is complete (D10), scoring_audit has a row, and the
 * import is confirmed with the keys it wrote.
 *
 * p_resolve (the workload estimates the confirmer ticks, §3.2) is phase 3,
 * and refused here unless empty. p_acknowledge: the confirmer's tick for a
 * card whose batting does not add up to its total and says so (D4).
 */
CREATE OR REPLACE FUNCTION scorebook_import_commit(p_import uuid, p_resolve uuid[], p_acknowledge boolean, p_note text DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text, detail text, keys text[]) AS $$
DECLARE
  i        scorebook_import%ROWTYPE;
  m        match%ROWTYPE;
  p        record;
  f        record;
  c        jsonb;
  v_play   jsonb;
  v_ips    integer;
  v_overs  integer;
  v_seq    integer;
  v_epoch  integer;
  v_src    jsonb;
  v_home   text;
  v_away   text;
  v_bat    text;
  v_bowl   text;
  v_squad  jsonb;
  v_bsquad jsonb;
  v_typed  jsonb;
  v_target integer;
  v_inn    smallint;
  v_keys   text[] := '{}';
  v_key    text;
BEGIN
  -- Read to learn the match; locked below, in the live path's order.
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.confirm', i.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::text[]; RETURN;
  END IF;
  IF scorebook_authored(p_import) THEN RETURN QUERY SELECT false, 'cannot_confirm_your_own', NULL::text, NULL::text[]; RETURN; END IF;
  IF NOT feature_enabled('scorebook_import', i.school_id, app_user_id()) THEN
    RETURN QUERY SELECT false, 'module_disabled', NULL::text, NULL::text[]; RETURN;
  END IF;
  IF cardinality(coalesce(p_resolve, '{}')) > 0 THEN
    RETURN QUERY SELECT false, 'not_in_this_phase', 'retiring a coach''s workload estimate at the commit is SCRBRD-120 phase 3', NULL::text[]; RETURN;
  END IF;
  -- Everything that can refuse without the lock, before anything is taken or
  -- fixed: a refused commit leaves the match exactly as it was.
  IF i.state <> 'submitted' THEN RETURN QUERY SELECT false, 'not_submitted', i.state, NULL::text[]; RETURN; END IF;
  SELECT * INTO p FROM scorebook_cards_problem(p_import);
  IF p.reason IS NOT NULL THEN RETURN QUERY SELECT false, p.reason, p.detail, NULL::text[]; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(i.card) e WHERE jsonb_typeof(e->'unreconciled') = 'object')
     AND p_acknowledge IS NOT TRUE THEN
    RETURN QUERY SELECT false, 'unreconciled_not_acknowledged',
      'the book''s batting does not add up to its total; confirm that it is recorded as the book has it', NULL::text[]; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM match x WHERE x.id = i.match_id AND x.status = 'complete')
     AND NOT EXISTS (SELECT 1 FROM scorebook_import x WHERE x.match_id = i.match_id AND x.state = 'confirmed') THEN
    RETURN QUERY SELECT false, 'match_complete', 'a completed match is corrected by an amendment', NULL::text[]; RETURN;
  END IF;

  -- The live path's lock: the session row, then the match's conditions lock
  -- (match_conditions_fix() takes both, in that order), held to the caller's
  -- commit; then the import and the match, asked again under it.
  SELECT * INTO f FROM match_conditions_fix(i.match_id);
  IF NOT f.fixed AND f.reason IS DISTINCT FROM 'scored_before_conditions' THEN
    RETURN QUERY SELECT false, coalesce(f.reason, 'not_permitted'), NULL::text, NULL::text[]; RETURN;
  END IF;
  PERFORM 1 FROM scoring_session s WHERE s.match_id = i.match_id FOR UPDATE;
  PERFORM match_conditions_lock(i.match_id);
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.scorebook_import'), hashtext(i.match_id::text));
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import FOR UPDATE;
  IF i.state <> 'submitted' THEN RETURN QUERY SELECT false, 'not_submitted', i.state, NULL::text[]; RETURN; END IF;
  SELECT * INTO m FROM match x WHERE x.id = i.match_id FOR UPDATE;
  IF m.status = 'complete' AND NOT EXISTS (SELECT 1 FROM scorebook_import x WHERE x.match_id = m.id AND x.state = 'confirmed') THEN
    RETURN QUERY SELECT false, 'match_complete', 'a completed match is corrected by an amendment', NULL::text[]; RETURN;
  END IF;

  v_play := coalesce((SELECT mc.doc->'play' FROM match_conditions mc WHERE mc.match_id = m.id), '{}'::jsonb);
  v_ips := CASE WHEN jsonb_typeof(v_play->'format.innings_per_side') = 'number' THEN (v_play->>'format.innings_per_side')::integer
                WHEN free_hits_apply(m.format) THEN 1 ELSE 2 END;
  v_overs := play_overs(v_play, m.overs);
  v_home := coalesce(m.team_code, 'Home');
  v_away := m.opponent;
  SELECT coalesce(max(b.seq), 0) + 1, coalesce(max(b.epoch), 1) INTO v_seq, v_epoch FROM ball_event b WHERE b.match_id = m.id;
  v_src := jsonb_build_object('kind', 'scorebook', 'import', i.id, 'checkedBy', i.submitted_by, 'confirmedBy', app_user_id());
  PERFORM set_config('scrbrd.scorebook_commit', i.id::text, true);

  FOR c IN SELECT e FROM jsonb_array_elements(i.card) e ORDER BY (e->>'innings')::integer LOOP
    v_inn := (c->>'innings')::smallint;
    IF c->>'battingSide' = 'home' THEN v_bat := v_home; v_bowl := v_away; ELSE v_bat := v_away; v_bowl := v_home; END IF;
    -- Squads: our boys by id and name, theirs by typed key alone (the
    -- spelling lives in the summary's typed map and nowhere else, D6).
    SELECT coalesce(jsonb_agg(CASE WHEN p2.id IS NOT NULL THEN jsonb_build_object('id', x.ref, 'name', p2.full_name)
                                   ELSE jsonb_build_object('id', x.ref) END ORDER BY x.n), '[]')
      INTO v_squad
      FROM (SELECT DISTINCT ON (y.ref) y.ref, y.n FROM (
              SELECT e->>'ref' AS ref, n FROM jsonb_array_elements(c->'batting') WITH ORDINALITY AS t(e, n)
              UNION ALL SELECT e #>> '{}', 100 + n FROM jsonb_array_elements(c->'didNotBat') WITH ORDINALITY AS t(e, n)) y
            ORDER BY y.ref, y.n) x
      LEFT JOIN player p2 ON p2.id = public_ref_uuid(x.ref) AND p2.school_id = m.school_id;
    SELECT coalesce(jsonb_agg(CASE WHEN p2.id IS NOT NULL THEN jsonb_build_object('id', x.ref, 'name', p2.full_name)
                                   ELSE jsonb_build_object('id', x.ref) END ORDER BY x.n), '[]')
      INTO v_bsquad
      FROM (SELECT DISTINCT ON (y.ref) y.ref, y.n FROM (
              SELECT e->>'ref' AS ref, n FROM jsonb_array_elements(c->'bowling') WITH ORDINALITY AS t(e, n)
              UNION ALL SELECT e->>'fielderRef', 100 + n FROM jsonb_array_elements(c->'batting') WITH ORDINALITY AS t(e, n)
               WHERE e->>'fielderRef' IS NOT NULL) y
            ORDER BY y.ref, y.n) x
      LEFT JOIN player p2 ON p2.id = public_ref_uuid(x.ref) AND p2.school_id = m.school_id;
    SELECT coalesce(jsonb_object_agg(t.key, t.value), '{}') INTO v_typed
      FROM jsonb_each(i.typed) t
     WHERE t.key IN (SELECT e->>'ref' FROM jsonb_array_elements(c->'batting') e
                     UNION SELECT e->>'fielderRef' FROM jsonb_array_elements(c->'batting') e
                     UNION SELECT e->>'bowlerRef' FROM jsonb_array_elements(c->'batting') e
                     UNION SELECT e #>> '{}' FROM jsonb_array_elements(c->'didNotBat') e
                     UNION SELECT e->>'ref' FROM jsonb_array_elements(c->'bowling') e
                     UNION SELECT e->>'ref' FROM jsonb_array_elements(c->'fallOfWickets') e);
    -- The target of the last innings of the match: what the other side made,
    -- less what this side has made already, and one — read from the innings
    -- already in the log, this commit's included.
    v_target := NULL;
    IF v_inn > 0 AND v_inn = 2 * v_ips - 1
       AND (SELECT count(DISTINCT b.innings) FROM ball_event_live b WHERE b.match_id = m.id AND b.innings < v_inn) = v_inn THEN
      SELECT sum(CASE WHEN s.side IS DISTINCT FROM v_bat THEN s.runs ELSE -s.runs END) + 1 INTO v_target
        FROM (SELECT j.inn,
                     (SELECT coalesce(b.payload->>'teamKey', b.payload->>'battingTeam') FROM ball_event_live b
                       WHERE b.match_id = m.id AND b.innings = j.inn AND b.kind = 'innings_start' ORDER BY b.seq DESC LIMIT 1) AS side,
                     (SELECT r.runs FROM innings_score_as_folded(m.id, j.inn::smallint) r) AS runs
                FROM generate_series(0, v_inn - 1) AS j(inn)) s;
    END IF;

    v_key := format('scorebook:%s:%s:start', i.id, v_inn);
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, payload)
    VALUES (m.id, m.school_id, v_seq, v_epoch, v_inn, i.submitted_by, 'scorebook:' || i.id, v_key, v_seq, now(), 'innings_start',
            jsonb_build_object(
              'battingTeam', v_bat, 'bowlingTeam', v_bowl, 'teamKey', v_bat, 'bowlingTeamKey', v_bowl,
              'squad', v_squad, 'bowlingSquad', v_bsquad, 'twelfthMan', NULL, 'overs', v_overs, 'target', v_target,
              'source', v_src));
    v_keys := v_keys || v_key; v_seq := v_seq + 1;

    v_key := format('scorebook:%s:%s:summary', i.id, v_inn);
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, payload)
    VALUES (m.id, m.school_id, v_seq, v_epoch, v_inn, i.submitted_by, 'scorebook:' || i.id, v_key, v_seq, now(), 'innings_summary',
            jsonb_build_object('card', c, 'typed', v_typed, 'source', v_src));
    v_keys := v_keys || v_key; v_seq := v_seq + 1;

    v_key := format('scorebook:%s:%s:end', i.id, v_inn);
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, payload)
    VALUES (m.id, m.school_id, v_seq, v_epoch, v_inn, i.submitted_by, 'scorebook:' || i.id, v_key, v_seq, now(), 'innings_end',
            jsonb_build_object('reason', scorebook_end_reason(c->>'endReason'),
                               'confirmed', jsonb_build_object('runs', (c->>'total')::integer, 'wickets', (c->>'wickets')::integer,
                                                               'balls', scorebook_balls(c->'overs')),
                               'source', v_src));
    v_keys := v_keys || v_key; v_seq := v_seq + 1;
  END LOOP;
  PERFORM set_config('scrbrd.scorebook_commit', '', true);

  -- The match is complete (D10): scoring_claim() refuses it from now on.
  UPDATE match SET status = 'complete' WHERE id = m.id;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, epoch, detail)
  VALUES (m.id, m.school_id, 'scorebook_import', app_user_id(), v_epoch,
          jsonb_build_object('import', i.id, 'innings', (SELECT jsonb_agg((e->>'innings')::integer ORDER BY (e->>'innings')::integer)
                                                           FROM jsonb_array_elements(i.card) e),
                             'keys', to_jsonb(v_keys), 'checkedBy', i.submitted_by));
  -- The revision first: a confirmed import no longer changes (its guard).
  PERFORM scorebook_revise(p_import, 'confirm', NULL, nullif(btrim(coalesce(p_note, '')), ''));
  UPDATE scorebook_import SET state = 'confirmed', confirmed_by = app_user_id(), confirmed_at = now(),
         confirm_note = nullif(btrim(coalesce(p_note, '')), ''), unreconciled_acknowledged = coalesce(p_acknowledge, false),
         applied_keys = v_keys
   WHERE id = p_import;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_keys;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Given up on, by whoever works on it or signs it; its photos are deleted at
-- once (§5.3: the API asks scorebook_import_purge_due() for them next).
CREATE OR REPLACE FUNCTION scorebook_import_abandon(p_import uuid)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE i scorebook_import%ROWTYPE;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT (scorebook_may('scoring.import.write', i.match_id) OR scorebook_may('scoring.import.confirm', i.match_id)) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import FOR UPDATE;
  IF i.state IN ('confirmed', 'abandoned') THEN RETURN QUERY SELECT false, 'not_abandonable', i.state; RETURN; END IF;
  -- The revision first: an abandoned import no longer changes (its guard).
  PERFORM scorebook_revise(p_import, 'abandon');
  UPDATE scorebook_import SET state = 'abandoned', abandoned_by = app_user_id(), abandoned_at = now() WHERE id = p_import;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 9 · The photos: every read on the record, and the clock (§5) ────
-- A page's key, for the API to fetch and send — to a holder of
-- scoring.import.read over the import's fixture, as themself (never a
-- support session or a pad's credential), with the module on — and one
-- access_log row per read: `scorebook_page`, the import, `page:<n>`. The
-- row is written before the photo is fetched, so a read the API then fails
-- to finish is still on the record. A parent's "who looked at the photo
-- with my son's name on it" has its answer here (§4.5).
CREATE OR REPLACE FUNCTION scorebook_page_open(p_import uuid, p_page_no integer)
RETURNS TABLE (ok boolean, reason text, object_key text, mime text, sha256 text, bytes integer) AS $$
DECLARE i scorebook_import%ROWTYPE; pg scorebook_import_page%ROWTYPE;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.read', i.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::text, NULL::text, NULL::integer; RETURN;
  END IF;
  IF NOT feature_enabled('scorebook_import', i.school_id, app_user_id()) THEN
    RETURN QUERY SELECT false, 'module_disabled', NULL::text, NULL::text, NULL::text, NULL::integer; RETURN;
  END IF;
  SELECT * INTO pg FROM scorebook_import_page x WHERE x.import_id = p_import AND x.page_no = p_page_no;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_page', NULL::text, NULL::text, NULL::text, NULL::integer; RETURN; END IF;
  IF pg.removed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'page_removed', NULL::text, NULL::text, NULL::text, NULL::integer; RETURN;
  END IF;
  IF pg.deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'page_deleted', NULL::text, NULL::text, NULL::text, NULL::integer; RETURN;
  END IF;
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count, fields, device_id)
  VALUES (i.school_id, app_user_id(), 'scorebook_page', ARRAY[i.id], 1, ARRAY['page:' || pg.page_no], app_device_id());
  RETURN QUERY SELECT true, NULL::text, pg.object_key, pg.mime, pg.sha256, pg.bytes;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Is the caller the platform (the key that runs the daily purge)?
CREATE OR REPLACE FUNCTION scorebook_platform_caller() RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND NOT app_pad_scoped()
     AND app_can('platform.feature.manage', '00000000-0000-0000-0000-000000000000'::uuid, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The photos due for deletion (§5.3, D7): every page, not yet deleted, of an
 * import abandoned, or confirmed more than scorebook_page_retention() ago,
 * and every page a writer removed (scorebook_import_page_remove()), whatever
 * its import's state.
 * With no import named — the daily run, by the platform (platform.feature.
 * manage, platform-wide) — it first abandons every draft, review or returned
 * import untouched for that long, with a revision saying so; an import
 * submitted and waiting for its confirmer is never touched. With an import
 * named — the abandon route, straight after — for whoever may work on it or
 * sign it. The API deletes each object and then calls scorebook_page_purged().
 * Nobody else is told anything: an empty answer.
 */
CREATE OR REPLACE FUNCTION scorebook_import_purge_due(p_import uuid DEFAULT NULL)
RETURNS TABLE (page_id uuid, import_id uuid, object_key text) AS $$
DECLARE r record;
BEGIN
  IF p_import IS NULL THEN
    IF NOT scorebook_platform_caller() THEN RETURN; END IF;
    FOR r IN SELECT x.id FROM scorebook_import x
              WHERE x.state IN ('draft', 'reading', 'review', 'returned') AND x.touched_at < now() - scorebook_page_retention()
              ORDER BY x.id FOR UPDATE LOOP
      PERFORM scorebook_revise(r.id, 'abandon', NULL, 'untouched for thirty days');
      UPDATE scorebook_import SET state = 'abandoned', abandoned_by = app_user_id(), abandoned_at = now() WHERE id = r.id;
    END LOOP;
  ELSIF NOT EXISTS (SELECT 1 FROM scorebook_import x WHERE x.id = p_import
                     AND (scorebook_platform_caller() OR scorebook_may('scoring.import.write', x.match_id)
                          OR scorebook_may('scoring.import.confirm', x.match_id))) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT pg.id, pg.import_id, pg.object_key
      FROM scorebook_import_page pg JOIN scorebook_import x ON x.id = pg.import_id
     WHERE pg.deleted_at IS NULL AND (p_import IS NULL OR x.id = p_import)
       AND (pg.removed_at IS NOT NULL
            OR x.state = 'abandoned' OR (x.state = 'confirmed' AND x.confirmed_at < now() - scorebook_page_retention()))
     ORDER BY pg.import_id, pg.page_no;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A page's photo was deleted from the store: the row says when, and the
-- import says so once its last page is gone. The rows stay (§5.3). Only a
-- page that was due, for whoever may ask for it.
CREATE OR REPLACE FUNCTION scorebook_page_purged(p_page uuid) RETURNS boolean AS $$
DECLARE pg scorebook_import_page%ROWTYPE; x scorebook_import%ROWTYPE;
BEGIN
  SELECT * INTO pg FROM scorebook_import_page y WHERE y.id = p_page FOR UPDATE;
  IF NOT FOUND OR pg.deleted_at IS NOT NULL THEN RETURN false; END IF;
  SELECT * INTO x FROM scorebook_import y WHERE y.id = pg.import_id FOR UPDATE;
  IF NOT (scorebook_platform_caller() OR scorebook_may('scoring.import.write', x.match_id)
          OR scorebook_may('scoring.import.confirm', x.match_id)) THEN RETURN false; END IF;
  IF NOT (pg.removed_at IS NOT NULL
          OR x.state = 'abandoned' OR (x.state = 'confirmed' AND x.confirmed_at < now() - scorebook_page_retention())) THEN
    RETURN false;
  END IF;
  UPDATE scorebook_import_page SET deleted_at = now() WHERE id = p_page;
  -- An import that can still take pages is not "purged" because the one page
  -- it had was removed.
  IF x.state IN ('confirmed', 'abandoned')
     AND NOT EXISTS (SELECT 1 FROM scorebook_import_page y WHERE y.import_id = x.id AND y.deleted_at IS NULL) THEN
    UPDATE scorebook_import SET pages_purged_at = now() WHERE id = x.id;
  END IF;
  RETURN true;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 9a · The names on a card and on its history, for whoever checks it (§9.4)
-- The display name of each of the school's own boys the import's card names,
-- for a caller who may read the import (scorebook_may('scoring.import.read'):
-- the typist and the confirmer, as themselves; never a support session or a
-- pad's credential) with the module on. A confirmer outside the school — a
-- league's administrator — cannot read the school's roster, and must check
-- each name against the photo that already shows it (D5). Nothing else: no
-- other field, no boy the card does not name, no other school's child (a
-- draft may name one; submit refuses it, not_our_player), no typed name
-- (the card's own typed map has those).
CREATE OR REPLACE FUNCTION scorebook_import_names(p_import uuid)
RETURNS TABLE (player_id uuid, name text) AS $$
DECLARE i scorebook_import%ROWTYPE;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.read', i.match_id)
     OR NOT coalesce(feature_enabled('scorebook_import', i.school_id, app_user_id()), false) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT p.id, p.full_name
      FROM scorebook_card_refs(i.card) x(ref)
      JOIN player p ON p.id = public_ref_uuid(x.ref) AND p.school_id = i.school_id
     ORDER BY p.id;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Who wrote each revision, by name, under the same rule: only to a caller
-- who may read the import, with the module on. Staff names only: the actors
-- are the adults who typed, returned, confirmed or abandoned it. A person who
-- is also a pupil (a player record of their own, or a live player or
-- selfaccess assignment: a pupil scorer) is left unnamed — the history still
-- says a revision was theirs by id, and a pupil's name is not sent to a
-- league's administrator for the sake of a history line.
CREATE OR REPLACE FUNCTION scorebook_import_actors(p_import uuid)
RETURNS TABLE (actor_id uuid, name text) AS $$
DECLARE i scorebook_import%ROWTYPE;
BEGIN
  SELECT * INTO i FROM scorebook_import x WHERE x.id = p_import;
  IF NOT FOUND OR NOT scorebook_may('scoring.import.read', i.match_id)
     OR NOT coalesce(feature_enabled('scorebook_import', i.school_id, app_user_id()), false) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT u.id, u.name
      FROM scorebook_import_revision r
      JOIN app_user u ON u.id = r.actor_id
     WHERE r.import_id = p_import
       AND u.player_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM role_assignment ra
                        WHERE ra.person_id = u.id AND ra.role IN ('player', 'selfaccess') AND ra.active
                          AND (ra.valid_until IS NULL OR ra.valid_until > current_date))
     ORDER BY u.id;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 10 · The two readers the commit and the score rely on (§2.4) ────
-- The shape of everything replaced, before it is: checked at the end.
DROP TABLE IF EXISTS _db63_before;
CREATE TEMP TABLE _db63_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions), 'acl', to_jsonb(c.relacl::text[]), 'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname = 'match_live_score'
UNION ALL
SELECT 'function:' || p.oid::regprocedure::text,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef, 'volatility', p.provolatile, 'parallel', p.proparallel, 'strict', p.proisstrict,
         'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
         'language', p.prolang)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.oid::regprocedure::text IN ('innings_score_as_folded(uuid,smallint)', 'public_match_log(uuid,integer)');

-- A summarised innings is its summary's figures, and nothing a delivery
-- would add: runs are the card's total (with any penalty runs credited to it
-- from another innings, as for any innings), wickets and legal balls the
-- card's. Every innings scored on a pad reads exactly as before (db/54).
CREATE OR REPLACE VIEW match_live_score WITH (security_invoker = true) AS
SELECT
  match_id,
  innings,
  CASE WHEN bool_or(kind = 'innings_summary')
       THEN ((array_agg(payload->'card' ORDER BY seq DESC) FILTER (WHERE kind = 'innings_summary'))[1]->>'total')::integer
            + penalty_credit_as_folded(match_id, innings)
       WHEN bool_and(penalty_runs_as_folded(kind, payload) IS NOT NULL)
       THEN sum(CASE WHEN kind <> 'ball'               THEN 0
                     WHEN ball_type IN ('Wd','Nb')    THEN 1 + coalesce(value,0)
                     ELSE coalesce(value,0) END)
            + sum(penalty_runs_as_folded(kind, payload))
            + penalty_credit_as_folded(match_id, innings)
  END                                                                     AS runs,
  CASE WHEN bool_or(kind = 'innings_summary')
       THEN ((array_agg(payload->'card' ORDER BY seq DESC) FILTER (WHERE kind = 'innings_summary'))[1]->>'wickets')::integer
       ELSE sum(CASE WHEN (kind = 'ball' AND ball_wicket_stands(match_id, innings, seq, kind, ball_type, dismissal))
                          OR ball_retirement_dismissal(kind, ball_type, dismissal, payload) IS NOT NULL
                     THEN 1 ELSE 0 END)
  END                                                                     AS wickets,
  CASE WHEN bool_or(kind = 'innings_summary')
       THEN scorebook_balls((array_agg(payload->'card' ORDER BY seq DESC) FILTER (WHERE kind = 'innings_summary'))[1]->'overs')
       ELSE sum(CASE WHEN kind='ball' AND ball_counts_in_over(ball_type, payload) THEN 1 ELSE 0 END)
  END                                                                     AS legal_balls,
  max(seq)                                                                AS last_seq,
  max(server_ts)                                                          AS last_ball_at
FROM ball_event_live
GROUP BY match_id, innings;

-- The handover's and the commit's count: the same rule, per innings.
CREATE OR REPLACE FUNCTION innings_score_as_folded(p_match uuid, p_innings smallint)
RETURNS TABLE (runs integer, wickets integer, legal_balls integer) AS $$
  SELECT
    CASE WHEN s.card IS NOT NULL THEN (s.card->>'total')::integer + penalty_credit_as_folded(p_match, p_innings) ELSE l.runs END,
    CASE WHEN s.card IS NOT NULL THEN (s.card->>'wickets')::integer ELSE l.wickets END,
    CASE WHEN s.card IS NOT NULL THEN scorebook_balls(s.card->'overs') ELSE l.legal_balls END
  FROM (
    SELECT
      CASE WHEN coalesce(bool_and(penalty_runs_as_folded(b.kind, b.payload) IS NOT NULL), true)
           THEN (coalesce(sum(CASE WHEN b.kind <> 'ball'               THEN 0
                                   WHEN b.ball_type IN ('Wd', 'Nb')    THEN 1 + coalesce(b.value, 0)
                                   ELSE coalesce(b.value, 0) END), 0)
                 + coalesce(sum(penalty_runs_as_folded(b.kind, b.payload)), 0))::integer
                + penalty_credit_as_folded(p_match, p_innings)
      END AS runs,
      count(*) FILTER (WHERE (b.kind = 'ball'
                              AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
                          OR ball_retirement_dismissal(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL)::integer AS wickets,
      count(*) FILTER (WHERE b.kind = 'ball' AND ball_counts_in_over(b.ball_type, b.payload))::integer AS legal_balls
    FROM ball_event_live b
    WHERE b.match_id = p_match AND b.innings = p_innings) l
  LEFT JOIN LATERAL (
    SELECT b.payload->'card' AS card
      FROM ball_event_live b
     WHERE b.match_id = p_match AND b.innings = p_innings AND b.kind = 'innings_summary'
     ORDER BY b.seq DESC
     LIMIT 1) s ON true
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- ── 11 · The public log serves the card, never a typed name (§4.4) ──
-- db/59's, with one kind and one field more: an innings_summary's card, as
-- the fold needs it, without the reviewer's note on a recorded difference.
-- The typed map, the source (who checked, who confirmed) and every other
-- payload key are never selected, so they reach nobody; the API then
-- pseudonymises every ref in the card (redact.mjs), and a typed key names a
-- position, never a boy. Otherwise db/59's line for line.
CREATE OR REPLACE FUNCTION public_match_log(p_match uuid, p_since integer DEFAULT 0)
RETURNS TABLE (
  seq integer, innings smallint, kind text, ball_type text, value smallint,
  striker_id uuid, non_striker_id uuid, bowler_id uuid, dismissed_id uuid, dismissal text,
  event_key text, client_ts timestamptz, detail jsonb
) AS $$
  SELECT b.seq, b.innings, b.kind, b.ball_type, b.value,
         b.striker_id, b.non_striker_id, b.bowler_id, b.dismissed_id, b.dismissal,
         b.idempotency_key, b.client_ts,
         jsonb_strip_nulls(jsonb_build_object(
           -- innings_start
           'battingTeam',    b.payload -> 'battingTeam',
           'bowlingTeam',    b.payload -> 'bowlingTeam',
           'teamKey',        b.payload -> 'teamKey',
           'bowlingTeamKey', b.payload -> 'bowlingTeamKey',
           'squad',          b.payload -> 'squad',
           'bowlingSquad',   b.payload -> 'bowlingSquad',
           'overs',          b.payload -> 'overs',
           'target',         b.payload -> 'target',
           -- a player the scorer typed, where the column holds no id
           'striker',        b.payload -> 'striker',
           'nonStriker',     b.payload -> 'nonStriker',
           'bowler',         b.payload -> 'bowler',
           'dismissed',      b.payload -> 'dismissed',
           -- batters
           'captainConsent', b.payload -> 'captainConsent',
           -- ball
           'fielder',        b.payload -> 'fielder',
           'freeHit',        b.payload -> 'freeHit',
           'nbRuns',         b.payload -> 'nbRuns',
           'nbType',         b.payload -> 'nbType',
           'outAt',          b.payload -> 'outAt',
           'facesNext',      b.payload -> 'facesNext',
           'notInOver',      b.payload -> 'notInOver',
           -- penalty
           'runs',           b.payload -> 'runs',
           'toBattingTeam',  b.payload -> 'toBattingTeam',
           -- retire; penalty, innings_end and revision reasons (the API keeps
           -- a reason only where it is a code from a closed list)
           'batter',         b.payload -> 'batter',
           'reason',         b.payload -> 'reason',
           -- innings_end
           'confirmed',      b.payload -> 'confirmed',
           -- innings_summary (db/63): the card, less the note on a difference
           'card',           CASE WHEN b.kind = 'innings_summary' THEN (b.payload -> 'card') #- '{unreconciled,note}' END)) AS detail
    FROM ball_event b
   WHERE b.match_id = p_match
     AND b.seq > coalesce(p_since, 0)
     AND b.kind IN ('innings_start', 'batters', 'bowler', 'ball', 'penalty', 'retire',
                    'innings_end', 'revision', 'void', 'innings_summary')
     AND public_fixture_served(b.match_id)
   ORDER BY b.seq
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_match_log(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_match_log(uuid, integer) TO scrbrd_app;

-- ── 12 · Grants ────────────────────────────────────────────────────
DO $grants$
DECLARE f text; r text;
  app text[] := ARRAY[
    'scorebook_import_open(uuid)', 'scorebook_import_page_add(uuid,text,text,integer,integer,integer,text)',
    'scorebook_import_page_remove(uuid,integer)', 'scorebook_caller_may(uuid)', 'scorebook_import_names(uuid)',
    'scorebook_import_actors(uuid)',
    'scorebook_import_save(uuid,jsonb,jsonb,jsonb,integer)', 'scorebook_import_submit(uuid,integer)',
    'scorebook_import_return(uuid,text)', 'scorebook_import_commit(uuid,uuid[],boolean,text)',
    'scorebook_import_abandon(uuid)', 'scorebook_page_open(uuid,integer)',
    'scorebook_import_purge_due(uuid)', 'scorebook_page_purged(uuid)',
    'summary_reconciles(jsonb,jsonb,text)', 'scorebook_overs_balls(text)', 'scorebook_balls(jsonb)',
    'scorebook_is_count(jsonb)', 'scorebook_is_ref(jsonb)', 'scorebook_end_reason(text)', 'scorebook_page_retention()'];
  internal text[] := ARRAY[
    'scorebook_ours(uuid)', 'scorebook_actor_ok(uuid)', 'scorebook_may(text,uuid)', 'scorebook_authored(uuid)',
    'scorebook_revise(uuid,text,jsonb,text)', 'scorebook_cards_problem(uuid)', 'scorebook_platform_caller()',
    'scorebook_card_refs(jsonb)',
    'scorebook_import_guard()', 'ball_event_scorebook_door()'];
BEGIN
  FOREACH f IN ARRAY app LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  FOREACH f IN ARRAY internal LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  -- A managed host's API roles (Supabase grants new functions and tables to them).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY app || internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON scorebook_import, scorebook_import_page, scorebook_import_revision FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

-- ── 13 · The proof ────────────────────────────────────────────────
-- Built and rolled back. db/99 §41 is the fuller proof, with principals, on
-- every verify paste, and tools/smoke-scorebook.mjs the API's; this is what
-- must hold the moment the file has run.
DO $check$
DECLARE
  r        record;
  now_shape jsonb;
  got      text;
  -- The base card of packages/scoring/test/scorebook-cards.mjs: 127 for 4 in 20.
  CARD jsonb := '{"v":1,"innings":0,"battingSide":"home","batting":[{"order":1,"ref":"a0000063-0000-0000-0000-000000000001","howOut":"caught","fielderRef":"t:1","bowlerRef":"t:2","runs":34,"balls":40,"fours":4,"sixes":1},{"order":2,"ref":"a0000063-0000-0000-0000-000000000002","howOut":"bowled","fielderRef":null,"bowlerRef":"t:2","runs":12,"balls":15,"fours":1,"sixes":0},{"order":3,"ref":"a0000063-0000-0000-0000-000000000003","howOut":"lbw","fielderRef":null,"bowlerRef":"t:3","runs":0,"balls":3,"fours":0,"sixes":0},{"order":4,"ref":"a0000063-0000-0000-0000-000000000004","howOut":"run_out","fielderRef":"t:4","bowlerRef":null,"runs":25,"balls":null,"fours":null,"sixes":null},{"order":5,"ref":"a0000063-0000-0000-0000-000000000005","howOut":"not_out","fielderRef":null,"bowlerRef":null,"runs":40,"balls":30,"fours":5,"sixes":1},{"order":6,"ref":"a0000063-0000-0000-0000-000000000006","howOut":"not_out","fielderRef":null,"bowlerRef":null,"runs":5,"balls":4,"fours":0,"sixes":0}],"didNotBat":[],"bowling":[{"ref":"t:2","overs":"8","maidens":0,"runs":40,"wickets":2,"wides":3,"noBalls":1},{"ref":"t:3","overs":"8","maidens":1,"runs":45,"wickets":1,"wides":2,"noBalls":2},{"ref":"t:5","overs":"4","maidens":null,"runs":39,"wickets":0,"wides":null,"noBalls":null}],"extras":{"byes":2,"legByes":1,"wides":5,"noBalls":3,"penalty":0},"total":127,"wickets":4,"overs":"20","fallOfWickets":[{"wicket":1,"score":30,"ref":"a0000063-0000-0000-0000-000000000002","over":"5.1"},{"wicket":2,"score":31,"ref":"a0000063-0000-0000-0000-000000000003","over":"5.3"},{"wicket":3,"score":60,"ref":"a0000063-0000-0000-0000-000000000001","over":"10.2"},{"wicket":4,"score":90,"ref":"a0000063-0000-0000-0000-000000000004","over":"15"}],"endReason":"overs","unreconciled":{"runs":0,"note":"a reviewer''s words"}}';
  TYPED jsonb := '{"t:1":"Opp Fielder One","t:2":"Opp Bowler Two","t:3":"Opp Bowler Three","t:4":"Opp Fielder Four","t:5":"Opp Bowler Five"}';
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  v_match  uuid := gen_random_uuid();
  v_imp    uuid := gen_random_uuid();
  v_code   text;
BEGIN
  -- 1. Nothing replaced changed shape.
  FOR r IN SELECT * FROM _db63_before LOOP
    IF r.obj LIKE 'view:%' THEN
      SELECT jsonb_build_object('options', to_jsonb(c.reloptions), 'acl', to_jsonb(c.relacl::text[]), 'owner', c.relowner::regrole::text,
               'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        INTO now_shape FROM pg_class c WHERE c.oid = to_regclass(substr(r.obj, 6));
    ELSE
      SELECT jsonb_build_object('result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
               'definer', p.prosecdef, 'volatility', p.provolatile, 'parallel', p.proparallel, 'strict', p.proisstrict,
               'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
               'language', p.prolang)
        INTO now_shape FROM pg_proc p WHERE p.oid = to_regprocedure(substr(r.obj, 10));
    END IF;
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/63: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _db63_before) <> 3 THEN RAISE EXCEPTION 'db/63: the shape snapshot is not the three objects'; END IF;

  -- 2. The arithmetic: the base card, and three of the PARITY list's breaks.
  SELECT string_agg(format('%s:%s', k, array_to_string(summary_reconciles(c, TYPED, 'home'), ',')), ' ' ORDER BY k) INTO got
    FROM (VALUES ('a', jsonb_set(CARD, '{unreconciled}', 'null')),
                 ('b', CARD),
                 ('c', jsonb_set(jsonb_set(CARD, '{unreconciled}', 'null'), '{wickets}', '5')),
                 ('d', jsonb_set(jsonb_set(CARD, '{unreconciled}', 'null'), '{batting,0,name}', '"A Name"')),
                 ('e', jsonb_set(jsonb_set(CARD, '{unreconciled}', 'null'), '{bowling,2,ref}', '"t:9"'))) AS x(k, c);
  IF got IS DISTINCT FROM 'a: b:unreconciled_wrong c:fall_of_wickets,wickets_mismatch d:card_shape e:ref_unknown' THEN
    RAISE EXCEPTION 'db/63: summary_reconciles() reads %', got;
  END IF;

  -- 3. A summarised innings, read by the two readers; the door; the public log.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db63-' || v_school, 'db/63 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db63-' || v_user || '@example.invalid', 'db/63 proof', 'scorer', v_school);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status)
    VALUES (v_match, v_school, '1XI', 'db/63 Opposition', now() - interval '3 days', 'cricket', 'T20', 20, 'complete');
    INSERT INTO scorebook_import (id, school_id, match_id, state, card, typed, created_by, submitted_by, submitted_at)
    VALUES (v_imp, v_school, v_match, 'submitted', jsonb_build_array(CARD), TYPED, v_user, v_user, now());

    -- Not by the application role's door, and not without the commit's word.
    BEGIN
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, payload)
      VALUES (v_match, v_school, 1, 1, 0, v_user, 'scorebook:' || v_imp, 'db63:forged', 1, now(), 'innings_summary',
              jsonb_build_object('card', CARD, 'source', jsonb_build_object('import', v_imp)));
      RAISE EXCEPTION 'db/63: a summary was written without the commit';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    PERFORM set_config('scrbrd.scorebook_commit', v_imp::text, true);
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, payload)
    VALUES (v_match, v_school, 1, 1, 0, v_user, 'scorebook:' || v_imp, 'db63:start', 1, now(), 'innings_start',
            jsonb_build_object('battingTeam', '1XI', 'bowlingTeam', 'Opposition', 'teamKey', '1XI', 'bowlingTeamKey', 'Opposition',
                               'overs', 20, 'source', jsonb_build_object('import', v_imp))),
           (v_match, v_school, 2, 1, 0, v_user, 'scorebook:' || v_imp, 'db63:summary', 2, now(), 'innings_summary',
            jsonb_build_object('card', CARD, 'typed', TYPED, 'source', jsonb_build_object('import', v_imp)));
    -- A summary that is a delivery is not a summary.
    BEGIN
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, ball_type, value, payload)
      VALUES (v_match, v_school, 3, 1, 1, v_user, 'scorebook:' || v_imp, 'db63:ball', 3, now(), 'innings_summary', 'run', 4,
              jsonb_build_object('card', CARD, 'source', jsonb_build_object('import', v_imp)));
      RAISE EXCEPTION 'db/63: a summary took a delivery''s columns';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    PERFORM set_config('scrbrd.scorebook_commit', '', true);

    SELECT format('live%s folded%s', (SELECT row(l.runs, l.wickets, l.legal_balls)::text FROM match_live_score l
                                        WHERE l.match_id = v_match AND l.innings = 0),
                  (SELECT row(f.runs, f.wickets, f.legal_balls)::text FROM innings_score_as_folded(v_match, 0::smallint) f))
      INTO got;
    IF got IS DISTINCT FROM 'live(127,4,120) folded(127,4,120)' THEN
      RAISE EXCEPTION 'db/63: a summarised innings reads %, the fold 127/4 in 120 balls', got;
    END IF;
    -- No delivery appears anywhere a delivery is read.
    IF EXISTS (SELECT 1 FROM bowler_over o WHERE o.match_id = v_match) THEN
      RAISE EXCEPTION 'db/63: a summarised innings has overs in bowler_over';
    END IF;

    -- The public log, served (as db/59 serves a published side): the card,
    -- and no typed name, no source, no reviewer's note.
    INSERT INTO fixture_publication (match_id, side, school_id, team_code, published, set_by)
    VALUES (v_match, 'home', v_school, '1XI', true, v_user);
    SELECT string_agg(l.kind || ':' || (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(l.detail) k), ' ' ORDER BY l.seq)
      INTO got FROM public_match_log(v_match, 0) l;
    IF got IS DISTINCT FROM 'innings_start:battingTeam,bowlingTeam,bowlingTeamKey,overs,teamKey innings_summary:card' THEN
      RAISE EXCEPTION 'db/63: the public log serves %', got;
    END IF;
    IF (SELECT l.detail::text FROM public_match_log(v_match, 0) l WHERE l.kind = 'innings_summary') ~ 'Opp |reviewer'
       OR (SELECT l.detail->'card'->'unreconciled' FROM public_match_log(v_match, 0) l WHERE l.kind = 'innings_summary')
          IS DISTINCT FROM '{"runs": 0}'::jsonb THEN
      RAISE EXCEPTION 'db/63: the public log carries a typed name or the note';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ063', MESSAGE = 'db/63: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ063' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) THEN RAISE EXCEPTION 'db/63: the proof left something behind'; END IF;
END $check$;

DROP TABLE _db63_before;

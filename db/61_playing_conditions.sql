-- ══════════════════════════════════════════════════════════════════
--  61 · Playing conditions per competition, phase 1: the shape (SCRBRD-114)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-114_playing_conditions.md
-- (Fable, 2026-09-28; D1–D12 decided by Kameel as recommended). This file is
-- its phase 1 (§9): the catalogue, the dated versions a competition
-- publishes, the fixture's competition, the frozen document a match is
-- folded under, and the one SQL reader of a play condition that exists
-- today — the free hit. Its policies are here, like db/50's and db/57's:
-- the generator would emit into db/01 and db/09, which are frozen.
--
-- A PLAYING CONDITION is a rule of a competition, not a Law: how many overs
-- an innings has, whether a no-ball earns a free hit, how many overs a boy
-- may bowl in an innings. The Laws live in the engine and are keyed by
-- Edition (db/54); conditions differ by league and season.
--
-- WHAT IS HERE.
--
--   playing_condition_key     the closed catalogue (design §1.2), migration-
--                             written and read by anyone signed in. Its key
--                             is CHECKed against a deny-list of prefixes
--                             (quota., transformation., race.): no condition
--                             may need a child's race to evaluate (A8).
--   condition_set             one dated version of one competition's
--                             conditions: draft → published (→ withdrawn).
--   condition_value           one figure in one version, with its source; a
--                             `confirmed` figure cites a document, a clause
--                             and a date (CHECK). Immutable once its version
--                             is published: a change is a new version.
--   match.competition_id      the competition a fixture is played under, or
--                             NULL (a friendly). Refused unless the home side
--                             (and a tenant away side) entered it.
--   match_condition_override  a departure for one fixture, with a reason,
--                             before play. Refused once the match is fixed.
--   match_conditions          THE FROZEN DOCUMENT: platform defaults ← the
--                             version in force on the match's start day ←
--                             the fixture ← its overrides, fixed on the
--                             match's first event inside the per-match lock
--                             (match_conditions_fix(), called by the write
--                             path and a release from quarantine), its play
--                             and sheet parts frozen forever.
--   match_playing_conditions()  what every reader asks: the frozen row, or
--                             the resolved preview (fixed = false), and
--                             whether a fold applies it (`applies`: fixed,
--                             or a match with no event yet).
--   match_free_hits_apply()   db/54's, now asking the frozen document first:
--                             play_free_hit(doc.play, format). Every reader
--                             of a wicket follows (ball_on_free_hit(),
--                             ball_wicket_stands(): the live score, the
--                             handover's count, every career figure).
--   competition.conditions.manage  the capability (ADDED_SINCE_01): held by
--                             competitionadmin (D8) and the owner's key.
--
-- CONDITIONS NEVER REFUSE A DELIVERY (D1). Nothing here is asked by the
-- ball_event policies or by lawsRefusal(). A bowler past a cap is recorded;
-- phase 2 writes the fact, the pad says the words now.
--
-- NO BACKFILL (D4). A match with events and no match_conditions row — every
-- match scored before this file — folds exactly as today: every reader here
-- falls back to the rule it had when the document is absent or lacks the key,
-- and match_conditions_fix() refuses to write a row for a match that already
-- has an event. A preview (a match not yet fixed) never folds a logged event:
-- match_free_hits_apply() reads the frozen row only.
--
-- DETERMINISM (design §3). The version in force is chosen by the match's
-- start day in SAST, never by when it is fixed; condition_set_publish()
-- refuses an effective date of today or earlier, and a published version may
-- be withdrawn only before it is in force. So the version in force on any day
-- is settled before that day begins, and the pad's morning preview and the
-- server's first-ball fix resolve the same version. The hash is md5(doc::text),
-- computed here alone (jsonb's key order is Postgres's).
--
-- WHO. Writes go through the SECURITY DEFINER functions below, each asking
-- competition.conditions.manage over the competition's organiser
-- (app_can(..., competition.school_id, ...): a competition with no organising
-- school answers only to a platform-wide holder, as db/09's competition
-- policies do). scrbrd_app holds SELECT on the tables and nothing else. A
-- support session may draft and enter but not publish or withdraw (§7.2). A
-- scorer holds no competition.read and reads no version; the pad's resume
-- credential reaches none of these tables (pad_scope_guard_install()).
-- match_conditions and its overrides are read wherever the fixture is
-- (fixture.read), as the design says.
--
-- search_path is pinned on every SECURITY DEFINER function (db/16). Every
-- function the application calls is granted to scrbrd_app, and taken back
-- from PUBLIC and a managed host's API roles. Idempotent where it can honestly
-- be (IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT); the proof at the end
-- builds its own rows and rolls them back.

-- ── 0 · The capability ─────────────────────────────────────────────
INSERT INTO capability (name) VALUES ('competition.conditions.manage') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('competitionadmin', 'competition.conditions.manage'),
  ('superadmin',       'competition.conditions.manage')
ON CONFLICT DO NOTHING;

-- The organiser of a competition, whoever asks: the policies below scope by
-- it, and must not depend on whether the reader may see the competition row.
CREATE OR REPLACE FUNCTION competition_organiser(p_competition uuid) RETURNS uuid AS $$
  SELECT c.school_id FROM competition c WHERE c.id = p_competition
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION competition_organiser(uuid) FROM PUBLIC;

-- May the caller manage this competition's conditions?
CREATE OR REPLACE FUNCTION competition_conditions_manager(p_competition uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM competition c WHERE c.id = p_competition)
     AND app_can('competition.conditions.manage', competition_organiser(p_competition), '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION competition_conditions_manager(uuid) FROM PUBLIC;
-- The read policies below ask both as the reader: one uuid and one yes or no
-- about a league, as competition_visible() (db/08) answers.
GRANT EXECUTE ON FUNCTION competition_organiser(uuid) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION competition_conditions_manager(uuid) TO scrbrd_app;

-- ── 1 · The catalogue ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playing_condition_key (
  key              text PRIMARY KEY
                   CHECK (key ~ '^[a-z_]+(\.[a-z_]+)+$' AND key !~ '^(quota|transformation|race)\.'),
  part             text NOT NULL CHECK (part IN ('play', 'table', 'sheet')),
  value_type       text NOT NULL CHECK (value_type IN ('bool', 'int', 'enum', 'date', 'list', 'object')),
  unit             text,
  enum_values      text[],
  by_age_band      boolean NOT NULL DEFAULT false,
  platform_default jsonb,
  readers          text[] NOT NULL CHECK (readers <@ ARRAY['pad', 'fold', 'laws', 'sql', 'table', 'selection']),
  clause_code      text REFERENCES rulebook_clause(code),
  sort_order       smallint NOT NULL DEFAULT 0,
  CONSTRAINT enum_keys_list_values CHECK (value_type NOT IN ('enum') OR enum_values IS NOT NULL)
);
COMMENT ON TABLE playing_condition_key IS
  'SCRBRD-114: the closed catalogue of playing-condition keys, mirrored by packages/scoring/src/conditions.mjs (CONDITION). Migration-written; db/99 §39 compares the two.';

-- The pilot catalogue and the reserved keys (readers '{}'), as CONDITION.
INSERT INTO playing_condition_key (key, part, value_type, unit, enum_values, by_age_band, platform_default, readers, sort_order) VALUES
  ('format.kind',                          'play',  'enum',   NULL,     '{limited,declaration,timed}', false, NULL, '{pad,fold,laws,sql}', 10),
  ('format.overs_per_innings',             'play',  'int',    'overs',  NULL, false, NULL, '{pad,fold,sql,table}', 20),
  ('format.innings_per_side',              'play',  'int',    NULL,     NULL, false, NULL, '{fold,pad}', 30),
  ('format.free_hit',                      'play',  'bool',   NULL,     NULL, false, NULL, '{pad,fold,laws,sql}', 40),
  ('bowling.max_overs_per_bowler_innings', 'play',  'int',    'overs',  NULL, false, NULL, '{pad,sql}', 50),
  ('bowling.limit',                        'play',  'object', 'overs',  NULL, true,  NULL, '{sql,pad}', 60),
  ('result.min_overs_per_side',            'play',  'int',    'overs',  NULL, false, NULL, '{pad,sql}', 70),
  ('result.tie_break',                     'play',  'enum',   NULL,     '{none,super_over}', false, '"none"', '{fold,table}', 80),
  ('points.win',                           'table', 'int',    'points', NULL, false, NULL, '{table}', 100),
  ('points.tie',                           'table', 'int',    'points', NULL, false, NULL, '{table}', 101),
  ('points.draw',                          'table', 'int',    'points', NULL, false, NULL, '{table}', 102),
  ('points.no_result',                     'table', 'int',    'points', NULL, false, NULL, '{table}', 103),
  ('points.loss',                          'table', 'int',    'points', NULL, false, NULL, '{table}', 104),
  ('points.abandoned',                     'table', 'int',    'points', NULL, false, NULL, '{table}', 105),
  ('bonus.kind',                           'table', 'enum',   NULL,     '{none,run_rate_ratio,batting_bowling}', false, '"none"', '{table}', 110),
  ('bonus.params',                         'table', 'object', NULL,     NULL, false, NULL, '{table}', 111),
  ('nrr.method',                           'table', 'enum',   NULL,     '{standard}', false, '"standard"', '{table}', 120),
  ('table.order',                          'table', 'list',   NULL,     '{points,wins,nrr,head_to_head,fewer_losses}', false, '["points", "wins", "nrr"]', '{table}', 130),
  ('over_rate.kind',                       'table', 'enum',   NULL,     '{none,points,runs}', false, '"none"', '{table}', 140),
  ('eligibility.age_on',                   'sheet', 'date',   NULL,     NULL, false, NULL, '{selection,sql}', 200),
  ('eligibility.max_age_open',             'sheet', 'int',    'years',  NULL, false, NULL, '{selection,sql}', 210),
  ('eligibility.bona_fide_scholar',        'sheet', 'bool',   NULL,     NULL, false, 'false', '{selection,pad}', 220),
  ('over.max_balls',                       'play',  'int',    'balls',  NULL, false, NULL, '{}', 900),
  ('over.free_hit_falls_away_on_last_ball', 'play', 'bool',   NULL,     NULL, false, NULL, '{}', 901),
  ('batting.retire_at_runs',               'play',  'int',    'runs',   NULL, false, NULL, '{}', 902),
  ('pitch.length_m',                       'play',  'int',    'm',      NULL, false, NULL, '{}', 903),
  ('ball.weight_g',                        'play',  'int',    'g',      NULL, false, NULL, '{}', 904),
  ('fielding.powerplay',                   'play',  'object', NULL,     NULL, false, NULL, '{}', 905),
  ('target.method',                        'play',  'enum',   NULL,     '{umpires_revision}', false, '"umpires_revision"', '{}', 906),
  ('bowling.rest_overs_between_spells',    'play',  'int',    'overs',  NULL, false, NULL, '{}', 907),
  ('eligibility.max_overage_players',      'sheet', 'int',    NULL,     NULL, false, NULL, '{}', 908)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE playing_condition_key ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS playing_condition_key_read ON playing_condition_key;
CREATE POLICY playing_condition_key_read ON playing_condition_key FOR SELECT USING (app_user_id() IS NOT NULL);
GRANT SELECT ON playing_condition_key TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON playing_condition_key FROM scrbrd_app;

-- ── 2 · Versions and their figures ─────────────────────────────────
CREATE TABLE IF NOT EXISTS condition_set (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  uuid NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  version         smallint NOT NULL CHECK (version >= 1),
  title           text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 120),
  effective_from  date NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
  supersedes      uuid REFERENCES condition_set(id),
  published_by    uuid REFERENCES app_user(id),
  published_at    timestamptz,
  withdrawn_by    uuid REFERENCES app_user(id),
  withdrawn_at    timestamptz,
  withdrawn_note  text,
  created_by      uuid NOT NULL REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, version),
  CONSTRAINT published_rows_are_dated CHECK (status = 'draft' OR published_at IS NOT NULL OR withdrawn_at IS NOT NULL),
  CONSTRAINT withdrawn_rows_say_why CHECK (status <> 'withdrawn'
    OR (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND length(btrim(coalesce(withdrawn_note, ''))) >= 10))
);
CREATE INDEX IF NOT EXISTS condition_set_in_force_idx ON condition_set (competition_id, status, effective_from DESC, version DESC);

CREATE TABLE IF NOT EXISTS condition_value (
  set_id          uuid NOT NULL REFERENCES condition_set(id) ON DELETE CASCADE,
  key             text NOT NULL REFERENCES playing_condition_key(key),
  age_band        text NOT NULL DEFAULT '',
  value           jsonb NOT NULL,
  status          text NOT NULL CHECK (status IN ('confirmed', 'unconfirmed')),
  source_document text,
  source_clause   text,
  source_date     date,
  source_note     text,
  entered_by      uuid NOT NULL REFERENCES app_user(id),
  entered_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, key, age_band),
  CONSTRAINT confirmed_rows_cite CHECK (status <> 'confirmed'
    OR (length(btrim(coalesce(source_document, ''))) > 0 AND length(btrim(coalesce(source_clause, ''))) > 0 AND source_date IS NOT NULL))
);

-- What is wrong with this value for this key and band, in words, or NULL.
-- The one rule, asked by condition_value's trigger and by an override's.
CREATE OR REPLACE FUNCTION playing_condition_value_problem(p_key text, p_age_band text, p_value jsonb) RETURNS text AS $$
DECLARE
  k playing_condition_key%ROWTYPE;
  t text := jsonb_typeof(p_value);
  x jsonb;
  s numeric; d numeric;
BEGIN
  SELECT * INTO k FROM playing_condition_key WHERE key = p_key;
  IF NOT FOUND THEN RETURN format('%s is not a playing condition', p_key); END IF;
  IF k.by_age_band THEN
    IF coalesce(p_age_band, '') = '' OR p_age_band = 'unknown'
       OR NOT EXISTS (SELECT 1 FROM bowling_directive b WHERE b.age_band = p_age_band) THEN
      RETURN format('%s is given per age band, and %s is not one a figure can be given for', p_key, coalesce(nullif(p_age_band, ''), 'no band'));
    END IF;
  ELSIF coalesce(p_age_band, '') <> '' THEN
    RETURN format('%s is not given per age band', p_key);
  END IF;
  IF p_value IS NULL THEN RETURN 'a value is required'; END IF;
  -- JSON null is "none stated" for a number or an object (no cap, no limit).
  IF t = 'null' THEN
    RETURN CASE WHEN k.value_type IN ('int', 'object') THEN NULL ELSE format('%s needs a value', p_key) END;
  END IF;
  CASE k.value_type
    WHEN 'bool' THEN
      IF t <> 'boolean' THEN RETURN format('%s is yes or no', p_key); END IF;
    WHEN 'int' THEN
      IF t <> 'number' OR (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric) THEN
        RETURN format('%s is a whole number', p_key); END IF;
      IF k.unit IN ('overs', 'years', 'balls', 'runs', 'm', 'g') AND (p_value #>> '{}')::numeric < 1 THEN
        RETURN format('%s is at least 1', p_key); END IF;
      IF abs((p_value #>> '{}')::numeric) > 1000 THEN RETURN format('%s is out of range', p_key); END IF;
    WHEN 'enum' THEN
      IF t <> 'string' OR NOT ((p_value #>> '{}') = ANY (k.enum_values)) THEN
        RETURN format('%s is one of %s', p_key, array_to_string(k.enum_values, ', ')); END IF;
    WHEN 'date' THEN
      IF t <> 'string' OR (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN format('%s is a date', p_key); END IF;
      BEGIN PERFORM (p_value #>> '{}')::date;
      EXCEPTION WHEN others THEN RETURN format('%s is a date', p_key); END;
    WHEN 'list' THEN
      IF t <> 'array' OR jsonb_array_length(p_value) = 0 THEN RETURN format('%s is a list', p_key); END IF;
      FOR x IN SELECT jsonb_array_elements(p_value) LOOP
        IF jsonb_typeof(x) <> 'string' OR (k.enum_values IS NOT NULL AND NOT ((x #>> '{}') = ANY (k.enum_values))) THEN
          RETURN format('%s lists only %s', p_key, array_to_string(k.enum_values, ', ')); END IF;
      END LOOP;
      IF (SELECT count(DISTINCT e) FROM jsonb_array_elements_text(p_value) e) <> jsonb_array_length(p_value) THEN
        RETURN format('%s names each once', p_key); END IF;
    WHEN 'object' THEN
      IF t <> 'object' THEN RETURN format('%s is a set of figures', p_key); END IF;
      IF p_key = 'bowling.limit' THEN
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) o WHERE o NOT IN ('spell', 'day')) THEN
          RETURN 'bowling.limit gives a spell and a day, in overs'; END IF;
        FOREACH x IN ARRAY ARRAY[p_value->'spell', p_value->'day'] LOOP
          IF x IS NOT NULL AND jsonb_typeof(x) <> 'null' AND (jsonb_typeof(x) <> 'number'
             OR (x #>> '{}')::numeric <> trunc((x #>> '{}')::numeric) OR (x #>> '{}')::numeric < 1) THEN
            RETURN 'bowling.limit gives whole numbers of overs, at least 1'; END IF;
        END LOOP;
        s := CASE WHEN jsonb_typeof(p_value->'spell') = 'number' THEN (p_value->>'spell')::numeric END;
        d := CASE WHEN jsonb_typeof(p_value->'day') = 'number' THEN (p_value->>'day')::numeric END;
        -- As bowling_ceiling_open: a day is never shorter than a spell.
        IF s IS NOT NULL AND d IS NOT NULL AND d < s THEN RETURN 'bowling.limit: a day is at least a spell'; END IF;
      END IF;
  END CASE;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;
GRANT EXECUTE ON FUNCTION playing_condition_value_problem(text, text, jsonb) TO scrbrd_app;

-- A version is its own audit: the figures of a published one never change,
-- and its identity never does. Stamps who wrote it from the session.
CREATE OR REPLACE FUNCTION condition_set_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'a version of a competition''s conditions begins as a draft' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := coalesce(app_user_id(), NEW.created_by);
    NEW.created_at := now();
    NEW.published_by := NULL; NEW.published_at := NULL;
    NEW.withdrawn_by := NULL; NEW.withdrawn_at := NULL; NEW.withdrawn_note := NULL;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.competition_id <> OLD.competition_id OR NEW.version <> OLD.version
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
     OR NEW.supersedes IS DISTINCT FROM OLD.supersedes THEN
    RAISE EXCEPTION 'a version''s identity does not change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'a withdrawn version does not change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'published' THEN
    IF NEW.status <> 'withdrawn' OR NEW.title <> OLD.title OR NEW.effective_from <> OLD.effective_from
       OR NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'a published version does not change: make a new version' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'draft'
     AND (NEW.published_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a draft is not dated as published or withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS condition_set_guard ON condition_set;
CREATE TRIGGER condition_set_guard BEFORE INSERT OR UPDATE ON condition_set
  FOR EACH ROW EXECUTE FUNCTION condition_set_guard();

CREATE OR REPLACE FUNCTION condition_value_guard() RETURNS trigger AS $$
DECLARE
  v_status text;
  v_problem text;
BEGIN
  -- A value of a version being deleted with it (its competition's cascade)
  -- finds no version, and goes with it.
  IF TG_OP = 'DELETE' THEN
    SELECT s.status INTO v_status FROM condition_set s WHERE s.id = OLD.set_id;
    IF v_status IS NOT NULL AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'a published version''s figures do not change: make a new version' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT s.status INTO v_status FROM condition_set s WHERE s.id = NEW.set_id;
  IF v_status IS DISTINCT FROM 'draft' OR (TG_OP = 'UPDATE' AND NEW.set_id <> OLD.set_id) THEN
    RAISE EXCEPTION 'a published version''s figures do not change: make a new version' USING ERRCODE = 'check_violation';
  END IF;
  v_problem := playing_condition_value_problem(NEW.key, NEW.age_band, NEW.value);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = 'check_violation';
  END IF;
  NEW.entered_by := coalesce(app_user_id(), NEW.entered_by);
  NEW.entered_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS condition_value_guard ON condition_value;
CREATE TRIGGER condition_value_guard BEFORE INSERT OR UPDATE OR DELETE ON condition_value
  FOR EACH ROW EXECUTE FUNCTION condition_value_guard();

-- The published version in force for a competition on a day: the greatest
-- effective_from on or before it, the higher version on a tie. Invoker's
-- rights: through the API it answers only what the caller may read.
CREATE OR REPLACE FUNCTION condition_set_for(p_competition uuid, p_day date) RETURNS uuid AS $$
  SELECT s.id FROM condition_set s
   WHERE s.competition_id = p_competition AND s.status = 'published' AND s.effective_from <= p_day
   ORDER BY s.effective_from DESC, s.version DESC
   LIMIT 1
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
GRANT EXECUTE ON FUNCTION condition_set_for(uuid, date) TO scrbrd_app;

ALTER TABLE condition_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE condition_value ENABLE ROW LEVEL SECURITY;
-- Published and withdrawn versions: whoever may reach the competition
-- (competition.read, through the organiser or an entrant). Drafts: its
-- conditions managers only.
DROP POLICY IF EXISTS condition_set_read ON condition_set;
CREATE POLICY condition_set_read ON condition_set FOR SELECT USING (
  (condition_set.status <> 'draft' AND competition_visible(condition_set.competition_id))
  OR competition_conditions_manager(condition_set.competition_id));
DROP POLICY IF EXISTS condition_value_read ON condition_value;
CREATE POLICY condition_value_read ON condition_value FOR SELECT USING (
  EXISTS (SELECT 1 FROM condition_set s WHERE s.id = condition_value.set_id));
GRANT SELECT ON condition_set, condition_value TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON condition_set, condition_value FROM scrbrd_app;

-- ── 3 · The fixture's competition ──────────────────────────────────
ALTER TABLE match ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES competition(id);
COMMENT ON COLUMN match.competition_id IS
  'SCRBRD-114: the competition this fixture is played under, or NULL (a friendly). Its sides must have entered it (match_competition_entered()); fixed once the match is scored.';
CREATE INDEX IF NOT EXISTS match_competition_idx ON match (competition_id, starts_at) WHERE competition_id IS NOT NULL;

-- One lock per match for its conditions: the fix, an override and a change
-- of competition take it, so none of them races another.
CREATE OR REPLACE FUNCTION match_conditions_lock(p_match uuid) RETURNS void AS $$
  SELECT pg_advisory_xact_lock(hashtext('scrbrd.match_conditions'), hashtext(p_match::text))
$$ LANGUAGE sql VOLATILE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_conditions_lock(uuid) FROM PUBLIC;

-- A fixture in a competition its sides have not entered is a data error the
-- ladder would act on: refused, not warned (design §2.2). The home side must
-- be an entrant; the away side too when it is a tenant. And once the match
-- has a frozen document or any event, the competition it was played under
-- does not change (design §3.4).
CREATE OR REPLACE FUNCTION match_competition_entered() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.competition_id IS DISTINCT FROM OLD.competition_id THEN
    PERFORM match_conditions_lock(NEW.id);
    IF EXISTS (SELECT 1 FROM match_conditions c WHERE c.match_id = NEW.id)
       OR EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = NEW.id) THEN
      RAISE EXCEPTION 'the competition a fixture is played under does not change once it has been scored'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Asked when the competition or a side is named, not on every touch of the
  -- row: a school that has left a league can still move its old fixture.
  IF NEW.competition_id IS NOT NULL AND (TG_OP = 'INSERT'
       OR NEW.competition_id IS DISTINCT FROM OLD.competition_id
       OR NEW.school_id IS DISTINCT FROM OLD.school_id OR NEW.team_code IS DISTINCT FROM OLD.team_code
       OR NEW.away_school_id IS DISTINCT FROM OLD.away_school_id OR NEW.away_team_code IS DISTINCT FROM OLD.away_team_code) THEN
    IF NOT EXISTS (SELECT 1 FROM competition_entrant e
                    WHERE e.competition_id = NEW.competition_id AND e.school_id = NEW.school_id
                      AND e.team_code IS NOT DISTINCT FROM NEW.team_code) THEN
      RAISE EXCEPTION 'the home side has not entered that competition: play it as a friendly, or enter the side first'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.away_school_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM competition_entrant e
          WHERE e.competition_id = NEW.competition_id AND e.school_id = NEW.away_school_id
            AND e.team_code IS NOT DISTINCT FROM NEW.away_team_code) THEN
      RAISE EXCEPTION 'the away side has not entered that competition: play it as a friendly, or enter the side first'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_competition_entered() FROM PUBLIC;

-- ── 4 · The frozen document ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_conditions (
  match_id         uuid PRIMARY KEY REFERENCES match(id) ON DELETE CASCADE,
  set_id           uuid REFERENCES condition_set(id),
  set_version      smallint,
  doc              jsonb NOT NULL CHECK (jsonb_typeof(doc) = 'object' AND doc ? 'play' AND doc ? 'table' AND doc ? 'sheet'),
  sources          jsonb NOT NULL,
  doc_hash         text NOT NULL,
  fixed_at         timestamptz NOT NULL DEFAULT now(),
  fixed_by         uuid REFERENCES app_user(id),
  table_refixed_at timestamptz,
  table_refixed_by uuid REFERENCES app_user(id),
  table_refixed_reason text,
  table_doc_before jsonb
);

-- The trigger the design names: play and sheet are frozen at fixing, for
-- ever, and the hash is always the document's. Only the table part may be
-- re-fixed (phase 3, match_conditions_refix_table(), with its audit).
CREATE OR REPLACE FUNCTION match_conditions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.doc_hash := md5(NEW.doc::text);
    NEW.fixed_at := now();
    RETURN NEW;
  END IF;
  IF NEW.match_id <> OLD.match_id OR NEW.set_id IS DISTINCT FROM OLD.set_id OR NEW.set_version IS DISTINCT FROM OLD.set_version
     OR NEW.doc->'play' IS DISTINCT FROM OLD.doc->'play' OR NEW.doc->'sheet' IS DISTINCT FROM OLD.doc->'sheet'
     OR NEW.doc->'v' IS DISTINCT FROM OLD.doc->'v'
     OR NEW.fixed_at <> OLD.fixed_at OR NEW.fixed_by IS DISTINCT FROM OLD.fixed_by THEN
    RAISE EXCEPTION 'a match''s play conditions are fixed on its first event and never change'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.doc_hash := md5(NEW.doc::text);
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS match_conditions_guard ON match_conditions;
CREATE TRIGGER match_conditions_guard BEFORE INSERT OR UPDATE ON match_conditions
  FOR EACH ROW EXECUTE FUNCTION match_conditions_guard();

DROP TRIGGER IF EXISTS match_competition_entered ON match;
CREATE TRIGGER match_competition_entered
  BEFORE INSERT OR UPDATE OF competition_id, school_id, team_code, away_school_id, away_team_code ON match
  FOR EACH ROW EXECUTE FUNCTION match_competition_entered();

-- ── 5 · A departure for one fixture, before play ──────────────────
CREATE TABLE IF NOT EXISTS match_condition_override (
  match_id  uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  key       text NOT NULL REFERENCES playing_condition_key(key),
  age_band  text NOT NULL DEFAULT '',
  value     jsonb NOT NULL,
  reason    text NOT NULL CHECK (length(btrim(reason)) >= 10),
  set_by    uuid NOT NULL REFERENCES app_user(id),
  set_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, key, age_band)
);

-- Refused once the match is fixed or scored (design §3.3): after the first
-- ball a change is the umpires' revision, in the log.
CREATE OR REPLACE FUNCTION match_condition_override_guard() RETURNS trigger AS $$
DECLARE
  v_match uuid;
  v_problem text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_match := OLD.match_id; ELSE v_match := NEW.match_id; END IF;
  PERFORM match_conditions_lock(v_match);
  IF EXISTS (SELECT 1 FROM match_conditions c WHERE c.match_id = v_match)
     OR EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = v_match) THEN
    -- A match being deleted takes its overrides with it.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM match m WHERE m.id = v_match) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'this match''s conditions are fixed: after the first ball a change is the umpires'' revision'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  v_problem := playing_condition_value_problem(NEW.key, NEW.age_band, NEW.value);
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = 'check_violation'; END IF;
  NEW.set_by := coalesce(app_user_id(), NEW.set_by);
  NEW.set_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS match_condition_override_guard ON match_condition_override;
CREATE TRIGGER match_condition_override_guard BEFORE INSERT OR UPDATE OR DELETE ON match_condition_override
  FOR EACH ROW EXECUTE FUNCTION match_condition_override_guard();

ALTER TABLE match_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_condition_override ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_conditions_read ON match_conditions;
CREATE POLICY match_conditions_read ON match_conditions FOR SELECT USING (
  app_can('fixture.read', match_school(match_conditions.match_id), match_team(match_conditions.match_id), NULL, match_conditions.match_id));
DROP POLICY IF EXISTS match_condition_override_read ON match_condition_override;
CREATE POLICY match_condition_override_read ON match_condition_override FOR SELECT USING (
  app_can('fixture.read', match_school(match_condition_override.match_id), match_team(match_condition_override.match_id), NULL, match_condition_override.match_id));
GRANT SELECT ON match_conditions, match_condition_override TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON match_conditions, match_condition_override FROM scrbrd_app;

-- ── 6 · The readers, as rules over a document ─────────────────────
-- freeHit() and oversPerInnings() in conditions.mjs, in SQL. Asked over a
-- document's play part: its answer when it states one, else today's rule.
-- db/99 §39 folds a fixed list through both and compares with the string
-- conditions.test.mjs pins (PARITY).
CREATE OR REPLACE FUNCTION play_free_hit(p_play jsonb, p_format text) RETURNS boolean AS $$
  SELECT CASE WHEN jsonb_typeof(p_play->'format.free_hit') = 'boolean' THEN (p_play->>'format.free_hit')::boolean
              ELSE free_hits_apply(p_format) END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;
GRANT EXECUTE ON FUNCTION play_free_hit(jsonb, text) TO scrbrd_app;

CREATE OR REPLACE FUNCTION play_overs(p_play jsonb, p_innings_overs integer) RETURNS integer AS $$
  SELECT CASE WHEN p_innings_overs IS NOT NULL THEN p_innings_overs
              WHEN jsonb_typeof(p_play->'format.overs_per_innings') = 'number'
                   AND (p_play->>'format.overs_per_innings')::numeric = trunc((p_play->>'format.overs_per_innings')::numeric)
                   AND (p_play->>'format.overs_per_innings')::numeric > 0
                THEN (p_play->>'format.overs_per_innings')::numeric::integer
              ELSE 20 END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;
GRANT EXECUTE ON FUNCTION play_overs(jsonb, integer) TO scrbrd_app;

-- ── 7 · Resolving a match's document ──────────────────────────────
-- platform defaults ← the version in force on the match's start day (SAST)
-- ← the fixture (format.kind, overs, innings per side; format.free_hit only
-- where the version states none) ← the fixture's overrides. No guard: the
-- callers below each ask their own capability first. Every catalogue key a
-- reader consults has a `sources` entry, stated or not, so a screen can say
-- which figures are confirmed.
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
        CASE WHEN btrim(coalesce(m.format, '')) = '' THEN NULL
             WHEN free_hits_apply(m.format) THEN '1'::jsonb ELSE '2'::jsonb END
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

-- The resolved document, written nowhere, for a caller who may read the
-- fixture (fixture.read, as match_fold_context() asks).
CREATE OR REPLACE FUNCTION match_conditions_resolve(p_match uuid)
RETURNS TABLE (set_id uuid, set_version smallint, doc jsonb, sources jsonb, doc_hash text) AS $$
  SELECT c.set_id, c.set_version, c.doc, c.sources, md5(c.doc::text)
    FROM match m, LATERAL match_conditions_compute(m.id) c
   WHERE m.id = p_match
     AND app_can('fixture.read', m.school_id, m.team_code, NULL, m.id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_conditions_resolve(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_conditions_resolve(uuid) TO scrbrd_app;

-- ── 8 · Fixing it: on the match's first event, inside the lock ────
-- Called by the live write path (services/api/write/events-api.mjs
-- appendEvents(), after scoring_lease_check() has taken the per-match lock;
-- the pad's resume credential comes through the same path) and by a release
-- from quarantine (before quarantine_resolve() writes the ball), BEFORE the
-- event is written. Takes the live path's lock itself, in the live path's
-- order (the session row, then this match's conditions lock), so a caller
-- that has not taken it is still safe. By whoever may write to the match: a
-- scorer (scoring.edit, the credential included) or a release's approver
-- (scoring.amend.approve).
--
--   fixed  true  → the row exists (written now, or already): doc_hash is it
--   fixed  false → nothing written: 'not_permitted', 'no_such_match', or
--                  'scored_before_conditions' — the match already has an
--                  event and so no document, for ever (D4)
CREATE OR REPLACE FUNCTION match_conditions_fix(p_match uuid)
RETURNS TABLE (fixed boolean, doc_hash text, reason text) AS $$
DECLARE
  m   match%ROWTYPE;
  c   record;
  v_hash text;
BEGIN
  SELECT * INTO m FROM match WHERE id = p_match;
  IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::text, 'no_such_match'; RETURN; END IF;
  IF NOT (app_can('scoring.edit', m.school_id, m.team_code, NULL, m.id)
          OR app_can('scoring.amend.approve', m.school_id, m.team_code, NULL, m.id)) THEN
    RETURN QUERY SELECT false, NULL::text, 'not_permitted'; RETURN;
  END IF;
  PERFORM 1 FROM scoring_session s WHERE s.match_id = p_match FOR UPDATE;
  PERFORM match_conditions_lock(p_match);
  SELECT mc.doc_hash INTO v_hash FROM match_conditions mc WHERE mc.match_id = p_match;
  IF FOUND THEN RETURN QUERY SELECT true, v_hash, 'already_fixed'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = p_match) THEN
    RETURN QUERY SELECT false, NULL::text, 'scored_before_conditions'; RETURN;
  END IF;
  SELECT * INTO c FROM match_conditions_compute(p_match);
  INSERT INTO match_conditions (match_id, set_id, set_version, doc, sources, doc_hash, fixed_by)
  VALUES (p_match, c.set_id, c.set_version, c.doc, c.sources, '', app_user_id())
  RETURNING match_conditions.doc_hash INTO v_hash;
  RETURN QUERY SELECT true, v_hash, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_conditions_fix(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_conditions_fix(uuid) TO scrbrd_app;

-- ── 9 · What every reader asks ────────────────────────────────────
-- The frozen row when there is one; else the resolved preview, fixed =
-- false. `applies`: whether a fold of this match's log reads it — the row,
-- or a preview for a match with no event yet (so the pad folds its first
-- balls as the fix will). A match with events and no row is the "no
-- document" case: applies = false, today's rules (D4). For a caller who may
-- read the fixture.
CREATE OR REPLACE FUNCTION match_playing_conditions(p_match uuid)
RETURNS TABLE (doc jsonb, sources jsonb, doc_hash text, fixed boolean, applies boolean,
               set_id uuid, set_version smallint, set_title text) AS $$
  SELECT coalesce(f.doc, r.doc), coalesce(f.sources, r.sources), coalesce(f.doc_hash, md5(r.doc::text)),
         f.match_id IS NOT NULL,
         f.match_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = m.id),
         CASE WHEN f.match_id IS NOT NULL THEN f.set_id ELSE r.set_id END,
         CASE WHEN f.match_id IS NOT NULL THEN f.set_version ELSE r.set_version END,
         (SELECT s.title FROM condition_set s WHERE s.id = CASE WHEN f.match_id IS NOT NULL THEN f.set_id ELSE r.set_id END)
    FROM match m
    LEFT JOIN match_conditions f ON f.match_id = m.id
    LEFT JOIN LATERAL (SELECT * FROM match_conditions_compute(m.id) WHERE f.match_id IS NULL) r ON true
   WHERE m.id = p_match
     AND app_can('fixture.read', m.school_id, m.team_code, NULL, m.id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_playing_conditions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_playing_conditions(uuid) TO scrbrd_app;

-- ── 10 · The free hit, from the frozen document ───────────────────
-- db/54's function, same signature, attributes, owner and grants (checked
-- at the end against a snapshot), asking the match's frozen play document
-- first: play_free_hit(doc.play, format). A match with no row — every match
-- before this file, and one not yet fixed — is free_hits_apply(format), as
-- db/54 had it; the preview never decides a logged wicket. ball_on_free_hit()
-- (db/54) asks this, so every reader of a wicket follows.
DROP TABLE IF EXISTS _db61_before;
CREATE TEMP TABLE _db61_before AS
SELECT jsonb_build_object(
         'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef, 'volatility', p.provolatile, 'parallel', p.proparallel,
         'strict', p.proisstrict, 'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]),
         'owner', p.proowner::regrole::text, 'language', p.prolang) AS shape
  FROM pg_proc p WHERE p.oid = 'match_free_hits_apply(uuid)'::regprocedure;

CREATE OR REPLACE FUNCTION match_free_hits_apply(p_match uuid)
RETURNS boolean AS $$
  SELECT coalesce((SELECT play_free_hit(c.doc->'play', m.format)
                     FROM match m LEFT JOIN match_conditions c ON c.match_id = m.id
                    WHERE m.id = p_match), true)
$$ LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION match_free_hits_apply(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_free_hits_apply(uuid) TO scrbrd_app;

-- ── 11 · Writing conditions: the organiser's functions ────────────
-- Each answers rather than raises (a refusal is a fact the screen shows):
-- (ok, reason, detail). None names a competition to a caller who may not
-- manage it: 'not_permitted' for both "no such" and "not yours".

-- A new draft version. Its number is the next for the competition.
CREATE OR REPLACE FUNCTION condition_set_draft(p_competition uuid, p_title text, p_effective_from date)
RETURNS TABLE (ok boolean, reason text, detail text, set_id uuid, version smallint) AS $$
DECLARE
  v_next smallint;
  v_id   uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT competition_conditions_manager(p_competition) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid, NULL::smallint; RETURN;
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 3 AND 120 THEN
    RETURN QUERY SELECT false, 'title_invalid', 'a title of 3 to 120 characters', NULL::uuid, NULL::smallint; RETURN;
  END IF;
  IF p_effective_from IS NULL THEN
    RETURN QUERY SELECT false, 'effective_from_required', NULL::text, NULL::uuid, NULL::smallint; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.condition_set'), hashtext(p_competition::text));
  SELECT coalesce(max(s.version), 0) + 1 INTO v_next FROM condition_set s WHERE s.competition_id = p_competition;
  INSERT INTO condition_set (competition_id, version, title, effective_from, created_by)
  VALUES (p_competition, v_next, btrim(p_title), p_effective_from, app_user_id())
  RETURNING id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id, v_next;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A change to a version is a new version: a draft copying every figure,
-- `supersedes` set. Dated no earlier than tomorrow (it can publish no
-- earlier), else the source's date.
CREATE OR REPLACE FUNCTION condition_set_new_version(p_set uuid)
RETURNS TABLE (ok boolean, reason text, detail text, set_id uuid, version smallint) AS $$
DECLARE
  s      condition_set%ROWTYPE;
  v_next smallint;
  v_id   uuid;
BEGIN
  SELECT * INTO s FROM condition_set x WHERE x.id = p_set;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT competition_conditions_manager(s.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid, NULL::smallint; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.condition_set'), hashtext(s.competition_id::text));
  SELECT coalesce(max(x.version), 0) + 1 INTO v_next FROM condition_set x WHERE x.competition_id = s.competition_id;
  INSERT INTO condition_set (competition_id, version, title, effective_from, supersedes, created_by)
  VALUES (s.competition_id, v_next, s.title, greatest(s.effective_from, sa_today() + 1), s.id, app_user_id())
  RETURNING id INTO v_id;
  INSERT INTO condition_value (set_id, key, age_band, value, status, source_document, source_clause, source_date, source_note, entered_by)
  SELECT v_id, cv.key, cv.age_band, cv.value, cv.status, cv.source_document, cv.source_clause, cv.source_date, cv.source_note, app_user_id()
    FROM condition_value cv WHERE cv.set_id = s.id;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id, v_next;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A draft's title and date.
CREATE OR REPLACE FUNCTION condition_set_amend(p_set uuid, p_title text, p_effective_from date)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE s condition_set%ROWTYPE;
BEGIN
  SELECT * INTO s FROM condition_set x WHERE x.id = p_set;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT competition_conditions_manager(s.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF s.status <> 'draft' THEN RETURN QUERY SELECT false, 'published_is_immutable', 'make a new version'; RETURN; END IF;
  IF p_title IS NOT NULL AND length(btrim(p_title)) NOT BETWEEN 3 AND 120 THEN
    RETURN QUERY SELECT false, 'title_invalid', 'a title of 3 to 120 characters'; RETURN;
  END IF;
  UPDATE condition_set SET title = coalesce(btrim(p_title), title), effective_from = coalesce(p_effective_from, effective_from)
   WHERE id = p_set;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- One figure in a draft, with its citation. `confirmed` needs a document, a
-- clause and a date; anything else is `unconfirmed` and says so everywhere
-- it is shown (design §8). Entering the same key and band again replaces it.
CREATE OR REPLACE FUNCTION condition_value_enter(
  p_set uuid, p_key text, p_age_band text, p_value jsonb, p_status text,
  p_document text DEFAULT NULL, p_clause text DEFAULT NULL, p_date date DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE
  s condition_set%ROWTYPE;
  v_problem text;
BEGIN
  SELECT * INTO s FROM condition_set x WHERE x.id = p_set;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT competition_conditions_manager(s.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF s.status <> 'draft' THEN RETURN QUERY SELECT false, 'published_is_immutable', 'make a new version'; RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM playing_condition_key k WHERE k.key = p_key) THEN
    RETURN QUERY SELECT false, 'no_such_key', p_key; RETURN;
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('confirmed', 'unconfirmed') THEN
    RETURN QUERY SELECT false, 'status_invalid', 'confirmed or unconfirmed'; RETURN;
  END IF;
  IF p_status = 'confirmed' AND (length(btrim(coalesce(p_document, ''))) = 0 OR length(btrim(coalesce(p_clause, ''))) = 0 OR p_date IS NULL) THEN
    RETURN QUERY SELECT false, 'citation_required', 'a confirmed figure names its document, clause and date'; RETURN;
  END IF;
  v_problem := playing_condition_value_problem(p_key, coalesce(p_age_band, ''), p_value);
  IF v_problem IS NOT NULL THEN RETURN QUERY SELECT false, 'value_invalid', v_problem; RETURN; END IF;
  INSERT INTO condition_value (set_id, key, age_band, value, status, source_document, source_clause, source_date, source_note, entered_by)
  VALUES (p_set, p_key, coalesce(p_age_band, ''), p_value, p_status,
          nullif(btrim(p_document), ''), nullif(btrim(p_clause), ''), p_date, nullif(btrim(p_note), ''), app_user_id())
  ON CONFLICT ON CONSTRAINT condition_value_pkey DO UPDATE
    SET value = EXCLUDED.value, status = EXCLUDED.status, source_document = EXCLUDED.source_document,
        source_clause = EXCLUDED.source_clause, source_date = EXCLUDED.source_date, source_note = EXCLUDED.source_note;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Take a figure out of a draft.
CREATE OR REPLACE FUNCTION condition_value_clear(p_set uuid, p_key text, p_age_band text DEFAULT '')
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE s condition_set%ROWTYPE;
BEGIN
  SELECT * INTO s FROM condition_set x WHERE x.id = p_set;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT competition_conditions_manager(s.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF s.status <> 'draft' THEN RETURN QUERY SELECT false, 'published_is_immutable', 'make a new version'; RETURN; END IF;
  DELETE FROM condition_value cv WHERE cv.set_id = p_set AND cv.key = p_key AND cv.age_band = coalesce(p_age_band, '');
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Publishing: for matches from `effective_from`, which is tomorrow (SAST) at
-- the earliest — never retroactive (D2) — and not behind the newest
-- published version's date (a later version cannot reach back under an
-- earlier one's). Never by a support session (§7.2): the person publishing
-- is the session's own user, acting as themself.
CREATE OR REPLACE FUNCTION condition_set_publish(p_set uuid)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE
  s condition_set%ROWTYPE;
  v_latest date;
BEGIN
  SELECT * INTO s FROM condition_set x WHERE x.id = p_set;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT competition_conditions_manager(s.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF app_support_access_id() IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session', 'a support session does not publish a competition''s conditions'; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.condition_set'), hashtext(s.competition_id::text));
  SELECT * INTO s FROM condition_set x WHERE x.id = p_set FOR UPDATE;
  IF s.status <> 'draft' THEN RETURN QUERY SELECT false, 'not_a_draft', s.status; RETURN; END IF;
  IF s.effective_from <= sa_today() THEN
    RETURN QUERY SELECT false, 'effective_from_not_future',
      format('a version takes effect from tomorrow (%s) at the earliest; it was dated %s', sa_today() + 1, s.effective_from); RETURN;
  END IF;
  SELECT max(x.effective_from) INTO v_latest FROM condition_set x
   WHERE x.competition_id = s.competition_id AND x.status = 'published';
  IF v_latest IS NOT NULL AND s.effective_from < v_latest THEN
    RETURN QUERY SELECT false, 'effective_from_behind_latest',
      format('the newest published version takes effect on %s; this one may not take effect before it', v_latest); RETURN;
  END IF;
  UPDATE condition_set SET status = 'published', published_by = app_user_id(), published_at = now() WHERE id = p_set;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Withdrawing: a draft abandoned, or a published version NOT YET IN FORCE
-- (effective_from after today). One in force is corrected by a new version,
-- never withdrawn: the version in force on a day is settled before it begins
-- (D2). With a note. Never by a support session.
CREATE OR REPLACE FUNCTION condition_set_withdraw(p_set uuid, p_note text)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE s condition_set%ROWTYPE;
BEGIN
  SELECT * INTO s FROM condition_set x WHERE x.id = p_set;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT competition_conditions_manager(s.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF app_support_access_id() IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session', 'a support session does not withdraw a competition''s conditions'; RETURN;
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 10 THEN
    RETURN QUERY SELECT false, 'note_required', 'say why, in ten characters or more'; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.condition_set'), hashtext(s.competition_id::text));
  SELECT * INTO s FROM condition_set x WHERE x.id = p_set FOR UPDATE;
  IF s.status = 'withdrawn' THEN RETURN QUERY SELECT false, 'already_withdrawn', NULL::text; RETURN; END IF;
  IF s.status = 'published' AND s.effective_from <= sa_today() THEN
    RETURN QUERY SELECT false, 'in_force', 'a version in force is corrected by a new version, not withdrawn'; RETURN;
  END IF;
  UPDATE condition_set SET status = 'withdrawn', withdrawn_by = app_user_id(), withdrawn_at = now(), withdrawn_note = btrim(p_note)
   WHERE id = p_set;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A departure for one fixture before play (D9), with a reason: the
-- competition's conditions manager, or for a friendly the home school's
-- fixture.update. p_value NULL takes the departure back out.
CREATE OR REPLACE FUNCTION match_condition_override_set(
  p_match uuid, p_key text, p_age_band text, p_value jsonb, p_reason text)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE
  m match%ROWTYPE;
  v_problem text;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT (
       CASE WHEN m.competition_id IS NOT NULL THEN competition_conditions_manager(m.competition_id)
            ELSE app_can('fixture.update', m.school_id, m.team_code, NULL, m.id) END) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  PERFORM match_conditions_lock(p_match);
  IF EXISTS (SELECT 1 FROM match_conditions c WHERE c.match_id = p_match)
     OR EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = p_match) THEN
    RETURN QUERY SELECT false, 'conditions_fixed', 'after the first ball a change is the umpires'' revision'; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM playing_condition_key k WHERE k.key = p_key) THEN
    RETURN QUERY SELECT false, 'no_such_key', p_key; RETURN;
  END IF;
  IF p_value IS NULL THEN
    DELETE FROM match_condition_override o WHERE o.match_id = p_match AND o.key = p_key AND o.age_band = coalesce(p_age_band, '');
    RETURN QUERY SELECT true, NULL::text, NULL::text; RETURN;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RETURN QUERY SELECT false, 'reason_required', 'say why, in ten characters or more'; RETURN;
  END IF;
  v_problem := playing_condition_value_problem(p_key, coalesce(p_age_band, ''), p_value);
  IF v_problem IS NOT NULL THEN RETURN QUERY SELECT false, 'value_invalid', v_problem; RETURN; END IF;
  INSERT INTO match_condition_override (match_id, key, age_band, value, reason, set_by)
  VALUES (p_match, p_key, coalesce(p_age_band, ''), p_value, btrim(p_reason), app_user_id())
  ON CONFLICT ON CONSTRAINT match_condition_override_pkey DO UPDATE SET value = EXCLUDED.value, reason = EXCLUDED.reason;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The signed-out page folds a served fixture's log in the browser (db/59,
-- SCRBRD-083) and must fold it as the server does: the frozen play part and
-- its hash, for a fixture db/59 serves (public_fixture_served()), and
-- nothing for any other. A league's rules; nothing about a person.
CREATE OR REPLACE FUNCTION public_match_conditions(p_match uuid)
RETURNS TABLE (play jsonb, doc_hash text) AS $$
  SELECT c.doc->'play', c.doc_hash
    FROM match_conditions c
   WHERE c.match_id = p_match
     AND public_fixture_served(p_match)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 12 · Grants, and the pad's guard ──────────────────────────────
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
      'condition_set_draft(uuid,text,date)', 'condition_set_new_version(uuid)', 'condition_set_amend(uuid,text,date)',
      'condition_value_enter(uuid,text,text,jsonb,text,text,text,date,text)', 'condition_value_clear(uuid,text,text)',
      'condition_set_publish(uuid)', 'condition_set_withdraw(uuid,text)',
      'match_condition_override_set(uuid,text,text,jsonb,text)',
      'match_conditions_resolve(uuid)', 'match_conditions_fix(uuid)', 'match_playing_conditions(uuid)', 'public_match_conditions(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  -- A managed host's API roles (Supabase grants new functions to them).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY[
          'condition_set_draft(uuid,text,date)', 'condition_set_new_version(uuid)', 'condition_set_amend(uuid,text,date)',
          'condition_value_enter(uuid,text,text,jsonb,text,text,text,date,text)', 'condition_value_clear(uuid,text,text)',
          'condition_set_publish(uuid)', 'condition_set_withdraw(uuid,text)',
          'match_condition_override_set(uuid,text,text,jsonb,text)',
          'match_conditions_resolve(uuid)', 'match_conditions_fix(uuid)', 'match_playing_conditions(uuid)', 'public_match_conditions(uuid)',
          'match_conditions_compute(uuid)', 'competition_organiser(uuid)', 'competition_conditions_manager(uuid)',
          'match_conditions_lock(uuid)', 'match_competition_entered()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;

-- Every new table behind RLS carries db/50's restrictive pad guard: a
-- resume credential reads none of them (db/99 §28 checks every table).
SELECT count(pad_scope_guard_install(t::regclass)) AS pad_guards
  FROM unnest(ARRAY['playing_condition_key', 'condition_set', 'condition_value',
                    'match_conditions', 'match_condition_override']) AS t;

-- ── 13 · The proof ────────────────────────────────────────────────
-- Built and rolled back. db/99 §39 is the fuller proof, with principals, on
-- every verify paste; this is what must hold the moment the file has run.
DO $check$
DECLARE
  now_shape jsonb;
  got text;
  want text;
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  m_t      uuid := gen_random_uuid();   -- a T20, fixed with free_hit = false
  m_d      uuid := gen_random_uuid();   -- a One-Day Declaration, fixed with free_hit = true
  m_o      uuid := gen_random_uuid();   -- a T20 with no row: db/54's answer
  p_x uuid := gen_random_uuid(); p_y uuid := gen_random_uuid(); p_a uuid := gen_random_uuid();
BEGIN
  -- 1. match_free_hits_apply(): the same shape as db/54 left it.
  SELECT jsonb_build_object(
           'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
           'definer', p.prosecdef, 'volatility', p.provolatile, 'parallel', p.proparallel,
           'strict', p.proisstrict, 'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]),
           'owner', p.proowner::regrole::text, 'language', p.prolang)
    INTO now_shape FROM pg_proc p WHERE p.oid = 'match_free_hits_apply(uuid)'::regprocedure;
  IF now_shape IS DISTINCT FROM (SELECT shape FROM _db61_before) THEN
    RAISE EXCEPTION 'db/61: match_free_hits_apply() changed shape: was %, now %', (SELECT shape FROM _db61_before), now_shape;
  END IF;
  IF pg_get_functiondef('ball_on_free_hit(uuid,smallint,integer)'::regprocedure) NOT LIKE '%match_free_hits_apply(p_match)%' THEN
    RAISE EXCEPTION 'db/61: ball_on_free_hit() no longer asks match_free_hits_apply()';
  END IF;

  -- 2. The catalogue: 31 keys, and the deny-list is in the schema.
  IF (SELECT count(*) FROM playing_condition_key) <> 31 THEN
    RAISE EXCEPTION 'db/61: the catalogue holds % keys, conditions.mjs 31', (SELECT count(*) FROM playing_condition_key);
  END IF;
  BEGIN
    INSERT INTO playing_condition_key (key, part, value_type, readers) VALUES ('quota.x', 'sheet', 'int', '{}');
    RAISE EXCEPTION 'db/61: the catalogue took quota.x';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 3. The readers over the parity list (conditions.test.mjs, PARITY).
  SELECT string_agg(format('%s:%s/%s', k, play_free_hit(d, f)::text, play_overs(d, o)), ' ' ORDER BY k) INTO got
    FROM (VALUES ('a', '{}'::jsonb, 'T20', 20), ('b', '{}', 'Two-Day', NULL), ('c', '{}', NULL, NULL),
                 ('d', '{"format.free_hit": false}', 'T20', 20), ('e', '{"format.free_hit": true}', 'One-Day Declaration', 100),
                 ('f', '{"format.free_hit": false}', NULL, NULL), ('g', '{"format.overs_per_innings": 25}', 'T20', NULL),
                 ('h', '{"format.overs_per_innings": 25}', 'T20', 20), ('i', '{"format.free_hit": "no"}', 'T20', 20),
                 ('j', '{"format.overs_per_innings": 0}', 'Two-Day', NULL),
                 ('k', '{"format.free_hit": true, "format.overs_per_innings": 50}', 'multi-day', NULL)) AS x(k, d, f, o);
  want := 'a:true/20 b:false/20 c:true/20 d:false/20 e:true/100 f:false/20 g:true/25 h:true/20 i:true/20 j:false/20 k:true/50';
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'db/61: the readers read %, conditions.mjs %', got, want; END IF;

  -- 4. The frozen document decides the free hit, both ways round; no row is
  --    db/54's answer. A no-ball, then the striker bowled.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db61-' || v_school, 'db/61 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db61-' || v_user || '@example.invalid', 'db/61 proof', 'coach', v_school);
    INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
      (p_x, v_school, '1XI', 'db/61 Opener', 1, 'batter', (current_date - interval '16 years')::date),
      (p_y, v_school, '1XI', 'db/61 Partner', 2, 'batter', (current_date - interval '16 years')::date),
      (p_a, v_school, '1XI', 'db/61 Seamer', 3, 'bowler', (current_date - interval '16 years')::date);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (m_t, v_school, '1XI', 'db/61 T20', now() - interval '3 days', 'cricket', 'T20', 20, 'complete'),
      (m_d, v_school, '1XI', 'db/61 declaration', now() - interval '2 days', 'cricket', 'One-Day Declaration', 100, 'complete'),
      (m_o, v_school, '1XI', 'db/61 no row', now() - interval '1 day', 'cricket', 'T20', 20, 'complete');
    INSERT INTO match_conditions (match_id, doc, sources, doc_hash) VALUES
      (m_t, '{"v": 1, "play": {"format.free_hit": false}, "table": {}, "sheet": {}}', '{}', ''),
      (m_d, '{"v": 1, "play": {"format.free_hit": true}, "table": {}, "sheet": {}}', '{}', '');
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value,
                            striker_id, non_striker_id, bowler_id, dismissal, payload)
    SELECT x.m, v_school, x.k, 1, 0, v_user, 'db61-proof', 'db61:' || x.m || ':' || x.k, x.k, now(), 'ball', x.bt, 0,
           p_x, p_y, p_a, x.dis, '{}'::jsonb
      FROM (VALUES (m_t, 1, 'Nb', NULL), (m_t, 2, 'W', 'bowled'), (m_d, 1, 'Nb', NULL), (m_d, 2, 'W', 'bowled'),
                   (m_o, 1, 'Nb', NULL), (m_o, 2, 'W', 'bowled')) AS x(m, k, bt, dis);
    SELECT string_agg(format('%s(%s,%s,%s,%s)', x.label,
             (SELECT l.wickets FROM match_live_score l WHERE l.match_id = x.m AND l.innings = 0),
             (SELECT f.wickets FROM innings_score_as_folded(x.m, 0::smallint) f),
             (SELECT sum(o.legal_balls) FROM bowler_over o WHERE o.match_id = x.m),
             ball_on_free_hit(x.m, 0::smallint, 2)::text), ' ' ORDER BY x.label)
      INTO got
      FROM (VALUES ('decl', m_d), ('none', m_o), ('t20', m_t)) AS x(label, m);
    -- The hash is the document's, in SQL.
    IF (SELECT doc_hash FROM match_conditions WHERE match_id = m_t) IS DISTINCT FROM
       md5('{"v": 1, "play": {"format.free_hit": false}, "table": {}, "sheet": {}}'::jsonb::text) THEN
      RAISE EXCEPTION 'db/61: the hash is not md5(doc::text)';
    END IF;
    -- Play is frozen.
    BEGIN
      UPDATE match_conditions SET doc = jsonb_set(doc, '{play,format.free_hit}', 'true') WHERE match_id = m_t;
      RAISE EXCEPTION 'db/61: a fixed play document changed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    RAISE EXCEPTION USING ERRCODE = 'ZZ061', MESSAGE = 'db/61: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ061' THEN NULL;
  END;
  want := 'decl(0,0,1,true) none(0,0,1,true) t20(1,1,1,false)';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'db/61: the readers read %, the fold reads % — the frozen document does not decide the free hit', got, want;
  END IF;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) OR EXISTS (SELECT 1 FROM match WHERE id IN (m_t, m_d, m_o)) THEN
    RAISE EXCEPTION 'db/61: the proof left something behind';
  END IF;
END $check$;

DROP TABLE _db61_before;

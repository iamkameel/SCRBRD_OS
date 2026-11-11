-- ══════════════════════════════════════════════════════════════════
--  151 · Pilot Match, phase 2: its own schema, and the write path
-- ══════════════════════════════════════════════════════════════════
--
-- docs/design/PILOT_MATCH_PHASE2.md, slices 1 and 2 (Kameel answered §13 on
-- 11 Nov 2026: all five as recommended). Counsel's §14 is NOT answered, so
-- everything here is BEHIND TWO SWITCHES, both OFF as this file leaves them:
--
--   pilot_sync          off: every pilot function refuses (`pilot_off`) and
--                       the phone offers phase 1 only. Nothing is sent.
--   pilot_names_upload  off: pilot_names_put() refuses, so the typed names
--                       stay on the phone and the server holds positions
--                       only (the counsel fallback, §14 item 1).
--
-- Only the owner's key changes either (UPDATE pilot.switch, by hand, as the
-- schema owner). The application role cannot reach the table.
--
-- NOT THE SCHOOL PILOT. db/98_seed_pilot.sql, db/132_pilot_audit_fixes.sql
-- and docs/pilot/ are the school pilot (the first schools' rollout). This
-- file is the Pilot Match: a match a platform-granted scorer starts from the
-- field with typed teams and typed names. The two share a word and nothing
-- else.
--
-- WHERE IT LIVES (§2). Schema `pilot`, and nowhere else until promotion (R1).
-- Its ball log has ball_event's columns, but it is another table, so no
-- stat, standing, record, milestone, honour, career or P2 read that reads
-- match, match_squad, player or ball_event can see it. The flag is the
-- location. Four things keep it there (§2.4), and each fails a migration or
-- a test, not a reviewer's memory:
--
--   1. No grant: scrbrd_app (and PUBLIC) have no USAGE on the schema and no
--      privilege on any table in it. A read as the app role errors.
--   2. No dependency: no view outside `pilot` may depend on a pilot table.
--   3. An allow-list of functions: only the functions named in
--      pilot_isolation_check() may mention a pilot table, and a narrower
--      list may mention the names table.
--   4. A test over the source: packages/policy/test/pilot-isolation.test.mjs
--      fails on a pilot table named in any db/*.sql but this file (and the
--      verifier).
--
-- pilot_isolation_check() runs at the end of this file and again in the
-- verifier (db/99 §129), which also proves each of the four bites.
--
-- WHAT NEVER REACHES THE SERVER (§2.3, §3.2): a typed name inside an event.
-- The phone maps every player to a slot id before anything leaves it
-- (apps/web/src/lib/pilotWire.js); pilot_event_refusal() below refuses any
-- event carrying a string equal to one of that match's typed names
-- (`name_in_event`), a player reference that is not one of its slots
-- (`unknown_slot`), and free text (`free_text`). The one column on the
-- server that holds a typed name is pilot.name.typed_name.
--
-- WHO (§4). Only the owner account, and only while it holds a pilot.scorer
-- grant. The functions ask `owner_user_id = app_user_id()` and never
-- app_can(), so no role assignment, superadmin included, reaches a pilot.
-- Any other caller is answered exactly as an unknown id is (`not_found`).
--
-- Nothing here dates anything by the database's day (db/128): every clock
-- is a timestamptz.

-- ── The schema ──────────────────────────────────────────────────────
CREATE SCHEMA pilot;
REVOKE ALL ON SCHEMA pilot FROM PUBLIC;
REVOKE ALL ON SCHEMA pilot FROM scrbrd_app;

-- The two switches (both off).
CREATE TABLE pilot.switch (
  key      text PRIMARY KEY CHECK (key IN ('pilot_sync', 'pilot_names_upload')),
  enabled  boolean NOT NULL DEFAULT false,
  set_by   text NOT NULL DEFAULT session_user,
  set_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pilot.switch (key, enabled) VALUES ('pilot_sync', false), ('pilot_names_upload', false);

-- Who may start one (Q2): granted by the owner's key and nothing else.
-- Signing in with Google gives nobody this row.
CREATE TABLE pilot.scorer (
  user_id     uuid PRIMARY KEY REFERENCES app_user(id),
  granted_by  text NOT NULL DEFAULT session_user,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);

-- The match. The id is minted on the phone, so a match started with no
-- signal is the same match when it reaches the server. `ended_at` is "the
-- end" (§1): the latest of its finish (or abandonment) and its last event,
-- or its creation while it has neither; the two purge dates run from it
-- (Q1: 30 days for the names, 12 months for the rest) and are kept by the
-- trigger below, never by a caller.
CREATE TABLE pilot.match (
  id                 uuid PRIMARY KEY,
  owner_user_id      uuid NOT NULL REFERENCES app_user(id),
  overs              smallint NOT NULL CHECK (overs BETWEEN 1 AND 50),
  format             text CHECK (format IS NULL OR format ~ '^[A-Za-z0-9_-]{1,20}$'),
  starts_at          timestamptz NOT NULL,
  venue_name         text CHECK (venue_name IS NULL OR char_length(venue_name) <= 80),
  toss_won_by        text CHECK (toss_won_by IN ('home', 'away')),
  toss_decision      text CHECK (toss_decision IN ('bat', 'bowl')),
  status             text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'finished', 'abandoned', 'promoted')),
  abandon_reason     text CHECK (abandon_reason IS NULL OR abandon_reason IN ('weather', 'light', 'ground', 'other_side', 'other')),
  finished_at        timestamptz,
  last_event_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz NOT NULL DEFAULT now(),
  names_purge_after  timestamptz NOT NULL DEFAULT now() + interval '30 days',
  purge_after        timestamptz NOT NULL DEFAULT now() + interval '12 months',
  -- §5 (slice 4). NULL until the scorer shares; a new random slug each time.
  share_slug         text UNIQUE,
  shared_at          timestamptz,
  -- §6 (R1): the one door into the real tables, which opens once.
  promoted_to        uuid UNIQUE REFERENCES match(id) ON DELETE SET NULL,
  promoted_at        timestamptz,
  -- Conditions only, the match_weather shape. Never a position: a position
  -- beside a live match and a list of children is a child's whereabouts.
  weather            jsonb CHECK (weather IS NULL OR (jsonb_typeof(weather) = 'object'
                       AND NOT (weather ?| ARRAY['lat', 'lon', 'latitude', 'longitude', 'position', 'coords', 'accuracy_m'])))
);
CREATE INDEX ON pilot.match (owner_user_id);

-- Team facts. The public page (slice 4) shows display_name.
CREATE TABLE pilot.side (
  match_id      uuid NOT NULL REFERENCES pilot.match(id) ON DELETE CASCADE,
  side          text NOT NULL CHECK (side IN ('home', 'away')),
  school        text NOT NULL CHECK (char_length(school) BETWEEN 1 AND 60),
  age_division  text CHECK (age_division IS NULL OR char_length(age_division) <= 10),
  team_class    text CHECK (team_class IS NULL OR char_length(team_class) <= 10),
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  PRIMARY KEY (match_id, side)
);

-- Positions. No name.
CREATE TABLE pilot.slot (
  id          uuid PRIMARY KEY,
  match_id    uuid NOT NULL REFERENCES pilot.match(id) ON DELETE CASCADE,
  side        text NOT NULL CHECK (side IN ('home', 'away')),
  list_no     smallint NOT NULL CHECK (list_no BETWEEN 1 AND 15),
  batting_no  smallint CHECK (batting_no IS NULL OR batting_no BETWEEN 1 AND 11),
  twelfth     boolean NOT NULL DEFAULT false,
  UNIQUE (match_id, side, list_no),
  UNIQUE (match_id, side, batting_no)
);
CREATE INDEX ON pilot.slot (match_id);

-- THE ONLY COLUMN ON THE SERVER THAT HOLDS A TYPED NAME. A correction
-- overwrites it and keeps no history: a history would be one more copy.
CREATE TABLE pilot.name (
  slot_id     uuid PRIMARY KEY REFERENCES pilot.slot(id) ON DELETE CASCADE,
  match_id    uuid NOT NULL REFERENCES pilot.match(id) ON DELETE CASCADE,
  typed_name  text NOT NULL CHECK (char_length(typed_name) BETWEEN 1 AND 60 AND typed_name !~ '[[:cntrl:]]'),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON pilot.name (match_id);

-- scoring_session's shape. The holder is always the owner account; only its
-- device changes (§3.3 step 5), and only by a person's take-over.
CREATE TABLE pilot.session (
  match_id       uuid PRIMARY KEY REFERENCES pilot.match(id) ON DELETE CASCADE,
  state          text NOT NULL DEFAULT 'active' CHECK (state = 'active'),
  epoch          integer NOT NULL DEFAULT 1,
  holder_device  text NOT NULL,
  lease_until    timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The log: ball_event's columns without school_id. Player references are
-- this match's slots. The CHECKs carry ball_event's own names, so the write
-- path's per-event refusal (events-api.mjs valueRefusal) reads them alike.
CREATE TABLE pilot.ball_event (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id          uuid NOT NULL REFERENCES pilot.match(id) ON DELETE CASCADE,
  seq               integer NOT NULL,
  epoch             integer NOT NULL,
  innings           smallint NOT NULL DEFAULT 0,
  scorer_user_id    uuid NOT NULL REFERENCES app_user(id),
  device_id         text NOT NULL,
  idempotency_key   text NOT NULL UNIQUE,
  client_seq        integer NOT NULL,
  client_ts         timestamptz NOT NULL,
  server_ts         timestamptz NOT NULL DEFAULT now(),
  kind              text NOT NULL,
  ball_type         text,
  value             smallint,
  shot              text,
  contact           text,
  trajectory        text,
  seg               smallint,
  zone              text,
  striker_id        uuid REFERENCES pilot.slot(id),
  non_striker_id    uuid REFERENCES pilot.slot(id),
  bowler_id         uuid REFERENCES pilot.slot(id),
  dismissed_id      uuid REFERENCES pilot.slot(id),
  dismissal         text,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovered         boolean NOT NULL DEFAULT false,
  theta             smallint,
  radius            numeric(3,2),
  placement_source  text,
  placement_null    text,
  close_position    text,
  capture_profile   text,
  fingerprint       text NOT NULL,
  UNIQUE (match_id, seq),
  CONSTRAINT ball_event_capture_profile CHECK (capture_profile IS NULL OR capture_profile IN ('full', 'standard', 'quick')),
  CONSTRAINT ball_event_contact CHECK (contact IS NULL OR contact IN ('middle', 'outside_edge', 'inside_edge', 'top_edge', 'beat', 'body')),
  CONSTRAINT ball_event_dismissal_known CHECK (dismissal IS NULL OR dismissal IN ('bowled', 'caught', 'lbw', 'run_out', 'stumped',
    'hit_wicket', 'handled_ball', 'obstructing_field', 'timed_out', 'retired_out', 'hit_twice')),
  CONSTRAINT ball_event_placement_null CHECK (placement_null IS NULL OR placement_null IN ('no_contact', 'not_applicable', 'not_required', 'skipped')),
  CONSTRAINT ball_event_placement_source CHECK (placement_source IS NULL OR placement_source IN ('point', 'sector')),
  CONSTRAINT ball_event_point_is_complete CHECK (placement_source IS DISTINCT FROM 'point' OR (theta IS NOT NULL AND radius IS NOT NULL)),
  CONSTRAINT ball_event_radius_range CHECK (radius IS NULL OR (radius >= 0 AND radius <= 1)),
  CONSTRAINT ball_event_theta_range CHECK (theta IS NULL OR (theta >= 0 AND theta <= 359)),
  CONSTRAINT ball_event_trajectory CHECK (trajectory IS NULL OR trajectory IN ('ground', 'aerial', 'controlled_aerial', 'miscued')),
  CONSTRAINT ball_event_trajectory_needs_contact CHECK (trajectory IS NULL OR contact NOT IN ('beat', 'body')),
  CONSTRAINT ball_event_zone_check CHECK (zone IS NULL OR zone IN ('inner', 'outer', 'boundary'))
);

-- Held for the scorer: a stale epoch, or a ball sent at a finished match.
-- ball_event_quarantine's shape; the body is the wire event, which
-- pilot_event_refusal() has already screened (so it holds no name either).
CREATE TABLE pilot.held (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id         uuid NOT NULL REFERENCES pilot.match(id) ON DELETE CASCADE,
  submitted_epoch  integer NOT NULL,
  current_epoch    integer,
  scorer_user_id   uuid NOT NULL REFERENCES app_user(id),
  device_id        text NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  body             jsonb NOT NULL,
  fingerprint      text NOT NULL,
  held_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution       text CHECK (resolution IS NULL OR resolution IN ('superseded', 'discarded', 'released'))
);

-- What happened, for the record. No foreign key on match_id: it outlives the
-- match (5 years, the access_log period). `detail` never holds a name.
CREATE TABLE pilot.audit (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id  uuid NOT NULL,
  event     text NOT NULL CHECK (event IN ('created', 'names_put', 'claim', 'takeover', 'shared', 'unshared', 'finished',
              'abandoned', 'names_purged', 'deleted', 'promotion_asked', 'promoted', 'platform_read')),
  actor_id  uuid,
  at        timestamptz NOT NULL DEFAULT now(),
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ON pilot.audit (match_id);

-- Ids and reasons only, read back after a restore (§7.5).
CREATE TABLE pilot.tombstone (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id  uuid NOT NULL,
  what      text NOT NULL CHECK (what IN ('names', 'match')),
  why       text NOT NULL CHECK (why IN ('scorer', 'retention', 'request', 'promotion', 'erasure', 'incident')),
  at        timestamptz NOT NULL DEFAULT now(),
  by        uuid
);

-- Belt to the schema's braces: nothing in `pilot` is anybody's but the
-- owner's, whatever default privileges a host adds later.
REVOKE ALL ON ALL TABLES IN SCHEMA pilot FROM PUBLIC, scrbrd_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pilot FROM PUBLIC, scrbrd_app;

-- On the real side, one column (§2.2): NULL for every match not promoted,
-- and UNIQUE, so a promoted Pilot Match counts exactly once (§6.2).
ALTER TABLE match ADD COLUMN promoted_from uuid UNIQUE;

-- ── Triggers ────────────────────────────────────────────────────────

-- The log is append-only, as ball_event is. The one exception is a DELETE
-- in a transaction that set pilot.deleting (only pilot_delete(), and later
-- the purge and promotion, set it).
CREATE OR REPLACE FUNCTION pilot_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('pilot.deleting', true), '') = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'the pilot log is append-only (%, seq %)', TG_OP, OLD.seq
    USING ERRCODE = 'insufficient_privilege';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER pilot_ball_event_append_only BEFORE UPDATE OR DELETE ON pilot.ball_event
  FOR EACH ROW EXECUTE FUNCTION pilot_log_guard();

-- Every row is fingerprinted by db/36's own function, over the row it would
-- be in ball_event, so a retry dedupes exactly as a fixture's does.
CREATE OR REPLACE FUNCTION pilot_ball_event_stamp() RETURNS trigger AS $$
BEGIN
  NEW.fingerprint := ball_event_fingerprint(jsonb_populate_record(NULL::ball_event, to_jsonb(NEW)));
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER zz_pilot_ball_event_fingerprint BEFORE INSERT ON pilot.ball_event
  FOR EACH ROW EXECUTE FUNCTION pilot_ball_event_stamp();
-- A delivery names its type, a wicket its method (db/89's door, reused).
CREATE TRIGGER pilot_ball_event_names_its_delivery BEFORE INSERT ON pilot.ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_names_its_delivery();

-- The end, and the two clocks that run from it (§1, §7.1). Kept here so no
-- caller can set them.
CREATE OR REPLACE FUNCTION pilot_match_clocks() RETURNS trigger AS $$
BEGIN
  NEW.ended_at := coalesce(greatest(NEW.finished_at, NEW.last_event_at), NEW.created_at);
  NEW.names_purge_after := NEW.ended_at + interval '30 days';
  NEW.purge_after := NEW.ended_at + interval '12 months';
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER pilot_match_clocks BEFORE INSERT OR UPDATE ON pilot.match
  FOR EACH ROW EXECUTE FUNCTION pilot_match_clocks();

-- ── Helpers (the owner's; not granted) ──────────────────────────────

-- The phone's normKey (lib/practice.js): NFKC, runs of space made one,
-- trimmed, lower case. How two names are told to be the same name.
CREATE OR REPLACE FUNCTION pilot_norm(t text) RETURNS text AS $$
  SELECT lower(btrim(regexp_replace(normalize(coalesce(t, ''), NFKC), '\s+', ' ', 'g')))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Is the switch on? Off when the row is missing.
CREATE OR REPLACE FUNCTION pilot_switch_on(p_key text) RETURNS boolean AS $$
  SELECT coalesce((SELECT s.enabled FROM pilot.switch s WHERE s.key = p_key), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- May the caller act as a Pilot Match scorer at all: signed in (never under
-- a pad resume credential: slice 3b), phase 2 switched on, and a live grant.
CREATE OR REPLACE FUNCTION pilot_may_score() RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND pilot_switch_on('pilot_sync')
     AND EXISTS (SELECT 1 FROM pilot.scorer s WHERE s.user_id = app_user_id() AND s.ended_at IS NULL)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The caller's own match, or NULL: an unknown id and another
-- owner's id are the same answer.
CREATE OR REPLACE FUNCTION pilot_own(p_id uuid) RETURNS uuid AS $$
  SELECT m.id FROM pilot.match m WHERE m.id = p_id AND m.owner_user_id = app_user_id() AND pilot_may_score()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION pilot_norm(text), pilot_switch_on(text), pilot_may_score(), pilot_own(uuid),
                       pilot_log_guard(), pilot_ball_event_stamp(), pilot_match_clocks() FROM PUBLIC;

-- ── What the phone asks first: may this account send one? ───────────
-- `sync` is phase 2's switch, `granted` this account's grant (only asked
-- once sync is on: with it off, nothing about grants is said), `names` the
-- counsel fallback. Asked signed in; signed out it is all false.
CREATE OR REPLACE FUNCTION pilot_status()
RETURNS TABLE (sync boolean, granted boolean, names boolean) AS $$
  SELECT pilot_switch_on('pilot_sync'),
         pilot_switch_on('pilot_sync') AND pilot_may_score(),
         pilot_switch_on('pilot_sync') AND pilot_switch_on('pilot_names_upload')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── pilot_create (§3.3 step 2) ──────────────────────────────────────
-- Idempotent for the same owner. For any other caller the same `not_found`
-- an unknown id would get. Refused without a grant (`not_granted`) or with
-- phase 2 off (`pilot_off`): the phone then keeps the match as a Practice
-- Match. Sides are {side, school, age_division, team_class, display_name};
-- slots are {id, side, list_no, batting_no, twelfth}: positions, no name.
CREATE OR REPLACE FUNCTION pilot_create(p_id uuid, p_sides jsonb, p_slots jsonb, p_overs integer, p_format text,
                                        p_starts_at timestamptz, p_toss jsonb, p_venue_name text, p_weather jsonb)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE v_owner uuid; v_w jsonb; s jsonb; n_home int; n_away int;
BEGIN
  IF app_user_id() IS NULL OR app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  IF NOT pilot_switch_on('pilot_sync') THEN RETURN QUERY SELECT false, 'pilot_off'; RETURN; END IF;
  IF NOT pilot_may_score() THEN RETURN QUERY SELECT false, 'not_granted'; RETURN; END IF;
  IF p_id IS NULL THEN RETURN QUERY SELECT false, 'bad_match'; RETURN; END IF;
  SELECT m.owner_user_id INTO v_owner FROM pilot.match m WHERE m.id = p_id;
  IF FOUND THEN
    IF v_owner = app_user_id() THEN RETURN QUERY SELECT true, NULL::text; ELSE RETURN QUERY SELECT false, 'not_found'; END IF;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pilot.slot sl WHERE sl.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(coalesce(p_slots, '[]')) x)) THEN
    RETURN QUERY SELECT false, 'bad_slots'; RETURN;
  END IF;
  IF jsonb_typeof(p_sides) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sides) <> 2
     OR (SELECT count(DISTINCT x->>'side') FROM jsonb_array_elements(p_sides) x WHERE x->>'side' IN ('home', 'away')) <> 2 THEN
    RETURN QUERY SELECT false, 'bad_sides'; RETURN;
  END IF;
  IF jsonb_typeof(p_slots) IS DISTINCT FROM 'array' THEN RETURN QUERY SELECT false, 'bad_slots'; RETURN; END IF;
  SELECT count(*) FILTER (WHERE x->>'side' = 'home'), count(*) FILTER (WHERE x->>'side' = 'away')
    INTO n_home, n_away FROM jsonb_array_elements(p_slots) x;
  IF n_home NOT BETWEEN 2 AND 15 OR n_away NOT BETWEEN 2 AND 15 OR n_home + n_away <> jsonb_array_length(p_slots) THEN
    RETURN QUERY SELECT false, 'bad_slots'; RETURN;
  END IF;
  -- The weather's conditions, and nothing else (no position, ever).
  IF jsonb_typeof(p_weather) = 'object' THEN
    SELECT jsonb_object_agg(k, p_weather -> k) INTO v_w
      FROM unnest(ARRAY['condition', 'temp_c', 'humidity_pct', 'wind_kph', 'wind_dir', 'rain_chance_pct', 'playable', 'observed_at']) k
     WHERE p_weather ? k AND jsonb_typeof(p_weather -> k) IN ('string', 'number', 'boolean');
  END IF;
  BEGIN
    INSERT INTO pilot.match (id, owner_user_id, overs, format, starts_at, venue_name, toss_won_by, toss_decision, weather)
    VALUES (p_id, app_user_id(), p_overs, nullif(btrim(p_format), ''), coalesce(p_starts_at, now()),
            nullif(btrim(left(coalesce(p_venue_name, ''), 80)), ''),
            p_toss ->> 'wonBy', p_toss ->> 'decision', v_w);
    FOR s IN SELECT * FROM jsonb_array_elements(p_sides) LOOP
      INSERT INTO pilot.side (match_id, side, school, age_division, team_class, display_name)
      VALUES (p_id, s->>'side', btrim(s->>'school'), nullif(s->>'age_division', ''), nullif(s->>'team_class', ''), btrim(s->>'display_name'));
    END LOOP;
    INSERT INTO pilot.slot (id, match_id, side, list_no, batting_no, twelfth)
    SELECT (x->>'id')::uuid, p_id, x->>'side', (x->>'list_no')::smallint, (x->>'batting_no')::smallint, coalesce((x->>'twelfth')::boolean, false)
      FROM jsonb_array_elements(p_slots) x;
  EXCEPTION WHEN check_violation OR not_null_violation OR unique_violation OR invalid_text_representation
              OR numeric_value_out_of_range OR invalid_parameter_value OR datatype_mismatch THEN
    RETURN QUERY SELECT false, 'bad_match'; RETURN;
  END;
  INSERT INTO pilot.audit (match_id, event, actor_id, detail)
  VALUES (p_id, 'created', app_user_id(), jsonb_build_object('slots', n_home + n_away, 'overs', p_overs));
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── The names (§3.3 step 3, §4.1) ───────────────────────────────────
-- Put once after pilot_create, and again only after an edit: each row sets
-- one slot's name, or with an empty name removes it. Refused while the
-- counsel fallback is on (`names_upload_off`) and after the names' date.
CREATE OR REPLACE FUNCTION pilot_names_put(p_id uuid, p_rows jsonb)
RETURNS TABLE (ok boolean, reason text, n integer) AS $$
DECLARE v_m pilot.match%ROWTYPE; r jsonb; v_n int := 0; v_name text;
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN QUERY SELECT false, 'not_found', 0; RETURN; END IF;
  IF NOT pilot_switch_on('pilot_names_upload') THEN RETURN QUERY SELECT false, 'names_upload_off', 0; RETURN; END IF;
  SELECT * INTO v_m FROM pilot.match m WHERE m.id = p_id FOR UPDATE;
  IF v_m.names_purge_after <= now() THEN RETURN QUERY SELECT false, 'names_expired', 0; RETURN; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RETURN QUERY SELECT false, 'bad_names', 0; RETURN; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF NOT EXISTS (SELECT 1 FROM pilot.slot s WHERE s.id::text = r->>'slot' AND s.match_id = p_id) THEN
      RETURN QUERY SELECT false, 'unknown_slot', 0; RETURN;
    END IF;
    v_name := btrim(regexp_replace(coalesce(r->>'name', ''), '\s+', ' ', 'g'));
    IF v_name = '' THEN
      DELETE FROM pilot.name nm WHERE nm.slot_id = (r->>'slot')::uuid;
    ELSIF char_length(v_name) > 60 OR v_name ~ '[[:cntrl:]]' THEN
      RETURN QUERY SELECT false, 'bad_names', 0; RETURN;
    ELSE
      INSERT INTO pilot.name (slot_id, match_id, typed_name) VALUES ((r->>'slot')::uuid, p_id, v_name)
      ON CONFLICT (slot_id) DO UPDATE SET typed_name = EXCLUDED.typed_name, updated_at = now();
    END IF;
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO pilot.audit (match_id, event, actor_id, detail) VALUES (p_id, 'names_put', app_user_id(), jsonb_build_object('rows', v_n));
  RETURN QUERY SELECT true, NULL::text, v_n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The owner's own names, until their date, whatever the purge has done.
CREATE OR REPLACE FUNCTION pilot_names_for_owner(p_id uuid)
RETURNS TABLE (slot_id uuid, typed_name text) AS $$
  SELECT nm.slot_id, nm.typed_name
    FROM pilot.name nm JOIN pilot.match m ON m.id = nm.match_id
   WHERE nm.match_id = p_id AND pilot_own(p_id) IS NOT NULL AND m.names_purge_after > now()
   ORDER BY nm.slot_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── What My Pilot Matches shows, and what a second phone opens from ──
-- One match's header: everything but the log and the names.
CREATE OR REPLACE FUNCTION pilot_header(p_id uuid) RETURNS jsonb AS $$
  SELECT jsonb_build_object(
           'id', m.id, 'status', m.status, 'overs', m.overs, 'format', m.format, 'startsAt', m.starts_at,
           'venueName', m.venue_name, 'toss', jsonb_build_object('wonBy', m.toss_won_by, 'decision', m.toss_decision),
           'endedAt', m.ended_at, 'namesPurgeAfter', m.names_purge_after, 'purgeAfter', m.purge_after,
           'lastEventAt', m.last_event_at,
           'sides', (SELECT coalesce(jsonb_agg(jsonb_build_object('side', s.side, 'school', s.school, 'age_division', s.age_division,
                                                                  'team_class', s.team_class, 'display_name', s.display_name) ORDER BY s.side DESC), '[]')
                       FROM pilot.side s WHERE s.match_id = m.id),
           'slots', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', sl.id, 'side', sl.side, 'list_no', sl.list_no,
                                                                  'batting_no', sl.batting_no, 'twelfth', sl.twelfth) ORDER BY sl.side DESC, sl.list_no), '[]')
                       FROM pilot.slot sl WHERE sl.match_id = m.id),
           'session', (SELECT jsonb_build_object('epoch', se.epoch, 'holderDevice', se.holder_device, 'leaseUntil', se.lease_until)
                         FROM pilot.session se WHERE se.match_id = m.id),
           'events', (SELECT count(*) FROM pilot.ball_event b WHERE b.match_id = m.id),
           'held', (SELECT count(*) FROM pilot.held h WHERE h.match_id = m.id AND h.resolved_at IS NULL))
    FROM pilot.match m
   WHERE m.id = p_id AND pilot_own(p_id) IS NOT NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The owner's matches, newest first.
CREATE OR REPLACE FUNCTION pilot_mine() RETURNS SETOF jsonb AS $$
  SELECT pilot_header(m.id) FROM pilot.match m
   WHERE m.owner_user_id = app_user_id() AND pilot_may_score() AND m.status <> 'promoted'
   ORDER BY coalesce(m.last_event_at, m.created_at) DESC
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── The session (§3.3 steps 4–5; the db/126 rules) ──────────────────
-- A claim: the first takes epoch 1; this device again takes the next
-- generation; another device's live lease is `lease_active`, and its lapsed
-- one `held_elsewhere`: a person's press, pilot_takeover(), takes it then.
-- A finished or abandoned match takes no claim. Never another account.
CREATE OR REPLACE FUNCTION pilot_claim(p_id uuid, p_device text)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s pilot.session%ROWTYPE; v_status text;
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN QUERY SELECT false, 'not_found', NULL::int; RETURN; END IF;
  IF p_device IS NULL OR btrim(p_device) = '' OR p_device IS DISTINCT FROM app_device_id() THEN
    RETURN QUERY SELECT false, CASE WHEN coalesce(btrim(p_device), '') = '' THEN 'no_device' ELSE 'device_mismatch' END, NULL::int; RETURN;
  END IF;
  SELECT m.status INTO v_status FROM pilot.match m WHERE m.id = p_id FOR UPDATE;
  SELECT * INTO s FROM pilot.session x WHERE x.match_id = p_id FOR UPDATE;
  IF v_status IN ('finished', 'promoted') THEN RETURN QUERY SELECT false, 'match_complete', s.epoch; RETURN; END IF;
  IF v_status = 'abandoned' THEN RETURN QUERY SELECT false, 'match_abandoned', s.epoch; RETURN; END IF;
  IF NOT FOUND THEN
    INSERT INTO pilot.session (match_id, epoch, holder_device, lease_until) VALUES (p_id, 1, p_device, now() + interval '90 seconds');
    INSERT INTO pilot.audit (match_id, event, actor_id, detail) VALUES (p_id, 'claim', app_user_id(), jsonb_build_object('epoch', 1));
    RETURN QUERY SELECT true, NULL::text, 1; RETURN;
  END IF;
  IF s.holder_device IS DISTINCT FROM p_device THEN
    RETURN QUERY SELECT false, CASE WHEN s.lease_until > now() THEN 'lease_active' ELSE 'held_elsewhere' END, s.epoch; RETURN;
  END IF;
  UPDATE pilot.session x SET epoch = s.epoch + 1, lease_until = now() + interval '90 seconds', updated_at = now() WHERE x.match_id = p_id;
  INSERT INTO pilot.audit (match_id, event, actor_id, detail) VALUES (p_id, 'claim', app_user_id(), jsonb_build_object('epoch', s.epoch + 1));
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A person's confirmed take-over (db/126): over another device's lapsed
-- lease, of the generation they were shown, with an audit row.
CREATE OR REPLACE FUNCTION pilot_takeover(p_id uuid, p_device text, p_epoch integer)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s pilot.session%ROWTYPE; v_seq int; v_at timestamptz;
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN QUERY SELECT false, 'not_found', NULL::int; RETURN; END IF;
  IF p_device IS NULL OR btrim(p_device) = '' OR p_device IS DISTINCT FROM app_device_id() THEN
    RETURN QUERY SELECT false, CASE WHEN coalesce(btrim(p_device), '') = '' THEN 'no_device' ELSE 'device_mismatch' END, NULL::int; RETURN;
  END IF;
  PERFORM 1 FROM pilot.match m WHERE m.id = p_id FOR UPDATE;
  SELECT * INTO s FROM pilot.session x WHERE x.match_id = p_id FOR UPDATE;
  IF NOT FOUND OR s.holder_device = p_device OR s.lease_until > now()
     OR EXISTS (SELECT 1 FROM pilot.match m WHERE m.id = p_id AND m.status <> 'live') THEN
    RETURN QUERY SELECT c.ok, c.reason, c.epoch FROM pilot_claim(p_id, p_device) c; RETURN;
  END IF;
  IF p_epoch IS DISTINCT FROM s.epoch THEN RETURN QUERY SELECT false, 'epoch_moved', s.epoch; RETURN; END IF;
  SELECT max(b.seq), max(b.server_ts) INTO v_seq, v_at FROM pilot.ball_event b WHERE b.match_id = p_id;
  UPDATE pilot.session x SET epoch = s.epoch + 1, holder_device = p_device, lease_until = now() + interval '90 seconds', updated_at = now()
   WHERE x.match_id = p_id;
  INSERT INTO pilot.audit (match_id, event, actor_id, detail)
  VALUES (p_id, 'takeover', app_user_id(), jsonb_build_object('epoch', s.epoch + 1, 'from_device', s.holder_device, 'to_device', p_device,
                                                               'lease_lapsed_at', s.lease_until, 'last_seq', v_seq, 'last_event_at', v_at));
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The heartbeat and the write path's gate: scoring_lease_check()'s shape.
-- Takes the per-match lock the write path relies on, extends only a live
-- lease this device holds at this epoch, and reports otherwise. A caller who
-- is not the owner is refused (42501), as a caller with no scoring
-- capability is refused a fixture's — and answered not_found by the API.
CREATE OR REPLACE FUNCTION pilot_lease_check(p_id uuid, p_device text, p_epoch integer)
RETURNS TABLE (found boolean, holds boolean, epoch integer, state text) AS $$
DECLARE s pilot.session%ROWTYPE; v_status text;
BEGIN
  IF pilot_own(p_id) IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT m.status INTO v_status FROM pilot.match m WHERE m.id = p_id FOR UPDATE;
  SELECT * INTO s FROM pilot.session x WHERE x.match_id = p_id FOR UPDATE;
  IF v_status IN ('finished', 'promoted') THEN RETURN QUERY SELECT (s.match_id IS NOT NULL), false, s.epoch, 'match_complete'::text; RETURN; END IF;
  IF v_status = 'abandoned' THEN RETURN QUERY SELECT (s.match_id IS NOT NULL), false, s.epoch, 'match_abandoned'::text; RETURN; END IF;
  IF s.match_id IS NULL THEN RETURN QUERY SELECT false, false, NULL::int, NULL::text; RETURN; END IF;
  IF s.epoch = p_epoch AND s.holder_device = p_device AND p_device = app_device_id() AND s.lease_until > now() THEN
    UPDATE pilot.session x SET lease_until = now() + interval '90 seconds', updated_at = now() WHERE x.match_id = p_id;
    RETURN QUERY SELECT true, true, s.epoch, s.state; RETURN;
  END IF;
  RETURN QUERY SELECT true, false, s.epoch, s.state;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── The screen every event passes (§3.4) ────────────────────────────
-- Before the event is judged, held or written, whoever holds the token:
--   name_in_event  any string in it (a value or a key) is, by pilot_norm(),
--                  one of this match's typed names: the second lock on the
--                  phone's pilotWire();
--   unknown_slot   a player field that is not one of this match's slots;
--   free_text      a string that is not a code or an id (a space, or longer
--                  than an event id), or a team field other than home/away.
-- NULL when it may go on. It returns a reason and never a name.
-- Every string and every key in a JSON value, however deep.
CREATE OR REPLACE FUNCTION pilot_strings(p jsonb) RETURNS SETOF text AS $$
  SELECT v #>> '{}' FROM jsonb_path_query(p, 'strict $.**') v WHERE jsonb_typeof(v) = 'string'
  UNION ALL
  SELECT k FROM jsonb_path_query(p, 'strict $.**') o
    CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(o) = 'object' THEN o ELSE '{}'::jsonb END) k
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
REVOKE ALL ON FUNCTION pilot_strings(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION pilot_event_refusal(p_id uuid, p_event jsonb) RETURNS text AS $$
DECLARE v_bad boolean;
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN 'not_found'; END IF;
  IF jsonb_typeof(p_event) IS DISTINCT FROM 'object' THEN RETURN 'free_text'; END IF;
  IF EXISTS (SELECT 1 FROM pilot_strings(p_event) x(s) JOIN pilot.name nm ON nm.match_id = p_id
              WHERE pilot_norm(x.s) = pilot_norm(nm.typed_name)) THEN
    RETURN 'name_in_event';
  END IF;
  IF EXISTS (SELECT 1 FROM pilot_strings(p_event) x(s) WHERE x.s !~ '^[A-Za-z0-9_.:+-]{1,160}$') THEN
    RETURN 'free_text';
  END IF;
  -- The four team fields are a side.
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['battingTeam', 'bowlingTeam', 'teamKey', 'bowlingTeamKey']) f
              WHERE p_event ? f AND jsonb_typeof(p_event -> f) <> 'null' AND (p_event ->> f) NOT IN ('home', 'away')) THEN
    RETURN 'free_text';
  END IF;
  -- Each player field, and each entry of the two squads, is a slot of this match.
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT p_event -> f AS v FROM unnest(ARRAY['striker', 'nonStriker', 'bowler', 'batter', 'dismissed', 'fielder', 'keeper', 'twelfthMan']) f
       WHERE p_event ? f
      UNION ALL
      SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_event -> 'squad') = 'array' THEN p_event -> 'squad' ELSE '[]' END) e
      UNION ALL
      SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_event -> 'bowlingSquad') = 'array' THEN p_event -> 'bowlingSquad' ELSE '[]' END) e
    ) p
    WHERE jsonb_typeof(p.v) <> 'null'
      AND (jsonb_typeof(p.v) <> 'string'
           OR NOT EXISTS (SELECT 1 FROM pilot.slot sl WHERE sl.match_id = p_id AND sl.id::text = p.v #>> '{}'))
  ) INTO v_bad;
  IF v_bad THEN RETURN 'unknown_slot'; END IF;
  IF (p_event ? 'squad' AND jsonb_typeof(p_event -> 'squad') NOT IN ('array', 'null'))
     OR (p_event ? 'bowlingSquad' AND jsonb_typeof(p_event -> 'bowlingSquad') NOT IN ('array', 'null')) THEN
    RETURN 'unknown_slot';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── The write path's store (services/api/write/log-store.mjs) ───────
-- The core in events-api.mjs (dedupe, the Laws over the fold, value
-- refusals, seq, held) is the fixture's, behind a LogStore; these are the
-- pilot store's four touches of the database. Each asks the owner again.

-- Is this key already written or held, and is it THIS event (db/36)?
CREATE OR REPLACE FUNCTION pilot_dedupe(p_id uuid, p_key text, p_cols jsonb)
RETURNS TABLE (seq integer, same boolean, held_same boolean) AS $$
  SELECT (SELECT b.seq FROM pilot.ball_event b WHERE b.idempotency_key = p_key AND b.match_id = p_id),
         (SELECT b.fingerprint = ball_event_fingerprint(jsonb_populate_record(NULL::ball_event, p_cols))
            FROM pilot.ball_event b WHERE b.idempotency_key = p_key AND b.match_id = p_id),
         (SELECT h.fingerprint = ball_event_fingerprint(jsonb_populate_record(NULL::ball_event, p_cols))
            FROM pilot.held h WHERE h.idempotency_key = p_key AND h.match_id = p_id)
   WHERE pilot_own(p_id) IS NOT NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Held: a stale epoch, a lapsed lease, or a finished match.
CREATE OR REPLACE FUNCTION pilot_hold(p_id uuid, p_epoch integer, p_current integer, p_key text, p_body jsonb, p_cols jsonb)
RETURNS boolean AS $$
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN false; END IF;
  INSERT INTO pilot.held (match_id, submitted_epoch, current_epoch, scorer_user_id, device_id, idempotency_key, body, fingerprint)
  VALUES (p_id, p_epoch, p_current, app_user_id(), coalesce(app_device_id(), ''), p_key, p_body,
          ball_event_fingerprint(jsonb_populate_record(NULL::ball_event, p_cols)))
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN true;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Written: at the next seq, only by the device holding the live lease at
-- this epoch (the fixture's RLS WITH CHECK, as a condition). The held copy
-- of the same key is closed as superseded (db/37's rule).
CREATE OR REPLACE FUNCTION pilot_insert(p_id uuid, p_epoch integer, p_key text, p_client_seq integer, p_client_ts timestamptz, p_cols jsonb)
RETURNS integer AS $$
DECLARE v_seq int;
BEGIN
  IF pilot_own(p_id) IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pilot.session s WHERE s.match_id = p_id AND s.epoch = p_epoch
                    AND s.holder_device = app_device_id() AND s.lease_until > now()) THEN
    RAISE EXCEPTION 'no live lease' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce(max(b.seq), 0) + 1 INTO v_seq FROM pilot.ball_event b WHERE b.match_id = p_id;
  INSERT INTO pilot.ball_event (match_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq, client_ts,
                                kind, ball_type, value, shot, contact, trajectory, seg, zone, striker_id, non_striker_id, bowler_id,
                                dismissed_id, dismissal, payload, theta, radius, placement_source, placement_null, close_position,
                                capture_profile)
  SELECT p_id, v_seq, p_epoch, r.innings, app_user_id(), app_device_id(), p_key, p_client_seq, p_client_ts,
         r.kind, r.ball_type, r.value, r.shot, r.contact, r.trajectory, r.seg, r.zone, r.striker_id, r.non_striker_id, r.bowler_id,
         r.dismissed_id, r.dismissal, r.payload, r.theta, r.radius, r.placement_source, r.placement_null, r.close_position,
         r.capture_profile
    FROM jsonb_populate_record(NULL::ball_event, p_cols) r;
  UPDATE pilot.held h SET resolved_at = now(), resolution = 'superseded' WHERE h.idempotency_key = p_key AND h.resolved_at IS NULL;
  UPDATE pilot.match m SET last_event_at = now() WHERE m.id = p_id;
  RETURN v_seq;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The nameless log after `since`, in EVENT_COLUMNS' shape (events-api.mjs).
CREATE OR REPLACE FUNCTION pilot_log(p_id uuid, p_since integer DEFAULT 0)
RETURNS TABLE (seq integer, epoch integer, innings smallint, kind text, ball_type text, value smallint, shot text, contact text,
               trajectory text, seg smallint, zone text, striker_id uuid, non_striker_id uuid, bowler_id uuid, dismissed_id uuid,
               dismissal text, idempotency_key text, scorer_user_id uuid, device_id text, client_ts timestamptz, server_ts timestamptz,
               payload jsonb, theta smallint, radius numeric, placement_source text, placement_null text, close_position text,
               capture_profile text, recovered boolean) AS $$
  SELECT b.seq, b.epoch, b.innings, b.kind, b.ball_type, b.value, b.shot, b.contact, b.trajectory, b.seg, b.zone,
         b.striker_id, b.non_striker_id, b.bowler_id, b.dismissed_id, b.dismissal, b.idempotency_key, b.scorer_user_id,
         b.device_id, b.client_ts, b.server_ts, b.payload, b.theta, b.radius, b.placement_source, b.placement_null,
         b.close_position, b.capture_profile, b.recovered
    FROM pilot.ball_event b
   WHERE b.match_id = p_id AND b.seq > coalesce(p_since, 0) AND pilot_own(p_id) IS NOT NULL
   ORDER BY b.seq
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- How to fold it: the match's start and format, as matchFoldContext() asks
-- of a fixture. A pilot has no playing conditions (§3.1).
CREATE OR REPLACE FUNCTION pilot_fold_context(p_id uuid)
RETURNS TABLE (starts_at timestamptz, format text) AS $$
  SELECT m.starts_at, m.format FROM pilot.match m WHERE m.id = p_id AND pilot_own(p_id) IS NOT NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- This device's held balls, not yet decided, for the pad's held count.
CREATE OR REPLACE FUNCTION pilot_held_here(p_id uuid) RETURNS integer AS $$
  SELECT count(*)::int FROM pilot.held h
   WHERE h.match_id = p_id AND h.resolved_at IS NULL AND h.device_id = app_device_id() AND pilot_own(p_id) IS NOT NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── Finished, abandoned (§7.3) ──────────────────────────────────────
-- The end is now; every ball sent after it is held. Codes only.
CREATE OR REPLACE FUNCTION pilot_finish(p_id uuid) RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN QUERY SELECT false, 'not_found'; RETURN; END IF;
  UPDATE pilot.match m SET status = 'finished', finished_at = now() WHERE m.id = p_id AND m.status = 'live';
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_live'; RETURN; END IF;
  INSERT INTO pilot.audit (match_id, event, actor_id) VALUES (p_id, 'finished', app_user_id());
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION pilot_abandon(p_id uuid, p_code text) RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN QUERY SELECT false, 'not_found'; RETURN; END IF;
  IF p_code IS NULL OR p_code NOT IN ('weather', 'light', 'ground', 'other_side', 'other') THEN
    RETURN QUERY SELECT false, 'bad_reason'; RETURN;
  END IF;
  UPDATE pilot.match m SET status = 'abandoned', abandon_reason = p_code, finished_at = now() WHERE m.id = p_id AND m.status = 'live';
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_live'; RETURN; END IF;
  INSERT INTO pilot.audit (match_id, event, actor_id, detail) VALUES (p_id, 'abandoned', app_user_id(), jsonb_build_object('reason', p_code));
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── Delete (§7.2) ───────────────────────────────────────────────────
-- Everything of the match, with a tombstone for its names and for itself
-- and an audit row (which outlives it). The off-database deletion log of
-- §7.5 is slice 5's.
CREATE OR REPLACE FUNCTION pilot_delete_one(p_id uuid, p_why text) RETURNS boolean AS $$
DECLARE v_had_names boolean; v_n int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pilot.name nm WHERE nm.match_id = p_id) INTO v_had_names;
  PERFORM set_config('pilot.deleting', 'on', true);
  DELETE FROM pilot.match m WHERE m.id = p_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('pilot.deleting', '', true);
  IF v_n = 0 THEN RETURN false; END IF;
  IF v_had_names THEN INSERT INTO pilot.tombstone (match_id, what, why, by) VALUES (p_id, 'names', p_why, app_user_id()); END IF;
  INSERT INTO pilot.tombstone (match_id, what, why, by) VALUES (p_id, 'match', p_why, app_user_id());
  INSERT INTO pilot.audit (match_id, event, actor_id, detail) VALUES (p_id, 'deleted', app_user_id(), jsonb_build_object('why', p_why));
  RETURN true;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pilot_delete_one(uuid, text) FROM PUBLIC;

-- The scorer's delete. Allowed without the grant and with phase 2 off: a
-- scorer whose grant ended can still take his matches off the server.
CREATE OR REPLACE FUNCTION pilot_delete(p_id uuid) RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF app_user_id() IS NULL OR app_pad_scoped()
     OR NOT EXISTS (SELECT 1 FROM pilot.match m WHERE m.id = p_id AND m.owner_user_id = app_user_id()) THEN
    RETURN QUERY SELECT false, 'not_found'; RETURN;
  END IF;
  PERFORM pilot_delete_one(p_id, 'scorer');
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Every match of one account: the scorer's own "Delete everything". The
-- erasure path (account_erase(), why = 'erasure') is slice 5's, under the
-- owner's key, through pilot_delete_one().
CREATE OR REPLACE FUNCTION pilot_delete_all_for(p_user uuid) RETURNS integer AS $$
DECLARE r record; v_n int := 0;
BEGIN
  IF p_user IS NULL OR app_pad_scoped() OR app_user_id() IS DISTINCT FROM p_user THEN RETURN 0; END IF;
  FOR r IN SELECT m.id FROM pilot.match m WHERE m.owner_user_id = p_user LOOP
    IF pilot_delete_one(r.id, 'scorer') THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── The isolation check (§2.4 items 1–3) ────────────────────────────
-- Raises, naming what broke. Run at the end of this file and by db/99 §129.
-- A later migration that adds a function which must name a pilot table
-- redefines this function with the name added: the friction is the point.
-- (This body names the schema only as a string, so it is on no list.)
CREATE OR REPLACE FUNCTION pilot_isolation_check() RETURNS void AS $$
DECLARE v text;
  -- May name a pilot table at all.
  v_wide text[] := ARRAY['pilot_switch_on', 'pilot_may_score', 'pilot_own', 'pilot_status', 'pilot_create', 'pilot_names_put',
                         'pilot_names_for_owner', 'pilot_header', 'pilot_mine', 'pilot_claim', 'pilot_takeover', 'pilot_lease_check',
                         'pilot_event_refusal', 'pilot_dedupe', 'pilot_hold', 'pilot_insert', 'pilot_log', 'pilot_fold_context',
                         'pilot_held_here', 'pilot_finish', 'pilot_abandon', 'pilot_delete_one', 'pilot_delete', 'pilot_delete_all_for',
                         'pilot_log_guard'];
  -- May name the names table: the two that put and read the owner's names,
  -- and the screen, which compares and answers only a reason.
  v_names text[] := ARRAY['pilot_names_put', 'pilot_names_for_owner', 'pilot_event_refusal', 'pilot_delete_one'];
BEGIN
  -- 1. No grant.
  IF has_schema_privilege('scrbrd_app', 'pilot', 'USAGE') OR has_schema_privilege('public', 'pilot', 'USAGE') THEN
    RAISE EXCEPTION 'pilot isolation (grant): the application role or PUBLIC may use schema pilot';
  END IF;
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'pilot' AND c.relacl IS NOT NULL
     AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a
                  WHERE a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'scrbrd_app'));
  IF v IS NOT NULL THEN RAISE EXCEPTION 'pilot isolation (grant): PUBLIC or the application role holds a privilege on %', v; END IF;

  -- 2. No dependency: a view outside the schema built on a table in it.
  SELECT string_agg(DISTINCT vc.oid::regclass::text, ', ') INTO v
    FROM pg_depend d
    JOIN pg_rewrite r ON d.classid = 'pg_rewrite'::regclass AND r.oid = d.objid
    JOIN pg_class vc ON vc.oid = r.ev_class
    JOIN pg_namespace vn ON vn.oid = vc.relnamespace
    JOIN pg_class t ON d.refclassid = 'pg_class'::regclass AND t.oid = d.refobjid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
   WHERE tn.nspname = 'pilot' AND vn.nspname <> 'pilot';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'pilot isolation (dependency): % depends on a pilot table', v; END IF;

  -- 3. The allow-lists. The verifier's own helpers (named _…) are left out:
  -- they live inside its transaction and roll back with it.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname !~ '^_' AND p.prosrc ~ '\mpilot\.[a-z_]'
     AND NOT (p.proname = ANY (v_wide));
  IF v IS NOT NULL THEN RAISE EXCEPTION 'pilot isolation (functions): % names a pilot table and is not on the list', v; END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname !~ '^_' AND p.prosrc ~ '\mpilot\.name\M'
     AND (NOT (p.proname = ANY (v_names)) OR p.proname LIKE 'public\_%');
  IF v IS NOT NULL THEN RAISE EXCEPTION 'pilot isolation (names): % names the typed names and may not', v; END IF;
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pilot_isolation_check() FROM PUBLIC;

-- ── Grants ──────────────────────────────────────────────────────────
-- The doors the API opens, to the application role alone.
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'pilot_status()', 'pilot_create(uuid,jsonb,jsonb,integer,text,timestamptz,jsonb,text,jsonb)', 'pilot_names_put(uuid,jsonb)',
    'pilot_names_for_owner(uuid)', 'pilot_header(uuid)', 'pilot_mine()', 'pilot_claim(uuid,text)', 'pilot_takeover(uuid,text,integer)',
    'pilot_lease_check(uuid,text,integer)', 'pilot_event_refusal(uuid,jsonb)', 'pilot_dedupe(uuid,text,jsonb)',
    'pilot_hold(uuid,integer,integer,text,jsonb,jsonb)', 'pilot_insert(uuid,integer,text,integer,timestamptz,jsonb)',
    'pilot_log(uuid,integer)', 'pilot_fold_context(uuid)', 'pilot_held_here(uuid)', 'pilot_finish(uuid)', 'pilot_abandon(uuid,text)',
    'pilot_delete(uuid)', 'pilot_delete_all_for(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
END $grants$;

SELECT pilot_isolation_check();

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
-- schema owner). No other role can reach the table.
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
--   1. No grant: no role but the owner — not scrbrd_app, not PUBLIC, and not
--      a managed host's anon, authenticated or service_role — holds any
--      privilege on the schema, a table, a sequence or a default ACL in it.
--   2. No dependency: no view, policy, key, trigger or default outside
--      `pilot` may depend on an object in it.
--   3. An allow-list of functions, by signature: every function that names
--      a pilot table (in any case, quoted or not, spaced or not), sets a
--      search_path holding pilot, runs dynamic SQL beside a quoted 'pilot',
--      or is called pilot_*, is on pilot_isolation_check()'s list, with its
--      SECURITY DEFINER-ness, its pinned path and its exact grants. A
--      narrower list may name the names table.
--   4. A test over the source: packages/policy/test/pilot-isolation.test.mjs
--      fails on a pilot table named in any migration or server module but
--      this file and the verifier.
--
-- pilot_isolation_check() runs at the end of this file and again in the
-- verifier (db/99 §129), which also proves each of the four bites.
--
-- WHAT NEVER REACHES THE SERVER (§2.3, §3.2): a typed name inside an event.
-- The phone maps every player to a slot id before anything leaves it
-- (apps/web/src/lib/pilotWire.js). Here pilot_screen() checks every event
-- again, INSIDE the functions that write (pilot_insert, pilot_hold), so no
-- route can step round it: a string equal to one of the match's typed names
-- (`name_in_event`), a player who is not one of its slots (`unknown_slot`),
-- and anything outside the per-kind allow-list of keys and values
-- (`free_text`). The one column on the server that holds a typed name is
-- pilot.name.typed_name. The venue's name is never kept, and a side's
-- school and display name are held on the phone (placeholders sent) unless
-- the names may go (S4 of the review).
--
-- WHO (§4). Only the owner account, and only while it holds a pilot.scorer
-- grant. The functions ask `owner_user_id = app_user_id()` and never
-- app_can(), so no role assignment, superadmin included, reaches a pilot.
-- Any other caller is answered exactly as an unknown id is (`not_found`).
--
-- THE CLOCKS (§1, §7) run from the match's own last ball (its client time,
-- bounded by the server's receipt), and once a date has passed it never
-- moves again: a late event cannot bring expired names back.
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
-- end" (§1): the latest of its finish (or abandonment) and its last ball,
-- or its start while it has neither; the two purge dates run from it (Q1:
-- 30 days for the names, 12 months for the rest) and are kept by the
-- trigger below, never by a caller.
CREATE TABLE pilot.match (
  id                 uuid PRIMARY KEY,
  owner_user_id      uuid NOT NULL REFERENCES app_user(id),
  overs              smallint NOT NULL CHECK (overs BETWEEN 1 AND 50),
  format             text CHECK (format IS NULL OR format ~ '^[A-Za-z0-9_-]{1,20}$'),
  starts_at          timestamptz NOT NULL,
  -- Never kept (S4): the phone keeps the ground's name. A later decision
  -- that the server may hold it lifts this CHECK in its own migration.
  venue_name         text CHECK (venue_name IS NULL),
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

-- Team facts. Unless the names may go, the phone sends placeholders here
-- ("Home", "Home U13B"): a school typed as a child's name never arrives.
CREATE TABLE pilot.side (
  match_id      uuid NOT NULL REFERENCES pilot.match(id) ON DELETE CASCADE,
  side          text NOT NULL CHECK (side IN ('home', 'away')),
  school        text NOT NULL CHECK (char_length(school) BETWEEN 1 AND 60 AND school !~ '[[:cntrl:]]'),
  age_division  text CHECK (age_division IS NULL OR age_division ~ '^[A-Za-z0-9 ]{1,10}$'),
  team_class    text CHECK (team_class IS NULL OR team_class ~ '^[A-Za-z0-9 ]{1,10}$'),
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100 AND display_name !~ '[[:cntrl:]]'),
  PRIMARY KEY (match_id, side)
);

-- Positions. No name. A slot is its match's: every reference to one names
-- the match too, so a slot of another match is refused by the keys.
CREATE TABLE pilot.slot (
  match_id    uuid NOT NULL REFERENCES pilot.match(id) ON DELETE CASCADE,
  id          uuid NOT NULL,
  side        text NOT NULL CHECK (side IN ('home', 'away')),
  list_no     smallint NOT NULL CHECK (list_no BETWEEN 1 AND 15),
  batting_no  smallint CHECK (batting_no IS NULL OR batting_no BETWEEN 1 AND 11),
  twelfth     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (match_id, id),
  UNIQUE (match_id, side, list_no),
  UNIQUE (match_id, side, batting_no)
);

-- THE ONLY COLUMN ON THE SERVER THAT HOLDS A TYPED NAME. A correction
-- overwrites it and keeps no history: a history would be one more copy.
CREATE TABLE pilot.name (
  match_id    uuid NOT NULL,
  slot_id     uuid NOT NULL,
  typed_name  text NOT NULL CHECK (char_length(typed_name) BETWEEN 1 AND 60 AND typed_name !~ '[[:cntrl:]]'),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, slot_id),
  FOREIGN KEY (match_id, slot_id) REFERENCES pilot.slot(match_id, id) ON DELETE CASCADE
);

-- scoring_session's shape. The holder is always the owner account; only its
-- device changes (§3.3 step 5), and only by a person's take-over.
CREATE TABLE pilot.session (
  match_id       uuid PRIMARY KEY REFERENCES pilot.match(id) ON DELETE CASCADE,
  state          text NOT NULL DEFAULT 'active' CHECK (state = 'active'),
  epoch          integer NOT NULL DEFAULT 1,
  holder_device  text NOT NULL CHECK (holder_device ~ '^[A-Za-z0-9_.:+-]{1,80}$'),
  lease_until    timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The log: ball_event's columns without school_id. Player references are
-- this match's slots. The CHECKs carry ball_event's own names, so the write
-- path's per-event refusal (events-api.mjs valueRefusal) reads them alike.
-- A key is unique within its match: another match's key is no conflict.
CREATE TABLE pilot.ball_event (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id          uuid NOT NULL REFERENCES pilot.match(id) ON DELETE CASCADE,
  seq               integer NOT NULL,
  epoch             integer NOT NULL,
  innings           smallint NOT NULL DEFAULT 0,
  scorer_user_id    uuid NOT NULL REFERENCES app_user(id),
  device_id         text NOT NULL CHECK (device_id ~ '^[A-Za-z0-9_.:+-]{1,80}$'),
  idempotency_key   text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:+-]{1,200}$'),
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
  striker_id        uuid,
  non_striker_id    uuid,
  bowler_id         uuid,
  dismissed_id      uuid,
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
  UNIQUE (match_id, idempotency_key),
  FOREIGN KEY (match_id, striker_id) REFERENCES pilot.slot(match_id, id),
  FOREIGN KEY (match_id, non_striker_id) REFERENCES pilot.slot(match_id, id),
  FOREIGN KEY (match_id, bowler_id) REFERENCES pilot.slot(match_id, id),
  FOREIGN KEY (match_id, dismissed_id) REFERENCES pilot.slot(match_id, id),
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
-- ball_event_quarantine's shape. The body is built by pilot_hold() from
-- validated fields alone (the screened event, its numbers and its key),
-- never the client's envelope as sent.
CREATE TABLE pilot.held (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id         uuid NOT NULL REFERENCES pilot.match(id) ON DELETE CASCADE,
  submitted_epoch  integer NOT NULL,
  current_epoch    integer,
  scorer_user_id   uuid NOT NULL REFERENCES app_user(id),
  device_id        text NOT NULL CHECK (device_id ~ '^[A-Za-z0-9_.:+-]{1,80}$'),
  idempotency_key  text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:+-]{1,200}$'),
  body             jsonb NOT NULL,
  fingerprint      text NOT NULL,
  held_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution       text CHECK (resolution IS NULL OR resolution IN ('superseded', 'discarded', 'released')),
  UNIQUE (match_id, idempotency_key)
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

-- Ids and reasons only, read back after a restore (§7.5). A name erased on
-- its own carries its slot.
CREATE TABLE pilot.tombstone (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id  uuid NOT NULL,
  slot_id   uuid,
  what      text NOT NULL CHECK (what IN ('names', 'match')),
  why       text NOT NULL CHECK (why IN ('scorer', 'retention', 'request', 'promotion', 'erasure', 'incident')),
  at        timestamptz NOT NULL DEFAULT now(),
  by        uuid
);

-- On the real side, one column (§2.2): NULL for every match not promoted,
-- and UNIQUE, so a promoted Pilot Match counts exactly once (§6.2).
ALTER TABLE match ADD COLUMN promoted_from uuid UNIQUE;

-- ...set only by the schema's owner: the promotion (R1) runs as it. The
-- application role has table-level UPDATE on match, which a column REVOKE
-- does not take away, so a trigger says no.
CREATE OR REPLACE FUNCTION match_promoted_from_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.promoted_from IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.promoted_from END)
     AND current_user <> (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID) THEN
    RAISE EXCEPTION 'match.promoted_from is set by the promotion alone' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER match_promoted_from_guard BEFORE INSERT OR UPDATE OF promoted_from ON match
  FOR EACH ROW EXECUTE FUNCTION match_promoted_from_guard();

-- ── Triggers ────────────────────────────────────────────────────────

-- The log is append-only, as ball_event is. The one exception is a DELETE
-- in a transaction that set pilot.deleting (only pilot_delete_one(), and
-- later the purge and promotion, set it).
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
-- caller can set them. A LATCH (review B2): once a date has passed it never
-- moves again, so a late event — a leftover in an outbox, a scorer scoring
-- on, on positions (§7.3) — cannot bring expired names back.
CREATE OR REPLACE FUNCTION pilot_match_clocks() RETURNS trigger AS $$
BEGIN
  NEW.ended_at := coalesce(greatest(NEW.finished_at, NEW.last_event_at), least(NEW.starts_at, NEW.created_at));
  NEW.names_purge_after := NEW.ended_at + interval '30 days';
  NEW.purge_after := NEW.ended_at + interval '12 months';
  IF TG_OP = 'UPDATE' THEN
    IF OLD.names_purge_after <= now() THEN NEW.names_purge_after := OLD.names_purge_after; END IF;
    IF OLD.purge_after <= now() THEN NEW.purge_after := OLD.purge_after; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER pilot_match_clocks BEFORE INSERT OR UPDATE ON pilot.match
  FOR EACH ROW EXECUTE FUNCTION pilot_match_clocks();

-- ── Helpers (the owner's; granted to nobody) ────────────────────────

-- The phone's normKey (lib/practice.js): NFKC, runs of space made one,
-- trimmed, lower case. How two names are told to be the same name.
CREATE OR REPLACE FUNCTION pilot_norm(t text) RETURNS text AS $$
  SELECT lower(btrim(regexp_replace(normalize(coalesce(t, ''), NFKC), '\s+', ' ', 'g')))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Does `hay` contain `needle` as whole words (the §5.2 rule)? Both by
-- pilot_norm, with anything not a letter or a digit read as a space.
CREATE OR REPLACE FUNCTION pilot_contains_word(hay text, needle text) RETURNS boolean AS $$
  SELECT btrim(regexp_replace(pilot_norm(needle), '[^[:alnum:]]+', ' ', 'g')) <> ''
     AND position(' ' || btrim(regexp_replace(pilot_norm(needle), '[^[:alnum:]]+', ' ', 'g')) || ' '
                  IN ' ' || btrim(regexp_replace(pilot_norm(hay), '[^[:alnum:]]+', ' ', 'g')) || ' ') > 0
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Every string in a JSON value, however deep, with the key it sits under
-- (an array's entries under the array's key), and every key itself (k NULL).
CREATE OR REPLACE FUNCTION pilot_leaves(p jsonb, p_key text DEFAULT NULL) RETURNS TABLE (k text, s text) AS $$
  SELECT p_key, p #>> '{}' WHERE jsonb_typeof(p) = 'string'
  UNION ALL
  SELECT NULL, e.key FROM jsonb_each(CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END) e
  UNION ALL
  SELECT l.k, l.s FROM jsonb_each(CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END) e
         CROSS JOIN LATERAL pilot_leaves(e.value, e.key) l
  UNION ALL
  SELECT l.k, l.s FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p) = 'array' THEN p ELSE '[]'::jsonb END) a
         CROSS JOIN LATERAL pilot_leaves(a, p_key) l
$$ LANGUAGE sql IMMUTABLE;

-- The closed vocabularies: a key whose every value is one of a known few.
-- A value in its key's vocabulary is a code, never a name (review N2: a boy
-- typed as "LB" does not hold back every leg-bye). Mirrored, key for key,
-- by lib/pilotWire.js CLOSED; apps/web/test/pilotWire.test.mjs holds them equal.
CREATE OR REPLACE FUNCTION pilot_closed(p_key text) RETURNS text[] AS $$
  SELECT CASE p_key
    WHEN 'kind' THEN ARRAY['innings_start', 'batters', 'bowler', 'ball', 'penalty', 'retire', 'innings_end', 'revision', 'void',
                           'bowler_suspended', 'keeper', 'play_stopped', 'play_resumed']
    WHEN 'type' THEN ARRAY['run', 'W', 'Wd', 'Nb', 'B', 'LB']
    WHEN 'battingTeam' THEN ARRAY['home', 'away']
    WHEN 'bowlingTeam' THEN ARRAY['home', 'away']
    WHEN 'teamKey' THEN ARRAY['home', 'away']
    WHEN 'bowlingTeamKey' THEN ARRAY['home', 'away']
    WHEN 'dismissal' THEN ARRAY['bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'handled_ball', 'obstructing_field',
                                'timed_out', 'retired_out', 'hit_twice']
    WHEN 'captureProfile' THEN ARRAY['full', 'standard', 'quick']
    WHEN 'contact' THEN ARRAY['middle', 'outside_edge', 'inside_edge', 'top_edge', 'beat', 'body']
    WHEN 'trajectory' THEN ARRAY['ground', 'aerial', 'controlled_aerial', 'miscued']
    WHEN 'zone' THEN ARRAY['inner', 'outer', 'boundary']
    WHEN 'placementSource' THEN ARRAY['point', 'sector']
    WHEN 'placementNull' THEN ARRAY['no_contact', 'not_applicable', 'not_required', 'skipped']
    WHEN 'closePosition' THEN ARRAY['keeper', 'slip', 'gully', 'leg_slip', 'leg_gully', 'silly_point', 'short_leg', 'short_mid_wicket', 'at_feet']
    WHEN 'nbType' THEN ARRAY['front_foot', 'height', 'beamer']
    WHEN 'outAt' THEN ARRAY['striker', 'non_striker']
    WHEN 'facesNext' THEN ARRAY['striker', 'non_striker', 'incoming']
    WHEN 'scope' THEN ARRAY['innings', 'match']
    WHEN 'bowlerApproach' THEN ARRAY['over', 'around']
  END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- The keys an event of each kind may carry (§3.4: "a key outside the
-- allow-list for its kind", as db/59 lists them), the base keys included.
-- Mirrored by lib/pilotWire.js KIND_KEYS; the same test holds them equal.
CREATE OR REPLACE FUNCTION pilot_kind_keys(p_kind text) RETURNS text[] AS $$
  SELECT ARRAY['kind', 'innings', 'clientTs', 'id', 'seq'] || CASE p_kind
    WHEN 'innings_start' THEN ARRAY['battingTeam', 'bowlingTeam', 'teamKey', 'bowlingTeamKey', 'squad', 'bowlingSquad', 'twelfthMan',
                                    'overs', 'target', 'captureProfile', 'superOver']
    WHEN 'batters' THEN ARRAY['striker', 'nonStriker', 'captainConsent']
    WHEN 'bowler' THEN ARRAY['bowler', 'reason']
    WHEN 'keeper' THEN ARRAY['keeper']
    WHEN 'bowler_suspended' THEN ARRAY['bowler', 'reason', 'scope']
    WHEN 'ball' THEN ARRAY['type', 'value', 'nbRuns', 'nbType', 'boundary', 'striker', 'nonStriker', 'bowler', 'shot', 'contact',
                           'trajectory', 'seg', 'zone', 'bowlerApproach', 'dismissal', 'fielder', 'dismissed', 'outAt', 'facesNext',
                           'notInOver', 'freeHit', 'theta', 'radius', 'placementSource', 'placementNull', 'closePosition', 'captureProfile']
    WHEN 'penalty' THEN ARRAY['runs', 'toBattingTeam', 'reason']
    WHEN 'retire' THEN ARRAY['batter', 'reason', 'type', 'dismissal']
    WHEN 'innings_end' THEN ARRAY['reason', 'confirmed']
    WHEN 'revision' THEN ARRAY['overs', 'target', 'reason', 'par']
    WHEN 'void' THEN ARRAY['target', 'reason']
    WHEN 'play_stopped' THEN ARRAY['reason', 'at']
    WHEN 'play_resumed' THEN ARRAY['at']
    ELSE NULL
  END
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

-- The caller's own match, or NULL: an unknown id and another owner's id are
-- the same answer.
CREATE OR REPLACE FUNCTION pilot_own(p_id uuid) RETURNS uuid AS $$
  SELECT m.id FROM pilot.match m WHERE m.id = p_id AND m.owner_user_id = app_user_id() AND pilot_may_score()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── The screen (§3.4) ───────────────────────────────────────────────
-- One event, as the pad keeps it (camelCase), judged against one match. A
-- reason, or NULL when it may go on. It never returns a name. Run inside
-- the writing functions themselves (pilot_insert, pilot_hold), so no route
-- or store can write without it; pilot_event_refusal() is the same answer,
-- asked first by the API so a refusal is said per event.
--
--   name_in_event  a key, or a value that is not a code of its key's closed
--                  vocabulary, equals (pilot_norm) a typed name of the match;
--   free_text      a kind not sent, a key outside its kind's list, or a
--                  value not of its key's shape: codes, numbers, event ids,
--                  times — never words;
--   unknown_slot   a player who is not one of this match's slots.
CREATE OR REPLACE FUNCTION pilot_screen(p_id uuid, p_event jsonb) RETURNS text AS $$
DECLARE r record; v_keys text[]; v_closed text[]; v jsonb; t text;
BEGIN
  IF jsonb_typeof(p_event) IS DISTINCT FROM 'object' THEN RETURN 'free_text'; END IF;
  IF EXISTS (SELECT 1 FROM pilot_leaves(p_event) x JOIN pilot.name nm ON nm.match_id = p_id
              WHERE pilot_norm(x.s) = pilot_norm(nm.typed_name)
                AND NOT (x.k IS NOT NULL AND x.s = ANY (coalesce(pilot_closed(x.k), '{}')))) THEN
    RETURN 'name_in_event';
  END IF;
  v_keys := pilot_kind_keys(p_event ->> 'kind');
  IF v_keys IS NULL THEN RETURN 'free_text'; END IF;
  FOR r IN SELECT e.key, e.value FROM jsonb_each(p_event) e LOOP
    IF NOT (r.key = ANY (v_keys)) THEN RETURN 'free_text'; END IF;
    v := r.value; t := jsonb_typeof(v);
    CONTINUE WHEN t = 'null';
    v_closed := pilot_closed(r.key);
    IF r.key IN ('striker', 'nonStriker', 'bowler', 'batter', 'dismissed', 'keeper', 'fielder', 'twelfthMan') THEN
      IF t <> 'string' OR NOT EXISTS (SELECT 1 FROM pilot.slot sl WHERE sl.match_id = p_id AND sl.id::text = v #>> '{}') THEN
        RETURN 'unknown_slot';
      END IF;
    ELSIF r.key IN ('squad', 'bowlingSquad') THEN
      IF t <> 'array' THEN RETURN 'unknown_slot'; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) a
                  WHERE jsonb_typeof(a) <> 'string'
                     OR NOT EXISTS (SELECT 1 FROM pilot.slot sl WHERE sl.match_id = p_id AND sl.id::text = a #>> '{}')) THEN
        RETURN 'unknown_slot';
      END IF;
    ELSIF v_closed IS NOT NULL THEN
      IF t <> 'string' OR NOT ((v #>> '{}') = ANY (v_closed)) THEN RETURN 'free_text'; END IF;
    ELSIF r.key IN ('reason', 'shot', 'notInOver') THEN
      IF t <> 'string' OR (v #>> '{}') !~ '^[a-z][a-z0-9_]{0,40}$' THEN RETURN 'free_text'; END IF;
    ELSIF r.key = 'id' THEN
      IF t <> 'string' OR (v #>> '{}') !~ '^[A-Za-z0-9_.+-]{1,80}(:[A-Za-z0-9_.+-]{1,80}){1,6}$' THEN RETURN 'free_text'; END IF;
    ELSIF r.key = 'target' THEN
      IF NOT (t = 'number' OR (t = 'string' AND (v #>> '{}') ~ '^[A-Za-z0-9_.+-]{1,80}(:[A-Za-z0-9_.+-]{1,80}){1,6}$')) THEN
        RETURN 'free_text';
      END IF;
    ELSIF r.key = 'at' THEN
      IF t <> 'string' OR (v #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RETURN 'free_text';
      END IF;
    ELSIF r.key IN ('boundary', 'freeHit', 'captainConsent', 'toBattingTeam') THEN
      IF t <> 'boolean' THEN RETURN 'free_text'; END IF;
    ELSIF r.key = 'confirmed' THEN
      IF t <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(v) c WHERE c.key NOT IN ('runs', 'wickets', 'balls')
                                                                  OR jsonb_typeof(c.value) NOT IN ('number', 'null')) THEN
        RETURN 'free_text';
      END IF;
    ELSE
      -- innings, clientTs, seq, value, nbRuns, seg, theta, radius, overs,
      -- superOver, runs, par: numbers.
      IF t <> 'number' THEN RETURN 'free_text'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE;

-- The same screen over the columns a row is written from (columnsFor() in
-- events-api.mjs): the columns read back into the event they came from, and
-- no column the log does not have.
CREATE OR REPLACE FUNCTION pilot_row_refusal(p_id uuid, p_cols jsonb) RETURNS text AS $$
DECLARE v_ev jsonb;
BEGIN
  IF jsonb_typeof(p_cols) IS DISTINCT FROM 'object' OR jsonb_typeof(p_cols -> 'payload') NOT IN ('object', 'null')
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_cols) k WHERE k NOT IN ('match_id', 'innings', 'kind', 'ball_type', 'value', 'shot',
                'contact', 'trajectory', 'seg', 'zone', 'striker_id', 'non_striker_id', 'bowler_id', 'dismissed_id', 'dismissal', 'payload',
                'theta', 'radius', 'placement_source', 'placement_null', 'close_position', 'capture_profile')) THEN
    RETURN 'free_text';
  END IF;
  IF (p_cols ->> 'match_id') IS DISTINCT FROM p_id::text THEN RETURN 'free_text'; END IF;
  v_ev := coalesce(p_cols -> 'payload', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'kind', p_cols -> 'kind', 'innings', p_cols -> 'innings', 'type', p_cols -> 'ball_type', 'value', p_cols -> 'value',
    'shot', p_cols -> 'shot', 'contact', p_cols -> 'contact', 'trajectory', p_cols -> 'trajectory', 'seg', p_cols -> 'seg',
    'zone', p_cols -> 'zone', 'striker', p_cols -> 'striker_id', 'nonStriker', p_cols -> 'non_striker_id',
    'bowler', p_cols -> 'bowler_id', 'dismissed', p_cols -> 'dismissed_id', 'dismissal', p_cols -> 'dismissal',
    'theta', p_cols -> 'theta', 'radius', p_cols -> 'radius', 'placementSource', p_cols -> 'placement_source',
    'placementNull', p_cols -> 'placement_null', 'closePosition', p_cols -> 'close_position',
    'captureProfile', p_cols -> 'capture_profile'));
  RETURN pilot_screen(p_id, v_ev);
END $$ LANGUAGE plpgsql STABLE;

-- A refusal raised from inside a write: the CHECK the event broke, named
-- for the reason, against `ball_event` so the write path's valueRefusal()
-- answers it per event.
CREATE OR REPLACE FUNCTION pilot_refuse(p_reason text) RETURNS void AS $$
BEGIN
  RAISE EXCEPTION 'a Pilot Match event was refused: %', p_reason
    USING ERRCODE = 'check_violation', TABLE = 'ball_event', CONSTRAINT = p_reason;
END $$ LANGUAGE plpgsql;

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
-- The venue's name is not kept (S4): `p_venue_name` is ignored. Every value
-- is checked by its shape before it is cast, inside the guarded block, so a
-- bad one reaches no log.
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
  IF jsonb_typeof(p_sides) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sides) <> 2
     OR (SELECT count(DISTINCT x->>'side') FROM jsonb_array_elements(p_sides) x WHERE x->>'side' IN ('home', 'away')) <> 2 THEN
    RETURN QUERY SELECT false, 'bad_sides'; RETURN;
  END IF;
  IF jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_slots) x
                 WHERE jsonb_typeof(x) <> 'object'
                    OR coalesce(x->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    OR coalesce(x->>'list_no', '') !~ '^[0-9]{1,2}$'
                    OR (x->'batting_no' IS NOT NULL AND jsonb_typeof(x->'batting_no') <> 'null' AND (x->>'batting_no') !~ '^[0-9]{1,2}$')
                    OR (x->'twelfth' IS NOT NULL AND jsonb_typeof(x->'twelfth') NOT IN ('boolean', 'null'))) THEN
    RETURN QUERY SELECT false, 'bad_slots'; RETURN;
  END IF;
  SELECT count(*) FILTER (WHERE x->>'side' = 'home'), count(*) FILTER (WHERE x->>'side' = 'away')
    INTO n_home, n_away FROM jsonb_array_elements(p_slots) x;
  IF n_home NOT BETWEEN 2 AND 15 OR n_away NOT BETWEEN 2 AND 15 OR n_home + n_away <> jsonb_array_length(p_slots) THEN
    RETURN QUERY SELECT false, 'bad_slots'; RETURN;
  END IF;
  -- The weather's conditions, and nothing else (no position, ever); each a
  -- code or a number.
  IF jsonb_typeof(p_weather) = 'object' THEN
    SELECT jsonb_object_agg(k, p_weather -> k) INTO v_w
      FROM unnest(ARRAY['condition', 'temp_c', 'humidity_pct', 'wind_kph', 'wind_dir', 'rain_chance_pct', 'playable']) k
     WHERE p_weather ? k AND (jsonb_typeof(p_weather -> k) IN ('number', 'boolean')
                              OR (jsonb_typeof(p_weather -> k) = 'string' AND (p_weather ->> k) ~ '^[A-Za-z_]{1,20}$'));
  END IF;
  BEGIN
    INSERT INTO pilot.match (id, owner_user_id, overs, format, starts_at, venue_name, toss_won_by, toss_decision, weather)
    VALUES (p_id, app_user_id(), p_overs, nullif(btrim(p_format), ''), least(coalesce(p_starts_at, now()), now()), NULL,
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
-- one slot's name, or with an empty name erases it (a tombstone with its
-- slot, S6). Refused while the counsel fallback is on (`names_upload_off`),
-- after the names' date, on a promoted match, and when a side's school or
-- display name holds one of the names as whole words (§5.2's rule): the
-- names then stay on the phone.
CREATE OR REPLACE FUNCTION pilot_names_put(p_id uuid, p_rows jsonb)
RETURNS TABLE (ok boolean, reason text, n integer) AS $$
DECLARE v_m pilot.match%ROWTYPE; r jsonb; v_n int := 0; v_name text; v_slot uuid;
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN QUERY SELECT false, 'not_found', 0; RETURN; END IF;
  IF NOT pilot_switch_on('pilot_names_upload') THEN RETURN QUERY SELECT false, 'names_upload_off', 0; RETURN; END IF;
  SELECT * INTO v_m FROM pilot.match m WHERE m.id = p_id FOR UPDATE;
  IF v_m.status = 'promoted' THEN RETURN QUERY SELECT false, 'promoted', 0; RETURN; END IF;
  IF v_m.names_purge_after <= now() THEN RETURN QUERY SELECT false, 'names_expired', 0; RETURN; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE jsonb_typeof(x) <> 'object'
                   OR jsonb_typeof(x->'name') NOT IN ('string', 'null'))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) x
                 WHERE NOT EXISTS (SELECT 1 FROM pilot.slot s WHERE s.match_id = p_id AND s.id::text = x->>'slot')) THEN
    RETURN QUERY SELECT false, 'unknown_slot', 0; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) x CROSS JOIN pilot.side sd
              WHERE sd.match_id = p_id AND coalesce(btrim(x->>'name'), '') <> ''
                AND (pilot_contains_word(sd.school, x->>'name') OR pilot_contains_word(sd.display_name, x->>'name'))) THEN
    RETURN QUERY SELECT false, 'team_name_has_player_name', 0; RETURN;
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    SELECT s.id INTO v_slot FROM pilot.slot s WHERE s.match_id = p_id AND s.id::text = r->>'slot';
    v_name := btrim(regexp_replace(coalesce(r->>'name', ''), '\s+', ' ', 'g'));
    IF v_name = '' THEN
      DELETE FROM pilot.name nm WHERE nm.match_id = p_id AND nm.slot_id = v_slot;
      IF FOUND THEN
        INSERT INTO pilot.tombstone (match_id, slot_id, what, why, by) VALUES (p_id, v_slot, 'names', 'scorer', app_user_id());
      END IF;
    ELSIF char_length(v_name) > 60 OR v_name ~ '[[:cntrl:]]' THEN
      RETURN QUERY SELECT false, 'bad_names', 0; RETURN;
    ELSE
      INSERT INTO pilot.name (match_id, slot_id, typed_name) VALUES (p_id, v_slot, v_name)
      ON CONFLICT (match_id, slot_id) DO UPDATE SET typed_name = EXCLUDED.typed_name, updated_at = now();
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
   WHERE nm.match_id = p_id AND pilot_own(p_id) IS NOT NULL AND m.names_purge_after > now() AND m.status <> 'promoted'
   ORDER BY nm.slot_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── What My Pilot Matches shows, and what a second phone opens from ──
-- One match's header: everything but the log and the names.
CREATE OR REPLACE FUNCTION pilot_header(p_id uuid) RETURNS jsonb AS $$
  SELECT jsonb_build_object(
           'id', m.id, 'status', m.status, 'overs', m.overs, 'format', m.format, 'startsAt', m.starts_at,
           'toss', jsonb_build_object('wonBy', m.toss_won_by, 'decision', m.toss_decision),
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
-- A finished or abandoned match takes no claim. Never another account. A
-- device id is a code (the phone's `dev-…`), never words.
CREATE OR REPLACE FUNCTION pilot_claim(p_id uuid, p_device text)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s pilot.session%ROWTYPE; v_status text;
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN QUERY SELECT false, 'not_found', NULL::int; RETURN; END IF;
  IF p_device IS NULL OR btrim(p_device) = '' THEN RETURN QUERY SELECT false, 'no_device', NULL::int; RETURN; END IF;
  IF p_device IS DISTINCT FROM app_device_id() THEN RETURN QUERY SELECT false, 'device_mismatch', NULL::int; RETURN; END IF;
  IF p_device !~ '^[A-Za-z0-9_.:+-]{1,80}$' THEN RETURN QUERY SELECT false, 'bad_device', NULL::int; RETURN; END IF;
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
  IF p_device IS NULL OR btrim(p_device) = '' THEN RETURN QUERY SELECT false, 'no_device', NULL::int; RETURN; END IF;
  IF p_device IS DISTINCT FROM app_device_id() THEN RETURN QUERY SELECT false, 'device_mismatch', NULL::int; RETURN; END IF;
  IF p_device !~ '^[A-Za-z0-9_.:+-]{1,80}$' THEN RETURN QUERY SELECT false, 'bad_device', NULL::int; RETURN; END IF;
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

-- The screen, asked by the API first, so a refusal is said per event (the
-- writes below ask it again, and raise).
CREATE OR REPLACE FUNCTION pilot_event_refusal(p_id uuid, p_event jsonb) RETURNS text AS $$
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN 'not_found'; END IF;
  RETURN pilot_screen(p_id, p_event);
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── The write path's store (events-api.mjs LogStore; pilot-api.mjs) ──
-- The core in events-api.mjs (dedupe, the Laws over the fold, value
-- refusals, seq, held) is the fixture's, behind a LogStore; these are the
-- pilot store's touches of the database. Each asks the owner again, and the
-- two that write screen what they write.

-- Is this key already written or held in this match, and is it THIS event (db/36)?
CREATE OR REPLACE FUNCTION pilot_dedupe(p_id uuid, p_key text, p_cols jsonb)
RETURNS TABLE (seq integer, same boolean, held_same boolean) AS $$
  SELECT (SELECT b.seq FROM pilot.ball_event b WHERE b.idempotency_key = p_key AND b.match_id = p_id),
         (SELECT b.fingerprint = ball_event_fingerprint(jsonb_populate_record(NULL::ball_event, p_cols))
            FROM pilot.ball_event b WHERE b.idempotency_key = p_key AND b.match_id = p_id),
         (SELECT h.fingerprint = ball_event_fingerprint(jsonb_populate_record(NULL::ball_event, p_cols))
            FROM pilot.held h WHERE h.idempotency_key = p_key AND h.match_id = p_id)
   WHERE pilot_own(p_id) IS NOT NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Held: a stale epoch, a lapsed lease, or a finished match. The body kept is
-- built here from what was checked — the screened event, its numbers, its
-- key — and nothing else the client sent.
CREATE OR REPLACE FUNCTION pilot_hold(p_id uuid, p_epoch integer, p_current integer, p_key text, p_body jsonb, p_cols jsonb)
RETURNS boolean AS $$
DECLARE v_why text; v_body jsonb;
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN false; END IF;
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.:+-]{1,200}$' OR jsonb_typeof(p_body) IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['innings', 'clientSeq', 'clientTs']) f
                 WHERE p_body ? f AND jsonb_typeof(p_body -> f) NOT IN ('number', 'null')) THEN
    PERFORM pilot_refuse('free_text');
  END IF;
  v_why := coalesce(pilot_screen(p_id, coalesce(p_body -> 'payload', '{}'::jsonb)), pilot_row_refusal(p_id, p_cols));
  IF v_why IS NOT NULL THEN PERFORM pilot_refuse(v_why); END IF;
  v_body := jsonb_strip_nulls(jsonb_build_object('epoch', p_epoch, 'idempotencyKey', p_key, 'innings', p_body -> 'innings',
                                                 'clientSeq', p_body -> 'clientSeq', 'clientTs', p_body -> 'clientTs',
                                                 'payload', coalesce(p_body -> 'payload', '{}'::jsonb)));
  INSERT INTO pilot.held (match_id, submitted_epoch, current_epoch, scorer_user_id, device_id, idempotency_key, body, fingerprint)
  VALUES (p_id, p_epoch, p_current, app_user_id(), app_device_id(), p_key, v_body,
          ball_event_fingerprint(jsonb_populate_record(NULL::ball_event, p_cols)))
  ON CONFLICT (match_id, idempotency_key) DO NOTHING;
  RETURN true;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Written: at the next seq, only by the device holding the live lease at
-- this epoch (the fixture's RLS WITH CHECK, as a condition), and only what
-- the screen passes. The held copy of the same key is closed as superseded
-- (db/37's rule). The match's last ball is the event's own time, never
-- later than its arrival (S5).
CREATE OR REPLACE FUNCTION pilot_insert(p_id uuid, p_epoch integer, p_key text, p_client_seq integer, p_client_ts timestamptz, p_cols jsonb)
RETURNS integer AS $$
DECLARE v_seq int; v_why text; v_at timestamptz := least(coalesce(p_client_ts, now()), now());
BEGIN
  IF pilot_own(p_id) IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pilot.session s WHERE s.match_id = p_id AND s.epoch = p_epoch
                    AND s.holder_device = app_device_id() AND s.lease_until > now()) THEN
    RAISE EXCEPTION 'no live lease' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.:+-]{1,200}$' THEN PERFORM pilot_refuse('free_text'); END IF;
  v_why := pilot_row_refusal(p_id, p_cols);
  IF v_why IS NOT NULL THEN PERFORM pilot_refuse(v_why); END IF;
  SELECT coalesce(max(b.seq), 0) + 1 INTO v_seq FROM pilot.ball_event b WHERE b.match_id = p_id;
  INSERT INTO pilot.ball_event (match_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq, client_ts,
                                kind, ball_type, value, shot, contact, trajectory, seg, zone, striker_id, non_striker_id, bowler_id,
                                dismissed_id, dismissal, payload, theta, radius, placement_source, placement_null, close_position,
                                capture_profile)
  SELECT p_id, v_seq, p_epoch, r.innings, app_user_id(), app_device_id(), p_key, p_client_seq, v_at,
         r.kind, r.ball_type, r.value, r.shot, r.contact, r.trajectory, r.seg, r.zone, r.striker_id, r.non_striker_id, r.bowler_id,
         r.dismissed_id, r.dismissal, r.payload, r.theta, r.radius, r.placement_source, r.placement_null, r.close_position,
         r.capture_profile
    FROM jsonb_populate_record(NULL::ball_event, p_cols) r;
  UPDATE pilot.held h SET resolved_at = now(), resolution = 'superseded'
   WHERE h.match_id = p_id AND h.idempotency_key = p_key AND h.resolved_at IS NULL;
  UPDATE pilot.match m SET last_event_at = greatest(coalesce(m.last_event_at, v_at), v_at) WHERE m.id = p_id;
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
-- The end is the match's own (S5): `p_at`, the pad's time of the act,
-- never later than now and never before its last ball; now when not given.
-- Every ball sent after it is held. Codes only.
CREATE OR REPLACE FUNCTION pilot_finish(p_id uuid, p_at timestamptz DEFAULT NULL) RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN QUERY SELECT false, 'not_found'; RETURN; END IF;
  UPDATE pilot.match m SET status = 'finished',
         finished_at = greatest(least(coalesce(p_at, now()), now()), coalesce(m.last_event_at, '-infinity'::timestamptz))
   WHERE m.id = p_id AND m.status = 'live';
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_live'; RETURN; END IF;
  INSERT INTO pilot.audit (match_id, event, actor_id) VALUES (p_id, 'finished', app_user_id());
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION pilot_abandon(p_id uuid, p_code text, p_at timestamptz DEFAULT NULL) RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF pilot_own(p_id) IS NULL THEN RETURN QUERY SELECT false, 'not_found'; RETURN; END IF;
  IF p_code IS NULL OR p_code NOT IN ('weather', 'light', 'ground', 'other_side', 'other') THEN
    RETURN QUERY SELECT false, 'bad_reason'; RETURN;
  END IF;
  UPDATE pilot.match m SET status = 'abandoned', abandon_reason = p_code,
         finished_at = greatest(least(coalesce(p_at, now()), now()), coalesce(m.last_event_at, '-infinity'::timestamptz))
   WHERE m.id = p_id AND m.status = 'live';
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_live'; RETURN; END IF;
  INSERT INTO pilot.audit (match_id, event, actor_id, detail) VALUES (p_id, 'abandoned', app_user_id(), jsonb_build_object('reason', p_code));
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── Delete (§7.2) ───────────────────────────────────────────────────
-- Everything of the match, with a tombstone for its names and for itself
-- and an audit row (which outlives it). The off-database deletion log of
-- §7.5 is slice 5's. The helper asks the caller too (review B1): it is the
-- owner's match, or nothing happens. Not SECURITY DEFINER, and granted to
-- nobody: only pilot_delete() and pilot_delete_all_for() reach it, as the
-- owner. The erasure path (account_erase(), why = 'erasure') is slice 5's.
CREATE OR REPLACE FUNCTION pilot_delete_one(p_id uuid, p_why text) RETURNS boolean AS $$
DECLARE v_had_names boolean; v_n int;
BEGIN
  IF app_user_id() IS NULL OR app_pad_scoped()
     OR NOT EXISTS (SELECT 1 FROM pilot.match m WHERE m.id = p_id AND m.owner_user_id = app_user_id()) THEN
    RETURN false;
  END IF;
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
END $$ LANGUAGE plpgsql;

-- The scorer's delete. Allowed without the grant and with phase 2 off: a
-- scorer whose grant ended can still take his matches off the server.
CREATE OR REPLACE FUNCTION pilot_delete(p_id uuid) RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF NOT pilot_delete_one(p_id, 'scorer') THEN RETURN QUERY SELECT false, 'not_found'; RETURN; END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Every match of one account: the scorer's own "Delete everything".
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
-- Raises, naming what broke. Run at the end of this file and by db/99 §129,
-- which passes the signatures of its own helpers (they live inside its
-- transaction and roll back with it), and nothing else, as `p_exempt`.
-- A later migration that adds a function which must name a pilot table
-- redefines this one with the signature added: the friction is the point.
-- It fails closed: a function is on the list by its signature, and the
-- list pins how it runs and who may call it.
CREATE OR REPLACE FUNCTION pilot_isolation_check(p_exempt text[] DEFAULT '{}') RETURNS void AS $$
DECLARE v text; v_roles oid[]; v_app oid; v_owner oid; r record;
  -- (signature, SECURITY DEFINER?, granted to the application role?, may name the typed names?)
  v_list CONSTANT text[][] := ARRAY[
    ['public.pilot_log_guard()',                         'f', 'f', 'f'],
    ['public.pilot_ball_event_stamp()',                  'f', 'f', 'f'],
    ['public.pilot_match_clocks()',                      'f', 'f', 'f'],
    ['public.pilot_norm(text)',                          'f', 'f', 'f'],
    ['public.pilot_contains_word(text,text)',            'f', 'f', 'f'],
    ['public.pilot_leaves(jsonb,text)',                  'f', 'f', 'f'],
    ['public.pilot_closed(text)',                        'f', 'f', 'f'],
    ['public.pilot_kind_keys(text)',                     'f', 'f', 'f'],
    ['public.pilot_switch_on(text)',                     't', 'f', 'f'],
    ['public.pilot_may_score()',                         't', 'f', 'f'],
    ['public.pilot_own(uuid)',                           't', 'f', 'f'],
    ['public.pilot_screen(uuid,jsonb)',                  'f', 'f', 't'],
    ['public.pilot_row_refusal(uuid,jsonb)',             'f', 'f', 'f'],
    ['public.pilot_refuse(text)',                        'f', 'f', 'f'],
    ['public.pilot_status()',                            't', 't', 'f'],
    ['public.pilot_create(uuid,jsonb,jsonb,integer,text,timestamp with time zone,jsonb,text,jsonb)', 't', 't', 'f'],
    ['public.pilot_names_put(uuid,jsonb)',               't', 't', 't'],
    ['public.pilot_names_for_owner(uuid)',               't', 't', 't'],
    ['public.pilot_header(uuid)',                        't', 't', 'f'],
    ['public.pilot_mine()',                              't', 't', 'f'],
    ['public.pilot_claim(uuid,text)',                    't', 't', 'f'],
    ['public.pilot_takeover(uuid,text,integer)',         't', 't', 'f'],
    ['public.pilot_lease_check(uuid,text,integer)',      't', 't', 'f'],
    ['public.pilot_event_refusal(uuid,jsonb)',           't', 't', 'f'],
    ['public.pilot_dedupe(uuid,text,jsonb)',             't', 't', 'f'],
    ['public.pilot_hold(uuid,integer,integer,text,jsonb,jsonb)', 't', 't', 'f'],
    ['public.pilot_insert(uuid,integer,text,integer,timestamp with time zone,jsonb)', 't', 't', 'f'],
    ['public.pilot_log(uuid,integer)',                   't', 't', 'f'],
    ['public.pilot_fold_context(uuid)',                  't', 't', 'f'],
    ['public.pilot_held_here(uuid)',                     't', 't', 'f'],
    ['public.pilot_finish(uuid,timestamp with time zone)', 't', 't', 'f'],
    ['public.pilot_abandon(uuid,text,timestamp with time zone)', 't', 't', 'f'],
    ['public.pilot_delete_one(uuid,text)',               'f', 'f', 't'],
    ['public.pilot_delete(uuid)',                        't', 't', 'f'],
    ['public.pilot_delete_all_for(uuid)',                't', 't', 'f'],
    ['public.pilot_isolation_check(text[])',             'f', 'f', 'f']];
  v_oids oid[] := '{}'; v_ex oid[] := '{}'; i int;
BEGIN
  -- The roles that must hold nothing: PUBLIC (0), the application role, and
  -- a managed host's API roles where they exist.
  SELECT array_agg(oid) INTO v_roles FROM pg_roles WHERE rolname IN ('scrbrd_app', 'anon', 'authenticated', 'service_role');
  v_roles := coalesce(v_roles, '{}') || 0::oid;
  v_app := (SELECT oid FROM pg_roles WHERE rolname = 'scrbrd_app');
  v_owner := (SELECT nspowner FROM pg_namespace WHERE nspname = 'pilot');

  -- 1. No grant: the schema, every relation and sequence in it, and its
  --    default privileges.
  IF EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
              WHERE n.nspname = 'pilot' AND a.grantee = ANY (v_roles)) THEN
    RAISE EXCEPTION 'pilot isolation (grant): a role other than the owner may use schema pilot';
  END IF;
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'pilot'
     AND EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = ANY (v_roles));
  IF v IS NOT NULL THEN RAISE EXCEPTION 'pilot isolation (grant): a role other than the owner holds a privilege on %', v; END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE n.nspname = 'pilot') THEN
    RAISE EXCEPTION 'pilot isolation (grant): schema pilot has default privileges';
  END IF;

  -- 2. No dependency: anything outside the schema — a view's rule, a policy,
  --    a key, a trigger, a default — that depends on an object inside it.
  SELECT string_agg(DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid), '; ') INTO v
    FROM pg_depend d
    JOIN pg_class t ON d.refclassid = 'pg_class'::regclass AND t.oid = d.refobjid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace AND tn.nspname = 'pilot'
   WHERE d.deptype = 'n'
     AND coalesce((SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.oid = CASE d.classid
                      WHEN 'pg_rewrite'::regclass THEN (SELECT ev_class FROM pg_rewrite WHERE oid = d.objid)
                      WHEN 'pg_policy'::regclass THEN (SELECT polrelid FROM pg_policy WHERE oid = d.objid)
                      WHEN 'pg_constraint'::regclass THEN (SELECT nullif(conrelid, 0) FROM pg_constraint WHERE oid = d.objid)
                      WHEN 'pg_trigger'::regclass THEN (SELECT tgrelid FROM pg_trigger WHERE oid = d.objid)
                      WHEN 'pg_attrdef'::regclass THEN (SELECT adrelid FROM pg_attrdef WHERE oid = d.objid)
                      WHEN 'pg_class'::regclass THEN d.objid END), 'not a relation') <> 'pilot';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'pilot isolation (dependency): % depends on a pilot object', v; END IF;

  -- 3. The functions. Every function that names a pilot object — in any
  --    case, quoted or not, with or without spaces at the dot — or sets a
  --    search_path holding pilot, or runs dynamic SQL beside a quoted
  --    'pilot', or is called pilot_*, must be on the list by its signature;
  --    each listed one must run as listed and be callable by exactly whom
  --    the list says (the owner, and the application role where marked).
  FOR i IN 1 .. array_length(v_list, 1) LOOP
    v_oids := v_oids || coalesce(to_regprocedure(v_list[i][1])::oid, 0::oid);
    IF to_regprocedure(v_list[i][1]) IS NULL THEN
      RAISE EXCEPTION 'pilot isolation (functions): % is listed and does not exist', v_list[i][1];
    END IF;
  END LOOP;
  FOR i IN 1 .. coalesce(array_length(p_exempt, 1), 0) LOOP
    IF to_regprocedure(p_exempt[i]) IS NOT NULL AND to_regprocedure(p_exempt[i])::text ~ '^_v151_' THEN
      v_ex := v_ex || to_regprocedure(p_exempt[i])::oid;
    END IF;
  END LOOP;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v
    FROM pg_proc p
   WHERE NOT (p.oid = ANY (v_oids)) AND NOT (p.oid = ANY (v_ex))
     AND (p.proname ~* '^pilot_'
          OR p.prosrc ~* '"?\mpilot"?\s*\.\s*"?[a-z_]'
          OR EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c ~* '^search_path=.*\mpilot\M')
          OR (p.prosrc ~* '\mexecute\M' AND p.prosrc ~* '[''"]pilot[''"]'));
  IF v IS NOT NULL THEN RAISE EXCEPTION 'pilot isolation (functions): % reaches pilot and is not on the list', v; END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v
    FROM pg_proc p
   WHERE NOT (p.oid = ANY (v_ex))
     AND p.prosrc ~* '"?\mpilot"?\s*\.\s*"?name\M'
     AND (NOT EXISTS (SELECT 1 FROM generate_subscripts(v_list, 1) j
                       WHERE to_regprocedure(v_list[j][1]) = p.oid AND v_list[j][4] = 't')
          OR p.proname ~* '^public_');
  IF v IS NOT NULL THEN RAISE EXCEPTION 'pilot isolation (names): % names the typed names and may not', v; END IF;
  FOR i IN 1 .. array_length(v_list, 1) LOOP
    SELECT p.* INTO r FROM pg_proc p WHERE p.oid = v_oids[i];
    IF r.prosecdef <> (v_list[i][2] = 't') THEN
      RAISE EXCEPTION 'pilot isolation (functions): % % SECURITY DEFINER', v_list[i][1], CASE WHEN r.prosecdef THEN 'is' ELSE 'is not' END;
    END IF;
    IF r.prosecdef AND NOT ('search_path=pg_catalog, public, pg_temp' = ANY (coalesce(r.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'pilot isolation (functions): % does not pin its search_path', v_list[i][1];
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(coalesce(r.proacl, acldefault('f', r.proowner))) a
                WHERE a.grantee <> r.proowner AND NOT (v_list[i][3] = 't' AND a.grantee = v_app AND a.privilege_type = 'EXECUTE')) THEN
      RAISE EXCEPTION 'pilot isolation (functions): % may be called by a role the list does not name', v_list[i][1];
    END IF;
    IF v_list[i][3] = 't' AND NOT EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = v_app) THEN
      RAISE EXCEPTION 'pilot isolation (functions): % is not the application role''s to call', v_list[i][1];
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;

-- ── Grants ──────────────────────────────────────────────────────────
-- Every pilot function is taken from PUBLIC, and from a managed host's API
-- roles (Supabase gives anon, authenticated and service_role EXECUTE on
-- every new function in public by default, which a REVOKE from PUBLIC does
-- not take away) — then the doors the API opens are given to the
-- application role alone. The schema, its tables and its sequences the same.
DO $grants$
DECLARE f text; r text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname ~ '^pilot_' OR p.proname = 'match_promoted_from_guard') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'scrbrd_app'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r); END IF;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'scrbrd_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA pilot FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA pilot FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA pilot FROM %I', r);
    END IF;
  END LOOP;
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA pilot FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA pilot FROM PUBLIC';
  FOREACH f IN ARRAY ARRAY[
    'pilot_status()', 'pilot_create(uuid,jsonb,jsonb,integer,text,timestamptz,jsonb,text,jsonb)', 'pilot_names_put(uuid,jsonb)',
    'pilot_names_for_owner(uuid)', 'pilot_header(uuid)', 'pilot_mine()', 'pilot_claim(uuid,text)', 'pilot_takeover(uuid,text,integer)',
    'pilot_lease_check(uuid,text,integer)', 'pilot_event_refusal(uuid,jsonb)', 'pilot_dedupe(uuid,text,jsonb)',
    'pilot_hold(uuid,integer,integer,text,jsonb,jsonb)', 'pilot_insert(uuid,integer,text,integer,timestamptz,jsonb)',
    'pilot_log(uuid,integer)', 'pilot_fold_context(uuid)', 'pilot_held_here(uuid)', 'pilot_finish(uuid,timestamptz)',
    'pilot_abandon(uuid,text,timestamptz)', 'pilot_delete(uuid)', 'pilot_delete_all_for(uuid)']
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
END $grants$;

SELECT pilot_isolation_check();

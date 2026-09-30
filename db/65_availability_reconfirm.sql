-- ══════════════════════════════════════════════════════════════════
--  65 · Availability asks again when the fixture changes (SCRBRD-122)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, with a GENERATED block for the history table's policies.
-- audit/SCRBRD_IMPLEMENTATION_BACKLOG.md, SCRBRD-122.
--
-- WHY. match_availability (db/08) stored the answer and nothing about the
-- question. A boy who said "available" for Saturday at 09:00 stayed available
-- when the fixture moved to Wednesday at 14:30, which nobody asked him about.
-- That breaks the table's own rule, SILENCE IS NOT A YES: nobody said yes to
-- Wednesday.
--
-- THE CHOICE: A SNAPSHOT ON THE ANSWER, NOT A FIXTURE VERSION. Each answer
-- carries the four facts of the fixture it was given about — fixture_starts_at,
-- fixture_ground_id, fixture_format, fixture_overs, copied from `match` by a
-- trigger at every write — and it is stale exactly when those differ from
-- the match as it stands now. A version counter on `match` was the
-- alternative and is worse on three counts:
--   * it needs a history of `match` to say what the answer was about, where
--     the snapshot IS that history ("was available for Sat 3 Oct 09:00 at
--     Chapel Oval") and needs no join to render;
--   * a counter goes up for any edit, so it either stales answers on changes
--     that do not matter to a family or needs the same column list anyway;
--   * a fixture moved and moved back is, by the snapshot, the fixture the
--     family answered about, so the answer stands again. A counter would ask
--     them about a Saturday they already said yes to.
--
-- WHAT IS IN THE SNAPSHOT, AND WHAT IS NOT. The question a family answers is
-- "can he be there then": WHEN (starts_at), WHERE (ground_id), and FOR HOW
-- LONG (format and overs — a T20 afternoon is not a fifty-over day). The
-- opponent's name, the fixture's status, its competition, the away side and
-- the sport are left out: a change to them does not change whether he can
-- be there. (A fixture called off is its status, and nobody needs to answer
-- again for a match that is not being played.)
--
-- WHAT IS HERE.
--
--   match_availability          four snapshot columns, backfilled from the
--                               match as it stands (there is no record of what
--                               it was when an older answer was given, so an
--                               answer on file today is taken as about today's
--                               fixture — the status quo, not a new claim),
--                               then stamped on every insert and update by
--                               availability_stamp_fixture(). The caller never
--                               supplies them: a value in the request is
--                               overwritten.
--   availability_fixture_moved(a, m)  the rule: an answer exists and its
--                               snapshot differs from the match.
--   availability_effective(a, m)      the answer as a reader should take it:
--                               NULL (no answer), 'needs_reconfirming', or the
--                               status as given. Every reader of availability
--                               asks this (the API's `availability` and
--                               `readiness` reads), so nobody re-derives it.
--   availability_fixture_words(...)   "Sat 3 Oct 09:00 at Chapel Oval · T20,
--                               20 overs", for the history line and the notice.
--                               Not a definer: a ground the reader cannot read
--                               is left out rather than disclosed.
--   match_availability_history  every answer that was replaced, with the
--                               fixture it was about and whether it was asking
--                               again when it was replaced. NOTHING IS
--                               DELETED: re-declaring used to overwrite the row
--                               (the API's upsert), and the old answer went
--                               with it. Read exactly as the live row is
--                               (availability.read, the same four anchors);
--                               written only by its trigger.
--   availability_ask_again()    AFTER a fixture's starts_at, ground, format or
--                               overs change: for each answer that is now
--                               stale, one notice to whoever gave it and one
--                               to each of the boy's live, verified guardians,
--                               asking them to answer again. Through the
--                               existing `notification` table and nothing new:
--                               recipient_id (db/57) so it reaches that person
--                               only, and required_capability
--                               availability.read with the boy as the person
--                               anchor, so a recipient who could not read the
--                               answer cannot read the notice either. Only for
--                               a scheduled fixture still in the future; a
--                               correction to a played match's time asks
--                               nobody. A pupil who answered for himself is
--                               told too, as the system's own notice (SG-9,
--                               db/57: the only private notice a pupil may
--                               receive). Nothing is pushed to a phone: no
--                               system-written notice is, yet (db/57 §7).
--
-- WHAT IS NOT TOUCHED. match_availability's policies (db/09, re-anchored in
-- db/39) and its trigger availability_belongs (db/08) are exactly as they
-- were; this file adds columns and triggers beside them. Nobody who could not
-- read an answer can read its history, its effective status or its notice.
--
-- Safe to run twice.

-- ── 1 · The fixture each answer was given about ────────────────────
ALTER TABLE match_availability
  ADD COLUMN IF NOT EXISTS fixture_starts_at timestamptz,
  -- No foreign key: the snapshot is history, and a ground removed later must
  -- not rewrite what the answer was about (match.ground_id is SET NULL on a
  -- delete, which is itself a change to the fixture).
  ADD COLUMN IF NOT EXISTS fixture_ground_id uuid,
  ADD COLUMN IF NOT EXISTS fixture_format    text,
  ADD COLUMN IF NOT EXISTS fixture_overs     smallint;

COMMENT ON COLUMN match_availability.fixture_starts_at IS
  'The fixture''s start as it stood when this answer was given (SCRBRD-122, db/65). Stamped by availability_stamp_fixture(); never from the caller.';

-- Before the stamping trigger exists, so the backfill is one plain UPDATE.
-- availability_belongs (db/08) fires on it and passes: nothing it checks moves.
UPDATE match_availability a
   SET fixture_starts_at = m.starts_at, fixture_ground_id = m.ground_id,
       fixture_format = m.format, fixture_overs = m.overs
  FROM match m
 WHERE m.id = a.match_id AND a.fixture_starts_at IS NULL;

ALTER TABLE match_availability ALTER COLUMN fixture_starts_at SET NOT NULL;

-- ── 2 · Every write stamps the fixture as it stands ────────────────
/**
 * A declaration is about the fixture as it is now: every insert and every
 * update (the API's upsert, which is a re-declaration) copies the match's
 * four facts onto the row. SECURITY DEFINER because the writer need not read
 * the match: a pupil's selfaccess holds availability.declare and not
 * fixture.read (db/39), and his answer must still say what it was about. It
 * discloses nothing to him: the columns are on his own row, which the read
 * policy already gives him.
 */
CREATE OR REPLACE FUNCTION availability_stamp_fixture() RETURNS trigger AS $$
DECLARE m match%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match WHERE id = NEW.match_id;
  -- No match: the foreign key refuses the row, in its own words.
  IF FOUND THEN
    NEW.fixture_starts_at := m.starts_at;
    NEW.fixture_ground_id := m.ground_id;
    NEW.fixture_format    := m.format;
    NEW.fixture_overs     := m.overs;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS availability_stamp_fixture ON match_availability;
CREATE TRIGGER availability_stamp_fixture BEFORE INSERT OR UPDATE ON match_availability
  FOR EACH ROW EXECUTE FUNCTION availability_stamp_fixture();

-- ── 3 · The rule, once ─────────────────────────────────────────────
/**
 * Has the fixture changed since this answer was given? False where there is
 * no answer (a left join's empty row): silence is its own state, not a
 * stale one.
 */
CREATE OR REPLACE FUNCTION availability_fixture_moved(a match_availability, m match) RETURNS boolean AS $$
  SELECT a.status IS NOT NULL
     AND (a.fixture_starts_at, a.fixture_ground_id, a.fixture_format, a.fixture_overs)
         IS DISTINCT FROM (m.starts_at, m.ground_id, m.format, m.overs)
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

/**
 * The answer as a reader should take it. NULL: nobody has answered.
 * 'needs_reconfirming': an answer about a fixture that has since changed,
 * which counts as no answer (silence is not a yes) and is not the status it
 * was. Otherwise the status as given.
 */
CREATE OR REPLACE FUNCTION availability_effective(a match_availability, m match) RETURNS text AS $$
  SELECT CASE WHEN a.status IS NULL THEN NULL
              WHEN availability_fixture_moved(a, m) THEN 'needs_reconfirming'
              ELSE a.status END
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

/**
 * A fixture in the words a family reads it in: "Sat 3 Oct 09:00 at Chapel
 * Oval · T20, 20 overs", on the Johannesburg clock. The ground under the
 * CALLER's policy (not a definer): a reader who cannot read the ground gets
 * the line without it. The notice below is written by a definer, and the
 * boy's family hold facility.read.
 */
CREATE OR REPLACE FUNCTION availability_fixture_words(p_starts timestamptz, p_ground uuid, p_format text, p_overs smallint)
RETURNS text AS $$
  SELECT to_char(p_starts AT TIME ZONE 'Africa/Johannesburg', 'Dy FMDD Mon HH24:MI')
      || coalesce(' at ' || (SELECT g.name FROM ground g WHERE g.id = p_ground), '')
      || coalesce(' · ' || p_format, '')
      || coalesce(', ' || p_overs || ' overs', '')
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

-- ── 4 · The answers that were replaced ─────────────────────────────
CREATE TABLE IF NOT EXISTS match_availability_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  player_id         uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  school_id         uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  -- The answer as it was, column for column.
  status            text NOT NULL,
  reason_kind       text,
  note              text,
  declared_by       uuid REFERENCES app_user(id),
  declared_at       timestamptz NOT NULL,
  fixture_starts_at timestamptz NOT NULL,
  fixture_ground_id uuid,
  fixture_format    text,
  fixture_overs     smallint,
  -- When and by whom it was replaced, and whether the fixture had moved from
  -- under it by then (it was being asked again).
  superseded_at     timestamptz NOT NULL DEFAULT now(),
  superseded_by     uuid REFERENCES app_user(id),
  was_stale         boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS match_availability_history_answer ON match_availability_history (match_id, player_id, superseded_at DESC);
CREATE INDEX IF NOT EXISTS match_availability_history_player ON match_availability_history (player_id);

-- Read as the live answer is: availability.read at the fixture's school and
-- team (through match_school()/match_team(), as db/39 reads the live row) and
-- the boy as the person anchor. The generated write policies are unreachable:
-- the application holds no INSERT, UPDATE or DELETE on this table (below).
-- ┌── GENERATED from packages/policy/src/tables.mjs by services/api/rls/generate-rls.mjs (TABLES_ADDED_SINCE_09). DO NOT EDIT BY HAND; `pnpm rls:generate` rewrites it.

-- match_availability_history — read: availability.read · write: availability.declare
ALTER TABLE match_availability_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_availability_history_read   ON match_availability_history;
DROP POLICY IF EXISTS match_availability_history_insert ON match_availability_history;
DROP POLICY IF EXISTS match_availability_history_update ON match_availability_history;
DROP POLICY IF EXISTS match_availability_history_delete ON match_availability_history;

CREATE POLICY match_availability_history_read ON match_availability_history
  FOR SELECT USING (app_can('availability.read', (match_school(match_availability_history.match_id)), (match_team(match_availability_history.match_id)), match_availability_history.player_id, match_availability_history.match_id));

CREATE POLICY match_availability_history_insert ON match_availability_history
  FOR INSERT WITH CHECK (app_can('availability.declare', (match_school(match_availability_history.match_id)), (match_team(match_availability_history.match_id)), match_availability_history.player_id, match_availability_history.match_id));

CREATE POLICY match_availability_history_update ON match_availability_history
  FOR UPDATE USING (app_can('availability.declare', (match_school(match_availability_history.match_id)), (match_team(match_availability_history.match_id)), match_availability_history.player_id, match_availability_history.match_id))
           WITH CHECK (app_can('availability.declare', (match_school(match_availability_history.match_id)), (match_team(match_availability_history.match_id)), match_availability_history.player_id, match_availability_history.match_id));

-- └── END GENERATED

GRANT SELECT ON match_availability_history TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON match_availability_history FROM scrbrd_app;

/**
 * Keep the answer a re-declaration replaces. AFTER UPDATE, as the owner: the
 * person answering again holds availability.declare on the live row and no
 * write on its history, which is the point. Only a real re-declaration is
 * kept — an update that left the answer and its fixture exactly as they were
 * has replaced nothing.
 */
CREATE OR REPLACE FUNCTION availability_keep_history() RETURNS trigger AS $$
DECLARE m match%ROWTYPE;
BEGIN
  IF (OLD.status, OLD.reason_kind, OLD.note, OLD.declared_by, OLD.declared_at,
      OLD.fixture_starts_at, OLD.fixture_ground_id, OLD.fixture_format, OLD.fixture_overs)
     IS NOT DISTINCT FROM
     (NEW.status, NEW.reason_kind, NEW.note, NEW.declared_by, NEW.declared_at,
      NEW.fixture_starts_at, NEW.fixture_ground_id, NEW.fixture_format, NEW.fixture_overs) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO m FROM match WHERE id = OLD.match_id;
  INSERT INTO match_availability_history
    (match_id, player_id, school_id, status, reason_kind, note, declared_by, declared_at,
     fixture_starts_at, fixture_ground_id, fixture_format, fixture_overs, superseded_by, was_stale)
  VALUES (OLD.match_id, OLD.player_id, OLD.school_id, OLD.status, OLD.reason_kind, OLD.note,
          OLD.declared_by, OLD.declared_at, OLD.fixture_starts_at, OLD.fixture_ground_id,
          OLD.fixture_format, OLD.fixture_overs, app_user_id(),
          coalesce(availability_fixture_moved(OLD, m), false));
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS availability_keep_history ON match_availability;
CREATE TRIGGER availability_keep_history AFTER UPDATE ON match_availability
  FOR EACH ROW EXECUTE FUNCTION availability_keep_history();

-- ── 5 · Asking again ───────────────────────────────────────────────
/**
 * A fixture's time, ground, format or overs changed: ask again, of the people
 * who answered and the boy's guardians, for every answer the change made
 * stale. An answer already stale from an earlier move is asked about again
 * too — the notice it had named a fixture that no longer stands. An answer
 * the change made fresh again (the fixture moved back) is asked about by
 * nobody.
 *
 * The recipients, and why each may read what is sent:
 *   whoever gave the answer   declared_by — the boy, a guardian, or a coach
 *                             recording what he was told. Each read it
 *                             through availability.read when they gave it;
 *                             if they no longer may, the notice's own policy
 *                             hides it from them.
 *   the boy's guardians       live, verified guardian links (the same
 *                             conditions app_can() reads). They hold
 *                             availability.read for their own child only.
 * The notice's policy (db/09 notification_read, db/57's recipient cut) is
 * the wall: news.read AND availability.read at the fixture's school and team
 * with the boy as the person anchor, AND recipient_id = the reader. So it
 * names the child only to somebody who could already read his answer.
 */
CREATE OR REPLACE FUNCTION availability_ask_again() RETURNS trigger AS $$
DECLARE
  a        match_availability%ROWTYPE;
  v_name   text;
  v_now    text := availability_fixture_words(NEW.starts_at, NEW.ground_id, NEW.format, NEW.overs);
  v_was    text;
  r        uuid;
BEGIN
  IF NEW.status <> 'scheduled' OR NEW.starts_at <= now() THEN RETURN NULL; END IF;
  FOR a IN SELECT * FROM match_availability WHERE match_id = NEW.id LOOP
    CONTINUE WHEN NOT availability_fixture_moved(a, NEW);
    SELECT full_name INTO v_name FROM player WHERE id = a.player_id;
    v_was := availability_fixture_words(a.fixture_starts_at, a.fixture_ground_id, a.fixture_format, a.fixture_overs);
    FOR r IN
      SELECT a.declared_by WHERE a.declared_by IS NOT NULL
      UNION
      SELECT ra.person_id
        FROM role_assignment ra
        JOIN assignment_subject s ON s.assignment_id = ra.id
       WHERE ra.role = 'guardian' AND ra.active
         AND (ra.valid_from  IS NULL OR ra.valid_from  <= current_date)
         AND (ra.valid_until IS NULL OR ra.valid_until >  current_date)
         AND s.player_id = a.player_id AND s.verification_state = 'verified'
         AND s.valid_from <= current_date
         AND (s.valid_until IS NULL OR s.valid_until > current_date)
    LOOP
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id,
                                subject_person_id, recipient_id)
      VALUES (NEW.school_id, NEW.team_code,
              CASE WHEN NEW.team_code IS NULL THEN 'school' ELSE 'team' END,
              -- SG-9 (db/57): a private notice to a pupil must be the system's own.
              CASE WHEN person_is_pupil(r) THEN 'system' ELSE 'availability' END,
              'medium',
              'The fixture has changed: please answer again',
              v_name || '''s fixture v ' || NEW.opponent || ' is now ' || v_now || '. '
                || 'The answer on record, ' || a.status || ', was for ' || v_was
                || '. Until it is given again he counts as not answered.',
              'availability.read', false, 'match', NEW.id, a.player_id, r);
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS availability_ask_again ON match;
CREATE TRIGGER availability_ask_again AFTER UPDATE OF starts_at, ground_id, format, overs ON match
  FOR EACH ROW
  WHEN ((OLD.starts_at, OLD.ground_id, OLD.format, OLD.overs)
        IS DISTINCT FROM (NEW.starts_at, NEW.ground_id, NEW.format, NEW.overs))
  EXECUTE FUNCTION availability_ask_again();

-- ── 6 · Grants, and the pad's guard ────────────────────────────────
DO $grants$
DECLARE f text; r text;
  app text[] := ARRAY[
    'availability_fixture_moved(match_availability,match)',
    'availability_effective(match_availability,match)',
    'availability_fixture_words(timestamptz,uuid,text,smallint)'];
  internal text[] := ARRAY[
    'availability_stamp_fixture()', 'availability_keep_history()', 'availability_ask_again()'];
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
      EXECUTE format('REVOKE ALL ON match_availability_history FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

-- A pad's resume credential reaches none of it (db/50).
SELECT pad_scope_guard_install('match_availability_history'::regclass) AS pad_guards;

-- ── 7 · The check ──────────────────────────────────────────────────
-- What must hold the moment this file has run. db/99 §43 is the proof, with
-- principals, on every verify paste.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM match_availability a JOIN match m ON m.id = a.match_id
              WHERE availability_fixture_moved(a, m)) THEN
    RAISE EXCEPTION 'db/65: an answer on file reads as asking again straight after the backfill';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
        ('availability_belongs', 'availability_stamp_fixture', 'availability_keep_history', 'availability_ask_again')) <> 4 THEN
    RAISE EXCEPTION 'db/65: a trigger is missing';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'match_availability'::regclass
        AND polname IN ('match_availability_read', 'match_availability_insert', 'match_availability_update')) <> 3 THEN
    RAISE EXCEPTION 'db/65: match_availability lost a policy';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'match_availability_history'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'match_availability_history'::regclass
                     AND polname = 'match_availability_history_read') THEN
    RAISE EXCEPTION 'db/65: the history is not behind its read policy';
  END IF;
  IF has_table_privilege('scrbrd_app', 'match_availability_history', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'match_availability_history', 'UPDATE') THEN
    RAISE EXCEPTION 'db/65: the application may write the history';
  END IF;
END $check$;

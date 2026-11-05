-- ══════════════════════════════════════════════════════════════════
--  133 · Fixtures: one ground at a time, a 'postponed' status, and the
--        side told when a fixture is postponed, called off or back on
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Pilot item 2. Kameel's decisions of 4 November 2026, all as
-- recommended:
--   1. "Two fixtures on one ground at overlapping times: the app refuses the
--      booking and names the clash ('U15A v Kearsney is on No.1 Ground
--      10:00-13:00'). No override for the pilot."
--   2. "A 'Postponed' status, for a fixture called off before play that will
--      be replayed. The fixture stays, with no result and no figures. Giving
--      it a new date puts it back to scheduled, and parents are told both
--      times."
--   3. "Postponed, abandoned and back-on all notify the side's parents and
--      pupils, with no child's name on a lock screen."
-- Its proof is db/99 §112. The API that maps its refusals is
-- services/api/write/fixture-api.mjs; the screens, apps/web/src/views/
-- fixtures.jsx and the family's matches.jsx.
--
-- ── 1 · THE STATUS ──────────────────────────────────────────────────
-- match.status gains 'postponed' (db/00's CHECK, dropped and re-added). The
-- moves into and out of it, and only these:
--   scheduled → postponed     before play: refused once the match has any
--                             row in its ball log (a match that was played
--                             and stopped is abandoned, not postponed)
--   postponed → scheduled     with a new date, in the same update. A date
--                             changed on a postponed fixture with nothing
--                             said of its status puts it back to scheduled
--                             by itself (decision 2's own words)
--   postponed → abandoned     it will not be replayed after all
-- Every other move out of 'postponed' (to live, to complete) is refused, as
-- is going back on without a new date.
--
-- AND OUT OF 'abandoned' (Kameel, 4 Nov 2026, the board's paste-both: "An
-- abandoned match can still be put back to live. Recommend: only back to
-- scheduled, logged, for a match called off by mistake."):
--   abandoned → scheduled     the only move, for every caller; scoring_audit
--                             'abandoned_back_on', which audit_log() words
--                             "Put a called-off match back on"; the side is
--                             told, as for a postponed match back on
-- abandoned → live, complete or postponed is refused. db/132's
-- match_finished_stays_finished (complete → abandoned only) stands as it is;
-- this file does not re-create it, and it answers first for a complete match.
-- Other moves are unchanged. A postponed fixture keeps its row, its sheet and its toss;
-- it has no result (match_result_compute() reads no innings: in_progress),
-- the table counts only complete and abandoned fixtures (db/69, db/114),
-- and a career is folded from balls, of which it has none.
--
-- A postponed match cannot be scored:
--   * scoring_claim() refuses it, 'match_postponed' (re-emitted from
--     db/126's body with one check added, the guard below);
--   * postponing ends the scoring session it had (idle, the next epoch,
--     audited 'postponed'), so a pad that held the token holds nothing and
--     every ball it sends is quarantined (db/33's lease check);
--   * a BEFORE INSERT trigger on ball_event refuses a row on a postponed
--     match whoever writes it — the scorebook importer's confirm included,
--     which writes as the definer — and scorebook_import_open() refuses to
--     open one ('match_postponed', db/63's body with one check added).
--
-- ── 2 · ONE GROUND AT A TIME ────────────────────────────────────────
-- In the database, so a direct POST, the planner's publish, the importer
-- and psql are all held to it. A trigger rather than an EXCLUDE constraint,
-- for three reasons: `match` stores no end time; the clash is of related
-- grounds (a field and a pitch on it, as the planner reads them) as well as
-- of one ground; and the refusal names the clash in words.
--
-- WHEN A FIXTURE ENDS. match records when a fixture starts and never when it
-- ends. fixture_ends_at() works it out from the sport, format and overs
-- exactly as the planner's occupancy check does (packages/scoring/src/
-- planner.mjs, fixtureLength() and knownFixtureEnd()):
--   limited overs (T20, One-Day, any format not a declaration, or none)
--                 start + 2 × overs × 4 minutes + a 20-minute break:
--                 T20 180 minutes, fifty overs 420. No overs recorded:
--                 fifty for a one-day spelling, twenty otherwise.
--   declaration   (One-Day Declaration, timed, Two-Day, multi-day, test …)
--                 midnight SAST at the end of its last day: the number of
--                 days in its name (two to five; multi-day two, test five),
--                 one when it names none.
--   another sport one whole SAST day.
-- Generous on purpose, as the planner is: an end a little late costs a slot;
-- one too early puts two sides on one ground. The spellings are db/54's
-- free_hits_apply() list (DECLARATION_FORMATS) and the planner's FORMAT_DAYS
-- and FIFTY, lower-cased with the spaces closed up.
--
-- THE RULE. A fixture that counts (any status but postponed and abandoned)
-- on a ground may not overlap, as [start, end), another fixture that counts
-- on the same ground, on a ground that ground lies on (its field), or on one
-- that lies on it (its pitches). Two pitches of one field do not clash. It
-- is asked on an insert, and on an update that moves the fixture (its start,
-- ground, sport, format or overs) or brings it back into counting (a
-- postponed or abandoned fixture back on). A status moving along (scheduled
-- → live → complete) asks nothing, so a clash that was on record before this
-- file (the seed and the live data have none: db/99 §112 counts them) never
-- stops a match being scored. Bookings of one site are serialised by an
-- advisory lock on the top of its ground tree.
--
-- THE REFUSAL. SQLSTATE 23P01 (exclusion_violation), constraint
-- match_ground_clash, and the clash in words:
--   'U15A v Kearsney College is on No.1 Ground 10:00-13:00 on Sat 8 Nov'
--   'U15A v Kearsney College is on No.1 Ground from Sat 8 Nov 10:00 to Mon
--    10 Nov 00:00'                                   (a declaration match)
-- The sides are named only when the clashing fixture is the booking school's
-- own (home or away); another school's booking of the ground is "Another
-- school's fixture", so a refusal tells nobody what another school has
-- arranged. The API answers 409 ground_clash with these words as detail.
--
-- ── 3 · WHO IS TOLD ─────────────────────────────────────────────────
-- availability_ask_again() (db/65, as db/128 left it) is re-emitted with one
-- branch added before its body, and its trigger now fires on status too.
-- When the status moves to postponed or abandoned, or from postponed back to
-- scheduled, fixture_status_notices() writes one notice to each side that is
-- a team at a school on SCRBRD (the home side; the away side too when it is a
-- tenant), in NOTIFICATIONS.md's model (D2, D7 "the side"):
--   kind 'fixture', scope 'team' at the side's school and team,
--   required_capability fixture.read, subject the match, urgency medium
--   (pushed, held through a minor's quiet hours, a preference may mute it),
--   no subject_person_id, no recipient_id.
-- So the side's pupils, the guardians of its boys and its staff read it; a
-- family of another side and another school do not. Its words name the
-- teams, the ground and the time, never a child; and every push is a
-- pointer in any case ("SCRBRD · You have a new notice", push-api.mjs), so
-- nothing about the fixture reaches a lock screen. Both notices of a
-- postponement stand (decision 2: "told both times"). Back on with a new
-- date in the future, the existing body below also asks each answer again,
-- as any move of a fixture does.
--
-- Lifts (SCRBRD-124): a postponed fixture is off on the day it was set for,
-- so lift_fixture_moved() (db/76) voids its open offers as it does for an
-- abandoned one (one condition widened). New offers already need
-- 'scheduled' (db/70, db/76).
--
-- The planner (db/67) treats a postponed fixture as it does an abandoned one:
-- it holds no ground (planner_inputs_for(), two conditions widened). The
-- public home page's today list (db/82) lists a postponed fixture with its
-- status, as it lists an abandoned one (public_live_fixtures(), one list
-- widened); no child is on that page.
--
-- ── 4 · WHAT CHANGES ────────────────────────────────────────────────
--   match_status_check            + 'postponed'
--   + match (ground_id, starts_at) index, for the clash's lookup
--   + fixture_ends_at(timestamptz,text,text,integer)  STABLE, invoker
--   + match_fixture_rules()       BEFORE INSERT OR UPDATE trigger function:
--                                 the moves, then the clash. Definer.
--   + ball_event_not_postponed()  BEFORE INSERT trigger function. Definer.
--   + match_status_ends_scoring() AFTER UPDATE OF status trigger function:
--                                 the session ends on a postponement. Definer.
--   + fixture_status_notices(uuid,text,text)  invoker, the owner's alone:
--                                 called only from the trigger below
--   availability_ask_again()      re-emitted: + the status branch
--   trigger availability_ask_again  + OF status
--   scoring_claim(uuid,text)      re-emitted (db/132's body): + 'match_postponed'
--   + match_called_off_back_on()  AFTER UPDATE OF status trigger function:
--                                 abandoned → scheduled on the record. Definer.
--   audit_log(…)                  re-emitted (db/132's body): + the words of
--                                 'abandoned_back_on' and 'postponed'
--   scorebook_import_open(uuid)   re-emitted: + 'match_postponed'
--   lift_fixture_moved()          re-emitted: postponed voids as abandoned
--   planner_inputs_for(uuid,date,date)  re-emitted: postponed holds no ground
--   public_live_fixtures()        re-emitted: lists a postponed fixture
-- No table, column, capability, role or policy. The re-emitted bodies keep
-- their grants (CREATE OR REPLACE). The new definers pin their search_path,
-- are granted to scrbrd_app only and revoked from PUBLIC, anon,
-- authenticated and service_role (db/131's loop). A second paste changes
-- nothing: each re-emitted body is checked against the shipped one or this
-- file's.
--
-- Applied after db/132 (pilot audit fixes), whose scoring_claim() and
-- audit_log() it re-emits with one change each; the guard below reads
-- db/132's bodies.


-- ── 0 · What this file was written against ─────────────────────────
-- Each body this file re-emits, by the md5 of its source with whitespace
-- folded: the shipped one (was) or this file's (mine). A body moved by a
-- file since stops the paste; look before replacing it.
CREATE OR REPLACE FUNCTION pg_temp._v133_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regprocedure('sa_today()') IS NULL OR to_regprocedure('sa_date(timestamptz)') IS NULL
     OR to_regprocedure('fixture_side_label(uuid,text)') IS NULL
     OR to_regprocedure('availability_fixture_words(timestamptz,uuid,text,smallint)') IS NULL
     OR to_regprocedure('availability_fixture_moved(match_availability,match)') IS NULL
     OR to_regprocedure('person_is_pupil(uuid)') IS NULL
     OR to_regprocedure('lift_offer_end(uuid,text,text,uuid,boolean)') IS NULL
     OR to_regclass('scoring_session') IS NULL OR to_regclass('scoring_audit') IS NULL
     OR to_regprocedure('match_finished_stays_finished()') IS NULL THEN
    RAISE EXCEPTION 'db/133: sa_today(), sa_date() (db/128), fixture_side_label() (db/08), availability_fixture_words() or availability_fixture_moved() (db/65), person_is_pupil(), lift_offer_end() (db/70), the scoring session or match_finished_stays_finished() (db/132) is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('availability_ask_again()',            '116c945fb47b3151b165f5f62c831b97', '5ce73544ba0a617e3816bf916a92007d',      'db/128'),
      ('scoring_claim(uuid,text)',            'fdbb6a42742fb460c957ac767d0d40ad', '0232098222e37ae95038df4275919532',    'db/132'),
      ('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)', '8bea03eaac74fbfc54900f40c5d9e7f1', '4ff2375005bedd367c4bfea8463befca', 'db/132'),
      ('scorebook_import_open(uuid)',         '033ec24f91362fc0d0f2fc6496c6aed4', 'c20a52292e09d73b1cc06a7266cf646b',   'db/63'),
      ('lift_fixture_moved()',                'e5f40ac5c7cc1633e4132fefd1879c4f', '3f8f3ab007c087802f59f561588281f0',     'db/76'),
      ('planner_inputs_for(uuid,date,date)',  'b6638805a449436be26d15e5702bb97c', 'b4732d30f07157eb46f16d2b9b347eb2',  'db/67'),
      ('public_live_fixtures()',              'c811308c51609041842a7d08fdc48bad', '6aa12abde90e18205821fb4b78ef7d26',   'db/82'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/133: % (%) is not there to re-create', r.fn, r.src;
    END IF;
    v_md5 := pg_temp._v133_fold(v_src);
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/133: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
END $guard$;

-- One body, one change: `needle` must stand in it exactly `times` times, and
-- each becomes `repl`. Re-emitted through pg_get_functiondef(), so the
-- signature, options and grants stand; a body already this file's (`repl`
-- there, which the guard above has read as this file's) is left as it is.
CREATE OR REPLACE FUNCTION pg_temp._v133_patch(p_fn text, p_needle text, p_repl text, p_times integer) RETURNS void AS $$
DECLARE v_src text; v_n integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn::regprocedure;
  IF position(p_repl IN v_src) > 0 THEN RETURN; END IF;
  v_n := (length(v_src) - length(replace(v_src, p_needle, ''))) / length(p_needle);
  IF v_n <> p_times THEN
    RAISE EXCEPTION 'db/133: % holds its needle % times, not %: look before replacing it', p_fn, v_n, p_times;
  END IF;
  EXECUTE replace(pg_get_functiondef(p_fn::regprocedure), p_needle, p_repl);
END $$ LANGUAGE plpgsql;


-- ══════════════════════════════════════════════════════════════════
-- §1 · The status
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE match DROP CONSTRAINT IF EXISTS match_status_check;
ALTER TABLE match ADD CONSTRAINT match_status_check
  CHECK (status IN ('scheduled', 'live', 'complete', 'abandoned', 'postponed'));

CREATE INDEX IF NOT EXISTS match_ground_starts_idx ON match (ground_id, starts_at) WHERE ground_id IS NOT NULL;


-- ══════════════════════════════════════════════════════════════════
-- §2 · When a fixture ends (the planner's rule; see the header)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fixture_ends_at(p_starts timestamptz, p_sport text, p_format text, p_overs integer)
RETURNS timestamptz AS $$
  WITH f AS (SELECT lower(regexp_replace(btrim(coalesce(p_format, '')), '\s+', ' ', 'g')) AS s)
  SELECT CASE
    WHEN p_starts IS NULL THEN NULL
    -- Another sport: one whole SAST day.
    WHEN coalesce(p_sport, 'cricket') <> 'cricket' THEN
      ((sa_date(p_starts) + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg')
    -- A declaration format: whole SAST days, by the number in its name.
    WHEN f.s IN ('one-day declaration', 'one day declaration', 'declaration', 'timed', 'timed match',
                 'two-day', 'two day', 'three-day', 'three day', 'four-day', 'four day', 'five-day', 'five day',
                 'multi-day', 'multi day', 'test') THEN
      ((sa_date(p_starts) + CASE f.s WHEN 'two-day' THEN 2 WHEN 'two day' THEN 2 WHEN 'three-day' THEN 3 WHEN 'three day' THEN 3
                                     WHEN 'four-day' THEN 4 WHEN 'four day' THEN 4 WHEN 'five-day' THEN 5 WHEN 'five day' THEN 5
                                     WHEN 'multi-day' THEN 2 WHEN 'multi day' THEN 2 WHEN 'test' THEN 5 ELSE 1 END)
        ::timestamp AT TIME ZONE 'Africa/Johannesburg')
    -- Limited overs: two innings at four minutes an over, and the break.
    ELSE p_starts + make_interval(mins => 2 * 4 * CASE WHEN p_overs BETWEEN 1 AND 120 THEN p_overs
                                                       WHEN f.s IN ('one-day', 'one day', '50-over', '50 over', '50 overs') THEN 50
                                                       ELSE 20 END + 20)
  END FROM f
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION fixture_ends_at(timestamptz, text, text, integer) IS
  'db/133: when a fixture that records only its start is taken to end — the planner''s fixtureLength()/knownFixtureEnd() (packages/scoring/src/planner.mjs) in SQL. Limited overs: start + 8 minutes an over + 20; a declaration format: SAST midnight after its last day; another sport: SAST midnight after its day.';


-- ══════════════════════════════════════════════════════════════════
-- §3 · The moves, then the clash: one trigger, in that order
-- ══════════════════════════════════════════════════════════════════
-- One function so the order is the code's, not the trigger names': a new
-- date on a postponed fixture puts it back to scheduled first, and is then
-- held to the ground like any booking.
CREATE OR REPLACE FUNCTION match_fixture_rules() RETURNS trigger AS $$
DECLARE
  v_end    timestamptz;
  v_root   uuid;
  v_near   uuid[];
  c        record;
  v_label  text;
  v_ground text;
  v_cend   timestamptz;
BEGIN
  -- ── The moves (§1 of the header) ──
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'postponed' AND NEW.status = 'postponed' AND NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
      NEW.status := 'scheduled';                  -- a new date puts it back on (decision 2)
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'postponed' THEN
        IF OLD.status <> 'scheduled' THEN
          RAISE EXCEPTION 'Only a fixture still to be played is postponed; this one is %.', OLD.status
            USING ERRCODE = 'check_violation', CONSTRAINT = 'match_status_transition';
        END IF;
        IF EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = NEW.id) THEN
          RAISE EXCEPTION 'This fixture has been scored, so it was played: call it off (abandoned) rather than postpone it.'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'match_status_transition';
        END IF;
      ELSIF OLD.status = 'postponed' THEN
        IF NEW.status = 'scheduled' THEN
          IF NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at THEN
            RAISE EXCEPTION 'A postponed fixture goes back on with a new date.'
              USING ERRCODE = 'check_violation', CONSTRAINT = 'match_status_transition';
          END IF;
        ELSIF NEW.status <> 'abandoned' THEN
          RAISE EXCEPTION 'A postponed fixture is given a new date or called off; it is not marked %.', NEW.status
            USING ERRCODE = 'check_violation', CONSTRAINT = 'match_status_transition';
        END IF;
      ELSIF OLD.status = 'abandoned' AND NEW.status <> 'scheduled' THEN
        -- Kameel, 4 Nov 2026: a match called off by mistake goes back on, to
        -- scheduled, and that is on the record (match_called_off_back_on());
        -- it is never put straight back to live or complete.
        RAISE EXCEPTION 'A match called off is only put back on (scheduled); it is not marked %.', NEW.status
          USING ERRCODE = 'check_violation', CONSTRAINT = 'match_status_transition';
      END IF;
    END IF;
  END IF;

  -- ── The clash (§2 of the header) ──
  IF NEW.ground_id IS NULL OR NEW.status IN ('postponed', 'abandoned') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status NOT IN ('postponed', 'abandoned')
     AND (OLD.starts_at, OLD.ground_id, OLD.sport, OLD.format, OLD.overs)
         IS NOT DISTINCT FROM (NEW.starts_at, NEW.ground_id, NEW.sport, NEW.format, NEW.overs) THEN
    RETURN NEW;                                   -- not moved, and it counted already
  END IF;

  -- The top of the ground's tree: one site's bookings, one at a time.
  WITH RECURSIVE up (id, parent_id, depth) AS (
    SELECT g.id, g.parent_id, 0 FROM ground g WHERE g.id = NEW.ground_id
    UNION ALL
    SELECT g.id, g.parent_id, u.depth + 1 FROM ground g JOIN up u ON g.id = u.parent_id WHERE u.depth < 16
  )
  SELECT u.id INTO v_root FROM up u ORDER BY u.depth DESC LIMIT 1;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.match_ground'), hashtext(coalesce(v_root, NEW.ground_id)::text));

  -- The grounds a booking here clashes with: this one, those it lies on, and
  -- those that lie on it. Not its siblings.
  WITH RECURSIVE up (id, parent_id, depth) AS (
    SELECT g.id, g.parent_id, 0 FROM ground g WHERE g.id = NEW.ground_id
    UNION ALL
    SELECT g.id, g.parent_id, u.depth + 1 FROM ground g JOIN up u ON g.id = u.parent_id WHERE u.depth < 16
  ), down (id, depth) AS (
    SELECT NEW.ground_id, 0
    UNION ALL
    SELECT g.id, d.depth + 1 FROM ground g JOIN down d ON g.parent_id = d.id WHERE d.depth < 16
  )
  SELECT array_agg(DISTINCT x.id) INTO v_near FROM (SELECT id FROM up UNION SELECT id FROM down) x;

  v_end := fixture_ends_at(NEW.starts_at, NEW.sport, NEW.format, NEW.overs);
  -- No fixture lasts more than five days (a test), so nothing that starts
  -- six days before this one can still be on.
  SELECT m.id, m.school_id, m.team_code, m.away_school_id, m.opponent, m.starts_at, m.ground_id,
         m.sport, m.format, m.overs
    INTO c
    FROM match m
   WHERE m.ground_id = ANY (v_near)
     AND m.id IS DISTINCT FROM NEW.id
     AND m.status NOT IN ('postponed', 'abandoned')
     AND m.starts_at < v_end
     AND m.starts_at > NEW.starts_at - interval '6 days'
     AND fixture_ends_at(m.starts_at, m.sport, m.format, m.overs) > NEW.starts_at
   ORDER BY m.starts_at, m.id
   LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_label := CASE WHEN c.school_id = NEW.school_id THEN coalesce(c.team_code, 'A fixture') || ' v ' || c.opponent
                  WHEN c.away_school_id IS NOT DISTINCT FROM NEW.school_id
                    THEN coalesce(fixture_side_label(c.school_id, c.team_code), 'A fixture') || ' v ' || c.opponent
                  ELSE 'Another school''s fixture' END;
  SELECT g.name INTO v_ground FROM ground g WHERE g.id = c.ground_id;
  v_cend := fixture_ends_at(c.starts_at, c.sport, c.format, c.overs);
  RAISE EXCEPTION '%', CASE
      WHEN sa_date(c.starts_at) = sa_date(v_cend - interval '1 second') THEN
        format('%s is on %s %s-%s on %s', v_label, coalesce(v_ground, 'that ground'),
               to_char(c.starts_at AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI'),
               to_char(v_cend AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI'),
               to_char(c.starts_at AT TIME ZONE 'Africa/Johannesburg', 'Dy FMDD Mon'))
      ELSE
        format('%s is on %s from %s to %s', v_label, coalesce(v_ground, 'that ground'),
               to_char(c.starts_at AT TIME ZONE 'Africa/Johannesburg', 'Dy FMDD Mon HH24:MI'),
               to_char(v_cend AT TIME ZONE 'Africa/Johannesburg', 'Dy FMDD Mon HH24:MI'))
    END
    USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'match_ground_clash';
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS match_fixture_rules ON match;
CREATE TRIGGER match_fixture_rules
  BEFORE INSERT OR UPDATE OF starts_at, ground_id, sport, format, overs, status ON match
  FOR EACH ROW EXECUTE FUNCTION match_fixture_rules();


-- ══════════════════════════════════════════════════════════════════
-- §4 · A postponed match is not scored
-- ══════════════════════════════════════════════════════════════════
-- Whoever writes the ball: the pad through RLS, or a definer (the importer's
-- confirm). One primary-key read a ball, as ball_event_is_cricket's (db/08).
CREATE OR REPLACE FUNCTION ball_event_not_postponed() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = NEW.match_id AND m.status = 'postponed') THEN
    RAISE EXCEPTION 'This match is postponed: it is scored once it has a new date.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'match_postponed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS ball_event_not_postponed ON ball_event;
CREATE TRIGGER ball_event_not_postponed BEFORE INSERT ON ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_not_postponed();

-- Postponing ends the session: nobody holds the token of a match that is not
-- being played, so a pad that held it sends its balls to quarantine and a
-- claim is refused (below). Audited, as a force release is (db/02).
CREATE OR REPLACE FUNCTION match_status_ends_scoring() RETURNS trigger AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  SELECT * INTO s FROM scoring_session WHERE match_id = NEW.id FOR UPDATE;
  IF NOT FOUND OR s.state = 'idle' THEN RETURN NULL; END IF;
  UPDATE scoring_session SET state = 'idle', epoch = s.epoch + 1, holder_user_id = NULL,
    holder_device = NULL, lease_until = NULL, handover_code = NULL, handover_to = NULL,
    claimant_user_id = NULL, claimant_device = NULL, updated_at = now()
   WHERE match_id = NEW.id;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, epoch)
  VALUES (NEW.id, NEW.school_id, 'postponed', app_user_id(), s.holder_user_id, s.epoch + 1);
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS match_status_ends_scoring ON match;
CREATE TRIGGER match_status_ends_scoring AFTER UPDATE OF status ON match
  FOR EACH ROW WHEN (NEW.status = 'postponed' AND OLD.status IS DISTINCT FROM 'postponed')
  EXECUTE FUNCTION match_status_ends_scoring();

-- A match called off, put back on (Kameel, 4 Nov 2026): on the record, by
-- whom, at which ball, as db/132's finished_match_abandoned is. audit_log()
-- words it "Put a called-off match back on" (§5 below).
CREATE OR REPLACE FUNCTION match_called_off_back_on() RETURNS trigger AS $$
BEGIN
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, detail)
  VALUES (NEW.id, NEW.school_id, 'abandoned_back_on', app_user_id(),
          jsonb_build_object('from', OLD.status, 'to', NEW.status, 'startsAt', NEW.starts_at,
                             'headSeq', coalesce((SELECT max(b.seq) FROM ball_event b WHERE b.match_id = NEW.id), 0)));
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS match_called_off_back_on ON match;
CREATE TRIGGER match_called_off_back_on AFTER UPDATE OF status ON match
  FOR EACH ROW WHEN (OLD.status = 'abandoned' AND NEW.status = 'scheduled')
  EXECUTE FUNCTION match_called_off_back_on();

-- scoring_claim() (db/126): refused on a postponed match, as on a complete one.
SELECT pg_temp._v133_patch('scoring_claim(uuid,text)',
'  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF NOT FOUND THEN',
'  -- A postponed match is not played until it has a new date (db/133).
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = ''postponed'')
    THEN RETURN QUERY SELECT false,''match_postponed'',
                             (SELECT x.epoch FROM scoring_session x WHERE x.match_id = p_match);
         RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF NOT FOUND THEN', 1);

-- scorebook_import_open() (db/63): nothing to import for a postponed match.
SELECT pg_temp._v133_patch('scorebook_import_open(uuid)',
'  IF m.status = ''abandoned'' THEN RETURN QUERY SELECT false, ''match_abandoned'', NULL::text, NULL::uuid; RETURN; END IF;',
'  IF m.status = ''abandoned'' THEN RETURN QUERY SELECT false, ''match_abandoned'', NULL::text, NULL::uuid; RETURN; END IF;
  -- db/133: a postponed match has not been played.
  IF m.status = ''postponed'' THEN RETURN QUERY SELECT false, ''match_postponed'', NULL::text, NULL::uuid; RETURN; END IF;', 1);


-- ══════════════════════════════════════════════════════════════════
-- §5 · Lifts, the planner and the public list read 'postponed'
-- ══════════════════════════════════════════════════════════════════
SELECT pg_temp._v133_patch('lift_fixture_moved()',
'  IF NEW.status = ''abandoned'' AND OLD.status IS DISTINCT FROM ''abandoned'' THEN',
'  -- db/133: a postponed fixture is off on its day, as an abandoned one is.
  IF NEW.status IN (''abandoned'', ''postponed'') AND OLD.status NOT IN (''abandoned'', ''postponed'') THEN', 1);

SELECT pg_temp._v133_patch('planner_inputs_for(uuid,date,date)',
  'm.status <> ''abandoned''', 'm.status NOT IN (''abandoned'', ''postponed'')', 2);

SELECT pg_temp._v133_patch('public_live_fixtures()',
  'AND m.status IN (''scheduled'', ''live'', ''complete'', ''abandoned'')',
  'AND m.status IN (''scheduled'', ''live'', ''complete'', ''abandoned'', ''postponed'')', 1);

-- audit_log() (db/132): the two scoring_audit events this file writes, in words.
SELECT pg_temp._v133_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
'                 WHEN ''finished_match_abandoned'' THEN ''Called off a finished match''   -- db/132',
'                 WHEN ''finished_match_abandoned'' THEN ''Called off a finished match''   -- db/132
                 WHEN ''abandoned_back_on''        THEN ''Put a called-off match back on''   -- db/133
                 WHEN ''postponed''                THEN ''Postponed the match: the pen was put down''   -- db/133', 1);


-- ══════════════════════════════════════════════════════════════════
-- §6 · Who is told
-- ══════════════════════════════════════════════════════════════════
/**
 * The side's notice of a status move: postponed, abandoned, or postponed →
 * scheduled ("back on"). One row per side that is a team at a school on
 * SCRBRD, in the side's shape (NOTIFICATIONS.md D7): its pupils, its boys'
 * guardians and its staff read it through fixture.read at that team; no
 * person is named on it or addressed by it. Invoker: called from
 * availability_ask_again(), a definer, and from nowhere else.
 */
CREATE OR REPLACE FUNCTION fixture_status_notices(p_match uuid, p_was text, p_now text) RETURNS integer AS $$
DECLARE
  m       match%ROWTYPE;
  v_home  text;
  v_away  text;
  v_when  text;
  v_where text;
  v_title text;
  v_body  text;
  v_life  timestamptz;
  n       integer := 0;
  t       record;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_when  := to_char(m.starts_at AT TIME ZONE 'Africa/Johannesburg', 'Dy FMDD Mon "at" HH24:MI');
  v_where := coalesce(' at ' || (SELECT g.name FROM ground g WHERE g.id = m.ground_id), '');
  FOR t IN SELECT x.school, x.team, x.home FROM (VALUES (m.school_id, m.team_code, true), (m.away_school_id, m.away_team_code, false)) x(school, team, home)
            WHERE x.school IS NOT NULL
              AND x.team ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?|([1-9]|1[0-9]|20)XI)$' LOOP
    -- The fixture as this side's families know it: their own team, then the other.
    IF t.home THEN
      v_home := t.team;
      v_away := m.opponent;
    ELSE
      v_home := t.team;
      v_away := coalesce(fixture_side_label(m.school_id, m.team_code), m.opponent);
    END IF;
    IF p_now = 'postponed' THEN
      v_title := 'Postponed · ' || v_home || ' v ' || v_away;
      v_body  := v_home || ' v ' || v_away || ', set for ' || v_when || v_where
                 || ', is postponed. It stays on the calendar and will be played on a new date; you will be told when it has one.';
      v_life  := now() + interval '30 days';
    ELSIF p_now = 'abandoned' THEN
      v_title := 'Called off · ' || v_home || ' v ' || v_away;
      v_body  := v_home || ' v ' || v_away || ' (' || to_char(m.starts_at AT TIME ZONE 'Africa/Johannesburg', 'Dy FMDD Mon')
                 || ') is called off' || CASE WHEN p_was = 'postponed' THEN ' and will not be replayed.' ELSE '.' END;
      v_life  := greatest(m.starts_at, now()) + interval '7 days';
    ELSE
      v_title := 'Back on · ' || v_home || ' v ' || v_away;
      v_body  := v_home || ' v ' || v_away || CASE WHEN p_was = 'abandoned' THEN ', called off, ' ELSE ', postponed, ' END
                 || 'is back on: ' || v_when || v_where || '.';
      v_life  := greatest(m.starts_at, now()) + interval '7 days';
    END IF;
    INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                              required_capability, is_public, subject_kind, subject_id, expires_at)
    VALUES (t.school, t.team, 'team', 'fixture', 'medium', v_title, v_body, 'fixture.read', false, 'match', m.id, v_life);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION fixture_status_notices(uuid, text, text) FROM PUBLIC;
COMMENT ON FUNCTION fixture_status_notices(uuid, text, text) IS
  'db/133 (pilot item 2; Kameel, 4 Nov 2026): the side''s notice that its fixture is postponed, called off or back on — kind fixture, team scope, fixture.read, medium, no person named or addressed. Called only from availability_ask_again().';

-- db/65's availability_ask_again(), as db/128 left it, with the status branch
-- before its body. The body is unchanged, word for word.
CREATE OR REPLACE FUNCTION availability_ask_again() RETURNS trigger AS $$
DECLARE
  a        match_availability%ROWTYPE;
  v_name   text;
  v_now    text := availability_fixture_words(NEW.starts_at, NEW.ground_id, NEW.format, NEW.overs);
  v_was    text;
  r        uuid;
BEGIN
  -- db/133: postponed, called off, or back on (from either): the side is told.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status IN ('postponed', 'abandoned') OR (OLD.status IN ('postponed', 'abandoned') AND NEW.status = 'scheduled')) THEN
    PERFORM fixture_status_notices(NEW.id, OLD.status, NEW.status);
  END IF;
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
         AND (ra.valid_from  IS NULL OR ra.valid_from  <= sa_today())
         AND (ra.valid_until IS NULL OR ra.valid_until >  sa_today())
         AND s.player_id = a.player_id AND s.verification_state = 'verified'
         AND s.valid_from <= sa_today()
         AND (s.valid_until IS NULL OR s.valid_until > sa_today())
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
CREATE TRIGGER availability_ask_again AFTER UPDATE OF starts_at, ground_id, format, overs, status ON match
  FOR EACH ROW
  WHEN ((OLD.starts_at, OLD.ground_id, OLD.format, OLD.overs, OLD.status)
        IS DISTINCT FROM (NEW.starts_at, NEW.ground_id, NEW.format, NEW.overs, NEW.status))
  EXECUTE FUNCTION availability_ask_again();


-- ══════════════════════════════════════════════════════════════════
-- §7 · Who may call the new functions
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['match_fixture_rules()', 'ball_event_not_postponed()', 'match_status_ends_scoring()',
                           'match_called_off_back_on()',
                           'fixture_ends_at(timestamptz,text,text,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  -- The notice writer is the owner's alone: nothing but the trigger calls it.
  FOREACH r IN ARRAY ARRAY['scrbrd_app', 'anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION fixture_status_notices(uuid,text,text) FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
-- §8 · Check what this file left
-- ══════════════════════════════════════════════════════════════════
DO $check$
DECLARE r record; v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('availability_ask_again()', '5ce73544ba0a617e3816bf916a92007d'), ('scoring_claim(uuid,text)', '0232098222e37ae95038df4275919532'),
      ('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)', '4ff2375005bedd367c4bfea8463befca'),
      ('scorebook_import_open(uuid)', 'c20a52292e09d73b1cc06a7266cf646b'), ('lift_fixture_moved()', '3f8f3ab007c087802f59f561588281f0'),
      ('planner_inputs_for(uuid,date,date)', 'b4732d30f07157eb46f16d2b9b347eb2'), ('public_live_fixtures()', '6aa12abde90e18205821fb4b78ef7d26')) x(fn, mine)
  LOOP
    v_md5 := pg_temp._v133_fold((SELECT prosrc FROM pg_proc WHERE oid = r.fn::regprocedure));
    IF v_md5 <> r.mine THEN
      RAISE EXCEPTION 'db/133: % is not this file''s after the paste (md5 %)', r.fn, v_md5;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
        ('match_fixture_rules', 'ball_event_not_postponed', 'match_status_ends_scoring', 'match_called_off_back_on',
         'availability_ask_again')) <> 5 THEN
    RAISE EXCEPTION 'db/133: its five triggers are not all in place';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'match_fixture_rules()'::regprocedure AND prosecdef
                   AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}')))
     OR has_function_privilege('public', 'match_fixture_rules()', 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'fixture_status_notices(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/133: a definer is not pinned, or a grant is wider than this file says';
  END IF;
END $check$;

DROP FUNCTION pg_temp._v133_patch(text, text, text, integer);
DROP FUNCTION pg_temp._v133_fold(text);

-- ══════════════════════════════════════════════════════════════════
--  170 · Pro mode per fixture: a coach asks, before the match, for the
--        pad to record the shot and the field on every ball
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The redesign's question 1 (Kameel, as recommended): runs
-- first, one tap a ball. The shot and where it went are optional, or "Pro
-- mode", which a coach asks for per fixture. Slice 3 made one tap the pad's
-- default: a fixture that declares nothing opens its first innings declared
-- quick. This file is the declaration a fixture carries: the capture profile
-- its coach asked for, stored on the fixture, which the pad reads at the
-- toss (or when an unscored fixture opens) and writes as the first
-- innings_start's capture profile, the event it has always written. Nothing
-- in the scoring log, the replay, offline or the handover changes; the
-- declaration rides the innings_start exactly as a scorer's choice on the
-- openers sheet always has, and the scorer may still change it there before
-- the first ball (the latest declaration stands, db/07).
--
-- WHAT IT CHANGES ON A LIVE DATABASE (production holds test data only)
--   column match.capture_profile: new, nullable. NULL (every fixture today)
--     is "nothing asked": the pad declares quick. 'full' is Pro mode. The
--     CHECK match_capture_profile is ball_event's own vocabulary (db/07:
--     full, standard, quick), so whatever the fixture asks is a declaration
--     the log already accepts. Read under match's own row security
--     (match_read, db/106): whoever reads the fixture reads how it is to be
--     scored. Written by fixture.update holders under match_update (db/09)
--     as every match column is, and by the definer below.
--   function match_capture_request(uuid, text) → (ok, reason): new; a
--     pinned SECURITY DEFINER, executable by scrbrd_app alone. The coach's
--     door: the fixture's coach does not hold fixture.update (db/130, db/165
--     say so), so match_update refuses him the column. In order:
--       1. signed in, and at the HOME side (match_school, match_team) holds
--          team.select (the coach and the team manager who pick its side;
--          Kameel, 20 Nov: the team manager too)
--          or fixture.update (the office: director of sport, sports admin);
--          else not_permitted. An unknown fixture says the same. The away
--          school's coach, a scorer, a parent, a coach of another side: no.
--          A pad credential's app_can() admits neither (db/50).
--       2. a profile outside the vocabulary: capture_profile_unknown.
--       3. the toss is in (a match_toss row) or the fixture has a log (any
--          ball_event row: the toss's innings_start is where the pad
--          declares): scoring_started.
--       4. the same as stored: (true, unchanged), nothing written.
--       Then the one column, by an UPDATE of the table: (true, set).
--   function match_capture_profile_frozen(), trigger
--     match_capture_profile_frozen BEFORE UPDATE OF capture_profile ON match:
--     new; a pinned definer, executable by scrbrd_app alone. Once the toss
--     is in or the fixture has a log, its capture profile is not changed by
--     anybody (the office's plain UPDATE, a definer, the owner): the pad
--     reads the request fresh as it declares at the toss (engine.jsx), and a
--     request after it would say something the innings does not. Refused
--     as check_violation, constraint match_capture_profile_scored. Only a
--     change of capture_profile is asked; every other column of a scored
--     fixture moves as it did.
--   The column is what was ASKED, never what was declared: the log's
--   innings_start is the declaration, and the scorer may change it on the
--   openers sheet before the first ball.
--   No audit row: like a reschedule (fixtures.amend), a request is not
--   audited; the declaration the pad writes is in the log, with its scorer.
-- No table, policy, capability or role; no shipped function body is
-- re-emitted; packages/policy is unchanged. A second paste changes nothing.
--
-- PASTE WITH NO MATCH LIVE. ADD COLUMN and ADD CONSTRAINT take ACCESS
-- EXCLUSIVE on match until the paste commits; while it waits (lock_timeout,
-- ten seconds) every read of match queues behind it, and a live pad's sync
-- stalls for up to ten seconds and then retries. Between matches.

-- Its proof is db/99 §145; the walks are smoke-browser-padfeel (a fixture
-- with Pro mode opens asking the shot and the field; one without opens on
-- one tap) and smoke-browser-fixture-create.
-- Does not depend on db/169 (Migration B); only its place in
-- services/api/expected-migrations.json follows 169's.

DO $guard$
BEGIN
  IF to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('app_user_id()') IS NULL
     OR to_regprocedure('match_school(uuid)') IS NULL OR to_regprocedure('match_team(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/170 needs app_can(), app_user_id(), match_school() and match_team() (db/02, db/09): paste them first';
  END IF;
  IF to_regclass('public.ball_event') IS NULL OR to_regclass('public.match_toss') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ball_event_capture_profile') THEN
    RAISE EXCEPTION 'db/170 needs ball_event and its capture profile (db/07) and match_toss (db/02): paste them first';
  END IF;
  IF to_regprocedure('api_role_reach(name)') IS NULL THEN
    RAISE EXCEPTION 'db/170 needs db/157 (api_role_reach): paste it first';
  END IF;
END $guard$;

-- ── 0 · Ten seconds for a lock, or nothing (db/158, db/165, db/167) ──
SET lock_timeout = '10s';


-- ══════════════════════════════════════════════════════════════════
-- §1 · The fixture's request
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE match ADD COLUMN IF NOT EXISTS capture_profile text;
ALTER TABLE match DROP CONSTRAINT IF EXISTS match_capture_profile;
ALTER TABLE match ADD CONSTRAINT match_capture_profile
  CHECK (capture_profile IS NULL OR capture_profile IN ('full', 'standard', 'quick'));
COMMENT ON COLUMN match.capture_profile IS
  'What the fixture ASKED the pad to declare at the toss (db/170): full is Pro mode, NULL asks nothing (the pad declares quick). Never what was declared: that is the innings_start in ball_event.';


-- ══════════════════════════════════════════════════════════════════
-- §2 · Fixed from the toss
-- ══════════════════════════════════════════════════════════════════
/**
 * A fixture whose toss is in, or with a log, keeps the capture profile it
 * had: the pad declares it on the first innings_start, from the request as it
 * reads it at the toss, and a later request would say something the innings
 * does not. For every caller, the owner and a definer included.
 */
CREATE OR REPLACE FUNCTION match_capture_profile_frozen() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM match_toss t WHERE t.match_id = NEW.id)
     OR EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = NEW.id) THEN
    RAISE EXCEPTION 'The toss is in on this fixture, so how it is scored is the scorer''s now: the innings declares it.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'match_capture_profile_scored';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER match_capture_profile_frozen BEFORE UPDATE OF capture_profile ON match
  FOR EACH ROW WHEN (OLD.capture_profile IS DISTINCT FROM NEW.capture_profile)
  EXECUTE FUNCTION match_capture_profile_frozen();


-- ══════════════════════════════════════════════════════════════════
-- §3 · The coach's door
-- ══════════════════════════════════════════════════════════════════
/**
 * The fixture's coach (team.select at the home side) or the office
 * (fixture.update there) asks for a capture profile, or clears it with NULL.
 * (ok, reason): not_permitted · capture_profile_unknown · scoring_started ·
 * unchanged · set.
 */
CREATE OR REPLACE FUNCTION match_capture_request(p_match uuid, p_profile text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  m match%ROWTYPE;
BEGIN
  -- 1. Who, asked before anything is locked or read: a caller who may not
  --    ask learns nothing, not even that the fixture exists.
  --    team.select, so the side's team manager asks as its coach does
  --    (Kameel, 20 Nov: the team manager too); fixture.update, the office.
  IF app_user_id() IS NULL OR p_match IS NULL
     OR NOT (coalesce(app_can('team.select', match_school(p_match), match_team(p_match), NULL, p_match), false)
             OR coalesce(app_can('fixture.update', match_school(p_match), match_team(p_match), NULL, p_match), false)) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  -- 2. The log's own vocabulary, or nothing asked.
  IF p_profile IS NOT NULL AND p_profile NOT IN ('full', 'standard', 'quick') THEN
    RETURN QUERY SELECT false, 'capture_profile_unknown'::text; RETURN;
  END IF;
  SELECT * INTO m FROM match x WHERE x.id = p_match FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_permitted'::text; RETURN; END IF;
  -- 3. The toss is in, or the pad has declared (the trigger refuses it too;
  --    said here as a code).
  IF EXISTS (SELECT 1 FROM match_toss t WHERE t.match_id = p_match)
     OR EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = p_match) THEN
    RETURN QUERY SELECT false, 'scoring_started'::text; RETURN;
  END IF;
  -- 4. Asked already.
  IF m.capture_profile IS NOT DISTINCT FROM p_profile THEN
    RETURN QUERY SELECT true, 'unchanged'::text; RETURN;
  END IF;
  UPDATE match SET capture_profile = p_profile WHERE id = p_match;
  RETURN QUERY SELECT true, 'set'::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §4 · Who may call these: the application, and nobody else
-- ══════════════════════════════════════════════════════════════════
-- A managed host's API roles get EXECUTE on every new function by default
-- privilege, directly and not through PUBLIC, so it is taken back (db/125).
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['match_capture_request(uuid,text)', 'match_capture_profile_frozen()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ── 5 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'match'::regclass AND attname = 'capture_profile'
                    AND NOT attisdropped AND atttypid = 'text'::regtype AND NOT attnotnull) THEN
    RAISE EXCEPTION 'db/170: match.capture_profile is not a nullable text column';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v FROM pg_constraint c
   WHERE c.conrelid = 'match'::regclass AND c.conname = 'match_capture_profile';
  IF v IS DISTINCT FROM pg_get_constraintdef((SELECT c.oid FROM pg_constraint c
                          WHERE c.conrelid = 'ball_event'::regclass AND c.conname = 'ball_event_capture_profile')) THEN
    RAISE EXCEPTION 'db/170: match_capture_profile is % (wanted ball_event''s own vocabulary)', coalesce(v, '(missing)');
  END IF;
  SELECT pg_get_triggerdef(t.oid) INTO v FROM pg_trigger t
   WHERE t.tgrelid = 'match'::regclass AND t.tgname = 'match_capture_profile_frozen' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF v IS DISTINCT FROM 'CREATE TRIGGER match_capture_profile_frozen BEFORE UPDATE OF capture_profile ON public.match FOR EACH ROW WHEN ((old.capture_profile IS DISTINCT FROM new.capture_profile)) EXECUTE FUNCTION match_capture_profile_frozen()' THEN
    RAISE EXCEPTION 'db/170: match_capture_profile_frozen is %', coalesce(v, '(missing or disabled)');
  END IF;
  FOR v IN SELECT f FROM unnest(ARRAY['match_capture_request(uuid,text)', 'match_capture_profile_frozen()']) f
            WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f::regprocedure AND p.prosecdef
                                AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) LOOP
    RAISE EXCEPTION 'db/170: % is not a definer with a pinned search_path', v;
  END LOOP;
  -- The grants, read from the ACL: scrbrd_app's EXECUTE beside the owner's, nothing else.
  FOR v IN SELECT f FROM unnest(ARRAY['match_capture_request(uuid,text)', 'match_capture_profile_frozen()']) f
            WHERE (SELECT string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',')
                     FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                    WHERE p.oid = f::regprocedure AND x.grantee <> p.proowner) IS DISTINCT FROM 'scrbrd_app:EXECUTE' LOOP
    RAISE EXCEPTION 'db/170: % is not granted to scrbrd_app alone', v;
  END LOOP;
  IF EXISTS (SELECT 1 FROM api_role_reach('public') x WHERE x ~ 'match_capture_(request|profile_frozen)\(') THEN
    RAISE EXCEPTION 'db/170: PUBLIC reaches one of db/170''s functions';
  END IF;
  -- Fixed from the toss as well as the log, in the trigger and the door.
  IF position('match_toss' IN (SELECT prosrc FROM pg_proc WHERE oid = 'match_capture_profile_frozen()'::regprocedure)) = 0
     OR position('match_toss' IN (SELECT prosrc FROM pg_proc WHERE oid = 'match_capture_request(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/170: the request is not fixed from the toss';
  END IF;
  -- The door asks at the home side, both capabilities, before it locks.
  SELECT prosrc INTO v FROM pg_proc WHERE oid = 'match_capture_request(uuid,text)'::regprocedure;
  IF position('app_can(''team.select'', match_school(p_match), match_team(p_match), NULL, p_match)' IN v) = 0
     OR position('app_can(''fixture.update'', match_school(p_match), match_team(p_match), NULL, p_match)' IN v) = 0
     OR position('app_can(' IN v) > position('FOR UPDATE' IN v)
     OR v ~ 'away_(school_id|team_code)' THEN
    RAISE EXCEPTION 'db/170: match_capture_request() does not ask team.select or fixture.update at the home side before it locks';
  END IF;
END $check$;


-- ── 6 · The lock limit back as it was: a pooled connection is handed back as it came ──
RESET lock_timeout;

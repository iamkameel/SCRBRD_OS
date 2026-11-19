-- ══════════════════════════════════════════════════════════════════
--  165 · A fixture is live from its first ball
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The match-day bug of 18 Nov 2026: a scored fixture never
-- went 'live'. Nothing in production moved a fixture scheduled → live. The
-- scorer and the coach do not hold fixture.update, so match_update (db/09)
-- refuses them the column (db/130's header says so), and no trigger or
-- definer did it for them. So the public page never polled, the Board never
-- showed play, and the side's Matches said "Upcoming" all afternoon.
--
-- THE RULE. No person sets live; the log does. docs/design/PUBLIC_BY_TERMS.md
-- §81: "'While play is on' is the fixture's own status: from the first event
-- until the match is completed." ROLE_DASHBOARDS_v1.1 §5: "Never infer a
-- match is live solely from the clock; use authoritative fixture/event
-- state." db/155's public names already read a scheduled match that has
-- balls as live (Fable SF-3); the status was the one reader left behind.
-- So neither the toss, nor a claim, nor the start time makes a fixture
-- live. The first DELIVERY the server accepts into ball_event does: a row of
-- kind 'ball', a wide or a no-ball included. Not the setup the pad sends the
-- moment the toss is confirmed (innings_start with the squads, the openers,
-- the bowler), which can be half an hour before play and is the pre-match
-- line-up (ROLE_DASHBOARDS §5: "Scorer: toss/line-up" before live). So
-- PUBLIC_BY_TERMS's "first event" is read as the first ball. The scorebook
-- importer writes no ball rows (innings_start, innings_summary and
-- innings_end, db/63), so an imported fixture goes scheduled → complete in
-- its commit and never reads live.
--
-- WHAT THIS FILE DOES.
--   1. match_live_on_first_event(), a statement-level AFTER INSERT trigger
--      on ball_event, as the definer with its search_path pinned. It moves
--      every fixture the statement wrote a delivery to that is still
--      'scheduled' to 'live'. Only from 'scheduled': never from 'postponed' (db/133's
--      BEFORE trigger refuses the ball there anyway), 'abandoned' or
--      'complete'. The ball is the act; nobody is given the column, no
--      capability is added and packages/policy is unchanged.
--   1b. Kameel, 18 Nov 2026: "Refuse it once there are balls." live →
--      scheduled is refused for a fixture with a ball in its log, for every
--      caller (section 1b below). Balls only, as the trigger counts them: a
--      fixture set live after the toss with no ball bowled may go back.
--   2. A backfill, match_live_backfill(): a scheduled fixture that already
--      has a delivery in its log is in play, so it becomes live. The paste prints the count
--      before and after, and refuses to commit if one is left.
--
-- WHAT IT DOES NOT DO. A ball reaches ball_event through the lease
-- (events-api.mjs, scoring_lease_check), a supervisor's release from
-- quarantine (quarantine_resolve, which makes a scheduled fixture live, as
-- it should) or an approved amendment (a finished match: nothing to move);
-- a quarantined ball goes to ball_event_quarantine and moves nothing. The
-- trigger writes no notice and no audit row: the
-- first ball is its own record. Every trigger on match that fires on a
-- status change was read for → live (LIFECYCLE_DIAGNOSIS §5.1):
-- availability_ask_again returns early unless the new status is scheduled,
-- postponed or abandoned; lift_fixture_moved reacts to abandoned or
-- scheduled; pad_resume_ends_with_match, match_milestone_verified,
-- match_record_notice and match_completion_gate to complete;
-- match_status_ends_scoring to postponed; match_result_confirmation_lapse has
-- no confirmation to lapse on a live match; match_fixture_rules asks nothing
-- of a status moving along; public_data_changed tells the public read's cache
-- to read again, which is the point. db/99 §143 counts the notices.
-- Locking: the ball's foreign key holds FOR KEY SHARE on the match row, the
-- UPDATE takes FOR NO KEY UPDATE, and the two do not conflict; after the
-- first ball the UPDATE matches no row and takes no lock.
--
-- WHO MAY CALL THEM. db/157's rule: REVOKE ALL FROM PUBLIC, then EXECUTE to
-- scrbrd_app by name on the trigger's function (which cannot be called
-- directly in any case), nothing to the managed host's three API roles. The
-- backfill is the owner's alone.
--
-- THE PASTE'S LOCKS (review S1, 19 Nov 2026). CREATE OR REPLACE TRIGGER
-- (db/109, db/110, db/113) takes SHARE ROW EXCLUSIVE on ball_event and
-- match: writes pause for a moment, reads never wait. And no lock is waited
-- on for more than ten seconds (section 0): a paste that cannot get one
-- stops; paste it again.
--
-- Safe to run twice: CREATE OR REPLACE throughout, and a backfill that finds
-- nothing the second time; pasted over the first cut of this file (DROP and
-- CREATE of the same triggers) it replaces them in place. No BEGIN or
-- COMMIT: the bundle and the migrator hold the transaction. Running ahead of
-- db/133 is refused. Its proof is db/99 §143.

DO $guard$
BEGIN
  IF to_regprocedure('match_fixture_rules()') IS NULL OR to_regprocedure('ball_event_not_postponed()') IS NULL THEN
    RAISE EXCEPTION 'db/165 needs db/133 (match_fixture_rules, ball_event_not_postponed): paste it first';
  END IF;
  IF to_regprocedure('api_role_reach(name)') IS NULL THEN
    RAISE EXCEPTION 'db/165 needs db/157 (api_role_reach): paste it first';
  END IF;
END $guard$;

-- ── 0 · Ten seconds for a lock, or nothing (db/158, db/161, db/163) ──
-- A plain SET, so it holds for every statement after it however the file is
-- run (psql -1, the SQL editor's single run, statement by statement); the
-- file's last statement RESETs it, so a pooled connection is handed back as
-- it came. Inside a transaction a stopped paste rolls back whole; statement
-- by statement, a second paste finishes what a stopped one left.
SET lock_timeout = '10s';


-- ── 1 · The first ball makes the fixture live ──────────────────────
CREATE OR REPLACE FUNCTION match_live_on_first_event() RETURNS trigger AS $$
BEGIN
  UPDATE match m SET status = 'live'
   WHERE m.status = 'scheduled'
     AND m.id IN (SELECT DISTINCT n.match_id FROM match_live_new_events n WHERE n.kind = 'ball');
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER ball_event_match_live AFTER INSERT ON ball_event
  REFERENCING NEW TABLE AS match_live_new_events
  FOR EACH STATEMENT EXECUTE FUNCTION match_live_on_first_event();

-- ── 1b · A scored fixture stays played (Kameel, 18 Nov 2026) ───────
-- "Refuse it once there are balls." live → scheduled is refused for a
-- fixture with a ball in its log (kind 'ball', as the trigger counts them:
-- the toss's setup is not one, so a fixture the office set live after the
-- toss with no ball bowled may still go back), for every caller: the office and
-- every holder of fixture.update, the owner and a definer too. db/133
-- allowed it, so an office edit could put a scored fixture back to
-- "Upcoming". Refused as db/133's moves are (check_violation, constraint
-- match_status_transition), which the fixture route answers 422
-- status_transition with these words. A match called off by mistake still
-- goes abandoned → scheduled, logged (db/133); nothing else changes. A
-- trigger of its own rather than a branch in db/133's match_fixture_rules(),
-- so db/133's body is not re-emitted.
CREATE OR REPLACE FUNCTION match_scored_stays_live() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = NEW.id AND b.kind = 'ball') THEN
    RAISE EXCEPTION 'This fixture has been scored, so it is not put back to scheduled: call it off (abandoned) if it is not going on.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'match_status_transition';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER match_scored_stays_live BEFORE UPDATE OF status ON match
  FOR EACH ROW WHEN (OLD.status = 'live' AND NEW.status = 'scheduled')
  EXECUTE FUNCTION match_scored_stays_live();


-- ── 2 · Who may call them ──────────────────────────────────────────
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['match_live_on_first_event()', 'match_scored_stays_live()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ── 3 · The backfill: a scheduled fixture with a log is in play ────
-- A function, so db/99 §143 can prove it on a fixture it stages in the
-- state the bug left (a ball on its log, still scheduled). The owner's
-- alone: it reaches every school's fixtures, and the app has no use for it.
CREATE OR REPLACE FUNCTION match_live_backfill() RETURNS integer AS $$
DECLARE v_moved integer;
BEGIN
  UPDATE match m SET status = 'live'
   WHERE m.status = 'scheduled' AND EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = m.id AND b.kind = 'ball');
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DO $backfill$
DECLARE r text; v_before integer; v_moved integer; v_after integer;
BEGIN
  REVOKE ALL ON FUNCTION match_live_backfill() FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['scrbrd_app', 'anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION match_live_backfill() FROM %I', r);
    END IF;
  END LOOP;
  SELECT count(*) INTO v_before FROM match m
   WHERE m.status = 'scheduled' AND EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = m.id AND b.kind = 'ball');
  RAISE NOTICE 'db/165: % scheduled fixture(s) with a ball in their log, before', v_before;
  v_moved := match_live_backfill();
  SELECT count(*) INTO v_after FROM match m
   WHERE m.status = 'scheduled' AND EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = m.id AND b.kind = 'ball');
  RAISE NOTICE 'db/165: % moved to live; % scheduled fixture(s) with a ball, after', v_moved, v_after;
  IF v_after <> 0 THEN
    RAISE EXCEPTION 'db/165: % scheduled fixture(s) still have a ball after the backfill', v_after;
  END IF;
END $backfill$;


-- ── 4 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'match_live_on_first_event()'::regprocedure AND prosecdef
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/165: match_live_on_first_event() is not a definer with a pinned search_path';
  END IF;
  -- From scheduled alone: the body names no other status to move from.
  SELECT prosrc INTO v FROM pg_proc WHERE oid = 'match_live_on_first_event()'::regprocedure;
  IF position($w$m.status = 'scheduled'$w$ IN v) = 0 OR position($w$n.kind = 'ball'$w$ IN v) = 0
     OR v ~ $w$'(postponed|abandoned|complete)'$w$ THEN
    RAISE EXCEPTION 'db/165: match_live_on_first_event() moves a fixture from somewhere other than scheduled, or on something other than a ball';
  END IF;
  SELECT pg_get_triggerdef(t.oid) INTO v FROM pg_trigger t
   WHERE t.tgrelid = 'ball_event'::regclass AND t.tgname = 'ball_event_match_live' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF v IS DISTINCT FROM 'CREATE TRIGGER ball_event_match_live AFTER INSERT ON public.ball_event REFERENCING NEW TABLE AS match_live_new_events FOR EACH STATEMENT EXECUTE FUNCTION match_live_on_first_event()' THEN
    RAISE EXCEPTION 'db/165: ball_event_match_live is %', coalesce(v, '(missing or disabled)');
  END IF;
  -- The refusal: its trigger as made here, enabled, on live → scheduled only, and its body.
  SELECT pg_get_triggerdef(t.oid) INTO v FROM pg_trigger t
   WHERE t.tgrelid = 'match'::regclass AND t.tgname = 'match_scored_stays_live' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF v IS DISTINCT FROM $w$CREATE TRIGGER match_scored_stays_live BEFORE UPDATE OF status ON public.match FOR EACH ROW WHEN (((old.status = 'live'::text) AND (new.status = 'scheduled'::text))) EXECUTE FUNCTION match_scored_stays_live()$w$ THEN
    RAISE EXCEPTION 'db/165: match_scored_stays_live is %', coalesce(v, '(missing or disabled)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'match_scored_stays_live()'::regprocedure AND prosecdef
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))
                    AND position('match_status_transition' IN prosrc) > 0) THEN
    RAISE EXCEPTION 'db/165: match_scored_stays_live() is not a pinned definer raising match_status_transition';
  END IF;
  IF position($w$b.kind = 'ball'$w$ IN (SELECT prosrc FROM pg_proc WHERE oid = 'match_scored_stays_live()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/165: match_scored_stays_live() refuses on something other than a ball';
  END IF;
  -- The grants, read from the ACL: scrbrd_app's EXECUTE beside the owner's, nothing else.
  FOR v IN SELECT f FROM unnest(ARRAY['match_live_on_first_event()', 'match_scored_stays_live()']) f
            WHERE (SELECT string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',')
                     FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                    WHERE p.oid = f::regprocedure AND x.grantee <> p.proowner) IS DISTINCT FROM 'scrbrd_app:EXECUTE' LOOP
    RAISE EXCEPTION 'db/165: % is not granted to scrbrd_app alone', v;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'match_live_backfill()'::regprocedure AND prosecdef
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/165: match_live_backfill() is not a definer with a pinned search_path';
  END IF;
  SELECT string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',')
    INTO v FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
   WHERE p.oid = 'match_live_backfill()'::regprocedure AND x.grantee <> p.proowner;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'db/165: match_live_backfill() is granted % (wanted the owner alone)', v;
  END IF;
  IF EXISTS (SELECT 1 FROM api_role_reach('public') x WHERE x ~ '(match_live_(on_first_event|backfill)|match_scored_stays_live)\(') THEN
    RAISE EXCEPTION 'db/165: PUBLIC reaches one of db/165''s functions';
  END IF;
END $check$;


-- ── 5 · The lock limit back as it was: a pooled connection is handed back as it came ──
RESET lock_timeout;

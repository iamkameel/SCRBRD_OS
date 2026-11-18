-- ══════════════════════════════════════════════════════════════════
--  165 · A fixture is live from its first event
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
-- So neither the toss (a column of match, not an event), nor a claim, nor
-- the start time makes a fixture live. The first row the server accepts
-- into ball_event does.
--
-- WHAT THIS FILE DOES.
--   1. match_live_on_first_event(), a statement-level AFTER INSERT trigger
--      on ball_event, as the definer with its search_path pinned. It moves
--      every fixture the statement wrote to that is still 'scheduled' to
--      'live'. Only from 'scheduled': never from 'postponed' (db/133's
--      BEFORE trigger refuses the ball there anyway), 'abandoned' or
--      'complete'. The ball is the act; nobody is given the column, no
--      capability is added and packages/policy is unchanged.
--   2. A backfill, match_live_backfill(): a scheduled fixture that already
--      has a log is in play, so it becomes live. The paste prints the count
--      before and after, and refuses to commit if one is left.
--
-- WHAT IT DOES NOT DO. A ball only reaches ball_event through the lease
-- (events-api.mjs, scoring_lease_check) or the importer's confirm; a
-- quarantined ball goes to ball_event_quarantine and moves nothing. The
-- importer goes scheduled → live → complete in one transaction, and nobody
-- sees the middle step. The trigger writes no notice and no audit row: the
-- first event is its own record. Every trigger on match that fires on a
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
-- first event the UPDATE matches no row and takes no lock.
--
-- WHO MAY CALL THEM. db/157's rule: REVOKE ALL FROM PUBLIC, then EXECUTE to
-- scrbrd_app by name on the trigger's function (which cannot be called
-- directly in any case), nothing to the managed host's three API roles. The
-- backfill is the owner's alone.
--
-- Safe to run twice: CREATE OR REPLACE, DROP TRIGGER IF EXISTS before the
-- CREATE, and a backfill that finds nothing the second time. No BEGIN or
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


-- ── 1 · The first event makes the fixture live ─────────────────────
CREATE OR REPLACE FUNCTION match_live_on_first_event() RETURNS trigger AS $$
BEGIN
  UPDATE match m SET status = 'live'
   WHERE m.status = 'scheduled'
     AND m.id IN (SELECT DISTINCT n.match_id FROM match_live_new_events n);
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS ball_event_match_live ON ball_event;
CREATE TRIGGER ball_event_match_live AFTER INSERT ON ball_event
  REFERENCING NEW TABLE AS match_live_new_events
  FOR EACH STATEMENT EXECUTE FUNCTION match_live_on_first_event();

-- ── KAMEEL'S CALL, NOT MADE HERE (his board, 18 Nov 2026) ──────────
-- (a) Refuse live → scheduled once the log has an event. db/133 allows it
--     today, so an office edit could flip a scored fixture back to
--     "Upcoming" (the next ball flips it back). If he says yes, it is one
--     branch in match_fixture_rules() (db/133 §2, re-emitted under its md5
--     guard), before its `ELSIF OLD.status = 'postponed'`:
--
--       ELSIF OLD.status = 'live' AND NEW.status = 'scheduled'
--             AND EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = NEW.id) THEN
--         RAISE EXCEPTION 'This fixture has been scored, so it is live: call it off (abandoned) rather than put it back.'
--           USING ERRCODE = 'check_violation', CONSTRAINT = 'match_status_transition';
--
--     and db/99 §143's case (back), written and commented out there, goes in.
-- ───────────────────────────────────────────────────────────────────


-- ── 2 · Who may call it ────────────────────────────────────────────
DO $grants$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION match_live_on_first_event() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION match_live_on_first_event() TO scrbrd_app;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION match_live_on_first_event() FROM %I', r);
    END IF;
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
   WHERE m.status = 'scheduled' AND EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = m.id);
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
   WHERE m.status = 'scheduled' AND EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = m.id);
  RAISE NOTICE 'db/165: % scheduled fixture(s) with events in their log, before', v_before;
  v_moved := match_live_backfill();
  SELECT count(*) INTO v_after FROM match m
   WHERE m.status = 'scheduled' AND EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = m.id);
  RAISE NOTICE 'db/165: % moved to live; % scheduled fixture(s) with events, after', v_moved, v_after;
  IF v_after <> 0 THEN
    RAISE EXCEPTION 'db/165: % scheduled fixture(s) still have events after the backfill', v_after;
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
  IF position($w$m.status = 'scheduled'$w$ IN v) = 0 OR v ~ $w$'(postponed|abandoned|complete)'$w$ THEN
    RAISE EXCEPTION 'db/165: match_live_on_first_event() moves a fixture from somewhere other than scheduled';
  END IF;
  SELECT pg_get_triggerdef(t.oid) INTO v FROM pg_trigger t
   WHERE t.tgrelid = 'ball_event'::regclass AND t.tgname = 'ball_event_match_live' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF v IS DISTINCT FROM 'CREATE TRIGGER ball_event_match_live AFTER INSERT ON public.ball_event REFERENCING NEW TABLE AS match_live_new_events FOR EACH STATEMENT EXECUTE FUNCTION match_live_on_first_event()' THEN
    RAISE EXCEPTION 'db/165: ball_event_match_live is %', coalesce(v, '(missing or disabled)');
  END IF;
  -- The grants, read from the ACL: scrbrd_app's EXECUTE beside the owner's, nothing else.
  SELECT string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',')
    INTO v FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
   WHERE p.oid = 'match_live_on_first_event()'::regprocedure AND x.grantee <> p.proowner;
  IF v IS DISTINCT FROM 'scrbrd_app:EXECUTE' THEN
    RAISE EXCEPTION 'db/165: match_live_on_first_event() is granted % (wanted scrbrd_app:EXECUTE)', coalesce(v, '(nothing)');
  END IF;
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
  IF EXISTS (SELECT 1 FROM api_role_reach('public') x WHERE x ~ 'match_live_(on_first_event|backfill)\(') THEN
    RAISE EXCEPTION 'db/165: PUBLIC reaches match_live_on_first_event() or match_live_backfill()';
  END IF;
END $check$;

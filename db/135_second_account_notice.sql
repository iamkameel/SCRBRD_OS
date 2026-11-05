-- ══════════════════════════════════════════════════════════════════
--  135 · Two phones scoring one match, slice 1: a second account set
--        aside is told, and the pen-holder's pad can say so
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/TWO_PHONES.md, slice 1 (Kameel, 5 Nov 2026:
-- "All seven as recommended"). Its proof is db/99 §113 and the walk
-- tools/smoke-browser-two-phones.mjs.
--
-- Nothing here changes how a ball is written, leased or set aside. The pen's
-- book is ball_event; a phone that sends under a pen it does not hold is a
-- second scorer's book, set aside in ball_event_quarantine by the write path
-- (services/api/write/events-api.mjs, reason 'stale_epoch_or_lease'), never
-- merged (R1). This file adds the words that follow, and nothing else.
--
-- ── 1 · THE NOTICE (R3, decision 5) ─────────────────────────────────
--   + second_account_notice()  AFTER INSERT on ball_event_quarantine, beside
--       db/132's late_ball_notice() and built as it is. It acts on a row the
--       write path files as 'stale_epoch_or_lease': the match is neither
--       finished nor called off (those are late_ball_notice()'s), it has a
--       scoring session, and the row came from a device that is not the one
--       holding the pen now. To three readers, once per match and reader
--       while the first notice stands (not retracted, not expired):
--         the scorer who sent it   his alone: recipient_id, kind 'system',
--                                  news.read, scope 'school'
--         the home office          kind 'fixture', fixture.update, scope
--                                  'school', no team
--         the approvers            kind 'system', scoring.amend.approve,
--                                  scope 'school', no team: those who may
--                                  decide between the two books
--       Title "Second account set aside · <home> v <away>", the fixture by
--       its sides only (fixture_side_label(), as late_ball_notice() names
--       it). Body "Balls from a second phone were set aside for review, not
--       added to the scorecard." No child, no ball, no scorer's name: the
--       function reads no player, no striker and no scorer's name, and its
--       words are fixed. Urgency 'medium', so a pupil scorer's push is held
--       through his quiet hours (NOTIFICATIONS D21, db/120) as every medium
--       notice is; the push itself is a pointer with no words of the notice
--       (push-api.mjs). A notice that cannot be raised never stops the ball
--       being set aside: a WARNING in the server's log, as db/132 does.
--
-- ── 2 · THE PEN-HOLDER'S COUNT (R3, the session badge) ──────────────
--   + second_account_waiting(uuid) → integer: how many balls from another
--       phone are set aside on this match and not yet decided — asked by the
--       device that holds the pen, and by nobody else (0 otherwise). A count
--       and nothing more: no ball, no name, no device. The heartbeat and the
--       events route carry it to the pad, which says "Your scoring stands ·
--       N balls from another phone set aside for review".
--
-- WHO MAY CALL WHAT (every definer here pins its search_path)
--   second_account_waiting(uuid)   scrbrd_app
--   second_account_notice()        a trigger: nobody
-- And none to PUBLIC, nor to a managed host's anon, authenticated or
-- service_role.
--
-- EXISTING ROWS. Nothing changed or deleted; no table, column or policy
-- moves. A row already set aside raises no notice (the trigger is AFTER
-- INSERT). Safe to run twice: CREATE OR REPLACE, and grants that end where
-- they began. Nothing is dropped.
--
-- SCHEMA FIRST. The API built with it asks second_account_waiting(); this
-- file goes before it and is in services/api/expected-migrations.json.


-- ── 0 · What it needs ──────────────────────────────────────────────
DO $guard$
BEGIN
  IF to_regclass('scoring_session') IS NULL OR to_regclass('ball_event_quarantine') IS NULL
     OR to_regclass('notification') IS NULL
     OR to_regprocedure('fixture_side_label(uuid,text)') IS NULL
     OR to_regprocedure('app_device_id()') IS NULL OR to_regprocedure('app_user_id()') IS NULL
     OR to_regprocedure('late_ball_notice()') IS NULL THEN
    RAISE EXCEPTION 'db/135: the pen (db/02, db/33), the notices (db/89), the side''s label or the late-ball notice (db/132) is missing; apply them first';
  END IF;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
--  1 · The notice
-- ══════════════════════════════════════════════════════════════════
-- A second phone's ball set aside on a match still in play: the scorer who
-- sent it is told, and so are the home office and the approvers. Once per
-- match and reader while the first notice stands. The fixture is named by its
-- sides; no child, no ball, no scorer.
CREATE OR REPLACE FUNCTION second_account_notice() RETURNS trigger AS $$
DECLARE
  m       match%ROWTYPE;
  v_dev   text;
  v_title text;
  v_body  text := 'Balls from a second phone were set aside for review, not added to the scorecard.';
  v_life  timestamptz := now() + interval '7 days';
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = NEW.match_id;
  -- A finished or called-off match is late_ball_notice()'s (db/132).
  IF NOT FOUND OR m.status IN ('complete', 'abandoned') THEN RETURN NULL; END IF;
  -- 'stale_epoch_or_lease' needs a session (without one the write path says
  -- 'no_session'), and a second account is a device that is not the pen's.
  SELECT s.holder_device INTO v_dev FROM scoring_session s WHERE s.match_id = NEW.match_id;
  IF NOT FOUND OR NEW.device_id IS NOT DISTINCT FROM v_dev THEN RETURN NULL; END IF;
  v_title := 'Second account set aside · '
             || coalesce(fixture_side_label(m.school_id, m.team_code), m.team_code, 'Home') || ' v '
             || coalesce(fixture_side_label(m.away_school_id, m.away_team_code), m.opponent, 'Away');
  BEGIN
    -- The scorer who sent them: his alone.
    IF NOT EXISTS (SELECT 1 FROM notification n
                    WHERE n.subject_kind = 'match' AND n.subject_id = m.id AND n.recipient_id = NEW.scorer_user_id
                      AND n.title = v_title AND n.retracted_at IS NULL AND (n.expires_at IS NULL OR n.expires_at > now())) THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, recipient_id, expires_at)
      VALUES (m.school_id, NULL, 'school', 'system', 'medium', v_title, v_body,
              'news.read', false, 'match', m.id, NEW.scorer_user_id, v_life);
    END IF;
    -- The home office: the school, under fixture.update.
    IF NOT EXISTS (SELECT 1 FROM notification n
                    WHERE n.subject_kind = 'match' AND n.subject_id = m.id AND n.recipient_id IS NULL
                      AND n.required_capability = 'fixture.update'
                      AND n.title = v_title AND n.retracted_at IS NULL AND (n.expires_at IS NULL OR n.expires_at > now())) THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, expires_at)
      VALUES (m.school_id, NULL, 'school', 'fixture', 'medium', v_title, v_body,
              'fixture.update', false, 'match', m.id, v_life);
    END IF;
    -- The approvers: the school, under scoring.amend.approve — who may decide
    -- between the two books.
    IF NOT EXISTS (SELECT 1 FROM notification n
                    WHERE n.subject_kind = 'match' AND n.subject_id = m.id AND n.recipient_id IS NULL
                      AND n.required_capability = 'scoring.amend.approve'
                      AND n.title = v_title AND n.retracted_at IS NULL AND (n.expires_at IS NULL OR n.expires_at > now())) THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, expires_at)
      VALUES (m.school_id, NULL, 'school', 'system', 'medium', v_title, v_body,
              'scoring.amend.approve', false, 'match', m.id, v_life);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The ball is set aside whatever happens to its notice; the server's
    -- log says the notice was not raised.
    RAISE WARNING 'db/135: the second-account notice for match % was not raised (SQLSTATE %)', NEW.match_id, SQLSTATE;
  END;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER second_account_notice AFTER INSERT ON ball_event_quarantine
  FOR EACH ROW EXECUTE FUNCTION second_account_notice();


-- ══════════════════════════════════════════════════════════════════
--  2 · The pen-holder's count
-- ══════════════════════════════════════════════════════════════════
-- Balls from another phone set aside on this match and not yet decided, for
-- the device holding the pen; 0 for anybody else. The caller's device is the
-- principal's (app_device_id()), never an argument. Only balls: a second
-- phone's over change or innings start is not what the line counts.
CREATE OR REPLACE FUNCTION second_account_waiting(p_match uuid) RETURNS integer AS $$
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM scoring_session s
                                WHERE s.match_id = p_match AND s.state = 'active'
                                  AND app_device_id() IS NOT NULL AND s.holder_device = app_device_id()
                                  AND s.holder_user_id = app_user_id())
              THEN 0
              ELSE (SELECT count(*)::int FROM ball_event_quarantine q
                     WHERE q.match_id = p_match AND q.resolved_at IS NULL AND q.current_epoch IS NOT NULL
                       AND q.device_id IS DISTINCT FROM app_device_id()
                       AND coalesce(q.body->'payload'->>'kind', 'ball') = 'ball')
         END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  Who may call the new functions
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['second_account_waiting(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  -- The trigger: nobody's.
  FOREACH f IN ARRAY ARRAY['second_account_notice()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
--  What this file promised, checked in the same paste
-- ══════════════════════════════════════════════════════════════════
-- The behaviour is asserted live in db/99 §113.
DO $check$
DECLARE f text; r text; src text;
BEGIN
  FOREACH f IN ARRAY ARRAY['second_account_notice()', 'second_account_waiting(uuid)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/135: % is not SECURITY DEFINER', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/135: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/135: % is executable by PUBLIC', f;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.rolname = r AND has_function_privilege(ro.oid, f::regprocedure, 'EXECUTE')) THEN
        RAISE EXCEPTION 'db/135: % is executable by a managed host''s API role (%)', f, r;
      END IF;
    END LOOP;
    SELECT prosrc INTO src FROM pg_proc WHERE oid = f::regprocedure;
    IF src ~* '\mcurrent_date\M' THEN
      RAISE EXCEPTION 'db/135: % reads the database''s day (db/128)', f;
    END IF;
    -- No child: neither function looks up a player or a scorer's name.
    IF src ~* '\m(striker_id|non_striker_id|bowler_id|dismissed_id|player|full_name|app_user)\M' THEN
      RAISE EXCEPTION 'db/135: % reads a player or a person''s name', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('scrbrd_app', 'second_account_waiting(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/135: the application cannot call second_account_waiting()';
  END IF;
  IF has_function_privilege('scrbrd_app', 'second_account_notice()', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/135: the application can call the notice''s trigger function';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'
                   AND tgrelid = 'ball_event_quarantine'::regclass AND tgname = 'second_account_notice') THEN
    RAISE EXCEPTION 'db/135: the second-account trigger is missing or disabled';
  END IF;
END $check$;

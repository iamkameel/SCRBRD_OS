-- ══════════════════════════════════════════════════════════════════
--  171 · The end of a match, the server's half (redesign slice 4's
--        follow-ups): the scorer's part ends at the last ball, the coach
--        is told, and the pen is put down from the end screen
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Redesign slice 4 (DESIGN_DIRECTION Q2, Kameel, 20 Nov 2026,
-- option (a)): "the coach confirms the result. The scorer sees 'Your part
-- is done. The coach confirms the result', and the coach gets a notice. The
-- score reads 'provisional' to everyone until the coach confirms." Slice 4
-- drew it on the screens (apps/web: finishMatch.jsx, fulltime.jsx,
-- session.js couldConfirmResult()); three things it left need the database,
-- and are here. Its proof is db/99 §146.
--
-- ══ 1 · THE SERVER REFUSES A SCORER'S FINISH ════════════════════════
--   ~ match_finalise() (db/130, db/132)  db/132's body and one step, 1b,
--       asked before anything is locked, as step 1 is: a caller who holds
--       scoring.finalise at the home side ONLY through a `scorer`
--       assignment is (false, 'coach_confirms'), and nothing is written.
--       The coach, the director of sport, the sports administrator and the
--       superadmin hold scoring.finalise by their own roles (db/01) and keep
--       it; a person who is a scorer AND the side's coach keeps it, through
--       the coach's assignment. The scorer keeps scoring.finalise itself: in
--       db/01 it also means "close an innings", which is still his. Every
--       property db/130's and db/132's checks assert is kept: the capability
--       before the lock, the session locked, held_elsewhere asked last, the
--       status set through the table, the one 'match_finalised' row, no
--       database day (db/128).
--   + app_can_but_scorer()  app_can()'s body, word for word, and one line:
--       AND a.role <> 'scorer' (db/129's app_can_but_player() is the
--       pattern, and its line is the only other difference). What the
--       caller holds at a side apart from a scorer's assignment. The
--       owner's alone: match_finalise() asks it. Checked below, and in
--       db/99 §146 (copy), to be app_can()'s body bar its one line.
--   The screens ask the same rule of the role catalogue:
--   packages/policy/src/roles.mjs roleConfirmsResult() (scoring.finalise,
--   and not the scorer's), which apps/web's couldConfirmResult() reads, and
--   packages/policy/test/separation.test.mjs reads this file to hold the
--   two to the one excluded role.
--
-- ══ 2 · THE COACH IS TOLD WHEN THE LOG DECIDES THE MATCH ═══════════
--   + match_decided_notice(match)  For a LIVE match whose log decides it —
--       db/130's own meaning: match_result_compute() is not in_progress, and
--       no super over is still to play (match_completion_refusal() is
--       NULL), which is the screens' decidedOn() — one notice to each person
--       who may confirm at the home side: a live assignment at the home
--       school (never a platform-wide one) whose role holds scoring.finalise
--       and is not `scorer`, for the side or school-wide, not suspended,
--       not a support hour's, about nobody in particular, and not a pupil's.
--       Kind 'fixture', urgency medium (pushed, as a pointer that names
--       nothing: NOTIFICATIONS D14), addressed by recipient_id, under
--       scoring.finalise at the side, about the match. Title "U13E v
--       Westville Boys' High 1XI is decided. Confirm the result." No child
--       is named, in the title, the body or on a lock screen.
--       ONCE per match and person while it stands: a notice already live
--       (not retracted, not expired) is not written again, however often the
--       log is re-read (a re-sent batch writes no event and asks nothing).
--       Not decided any more (a correction took the winning ball away): each
--       live notice is taken back through notification_retract() (db/89) as
--       superseded, unsaid (a fixture notice's word, D2; nothing told the
--       coach a false thing a "withdrawn" notice would correct, and nothing
--       pages him twice). Decided again later: a new notice, since a
--       superseded one is not returned (db/113's un-retract is a correction's
--       alone).
--   + When it is asked (match_decided_after_events(), statement-level on
--       ball_event; match_decided_after_decision() on match_result_decision):
--       a batch that closes an innings (innings_end: the scorer's seal, the
--       end of every innings and of a super over), voids a ball, or an
--       organiser's decision recorded or changed. NOT every ball: the fold is
--       a full replay, and the chase's balls are the scoring hot path. A
--       chase that reaches its target is decided on the fold at that ball,
--       and the pad then asks the scorer to confirm the innings closed; the
--       notice goes with that seal, seconds later. A scorebook's commit
--       (db/63) completes its own match and is not asked.
--   + match_decided_notice_done()  AFTER UPDATE OF status on match, live to
--       complete or abandoned: the act the notice asks for is done (or there
--       is no result to confirm), so its live notices are taken back,
--       superseded and unsaid.
--   A notice never costs a ball: each is asked in its own sub-transaction,
--   and a failure is a WARNING in the server's log with its SQLSTATE.
--
-- ══ 3 · THE SCORER PUTS THE PEN DOWN FROM THE END SCREEN ══════════
--   + scoring_release(match, device, epoch, pending) → (ok, reason, epoch)
--       The token holder's own release: today the coach's Confirm waits up to
--       90 s for the scorer's lease to lapse (db/132's held_elsewhere). In
--       order: scoring.edit at the match (or no_capability; under a pad
--       credential app_can() admits it at the credential's own match, db/50);
--       the session locked; the caller is the holder — the same person, the
--       same device, the same generation, state active — or not_token_holder
--       (a lapsed lease that nobody has taken is still his to put down); the
--       pad says nothing is left to send (pending = 0) or unsynced_work, as
--       scoring_arm_handover() asks it. Then the session goes idle with the
--       epoch bumped, as scoring_force_release() leaves it: a ball still in
--       flight under the old generation is quarantined (db/33), never lost
--       and never written into the log behind the release. db/50's trigger
--       ends the pad's resume credential ('released'). One scoring_audit row,
--       event 'pen_released'.
--       It does not end scoring: a later ball needs a claim, as any idle
--       match does; a finished match refuses that claim (db/33).
--
-- WHO MAY CALL WHAT (every definer here pins its search_path)
--   match_finalise(uuid), scoring_release(uuid,text,integer,integer)   scrbrd_app
--   app_can_but_scorer(…), match_decided_notice(uuid)                 the owner's: nobody
--   match_decided_after_events(), match_decided_after_decision(),
--   match_decided_notice_done()                                        triggers: nobody
-- And none to PUBLIC, nor to a managed host's anon, authenticated or
-- service_role.
--
-- EXISTING ROWS. Nothing changed or deleted; no table, no column. A match
-- already decided and live when this is pasted is told at its next seal,
-- void or decision, or never (its coach confirms it from the screens as
-- today). Safe to run twice: CREATE OR REPLACE throughout, and grants that
-- end where they began. Nothing is dropped.
--
-- SCHEMA FIRST. The API built with it calls scoring_release() and words
-- coach_confirms; this file goes before it and is in
-- services/api/expected-migrations.json.

SET lock_timeout = '10s';

-- ── 0 · What it needs, and what it replaces ────────────────────────
DO $guard$
DECLARE v_md5 text;
BEGIN
  IF to_regprocedure('match_result_compute(uuid)') IS NULL OR to_regprocedure('match_completion_refusal(uuid)') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('app_can_but_player(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('app_device_id()') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('notification_retract(uuid,text,boolean)') IS NULL
     OR to_regprocedure('fixture_side_label(uuid,text)') IS NULL OR to_regprocedure('person_is_pupil(uuid)') IS NULL
     OR to_regprocedure('sa_today()') IS NULL
     OR to_regclass('scoring_session') IS NULL OR to_regclass('scoring_audit') IS NULL
     OR to_regclass('match_result_decision') IS NULL OR to_regclass('support_access') IS NULL
     OR to_regclass('duty_suspension') IS NULL THEN
    RAISE EXCEPTION 'db/171: the finish (db/130, db/132), the fold (db/69, db/71), app_can_but_player() (db/129), the retraction (db/89), the pupil test (db/116) or the SA day (db/128) is missing; apply them first';
  END IF;
  SELECT md5(regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g')) INTO v_md5
    FROM pg_proc p WHERE p.oid = 'match_finalise(uuid)'::regprocedure;
  IF v_md5 NOT IN ('03b8a550d38ea96ea67b8a38b9930f7b', '650d240295cb35bb736308b8a35339b7') THEN
    RAISE EXCEPTION 'db/171: match_finalise() is not db/132''s or this file''s (md5 % of its folded body); look before replacing it', v_md5;
  END IF;
  -- The copy below is app_can_but_player()'s with its one line changed, so
  -- that body must still be app_can()'s bar its line (db/99 §106 (copy)).
  IF replace((SELECT prosrc FROM pg_proc WHERE oid = 'app_can_but_player(text,uuid,text,uuid,uuid)'::regprocedure),
             chr(10) || '       AND a.role <> ''player''', '')
     IS DISTINCT FROM (SELECT prosrc FROM pg_proc WHERE oid = 'app_can(text,uuid,text,uuid,uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/171: app_can() is not the body app_can_but_player() copies (db/129, db/99 §106 (copy)); this file copies the same body';
  END IF;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
--  1 · The scorer's part ends at the last ball
-- ══════════════════════════════════════════════════════════════════
-- ── app_can(), over every assignment but a `scorer` one ────────────
-- db/128's app_can() body, word for word, and one line: AND a.role <>
-- 'scorer'. The owner's alone: match_finalise() asks it.
CREATE OR REPLACE FUNCTION app_can_but_scorer(
  p_capability text,
  p_school     uuid DEFAULT NULL,
  p_team       text DEFAULT NULL,
  p_person     uuid DEFAULT NULL,
  p_fixture    uuid DEFAULT NULL
) RETURNS boolean AS $$
  SELECT coalesce(NOT app_pad_scoped()
                  OR (p_capability IN ('fixture.read', 'scoring.edit') AND p_fixture = app_pad_match()), false)
     AND EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc
        ON rc.role = a.role
       AND rc.capability = p_capability
     WHERE a.person_id = app_user_id()
       AND a.role <> 'scorer'
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= sa_today())
       AND (a.valid_until IS NULL OR a.valid_until >  sa_today())
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       -- institution. There is no ANY_SCOPE for school: every governed row
       -- belongs to a tenant, and one that does not state its tenant is one
       -- nobody should reach.
       AND (a.school_id IS NULL OR (p_school IS NOT NULL AND a.school_id = p_school))
       -- team
       AND (a.team_code IS NULL OR p_team = '*'::text
            OR (p_team IS NOT NULL AND a.team_code = p_team))
       -- single fixture (scorers, match officials)
       AND (a.fixture_id IS NULL OR p_fixture = '00000000-0000-0000-0000-000000000000'::uuid
            OR (p_fixture IS NOT NULL AND a.fixture_id = p_fixture))
       -- WHO the assignment is about. An assignment naming people reaches ONLY
       -- those people: a guardian's children, and a pupil's own record. An
       -- assignment naming nobody is about nobody in particular and is scoped
       -- by school and team alone, which is how a coach reaches their squad —
       -- EXCEPT for the roles that only make sense about a person, which are
       -- refused outright rather than widened (SUBJECT_SCOPED_ROLES).
       --
       -- A LIVE link is verified, started and not ended. Verification is what
       -- turns a claimed relationship into a permission, and 'pending' is the
       -- column default, so nothing reaches a child until somebody at the
       -- school put their name to the link.
       AND CASE WHEN a.role = ANY (ARRAY['guardian', 'selfaccess', 'enquiry']::text[]) THEN
             -- A role that only means anything ABOUT SOMEBODY. It must name a
             -- live person, and then reaches that person and rows with no
             -- person dimension (a fixture: which is how a parent sees when
             -- their child is playing). Name nobody live and it reaches
             -- nothing at all — not the school, not a fixture.
             EXISTS (SELECT 1 FROM assignment_subject g
                      WHERE g.assignment_id = a.id
                        AND g.verification_state = 'verified'
                        AND g.valid_from <= sa_today()
                        AND (g.valid_until IS NULL OR g.valid_until > sa_today()))
             AND (p_person = '00000000-0000-0000-0000-000000000000'::uuid
                  OR (p_person IS NOT NULL AND EXISTS (
                        SELECT 1 FROM assignment_subject g
                         WHERE g.assignment_id = a.id AND g.player_id = p_person
                           AND g.verification_state = 'verified'
                           AND g.valid_from <= sa_today()
                           AND (g.valid_until IS NULL OR g.valid_until > sa_today()))))
           ELSE
             -- Everyone else. Naming nobody means "about nobody in
             -- particular", scoped by school and team, which is how a coach
             -- reaches their squad. The NOT EXISTS counts EVERY row, live or
             -- not: filtering it to live links would mean that revoking the
             -- last link turns a person-scoped assignment into a school-wide
             -- one, so revocation would WIDEN access.
             NOT EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id)
             OR p_person = '00000000-0000-0000-0000-000000000000'::uuid
             OR (p_person IS NOT NULL AND EXISTS (
                   SELECT 1 FROM assignment_subject g
                    WHERE g.assignment_id = a.id AND g.player_id = p_person
                      AND g.verification_state = 'verified'
                      AND g.valid_from <= sa_today()
                      AND (g.valid_until IS NULL OR g.valid_until > sa_today())))
           END
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── match_finalise(): db/132's, with step 1b (marked db/171) ───────
CREATE OR REPLACE FUNCTION match_finalise(p_match uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  m     match%ROWTYPE;
  r     record;
  v_why text;
BEGIN
  -- 1. The capability at the home side, asked before anything is locked or
  --    read: a caller who may not finish learns nothing, not even that the
  --    match exists.
  IF app_user_id() IS NULL OR p_match IS NULL
     OR NOT coalesce(app_can('scoring.finalise', match_school(p_match), match_team(p_match), NULL, p_match), false) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  -- 1b. db/171 (Kameel, 20 Nov 2026, DESIGN_DIRECTION Q2 (a)): the scorer's
  --     part ends at the last ball, and the coach confirms. Held only as the
  --     scorer, scoring.finalise does not finish the match. Asked before the
  --     lock, as step 1 is; the caller already holds a capability at this
  --     match, so the refusal tells him nothing new.
  IF NOT coalesce(app_can_but_scorer('scoring.finalise', match_school(p_match), match_team(p_match), NULL, p_match), false) THEN
    RETURN QUERY SELECT false, 'coach_confirms'::text; RETURN;
  END IF;
  -- One finisher at a time: a second press waits here and then finds it done.
  SELECT * INTO m FROM match x WHERE x.id = p_match FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_permitted'::text; RETURN; END IF;
  -- 2. Done already: a no-op, said as success.
  IF m.status = 'complete' THEN RETURN QUERY SELECT true, 'already_complete'::text; RETURN; END IF;
  -- 3. Called off: not a result to finish.
  IF m.status = 'abandoned' THEN RETURN QUERY SELECT false, 'match_abandoned'::text; RETURN; END IF;
  -- 3b. db/132: the session row is locked, as the live path's lease check
  --     locks it, so a batch of balls already past its check commits before
  --     the log is read below.
  PERFORM 1 FROM scoring_session s WHERE s.match_id = p_match FOR UPDATE;
  -- 4. The log has not decided it.
  SELECT x.outcome, x.result_hash INTO r FROM match_result_compute(p_match) x;
  IF r.outcome IS NULL OR r.outcome = 'in_progress' THEN RETURN QUERY SELECT false, 'not_decided'::text; RETURN; END IF;
  -- 5. A tie waiting on its super over: the gate's own reason.
  v_why := match_completion_refusal(p_match);
  IF v_why IS NOT NULL THEN RETURN QUERY SELECT false, v_why; RETURN; END IF;
  -- 5b. db/132: another phone holds the pen. A live lease on a device that is
  --     not the caller's refuses: its scorer may still be writing. Asked
  --     last, so a match that could not be finished anyway says why.
  IF EXISTS (SELECT 1 FROM scoring_session s
              WHERE s.match_id = p_match AND s.state = 'active' AND s.lease_until > now()
                AND s.holder_device IS DISTINCT FROM app_device_id()) THEN
    RETURN QUERY SELECT false, 'held_elsewhere'::text; RETURN;
  END IF;

  UPDATE match SET status = 'complete' WHERE id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, detail)
  VALUES (p_match, m.school_id, 'match_finalised', app_user_id(),
          jsonb_build_object('outcome', r.outcome, 'resultHash', r.result_hash,
                             'headSeq', coalesce((SELECT max(b.seq) FROM ball_event b WHERE b.match_id = p_match), 0)));
  RETURN QUERY SELECT true, 'finished'::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  2 · The coach is told when the log decides the match
-- ══════════════════════════════════════════════════════════════════
-- Returns how many notices it wrote (0 when it wrote none or took some back).
CREATE OR REPLACE FUNCTION match_decided_notice(p_match uuid) RETURNS integer AS $$
DECLARE
  m         match%ROWTYPE;
  r         record;
  v_title   text;
  v_body    text;
  v_life    timestamptz;
  v_n       integer := 0;
  v_id      uuid;
  p         uuid;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND OR m.status IS DISTINCT FROM 'live' THEN RETURN 0; END IF;
  -- One reader of the log at a time for this match, so two batches at once
  -- (a seal beside an amendment's void) write one notice, not two.
  PERFORM pg_advisory_xact_lock(hashtextextended('db171:decided:' || p_match::text, 0));

  SELECT x.outcome INTO r FROM match_result_compute(p_match) x;
  IF r.outcome IS NULL OR r.outcome = 'in_progress' OR match_completion_refusal(p_match) IS NOT NULL THEN
    -- Not decided (any more): what told somebody it was is taken back, unsaid.
    FOR v_id IN SELECT n.id FROM notification n
                 WHERE n.kind = 'fixture' AND n.subject_kind = 'match' AND n.subject_id = p_match
                   AND n.required_capability = 'scoring.finalise' AND n.recipient_id IS NOT NULL
                   AND n.retracts_id IS NULL AND n.retracted_at IS NULL
                 ORDER BY n.published_at, n.id LOOP
      PERFORM notification_retract(v_id, 'superseded', false);
    END LOOP;
    RETURN 0;
  END IF;

  v_title := coalesce(m.team_code, 'Home') || ' v '
             || coalesce(fixture_side_label(m.away_school_id, m.away_team_code), m.opponent, 'the opposition')
             || ' is decided. Confirm the result.';
  v_body := 'The scorer''s part is done. Check the scorecard, then confirm the result in the Match Centre: '
            || 'until somebody does, it reads provisional to everyone.';
  v_life := greatest(m.starts_at, now()) + interval '7 days';

  -- Who may confirm at the home side, other than as its scorer: the
  -- assignments app_can_but_scorer('scoring.finalise', …) would count for
  -- them at this match, at this school (never a platform-wide one), less a
  -- support hour's and a pupil's. RLS reads each notice again as its reader.
  FOR p IN
    SELECT DISTINCT a.person_id
      FROM role_assignment a
      JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'scoring.finalise'
     WHERE a.role <> 'scorer'
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= sa_today())
       AND (a.valid_until IS NULL OR a.valid_until >  sa_today())
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       AND a.school_id = m.school_id
       AND (a.team_code IS NULL OR a.team_code = m.team_code)
       AND (a.fixture_id IS NULL OR a.fixture_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM support_access sx WHERE sx.assignment_id = a.id)
       AND NOT person_is_pupil(a.person_id)
     ORDER BY a.person_id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM notification n
                    WHERE n.kind = 'fixture' AND n.subject_kind = 'match' AND n.subject_id = p_match
                      AND n.required_capability = 'scoring.finalise' AND n.recipient_id = p
                      AND n.retracts_id IS NULL AND n.retracted_at IS NULL
                      AND (n.expires_at IS NULL OR n.expires_at > now())) THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, recipient_id, expires_at)
      VALUES (m.school_id, m.team_code, CASE WHEN m.team_code IS NULL THEN 'school' ELSE 'team' END,
              'fixture', 'medium', v_title, v_body, 'scoring.finalise', false, 'match', p_match, p, v_life);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A batch that closes an innings or voids a ball: each live match in it, once.
CREATE OR REPLACE FUNCTION match_decided_after_events() RETURNS trigger AS $$
DECLARE v_m uuid;
BEGIN
  -- A scorebook's commit (db/63) completes its own match.
  IF coalesce(current_setting('scrbrd.scorebook_commit', true), '') <> '' THEN RETURN NULL; END IF;
  FOR v_m IN SELECT DISTINCT n.match_id FROM match_decided_new_events n
              WHERE n.kind IN ('innings_end', 'void') LOOP
    BEGIN
      PERFORM match_decided_notice(v_m);
    EXCEPTION WHEN OTHERS THEN
      -- The batch is written whatever happens to its notice.
      RAISE WARNING 'db/171: the decided notice for match % was not asked (SQLSTATE %)', v_m, SQLSTATE;
    END;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER ball_event_match_decided AFTER INSERT ON ball_event
  REFERENCING NEW TABLE AS match_decided_new_events
  FOR EACH STATEMENT EXECUTE FUNCTION match_decided_after_events();

-- An organiser's decision recorded or changed: the outcome moved without an event.
CREATE OR REPLACE FUNCTION match_decided_after_decision() RETURNS trigger AS $$
BEGIN
  BEGIN
    PERFORM match_decided_notice(NEW.match_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'db/171: the decided notice for match % was not asked (SQLSTATE %)', NEW.match_id, SQLSTATE;
  END;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER match_decided_after_decision AFTER INSERT OR UPDATE ON match_result_decision
  FOR EACH ROW EXECUTE FUNCTION match_decided_after_decision();

-- Finished, or called off: the notice's act is done, or there is none.
CREATE OR REPLACE FUNCTION match_decided_notice_done() RETURNS trigger AS $$
DECLARE v_id uuid;
BEGIN
  BEGIN
    FOR v_id IN SELECT n.id FROM notification n
                 WHERE n.kind = 'fixture' AND n.subject_kind = 'match' AND n.subject_id = NEW.id
                   AND n.required_capability = 'scoring.finalise' AND n.recipient_id IS NOT NULL
                   AND n.retracts_id IS NULL AND n.retracted_at IS NULL
                 ORDER BY n.published_at, n.id LOOP
      PERFORM notification_retract(v_id, 'superseded', false);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'db/171: the decided notices for match % were not taken back (SQLSTATE %)', NEW.id, SQLSTATE;
  END;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER match_decided_notice_done AFTER UPDATE OF status ON match
  FOR EACH ROW WHEN (OLD.status = 'live' AND NEW.status IN ('complete', 'abandoned'))
  EXECUTE FUNCTION match_decided_notice_done();


-- ══════════════════════════════════════════════════════════════════
--  3 · The scorer puts the pen down
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION scoring_release(p_match uuid, p_device text, p_epoch integer, p_pending integer)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  -- Capability first, then the token (scoring_arm_handover()'s order).
  IF app_user_id() IS NULL OR p_match IS NULL
     OR NOT coalesce(app_can('scoring.edit', match_school(p_match), match_team(p_match), NULL, p_match), false) THEN
    RETURN QUERY SELECT false, 'no_capability'::text, NULL::integer; RETURN;
  END IF;
  SELECT * INTO s FROM scoring_session x WHERE x.match_id = p_match FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_token_holder'::text, NULL::integer; RETURN; END IF;
  -- Only the holder: this person, on this device, at this generation.
  IF s.state IS DISTINCT FROM 'active' OR s.holder_user_id IS DISTINCT FROM app_user_id()
     OR p_device IS NULL OR s.holder_device IS DISTINCT FROM p_device
     OR p_epoch IS NULL OR s.epoch IS DISTINCT FROM p_epoch THEN
    RETURN QUERY SELECT false, 'not_token_holder'::text, s.epoch; RETURN;
  END IF;
  -- Never with a ball still on the phone.
  IF p_pending IS NULL OR p_pending <> 0 THEN
    RETURN QUERY SELECT false, 'unsynced_work'::text, s.epoch; RETURN;
  END IF;
  UPDATE scoring_session x SET state = 'idle', epoch = s.epoch + 1, holder_user_id = NULL, holder_device = NULL,
         lease_until = NULL, handover_code = NULL, handover_to = NULL, claimant_user_id = NULL,
         claimant_device = NULL, updated_at = now()
   WHERE x.match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, epoch)
  VALUES (p_match, s.school_id, 'pen_released', app_user_id(), s.holder_user_id, s.epoch + 1);
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  Who may call what
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['match_finalise(uuid)', 'scoring_release(uuid,text,integer,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['app_can_but_scorer(text,uuid,text,uuid,uuid)', 'match_decided_notice(uuid)',
                           'match_decided_after_events()', 'match_decided_after_decision()',
                           'match_decided_notice_done()'] LOOP
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
-- The behaviour is asserted live in db/99 §146.
DO $check$
DECLARE f text; r text; src text;
BEGIN
  FOREACH f IN ARRAY ARRAY['match_finalise(uuid)', 'scoring_release(uuid,text,integer,integer)',
                           'app_can_but_scorer(text,uuid,text,uuid,uuid)', 'match_decided_notice(uuid)',
                           'match_decided_after_events()', 'match_decided_after_decision()',
                           'match_decided_notice_done()'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/171: % is not SECURITY DEFINER', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/171: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/171: % is executable by PUBLIC', f;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.rolname = r AND has_function_privilege(ro.oid, f::regprocedure, 'EXECUTE')) THEN
        RAISE EXCEPTION 'db/171: % is executable by a managed host''s API role (%)', f, r;
      END IF;
    END LOOP;
    IF (SELECT prosrc FROM pg_proc WHERE oid = f::regprocedure) ~* '\mcurrent_date\M' THEN
      RAISE EXCEPTION 'db/171: % reads the database''s day (db/128)', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('scrbrd_app', 'match_finalise(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'scoring_release(uuid,text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/171: the application cannot call match_finalise() or scoring_release()';
  END IF;
  IF has_function_privilege('scrbrd_app', 'app_can_but_scorer(text,uuid,text,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'match_decided_notice(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/171: the application can call app_can_but_scorer() or match_decided_notice(): they are the owner''s';
  END IF;

  -- The copy: app_can()'s body bar its one line.
  IF replace((SELECT prosrc FROM pg_proc WHERE oid = 'app_can_but_scorer(text,uuid,text,uuid,uuid)'::regprocedure),
             chr(10) || '       AND a.role <> ''scorer''', '')
     IS DISTINCT FROM (SELECT prosrc FROM pg_proc WHERE oid = 'app_can(text,uuid,text,uuid,uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/171: app_can_but_scorer() is not app_can()''s body bar its one line';
  END IF;

  -- db/130's and db/132's promises, kept: the capability at the home side
  -- before the lock, the scorer's refusal before it too, the session locked,
  -- the status through the table, the audit row, held_elsewhere last.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'match_finalise(uuid)'::regprocedure;
  IF position('app_can(''scoring.finalise'', match_school(p_match), match_team(p_match), NULL, p_match)' IN src) = 0
     OR position('app_can(''scoring.finalise''' IN src) > position('FOR UPDATE' IN src)
     OR position('app_can_but_scorer(''scoring.finalise'', match_school(p_match), match_team(p_match), NULL, p_match)' IN src) = 0
     OR position('app_can_but_scorer(' IN src) > position('FOR UPDATE' IN src)
     OR position('app_can(''scoring.finalise''' IN src) > position('app_can_but_scorer(' IN src) THEN
    RAISE EXCEPTION 'db/171: match_finalise() does not ask scoring.finalise, then the scorer''s rule, at the home side before it locks';
  END IF;
  IF position('UPDATE match SET status = ''complete'' WHERE id = p_match' IN src) = 0
     OR position('''match_finalised''' IN src) = 0
     OR position('PERFORM 1 FROM scoring_session s WHERE s.match_id = p_match FOR UPDATE' IN src) = 0
     OR position('''held_elsewhere''' IN src) < position('match_completion_refusal(p_match)' IN src) THEN
    RAISE EXCEPTION 'db/171: match_finalise() lost db/130''s or db/132''s steps';
  END IF;

  -- The release asks the holder, and the pad's empty queue, before it lets go.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'scoring_release(uuid,text,integer,integer)'::regprocedure;
  IF position('s.holder_user_id IS DISTINCT FROM app_user_id()' IN src) = 0
     OR position('s.holder_device IS DISTINCT FROM p_device' IN src) = 0
     OR position('s.epoch IS DISTINCT FROM p_epoch' IN src) = 0
     OR position('''unsynced_work''' IN src) = 0
     OR position('''unsynced_work''' IN src) > position('UPDATE scoring_session' IN src)
     OR position('epoch = s.epoch + 1' IN src) = 0 THEN
    RAISE EXCEPTION 'db/171: scoring_release() does not ask the holder and the empty queue before it lets go, or keeps the epoch';
  END IF;

  -- The triggers are in place.
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'
        AND ((tgrelid = 'ball_event'::regclass AND tgname = 'ball_event_match_decided')
          OR (tgrelid = 'match_result_decision'::regclass AND tgname = 'match_decided_after_decision')
          OR (tgrelid = 'match'::regclass AND tgname = 'match_decided_notice_done'))) <> 3 THEN
    RAISE EXCEPTION 'db/171: a trigger this file relies on is missing or disabled';
  END IF;
END $check$;

RESET lock_timeout;

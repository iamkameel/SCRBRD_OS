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
-- WHAT "CONFIRM" IS, AND IS NOT (Kameel, 20 Nov 2026: "keep the
-- separation"). The coach's confirm is db/130's finish: the match is
-- complete. The official result stays the director of sport's or the
-- organiser's, through db/114 (OFFICIAL_RESULT D3 unchanged); nothing here
-- touches it.
--
--
-- HOW TO PASTE. One transaction: the SQL editor's single run, or
-- psql -1 -v ON_ERROR_STOP=1 -f. Statement by statement, the new functions
-- would stand executable by PUBLIC until the grants block ran. After db/169
-- and db/170 (the order is fixed: db/169 re-emits app_can(), whose live body
-- §1 copies). Not while a match is being finished: between this paste and
-- the API built with it, a scorer's Finish answers coach_confirms through the
-- old API as an unworded 422. A match merely live is fine: the three triggers
-- take their tables' SHARE ROW EXCLUSIVE lock until commit, so a ball write
-- waits that long (well under a second), bounded by the 10 s lock_timeout; a
-- refused paste is pasted again.
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
--   + app_can_but_scorer()  app_can()'s body as the database holds it at
--       the paste, and one line: AND a.role <> 'scorer', placed under its
--       WHERE a.person_id = app_user_id() (db/129's app_can_but_player() is
--       the pattern). Built from the catalog (pg_get_functiondef, as db/128
--       and db/169 re-emit bodies), so it carries whatever app_can() holds
--       then — db/169's pupil sign-in gate included — and the paste fails
--       loudly unless the anchor is there exactly once. The owner's alone:
--       match_finalise() asks it. Checked below, and in db/99 §146 (copy),
--       to be app_can()'s live body bar its one line: a later file that
--       re-emits app_can() re-emits this too.
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
--       is named, in the title, the body or on a lock screen. The shape —
--       fixture, scoring.finalise, a recipient, the match, the title's end —
--       is this file's marker; the partial index notification_decided_subject
--       finds them.
--       ONCE per match and person while it stands: a notice already live
--       (not retracted, not expired) is not written again, however often the
--       log is re-read (a re-sent batch writes no event and asks nothing).
--       Not decided any more (a correction took the winning ball away): each
--       live notice is taken back through notification_retract() (db/89) as
--       superseded, unsaid (a fixture notice's word, D2; nothing told the
--       coach a false thing a "withdrawn" notice would correct, and nothing
--       pages him twice). Decided again later: a NEW notice, so the coach is
--       paged again — a superseded notice is not returned (db/113's
--       un-retract is a correction's alone), unlike a milestone's D19.
--   + When it is asked (match_decided_after_events(), statement-level on
--       ball_event; match_decided_after_decision() on match_result_decision):
--       a batch with an event that can move the outcome after the balls —
--       innings_end (the scorer's seal, the end of every innings and of a
--       super over), revision, target, par or penalty — or a void that can
--       un-decide it (one while a decided notice stands) or restore a ball (a
--       void of a void); and an organiser's decision recorded or withdrawn.
--       NOT every ball, nor every undo: the fold is a full replay (about 50 ms
--       at a 20-over match), and the chase's balls and undos are the scoring
--       hot path; a plain undo with no decided notice standing cannot decide a
--       match (it takes a ball away), so it asks nothing. A chase that
--       reaches its target is decided on the fold at that ball, and the pad
--       then asks the scorer to confirm the innings closed; the notice goes
--       with that seal, seconds later. A scorebook's commit (db/63) completes
--       its own match and is not asked.
--   + match_decided_notice_done()  AFTER UPDATE OF status on match, from live
--       to anything else (complete, abandoned, postponed, scheduled): the act
--       the notice asks for is done, or there is no result to confirm now, so
--       its live notices are taken back, superseded and unsaid.
--   A notice never fails the scorer's write: each is asked in its own
--   sub-transaction, and an error in it is a WARNING in the server's log with
--   its SQLSTATE. It does add one replay to the write that asks it, and a
--   cancel (a statement_timeout, which nothing here sets) is not an error
--   that sub-transaction catches: it cancels the write, as it would any.
--
-- ══ 3 · THE SCORER PUTS THE PEN DOWN FROM THE END SCREEN ══════════
--   + scoring_release(match, device, epoch, pending) → (ok, reason, epoch)
--       The token holder's own release: today the coach's Confirm waits up to
--       90 s for the scorer's lease to lapse (db/132's held_elsewhere). In
--       order: scoring.edit at the match (or no_capability; under a pad
--       credential app_can() admits it at the credential's own match, db/50);
--       the session locked; the caller is the holder — the same person, the
--       device his signed token names (app_device_id(), and the device the
--       route passes must be that one), the same generation — or
--       not_token_holder (a lapsed lease nobody has taken is still his to put
--       down); a handover he armed, or one being verified, is said by its own
--       name (handover_pending, verifying); the pad says nothing is left to
--       send (pending = 0) or unsynced_work, as scoring_arm_handover() asks
--       it. Then the session goes idle with the epoch bumped, as
--       scoring_force_release() leaves it: a ball still in flight under the
--       old generation is quarantined (db/33), never lost and never written
--       into the log behind the release. db/50's trigger ends the pad's
--       resume credential ('released'). One scoring_audit row, event
--       'pen_released', with the device it let go of (detail.device).
--       It does not end scoring: a later ball needs a claim, as any idle
--       match does; a finished match refuses that claim (db/33).
--   ~ second_account_notice() (db/135)  db/135's body and one step: a ball
--       set aside from the very phone that released, while the session is
--       idle and its last letting-go was that release, is not a "second
--       account" (it is the releasing phone's late ball). It is set aside for
--       review as before; nobody is told of a second phone.
--
-- WHO MAY CALL WHAT (every definer here pins its search_path)
--   match_finalise(uuid), scoring_release(uuid,text,integer,integer)   scrbrd_app
--   app_can_but_scorer(…), match_decided_notice(uuid)                 the owner's: nobody
--   match_decided_after_events(), match_decided_after_decision(),
--   match_decided_notice_done(), second_account_notice()               triggers: nobody
-- And none to PUBLIC, nor to a managed host's anon, authenticated or
-- service_role.
--
-- EXISTING ROWS. Nothing changed or deleted; no table, no column; one
-- partial index on notification (the decided notices: none yet). A match
-- already decided and live when this is pasted is told at its next seal,
-- void or decision, or never (its coach confirms it from the screens as
-- today). Safe to run twice: CREATE OR REPLACE throughout, CREATE INDEX IF
-- NOT EXISTS, and grants that end where they began. Nothing is dropped.
--
-- SCHEMA FIRST. The API built with it calls scoring_release() and words
-- coach_confirms; this file goes before it and is in
-- services/api/expected-migrations.json.

SET lock_timeout = '10s';

-- ── 0 · What it needs, and what it replaces ────────────────────────
DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regprocedure('match_result_compute(uuid)') IS NULL OR to_regprocedure('match_completion_refusal(uuid)') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('app_device_id()') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('notification_retract(uuid,text,boolean)') IS NULL
     OR to_regprocedure('fixture_side_label(uuid,text)') IS NULL OR to_regprocedure('person_is_pupil(uuid)') IS NULL
     OR to_regprocedure('sa_today()') IS NULL OR to_regprocedure('second_account_notice()') IS NULL
     OR to_regclass('scoring_session') IS NULL OR to_regclass('scoring_audit') IS NULL
     OR to_regclass('match_result_decision') IS NULL OR to_regclass('support_access') IS NULL
     OR to_regclass('duty_suspension') IS NULL THEN
    RAISE EXCEPTION 'db/171: the finish (db/130, db/132), the fold (db/69, db/71), the retraction (db/89), the pupil test (db/116), the SA day (db/128) or the second-account notice (db/135) is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('match_finalise(uuid)',     '03b8a550d38ea96ea67b8a38b9930f7b', '650d240295cb35bb736308b8a35339b7', 'db/132'),
      ('second_account_notice()', 'ee78b5030c3d9d641303288c44664b73',                       'bfd89d4d1b22ce382a627e3a18555940', 'db/135'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/171: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
--  1 · The scorer's part ends at the last ball
-- ══════════════════════════════════════════════════════════════════
-- ── app_can(), over every assignment but a `scorer` one ────────────
-- app_can()'s live definition, renamed, with one line under its anchor. The
-- anchor must be there exactly once; otherwise nothing is made.
DO $copy$
DECLARE
  A    constant text := '     WHERE a.person_id = app_user_id()' || chr(10);
  v_def text;
  n     int;
BEGIN
  v_def := pg_get_functiondef('app_can(text,uuid,text,uuid,uuid)'::regprocedure);
  n := (length(v_def) - length(replace(v_def, A, ''))) / length(A);
  IF n <> 1 THEN
    RAISE EXCEPTION 'db/171: app_can()''s body holds its anchor (WHERE a.person_id = app_user_id()) % times, not once; look before copying it', n;
  END IF;
  IF position('CREATE OR REPLACE FUNCTION public.app_can(' IN v_def) <> 1 THEN
    RAISE EXCEPTION 'db/171: app_can()''s definition does not start as expected; look before copying it';
  END IF;
  v_def := 'CREATE OR REPLACE FUNCTION public.app_can_but_scorer(' || substr(v_def, length('CREATE OR REPLACE FUNCTION public.app_can(') + 1);
  v_def := replace(v_def, A, A || '       AND a.role <> ''scorer''' || chr(10));
  EXECUTE v_def;
END $copy$;

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
-- The decided notices of a match, found by subject (the marker's own rows).
CREATE INDEX IF NOT EXISTS notification_decided_subject ON notification (subject_id)
  WHERE required_capability = 'scoring.finalise' AND recipient_id IS NOT NULL;

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
                 WHERE n.subject_id = p_match AND n.required_capability = 'scoring.finalise'
                   AND n.recipient_id IS NOT NULL AND n.kind = 'fixture' AND n.subject_kind = 'match'
                   AND n.title LIKE '% is decided. Confirm the result.'
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
                    WHERE n.subject_id = p_match AND n.required_capability = 'scoring.finalise'
                      AND n.recipient_id = p AND n.kind = 'fixture' AND n.subject_kind = 'match'
                      AND n.title LIKE '% is decided. Confirm the result.'
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

-- A batch that can move the outcome: each live match in it, once.
CREATE OR REPLACE FUNCTION match_decided_after_events() RETURNS trigger AS $$
DECLARE v_m uuid;
BEGIN
  -- A scorebook's commit (db/63) completes its own match.
  IF coalesce(current_setting('scrbrd.scorebook_commit', true), '') <> '' THEN RETURN NULL; END IF;
  FOR v_m IN
    SELECT n.match_id FROM match_decided_new_events n
     WHERE n.kind IN ('innings_end', 'revision', 'target', 'par', 'penalty')
        -- An undo takes a ball away: it can un-decide a match, never decide
        -- one, so it asks only while a decided notice stands — or when it
        -- voids a void, which puts a ball back.
        OR (n.kind = 'void'
            AND (EXISTS (SELECT 1 FROM notification x
                          WHERE x.subject_id = n.match_id AND x.required_capability = 'scoring.finalise'
                            AND x.recipient_id IS NOT NULL AND x.title LIKE '% is decided. Confirm the result.'
                            AND x.retracted_at IS NULL)
                 OR EXISTS (SELECT 1 FROM ball_event t
                             WHERE t.match_id = n.match_id AND t.idempotency_key = n.payload->>'target' AND t.kind = 'void')))
     GROUP BY n.match_id
  LOOP
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

-- An organiser's decision recorded or withdrawn: the outcome moved without an event.
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

-- No longer live (finished, called off, put off): the notice's act is done,
-- or there is no result to confirm now.
CREATE OR REPLACE FUNCTION match_decided_notice_done() RETURNS trigger AS $$
DECLARE v_id uuid;
BEGIN
  BEGIN
    FOR v_id IN SELECT n.id FROM notification n
                 WHERE n.subject_id = NEW.id AND n.required_capability = 'scoring.finalise'
                   AND n.recipient_id IS NOT NULL AND n.kind = 'fixture' AND n.subject_kind = 'match'
                   AND n.title LIKE '% is decided. Confirm the result.'
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
  FOR EACH ROW WHEN (OLD.status = 'live' AND NEW.status IS DISTINCT FROM 'live')
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
  -- Only the holder: this person, on the device his token names, at this generation.
  IF s.holder_user_id IS DISTINCT FROM app_user_id()
     OR p_device IS NULL OR s.holder_device IS DISTINCT FROM p_device OR p_device IS DISTINCT FROM app_device_id()
     OR p_epoch IS NULL OR s.epoch IS DISTINCT FROM p_epoch THEN
    RETURN QUERY SELECT false, 'not_token_holder'::text, s.epoch; RETURN;
  END IF;
  -- His own handover under way: said by its name, and the pen stays where it is.
  IF s.state IN ('handover_pending', 'verifying') THEN
    RETURN QUERY SELECT false, s.state::text, s.epoch; RETURN;
  END IF;
  IF s.state IS DISTINCT FROM 'active' THEN
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
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, epoch, detail)
  VALUES (p_match, s.school_id, 'pen_released', app_user_id(), s.holder_user_id, s.epoch + 1,
          jsonb_build_object('device', s.holder_device));
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── second_account_notice(): db/135's, with the releasing phone's step (marked db/171) ──
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
  -- db/171: the phone that put the pen down (scoring_release()) is not a
  -- second phone. While the session is idle and its last letting-go was
  -- this person's release on this device, his late ball is set aside (as
  -- before) and nobody is told of a second account.
  IF v_dev IS NULL AND EXISTS (
       SELECT 1 FROM scoring_session s WHERE s.match_id = NEW.match_id AND s.state = 'idle')
     AND EXISTS (
       SELECT 1 FROM (SELECT a.event, a.actor_id, a.detail FROM scoring_audit a
                       WHERE a.match_id = NEW.match_id AND a.event IN ('pen_released', 'force_release')
                       ORDER BY a.at DESC, a.id DESC LIMIT 1) last
        WHERE last.event = 'pen_released' AND last.actor_id IS NOT DISTINCT FROM NEW.scorer_user_id
          AND last.detail->>'device' IS NOT DISTINCT FROM NEW.device_id) THEN
    RETURN NULL;
  END IF;
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
                           'match_decided_notice_done()', 'second_account_notice()'] LOOP
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
                           'match_decided_notice_done()', 'second_account_notice()'] LOOP
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
     OR position('epoch = s.epoch + 1' IN src) = 0
     OR position('jsonb_build_object(''device'', s.holder_device)' IN src) = 0
     OR position('p_device IS DISTINCT FROM app_device_id()' IN src) = 0 THEN
    RAISE EXCEPTION 'db/171: scoring_release() does not ask the holder and the empty queue before it lets go, or keeps the epoch';
  END IF;

  -- The releasing phone's late ball is not a second account (S1 of the review).
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'second_account_notice()'::regprocedure;
  IF position('last.event = ''pen_released''' IN src) = 0 OR position('last.detail->>''device'' IS NOT DISTINCT FROM NEW.device_id' IN src) = 0 THEN
    RAISE EXCEPTION 'db/171: second_account_notice() does not know the releasing phone';
  END IF;

  -- The triggers are in place.
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'
        AND ((tgrelid = 'ball_event'::regclass AND tgname = 'ball_event_match_decided')
          OR (tgrelid = 'match_result_decision'::regclass AND tgname = 'match_decided_after_decision')
          OR (tgrelid = 'match'::regclass AND tgname = 'match_decided_notice_done')
          OR (tgrelid = 'ball_event_quarantine'::regclass AND tgname = 'second_account_notice'))) <> 4 THEN
    RAISE EXCEPTION 'db/171: a trigger this file relies on is missing or disabled';
  END IF;
END $check$;

RESET lock_timeout;

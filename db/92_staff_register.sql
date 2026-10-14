-- ══════════════════════════════════════════════════════════════════
--  92 · The school staff register (SCRBRD-140 phase 2)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-140_phase2_register.md
-- (decided, Kameel 2026-10-13: every call as recommended). Its proof is
-- db/99 §73; the API walk is tools/smoke-staff-register.mjs.
--
-- A REGISTER ROW IS ONE GRANT THE OFFICE DECIDED IN ADVANCE. The office lists
-- its staff (name, work email, role, side, a claim-by date); each row is
-- checked against exactly the authority a hand grant is checked against
-- (app_can('user.role.assign') and app_may_grant_at(), db/77) at upload, and
-- the uploader is checked AGAIN when the row is claimed. A staff member
-- claims by signing in with Google and choosing the school: the match is the
-- address Google verified for that sign-in (auth_identity.email_at_link,
-- db/81), lower-cased, exact, never app_user.email. Every open row for that
-- address at that school is claimed in one call; a row claims once.
--
-- ONE DOOR. The grant half of decide_role_request() is factored out into
-- role_request_grant_as(request, decider, note, player, team): the office's
-- Requests screen and the register both grant through it, with the same
-- rules. decide_role_request() keeps the lookup, the caller's authority and
-- the decline, and ends by calling it with app_user_id() as the decider; the
-- register calls it with the row's uploader. It is internal (no EXECUTE for
-- the application) and the check at the foot asserts those two are its only
-- callers. The body is md5-guarded against db/81's patched text, and the
-- moved half is checked to be that text with app_user_id() → p_decider.
--
-- WHAT CANNOT BE GRANTED BECOMES AN ORDINARY REQUEST. An uploader who has
-- since lost the authority, a pupil's account, a role now over the ceiling,
-- or a refusal from the body or from any trigger on role_assignment: the
-- row is consumed as `requested`, the person's pending request stays for the
-- office to decide by hand, and the person reads the same sentence a
-- no-match reads.
--
-- THREE FENCES on what a row may hold, from the inside out:
--   no_child_role   (CHECK) guardian, selfaccess, enquiry, player, dso
--   app_may_grant_at()      the uploader's own authority, and the platform
--                           roles (refused by name as well: a platform
--                           uploader's floor would not refuse them)
--   THE CEILING (P2-D3)     any role whose bundle holds medical.details.read,
--                           discipline.read or a safeguarding.* capability,
--                           read from role_capability when asked, never a list
--
-- THE FIRST DOOR (P2-D4). A claim is refused — read as the ordinary request
-- path — when the caller holds ANY active assignment at the school, live,
-- dated out or paused under a duty_suspension.
--
-- RETENTION (P2-D13). An unclaimed row's name and email are replaced ninety
-- days after it expired or was withdrawn, when somebody at the school
-- presses "Clear" (register_redact()). Nothing here runs unattended; the
-- scheduled job is the lead's later call.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   school_register         new table: RLS on, no policy, no privilege for
--                           the application (auth_identity's shape, db/81)
--   decide_role_request()   re-emitted: the grant half moves, unchanged, into
--                           role_request_grant_as(); its rights are kept
--   app_may_grant_at_for(), app_may_assign_at_for(), role_request_grant_as(),
--   register_role_over_ceiling(), register_log()            new, internal
--   register_upload(), register_claim(), register_withdraw(),
--   school_register_rows(), register_redact_due(), register_redact()
--                                                           new, the doors
-- No row is inserted, changed or deleted. Nothing is dropped.
--
-- search_path pinned on every function (db/16).


-- ── 1 · The table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS school_register (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  email            text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 320
                                        AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name             text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  role             text NOT NULL,
  team_code        text,
  -- The row's claim window, not the role's life (P2-D6): a register grant is
  -- open-ended, as a hand grant is, and End role is the office's lever.
  valid_until      date NOT NULL,
  uploaded_by      uuid NOT NULL REFERENCES app_user(id),
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  upload_id        uuid NOT NULL,
  -- The recently-ended warning the uploader acknowledged (§1.6).
  warned_ended_on  date,
  claimed_at       timestamptz,
  claimed_by       uuid REFERENCES app_user(id),
  claimed_identity uuid REFERENCES auth_identity(id),
  claimed_request  uuid REFERENCES role_request(id),
  outcome          text CHECK (outcome IN ('granted', 'requested')),
  outcome_reason   text CHECK (outcome_reason IN ('uploader_authority_lapsed', 'refused')),
  withdrawn_at     timestamptz,
  withdrawn_by     uuid REFERENCES app_user(id),
  redacted_at      timestamptz,
  CONSTRAINT claimed_whole CHECK ((claimed_at IS NULL) = (claimed_by IS NULL) AND (claimed_at IS NULL) = (outcome IS NULL)),
  CONSTRAINT open_or_done  CHECK (NOT (claimed_at IS NOT NULL AND withdrawn_at IS NOT NULL)),
  CONSTRAINT no_child_role CHECK (role NOT IN ('guardian', 'selfaccess', 'enquiry', 'player', 'dso')),
  CONSTRAINT withdrawn_names_who CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL)),
  -- A claimed row is the record of a grant and is kept as it is (§1.8).
  CONSTRAINT redacted_unclaimed CHECK (redacted_at IS NULL OR claimed_at IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_register_one_open
  ON school_register (school_id, email, role, coalesce(team_code, ''))
  WHERE claimed_at IS NULL AND withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS school_register_email_idx
  ON school_register (school_id, email) WHERE claimed_at IS NULL AND withdrawn_at IS NULL;

COMMENT ON TABLE school_register IS
  'SCRBRD-140 phase 2: one grant the office decided in advance, claimed by the verified Google address. Read and written only through the register_* functions (db/92).';

-- login_code's shape (db/05), as auth_identity and pending_claim (db/81):
-- RLS on, no policy, and no privilege either.
ALTER TABLE school_register ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_register FROM scrbrd_app;


-- ── 2 · The uploader's authority, asked about somebody else ─────────
-- app_may_grant_at() (db/77) asks about the caller. At claim time the
-- question is about the UPLOADER, who is not the caller. Rather than a copy
-- that could drift, app_may_grant_at_for() is generated here from the body
-- in place: app_user_id() → p_person, the pad clause (a property of the
-- caller's credential, not of the person) taken out, and the account's own
-- `active` asked instead. The check at the foot, and db/99 §73 on every
-- verify, assert the two still agree, so a later re-emit of one without the
-- other is caught. The body this produces reads:
--
--   SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.active) AND EXISTS (
--     SELECT 1 FROM role_assignment a JOIN role_grantable g ON ...
--      WHERE a.person_id = p_person AND <db/77's liveness, scope and floor> )
DO $mirror$
DECLARE
  v_src  text := (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'app_may_grant_at(text,uuid)'::regprocedure);
  v_pad  text := 'SELECT NOT app_pad_scoped() AND EXISTS (';
  v_body text;
BEGIN
  IF (length(v_src) - length(replace(v_src, v_pad, ''))) / length(v_pad) <> 1
     OR (length(v_src) - length(replace(v_src, 'app_user_id()', ''))) / length('app_user_id()') <> 1 THEN
    RAISE EXCEPTION 'db/92: app_may_grant_at() is not db/77''s shape any more (one pad clause, one app_user_id()); mirror the version now in place';
  END IF;
  v_body := replace(replace(v_src, v_pad,
                            'SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.active) AND EXISTS ('),
                    'app_user_id()', 'p_person');
  EXECUTE format('CREATE OR REPLACE FUNCTION app_may_grant_at_for(p_person uuid, p_role text, p_school uuid) '
                 'RETURNS boolean AS %L LANGUAGE sql STABLE SECURITY DEFINER '
                 'SET search_path = pg_catalog, public, pg_temp', v_body);
END $mirror$;

COMMENT ON FUNCTION app_may_grant_at_for(uuid, text, uuid) IS
  'db/92: app_may_grant_at() (db/77) about p_person instead of the caller, generated from its body; the pad clause dropped, the account''s active asked. Internal.';

-- May this person appoint anybody at this school? A live assignment of
-- theirs, at the school or the platform's, whose role holds user.role.assign
-- — with app_enrolled()'s liveness clauses (db/81): active, in its dates,
-- not past its hour, not suspended.
CREATE OR REPLACE FUNCTION app_may_assign_at_for(p_person uuid, p_school uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'user.role.assign'
     WHERE a.person_id = p_person
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       AND (a.school_id IS NULL OR (p_school IS NOT NULL AND a.school_id = p_school))
       AND a.team_code IS NULL
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- THE CEILING (P2-D3, decided): a role whose bundle reaches a child's
-- clinical notes, a disciplinary record or a safeguarding concern is granted
-- by hand, with the person in front of the office. Read from role_capability
-- when asked, so it follows roles.mjs with no second list.
CREATE OR REPLACE FUNCTION register_role_over_ceiling(p_role text) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM role_capability rc
                  WHERE rc.role = p_role
                    AND (rc.capability IN ('medical.details.read', 'discipline.read')
                         OR rc.capability LIKE 'safeguarding.%'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The record of an act on the register: auth_identity_log()'s shape (db/81)
-- with the register's school.
CREATE OR REPLACE FUNCTION register_log(p_resource text, p_school uuid, p_ids uuid[]) RETURNS void AS $$
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count, device_id)
  VALUES (p_school, app_user_id(), p_resource, coalesce(p_ids, '{}'), coalesce(cardinality(p_ids), 0), app_device_id())
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · One door: the grant half of decide_role_request() ──────────
-- Guarded: the function in place must be db/81's patched text (its md5,
-- taken from a database at db/91), or already call role_request_grant_as()
-- (a second run). The text it had is kept for the check in §3c.
CREATE TEMP TABLE IF NOT EXISTS _db92_decide (src text, cfg text, acl text, sec boolean, fresh boolean) ON COMMIT DROP;
DO $guard$
DECLARE
  v_fn  regprocedure := 'decide_role_request(uuid,boolean,text,uuid,text)'::regprocedure;
  v_src text; v_cfg text; v_acl text; v_sec boolean;
BEGIN
  SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef
    INTO v_src, v_cfg, v_acl, v_sec FROM pg_proc p WHERE p.oid = v_fn;
  IF position('role_request_grant_as(' IN v_src) > 0 THEN
    INSERT INTO _db92_decide VALUES (v_src, v_cfg, v_acl, v_sec, false);   -- a second run
    RETURN;
  END IF;
  IF md5(v_src) IS DISTINCT FROM '4c97a54a4c6617c868f55f918287836a' THEN
    RAISE EXCEPTION 'db/92: decide_role_request() is not db/81''s (db/62 + db/77 + db/81 + db/86) any more; factor the version now in place and move its hash';
  END IF;
  INSERT INTO _db92_decide VALUES (v_src, v_cfg, v_acl, v_sec, true);
END $guard$;

-- ── 3a · role_request_grant_as(): the grant, for a decider already checked ──
-- From "db/86" to the last RETURN, this is decide_role_request()'s body as it
-- stood after db/81, every app_user_id() → p_decider (the assignment
-- subject's verified_by and created_by, and the request's decided_by). The
-- caller has established the decider's authority: the office's own, in
-- decide_role_request(); the uploader's, re-checked, in register_claim().
--
-- Not the role_assignment row's created_by: db/01's
-- role_assignment_stamp_granter() stamps that from the session, whatever
-- the writer says, and db/01 is frozen. A register grant's assignment is
-- created_by the person who claimed it; the request's decided_by names the
-- uploader.
CREATE OR REPLACE FUNCTION role_request_grant_as(p_request uuid, p_decider uuid, p_note text, p_player uuid, p_team text)
RETURNS TABLE (ok boolean, reason text, assignment_id uuid) AS $$
DECLARE r role_request%ROWTYPE; v_asg uuid; v_self uuid; v_player uuid; v_team text; v_born date;
BEGIN
  IF p_decider IS NULL THEN RETURN QUERY SELECT false, 'not_permitted', NULL::uuid; RETURN; END IF;
  SELECT * INTO r FROM role_request WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_request', NULL::uuid; RETURN; END IF;
  IF r.state <> 'pending' THEN RETURN QUERY SELECT false, 'already_decided', NULL::uuid; RETURN; END IF;
  -- db/86: a platform role belongs to no school, and a request always names
  -- one. Declining it (above) still works; granting it never does.
  IF r.role IN ('superadmin', 'platformadmin') AND r.school_id IS NOT NULL THEN
    RETURN QUERY SELECT false, 'platform_role_needs_no_school', NULL::uuid; RETURN;
  END IF;
  v_player := coalesce(p_player, r.player_id);
  -- A coach is a coach OF A SIDE (assignment_team_scoped): the request names
  -- one, or the decider does, or it is not granted. Said by name rather than
  -- left to the constraint, so the office knows what to supply.
  v_team := coalesce(nullif(btrim(coalesce(p_team, '')), ''), r.team_code);
  IF r.role IN ('coach', 'assistantcoach', 'teammanager') AND v_team IS NULL THEN
    RETURN QUERY SELECT false, 'team_required', NULL::uuid; RETURN;
  END IF;
  IF v_player IS NOT NULL AND NOT EXISTS (SELECT 1 FROM player p WHERE p.id = v_player AND p.school_id = r.school_id) THEN
    RETURN QUERY SELECT false, 'player_not_at_that_school', NULL::uuid; RETURN;
  END IF;
  IF r.role IN ('guardian', 'selfaccess', 'enquiry') AND v_player IS NULL THEN
    RETURN QUERY SELECT false, 'player_required', NULL::uuid; RETURN;
  END IF;
  -- A guardianship granted here ends at the child's majority, exactly as one
  -- established by the office does — the same rule has to hold whichever door
  -- the link came through, or the shorter path becomes the way round it.
  -- `enquiry` keeps its own window, set by whoever granted it.
  --
  -- This sits with the other refusals, BEFORE the assignment is written, and
  -- that placement is the point: a plpgsql RETURN is not a rollback, so a
  -- guard downstream of the INSERT would answer false and still leave a live
  -- guardian assignment on the record with the request still pending — and
  -- the next attempt would write a second one.
  IF r.role = 'guardian' THEN
    SELECT p.born INTO v_born FROM player p WHERE p.id = v_player;
    IF v_born IS NULL THEN
      RETURN QUERY SELECT false, 'player_date_of_birth_required', NULL::uuid; RETURN;
    END IF;
    IF majority_on(v_born) <= current_date THEN
      RETURN QUERY SELECT false, 'player_is_an_adult', NULL::uuid; RETURN;
    END IF;
  END IF;
  INSERT INTO role_assignment (person_id, role, school_id, team_code)
  VALUES (r.person_id, r.role, r.school_id, v_team) RETURNING id INTO v_asg;
  IF r.role IN ('guardian', 'enquiry') THEN
    INSERT INTO assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at, consent_state, created_by, valid_until)
    VALUES (v_asg, v_player, CASE r.role WHEN 'guardian' THEN 'parent' ELSE 'enquiry' END, 'verified', p_decider, now(), 'pending', p_decider,
            -- Open while he is at school; his eighteenth birthday otherwise (db/62).
            CASE WHEN r.role = 'guardian' AND NOT still_at_school(v_player) THEN majority_on(v_born) END);
  ELSIF r.role = 'selfaccess' THEN
    INSERT INTO assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at, consent_state, consent_version, consent_at, created_by)
    VALUES (v_asg, v_player, 'self', 'verified', p_decider, now(), 'granted', 'popia-2026-01', now(), p_decider);
  ELSIF r.role = 'player' AND v_player IS NOT NULL THEN
    -- A pupil holds both: the team role and his own record.
    UPDATE app_user SET player_id = v_player WHERE id = r.person_id;
    INSERT INTO role_assignment (person_id, role, school_id) VALUES (r.person_id, 'selfaccess', r.school_id) RETURNING id INTO v_self;
    INSERT INTO assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at, consent_state, consent_version, consent_at, created_by)
    VALUES (v_self, v_player, 'self', 'verified', p_decider, now(), 'granted', 'popia-2026-01', now(), p_decider);
  END IF;
  UPDATE app_user SET school_id = r.school_id WHERE id = r.person_id AND school_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM role_assignment pa WHERE pa.person_id = r.person_id AND pa.active AND pa.school_id IS NULL);
  UPDATE role_request SET state = 'granted', decided_by = p_decider, decided_at = now(), decided_note = p_note,
                          assignment_id = v_asg, player_id = v_player, team_code = v_team WHERE id = p_request;
  RETURN QUERY SELECT true, NULL::text, v_asg;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 3b · decide_role_request(): the lookup, the authority, the decline ──
-- Its first fourteen lines as db/81 left them; the grant goes through the
-- door with the caller as the decider. CREATE OR REPLACE keeps its rights
-- (db/08's), and §3c checks it kept its settings too.
CREATE OR REPLACE FUNCTION decide_role_request(p_request uuid, p_grant boolean, p_note text, p_player uuid DEFAULT NULL, p_team text DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text, assignment_id uuid) AS $$
DECLARE r role_request%ROWTYPE;
BEGIN
  SELECT * INTO r FROM role_request WHERE id = p_request;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_request', NULL::uuid; RETURN; END IF;
  IF r.state <> 'pending' THEN RETURN QUERY SELECT false, 'already_decided', NULL::uuid; RETURN; END IF;
  IF NOT (app_can('user.role.assign', r.school_id, '*', '00000000-0000-0000-0000-000000000000'::uuid,
                  '00000000-0000-0000-0000-000000000000'::uuid) AND app_may_grant_at(r.role, r.school_id)) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid; RETURN;
  END IF;
  IF NOT p_grant THEN
    UPDATE role_request SET state = 'declined', decided_by = app_user_id(), decided_at = now(), decided_note = p_note WHERE id = p_request;
    RETURN QUERY SELECT true, NULL::text, NULL::uuid; RETURN;
  END IF;
  -- db/92: the grant half is role_request_grant_as(), the one door the
  -- register grants through too. The decider is the caller, checked above.
  RETURN QUERY SELECT * FROM role_request_grant_as(p_request, app_user_id(), p_note, p_player, p_team);
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 3c · The factoring changed nothing else ──────────────────────────
DO $factored$
DECLARE
  o        _db92_decide%ROWTYPE;
  v_mark   text := '    RETURN QUERY SELECT true, NULL::text, NULL::uuid; RETURN;' || chr(10) || '  END IF;' || chr(10);
  v_from   text := '  -- db/86: a platform role belongs to no school';
  v_to     text := '  RETURN QUERY SELECT true, NULL::text, v_asg;' || chr(10);
  v_head   text; v_tail text; v_new text; v_door text; v_cut int;
BEGIN
  SELECT * INTO o FROM _db92_decide;
  v_new  := (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'decide_role_request(uuid,boolean,text,uuid,text)'::regprocedure);
  v_door := (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'role_request_grant_as(uuid,uuid,text,uuid,text)'::regprocedure);
  IF (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = 'decide_role_request(uuid,boolean,text,uuid,text)'::regprocedure) IS DISTINCT FROM o.cfg
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'decide_role_request(uuid,boolean,text,uuid,text)'::regprocedure) IS DISTINCT FROM o.acl
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'decide_role_request(uuid,boolean,text,uuid,text)'::regprocedure) IS DISTINCT FROM o.sec THEN
    RAISE EXCEPTION 'db/92: re-emitting decide_role_request() changed its rights or settings';
  END IF;
  IF NOT o.fresh THEN RETURN; END IF;   -- a second run: the text it is checked against is gone
  -- The moved half: db/81's text from db/86's refusal to the grant's RETURN,
  -- with app_user_id() → p_decider, and nothing else.
  v_tail := substring(o.src FROM position(v_from IN o.src));
  v_tail := left(v_tail, position(v_to IN v_tail) + length(v_to) - 1);
  IF position(v_from IN o.src) = 0 OR position(v_to IN v_tail) = 0
     OR position(replace(v_tail, 'app_user_id()', 'p_decider') IN v_door) = 0 THEN
    RAISE EXCEPTION 'db/92: role_request_grant_as() is not decide_role_request()''s grant half with app_user_id() → p_decider';
  END IF;
  IF position('app_user_id()' IN v_door) > 0 THEN
    RAISE EXCEPTION 'db/92: role_request_grant_as() still asks app_user_id(); the decider is its argument';
  END IF;
  -- The half that stays: db/81's text up to the end of the decline, unchanged.
  v_cut  := position(v_mark IN o.src) + length(v_mark) - 1;
  v_head := substring(left(o.src, v_cut) FROM position('BEGIN' IN o.src));
  IF position(v_mark IN o.src) = 0 OR position(v_head IN v_new) = 0 THEN
    RAISE EXCEPTION 'db/92: decide_role_request()''s lookup, authority and decline are not db/81''s';
  END IF;
END $factored$;


-- ── 4 · Upload: check, then commit (§1.2, §1.3, §1.6) ──────────────
-- All or nothing, as the players import is: one bad row commits nothing.
-- A dry run by default. Each row is answered with a code the API turns into
-- words (services/api/write/register-api.mjs):
--   problems   name_invalid · email_invalid · guardian_row · child_role ·
--              dso_row · role_unknown · not_grantable_here · sensitive_role ·
--              team_required · team_invalid · team_unknown ·
--              valid_until_invalid · valid_until_past · valid_until_too_far ·
--              valid_until_required · duplicate_in_file · already_listed ·
--              too_many_for_email · already_holds_role · warning_not_acknowledged
--   a warning  recently_ended, with ended_on and the role ended (detail), and
--              `ack`: the key the commit must carry in p_acknowledged
--   the call   not_permitted · no_rows · too_many_rows (line 0)
-- An open row for the same person, role and side that has EXPIRED is
-- withdrawn by the commit that lists them again (by the uploader, stamped),
-- so the unique index lets the fresh row in; one still open is refused.
-- The default claim-by date is the end of the current school season (A-P2-1);
-- with no season row it must be typed. At most eighteen months out.
CREATE OR REPLACE FUNCTION register_upload(p_school uuid, p_rows jsonb, p_commit boolean DEFAULT false,
                                           p_acknowledged uuid[] DEFAULT '{}')
RETURNS TABLE (line integer, ok boolean, problem text, detail text, warning text, ended_on date,
               ack uuid, row_id uuid, upload_id uuid) AS $$
#variable_conflict use_column
DECLARE
  NIL       uuid := '00000000-0000-0000-0000-000000000000';
  v_me      uuid := app_user_id();
  v_default date;
  v_out     jsonb := '[]'::jsonb;
  v_seen    jsonb := '{}'::jsonb;
  v_count   jsonb := '{}'::jsonb;
  v_bad     boolean := false;
  e         jsonb;
  i         integer := 0;
  v_line    integer;
  v_name    text; v_email text; v_role text; v_team text; v_raw text; v_until date;
  v_problem text; v_detail text; v_warn text; v_ended date; v_ack uuid;
  v_key     text;
  v_upload  uuid;
  v_id      uuid;
  v_ids     uuid[] := '{}';
  v_row     jsonb;
  k         integer;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() OR p_school IS NULL
     OR NOT app_can('user.role.assign', p_school, '*'::text, NIL, NIL) THEN
    RETURN QUERY SELECT 0, false, 'not_permitted'::text, NULL::text, NULL::text, NULL::date, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN QUERY SELECT 0, false, 'no_rows'::text, NULL::text, NULL::text, NULL::date, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF jsonb_array_length(p_rows) > 200 THEN
    RETURN QUERY SELECT 0, false, 'too_many_rows'::text, '200'::text, NULL::text, NULL::date, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT s.ends_on INTO v_default FROM season s
   WHERE s.level = 'school' AND current_date BETWEEN s.starts_on AND s.ends_on
   ORDER BY s.ends_on LIMIT 1;

  FOR e IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    v_line := CASE WHEN jsonb_typeof(e->'line') = 'number' THEN (e->>'line')::numeric::integer ELSE i + 1 END;
    v_problem := NULL; v_detail := NULL; v_warn := NULL; v_ended := NULL; v_ack := NULL;
    v_name  := left(btrim(regexp_replace(coalesce(e->>'name', ''), '\s+', ' ', 'g')), 200);
    v_email := lower(btrim(coalesce(e->>'email', '')));
    v_role  := lower(btrim(coalesce(e->>'role', '')));
    v_team  := nullif(upper(btrim(coalesce(e->>'team_code', ''))), '');
    v_raw   := nullif(btrim(coalesce(e->>'valid_until', '')), '');
    v_until := NULL;

    IF length(v_name) NOT BETWEEN 2 AND 120 THEN
      v_problem := 'name_invalid';
    ELSIF length(v_email) > 320 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      v_problem := 'email_invalid';
    -- Fence one: the CHECK, said in words before it is reached.
    ELSIF v_role = 'guardian' THEN
      v_problem := 'guardian_row';
    ELSIF v_role IN ('selfaccess', 'enquiry', 'player') THEN
      v_problem := 'child_role';
    ELSIF v_role = 'dso' THEN
      v_problem := 'dso_row';
    ELSIF NOT EXISTS (SELECT 1 FROM role_grantable g WHERE g.role = v_role) THEN
      v_problem := 'role_unknown';
    -- Fence two: the uploader's own authority here, and never a platform role.
    ELSIF v_role IN ('superadmin', 'platformadmin') OR NOT app_may_grant_at(v_role, p_school) THEN
      v_problem := 'not_grantable_here';
    -- Fence three: the ceiling.
    ELSIF register_role_over_ceiling(v_role) THEN
      v_problem := 'sensitive_role';
    ELSIF v_role IN ('coach', 'assistantcoach', 'teammanager') AND v_team IS NULL THEN
      v_problem := 'team_required';
    ELSIF v_team IS NOT NULL AND team_age_group(v_team) IS NULL THEN
      v_problem := 'team_invalid'; v_detail := v_team;
    ELSIF v_team IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM player p WHERE p.school_id = p_school AND p.team_code = v_team)
          AND NOT EXISTS (SELECT 1 FROM role_assignment a WHERE a.school_id = p_school AND a.team_code = v_team)
          AND NOT EXISTS (SELECT 1 FROM match m WHERE m.school_id = p_school AND m.team_code = v_team) THEN
      v_problem := 'team_unknown'; v_detail := v_team;
    END IF;

    IF v_problem IS NULL THEN
      IF v_raw IS NULL THEN
        v_until := v_default;
        IF v_until IS NULL THEN v_problem := 'valid_until_required'; END IF;
      ELSIF v_raw !~ '^\d{4}-\d{2}-\d{2}$' THEN
        v_problem := 'valid_until_invalid';
      ELSE
        BEGIN
          v_until := v_raw::date;
        EXCEPTION WHEN others THEN
          v_problem := 'valid_until_invalid';
        END;
      END IF;
      IF v_problem IS NULL AND v_until < current_date THEN
        v_problem := 'valid_until_past';
      ELSIF v_problem IS NULL AND v_until > (current_date + interval '18 months')::date THEN
        v_problem := 'valid_until_too_far';
      END IF;
    END IF;

    IF v_problem IS NULL THEN
      v_key := v_email || '|' || v_role || '|' || coalesce(v_team, '');
      IF v_seen ? v_key THEN
        v_problem := 'duplicate_in_file'; v_detail := v_seen->>v_key;
      ELSE
        v_seen := v_seen || jsonb_build_object(v_key, v_line);
      END IF;
    END IF;

    IF v_problem IS NULL THEN
      SELECT to_char(g.valid_until, 'YYYY-MM-DD') INTO v_detail FROM school_register g
       WHERE g.school_id = p_school AND g.email = v_email AND g.role = v_role
         AND coalesce(g.team_code, '') = coalesce(v_team, '')
         AND g.claimed_at IS NULL AND g.withdrawn_at IS NULL AND g.valid_until >= current_date;
      IF FOUND THEN v_problem := 'already_listed'; ELSE v_detail := NULL; END IF;
    END IF;

    -- The accounts this address belongs to: the address the office typed on
    -- the account, or one Google verified for a live sign-in of it. Only
    -- their assignments AT THIS SCHOOL are ever spoken of.
    IF v_problem IS NULL THEN
      SELECT role_words(a.role) || coalesce(' (' || a.team_code || ')', '') INTO v_detail
        FROM role_assignment a JOIN app_user u ON u.id = a.person_id
       WHERE a.school_id = p_school AND a.active
         AND (lower(u.email) = v_email
              OR EXISTS (SELECT 1 FROM auth_identity x WHERE x.user_id = u.id AND x.revoked_at IS NULL
                                                         AND lower(x.email_at_link) = v_email))
       ORDER BY a.created_at, a.id LIMIT 1;
      IF FOUND THEN v_problem := 'already_holds_role'; ELSE v_detail := NULL; END IF;
    END IF;

    IF v_problem IS NULL THEN
      k := coalesce((v_count->>v_email)::integer, 0) + 1;
      v_count := v_count || jsonb_build_object(v_email, k);
      IF k + (SELECT count(*) FROM school_register g
               WHERE g.school_id = p_school AND g.email = v_email
                 AND g.claimed_at IS NULL AND g.withdrawn_at IS NULL AND g.valid_until >= current_date) > 5 THEN
        v_problem := 'too_many_for_email'; v_detail := '5';
      END IF;
    END IF;

    -- The twelve-month warning: an ending at this school in the last year,
    -- or an inactive assignment there that no ending row explains.
    IF v_problem IS NULL THEN
      SELECT w.on_day, w.words INTO v_ended, v_detail FROM (
        SELECT e2.ended_at::date AS on_day, role_words(e2.role) || coalesce(' (' || e2.team_code || ')', '') AS words, e2.ended_at AS at
          FROM role_assignment_ending e2 JOIN app_user u ON u.id = e2.person_id
         WHERE e2.school_id = p_school AND e2.ended_at > now() - interval '12 months'
           AND (lower(u.email) = v_email
                OR EXISTS (SELECT 1 FROM auth_identity x WHERE x.user_id = u.id AND x.revoked_at IS NULL
                                                           AND lower(x.email_at_link) = v_email))
        UNION ALL
        SELECT coalesce(a.revoked_at, a.created_at)::date, role_words(a.role) || coalesce(' (' || a.team_code || ')', ''),
               coalesce(a.revoked_at, a.created_at)
          FROM role_assignment a JOIN app_user u ON u.id = a.person_id
         WHERE a.school_id = p_school AND NOT a.active
           AND coalesce(a.revoked_at, a.created_at) > now() - interval '12 months'
           AND NOT EXISTS (SELECT 1 FROM role_assignment_ending e3 WHERE e3.assignment_id = a.id)
           AND (lower(u.email) = v_email
                OR EXISTS (SELECT 1 FROM auth_identity x WHERE x.user_id = u.id AND x.revoked_at IS NULL
                                                           AND lower(x.email_at_link) = v_email))
      ) w ORDER BY w.at DESC LIMIT 1;
      IF FOUND THEN
        v_warn := 'recently_ended';
        v_ack  := md5('register|' || p_school::text || '|' || v_email || '|' || v_ended::text)::uuid;
        IF p_commit AND NOT (v_ack = ANY (coalesce(p_acknowledged, '{}'))) THEN
          v_problem := 'warning_not_acknowledged';
        END IF;
      ELSE
        v_detail := NULL;
      END IF;
    END IF;

    IF v_problem IS NOT NULL THEN v_bad := true; END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line', v_line, 'ok', v_problem IS NULL, 'problem', v_problem, 'detail', v_detail,
      'warning', v_warn, 'ended_on', v_ended, 'ack', v_ack,
      'name', v_name, 'email', v_email, 'role', v_role, 'team', v_team, 'until', v_until));
  END LOOP;

  IF p_commit AND NOT v_bad THEN
    v_upload := gen_random_uuid();
    FOR k IN 0 .. jsonb_array_length(v_out) - 1 LOOP
      v_row := v_out->k;
      -- The same person, role and side listed before, past its date: done.
      UPDATE school_register g SET withdrawn_at = now(), withdrawn_by = v_me
       WHERE g.school_id = p_school AND g.email = v_row->>'email' AND g.role = v_row->>'role'
         AND coalesce(g.team_code, '') = coalesce(v_row->>'team', '')
         AND g.claimed_at IS NULL AND g.withdrawn_at IS NULL AND g.valid_until < current_date;
      INSERT INTO school_register (school_id, email, name, role, team_code, valid_until, uploaded_by, upload_id, warned_ended_on)
      VALUES (p_school, v_row->>'email', v_row->>'name', v_row->>'role', v_row->>'team', (v_row->>'until')::date, v_me, v_upload,
              (v_row->>'ended_on')::date)
      RETURNING id INTO v_id;
      v_ids := v_ids || v_id;
      v_out := jsonb_set(v_out, ARRAY[k::text, 'row_id'], to_jsonb(v_id));
    END LOOP;
    PERFORM register_log('register.upload', p_school, ARRAY[v_upload] || v_ids);
  END IF;

  RETURN QUERY
    SELECT (o->>'line')::integer, (o->>'ok')::boolean, o->>'problem', o->>'detail', o->>'warning',
           (o->>'ended_on')::date, (o->>'ack')::uuid, (o->>'row_id')::uuid, v_upload
      FROM jsonb_array_elements(v_out) WITH ORDINALITY AS t(o, n)
     ORDER BY t.n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 5 · Claim (§1.4, §1.5, §2.2) ───────────────────────────────────
-- For a signed-in account (never a pad's) with no active assignment at the
-- school. Matches the live sign-ins' verified addresses against the
-- school's open, in-date rows, in id order, each claimed through its own
-- request and grant. Answers one row per claimed register row
-- (role, team_code, outcome), or one row (NULL, NULL, 'no_match') — which is
-- also the answer for every refusal of the caller, so nothing is learned
-- from it.
--
-- STEP 2 MAY RAISE. A role_request INSERT passes its BEFORE INSERT triggers,
-- db/93's cooldown among them; that refusal is outside step 3's caught
-- block, so a person under a cooldown is answered the cooldown's own
-- check_violation, whatever the register holds (the lead's note (1)).
CREATE OR REPLACE FUNCTION register_claim(p_school uuid)
RETURNS TABLE (role text, team_code text, outcome text) AS $$
#variable_conflict use_column
DECLARE
  v_me      uuid := app_user_id();
  g         record;
  v_req     uuid;
  v_note    text;
  v_ok      boolean;
  v_why     text;
  v_out     text;
  v_any     boolean := false;
  v_granted text[] := '{}';
  v_asked   text[] := '{}';
  v_by      text;
  v_on      text;
  v_words   text;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() OR p_school IS NULL
     OR NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = v_me AND u.active)
     -- The register is the first door (P2-D4): anybody the school already
     -- holds, live, dated out or paused, is the office's one tap on People.
     OR EXISTS (SELECT 1 FROM role_assignment a WHERE a.person_id = v_me AND a.school_id = p_school AND a.active) THEN
    RETURN QUERY SELECT NULL::text, NULL::text, 'no_match'::text; RETURN;
  END IF;

  FOR g IN
    SELECT r.*,
           (SELECT x.id FROM auth_identity x
             WHERE x.user_id = v_me AND x.revoked_at IS NULL AND lower(x.email_at_link) = r.email
             ORDER BY x.linked_at, x.id LIMIT 1) AS identity_id
      FROM school_register r
     WHERE r.school_id = p_school
       AND r.claimed_at IS NULL AND r.withdrawn_at IS NULL AND r.redacted_at IS NULL
       AND r.valid_until >= current_date
       AND r.email IN (SELECT lower(x.email_at_link) FROM auth_identity x
                        WHERE x.user_id = v_me AND x.revoked_at IS NULL)
     ORDER BY r.id
       FOR UPDATE OF r
  LOOP
    v_any := true;
    v_why := NULL;
    -- 1 · The uploader, now. A departed office's list grants nothing.
    IF NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = g.uploaded_by AND u.active)
       OR NOT app_may_assign_at_for(g.uploaded_by, p_school)
       OR NOT app_may_grant_at_for(g.uploaded_by, g.role, p_school) THEN
      v_why := 'uploader_authority_lapsed';
    -- No pupil enters through it; nor, if roles.mjs has since moved one over
    -- the ceiling, does that role.
    ELSIF person_is_pupil(v_me) OR register_role_over_ceiling(g.role) THEN
      v_why := 'refused';
    END IF;

    -- 2 · Write or reuse the request.
    v_note := format('from the staff register, row %s, uploaded %s', g.id, to_char(g.uploaded_at, 'YYYY-MM-DD'));
    SELECT q.id INTO v_req FROM role_request q
     WHERE q.person_id = v_me AND q.role = g.role AND q.school_id = p_school
       AND coalesce(q.team_code, '*') = coalesce(g.team_code, '*') AND q.state = 'pending'
       FOR UPDATE;
    IF FOUND THEN
      UPDATE role_request q SET note = left(coalesce(q.note || ' · ', '') || v_note, 300) WHERE q.id = v_req;
    ELSE
      INSERT INTO role_request (person_id, role, school_id, team_code, note)
      VALUES (v_me, g.role, p_school, g.team_code, v_note)
      RETURNING id INTO v_req;
    END IF;

    -- 3 · Grant through the door, as the uploader. Any refusal — the body's
    -- answer, or a check_violation from a trigger on role_assignment — is
    -- caught here and its writes rolled back.
    IF v_why IS NULL THEN
      BEGIN
        SELECT d.ok INTO v_ok FROM role_request_grant_as(v_req, g.uploaded_by, v_note, NULL, g.team_code) d;
        IF v_ok IS NOT TRUE THEN v_why := 'refused'; END IF;
      EXCEPTION WHEN check_violation THEN
        v_why := 'refused';
      END;
    END IF;

    -- 4 · Whatever was not granted stays a pending request.
    v_out := CASE WHEN v_why IS NULL THEN 'granted' ELSE 'requested' END;
    UPDATE school_register r
       SET claimed_at = now(), claimed_by = v_me, claimed_identity = g.identity_id,
           claimed_request = v_req, outcome = v_out, outcome_reason = v_why
     WHERE r.id = g.id;

    -- 5 · Record.
    PERFORM register_log('register.claim', p_school, ARRAY[g.id]);
    SELECT u.name INTO v_by FROM app_user u WHERE u.id = g.uploaded_by;
    v_on := to_char(g.uploaded_at, 'FMDD FMMonth YYYY');
    v_words := role_words(g.role) || coalesce(' (' || g.team_code || ')', '');
    IF v_out = 'granted' THEN
      v_granted := v_granted || format('%s joined as %s today, from the row %s uploaded on %s.',
                                       g.name, v_words, coalesce(v_by, 'the office'), v_on);
    ELSE
      v_asked := v_asked || format('%s asked to join as %s, from the row %s uploaded on %s; it is waiting in Requests.',
                                   g.name, v_words, coalesce(v_by, 'the office'), v_on);
    END IF;
    RETURN QUERY SELECT g.role, g.team_code, v_out;
  END LOOP;

  IF NOT v_any THEN
    RETURN QUERY SELECT NULL::text, NULL::text, 'no_match'::text; RETURN;
  END IF;

  -- One notice to the office per claim (§2.3): who, as what, from whose row.
  -- Never a child: the register holds adults only.
  INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                            required_capability, is_public, subject_kind)
  VALUES (p_school, NULL, 'school', 'system', 'medium',
          CASE WHEN cardinality(v_granted) > 0 THEN 'Joined from the staff register'
               ELSE 'A staff register claim is waiting' END,
          array_to_string(v_granted || v_asked, ' ')
            || CASE WHEN cardinality(v_granted) > 0 THEN ' If this is wrong, end the role on People.' ELSE '' END,
          'user.role.assign', false, 'system');
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 6 · Withdraw, read, redact (§1.6, §1.8, §1.9) ──────────────────
-- An open row (unclaimed, not withdrawn; in date or not) taken back by
-- whoever may list that role there. A claimed row is ended with End role.
CREATE OR REPLACE FUNCTION register_withdraw(p_row uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  NIL uuid := '00000000-0000-0000-0000-000000000000';
  g   school_register%ROWTYPE;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  SELECT * INTO g FROM school_register r WHERE r.id = p_row FOR UPDATE;
  -- Authority first, so a stranger learns nothing about the row.
  IF NOT FOUND OR app_pad_scoped()
     OR NOT (app_can('user.role.assign', g.school_id, '*'::text, NIL, NIL)
             AND app_may_grant_at(g.role, g.school_id)) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF g.claimed_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_claimed'; RETURN; END IF;
  IF g.withdrawn_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_withdrawn'; RETURN; END IF;
  UPDATE school_register r SET withdrawn_at = now(), withdrawn_by = app_user_id() WHERE r.id = g.id;
  PERFORM register_log('register.withdraw', g.school_id, ARRAY[g.id]);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The register as the office (user.role.assign) or the auditor (audit.read)
-- at that school reads it; nobody else, never a pad. p_state narrows to
-- open · claimed · expired · withdrawn; NULL is all of them.
--
-- NOT THE DSO. db/57 gave the DSO audit.read, so "or audit.read" alone would
-- let him read adults' work emails, and §1.7 says the DSO sees nothing here
-- by standing (the register is not a safeguarding record). The auditor's
-- door is therefore audit.read held by somebody who is not a DSO at that
-- school; a DSO who is also the office reads it as the office.
CREATE OR REPLACE FUNCTION school_register_rows(p_school uuid, p_state text DEFAULT NULL)
RETURNS TABLE (id uuid, name text, email text, role text, team_code text, valid_until date,
               state text, uploaded_by uuid, uploaded_by_name text, uploaded_at timestamptz, upload_id uuid,
               warned_ended_on date, claimed_at timestamptz, claimed_by uuid, claimed_by_name text,
               outcome text, outcome_reason text, claimed_request uuid,
               withdrawn_at timestamptz, withdrawn_by_name text, redacted_at timestamptz) AS $$
  SELECT r.id, r.name, r.email, r.role, r.team_code, r.valid_until, s.state,
         r.uploaded_by, ub.name, r.uploaded_at, r.upload_id, r.warned_ended_on,
         r.claimed_at, r.claimed_by, cb.name, r.outcome, r.outcome_reason, r.claimed_request,
         r.withdrawn_at, wb.name, r.redacted_at
    FROM school_register r
    CROSS JOIN LATERAL (SELECT CASE WHEN r.withdrawn_at IS NOT NULL THEN 'withdrawn'
                                    WHEN r.claimed_at   IS NOT NULL THEN 'claimed'
                                    WHEN r.valid_until < current_date THEN 'expired'
                                    ELSE 'open' END AS state) s
    LEFT JOIN app_user ub ON ub.id = r.uploaded_by
    LEFT JOIN app_user cb ON cb.id = r.claimed_by
    LEFT JOIN app_user wb ON wb.id = r.withdrawn_by
   WHERE r.school_id = p_school
     AND app_user_id() IS NOT NULL AND NOT app_pad_scoped()
     AND (app_can('user.role.assign', p_school, '*'::text,
                  '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          OR (app_can('audit.read', p_school, '*'::text,
                      '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
              AND NOT app_can('safeguarding.concern.read', p_school, '*'::text,
                              '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)))
     AND (p_state IS NULL OR s.state = p_state)
   ORDER BY r.uploaded_at DESC, r.name, r.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Unclaimed rows ninety days past their date or their withdrawal, not yet
-- cleared (P2-D13). The office's, at that school.
CREATE OR REPLACE FUNCTION register_redact_due(p_school uuid)
RETURNS TABLE (id uuid, name text, email text, role text, team_code text, valid_until date,
               withdrawn_at timestamptz, due_on date) AS $$
  SELECT r.id, r.name, r.email, r.role, r.team_code, r.valid_until, r.withdrawn_at, d.due_on
    FROM school_register r
    CROSS JOIN LATERAL (SELECT CASE WHEN r.withdrawn_at IS NOT NULL THEN (r.withdrawn_at::date + 90)
                                    ELSE r.valid_until + 90 END AS due_on) d
   WHERE r.school_id = p_school AND r.claimed_at IS NULL AND r.redacted_at IS NULL
     AND d.due_on <= current_date
     AND app_user_id() IS NOT NULL AND NOT app_pad_scoped()
     AND app_can('user.role.assign', p_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
   ORDER BY d.due_on, r.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- "Clear N expired rows": the name and address go; the role, the side, who
-- listed it and the dates stay, so the record of what the office listed
-- survives without the person. Answers the count.
CREATE OR REPLACE FUNCTION register_redact(p_school uuid) RETURNS integer AS $$
DECLARE v_ids uuid[];
BEGIN
  IF app_user_id() IS NULL OR app_pad_scoped() OR p_school IS NULL
     OR NOT app_can('user.role.assign', p_school, '*'::text,
                    '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'not_permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH done AS (
    UPDATE school_register r
       SET name = 'Redacted', email = 'redacted+' || r.id::text || '@redacted.invalid', redacted_at = now()
     WHERE r.id IN (SELECT d.id FROM register_redact_due(p_school) d)
    RETURNING r.id)
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_ids FROM done;
  IF cardinality(v_ids) > 0 THEN
    PERFORM register_log('register.redact', p_school, v_ids);
  END IF;
  RETURN cardinality(v_ids);
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 7 · Grants ─────────────────────────────────────────────────────
DO $grants$
DECLARE
  f text;
  r text;
  v_app text[] := ARRAY[
    'register_upload(uuid,jsonb,boolean,uuid[])', 'register_claim(uuid)', 'register_withdraw(uuid)',
    'school_register_rows(uuid,text)', 'register_redact_due(uuid)', 'register_redact(uuid)'];
  v_internal text[] := ARRAY[
    'app_may_grant_at_for(uuid,text,uuid)', 'app_may_assign_at_for(uuid,uuid)',
    'role_request_grant_as(uuid,uuid,text,uuid,text)', 'register_role_over_ceiling(text)',
    'register_log(text,uuid,uuid[])'];
BEGIN
  FOREACH f IN ARRAY v_app LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f::regprocedure);
  END LOOP;
  FOREACH f IN ARRAY v_internal LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f::regprocedure);
  END LOOP;
  -- A managed host's API roles (Supabase grants new objects to them).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY v_app || v_internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f::regprocedure, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON school_register FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── 8 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §73 and walked through the API by
-- tools/smoke-staff-register.mjs.
DO $check$
DECLARE
  f   text;
  v_at  text := (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'app_may_grant_at(text,uuid)'::regprocedure);
  v_for text := (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'app_may_grant_at_for(uuid,text,uuid)'::regprocedure);
BEGIN
  -- The table: under RLS, no policy, no privilege for the application.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'school_register'::regclass) THEN
    RAISE EXCEPTION 'db/92: school_register is not under row-level security';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'school_register') THEN
    RAISE EXCEPTION 'db/92: school_register has a policy; it is read and written through functions only';
  END IF;
  IF has_table_privilege('scrbrd_app', 'school_register', 'SELECT')
     OR has_table_privilege('scrbrd_app', 'school_register', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'school_register', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'school_register', 'DELETE') THEN
    RAISE EXCEPTION 'db/92: the application holds a privilege on school_register';
  END IF;
  -- The mirror (P2-D8): _for is app_may_grant_at() with the one substitution,
  -- the pad clause out and the account's active in.
  IF v_for IS DISTINCT FROM replace(replace(v_at, 'SELECT NOT app_pad_scoped() AND EXISTS (',
                                            'SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.active) AND EXISTS ('),
                                    'app_user_id()', 'p_person') THEN
    RAISE EXCEPTION 'db/92: app_may_grant_at_for() no longer mirrors app_may_grant_at()';
  END IF;
  -- One door, two callers (db/77:484-488's shape): nothing else names it.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO f
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname <> 'role_request_grant_as'
     AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'role_request_grant_as\s*\(';
  IF f IS DISTINCT FROM 'decide_role_request(uuid,boolean,text,uuid,text), register_claim(uuid)' THEN
    RAISE EXCEPTION 'db/92: role_request_grant_as() is called by %, not by decide_role_request() and register_claim() alone', f;
  END IF;
  -- Every function here pins its search_path and none is PUBLIC's.
  FOREACH f IN ARRAY ARRAY[
      'register_upload(uuid,jsonb,boolean,uuid[])', 'register_claim(uuid)', 'register_withdraw(uuid)',
      'school_register_rows(uuid,text)', 'register_redact_due(uuid)', 'register_redact(uuid)',
      'app_may_grant_at_for(uuid,text,uuid)', 'app_may_assign_at_for(uuid,uuid)',
      'role_request_grant_as(uuid,uuid,text,uuid,text)', 'register_role_over_ceiling(text)',
      'register_log(text,uuid,uuid[])', 'decide_role_request(uuid,boolean,text,uuid,text)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/92: % does not pin its search_path', f;
    END IF;
    IF f <> 'decide_role_request(uuid,boolean,text,uuid,text)'
       AND EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                    WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/92: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  -- The internal ones are not the application's.
  FOREACH f IN ARRAY ARRAY['app_may_grant_at_for(uuid,text,uuid)', 'app_may_assign_at_for(uuid,uuid)',
                           'role_request_grant_as(uuid,uuid,text,uuid,text)', 'register_log(text,uuid,uuid[])',
                           'register_role_over_ceiling(text)'] LOOP
    IF has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/92: the application may call %', f;
    END IF;
  END LOOP;
END $check$;

-- ══════════════════════════════════════════════════════════════════
--  93 · A declined parent claim tells the DSO; repeated ones pause the asker
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. SCRBRD-140's D7, given its phase and its table in
-- docs/design/SCRBRD-140_phase2_register.md §4 (decided, Kameel 2026-10-13;
-- P2-D11, P2-D12, P2-D17). Its proof is db/99 §74. A file of its own beside
-- db/92, so either could wait without holding the other.
--
-- THE NOTICE (§4.1). When the office declines a request to be a child's
-- guardian — decide_role_request()'s decline, whatever route called it — the
-- school's DSOs are told, in a `safeguarding` notice that names nobody: not
-- the child (the request's free-text note is never copied), not the asker,
-- no address. "The office can tell you who asked": a DSO holds no
-- user.role.assign and reads no request (D9). The same notice goes when the
-- office declines a Google sign-in's claim on an account that is a pupil's,
-- or holds a guardian role: a stranger reaching for a child's or a parent's
-- account. Written by a definer, which is how a `safeguarding` row passes
-- db/57's RESTRICTIVE insert cut that stops the application writing one.
--
-- THE COOLDOWN (§4.2). In the same trigger: when a person's declined
-- guardian requests in thirty days reach three, or their guardian requests
-- in thirty days span more than two schools, they may not ask for anything
-- for thirty days. A BEFORE INSERT trigger on role_request refuses every
-- request while it lasts — POST /api/requests, POST /api/onboard and the
-- register's claim alike — with check_violation `request_cooldown`. The
-- schools' DSOs are told. It ends by itself, or a DSO at one of those
-- schools lifts it (P2-D12): never the office, whose declines set it, and
-- never the owner's key, which holds no safeguarding.* (db/57).
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   request_cooldown       new table: RLS on, no policy, no privilege
--   role_request           + AFTER UPDATE OF state trigger
--                            role_request_declined_notice
--                          + BEFORE INSERT trigger role_request_cooldown
--   pending_claim          + AFTER UPDATE OF resolved_how trigger
--                            pending_claim_declined_notice
--   request_cooldown_lift()   new, the DSO's door
-- No row is inserted, changed or deleted, and no notice is backfilled: a
-- decline before the paste wrote no notice and writes none now. The rule
-- reads the last thirty days of role_request, so declines from before the
-- paste do count toward a cooldown set by a decline after it; that is the
-- rule as decided (it reads the record, not the paste date).
-- Nothing is dropped: the triggers are CREATE OR REPLACE TRIGGER.
--
-- search_path pinned on every function (db/16).


-- ── 1 · The table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS request_cooldown (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  set_at     timestamptz NOT NULL DEFAULT now(),
  until      timestamptz NOT NULL,
  reason     text NOT NULL CHECK (reason IN ('repeated_declines', 'many_schools')),
  -- Where the declines (or the requests) were: whose DSOs were told, and
  -- who may lift it.
  school_ids uuid[] NOT NULL CHECK (cardinality(school_ids) > 0),
  lifted_at  timestamptz,
  lifted_by  uuid REFERENCES app_user(id),
  lift_note  text CHECK (lift_note IS NULL OR length(lift_note) <= 500),
  CONSTRAINT lift_whole CHECK ((lifted_at IS NULL) = (lifted_by IS NULL)),
  CONSTRAINT until_after_set CHECK (until > set_at)
);
-- §4.2's one-open index cannot hold "until > now()" (an index predicate
-- must be immutable). One open cooldown per person is kept by the writer
-- instead, under a lock on the person (§2).
CREATE INDEX IF NOT EXISTS request_cooldown_person_idx ON request_cooldown (person_id) WHERE lifted_at IS NULL;

COMMENT ON TABLE request_cooldown IS
  'db/93 (SCRBRD-140 D7, P2-D12): a person paused from asking for a role after repeated declined parent claims. Lifted by a DSO at one of school_ids, or ends at until.';

ALTER TABLE request_cooldown ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON request_cooldown FROM scrbrd_app;


-- ── 2 · The notice, and the rule ───────────────────────────────────
-- One safeguarding notice to the DSOs of a school, naming nobody. The
-- fan-out is by capability (recipient_id NULL), as db/57's raise does.
CREATE OR REPLACE FUNCTION declined_claim_notice(p_school uuid, p_title text, p_body text, p_cooldown uuid DEFAULT NULL)
RETURNS void AS $$
  INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                            required_capability, is_public, subject_kind, subject_id)
  VALUES (p_school, NULL, 'school', 'safeguarding', 'medium', p_title, p_body,
          'safeguarding.concern.read', false,
          CASE WHEN p_cooldown IS NOT NULL THEN 'system' END, p_cooldown)
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Is this person paused from asking, now?
CREATE OR REPLACE FUNCTION request_cooldown_open(p_person uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM request_cooldown c
                  WHERE c.person_id = p_person AND c.lifted_at IS NULL AND c.until > now())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- AFTER UPDATE OF state ON role_request, for a guardian request newly
-- declined: the notice at its school, then the rule.
CREATE OR REPLACE FUNCTION role_request_declined_notice() RETURNS trigger AS $$
DECLARE
  v_declined integer;
  v_schools  uuid[];
  v_reason   text;
  v_id       uuid;
  s          uuid;
BEGIN
  PERFORM declined_claim_notice(NEW.school_id, 'A parent claim was declined',
    'A request to be linked to a child at your school was declined by the office on '
      || to_char(coalesce(NEW.decided_at, now()), 'FMDD FMMonth YYYY')
      || '. The office can tell you who asked. If anything about it concerns you, raise a concern.');

  -- One writer per person at a time, so two declines at once open one cooldown.
  PERFORM pg_advisory_xact_lock(hashtextextended('request_cooldown:' || NEW.person_id::text, 93));
  IF request_cooldown_open(NEW.person_id) THEN RETURN NULL; END IF;

  SELECT count(*), array_agg(DISTINCT q.school_id) INTO v_declined, v_schools
    FROM role_request q
   WHERE q.person_id = NEW.person_id AND q.role = 'guardian' AND q.state = 'declined'
     AND q.decided_at > now() - interval '30 days';
  IF v_declined >= 3 THEN
    v_reason := 'repeated_declines';
  ELSE
    SELECT array_agg(DISTINCT q.school_id) INTO v_schools
      FROM role_request q
     WHERE q.person_id = NEW.person_id AND q.role = 'guardian'
       AND q.requested_at > now() - interval '30 days';
    IF cardinality(v_schools) > 2 THEN v_reason := 'many_schools'; END IF;
  END IF;
  IF v_reason IS NULL THEN RETURN NULL; END IF;

  INSERT INTO request_cooldown (person_id, until, reason, school_ids)
  VALUES (NEW.person_id, now() + interval '30 days', v_reason, v_schools)
  RETURNING id INTO v_id;
  FOREACH s IN ARRAY v_schools LOOP
    PERFORM declined_claim_notice(s, 'An account has been paused from asking',
      'An account has been paused from asking after repeated declined parent claims at your school. '
        || 'It can ask again on ' || to_char(now() + interval '30 days', 'FMDD FMMonth YYYY')
        || ', or sooner if a DSO lifts the pause. The office can tell you who it is.', v_id);
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER role_request_declined_notice
  AFTER UPDATE OF state ON role_request
  FOR EACH ROW
  WHEN (NEW.state = 'declined' AND OLD.state IS DISTINCT FROM 'declined' AND NEW.role = 'guardian')
  EXECUTE FUNCTION role_request_declined_notice();

-- AFTER UPDATE OF resolved_how ON pending_claim, newly declined: when the
-- account claimed is a pupil's, or holds a guardian role, its school's DSOs
-- are told (the pupil's school; each school where the account is a
-- guardian). No cooldown: the asker has no account to pause.
CREATE OR REPLACE FUNCTION pending_claim_declined_notice() RETURNS trigger AS $$
DECLARE s uuid;
BEGIN
  FOR s IN
    SELECT DISTINCT x.school_id FROM (
      SELECT u.school_id FROM app_user u WHERE u.id = NEW.user_id AND person_is_pupil(NEW.user_id)
      UNION
      SELECT a.school_id FROM role_assignment a
       WHERE a.person_id = NEW.user_id AND a.active AND a.role IN ('player', 'selfaccess')
      UNION
      SELECT a.school_id FROM role_assignment a
       WHERE a.person_id = NEW.user_id AND a.active AND a.role = 'guardian') x
     WHERE x.school_id IS NOT NULL
  LOOP
    PERFORM declined_claim_notice(s, 'A sign-in claim was declined',
      'A Google sign-in asking to be joined to a pupil''s or a parent''s account at your school was declined by the office on '
        || to_char(coalesce(NEW.resolved_at, now()), 'FMDD FMMonth YYYY')
        || '. The office can tell you which account. If anything about it concerns you, raise a concern.');
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER pending_claim_declined_notice
  AFTER UPDATE OF resolved_how ON pending_claim
  FOR EACH ROW
  WHEN (NEW.resolved_how = 'declined' AND OLD.resolved_how IS DISTINCT FROM 'declined')
  EXECUTE FUNCTION pending_claim_declined_notice();


-- ── 3 · The effect: no request while it lasts ──────────────────────
-- A trigger, not a policy, so it holds whichever route inserts
-- (POST /api/requests under RLS, onboard_request() and register_claim() as
-- definers). It is the person's own account state, so saying so to the
-- person reveals nothing about anyone else; the signed-out onboarding route
-- answers as it always does, without saying (services/api/write/requests-api.mjs).
CREATE OR REPLACE FUNCTION role_request_cooldown() RETURNS trigger AS $$
BEGIN
  IF request_cooldown_open(NEW.person_id) THEN
    RAISE EXCEPTION 'request_cooldown' USING ERRCODE = 'check_violation',
      SCHEMA = 'public', TABLE = 'role_request', CONSTRAINT = 'request_cooldown';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER role_request_cooldown
  BEFORE INSERT ON role_request
  FOR EACH ROW EXECUTE FUNCTION role_request_cooldown();


-- ── 4 · Lifting it (P2-D12): a DSO at one of its schools ───────────
-- (ok, reason): not_signed_in · not_permitted · already_lifted · already_ended
-- Authority first, so nobody else learns whether the id is a cooldown.
-- safeguarding.concern.manage at a school in school_ids, and not under a
-- support hour or a platform-wide key there (db/57's safeguarding_uncut()).
CREATE OR REPLACE FUNCTION request_cooldown_lift(p_cooldown uuid, p_note text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  NIL uuid := '00000000-0000-0000-0000-000000000000';
  c   request_cooldown%ROWTYPE;
  s   uuid;
  v_at uuid;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  SELECT * INTO c FROM request_cooldown x WHERE x.id = p_cooldown FOR UPDATE;
  IF FOUND AND NOT app_pad_scoped() THEN
    FOREACH s IN ARRAY c.school_ids LOOP
      IF app_can('safeguarding.concern.manage', s, '*'::text, NIL, NIL) AND safeguarding_uncut(s) THEN
        v_at := s; EXIT;
      END IF;
    END LOOP;
  END IF;
  IF v_at IS NULL THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  IF c.lifted_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_lifted'; RETURN; END IF;
  IF c.until <= now() THEN RETURN QUERY SELECT false, 'already_ended'; RETURN; END IF;
  UPDATE request_cooldown x
     SET lifted_at = now(), lifted_by = app_user_id(),
         lift_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   WHERE x.id = c.id;
  -- On the record at the school it was lifted from, where only its DSOs
  -- read it (db/57's access_log_safeguarding_hidden).
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count, device_id)
  VALUES (v_at, app_user_id(), 'safeguarding.cooldown_lift', ARRAY[c.id], 1, app_device_id());
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 5 · Grants ─────────────────────────────────────────────────────
DO $grants$
DECLARE
  f text;
  r text;
  v_internal text[] := ARRAY[
    'declined_claim_notice(uuid,text,text,uuid)', 'request_cooldown_open(uuid)',
    'role_request_declined_notice()', 'pending_claim_declined_notice()', 'role_request_cooldown()'];
BEGIN
  REVOKE ALL ON FUNCTION request_cooldown_lift(uuid, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION request_cooldown_lift(uuid, text) TO scrbrd_app;
  FOREACH f IN ARRAY v_internal LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f::regprocedure);
  END LOOP;
  -- A managed host's API roles (Supabase grants new objects to them).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY v_internal || ARRAY['request_cooldown_lift(uuid,text)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f::regprocedure, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON request_cooldown FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── 6 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §74 and walked through the API by
-- tools/smoke-staff-register.mjs.
DO $check$
DECLARE f text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'request_cooldown'::regclass) THEN
    RAISE EXCEPTION 'db/93: request_cooldown is not under row-level security';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'request_cooldown')
     OR has_table_privilege('scrbrd_app', 'request_cooldown', 'SELECT')
     OR has_table_privilege('scrbrd_app', 'request_cooldown', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'request_cooldown', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'request_cooldown', 'DELETE') THEN
    RAISE EXCEPTION 'db/93: the application can reach request_cooldown other than through request_cooldown_lift()';
  END IF;
  FOREACH f IN ARRAY ARRAY['role_request_declined_notice', 'role_request_cooldown'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'role_request'::regclass AND tgname = f AND tgenabled = 'O') THEN
      RAISE EXCEPTION 'db/93: the trigger % on role_request is missing or disabled', f;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'pending_claim'::regclass
                    AND tgname = 'pending_claim_declined_notice' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/93: the trigger pending_claim_declined_notice is missing or disabled';
  END IF;
  -- db/57's cut still stops the application writing a safeguarding notice.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_safeguarding_insert' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/93: notification_safeguarding_insert (db/57) is missing';
  END IF;
  FOREACH f IN ARRAY ARRAY['declined_claim_notice(uuid,text,text,uuid)', 'request_cooldown_open(uuid)',
                           'role_request_declined_notice()', 'pending_claim_declined_notice()',
                           'role_request_cooldown()', 'request_cooldown_lift(uuid,text)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/93: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/93: % is executable by PUBLIC', f;
    END IF;
    IF f <> 'request_cooldown_lift(uuid,text)' AND has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/93: the application may call %', f;
    END IF;
  END LOOP;
END $check$;

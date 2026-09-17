-- ══════════════════════════════════════════════════════════════════
--  22 · Support access: an hour, on the record (SCRBRD-012)
-- ══════════════════════════════════════════════════════════════════
--
-- platform.support.impersonate has been in the capability catalogue since
-- the role model was written — "time-boxed, audited support access" — and
-- has governed nothing (security audit §4, SEC-P2-03). A platform
-- administrator stops at the schoolhouse door by design: platformadmin holds
-- no school's roles, so a support ticket about one school's roster was
-- either answered blind or answered with the owner's key, which reads every
-- child at every school and, until db/20, recorded nothing.
--
-- This is the door, and its hinge is the thing the audit asked for: a real
-- role_assignment, at ONE school, in ONE role, that STOPS BY ITSELF.
--
-- WHY A NEW COLUMN. An assignment's validity is a pair of dates: a season, a
-- guardian's link to a birthday. An hour has no date. role_assignment gains
-- expires_at (timestamptz, NULL for every appointment that is not support),
-- and the decision functions gain one line in their liveness rule — in
-- db/23, generated, because db/01 has run on a database that cannot be
-- reset. Nothing changes for any ordinary assignment: NULL is "no hour hand".
--
-- WHAT IS RECORDED. The session itself — who, which school, which role,
-- why, when it began, when it expires, who ended it early — in
-- support_access, readable by the school's own auditor. And every read made
-- under it: log_restricted_read() stamps the session's id on the access_log
-- row, and read-api logs EVERY read a support session makes that returned
-- rows, the way it already does for a platform-wide reader. A school can
-- answer "what did support look at" from its own log.
--
-- WHO CAN END IT. The person who began it, and the school's office
-- (user.role.assign at that school). The second is the property that
-- matters: the school does not have to trust the platform to leave.

-- ── The hour hand ────────────────────────────────────────────────
ALTER TABLE role_assignment ADD COLUMN IF NOT EXISTS expires_at timestamptz;
COMMENT ON COLUMN role_assignment.expires_at IS
  'The instant a time-boxed assignment stops. NULL for every ordinary appointment. Read by app_can()/app_holds()/app_may_grant() (db/23) beside valid_until.';
CREATE INDEX IF NOT EXISTS role_assignment_expires_at_idx
  ON role_assignment (expires_at) WHERE expires_at IS NOT NULL;

-- ── The record of a session ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_access (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL REFERENCES app_user(id),
  school_id     uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  role          text NOT NULL,
  team_code     text,
  -- Required, and not a formality: it is the sentence the school reads.
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
  assignment_id uuid NOT NULL REFERENCES role_assignment(id) ON DELETE CASCADE,
  device_id     text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  ended_by      uuid REFERENCES app_user(id),
  CONSTRAINT support_access_ends_after_start CHECK (expires_at > started_at)
);
CREATE INDEX IF NOT EXISTS support_access_school_idx ON support_access (school_id, started_at DESC);
CREATE INDEX IF NOT EXISTS support_access_actor_idx  ON support_access (actor_id, started_at DESC);

ALTER TABLE support_access ENABLE ROW LEVEL SECURITY;
-- Readable by the person it is about, by the school it reached (its auditor),
-- and by the platform's own support holders. Written only by the functions
-- below: there is no INSERT or UPDATE policy, and scrbrd_app has no bypass.
DROP POLICY IF EXISTS support_access_read ON support_access;
CREATE POLICY support_access_read ON support_access
  FOR SELECT USING (
    actor_id = app_user_id()
    OR app_can('audit.read', support_access.school_id, '*'::text,
               '00000000-0000-0000-0000-000000000000'::uuid,
               '00000000-0000-0000-0000-000000000000'::uuid)
    OR app_holds('platform.support.impersonate')
  );
GRANT SELECT ON support_access TO scrbrd_app;

-- ── Beginning one ────────────────────────────────────────────────
-- Answers rather than raises, like enrol_person(): a refusal is a fact the
-- caller shows the person, not an exception the transaction dies of.
CREATE OR REPLACE FUNCTION support_access_begin(
  p_school  uuid,
  p_role    text,
  p_reason  text,
  p_team    text    DEFAULT NULL,
  p_minutes integer DEFAULT 60
) RETURNS TABLE (ok boolean, reason text, id uuid, expires_at timestamptz) AS $$
DECLARE
  v_actor   uuid := app_user_id();
  v_until   timestamptz;
  v_assign  uuid;
  v_id      uuid;
BEGIN
  IF v_actor IS NULL OR NOT app_holds('platform.support.impersonate') THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM school s WHERE s.id = p_school) THEN
    RETURN QUERY SELECT false, 'school_unknown', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.role = p_role) THEN
    RETURN QUERY SELECT false, 'role_unknown', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  -- A platform role at a school is a contradiction app_may_grant() already
  -- refuses; support is FOR reaching one school as one of its own roles.
  -- superadmin is caught here too: it carries every platform capability.
  IF EXISTS (SELECT 1 FROM role_capability rc
               JOIN capability c ON c.name = rc.capability AND c.platform_only
              WHERE rc.role = p_role) THEN
    RETURN QUERY SELECT false, 'role_not_supportable', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  -- The roles that only mean anything ABOUT SOMEBODY (SUBJECT_SCOPED_ROLES in
  -- packages/policy; the same list app_can() names). Support reaches a school
  -- the way its office does, never the way a parent does.
  IF p_role = ANY (ARRAY['guardian', 'selfaccess', 'enquiry']) THEN
    RETURN QUERY SELECT false, 'role_needs_subject', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RETURN QUERY SELECT false, 'reason_required', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  -- An hour by default; four at most. Longer than that is not a support
  -- session, it is an appointment, and those are made by the school.
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 240 THEN
    RETURN QUERY SELECT false, 'minutes_out_of_range', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM support_access s JOIN role_assignment a ON a.id = s.assignment_id
              WHERE s.actor_id = v_actor AND s.school_id = p_school AND s.role = p_role
                AND s.ended_at IS NULL AND a.active AND a.expires_at > now()) THEN
    RETURN QUERY SELECT false, 'already_live', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;

  v_until := now() + make_interval(mins => p_minutes);
  -- A real assignment, stamped by the same trigger as any appointment
  -- (created_by = the support person). The team-scoped CHECK still applies:
  -- a coach must name a side, and a request that does not is refused by the
  -- constraint rather than second-guessed here.
  INSERT INTO role_assignment (person_id, role, school_id, team_code, active, valid_from, expires_at)
  VALUES (v_actor, p_role, p_school, p_team, true, current_date, v_until)
  RETURNING role_assignment.id INTO v_assign;
  INSERT INTO support_access (actor_id, school_id, role, team_code, reason, assignment_id, device_id, expires_at)
  VALUES (v_actor, p_school, p_role, p_team, btrim(p_reason), v_assign, app_device_id(), v_until)
  RETURNING support_access.id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, v_id, v_until;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION support_access_begin(uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_access_begin(uuid, text, text, text, integer) TO PUBLIC;

-- ── Ending one early ─────────────────────────────────────────────
-- By the person who began it, or by the school it reached. Safe to run twice.
CREATE OR REPLACE FUNCTION support_access_end(p_id uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  s support_access%ROWTYPE;
BEGIN
  SELECT * INTO s FROM support_access WHERE support_access.id = p_id;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_access'; RETURN; END IF;
  IF NOT (s.actor_id = app_user_id()
          OR app_can('user.role.assign', s.school_id, '*'::text,
                     '00000000-0000-0000-0000-000000000000'::uuid,
                     '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF s.ended_at IS NOT NULL THEN RETURN QUERY SELECT true, 'already_ended'; RETURN; END IF;
  UPDATE role_assignment
     SET active = false, revoked_at = now(), revoked_by = app_user_id()
   WHERE role_assignment.id = s.assignment_id;
  UPDATE support_access
     SET ended_at = now(), ended_by = app_user_id()
   WHERE support_access.id = p_id;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION support_access_end(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_access_end(uuid) TO PUBLIC;

-- ── Which session a read is being made under ─────────────────────
-- The caller's live session at this school, if any. Decided here, by the
-- same liveness the decision functions apply, never claimed by the caller.
CREATE OR REPLACE FUNCTION app_support_access_id(p_school uuid DEFAULT NULL) RETURNS uuid AS $$
  SELECT s.id
    FROM support_access s
    JOIN role_assignment a ON a.id = s.assignment_id
   WHERE s.actor_id = app_user_id()
     AND s.ended_at IS NULL
     AND a.active
     AND a.expires_at > now()
     AND (p_school IS NULL OR s.school_id = p_school)
   ORDER BY s.started_at DESC
   LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION app_support_access_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_support_access_id(uuid) TO PUBLIC;

-- Is this session live? Answered from the ASSIGNMENT, which is what the
-- decision functions read — not from the session row's own copy of the hour,
-- which is a record of what was issued. SECURITY DEFINER because the school's
-- auditor may read the session and may not read the support person's
-- assignment row, and a join would have silently dropped it.
CREATE OR REPLACE FUNCTION support_access_live(p_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM support_access s
      JOIN role_assignment a ON a.id = s.assignment_id
     WHERE s.id = p_id AND s.ended_at IS NULL AND a.active AND a.expires_at > now())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION support_access_live(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_access_live(uuid) TO PUBLIC;

-- ── Every read under it is on the record ─────────────────────────
ALTER TABLE access_log ADD COLUMN IF NOT EXISTS support_access_id uuid REFERENCES support_access(id);
CREATE INDEX IF NOT EXISTS access_log_support_idx
  ON access_log (support_access_id, occurred_at DESC) WHERE support_access_id IS NOT NULL;

-- db/20's function, with the one stamp added. Same signature, so nothing
-- that calls it changes; the session id is decided in here, never passed in.
--
-- AND FILED UNDER THE SESSION'S SCHOOL when the read named none. Some
-- resources carry no school column (injuries: rows name a player, and the
-- player names the school), and a row logged with school_id NULL is a row no
-- school's auditor can see. A support session reaches exactly one school, so
-- a read it makes that names none is that school's to see.
CREATE OR REPLACE FUNCTION log_restricted_read(
  p_resource text,
  p_ids      uuid[],
  p_fields   text[],
  p_school   uuid DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_support uuid := app_support_access_id(p_school);
  v_school  uuid := p_school;
BEGIN
  IF app_user_id() IS NULL THEN RETURN; END IF;
  IF v_school IS NULL AND v_support IS NOT NULL THEN
    SELECT s.school_id INTO v_school FROM support_access s WHERE s.id = v_support;
  END IF;
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count,
                          fields, device_id, platform_wide, support_access_id)
  VALUES (v_school, app_user_id(), p_resource,
          coalesce(p_ids, '{}'), coalesce(array_length(p_ids, 1), 0),
          coalesce(p_fields, '{}'), app_device_id(), app_is_platform_wide(),
          v_support);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/20's platform-wide test, with the same hour hand the decision functions
-- get in db/23 — one liveness rule everywhere, or it is not a rule.
CREATE OR REPLACE FUNCTION app_is_platform_wide() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.person_id = app_user_id()
       AND a.active AND a.school_id IS NULL
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at  IS NULL OR a.expires_at  >  now()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

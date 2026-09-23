-- ══════════════════════════════════════════════════════════════════
--  34 · A duty and the permission it rests on (SCRBRD-034)
-- ══════════════════════════════════════════════════════════════════
--
-- Two records say who a fixture's scorer is, and until now nothing joined
-- them. match_official (db/08) is the DUTY: "V Pillay scores fixture 004",
-- appointed by whoever holds officiating.assign, withdrawn by an UPDATE. It
-- grants nothing. role_assignment (db/00) is the AUTHORITY: the row app_can()
-- reads before a ball is written. Standing somebody down from the duty left
-- their authority exactly where it was, and there was no way to pause an
-- appointment without ending it for good — db/01's revoke-only trigger
-- refuses to turn `active` back on, and rightly.
--
-- This file adds the link and the pause. The product decisions, as approved:
--
--   D1  match_official.assignment_id — the assignment a duty rests on. The
--       school office (user.role.assign at the school, the same people who
--       make appointments) creates it. Withdrawing a linked duty revokes the
--       assignment in the same transaction.
--   D2  A linked duty may be SUSPENDED and the suspension LIFTED, each with a
--       reason, each by the office, each recorded (who, when, why). While
--       suspended, the assignment grants nothing: db/35 (generated) re-emits
--       the three decision functions with one more liveness condition that
--       reads duty_suspension. Lifting closes the row; `active` is never
--       touched, so a revoked assignment stays revoked.
--
-- LINKING CREATES THE ASSIGNMENT; IT DOES NOT ADOPT ONE. duty_link() makes a
-- fresh assignment shaped exactly like the duty — this person, the duty's
-- role (scorer, or official for umpire/third umpire/referee), this school,
-- THIS fixture, no team, no subjects, no hour hand — and links it. Adopting an
-- existing assignment was the alternative and it is worse in the way that
-- matters: withdrawing a duty revokes what it is linked to, and suspending it
-- silences what it is linked to, so a link to A Wessels's school-wide scorer
-- assignment would let one fixture's paperwork end or pause her authority at
-- every fixture. Created, the linked assignment IS the duty's authority and
-- nothing more, one duty to one assignment (a unique index), and it carries
-- the office's name as its granter the same way any appointment does. The
-- office already holds the power to make exactly this assignment
-- (role_assignment_write: user.role.assign + app_may_grant), so linking adds
-- no power anybody lacked. The application role holds no privilege on the
-- column at all, and a guard trigger holds the shape for any path that does
-- set it (the owner's), so the invariant does not depend on the function
-- being the only door.
--
-- WHO MAY DO WHAT, and why the two directions differ:
--   link    user.role.assign at the school AND app_may_grant(role) — it makes
--           an appointment, so it asks what role_assignment_write asks.
--   suspend user.role.assign at the school — it takes authority away, so it
--           asks what role_assignment_revoke asks.
--   lift    user.role.assign AND app_may_grant(role) — it gives authority
--           back, so it asks what making the appointment asks. A principal
--           holds user.role.assign but may not appoint scorers; they may
--           pause one and may not restore one.
--   Nobody lifts a suspension of their own duty.
--
-- WHAT A SUSPENDED PERSON SEES. That they are suspended — assignment_suspended()
-- answers for their own assignments — but not why. The reason is the office's
-- record (duty_suspension is readable under user.role.assign only): a scorer
-- may be a pupil, and "why" can be a safeguarding sentence.
--
-- duty_status() (db/30, written separately) is the lifecycle read. It folds
-- this file's state in through duty_suspended(match_official.id).

-- ── The link ─────────────────────────────────────────────────────
ALTER TABLE match_official
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES role_assignment(id) ON DELETE SET NULL;
COMMENT ON COLUMN match_official.assignment_id IS
  'The fixture-scoped assignment this duty rests on (SCRBRD-034). Set by duty_link(); withdrawing the duty revokes it; duty_suspension pauses it.';
-- One duty per assignment: withdrawing or suspending one duty never reaches
-- another's authority. Also the index the guards below look up by.
CREATE UNIQUE INDEX IF NOT EXISTS match_official_assignment_once
  ON match_official (assignment_id) WHERE assignment_id IS NOT NULL;

-- THE COLUMN IS NOT THE APPLICATION ROLE'S TO WRITE. match_official's own
-- policies let officiating.assign insert and update the row, and a link is an
-- authority question officiating.assign does not answer — so rather than a
-- trigger asking app_can() (a refusing trigger that consults a capability is
-- a privilege, not an invariant; packages/policy/test/invariants.test.mjs),
-- the application role simply has no privilege on this one column. It is
-- written by duty_link() alone, which asks the office's question itself.
-- Column grants are explicit, so a column a later file adds to this table is
-- not writable by the application role until that file grants it.
REVOKE INSERT, UPDATE ON match_official FROM scrbrd_app;
GRANT INSERT (id, match_id, school_id, duty, person_name, person_id, official_id, panel,
              withdrawn, appointed_by, appointed_at) ON match_official TO scrbrd_app;
GRANT UPDATE (match_id, school_id, duty, person_name, person_id, official_id, panel,
              withdrawn, appointed_by, appointed_at) ON match_official TO scrbrd_app;

-- Which role a duty's authority is. The duty vocabulary is db/08's CHECK; a
-- duty this does not know maps to nothing and cannot be linked.
CREATE OR REPLACE FUNCTION duty_role(p_duty text) RETURNS text AS $$
  SELECT CASE p_duty
           WHEN 'scorer'       THEN 'scorer'
           WHEN 'umpire'       THEN 'official'
           WHEN 'third_umpire' THEN 'official'
           WHEN 'referee'      THEN 'official'
         END
$$ LANGUAGE sql IMMUTABLE;

-- ── The pause ────────────────────────────────────────────────────
-- One row per suspension, open until lifted. Append-then-close: the suspend
-- half is never edited, the lift half is written once. Both halves carry who,
-- when and why, and a half-lifted row cannot exist.
CREATE TABLE IF NOT EXISTS duty_suspension (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_id       uuid NOT NULL REFERENCES match_official(id) ON DELETE CASCADE,
  -- The assignment paused, as it was linked when the suspension was made.
  -- The decision functions (db/35) key on this, one index probe per
  -- assignment they consider.
  assignment_id uuid NOT NULL REFERENCES role_assignment(id) ON DELETE CASCADE,
  school_id     uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  suspended_at  timestamptz NOT NULL DEFAULT now(),
  suspended_by  uuid NOT NULL REFERENCES app_user(id),
  reason        text NOT NULL CHECK (length(btrim(reason)) > 0 AND length(reason) <= 2000),
  lifted_at     timestamptz,
  lifted_by     uuid REFERENCES app_user(id),
  lift_reason   text CHECK (lift_reason IS NULL OR (length(btrim(lift_reason)) > 0 AND length(lift_reason) <= 2000)),
  CONSTRAINT duty_suspension_lift_whole CHECK (
    (lifted_at IS NULL) = (lifted_by IS NULL) AND (lifted_at IS NULL) = (lift_reason IS NULL)),
  CONSTRAINT duty_suspension_lift_after CHECK (lifted_at IS NULL OR lifted_at >= suspended_at)
);
-- At most one open suspension per assignment, and the probe db/35 makes.
CREATE UNIQUE INDEX IF NOT EXISTS duty_suspension_open
  ON duty_suspension (assignment_id) WHERE lifted_at IS NULL;
CREATE INDEX IF NOT EXISTS duty_suspension_duty_idx ON duty_suspension (duty_id, suspended_at DESC);

-- Written only by duty_suspend() and duty_lift(). The application role gets
-- SELECT and nothing else, and even that is row-scoped: the office's record.
ALTER TABLE duty_suspension ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON duty_suspension FROM scrbrd_app;
DROP POLICY IF EXISTS duty_suspension_read ON duty_suspension;
CREATE POLICY duty_suspension_read ON duty_suspension
  FOR SELECT USING (app_can('user.role.assign', school_id, NULL, NULL, NULL));

CREATE OR REPLACE FUNCTION duty_suspension_append_only() RETURNS trigger AS $$
BEGIN
  IF OLD.lifted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a lifted suspension is history; suspend again if it is needed again'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.duty_id IS DISTINCT FROM OLD.duty_id
  OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.school_id IS DISTINCT FROM OLD.school_id
  OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at OR NEW.suspended_by IS DISTINCT FROM OLD.suspended_by
  OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'who suspended a duty, when and why are not editable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS duty_suspension_append_only ON duty_suspension;
CREATE TRIGGER duty_suspension_append_only BEFORE UPDATE ON duty_suspension
  FOR EACH ROW EXECUTE FUNCTION duty_suspension_append_only();

-- ── The link's shape, whoever writes it ──────────────────────────
-- An invariant, consulting no capability: every write that touches the
-- link, or touches a linked row, is checked for shape here — including the
-- ones duty_link() makes, and any a maintenance script makes as the owner.
--
-- DEFINER because the checks read role_assignment and duty_suspension, which
-- the caller may not be able to see; nothing here widens what the caller may
-- write, it only refuses.
CREATE OR REPLACE FUNCTION match_official_link_guard() RETURNS trigger AS $$
DECLARE
  a role_assignment%ROWTYPE;
  was uuid := CASE WHEN TG_OP = 'UPDATE' THEN OLD.assignment_id END;
BEGIN
  -- The assignment itself is being deleted (its person, school or fixture
  -- went, and the foreign key is setting this column NULL). There is nothing
  -- left to guard, and refusing would make those deletions impossible.
  IF NEW.assignment_id IS NULL AND was IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM role_assignment r WHERE r.id = was) THEN
    RETURN NEW;
  END IF;
  IF NEW.assignment_id IS DISTINCT FROM was THEN
    -- WHO may change the link is not asked here: the application role holds
    -- no privilege on the column (above), and duty_link() asks the office's
    -- question before it writes. What is asked here is the shape, of every
    -- link, however it is written.
    IF was IS NOT NULL THEN
      -- Moving off a live assignment would strand it: still granting, and no
      -- longer revoked when the duty is withdrawn.
      IF EXISTS (SELECT 1 FROM role_assignment r WHERE r.id = was AND r.active) THEN
        RAISE EXCEPTION 'this duty''s assignment is still live; revoke it before linking another'
          USING ERRCODE = 'check_violation';
      END IF;
      -- A pause travels with the duty, not around it.
      IF EXISTS (SELECT 1 FROM duty_suspension s WHERE s.duty_id = NEW.id AND s.lifted_at IS NULL) THEN
        RAISE EXCEPTION 'this duty is suspended; lift the suspension before re-linking it'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.assignment_id IS NOT NULL THEN
      SELECT * INTO a FROM role_assignment r WHERE r.id = NEW.assignment_id;
      IF NOT FOUND
         OR NEW.withdrawn
         OR NEW.person_id IS NULL
         OR NEW.school_id IS DISTINCT FROM match_school(NEW.match_id)
         OR a.person_id  IS DISTINCT FROM NEW.person_id
         OR a.role       IS DISTINCT FROM duty_role(NEW.duty)
         OR a.school_id  IS DISTINCT FROM NEW.school_id
         OR a.fixture_id IS DISTINCT FROM NEW.match_id
         OR a.team_code  IS NOT NULL
         OR a.expires_at IS NOT NULL
         OR NOT a.active
         OR EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id) THEN
        RAISE EXCEPTION 'a duty is linked only to a live assignment of exactly its own shape: this person, this duty''s role, this school, this fixture, no team'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF NEW.assignment_id IS NOT NULL AND TG_OP = 'UPDATE' THEN
    -- A linked appointment keeps what it is about. Re-pointing it would leave
    -- the assignment granting authority over a duty that no longer says so.
    IF NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.match_id IS DISTINCT FROM OLD.match_id
    OR NEW.duty IS DISTINCT FROM OLD.duty OR NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      RAISE EXCEPTION 'a linked appointment is not re-pointed; withdraw it and appoint again'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Withdrawing revoked the assignment (below), and db/01 never reactivates
    -- one, so un-withdrawing would restore a duty with no authority behind it
    -- while looking as though it had some.
    IF OLD.withdrawn AND NOT NEW.withdrawn THEN
      RAISE EXCEPTION 'a withdrawn linked appointment is not reinstated; appoint again'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS match_official_link_guard ON match_official;
CREATE TRIGGER match_official_link_guard BEFORE INSERT OR UPDATE ON match_official
  FOR EACH ROW EXECUTE FUNCTION match_official_link_guard();

-- ── Withdrawing the duty revokes the authority ───────────────────
-- In the same transaction as the withdrawal, whoever makes it. The person
-- standing somebody down holds officiating.assign, not user.role.assign, and
-- that is deliberate: the assignment is the duty's own (the guard above
-- holds its shape), so ending the duty ends it — the revocation is stamped
-- with their name by db/01's revoke trigger like any other. DEFINER because
-- they could not revoke it through role_assignment's policy themselves.
CREATE OR REPLACE FUNCTION match_official_withdraw_revokes() RETURNS trigger AS $$
BEGIN
  IF NEW.assignment_id IS NOT NULL AND NEW.withdrawn AND NOT OLD.withdrawn THEN
    UPDATE role_assignment SET active = false
     WHERE id = NEW.assignment_id AND active;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS match_official_withdraw_revokes ON match_official;
CREATE TRIGGER match_official_withdraw_revokes AFTER UPDATE OF withdrawn ON match_official
  FOR EACH ROW EXECUTE FUNCTION match_official_withdraw_revokes();

-- ── A linked assignment keeps its shape too ──────────────────────
-- db/01's revoke-only trigger freezes person, role, school and team; it
-- predates fixture-scoped appointments and does not freeze the fixture or the
-- dates. For a linked assignment those ARE the duty, so they are frozen here.
-- Revoking (active → false) passes; that is the only change a link permits.
CREATE OR REPLACE FUNCTION role_assignment_linked_guard() RETURNS trigger AS $$
BEGIN
  IF (NEW.fixture_id  IS DISTINCT FROM OLD.fixture_id
   OR NEW.season      IS DISTINCT FROM OLD.season
   OR NEW.valid_from  IS DISTINCT FROM OLD.valid_from
   OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
   OR NEW.expires_at  IS DISTINCT FROM OLD.expires_at)
  AND EXISTS (SELECT 1 FROM match_official mo WHERE mo.assignment_id = OLD.id) THEN
    RAISE EXCEPTION 'this assignment is a duty''s authority and keeps the duty''s shape; revoke it instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS role_assignment_linked_guard ON role_assignment;
CREATE TRIGGER role_assignment_linked_guard BEFORE UPDATE ON role_assignment
  FOR EACH ROW EXECUTE FUNCTION role_assignment_linked_guard();

-- ── duty_link: make the duty's assignment and link it ────────────
-- Refusals are answers, not errors, like support_access_begin(): the route
-- shows the person the reason. A duty already linked to a live assignment is
-- refused rather than silently re-linked; one whose assignment was revoked
-- by some other path gets a fresh one.
CREATE OR REPLACE FUNCTION duty_link(p_duty uuid)
RETURNS TABLE (ok boolean, reason text, assignment_id uuid) AS $$
DECLARE
  d      match_official%ROWTYPE;
  v_role text;
  v_new  uuid;
BEGIN
  SELECT * INTO d FROM match_official mo WHERE mo.id = p_duty FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_duty', NULL::uuid; RETURN; END IF;
  v_role := duty_role(d.duty);
  IF v_role IS NULL
     OR NOT app_can('user.role.assign', d.school_id, NULL, NULL, NULL)
     OR NOT app_may_grant(v_role) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid; RETURN;
  END IF;
  IF d.withdrawn THEN RETURN QUERY SELECT false, 'duty_withdrawn', NULL::uuid; RETURN; END IF;
  IF d.person_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = d.person_id AND u.active) THEN
    RETURN QUERY SELECT false, 'no_account', NULL::uuid; RETURN;
  END IF;
  IF d.assignment_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM role_assignment r WHERE r.id = d.assignment_id AND r.active) THEN
      RETURN QUERY SELECT false, 'already_linked', d.assignment_id; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM duty_suspension s WHERE s.duty_id = d.id AND s.lifted_at IS NULL) THEN
      RETURN QUERY SELECT false, 'duty_suspended', NULL::uuid; RETURN;
    END IF;
  END IF;

  INSERT INTO role_assignment (person_id, role, school_id, team_code, fixture_id)
  VALUES (d.person_id, v_role, d.school_id, NULL, d.match_id)
  RETURNING role_assignment.id INTO v_new;
  UPDATE match_official SET assignment_id = v_new WHERE match_official.id = d.id;
  RETURN QUERY SELECT true, NULL::text, v_new;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION duty_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION duty_link(uuid) TO PUBLIC;

-- ── duty_suspend: pause it, with a reason ────────────────────────
CREATE OR REPLACE FUNCTION duty_suspend(p_duty uuid, p_reason text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  d match_official%ROWTYPE;
BEGIN
  SELECT * INTO d FROM match_official mo WHERE mo.id = p_duty FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_duty'; RETURN; END IF;
  IF NOT app_can('user.role.assign', d.school_id, NULL, NULL, NULL) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RETURN QUERY SELECT false, 'reason_required'; RETURN;
  END IF;
  IF length(p_reason) > 2000 THEN RETURN QUERY SELECT false, 'reason_too_long'; RETURN; END IF;
  IF d.withdrawn THEN RETURN QUERY SELECT false, 'duty_withdrawn'; RETURN; END IF;
  IF d.assignment_id IS NULL THEN RETURN QUERY SELECT false, 'not_linked'; RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM role_assignment r WHERE r.id = d.assignment_id AND r.active) THEN
    RETURN QUERY SELECT false, 'assignment_not_live'; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM duty_suspension s WHERE s.assignment_id = d.assignment_id AND s.lifted_at IS NULL) THEN
    RETURN QUERY SELECT false, 'already_suspended'; RETURN;
  END IF;
  INSERT INTO duty_suspension (duty_id, assignment_id, school_id, suspended_by, reason)
  VALUES (d.id, d.assignment_id, d.school_id, app_user_id(), btrim(p_reason));
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION duty_suspend(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION duty_suspend(uuid, text) TO PUBLIC;

-- ── duty_lift: restore it, with a reason ─────────────────────────
-- Closes the open row; role_assignment is not touched. An assignment revoked
-- while suspended stays revoked — lifting ends the pause, it does not
-- reappoint anybody — and lifting it is still allowed, so the record closes.
CREATE OR REPLACE FUNCTION duty_lift(p_duty uuid, p_reason text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  d match_official%ROWTYPE;
  v_role text;
BEGIN
  SELECT * INTO d FROM match_official mo WHERE mo.id = p_duty FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_duty'; RETURN; END IF;
  v_role := duty_role(d.duty);
  IF v_role IS NULL
     OR NOT app_can('user.role.assign', d.school_id, NULL, NULL, NULL)
     OR NOT app_may_grant(v_role) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RETURN QUERY SELECT false, 'reason_required'; RETURN;
  END IF;
  IF length(p_reason) > 2000 THEN RETURN QUERY SELECT false, 'reason_too_long'; RETURN; END IF;
  -- The person paused is not the person who un-pauses them.
  IF d.person_id = app_user_id() THEN RETURN QUERY SELECT false, 'own_duty'; RETURN; END IF;
  UPDATE duty_suspension s
     SET lifted_at = now(), lifted_by = app_user_id(), lift_reason = btrim(p_reason)
   WHERE s.duty_id = d.id AND s.lifted_at IS NULL;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_suspended'; RETURN; END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION duty_lift(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION duty_lift(uuid, text) TO PUBLIC;

-- ── Reads ────────────────────────────────────────────────────────
-- Is this duty suspended? The fold point for duty_status() (db/30): a duty
-- whose linked assignment has an open suspension is `suspended`. Answers for
-- the duties the caller may read at all (match_official_read's predicate) and
-- false for any other, so it is not a way to probe duties by id.
CREATE OR REPLACE FUNCTION duty_suspended(p_duty uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM match_official mo
      JOIN duty_suspension s ON s.duty_id = mo.id AND s.assignment_id = mo.assignment_id
                            AND s.lifted_at IS NULL
     WHERE mo.id = p_duty
       AND app_can('fixture.read', mo.school_id, match_team(mo.match_id),
                   '00000000-0000-0000-0000-000000000000'::uuid, mo.match_id))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION duty_suspended(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION duty_suspended(uuid) TO PUBLIC;

-- Is this assignment paused? For the assignment's own holder and for the
-- office over it (role_assignment_read's predicate) — the context switcher
-- and the client mirror (authorize.mjs isActive) need it; the reason stays
-- in duty_suspension.
CREATE OR REPLACE FUNCTION assignment_suspended(p_assignment uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_assignment a
      JOIN duty_suspension s ON s.assignment_id = a.id AND s.lifted_at IS NULL
     WHERE a.id = p_assignment
       AND (a.person_id = app_user_id()
            OR app_can('user.role.assign', a.school_id, a.team_code, NULL, NULL)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION assignment_suspended(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assignment_suspended(uuid) TO PUBLIC;

-- ── Assertion ──────────────────────────────────────────────────────
-- The shape of what this file promised. The behaviour — a suspended duty
-- granting nothing, lifting restoring it, only the office acting, reasons
-- required, withdrawal revoking — is asserted live in db/99 (section 15),
-- after db/35 has taught the decision functions to read the suspension.
DO $check$
DECLARE
  f text;
  o oid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'match_official' AND column_name = 'assignment_id') THEN
    RAISE EXCEPTION 'db/34: match_official.assignment_id is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'duty_suspension'::regclass) THEN
    RAISE EXCEPTION 'db/34: duty_suspension is not under row-level security';
  END IF;
  IF has_table_privilege('scrbrd_app', 'duty_suspension', 'INSERT')
  OR has_table_privilege('scrbrd_app', 'duty_suspension', 'UPDATE')
  OR has_table_privilege('scrbrd_app', 'duty_suspension', 'DELETE') THEN
    RAISE EXCEPTION 'db/34: the application role can write duty_suspension directly';
  END IF;
  IF has_column_privilege('scrbrd_app', 'match_official', 'assignment_id', 'UPDATE')
  OR has_column_privilege('scrbrd_app', 'match_official', 'assignment_id', 'INSERT') THEN
    RAISE EXCEPTION 'db/34: the application role can write match_official.assignment_id directly';
  END IF;
  IF NOT has_column_privilege('scrbrd_app', 'match_official', 'withdrawn', 'UPDATE')
  OR NOT has_column_privilege('scrbrd_app', 'match_official', 'person_name', 'INSERT') THEN
    RAISE EXCEPTION 'db/34: the application role lost the columns it appoints and withdraws with';
  END IF;
  FOREACH f IN ARRAY ARRAY['duty_link(uuid)', 'duty_suspend(uuid,text)', 'duty_lift(uuid,text)',
                           'duty_suspended(uuid)', 'assignment_suspended(uuid)',
                           'match_official_link_guard()', 'match_official_withdraw_revokes()',
                           'role_assignment_linked_guard()'] LOOP
    o := to_regprocedure(f);
    IF o IS NULL THEN RAISE EXCEPTION 'db/34: % is missing', f; END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = o) THEN
      RAISE EXCEPTION 'db/34: % is not SECURITY DEFINER', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
                    WHERE p.oid = o AND c = 'search_path=pg_catalog, public, pg_temp') THEN
      RAISE EXCEPTION 'db/34: % does not pin its search_path', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['duty_link(uuid)', 'duty_suspend(uuid,text)', 'duty_lift(uuid,text)',
                           'duty_suspended(uuid)', 'assignment_suspended(uuid)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION 'db/34: the application role cannot call %', f;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'match_official_link_guard' AND NOT tgisinternal)
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'match_official_withdraw_revokes' AND NOT tgisinternal)
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'role_assignment_linked_guard' AND NOT tgisinternal)
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'duty_suspension_append_only' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'db/34: a guard trigger is missing';
  END IF;
END $check$;

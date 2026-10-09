-- ══════════════════════════════════════════════════════════════════
--  90 · Account lifecycle, slice 2: the reason, the preview, the notice
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/ACCOUNT_LIFECYCLE.md (decided,
-- Kameel 2026-10-07: D1–D24 and Q1–Q13 as recommended; slices 2–7 pulled
-- forward 2026-10-08). This is slice 2: D3 (the preview), D4 (a reason for
-- every disable and enable, kept from the person), D20 (the notice on
-- enable) and Q3 (the application may no longer write app_user.active
-- except through account_set_active()). Its proof is db/99 §69, walked
-- through the API by tools/smoke-accounts.mjs.
--
-- WHO MAY ACT IS UNCHANGED (D2): db/81's auth_office_refusal() — user.invite
-- at the account's school, every standing role one the caller could grant
-- there, a platform-wide account only by a superadmin, never your own. Who
-- may READ the reason is the design's own decision (D4, §7, §8): user.invite
-- or audit.read at the account's school, and never the person it is about.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   account_status_change   new table: one row per disable or enable that
--                           changed something (who, when, which way, the
--                           reason, the notice). RLS; SELECT only to the
--                           application; written by account_set_active()
--   app_user                the application role loses UPDATE on `active`:
--                           the table-level UPDATE db/06 granted is revoked
--                           and given back column by column, every column
--                           but `id` and `active` (db/34's pattern). The
--                           app_user_update policy (db/09) is untouched; it
--                           now governs every column but those two. No route
--                           or walk updates app_user as the application (the
--                           four writers are definers: db/08's and db/62's
--                           decide_role_request()/guardian_link_establish(),
--                           db/81's sign-up seam, db/85's account_set_active())
--   account_set_active()    gains p_reason: (uuid, boolean, text). The two-
--                           argument form is DROPPED, so nothing can call the
--                           door without a reason (a CREATE OR REPLACE with a
--                           new argument would leave it beside the new one)
--   account_offboard_preview(uuid)        new: what disabling would cut
--   account_enable_notice_is_mine(uuid)   new: the notice's door
--   notification            + PERMISSIVE SELECT policy notification_account_enabled
--                           (the person reads the notice written on enable;
--                           db/57's and db/50's RESTRICTIVE cuts stand over it)
--
-- THE ONE DROP IN THIS FILE: DROP FUNCTION IF EXISTS
-- account_set_active(uuid, boolean). Nothing else is dropped: the policies are
-- created only when missing, the table only if not there.
--
-- EXISTING ROWS. None is changed. No account changes state. Accounts already
-- disabled stay disabled, with no reason row (they were disabled before there
-- was one to write). Every session stays as it is.
--
-- ORDER WITH THE API. The API built with this calls the three-argument
-- function, and refuses to start without db/90 (expected-migrations.json). An
-- API from before it calls the two-argument form, which this drops: between
-- the paste and the new API, Disable and Enable answer 500 and change nothing.
-- Everything else works.

-- ── 1 · The audit row (D4) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_status_change (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- The account's school at the time, copied, so the row reads alone and its
  -- policy needs no join. NULL for an account with no school.
  school_id   uuid REFERENCES school(id) ON DELETE CASCADE,
  -- What the account became.
  active      boolean NOT NULL,
  reason      text NOT NULL CHECK (length(btrim(reason)) >= 10 AND length(reason) <= 2000),
  changed_by  uuid NOT NULL REFERENCES app_user(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  -- The notice written on an enable, when there was a school to send it at.
  notice_id   uuid REFERENCES notification(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS account_status_change_user_idx ON account_status_change (user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS account_status_change_school_idx ON account_status_change (school_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS account_status_change_notice_idx ON account_status_change (notice_id) WHERE notice_id IS NOT NULL;

ALTER TABLE account_status_change ENABLE ROW LEVEL SECURITY;
-- The office's words about a person: the school's office and its auditors,
-- never the person (the office tells them). Created only when missing.
DO $read$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'account_status_change'
                    AND policyname = 'account_status_change_read') THEN
    CREATE POLICY account_status_change_read ON account_status_change
      FOR SELECT USING (
        coalesce(user_id <> app_user_id(), false)
        AND (app_can('user.invite', school_id, '*'::text,
                     '00000000-0000-0000-0000-000000000000'::uuid,
                     '00000000-0000-0000-0000-000000000000'::uuid)
             OR app_can('audit.read', school_id, '*'::text,
                        '00000000-0000-0000-0000-000000000000'::uuid,
                        '00000000-0000-0000-0000-000000000000'::uuid))
      );
  END IF;
END $read$;
-- A pad credential reads none of it (db/50).
SELECT pad_scope_guard_install('account_status_change'::regclass);
-- Written by account_set_active() alone.
GRANT SELECT ON account_status_change TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON account_status_change FROM scrbrd_app;


-- ── 2 · The notice's own door (D20) ────────────────────────────────
-- TRUE for a notice account_set_active() wrote to the caller when their
-- account was enabled. Definer, because the person may not read the audit
-- row; it answers only this one bit, about a notice addressed to them.
CREATE OR REPLACE FUNCTION account_enable_notice_is_mine(p_notice uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM account_status_change c
     WHERE c.notice_id = p_notice AND c.user_id = app_user_id() AND c.active)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DO $door$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_account_enabled') THEN
    CREATE POLICY notification_account_enabled ON notification
      FOR SELECT USING (
        kind = 'system' AND recipient_id = app_user_id() AND account_enable_notice_is_mine(id)
      );
  END IF;
END $door$;


-- ── 3 · The plain door closed (Q3) ─────────────────────────────────
-- db/06 granted the application UPDATE on every table, and db/09's
-- app_user_update let any user.role.assign holder (the principal, the
-- platform administrator) set `active` without the rule, the reason or the
-- notice. A column REVOKE does nothing while the table-level grant stands, so
-- the table-level UPDATE goes and comes back for every column but `id` and
-- `active`: db/34:84-89's way. A column a later file adds is not writable by
-- the application until that file grants it.
DO $close$
DECLARE v_cols text; r text;
BEGIN
  REVOKE UPDATE ON app_user FROM scrbrd_app;
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'app_user'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname NOT IN ('id', 'active');
  EXECUTE format('GRANT UPDATE (%s) ON app_user TO scrbrd_app', v_cols);
  -- A managed host's API roles write nothing here either.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE UPDATE ON app_user FROM %I', r);
    END IF;
  END LOOP;
END $close$;


-- ── 4 · The door, with its reason (D4, D20) ────────────────────────
-- The two-argument form goes: CREATE OR REPLACE with a third argument makes
-- a second function, and the first would still let the application act
-- without a reason. This file's one DROP.
DROP FUNCTION IF EXISTS account_set_active(uuid, boolean);

/**
 * The office, or the owner, disables or enables an account, saying why
 * (ok, reason, active). Refusals, in this order:
 *   not_signed_in · not_permitted (no account, or no answer asked) ·
 *   cannot_disable_yourself · not_permitted · superadmin_only (db/81's rule)
 *   · reason_required (under ten characters) · reason_too_long (over 2,000)
 * Authority before the reason, so a stranger learns nothing about the
 * account. Disabling bumps the epoch (db/85's trigger), so every token and
 * pad credential the account holds ends now; enabling brings none of them
 * back, and tells the person, never why. An account already in the state
 * asked for is answered ok and nothing is written.
 */
CREATE OR REPLACE FUNCTION account_set_active(p_user uuid, p_active boolean, p_reason text)
RETURNS TABLE (ok boolean, reason text, active boolean) AS $$
DECLARE
  v_me     uuid := app_user_id();
  v_why    text := btrim(coalesce(p_reason, ''));
  v_no     text;
  v_now    boolean;
  v_school uuid;
  v_change uuid := gen_random_uuid();
  v_notice uuid;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', NULL::boolean; RETURN; END IF;
  IF p_user IS NULL OR p_active IS NULL THEN RETURN QUERY SELECT false, 'not_permitted', NULL::boolean; RETURN; END IF;
  -- Your own account says nothing about anybody else's.
  IF p_user = v_me THEN RETURN QUERY SELECT false, 'cannot_disable_yourself', NULL::boolean; RETURN; END IF;
  -- Then authority, so a stranger learns nothing about the account.
  v_no := auth_office_refusal(p_user);
  IF v_no IS NOT NULL THEN RETURN QUERY SELECT false, v_no, NULL::boolean; RETURN; END IF;
  IF length(v_why) < 10 THEN RETURN QUERY SELECT false, 'reason_required', NULL::boolean; RETURN; END IF;
  IF length(v_why) > 2000 THEN RETURN QUERY SELECT false, 'reason_too_long', NULL::boolean; RETURN; END IF;

  SELECT u.active, u.school_id INTO v_now, v_school FROM app_user u WHERE u.id = p_user FOR UPDATE;
  IF v_now IS DISTINCT FROM p_active THEN
    UPDATE app_user SET active = p_active WHERE id = p_user;
    PERFORM auth_identity_log(CASE WHEN p_active THEN 'auth.account_enabled' ELSE 'auth.account_disabled' END, p_user);
    -- The notice on enable (D20): the date and what to do. Never the reason.
    IF p_active AND v_school IS NOT NULL THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, recipient_id)
      VALUES (v_school, NULL, 'school', 'system', 'medium', 'Your account was re-enabled',
              'Your account was re-enabled on '
                || to_char((now() AT TIME ZONE 'Africa/Johannesburg')::date, 'FMDD FMMonth YYYY')
                || '. Every device was signed out when it was disabled; sign in again where you need to.',
              'news.read', false, 'system', v_change, p_user)
      RETURNING id INTO v_notice;
    END IF;
    INSERT INTO account_status_change (id, user_id, school_id, active, reason, changed_by, notice_id)
    VALUES (v_change, p_user, v_school, p_active, v_why, v_me, v_notice);
  END IF;
  RETURN QUERY SELECT true, NULL::text, p_active;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 5 · What disabling would cut (D3, §2.3) ────────────────────────
/**
 * Before the office taps Disable: what the account has open. Counts, and the
 * fixtures of the scoring tokens it holds; never a child's name. Refused by
 * the same rule as the act, FIRST, so a stranger learns nothing:
 *   not_signed_in · not_permitted · cannot_disable_yourself ·
 *   superadmin_only · other_school
 * `other_school` is the one refusal said in words of its own before the tap
 * (§2.3's last row): the caller is the office of the account's own school
 * (user.invite there), and the account holds a standing role at another
 * school, which this office cannot end. Anybody else is not_permitted.
 *   sessions         devices signed in now (live, under the current epoch)
 *   pad_credentials  phones that can still score without signing in
 *   scoring_tokens   the fixture of every scoring token held now
 *   duties           match-day duties linked to the account, the next 14 days
 *   lifts            lifts the account drives, the next 14 days
 *   children         children at the account's school it is a verified
 *                    guardian of (a count)
 */
CREATE OR REPLACE FUNCTION account_offboard_preview(p_user uuid)
RETURNS TABLE (ok boolean, reason text, active boolean, sessions integer, pad_credentials integer,
               scoring_tokens text[], duties integer, lifts integer, children integer) AS $$
DECLARE
  v_me     uuid := app_user_id();
  v_no     text;
  v_school uuid;
  v_active boolean;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_signed_in', NULL::boolean, NULL::int, NULL::int, NULL::text[], NULL::int, NULL::int, NULL::int; RETURN;
  END IF;
  IF p_user IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::boolean, NULL::int, NULL::int, NULL::text[], NULL::int, NULL::int, NULL::int; RETURN;
  END IF;
  IF p_user = v_me THEN
    RETURN QUERY SELECT false, 'cannot_disable_yourself', NULL::boolean, NULL::int, NULL::int, NULL::text[], NULL::int, NULL::int, NULL::int; RETURN;
  END IF;
  v_no := auth_office_refusal(p_user);
  IF v_no = 'not_permitted' AND NOT app_pad_scoped() THEN
    SELECT u.school_id INTO v_school FROM app_user u WHERE u.id = p_user;
    IF v_school IS NOT NULL
       AND app_can('user.invite', v_school, '*'::text,
                   '00000000-0000-0000-0000-000000000000'::uuid,
                   '00000000-0000-0000-0000-000000000000'::uuid)
       AND EXISTS (SELECT 1 FROM role_assignment a
                    WHERE a.person_id = p_user AND a.active
                      AND a.school_id IS NOT NULL AND a.school_id <> v_school
                      AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
                      AND (a.valid_until IS NULL OR a.valid_until >  current_date)
                      AND (a.expires_at  IS NULL OR a.expires_at  >  now())) THEN
      v_no := 'other_school';
    END IF;
  END IF;
  IF v_no IS NOT NULL THEN
    RETURN QUERY SELECT false, v_no, NULL::boolean, NULL::int, NULL::int, NULL::text[], NULL::int, NULL::int, NULL::int; RETURN;
  END IF;

  SELECT u.active, u.school_id INTO v_active, v_school FROM app_user u WHERE u.id = p_user;
  RETURN QUERY SELECT
    true, NULL::text, v_active,
    (SELECT count(*)::int FROM auth_session s
      WHERE s.user_id = p_user AND s.revoked_at IS NULL AND s.expires_at > now()
        AND s.epoch = auth_epoch_of(p_user)),
    (SELECT count(*)::int FROM pad_resume_credential c
      WHERE c.user_id = p_user AND c.revoked_at IS NULL AND c.expires_at > now()),
    (SELECT coalesce(array_agg(audit_fixture_label(s.match_id) ORDER BY m.starts_at, s.match_id), '{}'::text[])
       FROM scoring_session s JOIN match m ON m.id = s.match_id
      WHERE s.holder_user_id = p_user AND s.state <> 'idle'),
    (SELECT count(*)::int FROM match_official o JOIN match m ON m.id = o.match_id
      WHERE o.person_id = p_user AND NOT o.withdrawn AND m.status IN ('scheduled', 'live')
        AND m.starts_at > now() - interval '1 day' AND m.starts_at < now() + interval '14 days'),
    (SELECT count(*)::int FROM lift_offer l
      WHERE l.driver_id = p_user AND l.state IN ('open', 'closed')
        AND l.meet_at > now() - interval '1 day' AND l.meet_at < now() + interval '14 days'),
    (SELECT count(DISTINCT g.player_id)::int FROM assignment_subject g
       JOIN role_assignment a ON a.id = g.assignment_id
      WHERE a.person_id = p_user AND a.role = 'guardian' AND a.active
        AND a.school_id IS NOT DISTINCT FROM v_school
        AND g.verification_state = 'verified'
        AND g.valid_from <= current_date AND (g.valid_until IS NULL OR g.valid_until > current_date));
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 6 · Who may call these ─────────────────────────────────────────
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['account_set_active(uuid,boolean,text)', 'account_offboard_preview(uuid)',
                           'account_enable_notice_is_mine(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
    -- The two doors are the API's; the third is called from the notification
    -- policy, so the application role runs it.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f::regprocedure);
  END LOOP;
  -- A managed host's API roles (Supabase grants new objects to them).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION account_set_active(uuid, boolean, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION account_offboard_preview(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION account_enable_notice_is_mine(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON account_status_change FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── 7 · What this file promised, checked in the same paste ─────────
-- The behaviour is asserted live in db/99 §69.
DO $check$
DECLARE f text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'account_status_change'::regclass) THEN
    RAISE EXCEPTION 'db/90: account_status_change is not under row-level security';
  END IF;
  IF has_table_privilege('scrbrd_app', 'account_status_change', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'account_status_change', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'account_status_change', 'DELETE') THEN
    RAISE EXCEPTION 'db/90: the application may write account_status_change';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'account_status_change'
                AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'db/90: account_status_change has a write policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'account_status_change'
                    AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/90: account_status_change has no RESTRICTIVE pad_scope_select (db/50)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_account_enabled' AND permissive = 'PERMISSIVE' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'db/90: notification_account_enabled is missing';
  END IF;
  -- The cuts on notification still stand over the new door.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
         AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
         AND policyname IN ('notification_recipient_only', 'notification_safeguarding_uncut', 'pad_scope_select')) <> 3 THEN
    RAISE EXCEPTION 'db/90: a RESTRICTIVE cut on notification is missing';
  END IF;
  -- Q3: `active` is the function's alone; the rest of the row is as before.
  IF has_column_privilege('scrbrd_app', 'app_user', 'active', 'UPDATE') THEN
    RAISE EXCEPTION 'db/90: the application may still write app_user.active';
  END IF;
  IF has_table_privilege('scrbrd_app', 'app_user', 'UPDATE') THEN
    RAISE EXCEPTION 'db/90: the application still holds UPDATE on all of app_user';
  END IF;
  IF NOT has_column_privilege('scrbrd_app', 'app_user', 'name', 'UPDATE')
     OR NOT has_table_privilege('scrbrd_app', 'app_user', 'SELECT')
     OR NOT has_table_privilege('scrbrd_app', 'app_user', 'INSERT') THEN
    RAISE EXCEPTION 'db/90: closing `active` took more of app_user than `active`';
  END IF;
  -- No door without a reason.
  IF to_regprocedure('account_set_active(uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'db/90: account_set_active(uuid, boolean) is still there';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname = 'account_set_active') <> 1 THEN
    RAISE EXCEPTION 'db/90: account_set_active has more than one form';
  END IF;
  FOREACH f IN ARRAY ARRAY['account_set_active(uuid,boolean,text)', 'account_offboard_preview(uuid)',
                           'account_enable_notice_is_mine(uuid)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/90: % is not SECURITY DEFINER', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/90: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/90: % is executable by PUBLIC', f;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/90: the application cannot call %', f;
    END IF;
  END LOOP;
  -- Disabling still ends sessions: db/85's trigger is what does it.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'app_user'::regclass
                    AND tgname = 'auth_account_disabled' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/90: auth_account_disabled (db/85) is not enabled on app_user';
  END IF;
END $check$;

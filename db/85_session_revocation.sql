-- ══════════════════════════════════════════════════════════════════
--  85 · A session ends when it is ended (GA-I03)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, for item I03 of the gap analysis of 5 October 2026
-- (audit/GAP_ANALYSIS_2026-10-05.md, "needs a migration and a paste").
--
-- THE DEFECT. A bearer token (services/api/auth/auth.mjs) is { sub, did },
-- HMAC-signed, thirty minutes, and the API checked only its signature and
-- its expiry. Nothing on the server knew a token had been issued, so nothing
-- could end one early:
--   * POST /api/auth/sign-out ended the pad's resume credentials (db/50)
--     and nothing else: a copy of the token went on working;
--   * an account set inactive went on working: app_user_id() is the token's
--     sub, and app_can() reads role_assignment, never app_user.active;
--   * removing a Google sign-in (db/81) refused the NEXT exchange and left
--     every token already minted from it alive;
-- each until the token expired, as long as the person's assignments stood.
-- Role revocation was never part of it: app_can() reads the live assignment
-- on every statement, and that stays exactly as it is.
--
-- THE RULE (decided 2026-10-07, Kameel's brief for GA-I03):
--   * every account has a session EPOCH, kept here; a token carries the
--     epoch it was issued under, and a session id;
--   * every request, in the one place the request's identity is set, checks
--     that the account is active, that the token's epoch is the account's
--     current one, and that its session has not been revoked — one indexed
--     lookup, in app_session_begin(), which is now the ONLY thing the API
--     calls to become somebody (services/api/auth/auth.mjs
--     sessionConfigStatements; a refusal is 401 session_revoked);
--   * signing out on a device revokes this person's sessions on that device;
--   * signing out everywhere, the office disabling the account, and the
--     removal of a way to sign in each bump the epoch, which ends every
--     token issued before it at once;
--   * the pad's resume credentials (db/50) follow the same rule: a bump ends
--     every live credential of the account, with the bump's reason, and the
--     identity check refuses a credential whose account is inactive.
--
-- WHAT IS HERE
--
--   1. auth_epoch — one row per account that has ever been bumped (no row is
--      epoch 0). auth_session — one row per token minted: who, which device,
--      the epoch it was minted under, when it ends, and whether this device
--      signed it out. Both are login_code's shape (db/05, db/81): row-level
--      security on, NO policy, NO privilege for the application; every read
--      and write is a SECURITY DEFINER function below. A person who could
--      write auth_epoch could bring a stolen token back to life.
--   2. auth_epoch_bump(person, reason) — internal. Bumps, and ends the pad's
--      live credentials for the person (pad_resume_credential.revoked_reason
--      gains the three reasons, re-emitted below), each on the scoring audit.
--   3. Two triggers, so the rule holds whichever door is used:
--        app_user: active true → false bumps ('account_disabled'). The
--          office's route below is one door; app_user_update (db/09, under
--          user.role.assign) is another, and a hand-run UPDATE a third.
--        auth_identity: revoked_at set bumps ('sign_in_removed'), from
--          auth_identity_revoke_self() and auth_identity_revoke() (db/81)
--          alike, unedited.
--   4. auth_session_open(person, device, ttl) — the mint. Called by every
--      door that issues a token (a code redeemed, the Google exchange, the
--      development sign-in) with NO identity, and by a signed-in person for
--      HIMSELF only (the fresh token a sign-in removal answers with). Refuses
--      an inactive account. Prunes the person's sessions a day past their end.
--   5. app_session_begin(person, device, session, epoch, pad) — the check,
--      and then the identity: app.user_id and app.device_id, transaction-
--      local. Three kinds of caller:
--        a token     — the session row is this person's, this device's, not
--                      revoked, minted under the token's epoch, which is the
--                      account's current one; and the account is active;
--        a pad       — the credential is this person's and this device's,
--                      still working (pad_resume_ended() IS NULL); and the
--                      account is active;
--        the server  — acting as a recipient (the push fan-out asks "may
--                      this person read the notice" as them): the account is
--                      active. No token is involved, so there is nothing to
--                      revoke but the account.
--      A refusal raises 28000 'session_revoked' and the transaction is gone.
--      Anonymous (NULL person) sets the empty identity, as before.
--   6. auth_sign_out() — this device's sessions (POST /api/auth/sign-out,
--      beside pad_resume_sign_out()). auth_sign_out_everywhere() — the
--      person's epoch (POST /api/auth/sign-out-everywhere; an API route, no
--      screen). account_set_active(person, active) — the office or the
--      owner (POST /api/auth/users/:id/disable and /enable), under db/81's
--      one rule for acting on somebody else's account, auth_office_refusal():
--      user.invite at the account's school, every standing assignment one
--      the caller could grant, a platform-wide one only by a superadmin.
--      Never your own account. Each act is on access_log.
--
-- app_user_id() IS UNCHANGED. It reads app.user_id, which only
-- app_session_begin() now sets for a request, and it stays the cheap STABLE
-- function every policy calls per row. The check is once per transaction,
-- not once per row.
--
-- TOKENS ISSUED BEFORE THIS have no session and are refused by the API from
-- the deploy on (401 incomplete_claims): everybody signed in signs in once
-- more. The pad's resume credentials are not tokens and are not affected.
--
-- No secret. The live proof is db/99 §64; tools/smoke-login.mjs,
-- tools/smoke-signup.mjs and tools/smoke-pad-resume.mjs walk it through the
-- API. search_path pinned on every function (db/16). Safe to run twice.


-- ── 0 · What this file relies on is there ──────────────────────────
DO $needs$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'app_user'::regclass
                    AND attname = 'active' AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'db/85: app_user.active is missing, or nullable';
  END IF;
  IF to_regclass('auth_identity') IS NULL OR to_regprocedure('auth_office_refusal(uuid)') IS NULL
     OR to_regprocedure('auth_identity_log(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/85: db/81 (auth_identity, auth_office_refusal, auth_identity_log) is missing; apply it first';
  END IF;
  IF to_regclass('pad_resume_credential') IS NULL OR to_regprocedure('pad_resume_ended(pad_resume_credential)') IS NULL
     OR to_regprocedure('app_pad_scoped()') IS NULL THEN
    RAISE EXCEPTION 'db/85: db/50 (the pad''s resume credential) is missing; apply it first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'auth_identity'::regclass
                    AND attname = 'revoked_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'db/85: auth_identity.revoked_at is missing';
  END IF;
END $needs$;


-- ── 1 · The epoch, and the sessions ────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_epoch (
  user_id   uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  epoch     integer NOT NULL CHECK (epoch > 0),
  bumped_at timestamptz NOT NULL DEFAULT now(),
  -- Who: the person signing out everywhere, the office, the remover of a
  -- sign-in. NULL when nobody was signed in (a hand-run UPDATE).
  bumped_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reason    text NOT NULL CHECK (reason IN ('signed_out_everywhere', 'account_disabled', 'sign_in_removed'))
);

CREATE TABLE IF NOT EXISTS auth_session (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id      text NOT NULL CHECK (btrim(device_id) <> '' AND length(device_id) <= 200),
  epoch          integer NOT NULL CHECK (epoch >= 0),
  issued_at      timestamptz NOT NULL DEFAULT now(),
  -- The token's own expiry, for pruning. The API checks the token's exp.
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text CHECK (revoked_reason IN ('signed_out')),
  CONSTRAINT auth_session_revocation_is_whole CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT auth_session_expires_after_issue CHECK (expires_at > issued_at)
);
-- A device's sign-out, and the mint's pruning.
CREATE INDEX IF NOT EXISTS auth_session_by_device ON auth_session (user_id, device_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_session_by_end ON auth_session (user_id, expires_at);

ALTER TABLE auth_epoch   ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_session ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_epoch   FROM scrbrd_app;
REVOKE ALL ON auth_session FROM scrbrd_app;

COMMENT ON TABLE auth_epoch IS
  'db/85 (GA-I03): an account''s session epoch. A token minted under an earlier one is refused. No row is epoch 0. No policy, no privilege: auth_epoch_bump() only.';
COMMENT ON TABLE auth_session IS
  'db/85 (GA-I03): one row per token minted (auth_session_open), checked on every request (app_session_begin). No policy, no privilege.';


-- ── 2 · The pad's credential learns three more reasons ────────────
-- db/50's CHECK, as it shipped, plus the three a bump writes. Re-emitted
-- only when it still reads exactly as db/50 wrote it; a second run finds
-- the new one and leaves it.
DO $reasons$
DECLARE
  v_def text;
  v_old text := 'CHECK ((revoked_reason = ANY (ARRAY[''reissued''::text, ''token_moved''::text, ''released''::text, ''match_complete''::text, ''match_abandoned''::text, ''signed_out''::text, ''office''::text])))';
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'pad_resume_credential'::regclass AND c.conname = 'pad_resume_credential_revoked_reason_check';
  IF v_def IS NOT DISTINCT FROM v_old THEN
    ALTER TABLE pad_resume_credential DROP CONSTRAINT pad_resume_credential_revoked_reason_check;
  ELSIF v_def IS NOT NULL THEN
    IF position('signed_out_everywhere' IN v_def) = 0 THEN
      RAISE EXCEPTION 'db/85: pad_resume_credential''s revoked_reason check is not db/50''s any more: %', v_def;
    END IF;
    RETURN;   -- a second run
  END IF;
  ALTER TABLE pad_resume_credential ADD CONSTRAINT pad_resume_credential_revoked_reason_check
    CHECK (revoked_reason IN ('reissued', 'token_moved', 'released', 'match_complete', 'match_abandoned',
                              'signed_out', 'office',
                              'signed_out_everywhere', 'account_disabled', 'sign_in_removed'));
END $reasons$;


-- ── 3 · The bump ──────────────────────────────────────────────────
-- Internal: the triggers and auth_sign_out_everywhere() call it; nobody
-- else may. Answers the new epoch.
CREATE OR REPLACE FUNCTION auth_epoch_bump(p_user uuid, p_reason text) RETURNS integer AS $$
DECLARE v_epoch integer; r record;
BEGIN
  INSERT INTO auth_epoch AS e (user_id, epoch, bumped_at, bumped_by, reason)
  VALUES (p_user, 1, now(), app_user_id(), p_reason)
  ON CONFLICT (user_id) DO UPDATE
     SET epoch = e.epoch + 1, bumped_at = now(), bumped_by = app_user_id(), reason = EXCLUDED.reason
  RETURNING e.epoch INTO v_epoch;
  -- The pad's credentials are the person's too (db/50). Each on the scoring
  -- audit, as every other way a credential ends is.
  FOR r IN
    UPDATE pad_resume_credential c
       SET revoked_at = now(), revoked_reason = p_reason, revoked_by = app_user_id()
     WHERE c.user_id = p_user AND c.revoked_at IS NULL
    RETURNING c.id, c.match_id, c.school_id
  LOOP
    INSERT INTO scoring_audit (match_id, school_id, event, actor_id, to_user, detail)
    VALUES (r.match_id, r.school_id, 'pad_resume_revoked', app_user_id(), p_user,
            jsonb_build_object('reason', p_reason, 'credential', r.id));
  END LOOP;
  RETURN v_epoch;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- An account's current epoch. Internal.
CREATE OR REPLACE FUNCTION auth_epoch_of(p_user uuid) RETURNS integer AS $$
  SELECT coalesce((SELECT e.epoch FROM auth_epoch e WHERE e.user_id = p_user), 0)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 4 · Whichever door: disabling, and removing a sign-in ─────────
CREATE OR REPLACE FUNCTION auth_account_disabled() RETURNS trigger AS $$
BEGIN
  PERFORM auth_epoch_bump(NEW.id, 'account_disabled');
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS auth_account_disabled ON app_user;
CREATE TRIGGER auth_account_disabled
  AFTER UPDATE OF active ON app_user
  FOR EACH ROW WHEN (OLD.active AND NOT NEW.active)
  EXECUTE FUNCTION auth_account_disabled();

CREATE OR REPLACE FUNCTION auth_sign_in_removed() RETURNS trigger AS $$
BEGIN
  PERFORM auth_epoch_bump(NEW.user_id, 'sign_in_removed');
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS auth_sign_in_removed ON auth_identity;
CREATE TRIGGER auth_sign_in_removed
  AFTER UPDATE OF revoked_at ON auth_identity
  FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION auth_sign_in_removed();


-- ── 5 · The mint ───────────────────────────────────────────────────
/**
 * A session for a token about to be signed: (session_id, epoch), or no row.
 * With NO identity (a login: a code redeemed, the Google exchange, the
 * development sign-in), for anybody whose account is active. Signed in, for
 * yourself only, never under a pad's credential.
 */
CREATE OR REPLACE FUNCTION auth_session_open(p_user uuid, p_device text, p_ttl_sec integer)
RETURNS TABLE (session_id uuid, epoch integer) AS $$
DECLARE v_id uuid; v_epoch integer;
BEGIN
  IF app_pad_scoped() OR (app_user_id() IS NOT NULL AND app_user_id() IS DISTINCT FROM p_user) THEN RETURN; END IF;
  IF p_user IS NULL OR p_device IS NULL OR btrim(p_device) = '' OR length(p_device) > 200
     OR p_ttl_sec IS NULL OR p_ttl_sec NOT BETWEEN 60 AND 86400 THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_user AND u.active) THEN RETURN; END IF;
  DELETE FROM auth_session s WHERE s.user_id = p_user AND s.expires_at < now() - interval '1 day';
  v_epoch := auth_epoch_of(p_user);
  INSERT INTO auth_session (user_id, device_id, epoch, expires_at)
  VALUES (p_user, p_device, v_epoch, now() + make_interval(secs => p_ttl_sec))
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, v_epoch;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 6 · The check, and then the identity ──────────────────────────
/**
 * The one way a request becomes somebody. See the header (5) for the three
 * kinds of caller. Raises 28000 'session_revoked' on any refusal, saying no
 * more: the holder of a dead token learns nothing about why.
 */
CREATE OR REPLACE FUNCTION app_session_begin(p_user uuid, p_device text, p_session uuid, p_epoch integer, p_pad uuid DEFAULT NULL)
RETURNS void AS $$
BEGIN
  IF p_user IS NULL THEN
    PERFORM set_config('app.user_id', '', true);
    PERFORM set_config('app.device_id', '', true);
    RETURN;
  END IF;
  IF p_session IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM auth_session s JOIN app_user u ON u.id = s.user_id
       WHERE s.id = p_session AND s.user_id = p_user AND s.device_id = p_device
         AND s.revoked_at IS NULL AND s.epoch = p_epoch AND u.active
         AND s.epoch = coalesce((SELECT e.epoch FROM auth_epoch e WHERE e.user_id = p_user), 0)) THEN
      RAISE EXCEPTION 'session_revoked' USING ERRCODE = 'invalid_authorization_specification';
    END IF;
  ELSIF p_pad IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pad_resume_credential c JOIN app_user u ON u.id = c.user_id
       WHERE c.id = p_pad AND c.user_id = p_user AND c.device_id = p_device AND u.active
         AND pad_resume_ended(c) IS NULL) THEN
      RAISE EXCEPTION 'session_revoked' USING ERRCODE = 'invalid_authorization_specification';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_user AND u.active) THEN
    RAISE EXCEPTION 'session_revoked' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  PERFORM set_config('app.user_id', p_user::text, true);
  PERFORM set_config('app.device_id', coalesce(p_device, ''), true);
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

COMMENT ON FUNCTION app_session_begin(uuid, text, uuid, integer, uuid) IS
  'db/85 (GA-I03): the request''s identity, set transaction-locally only after the account is active and the token''s session (or the pad''s credential) is live under the current epoch. 28000 session_revoked otherwise.';


-- ── 7 · The doors ─────────────────────────────────────────────────
/** This device signs out: every live session of this person on it. Answers how many. */
CREATE OR REPLACE FUNCTION auth_sign_out() RETURNS integer AS $$
DECLARE n integer;
BEGIN
  IF app_pad_scoped() OR app_user_id() IS NULL OR app_device_id() IS NULL THEN RETURN 0; END IF;
  UPDATE auth_session s SET revoked_at = now(), revoked_reason = 'signed_out'
   WHERE s.user_id = app_user_id() AND s.device_id = app_device_id() AND s.revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** Every token and pad credential this person holds ends, this one included. (ok, reason, epoch). */
CREATE OR REPLACE FUNCTION auth_sign_out_everywhere() RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE v_me uuid := app_user_id(); v_epoch integer;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', NULL::int; RETURN; END IF;
  IF app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_permitted', NULL::int; RETURN; END IF;
  v_epoch := auth_epoch_bump(v_me, 'signed_out_everywhere');
  PERFORM auth_identity_log('auth.signed_out_everywhere', v_me);
  RETURN QUERY SELECT true, NULL::text, v_epoch;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The office, or the owner, disables or enables an account (ok, reason, active):
 *   not_signed_in · not_permitted · superadmin_only (db/81's rule) ·
 *   cannot_disable_yourself
 * Disabling bumps the epoch (the trigger), so every token and pad credential
 * the account holds ends now; enabling brings none of them back.
 */
CREATE OR REPLACE FUNCTION account_set_active(p_user uuid, p_active boolean)
RETURNS TABLE (ok boolean, reason text, active boolean) AS $$
DECLARE v_why text; v_now boolean;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', NULL::boolean; RETURN; END IF;
  IF p_user IS NULL OR p_active IS NULL THEN RETURN QUERY SELECT false, 'not_permitted', NULL::boolean; RETURN; END IF;
  -- Your own account says nothing about anybody else's.
  IF p_user = app_user_id() THEN RETURN QUERY SELECT false, 'cannot_disable_yourself', NULL::boolean; RETURN; END IF;
  -- Then authority, so a stranger learns nothing about the account.
  v_why := auth_office_refusal(p_user);
  IF v_why IS NOT NULL THEN RETURN QUERY SELECT false, v_why, NULL::boolean; RETURN; END IF;
  SELECT u.active INTO v_now FROM app_user u WHERE u.id = p_user FOR UPDATE;
  IF v_now IS DISTINCT FROM p_active THEN
    UPDATE app_user SET active = p_active WHERE id = p_user;
    PERFORM auth_identity_log(CASE WHEN p_active THEN 'auth.account_enabled' ELSE 'auth.account_disabled' END, p_user);
  END IF;
  RETURN QUERY SELECT true, NULL::text, p_active;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 8 · Who may call these ────────────────────────────────────────
DO $grants$
DECLARE
  f text; r text;
  v_app text[] := ARRAY[
    'auth_session_open(uuid,text,integer)', 'app_session_begin(uuid,text,uuid,integer,uuid)',
    'auth_sign_out()', 'auth_sign_out_everywhere()', 'account_set_active(uuid,boolean)'];
  v_internal text[] := ARRAY[
    'auth_epoch_bump(uuid,text)', 'auth_epoch_of(uuid)', 'auth_account_disabled()', 'auth_sign_in_removed()'];
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
      EXECUTE format('REVOKE ALL ON auth_epoch FROM %I', r);
      EXECUTE format('REVOKE ALL ON auth_session FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── 9 · What this file promised, checked in the same paste ────────
-- The behaviour is asserted live in db/99 §64.
DO $check$
DECLARE f text; t text; v_def text;
BEGIN
  -- The two tables: under RLS, no policy, no privilege for the application.
  FOREACH t IN ARRAY ARRAY['auth_epoch', 'auth_session'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      RAISE EXCEPTION 'db/85: % is not under row-level security', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION 'db/85: % has a policy; every read and write is a function', t;
    END IF;
    IF has_table_privilege('scrbrd_app', t, 'SELECT') OR has_table_privilege('scrbrd_app', t, 'INSERT')
       OR has_table_privilege('scrbrd_app', t, 'UPDATE') OR has_table_privilege('scrbrd_app', t, 'DELETE') THEN
      RAISE EXCEPTION 'db/85: the application holds a privilege on %', t;
    END IF;
  END LOOP;

  -- The two triggers: AFTER UPDATE, FOR EACH ROW, enabled, on their functions.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg
                  WHERE tg.tgrelid = 'app_user'::regclass AND tg.tgname = 'auth_account_disabled'
                    AND NOT tg.tgisinternal AND tg.tgenabled = 'O'
                    AND tg.tgfoid = 'auth_account_disabled()'::regprocedure
                    AND (tg.tgtype & 1) = 1 AND (tg.tgtype & 2) = 0 AND (tg.tgtype & 16) = 16) THEN
    RAISE EXCEPTION 'db/85: auth_account_disabled is not an enabled AFTER UPDATE row trigger on app_user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg
                  WHERE tg.tgrelid = 'auth_identity'::regclass AND tg.tgname = 'auth_sign_in_removed'
                    AND NOT tg.tgisinternal AND tg.tgenabled = 'O'
                    AND tg.tgfoid = 'auth_sign_in_removed()'::regprocedure
                    AND (tg.tgtype & 1) = 1 AND (tg.tgtype & 2) = 0 AND (tg.tgtype & 16) = 16) THEN
    RAISE EXCEPTION 'db/85: auth_sign_in_removed is not an enabled AFTER UPDATE row trigger on auth_identity';
  END IF;

  -- The pad's credential can carry the three reasons.
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'pad_resume_credential'::regclass AND c.conname = 'pad_resume_credential_revoked_reason_check';
  IF v_def IS NULL OR position('signed_out_everywhere' IN v_def) = 0 OR position('account_disabled' IN v_def) = 0
     OR position('sign_in_removed' IN v_def) = 0 OR position('token_moved' IN v_def) = 0 THEN
    RAISE EXCEPTION 'db/85: pad_resume_credential''s revoked reasons are not db/50''s plus the three: %', v_def;
  END IF;

  -- Every function: definer, pinned, never PUBLIC; the internal ones not the application's.
  FOREACH f IN ARRAY ARRAY['auth_session_open(uuid,text,integer)', 'app_session_begin(uuid,text,uuid,integer,uuid)',
                           'auth_sign_out()', 'auth_sign_out_everywhere()', 'account_set_active(uuid,boolean)',
                           'auth_epoch_bump(uuid,text)', 'auth_epoch_of(uuid)',
                           'auth_account_disabled()', 'auth_sign_in_removed()'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/85: % is not SECURITY DEFINER', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/85: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/85: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['auth_epoch_bump(uuid,text)', 'auth_epoch_of(uuid)'] LOOP
    IF has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/85: the application may call % directly', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('scrbrd_app', 'app_session_begin(uuid,text,uuid,integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/85: the application cannot call app_session_begin()';
  END IF;

  -- The identity is set only after the check: no set_config before the last refusal.
  SELECT prosrc INTO v_def FROM pg_proc WHERE oid = 'app_session_begin(uuid,text,uuid,integer,uuid)'::regprocedure;
  IF position('set_config(''app.user_id'', p_user::text, true)' IN v_def) = 0
     OR position('RAISE' IN substr(v_def, position('set_config(''app.user_id'', p_user::text, true)' IN v_def))) > 0 THEN
    RAISE EXCEPTION 'db/85: app_session_begin() sets the identity before its last refusal';
  END IF;
  IF position(', false)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'db/85: app_session_begin() sets a session-level setting';
  END IF;
END $check$;

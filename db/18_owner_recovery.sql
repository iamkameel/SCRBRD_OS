-- ══════════════════════════════════════════════════════════════════
--  18 · A way back in that does not run through the SQL Editor
-- ══════════════════════════════════════════════════════════════════
--
-- The owner's code (db/98_seed_pilot.sql / tools/bootstrap.mjs --owner) is
-- single-use and time-boxed like any other, and a school's office is who
-- reissues everyone else's. There is no office for the owner. Until this,
-- "the code is not valid any more" meant opening the Supabase SQL Editor and
-- pasting a hand-written script that touched SESSION_SECRET directly — slow,
-- and the kind of thing that gets done under pressure exactly when a mistake
-- is likeliest.
--
-- This function is the other half of POST /api/auth/owner/recover
-- (services/api/write/owner-recovery-api.mjs). It runs with NO PRINCIPAL —
-- app_user_id() is not consulted anywhere in it — because the whole point is
-- to work when nobody is signed in. Its only gate, checked here rather than
-- trusted to the caller, is that the account named already holds a
-- platform-wide superadmin assignment. It cannot create that assignment,
-- widen one, or touch any other account: it can only refresh access to a
-- key that already exists. The API route's own gate — a recovery secret
-- distinct from SESSION_SECRET, compared in constant time, unset by default
-- — decides who may call it at all; this function decides what calling it
-- can possibly do.
CREATE OR REPLACE FUNCTION owner_recovery_issue(
  p_email   text,
  p_hash    text,
  p_ttl_sec integer
) RETURNS TABLE (ok boolean, reason text, expires_at timestamptz) AS $$
DECLARE
  v_user uuid;
  v_exp  timestamptz;
BEGIN
  SELECT u.id INTO v_user
    FROM app_user u
   WHERE lower(u.email) = lower(btrim(p_email)) AND u.active
   LIMIT 1;

  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, 'not_owner', NULL::timestamptz; RETURN;
  END IF;

  -- The one gate. Not "holds superadmin somewhere" — a platform-wide
  -- assignment, live today, the same test db/99 uses for the owner's key.
  IF NOT EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.person_id = v_user AND a.role = 'superadmin' AND a.school_id IS NULL AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
  ) THEN
    RETURN QUERY SELECT false, 'not_owner', NULL::timestamptz; RETURN;
  END IF;

  UPDATE login_code SET used_at = now()
   WHERE login_code.user_id = v_user AND login_code.used_at IS NULL;

  v_exp := now() + make_interval(secs => greatest(60, p_ttl_sec));
  INSERT INTO login_code (user_id, code_hash, expires_at, issued_by)
  VALUES (v_user, p_hash, v_exp, v_user);   -- self-issued: no other principal exists here

  RETURN QUERY SELECT true, NULL::text, v_exp;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION owner_recovery_issue(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owner_recovery_issue(text, text, integer) TO PUBLIC;

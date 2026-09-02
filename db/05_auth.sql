-- ════════════════════════════════════════════════════════════════
--  SCRBRD — the login lookup
--
--  Authentication has a bootstrapping problem: it must find a person from a
--  credential BEFORE any identity exists to authorise the lookup with. Under
--  row-level security that means the ordinary app_user read policy denies it,
--  correctly — app_user_id() is not set yet, so no assignment matches, so
--  nothing is visible.
--
--  The answer is not to loosen the policy. It is one narrow, auditable
--  SECURITY DEFINER function that answers exactly one question — "is there an
--  active account at this address, and what is its id?" — and returns nothing
--  else. No name, no school, no role, no assignments. Whatever the caller does
--  next runs under the person's own identity and is subject to every policy
--  like any other request.
--
--  This is deliberately the only privileged read in the schema that is not
--  part of the authorization decision itself.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auth_account_for_email(p_email text)
RETURNS uuid AS $$
  SELECT id FROM app_user
   WHERE lower(email) = lower(p_email)
     AND active
   LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- An inactive or unknown address returns NULL rather than raising, so callers
-- can answer identically in both cases and not become an account-enumeration
-- oracle. requestMagicLink() in services/api/auth/auth-db.mjs depends on that:
-- it returns { ok: true } whether or not the account exists.
COMMENT ON FUNCTION auth_account_for_email(text) IS
  'Login bootstrap only. Returns the id of an active account, or NULL. Never widen this.';

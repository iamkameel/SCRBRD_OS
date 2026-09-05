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


-- ── The login code itself ───────────────────────────────────────
--
-- This table had no home in db/ for the whole life of the project. It existed
-- as SQL inside a comment in services/api/auth/auth-db.mjs, which meant the
-- redeem path was written, correct, tested at the unit level — and could not
-- run, because the table it selects from was never created. The only working
-- sign-in was the development route, which is refused outside development. A
-- deployed instance had no way in at all.
--
-- HOW A CODE IS DELIVERED, which is a product decision and not a technical one:
-- SCRBRD sends no email and no SMS. So a code is ISSUED BY THE SCHOOL OFFICE to
-- somebody they can already identify, and handed over the way a school already
-- hands things over — on the enrolment letter, at the staff meeting, in person.
-- That is not a workaround for missing infrastructure; for a platform holding
-- children's data it is a stronger enrolment story than a link emailed to
-- whatever address was typed into a form, because somebody with
-- `user.invite` looked at the person first.
--
-- requestMagicLink() in auth-db.mjs is kept and deliberately NOT wired: it is
-- the same table and the same redeem path, waiting for a delivery channel.
CREATE TABLE login_code (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- The HASH, never the code. A login code in a database is a password in a
  -- database, and this one is single-use and time-boxed precisely so that a
  -- copy of the table is not a set of working keys.
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  issued_by  uuid REFERENCES app_user(id),
  issued_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON login_code (user_id) WHERE used_at IS NULL;
CREATE UNIQUE INDEX ON login_code (code_hash);

-- NO POLICY AT ALL, and row-level security ON. Every read and write of this
-- table happens in the login path, before an identity exists, through the
-- SECURITY DEFINER functions below. The application role must never be able to
-- read a code_hash under a signed-in session: a person who can list login codes
-- can become anybody at their school.
ALTER TABLE login_code ENABLE ROW LEVEL SECURITY;

/**
 * Issue a code for somebody, and return it ONCE to the issuer.
 *
 * SECURITY DEFINER, and the authority check is the first thing in it. The
 * issuer must hold `user.invite` at the school the account belongs to — so a
 * school office enrols its own people and nobody else's, and a person with no
 * such capability cannot mint a credential for anyone.
 *
 * The recipient is looked up by the same narrow bootstrap function the login
 * path uses, so an unknown or deactivated address behaves exactly like a
 * permitted one that does not exist: 'not_permitted'. An administrator with
 * user.invite is not an enumeration risk for their own school, but the caller
 * of this function is not always going to be one, and the cheap answer is to
 * never distinguish.
 *
 * PREVIOUS UNUSED CODES ARE SPENT. Issuing a second code invalidates the
 * first, so a code read out at a meeting and then re-issued because somebody
 * lost it cannot both still work.
 */
CREATE OR REPLACE FUNCTION login_code_issue(
  p_email   text,
  p_hash    text,
  p_ttl_sec integer
) RETURNS TABLE (ok boolean, reason text, user_id uuid, expires_at timestamptz) AS $$
DECLARE
  v_user   uuid;
  v_school uuid;
  v_exp    timestamptz;
BEGIN
  SELECT u.id, u.school_id INTO v_user, v_school
    FROM app_user u
   WHERE lower(u.email) = lower(btrim(p_email)) AND u.active
   LIMIT 1;

  IF v_user IS NULL
     OR NOT app_can('user.invite', v_school, '*'::text,
                    '00000000-0000-0000-0000-000000000000'::uuid,
                    '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;

  -- Nobody issues themselves a fresh credential. It is not much of an attack —
  -- they are already signed in — but a code issued to yourself is a way to move
  -- a live session onto another device with no second person involved, and this
  -- codebase refuses self-grants everywhere else.
  IF v_user = app_user_id() THEN
    RETURN QUERY SELECT false, 'cannot_issue_to_yourself', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;

  UPDATE login_code SET used_at = now()
   WHERE login_code.user_id = v_user AND login_code.used_at IS NULL;

  v_exp := now() + make_interval(secs => greatest(60, p_ttl_sec));
  INSERT INTO login_code (user_id, code_hash, expires_at, issued_by)
  VALUES (v_user, p_hash, v_exp, app_user_id());

  RETURN QUERY SELECT true, NULL::text, v_user, v_exp;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION login_code_issue(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_code_issue(text, text, integer) TO PUBLIC;

/**
 * Redeem one. Runs with NO identity — that is the whole point of a login.
 *
 * Spends the code before returning, inside one statement, so two devices
 * racing on the same code cannot both be issued a session.
 */
CREATE OR REPLACE FUNCTION login_code_redeem(p_email text, p_hash text)
RETURNS uuid AS $$
  UPDATE login_code c
     SET used_at = now()
   WHERE c.id = (
     SELECT c2.id FROM login_code c2
      WHERE c2.code_hash = p_hash
        AND c2.used_at IS NULL
        AND c2.expires_at > now()
        AND c2.user_id = auth_account_for_email(p_email)
      LIMIT 1)
  RETURNING c.user_id
$$ LANGUAGE sql SECURITY DEFINER;

REVOKE ALL ON FUNCTION login_code_redeem(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_code_redeem(text, text) TO PUBLIC;

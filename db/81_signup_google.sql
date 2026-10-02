-- ══════════════════════════════════════════════════════════════════
--  81 · Sign-up with Google, and an account with no school (SCRBRD-140 phase 1)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-140_signup_and_school_linking.md
-- (decided by Kameel, 2026-10-02: D1–D14 as recommended). The API verifies a
-- Firebase ID token itself (services/api/auth/firebase-verify.mjs) and then
-- asks ONE function here who that Google account is on SCRBRD; the answer
-- ends in the same thirty-minute, device-bound token a login code ends in.
-- Firebase never says what anybody may do: authority stays role_assignment
-- rows that app_can() reads at query time (ADR 0001). Nothing here adds a
-- role, a capability or a token claim.
--
-- WHAT IS HERE
--
--   1. app_enrolled() and D14. Sixteen read policies said "anybody signed in"
--      (app_user_id() IS NOT NULL): the lead's fourteen — official,
--      official_accreditation, season, sport, feature_flag, feature_grant,
--      feature_suppression, load_unit, bowling_directive,
--      clearance_requirement, clearance_kind_max_days, playing_condition_key,
--      rulebook_clause, rulebook_clause_age — and two more found by asking
--      pg_policies: drill (the platform's own drills) and sponsor_category.
--      Until now "signed in" meant "somebody a school enrolled"; with open
--      sign-up it means "anybody with a Google account", and `official` holds
--      umpires' ID numbers, birthdays and phones. Each policy is re-emitted
--      with that one predicate replaced by app_enrolled(): signed in AND
--      holding an assignment app_can() would honour (live, in its dates, not
--      past its hour, not suspended, and — for a role that only means anything
--      about somebody — naming a live, verified person). Guarded: each policy
--      must read exactly as it shipped, or this file refuses to run; one that
--      already reads app_enrolled() is left alone, so the file runs twice. The
--      pad's credential was already cut from all sixteen by db/50's
--      RESTRICTIVE pad_scope_select, and nothing here touches that.
--   2. auth_identity: a way to prove you are an app_user — a Google account
--      today, Microsoft and email-link later — keyed on the provider's stable
--      uid and never on the email. pending_claim: a Google sign-in whose
--      verified email matches an account that holds or held something, waiting
--      for a person at the school to look (D3, never silent). Both are
--      login_code's shape (db/05): row-level security on, NO policy at all, and
--      no table privilege for the application either; every read and write is
--      one of the SECURITY DEFINER functions below.
--   3. The functions, each answering rather than raising:
--        auth_identity_sign_in(provider, uid, email, name) — the exchange's
--          one question, asked with NO identity (§3.3's table, in its order);
--        auth_identity_link_self(provider, uid, email) — a signed-in person
--          adds another way to sign in (D11; the API asks for a fresh
--          auth_time). After an office code, this is the "code" path of §3.3;
--        auth_identity_revoke_self(id), auth_identity_revoke(id) — the person,
--          or the office (user.invite at the account's school);
--        pending_claim_confirm(id), pending_claim_decline(id) — the office;
--        pending_claims() — the office's Claims list;
--        my_sign_ins() — the person's own, never a uid;
--        account_sign_ins(user) — the office's view of one account's;
--        role_requester(request) — who asked, for whoever may read the
--          request: the office's Requests list could not see an account with
--          no school (app_user_read reads one only at the office's school).
--      ONE RULE (auth_office_refusal()) decides when the office may act on
--      somebody else's account — issue it a login code, confirm or decline a
--      claim on it, read or revoke its sign-ins: user.invite at the account's
--      school, AND every standing assignment on the account is one the caller
--      could grant there (app_may_grant_at(), db/77), AND a platform-wide one
--      only by a superadmin. login_code_issue() (db/05) is RE-EMITTED with it,
--      md5-guarded: before this file a school office could issue itself a
--      code for its principal, its DSO, or an owner's key filed at the school
--      — and the raw code comes back to the issuer.
--   4. The pupil-consent trigger (§5.3, §7.3): an identity is written to a
--      pupil's account only while he is an adult, or his own `self` link is
--      verified, live and consented ('granted'). Every door above passes it.
--   5. decide_role_request()'s seam (§4.3): granting a request to an account
--      with no school sets app_user.school_id to the request's, so the
--      account has an office for codes and erasure — never for an account
--      holding a platform-wide assignment. Re-emitted from db/77's body,
--      md5-guarded as db/77 re-emits.
--
-- AN ACCOUNT WITH NO SCHOOL can read its own app_user row, its own role
-- requests (role_request_read), its own sign-ins (my_sign_ins()), the school
-- list (public_schools(), already signed-out) and the policy catalogue
-- (capability, role_capability, role_grantable: readable signed out too).
-- Nothing else. db/99 §60 asserts that table by table and view by view.
--
-- NO SECRET, and none is needed for verification: Google's signing keys are
-- public. Applies on db/78 and on db/79–80 alike; it reads nothing they add.
--
-- search_path pinned on every function (db/16). Safe to run twice.


-- ── 1 · Enrolled: signed in, and holding something app_can() honours ──
CREATE OR REPLACE FUNCTION app_enrolled() RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND EXISTS (
    SELECT 1
      FROM role_assignment a
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       -- A role that only means anything about somebody reaches nothing until
       -- it names a live, verified person (app_can()'s own CASE, db/23).
       AND (a.role <> ALL (ARRAY['guardian', 'selfaccess', 'enquiry']::text[])
            OR EXISTS (SELECT 1 FROM assignment_subject g
                        WHERE g.assignment_id = a.id
                          AND g.verification_state = 'verified'
                          AND g.valid_from <= current_date
                          AND (g.valid_until IS NULL OR g.valid_until > current_date)))
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION app_enrolled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enrolled() TO scrbrd_app;

COMMENT ON FUNCTION app_enrolled() IS
  'Signed in AND holding an assignment app_can() would honour. What "signed in" meant before open sign-up (SCRBRD-140 D14).';

-- The sixteen, as they shipped. Exact text: a policy that has moved since
-- is not the one this file was written against, and is refused rather than
-- overwritten.
DO $d14$
DECLARE
  r      record;
  v_qual text;
  v_new  text;
  v_got  text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('official',                'official_read',                '(app_user_id() IS NOT NULL)'),
      ('official_accreditation',  'official_accreditation_read',  '(app_user_id() IS NOT NULL)'),
      ('season',                  'season_read',                  '(app_user_id() IS NOT NULL)'),
      ('sport',                   'sport_read',                   '(app_user_id() IS NOT NULL)'),
      ('feature_flag',            'feature_flag_read',            '(app_user_id() IS NOT NULL)'),
      ('feature_grant',           'feature_grant_read',           '(app_user_id() IS NOT NULL)'),
      ('feature_suppression',     'feature_suppression_read',     '(app_user_id() IS NOT NULL)'),
      ('bowling_directive',       'bowling_directive_read',       '(app_user_id() IS NOT NULL)'),
      ('clearance_requirement',   'clearance_requirement_read',   '(app_user_id() IS NOT NULL)'),
      ('clearance_kind_max_days', 'clearance_kind_max_days_read', '(app_user_id() IS NOT NULL)'),
      ('playing_condition_key',   'playing_condition_key_read',   '(app_user_id() IS NOT NULL)'),
      ('rulebook_clause',         'rulebook_clause_read',         '(app_user_id() IS NOT NULL)'),
      ('rulebook_clause_age',     'rulebook_clause_age_read',     '(app_user_id() IS NOT NULL)'),
      ('sponsor_category',        'sponsor_category_read',        '(app_user_id() IS NOT NULL)'),
      -- db/60's generated block: the platform's key, or anybody signed in.
      ('load_unit',               'load_unit_read',
       '(app_can(''platform.feature.manage''::text, ''00000000-0000-0000-0000-000000000000''::uuid, ''*''::text, ''00000000-0000-0000-0000-000000000000''::uuid, ''00000000-0000-0000-0000-000000000000''::uuid) OR (app_user_id() IS NOT NULL))'),
      -- db/08: the platform's drills to anybody signed in, a school's to its own.
      ('drill',                   'drill_read',
       '(((school_id IS NULL) AND (app_user_id() IS NOT NULL)) OR app_can(''team.read''::text, school_id, ''*''::text, ''00000000-0000-0000-0000-000000000000''::uuid, ''00000000-0000-0000-0000-000000000000''::uuid))')
    ) AS x(tbl, pol, shipped)
  LOOP
    SELECT p.qual INTO v_qual FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = r.tbl AND p.policyname = r.pol
       AND p.cmd = 'SELECT' AND p.permissive = 'PERMISSIVE' AND p.roles = '{public}';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'db/81: %.% is missing, or no longer a permissive SELECT policy for everyone', r.tbl, r.pol;
    END IF;
    v_new := replace(r.shipped, '(app_user_id() IS NOT NULL)', 'app_enrolled()');
    IF v_qual = v_new THEN CONTINUE; END IF;   -- a second run
    IF v_qual IS DISTINCT FROM r.shipped THEN
      RAISE EXCEPTION 'db/81: %.% reads % — not what it shipped as; narrow the version now in place and move its text here',
        r.tbl, r.pol, v_qual;
    END IF;
    EXECUTE format('DROP POLICY %I ON %I', r.pol, r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I AS PERMISSIVE FOR SELECT TO public USING (%s)', r.pol, r.tbl, v_new);
    SELECT p.qual INTO v_got FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = r.tbl AND p.policyname = r.pol;
    IF v_got IS DISTINCT FROM v_new THEN
      RAISE EXCEPTION 'db/81: %.% re-emitted as %, expected %', r.tbl, r.pol, v_got, v_new;
    END IF;
  END LOOP;
END $d14$;


-- ── 2 · The tables ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_identity (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('google.com', 'microsoft.com', 'emailLink')),
  -- Firebase's `sub`: the only key. Never returned to a browser.
  provider_uid    text NOT NULL CHECK (length(provider_uid) BETWEEN 1 AND 128),
  -- The verified email as it was the day it was linked (§3.5: a later change
  -- at Google does not move it, nor app_user.email).
  email_at_link   text NOT NULL CHECK (length(email_at_link) BETWEEN 3 AND 320),
  linked_at       timestamptz NOT NULL DEFAULT now(),
  linked_how      text NOT NULL CHECK (linked_how IN ('new_account', 'office_confirmed', 'code', 'self_added', 'register')),
  -- The office person for office_confirmed; the person for self_added and code.
  linked_by       uuid REFERENCES app_user(id),
  last_sign_in_at timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES app_user(id),
  UNIQUE (provider, provider_uid),
  CONSTRAINT revoked_names_when CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS auth_identity_user_idx ON auth_identity (user_id);

CREATE TABLE IF NOT EXISTS pending_claim (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL CHECK (provider IN ('google.com', 'microsoft.com', 'emailLink')),
  provider_uid      text NOT NULL CHECK (length(provider_uid) BETWEEN 1 AND 128),
  -- The verified email the sign-in presented, which matched the account's.
  email             text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  user_id           uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  last_requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_how      text CHECK (resolved_how IN ('office_confirmed', 'code', 'declined', 'superseded')),
  resolved_by       uuid REFERENCES app_user(id),
  CONSTRAINT resolved_says_how CHECK ((resolved_at IS NULL) = (resolved_how IS NULL))
);
-- One open claim per sign-in: asking again is the same claim, asked again.
CREATE UNIQUE INDEX IF NOT EXISTS pending_claim_one_open ON pending_claim (provider, provider_uid) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS pending_claim_user_idx ON pending_claim (user_id) WHERE resolved_at IS NULL;

-- login_code's shape (db/05), one step further: RLS on, no policy, and no
-- privilege either. db/06's default privileges would otherwise hand the
-- application SELECT, INSERT and UPDATE on both.
ALTER TABLE auth_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_claim ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_identity FROM scrbrd_app;
REVOKE ALL ON pending_claim FROM scrbrd_app;


-- ── 3 · The pupil's consent (§5.3, §7.3) ──────────────────────────
-- Every player this account IS — its roster link (app_user.player_id) and the
-- `self` link of any of its assignments — must be an adult, or carry a live,
-- verified `self` link with the family's consent granted. An account holding
-- a pupil's role and naming no player at all cannot be shown to be either,
-- and is refused the same way. The refusal is one check_violation the doors
-- turn into 'pupil_consent_required'.
CREATE OR REPLACE FUNCTION auth_identity_pupil_consent() RETURNS trigger AS $$
DECLARE
  p     record;
  v_any boolean := false;
BEGIN
  FOR p IN
    SELECT pl.id, pl.born FROM player pl
     WHERE pl.id = (SELECT u.player_id FROM app_user u WHERE u.id = NEW.user_id)
        OR pl.id IN (SELECT g.player_id FROM assignment_subject g
                       JOIN role_assignment a ON a.id = g.assignment_id
                      WHERE a.person_id = NEW.user_id AND g.relationship = 'self')
  LOOP
    v_any := true;
    IF p.born IS NOT NULL AND majority_on(p.born) <= current_date THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM assignment_subject g
                 JOIN role_assignment a ON a.id = g.assignment_id
                WHERE a.person_id = NEW.user_id AND a.active
                  AND g.player_id = p.id AND g.relationship = 'self'
                  AND g.verification_state = 'verified' AND g.consent_state = 'granted'
                  AND g.valid_from <= current_date
                  AND (g.valid_until IS NULL OR g.valid_until > current_date)) THEN
      CONTINUE;
    END IF;
    RAISE EXCEPTION 'pupil_consent_required' USING ERRCODE = 'check_violation';
  END LOOP;
  IF NOT v_any AND EXISTS (SELECT 1 FROM role_assignment a
                            WHERE a.person_id = NEW.user_id AND a.role IN ('player', 'selfaccess')) THEN
    RAISE EXCEPTION 'pupil_consent_required' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION auth_identity_pupil_consent() FROM PUBLIC;

DROP TRIGGER IF EXISTS auth_identity_pupil_consent ON auth_identity;
CREATE TRIGGER auth_identity_pupil_consent BEFORE INSERT ON auth_identity
  FOR EACH ROW EXECUTE FUNCTION auth_identity_pupil_consent();


-- ── 4 · The doors ──────────────────────────────────────────────────
-- Shared shape checks. A provider the table knows; a uid Firebase could
-- issue; an address with an @ and a dot after it.
CREATE OR REPLACE FUNCTION auth_identity_args_ok(p_provider text, p_uid text, p_email text) RETURNS boolean AS $$
  SELECT coalesce(p_provider IN ('google.com', 'microsoft.com', 'emailLink'), false)
     AND coalesce(length(p_uid) BETWEEN 1 AND 128, false)
     AND coalesce(length(p_email) BETWEEN 3 AND 320 AND p_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', false)
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION auth_identity_args_ok(text, text, text) FROM PUBLIC;

-- Does this person hold a live owner's key (any live superadmin assignment)?
-- db/77's test, for the doors that act on somebody else's account.
CREATE OR REPLACE FUNCTION auth_holds_superadmin(p_person uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM role_assignment s
                  WHERE s.person_id = p_person AND s.role = 'superadmin' AND s.active
                    AND (s.valid_from  IS NULL OR s.valid_from  <= current_date)
                    AND (s.valid_until IS NULL OR s.valid_until >  current_date)
                    AND (s.expires_at  IS NULL OR s.expires_at  >  now())
                    AND NOT EXISTS (SELECT 1 FROM duty_suspension d
                                     WHERE d.assignment_id = s.id AND d.lifted_at IS NULL))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION auth_holds_superadmin(uuid) FROM PUBLIC;

-- THE ONE RULE for the office acting on somebody else's account: issuing it a
-- login code (login_code_issue(), re-emitted below), confirming or declining a
-- claim on it, reading or revoking its sign-ins. Each of those lets the office
-- become that person, so the office may do it only for an account whose every
-- authority it could itself grant (Opus's review, 2026-10-02):
--   * user.invite at the account's school (db/05's question, unchanged);
--   * any STANDING platform-wide assignment on the account (school_id NULL —
--     the owner's key, a platform administrator) → only a superadmin, as
--     db/77's platform-only floor: 'superadmin_only';
--   * any standing assignment at a school that the caller could not grant
--     there — app_may_grant_at(role, school), db/77; a pupil's `selfaccess`
--     counts as granted by whoever may grant `player`, because the grant door
--     writes the pair together — → 'not_permitted'. An
--     office does not become the principal, the DSO (the safeguarding
--     separation: the office never reads a concern), medical staff, or a
--     parent of a child at another school.
-- STANDING means active, in its dates and not past its hour; a suspended
-- assignment still counts (a suspension is a pause, and a code is for good),
-- and a guardian's counts whatever state its link is in. Never under a pad's
-- credential. Answers a reason, NULL when permitted.
CREATE OR REPLACE FUNCTION auth_office_refusal(p_user uuid) RETURNS text AS $$
DECLARE v_school uuid;
BEGIN
  IF app_user_id() IS NULL THEN RETURN 'not_signed_in'; END IF;
  IF app_pad_scoped() THEN RETURN 'not_permitted'; END IF;
  SELECT u.school_id INTO v_school FROM app_user u WHERE u.id = p_user;
  IF NOT FOUND OR NOT app_can('user.invite', v_school, '*'::text,
                              '00000000-0000-0000-0000-000000000000'::uuid,
                              '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN 'not_permitted';
  END IF;
  IF EXISTS (SELECT 1 FROM role_assignment a
              WHERE a.person_id = p_user AND a.active AND a.school_id IS NULL
                AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
                AND (a.valid_until IS NULL OR a.valid_until >  current_date)
                AND (a.expires_at  IS NULL OR a.expires_at  >  now()))
     AND NOT auth_holds_superadmin(app_user_id()) THEN
    RETURN 'superadmin_only';
  END IF;
  IF EXISTS (SELECT 1 FROM role_assignment a
              WHERE a.person_id = p_user AND a.active
                AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
                AND (a.valid_until IS NULL OR a.valid_until >  current_date)
                AND (a.expires_at  IS NULL OR a.expires_at  >  now())
                AND NOT (app_may_grant_at(a.role, a.school_id)
                         -- a pupil's own record comes with `player`: the grant
                         -- door writes the pair for whoever may grant player
                         -- there (decide_role_request(), db/08), so whoever
                         -- may enrol a pupil may issue his code
                         OR (a.role = 'selfaccess' AND app_may_grant_at('player', a.school_id)))) THEN
    RETURN 'not_permitted';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION auth_office_refusal(uuid) FROM PUBLIC;

-- login_code_issue() (db/05), re-emitted with the rule above. db/05 asked only
-- user.invite at the account's school, and the raw code goes back to the
-- issuer — so a school office could issue itself a way in as its principal,
-- its DSO, or an owner's key whose account is filed at the school (which the
-- school seam in §5 below would otherwise make reachable). One statement is
-- added after the self-issue refusal; the body is md5-guarded as db/77
-- guards, and a body already carrying it is left alone, so the file runs twice.
DO $issue$
DECLARE
  v_fn   regprocedure := 'login_code_issue(text,text,integer)'::regprocedure;
  v_old  text := '  UPDATE login_code SET used_at = now()';
  v_rule text := '  -- db/81: only an account whose every authority the issuer could grant.' || chr(10)
              || '  IF auth_office_refusal(v_user) IS NOT NULL THEN' || chr(10)
              || '    RETURN QUERY SELECT false, auth_office_refusal(v_user), NULL::uuid, NULL::timestamptz; RETURN;' || chr(10)
              || '  END IF;' || chr(10) || chr(10);
  v_src  text; v_def text; v_cfg text; v_acl text; v_sec boolean;
BEGIN
  SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef
    INTO v_src, v_cfg, v_acl, v_sec FROM pg_proc p WHERE p.oid = v_fn;
  IF position(v_rule IN v_src) > 0 THEN RETURN; END IF;   -- a second run
  IF md5(v_src) IS DISTINCT FROM 'cfcf5bea5911de5ef7d6b879eeef3b92' THEN
    RAISE EXCEPTION 'db/81: login_code_issue() is not db/05''s any more; add the account rule to the version now in place and move its hash';
  END IF;
  IF (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'db/81: login_code_issue() does not spend the previous codes exactly once';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  EXECUTE replace(v_def, v_old, v_rule || v_old);
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM replace(v_src, v_old, v_rule || v_old)
     OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM v_cfg
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM v_acl
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM v_sec THEN
    RAISE EXCEPTION 'db/81: re-emitting login_code_issue() changed more than the account rule';
  END IF;
END $issue$;

-- The record of an office's or a person's act on a sign-in (§6's audit trail).
CREATE OR REPLACE FUNCTION auth_identity_log(p_resource text, p_user uuid) RETURNS void AS $$
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count, device_id)
  SELECT u.school_id, app_user_id(), p_resource, ARRAY[p_user], 1, app_device_id()
    FROM app_user u WHERE u.id = p_user
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION auth_identity_log(text, uuid) FROM PUBLIC;

/**
 * THE EXCHANGE'S ONE QUESTION (§3.3), asked with NO identity: the API has
 * already verified Google's signed statement, and asks who that is here.
 * Answers (outcome, user_id), in the table's order:
 *   signed_in        the uid is linked and live → its account
 *   revoked          the uid is linked and revoked → nothing
 *   account_inactive the uid is linked to a deactivated account → nothing
 *   new_account      the uid is unknown and the email matches no account →
 *                    an account with no school, role 'none' (non-authoritative
 *                    since ADR 0001) and nothing in it, and its identity
 *   linked           the uid is unknown and the email matches an ACTIVE
 *                    account that holds and held NOTHING: no assignment ever,
 *                    no roster link, no other sign-in → linked to it, its
 *                    school (typed by whoever asked) set back to none
 *   claim_required   the uid is unknown and the email matches an account that
 *                    holds or held anything, or is inactive → no account, and
 *                    a pending_claim the office sees. Says nothing about what
 *                    the account holds or whether it is active.
 *   refused          malformed arguments, or called inside a session
 * Never matches on an email alone where there is anything to protect (D3).
 */
CREATE OR REPLACE FUNCTION auth_identity_sign_in(p_provider text, p_uid text, p_email text, p_name text)
RETURNS TABLE (outcome text, user_id uuid) AS $$
DECLARE
  i       auth_identity%ROWTYPE;
  u       record;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text;
  v_user  uuid;
BEGIN
  IF app_user_id() IS NOT NULL OR NOT auth_identity_args_ok(p_provider, p_uid, v_email) THEN
    RETURN QUERY SELECT 'refused'::text, NULL::uuid; RETURN;
  END IF;
  -- One sign-in at a time per uid and per address, so two tabs racing on a
  -- first sign-in make one account, not two (or a unique violation).
  PERFORM pg_advisory_xact_lock(hashtextextended('auth_identity:' || p_provider || ':' || p_uid, 81));
  PERFORM pg_advisory_xact_lock(hashtextextended('auth_email:' || v_email, 81));

  SELECT * INTO i FROM auth_identity x WHERE x.provider = p_provider AND x.provider_uid = p_uid;
  IF FOUND THEN
    IF i.revoked_at IS NOT NULL THEN RETURN QUERY SELECT 'revoked'::text, NULL::uuid; RETURN; END IF;
    IF NOT EXISTS (SELECT 1 FROM app_user a WHERE a.id = i.user_id AND a.active) THEN
      RETURN QUERY SELECT 'account_inactive'::text, NULL::uuid; RETURN;
    END IF;
    UPDATE auth_identity SET last_sign_in_at = now() WHERE id = i.id;
    RETURN QUERY SELECT 'signed_in'::text, i.user_id; RETURN;
  END IF;

  -- app_user.email is UNIQUE as typed; two rows differing only in case are
  -- possible in principle, and the oldest is the one the office meant.
  SELECT a.id, a.active, a.player_id INTO u
    FROM app_user a WHERE lower(a.email) = v_email ORDER BY a.created_at, a.id LIMIT 1;

  IF NOT FOUND THEN
    v_name := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 120);
    IF length(v_name) < 2 THEN v_name := left(split_part(v_email, '@', 1), 120); END IF;
    INSERT INTO app_user (school_id, email, name, role, active)
    VALUES (NULL, v_email, v_name, 'none', true) RETURNING id INTO v_user;
    INSERT INTO auth_identity (user_id, provider, provider_uid, email_at_link, linked_how, last_sign_in_at)
    VALUES (v_user, p_provider, p_uid, v_email, 'new_account', now());
    RETURN QUERY SELECT 'new_account'::text, v_user; RETURN;
  END IF;

  IF u.active AND u.player_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM role_assignment a WHERE a.person_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM auth_identity x WHERE x.user_id = u.id) THEN
    -- Nothing reachable is being claimed: an onboard_request() stub. Its
    -- pending request, if any, now has a verified email behind it. Its school
    -- was whatever the unverified asker typed, and a school on the account
    -- puts it in that school's office's reach (codes, claims): so it goes
    -- back to none, and the first grant sets it (§4.3's seam). The pending
    -- requests stay; the office reads them through role_requester().
    UPDATE app_user SET school_id = NULL WHERE id = u.id;
    INSERT INTO auth_identity (user_id, provider, provider_uid, email_at_link, linked_how, last_sign_in_at)
    VALUES (u.id, p_provider, p_uid, v_email, 'new_account', now());
    RETURN QUERY SELECT 'linked'::text, u.id; RETURN;
  END IF;

  INSERT INTO pending_claim AS c (provider, provider_uid, email, user_id)
  VALUES (p_provider, p_uid, v_email, u.id)
  ON CONFLICT (provider, provider_uid) WHERE resolved_at IS NULL
  DO UPDATE SET last_requested_at = now(), email = EXCLUDED.email, user_id = EXCLUDED.user_id;
  RETURN QUERY SELECT 'claim_required'::text, NULL::uuid;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * A signed-in person adds a way to sign in (§3.4, D11): being signed into
 * both is the proof, never a shared email. A uid already somebody's is
 * refused with no more said. When the office had a claim open for this uid
 * on this account — it issued a code, and the person redeemed it — the link
 * is `code` and the claim is closed; any other open claim for the uid is
 * superseded. Answers (ok, reason, identity_id, linked_how):
 *   not_signed_in · not_permitted (a pad's credential) · bad_arguments ·
 *   account_inactive · identity_in_use · pupil_consent_required ·
 *   already_linked (ok: it was yours already)
 */
CREATE OR REPLACE FUNCTION auth_identity_link_self(p_provider text, p_uid text, p_email text)
RETURNS TABLE (ok boolean, reason text, identity_id uuid, linked_how text) AS $$
DECLARE
  v_me    uuid := app_user_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  i       auth_identity%ROWTYPE;
  v_how   text;
  v_id    uuid;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', NULL::uuid, NULL::text; RETURN; END IF;
  IF app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_permitted', NULL::uuid, NULL::text; RETURN; END IF;
  IF NOT auth_identity_args_ok(p_provider, p_uid, v_email) THEN
    RETURN QUERY SELECT false, 'bad_arguments', NULL::uuid, NULL::text; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('auth_identity:' || p_provider || ':' || p_uid, 81));

  SELECT * INTO i FROM auth_identity x WHERE x.provider = p_provider AND x.provider_uid = p_uid;
  IF FOUND THEN
    IF i.user_id = v_me AND i.revoked_at IS NULL THEN
      RETURN QUERY SELECT true, 'already_linked', i.id, i.linked_how; RETURN;
    END IF;
    RETURN QUERY SELECT false, 'identity_in_use', NULL::uuid, NULL::text; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_user a WHERE a.id = v_me AND a.active) THEN
    RETURN QUERY SELECT false, 'account_inactive', NULL::uuid, NULL::text; RETURN;
  END IF;

  v_how := CASE WHEN EXISTS (SELECT 1 FROM pending_claim c
                              WHERE c.provider = p_provider AND c.provider_uid = p_uid
                                AND c.user_id = v_me AND c.resolved_at IS NULL)
                THEN 'code' ELSE 'self_added' END;
  BEGIN
    INSERT INTO auth_identity (user_id, provider, provider_uid, email_at_link, linked_how, linked_by, last_sign_in_at)
    VALUES (v_me, p_provider, p_uid, v_email, v_how, v_me, now())
    RETURNING id INTO v_id;
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT false, CASE WHEN SQLERRM = 'pupil_consent_required' THEN SQLERRM ELSE 'refused' END,
                        NULL::uuid, NULL::text;
    RETURN;
  END;
  UPDATE pending_claim c
     SET resolved_at = now(), resolved_by = v_me,
         resolved_how = CASE WHEN c.user_id = v_me THEN 'code' ELSE 'superseded' END
   WHERE c.provider = p_provider AND c.provider_uid = p_uid AND c.resolved_at IS NULL;
  RETURN QUERY SELECT true, NULL::text, v_id, v_how;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The person ends one of their own ways to sign in (§3.7). (ok, reason). */
CREATE OR REPLACE FUNCTION auth_identity_revoke_self(p_identity uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE v_me uuid := app_user_id(); n integer;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  IF app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  UPDATE auth_identity SET revoked_at = now(), revoked_by = v_me
   WHERE id = p_identity AND user_id = v_me AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN QUERY SELECT false, 'no_such_sign_in'; RETURN; END IF;
  PERFORM auth_identity_log('auth.identity_revoked', v_me);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The office ends one of an account's ways to sign in (§3.7). (ok, reason). */
CREATE OR REPLACE FUNCTION auth_identity_revoke(p_identity uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE i auth_identity%ROWTYPE; v_why text;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  SELECT * INTO i FROM auth_identity x WHERE x.id = p_identity FOR UPDATE;
  -- Authority first, so a stranger learns nothing about the row.
  v_why := CASE WHEN FOUND THEN auth_office_refusal(i.user_id) ELSE 'no_such_sign_in' END;
  IF v_why IS NOT NULL THEN
    RETURN QUERY SELECT false, CASE WHEN v_why = 'no_such_sign_in' THEN 'not_permitted' ELSE v_why END; RETURN;
  END IF;
  IF i.revoked_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_revoked'; RETURN; END IF;
  UPDATE auth_identity SET revoked_at = now(), revoked_by = app_user_id() WHERE id = i.id;
  PERFORM auth_identity_log('auth.identity_revoked', i.user_id);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The office confirms a claim with one tap (§3.3): the identity is written
 * `office_confirmed`, by this person, and the next Google sign-in is the
 * account's. Nobody confirms a claim on their own account. (ok, reason):
 *   not_signed_in · not_permitted · superadmin_only · no_such_claim ·
 *   already_resolved · cannot_confirm_your_own · identity_in_use ·
 *   pupil_consent_required
 */
CREATE OR REPLACE FUNCTION pending_claim_confirm(p_claim uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE c pending_claim%ROWTYPE; v_me uuid := app_user_id(); v_why text;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  SELECT * INTO c FROM pending_claim x WHERE x.id = p_claim FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  v_why := auth_office_refusal(c.user_id);
  IF v_why IS NOT NULL THEN RETURN QUERY SELECT false, v_why; RETURN; END IF;
  IF c.resolved_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_resolved'; RETURN; END IF;
  IF c.user_id = v_me THEN RETURN QUERY SELECT false, 'cannot_confirm_your_own'; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('auth_identity:' || c.provider || ':' || c.provider_uid, 81));
  IF EXISTS (SELECT 1 FROM auth_identity x WHERE x.provider = c.provider AND x.provider_uid = c.provider_uid) THEN
    UPDATE pending_claim SET resolved_at = now(), resolved_how = 'superseded', resolved_by = v_me WHERE id = c.id;
    RETURN QUERY SELECT false, 'identity_in_use'; RETURN;
  END IF;
  BEGIN
    INSERT INTO auth_identity (user_id, provider, provider_uid, email_at_link, linked_how, linked_by)
    VALUES (c.user_id, c.provider, c.provider_uid, c.email, 'office_confirmed', v_me);
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT false, CASE WHEN SQLERRM = 'pupil_consent_required' THEN SQLERRM ELSE 'refused' END;
    RETURN;
  END;
  UPDATE pending_claim SET resolved_at = now(), resolved_how = 'office_confirmed', resolved_by = v_me WHERE id = c.id;
  PERFORM auth_identity_log('auth.claim_confirmed', c.user_id);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The office declines a claim: the sign-in stays unlinked (§6, a reassigned mailbox). (ok, reason). */
CREATE OR REPLACE FUNCTION pending_claim_decline(p_claim uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE c pending_claim%ROWTYPE; v_why text;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  SELECT * INTO c FROM pending_claim x WHERE x.id = p_claim FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  v_why := auth_office_refusal(c.user_id);
  IF v_why IS NOT NULL THEN RETURN QUERY SELECT false, v_why; RETURN; END IF;
  IF c.resolved_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_resolved'; RETURN; END IF;
  UPDATE pending_claim SET resolved_at = now(), resolved_how = 'declined', resolved_by = app_user_id() WHERE id = c.id;
  PERFORM auth_identity_log('auth.claim_declined', c.user_id);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The office's Claims list: the open claims on accounts the caller may act
 * on (auth_office_refusal() IS NULL). The account as the office enrolled it
 * beside the address Google verified — never the uid.
 */
CREATE OR REPLACE FUNCTION pending_claims()
RETURNS TABLE (id uuid, user_id uuid, account_name text, account_email text, account_active boolean,
               school_id uuid, presented_email text, provider text, requested_at timestamptz,
               last_requested_at timestamptz) AS $$
  SELECT c.id, u.id, u.name, u.email, u.active, u.school_id, c.email, c.provider, c.requested_at, c.last_requested_at
    FROM pending_claim c JOIN app_user u ON u.id = c.user_id
   WHERE c.resolved_at IS NULL AND app_user_id() IS NOT NULL
     AND auth_office_refusal(c.user_id) IS NULL
   ORDER BY c.last_requested_at DESC, c.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The person's own ways to sign in (§3.2), never the uid. */
CREATE OR REPLACE FUNCTION my_sign_ins()
RETURNS TABLE (id uuid, provider text, email_at_link text, linked_at timestamptz, linked_how text,
               last_sign_in_at timestamptz, revoked_at timestamptz) AS $$
  SELECT x.id, x.provider, x.email_at_link, x.linked_at, x.linked_how, x.last_sign_in_at, x.revoked_at
    FROM auth_identity x
   WHERE x.user_id = app_user_id() AND NOT app_pad_scoped()
   ORDER BY x.revoked_at IS NOT NULL, x.linked_at, x.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** One account's ways to sign in, for the office that may revoke them. Never the uid. */
CREATE OR REPLACE FUNCTION account_sign_ins(p_user uuid)
RETURNS TABLE (id uuid, provider text, email_at_link text, linked_at timestamptz, linked_how text,
               last_sign_in_at timestamptz, revoked_at timestamptz) AS $$
  SELECT x.id, x.provider, x.email_at_link, x.linked_at, x.linked_how, x.last_sign_in_at, x.revoked_at
    FROM auth_identity x
   WHERE x.user_id = p_user AND auth_office_refusal(p_user) IS NULL
   ORDER BY x.revoked_at IS NOT NULL, x.linked_at, x.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


/**
 * Who asked, for whoever may read the request (role_request_read's own
 * predicate, db/77): the name and address the requester gave. The office's
 * Requests list joined app_user under the office's RLS, which reads an
 * account only at the office's own school — and an account that signed up
 * with Google has no school until its first grant (§4.3), so its request
 * vanished from the list of the very people who could answer it.
 */
CREATE OR REPLACE FUNCTION role_requester(p_request uuid)
RETURNS TABLE (name text, email text) AS $$
  SELECT u.name, u.email
    FROM role_request r JOIN app_user u ON u.id = r.person_id
   WHERE r.id = p_request AND NOT app_pad_scoped()
     AND (r.person_id = app_user_id()
          OR (app_can('user.role.assign', r.school_id, '*'::text,
                      '00000000-0000-0000-0000-000000000000'::uuid,
                      '00000000-0000-0000-0000-000000000000'::uuid)
              AND app_may_grant_at(r.role, r.school_id)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 5 · decide_role_request(): the account's school, on its first grant ──
-- db/77's body, with one statement before the request is marked granted:
-- an account with no school takes the request's (§4.3). The column is not
-- authority (ADR 0001); it names whose office issues this person a code.
DO $reemit$
DECLARE
  v_fn   regprocedure := 'decide_role_request(uuid,boolean,text,uuid,text)'::regprocedure;
  v_old  text := '  UPDATE role_request SET state = ''granted'',';
  -- Never onto an account holding a platform-wide assignment: filing an
  -- owner's key or a platform administrator under a school would put it in
  -- that school's office's reach (auth_office_refusal() refuses it anyway).
  v_seam text := '  UPDATE app_user SET school_id = r.school_id WHERE id = r.person_id AND school_id IS NULL' || chr(10)
              || '     AND NOT EXISTS (SELECT 1 FROM role_assignment pa WHERE pa.person_id = r.person_id AND pa.active AND pa.school_id IS NULL);' || chr(10);
  v_src  text; v_def text; v_cfg text; v_acl text; v_sec boolean;
BEGIN
  SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef
    INTO v_src, v_cfg, v_acl, v_sec FROM pg_proc p WHERE p.oid = v_fn;
  IF position(v_seam IN v_src) > 0 THEN RETURN; END IF;   -- a second run
  IF md5(v_src) IS DISTINCT FROM 'd0d31069a152db7a56dfdbaff4437813' THEN
    RAISE EXCEPTION 'db/81: decide_role_request() is not db/77''s any more; add the school seam to the version now in place and move its hash';
  END IF;
  IF (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'db/81: decide_role_request() does not mark a request granted exactly once';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  EXECUTE replace(v_def, v_old, v_seam || v_old);
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM replace(v_src, v_old, v_seam || v_old)
     OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM v_cfg
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM v_acl
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM v_sec THEN
    RAISE EXCEPTION 'db/81: re-emitting decide_role_request() changed more than the school seam';
  END IF;
END $reemit$;


-- ── 6 · Grants ─────────────────────────────────────────────────────
DO $grants$
DECLARE
  f text;
  r text;
  v_app text[] := ARRAY[
    'auth_identity_sign_in(text,text,text,text)', 'auth_identity_link_self(text,text,text)',
    'auth_identity_revoke_self(uuid)', 'auth_identity_revoke(uuid)',
    'pending_claim_confirm(uuid)', 'pending_claim_decline(uuid)', 'pending_claims()',
    'my_sign_ins()', 'account_sign_ins(uuid)', 'role_requester(uuid)'];
  v_internal text[] := ARRAY[
    'auth_identity_pupil_consent()', 'auth_identity_args_ok(text,text,text)', 'auth_holds_superadmin(uuid)',
    'auth_office_refusal(uuid)', 'auth_identity_log(text,uuid)'];
BEGIN
  FOREACH f IN ARRAY v_app LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f::regprocedure);
  END LOOP;
  FOREACH f IN ARRAY v_internal LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
  END LOOP;
  -- A managed host's API roles (Supabase grants new objects to them).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY v_app || v_internal || ARRAY['app_enrolled()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f::regprocedure, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON auth_identity FROM %I', r);
      EXECUTE format('REVOKE ALL ON pending_claim FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── 7 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §60 and walked through the API by
-- tools/smoke-signup.mjs.
DO $check$
DECLARE f text; t text;
BEGIN
  -- D14: no read policy anywhere still opens on "signed in" alone.
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO f FROM pg_policies
   WHERE schemaname = 'public' AND coalesce(qual, '') ~ 'app_user_id\(\) IS NOT NULL';
  IF f IS NOT NULL THEN RAISE EXCEPTION 'db/81: a policy still opens on any signed-in account: %', f; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND qual ~ 'app_enrolled\(\)') <> 16 THEN
    RAISE EXCEPTION 'db/81: expected sixteen policies to read app_enrolled()';
  END IF;
  -- The two tables: under RLS, no policy, no privilege for the application.
  FOREACH t IN ARRAY ARRAY['auth_identity', 'pending_claim'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      RAISE EXCEPTION 'db/81: % is not under row-level security', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION 'db/81: % has a policy; every read and write is a function', t;
    END IF;
    IF has_table_privilege('scrbrd_app', t, 'SELECT') OR has_table_privilege('scrbrd_app', t, 'INSERT')
       OR has_table_privilege('scrbrd_app', t, 'UPDATE') OR has_table_privilege('scrbrd_app', t, 'DELETE') THEN
      RAISE EXCEPTION 'db/81: the application holds a privilege on %', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'auth_identity'::regclass
                    AND tgname = 'auth_identity_pupil_consent' AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'db/81: the pupil-consent trigger is missing or disabled';
  END IF;
  IF position('IF auth_office_refusal(v_user) IS NOT NULL THEN' IN
              (SELECT prosrc FROM pg_proc WHERE oid = 'login_code_issue(text,text,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/81: login_code_issue() does not ask whether the issuer could grant the account''s every role';
  END IF;
  IF position('pa.school_id IS NULL' IN
              (SELECT prosrc FROM pg_proc WHERE oid = 'decide_role_request(uuid,boolean,text,uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/81: the school seam would file a platform-wide account under a school';
  END IF;
  IF position('UPDATE app_user SET school_id = r.school_id' IN
              (SELECT prosrc FROM pg_proc WHERE oid = 'decide_role_request(uuid,boolean,text,uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/81: decide_role_request() does not give a school-less account its school';
  END IF;
  FOREACH f IN ARRAY ARRAY['app_enrolled()', 'auth_identity_sign_in(text,text,text,text)', 'auth_identity_link_self(text,text,text)',
                           'auth_identity_revoke_self(uuid)', 'auth_identity_revoke(uuid)', 'pending_claim_confirm(uuid)',
                           'pending_claim_decline(uuid)', 'pending_claims()', 'my_sign_ins()', 'account_sign_ins(uuid)',
                           'role_requester(uuid)', 'auth_identity_pupil_consent()', 'auth_identity_args_ok(text,text,text)', 'auth_holds_superadmin(uuid)',
                           'auth_office_refusal(uuid)', 'auth_identity_log(text,uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/81: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/81: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  -- Nothing the browser can reach returns a provider uid.
  FOREACH f IN ARRAY ARRAY['pending_claims()', 'my_sign_ins()', 'account_sign_ins(uuid)'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proargnames, '{}')) a
                WHERE p.oid = f::regprocedure AND a ~ 'uid') THEN
      RAISE EXCEPTION 'db/81: % returns a provider uid', f;
    END IF;
  END LOOP;
END $check$;

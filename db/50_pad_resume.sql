-- ══════════════════════════════════════════════════════════════════
--  50 · The pad's resume credential (SCRBRD-078 option B, SCRBRD-087)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. SCRBRD-078's "Open — the session" is the decision (Kameel,
-- 2026-09-26: option B); docs/AUTH_SPEC.md "The pad's resume credential" is
-- the protocol; services/api/auth/pad-resume.mjs verifies it. None of this is
-- in packages/policy/src/tables.mjs or the generator: the generator would
-- emit into db/01 and db/09, which are frozen. Its policies are here, like
-- db/41's and db/47's.
--
-- THE PROBLEM. The API token lives in memory (apps/web/src/lib/api.js says
-- why) and lasts thirty minutes (auth.mjs TOKEN.ttlSec), and a production
-- sign-in is a one-time code from the school office. A scorer who reloads the
-- pad, or whose match runs past half an hour, cannot keep sending balls
-- without a new code mid-match.
--
-- THE CREDENTIAL. Issued when a device successfully claims a match, bound to
-- (person, device, match), and good for exactly:
--   * the heartbeat and the re-claim of that match, while the token is still
--     this device's (tryAttach's rules: state active, this person, this
--     device) — pad_resume_reclaim();
--   * appending that match's events;
--   * reading that match's own event log and its toss.
-- Good for nothing else: no pupil, no medical record, no other match, no
-- other route. It is held with proof of possession: the device makes a
-- non-extractable ECDSA P-256 key pair (WebCrypto) and keeps the private key
-- as a CryptoKey in IndexedDB; every request is signed over its method, path,
-- body, a timestamp and a one-time id (jti). This table stores the PUBLIC key
-- and its RFC 7638 thumbprint, and a hash of the credential id — never the id,
-- never anything that can sign. A copied credential is useless off the device.
--
-- IT ENDS at the end of the match day (midnight, Africa/Johannesburg, of the
-- day it was issued), and before that when:
--   * the match completes (or is abandoned)   — trigger on match.status
--   * the token moves: a handover, a claim by  — trigger on scoring_session
--     another device, a force-release
--   * the device signs out                    — pad_resume_sign_out()
--   * the school office revokes it            — pad_resume_revoke()
-- and it is never renewed by itself: a new one is issued only to a device
-- that has just claimed the match with an ordinary signed-in token. There is
-- no refresh of the general token here, and nothing a credential can do mints
-- another.
--
-- ─── THE PRINCIPAL, AND HOW IT IS NARROWED ───────────────────────────
--
-- A request signed with a credential runs as the person, on the device, with
-- two more transaction-local settings: app.scope = 'pad' and app.match_id.
-- The existing policies already admit that person to their match's log
-- (ball_event_read and match_toss_read on fixture.read, session_read,
-- ball_event_insert on scoring.edit + the token + the epoch + the lease) —
-- because the person may score it. Nothing here grants anything. Everything
-- here NARROWS, at two layers:
--
--   1. app_can(), app_holds(), app_may_grant() — db/35's three, verbatim, each
--      with one guard. Under pad scope app_can() is true only for
--      fixture.read and scoring.edit, and only when the fixture asked about
--      is the credential's match; app_holds() and app_may_grant() are false.
--      Every policy and every SECURITY DEFINER function that asks the
--      decision function is narrowed by this, whatever table it is on. Not
--      scoring.start: the only claim a credential makes is through
--      pad_resume_reclaim(), which checks the token is still this device's
--      and asks scoring_claim() under the person's own authority for that one
--      call. So a credential cannot claim a handover, verify one, take a
--      match another device holds, or record a toss — the database refuses
--      each at app_can(), not only the API.
--
--   2. pad_scope_<cmd> — a RESTRICTIVE policy on every table behind row-level
--      security, one per command a permissive policy there admits (db/41's
--      trip_driver_own_only is the precedent). Under pad scope it is false,
--      except: ball_event and ball_event_quarantine read and take inserts
--      for the credential's match; scoring_session and match_toss are read
--      for it. This is what closes the policies that never ask app_can() —
--      a person's own rows (request_replay, notifications, device tokens,
--      role requests) and the catalogue reads — and the fixture.read tables
--      of the credential's own match that are not its log (the squad, the
--      availability, the officials, the weather). pad_scope_guard_install()
--      writes them; a table added after this file needs its own call, and
--      db/99 §28 fails until it has one.
--
-- scoring_arm_handover() (db/02) asks scoring.edit, so layer 1 does not stop
-- it; it is recreated here, verbatim, with a first line that refuses a
-- credential. Every other SECURITY DEFINER function that asks fixture.read or
-- scoring.edit over a match was listed (db/99 §28 lists them again, so a new
-- one is seen): scoring_lease_check (the heartbeat — allowed), scoring_claim
-- (reached only through pad_resume_reclaim), duty_status and duty_suspended
-- (who is on duty at the match and whether suspended — adults, no pupil), and
-- trip_fixture_driver_only (a boolean). Functions that ask only WHO the caller
-- is, and nothing of what they may do, are not narrowed by this file; the
-- credential reaches none of them, because the API refuses it on every route
-- but five (services/api/auth/pad-resume.mjs PAD_ROUTES, and the walk in
-- tools/smoke-pad-resume.mjs that sends a signed request to every route).
--
-- ─── THREAT MODEL ────────────────────────────────────────────────────
--
-- The only long-lived credential in the system, and it writes match data about
-- minors. What it is worth to whoever holds it: scoring ONE match from ONE
-- device, which that scorer could already do, until midnight at the latest.
--
--   Theft from IndexedDB (a backup, a forensic copy, malware reading the
--     profile). The store holds the credential id and a CryptoKey whose
--     private half the browser will not export. The id alone signs nothing:
--     every request needs a signature by that key, verified here against the
--     public key. A copy of the database row is a public key and two hashes.
--   XSS on the page. Injected script runs as the page, so while the page is
--     open it can USE the key — sign requests the server will accept — though
--     it cannot take the key away. That is the honest limit of a
--     non-extractable key, and it is bounded: the requests it can sign are the
--     five routes above, for one match, until the credential ends; every
--     event is still judged by the Laws and written with this device's
--     provenance; and script on the page can already do all of that with the
--     in-memory API token today, plus everything else that token reaches. The
--     credential adds no reach an XSS did not have; it lengthens it from
--     thirty minutes to the end of the day for this one match.
--   Replay. A proof names one method, one path, the hash of one body, a time
--     and a jti. The server refuses a jti it has seen for this credential
--     (pad_resume_jti, kept ten minutes) and a time more than two minutes from
--     its own clock, so a captured request is good once, within its window,
--     for exactly what it said.
--   A lost phone. Unlocked, it keeps scoring its match — the owner's decision
--     (Kameel, 2026-09-26) — until midnight, the token moving, the match
--     ending, or the office revoking it (pad_resume_revoke, user.invite at the
--     match's school). Locked, the browser's storage is the OS's to protect.
--   A revoked scorer. The credential carries no authority of its own: every
--     request runs as the person, and app_can() reads their assignments on
--     every statement. An assignment revoked or a duty suspended (db/35)
--     refuses the next heartbeat and the next ball, credential or not.
--   Clock skew. A phone's clock may be wrong. The window is two minutes
--     either way; a request outside it is refused as pad_stale with the
--     server's time, and the client corrects its offset from that and signs
--     again. Nothing is accepted on the phone's word about the time.
--
-- ─── CAPABILITIES, AND WHY THESE ─────────────────────────────────────
--
--   Issuing needs no capability of its own: pad_resume_issue() requires the
--   caller, signed in with an ordinary token, to HOLD the match's token on
--   this device right now (state active, this person, this device, a live
--   lease) and to hold scoring.edit over it. A credential is never more than
--   a continuation of a claim somebody already made.
--
--   The office revokes under user.invite at the match's school
--   (directorofsport, schooladmin, superadmin). The credential is a sign-in
--   in all but name: it is what lets a phone go on without the one-time code
--   the office hands out, and user.invite is the capability that hands out
--   those codes (login_code_issue(), db/05). Whoever may let a person sign in
--   is whoever may stop a phone from staying signed in. Not scoring.correct:
--   that is operational recovery at the ground, held by `scorer` — a scorer
--   could then end a colleague's phone mid-over — and not held by the school
--   office at all, which is who a lost phone is reported to. Force-release
--   (scoring.correct) still ends a credential, as the token moving always
--   does; revoking without moving the token is strictly less than that.
--
--   The credential table is readable by the same people, so the office can
--   see which phones hold one; the replay table by nobody.
--
-- search_path is pinned on every SECURITY DEFINER function below (db/16).


-- ── 0 · The principal's two settings ───────────────────────────────
-- Set by auth.mjs sessionConfigStatements(), transaction-local, only for a
-- request signed with a resume credential. Never NULL: a session with no
-- scope is an ordinary one.
CREATE OR REPLACE FUNCTION app_pad_scoped() RETURNS boolean AS $$
  SELECT coalesce(current_setting('app.scope', true), '') = 'pad'
$$ LANGUAGE sql STABLE;

-- The credential's match, or NULL outside pad scope. A pad scope with no
-- match reaches nothing: every comparison with NULL fails closed.
CREATE OR REPLACE FUNCTION app_pad_match() RETURNS uuid AS $$
  SELECT CASE WHEN app_pad_scoped() THEN nullif(current_setting('app.match_id', true), '')::uuid END
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION app_pad_scoped() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_pad_match() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_pad_scoped() TO scrbrd_app;
GRANT EXECUTE ON FUNCTION app_pad_match() TO scrbrd_app;


-- ── 1 · The decision functions, narrowed (db/35 + one guard each) ──
-- Snapshot what runs now, so the check at the foot can prove each is db/35's
-- body with exactly the guard added and nothing else moved.
CREATE TEMP TABLE _db50_before AS
  SELECT p.oid::regprocedure::text AS sig, p.prosrc, p.proacl::text AS acl,
         pg_get_function_result(p.oid) AS result
    FROM pg_proc p
   WHERE p.oid IN ('app_can(text,uuid,text,uuid,uuid)'::regprocedure,
                   'app_holds(text)'::regprocedure,
                   'app_may_grant(text)'::regprocedure,
                   'scoring_arm_handover(uuid,text,integer,boolean,uuid)'::regprocedure);

-- db/35's app_can(), verbatim — its header there is the argument for every
-- line — with the pad guard in front: under pad scope, fixture.read and
-- scoring.edit, on the credential's fixture, and nothing else. coalesce, so a
-- pad scope with no match, or a question with no fixture, is false and never
-- NULL (IF NOT NULL does not refuse: db/41 found that the hard way).
-- Grants exactly as db/35 left them.
CREATE OR REPLACE FUNCTION app_can(
  p_capability text,
  p_school     uuid DEFAULT NULL,
  p_team       text DEFAULT NULL,
  p_person     uuid DEFAULT NULL,
  p_fixture    uuid DEFAULT NULL
) RETURNS boolean AS $$
  SELECT coalesce(NOT app_pad_scoped()
                  OR (p_capability IN ('fixture.read', 'scoring.edit') AND p_fixture = app_pad_match()), false)
     AND EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc
        ON rc.role = a.role
       AND rc.capability = p_capability
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       -- institution. There is no ANY_SCOPE for school: every governed row
       -- belongs to a tenant, and one that does not state its tenant is one
       -- nobody should reach.
       AND (a.school_id IS NULL OR (p_school IS NOT NULL AND a.school_id = p_school))
       -- team
       AND (a.team_code IS NULL OR p_team = '*'::text
            OR (p_team IS NOT NULL AND a.team_code = p_team))
       -- single fixture (scorers, match officials)
       AND (a.fixture_id IS NULL OR p_fixture = '00000000-0000-0000-0000-000000000000'::uuid
            OR (p_fixture IS NOT NULL AND a.fixture_id = p_fixture))
       -- WHO the assignment is about. An assignment naming people reaches ONLY
       -- those people: a guardian's children, and a pupil's own record. An
       -- assignment naming nobody is about nobody in particular and is scoped
       -- by school and team alone, which is how a coach reaches their squad —
       -- EXCEPT for the roles that only make sense about a person, which are
       -- refused outright rather than widened (SUBJECT_SCOPED_ROLES).
       --
       -- A LIVE link is verified, started and not ended. Verification is what
       -- turns a claimed relationship into a permission, and 'pending' is the
       -- column default, so nothing reaches a child until somebody at the
       -- school put their name to the link.
       AND CASE WHEN a.role = ANY (ARRAY['guardian', 'selfaccess', 'enquiry']::text[]) THEN
             -- A role that only means anything ABOUT SOMEBODY. It must name a
             -- live person, and then reaches that person and rows with no
             -- person dimension (a fixture: which is how a parent sees when
             -- their child is playing). Name nobody live and it reaches
             -- nothing at all — not the school, not a fixture.
             EXISTS (SELECT 1 FROM assignment_subject g
                      WHERE g.assignment_id = a.id
                        AND g.verification_state = 'verified'
                        AND g.valid_from <= current_date
                        AND (g.valid_until IS NULL OR g.valid_until > current_date))
             AND (p_person = '00000000-0000-0000-0000-000000000000'::uuid
                  OR (p_person IS NOT NULL AND EXISTS (
                        SELECT 1 FROM assignment_subject g
                         WHERE g.assignment_id = a.id AND g.player_id = p_person
                           AND g.verification_state = 'verified'
                           AND g.valid_from <= current_date
                           AND (g.valid_until IS NULL OR g.valid_until > current_date))))
           ELSE
             -- Everyone else. Naming nobody means "about nobody in
             -- particular", scoped by school and team, which is how a coach
             -- reaches their squad. The NOT EXISTS counts EVERY row, live or
             -- not: filtering it to live links would mean that revoking the
             -- last link turns a person-scoped assignment into a school-wide
             -- one, so revocation would WIDEN access.
             NOT EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id)
             OR p_person = '00000000-0000-0000-0000-000000000000'::uuid
             OR (p_person IS NOT NULL AND EXISTS (
                   SELECT 1 FROM assignment_subject g
                    WHERE g.assignment_id = a.id AND g.player_id = p_person
                      AND g.verification_state = 'verified'
                      AND g.valid_from <= current_date
                      AND (g.valid_until IS NULL OR g.valid_until > current_date)))
           END
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION app_can(text, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can(text, uuid, text, uuid, uuid) TO PUBLIC;

-- db/35's app_holds() and app_may_grant(), verbatim, false under pad scope:
-- a credential holds nothing platform-wide and grants nothing.
CREATE OR REPLACE FUNCTION app_holds(p_capability text) RETURNS boolean AS $$
  SELECT NOT app_pad_scoped() AND EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc
        ON rc.role = a.role
       AND rc.capability = p_capability
      JOIN capability c
        ON c.name = rc.capability
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (NOT c.platform_only OR a.school_id IS NULL)
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION app_holds(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_holds(text) TO PUBLIC;

CREATE OR REPLACE FUNCTION app_may_grant(p_role text) RETURNS boolean AS $$
  SELECT NOT app_pad_scoped() AND EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_grantable g ON g.granter = a.role AND g.role = p_role
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       -- A role carrying a platform capability may only be handed out by
       -- somebody whose own assignment belongs to no school.
       AND (a.school_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM role_capability rc
                JOIN capability c ON c.name = rc.capability AND c.platform_only
               WHERE rc.role = p_role))
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION app_may_grant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_may_grant(text) TO PUBLIC;


-- ── 2 · A credential never arms a handover (db/02 + one guard) ─────
-- scoring.edit is what arming asks, and a credential has scoring.edit over
-- its match. Arming hands the match to whoever enters the code, which is a
-- decision for a person signed in, not for a phone that reloaded.
CREATE OR REPLACE FUNCTION scoring_arm_handover(
  p_match uuid, p_device text, p_pending int, p_ball_in_flight boolean, p_to uuid DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text, code text) AS $$
DECLARE s scoring_session%ROWTYPE; v_code text;
BEGIN
  IF app_pad_scoped() THEN RETURN QUERY SELECT false,'no_capability',NULL::text; RETURN; END IF;
  -- Holding the token is not the same as still being allowed to score. An
  -- assignment revoked mid-match takes effect on the next statement — that is
  -- the property the SECURITY DEFINER lookup was chosen for — and without this
  -- check a scorer whose access had just been withdrawn could still pass the
  -- token to someone of their choosing. Capability first, then the token.
  IF NOT app_can('scoring.edit', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::text; RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF s.holder_device IS DISTINCT FROM p_device OR s.holder_user_id <> app_user_id()
    THEN RETURN QUERY SELECT false,'not_token_holder',NULL::text; RETURN; END IF;
  IF p_pending > 0        THEN RETURN QUERY SELECT false,'unsynced_work',NULL::text; RETURN; END IF;
  IF p_ball_in_flight     THEN RETURN QUERY SELECT false,'ball_in_flight',NULL::text; RETURN; END IF;
  v_code := lpad((abs(hashtext(p_match::text || ':' || s.epoch)) % 1000000)::text, 6, '0');
  UPDATE scoring_session SET state='handover_pending', handover_code=v_code,
    handover_to=p_to, handover_armed_at=now(), updated_at=now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, to_user, epoch)
  VALUES (p_match, match_school(p_match), 'handover_armed', app_user_id(), s.holder_user_id, p_to, s.epoch);
  RETURN QUERY SELECT true, NULL::text, v_code;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · The credential ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pad_resume_credential (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- HMAC-SHA256 of the credential id under the server's secret
  -- (pad-resume.mjs padIdHash), hex. The id itself is never stored: a copy of
  -- this table cannot name a credential, let alone use one.
  id_hash        text NOT NULL UNIQUE CHECK (id_hash ~ '^[0-9a-f]{64}$'),
  user_id        uuid NOT NULL REFERENCES app_user(id),
  device_id      text NOT NULL CHECK (btrim(device_id) <> '' AND length(device_id) <= 200),
  match_id       uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  -- Derived from the match (match_school), never stated by the caller.
  school_id      uuid NOT NULL REFERENCES school(id),
  -- The device's PUBLIC key, and nothing else: exactly kty, crv, x and y.
  -- pad_resume_issue() refuses a key with a private part, or any other shape.
  public_jwk     jsonb NOT NULL,
  -- RFC 7638 thumbprint of public_jwk, computed here (pad_jwk_thumbprint).
  jkt            text NOT NULL CHECK (jkt ~ '^[A-Za-z0-9_-]{43}$'),
  issued_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  revoked_reason text CHECK (revoked_reason IN
                   ('reissued', 'token_moved', 'released', 'match_complete', 'match_abandoned',
                    'signed_out', 'office')),
  revoked_by     uuid REFERENCES app_user(id),
  CONSTRAINT pad_resume_revocation_is_whole CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT pad_resume_expires_after_issue CHECK (expires_at > issued_at)
);
-- One live credential per person, device and match: a new claim's credential
-- ends the old one first ('reissued').
CREATE UNIQUE INDEX IF NOT EXISTS pad_resume_one_live
  ON pad_resume_credential (user_id, device_id, match_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS pad_resume_by_match
  ON pad_resume_credential (match_id) WHERE revoked_at IS NULL;

ALTER TABLE pad_resume_credential ENABLE ROW LEVEL SECURITY;
-- No INSERT, UPDATE or DELETE policy, and no privilege either: every write is
-- one of the functions below. Two layers, as db/47 does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pad_resume_credential FROM scrbrd_app;

-- Read: the office that may revoke it (user.invite at the match's school).
DROP POLICY IF EXISTS pad_resume_credential_read ON pad_resume_credential;
CREATE POLICY pad_resume_credential_read ON pad_resume_credential
  FOR SELECT USING (
    app_can('user.invite', pad_resume_credential.school_id, match_team(pad_resume_credential.match_id),
            '00000000-0000-0000-0000-000000000000'::uuid, pad_resume_credential.match_id));

-- The one-time ids a credential has signed with. Read and written only by
-- pad_resume_spend(); no policy, no privilege.
CREATE TABLE IF NOT EXISTS pad_resume_jti (
  credential_id uuid NOT NULL REFERENCES pad_resume_credential(id) ON DELETE CASCADE,
  jti           text NOT NULL CHECK (jti ~ '^[A-Za-z0-9_-]{16,64}$'),
  seen_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (credential_id, jti)
);
ALTER TABLE pad_resume_jti ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pad_resume_jti FROM scrbrd_app;


-- ── 4 · Helpers ────────────────────────────────────────────────────
/**
 * RFC 7638: the SHA-256 of the key's required members, in lexical order, no
 * whitespace, base64url. Computed here, so the stored thumbprint is the key's
 * and not whatever the caller said it was.
 */
CREATE OR REPLACE FUNCTION pad_jwk_thumbprint(p_jwk jsonb) RETURNS text AS $$
  SELECT translate(rtrim(encode(sha256(convert_to(
           format('{"crv":"%s","kty":"%s","x":"%s","y":"%s"}',
                  p_jwk->>'crv', p_jwk->>'kty', p_jwk->>'x', p_jwk->>'y'), 'UTF8')), 'base64'), '='), '+/', '-_')
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

/** Exactly an EC P-256 public key: four members, and no private part. */
CREATE OR REPLACE FUNCTION pad_jwk_is_public_p256(p_jwk jsonb) RETURNS boolean AS $$
  SELECT coalesce(jsonb_typeof(p_jwk) = 'object'
     AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_jwk) k) = ARRAY['crv', 'kty', 'x', 'y']
     AND p_jwk->>'kty' = 'EC' AND p_jwk->>'crv' = 'P-256'
     AND p_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$' AND p_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$', false)
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

/** Midnight at the end of today, Africa/Johannesburg: when a credential issued now ends. */
CREATE OR REPLACE FUNCTION pad_resume_day_end() RETURNS timestamptz AS $$
  SELECT (date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') + interval '1 day')
         AT TIME ZONE 'Africa/Johannesburg'
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

/** Why a credential no longer works, or NULL while it does. */
CREATE OR REPLACE FUNCTION pad_resume_ended(c pad_resume_credential) RETURNS text AS $$
  SELECT CASE
           WHEN c.revoked_at IS NOT NULL THEN c.revoked_reason
           WHEN c.expires_at <= now() THEN 'expired'
           WHEN m.status = 'complete' THEN 'match_complete'
           WHEN m.status = 'abandoned' THEN 'match_abandoned'
         END
    FROM match m WHERE m.id = c.match_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 5 · Issue: on a claim, with an ordinary token ──────────────────
/**
 * Issue a credential to the device that holds this match's token right now.
 *
 * Called by POST /api/matches/:id/session/pad-credential, under the caller's
 * ordinary (bearer) identity, just after a successful claim. The raw id is
 * minted by the API and returned to the device once; only its hash arrives
 * here. The public key is checked for shape here and for being a point on
 * the curve by the API (node:crypto createPublicKey) before this is called.
 */
CREATE OR REPLACE FUNCTION pad_resume_issue(p_match uuid, p_id_hash text, p_jwk jsonb)
RETURNS TABLE (ok boolean, reason text, credential uuid, expires_at timestamptz) AS $$
DECLARE
  s scoring_session%ROWTYPE;
  v_id  uuid;
  v_exp timestamptz := pad_resume_day_end();
BEGIN
  -- Never from a credential: nothing a credential can do mints another.
  IF app_pad_scoped() OR app_user_id() IS NULL OR app_device_id() IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF NOT app_can('scoring.edit', match_school(p_match), match_team(p_match), NULL, p_match) THEN
    RETURN QUERY SELECT false, 'no_capability', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status IN ('complete', 'abandoned')) THEN
    RETURN QUERY SELECT false, 'match_complete', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  -- The claim is what it continues: this person, this device, the token, now.
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF NOT FOUND OR s.state <> 'active' OR s.holder_user_id IS DISTINCT FROM app_user_id()
     OR s.holder_device IS DISTINCT FROM app_device_id() OR s.lease_until <= now() THEN
    RETURN QUERY SELECT false, 'not_token_holder', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF p_id_hash IS NULL OR p_id_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT false, 'bad_credential', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF NOT pad_jwk_is_public_p256(p_jwk) THEN
    RETURN QUERY SELECT false, 'bad_key', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;

  UPDATE pad_resume_credential c SET revoked_at = now(), revoked_reason = 'reissued'
   WHERE c.user_id = app_user_id() AND c.device_id = app_device_id() AND c.match_id = p_match
     AND c.revoked_at IS NULL;
  INSERT INTO pad_resume_credential (id_hash, user_id, device_id, match_id, school_id, public_jwk, jkt, expires_at)
  VALUES (p_id_hash, app_user_id(), app_device_id(), p_match, match_school(p_match),
          p_jwk, pad_jwk_thumbprint(p_jwk), v_exp)
  RETURNING id INTO v_id;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, epoch, detail)
  VALUES (p_match, match_school(p_match), 'pad_resume_issued', app_user_id(), s.epoch,
          jsonb_build_object('credential', v_id, 'device', app_device_id(), 'expires_at', v_exp));
  RETURN QUERY SELECT true, NULL::text, v_id, v_exp;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 6 · Use: look up, then spend a jti (no identity yet) ───────────
/**
 * The credential a signed request names, by the hash of its id. Runs with no
 * identity, like login_code_redeem(): it is how the identity is established.
 * Returns the row whether or not it still works (`ended` says why not), so
 * the API can verify the signature first and only then say which.
 */
CREATE OR REPLACE FUNCTION pad_resume_lookup(p_id_hash text)
RETURNS TABLE (credential uuid, user_id uuid, device_id text, match_id uuid,
               public_jwk jsonb, expires_at timestamptz, ended text) AS $$
  SELECT c.id, c.user_id, c.device_id, c.match_id, c.public_jwk, c.expires_at, pad_resume_ended(c)
    FROM pad_resume_credential c
   WHERE c.id_hash = p_id_hash
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Spend a one-time id, after the API has verified the request's signature.
 * Refuses a credential that has ended since it was looked up, and a jti this
 * credential has already signed with. Commits on its own, before the
 * request's transaction opens, so a request that fails cannot be replayed
 * either. A jti is kept ten minutes: the API accepts a proof only within two
 * minutes of its own clock, so an older one is refused as stale anyway.
 */
CREATE OR REPLACE FUNCTION pad_resume_spend(p_credential uuid, p_jti text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE c pad_resume_credential%ROWTYPE; v_end text;
BEGIN
  SELECT * INTO c FROM pad_resume_credential WHERE id = p_credential FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'unknown'; RETURN; END IF;
  v_end := pad_resume_ended(c);
  IF v_end IS NOT NULL THEN RETURN QUERY SELECT false, v_end; RETURN; END IF;
  IF p_jti IS NULL OR p_jti !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN QUERY SELECT false, 'bad_jti'; RETURN;
  END IF;
  DELETE FROM pad_resume_jti j WHERE j.credential_id = c.id AND j.seen_at < now() - interval '10 minutes';
  INSERT INTO pad_resume_jti (credential_id, jti) VALUES (c.id, p_jti) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'replay'; RETURN; END IF;
  UPDATE pad_resume_credential SET last_used_at = now() WHERE id = c.id;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 7 · The one claim a credential makes ───────────────────────────
/**
 * Take this device's own token back: a lapsed lease after a reload or a long
 * lull, which packages/sync's gate and tryAttach claim again (SCRBRD-078).
 *
 * Only under pad scope, only for the credential's match, and only while the
 * token is still this device's — state active, this person, this device —
 * which is the rule tryAttach and the flush gate apply on the client, here
 * enforced where the client cannot skip it. Then scoring_claim() decides, as
 * it decides every claim, under the PERSON's own authority: the pad scope is
 * lifted for that one call (scoring.start is not a capability a credential
 * has, see the header) and put back before anything else runs.
 */
CREATE OR REPLACE FUNCTION pad_resume_reclaim(p_match uuid)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s scoring_session%ROWTYPE; v_device text := app_device_id();
BEGIN
  IF NOT app_pad_scoped() OR app_pad_match() IS DISTINCT FROM p_match THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::int; RETURN;
  END IF;
  IF NOT app_can('scoring.edit', match_school(p_match), match_team(p_match), NULL, p_match) THEN
    RETURN QUERY SELECT false, 'no_capability', NULL::int; RETURN;
  END IF;
  SELECT * INTO s FROM scoring_session x WHERE x.match_id = p_match FOR UPDATE;
  IF NOT FOUND OR s.state <> 'active' OR s.holder_user_id IS DISTINCT FROM app_user_id()
     OR s.holder_device IS DISTINCT FROM v_device THEN
    RETURN QUERY SELECT false, 'token_moved', s.epoch; RETURN;
  END IF;
  PERFORM set_config('app.scope', '', true);
  RETURN QUERY SELECT c.ok, c.reason, c.epoch FROM scoring_claim(p_match, v_device) c;
  PERFORM set_config('app.scope', 'pad', true);
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 8 · Revocation ─────────────────────────────────────────────────
/** The device signs out: every live credential of this person on this device. */
CREATE OR REPLACE FUNCTION pad_resume_sign_out() RETURNS integer AS $$
DECLARE n integer := 0; r record;
BEGIN
  IF app_pad_scoped() OR app_user_id() IS NULL OR app_device_id() IS NULL THEN RETURN 0; END IF;
  FOR r IN
    UPDATE pad_resume_credential c SET revoked_at = now(), revoked_reason = 'signed_out', revoked_by = app_user_id()
     WHERE c.user_id = app_user_id() AND c.device_id = app_device_id() AND c.revoked_at IS NULL
    RETURNING c.id, c.match_id, c.school_id
  LOOP
    n := n + 1;
    INSERT INTO scoring_audit (match_id, school_id, event, actor_id, detail)
    VALUES (r.match_id, r.school_id, 'pad_resume_revoked', app_user_id(),
            jsonb_build_object('reason', 'signed_out', 'credential', r.id));
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The school office ends the credentials on a match: every one, or one
 * person's. user.invite at the match's school — see the header for why.
 */
CREATE OR REPLACE FUNCTION pad_resume_revoke(p_match uuid, p_user uuid DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text, revoked integer) AS $$
DECLARE n integer;
BEGIN
  IF app_pad_scoped()
     OR NOT app_can('user.invite', match_school(p_match), match_team(p_match),
                    '00000000-0000-0000-0000-000000000000'::uuid, p_match) THEN
    RETURN QUERY SELECT false, 'not_permitted', 0; RETURN;
  END IF;
  UPDATE pad_resume_credential c SET revoked_at = now(), revoked_reason = 'office', revoked_by = app_user_id()
   WHERE c.match_id = p_match AND c.revoked_at IS NULL AND (p_user IS NULL OR c.user_id = p_user);
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, to_user, detail)
  VALUES (p_match, match_school(p_match), 'pad_resume_revoked', app_user_id(), p_user,
          jsonb_build_object('reason', 'office', 'count', n));
  RETURN QUERY SELECT true, NULL::text, n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The token moves: a credential outlives no change of holder. Fires on every
 * transition the state machine makes — a completed handover, a claim by
 * another device, a force-release (state idle), a session removed — and on
 * none that keeps the holder: a heartbeat, the device's own re-claim, a
 * handover armed or cancelled by the device that holds it.
 */
CREATE OR REPLACE FUNCTION pad_resume_follow_token() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE pad_resume_credential c SET revoked_at = now(), revoked_reason = 'released'
     WHERE c.match_id = OLD.match_id AND c.revoked_at IS NULL;
    RETURN OLD;
  END IF;
  UPDATE pad_resume_credential c
     SET revoked_at = now(), revoked_reason = CASE WHEN NEW.state = 'idle' THEN 'released' ELSE 'token_moved' END
   WHERE c.match_id = NEW.match_id AND c.revoked_at IS NULL
     AND (NEW.state = 'idle'
          OR c.user_id IS DISTINCT FROM NEW.holder_user_id
          OR c.device_id IS DISTINCT FROM NEW.holder_device);
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS pad_resume_follows_token ON scoring_session;
CREATE TRIGGER pad_resume_follows_token
  AFTER UPDATE ON scoring_session FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state
        OR OLD.holder_user_id IS DISTINCT FROM NEW.holder_user_id
        OR OLD.holder_device IS DISTINCT FROM NEW.holder_device)
  EXECUTE FUNCTION pad_resume_follow_token();
DROP TRIGGER IF EXISTS pad_resume_follows_token_away ON scoring_session;
CREATE TRIGGER pad_resume_follows_token_away
  AFTER DELETE ON scoring_session FOR EACH ROW
  EXECUTE FUNCTION pad_resume_follow_token();

/** The match ends: completion (db/33 ends scoring for everyone) or abandonment. */
CREATE OR REPLACE FUNCTION pad_resume_end_with_match() RETURNS trigger AS $$
BEGIN
  UPDATE pad_resume_credential c
     SET revoked_at = now(), revoked_reason = CASE WHEN NEW.status = 'complete' THEN 'match_complete' ELSE 'match_abandoned' END
   WHERE c.match_id = NEW.id AND c.revoked_at IS NULL;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS pad_resume_ends_with_match ON match;
CREATE TRIGGER pad_resume_ends_with_match
  AFTER UPDATE OF status ON match FOR EACH ROW
  WHEN (NEW.status IN ('complete', 'abandoned') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION pad_resume_end_with_match();


-- ── 9 · Who may call these: the application, and nobody else ──────
-- scrbrd_app only, never PUBLIC; the trigger functions and the guard
-- installer by nobody (a trigger runs its function whatever the privilege,
-- and only the owner creates a policy). db/47's reasoning for a managed
-- host's API roles applies unchanged: they get EXECUTE on every new function
-- in public by default privilege, so they are taken back here.
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
      'pad_jwk_thumbprint(jsonb)', 'pad_jwk_is_public_p256(jsonb)', 'pad_resume_day_end()',
      'pad_resume_ended(pad_resume_credential)',
      'pad_resume_issue(uuid,text,jsonb)', 'pad_resume_lookup(text)', 'pad_resume_spend(uuid,text)',
      'pad_resume_reclaim(uuid)', 'pad_resume_sign_out()', 'pad_resume_revoke(uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['pad_resume_follow_token()', 'pad_resume_end_with_match()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $grants$;


-- ── 10 · The restrictive guard, on every table behind RLS ──────────
/**
 * Give one table its pad_scope_<cmd> policies: for each command a PERMISSIVE
 * policy there admits, a RESTRICTIVE one that is false under pad scope —
 * except the credential's own match's rows on the four scoring tables it
 * reads (and the two it writes). A command nothing admits needs no guard, so
 * a table with no write policy gains none, and one with no policy at all
 * (login_code) gains nothing. Owner only; a migration that adds a table
 * behind RLS calls it for that table.
 */
CREATE OR REPLACE FUNCTION pad_scope_guard_install(p_table regclass) RETURNS integer AS $$
DECLARE
  v_rel   text := (SELECT c.relname FROM pg_class c WHERE c.oid = p_table);
  v_cmd   text;
  v_code  "char";
  v_name  text;
  v_expr  text;
  n       integer := 0;
BEGIN
  FOREACH v_cmd IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    v_name := 'pad_scope_' || lower(v_cmd);
    v_code := CASE v_cmd WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w' ELSE 'd' END;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = p_table AND p.polname = v_name) THEN
      EXECUTE format('DROP POLICY %I ON %s', v_name, p_table);
    END IF;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_policy p
                               WHERE p.polrelid = p_table AND p.polpermissive AND p.polcmd IN ('*', v_code));
    v_expr := CASE
      WHEN v_cmd = 'SELECT' AND v_rel IN ('ball_event', 'ball_event_quarantine', 'scoring_session', 'match_toss')
        THEN 'coalesce(NOT app_pad_scoped() OR match_id = app_pad_match(), false)'
      WHEN v_cmd = 'INSERT' AND v_rel IN ('ball_event', 'ball_event_quarantine')
        THEN 'coalesce(NOT app_pad_scoped() OR match_id = app_pad_match(), false)'
      ELSE 'NOT app_pad_scoped()'
    END;
    EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR %s %s', v_name, p_table, v_cmd,
                   CASE v_cmd WHEN 'INSERT' THEN format('WITH CHECK (%s)', v_expr)
                              WHEN 'UPDATE' THEN format('USING (%s) WITH CHECK (%s)', v_expr, v_expr)
                              ELSE format('USING (%s)', v_expr) END);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pad_scope_guard_install(regclass) FROM PUBLIC;

SELECT count(pad_scope_guard_install(c.oid))
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
 WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity;

DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY[
          'app_pad_scoped()', 'app_pad_match()',
          'pad_jwk_thumbprint(jsonb)', 'pad_jwk_is_public_p256(jsonb)', 'pad_resume_day_end()',
          'pad_resume_ended(pad_resume_credential)',
          'pad_resume_issue(uuid,text,jsonb)', 'pad_resume_lookup(text)', 'pad_resume_spend(uuid,text)',
          'pad_resume_reclaim(uuid)', 'pad_resume_sign_out()', 'pad_resume_revoke(uuid,uuid)',
          'pad_resume_follow_token()', 'pad_resume_end_with_match()',
          'pad_scope_guard_install(regclass)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON pad_resume_credential, pad_resume_jti FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f      text;
  t      text;
  snap   record;
  v_src  text;
  n      integer;
  -- The guards, exactly as written above. Each replaced function must be its
  -- snapshot with this text added and nothing else changed.
  G_CAN  text := E'coalesce(NOT app_pad_scoped()\n                  OR (p_capability IN (''fixture.read'', ''scoring.edit'') AND p_fixture = app_pad_match()), false)\n     AND ';
  G_HOLD text := E'NOT app_pad_scoped() AND ';
  G_ARM  text := E'\n  IF app_pad_scoped() THEN RETURN QUERY SELECT false,''no_capability'',NULL::text; RETURN; END IF;';
BEGIN
  -- (1) db/35's three and db/02's arm, each with exactly its guard added.
  SELECT count(*) INTO n FROM _db50_before;
  IF n <> 4 THEN RAISE EXCEPTION 'db/50: expected to snapshot 4 functions, found %', n; END IF;
  FOR snap IN SELECT * FROM _db50_before LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = snap.sig::regprocedure;
    IF snap.sig LIKE 'app_can(%' THEN
      IF position(G_CAN IN v_src) = 0 OR replace(v_src, G_CAN, '') IS DISTINCT FROM snap.prosrc THEN
        RAISE EXCEPTION 'db/50: app_can() is not db/35''s body plus the pad guard';
      END IF;
    ELSIF snap.sig LIKE 'scoring_arm_handover(%' THEN
      IF position(G_ARM IN v_src) = 0 OR replace(v_src, G_ARM, '') IS DISTINCT FROM snap.prosrc THEN
        RAISE EXCEPTION 'db/50: scoring_arm_handover() is not db/02''s body plus the pad guard';
      END IF;
    ELSE
      IF position(G_HOLD IN v_src) = 0 OR replace(v_src, G_HOLD, '') IS DISTINCT FROM snap.prosrc THEN
        RAISE EXCEPTION 'db/50: % is not db/35''s body plus the pad guard', snap.sig;
      END IF;
    END IF;
    IF (SELECT proacl::text FROM pg_proc WHERE oid = snap.sig::regprocedure) IS DISTINCT FROM snap.acl
       OR pg_get_function_result(snap.sig::regprocedure) IS DISTINCT FROM snap.result THEN
      RAISE EXCEPTION 'db/50: % changed its grants or its shape', snap.sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = snap.sig::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/50: % is not SECURITY DEFINER with a pinned search_path', snap.sig;
    END IF;
  END LOOP;

  -- (2) Every definer here pins its search path, and only the application
  --     (and the owner) may call it: not PUBLIC, not a managed host's roles.
  FOREACH f IN ARRAY ARRAY[
      'pad_resume_ended(pad_resume_credential)',
      'pad_resume_issue(uuid,text,jsonb)', 'pad_resume_lookup(text)', 'pad_resume_spend(uuid,text)',
      'pad_resume_reclaim(uuid)', 'pad_resume_sign_out()', 'pad_resume_revoke(uuid,uuid)',
      'pad_resume_follow_token()', 'pad_resume_end_with_match()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/50: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
      'app_pad_scoped()', 'app_pad_match()',
      'pad_jwk_thumbprint(jsonb)', 'pad_jwk_is_public_p256(jsonb)', 'pad_resume_day_end()',
      'pad_resume_ended(pad_resume_credential)',
      'pad_resume_issue(uuid,text,jsonb)', 'pad_resume_lookup(text)', 'pad_resume_spend(uuid,text)',
      'pad_resume_reclaim(uuid)', 'pad_resume_sign_out()', 'pad_resume_revoke(uuid,uuid)',
      'pad_resume_follow_token()', 'pad_resume_end_with_match()', 'pad_scope_guard_install(regclass)'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/50: % is executable by PUBLIC', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(r.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/50: % is executable by a managed host''s API role', f;
    END IF;
  END LOOP;
  IF has_function_privilege('scrbrd_app', 'pad_scope_guard_install(regclass)', 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'pad_resume_follow_token()', 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'pad_resume_end_with_match()', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/50: the application role may call a trigger function or the guard installer';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'pad_resume_lookup(text)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'app_pad_scoped()', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/50: the application role cannot call what the API calls';
  END IF;

  -- (3) The two tables: behind RLS, written by nobody but the functions; the
  --     credential read by one policy, the replay table by none.
  FOREACH t IN ARRAY ARRAY['pad_resume_credential', 'pad_resume_jti'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      RAISE EXCEPTION 'db/50: % is not behind row-level security', t;
    END IF;
    IF has_table_privilege('scrbrd_app', t, 'INSERT') OR has_table_privilege('scrbrd_app', t, 'UPDATE')
       OR has_table_privilege('scrbrd_app', t, 'DELETE') THEN
      RAISE EXCEPTION 'db/50: the application role may write % directly', t;
    END IF;
  END LOOP;
  IF has_table_privilege('scrbrd_app', 'pad_resume_jti', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'pad_resume_jti'::regclass) THEN
    RAISE EXCEPTION 'db/50: pad_resume_jti is readable';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'pad_resume_credential'::regclass AND polpermissive) <> 1
     OR (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
          WHERE polrelid = 'pad_resume_credential'::regclass AND polname = 'pad_resume_credential_read')
        NOT LIKE '%user.invite%' THEN
    RAISE EXCEPTION 'db/50: pad_resume_credential should have exactly one permissive policy, a read under user.invite';
  END IF;

  -- (4) Every table behind RLS carries a restrictive guard for every command
  --     a permissive policy admits, and the scoring tables' carve-outs are
  --     the credential's match and nothing wider.
  SELECT count(*), string_agg(format('%s.%s', c.relname, x.cmd), ', ') INTO n, v_src
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    CROSS JOIN (VALUES ('r', 'select'), ('a', 'insert'), ('w', 'update'), ('d', 'delete')) AS x(code, cmd)
   WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
     AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive
                    AND p.polcmd IN ('*', x.code::"char"))
     AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND NOT p.polpermissive
                        AND p.polname = 'pad_scope_' || x.cmd AND p.polcmd = x.code::"char");
  IF n > 0 THEN RAISE EXCEPTION 'db/50: % command(s) have no pad guard: %', n, v_src; END IF;
  SELECT count(*) INTO n FROM pg_policy p
   WHERE p.polname LIKE 'pad_scope_%' AND NOT p.polpermissive
     AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%app_pad_match()%';
  IF n <> 6 THEN
    RAISE EXCEPTION 'db/50: % guards carve out the credential''s match, expected 6 (four reads, two inserts)', n;
  END IF;

  -- (5) The narrowing itself, as a credential on a match that does not exist:
  --     nothing but its two capabilities, on its one fixture.
  PERFORM set_config('app.scope', 'pad', true);
  PERFORM set_config('app.match_id', '00000000-0000-0000-0000-00000000c0de', true);
  IF app_holds('platform.feature.manage') OR app_may_grant('scorer')
     OR app_pad_match() IS DISTINCT FROM '00000000-0000-0000-0000-00000000c0de'::uuid THEN
    RAISE EXCEPTION 'db/50: the pad scope does not narrow app_holds()/app_may_grant()';
  END IF;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.match_id', '', true);
  IF app_pad_scoped() OR app_pad_match() IS NOT NULL THEN
    RAISE EXCEPTION 'db/50: an ordinary session reads as pad scope';
  END IF;

  -- (6) The thumbprint is RFC 7638's: its own worked example (section 3.1) is
  --     RSA, so this is the P-256 key of RFC 7517 appendix A.1 and the value
  --     node:crypto and WebCrypto both compute for it.
  IF pad_jwk_thumbprint('{"kty":"EC","crv":"P-256","x":"MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4","y":"4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM"}')
       IS DISTINCT FROM 'cn-I_WNMClehiVp51i_0VpOENW1upEerA8sEam5hn-s' THEN
    RAISE EXCEPTION 'db/50: pad_jwk_thumbprint() is not RFC 7638''s: %',
      pad_jwk_thumbprint('{"kty":"EC","crv":"P-256","x":"MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4","y":"4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM"}');
  END IF;
  IF pad_jwk_is_public_p256('{"kty":"EC","crv":"P-256","x":"MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4","y":"4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM","d":"870MB6gfuTJ4HtUnUvYMyJpr5eUZNP4Bk43bVdj3eAE"}')
     OR NOT pad_jwk_is_public_p256('{"kty":"EC","crv":"P-256","x":"MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4","y":"4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM"}')
     OR pad_jwk_is_public_p256('{"kty":"EC","crv":"P-384","x":"MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4","y":"4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM"}')
     OR pad_jwk_is_public_p256(NULL) THEN
    RAISE EXCEPTION 'db/50: pad_jwk_is_public_p256() accepts a private key, another curve or nothing';
  END IF;

  -- (7) The day ends at a Johannesburg midnight, within the next 24 hours.
  IF pad_resume_day_end() <= now() OR pad_resume_day_end() > now() + interval '24 hours'
     OR (pad_resume_day_end() AT TIME ZONE 'Africa/Johannesburg')::time <> '00:00' THEN
    RAISE EXCEPTION 'db/50: pad_resume_day_end() is not the next midnight in Johannesburg: %', pad_resume_day_end();
  END IF;

  -- (8) The triggers are where they say, on the events they say.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'scoring_session'::regclass AND tgname = 'pad_resume_follows_token' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'scoring_session'::regclass AND tgname = 'pad_resume_follows_token_away' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'match'::regclass AND tgname = 'pad_resume_ends_with_match' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/50: a revocation trigger is missing or disabled';
  END IF;
END $check$;

DROP TABLE _db50_before;

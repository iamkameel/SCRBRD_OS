-- ══════════════════════════════════════════════════════════════════
--  30 · A duty's lifecycle, derived; an hour hand always has a reason
--       (SCRBRD-034, step 1 — no authority changes here)
-- ══════════════════════════════════════════════════════════════════
--
-- §16 gives a duty a lifecycle — pending / active / delegated / completed /
-- suspended / expired / revoked — distinct from the role_assignment that
-- carries the authority: "a person may remain historically recorded as the
-- scorer for a completed fixture while no longer retaining active scoring
-- permission". The duty record is match_official (db/08); nothing links it
-- to role_assignment yet, and this file does NOT build that link or change
-- what anybody may do. It does two things.
--
-- 1. duty_status(match_official.id) — READ-ONLY. Every state is DERIVED from
--    a fact the schema already records, the way a batting average is; a
--    status column would be one more thing that keeps claiming to be current
--    after it has stopped being true. Checked against the real columns:
--
--      revoked    match_official.withdrawn           (standing down is an UPDATE)
--      completed  match.status = 'complete'
--      expired    match.status = 'abandoned'         (the fixture ended unplayed)
--      delegated  a SCORER duty naming an account (person_id) that appears as
--                 from_user on a 'handover_complete' row in scoring_audit for
--                 this match — the only event that records the pen changing
--                 hands, written by scoring_verify_takeover (db/02) — and that
--                 is not the scoring_session holder now
--      active     match.status = 'live'
--      pending    match.status = 'scheduled'
--
--    In that order. withdrawn wins over everything: an appointment taken back
--    is taken back whatever became of the fixture. A finished fixture is
--    'completed' for a scorer who handed over mid-match too — delegated is a
--    state of a fixture still in play, and the historical fact is in
--    scoring_audit for anyone who needs it. delegated is checked on a
--    scheduled fixture as well as a live one, because scoring does not wait
--    for match.status to be moved (the walks score 'scheduled' fixtures) and
--    a handover that happened is a stronger fact than a status nobody set.
--
--    'suspended' is NOT produced here. Suspension does not exist yet; it is
--    SCRBRD-034's other half and brings its own fact to derive it from.
--
--    SECURITY DEFINER, because delegated reads scoring_audit, which is
--    audit.read only, and an invoker function would answer 'active' to a
--    coach and 'delegated' to the director of sport about the same person.
--    It is NOT an oracle: it answers only to a caller who may read the
--    appointment itself (fixture.read over the match — the predicate of
--    match_official_read, db/09) and NULL to anyone else, and the one bit it
--    adds — this scorer passed the pen on — is what that same reader already
--    sees in match_duties' scoring row (session_read is fixture.read too).
--
-- 2. AN HOUR HAND ALWAYS CARRIES A REASON. role_assignment.expires_at is the
--    support session's hour hand (db/22: "NULL for every ordinary
--    appointment"), and support_access_begin() refuses to issue one without a
--    ten-character reason. But role_assignment_write (db/01) lets anyone
--    holding user.role.assign, for a role they may grant, INSERT a row with
--    expires_at set directly — time-boxed access with no reason and no
--    support_access record, invisible to the school's support log. And
--    role_assignment_revoke lets them UPDATE the hour hand of a live support
--    session forward, past what the reason was given for.
--
--    A deferred constraint trigger closes both: at COMMIT, every
--    role_assignment with a non-null expires_at must be named by a
--    support_access row (whose reason is NOT NULL and CHECKed, db/22) that
--    issued at least that hour. DEFERRED because support_access_begin()
--    inserts the assignment first and the support_access row second, in one
--    transaction — an immediate check would refuse the only legitimate path.
--    Winding an hour hand BACK (support_access_end() does not, the verifier's
--    _expire_support() and tools/smoke-support.mjs do) stays within what was
--    issued and passes. The support_access side is watched too, so deleting
--    or re-pointing the record cannot strand an hour hand without one.
--
--    Nothing here validates rows written before it: a constraint trigger
--    never does, and db/22 is the only writer of expires_at in this repo.
--
-- WHAT DOES NOT CHANGE. No capability, bundle, policy or decision function
-- moves; app_can() reads expires_at exactly as db/23 has it. db/01, db/09
-- and db/23 are untouched, so generate-rls.mjs output is identical.

-- ── 1. duty_status ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION duty_status(p_official uuid) RETURNS text AS $$
DECLARE
  o  match_official%ROWTYPE;
  m  match%ROWTYPE;
BEGIN
  SELECT * INTO o FROM match_official WHERE id = p_official;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO m FROM match WHERE id = o.match_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- The same question match_official_read asks, so this answers exactly the
  -- readers who can already see the appointment.
  IF NOT app_can('fixture.read', m.school_id, m.team_code,
                 '00000000-0000-0000-0000-000000000000'::uuid, m.id) THEN
    RETURN NULL;
  END IF;

  IF o.withdrawn                 THEN RETURN 'revoked';   END IF;
  IF m.status = 'complete'       THEN RETURN 'completed'; END IF;
  IF m.status = 'abandoned'      THEN RETURN 'expired';   END IF;

  IF o.duty = 'scorer' AND o.person_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM scoring_audit a
                  WHERE a.match_id = o.match_id
                    AND a.event = 'handover_complete'
                    AND a.from_user = o.person_id)
     AND NOT EXISTS (SELECT 1 FROM scoring_session s
                      WHERE s.match_id = o.match_id
                        AND s.state <> 'idle'
                        AND s.holder_user_id = o.person_id) THEN
    RETURN 'delegated';
  END IF;

  IF m.status = 'live'           THEN RETURN 'active';    END IF;
  RETURN 'pending';              -- 'scheduled', the only value left (db/00's CHECK)
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION duty_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION duty_status(uuid) TO scrbrd_app;

-- ── 2. An hour hand is backed by a support session ──────────────
-- Re-reads the row as it stands at COMMIT rather than trusting NEW: a
-- deferred trigger fires once per event, and the row may have moved since.
CREATE OR REPLACE FUNCTION role_assignment_expiry_backed(p_assignment uuid) RETURNS void AS $$
DECLARE
  v_expires timestamptz;
BEGIN
  SELECT a.expires_at INTO v_expires FROM role_assignment a WHERE a.id = p_assignment;
  IF v_expires IS NULL THEN RETURN; END IF;     -- gone, or an ordinary appointment
  IF NOT EXISTS (SELECT 1 FROM support_access s
                  WHERE s.assignment_id = p_assignment
                    AND length(btrim(s.reason)) >= 10
                    AND v_expires <= s.expires_at) THEN
    RAISE EXCEPTION 'role_assignment % has an expiry with no support session behind it', p_assignment
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'role_assignment_expiry_has_reason',
            HINT = 'Time-boxed access is issued by support_access_begin(), which records why. '
                   'An ordinary appointment has no expires_at; end it by withdrawing it.';
  END IF;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION role_assignment_expiry_backed(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION role_assignment_expiry_check() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'role_assignment' THEN
    PERFORM role_assignment_expiry_backed(NEW.id);
  ELSE
    -- support_access: the assignment it USED to back must still be backed.
    PERFORM role_assignment_expiry_backed(OLD.assignment_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION role_assignment_expiry_check() FROM PUBLIC;

DROP TRIGGER IF EXISTS role_assignment_expiry_has_reason ON role_assignment;
CREATE CONSTRAINT TRIGGER role_assignment_expiry_has_reason
  AFTER INSERT OR UPDATE OF expires_at ON role_assignment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.expires_at IS NOT NULL)
  EXECUTE FUNCTION role_assignment_expiry_check();

DROP TRIGGER IF EXISTS role_assignment_expiry_has_reason ON support_access;
CREATE CONSTRAINT TRIGGER role_assignment_expiry_has_reason
  AFTER DELETE OR UPDATE OF assignment_id, expires_at ON support_access
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION role_assignment_expiry_check();

-- ── Assertion ──────────────────────────────────────────────────────
-- What this file promised, checked in the same paste. The behaviour — each
-- status from its fact, a direct time-boxed grant refused at commit, the
-- support path still issuing — is asserted live in db/99 against the seed.
DO $check$
DECLARE
  f   oid := to_regprocedure('duty_status(uuid)');
  g   oid := to_regprocedure('role_assignment_expiry_backed(uuid)');
  src text;
  st  text;
BEGIN
  IF f IS NULL THEN RAISE EXCEPTION 'db/30: duty_status(uuid) is missing'; END IF;
  IF pg_get_function_result(f) IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'db/30: duty_status returns %, not text', pg_get_function_result(f);
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = f) <> 's' THEN
    RAISE EXCEPTION 'db/30: duty_status is not STABLE — it must not write';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/30: the application role cannot call duty_status';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = f;
  FOREACH st IN ARRAY ARRAY['pending','active','delegated','completed','expired','revoked'] LOOP
    IF src NOT LIKE '%''' || st || '''%' THEN
      RAISE EXCEPTION 'db/30: duty_status never answers %', st;
    END IF;
  END LOOP;
  IF src LIKE '%''suspended''%' THEN
    RAISE EXCEPTION 'db/30: duty_status answers suspended, which has no fact behind it yet';
  END IF;
  IF src NOT LIKE '%fixture.read%' THEN
    RAISE EXCEPTION 'db/30: duty_status answers without asking whether the caller may see the fixture';
  END IF;

  IF g IS NULL THEN RAISE EXCEPTION 'db/30: role_assignment_expiry_backed(uuid) is missing'; END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgname = 'role_assignment_expiry_has_reason'
         AND t.tgrelid IN ('role_assignment'::regclass, 'support_access'::regclass)
         AND t.tgconstraint <> 0 AND t.tgdeferrable AND t.tginitdeferred) <> 2 THEN
    RAISE EXCEPTION 'db/30: the expiry-needs-a-reason check is not a deferred constraint trigger on both tables';
  END IF;
  -- No DEFINER here without its pin (db/16's rule, which db/99 also counts).
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid IN (f, g, to_regprocedure('role_assignment_expiry_check()'))
                AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
                                 WHERE c = 'search_path=pg_catalog, public, pg_temp')) THEN
    RAISE EXCEPTION 'db/30: a function in this file does not pin its search_path';
  END IF;
END $check$;

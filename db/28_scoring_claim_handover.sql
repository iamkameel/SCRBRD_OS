-- ══════════════════════════════════════════════════════════════════
--  28 · A plain claim cannot jump a handover (SCRBRD-059)
-- ══════════════════════════════════════════════════════════════════
--
-- scoring_claim(p_match, p_device) is the claim the scoring screen makes on
-- ordinary mount. As db/17 left it, it refused two things: a colleague's live
-- lease while ACTIVE, and a VERIFYING session whose lease was still live. It
-- did not look at HANDOVER_PENDING at all. So while a handover was armed, any
-- device with scoring.start that simply opened the scorer took the token
-- outright — epoch bumped, code wiped, the verification handshake skipped.
-- SCRBRD-056 put a client-side pre-check in front of it (handover.js,
-- sync.js); that narrows the window for the app used the ordinary way and
-- does nothing about a direct API call or a race between the read and the
-- claim. This moves the guarantee to where it belongs.
--
-- WHAT CHANGES
-- ────────────
-- 1. HANDOVER_PENDING refuses a plain claim with reason 'handover_pending' —
--    EXCEPT from the device and user that armed it. That one call is the
--    client's "cancel handover" (apps/web/src/lib/handover.js: there is no
--    cancel route; a plain claim from the arming device takes the token back
--    and clears the code). Refusing it would strand an outgoing scorer who
--    changed their mind. Both device AND user must match, the same pair
--    scoring_arm_handover() checks before it will arm.
--
-- 2. VERIFYING refuses a plain claim with reason 'verifying', from anyone,
--    the outgoing device included — no longer only while the lease is live.
--    The lease gate db/17 used does not hold up: leases are refreshed only
--    while ACTIVE (scoring_lease_check), so once a handover is armed the
--    outgoing lease runs down from the last ball, and ninety seconds later a
--    plain claim went straight past an incoming scorer who was still reading
--    the scoreboard. A stalled verification is recovered the way the spec and
--    tools/smoke-handover-crash.mjs already recover it: once the lease has
--    lapsed, someone holding scoring.correct force-releases, then anyone
--    claims the idle match.
--
-- 3. The reason names the state. db/17 answered 'verification_pending'; the
--    client already reports this situation as sync.reason 'verifying' (its
--    own pre-check returns the state it read), and a separate reason from
--    'lease_active' matters because the remedy differs: enter the code, or
--    wait for the incoming scorer — not wait out a lease.
--
-- WHAT DOES NOT CHANGE
-- ────────────────────
-- The signature, the return shape (ok, reason, epoch), the ACTIVE/lease
-- refusal, the IDLE and lapsed-ACTIVE claims, the same-device re-claim, the
-- audit row. No capability or role bundle moves, so nothing in
-- services/api/rls/generate-rls.mjs changes.
--
-- SECURITY DEFINER carries its own search_path: CREATE OR REPLACE discards
-- the pin db/16 set with ALTER FUNCTION, and db/99 counts the ones that lack
-- it.

CREATE OR REPLACE FUNCTION scoring_claim(p_match uuid, p_device text)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  IF p_device IS NULL OR btrim(p_device) = ''
    THEN RETURN QUERY SELECT false,'no_device',NULL::int; RETURN; END IF;
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::int; RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO scoring_session (match_id, school_id, state, epoch, holder_user_id, holder_device, lease_until)
    VALUES (p_match, match_school(p_match), 'active', 1, app_user_id(), p_device, now() + interval '90 seconds');
    INSERT INTO scoring_audit (match_id, school_id, event, actor_id, epoch)
    VALUES (p_match, match_school(p_match), 'claim', app_user_id(), 1);
    RETURN QUERY SELECT true, NULL::text, 1; RETURN;
  END IF;
  -- Someone else holds a live lease → refuse (use force_release instead).
  IF s.state = 'active' AND s.lease_until > now() AND s.holder_device IS DISTINCT FROM p_device THEN
    RETURN QUERY SELECT false,'lease_active', s.epoch; RETURN;
  END IF;
  -- A handover is armed → the incoming scorer enters the code; nobody else
  -- claims past it. The arming device and user may take it back: that is the
  -- client's cancel. IS DISTINCT FROM, so a NULL on either side refuses.
  IF s.state = 'handover_pending'
     AND (s.holder_device IS DISTINCT FROM p_device OR s.holder_user_id IS DISTINCT FROM app_user_id()) THEN
    RETURN QUERY SELECT false,'handover_pending', s.epoch; RETURN;
  END IF;
  -- A handover is mid-verification → nobody claims past it, the outgoing
  -- device included, lease or no lease. Force-release once the lease lapses.
  IF s.state = 'verifying' THEN
    RETURN QUERY SELECT false,'verifying', s.epoch; RETURN;
  END IF;
  UPDATE scoring_session SET
    state='active', epoch = s.epoch + 1, holder_user_id = app_user_id(),
    holder_device = p_device, lease_until = now() + interval '90 seconds',
    handover_code = NULL, handover_to = NULL, claimant_user_id = NULL,
    claimant_device = NULL, updated_at = now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, epoch)
  VALUES (p_match, match_school(p_match), 'claim', app_user_id(), s.epoch + 1);
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── Assertion ──────────────────────────────────────────────────────
-- What this file promised, checked in the same paste. A DO block raises, so
-- the transaction the operator wrapped this in rolls back rather than leaving
-- half of it applied. The behaviour itself — each state refused, the cancel
-- still working — is asserted live in db/99, against the seed.
DO $check$
DECLARE
  f   oid := to_regprocedure('scoring_claim(uuid,text)');
  src text;
BEGIN
  IF f IS NULL THEN
    RAISE EXCEPTION 'db/28: scoring_claim(uuid, text) is missing';
  END IF;
  IF pg_get_function_result(f) IS DISTINCT FROM 'TABLE(ok boolean, reason text, epoch integer)' THEN
    RAISE EXCEPTION 'db/28: scoring_claim returns %, not the shape the API reads', pg_get_function_result(f);
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'db/28: scoring_claim is no longer SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
                  WHERE p.oid = f AND c = 'search_path=pg_catalog, public, pg_temp') THEN
    RAISE EXCEPTION 'db/28: scoring_claim does not pin its search_path';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/28: the application role cannot call scoring_claim';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = f;
  IF src NOT LIKE '%''handover_pending'', s.epoch%' OR src NOT LIKE '%''verifying'', s.epoch%' THEN
    RAISE EXCEPTION 'db/28: scoring_claim does not refuse a pending or verifying handover by name';
  END IF;
  IF src NOT LIKE '%''lease_active'', s.epoch%' THEN
    RAISE EXCEPTION 'db/28: scoring_claim lost the live-lease refusal';
  END IF;
  IF src LIKE '%verification_pending%' THEN
    RAISE EXCEPTION 'db/28: scoring_claim still answers db/17''s verification_pending';
  END IF;
END $check$;

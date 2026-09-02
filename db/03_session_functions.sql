-- ════════════════════════════════════════════════════════════════
--  SCRBRD — scoring_claim_handover
--  Completes the DB token state machine. Apply after schema_scoring.sql.
--
--  Moves the session HANDOVER_PENDING → VERIFYING when the incoming scorer
--  supplies the correct code. Scoring stays LOCKED until scoring_verify_takeover
--  confirms the on-field state. Mirrors MatchSession.claimHandover() in
--  scoring-session.mjs (proven in the handover suite).
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION scoring_claim_handover(
  p_match uuid, p_device text, p_code text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  IF NOT can_score(app_role()) THEN
    RETURN QUERY SELECT false, 'no_capability'; RETURN;
  END IF;

  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF s.state <> 'handover_pending' THEN
    RETURN QUERY SELECT false, 'not_pending'; RETURN;
  END IF;
  IF s.handover_code IS DISTINCT FROM p_code THEN
    RETURN QUERY SELECT false, 'verify_mismatch'; RETURN;   -- wrong code
  END IF;
  -- Optional pre-authorisation: if handover_to was set, only that user may claim.
  IF s.handover_to IS NOT NULL AND s.handover_to <> app_user_id() THEN
    RETURN QUERY SELECT false, 'no_capability'; RETURN;
  END IF;

  UPDATE scoring_session
     SET state = 'verifying',
         claimant_user_id = app_user_id(),
         claimant_device  = p_device,
         updated_at = now()
   WHERE match_id = p_match;

  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, epoch)
  VALUES (p_match, app_school_id(), 'handover_claimed', app_user_id(), s.epoch);

  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

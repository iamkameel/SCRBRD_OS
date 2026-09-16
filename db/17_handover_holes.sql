-- ══════════════════════════════════════════════════════════════════
--  17 · Two holes a handover that never finished fell through
-- ══════════════════════════════════════════════════════════════════
--
-- Found by tools/smoke-handover-crash.mjs, the walk the audit asked for:
-- device B claims the match and dies before it verifies.
--
-- 1. A SCORER COULD NOT QUARANTINE THEIR OWN BALLS. The write path routes a
--    stale ball to ball_event_quarantine with INSERT ... ON CONFLICT DO
--    NOTHING, and Postgres applies the table's SELECT policies to any INSERT
--    that carries ON CONFLICT (or RETURNING), so the conflict check cannot
--    leak a row. The only read policies were "whoever may correct" and
--    "whoever may approve". A coach holds neither, so every stale ball a
--    coach's device ever sent — after a handover, after a lease lapsed —
--    was refused with a bare 42501: not merged, not quarantined, a 500 to
--    the device, and an outbox that never drains. The scorer account in the
--    seed happens to hold scoring.correct, which is why the clean handover
--    walk never saw it.
--
--    You may see your own quarantined balls. That is right on its own
--    terms — the sync engine reports them as rejected and a scorer should
--    be able to look — and it is what lets the insert proceed.
CREATE POLICY quarantine_read_own ON ball_event_quarantine
  FOR SELECT USING (scorer_user_id = app_user_id());

-- 2. A CLAIM COULD JUMP A PENDING VERIFICATION. scoring_claim refused only
--    while the session was ACTIVE with a live lease held elsewhere. Between
--    B's claim and B's verify the state is VERIFYING — and a plain claim
--    from any device with scoring.start went straight through, bumping the
--    epoch and wiping the pending handover, code and all. The lock that the
--    handover walk asserts ("neither device may write") held for balls and
--    not for the token itself. Now a live lease refuses a claim in either
--    state; once it lapses, a claim or a force-release is the way back in.
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
  -- A handover is mid-verification and its lease is live → nobody claims
  -- past it, the outgoing device included. Force-release after the lease.
  IF s.state = 'verifying' AND s.lease_until > now() THEN
    RETURN QUERY SELECT false,'verification_pending', s.epoch; RETURN;
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

-- ══════════════════════════════════════════════════════════════════
--  14 · A way out of quarantine
-- ══════════════════════════════════════════════════════════════════
--
-- ball_event_quarantine has held stale-epoch balls since the first scoring
-- migration, with resolved_at, resolved_by and resolution columns waiting for
-- a decision that nothing could make: no UPDATE policy, no function, no
-- route. A ball that landed here was lost to the scorecard for ever unless
-- somebody edited the table by hand — an over short, a wicket missing, and
-- the record wrong in a way nothing downstream could notice.
--
-- This is the door, shaped like scoring_amendment_decide: SECURITY DEFINER,
-- because accepting a ball means writing to a match that may have no live
-- session, which ball_event_insert refuses by design and must go on refusing.
-- It checks its own authority. Four things, in order:
--
--   1. The decider holds scoring.amend.approve over THIS match. Releasing a
--      ball is a correction to canonical truth, so it takes the approval
--      capability, not the scorer's.
--   2. The decider is not the scorer who submitted it. Same rule as an
--      amendment: authorship and authority are two facts, two names.
--   3. Accepting writes the ball under the CURRENT epoch at the next seq,
--      marked recovered, under the SUBMITTING scorer's name. The columns come
--      from the API, which mapped them with the one mapper (toRow) the live
--      path uses; this function does not re-derive a delivery from JSON.
--   4. A key already in ball_event is not written twice: the ball arrived by
--      another road, and the quarantine row is closed as a duplicate.
-- The person who decides must be able to see what they are deciding. The
-- table's read policy was "whoever may correct may look" (scoring.correct); a
-- principal holds the approval capability and not that one, and was handed an
-- empty queue. Approval implies sight.
CREATE POLICY quarantine_read_approver ON ball_event_quarantine
  FOR SELECT USING (app_can('scoring.amend.approve', ball_event_quarantine.school_id,
                            match_team(ball_event_quarantine.match_id), NULL, ball_event_quarantine.match_id));

CREATE OR REPLACE FUNCTION quarantine_resolve(
  p_id      bigint,
  p_accept  boolean,
  p_row     jsonb,              -- the delivery's columns, as toRow() produced them; ignored when rejecting
  p_note    text DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text, seq integer) AS $$
DECLARE
  q        ball_event_quarantine%ROWTYPE;
  v_seq    integer;
  v_epoch  integer;
BEGIN
  SELECT * INTO q FROM ball_event_quarantine WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_quarantine', NULL::integer; RETURN; END IF;
  IF q.resolved_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_' || q.resolution, NULL::integer; RETURN; END IF;

  -- (1) authority over this match
  IF NOT app_can('scoring.amend.approve', q.school_id, match_team(q.match_id), NULL, q.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::integer; RETURN;
  END IF;
  -- (2) not your own
  IF q.scorer_user_id = app_user_id() THEN
    RETURN QUERY SELECT false, 'cannot_release_your_own', NULL::integer; RETURN;
  END IF;

  IF NOT p_accept THEN
    UPDATE ball_event_quarantine
       SET resolved_at = now(), resolved_by = app_user_id(), resolution = 'rejected'
     WHERE id = p_id;
    RETURN QUERY SELECT true, NULL::text, NULL::integer; RETURN;
  END IF;

  -- (4) already in the log by another road: close as a duplicate, write nothing
  IF EXISTS (SELECT 1 FROM ball_event b WHERE b.idempotency_key = q.idempotency_key) THEN
    UPDATE ball_event_quarantine
       SET resolved_at = now(), resolved_by = app_user_id(), resolution = 'rejected'
     WHERE id = p_id;
    RETURN QUERY SELECT false, 'already_recorded', NULL::integer; RETURN;
  END IF;
  IF p_row IS NULL THEN RETURN QUERY SELECT false, 'row_required', NULL::integer; RETURN; END IF;

  -- (3) under the current epoch, at the next seq, as the scorer who sent it
  SELECT coalesce(max(b.seq), 0) + 1, coalesce(max(b.epoch), q.submitted_epoch)
    INTO v_seq, v_epoch
    FROM ball_event b WHERE b.match_id = q.match_id;

  INSERT INTO ball_event
    (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
     idempotency_key, client_seq, client_ts, kind, ball_type, value, shot, seg, zone,
     striker_id, non_striker_id, bowler_id, dismissed_id, dismissal, payload,
     theta, radius, placement_source, placement_null, close_position, capture_profile,
     recovered)
  VALUES
    (q.match_id, q.school_id, v_seq, v_epoch,
     coalesce((p_row->>'innings')::smallint, (q.body->>'innings')::smallint, 0),
     q.scorer_user_id, q.device_id, q.idempotency_key,
     coalesce((q.body->>'clientSeq')::integer, v_seq),
     coalesce(to_timestamp((q.body->>'clientTs')::double precision / 1000), now()),
     coalesce(p_row->>'kind', 'ball'), p_row->>'ball_type', (p_row->>'value')::integer,
     p_row->>'shot', (p_row->>'seg')::integer, p_row->>'zone',
     (p_row->>'striker_id')::uuid, (p_row->>'non_striker_id')::uuid, (p_row->>'bowler_id')::uuid,
     (p_row->>'dismissed_id')::uuid, p_row->>'dismissal', coalesce(p_row->'payload', '{}'::jsonb),
     (p_row->>'theta')::integer, (p_row->>'radius')::numeric, p_row->>'placement_source',
     p_row->>'placement_null', p_row->>'close_position', p_row->>'capture_profile',
     true);

  UPDATE ball_event_quarantine
     SET resolved_at = now(), resolved_by = app_user_id(), resolution = 'accepted'
   WHERE id = p_id;

  RETURN QUERY SELECT true, NULL::text, v_seq;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION quarantine_resolve(bigint, boolean, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quarantine_resolve(bigint, boolean, jsonb, text) TO PUBLIC;

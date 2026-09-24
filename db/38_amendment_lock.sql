-- ══════════════════════════════════════════════════════════════════
--  38 · An approved amendment takes the per-match lock (SCRBRD-076)
-- ══════════════════════════════════════════════════════════════════
--
-- scoring_amendment_decide() (db/02) appends a `void` to ball_event without
-- the per-match lock every other writer takes: the live path through
-- scoring_lease_check(), and since db/37 a quarantine release. So a live
-- batch that had already folded the log could append after the amendment's
-- void without ever judging against it, and the two could race for one seq.
-- An amendment is normally approved days after the match, when no live writer
-- exists — but nothing requires that, and the request can be filed while the
-- match is still being scored.
--
-- db/02 is frozen, so the function is replaced here, whole, from its only
-- definition, with ONE change: after the authority checks and before
-- anything is read that the append depends on, it takes the live path's lock
-- on the scoring_session row, in the live path's order (session row first,
-- then the amendment row, as db/37 does with the held row), held to the end
-- of the caller's transaction. No session row means no live writer:
-- ball_event's INSERT policy needs one.
--
-- To take the session lock first, the amendment row is read once WITHOUT a
-- lock to learn its match (and to answer a caller with no standing before
-- anybody's lock is held, as db/37 does), then read again FOR UPDATE under the
-- session lock and its state asked again: somebody may have decided it
-- meanwhile. That second ask can only repeat a reason the first one gives.
--
-- UNCHANGED, and diffed line by line against db/02: the signature and return
-- shape; every authority check, every reason and their order —
-- no_such_amendment, already_<state>, not_permitted, cannot_approve_your_own,
-- (decline), no_such_live_delivery; the seq, epoch and innings the void
-- takes; its key (amendment:<id>); its author (the requester), its device
-- ('amendment') and its payload (target, amendment, approved_by). search_path
-- is pinned in the definition, because CREATE OR REPLACE discards the pin
-- db/16 set with ALTER FUNCTION. Grants are restated exactly as db/02 made
-- them; scrbrd_app's own EXECUTE (db/06) survives a replace untouched.
--
-- THE LAWS. SQL cannot run lawsRefusal(), and a second copy of the Laws in
-- PL/pgSQL is the drift scoring-session.mjs already recorded once. So, as with
-- a release, this function decides WHO; the API route (POST
-- /api/amendments/:id/decide, services/api/write/events-api.mjs) calls it in a
-- savepoint, folds the log up to the void, asks lawsRefusal() about the void
-- exactly as it was stored, and rolls back with the reason in words if it is
-- refused. Under the lock taken here, the log it judges is the log the void
-- lands on. What the Laws mean for an amendment — and the one live-undo rule
-- they do NOT apply to it, last-in-first-out — is written there.

CREATE OR REPLACE FUNCTION scoring_amendment_decide(
  p_amendment uuid,
  p_approve   boolean,
  p_note      text DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text, void_key text) AS $$
DECLARE
  a         scoring_amendment%ROWTYPE;
  v_team    text;
  v_seq     integer;
  v_epoch   integer;
  v_innings smallint;
  v_key     text;
BEGIN
  -- Read to learn the match; not locked yet (see the header).
  SELECT * INTO a FROM scoring_amendment WHERE id = p_amendment;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_amendment', NULL::text; RETURN; END IF;
  IF a.state <> 'pending' THEN
    RETURN QUERY SELECT false, 'already_' || a.state, NULL::text; RETURN; END IF;

  v_team := match_team(a.match_id);

  -- (1) authority over this match
  IF NOT app_can('scoring.amend.approve', a.school_id, v_team, NULL, a.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;

  -- (2) not your own
  IF a.requested_by = app_user_id() THEN
    RETURN QUERY SELECT false, 'cannot_approve_your_own', NULL::text; RETURN;
  END IF;

  -- The live path's per-match lock (scoring_lease_check), in the live path's
  -- order — session row, then the amendment row — held to the caller's
  -- commit, so nothing is appended to this match between the max(seq) below
  -- and the route's Laws check. db/38.
  PERFORM 1 FROM scoring_session s WHERE s.match_id = a.match_id FOR UPDATE;
  -- ...and asked again under the lock: somebody may have decided it meanwhile.
  SELECT * INTO a FROM scoring_amendment WHERE id = p_amendment FOR UPDATE;
  IF a.state <> 'pending' THEN
    RETURN QUERY SELECT false, 'already_' || a.state, NULL::text; RETURN; END IF;

  IF NOT p_approve THEN
    UPDATE scoring_amendment
       SET state = 'declined', decided_by = app_user_id(),
           decided_at = now(), decided_note = p_note
     WHERE id = p_amendment;
    RETURN QUERY SELECT true, NULL::text, NULL::text; RETURN;
  END IF;

  -- (3) the target is a live delivery in this match
  SELECT b.innings INTO v_innings
    FROM ball_event_live b
   WHERE b.match_id = a.match_id AND b.idempotency_key = a.target_key;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_such_live_delivery', NULL::text; RETURN;
  END IF;

  SELECT coalesce(max(seq), 0) + 1, coalesce(max(epoch), 1)
    INTO v_seq, v_epoch
    FROM ball_event WHERE match_id = a.match_id;

  -- Derived from the amendment id, so the same approval cannot write two voids
  -- even if this function is somehow called twice: the UNIQUE on
  -- idempotency_key refuses the second.
  v_key := 'amendment:' || a.id::text;

  -- (4) authored by the requester, approved by the caller
  INSERT INTO ball_event
    (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
     idempotency_key, client_seq, client_ts, kind, payload)
  VALUES
    (a.match_id, a.school_id, v_seq, v_epoch, v_innings, a.requested_by,
     -- Not a scoring device. A correction made at a desk days later did not
     -- come from one, and recording a device that was never involved would put
     -- a fiction in the provenance columns.
     'amendment', v_key, v_seq, now(), 'void',
     jsonb_build_object('target', a.target_key,
                        'amendment', a.id,
                        'approved_by', app_user_id()));

  UPDATE scoring_amendment
     SET state = 'approved', decided_by = app_user_id(),
         decided_at = now(), decided_note = p_note, applied_key = v_key
   WHERE id = p_amendment;

  RETURN QUERY SELECT true, NULL::text, v_key;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION scoring_amendment_decide(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scoring_amendment_decide(uuid, boolean, text) TO PUBLIC;

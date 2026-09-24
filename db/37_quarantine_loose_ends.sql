-- ══════════════════════════════════════════════════════════════════
--  37 · Quarantine's loose ends (SCRBRD-071)
-- ══════════════════════════════════════════════════════════════════
--
-- Three things db/14's door and the live write path left open. db/14 is
-- frozen, so its function is replaced here, whole, from its only definition.
--
-- 1. A RELEASED BALL IS JUDGED BY THE LAWS, AND THE LOG IS STILL ORDERED.
--    The live path judges every event with lawsRefusal() (packages/scoring)
--    over the fold of the log so far, inside the per-match lock that
--    scoring_lease_check() takes on the scoring_session row. A release wrote
--    straight into ball_event with neither: no Laws, and no lock — so a live
--    batch that had folded the log a moment earlier could append after a
--    released ball it had never judged against, and the two could race for
--    one seq.
--
--    SQL cannot run lawsRefusal(), and a second copy of the Laws in PL/pgSQL
--    is the drift scoring-session.mjs already recorded once. So the work is
--    split by what each side can do, and nothing is judged twice:
--
--      quarantine_resolve()  WHO may release (unchanged: scoring.amend.approve
--                            over this match, and not the submitting scorer),
--                            and it now takes the SAME per-match lock as the
--                            live path before it reads max(seq) — the lock is
--                            held to the end of the caller's transaction.
--      the API route         WHETHER the Laws allow it. It calls this function
--                            inside a savepoint, folds the log up to the seq
--                            it was given, asks lawsRefusal() about the row
--                            exactly as it was stored, and rolls the savepoint
--                            back if it is refused — nothing written, the
--                            held row still open, and the reason returned in
--                            words (services/api/write/events-api.mjs).
--
--    Authority first, then the Laws: a caller the function refuses learns
--    nothing about the state of the match from a Laws verdict. And because the
--    lock is taken here, the fold the route judges against is the log the ball
--    lands on: no live append can slip between them.
--
--    Nothing else can call this function around the route. The only login
--    role that is not the owner is scrbrd_app, which only the API uses, and
--    the API calls quarantine_resolve() from exactly one place
--    (POST /api/quarantine/:id/resolve). The owner bypasses every policy in
--    this schema anyway; a grant changed here would guard nothing new.
--
-- 2. `contact` AND `trajectory` ARE WRITTEN. toRow() maps both to columns;
--    neither the live INSERT nor this function listed them, so both were
--    dropped. The live path is fixed in events-api.mjs; this function is fixed
--    by being replaced. Fingerprints (db/36) of rows already stored do not
--    move: a column that was never written is NULL, and NULLs are stripped.
--
-- 3. A KEY WRITTEN LIVE CLOSES ITS HELD COPY. A ball held under a stale token
--    and later re-sent by a device that holds the token was written live —
--    correctly: it passed the lease, the epoch and the Laws, as any new ball
--    would — but its held copy stayed open, waiting for a person to release a
--    ball already in the log. It now closes, as 'superseded', in the same
--    statement, by trigger: every writer of ball_event reaches it, as db/36's
--    fingerprint does. Only a held copy that says the SAME thing (fingerprint
--    equal, or NULL for a row held before db/36 — the write path's own rule)
--    is closed; a different event under the same key is a conflict, which the
--    live path refuses before it gets here, and which stays for a person.
--    Rows this bug already left open are closed below, the same way.

-- ── 'superseded' is a resolution ───────────────────────────────────
ALTER TABLE ball_event_quarantine DROP CONSTRAINT IF EXISTS ball_event_quarantine_resolution_check;
ALTER TABLE ball_event_quarantine ADD CONSTRAINT ball_event_quarantine_resolution_check
  CHECK (resolution IN ('accepted','rejected','superseded'));

-- ── A key written live closes its held copy ────────────────────────
-- SECURITY DEFINER because no application role may UPDATE the quarantine
-- table (there is no UPDATE policy, by design). It can close only a held row
-- whose key the inserting statement has just written, with the same content,
-- in the same match — which the inserter passed ball_event's own INSERT
-- policy to do. A release (recovered = true) closes its own row as
-- 'accepted', in quarantine_resolve() below, and is left to it.
CREATE OR REPLACE FUNCTION ball_event_supersedes_held() RETURNS trigger AS $$
BEGIN
  IF NEW.recovered THEN RETURN NULL; END IF;
  UPDATE ball_event_quarantine q
     SET resolved_at = now(), resolved_by = app_user_id(), resolution = 'superseded'
   WHERE q.idempotency_key = NEW.idempotency_key
     AND q.match_id = NEW.match_id
     AND q.resolved_at IS NULL
     AND (q.fingerprint IS NULL OR q.fingerprint = NEW.fingerprint);
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS ball_event_supersedes_held ON ball_event;
CREATE TRIGGER ball_event_supersedes_held
  AFTER INSERT ON ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_supersedes_held();

-- What the bug already left behind: held copies of keys that are in the log,
-- saying the same thing. Nobody decided these, so resolved_by stays NULL.
UPDATE ball_event_quarantine q
   SET resolved_at = now(), resolution = 'superseded'
  FROM ball_event b
 WHERE b.idempotency_key = q.idempotency_key
   AND b.match_id = q.match_id
   AND q.resolved_at IS NULL
   AND (q.fingerprint IS NULL OR q.fingerprint = b.fingerprint);

-- ── quarantine_resolve(), from db/14, with the three changes ───────
-- Unchanged: the signature, the return shape, every reason and its order
-- (no_such_quarantine, already_*, not_permitted, cannot_release_your_own,
-- already_recorded, row_required), the epoch and seq a released ball takes,
-- and `recovered`. Changed: the per-match lock, contact and trajectory, and a
-- key already in the log closes its held copy as 'superseded' when the two
-- say the same thing (it was 'rejected', which read as a person's decision),
-- or is refused as idempotency_conflict and left open when they do not — a
-- person discards it; releasing it can never succeed.
CREATE OR REPLACE FUNCTION quarantine_resolve(
  p_id      bigint,
  p_accept  boolean,
  p_row     jsonb,              -- the delivery's columns, as toRow() produced them; ignored when rejecting
  p_note    text DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text, seq integer) AS $$
DECLARE
  q        ball_event_quarantine%ROWTYPE;
  v_live   text;
  v_seq    integer;
  v_epoch  integer;
BEGIN
  -- Authority is read off the row before anything is locked: a caller with
  -- no standing over this match holds nobody's lock, even for a moment.
  SELECT * INTO q FROM ball_event_quarantine WHERE id = p_id;
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

  -- The live path's per-match lock (scoring_lease_check), in the live path's
  -- order — session row, then the held row — so the two never deadlock, and
  -- nothing is appended to this match between here and the caller's commit.
  -- No session row means no live writer: ball_event's INSERT policy needs one.
  PERFORM 1 FROM scoring_session s WHERE s.match_id = q.match_id FOR UPDATE;
  -- ...and asked again under the lock: somebody may have decided it meanwhile.
  SELECT * INTO q FROM ball_event_quarantine WHERE id = p_id FOR UPDATE;
  IF q.resolved_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_' || q.resolution, NULL::integer; RETURN; END IF;

  IF NOT p_accept THEN
    UPDATE ball_event_quarantine
       SET resolved_at = now(), resolved_by = app_user_id(), resolution = 'rejected'
     WHERE id = p_id;
    RETURN QUERY SELECT true, NULL::text, NULL::integer; RETURN;
  END IF;

  -- (4) already in the log by another road
  SELECT b.fingerprint INTO v_live FROM ball_event b WHERE b.idempotency_key = q.idempotency_key;
  IF FOUND THEN
    IF q.fingerprint IS NULL OR q.fingerprint = v_live THEN
      UPDATE ball_event_quarantine
         SET resolved_at = now(), resolved_by = app_user_id(), resolution = 'superseded'
       WHERE id = p_id;
      RETURN QUERY SELECT false, 'already_recorded', NULL::integer; RETURN;
    END IF;
    RETURN QUERY SELECT false, 'idempotency_conflict', NULL::integer; RETURN;
  END IF;
  IF p_row IS NULL THEN RETURN QUERY SELECT false, 'row_required', NULL::integer; RETURN; END IF;

  -- (3) under the current epoch, at the next seq, as the scorer who sent it
  SELECT coalesce(max(b.seq), 0) + 1, coalesce(max(b.epoch), q.submitted_epoch)
    INTO v_seq, v_epoch
    FROM ball_event b WHERE b.match_id = q.match_id;

  INSERT INTO ball_event
    (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
     idempotency_key, client_seq, client_ts, kind, ball_type, value, shot, contact, trajectory,
     seg, zone, striker_id, non_striker_id, bowler_id, dismissed_id, dismissal, payload,
     theta, radius, placement_source, placement_null, close_position, capture_profile,
     recovered)
  VALUES
    (q.match_id, q.school_id, v_seq, v_epoch,
     coalesce((p_row->>'innings')::smallint, (q.body->>'innings')::smallint, 0),
     q.scorer_user_id, q.device_id, q.idempotency_key,
     coalesce((q.body->>'clientSeq')::integer, v_seq),
     coalesce(to_timestamp((q.body->>'clientTs')::double precision / 1000), now()),
     coalesce(p_row->>'kind', 'ball'), p_row->>'ball_type', (p_row->>'value')::integer,
     p_row->>'shot', p_row->>'contact', p_row->>'trajectory',
     (p_row->>'seg')::integer, p_row->>'zone',
     (p_row->>'striker_id')::uuid, (p_row->>'non_striker_id')::uuid, (p_row->>'bowler_id')::uuid,
     (p_row->>'dismissed_id')::uuid, p_row->>'dismissal', coalesce(p_row->'payload', '{}'::jsonb),
     (p_row->>'theta')::integer, (p_row->>'radius')::numeric, p_row->>'placement_source',
     p_row->>'placement_null', p_row->>'close_position', p_row->>'capture_profile',
     true);

  UPDATE ball_event_quarantine
     SET resolved_at = now(), resolved_by = app_user_id(), resolution = 'accepted'
   WHERE id = p_id;

  RETURN QUERY SELECT true, NULL::text, v_seq;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION quarantine_resolve(bigint, boolean, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quarantine_resolve(bigint, boolean, jsonb, text) TO PUBLIC;

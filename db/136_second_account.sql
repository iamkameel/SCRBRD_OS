-- ══════════════════════════════════════════════════════════════════
--  136 · A second account: the record, and who may decide it
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Slice 2 of docs/design/TWO_PHONES.md (§6), R4 and R6.
-- Kameel approved the design, "All seven as recommended" (Build Board,
-- 5 Nov 2026, 11:55 UTC).
--
-- When a second phone scores a match it does not hold the pen for, its balls
-- are set aside in ball_event_quarantine and never merged (db/02, db/37).
-- The review that settles them had three holes this file closes in the
-- database; the comparison and the three decisions are the API's and the
-- screen's (services/api/write/second-account.mjs, views/quarantine.jsx).
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
-- quarantine_resolve() (db/37's, replaced whole; db/14 and db/37 are frozen)
-- gains a fifth argument, p_counterpart text: the idempotency key of the
-- pen's ball the set-aside one was compared with, or NULL ("the pen has no
-- ball here"). Every check db/37 made stands, in its order, with its words:
--   no_such_quarantine, already_<resolution>, not_permitted,
--   cannot_release_your_own,
-- and then, NEW (R6):
--   you_scored_this_match   the decider is the scorer of a live ball in this
--                           match's log (ball_event_live: not a voided ball,
--                           not a void). The scorer holding the pen is a party
--                           to the disagreement and may not settle it; at a
--                           school whose only approver scored, another
--                           approver, or the platform, decides.
--   no_such_counterpart     p_counterpart is not a ball of this match's log.
-- then db/37's lock, its re-read, and its two paths, unchanged: a rejection
-- writes no ball; a release is written at the next seq under the current
-- epoch, marked recovered, under the submitting scorer's name, and the API
-- judges it by the Laws inside its savepoint (db/37 §1).
--
-- THE RECORD (R4). Every resolution this function makes — rejected,
-- accepted, or closed as already in the log ('superseded') — writes one
-- scoring_audit row, event 'second_account_resolved':
--   actor_id   the decider
--   from_user  the scorer who sent the set-aside ball (the other book)
--   to_user    the scorer of the pen's ball it was compared with, if any
--   epoch      the epoch current when the ball was set aside
--   detail     quarantine_id, resolution, counterpart_key, note,
--              submitted_epoch, current_epoch — and, where they are known,
--              ball (the pen's ball as over.ball: the counterpart's, or the
--              released ball's place in the log), seq (a released ball's) and
--              amendment (a pending amendment of the pen's ball whose id the
--              note names: "the other phone was right", R5.3).
-- The note, which db/14 accepted and threw away, is stored at last, there:
-- trimmed, at most 1000 characters, NULL when empty. A person can read, for
-- any ball, who wrote the one that stands, who wrote the other, who decided
-- between them and why. The losing version is never a void: the second
-- account was never in the match's book.
--
-- audit_log() (db/133's body) words the row: "Set aside a second account of
-- 11.3: the pen's ball stands", "...: an amendment was asked of the pen's
-- ball", "Released a set-aside ball the pen did not have (11.3)", "Closed a
-- set-aside ball already in the log", and carries resolution, ball, note and
-- amendment in its detail. Two lines change, by db/133's patch: nothing else
-- in the body moves.
--
-- "THE OTHER PHONE WAS RIGHT" (R5.3; Kameel, 5 Nov 2026, 13:43, the Build
-- Board, answer "A"). The reviewer opens the amendment request on the pen's
-- ball himself, though he holds scoring.amend.approve and not
-- scoring.amend.request: second_account_amend(), a definer used by the
-- second-account route alone, asks exactly what quarantine_resolve() asks of
-- him — the approval capability over the match, not the sender, not the
-- scorer of a live ball in it — and that the ball is a live ball of this
-- match, then writes the request in his name. Nothing else changes:
-- scoring_amendment's own INSERT policy (db/24) still asks
-- scoring.amend.request of everyone else, and scoring_amendment_decide()
-- still refuses the requester (cannot_approve_your_own), so another approver
-- approves it. Two hands stand.
--
-- ── WHY DROP AND CREATE ─────────────────────────────────────────────
-- A fifth argument is a new signature. Left beside it, the four-argument
-- function would be a door around you_scored_this_match. So it is dropped
-- (nothing in SQL calls it; the API calls it from one place, now passing the
-- fifth, and db/99 and tools/bundle-sql.mjs name it by signature and move
-- with this file) and the new one created in the same transaction, so no
-- caller sees it missing. A four-argument call still resolves to it
-- (p_counterpart DEFAULT NULL).
--
-- WHO MAY CALL THEM. Both are SECURITY DEFINER, search_path pinned, granted to
-- scrbrd_app alone; revoked from PUBLIC and a managed host's anon,
-- authenticated and service_role (db/131's loop). db/14 and db/37 granted it
-- to PUBLIC: that grant is gone with the old signature.
--
-- WHAT IT CHANGES ON A LIVE DATABASE (production holds test data only)
--   function quarantine_resolve(bigint,boolean,jsonb,text) (db/37): dropped
--   function quarantine_resolve(bigint,boolean,jsonb,text,text): created
--   function second_account_amend(bigint,text,text): created
--   function audit_log(…) (db/133): two lines added
-- No table, column, capability, role or policy. Existing rows untouched. A
-- second paste changes nothing (the guard reads db/37's and db/133's bodies
-- or this file's; the patch leaves a body already this file's as it is).
-- Does not depend on db/135.
--
-- SCHEMA FIRST. The API built with it passes the fifth argument and words
-- the new refusals; this file goes before it and is in
-- services/api/expected-migrations.json. Its proof is db/99 §114.
-- Not to be pasted before it is reviewed.
--
-- THE GUARD keys on pg_proc.prosrc as db/132–db/134 do: the md5 of the live
-- body, its whitespace folded, must be the shipped one's or this file's.


-- ── 0 · What this file was written against ─────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._v136_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE v_old text; v_new text; v_log text; v_md5 text;
BEGIN
  IF to_regclass('ball_event_quarantine') IS NULL OR to_regclass('scoring_audit') IS NULL
     OR to_regclass('scoring_session') IS NULL OR to_regclass('ball_event_live') IS NULL
     OR to_regclass('scoring_amendment') IS NULL
     OR to_regprocedure('ball_counts_in_over(text,jsonb)') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/136: the quarantine (db/02, db/37), the amendment (db/02), ball_counts_in_over() (db/54) or app_can() is missing; apply them first';
  END IF;
  SELECT p.prosrc INTO v_old FROM pg_proc p WHERE p.oid = to_regprocedure('quarantine_resolve(bigint,boolean,jsonb,text)');
  SELECT p.prosrc INTO v_new FROM pg_proc p WHERE p.oid = to_regprocedure('quarantine_resolve(bigint,boolean,jsonb,text,text)');
  IF v_old IS NULL AND v_new IS NULL THEN
    RAISE EXCEPTION 'db/136: quarantine_resolve() (db/37) is not there to replace';
  END IF;
  IF v_old IS NOT NULL AND pg_temp._v136_fold(v_old) <> '96b462ce7332f3db3497e541690a28bc' THEN
    RAISE EXCEPTION 'db/136: quarantine_resolve(bigint,boolean,jsonb,text) is not db/37''s (md5 % of its folded body); look before replacing it',
      pg_temp._v136_fold(v_old);
  END IF;
  IF v_old IS NULL AND pg_temp._v136_fold(v_new) <> '4e1dffc125a2e282281bcc7336d8cb9c' THEN
    RAISE EXCEPTION 'db/136: quarantine_resolve(bigint,boolean,jsonb,text,text) is not this file''s (md5 % of its folded body); look before replacing it',
      pg_temp._v136_fold(v_new);
  END IF;
  IF to_regprocedure('second_account_amend(bigint,text,text)') IS NOT NULL
     AND pg_temp._v136_fold((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('second_account_amend(bigint,text,text)'))) <> '1eaa5e2dd708112cabe67a5527ee0ac5' THEN
    RAISE EXCEPTION 'db/136: second_account_amend() is there and not this file''s; look before replacing it';
  END IF;
  SELECT p.prosrc INTO v_log FROM pg_proc p WHERE p.oid = to_regprocedure('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)');
  IF v_log IS NULL THEN
    RAISE EXCEPTION 'db/136: audit_log() (db/133) is not there to re-create';
  END IF;
  v_md5 := pg_temp._v136_fold(v_log);
  IF v_md5 NOT IN ('4ff2375005bedd367c4bfea8463befca', 'a381fc0455aff9196d74f232eacfb01b') THEN
    RAISE EXCEPTION 'db/136: audit_log() is not db/133''s or this file''s (md5 % of its folded body); look before replacing it', v_md5;
  END IF;
END $guard$;

-- One body, one change: `needle` must stand in it exactly `times` times, and
-- each becomes `repl`. Re-emitted through pg_get_functiondef(), so the
-- signature, options and grants stand; a body already this file's is left.
CREATE OR REPLACE FUNCTION pg_temp._v136_patch(p_fn text, p_needle text, p_repl text, p_times integer) RETURNS void AS $$
DECLARE v_src text; v_n integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn::regprocedure;
  IF position(p_repl IN v_src) > 0 THEN RETURN; END IF;
  v_n := (length(v_src) - length(replace(v_src, p_needle, ''))) / length(p_needle);
  IF v_n <> p_times THEN
    RAISE EXCEPTION 'db/136: % holds its needle % times, not %: look before replacing it', p_fn, v_n, p_times;
  END IF;
  EXECUTE replace(pg_get_functiondef(p_fn::regprocedure), p_needle, p_repl);
END $$ LANGUAGE plpgsql;


-- ══════════════════════════════════════════════════════════════════
-- §1 · quarantine_resolve(), with the counterpart, the separation and
--      the record
-- ══════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS quarantine_resolve(bigint, boolean, jsonb, text);

CREATE OR REPLACE FUNCTION quarantine_resolve(
  p_id          bigint,
  p_accept      boolean,
  p_row         jsonb,              -- the delivery's columns, as toRow() produced them; ignored when rejecting
  p_note        text DEFAULT NULL,
  p_counterpart text DEFAULT NULL   -- the pen's ball it was compared with; NULL: the pen has no ball here
) RETURNS TABLE (ok boolean, reason text, seq integer) AS $$
DECLARE
  q        ball_event_quarantine%ROWTYPE;
  v_live   text;
  v_seq    integer;
  v_epoch  integer;
  v_me     uuid := app_user_id();
  v_note   text := nullif(btrim(left(p_note, 1000)), '');
  v_pen    uuid;           -- the scorer of the counterpart
  v_amend  uuid;           -- a pending amendment of the counterpart the note names
  v_res    text;
  v_label  text;
  v_at     record;         -- the ball the label is of: innings, seq, kind, type, payload
  v_n      integer;
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
  IF q.scorer_user_id = v_me THEN
    RETURN QUERY SELECT false, 'cannot_release_your_own', NULL::integer; RETURN;
  END IF;
  -- (2b) db/136: neither book's scorer. Not the scorer of any ball that
  -- stands in this match's log (R6): he is a party to the disagreement.
  IF EXISTS (SELECT 1 FROM ball_event_live b WHERE b.match_id = q.match_id AND b.scorer_user_id = v_me) THEN
    RETURN QUERY SELECT false, 'you_scored_this_match', NULL::integer; RETURN;
  END IF;
  -- (2c) db/136: the pen's ball it was compared with is a ball of this match.
  IF p_counterpart IS NOT NULL THEN
    SELECT b.scorer_user_id INTO v_pen FROM ball_event b
     WHERE b.match_id = q.match_id AND b.idempotency_key = p_counterpart;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'no_such_counterpart', NULL::integer; RETURN;
    END IF;
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
       SET resolved_at = now(), resolved_by = v_me, resolution = 'rejected'
     WHERE id = p_id;
    v_res := 'rejected';
  ELSE
    -- (4) already in the log by another road
    SELECT b.fingerprint INTO v_live FROM ball_event b WHERE b.idempotency_key = q.idempotency_key;
    IF FOUND THEN
      IF q.fingerprint IS NULL OR q.fingerprint = v_live THEN
        UPDATE ball_event_quarantine
           SET resolved_at = now(), resolved_by = v_me, resolution = 'superseded'
         WHERE id = p_id;
        v_res := 'superseded';
      ELSE
        RETURN QUERY SELECT false, 'idempotency_conflict', NULL::integer; RETURN;
      END IF;
    ELSE
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
         SET resolved_at = now(), resolved_by = v_me, resolution = 'accepted'
       WHERE id = p_id;
      v_res := 'accepted';
    END IF;
  END IF;

  -- ── db/136: the record (R4) ──
  -- The ball named in words: the counterpart's place in the pen's log, or
  -- the released ball's. over.ball as the fold counts it (countsInOver():
  -- ball_counts_in_over(), db/54), over ball_event_live; an extra is named
  -- by the ball it came before.
  SELECT b.innings, b.seq, b.kind, b.ball_type, b.payload INTO v_at
    FROM ball_event b
   WHERE b.match_id = q.match_id
     AND b.idempotency_key = CASE WHEN v_res = 'accepted' THEN q.idempotency_key ELSE p_counterpart END;
  IF FOUND THEN
    SELECT count(*)::int INTO v_n FROM ball_event_live l
     WHERE l.match_id = q.match_id AND l.innings = v_at.innings AND l.seq <= v_at.seq
       AND l.kind = 'ball' AND ball_counts_in_over(l.ball_type, l.payload);
    v_label := CASE WHEN v_at.kind = 'ball' AND ball_counts_in_over(v_at.ball_type, v_at.payload) AND v_n > 0
                    THEN ((v_n - 1) / 6)::text || '.' || ((v_n - 1) % 6 + 1)::text
                    ELSE (v_n / 6)::text || '.' || (v_n % 6 + 1)::text END;
  END IF;
  -- "The other phone was right" (R5.3): the route asks for an amendment of
  -- the pen's ball and names it in the note; it is recorded only when it is
  -- a pending amendment of that very ball, in this match.
  IF v_res = 'rejected' AND p_counterpart IS NOT NULL AND v_note IS NOT NULL THEN
    SELECT a.id INTO v_amend FROM scoring_amendment a
     WHERE a.match_id = q.match_id AND a.target_key = p_counterpart AND a.state = 'pending'
       AND position(a.id::text IN v_note) > 0
     LIMIT 1;
  END IF;

  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, to_user, epoch, detail)
  VALUES (q.match_id, q.school_id, 'second_account_resolved', v_me, q.scorer_user_id, v_pen, q.current_epoch,
          jsonb_build_object('quarantine_id', q.id, 'resolution', v_res, 'counterpart_key', p_counterpart,
                             'note', v_note, 'submitted_epoch', q.submitted_epoch, 'current_epoch', q.current_epoch)
          || jsonb_strip_nulls(jsonb_build_object('ball', v_label, 'seq', v_seq, 'amendment', v_amend)));

  IF v_res = 'superseded' THEN
    RETURN QUERY SELECT false, 'already_recorded', NULL::integer; RETURN;
  END IF;
  RETURN QUERY SELECT true, NULL::text, v_seq;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

COMMENT ON FUNCTION quarantine_resolve(bigint, boolean, jsonb, text, text) IS
  'TWO_PHONES R4–R6 (db/136; db/37''s, replaced whole): a set-aside ball released (written at the next seq, recovered) or rejected, by scoring.amend.approve over the match — not its sender (cannot_release_your_own), not the scorer of any live ball in the match (you_scored_this_match) — with the pen''s ball it was compared with (p_counterpart) and the note, both kept on a scoring_audit row second_account_resolved. The API judges a release by the Laws in a savepoint.';


-- ══════════════════════════════════════════════════════════════════
-- §1b · "The other phone was right": the reviewer asks for the amendment
-- ══════════════════════════════════════════════════════════════════
-- Asked of the set-aside row p_id: the amendment of the pen's ball p_target,
-- for the reason given. Refusals, in quarantine_resolve()'s order and words:
-- no_such_quarantine, already_<resolution>, not_permitted (no approval over
-- the match, or a pad's credential), cannot_release_your_own,
-- you_scored_this_match; then no_such_counterpart (not a live ball of this
-- match) and note_required. A request already pending on that ball is
-- answered with its id (one pending request per ball, db/02), not a second.
CREATE OR REPLACE FUNCTION second_account_amend(p_id bigint, p_target text, p_reason text)
RETURNS TABLE (ok boolean, reason text, amendment_id uuid) AS $$
DECLARE
  q      ball_event_quarantine%ROWTYPE;
  v_me   uuid := app_user_id();
  v_why  text := nullif(btrim(left(p_reason, 1000)), '');
  v_id   uuid;
BEGIN
  SELECT * INTO q FROM ball_event_quarantine WHERE id = p_id;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_quarantine', NULL::uuid; RETURN; END IF;
  IF q.resolved_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_' || q.resolution, NULL::uuid; RETURN; END IF;
  IF v_me IS NULL OR app_pad_scoped()
     OR NOT app_can('scoring.amend.approve', q.school_id, match_team(q.match_id), NULL, q.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid; RETURN;
  END IF;
  IF q.scorer_user_id = v_me THEN
    RETURN QUERY SELECT false, 'cannot_release_your_own', NULL::uuid; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM ball_event_live b WHERE b.match_id = q.match_id AND b.scorer_user_id = v_me) THEN
    RETURN QUERY SELECT false, 'you_scored_this_match', NULL::uuid; RETURN;
  END IF;
  IF p_target IS NULL OR NOT EXISTS (SELECT 1 FROM ball_event_live b WHERE b.match_id = q.match_id AND b.idempotency_key = p_target) THEN
    RETURN QUERY SELECT false, 'no_such_counterpart', NULL::uuid; RETURN;
  END IF;
  IF v_why IS NULL THEN RETURN QUERY SELECT false, 'note_required', NULL::uuid; RETURN; END IF;

  SELECT a.id INTO v_id FROM scoring_amendment a
   WHERE a.match_id = q.match_id AND a.target_key = p_target AND a.state = 'pending';
  IF v_id IS NULL THEN
    BEGIN
      INSERT INTO scoring_amendment (match_id, school_id, target_key, reason, requested_by)
      VALUES (q.match_id, q.school_id, p_target, v_why, v_me)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT a.id INTO v_id FROM scoring_amendment a
       WHERE a.match_id = q.match_id AND a.target_key = p_target AND a.state = 'pending';
    END;
  END IF;
  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

COMMENT ON FUNCTION second_account_amend(bigint, text, text) IS
  'TWO_PHONES R5.3 (db/136; Kameel, 5 Nov 2026, "A"): the reviewer of a second account opens the amendment request on the pen''s ball, under quarantine_resolve()''s own checks (scoring.amend.approve over the match, not the sender, not a scorer of a live ball in it). Called by the second-account route alone; scoring.amend.request is not widened; scoring_amendment_decide() still refuses the requester.';


-- ══════════════════════════════════════════════════════════════════
-- §2 · audit_log(): the words
-- ══════════════════════════════════════════════════════════════════
SELECT pg_temp._v136_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
'                 WHEN ''postponed''                THEN ''Postponed the match: the pen was put down''   -- db/133',
'                 WHEN ''postponed''                THEN ''Postponed the match: the pen was put down''   -- db/133
                 WHEN ''second_account_resolved''  THEN CASE s.detail->>''resolution''   -- db/136
                   WHEN ''accepted''   THEN ''Released a set-aside ball the pen did not have'' || coalesce('' ('' || (s.detail->>''ball'') || '')'', '''')
                   WHEN ''superseded'' THEN ''Closed a set-aside ball already in the log''
                   ELSE ''Set aside a second account'' || coalesce('' of '' || (s.detail->>''ball''), '''')
                        || CASE WHEN s.detail ? ''amendment'' THEN '': an amendment was asked of the pen''''s ball''
                                WHEN s.detail->>''counterpart_key'' IS NOT NULL THEN '': the pen''''s ball stands''
                                ELSE '''' END END', 1);
SELECT pg_temp._v136_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
'               jsonb_strip_nulls(jsonb_build_object(''event'', s.event, ''epoch'', s.epoch)),',
'               jsonb_strip_nulls(jsonb_build_object(''event'', s.event, ''epoch'', s.epoch))
                 || CASE WHEN s.event = ''second_account_resolved''   -- db/136
                         THEN jsonb_strip_nulls(jsonb_build_object(''resolution'', s.detail->''resolution'', ''ball'', s.detail->''ball'',
                                                                   ''note'', s.detail->''note'', ''amendment'', s.detail->''amendment''))
                         ELSE ''{}''::jsonb END,', 1);


-- ══════════════════════════════════════════════════════════════════
-- §3 · Grants: the application's alone
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['quarantine_resolve(bigint,boolean,jsonb,text,text)', 'second_account_amend(bigint,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE v_md5 text;
BEGIN
  IF to_regprocedure('quarantine_resolve(bigint,boolean,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'db/136: the four-argument quarantine_resolve() is still there: a door around you_scored_this_match';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'quarantine_resolve(bigint,boolean,jsonb,text,text)'::regprocedure
                    AND p.prosecdef AND p.provolatile = 'v'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/136: quarantine_resolve() is not a VOLATILE SECURITY DEFINER with a pinned search_path';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'quarantine_resolve(bigint,boolean,jsonb,text,text)'::regprocedure, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                 WHERE p.oid = 'quarantine_resolve(bigint,boolean,jsonb,text,text)'::regprocedure
                   AND x.privilege_type = 'EXECUTE' AND x.grantee <> p.proowner
                   AND x.grantee <> (SELECT oid FROM pg_roles WHERE rolname = 'scrbrd_app')) THEN
    RAISE EXCEPTION 'db/136: quarantine_resolve() is executable by someone other than its owner and scrbrd_app';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'second_account_amend(bigint,text,text)'::regprocedure
                    AND p.prosecdef AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}')))
     OR NOT has_function_privilege('scrbrd_app', 'second_account_amend(bigint,text,text)'::regprocedure, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                 WHERE p.oid = 'second_account_amend(bigint,text,text)'::regprocedure
                   AND x.privilege_type = 'EXECUTE' AND x.grantee <> p.proowner
                   AND x.grantee <> (SELECT oid FROM pg_roles WHERE rolname = 'scrbrd_app')) THEN
    RAISE EXCEPTION 'db/136: second_account_amend() is not a pinned definer executable by scrbrd_app alone';
  END IF;
  v_md5 := pg_temp._v136_fold((SELECT prosrc FROM pg_proc WHERE oid = 'second_account_amend(bigint,text,text)'::regprocedure));
  IF v_md5 <> '1eaa5e2dd708112cabe67a5527ee0ac5' THEN
    RAISE EXCEPTION 'db/136: second_account_amend() is not this file''s after the paste (md5 %)', v_md5;
  END IF;
  v_md5 := pg_temp._v136_fold((SELECT prosrc FROM pg_proc WHERE oid = 'quarantine_resolve(bigint,boolean,jsonb,text,text)'::regprocedure));
  IF v_md5 <> '4e1dffc125a2e282281bcc7336d8cb9c' THEN
    RAISE EXCEPTION 'db/136: quarantine_resolve() is not this file''s after the paste (md5 %)', v_md5;
  END IF;
  v_md5 := pg_temp._v136_fold((SELECT prosrc FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure));
  IF v_md5 <> 'a381fc0455aff9196d74f232eacfb01b' THEN
    RAISE EXCEPTION 'db/136: audit_log() is not this file''s after the paste (md5 %)', v_md5;
  END IF;
END $check$;

DROP FUNCTION pg_temp._v136_patch(text, text, text, integer);
DROP FUNCTION pg_temp._v136_fold(text);

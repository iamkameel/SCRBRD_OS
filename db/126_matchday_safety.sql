-- ══════════════════════════════════════════════════════════════════
--  126 · Match-day safety: a take-over is a person's confirmed act, and
--        the pad's resume credential may write its match's toss
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's decisions of 30 October 2026 on the match-day
-- audit, as recommended:
--
--   1. "A claim over a match whose token another device held is a confirmed
--      take-over. It shows the server's last-ball time, and an audit row
--      records it. … Opening the fixture or tapping 'Try again' never takes
--      the match silently."
--   2. "The resume credential may write [the toss]."
--
-- Its proof is db/99 §103; the walks are tools/smoke-browser-takeover.mjs
-- (two phones, a lapsed lease, a confirmed take-over) and
-- tools/smoke-pad-resume.mjs B (a toss written under the credential alone).
--
-- ── 1 · A LAPSED LEASE IS NOT AN IDLE MATCH ─────────────────────────
-- scoring_claim() (db/33) refused another device only while its lease was
-- live. The pad refreshed its lease only by sending a ball, so any pause
-- longer than ninety seconds — a wicket, drinks, the innings break, a locked
-- screen — let a second signed-in phone that merely opened the fixture take
-- the token with no word to anybody, and the scoring phone stopped sending.
-- The pad now heartbeats while it is open (apps/web/src/lib/sync.js), and
-- this closes the door the heartbeat cannot: a phone that is gone.
--
-- A plain claim over a session that is `active`, whose lease has lapsed and
-- whose holder is ANOTHER device, is refused as `held_elsewhere` (with the
-- session's epoch, as every refusal carries). Everything else about the
-- claim is db/33's, unchanged: its order, every other refusal, the idle
-- match, the device's own lapsed token taken back, the arming device's
-- cancel, the completion gate, the audit row.
--
-- scoring_takeover(match, device, epoch) is the confirmed act. The pad calls
-- it only after a person has read the server's last ball and pressed
-- "Take over" (syncBanner.jsx `held_elsewhere`). It takes the token only
-- over that same generation — the epoch the person was shown; any other is
-- `epoch_moved` and the pad asks again — and never over a live lease
-- (`lease_active`), a handover under way, or a finished match: for those it
-- answers exactly as scoring_claim() does, because it IS scoring_claim()
-- whenever the match is not held elsewhere. It writes one scoring_audit row,
-- event `takeover`, naming who held it (from_user), who took it (to_user),
-- the device it was taken from, when that lease lapsed, and the server's
-- last ball (its time and seq) at the moment of the take-over.
--
-- A force-release (db/02) leaves the session idle with no holder, so the
-- claim after it is an ordinary claim, as before: the lead's release is the
-- confirmation there, and it has its own audit row.
--
-- A resume credential never takes over: under pad scope app_can() admits
-- no scoring.start, and the function refuses outright before it asks.
--
-- ── 2 · THE TOSS UNDER THE RESUME CREDENTIAL ───────────────────────
-- A toss answered with no signal is queued on the pad and settled before
-- any ball is sent (SCRBRD-075). It was written only signed in, so a toss
-- sent after the thirty-minute sign-in had run out stopped every ball behind
-- it until the office issued a code. pad_resume_toss() writes it under the
-- credential, on the same terms as pad_resume_reclaim(): pad scope, the
-- credential's own match, the token still this person's on this device —
-- and then under the PERSON's own authority for that one write (scoring.start,
-- the capability match_toss_insert asks), the pad scope lifted for it and put
-- back before anything else runs. The direct write to match_toss stays
-- closed under pad scope (db/50's pad_scope_insert/update guards, unchanged).
-- The freeze trigger (db/02 trg_match_toss_frozen) still refuses a toss once
-- the match has an event; the route says `toss_locked`, as signed in.
--
-- ── 3 · WHAT THIS FILE DOES NOT TOUCH ──────────────────────────────
-- No table, column, policy or capability; no row of anybody's. The return
-- shapes of scoring_claim() and every other function are unchanged. A second
-- paste changes nothing. SCHEMA FIRST: the API built with it calls the two
-- new functions, so this file goes before that API; it is in
-- services/api/expected-migrations.json.


-- ── 0 · Refuse to replace what this file was not written against ──
DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regprocedure('app_pad_scoped()') IS NULL OR to_regprocedure('app_pad_match()') IS NULL
     OR to_regprocedure('pad_resume_reclaim(uuid)') IS NULL OR to_regclass('scoring_audit') IS NULL
     OR to_regclass('match_toss') IS NULL OR to_regprocedure('bats_first(text,text)') IS NULL THEN
    RAISE EXCEPTION 'db/126: app_pad_scoped(), app_pad_match(), pad_resume_reclaim() (db/50), scoring_audit, match_toss or bats_first() (db/02) is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('scoring_claim(uuid,text)', 'a5f2b408a89519b7ba08cf4d3610faf5', '4ff22013b983402bd7c68883cfe1a97b', 'db/33'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/126: % (%) is not there to re-create', r.fn, r.src;
    END IF;
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/126: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · scoring_claim (db/33 + held_elsewhere)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION scoring_claim(p_match uuid, p_device text)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  IF p_device IS NULL OR btrim(p_device) = ''
    THEN RETURN QUERY SELECT false,'no_device',NULL::int; RETURN; END IF;
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::int; RETURN; END IF;
  -- Completion ends scoring, for everyone (db/33). Corrections are amendments.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'complete')
    THEN RETURN QUERY SELECT false,'match_complete',
                             (SELECT x.epoch FROM scoring_session x WHERE x.match_id = p_match);
         RETURN; END IF;
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
  -- Another device held it, and its lease has lapsed (db/126): not an idle
  -- match. Taking it is a person's confirmed act, scoring_takeover().
  IF s.state = 'active' AND s.holder_device IS NOT NULL AND s.holder_device IS DISTINCT FROM p_device THEN
    RETURN QUERY SELECT false,'held_elsewhere', s.epoch; RETURN;
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


-- ══════════════════════════════════════════════════════════════════
-- §2 · scoring_takeover: the confirmed act
-- ══════════════════════════════════════════════════════════════════
/**
 * Take the token from another device whose lease has lapsed, over the
 * generation the person was shown (p_epoch). Anything that is not that case
 * is answered by scoring_claim() itself, so a take-over can never do more
 * than a claim except over exactly the lapse it confirms.
 */
CREATE OR REPLACE FUNCTION scoring_takeover(p_match uuid, p_device text, p_epoch integer)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s scoring_session%ROWTYPE; v_at timestamptz; v_seq bigint;
BEGIN
  -- A resume credential never takes over (db/50: it claims back only its own).
  IF app_pad_scoped() THEN RETURN QUERY SELECT false,'not_permitted',NULL::int; RETURN; END IF;
  IF p_device IS NULL OR btrim(p_device) = ''
    THEN RETURN QUERY SELECT false,'no_device',NULL::int; RETURN; END IF;
  -- Capability first, as scoring_claim() asks it: no standing, nothing learnt.
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::int; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'complete')
    THEN RETURN QUERY SELECT c.ok, c.reason, c.epoch FROM scoring_claim(p_match, p_device) c; RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF NOT FOUND OR s.state <> 'active' OR s.holder_device IS NULL
     OR s.holder_device IS NOT DISTINCT FROM p_device OR s.lease_until > now() THEN
    -- Not held elsewhere on a lapsed lease: an ordinary claim's answer,
    -- lease_active included.
    RETURN QUERY SELECT c.ok, c.reason, c.epoch FROM scoring_claim(p_match, p_device) c; RETURN;
  END IF;
  -- The person confirmed a take-over of THIS generation. Another claim since
  -- is something they have not seen.
  IF p_epoch IS DISTINCT FROM s.epoch THEN
    RETURN QUERY SELECT false,'epoch_moved', s.epoch; RETURN;
  END IF;
  -- The server's last ball as it stood at the take-over: max(server_ts),
  -- the figure match_live_score.last_ball_at reports, read here over every
  -- row whatever the caller may read (SECURITY DEFINER).
  SELECT max(b.server_ts), max(b.seq) INTO v_at, v_seq FROM ball_event b WHERE b.match_id = p_match AND b.kind = 'ball';
  UPDATE scoring_session SET
    state='active', epoch = s.epoch + 1, holder_user_id = app_user_id(),
    holder_device = p_device, lease_until = now() + interval '90 seconds',
    handover_code = NULL, handover_to = NULL, claimant_user_id = NULL,
    claimant_device = NULL, updated_at = now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, to_user, epoch, detail)
  VALUES (p_match, match_school(p_match), 'takeover', app_user_id(), s.holder_user_id, app_user_id(), s.epoch + 1,
          jsonb_build_object('from_device', s.holder_device, 'to_device', p_device,
                             'lease_lapsed_at', s.lease_until, 'last_ball_at', v_at, 'last_seq', v_seq));
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §3 · pad_resume_toss: the toss under the resume credential
-- ══════════════════════════════════════════════════════════════════
/**
 * Only under pad scope, only for the credential's match, and only while the
 * token is still this person's on this device (pad_resume_reclaim()'s rule).
 * Then the write is the person's: scoring.start asked with the pad scope
 * lifted, the row written as the toss route writes it, the scope put back.
 */
CREATE OR REPLACE FUNCTION pad_resume_toss(p_match uuid, p_won_by text, p_decision text)
RETURNS TABLE (ok boolean, reason text, won_by text, decision text, bats_first text, called_at timestamptz) AS $$
DECLARE s scoring_session%ROWTYPE; v_device text := app_device_id(); t match_toss%ROWTYPE;
BEGIN
  IF NOT app_pad_scoped() OR app_pad_match() IS DISTINCT FROM p_match THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::text, NULL::text, NULL::timestamptz; RETURN;
  END IF;
  IF NOT app_can('scoring.edit', match_school(p_match), match_team(p_match), NULL, p_match) THEN
    RETURN QUERY SELECT false, 'no_capability', NULL::text, NULL::text, NULL::text, NULL::timestamptz; RETURN;
  END IF;
  SELECT * INTO s FROM scoring_session x WHERE x.match_id = p_match FOR UPDATE;
  IF NOT FOUND OR s.state <> 'active' OR s.holder_user_id IS DISTINCT FROM app_user_id()
     OR s.holder_device IS DISTINCT FROM v_device THEN
    RETURN QUERY SELECT false, 'token_moved', NULL::text, NULL::text, NULL::text, NULL::timestamptz; RETURN;
  END IF;
  PERFORM set_config('app.scope', '', true);
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match) THEN
    PERFORM set_config('app.scope', 'pad', true);
    RETURN QUERY SELECT false, 'no_capability', NULL::text, NULL::text, NULL::text, NULL::timestamptz; RETURN;
  END IF;
  -- The toss route's own statement (services/api/write/events-api.mjs
  -- tossRoutes.record). The CHECKs refuse a bad side or decision, and the
  -- freeze trigger a toss once the match has an event (23514).
  INSERT INTO match_toss AS m (match_id, school_id, won_by, decision, called_by, called_at)
  VALUES (p_match, match_school(p_match), p_won_by, p_decision, app_user_id(), now())
  ON CONFLICT (match_id) DO UPDATE
    SET won_by = excluded.won_by, decision = excluded.decision,
        called_by = excluded.called_by, called_at = excluded.called_at
  RETURNING m.* INTO t;
  PERFORM set_config('app.scope', 'pad', true);
  RETURN QUERY SELECT true, NULL::text, t.won_by, t.decision, bats_first(t.won_by, t.decision), t.called_at;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 4 · Who may call these: the application, and nobody else ──────
-- scoring_claim keeps its grants (CREATE OR REPLACE keeps them). The two new
-- ones are scrbrd_app's alone, never PUBLIC; a managed host's API roles get
-- EXECUTE on every new function by default privilege, so it is taken back
-- (db/47's reasoning, as db/50 §9).
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['scoring_takeover(uuid,text,integer)', 'pad_resume_toss(uuid,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;

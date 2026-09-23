-- ══════════════════════════════════════════════════════════════════
--  33 · Completion ends scoring (SCRBRD-034, D3)
-- ══════════════════════════════════════════════════════════════════
--
-- A finished fixture could be scored. Not one of the token functions ever
-- read match.status: scoring_claim() handed a fresh token for a 'complete'
-- match to anyone holding scoring.start over it, a pending handover could be
-- claimed and verified on it, and scoring_lease_check() kept extending the
-- lease of a device still sending balls after the result was declared. The
-- scorecard a school has published — the one a disputed fixture is argued
-- from — stayed open to the ordinary scoring path indefinitely.
--
-- §16's line is "historically recorded as the scorer for a completed fixture
-- while no longer retaining active scoring permission". So completion ends
-- it, for everyone, whatever they hold:
--
--   scoring_claim            refuses with reason 'match_complete'
--   scoring_claim_handover   refuses with reason 'match_complete'
--   scoring_verify_takeover  refuses with reason 'match_complete'
--   scoring_lease_check      does not extend the lease, holds = false, and
--                            says why in `state` = 'match_complete'
--
-- The last one cannot grow a reason column: its shape (found, holds, epoch,
-- state) is read by the write path and the heartbeat, and the signature
-- stays. `state` is text and already the session's own word for where it
-- stands; 'match_complete' is not a session_state value, so it cannot be
-- mistaken for one. A ball that arrives after completion is therefore routed
-- to QUARANTINE by the write path (services/api/write/events-api.mjs) — not
-- lost, not merged — which is where a late ball belongs: a person decides.
--
-- WHAT DOES NOT CHANGE
-- ────────────────────
-- * Corrections to a finished match go through scoring_amendment (db/24:
--   scoring.amend.request files, somebody else approves). Nothing here touches
--   that path; the verifier (db/99) and tools/smoke-amend.mjs file one against
--   the seeded complete match.
-- * scoring_force_release() and scoring_arm_handover() are left as they are.
--   Releasing a token on a finished match is how a session left 'active' at
--   the close is tidied, and an armed handover on one goes nowhere — its
--   claim and verification are refused below.
-- * Every other refusal, its order and its reason; the signatures and return
--   shapes; the audit rows. Capability is still asked FIRST, so a caller with
--   no standing over the match learns nothing about its status.
-- * No capability or bundle moves, so generate-rls.mjs output is identical.
--
-- Each function is recreated from its LATEST definition: scoring_claim from
-- db/28, scoring_claim_handover from db/04, scoring_verify_takeover and
-- scoring_lease_check from db/02. Each carries its own search_path, because
-- CREATE OR REPLACE discards the pin db/16 set with ALTER FUNCTION.

-- ── scoring_claim (db/28 + the completion gate) ─────────────────────
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

-- ── scoring_claim_handover (db/04 + the completion gate) ───────────
CREATE OR REPLACE FUNCTION scoring_claim_handover(
  p_match uuid, p_device text, p_code text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  -- Capability against THIS match, from assignments — see db/01 and ADR 0001.
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match) THEN
    RETURN QUERY SELECT false, 'no_capability'; RETURN;
  END IF;
  -- Completion ends scoring (db/33): there is nothing left to hand over.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'complete') THEN
    RETURN QUERY SELECT false, 'match_complete'; RETURN;
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
  VALUES (p_match, match_school(p_match), 'handover_claimed', app_user_id(), s.epoch);

  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── scoring_verify_takeover (db/02 + the completion gate) ──────────
-- Confirmation values are checked against a replay of ball_event_live,
-- NOT against any stored score. See db/02 for why voids are excluded.
CREATE OR REPLACE FUNCTION scoring_verify_takeover(
  p_match uuid, p_device text, p_runs int, p_wickets int, p_balls int)
RETURNS TABLE (ok boolean, reason text, epoch integer, exp_runs int, exp_wkts int, exp_balls int) AS $$
DECLARE s scoring_session%ROWTYPE; t_runs int; t_wkts int; t_balls int;
BEGIN
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;
  -- Completion ends scoring (db/33): a takeover would hand a live token over
  -- a finished match.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'complete')
    THEN RETURN QUERY SELECT false,'match_complete',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF s.state <> 'verifying' OR s.claimant_device IS DISTINCT FROM p_device
    THEN RETURN QUERY SELECT false,'not_pending',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;

  SELECT coalesce(sum(CASE WHEN ball_type IN ('Wd','Nb') THEN 1 + coalesce(value,0)
                           ELSE coalesce(value,0) END),0),
         coalesce(sum(CASE WHEN ball_type = 'W' THEN 1 ELSE 0 END),0),
         coalesce(sum(CASE WHEN kind='ball' AND ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END),0)
    INTO t_runs, t_wkts, t_balls
  FROM ball_event_live
  WHERE match_id = p_match;

  IF (p_runs, p_wickets, p_balls) IS DISTINCT FROM (t_runs, t_wkts, t_balls) THEN
    INSERT INTO scoring_audit (match_id, school_id, event, actor_id, detail)
    VALUES (p_match, match_school(p_match), 'handover_verify_failed', app_user_id(),
            jsonb_build_object('got',jsonb_build_object('runs',p_runs,'wkts',p_wickets,'balls',p_balls),
                               'expected',jsonb_build_object('runs',t_runs,'wkts',t_wkts,'balls',t_balls)));
    RETURN QUERY SELECT false,'verify_mismatch',NULL::int, t_runs, t_wkts, t_balls; RETURN;
  END IF;

  UPDATE scoring_session SET state='active', epoch = s.epoch + 1,
    holder_user_id = s.claimant_user_id, holder_device = s.claimant_device,
    lease_until = now() + interval '90 seconds',
    handover_code=NULL, handover_to=NULL, claimant_user_id=NULL, claimant_device=NULL, updated_at=now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, to_user, epoch)
  VALUES (p_match, match_school(p_match), 'handover_complete', app_user_id(), s.holder_user_id, s.claimant_user_id, s.epoch + 1);
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1, t_runs, t_wkts, t_balls;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── scoring_lease_check (db/02 + the completion gate) ──────────────
--   found — a session row exists
--   holds — the caller is the token holder, at this epoch, with a live lease
--           AND the match is not complete
--   state — the session's state, or 'match_complete' when completion is why
--           holds is false (see the header: the shape cannot grow a reason)
CREATE OR REPLACE FUNCTION scoring_lease_check(p_match uuid, p_device text, p_epoch integer)
RETURNS TABLE (found boolean, holds boolean, epoch integer, state text) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  IF NOT app_can('scoring.edit', match_school(p_match), match_team(p_match), NULL, p_match) THEN
    RAISE EXCEPTION 'no scoring capability for this match'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The lock is still taken first: the write path relies on this call to
  -- serialise a match's writes, refused or not.
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;

  -- Completion ends scoring (db/33): no lease is extended over a finished
  -- match, so every ball sent at one goes to quarantine, not into the log.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'complete') THEN
    RETURN QUERY SELECT (s.match_id IS NOT NULL), false, s.epoch, 'match_complete'::text; RETURN;
  END IF;

  IF s.match_id IS NULL THEN
    RETURN QUERY SELECT false, false, NULL::integer, NULL::text; RETURN;
  END IF;

  IF s.state = 'active' AND s.epoch = p_epoch
     AND s.holder_user_id = app_user_id() AND s.holder_device = p_device
     AND s.lease_until > now() THEN
    UPDATE scoring_session
       SET lease_until = now() + interval '90 seconds', updated_at = now()
     WHERE match_id = p_match;
    RETURN QUERY SELECT true, true, s.epoch, s.state::text; RETURN;
  END IF;

  RETURN QUERY SELECT true, false, s.epoch, s.state::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── Assertion ──────────────────────────────────────────────────────
-- Shape, definer, pin, grant and the named refusal, for each of the four.
-- The behaviour — each refused on a complete match, the amendment request
-- still filed against one — is asserted live in db/99 against the seed.
DO $check$
DECLARE
  sig   text;
  f     oid;
  src   text;
  want  jsonb := jsonb_build_object(
    'scoring_claim(uuid,text)',
      'TABLE(ok boolean, reason text, epoch integer)',
    'scoring_claim_handover(uuid,text,text)',
      'TABLE(ok boolean, reason text)',
    'scoring_verify_takeover(uuid,text,integer,integer,integer)',
      'TABLE(ok boolean, reason text, epoch integer, exp_runs integer, exp_wkts integer, exp_balls integer)',
    'scoring_lease_check(uuid,text,integer)',
      'TABLE(found boolean, holds boolean, epoch integer, state text)');
BEGIN
  FOR sig IN SELECT jsonb_object_keys(want) LOOP
    f := to_regprocedure(sig);
    IF f IS NULL THEN RAISE EXCEPTION 'db/33: % is missing', sig; END IF;
    IF pg_get_function_result(f) IS DISTINCT FROM want->>sig THEN
      RAISE EXCEPTION 'db/33: % returns %, not the shape its callers read', sig, pg_get_function_result(f);
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f) THEN
      RAISE EXCEPTION 'db/33: % is no longer SECURITY DEFINER', sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
                    WHERE p.oid = f AND c = 'search_path=pg_catalog, public, pg_temp') THEN
      RAISE EXCEPTION 'db/33: % does not pin its search_path', sig;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/33: the application role cannot call %', sig;
    END IF;
    SELECT prosrc INTO src FROM pg_proc WHERE oid = f;
    IF src NOT LIKE '%m.status = ''complete''%' OR src NOT LIKE '%''match_complete''%' THEN
      RAISE EXCEPTION 'db/33: % does not refuse a complete match by name', sig;
    END IF;
  END LOOP;
  -- db/28's refusals survived the rewrite.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = to_regprocedure('scoring_claim(uuid,text)');
  IF src NOT LIKE '%''handover_pending'', s.epoch%' OR src NOT LIKE '%''verifying'', s.epoch%'
     OR src NOT LIKE '%''lease_active'', s.epoch%' THEN
    RAISE EXCEPTION 'db/33: scoring_claim lost a refusal db/28 gave it';
  END IF;
END $check$;

-- ════════════════════════════════════════════════════════════════
--  SCRBRD — Scoring sessions, ball events, handover
--  Postgres 15+. Companion to scoring-session.mjs.
--
--  Principle: ball_events is append-only and is the ONLY source of
--  truth. Scorecards, worms, wagon wheels and player stats are all
--  derived by replay. Nothing here stores a "current score".
-- ════════════════════════════════════════════════════════════════

-- ── Session context (set by the API on every request) ────────────
--   set_config('app.user_id',  <uuid>, true)   -- from the signed token
--   set_config('app.device_id',<text>, true)   -- from the signed token
--   set_config('app.role',     <text>, true)   -- diagnostics only
--
-- There is deliberately no app.school_id. A school is never something the
-- session tells the database; it is read from the row being touched.

-- app_user_id() and app_device_id() are defined in 01_authz.sql, alongside the
-- decision function that reads them. They are the only two facts the session
-- asserts about itself, and both are taken from a signed token.
--
-- app_role() is retained for diagnostics ONLY. Nothing in the authorization
-- path reads it: authority comes from role_assignment via app_can(), so a
-- session cannot assert a role it does not hold.
CREATE OR REPLACE FUNCTION app_role() RETURNS text AS $$
  SELECT coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$ LANGUAGE sql STABLE;

-- Which school a match belongs to. Every row written on the scoring path is
-- stamped with THIS, never with a school the session names for itself.
--
-- The distinction is not academic. The capability checks below already ask
-- app_can() about the match's own school, so a session asserting the wrong one
-- cannot write anything it could not otherwise write. But a scorer legitimately
-- assigned at two schools would have stamped their rows with whichever school
-- the token happened to carry, and a scoring_session row whose school_id
-- disagrees with its match is invisible to session_read at one school and
-- wrongly visible at the other. Deriving it closes that by construction.
--
-- SECURITY DEFINER because `match` is RLS-protected and this is called from
-- INSERT ... VALUES lists where a policy on `match` would silently yield NULL.
CREATE OR REPLACE FUNCTION match_school(p_match uuid) RETURNS uuid AS $$
  SELECT school_id FROM match WHERE id = p_match $$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Which team a match belongs to, for the same reason and with the same care.
--
-- The scoring policies below passed NULL for the team dimension, and NULL on
-- the resource NARROWS: a coach assigned to U19A could not read the ball log
-- of their own U19A match. Anchoring to the match's team is both correct and
-- tighter than the alternative — a U19A coach reads U19A, and not the U16B
-- game happening on the next field.
CREATE OR REPLACE FUNCTION match_team(p_match uuid) RETURNS text AS $$
  SELECT team_code FROM match WHERE id = p_match $$ LANGUAGE sql STABLE SECURITY DEFINER;

-- This file used to define can_score() with its own hardcoded role list — the
-- exact drift this project keeps closing: two definitions of the same rule,
-- one of which nobody remembers to update. It is gone, and so is the generated
-- version: scoring authority is app_can('scoring.edit', ...) over assignments,
-- and there is no second way to ask.

-- ── Scoring session: exactly one active token per match ──────────
CREATE TYPE session_state AS ENUM ('idle','active','handover_pending','verifying');

CREATE TABLE scoring_session (
  match_id        uuid PRIMARY KEY REFERENCES match(id) ON DELETE CASCADE,
  school_id       uuid NOT NULL REFERENCES school(id),
  state           session_state NOT NULL DEFAULT 'idle',
  epoch           integer NOT NULL DEFAULT 0,      -- bumps on every transfer
  holder_user_id  uuid REFERENCES app_user(id),
  holder_device   text,
  lease_until     timestamptz,
  handover_to     uuid REFERENCES app_user(id),    -- optional pre-authorisation
  handover_code   text,
  handover_armed_at timestamptz,
  claimant_user_id  uuid REFERENCES app_user(id),
  claimant_device   text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lease_needs_holder CHECK (state = 'idle' OR holder_user_id IS NOT NULL)
);
CREATE INDEX ON scoring_session (school_id);

-- ── Ball events: append-only log ─────────────────────────────────
CREATE TABLE ball_event (
  id              bigserial PRIMARY KEY,
  match_id        uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  school_id       uuid NOT NULL REFERENCES school(id),
  seq             integer NOT NULL,                -- authoritative, per match
  epoch           integer NOT NULL,                -- token epoch that wrote it
  innings         smallint NOT NULL DEFAULT 0,
  -- provenance: who and what device entered this ball
  scorer_user_id  uuid NOT NULL REFERENCES app_user(id),
  device_id       text NOT NULL,
  idempotency_key text NOT NULL,
  client_seq      integer NOT NULL,
  client_ts       timestamptz NOT NULL,
  server_ts       timestamptz NOT NULL DEFAULT now(),
  -- the delivery itself
  kind            text NOT NULL,                   -- ball | batters | bowler | ...
  ball_type       text,                            -- run | W | Wd | Nb | B | LB
  value           smallint,
  shot            text,
  seg             smallint,                        -- wagon-wheel segment
  zone            smallint,
  striker_id      uuid REFERENCES player(id),
  non_striker_id  uuid REFERENCES player(id),
  bowler_id       uuid REFERENCES player(id),
  dismissal       text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovered       boolean NOT NULL DEFAULT false,  -- released from quarantine
  UNIQUE (match_id, seq),
  UNIQUE (idempotency_key)                         -- makes retries safe
);
CREATE INDEX ON ball_event (match_id, seq);
CREATE INDEX ON ball_event (match_id, innings, seq);
CREATE INDEX ON ball_event (scorer_user_id);

-- Append-only: no UPDATE, no DELETE. Corrections are compensating events.
CREATE OR REPLACE FUNCTION ball_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ball_event is append-only (seq %, match %)', OLD.seq, OLD.match_id;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER ball_event_no_update BEFORE UPDATE ON ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_immutable();
CREATE TRIGGER ball_event_no_delete BEFORE DELETE ON ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_immutable();

-- ── Quarantine: events from a revoked epoch, awaiting human review ──
CREATE TABLE ball_event_quarantine (
  id              bigserial PRIMARY KEY,
  match_id        uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  school_id       uuid NOT NULL REFERENCES school(id),
  submitted_epoch integer NOT NULL,
  -- Nullable: "there is no session for this match" is a real quarantine
  -- reason the write path already emits, and in that case there is no current
  -- epoch to record. Requiring one turned a routed event into a 500.
  current_epoch   integer,
  scorer_user_id  uuid NOT NULL REFERENCES app_user(id),
  device_id       text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  body            jsonb NOT NULL,
  quarantined_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES app_user(id),
  resolution      text CHECK (resolution IN ('accepted','rejected'))
);
CREATE INDEX ON ball_event_quarantine (match_id) WHERE resolved_at IS NULL;

-- ── Handover audit ───────────────────────────────────────────────
CREATE TABLE scoring_audit (
  id          bigserial PRIMARY KEY,
  match_id    uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES school(id),
  event       text NOT NULL,      -- claim | handover_armed | handover_complete | force_release ...
  actor_id    uuid REFERENCES app_user(id),
  from_user   uuid REFERENCES app_user(id),
  to_user     uuid REFERENCES app_user(id),
  epoch       integer,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON scoring_audit (match_id, at DESC);

-- ════════════════════════════════════════════════════════════════
--  ROW-LEVEL SECURITY
--  Read is broad (live scores are public within a school context);
--  WRITE requires capability + the token + a live lease.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE ball_event            ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_session       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ball_event_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_audit         ENABLE ROW LEVEL SECURITY;

-- Reading the ball log is reading a fixture: whoever may see the match may see
-- how it is going. Scoped through app_can() like everything else, so a
-- spectator sees their school's matches and nothing beyond them.
CREATE POLICY ball_event_read ON ball_event
  FOR SELECT USING (
    app_can('fixture.read', ball_event.school_id, match_team(ball_event.match_id), NULL, ball_event.match_id)
  );

-- INSERT requires ALL of:
--   1. the scoring capability, at a scope that covers THIS match
--   2. holder of the token   (device + user match the session)
--   3. matching epoch        (not a revoked token)
--   4. a live lease          (device is alive)
--
-- (1) is app_can(), not a role the session names. The old form trusted a role
-- asserted by the session; authority now comes from the assignments the
-- database looks up for app_user_id(), so a token cannot claim its way into
-- scoring a match it has no assignment over. See docs/adr/0001.
CREATE POLICY ball_event_insert ON ball_event
  FOR INSERT WITH CHECK (
    app_can('scoring.edit', ball_event.school_id, match_team(ball_event.match_id), NULL, ball_event.match_id)
    AND scorer_user_id = app_user_id()
    AND device_id = app_device_id()
    AND EXISTS (
      SELECT 1 FROM scoring_session s
      WHERE s.match_id      = ball_event.match_id
        AND s.state         = 'active'
        AND s.holder_user_id= app_user_id()
        AND s.holder_device = app_device_id()
        AND s.epoch         = ball_event.epoch
        AND s.lease_until   > now()
    )
  );
-- No UPDATE/DELETE policies exist → append-only at the RLS layer too.

CREATE POLICY session_read ON scoring_session
  FOR SELECT USING (app_can('fixture.read', scoring_session.school_id, match_team(scoring_session.match_id), NULL, scoring_session.match_id));
-- Session transitions go through SECURITY DEFINER functions below,
-- so no direct INSERT/UPDATE policy is granted to application roles.

-- Quarantined events are a human-reconciliation queue: whoever may correct a
-- score may look at them.
CREATE POLICY quarantine_read ON ball_event_quarantine
  FOR SELECT USING (app_can('scoring.correct', ball_event_quarantine.school_id, match_team(ball_event_quarantine.match_id), NULL, ball_event_quarantine.match_id));

-- A device that arrives with a revoked epoch still has to be able to hand its
-- events over, or the reconciliation queue is empty exactly when it matters:
-- the balls stay on the phone, the scorer sees an error, and the over is lost.
-- This table had RLS enabled with only a read policy, so every quarantine
-- INSERT failed with a bare 42501 — and the write path's careful routing of
-- stale events to quarantine instead of merging them did nothing at all.
--
-- You may quarantine YOUR OWN events, from YOUR OWN device, for a match you
-- hold the scoring capability over. Not being the current token holder is the
-- whole point of the table; not being a scorer at all is not.
CREATE POLICY quarantine_insert ON ball_event_quarantine
  FOR INSERT WITH CHECK (
    app_can('scoring.edit', ball_event_quarantine.school_id, match_team(ball_event_quarantine.match_id), NULL, ball_event_quarantine.match_id)
    AND scorer_user_id = app_user_id()
    AND device_id = app_device_id()
  );

CREATE POLICY audit_read ON scoring_audit
  FOR SELECT USING (app_can('audit.read', scoring_audit.school_id,
                            match_team(scoring_audit.match_id), NULL, scoring_audit.match_id));

-- ════════════════════════════════════════════════════════════════
--  TOKEN OPERATIONS (SECURITY DEFINER — enforce the state machine)
-- ════════════════════════════════════════════════════════════════

-- Read the session under lock, and refresh the lease if the caller holds it.
--
-- The write path used to do this itself: SELECT ... FOR UPDATE on
-- scoring_session, then an UPDATE to extend the lease. Neither works, and the
-- reason is easy to miss. scoring_session deliberately has no UPDATE policy —
-- transitions go through these functions — and Postgres requires a row to
-- satisfy the UPDATE policy as well as the SELECT one before it will lock it
-- FOR UPDATE. With no UPDATE policy, the lock returns NO ROWS. The write path
-- then concluded there was no session and quarantined a live scorer's entire
-- over.
--
-- So the lock lives here, where it can be taken legitimately, and the lease is
-- extended once per request rather than once per ball.
--
--   found — a session row exists
--   holds — the caller is the token holder, at this epoch, with a live lease
--
-- A caller without scoring.edit over this match is refused outright: quarantine
-- is for a scorer whose token went stale, not for someone who never had one.
CREATE OR REPLACE FUNCTION scoring_lease_check(p_match uuid, p_device text, p_epoch integer)
RETURNS TABLE (found boolean, holds boolean, epoch integer, state text) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  IF NOT app_can('scoring.edit', match_school(p_match), match_team(p_match), NULL, p_match) THEN
    RAISE EXCEPTION 'no scoring capability for this match'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF NOT FOUND THEN
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
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION scoring_claim(p_match uuid, p_device text)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  -- Capability against THIS match, from the caller's assignments — not a role
  -- the session asserts about itself. A scorer assigned to one fixture cannot
  -- claim the token on another.
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
  UPDATE scoring_session SET
    state='active', epoch = s.epoch + 1, holder_user_id = app_user_id(),
    holder_device = p_device, lease_until = now() + interval '90 seconds',
    handover_code = NULL, handover_to = NULL, claimant_user_id = NULL,
    claimant_device = NULL, updated_at = now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, epoch)
  VALUES (p_match, match_school(p_match), 'claim', app_user_id(), s.epoch + 1);
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Arm handover. p_pending is the client's unsynced count — the gate that
-- prevents handing over while balls exist only on the outgoing device.
CREATE OR REPLACE FUNCTION scoring_arm_handover(
  p_match uuid, p_device text, p_pending int, p_ball_in_flight boolean, p_to uuid DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text, code text) AS $$
DECLARE s scoring_session%ROWTYPE; v_code text;
BEGIN
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF s.holder_device IS DISTINCT FROM p_device OR s.holder_user_id <> app_user_id()
    THEN RETURN QUERY SELECT false,'not_token_holder',NULL::text; RETURN; END IF;
  IF p_pending > 0        THEN RETURN QUERY SELECT false,'unsynced_work',NULL::text; RETURN; END IF;
  IF p_ball_in_flight     THEN RETURN QUERY SELECT false,'ball_in_flight',NULL::text; RETURN; END IF;
  v_code := lpad((abs(hashtext(p_match::text || ':' || s.epoch)) % 1000000)::text, 6, '0');
  UPDATE scoring_session SET state='handover_pending', handover_code=v_code,
    handover_to=p_to, handover_armed_at=now(), updated_at=now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, to_user, epoch)
  VALUES (p_match, match_school(p_match), 'handover_armed', app_user_id(), s.holder_user_id, p_to, s.epoch);
  RETURN QUERY SELECT true, NULL::text, v_code;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify + take over. Confirmation values are checked against a replay
-- of ball_event, NOT against any stored score.
CREATE OR REPLACE FUNCTION scoring_verify_takeover(
  p_match uuid, p_device text, p_runs int, p_wickets int, p_balls int)
RETURNS TABLE (ok boolean, reason text, epoch integer, exp_runs int, exp_wkts int, exp_balls int) AS $$
DECLARE s scoring_session%ROWTYPE; t_runs int; t_wkts int; t_balls int;
BEGIN
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF s.state <> 'verifying' OR s.claimant_device IS DISTINCT FROM p_device
    THEN RETURN QUERY SELECT false,'not_pending',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;

  SELECT coalesce(sum(CASE WHEN ball_type IN ('Wd','Nb') THEN 1 + coalesce(value,0)
                           ELSE coalesce(value,0) END),0),
         coalesce(sum(CASE WHEN ball_type = 'W' THEN 1 ELSE 0 END),0),
         coalesce(sum(CASE WHEN kind='ball' AND ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END),0)
    INTO t_runs, t_wkts, t_balls
  FROM ball_event WHERE match_id = p_match;

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
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Force-release a dead device. Only after lease + grace, only for
-- supervisory roles. Bumps the epoch so in-flight events quarantine.
CREATE OR REPLACE FUNCTION scoring_force_release(p_match uuid)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  -- Force-releasing another device's token is a supervisory act; it maps to the
  -- capability that also lets you correct a score.
  IF NOT app_can('scoring.correct', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::int; RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF s.lease_until > now() + interval '30 seconds'
    THEN RETURN QUERY SELECT false,'lease_active', s.epoch; RETURN; END IF;
  UPDATE scoring_session SET state='idle', epoch = s.epoch + 1, holder_user_id=NULL,
    holder_device=NULL, lease_until=NULL, handover_code=NULL, claimant_user_id=NULL,
    claimant_device=NULL, updated_at=now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, epoch)
  VALUES (p_match, match_school(p_match), 'force_release', app_user_id(), s.holder_user_id, s.epoch + 1);
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Derived read model (never stored) ────────────────────────────
CREATE OR REPLACE VIEW match_live_score AS
SELECT
  match_id,
  innings,
  sum(CASE WHEN ball_type IN ('Wd','Nb') THEN 1 + coalesce(value,0)
           ELSE coalesce(value,0) END)                                    AS runs,
  sum(CASE WHEN ball_type = 'W' THEN 1 ELSE 0 END)                        AS wickets,
  sum(CASE WHEN kind='ball' AND ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END) AS legal_balls,
  max(seq)                                                                AS last_seq,
  max(server_ts)                                                          AS last_ball_at
FROM ball_event
GROUP BY match_id, innings;

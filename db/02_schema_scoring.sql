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
-- the resource NARROWS: a coach assigned to 1XI could not read the ball log
-- of their own 1XI match. Anchoring to the match's team is both correct and
-- tighter than the alternative — a 1XI coach reads 1XI, and not the U16B
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
  seg             smallint,                        -- wagon-wheel segment, 0-11
  -- text, not smallint. The client has always written 'inner' / 'outer' /
  -- 'boundary' here, and a smallint column rejected every one of them —
  -- 22P02 on the whole delivery. It never surfaced because nothing in the
  -- suite sent a zone: the fakes accept any value, and the live smokes scored
  -- balls without placement. The first ball ever captured WITH a placement is
  -- the one that would have failed, in front of a scorer, mid-over.
  zone            text CHECK (zone IS NULL OR zone IN ('inner','outer','boundary')),
  striker_id      uuid REFERENCES player(id),
  non_striker_id  uuid REFERENCES player(id),
  bowler_id       uuid REFERENCES player(id),
  -- WHO is out, when it is not the striker. A run out at the non-striker's end
  -- dismisses the other batter, so attributing every wicket to whoever was on
  -- strike overstates one player's dismissals and understates the other's —
  -- which corrupts the batting average of both, permanently, in a way nothing
  -- downstream can detect. It rode in `payload` before, where a uuid and a
  -- typed opposition name were indistinguishable to SQL.
  dismissed_id    uuid REFERENCES player(id),
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
  -- A claim names the device that will hold the token. Without one the session
  -- is created with holder_device NULL, the claim returns ok and an epoch, and
  -- then EVERY ball that device sends is quarantined as 'stale_epoch_or_lease'
  -- — because scoring_lease_check compares the sending device against a NULL
  -- holder and can never match.
  --
  -- That is the worst shape a failure can take here: the scorer is told they
  -- have the match, scores an over, and the balls go silently into quarantine.
  -- Found by a smoke test that sent `deviceId` where the route reads `device`,
  -- which is exactly the typo a client integration makes.
  IF p_device IS NULL OR btrim(p_device) = ''
    THEN RETURN QUERY SELECT false,'no_device',NULL::int; RETURN; END IF;

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
  -- Holding the token is not the same as still being allowed to score. An
  -- assignment revoked mid-match takes effect on the next statement — that is
  -- the property the SECURITY DEFINER lookup was chosen for — and without this
  -- check a scorer whose access had just been withdrawn could still pass the
  -- token to someone of their choosing. Capability first, then the token.
  IF NOT app_can('scoring.edit', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::text; RETURN; END IF;
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

  -- A voided ball is not part of the match. Undo on a synced event appends a
  -- `void` naming it rather than deleting it — the log is append-only — so the
  -- row is still here and must be excluded from the count, along with the void
  -- itself. Without this, an over containing one correction makes the handover
  -- IMPOSSIBLE: the incoming device replays the log correctly, the server
  -- counts one ball more, and every verification attempt is a mismatch.
  --
  -- This used to spell that exclusion out inline, and match_live_score spelled
  -- out the same arithmetic WITHOUT it. Both read ball_event_live now, so the
  -- handover and the scoreboard cannot disagree about which balls happened.
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
--
-- ONE DEFINITION OF "THE BALLS THAT COUNT"
-- ────────────────────────────────────────
-- The log is append-only, so a correction to a synced ball is a `void` event
-- naming it rather than a deletion. Every reader of the log therefore has to
-- exclude two things: the voided ball, and the void itself. That is not a
-- detail — it is the difference between a scoreboard that reflects the
-- scorer's corrections and one that does not.
--
-- It had been written out by hand in each place that needed it, and the count
-- was wrong in one of them. `scoring_verify_takeover` excluded voids, because
-- a handover fails outright without it and the failure is loud.
-- `match_live_score` did not, because nothing fails — the score is simply
-- wrong, by exactly the runs of every corrected ball, on the screen the public
-- reads. A six undone by the scorer still read as six.
--
-- So the exclusion lives here, once, and both readers select from it. A fifth
-- fold over the log is still possible, but it can no longer be a fold that
-- silently disagrees about what a ball is.
CREATE OR REPLACE VIEW ball_event_live WITH (security_invoker = true) AS
SELECT b.*
  FROM ball_event b
 WHERE b.kind <> 'void'
   -- NOT EXISTS rather than NOT IN: NOT IN against a subquery that yields even
   -- one NULL evaluates to NULL for every row and silently returns nothing at
   -- all, which here would empty every scorecard in the platform.
   AND NOT EXISTS (
         SELECT 1 FROM ball_event v
          WHERE v.match_id = b.match_id
            AND v.kind = 'void'
            AND v.payload->>'target' = b.idempotency_key);

-- security_invoker: without it this view runs as its owner, who owns
-- ball_event and therefore bypasses the row-level policy on it — the live
-- score of every match at every school, through one SELECT. See the note in
-- generate-rls.mjs; the same trap caught the masking views.
--
-- It applies to ball_event_live too, and to this view reading it: a chain of
-- views is only as invoker-scoped as its weakest link.
CREATE OR REPLACE VIEW match_live_score WITH (security_invoker = true) AS
SELECT
  match_id,
  innings,
  sum(CASE WHEN ball_type IN ('Wd','Nb') THEN 1 + coalesce(value,0)
           ELSE coalesce(value,0) END)                                    AS runs,
  sum(CASE WHEN ball_type = 'W' THEN 1 ELSE 0 END)                        AS wickets,
  sum(CASE WHEN kind='ball' AND ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END) AS legal_balls,
  max(seq)                                                                AS last_seq,
  max(server_ts)                                                          AS last_ball_at
FROM ball_event_live
GROUP BY match_id, innings;
-- ── Career aggregates, derived (never stored) ────────────────────
--
-- SCOPE IS NOT INCIDENTAL HERE
-- ────────────────────────────
-- These read ball_event_live, which is security_invoker, so the aggregate is
-- computed over exactly the deliveries the reader may see — and two people
-- will legitimately get different career totals for the same player.
--
-- That is deliberate and it is the architecture's own rule: an aggregate leaks
-- as surely as a row, and every dashboard query including counts must receive
-- the same authorisation scope as a detailed record query. A "true" career
-- average computed over matches the reader cannot see would disclose that
-- those matches exist and how they went. So the number is scoped, and
-- `innings` comes back with it so a screen can state what it was computed
-- over rather than presenting a partial figure as a career.
--
-- Attribution comes from striker_id / bowler_id on the ball, which the scoring
-- surface stamps from the crease at the moment of delivery. Rows with a NULL
-- id are EXCLUDED, not guessed: an unattributed ball is a ball whose batter
-- SCRBRD holds no row for (an opposition player at a school that is not a
-- tenant), or one recorded before the columns were populated. Attributing it
-- to anybody would be inventing a statistic.
--
-- The conventions below mirror deriveInnings() in packages/scoring exactly —
-- see the BALL case there. Runs off the bat exclude the wide/no-ball penalty
-- and all byes; balls faced exclude wides only. tools/smoke-fold.mjs asserts
-- the two agree on real logs rather than trusting this comment.

CREATE OR REPLACE VIEW player_batting_career WITH (security_invoker = true) AS
SELECT
  b.striker_id                                              AS player_id,
  count(DISTINCT b.match_id)                                AS matches,
  -- Runs off the bat. A wide scores nothing to the batter; the one-run penalty
  -- on a wide or no-ball is the team's, not theirs; byes and leg byes are runs
  -- the batter did not make.
  coalesce(sum(CASE WHEN b.ball_type IN ('run','W','Nb')
                    THEN coalesce(b.value,0) ELSE 0 END), 0) AS runs,
  -- Balls faced. A no-ball IS faced even though it is not a legal delivery; a
  -- wide is not. Byes and leg byes are faced.
  coalesce(sum(CASE WHEN b.ball_type <> 'Wd' THEN 1 ELSE 0 END), 0) AS balls_faced,
  coalesce(sum(CASE WHEN b.ball_type IN ('run','Nb') AND b.value = 4 THEN 1 ELSE 0 END), 0) AS fours,
  coalesce(sum(CASE WHEN b.ball_type IN ('run','Nb') AND b.value = 6 THEN 1 ELSE 0 END), 0) AS sixes,
  coalesce(max(b.server_ts), NULL)                           AS last_ball_at
FROM ball_event_live b
WHERE b.kind = 'ball' AND b.striker_id IS NOT NULL
GROUP BY b.striker_id;

CREATE OR REPLACE VIEW player_bowling_career WITH (security_invoker = true) AS
SELECT
  b.bowler_id                                               AS player_id,
  count(DISTINCT b.match_id)                                AS matches,
  -- Charged to the bowler: runs off the bat, plus the penalty and any runs run
  -- off a wide or no-ball. Byes and leg byes are NOT charged.
  coalesce(sum(CASE WHEN b.ball_type IN ('Wd','Nb') THEN 1 + coalesce(b.value,0)
                    WHEN b.ball_type IN ('run','W')  THEN coalesce(b.value,0)
                    ELSE 0 END), 0)                          AS runs_conceded,
  coalesce(sum(CASE WHEN b.ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END), 0) AS legal_balls,
  coalesce(sum(CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END), 0) AS wides,
  coalesce(sum(CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END), 0) AS no_balls,
  -- Wickets credited to the bowler. A run out is not the bowler's, which is
  -- why the dismissal text is inspected rather than counting every 'W'.
  coalesce(sum(CASE WHEN b.ball_type = 'W'
                     AND coalesce(b.dismissal,'') !~* 'run ?out'
                    THEN 1 ELSE 0 END), 0)                   AS wickets
FROM ball_event_live b
WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL
GROUP BY b.bowler_id;

-- Dismissals are their own aggregate because the player who is OUT is not
-- always the striker — a run out at the non-striker's end dismisses the other
-- batter, and `dismissed` names them. Attributing every wicket to the striker
-- would overstate one player's dismissals and understate the other's, which
-- corrupts the batting average of both.
-- Per-innings batting, which is what a form guide is: the last N scores, not a
-- rolling average. Kept separate from the career totals because it is a
-- different grain — one row per player per innings they batted in — and
-- flattening it into the career view would mean either an array column or a
-- join that multiplies the totals.
CREATE OR REPLACE VIEW player_innings WITH (security_invoker = true) AS
SELECT
  b.striker_id                              AS player_id,
  b.match_id,
  b.innings,
  max(b.server_ts)                          AS ended_at,
  coalesce(sum(CASE WHEN b.ball_type IN ('run','W','Nb')
                    THEN coalesce(b.value,0) ELSE 0 END), 0) AS runs,
  coalesce(sum(CASE WHEN b.ball_type <> 'Wd' THEN 1 ELSE 0 END), 0) AS balls_faced,
  bool_or(b.ball_type = 'W' AND coalesce(b.dismissed_id, b.striker_id) = b.striker_id) AS out
FROM ball_event_live b
WHERE b.kind = 'ball' AND b.striker_id IS NOT NULL
GROUP BY b.striker_id, b.match_id, b.innings;

CREATE OR REPLACE VIEW player_dismissals WITH (security_invoker = true) AS
SELECT
  coalesce(b.dismissed_id, b.striker_id) AS player_id,
  count(*)                               AS dismissals
FROM ball_event_live b
WHERE b.kind = 'ball' AND b.ball_type = 'W'
  AND coalesce(b.dismissed_id, b.striker_id) IS NOT NULL
GROUP BY coalesce(b.dismissed_id, b.striker_id);


-- ══════════════════════════════════════════════════════════════════
--  The same fold, windowed: career figures SINCE a date
-- ══════════════════════════════════════════════════════════════════
--
-- A coach's assessment is an ANCHOR and match evidence moves the rating away
-- from it (adjustedRating in packages/scoring/src/rating.mjs). The evidence
-- that may legitimately move it is what has happened SINCE the coach last
-- looked: a judgement made in September already contains everything its author
-- saw before September, and feeding three seasons of old cricket back in
-- dilutes the fresh judgement they just made.
--
-- Lifetime totals cannot answer that, so these functions can — and the
-- conventions about what counts as a run and what counts as a ball faced are
-- NOT restated here. They live in these functions, and the lifetime views
-- below are redefined to call them with no window at all. One definition, two
-- questions asked of it. The alternative was a second copy of the same CASE
-- expressions, and this codebase has already shipped a bug where two folds over
-- the same log disagreed about a voided ball.
--
-- SECURITY INVOKER (the default, stated by omission): they read
-- ball_event_live, whose policies must apply to the caller exactly as they do
-- through the views. A SECURITY DEFINER here would hand any caller the career
-- figures of every child in the country.
--
-- p_from NULL means "no window", which is what makes one definition serve both.
CREATE OR REPLACE FUNCTION player_batting_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs bigint, balls_faced bigint, fours bigint,
               sixes bigint, last_ball_at timestamptz) AS $$
  SELECT
    count(DISTINCT b.match_id),
    -- Runs off the bat. A wide scores nothing to the batter; the one-run
    -- penalty on a wide or no-ball is the team's, not theirs; byes and leg byes
    -- are runs the batter did not make.
    coalesce(sum(CASE WHEN b.ball_type IN ('run','W','Nb')
                      THEN coalesce(b.value,0) ELSE 0 END), 0),
    -- Balls faced. A no-ball IS faced even though it is not a legal delivery;
    -- a wide is not. Byes and leg byes are faced.
    coalesce(sum(CASE WHEN b.ball_type <> 'Wd' THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.ball_type IN ('run','Nb') AND b.value = 4 THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.ball_type IN ('run','Nb') AND b.value = 6 THEN 1 ELSE 0 END), 0),
    max(b.server_ts)
  FROM ball_event_live b
  WHERE b.kind = 'ball'
    AND b.striker_id = p_player
    AND (p_from IS NULL OR b.server_ts >= p_from)
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION player_bowling_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs_conceded bigint, legal_balls bigint,
               wides bigint, no_balls bigint, wickets bigint) AS $$
  SELECT
    count(DISTINCT b.match_id),
    -- Charged to the bowler: runs off the bat, plus the penalty and any runs
    -- run off a wide or no-ball. Byes and leg byes are NOT charged.
    coalesce(sum(CASE WHEN b.ball_type IN ('Wd','Nb') THEN 1 + coalesce(b.value,0)
                      WHEN b.ball_type IN ('run','W')  THEN coalesce(b.value,0)
                      ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END), 0),
    -- A run out is not the bowler's, which is why the dismissal text is
    -- inspected rather than counting every 'W'.
    coalesce(sum(CASE WHEN b.ball_type = 'W'
                       AND coalesce(b.dismissal,'') !~* 'run ?out'
                      THEN 1 ELSE 0 END), 0)
  FROM ball_event_live b
  WHERE b.kind = 'ball'
    AND b.bowler_id = p_player
    AND (p_from IS NULL OR b.server_ts >= p_from)
$$ LANGUAGE sql STABLE;

-- The player who is OUT is not always the striker: a run out at the
-- non-striker's end dismisses the other batter, and `dismissed` names them.
CREATE OR REPLACE FUNCTION player_dismissals_since(p_player uuid, p_from timestamptz)
RETURNS bigint AS $$
  SELECT count(*)
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.ball_type = 'W'
     AND coalesce(b.dismissed_id, b.striker_id) = p_player
     AND (p_from IS NULL OR b.server_ts >= p_from)
$$ LANGUAGE sql STABLE;

-- The lifetime views, REDEFINED over the windowed functions with no window.
-- `matches > 0` reproduces exactly the row set the GROUP BY produced: a row
-- exists for a player who appears in the log and for nobody else.
CREATE OR REPLACE VIEW player_batting_career WITH (security_invoker = true) AS
SELECT p.id AS player_id, c.matches, c.runs, c.balls_faced, c.fours, c.sixes, c.last_ball_at
  FROM player p CROSS JOIN LATERAL player_batting_since(p.id, NULL) c
 WHERE c.matches > 0;

CREATE OR REPLACE VIEW player_bowling_career WITH (security_invoker = true) AS
SELECT p.id AS player_id, c.matches, c.runs_conceded, c.legal_balls,
       c.wides, c.no_balls, c.wickets
  FROM player p CROSS JOIN LATERAL player_bowling_since(p.id, NULL) c
 WHERE c.matches > 0;

CREATE OR REPLACE VIEW player_dismissals WITH (security_invoker = true) AS
SELECT p.id AS player_id, player_dismissals_since(p.id, NULL) AS dismissals
  FROM player p
 WHERE player_dismissals_since(p.id, NULL) > 0;

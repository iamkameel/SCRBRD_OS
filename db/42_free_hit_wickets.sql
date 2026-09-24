-- ══════════════════════════════════════════════════════════════════
--  42 · A wicket the free hit saved is no wicket in SQL either
-- ══════════════════════════════════════════════════════════════════
--
-- A bowler's dismissal off a free hit is recorded as it happened — a W ball,
-- the appeal, the method — and the fold saves the batter (docs/SCORING_RULES.md
-- §6 and "Product decisions, 2026-09-24", item 1; replay.mjs sets
-- `freeHitSaved` and counts nothing). Every SQL reader of ball_event counted
-- the same row as a wicket, because each of them asked only `ball_type = 'W'`:
--
--   match_live_score          the public score read one wicket more than the
--                             scorer's pad, for the rest of the innings;
--   scoring_verify_takeover   so a handover after one could never verify: the
--                             incoming device's fold says n wickets, the server
--                             expects n + 1, and every attempt is a mismatch —
--                             the same shape of failure a void caused before
--                             db/02 moved both onto ball_event_live;
--   the career readers        a dismissal against the batter (player_dismissals,
--                             player_innings.out, the breakdown), a wicket, a
--                             five-for and a hat-trick for the bowler, and a
--                             "career wickets" notice he had not earned.
--
-- THE RULE, NOT RESTATED. The fold keeps one flag, `inn.freeHit`, per
-- innings, over the deliveries that are not voided, in seq order:
--
--     a no-ball          earns a new free hit      freeHit = true
--     a wide             carries it forward        freeHit unchanged
--     a legal delivery   consumes it               freeHit = false
--     anything else      (not a ball)              freeHit unchanged
--
-- So the flag before a delivery is exactly: "the last earlier delivery in this
-- innings that was not a wide was a no-ball" — false when there is none. That
-- is ball_on_free_hit() below, one lookup, over ball_event_live, so the voided
-- balls are skipped by the one definition of "the balls that count" (db/02)
-- rather than by a second copy of it. A W ball then stands when it was not on
-- a free hit, or when its method stands on one (`standsOnFreeHit`, events.mjs
-- NON_DELIVERY: run out, handled the ball, obstructing the field, hit the ball
-- twice, timed out, retired out) — which is the six db/13's
-- dismissal_is_bowlers() already names, so the list is not written a third
-- time: a method stands on a free hit exactly when it is NOT the bowler's.
-- A NULL method is the bowler's to dismissal_is_bowlers() and does not stand
-- on a free hit, as standsOnFreeHit(null) does not.
--
-- WHY A LOOKUP AND NOT A WINDOW VIEW. The other shape was a view,
-- ball_event_live_fh, adding a window-function `free_hit` column over every
-- live ball of every innings. It gives the same answer and was not chosen:
--   - Only a W ball with a bowler's method needs the answer — perhaps one
--     row in twenty-five. ball_wicket_stands() asks nothing of any other row,
--     and asks the one it needs through the (match_id, innings, seq) index
--     db/02 created: one backward probe. A window has to sort every live ball
--     of every innings the reader can see to answer for any of them.
--   - A window blocks every filter that is not on its partition from reaching
--     the table. player_bowling_career calls player_bowling_since() once per
--     player, filtered to his bowler_id; over a window view each call would
--     rebuild the whole log's free-hit column to read one bowler's balls.
--   - A `SELECT b.*` view freezes ball_event's column list the day it is
--     created (db/07 exists because ball_event_live did exactly that).
--
-- WHAT CHANGES. The only rows read differently are W balls, of a bowler's
-- method, on a free hit. For every other row each figure is the number it
-- was: every predicate below is the old one AND ball_wicket_stands(), which
-- is true for every W row that is not one of those. A retirement marked W
-- (db/40, SCRBRD-081) is not a delivery, never on a free hit, and counts as
-- it did. Runs, balls, extras and every non-wicket figure do not move: a
-- saved W ball is still a legal ball bowled and faced, and its runs still
-- count — the fold says so too.
--
-- REPLACED, each from its latest definition with only the wicket predicate
-- changed — the name, signature, column list and types, volatility,
-- security, pinned search_path, grants and view options are as they were,
-- and the block at the end of this file checks that against a snapshot taken
-- before any of them is touched:
--
--   match_live_score              db/02  wickets
--   scoring_verify_takeover()     db/33  the wickets it expects
--   player_dismissals_since()     db/40  a saved ball dismisses nobody
--   player_innings                db/40  a saved ball does not make him out
--   player_dismissal_breakdown    db/40  nor a line in how he got out
--   player_bowling_since()        db/13  wickets (player_bowling_career follows)
--   bowler_innings_figures        db/13  wickets (the five-for reads it)
--   bowler_hat_trick              db/13  a saved ball is a legal ball that is
--                                        not a wicket, so it breaks the run
--   player_wicket_breakdown       db/26  by method
--   opposition_squad()            db/40  their dismissals and wickets
--   milestone_watch()             db/40  a saved ball fires no bowler's
--                                        milestone (the career-wickets notice
--                                        fires on `= t`, which a saved ball
--                                        would otherwise re-announce)
--
-- And, outside db/: the read API's `matchups` dismissals
-- (services/api/read/read-api.mjs), over the same function.
--
-- FOLLOW WITHOUT REPLACEMENT: broadcast_state() (over match_live_score),
-- player_bowling_career and player_dismissals (over the functions),
-- passport(), scouting_candidates() and the read API's career, form guide and
-- dismissal_breakdown (over the views).
--
-- PROVED BY: tools/smoke-free-hit.mjs (the fold and every SQL reader agree on
-- wickets per innings, per bowler and per batter over generated logs),
-- tools/smoke-handover.mjs (a handover after a saved wicket verifies) and
-- db/99 §20.

-- ── The shape of everything this file replaces, before it does ─────
-- A plain temporary table, dropped at the end of the file rather than ON
-- COMMIT: run statement by statement (psql without -1), ON COMMIT DROP would
-- take the snapshot away before the check at the end reads it.
CREATE TEMP TABLE _db42_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions),
         'acl', to_jsonb(c.relacl::text[]),
         'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND c.relname IN ('match_live_score', 'player_innings', 'player_dismissal_breakdown',
                     'bowler_innings_figures', 'bowler_hat_trick', 'player_wicket_breakdown')
UNION ALL
SELECT 'function:' || p.oid::regprocedure::text,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid),
         'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef,
         'volatility', p.provolatile,
         'config', to_jsonb(p.proconfig),
         'acl', to_jsonb(p.proacl::text[]),
         'owner', p.proowner::regrole::text,
         'language', p.prolang)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.oid::regprocedure::text IN (
         'scoring_verify_takeover(uuid,text,integer,integer,integer)',
         'player_dismissals_since(uuid,timestamp with time zone)',
         'player_bowling_since(uuid,timestamp with time zone)',
         'opposition_squad(uuid)',
         'milestone_watch()');

-- ── The rule, in SQL ─────────────────────────────────────────────

-- standsOnFreeHit() (events.mjs): NON_DELIVERY, the methods that are not the
-- bowler's. One list, db/13's, asked both questions — as the fold asks one
-- set both.
CREATE OR REPLACE FUNCTION dismissal_stands_on_free_hit(p_dismissal text)
RETURNS boolean AS $$
  SELECT NOT dismissal_is_bowlers(p_dismissal)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- `inn.freeHit` before the delivery at p_seq (replay.mjs): the last earlier
-- live delivery of this innings that was not a wide was a no-ball. A NULL
-- ball_type is a run to the fold (`ev.type ?? "run"`), a legal ball, so it
-- consumes the free hit here too: IS DISTINCT FROM, never <>, which would drop
-- the NULL row from the search and look past it.
--
-- STABLE and SECURITY INVOKER: it reads ball_event_live as whoever asks, so a
-- reader's free-hit answer is taken over exactly the balls he may see — the
-- whole innings or none of it, because ball_event is policed by match.
CREATE OR REPLACE FUNCTION ball_on_free_hit(p_match uuid, p_innings smallint, p_seq integer)
RETURNS boolean AS $$
  SELECT coalesce((
    SELECT b.ball_type IS NOT DISTINCT FROM 'Nb'
      FROM ball_event_live b
     WHERE b.match_id = p_match AND b.innings = p_innings AND b.seq < p_seq
       AND b.kind = 'ball' AND b.ball_type IS DISTINCT FROM 'Wd'
     ORDER BY b.seq DESC
     LIMIT 1), false)
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- Is this row a wicket that stands — the fold's
-- `type === W && (!wasFreeHit || standsOnFreeHit(mode))`. False for every row
-- that is not marked W. A row marked W that is not a delivery (a retirement
-- marked W, db/40) is answered as every SQL reader already answered it; the
-- fold never asks the free hit of one. The lookup runs only for a W ball
-- whose method would be saved, so no other row costs anything.
CREATE OR REPLACE FUNCTION ball_wicket_stands(p_match uuid, p_innings smallint, p_seq integer,
                                              p_kind text, p_ball_type text, p_dismissal text)
RETURNS boolean AS $$
  SELECT CASE
           WHEN p_ball_type IS DISTINCT FROM 'W'           THEN false
           WHEN p_kind IS DISTINCT FROM 'ball'             THEN true
           WHEN dismissal_stands_on_free_hit(p_dismissal)  THEN true
           ELSE NOT ball_on_free_hit(p_match, p_innings, p_seq)
         END
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- ── The live score (db/02) ───────────────────────────────────────
CREATE OR REPLACE VIEW match_live_score WITH (security_invoker = true) AS
SELECT
  match_id,
  innings,
  sum(CASE WHEN ball_type IN ('Wd','Nb') THEN 1 + coalesce(value,0)
           ELSE coalesce(value,0) END)                                    AS runs,
  sum(CASE WHEN ball_wicket_stands(match_id, innings, seq, kind, ball_type, dismissal)
           THEN 1 ELSE 0 END)                                             AS wickets,
  sum(CASE WHEN kind='ball' AND ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END) AS legal_balls,
  max(seq)                                                                AS last_seq,
  max(server_ts)                                                          AS last_ball_at
FROM ball_event_live
GROUP BY match_id, innings;

-- ── The handover check (db/33) ───────────────────────────────────
-- From db/33 with the wicket count swapped and nothing else. The incoming
-- device states the fold's wickets; this now expects the same number.
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

  -- A wicket the free hit saved is not one (db/42): the fold that the
  -- incoming device ran does not count it, so neither does this.
  SELECT coalesce(sum(CASE WHEN b.ball_type IN ('Wd','Nb') THEN 1 + coalesce(b.value,0)
                           ELSE coalesce(b.value,0) END),0),
         coalesce(sum(CASE WHEN ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                           THEN 1 ELSE 0 END),0),
         coalesce(sum(CASE WHEN b.kind='ball' AND b.ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END),0)
    INTO t_runs, t_wkts, t_balls
  FROM ball_event_live b
  WHERE b.match_id = p_match;

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

-- ── Dismissals, windowed (db/40) ─────────────────────────────────
CREATE OR REPLACE FUNCTION player_dismissals_since(p_player uuid, p_from timestamptz)
RETURNS bigint AS $$
  SELECT count(*)
    FROM ball_event_live b
   WHERE ((b.kind = 'ball' AND b.ball_type = 'W'
           AND coalesce(b.dismissed_id, b.striker_id) = p_player
           AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
          OR ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) = p_player)
     AND (p_from IS NULL OR b.server_ts >= p_from)
$$ LANGUAGE sql STABLE;

-- ── Per-innings batting (db/40) ──────────────────────────────────
-- A saved ball is still a ball he faced and runs he scored; he is not out.
CREATE OR REPLACE VIEW player_innings WITH (security_invoker = true) AS
SELECT
  x.player_id,
  x.match_id,
  x.innings,
  max(x.server_ts)                     AS ended_at,
  coalesce(sum(x.runs), 0)             AS runs,
  coalesce(sum(x.balls), 0)            AS balls_faced,
  bool_or(x.out)                       AS out
FROM (
  SELECT b.striker_id AS player_id, b.match_id, b.innings, b.server_ts,
         ball_runs_off_bat(b.ball_type, b.value, b.payload)               AS runs,
         CASE WHEN b.ball_type <> 'Wd' THEN 1 ELSE 0 END                   AS balls,
         (b.ball_type = 'W' AND coalesce(b.dismissed_id, b.striker_id) = b.striker_id
          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)) AS out
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.striker_id IS NOT NULL
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload), b.match_id, b.innings, b.server_ts,
         0, 0, true
    FROM ball_event_live b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
) x
GROUP BY x.player_id, x.match_id, x.innings;

-- ── How a boy is out, by method (db/40) ──────────────────────────
CREATE OR REPLACE VIEW player_dismissal_breakdown WITH (security_invoker = true) AS
SELECT x.player_id, x.dismissal, count(*) AS dismissals
FROM (
  SELECT coalesce(b.dismissed_id, b.striker_id) AS player_id, b.dismissal
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.ball_type = 'W'
     AND coalesce(b.dismissed_id, b.striker_id) IS NOT NULL
     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
         ball_retirement_dismissal(b.kind, b.ball_type, b.dismissal, b.payload)
    FROM ball_event_live b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
) x
GROUP BY x.player_id, x.dismissal;

-- ── Bowling, windowed (db/13) ────────────────────────────────────
CREATE OR REPLACE FUNCTION player_bowling_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs_conceded bigint, legal_balls bigint,
               wides bigint, no_balls bigint, wickets bigint) AS $$
  SELECT
    count(DISTINCT b.match_id),
    coalesce(sum(CASE WHEN b.ball_type IN ('Wd','Nb') THEN 1 + coalesce(b.value,0)
                      WHEN b.ball_type IN ('run','W')  THEN coalesce(b.value,0)
                      ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                       AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                      THEN 1 ELSE 0 END), 0)
  FROM ball_event_live b
  WHERE b.kind = 'ball'
    AND b.bowler_id = p_player
    AND (p_from IS NULL OR b.server_ts >= p_from)
$$ LANGUAGE sql STABLE;

-- ── A bowler's innings (db/13) ───────────────────────────────────
CREATE OR REPLACE VIEW bowler_innings_figures WITH (security_invoker = true) AS
SELECT b.bowler_id AS player_id, b.match_id, b.innings,
       count(*) FILTER (WHERE b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))::int AS wickets,
       coalesce(sum(CASE WHEN b.ball_type IN ('Wd','Nb') THEN 1 + coalesce(b.value,0)
                         WHEN b.ball_type IN ('run','W')  THEN coalesce(b.value,0) ELSE 0 END), 0)::int AS runs_conceded
  FROM ball_event_live b
 WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL
 GROUP BY b.bowler_id, b.match_id, b.innings;

-- ── The hat-trick (db/13) ────────────────────────────────────────
-- Three of the bowler's wickets in three consecutive legal deliveries of his.
-- A saved W ball is a legal delivery and not a wicket, so it breaks the run,
-- as a dot ball would.
CREATE OR REPLACE VIEW bowler_hat_trick WITH (security_invoker = true) AS
WITH legal AS (
  SELECT b.bowler_id, b.match_id, b.innings, b.seq,
         (b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)) AS w
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL AND b.ball_type NOT IN ('Wd','Nb')),
runs AS (
  SELECT *, lag(w, 1) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY seq) AS w1,
            lag(w, 2) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY seq) AS w2
    FROM legal)
SELECT bowler_id AS player_id, match_id, innings, min(seq)::int AS completed_at_seq
  FROM runs WHERE w AND w1 AND w2
 GROUP BY bowler_id, match_id, innings;

-- ── A bowler's wickets, by method (db/26) ────────────────────────
CREATE OR REPLACE VIEW player_wicket_breakdown WITH (security_invoker = true) AS
SELECT
  b.bowler_id AS player_id,
  b.dismissal,
  count(*) AS wickets
FROM ball_event_live b
WHERE b.kind = 'ball' AND b.ball_type = 'W'
  AND b.bowler_id IS NOT NULL
  AND dismissal_is_bowlers(b.dismissal)
  AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
GROUP BY b.bowler_id, b.dismissal;

-- ── The opposition's figures (db/40) ─────────────────────────────
-- From db/40 with the two wicket counts swapped and nothing else.
CREATE OR REPLACE FUNCTION opposition_squad(p_match uuid)
RETURNS TABLE (player_id uuid, school_id uuid, full_name text, team_code text,
               playing_role text, batting_style text, bowling_style text,
               innings integer, balls integer, runs integer, dismissals integer,
               fours integer, sixes integer, dots integer,
               strike_rate numeric, dot_pct numeric, batting_evidence text,
               balls_bowled integer, runs_conceded integer, wickets integer,
               economy numeric, bowling_evidence text) AS $$
  WITH s AS (SELECT * FROM opposition_side(p_match) WHERE open),
  squad AS (
    SELECT p.id, p.school_id, p.full_name, p.team_code, p.playing_role,
           p.batting_style, p.bowling_style
      FROM player p JOIN s ON p.school_id = s.their_school AND p.team_code = s.their_team
  ),
  bat AS (
    SELECT b.striker_id AS pid,
           count(DISTINCT b.match_id)::int AS innings,
           count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb'))::int AS balls,
           coalesce(sum(ball_runs_off_bat(b.ball_type, b.value, b.payload)),0)::int AS runs,
           count(*) FILTER (WHERE b.ball_type = 'W'
                              AND dismissal_is_bowlers(b.dismissal)
                              AND coalesce(b.dismissed_id, b.striker_id) = b.striker_id
                              AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))::int AS dismissals,
           -- A no-ball's byes or leg byes are not his boundary; everything
           -- else here counts as it did (see the note at the top of db/40).
           count(*) FILTER (WHERE b.value = 4 AND NOT (b.ball_type = 'Nb'
                              AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 0))::int AS fours,
           count(*) FILTER (WHERE b.value = 6 AND NOT (b.ball_type = 'Nb'
                              AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 0))::int AS sixes,
           count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb') AND coalesce(b.value,0) = 0)::int AS dots
      FROM ball_event_live b JOIN squad q ON q.id = b.striker_id
     WHERE b.kind = 'ball'
     GROUP BY b.striker_id
  ),
  bowl AS (
    SELECT b.bowler_id AS pid,
           count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb'))::int AS balls_bowled,
           -- What the bowler conceded: runs, wides and no-balls. Byes and leg
           -- byes are not his, which is the same split the matchups read makes.
           coalesce(sum(CASE WHEN b.ball_type IN ('run','Wd','Nb','W') THEN coalesce(b.value,0) ELSE 0 END),0)::int AS runs_conceded,
           count(*) FILTER (WHERE b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                              AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))::int AS wickets
      FROM ball_event_live b JOIN squad q ON q.id = b.bowler_id
     WHERE b.kind = 'ball'
     GROUP BY b.bowler_id
  )
  SELECT q.id, q.school_id, q.full_name, q.team_code, q.playing_role, q.batting_style, q.bowling_style,
         coalesce(bat.innings,0), coalesce(bat.balls,0), coalesce(bat.runs,0), coalesce(bat.dismissals,0),
         coalesce(bat.fours,0), coalesce(bat.sixes,0), coalesce(bat.dots,0),
         -- NULL below the evidence floor, not a number. The label beside it
         -- says why, and a screen renders an em dash.
         CASE WHEN coalesce(bat.balls,0) >= 30 THEN round(bat.runs * 100.0 / bat.balls, 1) END,
         CASE WHEN coalesce(bat.balls,0) >= 30 THEN round(bat.dots * 100.0 / bat.balls, 1) END,
         evidence_label(bat.balls),
         coalesce(bowl.balls_bowled,0), coalesce(bowl.runs_conceded,0), coalesce(bowl.wickets,0),
         CASE WHEN coalesce(bowl.balls_bowled,0) >= 30 THEN round(bowl.runs_conceded * 6.0 / bowl.balls_bowled, 2) END,
         evidence_label(bowl.balls_bowled)
    FROM squad q
    LEFT JOIN bat  ON bat.pid  = q.id
    LEFT JOIN bowl ON bowl.pid = q.id
   ORDER BY coalesce(bat.runs,0) DESC, q.full_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION opposition_squad(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opposition_squad(uuid) TO scrbrd_app;

-- ── Milestones as they happen (db/40) ────────────────────────────
-- From db/40 with the bowler's branch asking whether the wicket stood. The
-- row is already in ball_event (the trigger is AFTER INSERT), and the lookup
-- reads the balls before it. A saved ball is not a wicket, so it fires no
-- five-for, no hat-trick and — the one that mattered, because it fires on
-- `= t`, not on crossing t — no second "passes 25 career wickets".
CREATE OR REPLACE FUNCTION milestone_watch() RETURNS trigger AS $$
DECLARE v_runs int; v_before int; v_w int; v_career int; t int; v_bat int;
BEGIN
  v_bat := ball_runs_off_bat(NEW.ball_type, NEW.value, NEW.payload);
  -- The striker's innings, and his career, after this ball.
  IF NEW.striker_id IS NOT NULL AND v_bat > 0 THEN
    SELECT coalesce(runs, 0) INTO v_runs FROM player_innings
     WHERE player_id = NEW.striker_id AND match_id = NEW.match_id AND innings = NEW.innings;
    v_before := v_runs - v_bat;
    IF v_before < 50 AND v_runs >= 50 THEN PERFORM milestone_notify(NEW.striker_id, 'fifty', NEW.match_id, NEW.innings, v_runs); END IF;
    IF v_before < 100 AND v_runs >= 100 THEN PERFORM milestone_notify(NEW.striker_id, 'hundred', NEW.match_id, NEW.innings, v_runs); END IF;
    SELECT coalesce(sum(runs), 0) INTO v_career FROM player_innings WHERE player_id = NEW.striker_id;
    FOREACH t IN ARRAY ARRAY[500, 1000, 2000, 5000] LOOP
      IF v_career - v_bat < t AND v_career >= t THEN PERFORM milestone_notify(NEW.striker_id, 'career_runs', NEW.match_id, 0::smallint, t); END IF;
    END LOOP;
  END IF;
  -- The bowler's wicket — one that stood.
  IF NEW.bowler_id IS NOT NULL AND NEW.ball_type = 'W' AND dismissal_is_bowlers(NEW.dismissal)
     AND ball_wicket_stands(NEW.match_id, NEW.innings, NEW.seq, NEW.kind, NEW.ball_type, NEW.dismissal) THEN
    SELECT wickets INTO v_w FROM bowler_innings_figures
     WHERE player_id = NEW.bowler_id AND match_id = NEW.match_id AND innings = NEW.innings;
    IF v_w = 5 THEN PERFORM milestone_notify(NEW.bowler_id, 'five_for', NEW.match_id, NEW.innings, 5); END IF;
    IF EXISTS (SELECT 1 FROM bowler_hat_trick h WHERE h.player_id = NEW.bowler_id AND h.match_id = NEW.match_id
                  AND h.innings = NEW.innings AND h.completed_at_seq = NEW.seq) THEN
      PERFORM milestone_notify(NEW.bowler_id, 'hat_trick', NEW.match_id, NEW.innings, 3);
    END IF;
    SELECT coalesce(sum(wickets), 0) INTO v_career FROM bowler_innings_figures WHERE player_id = NEW.bowler_id;
    FOREACH t IN ARRAY ARRAY[25, 50, 100, 250] LOOP
      IF v_career = t THEN PERFORM milestone_notify(NEW.bowler_id, 'career_wickets', NEW.match_id, 0::smallint, t); END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── Assertion: nothing but the predicate moved ───────────────────
-- Every object above has the shape it had before this file: columns and
-- types, options (security_invoker), owner and grants for a view; arguments,
-- result, language, volatility, SECURITY DEFINER, the pinned search_path,
-- owner and grants for a function. And each now asks ball_wicket_stands().
DO $check$
DECLARE r record; now_shape jsonb; n int;
BEGIN
  SELECT count(*) INTO n FROM _db42_before;
  IF n <> 11 THEN RAISE EXCEPTION 'db/42: expected to snapshot 11 objects, found %', n; END IF;
  FOR r IN SELECT * FROM _db42_before LOOP
    IF r.obj LIKE 'view:%' THEN
      SELECT jsonb_build_object(
               'options', to_jsonb(c.reloptions),
               'acl', to_jsonb(c.relacl::text[]),
               'owner', c.relowner::regrole::text,
               'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        INTO now_shape
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relname = substr(r.obj, 6);
      IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = substr(r.obj, 6)
                        AND pg_get_viewdef(c.oid) LIKE '%ball_wicket_stands%') THEN
        RAISE EXCEPTION 'db/42: % does not ask ball_wicket_stands()', r.obj;
      END IF;
    ELSE
      SELECT jsonb_build_object(
               'result', pg_get_function_result(p.oid),
               'args', pg_get_function_arguments(p.oid),
               'definer', p.prosecdef,
               'volatility', p.provolatile,
               'config', to_jsonb(p.proconfig),
               'acl', to_jsonb(p.proacl::text[]),
               'owner', p.proowner::regrole::text,
               'language', p.prolang)
        INTO now_shape
        FROM pg_proc p WHERE p.oid = to_regprocedure(substr(r.obj, 10));
      IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(substr(r.obj, 10))
                        AND p.prosrc LIKE '%ball_wicket_stands%') THEN
        RAISE EXCEPTION 'db/42: % does not ask ball_wicket_stands()', r.obj;
      END IF;
    END IF;
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/42: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;
  -- The application role reaches the rule through the views it reads.
  IF NOT has_function_privilege('scrbrd_app', 'ball_wicket_stands(uuid,smallint,integer,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'ball_on_free_hit(uuid,smallint,integer)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'dismissal_stands_on_free_hit(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/42: the application role cannot call the free-hit rule its views ask';
  END IF;
END $check$;

DROP TABLE _db42_before;

-- ══════════════════════════════════════════════════════════════════
--  40 · A player's SQL figures follow the fold (SCRBRD-068, SCRBRD-081)
-- ══════════════════════════════════════════════════════════════════
--
-- Two changes to what the pad records, made in packages/scoring, left every
-- SQL reader of a player's figures behind the device's fold:
--
--   SCRBRD-081  Retired out and timed out are no longer W DELIVERIES. The pad
--               records them as a `retire` event marked ball_type 'W' with the
--               canonical dismissal, the batter in payload.batter. Every view
--               below read `kind = 'ball'`, so from the day the new pad ships,
--               a boy retired out or timed out was out on the scorecard and
--               NOT out in his career: no dismissal, no innings, a batting
--               average computed as if the innings never ended.
--   SCRBRD-068  A no-ball records byes or leg byes run off it in
--               payload.nbRuns, beside a `value` that stays the runs
--               completed. Every view below credited a no-ball's `value` to
--               the striker — his runs, and a four or a six when it was four
--               or six — so four byes off a no-ball were a boundary to him.
--
-- The rule is not restated from memory. runsOffBat() in
-- packages/scoring/src/events.mjs is the one rule for whose runs, and
-- retirementDismissal() in replay.mjs decides which retirement is a wicket;
-- the functions at the top of this file are those two, in SQL (and who the
-- retirement dismissed), and every reader below asks them rather than
-- writing its own CASE. The read API's
-- matchups already asked the first (OFF_THE_BAT_SQL in read-api.mjs); it is
-- the same predicate.
--
-- WHAT EACH READER NOW DOES (the Laws table in docs/SCORING_RULES.md):
--
--   A no-ball's byes / leg byes    not the batter's runs, fours or sixes;
--                                  still a ball he faced; still every run
--                                  debited to the bowler (1 + value).
--   Retired out / timed out        a dismissal of payload.batter, an innings
--   (retire marked W)              for him (0 runs, 0 balls, out), and no
--                                  bowler's wicket, no ball, no over.
--
-- OLD ROWS ARE NOT REREAD. A no-ball with no nbRuns is off the bat, which is
-- what every one recorded before SCRBRD-068 was, and scores exactly as it
-- did. A W DELIVERY naming timed_out or retired_out — the pad's shape until
-- SCRBRD-081 — is still what it was: a ball faced, a dismissal of whoever it
-- names, never the bowler's (dismissal_is_bowlers(), db/13). A `retire` with
-- no W marker (retired hurt, or a retired out from before the marker) is
-- still no wicket, as in the fold. Nothing here matches any row written
-- before either change, so every figure over those rows is the number it was.
--
-- REPLACED, each from its latest definition with only the rule swapped — the
-- name, signature, column list and types, volatility, security, pinned
-- search_path and view options are as they were (CREATE OR REPLACE VIEW
-- replaces the options, so security_invoker is restated; CREATE OR REPLACE
-- FUNCTION replaces the SET clause, so the pin db/16 checks is restated):
--
--   player_batting_since()      db/02  runs, fours, sixes off the bat; a
--                                      non-ball wicket is an innings (matches)
--   player_dismissals_since()   db/02  + non-ball wickets of this player
--   player_innings              db/02  runs off the bat; + a row for a
--                                      non-ball wicket (0 runs, 0 balls, out)
--   player_dismissal_breakdown  db/26  + non-ball wickets, by method
--   opposition_squad()          db/13  runs, fours, sixes: a no-ball's byes
--                                      are not the batter's
--   milestone_watch()           db/13  a fifty is reached by runs off the bat
--
-- FOLLOW WITHOUT REPLACEMENT: player_batting_career, player_dismissals (db/02,
-- over the two functions), player_milestone, passport(), scouting_candidates()
-- and the read API's career, form guide and dismissal_breakdown (over the
-- views). CHECKED AND UNCHANGED, because both rules already hold there:
-- player_bowling_since(), bowler_innings_figures, player_wicket_breakdown and
-- bowler_hat_trick read `kind = 'ball'`, so a retire is nobody's wicket and no
-- ball of anybody's, and they charge a no-ball 1 + value whoever's runs they
-- were; bowler_over/bowler_spell count legal balls; match_live_score and
-- scoring_verify_takeover already count a retire marked W as a wicket that is
-- not a ball (SCRBRD-081's design) and a no-ball's runs as the side's.
--
-- NOT FIXED HERE, found while checking (older than either change, so moving
-- them would move old figures; noted in the backlog):
--   - a W ball on a free hit that the fold saves (standsOnFreeHit) is still a
--     wicket to every SQL reader, the live score and the handover check too;
--   - player_innings files a run out at the non-striker's end on nobody's
--     innings row as `out` (he was not the striker of that ball);
--   - opposition_squad's `balls` excludes no-balls, its fours/sixes count
--     byes and wides worth four or six, and its runs_conceded leaves out the
--     one-run penalty.

-- ── The two rules, in SQL ────────────────────────────────────────

-- runsOffBat() (events.mjs): a run or a wicket ball's value is the striker's;
-- a no-ball's is unless payload.nbRuns says byes or leg byes; nothing else
-- is. A NULL ball_type scores nothing to the batter here, as it always has in
-- SQL (the constructor never writes one; ball() defaults to 'run').
CREATE OR REPLACE FUNCTION ball_runs_off_bat(p_ball_type text, p_value integer, p_payload jsonb)
RETURNS integer AS $$
  SELECT CASE
           WHEN p_ball_type IN ('run', 'W') THEN coalesce(p_value, 0)
           WHEN p_ball_type = 'Nb'
                AND coalesce(p_payload->>'nbRuns', '') NOT IN ('byes', 'leg_byes') THEN coalesce(p_value, 0)
           ELSE 0
         END
$$ LANGUAGE sql IMMUTABLE;

-- retirementDismissal() (replay.mjs): a `retire` is a wicket exactly when it
-- is marked ball_type 'W', and then it is retired out or timed out — the
-- dismissal column, or the reason standing in for one it does not spell out.
-- NULL for every other row, so it can be asked of any row of ball_event.
CREATE OR REPLACE FUNCTION ball_retirement_dismissal(p_kind text, p_ball_type text, p_dismissal text, p_payload jsonb)
RETURNS text AS $$
  SELECT CASE
           WHEN p_kind = 'retire' AND p_ball_type = 'W'
                AND coalesce(p_dismissal, CASE p_payload->>'reason' WHEN 'out' THEN 'retired_out'
                                                                    WHEN 'timed_out' THEN 'timed_out' END)
                    IN ('retired_out', 'timed_out')
           THEN coalesce(p_dismissal, CASE p_payload->>'reason' WHEN 'out' THEN 'retired_out'
                                                                WHEN 'timed_out' THEN 'timed_out' END)
         END
$$ LANGUAGE sql IMMUTABLE;

-- Who a non-ball wicket dismissed: payload.batter, when it is a player id.
-- The event has no column for him (toRow() carries `batter` in the payload),
-- and an opposition batter SCRBRD holds no row for is a typed name there —
-- not attributable, so NULL, never a cast error.
CREATE OR REPLACE FUNCTION ball_retired_batter(p_kind text, p_ball_type text, p_dismissal text, p_payload jsonb)
RETURNS uuid AS $$
  SELECT CASE
           WHEN ball_retirement_dismissal(p_kind, p_ball_type, p_dismissal, p_payload) IS NOT NULL
                AND p_payload->>'batter' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN (p_payload->>'batter')::uuid
         END
$$ LANGUAGE sql IMMUTABLE;

-- ── Batting, windowed (db/02) ────────────────────────────────────
-- Runs, fours and sixes off the bat. Balls faced unchanged: a no-ball is
-- faced whoever's its runs were, a wide is not. A non-ball wicket is an
-- innings he played — `matches` counts it, as player_innings has a row for it
-- — with no run and no ball in it.
CREATE OR REPLACE FUNCTION player_batting_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs bigint, balls_faced bigint, fours bigint,
               sixes bigint, last_ball_at timestamptz) AS $$
  SELECT
    count(DISTINCT b.match_id),
    coalesce(sum(CASE WHEN b.kind = 'ball' THEN ball_runs_off_bat(b.ball_type, b.value, b.payload)
                      ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.kind = 'ball' AND b.ball_type <> 'Wd' THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.kind = 'ball' AND b.ball_type IN ('run','Nb')
                       AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.kind = 'ball' AND b.ball_type IN ('run','Nb')
                       AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END), 0),
    max(b.server_ts)
  FROM ball_event_live b
  WHERE ((b.kind = 'ball' AND b.striker_id = p_player)
         OR ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) = p_player)
    AND (p_from IS NULL OR b.server_ts >= p_from)
$$ LANGUAGE sql STABLE;

-- ── Dismissals, windowed (db/02) ─────────────────────────────────
-- A wicket ball dismisses whoever it names (the striker by default), as
-- before; a retirement marked W dismisses payload.batter.
CREATE OR REPLACE FUNCTION player_dismissals_since(p_player uuid, p_from timestamptz)
RETURNS bigint AS $$
  SELECT count(*)
    FROM ball_event_live b
   WHERE ((b.kind = 'ball' AND b.ball_type = 'W'
           AND coalesce(b.dismissed_id, b.striker_id) = p_player)
          OR ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) = p_player)
     AND (p_from IS NULL OR b.server_ts >= p_from)
$$ LANGUAGE sql STABLE;

-- ── Per-innings batting (db/02) ──────────────────────────────────
-- One row per player per innings he batted in. A timed-out batter never
-- faced a ball and had no row; he has one now — 0 (0), out — which is his
-- innings on the scorecard, and what a form guide and an average count.
-- `out` for a wicket ball keeps db/02's rule exactly.
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
         (b.ball_type = 'W' AND coalesce(b.dismissed_id, b.striker_id) = b.striker_id) AS out
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.striker_id IS NOT NULL
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload), b.match_id, b.innings, b.server_ts,
         0, 0, true
    FROM ball_event_live b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
) x
GROUP BY x.player_id, x.match_id, x.innings;

-- ── How a boy is out, by method (db/26) ──────────────────────────
-- Retired out and timed out are how he got out, whoever's figure they are
-- not — the same reason db/26 keeps a run out on this side.
CREATE OR REPLACE VIEW player_dismissal_breakdown WITH (security_invoker = true) AS
SELECT x.player_id, x.dismissal, count(*) AS dismissals
FROM (
  SELECT coalesce(b.dismissed_id, b.striker_id) AS player_id, b.dismissal
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.ball_type = 'W'
     AND coalesce(b.dismissed_id, b.striker_id) IS NOT NULL
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
         ball_retirement_dismissal(b.kind, b.ball_type, b.dismissal, b.payload)
    FROM ball_event_live b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
) x
GROUP BY x.player_id, x.dismissal;

-- ── The opposition's figures (db/13) ─────────────────────────────
-- From db/13 with the batter's runs, fours and sixes asking whose the runs
-- were. Its dismissals already count only the bowler's (dismissal_is_bowlers),
-- which a retirement never is, so they need no change; the bowling side
-- charges a no-ball's value whoever's it was, as the Laws say.
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
                              AND coalesce(b.dismissed_id, b.striker_id) = b.striker_id)::int AS dismissals,
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
           count(*) FILTER (WHERE b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal))::int AS wickets
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

-- ── Milestones as they happen (db/13) ────────────────────────────
-- From db/13 with one change: the ball moves the striker's score by its runs
-- off the bat, not by its value. Reading player_innings (now off the bat) and
-- subtracting the value would put a boy on 51 who ran two no-ball byes back
-- on 49 and announce his fifty a second time. For every row without nbRuns
-- the two are the same number, so nothing old fires differently.
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
  -- The bowler's wicket.
  IF NEW.bowler_id IS NOT NULL AND NEW.ball_type = 'W' AND dismissal_is_bowlers(NEW.dismissal) THEN
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

-- ══════════════════════════════════════════════════════════════════
--  13 · How a batter is out: a closed vocabulary
-- ══════════════════════════════════════════════════════════════════
--
-- ball_event.dismissal was free text, and the law that a run out is not the
-- bowler's wicket was a regular expression over it — in the reducer, in
-- player_bowling_since() here, and in a read query — three copies, and only
-- the scorer's own spellings satisfied all of them. "r/o", "run-out" and
-- "timed-out" credited the bowler.
--
-- The vocabulary is packages/scoring DISMISSAL (the eleven in the Laws), and
-- the API now refuses a wicket outside it. This file brings the rows that are
-- already here into line, forbids new ones outside the list, and moves the
-- SQL copy of the law onto the same set the reducer reads.

-- 1. Normalise what is already recorded. ball_event is append-only by
--    trigger; this is the one time it is edited, by the owner, in a
--    migration, and the trigger is put back before the file ends.
ALTER TABLE ball_event DISABLE TRIGGER ball_event_no_update;
UPDATE ball_event SET dismissal = CASE
  WHEN lower(dismissal) ~ '^(run[ _-]?out|r/?o)$'                                    THEN 'run_out'
  WHEN lower(dismissal) ~ '^(stumped|st)$'                                             THEN 'stumped'
  WHEN lower(dismissal) ~ '^(caught|c|ct|caught (and|&) bowled|c&b)$'                  THEN 'caught'
  WHEN lower(dismissal) ~ '^(bowled|b)$'                                               THEN 'bowled'
  WHEN lower(dismissal) ~ '^(lbw|leg before( wicket)?)$'                               THEN 'lbw'
  WHEN lower(dismissal) ~ '^(hit[ _-]?wicket|hw)$'                                     THEN 'hit_wicket'
  WHEN lower(dismissal) ~ '^(handled([ _-]the)?[ _-]?ball|handled)$'                   THEN 'handled_ball'
  WHEN lower(dismissal) ~ '^(obstruct(ing|ed)?([ _-]the)?[ _-]?field|obstruction)$'    THEN 'obstructing_field'
  WHEN lower(dismissal) ~ '^timed[ _-]?out$'                                           THEN 'timed_out'
  WHEN lower(dismissal) ~ '^retired([ _-]?out)?$'                                      THEN 'retired_out'
  WHEN lower(dismissal) ~ '^(hit([ _-]the)?([ _-]ball)?[ _-]?twice|double[ _-]?hit)$'  THEN 'hit_twice'
  ELSE dismissal END
 WHERE dismissal IS NOT NULL AND dismissal NOT IN ('bowled','caught','lbw','run_out','stumped','hit_wicket','handled_ball','obstructing_field','timed_out','retired_out','hit_twice');
ALTER TABLE ball_event ENABLE TRIGGER ball_event_no_update;

-- 2. Forbid new rows outside the list. NOT VALID so a row this file could not
--    read is reported rather than blocking the migration; validated at once
--    when there is none.
ALTER TABLE ball_event ADD CONSTRAINT ball_event_dismissal_known CHECK (
  dismissal IS NULL OR dismissal IN ('bowled','caught','lbw','run_out','stumped','hit_wicket','handled_ball','obstructing_field','timed_out','retired_out','hit_twice')
) NOT VALID;
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT match_id, seq, dismissal FROM ball_event
            WHERE dismissal IS NOT NULL AND dismissal NOT IN ('bowled','caught','lbw','run_out','stumped','hit_wicket','handled_ball','obstructing_field','timed_out','retired_out','hit_twice')
  LOOP
    n := n + 1;
    RAISE WARNING 'ball_event match % seq % says "%" — not a dismissal this platform knows; the constraint stays NOT VALID until it is corrected', r.match_id, r.seq, r.dismissal;
  END LOOP;
  IF n = 0 THEN
    ALTER TABLE ball_event VALIDATE CONSTRAINT ball_event_dismissal_known;
  END IF;
END $$;

-- 3. ONE predicate for SQL. The law lived as a regex in six places here —
--    player_bowling_since, opposition_squad, bowler_innings_figures,
--    bowler_hat_trick, milestone_watch and a read query — and the regex
--    "run ?out" does not even match the canonical "run_out": the moment the
--    vocabulary closed, a run out became a five-for. Every one of them now
--    asks this function, which holds the same six the reducer's NON_DELIVERY
--    holds.
CREATE OR REPLACE FUNCTION dismissal_is_bowlers(p_dismissal text) RETURNS boolean AS $$
  SELECT coalesce(p_dismissal,'') NOT IN ('run_out','handled_ball','obstructing_field',
                                          'timed_out','retired_out','hit_twice')
$$ LANGUAGE sql IMMUTABLE;

-- 3a. player_bowling_since — same signature, so the views over it
--     (player_bowling_career) need no change.
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
                      THEN 1 ELSE 0 END), 0)
  FROM ball_event_live b
  WHERE b.kind = 'ball'
    AND b.bowler_id = p_player
    AND (p_from IS NULL OR b.server_ts >= p_from)
$$ LANGUAGE sql STABLE;

-- 3b. The four in db/08, re-created over the same predicate. Copied from the
--     file that already ran rather than rewritten, so nothing else moves.
-- opposition_squad() — db/08 lines 4539-4594, the predicate swapped and nothing else.
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
           coalesce(sum(CASE WHEN b.ball_type IN ('run','W','Nb') THEN coalesce(b.value,0) ELSE 0 END),0)::int AS runs,
           count(*) FILTER (WHERE b.ball_type = 'W'
                              AND dismissal_is_bowlers(b.dismissal)
                              AND coalesce(b.dismissed_id, b.striker_id) = b.striker_id)::int AS dismissals,
           count(*) FILTER (WHERE b.value = 4)::int AS fours,
           count(*) FILTER (WHERE b.value = 6)::int AS sixes,
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
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- bowler_innings_figures — db/08 lines 5590-5601, the predicate swapped and nothing else.
CREATE OR REPLACE VIEW bowler_innings_figures WITH (security_invoker = true) AS
SELECT b.bowler_id AS player_id, b.match_id, b.innings,
       count(*) FILTER (WHERE b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal))::int AS wickets,
       coalesce(sum(CASE WHEN b.ball_type IN ('Wd','Nb') THEN 1 + coalesce(b.value,0)
                         WHEN b.ball_type IN ('run','W')  THEN coalesce(b.value,0) ELSE 0 END), 0)::int AS runs_conceded
  FROM ball_event_live b
 WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL
 GROUP BY b.bowler_id, b.match_id, b.innings;

-- A hat-trick is three wickets in three consecutive LEGAL deliveries by one
-- bowler in one innings; a wide or a no-ball in between is not a delivery
-- and does not break it. Run-outs are not the bowler's.

-- bowler_hat_trick — db/08 lines 5602-5615, the predicate swapped and nothing else.
CREATE OR REPLACE VIEW bowler_hat_trick WITH (security_invoker = true) AS
WITH legal AS (
  SELECT b.bowler_id, b.match_id, b.innings, b.seq,
         (b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)) AS w
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL AND b.ball_type NOT IN ('Wd','Nb')),
runs AS (
  SELECT *, lag(w, 1) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY seq) AS w1,
            lag(w, 2) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY seq) AS w2
    FROM legal)
SELECT bowler_id AS player_id, match_id, innings, min(seq)::int AS completed_at_seq
  FROM runs WHERE w AND w1 AND w2
 GROUP BY bowler_id, match_id, innings;


-- milestone_watch() — db/08 lines 5721-5751, the predicate swapped and nothing else.
CREATE OR REPLACE FUNCTION milestone_watch() RETURNS trigger AS $$
DECLARE v_runs int; v_before int; v_w int; v_career int; t int;
BEGIN
  -- The striker's innings, and his career, after this ball.
  IF NEW.striker_id IS NOT NULL AND NEW.ball_type IN ('run', 'W', 'Nb') AND coalesce(NEW.value, 0) > 0 THEN
    SELECT coalesce(runs, 0) INTO v_runs FROM player_innings
     WHERE player_id = NEW.striker_id AND match_id = NEW.match_id AND innings = NEW.innings;
    v_before := v_runs - NEW.value;
    IF v_before < 50 AND v_runs >= 50 THEN PERFORM milestone_notify(NEW.striker_id, 'fifty', NEW.match_id, NEW.innings, v_runs); END IF;
    IF v_before < 100 AND v_runs >= 100 THEN PERFORM milestone_notify(NEW.striker_id, 'hundred', NEW.match_id, NEW.innings, v_runs); END IF;
    SELECT coalesce(sum(runs), 0) INTO v_career FROM player_innings WHERE player_id = NEW.striker_id;
    FOREACH t IN ARRAY ARRAY[500, 1000, 2000, 5000] LOOP
      IF v_career - NEW.value < t AND v_career >= t THEN PERFORM milestone_notify(NEW.striker_id, 'career_runs', NEW.match_id, 0::smallint, t); END IF;
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
END $$ LANGUAGE plpgsql SECURITY DEFINER;

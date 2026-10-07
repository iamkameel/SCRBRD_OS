-- ══════════════════════════════════════════════════════════════════
--  87 · A wicket on a wide or a no-ball (Law 22.9, Law 21.17)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel chose to fix it before the 12 October freeze. The
-- event, the fold and the Laws are packages/scoring (events.mjs
-- isWicketBall(), WIDE_DISMISSALS, NO_BALL_DISMISSALS; replay.mjs; laws.mjs
-- not_out_off_wide, not_out_off_no_ball); this file is what SQL needs of
-- them, and agrees with the fold by construction: tools/smoke-fold-figures.mjs
-- holds every figure here to the fold over generated logs with wickets on
-- wides and no-balls, and db/99 §66 proves it under the application role.
--
-- THE DEFECT. A wicket was its own delivery type, W, and a W is a legal
-- ball. A scorer had no correct way to record a run out off a no-ball, or a
-- stumping or run out off a wide: whatever he wrote counted a ball the over
-- did not have, or lost the wicket, or gave the bowler a ball he did not
-- bowl.
--
-- THE RULE. A wide or a no-ball may carry the dismissals the Laws allow off
-- it, and no others:
--   Law 22.9  out from a Wide:    run out, stumped, hit wicket, obstructing
--                                 the field;
--   Law 21.17 out from a No ball: run out, hit the ball twice, obstructing
--                                 the field (21.18 in the 3rd Edition).
-- The row stays what it was bowled as ('Wd' or 'Nb'), its `dismissal` the
-- method: its penalty run and runs are that extra's, it is no ball of the
-- over, a no-ball is a ball faced and a wide is not, and a no-ball is still
-- followed by a free hit. The wicket counts for the side, falls in the fall
-- of wickets, and is the bowler's only when it is his (dismissal_is_bowlers():
-- stumped, hit wicket). On a free hit the bowler's own dismissals do not
-- stand (ball_on_free_hit() already reads a wide on a free hit as on it).
-- Handled the ball is in neither list: since the 2017 Code it is out
-- Obstructing the field.
--
-- WHAT IS HERE.
--
--   ball_is_wicket(type, dismissal)   isWicketBall(): a W, or a wide or a
--                                     no-ball whose dismissal the Law allows
--                                     off it. The one question; every reader
--                                     below asks it where it asked
--                                     `ball_type = 'W'`.
--   ball_wicket_stands()              db/42's, asking it first. The live
--                                     score, the handover's count, the
--                                     folded innings score and the result
--                                     read the wicket through this alone,
--                                     and need nothing else.
--   the career readers                each re-emitted exactly as db/71 left
--                                     it, `ball_type = 'W'` in a wicket's
--                                     place read as ball_is_wicket(): the
--                                     batting innings, careers, seasons and
--                                     windows (who is out); the bowling
--                                     careers, seasons, windows, innings
--                                     figures and wicket breakdown (whose
--                                     wicket); the dismissals and their
--                                     breakdown; opposition_squad();
--                                     keeper_dismissal (a stumping off a wide
--                                     is the keeper's); milestone_watch() (a
--                                     stumping off a wide can be a five-for).
--   ball_event_stumped_by_keeper()    db/68's door, asking the same question:
--                                     a stumping off a wide is the keeper's.
--   ball_event_out_off_extra          the door: a new wide or no-ball naming
--                                     a way out the Law does not allow off it
--                                     is refused (23514), as the Laws refuse
--                                     it at commit. What is already stored is
--                                     counted and named, not refused.
--
-- NOT CHANGED. bowler_hat_trick reads the balls of the over alone (db/54,
-- 17.3.2.5): a wicket on a wide or a no-ball neither makes a hat-trick nor
-- breaks one, as the commentary's hat-trick line reads it too. The runs, the
-- balls of the over, balls faced, boundaries and the free hit are each the
-- extra's, exactly as before; nothing here moves them.
--
-- A ROW STORED BEFORE. No client wrote a dismissal on a wide or a no-ball;
-- a hand-written request could. Such a row with a way out the Law allows is
-- read as a wicket from here on, by the fold and by SQL alike; one with any
-- other method stays no wicket, as every fold before read it. §4 names how
-- many of each a database holds when this file runs.
--
-- RLS. Nothing new is granted. ball_is_wicket() is a rule over two values,
-- with PostgreSQL's default EXECUTE, as dismissal_is_bowlers() is. Every
-- re-emitted object keeps its owner, options, columns and grants (checked at
-- the end against a snapshot taken first); the definers keep their pinned
-- search_path.

-- ── 0 · The shape of everything replaced, before it is ──────────────
DROP TABLE IF EXISTS _db87_before;
CREATE TEMP TABLE _db87_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions), 'acl', to_jsonb(c.relacl::text[]), 'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND c.relname IN ('player_innings', 'player_batting_career', 'player_batting_by_season',
                     'player_bowling_career', 'player_bowling_by_season', 'bowler_innings_figures',
                     'player_wicket_breakdown', 'player_dismissals', 'player_dismissals_by_season',
                     'player_dismissal_breakdown', 'keeper_dismissal')
UNION ALL
SELECT 'function:' || p.oid::regprocedure::text,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef, 'volatility', p.provolatile, 'parallel', p.proparallel, 'strict', p.proisstrict,
         'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
         'language', p.prolang)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.oid::regprocedure::text IN ('ball_wicket_stands(uuid,smallint,integer,text,text,text)',
                                     'player_batting_since(uuid,timestamp with time zone)',
                                     'player_bowling_since(uuid,timestamp with time zone)',
                                     'player_dismissals_since(uuid,timestamp with time zone)',
                                     'opposition_squad(uuid)', 'milestone_watch()', 'ball_event_stumped_by_keeper()');

-- ── 1 · The question ─────────────────────────────────────────────────

-- isWicketBall() (events.mjs): a W; or a wide whose dismissal is run out,
-- stumped, hit wicket or obstructing the field (Law 22.9); or a no-ball whose
-- dismissal is run out, hit the ball twice or obstructing the field (Law
-- 21.17). Never NULL: a row with no type or no method is no wicket off an
-- extra. The dismissal is canonical (db/13's ball_event_dismissal_known).
CREATE OR REPLACE FUNCTION ball_is_wicket(p_ball_type text, p_dismissal text) RETURNS boolean AS $$
  SELECT coalesce(p_ball_type = 'W'
                  OR (p_ball_type = 'Wd' AND p_dismissal IN ('run_out', 'stumped', 'hit_wicket', 'obstructing_field'))
                  OR (p_ball_type = 'Nb' AND p_dismissal IN ('run_out', 'hit_twice', 'obstructing_field')),
                  false)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- ── 2 · Whether it stands ────────────────────────────────────────────
-- db/42's, with ball_is_wicket() where it asked for a W. A wicket on a wide
-- or a no-ball stands as a W does: always, unless it is the bowler's and the
-- delivery was a free hit (a wide on a free hit is on it, ball_on_free_hit()).
CREATE OR REPLACE FUNCTION ball_wicket_stands(p_match uuid, p_innings smallint, p_seq integer,
                                              p_kind text, p_ball_type text, p_dismissal text)
RETURNS boolean AS $$
  SELECT CASE
           WHEN NOT ball_is_wicket(p_ball_type, p_dismissal) THEN false
           WHEN p_kind IS DISTINCT FROM 'ball'             THEN true
           WHEN dismissal_stands_on_free_hit(p_dismissal)  THEN true
           ELSE NOT ball_on_free_hit(p_match, p_innings, p_seq)
         END
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- ── 3 · The career readers ──────────────────────────────────────────
-- Each exactly as its latest file has it, but for `ball_type = 'W'` in a
-- wicket's place, now ball_is_wicket(): the same rows, the same columns,
-- the same grants; a wicket on a wide or a no-ball read as the fold reads
-- it. Nothing that reads runs, balls or boundaries moved.

-- player_innings: db/71's, `ball_type = 'W'` read as ball_is_wicket().
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
         (ball_is_wicket(b.ball_type, b.dismissal)
          AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT DISTINCT FROM b.striker_id
          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)) AS out
    FROM ball_event_career b
   WHERE b.kind = 'ball' AND b.striker_id IS NOT NULL
  UNION ALL
  SELECT ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload), b.match_id, b.innings, b.server_ts,
         0, 0, true
    FROM ball_event_career b
   WHERE b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT NULL
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS DISTINCT FROM b.striker_id
     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload), b.match_id, b.innings, b.server_ts,
         0, 0, true
    FROM ball_event_career b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
) x
GROUP BY x.player_id, x.match_id, x.innings
UNION ALL
SELECT s.player_id, s.match_id, s.innings, s.played_at, s.runs::bigint, s.balls::bigint, s.is_dismissal
  FROM summary_batting_line s
 WHERE s.player_id IS NOT NULL;

-- player_batting_career: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE VIEW player_batting_career WITH (security_invoker = true) AS
SELECT x.player_id,
       count(DISTINCT x.match_id)                                                 AS matches,
       coalesce(sum(x.runs), 0)                                                   AS runs,
       sum(x.balls)                                                               AS balls_faced,
       sum(x.fours)                                                               AS fours,
       sum(x.sixes)                                                               AS sixes,
       max(x.at)                                                                  AS last_ball_at
  FROM (
    SELECT who.player_id, b.match_id,
           CASE WHEN who.faced THEN ball_runs_off_bat(b.ball_type, b.value, b.payload) ELSE 0 END AS runs,
           CASE WHEN who.faced AND b.ball_type <> 'Wd' THEN 1 ELSE 0 END AS balls,
           CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END AS fours,
           CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END AS sixes,
           b.server_ts AS at
      FROM ball_event_career b
      -- db/44's three arms, NULLIF'd so a row counts once per player as the
      -- function's OR does (db/49).
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' THEN b.striker_id END, true),
        (CASE WHEN b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
              THEN nullif(ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload), b.striker_id) END, false),
        (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
                CASE WHEN b.kind = 'ball' THEN b.striker_id END), false)
      ) AS who(player_id, faced)
    UNION ALL
    SELECT s.player_id, s.match_id, s.runs, s.balls, s.fours, s.sixes, s.played_at
      FROM summary_batting_line s
  ) x
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id;

-- player_batting_by_season: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE VIEW player_batting_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT x.player_id,
       ms.season,
       count(DISTINCT x.match_id)                                                 AS matches,
       coalesce(sum(x.runs), 0)                                                   AS runs,
       sum(x.balls)                                                               AS balls_faced,
       sum(x.fours)                                                               AS fours,
       sum(x.sixes)                                                               AS sixes,
       max(x.at)                                                                  AS last_ball_at
  FROM (
    SELECT who.player_id, b.match_id,
           CASE WHEN who.faced THEN ball_runs_off_bat(b.ball_type, b.value, b.payload) ELSE 0 END AS runs,
           CASE WHEN who.faced AND b.ball_type <> 'Wd' THEN 1 ELSE 0 END AS balls,
           CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END AS fours,
           CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END AS sixes,
           b.server_ts AS at
      FROM ball_event_career b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' THEN b.striker_id END, true),
        (CASE WHEN b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
              THEN nullif(ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload), b.striker_id) END, false),
        (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
                CASE WHEN b.kind = 'ball' THEN b.striker_id END), false)
      ) AS who(player_id, faced)
    UNION ALL
    SELECT s.player_id, s.match_id, s.runs, s.balls, s.fours, s.sixes, s.played_at
      FROM summary_batting_line s
  ) x
  JOIN match_season ms ON ms.match_id = x.match_id
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id, ms.season;

-- player_batting_since: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE FUNCTION player_batting_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs bigint, balls_faced bigint, fours bigint,
               sixes bigint, last_ball_at timestamptz) AS $$
  SELECT
    count(DISTINCT x.match_id),
    coalesce(sum(x.runs), 0),
    CASE WHEN count(*) = 0 THEN 0 ELSE sum(x.balls) END,
    CASE WHEN count(*) = 0 THEN 0 ELSE sum(x.fours) END,
    CASE WHEN count(*) = 0 THEN 0 ELSE sum(x.sixes) END,
    max(x.at)
  FROM (
    SELECT b.match_id,
           CASE WHEN b.kind = 'ball' AND b.striker_id = p_player
                THEN ball_runs_off_bat(b.ball_type, b.value, b.payload) ELSE 0 END AS runs,
           CASE WHEN b.kind = 'ball' AND b.striker_id = p_player AND b.ball_type <> 'Wd'
                THEN 1 ELSE 0 END AS balls,
           CASE WHEN b.kind = 'ball' AND b.striker_id = p_player AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END AS fours,
           CASE WHEN b.kind = 'ball' AND b.striker_id = p_player AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END AS sixes,
           b.server_ts AS at
      FROM ball_event_career b
     WHERE ((b.kind = 'ball' AND b.striker_id = p_player)
            OR (b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
                AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = p_player
                AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
            OR ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) = p_player)
       AND (p_from IS NULL OR b.server_ts >= p_from)
    UNION ALL
    SELECT s.match_id, s.runs, s.balls, s.fours, s.sixes, s.played_at
      FROM summary_batting_line s
     WHERE s.player_id = p_player
       AND (p_from IS NULL OR s.played_at >= p_from)
  ) x
$$ LANGUAGE sql STABLE;

-- player_bowling_career: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE VIEW player_bowling_career WITH (security_invoker = true) AS
SELECT x.player_id,
       count(DISTINCT x.match_id)                                                 AS matches,
       coalesce(sum(x.runs), 0)                                                   AS runs_conceded,
       coalesce(sum(x.balls), 0)                                                  AS legal_balls,
       sum(x.wides)                                                               AS wides,
       sum(x.no_balls)                                                            AS no_balls,
       coalesce(sum(x.wickets), 0)                                                AS wickets
  FROM (
    SELECT b.bowler_id AS player_id, b.match_id,
           ball_runs_to_bowler(b.ball_type, b.value, b.payload)                   AS runs,
           CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END AS balls,
           CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END                         AS wides,
           CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END                         AS no_balls,
           CASE WHEN ball_is_wicket(b.ball_type, b.dismissal) AND dismissal_is_bowlers(b.dismissal)
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END                                                 AS wickets
      FROM ball_event_career b
     WHERE b.kind = 'ball'
    UNION ALL
    SELECT w.player_id, w.match_id, w.runs, w.legal_balls, w.wides, w.no_balls, w.wickets
      FROM summary_bowling_line w
  ) x
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id;

-- player_bowling_by_season: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE VIEW player_bowling_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT x.player_id,
       ms.season,
       count(DISTINCT x.match_id)                                                 AS matches,
       coalesce(sum(x.runs), 0)                                                   AS runs_conceded,
       coalesce(sum(x.balls), 0)                                                  AS legal_balls,
       sum(x.wides)                                                               AS wides,
       sum(x.no_balls)                                                            AS no_balls,
       coalesce(sum(x.wickets), 0)                                                AS wickets
  FROM (
    SELECT b.bowler_id AS player_id, b.match_id,
           ball_runs_to_bowler(b.ball_type, b.value, b.payload)                   AS runs,
           CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END AS balls,
           CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END                         AS wides,
           CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END                         AS no_balls,
           CASE WHEN ball_is_wicket(b.ball_type, b.dismissal) AND dismissal_is_bowlers(b.dismissal)
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END                                                 AS wickets
      FROM ball_event_career b
     WHERE b.kind = 'ball'
    UNION ALL
    SELECT w.player_id, w.match_id, w.runs, w.legal_balls, w.wides, w.no_balls, w.wickets
      FROM summary_bowling_line w
  ) x
  JOIN match_season ms ON ms.match_id = x.match_id
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id, ms.season;

-- player_bowling_since: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE FUNCTION player_bowling_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs_conceded bigint, legal_balls bigint, wides bigint, no_balls bigint, wickets bigint) AS $$
  SELECT
    count(DISTINCT x.match_id),
    coalesce(sum(x.runs), 0),
    coalesce(sum(x.balls), 0),
    CASE WHEN count(*) = 0 THEN 0 ELSE sum(x.wides) END,
    CASE WHEN count(*) = 0 THEN 0 ELSE sum(x.no_balls) END,
    coalesce(sum(x.wickets), 0)
  FROM (
    SELECT b.match_id,
           ball_runs_to_bowler(b.ball_type, b.value, b.payload)                   AS runs,
           CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END AS balls,
           CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END                         AS wides,
           CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END                         AS no_balls,
           CASE WHEN ball_is_wicket(b.ball_type, b.dismissal) AND dismissal_is_bowlers(b.dismissal)
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END                                                 AS wickets
      FROM ball_event_career b
     WHERE b.kind = 'ball'
       AND b.bowler_id = p_player
       AND (p_from IS NULL OR b.server_ts >= p_from)
    UNION ALL
    SELECT w.match_id, w.runs, w.legal_balls, w.wides, w.no_balls, w.wickets
      FROM summary_bowling_line w
     WHERE w.player_id = p_player
       AND (p_from IS NULL OR w.played_at >= p_from)
  ) x
$$ LANGUAGE sql STABLE;

-- bowler_innings_figures: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE VIEW bowler_innings_figures WITH (security_invoker = true) AS
SELECT b.bowler_id AS player_id, b.match_id, b.innings,
       count(*) FILTER (WHERE ball_is_wicket(b.ball_type, b.dismissal) AND dismissal_is_bowlers(b.dismissal)
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))::int AS wickets,
       coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)), 0)::int AS runs_conceded
  FROM ball_event_career b
 WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL
 GROUP BY b.bowler_id, b.match_id, b.innings
UNION ALL
SELECT w.player_id, w.match_id, w.innings, w.wickets, w.runs
  FROM summary_bowling_line w
 WHERE w.player_id IS NOT NULL;

-- player_wicket_breakdown: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE VIEW player_wicket_breakdown WITH (security_invoker = true) AS
SELECT x.player_id, x.dismissal, count(*) AS wickets
  FROM (
    SELECT b.bowler_id AS player_id, b.dismissal
      FROM ball_event_career b
     WHERE b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
       AND b.bowler_id IS NOT NULL
       AND dismissal_is_bowlers(b.dismissal)
       AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
    UNION ALL
    SELECT s.bowler_id, s.how_out
      FROM summary_batting_line s
     WHERE s.is_bowlers AND s.bowler_id IS NOT NULL
  ) x
 GROUP BY x.player_id, x.dismissal;

-- player_dismissals: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE VIEW player_dismissals WITH (security_invoker = true) AS
SELECT x.player_id,
       count(*)                                                                   AS dismissals
  FROM (
    SELECT who.player_id, b.match_id
      FROM ball_event_career b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
              THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END),
        (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
                CASE WHEN b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                     THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END))
      ) AS who(player_id)
    UNION ALL
    SELECT s.player_id, s.match_id
      FROM summary_batting_line s
     WHERE s.is_dismissal
  ) x
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id;

-- player_dismissals_by_season: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE VIEW player_dismissals_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT x.player_id,
       ms.season,
       count(*)                                                                   AS dismissals
  FROM (
    SELECT who.player_id, b.match_id
      FROM ball_event_career b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
              THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END),
        (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
                CASE WHEN b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                     THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END))
      ) AS who(player_id)
    UNION ALL
    SELECT s.player_id, s.match_id
      FROM summary_batting_line s
     WHERE s.is_dismissal
  ) x
  JOIN match_season ms ON ms.match_id = x.match_id
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id, ms.season;

-- player_dismissals_since: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE FUNCTION player_dismissals_since(p_player uuid, p_from timestamptz)
RETURNS bigint AS $$
  SELECT (SELECT count(*)
            FROM ball_event_career b
           WHERE ((b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
                   AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = p_player
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
                  OR ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) = p_player)
             AND (p_from IS NULL OR b.server_ts >= p_from))
       + (SELECT count(*)
            FROM summary_batting_line s
           WHERE s.player_id = p_player AND s.is_dismissal
             AND (p_from IS NULL OR s.played_at >= p_from))
$$ LANGUAGE sql STABLE;

-- player_dismissal_breakdown: db/71's, `ball_type = 'W'` read as ball_is_wicket().
CREATE OR REPLACE VIEW player_dismissal_breakdown WITH (security_invoker = true) AS
SELECT x.player_id, x.dismissal, count(*) AS dismissals
FROM (
  SELECT ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) AS player_id, b.dismissal
    FROM ball_event_career b
   WHERE b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal)
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT NULL
     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
         ball_retirement_dismissal(b.kind, b.ball_type, b.dismissal, b.payload)
    FROM ball_event_career b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
  UNION ALL
  SELECT s.player_id, s.how_out
    FROM summary_batting_line s
   WHERE s.is_dismissal AND s.player_id IS NOT NULL
) x
GROUP BY x.player_id, x.dismissal;

-- opposition_squad: db/71's, `ball_type = 'W'` read as ball_is_wicket().
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
  bat_rows AS (
    SELECT b.striker_id AS pid, b.match_id, true AS live,
           -- Balls faced: a no-ball is one, a wide is not.
           CASE WHEN b.ball_type <> 'Wd' THEN 1 ELSE 0 END AS balls,
           ball_runs_off_bat(b.ball_type, b.value, b.payload) AS runs,
           CASE WHEN ball_is_wicket(b.ball_type, b.dismissal)
                 AND dismissal_is_bowlers(b.dismissal)
                 AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = b.striker_id
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END AS dismissals,
           -- His boundaries: off the bat, off a run or a no-ball (runsOffBat()).
           CASE WHEN b.ball_type IN ('run','Nb') AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4
                THEN 1 ELSE 0 END AS fours,
           CASE WHEN b.ball_type IN ('run','Nb') AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6
                THEN 1 ELSE 0 END AS sixes,
           CASE WHEN ball_counts_in_over(b.ball_type, b.payload) AND coalesce(b.value,0) = 0
                THEN 1 ELSE 0 END AS dots
      FROM ball_event_career b JOIN squad q ON q.id = b.striker_id
     WHERE b.kind = 'ball'
    UNION ALL
    -- His book innings: the bowler's dismissals of him, as above.
    SELECT l.player_id, l.match_id, false, l.balls, l.runs,
           CASE WHEN l.is_bowlers THEN 1 ELSE 0 END, l.fours, l.sixes, NULL::integer
      FROM summary_batting_line l JOIN squad q ON q.id = l.player_id
  ),
  bat AS (
    SELECT r.pid,
           count(DISTINCT r.match_id)::int AS innings,
           sum(r.balls)::int AS balls,
           coalesce(sum(r.runs),0)::int AS runs,
           sum(r.dismissals)::int AS dismissals,
           sum(r.fours)::int AS fours,
           sum(r.sixes)::int AS sixes,
           sum(r.dots)::int AS dots,
           sum(r.balls) FILTER (WHERE r.live)::int AS live_balls,
           coalesce(sum(r.runs) FILTER (WHERE r.balls IS NOT NULL), 0)::int AS runs_with_balls
      FROM bat_rows r
     GROUP BY r.pid
  ),
  bowl AS (
    SELECT x.pid,
           coalesce(sum(x.balls), 0)::int AS balls_bowled,
           -- What the bowler conceded, as the fold charges him (runsToBowler()):
           -- a wide is its penalty run and every run off it; a no-ball its
           -- penalty run and the runs off the bat, not its byes or leg byes
           -- (Law 21.15); a run or a wicket ball its runs; byes and leg byes
           -- are not his. A book's bowling row: his runs, as the card has them.
           coalesce(sum(x.runs), 0)::int AS runs_conceded,
           coalesce(sum(x.wickets), 0)::int AS wickets
      FROM (
        SELECT b.bowler_id AS pid,
               CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END AS balls,
               ball_runs_to_bowler(b.ball_type, b.value, b.payload) AS runs,
               CASE WHEN ball_is_wicket(b.ball_type, b.dismissal) AND dismissal_is_bowlers(b.dismissal)
                     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                    THEN 1 ELSE 0 END AS wickets
          FROM ball_event_career b JOIN squad q ON q.id = b.bowler_id
         WHERE b.kind = 'ball'
        UNION ALL
        SELECT w.player_id, w.legal_balls, w.runs, w.wickets
          FROM summary_bowling_line w JOIN squad q ON q.id = w.player_id
      ) x
     GROUP BY x.pid
  )
  SELECT q.id, q.school_id, q.full_name, q.team_code, q.playing_role, q.batting_style, q.bowling_style,
         coalesce(bat.innings,0),
         CASE WHEN bat.pid IS NULL THEN 0 ELSE bat.balls END,
         coalesce(bat.runs,0), coalesce(bat.dismissals,0),
         CASE WHEN bat.pid IS NULL THEN 0 ELSE bat.fours END,
         CASE WHEN bat.pid IS NULL THEN 0 ELSE bat.sixes END,
         CASE WHEN bat.pid IS NULL THEN 0 ELSE bat.dots END,
         -- NULL below the evidence floor, not a number. The label beside it
         -- says why, and a screen renders an em dash.
         CASE WHEN coalesce(bat.balls,0) >= 30 THEN round(bat.runs_with_balls * 100.0 / bat.balls, 1) END,
         CASE WHEN coalesce(bat.live_balls,0) >= 30 THEN round(bat.dots * 100.0 / bat.live_balls, 1) END,
         evidence_label(bat.balls),
         coalesce(bowl.balls_bowled,0), coalesce(bowl.runs_conceded,0), coalesce(bowl.wickets,0),
         CASE WHEN coalesce(bowl.balls_bowled,0) >= 30 THEN round(bowl.runs_conceded * 6.0 / bowl.balls_bowled, 2) END,
         evidence_label(bowl.balls_bowled)
    FROM squad q
    LEFT JOIN bat  ON bat.pid  = q.id
    LEFT JOIN bowl ON bowl.pid = q.id
   ORDER BY coalesce(bat.runs,0) DESC, q.full_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- keeper_dismissal: db/71's: a stumping off a wide is the keeper's, as one off a W is (Law 39).
CREATE OR REPLACE VIEW keeper_dismissal WITH (security_invoker = true) AS
SELECT b.match_id, b.school_id, b.innings, b.seq, b.server_ts,
       k.keeper_ref,
       CASE WHEN k.keeper_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN k.keeper_ref::uuid END AS player_id,
       b.dismissal
  FROM ball_event_career b
  CROSS JOIN LATERAL keeper_at(b.match_id, b.innings, b.seq) k
 WHERE b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal) AND b.dismissal IN ('caught', 'stumped')
   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
   AND (b.dismissal = 'stumped' OR keeper_is_fielder(k.keeper_ref, k.keeper_name, b.payload -> 'fielder'));

-- milestone_watch: db/71's, the bowler's wicket asked as ball_is_wicket(): a stumping or a
-- hit wicket off a wide is his, and can make a five-for. The hat-trick is
-- bowler_hat_trick's, which reads the balls of the over alone.
CREATE OR REPLACE FUNCTION milestone_watch() RETURNS trigger AS $$
DECLARE v_runs int; v_before int; v_w int; v_career int; t int; v_bat int;
BEGIN
  -- db/71: a super over's ball is no milestone (design §4, D6): not a career
  -- run, not a five-for, not a hat-trick. Asked first, before any figure.
  IF innings_super_over_of(NEW.match_id, NEW.innings) IS NOT NULL THEN RETURN NEW; END IF;
  v_bat := ball_runs_off_bat(NEW.ball_type, NEW.value, NEW.payload);
  -- The striker's innings, and his career, after this ball.
  IF NEW.striker_id IS NOT NULL AND v_bat > 0 THEN
    SELECT innings_runs_off_bat(NEW.striker_id, NEW.match_id, NEW.innings) INTO v_runs;
    v_before := v_runs - v_bat;
    IF v_before < 50 AND v_runs >= 50 THEN PERFORM milestone_notify(NEW.striker_id, 'fifty', NEW.match_id, NEW.innings, v_runs); END IF;
    IF v_before < 100 AND v_runs >= 100 THEN PERFORM milestone_notify(NEW.striker_id, 'hundred', NEW.match_id, NEW.innings, v_runs); END IF;
    SELECT career_runs_off_bat(NEW.striker_id) INTO v_career;
    FOREACH t IN ARRAY ARRAY[500, 1000, 2000, 5000] LOOP
      IF v_career - v_bat < t AND v_career >= t THEN PERFORM milestone_notify(NEW.striker_id, 'career_runs', NEW.match_id, 0::smallint, t); END IF;
    END LOOP;
  END IF;
  -- The bowler's wicket — one that stood.
  IF NEW.bowler_id IS NOT NULL AND ball_is_wicket(NEW.ball_type, NEW.dismissal) AND dismissal_is_bowlers(NEW.dismissal)
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

-- ball_event_stumped_by_keeper: db/68's door, asking ball_is_wicket(): a stumping off a wide credited to
-- someone who is not the keeper at that ball, while one is recorded, is
-- refused as one off a W is (the Laws: stumped_not_keeper).
CREATE OR REPLACE FUNCTION ball_event_stumped_by_keeper() RETURNS trigger AS $$
DECLARE k record;
BEGIN
  IF NEW.kind = 'ball' AND ball_is_wicket(NEW.ball_type, NEW.dismissal) AND NEW.dismissal = 'stumped'
     AND jsonb_typeof(NEW.payload -> 'fielder') = 'string' AND NEW.payload ->> 'fielder' <> '' THEN
    SELECT * INTO k FROM keeper_at(NEW.match_id, NEW.innings, NEW.seq);
    IF k.keeper_ref IS NOT NULL AND NOT keeper_is_fielder(k.keeper_ref, k.keeper_name, NEW.payload -> 'fielder') THEN
      RAISE EXCEPTION 'ball_event: a stumping credited to someone who was not keeping wicket (match %, key %) — a stumping is the wicket-keeper''s',
        NEW.match_id, NEW.idempotency_key
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'ball_event',
              CONSTRAINT = 'ball_event_stumped_by_keeper';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ── 4 · The door ──────────────────────────────────────────────────────
-- What is already stored is counted and named, not refused: the readers
-- above read it as the fold does.
DO $legacy$
DECLARE n_now bigint; n_not bigint;
BEGIN
  SELECT count(*) FILTER (WHERE ball_is_wicket(ball_type, dismissal)),
         count(*) FILTER (WHERE NOT ball_is_wicket(ball_type, dismissal))
    INTO n_now, n_not
    FROM ball_event
   WHERE kind = 'ball' AND ball_type IN ('Wd', 'Nb') AND dismissal IS NOT NULL;
  RAISE NOTICE 'db/87: % stored wide or no-ball row(s) name a way out the Law allows off it, read as a wicket from here on; % name another, read as no wicket, as before',
    n_now, n_not;
END $legacy$;

-- A new wide or no-ball names only a way out the Law allows off it (Law
-- 22.9, Law 21.17). What a CHECK would raise, so every writer that already
-- handles one — the API's per-event refusal — handles this. Only a delivery,
-- and only a wide or a no-ball with a method: every other row is as it was.
-- Named to fire after ball_event_names_its_delivery and before
-- ball_event_stumped_by_keeper and zz_ball_event_fingerprint; it changes
-- nothing in NEW, so the fingerprint is the one the row would have had.
CREATE OR REPLACE FUNCTION ball_event_out_off_extra() RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'ball' AND NEW.ball_type IN ('Wd', 'Nb') AND NEW.dismissal IS NOT NULL
     AND NOT ball_is_wicket(NEW.ball_type, NEW.dismissal) THEN
    RAISE EXCEPTION 'ball_event: % off a % (match %, key %) — off a wide a batter is out only run out, stumped, hit wicket or obstructing the field; off a no ball only run out, hit the ball twice or obstructing the field',
      NEW.dismissal, CASE NEW.ball_type WHEN 'Wd' THEN 'wide' ELSE 'no ball' END, NEW.match_id, NEW.idempotency_key
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'ball_event',
            CONSTRAINT = 'ball_event_out_off_extra';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ball_event_out_off_extra ON ball_event;
CREATE TRIGGER ball_event_out_off_extra
  BEFORE INSERT ON ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_out_off_extra();

-- ── 5 · Nothing but the rule moved ────────────────────────────────────
-- Every object replaced has the shape it had before this file; each asks
-- ball_is_wicket() and none asks for a W alone; the question answers as the
-- Laws do; the door is on ball_event, on INSERT alone, in its place among
-- the triggers.
DO $check$
DECLARE r record; now_shape jsonb; got text; want text;
BEGIN
  FOR r IN SELECT * FROM _db87_before LOOP
    IF r.obj LIKE 'view:%' THEN
      SELECT jsonb_build_object(
               'options', to_jsonb(c.reloptions), 'acl', to_jsonb(c.relacl::text[]), 'owner', c.relowner::regrole::text,
               'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        INTO now_shape
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind = 'v' AND c.relname = substr(r.obj, 6);
    ELSE
      SELECT jsonb_build_object(
               'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
               'definer', p.prosecdef, 'volatility', p.provolatile, 'parallel', p.proparallel, 'strict', p.proisstrict,
               'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
               'language', p.prolang)
        INTO now_shape FROM pg_proc p WHERE p.oid = substr(r.obj, 10)::regprocedure;
    END IF;
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/87: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _db87_before) <> 18 THEN
    RAISE EXCEPTION 'db/87: the snapshot is not the 18 objects this file replaces (%)', (SELECT count(*) FROM _db87_before);
  END IF;

  FOR r IN SELECT c.relname AS nm, pg_get_viewdef(c.oid) AS def FROM pg_class c
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = 'public' AND c.relkind = 'v'
             AND c.relname IN ('player_innings', 'player_batting_career', 'player_batting_by_season',
                               'player_bowling_career', 'player_bowling_by_season', 'bowler_innings_figures',
                               'player_wicket_breakdown', 'player_dismissals', 'player_dismissals_by_season',
                               'player_dismissal_breakdown', 'keeper_dismissal')
           UNION ALL
           SELECT p.proname, p.prosrc FROM pg_proc p
            WHERE p.oid IN ('ball_wicket_stands(uuid,smallint,integer,text,text,text)'::regprocedure,
                            'player_batting_since(uuid,timestamptz)'::regprocedure, 'player_bowling_since(uuid,timestamptz)'::regprocedure,
                            'player_dismissals_since(uuid,timestamptz)'::regprocedure, 'opposition_squad(uuid)'::regprocedure,
                            'milestone_watch()'::regprocedure, 'ball_event_stumped_by_keeper()'::regprocedure)
  LOOP
    IF r.def NOT LIKE '%ball_is_wicket(%' OR r.def ~ 'ball_type\)? = ''W''::text' OR r.def ~ 'ball_type = ''W''' THEN
      RAISE EXCEPTION 'db/87: % does not ask ball_is_wicket() alone for a wicket', r.nm;
    END IF;
  END LOOP;

  -- The Laws' table, every type by every method.
  SELECT string_agg(t || ':' || d, ' ' ORDER BY t, d) INTO got
    FROM unnest(ARRAY['run', 'W', 'Wd', 'Nb', 'B', 'LB']) t,
         unnest(ARRAY['bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'handled_ball',
                      'obstructing_field', 'timed_out', 'retired_out', 'hit_twice']) d
   WHERE ball_is_wicket(t, d) AND t <> 'W';
  want := 'Nb:hit_twice Nb:obstructing_field Nb:run_out Wd:hit_wicket Wd:obstructing_field Wd:run_out Wd:stumped';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'db/87: off an extra ball_is_wicket() allows %, where the Laws allow %', got, want;
  END IF;
  IF NOT ball_is_wicket('W', 'bowled') OR NOT ball_is_wicket('W', NULL) OR ball_is_wicket('Wd', NULL)
     OR ball_is_wicket(NULL, 'run_out') OR ball_is_wicket('run', 'run_out') THEN
    RAISE EXCEPTION 'db/87: ball_is_wicket() reads a W, a bare extra or an untyped row wrongly';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'ball_event'::regclass AND t.tgname = 'ball_event_out_off_extra'
                    AND NOT t.tgisinternal AND t.tgtype = 7 /* ROW | BEFORE | INSERT */) THEN
    RAISE EXCEPTION 'db/87: the door is not a BEFORE INSERT row trigger on ball_event';
  END IF;
END $check$;

DROP TABLE _db87_before;

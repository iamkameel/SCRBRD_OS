-- ══════════════════════════════════════════════════════════════════
--  54 · A delivery that does not count in the over (Law 17.3.2.5), and
--       the free hit by the match's format, as the fold has them (SCRBRD-113)
-- ══════════════════════════════════════════════════════════════════
--
-- SCRBRD-113 moved the scoring engine to the MCC Laws of Cricket, 2017 Code,
-- 4th Edition (2026), in force from 1 October 2026, keyed to the match date
-- (packages/scoring/src/edition.mjs). Of what it built, TWO things change a
-- figure SQL keeps, and this file is those two things: the balls of the over
-- (1, below) and the free hit (2).
--
-- 1. THE BALLS OF THE OVER.
--
-- THE RULE (17.3.2.5, the same in the 3rd Edition): a ball delivered by the
-- bowler does not count as one of the 6 balls of the over when Law 24.4 (a
-- player returning without permission touches the ball), 28.2 (fielding the
-- ball illegally), 41.4 (a fielder deliberately distracting or obstructing
-- the striker) or 41.5 (a fielder deliberately distracting, deceiving or
-- obstructing a batter) is applied. Each gives the batting side five penalty
-- runs. The pad now records such a delivery marked with the offence —
-- payload.notInOver, one of 'fielder_returning', 'illegal_fielding',
-- 'distracting_striker', 'obstructing_batter' (NOT_IN_OVER in events.mjs,
-- notInOverDelivery()) — and the fold does not count it: not a ball of the
-- over, not one of the bowler's balls, and no over ends on it
-- (countsInOver()). Its runs are what its type says they are, as for any
-- delivery; the striker received it (a ball faced, as a no-ball is); a wide
-- or a no-ball keeps its one run. Only the COUNT moves.
--
-- Every SQL reader counted a legal ball as `ball_type NOT IN ('Wd','Nb')`.
-- This file adds the fold's question, once:
--
--   ball_counts_in_over(ball_type, payload)   countsInOver() in SQL: not a
--     wide or a no-ball, and not marked with one of the four offences. A
--     NULL type answers NULL, as `NULL NOT IN (...)` always did (every reader
--     here reads ball_event_live, whose ball_type_as_folded() (db/43) makes a
--     typeless delivery a run first).
--
-- and asks it in every object that counted balls of the over, each from its
-- latest definition, nothing else in it moved:
--
--   match_live_score                             db/48   legal_balls (the board's overs)
--   innings_score_as_folded(uuid,smallint)       db/48   legal_balls (the handover check's)
--   bowler_over                                  db/08   over_no, legal_balls (workload, spells, the day
--                                                        check and the breach watch read it)
--   bowler_hat_trick                             db/42   three wickets in three of his balls of the over:
--                                                        one that does not count neither makes nor breaks
--                                                        it, as a wide never did (the commentary reads it so)
--   player_bowling_since(uuid, timestamptz)      db/52   legal_balls
--   opposition_squad(uuid)                       db/52   balls_bowled, and a batter's dots (a dot is a
--                                                        ball of the over worth nothing, as phases.mjs
--                                                        counts it)
--   player_bowling_by_season                     db/52   legal_balls
--   player_bowling_career                        db/52   legal_balls
--
-- FOLLOW WITHOUT REPLACEMENT: scoring_verify_takeover() (db/45, through
-- innings_score_as_folded()), broadcast_state() (db/48, through
-- match_live_score), bowler_spell (over bowler_over), milestone_watch()
-- (db/51, its day check through bowler_over). Outside db/: the `matchups` and
-- `career` reads (services/api/read/read-api.mjs) ask ball_counts_in_over()
-- too, so they need this file (expected-migrations.json).
--
-- 2. THE FREE HIT FOLLOWS THE MATCH'S FORMAT (Kameel, 2026-09-27).
--
-- The free hit is not in the Laws: it is a playing condition of
-- limited-overs cricket. In South African school cricket a limited-overs
-- match (T20, 50-over, any overs-limited format) gives a free hit after a
-- no-ball; a declaration or timed match, one day or more, does not — there a
-- no-ball is its penalty run and an extra delivery. The fold asks
-- freeHitsApply(format) (packages/scoring/src/format.mjs) of the fixture's
-- format, match.format; SQL now asks the same of the same column:
--
--   free_hits_apply(format)     freeHitsApply() in SQL: false for the
--     declaration and timed spellings (DECLARATION_FORMATS, the same list,
--     lower-cased with the spaces closed up), true for every other format
--     and for none.
--   match_free_hits_apply(match)  free_hits_apply() of that match's format.
--     SECURITY DEFINER, as match_school() is (db/02): every reader of a
--     wicket asks it, and the answer must not depend on whether the reader
--     may see the fixture row — a spectator's scorecard and the scorer's
--     must stand the same wickets. It says one yes or no about the match.
--   ball_on_free_hit()          db/42's, answering false in a match whose
--     format gives no free hit. ball_wicket_stands() asks it, so every
--     reader of a wicket — the live score, the handover check, every career
--     figure, the hat-trick, the opposition's squad — follows.
--
-- This is a correction, not a change of Edition: it follows the STORED
-- format and not the match date. A stored declaration match (a fixture made
-- as "Two-Day", say) now stands the wicket a bowler took off the ball after a
-- no-ball, where every reader saved it before; a match whose format is a
-- limited-overs one, or none at all, reads exactly as it did. (Every fixture
-- the seed holds is T20.)
--
-- WHAT DOES NOT MOVE. Runs, anywhere: a delivery that does not count is
-- scored as its type says, as before. Wickets: none is ever taken off one
-- (41.4.2, 41.5.4; the Laws check refuses the mark on a wicket). Balls faced
-- (`ball_type <> 'Wd'`): the striker received it. The free hit
-- (ball_wicket_stands(), db/42): consumed by a delivery that is not a wide
-- or a no-ball, by its type, as the fold reads it (replay.mjs).
--
-- STORED ROWS ARE NOT REWRITTEN, and none moves: no row stored before this
-- carries payload.notInOver — nothing wrote one — so every figure on every
-- existing log is the number it was. Only a delivery recorded with the mark
-- from now on is counted differently.
--
-- NOTHING ELSE OF SCRBRD-113 IS SQL. The Edition decides three things, none
-- a figure SQL keeps: how long a suspension lasts (a bowler_suspended row
-- moves no figure: every reader counts `kind = 'ball'`); who faces next after
-- short running or an obstructed catch (strike is the fold's: no SQL reader
-- replays it — the board reads the last ball's own striker_id); penalty runs
-- after a result, and whether a chase is over (no SQL object keeps
-- `complete` or a result; the target is innings_target_as_folded(), db/48,
-- which already raises it by every award to the fielding side made in that
-- innings, as the fold does). Runs disallowed for 41.14.3 and 41.15.3 are the
-- delivery recorded with no runs (a dot) and an award, db/48's shapes.
--
-- IDENTICAL SHAPE. Same columns, types and order (CREATE OR REPLACE VIEW
-- refuses anything else); security_invoker restated; the function
-- attributes, pinned search path, owner and grants as they were — the block
-- at the end checks all of it against a snapshot taken before. Idempotent:
-- every statement is CREATE OR REPLACE, the snapshot is replaced if it
-- exists, and the proof rolls itself back.
--
-- PROOF THAT SQL AND THE FOLD AGREE. The block at the end: the rule case by
-- case against countsInOver() (packages/scoring/test/edition.test.mjs, E);
-- a fixture it builds and rolls back, read through every reader that takes
-- a match or a player; and every reader asking the rule. db/99 §32 holds the
-- rule and the readers on every verify paste, and the readers agreeing over
-- the whole log; tools/smoke-fold-figures.mjs compares every one of them with
-- the fold over generated logs that carry such deliveries.

-- ── The shape of everything this file replaces, before it does ─────
DROP TABLE IF EXISTS _db54_before;
CREATE TEMP TABLE _db54_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions),
         'acl', to_jsonb(c.relacl::text[]),
         'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND c.relname IN ('match_live_score', 'bowler_over', 'bowler_hat_trick',
                     'player_bowling_by_season', 'player_bowling_career')
UNION ALL
SELECT 'function:' || p.oid::regprocedure::text,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid),
         'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef,
         'volatility', p.provolatile,
         'parallel', p.proparallel,
         'strict', p.proisstrict,
         'leakproof', p.proleakproof,
         'cost', p.procost,
         'rows', p.prorows,
         'config', to_jsonb(p.proconfig),
         'acl', to_jsonb(p.proacl::text[]),
         'owner', p.proowner::regrole::text,
         'language', p.prolang)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.oid::regprocedure::text IN (
         'innings_score_as_folded(uuid,smallint)',
         'player_bowling_since(uuid,timestamp with time zone)',
         'opposition_squad(uuid)',
         'ball_on_free_hit(uuid,smallint,integer)');

-- ── The rule, in SQL ─────────────────────────────────────────────
-- countsInOver() (events.mjs): isLegal(type) and not NOT_IN_OVER. The list
-- is the fold's, spelled out: a reason the fold does not know counts.
CREATE OR REPLACE FUNCTION ball_counts_in_over(p_ball_type text, p_payload jsonb)
RETURNS boolean AS $$
  SELECT p_ball_type NOT IN ('Wd', 'Nb')
     AND coalesce(p_payload->>'notInOver', '') NOT IN
         ('fielder_returning', 'illegal_fielding', 'distracting_striker', 'obstructing_batter')
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

GRANT EXECUTE ON FUNCTION ball_counts_in_over(text, jsonb) TO scrbrd_app;

-- ── The free hit, by the match's format ──────────────────────────
-- freeHitsApply() (format.mjs): DECLARATION_FORMATS, spelled as the fold
-- compares them — trimmed, lower-cased, the spaces closed up.
CREATE OR REPLACE FUNCTION free_hits_apply(p_format text)
RETURNS boolean AS $$
  SELECT coalesce(lower(regexp_replace(regexp_replace(p_format, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')), '') NOT IN
         ('one-day declaration', 'one day declaration', 'declaration', 'timed', 'timed match',
          'two-day', 'two day', 'three-day', 'three day', 'four-day', 'four day', 'five-day', 'five day',
          'multi-day', 'multi day', 'test')
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

GRANT EXECUTE ON FUNCTION free_hits_apply(text) TO scrbrd_app;

-- The match's answer, whoever asks (see the header). One row, one column.
CREATE OR REPLACE FUNCTION match_free_hits_apply(p_match uuid)
RETURNS boolean AS $$
  SELECT coalesce((SELECT free_hits_apply(m.format) FROM match m WHERE m.id = p_match), true)
$$ LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION match_free_hits_apply(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_free_hits_apply(uuid) TO scrbrd_app;

-- db/42's, with the match's format asked first: in a declaration or timed
-- match no delivery is a free hit. Otherwise as db/42: the last live delivery
-- of this innings before this one that was not a wide was a no-ball.
CREATE OR REPLACE FUNCTION ball_on_free_hit(p_match uuid, p_innings smallint, p_seq integer)
RETURNS boolean AS $$
  SELECT match_free_hits_apply(p_match) AND coalesce((
    SELECT b.ball_type IS NOT DISTINCT FROM 'Nb'
      FROM ball_event_live b
     WHERE b.match_id = p_match AND b.innings = p_innings AND b.seq < p_seq
       AND b.kind = 'ball' AND b.ball_type IS DISTINCT FROM 'Wd'
     ORDER BY b.seq DESC
     LIMIT 1), false)
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- ── The live score (db/48) ───────────────────────────────────────
-- db/48's, with the balls of the over the fold's. Nothing else moved.
CREATE OR REPLACE VIEW match_live_score WITH (security_invoker = true) AS
SELECT
  match_id,
  innings,
  CASE WHEN bool_and(penalty_runs_as_folded(kind, payload) IS NOT NULL)
       THEN sum(CASE WHEN ball_type IN ('Wd','Nb') THEN 1 + coalesce(value,0)
                     ELSE coalesce(value,0) END)
            + sum(penalty_runs_as_folded(kind, payload))
            + penalty_credit_as_folded(match_id, innings)
  END                                                                     AS runs,
  sum(CASE WHEN ball_wicket_stands(match_id, innings, seq, kind, ball_type, dismissal)
           THEN 1 ELSE 0 END)                                             AS wickets,
  sum(CASE WHEN kind='ball' AND ball_counts_in_over(ball_type, payload) THEN 1 ELSE 0 END) AS legal_balls,
  max(seq)                                                                AS last_seq,
  max(server_ts)                                                          AS last_ball_at
FROM ball_event_live
GROUP BY match_id, innings;

-- ── The handover check's count (db/48) ───────────────────────────
-- db/48's, with the balls of the over the fold's. The check itself
-- (scoring_verify_takeover) is unchanged and counts through this.
CREATE OR REPLACE FUNCTION innings_score_as_folded(p_match uuid, p_innings smallint)
RETURNS TABLE (runs integer, wickets integer, legal_balls integer) AS $$
  SELECT
    CASE WHEN coalesce(bool_and(penalty_runs_as_folded(b.kind, b.payload) IS NOT NULL), true)
         THEN (coalesce(sum(CASE WHEN b.kind <> 'ball'               THEN 0
                                 WHEN b.ball_type IN ('Wd', 'Nb')    THEN 1 + coalesce(b.value, 0)
                                 ELSE coalesce(b.value, 0) END), 0)
               + coalesce(sum(penalty_runs_as_folded(b.kind, b.payload)), 0))::integer
              + penalty_credit_as_folded(p_match, p_innings)
    END,
    count(*) FILTER (WHERE (b.kind = 'ball'
                            AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
                        OR ball_retirement_dismissal(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL)::integer,
    count(*) FILTER (WHERE b.kind = 'ball' AND ball_counts_in_over(b.ball_type, b.payload))::integer
  FROM ball_event_live b
  WHERE b.match_id = p_match AND b.innings = p_innings
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- ── Overs, from the log (db/08) ──────────────────────────────────
-- An over is six balls of the over; a wide, a no-ball or a delivery that does
-- not count (17.3.2.5) does not advance it. The over a ball belongs to is the
-- number of balls of the over before it in the innings, divided by six —
-- counted over every ball, including the ones with no bowler attributed, or
-- an unattributed delivery would shift every over after it. Dated by the
-- FIXTURE, not by when the row arrived: a scorer's phone may sync the second
-- innings on Sunday night, and a day limit is about the day the boy bowled.
CREATE OR REPLACE VIEW bowler_over WITH (security_invoker = true) AS
WITH balls AS (
  SELECT b.match_id, b.innings, b.bowler_id, b.school_id, b.seq, b.ball_type, b.payload,
         coalesce(count(*) FILTER (WHERE ball_counts_in_over(b.ball_type, b.payload))
                    OVER (PARTITION BY b.match_id, b.innings ORDER BY b.seq
                          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) / 6 AS over_no
    FROM ball_event_live b
   WHERE b.kind = 'ball')
SELECT x.match_id, x.innings, x.bowler_id, x.school_id, x.over_no::int AS over_no,
       (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS bowled_on,
       count(*) FILTER (WHERE ball_counts_in_over(x.ball_type, x.payload))::int AS legal_balls,
       count(*)::int AS deliveries
  FROM balls x
  JOIN match m ON m.id = x.match_id
 WHERE x.bowler_id IS NOT NULL
 GROUP BY x.match_id, x.innings, x.bowler_id, x.school_id, x.over_no, m.starts_at;

-- ── The hat-trick (db/42) ────────────────────────────────────────
-- Three of the bowler's wickets in three consecutive balls of the over of
-- his. A saved W ball is one, and not a wicket, so it breaks the run, as a
-- dot ball would; a delivery that does not count in the over (17.3.2.5) is
-- not one, as a wide is not.
CREATE OR REPLACE VIEW bowler_hat_trick WITH (security_invoker = true) AS
WITH legal AS (
  SELECT b.bowler_id, b.match_id, b.innings, b.seq,
         (b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)) AS w
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL AND ball_counts_in_over(b.ball_type, b.payload)),
runs AS (
  SELECT *, lag(w, 1) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY seq) AS w1,
            lag(w, 2) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY seq) AS w2
    FROM legal)
SELECT bowler_id AS player_id, match_id, innings, min(seq)::int AS completed_at_seq
  FROM runs WHERE w AND w1 AND w2
 GROUP BY bowler_id, match_id, innings;

-- ── Bowling, windowed (db/52) ────────────────────────────────────
CREATE OR REPLACE FUNCTION player_bowling_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs_conceded bigint, legal_balls bigint,
               wides bigint, no_balls bigint, wickets bigint) AS $$
  SELECT
    count(DISTINCT b.match_id),
    coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)), 0),
    coalesce(sum(CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END), 0),
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

-- ── The opposition's figures (db/52) ─────────────────────────────
-- db/52's, with the balls of the over — a bowler's, and a batter's dots —
-- the fold's. Nothing else in it moved.
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
           -- Balls faced: a no-ball is one, a wide is not.
           count(*) FILTER (WHERE b.ball_type <> 'Wd')::int AS balls,
           coalesce(sum(ball_runs_off_bat(b.ball_type, b.value, b.payload)),0)::int AS runs,
           count(*) FILTER (WHERE b.ball_type = 'W'
                              AND dismissal_is_bowlers(b.dismissal)
                              AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = b.striker_id
                              AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))::int AS dismissals,
           -- His boundaries: off the bat, off a run or a no-ball (runsOffBat()).
           count(*) FILTER (WHERE b.ball_type IN ('run','Nb')
                              AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4)::int AS fours,
           count(*) FILTER (WHERE b.ball_type IN ('run','Nb')
                              AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6)::int AS sixes,
           count(*) FILTER (WHERE ball_counts_in_over(b.ball_type, b.payload) AND coalesce(b.value,0) = 0)::int AS dots
      FROM ball_event_live b JOIN squad q ON q.id = b.striker_id
     WHERE b.kind = 'ball'
     GROUP BY b.striker_id
  ),
  bowl AS (
    SELECT b.bowler_id AS pid,
           count(*) FILTER (WHERE ball_counts_in_over(b.ball_type, b.payload))::int AS balls_bowled,
           -- What the bowler conceded, as the fold charges him (runsToBowler()):
           -- a wide is its penalty run and every run off it; a no-ball its
           -- penalty run and the runs off the bat, not its byes or leg byes
           -- (Law 21.15); a run or a wicket ball its runs; byes and leg byes
           -- are not his.
           coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)),0)::int AS runs_conceded,
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

-- ── Bowling, by season (db/52) ───────────────────────────────────
CREATE OR REPLACE VIEW player_bowling_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT b.bowler_id                                                                AS player_id,
       ms.season,
       count(DISTINCT b.match_id)                                                 AS matches,
       coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)), 0)     AS runs_conceded,
       coalesce(sum(CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END), 0) AS legal_balls,
       coalesce(sum(CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END), 0)           AS wides,
       coalesce(sum(CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END), 0)           AS no_balls,
       coalesce(sum(CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                         THEN 1 ELSE 0 END), 0)                                   AS wickets
  FROM ball_event_live b
  JOIN match_season ms ON ms.match_id = b.match_id
  JOIN player p ON p.id = b.bowler_id
 WHERE b.kind = 'ball'
 GROUP BY b.bowler_id, ms.season;

-- ── Bowling, lifetime (db/52) ────────────────────────────────────
-- player_bowling_by_season without the season.
CREATE OR REPLACE VIEW player_bowling_career WITH (security_invoker = true) AS
SELECT b.bowler_id                                                                AS player_id,
       count(DISTINCT b.match_id)                                                 AS matches,
       coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)), 0)     AS runs_conceded,
       coalesce(sum(CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END), 0) AS legal_balls,
       coalesce(sum(CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END), 0)           AS wides,
       coalesce(sum(CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END), 0)           AS no_balls,
       coalesce(sum(CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                         THEN 1 ELSE 0 END), 0)                                   AS wickets
  FROM ball_event_live b
  JOIN player p ON p.id = b.bowler_id
 WHERE b.kind = 'ball'
 GROUP BY b.bowler_id;

-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  r record;
  now_shape jsonb;
  n int;
  drift text;
  got text;
  want text;
  -- The proof's own rows, built below and rolled back before this block ends.
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  m_a      uuid := gen_random_uuid();
  m_t      uuid := gen_random_uuid();   -- a T20: a no-ball, then a free hit
  m_d      uuid := gen_random_uuid();   -- a One-Day Declaration: no free hit
  p_x      uuid := gen_random_uuid();   -- on strike
  p_y      uuid := gen_random_uuid();   -- at the other end
  p_a      uuid := gen_random_uuid();   -- bowls the first over
  p_c      uuid := gen_random_uuid();   -- bowls the second, and takes a hat-trick
  v_door   boolean := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                               AND tgname = 'ball_event_names_its_delivery' AND tgenabled = 'O');
  v_setting text := coalesce(current_setting('app.user_id', true), '');
BEGIN
  -- 1. The shape: the same nine objects, the same everything but their bodies.
  SELECT count(*) INTO n FROM _db54_before;
  IF n <> 9 THEN RAISE EXCEPTION 'db/54: expected to snapshot 9 objects, found %', n; END IF;
  FOR r IN SELECT * FROM _db54_before LOOP
    IF r.obj LIKE 'view:%' THEN
      SELECT jsonb_build_object(
               'options', to_jsonb(c.reloptions),
               'acl', to_jsonb(c.relacl::text[]),
               'owner', c.relowner::regrole::text,
               'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        INTO now_shape
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind = 'v' AND c.relname = substr(r.obj, 6);
    ELSE
      SELECT jsonb_build_object(
               'result', pg_get_function_result(p.oid),
               'args', pg_get_function_arguments(p.oid),
               'definer', p.prosecdef,
               'volatility', p.provolatile,
               'parallel', p.proparallel,
               'strict', p.proisstrict,
               'leakproof', p.proleakproof,
               'cost', p.procost,
               'rows', p.prorows,
               'config', to_jsonb(p.proconfig),
               'acl', to_jsonb(p.proacl::text[]),
               'owner', p.proowner::regrole::text,
               'language', p.prolang)
        INTO now_shape
        FROM pg_proc p WHERE p.oid = to_regprocedure(substr(r.obj, 10));
    END IF;
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/54: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;

  -- 2. Each counts the balls of the over by the rule.
  SELECT count(*), string_agg(o, ', ') INTO n, drift FROM (
    SELECT 'match_live_score' AS o, pg_get_viewdef('match_live_score'::regclass) AS src
    UNION ALL SELECT 'innings_score_as_folded', prosrc FROM pg_proc WHERE oid = 'innings_score_as_folded(uuid,smallint)'::regprocedure
    UNION ALL SELECT 'bowler_over', pg_get_viewdef('bowler_over'::regclass)
    UNION ALL SELECT 'bowler_hat_trick', pg_get_viewdef('bowler_hat_trick'::regclass)
    UNION ALL SELECT 'player_bowling_since', prosrc FROM pg_proc WHERE oid = 'player_bowling_since(uuid,timestamptz)'::regprocedure
    UNION ALL SELECT 'opposition_squad', prosrc FROM pg_proc WHERE oid = 'opposition_squad(uuid)'::regprocedure
    UNION ALL SELECT 'player_bowling_by_season', pg_get_viewdef('player_bowling_by_season'::regclass)
    UNION ALL SELECT 'player_bowling_career', pg_get_viewdef('player_bowling_career'::regclass)) d
   WHERE d.src NOT LIKE '%ball_counts_in_over(%';
  IF n > 0 THEN
    RAISE EXCEPTION 'db/54: % do(es) not count the balls of the over through ball_counts_in_over(): %', n, drift;
  END IF;

  -- 3. The rule, case by case: countsInOver() (edition.test.mjs, E).
  SELECT string_agg(format('%s/%s=%s', coalesce(t, 'null'), coalesce(pl->>'notInOver', '-'),
                           coalesce(ball_counts_in_over(t, pl)::text, 'null')), ' ' ORDER BY k)
    INTO got
    FROM (VALUES
      (1, 'run', '{}'::jsonb),
      (2, 'W',   '{}'::jsonb),
      (3, 'B',   '{}'::jsonb),
      (4, 'LB',  '{}'::jsonb),
      (5, 'Wd',  '{}'::jsonb),
      (6, 'Nb',  '{}'::jsonb),
      (7, 'run', '{"notInOver":"illegal_fielding"}'::jsonb),
      (8, 'B',   '{"notInOver":"fielder_returning"}'::jsonb),
      (9, 'run', '{"notInOver":"distracting_striker"}'::jsonb),
      (10, 'LB', '{"notInOver":"obstructing_batter"}'::jsonb),
      (11, 'Nb', '{"notInOver":"obstructing_batter"}'::jsonb),
      (12, 'run', '{"notInOver":"helmet_struck"}'::jsonb),
      (13, NULL, '{}'::jsonb)) AS x(k, t, pl);
  want := 'run/-=true W/-=true B/-=true LB/-=true Wd/-=false Nb/-=false run/illegal_fielding=false '
       || 'B/fielder_returning=false run/distracting_striker=false LB/obstructing_batter=false '
       || 'Nb/obstructing_batter=false run/helmet_struck=true null/-=null';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'db/54: ball_counts_in_over() reads %, countsInOver() says %', got, want;
  END IF;

  -- 3b. The free hit's rule, case by case: freeHitsApply() (edition.test.mjs, G).
  SELECT string_agg(format('%s=%s', coalesce(quote_literal(f), 'null'), free_hits_apply(f)::text), ' ' ORDER BY k)
    INTO got
    FROM (VALUES (1, 'T20'), (2, 'One-Day'), (3, '50-over'), (4, 'T10'), (5, NULL), (6, ''),
                 (7, 'One-Day Declaration'), (8, 'Two-Day'), (9, 'multi-day'), (10, ' Two  Day '),
                 (11, 'TIMED'), (12, 'Declaration'), (13, 'Test'), (14, 'Three-Day')) AS x(k, f);
  want := '''T20''=true ''One-Day''=true ''50-over''=true ''T10''=true null=true ''''=true '
       || '''One-Day Declaration''=false ''Two-Day''=false ''multi-day''=false '' Two  Day ''=false '
       || '''TIMED''=false ''Declaration''=false ''Test''=false ''Three-Day''=false';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'db/54: free_hits_apply() reads %, freeHitsApply() says %', got, want;
  END IF;
  IF pg_get_functiondef('ball_on_free_hit(uuid,smallint,integer)'::regprocedure) NOT LIKE '%match_free_hits_apply(p_match)%' THEN
    RAISE EXCEPTION 'db/54: ball_on_free_hit() does not ask the match''s format';
  END IF;

  -- 4. The fixture, as the fold reads it (edition.test.mjs, E):
  --      seq  bowler  event                                       the fold
  --      1-5  A       five dots                                    balls 1-5 of over 0
  --      6    A       two runs, fielded illegally (28.2)           not one of the over
  --      7    -       five penalty runs to the batting side
  --      8    A       a dot                                        the sixth ball of over 0
  --      9    C       bowled                                       over 1, ball 1
  --      10   C       bowled                                       over 1, ball 2
  --      11   C       a dot, the striker distracted (41.4)         not one of the over
  --      12   -       five penalty runs to the batting side
  --      13   C       bowled                                       over 1, ball 3: a hat-trick
  --    Runs 2 + 5 + 5 = 12, wickets 3, balls of the over 9. A bowled one
  --    over of 6 off 7 deliveries; C 3 balls of over 1 off 4, and a
  --    hat-trick (a wide never broke one, and neither does this). The old
  --    count read 11 balls, split A's over in two (the dot at seq 8 in over
  --    1) and broke C's hat-trick.
  --  And the free hit: the same two deliveries — a no-ball, then A bowls the
  --  striker — in a T20 fixture and in a One-Day Declaration one. The T20
  --  saves the batter (no wicket, none of A's); the declaration match stands
  --  the wicket (one, A's). db/42's reading made both saved.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db54-' || v_school, 'db/54 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db54-' || v_user || '@example.invalid', 'db/54 proof, scorer', 'coach', v_school);
    INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
      (p_x, v_school, '1XI', 'db/54 Opener',  1, 'batter', (current_date - interval '16 years')::date),
      (p_y, v_school, '1XI', 'db/54 Partner', 2, 'batter', (current_date - interval '16 years')::date),
      (p_a, v_school, '1XI', 'db/54 Seamer',  3, 'bowler', (current_date - interval '16 years')::date),
      (p_c, v_school, '1XI', 'db/54 Spinner', 4, 'bowler', (current_date - interval '16 years')::date);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (m_a, v_school, '1XI', 'db/54 proof', now() - interval '7 days', 'cricket', 'T20', 20, 'complete'),
      (m_t, v_school, '1XI', 'db/54 proof, T20', now() - interval '6 days', 'cricket', 'T20', 20, 'complete'),
      (m_d, v_school, '1XI', 'db/54 proof, declaration', now() - interval '5 days', 'cricket', 'One-Day Declaration', 100, 'complete');
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value,
                            striker_id, non_striker_id, bowler_id, dismissal, payload)
    SELECT x.m, v_school, x.k, 1, 0, v_user, 'db54-proof',
           'db54:' || x.m || ':' || x.k, x.k, now(), 'ball', x.bt, 0, p_x, p_y, p_a, x.dis, '{}'::jsonb
      FROM (VALUES (m_t, 1, 'Nb', NULL), (m_t, 2, 'W', 'bowled'),
                   (m_d, 1, 'Nb', NULL), (m_d, 2, 'W', 'bowled')) AS x(m, k, bt, dis);
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value,
                            striker_id, non_striker_id, bowler_id, dismissal, payload)
    SELECT m_a, v_school, x.k, 1, 0, v_user, 'db54-proof',
           'db54:' || m_a || ':' || x.k, x.k, now(), x.kind, x.bt, x.v,
           CASE WHEN x.kind = 'ball' THEN p_x END, CASE WHEN x.kind = 'ball' THEN p_y END,
           CASE x.who WHEN 'A' THEN p_a WHEN 'C' THEN p_c END, x.dis, x.pl
      FROM (VALUES
        ( 1, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
        ( 2, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
        ( 3, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
        ( 4, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
        ( 5, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
        ( 6, 'ball',    'run', 2,    'A', NULL,     '{"notInOver":"illegal_fielding"}'::jsonb),
        ( 7, 'penalty', NULL,  NULL, NULL, NULL,    '{"runs":5,"toBattingTeam":true,"reason":"illegal_fielding"}'::jsonb),
        ( 8, 'ball',    'run', 0,    'A', NULL,     '{}'::jsonb),
        ( 9, 'ball',    'W',   0,    'C', 'bowled', '{}'::jsonb),
        (10, 'ball',    'W',   0,    'C', 'bowled', '{}'::jsonb),
        (11, 'ball',    'run', 0,    'C', NULL,     '{"notInOver":"distracting_striker"}'::jsonb),
        (12, 'penalty', NULL,  NULL, NULL, NULL,    '{"runs":5,"toBattingTeam":true,"reason":"distracting_striker"}'::jsonb),
        (13, 'ball',    'W',   0,    'C', 'bowled', '{}'::jsonb)
      ) AS x(k, kind, bt, v, who, dis, pl);

    SELECT concat_ws(' ',
             (SELECT 'live' || row(l.runs, l.wickets, l.legal_balls)::text FROM match_live_score l WHERE l.match_id = m_a AND l.innings = 0),
             (SELECT 'folded' || row(f.runs, f.wickets, f.legal_balls)::text FROM innings_score_as_folded(m_a, 0::smallint) f),
             (SELECT 'overs(' || string_agg(format('%s:%s:%s/%s', CASE o.bowler_id WHEN p_a THEN 'A' ELSE 'C' END,
                                                    o.over_no, o.legal_balls, o.deliveries), ' ' ORDER BY o.over_no, o.bowler_id) || ')'
                FROM bowler_over o WHERE o.match_id = m_a),
             (SELECT 'since(' || (SELECT legal_balls FROM player_bowling_since(p_a, NULL)) || ',' ||
                                 (SELECT legal_balls FROM player_bowling_since(p_c, NULL)) || ')'),
             (SELECT 'career(' || string_agg(l.legal_balls::text, ',' ORDER BY l.player_id = p_c) || ')'
                FROM player_bowling_career l WHERE l.player_id IN (p_a, p_c)),
             (SELECT 'season(' || string_agg(s.legal_balls::text, ',' ORDER BY s.player_id = p_c) || ')'
                FROM player_bowling_by_season s WHERE s.player_id IN (p_a, p_c)),
             (SELECT 'hattrick(' || coalesce(string_agg(CASE h.player_id WHEN p_c THEN 'C' ELSE 'A' END || '@' || h.completed_at_seq, ','), '') || ')'
                FROM bowler_hat_trick h WHERE h.match_id = m_a),
             (SELECT 't20(' || l.wickets || ',' || ball_on_free_hit(m_t, 0::smallint, 2) || ','
                     || (SELECT count(*) FROM bowler_innings_figures f WHERE f.match_id = m_t AND f.wickets > 0) || ')'
                FROM match_live_score l WHERE l.match_id = m_t),
             (SELECT 'declaration(' || l.wickets || ',' || ball_on_free_hit(m_d, 0::smallint, 2) || ','
                     || (SELECT count(*) FROM bowler_innings_figures f WHERE f.match_id = m_d AND f.wickets > 0) || ')'
                FROM match_live_score l WHERE l.match_id = m_d))
      INTO got;
    RAISE EXCEPTION USING ERRCODE = 'ZZ054', MESSAGE = 'db/54: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ054' THEN NULL;
  END;
  want := 'live(12,3,9) folded(12,3,9) overs(A:0:6/7 C:1:3/4) since(8,3) career(8,3) season(8,3) hattrick(C@13) '
       || 't20(0,true,0) declaration(1,false,1)';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'db/54: the fixture reads %, the fold reads % — a delivery that does not count is still counted, or a reader moved', got, want;
  END IF;

  -- And nothing of the proof is left: no row, no lifted door, no setting.
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school)
     OR EXISTS (SELECT 1 FROM app_user WHERE id = v_user)
     OR EXISTS (SELECT 1 FROM player WHERE id IN (p_x, p_y, p_a, p_c))
     OR EXISTS (SELECT 1 FROM match WHERE id IN (m_a, m_t, m_d))
     OR EXISTS (SELECT 1 FROM ball_event WHERE match_id IN (m_a, m_t, m_d))
     OR v_door IS DISTINCT FROM EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                                         AND tgname = 'ball_event_names_its_delivery' AND tgenabled = 'O')
     OR coalesce(current_setting('app.user_id', true), '') IS DISTINCT FROM v_setting THEN
    RAISE EXCEPTION 'db/54: the proof left something behind';
  END IF;
END $check$;

DROP TABLE _db54_before;

-- ══════════════════════════════════════════════════════════════════
--  64 · The scorebook importer, phase 2: careers and tables (SCRBRD-120)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-120_scorebook_importer.md
-- (Fable, 2026-09-30; D1–D13 decided by Kameel as recommended); phase 1 is
-- db/63 as built (§9.2). This file is phase 2 (§8): a boy's innings from a
-- paper scorebook counts in his career, his seasons and the opposition's
-- dossier on him, exactly as the fold counts it. §9.3 records it as built.
--
-- WHY. Every career reader aggregated `kind = 'ball'` rows of
-- ball_event_live. An imported innings has none — it is one innings_summary
-- event holding the checked card (db/63) — so each reader either gains one
-- branch or silently reports nothing for an innings the fold reports in full
-- (§2.4). The branch is the same everywhere and comes from two views over
-- the summary events:
--
--   summary_batting_line    one row per batting row of a card
--   summary_bowling_line    one row per bowling row of a card
--
-- `security_invoker`, over ball_event_live (so a summary an approved
-- amendment voided vanishes from every reader, as it does from the fold)
-- and match (for the match's start: a book has no clock). Both read the card
-- as the fold reads it (replay.mjs, KIND.INNINGS_SUMMARY): a card whose
-- total, wickets or overs the fold cannot read is ignored, a row without a
-- ref is skipped, a batter is out unless the card says not out or retired
-- hurt, a runs or wickets figure that is not a count is nought, and a
-- bowler's legal balls are his overs, six to the over.
--
-- OUR BOYS ONLY (D6). A line's player_id is its ref when the ref is a player
-- id, and NULL for a typed name (t:<n>): an opposition boy the scorer typed
-- is never a player row, so he is in no career, no table and no dossier.
-- The ids themselves are our school's by the commit's own checks (db/63:
-- `not_our_player` at submit and again at the commit; the door lets only the
-- commit write a summary).
--
-- NOTHING IS ZERO-FILLED (D12). A batter's balls, fours and sixes, and a
-- bowler's wides and no-balls, are NULL on a line where the card has none,
-- and every career sum counts them only where recorded: SQL's sum() skips a
-- NULL, and a figure is NULL only when nothing behind it was recorded (a
-- career of one book innings with no balls column has balls_faced NULL, not
-- 0). A delivery scored live always records all five, so every figure for
-- every boy with no summary reads exactly as before. player_unrecorded_figures
-- says, per boy and season, how much of his record lacks each figure, so a
-- screen can take a strike rate over the innings whose balls are known and
-- say "at least" of a boundary count (§9.3).
--
-- WHAT IS RE-EMITTED, each with one UNION ALL branch from the two lines and
-- its column list, types, options, owner and grants unchanged (checked at
-- the end against a snapshot taken first, as db/63 did):
--
--   player_innings              a batting row is an innings: runs, balls (or
--                               NULL), out. ended_at is the match's start.
--   player_batting_career       matches, runs, balls, fours, sixes, last_ball_at
--   player_bowling_career       matches, runs, legal balls, wides, no-balls, wickets
--   player_dismissals           a batting row that is out
--   player_dismissal_breakdown  ...by its howOut
--   player_*_by_season          the same three, filed under the season of the
--                               match's start (school_season_of(), db/44), never
--                               the day it was imported
--   player_batting_since()      the three windowed functions the lifetime views
--   player_bowling_since()      are proved equal to (db/49), windowed on the
--   player_dismissals_since()   match's start for a summary
--   bowler_innings_figures      a bowling row: wickets and runs conceded
--   player_wicket_breakdown     a bowler's dismissals on the card, by method
--   opposition_squad()          runs, balls (where recorded), dismissals (the
--                               bowler's), boundaries, innings, balls bowled,
--                               runs conceded, wickets. NO DOTS: a summary has
--                               no deliveries, so dots and dot_pct are over the
--                               deliveries scored live alone — NULL for a boy
--                               with none — and a strike rate is over the
--                               innings whose balls are recorded.
--
-- The design's list (§8) names the first eleven and opposition_squad().
-- player_dismissals_since(), bowler_innings_figures and
-- player_wicket_breakdown are here too: the first is the function db/49
-- holds player_dismissals to, and the other two are read beside the careers
-- (the passport's bowling line, player_milestone's five-for, the awards'
-- breakdowns, tools/smoke-fold-figures.mjs) — left out, they would disagree
-- with the fold and with the views next to them (§9.3).
--
-- NOT HERE. match_result() and the standings: SCRBRD-114's phase 3 has not
-- landed (§9.3 notes what it must read). The workload record (load_day,
-- phase 3): summary_bowling_line carries deliveries and bowled_on for it,
-- and nothing reads them yet. Wagon wheels, phases, matchups, the worm,
-- bowler_over, bowler_spell, milestone_watch() and every public read (§2.7,
-- "never"): each reads `kind = 'ball'` and gains no branch; nothing here is
-- granted to a public role, and the signed-out read path (db/59) is
-- untouched. The ratings read (services/api/read/read-api.mjs ratingsQuery)
-- is a per-delivery index and does not read a summary (§9.3).
--
-- search_path is pinned on the one SECURITY DEFINER function replaced
-- (opposition_squad(), as before); the views and the other functions run as
-- their caller, as they did.

-- ── 0 · The shape of everything replaced, before it is ──────────────
DROP TABLE IF EXISTS _db64_before;
CREATE TEMP TABLE _db64_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions), 'acl', to_jsonb(c.relacl::text[]), 'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND c.relname IN ('player_innings', 'player_batting_career', 'player_bowling_career', 'player_dismissals',
                     'player_dismissal_breakdown', 'player_batting_by_season', 'player_bowling_by_season',
                     'player_dismissals_by_season', 'bowler_innings_figures', 'player_wicket_breakdown')
UNION ALL
SELECT 'function:' || p.oid::regprocedure::text,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef, 'volatility', p.provolatile, 'parallel', p.proparallel, 'strict', p.proisstrict,
         'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
         'language', p.prolang)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.oid::regprocedure::text IN ('player_batting_since(uuid,timestamp with time zone)',
                                     'player_bowling_since(uuid,timestamp with time zone)',
                                     'player_dismissals_since(uuid,timestamp with time zone)',
                                     'opposition_squad(uuid)');

-- ── 1 · The two lines ───────────────────────────────────────────────
-- One row per batting row of every standing summary. A figure the card does
-- not record is NULL (balls, fours, sixes); runs are a count on every card
-- the commit writes, and nought on one it could not (the fold's `?? 0`).
-- is_bowlers is chargedToBowler(): a dismissal, and one of the bowler's by
-- the one SQL rule for it (dismissal_is_bowlers(), db/13).
CREATE OR REPLACE VIEW summary_batting_line WITH (security_invoker = true) AS
SELECT b.match_id,
       b.school_id,
       b.innings,
       b.seq,
       e.value ->> 'ref'                                                          AS ref,
       CASE WHEN (e.value ->> 'ref') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (e.value ->> 'ref')::uuid END                                    AS player_id,
       CASE WHEN scorebook_is_count(e.value -> 'order') THEN (e.value ->> 'order')::integer END AS order_no,
       CASE WHEN scorebook_is_count(e.value -> 'runs')  THEN (e.value ->> 'runs')::integer ELSE 0 END AS runs,
       CASE WHEN scorebook_is_count(e.value -> 'balls') THEN (e.value ->> 'balls')::integer END AS balls,
       CASE WHEN scorebook_is_count(e.value -> 'fours') THEN (e.value ->> 'fours')::integer END AS fours,
       CASE WHEN scorebook_is_count(e.value -> 'sixes') THEN (e.value ->> 'sixes')::integer END AS sixes,
       e.value ->> 'howOut'                                                       AS how_out,
       CASE WHEN jsonb_typeof(e.value -> 'bowlerRef') = 'string' THEN e.value ->> 'bowlerRef' END AS bowler_ref,
       CASE WHEN (e.value ->> 'bowlerRef') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (e.value ->> 'bowlerRef')::uuid END                              AS bowler_id,
       CASE WHEN jsonb_typeof(e.value -> 'fielderRef') = 'string' THEN e.value ->> 'fielderRef' END AS fielder_ref,
       coalesce(e.value ->> 'howOut', '') NOT IN ('not_out', 'retired_hurt')     AS is_dismissal,
       coalesce(e.value ->> 'howOut', '') NOT IN ('not_out', 'retired_hurt')
         AND coalesce(dismissal_is_bowlers(e.value ->> 'howOut'), false)          AS is_bowlers,
       m.starts_at                                                                AS played_at
  FROM ball_event_live b
  JOIN match m ON m.id = b.match_id
  CROSS JOIN LATERAL jsonb_array_elements(b.payload -> 'card' -> 'batting') AS e(value)
 WHERE b.kind = 'innings_summary'
   AND jsonb_typeof(b.payload -> 'card' -> 'batting') = 'array'
   AND scorebook_is_count(b.payload -> 'card' -> 'total')
   AND scorebook_is_count(b.payload -> 'card' -> 'wickets')
   AND scorebook_balls(b.payload -> 'card' -> 'overs') IS NOT NULL
   AND jsonb_typeof(e.value -> 'ref') = 'string'
   AND (e.value ->> 'ref') <> '';

-- One row per bowling row. Legal balls are his overs (nought where the fold
-- cannot read them); runs and wickets counts (nought otherwise); maidens,
-- wides and no-balls as the card has them or NULL. `deliveries` (legal balls,
-- wides and no-balls) is NULL unless both extras are recorded, and with
-- `bowled_on` (the match's day, Johannesburg, as player_milestone's) is for
-- the workload record's phase 3: nothing reads either yet.
CREATE OR REPLACE VIEW summary_bowling_line WITH (security_invoker = true) AS
SELECT b.match_id,
       b.school_id,
       b.innings,
       b.seq,
       e.value ->> 'ref'                                                          AS ref,
       CASE WHEN (e.value ->> 'ref') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (e.value ->> 'ref')::uuid END                                    AS player_id,
       CASE WHEN jsonb_typeof(e.value -> 'overs') = 'string' THEN e.value ->> 'overs' END AS overs_text,
       coalesce(scorebook_balls(e.value -> 'overs'), 0)                           AS legal_balls,
       CASE WHEN scorebook_is_count(e.value -> 'wides')   THEN (e.value ->> 'wides')::integer END   AS wides,
       CASE WHEN scorebook_is_count(e.value -> 'noBalls') THEN (e.value ->> 'noBalls')::integer END AS no_balls,
       coalesce(scorebook_balls(e.value -> 'overs'), 0)
         + CASE WHEN scorebook_is_count(e.value -> 'wides')   THEN (e.value ->> 'wides')::integer END
         + CASE WHEN scorebook_is_count(e.value -> 'noBalls') THEN (e.value ->> 'noBalls')::integer END AS deliveries,
       CASE WHEN scorebook_is_count(e.value -> 'maidens') THEN (e.value ->> 'maidens')::integer END AS maidens,
       CASE WHEN scorebook_is_count(e.value -> 'runs')    THEN (e.value ->> 'runs')::integer ELSE 0 END AS runs,
       CASE WHEN scorebook_is_count(e.value -> 'wickets') THEN (e.value ->> 'wickets')::integer ELSE 0 END AS wickets,
       (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date                    AS bowled_on,
       m.starts_at                                                                AS played_at
  FROM ball_event_live b
  JOIN match m ON m.id = b.match_id
  CROSS JOIN LATERAL jsonb_array_elements(b.payload -> 'card' -> 'bowling') AS e(value)
 WHERE b.kind = 'innings_summary'
   AND jsonb_typeof(b.payload -> 'card' -> 'bowling') = 'array'
   AND scorebook_is_count(b.payload -> 'card' -> 'total')
   AND scorebook_is_count(b.payload -> 'card' -> 'wickets')
   AND scorebook_balls(b.payload -> 'card' -> 'overs') IS NOT NULL
   AND jsonb_typeof(e.value -> 'ref') = 'string'
   AND (e.value ->> 'ref') <> '';

-- ── 2 · What a boy's record does not say ────────────────────────────
-- Per boy per season, how much of his record comes from a book that did not
-- record a figure: batting innings with no balls (and the runs made in
-- them, so a strike rate can be runs over balls where both are known),
-- innings with no fours or no sixes (a boundary count there is "at least"),
-- and bowling rows with no wides or no no-balls. A boy with nothing
-- unrecorded has no row. Scored live, everything is recorded.
CREATE OR REPLACE VIEW player_unrecorded_figures WITH (security_invoker = true) AS
SELECT x.player_id,
       school_season_of(x.played_at)                                              AS season,
       count(*) FILTER (WHERE x.bat AND x.no_balls)                               AS innings_without_balls,
       coalesce(sum(x.runs) FILTER (WHERE x.bat AND x.no_balls), 0)               AS runs_without_balls,
       count(*) FILTER (WHERE x.bat AND x.no_boundaries)                          AS innings_without_boundaries,
       count(*) FILTER (WHERE NOT x.bat AND x.no_extras)                          AS bowling_without_extras
  FROM (
    SELECT s.player_id, s.played_at, true AS bat, s.runs,
           s.balls IS NULL AS no_balls, (s.fours IS NULL OR s.sixes IS NULL) AS no_boundaries, false AS no_extras
      FROM summary_batting_line s
     WHERE s.player_id IS NOT NULL AND (s.balls IS NULL OR s.fours IS NULL OR s.sixes IS NULL)
    UNION ALL
    SELECT w.player_id, w.played_at, false, 0, false, false, (w.wides IS NULL OR w.no_balls IS NULL)
      FROM summary_bowling_line w
     WHERE w.player_id IS NOT NULL AND (w.wides IS NULL OR w.no_balls IS NULL)
  ) x
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id, school_season_of(x.played_at);

-- ── 3 · An innings ──────────────────────────────────────────────────
-- db/43's, and a batting row of a card: its runs, its balls (NULL where the
-- book has none), out as the fold says. A summarised innings has no ball,
-- so a boy's row in it is the card's alone and never merges with a live one.
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
         (b.ball_type = 'W'
          AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT DISTINCT FROM b.striker_id
          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)) AS out
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.striker_id IS NOT NULL
  UNION ALL
  SELECT ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload), b.match_id, b.innings, b.server_ts,
         0, 0, true
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.ball_type = 'W'
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT NULL
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS DISTINCT FROM b.striker_id
     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload), b.match_id, b.innings, b.server_ts,
         0, 0, true
    FROM ball_event_live b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
) x
GROUP BY x.player_id, x.match_id, x.innings
UNION ALL
SELECT s.player_id, s.match_id, s.innings, s.played_at, s.runs::bigint, s.balls::bigint, s.is_dismissal
  FROM summary_batting_line s
 WHERE s.player_id IS NOT NULL;

-- ── 4 · Batting: lifetime, by season, windowed ─────────────────────
-- db/49's, db/44's and db/43's, each over the same rows as before UNION ALL
-- a boy's batting rows. balls_faced, fours and sixes are sum() without the
-- coalesce: a live row always has a figure, so a group with one reads as it
-- did, and a group of book rows with none reads NULL (D12).
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
      FROM ball_event_live b
      -- db/44's three arms, NULLIF'd so a row counts once per player as the
      -- function's OR does (db/49).
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' THEN b.striker_id END, true),
        (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
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
      FROM ball_event_live b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' THEN b.striker_id END, true),
        (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
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

-- A match he batted in; for a summary, windowed on the match's start (the
-- book's innings happened then, whenever it was imported). No row at all is
-- nought, as before; rows whose every figure is unrecorded are NULL.
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
      FROM ball_event_live b
     WHERE ((b.kind = 'ball' AND b.striker_id = p_player)
            OR (b.kind = 'ball' AND b.ball_type = 'W'
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

-- ── 5 · Bowling: lifetime, by season, windowed ─────────────────────
-- db/54's, over the same deliveries UNION ALL a boy's bowling rows. Runs
-- conceded, legal balls and wickets are recorded on every row; wides and
-- no-balls are sum() without the coalesce, as balls faced above.
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
           CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END                                                 AS wickets
      FROM ball_event_live b
     WHERE b.kind = 'ball'
    UNION ALL
    SELECT w.player_id, w.match_id, w.runs, w.legal_balls, w.wides, w.no_balls, w.wickets
      FROM summary_bowling_line w
  ) x
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id;

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
           CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END                                                 AS wickets
      FROM ball_event_live b
     WHERE b.kind = 'ball'
    UNION ALL
    SELECT w.player_id, w.match_id, w.runs, w.legal_balls, w.wides, w.no_balls, w.wickets
      FROM summary_bowling_line w
  ) x
  JOIN match_season ms ON ms.match_id = x.match_id
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id, ms.season;

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
           CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END                                                 AS wickets
      FROM ball_event_live b
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

-- A bowler's innings (db/42's): a bowling row is his wickets and runs.
CREATE OR REPLACE VIEW bowler_innings_figures WITH (security_invoker = true) AS
SELECT b.bowler_id AS player_id, b.match_id, b.innings,
       count(*) FILTER (WHERE b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))::int AS wickets,
       coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)), 0)::int AS runs_conceded
  FROM ball_event_live b
 WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL
 GROUP BY b.bowler_id, b.match_id, b.innings
UNION ALL
SELECT w.player_id, w.match_id, w.innings, w.wickets, w.runs
  FROM summary_bowling_line w
 WHERE w.player_id IS NOT NULL;

-- A bowler's wickets by method (db/42's): the card's dismissals credited to
-- him, by howOut. The card's bowler wickets are these rows by the arithmetic
-- (summary_reconciles(): bowler_wickets).
CREATE OR REPLACE VIEW player_wicket_breakdown WITH (security_invoker = true) AS
SELECT x.player_id, x.dismissal, count(*) AS wickets
  FROM (
    SELECT b.bowler_id AS player_id, b.dismissal
      FROM ball_event_live b
     WHERE b.kind = 'ball' AND b.ball_type = 'W'
       AND b.bowler_id IS NOT NULL
       AND dismissal_is_bowlers(b.dismissal)
       AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
    UNION ALL
    SELECT s.bowler_id, s.how_out
      FROM summary_batting_line s
     WHERE s.is_bowlers AND s.bowler_id IS NOT NULL
  ) x
 GROUP BY x.player_id, x.dismissal;

-- ── 6 · Dismissals: lifetime, by season, windowed, by method ────────
CREATE OR REPLACE VIEW player_dismissals WITH (security_invoker = true) AS
SELECT x.player_id,
       count(*)                                                                   AS dismissals
  FROM (
    SELECT who.player_id, b.match_id
      FROM ball_event_live b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
              THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END),
        (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
                CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
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

CREATE OR REPLACE VIEW player_dismissals_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT x.player_id,
       ms.season,
       count(*)                                                                   AS dismissals
  FROM (
    SELECT who.player_id, b.match_id
      FROM ball_event_live b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
              THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END),
        (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
                CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
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

CREATE OR REPLACE FUNCTION player_dismissals_since(p_player uuid, p_from timestamptz)
RETURNS bigint AS $$
  SELECT (SELECT count(*)
            FROM ball_event_live b
           WHERE ((b.kind = 'ball' AND b.ball_type = 'W'
                   AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = p_player
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
                  OR ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) = p_player)
             AND (p_from IS NULL OR b.server_ts >= p_from))
       + (SELECT count(*)
            FROM summary_batting_line s
           WHERE s.player_id = p_player AND s.is_dismissal
             AND (p_from IS NULL OR s.played_at >= p_from))
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE VIEW player_dismissal_breakdown WITH (security_invoker = true) AS
SELECT x.player_id, x.dismissal, count(*) AS dismissals
FROM (
  SELECT ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) AS player_id, b.dismissal
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.ball_type = 'W'
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT NULL
     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
         ball_retirement_dismissal(b.kind, b.ball_type, b.dismissal, b.payload)
    FROM ball_event_live b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
  UNION ALL
  SELECT s.player_id, s.how_out
    FROM summary_batting_line s
   WHERE s.is_dismissal AND s.player_id IS NOT NULL
) x
GROUP BY x.player_id, x.dismissal;

-- ── 7 · The opposition's figures (db/54) ────────────────────────────
-- db/54's, with a boy's batting and bowling rows beside his deliveries. A
-- summary has no delivery, so it adds nothing to dots, and dots and dot_pct
-- are over the balls he faced LIVE: NULL for a boy with none (not nought —
-- a book records no dots, D12), and dot_pct NULL below thirty of them. The
-- strike rate is his runs over his balls in the innings whose balls are
-- recorded, floored on those balls; balls, fours and sixes are NULL for a
-- boy whose every innings left them unrecorded. The bowling figures are
-- recorded on every row. A boy with no innings at all reads as before.
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
           CASE WHEN b.ball_type = 'W'
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
      FROM ball_event_live b JOIN squad q ON q.id = b.striker_id
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
               CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                    THEN 1 ELSE 0 END AS wickets
          FROM ball_event_live b JOIN squad q ON q.id = b.bowler_id
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

REVOKE ALL ON FUNCTION opposition_squad(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opposition_squad(uuid) TO scrbrd_app;

-- ── 8 · Grants ─────────────────────────────────────────────────────
-- The application role reads the three new views, as it reads the careers;
-- a managed host's API roles read none of them (Supabase grants a new view
-- to them).
GRANT SELECT ON summary_batting_line, summary_bowling_line, player_unrecorded_figures TO scrbrd_app;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON summary_batting_line, summary_bowling_line, player_unrecorded_figures FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

-- ── 9 · The proof ────────────────────────────────────────────────
-- Built and rolled back. db/99 §42 is the fuller proof, with principals and
-- the real commit, on every verify paste; tools/smoke-fold-figures.mjs holds
-- the careers to the fold. This is what must hold the moment the file has run.
DO $check$
DECLARE
  r         record;
  now_shape jsonb;
  got       text;
  v_school  uuid := gen_random_uuid();
  v_user    uuid := gen_random_uuid();
  v_match   uuid := gen_random_uuid();
  v_live    uuid := gen_random_uuid();
  v_imp     uuid := gen_random_uuid();
  p_book    uuid := gen_random_uuid();   -- one book innings, no balls column
  p_both    uuid := gen_random_uuid();   -- a live innings and a book innings
  p_bowl    uuid := gen_random_uuid();   -- a book bowling row, no extras
  v_start   timestamptz := now() - interval '400 days';
  v_card    jsonb;
BEGIN
  -- 1. Nothing replaced changed shape.
  FOR r IN SELECT * FROM _db64_before LOOP
    IF r.obj LIKE 'view:%' THEN
      SELECT jsonb_build_object('options', to_jsonb(c.reloptions), 'acl', to_jsonb(c.relacl::text[]), 'owner', c.relowner::regrole::text,
               'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        INTO now_shape FROM pg_class c WHERE c.oid = to_regclass(substr(r.obj, 6));
    ELSE
      SELECT jsonb_build_object('result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
               'definer', p.prosecdef, 'volatility', p.provolatile, 'parallel', p.proparallel, 'strict', p.proisstrict,
               'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
               'language', p.prolang)
        INTO now_shape FROM pg_proc p WHERE p.oid = to_regprocedure(substr(r.obj, 10));
    END IF;
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/64: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _db64_before) <> 14 THEN RAISE EXCEPTION 'db/64: the shape snapshot is not the fourteen objects'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname IN ('summary_batting_line', 'summary_bowling_line', 'player_unrecorded_figures')
                AND NOT coalesce('security_invoker=true' = ANY (reloptions), false)) THEN
    RAISE EXCEPTION 'db/64: a new view runs as its owner';
  END IF;

  -- 2. A book innings, read by every career reader, then voided.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db64-' || v_school, 'db/64 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db64-' || v_user || '@example.invalid', 'db/64 proof', 'scorer', v_school);
    INSERT INTO player (id, school_id, full_name, team_code, born) VALUES
      (p_book, v_school, 'db/64 Book', '1XI', '2009-03-01'), (p_both, v_school, 'db/64 Both', '1XI', '2009-03-01'),
      (p_bowl, v_school, 'db/64 Bowl', '1XI', '2009-03-01');
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (v_match, v_school, '1XI', 'db/64 Opposition', v_start, 'cricket', 'T20', 20, 'complete'),
      (v_live,  v_school, '1XI', 'db/64 Live',       now() - interval '2 days', 'cricket', 'T20', 20, 'complete');
    -- p_both faced two live balls: a four, a dot.
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id, payload)
    VALUES (v_live, v_school, 1, 1, 0, v_user, 'db64-pad', 'db64:b1', 1, now(), 'ball', 'run', 4, p_both, NULL, '{}'),
           (v_live, v_school, 2, 1, 0, v_user, 'db64-pad', 'db64:b2', 2, now(), 'ball', 'run', 0, p_both, NULL, '{}');
    -- 30 for 2 in 5: p_book run out for 12 (no balls, no boundaries), p_both
    -- bowled for 15 off 10 with 2 fours, a typed name not out 1; p_bowl's
    -- analysis on the other side of the card does not matter to its sums
    -- here (the arithmetic is db/63's), only to the lines.
    v_card := jsonb_build_object('v', 1, 'innings', 0, 'battingSide', 'home',
      'batting', jsonb_build_array(
        jsonb_build_object('order', 1, 'ref', p_book, 'howOut', 'run_out', 'fielderRef', 't:1', 'bowlerRef', NULL,
                           'runs', 12, 'balls', NULL, 'fours', NULL, 'sixes', NULL),
        jsonb_build_object('order', 2, 'ref', p_both, 'howOut', 'bowled', 'fielderRef', NULL, 'bowlerRef', 't:2',
                           'runs', 15, 'balls', 10, 'fours', 2, 'sixes', 0),
        jsonb_build_object('order', 3, 'ref', 't:3', 'howOut', 'not_out', 'fielderRef', NULL, 'bowlerRef', NULL,
                           'runs', 1, 'balls', 2, 'fours', 0, 'sixes', 0)),
      'didNotBat', '[]'::jsonb,
      'bowling', jsonb_build_array(
        jsonb_build_object('ref', p_bowl, 'overs', '3.2', 'maidens', NULL, 'runs', 22, 'wickets', 1, 'wides', NULL, 'noBalls', NULL),
        jsonb_build_object('ref', 't:2', 'overs', '1.4', 'maidens', 0, 'runs', 8, 'wickets', 1, 'wides', 0, 'noBalls', 0)),
      'extras', jsonb_build_object('byes', 2, 'legByes', 0, 'wides', 0, 'noBalls', 0, 'penalty', 0),
      'total', 30, 'wickets', 2, 'overs', '5',
      'fallOfWickets', '[]'::jsonb, 'endReason', 'other', 'unreconciled', NULL);
    PERFORM set_config('scrbrd.scorebook_commit', v_imp::text, true);
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, payload)
    VALUES (v_match, v_school, 1, 1, 0, v_user, 'scorebook:' || v_imp, 'db64:summary', 1, now(), 'innings_summary',
            jsonb_build_object('card', v_card, 'typed', '{"t:1":"Opp One","t:2":"Opp Two","t:3":"Opp Three"}'::jsonb,
                               'source', jsonb_build_object('import', v_imp)));
    PERFORM set_config('scrbrd.scorebook_commit', '', true);

    -- The lines: our three boys by id, the typed names by nobody.
    SELECT string_agg(coalesce(l.player_id::text, l.ref) || ':' || l.runs || '/' || coalesce(l.balls::text, '-'), ' ' ORDER BY l.order_no)
      INTO got FROM summary_batting_line l WHERE l.match_id = v_match;
    IF got IS DISTINCT FROM format('%s:12/- %s:15/10 t:3:1/2', p_book, p_both) THEN
      RAISE EXCEPTION 'db/64: summary_batting_line reads %', got;
    END IF;
    IF (SELECT count(*) FROM summary_bowling_line l WHERE l.match_id = v_match AND l.player_id IS NULL AND l.ref = 't:2') <> 1
       OR (SELECT row(l.legal_balls, l.runs, l.wickets, l.wides, l.no_balls, l.deliveries, l.bowled_on = (v_start AT TIME ZONE 'Africa/Johannesburg')::date)::text
             FROM summary_bowling_line l WHERE l.player_id = p_bowl) IS DISTINCT FROM '(20,22,1,,,,t)' THEN
      RAISE EXCEPTION 'db/64: summary_bowling_line reads %', (SELECT jsonb_agg(l) FROM summary_bowling_line l WHERE l.match_id = v_match);
    END IF;

    -- Every reader: the book boy's balls, fours and sixes NULL; the other's
    -- live and book figures together; the bowler's extras NULL.
    SELECT concat_ws(' | ',
      (SELECT row(i.runs, i.balls_faced, i.out, i.ended_at = v_start)::text FROM player_innings i WHERE i.player_id = p_book),
      (SELECT row(c.matches, c.runs, c.balls_faced, c.fours, c.sixes, c.last_ball_at = v_start)::text FROM player_batting_career c WHERE c.player_id = p_book),
      (SELECT row(c.matches, c.runs, c.balls_faced, c.fours, c.sixes)::text FROM player_batting_career c WHERE c.player_id = p_both),
      (SELECT row(c.matches, c.runs, c.balls_faced, c.fours, c.sixes, c.last_ball_at = v_start)::text FROM player_batting_since(p_book, NULL) c),
      (SELECT row(c.matches, c.runs, c.balls_faced, c.fours, c.sixes)::text FROM player_batting_since(p_both, NULL) c),
      (SELECT row(c.matches, c.runs)::text FROM player_batting_since(p_book, v_start + interval '1 minute') c),
      (SELECT row(s.season = school_season_of(v_start), s.runs, s.balls_faced)::text FROM player_batting_by_season s WHERE s.player_id = p_book),
      (SELECT row(c.matches, c.runs_conceded, c.legal_balls, c.wides, c.no_balls, c.wickets)::text FROM player_bowling_career c WHERE c.player_id = p_bowl),
      (SELECT row(c.matches, c.runs_conceded, c.legal_balls, c.wides, c.no_balls, c.wickets)::text FROM player_bowling_since(p_bowl, NULL) c),
      (SELECT row(s.season = school_season_of(v_start), s.legal_balls, s.wides)::text FROM player_bowling_by_season s WHERE s.player_id = p_bowl),
      (SELECT row(f.wickets, f.runs_conceded)::text FROM bowler_innings_figures f WHERE f.player_id = p_bowl),
      (SELECT string_agg(d.player_id || '=' || d.dismissal, ',' ORDER BY d.dismissal) FROM player_dismissal_breakdown d WHERE d.player_id IN (p_book, p_both)),
      (SELECT sum(d.dismissals)::text FROM player_dismissals d WHERE d.player_id IN (p_book, p_both)),
      (SELECT sum(d.dismissals)::text FROM player_dismissals_by_season d WHERE d.player_id IN (p_book, p_both)),
      (player_dismissals_since(p_book, NULL) + player_dismissals_since(p_both, NULL))::text,
      (SELECT row(u.innings_without_balls, u.runs_without_balls, u.innings_without_boundaries)::text FROM player_unrecorded_figures u WHERE u.player_id = p_book),
      (SELECT row(u.bowling_without_extras)::text FROM player_unrecorded_figures u WHERE u.player_id = p_bowl))
      INTO got;
    IF got IS DISTINCT FROM concat_ws(' | ',
         '(12,,t,t)', '(1,12,,,,t)', '(2,19,12,3,0)', '(1,12,,,,t)', '(2,19,12,3,0)', '(0,0)', '(t,12,)',
         '(1,22,20,,,1)', '(1,22,20,,,1)', '(t,20,)', '(1,22)',
         format('%s=bowled,%s=run_out', p_both, p_book), '2', '2', '2', '(1,12,1)', '(1)') THEN
      RAISE EXCEPTION 'db/64: the careers read %', got;
    END IF;
    -- The opposition's player_id is nobody's: no line names a typed ref.
    IF EXISTS (SELECT 1 FROM summary_batting_line WHERE ref LIKE 't:%' AND (player_id IS NOT NULL OR bowler_id IS NOT NULL))
       OR EXISTS (SELECT 1 FROM player_innings i WHERE i.match_id = v_match AND i.player_id NOT IN (p_book, p_both)) THEN
      RAISE EXCEPTION 'db/64: a typed name became somebody';
    END IF;

    -- Voided, the book innings is in no reader.
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, payload)
    VALUES (v_match, v_school, 2, 1, 0, v_user, 'amendment', 'db64:void', 2, now(), 'void', '{"target":"db64:summary"}');
    SELECT concat_ws(' ',
      (SELECT count(*) FROM summary_batting_line WHERE match_id = v_match) + (SELECT count(*) FROM summary_bowling_line WHERE match_id = v_match),
      (SELECT count(*) FROM player_innings WHERE player_id IN (p_book, p_bowl)),
      (SELECT count(*) FROM player_batting_career WHERE player_id = p_book),
      (SELECT row(c.matches, c.runs, c.balls_faced)::text FROM player_batting_career c WHERE c.player_id = p_both),
      (SELECT count(*) FROM player_bowling_career WHERE player_id = p_bowl),
      (SELECT count(*) FROM player_dismissals WHERE player_id IN (p_book, p_both)),
      (SELECT count(*) FROM player_unrecorded_figures WHERE player_id IN (p_book, p_bowl)),
      (SELECT row(c.matches, c.balls_faced)::text FROM player_batting_since(p_book, NULL) c))
      INTO got;
    IF got IS DISTINCT FROM '0 0 0 (1,4,2) 0 0 0 (0,0)' THEN
      RAISE EXCEPTION 'db/64: a voided book innings still reads %', got;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ064', MESSAGE = 'db/64: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ064' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) THEN RAISE EXCEPTION 'db/64: the proof left something behind'; END IF;
END $check$;

DROP TABLE _db64_before;

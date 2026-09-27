-- ══════════════════════════════════════════════════════════════════
--  52 · Byes and leg byes off a no-ball are not the bowler's (Law 21.15)
-- ══════════════════════════════════════════════════════════════════
--
-- THE RULE, AS THE CODE IN FORCE FROM 1 OCTOBER 2026 HAS IT (MCC Laws, 2017
-- Code, 4th Edition 2026: 21.15 "Runs resulting from a No ball – how scored",
-- 18.10.2 and 18.10.3; Law 23. The 3rd Edition had the same rule at 21.16): the
-- one-run penalty for a no-ball is a No-ball extra, debited to the bowler.
-- Runs the batters complete, or a boundary, when the ball was hit are the
-- striker's, and debited to the bowler. When it was NOT hit they are Byes
-- or Leg byes, as appropriate, and are NOT debited to the bowler. 18.10.3:
-- the bowler is debited the striker's runs, No-ball extras and Wides, and
-- nothing else.
--
-- WHAT SQL DID. SCRBRD-068 (db/40) was built from 2000 Code research
-- (Law 24.13: every run resulting from a no-ball a No-ball extra, and every
-- one the bowler's). db/40 taught every batting figure that a no-ball's byes
-- are not the striker's (ball_runs_off_bat()), and left every bowling figure
-- charging the bowler `1 + value` for a no-ball whatever payload.nbRuns
-- said. Kameel moved the rule to the current Code on 2026-09-27
-- (docs/laws/CLAUSE_CHECK.md, "Behaviour mismatches noticed", 1). The fold
-- moved with this file: runsToBowler() in packages/scoring/src/events.mjs.
--
-- WHAT THIS FILE DOES. One rule, in SQL, beside db/40's:
--
--   ball_runs_to_bowler(ball_type, value, payload)   runsToBowler() in SQL:
--     a wide           1 + value
--     a no-ball        1 + ball_runs_off_bat()  — the penalty run and the
--                      runs off the bat; nothing when nbRuns says byes or
--                      leg byes beyond the penalty run
--     a run, a wicket  value
--     anything else    0 (a bye, a leg bye; and a NULL type, as db/40's
--                      ball_runs_off_bat() and every SQL fold before it —
--                      every reader here reads ball_event_live, whose
--                      ball_type_as_folded() (db/43) makes a typeless
--                      delivery a run first)
--
-- and every object that charged a bowler, redefined over it, nothing else
-- in it moved (each from its latest definition):
--
--   player_bowling_since(uuid, timestamptz)   db/42   runs_conceded
--   bowler_innings_figures                     db/42   runs_conceded
--   opposition_squad(uuid)                     db/43   runs_conceded (and economy from it)
--   player_bowling_by_season                   db/44   runs_conceded
--   player_bowling_career                      db/49   runs_conceded
--
-- Outside db/: the `career` read (services/api/read/read-api.mjs) asks
-- ball_runs_to_bowler() too, so it needs this file (expected-migrations.json).
--
-- WHAT DOES NOT MOVE. Totals: match_live_score, innings_score_as_folded(),
-- scoring_verify_takeover() — a no-ball is still 1 + value to the side, so a
-- handover verifies exactly as before. Balls: a no-ball is still no legal
-- ball and still a ball faced. Batting figures: db/40 already had them.
-- Wickets, hat-tricks, milestones: nothing about runs conceded. No SQL keeps
-- an extras-by-type breakdown; the scorecard's extras line is the fold's.
--
-- STORED ROWS ARE NOT REWRITTEN. The same value and payload.nbRuns read under
-- the current rule: a bowler whose log holds a no-ball with byes concedes
-- fewer runs from this file on, by exactly those byes. A no-ball with no
-- nbRuns (off the bat — every no-ball before SCRBRD-068) reads as before.
--
-- IDENTICAL SHAPE. Same columns, types and order (CREATE OR REPLACE VIEW
-- refuses anything else); security_invoker restated; the function
-- attributes, owner and grants as they were — the block at the end checks
-- all of it against a snapshot taken before. Idempotent: every statement is
-- CREATE OR REPLACE, the snapshot is replaced if it exists, and the proof
-- rolls itself back.
--
-- PROOF THAT SQL AND THE FOLD AGREE. The block at the end: ball_runs_to_bowler()
-- case by case against runsToBowler()'s table (replay.test.mjs, K); a
-- fixture folded by hand — the same events replay.test.mjs folds as "the
-- db/52 fixture" — read through all four bowler readers that take a player;
-- and, on every row the log holds, those four agreeing with each other.
-- opposition_squad() needs a fixture with an opposition: db/99's db/43
-- section has one. db/99 §19, §22 and that section carry no-ball byes and leg
-- byes, and §30 holds the rule on every verify paste;
-- tools/smoke-fold-figures.mjs compares every one of these readers with the
-- fold over generated logs.

-- ── The shape of everything this file replaces, before it does ─────
DROP TABLE IF EXISTS _db52_before;
CREATE TEMP TABLE _db52_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions),
         'acl', to_jsonb(c.relacl::text[]),
         'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND c.relname IN ('bowler_innings_figures', 'player_bowling_by_season', 'player_bowling_career')
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
         'player_bowling_since(uuid,timestamp with time zone)',
         'opposition_squad(uuid)');

-- ── The rule, in SQL ─────────────────────────────────────────────
-- runsToBowler() (events.mjs). The no-ball arm is db/40's ball_runs_off_bat()
-- written out, so the planner inlines one CASE.
CREATE OR REPLACE FUNCTION ball_runs_to_bowler(p_ball_type text, p_value integer, p_payload jsonb)
RETURNS integer AS $$
  SELECT CASE
           WHEN p_ball_type = 'Wd' THEN 1 + coalesce(p_value, 0)
           WHEN p_ball_type = 'Nb'
                AND coalesce(p_payload->>'nbRuns', '') IN ('byes', 'leg_byes') THEN 1
           WHEN p_ball_type = 'Nb' THEN 1 + coalesce(p_value, 0)
           WHEN p_ball_type IN ('run', 'W') THEN coalesce(p_value, 0)
           ELSE 0
         END
$$ LANGUAGE sql IMMUTABLE;

-- ── Bowling, windowed (db/42) ────────────────────────────────────
CREATE OR REPLACE FUNCTION player_bowling_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs_conceded bigint, legal_balls bigint,
               wides bigint, no_balls bigint, wickets bigint) AS $$
  SELECT
    count(DISTINCT b.match_id),
    coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)), 0),
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

-- ── A bowler's innings (db/42) ───────────────────────────────────
CREATE OR REPLACE VIEW bowler_innings_figures WITH (security_invoker = true) AS
SELECT b.bowler_id AS player_id, b.match_id, b.innings,
       count(*) FILTER (WHERE b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))::int AS wickets,
       coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)), 0)::int AS runs_conceded
  FROM ball_event_live b
 WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL
 GROUP BY b.bowler_id, b.match_id, b.innings;

-- ── The opposition's figures (db/43) ─────────────────────────────
-- db/43's, with runs conceded asked of ball_runs_to_bowler(). Nothing else
-- in it moved.
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
           count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb') AND coalesce(b.value,0) = 0)::int AS dots
      FROM ball_event_live b JOIN squad q ON q.id = b.striker_id
     WHERE b.kind = 'ball'
     GROUP BY b.striker_id
  ),
  bowl AS (
    SELECT b.bowler_id AS pid,
           count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb'))::int AS balls_bowled,
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

-- ── Bowling, by season (db/44) ───────────────────────────────────
-- Runs conceded are ball_runs_to_bowler()'s; byes and leg byes — off a
-- no-ball too — are not his; a wicket is his when the method is
-- (dismissal_is_bowlers()) and it stood (ball_wicket_stands()).
CREATE OR REPLACE VIEW player_bowling_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT b.bowler_id                                                                AS player_id,
       ms.season,
       count(DISTINCT b.match_id)                                                 AS matches,
       coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)), 0)     AS runs_conceded,
       coalesce(sum(CASE WHEN b.ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END), 0) AS legal_balls,
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

-- ── Bowling, lifetime (db/49) ────────────────────────────────────
-- player_bowling_by_season without the season.
CREATE OR REPLACE VIEW player_bowling_career WITH (security_invoker = true) AS
SELECT b.bowler_id                                                                AS player_id,
       count(DISTINCT b.match_id)                                                 AS matches,
       coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)), 0)     AS runs_conceded,
       coalesce(sum(CASE WHEN b.ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END), 0) AS legal_balls,
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
  p_a      uuid := gen_random_uuid();   -- on strike
  p_b      uuid := gen_random_uuid();   -- at the other end
  p_c      uuid := gen_random_uuid();   -- bowling
  v_door   boolean := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                               AND tgname = 'ball_event_names_its_delivery' AND tgenabled = 'O');
  v_setting text := coalesce(current_setting('app.user_id', true), '');
BEGIN
  -- 1. The shape: the same five objects, the same everything but their bodies.
  SELECT count(*) INTO n FROM _db52_before;
  IF n <> 5 THEN RAISE EXCEPTION 'db/52: expected to snapshot 5 objects, found %', n; END IF;
  FOR r IN SELECT * FROM _db52_before LOOP
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
      RAISE EXCEPTION 'db/52: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;

  -- 2. Each asks the rule, and none keeps the old `1 + value` for a no-ball.
  SELECT count(*), string_agg(o, ', ') INTO n, drift FROM (
    SELECT 'player_bowling_since' AS o, prosrc AS src FROM pg_proc WHERE oid = 'player_bowling_since(uuid,timestamptz)'::regprocedure
    UNION ALL SELECT 'opposition_squad', prosrc FROM pg_proc WHERE oid = 'opposition_squad(uuid)'::regprocedure
    UNION ALL SELECT 'bowler_innings_figures', pg_get_viewdef('bowler_innings_figures'::regclass)
    UNION ALL SELECT 'player_bowling_by_season', pg_get_viewdef('player_bowling_by_season'::regclass)
    UNION ALL SELECT 'player_bowling_career', pg_get_viewdef('player_bowling_career'::regclass)) d
   WHERE d.src NOT LIKE '%ball_runs_to_bowler(%'
      OR d.src ~* $re$in\s*\(\s*'Wd'\s*,\s*'Nb'\s*\)\s*\)?\s*then\s*\(?\s*1\s*\+$re$;
  IF n > 0 THEN
    RAISE EXCEPTION 'db/52: % do(es) not charge the bowler through ball_runs_to_bowler(): %', n, drift;
  END IF;

  -- 3. The rule, case by case: runsToBowler()'s table in replay.test.mjs (K).
  SELECT string_agg(format('%s/%s/%s=%s', t, coalesce(v::text, 'null'), coalesce(nb, '-'), ball_runs_to_bowler(t, v, pl)), ' ' ORDER BY k)
    INTO got
    FROM (VALUES
      (1, 'Nb',  4, NULL,       '{}'::jsonb),
      (2, 'Nb',  4, 'byes',     '{"nbRuns":"byes"}'::jsonb),
      (3, 'Nb',  3, 'leg_byes', '{"nbRuns":"leg_byes"}'::jsonb),
      (4, 'Nb',  0, NULL,       '{}'::jsonb),
      (5, 'Wd',  2, NULL,       '{}'::jsonb),
      (6, 'B',   4, NULL,       '{}'::jsonb),
      (7, 'LB',  1, NULL,       '{}'::jsonb),
      (8, 'run', 6, NULL,       '{}'::jsonb),
      (9, 'W',   1, NULL,       '{}'::jsonb),
      (10, 'Nb', NULL, 'byes',  '{"nbRuns":"byes"}'::jsonb)) AS x(k, t, v, nb, pl);
  want := 'Nb/4/-=5 Nb/4/byes=1 Nb/3/leg_byes=1 Nb/0/-=1 Wd/2/-=3 B/4/-=0 LB/1/-=0 run/6/-=6 W/1/-=1 Nb/null/byes=1';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'db/52: ball_runs_to_bowler() reads %, runsToBowler() says %', got, want;
  END IF;

  -- 4. On every row the log holds, as whoever runs this file: the five
  --    copies of the rule agree — the lifetime view, the windowed function,
  --    the seasons summed and the innings summed, per bowler. Empty on a
  --    fresh install; the whole log on a database that has one.
  WITH d AS (
    SELECT 'career/since ' || coalesce(l.player_id, o.player_id) AS k
      FROM player_bowling_career l
      FULL JOIN (SELECT p.id AS player_id, c.* FROM player p CROSS JOIN LATERAL player_bowling_since(p.id, NULL) c
                  WHERE c.matches > 0) o ON o.player_id = l.player_id
     WHERE l.runs_conceded IS DISTINCT FROM o.runs_conceded
    UNION ALL
    SELECT 'career/seasons ' || l.player_id
      FROM player_bowling_career l
      JOIN (SELECT player_id, sum(runs_conceded) AS runs FROM player_bowling_by_season GROUP BY player_id) s
        ON s.player_id = l.player_id
     WHERE l.runs_conceded IS DISTINCT FROM s.runs
    UNION ALL
    SELECT 'career/innings ' || l.player_id
      FROM player_bowling_career l
      JOIN (SELECT player_id, sum(runs_conceded) AS runs FROM bowler_innings_figures GROUP BY player_id) f
        ON f.player_id = l.player_id
     WHERE l.runs_conceded IS DISTINCT FROM f.runs)
  SELECT count(*), string_agg(k, '; ') INTO n, drift FROM d;
  IF n > 0 THEN
    RAISE EXCEPTION 'db/52: % bowler figure(s) on this database disagree between the readers: %', n, left(drift, 600);
  END IF;

  -- 5. The fixture: "the db/52 fixture" in packages/scoring/test/replay.test.mjs
  --    (K), which the fold reads as 17 conceded off 4 legal balls, 1 wide,
  --    5 no-balls, 1 wicket. Written as the owner in a school that exists
  --    only inside this block, then undone by the sentinel.
  --      k  event                         fold: to the bowler
  --      1  no-ball, nothing run          1
  --      2  no-ball, hit for four         5   (the free hit carried on)
  --      3  no-ball, four byes            1
  --      4  no-ball, three leg byes       1
  --      5  no-ball, two byes             1
  --      6  wide, one run                 2
  --      7  four byes                     0   (legal: takes the free hit)
  --      8  one leg bye                   0
  --      9  six                           6
  --     10  bowled                        0, a wicket
  --   The old rule (db/40–49) read 26: 1 + 5 + 5 + 4 + 3 + 2 + 6.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db52-' || v_school, 'db/52 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db52-' || v_user || '@example.invalid', 'db/52 proof, scorer', 'coach', v_school);
    INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
      (p_a, v_school, '1XI', 'db/52 Opener',  1, 'batter', (current_date - interval '16 years')::date),
      (p_b, v_school, '1XI', 'db/52 Partner', 2, 'batter', (current_date - interval '16 years')::date),
      (p_c, v_school, '1XI', 'db/52 Seamer',  3, 'bowler', (current_date - interval '16 years')::date);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (m_a, v_school, '1XI', 'db/52 proof', now() - interval '7 days', 'cricket', 'T20', 20, 'complete');
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value,
                            striker_id, non_striker_id, bowler_id, dismissal, payload)
    SELECT m_a, v_school, x.k, 1, 0, v_user, 'db52-proof',
           'db52:' || m_a || ':' || x.k, x.k, now(), 'ball', x.bt, x.v,
           p_a, p_b, p_c, x.dis, x.pl
      FROM (VALUES
        ( 1, 'Nb',  0, NULL,     '{}'::jsonb),
        ( 2, 'Nb',  4, NULL,     '{}'::jsonb),
        ( 3, 'Nb',  4, NULL,     '{"nbRuns":"byes"}'::jsonb),
        ( 4, 'Nb',  3, NULL,     '{"nbRuns":"leg_byes"}'::jsonb),
        ( 5, 'Nb',  2, NULL,     '{"nbRuns":"byes"}'::jsonb),
        ( 6, 'Wd',  1, NULL,     '{}'::jsonb),
        ( 7, 'B',   4, NULL,     '{}'::jsonb),
        ( 8, 'LB',  1, NULL,     '{}'::jsonb),
        ( 9, 'run', 6, NULL,     '{}'::jsonb),
        (10, 'W',   0, 'bowled', '{}'::jsonb)
      ) AS x(k, bt, v, dis, pl);

    SELECT concat_ws(' ',
             (SELECT 'since' || row(s.matches, s.runs_conceded, s.legal_balls, s.wides, s.no_balls, s.wickets)::text
                FROM player_bowling_since(p_c, NULL) s),
             (SELECT 'career' || row(l.matches, l.runs_conceded, l.legal_balls, l.wides, l.no_balls, l.wickets)::text
                FROM player_bowling_career l WHERE l.player_id = p_c),
             (SELECT 'season' || row(sum(b.matches), sum(b.runs_conceded), sum(b.legal_balls), sum(b.wides), sum(b.no_balls), sum(b.wickets))::text
                FROM player_bowling_by_season b WHERE b.player_id = p_c),
             (SELECT 'innings' || row(f.wickets, f.runs_conceded)::text
                FROM bowler_innings_figures f WHERE f.player_id = p_c AND f.match_id = m_a))
      INTO got;
    RAISE EXCEPTION USING ERRCODE = 'ZZ052', MESSAGE = 'db/52: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ052' THEN NULL;
  END;
  want := 'since(1,17,4,1,5,1) career(1,17,4,1,5,1) season(1,17,4,1,5,1) innings(1,17)';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'db/52: the fixture reads %, the fold reads % — a no-ball''s byes are still charged, or a reader moved', got, want;
  END IF;

  -- And nothing of the proof is left: no row, no lifted door, no setting.
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school)
     OR EXISTS (SELECT 1 FROM app_user WHERE id = v_user)
     OR EXISTS (SELECT 1 FROM player WHERE id IN (p_a, p_b, p_c))
     OR EXISTS (SELECT 1 FROM match WHERE id = m_a)
     OR EXISTS (SELECT 1 FROM ball_event WHERE match_id = m_a)
     OR v_door IS DISTINCT FROM EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                                         AND tgname = 'ball_event_names_its_delivery' AND tgenabled = 'O')
     OR coalesce(current_setting('app.user_id', true), '') IS DISTINCT FROM v_setting THEN
    RAISE EXCEPTION 'db/52: the proof left something behind';
  END IF;
END $check$;

DROP TABLE _db52_before;

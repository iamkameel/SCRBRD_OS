-- ══════════════════════════════════════════════════════════════════
--  121 · The Laws audit of 28 October 2026, as Kameel decided it
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. audit/AUDIT_scoring_laws_2026-10-28.md (a read-only audit of
-- the scoring against the Laws) and its §6, Kameel's decisions of 28 October
-- 2026. The fold moved first (packages/scoring: events.mjs, replay.mjs,
-- laws.mjs; packages/scoring/test/laws-audit.test.mjs); this file is the same
-- rules in SQL, so every reader of ball_event agrees with the fold again. Its
-- proof is db/99 §98; tools/smoke-fold-figures.mjs and tools/smoke-free-hit.mjs
-- hold SQL to the fold over generated logs, a case for each finding.
--
-- WHAT CHANGES ON A LIVE DATABASE, by finding
--
--   F5  A run out that completed a bye or a leg bye. A wicket ball may now
--       carry payload.nbRuns ("byes" | "leg_byes"), as a no-ball does: its
--       runs are then not the striker's and not the bowler's.
--         ball_runs_off_bat()     a W's runs, unless nbRuns says byes or
--                                 leg byes (runsOffBat())
--         ball_runs_to_bowler()   the same for the bowler (runsToBowler())
--         public_shot_sectors()   the sector's runs off the bat through
--                                 ball_runs_off_bat(), one rule, not its own
--       Every reader of the two functions follows (careers, seasons, the
--       opposition, the matchups, milestones). STORED ROWS ARE NOT
--       REWRITTEN: no wicket ball stored before the pad asked carries nbRuns,
--       so every one reads exactly as before.
--   F7  Fours and sixes are boundaries (Q4). A delivery may carry
--       payload.boundary = false: runs off the bat that did not reach the
--       rope (four all run; two and four overthrows). The four career
--       readers of a batter's boundaries count it as no four and no six:
--         ball_boundary()                    new: boundaryHit() in SQL
--         player_batting_career, player_batting_by_season (views),
--         player_batting_since(), opposition_squad()   db/87's, the two
--                                 boundary columns through ball_boundary()
--         public_match_log()      db/78's, carrying `boundary` to the
--                                 public page's fold
--       Absent — every delivery stored before, and every 4 and 6 key the pad
--       has ("Four, boundary", "Six, maximum") — a four or six off the bat
--       is a boundary, as before. No figure moves on the paste.
--   Q2  The free hit follows a front-foot no-ball only; F11, a delivery that
--       does not count in the over (17.3.2.5) leaves the free hit for the
--       next (Q9).
--         ball_gives_free_hit()   new: givesFreeHit() in SQL — a no-ball of
--                                 nbType front_foot, or of no recorded kind
--         ball_on_free_hit()      db/54's, reading the last earlier delivery
--                                 that counts in the over or earns a free
--                                 hit (a wide, a waist-high no-ball or a
--                                 beamer, and a delivery not in the over are
--                                 passed over)
--       ONE THING MOVES ON THE PASTE: a stored wicket off the ball after a
--       waist-high no-ball or a beamer (nbType height or beamer), which was
--       saved as a free hit, now stands — in every SQL wicket count, the live
--       score and the handover check, as the fold now counts it. And a
--       bowler's dismissal right after a fair delivery marked notInOver that
--       followed a no-ball, which stood, is now saved. No pilot match holds
--       either; a database that does is told by db/99 §98's count.
--   F10 A chase terminated ahead of the umpires' par is won by the runs it is
--       ahead (Q3), not by the wickets in hand.
--         match_result_compute()  db/73's, that one arm. A result already
--                                 confirmed on such a chase (db/114) has a
--                                 new result_hash, and lapses to be
--                                 confirmed again, as any change of the
--                                 result does.
--   F4  An amendment re-judges who faced (Q5): when an approved amendment
--       voids an older delivery, the balls after it in its innings are folded
--       again and who faced each is the fold's, not the pad's stamp.
--         ball_event_rejudged     new table: (match, seq) → the striker the
--                                 fold gives that ball after the amendment,
--                                 written only by
--         scoring_amendment_rejudge(amendment, rows)   new, definer: by the
--                                 approver of that amendment, in the
--                                 transaction that approved it; the API's
--                                 amendment route folds the log and passes
--                                 what differs (services/api/write/rejudge.mjs)
--         ball_event_live         db/71's, its striker_id the re-judged one
--                                 where there is one. Every career, season,
--                                 dismissal, milestone and matchup reader
--                                 reads it.
--       Read under the ball's own read policy (the row's ball_event must be
--       readable), and never by a scoring device's pad credential (the pad
--       guard). An amendment approved before this file is not re-judged
--       until the next one on its match (DEPLOYING.md, db/121).
--
-- NOT HERE (no SQL needs them): F1 (the end on every run out: payload.outAt
-- decides which end empties, never who is out), F2 (a Two-Day's third and
-- fourth innings: the Laws check and the pad), F3 (partnerships: SQL keeps
-- none), F13 (the fall of wickets' notation: SQL keeps none).
--
-- IDENTICAL SHAPE. Every object replaced keeps its columns, types, order,
-- attributes, owner and grants (CREATE OR REPLACE; db/87's, db/78's, db/71's,
-- db/73's and db/54's statements as they stand but for the lines marked
-- db/121). REFUSES TO RUN unless each is what the earlier file wrote, or this
-- file's own (§0). Idempotent: a second paste changes nothing.


-- ── 0 · What this file stands on ───────────────────────────────────
DO $base$
DECLARE
  src text;
  bad text := '';
  -- A function's body (prosrc), or a view's definition: the earlier file's
  -- fingerprint, or this file's.
  FUNCTION_BASES CONSTANT text[][] := ARRAY[
    ['ball_runs_off_bat(text,integer,jsonb)',   'WHEN p_ball_type IN (''run'', ''W'') THEN coalesce(p_value, 0)',  'db/121'],
    ['ball_runs_to_bowler(text,integer,jsonb)', 'WHEN p_ball_type IN (''run'', ''W'') THEN coalesce(p_value, 0)',  'db/121'],
    ['ball_on_free_hit(uuid,smallint,integer)', 'b.ball_type IS DISTINCT FROM ''Wd''',                            'db/121'],
    ['match_result_compute(uuid)',              'innings_par_as_folded',                                         'db/121'],
    ['player_batting_since(uuid,timestamp with time zone)', 'ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4', 'ball_boundary('],
    ['opposition_squad(uuid)',                  'ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4',         'ball_boundary('],
    ['public_match_log(uuid,integer)',          '''place''',                                                     '''boundary'''],
    ['public_shot_sectors(uuid)',               'b.ball_type IN (''run'', ''W'')',                               'db/121']];
  k int;
BEGIN
  IF to_regclass('scoring_amendment') IS NULL OR to_regprocedure('scoring_amendment_decide(uuid,boolean,text)') IS NULL
     OR to_regprocedure('pad_scope_guard_install(regclass)') IS NULL OR to_regprocedure('ball_is_wicket(text,text)') IS NULL
     OR to_regprocedure('ball_counts_in_over(text,jsonb)') IS NULL OR to_regprocedure('match_free_hits_apply(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/121: db/38, db/50, db/54, db/69 or db/87 is missing; apply them first';
  END IF;
  FOR k IN 1 .. array_length(FUNCTION_BASES, 1) LOOP
    SELECT p.prosrc INTO src FROM pg_proc p WHERE p.oid = to_regprocedure(FUNCTION_BASES[k][1]);
    IF src IS NULL OR (position(FUNCTION_BASES[k][2] IN src) = 0 AND position(FUNCTION_BASES[k][3] IN src) = 0) THEN
      bad := bad || FUNCTION_BASES[k][1] || ' ';
    END IF;
  END LOOP;
  -- A view keeps no comment: its definition, read back.
  IF position('ball_is_wicket' IN coalesce(pg_get_viewdef('player_batting_career'::regclass), '')) = 0 THEN bad := bad || 'player_batting_career '; END IF;
  IF position('ball_is_wicket' IN coalesce(pg_get_viewdef('player_batting_by_season'::regclass), '')) = 0 THEN bad := bad || 'player_batting_by_season '; END IF;
  IF position('super_over' IN coalesce(pg_get_viewdef('ball_event_live'::regclass), '')) = 0 THEN bad := bad || 'ball_event_live '; END IF;
  IF bad <> '' THEN
    RAISE EXCEPTION 'db/121: not what the earlier files wrote (nor this file''s): %— the base is wrong', bad;
  END IF;
END $base$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · F5: a wicket ball's byes and leg byes
-- ══════════════════════════════════════════════════════════════════
-- runsOffBat() (events.mjs): a run's value is the striker's; a no-ball's and
-- a wicket ball's are, unless payload.nbRuns says byes or leg byes; nothing
-- else is. A NULL ball_type scores nothing here, as db/40's did.
CREATE OR REPLACE FUNCTION ball_runs_off_bat(p_ball_type text, p_value integer, p_payload jsonb)
RETURNS integer AS $$
  /* db/121: a wicket ball's byes are not his (the Laws audit, F5) */
  SELECT CASE
           WHEN p_ball_type = 'run' THEN coalesce(p_value, 0)
           WHEN p_ball_type IN ('Nb', 'W')
                AND coalesce(p_payload->>'nbRuns', '') NOT IN ('byes', 'leg_byes') THEN coalesce(p_value, 0)
           ELSE 0
         END
$$ LANGUAGE sql IMMUTABLE;

-- runsToBowler() (events.mjs): a wide's penalty run and every run off it; a
-- no-ball's penalty run and the runs off the bat; a run's runs, and a wicket
-- ball's off the bat; never a bye or a leg bye.
CREATE OR REPLACE FUNCTION ball_runs_to_bowler(p_ball_type text, p_value integer, p_payload jsonb)
RETURNS integer AS $$
  /* db/121: a wicket ball's byes are not the bowler's (the Laws audit, F5) */
  SELECT CASE
           WHEN p_ball_type = 'Wd' THEN 1 + coalesce(p_value, 0)
           WHEN p_ball_type = 'Nb'
                AND coalesce(p_payload->>'nbRuns', '') IN ('byes', 'leg_byes') THEN 1
           WHEN p_ball_type = 'Nb' THEN 1 + coalesce(p_value, 0)
           WHEN p_ball_type = 'run' THEN coalesce(p_value, 0)
           WHEN p_ball_type = 'W'
                AND coalesce(p_payload->>'nbRuns', '') IN ('byes', 'leg_byes') THEN 0
           WHEN p_ball_type = 'W' THEN coalesce(p_value, 0)
           ELSE 0
         END
$$ LANGUAGE sql IMMUTABLE;

-- public_shot_sectors: db/71's, its runs off the bat ball_runs_off_bat()'s.
CREATE OR REPLACE FUNCTION public_shot_sectors(p_match uuid)
RETURNS TABLE (innings smallint, sector smallint, shots integer, runs integer) AS $$
  SELECT b.innings, b.seg, count(*)::integer, sum(b.value)::integer
    FROM ball_event_career b
   WHERE b.match_id = p_match
     AND b.kind = 'ball'
     AND b.seg IS NOT NULL
     AND coalesce(b.value, 0) > 0
     -- db/121: runs off the bat as runsOffBat() counts them: a wicket
     -- ball's byes or leg byes are not (the Laws audit, F5). Key by key,
     -- as a public read takes the payload.
     AND (b.ball_type = 'run'
          OR (b.ball_type IN ('Nb', 'W') AND coalesce(b.payload ->> 'nbRuns', '') NOT IN ('byes', 'leg_byes')))
     AND public_fixture_served(b.match_id)
   GROUP BY b.innings, b.seg
   ORDER BY b.innings, b.seg
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public_shot_sectors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_shot_sectors(uuid) TO scrbrd_app;


-- ══════════════════════════════════════════════════════════════════
-- §2 · F7: a four or a six is a boundary
-- ══════════════════════════════════════════════════════════════════
-- boundaryHit() (events.mjs): 4 or 6 — the runs off the bat of a run or a
-- no-ball, unless payload.boundary is false (all run, or with overthrows) —
-- else NULL.
CREATE OR REPLACE FUNCTION ball_boundary(p_ball_type text, p_value integer, p_payload jsonb)
RETURNS integer AS $$
  SELECT CASE
           WHEN p_ball_type NOT IN ('run', 'Nb') OR p_ball_type IS NULL THEN NULL
           WHEN coalesce(p_payload->>'boundary', '') = 'false' THEN NULL
           WHEN ball_runs_off_bat(p_ball_type, p_value, p_payload) IN (4, 6) THEN ball_runs_off_bat(p_ball_type, p_value, p_payload)
         END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
GRANT EXECUTE ON FUNCTION ball_boundary(text, integer, jsonb) TO scrbrd_app;

CREATE OR REPLACE VIEW player_batting_career WITH (security_invoker = true) AS
-- db/121: db/87's, its fours and sixes boundaries (ball_boundary()).
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
                 AND ball_boundary(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END AS fours,
           CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                 AND ball_boundary(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END AS sixes,
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

CREATE OR REPLACE VIEW player_batting_by_season WITH (security_invoker = true) AS
-- db/121: db/87's, its fours and sixes boundaries (ball_boundary()).
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
                 AND ball_boundary(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END AS fours,
           CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                 AND ball_boundary(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END AS sixes,
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

CREATE OR REPLACE FUNCTION player_batting_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs bigint, balls_faced bigint, fours bigint,
               sixes bigint, last_ball_at timestamptz) AS $$
  /* db/121: db/87's, its fours and sixes boundaries (ball_boundary()). */
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
                 AND ball_boundary(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END AS fours,
           CASE WHEN b.kind = 'ball' AND b.striker_id = p_player AND b.ball_type IN ('run','Nb')
                 AND ball_boundary(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END AS sixes,
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

CREATE OR REPLACE FUNCTION opposition_squad(p_match uuid)
RETURNS TABLE (player_id uuid, school_id uuid, full_name text, team_code text,
               playing_role text, batting_style text, bowling_style text,
               innings integer, balls integer, runs integer, dismissals integer,
               fours integer, sixes integer, dots integer,
               strike_rate numeric, dot_pct numeric, batting_evidence text,
               balls_bowled integer, runs_conceded integer, wickets integer,
               economy numeric, bowling_evidence text) AS $$
  /* db/121: db/87's, his fours and sixes boundaries (ball_boundary()). */
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
           -- His boundaries: off the bat, off a run or a no-ball, the ball to the rope (boundaryHit()).
           CASE WHEN b.ball_type IN ('run','Nb') AND ball_boundary(b.ball_type, b.value, b.payload) = 4
                THEN 1 ELSE 0 END AS fours,
           CASE WHEN b.ball_type IN ('run','Nb') AND ball_boundary(b.ball_type, b.value, b.payload) = 6
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

-- public_match_log: db/78's, with `boundary` among a ball's fields (the API
-- keeps it only as `false`: services/api/public/redact.mjs).
CREATE OR REPLACE FUNCTION public_match_log(p_match uuid, p_since integer DEFAULT 0)
RETURNS TABLE (
  seq integer, innings smallint, kind text, ball_type text, value smallint,
  striker_id uuid, non_striker_id uuid, bowler_id uuid, dismissed_id uuid, dismissal text,
  event_key text, client_ts timestamptz, detail jsonb
) AS $$
  SELECT b.seq, b.innings, b.kind, b.ball_type, b.value,
         b.striker_id, b.non_striker_id, b.bowler_id, b.dismissed_id, b.dismissal,
         b.idempotency_key, b.client_ts,
         jsonb_strip_nulls(jsonb_build_object(
           -- innings_start
           'battingTeam',    b.payload -> 'battingTeam',
           'bowlingTeam',    b.payload -> 'bowlingTeam',
           'teamKey',        b.payload -> 'teamKey',
           'bowlingTeamKey', b.payload -> 'bowlingTeamKey',
           'squad',          b.payload -> 'squad',
           'bowlingSquad',   b.payload -> 'bowlingSquad',
           'overs',          b.payload -> 'overs',
           'target',         b.payload -> 'target',
           'superOver',      b.payload -> 'superOver',   -- db/71: the nth super over
           -- a player the scorer typed, where the column holds no id
           'striker',        b.payload -> 'striker',
           'nonStriker',     b.payload -> 'nonStriker',
           'bowler',         b.payload -> 'bowler',
           'dismissed',      b.payload -> 'dismissed',
           -- batters
           'captainConsent', b.payload -> 'captainConsent',
           -- ball
           'fielder',        b.payload -> 'fielder',
           'freeHit',        b.payload -> 'freeHit',
           'nbRuns',         b.payload -> 'nbRuns',
           'nbType',         b.payload -> 'nbType',
           'outAt',          b.payload -> 'outAt',
           'facesNext',      b.payload -> 'facesNext',
           'notInOver',      b.payload -> 'notInOver',
           -- db/121 (the Laws audit, F7): runs that did not reach the boundary
           'boundary',       b.payload -> 'boundary',
           -- db/78 (SCRBRD-139): a ball's shot, an id the API keeps only if
           -- it is one of SHOT_WORDS'; and the material of where it went, for
           -- the API to turn into a word and drop (redact.mjs). Each as
           -- fromRow() reads it: the payload's, else the column's.
           'shot',           CASE WHEN b.kind = 'ball' THEN coalesce(b.payload -> 'shot', to_jsonb(b.shot)) END,
           'place',          CASE WHEN b.kind = 'ball' THEN nullif(jsonb_strip_nulls(jsonb_build_object(
                               'theta',  coalesce(b.payload -> 'theta', to_jsonb(b.theta)),
                               'radius', coalesce(b.payload -> 'radius', to_jsonb(b.radius)),
                               'seg',    coalesce(b.payload -> 'seg', to_jsonb(b.seg)),
                               'source', coalesce(b.payload -> 'placementSource', to_jsonb(b.placement_source)))), '{}'::jsonb) END,
           -- penalty
           'runs',           b.payload -> 'runs',
           'toBattingTeam',  b.payload -> 'toBattingTeam',
           -- retire; penalty, innings_end and revision reasons (the API keeps
           -- a reason only where it is a code from a closed list)
           'batter',         b.payload -> 'batter',
           'reason',         b.payload -> 'reason',
           -- innings_end
           'confirmed',      b.payload -> 'confirmed',
           -- innings_summary (db/63): the card, less the note on a difference
           'card',           CASE WHEN b.kind = 'innings_summary' THEN (b.payload -> 'card') #- '{unreconciled,note}' END,
           -- SCRBRD-130 R1: a stop's or resumption's time; the umpires' par
           -- (the API keeps each only for its kind: redact.mjs)
           'at',             b.payload -> 'at',
           'par',            b.payload -> 'par')) AS detail
    FROM ball_event b
   WHERE b.match_id = p_match
     AND b.seq > coalesce(p_since, 0)
     AND b.kind IN ('innings_start', 'batters', 'bowler', 'ball', 'penalty', 'retire',
                    'innings_end', 'revision', 'void', 'innings_summary',
                    'play_stopped', 'play_resumed')
     AND public_fixture_served(b.match_id)
   ORDER BY b.seq
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public_match_log(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_match_log(uuid, integer) TO scrbrd_app;


-- ══════════════════════════════════════════════════════════════════
-- §3 · Q2 and F11: the free hit
-- ══════════════════════════════════════════════════════════════════
-- givesFreeHit() (events.mjs): a no-ball of nbType front_foot, or of none
-- recorded (every no-ball before the pad asked earns the free hit it did).
CREATE OR REPLACE FUNCTION ball_gives_free_hit(p_ball_type text, p_payload jsonb)
RETURNS boolean AS $$
  SELECT coalesce(p_ball_type = 'Nb' AND coalesce(p_payload->>'nbType', 'front_foot') = 'front_foot', false)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
GRANT EXECUTE ON FUNCTION ball_gives_free_hit(text, jsonb) TO scrbrd_app;

-- db/54's, in a match whose format gives free hits: the last live delivery
-- of this innings before this one that COUNTS IN THE OVER OR EARNS A FREE
-- HIT was a no-ball. The fold's rule (replay.mjs): a free hit is set by a
-- delivery that earns one and spent by the next that counts; a wide, a
-- no-ball that earns none and a delivery not in the over leave it as it was.
CREATE OR REPLACE FUNCTION ball_on_free_hit(p_match uuid, p_innings smallint, p_seq integer)
RETURNS boolean AS $$
  /* db/121: front-foot no-balls only (Q2); a delivery not in the over passed over (F11) */
  SELECT match_free_hits_apply(p_match) AND coalesce((
    SELECT b.ball_type IS NOT DISTINCT FROM 'Nb'
      FROM ball_event_live b
     WHERE b.match_id = p_match AND b.innings = p_innings AND b.seq < p_seq
       AND b.kind = 'ball'
       AND (ball_counts_in_over(b.ball_type, b.payload) OR ball_gives_free_hit(b.ball_type, b.payload))
     ORDER BY b.seq DESC
     LIMIT 1), false)
$$ LANGUAGE sql STABLE PARALLEL SAFE;


-- ══════════════════════════════════════════════════════════════════
-- §4 · F10: ahead of par is won by runs
-- ══════════════════════════════════════════════════════════════════
-- match_result_compute: db/73's (describeResult(), line for line), its
-- par arm as Kameel decided it. Nothing else in it moved.

CREATE OR REPLACE FUNCTION match_result_compute(p_match uuid)
RETURNS TABLE (match_id uuid, outcome text, margin_kind text, margin integer, decided_by text,
               winner_side text, winner_school_id uuid, winner_team_code text, winner_key text,
               super_overs jsonb, decision jsonb, decision_applied boolean,
               play_outcome text, play_winner_side text, play_winner_key text, play_margin_kind text, play_margin integer,
               innings jsonb, result_hash text) AS $$
DECLARE
  m        match%ROWTYPE;
  d        record;
  s        record;
  i        record;
  v_play   jsonb;
  v_fourth boolean;
  v_ips    integer;
  v_inns   jsonb := '[]';
  v_n      integer := 0;
  v_key0   text;
  v_other  text;
  v_side0  text;
  v_home   text;
  v_away   text;
  -- play's answer
  p_out    text := 'in_progress';
  p_kind   text;
  p_margin integer;
  p_side   text;
  p_key    text;
  x0 jsonb; x1 jsonb; x2 jsonb; x3 jsonb; win jsonb; oth jsonb;
  v_t      integer;
  v_least  jsonb;
  v_lead   integer;
  v_method text;      -- SCRBRD-130 R1
  -- the answer
  r_out    text;
  r_kind   text;
  r_margin integer;
  r_side   text;
  r_key    text;
  r_by     text;
  r_dec    jsonb;
  r_applied boolean := false;
  r_school uuid;
  r_team   text;
  -- db/71: the super overs
  v_m      integer := 0;     -- the match's own innings so far
  v_mi     jsonb;            -- the match's own innings, in order
  v_sos    jsonb := '[]';    -- the super overs, as describeResult() lists them
  v_so_applies boolean := false;
  v_so_by  text;
  v_so_n   integer;
  v_so_settled boolean := false;
  sa jsonb; sb jsonb; v_st text; v_ws text; v_wk text; v_so_t integer;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND THEN RETURN; END IF;
  -- The frozen play part only: a preview never decides a logged match.
  v_play := coalesce((SELECT c.doc->'play' FROM match_conditions c WHERE c.match_id = p_match), '{}'::jsonb);
  v_fourth := (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date >= DATE '2026-10-01';
  v_ips := CASE WHEN v_play->'format.innings_per_side' = '2'::jsonb THEN 2 ELSE 1 END;
  v_home := coalesce(m.team_code, 'Home');
  v_away := m.opponent;

  -- The innings in the order of their numbers (deriveMatch() compacts).
  -- (db/71) Each innings carries its super over, NULL for the match's own;
  -- only the match's own are `scheduled` (net run rate reads no other, §6.4).
  FOR i IN SELECT b.innings, max(b.super_over) AS so FROM ball_event_live b WHERE b.match_id = p_match
            GROUP BY b.innings ORDER BY b.innings LOOP
    SELECT * INTO s FROM innings_result_state(p_match, i.innings, v_play, v_fourth);
    v_inns := v_inns || jsonb_build_array(jsonb_build_object(
      'innings', i.innings, 'position', v_n, 'scheduled', i.so IS NULL AND v_m < 2 * v_ips, 'super_over', i.so,
      'runs', s.runs, 'wickets', s.wickets, 'balls', s.balls, 'overs', s.overs, 'target', s.target,
      'complete', s.complete, 'end_reason', s.end_reason, 'sealed', s.sealed, 'penalty_win', s.penalty_win,
      'key', s.team_key, 'batting_team', s.batting_team, 'squad', s.squad_size, 'revised', s.revised, 'summarised', s.summarised)
      -- ── SCRBRD-130 R1: the umpires' par, and an open stop (inn.par, inn.stopped) ──
      || jsonb_build_object('par', innings_par_as_folded(p_match, i.innings),
                            'stopped', innings_stop_open(p_match, i.innings) AND NOT coalesce(s.sealed, false)));
    v_n := v_n + 1;
    IF i.so IS NULL THEN v_m := v_m + 1; END IF;
  END LOOP;

  -- Which side bats each innings: by name; else the other of the first other
  -- side named; else home. An innings whose key is not the first's is the
  -- other side's.
  -- (db/71) Over the match's own innings: a super over's are the same sides.
  v_mi := coalesce((SELECT jsonb_agg(y.value ORDER BY y.n) FROM jsonb_array_elements(v_inns) WITH ORDINALITY y(value, n)
                     WHERE y.value->'super_over' = 'null'::jsonb), '[]'::jsonb);
  v_key0 := v_mi->0->>'key';
  SELECT y.value->>'key' INTO v_other FROM jsonb_array_elements(v_mi) WITH ORDINALITY y(value, n)
   WHERE y.value->>'key' IS NOT NULL AND NOT result_key_eq(y.value->>'key', v_key0) ORDER BY y.n LIMIT 1;
  v_side0 := coalesce(CASE WHEN result_key_eq(v_key0, v_home) THEN 'home' WHEN result_key_eq(v_key0, v_away) THEN 'away' END,
                      CASE WHEN result_key_eq(v_other, v_home) THEN 'away' WHEN result_key_eq(v_other, v_away) THEN 'home' END,
                      'home');
  SELECT jsonb_agg(y.value || jsonb_build_object('side',
           CASE WHEN result_key_eq(y.value->>'key', v_key0) THEN v_side0 WHEN v_side0 = 'home' THEN 'away' ELSE 'home' END) ORDER BY y.n)
    INTO v_inns FROM jsonb_array_elements(v_inns) WITH ORDINALITY y(value, n);
  v_inns := coalesce(v_inns, '[]'::jsonb);
  -- (db/71) The match's outcome is read from its own innings alone (D7).
  v_mi := coalesce((SELECT jsonb_agg(y.value ORDER BY y.n) FROM jsonb_array_elements(v_inns) WITH ORDINALITY y(value, n)
                     WHERE y.value->'super_over' = 'null'::jsonb), '[]'::jsonb);

  -- ── SCRBRD-130 R1: a revised chase target (revisedTargetMethod(), D8) ──
  -- One innings a side, the chase carrying a par or a target other than the
  -- first innings plus one: the chase says under which method (the words'
  -- suffix), and the first innings carries its deemed figures for net run
  -- rate — the par, or the last announced target less one, off the chase's
  -- allotted balls (its balls faced, when it was terminated). The match's
  -- own two innings only (v_mi, db/71): a super over is never revised, and
  -- rain never sets its target. They lead v_inns (a super over's innings
  -- number follows the match's), so the positions written are theirs.
  IF v_ips = 1 AND jsonb_array_length(v_mi) >= 2
     AND v_inns->0->'super_over' = 'null'::jsonb AND v_inns->1->'super_over' = 'null'::jsonb THEN
    x0 := v_mi->0; x1 := v_mi->1;
    IF jsonb_typeof(x1->'par') = 'number'
       OR (jsonb_typeof(x1->'target') = 'number' AND (x1->>'target')::integer IS DISTINCT FROM (x0->>'runs')::integer + 1) THEN
      v_method := CASE WHEN v_play->>'target.method' = 'dls_standard' THEN 'dls_standard' ELSE 'umpires_revision' END;
      v_inns := jsonb_set(v_inns, '{1}', x1 || jsonb_build_object('revised_target', v_method));
      v_inns := jsonb_set(v_inns, '{0}', x0 || jsonb_build_object(
        'nrr_runs', coalesce((x1->>'par')::integer, (x1->>'target')::integer - 1),
        'nrr_balls', CASE WHEN x1->>'end_reason' = 'abandoned' THEN (x1->>'balls')::integer ELSE (x1->>'overs')::integer * 6 END));
      v_mi := jsonb_set(jsonb_set(v_mi, '{1}', v_inns->1), '{0}', v_inns->0);
    END IF;
  END IF;
  -- ── end SCRBRD-130 R1 ──
  x0 := v_mi->0; x1 := v_mi->1; x2 := v_mi->2; x3 := v_mi->3;

  IF v_ips = 2 THEN
    -- Two innings a side (D11).
    IF (x0->>'complete')::boolean AND (x1->>'complete')::boolean AND (x2->>'complete')::boolean AND x2->>'end_reason' = 'all_out' THEN
      SELECT sum(CASE WHEN result_key_eq(y->>'key', x2->>'key') THEN -(y->>'runs')::integer ELSE (y->>'runs')::integer END)
        INTO v_lead FROM jsonb_array_elements(jsonb_build_array(x0, x1, x2)) y;
      SELECT y INTO oth FROM jsonb_array_elements(jsonb_build_array(x0, x1, x2)) WITH ORDINALITY t(y, n)
       WHERE NOT result_key_eq(y->>'key', x2->>'key') ORDER BY t.n LIMIT 1;
      IF oth IS NOT NULL AND v_lead > 0 THEN
        p_out := 'win'; win := oth; p_kind := 'innings'; p_margin := v_lead;
      END IF;
    END IF;
    IF p_out = 'in_progress' AND (x3->>'complete')::boolean AND x3->>'end_reason' IS DISTINCT FROM 'abandoned' THEN
      SELECT y INTO oth FROM jsonb_array_elements(jsonb_build_array(x0, x1, x2)) WITH ORDINALITY t(y, n)
       WHERE NOT result_key_eq(y->>'key', x3->>'key') ORDER BY t.n LIMIT 1;
      v_t := coalesce((x3->>'target')::integer,
                      (SELECT sum(CASE WHEN result_key_eq(y->>'key', x3->>'key') THEN -(y->>'runs')::integer ELSE (y->>'runs')::integer END)
                         FROM jsonb_array_elements(jsonb_build_array(x0, x1, x2)) y) + 1);
      IF (x3->>'runs')::integer >= v_t THEN
        p_out := 'win'; win := x3;
        IF (x3->>'penalty_win')::boolean THEN p_kind := 'penalty_runs'; p_margin := NULL;
        ELSE p_kind := 'wickets';
             p_margin := least(10, coalesce(nullif((x3->>'squad')::integer, 0), 11) - 1) - (x3->>'wickets')::integer; END IF;
      ELSIF x3->>'end_reason' = 'all_out' AND oth IS NOT NULL THEN
        IF v_t - 1 - (x3->>'runs')::integer > 0 THEN
          p_out := 'win'; win := oth; p_kind := 'runs'; p_margin := v_t - 1 - (x3->>'runs')::integer;
        ELSE p_out := 'tie'; END IF;
      END IF;
    END IF;
    IF p_out = 'in_progress' AND m.status = 'complete' THEN p_out := 'draw'; END IF;
  ELSE
    -- One innings a side: the second is the chase.
    IF x0 IS NULL OR x1 IS NULL OR NOT (x1->>'complete')::boolean THEN
      p_out := CASE WHEN m.status = 'complete' THEN 'no_result' ELSE 'in_progress' END;
    ELSIF x1->>'end_reason' = 'abandoned' THEN
      -- ── SCRBRD-130 R1 (D2): a chase terminated with the umpires' par is
      -- decided on it; without one, no result. result.min_overs_per_side
      -- reads the overs faced (whole overs of legal balls) here. ──
      v_least := v_play->'result.min_overs_per_side';
      IF jsonb_typeof(x1->'par') IS DISTINCT FROM 'number' THEN
        p_out := 'no_result';
      ELSIF jsonb_typeof(v_least) = 'number' AND (v_least #>> '{}')::numeric = trunc((v_least #>> '{}')::numeric)
            AND (v_least #>> '{}')::numeric > 0 AND (x1->>'balls')::integer / 6 < (v_least #>> '{}')::numeric THEN
        p_out := 'no_result';
      ELSIF (x1->>'runs')::integer > (x1->>'par')::integer THEN
        -- db/121 (Kameel, 28 Oct 2026, the Laws audit Q3, F10): ahead of par
        -- is won by the runs it is ahead, not the wickets in hand.
        p_out := 'win'; win := x1; p_kind := 'runs';
        p_margin := (x1->>'runs')::integer - (x1->>'par')::integer;
      ELSIF (x1->>'runs')::integer = (x1->>'par')::integer THEN
        p_out := 'tie';
      ELSE
        p_out := 'win'; win := x0; p_kind := 'runs'; p_margin := (x1->>'par')::integer - (x1->>'runs')::integer;
      END IF;
      -- ── end SCRBRD-130 R1 ──
    ELSE
      v_t := coalesce((x1->>'target')::integer, (x0->>'runs')::integer + 1);
      v_least := v_play->'result.min_overs_per_side';
      IF (x1->>'runs')::integer >= v_t THEN
        p_out := 'win'; win := x1;
        IF (x1->>'penalty_win')::boolean THEN p_kind := 'penalty_runs'; p_margin := NULL;
        ELSE p_kind := 'wickets';
             p_margin := least(10, coalesce(nullif((x1->>'squad')::integer, 0), 11) - 1) - (x1->>'wickets')::integer; END IF;
      ELSIF jsonb_typeof(v_least) = 'number' AND (v_least #>> '{}')::numeric = trunc((v_least #>> '{}')::numeric)
            AND (v_least #>> '{}')::numeric > 0 AND (x1->>'overs')::integer < (v_least #>> '{}')::numeric
            AND x1->>'end_reason' = 'overs_complete' THEN
        p_out := 'no_result';
      ELSIF v_t - 1 - (x1->>'runs')::integer > 0 THEN
        p_out := 'win'; win := x0; p_kind := 'runs'; p_margin := v_t - 1 - (x1->>'runs')::integer;
      ELSE
        p_out := 'tie';
      END IF;
    END IF;
  END IF;
  IF p_out = 'win' THEN
    p_side := win->>'side'; p_key := win->>'key';
    p_out := CASE p_side WHEN 'home' THEN 'home_win' WHEN 'away' THEN 'away_win' END;
  END IF;
  -- The organiser's status: a match abandoned with no result is abandoned.
  IF m.status = 'abandoned' AND p_out NOT IN ('home_win', 'away_win', 'tie', 'draw') THEN
    p_out := 'abandoned'; p_kind := NULL; p_margin := NULL; p_side := NULL; p_key := NULL;
  END IF;

  -- ── db/71 · the super overs (design §2.2, §3.2, §3.6; D7) ──
  -- describeResult(), line for line: only where the match's document provides
  -- one (result.tie_break = super_over, one innings a side) and the match is
  -- tied. Each pair is won, tied or incomplete (pairState()); the first that
  -- is not tied settles it — a pair won names who goes through, anything else
  -- leaves it to nobody until the organiser's award. The match's outcome
  -- stays the tie the table reads. A super over the document does not
  -- provide (the write path refuses one, D10) is listed nowhere.
  IF p_out = 'tie' AND v_play->'result.tie_break' = '"super_over"'::jsonb AND v_ips = 1 THEN
    v_so_applies := true;
    FOR v_so_n IN SELECT DISTINCT (y->>'super_over')::integer FROM jsonb_array_elements(v_inns) y
                   WHERE y->'super_over' <> 'null'::jsonb ORDER BY 1 LOOP
      SELECT t.y INTO sa FROM jsonb_array_elements(v_inns) WITH ORDINALITY t(y, n)
       WHERE (t.y->>'super_over')::integer = v_so_n ORDER BY t.n LIMIT 1;
      SELECT t.y INTO sb FROM jsonb_array_elements(v_inns) WITH ORDINALITY t(y, n)
       WHERE (t.y->>'super_over')::integer = v_so_n ORDER BY t.n OFFSET 1 LIMIT 1;
      v_ws := NULL; v_wk := NULL;
      IF sb IS NULL OR NOT (sa->>'complete')::boolean OR NOT (sb->>'complete')::boolean
         OR coalesce(sa->>'end_reason', '') = 'abandoned' OR coalesce(sb->>'end_reason', '') = 'abandoned' THEN
        v_st := 'incomplete';
      ELSE
        v_so_t := coalesce((sb->>'target')::integer, (sa->>'runs')::integer + 1);
        IF (sb->>'runs')::integer >= v_so_t THEN v_st := 'won'; v_ws := sb->>'side'; v_wk := sb->>'key';
        ELSIF (sb->>'runs')::integer = v_so_t - 1 THEN v_st := 'tied';
        ELSE v_st := 'won'; v_ws := sa->>'side'; v_wk := sa->>'key';
        END IF;
      END IF;
      v_sos := v_sos || jsonb_build_array(jsonb_build_object(
        'n', v_so_n, 'first', sa->>'side',
        'a', jsonb_build_object('runs', (sa->>'runs')::integer, 'wickets', (sa->>'wickets')::integer, 'balls', (sa->>'balls')::integer),
        'b', CASE WHEN sb IS NOT NULL
                  THEN jsonb_build_object('runs', (sb->>'runs')::integer, 'wickets', (sb->>'wickets')::integer, 'balls', (sb->>'balls')::integer) END,
        'state', v_st, 'winner', v_ws, 'winner_key', v_wk));
      IF NOT v_so_settled THEN
        IF v_st = 'won' THEN v_so_by := 'super_over'; p_side := v_ws; p_key := v_wk; v_so_settled := true;
        ELSIF v_st <> 'tied' THEN v_so_settled := true;
        END IF;
      END IF;
    END LOOP;
  END IF;


  -- The decision, read last (result.mjs applyDecision()).
  r_out := p_out; r_kind := p_kind; r_margin := p_margin; r_side := p_side; r_key := p_key;
  r_by := CASE WHEN v_so_applies THEN v_so_by WHEN p_out IN ('home_win', 'away_win', 'tie', 'draw') THEN 'play' END;
  SELECT x.* INTO d FROM match_result_decision x WHERE x.match_id = p_match AND x.withdrawn_at IS NULL;
  IF FOUND THEN
    r_dec := jsonb_build_object('id', d.id, 'kind', d.kind, 'side', d.side, 'overrides_play', d.overrides_play,
                                'reason', d.reason, 'by', d.decided_by, 'at', d.decided_at);
    IF d.kind = 'awarded' AND d.overrides_play THEN
      r_out := d.side || '_win'; r_kind := 'awarded'; r_margin := NULL; r_side := d.side; r_key := NULL;
      r_by := 'decision'; r_applied := true;
    ELSIF p_out IN ('home_win', 'away_win') OR r_by = 'super_over' THEN
      NULL;   -- play, or (db/71) a super over, named a winner: it stands, the decision is shown beside it
    ELSIF d.kind = 'conceded' THEN
      r_side := CASE d.side WHEN 'home' THEN 'away' ELSE 'home' END;
      r_out := r_side || '_win'; r_kind := 'conceded'; r_margin := NULL; r_key := NULL; r_by := 'decision'; r_applied := true;
    ELSIF d.kind = 'walkover' THEN
      r_side := d.side;
      r_out := r_side || '_win'; r_kind := 'walkover'; r_margin := NULL; r_key := NULL; r_by := 'decision'; r_applied := true;
    ELSIF d.kind = 'awarded' THEN
      -- Who goes through; the match's own outcome stands for the table.
      r_side := d.side; r_key := NULL; r_by := 'decision'; r_applied := true;
    END IF;
  END IF;
  IF r_side = 'home' THEN r_school := m.school_id; r_team := m.team_code;
  ELSIF r_side = 'away' THEN r_school := m.away_school_id; r_team := m.away_team_code; END IF;

  RETURN QUERY SELECT p_match, r_out, r_kind, r_margin, r_by, r_side, r_school, r_team, r_key,
    v_sos, r_dec, r_applied, p_out, p_side, p_key, p_kind, p_margin, v_inns,
    md5(concat_ws('|', r_out, coalesce(r_kind, '-'), coalesce(r_margin::text, '-'), coalesce(r_by, '-'),
                  coalesce(r_side, '-'), coalesce(r_school::text, '-'), coalesce(r_team, '-')));
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §5 · F4: who faced, re-judged after an amendment
-- ══════════════════════════════════════════════════════════════════
-- One row per delivery whose striker the fold gives differently from the
-- pad's stamp, once an approved amendment has voided an earlier ball of its
-- innings. striker_id NULL is "a batter SCRBRD holds no row for" (a typed
-- name), as on ball_event. The amendment that re-judged it, so the paperwork
-- and the log join up.
CREATE TABLE IF NOT EXISTS ball_event_rejudged (
  match_id     uuid NOT NULL,
  seq          integer NOT NULL,
  striker_id   uuid REFERENCES player(id),
  amendment_id uuid NOT NULL REFERENCES scoring_amendment(id),
  rejudged_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seq),
  FOREIGN KEY (match_id, seq) REFERENCES ball_event (match_id, seq)
);
COMMENT ON TABLE ball_event_rejudged IS
  'db/121 (the Laws audit F4): who faced a delivery, as the fold re-judged it after an approved amendment voided an earlier ball of its innings. Read through ball_event_live; written only by scoring_amendment_rejudge().';
ALTER TABLE ball_event_rejudged ENABLE ROW LEVEL SECURITY;
-- Read exactly where its delivery is: the row's ball_event, under the
-- reader's own ball_event policy. No write policy: the definer below is the
-- one door.
DROP POLICY IF EXISTS ball_event_rejudged_read ON ball_event_rejudged;
CREATE POLICY ball_event_rejudged_read ON ball_event_rejudged
  FOR SELECT USING (EXISTS (SELECT 1 FROM ball_event b
                             WHERE b.match_id = ball_event_rejudged.match_id AND b.seq = ball_event_rejudged.seq));
REVOKE ALL ON ball_event_rejudged FROM PUBLIC;
GRANT SELECT ON ball_event_rejudged TO scrbrd_app;
-- A scoring device's pad credential reads none (db/50): it folds the log.
SELECT pad_scope_guard_install('ball_event_rejudged'::regclass) AS pad_guards;

-- ball_event_live: db/71's, its striker_id the re-judged one where there is one.
CREATE OR REPLACE VIEW ball_event_live WITH (security_invoker = true) AS
SELECT b.id, b.match_id, b.school_id, b.seq, b.epoch, b.innings,
       b.scorer_user_id, b.device_id, b.idempotency_key, b.client_seq, b.client_ts, b.server_ts,
       b.kind,
       CASE WHEN b.kind = 'retire' AND b.ball_type = 'W'
                 AND retirement_resumed(b.match_id, b.innings, b.seq, b.payload->>'batter') THEN NULL
            ELSE ball_type_as_folded(b.kind, b.ball_type) END AS ball_type,
       b.value, b.shot, b.contact, b.trajectory, b.seg, b.zone,
       -- db/121 (the Laws audit, F4): who faced, as the fold re-judged it
       -- after an amendment corrected an earlier ball of the innings
       -- (ball_event_rejudged); else the stamp the pad wrote.
       CASE WHEN r.seq IS NOT NULL THEN r.striker_id ELSE b.striker_id END AS striker_id,
       b.non_striker_id, b.bowler_id, b.dismissed_id,
       CASE WHEN b.kind = 'retire' AND b.ball_type = 'W'
                 AND retirement_resumed(b.match_id, b.innings, b.seq, b.payload->>'batter') THEN NULL
            ELSE b.dismissal END AS dismissal,
       b.payload, b.recovered,
       b.theta, b.radius, b.placement_source, b.placement_null, b.close_position, b.capture_profile,
       -- SCRBRD-114 phase 3b (db/71): the nth super over this row's innings is,
       -- from the innings' last innings_start that counts (the fold's: the last
       -- one stands); NULL for a match innings.
       (SELECT innings_super_over(s.payload)
          FROM ball_event s
         WHERE s.match_id = b.match_id AND s.innings = b.innings AND s.kind = 'innings_start'
           AND NOT EXISTS (SELECT 1 FROM ball_event v
                            WHERE v.match_id = s.match_id AND v.kind = 'void' AND v.payload->>'target' = s.idempotency_key)
         ORDER BY s.seq DESC LIMIT 1)                                   AS super_over
  FROM ball_event b
  LEFT JOIN ball_event_rejudged r ON r.match_id = b.match_id AND r.seq = b.seq
 WHERE b.kind <> 'void'
   -- NOT EXISTS rather than NOT IN, as db/02 explains.
   AND NOT EXISTS (
         SELECT 1 FROM ball_event v
          WHERE v.match_id = b.match_id
            AND v.kind = 'void'
            AND v.payload->>'target' = b.idempotency_key);

-- The one door. The approver of an amendment, in the transaction that
-- approved it (scoring_amendment_decide() stamps decided_at = now(), the
-- transaction's start), hands over the fold's striker for the balls after
-- the amendment's target in its innings: those that differ from the stamp
-- are kept, the rest of that stretch's earlier re-judging is cleared. The
-- fold is the API's (services/api/write/rejudge.mjs); SQL cannot run it,
-- and does not trust anyone else's.
CREATE OR REPLACE FUNCTION scoring_amendment_rejudge(p_amendment uuid, p_rows jsonb)
RETURNS integer AS $$
DECLARE
  a scoring_amendment%ROWTYPE;
  t record;
  n integer;
BEGIN
  SELECT * INTO a FROM scoring_amendment x WHERE x.id = p_amendment;
  IF NOT FOUND OR a.state <> 'approved' OR a.applied_key IS NULL
     OR a.decided_by IS DISTINCT FROM app_user_id() OR a.decided_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'scoring_amendment_rejudge: not an amendment approved by you in this transaction'
      USING ERRCODE = '42501';
  END IF;
  SELECT b.innings, b.seq INTO t FROM ball_event b WHERE b.match_id = a.match_id AND b.idempotency_key = a.target_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scoring_amendment_rejudge: the amendment''s target is not in its match' USING ERRCODE = '22023';
  END IF;
  DELETE FROM ball_event_rejudged r USING ball_event b
   WHERE r.match_id = a.match_id AND b.match_id = r.match_id AND b.seq = r.seq
     AND b.innings = t.innings AND b.seq > t.seq;
  INSERT INTO ball_event_rejudged (match_id, seq, striker_id, amendment_id)
  SELECT a.match_id, b.seq, x.striker_id, a.id
    FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(seq integer, striker_id uuid)
    JOIN ball_event b ON b.match_id = a.match_id AND b.seq = x.seq
   WHERE b.kind = 'ball' AND b.innings = t.innings AND b.seq > t.seq
     AND x.striker_id IS DISTINCT FROM b.striker_id
  ON CONFLICT (match_id, seq) DO UPDATE SET striker_id = EXCLUDED.striker_id, amendment_id = EXCLUDED.amendment_id,
                                            rejudged_at = EXCLUDED.rejudged_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION scoring_amendment_rejudge(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scoring_amendment_rejudge(uuid, jsonb) TO scrbrd_app;


-- ── 6 · The rules, as the fold's tables have them (laws-audit.test.mjs) ──
DO $check$
BEGIN
  IF NOT (ball_runs_off_bat('W', 1, '{"nbRuns":"byes"}') = 0 AND ball_runs_off_bat('W', 2, '{"nbRuns":"leg_byes"}') = 0
          AND ball_runs_off_bat('W', 1, '{}') = 1 AND ball_runs_off_bat('run', 4, '{}') = 4
          AND ball_runs_off_bat('Nb', 4, '{"nbRuns":"byes"}') = 0 AND ball_runs_off_bat('B', 4, '{}') = 0
          AND ball_runs_to_bowler('W', 1, '{"nbRuns":"byes"}') = 0 AND ball_runs_to_bowler('W', 1, '{}') = 1
          AND ball_runs_to_bowler('Nb', 4, '{"nbRuns":"byes"}') = 1 AND ball_runs_to_bowler('Wd', 1, '{}') = 2
          AND ball_runs_to_bowler('LB', 1, '{}') = 0) THEN
    RAISE EXCEPTION 'db/121 (F5): runs off the bat or to the bowler are not runsOffBat()/runsToBowler()';
  END IF;
  IF NOT (ball_boundary('run', 4, '{}') = 4 AND ball_boundary('run', 6, '{}') = 6 AND ball_boundary('Nb', 6, '{}') = 6
          AND ball_boundary('run', 4, '{"boundary":false}') IS NULL AND ball_boundary('run', 6, '{"boundary":false}') IS NULL
          AND ball_boundary('Nb', 4, '{"nbRuns":"byes"}') IS NULL AND ball_boundary('B', 4, '{}') IS NULL
          AND ball_boundary('W', 4, '{}') IS NULL AND ball_boundary('run', 5, '{}') IS NULL) THEN
    RAISE EXCEPTION 'db/121 (F7): ball_boundary() is not boundaryHit()';
  END IF;
  IF NOT (ball_gives_free_hit('Nb', '{}') AND ball_gives_free_hit('Nb', '{"nbType":"front_foot"}')
          AND NOT ball_gives_free_hit('Nb', '{"nbType":"height"}') AND NOT ball_gives_free_hit('Nb', '{"nbType":"beamer"}')
          AND NOT ball_gives_free_hit('run', '{}') AND NOT ball_gives_free_hit(NULL, '{}')) THEN
    RAISE EXCEPTION 'db/121 (Q2): ball_gives_free_hit() is not givesFreeHit()';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'ball_event_rejudged'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'ball_event_rejudged'::regclass AND polname = 'pad_scope_select')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'ball_event_rejudged'::regclass AND polpermissive AND polcmd <> 'r')
     OR position('ball_event_rejudged' IN pg_get_viewdef('ball_event_live'::regclass)) = 0 THEN
    RAISE EXCEPTION 'db/121 (F4): ball_event_rejudged is not read-only behind RLS, or ball_event_live does not read it';
  END IF;
END $check$;

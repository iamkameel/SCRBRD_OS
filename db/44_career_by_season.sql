-- ══════════════════════════════════════════════════════════════════
--  44 · Career figures, season by season (SCRBRD-086)
-- ══════════════════════════════════════════════════════════════════
--
-- The `career` read (services/api/read/read-api.mjs) totals every match its
-- reader may see. That is a career, not a season, so the Awards tab
-- (SCRBRD-084) was right only while a school had one season of history. This
-- file adds the same figures GROUPED BY the school season each match is in,
-- and replaces nothing: `career`, the lifetime views and every function they
-- call are exactly as they were.
--
-- WHICH SEASON A MATCH IS IN. The match's own start, on the Johannesburg
-- calendar, through season_for() at the school level (db/08) — the rule the
-- fixture list applied inline in the `matches` read. It is one function now,
-- school_season_of(), and that read asks it too, so a fixture listed under
-- 2026 and its runs counted in 2026 are one decision rather than two copies
-- of one. A season is a property of the MATCH: every delivery of a fixture is
-- in the fixture's season, including one synced, voided or amended long
-- after it was bowled. That is why the *_since() functions' server_ts window
-- (db/02) cannot answer this question, and why no screen derives a season
-- from a date.
--
-- THE SAME FIGURES AS THE FOLD, NOT RESTATED FROM MEMORY. Each view mirrors
-- one lifetime view and the function it calls:
--
--   player_batting_by_season     ↔ player_batting_career / player_batting_since()      (db/43)
--   player_bowling_by_season     ↔ player_bowling_career / player_bowling_since()      (db/42)
--   player_dismissals_by_season  ↔ player_dismissals     / player_dismissals_since()   (db/43)
--
-- with the same row predicate, the same CASE for every figure and the same
-- rule functions — ball_runs_off_bat() and ball_retired_batter() (db/40),
-- ball_wicket_stands() (db/42), dismissal_is_bowlers() (db/13, db/43),
-- ball_dismissed_batter() (db/43) — so runs off
-- the bat, a retirement marked W, and a wicket the free hit saved are decided
-- by the one definition both readers ask. Only the grain differs: where the
-- function takes one player and a time window, the view GROUPs by player and
-- season. A row's players are exactly the ones the function's WHERE would
-- match: for batting, a delivery's striker, the batter a wicket that stood
-- dismissed at the other end, or the batter a retirement dismissed; for
-- dismissals, the batter a wicket that stood dismissed or a retirement did. The two cannot
-- be the same row today — ball_retired_batter() answers only a `retire` — and
-- the NULLIF below counts such a row once if they ever are, as the
-- function's OR does, rather than twice.
--
-- THE INVARIANT. Every match is in exactly one season, so for every player,
-- as every reader:
--
--     Σ over seasons of a figure by season  =  that figure in the lifetime view
--
-- for every count (`matches` included: a match is counted in its one
-- season), and the latest last_ball_at over the seasons is the lifetime one.
-- db/99 §22 asserts it for every player, as seven principals, over a log that
-- carries every rule above: no-ball byes, retirements marked W, free-hit
-- saves, a void, a run out at the non-striker's end, a delivery with no
-- striker on file, a NULL ball type and a W with no method. A change to a
-- rule FUNCTION flows into both readers and keeps the invariant. A change to
-- the COMPOSITION inside one of the three functions above has to be mirrored
-- here, in a new file — and §22 goes red until it is.
--
-- WHO SEES WHAT: EXACTLY WHAT THE LIFETIME VIEWS SHOW. Every object here runs
-- as its caller — the views are security_invoker, the function is SECURITY
-- INVOKER by omission — and reads ball_event_live, match and player under the
-- caller's own policies. There is no definer anywhere in this file, so
-- nothing here can reach a row its caller cannot. Joining `match` cannot DROP
-- a delivery the lifetime views count, either: ball_event_read (db/02) is
-- app_can('fixture.read', ball.school_id, match_team(match), NULL, match),
-- and the home arm of match_read (db/09) is the same call on the match's own
-- school, team and id with the subject dimension at ANY instead of NULL,
-- which is never narrower; every writer stamps ball_event.school_id from
-- match_school(). A delivery its caller may read is of a match its caller may
-- read. The policies on match are only ever widened after db/09 (db/41's is
-- permissive), and there is no restrictive one.
--
-- NOT TOUCHED, deliberately: player_innings, opposition_squad, the three
-- *_since() functions, the lifetime views and every rule function are as
-- db/40, db/42 and db/43 left them. This file asks them; it does not redefine them.

-- ── The season a match is in ─────────────────────────────────────
-- The label of the school season a match starting at p_at is in: the
-- calendar's rule (season_for(), db/08) on the Johannesburg date. A fixture
-- that starts at 01:30 on 1 January in Durban is in the new season, although
-- it is still 31 December in UTC. Never NULL for a match — starts_at is NOT
-- NULL, and season_for() labels every date, with a season row or without.
CREATE OR REPLACE FUNCTION school_season_of(p_at timestamptz)
RETURNS text AS $$
  SELECT label FROM season_for((p_at AT TIME ZONE 'Africa/Johannesburg')::date, 'school')
$$ LANGUAGE sql STABLE;

-- ── Batting, by season (player_batting_since(), db/43) ───────────
-- Runs, fours and sixes off the bat; balls faced (a no-ball is faced, a wide
-- is not) — only ever off a ball he FACED. A wicket that stood and dismissed
-- him at the other end (db/43), and a retirement marked W, are innings he
-- played with no run and no ball in them. The match's season is worked out
-- once per match, in the MATERIALIZED CTE, rather than once per delivery.
CREATE OR REPLACE VIEW player_batting_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT who.player_id,
       ms.season,
       count(DISTINCT b.match_id)                                                 AS matches,
       coalesce(sum(CASE WHEN who.faced THEN ball_runs_off_bat(b.ball_type, b.value, b.payload)
                         ELSE 0 END), 0)                                          AS runs,
       coalesce(sum(CASE WHEN who.faced AND b.ball_type <> 'Wd' THEN 1 ELSE 0 END), 0) AS balls_faced,
       coalesce(sum(CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                          AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END), 0) AS fours,
       coalesce(sum(CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                          AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END), 0) AS sixes,
       max(b.server_ts)                                                           AS last_ball_at
  FROM ball_event_live b
  JOIN match_season ms ON ms.match_id = b.match_id
  -- (b.kind = 'ball' AND b.striker_id = p)
  -- OR (b.kind = 'ball' AND b.ball_type = 'W' AND ball_dismissed_batter(...) = p AND ball_wicket_stands(...))
  -- OR ball_retired_batter(...) = p
  -- The second arm is a row of its own only for a batter who is not the
  -- striker (the function's OR counts the striker's own wicket ball once);
  -- the third answers only a `retire`, never a `ball`, so it cannot repeat
  -- either of the others — the NULLIF keeps it once if that ever changes.
  CROSS JOIN LATERAL (VALUES
    (CASE WHEN b.kind = 'ball' THEN b.striker_id END, true),
    (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
               AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
          THEN nullif(ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload), b.striker_id) END, false),
    (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
            CASE WHEN b.kind = 'ball' THEN b.striker_id END), false)
  ) AS who(player_id, faced)
  -- A row for a player the caller may read, and nobody else: the lifetime
  -- view is `FROM player p` for the same reason.
  JOIN player p ON p.id = who.player_id
 GROUP BY who.player_id, ms.season;

-- ── Bowling, by season (player_bowling_since(), db/42) ───────────
-- Every run of a wide or a no-ball is the bowler's (1 + value); byes and leg
-- byes are not; a wicket is his when the method is (dismissal_is_bowlers())
-- and it stood (ball_wicket_stands() — the free hit saves the others).
CREATE OR REPLACE VIEW player_bowling_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT b.bowler_id                                                                AS player_id,
       ms.season,
       count(DISTINCT b.match_id)                                                 AS matches,
       coalesce(sum(CASE WHEN b.ball_type IN ('Wd','Nb') THEN 1 + coalesce(b.value,0)
                         WHEN b.ball_type IN ('run','W')  THEN coalesce(b.value,0)
                         ELSE 0 END), 0)                                          AS runs_conceded,
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

-- ── Dismissals, by season (player_dismissals_since(), db/43) ─────
-- A wicket ball that stood dismisses whoever the fold says it did —
-- ball_dismissed_batter(), `dismissed ?? striker` (db/43); a typed name is
-- nobody SCRBRD holds — and a retirement marked W dismisses payload.batter.
CREATE OR REPLACE VIEW player_dismissals_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT who.player_id,
       ms.season,
       count(*)                                                                   AS dismissals
  FROM ball_event_live b
  JOIN match_season ms ON ms.match_id = b.match_id
  -- (b.kind = 'ball' AND b.ball_type = 'W' AND ball_dismissed_batter(...) = p
  --  AND ball_wicket_stands(...)) OR ball_retired_batter(...) = p
  CROSS JOIN LATERAL (VALUES
    (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
               AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
          THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END),
    (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
            CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
                      AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                 THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END))
  ) AS who(player_id)
  JOIN player p ON p.id = who.player_id
 GROUP BY who.player_id, ms.season;

-- The application role reads them. The default privileges from db/06 already
-- cover a view the owner creates; this does not depend on who that was.
GRANT SELECT ON player_batting_by_season, player_bowling_by_season, player_dismissals_by_season
  TO scrbrd_app;

-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  v text;
  lifetime text;
  want jsonb;
  got jsonb;
BEGIN
  -- Each view runs as its caller. Without the option a view runs as its
  -- owner, who owns ball_event, match and player and so bypasses every
  -- policy on them: every school's figures, through one SELECT.
  FOREACH v IN ARRAY ARRAY['player_batting_by_season', 'player_bowling_by_season', 'player_dismissals_by_season'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = v AND c.relkind = 'v'
                      AND 'security_invoker=true' = ANY (c.reloptions)) THEN
      RAISE EXCEPTION 'db/44: % is not a security_invoker view', v;
    END IF;
    IF NOT has_table_privilege('scrbrd_app', v, 'SELECT') THEN
      RAISE EXCEPTION 'db/44: the application role cannot read %', v;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'school_season_of(timestamptz)'::regprocedure AND prosecdef) THEN
    RAISE EXCEPTION 'db/44: school_season_of() must run as its caller';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'school_season_of(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/44: the application role cannot call school_season_of()';
  END IF;

  -- Each mirror has its lifetime view's columns, names and types, with the
  -- season second: the same figures, one grain finer.
  FOR v, lifetime IN VALUES ('player_batting_by_season', 'player_batting_career'),
                            ('player_bowling_by_season', 'player_bowling_career'),
                            ('player_dismissals_by_season', 'player_dismissals') LOOP
    SELECT jsonb_agg(x ORDER BY o) INTO want FROM (
      SELECT a.attnum + CASE WHEN a.attnum > 1 THEN 1 ELSE 0 END AS o,
             a.attname || ' ' || format_type(a.atttypid, a.atttypmod) AS x
        FROM pg_attribute a WHERE a.attrelid = ('public.' || lifetime)::regclass AND a.attnum > 0 AND NOT a.attisdropped
      UNION ALL SELECT 2, 'season text') s;
    SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum) INTO got
      FROM pg_attribute a WHERE a.attrelid = ('public.' || v)::regclass AND a.attnum > 0 AND NOT a.attisdropped;
    IF got IS DISTINCT FROM want THEN
      RAISE EXCEPTION 'db/44: % is not % by season: has %, expected %', v, lifetime, got, want;
    END IF;
  END LOOP;

  -- The calendar's day, not Greenwich's: 22:00 UTC on 31 December is
  -- midnight in Johannesburg, the first minute of the next school season.
  IF school_season_of('2025-12-31 21:59:59+00') IS DISTINCT FROM '2025'
     OR school_season_of('2025-12-31 22:00:00+00') IS DISTINCT FROM '2026' THEN
    RAISE EXCEPTION 'db/44: school_season_of() does not read the Johannesburg date';
  END IF;
END $check$;

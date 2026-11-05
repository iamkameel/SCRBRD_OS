-- ══════════════════════════════════════════════════════════════════
--  143 · School record boards: each side's records, joint and former
--        holders, derived from the log on each read; noticed to the
--        side when a match is verified
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Slice R9 of docs/design/RECOGNITION_reconciliation.md (§5,
-- the R9 row), as docs/design/RECOGNITION_design.md §10 changes it (approved
-- as recommended, Kameel 7 October 2026; Awards unparked 5 November 2026):
--   D22  boards are signed in, anchored on the side the performance was
--        for: the match's side code (the end of the fixture the boy played
--        for), never player.team_code. A U15A innings stays on the U15A
--        board after the boy moves up or leaves, named.
--   D23  a pupil sees each record as a chronology (the holder, joint
--        holders, former holders), never an ordered list of his side; the
--        family app draws no board.
--   D24  School Records is the headline group; Friendly is its own board,
--        never merged; the spec's empty states.
--   D25  a record is noticed to the side when the match is verified, not on
--        the ball.
--   D7   no platform-wide assignment reads a board or sets a minimum.
--   A3   a match decided off the field, abandoned, without a result or with
--        an adjusted target (DLS) stands on no board; a super over is no
--        part of any innings here (ball_event_career, db/71).
--   A10  derived, never stored: no stored score, no stored record holder,
--        no counter. What is stored is what a person decides: a school's
--        published minimum for a rate board.
--   A11  never public: no public_* function reads any of it (§6's check).
-- Spec v0.2.3 §5.1–§5.5: the record key is metric × side × format × class
-- group; highest innings is runs descending (a not-out descriptive); best
-- bowling is wickets descending, then runs conceded ascending; best strike
-- rate (runs per ball faced) and best economy (runs per legal ball) need a
-- published minimum, and an unset minimum disables the board; equal
-- performances share it; a surpassed holder stays in history as a former
-- holder; labels state coverage ("in verified SCRBRD matches since …").
--
-- ── WHICH MATCHES COUNT ─────────────────────────────────────────────
-- A match counts when match_verified() (db/114: complete, every innings
-- sealed by the scorer and the seal standing) and fixture_class() (db/127)
-- gives it no no-board reason. Its class group is fixture_class()'s:
-- friendly -> 'friendly', competitive or festival -> 'school_records' (a
-- festival's T10 and a league's T20 never meet: format is in the key). A
-- correction breaks the seal, so the match leaves every board until it is
-- sealed again; the board is rebuilt on the next read (Q10).
--
-- Chronology. The matches of a board are read in the order they were
-- played (starts_at, then id). A match sets the record when its best
-- qualifying performance is at least the best of every earlier match: equal
-- is joint, better is a new holder. Every performance that set it and is
-- now beaten is a former holder. A match is one moment: two boys in the
-- same match do not take the record from each other, the better one sets it
-- (two equal ones share it). Rates compare unrounded (numeric runs/balls).
--
-- ── WHO READS IT (§2.3's records column; nothing here widens a role) ──
-- record_board(school, side) is the one door. It is a pinned definer
-- because a board compares every boy who played for the side, boys who
-- have since moved side or left among them, and no reader's own row
-- security reaches all of those; it answers only what the reader may
-- already be told, by the existing capability, scoped as today:
--   * chronology (holders and former holders): player.performance.read at
--     the side, asked about nobody in particular — the side's pupils
--     (`player`), its coach and assistant coach, and the director,
--     principal, analyst and media at the school. A guardian's or a
--     pupil's own self-access assignment reaches only the child it names,
--     never "nobody in particular", so a family reads no board (D23).
--   * the staff-only "this season" list (D22, Q9), ordered by the metric
--     with its minimum stated: the same capability held through any
--     assignment but a `player` one (app_can_but_player(), db/129). A
--     pupil never reads an ordered list of his team-mates.
--   * nobody holding a platform-wide assignment (D7), another school's
--     staff, a scout, a spectator, a scorer, the DSO or the signed-out
--     public: nothing.
-- §2.3 also names the team manager and the office as full-board readers;
-- neither holds player.performance.read today, and "nothing in this table
-- widens a role", so neither reads a board until a capability says so.
--
-- ── WHAT IS STORED ──────────────────────────────────────────────────
-- record_definition: a school's published minimum for a rate board (best
-- strike rate, best economy) per format, in balls. No row, or a row with
-- no minimum, is a board that is off. Written only through
-- record_minimum_set() under recognition.manage at the school (the office,
-- the director, the principal: the caps baseline's holders), never by a
-- platform-wide assignment (D7's RESTRICTIVE cut). Read only through
-- record_board().
--
-- ── THE NOTICE (D25) ────────────────────────────────────────────────
-- When a match becomes complete and is verified, each board of each of its
-- ends whose record this match now holds — beating or equalling one set in
-- an earlier match — is noticed to that side: team scope, no recipient
-- (never to a child alone), the holder as subject_person_id as a milestone
-- notice is. Its required capability is player.performance.read, not
-- news.read: the notice is read by those who may read the board's figures
-- about him at that side (news.read and that, as the notification policy
-- asks both), so a school-wide news reader who reads no figures (a scout, a
-- spectator) is not told a child's record. A push names nobody
-- (push-api.mjs buildPayload()).
-- The first match on a board holds a record against no history, and is not
-- noticed. A notice that cannot be raised never stops the match being
-- finished (RAISE WARNING). Retraction after a correction is R10's.
--
-- ── WHAT THIS FILE DOES NOT TOUCH ──────────────────────────────────
-- No capability, role, column of an existing table, or existing function.
-- One table, four functions and one trigger, all new; a second paste
-- changes nothing.


-- ── 0 · What this file stands on, and refuse to replace what it was not ──
DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regclass('player_innings') IS NULL OR to_regclass('bowler_innings_figures') IS NULL
     OR to_regclass('ball_event_career') IS NULL OR to_regclass('summary_bowling_line') IS NULL
     OR to_regclass('match_squad') IS NULL OR to_regclass('notification') IS NULL
     OR to_regprocedure('fixture_class(uuid)') IS NULL
     OR to_regprocedure('match_verified(uuid)') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('app_can_but_player(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('app_is_platform_wide()') IS NULL
     OR to_regprocedure('ball_counts_in_over(text,jsonb)') IS NULL
     OR to_regprocedure('fixture_side_label(uuid,text)') IS NULL
     OR to_regprocedure('school_season_of(timestamptz)') IS NULL
     OR to_regprocedure('pad_scope_guard_install(regclass)') IS NULL
     OR to_regprocedure('sa_date(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'db/143: player_innings, bowler_innings_figures, ball_event_career, summary_bowling_line, match_squad, notification, fixture_class() (db/127), match_verified() (db/114), app_can(), app_can_but_player() (db/129), app_is_platform_wide(), ball_counts_in_over(), fixture_side_label(), school_season_of(), pad_scope_guard_install() or sa_date() is missing; apply them first';
  END IF;
  -- Every function is this file's alone: absent, or as this file wrote it.
  FOR r IN SELECT * FROM (VALUES
      ('record_lines(uuid,text)',                 '9212ba18caaa56cf7c4372e7d2de96a8'),
      ('record_board(uuid,text)',                 '650f59c6d99c176456a3b06ecb754178'),
      ('record_minimum_set(uuid,text,text,integer)', 'eb487cceac06e73dfd20e5ac221aed9b'),
      ('record_notice()',                         'bc7c09bb6d514a4124c725d52cd9ae36'))
      AS x(fn, mine)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    CONTINUE WHEN v_src IS NULL;
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 <> r.mine THEN
      RAISE EXCEPTION 'db/143: % is not this file''s (md5 % of its folded body); look before replacing it', r.fn, v_md5;
    END IF;
  END LOOP;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · record_definition: a school's published minimum for a rate board
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS record_definition (
  school_id  uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  metric     text NOT NULL,
  format     text NOT NULL,
  -- Balls faced (strike rate) or legal balls bowled (economy). NULL: the
  -- school took its minimum down, so the board is off again; the row keeps
  -- who did it and when.
  min_balls  integer,
  set_by     uuid REFERENCES app_user(id),
  set_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, metric, format),
  CONSTRAINT record_definition_rate_only CHECK (metric IN ('best_strike_rate', 'best_economy')),
  CONSTRAINT record_definition_format_named CHECK (format ~ '^[A-Za-z0-9 ]{2,20}$'),
  CONSTRAINT record_definition_min_sane CHECK (min_balls IS NULL OR min_balls BETWEEN 1 AND 600)
);
COMMENT ON TABLE record_definition IS
  'db/143 (RECOGNITION R9): a school''s published minimum, in balls, for a rate record board (best strike rate, best economy) in one format. No row or no minimum: the board is off (spec §5.2). Written only by record_minimum_set() under recognition.manage; read only through record_board().';

-- Row security with no permissive policy: nobody reads or writes it through
-- the application; the two definers above it are the doors. D7's cut is said
-- anyway, so a later policy cannot let a platform-wide assignment in.
ALTER TABLE record_definition ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS record_definition_no_platform ON record_definition;
CREATE POLICY record_definition_no_platform ON record_definition AS RESTRICTIVE
  FOR ALL USING (NOT app_is_platform_wide()) WITH CHECK (NOT app_is_platform_wide());
SELECT pad_scope_guard_install('record_definition'::regclass) AS pad_guards;
REVOKE ALL ON record_definition FROM PUBLIC;
REVOKE ALL ON record_definition FROM scrbrd_app;


-- ══════════════════════════════════════════════════════════════════
-- §2 · record_lines: every board of one side, as the owner reads it
-- ══════════════════════════════════════════════════════════════════
-- Nobody's to call (record_board() and record_notice() call it as the
-- owner). One row per line a board can draw:
--   board   one per metric × class group × format the side has a counted or
--           waiting performance for: its state, the minimum, the coverage
--           date (the first counted match) and how many matches await
--           verification. The state, in this order (spec §10's empty states):
--             no_minimum  a rate board the school has published no minimum
--                         for: off (spec §5.2)
--             standing    a record stands
--             awaiting    nothing counted yet, a match awaits verification
--             not_enough  counted matches, none qualifying
--           ("historical coverage incomplete" is every board's coverage
--           line: "in verified SCRBRD matches since …").
--   holder  the performance that holds it now (joint holders: several),
--           `equalled` when it equals the record of an earlier match, and
--           `prior_best` when an earlier match held one at all.
--   former  a performance that held it and has been beaten.
--   season  this school season's counted performances, ordered by the
--           metric (`place`, ties sharing), the first ten places: staff's.
-- Figures: runs, balls (faced, or legal balls bowled), not_out, wickets,
-- runs_conceded, as the log derives them; nothing rounded.
CREATE OR REPLACE FUNCTION record_lines(p_school uuid, p_side text)
RETURNS TABLE (metric text, class_group text, format text, line text, state text, min_balls integer,
               coverage_since date, awaiting integer, place integer, equalled boolean, prior_best boolean,
               player_id uuid, player_name text, match_id uuid, innings smallint, played_on date, opponent text,
               runs integer, balls integer, not_out boolean, wickets integer, runs_conceded integer) AS $$
  WITH ends AS MATERIALIZED (
    SELECT m.id, m.format, m.starts_at, m.school_id AS home_school, m.away_school_id AS away_school,
           (m.school_id = p_school AND m.team_code = p_side) AS home_end,
           (m.away_school_id IS NOT DISTINCT FROM p_school AND m.away_team_code IS NOT DISTINCT FROM p_side) AS away_end
      FROM match m
     WHERE (m.school_id = p_school AND m.team_code = p_side)
        OR (m.away_school_id = p_school AND m.away_team_code = p_side)
  ),
  fx AS MATERIALIZED (
    SELECT e.*, sa_date(e.starts_at) AS played_on,
           CASE WHEN e.home_end THEN coalesce(fixture_side_label(mm.away_school_id, mm.away_team_code), mm.opponent)
                ELSE fixture_side_label(mm.school_id, mm.team_code) END AS opponent,
           CASE WHEN c.fixture_class = 'friendly' THEN 'friendly' ELSE 'school_records' END AS class_group,
           c.no_board, match_verified(e.id) AS verified,
           school_season_of(e.starts_at) = school_season_of(now()) AS this_season
      FROM ends e
      JOIN match mm ON mm.id = e.id
     CROSS JOIN LATERAL fixture_class(e.id) c
  ),
  -- The boy is on this side's end of the match: his team sheet says so, or
  -- (no sheet row) his school is this end's.
  bat AS (
    SELECT f.*, i.player_id, i.innings::smallint AS inn, i.runs::integer AS r, i.balls_faced::integer AS bf,
           NOT coalesce(i.out, false) AS no
      FROM fx f
      JOIN player_innings i ON i.match_id = f.id
      JOIN player p ON p.id = i.player_id
      LEFT JOIN match_squad q ON q.match_id = f.id AND q.player_id = i.player_id
     WHERE CASE WHEN q.side = 'home' THEN f.home_end WHEN q.side = 'away' THEN f.away_end
                WHEN p.school_id = f.home_school THEN f.home_end
                WHEN p.school_id = f.away_school THEN f.away_end ELSE false END
  ),
  bowl AS (
    SELECT f.*, x.player_id, x.innings::smallint AS inn, x.wickets::integer AS w, x.runs_conceded::integer AS rc,
           (coalesce((SELECT count(*) FILTER (WHERE ball_counts_in_over(b.ball_type, b.payload))
                        FROM ball_event_career b
                       WHERE b.match_id = f.id AND b.innings = x.innings AND b.bowler_id = x.player_id
                         AND b.kind = 'ball'), 0)
            + coalesce((SELECT sum(s.legal_balls) FROM summary_bowling_line s
                         WHERE s.match_id = f.id AND s.innings = x.innings AND s.player_id = x.player_id), 0))::integer AS lb
      FROM fx f
      JOIN bowler_innings_figures x ON x.match_id = f.id
      JOIN player p ON p.id = x.player_id
      LEFT JOIN match_squad q ON q.match_id = f.id AND q.player_id = x.player_id
     WHERE CASE WHEN q.side = 'home' THEN f.home_end WHEN q.side = 'away' THEN f.away_end
                WHEN p.school_id = f.home_school THEN f.home_end
                WHEN p.school_id = f.away_school THEN f.away_end ELSE false END
  ),
  -- One row per performance and metric; k is the comparison, higher better.
  perf0 AS (
    SELECT 'highest_innings'::text AS metric, b.id AS mid, b.starts_at, b.format, b.class_group, b.no_board, b.verified,
           b.this_season, b.played_on, b.opponent, b.player_id, b.inn,
           b.r AS runs, b.bf AS balls, b.no AS not_out, NULL::integer AS wickets, NULL::integer AS conceded,
           b.r::numeric AS k, NULL::integer AS qual
      FROM bat b
    UNION ALL
    SELECT 'best_strike_rate', b.id, b.starts_at, b.format, b.class_group, b.no_board, b.verified,
           b.this_season, b.played_on, b.opponent, b.player_id, b.inn,
           b.r, b.bf, b.no, NULL, NULL, b.r::numeric / b.bf, b.bf
      FROM bat b WHERE b.bf > 0
    UNION ALL
    SELECT 'best_bowling', w.id, w.starts_at, w.format, w.class_group, w.no_board, w.verified,
           w.this_season, w.played_on, w.opponent, w.player_id, w.inn,
           NULL, w.lb, NULL, w.w, w.rc, (w.w::numeric * 100000) - w.rc, NULL
      FROM bowl w WHERE w.w > 0
    UNION ALL
    SELECT 'best_economy', w.id, w.starts_at, w.format, w.class_group, w.no_board, w.verified,
           w.this_season, w.played_on, w.opponent, w.player_id, w.inn,
           NULL, w.lb, NULL, w.w, w.rc, -(w.rc::numeric / w.lb), w.lb
      FROM bowl w WHERE w.lb > 0
  ),
  perf AS MATERIALIZED (
    SELECT x.*, d.min_balls AS minimum,
           (x.metric IN ('best_strike_rate', 'best_economy')) AS rate,
           (x.verified AND x.no_board IS NULL) AS counted,
           (x.verified AND x.no_board IS NULL
            AND (x.metric NOT IN ('best_strike_rate', 'best_economy')
                 OR (d.min_balls IS NOT NULL AND x.qual >= d.min_balls))) AS qualifies
      FROM perf0 x
      LEFT JOIN record_definition d ON d.school_id = p_school AND d.metric = x.metric AND d.format = x.format
  ),
  -- A match is one moment: its best qualifying figure on each board, and the
  -- best of every match played before it.
  per_match AS (
    SELECT y.*, max(y.mk) OVER (PARTITION BY y.metric, y.class_group, y.format
                                ORDER BY y.starts_at, y.mid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_k
      FROM (SELECT p.metric, p.class_group, p.format, p.mid, p.starts_at, max(p.k) AS mk
              FROM perf p WHERE p.qualifies
             GROUP BY p.metric, p.class_group, p.format, p.mid, p.starts_at) y
  ),
  setters AS (
    SELECT p.*, pm.prior_k, max(pm.mk) OVER (PARTITION BY p.metric, p.class_group, p.format) AS best_now
      FROM perf p
      JOIN per_match pm ON pm.metric = p.metric AND pm.class_group = p.class_group AND pm.format = p.format AND pm.mid = p.mid
     WHERE p.qualifies AND p.k = pm.mk AND (pm.prior_k IS NULL OR pm.mk >= pm.prior_k)
  ),
  boards AS (
    SELECT p.metric, p.class_group, p.format, bool_or(p.rate) AS rate, max(p.minimum) AS minimum,
           min(p.played_on) FILTER (WHERE p.counted) AS since,
           count(DISTINCT p.mid) FILTER (WHERE NOT p.verified AND p.no_board IS NULL)::integer AS waiting,
           bool_or(p.counted) AS any_counted,
           bool_or(p.qualifies) AS standing
      FROM perf p
     WHERE p.counted OR (NOT p.verified AND p.no_board IS NULL)
     GROUP BY p.metric, p.class_group, p.format
  ),
  seasonal AS (
    SELECT p.*, rank() OVER (PARTITION BY p.metric, p.class_group, p.format ORDER BY p.k DESC)::integer AS pl
      FROM perf p WHERE p.qualifies AND p.this_season
  )
  SELECT b.metric, b.class_group, b.format, 'board'::text,
         CASE WHEN b.rate AND b.minimum IS NULL THEN 'no_minimum'
              WHEN b.standing THEN 'standing'
              WHEN NOT b.any_counted AND b.waiting > 0 THEN 'awaiting'
              ELSE 'not_enough' END,
         b.minimum, b.since, b.waiting, NULL::integer, NULL::boolean, NULL::boolean,
         NULL::uuid, NULL::text, NULL::uuid, NULL::smallint, NULL::date, NULL::text,
         NULL::integer, NULL::integer, NULL::boolean, NULL::integer, NULL::integer
    FROM boards b
  UNION ALL
  SELECT s.metric, s.class_group, s.format, CASE WHEN s.k = s.best_now THEN 'holder' ELSE 'former' END,
         NULL, s.minimum, NULL, NULL, NULL, s.k = s.prior_k, s.prior_k IS NOT NULL,
         s.player_id, pl.full_name, s.mid, s.inn, s.played_on, s.opponent,
         s.runs, s.balls, s.not_out, s.wickets, s.conceded
    FROM setters s JOIN player pl ON pl.id = s.player_id
  UNION ALL
  SELECT s.metric, s.class_group, s.format, 'season', NULL, s.minimum, NULL, NULL, s.pl, NULL, NULL,
         s.player_id, pl.full_name, s.mid, s.inn, s.played_on, s.opponent,
         s.runs, s.balls, s.not_out, s.wickets, s.conceded
    FROM seasonal s JOIN player pl ON pl.id = s.player_id
   WHERE s.pl <= 10
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION record_lines(uuid, text) IS
  'db/143 (RECOGNITION R9): every record board of one side (metric × class group × format), as the owner reads the log: the board''s state, holders, former holders and this season''s ordered list. Only verified matches with no no-board reason count. Nobody''s to call: record_board() and record_notice() read it.';


-- ══════════════════════════════════════════════════════════════════
-- §3 · record_board: the one door, as the reader may read it
-- ══════════════════════════════════════════════════════════════════
-- `reader_view`: 'full' (staff: the season list as well) or 'chronology'
-- (a pupil: holders and former holders, never an ordered list). Nothing for
-- anyone else.
CREATE OR REPLACE FUNCTION record_board(p_school uuid, p_side text)
RETURNS TABLE (reader_view text, side_school_id uuid, side_code text, metric text, class_group text, format text,
               line text, state text, min_balls integer, coverage_since date, awaiting integer, place integer,
               equalled boolean, player_id uuid, player_name text, match_id uuid, innings smallint, played_on date,
               opponent text, runs integer, balls integer, not_out boolean, wickets integer, runs_conceded integer) AS $$
  WITH who AS MATERIALIZED (
    SELECT CASE WHEN app_can_but_player('player.performance.read', p_school, p_side, NULL, NULL) THEN 'full'
                ELSE 'chronology' END AS v
     WHERE p_school IS NOT NULL AND p_side IS NOT NULL
       AND NOT app_is_platform_wide()
       AND app_can('player.performance.read', p_school, p_side, NULL, NULL)
  )
  SELECT w.v, p_school, p_side, l.metric, l.class_group, l.format, l.line, l.state, l.min_balls, l.coverage_since,
         l.awaiting, l.place, l.equalled, l.player_id, l.player_name, l.match_id, l.innings, l.played_on,
         l.opponent, l.runs, l.balls, l.not_out, l.wickets, l.runs_conceded
    FROM who w
   CROSS JOIN LATERAL record_lines(p_school, p_side) l
   WHERE l.line <> 'season' OR w.v = 'full'
   ORDER BY l.class_group DESC, l.format, l.metric,
            CASE l.line WHEN 'board' THEN 0 WHEN 'holder' THEN 1 WHEN 'former' THEN 2 ELSE 3 END,
            l.place NULLS LAST, l.played_on DESC, l.match_id, l.player_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION record_board(uuid, text) IS
  'db/143 (RECOGNITION R9, D22–D24): a side''s record boards for a signed-in reader holding player.performance.read at that side about nobody in particular — staff the full board with this season''s ordered list, a pupil the chronology (holders and former holders) only; a family, another school, a platform-wide assignment and the public nothing. Derived on every read; never public (A11).';


-- ══════════════════════════════════════════════════════════════════
-- §4 · record_minimum_set: a school publishes, or takes down, a minimum
-- ══════════════════════════════════════════════════════════════════
-- recognition.manage at the school, never a platform-wide assignment (D7).
-- p_min NULL takes the minimum down: the board is off again.
CREATE OR REPLACE FUNCTION record_minimum_set(p_school uuid, p_metric text, p_format text, p_min integer)
RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF p_school IS NULL OR app_user_id() IS NULL OR app_is_platform_wide()
     OR NOT app_can('recognition.manage', p_school, NULL, NULL, NULL) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  IF p_metric IS NULL OR p_metric NOT IN ('best_strike_rate', 'best_economy') THEN
    RETURN QUERY SELECT false, 'metric_has_no_minimum'::text; RETURN;
  END IF;
  IF p_format IS NULL OR p_format !~ '^[A-Za-z0-9 ]{2,20}$' THEN
    RETURN QUERY SELECT false, 'format_invalid'::text; RETURN;
  END IF;
  IF p_min IS NOT NULL AND (p_min < 1 OR p_min > 600) THEN
    RETURN QUERY SELECT false, 'minimum_out_of_range'::text; RETURN;
  END IF;
  INSERT INTO record_definition (school_id, metric, format, min_balls, set_by, set_at)
  VALUES (p_school, p_metric, p_format, p_min, app_user_id(), now())
  ON CONFLICT ON CONSTRAINT record_definition_pkey
  DO UPDATE SET min_balls = EXCLUDED.min_balls, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION record_minimum_set(uuid, text, text, integer) IS
  'db/143 (RECOGNITION R9): publish (or, with NULL, take down) a school''s minimum in balls for a rate record board in one format, under recognition.manage at the school; never a platform-wide assignment (D7). Answers ok and a reason.';


-- ══════════════════════════════════════════════════════════════════
-- §5 · record_notice: the side is told at verification (D25)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION record_notice() RETURNS trigger AS $$
DECLARE
  e record;
  r record;
  v_title text;
  v_body  text;
  v_metric text;
  v_fig text;
BEGIN
  BEGIN
    IF NOT match_verified(NEW.id) THEN RETURN NULL; END IF;
    FOR e IN SELECT x.s, x.t FROM (VALUES (NEW.school_id, NEW.team_code), (NEW.away_school_id, NEW.away_team_code)) x(s, t)
              WHERE x.s IS NOT NULL AND x.t IS NOT NULL
    LOOP
      FOR r IN
        SELECT l.*, b.coverage_since AS since
          FROM record_lines(e.s, e.t) l
          JOIN record_lines(e.s, e.t) b ON b.line = 'board' AND b.metric = l.metric
                                       AND b.class_group = l.class_group AND b.format = l.format
         WHERE l.line = 'holder' AND l.match_id = NEW.id AND l.prior_best
         ORDER BY l.class_group DESC, l.format, l.metric, l.player_name
      LOOP
        v_metric := CASE r.metric WHEN 'highest_innings' THEN 'Highest innings' WHEN 'best_bowling' THEN 'Best bowling'
                                  WHEN 'best_strike_rate' THEN 'Best strike rate' ELSE 'Best economy' END;
        v_fig := CASE r.metric
          WHEN 'highest_innings'  THEN r.runs || CASE WHEN r.not_out THEN '*' ELSE '' END
          WHEN 'best_bowling'     THEN r.wickets || '/' || r.runs_conceded
          WHEN 'best_strike_rate' THEN r.runs || ' off ' || r.balls || ' balls'
          ELSE r.runs_conceded || ' off ' || r.balls || ' balls' END;
        v_title := CASE WHEN r.class_group = 'friendly' THEN 'Friendly record' ELSE 'School record' END
                   || CASE WHEN r.equalled THEN ' equalled' ELSE '' END
                   || ' · ' || v_metric || ' ' || e.t || ' ' || coalesce(r.format, '') || ': ' || v_fig || ' ' || r.player_name;
        v_body := v_fig || ' against ' || coalesce(r.opponent, 'the opposition') || ', '
                  || to_char(r.played_on, 'FMDD Mon YYYY') || '. In verified SCRBRD matches since '
                  || to_char(r.since, 'Mon YYYY') || '.';
        IF NOT EXISTS (SELECT 1 FROM notification n
                        WHERE n.subject_kind = 'match' AND n.subject_id = NEW.id AND n.school_id = e.s
                          AND n.team_code = e.t AND n.title = v_title AND n.retracted_at IS NULL) THEN
          INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                    required_capability, is_public, subject_kind, subject_id, subject_person_id)
          VALUES (e.s, e.t, 'team', 'recognition', 'low', v_title, v_body,
                  'player.performance.read', false, 'match', NEW.id, r.player_id);
        END IF;
      END LOOP;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- The match is finished whatever happens to its notice; the server's log
    -- says the notice was not raised.
    RAISE WARNING 'db/143: the record notice for match % was not raised (SQLSTATE %)', NEW.id, SQLSTATE;
  END;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION record_notice() IS
  'db/143 (RECOGNITION R9, D25): when a match becomes complete and verified, each record it now holds against an earlier match''s is noticed to that side (team scope, under player.performance.read, no recipient, the holder as subject). A notice that cannot be raised never stops the match being finished.';

DROP TRIGGER IF EXISTS match_record_notice ON match;
CREATE TRIGGER match_record_notice AFTER UPDATE OF status ON match
  FOR EACH ROW WHEN (NEW.status = 'complete' AND OLD.status IS DISTINCT FROM 'complete')
  EXECUTE FUNCTION record_notice();


-- ── 6 · Who may call them ──────────────────────────────────────────
-- record_board() and record_minimum_set(): the application, and nobody else
-- (not PUBLIC, not a managed host's API roles, which get EXECUTE on every
-- new function by default: db/131's loop). record_lines() and the trigger
-- function: nobody's.
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['record_lines(uuid,text)', 'record_board(uuid,text)',
                           'record_minimum_set(uuid,text,text,integer)', 'record_notice()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON record_definition FROM %I', r);
    END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION record_board(uuid, text) TO scrbrd_app;
  GRANT EXECUTE ON FUNCTION record_minimum_set(uuid, text, text, integer) TO scrbrd_app;
END $grants$;


-- ── 7 · Check what was built ────────────────────────────────────────
DO $check$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['record_lines(uuid,text)', 'record_board(uuid,text)',
                           'record_minimum_set(uuid,text,text,integer)', 'record_notice()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = r::regprocedure AND p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/143: % is not a SECURITY DEFINER with a pinned path', r;
    END IF;
    IF has_function_privilege('public', r::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/143: % is executable by PUBLIC', r;
    END IF;
  END LOOP;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'record_board(uuid,text)'::regprocedure) <> 's'
     OR (SELECT provolatile FROM pg_proc WHERE oid = 'record_lines(uuid,text)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'db/143: a board read is not STABLE';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'record_board(uuid,text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'record_minimum_set(uuid,text,text,integer)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/143: the application cannot call record_board() or record_minimum_set()';
  END IF;
  IF has_function_privilege('scrbrd_app', 'record_lines(uuid,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'record_notice()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/143: the application can call record_lines() or record_notice()';
  END IF;
  IF has_table_privilege('scrbrd_app', 'record_definition', 'SELECT')
     OR has_table_privilege('scrbrd_app', 'record_definition', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'record_definition', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'record_definition', 'DELETE') THEN
    RAISE EXCEPTION 'db/143: the application reaches record_definition directly';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'record_definition'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'record_definition'::regclass
                       AND polname = 'record_definition_no_platform' AND NOT polpermissive) THEN
    RAISE EXCEPTION 'db/143: record_definition lost its row security or its platform cut (D7)';
  END IF;
  -- The gates are in the door's body: the side's performance read, about
  -- nobody in particular; the season list only off a non-pupil assignment;
  -- never a platform-wide one.
  IF position('app_can(''player.performance.read'', p_school, p_side, NULL, NULL)'
              IN (SELECT prosrc FROM pg_proc WHERE oid = 'record_board(uuid,text)'::regprocedure)) = 0
     OR position('app_can_but_player(''player.performance.read'', p_school, p_side, NULL, NULL)'
              IN (SELECT prosrc FROM pg_proc WHERE oid = 'record_board(uuid,text)'::regprocedure)) = 0
     OR position('NOT app_is_platform_wide()'
              IN (SELECT prosrc FROM pg_proc WHERE oid = 'record_board(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/143: record_board() does not ask what its header says it asks';
  END IF;
  -- Only a verified match with no no-board reason counts (R3, A3).
  IF position('match_verified(e.id)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'record_lines(uuid,text)'::regprocedure)) = 0
     OR position('x.no_board IS NULL' IN (SELECT prosrc FROM pg_proc WHERE oid = 'record_lines(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/143: record_lines() does not count verified, on-board matches only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'match'::regclass AND tgname = 'match_record_notice'
                    AND tgenabled <> 'D' AND tgfoid = 'record_notice()'::regprocedure) THEN
    RAISE EXCEPTION 'db/143: the record notice trigger is missing or disabled';
  END IF;
  -- The notice is the side's, never one person's (no recipient).
  IF position('recipient_id' IN (SELECT prosrc FROM pg_proc WHERE oid = 'record_notice()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'db/143: record_notice() names a recipient';
  END IF;
  -- No signed-out door reads a board (A11): no public_* function names one.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'public\_%'
                AND p.prosrc ~ '\m(record_board|record_lines|record_definition|record_minimum_set)\M') THEN
    RAISE EXCEPTION 'db/143: a public_* function reads a record board';
  END IF;
END $check$;

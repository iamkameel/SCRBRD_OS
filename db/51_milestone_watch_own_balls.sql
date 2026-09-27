-- ══════════════════════════════════════════════════════════════════
--  51 · The milestone trigger reads the striker's own balls (SCRBRD-097)
-- ══════════════════════════════════════════════════════════════════
--
-- milestone_watch() (db/08; db/13, db/40 and db/42 since) is an AFTER INSERT
-- trigger on every delivery. For a ball with runs off the bat it asked
-- player_innings — twice: the striker's runs in this innings (for a fifty
-- or a hundred) and the sum of his runs over every innings he has (for 500,
-- 1000, 2000 and 5000 career runs). player_innings is three arms over
-- ball_event_live: the balls he faced, a wicket that stood and dismissed him
-- at the other end, and a retirement marked W. The career question pushes
-- `player_id = striker` into each arm, and in the second and third that is
-- a predicate on a function of the row (ball_dismissed_batter(),
-- ball_retired_batter()), so both arms read EVERY delivery in the log, for
-- every scoring ball inserted — ball_wicket_stands() and its free-hit
-- lookup on every wicket in the log included: players × balls again, as
-- the career views were before db/49, but at write time.
--
-- MEASURED (tools/bench-assessment.mjs --load, one INSERT per fixture, the
-- trigger's own time from EXPLAIN ANALYZE). bench-career's log (60 boys, 20
-- fixtures, 5,045 rows): this trigger 6.6–7.3 s before, 1.0–1.2 s after.
-- Twelve boys over 40 fixtures (10,109 rows, so careers pass 500 runs and 25
-- wickets): 21.8–42.3 s before, 3.0–3.6 s after. With the bowling-breach
-- trigger held off so the load is this trigger's alone, the database's
-- shared-buffer hits across the load: 2.1M → 0.78M and 5.8M–13.4M → 2.2M–3.6M.
-- The rewrite without the indexes below saves little (5.7 s and 37.7 s):
-- both halves are needed.
--
-- SCRBRD-097 put the 5,000-ball load at 48 s, "mostly in this trigger". It
-- is mostly in bowling_breach_watch() (db/08), which this file does not
-- touch: 13–80 s of the same load, varying fivefold between identical runs
-- with or without this file, as autovacuum's statistics land mid-load and
-- its cached plans change. Its day check asks bowler_over for the bowler,
-- and bowler_over numbers overs with a window over each innings, so the
-- bowler cannot be pushed below it: every delivery in the log, per
-- delivery bowled. SCRBRD-097's build note records it as open.
--
-- WHAT THIS FILE DOES. Of player_innings' three arms only the first carries
-- runs: the other two contribute rows whose `runs` is 0. So both figures the
-- trigger reads are sums of ball_runs_off_bat() over the deliveries the
-- batter FACED, and nothing else:
--
--   innings_runs_off_bat(p, m, i)   player_innings.runs for (p, m, i)
--   career_runs_off_bat(p)          sum(player_innings.runs) for p
--
-- Each reads ball_event_live with `kind = 'ball' AND striker_id = p` (and,
-- for the innings, the match and innings): the rows of the first arm,
-- exactly, with the same rule function over the same columns — and, through
-- the new indexes below, only those rows and the voids that could take one
-- back. milestone_watch() is db/42's word for word except that it asks these
-- two instead of player_innings. The bowler's branch is untouched: its three
-- questions already name the bowler (and two of them the match and the
-- innings), and bowler_innings_figures and bowler_hat_trick are one arm
-- each; the bowler's index is what bounds them to his own balls.
--
-- IDENTICAL, NOT SIMILAR. Every notice is decided by the same comparison
-- on the same number, read in the same place, under the same snapshot:
--
--   career   db/42: SELECT coalesce(sum(runs), 0) … WHERE player_id = p —
--            an aggregate, one row always, 0 for a batter with no innings.
--            career_runs_off_bat(p) is coalesce(sum(...), 0) over the first
--            arm's rows: the same sum (the other arms add 0 to it), and the
--            same 0 when there are none.
--   innings  db/42: SELECT coalesce(runs, 0) … WHERE (p, m, i) — the
--            innings' row, or no row at all and so NULL. The new figure is
--            the same number whenever the innings has a row (a row with no
--            faced ball has runs 0, and so has the sum over none). Where it
--            has none it is 0 where db/42 read NULL; both then fail
--            `v_runs >= 50`, so neither calls a fifty or a hundred — and the
--            trigger only asks for a ball it was just handed, whose own row
--            is in the innings unless something already voided it.
--
-- The trigger is still AFTER ROW, still SECURITY DEFINER with db/42's pinned
-- search_path, owner and grants, and it still reads with a fresh snapshot
-- per statement: the helpers are STABLE SQL, which read with the snapshot of
-- the plpgsql statement that calls them, as the SELECT … INTO they replace
-- did. So a bulk INSERT (whose row triggers all run after its last row) sees
-- what it saw before, and a live match's one-ball INSERT sees the ball it
-- just wrote. A void is a row of kind 'void', which the trigger's WHEN never
-- fires for, before or after this file; a voided ball leaves the figures
-- through ball_event_live, as it did through player_innings.
--
-- WHO MAY CALL THE HELPERS. Nobody but their owner, whom the trigger runs
-- as. They are SECURITY INVOKER and read ball_event_live under the caller's
-- policy, so they would tell a reader nothing player_innings does not; but
-- nothing outside the trigger needs them, so they are not handed out:
-- revoked from PUBLIC and, on a managed host, from its API roles (db/47's
-- block and its check).
--
-- The self-check at the end proves the shape unchanged, each helper equal
-- to player_innings over every row the log holds, and the notices a fixture
-- raises — every kind the trigger writes — before rolling the fixture back;
-- db/99 §29 holds the same over the whole log after every migration.

-- ── The shape of what this file replaces, before it does ───────────
CREATE TEMP TABLE _db51_before AS
SELECT p.oid::regprocedure::text AS obj,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid),
         'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef,
         'volatility', p.provolatile,
         'config', to_jsonb(p.proconfig),
         'acl', to_jsonb(p.proacl::text[]),
         'owner', p.proowner::regrole::text,
         'language', p.prolang) AS shape,
       (SELECT jsonb_agg(jsonb_build_object('name', t.tgname, 'type', t.tgtype, 'enabled', t.tgenabled,
                                            'def', pg_get_triggerdef(t.oid)) ORDER BY t.tgname)
          FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS triggers
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.oid::regprocedure::text = 'milestone_watch()';

-- ── The two figures, off the balls he faced ───────────────────────
-- player_innings' first arm (db/43), summed: runs off the bat
-- (ball_runs_off_bat(), db/40) of every live delivery he faced.
CREATE OR REPLACE FUNCTION innings_runs_off_bat(p_player uuid, p_match uuid, p_innings smallint)
RETURNS bigint AS $$
  SELECT coalesce(sum(ball_runs_off_bat(b.ball_type, b.value, b.payload)), 0)
    FROM ball_event_live b
   WHERE b.match_id = p_match AND b.innings = p_innings
     AND b.kind = 'ball' AND b.striker_id = p_player
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION career_runs_off_bat(p_player uuid)
RETURNS bigint AS $$
  SELECT coalesce(sum(ball_runs_off_bat(b.ball_type, b.value, b.payload)), 0)
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.striker_id = p_player
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION innings_runs_off_bat(uuid, uuid, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION career_runs_off_bat(uuid) FROM PUBLIC;

-- On a managed host the platform's API roles get EXECUTE on every new
-- function in public by default privilege, directly and not through PUBLIC
-- (db/29, db/47).
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['innings_runs_off_bat(uuid,uuid,smallint)', 'career_runs_off_bat(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $revoke_platform_roles$;

-- ── Three indexes, so "his own balls" is his own balls ────────────
-- ball_event has had no index on who faced or who bowled since db/02, so
-- `striker_id = p` was a scan of the whole log however few rows it kept, and
-- so was the void check every read of ball_event_live makes (NOT EXISTS a
-- void in the same match whose payload names the ball) — two scans of the
-- log per scoring ball, measured at 334 buffers of a 5,000-ball log. With
-- these, the career figure reads the striker's deliveries and the voids,
-- and nothing else. Partial, because both questions are only ever asked of
-- one kind of row: a delivery (kind = 'ball') or a void. The bowler's index
-- serves the trigger's bowling branch — bowler_innings_figures and
-- bowler_hat_trick for one bowler. An index moves
-- no row and no value; it takes ball_event's write lock while it builds,
-- which at a school's volume is milliseconds.
CREATE INDEX IF NOT EXISTS ball_event_striker_ball ON ball_event (striker_id) WHERE kind = 'ball';
CREATE INDEX IF NOT EXISTS ball_event_bowler_ball  ON ball_event (bowler_id)  WHERE kind = 'ball';
CREATE INDEX IF NOT EXISTS ball_event_void_target  ON ball_event (match_id, (payload->>'target')) WHERE kind = 'void';

-- ── Milestones as they happen ─────────────────────────────────────
-- db/42's, with the striker's two figures asked of the helpers above in
-- place of player_innings. Nothing else in it moved.
CREATE OR REPLACE FUNCTION milestone_watch() RETURNS trigger AS $$
DECLARE v_runs int; v_before int; v_w int; v_career int; t int; v_bat int;
BEGIN
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

-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  r record;
  now_shape jsonb;
  now_triggers jsonb;
  n int;
  drift text;
  f text;
  -- The proof's own rows, built below and rolled back before this block ends.
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  m_a      uuid := gen_random_uuid();   -- the first fixture
  m_b      uuid := gen_random_uuid();   -- a week later
  m_c      uuid := gen_random_uuid();   -- he never faces a ball in it
  p_a      uuid := gen_random_uuid();   -- the batter
  p_b      uuid := gen_random_uuid();   -- his partner, the bowler's victims
  p_c      uuid := gen_random_uuid();   -- the bowler
  x        record;
  v_setting text := coalesce(current_setting('app.user_id', true), '');
  fixture_got text;
  fixture_want text;
  fixture_rows int;
BEGIN
  -- The shape: the same function, the same trigger on it, a new body.
  SELECT count(*) INTO n FROM _db51_before;
  IF n <> 1 THEN RAISE EXCEPTION 'db/51: expected to snapshot milestone_watch(), found % functions', n; END IF;
  SELECT * INTO r FROM _db51_before;
  SELECT jsonb_build_object(
           'result', pg_get_function_result(p.oid),
           'args', pg_get_function_arguments(p.oid),
           'definer', p.prosecdef,
           'volatility', p.provolatile,
           'config', to_jsonb(p.proconfig),
           'acl', to_jsonb(p.proacl::text[]),
           'owner', p.proowner::regrole::text,
           'language', p.prolang),
         (SELECT jsonb_agg(jsonb_build_object('name', t.tgname, 'type', t.tgtype, 'enabled', t.tgenabled,
                                              'def', pg_get_triggerdef(t.oid)) ORDER BY t.tgname)
            FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal)
    INTO now_shape, now_triggers
    FROM pg_proc p WHERE p.oid = 'milestone_watch()'::regprocedure;
  IF now_shape IS DISTINCT FROM r.shape THEN
    RAISE EXCEPTION 'db/51: milestone_watch() changed shape: was %, now %', r.shape, now_shape;
  END IF;
  IF now_triggers IS DISTINCT FROM r.triggers OR jsonb_array_length(now_triggers) <> 1 THEN
    RAISE EXCEPTION 'db/51: the trigger on milestone_watch() moved: was %, now %', r.triggers, now_triggers;
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'milestone_watch()'::regprocedure) ~ 'player_innings' THEN
    RAISE EXCEPTION 'db/51: milestone_watch() still reads player_innings';
  END IF;

  -- Nobody but the owner may call the helpers: not PUBLIC, and not a
  -- managed host's API roles where they exist. Invoker, STABLE, SQL.
  FOREACH f IN ARRAY ARRAY['innings_runs_off_bat(uuid,uuid,smallint)', 'career_runs_off_bat(uuid)'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) acl
                WHERE p.oid = f::regprocedure AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/51: % is executable by PUBLIC', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r2 WHERE r2.rolname IN ('anon', 'authenticated', 'scrbrd_app')
                  AND has_function_privilege(r2.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/51: % is executable by an application or API role', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f::regprocedure
                      AND NOT p.prosecdef AND p.provolatile = 's'
                      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')) THEN
      RAISE EXCEPTION 'db/51: % is not a STABLE SECURITY INVOKER SQL function', f;
    END IF;
  END LOOP;

  -- The three indexes, built and valid.
  SELECT count(*) INTO n FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'ball_event'::regclass AND i.indisvalid AND i.indisready
     AND c.relname IN ('ball_event_striker_ball', 'ball_event_bowler_ball', 'ball_event_void_target');
  IF n <> 3 THEN RAISE EXCEPTION 'db/51: % of the 3 indexes on ball_event are built and valid', n; END IF;

  -- The values, on every row the log holds, as whoever runs this file (the
  -- owner, as the trigger reads): each helper against player_innings — the
  -- innings figure for every innings it has, the career figure for every
  -- player, including those with none. Empty on a fresh install.
  WITH d AS (
    SELECT format('innings %s/%s/%s: %s, player_innings %s', i.player_id, i.match_id, i.innings,
                  innings_runs_off_bat(i.player_id, i.match_id, i.innings), i.runs) AS k
      FROM player_innings i
     WHERE innings_runs_off_bat(i.player_id, i.match_id, i.innings) IS DISTINCT FROM coalesce(i.runs, 0)
    UNION ALL
    SELECT format('career %s: %s, player_innings %s', p.id, career_runs_off_bat(p.id), c.runs)
      FROM player p
      CROSS JOIN LATERAL (SELECT coalesce(sum(i.runs), 0) AS runs FROM player_innings i WHERE i.player_id = p.id) c
     WHERE career_runs_off_bat(p.id) IS DISTINCT FROM c.runs)
  SELECT count(*), string_agg(k, '; ') INTO n, drift FROM d;
  IF n > 0 THEN
    RAISE EXCEPTION 'db/51: % figure(s) on this database are not what player_innings says: %', n, left(drift, 600);
  END IF;

  -- The notices, on a fixture that raises every kind the trigger writes, one
  -- statement per delivery as a match arrives. Written as the owner and then
  -- undone: the sentinel rolls the block back to before its first INSERT.
  --   m_a, innings 0: a six by A, voided; then 17 sixes by A — a fifty at the
  --     ninth (54), a hundred at the seventeenth (102); a no-ball whose 4 are
  --     byes (nothing off the bat); A retires out.
  --   m_a, innings 1: C bowls to B — bowled five times in a row: a hat-trick
  --     completed at the third, a five-for at the fifth.
  --   m_b, innings 0: A 67 sixes — a fifty, a hundred, and 500 career runs at
  --     the 67th (102 + 402 = 504, from 498); B run out at the other end.
  --   m_b, innings 1: C to B — a no-ball, then a lbw on the free hit (saved,
  --     no wicket), a run out (not the bowler's), then twenty bowled: a
  --     hat-trick completed at the third, a five-for at the fifth and 25
  --     career wickets at the twentieth.
  --   m_b, innings 2: A bats again, as a two-innings fixture has him do — 9
  --     sixes, a fifty in THIS innings (54), with 402 already in the other.
  --   m_c, innings 0: B on strike, A run out at the other end — an innings of
  --     A's with no ball faced in it.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db51-' || v_school, 'db/51 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db51-' || v_user || '@example.invalid', 'db/51 proof, scorer', 'coach', v_school);
    INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
      (p_a, v_school, '1XI', 'db/51 Opener',  1, 'batter', (current_date - interval '16 years')::date),
      (p_b, v_school, '1XI', 'db/51 Partner', 2, 'batter', (current_date - interval '16 years')::date),
      (p_c, v_school, '1XI', 'db/51 Seamer',  3, 'bowler', (current_date - interval '16 years')::date);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (m_a, v_school, '1XI', 'db/51 proof A', now() - interval '21 days', 'cricket', 'T20', 20, 'complete'),
      (m_b, v_school, '1XI', 'db/51 proof B', now() - interval '14 days', 'cricket', 'T20', 20, 'complete'),
      (m_c, v_school, '1XI', 'db/51 proof C', now() - interval '7 days',  'cricket', 'T20', 20, 'complete');

    -- One INSERT per delivery, in order: each row's trigger runs before the
    -- next row exists, as on a match day. The void takes back m_a's first
    -- six (seq 1), as db/49's fixture takes back its thirteenth row.
    FOR x IN
      SELECT e.m, e.inn, e.kind, e.bt, e.v, e.striker, e.bowler, e.dismissed, e.dis,
             CASE WHEN e.kind = 'void' THEN jsonb_build_object('target', 'db51:' || e.m || ':1') ELSE e.pl END AS pl,
             row_number() OVER (PARTITION BY e.m ORDER BY e.ord, g)::int AS seq
        FROM (VALUES
          ( 1, m_a, 0, 'ball',   'run', 6,    p_a,  NULL::uuid, NULL::uuid, NULL,          '{}'::jsonb,         1),
          ( 2, m_a, 0, 'void',   NULL,  NULL, NULL, NULL,       NULL,       NULL,          '{}'::jsonb,         1),
          ( 3, m_a, 0, 'ball',   'run', 6,    p_a,  NULL,       NULL,       NULL,          '{}'::jsonb,        17),
          ( 4, m_a, 0, 'ball',   'Nb',  4,    p_a,  NULL,       NULL,       NULL,          '{"nbRuns":"byes"}', 1),
          ( 5, m_a, 0, 'retire', 'W',   NULL, NULL, NULL,       NULL,       'retired_out', jsonb_build_object('batter', p_a, 'reason', 'out'), 1),
          ( 6, m_a, 1, 'ball',   'W',   0,    p_b,  p_c,        NULL,       'bowled',      '{}'::jsonb,         5),
          ( 7, m_b, 0, 'ball',   'run', 6,    p_a,  NULL,       NULL,       NULL,          '{}'::jsonb,        67),
          ( 8, m_b, 0, 'ball',   'W',   0,    p_a,  NULL,       p_b,        'run_out',     '{}'::jsonb,         1),
          ( 9, m_b, 1, 'ball',   'Nb',  0,    p_b,  p_c,        NULL,       NULL,          '{}'::jsonb,         1),
          (10, m_b, 1, 'ball',   'W',   0,    p_b,  p_c,        NULL,       'lbw',         '{}'::jsonb,         1),
          (11, m_b, 1, 'ball',   'W',   0,    p_b,  p_c,        NULL,       'run_out',     '{}'::jsonb,         1),
          (12, m_b, 1, 'ball',   'W',   0,    p_b,  p_c,        NULL,       'bowled',      '{}'::jsonb,        20),
          (13, m_b, 2, 'ball',   'run', 6,    p_a,  NULL,       NULL,       NULL,          '{}'::jsonb,         9),
          (14, m_c, 0, 'ball',   'W',   0,    p_b,  NULL,       p_a,        'run_out',     '{}'::jsonb,         1)
        ) AS e(ord, m, inn, kind, bt, v, striker, bowler, dismissed, dis, pl, times)
        CROSS JOIN LATERAL generate_series(1, e.times) AS g
       ORDER BY e.m = m_c, e.m = m_b, e.ord, g
    LOOP
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value,
                              striker_id, bowler_id, dismissed_id, dismissal, payload)
      VALUES (x.m, v_school, x.seq, 1, x.inn, v_user, 'db51-proof', 'db51:' || x.m || ':' || x.seq, x.seq, now(),
              x.kind, x.bt, x.v, x.striker, x.bowler, x.dismissed, x.dis, x.pl);
    END LOOP;

    SELECT string_agg(format('%s:%s:%s:%s:%s',
                             CASE n2.player_id WHEN p_a THEN 'A' WHEN p_b THEN 'B' ELSE 'C' END, n2.kind,
                             CASE n2.match_id WHEN m_a THEN 'a' WHEN m_b THEN 'b' ELSE 'c' END, n2.innings, n2.value),
                      ' ' ORDER BY n2.ctid)
      INTO fixture_got
      FROM (SELECT ctid, * FROM milestone_notice WHERE player_id IN (p_a, p_b, p_c)) n2;
    -- And the helpers against player_innings over the fixture's players only,
    -- so a database whose log already disagreed cannot hide this one.
    SELECT count(*) INTO fixture_rows FROM (
      SELECT 1 FROM player_innings i
       WHERE i.player_id IN (p_a, p_b, p_c)
         AND innings_runs_off_bat(i.player_id, i.match_id, i.innings) IS DISTINCT FROM coalesce(i.runs, 0)
      UNION ALL
      SELECT 1 FROM player p
       WHERE p.id IN (p_a, p_b, p_c)
         AND career_runs_off_bat(p.id) IS DISTINCT FROM
             (SELECT coalesce(sum(i.runs), 0) FROM player_innings i WHERE i.player_id = p.id)) off_by;

    RAISE EXCEPTION USING ERRCODE = 'ZZ051', MESSAGE = 'db/51: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ051' THEN NULL;
  END;

  fixture_want := 'A:fifty:a:0:54 A:hundred:a:0:102 C:hat_trick:a:1:3 C:five_for:a:1:5 '
               || 'A:fifty:b:0:54 A:hundred:b:0:102 A:career_runs:b:0:500 '
               || 'C:hat_trick:b:1:3 C:five_for:b:1:5 C:career_wickets:b:0:25 A:fifty:b:2:54';
  IF fixture_got IS DISTINCT FROM fixture_want THEN
    RAISE EXCEPTION 'db/51: the fixture raised %, expected % — the trigger no longer calls the milestones it did', fixture_got, fixture_want;
  END IF;
  IF fixture_rows IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'db/51: % of the fixture''s figures are not what player_innings says', fixture_rows;
  END IF;

  -- And nothing of the proof is left: no row, no setting.
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school)
     OR EXISTS (SELECT 1 FROM app_user WHERE id = v_user)
     OR EXISTS (SELECT 1 FROM player WHERE id IN (p_a, p_b, p_c))
     OR EXISTS (SELECT 1 FROM match WHERE id IN (m_a, m_b, m_c))
     OR EXISTS (SELECT 1 FROM ball_event WHERE match_id IN (m_a, m_b, m_c))
     OR EXISTS (SELECT 1 FROM milestone_notice WHERE player_id IN (p_a, p_b, p_c))
     OR coalesce(current_setting('app.user_id', true), '') IS DISTINCT FROM v_setting THEN
    RAISE EXCEPTION 'db/51: the proof left something behind';
  END IF;
END $check$;

DROP TABLE _db51_before;

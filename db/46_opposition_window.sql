-- ══════════════════════════════════════════════════════════════════
--  46 · The opposition window is five days (SCRBRD-091)
-- ══════════════════════════════════════════════════════════════════
--
-- The opposition dossier is the one signed-in read that crosses the tenant
-- line on purpose: a coach of a side with a head-to-head fixture reads the
-- other school's squad and what their ball log says, and only inside a
-- window before the first ball (db/08, "Opposition intelligence"). The window
-- is opposition_window_days(), read by opposition_side(), and db/08 set it to
-- fourteen days as "a first cut: long enough to prepare, short enough that a
-- rival's record is not simply available all season".
--
-- THE DECISION. Kameel, product owner, 2026-09-25 (backlog SCRBRD-091). On
-- the public-data sheet (docs/policy/PUBLIC_DATA.md, A7) he had noted:
--
--     "Opposing schools will have access to each other's team squads 5 days
--      prior to their head-to-head fixtures."
--
-- SCRBRD-091 asked for one number — five for everything, or five for the
-- squad and fourteen for the figures — and he answered:
--
--     "14 days seems excessive; 5-7 days would be more than appropriate for
--      an opposition to do their due diligence and homework."
--
-- The decision is FIVE DAYS, ONE WINDOW FOR EVERYTHING THE DOSSIER OPENS —
-- squad and figures alike. Five is the number of his own A7 note and the
-- lower end of the range he gave, and it is the right end: the dossier
-- discloses another school's children, and the least disclosure that still
-- lets a coach prepare is the right amount of it. One window, because squad
-- and figures come through the same door (opposition_squad() and
-- opposition_context() both ask opposition_side()): two windows would be a
-- second door.
--
-- WHAT FIVE DAYS MEANS. Exactly what fourteen meant, shorter: the window
-- opens at the fixture's start less five days (make_interval(days => 5),
-- in the session's time zone) and shuts at the first ball. A fixture four
-- days out is open; one six days out answers 'not_yet_open' with the moment
-- it will open. Nothing else about the dossier moves: the fixture rule, the
-- feature switch, the cricket-only columns, the evidence floor, the access log.
--
-- WHY A REPLACEMENT BODY IS ENOUGH. The function keeps its name, its (empty)
-- argument list, its result, LANGUAGE sql, IMMUTABLE, and every other
-- attribute it was created with, and CREATE OR REPLACE keeps its oid, owner
-- and grants (its ACL is the default one, as db/08 left it). Every dependent,
-- looked for in pg_depend AND in the text of every function body, view, rule,
-- index, constraint, default, policy, trigger and statistics object at db/45
-- — pg_depend does not see a call inside a function body:
--
--   opposition_side(uuid)       db/08  plpgsql, SECURITY DEFINER: the ONLY
--                                      caller. It computes opens_at from the
--                                      function on every call.
--   opposition_context(uuid)    db/08  reach it only through opposition_side(),
--   opposition_squad(uuid)      db/43    which is plpgsql and a definer and so
--                                        is never inlined into them: no SQL
--                                        function holds a folded 14.
--
-- and nothing else. No view, index expression or predicate, constraint,
-- default, generated column, policy, trigger condition or BEGIN ATOMIC body
-- calls it. (An IMMUTABLE function inside an index would be the case where a
-- new body is NOT enough — rows filed under the old answer. There is none.)
-- Nothing is STORED from it either: opens_at and closes_at are computed per
-- call and never written; access_log records a read, not a window. So there
-- is no data to move.
--
-- A plan cached in an open session — a plpgsql expression, a prepared
-- statement — that folded the IMMUTABLE call to 14 is invalidated when the
-- function is replaced: Postgres records a plan's dependency on a function
-- even when the planner folds the call away. Walked on Postgres 16 with two
-- sessions before this was written: a warmed plpgsql caller and a prepared
-- statement both answered the new value on their next call. The API's pooled
-- connections read five from the statement after this commits; nothing needs
-- restarting.
--
-- db/08 is frozen and keeps its comment; this header supersedes it.
--
-- OUTSIDE db/: the dossier screen (apps/web/src/views/dossier.jsx) said
-- "fourteen days" in words of its own. It now says the number the server
-- sends — the days between opens_at and closes_at — so the screen cannot
-- drift from this function again.
--
-- PROVED BY: the block at the end of this file (the value, the shape, and
-- opposition_side() at four and six days out, on fixtures it builds and
-- rolls back); db/99 §24; tools/smoke-opposition.mjs ("A window: five days
-- before, until the first ball") and tools/smoke-browser-dossier.mjs.

-- ── The shape of what this file replaces, before it does ───────────
-- As db/45's: a plain temporary table, dropped at the end.
CREATE TEMP TABLE _db46_before AS
SELECT 'function:' || p.oid::regprocedure::text AS obj,
       p.oid AS fn,
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
         'language', p.prolang) AS shape
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.oid::regprocedure::text = 'opposition_window_days()';

-- ── The window ─────────────────────────────────────────────────────
-- Five days before the first ball (SCRBRD-091). A function rather than a
-- constant so the number has a name, a note and a single home.
CREATE OR REPLACE FUNCTION opposition_window_days() RETURNS integer AS $$
  SELECT 5
$$ LANGUAGE sql IMMUTABLE;

-- ── Assertion: the number moved, and nothing else did ──────────────
DO $check$
DECLARE r record; now_shape jsonb; n int; src text;
  -- The proof's own rows, built below and rolled back before this block ends.
  v_home   uuid := gen_random_uuid();
  v_away   uuid := gen_random_uuid();
  v_coach  uuid := gen_random_uuid();
  m_four   uuid := gen_random_uuid();
  m_six    uuid := gen_random_uuid();
  -- '' and unset are one state to app_user_id() (nullif), and a rolled-back
  -- set_config() can leave the one where the other was.
  v_user   text := coalesce(current_setting('app.user_id', true), '');
  v_flags  jsonb := (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.key) FROM feature_flag f
                      WHERE f.key IN ('opposition', 'sport_cricket'));
  four_open boolean; four_reason text;
  six_open  boolean; six_reason  text; six_opens timestamptz; six_starts timestamptz;
BEGIN
  -- The value.
  IF opposition_window_days() IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'db/46: opposition_window_days() answers %, expected 5', opposition_window_days();
  END IF;

  -- The shape: the same function, the same everything but its body.
  SELECT count(*) INTO n FROM _db46_before;
  IF n <> 1 THEN RAISE EXCEPTION 'db/46: expected to snapshot 1 object, found %', n; END IF;
  FOR r IN SELECT * FROM _db46_before LOOP
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
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/46: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
    IF to_regprocedure(substr(r.obj, 10)) IS DISTINCT FROM r.fn THEN
      RAISE EXCEPTION 'db/46: % is a new function, not the one db/08 made', r.obj;
    END IF;
  END LOOP;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'opposition_window_days()'::regprocedure) <> 'i'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'opposition_window_days()'::regprocedure) !~ '^\s*SELECT 5\s*$' THEN
    RAISE EXCEPTION 'db/46: opposition_window_days() is not the IMMUTABLE `SELECT 5` this file wrote';
  END IF;

  -- The door still asks it. Everything above rests on opposition_side()
  -- being the one caller and reading the window from the function.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'opposition_side(uuid)'::regprocedure;
  IF src NOT LIKE '%opens_at  := m.starts_at - make_interval(days => opposition_window_days());%' THEN
    RAISE EXCEPTION 'db/46: opposition_side() does not open the window at the start less opposition_window_days()';
  END IF;

  -- The behaviour. Two Hilton-and-Westville-shaped schools that exist only
  -- inside this block, a coach of the home 1XI, the feature on, and two
  -- fixtures against the away 1XI: four days out and six. Written as the
  -- owner, read through opposition_side() as the coach — its own gate, with
  -- its own feature check — and then undone: the sentinel below rolls the
  -- block back to before its first INSERT, flags, rows and session setting
  -- alike, whatever the database this runs on already holds.
  BEGIN
    INSERT INTO school (id, code, name)
    VALUES (v_home, 'db46-' || v_home, 'db/46 proof, home'),
           (v_away, 'db46-' || v_away, 'db/46 proof, away');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_coach, 'db46-' || v_coach || '@example.invalid', 'db/46 proof, coach', 'coach', v_home);
    PERFORM set_config('app.user_id', v_coach::text, true);
    INSERT INTO role_assignment (person_id, role, school_id, team_code)
    VALUES (v_coach, 'coach', v_home, '1XI');
    -- On, whatever the platform has set: this proves the window, not the switch.
    UPDATE feature_flag SET enabled = true, locked = false WHERE key IN ('opposition', 'sport_cricket');
    INSERT INTO match (id, school_id, team_code, away_school_id, away_team_code, opponent,
                       starts_at, sport, format, overs, status)
    VALUES (m_four, v_home, '1XI', v_away, '1XI', 'db/46 proof', now() + interval '4 days',
            'cricket', 'T20', 20, 'scheduled'),
           (m_six,  v_home, '1XI', v_away, '1XI', 'db/46 proof', now() + interval '6 days',
            'cricket', 'T20', 20, 'scheduled');

    SELECT s.open, s.reason INTO four_open, four_reason FROM opposition_side(m_four) s;
    SELECT s.open, s.reason, s.opens_at INTO six_open, six_reason, six_opens FROM opposition_side(m_six) s;
    SELECT m.starts_at INTO six_starts FROM match m WHERE m.id = m_six;

    RAISE EXCEPTION USING ERRCODE = 'ZZ046', MESSAGE = 'db/46: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ046' THEN NULL;
  END;

  IF four_open IS NOT TRUE OR four_reason IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'db/46: a fixture four days out answered open %, reason % — expected open: inside the five-day window',
      coalesce(four_open::text, 'no row'), coalesce(four_reason, 'no row');
  END IF;
  IF six_open IS NOT FALSE OR six_reason IS DISTINCT FROM 'not_yet_open' THEN
    RAISE EXCEPTION 'db/46: a fixture six days out answered open %, reason % — expected not_yet_open: outside the five-day window',
      coalesce(six_open::text, 'no row'), coalesce(six_reason, 'no row');
  END IF;
  IF six_opens IS DISTINCT FROM six_starts - make_interval(days => 5) THEN
    RAISE EXCEPTION 'db/46: a fixture starting % says its window opens %, expected five days before', six_starts, six_opens;
  END IF;

  -- And nothing of the proof is left: no row, no flag, no session setting.
  IF EXISTS (SELECT 1 FROM school WHERE id IN (v_home, v_away))
     OR EXISTS (SELECT 1 FROM app_user WHERE id = v_coach)
     OR EXISTS (SELECT 1 FROM role_assignment WHERE person_id = v_coach)
     OR EXISTS (SELECT 1 FROM match WHERE id IN (m_four, m_six))
     OR (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.key) FROM feature_flag f
          WHERE f.key IN ('opposition', 'sport_cricket')) IS DISTINCT FROM v_flags
     OR coalesce(current_setting('app.user_id', true), '') IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'db/46: the proof left something behind';
  END IF;
END $check$;

DROP TABLE _db46_before;

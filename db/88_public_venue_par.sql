-- ══════════════════════════════════════════════════════════════════
--  88 · Par for the public pages and the ground display
--       (SCRBRD-133 phase G2: par and pressure)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-133_immersive_match_centre.md
-- §3.2 (decided, Kameel 2026-10-02: D4, D5, D6, D16). The design names this
-- file db/78 and its proof §50; both numbers were taken by the time it was
-- built, so it is db/88 and its proof is db/99 §66.
--
-- WHAT A SIGNED-OUT PAGE MAY KNOW OF A GROUND'S PAR. The Board's second line
-- says "12 ahead of par for this ground" and the worm draws the par as a
-- dashed line. Both come from GET /api/public/matches/:id/par, which runs as
-- NOBODY (services/api/public/public-api.mjs): every row-level policy denies
-- it and only the definers of db/59 and their kin answer. db/74's readers ask
-- facility.read or match_result_readable(), which nobody holds; so this file
-- gives the public read path its own two, each behind
-- public_fixture_served() (db/59) — a fixture neither of whose sides is
-- published gets the same nothing as one that does not exist.
--
--   public_venue_par(match)  the ground's par for a PUBLISHED fixture, at its
--                            overs and band: the figure and its team-level
--                            evidence — n, the floor, the median, the range,
--                            the seasons — and NOTHING below the floor (D5:
--                            "not enough matches here yet" is a ground page's
--                            sentence, not a scoreboard's). Not the innings
--                            list, not the breakdown by ground, not a ground
--                            or match id: those name other fixtures, some of
--                            them nobody published. No player, no name, no
--                            age of a child (SCRBRD-130 §6.6): team totals.
--
--   public_dls_table(match)  the DLS table a PUBLISHED fixture reads — the one
--                            its frozen document names, else the current
--                            published one, as db/75's dls_table_for_match()
--                            chooses — WITH ITS CELLS, to the API process and
--                            no further (SCRBRD-130 D6). The par read computes
--                            par at a point from it on the server and sends a
--                            whole-run figure per over; parLeaks() refuses an
--                            answer with any key it does not list, so no cell
--                            and no resource leaves. Without this a public
--                            page would say "no DLS table loaded" while one
--                            was, which is false.
--
-- WHO MAY CALL THEM: scrbrd_app, the role the API connects as, and nobody
-- else — not PUBLIC and not a managed host's anon/authenticated roles (as
-- db/59: the cells must never be one anonymous key away).
--
-- RLS. Nothing new to read or write: two definers over db/74's figure and
-- db/75's tables, each owner-only underneath.

-- ── 1 · The ground's par, for a published fixture ─────────────────
CREATE OR REPLACE FUNCTION public_venue_par(p_match uuid)
RETURNS TABLE (overs integer, age_band text, n integer, floor integer, sufficient boolean, par integer,
               median numeric, low integer, high integer, first_season integer, last_season integer) AS $$
  SELECT v.overs, v.age_band, v.n, v.floor, v.sufficient, v.par, v.median, v.low, v.high, v.first_season, v.last_season
    FROM match m, LATERAL venue_par_compute(m.ground_id, m.overs::integer, venue_par_band(m.id), sa_today()) v
   WHERE m.id = p_match
     AND m.ground_id IS NOT NULL AND m.overs IS NOT NULL
     AND public_fixture_served(m.id)
     AND v.sufficient AND v.par IS NOT NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public_venue_par(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_venue_par(uuid) TO scrbrd_app;

-- ── 2 · The DLS table a published fixture reads, for the server ───
-- dls_table_for_match()'s choice (db/75), behind publication instead of
-- match_result_readable(): the table the document names (published or since
-- withdrawn — the match reads it for ever), else the current published one.
CREATE OR REPLACE FUNCTION public_dls_table(p_match uuid)
RETURNS TABLE (id uuid, version smallint, grain text, max_balls smallint, status text, current boolean, cells jsonb) AS $$
  WITH named AS (
    SELECT (c.doc->'play'->'target.dls_table'->>'id')::uuid AS id
      FROM match_conditions c
     WHERE c.match_id = p_match AND jsonb_typeof(c.doc->'play'->'target.dls_table') = 'object'
  ),
  chosen AS (
    SELECT t.id, t.version, t.grain, t.max_balls, t.status, false AS current
      FROM dls_resource_table t JOIN named n ON n.id = t.id WHERE t.status IN ('published', 'withdrawn')
    UNION ALL
    SELECT t.id, t.version, t.grain, t.max_balls, t.status, true FROM dls_resource_table t
     WHERE NOT EXISTS (SELECT 1 FROM named) AND t.edition = 'standard' AND t.status = 'published'
       AND t.version = (SELECT max(x.version) FROM dls_resource_table x WHERE x.edition = 'standard' AND x.status = 'published')
  )
  SELECT t.id, t.version, t.grain, t.max_balls, t.status, t.current,
         (SELECT coalesce(jsonb_agg(jsonb_build_array(r.balls_remaining, r.wickets_lost, r.resource_tenths)
                                    ORDER BY r.balls_remaining, r.wickets_lost), '[]') FROM dls_resource r WHERE r.table_id = t.id)
    FROM chosen t
   WHERE public_fixture_served(p_match)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public_dls_table(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_dls_table(uuid) TO scrbrd_app;

-- ── 3 · Nobody else ─────────────────────────────────────────────────
-- A managed host grants new functions to its API roles directly (db/29):
-- taken back here, as db/59 and db/74 do.
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['public_venue_par(uuid)', 'public_dls_table(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;

-- ── 4 · The proof ────────────────────────────────────────────────
-- Built and rolled back. db/99 §66 is the fuller proof under the application
-- role, as nobody, on every verify paste. This is what must hold the moment
-- the file has run: at a ground of its own, five 20-over U15 first innings of
-- 100, 110, 120, 130 and 140 in the last week (par round(600 ÷ 5) = 120,
-- median 120, range 100–140), a published fixture there and one nobody
-- published; at a second ground four innings, below the floor, and a
-- published fixture. Dated from today, so the window (this season and the
-- two before it) holds whenever the file is run.
DO $check$
DECLARE
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  v_g      uuid := gen_random_uuid();   -- five innings
  v_g4     uuid := gen_random_uuid();   -- four
  v_on     uuid := gen_random_uuid();   -- published, at v_g
  v_off    uuid := gen_random_uuid();   -- nobody published it, at v_g
  v_few    uuid := gen_random_uuid();   -- published, at v_g4
  v_m      uuid;
  k        integer := 0;
  r        record;
  got      text;
  sq       jsonb := (SELECT jsonb_agg(jsonb_build_object('id', 'P' || g, 'name', 'P' || g)) FROM generate_series(1, 11) g);
BEGIN
  -- 1. Definers with a pinned search path, the application's alone, and the
  --    columns team-level: no innings list, no breakdown, no id of a ground
  --    or a match.
  FOREACH got IN ARRAY ARRAY['public_venue_par(uuid)', 'public_dls_table(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = got::regprocedure AND p.prosecdef
                     AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']) THEN
      RAISE EXCEPTION 'db/88: % is not a definer with a pinned search path', got;
    END IF;
    IF has_function_privilege('public', got, 'EXECUTE') OR NOT has_function_privilege('scrbrd_app', got, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/88: % is not the application''s alone', got;
    END IF;
  END LOOP;
  IF pg_get_function_result('public_venue_par(uuid)'::regprocedure)
       IS DISTINCT FROM 'TABLE(overs integer, age_band text, n integer, floor integer, sufficient boolean, par integer, median numeric, low integer, high integer, first_season integer, last_season integer)' THEN
    RAISE EXCEPTION 'db/88: public_venue_par returns %', pg_get_function_result('public_venue_par(uuid)'::regprocedure);
  END IF;
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db88-' || v_school, 'db/88 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db88-' || v_user || '@example.invalid', 'db/88 proof', 'scorer', v_school);
    INSERT INTO ground (id, school_id, name) VALUES (v_g, v_school, 'db/88 Oval'), (v_g4, v_school, 'db/88 Second Oval');
    FOR r IN SELECT * FROM (VALUES (1, 100, v_g), (2, 110, v_g), (3, 120, v_g), (4, 130, v_g), (5, 140, v_g),
                                   (1, 90, v_g4), (2, 90, v_g4), (3, 90, v_g4), (4, 90, v_g4)) AS x(d, runs, g) LOOP
      INSERT INTO match (school_id, team_code, opponent, starts_at, sport, format, overs, status, ground_id)
      VALUES (v_school, 'U15A', 'db/88 Visitors', now() - make_interval(days => r.d), 'cricket', 'T20', 20, 'complete', r.g)
      RETURNING id INTO v_m;
      k := k + 1;
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, payload)
      VALUES (v_m, v_school, 1, 1, 0, v_user, 'db88-pad', 'db88:' || k || ':1', 1, now(), 'innings_start',
              jsonb_build_object('battingTeam', 'U15A', 'bowlingTeam', 'db/88 Visitors', 'squad', sq, 'overs', 20));
      -- 120 legal balls: sixes, what is left over, then dots — the match
      -- complete, so the innings ended with its overs bowled.
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, ball_type, value, payload)
      SELECT v_m, v_school, 1 + g, 1, 0, v_user, 'db88-pad', 'db88:' || k || ':' || (1 + g), 1 + g, now(), 'ball', 'run',
             CASE WHEN g <= r.runs / 6 THEN 6 WHEN g = r.runs / 6 + 1 THEN r.runs % 6 ELSE 0 END, '{}'::jsonb
        FROM generate_series(1, 120) g;
    END LOOP;
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status, ground_id) VALUES
      (v_on,  v_school, 'U15A', 'db/88 Visitors', now(), 'cricket', 'T20', 20, 'live', v_g),
      (v_off, v_school, 'U15A', 'db/88 Visitors', now(), 'cricket', 'T20', 20, 'live', v_g),
      (v_few, v_school, 'U15A', 'db/88 Visitors', now(), 'cricket', 'T20', 20, 'live', v_g4);
    INSERT INTO fixture_publication (match_id, side, school_id, team_code, published, set_by)
    VALUES (v_on, 'home', v_school, 'U15A', true, v_user), (v_few, 'home', v_school, 'U15A', true, v_user);

    -- 2. A published fixture: the ground's par and its team-level evidence.
    SELECT row(v.overs, v.age_band, v.n, v.floor, v.sufficient, v.par, v.median, v.low, v.high,
               v.first_season = v.last_season OR v.first_season < v.last_season)::text
      INTO got FROM public_venue_par(v_on) v;
    IF got IS DISTINCT FROM '(20,U15,5,5,t,120,120,100,140,t)' THEN
      RAISE EXCEPTION 'db/88: the published fixture''s ground reads %', got;
    END IF;
    -- 3. Nobody published it: nothing, the same nothing as no fixture at all.
    IF EXISTS (SELECT 1 FROM public_venue_par(v_off)) OR EXISTS (SELECT 1 FROM public_venue_par(gen_random_uuid())) THEN
      RAISE EXCEPTION 'db/88: an unpublished fixture''s ground answered';
    END IF;
    -- 4. Below the floor: nothing — not a row with no par.
    IF EXISTS (SELECT 1 FROM public_venue_par(v_few)) THEN
      RAISE EXCEPTION 'db/88: a ground of four innings answered';
    END IF;
    -- 5. The table: never for a fixture nobody published; for a published one
    --    exactly the current published table, if there is one.
    IF EXISTS (SELECT 1 FROM public_dls_table(v_off)) THEN
      RAISE EXCEPTION 'db/88: an unpublished fixture read the DLS table';
    END IF;
    IF (SELECT count(*) FROM public_dls_table(v_on))
       <> (SELECT least(count(*), 1) FROM dls_resource_table WHERE edition = 'standard' AND status = 'published') THEN
      RAISE EXCEPTION 'db/88: a published fixture read % tables', (SELECT count(*) FROM public_dls_table(v_on));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ088', MESSAGE = 'db/88: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ088' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) THEN RAISE EXCEPTION 'db/88: the proof left something behind'; END IF;
END $check$;

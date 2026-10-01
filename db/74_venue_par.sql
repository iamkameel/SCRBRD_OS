-- ══════════════════════════════════════════════════════════════════
--  74 · Venue par: what sides have made batting first at a ground
--       (SCRBRD-130 phase R3)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-130_rain_and_par.md §6,
-- built to D9–D13 as decided (Kameel, 2026-09-30); its §9 records the build.
--
-- A FIGURE ABOUT A GROUND, FROM TEAM TOTALS, DERIVED ON EVERY READ AND
-- STORED NOWHERE. Par at a ground is the mean of the first-innings totals
-- made there, in the same kind of match, shown with the innings it came
-- from. It is evidence from the ground's own record — not the invented
-- absolute par phases.mjs refuses, and not a substitute for the DLS
-- Standard Edition's G50 (D7): the umpires use neither.
--
-- THE GRAIN (§6.2): the ground (a pitch pooling with the field it lies on,
-- D13), the overs of an innings, and the age band — the match's
-- competition's age group, else the home team's code (team_age_group(),
-- db/47), else open. Limited overs, one innings a side.
--
-- THE POOL (D9, D10, D12): the FIRST innings of a match at the ground when
--   - it ended all out or with its overs bowled (the fold's ending,
--     innings_result_state(), db/69), and was sealed or the match is complete;
--   - it carries no revision of its overs, and it was not terminated (an
--     abandoned ending is neither of the two above) — rain-shortened first
--     innings are excluded, not scaled;
--   - its allotment (its innings_start's overs) is the grain's overs;
--   - its match is in this school season or the two before it (the school
--     season is the calendar year, season_for(), db/08) on the day asked;
--   - a friendly counts; a scorebook innings counts when its card states its
--     figures (the fold's `summarised`), and the evidence says how many came
--     from books. A super over is never a match's first innings.
--
-- THE FIGURE (§6.3): par = round(mean(runs)), whole runs; with n, the seasons
-- spanned, the median, the range, the innings (date, sides, total — results
-- already shown on the results page; no player, no name of a child) and a
-- breakdown by the ground each was played on. Below the floor —
-- venue_par_min_innings() = 5, a platform constant pinned beside
-- packages/scoring/src/venue.mjs's VENUE_PAR_MIN_INNINGS (D11) — par is NULL
-- and `sufficient` false: "Not enough matches here yet (2 of 5)".
--
-- WHAT IS HERE.
--   venue_par_min_innings()            5 (D11)
--   ground_root(g)                     the ground a pitch pools with: its topmost field
--   venue_par_band(m)                  a match's age band for the grain
--   venue_par_pool(root, overs, on)    the innings that count, at a ground's tree (the owner's alone)
--   venue_par_compute(g, overs, band, on)  the figure and its evidence (the owner's alone)
--   venue_par(g, overs, band, on)      for whoever may read the ground (facility.read at its school)
--   venue_par_for_match(m, on)         for whoever may read the match's result (match_result_readable(),
--                                      db/69): its ground, its overs, its band — the board's par
--
-- Par at a point in an innings (§6.5) is not here: the read API computes it
-- (venue.mjs), from this figure and, when one is loaded, the DLS table (R2).
--
-- DEPARTURE (design §6.2 "the venue_par view"). Functions, not a view: the
-- window is the day asked (a fixture's date in a proof, today on a screen),
-- and the pool reads every school's matches at a ground, which no reader may
-- read whole — so it is the owner's, behind the two readers' guards.

-- ── 1 · The constant, the ground's tree, the band ─────────────────
CREATE OR REPLACE FUNCTION venue_par_min_innings() RETURNS integer AS $$
  SELECT 5
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- The ground a pitch pools with: the topmost ground above it (db/67 keeps a
-- tree at most eight deep, never a cycle), or itself.
CREATE OR REPLACE FUNCTION ground_root(p_ground uuid) RETURNS uuid AS $$
  WITH RECURSIVE up AS (
    SELECT g.id, g.parent_id, 0 AS d FROM ground g WHERE g.id = p_ground
    UNION ALL
    SELECT g.id, g.parent_id, up.d + 1 FROM ground g JOIN up ON g.id = up.parent_id WHERE up.d < 9
  )
  SELECT u.id FROM up u ORDER BY u.d DESC LIMIT 1
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

-- A match's age band: its competition's age group ("U15", "Open"), else its
-- home team's code ("U15A" → U15, "1XI" → open), else open.
CREATE OR REPLACE FUNCTION venue_par_band(p_match uuid) RETURNS text AS $$
  SELECT coalesce(team_age_group(upper(btrim(c.age_group))),
                  CASE WHEN lower(btrim(c.age_group)) IN ('open', 'senior', 'seniors') THEN 'open' END,
                  team_age_group(m.team_code), 'open')
    FROM match m LEFT JOIN competition c ON c.id = m.competition_id
   WHERE m.id = p_match
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

-- ── 2 · The pool, and the figure ──────────────────────────────────
-- Every first innings that counts at a ground's tree, for an allotment, on
-- the day asked. Runs as its caller over ball_event_live; the owner's alone.
CREATE OR REPLACE FUNCTION venue_par_pool(p_root uuid, p_overs integer, p_on date)
RETURNS TABLE (match_id uuid, starts_at timestamptz, season_year integer, ground_id uuid, overs integer, band text,
               runs integer, from_book boolean, home_label text, away_label text) AS $$
  SELECT m.id, m.starts_at, extract(year FROM (m.starts_at AT TIME ZONE 'Africa/Johannesburg'))::integer,
         m.ground_id, s.overs, venue_par_band(m.id), s.runs, s.summarised,
         coalesce(fixture_side_label(m.school_id, m.team_code), m.team_code),
         CASE WHEN m.away_school_id IS NULL THEN m.opponent ELSE fixture_side_label(m.away_school_id, m.away_team_code) END
    FROM match m
    LEFT JOIN match_conditions c ON c.match_id = m.id
   CROSS JOIN LATERAL (SELECT min(b.innings) AS i FROM ball_event_live b WHERE b.match_id = m.id) f
   CROSS JOIN LATERAL innings_result_state(m.id, f.i, coalesce(c.doc->'play', '{}'::jsonb),
                                           (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date >= DATE '2026-10-01') s
   WHERE m.ground_id IS NOT NULL AND ground_root(m.ground_id) = p_root
     AND f.i IS NOT NULL
     -- the window: this school season and the two before it (D12)
     AND extract(year FROM (m.starts_at AT TIME ZONE 'Africa/Johannesburg'))::integer
         BETWEEN extract(year FROM p_on)::integer - 2 AND extract(year FROM p_on)::integer
     -- limited overs, one innings a side
     AND coalesce(c.doc->'play'->>'format.kind', CASE WHEN free_hits_apply(m.format) THEN 'limited' ELSE 'declaration' END) = 'limited'
     AND coalesce(c.doc->'play'->'format.innings_per_side', '1'::jsonb) = '1'::jsonb
     -- played to its allotment: all out or its overs bowled, sealed or the match done
     AND s.end_reason IN ('all_out', 'overs_complete')
     AND (s.sealed OR m.status = 'complete')
     -- never cut by the umpires (D10)
     AND NOT EXISTS (SELECT 1 FROM ball_event_live r
                      WHERE r.match_id = m.id AND r.innings = f.i AND r.kind = 'revision' AND jsonb_typeof(r.payload->'overs') = 'number')
     AND s.overs = p_overs
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION venue_par_pool(uuid, integer, date) FROM PUBLIC;

-- The figure and its evidence, at a ground for an allotment and a band.
CREATE OR REPLACE FUNCTION venue_par_compute(p_ground uuid, p_overs integer, p_band text, p_on date)
RETURNS TABLE (ground_id uuid, pooled_ground_id uuid, overs integer, age_band text, n integer, floor integer,
               sufficient boolean, par integer, median numeric, low integer, high integer,
               first_season integer, last_season integer, from_books integer, innings jsonb, breakdown jsonb) AS $$
  WITH pool AS MATERIALIZED (
    SELECT p.* FROM venue_par_pool(ground_root(p_ground), p_overs, p_on) p WHERE p.band = lower(p_band) OR p.band = p_band
  )
  SELECT p_ground, ground_root(p_ground), p_overs, p_band,
         count(*)::integer, venue_par_min_innings(), count(*) >= venue_par_min_innings(),
         CASE WHEN count(*) >= venue_par_min_innings() THEN round(avg(x.runs))::integer END,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY x.runs))::numeric,
         min(x.runs), max(x.runs), min(x.season_year), max(x.season_year),
         (count(*) FILTER (WHERE x.from_book))::integer,
         coalesce(jsonb_agg(jsonb_build_object('match_id', x.match_id, 'date', (x.starts_at AT TIME ZONE 'Africa/Johannesburg')::date,
                                               'home', x.home_label, 'away', x.away_label, 'runs', x.runs,
                                               'ground_id', x.ground_id, 'from_book', x.from_book)
                            ORDER BY x.starts_at, x.match_id), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(jsonb_build_object('ground_id', b.ground_id, 'name', g.name, 'n', b.n, 'mean', b.mean)
                                    ORDER BY g.name, b.ground_id)
                     FROM (SELECT y.ground_id, count(*)::integer AS n, round(avg(y.runs))::integer AS mean
                             FROM pool y GROUP BY y.ground_id) b
                     JOIN ground g ON g.id = b.ground_id), '[]'::jsonb)
    FROM pool x
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION venue_par_compute(uuid, integer, text, date) FROM PUBLIC;

-- ── 3 · The readers ────────────────────────────────────────────────
-- A ground's par, for whoever may read the ground: facility.read at its
-- school (the floor bundle, as the ground itself is read). A coach on his
-- own ground page.
CREATE OR REPLACE FUNCTION venue_par(p_ground uuid, p_overs integer, p_band text, p_on date DEFAULT sa_today())
RETURNS TABLE (ground_id uuid, pooled_ground_id uuid, overs integer, age_band text, n integer, floor integer,
               sufficient boolean, par integer, median numeric, low integer, high integer,
               first_season integer, last_season integer, from_books integer, innings jsonb, breakdown jsonb) AS $$
  SELECT v.* FROM ground g, LATERAL venue_par_compute(g.id, p_overs, p_band, coalesce(p_on, sa_today())) v
   WHERE g.id = p_ground
     AND p_overs IS NOT NULL AND p_overs > 0 AND p_band IS NOT NULL
     AND app_can('facility.read', g.school_id, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION venue_par(uuid, integer, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION venue_par(uuid, integer, text, date) TO scrbrd_app;

-- The par of the ground a match is played on, at the match's own overs and
-- band, for whoever may read the match's result (match_result_readable():
-- the fixture at either side's scope, or its competition): the board's
-- "a typical side here would be …" line, first innings or second.
CREATE OR REPLACE FUNCTION venue_par_for_match(p_match uuid, p_on date DEFAULT sa_today())
RETURNS TABLE (ground_id uuid, pooled_ground_id uuid, overs integer, age_band text, n integer, floor integer,
               sufficient boolean, par integer, median numeric, low integer, high integer,
               first_season integer, last_season integer, from_books integer, innings jsonb, breakdown jsonb) AS $$
  SELECT v.* FROM match m, LATERAL venue_par_compute(m.ground_id, m.overs::integer, venue_par_band(m.id), coalesce(p_on, sa_today())) v
   WHERE m.id = p_match AND m.ground_id IS NOT NULL AND m.overs IS NOT NULL
     AND match_result_readable(p_match)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION venue_par_for_match(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION venue_par_for_match(uuid, date) TO scrbrd_app;

-- ── 4 · Grants ────────────────────────────────────────────────────
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['venue_par_min_innings()', 'ground_root(uuid)', 'venue_par_band(uuid)',
                               'venue_par_pool(uuid,integer,date)', 'venue_par_compute(uuid,integer,text,date)',
                               'venue_par(uuid,integer,text,date)', 'venue_par_for_match(uuid,date)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;

-- ── 5 · The proof ────────────────────────────────────────────────
-- Built and rolled back; db/99 §53 is the fuller proof under the
-- application role. A field with a pitch on it; four 20-over U15 first
-- innings of 100, 120, 140, 160 on the field and one of 180 on the pitch:
-- four say insufficient, the fifth (pooled from the pitch) says 140.
DO $check$
DECLARE
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  v_field  uuid := gen_random_uuid();
  v_pitch  uuid := gen_random_uuid();
  v_m      uuid;
  k        integer := 0;
  r        record;
  sq       jsonb := (SELECT jsonb_agg(jsonb_build_object('id', 'P' || g, 'name', 'P' || g)) FROM generate_series(1, 11) g);
BEGIN
  IF venue_par_min_innings() <> 5 THEN RAISE EXCEPTION 'db/74: the floor is not five'; END IF;
  IF has_function_privilege('scrbrd_app', 'venue_par_pool(uuid,integer,date)', 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'venue_par_compute(uuid,integer,text,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/74: the application may read the pool past its guards';
  END IF;
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db74-' || v_school, 'db/74 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db74-' || v_user || '@example.invalid', 'db/74 proof', 'scorer', v_school);
    INSERT INTO ground (id, school_id, name) VALUES (v_field, v_school, 'db/74 Field');
    INSERT INTO ground (id, school_id, name, parent_id) VALUES (v_pitch, v_school, 'db/74 Pitch B', v_field);
    FOR r IN SELECT * FROM (VALUES (1, 100, v_field), (2, 120, v_field), (3, 140, v_field), (4, 160, v_field), (5, 180, v_pitch)) AS x(d, runs, g) LOOP
      IF r.d = 5 THEN
        -- Four innings, all on the field: insufficient, and no par.
        IF (SELECT row(v.n, v.sufficient, v.par IS NULL)::text FROM venue_par_compute(v_field, 20, 'U15', DATE '2026-10-31') v)
           IS DISTINCT FROM '(4,f,t)' THEN
          RAISE EXCEPTION 'db/74: four innings read %', (SELECT row(v.n, v.sufficient, v.par)::text FROM venue_par_compute(v_field, 20, 'U15', DATE '2026-10-31') v);
        END IF;
      END IF;
      INSERT INTO match (school_id, team_code, opponent, starts_at, sport, format, overs, status, ground_id)
      VALUES (v_school, 'U15A', 'db/74 Visitors', make_timestamptz(2026, 10, r.d, 10, 0, 0, 'Africa/Johannesburg'),
              'cricket', 'T20', 20, 'complete', r.g) RETURNING id INTO v_m;
      k := k + 1;
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, payload)
      VALUES (v_m, v_school, 1, 1, 0, v_user, 'db74-pad', 'db74:' || k || ':1', 1, now(), 'innings_start',
              jsonb_build_object('battingTeam', 'U15A', 'bowlingTeam', 'db/74 Visitors', 'squad', sq, 'overs', 20));
      -- 120 legal balls: sixes, then what is left over, then dots — the
      -- match complete, so the innings ended with its overs bowled.
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, ball_type, value, payload)
      SELECT v_m, v_school, 1 + g, 1, 0, v_user, 'db74-pad', 'db74:' || k || ':' || (1 + g), 1 + g, now(), 'ball', 'run',
             CASE WHEN g <= r.runs / 6 THEN 6 WHEN g = r.runs / 6 + 1 THEN r.runs % 6 ELSE 0 END, '{}'::jsonb
        FROM generate_series(1, 120) g;
    END LOOP;
    -- Five: the pitch pooled with its field; mean, median and range of
    -- 100, 120, 140, 160, 180; the breakdown by the ground each was played on.
    IF (SELECT row(v.n, v.sufficient, v.par, v.median, v.low, v.high, v.pooled_ground_id = v_field, jsonb_array_length(v.breakdown))::text
          FROM venue_par_compute(v_pitch, 20, 'U15', DATE '2026-10-31') v) IS DISTINCT FROM '(5,t,140,140,100,180,t,2)' THEN
      RAISE EXCEPTION 'db/74: five innings at a field and its pitch read %',
        (SELECT row(v.n, v.sufficient, v.par, v.median, v.low, v.high, v.breakdown)::text FROM venue_par_compute(v_pitch, 20, 'U15', DATE '2026-10-31') v);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ074', MESSAGE = 'db/74: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ074' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) THEN RAISE EXCEPTION 'db/74: the proof left something behind'; END IF;
END $check$;

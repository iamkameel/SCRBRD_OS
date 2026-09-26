-- ══════════════════════════════════════════════════════════════════
--  49 · A career in one pass over the log
-- ══════════════════════════════════════════════════════════════════
--
-- CI's Awards walk failed with `career FAILED net::ERR_ABORTED @10950ms`: the
-- client gives up on a read at ten seconds, and the `career` read
-- (services/api/read/read-api.mjs) had grown past that. Measured locally as
-- the director of sport over the seed's 192 deliveries it took 480 ms and
-- 141,624 shared-buffer hits for 19 players; tools/bench-career.mjs has the
-- numbers at a season's volume.
--
-- WHY IT WAS SLOW. db/02 defined the three lifetime views over the windowed
-- functions with no window, one call per player:
--
--   player_batting_career   FROM player p CROSS JOIN LATERAL player_batting_since(p.id, NULL)
--   player_bowling_career   FROM player p CROSS JOIN LATERAL player_bowling_since(p.id, NULL)
--   player_dismissals       FROM player p WHERE player_dismissals_since(p.id, NULL) > 0
--                           (and the same call again in the select list)
--
-- Each call is inlined as its own sequential scan of ball_event, and none of
-- its row predicates — the striker OR the batter a wicket dismissed OR the
-- batter a retirement dismissed, each over payload — is leakproof, so the
-- planner must evaluate ball_event's policy (ball_event_read, db/02:
-- app_can('fixture.read', school_id, match_team(match_id), NULL, match_id))
-- on EVERY ball, for EVERY player, four times over. The cost was players ×
-- balls × app_can(): quadratic in a school's size, and every reader of a
-- career paid it — the Awards tab, the squad, the profile, Stats-Magic, the
-- dashboard's own figures, scouting_candidates().
--
-- WHAT THIS FILE DOES. The three views become what db/44's season views
-- already are: one scan of the deliveries the caller may see, grouped by
-- player, so the policy runs once per ball. Each is db/44's mirror of it
-- WITHOUT the season — the same row predicate, the same CASE for every
-- figure, the same rule functions (ball_runs_off_bat(), ball_retired_batter(),
-- db/40; ball_wicket_stands(), db/42; dismissal_is_bowlers(),
-- ball_dismissed_batter(), db/43) — so the argument db/44's header makes for
-- "a row's players are exactly the ones the function's WHERE would match"
-- is the argument here, and db/99 §22 has held it since db/44:
--
--   player_batting_career   a delivery's striker (faced), the batter a wicket
--                           that stood dismissed at the other end, the batter
--                           a retirement marked W dismissed — each row once
--                           per player (the NULLIFs), as the function's OR
--   player_bowling_career   the bowler of every delivery
--   player_dismissals       the batter a wicket that stood dismissed, or a
--                           retirement did — once per row, as the OR
--
-- and `JOIN player p` is the lifetime view's own `FROM player p`: a row for
-- a player the caller may read, and nobody else. The row set is the old one
-- exactly: a player the old view listed had matches > 0 (or dismissals > 0),
-- which is a delivery that matched him, which is a group here; and a group
-- here is at least one matching delivery, so matches > 0.
--
-- IDENTICAL, NOT SIMILAR. Same columns, names, types and order (CREATE OR
-- REPLACE VIEW refuses anything else), security_invoker restated (CREATE OR
-- REPLACE VIEW replaces the options), and the owner and grants a replace
-- keeps. Every figure is the same aggregate over the same rows — count(DISTINCT
-- match_id), coalesce(sum(...), 0) of the same CASE, max(server_ts), count(*)
-- — so NULL-vs-0 behaves as it did: `last_ball_at` is never NULL for a row
-- that exists, and the sums are coalesced exactly as the functions coalesce
-- them. The block at the end of this file proves it against the functions on
-- every row the log holds, and on a fixture carrying every rule; db/99 §27
-- proves it as eight readers under their own policies; tools/bench-career.mjs
-- --check proves it for the read as a whole.
--
-- NOT TOUCHED. The three *_since() functions keep their definitions: the
-- assessment read windows them per player (a rating's evidence since the
-- coach last looked), the walks read them per player, and they are now the
-- REFERENCE these views are proved against. player_innings, the breakdowns,
-- the season views, player_milestone, passport(), scouting_candidates() and
-- the read API follow without replacement — nothing they read changes shape,
-- and nothing they answer changes value.
--
-- THE ONE-DEFINITION RULE, KEPT BY PROOF. db/02 defined the views over the
-- functions so the composition lived once. It now lives twice, as db/44
-- already made it live three times; §22 (Σ seasons = lifetime) and §27
-- (lifetime = the functions) go red the day one copy moves without the others.
--
-- OUTSIDE db/: the `career` read's form guide was a per-player LATERAL over
-- player_innings, another pass over the log per player. It is one pass now:
-- the innings ranked per player by a window function, the last eight kept.
-- Its output is unchanged, ties in ended_at included (they are now broken by
-- match and innings, where before they were broken by whatever order the
-- sort met them in).

-- ── The shape of everything this file replaces, before it does ─────
-- As db/42's: a plain temporary table, dropped at the end.
CREATE TEMP TABLE _db49_before AS
SELECT c.relname AS obj,
       c.oid AS oid,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions),
         'acl', to_jsonb(c.relacl::text[]),
         'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND c.relname IN ('player_batting_career', 'player_bowling_career', 'player_dismissals');

-- ── Batting (player_batting_since(), db/43) ──────────────────────
-- player_batting_by_season (db/44) without the season. Runs, fours and sixes
-- off the bat, and balls faced (a no-ball is faced, a wide is not), only ever
-- off a ball he FACED; a wicket that stood and dismissed him at the other
-- end, and a retirement marked W, are innings he played with no run and no
-- ball in them.
CREATE OR REPLACE VIEW player_batting_career WITH (security_invoker = true) AS
SELECT who.player_id,
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
  -- (b.kind = 'ball' AND b.striker_id = p)
  -- OR (b.kind = 'ball' AND b.ball_type = 'W' AND ball_dismissed_batter(...) = p AND ball_wicket_stands(...))
  -- OR ball_retired_batter(...) = p
  -- db/44's three arms, NULLIF'd so a row counts once per player as the OR does.
  CROSS JOIN LATERAL (VALUES
    (CASE WHEN b.kind = 'ball' THEN b.striker_id END, true),
    (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
               AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
          THEN nullif(ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload), b.striker_id) END, false),
    (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
            CASE WHEN b.kind = 'ball' THEN b.striker_id END), false)
  ) AS who(player_id, faced)
  JOIN player p ON p.id = who.player_id
 GROUP BY who.player_id;

-- ── Bowling (player_bowling_since(), db/42) ──────────────────────
-- player_bowling_by_season (db/44) without the season.
CREATE OR REPLACE VIEW player_bowling_career WITH (security_invoker = true) AS
SELECT b.bowler_id                                                                AS player_id,
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
  JOIN player p ON p.id = b.bowler_id
 WHERE b.kind = 'ball'
 GROUP BY b.bowler_id;

-- ── Dismissals (player_dismissals_since(), db/43) ────────────────
-- player_dismissals_by_season (db/44) without the season.
CREATE OR REPLACE VIEW player_dismissals WITH (security_invoker = true) AS
SELECT who.player_id,
       count(*)                                                                   AS dismissals
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
  JOIN player p ON p.id = who.player_id
 GROUP BY who.player_id;

-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  r record;
  now_shape jsonb;
  v text;
  n int;
  drift text;
  -- The proof's own rows, built below and rolled back before this block ends.
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  m_a      uuid := gen_random_uuid();
  m_b      uuid := gen_random_uuid();
  p_a        uuid := gen_random_uuid();   -- on strike
  p_b        uuid := gen_random_uuid();   -- at the other end
  p_c        uuid := gen_random_uuid();   -- bowling
  v_door   boolean := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                               AND tgname = 'ball_event_names_its_delivery' AND tgenabled = 'O');
  v_setting text := coalesce(current_setting('app.user_id', true), '');
  fixture_drift text;
  fixture_rows int;
  fixture_want text;
BEGIN
  -- The shape: the same three views, the same everything but their bodies.
  SELECT count(*) INTO n FROM _db49_before;
  IF n <> 3 THEN RAISE EXCEPTION 'db/49: expected to snapshot 3 views, found %', n; END IF;
  FOR r IN SELECT * FROM _db49_before LOOP
    SELECT jsonb_build_object(
             'options', to_jsonb(c.reloptions),
             'acl', to_jsonb(c.relacl::text[]),
             'owner', c.relowner::regrole::text,
             'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                           FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
      INTO now_shape
      FROM pg_class c WHERE c.oid = r.oid;
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/49: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
    IF to_regclass('public.' || r.obj) IS DISTINCT FROM r.oid THEN
      RAISE EXCEPTION 'db/49: % is a new view, not the one db/02 made', r.obj;
    END IF;
  END LOOP;
  FOREACH v IN ARRAY ARRAY['player_batting_career', 'player_bowling_career', 'player_dismissals'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = ('public.' || v)::regclass
                      AND 'security_invoker=true' = ANY (c.reloptions)) THEN
      RAISE EXCEPTION 'db/49: % is not a security_invoker view', v;
    END IF;
    -- One pass: no view calls a per-player function any more.
    IF pg_get_viewdef(('public.' || v)::regclass) ~ '_since\(' THEN
      RAISE EXCEPTION 'db/49: % still calls a *_since() function per player', v;
    END IF;
  END LOOP;

  -- The values, on every row the log holds, as whoever runs this file: each
  -- view against the old composition over the unchanged functions — db/02's
  -- definitions of these views, verbatim. Empty on a fresh install; the whole
  -- log on a database that has one.
  WITH d AS (
    SELECT 'batting ' || coalesce(l.player_id, o.player_id) AS k
      FROM player_batting_career l
      FULL JOIN (SELECT p.id AS player_id, c.* FROM player p CROSS JOIN LATERAL player_batting_since(p.id, NULL) c
                  WHERE c.matches > 0) o ON o.player_id = l.player_id
     WHERE (l.matches, l.runs, l.balls_faced, l.fours, l.sixes, l.last_ball_at)
           IS DISTINCT FROM (o.matches, o.runs, o.balls_faced, o.fours, o.sixes, o.last_ball_at)
    UNION ALL
    SELECT 'bowling ' || coalesce(l.player_id, o.player_id)
      FROM player_bowling_career l
      FULL JOIN (SELECT p.id AS player_id, c.* FROM player p CROSS JOIN LATERAL player_bowling_since(p.id, NULL) c
                  WHERE c.matches > 0) o ON o.player_id = l.player_id
     WHERE (l.matches, l.runs_conceded, l.legal_balls, l.wides, l.no_balls, l.wickets)
           IS DISTINCT FROM (o.matches, o.runs_conceded, o.legal_balls, o.wides, o.no_balls, o.wickets)
    UNION ALL
    SELECT 'dismissals ' || coalesce(l.player_id, o.player_id)
      FROM player_dismissals l
      FULL JOIN (SELECT p.id AS player_id, player_dismissals_since(p.id, NULL) AS dismissals FROM player p
                  WHERE player_dismissals_since(p.id, NULL) > 0) o ON o.player_id = l.player_id
     WHERE l.dismissals IS DISTINCT FROM o.dismissals)
  SELECT count(*), string_agg(k, '; ') INTO n, drift FROM d;
  IF n > 0 THEN
    RAISE EXCEPTION 'db/49: % lifetime figure(s) on this database are not what the functions say: %', n, left(drift, 600);
  END IF;

  -- The rules, on a fixture that carries every one of them: db/99 §22's
  -- fifteen events (db/44), in one school that exists only inside this block,
  -- twice — two matches, so `matches` counts two. Written as the owner and
  -- then undone: the sentinel rolls the block back to before its first
  -- INSERT, rows, trigger state and session setting alike.
  --    k  event                                    batting            dismissals        bowling
  --    1  run 4                                    A 4, a four        -                 4
  --    2  no-ball, 4 off the bat                   A 4, a four        -                 5, a no-ball
  --    3  W lbw — on the free hit 2 earned         A faced it         SAVED             legal, no wicket
  --    4  no-ball, 4 byes (nbRuns)                 A faced, 0         -                 5, a no-ball
  --    5  wide, 1                                  not faced          -                 2, a wide
  --    6  run 6 (the free hit, carried by 5)       A 6, a six         -                 6
  --    7  leg bye, 1                               A faced, 0         -                 legal, 0
  --    8  W run out, B out at the other end        A faced            B                 legal, not his
  --    9  retire marked W, retired out, A          an innings of A's  A                 -
  --   10  a delivery with no ball type, 2, B       B 2, faced (a run) -                 2, legal
  --   11  W with no method, B                      B faced            B                 legal, nobody's wicket
  --   12  run 1, no striker on file                nobody's           -                 1
  --   13  run 2, B ...                             (voided)
  --   14  ... taken back by a void of 13           nothing            nothing           nothing
  --   15  retire, hurt, B (no W marker)            nothing            nothing           -
  -- Per match: A 14 runs off 7 balls, 2 fours, 1 six, 1 dismissal; B 2 runs
  -- off 2 balls, 2 dismissals; C 25 conceded off 8 legal balls, 1 wide,
  -- 2 no-balls, no wicket.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db49-' || v_school, 'db/49 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db49-' || v_user || '@example.invalid', 'db/49 proof, scorer', 'coach', v_school);
    INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
      (p_a, v_school, '1XI', 'db/49 Opener',  1, 'batter', (current_date - interval '16 years')::date),
      (p_b, v_school, '1XI', 'db/49 Partner', 2, 'batter', (current_date - interval '16 years')::date),
      (p_c, v_school, '1XI', 'db/49 Seamer',  3, 'bowler', (current_date - interval '16 years')::date);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (m_a, v_school, '1XI', 'db/49 proof', now() - interval '14 days', 'cricket', 'T20', 20, 'complete'),
      (m_b, v_school, '1XI', 'db/49 proof', now() - interval '7 days',  'cricket', 'T20', 20, 'complete');
    -- Rows 10 and 11 are the shapes db/43's door refuses: a legacy row, read
    -- as the fold reads it, goes in with the door lifted (as db/99 does).
    IF v_door THEN EXECUTE 'ALTER TABLE ball_event DISABLE TRIGGER ball_event_names_its_delivery'; END IF;
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value,
                            striker_id, bowler_id, dismissed_id, dismissal, payload)
    SELECT m.id, v_school, x.k, 1, 0, v_user, 'db49-proof',
           'db49:' || m.id || ':' || x.k, x.k, now(), x.kind, x.bt, x.v,
           x.striker, x.bowler, x.dismissed, x.dis,
           CASE WHEN x.k = 14 THEN jsonb_build_object('target', 'db49:' || m.id || ':13') ELSE x.pl END
      FROM (VALUES (m_a), (m_b)) AS m(id)
      CROSS JOIN (VALUES
        ( 1, 'ball',   'run', 4,    p_a,    p_c,    NULL::uuid, NULL,          '{}'::jsonb),
        ( 2, 'ball',   'Nb',  4,    p_a,    p_c,    NULL,       NULL,          '{}'::jsonb),
        ( 3, 'ball',   'W',   0,    p_a,    p_c,    NULL,       'lbw',         '{}'::jsonb),
        ( 4, 'ball',   'Nb',  4,    p_a,    p_c,    NULL,       NULL,          '{"nbRuns":"byes"}'::jsonb),
        ( 5, 'ball',   'Wd',  1,    p_a,    p_c,    NULL,       NULL,          '{}'::jsonb),
        ( 6, 'ball',   'run', 6,    p_a,    p_c,    NULL,       NULL,          '{}'::jsonb),
        ( 7, 'ball',   'LB',  1,    p_a,    p_c,    NULL,       NULL,          '{}'::jsonb),
        ( 8, 'ball',   'W',   0,    p_a,    p_c,    p_b,          'run_out',     '{}'::jsonb),
        ( 9, 'retire', 'W',   NULL, NULL, NULL, NULL,       'retired_out', jsonb_build_object('batter', p_a, 'reason', 'out')),
        (10, 'ball',   NULL,  2,    p_b,    p_c,    NULL,       NULL,          '{}'::jsonb),
        (11, 'ball',   'W',   0,    p_b,    p_c,    NULL,       NULL,          '{}'::jsonb),
        (12, 'ball',   'run', 1,    NULL, p_c,    NULL,       NULL,          '{}'::jsonb),
        (13, 'ball',   'run', 2,    p_b,    p_c,    NULL,       NULL,          '{}'::jsonb),
        (14, 'void',   NULL,  NULL, NULL, NULL, NULL,       NULL,          '{}'::jsonb),
        (15, 'retire', NULL,  NULL, NULL, NULL, NULL,       NULL,          jsonb_build_object('batter', p_b, 'reason', 'hurt'))
      ) AS x(k, kind, bt, v, striker, bowler, dismissed, dis, pl);
    IF v_door THEN EXECUTE 'ALTER TABLE ball_event ENABLE TRIGGER ball_event_names_its_delivery'; END IF;

    -- The figures the rules above give, per player, over both matches.
    SELECT string_agg(f, ' ' ORDER BY f) INTO fixture_drift FROM (
      SELECT 'bat:' || CASE l.player_id WHEN p_a THEN 'A' WHEN p_b THEN 'B' ELSE 'C' END
             || row(l.matches, l.runs, l.balls_faced, l.fours, l.sixes, l.last_ball_at IS NOT NULL)::text AS f
        FROM player_batting_career l WHERE l.player_id IN (p_a, p_b, p_c)
      UNION ALL
      SELECT 'bowl:' || CASE l.player_id WHEN p_a THEN 'A' WHEN p_b THEN 'B' ELSE 'C' END
             || row(l.matches, l.runs_conceded, l.legal_balls, l.wides, l.no_balls, l.wickets)::text
        FROM player_bowling_career l WHERE l.player_id IN (p_a, p_b, p_c)
      UNION ALL
      SELECT 'out:' || CASE l.player_id WHEN p_a THEN 'A' WHEN p_b THEN 'B' ELSE 'C' END || '(' || l.dismissals || ')'
        FROM player_dismissals l WHERE l.player_id IN (p_a, p_b, p_c)) s;
    -- And the same comparison as above, over the fixture's players only, so
    -- a database whose log already disagreed cannot hide this one.
    SELECT count(*) INTO fixture_rows FROM (
      SELECT 1 FROM player_batting_career l
        FULL JOIN (SELECT p.id AS player_id, c.* FROM player p CROSS JOIN LATERAL player_batting_since(p.id, NULL) c
                    WHERE c.matches > 0 AND p.id IN (p_a, p_b, p_c)) o ON o.player_id = l.player_id
       WHERE coalesce(l.player_id, o.player_id) IN (p_a, p_b, p_c)
         AND (l.matches, l.runs, l.balls_faced, l.fours, l.sixes, l.last_ball_at)
             IS DISTINCT FROM (o.matches, o.runs, o.balls_faced, o.fours, o.sixes, o.last_ball_at)
      UNION ALL
      SELECT 1 FROM player_bowling_career l
        FULL JOIN (SELECT p.id AS player_id, c.* FROM player p CROSS JOIN LATERAL player_bowling_since(p.id, NULL) c
                    WHERE c.matches > 0 AND p.id IN (p_a, p_b, p_c)) o ON o.player_id = l.player_id
       WHERE coalesce(l.player_id, o.player_id) IN (p_a, p_b, p_c)
         AND (l.matches, l.runs_conceded, l.legal_balls, l.wides, l.no_balls, l.wickets)
             IS DISTINCT FROM (o.matches, o.runs_conceded, o.legal_balls, o.wides, o.no_balls, o.wickets)
      UNION ALL
      SELECT 1 FROM player_dismissals l
        FULL JOIN (SELECT p.id AS player_id, player_dismissals_since(p.id, NULL) AS dismissals FROM player p
                    WHERE p.id IN (p_a, p_b, p_c) AND player_dismissals_since(p.id, NULL) > 0) o ON o.player_id = l.player_id
       WHERE coalesce(l.player_id, o.player_id) IN (p_a, p_b, p_c)
         AND l.dismissals IS DISTINCT FROM o.dismissals) x;

    RAISE EXCEPTION USING ERRCODE = 'ZZ049', MESSAGE = 'db/49: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ049' THEN NULL;
  END;

  fixture_want := 'bat:A(2,28,14,4,2,t) bat:B(2,4,4,0,0,t) bowl:C(2,50,16,2,4,0) out:A(2) out:B(4)';
  IF fixture_drift IS DISTINCT FROM fixture_want THEN
    RAISE EXCEPTION 'db/49: the fixture reads %, expected % — a rule moved in the one-pass views', fixture_drift, fixture_want;
  END IF;
  IF fixture_rows IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'db/49: % of the fixture''s figures are not what the functions say', fixture_rows;
  END IF;

  -- And nothing of the proof is left: no row, no lifted door, no setting.
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school)
     OR EXISTS (SELECT 1 FROM app_user WHERE id = v_user)
     OR EXISTS (SELECT 1 FROM player WHERE id IN (p_a, p_b, p_c))
     OR EXISTS (SELECT 1 FROM match WHERE id IN (m_a, m_b))
     OR EXISTS (SELECT 1 FROM ball_event WHERE match_id IN (m_a, m_b))
     OR v_door IS DISTINCT FROM EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                                         AND tgname = 'ball_event_names_its_delivery' AND tgenabled = 'O')
     OR coalesce(current_setting('app.user_id', true), '') IS DISTINCT FROM v_setting THEN
    RAISE EXCEPTION 'db/49: the proof left something behind';
  END IF;
END $check$;

DROP TABLE _db49_before;

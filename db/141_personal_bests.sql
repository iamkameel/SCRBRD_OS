-- ══════════════════════════════════════════════════════════════════
--  141 · Personal bests: a boy's highest innings and best bowling, per
--        class group, format and side, derived from the log on each read
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Slice R5 of docs/design/RECOGNITION_reconciliation.md (§5,
-- the R5 row), as docs/design/RECOGNITION_design.md §10 changes it (approved
-- as recommended, Kameel 7 October 2026; unparked 5 November 2026):
--   D1   bests are a sporting fact, read under player.performance.read as
--        his career figures are; no new read capability.
--   D22  anchored on the side the performance was for: the match's side code
--        (the end of the fixture he played for), never player.team_code. A
--        U15A innings stays a U15A best after he moves up.
--   D23  his passport shows his own best per class group; never "you are
--        fourth", never a team-mate's ordering. (The screen is
--        apps/web/src/views/family/bests.jsx.)
--   D24  School Records is the headline group; Friendly sits under a filter
--        with its label, never merged.
--   A3/Q3  festivals feed School Records within their format; a friendly
--        (no competition, db/61) lives in its own group.
--   A10  derived, never stored: no table, no counter, no record holder.
--   A11  never public.
-- Spec v0.2.3 §5.2: highest innings is runs descending, a not-out
-- descriptive; best bowling is wickets descending, then runs conceded
-- ascending; equal performances share (a tie keeps both dates).
--
-- ── WHICH MATCHES COUNT ─────────────────────────────────────────────
-- Only a verified match: match_verified() (db/114: complete, every innings
-- sealed by the scorer and the seal standing). A correction that moves an
-- innings breaks its seal, so the figure leaves the bests until the scorer
-- seals again, and then counts as corrected (Q10: derive, never store).
-- The class group is fixture_class()'s (db/127): friendly -> 'friendly';
-- competitive or festival -> 'school_records'. A super over is no part of a
-- career (ball_event_career, db/71), so none of a best. The no-board reasons
-- (adjusted target, decided off the field) keep the figure, as spec §5.4's
-- table gives personal bests "Yes" for an adjusted-target game; an
-- abandoned match is never complete, so never verified, so never counted.
--
-- ── WHO READS IT ────────────────────────────────────────────────────
-- player_best(player) is SECURITY INVOKER: it reads player_innings,
-- bowler_innings_figures, match and player under the caller's own row
-- security, exactly the deliveries his career read shows him. On top, each
-- match's row is admitted only when the caller holds player.performance.read
-- at the side the boy played for, about the boy, for that fixture:
--   app_can('player.performance.read', <side's school>, <side's code>, <boy>, <match>)
-- So his side's coach, the director, the principal, the analyst and media at
-- his school, his team-mates on that side, his guardian and the boy himself
-- read it; a scorer, the office, the DSO, a scout, another school's staff
-- and the signed-out public read nothing (none holds it there). A coach of
-- another side at his school reads only the rows for that side (D22's
-- anchor). Another school's staff keep the opposition dossier's figures
-- (db/46's five days, opposition_squad()), which this file does not touch.
--
-- The class, the seal and the side are the owner's to read (fixture_class()
-- and match_verified() are nobody's to call), so they come through
-- player_best_context(match, player), a pinned definer that answers nothing
-- unless that same app_can() holds. It says of a match only what the caller
-- may already read: whether it was a friendly, whether it is verified, and
-- the side and opponent labels the fixture list shows.
--
-- ── WHAT THIS FILE DOES NOT TOUCH ──────────────────────────────────
-- No table, column, policy, capability, role or row. passport(), recognition()
-- and the milestone objects are not touched (R4's). Two new functions, and
-- a second paste changes nothing.


-- ── 0 · What this file stands on, and refuse to replace what it was not ──
DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regclass('player_innings') IS NULL OR to_regclass('bowler_innings_figures') IS NULL
     OR to_regclass('match_squad') IS NULL
     OR to_regprocedure('fixture_class(uuid)') IS NULL
     OR to_regprocedure('match_verified(uuid)') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('fixture_side_label(uuid,text)') IS NULL
     OR to_regprocedure('sa_date(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'db/141: player_innings, bowler_innings_figures (db/87), match_squad, fixture_class() (db/127), match_verified() (db/114), app_can(), fixture_side_label() or sa_date() (db/117) is missing; apply them first';
  END IF;
  -- Both functions are this file's alone: absent, or as this file wrote them.
  FOR r IN SELECT * FROM (VALUES
      ('player_best_context(uuid,uuid)', '4ea1327888509d25b0d4c74cd65fc5cf'),
      ('player_best(uuid)',              '72f68de9f3425bd3deabe60f2f1245f4'))
      AS x(fn, mine)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    CONTINUE WHEN v_src IS NULL;
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 <> r.mine THEN
      RAISE EXCEPTION 'db/141: % is not this file''s (md5 % of its folded body); look before replacing it', r.fn, v_md5;
    END IF;
  END LOOP;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · player_best_context: the match as a best reads it
-- ══════════════════════════════════════════════════════════════════
-- One row, or none. The side he played for: the end his team sheet puts him
-- on (match_squad.side), else the end at his own school. The row is answered
-- only when the caller holds player.performance.read at that side about him
-- (the gate above); none for a match with no end of his, for a pad, for the
-- public. `verified` is match_verified(); `class_group` is fixture_class()'s,
-- grouped as spec §5.4: friendly, else School Records.
CREATE OR REPLACE FUNCTION player_best_context(p_match uuid, p_player uuid)
RETURNS TABLE (match_id uuid, class_group text, verified boolean, side_school_id uuid, side_code text,
               opponent text, played_on date) AS $$
  SELECT m.id,
         CASE WHEN f.fixture_class = 'friendly' THEN 'friendly' ELSE 'school_records' END,
         match_verified(m.id),
         s.school_id, s.team_code,
         CASE WHEN s.home THEN coalesce(fixture_side_label(m.away_school_id, m.away_team_code), m.opponent)
              ELSE fixture_side_label(m.school_id, m.team_code) END,
         sa_date(m.starts_at)
    FROM match m
    JOIN player p ON p.id = p_player
    LEFT JOIN match_squad q ON q.match_id = m.id AND q.player_id = p_player
    CROSS JOIN LATERAL (
      SELECT x.home,
             CASE WHEN x.home THEN m.school_id ELSE m.away_school_id END AS school_id,
             CASE WHEN x.home THEN m.team_code ELSE m.away_team_code END AS team_code
        FROM (SELECT CASE WHEN q.side = 'home' THEN true
                          WHEN q.side = 'away' THEN false
                          WHEN m.school_id = p.school_id THEN true
                          WHEN m.away_school_id = p.school_id THEN false END AS home) x
       WHERE x.home IS NOT NULL) s
    CROSS JOIN LATERAL fixture_class(m.id) f
   WHERE m.id = p_match
     AND s.school_id IS NOT NULL
     AND app_can('player.performance.read', s.school_id, s.team_code, p_player, m.id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION player_best_context(uuid, uuid) IS
  'db/141 (RECOGNITION R5): a match as a personal best reads it — the class group (friendly or school_records, from fixture_class()), match_verified(), the side the boy played for and the opponent''s label — answered only when the caller holds player.performance.read at that side about him. For player_best().';


-- ══════════════════════════════════════════════════════════════════
-- §2 · player_best: his innings and spells, and which are his bests
-- ══════════════════════════════════════════════════════════════════
-- One row per batting innings and per bowling innings with a wicket that the
-- caller may read, in the shape a screen draws: the metric, the class group,
-- the format, the side (D22's anchor), the match, the date and the opponent,
-- the figures, whether the match is verified, and `best`: this row is the
-- highest innings (runs) or the best bowling (wickets, then fewest runs) of
-- the verified rows for its class group, format, side and metric. Equal
-- figures are all best, each with its own date (spec §5.3). A spell without
-- a wicket is no best bowling. An unverified row is never best: the screen
-- says "awaiting verification" of it.
CREATE OR REPLACE FUNCTION player_best(p_player uuid)
RETURNS TABLE (player_id uuid, metric text, class_group text, format text, side_school_id uuid, side_code text,
               match_id uuid, innings smallint, played_on date, opponent text,
               runs integer, balls_faced integer, not_out boolean, wickets integer, runs_conceded integer,
               verified boolean, best boolean) AS $$
  WITH perf AS MATERIALIZED (
    SELECT 'batting'::text AS metric, i.match_id, i.innings::smallint AS innings,
           i.runs::integer AS runs, i.balls_faced::integer AS balls_faced, NOT coalesce(i.out, false) AS not_out,
           NULL::integer AS wickets, NULL::integer AS runs_conceded
      FROM player_innings i
     WHERE i.player_id = p_player
    UNION ALL
    SELECT 'bowling', f.match_id, f.innings::smallint, NULL, NULL, NULL, f.wickets::integer, f.runs_conceded::integer
      FROM bowler_innings_figures f
     WHERE f.player_id = p_player AND f.wickets > 0
  ),
  ctx AS MATERIALIZED (
    SELECT c.* FROM (SELECT DISTINCT d.match_id FROM perf d) d
     CROSS JOIN LATERAL player_best_context(d.match_id, p_player) c
  ),
  lines AS (
    SELECT p.id AS player_id, x.metric, c.class_group, m.format, c.side_school_id, c.side_code,
           x.match_id, x.innings, c.played_on, c.opponent,
           x.runs, x.balls_faced, x.not_out, x.wickets, x.runs_conceded, c.verified
      FROM perf x
      JOIN ctx c ON c.match_id = x.match_id
      JOIN match m ON m.id = x.match_id
      JOIN player p ON p.id = p_player
  )
  SELECT r.*,
         r.verified AND rank() OVER (
           PARTITION BY r.verified, r.class_group, r.format, r.side_school_id, r.side_code, r.metric
           ORDER BY coalesce(r.runs, r.wickets) DESC, coalesce(r.runs_conceded, 0) ASC) = 1
    FROM lines r
   ORDER BY r.metric, r.class_group DESC, r.format, r.side_code, r.played_on DESC, r.match_id, r.innings
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION player_best(uuid) IS
  'db/141 (RECOGNITION R5, D22–D24): a boy''s batting innings and wicket-taking spells as his reader may read them (security invoker over player_innings and bowler_innings_figures), each with its class group, format, side, match and verification, and `best` marking his highest innings and best bowling per class group, format and side among verified matches (ties all best). Derived on every read; never public.';


-- ── 3 · Who may call them ──────────────────────────────────────────
-- The application, and nobody else: not PUBLIC, not a managed host's API
-- roles, which get EXECUTE on every new function by default (db/131's loop).
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['player_best_context(uuid,uuid)', 'player_best(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ── 4 · Check what was built ────────────────────────────────────────
DO $check$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'player_best_context(uuid,uuid)'::regprocedure AND p.prosecdef
                    AND p.provolatile = 's'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/141: player_best_context() is not a STABLE SECURITY DEFINER with a pinned path';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'player_best(uuid)'::regprocedure AND NOT p.prosecdef
                    AND p.provolatile = 's'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/141: player_best() is not a STABLE SECURITY INVOKER with a pinned path';
  END IF;
  -- The gate is in the definer's body: the side's performance read, about him.
  IF position('app_can(''player.performance.read'', s.school_id, s.team_code, p_player, m.id)'
              IN (SELECT prosrc FROM pg_proc WHERE oid = 'player_best_context(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/141: player_best_context() does not ask player.performance.read at the boy''s side';
  END IF;
  FOREACH r IN ARRAY ARRAY['player_best_context(uuid,uuid)', 'player_best(uuid)'] LOOP
    IF has_function_privilege('public', r::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/141: % is executable by PUBLIC', r;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', r::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/141: the application cannot call %', r;
    END IF;
  END LOOP;
  -- No signed-out door reads it (A11): no public_* function names it.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'public\_%' AND p.prosrc ~ '\mplayer_best') THEN
    RAISE EXCEPTION 'db/141: a public_* function reads player_best';
  END IF;
END $check$;

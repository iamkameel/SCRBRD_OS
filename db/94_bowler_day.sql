-- ══════════════════════════════════════════════════════════════════
--  94 · bowler_day(): a boy's overs today, across every match
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-136-137_phaseB.md §1
-- (decided, Kameel 2026-10-13; PB-D1 to PB-D4). Its proof is db/99 §72; the
-- API walk is tools/smoke-cockpit.mjs.
--
-- WHY. The directive's day limit (bowling_directive.max_overs_per_day) is a
-- limit on the DAY, and on a Saturday a pace bowler can bowl in two matches:
-- the morning's 2nd XI and the afternoon's 1st XI. Nothing on the platform
-- added the two up for the coach of the second one: the pad's cap words are
-- the match's, bowling_spells is one match's, workload() is the week's. This
-- is the one read that does, and the coach's feed draws it as S2c.
--
-- THE GATE (PB-D1, the 136 doc's D16). player.workload.read, asked per boy
-- inside the function with the same app_can() call workload() makes
-- (db/60). "How many overs did this boy bowl today" is the tier of "how many
-- this week", which workload().overs_7d already returns to the same readers.
-- A reader who may not read a boy's load gets no row for him: not a row with
-- the figures blanked, no row at all. The team manager, the office, a scorer,
-- a pupil and a guardian hold no such capability and get none.
--
-- THE DATE. bowled_on is bowler_over's: the FIXTURE's start, as a calendar
-- day in South Africa ((match.starts_at AT TIME ZONE 'Africa/Johannesburg')
-- ::date, db/54). It is the same day workload() and bowling_breach_watch()
-- count by, so the three never disagree about which day an over was bowled
-- on; a fixture that runs past midnight counts on the day it started.
-- p_date is compared with it as stored and defaults to sa_today().
--
-- WHAT IT RETURNS. One row per boy the caller may read the load of, narrowed
-- by p_team, INCLUDING a boy who has not bowled today (overs_today 0): an
-- absent row means "you may not read him", never "he has not bowled". The
-- directive beside each is bowling_directive_for()'s, as workload() and
-- bowling_spells read it; a spinner's max_overs_per_day is null and his
-- clause is null, because no limit applies to him.
--
-- WHAT IT NEVER RETURNS, BY CONSTRUCTION. No load word, ratio, units or
-- `monitored` (those stay in workload() and the profile); nothing from
-- injury, health_monitoring_consent or load_entry; no opponent, venue or the
-- other match's id. "Two matches" is a count: a match id would let a reader
-- name a fixture his own fixture.read does not reach.
--
-- AND ONE PRIVILEGE TIGHTENED. bowling_directive_for() (db/08) was created
-- without a REVOKE, so PUBLIC could execute it. Its callers are three
-- definer functions (workload(), bowling_breach_watch(), and bowler_day()
-- below), which run as the owner, and the bowling_spells read, which runs
-- as scrbrd_app. So it is revoked from PUBLIC and granted to scrbrd_app by
-- name: every caller keeps it and nobody else has it. It is SECURITY
-- INVOKER, reading player under the caller's own row security, so this
-- closes no leak; it removes a door nothing uses.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   + function bowler_day(date, text), SECURITY DEFINER, pinned search_path,
--     executable by scrbrd_app alone
--   bowling_directive_for(uuid): EXECUTE taken from PUBLIC (and from a
--     managed host's anon/authenticated), granted to scrbrd_app
-- No table, no row, no policy. CREATE OR REPLACE, so a second paste changes
-- nothing.

CREATE OR REPLACE FUNCTION bowler_day(p_date date DEFAULT sa_today(), p_team text DEFAULT NULL)
RETURNS TABLE (player_id uuid, full_name text, team_code text, school_id uuid,
               bowled_on date, overs_today int, matches_today int,
               age_band text, pace boolean, max_overs_per_spell smallint, max_overs_per_day smallint,
               clause_code text) AS $$
  -- workload()'s CTE verbatim (db/60), so the two can never disagree about
  -- who is in.
  WITH boys AS (
    SELECT p.id, p.full_name, p.team_code, p.school_id, p.born, p.bowling_style
      FROM player p
     WHERE (p_team IS NULL OR p.team_code = p_team)
       AND app_can('player.workload.read', p.school_id, p.team_code, p.id,
                   '00000000-0000-0000-0000-000000000000'::uuid)),
  -- Every over he began on that day, in any match: an over begun counts as
  -- one, as workload() counts a week. bowler_over is security_invoker, and
  -- this function is a definer: the sum reaches a match the reader's own row
  -- security may not, which is the point of it, and only for a boy whose
  -- load he may read.
  day AS (
    SELECT o.bowler_id,
           count(*)::int                   AS overs_today,
           count(DISTINCT o.match_id)::int AS matches_today
      FROM bowler_over o JOIN boys b ON b.id = o.bowler_id
     WHERE o.bowled_on = p_date
     GROUP BY o.bowler_id)
  SELECT b.id, b.full_name, b.team_code, b.school_id,
         p_date,
         coalesce(x.overs_today, 0), coalesce(x.matches_today, 0),
         d.age_band, d.pace, d.max_overs_per_spell, d.max_overs_per_day,
         -- The clause his limit enforces (SCRBRD-041), as the workload read
         -- cites it: only for a pace bowler, because no limit applies to a
         -- spinner and the band's clause beside his name would say one did.
         CASE WHEN d.pace THEN c.clause_code END
    FROM boys b
    CROSS JOIN LATERAL bowling_directive_for(b.id) d
    LEFT JOIN day x ON x.bowler_id = b.id
    LEFT JOIN bowling_directive c ON c.age_band = d.age_band
   ORDER BY coalesce(x.overs_today, 0) DESC, b.full_name, b.id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION bowler_day(date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bowler_day(date, text) TO scrbrd_app;

REVOKE ALL ON FUNCTION bowling_directive_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bowling_directive_for(uuid) TO scrbrd_app;


-- ── Who may call these: the application, and nobody else ──────────
-- On a managed host the platform's API roles get EXECUTE on every new
-- function by default privilege, directly and not through PUBLIC (db/29
-- found this), so it is taken back from them here, as db/60 does.
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['bowler_day(date,text)', 'bowling_directive_for(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  cols text;
BEGIN
  -- A definer with a pinned search path (db/16), and stable.
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE oid = 'bowler_day(date,text)'::regprocedure AND prosecdef AND provolatile = 's'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/94: bowler_day is not a stable SECURITY DEFINER with a pinned search_path';
  END IF;

  -- The application's door, and nobody else's.
  FOREACH f IN ARRAY ARRAY['bowler_day(date,text)', 'bowling_directive_for(uuid)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/94: the application cannot call %', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/94: % is executable by PUBLIC', f;
    END IF;
  END LOOP;

  -- The gate is the load capability, asked per boy.
  IF pg_get_functiondef('bowler_day(date,text)'::regprocedure) NOT LIKE '%app_can(''player.workload.read''%' THEN
    RAISE EXCEPTION 'db/94: bowler_day does not ask player.workload.read';
  END IF;

  -- The row is exactly the design's twelve columns (PB-D3): nothing from the
  -- load model, the consent or the other match rides along.
  SELECT string_agg(a, ',' ORDER BY n) INTO cols
    FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS t(a, m, n)
   WHERE p.oid = 'bowler_day(date,text)'::regprocedure AND t.m = 't';
  IF cols IS DISTINCT FROM 'player_id,full_name,team_code,school_id,bowled_on,overs_today,matches_today,'
                           'age_band,pace,max_overs_per_spell,max_overs_per_day,clause_code' THEN
    RAISE EXCEPTION 'db/94: bowler_day returns %', cols;
  END IF;
END $check$;

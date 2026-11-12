-- ══════════════════════════════════════════════════════════════════
--  153 · The big screen at the ground: a side that carries a marked boy is
--        shown by position, and only the host's staff ask
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/PUBLIC_BY_TERMS.md (approved by Kameel, 11 Nov
-- 2026), §2.5 and slice 1: "a boy under any never-public mark is shown by
-- position on it. A mark is for a child who must not be findable, and a
-- screen facing a crowd is a place he can be found." Then Kameel, 12 Nov
-- 2026 (13:05 SAST), "Both as recommended":
--   (a) only staff may open the big screen and make its read;
--   (b) when any boy on the field is under a never-public mark, the screen
--       shows that boy's whole side by position, and the read says only
--       "this side by position", never which boy (§3.4: one "Batter" among
--       named boys is a tell).
--
-- THE SEASON ROSTER (Kameel, 12 Nov 2026, 17:45 SAST: "Season roster:
-- hide the side all season"). A flag that turned on at the ball a marked
-- boy first took the field, or with the day's XI, would say which boy, to
-- the crowd and to every reader of the read, and a selection (a one-boy
-- sheet, a one-boy squad written into the log) could ask about one boy. So
-- the host side is position-only whenever any boy on its roster, the host
-- school's players of that team on the day as roster_on() dates side
-- membership (team_membership, db/08), is under a never-public mark today:
-- every fixture of the side, all season, whoever is picked. The day's
-- sheet, its innings_start squads and its XI decide nothing about the flag.
--
-- Safe to paste again: DROP and CREATE the one function (nothing depends on
-- it), then REVOKE and GRANT; the guard only reads.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
--   - ground_screen_positions(uuid), the first draft's per-boy read (never
--       shipped; dropped where a dev database has it).
--   + ground_screen_sides(match uuid) → (team, position_only, log_seq)
--       One row per side the log's innings_start events name, keyed by the
--       team key the log carries (payload teamKey or battingTeam for the
--       batting squad, bowlingTeamKey or bowlingTeam for the fielding one,
--       as the fold and the screen read them). log_seq is the highest seq
--       of the log the read covered, so a screen whose log is ahead asks
--       again. No player id, name, reason, author or date leaves it.
--
--   WHICH SIDE IS THE HOST'S. A side is keyed as the log keys it; its members
--   are the boys the FIRST innings_start naming it carries for it (its squad
--   when batting, its bowlingSquad when fielding). Then:
--     * every member is on the host roster: it is the host side, and its
--       flag is the host roster's (above) — the same for any selection;
--     * anything else (the away side; a member off the host roster, such as
--       a boy playing up from another team, a guest or another school's
--       child; a side with no member SCRBRD holds a row for): true, and no
--       mark is asked. An away boy's mark is never asked, sheet or no sheet,
--       so a log written by whoever holds scoring.edit, or a fixture whose
--       other school anyone with fixture.create may pick, probes nobody. The
--       away side is always shown by position; a sheet does not change that,
--       because the host's staff hold no read of an away boy's mark and an
--       away sheet is the other school's to write.
--   Consents, names-off and the by-terms switches do not govern the
--   school's own scoreboard (§2.5).
--
--   WHO ASKS (Kameel's (a)), decided here and nowhere else:
--       * not under a pad credential (app_pad_scoped(), db/50): the big
--         screen is opened from the signed-in Match Centre, never the pad,
--         which may be in a pupil-scorer's hand;
--       * not a pupil, whatever else he holds (app_reader_is_pupil(),
--         db/116: the pattern Kameel set on 12 Nov for innings lines);
--       * and player.roster.read OR scoring.start at the HOST school and
--         side, on this fixture. No single capability is held by every
--         member of the host's staff who runs a match and by nobody else:
--         player.roster.read is the coach's, the assistant's, the team
--         manager's, the director of sport's, the office's, the
--         principal's and sportsadmin's; scoring.start adds the scorer.
--         Both are also superadmin's (no school), and a parent volunteer
--         given the scorer's role holds scoring.start: the gate counts him
--         as the host's staff for the day, as the scorer's role does.
--         Guardian, player, selfaccess, spectator, driver,
--         transportcoordinator, dso and medical hold neither.
--       The away school is not asked about: it is the host's ground screen.
--       Anyone else gets no rows. No policy or bundle changes.
--
--   SECURITY DEFINER, so the gate is the whole of the answer to "may he
--   ask", and the log, the roster and the mark are read as the owner. db/99's
--   db/50 definers check lists it (it names scoring.start).
--
-- Nothing else. broadcast_state() (db/149) already names no child.
--
-- Its proof is db/99 §130; the walk is smoke-browser-matchcentre's big
-- screen group.

-- ── 0 · What this file was written against ─────────────────────────
DO $guard$
DECLARE v_facts jsonb;
BEGIN
  IF to_regclass('ball_event') IS NULL OR to_regclass('match') IS NULL
     OR to_regclass('player') IS NULL OR to_regclass('player_never_public') IS NULL
     OR to_regprocedure('public_name_facts(uuid,text,date)') IS NULL
     OR to_regprocedure('app_reader_is_pupil()') IS NULL
     OR to_regprocedure('public_json_array(jsonb)') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('roster_on(uuid,text,date,text)') IS NULL OR to_regclass('team_membership') IS NULL
     OR to_regprocedure('sa_today()') IS NULL THEN
    RAISE EXCEPTION 'db/153: the public name rule (db/47, db/116), the public read path (db/59), the pad scope (db/50), the readers'' pupil test (db/116) or the dated roster (db/08) is missing; apply every file before this one (through db/151, and db/152 where it is pasted) first';
  END IF;
  -- public_name_facts() still answers the mark as `neverPublic` (a later
  -- slice re-makes it: PUBLIC_BY_TERMS §6.2).
  SELECT public_name_facts(p.id, NULL, sa_today()) INTO v_facts FROM player p LIMIT 1;
  IF v_facts IS NOT NULL AND NOT (v_facts ? 'neverPublic') THEN
    RAISE EXCEPTION 'db/153: public_name_facts() no longer answers neverPublic (%); look before pasting', v_facts;
  END IF;
END $guard$;

DROP FUNCTION IF EXISTS ground_screen_positions(uuid);
-- Its return type grew log_seq while unpasted, and CREATE OR REPLACE cannot
-- change a return type: made afresh, and granted again below.
DROP FUNCTION IF EXISTS ground_screen_sides(uuid);

CREATE OR REPLACE FUNCTION ground_screen_sides(p_match uuid)
RETURNS TABLE (team text, position_only boolean, log_seq bigint) AS $$
  WITH m AS (
    -- The fixture, only for the host's staff, signed in, not pupils.
    SELECT mt.id, mt.school_id, mt.team_code FROM match mt
     WHERE mt.id = p_match
       AND NOT app_pad_scoped()
       AND NOT coalesce(app_reader_is_pupil(), true)
       AND (app_can('player.roster.read', mt.school_id, mt.team_code, '00000000-0000-0000-0000-000000000000'::uuid, mt.id)
            OR app_can('scoring.start', mt.school_id, mt.team_code, '00000000-0000-0000-0000-000000000000'::uuid, mt.id))
  ),
  starts AS (
    SELECT b.seq, b.payload FROM ball_event b JOIN m ON m.id = b.match_id WHERE b.kind = 'innings_start'
  ),
  -- Each side as the log names it, with the squad it carries there.
  named AS (
    SELECT s.seq, coalesce(s.payload ->> 'teamKey', s.payload ->> 'battingTeam') AS team, public_json_array(s.payload -> 'squad') AS squad
      FROM starts s
    UNION ALL
    SELECT s.seq, coalesce(s.payload ->> 'bowlingTeamKey', s.payload ->> 'bowlingTeam'), public_json_array(s.payload -> 'bowlingSquad')
      FROM starts s
  ),
  -- Its members: the first innings_start that names it, and no later one.
  firsts AS (
    SELECT DISTINCT ON (n.team) n.team, n.squad FROM named n WHERE n.team IS NOT NULL ORDER BY n.team, n.seq
  ),
  members AS (
    SELECT f.team, x.ref
      FROM firsts f
     CROSS JOIN LATERAL (SELECT CASE jsonb_typeof(e.member)
                                  WHEN 'object' THEN e.member ->> 'id'
                                  WHEN 'string' THEN e.member #>> '{}' END AS ref
                           FROM jsonb_array_elements(f.squad) AS e(member)) x
     WHERE x.ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  -- The host roster on the day (roster_on(), db/08), and its flag.
  roster AS (
    SELECT r.player_id FROM m CROSS JOIN LATERAL roster_on(m.school_id, m.team_code, sa_today()) r
  ),
  host AS (
    SELECT EXISTS (SELECT 1 FROM roster r
                    WHERE coalesce((public_name_facts(r.player_id, NULL, sa_today()) ->> 'neverPublic')::boolean, true)) AS flag
  ),
  judged AS (
    SELECT f.team,
      CASE WHEN EXISTS (SELECT 1 FROM members x WHERE x.team = f.team)
                AND NOT EXISTS (SELECT 1 FROM members x WHERE x.team = f.team
                                   AND x.ref::uuid NOT IN (SELECT r.player_id FROM roster r))
           THEN (SELECT h.flag FROM host h)
           -- Not the host side, or not wholly: true, and no mark asked.
           ELSE true END AS position_only
      FROM firsts f
  )
  SELECT j.team, j.position_only,
         (SELECT coalesce(max(b.seq), 0)::bigint FROM ball_event b JOIN m ON m.id = b.match_id)
    FROM judged j
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The application's, and nobody else's. Not PUBLIC, and not a managed
-- host's API roles, which get EXECUTE on every new function by default
-- privilege (db/29, db/47).
REVOKE ALL ON FUNCTION ground_screen_sides(uuid) FROM PUBLIC;
DO $revoke_platform_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION ground_screen_sides(uuid) FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;
GRANT EXECUTE ON FUNCTION ground_screen_sides(uuid) TO scrbrd_app;

-- After: a definer with its path pinned, gated as above, reading the mark
-- only through public_name_facts(), returning no player, and nobody's but
-- the application's.
DO $after$
DECLARE v_src text; r text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'ground_screen_sides(uuid)'::regprocedure AND p.prosecdef
     AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'];
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/153: ground_screen_sides() is not a definer with its search path pinned';
  END IF;
  IF position('NOT app_pad_scoped()' IN v_src) = 0 OR position('NOT coalesce(app_reader_is_pupil(), true)' IN v_src) = 0
     OR position('''player.roster.read'', mt.school_id, mt.team_code' IN v_src) = 0
     OR position('''scoring.start'', mt.school_id, mt.team_code' IN v_src) = 0
     OR v_src ~* 'app_can\([^)]*away_school_id' THEN
    RAISE EXCEPTION 'db/153: ground_screen_sides() is not gated to the host''s staff, signed in, not pupils, not under a pad credential';
  END IF;
  IF v_src ~* '\m(player_never_public|public_name_consent|full_name|surname|known_as|reason)\M' THEN
    RAISE EXCEPTION 'db/153: ground_screen_sides() reads a mark, a consent or a name directly';
  END IF;
  IF to_regprocedure('ground_screen_positions(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'db/153: the first draft''s ground_screen_positions() is still there';
  END IF;
  IF has_function_privilege('public', 'ground_screen_sides(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/153: ground_screen_sides() is executable by PUBLIC';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, 'ground_screen_sides(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'db/153: ground_screen_sides() is executable by %', r;
    END IF;
  END LOOP;
END $after$;

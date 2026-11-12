-- ══════════════════════════════════════════════════════════════════
--  153 · The big screen at the ground: a side with a marked boy on the
--        field is shown by position, and only the host's staff ask
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
-- THE GAP. The Match Centre's big screen (apps/web/src/views/matchcentre/
-- bigscreen.jsx) is the ground display's own view, fed by the signed-in log
-- and so by the names it carries. It faces the boundary crowd and knew
-- nothing of a never-public mark (player_never_public, db/47).
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
--   + ground_screen_sides(match uuid) → (team, position_only)
--       One row per side the log's innings_start events name (the team key
--       the log carries: payload teamKey or battingTeam for the batting
--       squad, bowlingTeamKey or bowlingTeam for the fielding one, as the
--       fold reads them). position_only is true when a boy that side's
--       squads carry is on the field in a role (a striker, a non-striker, a
--       bowler, a batter dismissed, a fielder, a keeper, a batter retiring)
--       and under a never-public mark on the day served
--       (public_name_facts()'s `neverPublic`, db/116). One more row, team
--       NULL and true, when a marked boy is on the field and in no squad:
--       the client then shows everybody by position. No player id, name,
--       reason, author or date leaves it; consents, names-off and the
--       by-terms switches do not govern the school's own scoreboard (§2.5).
--
--   WHO ASKS (Kameel's (a)), decided here and nowhere else:
--       * not a pupil, whatever else he holds (app_reader_is_pupil(),
--         db/116: the pattern Kameel set on 12 Nov for innings lines);
--       * and player.roster.read OR scoring.start at the HOST school and
--         side, on this fixture. No single capability is held by every
--         member of the host's staff who runs a match and by nobody else:
--         player.roster.read is the coach's, the assistant's, the team
--         manager's, the director of sport's, the office's, the
--         principal's and sportsadmin's; scoring.start adds the scorer. Of
--         guardian, player, selfaccess, spectator, driver,
--         transportcoordinator, dso, medical: none holds either.
--       The away school is not asked about: it is the host's ground screen.
--       Anyone else gets no rows. No policy or bundle changes.
--
--   SECURITY DEFINER, so the gate above is the whole of the answer to "may
--   he ask", and the log, the squads and the mark are read as the owner.
--
-- Nothing else. broadcast_state() (db/149) already names no child.
--
-- Its proof is db/99 §130; the walk is smoke-browser-matchcentre's big
-- screen group.

CREATE OR REPLACE FUNCTION ground_screen_sides(p_match uuid)
RETURNS TABLE (team text, position_only boolean) AS $$
  WITH m AS (
    -- The fixture, only for the host's staff who are not pupils.
    SELECT mt.id FROM match mt
     WHERE mt.id = p_match
       AND NOT coalesce(app_reader_is_pupil(), true)
       AND (app_can('player.roster.read', mt.school_id, mt.team_code, '00000000-0000-0000-0000-000000000000'::uuid, mt.id)
            OR app_can('scoring.start', mt.school_id, mt.team_code, '00000000-0000-0000-0000-000000000000'::uuid, mt.id))
  ),
  starts AS (
    SELECT b.payload FROM ball_event b JOIN m ON m.id = b.match_id WHERE b.kind = 'innings_start'
  ),
  -- Every side the log names, and the boys its squads carry.
  sides AS (
    SELECT coalesce(s.payload ->> 'teamKey', s.payload ->> 'battingTeam') AS team FROM starts s
    UNION SELECT coalesce(s.payload ->> 'bowlingTeamKey', s.payload ->> 'bowlingTeam') FROM starts s
  ),
  squad AS (
    SELECT coalesce(s.payload ->> 'teamKey', s.payload ->> 'battingTeam') AS team,
           coalesce(e.member ->> 'id', e.member #>> '{}') AS ref
      FROM starts s CROSS JOIN LATERAL jsonb_array_elements(public_json_array(s.payload -> 'squad')) AS e(member)
    UNION
    SELECT coalesce(s.payload ->> 'bowlingTeamKey', s.payload ->> 'bowlingTeam'),
           coalesce(e.member ->> 'id', e.member #>> '{}')
      FROM starts s CROSS JOIN LATERAL jsonb_array_elements(public_json_array(s.payload -> 'bowlingSquad')) AS e(member)
  ),
  -- Every reference the log puts on the field. A reference that is not a
  -- uuid is a name the scorer typed (L6): no row, so no mark.
  field AS (
    SELECT DISTINCT r.ref
      FROM ball_event b JOIN m ON m.id = b.match_id
     CROSS JOIN LATERAL (VALUES
       (b.striker_id::text), (b.non_striker_id::text), (b.bowler_id::text), (b.dismissed_id::text),
       (b.payload ->> 'striker'), (b.payload ->> 'nonStriker'), (b.payload ->> 'bowler'),
       (b.payload ->> 'dismissed'), (b.payload ->> 'fielder'), (b.payload ->> 'batter'),
       (b.payload ->> 'keeper')) AS r(ref)
     WHERE r.ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  marked AS (
    SELECT f.ref FROM field f
     WHERE coalesce((public_name_facts(f.ref::uuid, NULL, sa_today()) ->> 'neverPublic')::boolean, false)
  )
  SELECT s.team, EXISTS (SELECT 1 FROM squad q JOIN marked k ON k.ref = q.ref WHERE q.team IS NOT DISTINCT FROM s.team)
    FROM sides s
  UNION ALL
  -- A marked boy on the field whom no squad carries: no side can be named.
  SELECT NULL::text, true
   WHERE EXISTS (SELECT 1 FROM marked k WHERE NOT EXISTS (SELECT 1 FROM squad q WHERE q.ref = k.ref))
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
-- only through public_name_facts(), and returning no player.
DO $after$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'ground_screen_sides(uuid)'::regprocedure AND p.prosecdef
     AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'];
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/153: ground_screen_sides() is not a definer with its search path pinned';
  END IF;
  IF position('app_reader_is_pupil()' IN v_src) = 0 OR position('''player.roster.read'', mt.school_id, mt.team_code' IN v_src) = 0
     OR position('''scoring.start'', mt.school_id, mt.team_code' IN v_src) = 0 OR v_src ~* '\maway_school_id\M' THEN
    RAISE EXCEPTION 'db/153: ground_screen_sides() is not gated to the host''s staff who are not pupils';
  END IF;
  IF v_src ~* '\m(player_never_public|public_name_consent|full_name|surname|known_as|reason)\M' THEN
    RAISE EXCEPTION 'db/153: ground_screen_sides() reads a mark, a consent or a name directly';
  END IF;
  IF has_function_privilege('public', 'ground_screen_sides(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/153: ground_screen_sides() is executable by PUBLIC';
  END IF;
END $after$;

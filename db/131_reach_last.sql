-- ══════════════════════════════════════════════════════════════════
--  131 · REACH R-H: the team sheet to the parent, names and order
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/REACH_parent_pupil.md, build group R-H (§6.8),
-- the read §3.5 describes. Decided by Kameel on 27 September 2026 (STEP4
-- Q10): "it can allow for logistics between parents to be arranged or
-- communicated. The shape to build: signed in, her own child's side and
-- fixture only, the named players and their order — names only, no
-- profiles, ages or photos. A narrow read over `match_squad`, not
-- `player.profile.read`." Its proof is db/99 §109.
--
-- WHY A FUNCTION. match_squad_read (db/09, dated for a pupil by db/129)
-- gives a guardian one row of a sheet: her own child's, asked about by his
-- id. Widening that policy would hand her every row of every sheet her
-- child's side plays, with the player id that opens each boy's other rows.
-- The decision is narrower: the names and the order, nothing else, and only
-- of a sheet her child is on. So the policy stays as it is (the staff's and
-- the side's full read, §3.5) and this is a definer read with its own
-- columns.
--
-- THE READ
--   fixture_sheet(match) → (side, batting_no, twelfth, name)
--     For each end of the fixture (home; away when the away school is on
--     SCRBRD), that end's sheet as it stands — every row not withdrawn, in
--     batting order, the twelfth man after the eleven, a reserve with no
--     number after them — when the caller may read SOME boy on that end's
--     sheet under player.profile.read. Otherwise nothing of that end.
--   The gate is the sheet branch of fixture_reach() (§2.5 branch 3), asked
--   with player.profile.read, and it is match_squad_read's own question, row
--   for row: app_can('player.profile.read', the end's school, the end's
--   team, the boy, the fixture), AND, for a pupil, db/129's dated twin
--   pupil_side_on() with the same arguments. So an end is open to a caller
--   exactly when match_squad_read would show him one of its live rows; db/99
--   §109 (policy) holds the two together for every persona it stages.
--   Who that admits (§3.5): a guardian whose child is on that end's sheet
--   (her link names him); a pupil on it (his self link) or on that side (his
--   `player` row, from the day he joined it); the side's staff; the school
--   office. Who it refuses: a spectator (he holds no player.profile.read), a
--   guardian whose child is not on that end's sheet — another side, or the
--   other school's end of the same fixture — and anybody signed out.
--   The other school's parent reads her own end and not this school's,
--   which is why the read answers per end and never both to one who passes
--   for one.
--
-- WHAT IT NEVER RETURNS. No player_id, no school or team of a boy, no age,
-- no number, no photo, no availability, no fitness: four columns, named
-- here, and nothing joined onto them. db/99 §109 (columns) asserts the
-- result's shape, so a column added later goes red there.
--
-- "PUBLISHED" (§3.5: "whatever match_squad records today", §5 item 8).
-- match_squad records no publication step: a row is the sheet from the
-- moment the coach saves it (events-api.mjs squadRoutes.select), and a boy
-- taken off is withdrawn, not deleted (db/00). The side has read it that way
-- since the table existed (a pupil's "Side not out yet" is no live row). So
-- a published sheet is a sheet with a row not withdrawn, and an unpublished
-- one — nothing saved yet, or every row withdrawn — returns nothing.
--
-- NAMES. full_name, as the side's own squad read (read-api.mjs match_squad)
-- names each boy. Signed in, never public: nothing here reaches a public
-- page, and the public projection (SCRBRD-083) is not touched.
--
-- R-G (§6.7) adds nothing to this file: see db/99 §108.
--
-- EXISTING ROWS. Nothing inserted, changed or deleted. No policy changed.
-- Safe to run twice: CREATE OR REPLACE, and grants that end where they began.
--
-- WHO MAY CALL WHAT
--   fixture_sheet(uuid)   scrbrd_app (GET /api/matches/:id/sheet, as the caller)
-- And none to PUBLIC, nor to a managed host's anon, authenticated or
-- service_role.

-- ── 0 · What it needs ──────────────────────────────────────────────
DO $needs$
BEGIN
  IF to_regclass('match_squad') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('app_reader_is_pupil()') IS NULL
     OR to_regprocedure('pupil_side_on(text,uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/131: the dated pupil reach (db/129) is missing; apply db/129 first';
  END IF;
END $needs$;

-- ── 1 · The sheet ──────────────────────────────────────────────────
-- Read as the owner: the sheet and the players are rows the caller's own
-- policies show him one of at most, and the gate asks app_can() itself.
CREATE OR REPLACE FUNCTION fixture_sheet(p_match uuid)
RETURNS TABLE (side text, batting_no smallint, twelfth boolean, name text) AS $$
  WITH e AS (
    SELECT m.id AS match_id, x.side, x.school_id, x.team_code
      FROM match m
      CROSS JOIN LATERAL (VALUES ('home', m.school_id,      m.team_code),
                                 ('away', m.away_school_id, m.away_team_code)) AS x(side, school_id, team_code)
     WHERE m.id = p_match
       AND x.school_id IS NOT NULL
       AND app_user_id() IS NOT NULL),
  open_end AS (
    -- match_squad_read's question, of a live row at this end
    SELECT e.* FROM e
     WHERE EXISTS (SELECT 1 FROM match_squad s
                    WHERE s.match_id = e.match_id AND s.side = e.side AND NOT s.withdrawn
                      AND app_can('player.profile.read', e.school_id, e.team_code, s.player_id, e.match_id)
                      AND (NOT app_reader_is_pupil()
                           OR pupil_side_on('player.profile.read', e.school_id, e.team_code, s.player_id, e.match_id))))
  SELECT s.side, s.batting_no, s.twelfth, p.full_name
    FROM open_end e
    JOIN match_squad s ON s.match_id = e.match_id AND s.side = e.side AND NOT s.withdrawn
    JOIN player p      ON p.id = s.player_id AND p.school_id = e.school_id
   ORDER BY CASE s.side WHEN 'home' THEN 0 ELSE 1 END, s.twelfth, s.batting_no NULLS LAST, p.full_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

COMMENT ON FUNCTION fixture_sheet(uuid) IS
  'REACH R-H (db/131; STEP4 Q10, Kameel 27 Sep 2026): a fixture''s team sheet as names and order — side, batting_no, twelfth, name; never a player_id — for each end whose live sheet holds a boy the caller may read under player.profile.read (match_squad_read''s question, with db/129''s dated twin for a pupil). A parent reads her child''s end; a spectator nothing.';

-- ── 2 · Who may call it ────────────────────────────────────────────
DO $grants$
DECLARE f text := 'fixture_sheet(uuid)'; r text;
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
    END IF;
  END LOOP;
END $grants$;

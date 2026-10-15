-- ══════════════════════════════════════════════════════════════════
--  106 · REACH R-A: a family reads its side's fixtures, trips and training
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/REACH_parent_pupil.md, build group R-A (§6.1),
-- decided by Kameel on 2026-10-14 (REACH-D1: "the side only", by policy).
-- Its proof is db/99 §83. Closes M3: until now every guardian at a school
-- read every fixture, every trip (driver, pickup, notes that may name a
-- child) and every training session at that school, and the browser filtered
-- them down to her child's side (family.js).
--
-- WHY (§1 of the design). A guardian's assignment is school-wide and names
-- her children. app_can() answers her by the person argument the policy
-- passes: the all-zeros id ("any person") is her whole school; NULL, or an
-- id no link names, is nothing; her child's id is her child. A fixture, a
-- trip and a training session are rows about a SIDE, which names no boy, so
-- every policy over them had to choose between too wide (zeros: match_read,
-- trip_read, training_session_read, the satellites) and too narrow (NULL:
-- match_conditions_read, match_condition_override_read). Neither spelling
-- says "this side". This file adds the derived question that does.
--
-- THE THREE SPELLINGS OF THE PERSON ARGUMENT, as this file uses them
--   '00000000-…'  zeros: any person. Not used for a family-readable side row
--                 any more: for a guardian it is the whole school.
--   'ffffffff-…'  all-f: an id no link names, so "unnamed assignments only"
--                 (the side's staff, its players, school-wide staff, a
--                 spectator the office admitted). NULL answers the same
--                 (db/99 §83 (spelling) checks it live) but reads as
--                 "nothing", which is how the ball-log bug read; all-f says
--                 what it means.
--   <a boy's id>  this boy: his family and himself, and every unnamed
--                 assignment that reaches his side.
--
-- THE RULE: three questions about one row (§2.5)
--
--   side_reach(capability, school, team, fixture)
--       Is the caller at this side, for this capability? (1) An assignment
--       naming nobody that fits the school and team (app_can() with all-f),
--       or (2) a named assignment (guardian, selfaccess, enquiry) naming a
--       boy whose side this is (player.school_id and player.team_code are
--       the side), asked of app_can() about that boy.
--   fixture_end_reach(capability, match, school, team)
--       Is the caller at the end of this fixture that (school, team) plays,
--       or named on that end's sheet? side_reach() at that end, or (3) a boy
--       on the fixture's sheet at that end (match_squad, not withdrawn, a boy
--       of that end's school), asked of app_can() about the boy at that end.
--   fixture_reach(capability, match)
--       Is the caller at either end of this fixture, or named on its sheet?
--       fixture_end_reach() at the home end, or at the away end when there is
--       one. §2.5's three branches, grouped by end.
--
-- THE SHAPE: the same rule, asked once per statement (§2.5 "cost")
--   The three questions above are one row at a time, and the first build put
--   them in the policies as they stand. Measured on a forty-fixture season
--   (five Hilton sides, 204 fixtures, 200 buses) that cost every reader
--   350–500 ms for the fixture list where db/09 cost 8–11: each row nested
--   four definer calls (fixture_reach → fixture_end_reach → side_reach →
--   app_can), and a definer SQL function called from inside another is
--   started afresh on every call. §2.5 names the remedy, "the shape change —
--   not the rule change", as lift_my_sides() (db/70) already does: the
--   branches that are about the caller's own boys are computed ONCE per
--   statement, as a set, and the policy probes it; the branch about nobody
--   (1) stays a direct app_can() per row, as db/09's was.
--
--   my_fixture_ends(capability)   the fixture ends (match, school, team) the
--       caller reaches through a boy his own links name: (2) the boy's side at
--       that end, or (3) the boy on that end's sheet. Each asked of app_can()
--       about the boy, at that end, with the fixture.
--   my_sides(capability)          the sides (school, team) the caller reaches
--       through a boy his own links name (2), asked with no fixture (zeros),
--       as training_session_read always asked.
--   match_away_school(match), match_away_team(match)   the away anchors, as
--       db/02's match_school()/match_team() are the home ones, so a satellite
--       asks (1) at the away end without reading match under the caller's
--       row security (db/39's reason).
--
--   Measured, the same season, median of 15, ms execution (planning < 0.3),
--   EXPLAIN (ANALYZE) of SELECT * as the reader, on 2026-10-15:
--                                   db/09     first build    this file
--     match, guardian of two          8.5        508           34
--     match, 1XI coach               11.4        427           10
--     match, director                 7.9        353            8
--     match, pupil (self-access)        –        452           25
--     trip,  guardian of two         47          295          100
--     trip,  1XI coach               51          256           38
--     trip,  director                  –           –           39
--     toss,  guardian of two         16 (db/39)    –           30
--     toss,  1XI coach                7 (db/39)    –            7
--     training, guardian of two         –          –           16
--     training, 1XI coach               –          –           12
--   §2.5's every-boy text in match_read: guardian 649, coach 552.
--   The guardian's figure grows with her children's fixtures (app_can() per
--   fixture of each child's side, once per statement), not with the school's.
--   On the seed every read is under 13 ms. db/99 §83 (shape) proves, for
--   every person holding an assignment and every staged and scored row, that
--   each policy admits exactly the rows the one-row question admits.
--
-- WHERE THE BUILD DIFFERS FROM §2.5's SQL, and why each is the same rule
--   (a) The boys branch (2) and the sheet branch (3) ask about are the boys
--       the CALLER'S OWN links name, not every boy on the side or the sheet.
--       Same answer: app_can() about a boy can say yes where branch (1) said
--       no only through an assignment that names that boy (§1.2: an
--       assignment naming nobody passes every spelling alike, so for it (2)
--       and (3) add nothing to (1)). db/99 §83 (literal) holds the helpers
--       equal to §2.5's text, spelled out over every boy, for every person
--       and every row it stages.
--   (b) The sheet branch skips a WITHDRAWN boy and asks for a boy of that
--       end's school, as db/100's my_child_fixtures() and db/101's
--       news_sheet_reach() do (Kameel: "a boy taken off the sheet loses
--       it"). §6.1 proof 1 asks the helpers to agree with those two; §2.5's
--       sketch did not spell either filter.
--   (c) A trip is read at ITS OWN end. §3.6 says the trip is "a side-level
--       row with a child's name on it and must not reach other sides'
--       parents", and §6.1 proof 7 says "notes of another side's trip never
--       reach her". A trip is written by the host (trip_insert anchors on
--       the match's home school; db/41 anchors its driver reads on
--       trip.school_id and match_team()), so fixture_reach() over both ends
--       would hand the host's bus, its driver, its pickup and its notes to
--       the away school's parents. trip_read asks fixture_end_reach() at the
--       trip's school and the host's team, which is db/41's anchor.
--   (d) ...and only to a reader of its fixture. db/09's trip_read read its
--       anchors through a subquery on match under the caller's own row
--       security, so a caller who could not read the fixture got no anchor
--       and no trip: that is what kept a school-wide driver (transport.read,
--       no fixture.read) to the fixtures he drives, where db/41 then cuts
--       him to his own bus (db/99's db/39 section tripwire; docs/rls-anchor-audit.md,
--       "trip"). trip_read keeps that condition, spelled out instead of
--       hidden in an anchor: fixture_reach('fixture.read') on the trip's
--       fixture, or a live trip to it that he drives (db/41's
--       trip_driven_matches()).
--
-- THE POLICIES (each DROP POLICY IF EXISTS, then CREATE; FOR SELECT,
-- PERMISSIVE; the write policies are not touched)
--   match_read                     fixture_reach('fixture.read', id)
--   match_toss_read, match_broadcast_read, drs_review_read,
--   match_official_read, match_pitch_report_read, match_weather_read,
--   match_conditions_read, match_condition_override_read
--                                  fixture_reach('fixture.read', match_id)
--                                  (were home-only through match_school()/
--                                  match_team(); the away side's parent now
--                                  reads the toss, the umpires, the pitch,
--                                  the weather and the playing conditions of
--                                  her side's away fixture, AV-D1 extended)
--   match_result_decision_read     the same, OR db/69's competition_visible()
--                                  branch, kept word for word
--   fixture_publication_read       side_reach('fixture.read', school, team,
--                                  match), the one-row question as it stands
--                                  (read one fixture at a time): each school
--                                  still reads its own side's row and only
--                                  that (db/47); its columns are a yes/no per
--                                  side and who set it (§5 item 9)
--   trip_read                      fixture_end_reach('transport.read', match,
--                                  trip's school, match_team()) AND
--                                  (fixture_reach('fixture.read', match) OR
--                                  he drives to it) — (c) and (d) above
--   training_session_read          side_reach('team.read', school, team, zeros)
--   each in THE SHAPE above.
-- AND REPLACES IN PLACE
--   trip_fixture_driver_only(match) (db/41)  "the caller reaches this
--       fixture ONLY as a driver": its second half was "the two arms of
--       match_read (db/09), repeated here"; it now asks match_read's question
--       as it stands, fixture_reach('fixture.read', match). For a driver (no
--       fixture.read) nothing changes; a guardian who also drives reaches a
--       fixture of another side only as its driver, so db/41's restrictive
--       policy keeps the other buses on it from her. Signature, owner rights
--       and grants are db/41's.
--
-- NOT TOUCHED, on purpose
--   match_squad_read (per side, the row's boy: class E), match_availability
--   (the row's boy), training_attendance (the row's boy), the pad's tables
--   (scoring_session, ball_event_quarantine, scoring_audit: host-only,
--   AV-D4), ball_event_read (db/100's my_child_fixtures() agrees with
--   fixture_reach(): db/99 §83 (agree)), news (db/96, db/101: news_plan_reach()
--   agrees with side_reach(): §83 (agree)), match_trip_driver_read,
--   trip_driver_own_read and trip_driver_own_only (a driver reads his own),
--   every write policy, app_can() itself.
--
-- WHO GAINS, WHO LOSES (db/99 §83 proves each)
--   A guardian: her children's sides' fixtures, home and away, and the one
--     fixture a child is on the sheet of (playing up); their trips at the
--     trip's end; their training. Nothing of another side, at her school or
--     any other. A link pending, ended or revoked: nothing.
--   A pupil: his side's, through his team assignment (unnamed), as before.
--     Playing up he does not read the older side's fixture: his selfaccess
--     link holds no fixture.read, and his team assignment is his own side's.
--     db/100's log answers him the same; §2.2's plain words say he should,
--     which is a capability question, not this file's.
--   A pupil whose `player` assignment has no team (until R-D, db/108): every
--     side at his school, exactly as before. Branch (1) gives it him; (2)
--     and (3) give him nothing more (§83 (team-less)).
--   Staff, a school-wide spectator, the office, a driver: unchanged.
--   The away side's family and staff: gain the satellites of their side's
--     away fixtures.
--
-- WHAT IT CHANGES ON A LIVE DATABASE. Seven new functions; one function
-- replaced in place (trip_fixture_driver_only); thirteen read policies
-- dropped and created again, each in the paste's one transaction. No table,
-- column, index or row. No grant on a table. A second paste changes nothing.
-- Every family stops seeing other sides' fixtures, trips and training on the
-- paste; a parent who wants the 1st XI's score has the public page.

-- ── 0 · What it needs ──────────────────────────────────────────────
DO $needs$
BEGIN
  IF to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('match_school(uuid)') IS NULL
     OR to_regprocedure('match_team(uuid)') IS NULL
     OR to_regprocedure('trip_fixture_driver_only(uuid)') IS NULL
     OR to_regprocedure('trip_driven_matches()') IS NULL
     OR to_regprocedure('competition_visible(uuid)') IS NULL
     OR to_regprocedure('match_competition_of(uuid)') IS NULL
     OR to_regclass('fixture_publication') IS NULL
     OR to_regclass('match_conditions') IS NULL
     OR to_regclass('match_result_decision') IS NULL THEN
    RAISE EXCEPTION 'db/106: db/41, db/47, db/61 or db/69 is missing; apply them first';
  END IF;
END $needs$;

-- ── 1 · The rule: three questions about one row ────────────────────
-- Read as the owner: the roster, the sheet and the links are rows the
-- caller's own policies may not show him, and a policy that asks must not
-- depend on what he can see of them. Each answers yes or no.

-- Is the caller at this side, for this capability?
CREATE OR REPLACE FUNCTION side_reach(p_capability text, p_school uuid, p_team text, p_fixture uuid)
RETURNS boolean AS $$
  SELECT
    -- (1) an assignment that names nobody, fitting this school and team: the
    --     side's staff, its players, school-wide staff, a spectator the
    --     office admitted. all-f = "unnamed assignments only".
    app_can(p_capability, p_school, p_team, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, p_fixture)
    -- (2) a named assignment (guardian, selfaccess, enquiry) naming a boy
    --     whose side this is, asked about that boy. The candidates are the
    --     boys the caller's own links name (header (a)).
    OR EXISTS (SELECT 1
                 FROM role_assignment a
                 JOIN assignment_subject g ON g.assignment_id = a.id
                 JOIN player p ON p.id = g.player_id
                WHERE a.person_id = app_user_id()
                  AND p.school_id = p_school AND p.team_code = p_team
                  AND app_can(p_capability, p_school, p_team, p.id, p_fixture))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Is the caller at the end of this fixture that (school, team) plays, or
-- named on that end's sheet?
CREATE OR REPLACE FUNCTION fixture_end_reach(p_capability text, p_match uuid, p_school uuid, p_team text)
RETURNS boolean AS $$
  SELECT p_match IS NOT NULL AND p_school IS NOT NULL AND (
    side_reach(p_capability, p_school, p_team, p_match)
    -- (3) playing up: a boy on this end's sheet, not withdrawn, a boy of this
    --     end's school, and whoever may read him at this end. The candidates
    --     are the boys the caller's own links name (header (a), (b)).
    OR EXISTS (SELECT 1
                 FROM match m
                 JOIN match_squad ms ON ms.match_id = m.id AND NOT ms.withdrawn
                 JOIN player p ON p.id = ms.player_id AND p.school_id = p_school
                 JOIN assignment_subject g ON g.player_id = ms.player_id
                 JOIN role_assignment a ON a.id = g.assignment_id AND a.person_id = app_user_id()
                WHERE m.id = p_match
                  AND ((ms.side = 'home' AND m.school_id = p_school
                        AND m.team_code IS NOT DISTINCT FROM p_team)
                    OR (ms.side = 'away' AND m.away_school_id = p_school
                        AND m.away_team_code IS NOT DISTINCT FROM p_team))
                  AND app_can(p_capability, p_school, p_team, ms.player_id, m.id)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Is the caller at either end of this fixture, or named on its sheet?
CREATE OR REPLACE FUNCTION fixture_reach(p_capability text, p_match uuid)
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND (
       fixture_end_reach(p_capability, m.id, m.school_id, m.team_code)
    OR (m.away_school_id IS NOT NULL
        AND fixture_end_reach(p_capability, m.id, m.away_school_id, m.away_team_code))))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 2 · The shape: the named branches, once per statement ──────────
-- The fixture ends the caller reaches through a boy his own links name:
-- branch (2), the boy's side at that end, or (3), the boy on that end's
-- sheet, not withdrawn; a boy of that end's school; asked about the boy, at
-- that end, with the fixture. Bounded by the boys' schools' fixtures.
CREATE OR REPLACE FUNCTION my_fixture_ends(p_capability text)
RETURNS TABLE (match_id uuid, school_id uuid, team_code text) AS $$
  SELECT DISTINCT x.match_id, x.school_id, x.team_code
    FROM (SELECT m.id, m.school_id, m.team_code
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN match m ON m.school_id = p.school_id
           WHERE a.person_id = app_user_id()
             AND (m.team_code = p.team_code
                  OR EXISTS (SELECT 1 FROM match_squad s
                              WHERE s.match_id = m.id AND s.player_id = p.id
                                AND s.side = 'home' AND NOT s.withdrawn))
             AND app_can(p_capability, m.school_id, m.team_code, p.id, m.id)
          UNION ALL
          SELECT m.id, m.away_school_id, m.away_team_code
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN match m ON m.away_school_id = p.school_id
           WHERE a.person_id = app_user_id()
             AND (m.away_team_code = p.team_code
                  OR EXISTS (SELECT 1 FROM match_squad s
                              WHERE s.match_id = m.id AND s.player_id = p.id
                                AND s.side = 'away' AND NOT s.withdrawn))
             AND app_can(p_capability, m.away_school_id, m.away_team_code, p.id, m.id)) x(match_id, school_id, team_code)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The sides the caller reaches through a boy his own links name (2), asked
-- with no fixture.
CREATE OR REPLACE FUNCTION my_sides(p_capability text)
RETURNS TABLE (school_id uuid, team_code text) AS $$
  SELECT DISTINCT p.school_id, p.team_code
    FROM role_assignment a
    JOIN assignment_subject g ON g.assignment_id = a.id
    JOIN player p ON p.id = g.player_id
   WHERE a.person_id = app_user_id() AND p.team_code IS NOT NULL
     AND app_can(p_capability, p.school_id, p.team_code, p.id, '00000000-0000-0000-0000-000000000000'::uuid)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The away anchors, as db/02's match_school() and match_team() are the home.
CREATE OR REPLACE FUNCTION match_away_school(p_match uuid) RETURNS uuid AS $$
  SELECT away_school_id FROM match WHERE id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE FUNCTION match_away_team(p_match uuid) RETURNS text AS $$
  SELECT away_team_code FROM match WHERE id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/41's "the caller reaches this fixture only as a driver", with
-- match_read's question as it now stands. Every other line is db/41's.
CREATE OR REPLACE FUNCTION trip_fixture_driver_only(p_match uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM trip_driven_matches() d WHERE d = p_match)
     AND NOT fixture_reach('fixture.read', p_match)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION trip_fixture_driver_only(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trip_fixture_driver_only(uuid) TO PUBLIC;

-- Who may call the new ones: the application, whose policies ask them. Not
-- PUBLIC, nor a managed host's API roles.
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['side_reach(text,uuid,text,uuid)', 'fixture_end_reach(text,uuid,uuid,text)',
                           'fixture_reach(text,uuid)', 'my_fixture_ends(text)', 'my_sides(text)',
                           'match_away_school(uuid)', 'match_away_team(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;

-- ── 3 · Class A: the fixture and the facts around it ───────────────
-- fixture_reach('fixture.read', <the fixture>), in the shape: (1) at the
-- home end, (1) at the away end, or an end my_fixture_ends() names.
DROP POLICY IF EXISTS match_read ON match;
CREATE POLICY match_read ON match
  FOR SELECT USING (
    app_can('fixture.read', match.school_id, match.team_code, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, match.id)
    OR (match.away_school_id IS NOT NULL
        AND app_can('fixture.read', match.away_school_id, match.away_team_code, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, match.id))
    OR match.id IN (SELECT r.match_id FROM my_fixture_ends('fixture.read') r));

-- The satellites: the same question about the row's fixture.
DO $satellites$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['match_toss', 'match_broadcast', 'drs_review', 'match_official', 'match_pitch_report',
                           'match_weather', 'match_conditions', 'match_condition_override'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format($p$CREATE POLICY %1$I ON %2$I
  FOR SELECT USING (
    app_can('fixture.read', match_school(%2$I.match_id), match_team(%2$I.match_id), 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, %2$I.match_id)
    OR (match_away_school(%2$I.match_id) IS NOT NULL
        AND app_can('fixture.read', match_away_school(%2$I.match_id), match_away_team(%2$I.match_id), 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, %2$I.match_id))
    OR %2$I.match_id IN (SELECT r.match_id FROM my_fixture_ends('fixture.read') r))$p$, t || '_read', t);
  END LOOP;
END $satellites$;

-- db/69's third branch (a competition's published results) is kept.
DROP POLICY IF EXISTS match_result_decision_read ON match_result_decision;
CREATE POLICY match_result_decision_read ON match_result_decision
  FOR SELECT USING (
    app_can('fixture.read', match_school(match_result_decision.match_id), match_team(match_result_decision.match_id),
            'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, match_result_decision.match_id)
    OR (match_away_school(match_result_decision.match_id) IS NOT NULL
        AND app_can('fixture.read', match_away_school(match_result_decision.match_id), match_away_team(match_result_decision.match_id),
                    'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, match_result_decision.match_id))
    OR match_result_decision.match_id IN (SELECT r.match_id FROM my_fixture_ends('fixture.read') r)
    OR competition_visible(match_competition_of(match_result_decision.match_id)));

-- Each school reads its own side's row (db/47), now as the side: the one-row
-- question as it stands (a publication is read a fixture at a time).
DROP POLICY IF EXISTS fixture_publication_read ON fixture_publication;
CREATE POLICY fixture_publication_read ON fixture_publication
  FOR SELECT USING (side_reach('fixture.read', fixture_publication.school_id, fixture_publication.team_code,
                               fixture_publication.match_id));

-- ── 4 · Class F: the bus, at its own end, to whoever reads its fixture ──
-- fixture_end_reach('transport.read', match, the trip's school, the host's
-- team) AND (fixture_reach('fixture.read', match) OR he drives a trip to it),
-- in the shape. Header (c) and (d). coalesce: an end with no team is an end.
DROP POLICY IF EXISTS trip_read ON trip;
CREATE POLICY trip_read ON trip
  FOR SELECT USING (
    (app_can('transport.read', trip.school_id, match_team(trip.match_id), 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, trip.match_id)
     OR (trip.match_id, trip.school_id, coalesce(match_team(trip.match_id), ''))
        IN (SELECT r.match_id, r.school_id, coalesce(r.team_code, '') FROM my_fixture_ends('transport.read') r))
    AND (app_can('fixture.read', match_school(trip.match_id), match_team(trip.match_id), 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, trip.match_id)
         OR (match_away_school(trip.match_id) IS NOT NULL
             AND app_can('fixture.read', match_away_school(trip.match_id), match_away_team(trip.match_id), 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, trip.match_id))
         OR trip.match_id IN (SELECT r.match_id FROM my_fixture_ends('fixture.read') r)
         OR trip.match_id IN (SELECT trip_driven_matches())));

-- ── 5 · Training: the side's sessions ──────────────────────────────
-- side_reach('team.read', school, team, zeros), in the shape.
DROP POLICY IF EXISTS training_session_read ON training_session;
CREATE POLICY training_session_read ON training_session
  FOR SELECT USING (
    app_can('team.read', training_session.school_id, training_session.team_code,
            'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
    OR (training_session.school_id, training_session.team_code) IN (SELECT s.school_id, s.team_code FROM my_sides('team.read') s));

-- ── 6 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE
  r record;
  q text;
  f text;
  t text;
BEGIN
  -- Every re-created read: a permissive SELECT policy that asks the unnamed
  -- branch with all-f and the named branches through the helpers, and never
  -- with the all-zeros person (bar training's fixture argument, which is
  -- "no fixture", and the person argument is all-f there too).
  FOR r IN SELECT x.tbl, x.pol, x.must FROM (VALUES
      ('match', 'match_read', ARRAY['my_fixture_ends(''fixture.read''::text)', 'away_school_id IS NOT NULL']),
      ('match_toss', 'match_toss_read', ARRAY['my_fixture_ends(''fixture.read''::text)', 'match_away_school(match_id)']),
      ('match_broadcast', 'match_broadcast_read', ARRAY['my_fixture_ends(''fixture.read''::text)', 'match_away_school(match_id)']),
      ('drs_review', 'drs_review_read', ARRAY['my_fixture_ends(''fixture.read''::text)', 'match_away_school(match_id)']),
      ('match_official', 'match_official_read', ARRAY['my_fixture_ends(''fixture.read''::text)', 'match_away_school(match_id)']),
      ('match_pitch_report', 'match_pitch_report_read', ARRAY['my_fixture_ends(''fixture.read''::text)', 'match_away_school(match_id)']),
      ('match_weather', 'match_weather_read', ARRAY['my_fixture_ends(''fixture.read''::text)', 'match_away_school(match_id)']),
      ('match_conditions', 'match_conditions_read', ARRAY['my_fixture_ends(''fixture.read''::text)', 'match_away_school(match_id)']),
      ('match_condition_override', 'match_condition_override_read', ARRAY['my_fixture_ends(''fixture.read''::text)', 'match_away_school(match_id)']),
      ('match_result_decision', 'match_result_decision_read', ARRAY['my_fixture_ends(''fixture.read''::text)', 'match_away_school(match_id)',
                                                                    'competition_visible(match_competition_of(match_id))']),
      ('fixture_publication', 'fixture_publication_read', ARRAY['side_reach(''fixture.read''::text, school_id, team_code, match_id)']),
      ('trip', 'trip_read', ARRAY['my_fixture_ends(''transport.read''::text)', 'school_id, match_team(match_id)',
                                  'my_fixture_ends(''fixture.read''::text)', 'trip_driven_matches()']),
      ('training_session', 'training_session_read', ARRAY['my_sides(''team.read''::text)'])) x(tbl, pol, must) LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid) INTO q
      FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tbl) AND p.polname = r.pol AND p.polcmd = 'r' AND p.polpermissive;
    IF q IS NULL OR EXISTS (SELECT 1 FROM unnest(r.must) m WHERE position(m IN q) = 0)
       OR (r.pol <> 'fixture_publication_read' AND position('ffffffff-ffff-ffff-ffff-ffffffffffff' IN q) = 0)
       OR replace(q, '''ffffffff-ffff-ffff-ffff-ffffffffffff''::uuid, ''00000000-0000-0000-0000-000000000000''::uuid)', '')
            LIKE '%00000000-0000-0000-0000-000000000000%' THEN
      RAISE EXCEPTION 'db/106: %.% is not the policy this file wrote: %', r.tbl, r.pol, coalesce(q, 'missing');
    END IF;
  END LOOP;
  -- The helpers: stable definers with a pinned path, for scrbrd_app and not
  -- PUBLIC. They ask with all-f and about a named boy, never with the
  -- all-zeros person that is a guardian's whole school (my_sides() asks
  -- about the boy with no fixture, which is the zeros FIXTURE argument).
  FOR r IN SELECT x.sig, x.must FROM (VALUES
             ('side_reach(text,uuid,text,uuid)', ARRAY['ffffffff-ffff-ffff-ffff-ffffffffffff', 'p.id, p_fixture', 'a.person_id = app_user_id()']),
             ('fixture_end_reach(text,uuid,uuid,text)', ARRAY['side_reach(p_capability, p_school, p_team, p_match)', 'NOT ms.withdrawn', 'ms.player_id, m.id', 'a.person_id = app_user_id()']),
             ('fixture_reach(text,uuid)', ARRAY['m.school_id, m.team_code', 'm.away_school_id, m.away_team_code']),
             ('my_fixture_ends(text)', ARRAY['NOT s.withdrawn', 'm.school_id, m.team_code, p.id, m.id', 'm.away_school_id, m.away_team_code, p.id, m.id', 'a.person_id = app_user_id()']),
             ('my_sides(text)', ARRAY['p.school_id, p.team_code, p.id', 'a.person_id = app_user_id()']),
             ('match_away_school(uuid)', ARRAY['away_school_id']),
             ('match_away_team(uuid)', ARRAY['away_team_code'])) x(sig, must) LOOP
    SELECT p.prosrc INTO f FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.sig) AND p.prosecdef AND p.provolatile = 's'
       AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'));
    IF f IS NULL OR EXISTS (SELECT 1 FROM unnest(r.must) m WHERE position(m IN f) = 0)
       OR (r.sig <> 'my_sides(text)' AND position('00000000-0000-0000-0000-000000000000' IN f) > 0) THEN
      RAISE EXCEPTION 'db/106: % is missing, not a stable definer with a pinned path, or does not ask what it says', r.sig;
    END IF;
    IF has_function_privilege('public', to_regprocedure(r.sig), 'EXECUTE')
       OR NOT has_function_privilege('scrbrd_app', to_regprocedure(r.sig), 'EXECUTE') THEN
      RAISE EXCEPTION 'db/106: % is executable by PUBLIC, or not by scrbrd_app', r.sig;
    END IF;
  END LOOP;
  IF position('fixture_reach(''fixture.read'', p_match)' IN
              coalesce((SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('trip_fixture_driver_only(uuid)') AND p.prosecdef), '')) = 0 THEN
    RAISE EXCEPTION 'db/106: trip_fixture_driver_only() does not ask match_read''s question';
  END IF;
  -- The tables this file narrows have no other permissive read that would
  -- widen them past it, but the driver's own (db/41).
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polrelid IN (to_regclass('match'), to_regclass('trip'), to_regclass('training_session'),
                                   to_regclass('match_toss'), to_regclass('match_broadcast'), to_regclass('drs_review'),
                                   to_regclass('match_official'), to_regclass('match_pitch_report'), to_regclass('match_weather'),
                                   to_regclass('match_conditions'), to_regclass('match_condition_override'),
                                   to_regclass('match_result_decision'), to_regclass('fixture_publication'))
                AND p.polpermissive AND p.polcmd IN ('r', '*')
                AND p.polname NOT IN ('match_read', 'trip_read', 'training_session_read', 'match_toss_read',
                                      'match_broadcast_read', 'drs_review_read', 'match_official_read',
                                      'match_pitch_report_read', 'match_weather_read', 'match_conditions_read',
                                      'match_condition_override_read', 'match_result_decision_read',
                                      'fixture_publication_read', 'match_trip_driver_read', 'trip_driver_own_read')) THEN
    RAISE EXCEPTION 'db/106: a table this file narrows has another permissive read policy';
  END IF;
  -- The pad's tables are the host's, untouched (AV-D4).
  FOREACH t IN ARRAY ARRAY['scoring_session', 'ball_event_quarantine', 'scoring_audit'] LOOP
    IF EXISTS (SELECT 1 FROM pg_policy p
                WHERE p.polrelid = to_regclass(t)
                  AND concat(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid))
                      ~ '(side_reach|fixture_reach|fixture_end_reach|my_fixture_ends|my_sides)\(') THEN
      RAISE EXCEPTION 'db/106: %''s policy asks a reach helper', t;
    END IF;
  END LOOP;
END $check$;

-- ══════════════════════════════════════════════════════════════════
--  129 · The moved boy's own reach is dated: a pupil's `player`
--        assignment reads his side only from the day he joined it
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/SEASON_ROLLOVER.md, the last slice of S2: §0's
-- table ("the parent, the pupil … the new side's, from the day he joined
-- it"), §1.3, §2.2 (the pupil's rows), and Kameel's decisions of 15 October
-- 2026: D1, and Q2 decided as recommended — "A boy who joins U15A in January
-- does not read U15A's 2026 fixtures, scorecards, posts or plans (dated
-- reach, §1.3)." It follows db/112 (SR-1: his `player` assignment follows
-- his side) and db/117 (SR-2: the dated side for every NAMED reader). Its
-- proof is db/99 §106.
--
-- ── 1 · THE GAP ─────────────────────────────────────────────────────
-- After a move, db/112 carries the boy's `player` assignment to his new side.
-- Through it — the unnamed branch (1), app_can() asked with the all-f person
-- (or NULL, or the all-zeros person, or a team-mate's id) — he reads EVERY
-- fixture, sheet, log, bus, nets session and post of his new side, those
-- dated before he joined it as well. db/117 dated the family's reach and his
-- own selfaccess reach through side_on(); his own `player` reach was the one
-- path left undated (§2.10's widening check: "branch (1) is app_can() with
-- all-f and does not read the membership"). So the boy moved from U14A to
-- U15A on day D read U15A's whole season before D, the scorecards naming
-- boys now in U16 among it, which Q2 refused his family and him.
--
-- ── 2 · THE RULE ────────────────────────────────────────────────────
-- Branch (1) as before, except where the reach is a pupil's OWN `player`
-- assignment at the side: that one reads a row only if his boy was on the
-- side on the row's day (side_on(), db/117). In one predicate:
--   pupil_side_on(cap, school, team, person, fixture[, day])
--     true  when the caller holds no live `player` assignment at the side
--           (staff, a parent, a spectator, the office: every reader but a
--           pupil, and a pupil at any side but his own);
--     true  when he holds one but has no boy of his own at that school (a
--           `player` row with no pupil behind it — the seed's spectator
--           holds one — has no joining day to date it by: unchanged);
--     true  when his own boy (my_own_boy(): his account's player, or his live
--           verified self-access link) was on the side on the row's day;
--     true  when another of his assignments gives the same reach
--           (app_can_but_player(): app_can() over every assignment but a
--           `player` one — a pupil scorer named to a fixture keeps it);
--     false otherwise: the row is of his side, dated before he joined it
--           (or after he left it and came back), and nothing else of his
--           reaches it.
--   The day: the fixture's (side_day(), db/117: its starts_at in
--   Johannesburg; no fixture is today) for a fixture and everything hung on
--   one; the session's own starts_at for nets; the post's day
--   (news_post_day(), db/117) for posts and plans.
-- It is only ever ANDed onto an app_can() call that already stood, with the
-- same arguments: no reader can gain a row from it. For a reader with no
-- live `player` assignment at the side it is true at once, so every staff
-- reader's answer is the same function of the same rows as before.
--
-- ── 3 · WHAT CHANGES ────────────────────────────────────────────────
--   + app_can_but_player(text,uuid,text,uuid,uuid)   app_can()'s body as
--       db/128 left it, word for word, with one line added: AND a.role <>
--       'player'. The owner's alone (only pupil_side_on() asks it). The check
--       below holds it equal to app_can() bar that line, and db/99 §106 does
--       again on every verify, so a change to app_can() that is not carried
--       here goes red.
--   + pupil_side_on(text,uuid,text,uuid,uuid)        the rule on the
--       fixture's day; and (…, date) on a stated day.
--   ~ side_reach_on() (db/117)    branch (1) gains the clause: so
--       side_reach(), fixture_end_reach(), fixture_reach(), the publication
--       row and every notice asked through them are dated for him too.
--   ~ news_plan_reach(uuid,text,date) (db/117)   its two team.read calls
--       (branch (1), and "a boy on the side that day", which an unnamed row
--       answers for any boy) gain the clause on the post's day: the two restrictive news rules,
--       the post's notice and the plan's byline answer through it.
--       news_plan_reach(uuid,text) asks today: unchanged.
--   ~ seventeen read policies, every app_can() in each gaining its dated
--       twin, text otherwise identical (the check asserts pg_get_expr):
--       match_read; the satellites drs_review_read, match_broadcast_read,
--       match_condition_override_read, match_conditions_read,
--       match_official_read, match_pitch_report_read,
--       match_result_confirmation_read, match_result_decision_read,
--       match_toss_read, match_weather_read; ball_event_read (the log);
--       match_squad_read (the sheet); trip_read (the bus);
--       training_session_read, training_session_drill_read,
--       training_attendance_read (the nets).
--   services/api/read/read-api.mjs `fixtures.my_side` asks branch (1) as
--   match_read does; it gains the same clause (so the API needs db/129:
--   services/api/expected-migrations.json).
-- Not touched: app_can(), roles.mjs, db/01, db/09; the named branches (2),
-- the sheet (3), (4) and the boy's own old side (5) of db/106/db/117; the pad's
-- tables (AV-D4: scoring_session, ball_event_quarantine, scoring_audit);
-- school-wide reads (a '*' side); lift_my_sides() (a pupil reads no lift).
--
-- WHO LOSES, WHO DOES NOT (db/99 §106 proves each)
--   A boy moved from U14A to U15A on day D: U15A's fixtures, toss, umpires,
--     weather, conditions, sheets, balls, buses, nets, drills, attendance,
--     posts and plans dated before D. From D on: unchanged. His U14A season
--     is db/117's branch (5), untouched. A fixture before D that names him on
--     its sheet (he played up) still reaches him by branch (4).
--   A boy who joined his side after its first rows (the newcomer of Q2): the
--     same, before his joining day.
--   A boy who never moved, whose membership began before his side's rows:
--     unchanged.
--   Every reader with no live `player` assignment at the side: unchanged.
--
-- EXISTING ROWS. As db/117's header says for the family: a boy typed in by
-- the add route after his season began has a first membership dated the day
-- of the typing, so from this file he, like his family since db/117, reads
-- his side's rows from that day on (the sheet still gives every fixture he
-- is named on). The import dates a new boy from the season's start (db/117
-- §4b); the office may type a boy in dated.
--
-- COST. The clause is asked only where its app_can() said yes; for a reader
-- with no `player` assignment at the side it is one probe of his own
-- assignments. Measured in db/99 §106's header.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   + app_can_but_player(), pupil_side_on() ×2
--   ~ side_reach_on(), news_plan_reach(uuid,text,date): CREATE OR REPLACE in
--     place, owner and grants kept
--   ~ the seventeen policies above: dropped and created again, permissive,
--     FOR SELECT, TO PUBLIC, as they were
-- No table, column, row, capability or write policy. All in one transaction;
-- a second paste changes nothing (each object is guarded: db/117's text, or
-- this file's).

-- ── 0 · What it needs, and refuse to replace what this file was not written against ──
DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regprocedure('side_on(uuid,uuid,date)') IS NULL OR to_regprocedure('side_day(uuid)') IS NULL
     OR to_regprocedure('my_own_boy()') IS NULL OR to_regprocedure('news_post_day(text,uuid,timestamptz)') IS NULL
     OR to_regprocedure('sa_today()') IS NULL OR to_regprocedure('sa_date(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'db/129: db/117''s side_on(), side_day(), news_post_day() or db/106''s my_own_boy() is missing; apply them first';
  END IF;
  -- Functions: md5 of the folded body (db/124's way): the earlier file's, or this file's.
  FOR r IN SELECT * FROM (VALUES
      ('app_can(text,uuid,text,uuid,uuid)',       'f2104665f4ea2207c6d9165b6206785c', 'f2104665f4ea2207c6d9165b6206785c', 'db/128'),
      ('side_reach_on(text,uuid,text,uuid,date)', 'd06c1fa757b289ed9994c2bb58f40178', '81d5c93a5cc9e61ce1d3b506045da6b7', 'db/117'),
      ('news_plan_reach(uuid,text,date)',         '392bde9e9f1425d7d4bcf0fbfdd894f9', '2da22ae8c9bad2100509e99225d2b4c1', 'db/117'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/129: % (%) is not there', r.fn, r.src;
    END IF;
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/129: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
  -- Policies: md5 of pg_get_expr(), the text before this file or after it.
  FOR r IN SELECT * FROM (VALUES
      ('match',                     'match_read',                     '9df4d851644d56841b19b725802a0008', 'f0d18d60b5bcbd933c057db0ae76530f'),
      ('drs_review',                'drs_review_read',                'ec284f4c675417faa536e2601b401b1b', '351a0dd35af09b7d311a5893eaa43c56'),
      ('match_broadcast',           'match_broadcast_read',           'ec284f4c675417faa536e2601b401b1b', '351a0dd35af09b7d311a5893eaa43c56'),
      ('match_condition_override',  'match_condition_override_read',  'ec284f4c675417faa536e2601b401b1b', '351a0dd35af09b7d311a5893eaa43c56'),
      ('match_conditions',          'match_conditions_read',          'ec284f4c675417faa536e2601b401b1b', '351a0dd35af09b7d311a5893eaa43c56'),
      ('match_official',            'match_official_read',            'ec284f4c675417faa536e2601b401b1b', '351a0dd35af09b7d311a5893eaa43c56'),
      ('match_pitch_report',        'match_pitch_report_read',        'ec284f4c675417faa536e2601b401b1b', '351a0dd35af09b7d311a5893eaa43c56'),
      ('match_toss',                'match_toss_read',                'ec284f4c675417faa536e2601b401b1b', '351a0dd35af09b7d311a5893eaa43c56'),
      ('match_weather',             'match_weather_read',             'ec284f4c675417faa536e2601b401b1b', '351a0dd35af09b7d311a5893eaa43c56'),
      ('match_result_confirmation', 'match_result_confirmation_read', '7e6051b087832f4d849bdf1812a1dc09', '7ceba2112effad37218ffe65f8f12a23'),
      ('match_result_decision',     'match_result_decision_read',     '5802a28818f9879de9c0c8ab5aa51ddb', '8dc2414b02ca717cdeb048e97d106877'),
      ('ball_event',                'ball_event_read',                'c2c558be6822ce6d23ef575d6ed6f07e', '9bb220903d6f0c5b3d2fdb388d7f655c'),
      ('match_squad',               'match_squad_read',               'f70d44bf248a50e6eeaadd16f0fb8f10', '45ed7ab2621be310bf99238a7ce89167'),
      ('trip',                      'trip_read',                      '0c6f28bcf71ca3cd802ae5848baba921', '1772c797f0eaa5aeee6b02d0c25490b4'),
      ('training_session',          'training_session_read',          '714e15102d55ace7b43e87a747b019c5', 'f4c5d4c5003265f52ec18b84d5798d96'),
      ('training_session_drill',    'training_session_drill_read',    '9881d03b9e3a052f64c61a20a0c62d15', '9f0621d72bea96429fe44d941bd66a5d'),
      ('training_attendance',       'training_attendance_read',       '652f9a6f8f61efd4c3b352cb939b9065', '59bb90fba84da2df38f72edb5ca8f58a'))
      AS x(tbl, pol, was, mine)
  LOOP
    SELECT md5(pg_get_expr(p.polqual, p.polrelid)) INTO v_md5 FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tbl) AND p.polname = r.pol AND p.polcmd = 'r' AND p.polpermissive
       AND p.polroles = '{0}' AND p.polwithcheck IS NULL;
    IF v_md5 IS NULL OR v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/129: %.% is not the read this file was written against (md5 %); look before replacing it',
        r.tbl, r.pol, coalesce(v_md5, 'missing, or not a permissive SELECT policy for PUBLIC');
    END IF;
  END LOOP;
END $guard$;


-- ── 1 · app_can(), over every assignment but a `player` one ────────
-- db/128's app_can() body, word for word, and one line: AND a.role <>
-- 'player'. What the caller holds at a side apart from a pupil's own
-- `player` assignment. The owner's alone: pupil_side_on() asks it.
CREATE OR REPLACE FUNCTION app_can_but_player(
  p_capability text,
  p_school     uuid DEFAULT NULL,
  p_team       text DEFAULT NULL,
  p_person     uuid DEFAULT NULL,
  p_fixture    uuid DEFAULT NULL
) RETURNS boolean AS $$
  SELECT coalesce(NOT app_pad_scoped()
                  OR (p_capability IN ('fixture.read', 'scoring.edit') AND p_fixture = app_pad_match()), false)
     AND EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc
        ON rc.role = a.role
       AND rc.capability = p_capability
     WHERE a.person_id = app_user_id()
       AND a.role <> 'player'
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= sa_today())
       AND (a.valid_until IS NULL OR a.valid_until >  sa_today())
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       -- institution. There is no ANY_SCOPE for school: every governed row
       -- belongs to a tenant, and one that does not state its tenant is one
       -- nobody should reach.
       AND (a.school_id IS NULL OR (p_school IS NOT NULL AND a.school_id = p_school))
       -- team
       AND (a.team_code IS NULL OR p_team = '*'::text
            OR (p_team IS NOT NULL AND a.team_code = p_team))
       -- single fixture (scorers, match officials)
       AND (a.fixture_id IS NULL OR p_fixture = '00000000-0000-0000-0000-000000000000'::uuid
            OR (p_fixture IS NOT NULL AND a.fixture_id = p_fixture))
       -- WHO the assignment is about. An assignment naming people reaches ONLY
       -- those people: a guardian's children, and a pupil's own record. An
       -- assignment naming nobody is about nobody in particular and is scoped
       -- by school and team alone, which is how a coach reaches their squad —
       -- EXCEPT for the roles that only make sense about a person, which are
       -- refused outright rather than widened (SUBJECT_SCOPED_ROLES).
       --
       -- A LIVE link is verified, started and not ended. Verification is what
       -- turns a claimed relationship into a permission, and 'pending' is the
       -- column default, so nothing reaches a child until somebody at the
       -- school put their name to the link.
       AND CASE WHEN a.role = ANY (ARRAY['guardian', 'selfaccess', 'enquiry']::text[]) THEN
             -- A role that only means anything ABOUT SOMEBODY. It must name a
             -- live person, and then reaches that person and rows with no
             -- person dimension (a fixture: which is how a parent sees when
             -- their child is playing). Name nobody live and it reaches
             -- nothing at all — not the school, not a fixture.
             EXISTS (SELECT 1 FROM assignment_subject g
                      WHERE g.assignment_id = a.id
                        AND g.verification_state = 'verified'
                        AND g.valid_from <= sa_today()
                        AND (g.valid_until IS NULL OR g.valid_until > sa_today()))
             AND (p_person = '00000000-0000-0000-0000-000000000000'::uuid
                  OR (p_person IS NOT NULL AND EXISTS (
                        SELECT 1 FROM assignment_subject g
                         WHERE g.assignment_id = a.id AND g.player_id = p_person
                           AND g.verification_state = 'verified'
                           AND g.valid_from <= sa_today()
                           AND (g.valid_until IS NULL OR g.valid_until > sa_today()))))
           ELSE
             -- Everyone else. Naming nobody means "about nobody in
             -- particular", scoped by school and team, which is how a coach
             -- reaches their squad. The NOT EXISTS counts EVERY row, live or
             -- not: filtering it to live links would mean that revoking the
             -- last link turns a person-scoped assignment into a school-wide
             -- one, so revocation would WIDEN access.
             NOT EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id)
             OR p_person = '00000000-0000-0000-0000-000000000000'::uuid
             OR (p_person IS NOT NULL AND EXISTS (
                   SELECT 1 FROM assignment_subject g
                    WHERE g.assignment_id = a.id AND g.player_id = p_person
                      AND g.verification_state = 'verified'
                      AND g.valid_from <= sa_today()
                      AND (g.valid_until IS NULL OR g.valid_until > sa_today())))
           END
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 2 · The rule: a pupil's own `player` reach, on the row's day ────
-- On a stated day (a nets session, a post). NULL: the fixture's day.
-- PL/pgSQL, so each of its few probes is a cached plan: it is asked per row
-- for every pupil (the policies ask it only of a pupil, below).
CREATE OR REPLACE FUNCTION pupil_side_on(p_capability text, p_school uuid, p_team text, p_person uuid,
                                         p_fixture uuid, p_on date)
RETURNS boolean AS $$
DECLARE
  v_boys uuid[];
  v_has  boolean;
  v_on   boolean;
BEGIN
  -- no live `player` row of his at this side: not a pupil's own reach
  IF NOT EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = app_user_id() AND a.role = 'player' AND a.active
                    AND (a.school_id IS NULL OR a.school_id = p_school)
                    AND (a.team_code IS NULL OR p_team = '*' OR a.team_code = p_team)) THEN
    RETURN true;
  END IF;
  -- his own boy at that school (none: a `player` row with no pupil behind
  -- it, not dated), and whether he was on the side on the row's day
  v_boys := my_own_boy();
  SELECT count(*) > 0, coalesce(bool_or(p_team IN (SELECT side_on(p.id, p_school, coalesce(p_on, side_day(p_fixture))))), false)
    INTO v_has, v_on
    FROM player p
   WHERE p.id = ANY (v_boys) AND p.school_id = p_school;
  IF NOT v_has OR v_on THEN
    RETURN true;
  END IF;
  -- before he joined (or after he left): only another of his assignments
  RETURN app_can_but_player(p_capability, p_school, p_team, p_person, p_fixture);
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- On the fixture's day (no fixture: today): a fixture, and everything hung
-- on one. The same body, with the day the fixture's.
CREATE OR REPLACE FUNCTION pupil_side_on(p_capability text, p_school uuid, p_team text, p_person uuid,
                                         p_fixture uuid)
RETURNS boolean AS $$
DECLARE
  v_boys uuid[];
  v_has  boolean;
  v_on   boolean;
BEGIN
  -- no live `player` row of his at this side: not a pupil's own reach
  IF NOT EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = app_user_id() AND a.role = 'player' AND a.active
                    AND (a.school_id IS NULL OR a.school_id = p_school)
                    AND (a.team_code IS NULL OR p_team = '*' OR a.team_code = p_team)) THEN
    RETURN true;
  END IF;
  -- his own boy at that school (none: a `player` row with no pupil behind
  -- it, not dated), and whether he was on the side on the row's day
  v_boys := my_own_boy();
  SELECT count(*) > 0, coalesce(bool_or(p_team IN (SELECT side_on(p.id, p_school, side_day(p_fixture)))), false)
    INTO v_has, v_on
    FROM player p
   WHERE p.id = ANY (v_boys) AND p.school_id = p_school;
  IF NOT v_has OR v_on THEN
    RETURN true;
  END IF;
  -- before he joined (or after he left): only another of his assignments
  RETURN app_can_but_player(p_capability, p_school, p_team, p_person, p_fixture);
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · side_reach_on(), branch (1) dated ──────────────────────────
-- db/117's, word for word, with the clause on branch (1).
CREATE OR REPLACE FUNCTION side_reach_on(p_capability text, p_school uuid, p_team text, p_fixture uuid, p_on date)
RETURNS boolean AS $$
  SELECT
    (app_can(p_capability, p_school, p_team, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, p_fixture)
     AND pupil_side_on(p_capability, p_school, p_team, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, p_fixture, p_on))
    OR EXISTS (SELECT 1
                 FROM role_assignment a
                 JOIN assignment_subject g ON g.assignment_id = a.id
                 JOIN player p ON p.id = g.player_id
                WHERE a.person_id = app_user_id()
                  AND p.school_id = p_school
                  AND p_team IN (SELECT side_on(p.id, p_school, p_on))
                  AND app_can(p_capability, p_school, p_team, p.id, p_fixture))
    OR EXISTS (SELECT 1
                 FROM player p
                WHERE p.id = ANY (my_own_boy())
                  AND p.school_id = p_school
                  AND p_team IN (SELECT side_on(p.id, p_school, p_on))
                  AND app_can(p_capability, p.school_id, p.team_code, p.id, p_fixture))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 4 · news_plan_reach() on a day, branch (1) dated ───────────────
-- db/117's, word for word, with the clause on both its team.read calls:
-- branch (1), and the boy-on-the-side branch, which asks app_can() about each
-- boy on the side that day and so answers yes for an unnamed `player` row
-- whenever any boy was on it (as it does for staff, who are not dated).
CREATE OR REPLACE FUNCTION news_plan_reach(p_school uuid, p_team text, p_on date) RETURNS boolean AS $$
  SELECT app_can('news.read', p_school, p_team,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     AND ((app_can('team.read', p_school, p_team,
                   'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           AND pupil_side_on('team.read', p_school, p_team,
                             'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, p_on))
          OR EXISTS (SELECT 1 FROM team_membership tm
                       JOIN player p ON p.id = tm.player_id AND p.school_id = p_school
                      WHERE tm.school_id = p_school AND tm.team_code = p_team AND tm.sport = 'cricket'
                        AND tm.joined_on <= p_on AND (tm.left_on IS NULL OR tm.left_on >= p_on)
                        AND (app_can('team.read', p_school, p_team, p.id, '00000000-0000-0000-0000-000000000000'::uuid)
                             AND pupil_side_on('team.read', p_school, p_team, p.id, '00000000-0000-0000-0000-000000000000'::uuid, p_on))))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 5 · The seventeen reads: every app_can() gains its dated twin ──
-- Each policy's text, read from the catalog, with every app_can(args) call
-- replaced by (app_can(args) AND (NOT (SELECT app_reader_is_pupil()) OR
-- pupil_side_on(args[, day]))); nothing else in it moves. The pupil test
-- (db/116's, a reader with a pupil's account or a live `player` or
-- `selfaccess` row) is a sub-select of no column, so it is asked once a
-- query, and a reader who is no pupil asks pupil_side_on() of no row; for
-- every one of them pupil_side_on() would answer true (it is false only for a
-- live `player` row with a boy of his own, and either makes him a pupil).
-- The log (ball_event_read) is read ball by ball, so its twin first asks
-- whether the fixture is one of db/117's my_own_side_fixtures() (once a
-- query): those are the fixtures of his side on their day, which the
-- policy's own fifth branch admits whatever the twin says, so the answer is
-- the plain twin's and only the rest of his rows ask pupil_side_on(). The day: the fixture's (the five-argument form) for the
-- fixture, its satellites, its log, its sheet and its bus; the session's
-- own starts_at for nets, its drills and its attendance. Re-created as it
-- was: permissive, FOR SELECT, TO PUBLIC. The new text is asserted equal to
-- the rewrite, as pg_get_expr() prints it, before the next is touched.
CREATE OR REPLACE FUNCTION pg_temp.m129_dated(q text, p_day text, p_fast boolean) RETURNS text AS $$
DECLARE
  v_out  text := '';
  v_rest text := q;
  i int; j int; k int; depth int; inq boolean; ch text; v_args text; v_fix text; v_fast text;
BEGIN
  LOOP
    i := position('app_can(' IN v_rest);
    EXIT WHEN i = 0;
    -- the call's own closing parenthesis, outside quoted literals, and its
    -- last top-level argument (the fixture)
    j := i + 7; depth := 0; inq := false; k := NULL;
    LOOP
      ch := substr(v_rest, j, 1);
      IF ch = '' THEN
        RAISE EXCEPTION 'db/129: an app_can( call is not closed in %', q;
      ELSIF ch = '''' THEN
        inq := NOT inq;
      ELSIF NOT inq AND ch = '(' THEN
        depth := depth + 1;
      ELSIF NOT inq AND ch = ')' THEN
        depth := depth - 1;
        EXIT WHEN depth = 0;
      ELSIF NOT inq AND ch = ',' AND depth = 1 THEN
        k := j;
      END IF;
      j := j + 1;
    END LOOP;
    v_args := substr(v_rest, i + 8, j - i - 8);
    v_fix := btrim(substr(v_rest, k + 1, j - k - 1));
    v_fast := CASE WHEN p_fast THEN '(' || v_fix || ' = ANY (( SELECT my_own_side_fixtures() AS my_own_side_fixtures)::uuid[])) OR ' ELSE '' END;
    v_out := v_out || substr(v_rest, 1, i - 1)
             || '(app_can(' || v_args || ') AND ((NOT ( SELECT app_reader_is_pupil() AS app_reader_is_pupil)) OR ' || v_fast
             || 'pupil_side_on(' || v_args || coalesce(', ' || p_day, '') || ')))';
    v_rest := substr(v_rest, j + 1);
  END LOOP;
  RETURN v_out || v_rest;
END $$ LANGUAGE plpgsql IMMUTABLE;

DO $policies$
DECLARE
  r record; v_q text; v_new text; v_got text;
  -- the session's day, as pg_get_expr() prints it inside each table's policy
  DAY_DRILL text := '( SELECT sa_date(t.starts_at) AS sa_date' || chr(10)
                 || '   FROM training_session t' || chr(10)
                 || '  WHERE (t.id = training_session_drill.session_id))';
  DAY_ATT   text := '( SELECT sa_date(t.starts_at) AS sa_date' || chr(10)
                 || '   FROM training_session t' || chr(10)
                 || '  WHERE (t.id = training_attendance.session_id))';
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('match',                     'match_read',                     NULL,                 false),
      ('drs_review',                'drs_review_read',                NULL,                 false),
      ('match_broadcast',           'match_broadcast_read',           NULL,                 false),
      ('match_condition_override',  'match_condition_override_read',  NULL,                 false),
      ('match_conditions',          'match_conditions_read',          NULL,                 false),
      ('match_official',            'match_official_read',            NULL,                 false),
      ('match_pitch_report',        'match_pitch_report_read',        NULL,                 false),
      ('match_toss',                'match_toss_read',                NULL,                 false),
      ('match_weather',             'match_weather_read',             NULL,                 false),
      ('match_result_confirmation', 'match_result_confirmation_read', NULL,                 false),
      ('match_result_decision',     'match_result_decision_read',     NULL,                 false),
      ('ball_event',                'ball_event_read',                NULL,                 true),
      ('match_squad',               'match_squad_read',               NULL,                 false),
      ('trip',                      'trip_read',                      NULL,                 false),
      ('training_session',          'training_session_read',          'sa_date(starts_at)', false),
      ('training_session_drill',    'training_session_drill_read',    DAY_DRILL,            false),
      ('training_attendance',       'training_attendance_read',       DAY_ATT,              false))
      AS x(tbl, pol, day, fast)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_q FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tbl) AND p.polname = r.pol;
    CONTINUE WHEN position('pupil_side_on(' IN v_q) > 0;   -- this file's already (the guard checked its md5)
    v_new := pg_temp.m129_dated(v_q, r.day, r.fast);
    EXECUTE format('DROP POLICY %I ON %I', r.pol, r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I AS PERMISSIVE FOR SELECT TO PUBLIC USING (%s)', r.pol, r.tbl, v_new);
    SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_got FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tbl) AND p.polname = r.pol;
    IF v_got IS DISTINCT FROM v_new THEN
      RAISE EXCEPTION 'db/129: %.% reads back as%, not the rewrite%', r.tbl, r.pol, chr(10) || v_got, chr(10) || v_new;
    END IF;
  END LOOP;
END $policies$;


-- ── 6 · Who may call what ──────────────────────────────────────────
-- pupil_side_on(): the application (the policies and the API's my_side ask
-- it). app_can_but_player(): its owner alone.
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['pupil_side_on(text,uuid,text,uuid,uuid,date)', 'pupil_side_on(text,uuid,text,uuid,uuid)',
                           'app_can_but_player(text,uuid,text,uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  GRANT EXECUTE ON FUNCTION pupil_side_on(text,uuid,text,uuid,uuid,date) TO scrbrd_app;
  GRANT EXECUTE ON FUNCTION pupil_side_on(text,uuid,text,uuid,uuid) TO scrbrd_app;
  REVOKE ALL ON FUNCTION app_can_but_player(text,uuid,text,uuid,uuid) FROM scrbrd_app;
END $grants$;


-- ── 7 · Refuse to commit a file that did not do what it says ───────
-- Narrow only: every change is an existing app_can() call ANDed with
-- pupil_side_on() on the same arguments (in the policies, asked of a pupil),
-- the text otherwise identical. That
-- is what is asserted here, object by object, and it is the proof that no
-- reader gains a row (x AND y admits no row x refused). db/99 §106 asserts it
-- again on rows, for every reader it stages.
DO $check$
DECLARE
  r record; v_src text; v_abp text; v_q text; v_f text; v_n int;
  ALLF text := '''ffffffff-ffff-ffff-ffff-ffffffffffff''::uuid';
  ZERO text := '''00000000-0000-0000-0000-000000000000''::uuid';
BEGIN
  -- app_can() untouched; app_can_but_player() is its body bar one line.
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = 'app_can(text,uuid,text,uuid,uuid)'::regprocedure;
  SELECT p.prosrc INTO v_abp FROM pg_proc p
   WHERE p.oid = to_regprocedure('app_can_but_player(text,uuid,text,uuid,uuid)')
     AND p.prosecdef AND p.provolatile = 's' AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'));
  IF md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g')) <> 'f2104665f4ea2207c6d9165b6206785c' THEN
    RAISE EXCEPTION 'db/129: app_can() is not db/128''s';
  END IF;
  IF v_abp IS NULL
     OR (length(v_abp) - length(replace(v_abp, 'AND a.role <> ''player''', ''))) / length('AND a.role <> ''player''') <> 1
     OR replace(v_abp, chr(10) || '       AND a.role <> ''player''', '') IS DISTINCT FROM v_src THEN
    RAISE EXCEPTION 'db/129: app_can_but_player() is not app_can()''s body with the one line added';
  END IF;

  -- pupil_side_on(): stable definers with a pinned path; the two forms one
  -- body, the five-argument one on the fixture's day.
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = to_regprocedure('pupil_side_on(text,uuid,text,uuid,uuid,date)')
     AND p.prosecdef AND p.provolatile = 's' AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'));
  SELECT p.prosrc INTO v_f FROM pg_proc p
   WHERE p.oid = to_regprocedure('pupil_side_on(text,uuid,text,uuid,uuid)')
     AND p.prosecdef AND p.provolatile = 's' AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'));
  IF v_src IS NULL OR v_f IS NULL
     OR replace(v_src, 'coalesce(p_on, side_day(p_fixture))', 'side_day(p_fixture)') IS DISTINCT FROM v_f
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['a.person_id = app_user_id() AND a.role = ''player'' AND a.active',
                                           'v_boys := my_own_boy();',
                                           'WHERE p.id = ANY (v_boys) AND p.school_id = p_school;',
                                           'p_team IN (SELECT side_on(p.id, p_school, coalesce(p_on, side_day(p_fixture))))',
                                           'IF NOT v_has OR v_on THEN',
                                           'RETURN app_can_but_player(p_capability, p_school, p_team, p_person, p_fixture);']) m
                 WHERE position(m IN v_src) = 0) THEN
    RAISE EXCEPTION 'db/129: pupil_side_on() is missing, not a stable definer with a pinned path, or not the rule this file states';
  END IF;

  -- Who may call them.
  FOR r IN SELECT x.sig, x.app FROM (VALUES ('pupil_side_on(text,uuid,text,uuid,uuid,date)', true),
                                            ('pupil_side_on(text,uuid,text,uuid,uuid)', true),
                                            ('app_can_but_player(text,uuid,text,uuid,uuid)', false)) x(sig, app) LOOP
    IF has_function_privilege('public', to_regprocedure(r.sig), 'EXECUTE')
       OR has_function_privilege('scrbrd_app', to_regprocedure(r.sig), 'EXECUTE') IS DISTINCT FROM r.app
       OR EXISTS (SELECT 1 FROM pg_roles o WHERE o.rolname IN ('anon', 'authenticated', 'service_role')
                     AND has_function_privilege(o.oid, to_regprocedure(r.sig), 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/129: % is executable by the wrong roles', r.sig;
    END IF;
  END LOOP;

  -- side_reach_on() and news_plan_reach(…, date): db/117's bodies bar the clause.
  SELECT regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g') INTO v_src FROM pg_proc p
   WHERE p.oid = 'side_reach_on(text,uuid,text,uuid,date)'::regprocedure AND p.prosecdef
     AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'));
  v_q := '(app_can(p_capability, p_school, p_team, ' || ALLF || ', p_fixture) AND pupil_side_on(p_capability, p_school, p_team, '
         || ALLF || ', p_fixture, p_on))';
  IF position(v_q IN coalesce(v_src, '')) = 0
     OR md5(replace(v_src, v_q, 'app_can(p_capability, p_school, p_team, ' || ALLF || ', p_fixture)')) <> 'd06c1fa757b289ed9994c2bb58f40178' THEN
    RAISE EXCEPTION 'db/129: side_reach_on() is not db/117''s with branch (1) dated';
  END IF;
  SELECT regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g') INTO v_src FROM pg_proc p
   WHERE p.oid = 'news_plan_reach(uuid,text,date)'::regprocedure AND p.prosecdef
     AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'));
  v_q := '(app_can(''team.read'', p_school, p_team, ' || ALLF || ', ' || ZERO || ') AND pupil_side_on(''team.read'', p_school, p_team, '
         || ALLF || ', ' || ZERO || ', p_on))';
  v_f := '(app_can(''team.read'', p_school, p_team, p.id, ' || ZERO || ') AND pupil_side_on(''team.read'', p_school, p_team, p.id, '
         || ZERO || ', p_on))';
  IF position(v_q IN coalesce(v_src, '')) = 0 OR position(v_f IN coalesce(v_src, '')) = 0
     OR md5(replace(replace(v_src, '(' || v_q, '(app_can(''team.read'', p_school, p_team, ' || ALLF || ', ' || ZERO || ')'),
                    v_f, 'app_can(''team.read'', p_school, p_team, p.id, ' || ZERO || ')'))
        <> '392bde9e9f1425d7d4bcf0fbfdd894f9' THEN
    RAISE EXCEPTION 'db/129: news_plan_reach(uuid,text,date) is not db/117''s with branch (1) dated';
  END IF;

  -- The seventeen reads: this file's text; each app_can() with its twin
  -- (the rewrite was asserted against pg_get_expr() as each was made).
  FOR r IN SELECT * FROM (VALUES
      ('match', 'match_read', 'f0d18d60b5bcbd933c057db0ae76530f', 2),
      ('drs_review', 'drs_review_read', '351a0dd35af09b7d311a5893eaa43c56', 2),
      ('match_broadcast', 'match_broadcast_read', '351a0dd35af09b7d311a5893eaa43c56', 2),
      ('match_condition_override', 'match_condition_override_read', '351a0dd35af09b7d311a5893eaa43c56', 2),
      ('match_conditions', 'match_conditions_read', '351a0dd35af09b7d311a5893eaa43c56', 2),
      ('match_official', 'match_official_read', '351a0dd35af09b7d311a5893eaa43c56', 2),
      ('match_pitch_report', 'match_pitch_report_read', '351a0dd35af09b7d311a5893eaa43c56', 2),
      ('match_toss', 'match_toss_read', '351a0dd35af09b7d311a5893eaa43c56', 2),
      ('match_weather', 'match_weather_read', '351a0dd35af09b7d311a5893eaa43c56', 2),
      ('match_result_confirmation', 'match_result_confirmation_read', '7ceba2112effad37218ffe65f8f12a23', 2),
      ('match_result_decision', 'match_result_decision_read', '8dc2414b02ca717cdeb048e97d106877', 2),
      ('ball_event', 'ball_event_read', '9bb220903d6f0c5b3d2fdb388d7f655c', 2),
      ('match_squad', 'match_squad_read', '45ed7ab2621be310bf99238a7ce89167', 1),
      ('trip', 'trip_read', '1772c797f0eaa5aeee6b02d0c25490b4', 3),
      ('training_session', 'training_session_read', 'f4c5d4c5003265f52ec18b84d5798d96', 1),
      ('training_session_drill', 'training_session_drill_read', '9f0621d72bea96429fe44d941bd66a5d', 1),
      ('training_attendance', 'training_attendance_read', '59bb90fba84da2df38f72edb5ca8f58a', 1)) AS x(tbl, pol, mine, calls)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_q FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tbl) AND p.polname = r.pol AND p.polcmd = 'r' AND p.polpermissive
       AND p.polroles = '{0}' AND p.polwithcheck IS NULL;
    v_n := (length(coalesce(v_q, '')) - length(replace(coalesce(v_q, ''), '(app_can(', ''))) / length('(app_can(');
    IF v_q IS NULL OR md5(v_q) <> r.mine OR v_n <> r.calls
       OR (length(v_q) - length(replace(v_q, ') AND ((NOT ( SELECT app_reader_is_pupil() AS app_reader_is_pupil)) OR ', '')))
          / length(') AND ((NOT ( SELECT app_reader_is_pupil() AS app_reader_is_pupil)) OR ') <> r.calls
       OR (length(v_q) - length(replace(v_q, 'pupil_side_on(', ''))) / length('pupil_side_on(') <> r.calls
       OR (length(v_q) - length(replace(v_q, 'my_own_side_fixtures()', ''))) / length('my_own_side_fixtures()')
          <> (CASE r.pol WHEN 'ball_event_read' THEN 3 ELSE 0 END)
       OR (length(v_q) - length(replace(v_q, 'app_can(', ''))) / length('app_can(') <> r.calls THEN
      RAISE EXCEPTION 'db/129: %.% is not the read this file wrote: %', r.tbl, r.pol, coalesce(v_q, 'missing');
    END IF;
  END LOOP;

  -- The pad's tables ask no reach helper (AV-D4), this one included.
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polrelid IN (to_regclass('scoring_session'), to_regclass('ball_event_quarantine'), to_regclass('scoring_audit'))
                AND concat(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) ~ 'pupil_side_on\(') THEN
    RAISE EXCEPTION 'db/129: a pad table asks pupil_side_on()';
  END IF;
END $check$;

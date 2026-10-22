-- ══════════════════════════════════════════════════════════════════
--  117 · The dated side (SR-2, SR-4): a family keeps the season of the side
--        a boy was on, and a move voids his seats on the side he left
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/SEASON_ROLLOVER.md, slice S2 (§1.3, §2.10, §3.1
-- step 2a, §8.1's M2 row, §8.2), on Kameel's decisions of 15 October 2026:
-- D1 ("A parent and a pupil do not lose sight of last season's fixtures,
-- scorecards, plans and so on when the boy moves up") and Q2, the newcomer's
-- bound (decided as recommended: a boy who joins a side does not thereby read
-- that side's fixtures from before he joined). It follows db/112 (SR-1: a
-- moved pupil's `player` assignment follows his side). Its proof is db/99
-- §94; the HTTP walk is tools/smoke-player-move.mjs's "dated side" half.
--
-- ── 1 · THE GAP ─────────────────────────────────────────────────────
-- Every reach a family has to a SIDE's rows asked "is this the boy's side
-- NOW": db/106's side_reach() branch (2), my_fixture_ends(), my_sides(),
-- db/100's my_child_fixtures(), db/96's news_plan_reach() (which db/101's
-- team-post rule reuses). Asked the day after a move, every one answers for
-- the new side. So on the day Hilton moves a boy from U14A to U15A his mother
-- loses U14A's whole season — the fixtures she watched, their scorecards,
-- buses, nets and posts — and gains U15A's whole past, which she never had a
-- child in.
--
-- ── 2 · THE RULE: his side on the row's day ────────────────────────
--   side_on(player, school, day)   the sides a boy was on at a school on a
--       day: his team_membership rows (db/08) there with joined_on <= day and
--       (left_on IS NULL or left_on >= day). "Now" is a day like any other:
--       for today or a later day only the open row matches, so one predicate
--       gives the current side for rows ahead and the then-side for rows
--       behind. A day with two rows (a move and its undoing, the same day)
--       answers both. A day before his first row answers nothing (Q2).
--   side_day(fixture)              a fixture's day: its starts_at on the
--       Johannesburg calendar (sa_date()); the zeros fixture ("no fixture"),
--       NULL, or an id that is no fixture is today (sa_today()), which is the
--       open row, which is the current side: every caller that asked with no
--       fixture gets exactly the answer it had.
--   sa_date(timestamptz)           the one spelling of "the day it is where
--       the cricket is played", as sa_today() spells today.
-- The row's day, per table (§1.3): a fixture, its satellites, its log and its
-- buses by the fixture's day; a training session by its own starts_at; a team
-- post by its published_at (a draft or a post with no time: today); a plan by
-- its fixture's day. Nothing about the boy himself (a consent, a link, a
-- contact, an injury, his file) is dated: none of it is about a side.
--
-- ── 3 · WHAT CHANGES, helper by helper (§2.10) ─────────────────────
--   side_reach(cap, school, team, fixture)   branch (2) asks side_on() on
--       side_day(fixture) instead of player.team_code. Now the delegate of
--   side_reach_on(cap, school, team, fixture, day)   the same question on a
--       stated day, for a row whose day is not a fixture's (a nets session).
--   fixture_end_reach(), fixture_reach()     not replaced: they ask
--       side_reach(), so they are dated through it; the sheet branches (3),
--       (4) are the row's own fact and unchanged (§2.10).
--   my_fixture_ends(cap)                     the side arms (2), home and away,
--       join the boy's membership rows on the fixture's day; the sheet arms
--       (3) and (4) are word for word.
--   my_sides(cap)                            returns (school_id, team_code,
--       joined_on, left_on) — every membership row of the boys the caller's
--       links name, app_can() asked at each row's (school, team, boy) with no
--       fixture, as before; DROPPED and created again (its result type
--       changes), with training_session_read, in this one transaction.
--   training_session_read                    branch (1) word for word; the
--       named branch probes my_sides() on the session's own day.
--   my_child_fixtures() (db/100)             the same dated side arms; its
--       filters (a.active, a verified link) and its sheet arms word for word.
--       Re-expressed HERE, in the same transaction, so db/99 §83 (agree)
--       holds: the ball log a guardian reads is the fixtures match_read gives.
--   news_plan_reach(school, team, day)       db/96's side question on a day;
--       news_plan_reach(school, team) is now that question asked today (its
--       answer unchanged).
--   news_post_plan_side, news_post_team_side (db/96, db/101)   ALTERed in
--       place: the side on the post's day (news_post_day()); their author and
--       sheet clauses word for word.
--   news_team_notice_reach(), news_notice_reach() (db/101), plan_author_name()
--       (db/103)   the same dated call, every other line theirs. So a post's
--       notice, the report button (db/101's notification_report(), which asks
--       these two) and the plan's byline answer as the post's read does.
--   trip_read, the eight satellites, match_read, fixture_publication_read,
--   trip_fixture_driver_only(): not touched; dated through the helpers.
--   lift_my_sides() (db/70): not touched (§2.10): a lift is on a fixture
--       ahead, and the seats on the side he left are voided by the move (§5).
--
-- ── 4 · THE BOY HIMSELF: branch (5) ─────────────────────────────────
-- D1 names the pupil as well as the parent. The design (§2.2) gives the moved
-- pupil his old side's season "through his selfaccess link naming him
-- (branch 2)"; but `selfaccess` holds none of fixture.read, team.read,
-- transport.read or news.read (packages/policy/src/roles.mjs), and his
-- `player` assignment now follows him to the new side (db/112), so branch (2)
-- and branch (1) give him nothing of the old side the day after the move.
-- This file draws the reach D1 decided in the shape db/106 (e) drew for the
-- boy playing up (branch (4)), with the sheet replaced by the dated side:
--   (5) the reader IS the boy (my_own_boy(): his account's player, or his
--       live verified self-access link), the row's side is his side on the
--       row's day at his school (side_on()), and he holds the capability
--       about himself at his OWN side (app_can() at player.team_code: his
--       `player` assignment, kept there by db/112).
-- Nothing is added to `selfaccess` or to `player`; a team-mate (whom his
-- unnamed `player` assignment reaches) is never a candidate; for a boy who
-- has not moved, (5) is a subset of (1). It reaches match_read and the
-- satellites (my_fixture_ends()), the buses (trip_read through the same),
-- the publication row (side_reach()), the nets (my_sides()), and the ball
-- log (ball_event_read gains a fifth branch, my_own_side_fixtures(), db/112's
-- my_own_sheet_fixtures() shape). And the posts and plans (Kameel, 22
-- October 2026: "yes", the narrowest door): db/12's news_post_read is a
-- PERMISSIVE read under news.read at the post's side, which the moved boy
-- holds only at his new side, so one more permissive read,
-- news_post_read_old_side, gives him a sent team post or plan whose side and
-- day fall inside a side he has LEFT (a closed membership row), asked through
-- news_own_old_side(): the reader is the boy, the row is closed, and he holds
-- news.read and team.read about himself at his own side now. The two
-- restrictive side rules, the post's notice and the byline admit the same.
-- A team-mate, his family (who read by the side rule, dated here) and a boy
-- who joined the side later gain nothing from it.
--
-- ── 4b · THE IMPORT DATES A NEW BOY'S FIRST SIDE ─────────────────────
-- Kameel, 22 October 2026: the players import dates a boy's first membership
-- from the season's start unless the file gives a date. import_joined_on()
-- gives the import the day it sets as app.effective_on for each row (db/08's
-- trigger reads it): the file's joined_on (never a day to come), else the
-- school season's start for a boy new to the books, else (a boy moved by the
-- file) today, as before. The add route is unchanged.
--
-- ── 4c · THE EARLIEST DAY A MEMBERSHIP MAY BEGIN ────────────────────
-- A backdated move (the route's effectiveOn) and an import's joined_on could
-- name any past day. Kameel, 22 October 2026: "no earlier than this season's
-- start". One guard, shared by every door:
--   membership_joined_floor()    the floor: the school season's start
--       (season_for(today), db/08: 1 January), the one line that holds it.
--   membership_floor_refusal(joined, floor)   the rule: a membership may not
--       begin before the floor; the refusal names both days.
--   team_membership_floor        BEFORE INSERT on team_membership: a
--       membership row a PERSON's write opened (app.user_id set: the move
--       route, the import, the add route) raises check_violation with that
--       refusal. The move route answers 422 invalid_move with it; the import
--       refuses the row on its line. The owner's own writes with nobody
--       signed in (a seed's dated rows, a backfill) are not a person's
--       choice of day, and are not refused.
--
-- ── 5 · SR-4: a move voids his seats on the side he left ───────────
-- §3.1 step 2a: "seats on fixtures of the side he has left dated after
-- effective_on: voided, the asker told, as player_leave() does … inside the
-- move's transaction". player_leave() is not built (ACCOUNT_LIFECYCLE slice
-- 3/4); its void is db/70's (lift_links_settle(), lift_self_settle(), as
-- db/76 re-emitted them): the seat 'void' with ended_at, the driver told "a
-- seat was withdrawn" (never why), the lone-passenger fallback asked. This
-- file writes that path as an AFTER UPDATE OF team_code, school_id trigger on
-- player, a sibling of db/08's history trigger and db/112's carry:
--   player_move_voids_seats()   for each live seat (requested, invited,
--       confirmed; not boarded — db/76: a boy in the car keeps his seat) of
--       the boy on a lift to a fixture at his OLD side's end (lift_seat's own
--       school and team), dated AFTER the move's effective day (the trigger
--       reads app.effective_on as db/08's does; on the day itself he was on
--       both sides, §1.3) and still to come (a backdated move does not
--       rewrite a lift already driven), which he no longer reaches: not his new side's
--       end, and not on that end's sheet (a boy named to play still goes).
--       Each: 'void', ended_at now(), ended_by the mover; the driver told as
--       db/70 tells him; the seat's asker (lift_notify_family(), db/76: the
--       guardian whose link the seat names, or the boy for his own seat) told
--       his seat is withdrawn because he is no longer on that side; the
--       lone-passenger rule asked of the offer.
-- A move to no side (player_leave(), when it lands) or to another school runs
-- the same path. The CSV import, which writes player.team_code too, runs it
-- as well: the trigger is the one door, as the history's is.
--
-- ── 6 · COST (§2.10, refused over twice db/106's 34 ms) ─────────────
-- Measured on the forty-fixture season db/106 measured (five Hilton sides,
-- 204 fixtures a quarter of them away, 200 buses, 100 nets), the guardian's
-- elder boy holding three membership rows (two moves), median of 15 after
-- two warm-ups, ms execution, EXPLAIN (ANALYZE) of SELECT * as the reader
-- under scrbrd_app; db/106's definitions (with db/100's and db/112's) put
-- back in a rolled-back transaction on the same rows, same database, on
-- 2026-10-21 (a shared machine: two runs each, both shown):
--                                   db/106          this file
--     match, guardian of two      13.5  11.1      16.9  16.4
--     match, 1XI coach            14.5  14.1      19.0  17.9
--     match, director             18.2  14.0      14.2  14.1
--     match, pupil                11.4  11.1      15.6  16.0
--     trip,  guardian of two      41.6  37.6      42.4  42.8
--     trip,  director             89.2  74.7      67.6  71.8
--     toss,  guardian of two       4.1   3.4       8.6   8.6
--     training, guardian of two    3.8   3.8       6.3   6.1
--     log,   guardian of two       7.2   6.9       8.6   9.9
-- The guardian of two's fixture list is 1.3-1.5x db/106's here and a
-- quarter of §2.10's ceiling (twice db/106's recorded 34 ms).
-- The set helpers join team_membership in place (as an index probe on
-- (player_id, school_id, joined_on), added here) rather than calling the
-- definer side_on() per fixture: a definer SQL function called inside
-- another is started afresh each call (db/106's header, THE SHAPE). db/99
-- §94 (literal) holds them equal to side_on() spelled out, for every person.
--
-- WHO GAINS, WHO LOSES (db/99 §94 proves each)
--   A guardian, after her son's move: his old side's fixtures, satellites,
--     log, buses, nets, posts and plans dated within his time on it (D1); his
--     new side's from the day he joined (and not before: Q2). A boy who has
--     not moved: exactly as before, provided his first membership row began
--     before the rows (see "EXISTING ROWS").
--   The moved pupil himself: his old side's season by branch (5), and its
--     posts and plans dated within his time on it (§4).
--   A boy imported with no date: his first side from the season's start.
--   Every reader whose assignments name nobody (staff, a pupil through
--     `player`, a spectator, the office, a driver): unchanged; branch (1) does
--     not read the membership.
--   A family with a seat on a lift to a fixture of the side the boy left,
--     after the move's day: the seat voided and the asker told.
--
-- EXISTING ROWS. No row is written by this file. But a membership row's
-- joined_on is the day the trigger saw the boy's FIRST side, and for a boy
-- typed in or imported after his season began that is the day of the typing
-- (db/98 dates the pilot's to 15 January through app.effective_on; the CSV
-- import and the add route do not). Under Q2 such a boy's family no longer
-- reaches, by the side, his side's fixtures dated before that day; the sheet
-- branch still gives every fixture he is named on. The office's remedy is
-- to type the boy in dated (the design gives no edit door to team_membership,
-- Q7); the lead's is a dated first membership on import (reported).
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   + one index on team_membership (player_id, school_id, joined_on DESC)
--   + sa_date(), side_on(), side_day(), side_reach_on(), news_post_day(),
--     news_plan_reach(uuid, text, date), my_own_side_fixtures(),
--     news_own_old_side(), import_joined_on(), membership_joined_floor(),
--     membership_floor_refusal(), team_membership_floor() and its trigger
--     on team_membership (§4c),
--     player_move_voids_seats() and its trigger on player
--   + news_post_read_old_side: one permissive read on news_post
--   ~ CREATE OR REPLACE in place, signatures, owners and grants kept:
--     side_reach(), my_fixture_ends(), my_child_fixtures(),
--     news_plan_reach(uuid, text), news_team_notice_reach(),
--     news_notice_reach(), plan_author_name()
--   ~ my_sides(text): dropped and created with its new result, and
--     training_session_read dropped and created over it
--   ~ ball_event_read: dropped and created with the fifth branch (guarded:
--     it must be db/112's)
--   ~ news_post_plan_side, news_post_team_side: ALTER POLICY in place
-- No table, column or row; no capability; no write policy. db/01, db/09,
-- app_can(), db/08's trigger, db/112's carry and lift_my_sides() are not
-- touched. All in the paste's one transaction; a second paste changes
-- nothing.

-- ── 0 · What it needs ──────────────────────────────────────────────
DO $needs$
BEGIN
  IF to_regprocedure('side_reach(text,uuid,text,uuid)') IS NULL
     OR to_regprocedure('my_fixture_ends(text)') IS NULL
     OR to_regprocedure('my_sides(text)') IS NULL
     OR to_regprocedure('my_own_boy()') IS NULL THEN
    RAISE EXCEPTION 'db/117: db/106''s reach helpers are missing; apply db/106 first';
  END IF;
  IF to_regprocedure('my_child_fixtures()') IS NULL OR to_regprocedure('my_own_sheet_fixtures()') IS NULL
     OR to_regprocedure('player_assignment_follows_side()') IS NULL THEN
    RAISE EXCEPTION 'db/117: db/100 or db/112 is missing; apply them first';
  END IF;
  IF to_regprocedure('news_plan_reach(uuid,text)') IS NULL OR to_regprocedure('news_sheet_reach(uuid,uuid,text)') IS NULL
     OR to_regprocedure('news_team_notice_reach(uuid)') IS NULL OR to_regprocedure('plan_author_name(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'news_post'
                       AND policyname = 'news_post_team_side') THEN
    RAISE EXCEPTION 'db/117: db/96, db/101 or db/103 is missing; apply them first';
  END IF;
  IF to_regprocedure('lift_notify_family(uuid,uuid,text,text)') IS NULL OR to_regprocedure('lift_lone_fallback(uuid)') IS NULL
     OR to_regprocedure('lift_offer_words(uuid)') IS NULL OR to_regprocedure('lift_notify(uuid,uuid,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'db/117: db/70''s or db/76''s lift doors are missing';
  END IF;
  IF to_regprocedure('sa_today()') IS NULL OR to_regclass('team_membership') IS NULL THEN
    RAISE EXCEPTION 'db/117: db/08''s sa_today() or team_membership is missing';
  END IF;
END $needs$;


-- ── 1 · The index the dated probe uses ─────────────────────────────
CREATE INDEX IF NOT EXISTS team_membership_player_day ON team_membership (player_id, school_id, joined_on DESC);


-- ── 2 · The question: his side on that day ─────────────────────────
-- The day it is where the cricket is played, of a moment (sa_today()'s
-- spelling). Immutable, as timezone() is, so it inlines into a join.
CREATE OR REPLACE FUNCTION sa_date(p_at timestamptz) RETURNS date AS $$
  SELECT (p_at AT TIME ZONE 'Africa/Johannesburg')::date
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- The sides a boy was on at a school on a day. Read as the owner: the
-- membership rows are ones the caller's own policy may not show him.
CREATE OR REPLACE FUNCTION side_on(p_player uuid, p_school uuid, p_on date) RETURNS SETOF text AS $$
  SELECT m.team_code
    FROM team_membership m
   WHERE m.player_id = p_player AND m.school_id = p_school AND m.sport = 'cricket'
     AND m.joined_on <= p_on
     AND (m.left_on IS NULL OR m.left_on >= p_on)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A fixture's day; no fixture (the zeros id, NULL, an id that is no fixture)
-- is today.
CREATE OR REPLACE FUNCTION side_day(p_fixture uuid) RETURNS date AS $$
  SELECT coalesce((SELECT sa_date(m.starts_at) FROM match m
                    WHERE m.id = p_fixture AND p_fixture <> '00000000-0000-0000-0000-000000000000'::uuid),
                  sa_today())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · side_reach(), dated ────────────────────────────────────────
-- Is the caller at this side, for this capability, on this day? (1) an
-- assignment naming nobody, as db/106; (2) a named assignment naming a boy
-- who was on this side on that day, asked about that boy; (5) the boy
-- himself, his side on that day, asked about himself at his own side
-- (header §4).
CREATE OR REPLACE FUNCTION side_reach_on(p_capability text, p_school uuid, p_team text, p_fixture uuid, p_on date)
RETURNS boolean AS $$
  SELECT
    app_can(p_capability, p_school, p_team, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, p_fixture)
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

-- db/106's question, on the fixture's day (no fixture: today). Its signature,
-- owner rights and grants are db/106's.
CREATE OR REPLACE FUNCTION side_reach(p_capability text, p_school uuid, p_team text, p_fixture uuid)
RETURNS boolean AS $$
  SELECT side_reach_on(p_capability, p_school, p_team, p_fixture, side_day(p_fixture))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 4 · The set-once helpers, dated ────────────────────────────────
-- The fixture ends the caller reaches through a boy his own links name, or
-- as the boy himself. The side arms join the boy's membership rows on the
-- fixture's day (side_on(), in place); the sheet arms are db/106's.
CREATE OR REPLACE FUNCTION my_fixture_ends(p_capability text)
RETURNS TABLE (match_id uuid, school_id uuid, team_code text) AS $$
  SELECT DISTINCT x.match_id, x.school_id, x.team_code
    FROM (-- (2) home: a boy his links name, on the home side on the fixture's day
          SELECT m.id, m.school_id, m.team_code
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN team_membership tm ON tm.player_id = p.id AND tm.school_id = p.school_id AND tm.sport = 'cricket'
            JOIN match m ON m.school_id = tm.school_id AND m.team_code = tm.team_code
                        AND tm.joined_on <= sa_date(m.starts_at)
                        AND (tm.left_on IS NULL OR tm.left_on >= sa_date(m.starts_at))
           WHERE a.person_id = app_user_id()
             AND app_can(p_capability, m.school_id, m.team_code, p.id, m.id)
          UNION ALL
          -- (3) home: a boy his links name, on the home sheet, not withdrawn
          SELECT m.id, m.school_id, m.team_code
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN match m ON m.school_id = p.school_id
           WHERE a.person_id = app_user_id()
             AND EXISTS (SELECT 1 FROM match_squad s
                          WHERE s.match_id = m.id AND s.player_id = p.id
                            AND s.side = 'home' AND NOT s.withdrawn)
             AND app_can(p_capability, m.school_id, m.team_code, p.id, m.id)
          UNION ALL
          -- (2) away
          SELECT m.id, m.away_school_id, m.away_team_code
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN team_membership tm ON tm.player_id = p.id AND tm.school_id = p.school_id AND tm.sport = 'cricket'
            JOIN match m ON m.away_school_id = tm.school_id AND m.away_team_code = tm.team_code
                        AND tm.joined_on <= sa_date(m.starts_at)
                        AND (tm.left_on IS NULL OR tm.left_on >= sa_date(m.starts_at))
           WHERE a.person_id = app_user_id()
             AND app_can(p_capability, m.away_school_id, m.away_team_code, p.id, m.id)
          UNION ALL
          -- (3) away
          SELECT m.id, m.away_school_id, m.away_team_code
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN match m ON m.away_school_id = p.school_id
           WHERE a.person_id = app_user_id()
             AND EXISTS (SELECT 1 FROM match_squad s
                          WHERE s.match_id = m.id AND s.player_id = p.id
                            AND s.side = 'away' AND NOT s.withdrawn)
             AND app_can(p_capability, m.away_school_id, m.away_team_code, p.id, m.id)
          UNION ALL
          -- (4) the boy himself on this end's sheet, asked at his own side (db/106 (e))
          SELECT m.id, CASE WHEN s.side = 'home' THEN m.school_id ELSE m.away_school_id END,
                       CASE WHEN s.side = 'home' THEN m.team_code ELSE m.away_team_code END
            FROM player p
            JOIN match_squad s ON s.player_id = p.id AND NOT s.withdrawn
            JOIN match m ON m.id = s.match_id
                        AND p.school_id = CASE WHEN s.side = 'home' THEN m.school_id ELSE m.away_school_id END
           WHERE p.id = ANY (my_own_boy())
             AND app_can(p_capability, p.school_id, p.team_code, p.id, m.id)
          UNION ALL
          -- (5) the boy himself, his side on the fixture's day, at either end,
          --     asked at his own side (header §4)
          SELECT m.id, tm.school_id, tm.team_code
            FROM player p
            JOIN team_membership tm ON tm.player_id = p.id AND tm.school_id = p.school_id AND tm.sport = 'cricket'
            JOIN match m ON ((m.school_id = tm.school_id AND m.team_code = tm.team_code)
                          OR (m.away_school_id = tm.school_id AND m.away_team_code = tm.team_code))
                        AND tm.joined_on <= sa_date(m.starts_at)
                        AND (tm.left_on IS NULL OR tm.left_on >= sa_date(m.starts_at))
           WHERE p.id = ANY (my_own_boy())
             AND app_can(p_capability, p.school_id, p.team_code, p.id, m.id)) x(match_id, school_id, team_code)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The sides the caller reaches through a boy his own links name, or as the
-- boy himself, with the span of days each was his: every membership row,
-- asked with no fixture. A policy over a dated row probes the span.
DROP POLICY IF EXISTS training_session_read ON training_session;
DROP FUNCTION IF EXISTS my_sides(text);
CREATE FUNCTION my_sides(p_capability text)
RETURNS TABLE (school_id uuid, team_code text, joined_on date, left_on date) AS $$
  SELECT DISTINCT x.school_id, x.team_code, x.joined_on, x.left_on
    FROM (SELECT tm.school_id, tm.team_code, tm.joined_on, tm.left_on
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN team_membership tm ON tm.player_id = p.id AND tm.school_id = p.school_id AND tm.sport = 'cricket'
           WHERE a.person_id = app_user_id()
             AND app_can(p_capability, tm.school_id, tm.team_code, p.id, '00000000-0000-0000-0000-000000000000'::uuid)
          UNION ALL
          -- (5) the boy himself, asked at his own side
          SELECT tm.school_id, tm.team_code, tm.joined_on, tm.left_on
            FROM player p
            JOIN team_membership tm ON tm.player_id = p.id AND tm.school_id = p.school_id AND tm.sport = 'cricket'
           WHERE p.id = ANY (my_own_boy())
             AND app_can(p_capability, p.school_id, p.team_code, p.id, '00000000-0000-0000-0000-000000000000'::uuid)) x
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Training: the side's sessions, the named branch on the session's own day.
CREATE POLICY training_session_read ON training_session
  FOR SELECT USING (
    app_can('team.read', training_session.school_id, training_session.team_code,
            'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
    OR EXISTS (SELECT 1 FROM my_sides('team.read') s
                WHERE s.school_id = training_session.school_id AND s.team_code = training_session.team_code
                  AND s.joined_on <= sa_date(training_session.starts_at)
                  AND (s.left_on IS NULL OR s.left_on >= sa_date(training_session.starts_at))));

-- db/100's guardian helper, dated: the side arms on the fixture's day; its
-- filters and its sheet arms word for word.
CREATE OR REPLACE FUNCTION my_child_fixtures() RETURNS uuid[] AS $$
  SELECT coalesce(array_agg(DISTINCT x.id), '{}'::uuid[])
    FROM (SELECT m.id
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN match m ON m.school_id = p.school_id
           WHERE a.person_id = app_user_id() AND a.active
             AND g.verification_state = 'verified'
             AND (EXISTS (SELECT 1 FROM team_membership tm
                           WHERE tm.player_id = p.id AND tm.school_id = m.school_id AND tm.sport = 'cricket'
                             AND tm.team_code = m.team_code
                             AND tm.joined_on <= sa_date(m.starts_at)
                             AND (tm.left_on IS NULL OR tm.left_on >= sa_date(m.starts_at)))
                  OR EXISTS (SELECT 1 FROM match_squad s
                              WHERE s.match_id = m.id AND s.player_id = p.id
                                AND s.side = 'home' AND NOT s.withdrawn))
             AND app_can('fixture.read', m.school_id, m.team_code, p.id, m.id)
          UNION ALL
          SELECT m.id
            FROM role_assignment a
            JOIN assignment_subject g ON g.assignment_id = a.id
            JOIN player p ON p.id = g.player_id
            JOIN match m ON m.away_school_id = p.school_id
           WHERE a.person_id = app_user_id() AND a.active
             AND g.verification_state = 'verified'
             AND (EXISTS (SELECT 1 FROM team_membership tm
                           WHERE tm.player_id = p.id AND tm.school_id = m.away_school_id AND tm.sport = 'cricket'
                             AND tm.team_code = m.away_team_code
                             AND tm.joined_on <= sa_date(m.starts_at)
                             AND (tm.left_on IS NULL OR tm.left_on >= sa_date(m.starts_at)))
                  OR EXISTS (SELECT 1 FROM match_squad s
                              WHERE s.match_id = m.id AND s.player_id = p.id
                                AND s.side = 'away' AND NOT s.withdrawn))
             AND app_can('fixture.read', m.away_school_id, m.away_team_code, p.id, m.id)) x
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- (5) for the log: the fixtures of the boy's side on their day, at either
-- end, the reader being the boy and asked at his own side. db/112's
-- my_own_sheet_fixtures() shape.
CREATE OR REPLACE FUNCTION my_own_side_fixtures() RETURNS uuid[] AS $$
  SELECT coalesce(array_agg(DISTINCT m.id), '{}'::uuid[])
    FROM player p
    JOIN team_membership tm ON tm.player_id = p.id AND tm.school_id = p.school_id AND tm.sport = 'cricket'
    JOIN match m ON ((m.school_id = tm.school_id AND m.team_code = tm.team_code)
                  OR (m.away_school_id = tm.school_id AND m.away_team_code = tm.team_code))
                AND tm.joined_on <= sa_date(m.starts_at)
                AND (tm.left_on IS NULL OR tm.left_on >= sa_date(m.starts_at))
   WHERE p.id = ANY (my_own_boy())
     AND app_can('fixture.read', p.school_id, p.team_code, p.id, m.id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ball_event_read must be db/112's (or already this file's).
DO $guard$
DECLARE q text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO q FROM pg_policy p
   WHERE p.polrelid = 'ball_event'::regclass AND p.polname = 'ball_event_read';
  IF position('my_own_side_fixtures()' IN coalesce(q, '')) = 0
     AND q IS DISTINCT FROM
       '(app_can(''fixture.read''::text, school_id, match_team(match_id), NULL::uuid, match_id) OR (EXISTS ( SELECT 1' || chr(10)
    || '   FROM match m' || chr(10)
    || '  WHERE ((m.id = ball_event.match_id) AND (m.away_school_id IS NOT NULL) AND app_can(''fixture.read''::text, m.away_school_id, m.away_team_code, NULL::uuid, ball_event.match_id)))) OR (match_id = ANY (( SELECT my_child_fixtures() AS my_child_fixtures)::uuid[])) OR (match_id = ANY (( SELECT my_own_sheet_fixtures() AS my_own_sheet_fixtures)::uuid[])))' THEN
    RAISE EXCEPTION 'db/117: ball_event_read is not db/112''s any more; add the dated branch to the version now in place: %', coalesce(q, 'missing');
  END IF;
END $guard$;

DROP POLICY IF EXISTS ball_event_read ON ball_event;
-- db/112's four branches word for word, and the boy himself on his side that day.
CREATE POLICY ball_event_read ON ball_event
  FOR SELECT USING (
    app_can('fixture.read', ball_event.school_id, match_team(ball_event.match_id), NULL, ball_event.match_id)
    OR EXISTS (SELECT 1 FROM match m
                WHERE m.id = ball_event.match_id
                  AND m.away_school_id IS NOT NULL
                  AND app_can('fixture.read', m.away_school_id, m.away_team_code, NULL, ball_event.match_id))
    OR ball_event.match_id = ANY ((SELECT my_child_fixtures())::uuid[])
    OR ball_event.match_id = ANY ((SELECT my_own_sheet_fixtures())::uuid[])
    OR ball_event.match_id = ANY ((SELECT my_own_side_fixtures())::uuid[])
  );


-- ── 5 · Posts and plans: the side on the post's day ────────────────
-- A post's day: a plan's is its fixture's; any other post's is the day it
-- was published; a draft (no time yet) is today.
CREATE OR REPLACE FUNCTION news_post_day(p_kind text, p_fixture uuid, p_published timestamptz) RETURNS date AS $$
  SELECT CASE WHEN p_kind = 'plan' AND p_fixture IS NOT NULL THEN side_day(p_fixture)
              ELSE coalesce(sa_date(p_published), sa_today()) END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/96's side question on a day: news.read at the side, AND team.read
-- about the side — an assignment that does not depend on whom a row is
-- about, or a live link to a boy who was on the side on that day.
CREATE OR REPLACE FUNCTION news_plan_reach(p_school uuid, p_team text, p_on date) RETURNS boolean AS $$
  SELECT app_can('news.read', p_school, p_team,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     AND (app_can('team.read', p_school, p_team,
                  'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          OR EXISTS (SELECT 1 FROM team_membership tm
                       JOIN player p ON p.id = tm.player_id AND p.school_id = p_school
                      WHERE tm.school_id = p_school AND tm.team_code = p_team AND tm.sport = 'cricket'
                        AND tm.joined_on <= p_on AND (tm.left_on IS NULL OR tm.left_on >= p_on)
                        AND app_can('team.read', p_school, p_team, p.id, '00000000-0000-0000-0000-000000000000'::uuid)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/96's two-argument question is that question asked today: its answer for
-- every caller is unchanged. Signature, owner rights and grants are db/96's.
CREATE OR REPLACE FUNCTION news_plan_reach(p_school uuid, p_team text) RETURNS boolean AS $$
  SELECT news_plan_reach(p_school, p_team, sa_today())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The moved boy's own old side (Kameel, 22 October 2026): the reader IS the
-- boy (my_own_boy()), the side was his on that day by a CLOSED membership row
-- at his school (a side he has left; his open row is today's rules'), and he
-- holds news.read and team.read about himself at his OWN side now (his
-- `player` assignment, kept there by db/112). Nobody else is ever a
-- candidate: a team-mate, his family (who read by news_plan_reach()) and a
-- boy who joined the side later each fail the first or second test.
CREATE OR REPLACE FUNCTION news_own_old_side(p_school uuid, p_team text, p_on date) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM player p
      JOIN team_membership tm ON tm.player_id = p.id AND tm.school_id = p.school_id AND tm.sport = 'cricket'
     WHERE p.id = ANY (my_own_boy())
       AND p.school_id = p_school
       AND tm.team_code = p_team
       AND tm.left_on IS NOT NULL
       AND tm.joined_on <= p_on AND tm.left_on >= p_on
       AND app_can('news.read', p.school_id, p.team_code, p.id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND app_can('team.read', p.school_id, p.team_code, p.id, '00000000-0000-0000-0000-000000000000'::uuid))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/101's, with the post's day. Every other line is db/101's.
CREATE OR REPLACE FUNCTION news_team_notice_reach(p_post uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT CASE WHEN n.scope <> 'team' THEN true
                               WHEN n.author_id = app_user_id() THEN true
                               WHEN news_plan_reach(n.school_id, n.team_code, news_post_day(n.kind, n.fixture_id, n.published_at)) THEN true
                               WHEN news_own_old_side(n.school_id, n.team_code, news_post_day(n.kind, n.fixture_id, n.published_at)) THEN true
                               WHEN n.kind = 'plan' THEN news_sheet_reach(n.fixture_id, n.school_id, n.team_code)
                               ELSE false END
                     FROM news_post n WHERE n.id = p_post), true)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION news_notice_reach(p_post uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT CASE WHEN n.kind <> 'plan' THEN true
                               WHEN n.author_id = app_user_id() THEN true
                               WHEN news_plan_reach(n.school_id, n.team_code, news_post_day(n.kind, n.fixture_id, n.published_at)) THEN true
                               WHEN news_own_old_side(n.school_id, n.team_code, news_post_day(n.kind, n.fixture_id, n.published_at)) THEN true
                               ELSE news_sheet_reach(n.fixture_id, n.school_id, n.team_code) END
                     FROM news_post n WHERE n.id = p_post), true)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/103's byline, asked as the policies now ask. Every other line is db/103's.
CREATE OR REPLACE FUNCTION plan_author_name(p_post uuid) RETURNS text AS $$
  SELECT u.name
    FROM news_post n
    JOIN app_user u ON u.id = n.author_id
   WHERE n.id = p_post
     AND app_user_id() IS NOT NULL
     -- a plan, and live: sent, and not withdrawn (withdrawing sets it back to null)
     AND n.kind = 'plan'
     AND n.scope = 'team'
     AND n.published_at IS NOT NULL AND n.published_at <= now()
     -- and this reader reads it: db/12's, db/96's, db/101's and db/117's policies, as they ask it
     AND (n.author_id = app_user_id()
          OR news_plan_reach(n.school_id, n.team_code, news_post_day(n.kind, n.fixture_id, n.published_at))
          OR news_own_old_side(n.school_id, n.team_code, news_post_day(n.kind, n.fixture_id, n.published_at))
          OR news_sheet_reach(n.fixture_id, n.school_id, n.team_code))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

ALTER POLICY news_post_plan_side ON news_post
  USING (kind <> 'plan' OR author_id = app_user_id()
         OR news_plan_reach(school_id, team_code, news_post_day(kind, fixture_id, published_at))
         OR news_own_old_side(school_id, team_code, news_post_day(kind, fixture_id, published_at))
         OR news_sheet_reach(fixture_id, school_id, team_code));
ALTER POLICY news_post_team_side ON news_post
  USING (scope <> 'team' OR author_id = app_user_id()
         OR news_plan_reach(school_id, team_code, news_post_day(kind, fixture_id, published_at))
         OR news_own_old_side(school_id, team_code, news_post_day(kind, fixture_id, published_at))
         OR (kind = 'plan' AND news_sheet_reach(fixture_id, school_id, team_code)));

-- The one permissive read the moved boy's old posts need: db/12's
-- news_post_read asks news.read AT THE POST'S SIDE, which he holds only at his
-- new one. A sent team post (a plan is one), dated inside a side he has left.
DROP POLICY IF EXISTS news_post_read_old_side ON news_post;
CREATE POLICY news_post_read_old_side ON news_post
  FOR SELECT USING (
    scope = 'team' AND published_at IS NOT NULL AND published_at <= now()
    AND news_own_old_side(school_id, team_code, news_post_day(kind, fixture_id, published_at)));


-- ── 5b · The import dates a new boy's first side (Kameel, 22 Oct 2026) ──
-- The players import (services/api/io/import-api.mjs) asks this before each
-- row's write and sets app.effective_on to its answer, which db/08's trigger
-- reads for the membership the row opens: the file's joined_on when it gives
-- one (never a day still to come); else, for a boy NEW to the books, the
-- school season's start (season_for(), db/08), so a squad loaded in March is
-- on its side from January and Q2 does not hide its family the fixtures
-- before the load; else (a boy already on the books, moved by the file) null:
-- today, as before. As the caller: it reads no table but the calendar.
CREATE OR REPLACE FUNCTION import_joined_on(p_existing boolean, p_given date) RETURNS date AS $$
BEGIN
  IF p_given IS NOT NULL THEN
    IF p_given > sa_today() THEN
      RAISE EXCEPTION 'joined_on % is a day still to come: a side is joined on a day that has happened', p_given
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN p_given;
  END IF;
  IF coalesce(p_existing, false) THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT s.starts_on FROM season_for(sa_today(), 'school') s);
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;


-- ── 5c · The earliest day a membership may begin (header §4c) ────────
-- THE FLOOR (Kameel, 22 October 2026): no earlier than this season's start.
CREATE OR REPLACE FUNCTION membership_joined_floor() RETURNS date AS $$
  SELECT s.starts_on FROM season_for(sa_today(), 'school') s
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

-- The rule, apart from the floor, so it is proved with any floor: null when
-- the day stands, else the refusal, naming the day and the floor.
CREATE OR REPLACE FUNCTION membership_floor_refusal(p_joined date, p_floor date) RETURNS text AS $$
  SELECT CASE WHEN p_floor IS NOT NULL AND p_joined < p_floor
              THEN format('a side cannot be joined on %s: the earliest day a membership may begin is %s', p_joined, p_floor) END
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

-- Every membership row a person's write opened, whichever door wrote
-- player.team_code.
CREATE OR REPLACE FUNCTION team_membership_floor() RETURNS trigger AS $$
DECLARE
  v text := membership_floor_refusal(NEW.joined_on, membership_joined_floor());
BEGIN
  -- A person's write (app.user_id set) through db/08's trigger, which writes
  -- as the table's owner. A row written any other way never gets here as
  -- anyone but the owner: the table has no INSERT policy, and row security
  -- refuses it (42501) after this trigger, so this does not answer first.
  IF v IS NOT NULL AND app_user_id() IS NOT NULL
     AND current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID) THEN
    RAISE EXCEPTION '%', v USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'team_membership',
                                 CONSTRAINT = 'team_membership_floor';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS team_membership_floor ON team_membership;
CREATE TRIGGER team_membership_floor
  BEFORE INSERT ON team_membership
  FOR EACH ROW EXECUTE FUNCTION team_membership_floor();


-- ── 6 · SR-4: the move voids his seats on the side he left ─────────
CREATE OR REPLACE FUNCTION player_move_voids_seats() RETURNS trigger AS $$
DECLARE
  v_on date;
  s    record;
BEGIN
  IF NEW.team_code IS NOT DISTINCT FROM OLD.team_code
     AND NEW.school_id IS NOT DISTINCT FROM OLD.school_id THEN
    RETURN NULL;
  END IF;
  IF OLD.team_code IS NULL THEN
    RETURN NULL;
  END IF;
  -- The day the move took effect, as db/08's history trigger reads it.
  v_on := coalesce(nullif(current_setting('app.effective_on', true), '')::date, current_date);
  FOR s IN SELECT ls.id, ls.offer_id
             FROM lift_seat ls
             JOIN match m ON m.id = ls.match_id
            WHERE ls.player_id = NEW.id
              AND ls.school_id = OLD.school_id AND ls.team_code = OLD.team_code
              AND ls.state IN ('requested', 'invited', 'confirmed')
              AND ls.boarded_at IS NULL
              AND sa_date(m.starts_at) > v_on
              -- ...and still to come: a backdated move does not void a lift already past
              AND m.starts_at > now()
              -- ...which he no longer reaches: not his new side's end...
              AND NOT (ls.school_id = NEW.school_id AND ls.team_code IS NOT DISTINCT FROM NEW.team_code)
              -- ...and not named on that end's sheet (he still goes)
              AND NOT EXISTS (SELECT 1 FROM match_squad q
                               WHERE q.match_id = m.id AND q.player_id = NEW.id AND NOT q.withdrawn
                                 AND ((q.side = 'home' AND m.school_id = ls.school_id)
                                   OR (q.side = 'away' AND m.away_school_id = ls.school_id)))
            ORDER BY m.starts_at, ls.id
            FOR UPDATE OF ls LOOP
    UPDATE lift_seat SET state = 'void', ended_at = now(), ended_by = app_user_id() WHERE id = s.id;
    PERFORM lift_notify(s.offer_id, (SELECT x.driver_id FROM lift_offer x WHERE x.id = s.offer_id), NULL,
      'A seat was withdrawn', lift_offer_words(s.offer_id) || ': a seat is no longer confirmed and has been withdrawn.');
    PERFORM lift_notify_family(s.offer_id, NEW.id, 'A seat on a lift was withdrawn',
      lift_offer_words(s.offer_id) || ': his seat has been withdrawn, because he is no longer on that side. '
        || 'If he should still travel to it, ask the school.');
    PERFORM lift_lone_fallback(s.offer_id);
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS player_move_voids_seats ON player;
CREATE TRIGGER player_move_voids_seats
  AFTER UPDATE OF team_code, school_id ON player
  FOR EACH ROW EXECUTE FUNCTION player_move_voids_seats();


-- ── 7 · Who may call what ──────────────────────────────────────────
-- The helpers the policies ask: the application. The trigger: its owner.
-- sa_date() is a calendar sum over its argument and reads no table: as
-- sa_today(), anyone.
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['side_on(uuid,uuid,date)', 'side_day(uuid)',
                           'side_reach_on(text,uuid,text,uuid,date)', 'my_sides(text)',
                           'my_own_side_fixtures()', 'news_post_day(text,uuid,timestamptz)',
                           'news_plan_reach(uuid,text,date)', 'news_own_old_side(uuid,text,date)',
                           'import_joined_on(boolean,date)', 'membership_joined_floor()',
                           'membership_floor_refusal(date,date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  REVOKE ALL ON FUNCTION player_move_voids_seats() FROM PUBLIC;
  REVOKE ALL ON FUNCTION team_membership_floor() FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['scrbrd_app', 'anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION player_move_voids_seats() FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── 8 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE
  r record;
  q text;
  f text;
BEGIN
  -- The helpers: stable definers with a pinned path, for scrbrd_app and not
  -- PUBLIC; the dated ones ask the membership on a day, about a named boy or
  -- the boy himself, never with the all-zeros person.
  FOR r IN SELECT x.sig, x.must FROM (VALUES
      ('side_on(uuid,uuid,date)', ARRAY['m.joined_on <= p_on', '(m.left_on IS NULL OR m.left_on >= p_on)', 'm.sport = ''cricket''']),
      ('side_day(uuid)', ARRAY['sa_date(m.starts_at)', 'sa_today()']),
      ('side_reach_on(text,uuid,text,uuid,date)', ARRAY['ffffffff-ffff-ffff-ffff-ffffffffffff', 'side_on(p.id, p_school, p_on)',
                                                         'a.person_id = app_user_id()', 'p.id = ANY (my_own_boy())',
                                                         'app_can(p_capability, p.school_id, p.team_code, p.id, p_fixture)']),
      ('side_reach(text,uuid,text,uuid)', ARRAY['side_reach_on(p_capability, p_school, p_team, p_fixture, side_day(p_fixture))']),
      ('my_fixture_ends(text)', ARRAY['NOT s.withdrawn', 'tm.joined_on <= sa_date(m.starts_at)', 'a.person_id = app_user_id()',
                                      'p.id = ANY (my_own_boy())', 'p.school_id, p.team_code, p.id, m.id',
                                      'm.school_id, m.team_code, p.id, m.id', 'm.away_school_id, m.away_team_code, p.id, m.id']),
      ('my_sides(text)', ARRAY['tm.joined_on, tm.left_on', 'a.person_id = app_user_id()', 'p.id = ANY (my_own_boy())']),
      ('my_child_fixtures()', ARRAY['tm.joined_on <= sa_date(m.starts_at)', 'NOT s.withdrawn', 'a.active',
                                    'app_can(''fixture.read'', m.school_id, m.team_code, p.id, m.id)',
                                    'app_can(''fixture.read'', m.away_school_id, m.away_team_code, p.id, m.id)']),
      ('my_own_side_fixtures()', ARRAY['p.id = ANY (my_own_boy())', 'tm.joined_on <= sa_date(m.starts_at)',
                                       'app_can(''fixture.read'', p.school_id, p.team_code, p.id, m.id)']),
      ('news_post_day(text,uuid,timestamptz)', ARRAY['side_day(p_fixture)', 'sa_date(p_published)']),
      ('news_plan_reach(uuid,text,date)', ARRAY['tm.joined_on <= p_on', 'p.id, ''00000000-0000-0000-0000-000000000000''::uuid']),
      ('news_plan_reach(uuid,text)', ARRAY['news_plan_reach(p_school, p_team, sa_today())']),
      ('news_own_old_side(uuid,text,date)', ARRAY['p.id = ANY (my_own_boy())', 'tm.left_on IS NOT NULL',
                                                  'tm.joined_on <= p_on AND tm.left_on >= p_on', 'tm.team_code = p_team',
                                                  'app_can(''news.read'', p.school_id, p.team_code, p.id,',
                                                  'app_can(''team.read'', p.school_id, p.team_code, p.id,'])) x(sig, must) LOOP
    SELECT p.prosrc INTO f FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.sig) AND p.prosecdef AND p.provolatile = 's'
       AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'));
    IF f IS NULL OR EXISTS (SELECT 1 FROM unnest(r.must) m WHERE position(m IN f) = 0) THEN
      RAISE EXCEPTION 'db/117: % is missing, not a stable definer with a pinned path, or does not ask what it says', r.sig;
    END IF;
    IF r.sig IN ('side_reach_on(text,uuid,text,uuid,date)', 'my_fixture_ends(text)', 'my_child_fixtures()', 'my_own_side_fixtures()')
       AND position('00000000-0000-0000-0000-000000000000' IN f) > 0 THEN
      RAISE EXCEPTION 'db/117: % asks with the all-zeros person', r.sig;
    END IF;
    IF has_function_privilege('public', to_regprocedure(r.sig), 'EXECUTE')
       OR NOT has_function_privilege('scrbrd_app', to_regprocedure(r.sig), 'EXECUTE') THEN
      RAISE EXCEPTION 'db/117: % is executable by PUBLIC, or not by scrbrd_app', r.sig;
    END IF;
  END LOOP;
  -- The (2) arms no longer read player.team_code; the (5) arms read it only
  -- as the boy's OWN side, in app_can().
  FOREACH f IN ARRAY ARRAY['my_fixture_ends(text)', 'my_child_fixtures()', 'side_reach_on(text,uuid,text,uuid,date)'] LOOP
    IF position('= p.team_code' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure(f))) > 0 THEN
      RAISE EXCEPTION 'db/117: % still asks the side now (= p.team_code)', f;
    END IF;
  END LOOP;
  -- training_session_read: the unnamed branch with all-f, the named branch
  -- through my_sides() on the session's day.
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO q FROM pg_policy p
   WHERE p.polrelid = 'training_session'::regclass AND p.polname = 'training_session_read' AND p.polcmd = 'r' AND p.polpermissive;
  IF q IS NULL OR position('my_sides(''team.read''::text)' IN q) = 0
     OR position('sa_date(training_session.starts_at)' IN q) = 0
     OR position('ffffffff-ffff-ffff-ffff-ffffffffffff' IN q) = 0
     OR replace(q, '''ffffffff-ffff-ffff-ffff-ffffffffffff''::uuid, ''00000000-0000-0000-0000-000000000000''::uuid)', '')
          LIKE '%00000000-0000-0000-0000-000000000000%' THEN
    RAISE EXCEPTION 'db/117: training_session_read is not the policy this file wrote: %', coalesce(q, 'missing');
  END IF;
  -- ball_event_read: db/112's four branches, once each, and the fifth; one
  -- permissive read on the log.
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO q FROM pg_policy p
   WHERE p.polrelid = 'ball_event'::regclass AND p.polname = 'ball_event_read' AND p.polcmd = 'r' AND p.polpermissive;
  IF q IS NULL
     OR (length(q) - length(replace(q, 'match_team(', ''))) / length('match_team(') <> 1
     OR position('my_child_fixtures()' IN q) = 0 OR position('my_own_sheet_fixtures()' IN q) = 0
     OR position('my_own_side_fixtures()' IN q) = 0
     OR position('00000000-0000-0000-0000-000000000000' IN q) > 0
     OR (SELECT count(*) FROM pg_policy p
          WHERE p.polrelid = 'ball_event'::regclass AND p.polcmd IN ('r', '*') AND p.polpermissive) <> 1 THEN
    RAISE EXCEPTION 'db/117: ball_event_read is not the policy this file wrote: %', coalesce(q, 'missing');
  END IF;
  -- The two news restrictions ask the side on the post's day.
  FOR r IN SELECT x.pol FROM (VALUES ('news_post_plan_side'), ('news_post_team_side')) x(pol) LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid) INTO q FROM pg_policy p
     WHERE p.polrelid = 'news_post'::regclass AND p.polname = r.pol AND NOT p.polpermissive;
    IF q IS NULL OR position('news_post_day(kind, fixture_id, published_at)' IN q) = 0
       OR position('news_sheet_reach(fixture_id, school_id, team_code)' IN q) = 0 THEN
      RAISE EXCEPTION 'db/117: % is not the policy this file wrote: %', r.pol, coalesce(q, 'missing');
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['news_team_notice_reach(uuid)', 'news_notice_reach(uuid)', 'plan_author_name(uuid)'] LOOP
    IF position('news_post_day(n.kind, n.fixture_id, n.published_at)' IN
                coalesce((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure(f) AND prosecdef), '')) = 0
       OR position('news_own_old_side(n.school_id, n.team_code, news_post_day(n.kind, n.fixture_id, n.published_at))' IN
                coalesce((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure(f) AND prosecdef), '')) = 0 THEN
      RAISE EXCEPTION 'db/117: % does not ask the side on the post''s day, or the boy''s old side', f;
    END IF;
  END LOOP;
  -- The moved boy's old posts: both restrictions admit him, and one
  -- permissive read, team posts only, sent, through news_own_old_side().
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'news_post'::regclass AND p.polname IN ('news_post_plan_side', 'news_post_team_side')
         AND NOT p.polpermissive
         AND position('news_own_old_side(school_id, team_code, news_post_day(kind, fixture_id, published_at))'
                      IN pg_get_expr(p.polqual, p.polrelid)) > 0) <> 2 THEN
    RAISE EXCEPTION 'db/117: the news restrictions do not admit the boy''s old side';
  END IF;
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO q FROM pg_policy p
   WHERE p.polrelid = 'news_post'::regclass AND p.polname = 'news_post_read_old_side' AND p.polcmd = 'r' AND p.polpermissive;
  IF q IS NULL OR position('scope = ''team''::text' IN q) = 0 OR position('published_at IS NOT NULL' IN q) = 0
     OR position('published_at <= now()' IN q) = 0
     OR position('news_own_old_side(school_id, team_code, news_post_day(kind, fixture_id, published_at))' IN q) = 0 THEN
    RAISE EXCEPTION 'db/117: news_post_read_old_side is not the policy this file wrote: %', coalesce(q, 'missing');
  END IF;
  -- The import's day: as the caller, for the application, not PUBLIC.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('import_joined_on(boolean,date)') AND NOT p.prosecdef
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))
                    AND position('season_for(sa_today(), ''school'')' IN p.prosrc) > 0
                    AND position('p_given > sa_today()' IN p.prosrc) > 0)
     OR has_function_privilege('public', to_regprocedure('import_joined_on(boolean,date)'), 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', to_regprocedure('import_joined_on(boolean,date)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'db/117: import_joined_on() is missing, not the caller''s, or not granted as it should be';
  END IF;
  -- The floor: one guard on every membership row, asking the rule with the
  -- one floor.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'team_membership'::regclass AND t.tgname = 'team_membership_floor'
                    AND t.tgfoid = to_regprocedure('team_membership_floor()') AND t.tgenabled = 'O'
                    AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT ON public.team_membership FOR EACH ROW%')
     OR position('current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID)' IN
                 coalesce((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('team_membership_floor()')), '')) = 0
     OR position('membership_floor_refusal(NEW.joined_on, membership_joined_floor())' IN
                 coalesce((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('team_membership_floor()')), '')) = 0
     OR position('season_for(sa_today(), ''school'')' IN
                 coalesce((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('membership_joined_floor()')), '')) = 0
     OR membership_joined_floor() IS DISTINCT FROM (SELECT s.starts_on FROM season_for(sa_today(), 'school') s)
     OR membership_floor_refusal(DATE '2026-01-01', DATE '2026-01-02') IS NULL
     OR membership_floor_refusal(DATE '2026-01-02', DATE '2026-01-02') IS NOT NULL
     OR membership_floor_refusal(DATE '2026-01-01', NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'db/117: the membership floor guard is missing or not what this file wrote';
  END IF;
  -- The void: a definer trigger after the side or the school changes, the
  -- owner's alone, beside db/08's and db/112's.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'player'::regclass AND t.tgname = 'player_move_voids_seats'
                    AND t.tgfoid = to_regprocedure('player_move_voids_seats()') AND t.tgenabled = 'O'
                    AND pg_get_triggerdef(t.oid) LIKE '%AFTER UPDATE OF team_code, school_id ON public.player FOR EACH ROW%')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('player_move_voids_seats()') AND p.prosecdef
                       AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}')))
     OR has_function_privilege('scrbrd_app', to_regprocedure('player_move_voids_seats()'), 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'player'::regclass AND tgname = 'player_moves_are_recorded' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'player'::regclass AND tgname = 'player_assignment_follows_side' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/117: the seat void trigger is missing or not what this file wrote, or db/08''s or db/112''s trigger is gone';
  END IF;
  SELECT prosrc INTO f FROM pg_proc WHERE oid = to_regprocedure('player_move_voids_seats()');
  IF position('ls.boarded_at IS NULL' IN f) = 0 OR position('sa_date(m.starts_at) > v_on' IN f) = 0
     OR position('m.starts_at > now()' IN f) = 0 OR position('NOT q.withdrawn' IN f) = 0 THEN
    RAISE EXCEPTION 'db/117: player_move_voids_seats() does not spare a boarded seat, the move''s own day, a lift already past, or the sheet';
  END IF;
  -- No pad table asks a reach helper (AV-D4), and team_membership still has
  -- no write policy (the trigger is the one door).
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polrelid IN (to_regclass('scoring_session'), to_regclass('ball_event_quarantine'), to_regclass('scoring_audit'))
                AND concat(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid))
                    ~ '(side_reach|side_on|fixture_reach|fixture_end_reach|my_fixture_ends|my_sides|my_own_side_fixtures)\(')
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'team_membership'::regclass AND p.polcmd <> 'r') THEN
    RAISE EXCEPTION 'db/117: a pad table asks a reach helper, or team_membership has a write policy';
  END IF;
END $check$;

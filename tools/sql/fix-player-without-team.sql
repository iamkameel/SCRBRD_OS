-- ══════════════════════════════════════════════════════════════════
--  Before db/108: end the seeded test account's team-less `player` role
-- ══════════════════════════════════════════════════════════════════
--
-- NOT A MIGRATION. Not in db/, not in the ledger, not run by
-- tools/migrate.mjs or any bundle. Pasted ONCE into the SQL Editor of a
-- database that already holds the row below, BEFORE
-- scrbrd-supabase-apply-108.sql, and only with Kameel's explicit yes
-- (DEPLOYING.md, db/108). db/108 refuses to run while the row is live.
--
-- WHAT IT ENDS. Exactly one kind of row: a live `player` assignment with no
-- team. On 14 October 2026 the lead found exactly one in production and one
-- in the demo database, both the same seeded test account —
-- spectator@example.invalid, "A Spectator", app_user 88888888-0000-0000-
-- 0000-000000000001, assignment a5510000-0000-0000-0000-000000000001 — not a
-- pupil. db/98 no longer seeds it without a side (it is on the 1st XI now),
-- so a rebuilt database never has it. A `player` row with no team reaches
-- every side at its school (app_can()'s team test, db/50), which is the
-- hole REACH-D4 closes.
--
-- HOW: ENDED, NOT DELETED. `active = false`, the way every withdrawal in
-- this schema is made (db/77's role_assignment_end() does the same). db/01's
-- role_assignment_revoke_only() stamps revoked_at = now(); revoked_by stays
-- NULL, which is this schema's way of saying a maintenance script, not a
-- person at a screen, did it (db/00, role_assignment.revoked_by). Why ended:
--   - it is REVERSIBLE in the only sense this schema allows: the row, its
--     dates and who made it stay on the record, and the account can be given
--     the role again, with a side, by the office (an ended row is never
--     reactivated: db/01 refuses that, "make the appointment again");
--   - a DELETE would erase that the appointment ever existed and cascade to
--     anything that names it, and cannot be undone;
--   - db/108's CHECK exempts ended rows (role <> 'player' OR team_code IS
--     NOT NULL OR NOT active), so an ended row is history, not a breach.
-- No role_assignment_ending row is written: that table's ended_by must name
-- an account, and a paste in the SQL Editor is made by nobody this database
-- knows. The reason is this file, its commit, and the notice it prints.
--
-- WHAT IT REFUSES. It ends only the accounts named in v_expected below. If
-- any OTHER account holds a live team-less `player` row, or a named account
-- is linked to a pupil on the roster (app_user.player_id) — i.e. a real
-- child — it stops and changes nothing: a pupil is not ended, the office
-- gives him a side (end the row from the screen and make the appointment
-- again with his side), and then this file and db/108 run.
--
-- Safe to paste twice: the second time it finds nothing and says so.

DO $fix$
DECLARE
  -- The accounts this file was approved to end the team-less `player` role of.
  v_expected uuid[] := ARRAY['88888888-0000-0000-0000-000000000001']::uuid[];
  v_other    text;
  v_child    text;
  v_list     text;
  n          int;
BEGIN
  IF to_regclass('role_assignment') IS NULL THEN
    RAISE EXCEPTION 'fix-player-without-team: no role_assignment table here; wrong database?';
  END IF;

  -- Nothing is written between the questions below and the update.
  PERFORM set_config('lock_timeout', '10s', true);
  LOCK TABLE role_assignment IN SHARE ROW EXCLUSIVE MODE;

  -- Any account not named above: stop.
  SELECT string_agg(format('%s (%s)', a.id, coalesce(u.email, 'no account')), '; ' ORDER BY a.id)
    INTO v_other
    FROM role_assignment a LEFT JOIN app_user u ON u.id = a.person_id
   WHERE a.role = 'player' AND a.team_code IS NULL AND a.active
     AND NOT (a.person_id = ANY (v_expected));
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'fix-player-without-team: these team-less player roles belong to accounts this file was not approved for: %. Nothing was changed. Give each pupil a side from the office (end the role, make it again with his side), or ask Kameel before adding the account to v_expected.', v_other;
  END IF;

  -- A named account that is a pupil on the roster: stop.
  SELECT string_agg(format('%s (%s, linked to player %s)', u.id, u.email, u.player_id), '; ' ORDER BY u.id)
    INTO v_child
    FROM app_user u
   WHERE u.id = ANY (v_expected) AND u.player_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = u.id AND a.role = 'player' AND a.team_code IS NULL AND a.active);
  IF v_child IS NOT NULL THEN
    RAISE EXCEPTION 'fix-player-without-team: % is a pupil''s account, not a test account. Nothing was changed. A pupil is given a side, not ended.', v_child;
  END IF;

  SELECT count(*), string_agg(format('%s (%s)', a.id, coalesce(u.email, 'no account')), '; ' ORDER BY a.id)
    INTO n, v_list
    FROM role_assignment a LEFT JOIN app_user u ON u.id = a.person_id
   WHERE a.role = 'player' AND a.team_code IS NULL AND a.active
     AND a.person_id = ANY (v_expected);
  IF n = 0 THEN
    RAISE NOTICE 'fix-player-without-team: no live team-less player role on the record; nothing to do. db/108 may be pasted.';
    RETURN;
  END IF;

  UPDATE role_assignment a SET active = false
   WHERE a.role = 'player' AND a.team_code IS NULL AND a.active
     AND a.person_id = ANY (v_expected);

  IF EXISTS (SELECT 1 FROM role_assignment WHERE role = 'player' AND team_code IS NULL AND active) THEN
    RAISE EXCEPTION 'fix-player-without-team: a live team-less player role is still on the record after the update';
  END IF;
  RAISE NOTICE 'fix-player-without-team: ended % team-less player role(s): %. Reason: a player role with no side reaches every side at its school (REACH-D4); a seeded test account, not a pupil. db/108 may be pasted now.', n, v_list;
END $fix$;

-- What is left, for the eye: should be no rows.
SELECT a.id, u.email, a.role, a.school_id, a.team_code, a.active, a.revoked_at
  FROM role_assignment a LEFT JOIN app_user u ON u.id = a.person_id
 WHERE a.role = 'player' AND a.team_code IS NULL AND a.active;

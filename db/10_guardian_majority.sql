-- ═══════════════════════════════════════════════════════════════════
--  Guardian links that already exist, and the day they should have ended
-- ═══════════════════════════════════════════════════════════════════
--
-- db/08 now ends every guardian link at the child's majority, at both places
-- that create one. That fixes the links made from here on and does nothing at
-- all for the links already on the record — and those are the ones that have
-- been open-ended longest.
--
-- It cannot be done in db/08. The migrator's ledger refuses a file that has
-- already run and changed since (tools/migrate.mjs), so on exactly the
-- databases that hold open-ended links, db/08 will never execute again. On a
-- fresh database this file is a no-op: the migrations run before the seed, so
-- there is nothing here to correct yet. It only does work where the defect is.
--
-- Written to be safe to run twice: both statements below only touch rows that
-- still have no end date.

-- (1) Where we know the child's birthday, the link ends where it always should
-- have. For a child already over eighteen that date is in the past, and the
-- access ends the moment this commits — which is the correction, not a side
-- effect of it. app_can() reads valid_until on every call, so this takes hold
-- immediately and with no cron behind it.
--
-- greatest(…, s.valid_from) is load-bearing and not defensive dressing.
-- assignment_subject carries CHECK (valid_from <= valid_until), and the old
-- code would happily link a guardian to someone already grown — so a database
-- can hold a link whose start date is LATER than the child's eighteenth
-- birthday. Writing the bare majority date there would abort this migration on
-- a constraint violation, on precisely the row most in need of correcting.
-- Clamped, the link ends today instead of retroactively, which is the earliest
-- the record can honestly say it ended, and access stops just the same:
-- app_can() wants valid_until > current_date.
UPDATE assignment_subject s
   SET valid_until = greatest(majority_on(p.born), s.valid_from)
  FROM role_assignment a, player p
 WHERE a.id = s.assignment_id
   AND a.role = 'guardian'
   AND p.id = s.player_id
   AND p.born IS NOT NULL
   AND s.valid_until IS NULL;

-- (2) Where we do not, the link ends today, and the office is told whose.
--
-- This is the uncomfortable half, so it is stated plainly: a guardian link
-- against a child with no recorded date of birth is one nobody can put an end
-- date on, and leaving it alone would preserve precisely the open-ended access
-- this change exists to close. It fails closed. Re-establishing the link is
-- one call to guardian_link_establish() once the date of birth is captured,
-- and that function now refuses without it, so the record cannot go back to
-- being open-ended.
--
-- Deliberately NOT a grace period: a window of some invented number of days
-- would be a rule nobody decided, and it would expire while somebody was on
-- holiday. The names go in the log so the office can act on them the same day.
DO $$
DECLARE v_row record; v_n integer := 0;
BEGIN
  FOR v_row IN
    SELECT s.id, p.full_name, u.email
      FROM assignment_subject s
      JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
      JOIN player p ON p.id = s.player_id
      LEFT JOIN app_user u ON u.id = a.person_id
     WHERE p.born IS NULL AND s.valid_until IS NULL
  LOOP
    UPDATE assignment_subject SET valid_until = greatest(current_date, valid_from)
     WHERE id = v_row.id;
    RAISE WARNING 'guardian link ended: % has no recorded date of birth (guardian: %). Capture the date of birth and re-establish the link.',
      v_row.full_name, coalesce(v_row.email, 'unknown');
    v_n := v_n + 1;
  END LOOP;
  IF v_n > 0 THEN
    RAISE WARNING '% guardian link(s) ended for want of a date of birth. See the warnings above.', v_n;
  END IF;
END $$;

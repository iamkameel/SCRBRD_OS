-- ═══════════════════════════════════════════════════════════════════
--  A pupil's date of birth is not optional
-- ═══════════════════════════════════════════════════════════════════
--
-- The API asks for one now, at both doors — the Add Player form and the bulk
-- CSV import — and that is worth having. It is not worth trusting on its own.
-- Every other rule in this schema that matters is enforced where it cannot be
-- skipped, and this one is load-bearing in a way that is easy to miss:
--
--   guardian_link_establish() REFUSES to link a parent to a child whose date
--   of birth is unknown, because a guardian link with no end date is the thing
--   db/10 exists to prevent. So a boy on the roster without a birthday is a boy
--   whose family can never be given access to his record at all — and nobody
--   finds out when the mistake is made. They find out weeks later, when a
--   parent asks why they cannot see their son.
--
-- `official.born` has been NOT NULL since the register was built. This is the
-- same rule for the other half of the sentence the office was given: a date of
-- birth is required for all players and officials.
--
-- WHY A CHECK AND NOT SET NOT NULL. A database that already holds rows without
-- one would abort on SET NOT NULL, and the migration would fail on exactly the
-- databases that most need correcting — leaving the door open because it could
-- not be closed retroactively. Added NOT VALID instead: Postgres enforces it on
-- every INSERT and UPDATE from this moment, and simply does not re-examine rows
-- already written. New mistakes are impossible; old ones are a cleanup job.
ALTER TABLE player DROP CONSTRAINT IF EXISTS player_born_required;
ALTER TABLE player ADD CONSTRAINT player_born_required
  CHECK (born IS NOT NULL) NOT VALID;

-- And then close it properly where it can be closed. On a database whose rows
-- all carry a birthday this promotes the constraint to fully validated, which
-- is the honest end state. Where it cannot, the migration does not fail — it
-- names who is missing one, because "some rows are wrong" is not actionable
-- and "these four boys are" is.
DO $$
DECLARE v_row record; v_n integer := 0;
BEGIN
  SELECT count(*) INTO v_n FROM player WHERE born IS NULL;
  IF v_n = 0 THEN
    ALTER TABLE player VALIDATE CONSTRAINT player_born_required;
    RETURN;
  END IF;
  FOR v_row IN SELECT full_name, team_code FROM player WHERE born IS NULL ORDER BY full_name LOOP
    RAISE WARNING 'no date of birth on record: % (%). His family cannot be linked until it is captured.',
      v_row.full_name, coalesce(v_row.team_code, 'no side');
  END LOOP;
  RAISE WARNING '% player(s) have no date of birth. New rows are refused from now on; these are a cleanup job. Run: ALTER TABLE player VALIDATE CONSTRAINT player_born_required; once they are fixed.', v_n;
END $$;

-- ══════════════════════════════════════════════════════════════════
--  19 · The gaps db/10 and db/11 could only warn about
-- ══════════════════════════════════════════════════════════════════
--
-- db/11 closed player_born_required and named, in a migration log nobody but
-- an operator ever reads, every boy with no date of birth on record. db/10
-- did the same for every guardian link it had to end for want of one. Both
-- were right to fail closed — a birthday is what majority_on() and
-- guardian_link_establish() need to work at all — and both left the actual
-- fix sitting in a Postgres log line: "capture the date of birth and
-- re-establish the link." Nobody works from a migration log day to day, so a
-- boy could sit with no birthday, and his family with no way to reach his
-- record, until somebody happened to reread it.
--
-- This is the same two facts, read instead of logged, so the one screen that
-- already surfaces "on a roster, no account" (SettingsView) can surface these
-- beside it. No new tables: player.born and assignment_subject already hold
-- everything this asks.
--
-- Gated exactly like assignment_subject_read, which is the policy that
-- already decides who may see a guardian link at all: user.role.assign or
-- guardian.link.manage, checked PER ROW against that boy's own school and
-- team, the same shape as clearance_register() and workload() above it. A
-- coach with neither capability gets nothing back, not an error — the same
-- rule every read in this file follows.
CREATE OR REPLACE FUNCTION dob_gaps()
RETURNS TABLE (
  kind          text,   -- 'no_dob' | 'guardian_link_ended'
  player_id     uuid,
  full_name     text,
  team_code     text,
  school_id     uuid,
  link_id       uuid,   -- assignment_subject.id, only for guardian_link_ended
  guardian_id   uuid,
  guardian_name text,
  guardian_email text,
  relationship  text,   -- assignment_subject.relationship, so a re-link asks for the same one
  ended_on      date
) AS $$
  -- Every boy on the roster with no birthday at all, whether or not anyone
  -- has ever tried to link a guardian to him.
  SELECT 'no_dob', p.id, p.full_name, p.team_code, p.school_id,
         NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::date
    FROM player p
   WHERE p.born IS NULL
     AND (app_can('user.role.assign',    p.school_id, p.team_code, NULL, NULL)
          OR app_can('guardian.link.manage', p.school_id, p.team_code, NULL, NULL))

  UNION ALL

  -- Guardian links db/10 already had to end for exactly this reason.
  -- guardian_link_establish() refuses without a birthday, so the only way a
  -- link with a NULL-born child carries a valid_until IN THE PAST is that
  -- migration — this is not inferring a cause, it is reading db/10's own
  -- effect back. EVERY link now carries an end date (its majority), so
  -- `valid_until IS NOT NULL` alone would match every live link there is;
  -- `<= current_date` is what actually says ENDED.
  SELECT 'guardian_link_ended', p.id, p.full_name, p.team_code, p.school_id,
         s.id, a.person_id, u.name, u.email, s.relationship, s.valid_until
    FROM assignment_subject s
    JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
    JOIN player p           ON p.id = s.player_id
    LEFT JOIN app_user u    ON u.id = a.person_id
   WHERE p.born IS NULL
     AND s.valid_until IS NOT NULL AND s.valid_until <= current_date
     AND (app_can('user.role.assign',    p.school_id, p.team_code, NULL, NULL)
          OR app_can('guardian.link.manage', p.school_id, p.team_code, NULL, NULL))

  ORDER BY 3, 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION dob_gaps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dob_gaps() TO PUBLIC;

-- SCRBRD — authorization: the decision function and the role bundles
-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.
-- Regenerate with `pnpm rls:generate`. Applied BEFORE the scoring schema,
-- which references app_can(). Model: docs/adr/0001-scoped-assignments.md.
-- 50 capabilities across 22 roles.

-- Principal helpers. app_user_id() is set from the signed token on every
-- request; everything else about a person's authority is looked up.
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid $$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION app_device_id() RETURNS text AS $$
  SELECT nullif(current_setting('app.device_id', true), '') $$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION app_player_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.player_id', true), '')::uuid $$ LANGUAGE sql STABLE;

-- ══════════════════════════════════════════════════════════════════
--  The authorization decision
-- ══════════════════════════════════════════════════════════════════
-- app_can(capability, school, team, person, fixture)
--
-- TRUE when ONE SINGLE assignment held by the current user both grants the
-- capability and covers the resource. Never a union across assignments: a
-- capability held through one assignment is only ever applied within that
-- same assignment's scope.
--
-- Scope semantics, which are asymmetric on purpose:
--   NULL on the ASSIGNMENT widens  — school_id NULL is platform-wide,
--                                    team_code NULL is every team in the school.
--   NULL on the RESOURCE narrows   — a row that does not state its school is
--                                    NOT covered by a school-scoped assignment.
-- The second half is what makes a query that forgot its scope fail closed
-- instead of matching everything.
--
-- The third state is ANY_SCOPE ('*' for team, the nil UUID for the others),
-- meaning the dimension DOES NOT APPLY to this kind of row. A fixture is not
-- about one person, so a guardian assignment's child list has nothing to
-- constrain and does not constrain it. Without this, every guardian was denied
-- every fixture — they could not see when their own child was playing. It is
-- passed by the generator only for dimensions a table omits entirely; a table
-- that states a dimension as absent still narrows.
--
-- SECURITY DEFINER because role_assignment is itself RLS-protected: a person
-- may not read other people's assignments, but the decision must read their
-- own. STABLE so it is evaluated once per statement per argument set.
CREATE OR REPLACE FUNCTION app_can(
  p_capability text,
  p_school     uuid DEFAULT NULL,
  p_team       text DEFAULT NULL,
  p_person     uuid DEFAULT NULL,
  p_fixture    uuid DEFAULT NULL
) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc
        ON rc.role = a.role
       AND rc.capability = p_capability
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
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
       -- guardian: an assignment listing children reaches ONLY those children
       AND (
         NOT EXISTS (SELECT 1 FROM guardian_child g WHERE g.assignment_id = a.id)
         OR p_person = '00000000-0000-0000-0000-000000000000'::uuid
         OR (p_person IS NOT NULL AND EXISTS (
               SELECT 1 FROM guardian_child g
                WHERE g.assignment_id = a.id AND g.player_id = p_person))
       )
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION app_can(text, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can(text, uuid, text, uuid, uuid) TO PUBLIC;

-- There is deliberately NO can_score(role) here. It existed, it was correct,
-- and nothing called it after the scoring policies moved to app_can() — which
-- makes it worse than useless: a role-shaped decision function sitting in the
-- schema is an invitation to reach for it, and reaching for it reintroduces
-- the exact hole ADR 0001 closed (a role the session asserts, evaluated
-- without a scope). Scoring authority is app_can('scoring.edit', ...) against
-- the assignments the database looks up, and there is no second way to ask.

-- ══════════════════════════════════════════════════════════════════
--  The capability catalogue
-- ══════════════════════════════════════════════════════════════════
-- Every capability the model defines, as rows, so a column that stores a
-- capability NAME can have a foreign key onto it — notification.required_capability
-- is the one that does. Without this, a typo in a published notice becomes a
-- notification nobody can read, which fails closed but fails silently, and the
-- person who published it has no way to discover that nobody received it.
--
-- Inserted, never deleted: rows here are referenced. A capability retired from
-- the model leaves its row behind rather than breaking the references to it,
-- and grants no authority on its own — authority comes from role_capability.
CREATE TABLE IF NOT EXISTS capability (name text PRIMARY KEY);
INSERT INTO capability (name) VALUES
  ('school.read'),
  ('school.manage'),
  ('user.read'),
  ('user.invite'),
  ('user.role.assign'),
  ('audit.read'),
  ('team.read'),
  ('team.manage'),
  ('team.select'),
  ('player.profile.read'),
  ('player.profile.manage'),
  ('player.pii.read'),
  ('player.performance.read'),
  ('player.performance.write'),
  ('player.development.read'),
  ('player.development.write'),
  ('fixture.read'),
  ('fixture.create'),
  ('fixture.update'),
  ('fixture.cancel'),
  ('scoring.start'),
  ('scoring.edit'),
  ('scoring.finalise'),
  ('scoring.correct'),
  ('officiating.assign'),
  ('officiating.report'),
  ('medical.status.read'),
  ('medical.details.read'),
  ('medical.write'),
  ('discipline.read'),
  ('discipline.write'),
  ('transport.read'),
  ('transport.manage'),
  ('transport.drive'),
  ('facility.read'),
  ('facility.manage'),
  ('invoice.read'),
  ('invoice.manage'),
  ('competition.read'),
  ('competition.manage'),
  ('news.read'),
  ('news.publish.team'),
  ('news.publish.school'),
  ('news.publish.competition'),
  ('analytics.read'),
  ('scouting.read'),
  ('scouting.write'),
  ('platform.health.read'),
  ('platform.tenant.manage'),
  ('platform.support.impersonate')
ON CONFLICT (name) DO NOTHING;

-- Readable by everyone, writable by nobody but a migration. The names are
-- already in the client bundle, so there is nothing to protect by hiding them
-- — but the catalogue must not be writable by the application, or a row could
-- be added to make a notification's declared capability satisfiable by a role
-- that was never granted it. RLS is enabled with an open read rather than left
-- off, so the "no public table has row-level security disabled" assertion in
-- db/99_rls_verify.sql stays a blanket rule with no exceptions list to drift.
ALTER TABLE capability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capability_read ON capability;
CREATE POLICY capability_read ON capability FOR SELECT USING (true);
-- The matching REVOKE of write access lives in db/06_app_role.sql, not here:
-- scrbrd_app is created there, and this file runs first. Revoking from a role
-- that does not exist yet is an error on a fresh cluster — and it would not
-- have been caught locally, because roles are cluster-level and survive the
-- DROP SCHEMA that migrate --reset does.


-- ══════════════════════════════════════════════════════════════════
--  Role → capability bundles
-- ══════════════════════════════════════════════════════════════════
-- Replaced wholesale on every regeneration.
DELETE FROM role_capability;
INSERT INTO role_capability (role, capability) VALUES
  ('platformadmin', 'platform.health.read'),
  ('platformadmin', 'platform.tenant.manage'),
  ('platformadmin', 'platform.support.impersonate'),
  ('platformadmin', 'school.read'),
  ('platformadmin', 'user.read'),
  ('platformadmin', 'audit.read'),
  ('platformadmin', 'competition.read'),
  ('platformadmin', 'news.read'),
  ('principal', 'team.read'),
  ('principal', 'fixture.read'),
  ('principal', 'player.profile.read'),
  ('principal', 'news.read'),
  ('principal', 'facility.read'),
  ('principal', 'competition.read'),
  ('principal', 'school.read'),
  ('principal', 'user.read'),
  ('principal', 'analytics.read'),
  ('principal', 'discipline.read'),
  ('principal', 'invoice.read'),
  ('principal', 'player.performance.read'),
  ('principal', 'medical.status.read'),
  ('principal', 'audit.read'),
  ('directorofsport', 'team.read'),
  ('directorofsport', 'fixture.read'),
  ('directorofsport', 'player.profile.read'),
  ('directorofsport', 'news.read'),
  ('directorofsport', 'facility.read'),
  ('directorofsport', 'competition.read'),
  ('directorofsport', 'school.read'),
  ('directorofsport', 'user.read'),
  ('directorofsport', 'user.invite'),
  ('directorofsport', 'team.manage'),
  ('directorofsport', 'team.select'),
  ('directorofsport', 'fixture.create'),
  ('directorofsport', 'fixture.update'),
  ('directorofsport', 'fixture.cancel'),
  ('directorofsport', 'player.profile.manage'),
  ('directorofsport', 'player.performance.read'),
  ('directorofsport', 'player.development.read'),
  ('directorofsport', 'medical.status.read'),
  ('directorofsport', 'discipline.read'),
  ('directorofsport', 'discipline.write'),
  ('directorofsport', 'analytics.read'),
  ('directorofsport', 'facility.manage'),
  ('directorofsport', 'transport.read'),
  ('directorofsport', 'officiating.assign'),
  ('directorofsport', 'scoring.start'),
  ('directorofsport', 'scoring.edit'),
  ('directorofsport', 'scoring.finalise'),
  ('directorofsport', 'scoring.correct'),
  ('directorofsport', 'news.publish.team'),
  ('directorofsport', 'news.publish.school'),
  ('directorofsport', 'audit.read'),
  ('schooladmin', 'team.read'),
  ('schooladmin', 'fixture.read'),
  ('schooladmin', 'player.profile.read'),
  ('schooladmin', 'news.read'),
  ('schooladmin', 'facility.read'),
  ('schooladmin', 'competition.read'),
  ('schooladmin', 'school.read'),
  ('schooladmin', 'school.manage'),
  ('schooladmin', 'user.read'),
  ('schooladmin', 'user.invite'),
  ('schooladmin', 'user.role.assign'),
  ('schooladmin', 'team.manage'),
  ('schooladmin', 'fixture.create'),
  ('schooladmin', 'fixture.update'),
  ('schooladmin', 'fixture.cancel'),
  ('schooladmin', 'player.profile.manage'),
  ('schooladmin', 'player.pii.read'),
  ('schooladmin', 'medical.status.read'),
  ('schooladmin', 'discipline.read'),
  ('schooladmin', 'facility.manage'),
  ('schooladmin', 'transport.read'),
  ('schooladmin', 'transport.manage'),
  ('schooladmin', 'invoice.read'),
  ('schooladmin', 'news.publish.school'),
  ('schooladmin', 'audit.read'),
  ('sportsadmin', 'team.read'),
  ('sportsadmin', 'fixture.read'),
  ('sportsadmin', 'player.profile.read'),
  ('sportsadmin', 'news.read'),
  ('sportsadmin', 'facility.read'),
  ('sportsadmin', 'competition.read'),
  ('sportsadmin', 'user.read'),
  ('sportsadmin', 'team.manage'),
  ('sportsadmin', 'team.select'),
  ('sportsadmin', 'fixture.create'),
  ('sportsadmin', 'fixture.update'),
  ('sportsadmin', 'fixture.cancel'),
  ('sportsadmin', 'officiating.assign'),
  ('sportsadmin', 'player.profile.manage'),
  ('sportsadmin', 'medical.status.read'),
  ('sportsadmin', 'facility.manage'),
  ('sportsadmin', 'transport.read'),
  ('sportsadmin', 'transport.manage'),
  ('sportsadmin', 'news.publish.team'),
  ('sportsadmin', 'news.publish.school'),
  ('sportsadmin', 'scoring.start'),
  ('sportsadmin', 'scoring.edit'),
  ('sportsadmin', 'scoring.finalise'),
  ('coach', 'team.read'),
  ('coach', 'fixture.read'),
  ('coach', 'player.profile.read'),
  ('coach', 'news.read'),
  ('coach', 'facility.read'),
  ('coach', 'competition.read'),
  ('coach', 'team.select'),
  ('coach', 'player.performance.read'),
  ('coach', 'player.performance.write'),
  ('coach', 'player.development.read'),
  ('coach', 'player.development.write'),
  ('coach', 'medical.status.read'),
  ('coach', 'analytics.read'),
  ('coach', 'transport.read'),
  ('coach', 'scoring.start'),
  ('coach', 'scoring.edit'),
  ('coach', 'scoring.finalise'),
  ('coach', 'news.publish.team'),
  ('assistantcoach', 'team.read'),
  ('assistantcoach', 'fixture.read'),
  ('assistantcoach', 'player.profile.read'),
  ('assistantcoach', 'news.read'),
  ('assistantcoach', 'facility.read'),
  ('assistantcoach', 'competition.read'),
  ('assistantcoach', 'player.performance.read'),
  ('assistantcoach', 'player.development.read'),
  ('assistantcoach', 'medical.status.read'),
  ('assistantcoach', 'transport.read'),
  ('assistantcoach', 'scoring.start'),
  ('assistantcoach', 'scoring.edit'),
  ('teammanager', 'team.read'),
  ('teammanager', 'fixture.read'),
  ('teammanager', 'player.profile.read'),
  ('teammanager', 'news.read'),
  ('teammanager', 'facility.read'),
  ('teammanager', 'competition.read'),
  ('teammanager', 'team.select'),
  ('teammanager', 'medical.status.read'),
  ('teammanager', 'transport.read'),
  ('teammanager', 'news.publish.team'),
  ('scorer', 'fixture.read'),
  ('scorer', 'team.read'),
  ('scorer', 'news.read'),
  ('scorer', 'player.profile.read'),
  ('scorer', 'scoring.start'),
  ('scorer', 'scoring.edit'),
  ('scorer', 'scoring.finalise'),
  ('scorer', 'scoring.correct'),
  ('official', 'fixture.read'),
  ('official', 'team.read'),
  ('official', 'news.read'),
  ('official', 'officiating.report'),
  ('official', 'discipline.write'),
  ('player', 'fixture.read'),
  ('player', 'team.read'),
  ('player', 'news.read'),
  ('player', 'facility.read'),
  ('player', 'competition.read'),
  ('player', 'player.profile.read'),
  ('player', 'player.performance.read'),
  ('player', 'player.development.read'),
  ('player', 'medical.status.read'),
  ('player', 'transport.read'),
  ('guardian', 'fixture.read'),
  ('guardian', 'team.read'),
  ('guardian', 'news.read'),
  ('guardian', 'facility.read'),
  ('guardian', 'competition.read'),
  ('guardian', 'player.profile.read'),
  ('guardian', 'player.pii.read'),
  ('guardian', 'player.performance.read'),
  ('guardian', 'medical.status.read'),
  ('guardian', 'transport.read'),
  ('guardian', 'invoice.read'),
  ('analyst', 'team.read'),
  ('analyst', 'fixture.read'),
  ('analyst', 'news.read'),
  ('analyst', 'player.profile.read'),
  ('analyst', 'player.performance.read'),
  ('analyst', 'analytics.read'),
  ('analyst', 'competition.read'),
  ('spectator', 'fixture.read'),
  ('spectator', 'news.read'),
  ('spectator', 'competition.read'),
  ('medical', 'team.read'),
  ('medical', 'fixture.read'),
  ('medical', 'news.read'),
  ('medical', 'player.profile.read'),
  ('medical', 'medical.status.read'),
  ('medical', 'medical.details.read'),
  ('medical', 'medical.write'),
  ('finance', 'school.read'),
  ('finance', 'news.read'),
  ('finance', 'invoice.read'),
  ('finance', 'invoice.manage'),
  ('finance', 'user.read'),
  ('transportcoordinator', 'fixture.read'),
  ('transportcoordinator', 'team.read'),
  ('transportcoordinator', 'news.read'),
  ('transportcoordinator', 'transport.read'),
  ('transportcoordinator', 'transport.manage'),
  ('driver', 'news.read'),
  ('driver', 'transport.read'),
  ('driver', 'transport.drive'),
  ('facilities', 'fixture.read'),
  ('facilities', 'news.read'),
  ('facilities', 'facility.read'),
  ('facilities', 'facility.manage'),
  ('media', 'fixture.read'),
  ('media', 'team.read'),
  ('media', 'news.read'),
  ('media', 'player.profile.read'),
  ('media', 'player.performance.read'),
  ('media', 'news.publish.school'),
  ('media', 'news.publish.team'),
  ('scout', 'fixture.read'),
  ('scout', 'team.read'),
  ('scout', 'news.read'),
  ('scout', 'player.profile.read'),
  ('scout', 'player.performance.read'),
  ('scout', 'scouting.read'),
  ('scout', 'scouting.write'),
  ('competitionadmin', 'fixture.read'),
  ('competitionadmin', 'fixture.update'),
  ('competitionadmin', 'fixture.cancel'),
  ('competitionadmin', 'team.read'),
  ('competitionadmin', 'news.read'),
  ('competitionadmin', 'competition.read'),
  ('competitionadmin', 'competition.manage'),
  ('competitionadmin', 'officiating.assign'),
  ('competitionadmin', 'discipline.read'),
  ('competitionadmin', 'scoring.correct'),
  ('competitionadmin', 'news.publish.competition');

-- ══════════════════════════════════════════════════════════════════
--  The assignment tables themselves
-- ══════════════════════════════════════════════════════════════════
-- A person may read their own assignments — the context switcher needs them —
-- and nobody else's. Granting and revoking goes through user.role.assign.
ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_assignment_read  ON role_assignment;
DROP POLICY IF EXISTS role_assignment_write ON role_assignment;

CREATE POLICY role_assignment_read ON role_assignment
  FOR SELECT USING (
    person_id = app_user_id()
    OR app_can('user.role.assign', school_id, team_code, NULL, NULL)
  );
CREATE POLICY role_assignment_write ON role_assignment
  FOR INSERT WITH CHECK (app_can('user.role.assign', school_id, team_code, NULL, NULL));

ALTER TABLE guardian_child ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guardian_child_read ON guardian_child;
CREATE POLICY guardian_child_read ON guardian_child
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.id = guardian_child.assignment_id
       AND (a.person_id = app_user_id()
            OR app_can('user.role.assign', a.school_id, a.team_code, NULL, NULL))
  ));

-- role_capability is generated reference data, readable by all, written only
-- by the generator running as the migration user.
ALTER TABLE role_capability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_capability_read ON role_capability;
CREATE POLICY role_capability_read ON role_capability FOR SELECT USING (true);

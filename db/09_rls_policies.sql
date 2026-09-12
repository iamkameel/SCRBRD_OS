-- SCRBRD — Row-Level Security & column masking
-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.
-- Regenerate with `pnpm rls:generate`. Companion: db/01_authz.sql.
-- Model: capability + scoped assignment (docs/adr/0001-scoped-assignments.md).
-- Roles that may score: directorofsport, sportsadmin, coach, assistantcoach, scorer

-- ══════════════════════════════════════════════════════════════════
--  Team codes are a closed vocabulary
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE player DROP CONSTRAINT IF EXISTS player_team_code_known;
ALTER TABLE player ADD CONSTRAINT player_team_code_known CHECK (team_code IS NULL OR team_code ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?|([1-9]|1[0-9]|20)XI)$');
ALTER TABLE coach DROP CONSTRAINT IF EXISTS coach_team_code_known;
ALTER TABLE coach ADD CONSTRAINT coach_team_code_known CHECK (team_code IS NULL OR team_code ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?|([1-9]|1[0-9]|20)XI)$');
ALTER TABLE match DROP CONSTRAINT IF EXISTS match_team_code_known;
ALTER TABLE match ADD CONSTRAINT match_team_code_known CHECK (team_code IS NULL OR team_code ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?|([1-9]|1[0-9]|20)XI)$');
ALTER TABLE role_assignment DROP CONSTRAINT IF EXISTS role_assignment_team_code_known;
ALTER TABLE role_assignment ADD CONSTRAINT role_assignment_team_code_known CHECK (team_code IS NULL OR team_code ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?|([1-9]|1[0-9]|20)XI)$');
ALTER TABLE training_session DROP CONSTRAINT IF EXISTS training_session_team_code_known;
ALTER TABLE training_session ADD CONSTRAINT training_session_team_code_known CHECK (team_code IS NULL OR team_code ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?|([1-9]|1[0-9]|20)XI)$');
ALTER TABLE competition_entrant DROP CONSTRAINT IF EXISTS competition_entrant_team_code_known;
ALTER TABLE competition_entrant ADD CONSTRAINT competition_entrant_team_code_known CHECK (team_code IS NULL OR team_code ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?|([1-9]|1[0-9]|20)XI)$');
ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_team_code_known;
ALTER TABLE notification ADD CONSTRAINT notification_team_code_known CHECK (team_code IS NULL OR team_code ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?|([1-9]|1[0-9]|20)XI)$');

-- ══════════════════════════════════════════════════════════════════
--  Per-table row-level security
-- ══════════════════════════════════════════════════════════════════

-- school — read: school.read · write: school.manage
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE school ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_read   ON school;
DROP POLICY IF EXISTS school_insert ON school;
DROP POLICY IF EXISTS school_update ON school;
DROP POLICY IF EXISTS school_delete ON school;

CREATE POLICY school_read ON school
  FOR SELECT USING ((app_can('school.read', school.id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    OR (EXISTS (SELECT 1 FROM role_assignment a
                           WHERE a.person_id = app_user_id() AND a.active
                             AND (a.school_id IS NULL OR a.school_id = school.id))));

CREATE POLICY school_insert ON school
  FOR INSERT WITH CHECK (app_can('school.manage', school.id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY school_update ON school
  FOR UPDATE USING (app_can('school.manage', school.id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('school.manage', school.id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- app_user — read: user.read · write: user.role.assign
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_user_read   ON app_user;
DROP POLICY IF EXISTS app_user_insert ON app_user;
DROP POLICY IF EXISTS app_user_update ON app_user;
DROP POLICY IF EXISTS app_user_delete ON app_user;

CREATE POLICY app_user_read ON app_user
  FOR SELECT USING ((app_can('user.read', app_user.school_id, NULL::text, app_user.id, '00000000-0000-0000-0000-000000000000'::uuid))
    OR (id = app_user_id()));

CREATE POLICY app_user_insert ON app_user
  FOR INSERT WITH CHECK (app_can('user.role.assign', app_user.school_id, NULL::text, app_user.id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY app_user_update ON app_user
  FOR UPDATE USING (app_can('user.role.assign', app_user.school_id, NULL::text, app_user.id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('user.role.assign', app_user.school_id, NULL::text, app_user.id, '00000000-0000-0000-0000-000000000000'::uuid));

-- player — read: player.profile.read · write: player.profile.manage
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE player ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_read   ON player;
DROP POLICY IF EXISTS player_insert ON player;
DROP POLICY IF EXISTS player_update ON player;
DROP POLICY IF EXISTS player_delete ON player;

CREATE POLICY player_read ON player
  FOR SELECT USING ((app_can('player.profile.read', player.school_id, player.team_code, player.id, '00000000-0000-0000-0000-000000000000'::uuid))
    OR (app_can('player.roster.read', player.school_id, '*'::text,
                          '00000000-0000-0000-0000-000000000000'::uuid,
                          '00000000-0000-0000-0000-000000000000'::uuid)));

CREATE POLICY player_insert ON player
  FOR INSERT WITH CHECK (app_can('player.profile.manage', player.school_id, player.team_code, player.id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY player_update ON player
  FOR UPDATE USING (app_can('player.profile.manage', player.school_id, player.team_code, player.id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('player.profile.manage', player.school_id, player.team_code, player.id, '00000000-0000-0000-0000-000000000000'::uuid));

-- coach — read: user.read · write: user.role.assign
ALTER TABLE coach ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_read   ON coach;
DROP POLICY IF EXISTS coach_insert ON coach;
DROP POLICY IF EXISTS coach_update ON coach;
DROP POLICY IF EXISTS coach_delete ON coach;

CREATE POLICY coach_read ON coach
  FOR SELECT USING (app_can('user.read', coach.school_id, coach.team_code, coach.id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY coach_insert ON coach
  FOR INSERT WITH CHECK (app_can('user.role.assign', coach.school_id, coach.team_code, coach.id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY coach_update ON coach
  FOR UPDATE USING (app_can('user.role.assign', coach.school_id, coach.team_code, coach.id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('user.role.assign', coach.school_id, coach.team_code, coach.id, '00000000-0000-0000-0000-000000000000'::uuid));

-- staff — read: user.read · write: user.role.assign
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_read   ON staff;
DROP POLICY IF EXISTS staff_insert ON staff;
DROP POLICY IF EXISTS staff_update ON staff;
DROP POLICY IF EXISTS staff_delete ON staff;

CREATE POLICY staff_read ON staff
  FOR SELECT USING (app_can('user.read', staff.school_id, NULL::text, staff.id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY staff_insert ON staff
  FOR INSERT WITH CHECK (app_can('user.role.assign', staff.school_id, NULL::text, staff.id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY staff_update ON staff
  FOR UPDATE USING (app_can('user.role.assign', staff.school_id, NULL::text, staff.id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('user.role.assign', staff.school_id, NULL::text, staff.id, '00000000-0000-0000-0000-000000000000'::uuid));

-- adult_clearance — read: clearance.read · write: clearance.manage
ALTER TABLE adult_clearance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS adult_clearance_read   ON adult_clearance;
DROP POLICY IF EXISTS adult_clearance_insert ON adult_clearance;
DROP POLICY IF EXISTS adult_clearance_update ON adult_clearance;
DROP POLICY IF EXISTS adult_clearance_delete ON adult_clearance;

CREATE POLICY adult_clearance_read ON adult_clearance
  FOR SELECT USING (app_can('clearance.read', adult_clearance.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY adult_clearance_insert ON adult_clearance
  FOR INSERT WITH CHECK (app_can('clearance.manage', adult_clearance.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY adult_clearance_update ON adult_clearance
  FOR UPDATE USING (app_can('clearance.manage', adult_clearance.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('clearance.manage', adult_clearance.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- honour — read: player.profile.read · write: recognition.manage
ALTER TABLE honour ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS honour_read   ON honour;
DROP POLICY IF EXISTS honour_insert ON honour;
DROP POLICY IF EXISTS honour_update ON honour;
DROP POLICY IF EXISTS honour_delete ON honour;

CREATE POLICY honour_read ON honour
  FOR SELECT USING (app_can('player.profile.read', honour.school_id, (SELECT p.team_code FROM player p WHERE p.id = honour.player_id), honour.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY honour_insert ON honour
  FOR INSERT WITH CHECK (app_can('recognition.manage', honour.school_id, (SELECT p.team_code FROM player p WHERE p.id = honour.player_id), honour.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY honour_update ON honour
  FOR UPDATE USING (app_can('recognition.manage', honour.school_id, (SELECT p.team_code FROM player p WHERE p.id = honour.player_id), honour.player_id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('recognition.manage', honour.school_id, (SELECT p.team_code FROM player p WHERE p.id = honour.player_id), honour.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- cap_baseline — read: team.read · write: recognition.manage
ALTER TABLE cap_baseline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cap_baseline_read   ON cap_baseline;
DROP POLICY IF EXISTS cap_baseline_insert ON cap_baseline;
DROP POLICY IF EXISTS cap_baseline_update ON cap_baseline;
DROP POLICY IF EXISTS cap_baseline_delete ON cap_baseline;

CREATE POLICY cap_baseline_read ON cap_baseline
  FOR SELECT USING (app_can('team.read', cap_baseline.school_id, cap_baseline.team_code, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY cap_baseline_insert ON cap_baseline
  FOR INSERT WITH CHECK (app_can('recognition.manage', cap_baseline.school_id, cap_baseline.team_code, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY cap_baseline_update ON cap_baseline
  FOR UPDATE USING (app_can('recognition.manage', cap_baseline.school_id, cap_baseline.team_code, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('recognition.manage', cap_baseline.school_id, cap_baseline.team_code, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- emergency_contact — read: player.emergency.read · write: player.emergency.manage
ALTER TABLE emergency_contact ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emergency_contact_read   ON emergency_contact;
DROP POLICY IF EXISTS emergency_contact_insert ON emergency_contact;
DROP POLICY IF EXISTS emergency_contact_update ON emergency_contact;
DROP POLICY IF EXISTS emergency_contact_delete ON emergency_contact;

CREATE POLICY emergency_contact_read ON emergency_contact
  FOR SELECT USING (app_can('player.emergency.read', emergency_contact.school_id, (SELECT p.team_code FROM player p WHERE p.id = emergency_contact.player_id), emergency_contact.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY emergency_contact_insert ON emergency_contact
  FOR INSERT WITH CHECK (app_can('player.emergency.manage', emergency_contact.school_id, (SELECT p.team_code FROM player p WHERE p.id = emergency_contact.player_id), emergency_contact.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY emergency_contact_update ON emergency_contact
  FOR UPDATE USING (app_can('player.emergency.manage', emergency_contact.school_id, (SELECT p.team_code FROM player p WHERE p.id = emergency_contact.player_id), emergency_contact.player_id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('player.emergency.manage', emergency_contact.school_id, (SELECT p.team_code FROM player p WHERE p.id = emergency_contact.player_id), emergency_contact.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- injury — read: medical.status.read · write: medical.write
ALTER TABLE injury ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS injury_read   ON injury;
DROP POLICY IF EXISTS injury_insert ON injury;
DROP POLICY IF EXISTS injury_update ON injury;
DROP POLICY IF EXISTS injury_delete ON injury;

CREATE POLICY injury_read ON injury
  FOR SELECT USING (app_can('medical.status.read', injury.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury.player_id), injury.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY injury_insert ON injury
  FOR INSERT WITH CHECK (app_can('medical.write', injury.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury.player_id), injury.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY injury_update ON injury
  FOR UPDATE USING (app_can('medical.write', injury.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury.player_id), injury.player_id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('medical.write', injury.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury.player_id), injury.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- match — read: fixture.read (from 2 scopes) · write: fixture.update
ALTER TABLE match ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_read   ON match;
DROP POLICY IF EXISTS match_insert ON match;
DROP POLICY IF EXISTS match_update ON match;
DROP POLICY IF EXISTS match_delete ON match;

CREATE POLICY match_read ON match
  FOR SELECT USING ((app_can('fixture.read', match.school_id, match.team_code, '00000000-0000-0000-0000-000000000000'::uuid, match.id))
    OR app_can('fixture.read', match.away_school_id, match.away_team_code, '00000000-0000-0000-0000-000000000000'::uuid, match.id));

CREATE POLICY match_insert ON match
  FOR INSERT WITH CHECK (app_can('fixture.update', match.school_id, match.team_code, '00000000-0000-0000-0000-000000000000'::uuid, match.id));

CREATE POLICY match_update ON match
  FOR UPDATE USING (app_can('fixture.update', match.school_id, match.team_code, '00000000-0000-0000-0000-000000000000'::uuid, match.id))
           WITH CHECK (app_can('fixture.update', match.school_id, match.team_code, '00000000-0000-0000-0000-000000000000'::uuid, match.id));

-- ground — read: facility.read · write: facility.manage
ALTER TABLE ground ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ground_read   ON ground;
DROP POLICY IF EXISTS ground_insert ON ground;
DROP POLICY IF EXISTS ground_update ON ground;
DROP POLICY IF EXISTS ground_delete ON ground;

CREATE POLICY ground_read ON ground
  FOR SELECT USING (app_can('facility.read', ground.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY ground_insert ON ground
  FOR INSERT WITH CHECK (app_can('facility.manage', ground.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY ground_update ON ground
  FOR UPDATE USING (app_can('facility.manage', ground.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('facility.manage', ground.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- match_squad — read: player.profile.read · write: team.select
ALTER TABLE match_squad ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_squad_read   ON match_squad;
DROP POLICY IF EXISTS match_squad_insert ON match_squad;
DROP POLICY IF EXISTS match_squad_update ON match_squad;
DROP POLICY IF EXISTS match_squad_delete ON match_squad;

CREATE POLICY match_squad_read ON match_squad
  FOR SELECT USING (app_can('player.profile.read', (SELECT CASE WHEN match_squad.side = 'away' THEN m.away_school_id ELSE m.school_id END FROM match m WHERE m.id = match_squad.match_id), (SELECT CASE WHEN match_squad.side = 'away' THEN m.away_team_code ELSE m.team_code END FROM match m WHERE m.id = match_squad.match_id), match_squad.player_id, match_squad.match_id));

CREATE POLICY match_squad_insert ON match_squad
  FOR INSERT WITH CHECK (app_can('team.select', (SELECT CASE WHEN match_squad.side = 'away' THEN m.away_school_id ELSE m.school_id END FROM match m WHERE m.id = match_squad.match_id), (SELECT CASE WHEN match_squad.side = 'away' THEN m.away_team_code ELSE m.team_code END FROM match m WHERE m.id = match_squad.match_id), match_squad.player_id, match_squad.match_id));

CREATE POLICY match_squad_update ON match_squad
  FOR UPDATE USING (app_can('team.select', (SELECT CASE WHEN match_squad.side = 'away' THEN m.away_school_id ELSE m.school_id END FROM match m WHERE m.id = match_squad.match_id), (SELECT CASE WHEN match_squad.side = 'away' THEN m.away_team_code ELSE m.team_code END FROM match m WHERE m.id = match_squad.match_id), match_squad.player_id, match_squad.match_id))
           WITH CHECK (app_can('team.select', (SELECT CASE WHEN match_squad.side = 'away' THEN m.away_school_id ELSE m.school_id END FROM match m WHERE m.id = match_squad.match_id), (SELECT CASE WHEN match_squad.side = 'away' THEN m.away_team_code ELSE m.team_code END FROM match m WHERE m.id = match_squad.match_id), match_squad.player_id, match_squad.match_id));

-- competition — read: competition.read · write: competition.manage
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE competition ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competition_read   ON competition;
DROP POLICY IF EXISTS competition_insert ON competition;
DROP POLICY IF EXISTS competition_update ON competition;
DROP POLICY IF EXISTS competition_delete ON competition;

CREATE POLICY competition_read ON competition
  FOR SELECT USING ((app_can('competition.read', competition.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    OR (competition_visible(competition.id)));

CREATE POLICY competition_insert ON competition
  FOR INSERT WITH CHECK (app_can('competition.manage', competition.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY competition_update ON competition
  FOR UPDATE USING (app_can('competition.manage', competition.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('competition.manage', competition.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- competition_entrant — read: competition.read · write: competition.manage
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE competition_entrant ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competition_entrant_read   ON competition_entrant;
DROP POLICY IF EXISTS competition_entrant_insert ON competition_entrant;
DROP POLICY IF EXISTS competition_entrant_update ON competition_entrant;
DROP POLICY IF EXISTS competition_entrant_delete ON competition_entrant;

CREATE POLICY competition_entrant_read ON competition_entrant
  FOR SELECT USING ((app_can('competition.read', competition_entrant.school_id, (COALESCE(competition_entrant.team_code, '*'::text)), '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    OR (competition_visible(competition_entrant.competition_id)));

CREATE POLICY competition_entrant_insert ON competition_entrant
  FOR INSERT WITH CHECK (app_can('competition.manage', competition_entrant.school_id, (COALESCE(competition_entrant.team_code, '*'::text)), '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY competition_entrant_update ON competition_entrant
  FOR UPDATE USING (app_can('competition.manage', competition_entrant.school_id, (COALESCE(competition_entrant.team_code, '*'::text)), '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('competition.manage', competition_entrant.school_id, (COALESCE(competition_entrant.team_code, '*'::text)), '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- training_session — read: team.read · write: team.manage
ALTER TABLE training_session ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS training_session_read   ON training_session;
DROP POLICY IF EXISTS training_session_insert ON training_session;
DROP POLICY IF EXISTS training_session_update ON training_session;
DROP POLICY IF EXISTS training_session_delete ON training_session;

CREATE POLICY training_session_read ON training_session
  FOR SELECT USING (app_can('team.read', training_session.school_id, training_session.team_code, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY training_session_insert ON training_session
  FOR INSERT WITH CHECK (app_can('team.manage', training_session.school_id, training_session.team_code, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY training_session_update ON training_session
  FOR UPDATE USING (app_can('team.manage', training_session.school_id, training_session.team_code, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('team.manage', training_session.school_id, training_session.team_code, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- training_attendance — read: player.profile.read · write: team.manage
ALTER TABLE training_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS training_attendance_read   ON training_attendance;
DROP POLICY IF EXISTS training_attendance_insert ON training_attendance;
DROP POLICY IF EXISTS training_attendance_update ON training_attendance;
DROP POLICY IF EXISTS training_attendance_delete ON training_attendance;

CREATE POLICY training_attendance_read ON training_attendance
  FOR SELECT USING (app_can('player.profile.read', (SELECT t.school_id FROM training_session t WHERE t.id = training_attendance.session_id), (SELECT t.team_code FROM training_session t WHERE t.id = training_attendance.session_id), training_attendance.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY training_attendance_insert ON training_attendance
  FOR INSERT WITH CHECK (app_can('team.manage', (SELECT t.school_id FROM training_session t WHERE t.id = training_attendance.session_id), (SELECT t.team_code FROM training_session t WHERE t.id = training_attendance.session_id), training_attendance.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY training_attendance_update ON training_attendance
  FOR UPDATE USING (app_can('team.manage', (SELECT t.school_id FROM training_session t WHERE t.id = training_attendance.session_id), (SELECT t.team_code FROM training_session t WHERE t.id = training_attendance.session_id), training_attendance.player_id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('team.manage', (SELECT t.school_id FROM training_session t WHERE t.id = training_attendance.session_id), (SELECT t.team_code FROM training_session t WHERE t.id = training_attendance.session_id), training_attendance.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- development_note — read: player.note.read · write: player.note.write
ALTER TABLE development_note ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS development_note_read   ON development_note;
DROP POLICY IF EXISTS development_note_insert ON development_note;
DROP POLICY IF EXISTS development_note_update ON development_note;
DROP POLICY IF EXISTS development_note_delete ON development_note;

CREATE POLICY development_note_read ON development_note
  FOR SELECT USING (app_can('player.note.read', development_note.school_id, (SELECT p.team_code FROM player p WHERE p.id = development_note.player_id), development_note.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY development_note_insert ON development_note
  FOR INSERT WITH CHECK (app_can('player.note.write', development_note.school_id, (SELECT p.team_code FROM player p WHERE p.id = development_note.player_id), development_note.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY development_note_update ON development_note
  FOR UPDATE USING (app_can('player.note.write', development_note.school_id, (SELECT p.team_code FROM player p WHERE p.id = development_note.player_id), development_note.player_id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('player.note.write', development_note.school_id, (SELECT p.team_code FROM player p WHERE p.id = development_note.player_id), development_note.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- player_skill — read: player.development.read · write: player.development.write
ALTER TABLE player_skill ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_skill_read   ON player_skill;
DROP POLICY IF EXISTS player_skill_insert ON player_skill;
DROP POLICY IF EXISTS player_skill_update ON player_skill;
DROP POLICY IF EXISTS player_skill_delete ON player_skill;

CREATE POLICY player_skill_read ON player_skill
  FOR SELECT USING (app_can('player.development.read', (SELECT p.school_id FROM player p WHERE p.id = player_skill.player_id), (SELECT p.team_code FROM player p WHERE p.id = player_skill.player_id), player_skill.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY player_skill_insert ON player_skill
  FOR INSERT WITH CHECK (app_can('player.development.write', (SELECT p.school_id FROM player p WHERE p.id = player_skill.player_id), (SELECT p.team_code FROM player p WHERE p.id = player_skill.player_id), player_skill.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY player_skill_update ON player_skill
  FOR UPDATE USING (app_can('player.development.write', (SELECT p.school_id FROM player p WHERE p.id = player_skill.player_id), (SELECT p.team_code FROM player p WHERE p.id = player_skill.player_id), player_skill.player_id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('player.development.write', (SELECT p.school_id FROM player p WHERE p.id = player_skill.player_id), (SELECT p.team_code FROM player p WHERE p.id = player_skill.player_id), player_skill.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- notification — read: news.read AND (notification.required_capability) · write: ('news.publish.' || notification.scope_level)
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_read   ON notification;
DROP POLICY IF EXISTS notification_insert ON notification;
DROP POLICY IF EXISTS notification_update ON notification;
DROP POLICY IF EXISTS notification_delete ON notification;

CREATE POLICY notification_read ON notification
  FOR SELECT USING (app_can('news.read', notification.school_id, (COALESCE(notification.team_code, '*'::text)), (COALESCE(notification.subject_person_id, '00000000-0000-0000-0000-000000000000'::uuid)), '00000000-0000-0000-0000-000000000000'::uuid)
       AND app_can((notification.required_capability), notification.school_id, (COALESCE(notification.team_code, '*'::text)), (COALESCE(notification.subject_person_id, '00000000-0000-0000-0000-000000000000'::uuid)), '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY notification_insert ON notification
  FOR INSERT WITH CHECK (app_can(('news.publish.' || notification.scope_level), notification.school_id, (COALESCE(notification.team_code, '*'::text)), (COALESCE(notification.subject_person_id, '00000000-0000-0000-0000-000000000000'::uuid)), '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY notification_update ON notification
  FOR UPDATE USING (app_can(('news.publish.' || notification.scope_level), notification.school_id, (COALESCE(notification.team_code, '*'::text)), (COALESCE(notification.subject_person_id, '00000000-0000-0000-0000-000000000000'::uuid)), '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can(('news.publish.' || notification.scope_level), notification.school_id, (COALESCE(notification.team_code, '*'::text)), (COALESCE(notification.subject_person_id, '00000000-0000-0000-0000-000000000000'::uuid)), '00000000-0000-0000-0000-000000000000'::uuid));

-- match_toss — read: fixture.read · write: scoring.start
ALTER TABLE match_toss ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_toss_read   ON match_toss;
DROP POLICY IF EXISTS match_toss_insert ON match_toss;
DROP POLICY IF EXISTS match_toss_update ON match_toss;
DROP POLICY IF EXISTS match_toss_delete ON match_toss;

CREATE POLICY match_toss_read ON match_toss
  FOR SELECT USING (app_can('fixture.read', (SELECT m.school_id FROM match m WHERE m.id = match_toss.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_toss.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_toss.match_id));

CREATE POLICY match_toss_insert ON match_toss
  FOR INSERT WITH CHECK (app_can('scoring.start', (SELECT m.school_id FROM match m WHERE m.id = match_toss.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_toss.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_toss.match_id));

CREATE POLICY match_toss_update ON match_toss
  FOR UPDATE USING (app_can('scoring.start', (SELECT m.school_id FROM match m WHERE m.id = match_toss.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_toss.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_toss.match_id))
           WITH CHECK (app_can('scoring.start', (SELECT m.school_id FROM match m WHERE m.id = match_toss.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_toss.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_toss.match_id));

-- match_broadcast — read: fixture.read · write: broadcast.publish
ALTER TABLE match_broadcast ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_broadcast_read   ON match_broadcast;
DROP POLICY IF EXISTS match_broadcast_insert ON match_broadcast;
DROP POLICY IF EXISTS match_broadcast_update ON match_broadcast;
DROP POLICY IF EXISTS match_broadcast_delete ON match_broadcast;

CREATE POLICY match_broadcast_read ON match_broadcast
  FOR SELECT USING (app_can('fixture.read', (SELECT m.school_id FROM match m WHERE m.id = match_broadcast.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_broadcast.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_broadcast.match_id));

CREATE POLICY match_broadcast_insert ON match_broadcast
  FOR INSERT WITH CHECK (app_can('broadcast.publish', (SELECT m.school_id FROM match m WHERE m.id = match_broadcast.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_broadcast.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_broadcast.match_id));

CREATE POLICY match_broadcast_update ON match_broadcast
  FOR UPDATE USING (app_can('broadcast.publish', (SELECT m.school_id FROM match m WHERE m.id = match_broadcast.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_broadcast.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_broadcast.match_id))
           WITH CHECK (app_can('broadcast.publish', (SELECT m.school_id FROM match m WHERE m.id = match_broadcast.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_broadcast.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_broadcast.match_id));

-- drs_review — read: fixture.read · write: scoring.correct
ALTER TABLE drs_review ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drs_review_read   ON drs_review;
DROP POLICY IF EXISTS drs_review_insert ON drs_review;
DROP POLICY IF EXISTS drs_review_update ON drs_review;
DROP POLICY IF EXISTS drs_review_delete ON drs_review;

CREATE POLICY drs_review_read ON drs_review
  FOR SELECT USING (app_can('fixture.read', (SELECT m.school_id FROM match m WHERE m.id = drs_review.match_id), (SELECT m.team_code FROM match m WHERE m.id = drs_review.match_id), '00000000-0000-0000-0000-000000000000'::uuid, drs_review.match_id));

CREATE POLICY drs_review_insert ON drs_review
  FOR INSERT WITH CHECK (app_can('scoring.correct', (SELECT m.school_id FROM match m WHERE m.id = drs_review.match_id), (SELECT m.team_code FROM match m WHERE m.id = drs_review.match_id), '00000000-0000-0000-0000-000000000000'::uuid, drs_review.match_id));

CREATE POLICY drs_review_update ON drs_review
  FOR UPDATE USING (app_can('scoring.correct', (SELECT m.school_id FROM match m WHERE m.id = drs_review.match_id), (SELECT m.team_code FROM match m WHERE m.id = drs_review.match_id), '00000000-0000-0000-0000-000000000000'::uuid, drs_review.match_id))
           WITH CHECK (app_can('scoring.correct', (SELECT m.school_id FROM match m WHERE m.id = drs_review.match_id), (SELECT m.team_code FROM match m WHERE m.id = drs_review.match_id), '00000000-0000-0000-0000-000000000000'::uuid, drs_review.match_id));

-- derby — read: fixture.read · write: fixture.update
ALTER TABLE derby ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS derby_read   ON derby;
DROP POLICY IF EXISTS derby_insert ON derby;
DROP POLICY IF EXISTS derby_update ON derby;
DROP POLICY IF EXISTS derby_delete ON derby;

CREATE POLICY derby_read ON derby
  FOR SELECT USING (app_can('fixture.read', derby.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY derby_insert ON derby
  FOR INSERT WITH CHECK (app_can('fixture.update', derby.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY derby_update ON derby
  FOR UPDATE USING (app_can('fixture.update', derby.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('fixture.update', derby.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ground_condition — read: facility.read · write: facility.manage
ALTER TABLE ground_condition ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ground_condition_read   ON ground_condition;
DROP POLICY IF EXISTS ground_condition_insert ON ground_condition;
DROP POLICY IF EXISTS ground_condition_update ON ground_condition;
DROP POLICY IF EXISTS ground_condition_delete ON ground_condition;

CREATE POLICY ground_condition_read ON ground_condition
  FOR SELECT USING (app_can('facility.read', (SELECT g.school_id FROM ground g WHERE g.id = ground_condition.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY ground_condition_insert ON ground_condition
  FOR INSERT WITH CHECK (app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_condition.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY ground_condition_update ON ground_condition
  FOR UPDATE USING (app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_condition.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_condition.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- match_official — read: fixture.read · write: officiating.assign
ALTER TABLE match_official ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_official_read   ON match_official;
DROP POLICY IF EXISTS match_official_insert ON match_official;
DROP POLICY IF EXISTS match_official_update ON match_official;
DROP POLICY IF EXISTS match_official_delete ON match_official;

CREATE POLICY match_official_read ON match_official
  FOR SELECT USING (app_can('fixture.read', (SELECT m.school_id FROM match m WHERE m.id = match_official.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_official.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_official.match_id));

CREATE POLICY match_official_insert ON match_official
  FOR INSERT WITH CHECK (app_can('officiating.assign', (SELECT m.school_id FROM match m WHERE m.id = match_official.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_official.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_official.match_id));

CREATE POLICY match_official_update ON match_official
  FOR UPDATE USING (app_can('officiating.assign', (SELECT m.school_id FROM match m WHERE m.id = match_official.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_official.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_official.match_id))
           WITH CHECK (app_can('officiating.assign', (SELECT m.school_id FROM match m WHERE m.id = match_official.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_official.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_official.match_id));

-- match_pitch_report — read: fixture.read · write: facility.manage
ALTER TABLE match_pitch_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_pitch_report_read   ON match_pitch_report;
DROP POLICY IF EXISTS match_pitch_report_insert ON match_pitch_report;
DROP POLICY IF EXISTS match_pitch_report_update ON match_pitch_report;
DROP POLICY IF EXISTS match_pitch_report_delete ON match_pitch_report;

CREATE POLICY match_pitch_report_read ON match_pitch_report
  FOR SELECT USING (app_can('fixture.read', (SELECT m.school_id FROM match m WHERE m.id = match_pitch_report.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_pitch_report.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_pitch_report.match_id));

CREATE POLICY match_pitch_report_insert ON match_pitch_report
  FOR INSERT WITH CHECK (app_can('facility.manage', (SELECT m.school_id FROM match m WHERE m.id = match_pitch_report.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_pitch_report.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_pitch_report.match_id));

CREATE POLICY match_pitch_report_update ON match_pitch_report
  FOR UPDATE USING (app_can('facility.manage', (SELECT m.school_id FROM match m WHERE m.id = match_pitch_report.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_pitch_report.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_pitch_report.match_id))
           WITH CHECK (app_can('facility.manage', (SELECT m.school_id FROM match m WHERE m.id = match_pitch_report.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_pitch_report.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_pitch_report.match_id));

-- vehicle — read: transport.read · write: transport.manage
ALTER TABLE vehicle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_read   ON vehicle;
DROP POLICY IF EXISTS vehicle_insert ON vehicle;
DROP POLICY IF EXISTS vehicle_update ON vehicle;
DROP POLICY IF EXISTS vehicle_delete ON vehicle;

CREATE POLICY vehicle_read ON vehicle
  FOR SELECT USING (app_can('transport.read', vehicle.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY vehicle_insert ON vehicle
  FOR INSERT WITH CHECK (app_can('transport.manage', vehicle.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY vehicle_update ON vehicle
  FOR UPDATE USING (app_can('transport.manage', vehicle.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('transport.manage', vehicle.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- trip — read: transport.read · write: transport.manage
ALTER TABLE trip ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trip_read   ON trip;
DROP POLICY IF EXISTS trip_insert ON trip;
DROP POLICY IF EXISTS trip_update ON trip;
DROP POLICY IF EXISTS trip_delete ON trip;

CREATE POLICY trip_read ON trip
  FOR SELECT USING (app_can('transport.read', (SELECT m.school_id FROM match m WHERE m.id = trip.match_id), (SELECT m.team_code FROM match m WHERE m.id = trip.match_id), '00000000-0000-0000-0000-000000000000'::uuid, trip.match_id));

CREATE POLICY trip_insert ON trip
  FOR INSERT WITH CHECK (app_can('transport.manage', (SELECT m.school_id FROM match m WHERE m.id = trip.match_id), (SELECT m.team_code FROM match m WHERE m.id = trip.match_id), '00000000-0000-0000-0000-000000000000'::uuid, trip.match_id));

CREATE POLICY trip_update ON trip
  FOR UPDATE USING (app_can('transport.manage', (SELECT m.school_id FROM match m WHERE m.id = trip.match_id), (SELECT m.team_code FROM match m WHERE m.id = trip.match_id), '00000000-0000-0000-0000-000000000000'::uuid, trip.match_id))
           WITH CHECK (app_can('transport.manage', (SELECT m.school_id FROM match m WHERE m.id = trip.match_id), (SELECT m.team_code FROM match m WHERE m.id = trip.match_id), '00000000-0000-0000-0000-000000000000'::uuid, trip.match_id));

-- match_availability — read: availability.read · write: availability.declare
ALTER TABLE match_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_availability_read   ON match_availability;
DROP POLICY IF EXISTS match_availability_insert ON match_availability;
DROP POLICY IF EXISTS match_availability_update ON match_availability;
DROP POLICY IF EXISTS match_availability_delete ON match_availability;

CREATE POLICY match_availability_read ON match_availability
  FOR SELECT USING (app_can('availability.read', (SELECT m.school_id FROM match m WHERE m.id = match_availability.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_availability.match_id), match_availability.player_id, match_availability.match_id));

CREATE POLICY match_availability_insert ON match_availability
  FOR INSERT WITH CHECK (app_can('availability.declare', (SELECT m.school_id FROM match m WHERE m.id = match_availability.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_availability.match_id), match_availability.player_id, match_availability.match_id));

CREATE POLICY match_availability_update ON match_availability
  FOR UPDATE USING (app_can('availability.declare', (SELECT m.school_id FROM match m WHERE m.id = match_availability.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_availability.match_id), match_availability.player_id, match_availability.match_id))
           WITH CHECK (app_can('availability.declare', (SELECT m.school_id FROM match m WHERE m.id = match_availability.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_availability.match_id), match_availability.player_id, match_availability.match_id));

-- sponsor — read: sponsorship.read · write: sponsorship.manage
ALTER TABLE sponsor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sponsor_read   ON sponsor;
DROP POLICY IF EXISTS sponsor_insert ON sponsor;
DROP POLICY IF EXISTS sponsor_update ON sponsor;
DROP POLICY IF EXISTS sponsor_delete ON sponsor;

CREATE POLICY sponsor_read ON sponsor
  FOR SELECT USING (app_can('sponsorship.read', sponsor.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY sponsor_insert ON sponsor
  FOR INSERT WITH CHECK (app_can('sponsorship.manage', sponsor.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY sponsor_update ON sponsor
  FOR UPDATE USING (app_can('sponsorship.manage', sponsor.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('sponsorship.manage', sponsor.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- sponsorship — read: sponsorship.read · write: sponsorship.manage
ALTER TABLE sponsorship ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sponsorship_read   ON sponsorship;
DROP POLICY IF EXISTS sponsorship_insert ON sponsorship;
DROP POLICY IF EXISTS sponsorship_update ON sponsorship;
DROP POLICY IF EXISTS sponsorship_delete ON sponsorship;

CREATE POLICY sponsorship_read ON sponsorship
  FOR SELECT USING (app_can('sponsorship.read', sponsorship.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY sponsorship_insert ON sponsorship
  FOR INSERT WITH CHECK (app_can('sponsorship.manage', sponsorship.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY sponsorship_update ON sponsorship
  FOR UPDATE USING (app_can('sponsorship.manage', sponsorship.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('sponsorship.manage', sponsorship.school_id, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- match_weather — read: fixture.read · write: fixture.update
ALTER TABLE match_weather ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_weather_read   ON match_weather;
DROP POLICY IF EXISTS match_weather_insert ON match_weather;
DROP POLICY IF EXISTS match_weather_update ON match_weather;
DROP POLICY IF EXISTS match_weather_delete ON match_weather;

CREATE POLICY match_weather_read ON match_weather
  FOR SELECT USING (app_can('fixture.read', (SELECT m.school_id FROM match m WHERE m.id = match_weather.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_weather.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_weather.match_id));

CREATE POLICY match_weather_insert ON match_weather
  FOR INSERT WITH CHECK (app_can('fixture.update', (SELECT m.school_id FROM match m WHERE m.id = match_weather.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_weather.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_weather.match_id));

CREATE POLICY match_weather_update ON match_weather
  FOR UPDATE USING (app_can('fixture.update', (SELECT m.school_id FROM match m WHERE m.id = match_weather.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_weather.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_weather.match_id))
           WITH CHECK (app_can('fixture.update', (SELECT m.school_id FROM match m WHERE m.id = match_weather.match_id), (SELECT m.team_code FROM match m WHERE m.id = match_weather.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_weather.match_id));

-- ══════════════════════════════════════════════════════════════════
--  Column-masking views
-- ══════════════════════════════════════════════════════════════════

-- player_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as `SELECT t.*, CASE …`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_player$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'player.school_id',
                            g.team_anchor,
                            'player.id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('id_number', 'player.identity.read', 'player.team_code'), ('email', 'player.pii.read', 'player.team_code'), ('phone', 'player.pii.read', 'player.team_code'), ('hometown', 'player.pii.read', 'player.team_code'), ('houseatschool', 'player.pii.read', 'player.team_code'), ('address', 'player.pii.read', 'player.team_code'), ('guardian', 'player.pii.read', 'player.team_code'), ('height', 'player.biometric.read', 'player.team_code'), ('weight', 'player.biometric.read', 'player.team_code'), ('born', 'player.age.read', '''*''::text')) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'player';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build player_masked: table player not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    -- security_invoker is the load-bearing word here, and it is easy to read
    -- past. A view runs with the permissions of its OWNER unless told
    -- otherwise, and the owner of this one owns player too — so row-level
    -- security on player was evaluated as a role that bypasses it, and this
    -- view returned EVERY row in the table to anyone who could select from it.
    -- Cross-school, cross-tenant, through the one object the read path is
    -- required to use for personal information. Masking still applied, so a
    -- leaked row had its sensitive columns nulled and looked entirely correct.
    -- security_barrier alone does not help: it controls when predicates may be
    -- pushed down, not whose policies apply.
    'CREATE OR REPLACE VIEW player_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM player',
    cols);
END
$mask_player$;

-- coach_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as `SELECT t.*, CASE …`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_coach$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'coach.school_id',
                            g.team_anchor,
                            'coach.id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('email', 'player.pii.read', 'coach.team_code'), ('phone', 'player.pii.read', 'coach.team_code'), ('born', 'player.pii.read', 'coach.team_code'), ('hometown', 'player.pii.read', 'coach.team_code'), ('address', 'player.pii.read', 'coach.team_code')) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'coach';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build coach_masked: table coach not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    -- security_invoker is the load-bearing word here, and it is easy to read
    -- past. A view runs with the permissions of its OWNER unless told
    -- otherwise, and the owner of this one owns coach too — so row-level
    -- security on coach was evaluated as a role that bypasses it, and this
    -- view returned EVERY row in the table to anyone who could select from it.
    -- Cross-school, cross-tenant, through the one object the read path is
    -- required to use for personal information. Masking still applied, so a
    -- leaked row had its sensitive columns nulled and looked entirely correct.
    -- security_barrier alone does not help: it controls when predicates may be
    -- pushed down, not whose policies apply.
    'CREATE OR REPLACE VIEW coach_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM coach',
    cols);
END
$mask_coach$;

-- staff_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as `SELECT t.*, CASE …`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_staff$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'staff.school_id',
                            g.team_anchor,
                            'staff.id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('email', 'player.pii.read', 'NULL::text'), ('phone', 'player.pii.read', 'NULL::text'), ('born', 'player.pii.read', 'NULL::text'), ('hometown', 'player.pii.read', 'NULL::text'), ('address', 'player.pii.read', 'NULL::text')) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'staff';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build staff_masked: table staff not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    -- security_invoker is the load-bearing word here, and it is easy to read
    -- past. A view runs with the permissions of its OWNER unless told
    -- otherwise, and the owner of this one owns staff too — so row-level
    -- security on staff was evaluated as a role that bypasses it, and this
    -- view returned EVERY row in the table to anyone who could select from it.
    -- Cross-school, cross-tenant, through the one object the read path is
    -- required to use for personal information. Masking still applied, so a
    -- leaked row had its sensitive columns nulled and looked entirely correct.
    -- security_barrier alone does not help: it controls when predicates may be
    -- pushed down, not whose policies apply.
    'CREATE OR REPLACE VIEW staff_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM staff',
    cols);
END
$mask_staff$;

-- injury_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as `SELECT t.*, CASE …`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_injury$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'injury.school_id',
                            g.team_anchor,
                            'injury.player_id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('injury_type', 'medical.nature.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('severity', 'medical.nature.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('phase', 'medical.nature.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('notes', 'medical.details.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('physio', 'medical.details.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)')) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'injury';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build injury_masked: table injury not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    -- security_invoker is the load-bearing word here, and it is easy to read
    -- past. A view runs with the permissions of its OWNER unless told
    -- otherwise, and the owner of this one owns injury too — so row-level
    -- security on injury was evaluated as a role that bypasses it, and this
    -- view returned EVERY row in the table to anyone who could select from it.
    -- Cross-school, cross-tenant, through the one object the read path is
    -- required to use for personal information. Masking still applied, so a
    -- leaked row had its sensitive columns nulled and looked entirely correct.
    -- security_barrier alone does not help: it controls when predicates may be
    -- pushed down, not whose policies apply.
    'CREATE OR REPLACE VIEW injury_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM injury',
    cols);
END
$mask_injury$;

-- sponsorship_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as `SELECT t.*, CASE …`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_sponsorship$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'sponsorship.school_id',
                            g.team_anchor,
                            '''00000000-0000-0000-0000-000000000000''::uuid',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('contract_value_zar', 'sponsorship.finance.read', '''*''::text'), ('school_share_pct', 'sponsorship.finance.read', '''*''::text')) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'sponsorship';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build sponsorship_masked: table sponsorship not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    -- security_invoker is the load-bearing word here, and it is easy to read
    -- past. A view runs with the permissions of its OWNER unless told
    -- otherwise, and the owner of this one owns sponsorship too — so row-level
    -- security on sponsorship was evaluated as a role that bypasses it, and this
    -- view returned EVERY row in the table to anyone who could select from it.
    -- Cross-school, cross-tenant, through the one object the read path is
    -- required to use for personal information. Masking still applied, so a
    -- leaked row had its sensitive columns nulled and looked entirely correct.
    -- security_barrier alone does not help: it controls when predicates may be
    -- pushed down, not whose policies apply.
    'CREATE OR REPLACE VIEW sponsorship_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM sponsorship',
    cols);
END
$mask_sponsorship$;

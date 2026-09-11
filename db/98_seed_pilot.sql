-- ════════════════════════════════════════════════════════════════
--  SCRBRD — Pilot seed data
--
--  The fixtures 99_rls_verify.sql asserts against: school HIL, a 1XI
--  squad, one injured player, a second team so team-scoping has
--  something to exclude, and a second school so school-scoping does too.
--
--  ⚠️ DEMONSTRATION DATA. Every person here is invented. Real pilot
--  rosters are personal information about minors and do not belong in a
--  repository — they are loaded per-tenant, under the school's consent
--  framework, and never committed.
--
--  Apply after 00–03:  psql "$DATABASE_URL" -f db/98_seed_pilot.sql
-- ════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO school (id, code, name, kind, province) VALUES
  ('11111111-1111-1111-1111-111111111111', 'HIL', 'Hilton College',        'school', 'KwaZulu-Natal'),
  ('22222222-2222-2222-2222-222222222222', 'WES', 'Westville Boys'' High',  'school', 'KwaZulu-Natal');

-- ── Hilton 1st XI ─────────────────────────────────────────────────
-- The pilot's sides were named at the start of the season, not on the day the
-- seed happened to run. The membership history trigger reads this and dates
-- every first membership accordingly; it is cleared again below so nothing
-- later in the seed inherits a January effective date.
SELECT set_config('app.effective_on', '2026-01-15', false);

INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born, hometown, houseAtSchool, height, weight, guardian) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1XI', 'James Whitfield', 1, 'batter',     '2008-03-14', 'Howick',      'McKenzie', 181, 74, '{"name":"A Whitfield","relation":"father","phone":"+27 82 000 0001"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '1XI', 'T Bekker',        2, 'allrounder', '2008-07-02', 'Pietermaritzburg', 'Falcon', 176, 70, '{"name":"M Bekker","relation":"mother","phone":"+27 82 000 0002"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '1XI', 'S Naidoo',        3, 'bowler',     '2008-11-21', 'Durban',      'Pearce',   179, 68, '{"name":"R Naidoo","relation":"father","phone":"+27 82 000 0003"}'),
  ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '1XI', 'M Cele',          4, 'keeper',     '2009-01-09', 'Pinetown',    'McKenzie', 172, 66, '{"name":"N Cele","relation":"mother","phone":"+27 82 000 0004"}'),
  -- p5 is the injured player 99_rls_verify.sql looks for.
  ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '1XI', 'R Pillay',        5, 'allrounder', '2008-05-30', 'Umhlanga',    'Falcon',   183, 77, '{"name":"D Pillay","relation":"father","phone":"+27 82 000 0005"}'),
  -- A second team, so a team-scoped coach has something to be excluded from.
  ('aaaaaaaa-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'U16B', 'K Dlamini',       7, 'batter',     '2011-02-18', 'Hilton',      'Pearce',   165, 55, '{"name":"S Dlamini","relation":"mother","phone":"+27 82 000 0006"}');

-- A second school, so school scoping has something to exclude.
INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '1XI', 'D Mkhize',  1, 'bowler', '2008-09-12'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '1XI', 'K Botha',   2, 'batter', '2008-04-25');

UPDATE player SET fitness = 'injured' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000005';

-- ID numbers, so "a coach cannot read one" is falsifiable. Without a value in
-- the column the assertion passes by having nothing to find, which is the same
-- vacuous shape as asserting a coach reads no U16B injury when every injury in
-- the fixture is 1XI.
--
-- These are structurally valid but deliberately not real: the date segment
-- matches the player's seeded date of birth, the rest is sequential. Nobody's
-- actual ID number belongs in a repository.
-- Addresses, for the same reason as the ID numbers above: with the column
-- empty everywhere, "a coach cannot read a home address" passes by having
-- nothing to find. Removing `address` from the mask left the roster walk fully
-- green, which is exactly the failure this line closes.
UPDATE player SET address = '12 Example Road, Howick' WHERE school_id = '11111111-1111-1111-1111-111111111111';

UPDATE player SET id_number = '0803145000081' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
UPDATE player SET id_number = '0807025000082' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
UPDATE player SET id_number = '0805305000085' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000005';

INSERT INTO injury (id, school_id, player_id, injury_type, severity, date_injured, rtw_date, phase, restricted, notes, physio) VALUES
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000005',
   'Grade 2 hamstring strain', 'moderate', current_date - 12, current_date + 16, 'rehab', true,
   'Clinical: grade 2 strain, biceps femoris. Managed conservatively.',   -- masked from coach/assistant/headmaster
   'Physio: eccentric loading from week 2, running progression week 3.'); -- masked likewise

-- A second injury, on a different 1XI player. Without it, "a pupil reads
-- their own record and not another's" is unfalsifiable: there is only one
-- injury in the fixture, so returning it and returning everything look
-- identical.
INSERT INTO injury (id, school_id, player_id, injury_type, severity, date_injured, rtw_date, phase, restricted, notes, physio) VALUES
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002',
   'Left shoulder impingement', 'minor', current_date - 5, current_date + 9, 'rehab', true,
   'Clinical: subacromial impingement. Bowling restricted, batting permitted.',
   'Physio: rotator cuff programme, review in two weeks.');

-- A third injury, on a U16B player — a DIFFERENT side at the same school.
-- Without it, "a coach reads no injury outside the side they coach" is
-- vacuous: every injury in the fixture was 1XI, so the assertion passed by
-- having nothing to find. It is the assertion that keeps a coach's clinical
-- access inside their own squad, so it had better be able to fail.
INSERT INTO injury (id, school_id, player_id, injury_type, severity, date_injured, rtw_date, phase, restricted, notes, physio) VALUES
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000006',
   'Wrist sprain', 'minor', current_date - 3, current_date + 11, 'rehab', true,
   'Clinical: scapholunate ligament sprain, immobilised two weeks.',
   'Physio: splint, grip work from week two.');

-- Two U13A players and the U14A coach who should hear about one of them.
-- L Mahlangu turns 14 within the notice window and ages out of U13 for next
-- season; J Sithole turns 13 and stays. Without the second, "only the player
-- who ages out is notified" passes by having nothing to reject.
INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'U13A',
   'L Mahlangu', 1, 'allrounder', (current_date + interval '20 days' - interval '14 years')::date),
  ('aaaaaaaa-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'U13A',
   'J Sithole', 2, 'batter', (current_date + interval '20 days' - interval '13 years')::date),
  -- Ages out, but not for another ninety days. Without him the thirty-day
  -- window is unfalsifiable: widening it to a year changed nothing, because
  -- there was no candidate between the two bounds to pull in.
  ('aaaaaaaa-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'U13A',
   'B Khumalo', 3, 'bowler', (current_date + interval '90 days' - interval '14 years')::date);

-- Cleared only after the LAST player insert: three boys are seeded further
-- down than the first two blocks, and a reset placed after the second block
-- dated their first memberships to the day the seed ran.
SELECT set_config('app.effective_on', '', false);

INSERT INTO app_user (id, school_id, email, name, role, teams) VALUES
  ('88888888-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
   'u14coach@example.invalid', 'T Ndlovu', 'coach', '{U14A}');

-- ── Staff and coaches ───────────────────────────────────────────
INSERT INTO coach (id, school_id, team_code, name, title, email, phone) VALUES
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1XI', 'Craig Hendricks', 'Head Coach',      'chendricks@example.invalid', '+27 82 100 0001'),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'U16B', 'P Moodley',       'Assistant Coach', 'pmoodley@example.invalid',   '+27 82 100 0002');

INSERT INTO staff (id, school_id, name, duty, email, phone) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'L van Wyk',  'medical',       'lvanwyk@example.invalid',  '+27 82 200 0001'),
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'S Zondi',    'groundskeeper', 'szondi@example.invalid',   '+27 82 200 0002'),
  ('eeeeeeee-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'B Ngcobo',   'driver',        'bngcobo@example.invalid',  '+27 82 200 0003');

-- ── Fixtures ────────────────────────────────────────────────────
INSERT INTO ground (id, school_id, name, surface) VALUES
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Gordon Sherwood Oval', 'grass'),
  ('ffffffff-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Westville Main',       'grass');

INSERT INTO competition (id, school_id, name, comp_type, format, age_group, gender, season) VALUES
  ('99999999-0000-0000-0000-000000000001', NULL, 'KZN Schools T20 League', 'league', 'T20', '1XI', 'boys', '2026/27');

-- Matches: one played, one scheduled. Neither carries a score column —
-- the score is derived from ball_event.
INSERT INTO match (id, school_id, team_code, opponent, ground_id, starts_at, format, overs, status) VALUES
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1XI', 'Westville Boys'' High',
   'ffffffff-0000-0000-0000-000000000001', now() - interval '7 days', 'T20', 20, 'complete'),
  ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '1XI', 'Michaelhouse',
   'ffffffff-0000-0000-0000-000000000001', now() + interval '3 days',  'T20', 20, 'scheduled'),
  ('77777777-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'U16B', 'Kearsney College',
   'ffffffff-0000-0000-0000-000000000001', now() + interval '10 days', 'T20', 20, 'scheduled');

-- The completed match had a toss; the two scheduled ones have not been played.
-- 'home' rather than 'Hilton College': the winner is a side in this fixture,
-- which is what makes bats_first() answerable. See match_toss.
INSERT INTO match_toss (match_id, school_id, won_by, decision, called_at) VALUES
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'home', 'bat', now() - interval '7 days');

-- ── Users (one per role under test) ─────────────────────────────
INSERT INTO app_user (id, school_id, email, name, role, player_id, child_ids, teams) VALUES
  ('88888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'spectator@example.invalid', 'A Spectator', 'spectator', NULL, '{}', '{}'),
  ('88888888-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'analyst@example.invalid',   'An Analyst',  'analyst',   NULL, '{}', '{}'),
  ('88888888-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'medical@example.invalid',   'L van Wyk',   'medical',   NULL, '{}', '{}'),
  ('88888888-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'coach@example.invalid',     'C Hendricks', 'coach',     NULL, '{}', '{1XI}'),
  ('88888888-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'parent@example.invalid',    'D Pillay',    'parent',    NULL, '{aaaaaaaa-0000-0000-0000-000000000005}', '{1XI}'),
  ('88888888-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'scorer@example.invalid',    'A Wessels',   'scorer',    NULL, '{}', '{1XI}');

-- ── Role assignments ────────────────────────────────────────────
-- Authority is these rows, not app_user.role. Note Sarah: four assignments,
-- including guardianship of a child at a DIFFERENT school — the case the
-- previous single-school session could not express at all.
INSERT INTO app_user (id, school_id, email, name, role, teams) VALUES
  ('88888888-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'sarah@example.invalid', 'Sarah Mokoena', 'directorofsport', '{U16A}');

INSERT INTO app_user (id, school_id, email, name, role, teams) VALUES
  ('88888888-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'watcher@example.invalid', 'A Watcher', 'spectator', '{}');

-- A 2nd XI coach. Deliberately holds ONE team-scoped coach assignment and
-- nothing else: Sarah coaches U16B but is also director of sport, so she can
-- already see every player at Hilton and cannot demonstrate a coach who has to
-- ask. This is the coach who has to ask.
INSERT INTO app_user (id, school_id, email, name, role, teams) VALUES
  ('88888888-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   'coach2@example.invalid', 'P Moodley', 'coach', '{2XI}');

-- A parent for every other boy in the 1st XI.
--
-- Verbose, and the verbosity is the point: since §12.2 became enforceable a
-- child cannot be SELECTED without a verified, consented guardian link, so a
-- fixture that used to need five player rows now needs five families. That is
-- what a school actually has to capture before it can field a side, and a seed
-- that quietly skipped it would be testing a system nobody can run.
-- The school office. Nobody in this fixture held guardian.link.manage until
-- the links needed verifying, and that absence was itself informative: a
-- demonstration database with coaches, a physio, parents and a head of sport
-- but no registrar describes a school that cannot admit a pupil.
INSERT INTO app_user (id, school_id, email, name, role, teams) VALUES
  ('88888888-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
   'registrar@example.invalid', 'B Naicker', 'schooladmin', '{}'),
  -- And one at Westville, because Sarah's second child is a Westville pupil and
  -- a Hilton administrator has no business verifying his link. The functions
  -- refuse it — guardian.link.manage is checked at the CHILD's school — so a
  -- fixture that had the Hilton office verify him would have been asserting
  -- something the code forbids.
  ('88888888-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222',
   'registrar.wes@example.invalid', 'T Ndlovu', 'schooladmin', '{}'),
  -- A COACH AT THE SECOND SCHOOL, and the fixture that needs one is the whole
  -- point of a shared fixture: a match between two tenants is one row, and the
  -- away side has to have somebody who can read it and name their own XI. Until
  -- this row existed Westville was a school with an administrator and nobody
  -- who does any cricket, so the away half of every policy was untestable —
  -- which is why it had never been tested.
  ('88888888-0000-0000-0000-00000000001a', '22222222-2222-2222-2222-222222222222',
   'coach.wes@example.invalid', 'S Pillay', 'coach', '{1XI}');

INSERT INTO app_user (id, school_id, email, name, role, teams) VALUES
  ('88888888-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   'parent.whitfield@example.invalid', 'H Whitfield', 'parent', '{}'),
  ('88888888-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
   'parent.bekker@example.invalid',    'A Bekker',    'parent', '{}'),
  ('88888888-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111',
   'parent.naidoo@example.invalid',    'V Naidoo',    'parent', '{}'),
  ('88888888-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111',
   'parent.cele@example.invalid',      'N Cele',      'parent', '{}');

-- R Pillay: the injured 1XI player, with an account of their own. The case
-- self-access exists for — a pupil reading their own physiotherapy notes.
INSERT INTO app_user (id, school_id, email, name, role, player_id, teams) VALUES
  ('88888888-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   'pillay@example.invalid', 'R Pillay', 'player', 'aaaaaaaa-0000-0000-0000-000000000005', '{1XI}');

-- The bursar. A school with sponsors and no finance account is the same gap
-- the registrar comment above describes: sponsorship.finance.read is held by
-- this role and by nothing else in the floor bundle, so without an account
-- carrying it, the masking on a contract's value could only ever be observed
-- from the outside — every reader masked, none unmasked, which proves the
-- column is absent rather than that it is guarded.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111',
   'bursar@example.invalid', 'M du Toit', 'finance');

-- The driver, with an account. B Ngcobo has existed as a STAFF row since the
-- first seed and could never sign in, so transport.drive — the capability that
-- says who may report a bus as departed — had no principal that held it. The
-- same gap as the bursar and the head below: a capability nobody can exercise
-- can only ever be observed refusing.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111',
   'driver@example.invalid', 'B Ngcobo', 'driver');

-- A fleet, because three transport capabilities gated a screen drawn entirely
-- from mock arrays and the database had never heard of a bus. The registrations
-- and seat counts match what the mock carried, so the Logistics screen shows
-- the same fixture it always did — from rows this time.
INSERT INTO vehicle (id, school_id, registration, description, kind, capacity,
                     condition, next_service_on, notes) VALUES
  ('4e111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'KZN 482 GP', 'Toyota Quantum 22-seater', 'minibus', 22, 'excellent',
   current_date + 18, 'Passengers must be seated and belted before departure.'),
  ('4e111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'KZN 119 KP', 'Toyota Quantum 14-seater', 'minibus', 14, 'good',
   current_date + 45, NULL),
  ('4e111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'KZN 771 MP', 'Toyota Coaster 30-seater', 'bus', 30, 'good',
   current_date + 12, 'Used primarily for longer trips.')
ON CONFLICT DO NOTHING;

-- Cover recorded and current for every pilot vehicle. The walks that need a
-- lapsed one set the date themselves; a seed that shipped an expired minibus
-- would break every transport walk that picks the first vehicle it finds.
UPDATE vehicle SET insurance_expires_on = '2027-03-31', roadworthy_expires_on = '2027-01-31';

-- Who to ring. The trigger derives school_id from the child and stamps
-- created_by from the session — NULL here, because a seed is nobody's act.
INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000005', 1, 'D Pillay',     'mother',      '+27 82 000 0005', NULL, 'd.pillay@example.invalid', NULL),
  ('aaaaaaaa-0000-0000-0000-000000000005', 2, 'S Pillay',     'grandparent', '+27 31 000 0055', NULL, NULL, 'Works nights — try after seven'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'A Whitfield',  'father',      '+27 82 000 0001', '+27 33 000 0011', NULL, NULL),
  ('bbbbbbbb-0000-0000-0000-000000000002', 1, 'M Botha',      'mother',      '+27 82 000 0202', NULL, NULL, NULL);

-- The head. A school with sponsors and no principal is the same gap the
-- bursar comment above describes, and a sharper one: sponsorship.exclusivity.waive
-- is held by this role and by nothing else, so without an account carrying it
-- the waiver path could only ever be observed failing.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111',
   'principal@example.invalid', 'Dr N Mkhize', 'principal');

-- The platform account. Not scoped to a school at all — this is what
-- verifies a scout's accreditation, and accrediting an external organisation
-- is not a claim about any one school's roster.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111',
   'platform@example.invalid', 'Platform Ops', 'platformadmin');

INSERT INTO role_assignment (id, person_id, role, school_id, team_code) VALUES
  ('a5510000-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000001', 'player',          '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000002', '88888888-0000-0000-0000-000000000002', 'scout',           '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000003', '88888888-0000-0000-0000-000000000003', 'medical',         '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000004', '88888888-0000-0000-0000-000000000004', 'coach',           '11111111-1111-1111-1111-111111111111', '1XI'),
  ('a5510000-0000-0000-0000-000000000005', '88888888-0000-0000-0000-000000000005', 'guardian',        '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000006', '88888888-0000-0000-0000-000000000006', 'scorer',          '11111111-1111-1111-1111-111111111111', NULL),
  -- Sarah, four ways.
  ('a5510000-0000-0000-0000-000000000007', '88888888-0000-0000-0000-000000000007', 'directorofsport', '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000008', '88888888-0000-0000-0000-000000000007', 'coach',           '11111111-1111-1111-1111-111111111111', 'U16B'),
  ('a5510000-0000-0000-0000-000000000009', '88888888-0000-0000-0000-000000000007', 'guardian',        '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-00000000000a', '88888888-0000-0000-0000-000000000007', 'guardian',        '22222222-2222-2222-2222-222222222222', NULL),
  -- A genuine spectator. The user seeded as spectator@example.invalid above
  -- holds a PLAYER assignment, and the player bundle includes
  -- medical.status.read — a pupil can see who is available — so it cannot
  -- falsify a claim about medical information. The spectator bundle is
  -- fixture.read, news.read and competition.read and nothing else, which makes
  -- it the principal that proves the notification capability gate does
  -- something: it holds news.read and must still not receive a medical notice.
  ('a5510000-0000-0000-0000-00000000000b', '88888888-0000-0000-0000-000000000008', 'spectator',       '11111111-1111-1111-1111-111111111111', NULL),
  -- R Pillay, twice. The `player` assignment is about the TEAM — the fixture
  -- list, the squad, who is available on Saturday — and reaches every team
  -- mate, so it cannot also carry the capabilities that read a medical record.
  -- `selfaccess` is about ONE person, named in assignment_subject below, and
  -- carries those. Two assignments because the model's rule is that a
  -- capability applies only within the scope of the assignment granting it,
  -- and these two need different scopes.
  ('a5510000-0000-0000-0000-00000000000c', '88888888-0000-0000-0000-000000000009', 'player',          '11111111-1111-1111-1111-111111111111', '1XI'),
  ('a5510000-0000-0000-0000-00000000000d', '88888888-0000-0000-0000-000000000009', 'selfaccess',      '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-00000000000e', '88888888-0000-0000-0000-00000000000a', 'coach',           '11111111-1111-1111-1111-111111111111', '2XI'),
  ('a5510000-0000-0000-0000-00000000000f', '88888888-0000-0000-0000-00000000000b', 'coach',           '11111111-1111-1111-1111-111111111111', 'U14A'),
  -- The four 1st XI families.
  ('a5510000-0000-0000-0000-000000000014', '88888888-0000-0000-0000-00000000000c', 'schooladmin',      '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000015', '88888888-0000-0000-0000-00000000000d', 'schooladmin',      '22222222-2222-2222-2222-222222222222', NULL),
  ('a5510000-0000-0000-0000-000000000010', '88888888-0000-0000-0000-000000000010', 'guardian',        '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000011', '88888888-0000-0000-0000-000000000011', 'guardian',        '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000012', '88888888-0000-0000-0000-000000000012', 'guardian',        '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000013', '88888888-0000-0000-0000-000000000013', 'guardian',        '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000017', '88888888-0000-0000-0000-000000000015', 'finance',         '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000018', '88888888-0000-0000-0000-000000000016', 'principal',       '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000019', '88888888-0000-0000-0000-000000000017', 'driver',          '11111111-1111-1111-1111-111111111111', NULL),
  -- The Westville 1XI coach. Scoped to Westville and to 1XI exactly as the
  -- Hilton coach is scoped to Hilton and 1XI — which is what makes the shared
  -- fixture assertions mean something: neither can reach the other's side.
  ('a5510000-0000-0000-0000-00000000001a', '88888888-0000-0000-0000-00000000001a', 'coach',           '22222222-2222-2222-2222-222222222222', '1XI'),
  -- school_id NULL, honestly: platform administration is not a claim about
  -- any one school, and nothing in scouting.accredit's check looks at scope.
  ('a5510000-0000-0000-0000-000000000016', '88888888-0000-0000-0000-000000000014', 'platformadmin',   NULL, NULL);

-- Who each assignment is about: the parents' children, Sarah's two children at
-- two schools, and R Pillay's own record.
--
-- EVERY ROW SAYS 'verified' EXPLICITLY, because the column default is
-- 'pending' and a pending link reaches nothing. That is not seed ceremony: it
-- is the fixture asserting, in the only place it can, that somebody at the
-- school checked each of these against a document. A seed that let the default
-- stand would produce a demonstration database in which no parent could see
-- their own child, and the first person to hit it would "fix" the default.
--
-- verified_by is the school administrator. NOT the guardian: nobody verifies
-- their own link, and the functions in db/08 refuse it.
INSERT INTO assignment_subject
  (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
   consent_state, consent_version, consent_at, created_by) VALUES
  ('a5510000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000005', 'parent',
   'verified', '88888888-0000-0000-0000-00000000000c', now(), 'granted', 'popia-2026-01', now(),
   '88888888-0000-0000-0000-00000000000c'),  -- D Pillay → R Pillay (injured)
  ('a5510000-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000006', 'parent',
   'verified', '88888888-0000-0000-0000-00000000000c', now(), 'granted', 'popia-2026-01', now(),
   '88888888-0000-0000-0000-00000000000c'),  -- Sarah → K Dlamini (Hilton U16B)
  ('a5510000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000001', 'parent',
   'verified', '88888888-0000-0000-0000-00000000000d', now(), 'granted', 'popia-2026-01', now(),
   '88888888-0000-0000-0000-00000000000d'),  -- Sarah → D Mkhize (Westville)
  -- A pupil's link to their OWN file is a link like any other, and it is
  -- verified by the school: "this account belongs to this child" is exactly the
  -- kind of claim that must not be self-asserted.
  ('a5510000-0000-0000-0000-00000000000d', 'aaaaaaaa-0000-0000-0000-000000000005', 'self',
   'verified', '88888888-0000-0000-0000-00000000000c', now(), 'granted', 'popia-2026-01', now(),
   '88888888-0000-0000-0000-00000000000c'),  -- R Pillay → themselves
  ('a5510000-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent',
   'verified', '88888888-0000-0000-0000-00000000000c', now(), 'granted', 'popia-2026-01', now(),
   '88888888-0000-0000-0000-00000000000c'),  -- H Whitfield → James Whitfield
  ('a5510000-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000002', 'parent',
   'verified', '88888888-0000-0000-0000-00000000000c', now(), 'granted', 'popia-2026-01', now(),
   '88888888-0000-0000-0000-00000000000c'),  -- A Bekker → T Bekker
  ('a5510000-0000-0000-0000-000000000012', 'aaaaaaaa-0000-0000-0000-000000000003', 'parent',
   'verified', '88888888-0000-0000-0000-00000000000c', now(), 'granted', 'popia-2026-01', now(),
   '88888888-0000-0000-0000-00000000000c'),  -- V Naidoo → S Naidoo
  -- N Cele's link is VERIFIED BUT NOT CONSENTED, deliberately. M Cele is
  -- therefore `pending_consent` and cannot be selected, which is the state the
  -- registration rule exists to produce and the one a fixture that consented to
  -- everything could never demonstrate.
  ('a5510000-0000-0000-0000-000000000013', 'aaaaaaaa-0000-0000-0000-000000000004', 'parent',
   'verified', '88888888-0000-0000-0000-00000000000c', now(), 'pending', NULL, NULL,
   '88888888-0000-0000-0000-00000000000c');  -- N Cele → M Cele

-- The squad, LAST, because a squad row is now refused for a child with no
-- verified, consented guardian link — so the families have to exist first.
-- M Cele is excluded by the same rule that would refuse him: his parent has not
-- consented, so he is not registered to play, and the seed says so by asking
-- for the registered players rather than by listing four names.
INSERT INTO match_squad (match_id, player_id, side, batting_no)
SELECT '77777777-0000-0000-0000-000000000001', p.id, 'home', p.squad_no
  FROM player p
  JOIN player_guardian_status s ON s.player_id = p.id
 WHERE p.school_id = '11111111-1111-1111-1111-111111111111'
   AND p.team_code = '1XI'
   AND s.registration_state = 'active';

COMMIT;

-- ── The programme: training, development, notices, ladder, weather ──
-- Fixtures for db/99_rls_verify.sql. The notification rows in particular are
-- chosen to make the capability gate falsifiable: one general notice everybody
-- gets, one medical notice that must reach the medical officer and the coach's
-- own team and NOT the spectator, and one U16B team notice the 1XI coach must
-- not receive.

INSERT INTO competition_entrant (competition_id, school_id, team_code, display_name, played, won, lost, drawn, no_result, points) VALUES
  ('99999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1XI', 'Hilton 1st XI',    5, 4, 1, 0, 0, 8),
  ('99999999-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '1XI', 'Westville 1st XI', 5, 3, 2, 0, 0, 6);

INSERT INTO training_session (id, school_id, team_code, title, starts_at, duration_min, venue, coach_id, session_type, drills, notes) VALUES
  ('7a717000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1XI',
   'Pre-Match Prep', now() + interval '1 day', 90, 'Nets 1-3',
   'dddddddd-0000-0000-0000-000000000001', 'match-prep',
   '{"Throw-downs","Bowling loads","Catching"}', 'Top order against pace.'),
  ('7a717000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'U16B',
   'U16B Batting', now() + interval '2 days', 75, 'Nets 6-7',
   'dddddddd-0000-0000-0000-000000000002', 'batting',
   '{"Front foot drive","Rotating strike"}', NULL);

INSERT INTO training_attendance (session_id, player_id, status) VALUES
  ('7a717000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'present'),
  ('7a717000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000005', 'injured');

-- Assessments on the 1-20 scale, grouped technical / mental / tactical /
-- physical. A PARTIAL assessment is the normal case, not an incomplete one:
-- these are the things a coach actually watched, and the write path upserts per
-- attribute.
INSERT INTO player_skill (player_id, assessed_on, category, metric, score) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 30, 'technical', 'footwork',       17),
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 30, 'technical', 'timing',         16),
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 30, 'mental',    'concentration',  15),
  -- Game-craft, judged over a season rather than in a net, which is why there
  -- is one of these where there are two of everything else.
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 30, 'tactical',  'strikeRotation', 16),
  ('aaaaaaaa-0000-0000-0000-000000000006', current_date - 30, 'technical', 'footwork',       12);

-- A coach's own writing. Narrower than the assessments above: the pupil reads
-- his own attribute scores and must not read this. One note carries an explicit
-- signal, because a note that moves a rating says so itself — nothing here
-- parses the prose.
INSERT INTO development_note (player_id, school_id, author_id, body, about_discipline, adjustment, observed_on) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '88888888-0000-0000-0000-000000000004',
   'Captaincy sits well on him. Sets his own field without being asked and the younger players listen.',
   NULL, NULL, current_date - 20),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '88888888-0000-0000-0000-000000000004',
   'Has not played the pull shot since he was hit at Kearsney. Working on it in the nets; treat the rating as provisional.',
   'batting', -2, current_date - 5);

INSERT INTO notification (id, school_id, team_code, scope_level, kind, urgency, title, body, required_capability, is_public, subject_kind) VALUES
  -- General: news.read only. Everyone attached to Hilton receives it.
  ('40170000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', NULL, 'school',
   'system', 'low', 'Fixture list published',
   'The 2026/27 fixture list is now available.', 'news.read', true, 'system'),
  -- Medical: the body names a child's condition, so it demands
  -- medical.status.read on top of news.read. A spectator holds news.read and
  -- must NOT receive this one — that single row is the whole argument for the
  -- readAlso mechanism.
  -- A STATUS-tier notice, and its body is written to match: it says the player
  -- is unavailable and does not say why. The first draft of this fixture read
  -- "remains out with a hamstring strain" while declaring only
  -- medical.status.read — a notice exceeding its own tier, which is precisely
  -- the leak required_capability exists to prevent. It was caught by reading
  -- the rows the injury trigger produces next to the hand-written ones.
  ('40170000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '1XI', 'team',
   'injury', 'high', 'Availability update',
   'R Pillay is unavailable for selection. Review in two weeks.',
   'medical.status.read', false, 'injury'),
  -- A U16B team notice. The 1st XI coach's assignment is team-scoped, so it must
  -- not reach them even though they hold news.read at the same school.
  ('40170000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'U16B', 'team',
   'training', 'low', 'U16B training moved',
   'U16B batting session moves to Nets 6-7.', 'news.read', false, 'training');

INSERT INTO match_weather (match_id, condition, temp_c, humidity_pct, wind_kph, wind_dir, uv_index, rain_chance_pct, forecast, playable) VALUES
  ('77777777-0000-0000-0000-000000000002', 'Partly cloudy', 22, 60, 16, 'SW', 7, 20,
   'Pleasant Midlands morning. Isolated cloud.', true);

-- ── Adult clearances ───────────────────────────────────────────────
-- Hilton's register as an office would actually find it: mostly kept, one
-- first aid certificate about to lapse, one police clearance that already
-- has, one coach with no first aid on file at all. Westville has recorded
-- nothing on its coach — the register's loudest row. Dates that must sit a
-- known distance from today are written relative to it. verified_by is NULL
-- throughout: a seeded row, not a person who saw a document.
INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on, note) VALUES
  -- The 1XI coach: all three, first aid running out.
  ('88888888-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'police_clearance', 'PCC-2026-041177', '2026-03-01', '2027-02-28', NULL),
  ('88888888-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'child_protection', 'NRSO-11-88421',   '2025-11-01', '2027-10-31', NULL),
  ('88888888-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'first_aid',        'FA-L1-2024-3310', '2024-09-25', current_date + 20, 'Level 1'),
  -- The 2XI coach: police clearance lapsed a month ago, no first aid on file.
  ('88888888-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'police_clearance', 'PCC-2025-118902', '2025-08-01', current_date - 30, NULL),
  ('88888888-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'child_protection', 'NRSO-11-90117',   '2026-01-15', '2028-01-14', NULL),
  -- Sarah, who coaches U16B.
  ('88888888-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'police_clearance', 'PCC-2026-002215', '2026-01-20', '2027-01-19', NULL),
  ('88888888-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'child_protection', 'NRSO-11-70233',   '2025-06-01', '2027-05-31', NULL),
  ('88888888-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'first_aid',        'FA-L2-2025-0871', '2025-10-10', '2027-10-09', 'Level 2'),
  -- The physio.
  ('88888888-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'police_clearance', 'PCC-2026-019004', '2026-02-10', '2027-02-09', NULL),
  ('88888888-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'child_protection', 'NRSO-11-65510',   '2025-09-01', '2027-08-31', NULL),
  -- The driver: everything current, permit to January.
  ('88888888-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'police_clearance', 'PCC-2026-030771', '2026-02-20', '2027-02-19', NULL),
  ('88888888-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'child_protection', 'NRSO-11-71904',   '2025-12-01', '2027-11-30', NULL),
  ('88888888-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'driving_permit',   'PrDP-G-4471820',  '2025-01-10', '2027-01-09', 'Goods and passengers');

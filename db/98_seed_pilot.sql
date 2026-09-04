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
   'J Sithole', 2, 'batter', (current_date + interval '20 days' - interval '13 years')::date);

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
INSERT INTO match (id, school_id, team_code, opponent, ground_id, starts_at, format, overs, status, toss_won_by, toss_decision) VALUES
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1XI', 'Westville Boys'' High',
   'ffffffff-0000-0000-0000-000000000001', now() - interval '7 days', 'T20', 20, 'complete', 'Hilton College', 'bat'),
  ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '1XI', 'Michaelhouse',
   'ffffffff-0000-0000-0000-000000000001', now() + interval '3 days',  'T20', 20, 'scheduled', NULL, NULL),
  ('77777777-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'U16B', 'Kearsney College',
   'ffffffff-0000-0000-0000-000000000001', now() + interval '10 days', 'T20', 20, 'scheduled', NULL, NULL);

INSERT INTO match_squad (match_id, player_id, side, batting_no) 
SELECT '77777777-0000-0000-0000-000000000001', id, 'home', squad_no
  FROM player WHERE school_id = '11111111-1111-1111-1111-111111111111' AND team_code = '1XI';

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

-- R Pillay: the injured 1XI player, with an account of their own. The case
-- self-access exists for — a pupil reading their own physiotherapy notes.
INSERT INTO app_user (id, school_id, email, name, role, player_id, teams) VALUES
  ('88888888-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   'pillay@example.invalid', 'R Pillay', 'player', 'aaaaaaaa-0000-0000-0000-000000000005', '{1XI}');

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
  ('a5510000-0000-0000-0000-00000000000f', '88888888-0000-0000-0000-00000000000b', 'coach',           '11111111-1111-1111-1111-111111111111', 'U14A');

-- Who each assignment is about: the parent's child, Sarah's two children at
-- two schools, and R Pillay's own record.
INSERT INTO assignment_subject (assignment_id, player_id) VALUES
  ('a5510000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000005'),  -- parent → R Pillay (injured)
  ('a5510000-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000006'),  -- Sarah → K Dlamini (Hilton U16B)
  ('a5510000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000001'),  -- Sarah → D Mkhize (Westville)
  ('a5510000-0000-0000-0000-00000000000d', 'aaaaaaaa-0000-0000-0000-000000000005');  -- R Pillay → themselves

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

INSERT INTO player_skill (player_id, assessed_on, category, metric, score) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 30, 'batting', 'technique', 85),
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 30, 'batting', 'power',     78),
  ('aaaaaaaa-0000-0000-0000-000000000006', current_date - 30, 'batting', 'technique', 61);

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

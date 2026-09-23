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

-- Birth dates for the boys who have a guardian are RELATIVE, not literal, and
-- that is a correction rather than a style preference. They were written as
-- 2008 dates when the seed was new; by September 2026 four of the seven
-- seeded guardian links were for people who had turned eighteen, so a rule
-- that ends guardianship at majority would have quietly switched off the
-- demonstration's own parent account. A fixture that decays with the calendar
-- is one that passes today and fails in March for a reason nobody looking at
-- it would guess. Relative, they stay school-age whenever the seed is run.
--
-- Kept around sixteen and a half, at spread-out offsets rather than one
-- interval pasted five times: old enough to be a plausible 1st XI side, young
-- enough that majority is a year or more away rather than next month, and not
-- all born on the same day.
--
-- S NAIDOO IS THE DELIBERATE EXCEPTION, at eighteen years and four months.
-- Two things need him there at once. smoke-workload.mjs reads him as the Open
-- bowler with no spell limit, and the school age bands are taken at the season
-- cutoff (1 January), so Open starts at roughly seventeen years and eight
-- months TODAY — there is only a four-month window in which a boy is both Open
-- and still a minor, and a fixture living in that window is one that breaks
-- when the cutoff rolls over. Past eighteen he is Open every day of the year.
--
-- The second thing is the more useful one: his guardian link is therefore
-- expired, on purpose, and the demonstration contains a parent who can no
-- longer read a grown child's record. That is the rule this seed is here to
-- show, and no arrangement of minors could show it. He stays selectable —
-- player_guardian_status reads an adult as 'active' without any link at all,
-- which is the same rule seen from the other side.
INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born, hometown, houseAtSchool, height, weight, guardian) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1XI', 'James Whitfield', 1, 'batter',     (current_date - interval '16 years 7 months')::date, 'Howick',      'McKenzie', 181, 74, '{"name":"A Whitfield","relation":"father","phone":"+27 82 000 0001"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '1XI', 'T Bekker',        2, 'allrounder', (current_date - interval '16 years 2 months')::date, 'Pietermaritzburg', 'Falcon', 176, 70, '{"name":"M Bekker","relation":"mother","phone":"+27 82 000 0002"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '1XI', 'S Naidoo',        3, 'bowler',     (current_date - interval '18 years 4 months')::date, 'Durban',      'Pearce',   179, 68, '{"name":"R Naidoo","relation":"father","phone":"+27 82 000 0003"}'),
  ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '1XI', 'M Cele',          4, 'keeper',     '2009-01-09', 'Pinetown',    'McKenzie', 172, 66, '{"name":"N Cele","relation":"mother","phone":"+27 82 000 0004"}'),
  -- p5 is the injured player 99_rls_verify.sql looks for.
  ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '1XI', 'R Pillay',        5, 'allrounder', (current_date - interval '16 years 10 months')::date, 'Umhlanga',    'Falcon',   183, 77, '{"name":"D Pillay","relation":"father","phone":"+27 82 000 0005"}'),
  -- A second team, so a team-scoped coach has something to be excluded from.
  ('aaaaaaaa-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'U16B', 'K Dlamini',       7, 'batter',     '2011-02-18', 'Hilton',      'Pearce',   165, 55, '{"name":"S Dlamini","relation":"mother","phone":"+27 82 000 0006"}');

-- A second school, so school scoping has something to exclude.
INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '1XI', 'D Mkhize',  1, 'bowler', (current_date - interval '16 years 5 months')::date),
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

-- ── ID numbers, DERIVED from each boy's birthday ────────────────
--
-- These were three literals, and they were wrong. A South African ID number's
-- first six digits ARE the date of birth, so a hand-typed number and a
-- hand-typed birthday are the same fact written twice — and the moment the
-- birthdays above became relative (so the fixture would stop ageing out of the
-- guardian rules), the literals stopped agreeing with them. Nothing said so:
-- the export/import round trip in tools/smoke-csv.mjs found it, which is
-- exactly the job of a round trip.
--
-- Computed now, so the two can never drift apart again. The check digit is
-- real Luhn — the same algorithm packages/policy/src/sa-id.mjs implements —
-- because a fixture carrying numbers that fail their own checksum would make
-- the import warn on every seeded boy and teach everyone to ignore the warning.
CREATE OR REPLACE FUNCTION pg_temp.sa_id_for(p_born date, p_sequence text)
RETURNS text AS $$
DECLARE body text; total int := 0; d int; dbl boolean := true; i int;
BEGIN
  body := to_char(p_born, 'YYMMDD') || p_sequence || '0' || '8';
  FOR i IN REVERSE length(body)..1 LOOP
    d := substr(body, i, 1)::int;
    IF dbl THEN d := d * 2; IF d > 9 THEN d := d - 9; END IF; END IF;
    total := total + d;
    dbl := NOT dbl;
  END LOOP;
  RETURN body || ((10 - (total % 10)) % 10)::text;
END $$ LANGUAGE plpgsql;

UPDATE player SET id_number = pg_temp.sa_id_for(born, '5000')
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
UPDATE player SET id_number = pg_temp.sa_id_for(born, '5001')
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
UPDATE player SET id_number = pg_temp.sa_id_for(born, '5002')
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000005';

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

-- A schools league: school level, so it runs on the calendar year and is
-- named for one — "2026", not the club's "2026/27".
INSERT INTO competition (id, school_id, name, comp_type, format, age_group, gender, level, season_id) VALUES
  ('99999999-0000-0000-0000-000000000001', NULL, 'KZN Schools T20 League', 'league', 'T20', '1XI', 'boys', 'school', season_named('2026', 'school'));
-- Its divisions. Both pilot sides are in the top one.
INSERT INTO competition_division (id, competition_id, code, name, rank) VALUES
  ('d1710000-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', 'D1', 'Division 1', 1),
  ('d1710000-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000001', 'D2', 'Division 2', 2);

-- Matches: one played, one scheduled. Neither carries a score column —
-- the score is derived from ball_event.
INSERT INTO match (id, school_id, team_code, opponent, ground_id, starts_at, format, overs, status) VALUES
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1XI', 'Westville Boys'' High',
   'ffffffff-0000-0000-0000-000000000001', now() - interval '7 days', 'T20', 20, 'complete'),
  ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '1XI', 'Michaelhouse',
   'ffffffff-0000-0000-0000-000000000001', now() + interval '3 days',  'T20', 20, 'scheduled'),
  ('77777777-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'U16B', 'Kearsney College',
   'ffffffff-0000-0000-0000-000000000001', now() + interval '10 days', 'T20', 20, 'scheduled'),
  -- The match that carries the seeded ball log, below. It is deliberately NOT
  -- ...0001: smoke-rating.mjs writes its own deliveries into that one starting
  -- at seq 1, and ball_event is append-only, so fixture data sitting there
  -- fails the walk rather than the walk failing honestly.
  ('77777777-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '1XI', 'Maritzburg College',
   'ffffffff-0000-0000-0000-000000000001', now() - interval '14 days', 'T20', 20, 'complete');

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
-- the `sponsorship` role (SCRBRD-030 split it out of `finance`) and by
-- nothing else in the floor bundle, so without an account carrying it, the
-- masking on a contract's value could only ever be observed from the
-- outside — every reader masked, none unmasked, which proves the column is
-- absent rather than that it is guarded. Given both role_assignment rows
-- below: one small-school bursar doing both jobs, which the split leaves a
-- school free to choose or not choose — see the role's own comment in
-- roles.mjs for why that choice, and not this account, is the point of it.
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

-- Somebody who runs the shared league. competition.manage at no school at
-- all, which is what a competition with no organising school answers to;
-- without this account a division could only ever be observed refused.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-000000000021', NULL,
   'league@example.invalid', 'K Naidu', 'competitionadmin');

-- THE OWNER'S KEY. Every capability, no school, so it reaches every tenant —
-- app_can() has no wildcard for school, so naming one would reach that school
-- and no other. Seeded so the assertions in db/99 can exercise it: a role that
-- nothing signs in as is a role nothing proves anything about.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-000000000022', NULL,
   'owner@example.invalid', 'K Ismail', 'superadmin');

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
  ('a5510000-0000-0000-0000-000000000021', '88888888-0000-0000-0000-000000000021', 'competitionadmin', NULL, NULL),
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
  ('a5510000-0000-0000-0000-00000000001b', '88888888-0000-0000-0000-000000000015', 'sponsorship',     '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000018', '88888888-0000-0000-0000-000000000016', 'principal',       '11111111-1111-1111-1111-111111111111', NULL),
  ('a5510000-0000-0000-0000-000000000019', '88888888-0000-0000-0000-000000000017', 'driver',          '11111111-1111-1111-1111-111111111111', NULL),
  -- The Westville 1XI coach. Scoped to Westville and to 1XI exactly as the
  -- Hilton coach is scoped to Hilton and 1XI — which is what makes the shared
  -- fixture assertions mean something: neither can reach the other's side.
  ('a5510000-0000-0000-0000-00000000001a', '88888888-0000-0000-0000-00000000001a', 'coach',           '22222222-2222-2222-2222-222222222222', '1XI'),
  -- school_id NULL, honestly: platform administration is not a claim about
  -- any one school, and nothing in scouting.accredit's check looks at scope.
  ('a5510000-0000-0000-0000-000000000016', '88888888-0000-0000-0000-000000000014', 'platformadmin',   NULL, NULL),
  -- school_id NULL is the whole point: this is the one assignment in the seed
  -- that is about every school at once.
  ('a5510000-0000-0000-0000-000000000022', '88888888-0000-0000-0000-000000000022', 'superadmin',      NULL, NULL);

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

-- Every guardian link ends at the child's majority, and the fixture carries
-- the date rather than describing it. Computed from each child's own birthday
-- instead of typed in, so the demonstration cannot drift out of step with the
-- rule the way seven hand-written dates would. A pupil's link to their own
-- record is untouched: that one does not end at eighteen, it is theirs.
--
-- greatest(…, s.valid_from) because assignment_subject requires valid_from <=
-- valid_until and valid_from defaults to the day the row was written. S Naidoo
-- turned eighteen four months before this seed runs, so his link ends the day
-- it is created: expired on arrival, which is the honest record of a
-- relationship that ended before anyone wrote it down.
UPDATE assignment_subject s
   SET valid_until = greatest(majority_on(p.born), s.valid_from)
  FROM role_assignment a, player p
 WHERE a.id = s.assignment_id
   AND a.role = 'guardian'
   AND p.id = s.player_id
   AND p.born IS NOT NULL
   AND s.valid_until IS NULL;

-- ── Notices, one of each tier ───────────────────────────────────
--
-- One per scope, because the three tiers are the whole point and a fixture
-- with only school notices could not demonstrate that a coach's post reaches
-- his side and not the one next door. The competition notice is the sharp one:
-- it belongs to no school, and both entered schools read it.
-- The byline is stamped from the session by a trigger on news_post, never
-- taken from the row — so the seed has to BE somebody while it inserts, or
-- every notice comes out unsigned and the draft rule (an author sees their own
-- unsent post, nobody else does) has no author to be true about.
-- The byline is stamped from the session by a trigger on news_post, never
-- taken from the row — so the seed has to BE somebody while it inserts, or
-- every notice comes out unsigned and the draft rule (an author sees their own
-- unsent post and nobody else does) has no author to be true about.
--
-- One session per author, rather than one for the lot: a coach's notice signed
-- by the director of sport is a fixture that quietly contradicts the screen it
-- is meant to demonstrate.
SELECT set_config('app.user_id', '88888888-0000-0000-0000-000000000004', false);  -- 1XI coach
INSERT INTO news_post (id, scope, school_id, team_code, competition_id, title, body, published_at) VALUES
  ('0c000000-0000-0000-0000-000000000001', 'team', '11111111-1111-1111-1111-111111111111', '1XI', NULL,
   'Nets moved to Thursday',
   'Wednesday''s session clashes with the Michaelhouse fixture. Nets 1-3 on Thursday at 14:30 instead. Bring whites.',
   now() - interval '2 days');

SELECT set_config('app.user_id', '88888888-0000-0000-0000-000000000007', false);  -- director of sport
INSERT INTO news_post (id, scope, school_id, team_code, competition_id, title, body, published_at) VALUES
  ('0c000000-0000-0000-0000-000000000002', 'school', '11111111-1111-1111-1111-111111111111', NULL, NULL,
   'Summer tour squad announced Friday',
   'The touring squad is named at Friday assembly. Parents of selected boys will be contacted about kit and travel over the weekend.',
   now() - interval '1 day'),
  -- Unsent, so the draft rule has something to be true about.
  ('0c000000-0000-0000-0000-000000000004', 'school', '11111111-1111-1111-1111-111111111111', NULL, NULL,
   'Draft — end of season awards',
   'Not finished. Dates to confirm with the headmaster.',
   NULL);

SELECT set_config('app.user_id', '88888888-0000-0000-0000-000000000021', false);  -- runs the league
INSERT INTO news_post (id, scope, school_id, team_code, competition_id, title, body, published_at) VALUES
  ('0c000000-0000-0000-0000-000000000003', 'competition', NULL, NULL, '99999999-0000-0000-0000-000000000001',
   'Over-rate penalties from round four',
   'From round four, sides more than two overs short at the scheduled cut-off forfeit one league point. The playing conditions have been updated.',
   now() - interval '6 hours');

-- Cleared, so nothing later in the seed inherits a session identity.
SELECT set_config('app.user_id', '', false);

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

INSERT INTO competition_entrant (competition_id, school_id, team_code, display_name, played, won, lost, drawn, no_result, points, division_id) VALUES
  ('99999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1XI', 'Hilton 1st XI',    5, 4, 1, 0, 0, 8, 'd1710000-0000-0000-0000-000000000001'),
  ('99999999-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '1XI', 'Westville 1st XI', 5, 3, 2, 0, 0, 6, 'd1710000-0000-0000-0000-000000000001');

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

-- ── Recognition ────────────────────────────────────────────────────
-- The 1XI had awarded 411 caps before the platform; James Whitfield holds
-- full colours from last season, on the public board; S Naidoo captains
-- this one. awarded_by NULL throughout: seeded, not signed.
INSERT INTO cap_baseline (school_id, team_code, caps_before, as_of, note) VALUES
  ('11111111-1111-1111-1111-111111111111', '1XI', 411, '2025-12-31', 'From the honours board in the pavilion.');
INSERT INTO honour (player_id, kind, season_id, citation, awarded_on, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'colours', season_named('2025', 'school'), 'Led the batting all season.', '2025-11-20', true),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'captain', season_named('2026', 'school'), NULL, '2026-08-15', false);

-- ── Kit ────────────────────────────────────────────────────────────
INSERT INTO equipment (id, school_id, kind, label, quantity, condition) VALUES
  ('e0170000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'bat', 'GM Diamond, 1XI pool', 3, 'good'),
  ('e0170000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'helmet', 'Masuri, junior', 8, 'fair'),
  ('e0170000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'bowling_machine', 'BOLA Professional', 1, 'good');
INSERT INTO drill (school_id, name, category, duration_min, description) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Pavilion end yorkers', 'bowling', 20, 'Death bowling into the shoes with the tape line.');

-- ── One innings, ball by ball ──────────────────────────────────────
--
-- Until this existed the pilot seed carried three matches, eleven boys and
-- ZERO deliveries. Everything derived from the ball log was therefore empty in
-- the demonstration — every career average, every strike rate, every phase
-- breakdown and every wagon wheel — and each one rendered as an honest em dash
-- that looked exactly like a broken read. The layer the handover calls the moat
-- had no fixture data at all.
--
-- One completed match (7th September, 1XI) gets a full first innings. The
-- placements are the point: each batter is given a distinct scoring zone, so a
-- wheel drawn from this is not decorative noise but something a coach would
-- actually read — Bekker square of the wicket on the off side, Pillay strong
-- through mid-wicket, Cele straight.
--
-- S Naidoo bats LEFT, deliberately. Placements are stored batter-relative and
-- mirrored at render (screenAngle), and with every seeded player right-handed
-- that rule was never exercised by anything a person could look at. His arc and
-- Bekker's are stored as near-identical theta and must draw on OPPOSITE sides
-- of the ground. A wheel where they overlap has lost the mirror.
--
-- The last twelve balls are sector-era on purpose: placement_source 'sector'
-- with a seg and no theta, which is what the archive looks like before point
-- capture. A chart that silently dropped them would report a season as emptier
-- than it was, so the mixed provenance is here to be drawn.

-- Single-letter, matching every view that renders a hand or an arm
-- ({batHand}HB, bowlArm==="L"?"LA":"RA"). This used to write 'RHB'/'LHB' —
-- a spelling that passed placement.mjs's own defensive /^l/i regex (so the
-- wagon wheel drew correctly) but broke every direct ==="L" comparison
-- elsewhere: SquadView, ProfilesView and AnalyticsView all showed "LHBHB"
-- and right-handed styling for a boy seeded as left-handed. The CHECK on
-- player.batting_style now refuses the old spelling outright.
UPDATE player SET batting_style = 'R' WHERE id IN (
  'aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',
  'aaaaaaaa-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000005');
UPDATE player SET batting_style = 'L' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003';

-- Bowling arm and pace/spin, for the boys named as bowlers. Naidoo bats left
-- and bowls left-arm spin — a real, common combination, and the one that
-- exercises bowlArm as a fact independent of batHand rather than assuming
-- they always agree.
UPDATE player SET bowling_arm = 'L', bowling_style = 'S' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003';
UPDATE player SET bowling_arm = 'R', bowling_style = 'F' WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
UPDATE player SET bowling_arm = 'R', bowling_style = 'M' WHERE full_name = 'B Khumalo';

INSERT INTO ball_event (
  match_id, school_id, seq, epoch, innings,
  scorer_user_id, device_id, idempotency_key, client_seq, client_ts,
  kind, ball_type, value, shot, seg, theta, radius,
  placement_source, capture_profile, contact, trajectory,
  striker_id, bowler_id, dismissal)
SELECT
  '77777777-0000-0000-0000-000000000004',
  '11111111-1111-1111-1111-111111111111',
  n, 1, 0,
  '88888888-0000-0000-0000-000000000006', 'seed-pad-01',
  'seed-ball-' || n, n,
  timestamptz '2026-09-07 09:30:00+02' + (n * 40 || ' seconds')::interval,
  'ball',
  -- Two wickets, at balls 34 and 71. Everything else is runs off the bat.
  CASE WHEN n IN (34, 71) THEN 'W' ELSE 'run' END,
  CASE WHEN n IN (34, 71) THEN 0
       WHEN n % 11 = 0 THEN 6
       WHEN n % 7  = 0 THEN 4
       WHEN n % 3  = 0 THEN 2
       WHEN n % 2  = 0 THEN 1
       ELSE 0 END,
  CASE WHEN n % 11 = 0 THEN 'lofted drive'
       WHEN n % 7  = 0 THEN 'drive'
       WHEN n % 3  = 0 THEN 'push'
       ELSE 'defend' END,
  -- Sector-era tail: seg only, no point.
  CASE WHEN n > 84 THEN (n % 12) END,
  -- Batter-relative degrees. 0 is straight down the ground, positive to leg.
  CASE WHEN n > 84 THEN NULL
       WHEN n <= 34 THEN 300 + (n % 7) * 5          -- Bekker, through the covers
       WHEN n <= 55 THEN  60 + (n % 6) * 6          -- Naidoo, through mid-wicket
       ELSE              175 + (n % 4) * 6 END,     -- Cele, straight
  CASE WHEN n > 84 THEN NULL
       WHEN n % 11 = 0 THEN 0.95                    -- six: over the rope
       WHEN n % 7  = 0 THEN 0.88                    -- four: to the rope
       ELSE 0.30 + ((n % 9) * 0.05) END,
  CASE WHEN n > 84 THEN 'sector' ELSE 'point' END,
  CASE WHEN n > 84 THEN 'quick'  ELSE 'full'  END,
  CASE WHEN n IN (34, 71) THEN 'outside_edge'
       WHEN n % 3 = 0 THEN 'middle' ELSE 'inside_edge' END,
  -- A trajectory needs the bat to have been involved, so the edges that
  -- produced the two wickets take one and nothing else here contradicts it.
  CASE WHEN n % 11 = 0 THEN 'aerial' ELSE 'ground' END,
  -- Three batters, and deliberately NOT R Pillay (…0005).
  --
  -- He is the only pupil in the seed whose ACCOUNT is linked to a player
  -- record, which makes him the one subject available to any walk that needs
  -- "a pupil reading his own figures". smoke-summary.mjs asserts his average is
  -- null before it adds a delivery, and smoke-scouting.mjs counts his matches
  -- against a three-match threshold. Giving him a seeded innings breaks both —
  -- not because either is wrong, but because he is the fixture's clean subject
  -- and fixture data must leave him clean.
  CASE WHEN n <= 34 THEN 'aaaaaaaa-0000-0000-0000-000000000002'::uuid
       WHEN n <= 55 THEN 'aaaaaaaa-0000-0000-0000-000000000003'::uuid
       ELSE              'aaaaaaaa-0000-0000-0000-000000000004'::uuid END,
  -- No bowler. He is a Maritzburg player and this seed carries only Hilton's
  -- roster, so naming one of our own would put a Hilton boy's name against
  -- every delivery bowled AT Hilton — and inflate his bowling career with an
  -- innings he did not bowl. bowler_id is nullable for exactly this case, and
  -- smoke-rating.mjs writes its own deliveries the same way.
  NULL,
  -- Bekker is bowled at 34, Cele is caught at 71 — real methods, from the
  -- eleven db/13 knows, so player_dismissal_breakdown has something other
  -- than an "unknown" bucket to show for the one seeded innings the pilot
  -- carries. Nobody is credited with either wicket: the bowler above is
  -- NULL for exactly the reason the comment beside it gives, so
  -- player_wicket_breakdown is legitimately empty from this seed alone —
  -- tools/smoke-dismissals.mjs supplies a bowler synthetically, the way
  -- smoke-rating.mjs already supplies deliveries the seed itself cannot.
  CASE WHEN n = 34 THEN 'bowled' WHEN n = 71 THEN 'caught' END
FROM generate_series(1, 96) AS n;

-- ── The officials register ───────────────────────────────────────
-- A panel, not a school's staff list: these people stand at Hilton and at
-- Westville and are accredited by neither. Every ID number here is a REAL,
-- well-formed South African ID — the first six digits are the date of birth
-- beside them and the thirteenth is a correct Luhn check digit — because the
-- validator on the way in checks both, and a seed that could not survive its
-- own validation would be fixture data pretending to be records.
--
-- V Ngcobo's accreditation is DELIBERATELY LAPSED. A register where every
-- row is in good standing never exercises the one question it exists to
-- answer, and the screen has to be able to draw somebody who may not stand.
INSERT INTO official (id, full_name, born, id_number, email, phone, panel) VALUES
  ('0a000000-0000-0000-0000-000000000001', 'E Ndlovu',  '1979-04-12', '7904125012084', 'e.ndlovu@example.invalid',  '+27 82 555 0101', 'KZN Cricket Umpires Association'),
  ('0a000000-0000-0000-0000-000000000002', 'V Pillay',  '1982-06-03', '8206035183081', 'v.pillay@example.invalid',  '+27 82 555 0102', 'KZN Cricket Umpires Association'),
  ('0a000000-0000-0000-0000-000000000003', 'G Marais',  '1968-11-27', '6811275244089', 'g.marais@example.invalid',  '+27 82 555 0103', 'CSA Elite Panel'),
  ('0a000000-0000-0000-0000-000000000004', 'T Sithole', '1991-02-19', '9102195305086', 't.sithole@example.invalid', '+27 82 555 0104', 'Midlands Umpires Association'),
  ('0a000000-0000-0000-0000-000000000005', 'V Ngcobo',  '1975-08-30', '7508305461084', 'v.ngcobo@example.invalid',  '+27 82 555 0105', 'Midlands Umpires Association');

INSERT INTO official_accreditation (official_id, level, issued_by, valid_from, valid_until) VALUES
  ('0a000000-0000-0000-0000-000000000003', 'national', 'Cricket South Africa', current_date - 1200, NULL),
  ('0a000000-0000-0000-0000-000000000001', 'level2',   'KZNCUA',               current_date -  700, current_date + 300),
  ('0a000000-0000-0000-0000-000000000002', 'level1',   'KZNCUA',               current_date -  400, current_date + 120),
  ('0a000000-0000-0000-0000-000000000004', 'club',     'Midlands UA',          current_date -  200, current_date + 500),
  -- Promoted: the club grade he came through is kept rather than overwritten,
  -- which is the reason accreditation is a table and not a column.
  ('0a000000-0000-0000-0000-000000000001', 'club',     'KZNCUA',               current_date - 1500, current_date - 700),
  -- Lapsed six weeks ago, and still on the register — standing down is not
  -- the same as never having been accredited.
  ('0a000000-0000-0000-0000-000000000005', 'level1',   'Midlands UA',          current_date -  800, current_date -  42);

-- Appointments, carrying the register id so the fixture knows WHO stood
-- rather than only what was typed. The third is the deliberate exception:
-- a parent stood in at short notice, is on nobody's panel, and is recorded
-- by name alone with a null official_id — which is what that column being
-- nullable is for.
INSERT INTO match_official (match_id, school_id, duty, person_name, official_id, panel) VALUES
  ('77777777-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'umpire', 'E Ndlovu',  '0a000000-0000-0000-0000-000000000001', 'KZN Cricket Umpires Association'),
  ('77777777-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'scorer', 'V Pillay',  '0a000000-0000-0000-0000-000000000002', 'KZN Cricket Umpires Association'),
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'umpire', 'G Marais',  '0a000000-0000-0000-0000-000000000003', 'CSA Elite Panel'),
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'third_umpire', 'A Willing Parent', NULL, NULL),
  ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'umpire', 'T Sithole', '0a000000-0000-0000-0000-000000000004', 'Midlands Umpires Association');

-- AN UMPIRE WHO CAN SIGN IN (SCRBRD-053). Every row above is a person on a
-- panel; this is the same person holding an account and an appointment the
-- authorization model can read. Without it `official` was the one role in the
-- bundle list that nothing ever signed in as, so `officiating.report` and
-- `discipline.write` could only be observed failing.
--
-- THE ASSIGNMENT NAMES ONE FIXTURE, which is the point of it. An official is
-- appointed per match, not per team, and app_can() refuses a fixture-scoped
-- assignment on any row that does not state that same fixture — so E Ndlovu
-- can file an incident from the match he stood at and from no other. team_code
-- is NULL because an umpire stands over both sides, not one of them.
INSERT INTO app_user (id, school_id, email, name, role) VALUES
  ('88888888-0000-0000-0000-000000000023', '11111111-1111-1111-1111-111111111111',
   'e.ndlovu@example.invalid', 'E Ndlovu', 'official');

INSERT INTO role_assignment (id, person_id, role, school_id, team_code, fixture_id) VALUES
  ('a5510000-0000-0000-0000-000000000023', '88888888-0000-0000-0000-000000000023', 'official',
   '11111111-1111-1111-1111-111111111111', NULL, '77777777-0000-0000-0000-000000000004');

-- No disciplinary record is seeded. Nothing draws one yet (SCRBRD-053 shipped
-- the API and the policy, not a screen), and the walk that exercises it
-- asserts on counts — so it owns its own fixture rather than working around
-- rows that arrived here.

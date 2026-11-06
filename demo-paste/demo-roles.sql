-- SCRBRD demo copy · every role's home, filled (tools/demo-roles.mjs).
-- FOR THE scrbrd-demo PROJECT ONLY. Paste AFTER the demo cast and the season builder's file.
-- Every person is invented, every address @example.invalid, every phone +27 00 000 ….
-- One transaction. Refuses to run outside the demo, without the cast, or twice.
-- Every write runs as scrbrd_app under the person whose job it is, through the app's own door.
BEGIN;

DO $demo_only$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_user WHERE email = 'registrar.wes@example.invalid' AND active)
     OR NOT EXISTS (SELECT 1 FROM app_user WHERE email = 'platform@example.invalid' AND active) THEN
    RAISE EXCEPTION 'This is not the demo database (the seeded demo accounts are missing). Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM app_user WHERE email NOT LIKE '%@example.invalid') THEN
    RAISE EXCEPTION 'This database holds a real person''s account, so it is not the demo copy. Nothing was changed.';
  END IF;
  IF (SELECT count(*) FROM player WHERE id::text LIKE 'de300000-0000-4000-8000-%') <> 330
     OR NOT EXISTS (SELECT 1 FROM app_user WHERE email = 'coach.kea.u12a@example.invalid')
     OR NOT EXISTS (SELECT 1 FROM app_user WHERE email = 'pupil.wes.u14a@example.invalid') THEN
    RAISE EXCEPTION 'The 330 players or the demo cast are not here. Paste tools/demo-cast.mjs''s file first. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM adult_clearance WHERE note = 'Recorded for the demo (demo-roles)') THEN
    RAISE EXCEPTION 'The demo roles are already filled here. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM safeguarding_concern WHERE school_id = '22222222-2222-2222-2222-222222222222' AND account LIKE 'After Tuesday''s practice one of the U14A boys%') THEN
    RAISE EXCEPTION 'The demo roles are already filled here (the concern is there). Nothing was changed.';
  END IF;
END $demo_only$;

-- The owner READS only: who is who by email (the demo's ids are its own), the
-- appointees whose clearances the office records, the boys and their parents,
-- the answers already given, and what the league already holds. Kept in this
-- transaction's settings for the writer below.
DO $read$
BEGIN
  PERFORM set_config('demo_roles.ids', (SELECT jsonb_object_agg(email, id)::text FROM app_user WHERE email LIKE '%@example.invalid'), true);
  PERFORM set_config('demo_roles.clear', coalesce((
    SELECT jsonb_agg(jsonb_build_object('person', ra.person_id, 'school', ra.school_id, 'role', ra.role, 'email', u.email,
                                        'k', row_number) ORDER BY ra.school_id, u.email, ra.role)::text
      FROM (SELECT ra.*, row_number() OVER (ORDER BY ra.school_id, ra.person_id, ra.role) FROM role_assignment ra) ra
      JOIN app_user u ON u.id = ra.person_id AND u.active
     WHERE ra.active AND ra.fixture_id IS NULL AND ra.school_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333')
       AND EXISTS (SELECT 1 FROM clearance_requirement cr WHERE cr.role = ra.role)), '[]'), true);
  PERFORM set_config('demo_roles.boys', (SELECT jsonb_agg(jsonb_build_object('id', id, 'school_id', school_id, 'team_code', team_code, 'squad_no', squad_no))::text
                                           FROM player WHERE id::text LIKE 'de300000-0000-4000-8000-%'), true);
  PERFORM set_config('demo_roles.parents', (SELECT jsonb_agg(jsonb_build_object('player', s.player_id, 'email', u.email))::text
      FROM assignment_subject s JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian' AND a.active
      JOIN app_user u ON u.id = a.person_id AND u.active AND u.email ~ '^parent\.[0-9]{3}@example\.invalid$'
     WHERE s.verification_state = 'verified' AND s.consent_state = 'granted'
       AND s.player_id::text LIKE 'de300000-0000-4000-8000-%'
       AND split_part(split_part(u.email, '@', 1), '.', 2)::int = right(s.player_id::text, 3)::int), true);
  PERFORM set_config('demo_roles.answered', coalesce((SELECT jsonb_object_agg(match_id::text || ':' || player_id::text, true)::text
                                                        FROM match_availability), '{}'), true);
  -- The coming fixtures, the home side only: the availability route files an
  -- answer under match_school(), the home school, so an away family's answer
  -- is the away school's to take (the route refuses it here).
  PERFORM set_config('demo_roles.coming', coalesce((
    SELECT jsonb_agg(jsonb_build_object('match_id', m.id, 'school_id', m.school_id, 'team_code', m.team_code, 'starts_at', m.starts_at))::text
      FROM match m
     WHERE m.status = 'scheduled' AND m.starts_at > now() AND m.starts_at < now() + interval '10 days'
       AND m.school_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333') AND m.school_id = match_school(m.id)), '[]'), true);
  PERFORM set_config('demo_roles.entrants', coalesce((SELECT jsonb_agg(jsonb_build_object('school_id', school_id, 'team_code', team_code))::text
                                                         FROM competition_entrant WHERE competition_id = '99999999-0000-0000-0000-000000000001'
                                                          AND status IN ('invited', 'accepted')), '[]'), true);
  PERFORM set_config('demo_roles.contacts_had', coalesce((SELECT jsonb_object_agg(right(c.player_id::text, 3)::int::text || ':' || c.priority, c.id)::text
      FROM emergency_contact c WHERE c.active AND c.player_id::text LIKE 'de300000-0000-4000-8000-%'), '{}'), true);
  PERFORM set_config('demo_roles.declared', (EXISTS (SELECT 1 FROM lift_driver_declaration d JOIN app_user u ON u.id = d.person_id
      WHERE u.email = 'parent.002@example.invalid' AND d.withdrawn_at IS NULL))::text, true);
  PERFORM set_config('demo_roles.vehicles', coalesce((SELECT jsonb_object_agg(upper(registration), true)::text FROM vehicle
      WHERE school_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333')), '{}'), true);
  PERFORM set_config('demo_roles.conditions', (EXISTS (SELECT 1 FROM condition_set WHERE competition_id = '99999999-0000-0000-0000-000000000001'))::text, true);
END $read$;

-- The SQL Editor connects as the table owner, which row-level security does
-- not apply to. The writes below drop to scrbrd_app, the API's own role, so
-- they meet every policy the app meets (as tools/demo-cast.mjs does).
DO $grant$
BEGIN
  EXECUTE format('GRANT scrbrd_app TO %I WITH SET TRUE', current_user);
EXCEPTION
  WHEN duplicate_object OR invalid_grant_operation THEN NULL;
  WHEN syntax_error THEN EXECUTE format('GRANT scrbrd_app TO %I', current_user);
END $grant$;

SET LOCAL ROLE scrbrd_app;

DO $roles$
DECLARE
  ids      jsonb := current_setting('demo_roles.ids')::jsonb;
  ts       jsonb := '{}';   -- "WES/1XI/-4" -> training session id
  sp       jsonb := '{}';   -- sponsor name -> id
  contacts jsonb := '{}';   -- "boy:priority" -> emergency contact id
  had_contacts jsonb := current_setting('demo_roles.contacts_had')::jsonb;   -- the same, already there
  r        record;
  c        record;
  b        record;
  srow     record;
  f        record;
  kind     text;
  ref      text;
  iss      date;
  exp      date;
  v        uuid;
  n        integer := 0;
  n2       integer;
  avail    integer := 0;
BEGIN
  -- ── 1 · Clearances, recorded by each school's office (POST /api/clearances) ──
  PERFORM app_session_begin((ids->>'registrar.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR c IN SELECT * FROM jsonb_to_recordset(current_setting('demo_roles.clear')::jsonb)
                    AS x(person uuid, school uuid, role text, email text, k int)
            WHERE x.school = '22222222-2222-2222-2222-222222222222'::uuid AND x.email <> 'registrar.wes@example.invalid' LOOP
    FOR kind IN SELECT cr.kind FROM clearance_requirement cr WHERE cr.role = c.role ORDER BY cr.kind LOOP
      CONTINUE WHEN c.email = 'coach.kea.u12a@example.invalid' AND kind = 'first_aid';
      IF c.email = 'coach.wes.u13a@example.invalid' AND kind = 'safeguarding_awareness' THEN
        iss := sa_today() - 357; exp := sa_today() + 9;
      ELSE
        iss := sa_today() - (20 + (c.k * 7 + length(kind)) % 150);
        exp := iss + CASE WHEN kind IN ('police_clearance', 'child_protection', 'sexual_offences_register') THEN 730
                          WHEN kind = 'driving_permit' THEN 1460 ELSE 365 END;
      END IF;
      INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on, note)
      VALUES (c.person, c.school, kind,
              CASE WHEN kind IN ('police_clearance', 'driving_permit') THEN 'DEMO-' || upper(left(kind, 3)) || '-' || lpad(c.k::text, 4, '0') END,
              iss, exp, 'Recorded for the demo (demo-roles)')
      RETURNING id INTO v;
      IF v IS NULL THEN RAISE EXCEPTION 'The office could not record % for %. Nothing was changed.', kind, c.email; END IF;
      n := n + 1;
    END LOOP;
  END LOOP;

  PERFORM app_session_begin((ids->>'dos.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR c IN SELECT * FROM jsonb_to_recordset(current_setting('demo_roles.clear')::jsonb)
                    AS x(person uuid, school uuid, role text, email text, k int)
            WHERE x.school = '22222222-2222-2222-2222-222222222222'::uuid AND x.email = 'registrar.wes@example.invalid' LOOP
    FOR kind IN SELECT cr.kind FROM clearance_requirement cr WHERE cr.role = c.role ORDER BY cr.kind LOOP
      CONTINUE WHEN c.email = 'coach.kea.u12a@example.invalid' AND kind = 'first_aid';
      IF c.email = 'coach.wes.u13a@example.invalid' AND kind = 'safeguarding_awareness' THEN
        iss := sa_today() - 357; exp := sa_today() + 9;
      ELSE
        iss := sa_today() - (20 + (c.k * 7 + length(kind)) % 150);
        exp := iss + CASE WHEN kind IN ('police_clearance', 'child_protection', 'sexual_offences_register') THEN 730
                          WHEN kind = 'driving_permit' THEN 1460 ELSE 365 END;
      END IF;
      INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on, note)
      VALUES (c.person, c.school, kind,
              CASE WHEN kind IN ('police_clearance', 'driving_permit') THEN 'DEMO-' || upper(left(kind, 3)) || '-' || lpad(c.k::text, 4, '0') END,
              iss, exp, 'Recorded for the demo (demo-roles)')
      RETURNING id INTO v;
      IF v IS NULL THEN RAISE EXCEPTION 'The office could not record % for %. Nothing was changed.', kind, c.email; END IF;
      n := n + 1;
    END LOOP;
  END LOOP;

  PERFORM app_session_begin((ids->>'office.kea@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR c IN SELECT * FROM jsonb_to_recordset(current_setting('demo_roles.clear')::jsonb)
                    AS x(person uuid, school uuid, role text, email text, k int)
            WHERE x.school = '33333333-3333-3333-3333-333333333333'::uuid AND x.email <> 'office.kea@example.invalid' LOOP
    FOR kind IN SELECT cr.kind FROM clearance_requirement cr WHERE cr.role = c.role ORDER BY cr.kind LOOP
      CONTINUE WHEN c.email = 'coach.kea.u12a@example.invalid' AND kind = 'first_aid';
      IF c.email = 'coach.wes.u13a@example.invalid' AND kind = 'safeguarding_awareness' THEN
        iss := sa_today() - 357; exp := sa_today() + 9;
      ELSE
        iss := sa_today() - (20 + (c.k * 7 + length(kind)) % 150);
        exp := iss + CASE WHEN kind IN ('police_clearance', 'child_protection', 'sexual_offences_register') THEN 730
                          WHEN kind = 'driving_permit' THEN 1460 ELSE 365 END;
      END IF;
      INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on, note)
      VALUES (c.person, c.school, kind,
              CASE WHEN kind IN ('police_clearance', 'driving_permit') THEN 'DEMO-' || upper(left(kind, 3)) || '-' || lpad(c.k::text, 4, '0') END,
              iss, exp, 'Recorded for the demo (demo-roles)')
      RETURNING id INTO v;
      IF v IS NULL THEN RAISE EXCEPTION 'The office could not record % for %. Nothing was changed.', kind, c.email; END IF;
      n := n + 1;
    END LOOP;
  END LOOP;

  PERFORM app_session_begin((ids->>'dos.kea@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR c IN SELECT * FROM jsonb_to_recordset(current_setting('demo_roles.clear')::jsonb)
                    AS x(person uuid, school uuid, role text, email text, k int)
            WHERE x.school = '33333333-3333-3333-3333-333333333333'::uuid AND x.email = 'office.kea@example.invalid' LOOP
    FOR kind IN SELECT cr.kind FROM clearance_requirement cr WHERE cr.role = c.role ORDER BY cr.kind LOOP
      CONTINUE WHEN c.email = 'coach.kea.u12a@example.invalid' AND kind = 'first_aid';
      IF c.email = 'coach.wes.u13a@example.invalid' AND kind = 'safeguarding_awareness' THEN
        iss := sa_today() - 357; exp := sa_today() + 9;
      ELSE
        iss := sa_today() - (20 + (c.k * 7 + length(kind)) % 150);
        exp := iss + CASE WHEN kind IN ('police_clearance', 'child_protection', 'sexual_offences_register') THEN 730
                          WHEN kind = 'driving_permit' THEN 1460 ELSE 365 END;
      END IF;
      INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on, note)
      VALUES (c.person, c.school, kind,
              CASE WHEN kind IN ('police_clearance', 'driving_permit') THEN 'DEMO-' || upper(left(kind, 3)) || '-' || lpad(c.k::text, 4, '0') END,
              iss, exp, 'Recorded for the demo (demo-roles)')
      RETURNING id INTO v;
      IF v IS NULL THEN RAISE EXCEPTION 'The office could not record % for %. Nothing was changed.', kind, c.email; END IF;
      n := n + 1;
    END LOOP;
  END LOOP;

  -- ── 2 · Emergency contacts, by each boy's own parent ──
  PERFORM app_session_begin((ids->>'parent.001@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  IF had_contacts ? '1:1' THEN
    contacts := contacts || jsonb_build_object('1:1', had_contacts->>'1:1');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000001'::uuid AND priority = 1 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000001'::uuid, 1, 'Thandi (demo)', 'mother', '+27 00 000 1000', NULL, NULL, 'Works shifts: try the second number after 18:00 (demo).')
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 1 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('1:1', v);
  END IF;
  IF had_contacts ? '1:2' THEN
    contacts := contacts || jsonb_build_object('1:2', had_contacts->>'1:2');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000001'::uuid AND priority = 2 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000001'::uuid, 2, 'Pieter (demo)', 'grandparent', '+27 00 000 1037', NULL, NULL, NULL)
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 1 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('1:2', v);
  END IF;

  PERFORM app_session_begin((ids->>'parent.061@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  IF had_contacts ? '61:1' THEN
    contacts := contacts || jsonb_build_object('61:1', had_contacts->>'61:1');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000061'::uuid AND priority = 1 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000061'::uuid, 1, 'Nomvula (demo)', 'mother', '+27 00 000 1074', NULL, NULL, 'Works shifts: try the second number after 18:00 (demo).')
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 61 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('61:1', v);
  END IF;
  IF had_contacts ? '61:2' THEN
    contacts := contacts || jsonb_build_object('61:2', had_contacts->>'61:2');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000061'::uuid AND priority = 2 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000061'::uuid, 2, 'Grant (demo)', 'grandparent', '+27 00 000 1111', NULL, NULL, NULL)
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 61 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('61:2', v);
  END IF;

  PERFORM app_session_begin((ids->>'parent.106@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  IF had_contacts ? '106:1' THEN
    contacts := contacts || jsonb_build_object('106:1', had_contacts->>'106:1');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000106'::uuid AND priority = 1 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000106'::uuid, 1, 'Ayesha (demo)', 'father', '+27 00 000 1148', NULL, NULL, 'Works shifts: try the second number after 18:00 (demo).')
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 106 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('106:1', v);
  END IF;
  IF had_contacts ? '106:2' THEN
    contacts := contacts || jsonb_build_object('106:2', had_contacts->>'106:2');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000106'::uuid AND priority = 2 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000106'::uuid, 2, 'Johan (demo)', 'grandparent', '+27 00 000 1185', NULL, NULL, NULL)
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 106 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('106:2', v);
  END IF;

  PERFORM app_session_begin((ids->>'parent.002@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  IF had_contacts ? '2:1' THEN
    contacts := contacts || jsonb_build_object('2:1', had_contacts->>'2:1');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000002'::uuid AND priority = 1 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000002'::uuid, 1, 'Lindiwe (demo)', 'father', '+27 00 000 1222', NULL, NULL, 'Works shifts: try the second number after 18:00 (demo).')
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 2 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('2:1', v);
  END IF;
  IF had_contacts ? '2:2' THEN
    contacts := contacts || jsonb_build_object('2:2', had_contacts->>'2:2');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000002'::uuid AND priority = 2 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000002'::uuid, 2, 'Craig (demo)', 'grandparent', '+27 00 000 1259', NULL, NULL, NULL)
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 2 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('2:2', v);
  END IF;

  PERFORM app_session_begin((ids->>'parent.003@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  IF had_contacts ? '3:1' THEN
    contacts := contacts || jsonb_build_object('3:1', had_contacts->>'3:1');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000003'::uuid AND priority = 1 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000003'::uuid, 1, 'Fatima (demo)', 'mother', '+27 00 000 1296', NULL, NULL, 'Works shifts: try the second number after 18:00 (demo).')
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 3 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('3:1', v);
  END IF;
  IF had_contacts ? '3:2' THEN
    contacts := contacts || jsonb_build_object('3:2', had_contacts->>'3:2');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000003'::uuid AND priority = 2 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000003'::uuid, 2, 'Sibusiso (demo)', 'family', '+27 00 000 1333', NULL, NULL, NULL)
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 3 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('3:2', v);
  END IF;

  PERFORM app_session_begin((ids->>'parent.107@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  IF had_contacts ? '107:1' THEN
    contacts := contacts || jsonb_build_object('107:1', had_contacts->>'107:1');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000107'::uuid AND priority = 1 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000107'::uuid, 1, 'Megan (demo)', 'mother', '+27 00 000 1370', NULL, NULL, 'Works shifts: try the second number after 18:00 (demo).')
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 107 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('107:1', v);
  END IF;
  IF had_contacts ? '107:2' THEN
    contacts := contacts || jsonb_build_object('107:2', had_contacts->>'107:2');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000107'::uuid AND priority = 2 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000107'::uuid, 2, 'Ravi (demo)', 'grandparent', '+27 00 000 1407', NULL, NULL, NULL)
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 107 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('107:2', v);
  END IF;

  PERFORM app_session_begin((ids->>'parent.108@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  IF had_contacts ? '108:1' THEN
    contacts := contacts || jsonb_build_object('108:1', had_contacts->>'108:1');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000108'::uuid AND priority = 1 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000108'::uuid, 1, 'Zanele (demo)', 'father', '+27 00 000 1444', NULL, NULL, 'Works shifts: try the second number after 18:00 (demo).')
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 108 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('108:1', v);
  END IF;
  IF had_contacts ? '108:2' THEN
    contacts := contacts || jsonb_build_object('108:2', had_contacts->>'108:2');
  ELSE
    UPDATE emergency_contact SET active = false WHERE player_id = 'de300000-0000-4000-8000-000000000108'::uuid AND priority = 2 AND active;
    INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
    VALUES ('de300000-0000-4000-8000-000000000108'::uuid, 2, 'Andre (demo)', 'family', '+27 00 000 1481', NULL, NULL, NULL)
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy 108 could not add a contact. Nothing was changed.'; END IF;
    contacts := contacts || jsonb_build_object('108:2', v);
  END IF;

  -- ── 3 · Injuries and return-to-play reviews, by the medical officers ──
  PERFORM app_session_begin((ids->>'medical.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT ok, reason, injury_id AS id INTO r
    FROM injury_record('de300000-0000-4000-8000-000000000012'::uuid, 'Lower back stiffness', 'moderate', (sa_today() + -12), true, (sa_today() + 10), (sa_today() + 2), false, 'Stiffness after a long nets session. No bowling until cleared; core and mobility work only.', NULL);
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The medical officer could not record the injury to boy 12: %. Nothing was changed.', r.reason; END IF;
  SELECT ok, reason, review_id AS id INTO r
    FROM injury_review_record(r.id, 'rehab', true, (sa_today() + 10), (sa_today() + 4), 'Pain-free walking and light running. Started a graded return; batting in nets allowed, no bowling yet.');
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The medical officer could not review the injury to boy 12: %. Nothing was changed.', r.reason; END IF;

  PERFORM app_session_begin((ids->>'medical.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT ok, reason, injury_id AS id INTO r
    FROM injury_record('de300000-0000-4000-8000-000000000118'::uuid, 'Sprained left ankle', 'minor', (sa_today() + -5), true, (sa_today() + 6), (sa_today() + 1), false, 'Rolled it fielding at practice. Iced, strapped; rest and review.', NULL);
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The medical officer could not record the injury to boy 118: %. Nothing was changed.', r.reason; END IF;

  PERFORM app_session_begin((ids->>'medical.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT ok, reason, injury_id AS id INTO r
    FROM injury_record('de300000-0000-4000-8000-000000000073'::uuid, 'Bruised finger', 'minor', (sa_today() + -19), true, (sa_today() + 7), (sa_today() + 5), false, 'Struck on the finger in fielding drills. No fracture suspected; buddy-strapped.', NULL);
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The medical officer could not record the injury to boy 73: %. Nothing was changed.', r.reason; END IF;
  SELECT ok, reason, review_id AS id INTO r
    FROM injury_review_record(r.id, 'cleared', false, NULL, NULL, 'Full grip strength, no pain. Cleared to play.');
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The medical officer could not review the injury to boy 73: %. Nothing was changed.', r.reason; END IF;

  PERFORM app_session_begin((ids->>'medical.kea@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT ok, reason, injury_id AS id INTO r
    FROM injury_record('de300000-0000-4000-8000-000000000178'::uuid, 'Hamstring strain (left)', 'moderate', (sa_today() + -8), true, (sa_today() + 12), (sa_today() + 2), false, 'Felt it sprinting between the wickets. Stretching and strengthening programme; no sprinting.', NULL);
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The medical officer could not record the injury to boy 178: %. Nothing was changed.', r.reason; END IF;

  -- ── 4 · Training: two school drills, sessions, registers and a plan ──
  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO drill (school_id, name, category, duration_min, description)
  VALUES ('22222222-2222-2222-2222-222222222222', 'Westville yorker ladder', 'bowling', 20,
          'Six balls at a shoe on a full length, then a ladder of targets back to good length. Count the hits; no speed gun.')
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 1XI coach could not add a drill. Nothing was changed.'; END IF;
  INSERT INTO drill (school_id, name, category, duration_min, description)
  VALUES ('22222222-2222-2222-2222-222222222222', 'Three-cone run-outs', 'fielding', 15,
          'Pick up on the run from three cones and throw to the keeper''s end; the batter''s end on the coach''s call.')
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 1XI coach could not add a drill. Nothing was changed.'; END IF;

  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', '1XI', 'Nets: seam, line and length', ((sa_today() + -4) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 120, 'Main nets', NULL, 'bowling', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 1XI coach could not schedule "Nets: seam, line and length". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/1XI/-4', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'WES/1XI/-4')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'WES/1XI/-4';
  END IF;
  FOR b IN SELECT * FROM (VALUES ('de300000-0000-4000-8000-000000000001'::uuid, 'present'), ('de300000-0000-4000-8000-000000000002'::uuid, 'present'), ('de300000-0000-4000-8000-000000000003'::uuid, 'present'), ('de300000-0000-4000-8000-000000000004'::uuid, 'late'), ('de300000-0000-4000-8000-000000000005'::uuid, 'present'), ('de300000-0000-4000-8000-000000000006'::uuid, 'present'), ('de300000-0000-4000-8000-000000000007'::uuid, 'present'), ('de300000-0000-4000-8000-000000000008'::uuid, 'present'), ('de300000-0000-4000-8000-000000000009'::uuid, 'excused'), ('de300000-0000-4000-8000-000000000010'::uuid, 'present'), ('de300000-0000-4000-8000-000000000011'::uuid, 'present'), ('de300000-0000-4000-8000-000000000013'::uuid, 'present'), ('de300000-0000-4000-8000-000000000014'::uuid, 'absent'), ('de300000-0000-4000-8000-000000000015'::uuid, 'present')) AS a(player, status) LOOP
    INSERT INTO training_attendance (session_id, player_id, status)
    SELECT (ts->>'WES/1XI/-4')::uuid, b.player, b.status
     WHERE player_school(b.player) = (SELECT t.school_id FROM training_session t WHERE t.id = (ts->>'WES/1XI/-4')::uuid)
    ON CONFLICT (session_id, player_id) DO UPDATE SET status = excluded.status, recorded_at = now()
    RETURNING player_id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The register for % refused a boy. Nothing was changed.', 'WES/1XI/-4'; END IF;
  END LOOP;
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', '1XI', 'Fielding: high catches and throwing', ((sa_today() + -2) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'fielding', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 1XI coach could not schedule "Fielding: high catches and throwing". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/1XI/-2', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'WES/1XI/-2')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'WES/1XI/-2';
  END IF;
  FOR b IN SELECT * FROM (VALUES ('de300000-0000-4000-8000-000000000001'::uuid, 'present'), ('de300000-0000-4000-8000-000000000002'::uuid, 'present'), ('de300000-0000-4000-8000-000000000003'::uuid, 'present'), ('de300000-0000-4000-8000-000000000004'::uuid, 'late'), ('de300000-0000-4000-8000-000000000005'::uuid, 'present'), ('de300000-0000-4000-8000-000000000006'::uuid, 'present'), ('de300000-0000-4000-8000-000000000007'::uuid, 'present'), ('de300000-0000-4000-8000-000000000008'::uuid, 'present'), ('de300000-0000-4000-8000-000000000009'::uuid, 'excused'), ('de300000-0000-4000-8000-000000000010'::uuid, 'present'), ('de300000-0000-4000-8000-000000000011'::uuid, 'present'), ('de300000-0000-4000-8000-000000000013'::uuid, 'present'), ('de300000-0000-4000-8000-000000000014'::uuid, 'absent'), ('de300000-0000-4000-8000-000000000015'::uuid, 'present')) AS a(player, status) LOOP
    INSERT INTO training_attendance (session_id, player_id, status)
    SELECT (ts->>'WES/1XI/-2')::uuid, b.player, b.status
     WHERE player_school(b.player) = (SELECT t.school_id FROM training_session t WHERE t.id = (ts->>'WES/1XI/-2')::uuid)
    ON CONFLICT (session_id, player_id) DO UPDATE SET status = excluded.status, recorded_at = now()
    RETURNING player_id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The register for % refused a boy. Nothing was changed.', 'WES/1XI/-2'; END IF;
  END LOOP;
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', '1XI', 'Batting: playing spin', ((sa_today() + 1) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'batting', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 1XI coach could not schedule "Batting: playing spin". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/1XI/1', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', '1XI', 'Match preparation and middle practice', ((sa_today() + 3) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'match-prep', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 1XI coach could not schedule "Match preparation and middle practice". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/1XI/3', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', '1XI', 'Skills circuit', ((sa_today() + 6) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 120, 'Main nets', NULL, 'skills', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 1XI coach could not schedule "Skills circuit". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/1XI/6', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', '1XI', 'Conditioning and running between the wickets', ((sa_today() + 8) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'fitness', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 1XI coach could not schedule "Conditioning and running between the wickets". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/1XI/8', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'WES/1XI/1')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'WES/1XI/1';
  END IF;
  DELETE FROM training_session_drill WHERE session_id = (ts->>'WES/1XI/1')::uuid;
  INSERT INTO training_session_drill (session_id, drill_id, position, minutes)
  SELECT (ts->>'WES/1XI/1')::uuid, d.id, row_number() OVER (ORDER BY d.pick)::smallint, d.minutes
    FROM (SELECT dr.id, CASE WHEN dr.school_id IS NOT NULL THEN 0 ELSE 1 END AS pick, 20::smallint AS minutes
            FROM drill dr
           WHERE dr.school_id = '22222222-2222-2222-2222-222222222222'::uuid OR (dr.school_id IS NULL AND dr.category IN ('batting', 'fielding'))
           ORDER BY 2, dr.name LIMIT 3) d;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  IF n2 < 2 THEN RAISE EXCEPTION 'The plan for % came to % drills. Nothing was changed.', 'WES/1XI/1', n2; END IF;

  PERFORM app_session_begin((ids->>'coach.wes.u14a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U14A', 'Nets: seam, line and length', ((sa_today() + -4) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 120, 'Main nets', NULL, 'bowling', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U14A coach could not schedule "Nets: seam, line and length". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U14A/-4', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'WES/U14A/-4')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'WES/U14A/-4';
  END IF;
  FOR b IN SELECT * FROM (VALUES ('de300000-0000-4000-8000-000000000106'::uuid, 'present'), ('de300000-0000-4000-8000-000000000107'::uuid, 'present'), ('de300000-0000-4000-8000-000000000108'::uuid, 'present'), ('de300000-0000-4000-8000-000000000109'::uuid, 'late'), ('de300000-0000-4000-8000-000000000110'::uuid, 'present'), ('de300000-0000-4000-8000-000000000111'::uuid, 'present'), ('de300000-0000-4000-8000-000000000112'::uuid, 'present'), ('de300000-0000-4000-8000-000000000113'::uuid, 'present'), ('de300000-0000-4000-8000-000000000114'::uuid, 'excused'), ('de300000-0000-4000-8000-000000000115'::uuid, 'present'), ('de300000-0000-4000-8000-000000000116'::uuid, 'present'), ('de300000-0000-4000-8000-000000000117'::uuid, 'present'), ('de300000-0000-4000-8000-000000000119'::uuid, 'absent'), ('de300000-0000-4000-8000-000000000120'::uuid, 'present')) AS a(player, status) LOOP
    INSERT INTO training_attendance (session_id, player_id, status)
    SELECT (ts->>'WES/U14A/-4')::uuid, b.player, b.status
     WHERE player_school(b.player) = (SELECT t.school_id FROM training_session t WHERE t.id = (ts->>'WES/U14A/-4')::uuid)
    ON CONFLICT (session_id, player_id) DO UPDATE SET status = excluded.status, recorded_at = now()
    RETURNING player_id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The register for % refused a boy. Nothing was changed.', 'WES/U14A/-4'; END IF;
  END LOOP;
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U14A', 'Fielding: high catches and throwing', ((sa_today() + -2) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'fielding', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U14A coach could not schedule "Fielding: high catches and throwing". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U14A/-2', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'WES/U14A/-2')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'WES/U14A/-2';
  END IF;
  FOR b IN SELECT * FROM (VALUES ('de300000-0000-4000-8000-000000000106'::uuid, 'present'), ('de300000-0000-4000-8000-000000000107'::uuid, 'present'), ('de300000-0000-4000-8000-000000000108'::uuid, 'present'), ('de300000-0000-4000-8000-000000000109'::uuid, 'late'), ('de300000-0000-4000-8000-000000000110'::uuid, 'present'), ('de300000-0000-4000-8000-000000000111'::uuid, 'present'), ('de300000-0000-4000-8000-000000000112'::uuid, 'present'), ('de300000-0000-4000-8000-000000000113'::uuid, 'present'), ('de300000-0000-4000-8000-000000000114'::uuid, 'excused'), ('de300000-0000-4000-8000-000000000115'::uuid, 'present'), ('de300000-0000-4000-8000-000000000116'::uuid, 'present'), ('de300000-0000-4000-8000-000000000117'::uuid, 'present'), ('de300000-0000-4000-8000-000000000119'::uuid, 'absent'), ('de300000-0000-4000-8000-000000000120'::uuid, 'present')) AS a(player, status) LOOP
    INSERT INTO training_attendance (session_id, player_id, status)
    SELECT (ts->>'WES/U14A/-2')::uuid, b.player, b.status
     WHERE player_school(b.player) = (SELECT t.school_id FROM training_session t WHERE t.id = (ts->>'WES/U14A/-2')::uuid)
    ON CONFLICT (session_id, player_id) DO UPDATE SET status = excluded.status, recorded_at = now()
    RETURNING player_id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The register for % refused a boy. Nothing was changed.', 'WES/U14A/-2'; END IF;
  END LOOP;
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U14A', 'Batting: playing spin', ((sa_today() + 1) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'batting', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U14A coach could not schedule "Batting: playing spin". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U14A/1', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U14A', 'Match preparation and middle practice', ((sa_today() + 3) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'match-prep', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U14A coach could not schedule "Match preparation and middle practice". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U14A/3', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U14A', 'Skills circuit', ((sa_today() + 6) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 120, 'Main nets', NULL, 'skills', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U14A coach could not schedule "Skills circuit". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U14A/6', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U14A', 'Conditioning and running between the wickets', ((sa_today() + 8) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'fitness', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U14A coach could not schedule "Conditioning and running between the wickets". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U14A/8', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'WES/U14A/1')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'WES/U14A/1';
  END IF;
  DELETE FROM training_session_drill WHERE session_id = (ts->>'WES/U14A/1')::uuid;
  INSERT INTO training_session_drill (session_id, drill_id, position, minutes)
  SELECT (ts->>'WES/U14A/1')::uuid, d.id, row_number() OVER (ORDER BY d.pick)::smallint, d.minutes
    FROM (SELECT dr.id, CASE WHEN dr.school_id IS NOT NULL THEN 0 ELSE 1 END AS pick, 20::smallint AS minutes
            FROM drill dr
           WHERE dr.school_id = '22222222-2222-2222-2222-222222222222'::uuid OR (dr.school_id IS NULL AND dr.category IN ('batting', 'fielding'))
           ORDER BY 2, dr.name LIMIT 3) d;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  IF n2 < 2 THEN RAISE EXCEPTION 'The plan for % came to % drills. Nothing was changed.', 'WES/U14A/1', n2; END IF;

  PERFORM app_session_begin((ids->>'coach.wes.u16b@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U16B', 'Nets: seam, line and length', ((sa_today() + -4) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 120, 'Main nets', NULL, 'bowling', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U16B coach could not schedule "Nets: seam, line and length". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U16B/-4', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'WES/U16B/-4')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'WES/U16B/-4';
  END IF;
  FOR b IN SELECT * FROM (VALUES ('de300000-0000-4000-8000-000000000061'::uuid, 'present'), ('de300000-0000-4000-8000-000000000062'::uuid, 'present'), ('de300000-0000-4000-8000-000000000063'::uuid, 'present'), ('de300000-0000-4000-8000-000000000064'::uuid, 'late'), ('de300000-0000-4000-8000-000000000065'::uuid, 'present'), ('de300000-0000-4000-8000-000000000066'::uuid, 'present'), ('de300000-0000-4000-8000-000000000067'::uuid, 'present'), ('de300000-0000-4000-8000-000000000068'::uuid, 'present'), ('de300000-0000-4000-8000-000000000069'::uuid, 'excused'), ('de300000-0000-4000-8000-000000000070'::uuid, 'present'), ('de300000-0000-4000-8000-000000000071'::uuid, 'present'), ('de300000-0000-4000-8000-000000000072'::uuid, 'present'), ('de300000-0000-4000-8000-000000000073'::uuid, 'present'), ('de300000-0000-4000-8000-000000000074'::uuid, 'absent'), ('de300000-0000-4000-8000-000000000075'::uuid, 'present')) AS a(player, status) LOOP
    INSERT INTO training_attendance (session_id, player_id, status)
    SELECT (ts->>'WES/U16B/-4')::uuid, b.player, b.status
     WHERE player_school(b.player) = (SELECT t.school_id FROM training_session t WHERE t.id = (ts->>'WES/U16B/-4')::uuid)
    ON CONFLICT (session_id, player_id) DO UPDATE SET status = excluded.status, recorded_at = now()
    RETURNING player_id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The register for % refused a boy. Nothing was changed.', 'WES/U16B/-4'; END IF;
  END LOOP;
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U16B', 'Fielding: high catches and throwing', ((sa_today() + -2) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'fielding', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U16B coach could not schedule "Fielding: high catches and throwing". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U16B/-2', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'WES/U16B/-2')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'WES/U16B/-2';
  END IF;
  FOR b IN SELECT * FROM (VALUES ('de300000-0000-4000-8000-000000000061'::uuid, 'present'), ('de300000-0000-4000-8000-000000000062'::uuid, 'present'), ('de300000-0000-4000-8000-000000000063'::uuid, 'present'), ('de300000-0000-4000-8000-000000000064'::uuid, 'late'), ('de300000-0000-4000-8000-000000000065'::uuid, 'present'), ('de300000-0000-4000-8000-000000000066'::uuid, 'present'), ('de300000-0000-4000-8000-000000000067'::uuid, 'present'), ('de300000-0000-4000-8000-000000000068'::uuid, 'present'), ('de300000-0000-4000-8000-000000000069'::uuid, 'excused'), ('de300000-0000-4000-8000-000000000070'::uuid, 'present'), ('de300000-0000-4000-8000-000000000071'::uuid, 'present'), ('de300000-0000-4000-8000-000000000072'::uuid, 'present'), ('de300000-0000-4000-8000-000000000073'::uuid, 'present'), ('de300000-0000-4000-8000-000000000074'::uuid, 'absent'), ('de300000-0000-4000-8000-000000000075'::uuid, 'present')) AS a(player, status) LOOP
    INSERT INTO training_attendance (session_id, player_id, status)
    SELECT (ts->>'WES/U16B/-2')::uuid, b.player, b.status
     WHERE player_school(b.player) = (SELECT t.school_id FROM training_session t WHERE t.id = (ts->>'WES/U16B/-2')::uuid)
    ON CONFLICT (session_id, player_id) DO UPDATE SET status = excluded.status, recorded_at = now()
    RETURNING player_id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The register for % refused a boy. Nothing was changed.', 'WES/U16B/-2'; END IF;
  END LOOP;
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U16B', 'Batting: playing spin', ((sa_today() + 1) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'batting', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U16B coach could not schedule "Batting: playing spin". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U16B/1', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U16B', 'Match preparation and middle practice', ((sa_today() + 3) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'match-prep', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U16B coach could not schedule "Match preparation and middle practice". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U16B/3', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U16B', 'Skills circuit', ((sa_today() + 6) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 120, 'Main nets', NULL, 'skills', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U16B coach could not schedule "Skills circuit". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U16B/6', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U16B', 'Conditioning and running between the wickets', ((sa_today() + 8) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'fitness', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U16B coach could not schedule "Conditioning and running between the wickets". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U16B/8', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'WES/U16B/1')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'WES/U16B/1';
  END IF;
  DELETE FROM training_session_drill WHERE session_id = (ts->>'WES/U16B/1')::uuid;
  INSERT INTO training_session_drill (session_id, drill_id, position, minutes)
  SELECT (ts->>'WES/U16B/1')::uuid, d.id, row_number() OVER (ORDER BY d.pick)::smallint, d.minutes
    FROM (SELECT dr.id, CASE WHEN dr.school_id IS NOT NULL THEN 0 ELSE 1 END AS pick, 20::smallint AS minutes
            FROM drill dr
           WHERE dr.school_id = '22222222-2222-2222-2222-222222222222'::uuid OR (dr.school_id IS NULL AND dr.category IN ('batting', 'fielding'))
           ORDER BY 2, dr.name LIMIT 3) d;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  IF n2 < 2 THEN RAISE EXCEPTION 'The plan for % came to % drills. Nothing was changed.', 'WES/U16B/1', n2; END IF;

  PERFORM app_session_begin((ids->>'coach.kea.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', '1XI', 'Nets: seam, line and length', ((sa_today() + -4) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 120, 'Kearsney nets', NULL, 'bowling', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA 1XI coach could not schedule "Nets: seam, line and length". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/1XI/-4', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'KEA/1XI/-4')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'KEA/1XI/-4';
  END IF;
  FOR b IN SELECT * FROM (VALUES ('de300000-0000-4000-8000-000000000166'::uuid, 'present'), ('de300000-0000-4000-8000-000000000167'::uuid, 'present'), ('de300000-0000-4000-8000-000000000168'::uuid, 'present'), ('de300000-0000-4000-8000-000000000169'::uuid, 'late'), ('de300000-0000-4000-8000-000000000170'::uuid, 'present'), ('de300000-0000-4000-8000-000000000171'::uuid, 'present'), ('de300000-0000-4000-8000-000000000172'::uuid, 'present'), ('de300000-0000-4000-8000-000000000173'::uuid, 'present'), ('de300000-0000-4000-8000-000000000174'::uuid, 'excused'), ('de300000-0000-4000-8000-000000000175'::uuid, 'present'), ('de300000-0000-4000-8000-000000000176'::uuid, 'present'), ('de300000-0000-4000-8000-000000000177'::uuid, 'present'), ('de300000-0000-4000-8000-000000000179'::uuid, 'absent'), ('de300000-0000-4000-8000-000000000180'::uuid, 'present')) AS a(player, status) LOOP
    INSERT INTO training_attendance (session_id, player_id, status)
    SELECT (ts->>'KEA/1XI/-4')::uuid, b.player, b.status
     WHERE player_school(b.player) = (SELECT t.school_id FROM training_session t WHERE t.id = (ts->>'KEA/1XI/-4')::uuid)
    ON CONFLICT (session_id, player_id) DO UPDATE SET status = excluded.status, recorded_at = now()
    RETURNING player_id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The register for % refused a boy. Nothing was changed.', 'KEA/1XI/-4'; END IF;
  END LOOP;
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', '1XI', 'Fielding: high catches and throwing', ((sa_today() + -2) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'fielding', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA 1XI coach could not schedule "Fielding: high catches and throwing". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/1XI/-2', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'KEA/1XI/-2')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'KEA/1XI/-2';
  END IF;
  FOR b IN SELECT * FROM (VALUES ('de300000-0000-4000-8000-000000000166'::uuid, 'present'), ('de300000-0000-4000-8000-000000000167'::uuid, 'present'), ('de300000-0000-4000-8000-000000000168'::uuid, 'present'), ('de300000-0000-4000-8000-000000000169'::uuid, 'late'), ('de300000-0000-4000-8000-000000000170'::uuid, 'present'), ('de300000-0000-4000-8000-000000000171'::uuid, 'present'), ('de300000-0000-4000-8000-000000000172'::uuid, 'present'), ('de300000-0000-4000-8000-000000000173'::uuid, 'present'), ('de300000-0000-4000-8000-000000000174'::uuid, 'excused'), ('de300000-0000-4000-8000-000000000175'::uuid, 'present'), ('de300000-0000-4000-8000-000000000176'::uuid, 'present'), ('de300000-0000-4000-8000-000000000177'::uuid, 'present'), ('de300000-0000-4000-8000-000000000179'::uuid, 'absent'), ('de300000-0000-4000-8000-000000000180'::uuid, 'present')) AS a(player, status) LOOP
    INSERT INTO training_attendance (session_id, player_id, status)
    SELECT (ts->>'KEA/1XI/-2')::uuid, b.player, b.status
     WHERE player_school(b.player) = (SELECT t.school_id FROM training_session t WHERE t.id = (ts->>'KEA/1XI/-2')::uuid)
    ON CONFLICT (session_id, player_id) DO UPDATE SET status = excluded.status, recorded_at = now()
    RETURNING player_id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The register for % refused a boy. Nothing was changed.', 'KEA/1XI/-2'; END IF;
  END LOOP;
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', '1XI', 'Batting: playing spin', ((sa_today() + 1) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'batting', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA 1XI coach could not schedule "Batting: playing spin". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/1XI/1', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', '1XI', 'Match preparation and middle practice', ((sa_today() + 3) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'match-prep', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA 1XI coach could not schedule "Match preparation and middle practice". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/1XI/3', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', '1XI', 'Skills circuit', ((sa_today() + 6) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 120, 'Kearsney nets', NULL, 'skills', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA 1XI coach could not schedule "Skills circuit". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/1XI/6', v);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', '1XI', 'Conditioning and running between the wickets', ((sa_today() + 8) + time '15:00') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'fitness', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA 1XI coach could not schedule "Conditioning and running between the wickets". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/1XI/8', v);
  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>'KEA/1XI/1')::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', 'KEA/1XI/1';
  END IF;
  DELETE FROM training_session_drill WHERE session_id = (ts->>'KEA/1XI/1')::uuid;
  INSERT INTO training_session_drill (session_id, drill_id, position, minutes)
  SELECT (ts->>'KEA/1XI/1')::uuid, d.id, row_number() OVER (ORDER BY d.pick)::smallint, d.minutes
    FROM (SELECT dr.id, CASE WHEN dr.school_id IS NOT NULL THEN 0 ELSE 1 END AS pick, 20::smallint AS minutes
            FROM drill dr
           WHERE (dr.school_id IS NULL AND dr.category IN ('batting', 'fielding'))
           ORDER BY 2, dr.name LIMIT 3) d;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  IF n2 < 2 THEN RAISE EXCEPTION 'The plan for % came to % drills. Nothing was changed.', 'KEA/1XI/1', n2; END IF;

  PERFORM app_session_begin((ids->>'coach.wes.2xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', '2XI', 'Bowling: run-up and rhythm', ((sa_today() + 3) + time '15:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'bowling', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 2XI coach could not schedule "Bowling: run-up and rhythm". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/2XI/3', v);

  PERFORM app_session_begin((ids->>'coach.wes.3xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', '3XI', 'Fielding: ground fielding and backing up', ((sa_today() + 4) + time '15:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'fielding', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 3XI coach could not schedule "Fielding: ground fielding and backing up". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/3XI/4', v);

  PERFORM app_session_begin((ids->>'coach.wes.u16a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U16A', 'Batting: front-foot drives', ((sa_today() + 2) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'batting', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U16A coach could not schedule "Batting: front-foot drives". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U16A/2', v);

  PERFORM app_session_begin((ids->>'coach.wes.u15a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U15A', 'Fielding: ground fielding and backing up', ((sa_today() + 4) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'fielding', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U15A coach could not schedule "Fielding: ground fielding and backing up". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U15A/4', v);

  PERFORM app_session_begin((ids->>'coach.wes.u15b@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U15B', 'Batting: front-foot drives', ((sa_today() + 2) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'batting', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U15B coach could not schedule "Batting: front-foot drives". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U15B/2', v);

  PERFORM app_session_begin((ids->>'coach.wes.u14b@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U14B', 'Fielding: ground fielding and backing up', ((sa_today() + 4) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'fielding', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U14B coach could not schedule "Fielding: ground fielding and backing up". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U14B/4', v);

  PERFORM app_session_begin((ids->>'coach.wes.u13a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U13A', 'Batting: front-foot drives', ((sa_today() + 2) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'batting', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U13A coach could not schedule "Batting: front-foot drives". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U13A/2', v);

  PERFORM app_session_begin((ids->>'coach.wes.u12a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('22222222-2222-2222-2222-222222222222', 'U12A', 'Bowling: run-up and rhythm', ((sa_today() + 3) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Main nets', NULL, 'bowling', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES U12A coach could not schedule "Bowling: run-up and rhythm". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('WES/U12A/3', v);

  PERFORM app_session_begin((ids->>'coach.kea.2xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', '2XI', 'Bowling: run-up and rhythm', ((sa_today() + 3) + time '15:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'bowling', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA 2XI coach could not schedule "Bowling: run-up and rhythm". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/2XI/3', v);

  PERFORM app_session_begin((ids->>'coach.kea.3xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', '3XI', 'Fielding: ground fielding and backing up', ((sa_today() + 4) + time '15:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'fielding', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA 3XI coach could not schedule "Fielding: ground fielding and backing up". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/3XI/4', v);

  PERFORM app_session_begin((ids->>'coach.kea.u16a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', 'U16A', 'Batting: front-foot drives', ((sa_today() + 2) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'batting', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA U16A coach could not schedule "Batting: front-foot drives". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/U16A/2', v);

  PERFORM app_session_begin((ids->>'coach.kea.u16b@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', 'U16B', 'Bowling: run-up and rhythm', ((sa_today() + 3) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'bowling', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA U16B coach could not schedule "Bowling: run-up and rhythm". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/U16B/3', v);

  PERFORM app_session_begin((ids->>'coach.kea.u15a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', 'U15A', 'Fielding: ground fielding and backing up', ((sa_today() + 4) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'fielding', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA U15A coach could not schedule "Fielding: ground fielding and backing up". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/U15A/4', v);

  PERFORM app_session_begin((ids->>'coach.kea.u15b@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', 'U15B', 'Batting: front-foot drives', ((sa_today() + 2) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'batting', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA U15B coach could not schedule "Batting: front-foot drives". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/U15B/2', v);

  PERFORM app_session_begin((ids->>'coach.kea.u14a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', 'U14A', 'Bowling: run-up and rhythm', ((sa_today() + 3) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'bowling', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA U14A coach could not schedule "Bowling: run-up and rhythm". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/U14A/3', v);

  PERFORM app_session_begin((ids->>'coach.kea.u14b@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', 'U14B', 'Fielding: ground fielding and backing up', ((sa_today() + 4) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'fielding', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA U14B coach could not schedule "Fielding: ground fielding and backing up". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/U14B/4', v);

  PERFORM app_session_begin((ids->>'coach.kea.u13a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', 'U13A', 'Batting: front-foot drives', ((sa_today() + 2) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'batting', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA U13A coach could not schedule "Batting: front-foot drives". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/U13A/2', v);

  PERFORM app_session_begin((ids->>'coach.kea.u12a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES ('33333333-3333-3333-3333-333333333333', 'U12A', 'Bowling: run-up and rhythm', ((sa_today() + 3) + time '14:30') AT TIME ZONE 'Africa/Johannesburg', 90, 'Kearsney nets', NULL, 'bowling', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA U12A coach could not schedule "Bowling: run-up and rhythm". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object('KEA/U12A/3', v);

  -- ── 5 · Skills assessments and development notes, by the coaches ──
  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR srow IN SELECT * FROM (VALUES ('technical', 'lineAndLength', 13), ('technical', 'spin', 14), ('technical', 'variations', 11), ('mental', 'composure', 13), ('mental', 'leadership', 15)) AS x(category, metric, score) LOOP
    INSERT INTO player_skill (player_id, assessed_on, assessed_by, category, metric, score, note)
    VALUES ('de300000-0000-4000-8000-000000000001'::uuid, (sa_today() + -30), app_user_id(), srow.category, srow.metric, srow.score, NULL)
    ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL
    DO UPDATE SET score = excluded.score, note = excluded.note
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The assessment of boy 1 was refused. Nothing was changed.'; END IF;
  END LOOP;

  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR srow IN SELECT * FROM (VALUES ('technical', 'lineAndLength', 14), ('technical', 'spin', 15), ('technical', 'variations', 12), ('mental', 'composure', 14), ('mental', 'leadership', 15)) AS x(category, metric, score) LOOP
    INSERT INTO player_skill (player_id, assessed_on, assessed_by, category, metric, score, note)
    VALUES ('de300000-0000-4000-8000-000000000001'::uuid, (sa_today() + -3), app_user_id(), srow.category, srow.metric, srow.score, NULL)
    ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL
    DO UPDATE SET score = excluded.score, note = excluded.note
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The assessment of boy 1 was refused. Nothing was changed.'; END IF;
  END LOOP;

  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR srow IN SELECT * FROM (VALUES ('technical', 'footwork', 12), ('technical', 'timing', 13), ('technical', 'catching', 14), ('physical', 'agility', 13)) AS x(category, metric, score) LOOP
    INSERT INTO player_skill (player_id, assessed_on, assessed_by, category, metric, score, note)
    VALUES ('de300000-0000-4000-8000-000000000002'::uuid, (sa_today() + -3), app_user_id(), srow.category, srow.metric, srow.score, NULL)
    ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL
    DO UPDATE SET score = excluded.score, note = excluded.note
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The assessment of boy 2 was refused. Nothing was changed.'; END IF;
  END LOOP;

  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR srow IN SELECT * FROM (VALUES ('technical', 'glovework', 14), ('technical', 'catching', 15), ('mental', 'concentration', 13)) AS x(category, metric, score) LOOP
    INSERT INTO player_skill (player_id, assessed_on, assessed_by, category, metric, score, note)
    VALUES ('de300000-0000-4000-8000-000000000006'::uuid, (sa_today() + -3), app_user_id(), srow.category, srow.metric, srow.score, NULL)
    ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL
    DO UPDATE SET score = excluded.score, note = excluded.note
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The assessment of boy 6 was refused. Nothing was changed.'; END IF;
  END LOOP;

  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR srow IN SELECT * FROM (VALUES ('technical', 'lineAndLength', 12), ('technical', 'seamAndSwing', 13), ('physical', 'bowlingPace', 15), ('physical', 'stamina', 12)) AS x(category, metric, score) LOOP
    INSERT INTO player_skill (player_id, assessed_on, assessed_by, category, metric, score, note)
    VALUES ('de300000-0000-4000-8000-000000000008'::uuid, (sa_today() + -3), app_user_id(), srow.category, srow.metric, srow.score, NULL)
    ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL
    DO UPDATE SET score = excluded.score, note = excluded.note
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The assessment of boy 8 was refused. Nothing was changed.'; END IF;
  END LOOP;

  PERFORM app_session_begin((ids->>'coach.wes.u14a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR srow IN SELECT * FROM (VALUES ('technical', 'footwork', 12), ('technical', 'defence', 13), ('technical', 'againstSpin', 11), ('mental', 'concentration', 12)) AS x(category, metric, score) LOOP
    INSERT INTO player_skill (player_id, assessed_on, assessed_by, category, metric, score, note)
    VALUES ('de300000-0000-4000-8000-000000000106'::uuid, (sa_today() + -3), app_user_id(), srow.category, srow.metric, srow.score, NULL)
    ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL
    DO UPDATE SET score = excluded.score, note = excluded.note
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The assessment of boy 106 was refused. Nothing was changed.'; END IF;
  END LOOP;

  PERFORM app_session_begin((ids->>'coach.wes.u14a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR srow IN SELECT * FROM (VALUES ('technical', 'spin', 11), ('technical', 'catching', 12), ('mental', 'teamwork', 14)) AS x(category, metric, score) LOOP
    INSERT INTO player_skill (player_id, assessed_on, assessed_by, category, metric, score, note)
    VALUES ('de300000-0000-4000-8000-000000000107'::uuid, (sa_today() + -3), app_user_id(), srow.category, srow.metric, srow.score, NULL)
    ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL
    DO UPDATE SET score = excluded.score, note = excluded.note
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The assessment of boy 107 was refused. Nothing was changed.'; END IF;
  END LOOP;

  PERFORM app_session_begin((ids->>'coach.wes.u16b@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR srow IN SELECT * FROM (VALUES ('technical', 'footwork', 11), ('technical', 'timing', 12), ('technical', 'shotRange', 11), ('mental', 'determination', 14)) AS x(category, metric, score) LOOP
    INSERT INTO player_skill (player_id, assessed_on, assessed_by, category, metric, score, note)
    VALUES ('de300000-0000-4000-8000-000000000061'::uuid, (sa_today() + -3), app_user_id(), srow.category, srow.metric, srow.score, NULL)
    ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL
    DO UPDATE SET score = excluded.score, note = excluded.note
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The assessment of boy 61 was refused. Nothing was changed.'; END IF;
  END LOOP;

  PERFORM app_session_begin((ids->>'coach.kea.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  FOR srow IN SELECT * FROM (VALUES ('technical', 'footwork', 13), ('technical', 'timing', 14), ('technical', 'againstPace', 12), ('mental', 'composure', 13)) AS x(category, metric, score) LOOP
    INSERT INTO player_skill (player_id, assessed_on, assessed_by, category, metric, score, note)
    VALUES ('de300000-0000-4000-8000-000000000166'::uuid, (sa_today() + -3), app_user_id(), srow.category, srow.metric, srow.score, NULL)
    ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL
    DO UPDATE SET score = excluded.score, note = excluded.note
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The assessment of boy 166 was refused. Nothing was changed.'; END IF;
  END LOOP;

  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO development_note (player_id, school_id, author_id, body, about_discipline, adjustment, observed_on)
  SELECT 'de300000-0000-4000-8000-000000000001'::uuid, player_school('de300000-0000-4000-8000-000000000001'::uuid), app_user_id(), 'Leading the attack well. Arm ball is coming on; keep working on bowling to a plan with the field set.', 'bowling', 1, (sa_today() + -3)
   WHERE player_school('de300000-0000-4000-8000-000000000001'::uuid) IS NOT NULL
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The development note on boy 1 was refused. Nothing was changed.'; END IF;

  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO development_note (player_id, school_id, author_id, body, about_discipline, adjustment, observed_on)
  SELECT 'de300000-0000-4000-8000-000000000002'::uuid, player_school('de300000-0000-4000-8000-000000000002'::uuid), app_user_id(), 'Good tempo in nets. Leaving well outside off. Next: rotating the strike against spin.', 'batting', NULL, (sa_today() + -2)
   WHERE player_school('de300000-0000-4000-8000-000000000002'::uuid) IS NOT NULL
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The development note on boy 2 was refused. Nothing was changed.'; END IF;

  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO development_note (player_id, school_id, author_id, body, about_discipline, adjustment, observed_on)
  SELECT 'de300000-0000-4000-8000-000000000008'::uuid, player_school('de300000-0000-4000-8000-000000000008'::uuid), app_user_id(), 'Quick and getting quicker. Workload kept to the plan agreed with home; follow-through drills to protect his back.', 'bowling', NULL, (sa_today() + -4)
   WHERE player_school('de300000-0000-4000-8000-000000000008'::uuid) IS NOT NULL
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The development note on boy 8 was refused. Nothing was changed.'; END IF;

  PERFORM app_session_begin((ids->>'coach.wes.u14a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO development_note (player_id, school_id, author_id, body, about_discipline, adjustment, observed_on)
  SELECT 'de300000-0000-4000-8000-000000000106'::uuid, player_school('de300000-0000-4000-8000-000000000106'::uuid), app_user_id(), 'Much better at playing spin late. Ready to open in the next fixture.', 'batting', 1, (sa_today() + -2)
   WHERE player_school('de300000-0000-4000-8000-000000000106'::uuid) IS NOT NULL
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The development note on boy 106 was refused. Nothing was changed.'; END IF;

  PERFORM app_session_begin((ids->>'coach.kea.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO development_note (player_id, school_id, author_id, body, about_discipline, adjustment, observed_on)
  SELECT 'de300000-0000-4000-8000-000000000166'::uuid, player_school('de300000-0000-4000-8000-000000000166'::uuid), app_user_id(), 'Set the tone at practice this week. Asked good questions about field placings.', NULL, NULL, (sa_today() + -3)
   WHERE player_school('de300000-0000-4000-8000-000000000166'::uuid) IS NOT NULL
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The development note on boy 166 was refused. Nothing was changed.'; END IF;

  -- ── 6 · Workload: the module at WES, three consents, the nets loads ──
  PERFORM app_session_begin((ids->>'platform@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO feature_grant (key, school_id, granted, note, changed_by, changed_at)
  VALUES ('workload_monitoring', '22222222-2222-2222-2222-222222222222', true, 'Recorded for the demo (demo-roles)', app_user_id(), now())
  ON CONFLICT (key, school_id) DO UPDATE
    SET granted = excluded.granted, note = excluded.note, changed_by = excluded.changed_by, changed_at = now();

  PERFORM app_session_begin((ids->>'parent.008@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT * INTO r FROM health_monitoring_consent_set('de300000-0000-4000-8000-000000000008'::uuid, true, 'health-monitoring-2026-09', NULL, NULL, NULL);
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The parent of boy 8 could not consent to health monitoring: %. Nothing was changed.', r.reason; END IF;
  PERFORM app_session_begin((ids->>'parent.013@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT * INTO r FROM health_monitoring_consent_set('de300000-0000-4000-8000-000000000013'::uuid, true, 'health-monitoring-2026-09', NULL, NULL, NULL);
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The parent of boy 13 could not consent to health monitoring: %. Nothing was changed.', r.reason; END IF;
  PERFORM app_session_begin((ids->>'parent.015@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT * INTO r FROM health_monitoring_consent_set('de300000-0000-4000-8000-000000000015'::uuid, true, 'health-monitoring-2026-09', NULL, NULL, NULL);
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The parent of boy 15 could not consent to health monitoring: %. Nothing was changed.', r.reason; END IF;

  PERFORM app_session_begin((ids->>'coach.wes.1xi@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO load_entry (player_id, kind, training_session_id, on_date, band, units, rpe, minutes, supersedes)
  VALUES ('de300000-0000-4000-8000-000000000008'::uuid, 'nets', (ts->>'WES/1XI/-4')::uuid, (sa_today() + -4), '24_36', NULL, 7, 50, NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The nets load for boy 8 was refused. Nothing was changed.'; END IF;
  INSERT INTO load_entry (player_id, kind, training_session_id, on_date, band, units, rpe, minutes, supersedes)
  VALUES ('de300000-0000-4000-8000-000000000013'::uuid, 'nets', (ts->>'WES/1XI/-4')::uuid, (sa_today() + -4), '12_24', NULL, 6, 40, NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The nets load for boy 13 was refused. Nothing was changed.'; END IF;
  INSERT INTO load_entry (player_id, kind, training_session_id, on_date, band, units, rpe, minutes, supersedes)
  VALUES ('de300000-0000-4000-8000-000000000015'::uuid, 'nets', (ts->>'WES/1XI/-4')::uuid, (sa_today() + -4), '12_24', NULL, 5, 35, NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The nets load for boy 15 was refused. Nothing was changed.'; END IF;

  -- ── 7 · A safeguarding concern, raised by a coach and held by the DSO ──
  PERFORM app_session_begin((ids->>'coach.wes.u14a@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT * INTO r FROM safeguarding_concern_raise(
    p_school => '22222222-2222-2222-2222-222222222222'::uuid, p_about_kind => 'child', p_nature => ARRAY['other']::text[], p_certainty => 'suspicion',
    p_account => 'After Tuesday''s practice one of the U14A boys seemed upset and was very quiet. I spoke with him briefly; he said he was tired and fine. Raising it so the DSO is aware. The team manager let his parents know.', p_how_learned => 'witness', p_subject_player => 'de300000-0000-4000-8000-000000000112'::uuid,
    p_subject_person => NULL, p_subject_text => NULL, p_occurred_on => (sa_today() + -3), p_occurred_where => 'Junior nets',
    p_authorities_told => NULL, p_named_ok => true, p_preferred_dso => NULL);
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The U14A coach could not raise the concern: %. Nothing was changed.', r.reason; END IF;
  ref := r.reference;

  PERFORM app_session_begin((ids->>'dso.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT i.id INTO v FROM safeguarding_inbox(NULL) i WHERE i.reference = ref;
  IF v IS NULL THEN RAISE EXCEPTION 'The concern did not reach the Westville DSO. Nothing was changed.'; END IF;
  SELECT * INTO r FROM safeguarding_assign(v, app_user_id());
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The DSO could not take the concern: %. Nothing was changed.', r.reason; END IF;
  SELECT * INTO r FROM safeguarding_note(v, 'note', 'Spoke with the coach. Arranged a quiet check-in with the boy at school on Monday, with his class teacher present.');
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The DSO could not note the concern: %. Nothing was changed.', r.reason; END IF;
  SELECT * INTO r FROM safeguarding_note(v, 'guardian_contacted', 'Spoke with his mother by phone. Nothing further at home; she will let us know if anything changes.');
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The DSO could not note the call home: %. Nothing was changed.', r.reason; END IF;

  -- ── 8 · A guardian link waiting to be verified ──
  PERFORM app_session_begin((ids->>'registrar.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT * INTO r FROM guardian_link_establish((ids->>'parent.030@example.invalid')::uuid, 'de300000-0000-4000-8000-000000000140'::uuid, 'guardian');
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The office could not open the guardian link: %. Nothing was changed.', r.reason; END IF;

  -- ── 9 · A pending request for a role ──
  PERFORM app_session_begin((ids->>'parent.020@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO role_request (person_id, role, school_id, team_code, player_id, note)
  VALUES (app_user_id(), 'scorer', '22222222-2222-2222-2222-222222222222', NULL, NULL, 'I keep the book for the 2XI most Saturdays and can help on the pad.')
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The parent could not ask to score. Nothing was changed.'; END IF;

  -- ── 10 · A lift driver's declaration ──
  IF NOT (current_setting('demo_roles.declared')::boolean) THEN
  PERFORM app_session_begin((ids->>'parent.002@example.invalid')::uuid, 'demo-roles', NULL, NULL);
    SELECT ok, reason INTO r FROM lift_driver_declare('22222222-2222-2222-2222-222222222222'::uuid, 'Silver hatchback (demo)', 'DEMO 002', 3, true, true, true, true, true,
                                                       (contacts->>'2:1')::uuid);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The parent could not make the driver''s declaration: %. Nothing was changed.', r.reason; END IF;
  END IF;

  -- ── 11 · Availability for the coming fixtures (only those already there) ──
  FOR f IN SELECT * FROM jsonb_to_recordset(current_setting('demo_roles.coming')::jsonb)
                    AS x(match_id uuid, school_id uuid, team_code text, starts_at timestamptz) ORDER BY x.starts_at LOOP
    FOR b IN SELECT pl.id AS player, pl.squad_no, g.email
               FROM jsonb_to_recordset(current_setting('demo_roles.boys')::jsonb) AS pl(id uuid, school_id uuid, team_code text, squad_no int)
               JOIN jsonb_to_recordset(current_setting('demo_roles.parents')::jsonb) AS g(player uuid, email text) ON g.player = pl.id
              WHERE pl.school_id = f.school_id AND pl.team_code = f.team_code AND pl.squad_no BETWEEN 1 AND 12
                AND NOT (current_setting('demo_roles.answered')::jsonb ? (f.match_id::text || ':' || pl.id::text)) LOOP
      PERFORM app_session_begin((ids->>b.email)::uuid, 'demo-roles', NULL, NULL);
      INSERT INTO match_availability (match_id, player_id, school_id, status, reason_kind, note, declared_by, declared_at)
      VALUES (f.match_id, b.player, match_school(f.match_id),
              CASE b.squad_no WHEN 5 THEN 'doubtful' WHEN 10 THEN 'unavailable' ELSE 'available' END,
              CASE b.squad_no WHEN 5 THEN 'family' WHEN 10 THEN 'academic' END, NULL, app_user_id(), now())
      ON CONFLICT (match_id, player_id) DO UPDATE
        SET status = excluded.status, reason_kind = excluded.reason_kind, note = excluded.note,
            declared_by = excluded.declared_by, declared_at = now()
      RETURNING match_id INTO v;
      IF v IS NULL THEN RAISE EXCEPTION 'A parent could not answer for his son. Nothing was changed.'; END IF;
      avail := avail + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'demo-roles: % clearances, % availability answers', n, avail;

  -- ── 12 · Transport ──
  PERFORM app_session_begin((ids->>'transport.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  IF NOT (current_setting('demo_roles.vehicles')::jsonb ? 'WES DEMO 2') THEN
  INSERT INTO vehicle (school_id, registration, description, kind, capacity, condition, next_service_on, active, notes,
                         insurance_expires_on, roadworthy_expires_on)
    VALUES ('22222222-2222-2222-2222-222222222222', 'WES DEMO 2', 'Demo bus, 60 seats', 'bus', 60, 'good', (sa_today() + 40), true, 'Recorded for the demo (demo-roles)', date '2027-06-30', date '2027-02-28')
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The WES transport coordinator could not add the bus. Nothing was changed.'; END IF;
  END IF;

  PERFORM app_session_begin((ids->>'transport.kea@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  IF NOT (current_setting('demo_roles.vehicles')::jsonb ? 'KEA DEMO 1') THEN
  INSERT INTO vehicle (school_id, registration, description, kind, capacity, condition, next_service_on, active, notes,
                         insurance_expires_on, roadworthy_expires_on)
    VALUES ('33333333-3333-3333-3333-333333333333', 'KEA DEMO 1', 'Demo minibus, 16 seats', 'minibus', 16, 'excellent', (sa_today() + 25), true, 'Recorded for the demo (demo-roles)', date '2027-04-30', date '2027-03-31')
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The KEA transport coordinator could not add the minibus. Nothing was changed.'; END IF;
  END IF;

  -- ── 13 · Lift clubs at Kearsney ──
  PERFORM app_session_begin((ids->>'platform@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO feature_grant (key, school_id, granted, note, changed_by, changed_at)
  VALUES ('lift_club', '33333333-3333-3333-3333-333333333333', true, 'Recorded for the demo (demo-roles)', app_user_id(), now())
  ON CONFLICT (key, school_id) DO UPDATE
    SET granted = excluded.granted, note = excluded.note, changed_by = excluded.changed_by, changed_at = now();
  PERFORM app_session_begin((ids->>'principal.kea@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  SELECT ok, reason INTO r FROM lift_policy_sign('33333333-3333-3333-3333-333333333333', 'Kearsney lift club (demo). Parents may offer seats in their own cars to their own son''s fixtures, and other parents may ask for a seat for theirs. A seat is confirmed only while the boy''s guardian and the driver have both said yes to the lift as it now stands. Every passenger is seated and belted. Drivers hold a valid licence, insurance and a roadworthy car. Meet at the named point at the named time. Concerns go to the school''s DSO.', false, true, 'The chapel car park');
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The Kearsney principal could not sign the lift policy: %. Nothing was changed.', r.reason; END IF;

  -- ── 14 · Sponsors ──
  PERFORM app_session_begin((ids->>'bursar@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO sponsor (school_id, name, category, logo_text, logo_bg, active, created_by)
  VALUES ('11111111-1111-1111-1111-111111111111', btrim('Midlands Motors (demo)'), 'automotive', 'MIDLANDS', '#1d4ed8', true, app_user_id())
  ON CONFLICT (school_id, lower(btrim(name))) DO UPDATE
    SET category = excluded.category, logo_text = excluded.logo_text, logo_bg = excluded.logo_bg, active = excluded.active
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Could not add the sponsor %. Nothing was changed.', 'Midlands Motors (demo)'; END IF;
  sp := sp || jsonb_build_object('Midlands Motors (demo)', v);
  INSERT INTO sponsor (school_id, name, category, logo_text, logo_bg, active, created_by)
  VALUES ('11111111-1111-1111-1111-111111111111', btrim('Hilltop Outfitters (demo)'), 'sportswear', 'HILLTOP', '#065f46', true, app_user_id())
  ON CONFLICT (school_id, lower(btrim(name))) DO UPDATE
    SET category = excluded.category, logo_text = excluded.logo_text, logo_bg = excluded.logo_bg, active = excluded.active
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Could not add the sponsor %. Nothing was changed.', 'Hilltop Outfitters (demo)'; END IF;
  sp := sp || jsonb_build_object('Hilltop Outfitters (demo)', v);
  INSERT INTO sponsorship (school_id, sponsor_id, placement, match_id, starts_on, ends_on, contract_value_zar, school_share_pct,
                           agreed_by, agreed_at, exclusive, exclusive_scope, competition_id, waiver_note)
  SELECT s.school_id, s.id, 'scorecard_footer', NULL, date '2026-10-01', date '2027-03-31', 45000, 100, app_user_id(), now(),
         false, NULL, NULL, NULL
    FROM sponsor s WHERE s.id = (sp->>'Midlands Motors (demo)')::uuid
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Could not place %. Nothing was changed.', 'Midlands Motors (demo)'; END IF;
  INSERT INTO sponsorship (school_id, sponsor_id, placement, match_id, starts_on, ends_on, contract_value_zar, school_share_pct,
                           agreed_by, agreed_at, exclusive, exclusive_scope, competition_id, waiver_note)
  SELECT s.school_id, s.id, 'ground_board', NULL, date '2026-10-01', date '2027-03-31', 18000, 100, app_user_id(), now(),
         false, NULL, NULL, NULL
    FROM sponsor s WHERE s.id = (sp->>'Hilltop Outfitters (demo)')::uuid
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Could not place %. Nothing was changed.', 'Hilltop Outfitters (demo)'; END IF;

  PERFORM app_session_begin((ids->>'principal.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO sponsor (school_id, name, category, logo_text, logo_bg, active, created_by)
  VALUES ('22222222-2222-2222-2222-222222222222', btrim('Berea Family Pharmacy (demo)'), 'health', 'BEREA', '#0f766e', true, app_user_id())
  ON CONFLICT (school_id, lower(btrim(name))) DO UPDATE
    SET category = excluded.category, logo_text = excluded.logo_text, logo_bg = excluded.logo_bg, active = excluded.active
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Could not add the sponsor %. Nothing was changed.', 'Berea Family Pharmacy (demo)'; END IF;
  sp := sp || jsonb_build_object('Berea Family Pharmacy (demo)', v);
  INSERT INTO sponsor (school_id, name, category, logo_text, logo_bg, active, created_by)
  VALUES ('22222222-2222-2222-2222-222222222222', btrim('Westville Physio Rooms (demo)'), 'health', 'PHYSIO', '#7c3aed', true, app_user_id())
  ON CONFLICT (school_id, lower(btrim(name))) DO UPDATE
    SET category = excluded.category, logo_text = excluded.logo_text, logo_bg = excluded.logo_bg, active = excluded.active
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Could not add the sponsor %. Nothing was changed.', 'Westville Physio Rooms (demo)'; END IF;
  sp := sp || jsonb_build_object('Westville Physio Rooms (demo)', v);
  INSERT INTO sponsorship (school_id, sponsor_id, placement, match_id, starts_on, ends_on, contract_value_zar, school_share_pct,
                           agreed_by, agreed_at, exclusive, exclusive_scope, competition_id, waiver_note)
  SELECT s.school_id, s.id, 'scorecard_footer', NULL, date '2026-10-01', date '2027-03-31', 30000, 100, app_user_id(), now(),
         true, 'school', NULL, NULL
    FROM sponsor s WHERE s.id = (sp->>'Berea Family Pharmacy (demo)')::uuid
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Could not place %. Nothing was changed.', 'Berea Family Pharmacy (demo)'; END IF;
  INSERT INTO sponsorship (school_id, sponsor_id, placement, match_id, starts_on, ends_on, contract_value_zar, school_share_pct,
                           agreed_by, agreed_at, exclusive, exclusive_scope, competition_id, waiver_note)
  SELECT s.school_id, s.id, 'ground_board', NULL, date '2026-10-15', date '2027-03-31', 12000, 100, app_user_id(), now(),
         false, NULL, NULL, 'Both are local family health businesses; the sports committee agreed to share the category for this season.'
    FROM sponsor s WHERE s.id = (sp->>'Westville Physio Rooms (demo)')::uuid
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Could not place %. Nothing was changed.', 'Westville Physio Rooms (demo)'; END IF;

  -- ── 15 · The league ──
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(current_setting('demo_roles.entrants')::jsonb) e
                  WHERE e->>'school_id' = '33333333-3333-3333-3333-333333333333' AND e->>'team_code' = '1XI') THEN
    PERFORM app_session_begin((ids->>'league@example.invalid')::uuid, 'demo-roles', NULL, NULL);
    SELECT * INTO r FROM competition_entrant_invite('99999999-0000-0000-0000-000000000001'::uuid, '33333333-3333-3333-3333-333333333333'::uuid, '1XI', 'Kearsney 1st XI');
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not invite Kearsney: %. Nothing was changed.', r.reason; END IF;
    v := r.entrant_id;
    PERFORM app_session_begin((ids->>'dos.kea@example.invalid')::uuid, 'demo-roles', NULL, NULL);
    SELECT * INTO r FROM competition_entrant_respond(v, true);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'Kearsney could not accept: %. Nothing was changed.', r.reason; END IF;
    PERFORM app_session_begin((ids->>'league@example.invalid')::uuid, 'demo-roles', NULL, NULL);
    SELECT * INTO r FROM place_entrant(v, 'd1710000-0000-0000-0000-000000000001'::uuid);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not place Kearsney: %. Nothing was changed.', r.reason; END IF;
  END IF;

  IF NOT (current_setting('demo_roles.conditions')::boolean) THEN
    PERFORM app_session_begin((ids->>'league@example.invalid')::uuid, 'demo-roles', NULL, NULL);
    SELECT * INTO r FROM condition_set_draft('99999999-0000-0000-0000-000000000001'::uuid, 'League table rules 2026/27 (demo)', sa_today() + 1);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not draft its conditions: % %. Nothing was changed.', r.reason, r.detail; END IF;
    v := r.set_id;
    SELECT * INTO r FROM condition_value_enter(v, 'points.win', '', '2'::jsonb, 'confirmed',
           'KZN Schools T20 League rules (demo)', 'Section 4', date '2026-09-15', NULL);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not enter points.win: % %. Nothing was changed.', r.reason, r.detail; END IF;
    SELECT * INTO r FROM condition_value_enter(v, 'points.tie', '', '1'::jsonb, 'confirmed',
           'KZN Schools T20 League rules (demo)', 'Section 4', date '2026-09-15', NULL);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not enter points.tie: % %. Nothing was changed.', r.reason, r.detail; END IF;
    SELECT * INTO r FROM condition_value_enter(v, 'points.no_result', '', '1'::jsonb, 'confirmed',
           'KZN Schools T20 League rules (demo)', 'Section 4', date '2026-09-15', NULL);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not enter points.no_result: % %. Nothing was changed.', r.reason, r.detail; END IF;
    SELECT * INTO r FROM condition_value_enter(v, 'points.abandoned', '', '1'::jsonb, 'confirmed',
           'KZN Schools T20 League rules (demo)', 'Section 4', date '2026-09-15', NULL);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not enter points.abandoned: % %. Nothing was changed.', r.reason, r.detail; END IF;
    SELECT * INTO r FROM condition_value_enter(v, 'points.loss', '', '0'::jsonb, 'confirmed',
           'KZN Schools T20 League rules (demo)', 'Section 4', date '2026-09-15', NULL);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not enter points.loss: % %. Nothing was changed.', r.reason, r.detail; END IF;
    SELECT * INTO r FROM condition_value_enter(v, 'table.order', '', '["points","wins","nrr"]'::jsonb, 'confirmed',
           'KZN Schools T20 League rules (demo)', 'Section 4', date '2026-09-15', NULL);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not enter table.order: % %. Nothing was changed.', r.reason, r.detail; END IF;
    -- Left a DRAFT on purpose: published, it would take effect tomorrow for the
    -- season's fixtures in this league, which are the season builder's. The
    -- league admin publishes it in the walk-through if Kameel wants to show it.
  END IF;

  -- ── 16 · School news ──
  PERFORM app_session_begin((ids->>'dos.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO news_post (scope, school_id, team_code, competition_id, title, body, published_at, urgency, kind, fixture_id)
  VALUES ('school', '22222222-2222-2222-2222-222222222222', NULL, NULL, 'Nets timetable for the rest of term', 'Senior nets run Monday, Wednesday and Thursday from 15:00; junior sides Tuesday and Thursday from 14:30. Bring water and a hat: the sun is back. Coaches will post any change here.', now(), 'low', 'post', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The director of sport could not post "Nets timetable for the rest of term". Nothing was changed.'; END IF;

  PERFORM app_session_begin((ids->>'dos.wes@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO news_post (scope, school_id, team_code, competition_id, title, body, published_at, urgency, kind, fixture_id)
  VALUES ('school', '22222222-2222-2222-2222-222222222222', NULL, NULL, 'Thank you to our parent scorers', 'Our sides could not play without the parents who keep the book and run the pad. If you would like to help, ask in the app (Settings, Ask for a role) and the office will be in touch.', now(), 'low', 'post', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The director of sport could not post "Thank you to our parent scorers". Nothing was changed.'; END IF;

  PERFORM app_session_begin((ids->>'dos.kea@example.invalid')::uuid, 'demo-roles', NULL, NULL);
  INSERT INTO news_post (scope, school_id, team_code, competition_id, title, body, published_at, urgency, kind, fixture_id)
  VALUES ('school', '33333333-3333-3333-3333-333333333333', NULL, NULL, 'New sight screens at the Oval', 'The new sight screens are up at the Oval in time for the derby season. Thank you to the groundstaff and to the families who helped raise the money.', now(), 'low', 'post', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The director of sport could not post "New sight screens at the Oval". Nothing was changed.'; END IF;

  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.device_id', '', true);
END $roles$;

RESET ROLE;

-- ── The check, as the owner: everything above is there, or nothing is ──
DO $check$
DECLARE cl int; soon int; ec int; inj int; rev int; ts int; att int; sk int; dn int; ld int; sg int; sgn int;
        gl int; rr int; dec int; veh int; spn int; spl int; ent int; cs int; nw int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE expires_on <= sa_today() + 30) INTO cl, soon FROM adult_clearance WHERE note = 'Recorded for the demo (demo-roles)';
  SELECT count(DISTINCT (player_id, priority)) INTO ec FROM emergency_contact WHERE active AND priority <= 2 AND player_id IN ('de300000-0000-4000-8000-000000000001'::uuid, 'de300000-0000-4000-8000-000000000061'::uuid, 'de300000-0000-4000-8000-000000000106'::uuid, 'de300000-0000-4000-8000-000000000002'::uuid, 'de300000-0000-4000-8000-000000000003'::uuid, 'de300000-0000-4000-8000-000000000107'::uuid, 'de300000-0000-4000-8000-000000000108'::uuid);
  SELECT count(*) INTO inj FROM injury WHERE player_id IN ('de300000-0000-4000-8000-000000000012'::uuid, 'de300000-0000-4000-8000-000000000118'::uuid, 'de300000-0000-4000-8000-000000000073'::uuid, 'de300000-0000-4000-8000-000000000178'::uuid);
  SELECT count(*) INTO rev FROM injury_review rv JOIN injury i ON i.id = rv.injury_id WHERE i.player_id IN ('de300000-0000-4000-8000-000000000012'::uuid, 'de300000-0000-4000-8000-000000000118'::uuid, 'de300000-0000-4000-8000-000000000073'::uuid, 'de300000-0000-4000-8000-000000000178'::uuid);
  SELECT count(*) INTO ts FROM training_session WHERE school_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333') AND starts_at > now() - interval '6 days';
  SELECT count(*) INTO att FROM training_attendance a JOIN training_session t ON t.id = a.session_id WHERE t.school_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
  SELECT count(*) INTO sk FROM player_skill WHERE player_id IN ('de300000-0000-4000-8000-000000000001'::uuid, 'de300000-0000-4000-8000-000000000002'::uuid, 'de300000-0000-4000-8000-000000000006'::uuid, 'de300000-0000-4000-8000-000000000008'::uuid, 'de300000-0000-4000-8000-000000000106'::uuid, 'de300000-0000-4000-8000-000000000107'::uuid, 'de300000-0000-4000-8000-000000000061'::uuid, 'de300000-0000-4000-8000-000000000166'::uuid) AND withdrawn_at IS NULL;
  SELECT count(*) INTO dn FROM development_note WHERE player_id IN ('de300000-0000-4000-8000-000000000001'::uuid, 'de300000-0000-4000-8000-000000000002'::uuid, 'de300000-0000-4000-8000-000000000008'::uuid, 'de300000-0000-4000-8000-000000000106'::uuid, 'de300000-0000-4000-8000-000000000166'::uuid);
  SELECT count(*) INTO ld FROM load_entry WHERE player_id IN ('de300000-0000-4000-8000-000000000008'::uuid, 'de300000-0000-4000-8000-000000000013'::uuid, 'de300000-0000-4000-8000-000000000015'::uuid);
  SELECT count(*) INTO sg FROM safeguarding_concern WHERE school_id = '22222222-2222-2222-2222-222222222222' AND account = 'After Tuesday''s practice one of the U14A boys seemed upset and was very quiet. I spoke with him briefly; he said he was tired and fine. Raising it so the DSO is aware. The team manager let his parents know.';
  SELECT count(*) INTO sgn FROM safeguarding_concern_note nt JOIN safeguarding_concern c ON c.id = nt.concern_id WHERE c.account = 'After Tuesday''s practice one of the U14A boys seemed upset and was very quiet. I spoke with him briefly; he said he was tired and fine. Raising it so the DSO is aware. The team manager let his parents know.';
  SELECT count(*) INTO gl FROM assignment_subject s JOIN role_assignment a ON a.id = s.assignment_id
   WHERE s.player_id = 'de300000-0000-4000-8000-000000000140'::uuid AND s.verification_state = 'pending'
     AND a.person_id = (SELECT id FROM app_user WHERE email = 'parent.030@example.invalid');
  SELECT count(*) INTO rr FROM role_request WHERE state = 'pending' AND role = 'scorer' AND school_id = '22222222-2222-2222-2222-222222222222'
     AND person_id = (SELECT id FROM app_user WHERE email = 'parent.020@example.invalid');
  SELECT count(*) INTO dec FROM lift_driver_declaration WHERE withdrawn_at IS NULL AND person_id = (SELECT id FROM app_user WHERE email = 'parent.002@example.invalid');
  SELECT count(*) INTO veh FROM vehicle WHERE registration IN ('WES DEMO 2', 'KEA DEMO 1');
  SELECT count(*) INTO spn FROM sponsor WHERE name LIKE '% (demo)';
  SELECT count(*) INTO spl FROM sponsorship sh JOIN sponsor s ON s.id = sh.sponsor_id WHERE s.name LIKE '% (demo)';
  SELECT count(*) INTO ent FROM competition_entrant WHERE competition_id = '99999999-0000-0000-0000-000000000001' AND school_id = '33333333-3333-3333-3333-333333333333' AND team_code = '1XI' AND status = 'accepted';
  SELECT count(*) INTO cs FROM condition_set WHERE competition_id = '99999999-0000-0000-0000-000000000001';
  SELECT count(*) INTO nw FROM news_post WHERE scope = 'school' AND title IN ('Nets timetable for the rest of term', 'Thank you to our parent scorers', 'New sight screens at the Oval') AND published_at IS NOT NULL;
  IF cl < 100 OR soon < 1 OR ec <> 14 OR inj <> 4 OR rev < 2 OR ts < 24
     OR att < 100 OR sk < 20 OR dn <> 5 OR ld <> 3 OR sg <> 1 OR sgn < 2 OR gl <> 1 OR rr <> 1
     OR dec <> 1 OR veh <> 2 OR spn <> 4 OR spl <> 4 OR ent <> 1 OR cs < 1 OR nw <> 3 THEN
    RAISE EXCEPTION 'The demo roles are incomplete (clearances %/% soon, contacts %, injuries % reviews %, sessions %, register %, skills %, notes %, loads %, concern % notes %, pending link %, request %, declaration %, vehicles %, sponsors %/%, KEA entrant %, condition sets %, news %). Rolled back.',
      cl, soon, ec, inj, rev, ts, att, sk, dn, ld, sg, sgn, gl, rr, dec, veh, spn, spl, ent, cs, nw;
  END IF;
END $check$;
COMMIT;

-- ── Read-only summary ──
SELECT 'clearances' AS what, count(*)::text AS n, count(*) FILTER (WHERE expires_on <= sa_today() + 30)::text || ' expiring within 30 days' AS note
  FROM adult_clearance WHERE note = 'Recorded for the demo (demo-roles)'
UNION ALL SELECT 'injuries (WES/KEA)', count(*)::text, string_agg(DISTINCT i.phase, ', ') FROM injury i JOIN player p ON p.id = i.player_id WHERE p.school_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333')
UNION ALL SELECT 'training sessions (WES/KEA)', count(*)::text, 'from ' || min((starts_at AT TIME ZONE 'Africa/Johannesburg')::date) || ' to ' || max((starts_at AT TIME ZONE 'Africa/Johannesburg')::date) FROM training_session WHERE school_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333')
UNION ALL SELECT 'availability answers (WES/KEA)', count(*)::text, '' FROM match_availability WHERE school_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333')
UNION ALL SELECT 'safeguarding concerns (WES)', count(*)::text, string_agg(reference, ', ') FROM safeguarding_concern WHERE school_id = '22222222-2222-2222-2222-222222222222'
UNION ALL SELECT 'pending role requests', count(*)::text, '' FROM role_request WHERE state = 'pending'
UNION ALL SELECT 'pending guardian links', count(*)::text, '' FROM assignment_subject WHERE verification_state = 'pending'
UNION ALL SELECT 'sponsors', count(*)::text, string_agg(name, ', ') FROM sponsor
UNION ALL SELECT 'league entrants', count(*)::text, string_agg(display_name, ', ') FROM competition_entrant WHERE competition_id = '99999999-0000-0000-0000-000000000001'
UNION ALL SELECT 'school news posts', count(*)::text, string_agg(title, ' · ') FROM news_post WHERE scope = 'school' AND school_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');

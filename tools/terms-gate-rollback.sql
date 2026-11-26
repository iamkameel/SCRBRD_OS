-- ══════════════════════════════════════════════════════════════════
--  The rollback for db/175 (the parent's terms gate). NOT A MIGRATION.
-- ══════════════════════════════════════════════════════════════════
--
-- Pasted only on Kameel's word, if the gate must come off again: it lifts
-- the gate and nothing else. Every body db/175 re-emitted goes back to the
-- body it replaced, byte for byte (held to the md5 db/175 found there), in
-- one statement, so either all nine move or none does; the two notice
-- policies go. What it leaves, on purpose:
--   * guardian_terms_record and its trigger: the record of who agreed which
--     terms, and when, is kept; nothing writes or removes a row of it here.
--   * my_terms_due(), terms_gate_mine(), terms_gate_schools(): the API's
--     my_children read asks my_terms_due(), so the API keeps running on the
--     database it was deployed against. A waiting link still draws its card
--     on the family screen (slice 5 draws it from consent_state); the server
--     no longer withholds his record behind it.
--   * the ledger's row for db/175 (schema_migration): db/175 is still
--     applied; a later paste of db/175 puts the gate back on, by its own guard.
--   * After db/176: db/176 re-emits the nine with the test "agreed, or agreed
--     and since withdrawn" in place of db/175's "not pending". This undoes
--     db/176's change first, then db/175's, so the nine end as the bodies db/175
--     replaced. db/176's other work stays (the sign-in gate's claim, the grant
--     door, my_terms_due()'s test, the record's trigger); its notice policy,
--     notification_terms_gate, goes with db/175's. To put the gate back after
--     this: paste db/175, then db/176.
--   * THE APP'S HALF. The API from db/175 on draws a waiting child's card from
--     my_terms_due() and leaves him out of my_children and of the session's
--     live_subjects on its own test (services/api/read/read-api.mjs,
--     services/api/auth/auth-db.mjs). This file cannot change that: after it,
--     the server reads a waiting parent his child, and her screens still show
--     the card alone until the API from before db/175 is deployed (an older API
--     runs on a database ahead of it, services/api/schema-guard.mjs).
--
-- As the owner, one transaction, outside a match:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f tools/terms-gate-rollback.sql
-- Safe twice: a body already back is left alone.

SET lock_timeout = '10s';

DO $guard$
BEGIN
  IF to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR NOT pg_has_role(current_user, (SELECT p.proowner FROM pg_proc p
                                        WHERE p.oid = 'app_can(text,uuid,text,uuid,uuid)'::regprocedure), 'MEMBER') THEN
    RAISE EXCEPTION 'terms-gate rollback: run this as the schema owner (current_user is %)', current_user;
  END IF;
  IF to_regprocedure('my_terms_due()') IS NULL THEN
    RAISE EXCEPTION 'terms-gate rollback: db/175 is not applied here; nothing to roll back';
  END IF;
END $guard$;

DROP TABLE IF EXISTS _db175_bodies;
CREATE TEMP TABLE _db175_bodies (fn text PRIMARY KEY, was_md5 text, mine_md5 text, m176_md5 text);
INSERT INTO _db175_bodies VALUES
  ('app_can(text,uuid,text,uuid,uuid)',                                'e8e8848ae0d30642c702502d9a3ed628', 'ac524f57020140fe6b6bdb0455274d11', '48f34fbad02c7b07376f9e7a9f28be78'),
  ('app_can_but_player(text,uuid,text,uuid,uuid)',                     '228c672a6dd87642a95b535901186673', '1a3ce7649c2dfafb1dd8e75e430a434c', 'e9a7cb629312d19ddde8fa826a6cd938'),
  ('app_can_but_scorer(text,uuid,text,uuid,uuid)',                     '9bc812346bbcf27eb1a0668925578362', 'a52734ba914cef6a87103ac6c6143818', '6501a3ba56482b093593ef481e3242f3'),
  ('is_family_of(uuid)',                                               '04afe1ecb8a74b78ec6c8ff97f274dd3', 'c2377a5414b315241fa63c32ef089d78', '394aac6b72d79730bb461ba9b63a626f'),
  ('my_alert_choices()',                                               '3358cc160844ca97bfd5913b34ad1afe', 'd107d022abf8ea4bbb524965867e8737', '94e339b669e6aa824a1f815b1f5c8ea3'),
  ('my_health_consents()',                                             'a8f1cdfca325430b57b66115b3dfba95', '5adccddcbb9f1686fc7d8f4d35b25b75', 'e2a8bbe973ca0a9352503dbdb3c3a12e'),
  ('pupil_signin_my_link(uuid)',                                       '52abc7b2450767ed5ba4b9dadc5ac2d0', 'ce64420509c38d04eac70d0456bb703d', '1d44c8d71ab16fa692ea64730d5b78c8'),
  ('public_name_consent_set(uuid,boolean,text,uuid,text,date,text)',   '156083d5a79bed7e1a5b684dfb07c29b', '6f423bb0f5614429e7c49d40d2a01f45', 'fc1f6221f76e76cf1ed5403104884801'),
  ('health_monitoring_consent_set(uuid,boolean,text,uuid,text,date)',  'e3cdcaa6416c98fbcc3e8a75b0fd6e26', 'baae671939c1848fc0bdf51b625ee1cf', '358493be83d56b0feb26e20ea8726808');
DO $bodies$
DECLARE r record; v text; n_mine int := 0; n_was int := 0; n_176 int := 0;
BEGIN
  FOR r IN SELECT * FROM _db175_bodies LOOP
    v := (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn));
    IF v IS NULL OR v NOT IN (r.was_md5, r.mine_md5, r.m176_md5) THEN
      RAISE EXCEPTION 'terms-gate rollback: % is neither db/175''s, db/176''s nor the body before db/175 (md5 %); look before replacing it', r.fn, v;
    END IF;
    IF v = r.mine_md5 THEN n_mine := n_mine + 1; ELSIF v = r.m176_md5 THEN n_176 := n_176 + 1; ELSE n_was := n_was + 1; END IF;
  END LOOP;
  IF (n_mine > 0)::int + (n_176 > 0)::int + (n_was > 0)::int > 1 THEN
    RAISE EXCEPTION 'terms-gate rollback: a partial gate is in place (% db/175''s, % db/176''s, % before db/175, of 9); see the paste card',
      n_mine, n_176, n_was;
  END IF;
END $bodies$;

-- After db/176: its test back to db/175's, body by body, and nothing else.
DO $undo176$
DECLARE
  GA constant text := 'g.consent_state = ''granted'' OR (g.consent_state = ''withdrawn'' AND g.consent_at IS NOT NULL)';
  SA constant text := 's.consent_state = ''granted'' OR (s.consent_state = ''withdrawn'' AND s.consent_at IS NOT NULL)';
  G0 constant text := '(a.role <> ''guardian'' OR g.consent_state <> ''pending'' OR g.relationship IN (''self'', ''enquiry''))';
  G1 constant text := '(a.role <> ''guardian'' OR ' || GA || ' OR g.relationship IN (''self'', ''enquiry''))';
  F0 constant text := '(a.role <> ''guardian'' OR s.consent_state <> ''pending'' OR s.relationship IN (''self'', ''enquiry''))';
  F1 constant text := '(a.role <> ''guardian'' OR ' || SA || ' OR s.relationship IN (''self'', ''enquiry''))';
  C0 constant text := '(s.consent_state <> ''pending'' OR s.relationship IN (''self'', ''enquiry''))';
  C1 constant text := '(' || SA || ' OR s.relationship IN (''self'', ''enquiry''))';
  L0 constant text := '     AND s.consent_state <> ''pending''' || chr(10);
  L1 constant text := '     AND (' || SA || ')' || chr(10);
  W0 constant text := 'WHERE (SELECT g.consent_state FROM assignment_subject g WHERE g.id = l.link_id) <> ''pending'';';
  W1 constant text := 'WHERE EXISTS (SELECT 1 FROM assignment_subject g WHERE g.id = l.link_id AND (' || GA || '));';
  r record;
  v_src text; v_cfg text; v_acl text; v_sec boolean; v_vol "char"; v_own oid; n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      (1, 'app_can(text,uuid,text,uuid,uuid)',                              2, G0, G1),
      (2, 'app_can_but_player(text,uuid,text,uuid,uuid)',                   2, G0, G1),
      (3, 'app_can_but_scorer(text,uuid,text,uuid,uuid)',                   2, G0, G1),
      (4, 'is_family_of(uuid)',                                             1, F0, F1),
      (5, 'my_alert_choices()',                                             1, C0, C1),
      (6, 'my_health_consents()',                                           1, G0, G1),
      (7, 'pupil_signin_my_link(uuid)',                                     1, L0, L1),
      (8, 'public_name_consent_set(uuid,boolean,text,uuid,text,date,text)', 1, W0, W1),
      (9, 'health_monitoring_consent_set(uuid,boolean,text,uuid,text,date)',1, W0, W1)
    ) AS t(ord, fn, times, was, now_) ORDER BY t.ord DESC LOOP
    SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef, p.provolatile, p.proowner
      INTO v_src, v_cfg, v_acl, v_sec, v_vol, v_own FROM pg_proc p WHERE p.oid = r.fn::regprocedure;
    IF md5(v_src) IS DISTINCT FROM (SELECT b.m176_md5 FROM _db175_bodies b WHERE b.fn = r.fn) THEN CONTINUE; END IF;
    n := (length(v_src) - length(replace(v_src, r.now_, ''))) / length(r.now_);
    IF n <> r.times THEN
      RAISE EXCEPTION 'terms-gate rollback: % holds db/176''s text % times, not %', r.fn, n, r.times;
    END IF;
    EXECUTE replace(pg_get_functiondef(r.fn::regprocedure), r.now_, r.was);
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure)
         IS DISTINCT FROM (SELECT b.mine_md5 FROM _db175_bodies b WHERE b.fn = r.fn)
       OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_cfg
       OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_acl
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_sec
       OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_vol
       OR (SELECT p.proowner FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_own THEN
      RAISE EXCEPTION 'terms-gate rollback: putting % back to db/175''s changed more than db/176''s change', r.fn;
    END IF;
  END LOOP;
END $undo176$;

-- The gate's bodies, each back to the one db/175 replaced: db/175's own
-- change taken out, in the reverse order, and nothing else.
DO $undo$
DECLARE
  -- app_can()'s guardian arm: "names a live person" (which also opens the
  -- rows with no person in them, a fixture) and "reaches this person".
  A1 constant text := '                      WHERE g.assignment_id = a.id' || chr(10)
                   || '                        AND g.verification_state = ''verified''' || chr(10);
  A2 constant text := '                         WHERE g.assignment_id = a.id AND g.player_id = p_person' || chr(10)
                   || '                           AND g.verification_state = ''verified''' || chr(10);
  P1 constant text := '                        -- db/175: a guardian''s link counts once she has agreed the terms.' || chr(10)
                   || '                        AND (a.role <> ''guardian'' OR g.consent_state <> ''pending'' OR g.relationship IN (''self'', ''enquiry''))' || chr(10);
  P2 constant text := '                           AND (a.role <> ''guardian'' OR g.consent_state <> ''pending'' OR g.relationship IN (''self'', ''enquiry''))' || chr(10);
  F  constant text := '     AND s.player_id = p_player AND s.verification_state = ''verified''' || chr(10);
  W  constant text := '      FROM public_name_live_link(app_user_id(), p_player, ''guardian'') l;';
  WG constant text := '      FROM public_name_live_link(app_user_id(), p_player, ''guardian'') l' || chr(10)
                   || '     -- db/175: her own act for him rides a link she has agreed the terms on.' || chr(10)
                   || '     WHERE (SELECT g.consent_state FROM assignment_subject g WHERE g.id = l.link_id) <> ''pending'';';
  r record;
  v_src text; v_def text; v_cfg text; v_acl text; v_sec boolean; v_vol "char"; v_own oid; n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      (1,  'app_can(text,uuid,text,uuid,uuid)',            1, A1, A1 || P1),
      (2,  'app_can(text,uuid,text,uuid,uuid)',            1, A2, A2 || P2),
      (3,  'app_can_but_player(text,uuid,text,uuid,uuid)', 1, A1, A1 || P1),
      (4,  'app_can_but_player(text,uuid,text,uuid,uuid)', 1, A2, A2 || P2),
      (5,  'app_can_but_scorer(text,uuid,text,uuid,uuid)', 1, A1, A1 || P1),
      (6,  'app_can_but_scorer(text,uuid,text,uuid,uuid)', 1, A2, A2 || P2),
      (7,  'is_family_of(uuid)', 1, F,
           F || '     -- db/175: a guardian''s link counts once she has agreed the terms.' || chr(10)
             || '     AND (a.role <> ''guardian'' OR s.consent_state <> ''pending'' OR s.relationship IN (''self'', ''enquiry''))' || chr(10)),
      (8,  'my_alert_choices()', 1,
           '     WHERE a.role = ''guardian'' AND s.verification_state = ''verified''' || chr(10),
           '     WHERE a.role = ''guardian'' AND s.verification_state = ''verified''' || chr(10)
             || '       -- db/175: a child of hers once she has agreed the terms.' || chr(10)
             || '       AND (s.consent_state <> ''pending'' OR s.relationship IN (''self'', ''enquiry''))' || chr(10)),
      (9,  'my_health_consents()', 1,
           '       AND g.verification_state = ''verified''' || chr(10),
           '       AND g.verification_state = ''verified''' || chr(10)
             || '       -- db/175: a guardian''s link counts once she has agreed the terms.' || chr(10)
             || '       AND (a.role <> ''guardian'' OR g.consent_state <> ''pending'' OR g.relationship IN (''self'', ''enquiry''))' || chr(10)),
      (10, 'pupil_signin_my_link(uuid)', 1,
           '     AND s.verification_state = ''verified''' || chr(10),
           '     AND s.verification_state = ''verified''' || chr(10)
             || '     -- db/175: her link counts once she has agreed the terms.' || chr(10)
             || '     AND s.consent_state <> ''pending''' || chr(10)),
      (11, 'public_name_consent_set(uuid,boolean,text,uuid,text,date,text)', 1, W, WG),
      (12, 'health_monitoring_consent_set(uuid,boolean,text,uuid,text,date)', 1, W, WG)
    ) AS t(ord, fn, times, was, now_) ORDER BY t.ord DESC LOOP
    SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef, p.provolatile, p.proowner
      INTO v_src, v_cfg, v_acl, v_sec, v_vol, v_own FROM pg_proc p WHERE p.oid = r.fn::regprocedure;
    -- A second run: this body is back already.
    IF md5(v_src) = (SELECT b.was_md5 FROM _db175_bodies b WHERE b.fn = r.fn) THEN CONTINUE; END IF;
    n := (length(v_src) - length(replace(v_src, r.now_, ''))) / length(r.now_);
    IF n <> r.times THEN
      RAISE EXCEPTION 'terms-gate rollback: % holds db/175''s text % times, not %', r.fn, n, r.times;
    END IF;
    v_def := pg_get_functiondef(r.fn::regprocedure);
    EXECUTE replace(v_def, r.now_, r.was);
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM replace(v_src, r.now_, r.was)
       OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_cfg
       OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_acl
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_sec
       OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_vol
       OR (SELECT p.proowner FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_own THEN
      RAISE EXCEPTION 'terms-gate rollback: putting % back changed more than db/175''s change', r.fn;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM _db175_bodies LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM r.was_md5 THEN
      RAISE EXCEPTION 'terms-gate rollback: % is not the body db/175 replaced (md5 %)', r.fn,
        (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure);
    END IF;
  END LOOP;
END $undo$;

DROP POLICY IF EXISTS notification_terms_gate ON notification;
DROP POLICY IF EXISTS notification_terms_gate_dso ON notification;

DROP TABLE IF EXISTS _db175_bodies;
RESET lock_timeout;

-- ══════════════════════════════════════════════════════════════════
--  86 · A platform role belongs to no school
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, after the RBAC diagnosis of 2026-10-07. Kameel's decision,
-- the same day: "a super admin role isn't attached to any school and
-- shouldn't be."
--
-- THE GAP. `superadmin` (the owner's key) and `platformadmin` are the two
-- roles that carry a platform-only capability. Their legitimate appointments
-- are tenant-less, school_id NULL: 98_seed_pilot.sql writes them that way,
-- and so does tools/bootstrap.mjs, the only door a real database has for
-- them. But nothing in the schema said a platform role COULD NOT name a
-- school. db/77's app_may_grant_at() lets a tenant-less granter grant at any
-- school, and role_grantable has platformadmin → platformadmin and
-- superadmin → superadmin, platformadmin. So:
--
--   POST /api/users { role: "platformadmin", schoolId: <Westville> }
--     as the platform account                       → 200
--   POST /api/users { role: "superadmin", schoolId: <Westville> }
--     as the owner                                  → 200
--
-- A school-scoped superadmin holds every school capability AT THAT SCHOOL,
-- medical and PII included, under a role the school's own office cannot see
-- the end of (db/77: superadmin_only, owners_key). And it is a contradiction
-- in the model: a platform role scoped to one school is neither.
-- The screens stopped offering these roles (grantableFor drops
-- PLATFORM_ROLES, PR #80); this is the server's half.
--
-- WHAT IS HERE
--
--   0. What this file relies on is there.
--   1. platform_role_needs_no_school — a CHECK constraint on
--      role_assignment: role IN ('superadmin', 'platformadmin') only with
--      school_id NULL. A constraint rather than a trigger, or a check in
--      each function, because it is the one rule every door passes: every
--      function that writes an appointment (decide_role_request(),
--      enrol_person() through it, support_access_begin(), duty_link(),
--      guardian_link_establish(), access_request_decide()),
--      the role_assignment_write policy the application inserts through,
--      the owner in the SQL Editor, a script with the triggers off
--      (tools/smoke-browser-management.mjs disables one), and every INSERT
--      and UPDATE nobody has written yet. A trigger can be disabled and is
--      skipped under session_replication_role = replica; a CHECK cannot be.
--      Its NAME IS THE REFUSAL CODE, so a 23514 from it says what it is
--      (services/api/write/requests-api.mjs answers it in those words).
--
--      ADDED NOT VALID, then VALIDATED, after asking first: if any
--      school-scoped platform appointment is already on the record, live or
--      ended, this file stops and names each one, and changes nothing. It
--      does not make history illegal by rewriting it. DEPLOYING.md (db/86)
--      says how to clear them. The table is locked for the length of that
--      one block, so nothing is written between the question and the
--      constraint; lock_timeout keeps the paste from queueing behind a long
--      query and stalling every request behind IT.
--
--   2. enrol_person() (db/08, as db/77 left it) and decide_role_request()
--      (db/62, as db/81 left it) answer the refusal by name,
--      { ok: false, reason: 'platform_role_needs_no_school' }, their usual
--      way, rather than letting the constraint raise:
--        enrol_person() refuses BEFORE ANYTHING IS WRITTEN, beside its other
--          refusals about the request's shape (school_required above it).
--          Every enrolment names a school, so a platform role there is
--          always this refusal, whoever asks.
--        decide_role_request() refuses after the decider's authority and
--          after a decline: a pending request for a platform role (a
--          request always names a school, role_request.school_id NOT NULL)
--          may still be DECLINED, and is never granted.
--      Each body is re-emitted from the version in place with one block
--      added, md5-guarded as db/77 and db/81 guard theirs: it refuses to run
--      over a body it was not written against, its anchor must appear
--      exactly once, the result must be the old body with exactly that
--      insertion, and signature, rights and settings must not move. A body
--      already carrying the block is left alone, so the file runs twice.
--   3. What this file promised, checked in the same paste: the constraint
--      validated with the definition meant, the two bodies carrying their
--      refusal, the roles that carry a platform-only capability exactly the
--      two the constraint names, and a probe insert refused by name.
--
-- NOT CHANGED: app_may_grant_at() (db/77). It still answers "may this
-- person grant this role here" and still says yes for a tenant-less granter
-- at a school; the constraint answers "may this appointment exist at all".
-- The tenant-less doors are untouched: the seed, tools/bootstrap.mjs
-- (--owner and the platform administrator), owner_recovery_issue() (db/18,
-- which only re-issues a code to a platform-wide superadmin), and the
-- role_assignment_write policy with school_id NULL. db/01 and db/09 do not
-- move.
--
-- NOT HERE: role_request. A pending request for a platform role at a school
-- can still be filed (POST /api/onboard, POST /api/requests); it can now
-- only be declined.
--
-- db/99 §65 is the proof. search_path pinned on every function (db/16); no
-- new function is created. Safe to run twice.


-- ── 0 · What this file relies on is there ──────────────────────────
DO $pre$
BEGIN
  IF to_regclass('role_assignment') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'role_assignment'::regclass
                       AND attname = 'school_id' AND NOT attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'db/86: role_assignment.school_id is missing, or no longer nullable';
  END IF;
  IF to_regprocedure('app_may_grant_at(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/86: app_may_grant_at() (db/77) is missing; apply db/77 first';
  END IF;
  IF to_regprocedure('enrol_person(text,text,text,uuid,text,uuid,text)') IS NULL
     OR to_regprocedure('decide_role_request(uuid,boolean,text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'db/86: enrol_person() or decide_role_request() is missing';
  END IF;
END $pre$;


-- ── 1 · The rule, where every door passes it ───────────────────────
DO $rule$
DECLARE
  n      int;
  v_list text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'role_assignment'::regclass
                AND conname = 'platform_role_needs_no_school' AND convalidated) THEN
    RETURN;   -- a second run
  END IF;

  -- Nothing is written between the question below and the constraint.
  PERFORM set_config('lock_timeout', '10s', true);
  LOCK TABLE role_assignment IN ACCESS EXCLUSIVE MODE;

  -- Ended appointments count: a CHECK holds for every row, and an ended
  -- school-scoped owner's key is still a record that says one existed.
  SELECT count(*),
         string_agg(format('%s (%s, %s at %s, %s since %s)',
                           a.id, coalesce(u.email, 'no account'), a.role,
                           coalesce(s.code, a.school_id::text),
                           CASE WHEN a.active THEN 'live' ELSE 'ended' END,
                           a.created_at::date),
                    '; ' ORDER BY a.created_at, a.id)
    INTO n, v_list
    FROM role_assignment a
    LEFT JOIN app_user u ON u.id = a.person_id
    LEFT JOIN school s ON s.id = a.school_id
   WHERE a.role IN ('superadmin', 'platformadmin') AND a.school_id IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'db/86: % platform appointment(s) on the record name a school, and a platform role belongs to no school: %. Nothing was changed. Clear them as DEPLOYING.md says under db/86, then paste this again.',
      n, v_list;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'role_assignment'::regclass
                    AND conname = 'platform_role_needs_no_school') THEN
    ALTER TABLE role_assignment ADD CONSTRAINT platform_role_needs_no_school
      CHECK (role NOT IN ('superadmin', 'platformadmin') OR school_id IS NULL) NOT VALID;
  END IF;
  ALTER TABLE role_assignment VALIDATE CONSTRAINT platform_role_needs_no_school;
END $rule$;


-- ── 2 · The two functions answer it by name ────────────────────────
-- Each re-emitted from the body in place with one block inserted before its
-- anchor. Guarded: the body must be the version named (its md5), the anchor
-- must appear exactly once, and afterwards the body must be the old one with
-- exactly that insertion and the same signature, rights and settings.
DO $reemit$
DECLARE
  r      record;
  v_src  text;
  v_def  text;
  v_cfg  text;
  v_acl  text;
  v_sec  boolean;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('enrol_person(text,text,text,uuid,text,uuid,text)', 'c5ce0a9009ebe9d2d3b472a73666724e', 'db/77''s',
       '  -- DECIDE_ROLE_REQUEST IS THE AUTHORITY OF RECORD, not this.',
          '  -- db/86: a platform role belongs to no school, and every enrolment is at' || chr(10)
       || '  -- one (school_required above). Refused before anything is written.' || chr(10)
       || '  IF p_role IN (''superadmin'', ''platformadmin'') THEN' || chr(10)
       || '    RETURN QUERY SELECT false, ''platform_role_needs_no_school'', NULL::uuid, NULL::uuid; RETURN;' || chr(10)
       || '  END IF;' || chr(10) || chr(10)),
      ('decide_role_request(uuid,boolean,text,uuid,text)', '09dbab0e1096723752fa035c141855ba', 'db/81''s',
       '  v_player := coalesce(p_player, r.player_id);',
          '  -- db/86: a platform role belongs to no school, and a request always names' || chr(10)
       || '  -- one. Declining it (above) still works; granting it never does.' || chr(10)
       || '  IF r.role IN (''superadmin'', ''platformadmin'') AND r.school_id IS NOT NULL THEN' || chr(10)
       || '    RETURN QUERY SELECT false, ''platform_role_needs_no_school'', NULL::uuid; RETURN;' || chr(10)
       || '  END IF;' || chr(10))) AS x(fn, h, src, anchor, block)
  LOOP
    SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef
      INTO v_src, v_cfg, v_acl, v_sec
      FROM pg_proc p WHERE p.oid = r.fn::regprocedure;
    IF position(r.block IN v_src) > 0 THEN
      CONTINUE;   -- already refuses: a second run
    END IF;
    IF md5(v_src) IS DISTINCT FROM r.h THEN
      RAISE EXCEPTION 'db/86: % is not % any more; add the platform-role refusal to the version now in place and move its hash',
        r.fn, r.src;
    END IF;
    IF (length(v_src) - length(replace(v_src, r.anchor, ''))) / length(r.anchor) <> 1 THEN
      RAISE EXCEPTION 'db/86: % does not carry its anchor exactly once', r.fn;
    END IF;
    v_def := pg_get_functiondef(r.fn::regprocedure);
    EXECUTE replace(v_def, r.anchor, r.block || r.anchor);
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM replace(v_src, r.anchor, r.block || r.anchor)
       OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_cfg
       OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_acl
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_sec THEN
      RAISE EXCEPTION 'db/86: re-emitting % changed more than its platform-role refusal', r.fn;
    END IF;
  END LOOP;
END $reemit$;


-- ── 3 · What this file promised, checked in the same paste ─────────
DO $check$
DECLARE
  v_person uuid;
  v_school uuid;
  v_probe  text := 'not run';
  v_con    text;
  f        text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'role_assignment'::regclass AND contype = 'c'
                    AND conname = 'platform_role_needs_no_school' AND convalidated
                    AND pg_get_constraintdef(oid) LIKE '%superadmin%platformadmin%school_id IS NULL%') THEN
    RAISE EXCEPTION 'db/86: platform_role_needs_no_school is not a validated CHECK on role_assignment, as written';
  END IF;

  -- The constraint names two roles. They must be exactly the roles that
  -- carry a platform-only capability, or a platform role could name a school.
  IF (SELECT array_agg(DISTINCT rc.role ORDER BY rc.role)
        FROM role_capability rc JOIN capability c ON c.name = rc.capability AND c.platform_only)
     IS DISTINCT FROM ARRAY['platformadmin', 'superadmin'] THEN
    RAISE EXCEPTION 'db/86: the roles carrying a platform-only capability are not exactly superadmin and platformadmin';
  END IF;

  FOREACH f IN ARRAY ARRAY['enrol_person(text,text,text,uuid,text,uuid,text)',
                           'decide_role_request(uuid,boolean,text,uuid,text)'] LOOP
    IF position('''platform_role_needs_no_school''' IN (SELECT prosrc FROM pg_proc WHERE oid = f::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'db/86: % does not answer platform_role_needs_no_school', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/86: % is no longer SECURITY DEFINER with its search_path pinned', f;
    END IF;
  END LOOP;

  -- A probe, rolled back: a platform role at a school is refused, by name.
  -- Needs one account and one school; a database with neither yet skips it.
  SELECT id INTO v_person FROM app_user ORDER BY created_at, id LIMIT 1;
  SELECT id INTO v_school FROM school ORDER BY id LIMIT 1;
  IF v_person IS NOT NULL AND v_school IS NOT NULL THEN
    BEGIN
      INSERT INTO role_assignment (person_id, role, school_id) VALUES (v_person, 'platformadmin', v_school);
      v_probe := 'inserted';
      RAISE EXCEPTION 'db/86 probe' USING ERRCODE = 'P0001';   -- undo it
    EXCEPTION
      WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        v_probe := 'refused';
      WHEN raise_exception THEN NULL;
    END;
    IF v_probe <> 'refused' OR v_con IS DISTINCT FROM 'platform_role_needs_no_school' THEN
      RAISE EXCEPTION 'db/86: a platform role at a school was not refused by name (%, %)', v_probe, v_con;
    END IF;
  END IF;
END $check$;

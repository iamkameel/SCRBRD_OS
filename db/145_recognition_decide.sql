-- ══════════════════════════════════════════════════════════════════
--  145 · Recognition: who decides, and the owner's key holds none of it
--        (RECOGNITION R5c)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/RECOGNITION_design.md, approved by Kameel on
-- 7 Oct 2026 as recommended (D1–D25, Q1–Q12, A1–A18), with READERS_child_data
-- Q2 (21 Oct 2026: the auditor does not read a withdrawal's reason). This is
-- §10's R5c row: A5 (recognition.decide for the director of sport and the
-- principal; the office records a decision by naming who made it), A6 and D7
-- (recognition.* out of the owner's key, and a RESTRICTIVE cut on honour for
-- every platform-wide assignment), D4 (withdrawn_reason masked at the table),
-- D5 (the decider named, and told when somebody else recorded his decision),
-- and two of the red-team's follow-ups on db/142 (F9, F10). Its proof is
-- db/99 §123; the walks are smoke-recognition and smoke-audit-log.
--
-- WHAT R6 ALREADY DID, AND THIS FILE DOES NOT REPEAT (db/142): honour.decided_by
-- and its backfill from awarded_by; withdrawn_kind (D21) and its backfill
-- 'other'; recognition.match.award carved from the owner's key; the
-- RESTRICTIVE line that kept the owner's key off a Player of the Match
-- (widened here, in place); and F4 — honour_stamp() already refuses a
-- guardian of the boy who withdraws his Player of the Match, whatever the
-- route (db/142's UPDATE branch, falsified in db/99 §120). Confirmed, kept.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
--   capability  + recognition.decide: the director of sport and the
--                 principal (A5), through ADDED_SINCE_01 (generate-rls.mjs).
--                 The office keeps recognition.manage: it records, keeps the
--                 caps baseline and the public-board switch.
--   superadmin  − recognition.manage, the last recognition.* db/01 granted
--                 the owner's key (WITHDRAWN_SINCE_01). roles.mjs now carves
--                 every recognition.* from the key, derived, as it carves
--                 safeguarding.*.
--   honour      ~ honour_no_platform_award (db/142) widened in place: every
--                 kind and every command (SELECT, INSERT, UPDATE; nothing
--                 deletes an honour), false for any person who holds a
--                 platform-wide assignment — db/57's cut, by the person.
--               ~ withdrawn_reason (D4, READERS Q2): the application's SELECT
--                 on the table is taken back and granted again column by
--                 column without it (db/102's shape), so no read of the table
--                 reaches it. honour_withdrawn_reason(id) says it to a holder
--                 of recognition.decide at the honour's school and to the
--                 person who withdrew it, and to nobody else; honour_masked
--                 (the view tables.mjs's mask asks for: MASKED_SINCE_09)
--                 calls it.
--               ~ nomination_id (db/144; the red-team's F3 on R7, Kameel's
--                 answer pending): masked the same way, read through
--                 honour_nomination_id() by whoever reads the nomination
--                 itself (D8), so the award does not tell the nominee, a
--                 team-mate or a parent that the captain picked.
--               ~ honour_stamp() (db/142)  D5: the decider of any honour but
--                 a Player of the Match may be named by the person recording
--                 it; one who names nobody is the decider. F10: the notice_id
--                 bypass holds only when the notice is really gone.
--   triggers    + honour_decided_by  AFTER INSERT, every kind but a Player of
--                 the Match: the decider holds recognition.decide through a
--                 live assignment at the boy's school (not a pad, not a
--                 support hour, never platform-wide), or the write is undone
--                 ("decider_required"). After the table's policy, so a coach
--                 is told "not permitted", not a word about deciders.
--               + honour_tell_decider  AFTER INSERT: when the recorder is not
--                 the decider, the decider is told, his alone (D5, Q11):
--                 "The office recorded Full colours 2026 for R Pillay as your
--                 decision, 3 Oct." A notice that cannot be written never
--                 stops the record: a WARNING.
--   recognition_audit  F9: its honour key RESTRICTs a delete instead of
--                 cascading the append-only rows away with the honour.
--   functions   + recognition_decider_holds, honour_decided_by, honour_tell_decider (nobody's)
--               + honour_withdrawn_reason, honour_nomination_id (the
--                 application's: the view's)
--
-- ── WHO DECIDES NOW ─────────────────────────────────────────────────
--   Player of the Match   recognition.match.award over the side (db/142's
--                         door), unchanged.
--   every other kind      recognition.decide at the school: the director of
--                         sport or the principal. The office (recognition.manage)
--                         records the decision and names him; it cannot name
--                         itself, a coach, nobody, or a person at another school.
--
-- EXISTING ROWS. None change: honours recorded before this file keep the
-- decided_by db/142 backfilled. The owner's key loses its reads and writes of
-- honour (D7); a person who holds a school role and a platform-wide one loses
-- them too, as db/57 and db/144 cut him. Safe to run twice. DROPs: the
-- recognition_audit honour key (made again, RESTRICT), the policy this file
-- widens (made again under its name), the pg_temp helper at the end.
--
-- SCHEMA FIRST. The API built with it (recognition-api.mjs: `decidedBy` on an
-- award) runs against this file; it is in services/api/expected-migrations.json.
--
-- THE GUARD keys on pg_proc.prosrc as db/142 does: the md5 of the live
-- honour_stamp() body, whitespace folded, must be db/142's or this file's.


-- ── 0 · What this file was written against ─────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._v145_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regclass('honour') IS NULL OR to_regclass('recognition_audit') IS NULL OR to_regclass('notification') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'honour' AND column_name = 'decided_by')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'honour' AND column_name = 'notice_id')
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'honour'::regclass AND polname = 'honour_no_platform_award')
     OR to_regprocedure('match_award_guardian_of(uuid,uuid)') IS NULL OR to_regprocedure('match_award_short(text)') IS NULL
     OR to_regprocedure('honour_kind_label(text,text)') IS NULL
     OR to_regprocedure('app_is_platform_wide()') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('app_support_access_id(uuid)') IS NULL OR to_regprocedure('sa_today()') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('recognition_nomination_mine(uuid)') IS NULL
     OR to_regprocedure('recognition_nomination_staff(uuid,text,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'honour' AND column_name = 'nomination_id') THEN
    RAISE EXCEPTION 'db/145: Player of the Match (db/142), the captain''s nomination (db/144), the notices (db/89), the platform reads (db/20), the support hour (db/22) or the SA day (db/128) is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('honour_stamp()', '4d23d2abe5b6a93970590b2cdf413933', '0cc86739759cc6d25706960264b44b17', 'db/142'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/145: % (%) is not there to re-create', r.fn, r.src;
    END IF;
    v_md5 := pg_temp._v145_fold(v_src);
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/145: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
--  1 · The capability (ADDED_SINCE_01), and the owner's key without
--      any recognition (WITHDRAWN_SINCE_01)
-- ══════════════════════════════════════════════════════════════════
INSERT INTO capability (name) VALUES ('recognition.decide') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('directorofsport', 'recognition.decide'),
  ('principal',       'recognition.decide')
ON CONFLICT DO NOTHING;

-- D7: every recognition.* out of the owner's key. db/01 granted it
-- recognition.manage; nothing else of recognition.* ever reached it.
DELETE FROM role_capability WHERE role = 'superadmin' AND capability LIKE 'recognition.%';


-- ══════════════════════════════════════════════════════════════════
--  2 · The cut (D7): no platform-wide assignment touches an honour
-- ══════════════════════════════════════════════════════════════════
-- db/142's line, widened in place: every kind, every command. By the person,
-- as db/57 cuts the safeguarding tables and db/144 the nominations: a person
-- who holds a platform-wide assignment reads and writes no honour, whatever
-- school role he holds beside it, and his support hour does not lift it.
DROP POLICY IF EXISTS honour_no_platform_award ON honour;
CREATE POLICY honour_no_platform_award ON honour AS RESTRICTIVE
  FOR ALL USING (NOT app_is_platform_wide())
          WITH CHECK (NOT app_is_platform_wide());


-- ══════════════════════════════════════════════════════════════════
--  3 · The reason is masked at the table (D4, READERS Q2)
-- ══════════════════════════════════════════════════════════════════
-- The application's SELECT on honour (db/06's default privilege) is taken
-- back and granted again column by column, every column but the reason. A
-- column the table gains later is not readable until somebody grants it,
-- which is the direction to fail in (db/102). The definers (recognition(),
-- the doors) own the table and read it whole.
DO $mask_columns$
DECLARE v_cols text; r text;
BEGIN
  SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position) INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'honour' AND c.column_name NOT IN ('withdrawn_reason', 'nomination_id');
  EXECUTE 'REVOKE SELECT ON honour FROM scrbrd_app';
  EXECUTE format('GRANT SELECT (%s) ON honour TO scrbrd_app', v_cols);
  -- A managed host's API roles get table privileges by default privilege. Row
  -- security already gives them nothing (no app.user_id), and they get no
  -- more of the reason than the application does.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
       AND (has_table_privilege(r, 'honour', 'SELECT') OR has_column_privilege(r, 'honour', 'withdrawn_reason', 'SELECT')
            OR has_column_privilege(r, 'honour', 'nomination_id', 'SELECT')) THEN
      EXECUTE format('REVOKE SELECT ON honour FROM %I', r);
      EXECUTE format('GRANT SELECT (%s) ON honour TO %I', v_cols, r);
    END IF;
  END LOOP;
END $mask_columns$;

-- The reason of one honour, to whoever may read it: a holder of
-- recognition.decide at the honour's school (any side: the deciders are the
-- school's), or the person who withdrew it (D4: the office reads it only if
-- it withdrew; the side's coach only if he did). Never through a pad, a
-- support hour or a platform-wide assignment. NULL otherwise, and NULL for an
-- id that is not an honour: the two are not told apart.
CREATE OR REPLACE FUNCTION honour_withdrawn_reason(p_honour uuid) RETURNS text AS $$
  SELECT h.withdrawn_reason
    FROM honour h
   WHERE h.id = p_honour AND h.withdrawn_at IS NOT NULL
     AND app_user_id() IS NOT NULL AND NOT app_pad_scoped()
     AND app_support_access_id(h.school_id) IS NULL AND NOT app_is_platform_wide()
     AND (h.withdrawn_by = app_user_id()
          OR app_can('recognition.decide', h.school_id, '*'::text,
                     '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Which captain's nomination an award answered (db/144's honour.nomination_id;
-- the red-team's F3 on R7): that a nomination existed, and so that the
-- captain picked, or did not pick, this boy. D8: a nomination is read by its
-- nominator and the side's staff and the school's deciders and office, never
-- by the nominee, a team-mate, a parent or the public, so its key on the
-- award is read by the same people (db/144's own two tests), and by nobody
-- through a pad, a support hour or a platform-wide assignment. NULL
-- otherwise, and NULL for an award no nomination answered: the two are not
-- told apart.
CREATE OR REPLACE FUNCTION honour_nomination_id(p_honour uuid) RETURNS uuid AS $$
  SELECT h.nomination_id
    FROM honour h JOIN recognition_nomination n ON n.id = h.nomination_id
   WHERE h.id = p_honour
     AND app_user_id() IS NOT NULL AND NOT app_pad_scoped()
     AND app_support_access_id(n.school_id) IS NULL AND NOT app_is_platform_wide()
     AND (recognition_nomination_mine(n.nominated_by_player_id) OR recognition_nomination_staff(n.school_id, n.team_code, n.match_id))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- honour_masked — every column listed explicitly, the reason through the
-- function above (the award's nomination through the one beside it) and
-- evaluated PER ROW. Built from information_schema as
-- db/09 builds every *_masked view, with the table's whole mask list from
-- tables.mjs (rls.test.mjs holds the tuple to it, verbatim). One difference
-- from db/09's shape, and it is the point: the masked column is not read
-- from the table here, because the caller holds no SELECT on it; its
-- function, honour_<column>(), reads it, and decides.
DO $mask_honour$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('honour_%1$s(honour.id) AS %1$I', c.column_name)   -- honour_withdrawn_reason(), honour_nomination_id()
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('withdrawn_reason', 'recognition.decide', '(SELECT p.team_code FROM player p WHERE p.id = honour.player_id)'), ('nomination_id', 'recognition.match.award', '(SELECT p.team_code FROM player p WHERE p.id = honour.player_id)')) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'honour';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build honour_masked: table honour not found (apply 08_schema_programme.sql first)';
  END IF;

  EXECUTE format(
    -- security_invoker, as db/09 says at length: without it the view reads
    -- honour as its owner and every row reaches everyone.
    'CREATE OR REPLACE VIEW honour_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM honour',
    cols);
END
$mask_honour$;
REVOKE ALL ON honour_masked FROM PUBLIC;
GRANT SELECT ON honour_masked TO scrbrd_app;


-- ══════════════════════════════════════════════════════════════════
--  4 · Every honour names its decider (D5)
-- ══════════════════════════════════════════════════════════════════
-- Does this person decide honours at this school today? recognition.decide
-- through a live assignment AT the school (never a platform-wide one), not
-- ended, not expired, not suspended. Asked of the person named, who need not
-- be the session (the office names him); when he is the session, never
-- through a pad's credential or a support hour.
CREATE OR REPLACE FUNCTION recognition_decider_holds(p_person uuid, p_school uuid) RETURNS boolean AS $$
  SELECT p_person IS NOT NULL AND p_school IS NOT NULL
     AND NOT coalesce(p_person = app_user_id() AND (app_pad_scoped() OR app_support_access_id(p_school) IS NOT NULL), false)
     AND NOT EXISTS (SELECT 1 FROM support_access s WHERE s.actor_id = p_person AND s.school_id = p_school
                        AND s.ended_at IS NULL AND s.expires_at > now())
     AND EXISTS (SELECT 1 FROM role_assignment a
                   JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'recognition.decide'
                  WHERE a.person_id = p_person AND a.active AND a.school_id = p_school
                    AND a.fixture_id IS NULL
                    AND (a.valid_from IS NULL OR a.valid_from <= sa_today())
                    AND (a.valid_until IS NULL OR a.valid_until > sa_today())
                    AND (a.expires_at IS NULL OR a.expires_at > now())
                    AND NOT EXISTS (SELECT 1 FROM duty_suspension d WHERE d.assignment_id = a.id AND d.lifted_at IS NULL))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/142's, with the lines marked db/145.
CREATE OR REPLACE FUNCTION honour_stamp() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.school_id, p.team_code INTO NEW.school_id, NEW.team_code FROM player p WHERE p.id = NEW.player_id;
    IF NEW.school_id IS NULL THEN
      RAISE EXCEPTION 'no such player: %', NEW.player_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    -- db/142: a match's award is the side's he won it for, as the sheet has
    -- him, never the side he is on today (D22).
    IF NEW.kind = 'player_of_match' THEN
      NEW.team_code := (SELECT CASE match_award_side_of(m.id, NEW.player_id)
                                 WHEN 'home' THEN CASE WHEN m.school_id = NEW.school_id THEN m.team_code END
                                 WHEN 'away' THEN CASE WHEN m.away_school_id = NEW.school_id THEN m.away_team_code END END
                          FROM match m WHERE m.id = NEW.match_id);
    END IF;
    NEW.awarded_by := app_user_id();
    NEW.awarded_at := now();
    IF NEW.kind = 'player_of_match' THEN
      NEW.decided_by := NEW.awarded_by;   -- db/142: D5, the decider is the session (the door's)
    ELSE
      -- db/145: D5. The recorder may name the decider; naming nobody, he is
      -- the decider. honour_decided_by() asks, after the table's policy has
      -- refused anybody who may not write the row at all.
      NEW.decided_by := coalesce(NEW.decided_by, NEW.awarded_by);
    END IF;
    NEW.withdrawn_at := NULL; NEW.withdrawn_by := NULL; NEW.withdrawn_reason := NULL;
    NEW.withdrawn_kind := NULL; NEW.notice_id := NULL;   -- db/142
    RETURN NEW;
  END IF;
  -- db/142: the side's notice was deleted and its key set this to NULL;
  -- nothing else moves, withdrawn or not. db/145 (F10): only when the notice
  -- is really gone, so no UPDATE detaches a standing notice from its award.
  IF OLD.notice_id IS NOT NULL AND NEW.notice_id IS NULL
     AND (to_jsonb(NEW) - 'notice_id') = (to_jsonb(OLD) - 'notice_id')
     AND NOT EXISTS (SELECT 1 FROM notification n WHERE n.id = OLD.notice_id) THEN
    RETURN NEW;
  END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'a withdrawn honour is not edited — award it again' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.player_id IS DISTINCT FROM OLD.player_id OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR NEW.team_code IS DISTINCT FROM OLD.team_code OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.name IS DISTINCT FROM OLD.name OR NEW.season_id IS DISTINCT FROM OLD.season_id
     OR NEW.citation IS DISTINCT FROM OLD.citation OR NEW.awarded_on IS DISTINCT FROM OLD.awarded_on
     OR NEW.awarded_by IS DISTINCT FROM OLD.awarded_by OR NEW.awarded_at IS DISTINCT FROM OLD.awarded_at
     OR NEW.match_id IS DISTINCT FROM OLD.match_id OR NEW.decided_by IS DISTINCT FROM OLD.decided_by   -- db/142
     OR NEW.derived_from IS DISTINCT FROM OLD.derived_from OR NEW.notice_id IS DISTINCT FROM OLD.notice_id THEN
    RAISE EXCEPTION 'an honour is not edited after it is awarded — withdraw it and award it again'
      USING ERRCODE = 'check_violation';
  END IF;
  -- is_public may change: putting a name on a board, or taking it off, is a
  -- decision about the board, not about the honour.
  IF NEW.withdrawn_at IS NOT NULL THEN
    -- db/142: D9/D10 at the table, whatever the route: a live guardian of
    -- the boy does not withdraw his Player of the Match (the door says it
    -- in words first).
    IF NEW.kind = 'player_of_match' AND match_award_guardian_of(app_user_id(), NEW.player_id) THEN
      RAISE EXCEPTION 'a guardian of the boy does not withdraw his Player of the Match; another of the school''s deciders does'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.withdrawn_at := now();
    NEW.withdrawn_by := app_user_id();
    NEW.withdrawn_kind := coalesce(NEW.withdrawn_kind, 'other');   -- db/142: D21
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- D5. The decider of any honour but a Player of the Match (whose door asks
-- its own) holds recognition.decide at the boy's school. AFTER the row is
-- written, so the table's policy has already refused anybody who may not
-- write it at all (they are told "not permitted", not a word about
-- deciders); a refusal here undoes the write. The rule is about the person
-- the row names, not about the caller: it is the record's invariant (no
-- capability lets a recorder past it). A write with no session (a migration,
-- the seed) is the owner's, and names whom it names.
CREATE OR REPLACE FUNCTION honour_decided_by() RETURNS trigger AS $$
BEGIN
  IF NOT recognition_decider_holds(NEW.decided_by, NEW.school_id) THEN
    RAISE EXCEPTION 'decider_required' USING ERRCODE = 'check_violation',
      DETAIL = 'An honour names who decided it: the director of sport or the principal at the boy''s school (RECOGNITION D5).';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE TRIGGER honour_decided_by AFTER INSERT ON honour
  FOR EACH ROW WHEN (NEW.kind <> 'player_of_match' AND NEW.awarded_by IS NOT NULL)
  EXECUTE FUNCTION honour_decided_by();

-- D5, Q11: when somebody records a decision he did not make, the person it
-- names is told, his alone, so a false attribution is seen by the person it
-- names. Staff words (§7): the boy by initial and surname, the recorder as
-- "The office" when he is not himself a decider, else by name. A push is a
-- pointer (push-api.mjs), so no lock screen carries the boy's name.
CREATE OR REPLACE FUNCTION honour_tell_decider() RETURNS trigger AS $$
DECLARE v_by text; v_boy text; v_what text;
BEGIN
  BEGIN
    v_by := CASE WHEN recognition_decider_holds(NEW.awarded_by, NEW.school_id)
                 THEN coalesce((SELECT u.name FROM app_user u WHERE u.id = NEW.awarded_by), 'The school')
                 ELSE 'The office' END;
    SELECT match_award_short(p.full_name) INTO v_boy FROM player p WHERE p.id = NEW.player_id;
    v_what := honour_kind_label(NEW.kind, NEW.name)
              || coalesce(' ' || (SELECT s.label FROM season s WHERE s.id = NEW.season_id), '');
    INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                              required_capability, is_public, subject_person_id, recipient_id)
    VALUES (NEW.school_id, NULL, 'school', 'recognition', 'low',
            'Recorded as your decision: ' || v_what,
            v_by || ' recorded ' || v_what || ' for ' || v_boy || ' as your decision, '
                 || to_char(NEW.awarded_on, 'FMDD Mon') || '. If you did not decide it, say so to the office.',
            'recognition.decide', false, NEW.player_id, NEW.decided_by);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'db/145: the decider of honour % was not told it was recorded as his decision (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE TRIGGER honour_tell_decider AFTER INSERT ON honour
  FOR EACH ROW WHEN (NEW.awarded_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM NEW.awarded_by)
  EXECUTE FUNCTION honour_tell_decider();


-- ══════════════════════════════════════════════════════════════════
--  5 · The audit outlives nothing it speaks of (F9)
-- ══════════════════════════════════════════════════════════════════
-- An honour is withdrawn, never deleted; the audit of it is never updated.
-- A delete of an honour with an audit is refused rather than taking the
-- audit with it. An erasure under POPIA goes through its own path, which
-- clears the audit deliberately.
DO $fk$
DECLARE v_name text;
BEGIN
  SELECT c.conname INTO v_name FROM pg_constraint c
   WHERE c.conrelid = 'recognition_audit'::regclass AND c.contype = 'f'
     AND c.confrelid = 'honour'::regclass;
  IF v_name IS NOT NULL AND (SELECT c.confdeltype FROM pg_constraint c WHERE c.conrelid = 'recognition_audit'::regclass AND c.conname = v_name) <> 'r' THEN
    EXECUTE format('ALTER TABLE recognition_audit DROP CONSTRAINT %I', v_name);
    v_name := NULL;
  END IF;
  IF v_name IS NULL THEN
    ALTER TABLE recognition_audit ADD CONSTRAINT recognition_audit_honour_id_fkey
      FOREIGN KEY (honour_id) REFERENCES honour(id) ON DELETE RESTRICT;
  END IF;
END $fk$;


-- ══════════════════════════════════════════════════════════════════
--  6 · Who may call what
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  -- The view's: the application's, as the view runs as the caller.
  REVOKE ALL ON FUNCTION honour_withdrawn_reason(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION honour_withdrawn_reason(uuid) TO scrbrd_app;
  REVOKE ALL ON FUNCTION honour_nomination_id(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION honour_nomination_id(uuid) TO scrbrd_app;
  -- The system's own: nobody's to call.
  FOREACH f IN ARRAY ARRAY['recognition_decider_holds(uuid,uuid)', 'honour_decided_by()', 'honour_tell_decider()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION honour_withdrawn_reason(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION honour_nomination_id(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION recognition_decider_holds(uuid,uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION honour_tell_decider() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION honour_decided_by() FROM %I', r);
      EXECUTE format('REVOKE ALL ON honour_masked FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
--  What this file promised, checked in the same paste
-- ══════════════════════════════════════════════════════════════════
-- The behaviour is asserted live in db/99 §123.
DO $check$
DECLARE f text; r text; v_src text;
BEGIN
  IF pg_temp._v145_fold((SELECT prosrc FROM pg_proc WHERE oid = 'honour_stamp()'::regprocedure)) <> '0cc86739759cc6d25706960264b44b17' THEN
    RAISE EXCEPTION 'db/145: honour_stamp() is not this file''s after the paste (md5 %)',
      pg_temp._v145_fold((SELECT prosrc FROM pg_proc WHERE oid = 'honour_stamp()'::regprocedure));
  END IF;
  -- A5: the deciders, and nobody else.
  IF (SELECT string_agg(role, ',' ORDER BY role) FROM role_capability WHERE capability = 'recognition.decide')
     IS DISTINCT FROM 'directorofsport,principal' THEN
    RAISE EXCEPTION 'db/145: recognition.decide is not held by the director of sport and the principal alone';
  END IF;
  -- D7: the owner's key holds no recognition.*, and no platform role does.
  IF EXISTS (SELECT 1 FROM role_capability WHERE role IN ('superadmin', 'platformadmin') AND capability LIKE 'recognition.%') THEN
    RAISE EXCEPTION 'db/145: a platform role holds a recognition capability';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'honour'::regclass AND polname = 'honour_no_platform_award'
                    AND NOT polpermissive AND polcmd = '*'
                    AND pg_get_expr(polqual, polrelid) = '(NOT app_is_platform_wide())'
                    AND pg_get_expr(polwithcheck, polrelid) = '(NOT app_is_platform_wide())') THEN
    RAISE EXCEPTION 'db/145: honour_no_platform_award is not a RESTRICTIVE cut on every command';
  END IF;
  -- D4: the reason is not the application's to select, from the table or
  -- from anywhere but the function; every other column is.
  IF has_column_privilege('scrbrd_app', 'honour', 'withdrawn_reason', 'SELECT')
     OR has_column_privilege('scrbrd_app', 'honour', 'nomination_id', 'SELECT')
     OR has_table_privilege('scrbrd_app', 'honour', 'SELECT')
     OR EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'honour'
                   AND c.column_name NOT IN ('withdrawn_reason', 'nomination_id')
                   AND NOT has_column_privilege('scrbrd_app', 'honour', c.column_name, 'SELECT')) THEN
    RAISE EXCEPTION 'db/145: the application selects the withdrawal''s reason or the award''s nomination, or lost another column of honour';
  END IF;
  IF position('honour_nomination_id(honour.id) AS nomination_id' IN pg_get_viewdef('honour_masked'::regclass)) = 0
     AND position('honour_nomination_id(id) AS nomination_id' IN pg_get_viewdef('honour_masked'::regclass)) = 0 THEN
    RAISE EXCEPTION 'db/145: honour_masked does not say the award''s nomination through honour_nomination_id()';
  END IF;
  IF position('honour_withdrawn_reason(honour.id) AS withdrawn_reason' IN pg_get_viewdef('honour_masked'::regclass)) = 0
     AND position('honour_withdrawn_reason(id) AS withdrawn_reason' IN pg_get_viewdef('honour_masked'::regclass)) = 0 THEN
    RAISE EXCEPTION 'db/145: honour_masked does not say the reason through honour_withdrawn_reason()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'honour_masked'::regclass
                    AND 'security_invoker=true' = ANY (coalesce(reloptions, '{}'))
                    AND 'security_barrier=true' = ANY (coalesce(reloptions, '{}')))
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'honour_masked')
        <> (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'honour') THEN
    RAISE EXCEPTION 'db/145: honour_masked lost security_invoker or security_barrier, or a column';
  END IF;
  -- Definers, pinned; no reading of the database's day (db/128).
  FOREACH f IN ARRAY ARRAY['honour_stamp()', 'honour_withdrawn_reason(uuid)', 'honour_nomination_id(uuid)', 'recognition_decider_holds(uuid,uuid)',
                           'honour_decided_by()', 'honour_tell_decider()'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = f::regprocedure;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/145: % is not a definer', f;
    END IF;
    IF NOT ('search_path=pg_catalog, public, pg_temp' = ANY (coalesce((SELECT proconfig FROM pg_proc WHERE oid = f::regprocedure), '{}'))) THEN
      RAISE EXCEPTION 'db/145: % does not pin its search_path', f;
    END IF;
    IF v_src ~* '\mcurrent_date\M' THEN
      RAISE EXCEPTION 'db/145: % reads the database''s day (db/128)', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['honour_withdrawn_reason(uuid)', 'honour_nomination_id(uuid)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/145: % is not the application''s alone', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['recognition_decider_holds(uuid,uuid)', 'honour_decided_by()', 'honour_tell_decider()'] LOOP
    IF has_function_privilege('scrbrd_app', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/145: % is callable by the application or PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.rolname = r)
       AND (has_column_privilege(r, 'honour', 'withdrawn_reason', 'SELECT') OR has_column_privilege(r, 'honour', 'nomination_id', 'SELECT')
            OR has_function_privilege(r, 'honour_withdrawn_reason(uuid)', 'EXECUTE')
            OR has_function_privilege(r, 'honour_nomination_id(uuid)', 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/145: a managed host''s API role (%) reaches a withdrawal''s reason', r;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'honour'::regclass AND tgname IN ('honour_decided_by', 'honour_tell_decider')
        AND tgenabled <> 'D') <> 2 THEN
    RAISE EXCEPTION 'db/145: honour_decided_by or honour_tell_decider is missing or disabled';
  END IF;
  -- F9: the audit is never deleted with its honour.
  IF (SELECT c.confdeltype FROM pg_constraint c
       WHERE c.conrelid = 'recognition_audit'::regclass AND c.contype = 'f' AND c.confrelid = 'honour'::regclass) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'db/145: recognition_audit''s honour key does not RESTRICT a delete';
  END IF;
  -- The door db/142 rests on is still its owner, which RLS does not stop.
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'honour'::regclass) THEN
    RAISE EXCEPTION 'db/145: honour forces row-level security';
  END IF;
END $check$;

DROP FUNCTION pg_temp._v145_fold(text);

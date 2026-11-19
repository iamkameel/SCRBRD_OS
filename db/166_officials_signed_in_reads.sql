-- ══════════════════════════════════════════════════════════════════
--  166 · Switched off is hidden signed in as well: a fixture's officials
--        are read only while Officials is on for the fixture's school
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's rule, 13 Nov 2026: "Anything that's Switched Off
-- for a user should be hidden for that user but still record data."
-- db/156 applied it to the signed-out overlay: broadcast_state() names the
-- umpires only while feature_enabled('officials', m.school_id, NULL), the
-- school being the FIXTURE's (match.school_id, the home side's). Signed in,
-- match_official was still read at both ends of a fixture (db/106's
-- match_official_read): Hilton switches Officials off, and Westville's
-- administrator, with it on, still read Hilton's umpire (Fable's red-team
-- of db/156, S4; SCRBRD-144). This file closes the table; the API's reads
-- (read-api.mjs officials, match_duties, duty_suspensions) ask the same
-- switch for each row, so the gate holds at the door as well.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   + official_shown(uuid)  true while Officials is on for the fixture's
--       school, feature_enabled('officials', match_school(p_match), NULL):
--       db/156's choice exactly (match_school() is match.school_id, which
--       broadcast_state() reads as m.school_id). So an away fixture follows
--       the home school's switch, and the away school switching Officials
--       off for itself hides nothing of the home school's appointments at
--       the table (its own readers are refused at the API's module gate).
--       The person is NULL, as in db/156: a person-level suppression hides
--       the officials from that person in the API (my_feature_enabled()),
--       never the appointments from everyone else.
--     ONE EXCEPTION, as db/156 made for a DRS review: whoever may appoint
--       (officiating.assign over the fixture, match_official_insert's and
--       _update's own question) still sees the row at the table. A SELECT
--       policy also governs an INSERT's RETURNING and an UPDATE's WHERE, so
--       without it the appointment sheet (withdraw the panel, write the
--       new one) could not be stored while Officials is off, which is the
--       opposite of the rule. He is still not SHOWN it: every API read of
--       the officials asks the switch for the row's school itself.
--   + the RESTRICTIVE SELECT policy match_official_shown_while_on on
--       match_official, asking official_shown(match_id). ANDed with
--       match_official_read and the pad-scope policies, so it narrows every
--       reader and widens none. match_official_read (db/09, db/39, db/106,
--       db/129) is NOT touched, so db/129's guard on its text still holds.
--   official_shown() is a definer with its path pinned (it asks app_can()
--   and the switch past the caller's own row security), EXECUTE revoked from
--   PUBLIC and a managed host's API roles, granted to scrbrd_app alone.
--
--   ~ duty_link(uuid)  re-made in place (signature, owner, SECURITY DEFINER,
--       pinned path and grants as they are; CREATE OR REPLACE keeps the
--       ACL): the live body (db/34, as db/77 left it) word for word, bar ONE
--       refusal, FAIL CLOSED. While Officials is off for the fixture's
--       school (the same switch as above: feature_enabled('officials',
--       match_school(d.match_id), NULL)), linking a duty is refused with
--       'officials_off' and nothing is granted. An appointment stored while
--       Officials is off (switched off records) gives nobody a capability
--       until the school switches it on and the office links it then. It is
--       asked after the permission check, so somebody who may not link
--       learns nothing of the switch. duty_suspend() and duty_lift() are not
--       touched: taking a scorer's authority away, or pausing it, never
--       waits on a switch.
--
--   The other definers that read match_official (duty_status,
--   duty_suspended, duty_suspend, duty_lift, broadcast_state, audit_log,
--   account_offboard_preview, role_assignment_linked_guard) are owned by the
--   table's owner and bypass its row security, so none of them moves: a
--   duty keeps its lifecycle and its audit while hidden. So the office's
--   audit rows for a suspension ("Suspended a match duty: scorer", with the
--   subject's id; db/80, db/132) are still listed to it while Officials is
--   off. That is the record the rule keeps; they name no official.
--
--   Not touched: db/01, db/09, feature_enabled(), match_official_read, the
--   appointment writes, broadcast_state(), the stored appointments. Nothing
--   here deletes a row.
--
-- THE GUARD: official_shown(), if there, must be this file's body, and the
-- policy, if there, this file's; duty_link() must be the live body before
-- this file (md5 cbe2d29e…) or this file's. A second paste changes nothing.
--
-- One transaction: the paste runs the file inside one, so there is no BEGIN
-- or COMMIT here. Its proof is db/99 §140; the walk is smoke-officials.
--
-- LOCKS: the first paste's CREATE POLICY takes ACCESS EXCLUSIVE on
-- match_official, so it waits at most ten seconds for it (section 0 below)
-- rather than queueing the overlay and the scorer's home behind an open
-- appointment sheet. Paste it outside a match; on lock_timeout, paste again.

CREATE OR REPLACE FUNCTION pg_temp._v166_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

-- ── 0 · What this file was written against ─────────────────────────
DO $guard$
DECLARE v text;
BEGIN
  IF to_regclass('match_official') IS NULL
     OR to_regprocedure('feature_enabled(text,uuid,uuid)') IS NULL OR to_regprocedure('match_school(uuid)') IS NULL
     OR to_regprocedure('match_team(uuid)') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrbrd_app') THEN
    RAISE EXCEPTION 'db/166: match_official, feature_enabled(), match_school(), match_team(), app_can() or the role scrbrd_app is missing; apply every file before this one first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feature_flag WHERE key = 'officials') THEN
    RAISE EXCEPTION 'db/166: the switch officials is not in feature_flag; apply db/08 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'match_official'::regclass AND p.polname = 'match_official_read'
                    AND p.polcmd = 'r' AND p.polpermissive) THEN
    RAISE EXCEPTION 'db/166: match_official_read is not a permissive SELECT policy on match_official; look before narrowing it';
  END IF;
  IF to_regprocedure('official_shown(uuid)') IS NOT NULL THEN
    SELECT pg_temp._v166_fold(p.prosrc) INTO v FROM pg_proc p WHERE p.oid = 'official_shown(uuid)'::regprocedure;
    IF v <> 'da65391be3ed1e936103d1dfd9825037' THEN
      RAISE EXCEPTION 'db/166: official_shown(uuid) is there and is not this file''s (md5 % of its folded body); look before replacing it', v;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'match_official'::regclass AND p.polname = 'match_official_shown_while_on'
                AND NOT (p.polcmd = 'r' AND NOT p.polpermissive AND p.polroles = '{0}'
                         AND pg_get_expr(p.polqual, p.polrelid) = 'official_shown(match_id)' AND p.polwithcheck IS NULL)) THEN
    RAISE EXCEPTION 'db/166: match_official_shown_while_on is there and is not this file''s policy; look before replacing it';
  END IF;
  SELECT pg_temp._v166_fold(p.prosrc) INTO v FROM pg_proc p WHERE p.oid = to_regprocedure('duty_link(uuid)');
  IF v IS NULL OR v NOT IN ('cbe2d29e2ee1315f239fa8814b5d404d',   -- the live body before this file (db/34, db/77)
                            '19ba09e6582a08dbe0dddd094db412e4') THEN                 -- this file's
    RAISE EXCEPTION 'db/166: duty_link(uuid) is missing or not the body this file was written against (md5 % of its folded body); look before replacing it', v;
  END IF;
END $guard$;

-- ── 0 · Ten seconds for a lock, or nothing (db/158, db/161, db/165) ──
-- A plain SET, after the guard, so it holds for every statement after it
-- however the file is run (psql -1, the SQL editor's single run, statement
-- by statement); the file's last statement RESETs it, so a pooled connection
-- is handed back as it came. Inside a transaction a stopped paste rolls back
-- whole; statement by statement, a second paste finishes what a stopped one
-- left (every step below is made once or made in place).
SET lock_timeout = '10s';


-- ── 1 · An appointment is read only while Officials is on for its fixture's school ──
-- Asked once per row by the policy below. True while the officials switch
-- is on for the fixture's school (the person NULL, as db/156); or for
-- whoever may appoint, so that the sheet can be stored while it is off.
CREATE OR REPLACE FUNCTION official_shown(p_match uuid) RETURNS boolean AS $$
  SELECT coalesce(feature_enabled('officials', match_school(p_match), NULL::uuid), false)
      OR coalesce(app_can('officiating.assign', match_school(p_match), match_team(p_match),
                          '00000000-0000-0000-0000-000000000000'::uuid, p_match), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DO $grants$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION official_shown(uuid) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION official_shown(uuid) FROM %I', r);
    END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION official_shown(uuid) TO scrbrd_app;
END $grants$;

-- RESTRICTIVE, so it is ANDed with match_official_read and every other
-- read: it can only take a row away. Made once.
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'match_official'::regclass AND polname = 'match_official_shown_while_on') THEN
    CREATE POLICY match_official_shown_while_on ON match_official AS RESTRICTIVE FOR SELECT TO PUBLIC
      USING (official_shown(match_id));
  END IF;
END $policy$;


-- ── 2 · No duty is linked while Officials is off for its fixture's school ──
-- The live body word for word, bar the one marked refusal (fail closed).
CREATE OR REPLACE FUNCTION duty_link(p_duty uuid)
 RETURNS TABLE(ok boolean, reason text, assignment_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  d      match_official%ROWTYPE;
  v_role text;
  v_new  uuid;
BEGIN
  SELECT * INTO d FROM match_official mo WHERE mo.id = p_duty FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_duty', NULL::uuid; RETURN; END IF;
  v_role := duty_role(d.duty);
  IF v_role IS NULL
     OR NOT app_can('user.role.assign', d.school_id, NULL, NULL, NULL)
     OR NOT app_may_grant_at(v_role, d.school_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid; RETURN;
  END IF;
  -- db/162 (SCRBRD-144): switched off records but grants nothing. While
  -- Officials is off for the fixture's school, no duty becomes authority.
  IF NOT coalesce(feature_enabled('officials', match_school(d.match_id), NULL::uuid), false) THEN
    RETURN QUERY SELECT false, 'officials_off', NULL::uuid; RETURN;
  END IF;
  IF d.withdrawn THEN RETURN QUERY SELECT false, 'duty_withdrawn', NULL::uuid; RETURN; END IF;
  IF d.person_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = d.person_id AND u.active) THEN
    RETURN QUERY SELECT false, 'no_account', NULL::uuid; RETURN;
  END IF;
  IF d.assignment_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM role_assignment r WHERE r.id = d.assignment_id AND r.active) THEN
      RETURN QUERY SELECT false, 'already_linked', d.assignment_id; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM duty_suspension s WHERE s.duty_id = d.id AND s.lifted_at IS NULL) THEN
      RETURN QUERY SELECT false, 'duty_suspended', NULL::uuid; RETURN;
    END IF;
  END IF;

  INSERT INTO role_assignment (person_id, role, school_id, team_code, fixture_id)
  VALUES (d.person_id, v_role, d.school_id, NULL, d.match_id)
  RETURNING role_assignment.id INTO v_new;
  UPDATE match_official SET assignment_id = v_new WHERE match_official.id = d.id;
  RETURN QUERY SELECT true, NULL::text, v_new;
END $function$;


-- ── 3 · After: refuse to commit a file that did not do what it says ──
DO $after$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'duty_link(uuid)'::regprocedure AND p.prosecdef
                    AND p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']
                    AND pg_temp._v166_fold(p.prosrc) = '19ba09e6582a08dbe0dddd094db412e4') THEN
    RAISE EXCEPTION 'db/166: duty_link() is not this file''s body, or not a definer with its search path pinned';
  END IF;
  IF has_function_privilege('public', 'duty_link(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'duty_link(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/166: duty_link() is callable by PUBLIC, or not by the application (db/157 left it to scrbrd_app)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'official_shown(uuid)'::regprocedure AND p.prosecdef
                    AND p.provolatile = 's'
                    AND p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']
                    AND pg_temp._v166_fold(p.prosrc) = 'da65391be3ed1e936103d1dfd9825037') THEN
    RAISE EXCEPTION 'db/166: official_shown() is not this file''s body, or not a stable definer with its search path pinned';
  END IF;
  -- EXECUTE to its owner and the application exactly, by aclexplode.
  IF (SELECT array_agg(coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type
                       ORDER BY a.grantee <> p.proowner, a.grantee::regrole::text)
        FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.oid = 'official_shown(uuid)'::regprocedure)
     IS DISTINCT FROM
     (SELECT ARRAY[p.proowner::regrole::text || ':EXECUTE', 'scrbrd_app:EXECUTE']
        FROM pg_proc p WHERE p.oid = 'official_shown(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/166: official_shown() is not EXECUTE to its owner and scrbrd_app exactly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'match_official'::regclass AND p.polname = 'match_official_shown_while_on'
                    AND p.polcmd = 'r' AND NOT p.polpermissive AND p.polroles = '{0}' AND p.polwithcheck IS NULL
                    AND pg_get_expr(p.polqual, p.polrelid) = 'official_shown(match_id)')
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'match_official'::regclass AND p.polname = 'match_official_read'
                       AND p.polcmd = 'r' AND p.polpermissive)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'match_official'::regclass) THEN
    RAISE EXCEPTION 'db/166: match_official_shown_while_on is not one RESTRICTIVE SELECT policy asking official_shown(match_id), or match_official_read or row security is gone';
  END IF;
END $after$;

DROP FUNCTION pg_temp._v166_fold(text);

-- ── 4 · The lock limit back as it was: a pooled connection is handed back as it came ──
RESET lock_timeout;

-- ══════════════════════════════════════════════════════════════════
--  80 · The audit log shows roles granted (SCRBRD-132 B2)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. db/79's audit_log() shows a role ENDED (role_assignment_ending,
-- db/77) and not a role GRANTED, so the log said "the office ended the
-- leaver's player role" and never "the office made him a player". Kameel,
-- 2026-10-02: the log shows grants too. db/79 is already applied in
-- production and does not change; this file re-emits audit_log() with one
-- more source and nothing else moved.
--
-- WHAT IS HERE
--
--   audit_log(school, kinds, since, before, before_key, limit)
--       CREATE OR REPLACE, the same signature, the same return shape, the
--       same rights and settings (SECURITY DEFINER, search_path pinned, the
--       application role alone). The body is db/79's with ONE branch added,
--       after the endings:
--
--         kind   table                one row per      gate
--         role   role_assignment      role granted     audit.read at the school, any scope (db/79's v_any),
--                (db/00)                               AND the table's own reader (role_assignment_read,
--                                                      db/01: the person's own row, or user.role.assign
--                                                      over the row's school and team), AND not under a
--                                                      pad credential (pad_scope_select, db/50)
--
--       The row: "Granted a role: <role_words(role)> (<team>)", at the
--       assignment's created_at; the actor its created_by (stamped by db/01's
--       role_assignment_stamp_granter() from the session); the subject the
--       person, masked by db/79's audit_person_label() rule (a pupil in
--       initials); detail {role, team} and nothing else; key
--       `role:<assignment id>:granted`. An ending keeps db/79's key,
--       `role:<assignment id>`, so a cursor a reader holds across the paste
--       still pages. The kind is `role` for both, so the filter "role" shows
--       a role's whole life.
--
--   THE GATE IS THE TABLE'S OWN DOOR, NEVER WIDER. role_assignment's policy
--       is user.role.assign over the row's (school, team), or the row is the
--       reader's own; audit.read does not open it. So, as db/79 does for
--       duty_suspension, a grant is shown only to a reader who holds
--       audit.read at the school AND whom role_assignment_read itself would
--       admit to that row: the office sees the school's grants; a DSO
--       (audit.read without the office's key) sees only his own; a coach
--       sees nothing (no audit.read). The predicate is asked per row, as the
--       policy asks it, because a team-scoped user.role.assign admits one
--       side's rows and not the school's.
--
--   NOT here, on purpose:
--     - a support hour (db/22): its assignment is the support kind's row
--       ("Began a support session", support_access), marked by
--       support_access.assignment_id. Listed once, there, not twice.
--     - created_by NULL is not hidden: a seeded or migrated appointment has
--       no person behind it (db/00's note on created_by), and the row says
--       so with a null actor, which the tab words as "The system".
--     - nothing written by a person: role_assignment carries no free text,
--       and the branch selects none. No id of a child or a record in the
--       detail; the child the row names goes to the read's own access_log
--       row, as db/79 files every child it names.
--
--   THE DSO. A `dso` appointment IS shown, under the same gate, and so is
--       its ending (db/79 already lists role_assignment_ending's dso rows).
--       The appointment is not confidential: dso_contacts() names a school's
--       DSOs to everybody signed in, and the DSO register (SAFEGUARDING_DSO
--       §2.3, §2.6) records it for audit.read holders. What the log must
--       never say is that a CONCERN exists (§1, point 3), and an appointment
--       does not: the principal makes it (the platform, as the recovery path), and
--       says nothing about a concern. Hiding the grant while showing the
--       ending would be the inconsistent choice. The safeguarding cut on
--       access_log is db/79's and is untouched.
--
-- GUARDED, as db/77 re-emits a body: this refuses to run over an audit_log()
-- that is not db/79's as shipped (the md5 of its body), or db/80's own (a
-- second run). The check at the foot asserts the new body is the one this
-- file wrote, and keeps every promise db/79's check made.
--
-- RLS. Nothing new to read or write directly. db/99 §59 is its proof;
-- tools/smoke-audit-log.mjs walks it through the API.


-- ── 1 · The body in place must be db/79's ──────────────────────────
DO $guard$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = to_regprocedure('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/80: audit_log() is not in place; apply db/79 first';
  END IF;
  IF md5(v_src) = 'fb26d16d1b00f408b6d40dc7357e6a75' THEN
    RETURN;   -- already this file's: a second run
  END IF;
  IF md5(v_src) IS DISTINCT FROM '763b19ea36ff769d2510f2eca12adcfa' THEN
    RAISE EXCEPTION 'db/80: audit_log() is not db/79''s any more; add the grants branch to the version now in place and move its hash';
  END IF;
END $guard$;


-- ── 2 · The door, with the grants ──────────────────────────────────
CREATE OR REPLACE FUNCTION audit_log(
  p_school     uuid,
  p_kinds      text[]      DEFAULT NULL,
  p_since      timestamptz DEFAULT NULL,
  p_before     timestamptz DEFAULT NULL,
  p_before_key text        DEFAULT NULL,
  p_limit      integer     DEFAULT 50
) RETURNS TABLE (at timestamptz, kind text, action text, actor text, subject_kind text, subject text,
                 school_id uuid, school text, detail jsonb, key text) AS $$
#variable_conflict use_column
DECLARE
  NIL      constant uuid := '00000000-0000-0000-0000-000000000000';
  v_me     uuid := app_user_id();
  v_any    boolean;
  v_office boolean;
  v_kinds  text[] := CASE WHEN p_kinds IS NULL OR cardinality(p_kinds) = 0
                          THEN ARRAY['access', 'scoring', 'amendment', 'scorebook', 'support', 'role', 'duty']
                          ELSE p_kinds END;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_ids    uuid[] := '{}';
  v_seen   text[] := '{}';
  r        record;
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;
  -- No school named: the reader's own.
  p_school := coalesce(p_school, (SELECT u.school_id FROM app_user u WHERE u.id = v_me));
  IF p_school IS NULL THEN
    PERFORM log_restricted_read('audit_log', '{}'::uuid[], '{}'::text[], NULL);
    RETURN;
  END IF;

  -- Asked once: every school-wide source's own predicate is this one.
  v_any    := app_can('audit.read', p_school, '*'::text, NIL, NIL);
  v_office := v_any AND app_can('user.role.assign', p_school, NULL, NULL, NULL);

  IF v_any THEN
    FOR r IN
      -- Cheap columns first — ids, never labels — so the sort and the page
      -- cut run before any name is looked up or masked; the labels are made
      -- for the page alone, in the outer query.
      WITH src AS (
        -- access_log: a read somebody made. Never a safeguarding row.
        SELECT l.occurred_at AS at, 'access'::text AS kind,
               CASE WHEN l.resource = 'audit_log' THEN 'Read the audit log'
                    ELSE 'Read ' || replace(l.resource, '_', ' ') END AS action,
               l.person_id AS actor_id,
               CASE WHEN l.record_count = 1 THEN l.record_ids[1] END AS one_id,
               NULL::uuid AS person_id, NULL::uuid AS match_id, NULL::uuid AS from_id, NULL::uuid AS to_id,
               CASE WHEN l.resource = 'audit_log' THEN 'the audit log'
                    ELSE l.record_count || CASE WHEN l.record_count = 1 THEN ' record' ELSE ' records' END END AS words,
               l.school_id,
               jsonb_build_object('resource', l.resource, 'records', l.record_count, 'fields', to_jsonb(l.fields),
                                  'platformWide', l.platform_wide, 'support', l.support_access_id IS NOT NULL) AS detail,
               'access:' || l.id::text AS key
          FROM access_log l
         WHERE 'access' = ANY (v_kinds)
           AND l.school_id = p_school
           AND l.resource NOT LIKE 'safeguarding%'
           AND (p_since IS NULL OR l.occurred_at >= p_since)
           AND (p_before IS NULL OR l.occurred_at <= p_before)
        UNION ALL
        -- scoring_audit: who took, offered, handed over or released the pen.
        SELECT s.at, 'scoring',
               CASE s.event
                 WHEN 'claim'                  THEN 'Took the scoring pen'
                 WHEN 'handover_armed'         THEN 'Offered the scoring pen'
                 WHEN 'handover_claimed'       THEN 'Claimed an offered pen'
                 WHEN 'handover_complete'      THEN 'Handed over the scoring pen'
                 WHEN 'handover_verify_failed' THEN 'A handover failed its check'
                 WHEN 'force_release'          THEN 'Force-released the scoring pen'
                 WHEN 'amendment_approved'     THEN 'Applied an approved amendment'
                 WHEN 'pad_resume_issued'      THEN 'Issued a pad resume key'
                 WHEN 'pad_resume_revoked'     THEN 'Ended a pad resume key'
                 WHEN 'scorebook_import'       THEN 'Imported a scorebook'
                 ELSE 'Scoring: ' || replace(s.event, '_', ' ') END,
               s.actor_id, NULL, NULL, s.match_id, s.from_user, s.to_user, NULL, s.school_id,
               jsonb_strip_nulls(jsonb_build_object('event', s.event, 'epoch', s.epoch)),
               'scoring:' || s.id::text
          FROM scoring_audit s
         WHERE 'scoring' = ANY (v_kinds)
           AND s.school_id = p_school
           AND app_can('audit.read', s.school_id, match_team(s.match_id), NULL, s.match_id)
        UNION ALL
        -- scoring_amendment: the request, and the decision when there is one.
        SELECT a.requested_at, 'amendment', 'Asked to amend a delivery', a.requested_by,
               NULL, NULL, a.match_id, NULL, NULL, NULL, a.school_id,
               jsonb_build_object('state', a.state), 'amendment:' || a.id::text || ':asked'
          FROM scoring_amendment a
         WHERE 'amendment' = ANY (v_kinds)
           AND a.school_id = p_school
           AND app_can('audit.read', a.school_id, match_team(a.match_id), NULL, a.match_id)
        UNION ALL
        SELECT a.decided_at, 'amendment',
               CASE a.state WHEN 'approved' THEN 'Approved an amendment' ELSE 'Declined an amendment' END,
               a.decided_by, NULL, NULL, a.match_id, NULL, NULL, NULL, a.school_id,
               jsonb_build_object('state', a.state), 'amendment:' || a.id::text || ':decided'
          FROM scoring_amendment a
         WHERE 'amendment' = ANY (v_kinds)
           AND a.school_id = p_school AND a.decided_at IS NOT NULL
           AND app_can('audit.read', a.school_id, match_team(a.match_id), NULL, a.match_id)
        UNION ALL
        -- scorebook_import_revision: what was done to an import, never the card.
        SELECT v.at, 'scorebook', 'Scorebook import: ' || v.action, v.actor_id,
               NULL, NULL, v.match_id, NULL, NULL, NULL, v.school_id,
               jsonb_build_object('version', v.version, 'step', v.action), 'scorebook:' || v.id::text
          FROM scorebook_import_revision v
         WHERE 'scorebook' = ANY (v_kinds)
           AND v.school_id = p_school
           AND app_can('audit.read', v.school_id, v.team_code, NIL, v.match_id)
        UNION ALL
        -- support_access: an hour of platform support, begun and ended.
        SELECT x.started_at, 'support', 'Began a support session', x.actor_id,
               NULL, NULL, NULL, NULL, NULL, role_words(x.role) || coalesce(' (' || x.team_code || ')', ''), x.school_id,
               jsonb_build_object('role', x.role, 'team', x.team_code, 'expiresAt', x.expires_at),
               'support:' || x.id::text || ':began'
          FROM support_access x
         WHERE 'support' = ANY (v_kinds) AND x.school_id = p_school
        UNION ALL
        SELECT x.ended_at, 'support', 'Ended a support session', x.ended_by,
               NULL, NULL, NULL, NULL, NULL, role_words(x.role) || coalesce(' (' || x.team_code || ')', ''), x.school_id,
               jsonb_build_object('role', x.role, 'team', x.team_code),
               'support:' || x.id::text || ':ended'
          FROM support_access x
         WHERE 'support' = ANY (v_kinds) AND x.school_id = p_school AND x.ended_at IS NOT NULL
        UNION ALL
        -- role_assignment_ending: whose role ended, which, by whom. Not why.
        SELECT e.ended_at, 'role',
               'Ended a role: ' || role_words(e.role) || coalesce(' (' || e.team_code || ')', ''),
               e.ended_by, NULL, e.person_id, NULL, NULL, NULL, NULL, e.school_id,
               jsonb_build_object('role', e.role, 'team', e.team_code),
               'role:' || e.assignment_id::text
          FROM role_assignment_ending e
         WHERE 'role' = ANY (v_kinds) AND e.school_id = p_school
        UNION ALL
        -- role_assignment: whose role was granted, which, by whom (db/80).
        -- Never a support hour's (that is the support kind's own row), and
        -- only a grant the reader could read on role_assignment itself: its
        -- own policy, role_assignment_read, and the pad credential's cut.
        SELECT ra.created_at, 'role',
               'Granted a role: ' || role_words(ra.role) || coalesce(' (' || ra.team_code || ')', ''),
               ra.created_by, NULL, ra.person_id, NULL, NULL, NULL, NULL, ra.school_id,
               jsonb_build_object('role', ra.role, 'team', ra.team_code),
               'role:' || ra.id::text || ':granted'
          FROM role_assignment ra
         WHERE 'role' = ANY (v_kinds) AND ra.school_id = p_school
           AND (p_since IS NULL OR ra.created_at >= p_since)
           AND (p_before IS NULL OR ra.created_at <= p_before)
           AND NOT EXISTS (SELECT 1 FROM support_access sx WHERE sx.assignment_id = ra.id)
           AND NOT app_pad_scoped()
           AND (ra.person_id = v_me OR app_can('user.role.assign', ra.school_id, ra.team_code, NULL, NULL))
        UNION ALL
        -- duty_suspension: a match duty paused and lifted. The office's only.
        SELECT d.suspended_at, 'duty', 'Suspended a match duty: ' || o.duty, d.suspended_by,
               NULL, ra.person_id, o.match_id, NULL, NULL, NULL, d.school_id,
               jsonb_build_object('duty', o.duty), 'duty:' || d.id::text || ':suspended'
          FROM duty_suspension d
          JOIN match_official o ON o.id = d.duty_id
          JOIN role_assignment ra ON ra.id = d.assignment_id
         WHERE 'duty' = ANY (v_kinds) AND v_office AND d.school_id = p_school
        UNION ALL
        SELECT d.lifted_at, 'duty', 'Lifted a match duty''s suspension: ' || o.duty, d.lifted_by,
               NULL, ra.person_id, o.match_id, NULL, NULL, NULL, d.school_id,
               jsonb_build_object('duty', o.duty), 'duty:' || d.id::text || ':lifted'
          FROM duty_suspension d
          JOIN match_official o ON o.id = d.duty_id
          JOIN role_assignment ra ON ra.id = d.assignment_id
         WHERE 'duty' = ANY (v_kinds) AND v_office AND d.school_id = p_school AND d.lifted_at IS NOT NULL
      ),
      page AS (
        SELECT * FROM src
         WHERE (p_since IS NULL OR src.at >= p_since)
           AND (p_before IS NULL OR src.at < p_before
                OR (p_before_key IS NOT NULL AND src.at = p_before AND src.key < p_before_key))
         ORDER BY src.at DESC, src.key DESC
         LIMIT v_limit
      ),
      -- Who each row is about: the one child or person a single-record read
      -- named, the person whose role or duty it is, or the fixture.
      named AS (
        SELECT page.*,
               p1.id AS player_hit, p1.full_name AS player_name,
               coalesce(page.person_id, CASE WHEN p1.id IS NULL THEN u1.id END) AS person_hit
          FROM page
          LEFT JOIN player   p1 ON p1.id = page.one_id
          LEFT JOIN app_user u1 ON u1.id = page.one_id
      )
      SELECT n.at, n.kind, n.action, audit_person_label(n.actor_id) AS actor,
             CASE WHEN n.actor_id IS NOT NULL AND audit_names_pupil(n.actor_id) THEN n.actor_id END AS actor_child,
             CASE WHEN n.player_hit IS NOT NULL THEN 'pupil'
                  WHEN n.person_hit IS NOT NULL THEN 'person'
                  WHEN n.match_id IS NOT NULL AND n.kind <> 'duty' THEN 'fixture'
                  WHEN n.kind = 'support' THEN 'school'
                  ELSE 'records' END AS subject_kind,
             CASE WHEN n.player_hit IS NOT NULL THEN audit_mask_name(n.player_name, true)
                  WHEN n.person_hit IS NOT NULL THEN audit_person_label(n.person_hit)
                  WHEN n.match_id IS NOT NULL AND n.kind <> 'duty' THEN audit_fixture_label(n.match_id)
                  ELSE n.words END AS subject,
             CASE WHEN n.player_hit IS NOT NULL THEN n.player_hit
                  WHEN n.person_hit IS NOT NULL AND audit_names_pupil(n.person_hit) THEN n.person_hit END AS child_id,
             n.school_id, sc.name AS school,
             n.detail || jsonb_strip_nulls(jsonb_build_object(
               'from', audit_person_label(n.from_id), 'to', audit_person_label(n.to_id),
               'fixture', CASE WHEN n.kind = 'duty' THEN audit_fixture_label(n.match_id) END)) AS detail,
             n.key
        FROM named n
        LEFT JOIN school sc ON sc.id = n.school_id
       ORDER BY n.at DESC, n.key DESC
    LOOP
      at := r.at; kind := r.kind; action := r.action; actor := r.actor;
      subject_kind := r.subject_kind; subject := r.subject;
      school_id := r.school_id; school := r.school; detail := r.detail; key := r.key;
      IF r.child_id IS NOT NULL AND cardinality(v_ids) < 500 AND NOT r.child_id = ANY (v_ids) THEN
        v_ids := v_ids || r.child_id;
      END IF;
      IF r.actor_child IS NOT NULL AND cardinality(v_ids) < 500 AND NOT r.actor_child = ANY (v_ids) THEN
        v_ids := v_ids || r.actor_child;
      END IF;
      IF NOT r.kind = ANY (v_seen) THEN v_seen := v_seen || r.kind; END IF;
      RETURN NEXT;
    END LOOP;
  END IF;

  -- Every call, answered or refused, on the record.
  PERFORM log_restricted_read('audit_log', v_ids, v_seen, p_school);
  RETURN;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · Grants ─────────────────────────────────────────────────────
-- CREATE OR REPLACE keeps the rights db/79 gave; restated, so the file reads
-- alone and a hand-run over a database that lost them puts them back.
DO $grants$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION audit_log(uuid, text[], timestamptz, timestamptz, text, integer) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION audit_log(uuid, text[], timestamptz, timestamptz, text, integer) FROM %I', r);
    END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION audit_log(uuid, text[], timestamptz, timestamptz, text, integer) TO scrbrd_app;
END $grants$;


-- ── 4 · What this file promised, checked in the same paste ──────────
-- db/79's check, kept true, and the grants branch's own. The behaviour is
-- asserted live in db/99 §59 and walked by tools/smoke-audit-log.mjs.
DO $check$
DECLARE f text; src text;
BEGIN
  FOREACH f IN ARRAY ARRAY['audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
                           'audit_names_pupil(uuid)', 'audit_mask_name(text,boolean)',
                           'audit_person_label(uuid)', 'audit_fixture_label(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/80: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/80: % is executable by PUBLIC', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(ro.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/80: % is executable by a managed host''s API role', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('scrbrd_app', 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/80: the application cannot call audit_log()';
  END IF;
  IF has_function_privilege('scrbrd_app', 'audit_person_label(uuid)', 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'audit_names_pupil(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/80: a helper of audit_log() answers the application directly';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'db/80: audit_log() is not SECURITY DEFINER';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure;
  -- The body is the one this file wrote: db/79's with the grants branch.
  IF md5(src) IS DISTINCT FROM 'fb26d16d1b00f408b6d40dc7357e6a75' THEN
    RAISE EXCEPTION 'db/80: audit_log() is not the body this file wrote';
  END IF;
  -- db/79's promises: the safeguarding cut, the log on every call, no free text.
  IF position('l.resource NOT LIKE ''safeguarding%''' IN src) = 0 THEN
    RAISE EXCEPTION 'db/80: audit_log() does not cut the safeguarding rows';
  END IF;
  IF position('PERFORM log_restricted_read(''audit_log''' IN src) = 0 THEN
    RAISE EXCEPTION 'db/80: audit_log() does not log its reads';
  END IF;
  IF src ~ '\m[a-z][a-z0-9]*\.(reason|decided_note|note|card|typed|checked|account|lift_reason)\M' THEN
    RAISE EXCEPTION 'db/80: audit_log() selects free text';
  END IF;
  -- The grants branch's: the table's own door, never a support hour, and an
  -- ending's key as db/79 issued it.
  IF position('AND (ra.person_id = v_me OR app_can(''user.role.assign'', ra.school_id, ra.team_code, NULL, NULL))' IN src) = 0
     OR position('AND NOT app_pad_scoped()' IN src) = 0 THEN
    RAISE EXCEPTION 'db/80: a grant is not gated on role_assignment''s own reader';
  END IF;
  IF position('NOT EXISTS (SELECT 1 FROM support_access sx WHERE sx.assignment_id = ra.id)' IN src) = 0 THEN
    RAISE EXCEPTION 'db/80: a support hour''s assignment would be listed twice';
  END IF;
  IF position('''role:'' || e.assignment_id::text' IN src) = 0
     OR position('''role:'' || ra.id::text || '':granted''' IN src) = 0 THEN
    RAISE EXCEPTION 'db/80: a role row''s key is not the one its cursor expects';
  END IF;
  -- The tables it reads, and the predicates it mirrors, are still there.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'access_log'
                    AND policyname = 'access_log_safeguarding_hidden' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/80: access_log_safeguarding_hidden (db/57) is missing';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
         AND tablename IN ('access_log', 'scoring_audit', 'scoring_amendment', 'scorebook_import_revision',
                           'support_access', 'role_assignment_ending')
         AND qual ~ 'app_can\(''audit\.read''') <> 6 THEN
    RAISE EXCEPTION 'db/80: a source no longer admits audit.read under its own policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'duty_suspension'
                    AND policyname = 'duty_suspension_read' AND qual ~ 'app_can\(''user\.role\.assign''') THEN
    RAISE EXCEPTION 'db/80: duty_suspension_read is no longer the office''s';
  END IF;
  -- role_assignment's own reader is the one the branch mirrors, and the only
  -- permissive SELECT policy on the table: a wider one would leave the log
  -- narrower than the table (safe), a narrower one the log wider (not).
  IF (SELECT array_agg(regexp_replace(qual, '\s+', ' ', 'g')) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'role_assignment' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE')
     IS DISTINCT FROM ARRAY['((person_id = app_user_id()) OR app_can(''user.role.assign''::text, school_id, team_code, NULL::uuid, NULL::uuid))'] THEN
    RAISE EXCEPTION 'db/80: role_assignment_read is not the reader audit_log() mirrors for a grant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'role_assignment'
                    AND cmd = 'SELECT' AND permissive = 'RESTRICTIVE' AND qual = '(NOT app_pad_scoped())') THEN
    RAISE EXCEPTION 'db/80: role_assignment''s pad cut (db/50) is missing';
  END IF;
  -- The mask: a child's name in initials, an adult's whole.
  IF audit_mask_name('Verify Eighty Child', true) <> 'V E Child'
     OR audit_mask_name('Verify', true) <> 'V'
     OR audit_mask_name('Verify Adult', false) <> 'Verify Adult' THEN
    RAISE EXCEPTION 'db/80: audit_mask_name() does not mask as the overlay does';
  END IF;
END $check$;

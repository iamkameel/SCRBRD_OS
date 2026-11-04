-- ══════════════════════════════════════════════════════════════════
--  130 · Finishing the match (scoring.finalise)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Nothing in the product marked a pad-scored match complete
-- (SCRBRD-114 phase 3 §10.4.1, found again by the pilot's end-to-end walk,
-- tools/smoke-browser-pilot-flow.mjs, 3 Nov 2026): the pad's last
-- innings_end left match.status at 'scheduled', and everything after full
-- time waits on 'complete' — the Match Centre's confirm-or-correct prompt,
-- the official result (db/114 D6), a family's Played row, db/33's "completion
-- ends scoring". scoring.finalise ("Close an innings or lock a match", db/01)
-- was checked by no route and no policy (OFFICIAL_RESULT.md, header).
--
-- Kameel, 4 Nov 2026 (option A): whoever holds scoring.finalise at the HOME
-- side finishes the match, from the pad's result screen. The scorer and the
-- coach hold it and not fixture.update, so match_update (db/09) would refuse
-- them the column; the act is a definer of its own, which asks the one
-- capability and changes the one column.
--
-- WHAT IS HERE
--
--   match_finalise(p_match) → (ok, reason)
--       SECURITY DEFINER, search_path pinned, scrbrd_app's alone. In order:
--         1. app_can('scoring.finalise') at the match's home school and side,
--            or not_permitted. An unknown match says the same: the door never
--            tells a caller that a fixture exists (db/09's rule, the fixture
--            route's). Signed out, or under a pad credential (whose app_can()
--            admits only fixture.read and scoring.edit, db/50), not_permitted.
--         2. The match is complete already: (true, already_complete), and
--            nothing is written. A second press, a second phone, a retry.
--         3. The match was called off (status 'abandoned'): match_abandoned.
--            An abandoned fixture has its own state; finishing it would turn
--            the organiser's word into a result.
--         4. match_result_compute() — the fold the result screen's words and
--            the table read (db/69, db/121) — has not decided it (outcome
--            in_progress): not_decided.
--         5. A tie whose document provides a super over, not yet settled:
--            the completion gate's own reason, match_completion_refusal()
--            (db/71), super_over_pending. Asked before the update so the
--            caller gets the code rather than the trigger's exception; the
--            trigger stands behind it all the same.
--       Then the status, by an UPDATE of the one column, so every trigger on
--       it runs as it does for the office's route: the completion gate
--       (db/71), the pad credentials ending (db/50), a confirmation lapsing
--       (db/114), the lift clubs told (db/70). And one row of scoring_audit,
--       event 'match_finalised', the actor the caller, the detail the
--       outcome, the result hash and the log's head seq it was finished at.
--
--       NOT refused here, on purpose (Kameel, 4 Nov): a pending amendment
--       or a held ball. Confirmation (db/114 D6) waits on both, and a ball
--       arriving after completion is quarantined (db/33), not lost.
--
--   audit_log()
--       db/80's body with ONE line added to the scoring source's words:
--       'match_finalised' reads "Finished the match" (it read "Scoring: match
--       finalised" through the ELSE). The gate, the sources, the masking and
--       the keys are db/80's. Guarded as db/124 re-emits a body: this refuses
--       to run over an audit_log() whose folded body is neither db/80's as
--       shipped nor this file's.
--
-- NO TABLE, NO POLICY. scoring_audit (db/02) is already a source of the
-- audit log, under its own audit.read door; the definer writes it as the
-- owner, as scoring_claim() does. match.status is written by the definer
-- alone; db/09's match_update is unchanged.
--
-- No date is read here (db/128: none would be current_date).
--
-- Proof: db/99 §107. Walked through the API by tools/smoke-finalise.mjs and
-- from the pad by tools/smoke-browser-pilot-flow.mjs. The API's route,
-- POST /api/matches/:id/finalise, calls the function, so this file goes
-- before the API built with it; it is in services/api/expected-migrations.json.


-- ── 0 · Refuse to replace what this file was not written against ──
DO $guard$
DECLARE v_src text; v_md5 text;
BEGIN
  IF to_regprocedure('match_result_compute(uuid)') IS NULL
     OR to_regprocedure('match_completion_refusal(uuid)') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('app_user_id()') IS NULL
     OR to_regprocedure('match_school(uuid)') IS NULL OR to_regprocedure('match_team(uuid)') IS NULL
     OR to_regclass('scoring_audit') IS NULL THEN
    RAISE EXCEPTION 'db/130: match_result_compute() (db/69), match_completion_refusal() (db/71), app_can(), match_school(), match_team() or scoring_audit is missing; apply them first';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = to_regprocedure('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/130: audit_log() (db/79, db/80) is not there to re-create';
  END IF;
  v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
  IF v_md5 NOT IN ('1645ca9d393cac3b7d32869aa26991d5', 'f19c41322aa5c63846f827d49b960884') THEN
    RAISE EXCEPTION 'db/130: audit_log() is not db/80''s or this file''s (md5 % of its folded body); look before replacing it', v_md5;
  END IF;
END $guard$;


-- ── 1 · The act ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_finalise(p_match uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  m     match%ROWTYPE;
  r     record;
  v_why text;
BEGIN
  -- 1. The capability at the home side, asked before anything is locked or
  --    read: a caller who may not finish learns nothing, not even that the
  --    match exists.
  IF app_user_id() IS NULL OR p_match IS NULL
     OR NOT coalesce(app_can('scoring.finalise', match_school(p_match), match_team(p_match), NULL, p_match), false) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  -- One finisher at a time: a second press waits here and then finds it done.
  SELECT * INTO m FROM match x WHERE x.id = p_match FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_permitted'::text; RETURN; END IF;
  -- 2. Done already: a no-op, said as success.
  IF m.status = 'complete' THEN RETURN QUERY SELECT true, 'already_complete'::text; RETURN; END IF;
  -- 3. Called off: not a result to finish.
  IF m.status = 'abandoned' THEN RETURN QUERY SELECT false, 'match_abandoned'::text; RETURN; END IF;
  -- 4. The log has not decided it.
  SELECT x.outcome, x.result_hash INTO r FROM match_result_compute(p_match) x;
  IF r.outcome IS NULL OR r.outcome = 'in_progress' THEN RETURN QUERY SELECT false, 'not_decided'::text; RETURN; END IF;
  -- 5. A tie waiting on its super over: the gate's own reason.
  v_why := match_completion_refusal(p_match);
  IF v_why IS NOT NULL THEN RETURN QUERY SELECT false, v_why; RETURN; END IF;

  UPDATE match SET status = 'complete' WHERE id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, detail)
  VALUES (p_match, m.school_id, 'match_finalised', app_user_id(),
          jsonb_build_object('outcome', r.outcome, 'resultHash', r.result_hash,
                             'headSeq', coalesce((SELECT max(b.seq) FROM ball_event b WHERE b.match_id = p_match), 0)));
  RETURN QUERY SELECT true, 'finished'::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 2 · The audit log says it in words ─────────────────────────────
-- db/80's body, with one WHEN in the scoring source (marked below).
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
                 WHEN 'match_finalised'        THEN 'Finished the match'   -- db/130
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


-- ── 3 · Who may call these: the application, and nobody else ──────
-- A managed host's API roles get EXECUTE on every new function by default
-- privilege, directly and not through PUBLIC, so it is taken back (db/125's
-- loop; db/125's strict grant check caught exactly that).
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['match_finalise(uuid)',
                           'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ── 4 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §107.
DO $check$
DECLARE f text; src text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['match_finalise(uuid)', 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/130: % is not SECURITY DEFINER', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/130: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/130: % is executable by PUBLIC', f;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.rolname = r AND has_function_privilege(ro.oid, f::regprocedure, 'EXECUTE')) THEN
        RAISE EXCEPTION 'db/130: % is executable by a managed host''s API role (%)', f, r;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/130: the application cannot call %', f;
    END IF;
  END LOOP;

  -- The act asks the one capability, at the home side, before it locks.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'match_finalise(uuid)'::regprocedure;
  IF position('app_can(''scoring.finalise'', match_school(p_match), match_team(p_match), NULL, p_match)' IN src) = 0
     OR position('app_can(''scoring.finalise''' IN src) > position('FOR UPDATE' IN src) THEN
    RAISE EXCEPTION 'db/130: match_finalise() does not ask scoring.finalise at the home side before it locks';
  END IF;
  IF position('UPDATE match SET status = ''complete'' WHERE id = p_match' IN src) = 0
     OR position('''match_finalised''' IN src) = 0 THEN
    RAISE EXCEPTION 'db/130: match_finalise() does not set the status through the table, or does not leave its audit row';
  END IF;
  IF src ~* '\mcurrent_date\M' THEN
    RAISE EXCEPTION 'db/130: match_finalise() reads the database''s day (db/128)';
  END IF;
  -- The gate it asks first is still the trigger's.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'match'::regclass AND tgname = 'match_completion_gate' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'db/130: match_completion_gate (db/71) is missing';
  END IF;

  -- The audit log is the body this file wrote: db/80's with the one line.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure;
  IF md5(regexp_replace(btrim(src), '\s+', ' ', 'g')) IS DISTINCT FROM 'f19c41322aa5c63846f827d49b960884' THEN
    RAISE EXCEPTION 'db/130: audit_log() is not the body this file wrote';
  END IF;
  IF position('WHEN ''match_finalised''        THEN ''Finished the match''' IN src) = 0 THEN
    RAISE EXCEPTION 'db/130: audit_log() does not word a finished match';
  END IF;
  -- db/79's and db/80's promises, kept: the safeguarding cut, the log on
  -- every call, no free text, a grant gated on its own table's reader.
  IF position('l.resource NOT LIKE ''safeguarding%''' IN src) = 0 THEN
    RAISE EXCEPTION 'db/130: audit_log() does not cut the safeguarding rows';
  END IF;
  IF position('PERFORM log_restricted_read(''audit_log''' IN src) = 0 THEN
    RAISE EXCEPTION 'db/130: audit_log() does not log its reads';
  END IF;
  IF src ~ '\m[a-z][a-z0-9]*\.(reason|decided_note|note|card|typed|checked|account|lift_reason)\M' THEN
    RAISE EXCEPTION 'db/130: audit_log() selects free text';
  END IF;
  IF position('AND (ra.person_id = v_me OR app_can(''user.role.assign'', ra.school_id, ra.team_code, NULL, NULL))' IN src) = 0
     OR position('AND NOT app_pad_scoped()' IN src) = 0 THEN
    RAISE EXCEPTION 'db/130: a grant is not gated on role_assignment''s own reader';
  END IF;
  IF position('AND app_can(''audit.read'', s.school_id, match_team(s.match_id), NULL, s.match_id)' IN src) = 0 THEN
    RAISE EXCEPTION 'db/130: the scoring source is not under audit.read at its match';
  END IF;
END $check$;

-- ══════════════════════════════════════════════════════════════════
--  79 · The audit log, read (SCRBRD-132 B2; leftovers item 1.1)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Management's "Audit log" tab showed six invented entries
-- (a named boy's "medical clearance" among them) until Wave A took them down
-- with the line "The audit log is coming." This is the read it was waiting
-- for. Kameel, 2026-10-01: who sees it is whoever holds `audit.read` today;
-- children's names are masked as elsewhere; every read of it is logged.
--
-- WHAT IS HERE
--
--   audit_log(school, kinds, since, before, before_key, limit)
--       The one door. SECURITY DEFINER, search_path pinned, granted to the
--       application role alone; no school named is the reader's own. One
--       uniform row — when, kind, action, actor, subject kind, subject,
--       school, detail, key — newest first, drawn
--       from the audit tables that exist, each ONLY under the audit.read
--       predicate that table's own policy already admits:
--
--         kind        table                       one row per          gate (the table's own audit.read branch)
--         access      access_log (db/08)          read logged          audit.read at the school, any scope
--         scoring     scoring_audit (db/02)       pen event            audit.read over the fixture
--         amendment   scoring_amendment (db/02)   request, decision    audit.read over the fixture
--         scorebook   scorebook_import_revision   revision             audit.read over the fixture
--                     (db/63)
--         support     support_access (db/22)      began, ended         audit.read at the school, any scope
--         role        role_assignment_ending      role ended           audit.read at the school, any scope
--                     (db/77)
--         duty        duty_suspension (db/34)     suspended, lifted    audit.read at the school, any scope,
--                                                                      AND the table's own reader
--                                                                      (user.role.assign at the school, no team)
--
--       duty_suspension's own policy is user.role.assign, not audit.read, so
--       the log never reads it wider than its own door: an audit.read holder
--       without the office's key (a DSO) sees no suspension here.
--
--       NOT here, on purpose:
--         - safeguarding: no access_log row whose resource starts
--           `safeguarding`, for anybody, the DSO included (his record is
--           read through his own doors, db/57). access_log's RESTRICTIVE
--           policy hides those rows from everybody else; this hides them
--           from everybody.
--         - match_availability_history (availability.read) and
--           lift_purge_log (transport.lift.oversee): not audit.read's.
--         - any free text: a reason, a note, a card, an account, a clinical
--           note. A sentence written by a person may name a child and cannot
--           be masked; the row says who did what to whom and when, and the
--           reason stays on its own record behind its own door. access_log's
--           `fields` are column NAMES (what came back), never their content.
--         - any id of a child or a record, in the detail.
--
-- CHILDREN'S NAMES. A pupil named in a row — the actor (a pupil scorer, a
-- boy reading his own record), the subject (his ended role, his suspended
-- duty), or the one child a single-record read was about — is masked by the
-- initials rule: broadcast_name(name, 'initials') (db/08), the default a
-- child's name takes whenever it leaves its own record ("Thandeka Mahlangu"
-- becomes "T Mahlangu"); a name of one word gives its initial alone, as
-- initialAndSurname() does on the public pages. A pupil is db/57's test
-- (person_is_pupil: an account that is a player, or holds a live player or
-- selfaccess assignment) widened to the past: any player or selfaccess
-- assignment, live or ended, so a boy whose player role this log records
-- as ended is still masked on the row that says so. A player row is a child
-- by definition and always masked. Adults are named.
--
-- EVERY READ IS LOGGED. Each call writes one access_log row through
-- log_restricted_read() (db/22's: the support session and the platform-wide
-- mark are stamped there): resource 'audit_log', at the school asked about,
-- record_ids the players and pupils the returned rows named (capped at 500),
-- fields the kinds returned. A refused call is logged too, with nothing in
-- it: "somebody without audit.read asked for Hilton's log" is itself worth
-- the record. The log's own reads appear in it, as "the audit log".
--
-- PAGED by key, not by offset: the reads append rows newest-first while a
-- person pages, so an offset would repeat a row on every page. The cursor
-- is the last row's (at, key); a page is the rows strictly older.
--
-- RLS. Nothing new to read or write directly: the function reads as its
-- owner and applies each table's predicate itself (above), which db/99 §58
-- holds against the tables' own policies.

-- ── 1 · Who is a pupil, for this log ───────────────────────────────
CREATE OR REPLACE FUNCTION audit_names_pupil(p_person uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.player_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = p_person AND a.role IN ('player', 'selfaccess'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A name as the log shows it: initials for a child, whole for an adult.
CREATE OR REPLACE FUNCTION audit_mask_name(p_name text, p_child boolean) RETURNS text AS $$
  SELECT CASE
           WHEN p_name IS NULL OR btrim(p_name) = '' THEN NULL
           WHEN NOT p_child THEN btrim(p_name)
           WHEN position(' ' IN btrim(p_name)) = 0 THEN upper(left(btrim(p_name), 1))
           ELSE broadcast_name(btrim(p_name), 'initials')
         END
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION audit_person_label(p_person uuid) RETURNS text AS $$
  SELECT audit_mask_name(u.name, audit_names_pupil(u.id)) FROM app_user u WHERE u.id = p_person
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A fixture in a line: "Hilton College 1XI v Westville 1XI · 3 Oct 2026".
CREATE OR REPLACE FUNCTION audit_fixture_label(p_match uuid) RETURNS text AS $$
  SELECT coalesce(fixture_side_label(m.school_id, m.team_code), 'A fixture') || ' v ' || m.opponent
         || ' · ' || to_char(m.starts_at AT TIME ZONE 'Africa/Johannesburg', 'FMDD Mon YYYY')
    FROM match m WHERE m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 2 · The door ───────────────────────────────────────────────────
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
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
                           'audit_names_pupil(uuid)', 'audit_mask_name(text,boolean)',
                           'audit_person_label(uuid)', 'audit_fixture_label(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  -- The door alone is the application's. The helpers are called inside it,
  -- as its owner, and answer nobody else.
  GRANT EXECUTE ON FUNCTION audit_log(uuid, text[], timestamptz, timestamptz, text, integer) TO scrbrd_app;
END $grants$;


-- ── 4 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §58 and walked through the API by
-- tools/smoke-audit.mjs.
DO $check$
DECLARE f text; src text;
BEGIN
  FOREACH f IN ARRAY ARRAY['audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
                           'audit_names_pupil(uuid)', 'audit_mask_name(text,boolean)',
                           'audit_person_label(uuid)', 'audit_fixture_label(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/79: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/79: % is executable by PUBLIC', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(ro.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/79: % is executable by a managed host''s API role', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('scrbrd_app', 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/79: the application cannot call audit_log()';
  END IF;
  IF has_function_privilege('scrbrd_app', 'audit_person_label(uuid)', 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'audit_names_pupil(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/79: a helper of audit_log() answers the application directly';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'db/79: audit_log() is not SECURITY DEFINER';
  END IF;
  -- The body keeps its promises: the safeguarding cut, the gate on every
  -- source, the log on every call, no free text selected.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure;
  IF position('l.resource NOT LIKE ''safeguarding%''' IN src) = 0 THEN
    RAISE EXCEPTION 'db/79: audit_log() does not cut the safeguarding rows';
  END IF;
  IF position('PERFORM log_restricted_read(''audit_log''' IN src) = 0 THEN
    RAISE EXCEPTION 'db/79: audit_log() does not log its reads';
  END IF;
  IF src ~ '\m[a-z][a-z0-9]*\.(reason|decided_note|note|card|typed|checked|account|lift_reason)\M' THEN
    RAISE EXCEPTION 'db/79: audit_log() selects free text';
  END IF;
  -- The tables it reads, and the predicates it mirrors, are still there.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'access_log'
                    AND policyname = 'access_log_safeguarding_hidden' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/79: access_log_safeguarding_hidden (db/57) is missing';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
         AND tablename IN ('access_log', 'scoring_audit', 'scoring_amendment', 'scorebook_import_revision',
                           'support_access', 'role_assignment_ending')
         AND qual ~ 'app_can\(''audit\.read''') <> 6 THEN
    RAISE EXCEPTION 'db/79: a source no longer admits audit.read under its own policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'duty_suspension'
                    AND policyname = 'duty_suspension_read' AND qual ~ 'app_can\(''user\.role\.assign''') THEN
    RAISE EXCEPTION 'db/79: duty_suspension_read is no longer the office''s';
  END IF;
  -- The mask: a child's name in initials, an adult's whole.
  IF audit_mask_name('Verify Seventynine Child', true) <> 'V S Child'
     OR audit_mask_name('Verify', true) <> 'V'
     OR audit_mask_name('Verify Adult', false) <> 'Verify Adult' THEN
    RAISE EXCEPTION 'db/79: audit_mask_name() does not mask as the overlay does';
  END IF;
END $check$;

-- ══════════════════════════════════════════════════════════════════
--  132 · The pilot's hardening: a finished match stays finished, an
--        appointment only ever narrows, the pen is put down before Finish
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's decisions of 4 November 2026 ("as recommended"),
-- each stated below as the rule this file now holds in the database. Its
-- proof is db/99 §111, one labelled sub-check per rule.
--
-- ══ 1 · A FINISHED MATCH STAYS FINISHED ══════════════════════════════
-- Kameel: "once finished, a match can only move to 'abandoned', logged; it
-- never goes back to live. Corrections still go through amendments."
--   + match_finished_stays_finished()  BEFORE UPDATE OF status on match:
--       from 'complete' the status may move only to 'abandoned'. Any other
--       move — back to live or scheduled — is refused, check_violation,
--       constraint match_finished_stays_finished, for every caller and every
--       route: the fixture route, a definer, psql as the owner. db/33's doors
--       and db/130's finish then mean what they say: a finished match is not
--       scored again, and a change to its record is an amendment.
--   + match_finished_called_off()  AFTER UPDATE OF status: complete →
--       abandoned writes one scoring_audit row, event
--       'finished_match_abandoned', the actor the caller, the head seq of the
--       log it was called off at. audit_log() words it "Called off a
--       finished match".
--   The confirmation lapse (db/114 S4, match_result_confirmation_lapse) is an
--   AFTER trigger on any status change and is untouched: complete →
--   abandoned still lapses a standing confirmation (db/99 §111 (lapse)).
--
-- ══ 2 · AN APPOINTMENT ONLY EVER NARROWS ════════════════════════════
-- Kameel: "a role's dates or fixture: lock them like the role itself, and log
-- every change."
--   ~ role_assignment_revoke_only() (db/01)  db/01's body, and after its two
--       guards a third: the fixture an appointment is for is never moved to
--       another fixture or taken off (an appointment for every fixture may be
--       narrowed to one); valid_until and expires_at are only ever set or
--       brought earlier; valid_from only ever set or moved later. Extending
--       or re-pointing is refused, check_violation, as db/01 refuses a new
--       person or school: make the appointment you meant. When the same
--       update withdraws the appointment, a date it would push later is held
--       where it was, so the paths that end a guardian's role with "until
--       today" (db/08, db/109) never move an earlier end later.
--   + role_assignment_change, and role_assignment_change_logged() AFTER
--       UPDATE on role_assignment: every change to the fixture or a date is
--       one row — the assignment, whose and which role, by whom, when, and
--       the four values before and after. Read under user.role.assign at the
--       assignment's scope, as role_assignment_ending (db/77) is; written by
--       the trigger alone (no write policy, no write grant).
--   ~ audit_log() (db/130)  the role source gains that row, "Changed a
--       role's dates", gated as a grant is (db/80: the reader's own, or
--       user.role.assign at its scope; never under a pad credential); and
--       the scoring source words 'finished_match_abandoned'. Every other line
--       is db/130's (md5 guard).
--
-- ══ 3 · THE PEN IS PUT DOWN BEFORE FINISH ═══════════════════════════
-- Kameel: "refuse 'Finish' while another phone holds the pen, and tell the
-- scorer when a late ball is set aside."
--   ~ match_finalise() (db/130)  after the match is locked, the scoring
--       session is locked too, and a live lease (state active, lease not
--       lapsed) held by a device other than the caller's (app_device_id(),
--       from the signed token) is held_elsewhere: nothing is finished under a
--       scorer who is still writing. The session lock also orders Finish
--       after any batch of balls already past its lease check (that batch
--       holds the same row until it commits), so no ball lands in the log
--       after "Finished the match". Every other line is db/130's.
--   + late_ball_notice()  AFTER INSERT on ball_event_quarantine: a ball set
--       aside at a match that is complete (or called off) raises two notices,
--       once per match while the first is unexpired: to the scorer who sent
--       it (his alone, recipient_id; kind 'system', so a pupil scorer may
--       have it too) and to the home office (school scope, fixture.update:
--       the office, the director of sport, the sports administrator). Each
--       names the fixture by its sides — school and team, as db/114's result
--       notices do — and never a child, his figures or the ball. If a notice
--       cannot be written, the ball is still set aside and the server's log
--       says so (RAISE WARNING with the SQLSTATE); a notice never costs a
--       ball.
--   The pad's own Finish waits on its outbox (apps/web, finishMatch.jsx):
--   no SQL here.
--
-- ══ 4 · THE SMALLER RULES ═══════════════════════════════════════════
--   * app_can() is the application's alone: EXECUTE revoked from PUBLIC and a
--     managed host's anon, authenticated and service_role; granted to
--     scrbrd_app. Its body is not touched, so app_can_but_player() (db/129)
--     stays its copy bar one line (db/99 §106 (copy)). The generator's next
--     decision-function file emits the same grant (generate-rls.mjs).
--   * Johannesburg's day: app_can(), public_name_live_link() and
--     result_confirm_platform() already read sa_today() (db/128). Nothing to
--     move; §111 (day) holds them there.
--   * A withdrawn team post: news_post_withdraw() clears published_at, and
--     news_post_read_team_wide (db/131) reads only a sent post, so a
--     withdrawn one reaches no spectator. No change; §111 (withdrawn) proves it.
--   ~ An abandoned match is not scored: scoring_claim(), scoring_takeover()
--     (db/126), scoring_claim_handover(), scoring_lease_check() (db/33) and
--     scoring_verify_takeover() (db/45) refuse a called-off match as they
--     refuse a finished one, with the word match_abandoned; a ball sent at
--     one goes to quarantine. Every other line is the shipped body's.
--   ~ result_confirm_platform() (db/128 over db/114): "platform" is now a
--     scope, not a role name: every live assignment of the caller's that
--     grants result.confirm names no school and grants a platform-only
--     capability (capability.platform_only). The owner's key reads
--     "platform" as before; a league organiser appointed with no school
--     still reads "organiser".
--   ~ audit_fixture_label() (db/79): the away side is the platform's own
--     label of it when it is on SCRBRD (fixture_side_label()), else the typed
--     opponent, else "an opponent": never a NULL, so a shared fixture is named
--     in the audit log. Today match_away_side_is_named (db/08) stamps that
--     label into opponent on every write, so the label already read right;
--     the body no longer rests on the stamp.
--   * fixture_sheet() (db/131): saved = shown is Kameel's decision (4 Nov
--     2026). Its comment now says so in those words; the function is not
--     touched.
--
-- WHO MAY CALL WHAT (every definer here pins its search_path)
--   match_finalise(uuid), scoring_claim(uuid,text), scoring_takeover(uuid,text,integer),
--   scoring_claim_handover(uuid,text,text), scoring_lease_check(uuid,text,integer),
--   scoring_verify_takeover(uuid,text,integer,integer,integer), audit_log(…),
--   app_can(text,uuid,text,uuid,uuid)            scrbrd_app
--   result_confirm_platform(), audit_fixture_label(uuid)
--                                                the owner's helpers, as shipped: nobody
--   match_finished_stays_finished(), match_finished_called_off(),
--   role_assignment_change_log(), late_ball_notice()
--                                                triggers: nobody
-- And none to PUBLIC, nor to a managed host's anon, authenticated or
-- service_role.
--
-- EXISTING ROWS. Nothing changed or deleted. One table created, empty.
-- Safe to run twice: CREATE OR REPLACE (functions and triggers), CREATE
-- TABLE IF NOT EXISTS, a policy created only when missing, and grants that
-- end where they began. Nothing is dropped (the paste tool hangs on DROP).
--
-- SCHEMA FIRST. The API built with it reads held_elsewhere and
-- match_abandoned, and maps the new refusal; this file goes before it and is
-- in services/api/expected-migrations.json.


-- ── 0 · What it needs, and what it replaces ────────────────────────
DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regclass('scoring_audit') IS NULL OR to_regclass('scoring_session') IS NULL
     OR to_regclass('ball_event_quarantine') IS NULL OR to_regclass('notification') IS NULL
     OR to_regclass('role_assignment_ending') IS NULL OR to_regclass('news_post') IS NULL
     OR to_regprocedure('fixture_sheet(uuid)') IS NULL
     OR to_regprocedure('fixture_side_label(uuid,text)') IS NULL
     OR to_regprocedure('app_device_id()') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('pad_scope_guard_install(regclass)') IS NULL
     OR to_regprocedure('role_words(text)') IS NULL OR to_regprocedure('sa_today()') IS NULL THEN
    RAISE EXCEPTION 'db/132: the finish (db/130), the sheet (db/131), the pad guard (db/50), the audit log (db/79, db/80) or the SA day (db/08) is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('role_assignment_revoke_only()',                               'b08f57fa05f81a9ae1bce47c7cdf651e', '2b5af14563d406167228bac1536505b2',    'db/01'),
      ('scoring_claim(uuid,text)',                                    '4ff22013b983402bd7c68883cfe1a97b', 'fdbb6a42742fb460c957ac767d0d40ad',     'db/126'),
      ('scoring_takeover(uuid,text,integer)',                         '762c573b37ccfef1fc26732b8f92f33f', '5fc8557d772fec006045ba78324ca486',  'db/126'),
      ('scoring_claim_handover(uuid,text,text)',                      '25f59befd49a03f8d9ab1beaff1849ac', '1c8ebbea34816d5b37fa983e275ead09',  'db/33'),
      ('scoring_lease_check(uuid,text,integer)',                      '7c371d47d9054c6cd2595303e32f6913', 'be2771f4c1439edc201f792c70d9c3e3',     'db/33'),
      ('scoring_verify_takeover(uuid,text,integer,integer,integer)',  'b7f4bd747453e5f6b0e12055d63dde24', '6499880df4581290fb527dd4a5eca169',    'db/45'),
      ('match_finalise(uuid)',                                        'de8bd9dc838f5c489b9a7034200c962f', 'e2725409453e7e3d898402645cb8896c',  'db/130'),
      ('result_confirm_platform()',                                   '70d74fa6b013d7cf9bbf5031f1b80e31', 'ccdb5bd7b9dad9767658025a17cc8418',  'db/128'),
      ('audit_fixture_label(uuid)',                                   '06b10a4e83996bbc16432a836c2e9b54', 'b84a1dd71916204239e129fa0fd5b48b',     'db/79'),
      ('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)', 'f19c41322aa5c63846f827d49b960884', '8bea03eaac74fbfc54900f40c5d9e7f1',     'db/130'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/132: % (%) is not there to re-create', r.fn, r.src;
    END IF;
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/132: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
--  1 · A finished match stays finished
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION match_finished_stays_finished() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'complete' AND NEW.status IS DISTINCT FROM 'complete' AND NEW.status IS DISTINCT FROM 'abandoned' THEN
    RAISE EXCEPTION 'a finished match is not reopened: it may only be called off; a correction to it is an amendment'
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'match', CONSTRAINT = 'match_finished_stays_finished';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER match_finished_stays_finished BEFORE UPDATE OF status ON match
  FOR EACH ROW WHEN (OLD.status = 'complete' AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION match_finished_stays_finished();

-- Calling a finished match off is on the record, by whom, at which ball.
CREATE OR REPLACE FUNCTION match_finished_called_off() RETURNS trigger AS $$
BEGIN
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, detail)
  VALUES (NEW.id, NEW.school_id, 'finished_match_abandoned', app_user_id(),
          jsonb_build_object('from', OLD.status, 'to', NEW.status,
                             'headSeq', coalesce((SELECT max(b.seq) FROM ball_event b WHERE b.match_id = NEW.id), 0)));
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER match_finished_called_off AFTER UPDATE OF status ON match
  FOR EACH ROW WHEN (OLD.status = 'complete' AND NEW.status = 'abandoned')
  EXECUTE FUNCTION match_finished_called_off();


-- ══════════════════════════════════════════════════════════════════
--  2 · An appointment only ever narrows, and every change is on the record
-- ══════════════════════════════════════════════════════════════════
-- db/01's body; the third guard (the fixture and the dates) is new, marked.
CREATE OR REPLACE FUNCTION role_assignment_revoke_only() RETURNS trigger AS $$
BEGIN
  IF NEW.person_id IS DISTINCT FROM OLD.person_id
  OR NEW.role      IS DISTINCT FROM OLD.role
  OR NEW.school_id IS DISTINCT FROM OLD.school_id
  OR NEW.team_code IS DISTINCT FROM OLD.team_code THEN
    RAISE EXCEPTION 'an assignment may be deactivated, not re-pointed; '
                    'withdraw this one and make the appointment you meant'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The provenance is part of the record, not part of the row's editable
  -- state. Letting an update move created_by would make the audit trail
  -- writable by the people it is about.
  IF NEW.created_by IS DISTINCT FROM OLD.created_by
  OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'who made an appointment and when are not editable'
      USING ERRCODE = 'check_violation';
  END IF;
  -- db/132: the fixture and the dates are the appointment too. Withdrawn in
  -- the same update, a date that would move the wrong way is held where it
  -- was; otherwise one that widens is refused.
  IF OLD.active AND NOT NEW.active THEN
    IF OLD.valid_until IS NOT NULL AND (NEW.valid_until IS NULL OR NEW.valid_until > OLD.valid_until) THEN
      NEW.valid_until := OLD.valid_until;
    END IF;
    IF OLD.expires_at IS NOT NULL AND (NEW.expires_at IS NULL OR NEW.expires_at > OLD.expires_at) THEN
      NEW.expires_at := OLD.expires_at;
    END IF;
    IF OLD.valid_from IS NOT NULL AND (NEW.valid_from IS NULL OR NEW.valid_from < OLD.valid_from) THEN
      NEW.valid_from := OLD.valid_from;
    END IF;
  END IF;
  IF OLD.fixture_id IS NOT NULL AND NEW.fixture_id IS DISTINCT FROM OLD.fixture_id THEN
    RAISE EXCEPTION 'an appointment for one fixture is not moved to another or widened to every fixture; '
                    'withdraw this one and make the appointment you meant'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.valid_until IS NOT NULL AND (NEW.valid_until IS NULL OR NEW.valid_until > OLD.valid_until))
  OR (OLD.expires_at  IS NOT NULL AND (NEW.expires_at  IS NULL OR NEW.expires_at  > OLD.expires_at))
  OR (OLD.valid_from  IS NOT NULL AND (NEW.valid_from  IS NULL OR NEW.valid_from  < OLD.valid_from)) THEN
    RAISE EXCEPTION 'an appointment''s dates may be ended or shortened, never extended; '
                    'make a new appointment for the longer time'
      USING ERRCODE = 'check_violation';
  END IF;
  -- WITHDRAWING CARRIES A NAME TOO, stamped here rather than supplied. The
  -- gap this closes is the mirror of the one below: an appointment could be
  -- taken back and the row would not say by whom.
  IF OLD.active AND NOT NEW.active THEN
    NEW.revoked_by := app_user_id();
    NEW.revoked_at := now();
  ELSIF NOT OLD.active AND NEW.active THEN
    -- Reactivating is a new appointment wearing an old one's provenance. The
    -- policy already only permits the true-to-false direction; this is the
    -- structural half.
    RAISE EXCEPTION 'a withdrawn assignment is not reactivated; make the appointment again'
      USING ERRCODE = 'check_violation';
  ELSE
    NEW.revoked_by := OLD.revoked_by;
    NEW.revoked_at := OLD.revoked_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

-- One row per change to an appointment's fixture or dates.
CREATE TABLE IF NOT EXISTS role_assignment_change (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES role_assignment(id) ON DELETE CASCADE,
  person_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role          text NOT NULL,
  school_id     uuid REFERENCES school(id) ON DELETE CASCADE,
  team_code     text,
  changed_by    uuid REFERENCES app_user(id),
  changed_at    timestamptz NOT NULL DEFAULT now(),
  was           jsonb NOT NULL,
  became        jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS role_assignment_change_school_idx ON role_assignment_change (school_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS role_assignment_change_assignment_idx ON role_assignment_change (assignment_id);

ALTER TABLE role_assignment_change ENABLE ROW LEVEL SECURITY;
DO $change_read$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'role_assignment_change'
                    AND policyname = 'role_assignment_change_read') THEN
    CREATE POLICY role_assignment_change_read ON role_assignment_change
      FOR SELECT USING (app_can('user.role.assign', school_id, team_code, NULL, NULL));
  END IF;
END $change_read$;
SELECT pad_scope_guard_install('role_assignment_change'::regclass);
GRANT SELECT ON role_assignment_change TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON role_assignment_change FROM scrbrd_app;

CREATE OR REPLACE FUNCTION role_assignment_change_log() RETURNS trigger AS $$
BEGIN
  INSERT INTO role_assignment_change (assignment_id, person_id, role, school_id, team_code, changed_by, was, became)
  VALUES (NEW.id, NEW.person_id, NEW.role, NEW.school_id, NEW.team_code, app_user_id(),
          jsonb_build_object('fixture', OLD.fixture_id, 'from', OLD.valid_from, 'until', OLD.valid_until, 'expires', OLD.expires_at),
          jsonb_build_object('fixture', NEW.fixture_id, 'from', NEW.valid_from, 'until', NEW.valid_until, 'expires', NEW.expires_at));
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER role_assignment_change_logged AFTER UPDATE ON role_assignment
  FOR EACH ROW WHEN (OLD.fixture_id  IS DISTINCT FROM NEW.fixture_id
                  OR OLD.valid_from  IS DISTINCT FROM NEW.valid_from
                  OR OLD.valid_until IS DISTINCT FROM NEW.valid_until
                  OR OLD.expires_at  IS DISTINCT FROM NEW.expires_at)
  EXECUTE FUNCTION role_assignment_change_log();

-- db/130's audit_log(), with two lines added (marked db/132): the scoring
-- source words a finished match called off, and the role source reads
-- role_assignment_change.
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
                 WHEN 'finished_match_abandoned' THEN 'Called off a finished match'   -- db/132
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
        -- role_assignment_change (db/132): an appointment's fixture or dates
        -- changed, by whom, before and after; gated as a grant is.
        SELECT c.changed_at, 'role',
               'Changed a role''s dates: ' || role_words(c.role) || coalesce(' (' || c.team_code || ')', ''),
               c.changed_by, NULL, c.person_id, NULL, NULL, NULL, NULL, c.school_id,
               jsonb_build_object('role', c.role, 'team', c.team_code, 'was', c.was, 'became', c.became),
               'role:' || c.assignment_id::text || ':changed:' || c.id::text
          FROM role_assignment_change c
         WHERE 'role' = ANY (v_kinds) AND c.school_id = p_school
           AND NOT app_pad_scoped()
           AND (c.person_id = v_me OR app_can('user.role.assign', c.school_id, c.team_code, NULL, NULL))
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


-- ══════════════════════════════════════════════════════════════════
--  3 · The pen is put down before Finish; a late ball is told
-- ══════════════════════════════════════════════════════════════════
-- db/130's, with step 3b (marked db/132).
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
  -- 3b. db/132: another phone holds the pen. The session row is locked, as
  --     the live path's lease check locks it, so a batch already past its
  --     check commits first; then a live lease on a device that is not the
  --     caller's refuses: its scorer may still be writing.
  PERFORM 1 FROM scoring_session s WHERE s.match_id = p_match FOR UPDATE;
  IF EXISTS (SELECT 1 FROM scoring_session s
              WHERE s.match_id = p_match AND s.state = 'active' AND s.lease_until > now()
                AND s.holder_device IS DISTINCT FROM app_device_id()) THEN
    RETURN QUERY SELECT false, 'held_elsewhere'::text; RETURN;
  END IF;
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

-- A ball set aside at a finished (or called-off) match: the scorer who sent
-- it is told, and so is the home office. Once per match and reader while the
-- first notice stands. The fixture is named by its sides; no child, no ball.
CREATE OR REPLACE FUNCTION late_ball_notice() RETURNS trigger AS $$
DECLARE
  m       match%ROWTYPE;
  v_title text;
  v_body  text;
  v_life  timestamptz := now() + interval '7 days';
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = NEW.match_id;
  IF NOT FOUND OR m.status NOT IN ('complete', 'abandoned') THEN RETURN NULL; END IF;
  v_title := 'Late ball set aside · '
             || coalesce(fixture_side_label(m.school_id, m.team_code), m.team_code, 'Home') || ' v '
             || coalesce(fixture_side_label(m.away_school_id, m.away_team_code), m.opponent, 'Away');
  v_body := 'A ball reached the server after the match was '
            || CASE m.status WHEN 'complete' THEN 'finished' ELSE 'called off' END
            || '. It was set aside, not added to the scorecard. Someone who approves amendments for the side reviews it.';
  BEGIN
    -- The scorer who sent it: his alone.
    IF NOT EXISTS (SELECT 1 FROM notification n
                    WHERE n.subject_kind = 'match' AND n.subject_id = m.id AND n.recipient_id = NEW.scorer_user_id
                      AND n.title = v_title AND n.retracted_at IS NULL AND (n.expires_at IS NULL OR n.expires_at > now())) THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, recipient_id, expires_at)
      VALUES (m.school_id, NULL, 'school', 'system', 'medium', v_title, v_body,
              'news.read', false, 'match', m.id, NEW.scorer_user_id, v_life);
    END IF;
    -- The home office: the school, under fixture.update.
    IF NOT EXISTS (SELECT 1 FROM notification n
                    WHERE n.subject_kind = 'match' AND n.subject_id = m.id AND n.recipient_id IS NULL
                      AND n.title = v_title AND n.retracted_at IS NULL AND (n.expires_at IS NULL OR n.expires_at > now())) THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, expires_at)
      VALUES (m.school_id, NULL, 'school', 'fixture', 'medium', v_title, v_body,
              'fixture.update', false, 'match', m.id, v_life);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The ball is set aside whatever happens to its notice; the server's
    -- log says the notice was not raised.
    RAISE WARNING 'db/132: the late-ball notice for match % was not raised (SQLSTATE %)', NEW.match_id, SQLSTATE;
  END;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER late_ball_notice AFTER INSERT ON ball_event_quarantine
  FOR EACH ROW EXECUTE FUNCTION late_ball_notice();


-- ══════════════════════════════════════════════════════════════════
--  4 · An abandoned match is not scored (db/33's doors)
-- ══════════════════════════════════════════════════════════════════
-- Each is the shipped body, with its completion test widened to a called-off
-- match (marked db/132).
CREATE OR REPLACE FUNCTION scoring_claim(p_match uuid, p_device text)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  IF p_device IS NULL OR btrim(p_device) = ''
    THEN RETURN QUERY SELECT false,'no_device',NULL::int; RETURN; END IF;
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::int; RETURN; END IF;
  -- Completion ends scoring, for everyone (db/33). Corrections are amendments.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'complete')
    THEN RETURN QUERY SELECT false,'match_complete',
                             (SELECT x.epoch FROM scoring_session x WHERE x.match_id = p_match);
         RETURN; END IF;
  -- db/132: so does calling it off.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'abandoned')
    THEN RETURN QUERY SELECT false,'match_abandoned',
                             (SELECT x.epoch FROM scoring_session x WHERE x.match_id = p_match);
         RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO scoring_session (match_id, school_id, state, epoch, holder_user_id, holder_device, lease_until)
    VALUES (p_match, match_school(p_match), 'active', 1, app_user_id(), p_device, now() + interval '90 seconds');
    INSERT INTO scoring_audit (match_id, school_id, event, actor_id, epoch)
    VALUES (p_match, match_school(p_match), 'claim', app_user_id(), 1);
    RETURN QUERY SELECT true, NULL::text, 1; RETURN;
  END IF;
  -- Someone else holds a live lease → refuse (use force_release instead).
  IF s.state = 'active' AND s.lease_until > now() AND s.holder_device IS DISTINCT FROM p_device THEN
    RETURN QUERY SELECT false,'lease_active', s.epoch; RETURN;
  END IF;
  -- Another device held it, and its lease has lapsed (db/126): not an idle
  -- match. Taking it is a person's confirmed act, scoring_takeover().
  IF s.state = 'active' AND s.holder_device IS NOT NULL AND s.holder_device IS DISTINCT FROM p_device THEN
    RETURN QUERY SELECT false,'held_elsewhere', s.epoch; RETURN;
  END IF;
  -- A handover is armed → the incoming scorer enters the code; nobody else
  -- claims past it. The arming device and user may take it back: that is the
  -- client's cancel. IS DISTINCT FROM, so a NULL on either side refuses.
  IF s.state = 'handover_pending'
     AND (s.holder_device IS DISTINCT FROM p_device OR s.holder_user_id IS DISTINCT FROM app_user_id()) THEN
    RETURN QUERY SELECT false,'handover_pending', s.epoch; RETURN;
  END IF;
  -- A handover is mid-verification → nobody claims past it, the outgoing
  -- device included, lease or no lease. Force-release once the lease lapses.
  IF s.state = 'verifying' THEN
    RETURN QUERY SELECT false,'verifying', s.epoch; RETURN;
  END IF;
  UPDATE scoring_session SET
    state='active', epoch = s.epoch + 1, holder_user_id = app_user_id(),
    holder_device = p_device, lease_until = now() + interval '90 seconds',
    handover_code = NULL, handover_to = NULL, claimant_user_id = NULL,
    claimant_device = NULL, updated_at = now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, epoch)
  VALUES (p_match, match_school(p_match), 'claim', app_user_id(), s.epoch + 1);
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION scoring_takeover(p_match uuid, p_device text, p_epoch integer)
RETURNS TABLE (ok boolean, reason text, epoch integer) AS $$
DECLARE s scoring_session%ROWTYPE; v_at timestamptz; v_seq bigint;
BEGIN
  -- A resume credential never takes over (db/50: it claims back only its own).
  IF app_pad_scoped() THEN RETURN QUERY SELECT false,'not_permitted',NULL::int; RETURN; END IF;
  IF p_device IS NULL OR btrim(p_device) = ''
    THEN RETURN QUERY SELECT false,'no_device',NULL::int; RETURN; END IF;
  -- Capability first, as scoring_claim() asks it: no standing, nothing learnt.
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::int; RETURN; END IF;
  -- db/132: a called-off match is answered as a finished one, by the claim.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status IN ('complete', 'abandoned'))
    THEN RETURN QUERY SELECT c.ok, c.reason, c.epoch FROM scoring_claim(p_match, p_device) c; RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF NOT FOUND OR s.state <> 'active' OR s.holder_device IS NULL
     OR s.holder_device IS NOT DISTINCT FROM p_device OR s.lease_until > now() THEN
    -- Not held elsewhere on a lapsed lease: an ordinary claim's answer,
    -- lease_active included.
    RETURN QUERY SELECT c.ok, c.reason, c.epoch FROM scoring_claim(p_match, p_device) c; RETURN;
  END IF;
  -- The person confirmed a take-over of THIS generation. Another claim since
  -- is something they have not seen.
  IF p_epoch IS DISTINCT FROM s.epoch THEN
    RETURN QUERY SELECT false,'epoch_moved', s.epoch; RETURN;
  END IF;
  -- The server's last ball as it stood at the take-over: max(server_ts),
  -- the figure match_live_score.last_ball_at reports, read here over every
  -- row whatever the caller may read (SECURITY DEFINER).
  SELECT max(b.server_ts), max(b.seq) INTO v_at, v_seq FROM ball_event b WHERE b.match_id = p_match AND b.kind = 'ball';
  UPDATE scoring_session SET
    state='active', epoch = s.epoch + 1, holder_user_id = app_user_id(),
    holder_device = p_device, lease_until = now() + interval '90 seconds',
    handover_code = NULL, handover_to = NULL, claimant_user_id = NULL,
    claimant_device = NULL, updated_at = now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, to_user, epoch, detail)
  VALUES (p_match, match_school(p_match), 'takeover', app_user_id(), s.holder_user_id, app_user_id(), s.epoch + 1,
          jsonb_build_object('from_device', s.holder_device, 'to_device', p_device,
                             'lease_lapsed_at', s.lease_until, 'last_ball_at', v_at, 'last_seq', v_seq));
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION scoring_claim_handover(p_match uuid, p_device text, p_code text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  -- Capability against THIS match, from assignments — see db/01 and ADR 0001.
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match) THEN
    RETURN QUERY SELECT false, 'no_capability'; RETURN;
  END IF;
  -- Completion ends scoring (db/33): there is nothing left to hand over.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'complete') THEN
    RETURN QUERY SELECT false, 'match_complete'; RETURN;
  END IF;
  -- db/132: nor on a match called off.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'abandoned') THEN
    RETURN QUERY SELECT false, 'match_abandoned'; RETURN;
  END IF;

  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF s.state <> 'handover_pending' THEN
    RETURN QUERY SELECT false, 'not_pending'; RETURN;
  END IF;
  IF s.handover_code IS DISTINCT FROM p_code THEN
    RETURN QUERY SELECT false, 'verify_mismatch'; RETURN;   -- wrong code
  END IF;
  -- Optional pre-authorisation: if handover_to was set, only that user may claim.
  IF s.handover_to IS NOT NULL AND s.handover_to <> app_user_id() THEN
    RETURN QUERY SELECT false, 'no_capability'; RETURN;
  END IF;

  UPDATE scoring_session
     SET state = 'verifying',
         claimant_user_id = app_user_id(),
         claimant_device  = p_device,
         updated_at = now()
   WHERE match_id = p_match;

  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, epoch)
  VALUES (p_match, match_school(p_match), 'handover_claimed', app_user_id(), s.epoch);

  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION scoring_lease_check(p_match uuid, p_device text, p_epoch integer)
RETURNS TABLE (found boolean, holds boolean, epoch integer, state text) AS $$
DECLARE s scoring_session%ROWTYPE;
BEGIN
  IF NOT app_can('scoring.edit', match_school(p_match), match_team(p_match), NULL, p_match) THEN
    RAISE EXCEPTION 'no scoring capability for this match'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The lock is still taken first: the write path relies on this call to
  -- serialise a match's writes, refused or not.
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;

  -- Completion ends scoring (db/33): no lease is extended over a finished
  -- match, so every ball sent at one goes to quarantine, not into the log.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'complete') THEN
    RETURN QUERY SELECT (s.match_id IS NOT NULL), false, s.epoch, 'match_complete'::text; RETURN;
  END IF;
  -- db/132: nor over a match called off.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'abandoned') THEN
    RETURN QUERY SELECT (s.match_id IS NOT NULL), false, s.epoch, 'match_abandoned'::text; RETURN;
  END IF;

  IF s.match_id IS NULL THEN
    RETURN QUERY SELECT false, false, NULL::integer, NULL::text; RETURN;
  END IF;

  IF s.state = 'active' AND s.epoch = p_epoch
     AND s.holder_user_id = app_user_id() AND s.holder_device = p_device
     AND s.lease_until > now() THEN
    UPDATE scoring_session
       SET lease_until = now() + interval '90 seconds', updated_at = now()
     WHERE match_id = p_match;
    RETURN QUERY SELECT true, true, s.epoch, s.state::text; RETURN;
  END IF;

  RETURN QUERY SELECT true, false, s.epoch, s.state::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION scoring_verify_takeover(p_match uuid, p_device text, p_runs integer, p_wickets integer, p_balls integer)
RETURNS TABLE (ok boolean, reason text, epoch integer, exp_runs integer, exp_wkts integer, exp_balls integer) AS $$
DECLARE s scoring_session%ROWTYPE; t_inn smallint; t_runs int; t_wkts int; t_balls int;
BEGIN
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;
  -- Completion ends scoring (db/33): a takeover would hand a live token over
  -- a finished match.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'complete')
    THEN RETURN QUERY SELECT false,'match_complete',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;
  -- db/132: or over a match called off.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'abandoned')
    THEN RETURN QUERY SELECT false,'match_abandoned',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF s.state <> 'verifying' OR s.claimant_device IS DISTINCT FROM p_device
    THEN RETURN QUERY SELECT false,'not_pending',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;

  -- What the scoreboard shows: the innings being played, counted as the
  -- incoming device's fold counts it — the free hit (db/42), a retirement
  -- (db/40), a ball with no type (db/43) and penalty runs (db/45).
  t_inn := match_current_innings(p_match);
  SELECT f.runs, f.wickets, f.legal_balls INTO t_runs, t_wkts, t_balls
    FROM innings_score_as_folded(p_match, t_inn) f;

  IF (p_runs, p_wickets, p_balls) IS DISTINCT FROM (t_runs, t_wkts, t_balls) THEN
    INSERT INTO scoring_audit (match_id, school_id, event, actor_id, detail)
    VALUES (p_match, match_school(p_match), 'handover_verify_failed', app_user_id(),
            jsonb_build_object('got',jsonb_build_object('runs',p_runs,'wkts',p_wickets,'balls',p_balls),
                               'expected',jsonb_build_object('runs',t_runs,'wkts',t_wkts,'balls',t_balls),
                               'innings',t_inn));
    RETURN QUERY SELECT false,'verify_mismatch',NULL::int, t_runs, t_wkts, t_balls; RETURN;
  END IF;

  UPDATE scoring_session SET state='active', epoch = s.epoch + 1,
    holder_user_id = s.claimant_user_id, holder_device = s.claimant_device,
    lease_until = now() + interval '90 seconds',
    handover_code=NULL, handover_to=NULL, claimant_user_id=NULL, claimant_device=NULL, updated_at=now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, to_user, epoch)
  VALUES (p_match, match_school(p_match), 'handover_complete', app_user_id(), s.holder_user_id, s.claimant_user_id, s.epoch + 1);
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1, t_runs, t_wkts, t_balls;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  5 · The smaller rules
-- ══════════════════════════════════════════════════════════════════
-- "Platform" is a scope: every result.confirm the caller holds is on an
-- assignment naming no school whose role grants a platform-only capability.
CREATE OR REPLACE FUNCTION result_confirm_platform() RETURNS boolean AS $$
  WITH confirms AS (
    SELECT a.school_id IS NULL
           AND EXISTS (SELECT 1 FROM role_capability pc JOIN capability c ON c.name = pc.capability
                        WHERE pc.role = a.role AND c.platform_only) AS platform
      FROM role_assignment a
      JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'result.confirm'
     WHERE a.person_id = app_user_id() AND a.active
       AND (a.valid_from IS NULL OR a.valid_from <= sa_today())
       AND (a.valid_until IS NULL OR a.valid_until > sa_today())
       AND (a.expires_at IS NULL OR a.expires_at > now()))
  SELECT coalesce(bool_and(platform), false) FROM confirms
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The away side as the platform names it when it is on SCRBRD; never NULL.
CREATE OR REPLACE FUNCTION audit_fixture_label(p_match uuid) RETURNS text AS $$
  SELECT coalesce(fixture_side_label(m.school_id, m.team_code), 'A fixture') || ' v '
         || coalesce(fixture_side_label(m.away_school_id, m.away_team_code), m.opponent, 'an opponent')
         || ' · ' || to_char(m.starts_at AT TIME ZONE 'Africa/Johannesburg', 'FMDD Mon YYYY')
    FROM match m WHERE m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

COMMENT ON FUNCTION fixture_sheet(uuid) IS
  'REACH R-H (db/131; STEP4 Q10, Kameel 27 Sep 2026; 4 Nov 2026): a fixture''s team sheet as names and order — side, batting_no, twelfth, name; never a player_id — for each end whose live sheet holds a boy whose family (a live, verified link) or who himself is the caller, or to the side''s staff (an unnamed assignment, not a pupil''s, with player.profile.read there). Saved = shown, Kameel''s decision of 4 Nov 2026: match_squad has no publish step, so the sheet reaches the families when the coach saves it, as it reaches the pupils. A spectator, a team-mate off the sheet and a named enquiry grant read nothing.';


-- ══════════════════════════════════════════════════════════════════
--  Who may call what
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  -- The doors: the application's alone.
  FOREACH f IN ARRAY ARRAY['app_can(text,uuid,text,uuid,uuid)', 'match_finalise(uuid)',
                           'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
                           'scoring_claim(uuid,text)', 'scoring_takeover(uuid,text,integer)',
                           'scoring_claim_handover(uuid,text,text)', 'scoring_lease_check(uuid,text,integer)',
                           'scoring_verify_takeover(uuid,text,integer,integer,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  -- The owner's helpers and the triggers: nobody's.
  FOREACH f IN ARRAY ARRAY['result_confirm_platform()', 'audit_fixture_label(uuid)',
                           'match_finished_stays_finished()', 'match_finished_called_off()',
                           'role_assignment_change_log()', 'late_ball_notice()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  -- The new table: read through its policy, written by its trigger alone.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON role_assignment_change FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
--  What this file promised, checked in the same paste
-- ══════════════════════════════════════════════════════════════════
-- The behaviour is asserted live in db/99 §111.
DO $check$
DECLARE f text; r text; src text;
BEGIN
  FOREACH f IN ARRAY ARRAY['app_can(text,uuid,text,uuid,uuid)', 'match_finalise(uuid)',
                           'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
                           'scoring_claim(uuid,text)', 'scoring_takeover(uuid,text,integer)',
                           'scoring_claim_handover(uuid,text,text)', 'scoring_lease_check(uuid,text,integer)',
                           'scoring_verify_takeover(uuid,text,integer,integer,integer)',
                           'result_confirm_platform()', 'audit_fixture_label(uuid)',
                           'match_finished_stays_finished()', 'match_finished_called_off()',
                           'role_assignment_change_log()', 'late_ball_notice()'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/132: % is not SECURITY DEFINER', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/132: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/132: % is executable by PUBLIC', f;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.rolname = r AND has_function_privilege(ro.oid, f::regprocedure, 'EXECUTE')) THEN
        RAISE EXCEPTION 'db/132: % is executable by a managed host''s API role (%)', f, r;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_function_privilege('scrbrd_app', 'app_can(text,uuid,text,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'match_finalise(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/132: the application cannot call app_can() or match_finalise()';
  END IF;
  IF has_function_privilege('scrbrd_app', 'audit_fixture_label(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/132: the application can call audit_fixture_label(): it names any fixture';
  END IF;
  -- The role check stays where it was: the second definer may not become
  -- the first's twin by accident (db/99 §106 (copy) holds the bodies).
  IF position('a.role <> ''player''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'app_can_but_player(text,uuid,text,uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/132: app_can_but_player() lost its one line';
  END IF;
  -- The triggers are in place.
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'
        AND ((tgrelid = 'match'::regclass AND tgname IN ('match_finished_stays_finished', 'match_finished_called_off',
                                                         'match_result_confirmation_lapse'))
          OR (tgrelid = 'role_assignment'::regclass AND tgname IN ('role_assignment_revoke_guard', 'role_assignment_change_logged'))
          OR (tgrelid = 'ball_event_quarantine'::regclass AND tgname = 'late_ball_notice'))) <> 6 THEN
    RAISE EXCEPTION 'db/132: a trigger this file relies on is missing or disabled';
  END IF;
  -- The new table is under RLS, written by nobody but its trigger.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'role_assignment_change'::regclass)
     OR has_table_privilege('scrbrd_app', 'role_assignment_change', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'role_assignment_change', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'role_assignment_change', 'DELETE')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'role_assignment_change'
                       AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/132: role_assignment_change is not read-only under RLS with its pad guard';
  END IF;
  -- No role name decides "platform" any more, and no body reads the database's day.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'result_confirm_platform()'::regprocedure;
  IF src ~ 'a\.role\s*(=|<>)' OR src ~* '\mcurrent_date\M' THEN
    RAISE EXCEPTION 'db/132: result_confirm_platform() still tests a role name or the database''s day';
  END IF;
  FOREACH f IN ARRAY ARRAY['app_can(text,uuid,text,uuid,uuid)', 'public_name_live_link(uuid,uuid,text)',
                           'result_confirm_platform()', 'match_finalise(uuid)', 'late_ball_notice()'] LOOP
    IF (SELECT prosrc FROM pg_proc WHERE oid = f::regprocedure) ~* '\mcurrent_date\M' THEN
      RAISE EXCEPTION 'db/132: % reads the database''s day (db/128)', f;
    END IF;
  END LOOP;
END $check$;

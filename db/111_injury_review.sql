-- ══════════════════════════════════════════════════════════════════
--  111 · The physio's injury record, its reviews and her worklist
--        (GA-I19 slice A, with slice C's SG-12 injury half)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, apart from the generated block between the two markers.
-- docs/design/GA-I19_medical_review.md, §3 and §6's slice A and C rows, as
-- decided (Kameel, 2026-10-08: all twelve questions as recommended; Q0 and
-- Q2 confirmed 2026-10-15). Its proof is db/99 §88.
--
-- Until this file a school physio could read every injury at her school and
-- write none of them: medical.write was hers alone and no door used it. Now:
--
--   1. injury gains recorded_by, emergency_services, next_review_on,
--      recurs_injury_id and dso_notified_at, each placed on the tier D3
--      names, and injury_masked is rebuilt so none of them reaches a reader
--      unmasked (MASKED_SINCE_09 in generate-rls.mjs).
--   2. injury_review: one dated row per look, with the state it left the
--      injury in. Its policies and its masked view are the generated block
--      below (TABLES_ADDED_SINCE_09). A support session reads none (Q7).
--   3. Two doors and nothing else: injury_record() and
--      injury_review_record(), SECURITY DEFINER. The application loses
--      INSERT, UPDATE, DELETE and TRUNCATE on both tables, so db/09's injury
--      write policies have no privilege left to grant (D2).
--   4. injury_apply_review(): a review is applied to its injury row by a
--      trigger, which fires notify_injury() exactly as before (D10), and
--      derives player.fitness (D9, Q9).
--   5. injury_worklist(): the physio's list, SECURITY INVOKER, drawn only for
--      a caller holding medical.write over each row (D3, D8).
--   6. injury_serious_watch(): SG-12's injury half (slice C, Q8 yes). A
--      severe injury, or one where emergency services were called, writes
--      the school's DSOs one safeguarding notice naming nobody, once.
--   7. injury_retention_due(): when an injury record falls due for deletion
--      (D11). Nothing deletes in this file; the purge is slice E.
--
-- THE LEGAL BASIS (D6, Q2). The information officer confirmed in writing
-- that injury and injury_review stand under the guardian-link consent (POPIA
-- s 27 read with s 32), not under health_monitoring_consent. So neither door
-- calls health_consent_live(): a boy with no health-monitoring consent can
-- still be recorded as unable to bowl.
--
-- NO NEW CAPABILITY (D12). medical.write gates both doors and the worklist;
-- medical.status/nature/details.read place every new column.
--
-- WHERE THIS IS NARROWER THAN THE DESIGN'S LETTER, and why
--   - "Only medical writes" (D4): app_can('medical.write') also passes for a
--     platform-wide superadmin, whose bundle is every capability. Both doors
--     and the worklist refuse a platform-wide caller, so the clinical record's
--     author is always a physio at the boy's school.
--   - The family refusal (D4, Q6) is is_family_of() and more: any guardian or
--     self link the caller holds or held to the boy that is pending or
--     verified, whatever its dates. is_family_of() reads verified, active
--     links only, so a mother whose link is awaiting the office, or ended on
--     his eighteenth birthday, would otherwise pass. She is still his mother.
--   - injury_review's foreign key holds school_id with injury_id and
--     player_id, so a review's school anchor is always its injury's.
--   - The worklist returns a row only when it has a reason; an open injury
--     reviewed recently and not yet due is on the Injuries screen, not here.
--   - player.fitness: the trigger never writes 'unavailable', and leaves it
--     in place when no injury is open (D9: "left for the seed and a future
--     non-injury reason").
--   - SG-12's UPDATE arm fires when severity BECOMES severe or emergency
--     services BECOMES true; a row that was already serious before this file
--     ran writes no notice on a later edit.
--
-- search_path is pinned on every function below (db/16). Every function the
-- application calls is granted to scrbrd_app only and taken back from PUBLIC
-- and from a managed host's API roles. Safe to run twice.


-- ── 1 · The injury row's new columns (§3) ──────────────────────────
-- All nullable or defaulted: the rows already stored (the seed's three on a
-- fresh install) predate them, and nothing here rewrites a clinical record.
ALTER TABLE injury ADD COLUMN IF NOT EXISTS recorded_by        uuid REFERENCES app_user(id);
ALTER TABLE injury ADD COLUMN IF NOT EXISTS emergency_services boolean NOT NULL DEFAULT false;
ALTER TABLE injury ADD COLUMN IF NOT EXISTS next_review_on     date;
ALTER TABLE injury ADD COLUMN IF NOT EXISTS recurs_injury_id   uuid REFERENCES injury(id);
ALTER TABLE injury ADD COLUMN IF NOT EXISTS dso_notified_at    timestamptz;

COMMENT ON COLUMN injury.recorded_by IS
  'Who recorded the injury through injury_record() (GA-I19 D2). NULL on rows written before db/111. medical.details.read.';
COMMENT ON COLUMN injury.emergency_services IS
  'Whether emergency services were called. SG-12''s second condition (db/111). medical.nature.read.';
COMMENT ON COLUMN injury.next_review_on IS
  'When the physio next sees him, set by the latest review; NULL once cleared. Enforced by the doors, not a CHECK: older rows predate it. medical.nature.read.';
COMMENT ON COLUMN injury.recurs_injury_id IS
  'An earlier, cleared injury of the same boy''s that this one is a recurrence of (D2: a cleared injury is not reopened).';
COMMENT ON COLUMN injury.dso_notified_at IS
  'When SG-12''s notice went to the school''s DSOs about this injury; the once-guard (db/111). medical.details.read.';

-- The composite key a review's foreign key holds to: a review names one
-- injury, of one boy, at one school, and cannot name another child's.
DO $key$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'injury'::regclass AND conname = 'injury_id_player_school_key') THEN
    ALTER TABLE injury ADD CONSTRAINT injury_id_player_school_key UNIQUE (id, player_id, school_id);
  END IF;
END $key$;


-- ── 2 · The review (§3) ────────────────────────────────────────────
-- One row per look. The recording itself is the first (D2: one shape). Never
-- updated and never deleted by anybody but the owner; the state it records
-- is the state the injury was left in, so the rows ARE the history.
CREATE TABLE IF NOT EXISTS injury_review (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  -- Denormalised for the anchors (viaPlayer), held to the injury's by the key below.
  player_id        uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  injury_id        uuid NOT NULL,
  reviewed_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_by      uuid NOT NULL REFERENCES app_user(id),
  phase_after      text NOT NULL CHECK (phase_after IN ('active', 'rehab', 'cleared')),
  restricted_after boolean NOT NULL,
  rtw_date_after   date,
  next_review_on   date,
  -- The physio's words: the clinical sub-phase lives here (D7, Q11).
  note             text CHECK (note IS NULL OR btrim(note) <> ''),
  FOREIGN KEY (injury_id, player_id, school_id) REFERENCES injury (id, player_id, school_id) ON DELETE CASCADE,
  -- Q10: a next review is named on every review that does not clear him,
  -- and on none that does.
  CONSTRAINT injury_review_next_review CHECK ((phase_after = 'cleared') = (next_review_on IS NULL)),
  -- A boy cleared to play is not restricted.
  CONSTRAINT injury_review_cleared_unrestricted CHECK (phase_after <> 'cleared' OR NOT restricted_after)
);
CREATE INDEX IF NOT EXISTS injury_review_injury ON injury_review (injury_id, reviewed_at);
CREATE INDEX IF NOT EXISTS injury_review_player ON injury_review (player_id);
CREATE INDEX IF NOT EXISTS injury_review_school ON injury_review (school_id);

COMMENT ON TABLE injury_review IS
  'A physio''s dated look at one injury and the state it left it in (GA-I19 D1, D2). Written by injury_record() and injury_review_record() alone; read through injury_review_masked, tier by tier (D3); hidden from a support session (Q7).';

-- ┌── GENERATED from packages/policy/src/tables.mjs by services/api/rls/generate-rls.mjs (TABLES_ADDED_SINCE_09). DO NOT EDIT BY HAND; `pnpm rls:generate` rewrites it.

-- injury_review — read: medical.status.read · write: medical.write
ALTER TABLE injury_review ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS injury_review_read   ON injury_review;
DROP POLICY IF EXISTS injury_review_insert ON injury_review;
DROP POLICY IF EXISTS injury_review_update ON injury_review;
DROP POLICY IF EXISTS injury_review_delete ON injury_review;

CREATE POLICY injury_review_read ON injury_review
  FOR SELECT USING (app_can('medical.status.read', injury_review.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury_review.player_id), injury_review.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY injury_review_insert ON injury_review
  FOR INSERT WITH CHECK (app_can('medical.write', injury_review.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury_review.player_id), injury_review.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY injury_review_update ON injury_review
  FOR UPDATE USING (app_can('medical.write', injury_review.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury_review.player_id), injury_review.player_id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('medical.write', injury_review.school_id, (SELECT p.team_code FROM player p WHERE p.id = injury_review.player_id), injury_review.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- injury_review_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as `SELECT t.*, CASE …`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_injury_review$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'injury_review.school_id',
                            g.team_anchor,
                            'injury_review.player_id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('phase_after', 'medical.nature.read', '(SELECT p.team_code FROM player p WHERE p.id = injury_review.player_id)'), ('next_review_on', 'medical.nature.read', '(SELECT p.team_code FROM player p WHERE p.id = injury_review.player_id)'), ('note', 'medical.details.read', '(SELECT p.team_code FROM player p WHERE p.id = injury_review.player_id)'), ('reviewed_by', 'medical.details.read', '(SELECT p.team_code FROM player p WHERE p.id = injury_review.player_id)')) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'injury_review';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build injury_review_masked: table injury_review not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    -- security_invoker is the load-bearing word here, and it is easy to read
    -- past. A view runs with the permissions of its OWNER unless told
    -- otherwise, and the owner of this one owns injury_review too — so row-level
    -- security on injury_review was evaluated as a role that bypasses it, and this
    -- view returned EVERY row in the table to anyone who could select from it.
    -- Cross-school, cross-tenant, through the one object the read path is
    -- required to use for personal information. Masking still applied, so a
    -- leaked row had its sensitive columns nulled and looked entirely correct.
    -- security_barrier alone does not help: it controls when predicates may be
    -- pushed down, not whose policies apply.
    'CREATE OR REPLACE VIEW injury_review_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM injury_review',
    cols);
END
$mask_injury_review$;

-- └── END GENERATED

-- ── 3 · Below the generated block: what tables.mjs cannot say ──────
-- The doors are the only writers (D2). Two layers, as db/60 does for its
-- consent: no privilege, and the functions' own checks.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON injury, injury_review FROM scrbrd_app;

-- Q7: never under a support session at the boy's school, whatever role it
-- borrowed (110 §6.5's shape). The injury row itself stays as it was: a
-- logged read for a support session (Q7's recommendation).
DROP POLICY IF EXISTS injury_review_not_support ON injury_review;
CREATE POLICY injury_review_not_support ON injury_review
  AS RESTRICTIVE FOR SELECT
  USING (app_support_access_id(injury_review.school_id) IS NULL);

-- And, like every table behind RLS since db/50, closed to a pad's resume
-- credential.
SELECT pad_scope_guard_install('injury_review'::regclass);


-- ── 4 · injury_masked, with the new columns on their tiers (D3) ────
-- db/09's five masks and db/111's four, verbatim from tables.mjs
-- (rls.test.mjs, group D2). CREATE OR REPLACE keeps db/09's columns, their
-- order and their types; the five new columns are appended in the order the
-- table now has them. recurs_injury_id is not masked (a link, no words).
DO $mask_injury$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'injury.school_id',
                            g.team_anchor,
                            'injury.player_id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('injury_type', 'medical.nature.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('severity', 'medical.nature.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('phase', 'medical.nature.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('emergency_services', 'medical.nature.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('next_review_on', 'medical.nature.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('notes', 'medical.details.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('physio', 'medical.details.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('recorded_by', 'medical.details.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)'), ('dso_notified_at', 'medical.details.read', '(SELECT p.team_code FROM player p WHERE p.id = injury.player_id)')) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'injury';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'db/111: cannot rebuild injury_masked: table injury not found';
  END IF;

  EXECUTE format(
    -- security_invoker, as db/09 says at length: without it the view reads
    -- injury as its owner and every row reaches everyone.
    'CREATE OR REPLACE VIEW injury_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM injury',
    cols);
END
$mask_injury$;


-- ── 5 · Who may write, asked once for both doors (D2, D4) ──────────

/**
 * Is the caller this boy's family, in the widest sense a clinical author
 * must not be: any guardian or self link he holds, or held, to this boy,
 * pending or verified, whatever its dates and whether or not its assignment
 * is still active — or is_family_of() (db/08). A physio who is his mother
 * reads him as his guardian; she writes nothing clinical about him under the
 * school's role (Q6), and her worklist leaves him off. It answers only about
 * the caller herself, so the application may ask it (the worklist does).
 */
CREATE OR REPLACE FUNCTION injury_writer_is_family(p_player uuid) RETURNS boolean AS $$
  SELECT is_family_of(p_player) OR EXISTS (
    SELECT 1 FROM role_assignment a
      JOIN assignment_subject s ON s.assignment_id = a.id
     WHERE a.person_id = app_user_id()
       AND a.role IN ('guardian', 'selfaccess')
       AND s.player_id = p_player
       AND s.verification_state IN ('pending', 'verified'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION injury_writer_is_family(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION injury_writer_is_family(uuid) TO scrbrd_app;

/**
 * Why the caller may not write a clinical row about this boy at this school,
 * or NULL when she may. In this order, so each refusal names the first thing
 * wrong: nobody signed in; a pad's credential (db/50); a support session
 * anywhere; a platform-wide account; no medical.write over the boy (his
 * school, his current side, himself); the Injuries module off for her at the
 * school; her own child. Internal: owner only.
 */
CREATE OR REPLACE FUNCTION injury_write_refusal(p_player uuid, p_school uuid) RETURNS text AS $$
DECLARE
  v_team text;
BEGIN
  IF app_user_id() IS NULL THEN RETURN 'not_signed_in'; END IF;
  IF app_pad_scoped() THEN RETURN 'not_permitted'; END IF;
  IF app_support_access_id() IS NOT NULL THEN RETURN 'not_under_support'; END IF;
  IF app_is_platform_wide() THEN RETURN 'not_permitted'; END IF;
  SELECT p.team_code INTO v_team FROM player p WHERE p.id = p_player;
  IF NOT app_can('medical.write', p_school, v_team, p_player,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN 'not_permitted';
  END IF;
  IF NOT feature_enabled('injuries', p_school, app_user_id()) THEN RETURN 'module_off'; END IF;
  IF injury_writer_is_family(p_player) THEN RETURN 'family_cannot_record'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION injury_write_refusal(uuid, uuid) FROM PUBLIC;


-- ── 6 · The two doors (D2) ─────────────────────────────────────────

/**
 * Record an injury: the injury row, with its author, and its first review —
 * the recording — in one statement. notify_injury() (db/08) writes the
 * "Injury recorded" notice as it always has; SG-12 (section 9) writes the
 * DSO's when the injury is severe or emergency services were called.
 *
 * p_next_review_on is required: the injury is open, and a deadline nobody
 * set is an invention (Q10). p_restricted defaults to true (unavailable for
 * selection) and p_emergency_services to false. p_recurs_injury may name an
 * earlier, cleared injury of the same boy's.
 *
 * Returns (ok, reason, injury_id). A refusal is a word, not an exception.
 */
CREATE OR REPLACE FUNCTION injury_record(
  p_player             uuid,
  p_injury_type        text,
  p_severity           text,
  p_date_injured       date,
  p_restricted         boolean,
  p_rtw_date           date,
  p_next_review_on     date,
  p_emergency_services boolean,
  p_notes              text,
  p_recurs_injury      uuid DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text, injury_id uuid) AS $$
DECLARE
  v_school uuid;
  v_why    text;
  v_today  date := sa_today();
  v_type   text := nullif(btrim(p_injury_type), '');
  v_notes  text := nullif(btrim(p_notes), '');
  v_restr  boolean := coalesce(p_restricted, true);
  v_prior  injury%ROWTYPE;
  v_id     uuid;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', NULL::uuid; RETURN; END IF;
  SELECT p.school_id INTO v_school FROM player p WHERE p.id = p_player;
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'no_such_player', NULL::uuid; RETURN; END IF;
  v_why := injury_write_refusal(p_player, v_school);
  IF v_why IS NOT NULL THEN RETURN QUERY SELECT false, v_why, NULL::uuid; RETURN; END IF;

  IF v_type IS NULL THEN RETURN QUERY SELECT false, 'injury_type_required', NULL::uuid; RETURN; END IF;
  IF length(v_type) > 200 THEN RETURN QUERY SELECT false, 'injury_type_too_long', NULL::uuid; RETURN; END IF;
  IF p_severity IS NULL OR p_severity NOT IN ('minor', 'moderate', 'severe') THEN
    RETURN QUERY SELECT false, 'severity_invalid', NULL::uuid; RETURN;
  END IF;
  IF p_date_injured IS NULL THEN RETURN QUERY SELECT false, 'date_injured_required', NULL::uuid; RETURN; END IF;
  IF p_date_injured > v_today THEN RETURN QUERY SELECT false, 'date_injured_in_future', NULL::uuid; RETURN; END IF;
  IF p_rtw_date IS NOT NULL AND p_rtw_date < p_date_injured THEN
    RETURN QUERY SELECT false, 'return_before_injury', NULL::uuid; RETURN;
  END IF;
  IF p_next_review_on IS NULL THEN RETURN QUERY SELECT false, 'next_review_required', NULL::uuid; RETURN; END IF;
  IF p_next_review_on < v_today THEN RETURN QUERY SELECT false, 'next_review_in_past', NULL::uuid; RETURN; END IF;
  IF p_recurs_injury IS NOT NULL THEN
    SELECT * INTO v_prior FROM injury i WHERE i.id = p_recurs_injury;
    IF NOT FOUND OR v_prior.player_id <> p_player THEN
      RETURN QUERY SELECT false, 'recurs_not_his', NULL::uuid; RETURN;
    END IF;
    IF v_prior.phase <> 'cleared' THEN
      RETURN QUERY SELECT false, 'recurs_an_open_injury', NULL::uuid; RETURN;
    END IF;
  END IF;

  INSERT INTO injury (school_id, player_id, injury_type, severity, date_injured, rtw_date, phase,
                      restricted, notes, recorded_by, emergency_services, next_review_on, recurs_injury_id)
  VALUES (v_school, p_player, v_type, p_severity, p_date_injured, p_rtw_date, 'active',
          v_restr, v_notes, app_user_id(), coalesce(p_emergency_services, false), p_next_review_on, p_recurs_injury)
  RETURNING id INTO v_id;

  -- The recording is the first review: the state the injury starts in. Its
  -- words are the injury's own notes, not copied here.
  INSERT INTO injury_review (school_id, player_id, injury_id, reviewed_at, reviewed_by, phase_after,
                             restricted_after, rtw_date_after, next_review_on, note)
  VALUES (v_school, p_player, v_id, clock_timestamp(), app_user_id(), 'active', v_restr, p_rtw_date,
          p_next_review_on, NULL);

  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION injury_record(uuid, text, text, date, boolean, date, date, boolean, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION injury_record(uuid, text, text, date, boolean, date, date, boolean, text, uuid) TO scrbrd_app;

/**
 * Review an open injury: the phase, the restriction, the return date and the
 * next review it leaves him with, and the physio's note. The trigger in
 * section 7 applies it to the injury row.
 *
 * NULL for p_restricted_after keeps the injury's current restriction (false
 * when clearing); NULL for p_rtw_date_after keeps the current return date.
 * So every review row states the whole state after it, never a difference.
 *
 * Refused: a cleared injury (D2: a cleared injury is not reopened; a new one
 * is recorded); a next review missing on a review that does not clear him,
 * or named on one that does, or already past (Q10); a cleared boy left
 * restricted; a return date before the injury; a review dated before the
 * injury's last.
 *
 * Returns (ok, reason, review_id).
 */
CREATE OR REPLACE FUNCTION injury_review_record(
  p_injury           uuid,
  p_phase_after      text,
  p_restricted_after boolean,
  p_rtw_date_after   date,
  p_next_review_on   date,
  p_note             text
) RETURNS TABLE (ok boolean, reason text, review_id uuid) AS $$
DECLARE
  i       injury%ROWTYPE;
  v_why   text;
  v_today date := sa_today();
  v_restr boolean;
  v_rtw   date;
  v_last  timestamptz;
  v_id    uuid;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', NULL::uuid; RETURN; END IF;
  SELECT * INTO i FROM injury WHERE id = p_injury FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_injury', NULL::uuid; RETURN; END IF;
  v_why := injury_write_refusal(i.player_id, i.school_id);
  IF v_why IS NOT NULL THEN RETURN QUERY SELECT false, v_why, NULL::uuid; RETURN; END IF;

  IF i.phase = 'cleared' THEN RETURN QUERY SELECT false, 'injury_cleared', NULL::uuid; RETURN; END IF;
  IF p_phase_after IS NULL OR p_phase_after NOT IN ('active', 'rehab', 'cleared') THEN
    RETURN QUERY SELECT false, 'phase_invalid', NULL::uuid; RETURN;
  END IF;
  v_restr := coalesce(p_restricted_after, CASE WHEN p_phase_after = 'cleared' THEN false ELSE i.restricted END);
  IF p_phase_after = 'cleared' AND v_restr THEN
    RETURN QUERY SELECT false, 'cleared_is_not_restricted', NULL::uuid; RETURN;
  END IF;
  v_rtw := coalesce(p_rtw_date_after, i.rtw_date);
  IF v_rtw IS NOT NULL AND v_rtw < i.date_injured THEN
    RETURN QUERY SELECT false, 'return_before_injury', NULL::uuid; RETURN;
  END IF;
  IF p_phase_after <> 'cleared' AND p_next_review_on IS NULL THEN
    RETURN QUERY SELECT false, 'next_review_required', NULL::uuid; RETURN;
  END IF;
  IF p_phase_after = 'cleared' AND p_next_review_on IS NOT NULL THEN
    RETURN QUERY SELECT false, 'cleared_has_no_next_review', NULL::uuid; RETURN;
  END IF;
  IF p_next_review_on < v_today THEN RETURN QUERY SELECT false, 'next_review_in_past', NULL::uuid; RETURN; END IF;
  SELECT max(r.reviewed_at) INTO v_last FROM injury_review r WHERE r.injury_id = p_injury;
  IF v_last > clock_timestamp() THEN RETURN QUERY SELECT false, 'review_before_last', NULL::uuid; RETURN; END IF;

  -- clock_timestamp(), not now(): two reviews in one transaction still read
  -- in the order they were made.
  INSERT INTO injury_review (school_id, player_id, injury_id, reviewed_at, reviewed_by, phase_after,
                             restricted_after, rtw_date_after, next_review_on, note)
  VALUES (i.school_id, i.player_id, i.id, clock_timestamp(), app_user_id(), p_phase_after, v_restr, v_rtw,
          p_next_review_on, nullif(btrim(p_note), ''))
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION injury_review_record(uuid, text, boolean, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION injury_review_record(uuid, text, boolean, date, date, text) TO scrbrd_app;


-- ── 7 · A review applied to its injury, and player.fitness (D2, D9) ─
/**
 * After a review: the injury row takes its phase, restriction, return date
 * and next review — only when one of them changed, so the recording's own
 * review writes nothing and fires nothing. That UPDATE is what fires
 * notify_injury() (db/08), unchanged: cleared → "Cleared to play"; return
 * date moved → "Return date updated"; a phase step or a note alone → no
 * notice (D10, Q12).
 *
 * Then player.fitness, one truth from the open injuries (Q9): 'injured' while
 * any open row is active, 'rehab' while one is in rehab and none active,
 * 'fit' when none is open — except that 'unavailable' is never written here,
 * and stays when nothing is open (D9).
 */
CREATE OR REPLACE FUNCTION injury_apply_review() RETURNS trigger AS $$
DECLARE
  v_was text;
  v_now text;
BEGIN
  UPDATE injury
     SET phase = NEW.phase_after, restricted = NEW.restricted_after,
         rtw_date = NEW.rtw_date_after, next_review_on = NEW.next_review_on
   WHERE id = NEW.injury_id
     AND (phase, restricted, rtw_date, next_review_on)
         IS DISTINCT FROM (NEW.phase_after, NEW.restricted_after, NEW.rtw_date_after, NEW.next_review_on);

  SELECT p.fitness INTO v_was FROM player p WHERE p.id = NEW.player_id;
  v_now := CASE
             WHEN EXISTS (SELECT 1 FROM injury i WHERE i.player_id = NEW.player_id AND i.phase = 'active') THEN 'injured'
             WHEN EXISTS (SELECT 1 FROM injury i WHERE i.player_id = NEW.player_id AND i.phase = 'rehab')  THEN 'rehab'
             WHEN v_was = 'unavailable' THEN 'unavailable'
             ELSE 'fit' END;
  IF v_now IS DISTINCT FROM v_was THEN
    UPDATE player SET fitness = v_now WHERE id = NEW.player_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION injury_apply_review() FROM PUBLIC;

DROP TRIGGER IF EXISTS injury_apply_review ON injury_review;
CREATE TRIGGER injury_apply_review
  AFTER INSERT ON injury_review
  FOR EACH ROW EXECUTE FUNCTION injury_apply_review();


-- ── 8 · The physio's worklist (D3, D5, D8, D11) ────────────────────
/**
 * Every open injury of a boy still at the injury's school that the caller
 * holds medical.write over, with ONE reason it is on her list and a clock:
 *
 *   overdue         the next review date has passed
 *   return_passed   the return date has passed and he is still restricted
 *   due             the next review is within 7 days
 *   no_return_date  restricted, and no return date set
 *   new             nothing since the recording
 *
 * in that order of precedence and of the list (D3's ordering, with
 * no_return_date placed between due and new). `since` is when the reason
 * began, `due_on` the date it is about, `days_over` how many days past it is
 * (0 when not past).
 *
 * SECURITY INVOKER: it reads injury and injury_review under the caller's
 * RLS, and asks app_can('medical.write') of every row on top, so a coach, a
 * director, the fitness coach, a parent and a pupil — none holds
 * medical.write — get no row, and a physio gets her own school's. A
 * platform-wide account, a support session and a pad credential get nothing
 * (as the doors refuse them). A boy with no open team membership at the
 * injury's school has left: off the list, his row untouched (D11). And a
 * physio's own child is off hers: she may not review him (Q6).
 *
 * No notice is ever written from this: the list is her clock (Q10).
 */
CREATE OR REPLACE FUNCTION injury_worklist()
RETURNS TABLE (injury_id uuid, school_id uuid, player_id uuid, reason text,
               since date, due_on date, days_over integer) AS $$
  WITH me AS (
    SELECT sa_today() AS today
     WHERE app_user_id() IS NOT NULL
       AND NOT app_pad_scoped()
       AND app_support_access_id() IS NULL
       AND NOT app_is_platform_wide()
  ), open AS (
    SELECT i.id, i.school_id, i.player_id, i.restricted, i.rtw_date, i.next_review_on, i.created_at,
           (SELECT count(*) FROM injury_review r WHERE r.injury_id = i.id) AS reviews,
           (SELECT max(r.reviewed_at) FROM injury_review r WHERE r.injury_id = i.id) AS last_at,
           me.today
      FROM injury i CROSS JOIN me
     WHERE i.phase <> 'cleared'
       AND app_can('medical.write', i.school_id,
                   (SELECT p.team_code FROM player p WHERE p.id = i.player_id), i.player_id,
                   '00000000-0000-0000-0000-000000000000'::uuid)
       AND EXISTS (SELECT 1 FROM team_membership m
                    WHERE m.player_id = i.player_id AND m.school_id = i.school_id AND m.left_on IS NULL)
       -- Her own child is not hers to review (Q6), so not on her list.
       AND NOT injury_writer_is_family(i.player_id)
  ), why AS (
    SELECT o.*,
           (coalesce(o.last_at, o.created_at) AT TIME ZONE 'Africa/Johannesburg')::date AS last_on,
           CASE WHEN o.next_review_on < o.today                    THEN 'overdue'
                WHEN o.restricted AND o.rtw_date < o.today         THEN 'return_passed'
                WHEN o.next_review_on <= o.today + 7               THEN 'due'
                WHEN o.restricted AND o.rtw_date IS NULL           THEN 'no_return_date'
                WHEN o.reviews <= 1                                THEN 'new'
           END AS reason
      FROM open o
  )
  SELECT w.id, w.school_id, w.player_id, w.reason,
         CASE w.reason WHEN 'overdue'       THEN w.next_review_on
                       WHEN 'return_passed' THEN w.rtw_date
                       WHEN 'due'           THEN greatest(w.next_review_on - 7, w.last_on)
                       ELSE w.last_on END,
         CASE w.reason WHEN 'return_passed' THEN w.rtw_date ELSE w.next_review_on END,
         CASE w.reason WHEN 'overdue'       THEN (w.today - w.next_review_on)
                       WHEN 'return_passed' THEN (w.today - w.rtw_date)
                       ELSE 0 END
    FROM why w
   WHERE w.reason IS NOT NULL
   ORDER BY CASE w.reason WHEN 'overdue' THEN 1 WHEN 'return_passed' THEN 2 WHEN 'due' THEN 3
                          WHEN 'no_return_date' THEN 4 ELSE 5 END,
            CASE w.reason WHEN 'overdue' THEN (w.today - w.next_review_on)
                          WHEN 'return_passed' THEN (w.today - w.rtw_date) ELSE 0 END DESC,
            w.next_review_on NULLS LAST, w.id
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION injury_worklist() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION injury_worklist() TO scrbrd_app;


-- ── 9 · SG-12's injury half (D10, slice C, Q8) ─────────────────────
/**
 * A severe injury, or one where emergency services were called, writes the
 * school's DSOs one safeguarding notice (SAFEGUARDING_DSO §3.3, SG-12): kind
 * 'safeguarding', school-wide, no team, about nobody (no subject, no subject
 * person), high, read with safeguarding.concern.read. D2's contract: never
 * retracted (notification_retract() refuses a safeguarding notice), thirty
 * days (notification_life()). The words name no child, no diagnosis and no
 * id: the clinical record stays with the physio.
 *
 * Once per injury: notification.subject_id is NULL, so the guard is the
 * injury's own dso_notified_at. On INSERT when the row is serious; on an
 * UPDATE of severity or emergency_services when it BECOMES serious.
 * Definer: the notice is the system's (db/57 keeps every other writer out
 * of kind 'safeguarding'), and the stamp is written past the REVOKE.
 */
CREATE OR REPLACE FUNCTION injury_serious_watch() RETURNS trigger AS $$
BEGIN
  IF NEW.dso_notified_at IS NOT NULL THEN RETURN NULL; END IF;
  IF NOT (NEW.severity = 'severe' OR NEW.emergency_services) THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.severity = 'severe' OR OLD.emergency_services) THEN RETURN NULL; END IF;

  INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                            required_capability, is_public, subject_kind, subject_id, subject_person_id)
  VALUES (NEW.school_id, NULL, 'school', 'safeguarding', 'high',
          'A serious injury has been recorded',
          'A pupil at your school has had a serious injury recorded by the physio today. This is for your awareness under CSA''s Safeguarding Policy; the clinical record stays with the physio. Raise a concern if there is a safeguarding question.',
          'safeguarding.concern.read', false, NULL, NULL, NULL);

  UPDATE injury SET dso_notified_at = now() WHERE id = NEW.id;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION injury_serious_watch() FROM PUBLIC;

DROP TRIGGER IF EXISTS injury_serious_watch ON injury;
CREATE TRIGGER injury_serious_watch
  AFTER INSERT OR UPDATE OF severity, emergency_services ON injury
  FOR EACH ROW EXECUTE FUNCTION injury_serious_watch();


-- ── 10 · When an injury record falls due for deletion (D11, Q3) ────
/**
 * Twelve months after he left the school system: his last school
 * membership's left_on, plus twelve months. NULL while he is at school
 * (still_at_school(), db/60), and NULL when he never had a school membership
 * (there is no anchor to count from). Not health_retention_due(): that is
 * NULL for a boy with no health-monitoring consent, which most injured boys
 * will not have. Nothing deletes in this file (slice E). Internal: owner only.
 */
CREATE OR REPLACE FUNCTION injury_retention_due(p_player uuid) RETURNS date AS $$
  SELECT CASE
           WHEN still_at_school(p_player) THEN NULL
           ELSE ((SELECT max(m.left_on) FROM team_membership m
                    JOIN school s ON s.id = m.school_id
                   WHERE m.player_id = p_player AND s.kind = 'school') + interval '12 months')::date
         END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION injury_retention_due(uuid) FROM PUBLIC;


-- ── 11 · Who may call these: the application, and nobody else ──────
-- On a managed host the platform's API roles get EXECUTE on every new
-- function by default privilege, directly and not through PUBLIC (db/29), so
-- it is taken back from them here, as db/60 does.
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY[
          'injury_writer_is_family(uuid)', 'injury_write_refusal(uuid,uuid)',
          'injury_record(uuid,text,text,date,boolean,date,date,boolean,text,uuid)',
          'injury_review_record(uuid,text,boolean,date,date,text)',
          'injury_apply_review()', 'injury_worklist()', 'injury_serious_watch()',
          'injury_retention_due(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON injury_review, injury_review_masked FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── 12 · Refuse to commit a file that did not do what it says ──────
DO $check$
DECLARE
  f     text;
  t     text;
  v_def text;
  n     int;
  v_arm text := 'school_id, \( SELECT p\.team_code\s+FROM player p\s+WHERE \(p\.id = injury\.player_id\)\), player_id, NULL::uuid\) THEN ';
BEGIN
  -- Every definer pinned (db/16); the worklist is the one invoker.
  FOREACH f IN ARRAY ARRAY['injury_writer_is_family(uuid)', 'injury_write_refusal(uuid,uuid)',
                           'injury_record(uuid,text,text,date,boolean,date,date,boolean,text,uuid)',
                           'injury_review_record(uuid,text,boolean,date,date,text)',
                           'injury_apply_review()', 'injury_serious_watch()', 'injury_retention_due(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/111: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'injury_worklist()'::regprocedure) THEN
    RAISE EXCEPTION 'db/111: injury_worklist() runs as its owner; it must read under the caller''s RLS';
  END IF;

  -- The application's three doors (and the worklist's family check), and nobody else's.
  FOREACH f IN ARRAY ARRAY['injury_record(uuid,text,text,date,boolean,date,date,boolean,text,uuid)',
                           'injury_review_record(uuid,text,boolean,date,date,text)', 'injury_worklist()',
                           'injury_writer_is_family(uuid)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/111: the application cannot call %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['injury_writer_is_family(uuid)', 'injury_write_refusal(uuid,uuid)',
                           'injury_record(uuid,text,text,date,boolean,date,date,boolean,text,uuid)',
                           'injury_review_record(uuid,text,boolean,date,date,text)',
                           'injury_apply_review()', 'injury_worklist()', 'injury_serious_watch()',
                           'injury_retention_due(uuid)'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/111: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['injury_write_refusal(uuid,uuid)',
                           'injury_apply_review()', 'injury_serious_watch()', 'injury_retention_due(uuid)'] LOOP
    IF has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/111: the application can call the internal %', f;
    END IF;
  END LOOP;

  -- The doors are the only writers (D2).
  FOREACH t IN ARRAY ARRAY['injury', 'injury_review'] LOOP
    IF has_table_privilege('scrbrd_app', t, 'INSERT') OR has_table_privilege('scrbrd_app', t, 'UPDATE')
       OR has_table_privilege('scrbrd_app', t, 'DELETE') OR has_table_privilege('scrbrd_app', t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'db/111: the application can write % directly', t;
    END IF;
  END LOOP;

  -- RLS, the generated policies, the support cut and the pad guard.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'injury_review'::regclass) THEN
    RAISE EXCEPTION 'db/111: injury_review has row-level security off';
  END IF;
  FOREACH t IN ARRAY ARRAY['injury_review_read', 'injury_review_insert', 'injury_review_update',
                           'injury_review_not_support'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'injury_review' AND policyname = t) THEN
      RAISE EXCEPTION 'db/111: policy % is missing', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'injury_review' AND policyname = 'injury_review_read'
                    AND qual LIKE '%medical.status.read%') THEN
    RAISE EXCEPTION 'db/111: injury_review is not read under medical.status.read';
  END IF;
  IF (SELECT permissive FROM pg_policies WHERE tablename = 'injury_review' AND policyname = 'injury_review_not_support') <> 'RESTRICTIVE' THEN
    RAISE EXCEPTION 'db/111: the support cut on injury_review is not RESTRICTIVE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'injury_review'
                    AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/111: injury_review has no RESTRICTIVE pad_scope_select (db/50)';
  END IF;

  -- Both masked views: every column, the tiers, invoker and barrier.
  FOREACH t IN ARRAY ARRAY['injury', 'injury_review'] LOOP
    IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t || '_masked')
       <> (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t) THEN
      RAISE EXCEPTION 'db/111: %_masked does not carry every % column', t, t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class
                    WHERE oid = (t || '_masked')::regclass
                      AND 'security_invoker=true' = ANY (coalesce(reloptions, '{}'))
                      AND 'security_barrier=true' = ANY (coalesce(reloptions, '{}'))) THEN
      RAISE EXCEPTION 'db/111: %_masked lost security_invoker or security_barrier', t;
    END IF;
  END LOOP;
  v_def := pg_get_viewdef('injury_masked'::regclass);
  SELECT count(*) INTO n FROM regexp_matches(v_def, 'CASE\s+WHEN app_can\(', 'g');
  IF n <> 9 THEN RAISE EXCEPTION 'db/111: injury_masked masks % column(s), expected db/09''s five and four', n; END IF;
  -- Each arm as Postgres prints it: the capability, the boy's school, his
  -- side through the player row, the boy, then the column.
  IF v_def !~ ('app_can\(''medical\.nature\.read''::text, ' || v_arm || 'next_review_on\M')
     OR v_def !~ ('app_can\(''medical\.nature\.read''::text, ' || v_arm || 'emergency_services\M')
     OR v_def !~ ('app_can\(''medical\.details\.read''::text, ' || v_arm || 'recorded_by\M')
     OR v_def !~ ('app_can\(''medical\.details\.read''::text, ' || v_arm || 'dso_notified_at\M') THEN
    RAISE EXCEPTION 'db/111: injury_masked does not place the new columns on their tiers';
  END IF;
  IF v_def ~ 'THEN (date_injured|rtw_date|restricted|recurs_injury_id)\M' THEN
    RAISE EXCEPTION 'db/111: injury_masked masks a status column';
  END IF;
  v_def := pg_get_viewdef('injury_review_masked'::regclass);
  SELECT count(*) INTO n FROM regexp_matches(v_def, 'CASE\s+WHEN app_can\(', 'g');
  IF n <> 4 THEN RAISE EXCEPTION 'db/111: injury_review_masked masks % column(s), not 4', n; END IF;

  -- The triggers.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'injury_review'::regclass
                    AND tgname = 'injury_apply_review' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'db/111: injury_review has no injury_apply_review trigger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'injury'::regclass
                    AND tgname = 'injury_serious_watch' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'db/111: injury has no injury_serious_watch trigger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'injury'::regclass
                    AND tgname = 'injury_notifies' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'db/111: notify_injury() no longer fires on injury';
  END IF;

  -- Nobody but the physio holds the door's capability (D4, D12: no new one).
  IF EXISTS (SELECT 1 FROM role_capability WHERE capability = 'medical.write' AND role NOT IN ('medical', 'superadmin')) THEN
    RAISE EXCEPTION 'db/111: a role other than medical holds medical.write';
  END IF;
  IF EXISTS (SELECT 1 FROM role_capability WHERE role = 'dso' AND capability LIKE 'medical.%') THEN
    RAISE EXCEPTION 'db/111: the DSO holds a medical capability';
  END IF;
END $check$;

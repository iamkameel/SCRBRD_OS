-- ══════════════════════════════════════════════════════════════════
--  SCRBRD — apply 105_development_loop.sql to a database that already has the rest
-- ══════════════════════════════════════════════════════════════════
--
--  For the Supabase SQL Editor. Nothing here tears anything down: it is the
--  one migration and its ledger row, exactly what `node tools/migrate.mjs`
--  would apply to this database. Refuses to run twice, and refuses to run
--  ahead of its predecessor.
DO $apply$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migration WHERE name = '105_development_loop.sql') THEN
    RAISE EXCEPTION '105_development_loop.sql is already in this database''s ledger — nothing to do';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migration WHERE name = '104_assessment_corrections.sql') THEN
    RAISE EXCEPTION '104_assessment_corrections.sql has not been applied here — apply it first, or use the rebuild bundle';
  END IF;
END $apply$;

-- A database ledgered by a bundle from before SCRBRD-025 has no note column
-- yet; this reaches it either way.
ALTER TABLE schema_migration ADD COLUMN IF NOT EXISTS note text;

-- ── 105_development_loop.sql ──
-- ══════════════════════════════════════════════════════════════════
--  105 · The development loop: a target, the side's plan, the register
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN: two tables, their policies, two functions, one trigger and two
-- RESTRICTIVE write rules. The design is
-- docs/design/GA-I26a_assessment_history.md (slice A2; AH-D1, AH-D3, AH-D6,
-- AH-D9, decided by Kameel on 15 Oct as recommended). Its proof is db/99 §82;
-- the API walk is tools/smoke-assessment-history.mjs. Needs db/104 (a target
-- stands on a STANDING score, which db/104 defines).
--
-- WHAT WAS MISSING
--   The loop a coach runs — look, decide, run the drill, look again — was four
--   tables that did not know about each other: player_skill held the history,
--   nothing could save a target (the focus-areas card said so), a session's
--   drills were free text beside an unlinked library, and the register had a
--   table, a policy and no route.
--
-- WHAT CHANGES
--   + development_target: one boy, one metric, a number to reach, the drill
--     for it, the score it stood on and the reasoning (a staff-tier note), by
--     id. One open target per metric per boy. Read under
--     player.development.read for the boy's CURRENT side — the coach, the
--     assistant, the director, the boy himself (selfaccess); never his
--     parents, the principal, the team manager, a team-mate, the analyst,
--     another school, a support session. NO insert, update or delete policy,
--     and no write privilege: target_set() and target_withdraw() are the only
--     doors. Met-or-not is never stored: it is read off the scores.
--   + target_set(player, category, metric, score, due, drill, note) and
--     target_withdraw(id, reason): SECURITY DEFINER, pinned path, scrbrd_app
--     only; each asks player.development.write for the boy's current side.
--   + training_session_drill: the side's plan, keyed to the drill library.
--     Names no boy, carries no target. Read under team.read, as the session
--     is (db/09), and written under team.training.run, through its session.
--     A drill from another school's library is refused by trigger.
--   + team.training.run, a new capability (Kameel, 15 Oct): plan a session
--     and take its register, and nothing else. Held by every role that holds
--     team.manage (coach, director of sport, school admin, sports admin, the
--     owner's key) and by the TEAM MANAGER, who holds no team.manage and so
--     is still refused the drill library, the kit register and the calendar.
--     Side-scoped as team.manage is: the assignment's team against the
--     session's.
--   + training_attendance: its write policies (db/09's, under team.manage)
--     re-created under team.training.run; the read is unchanged.
--   + training_attendance: the application never writes `injured` (AH-D9:
--     a health word on a register the side reads). Two RESTRICTIVE rules;
--     existing rows are untouched and the read shows them as `excused`.
--
-- WHAT IT DOES TO A LIVE DATABASE
--   Two new tables (empty), five permissive and three RESTRICTIVE policies
--   (and db/50's five pad guards on them); one capability and six
--   role_capability rows; training_attendance's two write policies replaced
--   (same anchors, the new capability); two
--   functions, one trigger; the application may delete a plan's rows (db/06's
--   default privileges give no DELETE) and may not write a target at all. No
--   existing row is changed. The two RESTRICTIVE
--   rules on training_attendance lock it for one statement each.
--   A second paste changes nothing: IF NOT EXISTS, DROP … IF EXISTS, CREATE OR
--   REPLACE throughout.


-- ── 0 · db/104 first ───────────────────────────────────────────────
DO $needs_104$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'player_skill' AND column_name = 'withdrawn_at') THEN
    RAISE EXCEPTION 'db/105 needs db/104 (player_skill.withdrawn_at): paste 104 first';
  END IF;
END $needs_104$;


-- ── 0b · Running a session: team.training.run ─────────────────────
-- The catalogue row and one role_capability row per holder in roles.mjs
-- (services/api/rls/generate-rls.mjs ADDED_SINCE_01; rls.test.mjs holds the
-- list to the model). Scope is the assignment's, as for every capability.
INSERT INTO capability (name) VALUES ('team.training.run') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('superadmin',      'team.training.run'),
  ('directorofsport', 'team.training.run'),
  ('schooladmin',     'team.training.run'),
  ('sportsadmin',     'team.training.run'),
  ('coach',           'team.training.run'),
  ('teammanager',     'team.training.run')
ON CONFLICT DO NOTHING;


-- ── 1 · development_target ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS development_target (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  -- Denormalised, as development_note's is: the row states its own tenant.
  school_id        uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  category         text NOT NULL CHECK (category IN ('technical', 'mental', 'tactical', 'physical')),
  -- Validated against TREE (packages/scoring/src/rubric.mjs) by the API, as
  -- the assessment is; no SQL copy of the attribute list.
  metric           text NOT NULL CHECK (metric ~ '^[a-zA-Z]{2,40}$'),
  target_score     smallint NOT NULL CHECK (target_score BETWEEN 2 AND 20),
  -- The standing score it was set against; NULL when the metric was unrated.
  from_skill_id    uuid REFERENCES player_skill(id) ON DELETE SET NULL,
  -- The drill for it; NULL is "no drill, just watch it".
  drill_id         uuid REFERENCES drill(id) ON DELETE SET NULL,
  -- The reasoning: a development_note (usually a coaching point), read under
  -- its own policy — staff only. The boy reads the target, not this.
  note_id          uuid REFERENCES development_note(id) ON DELETE SET NULL,
  set_by           uuid NOT NULL REFERENCES app_user(id),
  set_on           date NOT NULL DEFAULT current_date,
  due_on           date,
  withdrawn_at     timestamptz,
  withdrawn_by     uuid REFERENCES app_user(id),
  withdrawn_reason text CHECK (withdrawn_reason IS NULL OR length(withdrawn_reason) BETWEEN 1 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT development_target_withdrawn_whole CHECK (withdrawn_at IS NULL OR withdrawn_by IS NOT NULL)
);
-- One open target per metric per boy.
CREATE UNIQUE INDEX IF NOT EXISTS development_target_open
  ON development_target (player_id, category, metric) WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS development_target_player ON development_target (player_id, set_on DESC);

ALTER TABLE development_target ENABLE ROW LEVEL SECURITY;

-- Read: the boy's current side, as his scores are (REACH class C2). No
-- write policy at all: the functions below are the only doors.
DROP POLICY IF EXISTS development_target_read ON development_target;
CREATE POLICY development_target_read ON development_target FOR SELECT
  USING (app_can('player.development.read', development_target.school_id, player_team(development_target.player_id),
                 development_target.player_id, '00000000-0000-0000-0000-000000000000'::uuid));
DROP POLICY IF EXISTS development_target_not_support ON development_target;
CREATE POLICY development_target_not_support ON development_target AS RESTRICTIVE FOR ALL
  USING ((SELECT app_support_access_id()) IS NULL OR app_support_access_id(development_target.school_id) IS NULL)
  WITH CHECK ((SELECT app_support_access_id()) IS NULL OR app_support_access_id(development_target.school_id) IS NULL);

-- And no write privilege either: a door that is only shut by a missing
-- policy is one CREATE POLICY from open.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON development_target FROM scrbrd_app;
GRANT SELECT ON development_target TO scrbrd_app;
DO $target_platform_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON development_target FROM %I', r);
    END IF;
  END LOOP;
END $target_platform_roles$;


-- ── 2 · Setting a target, and withdrawing one ─────────────────────
/**
 * Set a target: one number on one attribute of one boy, above where he
 * stands. The writer holds player.development.write for the boy's CURRENT
 * side (the coach; not the assistant, the director, the team manager).
 * Not under a support session.
 *
 *   from_skill_id  the newest STANDING player_skill row for the metric
 *                  (db/104: a withdrawn score is not where he stands), or
 *                  NULL when the metric is unrated
 *   p_score        above that score, or `already_there`; the column's CHECK
 *                  (2..20) refuses the rest with 23514
 *   p_drill        a drill of this school's library or the platform's, not
 *                  retired; else no_such_drill / drill_retired
 *   p_note         a note about THIS boy, standing; else note_not_his
 *   p_due          today or later, or NULL; else due_in_past
 *
 * Any open target for the metric is withdrawn in the same transaction with
 * the reason 'replaced', and the new one inserted: one standing row per
 * metric, both kept. Returns the new id.
 */
CREATE OR REPLACE FUNCTION target_set(p_player uuid, p_category text, p_metric text, p_score integer,
                                      p_due date, p_drill uuid, p_note uuid)
RETURNS TABLE (ok boolean, reason text, id uuid) AS $$
DECLARE
  v_me    uuid := app_user_id();
  ZERO    uuid := '00000000-0000-0000-0000-000000000000';
  p       player%ROWTYPE;
  d       drill%ROWTYPE;
  v_skill uuid;
  v_stand smallint;
  v_id    uuid;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO p FROM player WHERE player.id = p_player;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_such_player'::text, NULL::uuid; RETURN;
  END IF;
  IF app_support_access_id(p.school_id) IS NOT NULL
     OR NOT app_can('player.development.write', p.school_id, p.team_code, p.id, ZERO) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::uuid; RETURN;
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('technical', 'mental', 'tactical', 'physical')
     OR p_metric IS NULL OR p_metric !~ '^[a-zA-Z]{2,40}$' THEN
    RETURN QUERY SELECT false, 'unknown_metric'::text, NULL::uuid; RETURN;
  END IF;

  SELECT s.id, s.score INTO v_skill, v_stand
    FROM player_skill s
   WHERE s.player_id = p.id AND s.category = p_category AND s.metric = p_metric AND s.withdrawn_at IS NULL
   ORDER BY s.assessed_on DESC, s.id DESC
   LIMIT 1;
  IF v_stand IS NOT NULL AND p_score <= v_stand THEN
    RETURN QUERY SELECT false, 'already_there'::text, NULL::uuid; RETURN;
  END IF;

  IF p_drill IS NOT NULL THEN
    SELECT * INTO d FROM drill WHERE drill.id = p_drill;
    IF NOT FOUND OR (d.school_id IS NOT NULL AND d.school_id <> p.school_id) THEN
      RETURN QUERY SELECT false, 'no_such_drill'::text, NULL::uuid; RETURN;
    END IF;
    IF d.retired THEN
      RETURN QUERY SELECT false, 'drill_retired'::text, NULL::uuid; RETURN;
    END IF;
  END IF;
  IF p_note IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM development_note n WHERE n.id = p_note AND n.player_id = p.id AND n.withdrawn_at IS NULL) THEN
    RETURN QUERY SELECT false, 'note_not_his'::text, NULL::uuid; RETURN;
  END IF;
  IF p_due IS NOT NULL AND p_due < current_date THEN
    RETURN QUERY SELECT false, 'due_in_past'::text, NULL::uuid; RETURN;
  END IF;

  UPDATE development_target t
     SET withdrawn_at = now(), withdrawn_by = v_me, withdrawn_reason = 'replaced'
   WHERE t.player_id = p.id AND t.category = p_category AND t.metric = p_metric AND t.withdrawn_at IS NULL;
  INSERT INTO development_target (player_id, school_id, category, metric, target_score, from_skill_id,
                                  drill_id, note_id, set_by, due_on)
  VALUES (p.id, p.school_id, p_category, p_metric, p_score, v_skill, p_drill, p_note, v_me, p_due)
  RETURNING development_target.id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION target_set(uuid, text, text, integer, date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION target_set(uuid, text, text, integer, date, uuid, uuid) TO scrbrd_app;

/**
 * Withdraw a target, with a reason of 1–200 characters: any holder of
 * player.development.write for the boy's current side. The row stays,
 * struck. Refuses not_permitted (no target this person may withdraw — the two
 * are not told apart), reason_required, already_withdrawn.
 */
CREATE OR REPLACE FUNCTION target_withdraw(p_id uuid, p_reason text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me uuid := app_user_id();
  ZERO uuid := '00000000-0000-0000-0000-000000000000';
  t    development_target%ROWTYPE;
  v_team text;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  SELECT * INTO t FROM development_target WHERE development_target.id = p_id FOR UPDATE;
  IF FOUND THEN SELECT pl.team_code INTO v_team FROM player pl WHERE pl.id = t.player_id; END IF;
  IF t.id IS NULL
     OR app_support_access_id(t.school_id) IS NOT NULL
     OR NOT app_can('player.development.write', t.school_id, v_team, t.player_id, ZERO) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  IF length(v_reason) < 1 OR length(v_reason) > 200 THEN
    RETURN QUERY SELECT false, 'reason_required'::text; RETURN;
  END IF;
  IF t.withdrawn_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_withdrawn'::text; RETURN;
  END IF;
  UPDATE development_target SET withdrawn_at = now(), withdrawn_by = v_me, withdrawn_reason = v_reason
   WHERE development_target.id = t.id;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION target_withdraw(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION target_withdraw(uuid, text) TO scrbrd_app;


-- ── 3 · training_session_drill: the side's plan ────────────────────
CREATE TABLE IF NOT EXISTS training_session_drill (
  session_id uuid NOT NULL REFERENCES training_session(id) ON DELETE CASCADE,
  drill_id   uuid NOT NULL REFERENCES drill(id) ON DELETE CASCADE,
  position   smallint NOT NULL CHECK (position BETWEEN 1 AND 20),
  -- NULL: the drill's own duration.
  minutes    smallint CHECK (minutes IS NULL OR minutes BETWEEN 5 AND 180),
  PRIMARY KEY (session_id, position),
  UNIQUE (session_id, drill_id)
);
CREATE INDEX IF NOT EXISTS training_session_drill_drill ON training_session_drill (drill_id);

-- A satellite of training_session: read team.read, as the session is (db/09);
-- written under team.training.run, resolved through the session. When REACH R-A re-creates
-- training_session_read as side_reach(), this one is on its list.
ALTER TABLE training_session_drill ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS training_session_drill_read   ON training_session_drill;
DROP POLICY IF EXISTS training_session_drill_insert ON training_session_drill;
DROP POLICY IF EXISTS training_session_drill_update ON training_session_drill;
DROP POLICY IF EXISTS training_session_drill_delete ON training_session_drill;
CREATE POLICY training_session_drill_read ON training_session_drill
  FOR SELECT USING (app_can('team.read',
    (SELECT t.school_id FROM training_session t WHERE t.id = training_session_drill.session_id),
    (SELECT t.team_code FROM training_session t WHERE t.id = training_session_drill.session_id),
    '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE POLICY training_session_drill_insert ON training_session_drill
  FOR INSERT WITH CHECK (app_can('team.training.run',
    (SELECT t.school_id FROM training_session t WHERE t.id = training_session_drill.session_id),
    (SELECT t.team_code FROM training_session t WHERE t.id = training_session_drill.session_id),
    '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE POLICY training_session_drill_update ON training_session_drill
  FOR UPDATE USING (app_can('team.training.run',
    (SELECT t.school_id FROM training_session t WHERE t.id = training_session_drill.session_id),
    (SELECT t.team_code FROM training_session t WHERE t.id = training_session_drill.session_id),
    '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
  WITH CHECK (app_can('team.training.run',
    (SELECT t.school_id FROM training_session t WHERE t.id = training_session_drill.session_id),
    (SELECT t.team_code FROM training_session t WHERE t.id = training_session_drill.session_id),
    '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));
-- A plan is replaced whole (the route deletes and inserts): it names nobody,
-- so taking a row off it removes no record of a child.
CREATE POLICY training_session_drill_delete ON training_session_drill
  FOR DELETE USING (app_can('team.training.run',
    (SELECT t.school_id FROM training_session t WHERE t.id = training_session_drill.session_id),
    (SELECT t.team_code FROM training_session t WHERE t.id = training_session_drill.session_id),
    '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- db/06's default privileges give the application SELECT, INSERT and UPDATE
-- on a new table and never DELETE; replacing a plan needs it. A managed
-- host's API roles get nothing of the table.
GRANT SELECT, INSERT, UPDATE, DELETE ON training_session_drill TO scrbrd_app;
DO $plan_platform_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON training_session_drill FROM %I', r);
    END IF;
  END LOOP;
END $plan_platform_roles$;

/**
 * A plan's drill is the session's school's own or a platform drill
 * (school_id NULL, which every signed-in reader reads). A definer, so the
 * answer does not depend on which drills the writer may read.
 */
CREATE OR REPLACE FUNCTION training_session_drill_library() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM drill d, training_session t
                  WHERE d.id = NEW.drill_id AND t.id = NEW.session_id
                    AND (d.school_id IS NULL OR d.school_id = t.school_id)) THEN
    RAISE EXCEPTION 'a drill from another school''s library is not on this school''s plan' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION training_session_drill_library() FROM PUBLIC;

DROP TRIGGER IF EXISTS training_session_drill_from_the_library ON training_session_drill;
CREATE TRIGGER training_session_drill_from_the_library
  BEFORE INSERT OR UPDATE ON training_session_drill
  FOR EACH ROW EXECUTE FUNCTION training_session_drill_library();


-- ── 3b · Who takes the register: team.training.run ─────────────────
-- db/09's two write policies, re-created under the new capability with the
-- same anchors (the session's school and side, the row's boy). The read
-- policy (player.profile.read) is untouched. No DELETE policy, as before.
DROP POLICY IF EXISTS training_attendance_insert ON training_attendance;
CREATE POLICY training_attendance_insert ON training_attendance
  FOR INSERT WITH CHECK (app_can('team.training.run',
    (SELECT t.school_id FROM training_session t WHERE t.id = training_attendance.session_id),
    (SELECT t.team_code FROM training_session t WHERE t.id = training_attendance.session_id),
    training_attendance.player_id, '00000000-0000-0000-0000-000000000000'::uuid));
DROP POLICY IF EXISTS training_attendance_update ON training_attendance;
CREATE POLICY training_attendance_update ON training_attendance
  FOR UPDATE USING (app_can('team.training.run',
    (SELECT t.school_id FROM training_session t WHERE t.id = training_attendance.session_id),
    (SELECT t.team_code FROM training_session t WHERE t.id = training_attendance.session_id),
    training_attendance.player_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WITH CHECK (app_can('team.training.run',
    (SELECT t.school_id FROM training_session t WHERE t.id = training_attendance.session_id),
    (SELECT t.team_code FROM training_session t WHERE t.id = training_attendance.session_id),
    training_attendance.player_id, '00000000-0000-0000-0000-000000000000'::uuid));


-- ── 4 · The register says no health word (AH-D9) ──────────────────
-- Whatever writes it under the application's role. db/08's CHECK still
-- admits `injured` for rows already there; a later migration retires the
-- value once the pilot's rows are re-spelled. Definers and the owner (the
-- seed) are not held by these.
DROP POLICY IF EXISTS training_attendance_no_health_word ON training_attendance;
CREATE POLICY training_attendance_no_health_word ON training_attendance AS RESTRICTIVE FOR INSERT
  WITH CHECK (status <> 'injured');
DROP POLICY IF EXISTS training_attendance_no_health_word_update ON training_attendance;
CREATE POLICY training_attendance_no_health_word_update ON training_attendance AS RESTRICTIVE FOR UPDATE
  USING (true) WITH CHECK (status <> 'injured');


-- ── A pad's resume credential reaches neither table (db/50) ───────
SELECT pad_scope_guard_install('development_target'::regclass)
     + pad_scope_guard_install('training_session_drill'::regclass) AS pad_guards;


-- ── Who may call these: the application, and nobody else ──────────
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['target_set(uuid,text,text,integer,date,uuid,uuid)', 'target_withdraw(uuid,text)',
                               'training_session_drill_library()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  n int;
BEGIN
  -- The tables, under row security.
  IF to_regclass('development_target') IS NULL OR to_regclass('training_session_drill') IS NULL THEN
    RAISE EXCEPTION 'db/105: a table is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'development_target'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'training_session_drill'::regclass) THEN
    RAISE EXCEPTION 'db/105: row security is off on a new table';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('development_target_open')
                    AND i.indisunique AND i.indpred IS NOT NULL) THEN
    RAISE EXCEPTION 'db/105: development_target_open is not a partial unique index';
  END IF;

  -- A target's doors are the functions alone: one SELECT policy, nothing that writes.
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'development_target'
     AND permissive = 'PERMISSIVE';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'development_target'
                              AND policyname = 'development_target_read' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
                              AND qual LIKE '%player.development.read%') THEN
    RAISE EXCEPTION 'db/105: development_target has % permissive policies, not its one read', n;
  END IF;
  IF has_table_privilege('scrbrd_app', 'development_target', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'development_target', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'development_target', 'DELETE')
     OR NOT has_table_privilege('scrbrd_app', 'development_target', 'SELECT') THEN
    RAISE EXCEPTION 'db/105: scrbrd_app may write development_target, or not read it';
  END IF;

  -- The cuts and the register's rule.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
     AND (tablename, policyname, cmd) IN (('development_target', 'development_target_not_support', 'ALL'),
                                          ('training_attendance', 'training_attendance_no_health_word', 'INSERT'),
                                          ('training_attendance', 'training_attendance_no_health_word_update', 'UPDATE'));
  IF n <> 3 THEN RAISE EXCEPTION 'db/105: % of the three RESTRICTIVE policies exist as written', n; END IF;

  -- The plan: four policies, read under team.read, written under team.training.run.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'training_session_drill' AND permissive = 'PERMISSIVE'
     AND ((cmd = 'SELECT' AND qual LIKE '%team.read%')
       OR (cmd = 'INSERT' AND with_check LIKE '%team.training.run%')
       OR (cmd = 'UPDATE' AND qual LIKE '%team.training.run%' AND with_check LIKE '%team.training.run%')
       OR (cmd = 'DELETE' AND qual LIKE '%team.training.run%'));
  IF n <> 4 THEN RAISE EXCEPTION 'db/105: training_session_drill has % of its four policies', n; END IF;
  -- The register: written under the new capability, read as before.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'training_attendance' AND permissive = 'PERMISSIVE'
     AND ((policyname = 'training_attendance_insert' AND cmd = 'INSERT' AND with_check LIKE '%team.training.run%')
       OR (policyname = 'training_attendance_update' AND cmd = 'UPDATE' AND qual LIKE '%team.training.run%'
           AND with_check LIKE '%team.training.run%')
       OR (policyname = 'training_attendance_read' AND cmd = 'SELECT' AND qual LIKE '%player.profile.read%'));
  IF n <> 3 THEN RAISE EXCEPTION 'db/105: training_attendance has % of its three policies as written', n; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
                AND tablename IN ('training_attendance', 'training_session_drill') AND cmd <> 'SELECT'
                AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%team.manage%') THEN
    RAISE EXCEPTION 'db/105: a plan or register write still asks team.manage';
  END IF;
  -- The capability: six holders, the team manager among them.
  SELECT count(*) INTO n FROM role_capability WHERE capability = 'team.training.run'
     AND role IN ('superadmin', 'directorofsport', 'schooladmin', 'sportsadmin', 'coach', 'teammanager');
  IF n <> 6 OR (SELECT count(*) FROM role_capability WHERE capability = 'team.training.run') <> 6 THEN
    RAISE EXCEPTION 'db/105: team.training.run is held by % of its six roles, or by others', n;
  END IF;
  IF NOT (has_table_privilege('scrbrd_app', 'training_session_drill', 'SELECT')
          AND has_table_privilege('scrbrd_app', 'training_session_drill', 'INSERT')
          AND has_table_privilege('scrbrd_app', 'training_session_drill', 'DELETE')) THEN
    RAISE EXCEPTION 'db/105: the application cannot read, write or replace a plan';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE' AND policyname LIKE 'pad\_scope\_%'
     AND tablename IN ('development_target', 'training_session_drill');
  IF n <> 5 THEN RAISE EXCEPTION 'db/105: % of the five pad guards exist (db/50)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'training_session_drill'::regclass
                    AND tgname = 'training_session_drill_from_the_library' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/105: the plan''s library trigger is missing or disabled';
  END IF;

  -- The doors: definers with a pinned path, the application's alone.
  FOREACH f IN ARRAY ARRAY['target_set(uuid,text,text,integer,date,uuid,uuid)', 'target_withdraw(uuid,text)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(f) AND prosecdef AND provolatile = 'v'
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))
                      AND prosrc LIKE '%app_can(''player.development.write''%') THEN
      RAISE EXCEPTION 'db/105: % is not a volatile SECURITY DEFINER asking development.write, with a pinned path', f;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION 'db/105: the application cannot call %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['target_set(uuid,text,text,integer,date,uuid,uuid)', 'target_withdraw(uuid,text)',
                           'training_session_drill_library()'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = to_regprocedure(f) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/105: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  IF has_function_privilege('scrbrd_app', 'training_session_drill_library()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/105: the application can call the plan''s trigger function';
  END IF;
END $check$;


-- ── the ledger row, with the hash the migrator would record and the commit
--    this bundle was generated from ──
INSERT INTO schema_migration (name, sha256, note) VALUES ('105_development_loop.sql', '43ddf27753974afde02645577afa949cb4a3c6e6fc106c72d7a4a82ce7ea9c48', '4789aebecc8b499ccc6eb7dc528735825c05d706');

-- ══════════════════════════════════════════════════════════════════
--  67 · The fixture planner, phase 2: inputs, drafts, publishing (SCRBRD-123)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, with a GENERATED block for the two ground tables' policies.
-- The engine is phase 1 (packages/scoring/src/planner.mjs, no database);
-- the design note is docs/design/SCRBRD-123_planner.md, whose §5 records
-- this file as built. Applies after db/66 and depends on db/61 (the
-- competition's manager, match.competition_id) and db/50 (the pad guard).
--
-- WHAT IS HERE.
--
--   ground.parent_id        a pitch on a field: the ground it lies on, at the
--                           same school, or NULL. No ground lies on itself,
--                           however far up (ground_parent_guard()).
--   ground_closure          a span a ground cannot be used, with a short
--                           reason. The engine closes the ground, the field
--                           it lies on and every pitch on it.
--   ground_window           a slot a ground's owner offers for fixtures: to
--                           one competition, or to any.
--        Both ground tables are the ground owner's: facility.manage at the
--        ground's school, the capability that already keeps `ground` and
--        `ground_condition`, read under facility.read (the floor bundle, as
--        the ground itself is). Generated from tables.mjs; DELETE by hand.
--   competition_blackout    a day a competition does not play, or one entrant
--                           does not (its exams). Written by the competition's
--                           manager, or — for its own entrant only — by whoever
--                           arranges that school's fixtures (fixture.update at
--                           the entrant's school and team): the people who
--                           know a school's exam calendar are the ones who
--                           already put its Saturdays in. Read by the manager;
--                           a competition-wide day by whoever may reach the
--                           competition; an entrant's day by that side
--                           (fixture.read at its school and team).
--   fixture_plan            a versioned draft: the format, the range, the
--                           rules, the entrants in seed order, the locks, the
--                           inputs the engine was given and what it returned.
--                           The server computes it (the API calls pairings()
--                           and plan() over planner_inputs()); a client never
--                           sends a plan. draft → published → superseded;
--                           nothing but its state changes once published.
--                           Read by the competition's manager; by whoever
--                           may reach the competition only once published —
--                           a draft is the organiser's.
--   fixture_plan_item       the match each published fixture made, one per
--                           (competition, fixture id) ever: publishing twice,
--                           or two people at once, makes each match once.
--   planner_inputs()        what the engine is given, read from the database
--                           for the manager: the entrants, the windows offered
--                           to the competition (or to any) in the range, the
--                           grounds they lie on with their fields, pitches and
--                           closures, the blackouts, and every existing
--                           fixture of an entrant side or on one of those
--                           grounds (start, ground, sides, format — no names).
--
-- WHO MANAGES A COMPETITION is db/61's competition_conditions_manager():
-- competition.conditions.manage at the organiser (a platform-wide holder for
-- a competition with no organising school). SCRBRD-125 will scope it to a
-- competition; this file asks the function, not the capability, so it
-- follows when that lands. No new capability.
--
-- PUBLISHING IS THE FIXTURE ROUTE. The API creates each match through the
-- same service function POST /api/fixtures uses (match_insert in db/09 and
-- db/61's match_competition_entered() decide), inside one transaction with
-- fixture_plan_item_record(): a refused fixture leaves no match and no item.
-- fixture_plan_item_begin() takes a per-fixture lock first, so a second
-- publisher waits and then finds the item.
--
-- search_path is pinned on every SECURITY DEFINER function (db/16). Every
-- function the application calls is granted to scrbrd_app and taken back from
-- PUBLIC and a managed host's API roles. Idempotent where it can honestly be.

-- ── 1 · A pitch on a field ─────────────────────────────────────────
ALTER TABLE ground ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES ground(id) ON DELETE SET NULL;
COMMENT ON COLUMN ground.parent_id IS
  'SCRBRD-123: the ground this one lies on (a pitch on a field), at the same school, or NULL. Never a cycle (ground_parent_guard()).';
CREATE INDEX IF NOT EXISTS ground_parent_idx ON ground (parent_id) WHERE parent_id IS NOT NULL;

-- A ground lies on a ground of its own school, never on itself however far
-- up, and at most eight deep. One lock per school, so two writers cannot
-- each close half a cycle at the same time.
CREATE OR REPLACE FUNCTION ground_parent_guard() RETURNS trigger AS $$
DECLARE
  v_at     uuid;
  v_school uuid;
  v_depth  integer := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.school_id IS DISTINCT FROM OLD.school_id
     AND EXISTS (SELECT 1 FROM ground c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'a ground with pitches on it does not move to another school' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.ground_tree'), hashtext(NEW.school_id::text));
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'a ground cannot lie on itself' USING ERRCODE = 'check_violation';
  END IF;
  SELECT g.school_id INTO v_school FROM ground g WHERE g.id = NEW.parent_id;
  IF v_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'a ground lies only on a ground of its own school' USING ERRCODE = 'check_violation';
  END IF;
  v_at := NEW.parent_id;
  WHILE v_at IS NOT NULL LOOP
    IF v_at = NEW.id THEN
      RAISE EXCEPTION 'a ground cannot lie on itself: % is already on it', NEW.parent_id USING ERRCODE = 'check_violation';
    END IF;
    v_depth := v_depth + 1;
    IF v_depth > 8 THEN
      RAISE EXCEPTION 'grounds lie at most eight deep' USING ERRCODE = 'check_violation';
    END IF;
    SELECT g.parent_id INTO v_at FROM ground g WHERE g.id = v_at;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION ground_parent_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS ground_parent_guard ON ground;
CREATE TRIGGER ground_parent_guard BEFORE INSERT OR UPDATE OF parent_id, school_id ON ground
  FOR EACH ROW EXECUTE FUNCTION ground_parent_guard();

-- ── 2 · Closures and windows ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ground_closure (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ground_id   uuid NOT NULL REFERENCES ground(id) ON DELETE CASCADE,
  closed_from timestamptz NOT NULL,
  closed_to   timestamptz NOT NULL,
  reason      text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 120),
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT closure_ends_after_it_starts CHECK (closed_to > closed_from),
  CONSTRAINT closure_within_a_year CHECK (closed_to - closed_from <= interval '366 days')
);
CREATE INDEX IF NOT EXISTS ground_closure_ground_idx ON ground_closure (ground_id, closed_from);
COMMENT ON TABLE ground_closure IS
  'SCRBRD-123: a span a ground cannot be used. The planner closes the ground, the field it lies on and every pitch on it. facility.manage at the ground''s school.';

CREATE TABLE IF NOT EXISTS ground_window (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ground_id      uuid NOT NULL REFERENCES ground(id) ON DELETE CASCADE,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  -- Offered to this competition only, or (NULL) to any.
  competition_id uuid REFERENCES competition(id) ON DELETE CASCADE,
  created_by     uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT window_ends_after_it_starts CHECK (ends_at > starts_at),
  -- The engine's longest match is a week; a window longer is a mistake.
  CONSTRAINT window_at_most_a_week CHECK (ends_at - starts_at <= interval '7 days')
);
CREATE INDEX IF NOT EXISTS ground_window_when_idx ON ground_window (starts_at, ground_id);
COMMENT ON TABLE ground_window IS
  'SCRBRD-123: a slot a ground''s owner offers for fixtures, to one competition or to any. Not a booking. facility.manage at the ground''s school.';

-- Who wrote it is the session's, never the caller's claim.
CREATE OR REPLACE FUNCTION planner_ground_row_stamp() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := app_user_id();
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS planner_ground_row_stamp ON ground_closure;
CREATE TRIGGER planner_ground_row_stamp BEFORE INSERT OR UPDATE ON ground_closure
  FOR EACH ROW EXECUTE FUNCTION planner_ground_row_stamp();
DROP TRIGGER IF EXISTS planner_ground_row_stamp ON ground_window;
CREATE TRIGGER planner_ground_row_stamp BEFORE INSERT OR UPDATE ON ground_window
  FOR EACH ROW EXECUTE FUNCTION planner_ground_row_stamp();

-- ── 3 · Who may read and write them: generated from tables.mjs ─────
-- facility.read to read, facility.manage to write, at the ground's school.
-- ┌── GENERATED from packages/policy/src/tables.mjs by services/api/rls/generate-rls.mjs (TABLES_ADDED_SINCE_09). DO NOT EDIT BY HAND; `pnpm rls:generate` rewrites it.

-- ground_window — read: facility.read · write: facility.manage
ALTER TABLE ground_window ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ground_window_read   ON ground_window;
DROP POLICY IF EXISTS ground_window_insert ON ground_window;
DROP POLICY IF EXISTS ground_window_update ON ground_window;
DROP POLICY IF EXISTS ground_window_delete ON ground_window;

CREATE POLICY ground_window_read ON ground_window
  FOR SELECT USING (app_can('facility.read', (SELECT g.school_id FROM ground g WHERE g.id = ground_window.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY ground_window_insert ON ground_window
  FOR INSERT WITH CHECK (app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_window.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY ground_window_update ON ground_window
  FOR UPDATE USING (app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_window.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_window.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ground_closure — read: facility.read · write: facility.manage
ALTER TABLE ground_closure ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ground_closure_read   ON ground_closure;
DROP POLICY IF EXISTS ground_closure_insert ON ground_closure;
DROP POLICY IF EXISTS ground_closure_update ON ground_closure;
DROP POLICY IF EXISTS ground_closure_delete ON ground_closure;

CREATE POLICY ground_closure_read ON ground_closure
  FOR SELECT USING (app_can('facility.read', (SELECT g.school_id FROM ground g WHERE g.id = ground_closure.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY ground_closure_insert ON ground_closure
  FOR INSERT WITH CHECK (app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_closure.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY ground_closure_update ON ground_closure
  FOR UPDATE USING (app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_closure.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_closure.ground_id), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- └── END GENERATED

-- A window withdrawn, or a ground reopened, is removed: neither is a record
-- about a child, and a planner reading a stale window would offer a slot
-- nobody gave. The same predicate as the write policies above.
GRANT SELECT, INSERT, UPDATE, DELETE ON ground_closure, ground_window TO scrbrd_app;
DROP POLICY IF EXISTS ground_closure_delete ON ground_closure;
CREATE POLICY ground_closure_delete ON ground_closure FOR DELETE USING (
  app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_closure.ground_id), '*'::text,
          '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));
DROP POLICY IF EXISTS ground_window_delete ON ground_window;
CREATE POLICY ground_window_delete ON ground_window FOR DELETE USING (
  app_can('facility.manage', (SELECT g.school_id FROM ground g WHERE g.id = ground_window.ground_id), '*'::text,
          '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ── 4 · Blackouts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competition_blackout (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  day            date NOT NULL,
  -- NULL: nobody in the competition plays. Else this side does not.
  entrant_id     uuid REFERENCES competition_entrant(id) ON DELETE CASCADE,
  reason         text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 120),
  created_by     uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS competition_blackout_once
  ON competition_blackout (competition_id, day, coalesce(entrant_id, '00000000-0000-0000-0000-000000000000'::uuid));
COMMENT ON TABLE competition_blackout IS
  'SCRBRD-123: a day a competition, or one entrant, does not play. The manager writes any; an entrant school (fixture.update at the entrant) its own. Written through competition_blackout_add()/_remove().';

-- May the caller speak for this entrant's calendar: arrange its fixtures
-- (fixture.update at its school and team)?
CREATE OR REPLACE FUNCTION competition_entrant_arranger(p_entrant uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT app_can('fixture.update', e.school_id, coalesce(e.team_code, '*'),
                                  '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
                     FROM competition_entrant e WHERE e.id = p_entrant), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- May the caller read this entrant's fixtures (fixture.read at its school and team)?
CREATE OR REPLACE FUNCTION competition_entrant_reader(p_entrant uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT app_can('fixture.read', e.school_id, coalesce(e.team_code, '*'),
                                  '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
                     FROM competition_entrant e WHERE e.id = p_entrant), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

ALTER TABLE competition_blackout ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competition_blackout_read ON competition_blackout;
CREATE POLICY competition_blackout_read ON competition_blackout FOR SELECT USING (
  competition_conditions_manager(competition_blackout.competition_id)
  OR (competition_blackout.entrant_id IS NULL AND competition_visible(competition_blackout.competition_id))
  OR (competition_blackout.entrant_id IS NOT NULL AND competition_entrant_reader(competition_blackout.entrant_id)));
GRANT SELECT ON competition_blackout TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON competition_blackout FROM scrbrd_app;

-- A day, for the competition or one entrant. Answers rather than raises.
-- A day already there is the same day: its id, not a second row.
CREATE OR REPLACE FUNCTION competition_blackout_add(p_competition uuid, p_day date, p_entrant uuid, p_reason text)
RETURNS TABLE (ok boolean, reason text, detail text, blackout_id uuid) AS $$
DECLARE
  v_manager boolean;
  v_id uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT EXISTS (SELECT 1 FROM competition c WHERE c.id = p_competition) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid; RETURN;
  END IF;
  v_manager := competition_conditions_manager(p_competition);
  IF p_entrant IS NULL THEN
    IF NOT v_manager THEN RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid; RETURN; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM competition_entrant e WHERE e.id = p_entrant AND e.competition_id = p_competition) THEN
    -- Named only to the manager: to anybody else an entrant of another
    -- competition and no entrant at all are the same refusal.
    RETURN QUERY SELECT false, CASE WHEN v_manager THEN 'entrant_invalid' ELSE 'not_permitted' END,
                        CASE WHEN v_manager THEN 'that side has not entered this competition' END, NULL::uuid; RETURN;
  ELSIF NOT (v_manager OR competition_entrant_arranger(p_entrant)) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid; RETURN;
  END IF;
  IF p_day IS NULL THEN RETURN QUERY SELECT false, 'day_required', NULL::text, NULL::uuid; RETURN; END IF;
  IF p_reason IS NOT NULL AND length(btrim(p_reason)) > 120 THEN
    RETURN QUERY SELECT false, 'reason_too_long', 'at most 120 characters', NULL::uuid; RETURN;
  END IF;
  INSERT INTO competition_blackout (competition_id, day, entrant_id, reason, created_by)
  VALUES (p_competition, p_day, p_entrant, nullif(btrim(coalesce(p_reason, '')), ''), app_user_id())
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT b.id INTO v_id FROM competition_blackout b
     WHERE b.competition_id = p_competition AND b.day = p_day AND b.entrant_id IS NOT DISTINCT FROM p_entrant;
  END IF;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Taken off: by the manager, or by the entrant's own school for its own day.
CREATE OR REPLACE FUNCTION competition_blackout_remove(p_id uuid)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE b competition_blackout%ROWTYPE;
BEGIN
  SELECT * INTO b FROM competition_blackout x WHERE x.id = p_id;
  IF NOT FOUND OR app_user_id() IS NULL
     OR NOT (competition_conditions_manager(b.competition_id)
             OR (b.entrant_id IS NOT NULL AND competition_entrant_arranger(b.entrant_id))) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  DELETE FROM competition_blackout WHERE id = p_id;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 5 · Drafts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fixture_plan (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  version        integer NOT NULL CHECK (version >= 1),
  format         text NOT NULL CHECK (format IN ('round_robin', 'double_round_robin', 'knockout')),
  range_from     date NOT NULL,
  range_to       date NOT NULL,
  -- plan()'s rules, in minutes (durationMinutes, preparationMinutes, …).
  rules          jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  -- The entrants as drawn, in seed order: [{ id, schoolId, teamCode, name }].
  entrants       jsonb NOT NULL CHECK (jsonb_typeof(entrants) = 'array'),
  -- [{ fixtureId, windowId }], as the organiser set them.
  locks          jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(locks) = 'array'),
  -- What plan() was given (windows, grounds, blackouts, known), read from
  -- planner_inputs() by the server, and what it returned.
  inputs         jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  plan           jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object' AND jsonb_typeof(plan->'fixtures') = 'array'),
  based_on       uuid REFERENCES fixture_plan(id) ON DELETE SET NULL,
  state          text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'superseded')),
  created_by     uuid NOT NULL REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  computed_at    timestamptz NOT NULL DEFAULT now(),
  published_by   uuid REFERENCES app_user(id),
  published_at   timestamptz,
  superseded_at  timestamptz,
  UNIQUE (competition_id, version),
  CONSTRAINT plan_range_forward CHECK (range_to >= range_from AND range_to - range_from <= 366),
  CONSTRAINT published_plans_are_dated CHECK ((published_at IS NULL) = (published_by IS NULL)
                                              AND (state <> 'published' OR published_at IS NOT NULL)),
  CONSTRAINT superseded_plans_are_dated CHECK (state <> 'superseded' OR superseded_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS fixture_plan_competition_idx ON fixture_plan (competition_id, version DESC);
COMMENT ON TABLE fixture_plan IS
  'SCRBRD-123 phase 2: a versioned fixture plan, computed on the server. draft → published → superseded; nothing but its state changes once published. The competition''s manager reads and writes; others read it only once published.';

-- A plan is its own record: its identity never changes, a published one
-- changes only to superseded, a superseded one never. Stamps who from the
-- session.
CREATE OR REPLACE FUNCTION fixture_plan_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'a fixture plan begins as a draft' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := coalesce(app_user_id(), NEW.created_by);
    NEW.created_at := now(); NEW.computed_at := now();
    NEW.published_by := NULL; NEW.published_at := NULL; NEW.superseded_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.competition_id <> OLD.competition_id OR NEW.version <> OLD.version
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
     OR NEW.based_on IS DISTINCT FROM OLD.based_on THEN
    RAISE EXCEPTION 'a fixture plan''s identity does not change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'superseded' THEN
    RAISE EXCEPTION 'a superseded fixture plan does not change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'published' AND (NEW.state <> 'superseded'
       OR NEW.format <> OLD.format OR NEW.range_from <> OLD.range_from OR NEW.range_to <> OLD.range_to
       OR NEW.rules <> OLD.rules OR NEW.entrants <> OLD.entrants OR NEW.locks <> OLD.locks
       OR NEW.inputs <> OLD.inputs OR NEW.plan <> OLD.plan OR NEW.computed_at <> OLD.computed_at
       OR NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
    RAISE EXCEPTION 'a published fixture plan does not change: make a new version' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'draft' AND NEW.state = 'draft' AND (NEW.published_at IS NOT NULL OR NEW.superseded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a draft is not dated as published or superseded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS fixture_plan_guard ON fixture_plan;
CREATE TRIGGER fixture_plan_guard BEFORE INSERT OR UPDATE ON fixture_plan
  FOR EACH ROW EXECUTE FUNCTION fixture_plan_guard();

ALTER TABLE fixture_plan ENABLE ROW LEVEL SECURITY;
-- A draft is the organiser's: its manager reads it and nobody else, the
-- entrant schools included. Once published, whoever may reach the
-- competition (competition.read through the organiser or an entrant) —
-- and a superseded plan that was once published stays readable.
DROP POLICY IF EXISTS fixture_plan_read ON fixture_plan;
CREATE POLICY fixture_plan_read ON fixture_plan FOR SELECT USING (
  competition_conditions_manager(fixture_plan.competition_id)
  OR (fixture_plan.published_at IS NOT NULL AND competition_visible(fixture_plan.competition_id)));
GRANT SELECT ON fixture_plan TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fixture_plan FROM scrbrd_app;

-- ── 6 · The match each published fixture made ─────────────────────
CREATE TABLE IF NOT EXISTS fixture_plan_item (
  competition_id uuid NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  -- The engine's fixture id: rr:<a>:<b>:<leg> (the pair) or ko:r…:m…:<fingerprint>.
  fixture_key    text NOT NULL CHECK (length(fixture_key) BETWEEN 1 AND 200),
  plan_id        uuid NOT NULL REFERENCES fixture_plan(id) ON DELETE CASCADE,
  -- A match deleted takes its item with it, so a later publish may make it again.
  match_id       uuid NOT NULL UNIQUE REFERENCES match(id) ON DELETE CASCADE,
  -- Where and when it was made, as the plan said; the match may move since.
  starts_at      timestamptz NOT NULL,
  ground_id      uuid REFERENCES ground(id) ON DELETE SET NULL,
  created_by     uuid NOT NULL REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, fixture_key)
);
CREATE INDEX IF NOT EXISTS fixture_plan_item_plan_idx ON fixture_plan_item (plan_id);
COMMENT ON TABLE fixture_plan_item IS
  'SCRBRD-123 phase 2: the match a published plan fixture made. One per (competition, fixture id), ever: a retry or a second publisher makes no second match.';

ALTER TABLE fixture_plan_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fixture_plan_item_read ON fixture_plan_item;
CREATE POLICY fixture_plan_item_read ON fixture_plan_item FOR SELECT USING (
  EXISTS (SELECT 1 FROM fixture_plan p WHERE p.id = fixture_plan_item.plan_id));
GRANT SELECT ON fixture_plan_item TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fixture_plan_item FROM scrbrd_app;

-- ── 7 · Writing plans: the manager's functions ─────────────────────
-- Each answers (ok, reason, detail) rather than raising. None names a
-- competition or a plan to a caller who may not manage it: 'not_permitted'
-- for "no such" and "not yours" alike. The plan itself is the server's
-- computation (planner-api.mjs); these decide who, and keep the versions.

-- A new draft, numbered next for the competition.
CREATE OR REPLACE FUNCTION fixture_plan_save(p_competition uuid, p_format text, p_from date, p_to date, p_rules jsonb,
                                             p_entrants jsonb, p_locks jsonb, p_inputs jsonb, p_plan jsonb, p_based_on uuid)
RETURNS TABLE (ok boolean, reason text, detail text, plan_id uuid, version integer) AS $$
DECLARE
  v_next integer;
  v_id   uuid;
BEGIN
  IF app_user_id() IS NULL OR NOT competition_conditions_manager(p_competition) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid, NULL::integer; RETURN;
  END IF;
  IF p_format IS NULL OR p_format NOT IN ('round_robin', 'double_round_robin', 'knockout') THEN
    RETURN QUERY SELECT false, 'format_invalid', 'round_robin, double_round_robin or knockout', NULL::uuid, NULL::integer; RETURN;
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RETURN QUERY SELECT false, 'range_invalid', 'from on or before to, at most a year apart', NULL::uuid, NULL::integer; RETURN;
  END IF;
  IF p_based_on IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fixture_plan x WHERE x.id = p_based_on AND x.competition_id = p_competition) THEN
    RETURN QUERY SELECT false, 'based_on_invalid', 'not a plan of this competition', NULL::uuid, NULL::integer; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.fixture_plan'), hashtext(p_competition::text));
  SELECT coalesce(max(x.version), 0) + 1 INTO v_next FROM fixture_plan x WHERE x.competition_id = p_competition;
  INSERT INTO fixture_plan (competition_id, version, format, range_from, range_to, rules, entrants, locks, inputs, plan, based_on, created_by)
  VALUES (p_competition, v_next, p_format, p_from, p_to, p_rules, p_entrants, coalesce(p_locks, '[]'), p_inputs, p_plan, p_based_on, app_user_id())
  RETURNING id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id, v_next;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A draft recomputed in place: new locks, the inputs as they are now, and
-- what the engine returned for them. Refused once published.
CREATE OR REPLACE FUNCTION fixture_plan_recompute(p_plan uuid, p_locks jsonb, p_inputs jsonb, p_plan_json jsonb)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE p fixture_plan%ROWTYPE;
BEGIN
  SELECT * INTO p FROM fixture_plan x WHERE x.id = p_plan;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT competition_conditions_manager(p.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  SELECT * INTO p FROM fixture_plan x WHERE x.id = p_plan FOR UPDATE;
  IF p.state <> 'draft' THEN RETURN QUERY SELECT false, 'not_a_draft', p.state; RETURN; END IF;
  UPDATE fixture_plan SET locks = coalesce(p_locks, '[]'), inputs = p_inputs, plan = p_plan_json, computed_at = now()
   WHERE id = p_plan;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Publishing a plan: a draft becomes published and every earlier version not
-- already superseded is superseded. Publishing a published plan again is a
-- retry (first = false): the API then makes whatever fixtures it has not.
-- A superseded plan is not published. Never by a support session.
CREATE OR REPLACE FUNCTION fixture_plan_publish(p_plan uuid)
RETURNS TABLE (ok boolean, reason text, detail text, first boolean) AS $$
DECLARE p fixture_plan%ROWTYPE;
BEGIN
  SELECT * INTO p FROM fixture_plan x WHERE x.id = p_plan;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT competition_conditions_manager(p.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::boolean; RETURN;
  END IF;
  IF app_support_access_id() IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session', 'a support session does not publish fixtures', NULL::boolean; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.fixture_plan'), hashtext(p.competition_id::text));
  SELECT * INTO p FROM fixture_plan x WHERE x.id = p_plan FOR UPDATE;
  IF p.state = 'superseded' THEN
    RETURN QUERY SELECT false, 'superseded', 'a later version was published', NULL::boolean; RETURN;
  END IF;
  IF p.state = 'published' THEN RETURN QUERY SELECT true, NULL::text, NULL::text, false; RETURN; END IF;
  UPDATE fixture_plan SET state = 'published', published_by = app_user_id(), published_at = now() WHERE id = p_plan;
  UPDATE fixture_plan SET state = 'superseded', superseded_at = now()
   WHERE competition_id = p.competition_id AND version < p.version AND state <> 'superseded';
  RETURN QUERY SELECT true, NULL::text, NULL::text, true;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The checks the two item functions share: the caller manages the plan's
-- competition, the plan is published, and it has that fixture. NULL when
-- all hold, else the refusal.
CREATE OR REPLACE FUNCTION fixture_plan_item_refusal(p_plan uuid, p_key text) RETURNS text AS $$
DECLARE p fixture_plan%ROWTYPE;
BEGIN
  SELECT * INTO p FROM fixture_plan x WHERE x.id = p_plan;
  IF NOT FOUND OR app_user_id() IS NULL OR NOT competition_conditions_manager(p.competition_id) THEN RETURN 'not_permitted'; END IF;
  IF p.state <> 'published' THEN RETURN 'not_published'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.plan->'fixtures') f WHERE f->>'id' = p_key) THEN RETURN 'no_such_fixture'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION fixture_plan_item_refusal(uuid, text) FROM PUBLIC;

-- Before making a fixture's match: the per-fixture lock, held to the end of
-- the caller's transaction, and the match it already made, if any. A second
-- publisher waits here and then finds the first's item.
CREATE OR REPLACE FUNCTION fixture_plan_item_begin(p_plan uuid, p_key text)
RETURNS TABLE (ok boolean, reason text, detail text, match_id uuid) AS $$
DECLARE
  v_refusal text := fixture_plan_item_refusal(p_plan, p_key);
  v_comp uuid;
BEGIN
  IF v_refusal IS NOT NULL THEN RETURN QUERY SELECT false, v_refusal, NULL::text, NULL::uuid; RETURN; END IF;
  SELECT x.competition_id INTO v_comp FROM fixture_plan x WHERE x.id = p_plan;
  PERFORM pg_advisory_xact_lock(hashtext('scrbrd.fixture_plan_item'), hashtext(v_comp::text || '|' || p_key));
  RETURN QUERY SELECT true, NULL::text, NULL::text,
    (SELECT i.match_id FROM fixture_plan_item i WHERE i.competition_id = v_comp AND i.fixture_key = p_key);
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- After making it, in the same transaction: the item. The match must be in
-- the plan's competition. A second item for the fixture is a unique
-- violation, which aborts the caller's transaction and its match with it.
CREATE OR REPLACE FUNCTION fixture_plan_item_record(p_plan uuid, p_key text, p_match uuid)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE
  v_refusal text := fixture_plan_item_refusal(p_plan, p_key);
  v_comp uuid;
  m match%ROWTYPE;
BEGIN
  IF v_refusal IS NOT NULL THEN RETURN QUERY SELECT false, v_refusal, NULL::text; RETURN; END IF;
  SELECT x.competition_id INTO v_comp FROM fixture_plan x WHERE x.id = p_plan;
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND OR m.competition_id IS DISTINCT FROM v_comp THEN
    RETURN QUERY SELECT false, 'match_not_in_competition', NULL::text; RETURN;
  END IF;
  INSERT INTO fixture_plan_item (competition_id, fixture_key, plan_id, match_id, starts_at, ground_id, created_by)
  VALUES (v_comp, p_key, p_plan, p_match, m.starts_at, m.ground_id, app_user_id());
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 8 · The read path: what the engine is given ────────────────────
-- An instant as the engine takes it: UTC, to the second, with its "Z".
CREATE OR REPLACE FUNCTION planner_instant(p timestamptz) RETURNS text AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

-- The inputs, for anybody: not granted to the application. The guarded
-- planner_inputs() below is the application's door; the proof at the end
-- of this file reads this one, since a migration has no principal.
--
--   windows    offered to this competition or to any, wholly inside the
--              range's South African days
--   grounds    every ground on the same sites as a window's ground or an
--              existing fixture's: up to the top of its tree and down every
--              pitch, with its closures near the range (a closed field
--              closes its pitches, a closed pitch its field — the engine)
--   blackouts  the competition's, on days in the range
--   known      every fixture not called off, starting from 15 days before
--              the range to 15 days after (rest is at most 14 days), of an
--              entrant side or on one of those grounds: its start, ground,
--              the entrant sides it holds, sport, format and overs (the API
--              derives its end from them), and the plan fixture it was made
--              for when this competition's planner made it. No names, no
--              opponent, no school: a booking is a time and a place.
--   made       every match this competition's planner has made, whenever it
--              is: the fixture it was made for, where and when it is now.
--              A later draw keeps such a fixture where its match is.
CREATE OR REPLACE FUNCTION planner_inputs_for(p_competition uuid, p_from date, p_to date) RETURNS jsonb AS $$
DECLARE
  v_lo   timestamptz := p_from::timestamp AT TIME ZONE 'Africa/Johannesburg';
  v_hi   timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg';
  v_seed uuid[];
  v_tree uuid[];
  c      competition%ROWTYPE;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'a planner range is from on or before to, at most a year apart' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO c FROM competition x WHERE x.id = p_competition;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- The grounds anything in the range touches: windows, and the fixtures of
  -- the entrant sides.
  SELECT array_agg(DISTINCT g) INTO v_seed FROM (
    SELECT w.ground_id AS g FROM ground_window w
     WHERE w.starts_at >= v_lo AND w.ends_at <= v_hi
       AND (w.competition_id IS NULL OR w.competition_id = p_competition)
    UNION
    SELECT m.ground_id FROM match m
      JOIN competition_entrant e ON e.competition_id = p_competition AND e.team_code IS NOT NULL
       AND ((e.school_id = m.school_id AND e.team_code = m.team_code)
            OR (e.school_id = m.away_school_id AND e.team_code = m.away_team_code))
     WHERE m.ground_id IS NOT NULL AND m.status <> 'abandoned'
       AND m.starts_at >= v_lo - interval '15 days' AND m.starts_at < v_hi + interval '15 days') s;

  -- Up each to the top of its site, then down every pitch of that site.
  WITH RECURSIVE up (id, parent_id, depth) AS (
    SELECT g.id, g.parent_id, 0 FROM ground g WHERE g.id = ANY (coalesce(v_seed, '{}'))
    UNION ALL
    SELECT g.id, g.parent_id, u.depth + 1 FROM ground g JOIN up u ON g.id = u.parent_id WHERE u.depth < 16
  ), down (id, depth) AS (
    SELECT u.id, 0 FROM up u WHERE u.parent_id IS NULL
    UNION ALL
    SELECT g.id, d.depth + 1 FROM ground g JOIN down d ON g.parent_id = d.id WHERE d.depth < 16
  )
  SELECT array_agg(DISTINCT id) INTO v_tree FROM down;
  v_tree := coalesce(v_tree, '{}');

  RETURN jsonb_build_object(
    'competition', jsonb_build_object('id', c.id, 'name', c.name, 'format', c.format, 'organiserId', c.school_id),
    'from', to_char(p_from, 'YYYY-MM-DD'), 'to', to_char(p_to, 'YYYY-MM-DD'),
    'entrants', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'schoolId', e.school_id, 'teamCode', e.team_code,
                                                              'name', e.display_name, 'divisionId', e.division_id)
                                           ORDER BY e.display_name, e.id)
                            FROM competition_entrant e WHERE e.competition_id = p_competition), '[]'),
    'windows', coalesce((SELECT jsonb_agg(jsonb_build_object('id', w.id, 'groundId', w.ground_id,
                                                             'startsAt', planner_instant(w.starts_at), 'endsAt', planner_instant(w.ends_at),
                                                             'competitionId', w.competition_id)
                                          ORDER BY w.starts_at, w.id)
                           FROM ground_window w
                          WHERE w.starts_at >= v_lo AND w.ends_at <= v_hi
                            AND (w.competition_id IS NULL OR w.competition_id = p_competition)), '[]'),
    'grounds', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'schoolId', g.school_id, 'parentId', g.parent_id,
                                   'closed', coalesce((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'from', planner_instant(k.closed_from),
                                                                                           'to', planner_instant(k.closed_to), 'reason', k.reason)
                                                                        ORDER BY k.closed_from, k.id)
                                                         FROM ground_closure k
                                                        WHERE k.ground_id = g.id AND k.closed_to > v_lo - interval '1 day'
                                                          AND k.closed_from < v_hi + interval '1 day'), '[]'))
                                          ORDER BY g.name, g.id)
                           FROM ground g WHERE g.id = ANY (v_tree)), '[]'),
    'made', coalesce((SELECT jsonb_agg(jsonb_build_object('fixtureKey', i.fixture_key, 'matchId', m.id, 'groundId', m.ground_id,
                                                          'startsAt', planner_instant(m.starts_at), 'sport', m.sport, 'format', m.format,
                                                          'overs', m.overs, 'status', m.status)
                                       ORDER BY i.fixture_key)
                        FROM fixture_plan_item i JOIN match m ON m.id = i.match_id
                       WHERE i.competition_id = p_competition), '[]'),
    'blackouts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'day', to_char(b.day, 'YYYY-MM-DD'), 'entrantId', b.entrant_id, 'reason', b.reason)
                                            ORDER BY b.day, b.entrant_id NULLS FIRST, b.id)
                             FROM competition_blackout b
                            WHERE b.competition_id = p_competition AND b.day BETWEEN p_from AND p_to), '[]'),
    'known', coalesce((SELECT jsonb_agg(k.doc ORDER BY k.starts_at, k.id) FROM (
        SELECT m.id, m.starts_at, jsonb_build_object(
                 'matchId', m.id, 'groundId', m.ground_id, 'startsAt', planner_instant(m.starts_at),
                 'sport', m.sport, 'format', m.format, 'overs', m.overs,
                 'entrants', coalesce((SELECT jsonb_agg(e.id ORDER BY e.id) FROM competition_entrant e
                                        WHERE e.competition_id = p_competition AND e.team_code IS NOT NULL
                                          AND ((e.school_id = m.school_id AND e.team_code = m.team_code)
                                               OR (e.school_id = m.away_school_id AND e.team_code = m.away_team_code))), '[]'),
                 'fixtureKey', (SELECT i.fixture_key FROM fixture_plan_item i
                                 WHERE i.match_id = m.id AND i.competition_id = p_competition)) AS doc
          FROM match m
         WHERE m.status <> 'abandoned'
           AND m.starts_at >= v_lo - interval '15 days' AND m.starts_at < v_hi + interval '15 days'
           AND (m.ground_id = ANY (v_tree)
                OR EXISTS (SELECT 1 FROM competition_entrant e
                            WHERE e.competition_id = p_competition AND e.team_code IS NOT NULL
                              AND ((e.school_id = m.school_id AND e.team_code = m.team_code)
                                   OR (e.school_id = m.away_school_id AND e.team_code = m.away_team_code))))) k), '[]'));
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION planner_inputs_for(uuid, date, date) FROM PUBLIC;

-- The application's door: the competition's manager, else NULL (the API's
-- not_permitted, which never says whether the competition exists).
CREATE OR REPLACE FUNCTION planner_inputs(p_competition uuid, p_from date, p_to date) RETURNS jsonb AS $$
BEGIN
  IF app_user_id() IS NULL OR NOT competition_conditions_manager(p_competition) THEN RETURN NULL; END IF;
  RETURN planner_inputs_for(p_competition, p_from, p_to);
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 9 · Grants, and the pad's guard ───────────────────────────────
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
      'competition_blackout_add(uuid,date,uuid,text)', 'competition_blackout_remove(uuid)',
      'competition_entrant_arranger(uuid)', 'competition_entrant_reader(uuid)',
      'fixture_plan_save(uuid,text,date,date,jsonb,jsonb,jsonb,jsonb,jsonb,uuid)', 'fixture_plan_recompute(uuid,jsonb,jsonb,jsonb)',
      'fixture_plan_publish(uuid)', 'fixture_plan_item_begin(uuid,text)', 'fixture_plan_item_record(uuid,text,uuid)',
      'planner_inputs(uuid,date,date)', 'planner_instant(timestamptz)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  -- A managed host's API roles (Supabase grants new functions to them).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY[
          'competition_blackout_add(uuid,date,uuid,text)', 'competition_blackout_remove(uuid)',
          'competition_entrant_arranger(uuid)', 'competition_entrant_reader(uuid)',
          'fixture_plan_save(uuid,text,date,date,jsonb,jsonb,jsonb,jsonb,jsonb,uuid)', 'fixture_plan_recompute(uuid,jsonb,jsonb,jsonb)',
          'fixture_plan_publish(uuid)', 'fixture_plan_item_begin(uuid,text)', 'fixture_plan_item_record(uuid,text,uuid)',
          'fixture_plan_item_refusal(uuid,text)', 'planner_inputs(uuid,date,date)', 'planner_inputs_for(uuid,date,date)',
          'planner_instant(timestamptz)', 'ground_parent_guard()', 'planner_ground_row_stamp()', 'fixture_plan_guard()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;

-- Every new table behind RLS carries db/50's restrictive pad guard: a
-- resume credential reads none of them (db/99 §28 checks every table).
SELECT count(pad_scope_guard_install(t::regclass)) AS pad_guards
  FROM unnest(ARRAY['ground_closure', 'ground_window', 'competition_blackout', 'fixture_plan', 'fixture_plan_item']) AS t;

-- ── 10 · The proof ────────────────────────────────────────────────
-- Built and rolled back. db/99 §45 is the fuller proof, with principals, on
-- every verify paste; this is what must hold the moment the file has run.
DO $check$
DECLARE
  v_school uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_comp   uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  g_field  uuid := gen_random_uuid();
  g_pitch  uuid := gen_random_uuid();
  g_far    uuid := gen_random_uuid();
  v_plan   uuid := gen_random_uuid();
  v_in     jsonb;
  got      text;
BEGIN
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db67-' || v_school, 'db/67 proof'), (v_other, 'db67-' || v_other, 'db/67 other');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db67-' || v_user || '@example.invalid', 'db/67 proof', 'coach', v_school);
    INSERT INTO ground (id, school_id, name) VALUES (g_field, v_school, 'db/67 Field'), (g_far, v_other, 'db/67 Elsewhere');
    INSERT INTO ground (id, school_id, name, parent_id) VALUES (g_pitch, v_school, 'db/67 Pitch 1', g_field);

    -- 1. No cycle, however far up; no parent at another school.
    BEGIN
      UPDATE ground SET parent_id = g_pitch WHERE id = g_field;
      RAISE EXCEPTION 'db/67: a field was put on its own pitch';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      UPDATE ground SET parent_id = g_field WHERE id = g_field;
      RAISE EXCEPTION 'db/67: a ground was put on itself';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      UPDATE ground SET parent_id = g_far WHERE id = g_field;
      RAISE EXCEPTION 'db/67: a ground was put on another school''s';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- 2. A window on the pitch and a closure on the field: the inputs carry
    --    the pitch, its field and the field's closure, so the engine closes
    --    the pitch.
    INSERT INTO competition (id, school_id, name, comp_type, format) VALUES (v_comp, v_school, 'db/67 League', 'league', 'T20');
    INSERT INTO ground_window (ground_id, starts_at, ends_at, competition_id)
    VALUES (g_pitch, '2031-03-01 09:00+02', '2031-03-01 13:00+02', v_comp);
    INSERT INTO ground_closure (ground_id, closed_from, closed_to, reason)
    VALUES (g_field, '2031-02-28 00:00+02', '2031-03-02 00:00+02', 'reseeding the square');
    v_in := planner_inputs_for(v_comp, '2031-03-01', '2031-03-01');
    SELECT string_agg(format('%s<%s:%s', g->>'name', coalesce((SELECT x->>'name' FROM jsonb_array_elements(v_in->'grounds') x WHERE x->>'id' = g->>'parentId'), '-'),
                             jsonb_array_length(g->'closed')), ' ' ORDER BY g->>'name')
      INTO got FROM jsonb_array_elements(v_in->'grounds') g;
    IF got IS DISTINCT FROM 'db/67 Field<-:1 db/67 Pitch 1<db/67 Field:0' OR jsonb_array_length(v_in->'windows') <> 1
       OR v_in->'windows'->0->>'startsAt' <> '2031-03-01T07:00:00Z' THEN
      RAISE EXCEPTION 'db/67: the inputs for a pitch window read % and %', got, v_in->'windows';
    END IF;

    -- 3. A published plan does not change but to superseded; a superseded never.
    INSERT INTO fixture_plan (id, competition_id, version, format, range_from, range_to, rules, entrants, inputs, plan, created_by)
    VALUES (v_plan, v_comp, 1, 'round_robin', '2031-03-01', '2031-03-01', '{"durationMinutes": 180}', '[]', '{}', '{"fixtures": []}', v_user);
    UPDATE fixture_plan SET state = 'published', published_by = v_user, published_at = now() WHERE id = v_plan;
    BEGIN
      UPDATE fixture_plan SET plan = '{"fixtures": [{"id": "x"}]}' WHERE id = v_plan;
      RAISE EXCEPTION 'db/67: a published plan changed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    UPDATE fixture_plan SET state = 'superseded', superseded_at = now() WHERE id = v_plan;
    BEGIN
      UPDATE fixture_plan SET state = 'published' WHERE id = v_plan;
      RAISE EXCEPTION 'db/67: a superseded plan changed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    RAISE EXCEPTION USING ERRCODE = 'ZZ067', MESSAGE = 'db/67: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ067' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id IN (v_school, v_other)) THEN
    RAISE EXCEPTION 'db/67: the proof left something behind';
  END IF;
END $check$;

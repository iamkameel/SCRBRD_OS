-- ══════════════════════════════════════════════════════════════════
--  39 · Fixture anchors through match_school() / match_team()
-- ══════════════════════════════════════════════════════════════════
-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.
-- Regenerate with `pnpm rls:generate`. Companion: db/09_rls_policies.sql, which
-- stays exactly as it shipped; this file re-creates 7 of its tables' policies
-- with one change. Their school and team anchors were subqueries against
-- `match`, run under the CALLER's row-level security:
--
--     (SELECT m.school_id FROM match m WHERE m.id = <table>.match_id)
--
-- and are now the SECURITY DEFINER helpers db/02 built for the scoring tables:
--
--     match_school(<table>.match_id), match_team(<table>.match_id)
--
-- The anchor is metadata; app_can() still decides every row. What changes is
-- only that a caller who holds the table's capability but cannot read the
-- match itself no longer gets a NULL anchor and a silent refusal. The audit
-- that decides which tables that is safe for is docs/rls-anchor-audit.md:
--
--   match_toss, match_broadcast, drs_review, match_official,
--   match_pitch_report, match_weather — no role's access changes. Each is
--   read under fixture.read, which IS the match's own read check, and every
--   role holding their write capability also holds fixture.read in the same
--   bundle. Converted so the anchor stops depending on which OTHER
--   assignments a person happens to hold.
--
--   match_availability — a pupil's selfaccess assignment holds
--   availability.read and .declare but not fixture.read, so a boy called up
--   to a side his team assignment cannot see could neither read nor make his
--   OWN statement about that fixture. Now he can, for his own row only: the
--   person anchor is unchanged and still decides whose row it is.
--
-- NOT HERE, on purpose: trip (a driver would read every trip at the school,
-- not his own) and match_squad (a granted enquiry would read which of another
-- side's fixtures a boy is named for). Both wait on a narrower rule the
-- audit proposes.


-- match_toss — read: fixture.read · write: scoring.start
ALTER TABLE match_toss ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_toss_read   ON match_toss;
DROP POLICY IF EXISTS match_toss_insert ON match_toss;
DROP POLICY IF EXISTS match_toss_update ON match_toss;
DROP POLICY IF EXISTS match_toss_delete ON match_toss;

CREATE POLICY match_toss_read ON match_toss
  FOR SELECT USING (app_can('fixture.read', (match_school(match_toss.match_id)), (match_team(match_toss.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_toss.match_id));

CREATE POLICY match_toss_insert ON match_toss
  FOR INSERT WITH CHECK (app_can('scoring.start', (match_school(match_toss.match_id)), (match_team(match_toss.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_toss.match_id));

CREATE POLICY match_toss_update ON match_toss
  FOR UPDATE USING (app_can('scoring.start', (match_school(match_toss.match_id)), (match_team(match_toss.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_toss.match_id))
           WITH CHECK (app_can('scoring.start', (match_school(match_toss.match_id)), (match_team(match_toss.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_toss.match_id));

-- match_broadcast — read: fixture.read · write: broadcast.publish
ALTER TABLE match_broadcast ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_broadcast_read   ON match_broadcast;
DROP POLICY IF EXISTS match_broadcast_insert ON match_broadcast;
DROP POLICY IF EXISTS match_broadcast_update ON match_broadcast;
DROP POLICY IF EXISTS match_broadcast_delete ON match_broadcast;

CREATE POLICY match_broadcast_read ON match_broadcast
  FOR SELECT USING (app_can('fixture.read', (match_school(match_broadcast.match_id)), (match_team(match_broadcast.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_broadcast.match_id));

CREATE POLICY match_broadcast_insert ON match_broadcast
  FOR INSERT WITH CHECK (app_can('broadcast.publish', (match_school(match_broadcast.match_id)), (match_team(match_broadcast.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_broadcast.match_id));

CREATE POLICY match_broadcast_update ON match_broadcast
  FOR UPDATE USING (app_can('broadcast.publish', (match_school(match_broadcast.match_id)), (match_team(match_broadcast.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_broadcast.match_id))
           WITH CHECK (app_can('broadcast.publish', (match_school(match_broadcast.match_id)), (match_team(match_broadcast.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_broadcast.match_id));

-- drs_review — read: fixture.read · write: scoring.correct
ALTER TABLE drs_review ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drs_review_read   ON drs_review;
DROP POLICY IF EXISTS drs_review_insert ON drs_review;
DROP POLICY IF EXISTS drs_review_update ON drs_review;
DROP POLICY IF EXISTS drs_review_delete ON drs_review;

CREATE POLICY drs_review_read ON drs_review
  FOR SELECT USING (app_can('fixture.read', (match_school(drs_review.match_id)), (match_team(drs_review.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, drs_review.match_id));

CREATE POLICY drs_review_insert ON drs_review
  FOR INSERT WITH CHECK (app_can('scoring.correct', (match_school(drs_review.match_id)), (match_team(drs_review.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, drs_review.match_id));

CREATE POLICY drs_review_update ON drs_review
  FOR UPDATE USING (app_can('scoring.correct', (match_school(drs_review.match_id)), (match_team(drs_review.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, drs_review.match_id))
           WITH CHECK (app_can('scoring.correct', (match_school(drs_review.match_id)), (match_team(drs_review.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, drs_review.match_id));

-- match_official — read: fixture.read · write: officiating.assign
ALTER TABLE match_official ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_official_read   ON match_official;
DROP POLICY IF EXISTS match_official_insert ON match_official;
DROP POLICY IF EXISTS match_official_update ON match_official;
DROP POLICY IF EXISTS match_official_delete ON match_official;

CREATE POLICY match_official_read ON match_official
  FOR SELECT USING (app_can('fixture.read', (match_school(match_official.match_id)), (match_team(match_official.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_official.match_id));

CREATE POLICY match_official_insert ON match_official
  FOR INSERT WITH CHECK (app_can('officiating.assign', (match_school(match_official.match_id)), (match_team(match_official.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_official.match_id));

CREATE POLICY match_official_update ON match_official
  FOR UPDATE USING (app_can('officiating.assign', (match_school(match_official.match_id)), (match_team(match_official.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_official.match_id))
           WITH CHECK (app_can('officiating.assign', (match_school(match_official.match_id)), (match_team(match_official.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_official.match_id));

-- match_pitch_report — read: fixture.read · write: facility.manage
ALTER TABLE match_pitch_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_pitch_report_read   ON match_pitch_report;
DROP POLICY IF EXISTS match_pitch_report_insert ON match_pitch_report;
DROP POLICY IF EXISTS match_pitch_report_update ON match_pitch_report;
DROP POLICY IF EXISTS match_pitch_report_delete ON match_pitch_report;

CREATE POLICY match_pitch_report_read ON match_pitch_report
  FOR SELECT USING (app_can('fixture.read', (match_school(match_pitch_report.match_id)), (match_team(match_pitch_report.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_pitch_report.match_id));

CREATE POLICY match_pitch_report_insert ON match_pitch_report
  FOR INSERT WITH CHECK (app_can('facility.manage', (match_school(match_pitch_report.match_id)), (match_team(match_pitch_report.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_pitch_report.match_id));

CREATE POLICY match_pitch_report_update ON match_pitch_report
  FOR UPDATE USING (app_can('facility.manage', (match_school(match_pitch_report.match_id)), (match_team(match_pitch_report.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_pitch_report.match_id))
           WITH CHECK (app_can('facility.manage', (match_school(match_pitch_report.match_id)), (match_team(match_pitch_report.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_pitch_report.match_id));

-- match_weather — read: fixture.read · write: fixture.update
ALTER TABLE match_weather ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_weather_read   ON match_weather;
DROP POLICY IF EXISTS match_weather_insert ON match_weather;
DROP POLICY IF EXISTS match_weather_update ON match_weather;
DROP POLICY IF EXISTS match_weather_delete ON match_weather;

CREATE POLICY match_weather_read ON match_weather
  FOR SELECT USING (app_can('fixture.read', (match_school(match_weather.match_id)), (match_team(match_weather.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_weather.match_id));

CREATE POLICY match_weather_insert ON match_weather
  FOR INSERT WITH CHECK (app_can('fixture.update', (match_school(match_weather.match_id)), (match_team(match_weather.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_weather.match_id));

CREATE POLICY match_weather_update ON match_weather
  FOR UPDATE USING (app_can('fixture.update', (match_school(match_weather.match_id)), (match_team(match_weather.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_weather.match_id))
           WITH CHECK (app_can('fixture.update', (match_school(match_weather.match_id)), (match_team(match_weather.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_weather.match_id));

-- match_availability — read: availability.read · write: availability.declare
ALTER TABLE match_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_availability_read   ON match_availability;
DROP POLICY IF EXISTS match_availability_insert ON match_availability;
DROP POLICY IF EXISTS match_availability_update ON match_availability;
DROP POLICY IF EXISTS match_availability_delete ON match_availability;

CREATE POLICY match_availability_read ON match_availability
  FOR SELECT USING (app_can('availability.read', (match_school(match_availability.match_id)), (match_team(match_availability.match_id)), match_availability.player_id, match_availability.match_id));

CREATE POLICY match_availability_insert ON match_availability
  FOR INSERT WITH CHECK (app_can('availability.declare', (match_school(match_availability.match_id)), (match_team(match_availability.match_id)), match_availability.player_id, match_availability.match_id));

CREATE POLICY match_availability_update ON match_availability
  FOR UPDATE USING (app_can('availability.declare', (match_school(match_availability.match_id)), (match_team(match_availability.match_id)), match_availability.player_id, match_availability.match_id))
           WITH CHECK (app_can('availability.declare', (match_school(match_availability.match_id)), (match_team(match_availability.match_id)), match_availability.player_id, match_availability.match_id));

-- ── Assertion ──────────────────────────────────────────────────────
DO $check$
DECLARE
  p   text;
  r   record;
BEGIN
  FOREACH p IN ARRAY ARRAY['match_toss_read', 'match_toss_insert', 'match_toss_update', 'match_broadcast_read', 'match_broadcast_insert', 'match_broadcast_update', 'drs_review_read', 'drs_review_insert', 'drs_review_update', 'match_official_read', 'match_official_insert', 'match_official_update', 'match_pitch_report_read', 'match_pitch_report_insert', 'match_pitch_report_update', 'match_weather_read', 'match_weather_insert', 'match_weather_update', 'match_availability_read', 'match_availability_insert', 'match_availability_update'] LOOP
    SELECT coalesce(qual, '') || ' ' || coalesce(with_check, '') AS body INTO r
      FROM pg_policies WHERE schemaname = 'public' AND policyname = p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'db/39: policy % is missing', p;
    END IF;
    IF r.body NOT LIKE '%match_school(%' OR r.body NOT LIKE '%match_team(%' THEN
      RAISE EXCEPTION 'db/39: policy % does not anchor through match_school()/match_team()', p;
    END IF;
    IF r.body LIKE '%FROM match %' THEN
      RAISE EXCEPTION 'db/39: policy % still reads match under the caller''s RLS', p;
    END IF;
  END LOOP;
  -- The helpers must still be what db/02 and db/16 made them: definer, pinned.
  FOREACH p IN ARRAY ARRAY['match_school(uuid)', 'match_team(uuid)'] LOOP
    IF NOT coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(p)), false) THEN
      RAISE EXCEPTION 'db/39: % is missing or no longer SECURITY DEFINER', p;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc f, unnest(coalesce(f.proconfig, '{}')) c
                    WHERE f.oid = to_regprocedure(p) AND c = 'search_path=pg_catalog, public, pg_temp') THEN
      RAISE EXCEPTION 'db/39: % does not pin its search_path', p;
    END IF;
  END LOOP;
END $check$;

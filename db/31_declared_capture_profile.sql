-- ══════════════════════════════════════════════════════════════════
--  31 · What an innings DECLARED it would capture — SCRBRD-039
-- ══════════════════════════════════════════════════════════════════
--
-- A capture profile already exists per ball (db/07: ball_event.capture_profile,
-- CHECKed to full | standard | quick) and is carried through quarantine
-- release (db/14). But it is a CONSEQUENCE of the code path — a sector tap
-- writes 'standard', a ball with no placement writes 'quick' — not an intent
-- anybody chose. So nothing could say "this innings was only ever going to
-- capture sectors", and a heat map with nothing on it read as a careless
-- scorer when it may be a faithful record at a profile that never asked for a
-- point.
--
-- WHERE THE DECLARATION LIVES — on the innings_start EVENT, not in a column
-- set beside the log.
--
-- The ball log is the only source of truth (packages/scoring/src/events.mjs):
-- deriveInnings() folds it on the device and every SQL view reads it here. A
-- declaration held anywhere else — a column on match, a settings row — is a
-- second record of the same fact that can disagree with the first, and would
-- need its own write path through the lease, the epoch and quarantine. The
-- innings_start event already travels all of those, and toRow() already maps
-- its `captureProfile` into ball_event.capture_profile, whose CHECK already
-- refuses a value outside the three. So the storage for this is ZERO new
-- columns: an innings_start row with a non-NULL capture_profile IS the
-- declaration, and this file only derives from it, the way the fold does.
--
-- WHY A MIGRATION AT ALL, then: so the database can answer the question the
-- device answers — "what did this innings declare, and how thin is its
-- placement evidence once that is taken into account" — without anyone
-- re-implementing the fold's rules in report code.
--
-- THE THREE RULES, identical to the INNINGS_START case in replay.mjs:
--
--   1. A declaration is honoured only BEFORE the innings' first (non-voided)
--      delivery. It is a promise about balls to come; one that lands after
--      them — typed in late, or released from quarantine to a later seq —
--      would excuse a thin record retrospectively.
--   2. Absence is not a retraction. An innings_start with capture_profile NULL
--      (a re-declaration at the break, an older build) keeps what was declared.
--   3. The latest honoured declaration wins.
--
-- UNDECLARED IS TODAY. An innings with no declaration is taken to have asked
-- for everything, which is how every innings was read before this file: the
-- three-argument evidence_label below returns exactly the one-argument label
-- for it, at every n. Nothing already in the archive reads differently.
--
-- WHAT IS DELIBERATELY NOT CHANGED: opposition_squad (db/08, db/13) keeps the
-- one-argument evidence_label. Its figures are runs, balls, wickets — which
-- every profile collects, quick included — so there is nothing a declaration
-- could excuse there, and routing them through a profile would suggest
-- otherwise. The profile matters for PLACEMENT, and that is where it is read.

-- ── What a declared profile asks the scorer for ─────────────────────
-- 'point' is an exact tap (theta, radius). 'sector' is any placement — a point
-- reduces to its sector, so full collects both. Mirrors PROFILE_COLLECTS in
-- packages/scoring/src/placement.mjs; change one, change both.
CREATE OR REPLACE FUNCTION capture_profile_collects(p_profile text, p_need text)
RETURNS boolean AS $$
BEGIN
  IF p_need IS NULL OR p_need NOT IN ('point', 'sector') THEN
    RAISE EXCEPTION 'capture_profile_collects: % is not a placement field (point, sector)', p_need
      USING ERRCODE = '22023';
  END IF;
  IF p_profile IS NULL THEN RETURN true; END IF;         -- undeclared: read as it always was
  IF p_profile NOT IN ('full', 'standard', 'quick') THEN
    RAISE EXCEPTION 'capture_profile_collects: % is not a capture profile', p_profile
      USING ERRCODE = '22023';
  END IF;
  RETURN CASE p_need
           WHEN 'point'  THEN p_profile = 'full'
           WHEN 'sector' THEN p_profile IN ('full', 'standard')
         END;
END $$ LANGUAGE plpgsql IMMUTABLE;

/**
 * How much evidence is behind a PLACEMENT figure, read against what the
 * innings declared.
 *
 * A new arity of db/08's evidence_label, not a replacement: the one-argument
 * form is untouched and every existing caller resolves to it. This one adds a
 * single outcome, 'not_captured', for a figure with NOTHING behind it from an
 * innings whose declared profile never asked for the field. Everything else —
 * including a stray point tapped in a standard innings, which is real data —
 * is graded by db/08's thresholds exactly as before.
 *
 * 'none' now means one thing: it was asked for, or nothing was declared, and
 * it is not there.
 */
CREATE OR REPLACE FUNCTION evidence_label(p_n bigint, p_declared text, p_need text)
RETURNS text AS $$
BEGIN
  IF coalesce(p_n, 0) = 0 AND NOT capture_profile_collects(p_declared, p_need) THEN
    RETURN 'not_captured';
  END IF;
  -- Validates p_need and p_declared on every path, not only the zero one, so
  -- a misspelt field is an error at n = 40 as well as at n = 0.
  PERFORM capture_profile_collects(p_declared, p_need);
  RETURN evidence_label(p_n);
END $$ LANGUAGE plpgsql IMMUTABLE;

-- ── The declaration, per innings ─────────────────────────────────────
-- security_invoker over ball_event_live, like every view over the log: the
-- reader sees a declaration exactly when they may see the innings_start row
-- it was read off (fixture.read, db/02), and voided rows are already gone.
CREATE OR REPLACE VIEW innings_declared_profile WITH (security_invoker = true) AS
SELECT DISTINCT ON (s.match_id, s.innings)
       s.match_id, s.school_id, s.innings,
       s.capture_profile AS declared_profile,
       s.seq             AS declared_at_seq
  FROM ball_event_live s
 WHERE s.kind = 'innings_start'
   AND s.capture_profile IS NOT NULL                       -- rule 2
   AND NOT EXISTS (                                        -- rule 1
         SELECT 1 FROM ball_event_live b
          WHERE b.match_id = s.match_id AND b.innings = s.innings
            AND b.kind = 'ball' AND b.seq < s.seq)
 ORDER BY s.match_id, s.innings, s.seq DESC;               -- rule 3

-- ── Placement evidence, per innings ──────────────────────────────────
-- One row per innings that has an innings_start or a delivery. `points` is
-- what a heat map may draw; `placed` is anything a wagon wheel may draw (a
-- point or a sector-era seg) — the same two admission tests as hasPoint() and
-- hasPlacement() in placement.mjs.
CREATE OR REPLACE VIEW innings_placement_evidence WITH (security_invoker = true) AS
WITH log AS (
  SELECT b.match_id, b.school_id, b.innings,
         count(*) FILTER (WHERE b.kind = 'ball')                              AS deliveries,
         count(*) FILTER (WHERE b.kind = 'ball' AND b.placement_source = 'point') AS points,
         count(*) FILTER (WHERE b.kind = 'ball' AND (b.theta IS NOT NULL OR b.seg IS NOT NULL)) AS placed
    FROM ball_event_live b
   WHERE b.kind IN ('ball', 'innings_start')
   GROUP BY b.match_id, b.school_id, b.innings
)
SELECT l.match_id, l.school_id, l.innings,
       d.declared_profile,
       l.deliveries::int, l.points::int, l.placed::int,
       evidence_label(l.points, d.declared_profile, 'point')  AS point_evidence,
       evidence_label(l.placed, d.declared_profile, 'sector') AS placement_evidence
  FROM log l
  LEFT JOIN innings_declared_profile d
         ON d.match_id = l.match_id AND d.innings = l.innings;

-- ── Assertion ──────────────────────────────────────────────────────
-- What this file promised, checked in the same paste. A DO block raises, so
-- the transaction the operator wrapped this in rolls back rather than leaving
-- half of it applied. Who may read the views is asserted live in db/99,
-- against the seed; the fold rules against the real API in smoke-fold.
DO $check$
DECLARE
  n  bigint;
  p  text;
  v  text;
BEGIN
  IF to_regprocedure('evidence_label(bigint)') IS NULL THEN
    RAISE EXCEPTION 'db/31: db/08''s evidence_label(bigint) is gone — the dossier depends on it';
  END IF;
  IF to_regprocedure('evidence_label(bigint,text,text)') IS NULL THEN
    RAISE EXCEPTION 'db/31: evidence_label(bigint, text, text) is missing';
  END IF;

  -- Undeclared is today, at every threshold edge.
  FOREACH n IN ARRAY ARRAY[0, 1, 29, 30, 99, 100, 249, 250, 1000]::bigint[] LOOP
    FOREACH v IN ARRAY ARRAY['point', 'sector'] LOOP
      IF evidence_label(n, NULL, v) IS DISTINCT FROM evidence_label(n) THEN
        RAISE EXCEPTION 'db/31: an undeclared innings grades % % as %, not %',
          n, v, evidence_label(n, NULL, v), evidence_label(n);
      END IF;
    END LOOP;
    -- A profile that DID ask for the field never changes the label either.
    IF evidence_label(n, 'full', 'point') IS DISTINCT FROM evidence_label(n)
       OR evidence_label(n, 'standard', 'sector') IS DISTINCT FROM evidence_label(n) THEN
      RAISE EXCEPTION 'db/31: a profile that collects the field moved its label at n = %', n;
    END IF;
  END LOOP;

  -- Not captured by design — only at zero, only when not asked for.
  FOREACH p IN ARRAY ARRAY['standard', 'quick'] LOOP
    IF evidence_label(0, p, 'point') <> 'not_captured' THEN
      RAISE EXCEPTION 'db/31: a % innings with no points reads %, not not_captured', p, evidence_label(0, p, 'point');
    END IF;
  END LOOP;
  IF evidence_label(0, 'quick', 'sector') <> 'not_captured' THEN
    RAISE EXCEPTION 'db/31: a quick innings with no sectors is not read as not_captured';
  END IF;
  IF evidence_label(0, 'standard', 'sector') <> 'none' OR evidence_label(0, 'full', 'point') <> 'none' THEN
    RAISE EXCEPTION 'db/31: a field the profile asked for, and did not get, is excused';
  END IF;
  IF evidence_label(5, 'standard', 'point') <> 'insufficient' THEN
    RAISE EXCEPTION 'db/31: a stray point in a standard innings is hidden rather than graded';
  END IF;

  -- A misspelt field or profile is an error, not a silent 'none'.
  BEGIN
    PERFORM evidence_label(40, NULL, 'points');
    RAISE EXCEPTION 'db/31: evidence_label accepted an unknown field';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM evidence_label(40, 'Full', 'point');
    RAISE EXCEPTION 'db/31: evidence_label accepted an unknown profile';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Both views read the log as the caller, never as their owner.
  IF (SELECT count(*) FROM pg_class
       WHERE relname IN ('innings_declared_profile', 'innings_placement_evidence')
         AND relkind = 'v' AND reloptions @> ARRAY['security_invoker=true']) <> 2 THEN
    RAISE EXCEPTION 'db/31: a declared-profile view runs as its owner and bypasses the ball log''s RLS';
  END IF;
  IF NOT has_table_privilege('scrbrd_app', 'innings_placement_evidence', 'SELECT')
     OR NOT has_table_privilege('scrbrd_app', 'innings_declared_profile', 'SELECT') THEN
    RAISE EXCEPTION 'db/31: the application role cannot read the declared-profile views';
  END IF;
  -- The declaration's storage is db/07's column and CHECK; if either moved,
  -- this file is deriving from nothing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ball_event_capture_profile' AND conrelid = 'ball_event'::regclass) THEN
    RAISE EXCEPTION 'db/31: ball_event.capture_profile has lost the CHECK the declaration relies on';
  END IF;
END $check$;

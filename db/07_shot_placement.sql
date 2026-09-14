-- ════════════════════════════════════════════════════════════════
--  SCRBRD — shot placement: point capture
--
--  Placement moves from one of 36 discrete cells (12 segments × 3 zones) to a
--  captured POINT. The reason is asymmetry: a point can always be reduced to a
--  sector, and a sector can never be recovered as a point. Every ball scored
--  before the cut-over is permanently sector-resolution, so the cut-over is a
--  date rather than a migration.
--
--  There is deliberately NO BACKFILL. A point synthesised from a sector —
--  a centroid, a jitter, a draw from within the wedge — is indistinguishable
--  from a captured one downstream, and would poison every heat map built on
--  this dataset from then on. Sector-era rows keep theta NULL and are excluded
--  from anything that needs a position.
--
--  seg and zone are RETAINED and are now derived from the point at write time,
--  which is what lets point capture ship without rewriting the read side.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE ball_event
  -- Batter-relative polar coordinates. theta is degrees from straight down the
  -- ground, positive towards the leg side; radius is the fraction of the
  -- boundary distance AT THAT BEARING. Both are venue-independent on purpose:
  -- a corrected ground polygon fixes every derived distance retroactively
  -- without touching a single ball.
  ADD COLUMN IF NOT EXISTS theta            smallint,
  ADD COLUMN IF NOT EXISTS radius           numeric(3,2),
  -- How the placement got here. The heat map's admission test.
  ADD COLUMN IF NOT EXISTS placement_source text,
  -- Why there is none. "the scorer skipped it" and "there was no stroke" are
  -- different facts and a blank cannot tell them apart.
  ADD COLUMN IF NOT EXISTS placement_null   text,
  ADD COLUMN IF NOT EXISTS close_position   text,
  ADD COLUMN IF NOT EXISTS capture_profile  text;

-- Quantised on write: whole degrees, two decimals. Float noise implies a
-- precision nobody has — the scorer is estimating from a boundary, not
-- measuring — and inflates every row.
ALTER TABLE ball_event
  DROP CONSTRAINT IF EXISTS ball_event_theta_range,
  DROP CONSTRAINT IF EXISTS ball_event_radius_range,
  DROP CONSTRAINT IF EXISTS ball_event_placement_source,
  DROP CONSTRAINT IF EXISTS ball_event_placement_null,
  DROP CONSTRAINT IF EXISTS ball_event_capture_profile,
  DROP CONSTRAINT IF EXISTS ball_event_point_is_complete,
  DROP CONSTRAINT IF EXISTS ball_event_contact,
  DROP CONSTRAINT IF EXISTS ball_event_trajectory,
  DROP CONSTRAINT IF EXISTS ball_event_trajectory_needs_contact;

ALTER TABLE ball_event
  ADD CONSTRAINT ball_event_theta_range  CHECK (theta IS NULL OR (theta >= 0 AND theta <= 359)),
  ADD CONSTRAINT ball_event_radius_range CHECK (radius IS NULL OR (radius >= 0 AND radius <= 1)),
  ADD CONSTRAINT ball_event_placement_source
    CHECK (placement_source IS NULL OR placement_source IN ('point','sector')),
  ADD CONSTRAINT ball_event_placement_null
    CHECK (placement_null IS NULL OR placement_null IN ('no_contact','not_applicable','not_required','skipped')),
  ADD CONSTRAINT ball_event_capture_profile
    CHECK (capture_profile IS NULL OR capture_profile IN ('full','standard','quick')),
  -- A row claiming to be point-era must actually carry a point. Without this
  -- the heat map's filter is a promise rather than a guarantee, and one bad
  -- writer puts a positionless ball into a positional view.
  ADD CONSTRAINT ball_event_point_is_complete
    CHECK (placement_source IS DISTINCT FROM 'point' OR (theta IS NOT NULL AND radius IS NOT NULL)),
  ADD CONSTRAINT ball_event_contact
    CHECK (contact IS NULL OR contact IN
      ('middle','outside_edge','inside_edge','top_edge','beat','body')),
  ADD CONSTRAINT ball_event_trajectory
    CHECK (trajectory IS NULL OR trajectory IN
      ('ground','aerial','controlled_aerial','miscued')),
  -- A trajectory is the path of a ball OFF THE BAT, so it needs the bat to have
  -- been involved. `beat` means the bat missed and `body` means it hit the
  -- player, and a row claiming a controlled aerial off a delivery that beat the
  -- outside edge is not a scoring mistake — it is a contradiction, and it would
  -- read as a shot in every chart built on this column.
  ADD CONSTRAINT ball_event_trajectory_needs_contact
    CHECK (trajectory IS NULL OR contact NOT IN ('beat','body'));

-- The heat map reads point-era balls for one match or one player. Partial,
-- because the sector era is permanent and will only ever grow as a proportion
-- of the archive — there is no sense indexing rows the query excludes.
CREATE INDEX IF NOT EXISTS ball_event_placement_point
  ON ball_event (match_id, striker_id)
  WHERE placement_source = 'point';

COMMENT ON COLUMN ball_event.theta IS
  'Degrees from straight down the ground, leg-side positive, batter-relative. NULL for sector-era balls — never synthesised from seg.';
COMMENT ON COLUMN ball_event.radius IS
  'Fraction of the boundary distance at this bearing; 1.00 is the rope. True metres are derived from the venue polygon, never stored here.';

-- ── Rebuild ball_event_live so it can see these columns ────────────
--
-- The view is `SELECT b.*`, and Postgres expands that to a FIXED column list
-- at creation time. It was created in 02, this file runs after it, so every
-- column added above is invisible through the view — a query selecting
-- b.theta from ball_event_live fails with 42703 "undefined column", and the
-- one selecting b.placement_source fails the same way.
--
-- 02 already documents this trap: `contact` and `trajectory` were deliberately
-- declared THERE rather than here because "a column added [in 07] never
-- reaches it. The phases endpoint returned nothing at all until they moved
-- here." The placement columns were left on the wrong side of that line and
-- the note did not save them.
--
-- Recreating the view is the fix that holds for the next column too, wherever
-- it is declared. It also matters for correctness rather than convenience:
-- ball_event_live is what excludes VOIDED deliveries, so any placement query
-- forced onto the raw table to reach these columns is a query that draws balls
-- the scorer took back.
--
-- security_invoker is restated deliberately. Without it the view runs as its
-- owner, who owns ball_event and therefore bypasses the row-level policy on
-- it — every reader would see every school's deliveries.
CREATE OR REPLACE VIEW ball_event_live WITH (security_invoker = true) AS
SELECT b.*
  FROM ball_event b
 WHERE b.kind <> 'void'
   AND NOT EXISTS (
         SELECT 1 FROM ball_event v
          WHERE v.match_id = b.match_id
            AND v.kind = 'void'
            AND v.payload->>'target' = b.idempotency_key);

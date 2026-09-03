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
  DROP CONSTRAINT IF EXISTS ball_event_point_is_complete;

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
    CHECK (placement_source IS DISTINCT FROM 'point' OR (theta IS NOT NULL AND radius IS NOT NULL));

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

/**
 * SCRBRD — where the ball went.
 *
 * A captured POINT, not one of thirty-six cells. The distinction is the whole
 * reason this module exists: a point can always be reduced to a sector, and a
 * sector can never be recovered as a point. Every ball scored before point
 * capture is permanently sector-resolution, which is why the cut-over is a
 * date rather than a migration.
 *
 * THE FRAME
 * ─────────
 * `theta` is degrees CLOCKWISE FROM DIRECTLY BEHIND THE BATTER — 12 o'clock —
 * so 180 is straight down the ground toward the bowler, and positive rotation
 * is the leg side for a right-hander. This is the clock convention coaches
 * already speak in, and it is exactly the angle the field graphic draws at:
 *
 *     theta = clock_hour × 30
 *
 * `radius` is the fraction of the boundary distance AT THAT BEARING, so 1.00
 * is the rope. Both are BATTER-RELATIVE, which is the single most important
 * property here: it makes a ball comparable across venues, across pitch
 * orientations, and across left- and right-handers with no transformation at
 * query time. Handedness is applied at render, never to the stored value.
 *
 * WHAT IS NEVER DONE HERE
 * ───────────────────────
 * A point is never synthesised from a sector. No centroid, no jitter, no draw
 * from within the wedge. A fabricated point is indistinguishable from a
 * captured one downstream, and would quietly poison every heat map built on
 * the dataset from then on. Sector-era balls carry theta: null and are
 * excluded from anything that needs a position.
 */

/** How placement got here. `null` means the ball has none — see PLACEMENT_NULL. */
export const PLACEMENT_SOURCE = { POINT: "point", SECTOR: "sector" };

/** Why a ball has no placement. Recorded rather than left blank, because
 *  "there was no stroke" and "the scorer skipped it" are different facts. */
export const PLACEMENT_NULL = {
  NO_CONTACT: "no_contact",         // missed, padded, hit on the body
  NOT_APPLICABLE: "not_applicable", // a wide with no stroke offered
  NOT_REQUIRED: "not_required",     // the capture profile does not ask for it
  SKIPPED: "skipped",               // required, and the scorer moved on
};

/** How much this scorer is capturing. Spatial aggregates require full/standard. */
export const CAPTURE_PROFILE = { FULL: "full", STANDARD: "standard", QUICK: "quick" };

const norm = (deg) => ((Math.round(deg) % 360) + 360) % 360;
const between = (t, a, b) => (a <= b ? t >= a && t < b : t >= a || t < b);

/** Quantise on write. Float noise implies precision nobody has and bloats the row. */
export const quantiseTheta = (deg) => norm(deg);
export const quantiseRadius = (r) => Math.round(Math.min(Math.max(r, 0), 1) * 100) / 100;

/** Coaches speak in clock positions; the frame is built so this is trivial. */
export const thetaFromClock = (hour) => norm(hour * 30);
export const clockFromTheta = (theta) => (Math.round(norm(theta) / 30) % 12) || 12;

/**
 * Batter-relative theta → the angle the field graphic draws at.
 *
 * For a right-hander these are the same number: the frame was chosen to match
 * the wheel. A left-hander is mirrored, which is the defect this replaces —
 * their placement used to be stored against fixed segment angles and was
 * silently wrong for every ball they faced.
 */
export function screenAngle(theta, batHand = "R") {
  if (theta == null) return null;
  return batHand === "L" ? norm(360 - theta) : norm(theta);
}

/** The inverse: a tap on the field graphic → batter-relative theta. */
export function thetaFromScreen(angle, batHand = "R") {
  return batHand === "L" ? norm(360 - angle) : norm(angle);
}

// ── The fielding circle ──────────────────────────────────────────
/**
 * Radius of the 30-yard circle, as a fraction of the boundary.
 *
 * Because `radius` normalises to the rope, the fielding circle sits at a
 * DIFFERENT normalised radius at every ground — about 0.50 at a 55m boundary
 * and 0.40 at 68m. It carries fielding-restriction meaning, so it must be
 * computed from venue geometry and never hardcoded as a fixed band.
 *
 * The default is the fallback for a ground whose boundary nobody has measured
 * yet. It is deliberately a function argument rather than a constant so that
 * "we do not know this ground" is visible at the call site.
 */
export const CIRCLE_RADIUS_M = 27.43;          // 30 yards
export const DEFAULT_BOUNDARY_M = 62;          // a mid-sized school ground
export const fieldingCircle = (boundaryM = DEFAULT_BOUNDARY_M) =>
  Math.min(CIRCLE_RADIUS_M / boundaryM, 0.95);

/**
 * Depth bands. `ring`/`deep` is answered — it is the fielding circle. The two
 * inner boundaries are NOT: they are placeholders to be set from real ground
 * geometry rather than picked, and they are named so that changing them is one
 * edit (spec §11.2).
 */
export const DEPTH = { SILLY: "silly", SHORT: "short", RING: "ring", DEEP: "deep" };
export const SILLY_MAX = 0.11;
export const SHORT_MAX = 0.26;

export function depthBand(radius, { boundaryM } = {}) {
  if (radius == null) return null;
  if (radius < SILLY_MAX) return DEPTH.SILLY;
  if (radius < SHORT_MAX) return DEPTH.SHORT;
  return radius < fieldingCircle(boundaryM) ? DEPTH.RING : DEPTH.DEEP;
}

// ── Angular families ─────────────────────────────────────────────
/**
 * The canonical fielding taxonomy decomposes along exactly our two axes: an
 * angular family crossed with a depth qualifier. Families are given for a
 * RIGHT-HANDER in the clock frame; a left-hander's theta is already mirrored
 * into the same space by being batter-relative, so this table serves both.
 *
 * The table is NOT regular, and the irregularities are the point:
 *   - straight breaks the pattern — `long on` / `long off`, never "deep mid on"
 *   - `backward` denotes behind square and applies only to some families
 *   - behind square on the leg side is crowded: four positions in ~60°
 *   - off side behind square is `third` in modern usage, not third man
 */
const FAMILIES = [
  // from, to, key, ring name, deep name, short name, silly name
  [345, 15,  "straight_behind", "long stop",   "long stop",       "short fine leg", null],
  [15,  40,  "fine_leg",        "fine leg",    "deep fine leg",   "short fine leg", null],
  [40,  70,  "backward_square", "backward square leg", "deep backward square leg", "short leg", null],
  [70,  105, "square_leg",      "square leg",  "deep square leg", "short leg", null],
  [105, 145, "mid_wicket",      "mid-wicket",  "deep mid-wicket", "short mid-wicket", null],
  [145, 175, "mid_on",          "mid on",      "long on",         "short mid on", "silly mid on"],
  [175, 185, "straight",        "straight",    "long on",         "short straight", null],
  [185, 215, "mid_off",         "mid off",     "long off",        "short mid off", "silly mid off"],
  [215, 255, "cover",           "cover",       "deep cover",      "short cover", null],
  [255, 275, "point",           "point",       "deep point",      "short point", "silly point"],
  [275, 310, "backward_point",  "backward point", "deep backward point", "short third", null],
  [310, 345, "third",           "third",       "deep third",      "short third", null],
];

export function angularFamily(theta) {
  if (theta == null) return null;
  const t = norm(theta);
  for (const [a, b, key] of FAMILIES) if (between(t, a, b)) return key;
  return null;
}

// ── The catching ring ────────────────────────────────────────────
/**
 * Below the short band the outfield taxonomy is meaningless — every close
 * catcher falls in the same two or three wedges. This band gets its own
 * vocabulary, and it is where caught-behind dismissals and defended dots
 * belong; neither currently has anywhere sensible to sit.
 */
export const CLOSE_RADIUS = SILLY_MAX;

export const CLOSE_POSITION = {
  KEEPER: "keeper", SLIP: "slip", GULLY: "gully", LEG_SLIP: "leg_slip",
  LEG_GULLY: "leg_gully", SILLY_POINT: "silly_point", SHORT_LEG: "short_leg",
  SHORT_MID_WICKET: "short_mid_wicket", AT_FEET: "at_feet",
};

/** Angular width of one slip, used to derive the ordinal from theta. */
const SLIP_ARC = 8;
const SLIP_FIRST = 352;   // first slip sits just off the keeper's shoulder

/**
 * The close-catching position for a point inside the ring.
 *
 * Slips are ordinal, not a single position, and the ordinal is DERIVED from
 * theta within the cordon rather than asked for — the scorer taps where the
 * catch was taken and the number falls out. Whether that is good enough or
 * whether first and second slip should be distinguished by hand is still open
 * (spec §11.3); deriving it means a later change to the arc re-labels the
 * archive rather than stranding it.
 */
export function closePositionFor(theta, radius) {
  if (theta == null || radius == null || radius >= CLOSE_RADIUS) return null;
  if (radius < 0.03) return CLOSE_POSITION.AT_FEET;
  const t = norm(theta);
  if (between(t, 356, 4)) return CLOSE_POSITION.KEEPER;
  // Off side behind the wicket: the slip cordon, then gully.
  if (between(t, 320, 356)) {
    const n = Math.min(Math.floor((SLIP_FIRST - t + 360) % 360 / SLIP_ARC) + 1, 5);
    return `${CLOSE_POSITION.SLIP}_${n}`;
  }
  if (between(t, 290, 320)) return CLOSE_POSITION.GULLY;
  if (between(t, 255, 290)) return CLOSE_POSITION.SILLY_POINT;
  // Leg side behind the wicket.
  if (between(t, 4, 25)) return CLOSE_POSITION.LEG_SLIP;
  if (between(t, 25, 55)) return CLOSE_POSITION.LEG_GULLY;
  if (between(t, 55, 110)) return CLOSE_POSITION.SHORT_LEG;
  if (between(t, 110, 150)) return CLOSE_POSITION.SHORT_MID_WICKET;
  return CLOSE_POSITION.AT_FEET;   // in front, very close: bat-pad, dropped at the feet
}

/**
 * The position name for a point — derived, never stored.
 *
 * Deriving means the naming table can be corrected, re-banded or localised
 * later without touching a single ball. The alternative — writing "deep cover"
 * onto the delivery — freezes today's taxonomy into the archive.
 */
export function positionName(theta, radius, { boundaryM } = {}) {
  if (theta == null || radius == null) return null;
  const close = closePositionFor(theta, radius);
  if (close) return close.replace(/_/g, " ").replace(/(\d)$/, "$1");
  const t = norm(theta);
  const row = FAMILIES.find(([a, b]) => between(t, a, b));
  if (!row) return null;
  const [, , , ring, deep, short, silly] = row;
  switch (depthBand(radius, { boundaryM })) {
    case DEPTH.SILLY: return silly ?? short ?? ring;
    case DEPTH.SHORT: return short ?? ring;
    case DEPTH.DEEP:  return deep;
    default:          return ring;
  }
}

// ── The sector era's bands, still derived so the read path is untouched ──
/**
 * The three-band zone the sector model used, from a normalised radius.
 *
 * These are DRAWING bands, not the fielding circle — they reproduce what the
 * sector era recorded so that every existing query, aggregate and render keeps
 * working on `zone` exactly as before. The thresholds are the wheel's ring
 * radii as fractions of the rope; round numbers would put balls in a different
 * band than the sector era did, which is the one thing deriving `zone` exists
 * to avoid.
 */
const R_ROPE = 124, R_INNER = 56, R_MIDDLE = 104;
export const ZONE_INNER = R_INNER / R_ROPE;    // 0.45
export const ZONE_OUTER = R_MIDDLE / R_ROPE;   // 0.84

export function zoneFromRadius(radius) {
  if (radius == null) return null;
  if (radius >= ZONE_OUTER) return "boundary";
  if (radius >= ZONE_INNER) return "outer";
  return "inner";
}

/**
 * Which of the twelve sectors a point falls in. Sectors are 30° wide and
 * CENTRED on their nominal angle, so segment 0 spans 345°–15°.
 */
export function segFromScreenAngle(angle) {
  return Math.round(norm(angle) / 30) % 12;
}

/**
 * Build the placement fields for a captured point.
 *
 * `angle` is the SCREEN angle of the tap; theta is derived from it and the
 * striker's handedness. Returns the complete set of fields the ball carries,
 * including the derived seg and zone, so a caller cannot record a point and
 * forget to keep them in step.
 *
 * A tap outside the rope is a six that cleared it: radius clamps to 1.00.
 * Whether to allow radius above 1.00 — the only way to tell a six that just
 * cleared from one that landed in the car park — is still open (spec §11.1).
 */
export function placementFromTap({ angle, radius, batHand = "R", profile = CAPTURE_PROFILE.FULL }) {
  const theta = quantiseTheta(thetaFromScreen(angle, batHand));
  const r = quantiseRadius(radius);
  return {
    theta,
    radius: r,
    placementSource: PLACEMENT_SOURCE.POINT,
    placementNull: null,
    closePosition: closePositionFor(theta, r),
    captureProfile: profile,
    // Derived, not captured. Kept so the sector-era read path is untouched.
    seg: segFromScreenAngle(screenAngle(theta, batHand)),
    zone: zoneFromRadius(r),
  };
}

/** A ball with no placement, and the reason why. */
export function noPlacement(reason, profile = CAPTURE_PROFILE.FULL) {
  return {
    theta: null, radius: null,
    placementSource: null,
    placementNull: reason,
    closePosition: null,
    captureProfile: profile,
    seg: null, zone: null,
  };
}

/** Shots where the bat never touched the ball, so placement is meaningless. */
export const NO_CONTACT_SHOTS = new Set(["missed", "padded", "hit_body", "leave", "beaten"]);

/** Does this ball carry a real captured point? The heat map's admission test. */
export const hasPoint = (b) =>
  b?.placementSource === PLACEMENT_SOURCE.POINT && b.theta != null && b.radius != null;

/**
 * Split a set of balls into those a continuous heat map may use and those it
 * may not, so a view can state the excluded count rather than quietly dropping
 * them. Both halves are honest; neither asks the reader to understand the
 * distinction unless they want to.
 */
export function heatMapEligible(balls = []) {
  const eligible = [], excluded = [];
  for (const b of balls) (hasPoint(b) ? eligible : excluded).push(b);
  return { eligible, excluded, excludedCount: excluded.length };
}

/**
 * Which way the striker bats, from the squad carried on innings_start.
 *
 * Defaults to right-handed, which is the safe default only because it is also
 * the common one — a wrong answer mirrors that batter's whole innings. A
 * left-hander whose profile is incomplete is stored wrong, and the fix is the
 * roster rather than a guess here.
 */
export function batHandOf(inn, playerId = inn?.striker) {
  if (!inn || playerId == null) return "R";
  const p = [...(inn.squad || []), ...(inn.bowlingSquad || [])]
    .find((x) => (x?.id ?? x) === playerId);
  const h = p?.batHand ?? p?.batting_style ?? p?.battingStyle;
  return typeof h === "string" && /^l/i.test(h) ? "L" : "R";
}

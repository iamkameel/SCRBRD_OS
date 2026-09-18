/**
 * SCRBRD — where the ball went, as a surface and as a shape.
 *
 * Two derivations over the same captured placements the wagon wheel draws:
 *
 *   shotDensity        a continuous 2D Gaussian kernel density over the
 *                      ground — where a batter's contact points cluster,
 *                      smoothed so that forty balls read as regions rather
 *                      than forty spokes (SCRBRD-046; scrbrd-beta-2's
 *                      placementEngine specified it and never drew it)
 *   directionalProfile the same balls folded into the angular families of
 *                      placement.mjs — how far, how often and how much, in
 *                      each direction. The spider chart (SCRBRD-045).
 *
 * Both are DERIVED from the ball log and nothing is stored. Both admit only
 * balls with a captured point (`hasPoint`): a sector-era ball knows its
 * wedge and not its distance, and a density built from wedge centroids would
 * be plotting a guess as a position. The excluded count comes back with the
 * result so a view can say what it left out.
 *
 * Both work in the batter-relative frame the placements are stored in and
 * mirror a left-hander exactly as the wheel does (`screenAngle`), resolved
 * per ball from whoever PLAYED it — wheel.test.mjs is the history of getting
 * that wrong.
 *
 * WHAT THE BLUEPRINT ASKED FOR, AND WHAT THE RECORD CAN SAY
 * ─────────────────────────────────────────────────────────
 * The blueprint wanted "batting power, precision and directionality based on
 * the distance the ball travels in various directions". Two of those three
 * are here under the names the data supports:
 *
 *   power         → `reach`, the mean captured radius in a direction, where
 *                   1.00 is the rope. Not a strike rate, not a bat speed: how
 *                   far the ball went.
 *   directionality→ `share`, the fraction of placed balls that went that way.
 *
 * "Precision" is NOT derived, and deliberately. A placement records where the
 * ball landed; nothing records where the batter meant it to go, so the
 * distance between the two — which is what precision would measure — does
 * not exist in the log. A tight cluster of radii in one direction is
 * consistency of outcome, not accuracy of intent, and a coach who reads it as
 * the second is being told something the data does not know. The spread is
 * reported as `spread` (the standard deviation of radius) with that name, and
 * no axis is called precision.
 *
 * A direction with no balls has `reach: null`, never 0: "nothing on record"
 * and "hit it to the keeper's feet" are different facts.
 */
import { ANGULAR_FAMILIES, angularFamily, hasPoint, screenAngle } from "./placement.mjs";

/** A point on the unit disc: theta clockwise from behind the batter, r ≤ 1. */
const toUnit = (theta, radius) => {
  const t = (theta * Math.PI) / 180;
  return { x: radius * Math.sin(t), y: -radius * Math.cos(t) };
};

/** The angle to work in, given who played the ball. */
const frameAngle = (b, batHandFor) => screenAngle(b.theta, batHandFor?.(b) ?? "R");

/**
 * Gaussian kernel density over a regular grid covering the unit disc.
 *
 * `bandwidth` is in disc units — 0.15 is about nine metres on a mid-sized
 * school ground, which is roughly the width of a fielder's patch and is why
 * it is the default. Wider smooths a thin innings into a blur; narrower
 * turns the surface back into spokes.
 *
 * Every ball counts once. A run-weighted surface ("where the runs came from")
 * is a different chart with a different question, and the wheel's colours
 * already answer it per ball; this one is where he makes contact.
 *
 * Density is normalised so the peak cell is 1.0, which means the surface says
 * WHERE, not HOW MUCH — the count is returned beside it for that. Cells whose
 * centre lies outside the disc are not evaluated.
 */
export function shotDensity(balls = [], { bandwidth = 0.15, grid = 24, batHandFor } = {}) {
  const eligible = [], excluded = [];
  for (const b of balls) (hasPoint(b) ? eligible : excluded).push(b);
  const n = eligible.length;
  const result = { cells: [], n, excludedCount: excluded.length, bandwidth, grid, peak: null };
  if (n === 0) return result;

  const pts = eligible.map((b) => toUnit(frameAngle(b, batHandFor), Math.min(Number(b.radius), 1)));
  const h2 = 2 * bandwidth * bandwidth;
  const size = 2 / grid;
  let max = 0;
  for (let i = 0; i < grid; i++) {
    const x = -1 + (i + 0.5) * size;
    for (let j = 0; j < grid; j++) {
      const y = -1 + (j + 0.5) * size;
      if (x * x + y * y > 1.0) continue;
      let d = 0;
      for (const p of pts) {
        const dx = x - p.x, dy = y - p.y;
        d += Math.exp(-(dx * dx + dy * dy) / h2);
      }
      if (d > max) max = d;
      result.cells.push({ x, y, size, density: d });
    }
  }
  for (const c of result.cells) {
    c.density = max > 0 ? c.density / max : 0;
    if (c.density === 1 && !result.peak) result.peak = { x: c.x, y: c.y };
  }
  return result;
}

/**
 * The balls folded into the angular families, one row per family in table
 * order, whether or not anything went that way.
 *
 *   shots   balls with a captured point in this direction
 *   runs    off the bat, those balls
 *   reach   mean radius (1.00 = rope), or null with no balls
 *   spread  standard deviation of radius, or null with fewer than two
 *   share   shots / all placed shots, 0 when nothing went there
 *   yield   runs / shots, or null with no balls
 *
 * Every family's `mid` is the screen angle its axis is drawn at for a
 * right-hander; for a left-hander the caller mirrors the AXES, not the balls,
 * because the families are defined batter-relative and the boy's cover is
 * still his cover.
 */
export function directionalProfile(balls = [], { batHandFor } = {}) {
  const eligible = [], excluded = [];
  for (const b of balls) (hasPoint(b) ? eligible : excluded).push(b);
  const n = eligible.length;
  const bins = new Map(ANGULAR_FAMILIES.map((f) => [f.key, []]));
  for (const b of eligible) {
    // The family is a property of the BATTER-RELATIVE angle, so a
    // left-hander's cover drive lands in `cover` — mirroring happens when the
    // axes are drawn, never here.
    const key = angularFamily(b.theta);
    if (key) bins.get(key).push(b);
  }
  const directions = ANGULAR_FAMILIES.map((f) => {
    const bs = bins.get(f.key);
    const radii = bs.map((b) => Math.min(Number(b.radius), 1));
    const shots = bs.length;
    const runs = bs.reduce((s, b) => s + (Number(b.value) || 0), 0);
    const reach = shots ? radii.reduce((a, r) => a + r, 0) / shots : null;
    const spread = shots > 1
      ? Math.sqrt(radii.reduce((a, r) => a + (r - reach) ** 2, 0) / (shots - 1))
      : null;
    return { key: f.key, label: f.label, mid: f.mid, shots, runs, reach, spread,
             share: n ? shots / n : 0, yield: shots ? runs / shots : null };
  });
  const strongest = directions.reduce((best, d) => (d.shots > (best?.shots ?? 0) ? d : best), null);
  return { directions, n, excludedCount: excluded.length, strongest: strongest?.key ?? null };
}

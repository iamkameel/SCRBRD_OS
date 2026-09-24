/**
 * The density surface and the directional profile: derived, mirrored, and
 * honest about what they leave out.
 *
 * Falsified by (a) removing the normalisation in shotDensity and confirming
 * "the peak is exactly 1" goes red, (b) dropping the hasPoint admission and
 * confirming the sector-era assertions go red, and (c) returning 0 instead of
 * null for an empty direction and confirming the "never a zero" line catches
 * it.
 *
 *   node packages/scoring/test/spatial.test.mjs
 */
import { shotDensity, directionalProfile, ANGULAR_FAMILIES, angularFamily } from "../src/index.mjs";

let pass = 0, fail = 0;
/** @param {string} n  @param {unknown} c  @param {string} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
/**
 * The value an assertion reads, which the setup guarantees is there: a
 * missing one fails the suite loudly instead of being read as a property.
 * @template T  @param {T} x  @returns {NonNullable<T>}
 */
const must = (x) => { if (x == null) throw new Error("spatial.test: expected a value"); return x; };

/** @param {number} theta  @param {number} radius  @param {number} [value]  @param {{strikerId?: string}} [extra] */
const point = (theta, radius, value = 1, extra = {}) =>
  ({ placementSource: "point", theta, radius, value, type: "run", ...extra });
/** @param {number} seg  @param {number} [value] */
const sector = (seg, value = 1) => ({ placementSource: "sector", seg, value, type: "run" });
/** @param {number | null} a  a figure that may be null (null subtracts as 0)  @param {number} b  @param {number} [eps] */
const near = (a, b, eps = 1e-9) => Math.abs(/** @type {number} */ (a) - b) < eps;
/** @param {number} theta  @param {number} r */
const unit = (theta, r) => ({ x: r * Math.sin(theta * Math.PI / 180), y: -r * Math.cos(theta * Math.PI / 180) });
/** @param {{cells: {x: number, y: number, density: number}[]}} res  @param {number} theta  @param {number} r */
const cellAt = (res, theta, r) => {
  const u = unit(theta, r);
  return res.cells.reduce((best, c) =>
    (Math.hypot(c.x - u.x, c.y - u.y) < Math.hypot(best.x - u.x, best.y - u.y) ? c : best));
};

// ══════════════════════════════════════════════════════════════════
group("The density surface");
{
  const empty = shotDensity([]);
  ok("nothing in gives nothing out, and says so", empty.n === 0 && empty.cells.length === 0 && empty.peak === null);

  const one = shotDensity([point(300, 0.8)]);
  ok("one ball evaluates the whole disc", one.cells.length > 400, `${one.cells.length} cells`);
  ok("...and no cell outside it", one.cells.every((c) => c.x * c.x + c.y * c.y <= 1));
  ok("the peak is exactly 1", Math.max(...one.cells.map((c) => c.density)) === 1);
  ok("...and sits where the ball landed",
     near(must(one.peak).x, unit(300, 0.8).x, one.cells[0].size) && near(must(one.peak).y, unit(300, 0.8).y, one.cells[0].size),
     JSON.stringify(one.peak));
  ok("the far side of the ground is empty", cellAt(one, 120, 0.8).density < 0.001);

  // Twenty through the covers and one to fine leg: the covers are the peak,
  // fine leg is a bump, and the bump is real rather than smoothed away.
  const covers = Array.from({ length: 20 }, (_, i) => point(235 + (i % 5) * 4, 0.6 + (i % 3) * 0.1));
  const mixed = shotDensity([...covers, point(28, 0.5)]);
  ok("the cluster is the peak", cellAt(mixed, 243, 0.7).density > 0.8, String(cellAt(mixed, 243, 0.7).density));
  const bump = cellAt(mixed, 28, 0.5).density;
  ok("a lone shot elsewhere is a small bump, not nothing", bump > 0.02 && bump < 0.2, String(bump));

  // Bandwidth: wider is flatter. The ratio of the trough between two
  // clusters to the peak rises as the kernels overlap.
  const two = [point(60, 0.7), point(300, 0.7)];
  const troughOver = (/** @type {number} */ bw) => cellAt(shotDensity(two, { bandwidth: bw }), 0, 0.7).density;
  ok("a wider bandwidth fills the gap between two shots", troughOver(0.5) > troughOver(0.1));

  const sectors = shotDensity([point(300, 0.8), sector(9), sector(10), { placementSource: "point", theta: 300, radius: null }]);
  ok("sector-era balls are left out of the surface", sectors.n === 1);
  ok("...and counted, so a view can say so", sectors.excludedCount === 3);
  ok("a point with no radius is not a point", sectors.n === 1);

  // The mirror. The same stored angle, one right-hander and one left-hander:
  // opposite sides of the ground, resolved per ball from who played it.
  /** @type {Record<string, string>} */
  const hands = { r: "R", l: "L" };
  const byHand = shotDensity([point(300, 0.8, 4, { strikerId: "r" }), point(300, 0.8, 4, { strikerId: "l" })],
                             { batHandFor: (b) => hands[must(b.strikerId)] });
  const rh = cellAt(byHand, 300, 0.8).density, lh = cellAt(byHand, 60, 0.8).density;
  ok("a left-hander's shot is mirrored across the ground", rh > 0.9 && lh > 0.9, `RH side ${rh}, LH side ${lh}`);
  const unmirrored = shotDensity([point(300, 0.8), point(300, 0.8)]);
  ok("...and without a hand every ball is a right-hander's", cellAt(unmirrored, 60, 0.8).density < 0.001);
}

// ══════════════════════════════════════════════════════════════════
group("The directional profile");
{
  const empty = directionalProfile([]);
  ok("every family is present even with nothing recorded", empty.directions.length === ANGULAR_FAMILIES.length);
  ok("an empty direction has no reach — null, never a zero",
     empty.directions.every((d) => d.reach === null && d.yield === null && d.spread === null && d.shots === 0));
  ok("...and no strongest direction", empty.strongest === null && empty.n === 0);

  const balls = [
    point(240, 0.9, 4), point(245, 0.5, 1), point(250, 0.7, 2),   // cover ×3
    point(90, 1.0, 6),                                            // square leg ×1
    sector(3, 4), { placementSource: "point", theta: null, radius: null, value: 0 },
  ];
  const prof = directionalProfile(balls);
  const cover = must(prof.directions.find((d) => d.key === "cover"));
  const sq = must(prof.directions.find((d) => d.key === "square_leg"));
  ok("shots per direction are counted", cover.shots === 3 && sq.shots === 1);
  ok("the counts add up to the placed balls", prof.directions.reduce((s, d) => s + d.shots, 0) === prof.n && prof.n === 4);
  ok("reach is the mean radius", near(cover.reach, 0.7) && near(sq.reach, 1.0));
  ok("spread is the sample standard deviation, and null for one ball",
     near(cover.spread, 0.2) && sq.spread === null, String(cover.spread));
  ok("share is a fraction of the placed balls", near(cover.share, 0.75) && near(sq.share, 0.25));
  ok("...and sums to one", near(prof.directions.reduce((s, d) => s + d.share, 0), 1));
  ok("yield is runs per shot", near(cover.yield, 7 / 3) && sq.yield === 6);
  ok("the strongest direction is the one with most balls, not most runs", prof.strongest === "cover");
  ok("the two balls without a point are left out and counted", prof.excludedCount === 2);
  ok("every axis carries the angle it is drawn at", prof.directions.every((d) => typeof d.mid === "number"));

  // The families are batter-relative, so a left-hander's cover drive is still
  // a cover drive. Mirroring is for the axes, not the bins.
  const lh = directionalProfile([point(245, 0.8, 4, { strikerId: "l" })], { batHandFor: () => "L" });
  ok("a left-hander's cover drive is binned as cover", lh.directions.find((d) => d.key === "cover")?.shots === 1);

  ok("the axis table agrees with angularFamily at every midpoint",
     ANGULAR_FAMILIES.every((f) => angularFamily(f.mid) === f.key));
  ok("the wrap-around family sits at zero", ANGULAR_FAMILIES.find((f) => f.key === "straight_behind")?.mid === 0);
}

console.log(`\n${"─".repeat(52)}\nSPATIAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * The radar's geometry, and the data each caller hands it (GA-I06).
 *
 * The chart used to divide every value by a hard-coded 100. Skills are rated
 * 1 to 20, so a 20 out of 20 was drawn a fifth of the way out and an excellent
 * player looked weak. The scale is now an argument with no default: a caller
 * says what the outer ring MEANS, and a caller that does not is drawn nothing
 * rather than a plausible, wrong shape.
 *
 * Pure: no DOM, no React. ui/primitives.jsx draws what this returns, and
 * apps/web/test/radar.test.mjs holds it to the rubric.
 */

/**
 * The outer ring of a rubric chart: the top of the 1-20 scale. A copy of
 * SCALE_MAX (packages/scoring/src/rubric.mjs) rather than an import, because
 * ui/primitives.jsx is in the entry chunk and the scoring barrel is not;
 * apps/web/test/radar.test.mjs holds the two equal.
 */
export const RUBRIC_MAX = 20;

/** Rings drawn inside the outer one, as fractions of it. The last IS the outer ring. */
export const RADAR_RINGS = Object.freeze([0.2, 0.4, 0.6, 0.8, 1]);

/** Above this many axes the labels would collide, so none are drawn on the chart. */
export const MAX_LABELLED_AXES = 6;

const FONT = 12;                 // the floor: nothing under 12px
const CHAR = 6.6;                // a generous 12px advance, so a label is never clipped
const GAP = 8;                   // between the outer ring and a label
const WRAP_AT = 11;              // characters before a label takes a second line

/** "lineAndLength" becomes "Line and length"; a word already set ("Technical") is left alone. @param {string} key */
export function radarLabelOf(key) {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Up to two lines, broken at a space near WRAP_AT. @param {string} label */
function wrap(label) {
  if (label.length <= WRAP_AT) return [label];
  const at = label.lastIndexOf(" ", WRAP_AT);
  if (at <= 0) return [label];
  return [label.slice(0, at), label.slice(at + 1)];
}

/** A value's distance from the centre as a fraction of the outer ring, held to 0..1. */
export const radarRatio = (value, max) => (Number.isFinite(value) && max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0);

/**
 * Where everything goes.
 *
 * @param {{ data: Record<string, number>, max: number, size?: number }} o
 *   `max` is the value that reaches the outer ring: 20 for a rubric rating,
 *   100 for a caller that has already put its figures on 0-100.
 * @returns {null | {
 *   width: number, height: number, cx: number, cy: number, r: number, labelled: boolean,
 *   rings: string[], spokes: [number, number][], dots: [number, number][], polygon: string,
 *   ratios: number[], labels: { key: string, lines: string[], x: number, y: number, anchor: string }[]
 * }}  null when there is nothing honest to draw: no usable max, or fewer than three axes.
 */
export function radarGeometry({ data, max, size = 160 }) {
  if (!Number.isFinite(max) || max <= 0) return null;
  const keys = Object.keys(data ?? {});
  const n = keys.length;
  if (n < 3) return null;

  const labelled = n <= MAX_LABELLED_AXES;
  const lines = keys.map((k) => wrap(radarLabelOf(k)));
  const room = labelled ? Math.ceil(Math.max(...lines.flat().map((l) => l.length)) * CHAR) + GAP : 6;
  const above = labelled ? FONT * 2 + GAP : 6;       // room for a two-line label above or below
  const r = size / 2;
  const width = Math.round(size + room * 2), height = Math.round(size + above * 2);
  const cx = width / 2, cy = height / 2;
  const angle = (i) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const at = (i, ratio) => /** @type {[number, number]} */ ([cx + r * ratio * Math.cos(angle(i)), cy + r * ratio * Math.sin(angle(i))]);
  const fmt = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

  const ratios = keys.map((k) => radarRatio(data[k], max));
  const dots = ratios.map((q, i) => at(i, q));
  const labels = labelled ? keys.map((key, i) => {
    const [x, y] = at(i, 1);
    const dx = Math.cos(angle(i)), dy = Math.sin(angle(i));
    const anchor = Math.abs(dx) < 0.2 ? "middle" : dx > 0 ? "start" : "end";
    const l = lines[i];
    // Pushed out along the axis; a label above the chart grows upward, one
    // below grows downward, and a side label is centred on the axis's height.
    const lx = x + dx * GAP, ly = y + dy * GAP;
    const top = dy < -0.2 ? ly - (l.length - 1) * FONT : dy > 0.2 ? ly + FONT * 0.8 : ly - ((l.length - 1) * FONT) / 2 + FONT * 0.35;
    return { key, lines: l, x: lx, y: top, anchor };
  }) : [];

  return {
    width, height, cx, cy, r, labelled, ratios, dots, labels,
    rings: RADAR_RINGS.map((g) => keys.map((_, i) => fmt(at(i, g))).join(" ")),
    spokes: keys.map((_, i) => at(i, 1)),
    polygon: dots.map(fmt).join(" "),
  };
}

/**
 * The Profiles caller's data: one axis per category the ratings carry, the mean
 * of its 1-20 ratings, still on 1-20 (the chart is told max={RUBRIC_MAX}).
 * @param {Record<string, Record<string, number>> | null | undefined} byCategory
 * @returns {Record<string, number>}
 */
export function categoryMeans(byCategory) {
  const out = {};
  for (const [cat, vals] of Object.entries(byCategory ?? {})) {
    const xs = Object.values(vals ?? {}).filter(Number.isFinite);
    if (!xs.length) continue;
    out[cat.charAt(0).toUpperCase() + cat.slice(1)] = Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  }
  return out;
}

/**
 * The Squad caller's data: the same means, put on 0-100 (five to the rating)
 * and rounded as that screen always did, so its figures do not move. The chart
 * is told max={100} for it.
 * @param {Record<string, Record<string, number>> | null | undefined} byCategory
 * @returns {Record<string, number>}
 */
export function categoryMeansOn100(byCategory) {
  const out = {};
  for (const [cat, vals] of Object.entries(byCategory ?? {})) {
    const xs = Object.values(vals ?? {}).filter(Number.isFinite);
    if (!xs.length) continue;
    out[cat.charAt(0).toUpperCase() + cat.slice(1)] = Math.round(5 * xs.reduce((a, b) => a + b, 0) / xs.length);
  }
  return out;
}

/** The words a screen reader gets in place of the shape: "Technical 14 of 20, Mental 17 of 20". */
export const radarSummary = (data, max) =>
  Object.entries(data ?? {}).map(([k, v]) => `${radarLabelOf(k)} ${Number.isFinite(v) ? Math.round(v * 10) / 10 : "not rated"} of ${max}`).join(", ");

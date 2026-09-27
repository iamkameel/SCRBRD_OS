/**
 * SCRBRD — the wagon-wheel analysis panel's counting rules (SCRBRD-102).
 *
 * Pure functions over a ball log: which side of the ground a ball went to,
 * which of the eight named areas, and the run chips a viewer taps to isolate
 * a subset of spokes. Nothing here draws anything — see wagonAnalysisPanel.jsx
 * for the thin component that reads these numbers onto the field.
 *
 * FROM TWELVE SECTORS TO EIGHT NAMED AREAS
 * ─────────────────────────────────────────
 * placement.mjs's SECTORS names all twelve batter-relative wedges, and
 * field.js's RIM already picks the eight of them a broadcast graphic names on
 * the rope — third man, point, cover, long off, long on, mid-wicket, square
 * leg, fine leg — leaving out two that sit BEHIND their square neighbour
 * (backward point, backward square leg) and two that are dead straight
 * (straight, straight behind). SCRBRD-102 asks for exactly those eight areas,
 * four a side, so RIM's own words are reused rather than re-typed: this
 * module folds the two "backward" sectors into the neighbour they qualify —
 * "backward" means "behind square", not "a different area" — and leaves the
 * two straight ones out of every area and every side, because sideOf()
 * already calls them neither off nor on.
 *
 * A ball's sector is read through sectorOf() — the one function that already
 * knows whether a ball is a measured point or a sector-era guess, and
 * resolves either to the batter-relative wedge — so nothing here re-derives
 * an angle. See placement.mjs for why theta is always batter-relative (a
 * point-era ball needs no hand at all) and why a sector-era ball's stored
 * `seg` does (it is the screen sector, read back through batterSector()).
 */
import { SECTORS, sectorOf } from "@scrbrd/scoring";
import { RIM } from "./field.js";

/**
 * Each of RIM's eight keys, plus the two "backward" sectors folded into the
 * neighbour they qualify, and the two straight ones mapped to nothing.
 * @type {Readonly<Record<string, string | null>>}
 */
const AREA_OF_FAMILY = Object.freeze({
  third: "third", point: "point", backward_point: "point", cover: "cover", mid_off: "mid_off",
  fine_leg: "fine_leg", backward_square: "square_leg", square_leg: "square_leg", mid_wicket: "mid_wicket", mid_on: "mid_on",
  straight_behind: null, straight: null,
});

const sideOfKey = (key) => /** @type {"off" | "leg"} */ (SECTORS.find((s) => s.key === key)?.side);

/**
 * The eight areas, off side then on side, in the order SCRBRD-102 lists them
 * — third man round to long off, then fine leg round to long on. Labels are
 * RIM's own (positionName's deep names for long off/long on, the ring names
 * for the rest): nothing here re-types a fielding position's name.
 */
export const AREAS = Object.freeze(["third", "point", "cover", "mid_off", "fine_leg", "square_leg", "mid_wicket", "mid_on"]
  .map((key) => {
    const r = /** @type {{key: string, theta: number, label: string}} */ (RIM.find((x) => x.key === key));
    return Object.freeze({ key, label: r.label, theta: r.theta, side: sideOfKey(key) });
  }));

/** The run chips SCRBRD-102 offers, in order. A 5 is folded into "4" — the
 *  scorer's own legend (field.js LK_COLS) already gives it the four's
 *  colour, and the backlog names no chip of its own for it. */
export const CHIP_VALUES = Object.freeze(["1", "2", "3", "4", "6"]);

/** @param {{value?: number | null, type?: string | null}} ball  @returns {string | null} */
export function chipKeyOf(ball) {
  if (ball?.type === "W") return null;
  const v = Number(ball?.value);
  if (!Number.isFinite(v)) return null;
  if (v === 5) return "4";
  return CHIP_VALUES.includes(String(v)) ? String(v) : null;
}

/** Whether a ball carries any placement at all — a captured point, or a
 *  sector-era seg — the same admission test the wheel itself draws by. */
export const isPlaced = (b) => b?.theta != null || b?.seg != null;

/**
 * A ball's area and side, from its batter-relative sector.
 * @param {object} ball  a ball off the log, as sectorOf() reads it
 * @param {string} [batHand]  the hand of whoever PLAYED this ball
 * @returns {{sector: number | null, area: string | null, side: "off" | "leg" | null}}
 */
export function ballArea(ball, batHand = "R") {
  const sector = sectorOf(ball, batHand);
  if (sector == null) return { sector: null, area: null, side: null };
  const key = SECTORS[sector].key;
  const area = AREA_OF_FAMILY[key] ?? null;
  return { sector, area, side: area ? sideOfKey(key) : null };
}

/**
 * Balls matching a batter/bowler/match filter. `null` (the default) in any
 * one of them means "don't filter on this" — a profile fixes batterId itself
 * and offers only a bowler (and, cheaply, a match); the Match Centre offers
 * either or neither.
 * @param {object[]} [balls]
 * @param {{batterId?: string | null, bowlerId?: string | null, matchId?: string | null}} [f]
 */
export function filterBalls(balls = [], { batterId = null, bowlerId = null, matchId = null } = {}) {
  return balls.filter((b) =>
    (batterId == null || b.strikerId === batterId) &&
    (bowlerId == null || b.bowlerId === bowlerId) &&
    (matchId == null || b.matchId === matchId));
}

/**
 * The whole analysis, in one pass over an already-filtered ball set.
 *
 * `chips` gives every chip SCRBRD-102 offers, plus `all`, each with the
 * count of PLACED balls it would show if tapped — `all` is every placed
 * ball regardless of value, so the panel's default view and its own count
 * agree with the sum a viewer can check by eye.
 *
 * `shown` is the balls a chip selection draws: every placed ball with `chip`
 * null, or only those matching it.
 *
 * `sides` gives each side's runs and its share of the CLASSIFIED total — off
 * runs plus on runs, not every run in the log — because a ball dead straight
 * or carrying no placement at all belongs to neither, and a percentage that
 * pretended otherwise would not add up to what the eight areas below it do.
 *
 * `areas` is all eight named areas, always, each with its runs and its
 * boundary count (fours and sixes), zero rather than omitted when nothing
 * went there, so a panel can draw all eight every time.
 *
 * `excluded` says what a percentage or an area could not use: `unplaced`
 * (no theta and no seg at all — a leave, a pad, an unassessed delivery) and
 * `straight` (a real placement, dead straight or dead behind the stumps,
 * which sideOf() calls neither off nor on). Both are counted rather than
 * silently folded into a side, which is SCRBRD-102's own instruction for a
 * sector-era ball whose wedge cannot be placed precisely, extended to a
 * point-era ball that lands on the same two lines.
 *
 * @param {object[]} [balls]  already filtered to the batter/bowler/match in view
 * @param {{batHandFor?: (b: object) => string, chip?: string | null}} [opts]
 *   batHandFor: the hand of whoever played a given ball; defaults to "R" for
 *   every ball, which is wrong only for a left-hander's sector-era deliveries.
 */
export function wagonAnalysis(balls = [], { batHandFor = () => "R", chip = null } = {}) {
  const placed = balls.filter(isPlaced);
  const chips = { all: placed.length };
  for (const k of CHIP_VALUES) chips[k] = 0;
  for (const b of placed) { const k = chipKeyOf(b); if (k) chips[k] += 1; }

  const shown = chip ? placed.filter((b) => chipKeyOf(b) === chip) : placed;

  const sideRuns = { off: 0, leg: 0 };
  const areaRuns = Object.fromEntries(AREAS.map((a) => [a.key, 0]));
  const areaBoundaries = Object.fromEntries(AREAS.map((a) => [a.key, 0]));
  let unplaced = 0, straight = 0;
  for (const b of balls) {
    if (!isPlaced(b)) { unplaced += 1; continue; }
    const { area, side } = ballArea(b, batHandFor(b));
    if (!area) { straight += 1; continue; }
    const v = Number(b.value) || 0;
    sideRuns[/** @type {"off" | "leg"} */ (side)] += v;
    areaRuns[area] += v;
    if (v === 4 || v === 6) areaBoundaries[area] += 1;
  }
  const total = sideRuns.off + sideRuns.leg;
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const sides = {
    off: { runs: sideRuns.off, pct: pct(sideRuns.off) },
    leg: { runs: sideRuns.leg, pct: pct(sideRuns.leg) },
    total,
  };
  const areas = AREAS.map((a) => ({ ...a, runs: areaRuns[a.key], boundaries: areaBoundaries[a.key] }));
  return { chips, shown, sides, areas, excluded: { unplaced, straight } };
}

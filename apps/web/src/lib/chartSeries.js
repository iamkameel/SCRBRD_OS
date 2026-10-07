import { projectMatch } from "../scorer/chartData.js";
import { parLine } from "./par.js";
import { oversOf, teamOf } from "./matchCentre.js";

/**
 * THE SERIES A SHARED CHART DRAWS (SCRBRD-133 §7.3) — pure, and the same
 * projection the scorer's own charts draw (scorer/chartData.js, GA-I05), so
 * the worm on the Summary tab, the public page and the ground display cannot
 * disagree with the pad's worm or with the board: every delivery at the
 * legal balls bowled, a wide or a no-ball a step up at the same x, penalty
 * runs where the log placed them, the fold's fall of wickets.
 *
 * Series, not innings: ui/charts/worm.jsx draws points and marks and knows
 * nothing of a fold. chartData.js imports nothing but @scrbrd/scoring and the
 * scorer's format helpers, so the public bundle takes no scorer screen with it.
 */

/**
 * One worm series per innings of the match: the points, the wickets (where
 * and at what score; no name — a mark on a chart says W, not who), the
 * allotment and the balls bowled. Null for an innings with nothing to draw (a
 * paper scorebook's, known by its figures alone).
 * @param {any[]} innings  the fold's, in match order
 * @param {{events?: any[] | null, overs?: unknown}} [o]  the match's log, flat; the match's overs
 * @returns {({points: {ball: number, runs: number}[], wickets: {ball: number, runs: number, n: number}[],
 *             allotment: number, balls: number, total: number} | null)[]}
 */
export function wormSeries(innings, { events = null, overs } = {}) {
  return projectMatch(innings ?? [], { events, overs }).map((p) => (!p || p.summarised || p.points.length < 2 ? null : {
    points: p.points, wickets: p.wickets.map((w) => ({ ball: w.ball, runs: w.runs, n: w.n })),
    allotment: p.allotment, balls: p.balls, total: p.total,
  }));
}

/**
 * Everything ui/charts/worm.jsx draws for the innings on the board (§2.2
 * panel 1, §3.3's worm column), or null before a completed over:
 *
 *   a first innings   its line; the ground's par dashed, to P at the
 *                     allotment, labelled "Par here 128 (9 innings)"
 *   a chase           its line, the first innings' dim, the target solid —
 *                     and the par dashed: the ground's, or after rain the
 *                     DLS par, "calculated"; none after rain with no table
 *   a cut allotment   the revised overs as a vertical rule
 *   a terminated chase  the umpires' par as a mark
 *   a super over      the pair's two worms, one over wide; no par
 *
 * The par line is the server's (GET …/par's track), for this innings: a
 * report one ball behind still draws only points that were true, and its
 * label names no figure that moves with the ball.
 * @param {{match: any, played: any[], index: number, events?: any[] | null, overs?: number, report?: any}} o
 */
export function wormOf({ match, played, index, events = null, overs = 20, report = null }) {
  const inn = played?.[index];
  if (!inn || (inn.balls ?? 0) < 6) return null;
  const series = wormSeries(played, { events, overs });
  const so = inn.superOver != null;
  const pair = so ? played.map((x, i) => ({ x, i })).filter(({ x, i }) => x?.superOver === inn.superOver && i <= index)
    : played.slice(0, 2).map((x, i) => ({ x, i })).filter(({ i }) => i <= index);
  const lines = pair.filter(({ i }) => series[i]).map(({ x, i }) => ({
    id: `inn-${i}`, name: teamOf(match, x.battingTeam).full, tone: /** @type {"main" | "dim"} */ (i === index ? "main" : "dim"),
    points: /** @type {any} */ (series[i]).points, wickets: /** @type {any} */ (series[i]).wickets,
  }));
  if (!lines.length) return null;
  const allotted = (inn.overs ?? overs) * 6;
  const balls = Math.max(allotted, (inn.startOvers ?? 0) * 6, ...pair.map(({ x }) => x?.balls ?? 0), so ? 6 : 0);
  const target = inn.target != null && index > 0 ? { runs: inn.target, label: `Target ${inn.target}` } : null;
  const sameInnings = report?.at?.innings === index;
  const par = !so && sameInnings ? parLine(report, allotted) : null;
  const revised = !so && inn.startOvers != null && inn.overs != null && inn.overs < inn.startOvers
    ? { balls: inn.overs * 6, label: `${inn.overs} overs (revised)` } : null;
  const umpiresPar = !so && inn.par != null && inn.complete ? { balls: inn.balls, runs: inn.par, label: `Par (umpires) ${inn.par}` } : null;
  const side = teamOf(match, inn.battingTeam).full;
  const said = [`Worm: ${side} ${inn.runs} for ${inn.wickets} after ${oversOf(inn.balls)} overs`,
    target ? target.label : null,
    par ? (par.of === "dls" ? "DLS par, calculated, dashed" : `${par.label}, dashed`) : null,
    revised ? revised.label : null, umpiresPar ? umpiresPar.label : null].filter(Boolean).join("; ");
  return { lines, balls, target, par, revised, umpiresPar, said };
}

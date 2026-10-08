import { RRR_TREND, chaseRates, rainTouched, rrrTrend } from "@scrbrd/scoring";

/**
 * PAR AND PRESSURE, IN WORDS (SCRBRD-133 G2, design §3.3, §3.5) — pure, so
 * apps/web/test/par.test.mjs holds every row of §3.3 against hand figures.
 *
 * The Board's second line says one true thing about where the innings stands:
 * how far ahead of or behind par for this ground in a first innings; what is
 * needed, and whether the required rate is climbing, steady or falling, in a
 * chase; the DLS par at this point after rain in a chase, labelled as the
 * calculation it is. Where there is no par, nothing is said about par and the
 * line is what it was (scorer/boardData.js). There is no pressure percentage
 * (D4): a gap in whole runs and a direction, both provable from the log.
 *
 * THE FIGURES ARE THE SERVER'S. A par at a point is the ground's par scaled by
 * the resources (or overs) used, and the resources live only on the server
 * (SCRBRD-130 D6): the page reads GET …/par and never computes one. A report
 * speaks for one position — `at`: the innings, the balls, the wickets, the
 * allotment and the stops — and is shown only while the page's own fold
 * stands exactly there (reportFor()). One ball later it says nothing until
 * the next read, rather than a gap one ball stale. The required rate's trend
 * is the log's own arithmetic (@scrbrd/scoring chaseRates()), the same
 * function the server runs, so it needs no read at all.
 */

export { RRR_TREND, chaseRates, rainTouched, rrrTrend };

/** What the line calls the ground's par. */
export const VENUE_PAR = "par for this ground";
/** …and the calculated one, after rain in a chase. */
export const DLS_PAR = "DLS par";
/** A first innings the umpires cut is measured against a full innings' par (SCRBRD-130 §6.5). */
export const FULL_INNINGS = "of a full innings here";
/** The balls left at which the line stops giving a rate: the balls say it (§3.3, "the last two overs"). */
export const LAST_TWO_OVERS = 12;
/** A chase shows a trend, and the rate track, once this many balls are bowled (§3.3, §3.5). */
export const TWO_OVERS = 12;

/**
 * The report, if it speaks for the innings the board shows exactly as the
 * page's fold has it; else null.
 * @param {any} report  GET …/par's answer
 * @param {any} inn  the fold's innings on the board
 * @param {number} index  its place among the match's innings
 */
export function reportFor(report, inn, index) {
  const at = report?.at;
  if (!at || !inn) return null;
  return at.innings === index && at.balls === (inn.balls ?? 0) && at.wickets === (inn.wickets ?? 0)
    && at.overs === (inn.overs ?? null) && at.stops === (inn.interruptions?.length ?? 0) ? report : null;
}

/**
 * "12 ahead of par for this ground", "Level with par for this ground",
 * "9 behind par for this ground": whole runs, never a percentage.
 * @param {number} runs  @param {number} par  @param {string} [of]
 */
export function gapWords(runs, par, of = VENUE_PAR) {
  const gap = runs - par;
  return gap > 0 ? `${gap} ahead of ${of}` : gap < 0 ? `${-gap} behind ${of}` : `Level with ${of}`;
}

/** "+12", "−9", "level". @param {number} runs  @param {number} par */
export const gapFigure = (runs, par) => (runs > par ? `+${runs - par}` : runs < par ? `−${par - runs}` : "level");

/** The current run rate to two places, or null before a legal ball. @param {any} inn */
const crrOf = (inn) => ((inn?.balls ?? 0) > 0 ? ((inn.runs / inn.balls) * 6).toFixed(2) : null);

/**
 * The second line's words for a screen that shows par (§3.3), or null where it
 * says what it said before G2 (scorer/boardData.js composes that). The rain
 * line's "Play stopped" and a super over's block are boardData.js's, not here.
 *
 * @param {object} o
 * @param {any} o.inn            the fold's innings on the board
 * @param {boolean} o.chasing    it is the match's second innings
 * @param {number | null} o.target
 * @param {number} o.overs       its allotment
 * @param {any} o.report         reportFor()'s answer: the report, or null
 * @param {{trend: string | null} | null} [o.rates]  chaseRates()'s answer
 * @param {boolean} [o.rained]   rain touched the match's chase (rainTouched())
 * @param {string | null} [o.result]  the result's words, once play has decided it
 * @returns {string | null}
 */
export function parWords({ inn, chasing, target, overs, report, rates = null, rained = false, result = null }) {
  if (!inn || inn.superOver != null) return null;
  if (!chasing) {
    const v = report?.venue;
    if (!v || !Number.isInteger(v.parAt)) return null;
    const crr = crrOf(inn);
    return [`${gapWords(inn.runs, v.parAt)}${v.shortened ? ` (${FULL_INNINGS})` : ""}`, crr ? `CRR ${crr}` : null].filter(Boolean).join(" · ");
  }
  if (target == null) return null;
  const left = Math.max(0, overs * 6 - (inn.balls ?? 0));
  const need = target - inn.runs;
  if (need <= 0) return "Target reached";
  // Over, and decided: the result's words (a terminated chase on the umpires' par, 130 §5).
  if (inn.complete && result) return result;
  const method = inn.conditions?.["target.method"];
  const suffix = rained ? (method === "dls_standard" ? " (DLS)" : " (revised)") : "";
  const head = `Need ${need} off ${left}${suffix}`;
  const dls = report?.dls;
  if (rained && dls && Number.isInteger(dls.parAt)) return `${head} · ${gapWords(inn.runs, dls.parAt, DLS_PAR)}`;
  if (left <= LAST_TWO_OVERS) return head;
  const rrr = left > 0 ? ((need / left) * 6).toFixed(2) : null;
  if (!rrr) return head;
  const trend = (inn.balls ?? 0) >= TWO_OVERS ? rates?.trend ?? null : null;
  return `${head} · RRR ${rrr}${trend ? `, ${trend}` : ""}`;
}

/**
 * The rate track's two ticks (§3.5), or null when there is nothing to
 * compare: no par in a first innings, a chase under two overs, nothing left.
 *
 *   first innings   par ──┼──●── the side's score, and the gap "+12"
 *   chase (DLS)     DLS par ──┼──●── the score, and the gap
 *   chase           CRR ──●────┼── RRR, and the trend word
 *
 * Each tick at its figure on one line from nought to a little past the larger.
 * @param {{inn: any, chasing: boolean, target: number | null, overs: number, report: any, rates?: any, rained?: boolean, side?: string | null}} o
 * The asked-for figure (par, or the required rate) is a bar; the side's own (its
 * score, or its run rate) a dot: two shapes, so colour is never alone.
 * @returns {{kind: "par" | "rate", from: {label: string, value: number, text: string, mark: string},
 *            to: {label: string, value: number, text: string, mark: string},
 *            gap: string, scale: number, said: string} | null}
 */
export function rateTrack({ inn, chasing, target, overs, report, rates = null, rained = false, side = null }) {
  if (!inn || inn.superOver != null) return null;
  const par = !chasing ? report?.venue?.parAt : rained ? report?.dls?.parAt : null;
  if (Number.isInteger(par)) {
    const p = /** @type {number} */ (par), r = inn.runs ?? 0;
    const label = !chasing ? "par" : "DLS par";
    const who = side || "score";
    return { kind: "par", from: { label, value: p, text: String(p), mark: "bar" }, to: { label: who, value: r, text: String(r), mark: "dot" },
             gap: gapFigure(r, p), scale: Math.max(1, p, r) * 1.15,
             said: `${label} ${p}, ${who} ${r}: ${gapWords(r, p, label === "par" ? VENUE_PAR : DLS_PAR)}` };
  }
  // After rain with no DLS par to hold the side to, the rates are what the
  // line says (§3.3: "(revised) · RRR 7.94, climbing"), so they are drawn.
  if (!chasing || target == null) return null;
  const balls = inn.balls ?? 0, left = overs * 6 - balls, need = target - inn.runs;
  if (inn.complete || balls < TWO_OVERS || left <= 0 || need <= 0) return null;
  const crr = (inn.runs / balls) * 6, rrr = (need / left) * 6;
  const trend = rates?.trend ?? null;
  return { kind: "rate", from: { label: "CRR", value: crr, text: crr.toFixed(2), mark: "dot" }, to: { label: "RRR", value: rrr, text: rrr.toFixed(2), mark: "bar" },
           gap: trend ?? "", scale: Math.max(1, crr, rrr) * 1.15,
           said: `run rate ${crr.toFixed(2)}, required ${rrr.toFixed(2)}${trend ? `, ${trend}` : ""}` };
}

/**
 * What the worm's par line is: the track's points, what it is called, and —
 * for the ground's par by the proportion of overs, which is a straight line
 * whatever the wickets — the rest of the innings to P at the allotment.
 * With a table the line ahead depends on wickets not yet fallen, so only its
 * end (P, every resource used) is marked. Null with no track.
 * @param {any} report  reportFor()'s answer  @param {number} allottedBalls
 * @returns {{points: {balls: number, runs: number}[], ahead: {balls: number, runs: number}[] | null, end: {balls: number, runs: number} | null,
 *            label: string, legend: string, of: string} | null}
 */
export function parLine(report, allottedBalls) {
  const pts = Array.isArray(report?.track) ? report.track : [];
  if (pts.length < 2 || !report?.trackOf) return null;
  const points = pts.map((/** @type {any} */ p) => ({ balls: p.balls, runs: p.parAt }));
  const last = points[points.length - 1];
  if (report.trackOf === "dls") {
    return { points, ahead: null, end: null, of: "dls", label: "DLS par (calculated)",
             legend: "DLS par, calculated by SCRBRD (dashed)" };
  }
  const v = report.venue;
  if (!v) return null;
  const end = { balls: allottedBalls, runs: v.par };
  const ahead = v.method === "proportion" && last.balls < allottedBalls ? [last, end] : null;
  return { points, ahead, end, of: "venue", label: `Par here ${v.par} (${v.n} innings)`,
           legend: `Par: this ground, ${v.n} innings (dashed) · ${v.label}` };
}

import { KIND, ballsOfOvers, countsInOver, foldSteps, isLegal, penaltyCredits } from "@scrbrd/scoring";
import { isOut } from "./format.js";

/**
 * What the scorer's charts draw, from the fold (GA-I05). One projection, read
 * by the worm, runs per over and the run-rate chart, so the three cannot
 * disagree with each other or with the board.
 *
 * Every figure here is the fold's own (packages/scoring replay.mjs), read the
 * fold's way:
 *
 *   - A delivery adds its `value` and, for a wide or a no-ball, the one-run
 *     penalty (isLegal), as the fold's BALL case does. The charts used to drop
 *     wides and no-balls from the worm, and add bare `value` per over, so an
 *     over of Wd, Nb 4 and six dots was 0 on the worm and 4 on the bars where
 *     the board said 6.
 *   - The x of every point is the legal balls bowled (countsInOver), so a wide
 *     or a no-ball stands at the x of the ball before it and its runs are a
 *     step up, never dropped.
 *   - Runs that came with no delivery (penalty runs to the batting side) are
 *     placed where the log has them, when the innings' own log is given:
 *     foldSteps() is the fold, event by event, so the award's runs are what
 *     the fold added for it. Penalty runs credited from another innings
 *     (penaltyCredits(): the runs an innings opens on, or is given after its
 *     last event) open or close the line. Whatever cannot be placed closes it,
 *     so the last point is always the innings' total.
 *   - Wickets are the fold's fall of wickets: a wicket the free hit saved, or
 *     one taken back by a consented resume, is not there, and one with no
 *     delivery (retired out, timed out) is.
 *
 * No division happens here without a divisor greater than nought, so no
 * figure is NaN or Infinity.
 */

/** A count, or 0: nothing drawn from a chart may be NaN. @param {unknown} v */
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * The runs a delivery adds to the side's total: what the fold's BALL case adds.
 * @param {{type?: string | null, value?: unknown} | null | undefined} b
 */
export const deliveryRuns = (b) => n(b?.value) + (isLegal(b?.type ?? "run") ? 0 : 1);

/**
 * The overs allotted to this innings: the fold's own (a revision included),
 * else the match's, else twenty.
 * @param {{overs?: unknown} | null | undefined} inn  @param {unknown} [fallback]
 */
export function allotmentOf(inn, fallback) {
  const ok = (/** @type {unknown} */ v) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (ok(inn?.overs)) return /** @type {number} */ (inn?.overs);
  if (ok(fallback)) return /** @type {number} */ (fallback);
  return 20;
}

/**
 * Where the runs that came with no delivery fell, from the innings' own log:
 * after how many deliveries, and how many. foldSteps() is the fold itself, so
 * a voided event is skipped as the fold skips it and the runs are the ones the
 * fold added. Null when the log is not this innings' (its deliveries do not
 * match the fold's), so nothing is placed from it.
 * @param {any[] | null | undefined} events  @param {number} deliveries
 * @returns {{after: number, runs: number}[] | null}
 */
function awardsOf(events, deliveries) {
  if (!Array.isArray(events) || !events.length) return null;
  /** @type {{after: number, runs: number}[]} */
  const out = [];
  let k = 0, prev = 0;
  try {
    for (const { ev, inn } of foldSteps(events)) {
      const runs = n(inn.runs);
      if (ev.kind === KIND.BALL) k++;
      else if (ev.kind === KIND.INNINGS_SUMMARY) return null;
      else if (runs !== prev) out.push({ after: k, runs: runs - prev });
      prev = runs;
    }
  } catch { return null; }
  return k === deliveries ? out : null;
}

/**
 * @typedef {{ball: number, runs: number}} WormPoint
 * @typedef {{ball: number, runs: number, n: number, name: string, how: string}} WormWicket
 * @typedef {{over: number, runs: number, wickets: number, balls: number, complete: boolean, cum: number}} OverBar
 * @typedef {{
 *   points: WormPoint[], wickets: WormWicket[], overs: OverBar[],
 *   total: number, balls: number, allotment: number,
 *   opening: number, closing: number, summarised: boolean,
 * }} Projection
 */

/**
 * One innings, projected for its charts.
 *
 * @param {any} inn  the fold's innings (deriveInningsList / deriveMatch)
 * @param {{events?: any[] | null, opening?: number | null, overs?: unknown}} [o]
 *   `events`: this innings' own log, which places penalty runs where they
 *   were awarded; `opening`: the penalty runs it opened on (penaltyCredits);
 *   `overs`: the match's overs, when the fold has none
 * @returns {Projection | null}
 */
export function projectInnings(inn, { events = null, opening = null, overs } = {}) {
  if (!inn) return null;
  const total = n(inn.runs);
  const allotment = allotmentOf(inn, overs);
  const log = Array.isArray(inn.ballLog) ? inn.ballLog : [];
  // A paper scorebook's innings is known by its figures and has no
  // deliveries to draw (SCRBRD-120): nothing here, rather than a line from
  // nought to the total. Nor is there anything in an innings with no runs and
  // nothing bowled. (Penalty runs before the first ball are a step at nought.)
  if (inn.summarised != null || (!log.length && total === 0)) {
    return { points: [], wickets: [], overs: [], total, balls: n(inn.balls), allotment,
             opening: 0, closing: 0, summarised: inn.summarised != null };
  }

  const awards = awardsOf(events, log.length) ?? [];
  const placedByDelivery = log.reduce((s, b) => s + deliveryRuns(b), 0);
  const placedByAward = awards.reduce((s, a) => s + a.runs, 0);
  const unplaced = total - placedByDelivery - placedByAward;
  const open = Math.max(0, Math.min(n(opening), unplaced));
  const closing = unplaced - open;

  /** @type {Map<number, OverBar>} */
  const bars = new Map();
  /** @param {number} over */
  const bar = (over) => {
    let b = bars.get(over);
    if (!b) { b = { over, runs: 0, wickets: 0, balls: 0, complete: false, cum: 0 }; bars.set(over, b); }
    return b;
  };

  /** @type {WormPoint[]} */
  const points = [{ ball: 0, runs: open }];
  let x = 0, runs = open, lastOver = 0, a = 0;
  const award = (/** @type {number} */ k) => {
    while (a < awards.length && awards[a].after === k) {
      runs += awards[a].runs;
      // An award belongs to the over of the delivery before it: the ball
      // that struck the helmet, the fielder's offence on that ball.
      bar(lastOver).runs += awards[a].runs;
      points.push({ ball: x, runs });
      a++;
    }
  };
  log.forEach((b, k) => {
    award(k);
    const over = Number.isInteger(b.over) ? b.over : Math.floor(x / 6);
    const r = deliveryRuns(b);
    const ov = bar(over);
    ov.runs += r;
    if (countsInOver(b)) { x += 1; ov.balls += 1; }
    if (isOut(b)) ov.wickets += 1;
    runs += r;
    lastOver = over;
    points.push({ ball: x, runs });
  });
  award(log.length);
  if (closing !== 0) { runs += closing; points.push({ ball: x, runs }); }

  // Wickets with no delivery, in the over the fold gives them (the one the
  // next delivery is in), or the last one bowled when none came after.
  for (const w of Array.isArray(inn.nonBallWickets) ? inn.nonBallWickets : []) {
    const over = Number.isInteger(w?.over) ? Math.min(w.over, lastOver) : lastOver;
    bar(over).wickets += 1;
  }

  const overList = [...bars.values()].sort((p, q) => p.over - q.over);
  let cum = open;
  for (const o of overList) { o.complete = o.balls >= 6; cum += o.runs; o.cum = cum; }
  if (overList.length) overList[overList.length - 1].cum += closing;

  /** @type {WormWicket[]} */
  const wickets = [];
  for (const f of Array.isArray(inn.fow) ? inn.fow : []) {
    const ball = ballsOfOvers(f?.overs);
    if (ball == null || typeof f?.runs !== "number") continue;
    const bat = (inn.batsmen || []).find((/** @type {any} */ p) => p.name === f.batsman);
    wickets.push({ ball, runs: f.runs, n: wickets.length + 1, name: f.batsman ?? "Wicket", how: bat?.dismissal ?? "" });
  }

  return { points, wickets, overs: overList, total, balls: x, allotment, opening: open, closing, summarised: false };
}

/**
 * Every innings of a match, projected, with penalty runs credited across
 * innings placed where they belong: the runs an innings opened on start its
 * line, and those given after its last event close it.
 *
 * @param {any[]} innings  the match's folded innings, indexed by innings number
 * @param {{events?: any[] | null, overs?: unknown}} [o]  `events`: per innings
 *   (`events[i]` is innings i's log, the pad's shape) or one flat log whose
 *   events carry `innings`, as the Match Centre reads it
 * @returns {(Projection | null)[]}
 */
export function projectMatch(innings = [], { events = null, overs } = {}) {
  const list = Array.isArray(innings) ? innings : [];
  const logs = logsByInnings(events, list.length);
  /** @type {Map<number, number>} */
  let carried = new Map();
  try {
    carried = penaltyCredits(list.map((inn, i) => [i, inn]).filter(([, inn]) => inn)).carried;
  } catch { /* an innings the credits cannot read opens on nothing */ }
  return list.map((inn, i) => projectInnings(inn, { events: logs[i], opening: carried.get(i) ?? 0, overs }));
}

/**
 * @param {any[] | null | undefined} events  @param {number} count
 * @returns {(any[] | null)[]}
 */
function logsByInnings(events, count) {
  /** @type {(any[] | null)[]} */
  const out = Array.from({ length: count }, () => null);
  if (!Array.isArray(events)) return out;
  if (events.every((e) => Array.isArray(e) || e == null)) {
    events.forEach((e, i) => { if (i < count) out[i] = e ?? null; });
    return out;
  }
  for (const ev of events) {
    const i = ev?.innings ?? 0;
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    (out[i] ??= []).push(ev);
  }
  return out;
}

/**
 * The run rate after each over, the rate required in a chase, and how a chase
 * ended. The required rate exists only while there are balls left and runs
 * still needed; once neither, the chase has an end instead: the target
 * reached, the scores level, or how many it was short.
 *
 * @param {Projection | null} p  @param {number | null | undefined} target
 * @param {{complete?: boolean} | null} [inn]
 * @returns {{
 *   pts: {over: number, rr: number, reqRr: number | null}[],
 *   end: null | {state: "reached" | "level" | "short", target: number, runs: number, short: number},
 * }}
 */
export function runRates(p, target, inn = null) {
  if (!p || !p.overs.length) return { pts: [], end: null };
  const t = typeof target === "number" && Number.isFinite(target) && target > 0 ? target : null;
  const allotBalls = p.allotment * 6;
  /** @type {{over: number, rr: number, reqRr: number | null}[]} */
  const pts = [];
  let balls = 0;
  for (const o of p.overs) {
    balls += o.balls;
    const last = o === p.overs[p.overs.length - 1];
    // A completed over, or the over the innings ended in.
    if (!o.complete && !(last && inn?.complete)) continue;
    if (balls <= 0) continue;
    const left = allotBalls - balls;
    const reqRr = t != null && left > 0 && o.cum < t && !(last && inn?.complete) ? ((t - o.cum) / left) * 6 : null;
    pts.push({ over: balls / 6, rr: (o.cum / balls) * 6, reqRr });
  }
  let end = null;
  if (t != null) {
    const runs = p.total;
    const over = runs >= t || p.balls >= allotBalls || !!inn?.complete;
    if (over) end = { state: runs >= t ? "reached" : runs === t - 1 ? "level" : "short", target: t, runs, short: Math.max(0, t - runs) };
  }
  return { pts, end: /** @type {any} */ (end) };
}

/**
 * The chase's end, in words.
 * @param {ReturnType<typeof runRates>["end"]} end
 */
export function chaseEndWords(end) {
  if (!end) return null;
  if (end.state === "reached") return `Target of ${end.target} reached`;
  if (end.state === "level") return `Scores level on ${end.runs}`;
  return `Ended ${end.short} short of the target of ${end.target}`;
}

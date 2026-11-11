/**
 * SCRBRD — par and pressure at a point (SCRBRD-133 phase G2;
 * docs/design/SCRBRD-133_immersive_match_centre.md §3).
 *
 * The Board's second line says one true thing about where an innings stands,
 * and the worm draws the par as a line. Everything here is a figure the log
 * proves — a gap in whole runs, a required rate and its direction — and
 * never a 0–100 "pressure" (D4: signals.js's heuristic stays the pad's).
 *
 *   requiredRate()  runs an over still needed, from a position
 *   rrrTrend()      climbing, steady or falling: the required rate at the end
 *                   of the last completed over against three overs before it
 *                   (or the chase's start), ±0.25 an over (A7), compared in
 *                   whole numbers so 0.25 is 0.25 and not 0.2499999
 *   chaseRates()    the two required rates and the word, from a log
 *   inningsAtOverEnds()  the innings as it stood at the end of each completed
 *                   over: the log folded to that over's last delivery
 *   parReport()     what GET /api/public/matches/:id/par (and its signed-in
 *                   twin, GET /api/matches/:id/par) serves: for the innings
 *                   in play, the venue par at this point and its track, the
 *                   DLS par at this point and its track after an interruption
 *                   in a chase, and the required rate's trend
 *
 * WHERE THE TABLE GOES (SCRBRD-130 D6). parReport() runs on the server only:
 * a DLS table, when one is given, is read here and goes no further. What
 * leaves is one whole-run figure per completed over and the current point —
 * P scaled by a ratio of two resource sums, at the wickets the innings had —
 * never a cell, a resource, R1 or R2 (dlsParAt()'s `resources` are dropped
 * here, not passed on). The browser shows these figures and computes none.
 *
 * THE POINTS ARE THE PAR AS IT STOOD. Each point of a track is par at the end
 * of that over, folded from the log as it stood then: the allotment, the
 * wickets and, for DLS, the interruptions so far. A revision is therefore a
 * step in the line where it happened, as the board said it at the time;
 * nothing earlier is redrawn under a later allotment.
 *
 * Pure: the log in, figures out. No clock, no I/O.
 */
import { deriveMatch, revisedTargetMethod } from "./replay.mjs";
import { countsInOver } from "./events.mjs";
import { parAt } from "./venue.mjs";
import { dlsParAt, resourcesOf, DLS_STATUS } from "./dls.mjs";

/** How far the required rate must move over three overs to be climbing or falling, runs an over (A7). */
export const RRR_TREND_STEP = 0.25;

/** The required rate's direction, in the words the Board says. */
export const RRR_TREND = Object.freeze({ CLIMBING: "climbing", STEADY: "steady", FALLING: "falling" });

/** Which par a report's track draws. */
export const PAR_TRACK = Object.freeze({ VENUE: "venue", DLS: "dls" });

/**
 * The required rate, runs an over: (target − runs) ÷ ((allotted − bowled) ÷ 6).
 * Null when no ball is left to bowl, or there is no target.
 * @param {number | null | undefined} target  @param {number} runs
 * @param {number} allottedBalls  @param {number} balls
 * @returns {number | null}
 */
export function requiredRate(target, runs, allottedBalls, balls) {
  if (!Number.isFinite(target) || !Number.isFinite(runs) || !Number.isFinite(allottedBalls) || !Number.isFinite(balls)) return null;
  const left = /** @type {number} */ (allottedBalls) - /** @type {number} */ (balls);
  if (left <= 0) return null;
  return ((/** @type {number} */ (target) - /** @type {number} */ (runs)) * 6) / left;
}

/**
 * Climbing, steady or falling — or null when either point has no rate.
 *
 * Exact: with now = 6(t − r₁)/l₁ and before = 6(t − r₀)/l₀ (l the balls
 * left, both positive), now − before ≥ ¼ ⟺ 24((t − r₁)l₀ − (t − r₀)l₁) ≥ l₀l₁,
 * all in whole numbers.
 * @param {{target: number, runs: number, left: number}} now  @param {{target: number, runs: number, left: number}} before
 * @returns {string | null}
 */
export function rrrTrend(now, before) {
  if (!now || !before || !(now.left > 0) || !(before.left > 0)) return null;
  const d = 24 * ((now.target - now.runs) * before.left - (before.target - before.runs) * now.left);
  const step = before.left * now.left * (RRR_TREND_STEP * 4);   // 4 × ¼ = 1: whole numbers throughout
  if (d >= step) return RRR_TREND.CLIMBING;
  if (d <= -step) return RRR_TREND.FALLING;
  return RRR_TREND.STEADY;
}

/** @param {any[]} events */
const voidedOf = (events) => new Set(events.filter((e) => e?.kind === "void").map((e) => e.target));

/**
 * The log folded to (and including) event `i`, as it now stands: a void, and
 * whatever any void in the whole log undoes, left out — so a ball voided
 * later is not in an earlier over's figure, as it is not in the over itself.
 * @param {any[]} events  @param {number} i  @param {any} ctx  @param {Set<unknown>} voided
 */
const foldTo = (events, i, ctx, voided) =>
  deriveMatch(events.slice(0, i + 1).filter((e) => e?.kind !== "void" && !voided.has(e?.id)), ctx).innings;

/**
 * Each completed over of innings `n` (its place in deriveMatch()'s list), and
 * the match's innings as they stood at that over's last delivery.
 * @param {any[]} events  the match's log, as folded
 * @param {any} ctx  the fold context
 * @param {number} n
 * @param {{only?: number[] | null}} [o]  just these overs (the counts completed), where a caller needs two, not all
 * @returns {{over: number, innings: any[]}[]}  `over` the overs completed (1 for the first)
 */
export function inningsAtOverEnds(events, ctx, n, { only = null } = {}) {
  const evs = Array.isArray(events) ? events : [];
  const inn = deriveMatch(evs, ctx).innings[n];
  if (!inn) return [];
  const voided = voidedOf(evs);
  const at = new Map(evs.map((e, i) => [e?.id, i]));
  /** @type {{over: number, innings: any[]}[]} */
  const out = [];
  for (const o of inn.overLog ?? []) {
    if (only && !only.includes(o.over + 1)) continue;
    if (o.balls.filter(countsInOver).length < 6) continue;
    const i = at.get(o.balls[o.balls.length - 1]?.id);
    if (i == null) continue;
    out.push({ over: o.over + 1, innings: foldTo(evs, i, ctx, voided) });
  }
  return out;
}

/**
 * The match's innings as they stood before innings `n`'s first delivery: the
 * chase's start, for "three overs ago" when fewer than three are bowled.
 * @param {any[]} events  @param {any} ctx  @param {number} n  @param {any} inn  the innings, folded whole
 */
function inningsAtStart(events, ctx, n, inn) {
  const first = inn.ballLog?.[0]?.id;
  const voided = voidedOf(events);
  const i = first == null ? events.length : events.findIndex((e) => e?.id === first);
  return i <= 0 ? null : foldTo(events, i - 1, ctx, voided);
}

/**
 * The chase's required rate at the end of the last completed over and three
 * overs before it (or at the chase's start), and the word (§3.3). Null outside
 * a chase, in a super over (3b: one over is not a thing to model), and before
 * two overs are bowled; `trend` null once nothing is needed or nothing is left.
 * The current target and allotment, against the runs and balls each point had.
 * @param {any[]} events  @param {any} ctx  @param {number} n
 * @returns {{now: number, threeOversAgo: number, trend: string | null, overs: number} | null}
 */
export function chaseRates(events, ctx, n) {
  const evs = Array.isArray(events) ? events : [];
  const inn = deriveMatch(evs, ctx).innings[n];
  if (!inn || inn.target == null || inn.superOver != null || inn.summarised != null) return null;
  const k = Math.floor((inn.balls ?? 0) / 6);
  if (k < 2) return null;
  // Two folds, not one an over: a TV's browser runs this on every read.
  const ends = inningsAtOverEnds(evs, ctx, n, { only: [k, k - 3] });
  const last = ends.find((e) => e.over === k)?.innings?.[n];
  // Three overs back is an over's end from the fourth over on; at the third
  // (and before it) it is the chase's start, nought for nought.
  const back = k > 3 ? ends.find((e) => e.over === k - 3)?.innings?.[n] : inningsAtStart(evs, ctx, n, inn)?.[n] ?? { runs: 0, balls: 0 };
  if (!last || !back) return null;
  const N = (inn.overs ?? 0) * 6, t = inn.target;
  const pt = (/** @type {any} */ x) => ({ target: t, runs: x.runs ?? 0, left: N - (x.balls ?? 0) });
  const now = requiredRate(t, last.runs, N, last.balls), before = requiredRate(t, back.runs, N, back.balls);
  if (now == null || before == null) return null;
  const done = inn.runs >= t || inn.complete;
  return { now: round2(now), threeOversAgo: round2(before), trend: done ? null : rrrTrend(pt(last), pt(back)), overs: k };
}

/** @param {number} x */
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Has rain (or the umpires) touched the match's own innings: a stop, a
 * revision, an allotment cut?
 * @param {any[]} own  the match's innings, super overs aside
 */
export function interrupted(own) {
  return (own ?? []).some((i) => i && ((i.interruptions?.length ?? 0) > 0 || i.revised != null || (i.overCuts?.length ?? 0) > 0));
}

/**
 * Has rain (or the umpires) touched this match's chase: an interruption or a
 * cut in either innings; a chase target the umpires set other than one more
 * than the first innings, or a par (replay.mjs revisedTargetMethod(), the
 * rule the result's suffix reads); or a chase that starts with fewer overs
 * than the first innings did (the interval lost, SCRBRD-130 §3.3 case 4).
 * Then the DLS par is the par (§3.3), and the ground's is not said.
 * @param {any[]} innings  the match's innings, super overs aside or not
 * @param {Readonly<Record<string, unknown>> | null} [conditions]  the frozen play part
 */
export function rainTouched(innings, conditions = null) {
  const own = (innings ?? []).filter((i) => i != null && i.superOver == null).slice(0, 2);
  if (interrupted(own)) return true;
  const [a, b] = own;
  if (!a || !b) return false;
  if (revisedTargetMethod([a, b], conditions ?? b.conditions ?? {}) != null) return true;
  const n1 = a.startOvers ?? a.overs, n2 = b.startOvers ?? b.overs;
  return Number.isInteger(n1) && Number.isInteger(n2) && n2 < n1;
}

/**
 * A venue_par row as parReport() reads it: the figure and its evidence.
 * @typedef {{par: number | null, n: number, sufficient: boolean, median?: number | null, low?: number | null,
 *            high?: number | null, firstSeason?: number | null, lastSeason?: number | null}} VenuePar
 */

/**
 * @typedef {object} ParReport
 * @property {{innings: number, balls: number, wickets: number, overs: number | null, stops: number} | null} at
 *   the position the report speaks for — a screen shows its figures only while
 *   its own fold stands there (a newer ball, and it waits for the next read)
 * @property {{par: number, n: number, sufficient: true, seasons: {first: number | null, last: number | null},
 *             median: number | null, range: {low: number | null, high: number | null},
 *             parAt: number, method: string, label: string, shortened: boolean} | null} venue
 * @property {{parAt: number | null, status: string, tableId: string | null} | null} dls
 * @property {{balls: number, parAt: number}[]} track
 * @property {string | null} trackOf   PAR_TRACK, or null with no track
 * @property {{now: number, threeOversAgo: number, trend: string | null} | null} rrr
 */

/** @returns {ParReport} */
const empty = (/** @type {ParReport["at"]} */ at) => ({ at, venue: null, dls: null, track: [], trackOf: null, rrr: null });

/**
 * What the par read serves for the innings in play (§3.2), from the log, the
 * ground's par and — server-side only — the DLS table.
 *
 *   venue   the ground's par (sufficient, D5) and par at this point (§6.5,
 *           venue.mjs parAt(): the table's resources when one is loaded,
 *           else the proportion of overs, labelled so), in a limited-overs
 *           match innings — and not in a chase after an interruption, where
 *           the DLS par is the par (§3.3)
 *   dls     a chase after an interruption: the DLS par at this point
 *           (dls.mjs dlsParAt()), or the status that says why there is none
 *           (no_table: "no par line; the umpires' figures only")
 *   track   the par at the end of each completed over, from 0, and now
 *   rrr     a chase of two overs or more: chaseRates()
 *
 * @param {{events: any[], ctx?: any, venue?: VenuePar | null, table?: import("./dls.mjs").DlsTable | null,
 *          g50?: number | null, limited?: boolean}} o
 * @returns {ParReport}
 */
export function parReport({ events, ctx = {}, venue = null, table = null, g50 = null, limited = true }) {
  const evs = Array.isArray(events) ? events : [];
  const list = deriveMatch(evs, ctx).innings;
  const n = list.length - 1;
  const inn = list[n];
  if (!inn) return empty(null);
  const at = { innings: n, balls: inn.balls ?? 0, wickets: inn.wickets ?? 0, overs: inn.overs ?? null, stops: inn.interruptions?.length ?? 0 };
  // A super over has no par and no trend (3b); a scorebook's innings has no
  // deliveries to place a point on; a declaration match has no overs to scale by.
  if (!limited || inn.superOver != null || inn.summarised != null) return empty(at);
  const chasing = n === 1 && inn.target != null;
  const rained = rainTouched(list, ctx?.conditions ?? null);
  const resources = table ? (/** @type {number} */ b, /** @type {number} */ w) => resourcesOf(table, b, w) : null;
  /** @type {ParReport} */
  const out = empty(at);
  const ends = () => inningsAtOverEnds(evs, ctx, n);

  if (chasing && rained) {
    // §3.3: after an interruption the DLS par replaces the ground's par — or,
    // with no table, there is no par line at all.
    if (!table) out.dls = { parAt: null, status: DLS_STATUS.NO_TABLE, tableId: null };
    else {
      const conditions = ctx?.conditions ?? null;
      const now = dlsParAt(list.slice(0, 2), { table, g50, conditions });
      out.dls = { parAt: now.status === DLS_STATUS.OK ? now.par : null, status: now.status, tableId: table.id ?? null };
      if (now.status === DLS_STATUS.OK && now.par != null) {
        const points = [{ balls: 0, parAt: 0 }];
        for (const e of ends()) {
          const p = dlsParAt(e.innings.slice(0, 2), { table, g50, conditions });
          const b = e.innings[n]?.balls;
          if (p.status === DLS_STATUS.OK && p.par != null && Number.isInteger(b)) points.push({ balls: b, parAt: p.par });
        }
        if (points[points.length - 1].balls !== at.balls) points.push({ balls: at.balls, parAt: now.par });
        out.track = points;
        out.trackOf = PAR_TRACK.DLS;
      }
    }
  } else if (venue?.sufficient && Number.isInteger(venue.par)) {
    const P = /** @type {number} */ (venue.par);
    // Measured over the allotment the innings STARTED with (§3.3: "the par
    // line to P at the original N"): a first innings the umpires cut is held
    // to a full innings' par here, the only pool there is (130 §6.5), and the
    // words say so ("of a full innings here"). Uncut, it is the allotment.
    const full = (/** @type {any} */ x) => ((x?.startOvers ?? x?.overs ?? 0) * 6);
    const now = parAt(P, { allottedBalls: full(inn), balls: at.balls, wickets: at.wickets }, { resources });
    if (now) {
      out.venue = {
        par: P, n: venue.n, sufficient: true,
        seasons: { first: venue.firstSeason ?? null, last: venue.lastSeason ?? null },
        median: venue.median ?? null, range: { low: venue.low ?? null, high: venue.high ?? null },
        parAt: now.runs, method: now.method, label: now.label,
        // A first innings the umpires cut: measured against the full-length
        // par, the only pool there is (SCRBRD-130 §6.5), and said so.
        shortened: inn.startOvers != null && inn.overs != null && inn.overs < inn.startOvers,
      };
      const points = [{ balls: 0, parAt: 0 }];
      for (const e of ends()) {
        const p = e.innings[n];
        const q = p ? parAt(P, { allottedBalls: full(p), balls: p.balls, wickets: p.wickets }, { resources }) : null;
        if (q) points.push({ balls: p.balls, parAt: q.runs });
      }
      if (points[points.length - 1].balls !== at.balls) points.push({ balls: at.balls, parAt: now.runs });
      out.track = points;
      out.trackOf = PAR_TRACK.VENUE;
    }
  }
  if (chasing) {
    const r = chaseRates(evs, ctx, n);
    out.rrr = r ? { now: r.now, threeOversAgo: r.threeOversAgo, trend: r.trend } : null;
  }
  return out;
}

// ── CRI-1.8: the par estimate (CRICINFO_GAP_PLAN.md decision 5, 2026-10-23) ──
//
// "Win probability is shown from the existing par line, labelled a par
// estimate, and recalibrated once pilot ball logs exist." This is that
// estimate, and nothing more than the par line says: how far the innings
// stands from the ground's par at this point, against how far the ground's own
// first-innings totals spread. It is NOT fitted to any result, and it says so
// wherever it is drawn ("Par estimate"); SCRBRD-130 §10 is its calibration
// note, for after the pilot.
//
//   P        the ground's par (the mean of its first-innings totals, venue.par)
//   parAt    par at this point (venue.parAt: P scaled by the resources, or the
//            overs, the innings has used)
//   f        what is left of an innings, as a share of par: (P − parAt) ÷ P
//   σ        the spread of the ground's totals, from their range and their
//            number: (high − low) ÷ d2(n), the range estimator (d2 below)
//
//   first innings   the side batting:   Φ( (runs − parAt) ÷ (σ √(1 + f)) )
//                   — its total, par from here added, against the side
//                   chasing, who are expected to make par: both uncertain
//   chase           the side chasing:   Φ( (P·f − (need − ½)) ÷ (σ √f) )
//                   — the runs par says are left, against the runs needed
//
// WHERE THERE IS NO PAR THERE IS NO ESTIMATE (the brief: "show nothing rather
// than a guess"): no report for this position, no venue par (fewer than five
// innings here, a declaration match, a super over, a scorebook's innings), a
// ground whose totals have no spread on record, rain anywhere in the match (the
// DLS par is a calculation for one target, and a first innings the umpires cut
// is held to a full innings' par), a chase with nothing left to bowl, and a
// match already decided. Rounded to the nearest five, and never beyond five or
// ninety-five: an estimate nobody has calibrated does not get to say "certain".

/**
 * d2(n): the expected range of n draws from a normal distribution, in standard
 * deviations (the control-chart constant), for n = 2..25. Beyond 25 the last,
 * which a little overstates the spread — the cautious side.
 */
export const RANGE_D2 = Object.freeze([0, 0, 1.128, 1.693, 2.059, 2.326, 2.534, 2.704, 2.847, 2.970, 3.078, 3.173, 3.258,
  3.336, 3.407, 3.472, 3.532, 3.588, 3.640, 3.689, 3.735, 3.778, 3.819, 3.858, 3.895, 3.931]);

/** The estimate's grain, and how near the ends it may go (per cent). */
export const PAR_ESTIMATE_STEP = 5;
export const PAR_ESTIMATE_BOUND = 5;

/** The standard normal's distribution function (Abramowitz and Stegun 7.1.26, |error| < 1.5e-7). @param {number} z */
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * The spread of a ground's first-innings totals, from the venue report's
 * range and number of innings; null where the record gives none.
 * @param {{n?: number, range?: {low?: number | null, high?: number | null}} | null | undefined} venue
 */
export function venueSpread(venue) {
  const n = venue?.n, low = venue?.range?.low, high = venue?.range?.high;
  if (!Number.isInteger(n) || /** @type {number} */ (n) < 2 || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  const range = /** @type {number} */ (high) - /** @type {number} */ (low);
  if (!(range > 0)) return null;
  return range / RANGE_D2[Math.min(/** @type {number} */ (n), RANGE_D2.length - 1)];
}

/** @param {number} p  a probability, 0..1 @returns {number} per cent, on the grain, inside the bounds */
const toShown = (p) => {
  const pct = Math.round((p * 100) / PAR_ESTIMATE_STEP) * PAR_ESTIMATE_STEP;
  return Math.min(100 - PAR_ESTIMATE_BOUND, Math.max(PAR_ESTIMATE_BOUND, pct));
};

/**
 * @typedef {object} ParEstimate
 * @property {number} batting   per cent, the side batting now
 * @property {number} fielding  per cent, the other side (100 − batting)
 * @property {"first_innings" | "chase"} kind
 * @property {number} z         the standardised gap it was read from (for the calibration note's log)
 */

/**
 * The par estimate for the innings on the board, or null where par does not
 * define one (above).
 * @param {object} o
 * @param {any} o.report    the par report, ONLY where it speaks for this very position (lib/par.js reportFor())
 * @param {any} o.inn       the fold's innings on the board
 * @param {boolean} o.chasing  it is the match's second innings, with a target
 * @param {number | null} [o.target]
 * @param {boolean} [o.rained]   rain touched the match (rainTouched())
 * @param {boolean} [o.decided]  play has decided the match
 * @returns {ParEstimate | null}
 */
export function parEstimate({ report, inn, chasing, target = null, rained = false, decided = false }) {
  if (!report || !inn || decided || rained || inn.superOver != null || inn.summarised != null) return null;
  const v = report.venue;
  if (!v?.sufficient || v.shortened || !Number.isInteger(v.par) || !Number.isInteger(v.parAt) || v.par <= 0) return null;
  const sigma = venueSpread(v);
  if (sigma == null) return null;
  const P = v.par, f = Math.max(0, (P - v.parAt) / P);
  const runs = inn.runs ?? 0;
  if (!chasing) {
    const z = (runs - v.parAt) / (sigma * Math.sqrt(1 + f));
    const batting = toShown(normalCdf(z));
    return { batting, fielding: 100 - batting, kind: "first_innings", z };
  }
  if (!Number.isInteger(target)) return null;
  const need = /** @type {number} */ (target) - runs;
  const left = (inn.overs ?? 0) * 6 - (inn.balls ?? 0);
  if (need <= 0 || left <= 0 || (inn.wickets ?? 0) >= 10 || inn.complete || f <= 0) return null;
  const z = (P * f - (need - 0.5)) / (sigma * Math.sqrt(f));
  const batting = toShown(normalCdf(z));
  return { batting, fielding: 100 - batting, kind: "chase", z };
}
// ── end CRI-1.8 ──

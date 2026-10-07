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
import { deriveMatch } from "./replay.mjs";
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
  const back = k >= 3 ? ends.find((e) => e.over === k - 3)?.innings?.[n] : inningsAtStart(evs, ctx, n, inn)?.[n] ?? { runs: 0, balls: 0 };
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
  const own = list.filter((i) => i && i.superOver == null);
  const chasing = n === 1 && inn.target != null;
  const rained = interrupted(own.slice(0, 2));
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
    const now = parAt(P, { allottedBalls: (inn.overs ?? 0) * 6, balls: at.balls, wickets: at.wickets }, { resources });
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
        const q = p ? parAt(P, { allottedBalls: (p.overs ?? 0) * 6, balls: p.balls, wickets: p.wickets }, { resources }) : null;
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

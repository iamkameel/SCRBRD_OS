/**
 * The ball-by-ball engine behind tools/demo-season.mjs: plays a school T20
 * innings through @scrbrd/scoring's own constructors and fold, one event at a
 * time, exactly as a scorer's taps build the log (tools/fixture-matchcentre.mjs
 * scoreInnings(), with each delivery stamped with its striker, non-striker
 * and bowler as the pad stamps them).
 *
 * Seeded and deterministic: the same seed plays the same innings. A match's
 * story (who wins, a hundred, a five-for) is asked for, and the caller tries
 * seeds until the log the fold reads back tells it.
 */
import {
  inningsStart, batters, bowler, ball, keeper, sealInnings, deriveInnings, placementFromTap, BALL_TYPE,
} from "@scrbrd/scoring";

/** mulberry32 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// Where each stroke goes, for a right-hander, as a screen angle (0 behind the
// keeper, 180 straight back past the bowler; leg side 0–180). Mirrored for a
// left-hander, whose leg side is the other half of the screen.
const SHOTS = {
  drive: [235, 275], cut: [280, 310], pull: [65, 100], flick: [25, 55], sweep: [55, 80],
  loft: [150, 200], slog: [105, 140], glance: [10, 30],
};
const FOUR_SHOTS = ["drive", "drive", "cut", "pull", "flick", "sweep", "glance", "loft"];
const SIX_SHOTS = ["loft", "slog", "pull", "loft", "sweep"];
const RUN_SHOTS = ["drive", "flick", "cut", "pull", "glance", "sweep", "drive"];

function tap(r, shot, runs, hand) {
  const [lo, hi] = SHOTS[shot];
  let angle = Math.round(lo + r() * (hi - lo));
  if (hand === "L") angle = (360 - angle) % 360;
  const radius = runs >= 4 ? 1 : runs === 3 ? 0.85 : runs === 2 ? 0.7 : 0.35 + r() * 0.3;
  return placementFromTap({ angle, radius: Math.round(radius * 100) / 100, batHand: hand ?? "R" });
}

/**
 * Bowl an attack in turn: no bowler twice running, four overs each at most.
 * @param {string[]} attack  best first
 * @param {number} overs
 */
export function overPlan(attack, overs = 20) {
  const plan = [];
  const used = new Map(attack.map((b) => [b, 0]));
  // Openers from each end for the first spells, then the rest.
  const order = [attack[0], attack[1], attack[0], attack[1], attack[2], attack[3], attack[2], attack[3],
                 attack[4] ?? attack[2], attack[0], attack[4] ?? attack[3], attack[1], attack[2], attack[3],
                 attack[4] ?? attack[0], attack[5] ?? attack[1], attack[0], attack[1], attack[2], attack[3]];
  for (let o = 0; o < overs; o++) {
    let b = order[o];
    if (!b || used.get(b) >= 4 || plan[o - 1] === b) {
      b = attack.find((x) => used.get(x) < 4 && plan[o - 1] !== x);
    }
    plan.push(b);
    used.set(b, used.get(b) + 1);
  }
  return plan;
}

/**
 * Play one innings.
 * @param {object} o
 * @param {number} o.innings
 * @param {string} o.idp            idempotency-key prefix
 * @param {object} o.start          inningsStart() fields
 * @param {{id: string, hand: string|null, skill: number}[]} o.order  the batting order, all eleven
 * @param {{id: string, skill: number, spin: boolean}[]} o.attack     the bowlers, best first
 * @param {string[]} o.fielders     the fielding XI's ids
 * @param {string} o.keeperId
 * @param {() => number} o.r
 * @param {number} o.strength       the batting side's form, ~0.8–1.25
 * @param {Record<string, {min: number, max?: number, notOut?: boolean}>} [o.batTargets]
 * @param {Record<string, number>} [o.bowlTargets]  wickets wanted
 * @param {number} [o.stopAt]       stop at the end of the over once this many legal balls are bowled (a live innings)
 * @param {boolean} [o.seal]        false: leave the innings open
 * @param {number} o.t0             clock, seconds from the match's start, at the first event
 * @returns {{log: any[], t: number, fold: any}}
 */
export function playInnings(o) {
  const { r } = o;
  const log = [];
  let n = 0, t = o.t0;
  const add = (ev, dt = 0) => { t += dt; const e = { ...ev, innings: o.innings, id: `${o.idp}-${o.innings}-${++n}`, clientTs: t }; log.push(e); return e; };
  add(inningsStart({ ...o.start, captureProfile: "full" }));
  add(keeper({ keeper: o.keeperId }), 5);
  add(batters({ striker: o.order[0].id, nonStriker: o.order[1].id }), 20);
  const queue = o.order.slice(2);
  const byId = new Map(o.order.map((b) => [b.id, b]));
  const attackById = new Map(o.attack.map((b) => [b.id, b]));
  const plan = overPlan(o.attack.map((b) => b.id));
  const bt = o.batTargets ?? {}, bw = o.bowlTargets ?? {};
  let over = 0;
  let inn = deriveInnings(log);
  for (let guard = 0; guard < 400; guard++) {
    if (inn.complete) break;
    if (o.stopAt != null && (inn.balls ?? 0) >= o.stopAt && inn.bowler == null) break;
    if (inn.bowler == null) {
      if (over >= plan.length) break;
      add(bowler({ bowler: plan[over] }), over === 0 ? 15 : 50);
      over += 1;
      inn = deriveInnings(log);
    }
    if (inn.striker == null || inn.nonStriker == null) {
      if (!queue.length) break;
      add(batters(inn.striker == null ? { striker: queue.shift().id } : { nonStriker: queue.shift().id }), 75);
      inn = deriveInnings(log);
    }
    const s = byId.get(inn.striker), b = attackById.get(inn.bowler);
    const who = { striker: inn.striker, nonStriker: inn.nonStriker, bowler: inn.bowler };
    const line = (inn.batsmen ?? []).find((x) => x.id === inn.striker) ?? { runs: 0, balls: 0 };
    const wkts = (inn.bowlers ?? []).find((x) => x.id === inn.bowler)?.wickets ?? 0;
    const legal = inn.balls ?? 0;
    const phase = legal < 36 ? "pp" : legal >= 96 ? "death" : "mid";
    const chase = inn.target != null;
    const need = chase ? inn.target - inn.runs : null;
    const ballsLeft = 120 - legal;

    // Extras first: a bowler's wides and no-balls, then byes and leg byes.
    const x = r();
    const bskill = b?.skill ?? 1;
    if (x < 0.032 / bskill) { add(ball({ type: BALL_TYPE.WIDE, value: r() < 0.12 ? 1 : 0, ...who }), 38); inn = deriveInnings(log); continue; }
    if (x < 0.032 / bskill + 0.011) {
      const v = r() < 0.6 ? 0 : pick(r, [1, 1, 2, 4]);
      add(ball({ type: BALL_TYPE.NO_BALL, value: v, ...who, ...(v ? { shot: pick(r, RUN_SHOTS) } : {}) }), 38);
      inn = deriveInnings(log); continue;
    }
    if (x < 0.032 / bskill + 0.011 + 0.008) { add(ball({ type: BALL_TYPE.BYE, value: pick(r, [1, 1, 2, 4]), ...who }), 38); inn = deriveInnings(log); continue; }
    if (x < 0.032 / bskill + 0.011 + 0.008 + 0.012) { add(ball({ type: BALL_TYPE.LEG_BYE, value: pick(r, [1, 1, 1, 2]), ...who }), 38); inn = deriveInnings(log); continue; }

    // The wicket.
    const target = bt[s.id];
    let pOut = 0.043 * bskill / (s.skill * o.strength);
    if (phase === "death") pOut *= 1.5;
    if (chase && need > ballsLeft * 1.6) pOut *= 1.6;
    if (target) {
      if (line.runs < target.min) pOut *= 0.08;
      else if (target.notOut) pOut = 0;
      else if (target.max != null && line.runs >= target.max) pOut *= 8;
    }
    const wantW = bw[inn.bowler];
    if (wantW != null && wkts < wantW) pOut *= 2.6;
    if (wantW == null && Object.keys(bw).length && Object.entries(bw).some(([, w]) => w > 0)) pOut *= 0.8;
    if (inn.freeHit) pOut = 0;
    if (r() < pOut) {
      const k = r();
      const keeperId = o.keeperId;
      const fieldersBut = o.fielders.filter((f) => f !== inn.bowler);
      let ev;
      if (b?.spin && k < 0.09) ev = ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "stumped", fielder: keeperId, ...who });
      else if (k < 0.55) {
        const f = r() < 0.22 ? keeperId : r() < 0.07 ? inn.bowler : pick(r, fieldersBut);
        ev = ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: f, ...who, shot: pick(r, ["drive", "pull", "loft", "cut", "slog"]) });
      } else if (k < 0.75) ev = ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled", ...who });
      else if (k < 0.88) ev = ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "lbw", ...who });
      else {
        // A run out, going for a run: either end, credited to no bowler.
        const ns = r() < 0.45;
        ev = ball({ type: BALL_TYPE.WICKET, value: r() < 0.5 ? 1 : 0, dismissal: "run_out", dismissed: ns ? inn.nonStriker : inn.striker,
                    outAt: ns ? "bowler_end" : "striker_end", fielder: pick(r, fieldersBut), ...who });
      }
      add(ev, 60);
      inn = deriveInnings(log);
      continue;
    }

    // The runs off the bat.
    let w = { 0: 0.38, 1: 0.34, 2: 0.09, 3: 0.015, 4: 0.102, 6: 0.03 };
    const agg = s.skill * o.strength * (phase === "pp" ? 1.1 : phase === "death" ? 1.3 : 0.95);
    w[4] *= agg; w[6] *= agg * agg; w[0] /= agg;
    if (target && line.runs < target.min) { w[4] *= 1.35; w[6] *= 1.4; w[1] *= 1.1; }
    if (chase && need <= 6) { w[6] *= 1.5; w[4] *= 1.3; }
    const tot = Object.values(w).reduce((a, c) => a + c, 0);
    let y = r() * tot, runs = 0;
    for (const [k, v] of Object.entries(w)) { if ((y -= v) <= 0) { runs = Number(k); break; } }
    const shot = runs === 0 ? (r() < 0.5 ? "fwd_def" : null) : runs >= 6 ? pick(r, SIX_SHOTS) : runs === 4 ? pick(r, FOUR_SHOTS) : pick(r, RUN_SHOTS);
    const placed = runs > 0 && SHOTS[shot] && r() < 0.92 ? tap(r, shot, runs, s.hand) : {};
    add(ball({ type: BALL_TYPE.RUN, value: runs, ...who, ...(shot ? { shot } : {}), ...placed }), 38);
    inn = deriveInnings(log);
  }
  const sealed = deriveInnings(log);
  if (o.seal === false) return { log, t, fold: sealed };
  log.push({ ...sealInnings(sealed, sealed.endReason ?? "overs_complete"), innings: o.innings, id: `${o.idp}-${o.innings}-seal`, clientTs: t + 30 });
  return { log, t: t + 30, fold: sealed };
}

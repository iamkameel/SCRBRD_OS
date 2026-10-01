/**
 * The logs the rain rule is proved on (SCRBRD-130 R1, design §7's parity
 * list): each a match with interruptions — stops, resumptions, the umpires'
 * revisions and par — its status, its play conditions, and the result and
 * per-innings figures the design gives it. Not a test itself:
 *
 *   packages/scoring/test/rain.test.mjs       holds the fold, describeResult()
 *                                             and the Laws to `expect`
 *   tools/smoke-fold-figures.mjs              writes each log to ball_event as
 *                                             toRow() does and holds SQL's
 *                                             match_result() and
 *                                             innings_stop_as_folded() to the fold
 *
 * Every event carries its own clientTs from RAIN_DAY (nothing reads the
 * clock); the home side bats under "1XI", the away side under "Kearsney", as
 * result-logs.mjs and the pad write them. No DLS resource figure is here:
 * the umpires' figures are typed, as the scorer types them (D1).
 */
import {
  inningsStart, batters, bowler, ball, revision, playStopped, playResumed, sealInnings,
  deriveInningsList, BALL_TYPE,
} from "../src/index.mjs";

/** @import { LogEvent } from "../src/events.mjs" */

/** The fixture's start, SAST: a 4th-Edition match. */
export const RAIN_STARTS_AT = "2026-10-10T10:00:00+02:00";
const T0 = Date.parse("2026-10-10T08:00:00Z");
export const RAIN_SIDES = Object.freeze({ home: "1XI", away: "Kearsney" });
export const RAIN_NAMES = Object.freeze({ home: "Hilton 1XI", away: "Kearsney" });

/** @param {string} side */
const squadOf = (side) => Array.from({ length: 11 }, (_, k) => ({ id: `${side} ${k + 1}`, name: `${side} ${k + 1}` }));

/**
 * @typedef {number | "W" | {stop: string} | {resume: true} | {rev: {overs?: number, target?: number, par?: number}}} RainStep
 * @typedef {{bat: string, bowl: string, steps: RainStep[], overs: number, target?: number | null,
 *            seal?: string | null | false}} RainPlan
 *   seal: undefined seals with the reason the fold derives (not at all when it
 *   derives none); a reason seals with it; false leaves the innings unsealed.
 */

/**
 * A match's log from its innings, sealed as a scorer would.
 * @param {RainPlan[]} plans  @param {object} [ctx]
 * @returns {LogEvent[]}
 */
export function rainLog(plans, ctx = {}) {
  /** @type {LogEvent[][]} */
  const byInnings = [];
  const fctx = { startsAt: RAIN_STARTS_AT, ...ctx };
  let clock = T0;
  plans.forEach((p, i) => {
    const sq = squadOf(p.bat);
    /** @type {any[]} */
    const evs = [inningsStart({ battingTeam: p.bat, bowlingTeam: p.bowl, squad: sq, bowlingSquad: squadOf(p.bowl),
                                overs: p.overs, target: p.target ?? null }),
                 batters({ striker: sq[0].id, nonStriker: sq[1].id }), bowler({ bowler: `${p.bowl} 1` })];
    let next = 2;
    for (const s of p.steps) {
      if (typeof s === "number") evs.push(ball({ type: BALL_TYPE.RUN, value: s }));
      else if (s === "W") {
        evs.push(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }));
        evs.push(batters({ striker: sq[next++].id, nonStriker: sq[1].id }));
      } else if ("stop" in s) evs.push(playStopped({ reason: s.stop, at: (clock += 60_000) }));
      else if ("resume" in s) evs.push(playResumed({ at: (clock += 2_400_000) }));
      else if ("rev" in s) evs.push(revision({ overs: s.rev.overs ?? null, target: s.rev.target ?? null, par: s.rev.par ?? null, reason: "rain" }));
    }
    byInnings[i] = evs.map((e) => ({ ...e, innings: i }));
    if (p.seal !== false) {
      const inn = /** @type {any} */ (deriveInningsList(byInnings, fctx)[i]);
      const reason = p.seal ?? inn.endReason ?? null;
      if (reason != null) byInnings[i].push({ ...sealInnings(inn, reason), innings: i });
    }
  });
  return byInnings.flat().map((e, k) => ({ ...e, clientTs: T0 + k * 1000, id: `rain-log:${k}` }));
}

const H = RAIN_SIDES.home, A = RAIN_SIDES.away;
const DLS = { "target.method": "dls_standard" };
/** n balls of r runs. @param {number} n @param {number} r @returns {number[]} */
const runs = (n, r) => Array(n).fill(r);
/** Hilton's 24 off two overs. */
const FIRST24 = { bat: H, bowl: A, steps: runs(12, 2), overs: 2 };

/**
 * @typedef {object} RainLog
 * @property {string} name
 * @property {LogEvent[]} log
 * @property {string} status
 * @property {Record<string, unknown> | null} play
 * @property {{outcome: string, marginKind: string | null, marginValue: number | null, winnerSide: string | null,
 *             text: string | null}} expect
 * @property {{stopped: boolean, par: number | null, stops: number}[]} innings  each innings' stop and par, as
 *   innings_stop_as_folded() gives them
 */

/** @type {RainLog[]} */
export const RAIN_LOGS = [
  { name: "a first innings stopped at 2.0 and resumed at 4 overs; the chase's announced target reached (DLS)",
    status: "complete", play: DLS,
    log: rainLog([{ bat: H, bowl: A, overs: 5, steps: [...runs(12, 1), { stop: "rain" }, { rev: { overs: 4 } }, { resume: true }, ...runs(12, 2)] },
                  { bat: A, bowl: H, overs: 4, target: 40, steps: [6, 6, 6, 6, 6, 6, 4] }], { conditions: DLS }),
    expect: { outcome: "away_win", marginKind: "wickets", marginValue: 10, winnerSide: "away", text: "Kearsney won by 10 wickets (DLS)" },
    innings: [{ stopped: false, par: null, stops: 1 }, { stopped: false, par: null, stops: 0 }] },
  { name: "a first innings terminated; the chase short of its announced target (revised target)",
    status: "complete", play: null,
    log: rainLog([{ bat: H, bowl: A, overs: 5, steps: [...runs(6, 1), { stop: "rain" }], seal: "abandoned" },
                  { bat: A, bowl: H, overs: 3, target: 20, steps: runs(18, 1) }]),
    expect: { outcome: "home_win", marginKind: "runs", marginValue: 1, winnerSide: "home", text: "Hilton 1XI won by 1 run (revised target)" },
    innings: [{ stopped: false, par: null, stops: 1 }, { stopped: false, par: null, stops: 0 }] },
  { name: "the interval lost: the chase starts shorter with a scaled target, and reaches it (DLS)",
    status: "complete", play: DLS,
    log: rainLog([FIRST24, { bat: A, bowl: H, overs: 1, target: 15, steps: [6, 6, 4] }], { conditions: DLS }),
    expect: { outcome: "away_win", marginKind: "wickets", marginValue: 10, winnerSide: "away", text: "Kearsney won by 10 wickets (DLS)" },
    innings: [{ stopped: false, par: null, stops: 0 }, { stopped: false, par: null, stops: 0 }] },
  { name: "a chase stopped at 1.0 and resumed at 2 overs with a new target; short (DLS)",
    status: "complete", play: DLS,
    log: rainLog([FIRST24, { bat: A, bowl: H, overs: 3, target: 37,
                             steps: [...runs(6, 1), { stop: "rain" }, { rev: { overs: 2, target: 30 } }, { resume: true }, ...runs(6, 2)] }],
                 { conditions: DLS }),
    expect: { outcome: "home_win", marginKind: "runs", marginValue: 11, winnerSide: "home", text: "Hilton 1XI won by 11 runs (DLS)" },
    innings: [{ stopped: false, par: null, stops: 0 }, { stopped: false, par: null, stops: 1 }] },
  { name: "a chase terminated above par: won by wickets (DLS)",
    status: "complete", play: DLS,
    log: rainLog([FIRST24, { bat: A, bowl: H, overs: 2, target: 25,
                             steps: [...runs(6, 2), 1, 1, 1, { stop: "rain" }, { rev: { par: 13 } }], seal: "abandoned" }], { conditions: DLS }),
    expect: { outcome: "away_win", marginKind: "wickets", marginValue: 10, winnerSide: "away", text: "Kearsney won by 10 wickets (DLS)" },
    innings: [{ stopped: false, par: null, stops: 0 }, { stopped: false, par: 13, stops: 1 }] },
  { name: "a chase terminated level with par: tied (DLS)",
    status: "complete", play: DLS,
    log: rainLog([FIRST24, { bat: A, bowl: H, overs: 2, target: 25,
                             steps: [...runs(6, 2), 1, 1, 1, { stop: "rain" }, { rev: { par: 15 } }], seal: "abandoned" }], { conditions: DLS }),
    expect: { outcome: "tie", marginKind: null, marginValue: null, winnerSide: null, text: "Match tied (DLS)" },
    innings: [{ stopped: false, par: null, stops: 0 }, { stopped: false, par: 15, stops: 1 }] },
  { name: "a chase terminated below par: the first side wins by the runs short (DLS)",
    status: "complete", play: DLS,
    log: rainLog([FIRST24, { bat: A, bowl: H, overs: 2, target: 25,
                             steps: [...runs(6, 2), 1, "W", 1, { stop: "rain" }, { rev: { par: 18 } }], seal: "abandoned" }], { conditions: DLS }),
    expect: { outcome: "home_win", marginKind: "runs", marginValue: 4, winnerSide: "home", text: "Hilton 1XI won by 4 runs (DLS)" },
    innings: [{ stopped: false, par: null, stops: 0 }, { stopped: false, par: 18, stops: 1 }] },
  { name: "the same chase under the umpires' revision: the words say revised target, nothing else differs",
    status: "complete", play: null,
    log: rainLog([FIRST24, { bat: A, bowl: H, overs: 2, target: 25,
                             steps: [...runs(6, 2), 1, "W", 1, { stop: "rain" }, { rev: { par: 18 } }], seal: "abandoned" }]),
    expect: { outcome: "home_win", marginKind: "runs", marginValue: 4, winnerSide: "home", text: "Hilton 1XI won by 4 runs (revised target)" },
    innings: [{ stopped: false, par: null, stops: 0 }, { stopped: false, par: 18, stops: 1 }] },
  { name: "a chase terminated with no par: no result",
    status: "complete", play: DLS,
    log: rainLog([FIRST24, { bat: A, bowl: H, overs: 2, target: 25, steps: [...runs(6, 2), 1, { stop: "bad_light" }], seal: "abandoned" }],
                 { conditions: DLS }),
    expect: { outcome: "no_result", marginKind: null, marginValue: null, winnerSide: null, text: "No result" },
    innings: [{ stopped: false, par: null, stops: 0 }, { stopped: false, par: null, stops: 1 }] },
  { name: "min overs 2 on balls faced: a chase terminated after 1.3 with a par is no result",
    status: "complete", play: { ...DLS, "result.min_overs_per_side": 2 },
    log: rainLog([FIRST24, { bat: A, bowl: H, overs: 2, target: 25,
                             steps: [...runs(6, 2), 1, 1, 1, { stop: "rain" }, { rev: { par: 13 } }], seal: "abandoned" }],
                 { conditions: { ...DLS, "result.min_overs_per_side": 2 } }),
    expect: { outcome: "no_result", marginKind: null, marginValue: null, winnerSide: null, text: "No result" },
    innings: [{ stopped: false, par: null, stops: 0 }, { stopped: false, par: 13, stops: 1 }] },
  { name: "min overs 1 on balls faced: the same chase, 1.3 faced, is decided on par",
    status: "complete", play: { ...DLS, "result.min_overs_per_side": 1 },
    log: rainLog([FIRST24, { bat: A, bowl: H, overs: 2, target: 25,
                             steps: [...runs(6, 2), 1, 1, 1, { stop: "rain" }, { rev: { par: 13 } }], seal: "abandoned" }],
                 { conditions: { ...DLS, "result.min_overs_per_side": 1 } }),
    expect: { outcome: "away_win", marginKind: "wickets", marginValue: 10, winnerSide: "away", text: "Kearsney won by 10 wickets (DLS)" },
    innings: [{ stopped: false, par: null, stops: 0 }, { stopped: false, par: 13, stops: 1 }] },
  { name: "two interruptions in one innings, one mid-over; the chase's target unrevised: no suffix",
    status: "complete", play: DLS,
    log: rainLog([{ bat: H, bowl: A, overs: 4,
                    steps: [...runs(4, 1), { stop: "rain" }, { resume: true }, ...runs(8, 1), { stop: "wet_ground" }, { rev: { overs: 3 } },
                            { resume: true }, ...runs(6, 1)] },
                  { bat: A, bowl: H, overs: 3, target: 19, steps: [6, 6, 6, 1] }], { conditions: DLS }),
    expect: { outcome: "away_win", marginKind: "wickets", marginValue: 10, winnerSide: "away", text: "Kearsney won by 10 wickets" },
    innings: [{ stopped: false, par: null, stops: 2 }, { stopped: false, par: null, stops: 0 }] },
  { name: "a stop before the first ball, the innings cut to 3 overs; the chase over the same",
    status: "complete", play: DLS,
    log: rainLog([{ bat: H, bowl: A, overs: 5, steps: [{ stop: "rain" }, { rev: { overs: 3 } }, { resume: true }, ...runs(18, 1)] },
                  { bat: A, bowl: H, overs: 3, target: 19, steps: [...runs(17, 1), 0] }], { conditions: DLS }),
    expect: { outcome: "home_win", marginKind: "runs", marginValue: 1, winnerSide: "home", text: "Hilton 1XI won by 1 run" },
    innings: [{ stopped: false, par: null, stops: 1 }, { stopped: false, par: null, stops: 0 }] },
  { name: "a chase stopped and not yet resumed: in progress, stopped",
    status: "live", play: DLS,
    log: rainLog([FIRST24, { bat: A, bowl: H, overs: 2, target: 25, steps: [...runs(5, 1), { stop: "rain" }], seal: false }], { conditions: DLS }),
    expect: { outcome: "in_progress", marginKind: null, marginValue: null, winnerSide: null, text: null },
    innings: [{ stopped: false, par: null, stops: 0 }, { stopped: true, par: null, stops: 1 }] },
  { name: "a first innings stopped and not yet resumed: stopped, the chase not begun",
    status: "live", play: null,
    log: rainLog([{ bat: H, bowl: A, overs: 5, steps: [...runs(9, 1), { stop: "rain" }], seal: false }]),
    expect: { outcome: "in_progress", marginKind: null, marginValue: null, winnerSide: null, text: null },
    innings: [{ stopped: true, par: null, stops: 1 }] },
];

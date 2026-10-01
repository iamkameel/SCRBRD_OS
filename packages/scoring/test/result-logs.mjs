/**
 * The logs a match's result is proved on (SCRBRD-114 phase 3a, design §7):
 * each a match — its innings, its status, its play conditions and any
 * decision — and the result the design says it has. Not a test itself:
 *
 *   packages/scoring/test/result.test.mjs     holds describeResult() to `expect`
 *   tools/smoke-fold-figures.mjs              writes each log to ball_event as
 *                                             toRow() does and holds SQL's
 *                                             match_result() to the fold's
 *
 * so the fold, SQL and the design say one thing about every log here.
 *
 * Every event carries its own clientTs, from RESULT_DAY: a match on
 * 3 October 2026, under the 4th Edition (the Edition flips on 1 October and
 * has bitten twice; nothing here reads the clock). The home side bats under
 * the fixture's team code "1XI", the away side under its name "Kearsney", as
 * the pad writes them (lib/matchCentre.js sideOfTeam()).
 */
import {
  inningsStart, batters, bowler, ball, penalty, revision, inningsSummary, sealInnings,
  deriveInningsList, BALL_TYPE,
} from "../src/index.mjs";

/** @import { LogEvent } from "../src/events.mjs" */

/** The fixture's start, SAST: a 4th-Edition match. */
export const RESULT_STARTS_AT = "2026-10-03T10:00:00+02:00";
const T0 = Date.parse("2026-10-03T08:00:00Z");
/** How the fixture names its sides, as match.team_code and match.opponent. */
export const RESULT_SIDES = Object.freeze({ home: "1XI", away: "Kearsney" });
/** How the words name them. */
export const RESULT_NAMES = Object.freeze({ home: "Hilton 1XI", away: "Kearsney" });

/** @param {string} side @param {number} [n] */
const squadOf = (side, n = 11) => Array.from({ length: n }, (_, k) => ({ id: `${side} ${k + 1}`, name: `${side} ${k + 1}` }));

/**
 * @typedef {number | "W" | "Wd" | {pen: number, toBat: boolean} | {rev: {overs?: number, target?: number}}} Step
 * @typedef {{bat: string, bowl: string, steps: Step[], overs?: number, target?: number | null, squad?: number,
 *            seal?: string | null | false, card?: {total: number, wickets: number, overs: string, endReason: string}}} InningsPlan
 *   seal: undefined seals with the reason the fold derives; a reason seals with
 *   it; false leaves the innings unsealed. card: an innings from a scorebook.
 */

/**
 * A match's log from its innings, sealed as a scorer would: each seal carries
 * the figures the fold of the match so far gives (deriveInningsList(), so a
 * penalty credited from another innings is in them).
 * @param {InningsPlan[]} plans
 * @param {object} [ctx]  the fold's context (conditions)
 * @returns {LogEvent[]}
 */
export function buildLog(plans, ctx = {}) {
  /** @type {LogEvent[][]} */
  const byInnings = [];
  const fctx = { startsAt: RESULT_STARTS_AT, ...ctx };
  plans.forEach((p, i) => {
    const sq = squadOf(p.bat, p.squad ?? 11);
    /** @type {any[]} */
    const evs = [inningsStart({ battingTeam: p.bat, bowlingTeam: p.bowl, squad: sq, bowlingSquad: squadOf(p.bowl),
                                overs: p.overs ?? 20, target: p.target ?? null })];
    if (p.card) {
      evs.push(inningsSummary({ card: { v: 1, innings: i, battingSide: p.bat === RESULT_SIDES.home ? "home" : "away",
        batting: [], didNotBat: [], bowling: [], extras: { byes: null, legByes: null, wides: null, noBalls: null, penalty: null },
        fallOfWickets: [], unreconciled: null, ...p.card } }));
    } else {
      evs.push(batters({ striker: sq[0].id, nonStriker: sq[1].id }), bowler({ bowler: `${p.bowl} 1` }));
      let next = 2;
      for (const s of p.steps) {
        if (typeof s === "number") evs.push(ball({ type: BALL_TYPE.RUN, value: s }));
        else if (s === "Wd") evs.push(ball({ type: BALL_TYPE.WIDE, value: 0 }));
        else if (s === "W") {
          evs.push(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }));
          if (next < sq.length) evs.push(batters({ striker: sq[next++].id, nonStriker: sq[1].id }));
        } else if ("pen" in s) evs.push(penalty({ runs: s.pen, toBattingTeam: s.toBat, reason: s.toBat ? "helmet_struck" : "time_wasting" }));
        else if ("rev" in s) evs.push(revision({ overs: s.rev.overs ?? null, target: s.rev.target ?? null, reason: "rain" }));
      }
    }
    byInnings[i] = evs.map((e) => ({ ...e, innings: i }));
    if (p.seal !== false) {
      const inn = /** @type {any} */ (deriveInningsList(byInnings, fctx)[i]);
      byInnings[i].push({ ...sealInnings(inn, p.seal ?? inn.endReason ?? null), innings: i });
    }
  });
  // One clock, one second apart, in log order; an id for each, as the pad mints.
  return byInnings.flat().map((e, k) => ({ ...e, clientTs: T0 + k * 1000, id: `result-log:${k}` }));
}

/** Penalty steps a plan can carry after its seal: appended to that innings. @param {LogEvent[]} log @param {number} i @param {Step[]} steps */
function after(log, i, steps) {
  const extra = steps.map((s) => (typeof s === "object" && "pen" in s
    ? penalty({ runs: s.pen, toBattingTeam: s.toBat, reason: s.toBat ? "helmet_struck" : "time_wasting" }) : null))
    .filter((e) => e != null).map((e) => ({ ...e, innings: i }));
  const all = [...log.map(({ clientTs: _c, id: _i, ...e }) => e), ...extra];
  return all.map((e, k) => ({ ...e, clientTs: T0 + k * 1000, id: `result-log:${k}` }));
}

const H = RESULT_SIDES.home, A = RESULT_SIDES.away;
/** Hilton's 14 off an over: 4 1 0 2 6 1. */
const FIRST14 = { bat: H, bowl: A, steps: [4, 1, 0, 2, 6, 1], overs: 1 };
const TWO = { "format.innings_per_side": 2 };

/**
 * @typedef {object} ResultLog
 * @property {string} name
 * @property {LogEvent[]} log
 * @property {string} status          match.status
 * @property {Record<string, unknown> | null} play  the frozen play part, or none
 * @property {{kind: string, side: string, overridesPlay?: boolean, reason: string} | null} decision
 * @property {{outcome: string, marginKind: string | null, marginValue: number | null, winnerSide: string | null,
 *             decidedBy: string | null, text: string | null}} expect
 */

/** @type {ResultLog[]} */
export const RESULT_LOGS = [
  { name: "a chase won by wickets", status: "complete", play: null, decision: null,
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [6, 4, "W", 4, 1], overs: 1, target: 15 }]),
    expect: { outcome: "away_win", marginKind: "wickets", marginValue: 9, winnerSide: "away", decidedBy: "play", text: "Kearsney won by 9 wickets" } },
  { name: "a chase short: won by runs", status: "complete", play: null, decision: null,
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [1, 1, "W", 1, 0, 2], overs: 1, target: 15 }]),
    expect: { outcome: "home_win", marginKind: "runs", marginValue: 9, winnerSide: "home", decidedBy: "play", text: "Hilton 1XI won by 9 runs" } },
  { name: "a chase one short: by 1 run", status: "live", play: null, decision: null,
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [6, 6, 1, 0, 0, 0], overs: 1, target: 15 }]),
    expect: { outcome: "home_win", marginKind: "runs", marginValue: 1, winnerSide: "home", decidedBy: "play", text: "Hilton 1XI won by 1 run" } },
  { name: "a tie, under no tie-break", status: "complete", play: { "result.tie_break": "none" }, decision: null,
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [6, 6, 1, 1, 0, 0], overs: 1, target: 15 }]),
    expect: { outcome: "tie", marginKind: null, marginValue: null, winnerSide: null, decidedBy: "play", text: "Match tied" } },
  { name: "a chase sealed abandoned: no result, never a win by runs", status: "live", play: null, decision: null,
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [1, 1], overs: 1, target: 15, seal: "abandoned" }]),
    expect: { outcome: "no_result", marginKind: null, marginValue: null, winnerSide: null, decidedBy: null, text: "No result" } },
  { name: "a chase never finished, the match complete", status: "complete", play: null, decision: null,
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [1, 1], overs: 1, target: 15, seal: false }]),
    expect: { outcome: "no_result", marginKind: null, marginValue: null, winnerSide: null, decidedBy: null, text: "No result" } },
  { name: "a chase under way", status: "live", play: null, decision: null,
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [1, 1], overs: 1, target: 15, seal: false }]),
    expect: { outcome: "in_progress", marginKind: null, marginValue: null, winnerSide: null, decidedBy: null, text: null } },
  { name: "abandoned before a ball", status: "abandoned", play: null, decision: null, log: [],
    expect: { outcome: "abandoned", marginKind: null, marginValue: null, winnerSide: null, decidedBy: null, text: "Match abandoned" } },
  { name: "abandoned in the chase, by the organiser", status: "abandoned", play: null, decision: null,
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [1, 1], overs: 1, target: 15, seal: false }]),
    expect: { outcome: "abandoned", marginKind: null, marginValue: null, winnerSide: null, decidedBy: null, text: "Match abandoned" } },
  { name: "min overs 5: a chase revised to 4, its overs bowled, short", status: "complete",
    play: { "result.min_overs_per_side": 5 }, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: Array(12).fill(2), overs: 2 },
                   { bat: A, bowl: H, steps: [{ rev: { overs: 4, target: 30 } }, ...Array(24).fill(1)], overs: 6, target: 25 }],
                  { conditions: { "result.min_overs_per_side": 5 } }),
    expect: { outcome: "no_result", marginKind: null, marginValue: null, winnerSide: null, decidedBy: null, text: "No result" } },
  { name: "min overs 5: the same chase reaching its target in 3", status: "complete",
    play: { "result.min_overs_per_side": 5 }, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: Array(12).fill(2), overs: 2 },
                   { bat: A, bowl: H, steps: [{ rev: { overs: 4, target: 30 } }, ...Array(15).fill(2)], overs: 6, target: 25 }],
                  { conditions: { "result.min_overs_per_side": 5 } }),
    expect: { outcome: "away_win", marginKind: "wickets", marginValue: 10, winnerSide: "away", decidedBy: "play", text: "Kearsney won by 10 wickets" } },
  { name: "the same short chase with no minimum: won by runs", status: "complete", play: null, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: Array(12).fill(2), overs: 2 },
                   { bat: A, bowl: H, steps: [{ rev: { overs: 4, target: 30 } }, ...Array(24).fill(1)], overs: 6, target: 25 }]),
    expect: { outcome: "home_win", marginKind: "runs", marginValue: 5, winnerSide: "home", decidedBy: "play", text: "Hilton 1XI won by 5 runs" } },
  { name: "by penalty runs (Law 16.7, 4th Edition)", status: "complete", play: null, decision: null,
    log: after(buildLog([{ bat: H, bowl: A, steps: [4, 4, 1, 0, 0, 0], overs: 1 },
                         { bat: A, bowl: H, steps: [1, 1, 1, 1, 1, 1], overs: 1, target: 10 }]), 1, [{ pen: 5, toBat: true }]),
    expect: { outcome: "away_win", marginKind: "penalty_runs", marginValue: null, winnerSide: "away", decidedBy: "play", text: "Kearsney won by penalty runs" } },
  { name: "five to the fielding side in the chase raises the target", status: "complete", play: null, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: [4, 4, 1, 0, 1, 0], overs: 1 },
                   { bat: A, bowl: H, steps: [{ pen: 5, toBat: false }, 6, 6, 1, 1, 0, 0], overs: 1, target: 11 }]),
    expect: { outcome: "home_win", marginKind: "runs", marginValue: 1, winnerSide: "home", decidedBy: "play", text: "Hilton 1XI won by 1 run" } },
  { name: "two innings a side: a draw", status: "complete", play: TWO, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: [4, 4], seal: "declared" }, { bat: A, bowl: H, steps: [6, 1], seal: "declared" },
                   { bat: H, bowl: A, steps: [1, 1], seal: "declared" }], { conditions: TWO }),
    expect: { outcome: "draw", marginKind: null, marginValue: null, winnerSide: null, decidedBy: "play", text: "Match drawn" } },
  { name: "two innings a side: the second innings passing the first is not a win", status: "complete", play: TWO, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: [4, 4], seal: "declared" }, { bat: A, bowl: H, steps: [6, 4], target: 9 }], { conditions: TWO }),
    expect: { outcome: "draw", marginKind: null, marginValue: null, winnerSide: null, decidedBy: "play", text: "Match drawn" } },
  { name: "two innings a side: an innings and 17 runs", status: "complete", play: TWO, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: [6, 6, 6, 6, 6], seal: "declared" }, { bat: A, bowl: H, steps: [4, "W", 1, "W"], squad: 3 },
                   { bat: A, bowl: H, steps: [6, "W", 2, "W"], squad: 3 }], { conditions: TWO }),
    expect: { outcome: "home_win", marginKind: "innings", marginValue: 17, winnerSide: "home", decidedBy: "play", text: "Hilton 1XI won by an innings and 17 runs" } },
  { name: "two innings a side: the fourth innings chase reached", status: "live", play: TWO, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: [6, 4], seal: "declared" }, { bat: A, bowl: H, steps: [4, 4], seal: "declared" },
                   { bat: H, bowl: A, steps: [6], seal: "declared" }, { bat: A, bowl: H, steps: [4, "W", 6], target: 9 }], { conditions: TWO }),
    expect: { outcome: "away_win", marginKind: "wickets", marginValue: 9, winnerSide: "away", decidedBy: "play", text: "Kearsney won by 9 wickets" } },
  { name: "two innings a side: the fourth innings all out short", status: "complete", play: TWO, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: [6, 4], seal: "declared" }, { bat: A, bowl: H, steps: [4, 4], seal: "declared" },
                   { bat: H, bowl: A, steps: [6], seal: "declared" }, { bat: A, bowl: H, steps: [4, "W", 1, "W"], squad: 3, target: 9 }], { conditions: TWO }),
    expect: { outcome: "home_win", marginKind: "runs", marginValue: 3, winnerSide: "home", decidedBy: "play", text: "Hilton 1XI won by 3 runs" } },
  { name: "a scorebook chase won by wickets", status: "complete", play: null, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: [], card: { total: 127, wickets: 4, overs: "20", endReason: "overs" } },
                   { bat: A, bowl: H, steps: [], target: 128, card: { total: 128, wickets: 3, overs: "18.2", endReason: "target" } }]),
    expect: { outcome: "away_win", marginKind: "wickets", marginValue: 7, winnerSide: "away", decidedBy: "play", text: "Kearsney won by 7 wickets" } },
  { name: "a scorebook tie", status: "complete", play: null, decision: null,
    log: buildLog([{ bat: H, bowl: A, steps: [], card: { total: 127, wickets: 4, overs: "20", endReason: "overs" } },
                   { bat: A, bowl: H, steps: [], target: 128, card: { total: 127, wickets: 10, overs: "19.4", endReason: "all_out" } }]),
    expect: { outcome: "tie", marginKind: null, marginValue: null, winnerSide: null, decidedBy: "play", text: "Match tied" } },
  { name: "conceded in the chase", status: "complete", play: null,
    decision: { kind: "conceded", side: "away", reason: "Kearsney could not field eleven after lunch" },
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [1, 1], overs: 1, target: 15, seal: false }]),
    expect: { outcome: "home_win", marginKind: "conceded", marginValue: null, winnerSide: "home", decidedBy: "decision",
              text: "Kearsney conceded; awarded to Hilton 1XI" } },
  { name: "a walkover, no ball bowled", status: "scheduled", play: null,
    decision: { kind: "walkover", side: "home", reason: "Kearsney did not arrive at the ground" }, log: [],
    expect: { outcome: "home_win", marginKind: "walkover", marginValue: null, winnerSide: "home", decidedBy: "decision", text: "Walkover to Hilton 1XI" } },
  { name: "an award that overrides play", status: "complete", play: null,
    decision: { kind: "awarded", side: "home", overridesPlay: true, reason: "protest upheld by the league committee" },
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [6, 4, "W", 4, 1], overs: 1, target: 15 }]),
    expect: { outcome: "home_win", marginKind: "awarded", marginValue: null, winnerSide: "home", decidedBy: "decision",
              text: "Kearsney won by 9 wickets; awarded to Hilton 1XI by the organiser: protest upheld by the league committee" } },
  { name: "an award on a tie names who goes through, and the tie stands", status: "complete", play: null,
    decision: { kind: "awarded", side: "away", reason: "the cup's rules: the higher seed goes through" },
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [6, 6, 1, 1, 0, 0], overs: 1, target: 15 }]),
    expect: { outcome: "tie", marginKind: null, marginValue: null, winnerSide: "away", decidedBy: "decision",
              text: "Match tied; awarded to Kearsney by the organiser: the cup's rules: the higher seed goes through" } },
  { name: "a concession on a match play decided: play stands", status: "complete", play: null,
    decision: { kind: "conceded", side: "home", reason: "entered against the wrong match by mistake" },
    log: buildLog([FIRST14, { bat: A, bowl: H, steps: [6, 4, "W", 4, 1], overs: 1, target: 15 }]),
    expect: { outcome: "away_win", marginKind: "wickets", marginValue: 9, winnerSide: "away", decidedBy: "play", text: "Kearsney won by 9 wickets" } },
];

/**
 * The super over (SCRBRD-114 phase 3b; docs/design/SCRBRD-114_phase3_results_super_over.md §3):
 *
 *   A. the marker on the wire: `superOver` on innings_start, omitted (never
 *      null) on a match innings, carried by toRow()/fromRow() in the payload,
 *      refused by the constructor unless a whole number from 1
 *   B. the fold: inn.superOver; two wickets end a super over, and only a
 *      super over; its seal at two wickets stands
 *   C. penalty runs to a fielding side move within their pair (§3.2): an
 *      award in innings 2 opens innings 3, never a match innings — the same
 *      in deriveMatch(), deriveInningsList() and MatchFold.view()
 *   D. the Laws (§3.3): each of the five refusals refusing and the corrected
 *      event accepted; MATCH_DECIDED no longer refuses a super over after a
 *      tie and still refuses one after a win; asked of the server's fold and
 *      the pad's alike
 *   E. the result lists the pairs (describeResult(), match_result()'s shape)
 *      and the words over SQL's row are the fold's
 *
 *   node packages/scoring/test/super-over.test.mjs
 */
import {
  inningsStart, batters, bowler, ball, penalty, revision, sealInnings, toRow, fromRow,
  deriveMatch, deriveInningsList, MatchFold, penaltyCredits, lawsRefusal, REFUSAL, REFUSAL_TEXT,
  BALL_TYPE, INNINGS_END_REASON, wicketsToEnd, pairState, PAIR_STATE, resultFromRow, resultWords, superOverWords,
} from "../src/index.mjs";
import { RESULT_LOGS, RESULT_SIDES, RESULT_NAMES, RESULT_STARTS_AT, CUP } from "./result-logs.mjs";

/** @import { LogEvent } from "../src/events.mjs" */

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, detail?: unknown) => void} */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${typeof d === "string" ? d : JSON.stringify(d)}`); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const H = "1XI", A = "Kearsney";
const T0 = Date.parse("2026-10-03T08:00:00Z");
/** @param {string} side */
const squad = (side) => Array.from({ length: 11 }, (_, k) => ({ id: `${side} ${k + 1}`, name: `${side} ${k + 1}` }));

/**
 * A log built event by event, innings by innings, each event stamped with
 * its innings, an id and a clock (the 4th Edition: 3 October 2026).
 */
class Log {
  constructor() {
    /** @type {LogEvent[]} */
    this.events = [];
  }
  /** @param {number} i @param {...any} evs */
  add(i, ...evs) { for (const e of evs) this.events.push({ ...e, innings: i, clientTs: T0 + this.events.length * 1000, id: `so:${this.events.length}` }); return this; }
  /** Open innings i: the batting side, its openers and the bowler. @param {number} i @param {string} bat @param {object} [more] */
  open(i, bat, more = {}) {
    const bowl = bat === H ? A : H;
    return this.add(i, inningsStart({ battingTeam: bat, bowlingTeam: bowl, squad: squad(bat), bowlingSquad: squad(bowl), overs: 1, ...more }),
                    batters({ striker: `${bat} 1`, nonStriker: `${bat} 2` }), bowler({ bowler: `${bowl} 1` }));
  }
  /** Runs off the bat, one ball each; "W" a wicket with the next man in. @param {number} i @param {(number | "W")[]} steps */
  play(i, steps) {
    let next = 3;
    const bat = /** @type {any} */ (this.events.find((e) => e.innings === i && e.kind === "innings_start"))?.battingTeam;
    for (const s of steps) {
      if (s === "W") { this.add(i, ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })); this.add(i, batters({ striker: `${bat} ${next++}`, nonStriker: `${bat} 2` })); }
      else this.add(i, ball({ type: BALL_TYPE.RUN, value: s }));
    }
    return this;
  }
  /** Seal innings i on the figures the match's fold gives it. @param {number} i @param {string | null} [reason] */
  seal(i, reason) {
    const inn = /** @type {any} */ (this.fold().innings[i]);
    return this.add(i, sealInnings(inn, reason ?? inn.endReason ?? null));
  }
  /** The server's fold, told the cup's document. @param {object} [ctx] */
  fold(ctx = { startsAt: RESULT_STARTS_AT, conditions: CUP }) { return new MatchFold(this.events, ctx).view(); }
  /** The pad's: each innings' log, folded together (engine.jsx's shape). @param {object} [ctx] */
  pad(ctx = { startsAt: RESULT_STARTS_AT, conditions: CUP }) {
    /** @type {LogEvent[][]} */ const by = [];
    for (const e of this.events) (by[e.innings ?? 0] ??= []).push(e);
    return { innings: deriveInningsList(by, ctx), events: by };
  }
}

/** The match tied: Hilton 14 off an over, Kearsney 14 chasing 15, both sealed. */
const tied = () => new Log().open(0, H).play(0, [4, 1, 0, 2, 6, 1]).seal(0)
  .open(1, A, { target: 15 }).play(1, [6, 6, 1, 1, 0, 0]).seal(1);
/** The match won: Kearsney 15 chasing 15. */
const won = () => new Log().open(0, H).play(0, [4, 1, 0, 2, 6, 1]).seal(0)
  .open(1, A, { target: 15 }).play(1, [6, 6, 1, 1, 1]).seal(1);

/**
 * The Laws on one event, asked of the server's fold and the pad's; they must agree.
 * @param {Log} log @param {any} ev @param {object} [ctx]
 */
const judge = (log, ev, ctx) => {
  const server = lawsRefusal(log.fold(ctx), ev);
  const pad = lawsRefusal(log.pad(ctx), ev);
  return server === pad ? server : `disagree: server ${server}, pad ${pad}`;
};
/** @param {number} i @param {string} bat @param {object} more */
const startOf = (i, bat, more) => ({ ...inningsStart({ battingTeam: bat, bowlingTeam: bat === H ? A : H, squad: squad(bat), overs: 1, clientTs: T0, ...more }), innings: i });

group("A. The marker on the wire");
{
  const plain = inningsStart({ battingTeam: H, bowlingTeam: A, overs: 20, clientTs: T0 });
  ok("a match innings carries no superOver key at all", !("superOver" in plain), plain);
  ok("...byte for byte what it was", JSON.stringify(plain) === JSON.stringify(inningsStart({ battingTeam: H, bowlingTeam: A, overs: 20, superOver: null, clientTs: T0 })));
  const so = inningsStart({ battingTeam: A, bowlingTeam: H, overs: 1, superOver: 1, clientTs: T0 });
  ok("a super over's innings_start carries superOver: 1", so.superOver === 1);
  const row = toRow({ ...so, innings: 2 });
  ok("toRow() carries it in the payload", row.payload.superOver === 1 && row.innings === 2, row.payload);
  ok("...and fromRow() reads it back", /** @type {any} */ (fromRow({ ...row, seq: 1 })).superOver === 1);
  ok("toRow() of a match innings has no superOver in the payload", !("superOver" in toRow(plain).payload));
  for (const bad of [0, -1, 1.5, "1", true]) {
    let threw = false;
    try { inningsStart({ battingTeam: A, bowlingTeam: H, superOver: /** @type {any} */ (bad), clientTs: T0 }); } catch { threw = true; }
    ok(`the constructor refuses superOver ${JSON.stringify(bad)}`, threw);
  }
}

group("B. The fold: the marker, and two wickets end a super over");
{
  const log = tied().open(2, A, { superOver: 1 }).play(2, [4, "W", 1, "W"]);
  const f = log.fold();
  ok("the match's innings are not super overs", f.innings[0].superOver === null && f.innings[1].superOver === null);
  ok("innings 2 is the first super over", f.innings[2].superOver === 1);
  ok("two wickets end it: all out at 5 for 2 after four balls",
     f.innings[2].complete && f.innings[2].endReason === INNINGS_END_REASON.ALL_OUT && f.innings[2].wickets === 2 && f.innings[2].balls === 4, f.innings[2]);
  ok("wicketsToEnd(): 2 in a super over, 10 in a match innings", wicketsToEnd(f.innings[2]) === 2 && wicketsToEnd(f.innings[1]) === 10);
  const sealed = log.seal(2).fold().innings[2];
  ok("...and its seal, all out at two wickets, stands", sealed.sealed && sealed.sealRefused == null && sealed.endReason === "all_out", sealed);
  const notSo = new Log().open(0, H).play(0, [4, "W", 1, "W"]).fold().innings[0];
  ok("two wickets do not end a match innings", !notSo.complete && notSo.wickets === 2, notSo);
}

group("C. Penalty runs to the fielding side move within their pair");
{
  // Kearsney bat first in the super over; Hilton, fielding, are awarded five
  // (time wasting by the batting side). Hilton's next innings in the PAIR is
  // innings 3: they open on 5. Without the pair, the five would land on
  // innings 0 — Hilton's match total — and the tie would be a win.
  const log = tied().open(2, A, { superOver: 1 }).play(2, [6, 1]).add(2, penalty({ runs: 5, toBattingTeam: false, reason: "time_wasting" }));
  const pending = penaltyCredits(log.fold().innings.map((x, i) => [i, x]));
  ok("before innings 3 opens, the award is pending: no match innings takes it",
     pending.pending.length === 1 && pending.added.size === 0 && pending.carried.size === 0, pending);
  log.play(2, [1, 0, 0, 0]).seal(2).open(3, H, { superOver: 1, target: 9 });
  const m = deriveMatch(log.events, { startsAt: RESULT_STARTS_AT, conditions: CUP });
  const list = log.pad().innings;
  const v = log.fold();
  for (const [name, inns] of [["deriveMatch()", m.innings], ["deriveInningsList()", list], ["MatchFold.view()", v.innings]]) {
    const xs = /** @type {any[]} */ (inns);
    ok(`${name}: innings 3 opens on the five`, xs[3].runs === 5 && xs[3].penaltyCarried === 5, xs[3]);
    ok(`${name}: innings 0 and 1 are as they were: 14 and 14`, xs[0].runs === 14 && xs[1].runs === 14, [xs[0].runs, xs[1].runs]);
  }
  ok("the match is still a tie", deriveMatch(log.events, { startsAt: RESULT_STARTS_AT, conditions: CUP, sides: RESULT_SIDES }).result?.outcome === "tie");
}

group("D. The Laws: the five refusals, and the corrected event");
{
  // SUPER_OVER_NOT_TIED
  ok("a super over after a match WON is refused: super_over_not_tied",
     judge(won(), startOf(2, A, { superOver: 1 })) === REFUSAL.SUPER_OVER_NOT_TIED);
  ok("...after a tie, the same innings_start is accepted", judge(tied(), startOf(2, A, { superOver: 1 })) === null);
  const unsealedTie = new Log().open(0, H).play(0, [4, 1, 0, 2, 6, 1]).seal(0).open(1, A, { target: 15 }).play(1, [6, 6, 1, 1, 0]);
  ok("...before the chase is over (five balls, level so far), refused", judge(unsealedTie, startOf(2, A, { superOver: 1 })) === REFUSAL.SUPER_OVER_NOT_TIED);
  const so1won = tied().open(2, A, { superOver: 1 }).play(2, [4, 1, 0, 0, 0, 0]).seal(2).open(3, H, { superOver: 1, target: 6 }).play(3, [6]).seal(3);
  ok("a second super over after the first was WON is refused", judge(so1won, startOf(4, H, { superOver: 2 })) === REFUSAL.SUPER_OVER_NOT_TIED);
  const so1tied = tied().open(2, A, { superOver: 1 }).play(2, [4, 1, 0, 0, 0, 0]).seal(2).open(3, H, { superOver: 1, target: 6 }).play(3, [4, 1, 0, 0, 0, 0]).seal(3);
  ok("...after the first was TIED, accepted", judge(so1tied, startOf(4, H, { superOver: 2 })) === null);
  const so1abandoned = tied().open(2, A, { superOver: 1 }).play(2, [4, 1, 0, 0, 0, 0]).seal(2).open(3, H, { superOver: 1, target: 6 }).play(3, [1]).seal(3, "abandoned");
  ok("...after the first was left incomplete (sealed abandoned), refused", judge(so1abandoned, startOf(4, H, { superOver: 2 })) === REFUSAL.SUPER_OVER_NOT_TIED);
  const TWO_CUP = { startsAt: RESULT_STARTS_AT, conditions: { ...CUP, "format.innings_per_side": 2 } };
  const fourLevel = tied().open(2, H).play(2, [1, 0, 0, 0, 0, 0]).seal(2).open(3, A, { target: 2 }).play(3, [1, 0, 0, 0, 0, 0]).seal(3);
  ok("two innings a side never has one (D11), even with its last two innings level",
     judge(fourLevel, startOf(4, A, { superOver: 1 }), TWO_CUP) === REFUSAL.SUPER_OVER_NOT_TIED);

  // SUPER_OVER_NUMBER
  ok("the first super over numbered 2 is refused: super_over_number", judge(tied(), startOf(2, A, { superOver: 2 })) === REFUSAL.SUPER_OVER_NUMBER);
  ok("a super-over marker on a match innings (index 1) is refused", judge(new Log().open(0, H).play(0, [1]), startOf(1, A, { superOver: 1 })) === REFUSAL.SUPER_OVER_NUMBER);
  const half = tied().open(2, A, { superOver: 1 });
  ok("the pair's second innings numbered 2 is refused", judge(half, startOf(3, H, { superOver: 2, target: 1 })) === REFUSAL.SUPER_OVER_NUMBER);
  ok("...numbered 1, accepted — even before the first has a ball, as the pad opens a pair", judge(half, startOf(3, H, { superOver: 1, target: 1 })) === null);
  ok("a marker that is not a whole number from 1 is refused", judge(tied(), { ...startOf(2, A, {}), superOver: 0 }) === REFUSAL.SUPER_OVER_NUMBER);
  ok("the second super over at index 3 (in the first's place) is refused", judge(half, startOf(3, H, { superOver: 2 })) === REFUSAL.SUPER_OVER_NUMBER);
  ok("a pair's second innings with no first before it (index 3, innings 2 never opened) is refused",
     judge(tied(), startOf(3, H, { superOver: 1 })) === REFUSAL.SUPER_OVER_NUMBER);

  // SUPER_OVER_AFTER_MATCH_INNINGS
  ok("a third innings with no marker, in a match whose document says one innings a side, is refused",
     judge(tied(), startOf(2, A, {})) === REFUSAL.SUPER_OVER_AFTER_MATCH_INNINGS);
  ok("...marked as the first super over, accepted", judge(tied(), startOf(2, A, { superOver: 1 })) === null);
  ok("...told no document, the log's shape is unknown: not refused for it",
     judge(tied(), startOf(2, A, {}), { startsAt: RESULT_STARTS_AT }) === null);
  ok("a two-innings match's third innings with no marker is accepted",
     judge(tied(), startOf(2, H, {}), { startsAt: RESULT_STARTS_AT, conditions: { "format.innings_per_side": 2 } }) === null);

  // SUPER_OVER_NO_REVISION
  const inSo = tied().open(2, A, { superOver: 1 }).play(2, [1]);
  ok("a revision in a super over is refused: super_over_no_revision",
     judge(inSo, { ...revision({ overs: 0, target: null, reason: "rain", clientTs: T0 }), innings: 2 }) === REFUSAL.SUPER_OVER_NO_REVISION);
  ok("...in a match innings, accepted as ever",
     judge(new Log().open(0, H).play(0, [1]), { ...revision({ overs: 10, target: null, reason: "rain", clientTs: T0 }), innings: 0 }) === null);

  // MATCH_DECIDED, redefined
  ok("a ball in the first super over after a tie is accepted (not match_decided)", judge(tied().open(2, A, { superOver: 1 }), { ...ball({ type: BALL_TYPE.RUN, value: 1, clientTs: T0 }), innings: 2 }) === null);
  const afterWin = won().add(2, startOf(2, A, { superOver: 1 }), batters({ striker: `${A} 1`, nonStriker: `${A} 2` }), bowler({ bowler: `${H} 1` }));
  ok("...after a WIN (the super over's innings_start written directly), a ball is match_decided",
     judge(afterWin, { ...ball({ type: BALL_TYPE.RUN, value: 1, clientTs: T0 }), innings: 2 }) === REFUSAL.MATCH_DECIDED);
  ok("a ball in the super over's chase once it is won is match_decided", judge(so1won, { ...ball({ type: BALL_TYPE.RUN, value: 1, clientTs: T0 }), innings: 3 }) === REFUSAL.MATCH_DECIDED);
  ok("a ball in the first innings of a won super over is match_decided", judge(so1won, { ...ball({ type: BALL_TYPE.RUN, value: 1, clientTs: T0 }), innings: 2 }) === REFUSAL.LATER_INNINGS_STARTED
     || judge(so1won, { ...ball({ type: BALL_TYPE.RUN, value: 1, clientTs: T0 }), innings: 2 }) === REFUSAL.MATCH_DECIDED);
  ok("a ball in the match's chase once a super over has play is later_innings_started",
     judge(inSo, { ...ball({ type: BALL_TYPE.RUN, value: 1, clientTs: T0 }), innings: 1 }) === REFUSAL.LATER_INNINGS_STARTED);
  ok("a ball in the match's chase after the tie, no super over yet: match_decided as ever",
     judge(tied(), { ...ball({ type: BALL_TYPE.RUN, value: 1, clientTs: T0 }), innings: 1 }) === REFUSAL.MATCH_DECIDED);
  ok("a ball in a TIED super over's chase is match_decided: the next pair, never more balls",
     judge(so1tied, { ...ball({ type: BALL_TYPE.RUN, value: 1, clientTs: T0 }), innings: 3 }) === REFUSAL.MATCH_DECIDED);

  for (const code of [REFUSAL.SUPER_OVER_NOT_TIED, REFUSAL.SUPER_OVER_NUMBER, REFUSAL.SUPER_OVER_AFTER_MATCH_INNINGS, REFUSAL.SUPER_OVER_NO_REVISION, "super_over_not_provided"]) {
    ok(`${code} has words`, typeof REFUSAL_TEXT[/** @type {keyof typeof REFUSAL_TEXT} */ (code)] === "string");
  }
}

group("E. The result lists the pairs, and SQL's row says the same words");
{
  const x = /** @type {any} */ (RESULT_LOGS.find((l) => l.name === "two super overs tied, the third won"));
  const r = deriveMatch(x.log, { startsAt: RESULT_STARTS_AT, conditions: x.play, status: x.status, sides: RESULT_SIDES, names: RESULT_NAMES }).result;
  const states = (r?.superOvers ?? []).map((p) => `${p.n}:${p.first}:${p.state}:${p.winner}`).join(" ");
  ok("three pairs: tied, tied, won by home", states === "1:away:tied:null 2:home:tied:null 3:away:won:home", states);
  ok("...the first pair's figures", JSON.stringify(r?.superOvers?.[0].a) === JSON.stringify({ runs: 7, wickets: 0, balls: 6 }), r?.superOvers?.[0]);
  const row = { outcome: "tie", margin_kind: null, margin: null, decided_by: "super_over", winner_side: "home", winner_key: H,
                play_outcome: "tie", play_winner_side: "home", play_winner_key: H, decision: null, decision_applied: false,
                super_overs: (r?.superOvers ?? []).map((p) => ({ n: p.n, first: p.first, a: p.a, b: p.b, state: p.state, winner: p.winner, winner_key: p.winnerKey })) };
  const words = resultWords(/** @type {any} */ (resultFromRow(row)), { nameOf: (k, s) => (s ? RESULT_NAMES[/** @type {"home" | "away"} */ (s)] : k ?? "—") });
  ok("resultWords() over the row is the fold's text", words === r?.text, { words, fold: r?.text });
  // Logs the Laws would refuse, written from elsewhere: the result still reads them as §3 says.
  const ctx = { startsAt: RESULT_STARTS_AT, conditions: CUP, sides: RESULT_SIDES, names: RESULT_NAMES };
  const noChase = new Log().open(0, H).play(0, [4, 1, 0, 2, 6, 1]).seal(0).open(2, A, { superOver: 1 }).play(2, [6, 6, 6]).seal(2, "declared");
  ok("a super-over innings is never read as the match's chase: no chase, no result",
     deriveMatch(noChase.events, ctx).result === null, deriveMatch(noChase.events, ctx).result);
  const outOfOrder = tied().open(2, A, { superOver: 1 }).play(2, [4, 1, 0, 0, 0, 0]).seal(2).open(3, H, { superOver: 1, target: 6 }).play(3, [1]).seal(3, "abandoned")
    .open(4, H, { superOver: 2 }).play(4, [6, 0, 0, 0, 0, 0]).seal(4).open(5, A, { superOver: 2, target: 7 }).play(5, [1, 0, 0, 0, 0, 0]).seal(5);
  const oo = deriveMatch(outOfOrder.events, ctx).result;
  ok("pairs settle in order: a pair left incomplete is not passed over for a later one won",
     oo?.decidedBy === null && oo?.winnerSide === null && oo?.text === "Match tied; the super over was not completed", oo);
  ok("pairState(): level is tied, short is won by the first, reached by the second",
     pairState(/** @type {any} */ ({ complete: true, runs: 7 }), /** @type {any} */ ({ complete: true, runs: 7, target: null })).state === PAIR_STATE.TIED
     && pairState(/** @type {any} */ ({ complete: true, runs: 7 }), /** @type {any} */ ({ complete: true, runs: 5 })).state === PAIR_STATE.WON
     && pairState(/** @type {any} */ ({ complete: true, runs: 7 }), /** @type {any} */ ({ complete: false, runs: 5 })).state === PAIR_STATE.INCOMPLETE);
  const nm = (/** @type {string | null} */ _k, /** @type {string | null} */ s) => (s === "home" ? "Northwood" : "Kearsney");
  const w = (/** @type {string[]} */ st) => superOverWords(st.map((s, k) => ({ n: k + 1, first: null, a: { runs: 0, wickets: 0, balls: 0 }, b: null, state: s, winner: s === "won" ? "home" : null, winnerKey: null })), nm);
  ok("the words: one won", w(["won"]) === "; Northwood won the super over", w(["won"]));
  ok("...one tied then won", w(["tied", "won"]) === "; the first super over tied; Northwood won the second", w(["tied", "won"]));
  ok("...unfinished", w(["incomplete"]) === "; the super over was not completed", w(["incomplete"]));
  ok("...two tied, the third unfinished", w(["tied", "tied", "incomplete"]) === "; two super overs tied; the third was not completed", w(["tied", "tied", "incomplete"]));
  ok("...one tied and nothing since", w(["tied"]) === "; the super over tied", w(["tied"]));
  ok("...none: nothing", w([]) === "");
}

console.log(`\n────────────────────────────────────────────────────\nSUPER OVER SUITE: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

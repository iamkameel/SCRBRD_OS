/**
 * Proves the fold is total and correct:
 *   A. aggregates the artifact used to maintain by hand are reproduced exactly
 *   B. undo is truncation + re-derive, at any depth
 *   C. the Laws-of-Cricket cases the artifact's counters got wrong
 *   D. replay is deterministic and order-independent given seq
 *   E. the wire round-trip (client event ↔ ball_event row) is lossless
 *   H. an innings is over when the laws say so, and closed only when a scorer
 *      has confirmed the figures the log actually holds (SCRBRD-038)
 *   I. a declared capture profile is read against the log and never rewrites
 *      it — and an innings that declared nothing replays as it always did
 *      (SCRBRD-039)
 */
import {
  deriveInnings, deriveMatch, fmtOvers, confirmationState, sealInnings, SEAL_REFUSAL,
  inningsStart, batters, bowler, ball, penalty, retire, inningsEnd,
  BALL_TYPE, KIND, toRow, fromRow, isLegal,
  voidEvent, undoLast, lastUndoableIndex, newEventId, boundaryOf, LOCAL_ONLY,
  placementFromTap, noPlacement, screenAngle, thetaFromScreen,
  zoneFromRadius, closePositionFor, hasPoint, heatMapEligible, batHandOf,
  thetaFromClock, clockFromTheta, fieldingCircle, depthBand, positionName,
  PLACEMENT_SOURCE, PLACEMENT_NULL, CLOSE_RADIUS, DISMISSAL, chargedToBowler, normaliseDismissal, revision,
  CAPTURE_PROFILE, PLACEMENT_FIELD, NOT_CAPTURED, evidenceLabel, placementEvidence, profileCollects,
  MatchFold, deriveInningsList, penaltyCredits, shortRunning, bowlerSuspended, suspensionWords,
} from "../src/index.mjs";
import { runsToBowler, keeper } from "../src/index.mjs";

/** @import { LogEvent, Loose, BallEvent, BallInput, BattersEvent, BowlerEvent, InningsStartEvent, InningsStartInput } from "../src/events.mjs" */
/** @import { Innings } from "../src/replay.mjs" */

let pass = 0, fail = 0;
// A third argument (a detail to print) is passed in places and ignored here.
/** @type {(n: string, c: unknown, detail?: unknown) => void} */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
/**
 * The value an assertion reads, which the setup guarantees is there: a
 * missing one fails the suite loudly instead of being read as a property.
 * @template T  @param {T} x  @returns {NonNullable<T>}
 */
const must = (x) => { if (x == null) throw new Error("replay.test: expected a value"); return x; };

// ── Fixtures ─────────────────────────────────────────────
const SQ_A = [
  { id: "p1", name: "James Whitfield" }, { id: "p2", name: "T Bekker" },
  { id: "p3", name: "S Naidoo" },        { id: "p4", name: "M Cele" },
  { id: "p5", name: "R Pillay" },
];
const SQ_B = [
  { id: "w1", name: "D Mkhize" }, { id: "w2", name: "K Botha" },
  { id: "w3", name: "L Govender" },
];

const open = () => [
  inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville Boys'", squad: SQ_A, bowlingSquad: SQ_B, overs: 20 }),
  batters({ striker: "p1", nonStriker: "p2" }),
  bowler({ bowler: "w1" }),
];
/** @param {number} v  @param {BallInput} [o] */
const runs = (v, o = {}) => ball({ type: BALL_TYPE.RUN, value: v, ...o });

// ── A. Aggregates the artifact maintained by hand ────────
group("A. Derived aggregates");
{
  const inn = deriveInnings([...open(), runs(4), runs(1), runs(0), runs(6), runs(2), runs(1)]);
  ok("runs total",            inn.runs === 14);
  ok("legal balls counted",   inn.balls === 6);
  ok("overs formatted",       fmtOvers(inn.balls) === "1.0");
  // p1 faces balls 1-2 (4, then 1 which rotates); p2 faces 3-6 (0, 6, 2, 1).
  ok("striker figures",       inn.batsmen.find(b => b.id === "p1")?.runs === 5);
  ok("non-striker figures",   inn.batsmen.find(b => b.id === "p2")?.runs === 9);
  ok("balls faced split",     inn.batsmen.find(b => b.id === "p1")?.balls === 2 && inn.batsmen.find(b => b.id === "p2")?.balls === 4);
  ok("boundaries counted",    inn.batsmen.find(b => b.id === "p1")?.fours === 1 && inn.batsmen.find(b => b.id === "p2")?.sixes === 1);
  ok("bowler conceded",       inn.bowlers.find(b => b.id === "w1")?.runs === 14);
  ok("bowler balls",          inn.bowlers.find(b => b.id === "w1")?.balls === 6);
  ok("ballLog length",        inn.ballLog.length === 6);
  ok("overLog grouped",       inn.overLog.length === 1 && inn.overLog[0].balls.length === 6);
  ok("bowler cleared at over end", inn.bowler === null);
}
{
  // Extras: a wide, a no-ball with 2 off the bat, 3 byes, 1 leg bye.
  const inn = deriveInnings([
    ...open(),
    ball({ type: BALL_TYPE.WIDE, value: 0 }),
    ball({ type: BALL_TYPE.NO_BALL, value: 2 }),
    ball({ type: BALL_TYPE.BYE, value: 3 }),
    ball({ type: BALL_TYPE.LEG_BYE, value: 1 }),
  ]);
  ok("wide = 1 extra",          inn.extras.wide === 1);
  ok("no-ball penalty only",    inn.extras.noBall === 1);
  ok("byes recorded",           inn.extras.bye === 3);
  ok("leg byes recorded",       inn.extras.legBye === 1);
  ok("total runs 1+3+3+1",      inn.runs === 8);
  ok("only legal balls count",  inn.balls === 2);
  ok("no-ball runs to batter",  inn.batsmen.find(b => b.id === "p1")?.runs === 2);
  ok("byes NOT to batter",      inn.batsmen.find(b => b.id === "p1")?.runs === 2);
  ok("byes NOT charged to bowler", inn.bowlers.find(b => b.id === "w1")?.runs === 4);
}
{
  const inn = deriveInnings([
    ...open(), runs(1), runs(0), runs(0),
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: "K Botha" }),
    batters({ striker: "p3" }),
    runs(2),
  ]);
  ok("wicket counted",        inn.wickets === 1);
  ok("bowler credited",       inn.bowlers.find(b => b.id === "w1")?.wickets === 1);
  ok("fall of wicket logged", inn.fow.length === 1 && inn.fow[0].runs === 1);
  ok("dismissal reads as a scorecard line", inn.batsmen.find(b => b.id === "p2")?.dismissal === "c K Botha b D Mkhize");
  ok("out batter marked",     inn.batsmen.find(b => b.id === "p2")?.status === "out");
  ok("new batter at crease",  inn.striker === "p3");
  ok("partnership closed",    inn.partnerships.length === 1);
}
{
  // THE WICKET MATRIX. Every way out in the Laws, and the two questions the
  // reducer asks of it — credited to the bowler? stands on a free hit? — from
  // one set, so the answers cannot disagree. The law used to be two regexes
  // over free text; "r/o" credited the bowler and handled ball on a free hit
  // was thrown out.
  const CREDITED = new Set(["bowled", "caught", "lbw", "stumped", "hit_wicket"]);
  for (const d of Object.values(DISMISSAL)) {
    const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: d, fielder: "F" })]);
    ok(`${d}: is a wicket`, inn.wickets === 1);
    ok(`${d}: bowler ${CREDITED.has(d) ? "credited" : "NOT credited"}`,
       inn.bowlers.find(b => b.id === "w1")?.wickets === (CREDITED.has(d) ? 1 : 0));
    ok(`${d}: chargedToBowler agrees`, chargedToBowler(d) === CREDITED.has(d));
    const fh = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0 }),
                                        ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: d })]);
    ok(`${d}: on a free hit ${CREDITED.has(d) ? "does not stand" : "stands"}`, fh.wickets === (CREDITED.has(d) ? 0 : 1));
  }
  // Spellings a producer might use, all one law.
  for (const [text, want] of [["Run Out", "run_out"], ["run-out", "run_out"], ["r/o", "run_out"], ["RO", "run_out"],
                              ["timed-out", "timed_out"], ["Caught", "caught"], ["c", "caught"], ["st", "stumped"],
                              ["Handled Ball", "handled_ball"], ["Obstructed Field", "obstructing_field"],
                              ["hit the ball twice", "hit_twice"], ["retired", "retired_out"], ["LBW", "lbw"]]) {
    ok(`"${text}" is ${want}`, normaliseDismissal(text) === want);
  }
  ok("an unknown spelling is not a dismissal", normaliseDismissal("run away") === null && normaliseDismissal(null) === null);
  ok("the builder writes the canonical value", ball({ type: BALL_TYPE.WICKET, dismissal: "r/o" }).dismissal === "run_out");
  ok("...and keeps an unknown one for the API to refuse by name", ball({ type: BALL_TYPE.WICKET, dismissal: "run away" }).dismissal === "run away");
  const ro = deriveInnings([...open(), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "r/o", fielder: "L Govender" })]);
  ok("\"r/o\" is NOT the bowler's wicket", ro.bowlers.find(b => b.id === "w1")?.wickets === 0);
  ok("...and reads on the card as a run out", ro.batsmen.find(b => b.status === "out")?.dismissal === "run out (L Govender)");
  const hw = deriveInnings([...open(), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "Hit Wicket" })]);
  ok("hit wicket reads with the bowler", /^hit wicket b /.test(hw.batsmen.find(b => b.status === "out")?.dismissal ?? ""));
}
{
  // THE UMPIRES CUT THE MATCH. Rain: an innings of 20 becomes 10, and a chase
  // of 151 becomes 90. Both are events in the log, not edits beside it.
  const cut = deriveInnings([...open(), revision({ overs: 1, reason: "rain" }),
    ...Array.from({ length: 6 }, () => ball({ type: BALL_TYPE.RUN, value: 1 }))]);
  ok("a revision to one over ends the innings after six legal balls", cut.complete === true && cut.balls === 6);
  ok("...and the innings says it was revised", cut.revised?.overs === 1 && cut.revised?.reason === "rain");
  const notCut = deriveInnings([...open(), ...Array.from({ length: 6 }, () => ball({ type: BALL_TYPE.RUN, value: 1 }))]);
  ok("without the revision, six balls is not an innings", notCut.complete === false);

  // Both innings are closed with sealInnings(), not with a hand-rolled
  // innings_end. A seal carries the figures the scorer read back and is refused
  // if the log does not produce them — see group F — so a fixture that asserts
  // "this innings is over" without them is asserting nothing the reducer honours.
  const firstPlayed = [...open(), ball({ type: BALL_TYPE.RUN, value: 6 })];
  const first = [...firstPlayed, sealInnings(deriveInnings(firstPlayed), "declared")]
    .map((e) => ({ ...e, innings: 0 }));
  /** @param {number} target  @param {number} runs  @param {boolean} [done] */
  const chase = (target, runs, done = true) => {
    // Revised to one over and the target: `runs` singles, then dots until the
    // target is reached or the over is bowled (or, not done, stop there).
    const played = [
      ...open().map((e) => ({ ...e, innings: 1 })),
      { ...revision({ target, overs: 1 }), innings: 1 },
      ...Array.from({ length: runs }, () => ({ ...ball({ type: BALL_TYPE.RUN, value: 1 }), innings: 1 })),
    ];
    if (!done) return played;
    if (runs < target) played.push(...Array.from({ length: 6 - runs }, () => ({ ...ball({ type: BALL_TYPE.RUN, value: 0 }), innings: 1 })));
    // A chase that reached the revised target ended on its own; one that did
    // not had its revised over bowled. Each says so, and the result stands on
    // the revised target, which is what is being tested. (A chase the umpires
    // called — sealed `abandoned` — is no result, never a win by the runs it
    // was short: SCRBRD-114 phase 3a, group P.)
    const inn = deriveInnings(played);
    return [...played, { ...sealInnings(inn), innings: 1 }];
  };
  ok("a chase that reaches the REVISED target wins, though it scored fewer than the first innings",
     deriveMatch([...first, ...chase(4, 4)]).result?.winner === "HIL" || deriveMatch([...first, ...chase(4, 4)]).result?.winner != null);
  const r4 = deriveMatch([...first, ...chase(4, 4)]).result;
  const r2 = deriveMatch([...first, ...chase(4, 2)]).result;
  const r3 = deriveMatch([...first, ...chase(4, 3)]).result;
  ok("...by wickets", /wickets?$/.test(r4?.margin ?? ""), JSON.stringify(r4));
  ok("a chase short of the revised target loses by the shortfall, not by the first-innings total", r2?.winner === innings0Team(first) && r2?.margin === "1 run", JSON.stringify(r2));
  ok("one short of the revised target is a tie", r3?.winner === null && r3?.margin === "tie", JSON.stringify(r3));
  ok("an unfinished chase has no result yet", deriveMatch([...first, ...chase(4, 2, false)]).result === null);
}
/** @param {LogEvent[]} evs */
function innings0Team(evs) { return evs.find((e) => e.kind === "innings_start")?.battingTeam; }
{
  // Run out is not the bowler's wicket.
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run out", fielder: "L Govender" })]);
  ok("run out counts as a wicket",     inn.wickets === 1);
  ok("run out NOT credited to bowler", inn.bowlers.find(b => b.id === "w1")?.wickets === 0);
}
{
  // Maidens: an over of dots, then an over with a leg bye (still a maiden).
  const dots = Array.from({ length: 6 }, () => runs(0));
  const inn = deriveInnings([
    ...open(), ...dots,
    bowler({ bowler: "w2" }),
    ...Array.from({ length: 5 }, () => runs(0)), ball({ type: BALL_TYPE.LEG_BYE, value: 1 }),
  ]);
  ok("maiden over detected",        inn.bowlers.find(b => b.id === "w1")?.maidens === 1);
  ok("leg bye does not spoil maiden", inn.bowlers.find(b => b.id === "w2")?.maidens === 1);
}
{
  // A wide IS charged to the bowler, so an over containing one is never a maiden
  // even though the six legal balls were all dots.
  const withWide = deriveInnings([...open(), ball({ type: BALL_TYPE.WIDE, value: 0 }), ...Array.from({ length: 6 }, () => runs(0))]);
  ok("over has 6 legal balls plus the wide", withWide.overLog[0].balls.length === 7 && withWide.balls === 6);
  ok("wide spoils the maiden",               withWide.bowlers.find(b => b.id === "w1")?.maidens === 0);
}
{
  const inn = deriveInnings([...open(), penalty({ runs: 5 })]);
  ok("penalty runs added",     inn.runs === 5);
  ok("penalty in extras",      inn.extras.penalty === 5);
  ok("penalty is not a ball",  inn.balls === 0);
}

// ── B. Undo is truncation ────────────────────────────────
group("B. Undo by truncation");
{
  const log = [...open(), runs(4), runs(1), runs(6), runs(2), runs(0), runs(1)];
  const full = deriveInnings(log);
  const back1 = deriveInnings(log.slice(0, -1));
  const back5 = deriveInnings(log.slice(0, -5));
  ok("undo one ball",       back1.runs === full.runs - 1 && back1.balls === 5);
  ok("undo five balls",     back5.runs === 4 && back5.balls === 1);
  ok("undo to the start",   deriveInnings(log.slice(0, 3)).runs === 0);
  // The artifact capped undo at a 10-entry snapshot stack. Deriving makes depth
  // free: correcting ball 2 after ball 14 is just a shorter log.
  const long = [...open(), ...Array.from({ length: 14 }, (_, i) => runs(i % 3))];
  const corrected = [...long.slice(0, 4), runs(6), ...long.slice(5)];
  ok("correct ball 2 after ball 14", deriveInnings(corrected).runs === deriveInnings(long).runs - /** @type {BallEvent} */ (long[4]).value + 6);   // [4]: open() is three events
  ok("undo depth is unbounded",      deriveInnings(long.slice(0, 4)).balls === 1);
}

// ── C. Laws the artifact's hand-maintained counters got wrong ──
group("C. Divergences from the artifact (documented in docs/SCORING_RULES.md)");
{
  // 1. Odd runs off a no-ball rotate the strike. The artifact returned early
  //    from the no-ball path before its rotation call and never swapped.
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 1 })]);
  ok("odd runs off a no-ball rotate strike", inn.striker === "p2" && inn.nonStriker === "p1");
}
{
  // 2. Byes run off a wide rotate the strike, for the same reason.
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.WIDE, value: 1 })]);
  ok("odd byes off a wide rotate strike", inn.striker === "p2");
}
{
  // 3. A no-ball with no run off the bat is still a ball faced. The artifact
  //    guarded the increment behind `value > 0`.
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0 })]);
  ok("no-ball with 0 runs is a ball faced", inn.batsmen.find(b => b.id === "p1")?.balls === 1);
}
{
  // 4. Maidens were never tracked at all — the field existed and stayed 0.
  const inn = deriveInnings([...open(), ...Array.from({ length: 6 }, () => runs(0))]);
  ok("maidens are tracked", inn.bowlers.find(b => b.id === "w1")?.maidens === 1);
}
{
  // 5. The fielder was dropped from the log entirely, so a caught dismissal
  //    could not name who took it after replay.
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.WICKET, dismissal: "caught", fielder: "K Botha" })]);
  ok("fielder survives replay", /K Botha/.test(must(must(inn.batsmen.find(b => b.id === "p1")).dismissal)));
}
{
  // 6. Free hit: a bowled dismissal off a free hit does not stand; a run out does.
  const fh = [...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0 })];
  const saved = deriveInnings([...fh, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]);
  const runOut = deriveInnings([...fh, ball({ type: BALL_TYPE.WICKET, dismissal: "run out" })]);
  ok("free hit saves a bowled batter",     saved.wickets === 0);
  ok("free hit does not save a run out",   runOut.wickets === 1);
  ok("free hit consumed by legal delivery", deriveInnings([...fh, runs(1)]).freeHit === false);
}

// ── D. Strike, overs and completion ──────────────────────
group("D. Strike rotation and innings end");
{
  const inn = deriveInnings([...open(), runs(1)]);
  ok("odd runs rotate",  inn.striker === "p2" && inn.nonStriker === "p1");
  const even = deriveInnings([...open(), runs(2)]);
  ok("even runs hold",   even.striker === "p1");
  const overEnd = deriveInnings([...open(), ...Array.from({ length: 6 }, () => runs(0))]);
  ok("over end rotates", overEnd.striker === "p2");
  const oddThenOver = deriveInnings([...open(), ...Array.from({ length: 5 }, () => runs(0)), runs(1)]);
  ok("odd run on last ball of over cancels out", oddThenOver.striker === "p1");
}
{
  const allOut = deriveInnings([
    ...open(),
    ...Array.from({ length: 4 }, () => ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })),
  ]);
  ok("all out with a 5-man squad", allOut.complete === true && allOut.wickets === 4);
}
{
  const short = deriveInnings([
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs: 1 }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }),
    ...Array.from({ length: 6 }, () => runs(1)),
  ]);
  ok("innings ends when overs are done", short.complete === true);
  ok("explicit end reason recorded",
     deriveInnings([...open(), sealInnings(deriveInnings(open()), "declared")]).endReason === "declared");

  // SCRBRD-038. An innings that ends by itself now says WHY, so the review the
  // scorer confirms can name the reason and the innings_end written on that
  // confirmation carries the same word the laws did. Before this, `complete`
  // was a boolean and `endReason` stayed null unless somebody typed one.
  ok("...and a derived end reports overs_complete", short.endReason === "overs_complete");
  ok("...all out reports all_out",
     deriveInnings([...open(), ...Array.from({ length: 4 }, () => ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }))])
       .endReason === "all_out");

  // The order between the three matters on the ball that satisfies two at once.
  // A chase won off the last legal ball of the last over is won, not timed out;
  // a last-wicket single that levels nothing is all out. Testing them
  // separately would pass on any order, so both are tested on the SAME ball.
  const chaseOnLastBall = deriveInnings([
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs: 1, target: 6 }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }),
    ...Array.from({ length: 6 }, () => runs(1)),
  ]);
  ok("a chase completed on the last legal ball reads as the chase, not the overs",
     chaseOnLastBall.complete === true && chaseOnLastBall.endReason === "target_reached",
     chaseOnLastBall.endReason);
  const allOutOnLastBall = deriveInnings([
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs: 1 }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }),
    ...Array.from({ length: 2 }, () => runs(1)),
    ...Array.from({ length: 4 }, () => ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })),
  ]);
  ok("the last wicket on the last legal ball reads as all out, not the overs",
     allOutOnLastBall.endReason === "all_out", allOutOnLastBall.endReason);

  // An explicit event wins over the derivation, which is what makes a
  // declaration expressible at all: the same log, nine down inside the overs,
  // is "declared" only because somebody said so.
  const declaredPlayed = [
    ...open(),
    ...Array.from({ length: 4 }, () => ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })),
  ];
  const declaredEarly = deriveInnings([
    ...declaredPlayed,
    sealInnings(deriveInnings(declaredPlayed), "declared"),
  ]);
  ok("an explicit reason is not overwritten by the derivation",
     declaredEarly.endReason === "declared", declaredEarly.endReason);

  // And an innings still in progress claims neither.
  const open1 = deriveInnings([...open(), runs(1)]);
  ok("an innings in progress has no reason and is not complete",
     open1.complete === false && open1.endReason === null, open1.endReason);
}
{
  const r = deriveInnings([...open(), runs(1), retire({ batter: "p1", reason: "hurt" })]);
  ok("retired batter marked",   r.batsmen.find(b => b.id === "p1")?.status === "retired");
  ok("retirement is not a wicket", r.wickets === 0);
}
{
  // SCRBRD-071: a batter who retired hurt and comes back is batting again,
  // on the same line — his figures go on from where he left them.
  const hurtLog = [...open(), runs(1), runs(4), retire({ batter: "p2", reason: "hurt" }), batters({ striker: "p3" }), runs(2)];
  const away = deriveInnings(hurtLog);
  const p2Away = must(away.batsmen.find((b) => b.id === "p2"));
  ok("retired hurt: off the field, 4 (1), retired hurt", p2Away.status === "retired" && p2Away.dismissal === "retired hurt"
     && p2Away.runs === 4 && p2Away.balls === 1);
  // p3 is out; p2 walks back in at the empty end.
  const back = deriveInnings([...hurtLog, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }), batters({ striker: "p2" }), runs(6), runs(1)]);
  const p2 = must(back.batsmen.find((b) => b.id === "p2"));
  ok("...and back in: batting, no dismissal line", p2.status === "batting" && p2.dismissal === null);
  ok("...his figures continue on the same line: 4 + 6 + 1 off 3", p2.runs === 11 && p2.balls === 3 && p2.sixes === 1 && p2.fours === 1);
  ok("...one line on the card, not two", back.batsmen.filter((b) => b.id === "p2").length === 1);
  ok("...and a retirement is still no wicket: one wicket, p3's", back.wickets === 1);
  // A legacy unmarked retire "out" wrote "retired out" and is out to the
  // Laws (nothing in the Laws brings him back); the fold leaves it alone.
  /** @type {LogEvent} */
  const legacyOut = { kind: "retire", batter: "p2", reason: "out" };
  const stays = deriveInnings([...open(), runs(1), legacyOut, batters({ striker: "p2" })]);
  ok("an unmarked retire 'out' named again keeps its line (the Laws refuse the return)",
     must(stays.batsmen.find((b) => b.id === "p2")).status === "retired");
  // The record the Laws read for "may he resume yet?" (laws.mjs, SCRBRD-071):
  // each retirement not out, with the wickets when he went; a wicket with no
  // ball (retired out) is a wicket, not one of these.
  const rec = back.retirements;
  ok("the fold records the retirement: who, why, the wickets then, the ball",
     rec.length === 1 && rec[0].batter === "p2" && rec[0].reason === "hurt" && rec[0].wickets === 0
     && rec[0].over === 0 && rec[0].ballInOver === 2, rec);
  const ro = deriveInnings([...open(), runs(1), retire({ batter: "p1", reason: "out" })]).retirements;
  ok("...and a retired out is in it, marked out, his own wicket counted", ro.length === 1 && ro[0].out === true && ro[0].wickets === 1
     && rec[0].out === false, ro);
  ok("...a timed out is not", deriveInnings([...open(), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }),
     retire({ batter: "p3", reason: "timed_out" })]).retirements.length === 0);
}
{
  // SCRBRD-071, Law 25.4.3: a batter who retired out resumes with the
  // opposing captain's consent. p1 hits a four and retires out; p3 comes in
  // and is bowled; p1 walks back in with consent, and hits a two.
  const outLog = [...open(), runs(4), retire({ batter: "p1", reason: "out" }), batters({ striker: "p3" }), runs(0),
                  ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })];
  const before = deriveInnings(outLog);
  ok("retired out, then a wicket: two down, two on the fall of wickets, one with no ball",
     before.wickets === 2 && before.fow.length === 2 && before.fow[0].batsman === "James Whitfield" && before.fow[1].wickets === 2
     && before.nonBallWickets.length === 1, before.fow);
  const consentEv = batters({ striker: "p1", captainConsent: true });
  ok("the event carries the consent, and only when given", consentEv.captainConsent === true && !("captainConsent" in batters({ striker: "p1" }))
     && !("captainConsent" in batters({ striker: "p1", captainConsent: false })));
  const back = deriveInnings([...outLog, consentEv, runs(2)]);
  const p1 = must(back.batsmen.find((b) => b.id === "p1"));
  ok("with consent his wicket is taken back: one down", back.wickets === 1, back.wickets);
  ok("...off the fall of wickets, the later one renumbered", back.fow.length === 1 && back.fow[0].batsman === "S Naidoo"
     && back.fow[0].wickets === 1 && back.fow[0].runs === 4, back.fow);
  ok("...and off the wickets with no ball", back.nonBallWickets.length === 0);
  ok("...his line batting again, no dismissal, 4 (1) then 2: 6 (2)", p1.status === "batting" && p1.dismissal === null
     && p1.runs === 6 && p1.balls === 2, p1);
  ok("...one line on the card", back.batsmen.filter((b) => b.id === "p1").length === 1);
  ok("...the consented resume recorded", back.resumedWithConsent.length === 1 && back.resumedWithConsent[0].batter === "p1");
  ok("...no bowler's figure moved", JSON.stringify(back.bowlers.map((b) => [b.id, b.wickets])) === JSON.stringify([["w1", 1]]));
  const noConsent = deriveInnings([...outLog, batters({ striker: "p1" })]);
  ok("named again without consent: still out, the wicket stands", noConsent.wickets === 2
     && must(noConsent.batsmen.find((b) => b.id === "p1")).status === "out");
  // A view handed out before the resume keeps its own fall of wickets.
  const f = new MatchFold(outLog);
  const earlier = f.view().innings[0];
  f.push({ ...consentEv, innings: 0 });
  ok("a view taken before it is not rewritten", earlier.fow.length === 2 && earlier.nonBallWickets.length === 1
     && f.view().innings[0].fow.length === 1);
  // Consent for anyone else moves nothing: a new batter, a batter timed out.
  const timed = [...open(), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }), retire({ batter: "p3", reason: "timed_out" })];
  const t = deriveInnings([...timed, batters({ striker: "p3", captainConsent: true })]);
  ok("consent for a batter timed out takes nothing back", t.wickets === 2 && t.resumedWithConsent.length === 0);
  const n = deriveInnings([...outLog, batters({ striker: "p4", captainConsent: true })]);
  ok("...nor for a new batter", n.wickets === 2 && n.resumedWithConsent.length === 0);
  // Retired out, back, bowled: out for good — a second consent does nothing.
  const bowledAfter = [...outLog, consentEv, runs(0), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })];
  const again = deriveInnings([...bowledAfter, batters({ striker: "p1", captainConsent: true })]);
  ok("back, then bowled: consent does not take THAT wicket back", again.wickets === 2
     && must(again.batsmen.find((b) => b.id === "p1")).status === "out");

  // "The db/53 fixture": the events db/53's proof and db/99 §31 write in
  // SQL, folded. p1 (A) hits 4 and retires out; p3 (C) comes in, a dot,
  // bowled; p1 back with consent, hits 2. Then the return undone.
  const fx = [...open(), runs(4), retire({ batter: "p1", reason: "out" }), batters({ striker: "p3" }), runs(0),
              ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }), { ...batters({ striker: "p1", captainConsent: true }), id: "db53-6" },
              runs(2)];
  const f53 = deriveInnings(fx);
  const a53 = must(f53.batsmen.find((b) => b.id === "p1")), c53 = must(f53.batsmen.find((b) => b.id === "p3"));
  ok("the db/53 fixture: 6 for 1, 4 legal balls; A 6 (2) not out; C 0 (2) bowled",
     f53.runs === 6 && f53.wickets === 1 && f53.balls === 4 && a53.runs === 6 && a53.balls === 2 && a53.status === "batting"
     && c53.runs === 0 && c53.balls === 2 && c53.status === "out", [f53.runs, f53.wickets, f53.balls, a53, c53]);
  const u53 = deriveInnings([...fx, voidEvent({ target: "db53-6" })]);
  ok("...the return undone: 6 for 2, A out again", u53.runs === 6 && u53.wickets === 2
     && must(u53.batsmen.find((b) => b.id === "p1")).status === "out", [u53.runs, u53.wickets]);
}

// ── D. Order-independence, given seq ─────────────────────
//
// SCRBRD-017. The header above has claimed this since before there was a
// test for it. `seq` is the one thing every read path that feeds a replay
// actually sorts by (services/api/realtime/session-routes.mjs's catch-up
// query, read-api.mjs's `phases`/`shot_points`, all `order by ... seq`) —
// deliberately just `seq`, not `(epoch, seq)`: it is allocated as
// `max(seq)+1` per match at insert time (services/api/write/events-api.mjs),
// so it is already a single global order across every device and epoch that
// ever wrote to this match, and there is no second column left for a tie to
// need breaking on.
//
// This does not prove the read paths sort correctly — that is what their own
// suites are for (realtime.test.mjs's reconnect-from-lastSeq coverage is the
// transport half of this same property). It proves the fold itself: handed
// events in the wrong order, deriveInnings() gives a different, wrong
// answer, and handed the same events sorted by seq — however they arrived —
// it gives the one true answer back every time.
group("D. Replay is deterministic and order-independent, given seq");
{
  // A wicket for the striker AFTER the run that puts him on 4 — reordering
  // these two must change the result (he cannot be out for 4 before he has
  // scored it), which is what makes the "unsorted differs" assertion below
  // a real check rather than one that would pass on a log shuffling cannot
  // actually disturb.
  const canonical = [...open(), runs(4), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]
    .map((e, i) => ({ ...e, seq: i + 1 }));
  const correct = deriveInnings(canonical);
  ok("sanity: the striker is out for 4, not 0", correct.wickets === 1 &&
     correct.batsmen.find(b => b.id === "p1")?.runs === 4);

  const shuffled = [...canonical].reverse(); // deterministic "wrong order", not flaky randomness
  const wrong = deriveInnings(shuffled);
  ok("out of seq order, the fold gives a different, wrong answer — proving order really matters",
     JSON.stringify(wrong) !== JSON.stringify(correct));

  const resorted = [...shuffled].sort((a, b) => a.seq - b.seq);
  ok("sorted back by seq alone, the shuffled log derives the identical result",
     JSON.stringify(deriveInnings(resorted)) === JSON.stringify(correct));

  // A second, larger shuffle — not reversed this time — for the same
  // property on a log with more to get wrong: two overs, a strike rotation,
  // a bowler change, and a wicket partway through.
  const longCanonical = [
    ...open(), runs(1), runs(4), runs(0), runs(2), runs(6),
    ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }),
    batters({ striker: "p3" }), runs(1), runs(1), runs(0), runs(2), runs(0),
    bowler({ bowler: "w2" }), runs(1), runs(4), runs(1), runs(0), runs(1), runs(1),
  ].map((e, i) => ({ ...e, seq: i + 1 }));
  const longCorrect = deriveInnings(longCanonical);
  // A fixed permutation (not Math.random()) so a failure is reproducible
  // rather than a coin flip that only sometimes catches a regression.
  const longShuffled = longCanonical.slice().sort((a, b) => ((a.seq * 7) % 19) - ((b.seq * 7) % 19));
  ok("the eighteen-event log is genuinely out of order before sorting",
     longShuffled.map(e => e.seq).join(",") !== longCanonical.map(e => e.seq).join(","));
  ok("...and still derives identically once sorted back by seq",
     JSON.stringify(deriveInnings(longShuffled.slice().sort((a, b) => a.seq - b.seq))) ===
     JSON.stringify(longCorrect));
}

// ── E. Determinism, match level, and the wire ────────────
group("E. Determinism, match derivation, wire round-trip");
{
  const log = [...open(), runs(4), runs(1), runs(2)];
  ok("replay is pure",  JSON.stringify(deriveInnings(log)) === JSON.stringify(deriveInnings(log)));
  ok("replay does not mutate the log", log.length === 6 && /** @type {BallEvent} */ (log[3]).value === 4);   // [3]: the first delivery
}
{
  const firstInnings = [...open(), runs(10)];
  const m = deriveMatch([
    ...firstInnings.map(e => ({ ...e, innings: 0 })),
    // Declared: ten off one ball is not an innings the laws have ended, and a
    // seal may only name an ending the laws derive when they derive it.
    { ...sealInnings(deriveInnings(firstInnings), "declared"), innings: 0 },
    { ...inningsStart({ battingTeam: "Westville Boys'", bowlingTeam: "Hilton College", squad: SQ_B, bowlingSquad: SQ_A, overs: 20, target: 11 }), innings: 1 },
    { ...batters({ striker: "w1", nonStriker: "w2" }), innings: 1 },
    { ...bowler({ bowler: "p1" }), innings: 1 },
    { ...runs(6), innings: 1 }, { ...runs(6), innings: 1 },
  ]);
  ok("two innings derived",   m.innings.length === 2);
  ok("chase completes",       m.innings[1].complete === true);
  ok("result names a winner", m.result?.winner === "Westville Boys'");
}
{
  // @ts-expect-error `zone` is text ('inner' | 'outer' | 'boundary'); this number only rides through the round trip
  const ev = ball({ type: BALL_TYPE.WICKET, value: 0, shot: "drive", seg: 4, zone: 2, dismissal: "caught", fielder: "K Botha", bowlerApproach: "over" });
  // A ball went in, so a ball comes back.
  const back = /** @type {Loose<BallEvent>} */ (fromRow({ ...toRow(ev), seq: 12 }));
  ok("wire round-trip keeps shot",     back.shot === "drive");
  ok("wire round-trip keeps segment",  back.seg === 4);
  ok("wire round-trip keeps fielder",  back.fielder === "K Botha");
  ok("wire round-trip keeps approach", back.bowlerApproach === "over");
  ok("seq survives",                   back.seq === 12);
  ok("derives identically after a round-trip",
     deriveInnings([...open(), ev]).wickets === deriveInnings([...open(), fromRow(toRow(ev))]).wickets);
}
{
  const inn = deriveInnings([...open(), runs(4), runs(1)]);
  const c = confirmationState(inn);
  ok("confirmation state matches the handover handshake fields",
     c.runs === 5 && c.wickets === 0 && c.balls === 2 && c.bowler === "w1");
  ok("isLegal agrees with the schema", isLegal("Wd") === false && isLegal("run") === true);
  ok("KIND is exported for the queue", KIND.BALL === "ball");
}

// ── E2. Player references the database cannot store ──────
group("E. A bowler with no player row");
{
  const UUID = "aaaaaaaa-0000-0000-0000-000000000001";
  // SCRBRD holds rows for its OWN schools' players. A fixture against a school
  // that is not a tenant has no away roster, so the scorer types the bowler's
  // name — and ball_event.bowler_id is a uuid foreign key. Sending a name to
  // that column is a 22P02 that rejects the delivery: every ball of every over
  // bowled by an opposition bowler, which is nearly all of them.
  const typed = toRow(bowler({ bowler: "A Nel" }));
  ok("a typed name does not go in the uuid column", typed.bowler_id === null);
  ok("...it rides in the payload instead", typed.payload.bowler === "A Nel");
  ok("...and comes back intact", /** @type {Loose<BowlerEvent>} */ (fromRow({ ...typed, seq: 1 })).bowler === "A Nel");

  // A real player still joins, so a scorecard can be attributed.
  const mixed = toRow(batters({ striker: UUID, nonStriker: "Unlisted Kid" }));
  ok("a real player id goes in the column", mixed.striker_id === UUID);
  ok("...and is not duplicated into the payload", !("striker" in mixed.payload));
  ok("an unlisted batter still rides in the payload", mixed.payload.nonStriker === "Unlisted Kid");
  const back = /** @type {Loose<BattersEvent>} */ (fromRow({ ...mixed, seq: 2 }));   // batters in, batters out
  ok("both come back the way they went in",
     back.striker === UUID && back.nonStriker === "Unlisted Kid");

  // Replay only ever compares ids for equality, so it does not care which is which.
  const mixedLog = [
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: [{ id: UUID, name: "J Whitfield" }], overs: 20 }),
    batters({ striker: UUID, nonStriker: "Unlisted Kid" }),
    bowler({ bowler: "A Nel" }),
    ball({ type: BALL_TYPE.RUN, value: 4 }),
  ];
  const inn = deriveInnings(mixedLog);
  ok("replay handles a mixed log", inn.runs === 4 && inn.balls === 1);
  ok("...naming the player it knows", inn.batsmen.find(b => b.id === UUID)?.name === "J Whitfield");
  ok("...and the one it does not", inn.bowlers.find(b => b.id === "A Nel")?.name === "A Nel");
}

// ── F. The undo/sync boundary ────────────────────────────
// Undo has two correct implementations and picking the wrong one is how a
// scorecard ends up quietly wrong with no evidence of why. See src/undo.mjs.
group("F. Undo before and after the server has it");
{
  const id = (/** @type {number} */ n) => `dev:m1:${n}`;
  /** @param {LogEvent[]} evs  @returns {LogEvent[]} */
  const withIds = (evs) => evs.map((e, i) => ({ ...e, id: id(i) }));
  const log = withIds([...open(), runs(4), runs(1), runs(6)]);
  const before = deriveInnings(log);
  ok("baseline", before.runs === 11 && before.balls === 3);

  // Nothing has left the device: dropping the last event is exact.
  const local = undoLast(log, { isSynced: () => false });
  ok("an unsynced ball is truncated", local.action === "truncate" && local.events.length === log.length - 1);
  ok("...and the log carries no trace of it",
     !local.events.some(e => e.kind === KIND.VOID));
  ok("...and re-derives exactly", deriveInnings(local.events).runs === 5);

  // The server has it: the correction has to be appendable evidence.
  const remote = undoLast(log, { isSynced: () => true });
  ok("a synced ball is voided, not dropped", remote.action === "void");
  ok("...the log grows rather than shrinks", remote.events.length === log.length + 1);
  ok("...the void names the ball it undoes",
     remote.events.at(-1)?.kind === KIND.VOID
     && /** @type {Loose<import("../src/events.mjs").VoidEvent>} */ (remote.events.at(-1)).target === must(log.at(-1)).id);
  ok("...and replay agrees with the truncated version",
     deriveInnings(remote.events).runs === deriveInnings(local.events).runs);
  ok("...down to the ball count and the striker",
     deriveInnings(remote.events).balls === deriveInnings(local.events).balls &&
     deriveInnings(remote.events).striker === deriveInnings(local.events).striker);
  ok("...and the void is visible as a correction", deriveInnings(remote.events).voided === 1);

  // The safe default. undoLast() with no isSynced treats the event as synced,
  // because a void is always correct and truncation is the optimisation.
  ok("the default is the safe one", undoLast(log).action === "void");

  // Repeated undo walks back through the innings rather than undoing its own
  // corrections — a void must not become the next undo's target.
  let walk = log;
  for (let i = 0; i < 3; i++) walk = undoLast(walk, { isSynced: () => true }).events;
  const walked = deriveInnings(walk);
  ok("three undos remove three balls", walked.runs === 0 && walked.balls === 0);
  ok("...leaving three voids in the log",
     walk.filter(e => e.kind === KIND.VOID).length === 3 && walked.voided === 3);

  // A voided wicket must not leave the batter out. This is the case that
  // decrementing a counter cannot fix: the next batter is already at the crease.
  const wLog = withIds([...open(), runs(1), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })]);
  ok("wicket taken", deriveInnings(wLog).wickets === 1);
  const undoneW = undoLast(wLog, { isSynced: () => true }).events;
  ok("voiding a wicket un-takes it", deriveInnings(undoneW).wickets === 0);
  ok("...and the batter is not out",
     deriveInnings(undoneW).batsmen.find(b => b.id === "p2")?.status !== "out");

  // Choosing the openers and the opening bowler ARE undoable — a scorer who
  // taps the wrong name needs to fix it, and the screen simply asks again.
  // What is not undoable is innings_start: without it there are no squads and
  // nothing left to score against.
  let strip = withIds(open());
  ok("the opening bowler can be undone", undoLast(strip, { isSynced: () => false }).action === "truncate");
  strip = undoLast(strip, { isSynced: () => false }).events;
  strip = undoLast(strip, { isSynced: () => false }).events;
  ok("...and so can the openers", strip.length === 1 && strip[0].kind === KIND.INNINGS_START);
  ok("undo stops at the innings opening", undoLast(strip).action === "none");
  ok("...and leaves the log untouched", undoLast(strip).events.length === 1);
  ok("lastUndoableIndex agrees", lastUndoableIndex(strip) === -1);

  // An event with no id cannot be named by a void, so it cannot be undone once
  // it has synced. Reported, never silently skipped.
  const anon = [...open(), runs(4)];
  ok("an event with no id cannot be voided", undoLast(anon).action === "none");

  // A void survives the wire, because a correction that only exists on one
  // device is the problem it was invented to solve.
  // id(3) is the first delivery, worth four.
  const v = voidEvent({ target: id(3) });
  ok("a void round-trips through the wire",
     /** @type {Loose<import("../src/events.mjs").VoidEvent>} */ (fromRow(toRow(v))).target === id(3));
  ok("...and still voids the right ball after the round trip",
     deriveInnings([...log, fromRow(toRow(v))]).runs === 7);

  ok("event ids are unique per device", newEventId("dev", "m1") !== newEventId("dev", "m1"));

  // SCRBRD-074/075. The boundary read off the device's outbox: one rule for
  // held, never-sent and everything else, and the safe answer when the
  // outbox cannot be seen.
  const last = must(log.at(-1)).id ?? "";
  /** @param {{held?: string[], unsent?: string[]}} o  @returns {import("../src/undo.mjs").OutboxView} */
  const box = ({ held = [], unsent = [] }) => ({ isHeld: (k) => held.includes(k), isUnsent: (k) => unsent.includes(k) });
  const cut = undoLast(log, { outbox: box({ unsent: [last] }) });
  ok("never sent, and last: cut, for the caller to withdraw", cut.action === "truncate" && cut.target?.id === last);
  ok("...exactly as isSynced false cuts it", JSON.stringify(cut.events) === JSON.stringify(local.events));
  ok("pending but already offered to the server: a void (it may be in the server's log)",
     undoLast(log, { outbox: box({}) }).action === "void");
  ok("held: dropped, even when also unsent — held is asked first",
     undoLast(log, { outbox: box({ held: [last], unsent: [last] }) }).action === "drop");
  ok("an outbox that cannot be seen (null): every undo is a void",
     undoLast(log, { outbox: null }).action === "void");
  ok("...and outbox wins over isSynced when both are given",
     undoLast(log, { outbox: null, isSynced: () => false }).action === "void");
  ok("a device with nowhere to send (LOCAL_ONLY): cut", undoLast(log, { outbox: LOCAL_ONLY }).action === "truncate");
  const b = boundaryOf(box({ unsent: [last] }));
  ok("boundaryOf: never sent is not synced", !b.isSynced(must(log.at(-1))));
  ok("...anything else is", b.isSynced(must(log.at(-2))));
  ok("...and an event with no id is synced — the outbox cannot answer for it", b.isSynced(runs(1)));
  // A void goes to the outbox by its id; the caller mints it.
  const minted = undoLast(log, { isSynced: () => true, voidId: "dev:m1:void" });
  ok("a void carries the id it is given", minted.events.at(-1)?.id === "dev:m1:void");
  ok("...and none when none is given (tests, and callers that stamp it themselves)", remote.events.at(-1)?.id === undefined);
}

// ── G. Shot placement ────────────────────────────────────
group("G. Where the ball went");
{
  // The frame is the clock coaches already speak in: theta is degrees
  // CLOCKWISE FROM BEHIND THE BATTER, so 180 is straight down the ground and
  // positive is the leg side for a right-hander. It is also exactly the angle
  // the wheel draws at, which is why a right-hander needs no conversion at all.
  ok("theta is clock_hour x 30", thetaFromClock(6) === 180 && thetaFromClock(3) === 90);
  ok("...and reads back", clockFromTheta(180) === 6 && clockFromTheta(0) === 12);
  ok("straight down the ground is 180", screenAngle(180, "R") === 180);
  ok("a right-hander needs no conversion", thetaFromScreen(214, "R") === 214);

  // The defect this replaces: a left-hander's placement was stored against
  // fixed segment angles and was silently wrong for every ball they faced.
  const rh = placementFromTap({ angle: 270, radius: 0.7, batHand: "R" });
  const lh = placementFromTap({ angle: 270, radius: 0.7, batHand: "L" });
  ok("the same spot is off side for a right-hander", rh.theta === 270);
  ok("...and leg side for a left-hander", lh.theta === 90);
  ok("...yet both draw in the same place", rh.seg === lh.seg);
  ok("mirroring round-trips", screenAngle(thetaFromScreen(123, "L"), "L") === 123);

  // seg and zone are DERIVED, so the sector-era read path keeps working
  // unchanged and point capture ships without rewriting it.
  const p = placementFromTap({ angle: 300, radius: 0.93, batHand: "R" });
  ok("a point derives its sector", p.seg === 10);
  ok("...and its zone", p.zone === "boundary");
  ok("zone bands come from the ring radii, not round numbers",
     zoneFromRadius(0.44) === "inner" && zoneFromRadius(0.5) === "outer" && zoneFromRadius(0.85) === "boundary");

  // Quantise on write: float noise implies precision nobody has. The scorer is
  // estimating from a boundary, not measuring.
  const q = placementFromTap({ angle: 137.4821, radius: 0.61847, batHand: "R" });
  ok("theta is whole degrees", Number.isInteger(q.theta));
  ok("radius is two decimals", q.radius === 0.62);
  ok("radius clamps at the rope",
     placementFromTap({ angle: 180, radius: 1.8, batHand: "R" }).radius === 1);

  // The fielding circle is VENUE-DERIVED. Because radius normalises to the
  // rope, the 30-yard circle sits at a different normalised radius at every
  // ground — and it carries fielding-restriction meaning, so a hardcoded band
  // would be wrong somewhere every time.
  ok("the circle is ~0.50 at a 55m boundary", Math.abs(fieldingCircle(55) - 0.50) < 0.01);
  ok("...and ~0.40 at 68m", Math.abs(fieldingCircle(68) - 0.40) < 0.01);
  ok("so the same ball is in the ring at one ground and deep at another",
     depthBand(0.45, { boundaryM: 55 }) === "ring" && depthBand(0.45, { boundaryM: 68 }) === "deep");

  // Position names are DERIVED, never stored, so the table can be corrected or
  // localised later without touching a single ball.
  ok("a cover drive to the rope is deep cover", positionName(235, 0.75) === "deep cover");
  ok("...and inside the circle is just cover", positionName(235, 0.35) === "cover");
  // The table is not regular, and the irregularities are the point.
  ok("straight breaks the pattern: long on, not deep mid on", positionName(178, 0.9) === "long on");
  ok("...and long off on the other side of it", positionName(190, 0.9) === "long off");
  // 0.50 would be DEEP at the default ground — the circle is 0.44 there — so
  // this asserts the family at a radius that is genuinely inside the ring.
  ok("behind square on the off side is backward point",
     positionName(295, 0.35) === "backward point");
  ok("...and deep backward point outside the circle",
     positionName(295, 0.5) === "deep backward point");
  ok("off side behind square is `third`, not third man",
     positionName(325, 0.8) === "deep third man");

  // The catching ring, where the outfield taxonomy means nothing.
  ok("a ball at the batter's feet has somewhere to sit",
     placementFromTap({ angle: 0, radius: 0.02, batHand: "R" }).closePosition === "at_feet");
  ok("slips are ordinal, derived from theta within the cordon",
     closePositionFor(340, 0.06) === "slip_2" && closePositionFor(350, 0.06) === "slip_1");
  ok("the leg-side cordon is named too", closePositionFor(15, 0.06) === "leg_slip");
  ok("nothing outside the ring gets a close position",
     closePositionFor(230, CLOSE_RADIUS + 0.01) === null);

  // Why there is no placement is recorded, because "no stroke was offered" and
  // "the scorer skipped it" are different facts.
  const missed = noPlacement(PLACEMENT_NULL.NO_CONTACT);
  ok("a ball with no contact carries a reason", missed.placementNull === "no_contact");
  ok("...and no source", missed.placementSource === null);
  ok("...and no sector either", missed.seg === null && missed.zone === null);

  // THE HARD RULE: a point is never synthesised from a sector.
  const sectorEra = ball({ type: BALL_TYPE.RUN, value: 4, seg: 9, zone: "outer" });
  ok("a sector-era ball has no point", sectorEra.theta === null && sectorEra.radius === null);
  ok("...and is not mistaken for one", hasPoint(sectorEra) === false);
  ok("...but keeps its sector", sectorEra.seg === 9);

  const pointEra = ball({ type: BALL_TYPE.RUN, value: 4, ...p });
  ok("a point-era ball is recognised", hasPoint(pointEra) === true);
  const mixed = heatMapEligible([sectorEra, pointEra, pointEra, sectorEra, sectorEra]);
  ok("a heat map can state what it excluded rather than dropping it quietly",
     mixed.eligible.length === 2 && mixed.excludedCount === 3);

  // The wire carries the point in its own columns, so the query layer can
  // filter on placement_source and be indexed rather than trusting report code.
  const row = toRow(pointEra);
  ok("theta and radius get columns of their own",
     row.theta === p.theta && row.radius === p.radius);
  ok("as does the source the heat map filters on",
     row.placement_source === PLACEMENT_SOURCE.POINT);
  ok("none of it is duplicated into the payload",
     !("theta" in row.payload) && !("placementSource" in row.payload));
  const back = /** @type {Loose<BallEvent>} */ (fromRow({ ...row, seq: 3 }));   // a ball in, a ball out
  ok("the point survives the round trip",
     back.theta === p.theta && back.radius === p.radius && hasPoint(back));

  // Handedness comes off the squad. Missing handedness produces a right-handed
  // placement, which is a roster problem rather than something to guess at.
  const inn = { striker: "p1", squad: [{ id: "p1", name: "A", batHand: "L" }, { id: "p2", name: "B" }] };
  ok("a left-hander is read from the squad", batHandOf(inn) === "L");
  ok("...and an unmarked player defaults to right", batHandOf(inn, "p2") === "R");
}

/* ── H. The seal, and what it takes to close an innings ───
 *
 * SCRBRD-038 asked for a checkpoint between the last ball and a closed innings.
 * The review sheet was that checkpoint, and it was the ONLY one: the reducer
 * honoured any innings_end unconditionally, so the gate lived in one React
 * component tree and the model beneath it would have closed an innings on the
 * strength of an event that said so. It did not need bad faith — a stale seal
 * out of an offline queue, or a delivery released from quarantine landing before
 * one, is a bad afternoon of signal.
 *
 * What is asserted below is the reducer's half, for each of the three endings
 * the laws derive, and it is the half that holds on the server, on a second
 * device at a handover, and in any replay of the log:
 *
 *   an innings is not closed until a scorer has confirmed THESE figures,
 *   and a seal may not name an ending the log does not produce.
 *
 * `complete` is deliberately left alone by all of this. An innings is over when
 * the laws say so whether or not anybody has pressed anything — that is what the
 * banner on the scoring screen is for — and confusing "over" with "closed" is
 * the distinction this group exists to keep.
 *
 * Falsified by returning null from sealRefusal() (everything here but the
 * derivation assertions goes red), and by dropping the FIGURES_MOVED clause
 * alone (the stale-seal assertions go red and nothing else does).
 */
group("H. The seal — over is not closed (SCRBRD-038)");
{
  const sq = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const start = (/** @type {InningsStartInput} */ o) => [
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: sq(5), bowlingSquad: SQ_B, overs: 20, ...o }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }),
  ];
  const wkt = () => ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" });

  // One log per ending, each ended by the laws and nothing else.
  /** @type {[string, (InningsStartEvent | BattersEvent | BowlerEvent | BallEvent)[]][]} */
  const ENDINGS = [
    ["all_out",        [...start({}), ...Array.from({ length: 4 }, wkt)]],
    ["overs_complete", [...start({ overs: 1 }), ...Array.from({ length: 6 }, () => runs(1))]],
    ["target_reached", [...start({ target: 6 }), runs(6)]],
  ];
  const OTHER = (/** @type {string} */ r) => ["all_out", "overs_complete", "target_reached"].filter((x) => x !== r);

  for (const [reason, played] of ENDINGS) {
    const over = deriveInnings(played);
    ok(`${reason}: the laws end the innings and name it`,
       over.complete === true && over.endReason === reason);
    ok(`${reason}: ...and it is NOT closed on the strength of that`, over.sealed === false);

    // The bare assertion the reducer used to accept.
    const bare = deriveInnings([...played, inningsEnd({ reason })]);
    ok(`${reason}: an innings_end with no figures does not close it`,
       bare.sealed === false && bare.sealRefused === SEAL_REFUSAL.UNCONFIRMED);
    ok(`${reason}: ...and the innings still reads as over, not as closed`,
       bare.complete === true && bare.endReason === reason);

    // The seal the review writes.
    const sealed = deriveInnings([...played, sealInnings(over)]);
    ok(`${reason}: a confirmed seal closes it`,
       sealed.sealed === true && sealed.sealRefused === null);
    ok(`${reason}: ...carrying the reason the laws derived`, sealed.endReason === reason);

    // A seal that names one of the other two derivable endings, with figures
    // that are otherwise perfectly correct.
    for (const wrong of OTHER(reason)) {
      const mislabelled = deriveInnings([...played,
        inningsEnd({ reason: wrong, confirmed: { runs: over.runs, wickets: over.wickets, balls: over.balls } })]);
      ok(`${reason}: a seal claiming ${wrong} is refused`,
         mislabelled.sealed === false && mislabelled.sealRefused === SEAL_REFUSAL.NOT_THE_LAWS_REASON);
      ok(`${reason}: ...and the log still says ${reason}`, mislabelled.endReason === reason);
    }

    // Each figure on its own, because a check on the total alone would pass a
    // seal that had the runs right and the wickets wrong.
    for (const [field, value] of [["runs", over.runs + 1], ["wickets", over.wickets + 1], ["balls", over.balls + 1]]) {
      const moved = deriveInnings([...played, inningsEnd({ reason,
        confirmed: { runs: over.runs, wickets: over.wickets, balls: over.balls, [field]: value } })]);
      ok(`${reason}: a seal whose ${field} the log does not produce is refused`,
         moved.sealed === false && moved.sealRefused === SEAL_REFUSAL.FIGURES_MOVED);
    }

    // An innings that has not ended cannot be closed as though it had — the
    // other half of the gate, and the one that says a seal is about THIS
    // occurrence of the innings ending rather than about the innings.
    const early = [...start({}), runs(1)];
    const inProgress = deriveInnings(early);
    const forced = deriveInnings([...early,
      inningsEnd({ reason, confirmed: { runs: inProgress.runs, wickets: inProgress.wickets, balls: inProgress.balls } })]);
    ok(`${reason}: cannot be claimed by an innings still in progress`,
       forced.sealed === false && forced.sealRefused === SEAL_REFUSAL.NOT_THE_LAWS_REASON);
    ok(`${reason}: ...which leaves the innings open`,
       forced.complete === false && forced.endReason === null);
  }

  // A seal that does not say why. This used to be the most dangerous shape in
  // the model, because the constructor filled it in: inningsEnd({}) asserted
  // that the overs had run out, in any innings, at any score.
  const oneOver = [...start({ overs: 1 }), ...Array.from({ length: 6 }, () => runs(1))];
  const figs = deriveInnings(oneOver);
  ok("a seal with no reason no longer claims that the overs ran out",
     inningsEnd({}).reason === null);
  const unsaid = deriveInnings([...oneOver,
    inningsEnd({ confirmed: { runs: figs.runs, wickets: figs.wickets, balls: figs.balls } })]);
  ok("...and a reasonless seal is refused even with the right figures",
     unsaid.sealed === false && unsaid.sealRefused === SEAL_REFUSAL.NO_REASON);

  // THE STALE SEAL. A delivery arriving before the seal in the log is exactly
  // what quarantine release produces (db/14 appends at max(seq)+1, so a ball
  // held back by a stale epoch lands after everything already stored) and what
  // a second device's queue produces at a handover. The figures the scorer
  // confirmed are then not the figures of the innings, and the innings needs
  // confirming again rather than closing on a review of a different score.
  const allOutPlayed = [...start({}), ...Array.from({ length: 4 }, wkt)];
  const goodSeal = sealInnings(deriveInnings(allOutPlayed));
  const overtaken = deriveInnings([...allOutPlayed, runs(6), goodSeal]);
  ok("a seal overtaken by a delivery is refused", overtaken.sealed === false);
  ok("...naming the figures as the reason", overtaken.sealRefused === SEAL_REFUSAL.FIGURES_MOVED);
  ok("...and the innings is over, unclosed, at the figures the log actually holds",
     overtaken.complete === true && overtaken.runs === 6 && overtaken.endReason === "all_out");
  // And the same seal, in the log it was written for, stands.
  ok("the same seal stands where it belongs",
     deriveInnings([...allOutPlayed, goodSeal]).sealed === true);

  // A re-confirmation after the figures moved. This is what the banner sends
  // the scorer back to do, and it has to work or the innings can never close.
  const reconfirmed = [...allOutPlayed, runs(6)];
  ok("re-confirming the moved figures closes it",
     deriveInnings([...reconfirmed, sealInnings(deriveInnings(reconfirmed))]).sealed === true);

  // The two endings no ball log implies. A captain's declaration and an
  // umpire's abandonment are taken on the scorer's word — but only with the
  // figures, because the point of the checkpoint is that somebody read them.
  for (const spoken of ["declared", "abandoned"]) {
    const played = [...start({}), runs(4)];
    const inn = deriveInnings(played);
    ok(`${spoken} is accepted with the figures, though the laws derive nothing`,
       deriveInnings([...played, sealInnings(inn, spoken)]).endReason === spoken);
    ok(`...and ${spoken} without them is not`,
       deriveInnings([...played, inningsEnd({ reason: spoken })]).sealed === false);
  }

  // The seal has to survive the wire, or one that stood on the phone would be
  // refused by the server folding the same log back.
  const wire = fromRow({ ...toRow(goodSeal), seq: 9 });
  ok("the confirmed figures ride the wire in the payload",
     toRow(goodSeal).payload.confirmed?.wickets === 4);
  ok("...and a seal that made the round trip still closes the innings",
     deriveInnings([...allOutPlayed, wire]).sealed === true);

  // And through the match-level fold, which is the server's path.
  const m = deriveMatch([
    ...allOutPlayed.map((e) => ({ ...e, innings: 0 })),
    { ...goodSeal, innings: 0 },
    ...allOutPlayed.map((e) => ({ ...e, innings: 1 })),
    { ...inningsEnd({ reason: "all_out" }), innings: 1 },
  ]);
  ok("deriveMatch closes the sealed innings and not the asserted one",
     m.innings[0].sealed === true && m.innings[1].sealed === false);

  // sealInnings() cannot be talked into an event the reducer would refuse,
  // which is why the scoring surface builds seals with it and not by hand.
  const notOver = deriveInnings([...start({}), runs(1)]);
  ok("sealInnings on an unfinished innings carries no reason", sealInnings(notOver).reason === null);
  ok("...so it is refused rather than closing an innings in progress",
     deriveInnings([...start({}), runs(1), sealInnings(notOver)]).sealed === false);
  ok("sealInnings takes its figures from the innings, never from a caller",
     JSON.stringify(sealInnings(figs).confirmed) === JSON.stringify({ runs: 6, wickets: 0, balls: 6 }));

  // Replay stays pure over a log that contains a refusal.
  const refusedLog = [...allOutPlayed, inningsEnd({ reason: "all_out" })];
  ok("a log carrying a refused seal still derives deterministically",
     JSON.stringify(deriveInnings(refusedLog)) === JSON.stringify(deriveInnings(refusedLog)));
  ok("...and a later good seal clears the refusal",
     deriveInnings([...refusedLog, goodSeal]).sealRefused === null);
}

// ── I. The declared capture profile ──────────────────────
group("I. What the innings declared it would capture (SCRBRD-039)");
{
  // A mixed innings, the way the pad actually writes one: a tapped point, a
  // sector, a quick run with nothing placed, and a leave with no contact.
  const point = ball({ type: BALL_TYPE.RUN, value: 4, ...placementFromTap({ angle: 300, radius: 0.9 }) });
  const sector = ball({ type: BALL_TYPE.RUN, value: 1, seg: 3, zone: "outer",
                        placementSource: PLACEMENT_SOURCE.SECTOR, captureProfile: CAPTURE_PROFILE.STANDARD });
  const quick = ball({ type: BALL_TYPE.RUN, value: 2, ...noPlacement(PLACEMENT_NULL.NOT_REQUIRED, CAPTURE_PROFILE.QUICK) });
  const leave = ball({ type: BALL_TYPE.RUN, value: 0, shot: "leave", ...noPlacement(PLACEMENT_NULL.NO_CONTACT, CAPTURE_PROFILE.QUICK) });
  const deliveries = [point, sector, quick, leave];
  const startWith = (/** @type {string | undefined} */ captureProfile) => [
    inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville Boys'", squad: SQ_A,
                   bowlingSquad: SQ_B, overs: 20, captureProfile, clientTs: 1 }),
    batters({ striker: "p1", nonStriker: "p2", clientTs: 2 }), bowler({ bowler: "w1", clientTs: 3 }),
  ];
  const strip = (/** @type {import("../src/replay.mjs").Innings} */ inn) => { const { declaredProfile, ...rest } = inn; return JSON.stringify(rest); };

  // ── The event ──
  ok("an undeclared innings_start carries no captureProfile key at all",
     !("captureProfile" in inningsStart({ battingTeam: "A", bowlingTeam: "B" })));
  ok("a declared one carries it", inningsStart({ battingTeam: "A", captureProfile: "standard" }).captureProfile === "standard");
  let threw = null;
  try { inningsStart({ battingTeam: "A", captureProfile: "Full" }); } catch (e) { threw = e; }
  ok("a profile the model does not define is refused at the constructor, by name",
     threw instanceof TypeError && /unknown capture profile "Full"/.test(threw.message));

  // ── Backward compatibility: a log from before this existed ──
  // Written as a raw object, the shape every innings_start already on a phone
  // or in the server's log has. It must replay to the same innings, and every
  // label on it must be the count-only label it always was.
  const legacyStart = { kind: KIND.INNINGS_START, innings: 0, clientTs: 1, battingTeam: "Hilton College",
    bowlingTeam: "Westville Boys'", teamKey: "Hilton College", bowlingTeamKey: "Westville Boys'",
    squad: SQ_A, bowlingSquad: SQ_B, twelfthMan: null, overs: 20, target: null };
  const legacyLog = [legacyStart, ...startWith(undefined).slice(1), ...deliveries];
  const legacy = deriveInnings(legacyLog);
  ok("an innings that declared nothing folds to declaredProfile null", legacy.declaredProfile === null);
  ok("...and to exactly the innings a freshly built undeclared start gives",
     JSON.stringify(legacy) === JSON.stringify(deriveInnings([...startWith(undefined), ...deliveries])));
  ok("the legacy score is untouched", legacy.runs === 7 && legacy.balls === 4);
  const lp = placementEvidence(legacy.ballLog, { need: PLACEMENT_FIELD.POINT, declared: legacy.declaredProfile });
  const ls = placementEvidence(legacy.ballLog, { need: PLACEMENT_FIELD.SECTOR, declared: legacy.declaredProfile });
  ok("an undeclared innings grades points by count alone, as before", lp.label === evidenceLabel(lp.n) && lp.n === 1);
  ok("...and sectors", ls.label === evidenceLabel(ls.n) && ls.n === 2);
  ok("...and nothing in it is excused as not captured", lp.notCaptured === 0 && ls.notCaptured === 0);
  const empty = deriveInnings([legacyStart, ...deliveries.slice(2)]);
  ok("an undeclared innings with no placement at all is 'none', never 'not_captured'",
     placementEvidence(empty.ballLog, { declared: empty.declaredProfile }).label === "none");

  // ── The declaration never moves the cricket ──
  for (const p of Object.values(CAPTURE_PROFILE)) {
    const inn = deriveInnings([...startWith(p), ...deliveries]);
    ok(`declared ${p}: folds to ${p}`, inn.declaredProfile === p);
    ok(`declared ${p}: every other field is the undeclared innings, exactly`,
       strip(inn) === strip(deriveInnings([...startWith(undefined), ...deliveries])));
  }

  // ── Reading the evidence against it ──
  const std = deriveInnings([...startWith("standard"), quick, leave]);
  ok("a standard innings with no points: the heat map is not captured, by design",
     placementEvidence(std.ballLog, { declared: std.declaredProfile }).label === NOT_CAPTURED);
  ok("...but its missing sectors are a real 'none' — standard asked for them",
     placementEvidence(std.ballLog, { need: PLACEMENT_FIELD.SECTOR, declared: std.declaredProfile }).label === "none");
  const full = deriveInnings([...startWith("full"), quick, leave]);
  ok("the same balls under a full declaration are missing, not excused",
     placementEvidence(full.ballLog, { declared: full.declaredProfile }).label === "none");
  const qk = deriveInnings([...startWith("quick"), quick, leave]);
  const qe = placementEvidence(qk.ballLog, { need: PLACEMENT_FIELD.SECTOR, declared: qk.declaredProfile });
  ok("a quick innings never asked for a sector", qe.label === NOT_CAPTURED && qe.notCaptured === 2 && qe.missing === 0);
  const stray = deriveInnings([...startWith("standard"), point, quick]);
  ok("a point tapped in a standard innings is real data and graded as such",
     placementEvidence(stray.ballLog, { declared: stray.declaredProfile }).label === "insufficient");
  ok("an empty quick innings grades as db/31 does: not captured",
     placementEvidence([], { declared: "quick" }).label === NOT_CAPTURED && evidenceLabel(0, "quick", "point") === NOT_CAPTURED);
  ok("thresholds are db/08's evidence_label",
     [0, 29, 30, 99, 100, 249, 250].map((n) => evidenceLabel(n)).join() === "none,insufficient,low,low,moderate,moderate,high");
  ok("profiles collect what they say", profileCollects("full", "point") && profileCollects("standard", "sector")
     && !profileCollects("standard", "point") && !profileCollects("quick", "sector") && profileCollects(null, "point"));

  // Across innings — a career — each ball is read against its own innings.
  const career = [
    ...[quick, leave].map((b) => ({ ...b, declaredProfile: "standard" })),
    ...[quick].map((b) => ({ ...b, declaredProfile: null })),
  ];
  const ce = placementEvidence(career, { declaredFor: (b) => b.declaredProfile });
  ok("a career splits never-asked from missing", ce.notCaptured === 2 && ce.missing === 1 && ce.label === "none");
  ok("...and is 'not captured' only when every gap was by design",
     placementEvidence(career.slice(0, 2), { declaredFor: (b) => b.declaredProfile }).label === NOT_CAPTURED);

  // ── The three rules of the fold ──
  const redeclare = (/** @type {InningsStartInput} */ o) => inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville Boys'",
                                          squad: SQ_A, bowlingSquad: SQ_B, ...o });
  const late = deriveInnings([...startWith(undefined), point, redeclare({ captureProfile: "quick" })]);
  ok("a declaration after the first delivery is not honoured", late.declaredProfile === null);
  const lateOver = deriveInnings([...startWith("full"), point, redeclare({ captureProfile: "quick" })]);
  ok("...nor may it overwrite one made in time", lateOver.declaredProfile === "full");
  const keep = deriveInnings([...startWith("standard"), redeclare({ target: 50 }), quick]);
  ok("a re-declared innings_start without the field keeps the declaration (SCRBRD-063's break)",
     keep.declaredProfile === "standard" && keep.target === 50);
  const changed = deriveInnings([...startWith("standard"), redeclare({ captureProfile: "quick" }), quick]);
  ok("the latest declaration before the first ball wins", changed.declaredProfile === "quick");
  const bogus = deriveInnings([{ ...legacyStart, captureProfile: "everything" }, ...deliveries]);
  ok("an unknown value in a log is not a declaration, and does not throw", bogus.declaredProfile === null && bogus.runs === 7);
  const undone = { ...point, id: "b-undone" };
  const afterVoid = deriveInnings([...startWith(undefined), undone, voidEvent({ target: "b-undone" }),
    redeclare({ captureProfile: "standard" })]);
  ok("a ball that was voided never happened, so a declaration after it is still in time",
     afterVoid.declaredProfile === "standard" && afterVoid.balls === 0);

  // ── The wire, and the offline queue ──
  const declaredStart = { ...redeclare({ captureProfile: "standard" }), id: "d:1" };
  const row = toRow(declaredStart);
  ok("the declaration travels in the capture_profile column, which db/07's CHECK guards",
     row.capture_profile === "standard" && !("captureProfile" in row.payload));
  ok("...and comes back off it", /** @type {Loose<InningsStartEvent>} */ (fromRow({ ...row, seq: 1, idempotency_key: "d:1" })).captureProfile === "standard");
  const oldRow = toRow(legacyStart);
  ok("an undeclared start sends no capture_profile at all", !("capture_profile" in oldRow));
  ok("...and an old row with a NULL column reads back undeclared",
     !("captureProfile" in fromRow({ ...oldRow, capture_profile: null, seq: 1 })));

  // An innings recorded with no signal: every event goes to disk as JSON
  // inside a queue entry (packages/sync, record()), is replayed locally from
  // there ({...payload, id, seq}), then crosses the wire and comes back as a
  // row. All three views of the one log must fold to the same innings.
  const device = [...startWith("standard"), ...deliveries].map((e, i) => ({ ...e, id: `dev:${i}` }));
  const disk = device.map((e, i) => JSON.stringify({ idempotencyKey: e.id, clientSeq: i + 1, payload: e }));
  const fromQueue = disk.map((j) => JSON.parse(j)).map((q, i) => ({ ...q.payload, id: q.idempotencyKey, seq: 1e9 + i }));
  const fromServer = device.map((e, i) => fromRow({ ...toRow(e), seq: i + 1, idempotency_key: e.id }));
  const here = deriveInnings(device), queued = deriveInnings(fromQueue), synced = deriveInnings(fromServer);
  ok("an offline-queued declared innings replays from the queue as recorded",
     queued.declaredProfile === "standard" && strip(queued).replace(/"seq":\d+(\.\d+)?(e\+\d+)?,?/g, "")
       === strip(here).replace(/"seq":\d+(\.\d+)?(e\+\d+)?,?/g, ""));
  ok("...and from the server's rows once it syncs",
     synced.declaredProfile === "standard" && synced.runs === here.runs && synced.balls === here.balls
     && placementEvidence(synced.ballLog, { declared: synced.declaredProfile }).label
        === placementEvidence(here.ballLog, { declared: here.declaredProfile }).label);
  // A queue written by a build that predates this — no key on anything — still
  // applies, and to an undeclared innings, not to an error.
  const oldQueue = legacyLog
    .map((e, i) => JSON.parse(JSON.stringify({ idempotencyKey: `old:${i}`, payload: e })))
    .map((q, i) => ({ ...q.payload, id: q.idempotencyKey, seq: 1e9 + i }));
  const oldInn = deriveInnings(oldQueue);
  ok("a queue from an older build applies, undeclared, with its score intact",
     oldInn.declaredProfile === null && oldInn.runs === legacy.runs && oldInn.balls === legacy.balls);
  // And a match that mixes them: declared on the new device, the second
  // innings re-opened by an older device at the break.
  const m = deriveMatch([
    ...[...startWith("quick"), quick].map((e) => ({ ...e, innings: 0 })),
    { ...legacyStart, innings: 1, target: 3 },
    { ...quick, innings: 1 },
  ]);
  ok("each innings keeps its own declaration across a mixed-build match",
     m.innings[0].declaredProfile === "quick" && m.innings[1].declaredProfile === null);
}

// ── J. Dismissals with no delivery (SCRBRD-081) ──────────
group("J. Timed out and retired out are not deliveries (SCRBRD-081)");
{
  const five = [...open(), runs(1), runs(0), runs(4)];
  const before = deriveInnings(five);

  // Retired out: the non-striker (p1, after the single) walks off.
  const ro = retire({ batter: "p1", reason: "out" });
  ok("retired out is built as a retire marked W, with the canonical dismissal",
     ro.kind === KIND.RETIRE && ro.type === BALL_TYPE.WICKET && ro.dismissal === DISMISSAL.RETIRED_OUT);
  const rOut = deriveInnings([...five, ro]);
  ok("retired out is a wicket", rOut.wickets === before.wickets + 1);
  ok("...that bowls no ball: the over's count and the innings' balls do not move",
     rOut.balls === before.balls && rOut.ballLog.length === before.ballLog.length);
  const w1 = must(rOut.bowlers.find((b) => b.id === "w1"));
  const w1Before = must(before.bowlers.find((b) => b.id === "w1"));
  ok("...and the bowler's figures do not move: no ball, no run, no wicket",
     w1.balls === w1Before.balls && w1.runs === w1Before.runs && w1.wickets === 0);
  const p1 = must(rOut.batsmen.find((b) => b.id === "p1"));
  ok("the batter is out, retired out, his runs and balls kept",
     p1.status === "out" && p1.dismissal === "retired out" && p1.runs === 1 && p1.balls === 1);
  ok("his end is empty and the other batter stays where he was",
     rOut.nonStriker === null && rOut.striker === before.striker);
  ok("the fall of wickets has him, at the score and overs when he left",
     rOut.fow.length === 1 && rOut.fow[0].batsman === "James Whitfield" && rOut.fow[0].runs === 5 && rOut.fow[0].overs === "0.3");
  ok("...and the fold says the wicket fell with no ball, in the first over",
     rOut.nonBallWickets.length === 1 && rOut.nonBallWickets[0].over === 0 && rOut.nonBallWickets[0].dismissal === "retired_out");
  ok("the partnership closes on it", rOut.partnerships.length === 1 && rOut.partnerships[0].runs === 5);

  // Timed out: the batter due in after a wicket never gets there.
  const out = [...five, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })];
  const afterWkt = deriveInnings(out);
  const to = retire({ batter: "p3", reason: "timed_out" });
  ok("timed out is built the same way", to.type === BALL_TYPE.WICKET && to.dismissal === DISMISSAL.TIMED_OUT);
  const tOut = deriveInnings([...out, to]);
  ok("timed out is a wicket", tOut.wickets === 2);
  ok("...on no ball, credited to nobody",
     tOut.balls === afterWkt.balls && must(tOut.bowlers.find((b) => b.id === "w1")).wickets === 1);
  ok("...of a batter who never reached the crease: both ends as they were",
     tOut.striker === afterWkt.striker && tOut.nonStriker === afterWkt.nonStriker);
  const p3 = must(tOut.batsmen.find((b) => b.id === "p3"));
  ok("he is on the card: timed out, 0 off 0", p3.status === "out" && p3.dismissal === "timed out" && p3.balls === 0);
  const next = deriveInnings([...out, to, batters({ striker: "p4" })]);
  ok("the next batter fills the end", next.striker === "p4" && next.nonStriker === afterWkt.nonStriker);

  // A free hit is not spent by something that is not a ball.
  const fh = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL }), retire({ batter: "p1", reason: "out" })]);
  ok("a free hit survives a retirement between the balls", fh.freeHit === true);

  // The last wicket ends the innings, on no ball.
  const three = [inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A.slice(0, 3), bowlingSquad: SQ_B }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }), runs(0),
    ball({ type: BALL_TYPE.WICKET, dismissal: "caught" }), retire({ batter: "p2", reason: "out" })];
  const allOut = deriveInnings(three);
  ok("a side can be all out on a retirement", allOut.complete && allOut.endReason === "all_out" && allOut.balls === 2);

  // Retired hurt is untouched: no marker, no wicket.
  const hurt = retire({ batter: "p1", reason: "hurt" });
  ok("retired hurt carries no marker and is no wicket",
     !("type" in hurt) && !("dismissal" in hurt) && deriveInnings([...five, hurt]).wickets === 0);

  // OLD LOGS REPLAY EXACTLY AS BEFORE. Two shapes an older log can hold:
  //   - the pad's own, until now: a W delivery naming timed out / retired out;
  //   - the model's: a retire with reason "out" and no marker.
  // The figures below are what the fold derived from these before SCRBRD-081,
  // written out rather than recomputed, so a change to either is a failure.
  const oldTimed = deriveInnings([...five, ball({ type: BALL_TYPE.WICKET, dismissal: "timed_out" })]);
  ok("an old W ball 'timed out' still counts a legal ball", oldTimed.balls === 4 && oldTimed.wickets === 1);
  ok("...in the bowler's overs, with no wicket to him",
     must(oldTimed.bowlers.find((b) => b.id === "w1")).balls === 4 && must(oldTimed.bowlers.find((b) => b.id === "w1")).wickets === 0);
  ok("...against the striker, as it always did", oldTimed.striker === null && oldTimed.nonStriker === "p1"
     && must(oldTimed.batsmen.find((b) => b.id === "p2")).dismissal === "timed out"
     && oldTimed.fow[0].overs === "0.4" && oldTimed.nonBallWickets.length === 0);
  const oldRetired = deriveInnings([...five, ball({ type: BALL_TYPE.WICKET, dismissal: "retired_out" })]);
  ok("an old W ball 'retired out' replays the same way",
     oldRetired.balls === 4 && oldRetired.wickets === 1 && must(oldRetired.batsmen.find((b) => b.id === "p2")).balls === 3);
  /** @type {LogEvent} */
  const legacyRetireOut = { kind: "retire", batter: "p1", reason: "out" };
  const oldRet = deriveInnings([...five, legacyRetireOut]);
  ok("an unmarked retire 'out' is still no wicket, status retired",
     oldRet.wickets === 0 && must(oldRet.batsmen.find((b) => b.id === "p1")).status === "retired"
     && must(oldRet.batsmen.find((b) => b.id === "p1")).dismissal === "retired out" && oldRet.nonBallWickets.length === 0);

  // Through the wire: the row a retirement is stored as.
  const row = toRow({ ...to, innings: 0 });
  ok("stored: kind retire, ball_type W, the dismissal in its column, the batter in payload",
     row.kind === "retire" && row.ball_type === "W" && row.dismissal === "timed_out" && row.payload.batter === "p3");
  ok("...and back, the same wicket", deriveInnings([...out, fromRow({ ...row, seq: 99, client_ts: new Date().toISOString() })]).wickets === 2);
}

// ── K. No-ball byes (SCRBRD-068) ─────────────────────────
group("K. Whose the runs off a no-ball are (SCRBRD-068)");
{
  const hit = ball({ type: BALL_TYPE.NO_BALL, value: 2 });
  ok("a no-ball hit for runs is built as it always was: no nbRuns key", !("nbRuns" in hit));
  const lb = ball({ type: BALL_TYPE.NO_BALL, value: 2, nbRuns: "leg_byes" });
  ok("leg byes off one carry it", lb.nbRuns === "leg_byes" && lb.value === 2);
  let threw = 0;
  try { ball({ type: BALL_TYPE.NO_BALL, value: 1, nbRuns: "overthrows" }); } catch { threw++; }
  try { ball({ type: BALL_TYPE.BYE, value: 1, nbRuns: "byes" }); } catch { threw++; }
  ok("an unknown one, or one on a delivery that is not a no-ball, is refused at construction", threw === 2);

  // OLD LOGS: a no-ball as the pad wrote it until now (value, no nbRuns) is
  // the striker's — the figures below are the fold's before SCRBRD-068.
  /** @type {LogEvent} */
  const oldNb = { kind: "ball", type: "Nb", value: 4 };
  const old = deriveInnings([...open(), oldNb]);
  const p1 = must(old.batsmen.find((b) => b.id === "p1"));
  ok("an old no-ball for four replays as it did: his four, one no-ball extra, five to the side",
     p1.runs === 4 && p1.fours === 1 && p1.balls === 1 && old.extras.noBall === 1 && old.runs === 5 && old.bowlers[0].runs === 5);

  const withLb = deriveInnings([...open(), runs(1), lb]);
  const p2 = must(withLb.batsmen.find((b) => b.id === "p2"));
  ok("leg byes off a no-ball: the striker faced it and has none of them", p2.balls === 1 && p2.runs === 0);
  // Law 21.15 (current Code, db/52): the penalty run is the no-ball extra,
  // the two run are leg byes, and only the penalty run is the bowler's.
  ok("...the side has 1 + 1 + 2: one no-ball extra, two leg byes", withLb.runs === 4
     && withLb.extras.noBall === 1 && withLb.extras.legBye === 2 && withLb.extras.bye === 0);
  ok("...the bowler is charged the single he conceded and the no-ball's penalty run, not the leg byes", withLb.bowlers[0].runs === 2);
  ok("...two run is even: the ends are as they were", withLb.striker === "p2");
  // runsToBowler(): the rule the fold charges by, and ball_runs_to_bowler() in db/52 mirrors.
  const charged = [
    [{ type: "Nb", value: 4 }, 5], [{ type: "Nb", value: 4, nbRuns: "byes" }, 1], [{ type: "Nb", value: 3, nbRuns: "leg_byes" }, 1],
    [{ type: "Nb", value: 0 }, 1], [{ type: "Wd", value: 2 }, 3], [{ type: "B", value: 4 }, 0], [{ type: "LB", value: 1 }, 0],
    [{ type: "run", value: 6 }, 6], [{ type: "W", value: 1 }, 1], [{ value: 2 }, 2],
  ];
  // The db/52 fixture: db/52_noball_byes.sql's proof inserts these ten
  // deliveries and holds every SQL bowler reader to what the fold says here.
  const db52 = deriveInnings([...open(),
    ball({ type: BALL_TYPE.NO_BALL, value: 0 }), ball({ type: BALL_TYPE.NO_BALL, value: 4 }),
    ball({ type: BALL_TYPE.NO_BALL, value: 4, nbRuns: "byes" }), ball({ type: BALL_TYPE.NO_BALL, value: 3, nbRuns: "leg_byes" }),
    ball({ type: BALL_TYPE.NO_BALL, value: 2, nbRuns: "byes" }), ball({ type: BALL_TYPE.WIDE, value: 1 }),
    ball({ type: BALL_TYPE.BYE, value: 4 }), ball({ type: BALL_TYPE.LEG_BYE, value: 1 }),
    runs(6), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })]);
  const w52 = db52.bowlers[0];
  ok("the db/52 fixture: 17 conceded off 4 legal balls, 1 wide, 5 no-balls, 1 wicket (SQL reads the same)",
     w52.runs === 17 && w52.balls === 4 && w52.wides === 1 && w52.noBalls === 5 && w52.wickets === 1);
  const wrong = charged.filter(([e, want]) => runsToBowler(/** @type {any} */ (e)) !== want);
  ok("runsToBowler(): a no-ball is its penalty run and the runs off the bat, never its byes or leg byes"
     + (wrong.length ? ` — wrong for ${JSON.stringify(wrong)}` : ""), wrong.length === 0);
  const partnership = withLb.curPartner.runs;
  ok("...and the partnership has them, as it has every extra", partnership === 4);

  // Through the wire, and a retry of an old no-ball still says the same thing.
  const row = toRow({ ...lb, innings: 0 });
  ok("stored with value in its column and nbRuns in payload", row.value === 2 && row.ball_type === "Nb" && row.payload.nbRuns === "leg_byes");
  const back = fromRow({ ...row, seq: 5, client_ts: new Date().toISOString() });
  ok("...and back", back.kind === "ball" && "nbRuns" in back && back.nbRuns === "leg_byes");
  ok("an old no-ball's row gains no payload key", !("nbRuns" in toRow({ ...oldNb, innings: 0 }).payload));
}

// ── L. Penalty runs to the fielding side (SCRBRD-094) ────
group("L. Five to the fielding side: their last completed innings, or their next (Law 41.17.4)");
{
  const A = SQ_A.concat([{ id: "p6", name: "P6" }, { id: "p7", name: "P7" }]);
  const B = SQ_B.concat([{ id: "w4", name: "W4" }, { id: "w5", name: "W5" }]);
  /** @param {number} i  @param {"A" | "B"} bat  @param {InningsStartInput} [o] */
  const start = (i, bat, o = {}) => [
    inningsStart({ innings: i, battingTeam: bat, bowlingTeam: bat === "A" ? "B" : "A",
                   squad: bat === "A" ? A : B, bowlingSquad: bat === "A" ? B : A, overs: 1, ...o }),
    batters({ innings: i, striker: bat === "A" ? "p1" : "w1", nonStriker: bat === "A" ? "p2" : "w2" }),
    bowler({ innings: i, bowler: bat === "A" ? "w3" : "p3" }),
  ];
  /** @param {number} i  @param {...number} vs */
  const r = (i, ...vs) => vs.map((v) => runs(v, { innings: i }));
  let awards = 0;
  const toField = (/** @type {number} */ i) => penalty({ id: `award-${++awards}`, innings: i, runs: 5, toBattingTeam: false, reason: "time_wasting" });

  // 1. Awarded while B fields first: B has not batted, so their innings opens on it.
  {
    const log = [...start(0, "A"), ...r(0, 1, 2), toField(0), ...r(0, 0, 1, 0, 1)];
    const first = deriveMatch(log).innings[0];
    ok("an award to the fielding side is not in the batting side's total", first.runs === 5 && first.extras.penalty === 0);
    ok("...the innings counts it as the fielding side's", first.penaltyToFielding === 5 && first.penaltyCarried === 0);
    ok("...deriveInnings() alone says the same of that innings", deriveInnings(log).runs === 5 && deriveInnings(log).penaltyToFielding === 5);
    const credits = penaltyCredits([[0, first]]);
    ok("with the second innings not opened, the award is pending for B", credits.pending.length === 1
       && credits.pending[0].team === "B" && credits.pending[0].runs === 5 && credits.carried.size === 0 && credits.added.size === 0);

    const opened = [...log, ...start(1, "B", { target: 6 })];
    const m = deriveMatch(opened);
    ok("B's innings opens on 5, before a ball is bowled", m.innings[1].runs === 5 && m.innings[1].balls === 0);
    ok("...as penalty extras carried from the other innings", m.innings[1].extras.penalty === 5 && m.innings[1].penaltyCarried === 5);
    ok("...and the side that fielded keeps its own total", m.innings[0].runs === 5);

    const chase = [...opened, runs(0, { innings: 1 }), ball({ innings: 1, type: BALL_TYPE.WICKET, dismissal: "bowled" })];
    const fow = deriveMatch(chase).innings[1].fow[0];
    ok("a wicket that falls at 0 runs scored falls at 5 on the card", fow.runs === 5 && fow.wickets === 1);
    const won = deriveMatch([...chase, batters({ innings: 1, striker: "w4" }), runs(1, { innings: 1 })]);
    ok("...and the chase ends when the 5 and the runs reach the target (6)",
       won.innings[1].runs === 6 && won.innings[1].complete && won.innings[1].endReason === "target_reached");
    ok("...B win by wickets", won.result?.winner === "B" && won.result.margin === "3 wickets", won.result);
    const plain = deriveMatch([...start(0, "A"), ...r(0, 1, 2, 0, 1, 0, 1), ...start(1, "B", { target: 6 }), ...r(1, 0, 0, 1)]);
    ok("...where without the award B would still be 5 short", plain.innings[1].runs === 1 && !plain.innings[1].complete);

    // The seal confirms the figures the innings holds — the 5 among them.
    const inn1 = deriveMatch(chase).innings[1];
    const sealedWith = deriveMatch([...chase, { ...sealInnings(inn1, "declared"), innings: 1 }]).innings[1];
    ok("a seal confirming the total with the carried 5 closes the innings", sealedWith.sealed === true);
    const sealedWithout = deriveMatch([...chase, { ...sealInnings({ ...inn1, runs: inn1.runs - 5 }, "declared"), innings: 1 }]).innings[1];
    ok("...one confirming it without them is refused as moved", sealedWithout.sealRefused === SEAL_REFUSAL.FIGURES_MOVED);
  }

  // 2. Awarded while A fields second: A batted first and is complete, so
  //    their total — and the target — rise mid-chase.
  {
    const first = [...start(0, "A"), ...r(0, 1, 2, 4, 0, 2, 1)];          // 10 off the over
    const chase = [...start(1, "B", { target: 11 }), ...r(1, 4)];
    const before = deriveMatch([...first, ...chase]);
    ok("A made 10; B chase 11", before.innings[0].runs === 10 && before.innings[1].target === 11);

    // Deliberate short running: the delivery with no run, and 5 to A.
    const [dot, award] = shortRunning({ innings: 1, type: BALL_TYPE.RUN, value: 2 });
    const mid = deriveMatch([...first, ...chase, dot, award]);
    ok("A's completed innings rises to 15", mid.innings[0].runs === 15 && mid.innings[0].extras.penalty === 5
       && mid.innings[0].penaltyCarried === 5);
    ok("...its fall of wickets and balls are as they were", mid.innings[0].balls === 6 && mid.innings[0].fow.length === 0);
    ok("...the target moves to 16 mid-chase", mid.innings[1].target === 16);
    ok("...B's total has none of it", mid.innings[1].runs === 4 && mid.innings[1].extras.penalty === 0
       && mid.innings[1].penaltyToFielding === 5);

    // B then take 4, 4, 1, 0: 13 — past the old target, short of the new.
    const tail = r(1, 4, 4, 1, 0);
    const end = deriveMatch([...first, ...chase, dot, award, ...tail]);
    ok("the chase is not over at 12 (the old target was 11): it runs to the overs",
       end.innings[1].runs === 13 && end.innings[1].complete && end.innings[1].endReason === "overs_complete");
    ok("...A win by 2 runs, against the moved target (16 − 1 − 13)", end.result?.winner === "A" && end.result.margin === "2 runs", end.result);
    const noAward = deriveMatch([...first, ...chase, dot, ...r(1, 4, 4)]);
    ok("...where with no award B had won at 12", noAward.innings[1].complete && noAward.innings[1].endReason === "target_reached"
       && noAward.result?.winner === "B");

    // A chase with no target on its innings_start is judged against A's total + 1 — the credited one.
    const unstamped = deriveMatch([...first, ...start(1, "B"), ...r(1, 4), dot, award, ...tail]);
    ok("with no stamped target the result reads A's credited total", unstamped.result?.winner === "A" && unstamped.result.margin === "2 runs",
       unstamped.result);

    // The umpires' revised target is theirs: an award after it does not move it.
    const revised = deriveMatch([...first, ...chase, revision({ innings: 1, target: 9, reason: "rain" }), dot, award]);
    ok("a revised target does not move with a later award", revised.innings[1].target === 9 && revised.innings[0].runs === 15);
    const reopened = deriveMatch([...first, ...chase, revision({ innings: 1, target: 9 }),
                                  inningsStart({ innings: 1, battingTeam: "B", bowlingTeam: "A", squad: B, bowlingSquad: A, overs: 1, target: 11 }), dot, award]);
    ok("...but one re-stamped by innings_start after it does", reopened.innings[1].target === 16);

    // An award to the batting side is where it always was.
    const toBat = deriveMatch([...first, ...chase, penalty({ innings: 1, runs: 5, reason: "helmet_struck" })]);
    ok("an award to the batting side stays in its own innings", toBat.innings[1].runs === 9 && toBat.innings[0].runs === 10
       && toBat.innings[1].target === 11);
  }

  // 3. The fold, three ways: deriveMatch, deriveInningsList, MatchFold (whole and event by event).
  {
    const log = [...start(0, "A"), ...r(0, 1), toField(0), ...r(0, 2, 0, 0, 1, 1),
                 ...start(1, "B", { target: 6 }), ...r(1, 1), toField(1), ...r(1, 0)];
    const m = deriveMatch(log);
    ok("both ways at once: B opened on 5, A's 5 rose to 10, the target 11",
       m.innings[1].runs === 6 && m.innings[0].runs === 10 && m.innings[1].target === 11, m.innings.map((x) => [x.runs, x.target]));
    /** @type {LogEvent[][]} */ const byInn = [];
    for (const e of log) (byInn[e.innings ?? 0] ??= []).push(e);
    const list = deriveInningsList(byInn);
    ok("deriveInningsList() is deriveMatch's innings, by number", list.every((x, i) => JSON.stringify(x) === JSON.stringify(m.innings[i])));
    ok("...and null for an innings with no log", deriveInningsList([byInn[0], [], byInn[1]])[1] === null);
    /** @param {Innings | null | undefined} x */
    const figures = (x) => JSON.stringify(x && [x.runs, x.wickets, x.balls, x.extras, x.target, x.complete, x.fow, x.penaltyToFielding, x.penaltyCarried]);
    const whole = new MatchFold(log).view();
    const inc = new MatchFold([]);
    let agreeing = true;
    for (let k = 0; k < log.length; k++) {
      inc.push(log[k]);
      const want = deriveMatch(log.slice(0, k + 1)).innings;
      const got = inc.view().innings;
      agreeing &&= want.every((x, i) => figures(x) === figures(got[i]));
    }
    ok("MatchFold, whole, credits as deriveMatch does", whole.innings.every((x, i) => figures(x) === figures(m.innings[i])));
    ok("...and event by event, as the server judges a batch", agreeing);
    const undone = new MatchFold(log);
    const last = must(log.findLast((e) => e.kind === KIND.PENALTY)?.id);
    undone.push(voidEvent({ innings: 1, target: last }));
    ok("...a void of the award takes the credit and the target back",
       undone.view().innings[0].runs === 5 && undone.view().innings[1].target === 6);
  }

  // 4. Two-innings (two-day) matches: A, B, A, B — and the follow-on, A, B, B, A.
  {
    const A1 = [...start(0, "A"), ...r(0, 1, 1, 1, 1, 1, 1)];
    const B1 = [...start(1, "B"), ...r(1, 2, 2, 2, 2, 2, 2)];
    const A2 = [...start(2, "A"), ...r(2, 0, 0, 0, 0, 0, 3)];
    const B2 = [...start(3, "B"), ...r(3, 1)];
    const four = deriveMatch([...A1, ...B1, toField(1), ...A2, toField(2), ...B2, toField(3)]);
    ok("an award in B's first innings goes to A's first", four.innings[0].runs === 11);
    ok("...one in A's second goes to B's first (their most recent)", four.innings[1].runs === 17);
    ok("...one in B's second goes to A's second", four.innings[2].runs === 8);
    ok("...B's second has none", four.innings[3].runs === 1);
    ok("...each where the innings made it is counted there", four.innings.slice(1).every((x) => x.penaltyToFielding === 5));

    const openers = deriveMatch([...A1, toField(0), ...B1, ...A2]);
    ok("an award in the first innings goes to B's next innings, their first", openers.innings[1].runs === 17
       && openers.innings[1].penaltyCarried === 5 && openers.innings[3] === undefined);

    const followOn = deriveMatch([...A1, ...B1, ...start(2, "B"), ...r(2, 1), toField(2), ...start(3, "A")]);
    ok("the follow-on: an award in B's second innings goes to A's first, their most recent",
       followOn.innings[0].runs === 11 && followOn.innings[3].runs === 0);
  }

  // 5. Deliberate short running, as the fold reads it.
  {
    const log = [...open(), runs(1)];
    const [dot, award] = shortRunning({ type: BALL_TYPE.RUN, value: 3, striker: "p2", bowler: "w1" });
    ok("the delivery has no runs and the award is 5 to the fielding side, reason short_running",
       dot.kind === KIND.BALL && dot.value === 0 && award.kind === KIND.PENALTY && award.runs === 5
       && award.toBattingTeam === false && award.reason === "short_running");
    const inn = deriveInnings([...log, dot, award]);
    ok("every run is disallowed: the side, the striker and the bowler have none of them",
       inn.runs === 1 && inn.batsmen.find((b) => b.id === "p2")?.runs === 0 && inn.bowlers[0].runs === 1);
    ok("...the delivery counts: a ball of the over and a ball faced", inn.balls === 2 && inn.batsmen.find((b) => b.id === "p2")?.balls === 1);
    ok("...the batters are at the ends they started from", inn.striker === "p2" && inn.nonStriker === "p1");
    const nb = shortRunning({ type: BALL_TYPE.NO_BALL, value: 1 });
    ok("off a no-ball the one-run penalty stands (Law 18.5.2)", deriveInnings([...log, ...nb]).runs === 2);
  }
}

// ── M. A bowler suspended (Law 41, SCRBRD-094 item 2) ─────
group("M. A bowler suspended: the fold records it; a split over credits each his own balls");
{
  // Over 1: w1, a maiden. Over 2: w2 bowls 0, 1 and a no-ball, and is
  // suspended; w3 finishes it with 4 legal balls.
  const log = [...open(), runs(0), runs(0), runs(0), runs(0), runs(0), runs(0),
    bowler({ bowler: "w2" }), runs(0), runs(1), ball({ type: BALL_TYPE.NO_BALL }),
    bowlerSuspended({ bowler: "w2", reason: "deliberate_no_ball", edition: 3 }),
    bowler({ bowler: "w3", reason: "suspended" }), runs(0), runs(2), runs(0), runs(0)];
  const inn = deriveInnings(log);
  ok("the fold records the suspension: who, why, for how long, at which ball",
     inn.suspensions.length === 1 && inn.suspensions[0].bowler === "w2" && inn.suspensions[0].reason === "deliberate_no_ball"
     && inn.suspensions[0].scope === "innings" && inn.suspensions[0].over === 1 && inn.suspensions[0].ballInOver === 2);
  ok("...and the change that follows it, reason suspended",
     inn.bowlerChanges.length === 1 && inn.bowlerChanges[0].from === "w2" && inn.bowlerChanges[0].to === "w3" && inn.bowlerChanges[0].reason === "suspended");
  const w2 = must(inn.bowlers.find((b) => b.id === "w2")), w3 = must(inn.bowlers.find((b) => b.id === "w3"));
  ok("each bowler has the balls he bowled: w2 two legal balls, w3 four", w2.balls === 2 && w3.balls === 4 && inn.balls === 12);
  ok("...and the runs off them: w2 1 + the no-ball's 1, w3 2", w2.runs === 2 && w2.noBalls === 1 && w3.runs === 2);
  ok("...so economy reads right: w2 2 off 0.2, w3 2 off 0.4", fmtOvers(w2.balls) === "0.2" && fmtOvers(w3.balls) === "0.4");
  ok("a suspension moves no figure: the innings as it would be without the event",
     (() => { const without = deriveInnings(log.filter((e) => e.kind !== KIND.BOWLER_SUSPENDED));
              return without.runs === inn.runs && without.balls === inn.balls && without.wickets === inn.wickets
                && JSON.stringify(without.bowlers) === JSON.stringify(inn.bowlers); })());
  ok("the suspended bowler stays on until another is named", deriveInnings(log.slice(0, 14)).bowler === "w2");

  // Maidens: a completed over by one bowler with nothing charged to him.
  // An over two bowlers shared is a maiden for neither (SCORING_RULES.md §4).
  const quiet = [...open(), runs(0), runs(0), runs(0), runs(0), runs(0), runs(0),
    bowler({ bowler: "w2" }), runs(0), runs(0),
    bowlerSuspended({ bowler: "w2", reason: "beamers" }), bowler({ bowler: "w3", reason: "suspended" }),
    runs(0), runs(0), runs(0), runs(0)];
  const q = deriveInnings(quiet);
  ok("w1's scoreless over is his maiden", must(q.bowlers.find((b) => b.id === "w1")).maidens === 1);
  ok("the scoreless over w2 and w3 shared is a maiden for neither",
     must(q.bowlers.find((b) => b.id === "w2")).maidens === 0 && must(q.bowlers.find((b) => b.id === "w3")).maidens === 0);
  ok("...the same after an injury (SCRBRD-080): shared, so nobody's maiden",
     deriveInnings([...open(), runs(0), runs(0), bowler({ bowler: "w2", reason: "injury" }), runs(0), runs(0), runs(0), runs(0)])
       .bowlers.every((b) => b.maidens === 0));

  // Through the wire and back, and old logs unchanged.
  const ev = { ...bowlerSuspended({ bowler: "w2", reason: "ball_tampering" }), innings: 0, id: "s1" };
  const row = toRow(ev);
  ok("stored: kind bowler_suspended, the reason and scope in the payload",
     row.kind === "bowler_suspended" && row.ball_type === null && row.value === null
     && row.payload.reason === "ball_tampering" && row.payload.scope === "match" && row.payload.bowler === "w2");
  const back = fromRow({ ...row, seq: 5, idempotency_key: "s1", client_ts: new Date().toISOString() });
  ok("...and back, the same suspension", back.kind === KIND.BOWLER_SUSPENDED && back.bowler === "w2"
     && deriveInnings([...open(), runs(0), back]).suspensions[0]?.scope === "match");
  ok("an innings with no suspension has none", deriveInnings(open()).suspensions.length === 0);
  ok("the words for the commentary: reason and how long, no names and no clause numbers",
     suspensionWords(ev) === "Suspended for changing the condition of the ball (ball tampering), for the rest of the match.");
}

group("N. A no-ball's kind is recorded as asked, and decides nothing in the fold");
{
  const nb = ball({ type: BALL_TYPE.NO_BALL, nbType: "front_foot" });
  ok("the constructor keeps it on a no-ball", nb.nbType === "front_foot");
  ok("...leaves it off when not asked, so an old no-ball is the same event", !("nbType" in ball({ type: BALL_TYPE.NO_BALL })));
  let threw = 0;
  try { ball({ type: BALL_TYPE.NO_BALL, nbType: "waist" }); } catch { threw++; }
  try { ball({ type: BALL_TYPE.RUN, nbType: "height" }); } catch { threw++; }
  ok("...and refuses an unknown kind, or one on anything but a no-ball", threw === 2);
  const a = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, nbType: "front_foot" })]);
  const b = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL })]);
  ok("a front-foot no-ball gives the free hit, as every no-ball does", a.freeHit === true && b.freeHit === true && a.runs === b.runs);
  ok("...and rides in the payload", toRow({ ...nb, innings: 0 }).payload.nbType === "front_foot");
}

group("O. Rows the Laws refuse, as the database can still hold them: what the fold reads (db/54, 4)");
{
  // A retire marked W whose method is neither retired out nor timed out (the
  // row db/99's db/45 section writes: `bowled`, reason hurt). Every other way
  // out needs a delivery, so it is a retirement, not a wicket: his line
  // "retired hurt", the wickets unmoved, and he may come back. SQL reads it
  // the same way in every reader (ball_retirement_dismissal(), db/40; the
  // live score since db/54).
  const odd = { kind: KIND.RETIRE, batter: "p2", reason: "hurt", type: BALL_TYPE.WICKET, dismissal: "bowled" };
  const inn = deriveInnings([...open(), runs(1), /** @type {any} */ (odd)]);
  const p2 = inn.batsmen.find((/** @type {any} */ b) => b.id === "p2");
  ok("a retire marked W, method bowled, reason hurt: no wicket, no fall of wicket",
     inn.wickets === 0 && inn.fow.length === 0 && inn.nonBallWickets.length === 0);
  ok("...his line retired hurt, and on the record of retirements not out",
     p2?.dismissal === "retired hurt" && inn.retirements.some((r) => r.batter === "p2" && !r.out));
  const back = deriveInnings([...open(), runs(1), /** @type {any} */ (odd), batters({ nonStriker: "p3" }),
                              ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }), batters({ striker: "p2" }), runs(2)]);
  ok("...and he may come back, as a batter retired hurt does",
     back.wickets === 1 && back.batsmen.find((/** @type {any} */ b) => b.id === "p2")?.runs === 2);
  // A penalty row carrying a `value`: the fold reads a row's value on a
  // delivery only, so the award is its own `runs` (db/45; the live score
  // since db/54).
  const pen = deriveInnings([...open(), runs(1), /** @type {any} */ ({ ...penalty({ runs: 2 }), value: 3 })]);
  ok("a penalty row's value is not runs: 1 + 2, not 1 + 3 + 2", pen.runs === 3);
}

group("P. A wicket on a wide or a no-ball (Law 22.9, Law 21.17)");
{
  const W = BALL_TYPE.WIDE, NB = BALL_TYPE.NO_BALL;
  /** @param {Innings} i  @param {string} id */
  const bat = (i, id) => must(i.batsmen.find((b) => b.id === id));
  /** @param {Innings} i  @param {string} id */
  const bow = (i, id) => must(i.bowlers.find((b) => b.id === id));
  /** Both folds of one log, the pad's and the server's, must agree. @param {LogEvent[]} log */
  const both = (log) => {
    const inn = deriveInnings(log);
    const srv = must(new MatchFold(log.map((e) => ({ ...e, innings: 0 }))).view().innings[0]);
    return { inn, agree: srv.runs === inn.runs && srv.wickets === inn.wickets && srv.balls === inn.balls
      && JSON.stringify(srv.fow) === JSON.stringify(inn.fow) && JSON.stringify(srv.bowlers) === JSON.stringify(inn.bowlers) };
  };

  // Stumped off a wide: the wide's run, a wicket, the bowler's; no ball of the over, no ball faced.
  {
    const { inn, agree } = both([...open(), ball({ type: W, value: 0, dismissal: "stumped", fielder: "K Botha" })]);
    ok("stumped off a wide: the side scores the wide's run", inn.runs === 1 && inn.extras.wide === 1);
    ok("...a wicket falls", inn.wickets === 1);
    ok("...and it is no ball of the over", inn.balls === 0 && bow(inn, "w1").balls === 0);
    ok("...the striker is out, stumped, credited to the bowler", bat(inn, "p1").status === "out" && bat(inn, "p1").dismissal === "st K Botha b D Mkhize");
    ok("...a wide is no ball faced", bat(inn, "p1").balls === 0 && bat(inn, "p1").runs === 0);
    ok("...the bowler: the wide's run, a wide, and the wicket", bow(inn, "w1").runs === 1 && bow(inn, "w1").wides === 1 && bow(inn, "w1").wickets === 1);
    ok("...fall of wickets 1-1 at 0.0", inn.fow.length === 1 && inn.fow[0].runs === 1 && inn.fow[0].wickets === 1
       && inn.fow[0].batsman === "James Whitfield" && inn.fow[0].overs === "0.0", inn.fow);
    ok("...the striker's end is empty, the non-striker stays", inn.striker === null && inn.nonStriker === "p2");
    ok("...the server's fold agrees", agree);
  }

  // Hit wicket off a wide: the bowler's too.
  {
    const { inn } = both([...open(), ball({ type: W, value: 0, dismissal: "hit_wicket" })]);
    ok("hit wicket off a wide: a wicket, the bowler's", inn.wickets === 1 && bow(inn, "w1").wickets === 1
       && bat(inn, "p1").dismissal === "hit wicket b D Mkhize");
  }

  // Run out off a wide, one run completed, out at the bowler's end.
  {
    const { inn, agree } = both([...open(), ball({ type: W, value: 1, dismissal: "run_out", fielder: "L Govender", dismissed: "p1", outAt: "bowler_end" })]);
    ok("run out off a wide, one run completed: 1 wide + 1 run, all wides", inn.runs === 2 && inn.extras.wide === 2);
    ok("...a wicket, not the bowler's", inn.wickets === 1 && bow(inn, "w1").wickets === 0);
    ok("...the bowler is charged the wide and the run", bow(inn, "w1").runs === 2 && bow(inn, "w1").wides === 1);
    ok("...no ball of the over, no ball faced", inn.balls === 0 && bat(inn, "p1").balls === 0 && bat(inn, "p2").balls === 0);
    ok("...p1 run out", bat(inn, "p1").status === "out" && bat(inn, "p1").dismissal === "run out (L Govender)");
    ok("...fall of wickets 2-1 at 0.0", inn.fow.length === 1 && inn.fow[0].runs === 2 && inn.fow[0].overs === "0.0");
    ok("...out at the bowler's end: the survivor has crossed to the striker's", inn.striker === "p2" && inn.nonStriker === null);
    ok("...the server's fold agrees", agree);
  }

  // Obstructing the field off a wide: not the bowler's.
  {
    const { inn } = both([...open(), ball({ type: W, value: 0, dismissal: "obstructing_field" })]);
    ok("obstructing the field off a wide: a wicket, not the bowler's", inn.wickets === 1 && bow(inn, "w1").wickets === 0 && inn.runs === 1);
  }

  // Run out off a no-ball: two off the bat, then the non-striker out at the striker's end going for a third.
  {
    const log = [...open(), ball({ type: NB, value: 2, dismissal: "run_out", fielder: "K Botha", dismissed: "p2", outAt: "striker_end" })];
    const { inn, agree } = both(log);
    ok("run out off a no-ball with two run: 1 no-ball + 2", inn.runs === 3 && inn.extras.noBall === 1);
    ok("...the two off the bat are the striker's, and a no-ball is a ball he faced", bat(inn, "p1").runs === 2 && bat(inn, "p1").balls === 1);
    ok("...the run-out batter faced nothing", bat(inn, "p2").balls === 0 && bat(inn, "p2").status === "out");
    ok("...a wicket, not the bowler's; he is charged 3", inn.wickets === 1 && bow(inn, "w1").wickets === 0 && bow(inn, "w1").runs === 3 && bow(inn, "w1").noBalls === 1);
    ok("...no ball of the over", inn.balls === 0 && bow(inn, "w1").balls === 0);
    ok("...fall of wickets 3-1 at 0.0", inn.fow.length === 1 && inn.fow[0].runs === 3 && inn.fow[0].batsman === "T Bekker");
    ok("...out at the striker's end: the survivor is at the bowler's", inn.striker === null && inn.nonStriker === "p1");
    ok("...and the free hit still follows the no-ball", inn.freeHit === true);
    ok("...the server's fold agrees", agree);
    const next = deriveInnings([...log, batters({ striker: "p3" }), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]);
    ok("...so a bowled off the next ball does not stand", next.wickets === 1 && next.ballLog.at(-1)?.freeHitSaved === true);
  }

  // Run out off a no-ball whose runs were byes: the byes are not the striker's.
  {
    const { inn } = both([...open(), ball({ type: NB, value: 1, nbRuns: "byes", dismissal: "run_out", dismissed: "p1", outAt: "bowler_end" })]);
    ok("run out off a no-ball after a bye: 1 nb + 1 bye", inn.runs === 2 && inn.extras.noBall === 1 && inn.extras.bye === 1);
    ok("...the striker's: a ball faced, no run; the bowler's: the no-ball only", bat(inn, "p1").balls === 1 && bat(inn, "p1").runs === 0 && bow(inn, "w1").runs === 1);
  }

  // Hit the ball twice off a no-ball: a wicket, not the bowler's.
  {
    const { inn } = both([...open(), ball({ type: NB, value: 0, dismissal: "hit_twice" })]);
    ok("hit the ball twice off a no-ball: a wicket, not the bowler's, a ball faced", inn.wickets === 1 && bow(inn, "w1").wickets === 0
       && bat(inn, "p1").balls === 1 && bat(inn, "p1").dismissal === "hit the ball twice");
  }

  // The over's ball count is unchanged: six legal balls, whatever the extras wicket.
  {
    const dots = Array.from({ length: 5 }, () => runs(0));
    const log = [...open(), ...dots, ball({ type: W, value: 0, dismissal: "stumped" }), batters({ striker: "p3" })];
    const mid = deriveInnings(log);
    ok("five balls and a stumping off a wide: still 0.5, the bowler still on", mid.balls === 5 && mid.bowler === "w1" && fmtOvers(mid.balls) === "0.5");
    const end = deriveInnings([...log, runs(0)]);
    ok("...the sixth legal ball ends the over", end.balls === 6 && end.bowler === null && end.overLog[0].balls.length === 7);
    ok("...the bowler bowled six balls, and a wicket-maiden is not his: the wide is charged", bow(end, "w1").balls === 6 && bow(end, "w1").maidens === 0 && bow(end, "w1").wickets === 1);
  }

  // A stumping off a wide on a free hit is saved (only a no-ball's ways out stand on one); the free hit carries on.
  {
    const log = [...open(), ball({ type: NB, value: 0 }), ball({ type: W, value: 0, dismissal: "stumped" })];
    const inn = deriveInnings(log);
    ok("stumped off a wide on a free hit: saved, and the free hit carries on", inn.wickets === 0 && inn.ballLog.at(-1)?.freeHitSaved === true
       && inn.freeHit === true && bat(inn, "p1").status === "batting");
    const ro = deriveInnings([...open(), ball({ type: NB, value: 0 }), ball({ type: W, value: 0, dismissal: "run_out", dismissed: "p2" })]);
    ok("...a run out off a wide on a free hit stands", ro.wickets === 1 && bat(ro, "p2").status === "out");
  }

  // The keeper's stumping is his.
  {
    const inn = deriveInnings([...open(), keeper({ keeper: "w3" }), ball({ type: W, value: 0, dismissal: "stumped" })]);
    ok("a stumping off a wide is the keeper's", inn.keepers[0]?.stumpings === 1 && bat(inn, "p1").dismissal === "st L Govender b D Mkhize");
  }

  // Undo: a void of it, and the innings is as before it.
  {
    const w = ball({ id: "wx1", type: W, value: 1, dismissal: "run_out", dismissed: "p1", outAt: "bowler_end" });
    const inn = deriveInnings([...open(), w, voidEvent({ target: "wx1" })]);
    ok("a void of a wicket off a wide takes it all back", inn.wickets === 0 && inn.runs === 0 && inn.fow.length === 0 && inn.striker === "p1" && inn.nonStriker === "p2");
  }

  // The wire: the dismissal, the batter out and the end ride through toRow/fromRow.
  {
    const ev = { ...ball({ id: "nbx1", type: NB, value: 2, dismissal: "run_out", fielder: "K Botha", dismissed: "p2", outAt: "striker_end" }), innings: 0, seq: 4 };
    const back = /** @type {any} */ (fromRow(toRow(ev)));
    ok("the wire keeps a no-ball's run out", back.type === NB && back.dismissal === "run_out" && back.dismissed === "p2" && back.outAt === "striker_end" && back.value === 2);
  }

  // Refused: a method the Laws do not allow off that extra.
  {
    let threw = 0;
    for (const [type, how] of [[W, "bowled"], [W, "caught"], [W, "lbw"], [W, "hit_twice"], [W, "handled_ball"],
                               [NB, "bowled"], [NB, "caught"], [NB, "stumped"], [NB, "hit_wicket"], [NB, "lbw"]]) {
      try { ball({ type, dismissal: how }); } catch { threw++; }
    }
    ok("the constructor refuses bowled, caught, lbw, hit twice off a wide; bowled, caught, stumped, hit wicket, lbw off a no-ball", threw === 10, threw);
    // A row the Laws refuse that the table may still hold (an old build):
    // no wicket, as every fold before read it.
    const odd = /** @type {LogEvent} */ ({ ...ball({ type: W, value: 0 }), dismissal: "bowled" });
    const inn = deriveInnings([...open(), odd]);
    ok("...and a stored wide that says bowled is a wide, no wicket", inn.wickets === 0 && inn.runs === 1 && bat(inn, "p1").status === "batting");
  }
}

console.log(`\n${"─".repeat(52)}\nSCORING SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

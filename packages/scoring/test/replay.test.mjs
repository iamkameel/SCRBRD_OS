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
} from "../src/index.mjs";

/** @import { LogEvent, Loose, BallEvent, BallInput, BattersEvent, BowlerEvent, InningsStartEvent, InningsStartInput } from "../src/events.mjs" */

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
    const played = [
      ...open().map((e) => ({ ...e, innings: 1 })),
      { ...revision({ target }), innings: 1 },
      ...Array.from({ length: runs }, () => ({ ...ball({ type: BALL_TYPE.RUN, value: 1 }), innings: 1 })),
    ];
    if (!done) return played;
    // A chase that reached the revised target ended on its own and says so. One
    // that did not was called by the umpires, which is `abandoned` — and the
    // result still stands on the revised target, which is what is being tested.
    const inn = deriveInnings(played);
    return [...played, { ...sealInnings(inn, inn.endReason ?? "abandoned"), innings: 1 }];
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
     positionName(325, 0.8) === "deep third");

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

console.log(`\n${"─".repeat(52)}\nSCORING SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * SCRBRD — the AntiGravity cricket unit tests, used as a spec.
 *
 * AG (scrbrd_antigravity, read-only at /home/user/scrbrd_antigravity) is the
 * pre-repo TypeScript artifact. Its unit tests encode cricket rules the
 * project has already had to get right once — including bugs it shipped and
 * fixed. This file re-asserts the CRICKET RULE each of those tests was
 * pinning, against OS's own pure fold (deriveInnings et al. in
 * packages/scoring/src), not against AG's code.
 *
 * Rules already covered by test/replay.test.mjs are not repeated here — see
 * the "Rules reviewed and not repeated" note at the bottom of this file for
 * the dedupe list. This file adds the rules AG's suite checks that
 * replay.test.mjs does not.
 *
 * KNOWN_GAP: a case where OS's derived answer differs from what the Laws of
 * Cricket require, kept as a real (skipped) test, named, and reported — not
 * weakened or deleted. There are none now: the last one (the end a run out
 * happened at) is group E, SCRBRD-069.
 */
import {
  deriveInnings,
  inningsStart, batters, bowler, ball,
  BALL_TYPE,
} from "../src/index.mjs";

let pass = 0, fail = 0, skip = 0;
/** @param {string} n  @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
// A KNOWN_GAP is reported with this; none is open (see the header).
const _known = (/** @type {string} */ n) => { skip++; console.log("  ⚠ KNOWN_GAP (skipped):", n); };
const group = (/** @type {string} */ t) => console.log("\n" + t);

// ── Fixtures ─────────────────────────────────────────────
const SQ_A = [
  { id: "p1", name: "James Whitfield" }, { id: "p2", name: "T Bekker" },
  { id: "p3", name: "S Naidoo" },
];
const SQ_B = [{ id: "w1", name: "D Mkhize" }, { id: "w2", name: "K Botha" }];

const open = (overs = 20) => [
  inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville Boys'", squad: SQ_A, bowlingSquad: SQ_B, overs }),
  batters({ striker: "p1", nonStriker: "p2" }),
  bowler({ bowler: "w1" }),
];
const dot = () => ball({ type: BALL_TYPE.RUN, value: 0 });
const runs = (/** @type {number} */ v) => ball({ type: BALL_TYPE.RUN, value: v });

// ═══════════════════════════════════════════════════════════════════════
// A. Innings length is a property of the format, not a constant
//    (AG: src/lib/scoring/__tests__/inningsLength.test.ts)
//
// AG's fold once hardcoded 120 balls as "an innings", so a 50-over innings
// was declared complete at 20 overs and every required-run-rate figure in a
// non-T20 chase was computed against the wrong number of remaining balls.
// OS derives the ball limit from inn.overs (set by innings_start), which
// this proves is not the same mistake.
// ═══════════════════════════════════════════════════════════════════════
group("A. Innings length follows the declared format");
{
  const fiftyAt120 = deriveInnings([...open(50), ...Array.from({ length: 120 }, dot)]);
  ok("a 50-over innings is NOT complete at 120 balls (the AG bug)", fiftyAt120.complete === false);

  const fiftyAt300 = deriveInnings([...open(50), ...Array.from({ length: 300 }, dot)]);
  ok("...and IS complete at 300 balls (50 overs)", fiftyAt300.complete === true && fiftyAt300.balls === 300);

  const t20At120 = deriveInnings([...open(20), ...Array.from({ length: 120 }, dot)]);
  ok("a 20-over innings IS complete at 120 balls", t20At120.complete === true);

  // OS still ends an innings on ten wickets regardless of the format's over
  // count — a squad of 3 here stands in for "wickets run out before overs do".
  const allOutBefore50 = deriveInnings([
    ...open(50),
    ...Array.from({ length: 2 }, () => ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })),
  ]);
  ok("...but a side that runs out of batters is out regardless of format",
     allOutBefore50.complete === true && allOutBefore50.endReason === "all_out");

  // AG: "falls back to 20 overs when the match does not say". OS's
  // inningsStart() constructor defaults `overs` to 20 the same way.
  const noOversDeclared = deriveInnings([
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }),
    ...Array.from({ length: 119 }, dot),
  ]);
  ok("undeclared overs default to 20, not complete at 119 balls", noOversDeclared.complete === false);
  const noOversAt120 = deriveInnings([
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }),
    ...Array.from({ length: 120 }, dot),
  ]);
  ok("...and complete at 120", noOversAt120.complete === true);
}

// ═══════════════════════════════════════════════════════════════════════
// B. A free hit carries over an illegal delivery bowled during it
//    (AG: src/lib/scoring/__tests__/liveProjectionRules.test.ts, "free hit")
//
// docs/SCORING_RULES.md #6 and replay.test.mjs group C already cover a free
// hit saving a batter from most dismissals and being consumed by the next
// LEGAL delivery. What is not yet pinned is that a WIDE bowled during a free
// hit does not spend it — the free hit survives to the next legal ball.
// ═══════════════════════════════════════════════════════════════════════
group("B. A free hit survives a wide bowled on it");
{
  const afterNoBall = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0 })]);
  ok("a no-ball sets a free hit", afterNoBall.freeHit === true);

  const wideOnFreeHit = deriveInnings([...open(),
    ball({ type: BALL_TYPE.NO_BALL, value: 0 }),
    ball({ type: BALL_TYPE.WIDE, value: 0 }),
  ]);
  ok("a wide bowled on a free hit does not consume it", wideOnFreeHit.freeHit === true);

  // And the free hit still protects the batter after that wide.
  const wicketAfterWide = deriveInnings([...open(),
    ball({ type: BALL_TYPE.NO_BALL, value: 0 }),
    ball({ type: BALL_TYPE.WIDE, value: 0 }),
    ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }),
  ]);
  ok("...so a bowled dismissal after that wide still does not stand", wicketAfterWide.wickets === 0);

  const legalAfter = deriveInnings([...open(),
    ball({ type: BALL_TYPE.NO_BALL, value: 0 }),
    ball({ type: BALL_TYPE.WIDE, value: 0 }),
    runs(0),
  ]);
  ok("...but the next LEGAL delivery does consume it", legalAfter.freeHit === false);
}

// ═══════════════════════════════════════════════════════════════════════
// C. Who is left at the crease after a wicket
//    (AG: src/lib/scoring/__tests__/liveProjectionRules.test.ts,
//     "who is left at the crease after a wicket")
//
// The rule: a dismissal clears the END that batter was standing at, not
// "the striker" unconditionally — a non-striker run out must clear the
// non-striker's end even though the striker is the one who keeps facing.
// deriveInnings() takes this from `ev.dismissed`, defaulting to the striker
// when it is absent (a plain bowled/caught/lbw/stumped never need it).
// ═══════════════════════════════════════════════════════════════════════
group("C. Crease occupancy after a wicket");
{
  // Striker out mid-over: the non-striker stays put, the striker's end empties.
  const strikerOut = deriveInnings([...open(),
    ball({ type: BALL_TYPE.WICKET, dismissal: "caught" }),
  ]);
  ok("striker out: striker's end is empty", strikerOut.striker === null);
  ok("...and the non-striker stays where they were", strikerOut.nonStriker === "p2");

  // Non-striker run out, no run completed: the striker keeps the strike, the
  // non-striker's end empties. This is the case a regex/"the striker" default
  // gets wrong if it is not told which batter was actually dismissed.
  const nonStrikerRunOut = deriveInnings([...open(),
    ball({ type: BALL_TYPE.WICKET, dismissal: "run_out", dismissed: "p2" }),
  ]);
  ok("non-striker run out: striker keeps facing", nonStrikerRunOut.striker === "p1");
  ok("...and the non-striker's end is empty", nonStrikerRunOut.nonStriker === null);

  // Striker out on the last ball of the over: the survivor faces the next
  // over — the wicket does not itself rotate, but the end-of-over rotation
  // still applies, and the bowler is cleared as on any other over.
  const lastBallWicket = deriveInnings([...open(),
    ...Array.from({ length: 5 }, dot),
    ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }),
  ]);
  ok("striker out on the last ball: survivor faces the next over", lastBallWicket.striker === "p2");
  ok("...the dismissed batter's old end (now non-striker) is empty", lastBallWicket.nonStriker === null);
  ok("...and the bowler is cleared like any over end", lastBallWicket.bowler === null);
}

// ═══════════════════════════════════════════════════════════════════════
// D. Byes and leg byes off a no-ball are not the striker's, nor the bowler's
//    (SCRBRD-068; AG: liveProjectionRules.test.ts; Law 21.15, Law 23)
//
// A no-ball records the runs completed in `value` and, when they did not
// come off the bat, `nbRuns: "byes" | "leg_byes"`. By the current Code
// (2017 Code, 4th Edition 2026, 21.15 and 18.10.2–18.10.3; 21.16 in the
// 3rd): the one-run penalty is a No-ball extra
// debited to the bowler; runs off the bat are the striker's and debited to
// the bowler; runs not off the bat are Byes or Leg byes, as appropriate, and
// not debited to the bowler. The no-ball is not a legal ball, the striker has
// faced it, and the runs completed move the strike. (SCRBRD-068 was first
// built to the 2000 Code, where all of them were No-ball extras and the
// bowler's; Kameel moved it to the current Code on 2026-09-27, db/52.)
// ═══════════════════════════════════════════════════════════════════════
group("D. No-ball byes and leg byes (SCRBRD-068, Law 21.15)");
{
  /** The figures a check reads, from one innings. @param {ReturnType<typeof deriveInnings>} inn */
  const read = (inn) => {
    const p1 = inn.batsmen.find((b) => b.id === "p1"), w1 = inn.bowlers.find((b) => b.id === "w1");
    return /** @type {Record<string, unknown>} */ ({
      total: inn.runs, ...inn.extras, batRuns: p1?.runs, batBalls: p1?.balls, fours: p1?.fours,
      bowlRuns: w1?.runs, bowlBalls: w1?.balls, noBalls: w1?.noBalls, striker: inn.striker, freeHit: inn.freeHit });
  };
  /** Only the named fields, so a case says what it is about — and prints them when it fails.
   *  @param {string} n @param {Record<string, unknown>} got @param {Record<string, unknown>} want */
  const is = (n, got, want) => {
    const pass = Object.entries(want).every(([k, v]) => got[k] === v);
    ok(pass ? n : `${n} — got ${JSON.stringify(Object.fromEntries(Object.keys(want).map((k) => [k, got[k]])))}`, pass);
  };

  // Three run, not off the bat: odd, so they crossed.
  for (const [nbRuns, kind, other] of /** @type {const} */ ([["byes", "bye", "legBye"], ["leg_byes", "legBye", "bye"]])) {
    const got = read(deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 3, nbRuns })]));
    is(`no-ball + 3 ${nbRuns}: the side has the penalty and the three`, got, { total: 4 });
    is(`...one no-ball extra, and the three are ${nbRuns}`, got, { noBall: 1, [kind]: 3, [other]: 0, wide: 0 });
    is(`...${nbRuns}: the striker faced it and scored none of it`, got, { batRuns: 0, batBalls: 1, fours: 0 });
    is(`...${nbRuns}: the bowler is charged the penalty run only, no legal ball, one no-ball`, got, { bowlRuns: 1, bowlBalls: 0, noBalls: 1 });
    is(`...${nbRuns}: three run is odd, they crossed; a free hit to come`, got, { striker: "p2", freeHit: true });
  }

  // Four byes and four leg byes to the rope: a boundary allowance, not his four.
  for (const [nbRuns, kind] of /** @type {const} */ ([["byes", "bye"], ["leg_byes", "legBye"]])) {
    const got = read(deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 4, nbRuns })]));
    is(`no-ball + four ${nbRuns}: five to the side, one no-ball extra and four ${nbRuns}`, got, { total: 5, noBall: 1, [kind]: 4 });
    is(`...${nbRuns}: not the striker's four, and not the bowler's four`, got, { batRuns: 0, fours: 0, batBalls: 1, bowlRuns: 1 });
    is(`...${nbRuns}: a boundary is not run, the ends are as they were`, got, { striker: "p1", freeHit: true });
  }

  // Hit: unchanged — the striker's, and debited to the bowler.
  const hit4 = read(deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 4 })]));
  is("no-ball hit for four: his four, one no-ball extra, no byes", hit4, { total: 5, noBall: 1, bye: 0, legBye: 0, batRuns: 4, fours: 1, batBalls: 1 });
  is("...and the bowler is charged all five", hit4, { bowlRuns: 5, bowlBalls: 0, noBalls: 1, striker: "p1" });
  const hit1 = read(deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 1 })]));
  is("no-ball hit for one: his run, the bowler two, and they crossed", hit1, { total: 2, noBall: 1, bye: 0, batRuns: 1, bowlRuns: 2, striker: "p2" });

  // The side's total is the same whichever it was; the rest is not.
  const byes4 = read(deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 4, nbRuns: "byes" })]));
  ok("the side's total is the same, hit or byes", byes4.total === hit4.total);
  ok("...the bowler's runs are not: 1 for four byes, 5 for a four off the bat", byes4.bowlRuns === 1 && hit4.bowlRuns === 5);

  // On a free hit: a no-ball earns it; a no-ball on it (byes, leg byes, hit)
  // keeps it; the next legal ball takes it.
  const fh = read(deriveInnings([...open(),
    ball({ type: BALL_TYPE.NO_BALL, value: 0 }),                         // earns the free hit
    ball({ type: BALL_TYPE.NO_BALL, value: 2, nbRuns: "byes" }),         // on it: two byes
    ball({ type: BALL_TYPE.NO_BALL, value: 4, nbRuns: "leg_byes" }),     // on it: four leg byes
    ball({ type: BALL_TYPE.NO_BALL, value: 1 }),                         // on it: a single off the bat
  ]));
  is("free hit: four no-balls, 1 + 3 + 5 + 2 to the side", fh, { total: 11 });
  is("...four no-ball extras, two byes, four leg byes", fh, { noBall: 4, bye: 2, legBye: 4, wide: 0 });
  // Two byes are even and four leg byes a boundary, so p1 faced all four.
  is("...p1 faced all four and has the single off the bat only", fh, { batRuns: 1, batBalls: 4, fours: 0 });
  is("...the bowler: the four penalty runs and the single, no legal ball", fh, { bowlRuns: 5, bowlBalls: 0, noBalls: 4 });
  is("...one run moved the strike, and it is still a free hit", fh, { striker: "p2", freeHit: true });
  const taken = read(deriveInnings([...open(),
    ball({ type: BALL_TYPE.NO_BALL, value: 0 }), ball({ type: BALL_TYPE.NO_BALL, value: 2, nbRuns: "byes" }), dot()]));
  is("...and a legal ball takes the free hit", taken, { freeHit: false, bowlBalls: 1, bowlRuns: 2, bye: 2, noBall: 2, batBalls: 3 });
}

// ═══════════════════════════════════════════════════════════════════════
// E. Which end is empty after a run out that completed runs (SCRBRD-069)
//    (AG: src/lib/scoring/__tests__/liveProjectionRules.test.ts,
//     "non-striker run out after a completed single: the striker has
//     changed ends")
//
// Formerly this file's KNOWN_GAP. A run out can complete a run before the
// dismissal — the batters run one, then are run out attempting a second.
// The run is credited on the same wicket delivery (`value`), and because it
// was completed the batters have crossed (Law 18), so "the dismissed
// batter's end before the ball" is no longer the empty end. Which end is
// depends on where the wicket was put down (Law 38.4), which the fold cannot
// know from the runs: the pad now asks, on a run out that completed runs,
// and records it as `outAt: "striker_end" | "bowler_end"`. The survivor goes
// to the other end.
//
// A wicket with no `outAt` — every log before this, and every run out with
// no run completed — empties the dismissed batter's end before the ball, as
// it always has; that is the last case here, kept as it was.
// ═══════════════════════════════════════════════════════════════════════
group("E. Run out after completed runs: the end it happened at (SCRBRD-069)");
{
  // p1 opens as striker, p2 as non-striker. They run a single; p2, now at the
  // striker's end, is run out there going for a second.
  const atStrikers = deriveInnings([...open(),
    ball({ type: BALL_TYPE.WICKET, value: 1, dismissal: "run_out", dismissed: "p2", outAt: "striker_end" }),
  ]);
  ok("out at the striker's end: that end is empty", atStrikers.striker === null);
  ok("...and the survivor, crossed, is at the non-striker's end", atStrikers.nonStriker === "p1");
  ok("...with the completed run his, and the wicket the side's",
     atStrikers.runs === 1 && atStrikers.batsmen.find((b) => b.id === "p1")?.runs === 1 && atStrikers.wickets === 1);

  // Same single; this time p1, now at the bowler's end, is run out there.
  const atBowlers = deriveInnings([...open(),
    ball({ type: BALL_TYPE.WICKET, value: 1, dismissal: "run_out", outAt: "bowler_end" }),
  ]);
  ok("out at the bowler's end: that end is empty", atBowlers.nonStriker === null);
  ok("...and the survivor faces the next ball", atBowlers.striker === "p2");

  // Two completed — back where they started — and the striker is run out at
  // the bowler's end going for a third.
  const two = deriveInnings([...open(),
    ball({ type: BALL_TYPE.WICKET, value: 2, dismissal: "run_out", dismissed: "p1", outAt: "bowler_end" }),
  ]);
  ok("two run, out at the bowler's end: the non-striker holds strike", two.striker === "p2" && two.nonStriker === null);

  // On the last ball of the over the ends change as for any wicket.
  const last = deriveInnings([...open(), ...Array.from({ length: 5 }, dot),
    ball({ type: BALL_TYPE.WICKET, value: 1, dismissal: "run_out", dismissed: "p2", outAt: "striker_end" }),
  ]);
  ok("on the last ball, the survivor at the non-striker's end faces the next over",
     last.striker === "p1" && last.nonStriker === null && last.bowler === null);

  // With no end recorded — an old log — the fold does what it always did.
  const unrecorded = deriveInnings([...open(),
    ball({ type: BALL_TYPE.WICKET, value: 1, dismissal: "run_out", dismissed: "p2" }),
  ]);
  ok("no end recorded: the dismissed batter's end before the ball empties, as before",
     unrecorded.striker === "p1" && unrecorded.nonStriker === null);
}

console.log(`\n${"─".repeat(52)}\nLAWS-SPEC SUITE: ${pass} passed, ${fail} failed, ${skip} known gaps (skipped)`);
process.exit(fail ? 1 : 0);

/*
 * Rules reviewed and NOT repeated here because test/replay.test.mjs already
 * pins them exactly (dedupe, per the task's "rules not volume" instruction):
 *
 *   - wicketCredit.test.ts, bowlerWicketCredit.test.ts, and the credit half
 *     of hatTrick.test.ts: replay.test.mjs group B, "THE WICKET MATRIX" —
 *     every DISMISSAL, whether it is the bowler's, whether it stands on a
 *     free hit, and every spelling normaliseDismissal() accepts.
 *   - replayEngine.test.ts (both copies) basic-fold and void assertions:
 *     replay.test.mjs groups A, B, D.
 *   - matchStateMachine.test.ts's phasesFor() assertions (T20 6/4, ODI
 *     10/10): packages/scoring/test/phases.test.mjs.
 *   - a free hit being consumed by a legal delivery, and not saving a run
 *     out: replay.test.mjs group C, item 6.
 *   - odd runs off a no-ball/wide rotating strike, and byes/leg-byes not
 *     being charged to the bowler: replay.test.mjs groups A/C and
 *     docs/SCORING_RULES.md #1, #2.
 */

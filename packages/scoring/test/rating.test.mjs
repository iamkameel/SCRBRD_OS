/**
 * The rating maths, and the cases that would embarrass the platform.
 *
 * Most of these are about REFUSING to produce a number. A rating that appears
 * next to a fifteen-year-old's name at a parents' evening has to be defensible,
 * and the fastest way to lose that argument is a 100 earned off one delivery.
 */
import {
  ANCHORS, scoreFrom, battingIndex, bowlingIndex, coachIndex, composite,
  MIN_BALLS_FACED, MIN_BALLS_BOWLED, DERIVABLE_CATEGORIES, COACH_ONLY_CATEGORIES,
} from "../src/rating.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

// ── A. Interpolation ─────────────────────────────────────
group("A. Anchors interpolate, in both directions");
ok("an anchor point returns its own score", scoreFrom(ANCHORS.battingAverage, 30) === 65);
ok("between anchors it interpolates",
   scoreFrom(ANCHORS.battingAverage, 40) > 65 && scoreFrom(ANCHORS.battingAverage, 40) < 90);
ok("below the bottom anchor it clamps", scoreFrom(ANCHORS.battingAverage, -5) === 0);
ok("above the top anchor it clamps", scoreFrom(ANCHORS.battingAverage, 200) === 100);
// Economy descends: LOWER is better, and the same function has to cope.
ok("a descending table scores low values high", scoreFrom(ANCHORS.bowlingEconomy, 4.5) === 100);
ok("...and high values low", scoreFrom(ANCHORS.bowlingEconomy, 12) === 5);
ok("...monotonically in between",
   scoreFrom(ANCHORS.bowlingEconomy, 5) > scoreFrom(ANCHORS.bowlingEconomy, 8));
ok("a missing statistic scores nothing, not zero", scoreFrom(ANCHORS.battingAverage, null) === null);

// ── B. The sample floor ──────────────────────────────────
group("B. A number nobody has earned is not produced");
{
  const oneBallSix = battingIndex({ runs: 6, ballsFaced: 1, dismissals: 0 });
  ok("one ball for six is refused, not rated 100", oneBallSix.value === null);
  ok("...and says why", /1 balls faced/.test(oneBallSix.reason));
  ok("just below the floor is still refused",
     battingIndex({ runs: 40, ballsFaced: MIN_BALLS_FACED - 1, dismissals: 1 }).value === null);
  ok("at the floor a number appears",
     battingIndex({ runs: 40, ballsFaced: MIN_BALLS_FACED, dismissals: 1 }).value !== null);

  ok("one over for none is refused",
     bowlingIndex({ runsConceded: 4, ballsBowled: 6, wickets: 0 }).value === null);
  ok("at the bowling floor a number appears",
     bowlingIndex({ runsConceded: 40, ballsBowled: MIN_BALLS_BOWLED, wickets: 2 }).value !== null);
}

// ── C. Undefined is not zero ─────────────────────────────
group("C. Undefined statistics stay undefined");
{
  const neverOut = battingIndex({ runs: 120, ballsFaced: 90, dismissals: 0 });
  ok("a batter never dismissed still gets an index", neverOut.value !== null);
  ok("...with no average, rather than runs divided by zero", neverOut.parts.average === null);
  ok("...leaning on strike rate, and saying so", /strike rate only/.test(neverOut.reason));
  ok("...at reduced confidence", neverOut.confidence === "low");

  const noWickets = bowlingIndex({ runsConceded: 30, ballsBowled: 60, wickets: 0 });
  ok("a tight wicketless spell is not a failure", noWickets.value > 50);
  ok("...with no bowling strike rate", noWickets.parts.strikeRate === null);

  // Economy is the one where getting the direction wrong is invisible: both
  // produce a number, and only one of them is right.
  const tight = bowlingIndex({ runsConceded: 30, ballsBowled: 60, wickets: 2 });
  const loose = bowlingIndex({ runsConceded: 90, ballsBowled: 60, wickets: 2 });
  ok("conceding fewer runs scores higher", tight.value > loose.value);
}

// ── D. Confidence rises with the sample ──────────────────
group("D. Confidence is reported, not implied");
ok("a thin sample is low confidence",
   battingIndex({ runs: 45, ballsFaced: 30, dismissals: 1 }).confidence === "low");
ok("a season's batting is good confidence",
   battingIndex({ runs: 600, ballsFaced: 500, dismissals: 15 }).confidence === "good");
ok("below the floor there is no confidence at all",
   battingIndex({ runs: 6, ballsFaced: 2, dismissals: 0 }).confidence === "none");

// ── E. The working is returned ───────────────────────────
group("E. Every score can show where it came from");
{
  const b = battingIndex({ runs: 450, ballsFaced: 360, dismissals: 12 });
  ok("the average is reported", b.parts.average === 37.5);
  ok("the strike rate is reported", b.parts.strikeRate === 125);
  ok("both component scores are reported",
     Number.isFinite(b.parts.averageScore) && Number.isFinite(b.parts.strikeRateScore));
  ok("the weighting is reported, not hidden", b.parts.averageWeight === 0.6);
  ok("the index sits between its two components",
     b.value >= Math.min(b.parts.averageScore, b.parts.strikeRateScore) &&
     b.value <= Math.max(b.parts.averageScore, b.parts.strikeRateScore));
}

// ── F. The composite never invents a half ────────────────
group("F. A missing half is never a zero");
{
  const both = composite({ coach: 80, performance: 60 });
  ok("both halves blend by the stated weight", both.value === 72);
  ok("...and both halves are still visible",
     both.coach === 80 && both.performance === 60 && both.basis === "both");

  const coachOnly = composite({ coach: 80 });
  ok("with no performance index the composite IS the assessment", coachOnly.value === 80);
  ok("...and says the index is missing rather than scoring it zero",
     coachOnly.basis === "coach" && /not enough match data/i.test(coachOnly.explanation));

  const perfOnly = composite({ performance: 55 });
  ok("with no assessment the composite IS the index", perfOnly.value === 55);
  ok("...and says no coach has assessed them",
     perfOnly.basis === "performance" && /no coach assessment/i.test(perfOnly.explanation));

  const neither = composite({});
  ok("with neither, there is no rating at all", neither.value === null);
  ok("...which is a statement, not a blank", neither.basis === "none" && !!neither.explanation);

  // The failure this guards: averaging 80 with an absent half would read 40,
  // and every unassessed player in the school would look half as good as they
  // are on a screen a parent can see.
  ok("an unassessed player is not halved", composite({ performance: 80 }).value === 80);
}

// ── G. The coach's own number ────────────────────────────
group("G. The coach's number");
ok("a category with no assessment scores null, not zero",
   coachIndex({}).value === null);
ok("a category averages its metrics",
   coachIndex({ technique: 80, power: 70, footwork: 90 }).value === 80);
ok("...and reports how many it averaged",
   coachIndex({ technique: 80, power: 70 }).metrics === 2);

// ── H. What the ball log cannot say ──────────────────────
group("H. Fielding and fitness are not derived");
ok("only batting and bowling are derivable",
   DERIVABLE_CATEGORIES.join(",") === "batting,bowling");
ok("fielding and fitness are coach-only",
   COACH_ONLY_CATEGORIES.includes("fielding") && COACH_ONLY_CATEGORIES.includes("fitness"));
ok("...and no index function pretends otherwise",
   typeof globalThis.fieldingIndex === "undefined");

console.log(`\n${"─".repeat(52)}\nRATING SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

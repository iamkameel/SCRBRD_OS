/**
 * The rating maths, and the cases that would embarrass the platform.
 *
 * Most of these are about REFUSING to produce a number. A rating that appears
 * next to a fifteen-year-old's name at a parents' evening has to be defensible,
 * and the fastest way to lose that argument is a 100 earned off one delivery.
 */
import {
  STAT_ANCHORS, scoreFrom, battingIndex, bowlingIndex, coachIndex, adjustedRating, COACH_PRIOR_BALLS,
  MIN_BALLS_FACED, MIN_BALLS_BOWLED,
} from "../src/rating.mjs";
import {
  DISCIPLINES, DERIVABLE_DISCIPLINES, COACH_ONLY_DISCIPLINES, allSkills,
} from "../src/rubric.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

// ── A. Interpolation ─────────────────────────────────────
group("A0. Every calibration point is on the 1-20 scale");
for (const [name, table] of Object.entries(STAT_ANCHORS))
  ok(`${name} scores within 1-20`, table.every(([, score]) => score >= 1 && score <= 20));
// The two halves of a rating are compared and adjusted against each other, so
// a performance index on a different scale from a coach's assessment is not a
// rating, it is a category error with a number on it.
ok("the index tops out where the coach's scale does",
   Math.max(...Object.values(STAT_ANCHORS).flat().map(([, v]) => v)) === 20);

group("A. Anchors interpolate, in both directions");
ok("an anchor point returns its own score", scoreFrom(STAT_ANCHORS.battingAverage, 30) === 13);
ok("between anchors it interpolates",
   scoreFrom(STAT_ANCHORS.battingAverage, 40) > 13 && scoreFrom(STAT_ANCHORS.battingAverage, 40) < 18);
ok("below the bottom anchor it clamps", scoreFrom(STAT_ANCHORS.battingAverage, -5) === 1);
ok("above the top anchor it clamps", scoreFrom(STAT_ANCHORS.battingAverage, 200) === 20);
// Economy descends: LOWER is better, and the same function has to cope.
ok("a descending table scores low values high", scoreFrom(STAT_ANCHORS.bowlingEconomy, 4.5) === 20);
ok("...and high values low", scoreFrom(STAT_ANCHORS.bowlingEconomy, 12) === 1);
ok("...monotonically in between",
   scoreFrom(STAT_ANCHORS.bowlingEconomy, 5) > scoreFrom(STAT_ANCHORS.bowlingEconomy, 8));
ok("a missing statistic scores nothing, not zero", scoreFrom(STAT_ANCHORS.battingAverage, null) === null);

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
  // Three an over and no wickets. On the 1-20 scale that is not "average with
  // nothing to show for it" — it is excellent bowling that happened not to
  // take a wicket, and the index must say so.
  ok("a tight wicketless spell is not a failure", noWickets.value > 10);
  ok("...it is excellent bowling", noWickets.value >= 16);
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

// ── F. A missing half is never a zero ────────────────────
group("F. A missing half is never a zero");
{
  const coachOnly = adjustedRating({ coach: 16, sample: 400 });
  ok("with no performance index the rating IS the assessment", coachOnly.value === 16);
  ok("...unmoved, however much cricket has been played",
     coachOnly.drift === 0 && coachOnly.performanceWeight === 0);
  ok("...and says the index is missing rather than scoring it zero",
     coachOnly.basis === "coach" && /not enough match data/i.test(coachOnly.explanation));

  const perfOnly = adjustedRating({ performance: 11, sample: 400 });
  ok("with no assessment the rating IS the index", perfOnly.value === 11);
  ok("...and says there is no anchor",
     perfOnly.basis === "performance" && /no coach assessment/i.test(perfOnly.explanation));
  ok("...and reports no drift, because there is nothing to have drifted FROM",
     perfOnly.drift === null);

  const neither = adjustedRating({});
  ok("with neither, there is no rating at all", neither.value === null);
  ok("...which is a statement, not a blank", neither.basis === "none" && !!neither.explanation);

  // The failure this guards: averaging 80 with an absent half would read 40,
  // and every unassessed player in the school would look half as good as they
  // are on a screen a parent can see.
  ok("an unassessed player is not halved",
     adjustedRating({ performance: 17, sample: 200 }).value === 17);
}

// ── F2. The rating self-adjusts away from the coach's anchor ──
//
// The coach's assessment is the STARTING POSITION, not half of an average.
// Evidence moves the rating away from it, and how far depends on how much
// evidence there is — thirty balls barely says anything, five hundred says a
// great deal. A fixed-weight blend gets both ends wrong: it lets four innings
// drag a considered assessment down by 40% of the gap, and it stops a season
// of evidence from ever fully answering back.
group("F2. The coach anchors it; the ball log moves it");
{
  const anchored = (sample) => adjustedRating({ coach: 16, performance: 11, sample });

  ok("with no match data the rating IS the coach's number", anchored(0).value === 16);
  ok("...and nothing has moved", anchored(0).drift === 0);

  // Monotonic: every additional delivery moves it further, and always towards
  // the evidence rather than past it.
  const curve = [0, 30, 80, 120, 240, 500].map((n) => anchored(n).value);
  ok("more evidence moves it further",
     curve.every((v, i) => i === 0 || v < curve[i - 1]));
  ok("...always towards the index, never past it",
     curve.every((v) => v <= 16 && v > 11));
  // The weight approaches 1 and never arrives — a coach's judgement is never
  // worth literally nothing. The VALUE does converge, because it is rounded to
  // one decimal, so the invariant is asserted where it actually lives.
  ok("evidence never takes the whole weight", anchored(100000).performanceWeight < 1);
  ok("...though at that sample the rating has converged on the index for display",
     anchored(100000).value === 11);

  // The direction follows the evidence, not the coach.
  const up = adjustedRating({ coach: 8, performance: 17, sample: 240 });
  ok("a player who outperforms the eye test is moved UP", up.drift > 0 && up.value > 8);
  ok("...and the coach's original number is still there to compare against",
     up.coach === 8);
  ok("...and the explanation says which way and by how much",
     /moved it up/.test(up.explanation) && up.explanation.includes("8"));

  // Continuity with the fixed 60/40 blend this replaced: at 80 balls faced the
  // new model reproduces the old number exactly. The point is that adopting it
  // does not lurch a whole school's ratings on day one — it stops freezing
  // them at one weight.
  ok("at 80 deliveries it matches the fixed 60/40 blend it replaced",
     anchored(80).value === Math.round((16 * 0.6 + 11 * 0.4) * 10) / 10);
  ok("...but a bigger sample goes further than 60/40 ever could",
     anchored(500).value < 16 * 0.6 + 11 * 0.4);
  ok("...and a smaller one does not go nearly as far",
     anchored(30).value > 16 * 0.6 + 11 * 0.4);

  ok("the two are level at the prior", anchored(COACH_PRIOR_BALLS).performanceWeight === 0.5);
  // The knob, at both extremes.
  ok("a prior of zero makes the assessment decoration",
     adjustedRating({ coach: 16, performance: 11, sample: 1, priorBalls: 0 }).value === 11);
  ok("a huge prior pins the rating to the coach",
     adjustedRating({ coach: 16, performance: 11, sample: 100, priorBalls: 1e6 }).value === 16);

  // A coach whose eye matches the record is told so, rather than shown a
  // number that moved for no reason.
  const agree = adjustedRating({ coach: 13, performance: 13, sample: 300 });
  ok("when the log agrees with the coach, nothing moves", agree.drift === 0);
  ok("...and it says so", /agree/.test(agree.explanation));
}

// ── G. The coach's own number ────────────────────────────
group("G. The coach's number");
ok("a category with no assessment scores null, not zero",
   coachIndex({}).value === null);
ok("a category averages its metrics",
   coachIndex({ timing: 16, power: 14, footwork: 18 }).value === 16);
ok("...and reports how many it averaged",
   coachIndex({ timing: 16, power: 14 }).metrics === 2);

// ── H. What the ball log cannot say ──────────────────────
group("H. Fielding and keeping are not derived");
// The lists live in rubric.mjs, beside the attributes they are defined over,
// and are deliberately NOT re-exported from rating.mjs: the package index
// star-exports both files, and ESM drops a name exported twice rather than
// reporting it — so the import would just be undefined at the first call site.
ok("only batting and bowling are derivable",
   DERIVABLE_DISCIPLINES.join(",") === "batting,bowling");
ok("fielding and keeping are coach-only",
   COACH_ONLY_DISCIPLINES.includes("fielding") && COACH_ONLY_DISCIPLINES.includes("keeping"));
ok("...and no index function pretends otherwise",
   typeof globalThis.fieldingIndex === "undefined");
// Every discipline is defined over attributes that actually exist. A typo here
// produces a coach index quietly averaging fewer attributes than it claims.
{
  const all = new Set(allSkills());
  for (const [d, attrs] of Object.entries(DISCIPLINES))
    ok(`${d} draws only on attributes in the tree`, attrs.every((a) => all.has(a)));
  ok("leadership belongs to no discipline, and that is correct",
     !Object.values(DISCIPLINES).flat().includes("mental.leadership"));
}

console.log(`\n${"─".repeat(52)}\nRATING SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

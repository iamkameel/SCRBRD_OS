/**
 * Phases of an innings.
 *
 * THE LOAD-BEARING ASSERTION is that the phases add up to the innings. A phase
 * breakdown that disagrees with the scorecard beside it is worse than no
 * breakdown at all: both numbers look authoritative, a coach picks whichever
 * supports the point they were making, and nothing in the product can say which
 * is right. So the phases are checked against deriveInnings()'s own totals,
 * folded from the same log, rather than against expected constants.
 *
 * The second concern is the boundaries. An off-by-one here files the whole
 * sixth over into the middle, which is a wrong answer that looks entirely
 * plausible on a card and would never be noticed.
 */
import {
  PHASE_NAMES, PHASE_LABELS, phasesFor, phaseRange, derivePhases, deriveMatchPhases,
} from "../src/phases.mjs";
import { deriveInnings } from "../src/replay.mjs";

/** @import { LogEvent } from "../src/events.mjs" */

let pass = 0, fail = 0;
/** @param {string} n  @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
/**
 * The value an assertion reads, which the setup guarantees is there: a
 * missing one fails the suite loudly instead of being read as a property.
 * @template T  @param {T} x  @returns {NonNullable<T>}
 */
const must = (x) => { if (x == null) throw new Error("phases.test: expected a value"); return x; };

// ── A. Boundaries ────────────────────────────────────────
group("A. Where the phases fall");
{
  const t20 = must(phasesFor(20));
  ok("a T20 powerplay is the first six overs, by law",
     t20.powerplay.from === 1 && t20.powerplay.to === 6);
  ok("...and the death is the last four", t20.death?.from === 17 && t20.death?.to === 20);
  ok("...and the middle is everything between", t20.middle?.from === 7 && t20.middle?.to === 16);

  const od = must(phasesFor(50));
  ok("a fifty-over powerplay is ten overs, not fifteen",
     od.powerplay.from === 1 && od.powerplay.to === 10);
  ok("...which a single percentage could not have produced for both formats",
     (6 / 20) !== (10 / 50));
  ok("...and its death is the last ten", od.death?.from === 41 && od.death?.to === 50);

  // School cricket plays formats with no governing convention.
  const short = must(phasesFor(15));
  ok("a fifteen-over innings still gets three phases",
     short.powerplay && short.middle && short.death);
  ok("...covering it exactly", short.death?.to === 15 && short.powerplay.from === 1);

  ok("a nonsense length answers null rather than guessing",
     // @ts-expect-error a null length is the case under test
     phasesFor(0) === null && phasesFor(-3) === null && phasesFor(null) === null);
}

group("B. Every over lands in exactly one phase, at every length");
{
  // The bug this found before any test existed: a one-over innings produced
  // `death: {from: 2, to: 1}` — inverted, matching no ball, and rendering as a
  // real span. Checked exhaustively rather than at the two lengths anyone
  // remembers to try.
  let inverted = 0, unhoused = 0, doubled = 0;
  for (let n = 1; n <= 60; n++) {
    const s = must(phasesFor(n));
    for (const p of PHASE_NAMES) { const sp = s[p]; if (sp && sp.from > sp.to) inverted++; }
    for (let over = 1; over <= n; over++) {
      const hits = PHASE_NAMES.filter((p) => { const sp = s[p]; return sp && over >= sp.from && over <= sp.to; }).length;
      if (hits === 0) unhoused++;
      if (hits > 1) doubled++;
    }
  }
  ok("no phase spans backwards, at any innings length", inverted === 0);
  ok("no over falls outside every phase", unhoused === 0);
  ok("no over falls inside two phases", doubled === 0);
  ok("a one-over innings is one phase, not a phase and an impossibility",
     must(phasesFor(1)).powerplay.to === 1 && must(phasesFor(1)).death === null);
  ok("an absent phase reads as a dash rather than an empty range",
     phaseRange(must(phasesFor(1)).death) === "—" && phaseRange({ from: 1, to: 6 }) === "1-6");
}

// ── C. The phases add up ─────────────────────────────────
group("C. The breakdown agrees with the scorecard");
{
  // A synthetic innings across all three phases, including the extras that are
  // easiest to get wrong: a wide costs a run and no ball.
  /** @type {LogEvent[]} */
  const ev = [{ kind: "innings_start", overs: 20, squad: [], bowlingSquad: [] }];
  let seq = 0;
  /** @param {number} over  @param {number} value  @param {"run" | "Wd"} [type]  @param {object} [extra] */
  const ball = (over, value, type = "run", extra = {}) => {
    // Six legal deliveries per over, so the over a ball belongs to is implied
    // by the order it is appended — the fold stamps it, this does not.
    ev.push({ kind: "ball", type, value, seq: ++seq, ...extra });
  };
  // Powerplay: overs 1-6, briskly.
  for (let o = 0; o < 6; o++) for (let b = 0; b < 6; b++) ball(o, b === 0 ? 4 : 1);
  // Middle: overs 7-16, with a wide bowled part way through it.
  //
  // The wide is appended INSIDE the loop, not after it. Which over a delivery
  // belongs to is decided by how many legal balls precede it, so appending it
  // after the middle overs put it at the top of over 17 — the death — and the
  // assertion that "a wide in the middle adds a run" was testing the death
  // phase while claiming to test the middle. The test was wrong; the fold was
  // right, and its totals said so.
  for (let o = 6; o < 16; o++) {
    for (let b = 0; b < 6; b++) ball(o, b === 5 ? 0 : 1);
    if (o === 10) ball(o, 0, "Wd");
  }
  // Death: overs 17-20, hitting out.
  for (let o = 16; o < 20; o++) for (let b = 0; b < 6; b++) ball(o, b % 2 ? 6 : 2);

  const inn = deriveInnings(ev);
  const ph = must(derivePhases(inn));

  /** @param {"runs" | "balls" | "wickets"} k */
  const sum = (k) => PHASE_NAMES.reduce((a, p) => a + ph[p][k], 0);
  // THE ONE THAT MATTERS. Two numbers that disagree are worse than one number.
  ok("phase runs sum to the innings total", sum("runs") === inn.runs);
  ok("phase balls sum to the legal deliveries bowled", sum("balls") === inn.balls);
  ok("phase wickets sum to the innings wickets", sum("wickets") === inn.wickets);

  ok("the powerplay caught the opening overs", ph.powerplay.balls === 36);
  ok("the death caught the closing overs", ph.death.balls === 24);
  ok("boundaries are counted where they were hit",
     ph.powerplay.fours === 6 && ph.death.sixes === 12 && ph.powerplay.sixes === 0);
  ok("a wide adds a run without adding a ball",
     ph.middle.balls === 60 && ph.middle.runs === 51);

  ok("run rate is runs per over, not per ball",
     ph.death.runRate === Math.round((ph.death.runs / ph.death.balls) * 600) / 100);
  ok("...and the death rate is the highest of the three",
     must(ph.death.runRate) > must(ph.powerplay.runRate) && must(ph.death.runRate) > must(ph.middle.runRate));
  ok("dot percentage is a percentage of legal balls",
     ph.middle.dotPct === Math.round((ph.middle.dots / ph.middle.balls) * 100));
  ok("strike rotation counts the ones and threes",
     ph.middle.strikeRotationPct === Math.round((50 / 60) * 100));
}

group("D. An unbowled phase says nothing rather than zero");
{
  /** @type {LogEvent[]} */
  const ev = [{ kind: "innings_start", overs: 20, squad: [], bowlingSquad: [] }];
  for (let b = 0; b < 6; b++) ev.push({ kind: "ball", type: "run", value: 1, seq: b });
  const ph = must(derivePhases(deriveInnings(ev)));
  // A run rate of 0.00 over an unbowled death is a claim about how a side
  // batted at the death. They have not batted at the death.
  ok("an unbowled phase has a null run rate, not 0", ph.death.runRate === null);
  ok("...and null percentages", ph.death.dotPct === null && ph.death.boundaryPct === null);
  ok("...while its counts are honestly zero", ph.death.runs === 0 && ph.death.balls === 0);
  ok("the phase that was bowled reports a rate", ph.powerplay.runRate !== null);
}

// ── E. Par is the other side's, or nothing ───────────────
group("E. Par is what the opposition actually did");
{
  const mk = (/** @type {number} */ perBall) => {
    /** @type {LogEvent[]} */
    const ev = [{ kind: "innings_start", overs: 20, squad: [], bowlingSquad: [] }];
    for (let o = 0; o < 20; o++) for (let b = 0; b < 6; b++) ev.push({ kind: "ball", type: "run", value: perBall, seq: o * 6 + b });
    return deriveInnings(ev);
  };
  const both = deriveMatchPhases([mk(1), mk(2)]);
  const first = must(both.first), second = must(both.second);

  ok("a first innings has no par — there is nothing yet to be level with",
     PHASE_NAMES.every((p) => first[p].par === null && first[p].vsPar === null));
  ok("a chase is measured against the same phase of the innings it chases",
     second.powerplay.par === first.powerplay.runs);
  ok("...and reports the gap, signed",
     second.powerplay.vsPar === second.powerplay.runs - first.powerplay.runs);
  ok("...which is positive when the chase is ahead", must(second.death.vsPar) > 0);

  // Deliberately not symmetric. The total does not chase the chase.
  ok("the comparison runs one way only", first.death.par === null);
  ok("a match with one innings still answers for that innings",
     deriveMatchPhases([mk(1)]).second === null);
  ok("...and an empty match answers null for both",
     deriveMatchPhases([]).first === null && deriveMatchPhases([]).second === null);
}

group("F. Control, which runs do not measure");
{
  // An edge for four and a cover drive for four are the same row on a
  // scorecard. This is the column that tells them apart.
  /** @type {LogEvent[]} */
  const ev = [{ kind: "innings_start", overs: 20, squad: [], bowlingSquad: [] }];
  let n = 0;
  /** @param {number} value  @param {string} contact */
  const faced = (value, contact) => ev.push({ kind: "ball", type: "run", value, contact, seq: ++n });
  // A powerplay of six overs: middled half, beaten a third, edged the rest.
  for (let i = 0; i < 18; i++) faced(1, "middle");
  for (let i = 0; i < 12; i++) faced(0, "beat");
  for (let i = 0; i < 6; i++)  faced(4, "outside_edge");
  const ph = must(derivePhases(deriveInnings(ev)));

  ok("every assessed delivery is counted", ph.powerplay.assessed === 36);
  ok("control is the share that was middled", ph.powerplay.controlPct === 50);
  ok("...and beaten the share that missed the bat", ph.powerplay.beatenPct === Math.round((12 / 36) * 100));
  // The whole point: six edged fours read as 24 runs and as a batter in trouble.
  ok("an edge for four scores four and does not count as control",
     ph.powerplay.runs === 18 + 24 && ph.powerplay.controlPct === 50);

  // Contact is optional, and a percentage over deliveries nobody assessed
  // would be a number about the scorer rather than the batter.
  /** @type {LogEvent[]} */
  const quick = [{ kind: "innings_start", overs: 20, squad: [], bowlingSquad: [] }];
  for (let i = 0; i < 6; i++) quick.push({ kind: "ball", type: "run", value: 1, seq: i });
  const q = must(derivePhases(deriveInnings(quick)));
  ok("a phase scored without contact reports null control, not 0%",
     q.powerplay.controlPct === null && q.powerplay.beatenPct === null);
  ok("...and says how many deliveries were assessed, which is none",
     q.powerplay.assessed === 0);
  ok("...while its runs are still counted", q.powerplay.runs === 6);

  // Being hit on the pad is a different failure from missing the ball, and an
  // lbw shout is a different thing to work on from a play-and-miss.
  /** @type {LogEvent[]} */
  const pads = [{ kind: "innings_start", overs: 20, squad: [], bowlingSquad: [] }];
  pads.push({ kind: "ball", type: "run", value: 0, contact: "body", seq: 1 });
  pads.push({ kind: "ball", type: "run", value: 0, contact: "beat", seq: 2 });
  const pd = must(derivePhases(deriveInnings(pads)));
  ok("a ball into the pad is assessed but is not a play-and-miss",
     pd.powerplay.assessed === 2 && pd.powerplay.beaten === 1);
}

group("G. The vocabulary is closed");
{
  ok("three phases, named", PHASE_NAMES.length === 3);
  ok("every phase has a label a card can print",
     PHASE_NAMES.every((p) => typeof PHASE_LABELS[p] === "string" && PHASE_LABELS[p].length > 3));
  const ph = must(derivePhases(deriveInnings([{ kind: "innings_start", overs: 20, squad: [], bowlingSquad: [] }])));
  ok("every phase reports which overs it covers",
     PHASE_NAMES.every((p) => typeof ph[p].overs === "string" && ph[p].overs.length > 0));
  ok("...and whether the innings is long enough to have it",
     PHASE_NAMES.every((p) => typeof ph[p].played === "boolean"));
}

console.log(`\n${"─".repeat(52)}\nPHASES SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

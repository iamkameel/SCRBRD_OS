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
import { isLegal } from "../src/events.mjs";

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

// ── H. The fold's question, not a look-alike ─────────────
// SCRBRD-072. Each of these was a place the phases answered a question that
// sounded like the fold's and was not: the sums disagreed with the scorecard.
const START = /** @type {LogEvent} */ ({ kind: "innings_start", overs: 20, squad: [], bowlingSquad: [] });
const PAIR = /** @type {LogEvent} */ ({ kind: "batters", striker: "a", nonStriker: "b" });
const BOWLER = /** @type {LogEvent} */ ({ kind: "bowler", bowler: "x" });
/** @param {LogEvent[]} ev  @param {PhaseKey} k */
const phaseSum = (ev, k) => {
  const ph = must(derivePhases(deriveInnings(ev)));
  return PHASE_NAMES.reduce((a, p) => a + ph[p][k], 0);
};
/** @typedef {"runs" | "balls" | "wickets" | "dots" | "fours" | "sixes"} PhaseKey */

group("H. A dismissal the free hit saved is not a phase wicket");
{
  // The case the backlog entry was found by: a no-ball, then "bowled" on the
  // free hit. The fold saves the batter; the phases used to count the ball.
  /** @type {LogEvent[]} */
  const saved = [START, PAIR, BOWLER,
    { kind: "ball", type: "Nb", value: 0 },
    { kind: "ball", type: "W", value: 0, dismissal: "bowled" }];
  const inn = deriveInnings(saved);
  ok("the fold saves a batter bowled on a free hit", inn.wickets === 0);
  ok("...and the phases agree: no wicket in any phase", phaseSum(saved, "wickets") === 0);
  ok("...while the ball itself still counts, legal and a dot",
     phaseSum(saved, "balls") === 1 && phaseSum(saved, "dots") === 1);

  // Run out is out on a free hit (Law 21.19), so it stands in both.
  /** @type {LogEvent[]} */
  const runOut = [START, PAIR, BOWLER,
    { kind: "ball", type: "Nb", value: 0 },
    { kind: "ball", type: "W", value: 1, dismissal: "run_out" }];
  ok("a run out on a free hit stands in the fold",
     deriveInnings(runOut).wickets === 1);
  ok("...and is a phase wicket", phaseSum(runOut, "wickets") === 1);

  // The free hit is consumed by the next legal ball: a wide keeps it alive,
  // a dot ends it. The phases do not re-derive that — they read the fold.
  /** @type {LogEvent[]} */
  const carried = [START, PAIR, BOWLER,
    { kind: "ball", type: "Nb", value: 0 },
    { kind: "ball", type: "Wd", value: 0 },
    { kind: "ball", type: "W", value: 0, dismissal: "caught" },
    { kind: "ball", type: "run", value: 0 },
    { kind: "ball", type: "W", value: 0, dismissal: "caught" }];
  ok("a free hit carried over a wide still saves, and the next ball is live again",
     deriveInnings(carried).wickets === 1 && phaseSum(carried, "wickets") === 1);

  // A W ball is a wicket to the fold whether or not the mode was written; the
  // old test was the dismissal field, which is the wrong question.
  /** @type {LogEvent[]} */
  const unnamed = [START, PAIR, BOWLER, { kind: "ball", type: "W", value: 0 }];
  ok("a wicket with no mode recorded counts in both",
     deriveInnings(unnamed).wickets === 1 && phaseSum(unnamed, "wickets") === 1);

  // A phase is the batting side's story: a run out is a wicket lost, though
  // the bowler is not credited with it.
  /** @type {LogEvent[]} */
  const notTheBowlers = [START, PAIR, BOWLER, { kind: "ball", type: "W", value: 0, dismissal: "run_out" }];
  const nb = deriveInnings(notTheBowlers);
  ok("a run out is not the bowler's wicket", nb.bowlers[0].wickets === 0);
  ok("...but it is a wicket the side lost, in the innings and in its phase",
     nb.wickets === 1 && phaseSum(notTheBowlers, "wickets") === 1);
}

group("I. Boundaries are the batters' fours and sixes");
{
  const batters = (/** @type {LogEvent[]} */ ev) => deriveInnings(ev).batsmen;
  /** @type {LogEvent[]} */
  const byes = [START, PAIR, BOWLER,
    { kind: "ball", type: "B", value: 4 }, { kind: "ball", type: "LB", value: 4 }];
  ok("four byes and four leg byes are no batter's boundary",
     batters(byes).every((b) => b.fours === 0) && phaseSum(byes, "fours") === 0);
  ok("...though their runs are the side's", phaseSum(byes, "runs") === 8);

  /** @type {LogEvent[]} */
  const noBall = [START, PAIR, BOWLER,
    { kind: "ball", type: "Nb", value: 4 }, { kind: "ball", type: "Nb", value: 6 }];
  ok("a no-ball struck for four or six is the batter's boundary",
     batters(noBall)[0].fours === 1 && batters(noBall)[0].sixes === 1);
  ok("...and the phase's", phaseSum(noBall, "fours") === 1 && phaseSum(noBall, "sixes") === 1);
  ok("...without being a legal ball", phaseSum(noBall, "balls") === 0);
}

group("J. Every ball lands in a phase, even past a revision");
{
  // The umpires cut the innings to ten overs after twelve were bowled. The
  // fold keeps every ball; the phases used to drop overs 11 and 12.
  /** @type {LogEvent[]} */
  const ev = [START, PAIR];
  for (let i = 0; i < 72; i++) ev.push({ kind: "ball", type: "run", value: 1 });
  ev.push({ kind: "revision", overs: 10 });
  const inn = deriveInnings(ev);
  const ph = must(derivePhases(inn));
  ok("the fold counts all seventy-two balls", inn.balls === 72 && inn.overs === 10);
  ok("...and so do the phases", phaseSum(ev, "balls") === 72 && phaseSum(ev, "runs") === 72);
  ok("...drawn over the twelve overs bowled", ph.death.overs.endsWith("-12"));
  ok("an innings inside its overs keeps the spans its overs give it",
     must(derivePhases(deriveInnings([START, PAIR, { kind: "ball", type: "run", value: 1 }]))).death.overs === "17-20");
}

group("K. Penalty runs are the one figure no phase carries");
{
  // Documented, not fixed: the fold records how many penalty runs were
  // awarded but not when, so there is no phase to file them in.
  /** @type {LogEvent[]} */
  const ev = [START, PAIR, BOWLER, { kind: "ball", type: "run", value: 1 }, { kind: "penalty", runs: 5 }];
  const inn = deriveInnings(ev);
  ok("the innings has the five", inn.runs === 6 && inn.extras.penalty === 5);
  ok("...the phases have everything but", phaseSum(ev, "runs") === inn.runs - inn.extras.penalty);
}

group("K2. A wicket with no ball is filed by the over it fell in (SCRBRD-081)");
{
  /** @type {LogEvent[]} */
  const ev = [START, PAIR, BOWLER, ...Array.from({ length: 36 }, () => /** @type {LogEvent} */ ({ kind: "ball", type: "run", value: 0 })),
              { kind: "bowler", bowler: "y" }, { kind: "ball", type: "run", value: 1 },
              { kind: "retire", batter: "a", reason: "out", type: "W", dismissal: "retired_out" }];
  const inn = deriveInnings(ev);
  const ph = must(derivePhases(inn));
  ok("the innings has the wicket, and no extra ball", inn.wickets === 1 && inn.balls === 37);
  ok("...and so do the phases: in the seventh over, the middle", ph.middle.wickets === 1 && ph.powerplay.wickets === 0);
  ok("...which sum to the innings", phaseSum(ev, "wickets") === 1 && phaseSum(ev, "balls") === 37);
}

group("L. The invariant, over many innings");
{
  // Deterministic, so a failure reproduces: a small LCG, not Math.random.
  let s = 72;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  /** @template T  @param {T[]} xs  @returns {T} */
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const MODES = ["bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket", "handled_ball",
                 "obstructing_field", "timed_out", "retired_out", "hit_twice", null];

  /** @param {number} overs */
  const innings = (overs) => {
    /** @type {LogEvent[]} */
    const ev = [{ kind: "innings_start", overs, squad: [], bowlingSquad: [] },
                { kind: "batters", striker: "p1", nonStriker: "p2" }];
    let next = 3, legal = 0, out = 0;
    const toPlay = rnd() < 0.3 ? Math.ceil(rnd() * overs) : overs;
    while (legal < toPlay * 6 && out < 10) {
      if (legal % 6 === 0) ev.push({ kind: "bowler", bowler: `b${(legal / 6) % 2}` });
      const r = rnd();
      if (r < 0.05) ev.push({ kind: "ball", type: "Nb", value: pick([0, 0, 1, 4, 6]) });
      // Byes or leg byes off a no-ball (SCRBRD-068): the side's, not a four.
      else if (r < 0.06) ev.push({ kind: "ball", type: "Nb", value: pick([1, 2, 4]), nbRuns: pick(["byes", "leg_byes"]) });
      else if (r < 0.10) ev.push({ kind: "ball", type: "Wd", value: pick([0, 0, 1, 4]) });
      else if (r < 0.14) { ev.push({ kind: "ball", type: pick(["B", "LB"]), value: pick([1, 2, 4]) }); legal++; }
      else if (r < 0.22) {
        ev.push({ kind: "ball", type: "W", value: pick([0, 0, 1]), dismissal: pick(MODES) });
        legal++;
        // Whether it stood is the fold's to say; ask it, and send a batter
        // in, at the end that is empty, only for one that did. (The end
        // matters: a wicket on the last ball of an over has already swapped.)
        const now = deriveInnings(ev);
        if (now.wickets > out) {
          out++;
          // Now and then the batter due in is timed out (SCRBRD-081): a
          // wicket with no ball, and the one after him comes in.
          if (out < 10 && rnd() < 0.15) {
            ev.push({ kind: "retire", batter: `p${next++}`, reason: "timed_out", type: "W", dismissal: "timed_out" });
            out++;
          }
          if (out >= 10) break;
          ev.push(now.striker == null ? { kind: "batters", striker: `p${next++}` }
                                      : { kind: "batters", nonStriker: `p${next++}` });
        }
      } else if (r < 0.225 && out < 9) {
        // Retired out, between two balls (SCRBRD-081).
        const now = deriveInnings(ev);
        const who = /** @type {string} */ (pick([now.striker, now.nonStriker]));
        ev.push({ kind: "retire", batter: who, reason: "out", type: "W", dismissal: "retired_out" });
        out++;
        ev.push(who === now.striker ? { kind: "batters", striker: `p${next++}` } : { kind: "batters", nonStriker: `p${next++}` });
      } else { ev.push({ kind: "ball", type: "run", value: pick([0, 0, 0, 1, 1, 1, 2, 3, 4, 6]) }); legal++; }
      if (rnd() < 0.01) ev.push({ kind: "penalty", runs: 5 });
    }
    if (rnd() < 0.1 && legal > 12) ev.push({ kind: "revision", overs: Math.max(1, Math.floor(legal / 6) - 2) });
    return ev;
  };

  let logs = 0, bad = 0, savedSeen = 0, standingSeen = 0, penaltiesSeen = 0, nbBoundaries = 0, byeFours = 0, revised = 0, offBallSeen = 0, nbByes = 0;
  /** @type {string[]} */
  const why = [];
  for (const overs of [20, 50, 15, 8, 1, 20, 12, 30, 20, 6, 25, 20]) {
    for (let rep = 0; rep < 5; rep++) {
      const ev = innings(overs);
      const inn = deriveInnings(ev);
      const ph = must(derivePhases(inn));
      /** @param {PhaseKey} k */
      const sum = (k) => PHASE_NAMES.reduce((a, p) => a + ph[p][k], 0);
      const bat = (/** @type {"fours" | "sixes"} */ k) => inn.batsmen.reduce((a, b) => a + b[k], 0);
      const legalZeros = inn.ballLog.filter((b) => isLegal(b.type ?? "run") && (b.value ?? 0) === 0).length;
      const checks = {
        runs: sum("runs") === inn.runs - inn.extras.penalty,
        balls: sum("balls") === inn.balls,
        wickets: sum("wickets") === inn.wickets,
        fours: sum("fours") === bat("fours"),
        sixes: sum("sixes") === bat("sixes"),
        dots: sum("dots") === legalZeros,
        // The bowlers' wickets are the side's, less the ones that are not
        // theirs: a phase is never short of a wicket a bowler took.
        bowlers: inn.bowlers.reduce((a, b) => a + b.wickets, 0) <= sum("wickets"),
      };
      for (const [k, v] of Object.entries(checks)) if (!v) { bad++; why.push(`${overs} overs #${rep}: ${k}`); }
      logs++;
      savedSeen += inn.ballLog.filter((b) => b.freeHitSaved).length;
      standingSeen += inn.wickets;
      penaltiesSeen += inn.extras.penalty;
      nbBoundaries += inn.ballLog.filter((b) => b.type === "Nb" && !b.nbRuns && (b.value === 4 || b.value === 6)).length;
      byeFours += inn.ballLog.filter((b) => (b.type === "B" || b.type === "LB" || (b.type === "Nb" && b.nbRuns)) && b.value === 4).length;
      nbByes += inn.ballLog.filter((b) => b.type === "Nb" && b.nbRuns && b.value === 4).length;
      offBallSeen += inn.nonBallWickets.length;
      if (inn.revised) revised++;
    }
  }
  if (why.length) console.log("   ", why.slice(0, 10).join("\n    "));
  ok(`every aggregate adds up over ${logs} varied innings`, bad === 0);
  // Not vacuous: the logs contain the cases the invariant exists for.
  ok("...which include dismissals a free hit saved", savedSeen > 0);
  ok("...and wickets that stood", standingSeen > 0);
  ok("...and no-ball boundaries, four byes, penalty runs and a revision",
     nbBoundaries > 0 && byeFours > 0 && penaltiesSeen > 0 && revised > 0);
  ok("...and wickets that fell with no ball (retired out, timed out)", offBallSeen > 0);
  ok("...and four byes off a no-ball, which are nobody's four", nbByes > 0);
}

console.log(`\n${"─".repeat(52)}\nPHASES SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

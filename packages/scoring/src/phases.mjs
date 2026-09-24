/**
 * SCRBRD — phases of an innings.
 *
 * A T20 innings is three games. The first six overs are played against two
 * fielders outside the ring, the last four against a full boundary rider set
 * and a batter with nothing to lose, and the middle is the negotiation between
 * them. A coach who only sees "142 for 6" cannot tell whether the side lost the
 * powerplay or threw away the death, and those are different problems with
 * different training answers.
 *
 * Everything here is DERIVED from the ball log, like every other figure in this
 * codebase. Nothing is stored, so a phase breakdown cannot drift from the
 * scorecard it came from.
 *
 * THE PHASES ADD UP TO THE INNINGS
 * ────────────────────────────────
 * Summed over the three phases, each figure is the fold's own (replay.mjs),
 * asked the fold's question rather than a look-alike of it:
 *
 *   runs      inn.runs, less penalty runs (below). Extras are in, with the
 *             one-run wide/no-ball penalty added exactly as the fold adds it.
 *   balls     inn.balls: legal deliveries.
 *   wickets   inn.wickets: the wickets the batting side lost. A run out is
 *             one, though it is not the bowler's (chargedToBowler) — a phase
 *             is the batting side's story. A dismissal a free hit saved is
 *             not one: the fold decides that once, with standsOnFreeHit(),
 *             and writes the answer on the log entry as `freeHitSaved`, so
 *             reading that flag IS asking the fold. A second copy of the
 *             rule here is how the two came apart (SCRBRD-072). Retired out
 *             and timed out fall with no ball (SCRBRD-081); the fold files
 *             them in inn.nonBallWickets with their over, and so do these.
 *   fours, sixes  the batters' fours and sixes: off the bat, so a no-ball
 *             hit for four is one and four byes are not.
 *
 * Every delivery lands in a phase. If more overs were bowled than the innings
 * now has — the umpires cut it below where it stood — the phases are drawn
 * over the overs actually bowled, rather than dropping the ones past the end.
 *
 * One figure deliberately does not add up: PENALTY RUNS (Law 41). They are
 * awarded, not scored off a delivery, and the fold records their total
 * (inn.extras.penalty) but not when they fell, so there is no phase to file
 * them in. Guessing one would invent a fact; they are left out, and phase
 * runs sum to inn.runs - inn.extras.penalty.
 *
 * Dots have no figure in the fold to agree with. A dot is a legal delivery
 * worth nothing — a wicket ball included, two byes not — and the matchups read
 * in services/api/read counts them by the same rule.
 *
 * WHAT IS NOT HERE, AND WHY
 * ─────────────────────────
 * A "par score" as an absolute number. scrbrd-beta-2's model carries one, and
 * it is the kind of figure that has to come from somewhere: par depends on the
 * ground, the opposition, the surface and the weather, and a number invented to
 * fill the column is exactly the fabrication this project keeps removing.
 *
 * What IS meaningful is the par a chase actually has: what the other side did
 * in the same phase. `par` is therefore the opposing innings' figure for that
 * phase, and it is null in the first innings because at that point there is
 * nothing to be level with. A card that says "14 behind where they were" is
 * worth more than one that says "par: 48" and cannot say why.
 */
import { isLegal, BALL_TYPE } from "./events.mjs";

/** @import { Innings } from "./replay.mjs" */

/** @typedef {"powerplay" | "middle" | "death"} PhaseName */
/** An inclusive range of 1-indexed over numbers.
 *  @typedef {{from: number, to: number}} Span */
/** @typedef {{powerplay: Readonly<Span>, middle: Readonly<Span> | null, death: Readonly<Span> | null}} PhaseSpans */

/**
 * One phase of one innings, as derivePhases() reports it. Rates and
 * percentages are null where there is nothing to divide by; `par` and `vsPar`
 * are null in a first innings.
 * @typedef {object} Phase
 * @property {PhaseName} name
 * @property {string} label
 * @property {string} overs          "1-6", or "—" when the innings has no such phase
 * @property {boolean} played
 * @property {number} runs           team runs, extras in, penalty runs out
 * @property {number} wickets        the batting side's, as the fold counts them
 * @property {number} balls          legal deliveries
 * @property {number | null} runRate
 * @property {number} dots
 * @property {number} fours          off the bat, no-balls included
 * @property {number} sixes          off the bat, no-balls included
 * @property {number | null} dotPct
 * @property {number | null} boundaryPct  fours and sixes over legal deliveries
 * @property {number | null} strikeRotationPct
 * @property {number} assessed
 * @property {number} middled
 * @property {number} beaten
 * @property {number | null} controlPct
 * @property {number | null} beatenPct
 * @property {number | null} par
 * @property {number | null} vsPar
 */
/** @typedef {Readonly<Record<PhaseName, Readonly<Phase>>>} InningsPhases */

/** @type {readonly PhaseName[]} */
export const PHASE_NAMES = Object.freeze(["powerplay", "middle", "death"]);

export const PHASE_LABELS = Object.freeze({
  powerplay: "Powerplay",
  middle: "Middle overs",
  death: "Death overs",
});

/**
 * Where the phases fall, in 1-indexed over numbers, inclusive.
 *
 * The two standard formats are named rather than computed, because their
 * boundaries are laws of the game and not a ratio: a T20 powerplay is six overs
 * of twenty (30%) and a fifty-over one is ten of fifty (20%). Deriving both
 * from a single percentage would get one of them wrong.
 *
 * School cricket plays everything else — 15, 25, 30, 35 overs — and those have
 * no governing convention, so they fall back to proportions that give the same
 * answer as T20 at 20 overs. That is a choice, and it is written here rather
 * than buried in a query so a director of sport can change it in one place.
 *
 * A very short innings degrades sensibly rather than producing overlapping or
 * negative ranges: at six overs or fewer there is no middle, and `middle` comes
 * back null rather than an empty range pretending to be one.
 *
 * @param {number} overs  the innings' overs; anything not a positive number is none
 * @returns {Readonly<PhaseSpans> | null}
 */
export function phasesFor(overs) {
  const n = Number.isFinite(overs) && overs > 0 ? Math.floor(overs) : 0;
  if (!n) return null;

  let pp, death;
  if (n === 20)      { pp = 6;  death = 4;  }   // T20, by law
  else if (n === 50) { pp = 10; death = 10; }   // one-day, by law
  else {
    pp    = Math.max(1, Math.round(n * 0.3));
    death = Math.max(1, Math.round(n * 0.2));
  }

  // Never let the two ends meet or cross. When they would, the innings is too
  // short to have a middle and is split in two.
  if (pp + death >= n) {
    const half = Math.max(1, Math.floor(n / 2));
    // A single over is one phase, not two. Without this the split produced
    // `death: {from: 2, to: 1}` — an inverted range that matches no ball and
    // reads as a real span in a card. Found by printing the boundaries for
    // every plausible innings length rather than by a test, which is why the
    // test below now covers all of them.
    if (half >= n) {
      return Object.freeze({
        powerplay: Object.freeze({ from: 1, to: n }),
        middle: null,
        death: null,
      });
    }
    return Object.freeze({
      powerplay: Object.freeze({ from: 1, to: half }),
      middle: null,
      death: Object.freeze({ from: half + 1, to: n }),
    });
  }
  return Object.freeze({
    powerplay: Object.freeze({ from: 1, to: pp }),
    middle: Object.freeze({ from: pp + 1, to: n - death }),
    death: Object.freeze({ from: n - death + 1, to: n }),
  });
}

/** "1-6", or "—" for a phase this innings is too short to have.
 *  @param {Span | null | undefined} span */
export function phaseRange(span) {
  return span ? `${span.from}-${span.to}` : "—";
}

const EMPTY = () => ({
  runs: 0, wickets: 0, balls: 0, dots: 0, singles: 0, fours: 0, sixes: 0,
  // Deliveries where contact was recorded at all, and how they went. Counted
  // separately from `balls` because contact is optional: a QUICK capture
  // profile records none, and a percentage over deliveries nobody assessed
  // would be a number about the scorer rather than the batter.
  assessed: 0, middled: 0, beaten: 0,
});

/**
 * Fold one innings' ball log into the three phases.
 *
 * `inn` is what deriveInnings() returns. `opposing` is the other innings'
 * phase breakdown when one exists, which is where `par` comes from.
 *
 * Rates come back null rather than zero when there are no balls in a phase:
 * a run rate of 0.00 over an unbowled powerplay is a claim about how a side
 * batted, and the side has not batted yet.
 *
 * @param {Partial<Innings> | null | undefined} inn
 * @param {{opposing?: InningsPhases | null}} [opts]
 * @returns {InningsPhases | null}
 */
export function derivePhases(inn, { opposing = null } = {}) {
  // Number.isFinite proves inn is there and its overs a number; it is no guard to the checker.
  const overs = Number.isFinite(inn?.overs) ? /** @type {{overs: number}} */ (inn).overs : 20;
  const log = inn?.ballLog ?? [];
  // Wickets that fell with no delivery — retired out, timed out (SCRBRD-081).
  // They are in the fold's wickets and in no ball, so they are filed by the
  // over they fell in, which the fold records beside them.
  const offBall = inn?.nonBallWickets ?? [];
  // The overs actually reached. A revision below where the innings stood
  // would otherwise leave its last overs outside every span, and those balls
  // in no phase; the fold counts every ball it folds, so must this.
  const reached = [...log, ...offBall].reduce((n, b) => Math.max(n, (b.over ?? 0) + 1), 0);
  const spans = phasesFor(Math.max(overs, reached));
  if (!spans) return null;

  const buckets = { powerplay: EMPTY(), middle: EMPTY(), death: EMPTY() };

  for (const b of log) {
    // `over` is 0-indexed on a log entry; the spans are the over numbers a
    // human says out loud. Off-by-one here would file every ball of the sixth
    // over into the middle, which is a wrong answer that looks plausible.
    const overNo = (b.over ?? 0) + 1;
    const name = PHASE_NAMES.find((p) => spans[p] && overNo >= spans[p].from && overNo <= spans[p].to);
    if (!name) continue;
    const acc = buckets[name];

    const type = b.type ?? BALL_TYPE.RUN;
    const legal = isLegal(type);
    const value = Number.isFinite(b.value) ? /** @type {number} */ (b.value) : 0;   // isFinite proves it
    // Team runs, not the batter's: an illegal delivery costs one before
    // anything run off it. Same arithmetic as the fold in replay.mjs, so the
    // phases add up to the innings total (penalty runs apart — see the top).
    acc.runs += value + (legal ? 0 : 1);
    if (legal) {
      acc.balls += 1;
      if (value === 0) acc.dots += 1;
      if (value === 1 || value === 3) acc.singles += 1;
    }
    // Boundaries are the batters' fours and sixes, credited where the fold
    // credits them: off the bat, which a no-ball can be and a bye cannot.
    // Counting any legal ball worth four called four byes a boundary and
    // missed a no-ball struck for four, so the phases and the scorecard's
    // 4s and 6s columns disagreed.
    if (type === BALL_TYPE.RUN || type === BALL_TYPE.NO_BALL) {
      if (value === 4) acc.fours += 1;
      if (value === 6) acc.sixes += 1;
    }
    // A wicket is a W ball the fold let stand. Not "a ball with a dismissal
    // on it": a free hit saves the batter from the bowler's dismissals, the
    // fold says so on the entry (`freeHitSaved`), and a phase that counted
    // the ball anyway had a wicket the innings did not. SCRBRD-072.
    if (type === BALL_TYPE.WICKET && !b.freeHitSaved) acc.wickets += 1;

    // Control, which runs do not measure. An edge for four and a cover drive
    // for four are the same row on a scorecard and opposite events in a net.
    if (legal && b.contact) {
      acc.assessed += 1;
      if (b.contact === "middle") acc.middled += 1;
      // Beaten is bat-missed-ball. Being hit on the pad is not the same failure
      // and is not counted as one — an lbw shout and a play-and-miss are
      // different things to work on.
      if (b.contact === "beat") acc.beaten += 1;
    }
  }

  for (const w of offBall) {
    const overNo = (w.over ?? 0) + 1;
    const name = PHASE_NAMES.find((p) => spans[p] && overNo >= spans[p].from && overNo <= spans[p].to);
    if (name) buckets[name].wickets += 1;
  }

  /** @param {number} n  @param {number} d */
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
  // Filled below for every name in PHASE_NAMES before it is returned.
  const out = /** @type {Record<PhaseName, Readonly<Phase>>} */ ({});
  for (const name of PHASE_NAMES) {
    const a = buckets[name];
    const span = spans[name];
    const parRuns = opposing?.[name]?.runs;
    out[name] = Object.freeze({
      name,
      label: PHASE_LABELS[name],
      overs: phaseRange(span),
      played: !!span,
      runs: a.runs,
      wickets: a.wickets,
      balls: a.balls,
      // Runs per over, to two places. Null on no balls — see above.
      runRate: a.balls > 0 ? Math.round((a.runs / a.balls) * 600) / 100 : null,
      dots: a.dots,
      fours: a.fours,
      sixes: a.sixes,
      dotPct: pct(a.dots, a.balls),
      boundaryPct: pct(a.fours + a.sixes, a.balls),
      // How often the strike turned over. The tactical attribute this pairs
      // with is tactical.strikeRotation, and this is the evidence for it.
      strikeRotationPct: pct(a.singles, a.balls),
      // Control, over the deliveries where contact was actually recorded —
      // never over every ball, or a phase scored on a QUICK profile would
      // report a batter as out of touch when nobody was watching that closely.
      // Null when none were assessed, which is the honest answer.
      assessed: a.assessed,
      // Counts beside the percentages, as with dots and boundaries: "beaten
      // eleven times" is a thing a coach can picture, where "31%" is not.
      middled: a.middled,
      beaten: a.beaten,
      controlPct: pct(a.middled, a.assessed),
      beatenPct: pct(a.beaten, a.assessed),
      // What the other side made in the same phase, and the gap. Both null in
      // a first innings, because there is nothing yet to be level with.
      // Number.isFinite(parRuns) proves it a number.
      par: Number.isFinite(parRuns) ? /** @type {number} */ (parRuns) : null,
      vsPar: Number.isFinite(parRuns) ? a.runs - /** @type {number} */ (parRuns) : null,
    });
  }
  return Object.freeze(out);
}

/**
 * Both innings of a match, with the second measured against the first.
 *
 * The order matters and is not symmetric: the chase is compared to the total,
 * never the other way round. A first innings has no par by definition.
 *
 * @param {(Partial<Innings> | null | undefined)[]} [innings]
 * @returns {Readonly<{first: InningsPhases | null, second: InningsPhases | null}>}
 */
export function deriveMatchPhases(innings = []) {
  const first = innings[0] ? derivePhases(innings[0]) : null;
  const second = innings[1] ? derivePhases(innings[1], { opposing: first }) : null;
  return Object.freeze({ first, second });
}

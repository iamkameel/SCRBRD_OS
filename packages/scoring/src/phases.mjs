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

/** "1-6", or "—" for a phase this innings is too short to have. */
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
 */
export function derivePhases(inn, { opposing = null } = {}) {
  const overs = Number.isFinite(inn?.overs) ? inn.overs : 20;
  const spans = phasesFor(overs);
  if (!spans) return null;

  const buckets = { powerplay: EMPTY(), middle: EMPTY(), death: EMPTY() };

  for (const b of inn?.ballLog ?? []) {
    // `over` is 0-indexed on a log entry; the spans are the over numbers a
    // human says out loud. Off-by-one here would file every ball of the sixth
    // over into the middle, which is a wrong answer that looks plausible.
    const overNo = (b.over ?? 0) + 1;
    const name = PHASE_NAMES.find((p) => spans[p] && overNo >= spans[p].from && overNo <= spans[p].to);
    if (!name) continue;
    const acc = buckets[name];

    const type = b.type ?? BALL_TYPE.RUN;
    const legal = isLegal(type);
    const value = Number.isFinite(b.value) ? b.value : 0;
    // Team runs, not the batter's: an illegal delivery costs one before
    // anything run off it. Same arithmetic as the fold in replay.mjs, so the
    // phases always add up to the innings total.
    acc.runs += value + (legal ? 0 : 1);
    if (legal) {
      acc.balls += 1;
      if (value === 0) acc.dots += 1;
      if (value === 1 || value === 3) acc.singles += 1;
      if (value === 4) acc.fours += 1;
      if (value === 6) acc.sixes += 1;
    }
    if (b.dismissal) acc.wickets += 1;

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

  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
  const out = {};
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
      par: Number.isFinite(parRuns) ? parRuns : null,
      vsPar: Number.isFinite(parRuns) ? a.runs - parRuns : null,
    });
  }
  return Object.freeze(out);
}

/**
 * Both innings of a match, with the second measured against the first.
 *
 * The order matters and is not symmetric: the chase is compared to the total,
 * never the other way round. A first innings has no par by definition.
 */
export function deriveMatchPhases(innings = []) {
  const first = innings[0] ? derivePhases(innings[0]) : null;
  const second = innings[1] ? derivePhases(innings[1], { opposing: first }) : null;
  return Object.freeze({ first, second });
}

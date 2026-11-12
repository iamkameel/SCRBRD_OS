import { DISMISSAL, FIELDER_REF_MAX, standsOnFreeHit } from "@scrbrd/scoring";

/**
 * What the wicket sheet asks, by the way out chosen — one rule, so a test can
 * hold it without the sheet around it (apps/web/test/wicket-asks.test.mjs).
 * The Laws audit of 28 Oct 2026 and Kameel's decisions on it:
 *
 *   who    retired out, a run out, and every obstruction (F8: either batter
 *          may be out obstructing, on any delivery, Law 37.1.1).
 *   runs   the runs completed first: on a run out (Law 18.11), an obstruction
 *          that did not stop a catch (Law 37), and — F9 — a bowler's
 *          dismissal on a free hit, which does not stand: the ball is not
 *          dead, and what the batters ran counts. Off a wide or a no-ball the
 *          runs were asked with the extra.
 *   whose  when runs were completed: off the bat, byes or leg byes (F5: a run
 *          out going for a second bye; F9: byes off a bowled free hit). The
 *          event's `nbRuns`, as a no-ball's.
 *   end    on EVERY run out (Q6, F1): with no run completed the batters may
 *          still have crossed, and only the end the wicket was broken at says
 *          which end is empty (Law 38.4).
 *
 * @param {{mode: string, offExtra: boolean, freeHit?: boolean, stopped?: boolean, runs?: number, pair?: boolean}} o
 */
export function wicketAsks({ mode, offExtra, freeHit = false, stopped = false, runs = 0, pair = true }) {
  const isRunOut = mode === DISMISSAL.RUN_OUT;
  const isObstruct = mode === DISMISSAL.OBSTRUCTING_FIELD;
  const savedOnFreeHit = freeHit && !offExtra && mode !== DISMISSAL.RETIRED_OUT && !standsOnFreeHit(mode);
  const askRuns = !offExtra && (isRunOut || (isObstruct && !stopped) || savedOnFreeHit);
  return {
    who: (mode === DISMISSAL.RETIRED_OUT || isRunOut || isObstruct) && pair,
    runs: askRuns,
    whose: askRuns && runs > 0,
    end: isRunOut,
    savedOnFreeHit,
  };
}

/**
 * The detail the sheet's Confirm hands confirmWicket(): only what was asked,
 * so a wicket the sheet did not ask about is the event it always was.
 * @param {ReturnType<typeof wicketAsks>} asks
 * @param {{who?: string | null, strikerId?: string | null, runs?: number, from?: string | null, end?: string | null, faces?: string | null, asksFaces?: boolean, fielders?: string[]}} a
 */
export function wicketDetail(asks, { who = null, strikerId = null, runs = 0, from = null, end = null, faces = null, asksFaces = false, fielders = [] }) {
  return {
    dismissed: asks.who && who !== strikerId ? who : null,
    runs: asks.runs ? runs : 0,
    nbRuns: asks.whose ? from : null,
    outAt: asks.end ? end : null,
    facesNext: asksFaces ? faces : null,
    // Who fielded it, as references (RECOGNITION R12, P2): only when the
    // sheet named somebody, so every other wicket is the detail it was.
    ...(fielders.length ? { fielders } : {}),
  };
}

/**
 * The fielders a wicket sheet's answer names, as references (RECOGNITION
 * R12, P2; events.mjs FIELDED_DISMISSALS): a squad member's id where the pad
 * holds one (else his name, which is how the fold knows him, as a bowler),
 * the twelfth man's id, or the name as typed for a substitute or the other
 * side's boy. Each named once, in the order named; empty when nobody was.
 * @param {string[]} names  the names chosen or typed, in order
 * @param {{id?: string|null, name: string}[]} [squad]  the fielding side the sheet offered
 * @param {{id?: string|null, name: string} | null} [twelfth]
 * @returns {string[]}
 */
export function fielderRefs(names, squad = [], twelfth = null) {
  const out = [];
  for (const raw of names) {
    const name = typeof raw === "string" ? raw.trim() : "";
    // A name longer than the event holds is no reference: the wicket keeps
    // its scorecard text and credits nobody (unknown, never guessed).
    if (!name || name.length > FIELDER_REF_MAX) continue;
    const p = (squad || []).find((x) => x?.name === name) ?? (twelfth && twelfth.name === name ? twelfth : null);
    const ref = p ? (p.id ?? p.name) : name;
    if (typeof ref === "string" && ref && !out.includes(ref)) out.push(ref);
  }
  return out;
}

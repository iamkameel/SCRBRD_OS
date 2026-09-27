/**
 * An extra in two taps (SCRBRD-100 item 3): the kind, then the runs.
 *
 * The kinds are on the pad's strip, on every phase and under Basic Scoring;
 * a kind opens its runs in the pad's own space, one of them marked as the
 * likely answer — 0 for a wide or a no-ball, 1 for a bye or a leg bye (the
 * least a bye can be, and the commonest) — and a tap on any of them records.
 * The no-ball asks its type (a height no-ball or a beamer is a free hit) and
 * whose the runs are on the same panel, each already set to the commonest
 * answer, so a front-foot no-ball is still two taps and a height no-ball
 * three.
 *
 * WHAT A TAP RECORDS IS NOT DECIDED HERE. extraCall() names the engine
 * handler and the arguments the pad passed to it before the two taps, so
 * each extra is the event it always was (apps/web/test/pad-feel.test.mjs
 * builds every one both ways and compares the bytes):
 *
 *   wide      recordWide(runs)          → commitBall("Wd", runs, …, hubApproach),
 *                                          the one-tap wide at runs 0
 *   no-ball   recordNoBall(type, runs, whose)  the no-ball sheet's own confirm
 *   bye, leg bye  onCommitDetailed(kind, runs, shot, seg, zone)  the outcome
 *             phase's byes (with the shot and area chosen so far) and Basic
 *             Scoring's (with none)
 */

/** The kinds, in the strip's order. `runs` are the keys offered; `likely` is marked. */
export const EXTRAS = Object.freeze([
  { kind: "Wd", label: "Wide", runs: [0, 1, 2, 3, 4], likely: 0 },
  { kind: "Nb", label: "No ball", runs: [0, 1, 2, 3, 4, 5, 6], likely: 0 },
  { kind: "B", label: "Bye", runs: [1, 2, 3, 4], likely: 1 },
  { kind: "LB", label: "Leg bye", runs: [1, 2, 3, 4], likely: 1 },
]);
export const extraOf = (kind) => EXTRAS.find((e) => e.kind === kind) ?? null;

/** The no-ball's two questions, each with its commonest answer first. */
export const NB_TYPES = Object.freeze([
  { id: "front_foot", label: "Front foot" },
  { id: "height", label: "Height" },
  { id: "beamer", label: "Beamer" },
]);
export const NB_FROM = Object.freeze([
  { id: null, label: "Off the bat" },
  { id: "byes", label: "Byes" },
  { id: "leg_byes", label: "Leg byes" },
]);
export const NB_DEFAULT = Object.freeze({ type: "front_foot", from: null });
/** A height no-ball or a beamer earns a free hit. */
export const nbFreeHit = (type) => type === "height" || type === "beamer";

/**
 * The runs of an extra, in words: its key's accessible name and the
 * panel's question.
 */
export function runsWords(kind, n) {
  const pl = (one, many) => `${n} ${n === 1 ? one : many}`;
  switch (kind) {
    case "Wd": return n === 0 ? "Wide, no runs" : `Wide and ${pl("run", "runs")}`;
    case "Nb": return n === 0 ? "No ball, no runs" : `No ball and ${pl("run", "runs")}`;
    case "B": return pl("bye", "byes");
    case "LB": return pl("leg bye", "leg byes");
    default: return String(n);
  }
}

/**
 * The engine call an extra's second tap makes: `{to, args}`, where `to` is
 * "wide" (recordWide), "noBall" (recordNoBall) or "commit"
 * (onCommitDetailed).
 *
 * @param {"Wd"|"Nb"|"B"|"LB"} kind
 * @param {number} runs
 * @param {{basic?: boolean, shot?: string|null, area?: {seg: number, zone: string}|null,
 *          nb?: {type: string, from: string|null}}} [pad]  what the pad knows so far
 */
export function extraCall(kind, runs, { basic = false, shot = null, area = null, nb = NB_DEFAULT } = {}) {
  switch (kind) {
    case "Wd": return { to: "wide", args: [runs] };
    // Whose the runs are is asked only of runs there are (SCRBRD-068): with
    // none, the answer is not written, whatever the panel showed.
    case "Nb": return { to: "noBall", args: [nb.type, runs, runs > 0 ? nb.from : null] };
    case "B":
    case "LB":
      // Basic Scoring never has a shot or an area; the three phases carry
      // what was chosen before the extra (nothing, on the idle pad).
      return basic
        ? { to: "commit", args: [kind, runs, null, null, null] }
        // A point from the Area step (SCRBRD-101) goes on whole, as the runs'
        // does; a bare {seg, zone} is a sector, recorded as it always was.
        : { to: "commit", args: [kind, runs, shot, area?.seg ?? null, area?.zone ?? null,
            ...(area?.placementSource || area?.placementNull ? [area] : [])] };
    default: return null;
  }
}

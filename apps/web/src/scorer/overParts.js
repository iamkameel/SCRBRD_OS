import { KIND, countsInOver, foldSteps } from "@scrbrd/scoring";
import { deliveryRuns } from "./chartData.js";

/**
 * CRI-2.3: what each Manhattan bar is made of — every delivery in the over
 * and every award placed in it, by event id, with the runs each added — so a
 * bar can list its balls in the Commentary (filtered by id) and every run in
 * it can be traced to one.
 *
 * It places runs exactly as projectInnings() (chartData.js) does: a delivery
 * in its own over, an award in the over of the delivery before it, the
 * awards read off foldSteps(), the fold itself. charts.test.mjs holds the two
 * to each other over generated innings: a bar's parts add up to its runs.
 * Its own module, not chartData.js, because chartData.js is in the public
 * page's static graph and this is the signed-in Match Centre's alone
 * (tools/check-bundle.mjs).
 *
 * @param {any} inn  the fold's innings
 * @param {any[] | null | undefined} events  this innings' own log
 * @returns {Map<number, {id: string | null, runs: number}[]>}  over (0-based) → its parts
 */
export function overParts(inn, events) {
  /** @type {Map<number, {id: string | null, runs: number}[]>} */
  const out = new Map();
  const log = Array.isArray(inn?.ballLog) ? inn.ballLog : [];
  /** @param {number} over  @param {{id: string | null, runs: number}} p */
  const put = (over, p) => { const l = out.get(over); if (l) l.push(p); else out.set(over, [p]); };
  // The awards, as projectInnings() reads them: a change in the runs on an event that is not a ball.
  /** @type {{after: number, runs: number, id: string | null}[]} */
  let awards = [];
  if (Array.isArray(events) && events.length) {
    let k = 0, prev = 0;
    try {
      for (const { ev, inn: at } of foldSteps(events)) {
        const runs = Number.isFinite(at.runs) ? at.runs : 0;
        if (ev.kind === KIND.BALL) k++;
        else if (ev.kind === KIND.INNINGS_SUMMARY) { awards = []; k = -1; break; }
        else if (runs !== prev) awards.push({ after: k, runs: runs - prev, id: ev.id ?? null });
        prev = runs;
      }
    } catch { awards = []; k = -1; }
    if (k !== log.length) awards = [];
  }
  let x = 0, lastOver = 0, a = 0;
  const award = (/** @type {number} */ k) => {
    while (a < awards.length && awards[a].after === k) { put(lastOver, { id: awards[a].id, runs: awards[a].runs }); a++; }
  };
  log.forEach((/** @type {any} */ b, /** @type {number} */ k) => {
    award(k);
    const over = Number.isInteger(b.over) ? b.over : Math.floor(x / 6);
    put(over, { id: b.id ?? null, runs: deliveryRuns(b) });
    if (countsInOver(b)) x += 1;
    lastOver = over;
  });
  award(log.length);
  return out;
}

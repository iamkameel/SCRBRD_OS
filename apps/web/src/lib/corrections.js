/**
 * CORRECTIONS, AS EVERY READER SEES THEM (GA-I36 A0, A1:
 * docs/design/GA-I36_corrections_everywhere.md §2, §5, §7).
 *
 * There is no stored "corrected" flag. A correction is in the log already: a
 * `void` naming the event it undoes (a scorer's undo, or an approved
 * amendment, whose time is its approval), or a held ball released into it
 * (`recovered`). So "Corrected 18:42" is read off the log the reader already
 * has, by the same rule the fold uses for what counts (a void counts when its
 * target is an event of this log that is not itself a void). Nothing here
 * folds, and nothing in @scrbrd/scoring changed for it.
 *
 * Shared by the signed-in Match Centre and the public page, so both say a
 * correction the same way. On the public page the log is the redacted one: a
 * void there is its kind, seq, time and a pseudonymous target, with no
 * reason, no requester and no approver, and no released ball is marked; this
 * file never asks for more. Its words are team-level: when, never who or why.
 *
 * Pure (no DOM, no clock but the one passed), so apps/web/test proves it
 * under plain node; and small, because the public page's bundle carries it.
 */

const ZONE = "Africa/Johannesburg";

/**
 * @typedef {{seq: number, at: number | null, kind: "void" | "recovered", innings: number,
 *            target?: string, approved?: boolean}} Correction
 */

/**
 * Every correction in the log, in seq order.
 * @param {any[]} events  the log, as fromRow() or the public log gives it
 * @param {Map<number, number> | null} [recovered]  seq → release time (ms), for a
 *   reader whose rows say `recovered` (the signed-in events read); none on the public page
 * @returns {Correction[]}
 */
export function correctionsOf(events = [], recovered = null) {
  const counted = new Set();
  for (const e of events) if (e && e.kind !== "void" && e.id != null) counted.add(e.id);
  /** @type {Correction[]} */
  const out = [];
  for (const e of events) {
    if (!e) continue;
    if (e.kind === "void") {
      if (counted.has(e.target)) out.push({ seq: e.seq, at: e.clientTs ?? null, kind: "void", innings: e.innings ?? 0, target: e.target, approved: e.amendment != null });
    } else if (recovered?.has(e.seq)) {
      out.push({ seq: e.seq, at: recovered.get(e.seq) ?? null, kind: "recovered", innings: e.innings ?? 0 });
    }
  }
  return out;
}

/** The latest correction's time, or null when there is none (never 0). @param {Correction[]} list */
export function correctedAt(list = []) {
  let at = null;
  for (const c of list) if (c.at != null && (at == null || c.at > at)) at = c.at;
  return at;
}

/**
 * Each innings of the fold that a correction moved, with its latest time:
 * keyed by the fold's own innings object, so a line drawn from one can ask.
 * The fold's innings are the log's innings numbers in ascending order.
 * @param {any[]} events  @param {Correction[]} list  @param {any[]} innings  deriveMatch()'s
 * @returns {Map<any, number>}
 */
export function correctedInnings(events = [], list = [], innings = []) {
  const numbers = [...new Set(events.map((e) => e?.innings ?? 0))].sort((a, b) => a - b);
  /** @type {Map<any, number>} */
  const out = new Map();
  for (const c of list) {
    const inn = innings[numbers.indexOf(c.innings)];
    if (inn && c.at != null && !(out.get(inn) >= c.at)) out.set(inn, c.at);
  }
  return out;
}

/**
 * "18:42" today, "18:42, 11 Oct" on any other day: the fixture's time zone.
 * @param {number | null} ms  @param {number} [now]
 */
export function clockWords(ms, now = Date.now()) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const day = (/** @type {number} */ t) => new Date(t).toLocaleDateString("en-GB", { timeZone: ZONE, day: "numeric", month: "short" });
  const hm = new Date(ms).toLocaleTimeString("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
  return day(ms) === day(now) ? hm : `${hm}, ${day(ms)}`;
}

/**
 * Was this correction made after the match: on a settled match, with no play
 * logged after it (an amendment, a release, an undo with nothing bowled since).
 * @param {any[]} events  @param {Correction} c  @param {boolean} settled
 */
export function afterTheMatch(events, c, settled) {
  return !!settled && !events.some((e) => e && e.seq > c.seq && e.kind !== "void");
}

/** The one quiet commentary line, team-level (§5): when, never who or why. */
export const correctionText = (/** @type {boolean} */ after) =>
  after ? "The scorecard was corrected after the match." : "The scorecard was corrected.";

/**
 * The commentary with one `correction` line for each correction, placed after
 * the last line told from an event before it, in the same over. Never a
 * moment card: the board's moments take only fours, sixes, wickets,
 * milestones and the result (views/matchcentre/live.js). A line whose key
 * already exists is not added twice.
 * @param {{innings: number, over: number, ball: number, kind: string, key: string, text: string}[]} items  deriveCommentary's
 * @param {any[]} events  @param {Correction[]} list  @param {boolean} settled
 */
export function withCorrectionLines(items = [], events = [], list = [], settled = false) {
  if (!list.length) return items;
  /** @type {Map<string, number>} */
  const seqOf = new Map();
  for (const e of events) if (e?.id != null) seqOf.set(e.id, e.seq);
  // Each line's place in the log: its event's seq, or the line before it's.
  let last = -Infinity;
  const at = items.map((it) => {
    const m = /^e:([^#]+)/.exec(it.key ?? "");
    const s = m ? seqOf.get(m[1]) : undefined;
    if (s != null) last = s;
    return last;
  });
  const out = [];
  let k = 0;
  for (const c of list) {
    while (k < items.length && at[k] < c.seq) out.push(items[k++]);
    const prev = [...out].reverse().find((it) => it.innings === c.innings);
    out.push({ innings: c.innings, over: prev?.over ?? 0, ball: prev?.ball ?? 0, kind: "correction",
      text: correctionText(afterTheMatch(events, c, settled)), key: `c:${c.seq}` });
  }
  while (k < items.length) out.push(items[k++]);
  return out;
}

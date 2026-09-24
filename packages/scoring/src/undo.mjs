/**
 * SCRBRD — undo, and the boundary that makes it safe.
 *
 * There are two correct ways to undo a ball, and which one applies depends on
 * something the scorer cannot see: whether the server already has it.
 *
 *   NOT SYNCED — the event has only ever existed on this device. Drop it and
 *     re-derive. Exact, unlimited in depth, and leaves no trace, which is
 *     right: a mis-tap corrected two seconds later is not part of the match's
 *     history.
 *
 *   SYNCED — the server has it, its log is append-only (no UPDATE, no DELETE,
 *     enforced by trigger and by the absence of a policy), and a second device
 *     may already have replayed it. Dropping it locally would leave two devices
 *     disagreeing about history while each stayed internally consistent, with
 *     no evidence left to reconcile them. So the correction is itself an event:
 *     a `void` naming the ball it undoes, appended like any other.
 *
 *   HELD — the server answered for the event and wrote nothing: it refused it
 *     under the Laws, or already holds a different event under its id (db/36;
 *     packages/sync keeps these apart as `held`). It never reached the
 *     server's log and is never sent again, so it is dropped, from wherever it
 *     sits — a void would name an event the server does not have, and be
 *     refused and held in its turn (SCRBRD-071). Dropping it out of the middle
 *     renumbers nothing: every event after it that the server accepted was
 *     judged against a log without it.
 *
 * This is the one place that rule is written. The held sheet's discard
 * (packages/sync held.mjs) is the same move made by hand, and the pad's undo
 * asks this function with the device's held list (held.mjs `undoOnPad`).
 *
 * Getting this wrong is not a subtle bug. It is the failure mode where a
 * scorecard is quietly wrong at the end of a match and nobody can say why.
 *
 * The rule lives here rather than in the scoring screen because it is not a UI
 * concern: it will apply identically on a second device during a handover, and
 * two implementations of it would be one too many.
 */
import { KIND } from "./events.mjs";
import { voidEvent } from "./events.mjs";

/** @import { LogEvent } from "./events.mjs" */

/** Events that must never be undone away — the innings would lose its squads.
 *  @type {ReadonlySet<string>} */
const FOUNDATION = new Set([KIND.INNINGS_START]);

/**
 * Ids this log has already undone.
 * @param {LogEvent[]} [events]
 * @returns {Set<string>}
 */
export function voidedIds(events = []) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const ev of events) if (ev.kind === KIND.VOID && ev.target != null) out.add(ev.target);
  return out;
}

/**
 * The index of the last event that still counts — the one undo should target.
 *
 * Skips voids and anything they have already undone, so pressing undo three
 * times walks back three balls rather than undoing its own corrections.
 * Returns -1 when there is nothing left that may be undone.
 *
 * @param {LogEvent[]} [events]
 * @returns {number}
 */
export function lastUndoableIndex(events = []) {
  const voided = voidedIds(events);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === KIND.VOID) continue;
    if (ev.id != null && voided.has(ev.id)) continue;
    if (FOUNDATION.has(ev.kind)) return -1;
    return i;
  }
  return -1;
}

/**
 * Undo one event.
 *
 * @param {LogEvent[]} [events]  the innings log
 * @param {object} [opts]
 * @param {(ev: LogEvent) => boolean} [opts.isSynced]  has the server accepted
 *   this event? Defaults to treating everything as synced, which is the SAFE
 *   default: it produces a void, and a void is always correct. Truncation is
 *   the optimisation, and an optimisation applied by mistake is what corrupts
 *   a match.
 * @param {(ev: LogEvent) => boolean} [opts.isHeld]  did the server answer
 *   for this event and write nothing? Defaults to no, which leaves every
 *   event to the two rules above. Yes is only for an event the server has
 *   already refused or conflicted on — not one still waiting to be sent, which
 *   the outbox will still deliver.
 * @param {string} [opts.reason]  carried on the void
 * @returns {{events: LogEvent[], action: "truncate" | "drop" | "void" | "none", target: LogEvent | null}}
 *   `drop`: a held event taken out of the log; the caller lets its held copy go.
 */
export function undoLast(events = [], { isSynced = () => true, isHeld = () => false, reason = "scorer_undo" } = {}) {
  const i = lastUndoableIndex(events);
  if (i < 0) return { events, action: "none", target: null };
  const target = events[i];

  // Held: never on the server, never to be. Out of the log wherever it is,
  // last or not, and no void — see HELD above.
  if (isHeld(target)) return { events: events.filter((_, k) => k !== i), action: "drop", target };

  // Truncation is only available when the event is both unsynced AND the last
  // thing in the log. An unsynced event with voids sitting after it cannot be
  // spliced out without renumbering what the server may already hold, so it
  // gets a void like any other.
  if (i === events.length - 1 && !isSynced(target)) {
    return { events: events.slice(0, -1), action: "truncate", target };
  }

  // An event with no id cannot be named by a void, so it cannot be undone once
  // it has left the device. This is reported rather than silently ignored: a
  // scoring surface that mints ids for some events and not others is a bug
  // that would otherwise only surface as an undo button that does nothing.
  if (target.id == null) return { events, action: "none", target };

  return {
    events: [...events, voidEvent({ target: target.id, innings: target.innings ?? 0, reason })],
    action: "void",
    target,
  };
}

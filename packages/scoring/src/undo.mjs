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
 * Getting this wrong is not a subtle bug. It is the failure mode where a
 * scorecard is quietly wrong at the end of a match and nobody can say why.
 *
 * The rule lives here rather than in the scoring screen because it is not a UI
 * concern: it will apply identically on a second device during a handover, and
 * two implementations of it would be one too many.
 */
import { KIND } from "./events.mjs";
import { voidEvent } from "./events.mjs";

/** Events that must never be undone away — the innings would lose its squads. */
const FOUNDATION = new Set([KIND.INNINGS_START]);

/** Ids this log has already undone. */
export function voidedIds(events = []) {
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
 * @param events  the innings log
 * @param isSynced (event) => boolean — has the server accepted this event?
 *   Defaults to treating everything as synced, which is the SAFE default: it
 *   produces a void, and a void is always correct. Truncation is the
 *   optimisation, and an optimisation applied by mistake is what corrupts a
 *   match.
 * @returns { events, action, target } — action is "truncate" | "void" | "none"
 */
export function undoLast(events = [], { isSynced = () => true, reason = "scorer_undo" } = {}) {
  const i = lastUndoableIndex(events);
  if (i < 0) return { events, action: "none", target: null };
  const target = events[i];

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

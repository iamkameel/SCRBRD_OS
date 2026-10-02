/**
 * THE ROTATION — which panel the ground display shows under the Board
 * (SCRBRD-133 §2.2–2.4, D9). Pure: no React, no clock of its own, no DOM, so
 * apps/web/test/rotation.test.mjs proves every rule with a hand-held clock.
 *
 * The score never leaves the screen: the Board is a fixed band, and beneath
 * it one panel at a time takes a turn — twelve seconds each (Long: 24), in a
 * fixed order. The rules:
 *
 *   SKIP     a panel with nothing true to show is skipped, never drawn empty
 *            (`available` says which have something); a panel that empties
 *            while it is up gives way at once.
 *   HOLD     the innings break, the result, a stop and the pre-toss facts
 *            hold the panel area for as long as they are true; the cycle
 *            stands still under them and goes on where it was when they go.
 *   INTERRUPT a wicket cuts to the fall of the wicket for eight seconds and
 *            then the cycle RESUMES WHERE IT WAS — the same panel, with the
 *            dwell it had left — so the first panel is not the only one
 *            anybody ever sees.
 *   PAUSE    the signed-in big screen's Space: the current panel's clock
 *            stops. The ground display has no pause: nothing on it is pressed.
 *
 * G1 rotates panels 2, 3 and 4 (§2.2: partnership, over story, bowling). The
 * worm (1), runs per over (5) and where the runs went (6) join in G2 and G3,
 * at their places in CYCLE.
 */

/** The cycle, in §2.2's order — G1's three. */
export const CYCLE = Object.freeze(["partnership", "overs", "bowling"]);

/** How long a panel stays (§2.3): Normal 12 s, Long 24 s (the setup's choice, D14). */
export const DWELL_MS = Object.freeze({ normal: 12_000, long: 24_000 });

/** The fall of a wicket holds the panel area this long, then the cycle resumes (§2.4). */
export const FOW_MS = 8_000;

/** The panels that hold while they are true (§2.2: 8, 9, 10, 11). */
export const HOLDS = Object.freeze(["pretoss", "break", "result", "stopped"]);

/**
 * @typedef {object} RotationState
 * @property {number} at        index into CYCLE of the panel in its turn; -1 before the first
 * @property {number} elapsed   ms the panel in its turn has been shown (holds, interrupts and a pause do not count)
 * @property {number} last      the clock at the last step
 * @property {{panel: string, until: number} | null} interrupt
 */

/** @param {number} now  @returns {RotationState} */
export const startRotation = (now) => ({ at: -1, elapsed: 0, last: now, interrupt: null });

/** @param {Set<string> | string[]} available  @param {string} p */
const has = (available, p) => (Array.isArray(available) ? available.includes(p) : available.has(p));

/**
 * The next panel in the cycle after `from` that has something to show,
 * wrapping; -1 when none has.
 * @param {number} from  @param {Set<string> | string[]} available
 */
export function nextAvailable(from, available) {
  for (let k = 1; k <= CYCLE.length; k++) {
    const i = (((from + k) % CYCLE.length) + CYCLE.length) % CYCLE.length;
    if (has(available, CYCLE[i])) return i;
  }
  return -1;
}

/**
 * One step of the clock.
 * @param {RotationState} state
 * @param {{now: number, available: Set<string> | string[], hold?: string | null, dwellMs?: number, paused?: boolean}} o
 * @returns {{state: RotationState, panel: string | null}}  the panel to draw: a hold, an interrupt, a panel of the cycle, or none
 */
export function stepRotation(state, { now, available, hold = null, dwellMs = DWELL_MS.normal, paused = false }) {
  /** @type {RotationState} */
  let s = { ...state, last: now };
  // A hold covers everything, and the cycle's clock stands still under it.
  if (hold) return { state: s, panel: hold };
  // The panel's clock runs from the last step — or, the step an interrupt
  // ends on, from the moment it ended: not a millisecond of the card counts.
  let since = state.last;
  if (s.interrupt) {
    if (now < s.interrupt.until) return { state: s, panel: s.interrupt.panel };
    since = Math.max(since, s.interrupt.until);
    s = { ...s, interrupt: null };
  }
  const dt = Math.max(0, now - since);
  // The panel in its turn has nothing (or there is none yet): the next that has.
  if (s.at < 0 || !has(available, CYCLE[s.at])) {
    const at = nextAvailable(s.at, available);
    return { state: { ...s, at, elapsed: 0 }, panel: at < 0 ? null : CYCLE[at] };
  }
  const elapsed = s.elapsed + (paused ? 0 : dt);
  if (elapsed >= dwellMs) {
    const at = nextAvailable(s.at, available);
    return { state: { ...s, at, elapsed: 0 }, panel: at < 0 ? null : CYCLE[at] };
  }
  return { state: { ...s, elapsed }, panel: CYCLE[s.at] };
}

/**
 * Cut to `panel` for `ms` (the fall of a wicket, §2.4). The panel in its turn
 * keeps its place and its elapsed time, and is what comes back.
 * @param {RotationState} state  @param {string} panel  @param {number} now  @param {number} [ms]
 * @returns {RotationState}
 */
export function interruptRotation(state, panel, now, ms = FOW_MS) {
  return { ...state, interrupt: { panel, until: now + ms } };
}

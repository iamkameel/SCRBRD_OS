/**
 * A tap that places the ball must not also press what replaces the field.
 *
 * The field places the ball on `pointerup` (panels.jsx, the capture circle),
 * and the pad at once swaps the Area step for the Outcome step (pad.jsx): the
 * Wicket key, 2 3 4 6, and the big 0 and 1, drawn where the field was. But a
 * finger's tap does not end at `pointerup`. The browser follows it with the
 * mouse events it emulates for touch — `mousedown`, `mouseup`, then `click` —
 * hit-tested again at the same point, after React has re-rendered. They land
 * on the key now under the finger: one tap on the field opened the wicket
 * sheet, or recorded a 1 or a 4 with no Outcome chosen (Kameel, on the live
 * app on his phone, 11 Nov 2026; reproduced with touch emulation, the ball
 * log read back from the server). A mouse does the same with its `mouseup`
 * and `click`.
 *
 * So, from the placing `pointerup`, the rest of that same tap is swallowed:
 * its emulated mouse events and its click, before any handler sees them.
 * It ends at the click, at the next `pointerdown` (a new touch or press is a
 * new tap, and is never swallowed), or after `ms`, whichever comes first. A
 * click from the keyboard (Enter or Space: `detail` 0) is never one of them.
 *
 * It decides nothing about what a tap records: it only stops one tap counting twice.
 */
const FOLLOW = ["mousedown", "mouseup", "click", "dblclick", "contextmenu"];

let disarm = null;

/**
 * Swallow the rest of the tap that has just ended in `pointerup`.
 * @param {number} [ms] the longest it waits for that tap's click
 * @returns {() => void} ends it early
 */
export function swallowFollowThrough(ms = 1000) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  disarm?.();
  /** @param {Event} e */
  const stop = (e) => {
    if (e.type === "click" && /** @type {MouseEvent} */ (e).detail === 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "click") end();
  };
  const end = () => {
    for (const t of FOLLOW) window.removeEventListener(t, stop, true);
    window.removeEventListener("pointerdown", end, true);
    clearTimeout(timer);
    if (disarm === end) disarm = null;
  };
  for (const t of FOLLOW) window.addEventListener(t, stop, true);
  window.addEventListener("pointerdown", end, true);
  const timer = setTimeout(end, ms);
  disarm = end;
  return end;
}

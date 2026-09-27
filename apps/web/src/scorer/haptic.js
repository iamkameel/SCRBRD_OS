/**
 * The haptic tick: a 10 ms buzz when a ball is recorded (SCRBRD-100 item 4),
 * beside the visual change the pad already makes (the board's figures flip).
 * Nothing more — no pattern, no second buzz for a boundary — and:
 *
 *   - only where the device has `navigator.vibrate` (most Android browsers;
 *     iOS Safari has none, and gets the visual change alone);
 *   - never when the device asks for reduced motion;
 *   - never when the scorer has switched it off on the pad's menu, which is
 *     remembered on this device, like the theme and the colours (§3.9);
 *   - fire and forget: it cannot throw, block or delay the next input.
 */

export const HAPTIC_KEY = "scrbrd:haptic";

/** Is the tick switched on for this device? On unless switched off. */
export function hapticOn() {
  try { return localStorage.getItem(HAPTIC_KEY) !== "off"; } catch { return true; }
}

/** Switch it on or off for this device. On stores nothing. */
export function setHapticOn(on) {
  try {
    if (on) localStorage.removeItem(HAPTIC_KEY);
    else localStorage.setItem(HAPTIC_KEY, "off");
  } catch { /* private window: the choice lasts as long as the page */ }
}

/** Does the device ask for reduced motion? */
export function reducedMotion() {
  try { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; } catch { return false; }
}

/**
 * Whether a tick would buzz on this device now, and why not, in words — for
 * the menu's hint. `null` when it would.
 */
export function hapticUnavailable() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return "This device cannot buzz.";
  if (reducedMotion()) return "Off while this device is set to reduce motion.";
  return null;
}

/** One tick, if the device can and the scorer and the device allow it. */
export function hapticTick() {
  try {
    if (!hapticOn() || reducedMotion()) return;
    navigator.vibrate?.(10);
  } catch { /* never in the way of the next ball */ }
}

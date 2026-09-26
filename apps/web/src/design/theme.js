/**
 * The theme engine — Daylight, Floodlit, or whatever the device says.
 *
 * DESIGN_DIRECTION §3.1 / decision 2: the whole app has both themes. It
 * follows the device's system setting by default (`prefers-color-scheme`,
 * LIVE — a phone that switches to light at sunrise switches the pad with it),
 * and a person can override it — System, Daylight or Floodlit — in Settings
 * and from the pad's menu. The choice is remembered ON THIS DEVICE: a scorer's
 * phone in the sun and the office desktop are different places, and a
 * preference that followed the account would be wrong on one of them.
 *
 * WHAT A SWITCH DOES. tokens.js keeps every token as a hex string and
 * rewrites the values in place (why is written there); this module decides
 * WHICH theme, calls applyTheme(), paints what React does not own — the
 * <html> background, `color-scheme`, the browser's theme-color — and tells
 * subscribers, so the React root re-renders with the new values.
 *
 * BEFORE REACT. index.html carries a few lines that make the same first
 * decision before any module loads, so the page never paints in the wrong
 * theme and flips. They read the same key; design.test.mjs holds the two
 * together.
 *
 * Storage is localStorage, synchronously, because the answer is needed before
 * the first paint; every read and write is guarded, and a device that will not
 * store anything (private mode, blocked storage) simply follows its system
 * setting.
 */
import { useSyncExternalStore } from "react";
import { T, applyTheme, themeName, visionName } from "./tokens.js";

/** The localStorage key. index.html's boot script reads the same one. */
export const THEME_KEY = "scrbrd:theme";

/** What a person can choose, in the order it is offered. */
export const THEME_CHOICES = [
  { value: "system",   label: "System",   hint: "Follow this device" },
  { value: "daylight", label: "Daylight", hint: "Light, for the sun" },
  { value: "floodlit", label: "Floodlit", hint: "Dark, under lights" },
];
const CHOSEN = new Set(THEME_CHOICES.map((c) => c.value));

/**
 * COLOURS — the second axis (DESIGN_DIRECTION §3.9, SCRBRD-096). It moves only
 * the tokens whose meaning rides on hue (tokens.js VISION) and combines with
 * either theme. Remembered on this device, like the theme, under its own key;
 * Standard is stored as nothing, so a device that has never chosen follows
 * the default.
 */
export const VISION_KEY = "scrbrd:vision";
export const VISION_CHOICES = [
  { value: "standard",   label: "Standard",         hint: "The colours as drawn" },
  { value: "redgreen",   label: "Red-green safe",   hint: "For protan and deutan colour vision" },
  { value: "blueyellow", label: "Blue-yellow safe", hint: "For tritan colour vision" },
];
const VISIONS = new Set(VISION_CHOICES.map((c) => c.value));

/** The stored palette, or "standard" when there is none or it cannot be read. */
export function readVision() {
  try {
    const v = globalThis.localStorage?.getItem(VISION_KEY);
    return VISIONS.has(v) ? v : "standard";
  } catch {
    return "standard";
  }
}

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** The stored override, or "system" when there is none or it cannot be read. */
export function readPreference() {
  try {
    const v = globalThis.localStorage?.getItem(THEME_KEY);
    return CHOSEN.has(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** The theme the device asks for. Floodlit when it cannot say. */
export function systemTheme() {
  try {
    return globalThis.matchMedia?.(LIGHT_QUERY).matches ? "daylight" : "floodlit";
  } catch {
    return "floodlit";
  }
}

/** A preference resolved to a theme. */
export const resolveTheme = (pref) => (pref === "daylight" || pref === "floodlit" ? pref : systemTheme());

let preference = readPreference();
let vision = readVision();
const listeners = new Set();
let snapshot = `${preference}|${themeName()}|${visionName()}`;

/**
 * What React does not render: the document itself. The <html> background is
 * what shows past the end of a short page and under an overscroll bounce;
 * `color-scheme` is what the browser draws scrollbars and form controls in;
 * theme-color is the browser's own chrome on a phone.
 */
function paintDocument(theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.vision = vision;
  root.style.colorScheme = theme === "daylight" ? "light" : "dark";
  root.style.background = T.surface.canvas;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute("content", T.surface.canvas);
}

/** Apply whatever the preference, the palette and the device now say, and tell subscribers. */
function sync() {
  const theme = resolveTheme(preference);
  if (theme !== themeName() || vision !== visionName()) applyTheme(theme, vision);
  paintDocument(theme);
  const next = `${preference}|${theme}|${vision}`;
  if (next !== snapshot) {
    snapshot = next;
    for (const fn of listeners) fn();
  }
}

/**
 * Choose a theme on this device. "system" removes the override rather than
 * storing it, so the device's own setting is followed again.
 */
export function setPreference(pref) {
  preference = CHOSEN.has(pref) ? pref : "system";
  try {
    if (preference === "system") globalThis.localStorage?.removeItem(THEME_KEY);
    else globalThis.localStorage?.setItem(THEME_KEY, preference);
  } catch { /* not stored: it holds for this page, and the device's setting returns on reload */ }
  sync();
}

/** The current preference ("system" | "daylight" | "floodlit"). */
export const getPreference = () => preference;

/**
 * Choose a colour-vision palette on this device. "standard" removes the
 * stored choice rather than storing it.
 */
export function setVision(v) {
  vision = VISIONS.has(v) ? v : "standard";
  try {
    if (vision === "standard") globalThis.localStorage?.removeItem(VISION_KEY);
    else globalThis.localStorage?.setItem(VISION_KEY, vision);
  } catch { /* not stored: it holds for this page, and Standard returns on reload */ }
  sync();
}

/** The current palette ("standard" | "redgreen" | "blueyellow"). */
export const getVision = () => vision;

/** Subscribe to switches; returns the unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Live, from here on. The system setting can change while the app is open (a
// phone's automatic dark mode at dusk), and another tab can change the
// override; both apply without a reload.
if (typeof window !== "undefined") {
  try {
    const mq = window.matchMedia?.(LIGHT_QUERY);
    const onChange = () => { if (preference === "system") sync(); };
    if (mq?.addEventListener) mq.addEventListener("change", onChange);
    else mq?.addListener?.(onChange);
  } catch { /* no media queries: the preference still works */ }
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY || e.key === VISION_KEY || e.key === null) { preference = readPreference(); vision = readVision(); sync(); }
  });
}

// The first decision. index.html's boot script has normally made it already
// and tokens.js started in it; this is the same answer, reached with the
// module's own reading of storage and the device.
sync();

/**
 * The theme, for React: `{ preference, theme, vision, setPreference,
 * setVision }`. The app root calls this so that a switch — of the theme or of
 * the palette — re-renders the whole tree: every inline style reads the
 * tokens again, and GLOBAL_CSS is the new sheet.
 */
export function useTheme() {
  const snap = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  const [pref, theme, v] = snap.split("|");
  return { preference: pref, theme, vision: v, setPreference, setVision };
}

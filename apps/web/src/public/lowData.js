import { useCallback, useEffect, useState } from "react";

/**
 * LOW DATA on the public match page (CRI-2.4, docs/design/CRICINFO_GAP_PLAN.md):
 * for a spectator at a ground with weak signal. When it is on, the page
 *
 *   · draws no chart (the worm, the rate track, the side's wheel), so their
 *     chunks are never fetched, and does not read /par or /shots;
 *   · keeps to the phone's own type: the web fonts are never downloaded
 *     (PublicMatch.jsx's Frame);
 *   · reads the score less often — a quarter of the live pace, half the
 *     pre-start pace — and, while live, only the log's new events
 *     (`?since=`), as the ground display does.
 *
 * It is never a different page: the same score, the same names under the
 * same rule, the same tabs. Nothing about a child is decided here.
 *
 * It turns itself on when the browser says Save-Data or a slow connection,
 * unless this device chose; a choice either way is remembered on the device
 * (localStorage, per origin) and wins over what the browser says, so the
 * switch always turns it off.
 */

/** Where the device's choice is kept: "on" or "off"; nothing is no choice. */
export const LOW_DATA_KEY = "scrbrd.public.lowData";
/** NetworkInformation's effectiveType values that count as slow. */
const SLOW = new Set(["slow-2g", "2g", "3g"]);
/** How much slower the page reads in Low data: the live pace, and the pace before the start. */
export const LOW_LIVE_FACTOR = 4;
export const LOW_SOON_FACTOR = 2;

/**
 * What the browser says of the connection: "save-data", "slow", or null.
 * @param {any} [conn]  navigator.connection, where the browser has it
 * @returns {"save-data" | "slow" | null}
 */
export function connectionAsks(conn = typeof navigator !== "undefined" ? /** @type {any} */ (navigator).connection : undefined) {
  if (!conn) return null;
  if (conn.saveData === true) return "save-data";
  return SLOW.has(String(conn.effectiveType ?? "")) ? "slow" : null;
}

/**
 * The device's remembered choice, or null; never throws (a private window, blocked storage).
 * @param {Pick<Storage, "getItem"> | null} [store]
 * @returns {boolean | null}
 */
export function storedChoice(store) {
  try {
    const v = (store ?? globalThis.localStorage)?.getItem(LOW_DATA_KEY);
    return v === "on" ? true : v === "off" ? false : null;
  } catch { return null; }
}

/**
 * On or off, and why: a choice wins; else the browser's word; else off.
 * @param {boolean | null} choice  @param {"save-data" | "slow" | null} asks
 * @returns {{on: boolean, why: "chosen" | "save-data" | "slow" | null}}
 */
export function lowDataState(choice, asks) {
  if (choice != null) return { on: choice, why: "chosen" };
  return asks ? { on: true, why: asks } : { on: false, why: null };
}

/** The page's Low data: its state, and `set` to choose (remembered on this device). */
export function useLowData() {
  const [choice, setChoice] = useState(() => storedChoice());
  const [asks, setAsks] = useState(() => connectionAsks());
  useEffect(() => {
    const conn = /** @type {any} */ (navigator).connection;
    if (!conn?.addEventListener) return undefined;
    const on = () => setAsks(connectionAsks(conn));
    conn.addEventListener("change", on);
    return () => conn.removeEventListener("change", on);
  }, []);
  const set = useCallback((/** @type {boolean} */ on) => {
    setChoice(on);
    try { globalThis.localStorage?.setItem(LOW_DATA_KEY, on ? "on" : "off"); } catch { /* kept for this visit only */ }
  }, []);
  return { ...lowDataState(choice, asks), set };
}

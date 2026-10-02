import { useCallback, useEffect, useRef, useState } from "react";
import { DWELL_MS, FOW_MS, interruptRotation, startRotation, stepRotation } from "./rotation.js";

/**
 * The rotation's clock (display/rotation.js is the rule; this only steps it).
 * A quarter-second tick is plenty for a twelve-second dwell and costs a TV
 * browser nothing: a step is a few comparisons and a re-render only when the
 * panel changes.
 *
 * The dwell is the setup's choice (Normal 12 s, Long 24 s). A browser walk may
 * shorten it through `window.__SCRBRD_DISPLAY_DWELL_MS__` (never under half a
 * second), read at every step so a walk can change it while the page is open
 * — the same kind of hook as the live poll's `__SCRBRD_LIVE_MS__`.
 *
 * @param {{available: Set<string>, hold: string | null, dwell: "normal" | "long", paused?: boolean}} o
 * @returns {{panel: string | null, interrupt: (panel: string, ms?: number) => void}}
 */
export function useRotation({ available, hold, dwell, paused = false }) {
  const state = useRef(startRotation(Date.now()));
  const inputs = useRef({ available, hold, dwell, paused });
  inputs.current = { available, hold, dwell, paused };
  const [panel, setPanel] = useState(() => stepRotation(state.current, { now: Date.now(), available, hold, dwellMs: dwellMs(dwell) }).panel);

  const step = useCallback(() => {
    const i = inputs.current;
    const r = stepRotation(state.current, { now: Date.now(), available: i.available, hold: i.hold, dwellMs: dwellMs(i.dwell), paused: i.paused });
    state.current = r.state;
    setPanel(r.panel);
  }, []);

  useEffect(() => {
    const t = setInterval(step, 250);
    return () => clearInterval(t);
  }, [step]);
  // What is available or held changed (a read came in): step now, not at the next tick.
  useEffect(() => { step(); }, [available, hold, step]);

  const interrupt = useCallback((/** @type {string} */ p, ms = FOW_MS) => {
    state.current = interruptRotation(state.current, p, Date.now(), ms);
    step();
  }, [step]);
  return { panel, interrupt };
}

/** @param {"normal" | "long"} dwell */
function dwellMs(dwell) {
  const asked = typeof window !== "undefined" ? Number(/** @type {any} */ (window).__SCRBRD_DISPLAY_DWELL_MS__) : NaN;
  if (Number.isFinite(asked) && asked >= 500) return asked;
  return DWELL_MS[dwell] ?? DWELL_MS.normal;
}

import { useEffect, useRef, useState } from "react";
import { T } from "../../design/tokens.js";

/**
 * The spectator board's moments (Kameel's premium-feel checklist, step 3c):
 * delight lives on spectator surfaces only, never on the pad, and it never
 * hides the score. Everything here reads the commentary generator's lines —
 * the fold's own story — so a reload shows the match as it stands and plays
 * nothing: only a line that ARRIVES while the page is open is a moment.
 */

/** A four, a six or a wicket: a short beat. A milestone: a bigger one. */
const BEAT = new Set(["four", "six", "wicket"]);
/**
 * How long each shows: over the board's left-hand corner, never its total,
 * and under a second and a half, so the score is never kept from anyone.
 */
const BEAT_MS = 1200, MILESTONE_MS = 1500;
/** The gentle over summary between overs. */
export const OVER_SUMMARY_MS = 6000;
/** At most this many moments wait their turn; a burst after a slow read plays its latest. */
const QUEUE_MAX = 4;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The lines that arrived since the first read, as they arrive.
 * @param {{key: string}[]} items  deriveCommentary's
 * @param {boolean} ready  the first read is in
 */
function useArrivals(items, ready) {
  const seen = useRef(null);
  const [arrived, setArrived] = useState({ n: 0, items: [] });
  useEffect(() => {
    if (!ready) return;
    if (seen.current == null) { seen.current = new Set(items.map((i) => i.key)); return; }
    const fresh = items.filter((i) => !seen.current.has(i.key));
    for (const i of fresh) seen.current.add(i.key);
    if (fresh.length) setArrived((a) => ({ n: a.n + 1, items: fresh }));
  }, [items, ready]);
  return arrived;
}

/**
 * The moment on show (a line of commentary with its kind, or null) and the
 * over summary on show (the generator's end-of-over line, or null).
 */
export function useMoments(items, ready) {
  const arrived = useArrivals(items, ready);
  const queue = useRef([]);
  const [moment, setMoment] = useState(null);
  const [overSummary, setOverSummary] = useState(null);

  useEffect(() => {
    if (!arrived.n) return;
    const next = arrived.items.filter((i) => BEAT.has(i.kind) || i.kind === "milestone");
    queue.current = [...queue.current, ...next].slice(-QUEUE_MAX);
    if (!moment && queue.current.length) setMoment(queue.current.shift());
    const end = arrived.items.filter((i) => i.kind === "over_end").pop();
    if (end) setOverSummary(end);
    // Only the arrivals decide; the moment on show is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);

  useEffect(() => {
    if (!moment) return undefined;
    const t = setTimeout(() => setMoment(queue.current.shift() ?? null), moment.kind === "milestone" ? MILESTONE_MS : BEAT_MS);
    return () => clearTimeout(t);
  }, [moment]);

  useEffect(() => {
    if (!overSummary) return undefined;
    const t = setTimeout(() => setOverSummary(null), OVER_SUMMARY_MS);
    return () => clearTimeout(t);
  }, [overSummary]);

  return { moment, overSummary };
}

/**
 * The run count as it ticks up to a new total, one run a flip (190 ms, the
 * board's own), rather than jumping. The first figure is shown as it is; a
 * new innings, a fall (an amendment) or reduced motion cut straight to it;
 * a big gap closes its last eight runs a tick at a time.
 * @param {number | null | undefined} value  @param {string} scope  which innings the figure is
 */
export function useTicker(value, scope) {
  const [state, setState] = useState({ shown: value, scope });
  let { shown } = state;
  if (state.scope !== scope) { shown = value; setState({ shown: value, scope }); }
  useEffect(() => {
    if (value == null || shown === value) return undefined;
    // The first figure the read brings is shown as it is.
    if (shown == null) { setState({ shown: value, scope }); return undefined; }
    if (value < shown || reducedMotion()) { setState({ shown: value, scope }); return undefined; }
    const step = parseInt(T.motion.flip, 10) || 190;
    const t = setTimeout(() => setState({ shown: Math.max(shown + 1, value - 8), scope }), step);
    return () => clearTimeout(t);
  }, [value, shown, scope]);
  return shown ?? value;
}

/**
 * How often a live match is read again while it is open. A test (or a big
 * screen at a ground) may ask for more often through
 * `window.__SCRBRD_LIVE_MS__`; never under a second.
 */
export function liveRefreshMs() {
  const asked = typeof window !== "undefined" ? Number(window.__SCRBRD_LIVE_MS__) : NaN;
  return Number.isFinite(asked) && asked >= 1000 ? asked : 15000;
}

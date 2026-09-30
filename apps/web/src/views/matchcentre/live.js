import { useEffect, useRef, useState } from "react";
import { T } from "../../design/tokens.js";
import { announceArrivals } from "../../lib/announce.js";

/**
 * The spectator board's moments (Kameel's premium-feel checklist, step 3c):
 * delight lives on spectator surfaces only, never on the pad, and it never
 * hides the score. Everything here reads the commentary generator's lines —
 * the fold's own story — so a reload shows the match as it stands and plays
 * nothing: only a line that ARRIVES while the page is open is a moment.
 */

/** A four, a six or a wicket: a short beat. A milestone or the result: a bigger one. */
const BEAT = new Set(["four", "six", "wicket"]);
/** The bigger moments — never longer than the milestone slot (§3.6: never over about 1.5s). */
const BIG = new Set(["milestone", "result"]);
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
export function useArrivals(items, ready) {
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
 * What a screen-reader user is told as play arrives (WCAG 4.1.3): the latest
 * ball or the end of the over, in plain words (lib/announce.js), and nothing at
 * all for the log as it was on first load. It rides on the same arrivals as the
 * moments — a line is new only if it was not in the first read — so a reload
 * and a reconnect replay nothing.
 *
 * `n` counts the announcements, so the page can key its live region on it: the
 * same words twice in a row ("One run", "One run") are two announcements, and
 * a region whose text did not change would say only the first.
 * @param {{kind: string, key: string}[]} items  deriveCommentary's
 * @param {any[]} events  the log it was told from
 * @param {boolean} ready  the first read is in
 * @returns {{n: number, text: string}}
 */
export function useAnnouncement(items, events, ready) {
  const arrived = useArrivals(items, ready);
  const [said, setSaid] = useState({ n: 0, text: "" });
  useEffect(() => {
    if (!arrived.n) return;
    const text = announceArrivals(arrived.items, events ?? []);
    if (text) setSaid((s) => ({ n: s.n + 1, text }));
    // Only an arrival announces; `events` is read as it stood with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);
  return said;
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
    const next = arrived.items.filter((i) => BEAT.has(i.kind) || BIG.has(i.kind));
    queue.current = [...queue.current, ...next].slice(-QUEUE_MAX);
    if (!moment && queue.current.length) setMoment(queue.current.shift());
    const end = arrived.items.filter((i) => i.kind === "over_end").pop();
    if (end) setOverSummary(end);
    // Only the arrivals decide; the moment on show is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);

  useEffect(() => {
    if (!moment) return undefined;
    const t = setTimeout(() => setMoment(queue.current.shift() ?? null), BIG.has(moment.kind) ? MILESTONE_MS : BEAT_MS);
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

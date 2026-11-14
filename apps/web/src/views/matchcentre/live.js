import { useEffect, useRef, useState } from "react";
import { T } from "../../design/tokens.js";
import { announceArrivals } from "../../lib/announce.js";
import { endsHeld, enqueue, isGap, lineBall, momentsFrom, SHOW_MS } from "../../lib/moments.js";

/**
 * The spectator board's moments (Kameel's premium-feel checklist, step 3c):
 * delight lives on spectator surfaces only, never on the pad, and it never
 * hides the score. Everything here reads the commentary generator's lines —
 * the fold's own story — so a reload shows the match as it stands and plays
 * nothing: only a line that ARRIVES while the page is open is a moment.
 */

/** The gentle over summary between overs (SCRBRD-133 §5.2 row 10). */
export const OVER_SUMMARY_MS = 6000;

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
 * The moment on show and the over summary on show (SCRBRD-133 §5,
 * EXPERIENCE_PASS Slice 2). Which card a read earns, its size, its time, the
 * merge and the queue are lib/moments.js's, one module for the Match Centre,
 * the public page and the ground display; this hook only keeps the time.
 *
 * `innings` is the fold the lines were told from (the page's played innings):
 * the fold before a read and after it are what a card is matched on, as the
 * catalogue's triggers say. `side` names a side, as the page writes it.
 *
 * Only what arrives while the page is open: the first read seeds what has
 * been seen, so a reload plays nothing; a line on a ball an earlier read
 * already drew (a correction moved it there, GA-I36) is no card. A held card
 * (play stopped, a super over tied) stays until play moves again: a delivery,
 * an interruption's line or an innings starting or ending, never a quiet
 * correction line. The result shows for the long time (6 s) and the page's
 * result view, or the display's Result panel, holds it from there. A gap
 * (more than six deliveries in one read) plays no card and no over summary.
 * @param {{key: string, kind: string}[]} items  the commentary lines, with any synthetic result line
 * @param {boolean} ready  the first read is in
 * @param {any[] | null} [innings]  the fold's innings those lines were told from
 * @param {(inn: any) => string} [side]
 * @param {string[] | null} [focus]  a family's or a pupil's screen: the ids it is for (Q10)
 */
export function useMoments(items, ready, innings = null, side = undefined, focus = null) {
  const seen = useRef(/** @type {Set<string> | null} */ (null));
  const balls = useRef(/** @type {Set<string>} */ (new Set()));
  const last = useRef(/** @type {any[] | null} */ (null));
  const queue = useRef(/** @type {any[]} */ ([]));
  const showing = useRef(/** @type {any} */ (null));
  const named = useRef(side);
  const lit = useRef(focus);
  const [moment, setMoment] = useState(/** @type {any} */ (null));
  const [overSummary, setOverSummary] = useState(/** @type {any} */ (null));
  useEffect(() => { named.current = side; lit.current = focus; });
  const show = (/** @type {any} */ card) => { showing.current = card ?? null; setMoment(card ?? null); };

  useEffect(() => {
    if (!ready) return;
    const drawn = balls.current;
    if (seen.current == null) {
      seen.current = new Set(items.map((i) => i.key));
      for (const i of items) { const b = lineBall(i); if (b) drawn.add(b); }
      last.current = innings;
      return;
    }
    const was = seen.current;
    const fresh = items.filter((i) => !was.has(i.key));
    for (const i of fresh) was.add(i.key);
    const before = last.current;
    last.current = innings;
    if (!fresh.length) return;
    const cards = momentsFrom(fresh, before ? { innings: before } : null, { innings: innings ?? [] },
      { ...(named.current ? { side: named.current } : {}), seen: new Set(drawn), focus: lit.current });
    for (const i of fresh) { const b = lineBall(i); if (b) drawn.add(b); }
    // A held card gives way once play moves again or the result comes, never to a quiet correction line.
    if (endsHeld(showing.current, fresh, cards)) show(null);
    queue.current = enqueue(queue.current, cards, showing.current);
    if (!showing.current && queue.current.length) show(queue.current.shift());
    const end = isGap(fresh) ? null : fresh.filter((i) => i.kind === "over_end").pop();
    if (end) setOverSummary(end);
    // Only the arrivals decide; `innings` is read as it stood with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ready]);

  useEffect(() => {
    if (!moment) return undefined;
    const ms = moment.ms ?? (moment.kind === "result" ? SHOW_MS.long : null);
    if (ms == null) return undefined;
    const t = setTimeout(() => show(queue.current.shift() ?? null), ms);
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

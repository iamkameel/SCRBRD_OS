/**
 * CRI-1.5: from a dismissal on the Scorecard to that ball in the Commentary,
 * and back to where the reader was (docs/design/CRICINFO_GAP_PLAN.md §6, G5).
 *
 * The Scorecard's opened row names its dismissal's commentary line by the
 * line's key (lib/matchCentre.js dismissalKey(): `e:<event id>`, the same key
 * the line carries as data-key). The Commentary opens far enough back to hold
 * that line — its "Earlier overs" may have hidden it — and brings it to the
 * middle of the screen with the focus on it. Coming back, the Scorecard opens
 * the same row of the same innings and puts the page where it was.
 *
 * No import, so the public page's bundle may share it with the signed-in one.
 */

/**
 * Which over's group (commentaryByOver(), newest first) holds the line with
 * this key: its index, or -1.
 * @param {{lines: {key: string}[]}[]} groups  @param {string | null | undefined} key
 */
export function groupOf(groups, key) {
  if (!key) return -1;
  return groups.findIndex((g) => g.lines.some((c) => c.key === key));
}

/**
 * How many over groups the Commentary shows at first: `base`, or as many as
 * reach back to the line asked for.
 * @param {{lines: {key: string}[]}[]} groups  @param {string | null | undefined} key  @param {number} base
 */
export function shownFor(groups, key, base) {
  return Math.max(base, groupOf(groups, key) + 1);
}

/**
 * The element that scrolls the page `el` sits in: the nearest ancestor that
 * scrolls vertically (the shell's <main>), else the document's own scroller.
 * @param {Element | null | undefined} el
 * @returns {Element}
 */
export function scrollerOf(el) {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY;
    if ((y === "auto" || y === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement ?? document.documentElement;
}

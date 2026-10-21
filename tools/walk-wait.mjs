/**
 * Waits for the browser walks that end on the page's own state, not a clock.
 *
 * A walk that judges a screen after a fixed sleep judges whatever was drawn by
 * then. When the read behind the screen is slower than the sleep, as it is on
 * a loaded CI runner, the check sees the placeholder and fails, or worse,
 * passes on the wrong state. `afterReads(page, ms)` keeps the walk's own
 * sleep as a floor, so nothing is judged sooner than it was, and then waits
 * until the page has no request to the API in flight, so nothing is judged
 * while the read that draws it is still on the wire.
 *
 *   const page = await ctx.newPage();
 *   watchReads(page);                     // from the first request on
 *   …
 *   await afterReads(page, 1200);         // in place of page.waitForTimeout(1200)
 *   ok("the list shows the fixture", …);
 *
 * Only fetch and XHR requests count: the app's data comes over fetch, and a
 * script or an image is not a read. The wait ends QUIET_MS after the last one
 * settles (finished or failed), so a read that the first read's render starts
 * is waited for too, and it gives up after BOUND_MS: a request a walk holds
 * open on purpose (a route that waits on a gate) costs that bound, never a
 * hang. Short sleeps that only let an animation run or a debounce fire stay
 * waitForTimeout; they judge nothing.
 */

const QUIET_MS = 150;
const BOUND_MS = 15000;

/** @typedef {{ inflight: Set<unknown>, last: number }} Watch */
/** @type {WeakMap<object, Watch>} */
const watches = new WeakMap();

/** A Page, from a Page or anything with page() (a Frame). */
const pageOf = (/** @type {any} */ target) => (typeof target?.on === "function" ? target : target?.page?.());

/**
 * Start counting this page's API requests. Call it straight after newPage(),
 * so a request already on the wire at the first afterReads() is counted;
 * afterReads() calls it too, for a page nobody watched.
 * @param {any} target a Playwright Page (or Frame)
 * @returns {Watch}
 */
export function watchReads(target) {
  const page = pageOf(target);
  const known = watches.get(page);
  if (known) return known;
  /** @type {Watch} */
  const w = { inflight: new Set(), last: Date.now() };
  const isRead = (/** @type {any} */ r) => r.resourceType() === "fetch" || r.resourceType() === "xhr";
  page.on("request", (/** @type {any} */ r) => { if (isRead(r)) { w.inflight.add(r); w.last = Date.now(); } });
  const settled = (/** @type {any} */ r) => { if (w.inflight.delete(r)) w.last = Date.now(); };
  page.on("requestfinished", settled);
  page.on("requestfailed", settled);
  // A page that closes takes its requests with it.
  page.on("close", () => w.inflight.clear());
  watches.set(page, w);
  return w;
}

/**
 * At least `ms`, as the walk's own sleep was, and then until no API request
 * of this page has been in flight for QUIET_MS (at most BOUND_MS more), and
 * one frame for what arrived to be drawn.
 * @param {any} target a Playwright Page (or Frame)
 * @param {number} ms the floor: the fixed sleep this replaces
 */
export async function afterReads(target, ms) {
  const page = pageOf(target);
  const w = watchReads(page);
  await page.waitForTimeout(ms);
  const until = Date.now() + BOUND_MS;
  while (Date.now() < until && (w.inflight.size > 0 || Date.now() - w.last < QUIET_MS)) {
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(undefined)))).catch(() => {});
}

/**
 * The home page's public reads (SCRBRD-142 §2.2). Signed out, always: same
 * origin, `credentials: "omit"`, no token, no API client — and not
 * public/reads.js either, which carries the scoring fold the home page has no
 * use for (tools/check-bundle.mjs holds the home graph apart from both).
 *
 *   GET /api/public/live    today's listed fixtures, team facts only
 *
 * Both answers that mean "nothing to show" come back as null: a 404 (the
 * public pages are switched off, PUBLIC_PAGES) and a failure (offline, 5xx,
 * 429). The section hides on null (§2.2 "Off", §6.3); it never says "no
 * matches are being played" (§2.3 "Empty" is a 200 with no fixtures).
 */

/** The path, named once: check-bundle looks for it in the home graph. */
export const LIVE_PATH = "/api/public/live";

/**
 * Today's listed fixtures, or null when there is nothing to show.
 * @returns {Promise<{asOf: string, fixtures: any[]} | null>}
 */
export async function readLive() {
  try {
    const res = await fetch(LIVE_PATH, { credentials: "omit", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    return body && Array.isArray(body.fixtures) ? body : null;
  } catch {
    return null;
  }
}

/** Is any fixture in the answer live? The strip polls only then (§6.3, D14). @param {{fixtures: any[]} | null} live */
export const anyLive = (live) => !!live?.fixtures?.some((f) => f.status === "live");

/** The strip's poll while a card is live and the tab is visible (D14). */
export const LIVE_POLL_MS = 15_000;

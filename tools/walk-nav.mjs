/**
 * How a walk opens a destination now that the menu is the homes
 * (EXPERIENCE_PASS §1.2, Q4, decided 13 Nov: the folded `nav-` ids go, and
 * each walk moves to `home-<home>-section-<key>`).
 *
 * `destLocator(page, key)` answers the button that opens destination `key`
 * the way a person reaches it: its own menu entry where it still has one;
 * else its home's entry, tapped, and then the section on that home's bar
 * (Training is Team, then Training); else the entry of the home it sits
 * under, tapped, and then its link on that bar (Competitions and the Rulebook
 * on the Matches bar, Fields on the Logistics bar); the bell for the
 * notices. A destination the reader is not offered comes back as a locator
 * with nothing in it, so a walk's own "not offered" branch still says so.
 *
 * The homes come from the app's own design/homes.js (it imports nothing), so
 * a walk and the shell cannot disagree about where a destination lives.
 */
import { HOMES, UNDER, homeOf } from "../apps/web/src/design/homes.js";

/** The menu entry a home is drawn under for this reader: its own key, or the first of its sections he reaches. */
async function entryOf(page, home) {
  for (const k of [home, ...HOMES[home].sections.map((s) => s.from)]) {
    const l = page.locator(`[data-testid="mnav-${k}"], [data-testid="nav-${k}"]`).first();
    if (await l.count()) return l;
  }
  return null;
}

/**
 * @param {import("playwright-core").Page} page @param {string} key  a nav destination
 * @param {number} [wait]  ms after the home's entry is tapped, for its bar to draw
 * @returns {Promise<import("playwright-core").Locator>}
 */
export async function destLocator(page, key, wait = 900) {
  const direct = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"]`).first();
  if (await direct.count()) return direct;
  if (key === "notifications") return page.locator('[data-testid="topbar-alerts"]').first();
  const step = async (/** @type {import("playwright-core").Locator | null} */ l) => {
    if (!l || !(await l.count())) return false;
    await l.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(wait);
    return true;
  };
  const h = homeOf(key);
  if (HOMES[h] && h !== key) {
    await step((await entryOf(page, h)) ?? (await destLocator(page, h, wait)));
    return page.locator(`[data-testid="home-${h}-section-${key}"]`).first();
  }
  if (UNDER[key]) {
    await step(await entryOf(page, UNDER[key]));
    return page.locator(`[data-testid="home-${UNDER[key]}-link-${key}"]`).first();
  }
  return direct;
}

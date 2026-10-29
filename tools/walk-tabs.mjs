/**
 * The match page's tabs, for the browser walks (CRI-1.3). On a phone the strip
 * is Summary, Scorecard and Commentary, and the rest — the reader's own tab
 * (Coach, Captain), Partnerships, Analytics, Match details — are under More
 * (apps/web/src/views/matchcentre/tabStrip.jsx), drawn only while its menu is
 * open. Wide, every tab is in the strip. These two work at either width.
 */

/**
 * Open a tab: a tap on it where it is in the strip, or on More and then on it.
 * Throws where the reader has no such tab, the menu closed again.
 * @param {import("playwright-core").Page} page  @param {string} id  @param {{timeout?: number}} [opts]
 */
export async function pickTab(page, id, { timeout = 4000 } = {}) {
  const t = page.locator(`[data-testid="mc-tab-${id}"]`).first();
  if (!(await t.count())) {
    const more = page.locator('[data-testid="mc-more"]').first();
    if (await more.count()) {
      await more.click({ timeout });
      await page.locator('[data-testid="mc-more-menu"]').first().waitFor({ timeout }).catch(() => {});
      // Not under More either: this reader has no such tab. The menu is closed again, not left over the page.
      if (!(await t.count())) { await page.keyboard.press("Escape"); throw new Error(`no tab "${id}" in the strip or under More`); }
    }
  }
  await t.click({ timeout });
}

/**
 * Every tab this reader has, by id: the strip's in order, then More's (its menu
 * opened to read and closed again).
 * @param {import("playwright-core").Page} page
 * @returns {Promise<string[]>}
 */
export async function tabIds(page) {
  const of = (/** @type {string} */ sel) => page.$$eval(sel, (els) => els.map((e) => (e.getAttribute("data-testid") ?? "").replace("mc-tab-", "")));
  const strip = await of('[role="tablist"][data-testid="mc-tabs"] [role="tab"]');
  const more = page.locator('[data-testid="mc-more"]').first();
  if (!(await more.count())) return strip;
  await more.click({ timeout: 4000 });
  await page.locator('[data-testid="mc-more-menu"]').first().waitFor({ timeout: 4000 }).catch(() => {});
  const menu = await of('[data-testid="mc-more-menu"] [role="menuitemradio"]');
  await page.keyboard.press("Escape");
  return [...strip, ...menu];
}

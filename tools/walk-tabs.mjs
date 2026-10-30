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

/**
 * The More menu by keyboard, as the WAI-ARIA APG's menu button has it (Kameel, 29 Oct): from More, closed and
 * focused, ArrowDown opens it on the tab in use there, or its first; ArrowDown, End and Home move within it; Escape closes it with
 * focus back on More; Tab leaves it and closes it, focus on what follows the strip; Shift+Tab leaves it and closes
 * it, focus on the tablist's tab stop. Every step waits for the state it then reads, never a clock. Returns one
 * check per step, for the walk's own ok(); the page is left with the menu closed. Only on a phone, where there is
 * a More.
 * @param {import("playwright-core").Page} page
 * @returns {Promise<{name: string, pass: boolean, detail: string}[]>}
 */
export async function moreMenuKeys(page) {
  /** @type {{name: string, pass: boolean, detail: string}[]} */
  const out = [];
  const check = (/** @type {string} */ name, /** @type {boolean} */ pass, detail = "") => out.push({ name, pass, detail });
  const MENU = '[data-testid="mc-more-menu"]';
  /** Where focus is against More: on it, before or after it in the document, or nowhere; and whether the menu is drawn. */
  const where = () => page.evaluate((MENU) => {
    const a = document.activeElement, more = document.querySelector('[data-testid="mc-more"]');
    const menu = !!document.querySelector(MENU);
    const base = { menu, role: a?.getAttribute("role") ?? null, text: (a?.textContent ?? "").trim().slice(0, 40), inMenu: !!a?.closest(MENU) };
    if (!a || a === document.body || !more) return { ...base, at: "none" };
    if (a === more) return { ...base, at: "more" };
    const pos = more.compareDocumentPosition(a);
    return { ...base, at: pos & Node.DOCUMENT_POSITION_FOLLOWING ? "after" : pos & Node.DOCUMENT_POSITION_PRECEDING ? "before" : "?" };
  }, MENU);
  const opened = () => page.waitForFunction((MENU) => !!document.activeElement?.closest(MENU), MENU, { timeout: 4000 }).catch(() => {});
  const closed = () => page.locator(MENU).waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
  const items = () => page.$$eval(`${MENU} [role="menuitemradio"]`, (els) => els.map((e) => ({ text: (e.textContent ?? "").trim(), on: e.getAttribute("aria-checked") === "true" })));

  await page.locator('[data-testid="mc-more"]').first().focus();
  await page.keyboard.press("ArrowDown");
  await opened();
  const list = await items();
  const names = list.map((i) => i.text);
  const from = Math.max(0, list.findIndex((i) => i.on));
  let at = await where();
  check("ArrowDown on More opens the menu, focus on the tab in use there or its first", at.inMenu && at.role === "menuitemradio" && at.text === names[from], JSON.stringify(at));
  await page.keyboard.press("ArrowDown");
  at = await where();
  check("...ArrowDown moves to the next", names.length > 1 && at.inMenu && at.text === names[(from + 1) % names.length], `${names.join(" · ")} — on ${at.text}`);
  await page.keyboard.press("End");
  at = await where();
  check("...End to its last", at.inMenu && at.text === names[names.length - 1], at.text);
  await page.keyboard.press("Home");
  at = await where();
  check("...Home to its first", at.inMenu && at.text === names[0], at.text);
  await page.keyboard.press("Escape");
  await closed();
  at = await where();
  check("...Escape closes it, focus back on More", !at.menu && at.at === "more", JSON.stringify(at));

  // Each of the two is judged only from inside the open menu, so neither can pass from a closed one.
  await page.keyboard.press("ArrowDown");
  await opened();
  let inside = (await where()).inMenu;
  await page.keyboard.press("Tab");
  await closed();
  at = await where();
  check("...Tab leaves it and closes it, focus on what follows the strip", inside && !at.menu && at.at === "after" && !at.inMenu, JSON.stringify({ inside, ...at }));

  await page.locator('[data-testid="mc-more"]').first().focus();
  await page.keyboard.press("Enter");
  await opened();
  at = await where();
  check("...Enter on More opens it too", at.inMenu, JSON.stringify(at));
  if (!at.inMenu) { await page.keyboard.press("ArrowDown"); await opened(); }
  inside = (await where()).inMenu;
  await page.keyboard.press("Shift+Tab");
  await closed();
  at = await where();
  check("...Shift+Tab leaves it and closes it, focus on the tablist's tab stop", inside && !at.menu && at.at === "before" && at.role === "tab", JSON.stringify({ inside, ...at }));
  return out;
}

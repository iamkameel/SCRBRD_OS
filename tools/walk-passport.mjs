/**
 * The passport sheet over the scorecard (CRI-3.2), for the browser walks.
 *
 * `rowLinks` reads which scorecard rows offer a passport: a bowler's link is
 * on his row; a batter's is inside his row once opened, so each batter's row
 * is opened in turn (one is open at a time) and its link counted.
 *
 * `sheetChecks` opens the sheet from a link and holds it to the rules: his
 * name and his lines from the passport read, nothing under 12px, every
 * control 44px (>= 43.5), focus moved in and kept in, Escape closing it with
 * focus back on the link, and under reduced motion no animation at all.
 */

/**
 * Which rows offer a passport, by the name on the row: { bat: [...], bowl: [...] }.
 * Leaves every batter's row closed.
 * @param {import("playwright-core").Page} page
 */
export async function rowLinks(page) {
  const bowl = await page.$$eval('[data-testid="mc-bowl-row"]', (els) => els
    .filter((e) => e.querySelector('[data-testid="mc-passport-open"]'))
    .map((e) => (e.querySelector('[role="rowheader"]')?.textContent ?? "").replace(/Passport ›/, "").trim()));
  const rows = page.locator('[data-testid="mc-bat-row"]');
  const bat = [];
  for (let i = 0; i < await rows.count(); i++) {
    const row = rows.nth(i);
    const open = row.locator('[data-testid="mc-bat-open"]');
    if (!(await open.count())) continue;
    await open.click({ timeout: 4000 });
    await page.waitForTimeout(150);
    if (await row.locator('[data-testid="mc-passport-open"]').count()) {
      bat.push(((await row.locator('[data-testid="mc-bat-open"]').innerText()).split("\n")[0] ?? "").replace(/[*†]/g, "").trim());
    }
    if ((await open.getAttribute("aria-expanded")) === "true") { await open.click({ timeout: 4000 }); await page.waitForTimeout(100); }
  }
  return { bat, bowl };
}

/**
 * Open the sheet from `link` and check it. `ok` is the walk's own.
 * @param {import("playwright-core").Page} page
 * @param {import("playwright-core").Locator} link
 * @param {(n: string, c: boolean, d?: unknown) => void} ok
 * @param {{who: string, name: RegExp, lines?: boolean | null}} o  lines: whether his record has lines (false: the sheet says it has none; null: either, as the read answers)
 */
export async function sheetChecks(page, link, ok, { who, name, lines = true }) {
  const sheet = page.locator('[data-testid="passport-sheet"]');
  await link.click({ timeout: 4000 });
  await sheet.waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => { const s = document.querySelector('[data-testid="passport-sheet"]'); return s && s.getAttribute("data-state") !== "loading"; },
    null, { timeout: 10000 }).catch(() => {});
  ok(`${who}: the sheet opens over the scorecard, a dialog named by his name`,
     await sheet.count() === 1 && (await sheet.getAttribute("role")) === "dialog" && (await sheet.getAttribute("aria-modal")) === "true"
     && name.test(await page.locator('[data-testid="passport-sheet-name"]').innerText().catch(() => "")));
  const state = await sheet.getAttribute("data-state").catch(() => null);
  const n = await page.locator('[data-testid="passport-sheet-line"]').count();
  if (lines || (lines === null && state === "ok")) ok(`${who}: his passport's lines, each with where it came from`, state === "ok" && n > 0
     && await page.locator('[data-testid="passport-sheet-source"]').count() === n, `${state} · ${n}`);
  else ok(`${who}: nothing on his record yet, said in words`, state === "empty" && /Nothing on his record yet\./.test(await sheet.innerText()), state);
  ok(`${who}: no injury, address, id number, note or rating on it`, !/injur|address|id number|note|rating/i.test(await sheet.innerText()));
  const floors = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="passport-sheet"]');
    const small = [], tiny = [];
    for (const el of root ? [root, ...root.querySelectorAll("*")] : []) {
      const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(getComputedStyle(el).fontSize) < 12) small.push(el.textContent.trim().slice(0, 30));
      if (el.tagName === "BUTTON") { const r = el.getBoundingClientRect(); if (r.height < 43.5 || r.width < 43.5) tiny.push(`${Math.round(r.width)}x${Math.round(r.height)}`); }
    }
    const r = root?.getBoundingClientRect();
    return { small, tiny, inside: !!root && root.contains(document.activeElement), sideways: !!r && (r.right > window.innerWidth + 0.5 || document.documentElement.scrollWidth > window.innerWidth) };
  });
  ok(`${who}: nothing under 12px, every control 44px`, floors.small.length === 0 && floors.tiny.length === 0, floors);
  ok(`${who}: focus moves into it, and nothing runs off the side`, floors.inside && !floors.sideways, floors);
  const held = () => page.evaluate(() => getComputedStyle(document.body).overflow);
  ok(`${who}: the page behind it does not scroll while it is open (N3)`, await held() === "hidden", await held());
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  ok(`${who}: Tab stays inside it`, await page.evaluate(() => !!document.querySelector('[data-testid="passport-sheet"]')?.contains(document.activeElement)));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok(`${who}: Escape closes it, and focus is back on the link it was opened from`, await sheet.count() === 0
     && await link.evaluate((el) => el === document.activeElement).catch(() => false));
  ok(`${who}: ...and the page scrolls again`, await held() !== "hidden", await held());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await link.click({ timeout: 4000 });
  await sheet.waitFor({ timeout: 8000 }).catch(() => {});
  const motion = await page.evaluate(() => ["passport-sheet", "passport-sheet-scrim"]
    .map((t) => getComputedStyle(/** @type {Element} */ (document.querySelector(`[data-testid="${t}"]`))).animationName));
  ok(`${who}: under reduced motion it appears without moving`, motion.every((m) => m === "none"), motion);
  await page.locator('[data-testid="passport-sheet-close"]').click({ timeout: 4000 });
  await page.waitForTimeout(200);
  ok(`${who}: the close button closes it, focus back on the link`, await sheet.count() === 0 && await link.evaluate((el) => el === document.activeElement).catch(() => false));
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

/**
 * S1, refused is not empty: the sheet says which, from passport_name() (the
 * passport's own door). A refusal the link cannot see coming (the clock window,
 * a stale session or roster row: lib/passportLink.js) is staged by answering the
 * door with null in the page; an admitted boy with no line by answering the
 * passport with none. Each answer is the shape the server gives.
 * @param {import("playwright-core").Page} page
 * @param {import("playwright-core").Locator} link
 * @param {(n: string, c: boolean, d?: unknown) => void} ok
 * @param {string} who
 */
export async function refusedChecks(page, link, ok, who) {
  const sheet = page.locator('[data-testid="passport-sheet"]');
  const settle = () => page.waitForFunction(() => { const s = document.querySelector('[data-testid="passport-sheet"]'); return s && s.getAttribute("data-state") !== "loading"; },
    null, { timeout: 10000 }).catch(() => {});
  // The real response, its body replaced: its headers (CORS among them) are the server's; a preflight goes through.
  const answer = (rows) => async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const real = await route.fetch();
    return route.fulfill({ response: real, contentType: "application/json", body: JSON.stringify({ rows }) });
  };
  const door = (u) => u.pathname === "/api/read/passport_name", lines = (u) => u.pathname === "/api/read/passport";
  await page.route(door, answer([{ name: null }]));
  await link.click({ timeout: 4000 });
  await sheet.waitFor({ timeout: 8000 }).catch(() => {});
  await settle();
  const said = await sheet.innerText().catch(() => "");
  ok(`${who}: the read refuses him: "You can't open his passport now.", and no line`,
     await sheet.getAttribute("data-state") === "refused" && /You can't open his passport now\./.test(said) && !/Nothing on his record/.test(said)
     && await page.locator('[data-testid="passport-sheet-line"]').count() === 0, said.slice(0, 200));
  await page.keyboard.press("Escape");
  await page.unroute(door);
  await page.route(lines, answer([]));
  await link.click({ timeout: 4000 });
  await sheet.waitFor({ timeout: 8000 }).catch(() => {});
  await settle();
  const none = await sheet.innerText().catch(() => "");
  ok(`${who}: the read admits him and his record is empty: "Nothing on his record yet."`,
     await sheet.getAttribute("data-state") === "empty" && /Nothing on his record yet\./.test(none) && !/can't open/.test(none), none.slice(0, 200));
  await page.keyboard.press("Escape");
  await page.unroute(lines);
}

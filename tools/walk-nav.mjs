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
  return entryAmong(page, [home, ...HOMES[home].sections.map((s) => s.from)]);
}

/**
 * The first of these destinations with a menu entry: on the rail, on the phone's bar, or, where the phone's menu
 * is still longer than its bar (a director until the School home), in the More drawer, opened for it.
 * @param {import("playwright-core").Page} page @param {string[]} keys
 */
async function entryAmong(page, keys) {
  for (const k of keys) {
    const l = page.locator(`[data-testid="mnav-${k}"], [data-testid="nav-${k}"]`).first();
    if (await l.count()) return l;
  }
  const more = page.locator('[data-testid="mnav-more"]').first();
  if (!(await more.count())) return null;
  if (!(await page.locator('[data-testid="drawer"]').count())) {
    await more.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  for (const k of keys) {
    const l = page.locator(`[data-testid="drawer-${k}"]`).first();
    if (await l.count()) return l;
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
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
  // Not a home's section nor under one: its own entry, perhaps in the phone's More drawer.
  const folded = homeOf(key) !== key;
  if (!folded && !UNDER[key]) return (await (HOMES[key] ? entryOf(page, key) : entryAmong(page, [key]))) ?? direct;
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

/** The menu's words before the homes, each the destination it opened (EXPERIENCE_PASS §1.5, Q4). */
const OLD_WORDS = [
  ["Dashboard", "dashboard"], ["Newsfeed", "news"], ["Match Centre", "matches"], ["Calendar", "calendar"],
  ["Competitions", "competitions"], ["Leagues", "leagues"], ["Officials", "officials"], ["Squad", "squad"],
  ["Profiles", "profiles"], ["Selection", "selection"], ["Injuries", "injuries"], ["Analytics", "analytics"],
  ["Skills", "skills"], ["Training", "training"], ["Fields", "fields"], ["To resolve", "readiness"],
  ["Alerts", "notifications"], ["Notifications", "notifications"], ["Safeguarding", "safeguarding"],
  ["Settings", "settings"], ["Rulebook", "rulebook"],
  // Slice 6: the office's entries are the School home's sections, the platform's the Platform home's.
  ["Staff", "staff"], ["Management", "management"], ["Modules", "modules"], ["Sponsors", "sponsors"],
  ["Pitch Deck", "pitchdeck"],
];

/**
 * Settings' tabs before Slice 6, each the destination its part lives at now (EXPERIENCE_PASS §1.6): People and
 * Import under School, People; Roles under School, Access; School as School, Record; Roadmap, Support and the DLS
 * table on the Platform home. Me and a pupil's own Passport stay the person's own Settings, under their name.
 */
export const SETTINGS_PART = Object.freeze({
  users: "staff", import: "staff", roles: "management", school: "record",
  upgrades: "roadmap", support: "support", dls: "dls", me: "settings", passport: "settings",
});

/**
 * Open what was Settings' tab `tab`, where it lives now: the section of its home (through destLocator), or the
 * person's own Settings from the header for Me and Passport, and then that tab where there is a strip to choose
 * it from. Resolves false when the reader is not offered it (the walk's own "not offered" branch).
 * @param {import("playwright-core").Page} page @param {string} tab  an old `settings-tab-<tab>` id
 */
export async function openSettingsPart(page, tab, wait = 900) {
  const key = SETTINGS_PART[tab];
  if (!key) return false;
  const l = await destLocator(page, key, wait);
  if (!(await l.count())) return false;
  await l.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(wait);
  if (key !== "settings") return true;
  const t = page.locator(`#settings-tab-${tab}`);
  if (await t.count()) await t.click({ timeout: 4000 }).catch(() => {});
  else if (tab !== "me") return false;
  await page.waitForTimeout(300);
  return true;
}

/**
 * A walk that finds a destination by its menu word: the menu button with that
 * word if there still is one (the persona bars' words stand, and so do
 * Logistics); else the destination that word
 * named, reached through its home (destLocator).
 * @param {import("playwright-core").Page} page @param {RegExp | string} label
 */
export async function destByWord(page, label) {
  const l = page.locator("nav button", { hasText: label }).first();
  if (await l.count()) return l;
  const re = label instanceof RegExp ? label : new RegExp(String(label));
  const hit = OLD_WORDS.find(([w]) => re.test(w));
  return hit ? destLocator(page, hit[1]) : l;
}

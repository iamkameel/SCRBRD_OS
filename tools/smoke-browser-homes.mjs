#!/usr/bin/env node
/**
 * EXPERIENCE_PASS Slice 5, the coach's day sheet and the homes, from a browser
 * (docs/redesign/EXPERIENCE_PASS.md, "Slice 5", the Walks and "You'll know"
 * rows), against the seeded school:
 *
 *   1. §1.7. Each persona the seed holds sees exactly the "after" menu: the
 *      coach Today, Matches, Team, Logistics; the scorer Today, Matches, Team;
 *      the spectator Today, Matches; the parent's and the pupil's four, as
 *      decided. On a phone the coach's bar is the four, and there is no More.
 *   2. The header, for staff: the bell, "Raise a concern" and the person's
 *      name, on every screen; none of the three in the menu.
 *   3. Q17. To resolve is a section of the coach's Today, and of nobody's who
 *      cannot act on a row: the spectator and the scorer have none.
 *   4. You'll know, the coach on a match day at 390 wide. Five seconds: the
 *      next fixture's sentence and its chips not done are on the first screen,
 *      not done first. Two steps: "Team sheet" opens that fixture's Coach tab;
 *      Team, then Training, opens Training.
 *   5. Q7. The DSO card is last on Today, naming the DSO, and nothing on any
 *      home or header marks whether a concern exists.
 *   6. Q11. A team page opened by its address shows the same season figures as
 *      the side's Stats (Analytics) did; a player's address opens his page; a
 *      player the coach may not read is said so, with nothing of him; a
 *      ground's address opens that ground; a reader whose menu does not reach
 *      the screen is left at /app; an address that names a person is no
 *      address.
 *   7. You'll know, the director: the first "Needs you" row opens the screen
 *      that fixes it (the fixture, or the thing on its screen), not a list.
 *
 *   8. Review S1, S6: a parent, a pupil, a pupil who scores and a parent who scores opening a player's or a team's
 *      address are left at /app in their own app; a refused player is named nowhere and nothing keyed on him is read;
 *      another school's side opens its page with none of its boys named.
 *   9. Review S2: opening Today makes no logged read nobody tapped for: no lifts expected beyond the match-day
 *      card's own, none for a fixture folded under Later, and no clearance register for the office.
 *  10. Review S3: the DSO card last on the driver's, the groundskeeper's and the scorer's Today.
 *
 * Its own fixtures, assignments and one account, all removed at the end.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-homes.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(4381);
const API_PORT = port(8931);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, Hilton 1XI
const WES_CHILD = "bbbbbbbb-0000-0000-0000-000000000001"; // a Westville boy: not on a Hilton coach's roster
const WES = "22222222-2222-2222-2222-222222222222";
/** What the walk made, removed at the end. */
const made = { assignments: /** @type {string[]} */ ([]), matches: /** @type {string[]} */ ([]), users: /** @type {string[]} */ ([]) };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-homes-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  let body, type;
  try {
    const f = join("apps/web/dist", url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = TYPES[extname(f)] ?? "application/octet-stream";
  } catch {
    body = await readFile("apps/web/dist/index.html");
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, r));

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;
const browser = await chromium.launch({ ...launchOptions() });

async function open(width = 1280, path = "/") {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  // WALK_CPU_THROTTLE=6 runs the page at a sixth of this machine's speed, which is CI's timing (the slice 4 builder).
  if (process.env.WALK_CPU_THROTTLE) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.WALK_CPU_THROTTLE) });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}${path}`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const inner = (page, id) => tid(page, id).first().innerText({ timeout: 8000 }).catch(() => "");
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
/** Signs in, and answers whether the app's shell is up for that account (its main area, or a persona's header). */
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await page.locator("#login-email").fill(email);
  await click(page, /^Sign In$/, 5000);
  const landed = await page.waitForSelector('[data-testid="os-main"]', { timeout: 20000 }).then(() => true, () => false);
  await afterReads(page, 2500);
  return landed;
}
/** The menu as drawn: the rail's entries on a laptop, the bar's on a phone, by key and word. */
// The menu as it will stay: the shell marks it ready once the school's module switches have answered (Sidebar.jsx,
// MobileNav.jsx data-menu-ready), so a half-resolved menu is never read as the answer.
const menuOf = async (page, phone = false) => (await page.waitForSelector(phone ? '[data-testid="mnav"][data-menu-ready="true"]' : '[data-testid="nav"][data-menu-ready="true"]', { timeout: 15000 }).catch(() => null), page.$$eval(phone ? '[data-testid="mnav"] [data-testid^="mnav-"]' : '[data-testid="nav"] [data-testid^="nav-"]:not([data-testid^="nav-group-"])',
  (els) => els.filter((e) => !/badge/.test(e.getAttribute("data-testid") ?? "")).map((e) => ({ key: e.getAttribute("data-testid"), word: (e.innerText || e.getAttribute("aria-label") || "").trim() }))));
const pageNow = (page) => tid(page, "os-main").getAttribute("data-page").catch(() => null);
/** Go to a folded destination as a person does: its home's entry, then its section. */
async function section(page, home, key, phone = false) {
  await tid(page, `${phone ? "mnav" : "nav"}-${home}`).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(page, 1200);
  await tid(page, `home-${home}-section-${key}`).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(page, 1500);
}

try {
  // The API this walk spawned must be listening before anybody signs in: on a slow runner it was not, the first
  // sign-in stayed on the sign-in screen, and the coach's menu read empty (CI, 18 Nov; reproduced by booting the API late).
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { up = (await fetch(`${API}/api/health`).then((x) => x.json()))?.db === "ok"; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  ok("the API is up before the first sign-in", up);
  group("§1.7: each persona sees exactly the after menu");
  {
    const want = {
      "coach@example.invalid": ["Today", "Matches", "Team", "Logistics"],
      "scorer@example.invalid": ["Today", "Matches", "Team"],
      "watcher@example.invalid": ["Today", "Matches"],
      "parent@example.invalid": ["Home", "Matches", "Notices", "Family"],
      "pillay@example.invalid": ["Home", "Matches", "Passport", "Me"],
    };
    for (const [email, words] of Object.entries(want)) {
      const s = await open();
      ok(`${email.split("@")[0]} signs in`, await signIn(s.page, email));
      const m = await menuOf(s.page);
      // The rail's foot (the name, to Settings) and the header's Raise a concern carry nav- ids too; they are not the menu.
      const rail = m.filter((x) => !["nav-settings", "nav-safeguarding"].includes(x.key)).map((x) => x.word);
      ok(`${email.split("@")[0]}: ${words.join(" · ")}`, rail.join("|") === words.join("|"),
         `${rail.join(" · ")} | at ${new URL(s.page.url()).pathname}, signed in: ${await tid(s.page, "os-main").count() > 0}, sign-in screen: ${await s.page.locator("#login-email").count() > 0}`);
      ok(`...and no page error (${email.split("@")[0]})`, s.errors.length === 0, s.errors.join(" | "));
      await s.ctx.close();
    }
    const sd = await open();
    await signIn(sd.page, "sarah@example.invalid");
    const dw = (await menuOf(sd.page)).map((x) => x.word);
    ok("the director of sport: Today, Matches, Team, Logistics, then his office's entries until Slice 6, none folded",
       ["Today", "Matches", "Team", "Logistics"].every((w) => dw.includes(w))
       && !dw.some((w) => ["Dashboard", "Newsfeed", "Match Centre", "Calendar", "Competitions", "Officials", "Squad", "Profiles", "Injuries", "Analytics", "Skills", "Training", "Fields", "To resolve", "Alerts", "Notices", "Safeguarding", "Settings", "Rulebook"].includes(w)),
       dw.join(" · "));
    await sd.ctx.close();
  }

  group("On a phone: the coach's four on the bar, and no More");
  {
    const s = await open(390);
    await signIn(s.page, "coach@example.invalid");
    const bar = await menuOf(s.page, true);
    ok("the bar is Today, Matches, Team, Logistics", bar.map((x) => x.word).join("|") === "Today|Matches|Team|Logistics", bar.map((x) => x.word).join(" · "));
    ok("...with no More and no drawer", await tid(s.page, "mnav-more").count() === 0 && await tid(s.page, "drawer").count() === 0);
    // DESIGN_DIRECTION §2.1: the name opens a short sheet, Settings and Sign out; no role switcher in a real session.
    ok("...and the way out under his name, in its short sheet with Settings", await (async () => {
      await tid(s.page, "header-account").click({ timeout: 4000 }).catch(() => {});
      await s.page.waitForTimeout(300);
      const sheet = tid(s.page, "header-account-menu");
      const n = await sheet.locator('[data-testid="header-signout"]').count() + await sheet.locator('[data-testid="nav-settings"]').count();
      const words = (await sheet.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      await s.page.keyboard.press("Escape");
      return n === 2 && words === "Settings Sign out";
    })());
    ok("...with no role chip, no Switch Role and no sign-out glyph in a real session",
       await tid(s.page, "topbar-role").count() === 0 && !/Switch Role/i.test(await tid(s.page, "topbar").innerText().catch(() => ""))
       && await tid(s.page, "persona-signout").count() === 0 && await tid(s.page, "topbar-signout").count() === 0);
    ok("...and the mark, the bell, Raise a concern and his name, left to right", await s.page.evaluate(() => {
      const at = (id) => document.querySelector(`[data-testid="topbar"] [data-testid="${id}"]`)?.getBoundingClientRect().left ?? -1;
      const xs = ["header-mark", "topbar-alerts", "nav-safeguarding", "header-account"].map(at);
      return xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));
    }));
    ok("the header fits the phone: nothing sideways", await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await s.ctx.close();
  }

  group("The header, for staff: the bell, Raise a concern, the name");
  {
    const s = await open();
    await signIn(s.page, "coach@example.invalid");
    const top = tid(s.page, "topbar");
    // At 1366 (DESIGN_DIRECTION §2.1) the rail holds the mark, the name and the way out; the header does not repeat them.
    ok("the bell and Raise a concern are in the header", await top.locator('[data-testid="topbar-alerts"]').count() === 1 && await top.locator('[data-testid="nav-safeguarding"]').count() === 1);
    ok("...the name (to Settings) and Sign out are at the rail's foot, and the header repeats neither, nor the mark",
       await tid(s.page, "sidebar").locator('[data-testid="nav-settings"]').count() === 1 && await tid(s.page, "sidebar").locator('[data-testid="sidebar-signout"]').count() === 1
       && await top.locator('[data-testid="nav-settings"], [data-testid="header-account"], [data-testid="header-mark"]').count() === 0 && !/Sign out/.test(await top.innerText()));
    ok("...and none of the three is in the menu", await tid(s.page, "nav").locator('[data-testid="nav-notifications"], [data-testid="nav-safeguarding"], [data-testid="nav-settings"]').count() === 0);
    // Raise a concern says so in words beside its icon (glossary review item 1), and its name starts with them.
    const concern = async () => s.page.evaluate(() => {
      const b = document.querySelector('[data-testid="topbar"] [data-testid="nav-safeguarding"]');
      if (!b) return null;
      const r = b.getBoundingClientRect(), t = b.querySelector(".os-concern-text")?.getBoundingClientRect();
      const bar = [...document.querySelectorAll('[data-testid="topbar"] button')].filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => e.getBoundingClientRect());
      return {
        words: (b.textContent ?? "").replace(/\s+/g, " ").trim(), name: b.getAttribute("aria-label") ?? "", icon: b.querySelectorAll('[aria-hidden="true"]').length,
        w: r.width, h: r.height, textShown: !!t && t.width > 0 && t.right <= r.right + 0.5,
        inside: bar.every((q) => q.left >= 0 && q.right <= window.innerWidth + 0.5 && q.height >= 44 && q.width >= 44),
        apart: bar.every((q, i) => bar.every((o, j) => j <= i || q.top >= o.bottom || o.top >= q.bottom || q.right <= o.left + 0.5 || o.right <= q.left + 0.5)),
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    const wide = await concern();
    ok("Raise a concern is in words beside its icon, and its name starts with those words",
       wide?.words === "Raise a concern" && wide.name.startsWith(wide.words) && wide.icon >= 1, JSON.stringify(wide));
    ok("...a 44px target", wide && wide.w >= 44 && wide.h >= 44, JSON.stringify(wide));
    ok("...with no mark of its own beside it (Q7)", wide && !/\d/.test(wide.words));
    await s.page.setViewportSize({ width: 320, height: 844 });
    await s.page.waitForTimeout(400);
    const narrow = await concern();
    ok("...and at 320 the words still show, every header control is 44px, on the screen and clear of the next, nothing sideways",
       narrow?.words === "Raise a concern" && narrow.textShown && narrow.h >= 44 && narrow.inside && narrow.apart && !narrow.sideways, JSON.stringify(narrow));
    await s.page.setViewportSize({ width: 1280, height: 900 });
    await s.page.waitForTimeout(300);
    // The seed's school plays cricket alone: no drop-down with nothing to choose (glossary review item 4).
    ok("one sport at this school: the sidebar draws no sport switcher", await tid(s.page, "nav").count() > 0
       && await tid(s.page, "sport-switcher").count() === 0 && !/ScrbrdOS · Sport/i.test(await s.page.locator("body").innerText().catch(() => "")));
    await tid(s.page, "nav-safeguarding").click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 1200);
    ok("Raise a concern opens Safeguarding", await pageNow(s.page) === "safeguarding");
    await tid(s.page, "nav-settings").click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 1200);
    ok("the name opens Settings", await pageNow(s.page) === "settings");
    await s.ctx.close();
  }

  group("The same header for a parent and a pupil, on a phone (DESIGN_DIRECTION §2.1, Player 5)");
  for (const [email, who, bellTo] of [["parent@example.invalid", "the parent", "notices"], ["pillay@example.invalid", "the pupil", "notifications"]]) {
    const s = await open(390);
    await signIn(s.page, email);
    const bar = tid(s.page, "persona-bar");
    ok(`${who}: the mark, the bell, Raise a concern and the name, in the one header`,
       await bar.count() === 1 && (await Promise.all(["header-mark", "topbar-alerts", "nav-safeguarding", "header-account"].map(async (id) => bar.locator(`[data-testid="${id}"]`).count()))).every((n) => n === 1));
    ok(`${who}: ...no bare sign-out glyph, and no search`, await tid(s.page, "persona-signout").count() === 0 && await bar.locator('[data-testid="topbar-search"]').count() === 0);
    const badge = (await bar.locator('[data-testid="topbar-alerts-badge"]').innerText().catch(() => "")).trim();
    await bar.locator('[data-testid="topbar-alerts"]').click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 1500);
    ok(`${who}: the bell opens the notices (${bellTo})`, await pageNow(s.page) === bellTo, String(await pageNow(s.page)));
    if (bellTo === "notices") {
      // EP §1.7: she keeps Notices on her bar, and the bell shows the same count.
      const line = await tid(s.page, "family-notices").innerText().catch(() => "");
      ok(`${who}: ...whose count is the bell's`, badge ? new RegExp(`\\b${badge} unread\\b`).test(line) : /Nothing unread/.test(line), `${badge} | ${line.slice(0, 120)}`);
    }
    await bar.locator('[data-testid="header-mark"]').click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 1200);
    ok(`${who}: the mark goes back to the first screen`, await pageNow(s.page) === (bellTo === "notices" ? "children" : "myhome"), String(await pageNow(s.page)));
    await bar.locator('[data-testid="header-account"]').click({ timeout: 4000 }).catch(() => {});
    await s.page.waitForTimeout(300);
    await tid(s.page, "header-account-menu").locator('[data-testid="nav-settings"]').click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 1500);
    ok(`${who}: the name's sheet opens Settings`, await pageNow(s.page) === "settings");
    ok(`${who}: no sideways scroll`, await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok(`${who}: no page error`, s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  group("Q17: To resolve only for someone who can act on a row");
  {
    const c = await open();
    await signIn(c.page, "coach@example.invalid");
    ok("the coach's Today has To resolve as a section", await tid(c.page, "home-dashboard-section-readiness").count() === 1);
    await tid(c.page, "home-dashboard-section-readiness").click({ timeout: 4000 }).catch(() => {});
    await afterReads(c.page, 1500);
    ok("...which opens the queue", await pageNow(c.page) === "readiness" && await tid(c.page, "queue").count() === 1);
    await c.ctx.close();
    for (const email of ["watcher@example.invalid", "scorer@example.invalid"]) {
      const s = await open();
      await signIn(s.page, email);
      ok(`${email.split("@")[0]}: no To resolve anywhere on the shell`, await tid(s.page, "home-dashboard-section-readiness").count() === 0
         && await tid(s.page, "nav-readiness").count() === 0 && await tid(s.page, "needs-you").count() === 0);
      await s.ctx.close();
    }
  }

  group("You'll know: the coach on a match day, at 390");
  {
    const [next] = await q(`select id from match where school_id = $1 and team_code = '1XI' and status = 'scheduled' and starts_at > now() order by starts_at limit 1`, [HIL]);
    const s = await open(390);
    await signIn(s.page, "coach@example.invalid");
    await tid(s.page, "day-next-status").first().waitFor({ timeout: 12000 }).catch(() => {});
    const box = await tid(s.page, "day-next").first().boundingBox().catch(() => null);
    const said = await inner(s.page, "day-next-status");
    ok("five seconds: the next fixture's sentence is on the first screen", !!box && box.y < 844 && /Starts at|toss/i.test(said), `${box?.y} ${said}`);
    ok("...it is the coach's next fixture, once", await tid(s.page, `next-fixture-${next?.id}`).count() === 1
       && await s.page.locator(`[data-testid="day-matchday"][data-match="${next?.id}"]`).count() <= 1);
    ok("...with the match-day card folded into it, not beside it",
       await s.page.locator(`[data-testid="day-next"] [data-testid="day-matchday"][data-match="${next?.id}"]`).count() === 1);
    // Kameel, 25 Nov (DESIGN_DIRECTION §3.3): on his side's match day the match leads and Needs you sits under it;
    // on any other day Needs you leads, as before.
    const [{ today } = { today: false }] = await q(`select (starts_at at time zone 'Africa/Johannesburg')::date = sa_today() as today from match where id = $1`, [next?.id]);
    await tid(s.page, "needs-you").first().waitFor({ timeout: 12000 }).catch(() => {});
    const order = await s.page.evaluate(() => { const n = document.querySelector('[data-testid="needs-you"]'), x = document.querySelector('[data-testid="day-next"]');
      return !x ? "no next fixture" : !n ? "nothing waiting" : (x.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING ? "match first" : "needs-you first"); });
    ok(`...${today ? "his match day: the match leads and Needs you is under it" : "not his match day: Needs you, where anything waits, leads"}`,
       today ? order === "match first" : ["needs-you first", "nothing waiting"].includes(order), order);
    const chips = await s.page.$$eval('[data-testid="day-next"] [data-testid^="ready-"]', (els) => els.map((e) => e.getAttribute("data-on")));
    const firstOn = chips.indexOf("true");
    ok("...its chips not done come first", chips.length === 4 && (firstOn === -1 || chips.slice(firstOn).every((v) => v === "true")), chips.join());
    const chipBox = await tid(s.page, "ready-squad").first().boundingBox().catch(() => null);
    ok("...on the first screen too, each 44px to tap", !!chipBox && chipBox.y + chipBox.height <= 844 && chipBox.height >= 44, JSON.stringify(chipBox));
    await tid(s.page, "ready-squad").first().click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 2500);
    ok("two steps: Team sheet opens that fixture's Coach tab", await pageNow(s.page) === "matches"
       && new RegExp(`/app/matches/${next?.id}`).test(s.page.url()) && await tid(s.page, "mc-coach").count() === 1, s.page.url());
    await section(s.page, "squad", "training", true);
    ok("...and Team, then Training, opens Training", await pageNow(s.page) === "training");
    ok("the Team home's section switch keeps to one row on the phone", await tid(s.page, "home-squad-sections").evaluate((el) => {
      const tops = [...el.children].map((c) => Math.round(c.getBoundingClientRect().top));
      return new Set(tops).size === 1;
    }).catch(() => false));
    ok("no page error", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  group("The day sheet's figures (§3.10)");
  {
    const s = await open();
    await signIn(s.page, "coach@example.invalid");
    await tid(s.page, "day-last").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(s.page, 3000);
    ok("Last match: a result in words", (await inner(s.page, "day-last-result")).length > 3, await inner(s.page, "day-last"));
    const season = await inner(s.page, "day-season");
    ok("...and the side's season in one line, with what it rests on", /completed match/.test(season), season);
    const week = await s.page.$$eval('[data-testid="day-week"] [data-testid^="week-said-"]', (els) => els.map((e) => e.textContent ?? ""));
    ok("This week: each fixture says where it stands", week.length > 0 && week.every((t) => t.trim().length > 0), week.join(" | "));
    await s.ctx.close();
  }

  group("Q7: the DSO card last on Today, and no mark of a concern");
  {
    const s = await open();
    await signIn(s.page, "coach@example.invalid");
    await tid(s.page, "dso-card-name").first().waitFor({ timeout: 10000 }).catch(() => {});
    const last = await tid(s.page, "day-sheet").evaluate((el) => {
      const kids = [...el.children];
      return kids[kids.length - 1]?.querySelector('[data-testid="dso-card"]') != null;
    }).catch(() => false);
    ok("the DSO card is the last thing on the day sheet", last);
    ok("...naming the school's DSO", (await tid(s.page, "dso-card-name").count()) > 0, await inner(s.page, "dso-card"));
    ok("...with Raise a concern", await tid(s.page, "dso-card-raise").count() === 1);
    const marks = await s.page.evaluate(() => {
      const near = document.querySelector('[data-testid="nav-safeguarding"]');
      return near ? near.querySelectorAll("[data-testid*='badge'], [data-testid*='count']").length + (/\d/.test(near.textContent ?? "") ? 1 : 0) : -1;
    });
    ok("no mark beside Raise a concern", marks === 0, String(marks));
    await s.ctx.close();
    const d = await open();
    await signIn(d.page, "dso@example.invalid");
    ok("the DSO lands on Today, like everyone", await pageNow(d.page) === "dashboard");
    ok("...with no mark of a concern on it", !/concern(s)? (open|waiting|raised)|\d+ concerns?/i.test(await inner(d.page, "os-main")));
    await d.ctx.close();
  }

  group("Q11: the addresses");
  {
    const c = await open();
    await signIn(c.page, "coach@example.invalid");
    // The side's Stats first, as Analytics draws it.
    await section(c.page, "squad", "analytics");
    await tid(c.page, "analytics-team-1XI").first().click({ timeout: 4000 }).catch(() => {});
    await tid(c.page, "side-season-panel").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(c.page, 2500);
    const stats = (await inner(c.page, "side-season-panel")).replace(/\s+/g, " ").trim();
    await c.ctx.close();

    const t = await open(1280, `/app/teams/${HIL}.1XI`);
    await signIn(t.page, "coach@example.invalid");
    await tid(t.page, "team-page").first().waitFor({ timeout: 12000 }).catch(() => {});
    await tid(t.page, "side-season-panel").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(t.page, 2500);
    ok("a team's address opens its page inside the Team home", await pageNow(t.page) === "squad" && await tid(t.page, "team-page").count() === 1
       && (await tid(t.page, "nav-squad").getAttribute("aria-current")) === "page", t.page.url());
    const there = (await inner(t.page, "side-season-panel")).replace(/\s+/g, " ").trim();
    ok("...showing the same season figures as the side's Stats did", there.length > 20 && there === stats, `${there.slice(0, 160)} || ${stats.slice(0, 160)}`);
    ok("...and its results, with what they rest on", (await tid(t.page, "team-results").count()) === 1, await inner(t.page, "team-results"));
    ok("...and the address is the id, never a name", /\/app\/teams\/[0-9a-f-]{36}\.1XI$/.test(new URL(t.page.url()).pathname), t.page.url());
    await tid(t.page, "home-squad-section-training").click({ timeout: 4000 }).catch(() => {});
    await afterReads(t.page, 1200);
    ok("leaving it leaves the address", new URL(t.page.url()).pathname === "/app", t.page.url());
    await t.ctx.close();

    const p = await open(1280, `/app/players/${PILLAY}`);
    await signIn(p.page, "coach@example.invalid");
    await afterReads(p.page, 2500);
    ok("a player's address opens his page", await pageNow(p.page) === "profiles" && /R Pillay/.test(await inner(p.page, "os-main"))
       && await tid(p.page, "address-refused").count() === 0, p.page.url());
    await p.ctx.close();

    const r = await open(1280, `/app/players/${WES_CHILD}`);
    const keyed = [];
    r.page.on("request", (q2) => { if (q2.url().includes(WES_CHILD)) keyed.push(q2.url()); });
    await signIn(r.page, "coach@example.invalid");
    await tid(r.page, "address-refused").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(r.page, 1500);
    const [wesBoy] = await q(`select full_name from player where id = $1`, [WES_CHILD]);
    ok("a player the coach may not read: said so", await tid(r.page, "address-refused").count() === 1, await inner(r.page, "os-main"));
    ok("...his name nowhere on the screen", !(await inner(r.page, "os-main")).includes(wesBoy.full_name) && !(await r.page.innerText("body")).includes(wesBoy.full_name));
    ok("...and no read keyed on him", keyed.length === 0, keyed.join(" | "));
    await r.ctx.close();

    // Another school's side, by its address: its page, its results as far as this account can read them, no boy named.
    const wesNames = (await q(`select full_name from player where school_id = $1`, [WES])).map((x) => x.full_name);
    const ws = await open(1280, `/app/teams/${WES}.1XI`);
    await signIn(ws.page, "coach@example.invalid");
    await tid(ws.page, "team-page").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(ws.page, 2500);
    const wsText = await inner(ws.page, "os-main");
    ok("another school's side opens its page, with none of its boys named", await tid(ws.page, "team-page").count() === 1 && !wesNames.some((n) => wsText.includes(n)), wsText.slice(0, 200));
    ok("...and no page error", ws.errors.length === 0, ws.errors.join(" | "));
    await ws.ctx.close();

    // The squad's side name leads to the team page (review S4).
    const sq = await open();
    await signIn(sq.page, "coach@example.invalid");
    await tid(sq.page, "nav-squad").click({ timeout: 6000 }).catch(() => {});
    await afterReads(sq.page, 1500);
    await tid(sq.page, "squad-team-page").click({ timeout: 6000 }).catch(() => {});
    await afterReads(sq.page, 1500);
    ok("the squad's side name opens the team page, by its address", await tid(sq.page, "team-page").count() === 1
       && /\/app\/teams\/[0-9a-f-]{36}\.1XI$/.test(new URL(sq.page.url()).pathname), sq.page.url());
    await sq.ctx.close();
  }

  group("Review S1: a persona's app opens no staff screen by address");
  {
    const pupil = (await q(`select id from app_user where email = 'pillay@example.invalid'`))[0].id;
    const parent = (await q(`select id from app_user where email = 'parent@example.invalid'`))[0].id;
    const cases = [["a parent", "parent@example.invalid", null], ["a pupil", "pillay@example.invalid", null],
      ["a pupil who scores", "pillay@example.invalid", pupil], ["a parent who scores", "parent@example.invalid", parent]];
    for (const [who, email, scorer] of cases) {
      let sa = null;
      if (scorer) { [sa] = await q(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'scorer', $2, '1XI') returning id`, [scorer, HIL]); made.assignments.push(sa.id); }
      for (const path of [`/app/players/${PILLAY}`, `/app/teams/${HIL}.1XI`]) {
        const s = await open(390, path);
        await signIn(s.page, email);
        await afterReads(s.page, 1500);
        const at = new URL(s.page.url()).pathname;
        ok(`${who} opening ${path.split("/")[2]}'s address stays in his own app, at /app`, at === "/app" && (await tid(s.page, "persona-bar").count()) === 1
           && !(["profiles", "squad"].includes(await pageNow(s.page) ?? "")) && await tid(s.page, "team-page").count() === 0, `${at} ${await pageNow(s.page)}`);
        await s.ctx.close();
      }
      if (sa) await q(`delete from role_assignment where id = $1`, [sa.id]);
    }

    const [g] = await q(`select id, name from ground where school_id = $1 order by name limit 1`, [HIL]);
    const gp = await open(1280, `/app/grounds/${g.id}`);
    await signIn(gp.page, "coach@example.invalid");
    await afterReads(gp.page, 2000);
    ok("a ground's address opens that ground", await pageNow(gp.page) === "fields" && (await inner(gp.page, "os-main")).includes(g.name), gp.page.url());
    await gp.ctx.close();

    const w = await open(1280, `/app/players/${PILLAY}`);
    await signIn(w.page, "watcher@example.invalid");
    await afterReads(w.page, 1500);
    ok("a spectator, whose menu has no Players, is left at /app", new URL(w.page.url()).pathname === "/app" && await pageNow(w.page) !== "profiles", w.page.url());
    await w.ctx.close();

    const n = await open(1280, "/app/players/R%20Pillay");
    await signIn(n.page, "coach@example.invalid");
    await afterReads(n.page, 1500);
    ok("an address that names a person opens nothing", await pageNow(n.page) !== "profiles");
    await n.ctx.close();
  }

  group("Review S2: opening Today makes no logged read nobody tapped for");
  {
    // Four of the coach's fixtures in the next two hours: the match-day card draws the first few and folds the last
    // under Later. Timed from now, not from the clock's hours: a fixture that started more than six hours ago leaves
    // the card's window (lib/cockpit.js isWithin), and the last would no longer be the folded one (seen at 16:00).
    const today = [];
    for (const [name, mins] of [["Homes Walk First XI", 30], ["Homes Walk Second XI", 60], ["Homes Walk Third XI", 90], ["Homes Walk Fourth XI", 120]]) {
      const [m] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
        values ($1, '1XI', $2, now() + make_interval(mins => $3::int), 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL, name, mins]);
      today.push(m.id); made.matches.push(m.id);
    }
    const s = await open(390);
    const asked = [];
    s.page.on("request", (r) => asked.push(r.url()));
    await signIn(s.page, "coach@example.invalid");
    await tid(s.page, "day-next").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(s.page, 4000);
    const lifts = (id) => asked.filter((u) => u.includes(`/matches/${id}/lifts/expected`)).length;
    ok("Today asks each shown fixture's lifts once at most: the card's own read, never the queue's again",
       today.slice(0, 3).every((id) => lifts(id) <= 1), today.map((id) => lifts(id)).join());
    ok("...and none for the fixture folded under Later", lifts(today[3]) === 0, String(lifts(today[3])));
    ok("...nor the lift exceptions, which are read on a tap", !asked.some((u) => /lifts\/exceptions/.test(u)));
    ok("...nor the clearance register", !asked.some((u) => /clearance_register/.test(u)));
    await s.ctx.close();

    const o = await open();
    const oasked = [];
    o.page.on("request", (r) => oasked.push(r.url()));
    await signIn(o.page, "registrar@example.invalid");
    await afterReads(o.page, 4000);
    ok("the office opening Today reads no clearance register", await pageNow(o.page) === "dashboard" && !oasked.some((u) => /clearance_register/.test(u)),
       oasked.filter((u) => /clearance/.test(u)).join(" | "));
    ok("...nor any lifts", !oasked.some((u) => /\/lifts/.test(u)));
    await tid(o.page, "home-dashboard-section-readiness").click({ timeout: 6000 }).catch(() => {});
    await afterReads(o.page, 4000);
    ok("...which To resolve reads when somebody taps for it", oasked.some((u) => /clearance_register/.test(u)));
    await o.ctx.close();
  }

  group("Review S3: the DSO card last on every Today");
  {
    const [gk] = await q(`insert into app_user (school_id, email, name, role) values ($1, 'homes.ground@example.invalid', 'Homes Walk Groundsman', 'facilities') returning id`, [HIL]);
    made.users.push(gk.id);
    const [ga] = await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'facilities', $2) returning id`, [gk.id, HIL]);
    made.assignments.push(ga.id);
    for (const [who, email] of [["the driver", "driver@example.invalid"], ["the groundskeeper", "homes.ground@example.invalid"], ["the scorer", "scorer@example.invalid"]]) {
      const s = await open();
      await signIn(s.page, email);
      await tid(s.page, "dso-card").first().waitFor({ timeout: 10000 }).catch(() => {});
      const last = await tid(s.page, "os-main").evaluate((m) => {
        const card = m.querySelector('[data-testid="dso-card"]');
        if (!card) return false;
        const all = [...m.querySelectorAll("[data-testid]")].filter((e) => !card.contains(e) && e !== card && !e.contains(card));
        return all.every((e) => card.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING);
      }).catch(() => false);
      ok(`${who}'s Today ends with the DSO card`, await pageNow(s.page) === "dashboard" && last, `${await pageNow(s.page)}`);
      ok(`...and no page error (${who})`, s.errors.length === 0, s.errors.join(" | "));
      await s.ctx.close();
    }
  }

  group("You'll know: the director's first Needs you row lands on the fix");
  {
    const s = await open();
    await signIn(s.page, "sarah@example.invalid");
    await tid(s.page, "needs-you-row").first().waitFor({ timeout: 15000 }).catch(() => {});
    await afterReads(s.page, 2500);
    const first = s.page.locator('[data-testid="needs-you-row"]').first();
    const kind = await first.getAttribute("data-kind").catch(() => null);
    const match = await first.getAttribute("data-match").catch(() => null);
    ok("Needs you is on his Today", await tid(s.page, "needs-you").count() === 1 && !!kind, await inner(s.page, "needs-you"));
    await first.locator("button").first().click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 3000);
    const where = await pageNow(s.page);
    const onFixture = !!match && new RegExp(`/app/matches/${match}`).test(s.page.url());
    const onThing = await s.page.locator('[data-fix="here"]').count() > 0;
    ok(`...its first row (${kind}) opens the fix: the fixture, or the thing on its screen`, onFixture || onThing, `${where} ${s.page.url()}`);
    await s.ctx.close();
  }

  // Redesign slice 15 (DESIGN_DIRECTION §3.5): the signed-in spectator's Today, in its three days: nothing on, a match
  // later today, a match live. Titled with the date; matches and results, no staff parts; "Watch" and its pace on a
  // live lead. S15_SHOTS=<dir> keeps a picture of each, at 390 and 1366, in both themes.
  group("Slice 15: the spectator's Today");
  {
    // The Home dates its day in Johannesburg (UTC+2, no summer time), so the walk does too, whatever the runner's clock.
    const dayWords = await (async () => { const d = new Date(Date.now() + 2 * 3600e3); return `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]}`; })();
    const shotsDir = process.env.S15_SHOTS;
    if (shotsDir) await (await import("node:fs/promises")).mkdir(shotsDir, { recursive: true });
    const visit = async (/** @type {number} */ width, /** @type {"light" | "dark"} */ scheme, /** @type {boolean} */ empty, /** @type {boolean} */ sunny = false) => {
      const s = await open(width);
      await s.page.emulateMedia({ colorScheme: scheme });
      if (empty) await s.page.route("**/api/read/matches*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: [] }) }));
      // The forecast the removed Next fixture card read, for every fixture to come (the read itself is unchanged).
      if (sunny) {
        const ids = (await q(`select id from match where school_id = $1 and status = 'scheduled'`, [HIL])).map((r) => r.id);
        await s.page.route("**/api/read/weather*", (r) => r.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ rows: ids.map((id) => ({ match_id: id, condition: "Sunny", temp_c: 24, rain_chance_pct: 10, observed_at: new Date().toISOString() })) }) }));
      }
      await signIn(s.page, "watcher@example.invalid");
      await tid(s.page, "day-sheet").first().waitFor({ timeout: 12000 }).catch(() => {});
      await afterReads(s.page, 2500);
      return s;
    };
    const keep = async (s, name, width, scheme) => { if (shotsDir) await s.page.screenshot({ path: `${shotsDir}/spectator-${name}-${width}-${scheme}.png`, fullPage: true }).catch(() => {}); };
    const bare = async (s) => ({ title: await inner(s.page, "day-title"), h1s: await s.page.locator("h1").allInnerTexts(), chips: await s.page.locator('[data-testid^="ready-"]').count(),
      next: await tid(s.page, "day-next").count(), all: await inner(s.page, "day-sheet") });

    for (const [name, setup] of [["nothing", null], ["later", async () => { const [m] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
        values ($1, '1XI', 'Slice 15 Later XI', now() + least(interval '40 minutes', (((date_trunc('day', now() at time zone 'Africa/Johannesburg') + interval '1 day') at time zone 'Africa/Johannesburg') - now()) / 2), 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL]); made.matches.push(m.id); }],
        ["live", async () => { const [m] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
        values ($1, '1XI', 'Slice 15 Live XI', now() - interval '20 minutes', 'cricket', 'T20', 20, 'live') returning id`, [HIL]); made.matches.push(m.id); }]]) {
      if (setup) await setup();
      for (const width of [390, 1366]) for (const scheme of /** @type {const} */ (["light", "dark"])) {
        const s = await visit(width, scheme, name === "nothing", name === "later");
        await keep(s, name, width, scheme);
        if (scheme === "light") {
          const b = await bare(s);
          ok(`${name} @${width}: titled with the date, never "Spectator"`, b.title.includes(dayWords) && !b.h1s.some((h) => /Spectator/.test(h)), `${b.title} | ${b.h1s}`);
          ok(`${name} @${width}: no readiness chips, no Next fixture card`, b.chips === 0 && b.next === 0);
          ok(`${name} @${width}: no empty Notices card`, !/Nothing unread/.test(b.all));
          if (name === "nothing") ok(`nothing @${width}: one sentence, and no live board`, /Nothing is on today or this week/.test(b.all) && await tid(s.page, "day-now").count() === 0, b.all.slice(0, 300));
          if (name === "later") ok(`later @${width}: the match under "Today", as a row`, await tid(s.page, "day-group-today").count() === 1 && /Slice 15 Later/.test(await inner(s.page, "day-group-today")) && !/Nothing is on today/.test(b.all), b.all.slice(0, 300));
          if (name === "later") {
            const w = tid(s.page, "day-weather");
            ok(`later @${width}: the weather is one quiet line, on the next match`, await w.count() === 1 && /24° sunny/.test(await w.innerText().catch(() => ""))
               && await s.page.locator('[data-testid="day-group-today"] [data-testid="day-weather"]').count() === 1, await w.allInnerTexts().catch(() => ""));
          }
          if (name === "live") {
            const open_ = tid(s.page, "day-now-open").first();
            const box = await open_.boundingBox().catch(() => null);
            ok(`live @${width}: the lead says Watch, 44px to tap, and "Updates every 15 seconds"`, (await open_.innerText().catch(() => "")).trim() === "Watch" && !!box && box.height >= 44
               && /Updates every 15 seconds/.test(await inner(s.page, "day-now-pace")), `${await open_.innerText().catch(() => "")} ${JSON.stringify(box)}`);
            ok(`live @${width}: the match is in the lead only, not again under Today`, await s.page.locator('[data-testid="day-group-today"] [data-testid^="week-fixture-"]').count() === 0 || !/Slice 15 Live/.test(await inner(s.page, "day-group-today")));
          }
          if (name === "live" && width === 390) {
            const head = s.page.locator('[data-testid^="news-headline-open-"]').first();
            const hb = await head.boundingBox().catch(() => null);
            ok("a headline is 44px to tap", !!hb && hb.height >= 44, JSON.stringify(hb));
            await head.click({ timeout: 4000 }).catch(() => {});
            await s.page.waitForSelector('[data-testid="news-read"]', { timeout: 8000 }).catch(() => {});
            ok("...and opens its post", await tid(s.page, "news-read").count() === 1, await pageNow(s.page));
            // Slice 12b (DESIGN_DIRECTION §2.1): he came from Today, so the post's Back says Today, and goes there.
            const postBack = (await inner(s.page, "news-read-back")).replace(/\s+/g, " ").trim();
            ok(`...its Back names where he came from: Today ("${postBack}")`, postBack === "Today" && /^Back to Today$/.test((await inner(s.page, "news-read-back-foot")).trim()));
            await tid(s.page, "news-read-back").first().click({ timeout: 4000 }).catch(() => {});
            await afterReads(s.page, 1200);
            ok("...which goes back to Today, and the address forgets the post", await tid(s.page, "os-main").getAttribute("data-page").catch(() => null) === "dashboard"
               && await tid(s.page, "news-read").count() === 0 && !/#read-/.test(s.page.url()), await pageNow(s.page));
            const t = await visit(390, "light", false);
            const all = tid(t.page, "day-news-all");
            const box = await all.boundingBox().catch(() => null);
            ok("the news block's link is 44px to tap", !!box && box.height >= 44, JSON.stringify(box));
            await all.click({ timeout: 4000 }).catch(() => {});
            await afterReads(t.page, 2000);
            ok("...and opens the news section of his Today", await tid(t.page, "news-list").count() > 0 || /Newsfeed/.test(await inner(t.page, "os-main")), await pageNow(t.page));
            await t.ctx.close();
          }
          ok(`${name} @${width}: no sideways scroll`, await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        }
        await s.ctx.close();
      }
    }
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.message);
} finally {
  await q(`delete from role_assignment where id = any($1)`, [made.assignments]).catch(() => {});
  await q(`delete from match where id = any($1)`, [made.matches]).catch(() => {});
  await q(`delete from app_user where id = any($1)`, [made.users]).catch(() => {});
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nBROWSER HOMES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

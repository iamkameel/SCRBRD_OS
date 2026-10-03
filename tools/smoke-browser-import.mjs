#!/usr/bin/env node
/**
 * Settings → Import, and the Staff screen on the school's own staff, from a
 * browser, against a real server and database.
 *
 * The importer is the server's (services/api/io/import-api.mjs: a dry run is
 * the default, a file with any error is never committed, every row is a write
 * under the caller's own policy). This walk asks what the office asks of the
 * screen over it:
 *
 *   1. WHO SEES IT. The school office has an Import tab; a coach, who holds no
 *      player.profile.manage, has none. Held against the policy itself, not
 *      against a list in this file. Signed out (the demonstration), the panel
 *      asks for a sign-in, offers no form, and posts nothing.
 *   2. THE TEMPLATE downloads, as a file named for the kind, with the
 *      importer's own columns.
 *   3. A FILE WITH ONE BAD LINE shows that line, in the route's words, with its
 *      line number, says how many problems and that nothing was written, and
 *      leaves Import disabled; the database has none of its boys.
 *   4. A CLEAN FILE: "3 rows clean" and Import enabled, and still nothing in the
 *      database. Choosing another file takes Import away again until that file
 *      is checked. Import writes the three, says so, and goes disabled; the
 *      boys are in Postgres and on Squad. The same file checked again says the
 *      three are already there, to be updated.
 *   5. STAFF is the school's role assignments: the people who hold a staff role
 *      at the school, checked against role_assignment itself; not a parent, not
 *      a pupil; a person who is also a parent once, as a coach; a filter by
 *      role; a card opens a detail; a coach is not offered the screen.
 *   6. The floors: no rendered text under 12px, nothing tapped under 44px, at
 *      1280 and at 390 wide, with no sideways page scroll.
 *
 * Names in the files are invented, and carry a suffix for this run.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-import.mjs
 *   BROWSER_IMPORT_DEBUG=1 node tools/smoke-browser-import.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { roleGrants } from "../packages/policy/src/roles.mjs";
import { IMPORTS } from "../services/api/io/import-api.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(4386);
const API_PORT = port(8917);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const DEBUG = !!process.env.BROWSER_IMPORT_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const VERBOSE = !!process.env.BROWSER_IMPORT_VERBOSE;
const ok = (n, c, d = "") => { if (c) { pass++; if (VERBOSE) console.log("  ✓", n); } else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-import-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const pool = new pg.Pool({ connectionString: DB });
const q = async (text, params) => (await pool.query(text, params)).rows;

const browser = await chromium.launch({ ...launchOptions() });

async function open(apiBase = API, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(apiBase)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
const text = (page) => page.$eval("body", (el) => el.innerText);
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
async function signIn(page, email, password = "") {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  if (password) await page.fill("#login-password", password);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}
/** To a sidebar destination, by the nav's own test id. */
async function nav(page, key) {
  const n = tid(page, `nav-${key}`).first();
  if (!(await n.count())) {
    if (DEBUG) console.log(`  (no nav-${key}; there is: ${(await page.locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")))).join(" ")})`);
    return false;
  }
  try { await n.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(500);
  return true;
}
const tabsOf = (page) => page.locator('[role="tablist"][aria-label="Settings sections"] [role="tab"]').evaluateAll((els) => els.map((e) => e.id.replace("settings-tab-", "")));
async function toImport(page) {
  if (!(await nav(page, "settings"))) return false;
  const tab = page.locator("#settings-tab-import");
  if (!(await tab.count())) return false;
  await tab.click({ timeout: 5000 });
  try { await tid(page, "import-panel").waitFor({ timeout: 8000 }); } catch { return false; }
  return true;
}

/** Rendered text under 12px, and things tapped under 44px, inside one element. */
const floors = (page, selector) => page.evaluate((sel) => {
  const root = document.querySelector(sel);
  if (!root) return { small: ["(no such root)"], taps: ["(no such root)"] };
  const small = [], taps = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 12) small.push(`${px}px "${n.nodeValue.trim().slice(0, 30)}"`);
  }
  for (const el of root.querySelectorAll("button, a[href], select, textarea, input:not([type=hidden]), [role=button]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 43.5 || r.width < 43.5) taps.push(`${Math.round(r.width)}x${Math.round(r.height)} ${(el.innerText || el.getAttribute("aria-label") || el.type || el.tagName).slice(0, 24)}`);
  }
  return { small, taps };
}, selector);
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const OFFICE = "registrar@example.invalid";       // schooladmin: player.profile.manage, user.read
const COACH = "coach@example.invalid";            // C Hendricks, 1XI: neither
const HEADER = IMPORTS.players.template.join(",");
const RUN = Date.now().toString(36).toUpperCase().slice(-4);
const NAMES = [`Walktest Alpha ${RUN}`, `Walktest Bravo ${RUN}`, `Walktest Charlie ${RUN}`];
const rowFor = (name, born) => `${name},U14A,,batter,R,R,M,${born},,,,`;
const CLEAN = [HEADER, rowFor(NAMES[0], "2012-05-05"), rowFor(NAMES[1], "2012-08-09"), rowFor(NAMES[2], "2012-11-23")].join("\r\n") + "\r\n";
// Line 3 (the second boy) has a birthday in the day/month order the importer will not guess.
const BAD = [HEADER, rowFor(NAMES[0], "2012-05-05"), rowFor(NAMES[1], "09/08/2012"), rowFor(NAMES[2], "2012-11-23")].join("\r\n") + "\r\n";
const OTHER = [HEADER, rowFor(`Walktest Delta ${RUN}`, "2012-02-02")].join("\r\n") + "\r\n";
const file = (name, csv) => ({ name, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
const boysNamed = () => q(`select full_name from player where full_name like $1 order by full_name`, [`Walktest % ${RUN}`]);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── 1. Who sees it ───────────────────────────────────────────────
  group("The office has an Import tab, and a coach does not");
  ok("the policy says the office may import and a coach may not",
     roleGrants("schooladmin", "player.profile.manage") && !roleGrants("coach", "player.profile.manage"));
  const co = await open();
  ok("the coach signs in", await signIn(co.page, COACH));
  ok("...and opens Settings", await nav(co.page, "settings"));
  const coachTabs = await tabsOf(co.page);
  ok("his tabs are drawn, and Import is not one of them", coachTabs.length > 0 && !coachTabs.includes("import"), coachTabs.join());
  ok("...and no Staff destination either (no user.read)", await tid(co.page, "nav-staff").count() === 0);
  ok("no console errors for the coach", co.errors.length === 0, co.errors.join(" | "));
  await co.ctx.close();

  const off = await open();
  const posts = [];
  off.page.on("request", (r) => { if (r.method() === "POST" && /\/api\/import\//.test(r.url())) posts.push(r.url()); });
  ok("the office signs in", await signIn(off.page, OFFICE));
  ok("...opens Settings → Import", await toImport(off.page));
  ok("Import is among the office's tabs", (await tabsOf(off.page)).includes("import"));
  // The office holds both kinds' capabilities, so it is offered a choice,
  // players first; the rest of this walk imports players.
  const kindOpts = await tid(off.page, "import-kind").locator("option").allInnerTexts().catch(() => []);
  ok("the kinds are offered, from the list the screen was given", kindOpts.join("|") === "Players|Guardians", kindOpts);
  ok("...with Players chosen", await tid(off.page, "import-kind").inputValue().catch(() => "") === "players");
  ok("the school is named", /At: .*Hilton/i.test(await tid(off.page, "import-school-one").innerText().catch(() => "")));
  ok("with no file chosen, Check and Import are both disabled",
     await tid(off.page, "import-check").isDisabled() && await tid(off.page, "import-run").isDisabled());

  // ── 2. The template ──────────────────────────────────────────────
  group("The template downloads");
  {
    const [dl] = await Promise.all([off.page.waitForEvent("download", { timeout: 8000 }), tid(off.page, "import-template").click()]);
    const body = (await readFile(await dl.path(), "utf8")).replace(/^﻿/, "");
    ok("it is named for the kind", dl.suggestedFilename() === "scrbrd-players-template.csv", dl.suggestedFilename());
    ok("its header is the importer's own columns, in order", body.split(/\r?\n/)[0] === HEADER, body.split(/\r?\n/)[0]);
    ok("...and it carries the example row", body.split(/\r?\n/)[1] === IMPORTS.players.example, body.split(/\r?\n/)[1]);
  }

  // ── 3. One bad line ──────────────────────────────────────────────
  group("A file with one bad line: that line, in the route's words, and Import stays disabled");
  await tid(off.page, "import-file").setInputFiles(file("boys.csv", BAD));
  await off.page.waitForTimeout(300);
  ok("after choosing it, Check is enabled and Import is not", !(await tid(off.page, "import-check").isDisabled()) && await tid(off.page, "import-run").isDisabled());
  await tid(off.page, "import-check").click();
  await tid(off.page, "import-report").waitFor({ timeout: 10000 });
  const errs = await off.page.locator('[data-testid="import-error"]').evaluateAll((els) => els.map((e) => ({ line: e.getAttribute("data-line"), text: e.innerText })));
  ok("exactly one error is listed", errs.length === 1, JSON.stringify(errs));
  ok("...on line 3, which is the second boy's line in the file", errs[0]?.line === "3" && /^Line 3, born:/.test(errs[0]?.text), JSON.stringify(errs));
  ok("...in the route's own words", /must be a date like 2011-04-07/.test(errs[0]?.text ?? ""));
  ok("the summary counts one problem and says nothing was written", /^1 problem to fix\. Nothing was written\.$/.test((await tid(off.page, "import-problems").innerText()).trim()));
  ok("Import is still disabled", await tid(off.page, "import-run").isDisabled());
  ok("no boy of this file is in the database", (await boysNamed()).length === 0);
  const badFloors = await floors(off.page, '[data-testid="import-panel"]');
  ok("the panel with an error is on the 12px floor", badFloors.small.length === 0, badFloors.small.join(" | "));
  ok("...and the 44px floor", badFloors.taps.length === 0, badFloors.taps.join(" | "));

  // ── 4. A clean file ──────────────────────────────────────────────
  group("A clean file: Check, then Import, and the boys are on Squad");
  await tid(off.page, "import-file").setInputFiles(file("boys.csv", CLEAN));
  await off.page.waitForTimeout(300);
  ok("choosing another file clears the old report", await tid(off.page, "import-report").count() === 0);
  ok("...and Import is disabled until it is checked", await tid(off.page, "import-run").isDisabled());
  await tid(off.page, "import-check").click();
  await tid(off.page, "import-clean").waitFor({ timeout: 10000 });
  ok("it says 3 rows clean", /^3 rows clean \(3 new\)\./.test((await tid(off.page, "import-clean").innerText()).trim()), await tid(off.page, "import-clean").innerText());
  ok("Import is now enabled", !(await tid(off.page, "import-run").isDisabled()));
  ok("a Check wrote nothing", (await boysNamed()).length === 0);
  await tid(off.page, "import-file").setInputFiles(file("other.csv", OTHER));
  await off.page.waitForTimeout(300);
  ok("another file takes Import away again", await tid(off.page, "import-run").isDisabled());
  await tid(off.page, "import-file").setInputFiles(file("boys.csv", CLEAN));
  await off.page.waitForTimeout(300);
  ok("...and going back to the first does not bring it back unchecked", await tid(off.page, "import-run").isDisabled());
  await tid(off.page, "import-check").click();
  await tid(off.page, "import-clean").waitFor({ timeout: 10000 });
  await tid(off.page, "import-run").click();
  await tid(off.page, "import-result").waitFor({ timeout: 10000 });
  ok("the result line says three were added", (await tid(off.page, "import-result").innerText()).trim() === "Imported 3 rows: 3 added.", await tid(off.page, "import-result").innerText());
  ok("Import is disabled again", await tid(off.page, "import-run").isDisabled());
  const inDb = (await boysNamed()).map((r) => r.full_name);
  ok("the three boys are in Postgres", inDb.length === 3 && NAMES.every((n) => inDb.includes(n)), inDb.join(" | "));
  const [{ n: hilton }] = await q(`select count(*)::int as n from player p join school s on s.id = p.school_id where p.full_name like $1 and s.name ilike '%Hilton%'`, [`Walktest % ${RUN}`]);
  ok("...at the office's own school", hilton === 3, String(hilton));
  ok("the screen made exactly the posts it should: a bad check, two clean checks and one import", posts.length === 4, posts.join(","));

  // Checked again, the same file is three updates and no duplicates.
  await tid(off.page, "import-file").setInputFiles(file("boys.csv", CLEAN));
  await off.page.waitForTimeout(300);
  await tid(off.page, "import-check").click();
  await tid(off.page, "import-clean").waitFor({ timeout: 10000 });
  ok("the same file again is three already there, to be updated", /^3 rows clean \(3 already there, to be updated\)/.test((await tid(off.page, "import-clean").innerText()).trim()), await tid(off.page, "import-clean").innerText());
  ok("...and nothing was duplicated", (await boysNamed()).length === 3);

  // The floors with the result on show, then on a phone.
  const okFloors = await floors(off.page, '[data-testid="import-panel"]');
  ok("the clean panel is on the 12px and 44px floors", okFloors.small.length === 0 && okFloors.taps.length === 0, okFloors.small.concat(okFloors.taps).join(" | "));
  await off.page.setViewportSize({ width: 390, height: 844 });
  await off.page.waitForTimeout(400);
  ok("at 390 wide there is no sideways scroll", await noSideways(off.page));
  const phone = await floors(off.page, '[data-testid="import-panel"]');
  ok("...and the panel is on the floors", phone.small.length === 0 && phone.taps.length === 0, phone.small.concat(phone.taps).join(" | "));
  ok("no console errors for the office", off.errors.length === 0, off.errors.join(" | "));
  await off.ctx.close();

  // The boys on Squad: the side's own tab, in a fresh page at desktop width.
  const sq = await open();
  ok("the office signs in again", await signIn(sq.page, OFFICE));
  ok("...and opens Squad", await nav(sq.page, "squad"));
  await sq.page.waitForTimeout(1500);
  const sideBtn = sq.page.locator("button", { hasText: /^U14A$/ }).first();
  ok("the side the file named is a tab on Squad", await sideBtn.count() === 1);
  await sideBtn.click({ timeout: 5000 });
  await sq.page.waitForTimeout(800);
  const squadText = await text(sq.page);
  ok("the three imported boys appear on Squad", NAMES.every((n) => squadText.includes(n)), NAMES.filter((n) => !squadText.includes(n)).join(" | "));

  // ── 5. Staff ─────────────────────────────────────────────────────
  group("Staff is the school's role assignments");
  const [{ school_id: HILTON }] = await q(`select school_id from app_user where email = $1`, [OFFICE]);
  const NOT = ["guardian", "parent", "player", "selfaccess", "spectator", "enquiry", "superadmin", "platformadmin"];
  const expected = (await q(
    `select distinct u.name from role_assignment a join app_user u on u.id = a.person_id
      where u.active and a.active and a.school_id = $1 and a.role <> all($2)
        and (a.valid_from is null or a.valid_from <= current_date) and (a.valid_until is null or a.valid_until > current_date)
      order by u.name`, [HILTON, NOT])).map((r) => r.name);
  ok("the seed has staff to show (so an empty screen would be a failure)", expected.length >= 8, expected.join(" | "));
  ok("the office opens Staff", await nav(sq.page, "staff"));
  try { await sq.page.locator('[data-testid="staff-card"]').first().waitFor({ timeout: 10000 }); } catch { /* checked next */ }
  const shownNames = await sq.page.locator('[data-testid="staff-name"]').allInnerTexts();
  ok("every person who holds a staff role at the school is on the screen, and nobody else",
     JSON.stringify([...shownNames].sort()) === JSON.stringify([...expected].sort()), `screen ${shownNames.join(" | ")} / db ${expected.join(" | ")}`);
  ok("the seed's coach, physio, scorer and driver are there", ["C Hendricks", "L van Wyk", "A Wessels", "B Ngcobo"].every((n) => shownNames.includes(n)));
  ok("a parent and a pupil are not", !shownNames.includes("D Pillay") && !shownNames.includes("R Pillay"));
  ok("the screen does not say there is no one", await tid(sq.page, "staff-none").count() === 0);
  const sarahCards = sq.page.locator('[data-testid="staff-card"]', { hasText: "Sarah Mokoena" });
  ok("a director of sport who is also a parent and a coach is one card", await sarahCards.count() === 1);
  const sarahRoles = await sarahCards.first().locator('[data-testid="staff-role"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-role")).sort().join());
  ok("...with her staff roles and no guardian role", sarahRoles === "coach,directorofsport", sarahRoles);
  ok("the old fake detail is gone: no invented qualifications", !/QUALIFICATIONS|EXPERIENCE|Concussion Protocol/i.test(await text(sq.page)));

  const coachCards = await q(
    `select distinct u.name from role_assignment a join app_user u on u.id = a.person_id
      where u.active and a.active and a.school_id = $1 and a.role = 'coach' order by u.name`, [HILTON]);
  await tid(sq.page, "staff-filter-coach").click({ timeout: 5000 });
  await sq.page.waitForTimeout(300);
  const coachNames = await sq.page.locator('[data-testid="staff-name"]').allInnerTexts();
  ok("the Coach filter shows the coaches", JSON.stringify([...coachNames].sort()) === JSON.stringify(coachCards.map((r) => r.name).sort()), coachNames.join(" | "));
  await tid(sq.page, "staff-filter-all").click({ timeout: 5000 });
  await sq.page.locator('[data-testid="staff-card"]', { hasText: "L van Wyk" }).first().click({ timeout: 5000 });
  await tid(sq.page, "staff-detail").waitFor({ timeout: 5000 });
  const detail = await tid(sq.page, "staff-detail").innerText();
  ok("a card opens its detail, with the email the read gives", /medical@example\.invalid/.test(detail) && /medical staff/i.test(detail), detail);
  const staffFloors = await floors(sq.page, '[data-testid="staff-view"]');
  ok("Staff is on the 12px floor", staffFloors.small.length === 0, staffFloors.small.slice(0, 5).join(" | "));
  ok("...and the 44px floor", staffFloors.taps.length === 0, staffFloors.taps.slice(0, 5).join(" | "));
  await tid(sq.page, "staff-close").click({ timeout: 5000 });
  await sq.page.setViewportSize({ width: 390, height: 844 });
  await sq.page.waitForTimeout(400);
  ok("Staff at 390 wide has no sideways scroll", await noSideways(sq.page));
  const staffPhone = await floors(sq.page, '[data-testid="staff-view"]');
  ok("...and is on the floors", staffPhone.small.length === 0 && staffPhone.taps.length === 0, staffPhone.small.concat(staffPhone.taps).slice(0, 5).join(" | "));
  ok("no console errors on Staff", sq.errors.length === 0, sq.errors.join(" | "));
  await sq.ctx.close();

  // ── 6. Demonstration ─────────────────────────────────────────────
  group("Nobody signed in: no form, and nothing posted");
  const demoPosts = [];
  const demo = await open("http://127.0.0.1:9");
  demo.page.on("request", (r) => { if (r.method() === "POST") demoPosts.push(r.url()); });
  ok("the demonstration's super admin gets in", await signIn(demo.page, "admin@hilton.co.za", "admin123"));
  ok("...and reaches Settings → Import", await toImport(demo.page));
  ok("it asks for a sign-in", /Sign in to the live platform to import/.test(await tid(demo.page, "import-panel").innerText()));
  ok("...and offers no file, Check or Import", await demo.page.locator('[data-testid="import-file"], [data-testid="import-check"], [data-testid="import-run"]').count() === 0);
  ok("nothing was posted", demoPosts.length === 0, demoPosts.join(","));
  ok("no console errors in the demonstration", demo.errors.length === 0, demo.errors.join(" | "));
  await demo.ctx.close();
} finally {
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (DEBUG && apiErr.length) console.log("[api stderr]", apiErr.join("").slice(0, 2000));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

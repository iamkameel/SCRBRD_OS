#!/usr/bin/env node
/**
 * Renders the built app in a real browser and fails on any console error or
 * unhandled rejection.
 *
 * A module refactor that compiles is not a refactor that runs: an import that
 * resolves can still be `undefined` at call time, and a cycle only shows up
 * when the modules actually evaluate. This is the check that catches that.
 *
 *   pnpm build && node tools/smoke.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { port } from "./db-url.mjs";

const ROOT = "apps/web/dist";
const PORT = port(4319);
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
  ".map": "application/json", ".json": "application/json",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  let file = join(ROOT, url === "/" ? "index.html" : url);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(ROOT, "index.html"); // SPA fallback
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ ...launchOptions() });
const page = await browser.newPage();
await offline(page.context());

const errors = [];
// Requests to third-party hosts (the Google Fonts stylesheet, Firebase) are
// aborted: a sandboxed CI network is not an app fault. Record them separately
// so a real application error is never hidden among them.
const external = [];
page.on("requestfailed", (r) => {
  const u = r.url();
  // This walk runs no API. The login screen — the app's first screen since
  // SCRBRD-142 — asks /api/health whether there is one and, refused, offers
  // the demo: that refusal is the question being answered, not a fault.
  if (/^https?:\/\/localhost(:\d+)?\/api\/health$/.test(u)) { external.push(`no API in this walk: ${u}`); return; }
  (/^https?:\/\/localhost/.test(u) ? errors : external).push(`requestfailed: ${u} (${r.failure()?.errorText})`);
});
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/Failed to load resource/.test(t)) return; // covered by requestfailed, with the URL
  errors.push(`console.error: ${t}`);
});
page.on("pageerror", (e) => { errors.push(`pageerror: ${e.message}`); });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });

// The first screen (the login page) must actually paint something, not just
// mount an empty root.
const rootHtml = await page.$eval("#root", (el) => el.innerHTML.length);
const text = await page.$eval("body", (el) => el.innerText);

const checks = [
  ["root rendered content", rootHtml > 500],
  ["first-screen copy present", /SCRBRD/i.test(text)],
  ["no console errors", errors.length === 0],
];

// Walk the app. This matters more than it looks: the views were converted
// from importing mock constants to reading through the rbac choke point, and
// a name that failed to bind is a ReferenceError that only appears when the
// view actually renders — invisible to both the compiler and the test suite.
const deep = [];
try {
  // The app opens on the login screen (SCRBRD-142: / is the public home page
  // now, and the app's own landing page is gone); a build from before it
  // opened on a landing page with a Log In button.
  const landing = page.locator("button", { hasText: /Get Started|Log In/ }).first();
  if (await landing.count()) { await landing.click({ timeout: 4000 }); await page.waitForTimeout(800); }

  // The login screen offers demo accounts; picking one fills the form.
  await page.locator("button", { hasText: "Head Coach" }).first().click({ timeout: 4000 });
  await page.waitForTimeout(300);
  await page.locator("button", { hasText: /^Sign In$/ }).first().click({ timeout: 4000 });
  await page.waitForTimeout(1800);

  const appText = await page.$eval("body", (el) => el.innerText);
  deep.push(["signed in to the app shell", /Dashboard|Squad|Matches/i.test(appText)]);

  // Every navigation destination this role can reach.
  const nav = await page.locator("nav button").all();
  const errsBeforeNav = errors.length;
  let visited = 0;
  for (const item of nav) {
    try {
      if (!(await item.isVisible())) continue;
      await item.click({ timeout: 2500 });
      await page.waitForTimeout(280);
      const body = await page.$eval("#root", (el) => el.innerHTML.length);
      if (body > 500) visited++;
      // The menu is the homes (EXPERIENCE_PASS §1.2): a home's other destinations are the sections on its bar.
      const sections = page.locator('[data-testid="home-frame"] [data-testid*="-section-"]');
      const n = await sections.count();
      for (let i = 1; i < n; i++) {
        await sections.nth(i).click({ timeout: 2500 });
        await page.waitForTimeout(280);
        if ((await page.$eval("#root", (el) => el.innerHTML.length)) > 500) visited++;
      }
    } catch { /* not a destination */ }
  }
  deep.push([`rendered ${visited} navigation destinations`, visited >= 10]);
  deep.push(["no errors while walking the views", errors.length === errsBeforeNav]);

  // Switching roles re-runs every view against a different scope, which is
  // the authorization path this refactor changed.
  // The demonstration's role list (DESIGN_DIRECTION §2.1, slice 12): behind "Switch role" on a laptop, in the name's
  // short sheet on a phone. A switch counts only once the list, opened again, marks that role as the current one.
  const errsBeforeRole = errors.length;
  const ROLES_TO = ["superadmin", "player", "guardian", "medical", "scorer"];
  const openRoles = async () => {
    const at = page.locator('[data-testid="topbar-role"], [data-testid="header-account"]').first();
    await at.click({ timeout: 2000 });
    await page.waitForTimeout(200);
  };
  let switched = 0;
  for (const role of ROLES_TO) {
    try {
      await openRoles();
      const opt = page.locator(`[data-testid="role-option-${role}"]`).first();
      if (!(await opt.count())) continue;
      await opt.click({ timeout: 2000 });
      await page.waitForTimeout(500);
      await openRoles();
      const now = await page.locator(`[data-testid="role-option-${role}"]`).first().getAttribute("aria-checked", { timeout: 2000 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      if (now === "true") switched++;
    } catch { /* not switched: counted below */ }
  }
  deep.push([`switched through ${switched} of ${ROLES_TO.length} roles`, switched === ROLES_TO.length]);
  deep.push(["no errors while switching roles", errors.length === errsBeforeRole]);
} catch (e) {
  deep.push([`walk threw: ${e.message.slice(0, 70)}`, false]);
}

await browser.close();
server.close();

let fail = 0;
for (const [name, ok] of [...checks, ...deep]) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) fail++;
}
if (errors.length) {
  console.log("\nApplication errors:");
  for (const e of errors.slice(0, 12)) console.log("  " + e);
}
if (external.length) {
  console.log(`\n(${external.length} third-party request(s) failed — not an app fault in a sandboxed network)`);
  for (const e of [...new Set(external)].slice(0, 4)) console.log("  " + e);
}
console.log(`\n${"─".repeat(52)}\nSMOKE: ${checks.length + deep.length - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

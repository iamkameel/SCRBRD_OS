#!/usr/bin/env node
/**
 * The pitch deck, in a real browser, as the platform account that may open it.
 *
 * The deck is the one screen that draws in 3D, and three.js is the one
 * dependency the client fetches on demand rather than on load. Both of those
 * are claims a build can silently stop honouring: a static import folds the
 * library into the entry chunk and nothing looks different; a GPU-less runner
 * has no WebGL and a deck that assumed one shows a black rectangle and a
 * stack trace. This walk holds the deck to what it says about itself —
 *
 *   - the three.js chunk is NOT requested until the deck opens, and IS then;
 *   - the stage mounts in whichever mode the browser supports and says which,
 *     with a canvas for WebGL or an SVG for the flat wheel, and no error either
 *     way;
 *   - switching 3D off swaps the canvas for the SVG; switching it back restores
 *     whatever the browser had;
 *   - every slide is reachable from the keyboard, in order, and the keys are
 *     ignored while a field has focus;
 *   - the figures are the figures: the wheel's scoreline is the seeded innings,
 *     the roadmap's three counts are Settings' own list, the school slide's
 *     numbers came from the server and not the demo;
 *   - every control has a name.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-deck.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { UPGRADES } from "../apps/web/src/data/roadmap.js";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const WEB_PORT = 4328;
const API_PORT = 8797;
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_DECK_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, detail) => { if (c) pass++; else { fail++; console.log("  ✗", n, detail ? `— ${String(detail).slice(0, 200)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-deck-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));

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

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext({ viewport: { width: 1380, height: 860 } });
await offline(ctx);
const page = await ctx.newPage();
const errors = [], refusals = [], sceneRequests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  const t = m.text();
  if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
  if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
});
// The three.js chunk is named after the module that imports it. Its name is
// the assertion: a static import anywhere in the entry graph and there is no
// such chunk, because the library is inside index-*.js.
page.on("request", (r) => { if (/\/assets\/scene-[^/]+\.js$/.test(r.url())) sceneRequests.push(r.url()); });
await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);

const text = () => page.$eval("body", (el) => el.innerText);
const click = async (re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const deck = () => page.locator('[data-testid="deck"]');
// A deck that crashed while rendering a slide is simply gone from the page,
// and the failure should name the error rather than wait thirty seconds for
// an element that will not return.
const slideNow = async () => (await deck().count()) ? deck().getAttribute("data-slide") : `(no deck: ${errors[0] ?? "no error logged"})`;
const stageMode = () => page.locator('[data-testid="deck-stage"]').getAttribute("data-mode");
const count = (sel) => page.locator(sel).count();
const press = async (key, ms = 900) => { await page.keyboard.press(key); await page.waitForTimeout(ms); };

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  // ── Getting there ───────────────────────────────────────────────
  group("The platform account opens the deck");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  // Not on the pilot's account list — it is not a school role — so the
  // address is typed, the way the login page allows.
  await page.locator('input[type="email"]').first().fill("platform@example.invalid");
  ok("Platform Ops signs in", await click(/^Sign In$/, 5000) && (await page.waitForTimeout(2000), /Dashboard|Match Centre/i.test(await text())));
  ok("the three.js chunk has not been fetched yet", sceneRequests.length === 0, sceneRequests[0]);
  const navBtn = page.locator("nav button", { hasText: /Pitch Deck/ }).first();
  ok("Pitch Deck is on the menu", await navBtn.count() === 1);
  await navBtn.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(2500);
  ok("the deck is on screen", await count('[data-testid="deck"]') === 1);
  ok("...and only now was the three.js chunk fetched, once", sceneRequests.length === 1, sceneRequests.join(", "));

  // ── The stage ───────────────────────────────────────────────────
  group("The stage says which way it is drawing, and draws that way");
  const initial = await stageMode();
  if (DEBUG) console.log("[debug] stage mode:", initial);
  ok("the stage settled on WebGL or the flat wheel, not loading", initial === "webgl" || initial === "fallback", initial);
  ok("WebGL means a canvas; the flat wheel means an SVG",
     initial === "webgl" ? (await count('[data-testid="deck-stage"] canvas')) === 1 && (await count('[data-testid="deck-stage"] svg')) === 0
                         : (await count('[data-testid="deck-stage"] svg')) === 1 && (await count('[data-testid="deck-stage"] canvas')) === 0);
  await page.locator('[data-testid="deck-3d-toggle"]').click();
  await page.waitForTimeout(700);
  ok("3D off swaps in the flat wheel", (await stageMode()) === "fallback" && (await count('[data-testid="deck-stage"] svg')) === 1 && (await count('[data-testid="deck-stage"] canvas')) === 0);
  await page.locator('[data-testid="deck-3d-toggle"]').click();
  await page.waitForTimeout(1500);
  ok("3D on restores what the browser had", (await stageMode()) === initial, await stageMode());
  ok("...without fetching the library again", sceneRequests.length === 1);

  // ── The keyboard ────────────────────────────────────────────────
  group("Every slide, from the keyboard");
  const order = ["cover", "problem", "wheel", "platform", "access", "school", "roadmap", "close"];
  ok("it opens on the cover", (await slideNow()) === "cover");
  for (let i = 1; i < order.length; i++) {
    await press("ArrowRight", 1100);
    const at = await slideNow();
    ok(`→ reaches ${order[i]}`, at === order[i] && (await count(`[data-testid="deck-slide-${order[i]}"]`)) === 1, at);
  }
  await press("ArrowRight", 400);
  ok("→ on the last slide stays put", (await slideNow()) === "close");
  await press("Home", 400);
  ok("Home returns to the cover", (await slideNow()) === "cover");
  await press("3", 900);
  ok("a digit goes straight to that slide", (await slideNow()) === "wheel");
  await press("ArrowLeft", 900);
  ok("← goes back one", (await slideNow()) === "problem");
  // The shell's search palette: keys typed there are typing, not navigation.
  await page.locator("button", { hasText: /Stats-Magic/ }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  const search = page.locator('input[aria-label*="Search" i]').first();
  ok("the search palette opens with its field", (await search.count()) === 1);
  if (await search.count()) {
    await search.focus();
    await press("ArrowRight", 400);
    ok("arrow keys inside a field do not turn the page", (await slideNow()) === "problem");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // ── The figures ─────────────────────────────────────────────────
  group("The figures are the figures");
  await press("3", 1200);
  const innings = await page.locator('[data-testid="deck-innings"]').innerText();
  ok("the wheel's scoreline is the seeded innings, 163/6", /^163\/6$/.test(innings.trim()), innings);
  const zone = page.locator('[data-testid^="deck-zone-"]').first();
  await zone.click();
  await page.waitForTimeout(300);
  ok("picking a sector marks it pressed", (await zone.getAttribute("aria-pressed")) === "true");
  await zone.click();
  await page.waitForTimeout(300);
  ok("...and picking it again releases it", (await zone.getAttribute("aria-pressed")) === "false");
  ok("no filter chip is offered for a line the wheel cannot draw", (await count('[data-testid="deck-key-W"]')) === 0);

  await press("6", 1800);
  const summary = page.locator('[data-testid="deck-summary"]');
  ok("the school slide's figures came from the server, not the demo", (await summary.getAttribute("data-live")) === "true");
  ok("...and say what they are scoped to", /summary read/i.test(await page.locator('[data-testid="deck-summary-source"]').innerText()));

  await press("7", 1200);
  const want = Object.fromEntries(["shipped", "partial", "planned"].map((s) => [s, UPGRADES.filter((u) => u.status === s).length]));
  for (const st of Object.keys(want)) {
    const col = page.locator(`[data-testid="deck-roadmap-${st}"]`);
    const n = Number((await col.locator(".deck-num").innerText()).trim());
    ok(`the roadmap's ${st} count is Settings' own (${want[st]})`, n === want[st], n);
    ok(`...and lists that many items`, (await col.locator("button").count()) === want[st]);
  }

  // ── Names, errors ───────────────────────────────────────────────
  group("Every control is named, and nothing went wrong");
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="deck"] button, [data-testid="deck"] a[href]')]
      .filter((el) => !(el.getAttribute("aria-label") || el.textContent.replace(/\s+/g, " ").trim()))
      .map((el) => el.outerHTML.slice(0, 80)));
  ok("every button on the deck has a name", unnamed.length === 0, unnamed.slice(0, 3).join(" · "));
  ok("no screen asked the browser to scope for it", refusals.length === 0, refusals[0]);
  ok("the browser logged no errors", errors.length === 0, errors[0]);
} catch (e) {
  fail++;
  console.log("  ✗ walk aborted:", e.message);
} finally {
  await browser.close().catch(() => {});
  web.close();
  api.kill();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}

console.log("\n" + "─".repeat(52));
console.log(`BROWSER DECK SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * Gate 2 from the backend's "Honest status": score offline, hard-refresh
 * mid-over, confirm nothing is lost.
 *
 * This is the check that separates a demo from a product. The old artifact
 * had no persistence of any kind — a refresh discarded the match — and that
 * single fact is why the handover says it is a specification rather than an
 * MVP. Everything else here is downstream of it being true.
 *
 * The run: sign in, open a live fixture, score deliveries with the network cut,
 * hard-reload the page, and read the score back off the rebuilt board.
 *
 *   pnpm build && node tools/smoke-persist.mjs
 *   PERSIST_DEBUG=1 node tools/smoke-persist.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline, isFirebaseOfflineNoise } from "./offline-browser.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const PORT = 4324;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const DEBUG = !!process.env.PERSIST_DEBUG;

const server = createServer(async (req, res) => {
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
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ ...launchOptions() });
// One persistent context: IndexedDB must survive the reload, which means the
// same origin and the same profile. A fresh page in the same context is exactly
// what a scorer's browser does when it reloads the tab.
const page = await browser.newPage();
await offline(page.context());

const errors = [];
page.on("pageerror", (e) => { if (!isFirebaseOfflineNoise(e.message)) errors.push(`pageerror: ${e.message}`); });
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  // "Failed to load resource" is Chrome's own line for a 404/aborted request.
  if (/Failed to load resource/.test(t) || isFirebaseOfflineNoise(t)) return;
  errors.push(`console.error: ${t}`);
});

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const text = () => page.$eval("body", (el) => el.innerText);
const click = async (re, ms = 2500) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(240);
  return true;
};
const scoreOf = async () => ((await text()).match(/\b\d{1,3}\s*[-/]\s*\d{1,2}\b/) || [])[0] ?? null;
const clearBlockers = async () => {
  for (let i = 0; i < 5; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(600); continue; }
    const batters = page.locator("button:not([disabled])", { hasText: /\bNEXT\b/i });
    if (await batters.count()) { try { await batters.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(600); continue; }
    return;
  }
};
const intoScorer = async () => {
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(700);
  await click(/^Live$/, 2500);
  await click(/Open Live Scorer/i, 5000);
  await page.waitForTimeout(1500);
  await clearBlockers();
  if (!/\bDOT\b/i.test(await text())) await click(/QUICK MODE/i, 2500);
  await page.waitForTimeout(400);
};

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });

  // A service worker only starts intercepting AFTER the load that registers
  // it, so the first visit populates nothing. Wait for it to take control and
  // reload once with signal — which is exactly the real sequence: the scorer
  // opens the app at the ground while there is still a connection, and loses
  // it later.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 })
    .catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  ok("service worker is controlling the page",
     await page.evaluate(() => navigator.serviceWorker?.controller != null));

  await click(/Get Started|Log In/, 5000);
  await click("Head Coach", 5000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(1400);
  await intoScorer();

  const opening = await scoreOf();
  ok("scorer is on the pad with a score", opening !== null && /\bDOT\b/i.test(await text()));

  // Cut the network. A school ground has no signal; nothing about scoring may
  // depend on reaching anything.
  await page.context().setOffline(true);
  ok("went offline", true);

  const errsBefore = errors.length;
  let scored = 0;
  for (const face of ["1", "2", "4", "2"]) {
    await clearBlockers();
    if (await click(new RegExp(`^${face}$`), 2500)) scored++;
    await page.waitForTimeout(600);
  }
  await clearBlockers();
  ok(`scored ${scored} deliveries with the network down`, scored >= 3);
  ok("no errors while scoring offline", errors.length === errsBefore);

  const beforeReload = await scoreOf();
  ok("offline scoring moved the board", beforeReload !== null && beforeReload !== opening);
  if (DEBUG) console.log(`[debug] ${opening} → ${beforeReload} before reload`);

  // Let the write settle, then pull the rug: a hard reload, still offline.
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  ok("app comes back after a hard reload", (await page.$eval("#root", (el) => el.innerHTML.length)) > 500);

  // The session should have put us back inside the app rather than the landing
  // page — a scorer should not have to log in again mid-over.
  const backInApp = /Match Centre|Dashboard|DOT|UNDO/i.test(await text());
  ok("reload lands back in the app, not the landing page", backInApp);

  // Did the session put the scorer straight back on the pad, or only back
  // into the app? Both are far better than the landing page, but they are
  // different promises and the difference matters when play is continuing.
  const straightBackToPad = /\bDOT\b/i.test(await text()) || /UNDO/i.test(await text());
  ok("reload restores the scorer directly to the pad", straightBackToPad);

  await page.context().setOffline(false); // the assets are cached; restore for cleanliness

  const inScorer = /UNDO|OUTCOME|Phase|\bDOT\b/i.test(await text());
  if (inScorer) {
    // Already on the scoring surface — just make sure it is the one-tap pad,
    // since the mode is UI preference and is not part of the saved match.
    await clearBlockers();
    if (!/\bDOT\b/i.test(await text())) await click(/QUICK MODE/i, 2500);
  } else {
    // Session restored the shell but not the scorer: walk back in.
    if (!/Match Centre/i.test(await text())) await click(/Get Started|Log In/, 3000);
    if (/Head Coach/i.test(await text())) { await click("Head Coach", 3000); await click(/^Sign In$/, 3000); await page.waitForTimeout(1200); }
    await intoScorer();
  }
  await clearBlockers();

  const afterReload = await scoreOf();
  if (DEBUG) console.log(`[debug] ${afterReload} after reload`);
  ok("the match is still there after the reload", afterReload !== null);
  // The whole point: the deliveries scored offline survived.
  ok(`score survived the reload (${beforeReload} → ${afterReload})`, afterReload === beforeReload);
  ok("no errors after the reload", errors.length === errsBefore);
} catch (e) {
  ok(`persistence walk threw: ${e.message.slice(0, 90)}`, false);
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.log("\nApplication errors:");
  for (const e of [...new Set(errors)].slice(0, 8)) console.log("  " + e);
}
console.log(`\n${"─".repeat(52)}\nPERSISTENCE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

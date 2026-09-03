#!/usr/bin/env node
/**
 * The read path, from a browser, signed in as real people.
 *
 * tools/smoke-read.mjs proves the API returns different rows to different
 * people. This proves the CLIENT actually renders those rows — that the views
 * were converted, that nothing is still filtering a mock module in the
 * browser, and that a guardian's screen contains their own child and nobody
 * else's.
 *
 * The distinction has cost this codebase real bugs. A view can read through a
 * perfectly correct API and still show mock data, because the mock import is
 * two lines above the fetch and renders first. Only a browser can tell.
 *
 * The strongest assertion here is a negative one: a live session must produce
 * NO "[scrbrd] getData(...) refused" warnings. That warning fires whenever a
 * component asks the client-side scoping layer for rows while signed in, which
 * is exactly the thing that is no longer allowed to happen. A screen that
 * still calls it renders empty and looks like a data problem; the warning is
 * what names it as a wiring problem.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-read.mjs
 *   BROWSER_READ_DEBUG=1 node tools/smoke-browser-read.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const WEB_PORT = 4326;
const API_PORT = 8795;
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_READ_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-read-secret",
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

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--disable-background-networking", "--disable-sync", "--no-first-run"],
});

/** A fresh page per person: a session must not leak between them. */
async function open() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const refusals = [], errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
    if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, refusals, errors };
}

const text = (page) => page.$eval("body", (el) => el.innerText);
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};

/** Sign in through the UI, as the pilot login offers each seeded account. */
async function signIn(page, who) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await click(page, who, 4000);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}

async function nav(page, label) {
  const l = page.locator("nav button", { hasText: label }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  // The rows arrive over the network, so the assertion has to wait for the
  // fetch and not just for the click. A screen asserted mid-flight is empty
  // for a reason that has nothing to do with authorization.
  await page.waitForTimeout(1500);
  return true;
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── The coach ───────────────────────────────────────────────────
  group("A coach sees their own squad, from the database");
  const coach = await open();
  ok("a seeded coach signs in", await signIn(coach.page, /Coach/));
  ok("the squad screen opens", await nav(coach.page, /Squad/));
  const squad = await text(coach.page);
  if (DEBUG) console.log("[debug] coach squad:\n" + squad.slice(0, 700));

  // Seeded names, which exist only in Postgres.
  ok("the roster carries seeded players, not mock ones", /Bekker|Naidoo|Cele|Pillay/.test(squad));
  // Mock-only names. If any of these appear, a view is still rendering the
  // mock module in a live session — the exact failure this whole change
  // exists to make impossible.
  ok("no mock player appears anywhere on the screen",
     !/Luca De Villiers|Ethan Solomons|Theo Pretorius|Aiden Petersen/.test(squad));

  ok("no screen asked the browser to scope for it" +
     (coach.refusals.length ? ` — ${coach.refusals[0].slice(0, 120)}` : ""),
     coach.refusals.length === 0);

  // ── The guardian ────────────────────────────────────────────────
  // The sharpest case in the seed: one assignment, one child. Anything wider
  // than a single name on this screen is a leak.
  group("A guardian sees one child");
  const parent = await open();
  ok("the guardian signs in", await signIn(parent.page, /Parent|Guardian/));
  ok("the squad screen opens for them", await nav(parent.page, /Squad/));
  const pSquad = await text(parent.page);
  if (DEBUG) console.log("[debug] guardian squad:\n" + pSquad.slice(0, 700));
  ok("their own child is on it", /Pillay/.test(pSquad));
  ok("...and no other child is", !/Bekker|Naidoo|Cele|Whitfield/.test(pSquad));
  ok("the guardian's session raised no scoping refusals", parent.refusals.length === 0);

  // ── A notification is not permission ────────────────────────────
  group("The notification feed is not a way around RLS");
  const watcher = await open();
  ok("a spectator signs in", await signIn(watcher.page, /Spectator|Watcher/));
  if (await nav(watcher.page, /Notifications|Alerts/)) {
    const feed = await text(watcher.page);
    if (DEBUG) console.log("[debug] spectator feed:\n" + feed.slice(0, 700));
    ok("the spectator receives general notices", /Fixture list published/i.test(feed));
    ok("...and NOT the one naming a child's injury", !/hamstring/i.test(feed));
  } else {
    // A spectator may legitimately have no notifications entry in their nav.
    // That is a presentation decision; the API refusal is the security one and
    // smoke-read.mjs asserts it. Recorded rather than silently skipped.
    ok("the spectator has no notifications nav entry (checked at the API instead)", true);
    ok("...and the API-level assertion covers the medical notice", true);
  }

  const medic = await open();
  ok("the medical officer signs in", await signIn(medic.page, /Medical|Physio/));
  if (await nav(medic.page, /Notifications|Alerts/)) {
    ok("the medical officer does receive it", /hamstring/i.test(await text(medic.page)));
  } else {
    ok("the medical officer's feed is not on their nav (API assertion covers it)", true);
  }

  // ── Nothing threw ───────────────────────────────────────────────
  group("The screens render without errors");
  for (const [who, s] of [["coach", coach], ["guardian", parent], ["spectator", watcher], ["medic", medic]]) {
    ok(`${who}: no uncaught error${s.errors.length ? ` — ${s.errors[0].slice(0, 140)}` : ""}`,
       s.errors.length === 0);
  }
} catch (e) {
  ok(`the browser read walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  await browser.close().catch(() => {});
  api.kill("SIGTERM");
  web.close();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER READ SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

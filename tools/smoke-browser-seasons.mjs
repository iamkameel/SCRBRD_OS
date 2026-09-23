#!/usr/bin/env node
/**
 * The Season History Archive, from a browser. up11.
 *
 * Seasons and competitions were modelled and readable long before this walk
 * — tools/smoke-season.mjs proves `/read/seasons` and `/read/competitions`
 * against the API directly. Nothing before this proved a PERSON could ever
 * see a year next to what happened in it: `grep -rn "season" apps/web/src/
 * views` found the label threaded through fixtures and competitions, never a
 * screen that let someone choose a season and look at it.
 *
 * apps/web/src/views/SeasonHistoryView.jsx is that screen, mounted as a
 * "History" tab on Leagues. This walk drives it as the director of sport —
 * school-scoped rather than the coach's team-scoped view (smoke-read.mjs:
 * "a team-scoped coach sees only their team's fixtures"), which is what a
 * year-on-year archive should be — against the real seeded seasons
 * (db/98_seed_pilot.sql's school-level rows run 2024 to 2030 — see
 * db/08_schema_programme.sql — with 2026 current on the date this walk
 * runs), and asks three questions a curl command at /read/seasons cannot:
 *
 *   1. Do the seeded seasons render at all, with the current one marked?
 *   2. Choosing a season with real cricket in it (2026: the seeded KZN
 *      Schools T20 League and its four fixtures) shows that competition,
 *      its real standings, and its real fixtures.
 *   3. Choosing a season with nothing recorded (2025) shows an HONEST empty
 *      state for both — not the other season's rows left on screen, and not
 *      an invented one.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-seasons.mjs
 *   BROWSER_SEASONS_DEBUG=1 node tools/smoke-browser-seasons.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const WEB_PORT = 4345;
const API_PORT = 8845;
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_SEASONS_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-seasons-secret",
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

const browser = await chromium.launch({ ...launchOptions() });

async function open() {
  const ctx = await browser.newContext();
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}

const text = (page) => page.$eval("body", (el) => el.innerText);
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
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
  await page.waitForTimeout(1500);
  return true;
}
const archive = (page) => page.locator('[data-testid="season-history"]');
/** Click a season button by its label, scoped to the season list so a year
 *  that also appears elsewhere on screen (a fixture's date, say) is not
 *  matched instead. */
const seasonBtn = (page, label) => page.locator('[data-testid="season-list"] button', { hasText: label }).first();

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  group("The director of sport opens Leagues and the Season History tab");
  const dos = await open();
  ok("the director of sport signs in", await signIn(dos.page, /sarah@example\.invalid|Director/));
  ok("the Leagues screen opens", await nav(dos.page, /Leagues/));
  ok("the History tab is offered", await click(dos.page, /^History$/i, 4000));
  await dos.page.waitForTimeout(1200);
  ok("the archive renders", await archive(dos.page).count() === 1);

  group("Every seeded school season is on the list, the current one marked");
  const listText = await archive(dos.page).innerText();
  if (DEBUG) console.log("[debug] archive on open:\n" + listText);
  for (const y of ["2024", "2025", "2026", "2027", "2028", "2029", "2030"]) {
    ok(`season ${y} is listed`, await seasonBtn(dos.page, y).count() >= 1, listText.slice(0, 200));
  }
  const currentBadgeCount = await dos.page.locator('[data-testid="season-current"]').count();
  ok("exactly one season is marked current", currentBadgeCount === 1, String(currentBadgeCount));
  // Badge renders its text upper-cased (see ui/primitives.jsx), which
  // innerText reflects — hence /i rather than the literal "Current".
  ok("...and it is 2026, the season sa_today() falls in", /2026[\s\S]{0,40}Current/i.test(listText), listText.slice(0, 300));

  group("2026 opens by default (the current season) with its real competition and fixtures");
  ok("the seeded league is named", /KZN Schools T20 League/.test(listText), listText.slice(0, 500));
  ok("...with its real standings — both entrants, not invented ones", /Hilton 1st XI/.test(listText) && /Westville 1st XI/.test(listText));
  ok("...and their real points", /\b8\b/.test(listText) && /\b6\b/.test(listText));
  const fixtureCount = await dos.page.locator('[data-testid^="season-fixture-"]').count();
  ok("all four seeded fixtures for 2026 are shown", fixtureCount === 4, String(fixtureCount));
  ok("naming the real opponents, not mock ones", /Westville Boys/.test(listText) && /Michaelhouse/.test(listText) && /Kearsney College/.test(listText) && /Maritzburg College/.test(listText));

  group("Choosing a season with nothing recorded shows an honest empty state, not 2026's rows left over");
  ok("2025 is chosen", await seasonBtn(dos.page, "2025").click().then(() => true).catch(() => false));
  await dos.page.waitForTimeout(900);
  const y2025 = await archive(dos.page).innerText();
  if (DEBUG) console.log("[debug] archive on 2025:\n" + y2025);
  ok("no competitions are claimed for 2025", /No competitions recorded for 2025/.test(y2025), y2025.slice(0, 400));
  ok("no fixtures are claimed for 2025", /No fixtures recorded for 2025/.test(y2025));
  ok("2026's league does not linger on screen", !/KZN Schools T20 League/.test(y2025));
  ok("2026's fixtures do not linger on screen", !/Michaelhouse/.test(y2025));

  group("Choosing 2026 again brings its competition and fixtures straight back");
  ok("2026 is chosen again", await seasonBtn(dos.page, "2026").click().then(() => true).catch(() => false));
  await dos.page.waitForTimeout(900);
  const back = await archive(dos.page).innerText();
  ok("the league is back", /KZN Schools T20 League/.test(back));
  ok("the fixtures are back", (await dos.page.locator('[data-testid^="season-fixture-"]').count()) === 4);

  ok("no console errors on the director of sport's session", dos.errors.length === 0, dos.errors.join(" | "));

  await dos.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser seasons walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SEASONS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

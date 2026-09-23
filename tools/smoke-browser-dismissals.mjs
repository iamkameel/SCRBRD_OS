#!/usr/bin/env node
/**
 * up48: "how he's out", from a browser. Dismissal Analysis.
 *
 * tools/smoke-dismissals.mjs proves the API returns the right rows and keeps
 * a run out off a bowler's figures. tools/smoke-browser-read.mjs proves that
 * a browser session actually renders what a live read returns and not a mock
 * fallback, for a dozen other resources — but nothing before this opened a
 * player's own profile and looked for the dismissal-by-method card, because
 * there was no card to open (the roadmap's up48 was `partial`: two views and
 * a read resource, no screen).
 *
 * This drives the CAREER tab of a real seeded boy's profile and asks the
 * questions a curl command against /api/read/dismissal_breakdown cannot:
 *
 *   1. Does the card actually render, with the REAL seeded fact — db/98
 *      credits T Bekker with a "bowled" dismissal at ball 34 of the Hilton v
 *      Maritzburg College fixture, and NOTHING else for him — so the card
 *      must show exactly "Bowled" once and nothing invented beside it?
 *   2. Is it filtered to the right boy? M Cele's own dismissal (ball 71,
 *      "caught") must never bleed onto Bekker's card, and Bekker's "Bowled"
 *      must never bleed onto Cele's.
 *   3. Does the screen actually reach Postgres for this, rather than a mock
 *      module — the same "no [scrbrd] getData(...) refused" negative
 *      smoke-browser-read.mjs already asks of every other resource?
 *   4. Is the boy's row itself out of reach for an account that cannot read
 *      it at all? player_dismissal_breakdown / player_wicket_breakdown
 *      inherit RLS from the `player` row (player.profile.read) and from
 *      ball_event_live (fixture.read) — the same gate `career` already
 *      relies on (see the comment on `dismissal_breakdown` in
 *      services/api/read/read-api.mjs). player.performance.read is a real
 *      capability every scoring role holds, but nothing on this read path
 *      asks for it — inventing a second gate here that `career` does not
 *      have would make two people with identical assignments see different
 *      things from the two resources, for no reason either could discover.
 *      So the account this walk picks to prove "cannot see the figures" is
 *      one that holds NEITHER player.profile.read NOR player.performance.read
 *      (packages/policy/src/roles.mjs: spectator holds only fixture.read,
 *      news.read, competition.read) — the watcher@example.invalid account
 *      PILOT_ACCOUNTS offers, which smoke-browser-read.mjs already uses as
 *      the clean spectator case. For them the Profiles screen is not even
 *      offered, because player.profile.read is what gates it
 *      (design/roles.js NAV_CAPABILITY) — the figures are unreachable
 *      because the profile they would sit on is unreachable, which is the
 *      real, enforced boundary rather than an invented one this walk made up.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-dismissals.mjs
 *   BROWSER_DISMISSALS_DEBUG=1 node tools/smoke-browser-dismissals.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const WEB_PORT = 4341;
const API_PORT = 8841;
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_DISMISSALS_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

// The seed's own facts (db/98_seed_pilot.sql) — real players, real methods,
// nothing invented for this walk.
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";   // bowled at ball 34
const CELE   = "aaaaaaaa-0000-0000-0000-000000000004";   // caught at ball 71

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-dismissals-secret",
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

/** A fresh context per person, as smoke-browser-read.mjs does it. */
async function open() {
  const ctx = await browser.newContext();
  await offline(ctx);
  const page = await ctx.newPage();
  const refusals = [], errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
    if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
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
/** Opens a player's profile from the roster and lands on the CAREER tab. */
async function openCareer(page, playerId) {
  await page.locator(`[data-testid="roster-player-${playerId}"]`).first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);
  const tab = page.locator("button", { hasText: /^career$/i }).first();
  await tab.click({ timeout: 4000 });
  await page.waitForTimeout(1200);
}
const battingCard = (page) => page.locator('[data-testid="dismissal-breakdown-batting"]');

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  group("A coach opens T Bekker's profile and sees the real seeded method");
  const coach = await open();
  ok("the coach signs in", await signIn(coach.page, /Coach/));
  ok("the profiles screen opens", await nav(coach.page, /Profiles/));
  await openCareer(coach.page, BEKKER);
  ok("the dismissals-by-method card is on the career tab", await battingCard(coach.page).count() === 1);
  const bekkerText = await battingCard(coach.page).innerText().catch(() => "");
  if (DEBUG) console.log("[debug] Bekker's card:\n" + bekkerText);
  ok("...titled for what it shows", /DISMISSALS BY METHOD/.test(bekkerText));
  ok("...naming the real seeded method — bowled", /Bowled/.test(bekkerText));
  // Exactly one dismissal, seeded once, at ball 34 — not a count invented or
  // duplicated by a stray row from elsewhere in the seed.
  ok("...with the real seeded count next to it", /Bowled[\s\S]*?1 · 100%/.test(bekkerText), bekkerText);
  ok("...and nothing else on it — one method, nothing invented", !/Caught|Lbw|LBW|Run out|Stumped/.test(bekkerText));
  ok("...no NULL-method row either — his one dismissal has a real method",
     !/Method not recorded/.test(bekkerText));
  // "Caught and bowled" is deliberately not a line this platform can draw
  // (db/26's own comment) — asserted here as a negative, not just left untested.
  ok("...and never a caught-and-bowled line, which the data cannot support",
     !/caught.and.bowled/i.test(bekkerText));

  group("The card is filtered to THIS boy — M Cele's dismissal does not leak onto it");
  await nav(coach.page, /Profiles/);
  await openCareer(coach.page, CELE);
  const celeText = await battingCard(coach.page).innerText().catch(() => "");
  if (DEBUG) console.log("[debug] Cele's card:\n" + celeText);
  ok("Cele's card shows HIS real seeded method — caught, not bowled", /Caught/.test(celeText) && !/Bowled/.test(celeText));
  ok("...with his own count, not Bekker's carried over", /Caught[\s\S]*?1 · 100%/.test(celeText), celeText);

  ok("no scoping refusal reached the console — this is Postgres, not a mock",
     coach.refusals.length === 0, coach.refusals.join(" | "));
  ok("no console errors on the coach's session", coach.errors.length === 0, coach.errors.join(" | "));
  await coach.ctx.close().catch(() => {});

  group("An account that cannot read a player's profile cannot reach the figures either");
  // spectator (watcher@example.invalid) holds neither player.profile.read nor
  // player.performance.read (packages/policy/src/roles.mjs) — the Profiles
  // destination itself is gated on player.profile.read
  // (apps/web/src/design/roles.js NAV_CAPABILITY), so it is not even offered.
  // The figures are unreachable because the profile they sit on is
  // unreachable — the real, RLS-derived boundary, not a second gate invented
  // for this walk.
  const watcher = await open();
  ok("the spectator signs in", await signIn(watcher.page, /Spectator|Watcher/));
  const watcherNav = await watcher.page.locator("nav button").allTextContents();
  ok("...and Profiles is not on their menu at all", !watcherNav.some((t) => /Profiles/i.test(t)), watcherNav.join(", "));
  ok("no console errors on the spectator's session", watcher.errors.length === 0, watcher.errors.join(" | "));
  await watcher.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser dismissals walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 8).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER DISMISSALS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * The narrow-screen, keyboard and daylight pass (gap analysis I32), on the real stack.
 *
 * Match day is scorers, coaches and parents on phones, outdoors in sun. tools/smoke-a11y.mjs holds the screens it can
 * draw without a server (the pad, the cockpit, the ground display, the staff shell) to the same lists at 320; this walk
 * holds the ones that need a database, signed in as the seed's own people:
 *
 *   the parent     Home with her action list, Matches, Notices, Family
 *   the pupil      Home, Matches, Passport, Me
 *   the coach      Dashboard, the Match Centre list, a live fixture's six tabs, and the Coach tab
 *   the scorer     his home, with the Resume card and the fixtures
 *
 * at 320, 375 and 414 in Daylight, at 320 under lights, and at 200% zoom (a 375 phone with the page zoomed, which is
 * 188px of layout). Each screen is measured by tools/a11y-narrow.mjs and every list it keeps must be empty: nothing
 * sideways, off the screen, clipped or drawn over; nothing under 12px or 44px; no text, field edge, placeholder or icon
 * under its contrast. Then the keyboard: Tab from the top of each person's Home, every stop in view and with a ring
 * whose colour is 3:1 against what is behind it.
 *
 * Names are the seed's illustrative ones (db/98) and the Match Centre fixture's (tools/fixture-matchcentre.mjs).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-narrow.mjs
 *   NARROW_DEBUG=1 NARROW_SHOTS=/some/dir node tools/smoke-browser-narrow.mjs     print every list, keep a picture of each
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { buildMatchCentreFixture } from "./fixture-matchcentre.mjs";
import { narrowAudit, tabPath } from "./a11y-narrow.mjs";

const WEB_PORT = port(5420);
const API_PORT = port(8920);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.NARROW_DEBUG;
const SHOTS = process.env.NARROW_SHOTS || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 360)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-narrow-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await pool.query(text, params)).rows;
const browser = await chromium.launch({ ...launchOptions() });

/** What each of narrowAudit's lists means, for the failure line. */
const WORDS = {
  sideways: "no sideways scroll", offscreen: "nothing off the screen", clipped: "no text cut off", overlap: "nothing drawn over anything else",
  small: "no text under 12px", tiny: "nothing tapped under 44px", weak: "every text, field edge and icon clears its contrast",
};

/** A phone of this width; `zoom` 2 is the page zoomed to 200%: half the layout width at twice the pixels. */
async function open({ width, scheme, zoom = 1 }) {
  const ctx = await browser.newContext({ viewport: { width: Math.round(width / zoom), height: Math.round(720 / zoom) }, deviceScaleFactor: zoom,
    isMobile: true, hasTouch: true, colorScheme: scheme });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
async function signIn(page, email) {
  const lg = page.locator("button:not([disabled])", { hasText: /Get Started|Log In/ }).first();
  if (await lg.count()) { await lg.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(500); }
  await page.locator("#login-email").fill(email);
  await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForSelector('[data-testid="os-main"]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
const loaded = (page) => page.waitForFunction(() => !/Loading|Reading/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});

/** One screen, held to every list. */
async function check(page, label, screen, { root = null } = {}) {
  await loaded(page);
  await page.waitForTimeout(400);
  const r = await narrowAudit(page, { root });
  ok(`${label} ${screen}: the screen is on the page`, r.found);
  for (const k of /** @type {const} */ (Object.keys(WORDS))) {
    ok(`${label} ${screen}: ${WORDS[k]}`, r[k].length === 0, `${r[k].length}: ${r[k].slice(0, 4).join(" · ")}`);
    if (DEBUG && r[k].length) for (const x of r[k].slice(0, 14)) console.log(`   [${label} ${screen}] ${k}: ${x}`);
  }
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${label.replace(/[^a-z0-9]+/gi, "-")}-${screen}.png`) }).catch(() => {});
  return r;
}

/** Tab through a screen: every stop is on the screen and shows a ring. */
async function keyboard(page, label, screen) {
  const stops = await tabPath(page, 60);
  ok(`${label} ${screen}: Tab reaches ${stops.length} controls`, stops.length > 0);
  const hidden = stops.filter((s) => !s.on);
  ok(`${label} ${screen}: every stop is brought into view`, hidden.length === 0, hidden.slice(0, 3).map((s) => s.label).join(" · "));
  const bare = stops.filter((s) => !s.ring && !s.shadow);
  ok(`${label} ${screen}: every stop shows a focus ring`, bare.length === 0, bare.slice(0, 3).map((s) => s.label).join(" · "));
}


try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (SHOTS) await mkdir(SHOTS, { recursive: true });

  // A live fixture with a real log, for the Match Centre's tabs (the same one smoke-browser-matchcentre.mjs reads).
  const fx = await buildMatchCentreFixture(q);

  const mnav = (page, key) => page.locator(`[data-testid="mnav-${key}"]`).first().click({ timeout: 5000 }).then(() => page.waitForTimeout(1200)).catch(() => false);
  const PERSONAS = {
    parent: { email: "parent@example.invalid", screens: [["home", null], ["matches", "fixtures"], ["notices", "notices"], ["family", "family"]] },
    pupil: { email: "pillay@example.invalid", screens: [["home", null], ["matches", "mymatches"], ["passport", "passport"], ["me", "me"]] },
    scorer: { email: "scorer@example.invalid", screens: [["home", null]] },
    coach: { email: "coach@example.invalid", screens: [["dashboard", null], ["matches", "matches"]] },
  };
  /** The runs: [label, width, scheme, zoom] */
  const RUNS = [
    ["Daylight @320", 320, "light", 1], ["Daylight @375", 375, "light", 1], ["Daylight @414", 414, "light", 1],
    ["Floodlit @320", 320, "dark", 1], ["Daylight 200% of 375", 375, "light", 2],
  ];

  for (const [label, width, scheme, zoom] of RUNS.filter(([l]) => !process.env.NARROW_ONLY || l.includes(process.env.NARROW_ONLY))) {
    group(`${label}`);
    for (const [who, p] of Object.entries(PERSONAS)) {
      const { ctx, page, errors } = await open({ width, scheme, zoom });
      try {
        await signIn(page, p.email);
        ok(`${label} ${who}: signs in`, await page.locator('[data-testid="os-main"]').count() === 1);
        for (const [screen, key] of p.screens) {
          if (key) await mnav(page, key);
          await check(page, `${label} ${who}`, screen);
        }
        if (who === "coach") {
          // The Match Centre's live fixture: every tab, and the Coach tab.
          await mnav(page, "matches");
          await page.locator(`[data-testid="mc-open-${fx.live}"]`).click({ timeout: 6000 }).catch(() => {});
          await page.waitForTimeout(1800);
          ok(`${label} coach: the live fixture opens`, await page.locator('[data-testid="match-view"]').count() === 1);
          for (const t of ["summary", "scorecard", "commentary", "partnerships", "analytics", "details"]) {
            await page.locator(`[data-testid="mc-tab-${t}"]`).click({ timeout: 4000 }).catch(() => {});
            await page.waitForTimeout(600);
            await check(page, `${label} coach`, `match-${t}`);
          }
          if (await page.locator('[data-testid="mc-tab-coach"]').count()) {
            await page.locator('[data-testid="mc-tab-coach"]').click({ timeout: 4000 }).catch(() => {});
            await page.waitForTimeout(1800);
            await check(page, `${label} coach`, "match-coach");
          }
        }
        if (width === 320 && zoom === 1) {
          // The keyboard, from the top of the person's first screen.
          await page.reload({ waitUntil: "networkidle" });
          await page.waitForTimeout(1800);
          await keyboard(page, `${label} ${who}`, p.screens[0][0]);
        }
        ok(`${label} ${who}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
      } catch (e) {
        ok(`${label} ${who}: the walk threw`, false, /** @type {any} */ (e).message);
      } finally {
        await ctx.close();
      }
    }
  }
  ok("the API wrote nothing to stderr", apiErr.join("").trim() === "", apiErr.join("").slice(0, 200));
} finally {
  await browser.close();
  api.kill();
  web.close();
  await pool.end();
}

console.log(`\n${"─".repeat(52)}\nNARROW SMOKE (browser): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

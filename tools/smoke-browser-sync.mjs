#!/usr/bin/env node
/**
 * The whole thing, from a phone.
 *
 * Gates 3 and 4 prove the protocol, but they drive the API from Node. This is
 * the one that proves a SCORER can do it: a real browser, signing in against a
 * real server, opening a real fixture, tapping real buttons, and the balls
 * arriving in Postgres — checked by asking the database, not the page.
 *
 * That distinction has earned its keep twice already in this codebase. The
 * masked views leaked every school's rows and 31 unit assertions could not see
 * it; the fixture query named six columns that do not exist and every one of
 * those assertions still passed. Anything that only ever talks to a fake is
 * proving something narrower than it appears to.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-sync.mjs
 *   BROWSER_SYNC_DEBUG=1 node tools/smoke-browser-sync.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline, isFirebaseOfflineNoise } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 4325;
const API_PORT = 8794;
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_SYNC_DEBUG;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

// ── The API, and a static server for the built client ────────────
const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-sync-secret",
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

// The client is built with a baked-in API base, so point it at ours by
// rewriting the one constant at load time rather than rebuilding per run.
const pool = new pg.Pool({ connectionString: DB });
const dbq = async (text, params) => (await pool.query(text, params)).rows;

const browser = await chromium.launch({ ...launchOptions() });
const page = await browser.newPage();
await offline(page.context());

const errors = [];
page.on("pageerror", (e) => { if (!isFirebaseOfflineNoise(e.message)) errors.push(`pageerror: ${e.message}`); });
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/Failed to load resource/.test(t) || isFirebaseOfflineNoise(t)) return;
  errors.push(`console.error: ${t}`);
});

const text = () => page.$eval("body", (el) => el.innerText);
const click = async (re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(260);
  return true;
};
/**
 * Clear whatever the pad is asking for before it will take a delivery.
 *
 * A real fixture starts with nobody at the crease and nobody bowling, so the
 * scorer asks — which is correct, and which means this walk has to answer.
 * Openers come from the batting sheet (a list of names), then the bowler.
 */
const clearBlockers = async () => {
  for (let i = 0; i < 10; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const batters = page.locator("button:not([disabled])", { hasText: /\bNEXT\b/i });
    if (await batters.count()) { try { await batters.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const body = await text();
    // The opener / new-batter sheet: a numbered list of squad members.
    if (/Available to Bat|Batting Order/i.test(body)) {
      const pick = page.locator("button:not([disabled])", { hasText: /^\s*\d+\s*\n?\s*[A-Z]/ }).first();
      if (await pick.count()) { try { await pick.click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    }
    // The bowler sheet. SCRBRD holds no roster for a school that is not a
    // tenant, so against Michaelhouse there is nobody to pick and the scorer
    // types the name — which is the normal case, not an edge one.
    if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
      const field = page.locator("input[placeholder*='name' i], input[placeholder*='Search bowler' i]").last();
      if (await field.count()) {
        try {
          await field.fill("A Nel");
          await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 1500 });
        } catch { /* fall through to the next pass */ }
        await page.waitForTimeout(600);
        continue;
      }
    }
    return;
  }
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Point the built bundle at this run's API before any of its code runs.
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Signing in against the real server");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  const sawLive = /Pilot accounts|live API/i.test(await text());
  ok("the login page detects a live server and says so", sawLive);

  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  if (DEBUG) console.log("[debug] after sign-in:\n" + (await text()).slice(0, 600));
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));

  group("Opening a real fixture");
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);
  ok("the fixture list came from the server", !/Demonstration fixtures/i.test(await text()));

  const before = (await dbq(`select count(*)::int n from ball_event`))[0].n;
  // Deliberately the 1XI fixture rather than whichever card is first: it is
  // the one with a real squad in the seed, and naming it means the assertions
  // below are about a known match rather than whatever happened to be on top.
  const opened = await page.evaluate(() => {
    const isBtn = (b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "");
    const btns = [...document.querySelectorAll("button")].filter(isBtn);
    for (const b of btns) {
      // Walk up only as far as the CARD — the nearest ancestor that still
      // contains exactly this one scoring button. Going further reaches the
      // list container, whose text mentions every opponent on the page, and
      // the match picked is then whichever card happened to be first.
      let card = b;
      while (card.parentElement &&
             [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) {
        card = card.parentElement;
      }
      if (/Michaelhouse/i.test(card.textContent || "")) { b.click(); return true; }
    }
    return false;
  });
  ok("the 1XI fixture offers the scorer", opened);
  await page.waitForTimeout(2500);
  await clearBlockers();
  if (!/\bDOT\b/i.test(await text())) await click(/QUICK MODE/i, 2500);
  await page.waitForTimeout(400);
  ok("the scorer opens on the pad", /\bDOT\b/i.test(await text()));

  // The claim is the moment the database agrees this device is scoring.
  const session = await dbq(`select state, epoch, holder_device from scoring_session`);
  ok("the browser claimed the match", session.length === 1 && session[0].state === "active");
  ok("...and the lease is held by this device", !!session[0].holder_device);

  group("Tapping balls, and asking Postgres");
  const errsBefore = errors.length;
  let scored = 0;
  for (const face of ["1", "4", "2", "6"]) {
    await clearBlockers();
    if (await click(new RegExp(`^${face}$`), 2500)) scored++;
    await page.waitForTimeout(500);
  }
  await clearBlockers();
  if (DEBUG && scored < 3) console.log("[debug] pad shows:\n" + (await text()).slice(0, 700));
  ok(`tapped ${scored} deliveries`, scored >= 3);
  ok("no errors while scoring", errors.length === errsBefore);

  // Give the outbox a moment; it flushes on record and retries on a timer.
  await page.waitForTimeout(4000);
  const rows = await dbq(
    `select kind, ball_type, value, device_id, epoch, bowler_id, striker_id, payload
       from ball_event order by seq`);
  if (DEBUG) console.log("[debug] rows:", rows.length, JSON.stringify(rows.slice(-4)));
  ok("balls tapped in the browser are in Postgres", rows.length > before);
  ok("...as deliveries, with their runs", rows.filter((r) => r.kind === "ball").length >= 3);
  ok("...stamped with the browser's device", new Set(rows.map((r) => r.device_id)).size === 1);
  ok("...under the epoch it claimed", rows.every((r) => r.epoch === session[0].epoch));

  // The innings context has to be in the log too, or a second device cannot
  // rebuild the scorecard from it.
  ok("the log opens with the innings and its squad",
     rows.some((r) => r.kind === "innings_start"));
  ok("...and names the batters, so a second device could rebuild it",
     rows.some((r) => r.kind === "batters"));
  // The bowler was typed, because SCRBRD has no roster for the opposition.
  // The uuid column cannot hold that, so it rides in the payload — and if this
  // regresses, every ball of every over bowled by an away bowler is rejected.
  const bowlerRow = rows.find((r) => r.kind === "bowler");
  ok("a typed opposition bowler is recorded, not rejected", !!bowlerRow);
  ok("...with the name in the payload, not the uuid column",
     bowlerRow && bowlerRow.bowler_id === null && !!bowlerRow.payload?.bowler);

  group("What the scorer is told");
  const pill = await text();
  ok("the pad reports that the balls have been sent", /\bSent\b/i.test(pill));

  if (errors.length !== errsBefore && DEBUG) console.log(errors.slice(0, 5));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 110)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 5).join("\n"));
} finally {
  await browser.close();
  web.close();
  api.kill("SIGTERM");
  await pool.end();
}

if (errors.length) {
  console.log("\nApplication errors:");
  for (const e of [...new Set(errors)].slice(0, 6)) console.log("  " + e);
}
if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 10).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SYNC SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

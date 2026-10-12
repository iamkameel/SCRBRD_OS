#!/usr/bin/env node
/**
 * Signing out on a shared tablet, and a slow answer for the last session
 * (#133, views/family/useFold.js). In a browser, on one page that is never
 * reloaded, as a school's tablet is used:
 *
 *   1. A guardian's Home reads the last match: the card shows his child's line.
 *   2. SIGN-OUT ENDS THE CACHE. He signs out and signs in again on the same
 *      page: the card reads the match again (a new request), not from a cache
 *      the last session filled.
 *   3. A LATE ANSWER FOR THE LAST SESSION IS DROPPED. The pupil signs in on
 *      his own account and his read of the match is held on its way; he signs
 *      out and the parent signs in. The parent's read is answered, and only
 *      then is the pupil's, late, with a scorecard that has his child's runs on
 *      it. The parent's card is unchanged, and still is after he leaves Home
 *      and comes back (which reads the cache): the late answer was neither
 *      cached for his session nor set on his screen.
 *
 * D Pillay (parent@) and R Pillay (pillay@, the pupil) read the same last
 * match, which has no score recorded (db/98). The late answer is a scorecard
 * in which the pupil batted, so a line on the parent's card could only come
 * from it.
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { appUrl, port } from "./db-url.mjs";
import { deriveMatch, fromRow, inningsStart, inningsSummary, inningsEnd, toRow } from "@scrbrd/scoring";
import { bookCard } from "./book-innings.mjs";
import { lineFor } from "../apps/web/src/lib/family.js";

const WEB_PORT = port(4341);
const API_PORT = port(8811);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)?.slice(0, 400)}`); } };

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-signout-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
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
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ ...launchOptions() });
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
  return (await page.locator('[data-testid="persona-bar"]').count()) === 1;
}
async function signOut(page) {
  await page.locator('[data-testid="persona-signout"]').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return (await page.locator('[data-testid="os-main"]').count()) === 0;
}
/** Leave Home and come back, so the card mounts again and reads the cache. */
async function remount(page) {
  await page.locator('[data-testid="nav-fixtures"], [data-testid="mnav-fixtures"]').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.locator('[data-testid="nav-children"], [data-testid="mnav-children"]').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

const EVENTS = /\/api\/matches\/[^/]+\/events/;
const PUPIL = "aaaaaaaa-0000-0000-0000-000000000005"; // R Pillay, db/98
const NONE = /No score was recorded/;
const card = async (page) => {
  const c = page.locator('[data-testid="last-match"]').first();
  try { await c.waitFor({ timeout: 8000 }); } catch { return ""; }
  await page.waitForFunction(() => !/Reading the scorecard/.test(document.querySelector('[data-testid="last-match"]')?.innerText ?? ""), null, { timeout: 8000 }).catch(() => {});
  return (await c.innerText()).replace(/\s+/g, " ");
};

try {
  const ctx = await browser.newContext();
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);

  // The late answer: a scorecard in which the pupil batted (34 off 40,
  // caught), built in memory as tools/book-innings.mjs writes one. On his
  // screen, a line can only ever come from it.
  const src = { kind: "scorebook", import: "walk-signout", checkedBy: "walk", confirmedBy: "walk" };
  const book = bookCard([PUPIL, "p2", "p3", "p4", "p5", "p6"]);
  const lateEvents = [
    { ...inningsStart({ battingTeam: "Book side", bowlingTeam: "Book XI", overs: 20 }), innings: 0, id: "walk:0:start", source: src },
    { ...inningsSummary({ card: book, typed: {}, source: src }), innings: 0, id: "walk:0:summary" },
    { ...inningsEnd({ reason: "overs_complete", confirmed: { runs: book.total, wickets: book.wickets, balls: 120 } }), innings: 0, id: "walk:0:end", source: src },
  ].map((e, i) => ({ seq: i + 1, epoch: 1, ...toRow(e) }));
  const lateBody = JSON.stringify({ events: lateEvents, fold: {} });
  const lateLine = lineFor(deriveMatch(lateEvents.map(fromRow), {}).innings.filter(Boolean), PUPIL);

  // Every read of a match's events is counted, and can be held.
  // A read held for the last session is answered, late, just after the next
  // session's own read has gone through: inside the client's 10 s timeout
  // (lib/api.js), which would otherwise end it unanswered.
  let reads = 0, hold = false, late = null;
  /** @type {import("playwright-core").Route[]} */
  const held = [];
  await page.route(EVENTS, async (route) => {
    reads++;
    if (hold) { held.push(route); return; }
    if (!late) { await route.continue(); return; }
    const go = late; late = null;
    await route.fulfill({ response: await route.fetch() });
    setTimeout(go, 1500);
  });

  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  console.log("\n1. A guardian's Home reads the last match");
  ok("D Pillay (parent) signs in", await signIn(page, /parent@example\.invalid/));
  const his = await card(page);
  ok("...his Home shows the last match, read from its events", /LAST MATCH/i.test(his) && reads > 0, his);
  ok("...a match with no score recorded", NONE.test(his), his);
  ok("...and the walk's late answer has a line for the pupil", !!lateLine, lateLine);

  console.log("\n2. Sign-out ends the cache");
  const first = reads;
  ok("he signs out (no reload)", await signOut(page));
  ok("he signs in again on the same page", await signIn(page, /parent@example\.invalid/));
  ok("...the card is the same", (await card(page)) === his);
  ok("...read again from the server, not from the last session's cache", reads > first, { before: first, after: reads });

  console.log("\n3. A late answer for the last session is dropped");
  ok("he signs out", await signOut(page));
  hold = true;
  ok("R Pillay (the pupil, his own account) signs in, and his read of the match is held on its way", await signIn(page, /pillay@example\.invalid/));
  ok("...a read is waiting", held.length > 0, held.length);
  const stale = held.splice(0);
  let answered = 0;
  late = async () => {
    for (const r of stale) if (await r.fulfill({ status: 200, contentType: "application/json", body: lateBody,
      headers: { "access-control-allow-origin": `http://localhost:${WEB_PORT}` } }).then(() => true, () => false)) answered++;
  };
  hold = false;
  ok("the pupil signs out with it still waiting", await signOut(page));
  ok("D Pillay (parent) signs in on the same page", await signIn(page, /parent@example\.invalid/));
  const mine = await card(page);
  ok("...his card reads the same match: no score recorded", NONE.test(mine), mine);
  await page.waitForTimeout(2500);
  ok("the pupil's read was answered late, after the parent's own", answered > 0, answered);
  ok("when the late answer lands, the parent's card is unchanged", (await card(page)) === mine, await card(page));
  await remount(page);
  const again = await card(page);
  ok("...and after he leaves Home and comes back (read from the cache), still unchanged", again === mine, again);
  ok("...no line from the late answer on his screen", (await page.locator('[data-testid="last-match-line"]').count()) === 0
     && !(await text(page)).includes(lateLine));
  ok("no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
} catch (e) {
  ok(`the sign-out walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  await browser.close().catch(() => {});
  api.kill("SIGTERM");
  web.close();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SIGN-OUT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

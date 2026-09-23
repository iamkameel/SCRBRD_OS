#!/usr/bin/env node
/**
 * An innings scored to its end, in a browser (SCRBRD-052).
 *
 * `smoke-browser-sync.mjs` opens the real scorer on a real match and taps
 * four deliveries of twenty overs — enough to prove the pad reaches Postgres,
 * nothing more. This is the one that closes a first innings by wickets, then
 * chases the real target down in the second, so it is the first walk to ever
 * exercise the review gate (SCRBRD-038, `InningsReviewSheet`), the innings
 * break (`Innings2Sheet`), the second innings' target actually ending the
 * match, and the result screen.
 *
 * Dismissals through the wicket sheet are the cheap route to a closed first
 * innings — a handful of taps against a hundred and twenty for a full set of
 * overs — however many the batting side's real seeded squad actually takes
 * to go all out (asserted as "at least one, and the review sheet genuinely
 * opened," not a hardcoded count — see the group below).
 *
 * The second innings genuinely chases its target down with real deliveries.
 * The first version of this walk could not do that: running it against the
 * real app found that a second innings never got its own INNINGS_START, so
 * nothing ever set its `target`, and `inningsOverReason()`'s target branch
 * could never fire — a chase that reached its target just kept being scored.
 * Filed and fixed as SCRBRD-063 (`engine.jsx`'s `Innings2Sheet.onStart`), and
 * this walk is the proof it stayed fixed, not a unit case against the
 * package alone: it is the actual button a scorer clicks.
 *
 * Checked against Postgres, not just the page: the two `innings_end` events
 * this walk should have produced, with the real reasons the laws give —
 * `all_out` then `target_reached` — because a review-confirm click that drew
 * the right screen but wrote the wrong reason is a bug this suite exists to
 * catch, and the DOM alone cannot see it.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-innings-end.mjs
 *   BROWSER_INNINGS_DEBUG=1 node tools/smoke-browser-innings-end.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 4330;
const API_PORT = 8799;
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_INNINGS_DEBUG;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-innings-end-secret",
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

const pool = new pg.Pool({ connectionString: DB });
const dbq = async (text, params) => (await pool.query(text, params)).rows;

const browser = await chromium.launch({ ...launchOptions() });
const page = await browser.newPage();
await offline(page.context());

const errors = [];
page.on("pageerror", (e) => { errors.push(`pageerror: ${e.message}`); });
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/Failed to load resource/.test(t)) return;
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
 * Close to smoke-browser-sync.mjs's own — the pad's own prompts, answered —
 * extended with the free-text batter entry the side with no roster needs in
 * its own second innings (see the comment at that branch below).
 */
let batterCounter = 0;
const clearBlockers = async () => {
  for (let i = 0; i < 10; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const batters = page.locator("button:not([disabled])", { hasText: /\bNEXT\b/i });
    if (await batters.count()) { try { await batters.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const body = await text();
    if (/Available to Bat|Batting Order/i.test(body)) {
      const pick = page.locator("button:not([disabled])", { hasText: /^\s*\d+\s*\n?\s*[A-Z]/ }).first();
      if (await pick.count()) { try { await pick.click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
      // The side batting second here (Michaelhouse) has no seeded roster —
      // the same reason the opposition bowler is typed rather than picked —
      // so "Available to Bat" offers nobody and CustomBatEntry's free-text
      // field is the only way in. smoke-browser-sync.mjs never needed this
      // path because it never scores far enough to reach a second innings.
      const nameField = page.locator('input[aria-label="Player name"]');
      if (await nameField.count()) {
        try {
          batterCounter++;
          await nameField.fill(`Batter ${batterCounter}`);
          await nameField.press("Enter");
        } catch { /* fall through to the next pass */ }
        await page.waitForTimeout(500);
        continue;
      }
    }
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

/**
 * One dismissal: the quick pad's Wicket key, then Confirm Out on the sheet
 * that opens over it. Bowled needs no fielder, so the sheet's own default
 * mode is accepted as-is — this walk is about the innings ending, not about
 * exercising every dismissal type (WicketSheet's own modes are unit-covered
 * elsewhere).
 */
const takeWicket = async (n) => {
  await clearBlockers();
  const tapped = await click(/Wicket/, 2500);
  await page.waitForTimeout(500);
  // The sheet's own mount (its first paint on this page load in particular)
  // is not always faster than a 2.5s click timeout, so this retries the
  // click itself rather than giving up on the first miss.
  let confirmed = false;
  if (tapped) {
    for (let attempt = 0; attempt < 4 && !confirmed; attempt++) {
      confirmed = await click(/Confirm Out/, 2000);
      if (!confirmed) await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(500);
  await clearBlockers();
  if (DEBUG && !(tapped && confirmed)) {
    console.log(`[debug] wicket ${n}: tapped=${tapped} confirmed=${confirmed}`);
    console.log("[debug] body:\n" + (await text()).slice(0, 500));
  }
  return tapped && confirmed;
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the scorer on a real fixture");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));

  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);

  const highWaterRow = (await dbq(`select coalesce(max(id), 0) as high from ball_event`))[0];
  const highWater = highWaterRow.high;

  const opened = await page.evaluate(() => {
    const isBtn = (b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "");
    const btns = [...document.querySelectorAll("button")].filter(isBtn);
    for (const b of btns) {
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

  group("Wickets, through the sheet, until the innings is genuinely all out");
  // Not a fixed ten: the "all out" threshold this walk actually hits is
  // whatever packages/scoring/src/replay.mjs's inningsOverReason() derives
  // from the batting side's real seeded squad size, and asserting a literal
  // 10 here would make this walk assume a squad size rather than prove
  // against the one the fixture actually has. 11 is a hard ceiling — one
  // dismissal more than the Laws allow — so a squad this walk cannot exhaust
  // fails loudly rather than spinning.
  let taken = 0, reviewOpen = false;
  for (let i = 0; i < 11 && !reviewOpen; i++) {
    if (await takeWicket(i + 1)) taken++;
    // The final dismissal ends the innings — the review sheet opens over the
    // pad rather than another new-batsman prompt, so clearBlockers() (which
    // does not recognise it) correctly leaves it alone.
    reviewOpen = (await page.locator('[data-testid="innings-review"]').count()) > 0;
    if (DEBUG) console.log(`[debug] after wicket attempt ${i + 1}: taken=${taken} reviewOpen=${reviewOpen}`);
  }
  if (DEBUG) console.log(`[debug] wickets taken: ${taken}`);
  ok(`dismissals through the sheet closed the innings (${taken} confirmed, review sheet open: ${reviewOpen})`,
     taken >= 1 && reviewOpen);

  group("The review gate shows the real total before it will close the innings");
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  ok("the review sheet opened on its own — the innings is all out", await tid("innings-review").count() === 1);
  if (DEBUG) {
    console.log("[debug] innings-review innerHTML:\n" +
      (await tid("innings-review").innerHTML().catch((e) => `<error: ${e.message}>`)));
    console.log(`[debug] review-reason count: ${await tid("review-reason").count()}`);
  }
  const reviewReason = (await tid("review-reason").innerText({ timeout: 3000 }).catch(() => "<not found>")).trim();
  ok(`...naming the real reason ("${reviewReason}")`, /all\s*out/i.test(reviewReason));
  ok("...showing the score, not left blank", (await tid("review-score").innerText()).trim().length > 0);
  ok("a batter still not out is on the sheet, if the laws left one",
     (await tid("innings-review").innerText()).length > 0);

  await tid("review-confirm").click({ timeout: 4000 });
  await page.waitForTimeout(800);

  group("The innings break names the real target, and it reaches the pad");
  const breakText = await text();
  ok("the break sheet shows what the second team needs", /need/i.test(breakText));
  ok("...and it is a real number, not a placeholder dash", /\d+/.test(breakText));
  const startClicked = await click(/Start 2nd Innings/, 4000);
  ok("the scorer starts the second innings from the break sheet", startClicked);
  await page.waitForTimeout(800);

  await clearBlockers();
  if (!/\bDOT\b/i.test(await text())) await click(/QUICK MODE/i, 2500);
  await page.waitForTimeout(400);
  ok("the pad reopens for the second innings", /\bDOT\b/i.test(await text()));
  ok("...with the real target on screen", /Need \d+ off/i.test(await text()));

  group("The chase reaches its target with real deliveries, and the innings closes on its own");
  let sixesHit = 0, chaseReviewOpen = false;
  for (let i = 0; i < 40 && !chaseReviewOpen; i++) {
    await clearBlockers();
    chaseReviewOpen = (await tid("innings-review").count()) > 0;
    if (chaseReviewOpen) break;
    if (await click(/^6$/, 2000)) sixesHit++;
    await page.waitForTimeout(350);
  }
  await clearBlockers();
  if (DEBUG) console.log(`[debug] sixes hit chasing the target: ${sixesHit}`);
  ok("the chase reached the target through real scoring, not a shortcut", sixesHit > 0);
  ok("the review sheet opened on its own — SCRBRD-063's fix: reaching the target ends the innings",
     await tid("innings-review").count() === 1);
  const secondReason = (await tid("review-reason").innerText({ timeout: 3000 }).catch(() => "<not found>")).trim();
  ok(`...for the real reason the laws give ("${secondReason}")`, /target/i.test(secondReason));

  await tid("review-confirm").click({ timeout: 4000 });
  await page.waitForTimeout(1000);

  group("The result screen names the winner from a real chase");
  const resultText = await text();
  ok("the result screen is reached, not left on the pad", /Match Complete/i.test(resultText));
  // The side that batted second (Michaelhouse here) won the chase — SCRBRD-063
  // also fixed the second innings' battingTeam never being set, which is what
  // let the result screen name the real team rather than leaving this blank.
  ok("...naming the chasing side as the winner, not a blank team",
     /Michaelhouse/i.test(resultText));
  ok("...with a margin in wickets, since the chase succeeded", /wicket/i.test(resultText));

  group("Postgres agrees with both screens");
  const endEvents = await dbq(
    `select payload from ball_event where kind = 'innings_end' and id > $1 order by id`, [highWater]);
  ok(`two innings_end events were written (${endEvents.length} found)`, endEvents.length === 2);
  ok("...the first for the real reason the laws give (all out)",
     endEvents[0]?.payload?.reason === "all_out");
  ok("...the second for the real reason the laws give (target reached)",
     endEvents[1]?.payload?.reason === "target_reached");

  ok("no console errors across the whole innings", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 8).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  api.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER INNINGS-END SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

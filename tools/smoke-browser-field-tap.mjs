#!/usr/bin/env node
/**
 * One tap on the field places the ball, and records nothing (11 Nov 2026).
 *
 * Kameel, on the live app on his phone: "when I click on the field it
 * automatically selects wicket and dismisses the batsman." The field places
 * the ball on `pointerup` (scorer/panels.jsx, the capture circle) and the pad
 * at once draws the Outcome step where the field was (scorer/pad.jsx): the
 * Wicket key at its head, 2 3 4 6, then the big 0 and 1. The browser then
 * sends the same tap's emulated mousedown, mouseup and click, hit-tested at
 * the same point after the re-render — onto the key now under the finger. A
 * tap meant to place the ball opened the wicket sheet, or recorded runs, with
 * no Outcome chosen. scorer/followThrough.js now swallows the rest of that tap.
 *
 * In a real browser against a real API and Postgres, with touch emulation
 * (isMobile, hasTouch, real touch taps — not mouse clicks), on these phones:
 * a Galaxy S25 Ultra (Chrome on Android, 3.5×: 412×915, its compact 384×832,
 * and 412×780 with the browser's bars shown), iPhone 13, iPhone SE, Pixel 7,
 * Galaxy S9+, 360×740 and 412×915 —
 *
 *   A  at every point of the field (its middle, and four rings of twelve),
 *      the point is the field's (nothing over it), and one tap there — and a
 *      tap with a finger's slight drag, at a third of them — goes to the
 *      Outcome step and records NOTHING: no new row in the server's ball
 *      log, no dialog (no wicket sheet), the board unchanged;
 *   B  "start this ball again" then records nothing either;
 *   C  a correct ball is unchanged: the field, then 4, records one ball of 4
 *      runs off the drive with the point placed; the field, then Wicket,
 *      opens the wicket sheet and records nothing until it is confirmed;
 *      Undo takes the four back.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-field-tap.mjs
 *   FIELD_TAP_ONLY='S25' FIELD_TAP_DEBUG=1 node tools/smoke-browser-field-tap.mjs
 */
import { chromium, devices } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(5371);
const API_PORT = port(8871);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.FIELD_TAP_DEBUG;
const ONLY = process.env.FIELD_TAP_ONLY ? new RegExp(process.env.FIELD_TAP_ONLY) : null;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

// Chrome on a Galaxy S25 Ultra (SM-S938B), the phone the report came from.
const UA_S25 = "Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const android = (width, height, deviceScaleFactor) => ({ viewport: { width, height }, deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: UA_S25 });
const PHONES = [
  ["Galaxy S25 Ultra 412×915", android(412, 915, 3.5)],
  ["Galaxy S25 Ultra compact 384×832", android(384, 832, 3.5)],
  ["Galaxy S25 Ultra, bars shown 412×780", android(412, 780, 3.5)],
  ["iPhone 13", devices["iPhone 13"]],
  ["iPhone SE", devices["iPhone SE"]],
  ["Pixel 7", devices["Pixel 7"]],
  ["Galaxy S9+", devices["Galaxy S9+"]],
  ["360×740", android(360, 740, 3)],
  ["412×915", android(412, 915, 2.625)],
].filter(([n]) => !ONLY || ONLY.test(n));

// The field's points: its middle, then four rings of twelve, as fractions of
// its radius and degrees clockwise from the top of the screen.
const POINTS = [[0, 0]];
for (const r of [0.25, 0.5, 0.75, 0.93]) for (let a = 0; a < 12; a++) POINTS.push([r, a * 30]);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-field-tap-secret",
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

const pool = new pg.Pool({ connectionString: ownerUrl() });
const dbq = async (text, params) => (await pool.query(text, params)).rows;
const rowCount = async () => Number((await dbq(`select count(*)::int n from ball_event where match_id = $1`, [MATCH]))[0].n);
const lastRow = async () => (await dbq(`select kind, ball_type, value, shot, dismissal, theta, radius from ball_event where match_id = $1 order by seq desc limit 1`, [MATCH]))[0];

const browser = await chromium.launch({ ...launchOptions() });
const errors = [];

/** Sign in as the scorer on this phone, and open the pad on the 1XI fixture, ready to score. */
async function openPad(name, dev) {
  // Each phone is a new device: the last one's hold on the match is let go.
  await dbq(`delete from scoring_session where match_id = $1`, [MATCH]);
  const ctx = await browser.newContext({ ...dev, locale: "en-ZA", timezoneId: "Africa/Johannesburg" });
  await offline(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  watchReads(page);
  page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${name} console.error: ${m.text()}`); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const has = async (id) => (await tid(id).count()) > 0;
  const btn = (re) => page.locator("button:not([disabled])", { hasText: re }).first();
  const tapBtn = async (re) => { const b = btn(re); if (!(await b.count())) return false; await b.tap({ timeout: 4000 }).catch(() => b.click({ timeout: 2000 })); await page.waitForTimeout(400); return true; };

  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  await tapBtn(/Get Started|Log In/);
  await page.waitForTimeout(400);
  await tapBtn(/Scorer/);
  await tapBtn(/^Sign In$/);
  await page.waitForTimeout(2200);
  const mc = page.locator("button, a", { hasText: /^Match Centre$/ }).first();
  await mc.tap({ timeout: 6000 }).catch(() => mc.click({ timeout: 4000 }));
  await afterReads(page, 1200);
  const opened = await page.evaluate(() => {
    const isBtn = (b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "");
    for (const b of [...document.querySelectorAll("button")].filter(isBtn)) {
      let card = b;
      while (card.parentElement && [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) card = card.parentElement;
      if (/Michaelhouse/i.test(card.textContent || "")) { b.click(); return true; }
    }
    return false;
  });
  await page.waitForTimeout(2500);
  // Until the pad says nothing is missing: its fix, the openers, A Nel to bowl.
  for (let i = 0; i < 12; i++) {
    const sheet = (await page.locator('[role="dialog"]').count()) > 0;
    const next = page.locator("button:not([disabled])", { hasText: /Next\s*$/i });
    if (sheet && await next.count()) { await next.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500); continue; }
    if (sheet && /Opening bowler/i.test(await page.innerText("body"))) {
      await page.locator("input[aria-label='Bowler name']").first().fill("A Nel");
      await btn(/^Go$/).click({ timeout: 3000 });
      await page.waitForTimeout(500);
      continue;
    }
    if (sheet) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); continue; }
    if (await has("scoring-blocked-fix")) { await tid("scoring-blocked-fix").click({ timeout: 2000 }); await page.waitForTimeout(400); continue; }
    if (!(await has("scoring-blocked"))) break;
    await page.waitForTimeout(500);
  }
  // The three phases, not Basic Scoring.
  if (await has("basic-pad")) {
    await tid("pad-menu").click(); await tid("pad-basic-scoring").click();
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  }
  const ready = opened && (await has("three-phase-pad")) && !(await has("scoring-blocked"));
  return { ctx, page, tid, has, ready };
}

/** A touch at (x, y): a tap, or a finger's slight drag (down, a few pixels' move, up). */
async function touch(page, x, y, drag) {
  if (!drag) return page.touchscreen.tap(x, y);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await page.waitForTimeout(40);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 3, y: y + 4 }] });
    await page.waitForTimeout(40);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await cdp.detach().catch(() => {}); }
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1 on conflict (match_id) do nothing`, [MATCH]);

  for (const [name, dev] of PHONES) {
    group(`${name} (${dev.viewport.width}×${dev.viewport.height}, ${dev.deviceScaleFactor}×, touch)`);
    const { ctx, page, tid, ready } = await openPad(name, dev);
    ok(`${name}: the pad is open and ready, three phases`, ready, (await page.innerText("body").catch(() => "")).slice(0, 300));
    if (!ready) { await ctx.close(); continue; }
    const board = () => page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / }).first().textContent().catch(() => "");

    // ── A, B ──
    const bad = [], covered = [], undoBad = [];
    let n = 0;
    for (const [i, [r, deg]] of POINTS.entries()) {
      const drag = i % 3 === 2;
      await page.evaluate(() => document.querySelector('[data-testid="shot-drive"]')?.scrollIntoView({ block: "center" }));
      await tid("shot-drive").tap({ timeout: 4000 });
      await page.waitForTimeout(350);
      const box = await tid("wagon-capture").boundingBox();
      if (!box) { bad.push(`r${r} ${deg}°: no field after Drive`); continue; }
      const R = box.width / 2, cx = box.x + R, cy = box.y + box.height / 2;
      const x = cx + r * R * Math.sin((deg * Math.PI) / 180), y = cy - r * R * Math.cos((deg * Math.PI) / 180);
      const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.dataset?.testid ?? null, [x, y]);
      if (under !== "wagon-capture") covered.push(`r${r} ${deg}° (${Math.round(x)},${Math.round(y)}) is ${under}`);
      const rows0 = await rowCount(), b0 = await board();
      await touch(page, x, y, drag);
      await page.waitForTimeout(500);
      const rows1 = await rowCount();
      const dialog = await page.locator('[role="dialog"]').count();
      const phase = await tid("three-phase-pad").getAttribute("data-phase").catch(() => null);
      const b1 = await board();
      n++;
      if (rows1 !== rows0 || dialog || phase !== "3" || b1 !== b0) {
        bad.push(`r${r} ${deg}°${drag ? " (drag)" : ""} at (${Math.round(x)},${Math.round(y)}): ${rows1 - rows0} row(s)${rows1 > rows0 ? " " + JSON.stringify(await lastRow()) : ""}, dialog ${dialog}, phase ${phase}, board "${b0}" → "${b1}"`);
      }
      if (DEBUG) console.log(`    r${r} ${deg}°${drag ? " drag" : ""}: phase ${phase}, rows +${rows1 - rows0}, dialog ${dialog}`);
      // Put the pad back: close any sheet, take back any ball, and start this ball again.
      if (dialog) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
      if (rows1 > rows0) { await tid("key-undo").click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); }
      if ((await tid("three-phase-pad").getAttribute("data-phase").catch(() => "1")) !== "1") {
        const before = await rowCount();
        await tid("key-undo").click({ timeout: 3000 });
        await page.waitForTimeout(350);
        if ((await rowCount()) !== before) undoBad.push(`r${r} ${deg}°`);
      }
    }
    ok(`${name}: A. every point of the field is the field's, nothing over it (${POINTS.length} points)`, covered.length === 0, covered.join("; "));
    ok(`${name}: A. a tap at each of ${n} points (a third with a slight drag) goes to Outcome and records nothing: no row, no wicket sheet, the board unchanged`,
       n === POINTS.length && bad.length === 0, `${bad.length} wrong: ${bad.slice(0, 6).join(" | ")}`);
    ok(`${name}: B. "start this ball again" records nothing`, undoBad.length === 0, undoBad.join(", "));

    // ── C ──
    const tapField = async (fr, deg) => {
      await page.evaluate(() => document.querySelector('[data-testid="shot-drive"]')?.scrollIntoView({ block: "center" }));
      await tid("shot-drive").tap({ timeout: 4000 });
      await page.waitForTimeout(350);
      const box = await tid("wagon-capture").boundingBox();
      const R = box.width / 2;
      await page.touchscreen.tap(box.x + R + fr * R * Math.sin((deg * Math.PI) / 180), box.y + R - fr * R * Math.cos((deg * Math.PI) / 180));
      await page.waitForTimeout(500);
    };
    const r0 = await rowCount();
    await tapField(0.75, 60);
    ok(`${name}: C. the field, then the Outcome step, nothing yet`, (await tid("three-phase-pad").getAttribute("data-phase")) === "3" && (await rowCount()) === r0);
    await page.waitForTimeout(300);
    await tid("run-4").tap({ timeout: 3000 });
    await page.waitForTimeout(1500);
    const four = await lastRow();
    ok(`${name}: C. ...then 4: one ball, 4 runs off the drive, the point placed`,
       (await rowCount()) === r0 + 1 && four?.kind === "ball" && four?.ball_type === "run" && Number(four?.value) === 4 && four?.shot === "drive" && four?.theta != null,
       JSON.stringify(four));
    await tid("key-undo").tap({ timeout: 3000 });
    await page.waitForTimeout(1500);
    const afterUndo = await rowCount();
    await tapField(0.5, 300);
    await page.waitForTimeout(300);
    await tid("key-wicket").tap({ timeout: 3000 });
    await page.waitForTimeout(700);
    const sheet = await page.locator('[role="dialog"]').first().innerText({ timeout: 1500 }).catch(() => "");
    ok(`${name}: C. the field, then Wicket, opens the wicket sheet and records nothing`, /wicket/i.test(sheet) && (await rowCount()) === afterUndo, sheet.slice(0, 120));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    if ((await tid("three-phase-pad").getAttribute("data-phase").catch(() => "1")) !== "1") await tid("key-undo").click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    ok(`${name}: C. ...and closing it records nothing`, (await rowCount()) === afterUndo);
    await ctx.close();
  }

  group("No errors");
  ok("no page or console errors", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) {
  fail++;
  console.log("  ✗ the walk stopped:", e?.message ?? e);
  if (DEBUG) console.log(apiErr.join("").slice(-2000));
} finally {
  await browser.close().catch(() => {});
  api.kill();
  web.close();
  await pool.end();
}

console.log(`\n${"─".repeat(52)}\nFIELD TAP WALK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

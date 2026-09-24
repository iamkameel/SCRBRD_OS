#!/usr/bin/env node
/**
 * Undo with no signal, from a phone (SCRBRD-074, SCRBRD-075).
 *
 * A ball the scorer undoes before it has been sent must never reach the
 * server. It used to: undo cut it from the pad's log, but the outbox still
 * held it — in memory and on disk — and when signal returned it was sent. The
 * server then held a delivery the scorer had taken back, and the pad showed
 * nothing to say so.
 *
 * And a ball the server already has must never be cut from the pad's log. It
 * used to be, after a reload: the pad's idea of what the server had lived in
 * memory, so a reload forgot it, and an offline undo treated a ball the
 * server held as one that had never left the phone.
 *
 * The walk, in a real browser against the real server:
 *   A. Online: a ball goes out and the server takes it.
 *   B. Offline: three balls, then undo. The undone ball leaves the pad's log
 *      AND the outbox — the count on the pill and the queue on disk.
 *   C. Reload, still offline: the saved log comes back without it, and so
 *      does the outbox (the withdrawal was written to disk, not only memory).
 *   D. Online again: the pad and the server's log agree id for id, and the
 *      undone ball is nowhere on the server — not in the log, not in
 *      quarantine (the two balls queued offline go out under the reclaimed
 *      token, not to quarantine).
 *   E. Reload, and with the ball log unreachable undo a ball the server
 *      already has: it is undone with a void, not cut, so once the route is
 *      back the two still agree.
 * Checked against Postgres and IndexedDB, not the page.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-offline-undo.mjs
 *   BROWSER_OFFLINE_UNDO_DEBUG=1 node tools/smoke-browser-offline-undo.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 5299;
const API_PORT = 8799;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_OFFLINE_UNDO_DEBUG;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-offline-undo-secret",
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
const ctx = await browser.newContext();
await offline(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(t)) errors.push(`console.error: ${t}`);
});

const text = () => page.$eval("body", (el) => el.innerText);
const click = async (re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
/** The sync pill's word, from its accessible name: "Sent", "Held 2", "On device"… */
const pill = async () => {
  const l = page.locator('[aria-label^="Sync status:"]').first();
  if (!(await l.count())) return "";
  const label = (await l.getAttribute("aria-label", { timeout: 1000 }).catch(() => "")) || "";
  return (label.match(/^Sync status: ([^.]*)\./)?.[1] ?? "").trim();
};
const board = async () => {
  const l = page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / }).first();
  if (!(await l.count())) return "";
  return ((await l.textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
};
const undo = async () => {
  await page.getByRole("button", { name: "Undo the last ball" }).first().click({ timeout: 4000 });
  await page.waitForTimeout(900);
};

/** The pad's log as persist.js saved it (`scrbrd` → `kv` → match:<id>), every innings, in order. */
const padIds = () => page.evaluate((key) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    const db = req.result;
    const g = db.transaction("kv", "readonly").objectStore("kv").get(key);
    g.onsuccess = () => { db.close(); resolve((g.result?.events ?? []).flat().map((e) => e?.id)); };
    g.onerror = () => { db.close(); resolve(null); };
  };
}), `match:${MATCH}`);
/** The outbox's queue on disk (packages/sync indexeddb-storage): the keys it would send. */
const queuedOnDisk = () => page.evaluate((ns) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd-outbox", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("queue")) req.result.createObjectStore("queue"); };
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    const db = req.result;
    const os = db.transaction("queue", "readonly").objectStore("queue");
    const k = os.getAllKeys();
    const v = os.getAll();
    v.onsuccess = () => {
      const out = [];
      k.result.forEach((key, i) => {
        if (!String(key).startsWith(ns) || !String(key).includes(":evt:")) return;
        const ev = typeof v.result[i] === "string" ? JSON.parse(v.result[i]) : v.result[i];
        out.push(ev.idempotencyKey);
      });
      db.close();
      resolve(out);
    };
    v.onerror = () => { db.close(); resolve(null); };
  };
}), `${MATCH}:`);
/** The server's log for the match, by key, in seq order; and anything it quarantined. */
const serverIds = async () => (await dbq(`select idempotency_key from ball_event where match_id = $1 order by seq`, [MATCH]))
  .map((r) => r.idempotency_key);
const quarantinedIds = async () => (await dbq(`select idempotency_key from ball_event_quarantine where match_id = $1`, [MATCH]))
  .map((r) => r.idempotency_key);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Answer the pad's openers and bowler sheets (as smoke-browser-sync does). */
const clearBlockers = async () => {
  for (let i = 0; i < 12; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const next = page.locator("button:not([disabled])", { hasText: /\bNEXT\b/i });
    if (await next.count()) { try { await next.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const body = await text();
    if (/Available to Bat|Batting Order/i.test(body)) {
      const pick = page.locator("button:not([disabled])", { hasText: /^\s*\d+\s*\n?\s*[A-Z]/ }).first();
      if (await pick.count()) { try { await pick.click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    }
    if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
      const field = page.locator("input[placeholder*='name' i], input[placeholder*='Search bowler' i]").last();
      if (await field.count()) {
        try {
          await field.fill("A Nel");
          await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 1500 });
        } catch { /* next pass */ }
        await page.waitForTimeout(600);
        continue;
      }
    }
    return;
  }
};
const onPad = async () => {
  // A fixture nobody has scored says why it cannot score yet; its fix opens
  // the batting sheet that clearBlockers answers (smoke-browser-sync).
  const fix = page.locator('[data-testid="scoring-blocked-fix"]');
  if (await fix.count()) { await fix.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); }
  await clearBlockers();
  if (!/\bDOT\b/i.test(await text())) await click(/QUICK MODE/i, 2500);
  await page.waitForTimeout(300);
  return /\bDOT\b/i.test(await text());
};
/** Match Centre → the 1XI v Michaelhouse card → its scorer. */
const openFixture = async () => {
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);
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
  return opened;
};
/** Sign in as the seeded scorer, from the landing page. */
const signIn = async () => {
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  return /Match Centre|Dashboard/i.test(await text());
};
/**
 * After a reload: back on the pad. The API token lives in memory only and is
 * lost on every reload by design (lib/api.js), so the scorer signs out of the
 * stale shell, signs in again and reopens the fixture — which is what a
 * scorer does. The ball log and the outbox are on disk and are not touched.
 */
const backOnPad = async () => {
  await click(/Sign out/, 4000);
  await page.waitForTimeout(600);
  const inAgain = await signIn();
  if (DEBUG && !inAgain) console.log("[debug] sign-in again failed:", (await text()).replace(/\s+/g, " ").slice(0, 300));
  await openFixture();
  return onPad();
};
/** Tap one run value on the one-tap pad; true when the board moved. */
const score = async (face) => {
  const before = await board();
  if (!(await click(new RegExp(`^${face}$`), 2500))) return false;
  await page.waitForTimeout(600);
  return (await board()) !== before;
};
/** Wait for the pill to say something, up to `ms`. */
const pillSays = async (re, ms = 12000) => {
  for (let t = 0; t < ms; t += 400) {
    if (re.test(await pill())) return true;
    await page.waitForTimeout(400);
  }
  return false;
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // SCRBRD-067: the first innings follows the recorded toss.
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1
             on conflict (match_id) do nothing`, [MATCH]);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  // The service worker only serves what it fetched while in control, so let
  // it take over and load once more with signal — a scorer opens the app at
  // the ground while there is still a connection (smoke-persist does this too).
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 }).catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  group("A. Online: the scorer's first ball reaches the server");
  ok("a seeded scorer gets in", await signIn());
  const opened = await openFixture();
  ok("the 1XI fixture opens", opened);
  ok("the scorer is on the pad", await onPad());
  ok("the first ball is tapped", await score("1"));
  ok("...and sent", await pillSays(/^Sent$/), await pill());
  const s0 = await serverIds();
  const p0 = await padIds();
  ok("the server's log is the pad's log", s0.length > 0 && same(s0, p0), `${s0.length} v ${p0?.length}`);

  group("B. Offline: three balls, then undo the last");
  await ctx.setOffline(true);
  await page.waitForTimeout(300);
  let tapped = 0;
  for (const face of ["2", "4", "6"]) if (await score(face)) tapped++;
  ok("three balls with no signal", tapped === 3, tapped);
  await page.waitForTimeout(900);
  const withSix = await padIds();
  const SIX = withSix.at(-1);
  ok("all three are waiting in the outbox", same((await queuedOnDisk())?.slice(-3), withSix.slice(-3)), JSON.stringify(await queuedOnDisk()));
  ok("the pill counts three waiting", /\b3\b/.test(await pill()), await pill());
  const boardWithSix = await board();
  await undo();
  ok("undo takes the six off the board", (await board()) !== boardWithSix, await board());
  const afterUndo = await padIds();
  ok("...and out of the pad's saved log, with no void", !afterUndo.includes(SIX) && afterUndo.length === withSix.length - 1,
     `${afterUndo.length} v ${withSix.length}`);
  ok("...and out of the outbox on disk (SCRBRD-074)", !(await queuedOnDisk())?.includes(SIX), JSON.stringify(await queuedOnDisk()));
  ok("...and off the pill's count: two waiting, not three", /\b2\b/.test(await pill()), await pill());

  group("C. Reload with no signal: neither the pad nor the outbox brings it back");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  // The app shell comes back from the service worker. A LIVE fixture's pad
  // does not reopen with no signal (the session restore looks the fixture up
  // on the server), so what persisted is read from disk, where the next load
  // with signal will read it.
  ok("the app comes back with no signal", (await page.$eval("#root", (el) => el.innerHTML.length)) > 500);
  ok("the saved log is the one before the reload", same(await padIds(), afterUndo));
  ok("the outbox on disk still does not have the undone ball", !(await queuedOnDisk())?.includes(SIX), JSON.stringify(await queuedOnDisk()));
  ok("...and still has the two it should send", (await queuedOnDisk())?.length === 2, JSON.stringify(await queuedOnDisk()));

  group("D. Signal returns: the server's log and the pad's agree, id for id");
  await ctx.setOffline(false);
  // A pad that loaded with no signal could not claim the match; it claims on
  // the next load. (Reclaiming bumps the epoch; the two balls queued under
  // the last one are this device's own and go live — not to quarantine.)
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  ok("the pad comes back online", await backOnPad());
  ok("...and sends what it held", await pillSays(/^Sent$/), await pill());
  const s1 = await serverIds();
  const p1 = await padIds();
  if (DEBUG) console.log("[debug] server", s1, "\n[debug] pad", p1);
  ok("the server's ball_event log is the pad's saved log, id for id", same(s1, p1), `${s1.length} v ${p1?.length}`);
  ok("the undone ball never reached the server's log", !s1.includes(SIX));
  ok("...nor its quarantine", !(await quarantinedIds()).includes(SIX));
  ok("nothing was quarantined at all", (await quarantinedIds()).length === 0, JSON.stringify(await quarantinedIds()));

  group("E. After a reload, undo a ball the server already has, with no way to send (SCRBRD-075)");
  // The pad claims on load, so it opens with the server reachable; then the
  // ball log's route goes dark before its first flush can answer. The pad
  // has re-offered its whole log, as it does on every load, and none of it
  // has been acknowledged in THIS session — which is all the pad used to go
  // on, so the last ball looked as if it had never left.
  const cutEvents = (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue());
  await page.route(`${API}/api/matches/*/events`, cutEvents);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  ok("the pad comes back, and cannot send", (await backOnPad()) && /^Sending \d+$/.test(await pill()), await pill());
  const beforeE = await padIds();
  const FOUR = beforeE.at(-1);
  ok("the last ball is on the server", (await serverIds()).includes(FOUR));
  const boardE = await board();
  await undo();
  ok("undo takes it off the board", (await board()) !== boardE, await board());
  const afterE = await padIds();
  ok("...by a void, not by cutting it: the server has it", afterE.includes(FOUR) && afterE.length === beforeE.length + 1,
     `${afterE.length} v ${beforeE.length}`);
  await page.unroute(`${API}/api/matches/*/events`, cutEvents);
  ok("the route comes back and the void is sent", await pillSays(/^Sent$/, 15000), await pill());
  const s2 = await serverIds();
  const p2 = await padIds();
  ok("the server's log is the pad's log, id for id", same(s2, p2), `${s2.length} v ${p2?.length}`);
  const voidRow = (await dbq(`select kind, payload from ball_event where match_id = $1 order by seq desc limit 1`, [MATCH]))[0];
  ok("...ending in the void of that ball", voidRow?.kind === "void", JSON.stringify(voidRow));
  ok("still nothing quarantined", (await quarantinedIds()).length === 0);
  ok("no application errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
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
console.log(`\n${"─".repeat(52)}\nBROWSER OFFLINE UNDO SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

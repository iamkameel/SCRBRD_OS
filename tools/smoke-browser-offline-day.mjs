#!/usr/bin/env node
/**
 * A scorer's day at a ground with poor signal (SCRBRD-078, SCRBRD-075, SCRBRD-079).
 *
 * The rule the walk holds the pad to: the ball log is never lost, never
 * split, and never silently different from the server's. In a real browser,
 * against the real server, with the network cut and restored by the browser:
 *
 *   A. At the gate, with signal: the scorer signs in and opens the fixture.
 *      The server has no toss, so the pad asks — and the scorer walks out to
 *      the far field before answering.
 *   B. The page LOADS with no signal (the tab was reloaded): the pad reopens
 *      on its own, asks the toss, and the scorer answers it and scores —
 *      into the pad's log and the outbox, both on disk. It used to not reopen
 *      at all: the session restore looked the fixture up on a server it could
 *      not reach, and landed the scorer on the shell.
 *   C. Reloaded again, still with no signal: the pad reopens with its log,
 *      and scoring goes on.
 *   D. Signal comes back, and the scorer is signed out (the token lives in
 *      memory, by design): the pad says so — "Sign in to send N balls" —
 *      and sends nothing.
 *   E. Sign in (the real sign-in; never the demo): the claim is refused for
 *      want of a network once, is retried on its own, and the queue flushes.
 *      The toss reaches the server before any event does, and the server's
 *      log is the pad's, id for id. Nothing is quarantined.
 *  E2. The attached pad loses its signal again and scores on, and the
 *      server lets its lease lapse (90 s without a write): when the signal
 *      returns the ball goes into the log under the token the device takes
 *      back — it used to go to quarantine, with "Sent" on the pill.
 *   F. The match is played to its end (both innings cut to an over by the
 *      umpires): once the queue is empty the match's outbox storage is
 *      cleared — and a reload does not queue the finished match again.
 *
 * Checked against Postgres and IndexedDB, not the page.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-offline-day.mjs
 *   BROWSER_OFFLINE_DAY_DEBUG=1 node tools/smoke-browser-offline-day.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 5307;
const API_PORT = 8807;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_OFFLINE_DAY_DEBUG;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: no toss, nothing scored
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-offline-day-secret",
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

const text = () => page.$eval("body", (el) => el.innerText).catch(() => "");
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const click = async (re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tap = async (id, ms = 4000) => {
  const l = tid(id).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(350);
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
const banner = async () => ({
  reason: (await tid("sync-banner").first().getAttribute("data-reason", { timeout: 800 }).catch(() => null)) ?? null,
  text: ((await tid("sync-banner").first().innerText({ timeout: 800 }).catch(() => "")) || "").replace(/\s+/g, " ").trim(),
});
const until = async (fn, ms = 15000, step = 400) => {
  for (let t = 0; t < ms; t += step) { if (await fn()) return true; await page.waitForTimeout(step); }
  return !!(await fn());
};

/** The pad's log as persist.js saved it (`scrbrd` → `kv` → match:<id>), every innings, in order. */
const saved = () => page.evaluate((key) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    const db = req.result;
    const g = db.transaction("kv", "readonly").objectStore("kv").get(key);
    g.onsuccess = () => { db.close(); resolve(g.result ?? null); };
    g.onerror = () => { db.close(); resolve(null); };
  };
}), `match:${MATCH}`);
const padIds = async () => ((await saved())?.events ?? []).flat().map((e) => e?.id);
/** Every key the outbox keeps for this match on this device (packages/sync indexeddb-storage). */
const outboxKeys = () => page.evaluate((ns) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd-outbox", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("queue")) req.result.createObjectStore("queue"); };
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    const db = req.result;
    const k = db.transaction("queue", "readonly").objectStore("queue").getAllKeys();
    k.onsuccess = () => { db.close(); resolve(k.result.map(String).filter((x) => x.startsWith(ns)).map((x) => x.slice(ns.length))); };
    k.onerror = () => { db.close(); resolve(null); };
  };
}), `${MATCH}:`);
const serverIds = async () => (await dbq(`select idempotency_key from ball_event where match_id = $1 order by seq`, [MATCH]))
  .map((r) => r.idempotency_key);
const quarantined = async () => (await dbq(`select idempotency_key from ball_event_quarantine where match_id = $1`, [MATCH]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Answer the pad's openers and bowler sheets. No roster on a pad that opened with no session: names are typed. */
let named = 0;
const clearBlockers = async () => {
  for (let i = 0; i < 12; i++) {
    const body = await text();
    if (/Available to Bat|Batting Order/i.test(body)) {
      const pick = page.locator("button:not([disabled])", { hasText: /^\s*\d+\s*\n?\s*[A-Z]/ }).first();
      if (await pick.count()) { try { await pick.click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
      const nameField = page.locator('input[aria-label="Player name"]');
      if (await nameField.count()) {
        try { named++; await nameField.fill(`Batter ${named}`); await nameField.press("Enter"); } catch { /* next pass */ }
        await page.waitForTimeout(500);
        continue;
      }
    }
    if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
      const field = page.locator("input[placeholder*='name' i], input[placeholder*='Search bowler' i]").last();
      if (await field.count()) {
        try {
          await field.fill(named % 2 ? "A Nel" : "B Botha");
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
  const fix = tid("scoring-blocked-fix");
  if (await fix.count()) { await fix.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); }
  await clearBlockers();
  if (!/\bDOT\b/i.test(await text())) await click(/QUICK MODE/i, 2500);
  await page.waitForTimeout(300);
  return /\bDOT\b/i.test(await text());
};
/** Tap one run value on the one-tap pad; true when the board moved. The dot ball's key reads "· Dot". */
const score = async (face) => {
  await clearBlockers();
  // A remounted pad opens in three-phase mode; the one-tap keys are behind QUICK MODE.
  if (await page.locator("button", { hasText: /QUICK MODE/i }).count()) await click(/QUICK MODE/i, 2500);
  const before = await board();
  if (!(await click(face === "0" ? /^\s*·\s*dot\s*$/i : new RegExp(`^${face}$`), 2500))) {
    if (DEBUG) console.log(`[debug] no "${face}" key; buttons:`, JSON.stringify(await page.$$eval("button", (bs) => bs.map((b) => b.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40))));
    return false;
  }
  await page.waitForTimeout(600);
  return (await board()) !== before;
};
const signInFromLanding = async () => {
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  return /Match Centre|Dashboard/i.test(await text());
};
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
/** Cut the innings to one over, from the pad's Revise sheet. */
const reviseToOneOver = async () => {
  if (!(await tap("revise-innings"))) return false;
  await tid("revise-overs").fill("1").catch(() => {});
  return tap("revise-confirm");
};
/** Score until the innings review opens (an over at most), then confirm it. */
const playOutTheOver = async (faces) => {
  for (const f of faces) {
    if (await tid("innings-review").count()) break;
    await score(f);
  }
  const open = await until(async () => (await tid("innings-review").count()) > 0, 5000);
  if (!open) return false;
  await tap("review-confirm");
  await page.waitForTimeout(800);
  return true;
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the fixture has no toss and nothing scored", (await dbq(`select 1 from match_toss where match_id = $1`, [MATCH])).length === 0
     && (await serverIds()).length === 0);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  // The service worker serves only what it fetched while in control, so let
  // it take over and load once more with signal (smoke-persist does this).
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 }).catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  group("A. At the gate, with signal: signed in, the fixture open, the toss not yet answered");
  ok("a seeded scorer gets in", await signInFromLanding());
  const device = await page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  ok("the 1XI fixture opens", await openFixture());
  ok("the server has no toss, so the pad asks", await until(async () => (await tid("toss-sheet").count()) === 1, 6000));
  ok("the pad claimed the match", await until(async () =>
    (await dbq(`select 1 from scoring_session where match_id = $1 and state = 'active'`, [MATCH])).length === 1, 6000));

  group("B. The page loads with no signal: the pad reopens, the toss is answered, and play goes on");
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  ok("the pad of the live fixture reopens with no signal (SCRBRD-078)", await until(async () => (await tid("toss-sheet").count()) === 1
     || /\bDOT\b|Revise/.test(await text()), 8000), (await text()).slice(0, 200));
  ok("the toss is asked again: this device never had an answer", (await tid("toss-sheet").count()) === 1);
  await tap("toss-won-home");
  await tap("toss-decision-bat");
  await tap("toss-confirm");
  await page.waitForTimeout(800);
  const tossQueued = await outboxKeys();
  ok("the toss answered with no signal is queued on disk (SCRBRD-075)", tossQueued?.includes(`${device}:toss:pending`), JSON.stringify(tossQueued));
  ok("the scorer is on the pad", await onPad());
  const b0 = await banner();
  ok("the pad says there is no signal and nobody signed in", b0.reason === "not_signed_in" && /No signal/.test(b0.text), JSON.stringify(b0));
  ok("...and offers no sign-in it cannot do without signal", (await tid("sync-signin").count()) === 0);
  let tapped = 0;
  for (const f of ["1", "4", "0"]) if (await score(f)) tapped++;
  ok("three balls with no signal", tapped === 3, tapped);
  await page.waitForTimeout(800);
  const pB = await padIds();
  const qB = (await outboxKeys())?.filter((k) => k.includes(":evt:")) ?? [];
  ok("every event is in the pad's saved log AND queued in the outbox", pB.length >= 7 && qB.length === pB.length, `${pB.length} v ${qB.length}`);
  ok("nothing has reached the server", (await serverIds()).length === 0);
  const boardB = await board();

  group("C. Reloaded, still with no signal: the pad reopens with its log");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  ok("the pad reopens with the same score", await until(async () => (await board()) === boardB, 8000), `${await board()} v ${boardB}`);
  ok("...and its saved log is the one before the reload", same(await padIds(), pB));
  ok("the toss is not asked again", (await tid("toss-sheet").count()) === 0);
  ok("scoring goes on", (await onPad()) && await score("2"));
  await page.waitForTimeout(800);
  const pC = await padIds();
  const qC = (await outboxKeys())?.filter((k) => k.includes(":evt:")) ?? [];
  ok("the new ball is saved and queued too", pC.length === pB.length + 1 && qC.length === pC.length, `${pC.length} / ${qC.length}`);
  const ballsWaiting = 4;

  group("D. Signal returns and the scorer is signed out: the pad says so, and sends nothing");
  await ctx.setOffline(false);
  ok("the prompt appears: sign in to send the balls", await until(async () => /Sign in to send 4 balls/.test((await banner()).text), 10000),
     JSON.stringify(await banner()));
  ok("...with a way to sign in", (await tid("sync-signin").count()) === 1);
  ok("...and nothing was sent, not even the toss", (await serverIds()).length === 0
     && (await dbq(`select 1 from match_toss where match_id = $1`, [MATCH])).length === 0);
  ok("everything is still queued", ((await outboxKeys())?.filter((k) => k.includes(":evt:")).length ?? 0) === pC.length);

  group("E. Signed in: the claim is retried until it lands, and the queue flushes — the toss first");
  // The claim meets no network once: it must be tried again, not given up on.
  const cut = (route) => route.abort("internetdisconnected");
  await page.route(`${API}/api/matches/*/session/claim`, cut);
  await tap("sync-signin");
  await page.waitForTimeout(1200);
  ok("the sign-in is the real one: no demo is offered (SCRBRD-078)", (await tid("login-demo").count()) === 0 && /Sign in to send/.test(await text()),
     (await text()).slice(0, 200));
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  ok("back on the pad after signing in", await until(async () => (await board()) !== "", 8000));
  ok("the claim could not reach the server: the pad says it is trying again",
     await until(async () => (await banner()).reason === "unreachable", 8000), JSON.stringify(await banner()));
  ok("...and nothing has been sent", (await serverIds()).length === 0);
  await page.unroute(`${API}/api/matches/*/session/claim`, cut);
  ok("the claim is retried on its own and the queue flushes", await until(async () => (await pill()) === "Sent", 20000), await pill());
  const sE = await serverIds();
  const pE = await padIds();
  if (DEBUG) console.log("[debug] server", sE, "\n[debug] pad", pE);
  ok("the server's log is the pad's log, id for id", sE.length === pC.length && same(sE, pE), `${sE.length} v ${pE.length}`);
  ok("nothing was quarantined", (await quarantined()).length === 0, JSON.stringify(await quarantined()));
  const session = (await dbq(`select epoch from scoring_session where match_id = $1`, [MATCH]))[0];
  ok("the device took its own token back (generation 1 → 2), nobody else's", session?.epoch === 2, JSON.stringify(session));
  const toss = (await dbq(`select t.won_by, t.decision, t.called_at, u.email from match_toss t
                           left join app_user u on u.id = t.called_by where t.match_id = $1`, [MATCH]))[0];
  ok("the toss answered with no signal is recorded, as answered", toss?.won_by === "home" && toss?.decision === "bat" && toss?.email === "scorer@example.invalid",
     JSON.stringify(toss));
  const first = (await dbq(`select min(server_ts) as at from ball_event where match_id = $1`, [MATCH]))[0];
  ok("...before the first event reached the server (the server freezes it after)", toss && first?.at && new Date(toss.called_at) <= new Date(first.at),
     `${toss?.called_at} v ${first?.at}`);
  ok("...and has left the outbox", !(await outboxKeys())?.some((k) => k.endsWith(":toss:pending")));
  ok(`the ${ballsWaiting} balls are on the server`, (await dbq(`select count(*)::int n from ball_event where match_id = $1 and kind = 'ball'`, [MATCH]))[0].n === ballsWaiting);

  // The server keeps a lease 90 s after the last write it took, and nothing
  // on the pad writes while there is no signal. A pad that went on scoring
  // offline for longer used to send its whole queue into quarantine when the
  // signal came back — and its pill said "Sent".
  group("E2. Offline past the lease on an attached pad: the queue goes into the log under the token taken back");
  const epochE = (await dbq(`select epoch from scoring_session where match_id = $1`, [MATCH]))[0]?.epoch;
  await ctx.setOffline(true);
  await page.waitForTimeout(300);
  // One ball: the fifth of the over, so F's one-over cut still has one to play.
  ok("a ball with no signal, on a pad that holds the token", await score("1"));
  ok("...waiting on the pad", /^Held 1$/.test(await pill()), await pill());
  // Ninety seconds without a write, as smoke-handover-crash moves the clock.
  await dbq(`update scoring_session set lease_until = now() - interval '1 minute' where match_id = $1`, [MATCH]);
  await ctx.setOffline(false);
  ok("signal back: it is sent", await until(async () => (await pill()) === "Sent", 20000), await pill());
  ok("...into the log, not quarantine", (await quarantined()).length === 0, JSON.stringify(await quarantined()));
  ok("...under the token the device took back — its own, the next generation",
     (await dbq(`select epoch from scoring_session where match_id = $1`, [MATCH]))[0]?.epoch === epochE + 1);
  const sE2 = await serverIds(), pE2 = await padIds();
  ok("the server's log is still the pad's, id for id", same(sE2, pE2), `${sE2.length} v ${pE2.length}`);

  group("F. The match played out: its outbox storage is cleared once nothing waits (SCRBRD-079)");
  ok("before the end, the outbox still keeps its sent markers", ((await outboxKeys())?.filter((k) => k.includes(":sent:")).length ?? 0) > 0);
  ok("the umpires cut the first innings to one over", await reviseToOneOver());
  ok("...the over is played out and the innings closed", await playOutTheOver(["1", "0", "2", "0", "0", "0"]));
  ok("the second innings starts from the break", await click(/Start 2nd Innings/, 4000));
  await page.waitForTimeout(800);
  ok("...on the pad", await onPad());
  ok("the chase is cut to one over too", await reviseToOneOver());
  ok("...played out and closed: the match is over", await playOutTheOver(["0", "0", "0", "0", "0", "0"]));
  ok("the result is on screen", await until(async () => /Match Complete/i.test(await text()), 6000));
  ok("once the queue is empty, the match's outbox storage is gone — sent markers and all",
     await until(async () => (await outboxKeys())?.length === 0, 15000), JSON.stringify(await outboxKeys()));
  const sF = await serverIds();
  const pF = await padIds();
  ok("...and only then: the server has the whole log, id for id", sF.length > pE.length && same(sF, pF), `${sF.length} v ${pF.length}`);
  ok("...two innings closed on the server", (await dbq(`select count(*)::int n from ball_event where match_id = $1 and kind = 'innings_end'`, [MATCH]))[0].n === 2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  ok("reopened, the finished match is not queued again", (await outboxKeys())?.length === 0, JSON.stringify(await outboxKeys()));
  ok("...and the pad does not ask to send anything", !/Sign in to send \d/.test((await banner()).text), JSON.stringify(await banner()));
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
console.log(`\n${"─".repeat(52)}\nBROWSER OFFLINE DAY SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

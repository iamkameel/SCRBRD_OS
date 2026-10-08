#!/usr/bin/env node
/**
 * Two phones, one offline through a handover, then back (gap analysis I14–I16,
 * claim 9).
 *
 * smoke-browser-handover.mjs hands a match between two phones that are both
 * online. smoke-browser-offline-day.mjs puts one phone offline. smoke-handover-
 * crash.mjs posts a dead device's late ball over raw HTTP. None puts the
 * OUTGOING phone offline with balls of its own while the INCOMING phone takes
 * the match over, and then brings it back — the afternoon the protocol was
 * written for (SCORING_HANDOVER_SPEC §4: events from a revoked epoch are
 * quarantined, never merged).
 *
 * The day, in two real browser contexts and two real logins:
 *
 *   A  (the scorer) scores two balls with signal; they reach the server
 *   A  arms the handover and reads the code — then closes the sheet and, the
 *      signal gone (ctx.setOffline), scores two more balls. A handover cannot
 *      be armed with a ball unsent, so this is the only order it can happen in
 *   B  (the director of sport) enters the code, confirms the board, and takes
 *      the token, then scores a ball of her own
 *   A  gets its signal back
 *
 * What the code already decides (apps/web/src/lib/sync.js gate(),
 * packages/sync, services/api/realtime/session-routes.mjs), and is held to
 * here, not changed: A's first flush on reconnect asks the server before it
 * sends anything, is told the token has moved, and stops — "token_moved". So
 * A's two balls are neither merged nor counted: they stay queued on A's disk,
 * the server's log is A's two, then B's one, each once, and nothing is in
 * quarantine because nothing was sent. A's pad says, in words, that another
 * device holds the match; a ball tapped on A afterwards is saved there and
 * goes nowhere.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-handover-offline.mjs
 *   BROWSER_HANDOVER_OFFLINE_DEBUG=1 node tools/smoke-browser-handover-offline.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(4334);
const API_PORT = port(8856);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_HANDOVER_OFFLINE_DEBUG;
const DB = ownerUrl();
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);
const debug = (...a) => { if (DEBUG) console.log("   ·", ...a); };

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-handover-offline-secret",
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

/** One signed-in phone: its own context (so its own storage), its own console-error trap. */
async function openAs(label) {
  const ctx = await browser.newContext();
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(t)) return;
    errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  const click = async (re, ms = 4000) => {
    const l = page.locator("button:not([disabled])", { hasText: re }).first();
    if (!(await l.count())) return false;
    try { await l.click({ timeout: ms }); } catch { return false; }
    await page.waitForTimeout(260);
    return true;
  };
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(label, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  return { ctx, page, errors, text: () => page.$eval("body", (el) => el.innerText).catch(() => "") };
}

/** Clear whatever the pad is asking for before it will take a delivery. */
async function clearBlockers(page) {
  for (let i = 0; i < 10; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const nextBat = page.locator("button:not([disabled])", { hasText: /\bNEXT\b/i });
    if (await nextBat.count()) { try { await nextBat.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const body = await page.$eval("body", (el) => el.innerText);
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
        } catch { /* fall through */ }
        await page.waitForTimeout(600);
        continue;
      }
    }
    return;
  }
}

const openMichaelhouse = async (page) => page.evaluate(() => {
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

/** Open the Michaelhouse fixture's pad from the dashboard, as the handover walk does. */
async function openPad(who) {
  await who.page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await who.page.waitForTimeout(1200);
  const opened = await openMichaelhouse(who.page);
  await who.page.waitForTimeout(2000);
  return opened;
}

/** Tap a run face on the basic pad. */
async function tapFace(page, face) {
  await clearBlockers(page);
  if (!(await page.locator('[data-testid="basic-pad"]').count())) {
    await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).catch(() => {});
    await page.locator('[data-testid="pad-basic-scoring"]').click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const btn = page.locator("button:not([disabled])", { hasText: new RegExp(`^${face}$`) }).first();
  if (!(await btn.count())) return false;
  try { await btn.click({ timeout: 2500 }); } catch { return false; }
  await page.waitForTimeout(500);
  return true;
}

const until = async (page, fn, ms = 15000, step = 400) => {
  for (let t = 0; t < ms; t += step) { if (await fn()) return true; await page.waitForTimeout(step); }
  return !!(await fn());
};
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const banner = async (page) => ({
  reason: (await tid(page, "sync-banner").first().getAttribute("data-reason", { timeout: 800 }).catch(() => null)) ?? null,
  text: ((await tid(page, "sync-banner").first().innerText({ timeout: 800 }).catch(() => "")) || "").replace(/\s+/g, " ").trim(),
});
/** The sync pill's word, from its accessible name: "Sent", "Held 2", "On device"… */
const pill = async (page) => {
  const l = page.locator('[aria-label^="Sync status:"]').first();
  if (!(await l.count())) return "";
  const label = (await l.getAttribute("aria-label", { timeout: 1000 }).catch(() => "")) || "";
  return (label.match(/^Sync status: ([^.]*)\./)?.[1] ?? "").trim();
};
/** The pad's board, as the screen reader hears it: "6 for 0, 0.3 overs". */
const board = async (page) => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent({ timeout: 1500 }).catch(() => "")) || "").trim();
/** The event ids of the pad's saved log (persist.js), every innings, in order. */
const padIds = (page) => page.evaluate((key) => new Promise((resolve) => {
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
/** The events still queued on a phone, in order: the outbox's `evt:` rows, parsed. */
const queued = (page) => page.evaluate((ns) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd-outbox", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("queue")) req.result.createObjectStore("queue"); };
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    const db = req.result;
    const os = db.transaction("queue", "readonly").objectStore("queue");
    const k = os.getAllKeys(), v = os.getAll();
    v.onsuccess = () => {
      const keys = k.result.map(String);
      const rows = [];
      keys.forEach((key, i) => { if (key.startsWith(ns) && key.slice(ns.length).includes(":evt:")) {
        const val = typeof v.result[i] === "string" ? JSON.parse(v.result[i]) : v.result[i];
        rows.push({ id: val.idempotencyKey, epoch: val.epoch, clientSeq: val.clientSeq });
      } });
      db.close();
      resolve(rows.sort((a, b) => a.clientSeq - b.clientSeq));
    };
    v.onerror = () => { db.close(); resolve(null); };
  };
}), `${MATCH}:`);

const serverLog = () => dbq(`select idempotency_key as id, kind, device_id, epoch from ball_event where match_id = $1 order by seq`, [MATCH]);
const quarantine = () => dbq(`select idempotency_key as id from ball_event_quarantine where match_id = $1`, [MATCH]);
const sessionRow = async () => (await dbq(`select state, epoch, holder_user_id from scoring_session where match_id = $1`, [MATCH]))[0];
const figures = async () => (await dbq(
  `select coalesce(sum(case when ball_type in ('run','W','Nb') then coalesce(value,0) else 0 end),0)::int r,
          coalesce(sum(case when ball_type='W' then 1 else 0 end),0)::int w,
          coalesce(sum(case when kind='ball' and ball_type not in ('Wd','Nb') then 1 else 0 end),0)::int b
     from ball_event_live where match_id = $1`, [MATCH]))[0];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let A, B;
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1
             on conflict (match_id) do nothing`, [MATCH]);

  group("A scores two balls with signal; they reach the server");
  A = await openAs(/Scorer/);
  ok("the scorer signs in", /Match Centre|Dashboard/i.test(await A.text()));
  ok("opened the real fixture", await openPad(A));
  await clearBlockers(A.page);
  // The first tap on a pad that has only just opened can be spent on a sheet
  // (openers, bowler): tap until the server has two balls, never more than six taps.
  // (Two, not more: a sixth ball on A would open the next-over sheet and hide its banner.)
  const ballsOnServer = async () => (await serverLog()).filter((r) => r.kind === "ball").length;
  let tapped = 0;
  for (const face of ["1", "4", "1", "1", "1", "1"]) {
    if (await ballsOnServer() >= 2) break;
    if (await tapFace(A.page, face)) tapped++;
    await until(A.page, async () => (await ballsOnServer()) >= Math.min(2, tapped), 4000);
  }
  ok("deliveries tapped", tapped >= 2 && tapped <= 6, tapped);
  ok("exactly two reach the server", await until(A.page, async () => (await ballsOnServer()) === 2, 12000),
     (await serverLog()).map((r) => r.kind).join(","));
  const deviceA = await A.page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  const synced = await serverLog();
  const nSynced = synced.length;
  const before = await figures();
  ok("A's outbox is empty: nothing is waiting", await until(A.page, async () => (await queued(A.page))?.length === 0, 8000), JSON.stringify(await queued(A.page)));
  const sess0 = await sessionRow();
  ok("A holds the token", sess0?.state === "active");

  group("A arms the handover, closes the sheet, and loses its signal");
  await tid(A.page, "open-handover").first().click({ timeout: 3000 });
  await A.page.waitForTimeout(300);
  await tid(A.page, "handover-arm").click({ timeout: 3000 }).catch(() => {});
  await tid(A.page, "handover-code").waitFor({ timeout: 8000 }).catch(() => {});
  const code = (await tid(A.page, "handover-code").innerText().catch(() => "")).trim();
  ok("a six-digit code is shown", /^\d{6}$/.test(code), code);
  const armed = await sessionRow();
  ok("the server agrees a handover is pending", armed?.state === "handover_pending", JSON.stringify(armed));
  await A.page.locator('[aria-label="Close Handover"]').click({ timeout: 3000 }).catch(() => {});
  await A.page.waitForTimeout(500);
  ok("the sheet is closed and A is back on the pad", (await tid(A.page, "handover-code").count()) === 0 && /\bDOT\b/i.test(await A.text()));
  await A.ctx.setOffline(true);
  ok("A is offline", await until(A.page, async () => (await A.page.evaluate(() => navigator.onLine)) === false, 5000));
  await A.page.waitForTimeout(800);

  group("A, offline, scores two more balls: saved on the phone, sent nowhere");
  let offlineTapped = 0;
  for (const face of ["2", "1"]) if (await tapFace(A.page, face)) offlineTapped++;
  ok("two deliveries tapped with no signal", offlineTapped === 2, offlineTapped);
  await A.page.waitForTimeout(800);
  const qOff = (await queued(A.page)) ?? [];
  ok("both are queued on A's disk", qOff.length === 2, JSON.stringify(qOff));
  const offIds = qOff.map((e) => e.id);
  ok("...and are in A's saved log", (await padIds(A.page))?.filter((id) => offIds.includes(id)).length === 2);
  ok("...under the generation A held when it armed", qOff.every((e) => e.epoch === sess0.epoch), `${JSON.stringify(qOff)} v ${sess0.epoch}`);
  ok("the server has none of them", (await serverLog()).length === nSynced);
  const boardOffline = await board(A.page);
  debug("A's pill offline:", await pill(A.page), "| banner:", JSON.stringify(await banner(A.page)), "| board:", boardOffline);

  group("B takes the match over with the code, while A is offline");
  B = await openAs(/Director of Sport/);
  ok("the director of sport signs in", /Match Centre|Dashboard/i.test(await B.text()));
  ok("opened the same fixture", await openPad(B));
  ok("B is offered Take over: A's handover is pending", /Take over/i.test(await B.text()));
  await tid(B.page, "open-handover").first().click({ timeout: 3000 });
  await B.page.waitForTimeout(300);
  await B.page.fill('[data-testid="handover-code-entry"]', code);
  await tid(B.page, "handover-claim").click({ timeout: 3000 });
  await B.page.waitForTimeout(600);
  ok("the code is accepted", (await tid(B.page, "handover-verify-runs").count()) === 1);
  // The board B reads is the server's: A's two offline balls are not on it.
  await B.page.fill('[data-testid="handover-verify-runs"]', String(before.r));
  await B.page.fill('[data-testid="handover-verify-wickets"]', String(before.w));
  await B.page.fill('[data-testid="handover-verify-overs"]', String(Math.floor(before.b / 6)));
  await B.page.fill('[data-testid="handover-verify-balls"]', String(before.b % 6));
  await tid(B.page, "handover-verify-confirm").click({ timeout: 3000 });
  await B.page.waitForTimeout(1000);
  const after = await sessionRow();
  ok("the token moved to B, under a new generation", after?.state === "active" && after?.epoch === armed.epoch + 1, JSON.stringify({ after, armed }));
  const [director] = await dbq(`select id from app_user where email = 'sarah@example.invalid'`);
  ok("...held by the director of sport", after?.holder_user_id === director?.id);
  const deviceB = await B.page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  ok("B is a different phone", !!deviceA && !!deviceB && deviceA !== deviceB);
  ok("A's two balls are still not on the server", (await serverLog()).length === nSynced);

  const bTapped = await tapFace(B.page, "1");
  ok("B scores a ball", bTapped);
  ok("it reaches the server", await until(B.page, async () => (await serverLog()).length === nSynced + 1, 10000), `${(await serverLog()).length} v ${nSynced + 1}`);
  const bBall = (await serverLog()).at(-1);
  ok("...from B's phone, under the new generation", bBall?.device_id === deviceB && bBall?.epoch === after.epoch, JSON.stringify(bBall));
  const atTakeover = await figures();

  group("A gets its signal back");
  await A.ctx.setOffline(false);
  ok("A is online", await until(A.page, async () => (await A.page.evaluate(() => navigator.onLine)) === true, 5000));
  ok("A's pad says another device has taken over, in words",
     await until(A.page, async () => (await banner(A.page)).reason === "token_moved", 20000), JSON.stringify(await banner(A.page)));
  const bn = await banner(A.page);
  ok("...\"Another device has taken over scoring this match\"", /Another device has taken over scoring this match/.test(bn.text), bn.text);
  ok("...and that nothing more is sent from there, with its two balls saved", /Nothing more is sent from here/.test(bn.text) && /2 balls? (is|are) saved on this device/.test(bn.text), bn.text);
  ok("A's pill does not say Sent", !/^Sent$/.test(await pill(A.page)), await pill(A.page));
  debug("A's pill after:", await pill(A.page), "| banner:", JSON.stringify(bn));
  await A.page.waitForTimeout(6000); // two retry ticks, in case anything were going to be sent

  group("No ball is counted twice, and none of A's is counted at all");
  const log = await serverLog();
  const ids = log.map((r) => r.id);
  ok("every key in the server's log is there once", new Set(ids).size === ids.length);
  ok("the server's log is A's two, then B's one", log.length === nSynced + 1
     && same(ids.slice(0, nSynced), synced.map((r) => r.id)) && log.at(-1).device_id === deviceB);
  ok("none of A's offline balls is in the log", offIds.every((id) => !ids.includes(id)));
  ok("none of them was sent to quarantine either: nothing left A", (await quarantine()).length === 0, JSON.stringify(await quarantine()));
  ok("...so no ball is counted in the log and in review", offIds.every((id) => !ids.includes(id)) && (await quarantine()).every((q) => !offIds.includes(q.id)));
  const qAfter = (await queued(A.page)) ?? [];
  ok("A still has both, queued and untouched, in order", same(qAfter.map((e) => e.id), offIds), JSON.stringify(qAfter));
  ok("...still stamped with the generation A held, not restamped to B's", qAfter.every((e) => e.epoch === sess0.epoch), JSON.stringify(qAfter));
  const figs = await figures();
  ok("the score is the server's fold of its own log: A's two and B's one", figs.b === before.b + 1 && figs.r === before.r + 1,
     `${JSON.stringify(figs)} v ${JSON.stringify(before)}`);
  ok("...unchanged by A's reconnecting", same(figs, atTakeover), `${JSON.stringify(figs)} v ${JSON.stringify(atTakeover)}`);
  const sess1 = await sessionRow();
  ok("the token is still B's, under the same generation", sess1?.holder_user_id === director?.id && sess1?.epoch === after.epoch && sess1?.state === "active", JSON.stringify(sess1));

  group("A cannot send from here: a further ball is saved on A and goes nowhere");
  const tapAgain = await tapFace(A.page, "1");
  await A.page.waitForTimeout(6000);
  ok("a ball tapped on A afterwards is taken", tapAgain);
  const qMore = (await queued(A.page)) ?? [];
  ok("...queued behind the other two", qMore.length === 3 && same(qMore.slice(0, 2).map((e) => e.id), offIds), JSON.stringify(qMore));
  ok("...and the server's log did not move", same((await serverLog()).map((r) => r.id), ids));
  ok("...and nothing is in quarantine", (await quarantine()).length === 0);
  ok("A still says another device holds the match", await until(A.page, async () => (await banner(A.page)).reason === "token_moved", 8000),
     `${JSON.stringify(await banner(A.page))} | ${(await A.text()).replace(/\s+/g, " ").slice(0, 500)}`);
  ok("...with everything it recorded since still saved on A and nowhere else",
     (await queued(A.page)).length >= 3 && same((await serverLog()).map((r) => r.id), ids) && (await quarantine()).length === 0);

  group("B's screen is the server's, and B goes on scoring");
  const wantBoard = `${figs.r} for ${figs.w}, ${Math.floor(figs.b / 6)}.${figs.b % 6} overs`;
  ok("B's board is the server's score", await until(B.page, async () => (await board(B.page)) === wantBoard, 6000), `${await board(B.page)} v ${wantBoard}`);
  ok("A's board is not the server's: it shows balls the server does not have", (await board(A.page)) !== wantBoard, await board(A.page));
  const bAgain = await tapFace(B.page, "4");
  ok("B scores another ball", bAgain);
  ok("it reaches the server, once", await until(B.page, async () => (await serverLog()).length === nSynced + 2, 10000), `${(await serverLog()).length}`);
  const finalIds = (await serverLog()).map((r) => r.id);
  ok("the log is still unique, and still without any of A's offline balls",
     new Set(finalIds).size === finalIds.length && offIds.every((id) => !finalIds.includes(id)));

  ok("no console errors on either phone", A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors].slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await A?.ctx.close().catch(() => {});
  await B?.ctx.close().catch(() => {});
  await browser.close();
  web.close();
  api.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 10).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER HANDOVER OFFLINE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

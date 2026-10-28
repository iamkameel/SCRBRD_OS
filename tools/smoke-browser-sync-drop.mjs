#!/usr/bin/env node
/**
 * The signal drops mid-over (CRI-0.4, docs/design/CRICINFO_GAP_PLAN.md §6).
 *
 * A scorer at a ground with patchy signal: two balls of the over go out, the
 * signal drops, and six more are scored with none — a wide and a wicket among
 * them, and the over's end. Then the signal comes back. The rule the walk
 * holds the pad to: no ball is lost, none is stored twice, the pill counts
 * every ball the phone holds and counts down to "Sent" as they go, and
 * afterwards the board, the server's fold of its own rows and
 * match_live_score (the SQL fold the public score reads) say the same score.
 *
 *   A. Online: sign in, open the fixture, two balls; both on the server.
 *   B. The signal drops after ball 2 of the over. Six deliveries: 1, a wide,
 *      2, bowled, 4 (the over's end, and a new bowler), 1. After each, the
 *      pill reads "Held N" for the N events in the outbox on disk, its
 *      balls are exactly the taps so far, the server has none of them, and
 *      the banner says nothing (an attached pad with no signal has only the
 *      pill: bannerFor returns null while attached).
 *   C. The signal comes back. No reload, nobody presses anything: the outbox
 *      drains. The pill's words while it drains are recorded, and only fall.
 *      Then: the server's log is the pad's, id for id and in order; each tap
 *      is one row, in tap order, of the kind tapped; no key twice and no
 *      row twice; the outbox on disk is empty; nothing quarantined; the pill
 *      reads "Sent" and there is no banner; the board, the server's fold and
 *      match_live_score agree.
 *   D. The signal drops again; three balls; the page is RELOADED with none.
 *      The pad reopens from disk unattached (the API token was in memory):
 *      the pill reads "Saved on this phone · 3 to send" and the banner says
 *      "No signal. 3 balls are saved on this device and will send when
 *      there is a connection." The outbox and the log survived the reload.
 *   E. The signal comes back: the pad re-attaches with its resume credential
 *      (SCRBRD-078 option B; or a sign-in, if it has none) and drains. The
 *      same checks as C.
 *
 * Checked against Postgres and IndexedDB, not only the page. The walk does
 * not change how the pad emits or sends; it only watches.
 *
 * Builds on smoke-browser-offline-undo.mjs (its helpers) and
 * smoke-browser-wicket-on-extra.mjs (the fold and match_live_score check).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-sync-drop.mjs
 *   BROWSER_SYNC_DROP_DEBUG=1 node tools/smoke-browser-sync-drop.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { deriveInnings, fromRow } from "@scrbrd/scoring";
import { EVENT_COLUMNS } from "../services/api/write/events-api.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(5497);
const API_PORT = port(8957);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const DEBUG = !!process.env.BROWSER_SYNC_DROP_DEBUG;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-sync-drop-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = /** @type {string[]} */ ([]);
api.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x").pathname;
  let body, type;
  try {
    const f = join("apps/web/dist", url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = /** @type {Record<string, string>} */ (TYPES)[extname(f)] ?? "application/octet-stream";
  } catch {
    body = await readFile("apps/web/dist/index.html");
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, () => r(null)));

const pool = new pg.Pool({ connectionString: DB });
const dbq = async (/** @type {string} */ text, /** @type {any[]} */ params = []) => (await pool.query(text, params)).rows;

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext();
await offline(ctx);
const page = await ctx.newPage();
watchReads(page);
const errors = /** @type {string[]} */ ([]);
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(t)) errors.push(`console.error: ${t}`);
});

const text = () => page.$eval("body", (el) => /** @type {HTMLElement} */ (el).innerText);
const tid = (/** @type {string} */ id) => page.locator(`[data-testid="${id}"]`);
const tap = async (/** @type {string} */ id, ms = 4000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(350); };
const click = async (/** @type {RegExp} */ re, ms = 3000) => {
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
/** The sync banner: its reason and its words, or null when the pad shows none. */
const banner = async () => {
  const l = tid("sync-banner");
  if (!(await l.count())) return null;
  return { reason: await l.first().getAttribute("data-reason"), text: ((await l.first().innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim() };
};
/** The pad's board, as the screen reader hears it: "11 for 0, 1.2 overs". */
const board = async () => {
  const l = page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / }).first();
  if (!(await l.count())) return "";
  return ((await l.textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
};
const boardOf = (/** @type {any} */ inn) => `${inn.runs} for ${inn.wickets}, ${Math.floor(inn.balls / 6)}.${inn.balls % 6} overs`;

/** The pad's log as persist.js saved it (`scrbrd` → `kv` → match:<id>), every innings, in order. */
const padIds = () => page.evaluate((key) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    const db = req.result;
    const g = db.transaction("kv", "readonly").objectStore("kv").get(key);
    g.onsuccess = () => { db.close(); resolve((g.result?.events ?? []).flat().map((/** @type {any} */ e) => e?.id)); };
    g.onerror = () => { db.close(); resolve(null); };
  };
}), `match:${MATCH}`);
/**
 * The outbox's queue on disk (packages/sync indexeddb-storage), in the order
 * it would send: each event's key and kind.
 * @returns {Promise<{key: string, kind: string, seq: number}[] | null>}
 */
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
      /** @type {any[]} */
      const out = [];
      k.result.forEach((key, i) => {
        if (!String(key).startsWith(ns) || !String(key).includes(":evt:")) return;
        const ev = typeof v.result[i] === "string" ? JSON.parse(v.result[i]) : v.result[i];
        out.push({ key: ev.idempotencyKey, kind: ev.payload?.kind ?? "ball", seq: ev.clientSeq });
      });
      out.sort((a, b) => a.seq - b.seq);
      db.close();
      resolve(out);
    };
    v.onerror = () => { db.close(); resolve(null); };
  };
}), `${MATCH}:`);

/** The server's log for this match, in seq order. */
const serverRows = async () => dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [MATCH]);
const serverIds = async () => (await serverRows()).map((r) => r.idempotency_key);
const quarantined = async () => (await dbq(`select count(*)::int n from ball_event_quarantine where match_id = $1`, [MATCH]))[0].n;
/** Keys the server stored more than once (the UNIQUE on idempotency_key says none can be). */
const dupKeys = async () => (await dbq(
  `select idempotency_key from ball_event where match_id = $1 group by idempotency_key having count(*) > 1`, [MATCH])).length;
const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b);

/** Answer the pad's openers, next-batter and bowler sheets (as smoke-browser-offline-undo does). */
const clearBlockers = async () => {
  for (let i = 0; i < 12; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch { /* next pass */ } await page.waitForTimeout(500); continue; }
    const next = page.locator("button:not([disabled])", { hasText: /\bNEXT\b/i });
    if (await next.count()) { try { await next.first().click({ timeout: 1500 }); } catch { /* next pass */ } await page.waitForTimeout(500); continue; }
    const body = await text();
    if (/Available to Bat|Batting Order/i.test(body)) {
      const pick = page.locator("button:not([disabled])", { hasText: /^\s*\d+\s*\n?\s*[A-Z]/ }).first();
      if (await pick.count()) { try { await pick.click({ timeout: 1500 }); } catch { /* next pass */ } await page.waitForTimeout(500); continue; }
    }
    if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
      const field = page.locator("input[placeholder*='name' i], input[placeholder*='Search bowler' i]").last();
      if (await field.count()) {
        try {
          await field.fill(/Over \d+ Complete/i.test(body) ? "B Botha" : "A Nel");
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
  if (!(await tid("basic-pad").count())) { await tid("pad-menu").click({ timeout: 2500 }).catch(() => {}); await tid("pad-basic-scoring").click({ timeout: 2500 }).catch(() => {}); }
  await page.waitForTimeout(300);
  return /\bDOT\b/i.test(await text());
};
/** Match Centre → the 1XI v Michaelhouse card → its scorer. */
const openFixture = async () => {
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await afterReads(page, 1200);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "")),
    null, { timeout: 10000 }).catch(() => {});
  const opened = await page.evaluate(() => {
    const isBtn = (/** @type {Element} */ b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "");
    for (const b of [...document.querySelectorAll("button")].filter(isBtn)) {
      let card = /** @type {Element} */ (b);
      while (card.parentElement && [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) card = card.parentElement;
      if (/Michaelhouse/i.test(card.textContent || "")) { /** @type {HTMLElement} */ (b).click(); return true; }
    }
    return false;
  });
  await afterReads(page, 2500);
  return opened;
};
const signIn = async () => {
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await afterReads(page, 2200);
  return /Match Centre|Dashboard/i.test(await text());
};
/** Wait for the pill to say something, up to `ms` (polls the page's own state). */
const pillSays = async (/** @type {RegExp} */ re, ms = 12000) => {
  for (let t = 0; t < ms; t += 300) {
    if (re.test(await pill())) return true;
    await page.waitForTimeout(300);
  }
  return false;
};
/** Wait for the board to move off `before`, up to 5 s. */
const boardMoves = async (/** @type {string} */ before) => {
  for (let t = 0; t < 5000 && (await board()) === before; t += 200) await page.waitForTimeout(200);
  return (await board()) !== before;
};

/**
 * The six deliveries, and how each must land on the server: one row, of the
 * kind tapped. `do` taps it on the one-tap pad.
 */
const DELIVERIES = [
  { name: "a single", do: () => click(/^1$/), row: (/** @type {any} */ r) => r.ball_type === "run" && r.value === 1 && !r.dismissal },
  { name: "a wide", do: async () => { await tap("key-wide"); await tap("extra-run-0"); }, row: (/** @type {any} */ r) => r.ball_type === "Wd" && !r.dismissal },
  { name: "two", do: () => click(/^2$/), row: (/** @type {any} */ r) => r.ball_type === "run" && r.value === 2 && !r.dismissal },
  { name: "bowled", do: async () => { await tap("key-wicket"); await tap("wicket-mode-bowled"); await tap("wicket-confirm"); await page.waitForTimeout(400); await clearBlockers(); },
    row: (/** @type {any} */ r) => r.dismissal === "bowled" },
  { name: "four, the over's last ball", do: async () => { await click(/^4$/); await page.waitForTimeout(400); await clearBlockers(); },
    row: (/** @type {any} */ r) => r.ball_type === "run" && r.value === 4 && !r.dismissal },
  { name: "a single off the new bowler", do: () => click(/^1$/), row: (/** @type {any} */ r) => r.ball_type === "run" && r.value === 1 && !r.dismissal },
];

/**
 * Record every word the pill shows from now until stop(): a 25 ms poll in
 * the page, so a word that lasts one frame is kept.
 */
const watchPill = () => page.evaluate(() => {
  const w = /** @type {any} */ (window);
  w.__pillSeen = [];
  clearInterval(w.__pillTimer);
  w.__pillTimer = setInterval(() => {
    const el = document.querySelector('[aria-label^="Sync status:"]');
    const word = (el?.getAttribute("aria-label")?.match(/^Sync status: ([^.]*)\./)?.[1] ?? "").trim();
    if (word && w.__pillSeen.at(-1) !== word) w.__pillSeen.push(word);
  }, 25);
});
const pillSeen = async () => /** @type {string[]} */ (await page.evaluate(() => { const w = /** @type {any} */ (window); clearInterval(w.__pillTimer); return w.__pillSeen ?? []; }));
/** The count a pill word carries ("Held 6" → 6, "Sent" → 0); null for a word with none. */
const countOf = (/** @type {string} */ w) => w === "Sent" ? 0 : (w.match(/(\d+)/) ? Number(w.match(/(\d+)/)?.[1]) : null);

/**
 * After the drain: the server and the pad agree, every tap is one row in tap
 * order, nothing twice, nothing left, the board and both folds agree.
 * @param {string} label
 * @param {string[]} offlineIds  the pad-log ids added while offline, in tap order
 * @param {{row: (r: any) => boolean, name: string}[]} taps  what each tap was
 */
const drainedChecks = async (label, offlineIds, taps) => {
  const rows = await serverRows();
  const s = rows.map((r) => r.idempotency_key);
  const p = await padIds();
  if (DEBUG) console.log(`[debug] ${label} server`, s.length, "pad", p?.length);
  ok(`${label}: the server's log is the pad's, id for id and in order (${s.length} events)`, same(s, p), `${s.length} v ${p?.length}`);
  ok(`${label}: no key stored twice`, (await dupKeys()) === 0);
  ok(`${label}: the pad's log holds no id twice either`, new Set(p).size === p?.length);
  const at = offlineIds.map((id) => s.indexOf(id));
  ok(`${label}: every event scored offline is on the server`, at.every((i) => i >= 0), JSON.stringify(at));
  ok(`${label}: ...in the order it was scored`, at.every((i, k) => k === 0 || i > at[k - 1]), JSON.stringify(at));
  const balls = rows.filter((r) => offlineIds.includes(r.idempotency_key) && r.kind === "ball");
  ok(`${label}: one ball row per tap, no more (${balls.length} for ${taps.length} taps)`, balls.length === taps.length,
     JSON.stringify(balls.map((r) => [r.ball_type, r.value, r.dismissal])));
  ok(`${label}: ...each the delivery tapped (${taps.map((t) => t.name).join(", ")})`, taps.every((t, i) => balls[i] && t.row(balls[i])),
     JSON.stringify(balls.map((r) => [r.ball_type, r.value, r.dismissal])));
  ok(`${label}: the outbox on disk is empty`, (await queuedOnDisk())?.length === 0, JSON.stringify(await queuedOnDisk()));
  ok(`${label}: nothing quarantined`, (await quarantined()) === 0);
  ok(`${label}: the pill reads "Sent"`, (await pill()) === "Sent", await pill());
  ok(`${label}: ...and the banner says nothing (attached and sending)`, (await banner()) === null, JSON.stringify(await banner()));
  const evs = rows.map(fromRow).filter((e) => (e.innings ?? 0) === 0);
  const inn = deriveInnings(/** @type {any} */ (evs));
  const b = await board();
  ok(`${label}: the board and the server's fold agree (${b})`, b === boardOf(inn), `board ${b} / server ${boardOf(inn)}`);
  const [live] = await dbq(`select runs::int, wickets::int, legal_balls::int from match_live_score where match_id = $1 and innings = 0`, [MATCH]);
  ok(`${label}: ...and so does match_live_score`,
     live?.runs === inn.runs && live?.wickets === inn.wickets && live?.legal_balls === inn.balls,
     `${JSON.stringify(live)} / ${boardOf(inn)}`);
  return inn;
};

/** The pill's words while it drained: each count no higher than the last, ending "Sent". */
const drainChecks = (/** @type {string} */ label, /** @type {string[]} */ seen, /** @type {number} */ held) => {
  const counts = seen.map(countOf);
  ok(`${label}: the pill's words while it drained only count down (${seen.join(" → ")})`,
     counts.every((c) => c !== null) && counts.every((c, i) => i === 0 || /** @type {number} */ (c) <= /** @type {number} */ (counts[i - 1])), seen.join(" → "));
  ok(`${label}: ...from no more than the ${held} it held`, counts.every((c) => c === null || c <= held), seen.join(" → "));
  ok(`${label}: ...to "Sent"`, seen.at(-1) === "Sent", seen.join(" → "));
};

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // SCRBRD-067: the first innings follows the recorded toss.
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1
             on conflict (match_id) do nothing`, [MATCH]);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  // The service worker serves the shell for the offline reload in D; let it
  // take control with signal, as a scorer opens the app at the gate.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 }).catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  group("A. Online: two balls of the over reach the server");
  ok("a seeded scorer gets in", await signIn());
  ok("the 1XI fixture opens", await openFixture());
  ok("the scorer is on the pad", await onPad());
  for (const face of ["1", "2"]) {
    const before = await board();
    await click(new RegExp(`^${face}$`));
    ok(`ball ${face === "1" ? 1 : 2} is on the board`, await boardMoves(before), await board());
  }
  ok("...and sent", await pillSays(/^Sent$/), await pill());
  await afterReads(page, 300);
  const s0 = await serverIds();
  ok("the server's log is the pad's log", s0.length > 0 && same(s0, await padIds()), `${s0.length} v ${(await padIds())?.length}`);
  ok("no banner while attached and sending", (await banner()) === null, JSON.stringify(await banner()));

  group("B. The signal drops after ball 2: six deliveries, each held and counted");
  await ctx.setOffline(true);
  await page.waitForTimeout(300);
  const padBefore = /** @type {string[]} */ (await padIds());
  const serverBefore = (await serverRows()).length;
  let heldAtEnd = 0;
  for (let i = 0; i < DELIVERIES.length; i++) {
    const d = DELIVERIES[i];
    const before = await board();
    await d.do();
    ok(`${i + 1}. ${d.name}: on the board`, await boardMoves(before) || (await board()) !== before, await board());
    const q = await queuedOnDisk() ?? [];
    const qBalls = q.filter((e) => e.kind === "ball").length;
    const word = await pill();
    ok(`${i + 1}. ...the outbox on disk holds ${i + 1} ball${i ? "s" : ""} (${q.length} events)`, qBalls === i + 1, JSON.stringify(q.map((e) => e.kind)));
    ok(`${i + 1}. ...the pill reads "Held ${q.length}"`, word === `Held ${q.length}`, word);
    ok(`${i + 1}. ...the banner says nothing`, (await banner()) === null, JSON.stringify(await banner()));
    ok(`${i + 1}. ...the server has none of them`, (await serverRows()).length === serverBefore);
    heldAtEnd = q.length;
  }
  const padAfterB = /** @type {string[]} */ (await padIds());
  const offlineB = padAfterB.slice(padBefore.length);
  ok(`the pad's log grew by exactly what the outbox holds (${offlineB.length})`,
     same(offlineB, (await queuedOnDisk())?.map((e) => e.key)), `${JSON.stringify(offlineB)} v ${JSON.stringify((await queuedOnDisk())?.map((e) => e.key))}`);
  ok("the over ended offline: a new over is under way", / 1\.1 overs$/.test(await board()), await board());

  group("C. The signal returns: the outbox drains by itself, and the server agrees");
  await watchPill();
  await ctx.setOffline(false);
  ok("the pill reaches \"Sent\" with no reload and nobody pressing anything", await pillSays(/^Sent$/, 20000), await pill());
  await afterReads(page, 600);
  const seenC = await pillSeen();
  if (DEBUG) console.log("[debug] pill while draining:", seenC.join(" → "));
  drainChecks("C", seenC, heldAtEnd);
  await drainedChecks("C", offlineB, DELIVERIES);

  group("D. The signal drops again; three balls; the page is reloaded with none");
  await ctx.setOffline(true);
  await page.waitForTimeout(300);
  const padBeforeD = /** @type {string[]} */ (await padIds());
  const D_TAPS = [DELIVERIES[0], DELIVERIES[2], DELIVERIES[5]];   // 1, 2, 1
  for (const t of D_TAPS) { const before = await board(); await t.do(); await boardMoves(before); }
  const qD = await queuedOnDisk() ?? [];
  ok("three balls held", qD.filter((e) => e.kind === "ball").length === 3 && (await pill()) === `Held ${qD.length}`, `${await pill()} / ${qD.length}`);
  const boardD = await board();
  await page.reload({ waitUntil: "domcontentloaded" });
  await afterReads(page, 3000);
  for (let t = 0; t < 30 && !(await board()); t++) await page.waitForTimeout(300);
  ok("the pad reopens from disk with no signal", (await board()) === boardD, `${await board()} v ${boardD}`);
  ok("the pad's saved log survived the reload", same(await padIds(), [...padBeforeD, ...qD.map((e) => e.key)]));
  ok("...and the outbox on disk, event for event", same((await queuedOnDisk())?.map((e) => e.key), qD.map((e) => e.key)));
  const wordD = await pill();
  const bannerD = await banner();
  if (DEBUG) console.log("[debug] after the offline reload:", wordD, JSON.stringify(bannerD));
  ok(`the pill reads "Saved on this phone · ${qD.length} to send" (unattached: the token was in memory)`,
     wordD === `Saved on this phone · ${qD.length} to send`, wordD);
  ok("the banner says so, in one sentence and with no action",
     bannerD?.reason === "offline" && bannerD.text === `No signal. ${qD.length} balls are saved on this device and will send when there is a connection.`
       && !(await tid("sync-signin").count()) && !(await tid("sync-retry").count()),
     JSON.stringify(bannerD));
  ok("the server has none of the three", (await serverRows()).length === padBeforeD.length);

  group("E. The signal returns after the reload: the pad re-attaches and drains");
  await watchPill();
  await ctx.setOffline(false);
  // With its resume credential (SCRBRD-078 option B) the pad re-attaches by
  // itself; without one, the banner's own sign-in is what a scorer presses.
  let sentE = await pillSays(/^Sent$/, 15000);
  let signedInE = false;
  if (!sentE && (await tid("sync-signin").count())) {
    signedInE = true;
    await tid("sync-signin").first().click({ timeout: 4000 });
    await page.waitForTimeout(800);
    await click(/Scorer/, 4000);
    await click(/^Sign In$/, 5000);
    await afterReads(page, 2500);
    await onPad();
    sentE = await pillSays(/^Sent$/, 15000);
  }
  ok("the pill reaches \"Sent\"", sentE, `${await pill()} ${JSON.stringify(await banner())}`);
  ok("...with nobody signing in: the resume credential re-attached it", !signedInE);
  await afterReads(page, 600);
  const seenE = await pillSeen();
  if (DEBUG) console.log("[debug] pill while draining after the reload:", seenE.join(" → "));
  drainChecks("E", seenE, qD.length);
  await drainedChecks("E", qD.map((e) => e.key), D_TAPS);
  ok("no application errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${/** @type {Error} */ (e).message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(/** @type {Error} */ (e).stack?.split("\n").slice(0, 6).join("\n"));
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
console.log(`\n${"─".repeat(52)}\nBROWSER SYNC DROP SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

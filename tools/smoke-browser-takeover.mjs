#!/usr/bin/env node
/**
 * Two phones, a lapsed lease, and a take-over that is a person's act
 * (the match-day audit's B1, P4 and P5; Kameel's decisions of 30 Oct 2026;
 * db/126).
 *
 * The afternoon the audit found: the scorer's phone has sent every ball, a
 * wicket falls, drinks are taken, and its ninety-second lease lapses. The
 * standby scorer, signed in on her own phone, opens the fixture to follow
 * along — and her pad used to claim the match with no word to anybody. The
 * scorer's phone then stopped sending, said another device had taken over,
 * and offered nothing.
 *
 * Now, in two real browser contexts and two real logins:
 *
 *   A  (the scorer) scores two balls with signal; they reach the server.
 *   A  idles: its heartbeat keeps the lease without a ball.
 *   A  goes quiet (no signal — a dead or pocketed phone), and the lease lapses.
 *   B  (the director of sport) opens the fixture: she is SHOWN the server's
 *      last ball and offered "Take over scoring". Nothing is claimed.
 *   A  comes back and scores: accepted, under its own token.
 *   A  goes quiet again. B presses Take over over the generation she was
 *      shown, which A has since moved on from: refused, epoch_moved; "Try
 *      again" shows her the new last ball; she takes over, confirmed. An
 *      audit row says so, with the server's last ball. Her pad says how far
 *      the server got (P4) until she has checked it.
 *   A, still quiet, records a ball; B scores one. A comes back: "another
 *      device has taken over", the ball it kept listed, and "Score on this
 *      device" (P5) — which finds the two logs forked, lists A's ball, writes
 *      A's log aside, and offers to send it to the lead. Sent: A's ball is in
 *      quarantine (never in the log), A's pad shows the server's log, and
 *      A is told B is scoring.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-takeover.mjs
 *   BROWSER_TAKEOVER_DEBUG=1 node tools/smoke-browser-takeover.mjs
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
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(4339);
const API_PORT = port(8883);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_TAKEOVER_DEBUG;
const DB = ownerUrl();
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);
const debug = (...a) => { if (DEBUG) console.log("   ·", ...a); };

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-takeover-secret",
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
  watchReads(page);
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
  await afterReads(page, 2200);
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

async function openPad(who) {
  await who.page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await afterReads(who.page, 1200);
  const opened = await openMichaelhouse(who.page);
  await afterReads(who.page, 2000);
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
const listItems = async (page) => tid(page, "sync-banner-list").locator("li").allInnerTexts().catch(() => []);
const pill = async (page) => {
  const l = page.locator('[aria-label^="Sync status:"]').first();
  if (!(await l.count())) return "";
  const label = (await l.getAttribute("aria-label", { timeout: 1000 }).catch(() => "")) || "";
  return (label.match(/^Sync status: ([^.]*)\./)?.[1] ?? "").trim();
};
const board = async (page) => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent({ timeout: 1500 }).catch(() => "")) || "").trim();
/** The events still queued on a phone, in order: the outbox's `evt:` rows. */
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
/** The pad's set-aside logs (persist.js saveAside), from its kv store. */
const asides = (page) => page.evaluate((m) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    const db = req.result;
    const os = db.transaction("kv", "readonly").objectStore("kv");
    const k = os.getAllKeys(), v = os.getAll();
    v.onsuccess = () => {
      const out = [];
      k.result.forEach((key, i) => { if (String(key).startsWith(`aside:${m}:`)) out.push(v.result[i]); });
      db.close();
      resolve(out);
    };
    v.onerror = () => { db.close(); resolve(null); };
  };
}), MATCH);

const serverLog = () => dbq(`select idempotency_key as id, kind, device_id, epoch, seq from ball_event where match_id = $1 order by seq`, [MATCH]);
const balls = async () => (await serverLog()).filter((r) => r.kind === "ball");
const quarantine = () => dbq(`select idempotency_key as id, resolution from ball_event_quarantine where match_id = $1`, [MATCH]);
const sessionRow = async () => (await dbq(`select state, epoch, holder_user_id, holder_device, lease_until from scoring_session where match_id = $1`, [MATCH]))[0];
const lapse = () => dbq(`update scoring_session set lease_until = now() - interval '1 minute' where match_id = $1`, [MATCH]);
/** The server's last ball, as a scorer's clock in Johannesburg reads it. */
const lastBallClock = async () => {
  const r = (await dbq(`select to_char(server_ts AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') as hm, seq from ball_event
                         where match_id = $1 and kind = 'ball' order by seq desc limit 1`, [MATCH]))[0];
  return r?.hm ?? null;
};
const figures = async () => (await dbq(
  `select coalesce(sum(case when ball_type in ('run','W','Nb') then coalesce(value,0) else 0 end),0)::int r,
          coalesce(sum(case when ball_type='W' then 1 else 0 end),0)::int w,
          coalesce(sum(case when kind='ball' and ball_type not in ('Wd','Nb') then 1 else 0 end),0)::int b
     from ball_event_live where match_id = $1`, [MATCH]))[0];

let A, B;
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1
             on conflict (match_id) do nothing`, [MATCH]);
  const [scorer] = await dbq(`select id from app_user where email = 'scorer@example.invalid'`);
  const [director] = await dbq(`select id from app_user where email = 'sarah@example.invalid'`);

  group("A scores two balls with signal; they reach the server");
  A = await openAs(/Scorer/);
  ok("the scorer signs in", /Match Centre|Dashboard/i.test(await A.text()));
  ok("opened the real fixture", await openPad(A));
  await clearBlockers(A.page);
  let tapped = 0;
  for (const face of ["1", "4", "1", "1", "1", "1"]) {
    if ((await balls()).length >= 2) break;
    if (await tapFace(A.page, face)) tapped++;
    await until(A.page, async () => (await balls()).length >= Math.min(2, tapped), 4000);
  }
  ok("exactly two balls reach the server", await until(A.page, async () => (await balls()).length === 2, 12000), (await serverLog()).map((r) => r.kind).join(","));
  const deviceA = await A.page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  const s0 = await sessionRow();
  ok("A holds the token", s0?.state === "active" && s0?.holder_device === deviceA, JSON.stringify(s0));

  group("A idles: its heartbeat keeps the lease without a ball (B1)");
  // Thirty seconds left on the lease, and nothing to send: only a heartbeat
  // can push it on. On main nothing did, and the lease lapsed ninety seconds
  // after the last ball whatever the phone was doing.
  await dbq(`update scoring_session set lease_until = now() + interval '30 seconds' where match_id = $1`, [MATCH]);
  const nBefore = (await serverLog()).length;
  const beat = await until(A.page, async () => {
    const s = await sessionRow();
    return s && new Date(s.lease_until).getTime() - Date.now() > 60000;
  }, 45000, 1000);
  ok("the lease is pushed on by a heartbeat, with no ball sent", beat && (await serverLog()).length === nBefore, JSON.stringify(await sessionRow()));
  const s1 = await sessionRow();
  ok("...under the same generation, held by A", s1?.epoch === s0.epoch && s1?.holder_device === deviceA, JSON.stringify(s1));

  group("A goes quiet and its lease lapses; B opens the fixture");
  await A.ctx.setOffline(true);
  ok("A has no signal", await until(A.page, async () => (await A.page.evaluate(() => navigator.onLine)) === false, 5000));
  await lapse();
  const lapsed = await sessionRow();
  B = await openAs(/Director of Sport/);
  ok("the director of sport signs in", /Match Centre|Dashboard/i.test(await B.text()));
  ok("opened the same fixture", await openPad(B));
  ok("B is told another phone was scoring, not given the match",
     await until(B.page, async () => (await banner(B.page)).reason === "held_elsewhere", 15000), JSON.stringify(await banner(B.page)));
  const sB = await sessionRow();
  ok("nothing was claimed: the token is still A's, the same generation",
     sB?.holder_device === deviceA && sB?.epoch === lapsed.epoch && sB?.holder_user_id === scorer.id, JSON.stringify({ sB, lapsed }));
  const hm1 = await lastBallClock();
  const bn1 = await banner(B.page);
  ok("...shown the time of the server's last ball", !!hm1 && bn1.text.includes(hm1), `${hm1} | ${bn1.text}`);
  ok("...and offered Take over scoring, a choice she confirms", (await tid(B.page, "sync-confirm-takeover").count()) === 1, bn1.text);
  ok("...not Try again, and not Sent", (await tid(B.page, "sync-retry").count()) === 0 && !/^Sent$/.test(await pill(B.page)), await pill(B.page));
  const deviceB = await B.page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  ok("B is a different phone", !!deviceB && deviceB !== deviceA);
  ok("no take-over is in the audit", (await dbq(`select 1 from scoring_audit where match_id = $1 and event = 'takeover'`, [MATCH])).length === 0);

  group("A comes back and scores: accepted, under its own token");
  await A.ctx.setOffline(false);
  ok("A has signal", await until(A.page, async () => (await A.page.evaluate(() => navigator.onLine)) === true, 5000));
  ok("A taps a ball", await tapFace(A.page, "2"));
  ok("it reaches the server: ball three", await until(A.page, async () => (await balls()).length === 3, 15000), (await balls()).length);
  const sA = await sessionRow();
  ok("...A took back its own lapsed token (its generation, its phone)", sA?.holder_device === deviceA && sA?.epoch === lapsed.epoch + 1, JSON.stringify(sA));
  ok("...and the ball is A's", (await balls()).at(-1)?.device_id === deviceA);

  group("A goes quiet again; B confirms a take-over over a generation that has moved");
  await A.ctx.setOffline(true);
  ok("A has no signal again", await until(A.page, async () => (await A.page.evaluate(() => navigator.onLine)) === false, 5000));
  await lapse();
  await tid(B.page, "sync-confirm-takeover").click({ timeout: 3000 });
  ok("Take over over the generation B was shown, which A has since moved on: refused",
     await until(B.page, async () => (await banner(B.page)).reason === "epoch_moved", 10000), JSON.stringify(await banner(B.page)));
  ok("...nothing taken", (await sessionRow())?.holder_device === deviceA);
  ok("...and Try again is offered", (await tid(B.page, "sync-retry").count()) === 1);
  await tid(B.page, "sync-retry").click({ timeout: 3000 });
  ok("Try again: shown where it stands now", await until(B.page, async () => (await banner(B.page)).reason === "held_elsewhere", 12000), JSON.stringify(await banner(B.page)));
  const hm2 = await lastBallClock();
  ok("...with the server's last ball", !!hm2 && (await banner(B.page)).text.includes(hm2), (await banner(B.page)).text);
  ok("...and still nothing taken", (await sessionRow())?.holder_device === deviceA);
  const seqAtTakeover = (await serverLog()).at(-1)?.seq;
  await tid(B.page, "sync-confirm-takeover").click({ timeout: 3000 });
  ok("Take over, confirmed: B holds the token", await until(B.page, async () => (await sessionRow())?.holder_device === deviceB, 10000), JSON.stringify(await sessionRow()));
  const sT = await sessionRow();
  ok("...the director of sport, under the next generation", sT?.holder_user_id === director.id && sT?.epoch === sA.epoch + 1, JSON.stringify(sT));
  const audit = await dbq(`select actor_id, from_user, to_user, epoch, detail from scoring_audit where match_id = $1 and event = 'takeover'`, [MATCH]);
  ok("one take-over in the audit: from the scorer to the director", audit.length === 1 && audit[0].from_user === scorer.id && audit[0].to_user === director.id
     && audit[0].actor_id === director.id && audit[0].epoch === sT.epoch, JSON.stringify(audit));
  ok("...naming the phone it was taken from and the server's last ball", audit[0]?.detail?.from_device === deviceA
     && Number(audit[0]?.detail?.last_seq) === seqAtTakeover && !!audit[0]?.detail?.last_ball_at, JSON.stringify(audit[0]?.detail));

  group("B, the incoming scorer, is told how far the server got (P4)");
  ok("B's pad says she is scoring, and the time of the server's last ball",
     await until(B.page, async () => (await banner(B.page)).reason === "takeover_note", 10000), JSON.stringify(await banner(B.page)));
  const note = await banner(B.page);
  ok("...\"The server's last ball came in at\" the time, to check against the scoreboard and the book",
     note.text.includes(hm2) && /scoreboard and the book/.test(note.text), note.text);
  ok("...Checked puts it away", await (async () => { await tid(B.page, "sync-note-checked").click({ timeout: 3000 }); return until(B.page, async () => (await banner(B.page)).reason === null, 5000); })(),
     JSON.stringify(await banner(B.page)));
  ok("B's pill says Sent", await until(B.page, async () => (await pill(B.page)) === "Sent", 8000), await pill(B.page));

  group("A, quiet, keeps a ball; B scores one; A comes back (P5)");
  ok("A taps a ball with no signal", await tapFace(A.page, "1"));
  await A.page.waitForTimeout(600);
  const kept = (await queued(A.page)) ?? [];
  ok("...queued on A", kept.length === 1, JSON.stringify(kept));
  ok("B scores a ball", await tapFace(B.page, "4"));
  ok("...it reaches the server, from B", await until(B.page, async () => (await balls()).length === 4 && (await balls()).at(-1)?.device_id === deviceB, 10000));
  await A.ctx.setOffline(false);
  ok("A is told another device has taken over",
     await until(A.page, async () => (await banner(A.page)).reason === "token_moved", 30000), JSON.stringify(await banner(A.page)));
  const tm = await banner(A.page);
  ok("...that nothing more is sent from there, its ball saved", /Nothing more is sent from here/.test(tm.text) && /1 ball is saved on this device/.test(tm.text), tm.text);
  const tmList = await listItems(A.page);
  ok("...the ball it kept, listed in words", tmList.length === 1 && /^Ball — 1 run/.test(tmList[0]), JSON.stringify(tmList));
  ok("...and an action: Score on this device", (await tid(A.page, "sync-score-here").count()) === 1, tm.text);
  ok("A's ball is on A, not on the server, not in quarantine", (await queued(A.page))?.length === 1
     && !(await serverLog()).some((r) => r.id === kept[0]?.id) && (await quarantine()).length === 0);

  group("Score on this device: the logs have forked; A's ball goes to the lead");
  await tid(A.page, "sync-score-here").click({ timeout: 3000 });
  ok("A is told the match was scored on another device", await until(A.page, async () => (await banner(A.page)).reason === "fork", 15000), JSON.stringify(await banner(A.page)));
  const fk = await banner(A.page);
  const fkList = await listItems(A.page);
  ok("...its ball the server lacks, listed", fkList.length === 1 && /^Ball — 1 run/.test(fkList[0]), JSON.stringify(fkList));
  const kept2 = (await asides(A.page)) ?? [];
  ok("...A's log written aside on the phone, naming that ball", kept2.length >= 1 && kept2.some((x) => x.reason === "fork" && x.notOnServer?.includes(kept[0]?.id)), JSON.stringify(kept2.map((x) => x.notOnServer)));
  ok("...and the action: Send them to the lead", (await tid(A.page, "sync-settle-fork").count()) === 1, fk.text);
  ok("nothing was claimed by A", (await sessionRow())?.holder_device === deviceB);
  await tid(A.page, "sync-settle-fork").click({ timeout: 3000 });
  ok("A's ball is in quarantine, for the lead", await until(A.page, async () => (await quarantine()).some((q) => q.id === kept[0]?.id), 15000), JSON.stringify(await quarantine()));
  ok("...never in the log", !(await serverLog()).some((r) => r.id === kept[0]?.id));
  ok("...and A's queue is empty", await until(A.page, async () => ((await queued(A.page)) ?? []).length === 0, 8000), JSON.stringify(await queued(A.page)));
  const figs = await figures();
  const want = `${figs.r} for ${figs.w}, ${Math.floor(figs.b / 6)}.${figs.b % 6} overs`;
  ok("A's pad now shows the server's log", await until(A.page, async () => (await board(A.page)) === want, 10000), `${await board(A.page)} v ${want}`);
  ok("...and says B is scoring, with Try again (nothing silent)",
     await until(A.page, async () => (await banner(A.page)).reason === "lease_active", 12000) && (await tid(A.page, "sync-retry").count()) === 1,
     JSON.stringify(await banner(A.page)));
  ok("the token is still B's", (await sessionRow())?.holder_device === deviceB);
  ok("A's pill says the ball is for review", (await pill(A.page)) === "For review 1", await pill(A.page));
  debug("A pill:", await pill(A.page), "| B pill:", await pill(B.page));

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
console.log(`\n${"─".repeat(52)}\nBROWSER TAKEOVER SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * The handover, from two phones (SCRBRD-056).
 *
 * The protocol (arm → code → claim → verify → transfer) has had a full
 * backend and a passing API-level walk since before this file existed
 * (services/api/handover/scoring-session.test.mjs). What it never had was a
 * screen — nothing in apps/web called armHandover or claimHandover — so this
 * is the one that proves a SCORER can do it: two real browser contexts,
 * two real logins, one real fixture, the code read off one screen and typed
 * into the other, checked against a real replay in Postgres rather than a
 * mock.
 *
 * The sharpest assertion here is the one the spec calls the whole point of
 * the handshake: a wrong confirmation is REFUSED with a field-level diff,
 * and only a correct one transfers the token. A screen that let the second
 * device in on any answer would be decoration, not the check
 * SCORING_HANDOVER_SPEC.md describes.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-handover.mjs
 *   BROWSER_HANDOVER_DEBUG=1 node tools/smoke-browser-handover.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 4327;
const API_PORT = 8796;
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_HANDOVER_DEBUG;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-handover-secret",
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

/** One signed-in tab, its own cookie jar, its own console-error trap. */
async function openAs(label) {
  const ctx = await browser.newContext();
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource/.test(t)) return;
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
  // Same sequence and timing as smoke-browser-sync.mjs's proven-working
  // login: the 600ms after "Get Started" is the pilot-accounts panel
  // finishing its own mount, not a magic number.
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(label, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  return { ctx, page, errors, text: () => page.$eval("body", (el) => el.innerText) };
}

/** Clear whatever the pad is asking for before it will take a delivery — same shape as smoke-browser-sync.mjs. */
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

const MATCH = "77777777-0000-0000-0000-000000000002";

/** The pad's log as persist.js saved it (`scrbrd` → `kv` → match:<id>), every innings, in order. */
const padLog = (page) => page.evaluate((key) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    const db = req.result;
    const g = db.transaction("kv", "readonly").objectStore("kv").get(key);
    g.onsuccess = () => { db.close(); resolve((g.result?.events ?? []).flat()); };
    g.onerror = () => { db.close(); resolve(null); };
  };
}), `match:${MATCH}`);
/** The server's log, by key and kind, in seq order. */
const serverLog = async () => dbq(`select idempotency_key as id, kind, device_id from ball_event where match_id = $1 order by seq`, [MATCH]);
/** The pad's board, as the screen reader hears it: "6 for 0, 0.3 overs". */
const board = async (page) => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent({ timeout: 1500 }).catch(() => "")) || "").trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

let outgoing, incoming, third;
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  // SCRBRD-067: the pad opens a live fixture's first innings from the toss
  // the server has, and asks for one when there is none. This walk has always
  // had the home side batting first, so that is the toss it records.
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = '77777777-0000-0000-0000-000000000002'
             on conflict (match_id) do nothing`);

  group("Outgoing device: the scorer opens and plays a few balls");
  outgoing = await openAs(/Scorer/);
  ok("the scorer signs in", /Match Centre|Dashboard/i.test(await outgoing.text()));
  await outgoing.page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await outgoing.page.waitForTimeout(1200);
  ok("opened the real fixture", await openMichaelhouse(outgoing.page));
  await outgoing.page.waitForTimeout(2000);
  await clearBlockers(outgoing.page);
  if (!(await outgoing.page.locator('[data-testid="basic-pad"]').count())) { await outgoing.page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).catch(() => {}); await outgoing.page.locator('[data-testid="pad-basic-scoring"]').click({ timeout: 2500 }).catch(() => {}); }
  await outgoing.page.waitForTimeout(400);
  ok("the pad is open", /\bDOT\b/i.test(await outgoing.text()));

  let scored = 0;
  for (const face of ["1", "4", "1"]) {
    await clearBlockers(outgoing.page);
    const btn = outgoing.page.locator("button:not([disabled])", { hasText: new RegExp(`^${face}$`) }).first();
    if (await btn.count()) { await btn.click({ timeout: 2500 }).catch(() => {}); scored++; }
    await outgoing.page.waitForTimeout(500);
  }
  await clearBlockers(outgoing.page);
  ok(`tapped ${scored} deliveries to hand over something real`, scored >= 2);
  await outgoing.page.waitForTimeout(3000); // let the outbox flush

  // The cancel is the arming device's own claim, and a claim bumps the
  // epoch. The pad used to go on under the old one: every ball after a
  // cancelled handover went to quarantine, and the pill said "Sent".
  group("A handover armed and cancelled: the pad goes on under the token the cancel took");
  await outgoing.page.locator('[data-testid="open-handover"]').first().click({ timeout: 3000 });
  await outgoing.page.waitForTimeout(300);
  await outgoing.page.locator('[data-testid="handover-arm"]').click({ timeout: 3000 }).catch(() => {});
  // Waited for, not slept on: under load the arm and the cancel each take a round trip.
  const sessionRow = async () => (await dbq(`select state, epoch from scoring_session where match_id = $1`, [MATCH]))[0];
  const waitFor = async (pred) => { for (let t = 0; t < 40; t++) { const r = await sessionRow(); if (pred(r)) return r; await outgoing.page.waitForTimeout(250); } return sessionRow(); };
  await outgoing.page.locator('[data-testid="handover-code"]').waitFor({ timeout: 8000 }).catch(() => {});
  const armed = await waitFor((r) => r?.state === "handover_pending");
  ok("armed", armed?.state === "handover_pending", JSON.stringify(armed));
  await outgoing.page.locator('[data-testid="handover-cancel"]').click({ timeout: 5000 }).catch(() => {});
  const back = await waitFor((r) => r?.state === "active" && r?.epoch === armed?.epoch + 1);
  await outgoing.page.waitForTimeout(800);
  ok("the cancel took the token back, under the next generation", back?.state === "active" && back?.epoch === armed?.epoch + 1, JSON.stringify(back));
  const n0 = (await serverLog()).length;
  await clearBlockers(outgoing.page);
  const next = outgoing.page.locator("button:not([disabled])", { hasText: /^1$/ }).first();
  if (await next.count()) await next.click({ timeout: 2500 }).catch(() => {});
  await outgoing.page.waitForTimeout(3000);
  const afterCancel = await dbq(`select epoch from ball_event where match_id = $1 order by seq`, [MATCH]);
  ok("the next ball reaches the log", afterCancel.length === n0 + 1, `${afterCancel.length} v ${n0 + 1}`);
  ok("...under the generation the cancel took", afterCancel.at(-1)?.epoch === back?.epoch, JSON.stringify(afterCancel.at(-1)));
  ok("...and nothing went to quarantine", (await dbq(`select 1 from ball_event_quarantine where match_id = $1`, [MATCH])).length === 0);

  const before = (await dbq(
    `select coalesce(sum(case when ball_type in ('run','W','Nb') then coalesce(value,0) else 0 end),0)::int r,
            coalesce(sum(case when ball_type='W' then 1 else 0 end),0)::int w,
            coalesce(sum(case when kind='ball' and ball_type not in ('Wd','Nb') then 1 else 0 end),0)::int b
       from ball_event_live where match_id = '77777777-0000-0000-0000-000000000002'`))[0];
  ok("the outgoing device's balls reached Postgres", before.r > 0 || before.b > 0, JSON.stringify(before));

  group("Arming the handover");
  await outgoing.page.locator('[data-testid="open-handover"]').first().click({ timeout: 3000 });
  await outgoing.page.waitForTimeout(300);
  ok("the sheet opens on Hand over", /Hand over scoring|Issues a six-digit code/.test(await outgoing.text()));
  await outgoing.page.locator('[data-testid="handover-arm"]').click({ timeout: 3000 }).catch(() => {});
  await outgoing.page.waitForTimeout(500);
  const code = await outgoing.page.locator('[data-testid="handover-code"]').innerText().catch(() => "");
  ok("a six-digit code is shown", /^\d{6}$/.test(code.trim()), code);
  ok("...and never carried in the page URL", !outgoing.page.url().includes(code.trim()));

  const session = (await dbq(`select state, handover_code, epoch from scoring_session where match_id = '77777777-0000-0000-0000-000000000002'`))[0];
  ok("the server agrees a handover is pending", session?.state === "handover_pending");
  ok("...with the same code the screen showed", session?.handover_code === code.trim());
  outgoing.page.locator('[data-testid="handover-cancel"]'); // keep locator warm; not used here

  group("Incoming device: opens the same match cold");
  incoming = await openAs(/Director of Sport/);
  ok("the director of sport signs in", /Match Centre|Dashboard/i.test(await incoming.text()));
  await incoming.page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await incoming.page.waitForTimeout(1200);
  ok("opened the same fixture", await openMichaelhouse(incoming.page));
  await incoming.page.waitForTimeout(2000);

  ok("her own claim did not silently take the token", (await dbq(
    `select state from scoring_session where match_id = '77777777-0000-0000-0000-000000000002'`))[0]?.state === "handover_pending");
  ok("...and the screen offers Take over rather than the ordinary pad chrome",
     /Take over/i.test(await incoming.text()));

  await incoming.page.locator('[data-testid="open-handover"]').first().click({ timeout: 3000 });
  await incoming.page.waitForTimeout(300);
  ok("her sheet opens straight on Take over", await incoming.page.locator('[data-testid="handover-code-entry"]').count() === 1);

  await incoming.page.fill('[data-testid="handover-code-entry"]', code.trim());
  await incoming.page.locator('[data-testid="handover-claim"]').click({ timeout: 3000 });
  await incoming.page.waitForTimeout(500);
  ok("claiming with the right code moves to verification",
     await incoming.page.locator('[data-testid="handover-verify-runs"]').count() === 1);

  group("A wrong confirmation is refused, with a diff");
  await incoming.page.fill('[data-testid="handover-verify-runs"]', String(before.r + 7));
  await incoming.page.fill('[data-testid="handover-verify-wickets"]', String(before.w));
  await incoming.page.fill('[data-testid="handover-verify-overs"]', String(Math.floor(before.b / 6)));
  await incoming.page.fill('[data-testid="handover-verify-balls"]', String(before.b % 6));
  await incoming.page.locator('[data-testid="handover-verify-confirm"]').click({ timeout: 3000 });
  await incoming.page.waitForTimeout(500);
  const mismatch = await incoming.page.locator('[data-testid="handover-verify-mismatch"]').innerText().catch(() => "");
  ok("a wrong runs figure is refused before anything transfers", /doesn't match/i.test(mismatch));
  ok("...naming what was expected, not just that it failed", new RegExp(String(before.r)).test(mismatch));
  ok("...and the token has NOT moved", (await dbq(
    `select state from scoring_session where match_id = '77777777-0000-0000-0000-000000000002'`))[0]?.state === "verifying");

  group("The right confirmation transfers it");
  await incoming.page.fill('[data-testid="handover-verify-runs"]', String(before.r));
  await incoming.page.locator('[data-testid="handover-verify-confirm"]').click({ timeout: 3000 });
  await incoming.page.waitForTimeout(800);

  const after = (await dbq(`select state, epoch, holder_user_id from scoring_session where match_id = '77777777-0000-0000-0000-000000000002'`))[0];
  ok("the session is active again", after?.state === "active");
  ok("...under a new epoch", after?.epoch === session.epoch + 1);
  const [directorId] = await dbq(`select id from app_user where email = 'sarah@example.invalid'`);
  ok("...held by the incoming scorer, not the outgoing one", after?.holder_user_id === directorId?.id);
  ok("the verify screen closed on success", await incoming.page.locator('[data-testid="handover-verify-confirm"]').count() === 0);

  group("The outgoing device finds out");
  // Its own poll runs every 2.5s; give it two ticks.
  await outgoing.page.waitForTimeout(6000);
  ok("it reports having handed over, not an error",
     /Handed over/i.test(await outgoing.text()));
  ok("...and no longer offers a handover button of its own — there is nothing left to hand over",
     await outgoing.page.locator('[data-testid="open-handover"]').count() === 0);

  // SCRBRD-075. The incoming device opened this fixture with nothing saved,
  // so it used to write a first-innings innings_start of its own, under a new
  // id, and after the takeover send it: the server's log gained a second
  // start, and the pad's board was 0/0 with nobody in while the server's was
  // the outgoing scorer's innings. The spec (§4 step 2): the incoming device
  // takes the server's log and rebuilds from it.
  group("The incoming device scores on from the server's log — never one of its own (SCRBRD-075)");
  const outgoingDevice = await outgoing.page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  const incomingDevice = await incoming.page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  const s0 = await serverLog();
  const starts0 = s0.filter((r) => r.kind === "innings_start");
  ok("the server's log has one innings_start, the outgoing device's",
     starts0.length === 1 && starts0[0].device_id === outgoingDevice, JSON.stringify(starts0));
  ok("...and nothing from the incoming device yet", !s0.some((r) => r.device_id === incomingDevice),
     JSON.stringify(s0.filter((r) => r.device_id === incomingDevice)));
  const p0 = await padLog(incoming.page);
  ok("the incoming pad's saved log is the server's log, id for id",
     same((p0 ?? []).map((e) => e?.id), s0.map((r) => r.id)), `${p0?.length} v ${s0.length}`);
  ok("...with no innings_start it minted itself",
     (p0 ?? []).filter((e) => e?.kind === "innings_start").every((e) => starts0.some((r) => r.id === e.id)));
  const wantBoard = `${before.r} for ${before.w}, ${Math.floor(before.b / 6)}.${before.b % 6} overs`;
  ok("its board is the server's score", (await board(incoming.page)) === wantBoard, `${await board(incoming.page)} v ${wantBoard}`);

  await clearBlockers(incoming.page);
  if (!(await incoming.page.locator('[data-testid="basic-pad"]').count())) { await incoming.page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).catch(() => {}); await incoming.page.locator('[data-testid="pad-basic-scoring"]').click({ timeout: 2500 }).catch(() => {}); }
  await incoming.page.waitForTimeout(400);
  const one = incoming.page.locator("button:not([disabled])", { hasText: /^1$/ }).first();
  const tapped = (await one.count()) > 0 && await one.click({ timeout: 2500 }).then(() => true, () => false);
  await incoming.page.waitForTimeout(3000);
  ok("the incoming scorer taps a ball", tapped);
  const s1 = await serverLog();
  const p1 = await padLog(incoming.page);
  ok("...and it reaches the server", s1.length === s0.length + 1 && s1.at(-1)?.device_id === incomingDevice,
     `${s1.length} v ${s0.length + 1}`);
  ok("the server's log and the incoming pad's are the same, id for id",
     same((p1 ?? []).map((e) => e?.id), s1.map((r) => r.id)), `${p1?.length} v ${s1.length}`);
  ok("...still one innings_start", s1.filter((r) => r.kind === "innings_start").length === 1);

  // The same rule without a handover: a device opening, for the first time,
  // a fixture somebody else is scoring. The server has a log, so the pad
  // replays it — and since the director holds a live lease, it sends nothing
  // and says why.
  group("A device that has never opened this fixture replays what the server has (SCRBRD-075)");
  third = await openAs(/Head Coach/);
  ok("the coach signs in", /Match Centre|Dashboard/i.test(await third.text()));
  await third.page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await third.page.waitForTimeout(1200);
  ok("opens the same fixture", await openMichaelhouse(third.page));
  await third.page.waitForTimeout(3000);
  const s2 = await serverLog();
  const p2 = await padLog(third.page);
  ok("its pad's log is the server's log, id for id", same((p2 ?? []).map((e) => e?.id), s2.map((r) => r.id)), `${p2?.length} v ${s2.length}`);
  ok("...no innings_start of its own", !(p2 ?? []).some((e) => e?.kind === "innings_start" && !s2.some((r) => r.id === e.id)));
  ok("...and the server's log did not move", same(s2, s1));
  ok("it says in words that someone else is scoring", /Someone else is scoring this match/i.test(await third.text()));

  ok("no console errors on any device",
     outgoing.errors.length === 0 && incoming.errors.length === 0 && third.errors.length === 0,
     [...outgoing.errors, ...incoming.errors, ...third.errors].slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 140)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await outgoing?.ctx.close().catch(() => {});
  await incoming?.ctx.close().catch(() => {});
  await third?.ctx.close().catch(() => {});
  await browser.close();
  web.close();
  api.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 10).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER HANDOVER SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

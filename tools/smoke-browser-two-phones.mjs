#!/usr/bin/env node
/**
 * Two phones scoring one match: the second account is proven to arrive, and
 * both scorers are told (docs/design/TWO_PHONES.md, slice 1; S1, R1, R3;
 * Kameel, 5 Nov 2026: "All seven as recommended").
 *
 * In two real browser contexts and two real logins:
 *
 *   A  (the scorer) holds the pen and scores to 8.2 with signal.
 *   A  loses signal and keeps scoring, 8.3 to 12.0, into his own log; the
 *      lease lapses.
 *   B  (the director of sport) opens the fixture, is shown the server's last
 *      ball, and confirms Take over scoring. She scores 8.3 to 12.0.
 *   A  comes back. "Score on this device" finds the two logs forked, and A's
 *      pad shows the sheet in R3's words with the right count: 22 balls on
 *      this phone are not in the match record. Send for review: every one of
 *      A's events is set aside as stale_epoch_or_lease, none reaches the log
 *      after the take-over, match_live_score is B's fold, and the sheet says
 *      they are sent.
 *   B  at her next sync: "Your scoring stands · 22 balls from another phone
 *      set aside for review", with a tap to the same words.
 *   The notices (db/135): one to A, one to the office (fixture.update), one
 *      to the approvers (scoring.amend.approve), fixture by its sides, no
 *      player named.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-two-phones.mjs
 *   BROWSER_TWO_PHONES_DEBUG=1 node tools/smoke-browser-two-phones.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { deriveInnings, fromRow } from "@scrbrd/scoring";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(4361);
const API_PORT = port(8907);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_TWO_PHONES_DEBUG;
const DB = ownerUrl();
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const FACES = ["1", "2", "1", "4", "1", "2"];
const TITLE = "Second account set aside · Hilton College 1XI v Michaelhouse";
const BODY = "Balls from a second phone were set aside for review, not added to the scorecard.";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);
const debug = (...a) => { if (DEBUG) console.log("   ·", ...a); };

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-two-phones-secret",
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
  // What the server answered each send from this phone, for the reasons it gave.
  const sends = [];
  page.on("response", async (r) => {
    if (r.request().method() !== "POST" || !/\/api\/matches\/[^/]+\/events$/.test(new URL(r.url()).pathname)) return;
    try { sends.push(await r.json()); } catch { /* no body */ }
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
  return { ctx, page, errors, sends, typed: 0, text: () => page.$eval("body", (el) => el.innerText).catch(() => "") };
}

/** The bowlers typed in, in turn: Michaelhouse is not on SCRBRD, so its bowlers are typed names. */
const BOWLERS = ["A Nel", "T Mokoena"];

/** Clear whatever the pad is asking for before it will take a delivery. */
async function clearBlockers(who) {
  const page = who.page;
  for (let i = 0; i < 12; i++) {
    const body = await page.$eval("body", (el) => el.innerText).catch(() => "");
    if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
      // Anyone the Laws let bowl, from the list; else the next name, typed.
      const choice = page.locator('[data-testid="bowler-choice"]:not([disabled])').first();
      if (await choice.count()) { try { await choice.click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
      const field = page.locator("input[aria-label='Bowler name']").last();
      if (await field.count()) {
        try {
          await field.fill(BOWLERS[who.typed % BOWLERS.length]);
          who.typed++;
          await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 1500 });
        } catch { /* fall through */ }
        await page.waitForTimeout(600);
        continue;
      }
    }
    const nextBat = page.locator("button:not([disabled])", { hasText: /\bNEXT\b/i });
    if (await nextBat.count()) { try { await nextBat.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    if (/Available to Bat|Batting Order/i.test(body)) {
      const pick = page.locator("button:not([disabled])", { hasText: /^\s*\d+\s*\n?\s*[A-Z]/ }).first();
      if (await pick.count()) { try { await pick.click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
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
async function tapFace(who, face) {
  const page = who.page;
  await clearBlockers(who);
  if (!(await page.locator('[data-testid="basic-pad"]').count())) {
    await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).catch(() => {});
    await page.locator('[data-testid="pad-basic-scoring"]').click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const btn = page.locator("button:not([disabled])", { hasText: new RegExp(`^${face}$`) }).first();
  if (!(await btn.count())) return false;
  try { await btn.click({ timeout: 2500 }); } catch { return false; }
  await page.waitForTimeout(350);
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
const board = async (page) => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent({ timeout: 1500 }).catch(() => "")) || "").trim();
/** The pad's legal balls, from its board ("… for 0, 8.2 overs"). */
const padBalls = async (page) => {
  const m = (await board(page)).match(/, (\d+)\.(\d) overs/);
  return m ? Number(m[1]) * 6 + Number(m[2]) : null;
};
/** Score faces until the pad's board reads `target` legal balls. */
async function scoreTo(who, target) {
  let i = 0;
  for (let guard = 0; guard < 160; guard++) {
    const now = await padBalls(who.page);
    if (now != null && now >= target) {
      // The over is done and the pad asks who bowls the next: not yet.
      if (await who.page.locator('[role="dialog"]').count()) { await who.page.keyboard.press("Escape"); await who.page.waitForTimeout(400); }
      return now;
    }
    await tapFace(who, FACES[i++ % FACES.length]);
  }
  return padBalls(who.page);
}

const serverLog = () => dbq(`select idempotency_key as id, kind, device_id, epoch, seq from ball_event where match_id = $1 order by seq`, [MATCH]);
const legal = async () => (await dbq(
  `select count(*)::int n from ball_event_live where match_id = $1 and kind = 'ball' and coalesce(ball_type,'run') not in ('Wd','Nb')`, [MATCH]))[0].n;
const quarantine = () => dbq(`select idempotency_key as id, device_id, submitted_epoch, current_epoch, resolved_at, body->'payload'->>'kind' as kind
                                from ball_event_quarantine where match_id = $1 order by id`, [MATCH]);
const sessionRow = async () => (await dbq(`select state, epoch, holder_user_id, holder_device, lease_until from scoring_session where match_id = $1`, [MATCH]))[0];
const lapse = () => dbq(`update scoring_session set lease_until = now() - interval '1 minute' where match_id = $1`, [MATCH]);

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

  group("A holds the pen and scores to 8.2 with signal");
  A = await openAs(/Scorer/);
  ok("the scorer signs in", /Match Centre|Dashboard/i.test(await A.text()));
  ok("opened the real fixture", await openPad(A));
  await clearBlockers(A);
  await scoreTo(A, 50);
  ok("A's board reads 8.2 overs", (await padBalls(A.page)) === 50, await board(A.page));
  ok("all fifty balls reach the server", await until(A.page, async () => (await legal()) === 50, 20000), await legal());
  const deviceA = await A.page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  const sA = await sessionRow();
  ok("A holds the pen", sA?.state === "active" && sA?.holder_device === deviceA && sA?.holder_user_id === scorer.id, JSON.stringify(sA));

  group("A loses signal and keeps scoring, 8.3 to 12.0; the lease lapses");
  await A.ctx.setOffline(true);
  ok("A has no signal", await until(A.page, async () => (await A.page.evaluate(() => navigator.onLine)) === false, 5000));
  await scoreTo(A, 72);
  ok("A's board reads 12.0 overs", (await padBalls(A.page)) === 72, await board(A.page));
  ok("...and the server still has 8.2", (await legal()) === 50, await legal());
  await lapse();

  group("B confirms a take-over and scores 8.3 to 12.0");
  B = await openAs(/Director of Sport/);
  ok("the director of sport signs in", /Match Centre|Dashboard/i.test(await B.text()));
  ok("opened the same fixture", await openPad(B));
  ok("B is told another phone was scoring, and offered Take over scoring",
     await until(B.page, async () => (await banner(B.page)).reason === "held_elsewhere", 15000)
     && (await tid(B.page, "sync-confirm-takeover").count()) === 1, JSON.stringify(await banner(B.page)));
  const deviceB = await B.page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  await tid(B.page, "sync-confirm-takeover").click({ timeout: 3000 });
  ok("Take over, confirmed: B holds the pen", await until(B.page, async () => (await sessionRow())?.holder_device === deviceB, 10000), JSON.stringify(await sessionRow()));
  const [takeover] = await dbq(`select epoch, detail from scoring_audit where match_id = $1 and event = 'takeover'`, [MATCH]);
  const lastSeq = Number(takeover?.detail?.last_seq);
  ok("one take-over in the audit, from A's phone, at the server's last ball",
     takeover?.detail?.from_device === deviceA && Number.isInteger(lastSeq) && lastSeq === (await serverLog()).at(-1)?.seq, JSON.stringify(takeover));
  if ((await banner(B.page)).reason === "takeover_note" || await until(B.page, async () => (await banner(B.page)).reason === "takeover_note", 6000)) {
    await tid(B.page, "sync-note-checked").click({ timeout: 3000 }).catch(() => {});
  }
  ok("B's pad took the server's log: 8.2", await until(B.page, async () => (await padBalls(B.page)) === 50, 8000), await board(B.page));
  await scoreTo(B, 72);
  ok("B's board reads 12.0 overs", (await padBalls(B.page)) === 72, await board(B.page));
  ok("B's balls reach the server: 12.0", await until(B.page, async () => (await legal()) === 72, 20000), await legal());
  ok("no ball is set aside yet", (await quarantine()).length === 0);

  group("A comes back: the logs have forked, and the sheet says so (R3)");
  await A.ctx.setOffline(false);
  ok("A is told another device has taken over",
     await until(A.page, async () => (await banner(A.page)).reason === "token_moved", 30000), JSON.stringify(await banner(A.page)));
  await tid(A.page, "sync-score-here").click({ timeout: 3000 });
  ok("Score on this device: the sheet, not a toast", await until(A.page, async () => (await tid(A.page, "second-account-sheet").count()) === 1, 15000),
     JSON.stringify(await banner(A.page)));
  const sheet = tid(A.page, "second-account-sheet");
  const dialog = A.page.locator('[role="dialog"]').filter({ has: sheet });
  const sheetText = ((await dialog.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  ok("...a dialog", (await dialog.count()) === 1);
  ok("...R3's words, with the right count", sheetText.includes("Another phone scored this match while this one had no signal.")
     && sheetText.includes("22 balls on this phone are not in the match record. They are kept here and set aside on the server for review — nothing was lost, and none of them was added to the score. Someone who approves corrections will compare the two accounts."),
     sheetText);
  ok("...counting 22 balls", (await sheet.getAttribute("data-count")) === "22", await sheet.getAttribute("data-count"));
  ok("...with Send for review and Done", (await tid(A.page, "second-account-send").count()) === 1 && (await tid(A.page, "second-account-done").count()) === 1);
  const names = (await dbq(`select full_name from player where full_name is not null`)).map((r) => r.full_name).filter((n) => n.length > 3);
  ok("...naming no player", !names.some((n) => sheetText.includes(n)), names.find((n) => sheetText.includes(n)));
  // The floors: 44px taps, 12px text.
  const sizes = await dialog.evaluate((el) => ({
    taps: [...el.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().height)),
    fonts: [...el.querySelectorAll("*")].filter((n) => n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()))
      .map((n) => parseFloat(getComputedStyle(n).fontSize)),
  }));
  ok("...every tap 44px or taller", sizes.taps.length > 0 && sizes.taps.every((h) => h >= 44), JSON.stringify(sizes.taps));
  ok("...no text under 12px", sizes.fonts.every((f) => f >= 12), JSON.stringify(sizes.fonts));
  ok("nothing was claimed by A, and nothing set aside before the press", (await sessionRow())?.holder_device === deviceB && (await quarantine()).length === 0);

  group("Send for review: A's balls are set aside, not merged");
  await tid(A.page, "second-account-send").click({ timeout: 3000 });
  ok("A's 22 balls are in quarantine", await until(A.page, async () => (await quarantine()).filter((q) => q.device_id === deviceA && q.kind === "ball").length === 22, 15000),
     JSON.stringify((await quarantine()).length));
  const held = await quarantine();
  const sNow = await sessionRow();
  ok("...every row A's, undecided, under an older generation than the pen's",
     held.length > 0 && held.every((q) => q.device_id === deviceA && q.resolved_at == null && q.submitted_epoch < q.current_epoch && q.current_epoch === sNow.epoch),
     JSON.stringify({ held: held.slice(0, 3), epoch: sNow.epoch }));
  const reasons = A.sends.flatMap((r) => (r?.quarantined ?? []).map((q) => q.reason));
  ok("...each set aside as stale_epoch_or_lease", reasons.length === held.length && reasons.every((r) => r === "stale_epoch_or_lease"), JSON.stringify([...new Set(reasons)]));
  const after = (await serverLog()).filter((r) => r.seq > lastSeq);
  ok("the log holds no row from A after the take-over's last ball", after.length > 0 && !after.some((r) => r.device_id === deviceA),
     JSON.stringify(after.filter((r) => r.device_id === deviceA).slice(0, 2)));
  ok("...nor any row from A under an older generation since", !(await serverLog()).some((r) => r.device_id === deviceA && r.seq > lastSeq && r.epoch < sNow.epoch));
  const rows = await dbq(`select seq, epoch, innings, kind, ball_type, value, shot, contact, trajectory, seg, zone, striker_id, non_striker_id,
                                 bowler_id, dismissed_id, dismissal, idempotency_key, payload, theta, radius, placement_source,
                                 placement_null, close_position, capture_profile
                            from ball_event_live where match_id = $1 and innings = 0 order by seq`, [MATCH]);
  const fold = deriveInnings(rows.map(fromRow), {});
  const [live] = await dbq(`select runs::int, wickets::int, legal_balls::int from match_live_score where match_id = $1 and innings = 0`, [MATCH]);
  const bBoard = await board(B.page);
  ok("match_live_score is B's fold", live && live.runs === fold.runs && live.wickets === fold.wickets && live.legal_balls === fold.balls
     && bBoard.startsWith(`${fold.runs} for ${fold.wickets}, 12.0 overs`), JSON.stringify({ live, fold: [fold.runs, fold.wickets, fold.balls], bBoard }));
  ok("the sheet says they are sent: no Send for review now", await until(A.page, async () => (await sheet.getAttribute("data-sent").catch(() => null)) === "yes"
     && (await tid(A.page, "second-account-send").count()) === 0, 10000), await sheet.getAttribute("data-sent").catch(() => null));
  await tid(A.page, "second-account-done").click({ timeout: 3000 });
  ok("Done puts it away", await until(A.page, async () => (await tid(A.page, "second-account-sheet").count()) === 0, 5000));
  ok("A's pad now shows the server's log", await until(A.page, async () => (await board(A.page)) === bBoard, 10000), `${await board(A.page)} v ${bBoard}`);
  ok("...and the sheet does not come back for the same balls", (await A.page.waitForTimeout(1500), (await tid(A.page, "second-account-sheet").count()) === 0));
  ok("the pen is still B's", (await sessionRow())?.holder_device === deviceB);

  group("B, holding the pen, is told at her next sync (R3)");
  ok("the session badge: Your scoring stands",
     await until(B.page, async () => (await tid(B.page, "pen-stands").count()) === 1, 40000, 1000));
  const line = ((await tid(B.page, "pen-stands").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  ok("...in R3's words, with the count", line === "Your scoring stands · 22 balls from another phone set aside for review", line);
  await tid(B.page, "pen-stands").click({ timeout: 3000 });
  ok("a tap: the same words, of the other phone", await until(B.page, async () => (await tid(B.page, "pen-stands-sheet").count()) === 1, 5000));
  const penText = ((await B.page.locator('[role="dialog"]').innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  ok("...nothing lost, none added, someone will compare", penText.includes("22 balls from it are not in the match record")
     && penText.includes("nothing was lost, and none of them was added to the score") && penText.includes("compare the two accounts"), penText);
  await tid(B.page, "pen-stands-done").click({ timeout: 3000 });
  ok("Done puts it away", await until(B.page, async () => (await tid(B.page, "pen-stands-sheet").count()) === 0, 5000));

  group("The notices (db/135)");
  const notes = await dbq(`select recipient_id, kind, urgency, scope_level, team_code, required_capability, title, body, subject_person_id
                             from notification where subject_kind = 'match' and subject_id = $1 and title like 'Second account set aside%'`, [MATCH]);
  debug(JSON.stringify(notes));
  ok("three notices, once each, however many balls", notes.length === 3, JSON.stringify(notes.map((n) => n.required_capability)));
  ok("...to A alone", notes.some((n) => n.recipient_id === scorer.id && n.required_capability === "news.read"));
  ok("...to the home office", notes.some((n) => n.recipient_id == null && n.required_capability === "fixture.update" && n.team_code == null && n.scope_level === "school"));
  ok("...to the approvers", notes.some((n) => n.recipient_id == null && n.required_capability === "scoring.amend.approve" && n.team_code == null && n.scope_level === "school"));
  ok("...the fixture by its sides, the design's body", notes.every((n) => n.title === TITLE && n.body === BODY), JSON.stringify(notes.map((n) => [n.title, n.body])));
  ok("...medium, so a pupil's quiet hours hold it, about no child", notes.every((n) => n.urgency === "medium" && n.subject_person_id == null));
  ok("...naming no player", !notes.some((n) => names.some((p) => `${n.title} ${n.body}`.includes(p))));

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
console.log(`\n${"─".repeat(52)}\nBROWSER TWO PHONES SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

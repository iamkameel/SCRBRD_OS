#!/usr/bin/env node
/**
 * Rain on the pad (SCRBRD-130 R1: the screen), in a real browser against a
 * real API and Postgres, at a phone's 390 × 844.
 *
 * The engine was built first (the events, the fold, the six refusals, db/73's
 * par clause). This walk is the screen's proof that what the scorer taps
 * reaches the server in the shape the fold reads, and that the pad says what
 * the server says:
 *
 *   A  "Play stopped": one tap and a reason; the banner says where and when,
 *      the ball keys are off, and the server holds a play_stopped row with the
 *      reason and the note;
 *   B  Resume at fewer overs: the sheet refuses an allotment behind the balls
 *      bowled, writes the umpires' revision and then the resumption, and the
 *      board reads "16 overs (revised from 20)";
 *   C  the first innings cut short: stopped again, ended (rain) — sealed
 *      abandoned with its figures — and the innings break opens with the
 *      umpires' figures for the chase, which the chase's innings_start carries;
 *   D  the chase cut short with the umpires' par: revision.par then the seal;
 *      the server's result is decided on the par, in words "(revised target)";
 *   E  nothing on the page names a Law clause; no console error.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-rain.mjs
 *   RAIN_SHOTS=/some/dir node tools/smoke-browser-rain.mjs   # screenshots, both themes
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { fromRow } from "@scrbrd/scoring";
import { EVENT_COLUMNS } from "../services/api/write/events-api.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(5371);
const API_PORT = port(8871);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const SHOTS = process.env.RAIN_SHOTS || null;
const DIST = process.env.RAIN_DIST || "apps/web/dist";
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-rain-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  let body, type;
  try {
    const f = join(DIST, url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = TYPES[extname(f)] ?? "application/octet-stream";
  } catch {
    body = await readFile(join(DIST, "index.html"));
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, r));

const pool = new pg.Pool({ connectionString: DB });
const dbq = async (text, params) => (await pool.query(text, params)).rows;
/** The server's rows for this match, in order, as events. */
const serverEvents = async () => (await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [MATCH])).map(fromRow);

let coachToken = null;
/** The result through the API, as the 1XI coach reads it. */
const apiResult = async () => {
  coachToken ??= (await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "coach@example.invalid", deviceId: "rain-walk-coach" }) })).json())?.token;
  const r = await fetch(`${API}/api/matches/${MATCH}/result`, { headers: { authorization: `Bearer ${coachToken}` } });
  return r.json().catch(() => ({}));
};

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await offline(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
});

const text = () => page.$eval("body", (el) => el.innerText);
const click = async (re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const tap = async (id, ms = 4000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(350); };
const has = async (id) => (await tid(id).count()) > 0;
const said = async (id) => ((await tid(id).first().innerText({ timeout: 2000 }).catch(() => "")) || "").trim();
const settle = async () => { await page.waitForTimeout(2600); };
const lawNumbers = (s) => /\bLaws? \d|\(Law|\b\d+\.\d+(\.\d+)?\b(?! (overs|ov\b))/.test(s);
/** Every rain sheet's and the banner's words, as the walk met them. @type {string[]} */
const rainWords = [];
const keep = async (id) => { rainWords.push(await said(id)); };

/** The pad's own prompts, answered: a bowler, the next batter, the openers. */
let batterCounter = 0;
const clearBlockers = async () => {
  for (let i = 0; i < 12; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const next = page.locator("button:not([disabled])", { hasText: /Next\s*$/i });
    if (await next.count()) { try { await next.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const body = await text();
    if (/Available to Bat|Batting Order/i.test(body)) {
      const nameField = page.locator('input[aria-label="Player name"]');
      if (await nameField.count()) {
        try { batterCounter++; await nameField.fill(`Batter ${batterCounter}`); await nameField.press("Enter"); } catch {}
        await page.waitForTimeout(500);
        continue;
      }
    }
    if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
      const field = page.locator("input[placeholder*='name' i], input[placeholder*='Search bowler' i]").last();
      if (await field.count()) {
        try {
          await field.fill(`Bowler ${Math.floor(Math.random() * 1e6)}`);
          await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 1500 });
        } catch {}
        await page.waitForTimeout(600);
        continue;
      }
    }
    return;
  }
};
const makeReady = async () => {
  for (let i = 0; i < 8; i++) {
    await clearBlockers();
    if (!(await has("scoring-blocked-fix"))) {
      if (!/Batting Order|Opening Bowler|Over \d+ Complete|Available to Bat/i.test(await text())) return true;
      continue;
    }
    try { await tid("scoring-blocked-fix").first().click({ timeout: 2000 }); } catch {}
    await page.waitForTimeout(700);
  }
  return false;
};
const basicPad = async () => {
  if (!(await has("basic-pad"))) { await tap("pad-menu").catch(() => {}); await tap("pad-basic-scoring").catch(() => {}); }
  await page.waitForTimeout(300);
};
/** n singles, the pad's prompts answered between. */
const singles = async (n) => { for (let k = 0; k < n; k++) { await clearBlockers(); await click(/^1$/); } };
const openMenu = async (item) => { await clearBlockers(); await tap("pad-menu"); await tap(item); await page.waitForTimeout(300); };

/** Screenshots of one state in both themes, at 390 × 844 (RAIN_SHOTS only). */
async function shoot(name) {
  if (!SHOTS) return;
  for (const theme of ["daylight", "floodlit"]) {
    await tap("pad-menu"); await tap(`pad-theme-choice-${theme}`); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) });
  }
  await tap("pad-menu"); await tap("pad-theme-choice-system"); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
}

try {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // The home side bats first (SCRBRD-067); dated 10 October 2026, the 4th
  // Edition, whatever day this walk runs on.
  await dbq(`update match set starts_at = '2026-10-10T08:00:00Z' where id = $1`, [MATCH]);
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1 on conflict (match_id) do nothing`, [MATCH]);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the pad on a real fixture, at 390 × 844");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));
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
  ok("the 1XI fixture offers the scorer", opened);
  await page.waitForTimeout(2500);
  await page.setViewportSize({ width: 390, height: 844 });
  await clearBlockers();
  await basicPad();
  ok("the openers and the bowler are named on the pad's own sheets", await makeReady());
  await singles(9);
  await settle();
  const balls0 = (await serverEvents()).filter((e) => e.kind === "ball").length;
  ok(`nine singles reach the server (${balls0})`, balls0 === 9);

  // ── A ────────────────────────────────────────────────────────
  group("A. Play stopped: one tap and a reason; the banner, the keys off, the row");
  await openMenu("pad-play-stopped");
  ok("the menu opens the stop sheet", await has("stop-sheet"));
  await keep("stop-sheet");
  ok("...rain is chosen to begin with", (await tid("stop-reason-rain").getAttribute("aria-checked")) === "true");
  await tid("stop-note").fill("Covers on at the pavilion end");
  await tap("stop-confirm");
  await settle();
  const words = await said("rain-banner-words");
  ok(`the banner says where play stopped (${words})`, /^Play stopped \(rain\) at 1\.3 ov, 9\/0, \d\d:\d\d$/.test(words), words);
  ok("...and offers Resume and End innings (rain)", await has("rain-resume") && await has("rain-end"));
  await keep("rain-banner");
  ok("the ball keys are off", (await tid("pad-keys").first().evaluate((el) => /** @type {HTMLFieldSetElement} */ (el).disabled)) === true);
  const stop = (await serverEvents()).at(-1);
  ok("the server holds the stop: its reason and the note", stop?.kind === "play_stopped" && /** @type {any} */ (stop).reason === "rain"
     && /** @type {any} */ (stop).note === "Covers on at the pavilion end", JSON.stringify(stop));
  await shoot("stopped");

  // ── B ────────────────────────────────────────────────────────
  group("B. Resume at 16 overs: the umpires' revision, then the resumption");
  await tap("rain-resume");
  ok("the Resume sheet asks the overs now, prefilled with the allotment", (await tid("resume-overs").inputValue()) === "20");
  await tid("resume-overs").fill("1");
  ok("...an allotment behind the balls bowled is refused (at least 2)", await tid("resume-confirm").isDisabled()
     && /At least 2/.test(await said("resume-sheet")));
  await tid("resume-overs").fill("16");
  ok("...16 is taken, and the button says so", (await said("resume-confirm")) === "Resume: 16 overs");
  await keep("resume-sheet");
  ok("...no DLS calculation is offered on the pad (R2's, server-side)", !(await has("rain-proposal")));
  await tap("resume-confirm");
  await settle();
  const tail = (await serverEvents()).slice(-2);
  ok("the server holds the revision then the resumption", tail[0]?.kind === "revision" && /** @type {any} */ (tail[0]).overs === 16
     && tail[1]?.kind === "play_resumed", JSON.stringify(tail.map((e) => e.kind)));
  ok("the banner is gone and the keys are on", !(await has("rain-banner"))
     && (await tid("pad-keys").first().evaluate((el) => /** @type {HTMLFieldSetElement} */ (el).disabled)) === false);
  ok(`the board reads the revised overs (${await said("board-sub")})`, /16 overs \(revised from 20\)/.test(await said("board-sub")), await said("board-sub"));
  await singles(3);

  // ── C ────────────────────────────────────────────────────────
  group("C. The first innings cut short; the umpires' figures for the chase");
  await openMenu("pad-play-stopped");
  await tap("stop-reason-wet_ground");
  await tap("stop-confirm");
  await settle();
  ok("stopped again, for a wet ground", /^Play stopped \(wet ground\) at 2\.0 ov, 12\/0/.test(await said("rain-banner-words")), await said("rain-banner-words"));
  await tap("rain-end");
  ok("the end sheet reads the figures back, and asks no par in a first innings",
     /closes at 12\/0 after 2\.0 overs/.test(await said("rain-end-figures")) && !(await has("rain-par")));
  await keep("rain-end-sheet");
  await tap("rain-end-confirm");
  await settle();
  const seal0 = (await serverEvents()).filter((e) => e.kind === "innings_end" && (e.innings ?? 0) === 0).at(-1);
  const c0 = /** @type {any} */ (seal0)?.confirmed;
  ok("the server holds the seal: abandoned, with the figures read back", /** @type {any} */ (seal0)?.reason === "abandoned"
     && c0?.runs === 12 && c0?.wickets === 0 && c0?.balls === 12, JSON.stringify(seal0));
  ok("the innings break opens with the umpires' figures to type", await has("innings2-umpires"));
  await tid("innings2-overs").fill("10");
  await tid("innings2-target-input").fill("30");
  ok("...and the break shows them", (await said("innings2-target")) === "30");
  await shoot("innings-break");
  await click(/Start 2nd Innings/, 4000);
  await settle();
  const start1 = (await serverEvents()).filter((e) => e.kind === "innings_start" && e.innings === 1).at(-1);
  ok("the chase's innings_start carries the umpires' overs and target", /** @type {any} */ (start1)?.overs === 10
     && /** @type {any} */ (start1)?.target === 30, JSON.stringify(start1));

  // ── D ────────────────────────────────────────────────────────
  group("D. The chase cut short with the umpires' par: decided on it");
  ok("the chase's openers and bowler", await makeReady());
  await basicPad();
  await singles(5);
  await settle();
  ok("five singles in the chase reach the server", (await serverEvents()).filter((e) => e.kind === "ball" && e.innings === 1).length === 5);
  await openMenu("pad-play-stopped");
  await tap("stop-confirm");
  await settle();
  await tap("rain-end");
  ok("in the chase the end sheet asks the umpires' par", await has("rain-par"));
  await tid("rain-par").fill("7");
  ok("...and says what it will do", (await said("rain-end-confirm")) === "End the innings, par 7");
  await keep("rain-end-sheet");
  await tap("rain-end-confirm");
  // The outbox sends in its own time: wait for the seal, up to 15 seconds.
  for (let k = 0; k < 30 && (await serverEvents()).at(-1)?.kind !== "innings_end"; k++) await page.waitForTimeout(500);
  // The pad words the result as the engine does (describeResult -> resultWords), suffix and all.
  ok(`the pad's own result reads the par: ${await said("pad-result")}`, /by 2 runs \(revised target\)$/.test((await said("pad-result")) ?? ""));
  const end = (await serverEvents()).filter((e) => e.innings === 1).slice(-2);
  ok("the server holds the par then the seal", end[0]?.kind === "revision" && /** @type {any} */ (end[0]).par === 7
     && end[1]?.kind === "innings_end" && /** @type {any} */ (end[1]).reason === "abandoned", JSON.stringify(end));
  const res = await apiResult();
  ok(`the server's result is decided on the par: ${res?.result?.text}`, res?.result?.outcome === "home_win"
     && res?.result?.marginKind === "runs" && res?.result?.margin === 2 && /won by 2 runs \(revised target\)$/.test(res?.result?.text ?? ""),
     JSON.stringify(res?.result));

  // ── E ────────────────────────────────────────────────────────
  group("E. The words");
  ok("no Law clause number in any rain sheet or the banner", !lawNumbers(rainWords.join(" ")), rainWords.join(" ").match(/.{0,30}(Law|\d+\.\d+).{0,30}/)?.[0]);
  ok("no console error", errors.length === 0, errors.join(" | "));
} catch (e) {
  ok("the walk ran to the end", false, e?.stack ?? String(e));
} finally {
  await browser.close();
  web.close();
  api.kill();
  await pool.end();
}
if (fail) console.log(apiErr.join("").slice(-1500));
console.log(`\n${"─".repeat(52)}\nBROWSER RAIN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

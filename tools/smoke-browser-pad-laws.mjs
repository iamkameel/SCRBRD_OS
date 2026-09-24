#!/usr/bin/env node
/**
 * The four scoring rules the product owner decided on 2026-09-24, asked on
 * the pad (docs/SCORING_RULES.md, "Product decisions, 2026-09-24").
 *
 * Each rule adds a question to the pad, and each question is only worth
 * anything if what the scorer answers reaches the server's log in the shape
 * the fold reads, the server's Laws take it, and the board the scorer is
 * looking at says what the server's own fold of that log says. So every step
 * here taps the real sheet in a real browser against a real API and
 * Postgres, then folds the server's rows (fromRow → deriveInnings, the way
 * every reader folds them) and holds the board to it.
 *
 *   SCRBRD-081  Retired out from the wicket sheet, timed out from the
 *               batting-order sheet: wickets with no ball. The server's rows
 *               are retire events marked W, the ball count does not move and
 *               the bowler takes nothing.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-pad-laws.mjs
 *   BROWSER_PAD_LAWS_DEBUG=1 node tools/smoke-browser-pad-laws.mjs
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

const WEB_PORT = 5317;
const API_PORT = 8817;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_PAD_LAWS_DEBUG;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-pad-laws-secret",
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

/** The server's log for this match, folded the way every reader folds it. */
async function serverLog() {
  const rows = await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [MATCH]);
  const evs = rows.map(fromRow).filter((e) => (e.innings ?? 0) === 0);
  return { rows, evs, inn: deriveInnings(evs) };
}

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext();
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

/** The pad's board, as the screen reader hears it: "11 for 0, 1.2 overs". */
const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
const boardOf = (inn) => `${inn.runs} for ${inn.wickets}, ${Math.floor(inn.balls / 6)}.${inn.balls % 6} overs`;

/** The pad's own prompts, answered: a bowler, the next batter, the openers. */
const clearBlockers = async () => {
  for (let i = 0; i < 10; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const next = page.locator("button:not([disabled])", { hasText: /Next\s*$/i });
    if (await next.count()) { try { await next.first().click({ timeout: 1500 }); } catch (e) { if (DEBUG) console.log("[debug] NEXT click:", e.message.split("\n")[0]); } await page.waitForTimeout(500); continue; }
    const body = await text();
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
/** Until the pad says nothing is missing: its own fix button, then the sheet it opens. */
const makeReady = async () => {
  for (let i = 0; i < 6; i++) {
    await clearBlockers();
    // The blocked panel hides while a sheet is open, so "no fix button" is
    // only "ready" once the board says nothing is missing.
    if (!/Can't score yet/i.test(await text()) && !(await tid("scoring-blocked-fix").count())) {
      if (!/Batting Order|Opening Bowler|Over \d+ Complete/i.test(await text())) return true;
      continue;
    }
    const fix = tid("scoring-blocked-fix");
    if (DEBUG) console.log(`[debug] makeReady pass ${i}: fix buttons ${await fix.count()}`);
    try { await fix.first().click({ timeout: 2000 }); } catch { /* next pass */ }
    await page.waitForTimeout(700);
  }
  return false;
};
/** Let the outbox send and the server answer. */
const settle = async () => { await page.waitForTimeout(2500); };
const agree = async (label) => {
  await settle();
  const s = await serverLog();
  const b = await board();
  ok(`${label}: the board and the server's fold agree (${b})`, b === boardOf(s.inn), `board ${b} / server ${boardOf(s.inn)}`);
  // ...and the SQL fold the public score and the handover check read
  // (match_live_score: a wicket is ball_type 'W', a ball is kind 'ball').
  const [live] = await dbq(`select runs::int, wickets::int, legal_balls::int from match_live_score
                             where match_id = $1 and innings = 0`, [MATCH]);
  ok(`${label}: ...and so does match_live_score`,
     live?.runs === s.inn.runs && live?.wickets === s.inn.wickets && live?.legal_balls === s.inn.balls,
     `${JSON.stringify(live)} / ${boardOf(s.inn)}`);
  return s;
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // SCRBRD-067: the pad opens a live fixture's first innings from the toss.
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1
             on conflict (match_id) do nothing`, [MATCH]);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the pad on a real fixture");
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
  await clearBlockers();
  if (!/\bDOT\b/i.test(await text())) await click(/QUICK MODE/i, 2500);
  await page.waitForTimeout(400);
  ok("the scorer opens on the pad", /\bDOT\b/i.test(await text()));

  ok("the openers and the bowler are named on the pad's own sheets", await makeReady());
  if (DEBUG) console.log("[debug] pad before the first ball:\n" + (await text()).slice(0, 1500));
  await click(/^1$/); await click(/^2$/);
  const start = await agree("two balls in");
  ok("...and the server has them", start.inn.balls === 2 && start.inn.runs === 3, boardOf(start.inn));

  // ── SCRBRD-081 ───────────────────────────────────────────────
  group("SCRBRD-081: retired out, from the wicket sheet — a wicket with no ball");
  const nonStriker = start.inn.nonStriker;
  await click(/Wicket/, 2500);
  await tap("wicket-mode-retired_out");
  ok("the sheet asks who is out", await tid("wicket-who-nonstriker").count() === 1);
  await tap("wicket-who-nonstriker");
  await tap("wicket-confirm");
  await page.waitForTimeout(600);
  ok("...and the batting-order sheet asks for the next man", /Available to Bat/i.test(await text()));
  await clearBlockers();
  const ro = await agree("after retired out");
  const roRow = ro.rows.find((r) => r.kind === "retire");
  ok("the server stored a retire marked W, not a ball",
     roRow?.ball_type === "W" && roRow?.dismissal === "retired_out" && roRow?.payload?.batter === nonStriker, JSON.stringify(roRow));
  ok("...a wicket, with the ball count and the bowler's figures where they were",
     ro.inn.wickets === 1 && ro.inn.balls === 2 && ro.inn.bowlers.every((b) => b.wickets === 0 && b.balls <= 2));
  ok("...and the new batter took the empty end, the striker still in",
     ro.inn.striker === start.inn.striker && ro.inn.nonStriker != null && ro.inn.nonStriker !== nonStriker);

  group("SCRBRD-081: timed out, from the batting-order sheet");
  await click(/Wicket/, 2500);
  await tap("wicket-confirm");        // bowled, the sheet's default
  await page.waitForTimeout(600);
  ok("after a wicket the sheet offers timed out", await tid("timed-out-toggle").count() === 1);
  await tap("timed-out-toggle");
  ok("...and asks who", /Who was timed out/i.test(await text()));
  const due = await page.locator("button:not([disabled])", { hasText: /Next\s*$/i }).first().innerText().catch(() => "");
  await page.locator("button:not([disabled])", { hasText: /Next\s*$/i }).first().click({ timeout: 3000 });
  await page.waitForTimeout(600);
  ok("the sheet stays open for the batter who does come in", /Available to Bat/i.test(await text()));
  await clearBlockers();
  const to = await agree("after timed out");
  const toRow = to.rows.filter((r) => r.kind === "retire").at(-1);
  ok("the server stored timed out the same way", toRow?.ball_type === "W" && toRow?.dismissal === "timed_out", JSON.stringify(toRow));
  ok("...three wickets on three balls: the bowled ball, and two with none",
     to.inn.wickets === 3 && to.inn.balls === 3 && to.inn.nonBallWickets.length === 2);
  ok(`...the man timed out is on the card (${due.split("\n")[1] ?? due})`,
     to.inn.batsmen.some((b) => b.dismissal === "timed out" && b.balls === 0));
  ok("...and only the bowled one is the bowler's", to.inn.bowlers.reduce((a, b) => a + b.wickets, 0) === 1);

  // ── SCRBRD-080 ───────────────────────────────────────────────
  group("SCRBRD-080: a bowler replaced mid-over — the pad asks why");
  await makeReady();
  await click(/PRO MODE/, 3000);
  await page.waitForTimeout(500);
  ok("the over is under way", to.inn.balls % 6 !== 0);
  ok("the pro pad offers a change of bowler", await click(/Chg Bowler/, 3000));
  await page.waitForTimeout(400);
  ok("the sheet asks: injury or suspended?", await tid("bowler-change-reason").count() === 1 && /Injury or suspended/i.test(await text()));
  const goBtn = page.locator("button", { hasText: /^Go$/ }).first();
  const bowlerField = page.locator("input[aria-label='Bowler name']").first();
  await bowlerField.fill("B Zulu");
  ok("...and offers nobody until it is answered", await goBtn.isDisabled());
  await tap("bowler-change-injury");
  ok("...then the replacement may be named", !(await goBtn.isDisabled()));
  await goBtn.click({ timeout: 3000 });
  await page.waitForTimeout(500);
  await click(/FOCUS MODE/, 3000);
  const ch = await agree("after the change");
  const bowlerRow = ch.rows.filter((r) => r.kind === "bowler").at(-1);
  ok("the server stored the change with its reason",
     bowlerRow?.payload?.bowler === "B Zulu" && bowlerRow?.payload?.reason === "injury", JSON.stringify(bowlerRow?.payload));
  ok("...and its fold says who took over, when, and why",
     ch.inn.bowlerChanges.length === 1 && ch.inn.bowlerChanges[0].to === "B Zulu" && ch.inn.bowlerChanges[0].from === "A Nel"
     && ch.inn.bowlerChanges[0].reason === "injury" && ch.inn.bowler === "B Zulu");
  // B Zulu finishes the over.
  for (let b = ch.inn.balls % 6; b < 6; b++) await click(/^·/, 2000);
  await page.waitForTimeout(600);
  ok("the over ends and the pad asks for the next bowler", /Over \d+ Complete/i.test(await text()));
  const nextField = page.locator("input[aria-label='Bowler name']").first();
  await nextField.fill("B Zulu");
  ok("...not the man who finished the last one (Law 17.8, or parts thereof)", await page.locator("button", { hasText: /^Go$/ }).first().isDisabled());
  await nextField.fill("A Nel");
  ok("...nor the man he replaced", await page.locator("button", { hasText: /^Go$/ }).first().isDisabled());
  await nextField.fill("C Mthembu");
  await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 3000 });
  await page.waitForTimeout(500);
  const over2 = await agree("over two begins");
  ok("the server took the third bowler", over2.inn.bowler === "C Mthembu" && over2.inn.balls === 6);
  await page.locator("button", { hasText: /^📋\s*Cards$/ }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
  const cards = await tid("bowler-changes").first().innerText().catch(() => "");
  ok(`the scorecard says it (${cards.trim()})`, /B Zulu took over from A Nel \(injured\)/.test(cards));
  await page.locator("button", { hasText: /^🏏\s*Score$/ }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);

  ok("no console errors on the pad", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the walk threw: ${e.message?.slice(0, 200)}`, false);
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
console.log(`\n${"─".repeat(52)}\nBROWSER PAD-LAWS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

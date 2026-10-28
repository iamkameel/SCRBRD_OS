#!/usr/bin/env node
/**
 * The pad reads the facts (Recognition R2), in a real browser against a real
 * API and Postgres, at a phone's 390 × 844.
 *
 * The pad's moments on the board used to come from its own counter beside the
 * fold (detectMilestone()), which showed only the first milestone a ball
 * earned. They are now deriveFacts()'s moments, read after the event is
 * emitted (apps/web/src/scorer/milestones.js). The seeded 1XI is a side of
 * five, so four wickets are all out (the fold's wicketsToEnd). Through the
 * pad's own keys and wicket sheet:
 *
 *   over 1   six sixes to the opener: SIX! each, his 36
 *   over 2   a single, then the opener's three sixes: the third brings up his
 *            fifty and the side's 50 on one ball, SIX! | FIFTY! | 50!, the
 *            fifty an achievement (the milestone pin, dashed, and the word
 *            Tentative, spec §13), the side's 50 nobody's; then two dots
 *   over 3   bowled                 WICKET!
 *            bowled                 WICKET! | HAT-TRICK BALL
 *            run out                WICKET! and no hat-trick: a run out after
 *                                   two wickets is the side's, not the
 *                                   bowler's (Q8)
 *            bowled                 WICKET! | ALL OUT!: a wicket ball that
 *                                   earns another moment plays it behind the
 *                                   wicket (the engine's wicket path kept one)
 *
 * (The facts' case of two milestones on one wicket ball, a fifer and a
 * hat-trick, needs five of one bowler's wickets, more than this side has:
 * apps/web/test/board.test.mjs holds it through the same queue.) The screen
 * reader's line says the last moment of each ball. And the moments are
 * display only: the server stored every ball as tapped, and the board, the
 * server's fold and match_live_score agree.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-pad-moments.mjs
 *   BROWSER_PAD_MOMENTS_DEBUG=1 node tools/smoke-browser-pad-moments.mjs
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

const WEB_PORT = port(5337);
const API_PORT = port(8837);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_PAD_MOMENTS_DEBUG;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-pad-moments-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const pool = new pg.Pool({ connectionString: ownerUrl() });
const dbq = async (/** @type {string} */ text, /** @type {any[]} */ params = []) => (await pool.query(text, params)).rows;

/** The server's log for this match, folded the way every reader folds it. */
async function serverLog(innings = 0) {
  const rows = await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [MATCH]);
  const evs = rows.map(fromRow).filter((e) => (e.innings ?? 0) === innings);
  return { rows: rows.filter((r) => (r.innings ?? 0) === innings), evs, inn: deriveInnings(/** @type {any} */ (evs)) };
}

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await offline(ctx);
const page = await ctx.newPage();
watchReads(page);
const errors = /** @type {string[]} */ ([]);
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
});

const text = () => page.$eval("body", (el) => /** @type {HTMLElement} */ (el).innerText);
const click = async (/** @type {RegExp} */ re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tid = (/** @type {string} */ id) => page.locator(`[data-testid="${id}"]`);
const tap = async (/** @type {string} */ id, ms = 4000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(350); };

/** The pad's board, as the screen reader hears it: "11 for 0, 1.2 overs". */
const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
const boardOf = (/** @type {any} */ inn) => `${inn.runs} for ${inn.wickets}, ${Math.floor(inn.balls / 6)}.${inn.balls % 6} overs`;

/** The pad's own prompts, answered: a bowler, the next batter. */
const clearBlockers = async () => {
  for (let i = 0; i < 10; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch { /* next pass */ } await page.waitForTimeout(500); continue; }
    const next = page.locator("button:not([disabled])", { hasText: /Next\s*$/i });
    if (await next.count()) { try { await next.first().click({ timeout: 1500 }); } catch { /* next pass */ } await page.waitForTimeout(500); continue; }
    const body = await text();
    if (/Opening Bowler/i.test(body)) {
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
const makeReady = async () => {
  for (let i = 0; i < 6; i++) {
    await clearBlockers();
    if (!/Can't score yet/i.test(await text()) && !(await tid("scoring-blocked-fix").count())) {
      if (!/Batting Order|Opening Bowler/i.test(await text())) return true;
      continue;
    }
    try { await tid("scoring-blocked-fix").first().click({ timeout: 2000 }); } catch { /* next pass */ }
    await page.waitForTimeout(700);
  }
  return false;
};

/**
 * Every flash the board shows for one ball, however briefly (each is gone in
 * 600ms): its words, whether it carries the pin, dashed or not, and the word
 * Tentative. And every line the screen reader's polite region says from here
 * on (not the last ball's, which it keeps).
 *
 * A queued moment is the same flash element with new words (React keeps the
 * node), so a flash is counted when its words change, not when a node
 * appears.
 */
const watchFlashes = () => page.evaluate(() => {
  const w = /** @type {any} */ (window);
  w.__flashes = [];
  w.__said = [];
  w.__cur = null;
  w.__lastSaid = document.querySelector('[data-testid="pad-moment"]')?.textContent ?? "";
  w.__obs?.disconnect();
  w.__obs = new MutationObserver(() => {
    const el = document.querySelector('[data-testid="board-flash"]');
    const label = el?.querySelector('[data-testid="board-flash-label"]')?.textContent ?? null;
    if (label == null) w.__cur = null;
    else if (label !== w.__cur) {
      w.__cur = label;
      const pin = el?.querySelector('[data-testid="badge-pin"]');
      w.__flashes.push({
        label,
        pin: !!pin, dashed: pin?.getAttribute("data-tentative") === "true" && !!pin?.querySelector("[stroke-dasharray]"),
        tentative: el?.querySelector('[data-testid="board-flash-tentative"]')?.textContent ?? "",
      });
    }
    const said = document.querySelector('[data-testid="pad-moment"]')?.textContent ?? "";
    if (said && said !== w.__lastSaid) { w.__lastSaid = said; w.__said.push(said); }
  });
  w.__obs.observe(document.body, { subtree: true, childList: true, characterData: true });
});
const flashes = async () => /** @type {{label: string, pin: boolean, dashed: boolean, tentative: string}[]} */
  (await page.evaluate(() => /** @type {any} */ (window).__flashes));
const said = async () => /** @type {string[]} */ (await page.evaluate(() => /** @type {any} */ (window).__said));

/** One delivery through the pad (`act` taps it); then the moments it played. */
async function delivery(/** @type {string} */ what, /** @type {() => Promise<void>} */ act) {
  await makeReady();
  await watchFlashes();
  await act();
  // Three flashes at most, 600ms each, played one after another.
  await page.waitForTimeout(2600);
  const f = await flashes();
  const s = await said();
  if (DEBUG) console.log(`[debug] ${what}:`, JSON.stringify(f), JSON.stringify(s));
  return { f, labels: f.map((x) => x.label).join(" | "), s };
}
const run = (/** @type {number} */ n) => delivery(`run ${n}`, () => tap(n === 0 ? "key-dot" : `run-${n}`));
/** One wicket through the pad's sheet. */
const wicket = (/** @type {string} */ mode) => delivery(mode, async () => {
  await tap("key-wicket");
  await tap(`wicket-mode-${mode}`);
  if (mode === "run_out") await tap("wicket-who-striker");
  await tap("wicket-confirm");
});

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1
             on conflict (match_id) do nothing`, [MATCH]);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the pad on a real fixture, at 390 × 844");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await afterReads(page, 2200);
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));
  // The fixture list can still be arriving on a cold API: asked again, up to three times.
  let opened = false;
  for (let i = 0; i < 3 && !opened; i++) {
    await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
    await afterReads(page, 1200 + i * 1500);
    opened = await page.evaluate(() => {
      const isBtn = (/** @type {Element} */ b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "");
      for (const b of [...document.querySelectorAll("button")].filter(isBtn)) {
        let card = /** @type {Element} */ (b);
        while (card.parentElement && [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) card = card.parentElement;
        if (/Michaelhouse/i.test(card.textContent || "")) { b.click(); return true; }
      }
      return false;
    });
  }
  ok("the 1XI fixture offers the scorer", opened);
  if (!opened && DEBUG) console.log("[debug] Match Centre:\n" + (await text()).slice(0, 1500));
  await page.waitForTimeout(2500);
  await clearBlockers();
  if (!(await tid("basic-pad").count())) { await tid("pad-menu").click({ timeout: 2500 }).catch(() => {}); await tid("pad-basic-scoring").click({ timeout: 2500 }).catch(() => {}); }
  await page.waitForTimeout(400);
  ok("the scorer opens on the pad", /\bDOT\b/i.test(await text()));
  ok("the openers and the bowler are named on the pad's own sheets", await makeReady());

  group("Over 1: six sixes, a flash each and nothing more");
  for (let i = 1; i <= 6; i++) {
    const six = await run(6);
    ok(`six ${i}: SIX!, nothing more (${six.labels})`, six.labels === "SIX!", six.labels);
  }

  group("Over 2: his fifty and the side's 50 on one ball, both, in order");
  await run(1);
  await run(6);
  const s48 = await run(6);
  ok(`48, the side 49: no milestone yet (${s48.labels})`, s48.labels === "SIX!", s48.labels);
  const fifty = await run(6);
  ok(`the six that brings up both: SIX! | FIFTY! | 50! (${fifty.labels})`, fifty.labels === "SIX! | FIFTY! | 50!", fifty.labels);
  const pin = fifty.f.find((x) => x.label === "FIFTY!");
  ok("...the fifty an achievement: the pin, dashed, and the word Tentative", !!pin && pin.pin && pin.dashed && pin.tentative === "Tentative", JSON.stringify(pin));
  ok("...the six and the side's 50 carry none", fifty.f.filter((x) => x.label !== "FIFTY!").every((x) => !x.pin && !x.tentative));
  ok(`...and the screen reader is told each, the fifty tentative (${fifty.s.join(" | ")})`,
     fifty.s.some((x) => /^FIFTY\. .+ reaches 50\. Tentative$/.test(x)) && /^50\. .+ reach 50$/.test(fifty.s.at(-1) ?? ""), fifty.s.join(" | "));
  await run(0);
  await run(0);

  group("Over 3: the hat-trick ball, a run out that breaks it, all out");
  const w1 = await wicket("bowled");
  ok(`1. bowled: the wicket, and nothing more (${w1.labels})`, w1.labels === "WICKET!", w1.labels);
  const w2 = await wicket("bowled");
  ok(`2. bowled: two in two, the hat-trick ball (${w2.labels})`, w2.labels === "WICKET! | HAT-TRICK BALL", w2.labels);
  ok("...nobody's honour: no pin, no Tentative", w2.f.every((x) => !x.pin && !x.tentative));
  ok(`...and the screen reader is told (${w2.s.at(-1)})`, /^HAT-TRICK BALL\. .+ — two in two$/.test(w2.s.at(-1) ?? ""), w2.s.join(" | "));
  const w3 = await wicket("run_out");
  ok(`3. a run out after two wickets calls no hat-trick (${w3.labels})`, w3.labels === "WICKET!" && !/HAT-TRICK/.test(w3.s.join(" ")), `${w3.labels} / ${w3.s.join(" | ")}`);
  const w4 = await wicket("bowled");
  ok(`4. bowled, the fourth of a side of five: WICKET! | ALL OUT!, in order (${w4.labels})`, w4.labels === "WICKET! | ALL OUT!", w4.labels);
  ok(`...no hat-trick ball after the run out (${w4.s.join(" | ")})`, !/HAT-TRICK/.test(w4.s.join(" ")));

  group("Display only: the server stored every ball the scorer tapped");
  await page.waitForTimeout(2500);
  const s = await serverLog(0);
  const balls = s.rows.filter((r) => r.kind === "ball").map((r) => r.ball_type === "W" ? `W:${r.dismissal}` : String(r.value));
  const tapped = ["6", "6", "6", "6", "6", "6", "1", "6", "6", "6", "0", "0", "W:bowled", "W:bowled", "W:run_out", "W:bowled"];
  ok(`sixteen balls stored, each as tapped (${balls.join(",")})`, balls.join(",") === tapped.join(","));
  ok("the server's fold: 55 for 4 off 16 balls, all out", s.inn.runs === 55 && s.inn.wickets === 4 && s.inn.balls === 16 && s.inn.complete === true, boardOf(s.inn));
  // The board, behind the innings review that is now open.
  const b = await board();
  ok(`the board and the server's fold agree (${b})`, b === boardOf(s.inn), `board ${b} / server ${boardOf(s.inn)}`);
  const [live] = await dbq(`select runs::int, wickets::int, legal_balls::int from match_live_score where match_id = $1 and innings = 0`, [MATCH]);
  ok("...and so does match_live_score", live?.runs === s.inn.runs && live?.wickets === s.inn.wickets && live?.legal_balls === s.inn.balls,
     `${JSON.stringify(live)} / ${boardOf(s.inn)}`);
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  ok(`the pad moments walk threw: ${/** @type {Error} */ (e).message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(/** @type {Error} */ (e).stack?.split("\n").slice(0, 8).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  api.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER PAD MOMENTS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

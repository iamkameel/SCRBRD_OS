#!/usr/bin/env node
/**
 * The Match Centre (redesign step 3c, SCRBRD-098), from a browser, on a real
 * scored match.
 *
 * The fixture is written straight onto the ball log by
 * tools/fixture-matchcentre.mjs, through the scoring package's own
 * constructors — and the walk folds the SAME events with the same package, so
 * every figure and every line the screen must show is known here without
 * trusting the screen for any of it:
 *
 *   1. the six tabs, in the prototype's order, as an ARIA tablist a keyboard
 *      can drive (arrows, Home, End), each 44px tall and on the 12px floor;
 *   2. the header: both sides named in full, the match line under it;
 *   3. Summary: the Board, with the fold's total;
 *   4. Scorecard: the innings toggle, a dismissal under each name, not-out
 *      rows shaded, "Did not bat", the extras as NB · WD · B · LB · PEN, the
 *      total bar, the bowling, the fall of wickets as "83/3 · M Cele · 6.3";
 *      a batter's row opens to his 1s-6s, his wagon wheel and the line of
 *      his dismissal;
 *   5. Commentary: the generator's lines, newest first, by over — the voided
 *      and the amended deliveries have none;
 *   6. Partnerships and Match details;
 *   7. the innings break (a second fixture): the break card on Summary;
 *   8. at 390 wide: the sides by code, and nothing wider than the screen;
 *   9. the spectator's side (Kameel's premium-feel checklist): the highlights
 *      in order; nothing replays on a fresh load; balls that arrive while the
 *      page is open give a moment on the board, tick the run count up, and
 *      end the over with a summary that shows and clears; big-screen mode
 *      draws the board full screen and leaves on Escape or its button;
 *  10. CRI-2.1, at 360 wide: the Commentary's chips keep exactly the
 *      deliveries the scorecard counts, by event id, and the over jump goes
 *      to Over 14 of a longer fixture (fixture-matchcentre.mjs LONG);
 *  11. CRI-2.3: every Manhattan bar and every wagon-wheel area with balls in
 *      it opens the Commentary at exactly its events, adding up to its runs,
 *      and the way back is the charts where the page was;
 *  12. CRI-2.5: a parent and a pupil have the three spectator charts on
 *      Analytics (the worm with its wickets, runs per over, the
 *      partnerships), and the coach, the scorer and the director of sport every
 *      one: by persona, as the shell lays out its app (lib/matchAnalysis.js).
 *
 * MC_SHOTS=<dir> also saves every tab at 390 and 1366 wide, in Daylight and
 * Floodlit, into <dir>.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-matchcentre.mjs
 *   BROWSER_MC_DEBUG=1 node tools/smoke-browser-matchcentre.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { deriveMatch, deriveInnings, deriveCommentary, runsOffBat, ball, batters, bowler, inningsStart, revision, sealInnings, placementFromTap,
  scenarioOf, voidEvent, boundaryHit, batHandOf } from "@scrbrd/scoring";
import { buildMatchCentreFixture, buildLongFixture, writeEvents, HIL } from "./fixture-matchcentre.mjs";
import { correctionsOf, withCorrectionLines } from "../apps/web/src/lib/corrections.js";
import { projectMatch } from "../apps/web/src/scorer/chartData.js";
import { overParts } from "../apps/web/src/scorer/overParts.js";
import { wagonAnalysis } from "../apps/web/src/scorer/wagonAnalysis.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";
import { pickTab } from "./walk-tabs.mjs";

const WEB_PORT = port(5361);
const API_PORT = port(8961);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const DEBUG = !!process.env.BROWSER_MC_DEBUG;
const SHOTS = process.env.MC_SHOTS || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-mc-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

// What the page is served from. The walk switches it, for one group, to its own
// build with the test hook in it (see "An error boundary" below); every other
// group runs against the ordinary build in dist/.
let WEB_ROOT = "apps/web/dist";
const web = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  let body, type;
  try {
    const f = join(WEB_ROOT, url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = TYPES[extname(f)] ?? "application/octet-stream";
  } catch {
    body = await readFile(join(WEB_ROOT, "index.html"));
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, r));

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const browser = await chromium.launch({ ...launchOptions() });

/** A fresh session, at a width and in a theme (the device's colour scheme). `liveMs` reads a live match that often. */
async function open({ viewport = DESK, scheme = "dark", liveMs = null, init = null } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  if (liveMs) await page.addInitScript(`window.__SCRBRD_LIVE_MS__ = ${liveMs};`);
  if (init) await page.addInitScript(init);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
/** Wait for a condition in the page's own time, up to `ms`. */
const until = async (page, fn, ms = 8000, arg = undefined) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }); return true; } catch { return false; }
};
const text = (page) => page.$eval("body", (el) => el.innerText);
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
async function signIn(page, who) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await click(page, who, 4000);
  await click(page, /^Sign In$/, 5000);
  await afterReads(page, 2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}
async function openMatch(page, id) {
  await page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const btn = tid(page, `mc-open-${id}`);
  // Match Centre draws a fixture's card only once its reads answer (matches,
  // staff, grounds, competitions, weather), and on the first opening those
  // queue behind the previous screen's: 1.4-2.3 s measured, against the fixed
  // wait before this look. Give the card up to 10 s to be drawn; one that is
  // never drawn is judged exactly as before.
  await btn.first().waitFor({ timeout: 10000 }).catch(() => {});
  if (!(await btn.count())) return false;
  await btn.click({ timeout: 5000 });
  // The fixture's view is drawn once its chunk and reads arrive, which a busy
  // runner can take past the fixed wait below: give it up to 10 s first.
  await tid(page, "match-view").waitFor({ timeout: 10000 }).catch(() => {});
  await afterReads(page, 1800);
  return (await tid(page, "match-view").count()) === 1;
}
const tab = async (page, id) => { await tid(page, `mc-tab-${id}`).click({ timeout: 4000 }); await page.waitForTimeout(500); };

const TABS = ["summary", "scorecard", "commentary", "partnerships", "analytics", "details"];
/** Overs as the card writes them: 9.4 for 58 balls. */
const oversOfBalls = (/** @type {number} */ b) => `${Math.floor(b / 6)}${b % 6 ? `.${b % 6}` : ""}`;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  group("SCRBRD-100: no live matches — the list points onward, never a blank panel");
  const pre = await open();
  ok("the director of sport signs in", await signIn(pre.page, /sarah@example\.invalid|Director/));
  await pre.page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
  await pre.page.waitForTimeout(1000);
  await pre.page.locator('[data-testid="mc-filter-live"]').first().click({ timeout: 4000 }).catch(() => {});
  await pre.page.waitForTimeout(500);
  ok("nothing live on a freshly seeded database: no blank panel", await tid(pre.page, "mc-nomatches").count() === 1);
  const noneText = await tid(pre.page, "mc-nomatches").innerText().catch(() => "");
  ok("...points to the seeded upcoming fixtures", /Michaelhouse/.test(noneText) && /Kearsney College/.test(noneText), noneText.slice(0, 300));
  ok("...and the seeded results", /Westville Boys' High/.test(noneText) && /Maritzburg College/.test(noneText), noneText.slice(0, 300));

  group("SCRBRD-100: before the toss");
  // Back to every fixture: the "live" filter above would hide one yet to be played.
  await pre.page.locator('[data-testid="mc-filter-all"]').first().click({ timeout: 4000 }).catch(() => {});
  await pre.page.waitForTimeout(300);
  ok("a fixture yet to be played opens", await openMatch(pre.page, "77777777-0000-0000-0000-000000000002"));
  ok("both sides and the status show", /Hilton College/.test(await tid(pre.page, "mc-title").innerText()) && (await tid(pre.page, "mc-status").textContent()) === "Fixture");
  ok("ground and start, in place of a dead end", await tid(pre.page, "mc-pretoss").count() === 1);
  const preToss = await tid(pre.page, "mc-pretoss").innerText();
  ok("the ground is named", /Gordon Sherwood Oval/.test(preToss), preToss);
  ok("no confirm-the-scorecard prompt on a fixture that has not been played", await tid(pre.page, "mc-confirm-prompt").count() === 0);
  ok("no onward links either — there is nothing to be onward from yet", await tid(pre.page, "mc-onward").count() === 0);
  ok("no console errors (before the toss)", pre.errors.length === 0, pre.errors.join(" | "));
  await pre.ctx.close();

  if (SHOTS) {
    // Taken here, before any live or rain-delay fixture exists, so "nothing
    // live" is the database's true state and not a screenshot of stale data.
    group(`SCRBRD-100 screenshots (empty states) → ${SHOTS}`);
    await mkdir(SHOTS, { recursive: true });
    const FT_DESK = { width: 1280, height: 800 };
    for (const [scheme, theme] of [["light", "daylight"], ["dark", "floodlit"]]) {
      for (const [vp, w] of [[PHONE, 390], [FT_DESK, 1280]]) {
        const s = await open({ viewport: vp, scheme });
        await signIn(s.page, /sarah@example\.invalid|Director/);
        await s.page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
        await s.page.waitForTimeout(1000);
        await s.page.locator('[data-testid="mc-filter-live"]').first().click({ timeout: 4000 }).catch(() => {});
        await s.page.waitForTimeout(500);
        await s.page.screenshot({ path: join(SHOTS, `empty-nolive-${w}-${theme}.png`), fullPage: true });
        await openMatch(s.page, "77777777-0000-0000-0000-000000000002");
        await s.page.waitForTimeout(400);
        await s.page.screenshot({ path: join(SHOTS, `empty-pretoss-${w}-${theme}.png`), fullPage: true });
        await s.ctx.close();
      }
    }
    ok("empty-state screenshots saved", true);
  }

  group("SCRBRD-100: a rain delay or interruption");
  // The one signal the log actually carries: a revision. No "play stopped,
  // resuming at…" event exists on the platform, so the banner says exactly
  // what this is — a revised innings — and nothing it is not.
  const revId = (await q(
    `insert into match (school_id, team_code, opponent, ground_id, starts_at, sport, format, overs, status)
     values ($1, '1XI', 'Rain Test Opponent', $2, now() - interval '40 minutes', 'cricket', 'T20', 20, 'live') returning id`,
    // No ground: the T10 built below is live on the Oval now, and db/133
    // refuses two fixtures on one ground at once. The banner is about the log.
    [HIL, null]))[0].id;
  await q(`insert into match_toss (match_id, school_id, won_by, decision) values ($1, $2, 'home', 'bat')`, [revId, HIL]);
  const revLog = [];
  let rn = 0;
  const addRev = (ev) => { const e = { ...ev, innings: 0, id: `mc-rev-${++rn}`, clientTs: Date.parse("2026-09-26T09:00:00Z") + rn * 20000 }; revLog.push(e); return e; };
  addRev(inningsStart({ battingTeam: "1XI", bowlingTeam: "Rain Test Opponent", teamKey: "1XI", bowlingTeamKey: "Rain Test Opponent",
    squad: [{ id: "rb1", name: "Rain One" }, { id: "rb2", name: "Rain Two" }], bowlingSquad: [], overs: 20 }));
  addRev(batters({ striker: "rb1", nonStriker: "rb2" }));
  addRev(bowler({ bowler: "Rain Bowler" }));
  // Twelve legal balls before the cut: no projection is made from fewer (GA-I29 A-D8).
  for (const v of [1, 4, 0, 1, 2, 0]) addRev(ball({ value: v }));
  addRev(bowler({ bowler: "Rain Bowler Two" }));
  for (const v of [1, 1, 0, 4, 0, 1]) addRev(ball({ value: v }));
  addRev(revision({ overs: 14, target: null, reason: "rain" }));
  await writeEvents(q, revId, revLog);
  const revS = await open();
  ok("the director of sport signs in", await signIn(revS.page, /sarah@example\.invalid|Director/));
  ok("the interrupted fixture opens", await openMatch(revS.page, revId));
  ok("a clear status, in place of a frozen board", await tid(revS.page, "mc-revision").count() === 1);
  const revText = await tid(revS.page, "mc-revision").textContent().catch(() => "");
  ok('"Rain delay" and "Overs revised to 14" — the fold\'s own revision, in words', /Rain delay/.test(revText) && /Overs revised to 14/.test(revText), revText);
  // "At this rate": a first innings still being played shows what its run rate
  // comes to over its (revised) overs — runs + runs/balls × balls left —
  // worked out here from the fold, not read back from the screen.
  const revInn = deriveMatch(revLog).innings[0];
  const revOvers = revInn.overs ?? 20;
  const revRate = Math.round(revInn.runs + (revInn.runs / revInn.balls) * (revOvers * 6 - revInn.balls));
  const revSub = await tid(revS.page, "mc-board-sub").innerText().catch(() => "");
  ok(`the first innings' board says "At this rate: ${revRate}" (${revInn.runs} off ${revInn.balls}, ${revOvers} overs), beside the run rate`,
     revSub.includes(`At this rate: ${revRate}`) && /CRR \d/.test(revSub) && revSub.indexOf("CRR") < revSub.indexOf("At this rate"), revSub);
  // GA-I29 A3: a first innings the umpires cut is projected to its new allotment, and the words say so.
  await tid(revS.page, "mc-scenario").waitFor({ timeout: 8000 }).catch(() => {});
  const revCrr = ((6 * revInn.runs) / revInn.balls).toFixed(2);
  const revOwn = await tid(revS.page, "mc-scenario-own").innerText().catch(() => "");
  ok(`the scenario panel projects to the cut: "At their rate so far (${revCrr} an over): ${revRate} off 14 overs (revised from 20)"`,
     revOwn === `At their rate so far (${revCrr} an over): ${revRate} off 14 overs (revised from 20)`, revOwn);
  ok("no console errors (revision)", revS.errors.length === 0, revS.errors.join(" | "));
  await revS.ctx.close();
  // Done with it: taken out of "live" so the later "nothing live" screenshot
  // still shows the true empty state rather than this one fixture.
  await q(`update match set status = 'complete' where id = $1`, [revId]);

  group("GA-I29: scenarios — from 12 legal balls, a stepper a keyboard drives, a void that moves the outcome and keeps the rate");
  {
    // A first innings of twenty overs, live, with no ground (db/133: the T10 below is on the Oval). The visitors bat,
    // under one long unbroken name, so the panel's Scope is the worst case a narrow phone meets (review S5).
    const LONG = "Hoërskool_Waterkloof_Pretoria_Oos_Onder14B_Ontwikkelingspan";
    const scId = (await q(
      `insert into match (school_id, team_code, opponent, ground_id, starts_at, sport, format, overs, status)
       values ($1, '1XI', $3, $2, now() - interval '30 minutes', 'cricket', 'T20', 20, 'live') returning id`, [HIL, null, LONG]))[0].id;
    await q(`insert into match_toss (match_id, school_id, won_by, decision) values ($1, $2, 'away', 'bat')`, [scId, HIL]);
    /** @type {any[]} */
    const scLog = [];
    let sn = 0;
    const addSc = (ev) => { const e = { ...ev, innings: 0, id: `mc-sc-${++sn}`, clientTs: Date.parse("2026-11-12T08:00:00Z") + sn * 20000 }; scLog.push(e); return e; };
    addSc(inningsStart({ battingTeam: LONG, bowlingTeam: "1XI", teamKey: LONG, bowlingTeamKey: "1XI",
      squad: Array.from({ length: 11 }, (_, k) => ({ id: `sc${k}`, name: `Scen ${k + 1}` })), bowlingSquad: [], overs: 20 }));
    addSc(batters({ striker: "sc0", nonStriker: "sc1" }));
    addSc(bowler({ bowler: "Scen Bowler" }));
    for (const v of [1, 0, 4, 1, 0, 2]) addSc(ball({ value: v }));
    addSc(bowler({ bowler: "Scen Bowler Two" }));
    for (const v of [1, 1, 0, 6, 1]) addSc(ball({ value: v }));
    await writeEvents(q, scId, scLog);
    /** Write events after those already written, in order. @param {any[]} more */
    const writeMore = async (more) => { const from = scLog.length; for (const e of more) addSc(e); await writeEvents(q, scId, scLog.slice(from), from); return scLog.slice(from); };
    const eleven = deriveMatch(scLog).innings[0];
    ok("the fixture is 17 off 11 legal balls", eleven.runs === 17 && eleven.balls === 11, `${eleven.runs}/${eleven.balls}`);
    const sc = await open({ liveMs: 1000, viewport: PHONE });
    ok("the director of sport signs in", await signIn(sc.page, /sarah@example\.invalid|Director/));
    ok("the fixture opens", await openMatch(sc.page, scId));
    const S = sc.page;
    await afterReads(S, 2500);
    ok("11 legal balls: no scenario panel, and no \"At this rate\" (A-D8: twelve, on every surface)",
       await tid(S, "mc-board").count() === 1 && await tid(S, "mc-scenario").count() === 0 && !/At this rate/.test(await tid(S, "mc-board-sub").innerText().catch(() => "")));
    // The twelfth ball: 19 off 12. Every figure worked out here, by hand.
    await writeMore([ball({ value: 2 })]);
    const R = 19, b = 12, L = 120 - b;
    const proj = (/** @type {number} */ halves) => Math.round(R + (halves / 2) * L / 6);
    ok("the twelfth ball draws the panel", await until(S, () => !!document.querySelector('[data-testid="mc-scenario"]'), 12000));
    const own = await tid(S, "mc-scenario-own").innerText().catch(() => "");
    ok('"At their rate so far (9.50 an over): 190 off 20 overs" (19 × 120 ÷ 12)', own === "At their rate so far (9.50 an over): 190 off 20 overs", own);
    ok('...and the board\'s "At this rate: 190" beside it, one figure', (await tid(S, "mc-board-sub").innerText().catch(() => "")).includes("At this rate: 190"));
    const hand = await tid(S, "mc-scenario-hand").innerText().catch(() => "");
    ok('..."10 wickets in hand · 108 balls left (18 overs)"', hand === "10 wickets in hand · 108 balls left (18 overs)", hand);
    const src = (await tid(S, "mc-scenario-source").innerText().catch(() => "")).replace(/\s+/g, " ");
    ok(`...the source line: scored balls, the side batting, 2 of 20 overs, from 12 balls ("${src}")`,
       /Source Scored balls/.test(src) && src.includes(`Scope ${LONG}, this innings`) && /Window 2 of 20 overs/.test(src) && /Basis From 12 balls\./.test(src));
    ok("...the footnote", (await tid(S, "mc-scenario-footnote").innerText().catch(() => "")).startsWith("Arithmetic on the score so far, not a forecast."));
    const rate = () => tid(S, "mc-scenario-rate").innerText().catch(() => "");
    const outcome = () => tid(S, "mc-scenario-outcome").innerText().catch(() => "");
    ok(`the stepper opens on the rate so far to the half, 9.5, and says ${proj(19)}`, (await rate()) === "9.5" && (await outcome()) === `an over: ${proj(19)}`, `${await rate()} ${await outcome()}`);
    const geom = await S.evaluate(() => {
      const box = (/** @type {string} */ id) => { const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect(); return r ? [r.width, r.height] : [0, 0]; };
      const panel = document.querySelector('[data-testid="mc-scenario"]');
      const small = [...(panel?.querySelectorAll("*") ?? [])].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())
        && parseFloat(getComputedStyle(e).fontSize) < 12).length;
      const out = document.querySelector('[data-testid="mc-scenario-outcome"]');
      return { down: box("mc-scenario-down"), up: box("mc-scenario-up"), small, live: out?.getAttribute("aria-live"), tag: out?.tagName,
               for: out?.getAttribute("for") ?? "", ids: [document.querySelector('[data-testid="mc-scenario-down"]')?.id, document.querySelector('[data-testid="mc-scenario-up"]')?.id],
               wide: panel ? panel.scrollWidth > panel.clientWidth + 1 : true };
    });
    ok(`the two buttons are 44px targets (${geom.down.join("×")}, ${geom.up.join("×")})`, geom.down.every((x) => x >= 44) && geom.up.every((x) => x >= 44));
    ok("nothing in the panel under 12px", geom.small === 0, geom.small);
    ok("the outcome is an <output> for the two buttons, and not a live region (the page's own speaks for new balls)",
       geom.tag === "OUTPUT" && geom.live === "off" && geom.ids.every((x) => !!x && geom.for.split(" ").includes(x)), JSON.stringify(geom));
    ok("...nothing wider than the panel at 390", !geom.wide);
    await tid(S, "mc-scenario-up").focus();
    await S.keyboard.press("Enter");
    ok(`Enter on + raises it to 10.0: ${proj(20)}`, await until(S, (w) => document.querySelector('[data-testid="mc-scenario-rate"]')?.textContent === "10.0"
       && document.querySelector('[data-testid="mc-scenario-outcome"]')?.textContent === w, 3000, `an over: ${proj(20)}`), `${await rate()} ${await outcome()}`);
    ok("...the focus stays on the button", await S.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "mc-scenario-up");
    await S.keyboard.press("Space");
    ok(`Space raises it to 10.5: ${proj(21)}`, (await rate()) === "10.5" && (await outcome()) === `an over: ${proj(21)}`, `${await rate()} ${await outcome()}`);
    await S.keyboard.press("Shift+Tab");
    ok("Shift+Tab reaches −", await S.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "mc-scenario-down");
    await S.keyboard.press("Enter");
    const saidNow = `If they score at 10.0 an over: ${proj(20)}`;
    const saidText = () => tid(S, "mc-scenario-said").innerText().catch(() => "");
    ok(`...Enter lowers it to 10.0, and the polite status says the line: "${saidNow}"`, (await rate()) === "10.0" && (await saidText()) === saidNow, await saidText());
    // A six, the thirteenth ball: the outcome moves, the reader's rate does not, and nothing is announced.
    const [, six] = await writeMore([bowler({ bowler: "Scen Bowler" }), ball({ value: 6 })]);
    const at13 = Math.round(25 + 10 * 107 / 6);
    ok(`a six arrives (25 off 13): the outcome is ${at13}, the rate still 10.0`,
       await until(S, (w) => document.querySelector('[data-testid="mc-scenario-outcome"]')?.textContent === w, 12000, `an over: ${at13}`) && (await rate()) === "10.0",
       `${await rate()} ${await outcome()}`);
    ok("...and the status still says what the reader last asked for, not the new ball", (await saidText()) === saidNow, await saidText());
    // The six voided (GA-I36): back to 19 off 12, the outcome back with it; the rate stays the reader's.
    await writeMore([voidEvent({ target: six.id, reason: "scorer_undo" })]);
    ok(`the six voided: the outcome back to ${proj(20)}, the rate still 10.0`,
       await until(S, (w) => document.querySelector('[data-testid="mc-scenario-outcome"]')?.textContent === w, 12000, `an over: ${proj(20)}`) && (await rate()) === "10.0",
       `${await rate()} ${await outcome()}`);
    ok("...and the rest of the panel with it: 190 again", (await tid(S, "mc-scenario-own").innerText().catch(() => "")) === "At their rate so far (9.50 an over): 190 off 20 overs");
    const words = await tid(S, "mc-scenario").innerText().catch(() => "");
    ok("the panel names no player and prints no percentage", !/Scen \d|%|chance|likely/.test(words), words);
    await S.setViewportSize({ width: 320, height: 700 });
    await S.waitForTimeout(300);
    const at320 = await S.evaluate(() => {
      const el = document.querySelector('[data-testid="mc-scenario"]');
      if (!el) return null;
      const edge = el.getBoundingClientRect().right;
      // Every line, the source line's scope among them, ends inside the card: nothing is cut off by its overflow.
      const cut = [...el.querySelectorAll('[data-testid^="mc-scenario-"]:not(.sr-only), [data-part]')].filter((x) => x.getBoundingClientRect().right > edge + 1 || x.scrollWidth > x.clientWidth + 1)
        .map((x) => x.getAttribute("data-testid") ?? x.getAttribute("data-part"));
      return { wide: el.scrollWidth > el.clientWidth + 1, cut, page: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    ok("at 320 wide, with the long unbroken name, every line of the panel wraps inside it", !!at320 && !at320.wide && at320.cut.length === 0, JSON.stringify(at320));
    ok("no console errors (scenarios)", sc.errors.length === 0, sc.errors.join(" | "));
    await sc.ctx.close();
    await q(`update match set status = 'complete' where id = $1`, [scId]);
  }

  group("A real, scored fixture on the ball log, folded here by the same package");
  const fx = await buildMatchCentreFixture(q);
  const evs = fx.events[fx.live];
  const fold = deriveMatch(evs);
  const [inn1, inn2] = fold.innings;
  const byId = Object.fromEntries(Object.entries(fx.players).map(([n, id]) => [id, n]));
  const FULL = { "1XI": "Hilton College 1XI", "Westville Boys' High 1XI": "Westville Boys' High 1XI" };
  const expected = deriveCommentary(evs, { nameOf: (r) => byId[r] ?? r, teamName: (_k, n) => FULL[n] ?? n });
  // GA-I36: the Match Centre tells each correction in one quiet line of its
  // own (lib/corrections.js); the match is live, so "The scorecard was corrected."
  // The fixture's events carry no seq: writeEvents() gave them 1, 2, 3… in order.
  const seqd = evs.map((e, i) => ({ ...e, seq: e.seq ?? i + 1 }));
  const told = withCorrectionLines(expected, seqd, correctionsOf(seqd), false);
  ok("the first innings is ten overs, sealed", inn1.balls === 60 && inn1.sealed, `${inn1.balls} ${inn1.sealed}`);
  ok("the second is under way", inn2.balls > 0 && !inn2.complete);
  ok("Westville start on the five they were awarded while fielding", inn2.extras.penalty === 5);
  const voided = evs.filter((e) => e.kind === "void").map((e) => e.target);
  ok("the log holds a void and an amendment", voided.length === 2 && evs.some((e) => String(e.id).startsWith("amendment:")));

  // ── Desktop, Floodlit ──
  const dos = await open();
  // CRI-1.4: every write this session asks of a match, from sign-in on. Reading the fixture must ask none.
  const dosWrites = [];
  dos.page.on("request", (r) => { if (r.method() !== "GET" && /\/api\/matches\//.test(r.url())) dosWrites.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  ok("the director of sport signs in", await signIn(dos.page, /sarah@example\.invalid|Director/));
  ok("Match Centre opens the fixture", await openMatch(dos.page, fx.live));
  const p = dos.page;

  group("The tabs: six, in the prototype's order (and the Coach tab after the Summary, for the director of sport's grant), a tablist a keyboard drives");
  const tabs = await p.evaluate(() => {
    const list = document.querySelector('[role="tablist"][data-testid="mc-tabs"]');
    return list ? [...list.querySelectorAll('[role="tab"]')].map((t) => {
      const r = t.getBoundingClientRect();
      return { name: t.textContent.trim(), selected: t.getAttribute("aria-selected"), controls: t.getAttribute("aria-controls"),
        h: r.height, font: parseFloat(getComputedStyle(t).fontSize) };
    }) : null;
  });
  // SCRBRD-136: the director of sport holds team.select and player.workload.read school-wide, so the Coach tab
  // follows the Summary (the cockpit walk holds who gets it); the six are unchanged and in their order.
  ok("Summary · Coach · Scorecard · Commentary · Partnerships · Analytics · Match details",
     tabs?.map((t) => t.name).join(" · ") === "Summary · Coach · Scorecard · Commentary · Partnerships · Analytics · Match details", tabs?.map((t) => t.name).join(" · "));
  ok("...Summary selected first, and each names the panel it controls", tabs?.[0]?.selected === "true" && tabs.every((t) => /^mc-panel-/.test(t.controls ?? "")));
  ok("...every tab at least 44px tall", tabs?.every((t) => t.h >= 44), tabs?.map((t) => t.h).join(","));
  ok("...and on the 12px floor", tabs?.every((t) => t.font >= 12));
  await tid(p, "mc-tab-summary").focus();
  await p.keyboard.press("ArrowRight");
  ok("ArrowRight moves to Coach", await tid(p, "mc-tab-coach").getAttribute("aria-selected") === "true");
  await p.keyboard.press("ArrowRight");
  ok("ArrowRight moves to Scorecard", await tid(p, "mc-tab-scorecard").getAttribute("aria-selected") === "true"
     && await p.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "mc-tab-scorecard");
  await p.keyboard.press("End");
  ok("End goes to Match details", await tid(p, "mc-tab-details").getAttribute("aria-selected") === "true");
  await p.keyboard.press("ArrowRight");
  ok("...and ArrowRight wraps to Summary", await tid(p, "mc-tab-summary").getAttribute("aria-selected") === "true");
  await p.keyboard.press("ArrowLeft");
  await p.keyboard.press("Home");
  ok("Home comes back to Summary", await tid(p, "mc-tab-summary").getAttribute("aria-selected") === "true");
  ok("the tab panel is labelled by its tab", await tid(p, "mc-panel-summary").getAttribute("aria-labelledby") === "mc-tab-summary");

  group("The header: the sides in full, and the match line");
  const title = await tid(p, "mc-title").innerText();
  ok("both sides named in full", /Hilton College 1XI/.test(title) && /Westville Boys' High 1XI/.test(title), title);
  const line = await tid(p, "mc-match-line").innerText();
  ok(`the match line: age group · ground · start ("${line}")`,
     /1st XI · Gordon Sherwood Oval · \w{3} \d{1,2} \w{3} · \d\d:\d\d/.test(line), line);
  ok("...one line of body text", await tid(p, "mc-match-line").evaluate((e) => e.tagName === "P" && parseFloat(getComputedStyle(e).fontSize) >= 14));
  // CRI-1.2: the innings is the status sentence's now (lib/matchCentre.js statusSentence, which the list's cards share).
  const sentence = await tid(p, "mc-status-line").innerText().catch(() => "");
  const chaseWords = `Westville Boys' High 1XI need ${inn2.target - inn2.runs} runs off ${60 - inn2.balls} balls`;
  ok(`the status sentence: "${chaseWords}"`, sentence === chaseWords && await tid(p, "mc-status-line").getAttribute("data-state") === "chase", sentence);
  ok("...and the match line no longer says the innings as well", !/innings/i.test(line), line);

  group("Summary: the Board, with the fold's own figures");
  const total = (await tid(p, "mc-board-total").innerText()).replace(/\s/g, "");
  ok(`the board's total is the fold's (${inn2.runs}/${inn2.wickets})`, total === `${inn2.runs}/${inn2.wickets}`, total);
  ok("...the chase in words", new RegExp(`Need ${inn2.target - inn2.runs} off ${60 - inn2.balls}`).test(await tid(p, "mc-board-sub").innerText()));
  ok("...and no \"At this rate\" in a second innings: the required rate is what the chase shows", !/At this rate/.test(await tid(p, "mc-board-sub").innerText()));
  {
    // GA-I29: the chase's scenarios, held to the package's own words over the same log.
    const sc2 = scenarioOf({ innings: fold.innings, index: 1, target: inn2.target, overs: inn2.overs, events: evs });
    await tid(p, "mc-scenario").waitFor({ timeout: 8000 }).catch(() => {});
    const need = await tid(p, "mc-scenario-need").innerText().catch(() => "");
    ok(`the chase's scenario panel: "${sc2?.lines.find((l) => l.key === "need")?.text}"`, !!sc2 && need === sc2.lines.find((l) => l.key === "need")?.text, need);
    ok("...its wickets in hand", (await tid(p, "mc-scenario-hand").innerText().catch(() => "")) === sc2?.lines.find((l) => l.key === "hand")?.text);
  }
  ok("...the latest lines are the generator's",(await tid(p, "mc-latest").innerText()).includes(expected.filter((c) => c.kind !== "over_end").at(-1).text));

  group("Scorecard: the prototype's layout, from the fold");
  await tab(p, "scorecard");
  ok("an innings toggle, one button per side", await tid(p, "mc-innings-toggle").locator("button").count() === 2);
  await tid(p, "mc-innings-0").click();
  await p.waitForTimeout(300);
  ok("...pressed for the innings shown", await tid(p, "mc-innings-0").getAttribute("aria-pressed") === "true");
  const rows = tid(p, "mc-bat-row");
  ok(`a row per batter who batted (${inn1.batsmen.length})`, await rows.count() === inn1.batsmen.length);
  const out1 = inn1.batsmen.find((b) => b.status === "out");
  const outRow = rows.filter({ hasText: out1.name }).first();
  ok(`the dismissal on the line under the name ("${out1.dismissal}")`,
     (await outRow.locator('[data-testid="mc-dismissal"]').innerText()).trim() === out1.dismissal);
  const notOut = inn1.batsmen.filter((b) => b.status !== "out").length;
  ok(`the not-out batters shaded (${notOut})`, await p.locator('[data-testid="mc-bat-row"][data-not-out="true"]').count() === notOut
     && await p.locator('[data-testid="mc-bat-row"][data-not-out="true"]').first().evaluate((e) => getComputedStyle(e).backgroundColor !== "rgba(0, 0, 0, 0)"));
  const dnb = inn1.squad.length - inn1.batsmen.length;
  ok(`"Did not bat" for the rest of the eleven (${dnb})`, await tid(p, "mc-dnb").count() === dnb
     && (await tid(p, "mc-dnb").first().innerText()).includes("Did not bat"));
  const e = inn1.extras;
  const exText = await tid(p, "mc-extras").innerText();
  ok(`the extras broken out: NB ${e.noBall} · WD ${e.wide} · B ${e.bye} · LB ${e.legBye} · PEN ${e.penalty}`,
     exText.includes(`NB ${e.noBall} · WD ${e.wide} · B ${e.bye} · LB ${e.legBye} · PEN ${e.penalty}`), exText);
  ok(`the total bar: ${inn1.runs}/${inn1.wickets} (10 overs)`, /Total/i.test(await tid(p, "mc-total").innerText())
     && (await tid(p, "mc-total").innerText()).includes(`${inn1.runs}/${inn1.wickets}`) && (await tid(p, "mc-total").innerText()).includes("(10 overs)"));
  ok("the bowling, a row per bowler", await tid(p, "mc-bowling").locator('[role="row"]').count() === inn1.bowlers.length + 1);
  const fowShown = await tid(p, "mc-fow-line").allInnerTexts();
  const fowWant = inn1.fow.map((f) => `${f.runs}/${f.wickets} · ${f.batsman} · ${f.overs}`);
  ok(`the fall of wickets as "${fowWant[2] ?? fowWant[0]}"`, JSON.stringify(fowShown.map((s) => s.trim())) === JSON.stringify(fowWant), fowShown.join(" | "));

  group("SCRBRD-126: the wicket-keeper's † on the card");
  // G Nel kept for Westville in the first innings, T Bekker for Hilton in
  // the second (the fixture's keep tokens): each is marked † on his own
  // side's batting card, and each innings' bowling says who kept in it.
  ok("the fold has them: G Nel kept in the first innings and stumped one; T Bekker in the second",
     inn1.keepers.map((k) => `${k.name}:${k.stumpings}`).join() === "G Nel:1" && inn2.keepers.map((k) => k.name).join() === "T Bekker",
     JSON.stringify([inn1.keepers, inn2.keepers]));
  const markedRows = async () => (await p.locator('[data-testid="mc-bat-row"], [data-testid="mc-dnb"]')
    .filter({ has: p.locator('[data-testid="mc-keeper-mark"]') }).allInnerTexts()).map((s) => s.split("\n")[0].trim());
  const hilMarked = await markedRows();
  ok(`on Hilton's batting, T Bekker alone is marked † (${hilMarked.join(", ")})`, hilMarked.length === 1 && /^T Bekker/.test(hilMarked[0]));
  const keptIn1 = (await tid(p, "mc-keepers").innerText().catch(() => "")).trim();
  ok(`the first innings' bowling says who kept ("${keptIn1}")`, keptIn1 === "Wicket-keeper: G Nel †");
  ok("...and the stumping's line names him", (await p.locator('[data-testid="mc-dismissal"]', { hasText: /^st G Nel b / }).count()) === 1);
  await tid(p, "mc-innings-1").click();
  await p.waitForTimeout(300);
  const wesMarked = await markedRows();
  ok(`on Westville's batting, G Nel alone is marked † (${wesMarked.join(", ")})`, wesMarked.length === 1 && /^G Nel/.test(wesMarked[0]));
  ok("the second innings' bowling says T Bekker kept", (await tid(p, "mc-keepers").innerText().catch(() => "")).trim() === "Wicket-keeper: T Bekker †");
  await tid(p, "mc-innings-0").click();
  await p.waitForTimeout(300);

  group("A batter's row opens: his 1s to 6s, his wagon wheel, the line of his dismissal");
  await outRow.locator('[data-testid="mc-bat-open"]').click();
  await p.waitForTimeout(500);
  ok("the row says it is open", await outRow.locator('[data-testid="mc-bat-open"]').getAttribute("aria-expanded") === "true");
  const counts = await tid(p, "mc-run-counts").innerText();
  const mine = inn1.ballLog.filter((b) => b.strikerId === out1.id).map((b) => runsOffBat(b));
  const want = [1, 2, 3, 4, 6].map((k) => `${mine.filter((r) => r === k).length}\n${k}s`).join("\n");
  ok("his 1s, 2s, 3s, 4s and 6s, counted off the log", counts.replace(/\s+/g, " ").trim() === want.replace(/\s+/g, " "), counts.replace(/\n/g, " "));
  ok("his wagon wheel", await tid(p, "mc-player-row").locator("svg").count() >= 1);
  const wkt = inn1.ballLog.find((b) => b.type === "W" && !b.freeHitSaved && (b.dismissed ?? b.strikerId) === out1.id);
  const wktLine = expected.find((c) => c.key === `e:${wkt.id}`)?.text;
  ok("the commentary line of his dismissal", (await tid(p, "mc-dismissal-line").innerText()).trim() === wktLine, wktLine);

  group("Commentary: the generator's lines, newest first, by over");
  await tab(p, "commentary");
  const lines = await p.locator('[data-testid="mc-line"]').evaluateAll((els) => els.map((e) => ({ key: e.getAttribute("data-key"), text: e.innerText })));
  const newest = expected.filter((c) => c.kind !== "over_end").at(-1);
  ok("the newest line first", lines[0]?.key === newest.key && lines[0].text.includes(newest.text), lines[0]?.text);
  const overs = await tid(p, "mc-over").count();
  ok("grouped by over, latest over first", overs >= 5 && /^Over 5\b/i.test((await tid(p, "mc-over").first().innerText()).trim()));
  ok("every line on screen is word for word the generator's, or a correction's",
     lines.every((l) => l.text.includes(told.find((c) => c.key === l.key)?.text ?? "∅")));
  while (await tid(p, "mc-commentary-more").count()) { await tid(p, "mc-commentary-more").click(); await p.waitForTimeout(300); }
  const all = await p.locator('[data-testid="mc-line"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
  ok(`the whole match, every line but the overs' summaries (${told.filter((c) => c.kind !== "over_end").length})`,
     all.length === told.filter((c) => c.kind !== "over_end").length, all.length);
  ok("...with one correction line for the approved amendment, none for the scorer's undo, and no more (GA-I36)",
     all.filter((k) => k.startsWith("c:")).length === 1 && told.filter((c) => c.kind === "correction").length === 1);
  ok("the voided delivery and the amended one have no line", voided.every((t) => !all.some((k) => k === `e:${t}` || k.startsWith(`e:${t}#`))));
  const body = await tid(p, "mc-commentary").innerText();
  ok("Westville start their innings on the five penalty runs", /Westville Boys' High 1XI start their innings on 5/.test(body));
  ok("the short run is told in words, with no Law clause number", /deliberate short running/.test(body) && !/\bLaws?\s+\d/.test(body));
  ok("the free hit is told, and the wicket it saved", /Free hit: .* bowled, but it's a free hit: not out\./.test(body));
  ok("no id reaches a line", !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(body));

  group("CRI-2.1: at 360 wide, the Commentary's chips keep exactly what the scorecard counts, by event id");
  {
    const NARROW = { width: 360, height: 780 };
    const c21 = await open({ viewport: NARROW });
    await signIn(c21.page, /sarah@example\.invalid|Director/);
    ok("the fixture opens at 360 wide", await openMatch(c21.page, fx.live));
    const P = c21.page;
    await pickTab(P, "commentary");
    await tid(P, "mc-chips").waitFor({ timeout: 4000 }).catch(() => {});
    const chips = await P.locator('[data-testid^="mc-chip-"]').evaluateAll((els) => els.map((e) => ({
      id: e.getAttribute("data-testid").slice(8), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width,
      pressed: e.getAttribute("aria-pressed"), count: e.getAttribute("data-count") })));
    ok("four chips, All pressed, each 44px tall", chips.map((c) => c.id).join() === "all,wickets,fours,sixes"
       && chips[0].pressed === "true" && chips.slice(1).every((c) => c.pressed === "false") && chips.every((c) => c.h >= 43.5), JSON.stringify(chips));
    // The scorecard's own counts, from the same fold: both innings.
    const card = {
      wickets: inn1.wickets + inn2.wickets,
      fours: [inn1, inn2].reduce((t, i) => t + i.batsmen.reduce((u, b) => u + b.fours, 0), 0),
      sixes: [inn1, inn2].reduce((t, i) => t + i.batsmen.reduce((u, b) => u + b.sixes, 0), 0),
    };
    ok(`each chip's count is the scorecard's: ${card.wickets} wickets, ${card.fours} fours, ${card.sixes} sixes`,
       chips.slice(1).every((c) => Number(c.count) === card[c.id]), JSON.stringify(chips.map((c) => c.count)));
    const allLines = async () => {
      while (await tid(P, "mc-commentary-more").count()) { await tid(P, "mc-commentary-more").click(); await P.waitForTimeout(200); }
      return P.locator('[data-testid="mc-line"]').evaluateAll((els) => els.map((e) => ({ key: e.getAttribute("data-key"), kind: e.getAttribute("data-kind") })));
    };
    // The deliveries the card counts, by event id: the fold's own ball log.
    const ids = {
      wickets: expected.filter((x) => x.kind === "wicket").map((x) => x.key).sort(),
      fours: [inn1, inn2].flatMap((i) => i.ballLog.filter((b) => boundaryHit(b) === 4).map((b) => `e:${b.id}`)).sort(),
      sixes: [inn1, inn2].flatMap((i) => i.ballLog.filter((b) => boundaryHit(b) === 6).map((b) => `e:${b.id}`)).sort(),
    };
    for (const id of ["wickets", "fours", "sixes"]) {
      await tid(P, `mc-chip-${id}`).click(); await P.waitForTimeout(300);
      const lines = await allLines();
      const kind = { wickets: "wicket", fours: "four", sixes: "six" }[id];
      ok(`${id}: pressed, and the lines are exactly the card's ${card[id]} deliveries, by event id`, await tid(P, `mc-chip-${id}`).getAttribute("aria-pressed") === "true"
         && lines.length === card[id] && lines.every((l) => l.kind === kind) && lines.map((l) => l.key).sort().join() === ids[id].join(),
         `${lines.length} lines: ${lines.map((l) => l.key).sort().join()} want ${ids[id].join()}`);
    }
    await tid(P, "mc-chip-wickets").click(); await P.waitForTimeout(300);
    const wkOvers = await tid(P, "mc-over-jump").locator("option").evaluateAll((os) => os.filter((o) => o.value).length);
    ok("with a chip on, the over jump offers only the overs it leaves", wkOvers === await tid(P, "mc-over").count() && wkOvers <= card.wickets, `${wkOvers}`);
    await tid(P, "mc-chip-all").click(); await P.waitForTimeout(300);
    ok("All again: every line of the match", (await allLines()).length === told.filter((x) => x.kind !== "over_end").length);
    ok("at 360 wide, nothing is wider than the screen", await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
       await P.evaluate(() => document.documentElement.scrollWidth));
    const small = await P.evaluate(() => [...document.querySelectorAll('[data-testid="mc-commentary-tools"] *')]
      .filter((e) => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).length);
    ok("...and nothing in the chips or the jump is under 12px", small === 0, small);
    ok("no console errors (chips)", c21.errors.length === 0, c21.errors.join(" | "));
    await c21.ctx.close();

  }

  group("Partnerships, Analytics and Match details");
  await tab(p, "partnerships");
  await tid(p, "mc-innings-0").click(); await p.waitForTimeout(200);
  // The fold closes a stand at a wicket; the pair still in at the end of the
  // overs is the innings' last stand, unbroken.
  const stands = inn1.partnerships.length + (inn1.striker && inn1.nonStriker ? 1 : 0);
  ok(`a row per stand of the first innings, the last unbroken (${stands})`, await tid(p, "mc-partnership").count() === stands
     && /unbroken/i.test(await tid(p, "mc-partnership").last().innerText()));
  await tab(p, "analytics");
  ok("the analytics draw", await tid(p, "mc-analytics").count() === 1);

  group("Every chart has a table (GA-I31): closed until asked, then the figures the chart draws");
  {
    await tid(p, "mc-innings-0").click(); await p.waitForTimeout(400);
    const A = tid(p, "mc-analytics");
    ok("no table in the Analytics tab until one is asked for", await A.locator("table").count() === 0);
    const CHARTS = ["worm", "manhattan", "batsman", "bowler", "wheel", "heat", "spider"];
    for (const id of CHARTS) {
      const t = tid(p, `${id}-table-toggle`);
      const box = await t.boundingBox().catch(() => null);
      ok(`${id}: a Show as table button, shut, 44px tall`, await t.count() === 1 && await t.getAttribute("aria-expanded") === "false"
         && /Show as table/.test(await t.innerText()) && !!box && box.height >= 44, box?.height);
    }
    const open1 = async (id) => {
      await tid(p, `${id}-table-toggle`).click(); await p.waitForTimeout(200);
      return { expanded: await tid(p, `${id}-table-toggle`).getAttribute("aria-expanded"),
        tables: await tid(p, `${id}-table`).locator("table").evaluateAll((ts) => ts.map((t) => ({
          caption: t.querySelector("caption")?.innerText.trim(),
          heads: [...t.querySelectorAll("thead th")].map((c) => c.innerText.trim()),
          scopes: [...t.querySelectorAll("th")].map((c) => c.getAttribute("scope")).join(),
          rows: [...t.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.innerText.trim())) }))) };
    };
    // Runs per over: each row is the bar beside it.
    const man = await open1("manhattan");
    const bars = await A.locator("rect[data-over]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-over"), e.getAttribute("data-runs")]));
    ok("runs per over: it opens, one captioned table with scoped headers", man.expanded === "true" && man.tables.length === 1 && !!man.tables[0].caption && !/null|^$/.test(man.tables[0].scopes));
    ok("...a row for every bar, with the bar's own runs", man.tables[0].rows.length === bars.length && bars.length >= 5
       && man.tables[0].rows.every((r, k) => r[0].split(" ")[0] === bars[k][0] && r[1] === bars[k][1]), JSON.stringify(man.tables[0].rows.slice(0, 3)));
    ok(`...and they add up to the first innings' ${inn1.runs}`, man.tables[0].rows.reduce((s, r) => s + Number(r[1]), 0) === inn1.runs
       || await A.locator('[data-testid="manhattan-unplaced"]').count() === 1);
    // The worm: both innings end on the fold's score, and every wicket marker is a row.
    const worm = await open1("worm");
    const lastOf = (t) => t.rows.at(-1);
    ok("the worm: a table for each innings, and the fall of wickets", worm.tables.length === 3 && /Fall of wickets/.test(worm.tables[2].caption), worm.tables.map((t) => t.caption).join(" | "));
    ok(`...innings one ends on the fold's ${inn1.runs}/${inn1.wickets}`, Number(lastOf(worm.tables[0])[1]) === inn1.runs && Number(lastOf(worm.tables[0])[2]) === inn1.wickets, lastOf(worm.tables[0]));
    ok(`...innings two on its ${inn2.runs}/${inn2.wickets}`, Number(lastOf(worm.tables[1])[1]) === inn2.runs && Number(lastOf(worm.tables[1])[2]) === inn2.wickets, lastOf(worm.tables[1]));
    ok("...a fall-of-wickets row for each marker the worm draws, the batter named", worm.tables[2].rows.length === await p.evaluate(() => document.querySelectorAll('[data-testid="mc-analytics"] circle[r="4.5"]').length)
       && worm.tables[2].rows.length === inn1.fow.length + inn2.fow.length && worm.tables[2].rows.slice(0, inn1.fow.length).every((r, k) => r[3] === inn1.fow[k].batsman), JSON.stringify(worm.tables[2].rows.slice(0, 2)));
    // Batters and bowlers: the card's order, the fold's figures.
    const bat = await open1("batsman");
    const wantBat = inn1.batsmen.filter((b) => b.balls > 0).sort((a, b) => b.runs - a.runs).slice(0, 6);
    ok("batsmen: the chart's bars, in its order, with the fold's runs and balls", bat.tables[0].rows.length === wantBat.length
       && wantBat.every((b, k) => bat.tables[0].rows[k][0].replace("*", "") === b.name && Number(bat.tables[0].rows[k][1]) === b.runs && Number(bat.tables[0].rows[k][2]) === b.balls), JSON.stringify(bat.tables[0].rows.slice(0, 2)));
    const bowl = await open1("bowler");
    const wantBowl = inn1.bowlers.filter((b) => b.balls > 0).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs).slice(0, 6);
    ok("bowlers: the chart's rows, with the fold's wickets and runs", bowl.tables[0].rows.length === wantBowl.length
       && wantBowl.every((b, k) => bowl.tables[0].rows[k][0].replace("*", "") === b.name && Number(bowl.tables[0].rows[k][2]) === b.wickets && Number(bowl.tables[0].rows[k][3]) === b.runs), JSON.stringify(bowl.tables[0].rows.slice(0, 2)));
    // The wheel, the heat map and the spider: one row for each thing drawn.
    const wheel = await open1("wheel");
    const spokes = await tid(p, "shot-wheel").locator("[data-spoke]").evaluateAll((els) => els.map((e) => e.querySelector("title")?.textContent));
    ok(`the wheel: a row for each of its ${spokes.length} spokes, saying what the spoke's tooltip says`, spokes.length >= 5 && wheel.tables[0].rows.length === spokes.length
       && wheel.tables[0].rows.every((r, k) => spokes[k].startsWith(r[1]) && (r[2] === "—" || spokes[k].includes(r[2]))), JSON.stringify(wheel.tables[0].rows.slice(0, 2)) + " / " + spokes.slice(0, 2));
    const heat = await open1("heat");
    const cells = await tid(p, "shot-heat-map").locator(".heat-cell").count();
    ok(`the heat map: a row for each of its ${cells} cells, the hottest first at the peak`, cells > 0 && heat.tables[0].rows.length === cells && Number(heat.tables[0].rows[0][2]) === 100
       && heat.tables[0].rows.every((r, k, a) => k === 0 || Number(a[k - 1][2]) >= Number(r[2])), JSON.stringify(heat.tables[0].rows.slice(0, 2)));
    const spider = await open1("spider");
    const axes = await tid(p, "shot-spider").locator("[data-testid^='spider-axis-']").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-shots"))));
    ok("the spider: a row for each axis, with the shots the axis prints", spider.tables[0].rows.length === axes.length && axes.length === 12
       && spider.tables[0].rows.every((r, k) => Number(r[1]) === axes[k]), JSON.stringify(spider.tables[0].rows.slice(0, 3)));
    // The tables sit in the page: a phone's width does not grow, and the tab is shut again with a second tap.
    await p.setViewportSize(PHONE); await p.waitForTimeout(400);
    ok("at 390 wide, with every table open, nothing is wider than the screen", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
       await p.evaluate(() => document.documentElement.scrollWidth));
    const small = await p.evaluate(() => [...document.querySelectorAll('[data-testid="mc-analytics"] table *')].filter((e) => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).length);
    ok("...and nothing in a table is under 12px", small === 0, small);
    await p.setViewportSize(DESK); await p.waitForTimeout(300);
    for (const id of CHARTS) await tid(p, `${id}-table-toggle`).click();
    await p.waitForTimeout(200);
    ok("a second tap shuts each one: no table is left", await A.locator("table").count() === 0 && await A.locator('[data-testid$="-table-toggle"][aria-expanded="true"]').count() === 0);
  }
  group("CRI-2.3: a Manhattan bar and a wagon-wheel area open the Commentary at their balls, by event id; every run traced to a listed ball");
  {
    const d23 = await open({ viewport: PHONE });
    await signIn(d23.page, /sarah@example\.invalid|Director/);
    ok("the fixture opens", await openMatch(d23.page, fx.live));
    const D3 = d23.page;
    const scrolled = () => D3.evaluate(() => Math.max(document.getElementById("os-content")?.scrollTop ?? 0, window.scrollY));
    await pickTab(D3, "analytics");
    await tid(D3, "mc-innings-0").click({ timeout: 4000 }).catch(() => {});
    await D3.waitForTimeout(300);
    // The bars' events, as the chart projects them: the same projection, over the same log.
    const proj1 = projectMatch(fold.innings, { events: evs, overs: 10 })[0];
    const parts1 = overParts(inn1, evs.filter((e) => (e.innings ?? 0) === 0));
    const partsOf = (o) => parts1.get(o.over) ?? [];
    const runsOf = new Map([...parts1.values()].flat().map((x) => [x.id, x.runs]));
    const listed = () => D3.locator('[data-testid="mc-line"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
    const backToCharts = async () => {
      await tid(D3, "mc-back-to-scorecard").click({ timeout: 4000 });
      await tid(D3, "mc-analytics").waitFor({ timeout: 4000 }).catch(() => {});
      await D3.waitForTimeout(300);
    };
    let traced = 0, runsTraced = 0;
    /** @type {string[]} */ const bad = [];
    let wasAt = 0, backAt = 0, banner = "";
    for (const o of proj1.overs) {
      const g = D3.locator(`[data-drill-over="${o.over + 1}"]`);
      if (!(await g.count())) { bad.push(`over ${o.over + 1}: no bar to tap`); continue; }
      await g.scrollIntoViewIfNeeded();
      // Over 7's bar at the foot of the screen: the page scrolled, to be put back.
      if (o.over === 6) { await g.evaluate((e) => e.scrollIntoView({ block: "end", behavior: "instant" })); await D3.waitForTimeout(100); wasAt = await scrolled(); }
      // Over 7 by a click that does not move the page first (a pointer's click would scroll the bar into the middle).
      if (o.over === 6) await g.dispatchEvent("click"); else await g.click();
      await tid(D3, "mc-drill").waitFor({ timeout: 4000 }).catch(() => {});
      await D3.waitForTimeout(200);
      const keys = await listed();
      const want = partsOf(o).map((x) => `e:${x.id}`).sort();
      const sum = keys.reduce((s, k) => s + (runsOf.get(k.slice(2)) ?? NaN), 0);
      if (keys.slice().sort().join() !== want.join()) bad.push(`over ${o.over + 1}: listed ${keys.length}, the bar's ${want.length}`);
      else if (sum !== o.runs) bad.push(`over ${o.over + 1}: listed balls add to ${sum}, the bar says ${o.runs}`);
      else { traced++; runsTraced += sum; }
      if (o.over === 2) banner = await tid(D3, "mc-drill-what").innerText();
      await backToCharts();
      if (o.over === 6) backAt = await scrolled();
    }
    ok(`every one of the first innings' ${proj1.overs.length} bars lists exactly its own events in the Commentary, and they add up to the bar's runs`,
       bad.length === 0 && traced === proj1.overs.length, bad.join(" | "));
    ok(`...so every run of the ${inn1.runs} is traced to a listed ball (${runsTraced} in the bars, ${proj1.opening + proj1.closing} not placed in an over)`,
       runsTraced + proj1.opening + proj1.closing === inn1.runs, `${runsTraced} + ${proj1.opening + proj1.closing}`);
    const o3 = proj1.overs[2];
    ok(`over 3, with the helmet's five: the line names the over, its runs, its balls and the award (${banner})`,
       new RegExp(`^Over 3 · ${o3.runs} runs · \\d+ balls and 1 award, listed below$`).test(banner), banner);
    ok(`the way back is the charts, where the page was (${backAt}px, was ${wasAt}px)`, Math.abs(backAt - wasAt) <= 2 && wasAt > 100, `${backAt} ${wasAt}`);
    // The keyboard's way: the picker under the chart.
    const pick = tid(D3, "manhattan-pick");
    const pickBox = await pick.boundingBox().catch(() => null);
    const showBox = await tid(D3, "manhattan-show").boundingBox().catch(() => null);
    ok("a picker and its button under the chart, 44px each, the button shut until an over is chosen", (pickBox?.height ?? 0) >= 43.5 && (showBox?.height ?? 0) >= 43.5
       && await tid(D3, "manhattan-show").isDisabled());
    await pick.selectOption({ label: `Over 5 · ${proj1.overs[4].runs} runs` });
    await tid(D3, "manhattan-show").click();
    await tid(D3, "mc-drill").waitFor({ timeout: 4000 }).catch(() => {});
    await D3.waitForTimeout(200);
    ok("...over 5 by the picker: the same balls as its bar", (await listed()).sort().join() === partsOf(proj1.overs[4]).map((x) => `e:${x.id}`).sort().join());
    ok("...the focus on the line saying what is listed", await D3.evaluate(() => document.activeElement?.getAttribute("data-testid") === "mc-drill-what"));
    await tid(D3, "mc-drill-all").click(); await D3.waitForTimeout(300);
    const latest = `Over ${inn2.ballLog.at(-1).over + 1}`;
    ok(`"Every ball": the filter gone, All pressed, the latest over (${latest} of the chase) first`, await tid(D3, "mc-drill").count() === 0
       && await tid(D3, "mc-chip-all").getAttribute("aria-pressed") === "true" && (await tid(D3, "mc-over-title").first().innerText()).trim().toLowerCase() === latest.toLowerCase(),
       await tid(D3, "mc-over-title").first().innerText());
    await backToCharts().catch(() => {});
    if (!(await tid(D3, "mc-analytics").count())) { await pickTab(D3, "analytics"); }
    await tid(D3, "mc-innings-0").click({ timeout: 4000 }).catch(() => {});
    await D3.waitForTimeout(300);

    // A wagon-wheel area: the balls that went there, by event id, adding up to its runs.
    const wa = wagonAnalysis(inn1.ballLog, { batHandFor: (b) => batHandOf(inn1, b.strikerId) });
    const areas = wa.areas.filter((a) => a.ids.length > 0);
    const valueOf = new Map(inn1.ballLog.map((b) => [b.id, Number(b.value) || 0]));
    const badA = [];
    let tapsOk = true;
    for (const ar of areas) {
      const id = `wagon-area-${ar.label.toLowerCase().replace(/\s+/g, "-")}`;
      const cell = tid(D3, id);
      // Read in the page in one step: a live fixture's poll draws the panel again under a locator.
      const box = await D3.evaluate((t) => { const e = document.querySelector(`[data-testid="${t}"]`); return e && { h: e.getBoundingClientRect().height, tag: e.tagName }; }, id);
      if (!box || box.h < 43.5 || box.tag !== "BUTTON") { tapsOk = false; badA.push(`${ar.label}: not a 44px button (${JSON.stringify(box)})`); continue; }
      await cell.click();
      await tid(D3, "mc-drill").waitFor({ timeout: 4000 }).catch(() => {});
      await D3.waitForTimeout(200);
      const keys = await listed();
      const sum = keys.reduce((s, k) => s + (valueOf.get(k.slice(2)) ?? NaN), 0);
      if (keys.slice().sort().join() !== ar.ids.map((x) => `e:${x}`).sort().join()) badA.push(`${ar.label}: listed ${keys.length}, the area's ${ar.ids.length}`);
      else if (sum !== ar.runs) badA.push(`${ar.label}: ${sum} listed, ${ar.runs} on the area`);
      await backToCharts();
      await tid(D3, "mc-innings-0").click({ timeout: 4000 }).catch(() => {});
      await D3.waitForTimeout(200);
    }
    ok(`each of the ${areas.length} areas with balls in it is a 44px button`, tapsOk && areas.length >= 4, badA.join(" | "));
    ok("...and lists exactly its balls, adding up to its runs", badA.length === 0, badA.join(" | "));
    const empty = wa.areas.find((a) => a.ids.length === 0);
    ok(`an area nothing went to (${empty?.label ?? "none"}) is not a button`, !empty
       || await tid(D3, `wagon-area-${empty.label.toLowerCase().replace(/\s+/g, "-")}`).evaluate((e) => e.tagName !== "BUTTON"));
    ok("at 390 wide, nothing is wider than the screen (the drill-down)", await D3.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok("no console errors (drill-down)", d23.errors.length === 0, d23.errors.join(" | "));
    await d23.ctx.close();
  }

  group("CRI-2.5, by persona: a parent and a pupil have three charts on Analytics (the worm with its wickets, runs per over, the partnerships); the coach, the scorer and the director every one");
  {
    const ALL = ["worm", "manhattan", "partnership", "batsman", "bowler", "wheel", "heat", "spider"];
    const THREE = ["worm", "manhattan", "partnership"];
    /** The charts the Analytics tab draws, by their tables' toggles, and what else is there. */
    const chartsOf = async (P) => {
      await pickTab(P, "analytics");
      await tid(P, "mc-analytics").waitFor({ timeout: 6000 }).catch(() => {});
      await tid(P, "mc-innings-1").click({ timeout: 3000 }).catch(() => {});
      await P.waitForTimeout(300);
      return P.evaluate(() => {
        const A = document.querySelector('[data-testid="mc-analytics"]');
        return {
          analysis: A?.getAttribute("data-analysis") ?? null,
          charts: [...(A?.querySelectorAll('[data-testid$="-table-toggle"]') ?? [])].map((e) => e.getAttribute("data-testid").replace(/-table-toggle$/, "")),
          wagon: !!A?.querySelector('[data-testid="wagon-analysis"]'),
          wheel: !!A?.querySelector('[data-testid="shot-wheel"]'),
          pins: A?.querySelectorAll('circle[r="4.5"]').length ?? 0,
          stands: A?.querySelectorAll('[data-testid="mc-partnership-bar"]').length ?? 0,
          wide: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
    };
    // A family opens the fixture from its own Matches (family mode: the child's 1st XI plays in it).
    const who = [
      ["the parent (guardian)", "parent@example.invalid", THREE, "spectator", true],
      ["the pupil (player, 1st XI)", "spectator@example.invalid", THREE, "spectator", true],
      ["the 1st XI's coach", "coach@example.invalid", ALL, "full", false],
      ["the scorer (staff, no analytics.read)", "scorer@example.invalid", ALL, "full", false],
      ["the director of sport", "sarah@example.invalid", ALL, "full", false],
    ];
    const stands2 = inn2.partnerships.length + (inn2.striker && inn2.nonStriker ? 1 : 0);
    for (const [label, email, want, analysis, family] of who) {
      const s = await open({ viewport: PHONE });
      await click(s.page, /Get Started|Log In/, 5000);
      await s.page.waitForTimeout(500);
      await s.page.locator("#login-email").fill(email);
      await click(s.page, /^Sign In$/, 5000);
      await afterReads(s.page, 2200);
      ok(`${label} signs in`, (await tid(s.page, "persona-bar").count()) === 1 || /Match Centre|Dashboard/i.test(await text(s.page)));
      let opened;
      if (family) {
        await s.page.locator('[data-testid="mnav-mymatches"], [data-testid="nav-mymatches"]').first().click({ timeout: 6000 }).catch(() => {});
        await afterReads(s.page, 1800);
        // The fixture is live: the family list draws it as a live row (a played row once it is over).
        await s.page.locator(`[data-testid="live-row-${fx.live}"], [data-testid="played-row-${fx.live}"]`).first().click({ timeout: 6000 }).catch(() => {});
        await tid(s.page, "match-view").waitFor({ timeout: 10000 }).catch(() => {});
        await afterReads(s.page, 1500);
        opened = (await tid(s.page, "match-view").count()) === 1;
      } else opened = await openMatch(s.page, fx.live);
      ok(`...and opens the fixture${family ? ", from the family's own Matches" : ""}`, opened);
      if (!opened) { await s.ctx.close(); continue; }
      const c = await chartsOf(s.page);
      ok(`${label}: ${want.length} charts, ${want.join(", ")} (${analysis})`, c.analysis === analysis && c.charts.join() === want.join(), JSON.stringify(c));
      ok(`...the worm with its ${inn1.fow.length + inn2.fow.length} wicket pins, and a bar for each of the second innings' ${stands2} stands`,
         c.pins === inn1.fow.length + inn2.fow.length && c.stands === stands2, `${c.pins} pins, ${c.stands} stands`);
      if (analysis === "spectator") ok("...no wheel, no wagon-wheel analysis", !c.wheel && !c.wagon);
      else ok("...the wheel and the wagon-wheel analysis", c.wheel && c.wagon);
      ok("...nothing wider than the screen at 390", !c.wide);
      ok(`no console errors (${label})`, s.errors.length === 0, s.errors.join(" | "));
      await s.ctx.close();
    }
  }

  await tab(p, "details");
  const det = await tid(p, "mc-details").innerText();
  ok("the format, the ground and the toss", /T10 · 10 overs a side/.test(det) && /Gordon Sherwood Oval/.test(det)
     && /Hilton College 1XI won the toss and chose to bat/.test(det), det.slice(0, 200));
  group("CRI-1.4: Enter scoring is offered to the director of sport, and reading every tab never entered it");
  {
    const enter = tid(p, "mc-enter-scoring");
    const geo = await enter.evaluate((e) => ({ h: e.getBoundingClientRect().height, f: parseFloat(getComputedStyle(e).fontSize), t: e.textContent.trim() })).catch(() => null);
    ok("the live fixture offers \"Enter scoring\" (scoring.edit at Hilton, the fixture's home school)", await enter.count() === 1 && geo?.t === "Enter scoring", geo?.t);
    ok("...a 44px button on the 12px floor", (geo?.h ?? 0) >= 44 && (geo?.f ?? 0) >= 12, JSON.stringify(geo));
    ok("reading the fixture, every tab of it, asked no write of the match: no claim, no ball, no handover",
       dosWrites.length === 0, dosWrites.join(" | "));
    ok("...and the pad never opened: the reader is still on the match page", await p.locator(".scorer-shell").count() === 0 && await tid(p, "match-view").count() === 1);
  }
  await tid(p, "mc-back").click(); await p.waitForTimeout(600);
  ok("All matches goes back to the list", await tid(p, "match-view").count() === 0 && await tid(p, `match-card-${fx.live}`).count() === 1);
  // CRI-1.2: the card's sentence is the same function's, from the list's own read (no log): the toss it carries.
  const cardSays = await tid(p, `mc-card-status-${fx.live}`).innerText().catch(() => "");
  ok(`...its card says where it stands, from the list's read ("${cardSays}")`, cardSays === "Hilton College 1XI won the toss and chose to bat", cardSays);

  group("The innings break: the break card on Summary");
  ok("the second fixture opens", await openMatch(p, fx.brk));
  const brk = deriveMatch(fx.events[fx.brk]).innings[0];
  const card = await tid(p, "innings-break").innerText().catch(() => "");
  ok(`"Kearsney College U16A need ${brk.runs + 1} to win"`, new RegExp(`Kearsney College U16A need ${brk.runs + 1} to win`).test(card), card.slice(0, 160));
  const top = [...brk.batsmen].sort((a, b) => b.runs - a.runs || a.balls - b.balls)[0];
  ok(`top scorer ${top.name} ${top.runs}`, (await tid(p, "ib-top-scorers").innerText()).includes(top.name));
  ok("best bowling, most boundaries, best strike rate", await tid(p, "ib-best-bowling").count() === 1 && await tid(p, "ib-boundaries").count() === 1
     && await tid(p, "ib-strike-rate").count() === 1);
  ok("the status sentence says so", new RegExp(`^Innings break: Kearsney College U16A need ${brk.runs + 1} to win`).test(await tid(p, "mc-status-line").innerText().catch(() => "")),
     await tid(p, "mc-status-line").innerText().catch(() => ""));
  ok("...and a finished innings has no \"At this rate\" on its board", !/At this rate/.test(await tid(p, "mc-board-sub").innerText().catch(() => "")));
  ok("no console errors (desktop)", dos.errors.length === 0, dos.errors.join(" | "));
  await dos.ctx.close();

  group("The spectator's side: highlights, and nothing replayed on a fresh load");
  // 1280×800: the desktop size SCRBRD-100's screenshots ask for, so the one
  // genuinely transient state — the result's moment — is captured at the
  // right size the one time it fires, rather than re-derived per viewport.
  const lv = await open({ liveMs: 1500, viewport: { width: 1280, height: 800 } });
  await signIn(lv.page, /sarah@example\.invalid|Director/);
  ok("the fixture opens, read every 1.5 s", await openMatch(lv.page, fx.live));
  const L = lv.page;
  const wantHi = expected.filter((c) => ["four", "six", "wicket", "milestone"].includes(c.kind));
  const hi = await L.locator('[data-testid="mc-highlight"]').evaluateAll((els) => els.map((e) => ({ key: e.getAttribute("data-key"), kind: e.getAttribute("data-kind"), text: e.innerText })));
  ok(`every boundary, wicket and milestone, in order (${wantHi.length})`, hi.length === wantHi.length
     && hi.every((h, i) => h.key === wantHi[i].key && h.text.includes(wantHi[i].text)), hi.slice(0, 3).map((h) => h.key).join(","));
  ok("...wickets among them", hi.some((h) => h.kind === "wicket") && hi.some((h) => h.kind === "six"));
  await afterReads(L, 3500);
  ok("a fresh load plays no moment and no over summary (two reads later)",
     await tid(L, "mc-moment").count() === 0 && await tid(L, "mc-over-summary").count() === 0);

  ok("GA-I29: the chase's scenario panel is drawn while it is being played", await tid(L, "mc-scenario").count() === 1);

  group("What arrives while the page is open: a moment, the runs ticking, the over's summary");
  const before = (await tid(L, "mc-board-total").innerText()).replace(/\s/g, "");
  const late = [
    { ...ball({ value: 4, shot: "drive", ...placementFromTap({ angle: 250, radius: 1 }) }), innings: 1, id: "mc-live-late-1" },
    { ...ball({ value: 1 }), innings: 1, id: "mc-live-late-2" },
    { ...ball({ value: 0 }), innings: 1, id: "mc-live-late-3" },
  ];
  await writeEvents(q, fx.live, late, evs.length);
  const after = deriveMatch([...evs, ...late]).innings[1];
  const seen = new Set();
  const watch = setInterval(async () => { seen.add((await tid(L, "mc-board-runs").innerText().catch(() => "")).trim()); }, 60);
  ok("a four gets its beat on the board", await until(L, () => !!document.querySelector('[data-testid="mc-moment"][data-kind="four"]'), 8000));
  ok("...beside the total, which stays in view", await tid(L, "mc-board-total").isVisible());
  ok(`the board reaches the new total (${after.runs}/${after.wickets})`, await until(L, (want) =>
    document.querySelector('[data-testid="mc-board-total"]')?.innerText.replace(/\s/g, "") === want, 6000, `${after.runs}/${after.wickets}`), before);
  clearInterval(watch);
  const ticks = [...seen].filter((v) => /^\d+$/.test(v)).map(Number).filter((v) => v > Number(before.split("/")[0]) && v <= after.runs);
  ok(`...ticking up through the runs between, not jumping (${[...new Set(ticks)].join(" ")})`, new Set(ticks).size >= 2, [...seen].join(","));
  ok("the over's summary shows", await until(L, () => /End of over 5:/.test(document.querySelector('[data-testid="mc-over-summary"]')?.innerText ?? ""), 8000));
  ok("...the generator's own line, with the score", (await tid(L, "mc-over-summary").innerText().catch(() => "")).includes(`${after.runs}/${after.wickets}`));
  ok("the moment clears within a second and a half", await until(L, () => !document.querySelector('[data-testid="mc-moment"]'), 2500));
  ok("the over summary clears after a few seconds", await until(L, () => !document.querySelector('[data-testid="mc-over-summary"]'), 9000));

  group("Big-screen mode: the board, full screen, from the boundary");
  await tid(L, "mc-bigscreen-open").click();
  await L.waitForTimeout(500);
  const bigBox = await tid(L, "mc-bigscreen").evaluate((e) => {
    const r = e.getBoundingClientRect(), t = document.querySelector('[data-testid="mc-bigscreen-total"]');
    return { w: r.width, h: r.height, bg: getComputedStyle(e).backgroundColor, font: t ? parseFloat(getComputedStyle(t).fontSize) : 0,
      text: t?.innerText.replace(/\s/g, "") ?? "", vw: innerWidth, vh: innerHeight, modal: e.getAttribute("aria-modal") };
  }).catch(() => null);
  ok("it fills the screen", bigBox && bigBox.w >= bigBox.vw - 1 && bigBox.h >= bigBox.vh - 1, JSON.stringify(bigBox));
  ok("...in the board's own black", bigBox?.bg === "rgb(11, 14, 11)", bigBox?.bg);
  ok(`...the total in figures large enough for the boundary (${bigBox?.font}px)`, (bigBox?.font ?? 0) >= 96);
  ok("...and it is the live total", bigBox?.text === `${after.runs}/${after.wickets}`, bigBox?.text);
  ok("...a labelled way out", (await tid(L, "mc-bigscreen-close").innerText()).trim() === "Exit big screen");
  // SCRBRD-133 D11: the big screen is the ground display's own view, fed by
  // the signed-in names — the Board band and a panel beneath it.
  ok("...it is the ground display's view: the Board and a panel in its turn",
     await L.locator('[data-testid="mc-bigscreen"] [data-testid="display-board"]').count() === 1
     && /^(worm|partnership|overs|bowling|break|result|stopped|fow)$/.test(await tid(L, "mc-bigscreen").getAttribute("data-panel") ?? ""),
     await tid(L, "mc-bigscreen").getAttribute("data-panel"));
  await L.keyboard.press("Space");
  ok("...Space pauses the rotation, and Space again resumes it", await tid(L, "mc-bigscreen").getAttribute("data-paused") === "true"
     && await L.keyboard.press("Space").then(() => tid(L, "mc-bigscreen").getAttribute("data-paused")) === "false");
  await L.keyboard.press("Escape");
  await L.waitForTimeout(300);
  ok("Escape leaves it", await tid(L, "mc-bigscreen").count() === 0 && await tid(L, "match-view").count() === 1);
  await tid(L, "mc-bigscreen-open").click();
  await L.waitForTimeout(300);
  await tid(L, "mc-bigscreen-close").click();
  await L.waitForTimeout(300);
  ok("...and so does its button", await tid(L, "mc-bigscreen").count() === 0);

  group("SCRBRD-100: the result, decided live, in one clear moment — never replayed, never hiding the score long");
  // Finish the chase, live, with exactly the runs the fold says are needed —
  // no invented score. The innings sits at an over's end (5.0, after the
  // "late" balls above), so a bowler is named before the next delivery, the
  // same as every over-start in the fixture itself.
  const secondSoFar = [...fx.events[fx.live].filter((e) => e.innings === 1), ...late];
  const chaseNow = deriveInnings(secondSoFar);
  let owed = chaseNow.target - chaseNow.runs;
  const closing = [];
  let cN = 0;
  const addClosing = (ev) => { const e = { ...ev, innings: 1, id: `mc-close-${++cN}`, clientTs: Date.now() + cN }; closing.push(e); return e; };
  addClosing(bowler({ bowler: fx.players["A Dlamini"] }));
  while (owed > 0) { const v = owed >= 6 ? 6 : owed >= 4 ? 4 : owed; addClosing(ball({ value: v })); owed -= v; }
  const decided = deriveInnings([...secondSoFar, ...closing]);
  addClosing(sealInnings(decided, decided.endReason ?? "target"));
  await writeEvents(q, fx.live, closing, evs.length + late.length);
  const finalMatch = deriveMatch([...evs, ...late, ...closing]);
  ok("the chase is won", finalMatch.result?.winner === "Westville Boys' High 1XI", JSON.stringify(finalMatch.result));
  ok("GA-I29: once play has decided it, the scenario panel is gone", await until(L, () => !document.querySelector('[data-testid="mc-scenario"]'), 8000));
  ok("the result arrives as a moment on the board — held no longer than a milestone",
     await until(L, () => document.querySelector('[data-testid="mc-moment"][data-kind="result"]')?.innerText.includes("won by"), 8000));
  // CRI-1.7: the result is full time, and the Summary is the result view the moment it arrives; the totals stay in view.
  ok("...over the Summary's result view, whose totals stay in view throughout", await tid(L, "mc-result-view").isVisible().catch(() => false)
     && await tid(L, "mc-result-total").last().isVisible().catch(() => false));
  if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await L.screenshot({ path: join(SHOTS, "fulltime-result-moment-1280-floodlit.png") }).catch(() => {}); }
  ok("the moment clears within a second and a half — the score is never hidden for long (§3.6)",
     await until(L, () => !document.querySelector('[data-testid="mc-moment"]'), 2500));
  ok("the header now says Result, and gives the winner and the margin in words",
     await until(L, () => document.querySelector('[data-testid="mc-status"]')?.textContent === "Result", 8000));
  const resultLine = await tid(L, "mc-result").innerText().catch(() => "");
  ok(`"${finalMatch.result.winner} won by ${finalMatch.result.margin}"`, resultLine === `${finalMatch.result.winner} won by ${finalMatch.result.margin}`, resultLine);
  ok("no console errors (live)", lv.errors.length === 0, lv.errors.join(" | "));
  await lv.ctx.close();

  // The match is decided; nothing about `match.status` says so yet (that
  // column only ever moves through `scoring.finalise`, never from the ball
  // log by itself), so the onward links and the confirm-or-correct prompt —
  // both gated on it — need it set, the way finishing a match for real would.
  await q(`update match set status = 'complete' where id = $1`, [fx.live]);

  group("SCRBRD-100: the full-time screen links onward");
  const fin = await open();
  ok("the director of sport signs in", await signIn(fin.page, /sarah@example\.invalid|Director/));
  ok("the decided fixture opens", await openMatch(fin.page, fx.live));
  await afterReads(fin.page, 2000);
  ok("a fresh read plays no moment a second time — nothing is replayed on load", await tid(fin.page, "mc-moment").count() === 0);
  {
    // CRI-1.7: after full time the Summary is the result view, from the fold.
    const F = fin.page;
    const want = `${finalMatch.result.winner} won by ${finalMatch.result.margin}`;
    const finals = finalMatch.innings.filter(Boolean);
    ok("CRI-1.7: the completed fixture's Summary is the result view", await tid(F, "mc-summary").getAttribute("data-view").catch(() => null) === "result"
       && await tid(F, "mc-result-view").count() === 1);
    ok(`...headed by the result in words, the header's own ("${want}")`, (await tid(F, "mc-result-sentence").innerText().catch(() => "")).trim() === want
       && (await tid(F, "mc-result").innerText().catch(() => "")).trim() === want);
    const rowsShown = (await tid(F, "mc-result-row").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    ok(`...each innings' total, the fold's: ${finals.map((i) => `${i.runs}/${i.wickets}`).join(", ")}`, rowsShown.length === finals.length
       && finals.every((i, k) => rowsShown[k].includes(`${i.runs}/${i.wickets}`) && rowsShown[k].includes(`(${oversOfBalls(i.balls)} ov)`)), rowsShown.join(" | "));
    ok("...on the board's black face, in both themes", await tid(F, "mc-result-view").evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => "") !== "rgba(0, 0, 0, 0)");
    const facts = await tid(F, "mc-result-innings").allInnerTexts();
    const top1 = [...finals[0].batsmen].filter((b) => b.balls > 0 || b.runs > 0).sort((a, b) => b.runs - a.runs || a.balls - b.balls)[0];
    const bowl2 = [...finals[1].bowlers].filter((b) => b.balls > 0).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
    ok(`...the match in figures: each innings' top scorers and best bowling (${top1.name} ${top1.runs}; ${bowl2.name} ${bowl2.wickets}/${bowl2.runs})`,
       facts.length === 2 && facts[0].includes(top1.name) && facts[0].includes(String(top1.runs)) && facts[1].includes(bowl2.name)
       && facts[1].includes(`${bowl2.wickets}/${bowl2.runs}`), facts.join(" | ").slice(0, 300));
    ok("...the live board, the latest balls and \"at this rate\" have given way to it", await tid(F, "mc-board").count() === 0
       && await tid(F, "mc-latest").count() === 0 && !/At this rate/.test(await tid(F, "mc-summary").innerText()));
    ok("...and so has the scenario panel (GA-I29: none at full time)", await tid(F, "mc-scenario").count() === 0);
    ok("...the worm, the highlights and all the commentary one tap away stay", await tid(F, "mc-worm-panel").count() === 1
       && await tid(F, "mc-highlights").count() === 1 && await tid(F, "mc-all-commentary").count() === 1);
    await tid(F, "mc-all-commentary").click({ timeout: 4000 }).catch(() => {});
    await tid(F, "mc-panel-commentary").waitFor({ timeout: 4000 }).catch(() => {});
    ok("...which opens it", await tid(F, "mc-panel-commentary").count() === 1);
    await pickTab(F, "summary").catch(() => {});
    await tid(F, "mc-result-view").waitFor({ timeout: 4000 }).catch(() => {});
  }
  ok("the onward links show", await tid(fin.page, "mc-onward").count() === 1);
  ok("Hilton's own next fixture (the seeded one)", await tid(fin.page, "mc-onward-next-home").count() === 1);
  ok("...never a link to Westville's — no fixture of theirs is on this list, and this never guesses one",
     await tid(fin.page, "mc-onward-next-away").count() === 0);
  ok("both sides' results are one tap away", await tid(fin.page, "mc-onward-results-home").count() === 1
     && await tid(fin.page, "mc-onward-results-away").count() === 1);
  await tid(fin.page, "mc-onward-results-away").click({ timeout: 4000 });
  await afterReads(fin.page, 800);
  ok("...opens the Match Centre list, filtered to that side's results", await tid(fin.page, "mc-team-filter-clear").count() === 1
     && (await tid(fin.page, "mc-team-filter-clear").innerText()).includes("Westville"));
  ok("...showing this very match, now a result", await tid(fin.page, `match-card-${fx.live}`).count() === 1);
  ok("no console errors (onward)", fin.errors.length === 0, fin.errors.join(" | "));
  await fin.ctx.close();

  group("SCRBRD-100: coaches and scorers confirm or correct the final scorecard; others never see it");
  const sc = await open();
  ok("the scorer signs in", await signIn(sc.page, /scorer@example\.invalid|Scorer/));
  ok("the decided fixture opens", await openMatch(sc.page, fx.live));
  ok("the scorer is asked to confirm or correct it", await tid(sc.page, "mc-confirm-prompt").count() === 1);
  ok("...and can open the amendment flow (scoring.amend.request)", await tid(sc.page, "mc-confirm-open").count() === 1);
  await tid(sc.page, "mc-confirm-open").click();
  await sc.page.waitForTimeout(300);
  const delivered = await tid(sc.page, "mc-confirm-delivery").locator("option").count();
  ok(`a delivery to name (${delivered - 1} on the log)`, delivered > 1);
  await tid(sc.page, "mc-confirm-delivery").selectOption({ index: 1 });
  await tid(sc.page, "mc-confirm-reason").fill("Smoke walk: this ball was never bowled the way the sheet has it.");
  await tid(sc.page, "mc-confirm-submit").click();
  ok("filed, and says so", await until(sc.page, () => /with the director of sport .*until it is approved/i.test(document.querySelector('[data-testid="mc-confirm-said"]')?.textContent ?? ""), 6000),
     await tid(sc.page, "mc-confirm-said").innerText().catch(() => "∅"));
  await tid(sc.page, "mc-confirm-ok").click();
  // Judged on a fixed 300 ms after the click, which a busy runner can miss
  // (1 run of 2 here): wait up to 3 s for the prompt to go, then judge.
  await until(sc.page, () => !document.querySelector('[data-testid="mc-confirm-prompt"]'), 3000);
  ok('"Looks right" dismisses the prompt — on this device only; nothing is written for it', await tid(sc.page, "mc-confirm-prompt").count() === 0);
  ok("no console errors (scorer)", sc.errors.length === 0, sc.errors.join(" | "));
  await sc.ctx.close();

  const ch = await open();
  ok("the head coach signs in", await signIn(ch.page, /coach@example\.invalid|Head Coach/));
  ok("the decided fixture opens", await openMatch(ch.page, fx.live));
  ok("the coach is asked too (scoring.finalise)", await tid(ch.page, "mc-confirm-prompt").count() === 1);
  ok("...but cannot open the amendment flow — only the scorer role holds scoring.amend.request",
     await tid(ch.page, "mc-confirm-open").count() === 0 && /scorer/i.test(await tid(ch.page, "mc-confirm-prompt").innerText()));
  ok("no console errors (coach)", ch.errors.length === 0, ch.errors.join(" | "));
  await ch.ctx.close();

  const watcher = await open();
  ok("a spectator signs in", await signIn(watcher.page, /watcher@example\.invalid|Spectator/));
  ok("the decided fixture opens", await openMatch(watcher.page, fx.live));
  ok("a spectator never sees the confirm-or-correct prompt", await tid(watcher.page, "mc-confirm-prompt").count() === 0);
  ok("...nor the amendment form it would have opened", await tid(watcher.page, "mc-confirm-open").count() === 0);
  ok("no console errors (spectator)", watcher.errors.length === 0, watcher.errors.join(" | "));
  await watcher.ctx.close();

  // ── OFFICIAL_RESULT (db/114, D11–D13, §6 "Walks") ──
  group("OFFICIAL_RESULT: the label on the result, and who is offered Confirm");
  const ofs = await open();
  ok("the scorer signs in again", await signIn(ofs.page, /scorer@example\.invalid|Scorer/));
  ok("the decided fixture opens", await openMatch(ofs.page, fx.live));
  const ofsLabel = await until(ofs.page, () => document.querySelector('[data-testid="mc-official"] [data-state]')?.getAttribute("data-state") ?? "", 8000)
    ? await ofs.page.locator('[data-testid="mc-official"] [data-state]').getAttribute("data-state") : null;
  ok("the result header says Provisional (a correction awaits approval)", ofsLabel === "provisional",
     await tid(ofs.page, "mc-official").innerText().catch(() => "∅"));
  ok("...in a polite live region, so a change on a poll is announced",
     (await tid(ofs.page, "mc-official").getAttribute("aria-live")) === "polite" && (await tid(ofs.page, "mc-official").getAttribute("role")) === "status");
  ok("the scorer of the log is never offered Confirm", await tid(ofs.page, "mc-official-confirm").count() === 0
     && await tid(ofs.page, "mc-confirm-result").count() === 0);
  ok("the full-time prompt says Looks right is this phone's and does not make it official (D13)",
     /does not make the result official/.test(await tid(ofs.page, "mc-confirm-device").innerText().catch(() => "")));
  ok("no console errors (scorer, official)", ofs.errors.length === 0, ofs.errors.join(" | "));
  await ofs.ctx.close();

  // The scorer's request is withdrawn (his own door, db/02): nothing pending.
  await q(`update scoring_amendment set state = 'withdrawn' where match_id = $1 and state = 'pending'`, [fx.live]);
  // The live section sealed the chase on its figures before the late balls
  // were folded in, so that seal never stood, and db/114 counts a seal that
  // never stood as no seal (the security review). The scorer seals it again
  // on the log's own figures, as the pad's seal does, at the end of the log.
  const [chase] = await q(`select runs, wickets, balls, end_reason from innings_result_state($1, 1::smallint,
      coalesce((select c.doc->'play' from match_conditions c where c.match_id = $1), '{}'::jsonb), true)`, [fx.live]);
  await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq,
                                   client_ts, kind, payload)
           select $1, m.school_id, s.n, 1, 1, '88888888-0000-0000-0000-000000000006', 'mc-pad', 'mc-reseal-' || $1, s.n, now(), 'innings_end',
                  jsonb_build_object('reason', $2::text, 'confirmed', jsonb_build_object('runs', $3::int, 'wickets', $4::int, 'balls', $5::int))
             from match m, (select coalesce(max(seq), 0) + 1 as n from ball_event where match_id = $1) s where m.id = $1`,
    [fx.live, chase.end_reason ?? "target_reached", chase.runs, chase.wickets, chase.balls]);
  const [{ sealed }] = await q(`select bool_and((i->>'sealed')::boolean) as sealed from match_result_compute($1) r, jsonb_array_elements(r.innings) i`, [fx.live]);
  ok("the chase is sealed on the log's own figures", sealed === true, JSON.stringify(chase));
  const pr = await open();
  ok("the principal signs in", await signIn(pr.page, /principal@example\.invalid|Principal/));
  ok("the decided fixture opens", await openMatch(pr.page, fx.live));
  ok("she is offered Confirm result (the home school's, and no hand of hers on the log)",
     await until(pr.page, () => !!document.querySelector('[data-testid="mc-official-confirm"]'), 20000));
  const confirmBox = await tid(pr.page, "mc-official-confirm").boundingBox();
  ok("...a 44px target", (confirmBox?.height ?? 0) >= 44, JSON.stringify(confirmBox));
  await tid(pr.page, "mc-official-confirm").click();
  ok("the sheet says what it does, and the head it pins",
     /This makes the result official, as the scorecard stands now \(head \d+\)\. Both schools are told\./.test(await tid(pr.page, "mc-official-confirm-words").innerText().catch(() => "")),
     await tid(pr.page, "mc-official-confirm-words").innerText().catch(() => "∅"));
  await tid(pr.page, "mc-official-confirm-go").click();
  ok("confirmed, in words", await until(pr.page, () => /the result is official/.test(document.querySelector('[data-testid="mc-official-said"]')?.textContent ?? ""), 8000));
  ok("the header now says Official result, confirmed by the home school",
     await until(pr.page, () => !!document.querySelector('[data-testid="mc-official"] [data-state="official"]')
       && /^Official result ?· confirmed by the home school, /.test(document.querySelector('[data-testid="mc-official"]')?.textContent ?? ""), 8000),
     await tid(pr.page, "mc-official").innerText().catch(() => "∅"));
  const [{ n: confRows }] = await q(`select count(*)::int n from match_result_confirmation where match_id = $1 and lapsed_at is null and withdrawn_at is null`, [fx.live]);
  ok("...one standing confirmation in the database", confRows === 1, confRows);
  ok("she may withdraw her own, within the window", await tid(pr.page, "mc-official-withdraw").count() === 1);
  ok("no console errors (principal)", pr.errors.length === 0, pr.errors.join(" | "));
  await pr.ctx.close();

  // A correction asked after it is official: the approver's sheet warns that approving reopens it.
  const scTok = await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "scorer@example.invalid", deviceId: "mc-official" }) })).json().then((b) => b.token).catch(() => null);
  const [{ key: lastBall }] = await q(`select idempotency_key as key from ball_event_live where match_id = $1 and kind = 'ball' order by seq desc limit 1`, [fx.live]);
  const asked = await fetch(`${API}/api/matches/${fx.live}/amendments`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${scTok}` },
    body: JSON.stringify({ targetKey: lastBall, reason: "Smoke walk: the last ball, asked after the result was official." }) });
  ok("the scorer asks for a correction to the official result", asked.status === 200, asked.status);
  const dos2 = await open();
  ok("the director of sport signs in", await signIn(dos2.page, /sarah@example\.invalid|Director/));
  ok("the decided fixture opens", await openMatch(dos2.page, fx.live));
  ok("its corrections are one tap away", await until(dos2.page, () => !!document.querySelector('[data-testid="mc-corrections-open"]'), 8000));
  await tid(dos2.page, "mc-corrections-open").click();
  ok("the approver is told, before he taps, that approving reopens an official result",
     await until(dos2.page, () => /approving reopens it, and both schools and the organiser are told/.test(document.querySelector('[data-testid^="corr-reopens-"]')?.textContent ?? ""), 8000));
  ok("no console errors (director, official)", dos2.errors.length === 0, dos2.errors.join(" | "));
  await dos2.ctx.close();
  // ── end OFFICIAL_RESULT ──

  group("At 390 wide: the sides by code, and nothing wider than the screen");
  const ph = await open({ viewport: PHONE, scheme: "light" });
  await signIn(ph.page, /sarah@example\.invalid|Director/);
  ok("the fixture opens on a phone", await openMatch(ph.page, fx.live));
  const shortShown = await ph.page.locator("#mc-panel-summary, [data-testid='mc-scores']").first().evaluate(() =>
    [...document.querySelectorAll("[data-testid='mc-scores'] .mc-short")].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.textContent));
  ok(`the scores name the sides by code (${shortShown.join(", ")})`, shortShown.length === 2 && shortShown[0] === "HIL 1XI", shortShown.join(", "));
  // CRI-1.3: at 390 the strip is Summary, Scorecard, Commentary and More; the rest are in More's menu.
  for (const t of TABS) {
    await pickTab(ph.page, t).catch(() => {});
    await tid(ph.page, `mc-panel-${t}`).waitFor({ timeout: 4000 }).catch(() => {});
    await afterReads(ph.page, 300);
    const wide = await ph.page.evaluate(() => document.documentElement.scrollWidth);
    ok(`${t}: opened, and no sideways scroll at 390 (${wide})`, wide <= 390 && await tid(ph.page, `mc-panel-${t}`).count() === 1);
  }
  ok("no console errors (phone)", ph.errors.length === 0, ph.errors.join(" | "));
  await ph.ctx.close();

  group("CRI-1.5: a dismissal opens the Commentary at that ball, and back restores the tab, the row and the scroll");
  {
    const ph5 = await open({ viewport: PHONE });
    await signIn(ph5.page, /sarah@example\.invalid|Director/);
    ok("the fixture opens on a phone", await openMatch(ph5.page, fx.live));
    const P5 = ph5.page;
    const path = () => new URL(P5.url()).pathname;
    // Where the page is: the shell's <main> scrolls, or the document does.
    const scrolled = () => P5.evaluate(() => Math.max(document.getElementById("os-content")?.scrollTop ?? 0, window.scrollY));
    await pickTab(P5, "scorecard");
    await tid(P5, "mc-innings-0").click({ timeout: 4000 }).catch(() => {});
    await P5.waitForTimeout(300);
    // The first innings' first wicket: early in a match of sixteen overs, past the Commentary's first twelve.
    const firstOut = inn1.ballLog.find((b) => b.type === "W" && !b.freeHitSaved);
    const who = inn1.batsmen.find((b) => b.id === (firstOut.dismissed ?? firstOut.strikerId));
    const key = `e:${firstOut.id}`;
    const row = tid(P5, "mc-bat-row").filter({ hasText: who.name }).first();
    await row.locator('[data-testid="mc-bat-open"]').click({ timeout: 4000 });
    await P5.waitForTimeout(300);
    const link = row.locator('[data-testid="mc-dismissal-link"]');
    const lg = await link.evaluate((e) => ({ h: e.getBoundingClientRect().height, t: e.innerText })).catch(() => null);
    ok(`${who.name}'s opened row: his dismissal's line is a link to that ball, 44px tall`, (lg?.h ?? 0) >= 44 && /In commentary/.test(lg?.t ?? ""), JSON.stringify(lg));
    await link.scrollIntoViewIfNeeded();
    await P5.evaluate(() => { const m = document.getElementById("os-content"); if (m) m.scrollTop += 37; else window.scrollBy(0, 37); });
    await P5.waitForTimeout(200);
    const was = await scrolled();
    const linkTop = await link.evaluate((e) => e.getBoundingClientRect().top);
    ok(`the page is scrolled down to it (${was}px)`, was > 100, was);
    await link.click();
    await tid(P5, "mc-commentary").waitFor({ timeout: 4000 }).catch(() => {});
    await P5.waitForTimeout(400);
    ok("the Commentary opens, at its own address", await tid(P5, "mc-panel-commentary").count() === 1 && path() === `/app/matches/${fx.live}/commentary`, path());
    const target = await P5.evaluate(() => {
      const t = document.querySelectorAll('[data-testid="mc-line"][data-target="true"]');
      const r = t[0]?.getBoundingClientRect();
      return { n: t.length, key: t[0]?.getAttribute("data-key"), focused: document.activeElement === t[0], current: t[0]?.getAttribute("aria-current"),
        inView: !!r && r.top >= 0 && r.bottom <= window.innerHeight, text: t[0]?.innerText ?? "" };
    });
    ok(`...at that ball: one line marked, the dismissal's own (${key}), the generator's words`, target.n === 1 && target.key === key
       && target.text.includes(expected.find((c) => c.key === key)?.text ?? "∅"), JSON.stringify(target));
    const overAt = await P5.evaluate(() => [...document.querySelectorAll('[data-testid="mc-over"]')].findIndex((o) => !!o.querySelector('[data-target="true"]')));
    ok(`...in the ${overAt + 1}th over group, past the first twelve: the tab opened far enough back to hold it`, overAt >= 12, overAt);
    ok("...on screen, with the focus on it and aria-current", target.inView && target.focused && target.current === "true", JSON.stringify(target));
    ok("...and a way back to the scorecard, 44px", ((await tid(P5, "mc-back-to-scorecard").boundingBox().catch(() => null))?.height ?? 0) >= 44);
    await P5.goBack();
    await tid(P5, "mc-scorecard").waitFor({ timeout: 4000 }).catch(() => {});
    await P5.waitForTimeout(400);
    ok("the back button: the Scorecard again, at its address", await tid(P5, "mc-tab-scorecard").getAttribute("aria-selected") === "true" && path() === `/app/matches/${fx.live}/scorecard`, path());
    const rowBack = tid(P5, "mc-bat-row").filter({ hasText: who.name }).first();
    ok(`...the first innings still shown, ${who.name}'s row still open`, await tid(P5, "mc-innings-0").getAttribute("aria-pressed") === "true"
       && await rowBack.locator('[data-testid="mc-bat-open"]').getAttribute("aria-expanded") === "true");
    const back = await scrolled();
    const backTop = await rowBack.locator('[data-testid="mc-dismissal-link"]').evaluate((e) => e.getBoundingClientRect().top).catch(() => null);
    ok(`...and the page where it was (${back}px, was ${was}px; the line ${backTop}px from the top, was ${linkTop}px)`,
       Math.abs(back - was) <= 2 && backTop != null && Math.abs(backTop - linkTop) <= 2);
    ok("the tab no longer marks a ball once it is left", await tid(P5, "mc-back-to-scorecard").count() === 0);
    // The way back on the page itself: the same place.
    await rowBack.locator('[data-testid="mc-dismissal-link"]').click();
    await tid(P5, "mc-back-to-scorecard").waitFor({ timeout: 4000 }).catch(() => {});
    await tid(P5, "mc-back-to-scorecard").click();
    await tid(P5, "mc-scorecard").waitFor({ timeout: 4000 }).catch(() => {});
    await P5.waitForTimeout(400);
    ok("\"Back to the scorecard\" is the same step back: the Scorecard, the row open, the page where it was",
       path() === `/app/matches/${fx.live}/scorecard` && await tid(P5, "mc-bat-row").filter({ hasText: who.name }).first().locator('[data-testid="mc-bat-open"]').getAttribute("aria-expanded") === "true"
       && Math.abs((await scrolled()) - was) <= 2, `${path()} ${await scrolled()}`);
    await pickTab(P5, "commentary");
    await P5.waitForTimeout(300);
    ok("opened from the tab strip, the Commentary marks no ball and offers no way back", await P5.locator('[data-testid="mc-line"][data-target]').count() === 0
       && await tid(P5, "mc-back-to-scorecard").count() === 0);
    ok("no console errors (scorecard to ball)", ph5.errors.length === 0, ph5.errors.join(" | "));
    await ph5.ctx.close();
  }

  group("CRI-1.6: on a phone the scorecard's header stays at the top as its rows scroll; a scroll cue where the table is wider than the screen");
  {
    const s6 = await open({ viewport: { width: 360, height: 740 } });
    await signIn(s6.page, /sarah@example\.invalid|Director/);
    ok("the fixture opens at 360 wide", await openMatch(s6.page, fx.live));
    const P6 = s6.page;
    await pickTab(P6, "scorecard");
    await tid(P6, "mc-innings-0").click({ timeout: 4000 }).catch(() => {});
    await P6.waitForTimeout(300);
    const heads = await P6.evaluate(() => [...document.querySelectorAll('[data-testid="mc-head"]')].map((h) => ({
      role: h.getAttribute("role"), cells: [...h.children].map((c) => c.getAttribute("role")), bg: getComputedStyle(h).backgroundColor })));
    ok("the batting and the bowling each have a header row: role=row, six role=columnheader cells", heads.length === 2
       && heads.every((h) => h.role === "row" && h.cells.length === 6 && h.cells.every((c) => c === "columnheader")), JSON.stringify(heads));
    ok("...each opaque, so no row shows through it", heads.every((h) => h.bg !== "rgba(0, 0, 0, 0)"), JSON.stringify(heads));
    // Scroll the batting table's head out of view, its rows still on screen.
    const into = (/** @type {number} */ by) => P6.evaluate(async (by) => {
      // The top of the screen, as the reader sees it: under the top bar where it stays on screen.
      const bar = document.querySelector('[data-testid="topbar"], [data-testid="persona-bar"]')?.getBoundingClientRect();
      const table = document.querySelector('[role="table"][aria-label="Batting"]');
      const head = table.querySelector('[data-testid="mc-head"]');
      const m = document.getElementById("os-content");
      const sc = m && m.scrollHeight > m.clientHeight ? m : document.scrollingElement;
      const top0 = bar && bar.top <= 0.5 && bar.bottom > 0 ? bar.bottom : 0;
      sc.scrollTop += table.getBoundingClientRect().top - top0 + by;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const b2 = document.querySelector('[data-testid="topbar"], [data-testid="persona-bar"]')?.getBoundingClientRect();
      const top = b2 && b2.top <= 0.5 && b2.bottom > 0 ? b2.bottom : 0;
      const h = head.getBoundingClientRect(), t = table.getBoundingClientRect();
      const hit = document.elementFromPoint(h.left + h.width - 12, h.top + h.height / 2);
      return { headTop: h.top, top, tableTop: t.top, tableBottom: t.bottom, onTop: !!hit && head.contains(hit), stuck: head.getAttribute("data-stuck") };
    }, by);
    const stuck = await into(120);
    ok(`scrolled 120px into the batting: its header holds at the top of the screen (${Math.round(stuck.headTop)} = ${Math.round(stuck.top)}), over the rows`,
       Math.abs(stuck.headTop - stuck.top) <= 1 && stuck.tableTop < stuck.top && stuck.tableBottom > stuck.headTop + 100 && stuck.onTop && stuck.stuck === "true", JSON.stringify(stuck));
    const past = await P6.evaluate(async () => {
      const table = document.querySelector('[role="table"][aria-label="Batting"]');
      const head = table.querySelector('[data-testid="mc-head"]');
      const m = document.getElementById("os-content");
      const sc = m && m.scrollHeight > m.clientHeight ? m : document.scrollingElement;
      sc.scrollTop += table.getBoundingClientRect().bottom + 200;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const h = head.getBoundingClientRect(), t = table.getBoundingClientRect();
      return { headBottom: h.bottom, tableBottom: t.bottom };
    });
    ok("...and goes with its table once the table has passed: it never sits over the bowling", past.headBottom <= past.tableBottom + 1, JSON.stringify(past));
    await P6.evaluate(() => { (document.getElementById("os-content")?.scrollHeight ?? 0) > (document.getElementById("os-content")?.clientHeight ?? 0)
      ? (document.getElementById("os-content").scrollTop = 0) : window.scrollTo(0, 0); });
    await P6.waitForTimeout(200);
    ok("...and back at the top it is where it was drawn, held by nothing", await P6.evaluate(() => !document.querySelector('[data-testid="mc-head"][data-stuck]')
       && !document.querySelector('[data-testid="mc-head"]').style.transform));
    ok("at 360 every column fits: no scroll cue, nothing sideways", await tid(P6, "mc-scroll-cue").count() === 0
       && await P6.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    // A phone at 200% zoom: the six columns no longer fit, and the table says it scrolls.
    await P6.setViewportSize({ width: 280, height: 740 });
    await P6.waitForTimeout(500);
    const cue = tid(P6, "mc-scroll-cue").first();
    ok("at 280 wide the table scrolls in its own box, and says so above it", await cue.isVisible().catch(() => false)
       && /Scroll sideways for every figure/.test(await cue.innerText().catch(() => "")) && await tid(P6, "mc-scroll-fade").count() >= 1);
    ok("...the cue on the 12px floor, and hidden from a screen reader (it reads every cell anyway)",
       await cue.evaluate((e) => parseFloat(getComputedStyle(e).fontSize) >= 12 && e.getAttribute("aria-hidden") === "true").catch(() => false));
    ok("...and still nothing sideways on the page", await P6.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const cues = await tid(P6, "mc-scroll-cue").count();
    await P6.evaluate(() => { const t = document.querySelector('[role="table"][aria-label="Batting"]'); t.scrollLeft = t.scrollWidth; });
    await P6.waitForTimeout(300);
    ok("scrolled to its last column, the batting's cue goes (the bowling's stays)", await tid(P6, "mc-scroll-cue").count() === cues - 1, `${cues} → ${await tid(P6, "mc-scroll-cue").count()}`);
    await P6.setViewportSize(DESK);
    await P6.waitForTimeout(400);
    const deskHeld = (await into(120)).stuck;
    ok("on a desktop the header is not held and there is no cue", deskHeld == null && await tid(P6, "mc-scroll-cue").count() === 0, deskHeld);
    ok("no console errors (sticky header)", s6.errors.length === 0, s6.errors.join(" | "));
    await s6.ctx.close();
  }

  group("One address per tab (CRI-1.3): a link opens its tab, a tab moves the address, the back button goes back a tab");
  {
    const dl = await open();
    const at = (/** @type {string} */ path) => `http://localhost:${WEB_PORT}${path}`;
    await dl.page.goto(at(`/app/matches/${fx.live}/commentary`), { waitUntil: "networkidle" });
    ok("the director of sport, arriving on a link to the fixture's Commentary, signs in", await signIn(dl.page, /sarah@example\.invalid|Director/));
    await tid(dl.page, "match-view").waitFor({ timeout: 10000 }).catch(() => {});
    await afterReads(dl.page, 1500);
    const path = () => new URL(dl.page.url()).pathname;
    /** Until the page is at this path with this tab selected (null: the list), or the bound: what the next check reads. */
    const settled = (/** @type {string} */ p, /** @type {string | null} */ t) => dl.page.waitForFunction(([p, t]) => location.pathname === p
      && (t === null ? !document.querySelector('[data-testid="match-view"]') : document.querySelector(`[data-testid="mc-tab-${t}"]`)?.getAttribute("aria-selected") === "true"
        && !!document.querySelector(`[data-testid="mc-panel-${t}"]`)), [p, t], { timeout: 6000 }).catch(() => {});
    const FX = `/app/matches/${fx.live}`;
    ok("...and the link opens that fixture on its Commentary tab",
       await tid(dl.page, "match-view").getAttribute("data-match").catch(() => null) === fx.live
       && await tid(dl.page, "mc-tab-commentary").getAttribute("aria-selected") === "true" && await tid(dl.page, "mc-panel-commentary").count() === 1, path());
    await tid(dl.page, "mc-tab-scorecard").click({ timeout: 4000 }).catch(() => {});
    await settled(`${FX}/scorecard`, "scorecard");
    ok("choosing the Scorecard moves the address to /app/matches/:id/scorecard", path() === `/app/matches/${fx.live}/scorecard`, path());
    await tid(dl.page, "mc-tab-summary").click({ timeout: 4000 }).catch(() => {});
    await settled(FX, "summary");
    ok("...and the Summary to the fixture's own", path() === `/app/matches/${fx.live}`, path());
    await dl.page.goBack();
    await settled(`${FX}/scorecard`, "scorecard");
    ok("the back button: the Scorecard again", await tid(dl.page, "mc-tab-scorecard").getAttribute("aria-selected") === "true" && path().endsWith("/scorecard"), path());
    await dl.page.goBack();
    await settled(`${FX}/commentary`, "commentary");
    ok("...and again: the Commentary the link opened", await tid(dl.page, "mc-panel-commentary").count() === 1, path());
    await tid(dl.page, "mc-back").click({ timeout: 4000 }).catch(() => {});
    await settled("/app/matches", null);
    ok("All matches closes the fixture and the address is the list's", await tid(dl.page, "match-view").count() === 0 && path() === "/app/matches", path());
    await dl.page.goBack();
    await settled(`${FX}/commentary`, "commentary");
    await afterReads(dl.page, 300);
    ok("...from which the back button reopens the fixture where it was", await tid(dl.page, "mc-panel-commentary").count() === 1, path());
    ok("no console errors (links)", dl.errors.length === 0, dl.errors.join(" | "));
    await dl.ctx.close();
    const co = await open();
    await co.page.goto(at(`/app/matches/${fx.live}/coach`), { waitUntil: "networkidle" });
    await signIn(co.page, /sarah@example\.invalid|Director/);
    await tid(co.page, "match-view").waitFor({ timeout: 10000 }).catch(() => {});
    await afterReads(co.page, 1500);
    ok("a link to the Coach tab opens it for a reader who holds it", await tid(co.page, "mc-tab-coach").getAttribute("aria-selected").catch(() => null) === "true");
    await co.ctx.close();
    const sp = await open();
    await sp.page.goto(at(`/app/matches/${fx.live}/coach`), { waitUntil: "networkidle" });
    ok("a spectator, on the same link, signs in", await signIn(sp.page, /watcher@example\.invalid|Spectator/));
    await tid(sp.page, "match-view").waitFor({ timeout: 10000 }).catch(() => {});
    await afterReads(sp.page, 1500);
    ok("...and has the fixture on its Summary, with no Coach tab", await tid(sp.page, "mc-panel-summary").count() === 1 && await tid(sp.page, "mc-tab-coach").count() === 0);
    await sp.ctx.close();
  }

  group("CRI-1.4: who is offered Enter scoring — only an assignment that may score this fixture; the pad opens on the tap alone");
  {
    const sees = async (who, id) => {
      const s = await open();
      const writes = [];
      s.page.on("request", (r) => { if (r.method() !== "GET" && /\/api\/matches\//.test(r.url())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
      // A regex picks a listed account; an address is typed (not every seeded account is on the list).
      let inn;
      if (typeof who === "string") {
        await click(s.page, /Get Started|Log In/, 5000);
        await s.page.waitForTimeout(500);
        await s.page.locator('input[type="email"]').first().fill(who);
        await click(s.page, /^Sign In$/, 5000);
        await afterReads(s.page, 2000);
        inn = /Match Centre|Dashboard/i.test(await text(s.page));
      } else inn = await signIn(s.page, who);
      // The list's card first: its scorer button asks the same gate (Kameel, 6 Nov).
      await s.page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
      await tid(s.page, `mc-open-${id}`).first().waitFor({ timeout: 10000 }).catch(() => {});
      const listed = await tid(s.page, `mc-score-${id}`).count() === 1;
      const opened = await openMatch(s.page, id);
      const offered = await tid(s.page, "mc-enter-scoring").count() === 1;
      // The card and the page say the same: both offered, or neither.
      ok(`...the list's card agrees with the page (${offered ? "offered" : "not offered"})`, listed === offered, JSON.stringify({ listed, offered }));
      return { s, inn, opened, writes, offered };
    };
    const w = await sees(/watcher@example\.invalid|Spectator/, fx.brk);
    ok("a spectator opens the live U16A fixture and is never offered it (no scoring.edit)", w.inn && w.opened && !w.offered);
    await w.s.ctx.close();
    // A fixture the away side's coach can read (db/97): Hilton's 1XI at home to Westville's, live, nothing bowled yet.
    const [{ id: awayFx }] = await q(
      `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, ground_id, starts_at, sport, format, overs, status)
       values ($1, '1XI', $2, '1XI', 'Westville Boys'' High 1XI', null, now() - interval '5 minutes', 'cricket', 'T10', 10, 'live') returning id`,
      [HIL, (await q(`select away_school_id from match where id = $1`, [fx.live]))[0].away_school_id]);
    const wes = await sees("coach.wes@example.invalid", awayFx);
    ok("Westville's 1XI coach reads the fixture his side is the away side of, and is not offered it: scoring is the home side's log",
       wes.inn && wes.opened && !wes.offered, JSON.stringify({ inn: wes.inn, opened: wes.opened, offered: wes.offered }));
    await wes.s.ctx.close();
    const c1 = await sees("coach@example.invalid", awayFx);
    ok("Hilton's 1XI coach is offered it on his own side's fixture", c1.inn && c1.opened && c1.offered, JSON.stringify({ inn: c1.inn, opened: c1.opened, offered: c1.offered }));
    await c1.s.ctx.close();
    const c2 = await sees("coach2@example.invalid", awayFx);
    ok("Hilton's 2XI coach holds scoring.edit too, but for the 2XI: on the 1XI's fixture he is not offered it",
       c2.inn && !c2.offered, JSON.stringify({ inn: c2.inn, opened: c2.opened, offered: c2.offered }));
    await c2.s.ctx.close();
    await q(`update match set status = 'complete' where id = $1`, [awayFx]);
    const done = await sees(/sarah@example\.invalid|Director/, fx.live);
    ok("on the finished fixture nobody is offered it, the director of sport included", done.opened && !done.offered);
    await done.s.ctx.close();
    const sc1 = await sees(/scorer@example\.invalid|Scorer/, fx.brk);
    ok("the school's scorer is offered it on the live U16A fixture", sc1.inn && sc1.opened && sc1.offered);
    for (const t of TABS) await pickTab(sc1.s.page, t).catch(() => {});
    await afterReads(sc1.s.page, 500);
    ok("...and reading all six of its tabs asked no write and opened no pad", sc1.writes.length === 0 && await sc1.s.page.locator(".scorer-shell").count() === 0,
       sc1.writes.join(" | "));
    await tid(sc1.s.page, "mc-enter-scoring").click({ timeout: 4000 }).catch(() => {});
    ok("his tap on it opens the pad", await until(sc1.s.page, () => !!document.querySelector(".scorer-shell"), 10000));
    ok("no console errors (Enter scoring)", sc1.s.errors.length === 0, sc1.s.errors.join(" | "));
    await sc1.s.ctx.close();
  }

  group("CRI-2.1: the over jump reaches Over 14 of a longer fixture, at 360 wide");
  {
    const NARROW = { width: 360, height: 780 };
    // The over jump, on a match longer than the tab's first twelve overs.
    const lf = await buildLongFixture(q, fx.players);
    const longInn = deriveMatch(lf.events).innings[0];
    ok("a sixteen-over innings, for the jump", longInn.balls === 96, longInn.balls);
    const j = await open({ viewport: NARROW });
    await signIn(j.page, /sarah@example\.invalid|Director/);
    ok("the long fixture opens at 360 wide", await openMatch(j.page, lf.long));
    const J = j.page;
    await pickTab(J, "commentary");
    const sel = tid(J, "mc-over-jump");
    await sel.waitFor({ timeout: 4000 }).catch(() => {});
    const opts = await sel.locator("option").evaluateAll((os) => os.filter((o) => o.value).map((o) => o.textContent));
    const box = await sel.boundingBox().catch(() => null);
    ok("the jump lists every over, in order, Over 1 to Over 16; 44px tall", opts.length === 16 && opts[0] === "Over 1" && opts[15] === "Over 16" && (box?.height ?? 0) >= 43.5,
       `${opts.length} ${opts[0]} ${box?.height}`);
    const drawn = () => J.evaluate(() => [...document.querySelectorAll('[data-testid="mc-over-title"]')].map((e) => e.textContent));
    ok("the tab opens on the latest twelve overs: Over 2 is not drawn yet", !(await drawn()).includes("Over 2") && (await drawn()).length === 12, (await drawn()).join());
    await sel.selectOption({ label: "Over 14" });
    await J.waitForTimeout(400);
    const at14 = await J.evaluate(() => {
      const t = [...document.querySelectorAll('[data-testid="mc-over-title"]')].find((e) => e.textContent === "Over 14");
      const r = t?.getBoundingClientRect();
      return { found: !!t, top: r?.top ?? -1, inView: !!r && r.top >= 0 && r.bottom <= window.innerHeight, focused: document.activeElement === t,
        lines: t?.closest('[data-testid="mc-over"]')?.querySelectorAll('[data-testid="mc-line"]').length ?? 0, sel: document.querySelector('[data-testid="mc-over-jump"]')?.value };
    });
    ok(`the jump to Over 14: its heading on screen (${Math.round(at14.top)}px from the top), with the focus on it`, at14.found && at14.inView && at14.focused, JSON.stringify(at14));
    ok("...its six balls under it, the six among them", at14.lines >= 6
       && await J.evaluate(() => !![...document.querySelectorAll('[data-testid="mc-over-title"]')].find((e) => e.textContent === "Over 14")?.closest('[data-testid="mc-over"]')?.querySelector('[data-kind="six"]')));
    ok("...and the jump is ready again, for another over", at14.sel === "");
    await sel.selectOption({ label: "Over 2" });
    await J.waitForTimeout(400);
    ok("a jump past the first twelve overs opens the tab far enough back to hold it", await J.evaluate(() => {
      const t = [...document.querySelectorAll('[data-testid="mc-over-title"]')].find((e) => e.textContent === "Over 2");
      const r = t?.getBoundingClientRect();
      return !!r && r.top >= 0 && r.bottom <= window.innerHeight && document.activeElement === t;
    }));
    ok("at 360 wide, nothing is wider than the screen (the long fixture)", await J.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok("no console errors (over jump)", j.errors.length === 0, j.errors.join(" | "));
    await j.ctx.close();
  }

  group("An error boundary: a panel that throws is a card in its own place, and its neighbours stand");
  // The walks run against a production build, where the test hook is compiled
  // out (vite.config.js `define`; tools/check-bundle.mjs holds that). So this
  // group builds ITS OWN copy with the hook in — apps/web/dist-test, never
  // dist — and serves that for these pages only.
  const made = spawnSync("pnpm", ["--filter", "@scrbrd/web", "exec", "vite", "build", "--outDir", "dist-test", "--emptyOutDir"],
    { env: { ...process.env, SCRBRD_TEST_HOOKS: "1" }, encoding: "utf8" });
  ok("the walk's own build, with the test hook, is made", made.status === 0, (made.stderr || made.stdout || "").slice(-300));
  WEB_ROOT = "apps/web/dist-test";
  const panelLogs = [];
  try {
    const bd = await open({ init: `window.__SCRBRD_TEST_THROW__ = "commentary";` });
    bd.page.on("console", (m) => { if (/^\[panel\]/.test(m.text())) panelLogs.push(m.text()); });
    ok("the director of sport signs in", await signIn(bd.page, /sarah@example\.invalid|Director/));
    ok("the decided fixture opens", await openMatch(bd.page, fx.live));
    const B = bd.page;
    ok("Summary draws (the result view, CRI-1.7), with no failure card", await tid(B, "mc-result-view").count() === 1 && await tid(B, "panel-error").count() === 0);

    await tab(B, "commentary");
    const card = tid(B, "panel-error");
    ok("the commentary panel, made to throw, is a card in its place", await card.count() === 1 && await card.getAttribute("data-panel") === "commentary");
    ok("...that says so in words, with the panel's name", (await card.innerText()).includes("The commentary panel couldn't be shown."), await card.innerText());
    ok("...is an alert", await card.getAttribute("role") === "alert");
    const geo = await tid(B, "panel-error-retry").evaluate((e) => ({ h: e.getBoundingClientRect().height, f: parseFloat(getComputedStyle(e).fontSize), t: e.textContent.trim() }));
    ok("...with a Try again button, 44px tall, on the 12px floor", geo.t === "Try again" && geo.h >= 44 && geo.f >= 12, JSON.stringify(geo));
    ok("...and the commentary's own lines are not drawn", await tid(B, "mc-line").count() === 0);
    ok("its neighbours stand: the header, the scores and the tab bar", await tid(B, "mc-title").count() === 1
       && await tid(B, "mc-scores").count() === 1 && await tid(B, "mc-tabs").count() === 1);
    ok("...and so does the shell: the navigation", await B.locator('[data-testid="nav"], [data-testid="mnav"]').first().isVisible());
    ok("the failure is logged once, with the panel's name and the message only", panelLogs.length === 1
       && /^\[panel\] commentary could not be shown: test throw$/.test(panelLogs[0] ?? ""), panelLogs.join(" | "));

    await tab(B, "scorecard");
    ok("another tab still draws (Scorecard, with the hook still armed)", await tid(B, "mc-bat-row").count() > 0 && await tid(B, "panel-error").count() === 0);
    await tab(B, "analytics");
    ok("...and Analytics", await tid(B, "mc-analytics").count() === 1 && await tid(B, "panel-error").count() === 0);
    await tab(B, "commentary");
    ok("back on Commentary it is still the card (the hook is still armed), and that second failure is logged once more", await tid(B, "panel-error").count() === 1 && panelLogs.length === 2, panelLogs.join(" | "));

    await B.evaluate(() => { window.__SCRBRD_TEST_THROW__ = null; });
    await tid(B, "panel-error-retry").click();
    await B.waitForTimeout(500);
    ok("Try again, once the fault has gone, brings the panel back", await tid(B, "panel-error").count() === 0 && await tid(B, "mc-line").count() > 0);
    ok("...and logged nothing more: a retry that works is silent", panelLogs.length === 2, panelLogs.join(" | "));

    // The routed view: the shell's boundary, keyed on the page.
    await tid(B, "mc-back").click();
    await B.waitForTimeout(400);
    await B.evaluate(() => { window.__SCRBRD_TEST_THROW__ = "Calendar"; });
    const cal = B.locator('[data-testid="nav-calendar"], [data-testid="mnav-calendar"]').first();
    ok("Calendar is in the director's navigation", await cal.count() === 1);
    await cal.click().catch(() => {});
    await afterReads(B, 800);
    ok("a routed view that throws is a card inside <main>", await B.locator('[data-testid="os-main"] [data-testid="panel-error"][data-panel="Calendar"]').count() === 1);
    ok("...with the navigation and the top bar still there", await B.locator('[data-testid="nav"], [data-testid="mnav"]').first().isVisible());
    await B.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click();
    await afterReads(B, 1200);
    ok("...and choosing another view leaves the failure behind", await B.locator('[data-testid="panel-error"]').count() === 0
       && await B.locator('[data-testid="os-main"]').getAttribute("data-page") === "matches");
    const pageErrors = bd.errors.filter((e) => /^pageerror/.test(e));
    ok("no uncaught page error — every throw was caught", pageErrors.length === 0, pageErrors.join(" | "));
    await bd.ctx.close();

    // GA-I29 (review S2): the scenario panel has a boundary of its own with no card. If it fails (its chunk
    // will not load, or it throws) the Summary stands exactly as it was: the board, and no failure card.
    {
      const ebId = (await q(
        `insert into match (school_id, team_code, opponent, ground_id, starts_at, sport, format, overs, status)
         values ($1, '1XI', 'Boundary Test Opponent', $2, now() - interval '20 minutes', 'cricket', 'T20', 20, 'live') returning id`, [HIL, null]))[0].id;
      await q(`insert into match_toss (match_id, school_id, won_by, decision) values ($1, $2, 'home', 'bat')`, [ebId, HIL]);
      let en = 0;
      const atE = (ev) => ({ ...ev, innings: 0, id: `mc-eb-${++en}`, clientTs: Date.parse("2026-11-12T09:00:00Z") + en * 20000 });
      await writeEvents(q, ebId, [
        atE(inningsStart({ battingTeam: "1XI", bowlingTeam: "Boundary Test Opponent", teamKey: "1XI", bowlingTeamKey: "Boundary Test Opponent",
          squad: Array.from({ length: 11 }, (_, k) => ({ id: `eb${k}`, name: `Edge ${k + 1}` })), bowlingSquad: [], overs: 20 })),
        atE(batters({ striker: "eb0", nonStriker: "eb1" })), atE(bowler({ bowler: "Edge Bowler" })),
        ...[1, 0, 4, 1, 0, 2].map((v) => atE(ball({ value: v }))), atE(bowler({ bowler: "Edge Bowler Two" })),
        ...[1, 1, 0, 6, 1, 2].map((v) => atE(ball({ value: v }))),
      ]);
      const sl = [];
      const se = await open({ init: `window.__SCRBRD_TEST_THROW__ = "scenarios";` });
      se.page.on("console", (m) => { if (/^\[panel\]/.test(m.text())) sl.push(m.text()); });
      ok("the director of sport signs in", await signIn(se.page, /sarah@example\.invalid|Director/));
      ok("a live fixture at twelve balls opens", await openMatch(se.page, ebId));
      await afterReads(se.page, 1500);
      ok("the scenario panel, made to throw, is simply absent: no card, no alert", await tid(se.page, "mc-scenario").count() === 0
         && await tid(se.page, "panel-error").count() === 0);
      ok("...and the Summary stands: the board, its \"At this rate\", the latest balls", await tid(se.page, "mc-board").count() === 1
         && /At this rate: 190/.test(await tid(se.page, "mc-board-sub").innerText().catch(() => "")) && await tid(se.page, "mc-latest").count() === 1);
      ok("...the failure logged once, by name", sl.length === 1 && /^\[panel\] scenarios could not be shown: test throw$/.test(sl[0] ?? ""), sl.join(" | "));
      await se.ctx.close();
      await q(`update match set status = 'complete' where id = $1`, [ebId]);
    }

    // And the ordinary build does not carry the hook at all.
    WEB_ROOT = "apps/web/dist";
    const plain = await open({ init: `window.__SCRBRD_TEST_THROW__ = "commentary";` });
    await signIn(plain.page, /sarah@example\.invalid|Director/);
    await openMatch(plain.page, fx.live);
    await tab(plain.page, "commentary");
    ok("in the ordinary build, asking a panel to throw does nothing", await tid(plain.page, "panel-error").count() === 0 && await tid(plain.page, "mc-line").count() > 0);
    ok("no console errors (ordinary build)", plain.errors.length === 0, plain.errors.join(" | "));
    await plain.ctx.close();
  } finally {
    WEB_ROOT = "apps/web/dist";
  }

  if (SHOTS) {
    group(`Screenshots → ${SHOTS}`);
    await mkdir(SHOTS, { recursive: true });
    for (const [scheme, theme] of [["light", "daylight"], ["dark", "floodlit"]]) {
      for (const [vp, w] of [[PHONE, 390], [DESK, 1366]]) {
        const s = await open({ viewport: vp, scheme });
        await signIn(s.page, /sarah@example\.invalid|Director/);
        await s.page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
        await s.page.waitForTimeout(1500);
        await s.page.screenshot({ path: join(SHOTS, `after-list-${w}-${theme}.png`), fullPage: false });
        await openMatch(s.page, fx.live);
        for (const t of TABS) {
          await tab(s.page, t);
          if (t === "scorecard") { await tid(s.page, "mc-innings-0").click().catch(() => {}); await tid(s.page, "mc-bat-open").nth(1).click().catch(() => {}); await s.page.waitForTimeout(400); }
          await s.page.screenshot({ path: join(SHOTS, `after-${t}-${w}-${theme}.png`), fullPage: true });
        }
        await tab(s.page, "summary");
        await tid(s.page, "mc-bigscreen-open").click().catch(() => {});
        await s.page.waitForTimeout(600);
        await s.page.screenshot({ path: join(SHOTS, `after-bigscreen-${w}-${theme}.png`) });
        await tid(s.page, "mc-bigscreen-close").click().catch(() => {});
        await tid(s.page, "mc-back").click().catch(() => {});
        await openMatch(s.page, fx.brk);
        await s.page.screenshot({ path: join(SHOTS, `after-break-${w}-${theme}.png`), fullPage: true });
        await s.ctx.close();
      }
    }
    ok("screenshots saved", true);

    group(`SCRBRD-100 screenshots (full time) → ${SHOTS}`);
    // 1280×800 (desktop) and 390×844 (phone), in Daylight and Floodlit: the
    // full-time links and the confirm prompt. The empty states were already
    // saved above (before this fixture existed) and the result's own moment
    // was saved the one time it actually fired.
    const FT_DESK = { width: 1280, height: 800 };
    for (const [scheme, theme] of [["light", "daylight"], ["dark", "floodlit"]]) {
      for (const [vp, w] of [[PHONE, 390], [FT_DESK, 1280]]) {
        const s = await open({ viewport: vp, scheme });
        await signIn(s.page, /sarah@example\.invalid|Director/);
        ok("the decided fixture opens for screenshots", await openMatch(s.page, fx.live));
        await s.page.waitForTimeout(400);
        await s.page.screenshot({ path: join(SHOTS, `fulltime-onward-${w}-${theme}.png`), fullPage: true });
        await s.ctx.close();
      }
    }
    for (const [scheme, theme] of [["light", "daylight"], ["dark", "floodlit"]]) {
      for (const [vp, w] of [[PHONE, 390], [FT_DESK, 1280]]) {
        const s = await open({ viewport: vp, scheme });
        await signIn(s.page, /scorer@example\.invalid|Scorer/);
        await openMatch(s.page, fx.live);
        await s.page.waitForTimeout(400);
        await s.page.screenshot({ path: join(SHOTS, `fulltime-confirm-${w}-${theme}.png`), fullPage: true });
        await s.ctx.close();
      }
    }
    ok("SCRBRD-100 screenshots saved", true);
  }
} catch (e) {
  ok(`the Match Centre walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(e.stack);
} finally {
  await browser.close().catch(() => {});
  apiProc.kill("SIGTERM");
  web.close();
  await pool.end().catch(() => {});
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER MATCH CENTRE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

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
 *      draws the board full screen and leaves on Escape or its button.
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
import { deriveMatch, deriveInnings, deriveCommentary, runsOffBat, ball, batters, bowler, inningsStart, revision, sealInnings, placementFromTap } from "@scrbrd/scoring";
import { buildMatchCentreFixture, writeEvents, HIL } from "./fixture-matchcentre.mjs";
import { correctionsOf, withCorrectionLines } from "../apps/web/src/lib/corrections.js";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

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
  await page.waitForTimeout(2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}
async function openMatch(page, id) {
  await page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const btn = tid(page, `mc-open-${id}`);
  if (!(await btn.count())) return false;
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(1800);
  return (await tid(page, "match-view").count()) === 1;
}
const tab = async (page, id) => { await tid(page, `mc-tab-${id}`).click({ timeout: 4000 }); await page.waitForTimeout(500); };

const TABS = ["summary", "scorecard", "commentary", "partnerships", "analytics", "details"];

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
  const GORDON = "ffffffff-0000-0000-0000-000000000001";
  const revId = (await q(
    `insert into match (school_id, team_code, opponent, ground_id, starts_at, sport, format, overs, status)
     values ($1, '1XI', 'Rain Test Opponent', $2, now() - interval '40 minutes', 'cricket', 'T20', 20, 'live') returning id`,
    [HIL, GORDON]))[0].id;
  await q(`insert into match_toss (match_id, school_id, won_by, decision) values ($1, $2, 'home', 'bat')`, [revId, HIL]);
  const revLog = [];
  let rn = 0;
  const addRev = (ev) => { const e = { ...ev, innings: 0, id: `mc-rev-${++rn}`, clientTs: Date.parse("2026-09-26T09:00:00Z") + rn * 20000 }; revLog.push(e); return e; };
  addRev(inningsStart({ battingTeam: "1XI", bowlingTeam: "Rain Test Opponent", teamKey: "1XI", bowlingTeamKey: "Rain Test Opponent",
    squad: [{ id: "rb1", name: "Rain One" }, { id: "rb2", name: "Rain Two" }], bowlingSquad: [], overs: 20 }));
  addRev(batters({ striker: "rb1", nonStriker: "rb2" }));
  addRev(bowler({ bowler: "Rain Bowler" }));
  addRev(ball({ value: 1 }));
  addRev(ball({ value: 4 }));
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
  ok("no console errors (revision)", revS.errors.length === 0, revS.errors.join(" | "));
  await revS.ctx.close();
  // Done with it: taken out of "live" so the later "nothing live" screenshot
  // still shows the true empty state rather than this one fixture.
  await q(`update match set status = 'complete' where id = $1`, [revId]);

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
  ok(`the match line: age group · ground · start · innings ("${line}")`,
     /1st XI · Gordon Sherwood Oval · \w{3} \d{1,2} \w{3} · \d\d:\d\d · 2nd innings/.test(line), line);
  ok("...one line of body text", await tid(p, "mc-match-line").evaluate((e) => e.tagName === "P" && parseFloat(getComputedStyle(e).fontSize) >= 14));

  group("Summary: the Board, with the fold's own figures");
  const total = (await tid(p, "mc-board-total").innerText()).replace(/\s/g, "");
  ok(`the board's total is the fold's (${inn2.runs}/${inn2.wickets})`, total === `${inn2.runs}/${inn2.wickets}`, total);
  ok("...the chase in words", new RegExp(`Need ${inn2.target - inn2.runs} off ${60 - inn2.balls}`).test(await tid(p, "mc-board-sub").innerText()));
  ok("...and no \"At this rate\" in a second innings: the required rate is what the chase shows", !/At this rate/.test(await tid(p, "mc-board-sub").innerText()));
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
  ok("...with one correction line for each of the two corrections, and no more (GA-I36)",
     all.filter((k) => k.startsWith("c:")).length === 2 && told.filter((c) => c.kind === "correction").length === 2);
  ok("the voided delivery and the amended one have no line", voided.every((t) => !all.some((k) => k === `e:${t}` || k.startsWith(`e:${t}#`))));
  const body = await tid(p, "mc-commentary").innerText();
  ok("Westville start their innings on the five penalty runs", /Westville Boys' High 1XI start their innings on 5/.test(body));
  ok("the short run is told in words, with no Law clause number", /deliberate short running/.test(body) && !/\bLaws?\s+\d/.test(body));
  ok("the free hit is told, and the wicket it saved", /Free hit: .* bowled, but it's a free hit: not out\./.test(body));
  ok("no id reaches a line", !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(body));

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
  await tab(p, "details");
  const det = await tid(p, "mc-details").innerText();
  ok("the format, the ground and the toss", /T10 · 10 overs a side/.test(det) && /Gordon Sherwood Oval/.test(det)
     && /Hilton College 1XI won the toss and chose to bat/.test(det), det.slice(0, 200));
  await tid(p, "mc-back").click(); await p.waitForTimeout(600);
  ok("All matches goes back to the list", await tid(p, "match-view").count() === 0 && await tid(p, `match-card-${fx.live}`).count() === 1);

  group("The innings break: the break card on Summary");
  ok("the second fixture opens", await openMatch(p, fx.brk));
  const brk = deriveMatch(fx.events[fx.brk]).innings[0];
  const card = await tid(p, "innings-break").innerText().catch(() => "");
  ok(`"Kearsney College U16A need ${brk.runs + 1} to win"`, new RegExp(`Kearsney College U16A need ${brk.runs + 1} to win`).test(card), card.slice(0, 160));
  const top = [...brk.batsmen].sort((a, b) => b.runs - a.runs || a.balls - b.balls)[0];
  ok(`top scorer ${top.name} ${top.runs}`, (await tid(p, "ib-top-scorers").innerText()).includes(top.name));
  ok("best bowling, most boundaries, best strike rate", await tid(p, "ib-best-bowling").count() === 1 && await tid(p, "ib-boundaries").count() === 1
     && await tid(p, "ib-strike-rate").count() === 1);
  ok("the match line says so", /Innings break/.test(await tid(p, "mc-match-line").innerText()));
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
  await L.waitForTimeout(3500);
  ok("a fresh load plays no moment and no over summary (two reads later)",
     await tid(L, "mc-moment").count() === 0 && await tid(L, "mc-over-summary").count() === 0);

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
  ok("the result arrives as a moment on the board — held no longer than a milestone",
     await until(L, () => document.querySelector('[data-testid="mc-moment"][data-kind="result"]')?.innerText.includes("won by"), 8000));
  ok("...beside the total, which stays in view throughout", await tid(L, "mc-board-total").isVisible());
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
  await fin.page.waitForTimeout(2000);
  ok("a fresh read plays no moment a second time — nothing is replayed on load", await tid(fin.page, "mc-moment").count() === 0);
  ok("the onward links show", await tid(fin.page, "mc-onward").count() === 1);
  ok("Hilton's own next fixture (the seeded one)", await tid(fin.page, "mc-onward-next-home").count() === 1);
  ok("...never a link to Westville's — no fixture of theirs is on this list, and this never guesses one",
     await tid(fin.page, "mc-onward-next-away").count() === 0);
  ok("both sides' results are one tap away", await tid(fin.page, "mc-onward-results-home").count() === 1
     && await tid(fin.page, "mc-onward-results-away").count() === 1);
  await tid(fin.page, "mc-onward-results-away").click({ timeout: 4000 });
  await fin.page.waitForTimeout(800);
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
  await sc.page.waitForTimeout(300);
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

  group("At 390 wide: the sides by code, and nothing wider than the screen");
  const ph = await open({ viewport: PHONE, scheme: "light" });
  await signIn(ph.page, /sarah@example\.invalid|Director/);
  ok("the fixture opens on a phone", await openMatch(ph.page, fx.live));
  const shortShown = await ph.page.locator("#mc-panel-summary, [data-testid='mc-scores']").first().evaluate(() =>
    [...document.querySelectorAll("[data-testid='mc-scores'] .mc-short")].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.textContent));
  ok(`the scores name the sides by code (${shortShown.join(", ")})`, shortShown.length === 2 && shortShown[0] === "HIL 1XI", shortShown.join(", "));
  for (const t of TABS) {
    await tab(ph.page, t);
    const wide = await ph.page.evaluate(() => document.documentElement.scrollWidth);
    ok(`${t}: no sideways scroll at 390 (${wide})`, wide <= 390);
  }
  ok("no console errors (phone)", ph.errors.length === 0, ph.errors.join(" | "));
  await ph.ctx.close();

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
    ok("Summary draws, with no failure card", await tid(B, "mc-board-total").count() === 1 && await tid(B, "panel-error").count() === 0);

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
    await B.waitForTimeout(800);
    ok("a routed view that throws is a card inside <main>", await B.locator('[data-testid="os-main"] [data-testid="panel-error"][data-panel="Calendar"]').count() === 1);
    ok("...with the navigation and the top bar still there", await B.locator('[data-testid="nav"], [data-testid="mnav"]').first().isVisible());
    await B.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click();
    await B.waitForTimeout(1200);
    ok("...and choosing another view leaves the failure behind", await B.locator('[data-testid="panel-error"]').count() === 0
       && await B.locator('[data-testid="os-main"]').getAttribute("data-page") === "matches");
    const pageErrors = bd.errors.filter((e) => /^pageerror/.test(e));
    ok("no uncaught page error — every throw was caught", pageErrors.length === 0, pageErrors.join(" | "));
    await bd.ctx.close();

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

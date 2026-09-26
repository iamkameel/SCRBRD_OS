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
 *   8. at 390 wide: the sides by code, and nothing wider than the screen.
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
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { deriveMatch, deriveCommentary, runsOffBat } from "@scrbrd/scoring";
import { buildMatchCentreFixture } from "./fixture-matchcentre.mjs";

const WEB_PORT = 5361;
const API_PORT = 8961;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_MC_DEBUG;
const SHOTS = process.env.MC_SHOTS || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-mc-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

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
const q = async (t, p) => (await pool.query(t, p)).rows;
const browser = await chromium.launch({ ...launchOptions() });

/** A fresh session, at a width and in a theme (the device's colour scheme). */
async function open({ viewport = DESK, scheme = "dark" } = {}) {
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
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
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

  group("A real, scored fixture on the ball log, folded here by the same package");
  const fx = await buildMatchCentreFixture(q);
  const evs = fx.events[fx.live];
  const fold = deriveMatch(evs);
  const [inn1, inn2] = fold.innings;
  const byId = Object.fromEntries(Object.entries(fx.players).map(([n, id]) => [id, n]));
  const FULL = { "1XI": "Hilton College 1XI", "Westville Boys' High 1XI": "Westville Boys' High 1XI" };
  const expected = deriveCommentary(evs, { nameOf: (r) => byId[r] ?? r, teamName: (_k, n) => FULL[n] ?? n });
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

  group("The tabs: six, in the prototype's order, a tablist a keyboard drives");
  const tabs = await p.evaluate(() => {
    const list = document.querySelector('[role="tablist"][data-testid="mc-tabs"]');
    return list ? [...list.querySelectorAll('[role="tab"]')].map((t) => {
      const r = t.getBoundingClientRect();
      return { name: t.textContent.trim(), selected: t.getAttribute("aria-selected"), controls: t.getAttribute("aria-controls"),
        h: r.height, font: parseFloat(getComputedStyle(t).fontSize) };
    }) : null;
  });
  ok("Summary · Scorecard · Commentary · Partnerships · Analytics · Match details",
     tabs?.map((t) => t.name).join(" · ") === "Summary · Scorecard · Commentary · Partnerships · Analytics · Match details", tabs?.map((t) => t.name).join(" · "));
  ok("...Summary selected first, and each names the panel it controls", tabs?.[0]?.selected === "true" && tabs.every((t) => /^mc-panel-/.test(t.controls ?? "")));
  ok("...every tab at least 44px tall", tabs?.every((t) => t.h >= 44), tabs?.map((t) => t.h).join(","));
  ok("...and on the 12px floor", tabs?.every((t) => t.font >= 12));
  await tid(p, "mc-tab-summary").focus();
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
  ok("...the latest lines are the generator's", (await tid(p, "mc-latest").innerText()).includes(expected.filter((c) => c.kind !== "over_end").at(-1).text));

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
  ok("every line on screen is word for word the generator's",
     lines.every((l) => l.text.includes(expected.find((c) => c.key === l.key)?.text ?? "∅")));
  while (await tid(p, "mc-commentary-more").count()) { await tid(p, "mc-commentary-more").click(); await p.waitForTimeout(300); }
  const all = await p.locator('[data-testid="mc-line"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
  ok(`the whole match, every line but the overs' summaries (${expected.filter((c) => c.kind !== "over_end").length})`,
     all.length === expected.filter((c) => c.kind !== "over_end").length, all.length);
  ok("the voided delivery and the amended one have no line", voided.every((t) => !all.some((k) => k === `e:${t}` || k.startsWith(`e:${t}#`))));
  const body = await tid(p, "mc-commentary").innerText();
  ok("Westville start their innings on the five penalty runs", /Westville Boys' High 1XI start their innings on 5/.test(body));
  ok("the short run is told, with the Law", /deliberate short running \(Law 41\.5\)/.test(body));
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
  ok("no console errors (desktop)", dos.errors.length === 0, dos.errors.join(" | "));
  await dos.ctx.close();

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
        await tid(s.page, "mc-back").click().catch(() => {});
        await openMatch(s.page, fx.brk);
        await s.page.screenshot({ path: join(SHOTS, `after-break-${w}-${theme}.png`), fullPage: true });
        await s.ctx.close();
      }
    }
    ok("screenshots saved", true);
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

#!/usr/bin/env node
/**
 * Low data on the public match page (Cricinfo plan CRI-2.4), signed out, on
 * the seed's own fixture scored live (db/98's Hilton 1XI v Michaelhouse).
 *
 *   1. Off by default: the switch is there (a toggle button, 44px, 14px
 *      type), the worm is drawn from its own chunk and the par is read.
 *   2. On by itself when the browser says Save-Data: it says why; no chart
 *      is drawn and the worm's chunk is never fetched; no /par read, and on
 *      Analytics no /shots read; the page keeps to the phone's own type.
 *   3. The score still updates: a ball written after the page opened reaches
 *      the header, read as the log's new events only (`?since=`), with the
 *      reads at least four times further apart than the live pace.
 *   4. The switch always turns it off, and the choice is remembered on the
 *      device over what the browser says; and back on, remembered too.
 *   5. On a 3G connection (Chromium's own throttle, Save-Data on): the
 *      page is never blank after the shell, and the score is up in 3 s.
 *
 * Nothing new is shown about anyone: the page's text with Low data on is
 * held to the text with it off, less the switch's own words, so no name the
 * rule did not already allow appears.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-public-lowdata.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { writeEvents } from "./fixture-matchcentre.mjs";
import { ball, batters, bowler, inningsStart, BALL_TYPE } from "@scrbrd/scoring";
import { afterReads, watchReads } from "./walk-wait.mjs";

const PORT = port(8976);
const BASE = `http://127.0.0.1:${PORT}`;
const DEBUG = !!process.env.BROWSER_PUBLIC_DEBUG;
const LIVE = "77777777-0000-0000-0000-000000000002";      // Hilton 1XI v Michaelhouse (db/98)
const P = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000003",
  "aaaaaaaa-0000-0000-0000-000000000004", "aaaaaaaa-0000-0000-0000-000000000005"];
const TYPED = ["Nathan Pretorius", "Kyle Venter"];

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) { pass++; if (DEBUG) console.log("  ✓", n); } else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", SESSION_SECRET: "browser-public-lowdata-secret",
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-public-lowdata-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1",
         SERVE_CLIENT: "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
api.stdout.on("data", (d) => { if (DEBUG) process.stdout.write(d); });
api.stderr.on("data", (d) => { if (DEBUG) process.stderr.write(d); });

const owner = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const q = async (/** @type {string} */ t, /** @type {any[]} */ p = []) => (await owner.query(t, p)).rows;
async function as(/** @type {string} */ user, /** @type {string} */ text, /** @type {any[]} */ params = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.device_id', 'browser-public-lowdata', true)", [user]);
    const r = (await c.query(text, params)).rows;
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

/** What the browser says of its connection, set before the page's own script runs. */
const connection = (/** @type {{saveData: boolean, effectiveType: string}} */ c) => `
  Object.defineProperty(Navigator.prototype, "connection", { configurable: true,
    get: () => ({ saveData: ${c.saveData}, effectiveType: ${JSON.stringify(c.effectiveType)}, addEventListener() {}, removeEventListener() {} }) });
  window.__SCRBRD_LIVE_MS__ = 1000;`;

const browser = await chromium.launch({ ...launchOptions() });
let putBack = async () => {};
let xff = 0;
/** A signed-out visitor's tab, each from an address of its own (the public rate limit is per address). */
async function visitor(/** @type {{saveData: boolean, effectiveType: string}} */ conn) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": `10.86.0.${++xff}` } });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  /** @type {{url: string, at: number}[]} */
  const asked = [];
  page.on("request", (r) => asked.push({ url: r.url(), at: Date.now() }));
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(connection(conn));
  return { ctx, page, asked, errors };
}
const tid = (/** @type {any} */ page, /** @type {string} */ id) => page.locator(`[data-testid="${id}"]`);
const reads = (/** @type {{url: string}[]} */ asked, /** @type {RegExp} */ re) => asked.filter((r) => re.test(new URL(r.url).pathname + new URL(r.url).search));
const PAR = /\/api\/public\/matches\/[^/]+\/par$/;
const SHOTS = /\/api\/public\/matches\/[^/]+\/shots$/;
const LOG = /\/api\/public\/matches\/[^/]+\/log(\?|$)/;
const WORM_CHUNK = /\/assets\/summaryWorm-[^/]+\.js$/;

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const SARAH = (await q(`select id from app_user where email = 'sarah@example.invalid'`))[0].id;

  group("0. The seed's fixture, published and scored live: eight balls, past the worm's first over");
  await q(`update match set status = 'live', starts_at = (sa_today()::timestamp + interval '9 hours') at time zone 'Africa/Johannesburg' where id = $1`, [LIVE]);
  await q(`insert into match_toss (match_id, school_id, won_by, decision) values ($1, '11111111-1111-1111-1111-111111111111', 'home', 'bat') on conflict do nothing`, [LIVE]);
  const names = Object.fromEntries((await q(`select id, full_name from player where id = any($1::uuid[])`, [P])).map((r) => [r.id, r.full_name]));
  let n = 0;
  const t0 = Date.now() - 30 * 60000;
  const at = (/** @type {any} */ ev) => ({ ...ev, innings: 0, id: `cri24-${++n}`, clientTs: t0 + n * 30000 });
  const log = [
    at(inningsStart({ battingTeam: "1XI", bowlingTeam: "Michaelhouse", teamKey: "1XI", bowlingTeamKey: "Michaelhouse",
      squad: P.map((id) => ({ id, name: names[id] })), bowlingSquad: TYPED.map((nm) => ({ id: nm, name: nm })), overs: 20 })),
    at(batters({ striker: P[0], nonStriker: P[1] })),
    at(bowler({ bowler: TYPED[0] })),
    ...[1, 0, 4, 1, 0, 2].map((v) => at(ball({ type: BALL_TYPE.RUN, value: v }))),
    at(bowler({ bowler: TYPED[1] })),
    ...[0, 1].map((v) => at(ball({ type: BALL_TYPE.RUN, value: v }))),
  ];
  await writeEvents(q, LIVE, log);
  await as(SARAH, `select * from fixture_publish($1, 'home', true)`, [LIVE]);
  putBack = async () => {
    await as(SARAH, `select * from fixture_publish($1, 'home', false)`, [LIVE]);
    await q(`update match set starts_at = now() + interval '3 days' where id = $1`, [LIVE]);
  };
  const header = async (/** @type {any} */ page) => (await tid(page, "mc-scores").innerText().catch(() => "")).replace(/\s+/g, " ");

  group("1. Off by default: the switch, the worm from its own chunk, the par read");
  const A = await visitor({ saveData: false, effectiveType: "4g" });
  await A.page.goto(`${BASE}/live/${LIVE}`, { waitUntil: "networkidle" });
  await tid(A.page, "mc-worm-panel").waitFor({ timeout: 10000 }).catch(() => {});
  await afterReads(A.page, 500);
  const sw = tid(A.page, "public-low-data-switch");
  ok("the switch is drawn, a toggle button, not pressed", await sw.count() === 1 && await sw.getAttribute("aria-pressed") === "false"
     && await tid(A.page, "public-low-data").getAttribute("data-on") === "false");
  const box = await sw.boundingBox();
  const size = await sw.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)).catch(() => 0);
  ok(`...44px or more to tap (${box?.height ?? 0}px) and 12px or more to read (${size}px)`, (box?.height ?? 0) >= 44 && (box?.width ?? 0) >= 44 && size >= 12);
  ok("...named by what it is, its state the button's own (aria-pressed)", /^Low data/.test((await sw.innerText()).trim()), await sw.innerText());
  ok("the worm is drawn, fetched as a chunk of its own", await tid(A.page, "mc-worm-panel").count() === 1 && reads(A.asked, WORM_CHUNK).length >= 1,
     A.asked.filter((r) => /assets\//.test(r.url)).map((r) => r.url.split("/").pop()).join(" "));
  ok("...and the par is read", reads(A.asked, PAR).length >= 1);
  ok("the page uses its own type, not the system's", !/system-ui/.test(await tid(A.page, "mc-title").evaluate((e) => getComputedStyle(e).fontFamily)));
  const scoreOff = await header(A.page);
  const textOff = await tid(A.page, "public-match").innerText();
  ok(`the score is up: ${scoreOff}`, /\d+\/\d+/.test(scoreOff));

  group("2. On by itself when the browser says Save-Data: no chart, no chunk for one, no /par, no /shots");
  const B = await visitor({ saveData: true, effectiveType: "4g" });
  await B.page.goto(`${BASE}/live/${LIVE}`, { waitUntil: "networkidle" });
  await tid(B.page, "mc-board").waitFor({ timeout: 10000 }).catch(() => {});
  await afterReads(B.page, 1000);
  const swB = tid(B.page, "public-low-data-switch");
  ok("Low data is on, pressed, and says why", await swB.getAttribute("aria-pressed") === "true"
     && /asked to save data/.test(await tid(B.page, "public-low-data-says").innerText().catch(() => "")),
     await tid(B.page, "public-low-data-says").innerText().catch(() => "(no line)"));
  ok("...the line is the switch's description", await swB.getAttribute("aria-describedby") === "public-low-data-says");
  ok("the board is drawn, with the same score", await tid(B.page, "mc-board").count() === 1 && await header(B.page) === scoreOff, await header(B.page));
  ok("no worm, no rate track", await tid(B.page, "mc-worm-panel").count() === 0 && await tid(B.page, "mc-rate-track").count() === 0);
  ok("...and the worm's chunk was never fetched", reads(B.asked, WORM_CHUNK).length === 0);
  ok("no /par read", reads(B.asked, PAR).length === 0, reads(B.asked, PAR).map((r) => r.url).join(" "));
  ok("the page keeps to the phone's own type (no web font is used, so none is fetched)",
     /system-ui/.test(await tid(B.page, "mc-title").evaluate((e) => getComputedStyle(e).fontFamily))
     && await B.page.locator("main[data-low-data]").count() === 1);
  const textOn = await tid(B.page, "public-match").innerText();
  const said = (await tid(B.page, "public-low-data").innerText()) + "\n" + (await tid(A.page, "public-low-data").innerText());
  // Figures and ages move between two reads ("Updated 3 s ago"); a name is not a figure.
  const plain = (/** @type {string} */ t) => t.replace(/\d+/g, "#");
  const extra = textOn.split("\n").map((l) => l.trim()).filter((l) => l && !plain(textOff).includes(plain(l)) && !said.includes(l));
  ok("nothing new is shown about anyone: every line on the page was there with Low data off, but the switch's own", extra.length === 0, extra.join(" | "));
  {
    const before = B.asked.length;
    await B.page.goto(`${BASE}/live/${LIVE}/analytics`, { waitUntil: "networkidle" });
    await tid(B.page, "mc-analytics").waitFor({ timeout: 8000 }).catch(() => {});
    await afterReads(B.page, 500);
    ok("Analytics keeps the side's figures and says the chart is off", await tid(B.page, "mc-analytics").count() === 1
       && await tid(B.page, "mc-sectors-low-data").count() === 1 && await tid(B.page, "mc-team-wheel").count() === 0);
    ok("...with no /shots read", reads(B.asked.slice(before), SHOTS).length === 0);
    await B.page.goto(`${BASE}/live/${LIVE}`, { waitUntil: "networkidle" });
    await tid(B.page, "mc-board").waitFor({ timeout: 8000 }).catch(() => {});
  }

  group("3. The score still updates, from the log's new events, at a slower pace");
  {
    const from = B.asked.length;
    await afterReads(B.page, 500);
    const more = [at(ball({ type: BALL_TYPE.RUN, value: 6 }))];
    await writeEvents(q, LIVE, more, log.length);
    log.push(...more);
    const t = Date.now();
    let now = await header(B.page);
    while (now === scoreOff && Date.now() - t < 60000) { await B.page.waitForTimeout(500); now = await header(B.page); }
    ok(`the six reaches the header (${scoreOff} → ${now}) in ${Math.round((Date.now() - t) / 1000)} s`, now !== scoreOff && /\d+\/\d+/.test(now));
    const logs = reads(B.asked.slice(from), LOG);
    ok("...read as the log's new events only (?since=)", logs.length >= 1 && logs.every((r) => /[?&]since=\d+/.test(r.url)), logs.map((r) => r.url.split("/").pop()).join(" "));
    const mount = reads(B.asked.slice(0, from), LOG).slice(-1);
    const all = [...mount, ...logs].map((r) => r.at);
    const gaps = all.slice(1).map((x, i) => x - all[i]).filter((g) => g > 1000);
    ok(`...the reads at least four times the live pace apart (${gaps.map((g) => Math.round(g / 1000)).join(", ")} s; live pace 5 s)`,
       gaps.length >= 1 && gaps.every((g) => g >= 18000));
    ok("...and no /par read in all that time", reads(B.asked, PAR).length === 0);
  }

  group("4. The switch always turns it off, remembered on the device over Save-Data; and back on");
  {
    await tid(B.page, "public-low-data-switch").click();
    await tid(B.page, "mc-worm-panel").waitFor({ timeout: 10000 }).catch(() => {});
    ok("off: the button is not pressed and the worm comes back", await tid(B.page, "public-low-data-switch").getAttribute("aria-pressed") === "false"
       && await tid(B.page, "mc-worm-panel").count() === 1);
    ok("...the choice is kept on the device", await B.page.evaluate(() => localStorage.getItem("scrbrd.public.lowData")) === "off");
    const from = B.asked.length;
    await B.page.reload({ waitUntil: "networkidle" });
    await tid(B.page, "mc-worm-panel").waitFor({ timeout: 10000 }).catch(() => {});
    await afterReads(B.page, 500);
    ok("a reload keeps it off though the browser still says Save-Data", await tid(B.page, "public-low-data-switch").getAttribute("aria-pressed") === "false"
       && await tid(B.page, "mc-worm-panel").count() === 1 && reads(B.asked.slice(from), PAR).length >= 1);
    await tid(B.page, "public-low-data-switch").click();
    await B.page.reload({ waitUntil: "networkidle" });
    await tid(B.page, "mc-board").waitFor({ timeout: 10000 }).catch(() => {});
    ok("on again, by choice: remembered, and it says no browser reason", await tid(B.page, "public-low-data-switch").getAttribute("aria-pressed") === "true"
       && !/asked to save data/.test(await tid(B.page, "public-low-data-says").innerText().catch(() => ""))
       && await tid(B.page, "mc-worm-panel").count() === 0);
  }
  ok("no page error on either visitor", A.errors.length + B.errors.length === 0, [...A.errors, ...B.errors].join(" | "));
  await A.ctx.close();
  await B.ctx.close();

  group("5. On 3G (Chromium's throttle, Save-Data on): never blank after the shell, the score up in 3 s");
  {
    const C = await visitor({ saveData: true, effectiveType: "3g" });
    const cdp = await C.ctx.newCDPSession(C.page);
    await cdp.send("Network.enable");
    // Chromium's "Fast 3G" preset (DevTools): 150 ms round trip × 3.75, 1.6 Mbps down × 0.9, 750 kbps up × 0.9.
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024 / 8) * 0.9,
      uploadThroughput: (750 * 1024 / 8) * 0.9 });
    // From the first frame the parser is past the shell's #root, every frame for 8 s: is there text in it?
    await C.page.addInitScript(() => {
      const w = /** @type {any} */ (window);
      w.__blank = [];
      w.__first = null;
      const look = () => {
        const root = document.getElementById("root");
        const text = !!root?.textContent?.trim();
        if (text && w.__first == null) w.__first = Math.round(performance.now());
        if (root && document.readyState !== "loading" && !text) w.__blank.push(Math.round(performance.now()));
        if (performance.now() < 8000) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    const t = Date.now();
    await C.page.goto(`${BASE}/live/${LIVE}`, { waitUntil: "commit" });
    // The score on screen: the shell's own line (the header's, before the bundle draws), then the page's.
    const SCORE = () => /\d+\/\d+/.test(document.querySelector('[data-testid="public-shell-score"], [data-testid="mc-scores"]')?.textContent ?? "");
    await C.page.waitForFunction(SCORE, null, { timeout: 15000 }).catch(() => {});
    const took = Date.now() - t;
    ok(`the score is up in ${(took / 1000).toFixed(1)} s on 3G (3 s or less)`, took <= 3000);
    ok(`...the score the page then draws: ${scoreOff.split(" ")[0]}`, (await tid(C.page, "public-shell-score").innerText().catch(() => "")).length > 0
       || (await header(C.page)).length > 0);
    await C.page.waitForFunction(() => /\d+\/\d+/.test(document.querySelector('[data-testid="mc-scores"]')?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
    const drawn = Date.now() - t;
    ok(`the live page takes over (${(drawn / 1000).toFixed(1)} s on 3G, uncompressed from this server) with the same score`,
       /\d+\/\d+/.test(await header(C.page)) && await tid(C.page, "public-shell").count() === 0);
    await C.page.waitForTimeout(500);
    const blank = await C.page.evaluate(() => /** @type {any} */ (window).__blank);
    ok(`...and the page is never blank after the shell (${blank.length} blank frames)`, blank.length === 0, blank.slice(0, 8).join(", "));
    ok("...in Low data, by itself", await tid(C.page, "public-low-data-switch").getAttribute("aria-pressed") === "true");
    console.log(`  (3G: first text ${await C.page.evaluate(() => /** @type {any} */ (window).__first)} ms, score on screen ${(took / 1000).toFixed(1)} s, live page ${(drawn / 1000).toFixed(1)} s)`);
    await C.ctx.close();
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw —", /** @type {any} */ (e)?.stack ?? e);
} finally {
  await putBack().catch((e) => console.log("  (put back failed:", e?.message, ")"));
  await browser.close().catch(() => {});
  api.kill();
  await owner.end().catch(() => {});
  await app.end().catch(() => {});
}

console.log(`\nBROWSER PUBLIC LOW DATA: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

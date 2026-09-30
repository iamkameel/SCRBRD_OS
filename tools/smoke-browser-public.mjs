#!/usr/bin/env node
/**
 * The public match page, signed out, in a browser (SCRBRD-083 phase 1).
 *
 * The API serves everything from one origin, as a single-container
 * deployment does (SERVE_CLIENT=apps/web/dist): the /live and /scorecard
 * shells, the /public-app.js bundle, and /api/public/*. Nobody signs in; the
 * browser holds no token and sends none.
 *
 *   1. The live page and the scorecard render the fixture from the redacted
 *      log, with the shared tabs: the board, the scorecard, the commentary,
 *      the partnerships, the team's sectors, the details.
 *   2. Names follow the rule: "D Erasmus" and "L Botha" (consented, their
 *      side published); every other Hilton boy "Batter" (a never-public mark,
 *      nothing recorded, names off for his age group); Westville's boys
 *      positions until Westville publishes; the typed fielder never named.
 *      No full name, no first name, no date, no "hurt", anywhere in the DOM.
 *   3. `noindex`: the robots meta in the page, X-Robots-Tag on the response.
 *   4. The office withdraws a consent, and a reload well inside the cache's
 *      60 seconds shows the position.
 *   5. An unpublished fixture's page is the same 404 as a missing one's.
 *   6. The rate limit answers 429.
 *   7. The page asks for nothing but /api/public/ and its own bundle, with no
 *      Authorization header; no console errors.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-public.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { buildPublicFixture, EXPECTED, HIL } from "./fixture-public.mjs";
import { writeEvents } from "./fixture-matchcentre.mjs";
import { ball, BALL_TYPE } from "@scrbrd/scoring";

const PORT = port(8848);
const BASE = `http://127.0.0.1:${PORT}`;
const MISSING = "77777777-0000-0000-0000-0000000fffff";
const DEBUG = !!process.env.BROWSER_PUBLIC_DEBUG;
/** PUBLIC_SHOTS=<dir> saves the live page and the scorecard as drawn. */
const SHOTS = process.env.PUBLIC_SHOTS || null;

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", SESSION_SECRET: "browser-public-secret",
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-public-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1",
         SERVE_CLIENT: "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));
api.stdout.on("data", (d) => { if (DEBUG) process.stdout.write(d); });

const owner = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const q = async (/** @type {string} */ t, /** @type {any[]} */ p = []) => (await owner.query(t, p)).rows;
async function as(/** @type {string} */ user, /** @type {string} */ text, /** @type {any[]} */ params = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.device_id', 'browser-public', true)", [user]);
    const r = (await c.query(text, params)).rows;
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
const userId = async (/** @type {string} */ email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;

const browser = await chromium.launch({ ...launchOptions() });
let ipN = 0;
/** A fresh visitor: a context of its own, from an address of its own, signed out. */
async function visit(/** @type {string} */ path, { width = 1280, init = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.84.0.${++ipN}` } });
  await offline(ctx);
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  page.on("request", (r) => requests.push({ url: r.url(), auth: r.headers().authorization ?? null }));
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return { ctx, page, res, errors, requests };
}
const tid = (/** @type {any} */ page, /** @type {string} */ id) => page.locator(`[data-testid="${id}"]`);
const tab = async (/** @type {any} */ page, /** @type {string} */ id) => { await tid(page, `mc-tab-${id}`).click({ timeout: 4000 }); await page.waitForTimeout(400); };
const text = (/** @type {any} */ page) => page.$eval("body", (/** @type {any} */ el) => el.innerText);

/** Every word the page must not show, whichever tab is open. */
const NEVER = ["Daniel", "Liam", "Pieter", "Markham", "Sipho", "Ndaba", "Thabo", "Nkosi", "Musa", "Zulu", "Warren", "Guest",
  "Gareth", "Oakes", "Henry", "Bramwell", "Twelfth", "Mansfield", "hurt", "injur", "unavail", "suspend", "Ruan"];
const leaks = (/** @type {string} */ s, /** @type {string[]} */ also = [], asText = true) => [...NEVER, ...also].filter((w) => s.includes(w))
  .concat(/\b(19|20)\d\d-\d\d-\d\d\b/.test(s) ? ["a date"] : [])
  // A pseudonym is an id, never a name: the page must not show one as text
  // (a scorecard line once did, "c d20bf7b8e52a b Bowler", before foldable()
  // learned the fielder).
  .concat(asText && /\b[0-9a-f]{12}\b/.test(s) ? [`a pseudonym shown as text (${s.match(/\b[0-9a-f]{12}\b/)?.[0]})`] : []);

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const fx = await buildPublicFixture(q);
  const { pub, pub2, ids } = fx;
  const SARAH = await userId("sarah@example.invalid");
  const REGISTRAR = await userId("registrar@example.invalid");
  for (const key of Object.keys(fx.guardians)) await as(fx.guardians[key], `select * from public_name_consent_set($1, true, 'public-names-2026-09')`, [ids[key]]);
  await as(SARAH, `select * from player_never_public_set($1, 'a protection order')`, [ids.markham]);
  const [{ grp }] = await q(`select birth_age_group(born) as grp from player where id = $1`, [ids.nkosi]);
  await as(SARAH, `select * from public_names_off_set($1, $2, true)`, [HIL, grp]);
  await as(SARAH, `select * from fixture_publish($1, 'home', true)`, [pub]);
  await as(SARAH, `select * from fixture_publish($1, 'home', true)`, [pub2]);

  group("1–3. The live page, signed out");
  const v = await visit(`/live/${pub}`);
  ok("the shell answers 200 with X-Robots-Tag: noindex, nofollow", v.res?.status() === 200 && /noindex/.test(v.res?.headers()["x-robots-tag"] ?? ""),
     `${v.res?.status()} ${v.res?.headers()["x-robots-tag"]}`);
  ok("the page carries the robots meta", /noindex/.test(await v.page.$eval('meta[name="robots"]', (/** @type {any} */ m) => m.content).catch(() => "")));
  await v.page.waitForSelector('[data-testid="public-match"]', { timeout: 10000 }).catch(() => {});
  ok("the match renders", await tid(v.page, "public-match").count() === 1, (await text(v.page)).slice(0, 300));
  const title = await tid(v.page, "mc-title").innerText().catch(() => "");
  ok("both sides are named in full", /Hilton College 1XI/.test(title) && /Westville Boys' High 1XI/.test(title), title);
  ok("it says Live", (await tid(v.page, "mc-status").textContent().catch(() => "")) === "Live");
  ok("the board is drawn", await tid(v.page, "mc-board").count() === 1);
  const region = await tid(v.page, "public-announcer").evaluate((e) => ({ role: e.getAttribute("role"), live: e.getAttribute("aria-live"),
    atomic: e.getAttribute("aria-atomic"), text: e.textContent, hidden: getComputedStyle(e).position === "absolute" && e.getBoundingClientRect().width <= 1 })).catch(() => null);
  ok("a polite, atomic live region, visually hidden", region?.role === "status" && region.live === "polite" && region.atomic === "true" && region.hidden, JSON.stringify(region));
  ok("...and EMPTY on first load: the log as it stands is not read out", region?.text === "", JSON.stringify(region));
  ok("six tabs, in the Match Centre's order", (await v.page.locator('[role="tab"]').allInnerTexts()).join("|") === "Summary|Scorecard|Commentary|Partnerships|Analytics|Match details");
  let body = await text(v.page);
  ok("Summary: nothing the rule forbids", leaks(body).length === 0, leaks(body).join(","));
  if (SHOTS) await v.page.screenshot({ path: `${SHOTS}/public-live-summary.png`, fullPage: true });

  group("2. Names by the rule, tab by tab");
  await tab(v.page, "scorecard");
  await tid(v.page, "mc-innings-0").click({ timeout: 3000 }).catch(() => {});
  await v.page.waitForTimeout(300);
  const rows = await v.page.locator('[data-testid="mc-bat-row"]').allInnerTexts();
  const names = rows.map((r) => r.split("\n")[0].replace("*", "").trim());
  ok("the scorecard names D Erasmus and L Botha", names.includes(EXPECTED.erasmus) && names.includes(EXPECTED.botha), names.join(" | "));
  ok("...and the marked, the unconsented and the U-age-group boy are each 'Batter'", names.filter((x) => x === "Batter").length === 3, names.join(" | "));
  ok("the retired boy reads 'retired, not out' — never 'hurt'", rows.some((r) => /retired, not out/.test(r)) && !rows.some((r) => /hurt/i.test(r)));
  const bowlers = await v.page.locator('[data-testid="mc-bowling"] [role="rowheader"]').allInnerTexts();
  ok("Westville's bowlers are 'Bowler' (Westville has not published)", bowlers.length === 2 && bowlers.every((b) => b === "Bowler"), bowlers.join(","));
  ok("nothing opens a player's row or profile", await v.page.locator('[data-testid="mc-bat-open"]').count() === 0);
  if (SHOTS) await v.page.screenshot({ path: `${SHOTS}/public-live-scorecard.png`, fullPage: true });
  body = await text(v.page);
  ok("Scorecard: no full name, no first name, no date, no reason", leaks(body).length === 0, leaks(body).join(","));
  await tab(v.page, "commentary");
  const lines = await v.page.locator('[data-testid="mc-line"]').allInnerTexts();
  ok("Commentary: the generator's lines are there", lines.length > 5, String(lines.length));
  body = await text(v.page);
  ok("...naming D Erasmus, and nobody the rule does not name", /D Erasmus/.test(body) && leaks(body).length === 0, leaks(body).join(","));
  ok("...and never a pseudonym as a name", !/\b[0-9a-f]{12}\b/.test(body));
  await tab(v.page, "partnerships");
  body = await text(v.page);
  ok("Partnerships: pairs by label", await v.page.locator('[data-testid="mc-partnership"]').count() > 0 && leaks(body).length === 0, leaks(body).join(","));
  await tab(v.page, "analytics");
  await v.page.waitForSelector('[data-testid="mc-team-wheel"]', { timeout: 5000 }).catch(() => {});
  ok("Analytics: the side's sectors, not a batter's wheel", await tid(v.page, "mc-team-wheel").count() === 1 && await v.page.locator('[aria-label="Whose shots"]').count() === 0);
  await tab(v.page, "details");
  body = await text(v.page);
  ok("Match details: the ground and the toss, no official, no weather", /Gordon Sherwood Oval/.test(body) && /won the toss/.test(body) && !/Umpire|Scorer|Referee/.test(body));
  const html = await v.page.content();
  ok("the whole DOM, attributes and all, leaks nothing", leaks(html, [], false).length === 0, leaks(html, [], false).join(","));
  // Its own origin: the shell, the bundle and /api/public/ — and the app's
  // font sheet, as every SCRBRD page asks for (no credentials, no cookie).
  const allowed = (/** @type {string} */ u) => u.startsWith("https://fonts.googleapis.com/") || u.startsWith("https://fonts.gstatic.com/")
    || (u.startsWith(BASE) && /^\/(live|scorecard)\/|^\/public-app\.js$|^\/assets\/|^\/api\/public\//.test(new URL(u).pathname));
  ok("the page asked for nothing but its shell, its bundle and /api/public/", v.requests.every((r) => allowed(r.url)),
     v.requests.map((r) => r.url).filter((u) => !allowed(u)).join(" "));
  ok("...and sent no Authorization header, ever", v.requests.every((r) => r.auth == null));
  ok("no console errors", v.errors.length === 0, v.errors.join(" | "));
  await v.ctx.close();

  group("1. The scorecard, at phone width");
  const s = await visit(`/scorecard/${pub2}`, { width: 390 });
  await s.page.waitForSelector('[data-testid="public-match"]', { timeout: 10000 }).catch(() => {});
  ok("/scorecard/ opens on the Scorecard tab", await tid(s.page, "mc-panel-scorecard").count() === 1);
  ok("it says Result", (await tid(s.page, "mc-status").textContent().catch(() => "")) === "Result");
  const sRows = (await s.page.locator('[data-testid="mc-bat-row"]').allInnerTexts()).map((r) => r.split("\n")[0].replace("*", "").trim());
  ok("D Erasmus and L Botha by name against a side not on SCRBRD", sRows.includes(EXPECTED.erasmus) && sRows.includes(EXPECTED.botha), sRows.join("|"));
  const kBowl = await s.page.locator('[data-testid="mc-bowling"] [role="rowheader"]').allInnerTexts();
  ok("the typed opposition bowler is 'Bowler', never his typed name", kBowl.length === 1 && kBowl[0] === "Bowler", kBowl.join(","));
  ok("nothing wider than the phone", await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  body = await text(s.page);
  ok("the scorecard's text shows no pseudonym, no name, no date", leaks(body).length === 0, leaks(body).join(","));
  body = await s.page.content();
  ok("the scorecard's DOM leaks nothing", leaks(body, [], false).length === 0, leaks(body, [], false).join(","));
  await s.ctx.close();

  group("4. A withdrawal reaches the page on a reload");
  {
    const t0 = Date.now();
    const [w] = await as(REGISTRAR, `select ok, reason from public_name_consent_set($1, false, 'public-names-2026-09', $2)`, [ids.erasmus, fx.guardians.erasmus]);
    ok("the office withdraws Daniel Erasmus's consent", w.ok === true, w.reason);
    const r = await visit(`/scorecard/${pub2}`);
    await r.page.waitForSelector('[data-testid="mc-bat-row"]', { timeout: 10000 }).catch(() => {});
    const after = (await r.page.locator('[data-testid="mc-bat-row"]').allInnerTexts()).map((x) => x.split("\n")[0].replace("*", "").trim());
    ok(`reloaded ${Date.now() - t0} ms later (the finished page's cache holds 60 s): he is 'Batter'`, !after.includes(EXPECTED.erasmus) && after[0] === "Batter", after.join("|"));
    ok("...and L Botha is still named", after.includes(EXPECTED.botha));
    await r.ctx.close();
  }

  group("7. The ball, said: a live region that speaks only what arrives");
  {
    // Read every 5 s (the page's floor), from the API's 5 s live cache.
    const lv = await visit(`/live/${pub}`, { init: `window.__SCRBRD_LIVE_MS__ = 1000;` });
    await lv.page.waitForSelector('[data-testid="public-match"]', { timeout: 10000 }).catch(() => {});
    const said = () => tid(lv.page, "public-announcer").evaluate((/** @type {any} */ e) => e.textContent);
    /** Wait for the region to hold exactly `want`. */
    const heard = async (/** @type {string} */ want, ms = 30000) => {
      try { await lv.page.waitForFunction((/** @type {string} */ w) => document.querySelector('[data-testid="public-announcer"]')?.textContent === w, want, { timeout: ms, polling: 100 }); return true; } catch { return false; }
    };
    /** The region's span, to tell a new announcement from the same words left standing. */
    const mark = () => lv.page.evaluate(() => { /** @type {any} */ (window).__said = document.querySelector('[data-testid="public-announcer"] > span'); });
    const replaced = async (ms = 30000) => {
      try { await lv.page.waitForFunction(() => { const s = document.querySelector('[data-testid="public-announcer"] > span'); return s && s !== /** @type {any} */ (window).__said; }, null, { timeout: ms, polling: 100 }); return true; } catch { return false; }
    };
    const put = async (/** @type {number} */ n, /** @type {any} */ ev) => {
      const last = Number((await q(`select max(seq) as s from ball_event where match_id = $1`, [pub]))[0].s);
      await writeEvents(q, pub, [{ ...ev, innings: 1, id: `pub-said-${n}`, clientTs: Date.now() + n }], last);
    };
    const heardAll = [];
    ok("a fresh load says nothing", (await said()) === "");
    await lv.page.waitForTimeout(6500);
    ok("...and a re-read or two with nothing new says nothing either", (await said()) === "", await said());

    await put(1, ball({ type: BALL_TYPE.RUN, value: 4 }));
    ok("a new four is announced: \"Four runs\"", await heard("Four runs"), await said());
    heardAll.push(await said());
    ok("...and it is the only live region on the page speaking (the moment on the board is drawn, not said again)",
       await lv.page.evaluate(() => document.querySelectorAll('[data-testid="public-match"] [role="status"], [data-testid="public-match"] [aria-live]').length) === 1);

    await mark();
    await put(2, ball({ type: BALL_TYPE.RUN, value: 4 }));
    ok("the same words again are announced again (a new node in the region, not an unchanged one)", await replaced() && (await said()) === "Four runs");

    await put(3, ball({ type: BALL_TYPE.WIDE, value: 0 }));
    ok("a wide: \"Wide\"", await heard("Wide"), await said());
    heardAll.push(await said());

    await put(4, ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }));
    ok("a wicket: \"Wicket — bowled\"", await heard("Wicket — bowled"), await said());
    heardAll.push(await said());

    ok("nothing it said names a boy or shows a pseudonym", heardAll.every((s) => leaks(s).length === 0 && !/Batter|Bowler|Fielder/.test(s)), heardAll.join(" | "));
    ok("no console errors (live region)", lv.errors.length === 0, lv.errors.join(" | "));
    await lv.ctx.close();
  }

  group("5. Not published is not found");
  {
    await as(SARAH, `select * from fixture_publish($1, 'home', false)`, [pub2]);
    const gone = await visit(`/live/${pub2}`);
    const missing = await visit(`/live/${MISSING}`);
    const unseeded = await visit(`/scorecard/77777777-0000-0000-0000-000000000002`);
    const [g, m, u] = await Promise.all([gone, missing, unseeded].map((x) => x.res?.text() ?? ""));
    ok("a withdrawn fixture, a missing one and a never-published one: 404, the same page",
       gone.res?.status() === 404 && missing.res?.status() === 404 && unseeded.res?.status() === 404 && g === m && m === u);
    ok("...which says it is not available, and says noindex", /not available/.test(await text(gone.page)) && /noindex/.test(gone.res?.headers()["x-robots-tag"] ?? ""));
    for (const x of [gone, missing, unseeded]) await x.ctx.close();
  }

  group("6. The rate limit");
  {
    const ctx = await browser.newContext();
    const codes = [];
    for (let i = 0; i < 34; i++) codes.push((await ctx.request.get(`${BASE}/api/public/matches/${pub}`, { headers: { "x-forwarded-for": "10.84.9.9" } })).status());
    const page = await ctx.newPage();
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.84.9.9" });
    const res = await page.goto(`${BASE}/live/${pub}`);
    ok("one address: 200s to the burst, then 429", codes.slice(0, 30).every((c) => c === 200) && codes.slice(30).every((c) => c === 429), codes.join(","));
    ok("...and the page itself answers 429 with Retry-After", res?.status() === 429 && Number(res?.headers()["retry-after"]) >= 1);
    await ctx.close();
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", /** @type {any} */ (e)?.stack ?? e);
} finally {
  await browser.close();
  api.kill();
  await owner.end();
  await app.end();
}
if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\nPUBLIC PAGES (browser): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

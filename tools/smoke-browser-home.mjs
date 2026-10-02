#!/usr/bin/env node
/**
 * The public home page, signed out, in a browser (SCRBRD-142 phases 1 and 2).
 *
 * The API serves everything from one origin, as a single-container
 * deployment does (SERVE_CLIENT=apps/web/dist): / and /privacy (home.html),
 * /app (the app), /live/:id and /api/public/*. Phone width, 390 × 844.
 *
 * Phase 1 — the page:
 *   1. / is the home page: no robots meta and no X-Robots-Tag on it (D4), its
 *      own bundle and never the app's, no service worker, no sign-in, no
 *      Authorization header, no request to /api/read/, /api/matches/ or
 *      /api/auth/; no console errors.
 *   2. Log in lands on /app's login screen; /privacy is the home bundle's.
 *   3. No child's name: no word of any player the seed holds is in the DOM —
 *      a guard that stays true when phases 2 and 3 add data.
 *   4. The analytics switch in the footer writes the device's preference and
 *      starts nothing on the home page; the app's next boot at /app is what
 *      starts the SDK (lib/firebase.js); off again, the app starts nothing.
 *
 * Phase 2 — the strip (db/82):
 *   5. Nothing is listed until the school lists: a published fixture is not
 *      on the page. Listed, its card appears: the schools, live, a link to
 *      /live/:id with rel="nofollow"; no ground's name anywhere in the DOM, no
 *      child's name; the tap lands on /live/:id. Unlisted, it is gone.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-home.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8852);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const GROUND = "ffffffff-0000-0000-0000-000000000001";
const DEBUG = !!process.env.BROWSER_HOME_DEBUG;

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", SESSION_SECRET: "browser-home-secret",
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-home-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1",
         SERVE_CLIENT: "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));
api.stdout.on("data", (d) => { if (DEBUG) process.stdout.write(d); });

const owner = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const q = async (/** @type {string} */ t, /** @type {any[]} */ p = []) => (await owner.query(t, p)).rows;
/** SQL as one person, through the application role, as the API runs it. */
async function as(/** @type {string} */ user, /** @type {string} */ text, /** @type {any[]} */ params = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.device_id', 'browser-home', true)", [user]);
    const r = (await c.query(text, params)).rows;
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

/** The app's entry chunk, which a stranger at / must never fetch. */
const APP_ENTRY = readFileSync("apps/web/dist/index.html", "utf8").match(/src="\/?(assets\/index-[^"]+\.js)"/)?.[1] ?? "(none)";
const FIREBASE = /firebase[a-z]*\.googleapis\.com|firebaseapp\.com|google-analytics\.com|googletagmanager\.com/;

const browser = await chromium.launch({ ...launchOptions() });
let ipN = 0;
/** A fresh visitor at phone width: a context of its own, from an address of its own, signed out. */
async function visitor() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": `10.85.0.${++ipN}` } });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = /** @type {string[]} */ ([]);
  const requests = /** @type {{url: string, auth: string | null}[]} */ ([]);
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  page.on("request", (r) => requests.push({ url: r.url(), auth: r.headers().authorization ?? null }));
  return { ctx, page, errors, requests };
}
const text = (/** @type {any} */ page) => page.$eval("body", (/** @type {any} */ el) => el.innerText);

/** Every word of every player's name the database holds, of four letters or more. */
let NAMES = /** @type {string[]} */ ([]);
const namesIn = (/** @type {string} */ s) => NAMES.filter((w) => new RegExp(`\\b${w}\\b`).test(s));

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const players = await q(`select full_name, surname, known_as from player`);
  NAMES = [...new Set(players.flatMap((p) => [p.full_name, p.surname, p.known_as].filter(Boolean).flatMap((s) => String(s).split(/[\s,()"'-]+/))))]
    .filter((w) => w.length >= 4 && /^[A-Z]/.test(w) && !/^(Hilton|College|Westville|Boys|High|School)$/.test(w));
  const SARAH = (await q(`select id from app_user where email = 'sarah@example.invalid'`))[0].id;

  group("1. / is the home page, and nothing of the app");
  const v = await visitor();
  {
    const res = await v.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await v.page.waitForSelector('[data-testid="home-page"]', { timeout: 8000 }).catch(() => {});
    ok("/ answers 200 with the home page", res?.status() === 200 && (await v.page.locator('[data-testid="home-page"]').count()) === 1);
    ok("...with no robots meta (D4: the front door may be indexed)", (await v.page.locator('meta[name="robots"]').count()) === 0);
    ok("...and no X-Robots-Tag on it", !(await res?.allHeaders())?.["x-robots-tag"]);
    ok("...its own bundle, never the app's entry", v.requests.some((r) => /\/assets\/home-[^/]+\.js$/.test(r.url))
       && !v.requests.some((r) => r.url.endsWith(APP_ENTRY)), APP_ENTRY);
    ok("no Authorization header on any request", v.requests.every((r) => !r.auth), v.requests.filter((r) => r.auth).map((r) => r.url));
    const signedIn = v.requests.filter((r) => /\/api\/(read|matches|auth)\//.test(new URL(r.url).pathname));
    ok("no request to a signed-in read, a match route or sign-in", signedIn.length === 0, signedIn.map((r) => r.url));
    ok("no service worker registered", (await v.page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.() ?? []).length)) === 0);
    ok("no sign-in form on the page", (await v.page.locator("#login-email, input[type=password]").count()) === 0);
    ok("Log in is offered, and goes to /app", (await v.page.locator('[data-testid="home-login"]').getAttribute("href")) === "/app");
  }

  group("2. No child's name");
  ok(`none of the ${NAMES.length} words of the seed's players' names is on the page`, NAMES.length > 20 && namesIn(await text(v.page)).length === 0,
     namesIn(await text(v.page)).join(", "));

  group("3. The analytics switch starts nothing here; the app's next boot does");
  // The console is read up to here: past this point the SDK the app starts
  // on consent reports being offline (third parties are aborted), which is
  // its business, as smoke-browser-read.mjs says of the same thing.
  const homeErrors = [...v.errors];
  {
    const google = /** @type {string[]} */ ([]);
    v.page.on("request", (r) => { if (FIREBASE.test(r.url())) google.push(r.url()); });
    const sw = v.page.locator('[data-testid="analytics-consent"]');
    ok("the switch is in the footer, and off", (await sw.count()) === 1 && (await sw.getAttribute("aria-checked")) === "false");
    await sw.click({ timeout: 4000 }); await v.page.waitForTimeout(1500);
    ok("turned on, it says on", (await sw.getAttribute("aria-checked")) === "true");
    ok("...and the home page made no Firebase or Google request", google.length === 0, google.slice(0, 3).join(" | "));
    await v.page.goto(`${BASE}/app`, { waitUntil: "networkidle" }); await v.page.waitForTimeout(2000);
    ok("the app at /app, on the device that said yes, starts the SDK", google.length > 0, "no Firebase request at /app after consent");
    await v.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await v.page.locator('[data-testid="analytics-consent"]').click({ timeout: 4000 }); await v.page.waitForTimeout(500);
    const before = google.length;
    await v.page.goto(`${BASE}/app`, { waitUntil: "networkidle" }); await v.page.waitForTimeout(1500);
    ok("off again, the app's next boot starts nothing", google.length === before, google.slice(before, before + 3).join(" | "));
  }

  group("4. Log in lands on /app's login; /privacy is the home bundle's");
  {
    const w = await visitor();
    await w.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await w.page.locator('[data-testid="home-login"]').click({ timeout: 4000 });
    await w.page.waitForURL(/\/app$/, { timeout: 6000 }).catch(() => {});
    await w.page.waitForSelector("#login-email", { timeout: 8000 }).catch(() => {});
    ok("Log in lands on /app", new URL(w.page.url()).pathname === "/app", w.page.url());
    ok("...on the login screen", (await w.page.locator("#login-email").count()) === 1);
    const p = await w.page.goto(`${BASE}/privacy`, { waitUntil: "networkidle" });
    ok("/privacy answers with the home page's bundle", p?.status() === 200 && (await w.page.locator('[data-testid="home-page"]').count()) === 1
       && !(await w.page.locator("#login-email").count()));
    ok("...and names no child", namesIn(await text(w.page)).length === 0, namesIn(await text(w.page)).join(", "));
    ok("no console errors on /, /app or /privacy", homeErrors.length === 0 && w.errors.length === 0, [...homeErrors, ...w.errors].join(" | "));
    await w.ctx.close();
  }
  await v.ctx.close();

  group("5. The strip: a listed school's published fixture, team facts only (db/82)");
  {
    const [{ id: today }] = await q(
      `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, ground_id, starts_at, sport, format, overs, status)
       values ($1, '1XI', $2, '1XI', 'Westville Boys'' High 1XI', $3,
               (sa_today()::timestamp + interval '12 hours') at time zone 'Africa/Johannesburg', 'cricket', 'T20', 20, 'live')
       returning id`, [HIL, WES, GROUND]);
    const [{ name: groundName }] = await q(`select name from ground where id = $1`, [GROUND]);
    await as(SARAH, `select * from fixture_publish($1, 'home', true)`, [today]);
    const card = (/** @type {any} */ page) => page.locator(`a[data-testid="home-card"][href="/live/${today}"]`);
    /** Reload until the card is (or is not) there: a change made by SQL reaches the cache by LISTEN, asynchronously. */
    const settle = async (/** @type {any} */ page, /** @type {boolean} */ want) => {
      for (let i = 0; i < 30; i++) {
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);
        if (((await card(page).count()) > 0) === want) return true;
        await page.waitForTimeout(400);
      }
      return false;
    };
    const s = await visitor();
    ok("published and not listed: no card (findable by link only)", await settle(s.page, false));
    await as(SARAH, `select * from public_listing_set($1, true)`, [HIL]);
    ok("Hilton lists: the card appears", await settle(s.page, true));
    const c = card(s.page).first();
    const words = await c.innerText().catch(() => "");
    ok("...naming both schools and LIVE", /Hilton College/.test(words) && /Westville Boys' High/.test(words) && /LIVE/.test(words), words);
    ok("...its link says nofollow", /\bnofollow\b/.test((await c.getAttribute("rel")) ?? ""), await c.getAttribute("rel"));
    const all = await text(s.page);
    ok("no ground's name anywhere on the page (D3)", !all.includes(groundName) && !/Sherwood|Westville Main/.test(all));
    ok("...and no child's name", namesIn(all).length === 0, namesIn(all).join(", "));
    ok("Follow a match is offered with a card on the page", (await s.page.locator('[data-testid="home-cta-follow"]').count()) === 1);
    await c.click({ timeout: 4000 });
    await s.page.waitForURL(new RegExp(`/live/${today}$`), { timeout: 6000 }).catch(() => {});
    ok("the tap lands on /live/:id", new URL(s.page.url()).pathname === `/live/${today}`, s.page.url());
    await as(SARAH, `select * from public_listing_set($1, false)`, [HIL]);
    ok("Hilton stops listing: the card is gone", await settle(s.page, false));
    ok("no console errors through the strip", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
    await as(SARAH, `select * from fixture_publish($1, 'home', false)`, [today]);
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
console.log(`\nHOME PAGE (browser): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

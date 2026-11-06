#!/usr/bin/env node
/**
 * The public home page, signed out, in a browser (SCRBRD-142 phases 1–3).
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
 * The cinematic page (2026-10):
 *   4b. The hero's heading is whole and visible in the first screen at 390;
 *      the film's canvas is drawn and scrolling plays it to the last shot;
 *      no horizontal scroll at 390 through the film and after it; no text
 *      under 12px and nothing tapped under 44px; with reduced motion the film
 *      is five drawn stills with their captions, every section visible and
 *      at rest, nothing animating.
 *
 * Phase 2 — the strip (db/82):
 *   5. Nothing is listed until the school lists: a published fixture is not
 *      on the page. Listed, its card appears: the schools, live, a link to
 *      /live/:id with rel="nofollow"; no ground's name anywhere in the DOM, no
 *      child's name; the tap lands on /live/:id. Unlisted, it is gone.
 *
 * Phase 3 — the news (db/83):
 *   6. A coach's post, asked for and approved by the director of sport with
 *      Hilton listing, appears: its school and side, its words, no author,
 *      read signed out. A post naming a pupil is refused at approval with a
 *      count and no name, and is not on the page; the DOM still holds no
 *      seed name. Taken down by the office, it is gone (within 60 s: the
 *      LISTEN notification, or the cache's TTL).
 *
 * The newsfeed as news (6 Nov 2026, Kameel: covers, headlines, a full read):
 *   8. Seeded posts read as a feed: the newest is the lead story, the rest
 *      under Today, This week and Earlier; every card has a decorative cover
 *      (aria-hidden), its kicker, a real heading, a standfirst and Read more
 *      on a 44px target. Another's post is New until opened, and stays opened
 *      after a reload (this browser only). Read more opens the whole post at
 *      #read-<id> with its byline (no email); back closes it. The chips
 *      narrow to the school's posts. A follower who reads the school but not
 *      the side sees the school's posts and none of the side's, and a link
 *      to the side's post shows him nothing of it. No horizontal scroll at
 *      390. With NEWS_SHOTS=<dir>, screenshots of the feed, a full read, an
 *      empty feed and the home page's news are written there.
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
import { afterReads, watchReads } from "./walk-wait.mjs";

const PORT = port(8852);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const COACH2 = "88888888-0000-0000-0000-00000000000a";   // the 2XI coach: news.publish.team at Hilton
/** @type {string} */
let NAMED;
const DEBUG = !!process.env.BROWSER_HOME_DEBUG;

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  // ALLOW_DEV_LOGIN: §7 signs the coach and the director of sport in at /app.
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", SESSION_SECRET: "browser-home-secret",
         ALLOW_DEV_LOGIN: "1",
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
  watchReads(page);
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
  // A Hilton pupil's full name, for the post the scan must refuse (§6).
  NAMED = (await q(`select full_name from player where school_id = $1 and full_name ~ '^[A-Z][a-z]+ [A-Z][a-z]+$' order by id limit 1`, [HIL]))[0]?.full_name ?? "James Whitfield";

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
  // The seed has 11 players, which make 12 words here (db/98); a database
  // other walks have added to has more. At least 10, so the list is never
  // empty by accident.
  ok(`none of the ${NAMES.length} words of the seed's players' names is on the page`, NAMES.length >= 10 && namesIn(await text(v.page)).length === 0,
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
    await sw.click({ timeout: 4000 }); await afterReads(v.page, 1500);
    ok("turned on, it says on", (await sw.getAttribute("aria-checked")) === "true");
    ok("...and the home page made no Firebase or Google request", google.length === 0, google.slice(0, 3).join(" | "));
    await v.page.goto(`${BASE}/app`, { waitUntil: "networkidle" }); await afterReads(v.page, 2000);
    ok("the app at /app, on the device that said yes, starts the SDK", google.length > 0, "no Firebase request at /app after consent");
    await v.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await v.page.locator('[data-testid="analytics-consent"]').click({ timeout: 4000 }); await v.page.waitForTimeout(500);
    const before = google.length;
    await v.page.goto(`${BASE}/app`, { waitUntil: "networkidle" }); await afterReads(v.page, 1500);
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

  group("4b. The film, the floors, and reduced motion (the cinematic page, 2026-10)");
  {
    /** Is the page wider than the screen? */
    const wide = (/** @type {any} */ page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    /** A cheap fingerprint of what a canvas shows, and whether it shows anything. */
    const ink = (/** @type {any} */ page, /** @type {string} */ sel) => page.$$eval(sel, (/** @type {HTMLCanvasElement[]} */ cs) => cs.map((c) => {
      const x = c.getContext("2d"); if (!x || !c.width || !c.height) return { inked: false, sum: 0 };
      const d = x.getImageData(0, 0, c.width, c.height).data; let sum = 0, inked = 0;
      for (let i = 0; i < d.length; i += 4 * 97) { sum = (sum + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7 + d[i + 3]) % 1e9; if (d[i + 3] > 0) inked++; }
      return { inked: inked > 50, sum };
    }));
    /** Text under 12px, and anything tapped under 44px, among what is drawn on the page. */
    const floors = (/** @type {any} */ page) => page.evaluate(() => {
      const small = [], tiny = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const el = n.parentElement; if (!el || !n.nodeValue?.trim() || el.closest("svg, style, script, .sr-only")) continue;
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        if (cs.display === "none" || cs.visibility === "hidden" || r.width < 1 || r.height < 1) continue;
        if (parseFloat(cs.fontSize) < 12) small.push(`${cs.fontSize} "${n.nodeValue.trim().slice(0, 24)}"`);
      }
      for (const el of document.querySelectorAll("a[href], button, [role=switch]")) {
        if (el.closest("[aria-hidden=true]")) continue;
        const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
        if (r.width < 44 || r.height < 44) tiny.push(`${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent ?? "").trim().slice(0, 24)}"`);
      }
      return { small, tiny };
    });

    const f = await visitor();
    await f.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await f.page.waitForTimeout(600);
    const h1 = await f.page.evaluate(() => {
      const el = document.querySelector("h1"); if (!el) return null;
      const r = el.getBoundingClientRect();
      let o = 1; for (let e = /** @type {Element | null} */ (el); e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return { top: r.top, bottom: r.bottom, h: innerHeight, o, text: el.textContent };
    });
    ok("the hero's heading is real text, whole and visible in the first screen at 390 × 844",
       !!h1 && h1.top >= 0 && h1.bottom <= h1.h && h1.o > 0.99 && /School cricket, scored live/.test(h1.text ?? ""), JSON.stringify(h1));
    ok("...and the film's stage is drawn: the canvas has ink", (await ink(f.page, ".film-canvas"))[0]?.inked === true);
    const before = (await ink(f.page, ".film-canvas"))[0]?.sum;
    const film = await f.page.evaluate(() => { const r = /** @type {HTMLElement} */ (document.getElementById("home-film")).getBoundingClientRect(); return { top: r.top + scrollY, h: r.height, vh: innerHeight }; });
    let overflow = await wide(f.page);
    for (const s of [0.5, 1.2, 2.0, 3.0, 4.0, 4.9]) {
      await f.page.evaluate((/** @type {number} */ y) => window.scrollTo({ top: y, behavior: "instant" }), film.top + s * film.vh);
      await f.page.waitForTimeout(700);
      overflow = overflow || await wide(f.page);
    }
    const shot = await f.page.evaluate(() => document.getElementById("home-film")?.dataset.shot);
    ok("scrolling plays the film: five screens on, the last shot, and a different frame", shot === "5" && (await ink(f.page, ".film-canvas"))[0]?.sum !== before, `shot ${shot}`);
    const total = await f.page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = film.top + film.h - film.vh; y < total; y += film.vh * 0.6) {
      await f.page.evaluate((/** @type {number} */ yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
      await f.page.waitForTimeout(120);
      overflow = overflow || await wide(f.page);
    }
    ok("no horizontal scroll at 390 px, through the film and the page after it", !overflow);
    const fl = await floors(f.page);
    ok("no text under 12px anywhere on the page", fl.small.length === 0, fl.small.slice(0, 4).join(" · "));
    ok("nothing tapped under 44px", fl.tiny.length === 0, fl.tiny.slice(0, 4).join(" · "));
    ok("Skip the film lands on what follows it", await f.page.evaluate(() => {
      const a = document.querySelector('[data-testid="home-skip-film"]');
      return !!a && !!document.getElementById((a.getAttribute("href") ?? "").slice(1));
    }));
    ok("the film names no child", namesIn(await text(f.page)).length === 0, namesIn(await text(f.page)).join(", "));
    ok("no console errors through the film", f.errors.length === 0, f.errors.join(" | "));
    await f.ctx.close();

    // Reduced motion: the storyboard, everything visible, nothing moving.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": `10.85.0.${++ipN}` } });
    await offline(ctx);
    const page = await ctx.newPage();
    watchReads(page);
    const errors = /** @type {string[]} */ ([]);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await afterReads(page, 800);
    const still = await page.evaluate(() => {
      const hidden = [];
      for (const el of document.querySelectorAll("main section, main li, main article, main figure, main h1, main h2, main p")) {
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        if (cs.display === "none") continue;
        if (Number(cs.opacity) < 1 || cs.transform !== "none" || cs.visibility === "hidden" || r.height < 1) hidden.push(`${el.tagName.toLowerCase()}#${el.id || el.className || ""}: ${cs.opacity} ${cs.transform}`);
      }
      return {
        hidden,
        stage: getComputedStyle(/** @type {Element} */ (document.querySelector(".film-stage"))).display,
        frames: document.querySelectorAll(".film-shots .film-still").length,
        moving: document.getAnimations().filter((a) => a.playState === "running").length,
      };
    });
    ok("reduced motion: every section, card and caption visible, at rest, none moved", still.hidden.length === 0, still.hidden.slice(0, 4).join(" · "));
    ok("...the film is not played: no stage, and nothing animating", still.stage === "none" && still.moving === 0, `${still.stage}, ${still.moving} running`);
    const frames = await ink(page, ".film-shots .film-still");
    ok("...five stills instead, each drawn, each with its caption", still.frames === 5 && frames.length === 5 && frames.every((x) => x.inked)
       && (await page.locator(".film-shots .film-cap h2").count()) === 5, JSON.stringify(frames.map((x) => x.inked)));
    ok("...and no horizontal scroll", !(await wide(page)));
    ok("no console errors with reduced motion", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  group("5. The strip: a listed school's published fixture, team facts only (db/82)");
  {
    // At a ground of its own, not the seed's Oval: noon today on a shared
    // ground clashes (db/133, one ground at a time) with any fixture another
    // writer put there relative to the clock, at some hour of the day.
    const [{ id: ground, name: groundName }] = await q(
      `insert into ground (school_id, name, surface) values ($1, 'Sherwood Strip Ground', 'grass') returning id, name`, [HIL]);
    const [{ id: today }] = await q(
      `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, ground_id, starts_at, sport, format, overs, status)
       values ($1, '1XI', $2, '1XI', 'Westville Boys'' High 1XI', $3,
               (sa_today()::timestamp + interval '12 hours') at time zone 'Africa/Johannesburg', 'cricket', 'T20', 20, 'live')
       returning id`, [HIL, WES, ground]);
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

  group("6. News: an approved post appears, a withdrawn one goes (db/83)");
  {
    const TITLE = "Second XI through to the final";
    // The coach posts and asks; the director of sport — not the author —
    // approves; Hilton lists. Each as that person, through the application
    // role, as the API's doors run them.
    const [{ id: post }] = await as(COACH2,
      `insert into news_post (scope, school_id, team_code, title, body, published_at)
       values ('team', $1, '2XI', $2, 'The side won by six wickets on Saturday. Teas in the pavilion after the game.', now())
       returning id`, [HIL, TITLE]);
    const [asked] = await as(COACH2, `select * from news_public_request($1)`, [post]);
    ok("the coach asks for his post", asked?.ok === true, asked?.reason);
    // A post naming a pupil cannot get there: refused with a count, no name.
    const [{ id: named }] = await as(COACH2,
      `insert into news_post (scope, school_id, team_code, title, body, published_at)
       values ('team', $1, '2XI', 'A hundred', $2, now()) returning id`, [HIL, `Well batted, ${NAMED}.`]);
    await as(COACH2, `select * from news_public_request($1)`, [named]);
    const [refused] = await as(SARAH, `select * from news_public_approve($1)`, [named]);
    ok("a post naming a pupil is refused: names_pupils, a count, no name", refused?.ok === false && refused?.reason === "names_pupils"
       && refused?.names >= 1 && !JSON.stringify(refused).includes(NAMED.split(" ").pop() ?? "?"), JSON.stringify(refused));
    const [approved] = await as(SARAH, `select * from news_public_approve($1)`, [post]);
    ok("the director of sport approves the coach's post", approved?.ok === true, approved?.reason);
    await as(SARAH, `select * from public_listing_set($1, true)`, [HIL]);

    const item = (/** @type {any} */ page) => page.locator('[data-testid="home-news-post"]', { hasText: TITLE });
    /** Reload until the post is (or is not) there: a change made by SQL reaches the cache by LISTEN. */
    const settle = async (/** @type {any} */ page, /** @type {boolean} */ want) => {
      for (let i = 0; i < 30; i++) {
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);
        if (((await item(page).count()) > 0) === want) return true;
        await page.waitForTimeout(400);
      }
      return false;
    };
    const s = await visitor();
    ok("approved and listed: the post is on the home page", await settle(s.page, true));
    const words = await item(s.page).first().innerText().catch(() => "");
    ok("...with its school and side, and its words", /Hilton College 2XI/.test(words) && /six wickets/.test(words), words);
    const all = await text(s.page);
    ok("...no author on the page", !/Coach|author/i.test(words), words);
    ok("the page still names no child — and not the refused post's", namesIn(all).length === 0 && !all.includes("A hundred"),
       namesIn(all).join(", "));
    const news = s.requests.filter((r) => new URL(r.url).pathname === "/api/public/news");
    ok("the news is read signed out, with no Authorization header", news.length > 0 && news.every((r) => !r.auth));
    await as(SARAH, `select * from news_public_withdraw($1)`, [post]);
    ok("the director of sport takes it down: gone from the home page", await settle(s.page, false));
    ok("no console errors through the news", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
    await as(SARAH, `select * from public_listing_set($1, false)`, [HIL]);
  }

  group("7. The newsfeed's doors, signed in: the coach asks, the office approves and takes it down");
  {
    const TITLE = "Under-15s win the festival";
    const [{ id: post }] = await as(COACH2,
      `insert into news_post (scope, school_id, team_code, title, body, published_at)
       values ('team', $1, '2XI', $2, 'Three wins from three at the weekend festival.', now()) returning id`, [HIL, TITLE]);
    await as(SARAH, `select * from public_listing_set($1, true)`, [HIL]);
    try {
    /** Signed in at /app as `email`, on the newsfeed, desktop width. */
    const member = async (/** @type {string} */ email) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.85.1.${++ipN}` } });
      await offline(ctx);
      const page = await ctx.newPage();
      watchReads(page);
      const errors = /** @type {string[]} */ ([]);
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
      // The app finds its server as every signed-in walk tells it (lib/api.js).
      await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)};`);
      await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
      await page.locator("#login-email").fill(email, { timeout: 8000 });
      await page.locator("button", { hasText: /^Sign In$/ }).first().click({ timeout: 4000 });
      await page.waitForFunction(() => /Match Centre|Dashboard/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
      await page.locator("nav button", { hasText: /Newsfeed/ }).first().click({ timeout: 6000 }).catch(() => {});
      await page.waitForSelector('[data-testid="news-list"]', { timeout: 10000 }).catch(() => {});
      if (DEBUG) console.log(email, page.url(), (await text(page)).slice(0, 1500));
      return { ctx, page, errors };
    };
    const row = (/** @type {any} */ page) => page.locator(`[data-testid="news-public-${post}"]`);

    const coach = await member("coach2@example.invalid");
    // The composer (NOTIFICATIONS.md D9, D11, S2): who reads a post and what
    // never goes in it, said above the words; and "Send to phones too", off.
    await coach.page.locator('[data-testid="news-compose"]').click({ timeout: 6000 }).catch(() => {});
    const readers = await coach.page.locator('[data-testid="news-compose-readers"]').innerText({ timeout: 6000 }).catch(() => "");
    ok("the composer says who reads a post, and what never goes in one",
       /Everyone on the side reads this, pupils and parents too\./.test(readers) && /health, home or discipline/.test(readers), readers);
    const phones = coach.page.locator('[data-testid="news-compose-phones"]');
    ok("...and offers \"Send to phones too\", off until ticked",
       (await phones.count()) === 1 && (await phones.isChecked().catch(() => true)) === false
       && /Send to phones too/.test(await coach.page.locator('[data-testid="news-compose-phones-row"]').innerText().catch(() => "")));
    const tick = await coach.page.locator('[data-testid="news-compose-phones-row"]').boundingBox().catch(() => null);
    ok("...on a target 44px tall", !!tick && tick.height >= 44, JSON.stringify(tick));
    await coach.page.keyboard.press("Escape").catch(() => {});
    await coach.page.locator('[data-testid="news-compose-readers"]').waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
    ok("the coach's own post carries the line: not asked", /not asked/.test(await row(coach.page).innerText({ timeout: 8000 }).catch(() => "")));
    await coach.page.locator(`[data-testid="news-public-request-${post}"]`).click({ timeout: 4000 });
    ok("he asks: waiting for the office", await coach.page.waitForFunction((id) =>
      /waiting for the office/.test(document.querySelector(`[data-testid="news-public-${id}"]`)?.textContent ?? ""), post, { timeout: 8000 })
      .then(() => true, () => false));
    ok("...and has no approvals card: it is not his to approve", (await coach.page.locator('[data-testid="news-approvals"]').count()) === 0);

    const office = await member("sarah@example.invalid");
    const card = office.page.locator(`[data-testid="news-approve-${post}"]`);
    ok("the director of sport has it in her approvals card, with the attestation",
       (await card.count().catch(() => 0)) === 1 && /no pupil's name, no photo/.test(await office.page.locator('[data-testid="news-approvals"]').innerText().catch(() => "")));
    await office.page.locator(`[data-testid="news-approve-yes-${post}"]`).click({ timeout: 4000 });
    ok("she approves: the card empties and the post says it is on the home page", await office.page.waitForFunction((id) =>
      !document.querySelector(`[data-testid="news-approve-${id}"]`)
      && /on the home page/.test(document.querySelector(`[data-testid="news-public-${id}"]`)?.textContent ?? ""), post, { timeout: 8000 })
      .then(() => true, () => false));

    const s = await visitor();
    const item = s.page.locator('[data-testid="home-news-post"]', { hasText: TITLE });
    await s.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    ok("a stranger at / sees it at once (the route dropped the cache)", (await item.count()) === 1);
    await office.page.locator(`[data-testid="news-public-withdraw-${post}"]`).click({ timeout: 4000 });
    ok("she takes it down: the post says withdrawn", await office.page.waitForFunction((id) =>
      /withdrawn/.test(document.querySelector(`[data-testid="news-public-${id}"]`)?.textContent ?? ""), post, { timeout: 8000 })
      .then(() => true, () => false));
    await s.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    ok("...and the stranger's next visit does not carry it", (await item.count()) === 0);
    ok("the home page still names no child", namesIn(await text(s.page)).length === 0, namesIn(await text(s.page)).join(", "));
    ok("no console errors on the newsfeed or the home page", [...coach.errors, ...office.errors, ...s.errors].length === 0,
       [...coach.errors, ...office.errors, ...s.errors].join(" | "));
    await coach.ctx.close(); await office.ctx.close(); await s.ctx.close();
    } finally {
      // Left as found, so a rerun's §5 starts unlisted.
      await as(SARAH, `select * from public_listing_set($1, false)`, [HIL]);
    }
  }

  group("8. The newsfeed as news: covers, the lead story, the full read, and a reader who may not see a post");
  {
    const SHOTS = process.env.NEWS_SHOTS || "";
    const shot = async (/** @type {any} */ page, /** @type {string} */ name, /** @type {any} */ opts = {}) => {
      if (!SHOTS) return;
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }).catch((/** @type {any} */ e) => console.log("  (screenshot failed)", name, e?.message));
    };
    // Invented posts, written as the people who may write them, dated across
    // a fortnight on the SA clock so the feed has Today, This week and Earlier.
    const post = async (/** @type {string} */ who, /** @type {string} */ scope, /** @type {string | null} */ team, /** @type {string} */ title, /** @type {string} */ body, /** @type {string} */ ago) => {
      const [{ id }] = await as(who,
        `insert into news_post (scope, school_id, team_code, title, body, published_at)
         values ($1, $2, $3, $4, $5, now() - $6::interval) returning id`, [scope, HIL, team, title, body, ago]);
      return /** @type {string} */ (id);
    };
    const FINAL = await post(COACH2, "team", "2XI", "Second XI book their place in the KZN schools final",
      "A composed chase under lights at the Oval took the Second XI through to the provincial final, with six wickets and nine balls to spare.\n\nThe bowlers set it up early: three wickets in the powerplay and only two boundaries conceded in the last five overs. The fielding was the best it has been all season.\n\nThe final is on Saturday 14 November at 10:00. Whites, the travelling kit and a packed lunch; the bus leaves the pavilion at 07:30.", "0 seconds");
    const NETS = await post(SARAH, "school", null, "Nets move to the Oval from Monday",
      "The indoor centre is being resurfaced, so every side's nets move to the outdoor lanes at the Oval from Monday 9 November for three weeks.\n\nTimes are unchanged. Bring water and a cap; the lanes have no shade until four o'clock.", "3 hours");
    const TUES = await post(COACH2, "team", "2XI", "Training moves to Tuesday this week",
      "Because of the exam timetable, Thursday's practice moves to Tuesday at 15:00. Fielding first, then middle practice.", "1 day");
    const DINNER = await post(SARAH, "school", null, "Cricket dinner: tickets on sale",
      "The end-of-season cricket dinner is in the dining hall on Friday 27 November at 18:30. Tickets are R180 from the sports office until the 20th; families of every side are welcome.", "4 days");
    const KIT = await post(COACH2, "team", "2XI", "Kit back before the holidays",
      "Please return the side's playing shirts and the two spare helmets to the kit room by the last day of term.", "12 days");
    const UMPIRE = await post(SARAH, "school", null, "An umpiring course for parents",
      "The provincial association runs a two-evening Level 1 umpiring course in the pavilion. It is free for the school's families, and every side needs two more umpires next season.", "20 days");
    const SCHOOL_POSTS = [NETS, DINNER, UMPIRE], SIDE_POSTS = [FINAL, TUES, KIT];

    /** Signed in at /app as `email` on the newsfeed, at this width. */
    const reader = async (/** @type {string} */ email, /** @type {{width: number, height: number}} */ viewport) => {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, extraHTTPHeaders: { "x-forwarded-for": `10.85.2.${++ipN}` } });
      await offline(ctx);
      const page = await ctx.newPage();
      watchReads(page);
      const errors = /** @type {string[]} */ ([]);
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
      await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)};`);
      await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
      await page.locator("#login-email").fill(email, { timeout: 8000 });
      await page.locator("button", { hasText: /^Sign In$/ }).first().click({ timeout: 4000 });
      await page.waitForFunction(() => /Match Centre|Dashboard|Newsfeed/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
      return { ctx, page, errors };
    };
    const toFeed = async (/** @type {any} */ page) => {
      const bar = page.locator('[data-testid="nav-news"]:visible, [data-testid="mnav-news"]:visible').first();
      if (await bar.count()) await bar.click({ timeout: 6000 }).catch(() => {});
      else {
        await page.locator('[data-testid="mnav-more"]').click({ timeout: 5000 }).catch(() => {});
        await page.locator('[data-testid="drawer-news"]').click({ timeout: 5000 }).catch(() => {});
      }
      await page.waitForSelector('[data-testid="news-list"], [data-testid="news-empty"]', { timeout: 10000 }).catch(() => {});
      await afterReads(page).catch(() => {});
    };
    /**
     * The floors inside `sel` (smoke-a11y's rules, which never opens the
     * newsfeed): visible text 12px or more, outside drawings and what is
     * hidden from assistive technology; every button and link 44px tall and
     * named. Returns what broke them.
     */
    const feedFloors = (/** @type {any} */ page, /** @type {string} */ sel) => page.evaluate((s) => {
      const out = [];
      for (const root of document.querySelectorAll(s)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement;
          if (!el || !n.nodeValue?.trim() || el.closest("svg, .sr-only, [aria-hidden=true]")) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 12) out.push(`${size}px "${n.nodeValue.trim().slice(0, 30)}"`);
        }
        for (const c of root.querySelectorAll("button, a[href]")) {
          if (c.closest("[aria-hidden=true]")) continue;
          const r = c.getBoundingClientRect();
          if (Math.round(r.height) < 44) out.push(`${r.height.toFixed(2)}px tall: ${(c.textContent ?? "").trim().slice(0, 30)}`);
          if (!(c.getAttribute("aria-label") || c.textContent || "").trim()) out.push("a control with no name");
        }
      }
      return out;
    }, sel);
    const isNew = (/** @type {any} */ page, /** @type {string} */ id) => page.locator(`[data-testid="news-${id}"]`).getAttribute("data-new").then((v) => v === "true", () => null);

    const coach = await reader("coach2@example.invalid", { width: 1440, height: 900 });
    try {
      await toFeed(coach.page);
      const ids = await coach.page.$$eval('[data-testid="news-list"] article[data-testid^="news-"]', (els) => els.map((e) => e.getAttribute("data-testid")?.slice(5)));
      ok("the newest post is the lead story, a real heading over its standfirst", ids[0] === FINAL
         && (await coach.page.locator(`[data-testid="news-${FINAL}"] h3`).innerText().catch(() => "")) === "Second XI book their place in the KZN schools final", ids.slice(0, 3).join());
      ok("...and every seeded post is on the feed", [...SCHOOL_POSTS, ...SIDE_POSTS].every((id) => ids.includes(id)), ids.join());
      const covers = await coach.page.$$eval('[data-testid="news-list"] article', (els) => els.map((a) => {
        const c = a.querySelector(".os-news-cover");
        return !!c && c.getAttribute("aria-hidden") === "true" && !!c.querySelector("svg") && !c.querySelector("img, a, button");
      }));
      ok("every card has a cover: drawn, decorative, no image and no control in it", covers.length >= 6 && covers.every(Boolean), covers.join());
      const kicker = await coach.page.locator(`[data-testid="news-${TUES}"] [data-testid="news-kicker"]`).innerText().catch(() => "");
      ok("a side's kicker names the side and the school", /2nd XI · Hilton College/i.test(kicker), kicker);
      ok("...a school post's says Whole school", /Whole school · Hilton College/i.test(await coach.page.locator(`[data-testid="news-${NETS}"] [data-testid="news-kicker"]`).innerText().catch(() => "")));
      ok("the rest are under Today, This week and Earlier", (await coach.page.locator('[data-testid="news-band-today"]').count()) === 1
         && (await coach.page.locator('[data-testid="news-band-week"]').count()) === 1 && (await coach.page.locator('[data-testid="news-band-earlier"]').count()) === 1);
      const bylines = await coach.page.$$eval('[data-testid="news-byline"]', (els) => els.map((e) => e.textContent ?? ""));
      ok("bylines name a desk and an SA date, never an email", bylines.length >= 6 && bylines.every((b) => !b.includes("@") && /staff|organisers|office/.test(b)) && bylines.some((b) => /Today, \d\d:\d\d/.test(b)), bylines.slice(0, 3).join(" | "));
      const opens = await coach.page.$$eval('[data-testid^="news-open-"]', (els) => els.map((e) => e.getBoundingClientRect().height));
      ok("Read more is on a 44px target on every card", opens.length >= 6 && opens.every((h) => Math.round(h) >= 44), opens.join());
      ok("the office's posts are New to the coach; his own are not", (await isNew(coach.page, NETS)) === true && (await isNew(coach.page, FINAL)) === false);
      const floors = await feedFloors(coach.page, '[data-testid="news-list"], [data-testid="news-chips"]');
      ok("the feed keeps the floors: no text under 12px, nothing tapped under 44px, every control named", floors.length === 0, floors.slice(0, 4).join(" | "));
      // Reduced motion: the cards arrive without moving.
      await coach.page.emulateMedia({ reducedMotion: "reduce" });
      const still = await coach.page.$$eval(".os-news-in", (els) => els.every((e) => getComputedStyle(e).animationName === "none"));
      await coach.page.emulateMedia({ reducedMotion: "no-preference" });
      const moving = await coach.page.$$eval(".os-news-in", (els) => els.some((e) => getComputedStyle(e).animationName === "newsIn"));
      ok("the cards rise in, and not at all with reduced motion", still && moving);
      await shot(coach.page, "feed-desktop-1440", { fullPage: false });

      await coach.page.locator(`[data-testid="news-open-${NETS}"]`).click({ timeout: 4000 });
      await coach.page.waitForSelector('[data-testid="news-read"]', { timeout: 6000 }).catch(() => {});
      const head = await coach.page.locator("#news-read-h").innerText().catch(() => "");
      const body = await coach.page.locator('[data-testid="news-read-body"]').innerText().catch(() => "");
      ok("Read more opens the whole post: its headline, every paragraph, at #read-<id>",
         head === "Nets move to the Oval from Monday" && /Bring water and a cap/.test(body) && new URL(coach.page.url()).hash === `#read-${NETS}`, `${head} | ${coach.page.url()}`);
      ok("...with a back button on a 44px target", ((await coach.page.locator('[data-testid="news-read-back"]').boundingBox().catch(() => null))?.height ?? 0) >= 43.5, "the layout rounds 44 to 43.9999 at a scale of 2");
      const readFloors = await feedFloors(coach.page, '[data-testid="news-read"]');
      ok("...and the full read keeps the floors too", readFloors.length === 0, readFloors.slice(0, 4).join(" | "));
      ok("...its headline is the one h2 in it, and its cover is decorative",
         (await coach.page.locator('[data-testid="news-read"] h2').count()) === 1 && (await coach.page.locator('[data-testid="news-read"] .os-news-cover:not([aria-hidden="true"])').count()) === 0 && (await coach.page.locator('[data-testid="news-read"] .os-news-cover').count()) >= 1);
      await coach.page.goBack();
      await coach.page.waitForSelector('[data-testid="news-list"]', { timeout: 6000 }).catch(() => {});
      ok("the browser's back closes it, and the post is no longer New", (await coach.page.locator('[data-testid="news-read"]').count()) === 0 && (await isNew(coach.page, NETS)) === false);
      // Away and back: the feed is drawn afresh and reads the mark from this browser's storage.
      await coach.page.locator('[data-testid="nav-dashboard"]:visible, [data-testid="nav-matches"]:visible').first().click({ timeout: 4000 }).catch(() => {});
      await coach.page.waitForSelector('[data-testid="news-list"]', { state: "detached", timeout: 6000 }).catch(() => {});
      await toFeed(coach.page);
      const kept = await coach.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("scrbrd.news.opened.v1:")).map((k) => localStorage.getItem(k)).join(""));
      ok("...and stays opened when the feed is drawn again, kept in this browser alone",
         (await isNew(coach.page, NETS)) === false && (await isNew(coach.page, DINNER)) === true && kept.includes(NETS), kept);

      await coach.page.locator('[data-testid="news-chip-school"]').click({ timeout: 4000 });
      const shown = await coach.page.$$eval('[data-testid="news-list"] article[data-testid^="news-"]', (els) => els.map((e) => e.getAttribute("data-testid")?.slice(5)));
      const schoolWide = (await q(`select id::text from news_post where scope = 'school' and school_id = $1 and published_at is not null`, [HIL])).map((r) => r.id);
      ok("the Whole school chip narrows to the school's posts", shown.length === schoolWide.length && shown.every((id) => schoolWide.includes(id))
         && SCHOOL_POSTS.every((id) => shown.includes(id)) && SIDE_POSTS.every((id) => !shown.includes(id)), shown.join());
      await coach.page.locator('[data-testid="news-chip-all"]').click({ timeout: 4000 }).catch(() => {});
      ok("no console errors on the feed or the full read", coach.errors.length === 0, coach.errors.join(" | "));
    } finally { await coach.ctx.close(); }

    // The phone: the feed, and a full read.
    const phone = await reader("coach2@example.invalid", { width: 390, height: 844 });
    try {
      await toFeed(phone.page);
      ok("at 390 the feed has no horizontal scroll, and no card runs past the screen", await phone.page.evaluate(() => document.documentElement.scrollWidth <= 391
         && [...document.querySelectorAll('[data-testid="news-list"] article, [data-testid="news-list"] article p, [data-testid="news-list"] article h3, [data-testid="news-list"] article h4')]
              .every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1)));
      await shot(phone.page, "feed-phone-390");
      await phone.page.locator(`[data-testid="news-open-${FINAL}"]`).click({ timeout: 4000 });
      await phone.page.waitForSelector('[data-testid="news-read"]', { timeout: 6000 }).catch(() => {});
      ok("...nor does the full read", await phone.page.evaluate(() => document.documentElement.scrollWidth <= 391
         && [...document.querySelectorAll('[data-testid="news-read"] p, [data-testid="news-read"] h2')].every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1)));
      await shot(phone.page, "read-phone-390");
      await shot(phone.page, "read-phone-390-full", { fullPage: true });
      ok("no console errors on the phone", phone.errors.length === 0, phone.errors.join(" | "));
    } finally { await phone.ctx.close(); }

    // A follower reads the school's news and not the side's (db/101).
    const fan = await reader("spectator@example.invalid", { width: 1280, height: 900 });
    try {
      await toFeed(fan.page);
      const ids = await fan.page.$$eval('[data-testid="news-list"] article[data-testid^="news-"]', (els) => els.map((e) => e.getAttribute("data-testid")?.slice(5)));
      const all = await text(fan.page);
      ok("a follower sees the school's posts", SCHOOL_POSTS.every((id) => ids.includes(id)), ids.join());
      ok("...and none of the side's, in the cards or anywhere on the page",
         SIDE_POSTS.every((id) => !ids.includes(id)) && !/KZN schools final|Training moves to Tuesday|Kit back before/.test(all), ids.join());
      await fan.page.evaluate((id) => { window.location.hash = `read-${id}`; }, FINAL);
      await fan.page.waitForSelector('[data-testid="news-read-missing"]', { timeout: 6000 }).catch(() => {});
      const missing = await text(fan.page);
      ok("a link to the side's post shows him that it is not in his feed, and nothing of it",
         (await fan.page.locator('[data-testid="news-read-missing"]').count()) === 1 && !/KZN schools final|composed chase/.test(missing), missing.slice(0, 300));
      ok("no console errors for the follower", fan.errors.length === 0, fan.errors.join(" | "));
    } finally { await fan.ctx.close(); }

    // An empty feed: Westville has posted nothing, and the seed's one league
    // post is held back as a draft for the length of this check.
    const LEAGUE_POSTS = (await q(`select id, published_at from news_post where scope = 'competition' and published_at is not null`));
    for (const r of LEAGUE_POSTS) await q(`update news_post set published_at = null where id = $1`, [r.id]);
    const quiet = await reader("coach.wes@example.invalid", { width: 390, height: 844 });
    try {
      await toFeed(quiet.page);
      ok("a school with nothing posted shows the empty state, and offers the first post to a publisher",
         (await quiet.page.locator('[data-testid="news-empty"]').count()) === 1 && (await quiet.page.locator('[data-testid="news-empty-compose"]').count()) === 1);
      await shot(quiet.page, "empty-phone-390");
    } finally {
      await quiet.ctx.close();
      for (const r of LEAGUE_POSTS) await q(`update news_post set published_at = $2 where id = $1`, [r.id, r.published_at]);
    }

    // The home page's news, as the same cards: posts asked for and approved.
    {
      // The coach asks; the director of sport, not the author, approves (db/83).
      for (const id of [FINAL, TUES, KIT]) { await as(COACH2, `select * from news_public_request($1)`, [id]); await as(SARAH, `select * from news_public_approve($1)`, [id]); }
      await as(SARAH, `select * from public_listing_set($1, true)`, [HIL]);
      try {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, extraHTTPHeaders: { "x-forwarded-for": `10.85.3.${++ipN}` } });
        await offline(ctx);
        const page = await ctx.newPage();
        for (let i = 0; i < 20; i++) {
          await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
          if ((await page.locator('[data-testid="home-news-post"]').count()) >= 3) break;
          await page.waitForTimeout(500);
        }
        await page.locator("#home-news").scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(900);
        if (SHOTS) await page.locator("#home-news").screenshot({ path: `${SHOTS}/home-news-1440.png` }).catch((/** @type {any} */ e) => console.log("  (screenshot failed)", e?.message));
        const newsText = await page.locator("#home-news").innerText().catch(() => "");
        ok("the home page's news carries the approved posts as cards, and no author", (await page.locator('[data-testid="home-news-post"]').count()) >= 2
           && /KZN schools final/.test(newsText) && !/staff|Coach|author|@/.test(newsText), newsText.slice(0, 300));
        await ctx.close();
      } finally {
        await as(SARAH, `select * from public_listing_set($1, false)`, [HIL]);
      }
    }
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

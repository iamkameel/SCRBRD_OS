#!/usr/bin/env node
/**
 * The first run, slice 3a (EXPERIENCE_PASS §2.2–§2.8, Q6, Q13; decided
 * as recommended on 13 Nov 2026), in a real browser against the real server,
 * signed out at 390 × 844 and then through sign-in.
 *
 * One origin, as a single-container deployment serves it (SERVE_CLIENT): /
 * is the home page, /app the app, /live/:id the public match page. The client
 * is the walk's own build (tools/web-test-build.mjs), and the walk answers the
 * Google popup with an ID token it signed for the project scrbrd-os-test, as
 * tools/smoke-browser-signup.mjs does.
 *
 *   1. THE HOME PAGE IN EACH STATE OF §2.3, from the public read alone:
 *      nothing listed, the film first (its heading whole in the first screen);
 *      a listed LIVE fixture, its board first, above the film, with the
 *      status sentence and Watch, whole in the first screen, the film still
 *      under it, and one tap on the board opens /live/:id; fixtures listed
 *      today and none live, Today and the first start first; only a result,
 *      the result first. In every state: team facts only, no child's name, no
 *      sideways scroll, nothing under 12px, nothing tapped under 44px. The
 *      three doors: Watch a match (with the strip), Score a match, My child
 *      plays; Log in stays in the header.
 *   2. ONE DOOR. A new Google account, from "My child plays": the sign-in
 *      screen has no role-tile door; Google lands on the no-school home, and
 *      nobody asks "what's your role?". The home is in the day sheet's order
 *      (Start a match, Join a school, Your requests, Worried about a child?),
 *      the empty requests section says what will show there, the join form
 *      opens with "parent or guardian" chosen, and the door's hint leaves the
 *      address. The account holds nothing.
 *   3. A COACH ON THE REGISTER. The office lists a coach; he signs in with
 *      Google, chooses the school and "I work at the school", is told he is
 *      listed, and Open the school lands him on Today with no second sign-in.
 *   4. A SPECTATOR FOLLOWS FROM A MATCH LINK (slice 3b, Q8, §2.4). The live
 *      fixture's public page offers nothing while the first innings is in
 *      play; at the innings break it offers "Follow Hilton College's
 *      matches", a plain link. One Google sign-in later the new account lands
 *      on the no-school home, its Followed schools block first because the
 *      school is live, saying he follows it; one tap opens the match. His
 *      list is Hilton alone, and Stop following empties it.
 *   5. THE SENTENCE WITH A TARGET (Q14, db/159). The chase begins: the public
 *      read carries the target, and the home page's live board says "need 8
 *      off 5"; the follower's Today says the same from the same read.
 *   6. A FOLLOWER WHO BELONGS TO A SCHOOL. The coach of step 3 follows Hilton,
 *      signs in, and Today leads with its live board, above the day sheet.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-browser-first-run.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { buildWebForWalk, WEB_TEST_ROOT } from "./web-test-build.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createSign } from "node:crypto";
import pg from "pg";
import { appUrl, ownerUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";
import { writeEvents } from "./fixture-matchcentre.mjs";
import { ball, inningsStart, BALL_TYPE } from "@scrbrd/scoring";

const PORT = port(9025);
const BASE = `http://127.0.0.1:${PORT}`;
const PHONE = { width: 390, height: 844 };
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const PROJECT = "scrbrd-os-test";
const RUN = Date.now().toString(36);

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);

// ── The walk's own "Google" ──
const dir = await mkdtemp(join(tmpdir(), "scrbrd-first-run-"));
const keyFile = join(dir, "keys.json");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
await writeFile(keyFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "walk-1", alg: "RS256", use: "sig" }] }));
const b64 = (s) => Buffer.from(s).toString("base64url");
const idToken = (uid, email, name = "First Run") => {
  const t = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, email, email_verified: true, name,
    iat: t - 5, exp: t + 3600, auth_time: t - 5, firebase: { sign_in_provider: "google.com" } };
  const input = `${b64(JSON.stringify({ alg: "RS256", kid: "walk-1", typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
  const s = createSign("RSA-SHA256"); s.update(input);
  return `${input}.${s.sign(privateKey).toString("base64url")}`;
};

const built = buildWebForWalk();
ok("the walk's own build (test hook, dummy web config for scrbrd-os-test) is made", built.ok, built.out);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "browser-first-run-secret", FIREBASE_TEST_KEYS: keyFile,
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-first-run-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1",
         SERVE_CLIENT: WEB_TEST_ROOT },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

const owner = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const q = async (t, p = []) => (await owner.query(t, p)).rows;
/** SQL as one person, through the application role, as the API runs it. */
async function as(user, sql, params = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.device_id', 'browser-first-run', true)", [user]);
    const r = (await c.query(sql, params)).rows;
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const browser = await chromium.launch({ ...launchOptions() });
let ipN = 0;
/** A fresh visitor at phone width, from an address of its own, with the walk's Google wired in. */
async function visitor(opts = {}) {
  const ctx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": `10.86.0.${++ipN}` }, ...opts });
  await offline(ctx);
  const h = { ctx, next: null, errors: [], requests: [] };
  await ctx.exposeFunction("__walkGoogle", () => (h.next ? { idToken: h.next, email: JSON.parse(Buffer.from(h.next.split(".")[1], "base64url").toString()).email } : null));
  const page = await ctx.newPage();
  watchReads(page);
  h.page = page;
  page.on("pageerror", (e) => h.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) h.errors.push(m.text()); });
  page.on("request", (r) => h.requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)}; window.__SCRBRD_TEST_GOOGLE__ = () => window.__walkGoogle();`);
  return h;
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const text = (page) => page.$eval("body", (el) => el.innerText);
async function google(h, token, wait = 2500) {
  h.next = token;
  await h.page.waitForSelector('[data-testid="google-button"]', { timeout: 10000 }).catch(() => {});
  await tid(h.page, "google-button").click({ timeout: 5000 });
  await h.page.waitForTimeout(wait);
  await afterReads(h.page, 800);
}
/** The page's floors: no text under 12px, nothing tapped under 44px (decorative and hidden left out). */
const floors = (page) => page.evaluate(() => {
  const small = [], tiny = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement; if (!el || el.closest("[aria-hidden=true]")) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.display === "none" || cs.visibility === "hidden" || r.width < 1 || r.height < 1) continue;
    if (parseFloat(cs.fontSize) < 12) small.push(`${cs.fontSize} "${n.nodeValue.trim().slice(0, 24)}"`);
  }
  for (const el of document.querySelectorAll("a[href], button, select, input:not([type=checkbox]):not([type=radio])")) {
    if (el.closest("[aria-hidden=true]")) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    if (r.height < 43.5) tiny.push(`${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent ?? "").trim().slice(0, 24)}"`);
  }
  return { small, tiny };
});
const wide = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const top = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, vh: innerHeight }; }, sel);

/** Every word of every player's name the database holds, of four letters or more. */
let NAMES = [];
const namesIn = (s) => NAMES.filter((w) => new RegExp(`\\b${w}\\b`).test(s));

const made = { matches: [], grounds: [] };
try {
  for (let i = 0; i < 80; i++) {
    try { const r = await call("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const players = await q(`select full_name, surname, known_as from player`);
  NAMES = [...new Set(players.flatMap((p) => [p.full_name, p.surname, p.known_as].filter(Boolean).flatMap((s) => String(s).split(/[\s,()"'-]+/))))]
    .filter((w) => w.length >= 4 && /^[A-Z]/.test(w) && !/^(Hilton|College|Westville|Boys|High|School)$/.test(w));
  const SARAH = (await q(`select id from app_user where email = 'sarah@example.invalid'`))[0].id;

  // Three fixtures today, at grounds of their own (db/133: one ground at a time):
  // one live, one to start this afternoon, one finished this morning. Each is
  // published only for the state under test, with Hilton listing.
  const fixture = async (status, hour) => {
    const [{ id: ground }] = await q(`insert into ground (school_id, name, surface) values ($1, $2, 'grass') returning id`, [HIL, `First Run Ground ${status} ${RUN}`]);
    made.grounds.push(ground);
    const [{ id }] = await q(
      `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, ground_id, starts_at, sport, format, overs, status)
       values ($1, '1XI', $2, '1XI', 'Westville Boys'' High 1XI', $3,
               (sa_today()::timestamp + make_interval(hours => $4::int)) at time zone 'Africa/Johannesburg', 'cricket', 'T20', 20, $5)
       returning id`, [HIL, WES, ground, hour, status]);
    made.matches.push(id);
    return id;
  };
  const LIVE = await fixture("live", 11);
  const LATER = await fixture("scheduled", 15);
  const DONE = await fixture("complete", 8);
  const publish = async (ids) => { for (const m of made.matches) await as(SARAH, `select * from fixture_publish($1, 'home', $2)`, [m, ids.includes(m)]); };
  /** The public read, until it says `want` (a change by SQL reaches the cache by LISTEN, asynchronously). */
  const readUntil = async (want) => {
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${BASE}/api/public/live`, { headers: { "x-forwarded-for": "10.86.1.1" } }).then((x) => x.json()).catch(() => null);
      const ids = (r?.fixtures ?? []).map((f) => f.id).sort().join();
      if (ids === [...want].sort().join()) return true;
      await new Promise((res) => setTimeout(res, 500));
    }
    return false;
  };
  await publish([]);
  await as(SARAH, `select * from public_listing_set($1, true)`, [HIL]);

  /** One state of the home page, signed out at 390. */
  const home = async (label, state) => {
    const v = await visitor();
    // The lead is chosen once per visit, from the first read if it answers within main.jsx's
    // LEAD_WAIT_MS; a read slower than that leaves the film first for the visit, by design. A loaded
    // test machine sometimes answers late, so a visit that settled otherwise is tried again, up to five times.
    let first = "";
    for (let i = 0; i < 5 && first !== state; i++) {
      await v.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await v.page.waitForFunction(() => document.querySelector("main")?.dataset.first !== "wait", null, { timeout: 8000 }).catch(() => {});
      await afterReads(v.page, 500);
      first = await v.page.evaluate(() => document.querySelector("main")?.dataset.first ?? "");
    }
    ok(`${label}: the page knows its state from the public read ("${state}")`, first === state, first);
    return v;
  };
  const common = async (v, label) => {
    const all = await text(v.page);
    ok(`${label}: no child's name on the page`, namesIn(all).length === 0, namesIn(all).join(", "));
    ok(`${label}: no ground's name (team facts only)`, !/First Run Ground/.test(all));
    ok(`${label}: no sideways scroll at 390`, !(await wide(v.page)));
    const fl = await floors(v.page);
    ok(`${label}: nothing under 12px, nothing tapped under 44px`, fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].slice(0, 4).join(" · "));
    ok(`${label}: Log in stays in the header`, (await tid(v.page, "home-login").getAttribute("href")) === "/app");
    ok(`${label}: Score a match and My child plays are doors to the app`,
       (await tid(v.page, "home-cta-score").getAttribute("href")) === "/app" && (await tid(v.page, "home-cta-child").getAttribute("href")) === "/app?door=parent");
    ok(`${label}: no page errors`, v.errors.length === 0, v.errors.join(" | "));
  };

  // ── 1 · The home page, state by state ──────────────────────────
  group("1a. Nothing listed: the film first, as before");
  {
    ok("(setup) the public read lists nothing", await readUntil([]));
    const v = await home("nothing listed", "film");
    const h1 = await v.page.evaluate(() => { const r = document.querySelector("h1").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, t: document.querySelector("h1").textContent }; });
    ok("the hero's heading is whole in the first screen", h1.top >= 0 && h1.bottom <= h1.h && /School cricket, scored live/.test(h1.t), JSON.stringify(h1));
    ok("...and no board stands above the film", await v.page.evaluate(() => !document.querySelector("section[data-lead]")));
    ok("the quiet line follows the film: 'No matches listed today'", (await tid(v.page, "home-no-matches").count()) === 1);
    ok("Watch a match leads to the strip", (await tid(v.page, "home-cta-watch").getAttribute("href")) === "#matches");
    await common(v, "nothing listed");
    await v.ctx.close();
  }

  group("1b. A listed fixture is live: its board and sentence are the first screen, one tap opens it");
  {
    await publish([LIVE]);
    ok("(setup) the public read lists the live fixture", await readUntil([LIVE]));
    const v = await home("live", "live");
    const board = await top(v.page, "#matches");
    const film = await top(v.page, "#home-film");
    ok("the live board stands above the film", !!board && !!film && board.top < film.top, JSON.stringify({ board, film }));
    const card = tid(v.page, "home-card").first();
    const box = await card.boundingBox();
    ok("...its card is whole in the first screen at 390 × 844", !!box && box.y >= 0 && box.y + box.height <= 844, JSON.stringify(box));
    const words = await card.innerText().catch(() => "");
    ok("...naming both schools and LIVE", /Hilton College/.test(words) && /Westville Boys' High/.test(words) && /LIVE/.test(words), words);
    const said = await tid(v.page, "home-card-sentence").first().innerText().catch(() => "");
    const sBox = await tid(v.page, "home-card-sentence").first().boundingBox();
    ok("...with its status sentence, in the first screen", said.length > 0 && !!sBox && sBox.y + sBox.height <= 844, said);
    ok("...a sentence of team facts: no target is worked out in the browser while the read carries none", !/need|target|chasing/i.test(said), said);
    ok("...and Watch", /Watch/.test(await tid(v.page, "home-card-watch").first().innerText().catch(() => "")));
    ok("the board is drawn at once, not held for the scroll reveal", await v.page.evaluate(() => {
      const s = document.querySelector("section[data-lead]"); return !!s && !s.classList.contains("rv") && Number(getComputedStyle(s).opacity) > 0.99;
    }));
    ok("the film still plays under it", (await v.page.locator("#home-film").count()) === 1 && (await v.page.locator(".film-canvas").count()) === 1);
    ok("the card's link is nofollow, to the match page", /\bnofollow\b/.test((await card.getAttribute("rel")) ?? "") && (await card.getAttribute("href")) === `/live/${LIVE}`);
    ok("Watch a match leads to the live board", (await tid(v.page, "home-cta-watch").getAttribute("href")) === "#matches");
    await common(v, "live");

    // The lead is chosen once per visit: two polls later, with a new fixture
    // listed meanwhile, nothing above the reader has moved.
    const before = { film: (await top(v.page, "#home-film"))?.top, first: await v.page.evaluate(() => document.querySelector("main")?.dataset.first) };
    await publish([LIVE, LATER]);
    ok("(setup) the public read now lists a second fixture as well", await readUntil([LIVE, LATER]));
    const seen = { polls: 0 };
    v.page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/public/live") seen.polls++; });
    for (let i = 0; i < 90 && seen.polls < 2; i++) await v.page.waitForTimeout(500);
    await afterReads(v.page, 800);
    const after = { film: (await top(v.page, "#home-film"))?.top, first: await v.page.evaluate(() => document.querySelector("main")?.dataset.first) };
    ok("two polls later the lead is the same, and the film has not moved", seen.polls >= 2 && after.first === "live" && Math.abs((after.film ?? 0) - (before.film ?? -99)) < 1,
       JSON.stringify({ polls: seen.polls, before, after }));
    const laterTop = await v.page.evaluate((id) => { const a = document.querySelector(`a[data-testid="home-card"][href="/live/${id}"]`); return a ? a.getBoundingClientRect().top + scrollY : null; }, LATER);
    ok("...the new fixture is drawn below the film, not above it", laterTop !== null && laterTop > (after.film ?? Infinity), String(laterTop));
    ok("...and the live card still leads", await v.page.evaluate((id) => !!document.querySelector(`section[data-lead] a[href="/live/${id}"]`), LIVE));
    await card.click({ timeout: 5000 });
    await v.page.waitForURL(new RegExp(`/live/${LIVE}$`), { timeout: 8000 }).catch(() => {});
    ok("one tap on the board opens the match", new URL(v.page.url()).pathname === `/live/${LIVE}`, v.page.url());
    await v.page.waitForSelector('[data-testid="public-match"]', { timeout: 8000 }).catch(() => {});
    ok("...its public page", (await tid(v.page, "public-match").count()) === 1);
    await v.ctx.close();
  }

  group("1c. Fixtures today, none live: Today and the first start lead");
  {
    await publish([LATER, DONE]);
    ok("(setup) the public read lists a start and a result", await readUntil([LATER, DONE]));
    const v = await home("today", "today");
    const board = await top(v.page, "#matches");
    const film = await top(v.page, "#home-film");
    ok("Today stands above the film", !!board && !!film && board.top < film.top, JSON.stringify({ board, film }));
    const first = await tid(v.page, "home-card").first();
    ok("...its first card is the start, with its time", (await first.getAttribute("data-status")) === "scheduled" && /\b15:00\b/.test(await first.innerText()), await first.innerText());
    const box = await first.boundingBox();
    ok("...whole in the first screen", !!box && box.y + box.height <= 844, JSON.stringify(box));
    ok("no live board is drawn", (await tid(v.page, "home-card-sentence").count()) === 0);
    await common(v, "today");
    await v.ctx.close();
  }

  group("1d. Only a result today: the result leads");
  {
    await publish([DONE]);
    ok("(setup) the public read lists the result only", await readUntil([DONE]));
    const v = await home("result", "result");
    const board = await top(v.page, "#matches");
    const film = await top(v.page, "#home-film");
    ok("the result stands above the film", !!board && !!film && board.top < film.top, JSON.stringify({ board, film }));
    const first = tid(v.page, "home-card").first();
    ok("...as a RESULT card to the scorecard", (await first.getAttribute("data-status")) === "complete" && /RESULT/.test(await first.innerText()) && (await first.getAttribute("href")) === `/scorecard/${DONE}`);
    await common(v, "result");
    await v.ctx.close();
  }
  await publish([]);

  // ── 2 · One door: a new Google account ─────────────────────────
  group("2. My child plays: a new Google account lands on the no-school home, and nobody asks its role");
  const NEW_UID = `walk-firstrun-${RUN}`, NEW_EMAIL = `walk.firstrun.${RUN}@example.invalid`;
  {
    const h = await visitor();
    const P = h.page;
    await P.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await tid(P, "home-cta-child").click({ timeout: 5000 });
    await P.waitForURL(/\/app\?door=parent$/, { timeout: 8000 }).catch(() => {});
    await P.waitForSelector("#login-email", { timeout: 10000 }).catch(() => {});
    await P.waitForSelector('[data-testid="google-button"]', { timeout: 10000 }).catch(() => {});
    ok("the door opens the app's sign-in", /\/app/.test(new URL(P.url()).pathname) && (await P.locator("#login-email").count()) === 1, P.url());
    ok("the sign-in screen has one door: Google or a code, no role-tile sign-up",
       (await tid(P, "google-button").count()) === 1 && (await P.locator("button", { hasText: /Create an account/ }).count()) === 0
       && /Continue with Google/.test(await tid(P, "login-new-here").innerText().catch(() => "")));
    await google(h, idToken(NEW_UID, NEW_EMAIL, "Walk Parent"));
    await P.waitForSelector('[data-testid="join-school"]', { timeout: 10000 }).catch(() => {});
    ok("it lands on the no-school home, with no shell", (await tid(P, "no-school-title").count()) === 1 && (await tid(P, "os-main").count()) === 0, (await text(P)).slice(0, 200));
    ok("...and nobody asks \"what's your role?\"", !/what.s your role|tailor the platform to your role/i.test(await text(P)));
    ok("...in the day sheet's order: Start a match, Join a school, Your requests, Worried about a child?", await P.evaluate(() => {
      const y = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? NaN;
      return y("start-match") < y("join-school") && y("join-school") < y("no-school-requests") && y("no-school-requests") < y("no-school-help");
    }));
    ok("the empty requests section says what will show there", /A request you send to a school shows here/.test(await tid(P, "no-school-requests-none").innerText().catch(() => "")));
    ok("the door's hint has left the address", !new URL(P.url()).search.includes("door="), P.url());
    if (await tid(P, `join-school-${HIL}`).count()) await tid(P, `join-school-${HIL}`).click();
    ok("the join form opens as a parent: 'I am a parent or guardian' is chosen, and its free-text form shows",
       (await tid(P, "join-kind-parent").getAttribute("aria-pressed")) === "true" && (await tid(P, "join-form-parent").count()) === 1);
    ok("...with the health note, separate and off", /separate, and off/.test(await tid(P, "join-health-note").innerText().catch(() => "")));

    const fl = await floors(P);
    ok("the no-school home: nothing under 12px, nothing tapped under 44px", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].slice(0, 4).join(" · "));
    ok("...and no sideways scroll at 390", !(await wide(P)));
    const mine = await call("/api/auth/firebase", { method: "POST", body: { idToken: idToken(NEW_UID, NEW_EMAIL, "Walk Parent"), deviceId: "device-first-run" } });
    const s = await call("/api/session", { token: mine.body?.token });
    ok("the account holds nothing: no school, no child, no role", Array.isArray(s.body?.assignments) && s.body.assignments.length === 0, s.body);
    ok("no request was ever made to the retired sign-up's route", !h.requests.some((r) => r === "POST /api/onboard"), h.requests.filter((r) => /onboard/.test(r)));
    ok("no page errors", h.errors.length === 0, h.errors.join(" | "));
    await h.ctx.close();
  }

  // ── 3 · A coach on the register ─────────────────────────────────
  group("3. A coach on the school's register signs in with Google and reaches Today");
  const COACH_UID = `walk-firstrun-coach-${RUN}`, COACH_EMAIL = `walk.firstrun.coach.${RUN}@example.invalid`;
  {
    const office = (await call("/api/auth/dev-login", { method: "POST", body: { email: "registrar@example.invalid", deviceId: "device-first-run-office" } })).body?.token;
    const listed = await call(`/api/register/${HIL}`, { method: "POST", token: office,
      body: { csv: ["name,email,role,team_code,valid_until", `Walk Coach,${COACH_EMAIL},coach,U14A,`].join("\n"), commit: true } });
    ok("(setup) the office lists the coach on the staff register", listed.status === 200 && listed.body?.committed === true, listed.body);
    const h = await visitor();
    const P = h.page;
    await P.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    await google(h, idToken(COACH_UID, COACH_EMAIL, "Walk Coach"));
    await P.waitForSelector('[data-testid="join-school"]', { timeout: 10000 }).catch(() => {});
    ok("he lands on the no-school home first, asked no role", (await tid(P, "no-school-title").count()) === 1 && !/what.s your role/i.test(await text(P)));
    if (await tid(P, `join-school-${HIL}`).count()) await tid(P, `join-school-${HIL}`).click();
    await tid(P, "join-kind-staff").click({ timeout: 4000 });
    await P.waitForSelector('[data-testid="join-claimed"]', { timeout: 10000 }).catch(() => {});
    ok("the register is checked: he is told he is listed, and asked for no request",
       /^You're in\. The office listed you as /.test((await tid(P, "join-claimed").innerText().catch(() => "")).replace(/\s+/g, " ").trim())
       && (await tid(P, "join-send").count()) === 0, await tid(P, "join-claimed").innerText().catch(() => ""));
    await tid(P, "join-claimed-continue").click({ timeout: 4000 });
    await P.waitForSelector('[data-testid="os-main"]', { timeout: 12000 }).catch(() => {});
    await afterReads(P, 1200);
    ok("Open the school lands him on Today, with no second sign-in",
       (await tid(P, "os-main").count()) === 1 && (await tid(P, "os-main").getAttribute("data-page")) === "dashboard",
       await tid(P, "os-main").getAttribute("data-page").catch(() => "(no shell)"));
    const s = await call("/api/session", { token: (await call("/api/auth/firebase", { method: "POST", body: { idToken: idToken(COACH_UID, COACH_EMAIL, "Walk Coach"), deviceId: "device-first-run-2" } })).body?.token });
    ok("...holding what the register listed, and nothing else: coach, U14A, at Hilton",
       (s.body?.assignments ?? []).length === 1 && s.body.assignments[0].role === "coach", s.body?.assignments);
    ok("no page errors", h.errors.length === 0, h.errors.join(" | "));
    await h.ctx.close();
  }

  // ── 4 · A spectator follows Hilton from a match link ────────────
  group("4. A spectator follows Hilton from a match link: offered at the break, one sign-in, his home led by the live board");
  const FAN_UID = `walk-firstrun-fan-${RUN}`, FAN_EMAIL = `walk.firstrun.fan.${RUN}@example.invalid`;
  const OPP = "Westville Boys' High 1XI";
  let n = 0;
  const t0 = Date.now() - 20 * 60000;
  const at = (/** @type {number} */ inn, /** @type {any} */ ev) => ({ ...ev, innings: inn, id: `first-run-${RUN}-${++n}`, clientTs: t0 + n * 30000 });
  // A one-over match, so a short log reaches the break and the chase.
  await q(`update match set overs = 1 where id = $1`, [LIVE]);
  await writeEvents(q, LIVE, [
    at(0, inningsStart({ battingTeam: "1XI", bowlingTeam: OPP, teamKey: "1XI", bowlingTeamKey: OPP, overs: 1 })),
    at(0, ball({ type: BALL_TYPE.RUN, value: 4 })), at(0, ball({ type: BALL_TYPE.RUN, value: 4 })), at(0, ball({ type: BALL_TYPE.RUN, value: 0 }))]);
  await publish([LIVE]);
  ok("(setup) the public read lists the live fixture", await readUntil([LIVE]));
  {
    const h = await visitor();
    const P = h.page;
    await P.goto(`${BASE}/live/${LIVE}`, { waitUntil: "networkidle" });
    await P.waitForSelector('[data-testid="public-match"]', { timeout: 10000 }).catch(() => {});
    await afterReads(P, 800);
    ok("the match link opens its public page", (await tid(P, "public-match").count()) === 1);
    ok("...and while the first innings is in play nothing is offered", (await tid(P, "follow-offer").count()) === 0);
    await writeEvents(q, LIVE, [at(0, ball({ type: BALL_TYPE.RUN, value: 0 })), at(0, ball({ type: BALL_TYPE.RUN, value: 0 })), at(0, ball({ type: BALL_TYPE.RUN, value: 0 }))], 4);
    await P.reload({ waitUntil: "networkidle" });
    await P.waitForSelector('[data-testid="follow-offer"]', { timeout: 10000 }).catch(() => {});
    const offer = tid(P, "follow-offer-HIL");
    ok("at the innings break: \"Follow Hilton College's matches\"", /Follow Hilton College's matches/.test(await offer.innerText().catch(() => "")), await text(P).then((t) => t.slice(0, 300)));
    ok("...a plain link to the app, nofollow, offered for the side that published alone",
       (await offer.getAttribute("href")) === "/app?follow=HIL" && /\bnofollow\b/.test((await offer.getAttribute("rel")) ?? "") && (await tid(P, "follow-offer-WES").count()) === 0);
    ok("...an offer, never a wall: the board and the tabs are all there", (await tid(P, "mc-panel-summary").count()) === 1 && (await P.locator("[data-testid=follow-offer] form, [data-testid=follow-offer] input").count()) === 0);
    const fl = await floors(P);
    ok("the page with the offer: nothing under 12px, nothing tapped under 44px", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].slice(0, 4).join(" · "));
    ok("...no child's name", namesIn(await text(P)).length === 0, namesIn(await text(P)).join(", "));
    await offer.click({ timeout: 5000 });
    await P.waitForURL(/\/app\?follow=HIL$/, { timeout: 8000 }).catch(() => {});
    ok("Follow leads to the one sign-in", (await P.locator('[data-testid="google-button"]').count()) === 1 || !!(await P.waitForSelector('[data-testid="google-button"]', { timeout: 8000 }).catch(() => null)), P.url());
    ok("...with the privacy paragraph on the same screen", (await tid(P, "google-notice").count()) === 1);
    await google(h, idToken(FAN_UID, FAN_EMAIL, "Walk Fan"));
    await P.waitForSelector('[data-testid="followed-card"]', { timeout: 12000 }).catch(() => {});
    ok("he lands on the no-school home, asked no role", (await tid(P, "no-school-title").count()) === 1 && !/what.s your role/i.test(await text(P)));
    ok("...told he follows Hilton College", /You follow Hilton College/.test(await tid(P, "followed-note").innerText().catch(() => "")));
    ok("...Followed schools first, above Start a match, because Hilton is live", await P.evaluate(() => {
      const y = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? NaN;
      return document.querySelector('[data-testid="followed-schools"]')?.hasAttribute("data-lead") && y("followed-schools") < y("start-match");
    }));
    const card = tid(P, "followed-card").first();
    ok("...led by the live board, team facts and its sentence", (await card.getAttribute("data-status")) === "live"
       && /LIVE/.test(await card.innerText()) && /Hilton College 1XI 8\/0 after 1 over/.test(await card.innerText()), await card.innerText().catch(() => ""));
    ok("...and the follow hint has left the address", !new URL(P.url()).search.includes("follow="), P.url());
    const fl2 = await floors(P);
    ok("the follower's home: nothing under 12px, nothing tapped under 44px, no sideways scroll", fl2.small.length === 0 && fl2.tiny.length === 0 && !(await wide(P)),
       [...fl2.small, ...fl2.tiny].slice(0, 4).join(" · "));
    ok("...no child's name, no ground", namesIn(await text(P)).length === 0 && !/First Run Ground/.test(await text(P)));
    const fan = (await call("/api/auth/firebase", { method: "POST", body: { idToken: idToken(FAN_UID, FAN_EMAIL, "Walk Fan"), deviceId: "device-first-run-fan" } })).body?.token;
    const list = await call("/api/follows", { token: fan });
    ok("his list is Hilton alone, and he holds no role", JSON.stringify((list.body?.schools ?? []).map((x) => x.code)) === '["HIL"]'
       && ((await call("/api/session", { token: fan })).body?.assignments ?? [1]).length === 0, list.body);
    const today = await call("/api/follows/today", { token: fan });
    ok("...his Today is the public read kept to Hilton: the live fixture, nothing unpublished", JSON.stringify((today.body?.fixtures ?? []).map((f) => f.id)) === JSON.stringify([LIVE]), today.body);
    ok("...and nobody else reads his list: another account's is empty",
       ((await call("/api/follows", { token: (await call("/api/auth/firebase", { method: "POST", body: { idToken: idToken(NEW_UID, NEW_EMAIL, "Walk Parent"), deviceId: "device-first-run-3" } })).body?.token })).body?.schools ?? [1]).length === 0);
    await card.click({ timeout: 5000 });
    await P.waitForURL(new RegExp(`/live/${LIVE}$`), { timeout: 8000 }).catch(() => {});
    ok("one tap on the board opens the match", new URL(P.url()).pathname === `/live/${LIVE}`, P.url());
    ok("no page errors", h.errors.length === 0, h.errors.join(" | "));
    await h.ctx.close();

    // Stop following, on his home.
    const h2 = await visitor();
    await h2.page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    await google(h2, idToken(FAN_UID, FAN_EMAIL, "Walk Fan"));
    await h2.page.waitForSelector('[data-testid="unfollow-HIL"]', { timeout: 10000 }).catch(() => {});
    await tid(h2.page, "unfollow-HIL").click({ timeout: 5000 });
    await h2.page.waitForSelector('[data-testid="followed-none"]', { timeout: 8000 }).catch(() => {});
    ok("Stop following empties his list, and the block says what will show there",
       (await tid(h2.page, "followed-none").count()) === 1 && ((await call("/api/follows", { token: fan })).body?.schools ?? [1]).length === 0);
    ok("no page errors (stop following)", h2.errors.length === 0, h2.errors.join(" | "));
    await h2.ctx.close();
    await call("/api/follows", { method: "POST", token: fan, body: { code: "HIL" } });

    // ── 5 · The chase: the sentence says it from the read's target ──
    group("5. The chase begins: the home page's live board says the runs needed off the balls left, from the read's target");
    await writeEvents(q, LIVE, [
      at(1, inningsStart({ battingTeam: OPP, bowlingTeam: "1XI", teamKey: OPP, bowlingTeamKey: "1XI", overs: 1 })),
      at(1, ball({ type: BALL_TYPE.RUN, value: 1 }))], 7);
    let pub = null;
    for (let i = 0; i < 40; i++) {
      pub = (await fetch(`${BASE}/api/public/live`, { headers: { "x-forwarded-for": "10.86.1.2" } }).then((x) => x.json()).catch(() => null))?.fixtures?.find((f) => f.id === LIVE);
      if (pub?.target != null) break;
      await new Promise((res) => setTimeout(res, 500));
    }
    ok("the public read carries the chase's target, not revised", pub?.target === 9 && pub?.revised === false, JSON.stringify(pub));
    const v = await home("live with a chase", "live");
    const said = await tid(v.page, "home-card-sentence").first().innerText().catch(() => "");
    ok("the live board's sentence: \"Westville Boys' High 1XI need 8 off 5\"", said === "Westville Boys' High 1XI need 8 off 5", said);
    await common(v, "live with a chase");
    await v.ctx.close();
    const ft = (await call("/api/follows/today", { token: fan })).body?.fixtures?.find((f) => f.id === LIVE);
    ok("...and the follower's Today carries the same target from the same read", ft?.target === 9 && ft?.revised === false, JSON.stringify(ft));
    await call(`/api/follows/${HIL}`, { method: "DELETE", token: fan });
  }

  // ── 6 · A follower who belongs to a school ───────────────────────
  group("6. The coach follows Hilton: Today leads with its live board, above the day sheet");
  {
    const coach = (await call("/api/auth/firebase", { method: "POST", body: { idToken: idToken(COACH_UID, COACH_EMAIL, "Walk Coach"), deviceId: "device-first-run-4" } })).body?.token;
    const f = await call("/api/follows", { method: "POST", token: coach, body: { code: "HIL" } });
    ok("(setup) the coach follows Hilton", f.status === 200 && f.body?.ok === true, f.body);
    const h = await visitor();
    const P = h.page;
    await P.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    await google(h, idToken(COACH_UID, COACH_EMAIL, "Walk Coach"));
    await P.waitForSelector('[data-testid="today-followed"]', { timeout: 12000 }).catch(() => {});
    await afterReads(P, 800);
    ok("he lands on Today", (await tid(P, "os-main").getAttribute("data-page").catch(() => "")) === "dashboard");
    ok("...led by the followed school's live board, above the day sheet", await P.evaluate(() => {
      const y = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? NaN;
      return document.querySelector('[data-testid="followed-schools"]')?.hasAttribute("data-lead") && y("today-followed") < y("day-sheet");
    }));
    ok("...its card live, with the sentence", /need 8 off 5/.test(await tid(P, "followed-card").first().innerText().catch(() => "")));
    ok("no page errors", h.errors.length === 0, h.errors.join(" | "));
    await h.ctx.close();
    await call(`/api/follows/${HIL}`, { method: "DELETE", token: coach });
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.stack ?? e.message);
} finally {
  // A match with a log is not deleted (ball_event never is): unpublished, it leaves the home page.
  await q(`update fixture_publication set published = false where match_id = any($1::uuid[])`, [made.matches]).catch(() => {});
  for (const m of made.matches) await q(`update match set status = 'scheduled', starts_at = now() + interval '3 days' where id = $1 and status = 'live'`, [m]).catch(() => {});
  for (const m of made.matches) await q(`delete from match where id = $1`, [m]).catch(() => {});
  for (const g of made.grounds) await q(`delete from ground where id = $1`, [g]).catch(() => {});
  await browser.close();
  apiProc.kill();
  await owner.end();
  await app.end();
  await rm(dir, { recursive: true, force: true });
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nBROWSER FIRST RUN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

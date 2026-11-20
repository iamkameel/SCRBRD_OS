#!/usr/bin/env node
/**
 * A fixture goes live from the pad, and a reloaded pad finishes it (the
 * match-day bug of 18 Nov 2026; db/165).
 *
 * Every walk that tested live behaviour before this one started from a
 * status no user can produce: it wrote 'live' in SQL. So a scored fixture
 * stayed 'scheduled' all afternoon and nothing noticed. This walk writes NO
 * status in SQL, and no fixture: every state it reads, a person made, in the
 * app or through the route the app calls. tools/run-smoke-shard.test.mjs
 * holds its source to that: no statement of it writes a match row.
 *
 *   1. The office arranges the fixture (POST /api/fixtures, as the form
 *      does): Hilton 1XI at home, one over a side, ten minutes on. The director
 *      of sport publishes the home side. It reads scheduled.
 *   2. A spectator, signed out, opens /live/:id before play: "Fixture".
 *   3. The scorer, on a 390 × 844 phone, opens it from Today and calls the
 *      toss: still scheduled once its setup is sent (the line-up is not
 *      play). He scores one ball:
 *      the fixture is live, with no SQL write, and the coach's Match Centre
 *      says Live; the spectator's page, opened before play, turns Live by
 *      itself, with no reload.
 *   4. A four: it reaches the spectator's page on the page's own refresh,
 *      with no reload, and nothing the page holds or received names a child
 *      beyond docs/policy/PUBLIC_DATA.md's L2 rule (initial and surname, and
 *      only with a recorded consent; no first name ever).
 *   5. The scorer's phone reloads mid-innings. The pad comes back and goes on
 *      under its resume key; he scores the match to its result, confirming
 *      each innings at the review gate.
 *   6. Redesign slice 4 (DESIGN_DIRECTION Q2 (a), Kameel 20 Nov 2026: "the
 *      coach confirms the result"). The scorer's result screen says "Your part
 *      is done. All N balls are sent. The coach confirms the result." with
 *      Back to Today, and no Finish. Until the coach confirms, the score reads
 *      provisional on his Today (Now and This week), on Matches and on the
 *      public page, and nothing offers the pad or a take-over. db/171: the
 *      end screen puts the pen down (the pad's own key, once everything is
 *      sent: "The coach can confirm the result now."), the server's session
 *      goes idle; the scorer's finish is refused by the server (403
 *      coach_confirms, an API call, not only the screen); the coach, and not
 *      the scorer, is told once ("1XI v … is decided. Confirm the result.").
 *      The coach opens it from Notices, which lands him on the match's
 *      Confirm, and confirms on the FIRST press, with no 90 s wait for the
 *      lease; the notice is then taken back. Then it reads as the result:
 *      Today "Result confirmed", the coach's and the public header "Result".
 *      Screenshots at 390, light and dark, into RS4_SHOTS when it is set; the
 *      end screen and the coach's notice at 390 and 1366 too.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-live-from-pad.mjs
 *   BROWSER_LIVE_DEBUG=1 node tools/smoke-browser-live-from-pad.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";
import { destLocator } from "./walk-nav.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const PORT = port(8919);
const BASE = `http://127.0.0.1:${PORT}`;
const DEBUG = !!process.env.BROWSER_LIVE_DEBUG;
const SHOTS = process.env.RS4_SHOTS || null;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const HIL = "11111111-1111-1111-1111-111111111111";
const OPPONENT = "Live From Pad College";
const OVERS = 1;
/** The page's own refresh while live (PublicMatch.jsx: max(5 s, liveRefreshMs)), and the public cache's 5 s while live. */
const ONE_REFRESH_MS = 5000 + 5000 + 2000;

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);
const note = (t) => console.log(`  · ${t}`);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", SESSION_SECRET: "browser-live-from-pad-secret",
         ALLOW_DEV_LOGIN: "1", PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-live-from-pad-pseudonyms-0123456789abcdef",
         PUBLIC_TRUST_PROXY_HOPS: "1", SERVE_CLIENT: "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));
let apiExited = false;
api.on("exit", () => { apiExited = true; });

// Reads only. Nothing in this walk writes a row.
const owner = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p = []) => (await owner.query(t, p)).rows;
const statusOf = async (id) => (await q(`select status from match where id = $1`, [id]))[0]?.status ?? null;

const browser = await chromium.launch({ ...launchOptions() });
let ipN = 0;
const opened = [];
async function open(label, { size = DESKTOP, path = "/app" } = {}) {
  const ctx = await browser.newContext({
    viewport: size, extraHTTPHeaders: { "x-forwarded-for": `10.87.0.${++ipN}` },
    ...(size === PHONE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  // The public page's two paces, shortened as other walks shorten the live one:
  // live (max 5 s, liveRefreshMs) and, before play near the start, soonRefreshMs.
  await page.addInitScript(`window.__SCRBRD_LIVE_MS__ = 1000; window.__SCRBRD_SOON_MS__ = 2000; window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)};`);
  const errors = [], bodies = [];
  page.on("response", (r) => { if (new URL(r.url()).pathname.startsWith("/api/public/")) bodies.push(r.text().catch(() => "")); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const b = { ctx, page, errors, bodies, label, closed: false };
  opened.push(b);
  return b;
}
async function close(b) { if (b.closed) return; b.closed = true; await b.ctx.close().catch(() => {}); }

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const has = async (page, id) => (await tid(page, id).count()) > 0;
const text = (page) => page.$eval("body", (el) => el.innerText);
/** A status word as written, whatever case the label's CSS draws it in. */
const word = async (page, id) => ((await tid(page, id).first().textContent({ timeout: 2000 }).catch(() => "")) || "").trim();
const inner = async (page, id) => ((await tid(page, id).first().innerText({ timeout: 2000 }).catch(() => "")) || "").trim();
const until = async (page, fn, ms = 8000, arg = undefined) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; }
};
const waitFor = async (fn, ms = 10000, step = 250) => {
  const end = Date.now() + ms;
  for (;;) { if (await fn()) return true; if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, step)); }
};
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(250);
  return true;
};
const tap = async (page, id, ms = 4000) => { await tid(page, id).first().click({ timeout: ms }); await page.waitForTimeout(150); };

/** Sign in from the login screen, by the account's button or its typed email. */
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(400);
  if (!(await click(page, new RegExp(email.replace(/[.]/g, "\\.")), 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await afterReads(page, 1800);
  return true;
}
async function openMatch(page, id) {
  const l = await destLocator(page, "matches");
  if (!(await l.count())) return false;
  await l.click({ timeout: 6000 }).catch(() => {});
  await afterReads(page, 1200);
  const btn = tid(page, `mc-open-${id}`);
  await btn.first().waitFor({ timeout: 10000 }).catch(() => {});
  if (!(await btn.count())) return false;
  await btn.first().click({ timeout: 5000 });
  const done = await until(page, () => !!document.querySelector('[data-testid="match-view"]'), 8000);
  await afterReads(page, 800);
  return done;
}
const tokenFor = async (email) => (await (await fetch(`${BASE}/api/auth/dev-login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, deviceId: `live-from-pad-${email}` }) })).json())?.token;
const call = async (path, token, body) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// ── The pad ─────────────────────────────────────────────────────
const balls = (id) => q(`select seq, innings, kind, ball_type, value from ball_event where match_id = $1 order by seq`, [id]);
const nameBowler = async (page, name) => {
  await page.locator("input[aria-label='Bowler name']").first().fill(name);
  await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 3000 });
  await page.waitForTimeout(400);
};
/** Until the pad says nothing is missing: the capture choice, the openers, a bowler, a typed batter, the pad's own fix. */
async function ready(page) {
  let typed = 0;
  for (let i = 0; i < 16; i++) {
    if (await has(page, "innings-review")) return true;
    const sheet = (await page.locator('[role="dialog"]').count()) > 0;
    const body = sheet ? await text(page) : "";
    const nameField = page.locator('input[aria-label="Player name"]');
    if (await nameField.count()) { await nameField.first().fill(`L Batter ${++typed}`); await nameField.first().press("Enter"); await page.waitForTimeout(400); continue; }
    if (sheet && /Opening Bowler|Over \d+ Complete/i.test(body) && await page.locator("input[aria-label='Bowler name']").count()) { await nameBowler(page, "P Oakes"); continue; }
    const bowlerPick = page.locator('[data-testid="bowler-choice"]:not([disabled])');
    if (await bowlerPick.count()) { await bowlerPick.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(400); continue; }
    const bowl = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowl.count()) { await bowl.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(400); continue; }
    const next = page.locator('[role="dialog"] button:not([disabled])', { hasText: /Next\s*$|^Start|Confirm/i });
    if (sheet && await next.count()) { await next.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(400); continue; }
    if (!sheet && await has(page, "scoring-blocked-fix")) { await tap(page, "scoring-blocked-fix").catch(() => {}); await page.waitForTimeout(400); continue; }
    if (!sheet && !(await has(page, "scoring-blocked"))) return true;
    await page.waitForTimeout(400);
  }
  return false;
}
const basic = async (page) => {
  if (await has(page, "basic-pad")) return true;
  await tap(page, "pad-menu").catch(() => {});
  await tap(page, "pad-basic-scoring").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  return has(page, "basic-pad");
};
const legalOf = (rows, inn) => rows.filter((r) => r.innings === inn && r.kind === "ball" && !["Wd", "Nb"].includes(r.ball_type)).length;
/** One run key on Basic Scoring, and the server's count of this innings' legal balls reaching `n`. */
const run = async (page, runs, inn, n, id) => {
  await ready(page);
  await tid(page, `run-${runs}`).first().click({ timeout: 4000 });
  await page.waitForTimeout(250);
  return waitFor(async () => legalOf(await balls(id), inn) >= n, 10000);
};

/** The runs of the first innings on a Match Centre or public page's scores ("5/0 …"). */
const runsOn = async (page) => Number((/(\d+)\/\d+/.exec(await inner(page, "mc-scores")) ?? [])[1] ?? NaN);

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (apiExited) throw new Error(`the walk's own API did not start: ${apiErr.join("").split("\n").find((l) => /Error/.test(l)) ?? "exited"}`);
  // Ten minutes on, and on today's date in South Africa whatever the hour:
  // Today lists a complete fixture only on its own SA day (lib/scorerHome.js).
  const saMidnight = (() => { const d = new Date(Date.now() + 2 * 3600e3); d.setUTCHours(24, 0, 0, 0); return d.getTime() - 2 * 3600e3; })();
  const START = new Date(Math.min(Math.ceil((Date.now() + 10 * 60e3) / 60e3) * 60e3, saMidnight - 60e3));

  // ── 1 ──────────────────────────────────────────────────────────
  group("1. The office arranges the fixture; the director publishes the home side");
  const office = await tokenFor("registrar@example.invalid");
  const made = await call("/api/fixtures", office, { schoolId: HIL, teamCode: "1XI", opponent: OPPONENT, startsAt: START.toISOString(), overs: OVERS, format: "T20" });
  ok(`the office arranges it through the route (${made.status})`, made.status === 200 || made.status === 201, JSON.stringify(made.body));
  const [fx] = await q(`select id, status from match where school_id = $1 and opponent = $2`, [HIL, OPPONENT]);
  const MATCH = fx?.id;
  if (!MATCH) throw new Error("no fixture was made");
  ok("it reads scheduled", fx.status === "scheduled", fx.status);
  const pub = await call(`/api/matches/${MATCH}/publication`, await tokenFor("sarah@example.invalid"), { side: "home", published: true });
  ok(`the director of sport publishes the home side (${pub.status})`, pub.status === 200 && pub.body?.published === true, JSON.stringify(pub.body));

  // ── 2 ──────────────────────────────────────────────────────────
  group("2. A spectator, signed out, opens the public page before play");
  const pu = await open("public", { path: `/live/${MATCH}` });
  await pu.page.waitForSelector('[data-testid="public-match"]', { timeout: 8000 }).catch(() => {});
  // Redesign slice 2: the match card's state line, a fixture to come being its day and time ("Sat 21 Nov · 17:25").
  ok(`the page draws the fixture, as a fixture ("${await word(pu.page, "mc-status")}")`, await has(pu.page, "public-match")
     && (await tid(pu.page, "mc-status").first().getAttribute("data-kind").catch(() => null)) === "upcoming" && /\d\d:\d\d$/.test(await word(pu.page, "mc-status")),
    (await text(pu.page)).slice(0, 300));

  // ── 3 ──────────────────────────────────────────────────────────
  group("3. The scorer opens it from Today, calls the toss, and scores the first ball");
  const sc = await open("scorer-phone", { size: PHONE });
  ok("the scorer signs in on his phone", await signIn(sc.page, "scorer@example.invalid"));
  const P = sc.page;
  const openBtn = tid(P, `fixture-${MATCH}-open`);
  await openBtn.first().waitFor({ timeout: 10000 }).catch(() => {});
  ok("the fixture is on his Today, not started", await openBtn.count() > 0 && (await tid(P, `fixture-${MATCH}`).first().getAttribute("data-state")) === "not_started",
    (await text(P)).slice(0, 400));
  await openBtn.first().click({ timeout: 5000 });
  ok("the pad asks the toss", await until(P, () => !!document.querySelector('[data-testid="toss-sheet"]'), 10000), (await text(P)).slice(0, 400));
  await tap(P, "toss-won-home"); await tap(P, "toss-decision-bat"); await tap(P, "toss-confirm");
  await afterReads(P, 800);
  ok("the toss is on the server", (await q(`select 1 from match_toss where match_id = $1`, [MATCH])).length === 1);
  ok("the pad is ready: the openers in, the bowler named", await ready(P), (await text(P)).slice(0, 500));
  ok("...its setup is on the server (innings_start, the openers, the bowler)",
     await waitFor(async () => (await balls(MATCH)).some((r) => r.kind === "innings_start"), 8000), JSON.stringify(await balls(MATCH)));
  ok("...and the fixture is still scheduled: the toss and the line-up are not play", (await statusOf(MATCH)) === "scheduled", await statusOf(MATCH));
  ok("...on Basic Scoring", await basic(P));
  ok("the first ball, a single, reaches the server", await run(P, 1, 0, 1, MATCH), JSON.stringify(await balls(MATCH)));
  ok("THE FIXTURE IS LIVE, from its first ball, with no SQL write", await waitFor(async () => (await statusOf(MATCH)) === "live", 5000), await statusOf(MATCH));

  const coach = await open("coach-matchcentre");
  ok("the 1XI coach signs in", await signIn(coach.page, "coach@example.invalid"));
  ok("...and opens the fixture in Match Centre", await openMatch(coach.page, MATCH), (await text(coach.page)).slice(0, 300));
  ok(`his Match Centre says Live ("${await word(coach.page, "mc-status")}")`, (await word(coach.page, "mc-status")) === "Live");
  ok("no console errors (coach)", coach.errors.length === 0, coach.errors.join(" | "));
  await close(coach);

  // Opened before play, it asks again near the start (PublicMatch.jsx, soonRefreshMs), so it turns
  // Live by itself: no reload (19 Nov 2026: it never polled until it was live).
  const tLive = Date.now();
  ok(`the spectator's page, opened before play, says Live with no reload ("${await word(pu.page, "mc-status")}")`,
    await until(pu.page, () => document.querySelector('[data-testid="mc-status"]')?.textContent?.trim() === "Live", ONE_REFRESH_MS), await word(pu.page, "mc-status"));
  note(`it turned Live ${Date.now() - tLive} ms after the server had the first ball`);
  ok(`...with the single on it (${await inner(pu.page, "mc-scores")})`, await waitFor(async () => (await runsOn(pu.page)) === 1, 8000), await inner(pu.page, "mc-scores"));

  // ── 4 ──────────────────────────────────────────────────────────
  group("4. A four reaches the public page on its own refresh, and no child is named");
  ok("the four reaches the server", await run(P, 4, 0, 2, MATCH), JSON.stringify(await balls(MATCH)));
  const t4 = Date.now();
  const four = await waitFor(async () => (await runsOn(pu.page)) === 5, ONE_REFRESH_MS, 200);
  note(`the four reached the spectator's page ${Date.now() - t4} ms after the server had it`);
  ok(`the spectator's page shows it without a reload, in ${Date.now() - t4} ms (5 runs: ${await inner(pu.page, "mc-scores")})`, four);
  // docs/policy/PUBLIC_DATA.md L2: on the live surface a boy is his initial and
  // surname, and only with a recorded consent; otherwise "Batter" or "Bowler".
  // So no Hilton boy's first name, and no unconsented boy's surname, is in the
  // page or anything it received.
  const boys = await q(`select p.full_name, coalesce(p.surname, split_part(p.full_name, ' ', 2)) as surname,
                               exists (select 1 from public_name_consent c where c.player_id = p.id) as consent
                          from player p where p.school_id = $1`, [HIL]);
  const firsts = [...new Set(boys.map((b) => b.full_name.split(/\s+/)[0]).filter((w) => w.length > 2))];
  const unconsented = [...new Set(boys.filter((b) => !b.consent).map((b) => b.surname).filter((w) => w && w.length > 2))];
  const pageText = await text(pu.page);
  const got = (await Promise.all(pu.bodies)).join("\n");
  const re = (w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const leaks = [...firsts, ...unconsented].filter((w) => re(w).test(pageText) || re(w).test(got));
  ok(`no Hilton boy's first name, and no unconsented surname, on the page or in what it received (${firsts.length} first names, ${unconsented.length} surnames checked)`,
    firsts.length > 0 && got.length > 0 && leaks.length === 0, leaks.join(", "));
  ok("no console errors (public)", pu.errors.length === 0, pu.errors.join(" | "));

  // ── 5 ──────────────────────────────────────────────────────────
  group("5. The scorer's phone reloads mid-innings; he scores the match to its result");
  await P.reload({ waitUntil: "networkidle" });
  await afterReads(P, 1500);
  ok("the pad comes back after the reload", await until(P, () => !!document.querySelector('[data-testid="basic-pad"], [data-testid="three-phase-pad"]'), 12000),
    (await text(P)).slice(0, 400));
  ok("...on Basic Scoring", await basic(P));
  for (const [i, r] of [0, 2, 0, 1].entries()) ok(`ball ${i + 3} (${r}) reaches the server, sent under the pad's own key`, await run(P, r, 0, i + 3, MATCH));
  ok("the innings ends at its over, at the review gate", await until(P, () => !!document.querySelector('[data-testid="innings-review"]'), 10000), (await text(P)).slice(0, 300));
  await tap(P, "review-confirm");
  await afterReads(P, 800);
  ok("the reply starts", await click(P, /Start 2nd Innings/, 4000));
  await afterReads(P, 600);
  ok("the reply's openers and bowler are named", await ready(P), (await text(P)).slice(0, 400));
  await basic(P);
  for (let b = 1; b <= 6; b++) {
    if (await has(P, "innings-review")) break;
    await run(P, 0, 1, b, MATCH);
  }
  ok("the reply ends at its over, at the review gate", await until(P, () => !!document.querySelector('[data-testid="innings-review"]'), 10000), (await text(P)).slice(0, 300));
  await tap(P, "review-confirm");
  await afterReads(P, 1000);
  ok("the result screen names the winner", /Match Complete/i.test(await text(P)) && /Hilton|1XI/i.test(await text(P)), (await text(P)).slice(0, 400));
  const ends = await q(`select 1 from ball_event where match_id = $1 and kind = 'innings_end'`, [MATCH]);
  ok("the server has both innings closed", await waitFor(async () => (await q(`select 1 from ball_event where match_id = $1 and kind = 'innings_end'`, [MATCH])).length === 2, 10000), ends.length);
  ok("...and the fixture is still live, not finished", (await statusOf(MATCH)) === "live", await statusOf(MATCH));

  // ── 6 ──────────────────────────────────────────────────────────
  group("6. Slice 4: the scorer's part is done; provisional everywhere; the coach confirms; then the result");
  const shot = async (page, name, widths = null) => {
    if (!SHOTS) return;
    await mkdir(SHOTS, { recursive: true });
    const was = page.viewportSize();
    for (const w of widths ?? [was?.width ?? 390]) {
      if (widths) await page.setViewportSize({ width: w, height: w <= 430 ? 844 : 900 }).catch(() => {});
      for (const scheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: scheme }).catch(() => {});
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(SHOTS, `${name}-${widths ? w : 390}-${scheme}.png`), fullPage: true }).catch(() => {});
      }
    }
    if (widths && was) await page.setViewportSize(was).catch(() => {});
    await page.emulateMedia({ colorScheme: "light" }).catch(() => {});
  };
  ok("the end panel is shown, not hidden", await has(P, "pad-finish-panel"), (await text(P)).slice(0, 400));
  ok(`it says "Your part is done." ("${await inner(P, "pad-done-lead")}")`, (await inner(P, "pad-done-lead")) === "Your part is done.");
  // db/171: everything sent, the end screen puts the pen down, under the pad's own key.
  const tEnd = Date.now();
  ok("the pad puts the pen down once everything is sent",
     await until(P, () => document.querySelector('[data-testid="pad-finish-panel"]')?.getAttribute("data-released") === "true", 20000),
     await tid(P, "pad-finish-panel").first().getAttribute("data-released").catch(() => "?"));
  const doneSaid = await inner(P, "pad-done-said");
  ok(`...that every ball is sent, and that the coach can confirm now ("${doneSaid}")`, /^All \d+ balls are sent\. The coach can confirm the result now\.$/.test(doneSaid), doneSaid);
  const [sess] = await q(`select state, holder_user_id from scoring_session where match_id = $1`, [MATCH]);
  const [{ id: scorerId }] = await q(`select id from app_user where email = 'scorer@example.invalid'`);
  const downs = await q(`select actor_id from scoring_audit where match_id = $1 and event = 'pen_released'`, [MATCH]);
  ok(`...the server's session is idle, nobody holding it (${JSON.stringify(sess)})`, sess?.state === "idle" && sess?.holder_user_id === null);
  ok("...one pen_released row, the scorer's", downs.length === 1 && downs[0].actor_id === scorerId, JSON.stringify(downs));
  const scorerFinish = await call(`/api/matches/${MATCH}/finalise`, await tokenFor("scorer@example.invalid"), {});
  ok(`the server refuses the scorer's finish: 403 coach_confirms (${scorerFinish.status} ${scorerFinish.body?.error})`,
     scorerFinish.status === 403 && scorerFinish.body?.error === "coach_confirms", JSON.stringify(scorerFinish.body));
  ok("...and offers the scorer no Finish or Confirm", !(await has(P, "pad-finish")));
  const back = await tid(P, "pad-done-back").first().evaluate((e) => ({ h: e.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(e).fontSize), t: e.textContent.trim() })).catch(() => null);
  ok(`"Back to Today" is the one primary, a 44px key on the 12px floor (${JSON.stringify(back)})`, !!back && back.t === "Back to Today" && back.h >= 44 && back.fs >= 12
     && (await P.locator("button", { hasText: /^(New Match|Back home)$/ }).count()) === 0);
  ok("the result screen does not scroll sideways at 390", await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
     await P.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`));
  await shot(P, "scorer-end", [390, 1366]);
  ok("the fixture is still live: the scorer finished nothing", (await statusOf(MATCH)) === "live", await statusOf(MATCH));

  await tap(P, "pad-done-back");
  await afterReads(P, 1200);
  // The pad scored under its own key after the reload, so Today opens signed out: he signs in.
  // (A session is held in memory, so a page load signs out too: the same steps open Today again below.)
  const todaySignedIn = async () => {
    await P.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    // The demonstration's own "Sign in", where the app opens on it, then the login.
    if (!(await P.locator("button", { hasText: /Get Started|Log In/ }).count())) await click(P, /^Sign in$/, 4000);
    await signIn(P, "scorer@example.invalid"); await afterReads(P, 1500);
  };
  if (!(await has(P, "scorer-home")) || /no server connected/.test(await text(P))) await todaySignedIn();
  const rowState = tid(P, `fixture-${MATCH}`);
  ok("he is back on Today", await until(P, () => !!document.querySelector('[data-testid="scorer-home"]'), 10000), (await text(P)).slice(0, 300));
  if (DEBUG) note(`Today: ${(await text(P)).slice(0, 1500)}`);
  ok("This week: the fixture is provisional, his part done",
     await until(P, (id) => document.querySelector(`[data-testid="fixture-${id}"]`)?.getAttribute("data-state") === "provisional", 12000, MATCH),
     await rowState.first().getAttribute("data-state").catch(() => "?"));
  const weekLine = await inner(P, `fixture-${MATCH}-state`);
  ok(`...in words: "${weekLine}"`, weekLine === "Your part is done · the coach confirms the result", weekLine);
  ok(`...its sentence says provisional ("${await inner(P, `fixture-${MATCH}-sentence`)}")`, /· provisional$/.test(await inner(P, `fixture-${MATCH}-sentence`)));
  ok("...and offers neither the pad nor a take-over", !(await has(P, `fixture-${MATCH}-open`)) && !/no device is scoring|takes the scoring/i.test(await text(P)));
  const nowCard = tid(P, `now-live-${MATCH}`);
  if (await nowCard.count()) {
    ok("Now: the same match card, provisional, with no pad", (await nowCard.first().getAttribute("data-state")) === "provisional"
       && !(await has(P, `now-live-${MATCH}-open`)) && /^Provisional/i.test((await nowCard.first().innerText()).trim()), (await nowCard.first().innerText()).slice(0, 200));
  } else note("Now does not hold it: the phone's log is cleared and the fixture is listed in This week");
  await shot(P, "today-provisional");

  // Matches, on the same phone: the row is provisional, and its one action opens the match.
  const ml = await destLocator(P, "matches");
  if (await ml.count()) { await ml.click({ timeout: 6000 }).catch(() => {}); await afterReads(P, 1500); }
  ok("Matches: the row reads Provisional", await until(P, (id) => document.querySelector(`[data-testid="match-card-${id}"]`)?.getAttribute("data-state") === "provisional", 12000, MATCH),
     await tid(P, `match-card-${MATCH}`).first().getAttribute("data-state").catch(() => "?"));
  ok(`...its sentence says provisional ("${await inner(P, `mc-card-status-${MATCH}`)}")`, /· provisional$/.test(await inner(P, `mc-card-status-${MATCH}`)));
  ok("...and offers no Resume scoring", !(await has(P, `mc-score-${MATCH}`)));

  ok(`the public page reads Provisional ("${await word(pu.page, "mc-status")}")`,
     await until(pu.page, () => document.querySelector('[data-testid="mc-status"]')?.textContent?.trim() === "Provisional", ONE_REFRESH_MS), await word(pu.page, "mc-status"));
  ok("...said once: the card's state line, with no second Provisional label under it (slice 2's rule)",
     !/Provisional/i.test(await inner(pu.page, "public-official")), await inner(pu.page, "public-official"));
  ok(`...and its sentence says provisional ("${await inner(pu.page, "mc-result")}")`, /· provisional$/.test(await inner(pu.page, "mc-result")), await inner(pu.page, "mc-result"));

  // The coach's notice (Q2, db/171): written at the chase's seal, once, to who may confirm, never the scorer.
  const TITLE = `1XI v ${OPPONENT} is decided. Confirm the result.`;
  const decidedTo = async (email) => ((await (await fetch(`${BASE}/api/read/notifications`, { headers: { authorization: `Bearer ${await tokenFor(email)}` } })).json())?.rows ?? [])
    .filter((n) => n.subject_id === MATCH && n.title === TITLE);
  const toCoach = await decidedTo("coach@example.invalid");
  ok(`the 1XI coach is told once: "${TITLE}"`, toCoach.length === 1 && toCoach[0].urgency === "medium", JSON.stringify(toCoach));
  ok("...the director of sport too, and the scorer not", (await decidedTo("sarah@example.invalid")).length === 1 && (await decidedTo("scorer@example.invalid")).length === 0);
  const named = await q(`select count(*)::int n from notification n, player p where n.subject_id = $1 and n.title = $2
                           and p.school_id = $3 and position(p.full_name in n.title || ' ' || n.body) > 0`, [MATCH, TITLE, HIL]);
  ok("...naming no child", named[0].n === 0);

  const co = await open("coach-confirms");
  ok("the 1XI coach signs in", await signIn(co.page, "coach@example.invalid"));
  const bell = await destLocator(co.page, "notifications");
  if (await bell.count()) { await bell.click({ timeout: 6000 }).catch(() => {}); await afterReads(co.page, 1200); }
  const noticeRow = co.page.locator('[data-testid="notice-row"]', { hasText: TITLE });
  ok("his Notices list it", await noticeRow.first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false), (await text(co.page)).slice(0, 400));
  ok("...with Confirm the result on it", (await noticeRow.locator('[data-testid="notice-confirm-result"]').count()) === 1);
  await shot(co.page, "coach-notice", [390, 1366]);
  await noticeRow.locator('[data-testid="notice-confirm-result"]').first().click({ timeout: 5000 });
  ok("one tap lands him on the match's Confirm", await until(co.page, () => !!document.querySelector('[data-testid="match-view"]')
       && document.activeElement?.getAttribute("data-testid") === "mc-finish", 12000),
     `${await has(co.page, "match-view")} · focus ${await co.page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName)}`);
  ok(`his header says Provisional ("${await word(co.page, "mc-status")}")`, (await word(co.page, "mc-status")) === "Provisional");
  const cKey = await tid(co.page, "mc-finish").first().evaluate((e) => ({ h: e.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(e).fontSize) })).catch(() => null);
  ok(`...a 44px key on the 12px floor (${JSON.stringify(cKey)})`, !!cKey && Math.round(cKey.h) >= 44 && cKey.fs >= 12);
  // db/171: the scorer's end screen put the pen down, so the FIRST press confirms: no 90 s lease to wait out.
  // The press waits for its answer: the button's own busy state ending ("Confirming…" gone), then the words,
  // which MatchView now holds once the match re-reads as complete.
  const answered = () => {
    const b = document.querySelector('[data-testid="mc-finish"]');
    const said = (document.querySelector('[data-testid="mc-finish-said"]')?.textContent ?? "").trim();
    return said.length > 0 && !(b && /Confirming/.test(b.textContent ?? ""));
  };
  await tid(co.page, "mc-finish").first().click({ timeout: 8000 }).catch(() => {});
  await until(co.page, answered, 30000);
  const lastSaid = await inner(co.page, "mc-finish-said");
  const waited = Math.round((Date.now() - tEnd) / 1000);
  ok(`he confirms it on the first press: "${lastSaid}"`, /^Confirmed\. The match is finished\.$/.test(lastSaid), lastSaid);
  note(`confirmed ${waited} s after the scorer's end screen (a held lease took up to 90 s to lapse; this one was put down)`);
  ok("...and his notice is taken back", (await decidedTo("coach@example.invalid")).length === 0);
  ok(`the server has the match complete (${await statusOf(MATCH)})`, (await statusOf(MATCH)) === "complete");
  // The fixture re-read comes back complete; the answer stays where he read it (the panel no longer goes with it).
  await afterReads(co.page, 2500);
  ok("...and the answer is still on his screen once the fixture is re-read", /^Confirmed\. The match is finished\.$/.test(await inner(co.page, "mc-finish-said")),
     await inner(co.page, "mc-finish-said"));
  const [{ id: coachId }] = await q(`select id from app_user where email = 'coach@example.invalid'`);
  const fins = await q(`select actor_id from scoring_audit where match_id = $1 and event = 'match_finalised'`, [MATCH]);
  ok("...one audit row, the coach's, not the scorer's", fins.length === 1 && fins[0].actor_id === coachId, JSON.stringify(fins));
  ok(`his header now says Result ("${await word(co.page, "mc-status")}")`,
     await until(co.page, () => document.querySelector('[data-testid="mc-status"]')?.textContent?.trim() === "Result", 12000), await word(co.page, "mc-status"));
  ok("no console errors (coach)", co.errors.length === 0, co.errors.join(" | "));
  await close(co);

  await todaySignedIn();
  ok("the scorer's Today: the fixture reads as the result",
     await until(P, (id) => document.querySelector(`[data-testid="fixture-${id}"]`)?.getAttribute("data-state") === "complete", 12000, MATCH),
     await rowState.first().getAttribute("data-state").catch(() => "?"));
  const said = await inner(P, `fixture-${MATCH}-state`);
  const sentence = await inner(P, `fixture-${MATCH}-sentence`);
  ok(`..."${said}" · "${sentence}"`, said === "Result confirmed" && !/provisional|Result to confirm/i.test(sentence) && /won by|tied/i.test(sentence), `${said} | ${sentence}`);
  ok("...not \"no device is scoring\"", !/no device is scoring/.test(await text(P)));
  await shot(P, "today-confirmed");
  ok(`the public page now says Result ("${await word(pu.page, "mc-status")}")`,
     await until(pu.page, () => document.querySelector('[data-testid="mc-status"]')?.textContent?.trim() === "Result", ONE_REFRESH_MS * 2), await word(pu.page, "mc-status"));
  note(`the public official label: "${await inner(pu.page, "public-official")}" (db/114's official result is the director's or the organiser's, after the coach's)`);
  ok("no console errors (scorer)", sc.errors.length === 0, sc.errors.join(" | "));
  ok("no console errors (public)", pu.errors.length === 0, pu.errors.join(" | "));
  if (DEBUG) note(`balls: ${JSON.stringify(await balls(MATCH))}`);
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", DEBUG ? e.stack : e.message);
  if (DEBUG) for (const b of opened.filter((x) => !x.closed)) console.log(`[debug] ${b.label}:\n` + (await text(b.page).catch(() => "")).slice(0, 900));
} finally {
  for (const b of opened) await close(b);
  await browser.close().catch(() => {});
  api.kill("SIGTERM");
  await owner.end().catch(() => {});
}

if (fail && apiErr.length) console.log("\nAPI stderr:\n" + apiErr.join("").split("\n").slice(0, 12).join("\n"));
console.log(`\n${"─".repeat(52)}\nBROWSER LIVE FROM PAD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

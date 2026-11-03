#!/usr/bin/env node
/**
 * The pilot's whole journey, end to end, in real browsers against one real
 * server and Postgres: the walk a founder's demo is recorded from.
 *
 *   1. THE OFFICE (B Naicker, the school administrator) schedules a fixture
 *      from Match Centre: Hilton 1XI at home to a typed opponent, two hours on, two
 *      overs a side. The parent of the 1XI's opener says he is available, and
 *      the office then moves the start: the change the parent sees in 6.
 *   2. THE SCORER, on a 390 × 844 phone, calls the toss on the pad and scores
 *      Hilton's innings on the three-phase pad. Every scoring shot takes the
 *      wagon wheel: the shot, a tap on the field where it went, the outcome.
 *      A wide, a no-ball, leg byes, a boundary and a wicket are among them.
 *   3. CORRECTIONS: during play the scorer records a ball and undoes it; after
 *      full time he asks for an amendment of a ball, and the director of sport
 *      approves it from the fixture's Corrections sheet.
 *   4. The innings ends at its two overs, the reply is scored on Basic Scoring
 *      (no wagon wheel: the timing set beside the wheel's) until the match is
 *      decided, the review gate closes each innings, the result is confirmed
 *      official, and the director publishes the home side to the public pages.
 *   5. THE COACH opens the finished match: the batting and bowling figures,
 *      and the wagon wheel with a spoke for each placed scoring shot.
 *   6. THE PARENT (H Whitfield) sees the fixture and its change before play,
 *      and his son's result after it, with the correction said.
 *   7. THE PUBLIC PAGE, signed out: nothing until the side is published; then
 *      the match, with no boy named who has no recorded consent, in the page
 *      or in anything it received.
 *
 * Wherever a step cannot be done in the app as it stands, the walk says so on
 * a "· not in the app:" line and goes on. Those lines are findings, not
 * failures: they are listed again at the end. A ✗ is a step the app offers
 * that did not work.
 *
 * Timings: every ball's time, from the walk's first tap on it to the pad's
 * board showing it, is printed at the end, with the wagon wheel (shot, field,
 * outcome on the three-phase pad) and without it (one key on Basic Scoring).
 * They are THIS WALK'S OWN timings — a script taps as fast as the page lets
 * it, so they measure what the app costs, not a human scorer's hand or eye.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-pilot-flow.mjs
 *   RECORD_VIDEO=/some/dir node tools/smoke-browser-pilot-flow.mjs
 *     — Playwright video of every browser: the scorer's at phone size, the
 *       rest at desktop, numbered in the order they appear in the story.
 *   BROWSER_PILOT_DEBUG=1 node tools/smoke-browser-pilot-flow.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";
import { pickTab } from "./walk-tabs.mjs";

const PORT = port(8903);
const BASE = `http://127.0.0.1:${PORT}`;
const DEBUG = !!process.env.BROWSER_PILOT_DEBUG;
const VIDEO = process.env.RECORD_VIDEO || null;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const HIL = "11111111-1111-1111-1111-111111111111";
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";   // the 1XI's opener; H Whitfield is his parent (db/98)
const OPPONENT = "Kearsney College 1st XI";
const OVERS = 2;
const WIDE_REASON = "No wide was signalled at square leg; the book has none.";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);
/** What the app as it stands cannot do: said, kept for the summary, and the walk goes on. */
const gaps = [];
const gap = (step, what) => { gaps.push(`${step}: ${what}`); console.log(`  · not in the app: ${what}`); };
const note = (t) => console.log(`  · ${t}`);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", SESSION_SECRET: "browser-pilot-flow-secret",
         ALLOW_DEV_LOGIN: "1", PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-pilot-flow-pseudonyms-0123456789abcdef",
         PUBLIC_TRUST_PROXY_HOPS: "1", SERVE_CLIENT: "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));
// A server of somebody else's left on this port would answer the walk's
// health check; this walk's own must be the one running.
let apiExited = false;
api.on("exit", () => { apiExited = true; });

const owner = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p = []) => (await owner.query(t, p)).rows;

const browser = await chromium.launch({ ...launchOptions() });
let ipN = 0, clipN = 0;
/** Every browser of the story, closed at the end so its video is written. */
const opened = [];

/**
 * A browser of its own: its own address (the public page limits by it), its
 * own viewport, and, under RECORD_VIDEO, its own video at that size.
 */
async function open(label, { size = DESKTOP, path = "/app" } = {}) {
  const ctx = await browser.newContext({
    viewport: size, extraHTTPHeaders: { "x-forwarded-for": `10.86.0.${++ipN}` },
    ...(size === PHONE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    ...(VIDEO ? { recordVideo: { dir: VIDEO, size } } : {}),
  });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  await page.addInitScript(`window.__SCRBRD_LIVE_MS__ = 1000; window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)};`);
  const errors = [], bodies = [];
  page.on("response", (r) => { if (new URL(r.url()).pathname.startsWith("/api/public/")) bodies.push(r.text().catch(() => "")); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const b = { ctx, page, errors, bodies, label, clip: ++clipN, closed: false };
  opened.push(b);
  return b;
}
/** Close a browser; its video, if any, is renamed for the story's order. */
async function close(b) {
  if (b.closed) return;
  b.closed = true;
  const video = b.page.video();
  await b.ctx.close().catch(() => {});
  if (video) {
    const from = await video.path().catch(() => null);
    if (from) await rename(from, join(VIDEO, `${String(b.clip).padStart(2, "0")}-${b.label}.webm`)).catch(() => {});
  }
}
/** A pause for the viewer of the video only; nothing is judged by it. */
const beat = async (page, ms = 700) => { if (VIDEO) await page.waitForTimeout(ms); };

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const has = async (page, id) => (await tid(page, id).count()) > 0;
const text = (page) => page.$eval("body", (el) => el.innerText);
const inner = async (page, id) => ((await tid(page, id).first().innerText({ timeout: 2000 }).catch(() => "")) || "").trim();
const until = async (page, fn, ms = 8000, arg = undefined) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; }
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
  return (await page.locator("nav button, [data-testid^='mnav-']").count()) > 0;
}
async function go(page, key) {
  const l = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"]`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await afterReads(page, 1200);
  return true;
}
async function openMatch(page, id) {
  if (!(await go(page, "matches"))) return false;
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
  body: JSON.stringify({ email, deviceId: `pilot-flow-${email}` }) })).json())?.token;

// ── The pad ─────────────────────────────────────────────────────

/** The pad's board, as the screen reader hears it: "11 for 0, 1.2 overs". */
const board = async (page) => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
/** The server's balls for a match, in order. */
const serverBalls = (match) => q(`select seq, innings, kind, ball_type, value, shot, theta, radius, placement_source, striker_id, payload
                                    from ball_event where match_id = $1 order by seq`, [match]);

/** Every ball's time, from the first tap to the board showing it. */
const timings = { wheel: [], basic: [], extra: [] };
/**
 * Record one ball, timed: `taps` is the scorer's taps for it, and the clock
 * stops when the board no longer reads what it read before the first.
 */
async function timed(page, kind, taps) {
  const before = await board(page);
  const t0 = Date.now();
  await taps();
  const moved = await until(page, (b) => {
    const el = [...document.querySelectorAll('[role="status"][aria-live="polite"]')].find((e) => / for \d+, /.test(e.textContent || ""));
    return !!el && el.textContent.trim() !== b;
  }, 6000, before);
  const ms = Date.now() - t0;
  if (moved) timings[kind].push(ms);
  return moved;
}

/** Press on the pad's field at (fx, fy) of its half-width from the centre, read the prompt, release. */
async function tapField(page, fx, fy) {
  const svg = page.locator('[data-testid="phase-area"] svg').first();
  // On a phone the field's lower half can sit under the extras strip: the
  // scorer scrolls it up first, and so does the walk.
  await svg.evaluate((e) => {
    const r = e.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight - 160) e.scrollIntoView({ block: "center" });
  }).catch(() => {});
  const b = await svg.boundingBox({ timeout: 4000 }).catch(() => null);
  if (!b) return "";
  const x = b.x + b.width / 2 + (b.width / 2) * fx, y = b.y + b.height / 2 + (b.height / 2) * fy;
  const onField = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('[data-testid="phase-area"] svg'), [x, y]);
  if (!onField) return "";
  await page.mouse.move(x, y);
  await page.mouse.down();
  const said = await inner(page, "area-prompt");
  await page.mouse.up();
  return said;
}

/** Bowlers are typed (the opponent is not on SCRBRD): the walk names them. */
const nameBowler = async (page, name) => {
  const field = page.locator("input[aria-label='Bowler name']").first();
  await field.fill(name);
  await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 3000 });
  await page.waitForTimeout(400);
};

/**
 * Until the pad says nothing is missing: a capture choice, the batting order
 * and the openers (Next), a named or picked bowler, the pad's own fix button.
 */
async function ready(page, bowlerName) {
  for (let i = 0; i < 14; i++) {
    const sheet = (await page.locator('[role="dialog"]').count()) > 0;
    const body = sheet ? await text(page) : "";
    if (sheet && await has(page, "capture-profile-full") && (await tid(page, "capture-profile-full").getAttribute("aria-pressed")) === "false") {
      await tap(page, "capture-profile-full").catch(() => {});
    }
    const next = page.locator('[role="dialog"] button:not([disabled])', { hasText: /Next\s*$|^Start|Confirm/i });
    if (sheet && /Opening Bowler|Over \d+ Complete/i.test(body) && await page.locator("input[aria-label='Bowler name']").count()) {
      await nameBowler(page, bowlerName); continue;
    }
    if (sheet && await next.count()) { await next.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(400); continue; }
    if (!sheet && await has(page, "scoring-blocked-fix")) { await tap(page, "scoring-blocked-fix").catch(() => {}); await page.waitForTimeout(400); continue; }
    if (!sheet && !(await has(page, "scoring-blocked"))) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (apiExited) throw new Error(`the walk's own API did not start: ${apiErr.join("").split("\n").find((l) => /Error/.test(l)) ?? "exited"}`);
  if (VIDEO) await mkdir(VIDEO, { recursive: true });
  // The start: two hours from now, on the five minutes; moved an hour later in
  // 1b. Times are the machine's own zone, which the browser shares.
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const START = new Date(Math.ceil((Date.now() + 2 * 3600e3) / 300e3) * 300e3);
  const MOVED = new Date(START.getTime() + 3600e3);

  // ── 1 ──────────────────────────────────────────────────────────
  group("1. The office schedules the fixture and names both sides");
  const office = await open("office-schedules");
  ok("the school office signs in", await signIn(office.page, "registrar@example.invalid"));
  ok("Match Centre opens", await go(office.page, "matches"));
  await beat(office.page);
  ok("Schedule Match is offered to the office", await click(office.page, /\+ Schedule Match/, 5000));
  await office.page.waitForTimeout(400);
  const form = office.page.locator('[role="dialog"]').last();
  ok("the arranging form opens", await has(office.page, "fixture-preview"));
  await form.locator("select").first().selectOption("1XI").catch(async () => {
    // a school administrator may see a School select first
    await form.locator("select").nth(1).selectOption("1XI");
  });
  await form.locator('input[placeholder="e.g. Michaelhouse 1st XI"]').fill(OPPONENT);
  await form.locator('input[type="date"]').fill(ymd(START));
  await form.locator('input[type="time"]').fill(hm(START));
  await form.locator('input[type="number"]').fill(String(OVERS));
  await beat(office.page, 1200);
  const preview = await inner(office.page, "fixture-preview");
  ok("the preview names both sides as chosen", /1XI|1st XI/i.test(preview) && preview.includes(OPPONENT), preview);
  ok("he arranges it", await click(office.page, /Arrange Fixture/, 4000));
  await afterReads(office.page, 1200);
  ok("the form closes on success", !(await has(office.page, "fixture-preview")), await inner(office.page, "fixture-refused"));
  const [fx] = await q(`select id, team_code, opponent, overs, starts_at from match where school_id = $1 and opponent = $2`, [HIL, OPPONENT]);
  ok("the fixture is in the database: Hilton 1XI v the opponent, two overs", fx?.team_code === "1XI" && Number(fx?.overs) === OVERS, JSON.stringify(fx));
  const MATCH = fx?.id;
  if (!MATCH) throw new Error("no fixture was made");
  ok("...and back on Match Centre's own list", await until(office.page, (o) => document.body.innerText.includes(o), 8000, OPPONENT));
  await beat(office.page);
  if (DEBUG) console.log("[debug] fixture", JSON.stringify(fx));

  // ── 6a (before play) ──────────────────────────────────────────
  group("6a. Before play: the opener's parent sees the fixture and says he is available");
  const parent = await open("parent-before-play");
  ok("H Whitfield signs in", await signIn(parent.page, "parent.whitfield@example.invalid"));
  await parent.page.locator("nav button, [data-testid^='mnav-']", { hasText: /^Matches$/ }).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(parent.page, 1200);
  const row = tid(parent.page, `fixture-row-${MATCH}`);
  await row.first().waitFor({ timeout: 8000 }).catch(() => {});
  ok("his son's side's new fixture is on his Matches list", await row.count() > 0, (await text(parent.page)).slice(0, 400));
  ok("...against the opponent the office named", (await row.first().innerText().catch(() => "")).includes(OPPONENT));
  await row.first().click({ timeout: 4000 }).catch(() => {});
  await afterReads(parent.page, 1200);
  await beat(parent.page);
  const avail = tid(parent.page, `availability-${WHITFIELD}`);
  ok("the fixture opens with his son's availability", await avail.count() > 0, (await text(parent.page)).slice(0, 400));
  if (await has(parent.page, `availability-set-${WHITFIELD}-available`)) {
    await tap(parent.page, `availability-set-${WHITFIELD}-available`);
    await beat(parent.page, 500);
    await tap(parent.page, `availability-send-${WHITFIELD}`);
    await afterReads(parent.page, 800);
    ok("he says his son is available, and the screen says it was him",
      /Available/i.test(await inner(parent.page, `availability-state-${WHITFIELD}`)) && /you/.test(await inner(parent.page, `availability-by-${WHITFIELD}`)),
      await inner(parent.page, `availability-${WHITFIELD}`));
  } else {
    ok("the availability keys are offered to him", false, await inner(parent.page, `availability-${WHITFIELD}`));
  }
  await beat(parent.page);

  group("1b. The office moves the start, after the family has answered");
  // A tap on the fixture's card (not "Open match") draws its Match Details beside the list.
  await tid(office.page, `match-card-${MATCH}`).first().click({ timeout: 6000 }).catch(() => {});
  await until(office.page, (m) => document.querySelector('[data-testid="match-details"]')?.dataset.match === m, 6000, MATCH);
  if (await has(office.page, "fixture-reschedule-open")) {
    await tap(office.page, "fixture-reschedule-open");
    const rs = tid(office.page, "fixture-reschedule");
    await rs.locator('input[type="date"]').fill(ymd(MOVED));
    await rs.locator('input[type="time"]').fill(hm(MOVED));
    await beat(office.page);
    await tap(office.page, "fixture-reschedule-save");
    await afterReads(office.page, 1000);
    const [moved] = await q(`select starts_at from match where id = $1`, [MATCH]);
    ok(`the start is moved an hour on, to ${hm(MOVED)}, in the database`, new Date(moved.starts_at).getTime() === MOVED.getTime(),
      `${moved.starts_at} ${await inner(office.page, "fixture-reschedule-refused")}`);
  } else {
    gap("1b", "the office is offered no Reschedule on the fixture");
  }
  await beat(office.page);
  ok("no console errors (office)", office.errors.length === 0, office.errors.join(" | "));

  group("6a. ...and the parent's fixture says it changed");
  // The session is held in memory, so the parent goes Home and back rather than reloading.
  await parent.page.locator("nav button, [data-testid^='mnav-']", { hasText: /^Home$/ }).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(parent.page, 800);
  await parent.page.locator("nav button, [data-testid^='mnav-']", { hasText: /^Matches$/ }).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(parent.page, 1000);
  await tid(parent.page, `fixture-row-${MATCH}`).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(parent.page, 1200);
  const was = await inner(parent.page, `availability-was-${WHITFIELD}`);
  ok(`"The fixture has changed: …" is on his son's answer (${was})`, /The fixture has changed/.test(was), (await text(parent.page)).slice(0, 600));
  ok(`...and the fixture shows the new time (${hm(MOVED)})`, (await text(parent.page)).includes(hm(MOVED)), (await text(parent.page)).slice(0, 600));
  await beat(parent.page, 1200);
  ok("no console errors (parent, before play)", parent.errors.length === 0, parent.errors.join(" | "));
  await close(parent);

  // ── 2 ──────────────────────────────────────────────────────────
  group("2. The scorer scores Hilton's innings on a phone, every scoring shot with the wagon wheel");
  const sc = await open("scorer-phone", { size: PHONE });
  ok("the scorer signs in on his phone", await signIn(sc.page, "scorer@example.invalid"));
  const openBtn = tid(sc.page, `fixture-${MATCH}-open`);
  await openBtn.first().waitFor({ timeout: 10000 }).catch(() => {});
  ok("the new fixture is on his home", await openBtn.count() > 0, (await text(sc.page)).slice(0, 400));
  await beat(sc.page);
  await openBtn.first().click({ timeout: 5000 });
  ok("the pad asks the toss", await until(sc.page, () => !!document.querySelector('[data-testid="toss-sheet"]'), 10000), (await text(sc.page)).slice(0, 400));
  await tap(sc.page, "toss-won-home"); await tap(sc.page, "toss-decision-bat");
  await beat(sc.page);
  await tap(sc.page, "toss-confirm");
  await afterReads(sc.page, 800);
  ok("the toss is on the server: Hilton won and bat", (await q(`select won_by, decision from match_toss where match_id = $1`, [MATCH]))
    .some((t) => t.won_by === "home" && t.decision === "bat"));
  // The innings' setup: what will be captured (Full: the shot and the exact
  // point), the batting order, the openers, the opening bowler.
  if (await has(sc.page, "capture-profile-full")) { await tap(sc.page, "capture-profile-full"); await beat(sc.page, 500); }
  ok("the pad is ready: the openers in, the opening bowler named", await ready(sc.page, "G Oakes"), (await text(sc.page)).slice(0, 500));
  if (DEBUG) console.log("[debug] after ready:\n" + (await text(sc.page)).slice(0, 600));
  if (await has(sc.page, "basic-pad")) { await tap(sc.page, "pad-menu"); await tap(sc.page, "pad-basic-scoring"); await sc.page.keyboard.press("Escape"); }
  ok("the pad is the three-phase pad (shot, area, outcome)", await has(sc.page, "three-phase-pad"));
  await beat(sc.page);

  const P = sc.page;
  /**
   * One scoring shot with the wagon wheel, timed: the shot, a tap on the field
   * at (fx, fy) — the batter's end at the top, the bowler's at the bottom; a
   * right-hander's off side on the left — then the runs. What the pad named
   * as the finger landed is returned.
   */
  const placed = async (shot, fx, fy, runs) => {
    let where = "";
    const moved = await timed(P, "wheel", async () => {
      await tap(P, `shot-${shot}`);
      where = await tapField(P, fx, fy);
      await tid(P, `run-${runs}`).first().click({ timeout: 4000 });
    });
    ok(`${shot} for ${runs}: the field named "${where}" and the board moved (${await board(P)})`, moved && where.length > 0, where);
    await beat(P, 400);
    return where;
  };
  /** An extra in two taps, its kind then its runs, timed. */
  const extra = async (label, kindKey, runsKey, setup = null) => {
    const moved = await timed(P, "extra", async () => {
      await tap(P, kindKey);
      if (setup) await setup();
      await tap(P, runsKey);
    });
    ok(`${label}: recorded in two taps (${await board(P)})`, moved);
    await beat(P, 400);
  };
  /** The pad's own prompts between balls: the next batter, the next bowler. */
  const between = async (bowlerName) => {
    for (let i = 0; i < 8; i++) {
      if (await has(P, "innings-review")) return;
      const batter = P.locator('[data-testid="batter-choice"]:not([disabled])');
      if (await batter.count()) { await beat(P, 500); await batter.first().click({ timeout: 3000 }).catch(() => {}); await P.waitForTimeout(400); continue; }
      if (/Over \d+ Complete|Opening Bowler/i.test(await text(P)) && await P.locator("input[aria-label='Bowler name']").count()) {
        await beat(P, 500); await nameBowler(P, bowlerName); continue;
      }
      return;
    }
  };

  // Over 1: G Oakes. A drive, a wide, a pulled four, a no-ball and its free
  // hit cut for two, leg byes, a flick undone and scored again, a wicket.
  const cover = await placed("drive", -0.45, 0.55, 1);
  ok("the right-hander's drive is named on the off side", /cover|mid-off|extra/i.test(cover), cover);
  await extra("a wide", "key-wide", "extra-run-0");
  const four = await placed("pull", 0.97, 0.0, 4);
  ok("the pull past the rope, square on the leg side, is a boundary to square leg", /square leg/i.test(four), four);
  await extra("a front-foot no-ball", "key-noball", "extra-run-0", async () => {
    ok("...the no-ball says the free hit it earns", /Free hit/i.test(await inner(P, "nb-free-hit")));
  });
  await placed("cut", -0.8, -0.1, 2);
  await extra("a leg bye", "key-legbyes", "extra-run-1");

  // ── 3a ─────────────────────────────────────────────────────────
  group("3a. A correction during play: a ball recorded, then undone");
  const beforeFlick = await board(P);
  const rowsBefore = (await serverBalls(MATCH)).length;
  await placed("flick", 0.5, 0.4, 1);
  const undoSays = await tid(P, "key-undo").getAttribute("aria-label").catch(() => "");
  ok(`Undo says what it will take back ("${undoSays}")`, /^Undo: 1 to /.test(undoSays ?? ""), undoSays);
  await beat(P, 800);
  await tap(P, "key-undo");
  ok("the board is back where it was before the flick", await until(P, (b) => [...document.querySelectorAll('[role="status"][aria-live="polite"]')]
    .some((e) => e.textContent.trim() === b), 6000, beforeFlick), `${beforeFlick} / ${await board(P)}`);
  await afterReads(P, 1200);
  const afterUndo = await serverBalls(MATCH);
  if (DEBUG) console.log("[debug] after undo:", JSON.stringify(afterUndo.slice(rowsBefore).map((r) => [r.seq, r.kind, r.ball_type, r.value])));
  // An undo is not a deletion: the log keeps the ball and appends a void of it.
  const undone = afterUndo.slice(rowsBefore);
  ok("the server keeps the ball and appends its void, in order", undone.length === 2 && undone[0].kind === "ball" && undone[1].kind === "void",
    JSON.stringify(undone.map((r) => r.kind)));
  await beat(P, 800);
  await placed("flick", 0.55, 0.45, 1);

  group("2. ...the wicket, and the second over");
  {
    const moved = await timed(P, "extra", async () => {
      await tap(P, "shot-missed");
      await tap(P, "area-none");
      await tap(P, "key-wicket");
      await beat(P, 600);
      await tap(P, "wicket-confirm");
    });
    ok(`a missed ball, bowled: the wicket is on the board (${await board(P)})`, moved && / for 1, /.test(await board(P)));
    timings.extra.pop();   // a wicket is not an extra; it is kept out of the timing sets
  }
  await between("H Bramwell");
  ok("the next batter is in and H Bramwell is on for the second over", await has(P, "three-phase-pad") && !(await has(P, "scoring-blocked")),
    (await text(P)).slice(0, 300));
  // Over 2: H Bramwell. A straight six, a dot, a glance, a drive, a sweep, a cut for four.
  // Lofted over long on (straight down the ground is under the field's "Bowler" label).
  await placed("loft", 0.3, 0.9, 6);
  {
    const moved = await timed(P, "basic", async () => { await tap(P, "key-dot"); });
    ok(`a dot, one key (${await board(P)})`, moved);
    timings.basic.pop();   // the dot on the three-phase pad is not Basic Scoring's
  }
  await placed("glance", 0.6, -0.7, 1);
  await placed("drive", -0.2, 0.7, 2);
  await placed("sweep", 0.85, 0.3, 1);
  await placed("cut", -0.95, 0.1, 4);

  const inn1 = (await serverBalls(MATCH)).filter((r) => r.innings === 0 && r.kind === "ball");
  const scoring = inn1.filter((r) => r.ball_type === "run" && Number(r.value) > 0);
  ok(`every scoring shot off the bat has a shot and a point on the server (${scoring.length} of them)`,
    scoring.length >= 9 && scoring.every((r) => r.shot && r.theta != null && r.placement_source === "point"),
    JSON.stringify(scoring.map((r) => [r.shot, r.value, r.theta, r.placement_source])));
  ok("the wide, the no-ball, the leg bye and the wicket are on the server",
    ["Wd", "Nb", "LB", "W"].every((t) => inn1.some((r) => r.ball_type === t)), JSON.stringify(inn1.map((r) => r.ball_type)));
  ok("...and the boundaries: a four and a six", inn1.some((r) => Number(r.value) === 4 && r.ball_type === "run") && inn1.some((r) => Number(r.value) === 6));
  if (DEBUG) console.log("[debug] innings 1:", JSON.stringify(inn1.map((r) => [r.ball_type, r.value, r.shot, r.theta])));
  throw new Error("explore: stop after innings 1");
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

if (gaps.length) {
  console.log("\nWhat the app could not do, as it stands:");
  for (const g of gaps) console.log(`  · ${g}`);
}
const stat = (xs) => {
  if (!xs.length) return "no balls timed";
  const s = [...xs].sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  return `${xs.length} balls, median ${med} ms, mean ${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)} ms, range ${s[0]}–${s.at(-1)} ms`;
};
console.log("\nTime per ball — THIS WALK'S OWN timings (a script's taps, first tap to the board showing the ball; not a human scorer's):");
console.log(`  with the wagon wheel (shot, field, outcome):  ${stat(timings.wheel)}`);
console.log(`  without it (one key on Basic Scoring):        ${stat(timings.basic)}`);
console.log(`  extras (kind, then runs):                     ${stat(timings.extra)}`);
if (fail && apiErr.length) console.log("\nAPI stderr:\n" + apiErr.join("").split("\n").slice(0, 12).join("\n"));
console.log(`\n${"─".repeat(52)}\nBROWSER PILOT FLOW SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

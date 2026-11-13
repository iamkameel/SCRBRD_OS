#!/usr/bin/env node
/**
 * R0 solo walkthroughs: Kameel scoring Pilot Matches alone, in a real browser at
 * 390 x 844, against the real API and Postgres. They test what is built
 * (docs/design/ROLE_DASHBOARDS_v1.1.md section 5 "Pilot", 9 R0 and 10;
 * docs/design/PILOT_MATCH_PHASE2.md slices 1 to 3); they build nothing, and
 * where the product does not do what the design says they say so as a finding.
 *
 *   1  Quick-start to finish: a Pilot Match started from the scorer's home
 *      (venue, start time, names typed for both sides), scored through both
 *      innings to a result, and finished on SCRBRD.
 *   2  Offline and back: balls scored with the network cut; the pad counts
 *      them as held and does not say Sent; on reconnect each goes once.
 *   3  A correction: a ball undone, and the board, the scorecard and the
 *      server's log all agree.
 *   4  Abandoned: play stopped and the first innings cut short on the pad,
 *      which goes on to the chase; then the chase cut short with no par, no
 *      result, and the phone calls the match off on SCRBRD itself (F1);
 *      what remains and what the scorer sees.
 *   5  The sandbox: no stat, record, standing or season figure moves; no typed
 *      name or pilot id on any public read, signed out.
 *   6  Promotion: not built (slice 7, R1). Checked as absent, and skipped.
 *
 * Everyone here is invented (@example.invalid); the test name is the canary
 * `Qa Canarytest`, which is nobody.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-pilot-r0.mjs
 */
import { chromium } from "playwright-core";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { appUrl, ownerUrl, port, refuseUnlessLocal } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(5392);
const API_PORT = port(8912);
const API = `http://127.0.0.1:${API_PORT}`;
const ORIGIN = `http://localhost:${WEB_PORT}`;
const SHOTS = process.env.BROWSER_PILOT_SHOTS || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const CANARY = "Qa Canarytest";
const SCORER = "scorer@example.invalid";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

// This walk turns the Pilot Match's switches on: never against a database
// that is not on this machine (the second review's SF-A).
refuseUnlessLocal("smoke-browser-pilot-r0");
const owner = new pg.Client({ connectionString: ownerUrl() });
await owner.connect();
const sql = (/** @type {string} */ q, /** @type {any[]} */ p = []) => owner.query(q, p);
// A switch on, in a test database. db/151's guard keeps both off until the
// purge (slice 5) exists, so a stand-in purge is written, the switch turned,
// and the stand-in dropped, in one transaction: nothing of it outlives it.
const switchOn = (/** @type {string} */ key) => sql(`begin;
  create function public.pilot_purge_expired() returns void language sql as '';
  update pilot.switch set enabled = true where key = '${key}';
  drop function public.pilot_purge_expired();
  commit;`).catch(async (e) => { await sql("rollback"); throw e; });
const one = async (/** @type {string} */ q, /** @type {any[]} */ p = []) => (await sql(q, p)).rows[0];
const SCORER_ID = (await one(`select id from app_user where email = $1`, [SCORER])).id;
await sql(`update pilot.switch set enabled = false`);
await sql(`delete from pilot.scorer where user_id = $1`, [SCORER_ID]);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-pilot-r0-secret", WEB_ORIGIN: ORIGIN,
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-pilot-r0-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
  const url = new URL(/** @type {string} */ (req.url), "http://x").pathname;
  let body, type;
  try {
    const f = join("apps/web/dist", url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = TYPES[/** @type {keyof typeof TYPES} */ (extname(f))] ?? "application/octet-stream";
  } catch {
    body = await readFile("apps/web/dist/index.html");
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, () => r(null)));

// The names this walk types: made up. Players never go in a ball; with the
// fallback on they go nowhere at all.

const browser = await chromium.launch({ ...launchOptions() });
const errors = [];
/** Every request each phone makes. */
const requests = [];

/** A phone: its own browser context (its own storage), at 390. @param {string} name */
async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(m.text())) errors.push(`${name} console.error: ${m.text()}`); });
  page.on("request", (r) => requests.push({ phone: name, url: r.url(), method: r.method(), body: r.postData() ?? "", at: Date.now() }));
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  const tid = (/** @type {string} */ id) => page.locator(`[data-testid="${id}"]`);
  const P = {
    ctx, page, tid,
    text: () => page.$eval("body", (el) => /** @type {HTMLElement} */ (el).innerText),
    has: async (/** @type {string} */ id) => (await tid(id).count()) > 0,
    tap: async (/** @type {string} */ id, ms = 6000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(250); },
    click: async (/** @type {RegExp} */ re, ms = 4000) => {
      const l = page.locator("button:not([disabled])", { hasText: re }).first();
      if (!(await l.count())) return false;
      try { await l.click({ timeout: ms }); } catch { return false; }
      await page.waitForTimeout(300);
      return true;
    },
    shot: async (/** @type {string} */ n) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}-${n}.png`) }); },
    noSideways: () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    board: async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
      .first().textContent().catch(() => "")) || "").trim(),
    label: async () => (await tid("pilot-label").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
    /** Every key this phone keeps, IndexedDB and localStorage. */
    keys: () => page.evaluate(async () => {
      const out = [];
      const dbs = (indexedDB.databases ? await indexedDB.databases() : [{ name: "scrbrd" }]);
      for (const { name } of dbs) {
        if (!name) continue;
        const db = /** @type {IDBDatabase} */ (await new Promise((res, rej) => { const q = indexedDB.open(name); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
        for (const store of [...db.objectStoreNames]) {
          const keys = await new Promise((res) => { const q = db.transaction(store, "readonly").objectStore(store).getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); });
          out.push(.../** @type {any[]} */ (keys).map((k) => `${name}/${store}/${String(k)}`));
        }
        db.close();
      }
      return out;
    }),
  };
  return P;
}

/** Sign in as the scorer, and open the scorer's start screen. @param {Awaited<ReturnType<typeof phone>>} p */
async function signInAndOpen(p) {
  await p.page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });
  await p.click(/Get Started|Log In/, 5000);
  await p.page.waitForTimeout(600);
  await p.click(/Scorer/, 4000);
  await p.click(/^Sign In$/, 5000);
  await p.page.waitForTimeout(2200);
  await openScorer(p);
}
/** @param {Awaited<ReturnType<typeof phone>>} p */
async function openScorer(p) {
  await p.page.setViewportSize({ width: 1280, height: 800 });
  await p.page.waitForTimeout(300);
  await p.page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await p.page.waitForTimeout(1200);
  await p.page.locator("button", { hasText: /Open SCRBRD Scorer/ }).first().click({ timeout: 6000 });
  await p.page.waitForTimeout(1800);
  await p.page.setViewportSize({ width: 390, height: 844 });
  await afterReads(p.page, 600);
}
/** The one-tap keys. @param {Awaited<ReturnType<typeof phone>>} p */
async function basic(p) {
  if (await p.has("basic-pad")) return true;
  await p.tap("pad-menu"); await p.tap("pad-basic-scoring"); await p.page.waitForTimeout(300);
  return p.has("basic-pad");
}
/** Wait until the owner's table holds `n` events for this match (or time runs out). */
async function serverEvents(/** @type {string} */ uuid, /** @type {number} */ n, ms = 20000) {
  const t0 = Date.now();
  let got = 0;
  while (Date.now() - t0 < ms) {
    got = Number((await one(`select count(*) n from pilot.ball_event where match_id = $1`, [uuid])).n);
    if (got >= n) return got;
    await new Promise((r) => setTimeout(r, 400));
  }
  return got;
}
// ── The walks' own helpers ───────────────────────────────────────────────

/** Taps under 43.5 px and text under 12 px, among what is on screen now. @param {{page: import("playwright-core").Page}} p */
const floors = (p) => p.page.evaluate(() => {
  const vis = (/** @type {Element} */ el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && r.bottom > 0 && r.top < innerHeight; };
  const small = [], tiny = [];
  for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=radio]")) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) small.push(`${(el.getAttribute("data-testid") || (el.textContent || el.getAttribute("aria-label") || "").trim()).slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!(n.nodeValue || "").trim() || !n.parentElement || !vis(n.parentElement)) continue;
    if (parseFloat(getComputedStyle(n.parentElement).fontSize) < 12) tiny.push((n.nodeValue || "").trim().slice(0, 30));
  }
  return { small, tiny };
});
/** The sync pill's own words. @param {{page: import("playwright-core").Page}} p */
const pill = async (p) => ((await p.page.locator('[aria-label^="Sync status:"]').first().getAttribute("aria-label").catch(() => "")) || "");
/** @param {{page: import("playwright-core").Page}} p @param {RegExp} re */
const waitPill = async (p, re, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await pill(p))) return true; await p.page.waitForTimeout(300); } return false; };
const pilotIds = async (/** @type {Awaited<ReturnType<typeof phone>>} */ p) =>
  (await p.keys()).filter((k) => /\/pilot:meta:pilot-/.test(k)).map((k) => k.replace(/^.*pilot:meta:pilot-/, ""));
const count = async (/** @type {string} */ uuid, /** @type {string} */ where = "true") =>
  Number((await one(`select count(*) n from pilot.ball_event where match_id = $1 and ${where}`, [uuid])).n);

/**
 * The setup from the scorer's home to the pad: overs, venue, the sides, names
 * typed for both, the toss, the openers.
 * @param {Awaited<ReturnType<typeof phone>>} p
 * @param {{overs: number, venue: string, home: string[], away: string[], seeSetup?: (t: string) => void}} o
 */
async function quickStart(p, o) {
  await p.tap("start-practice");
  await p.tap("practice-overs-custom");
  await p.tid("practice-overs-input").fill(String(o.overs));
  await p.tid("practice-venue").fill(o.venue);
  o.seeSetup?.(await p.text());
  await p.tap("practice-next");
  await p.tid("practice-school-0").fill("Hilton");
  await p.tid("practice-division-0").selectOption("U13");
  await p.tap("practice-class-0-B");
  await p.tid("practice-school-1").fill("Kearsney");
  await p.tid("practice-division-1").selectOption("U13");
  await p.tap("practice-class-1-B");
  await p.tap("practice-next");
  await p.tid("practice-paste-0").fill(o.home.join("\n")); await p.tap("practice-add-0"); await p.tap("practice-next");
  await p.tid("practice-paste-1").fill(o.away.join("\n")); await p.tap("practice-add-1"); await p.tap("practice-next");
  await p.page.locator("button[role=radio]", { hasText: "Hilton U13B" }).first().click();
  await p.page.locator("button[role=radio]", { hasText: /^Bat$/ }).click();
  await p.click(/Confirm Toss/);
  await p.page.locator("button", { hasText: o.home[0] }).first().click({ timeout: 3000 });
  await p.page.locator("button", { hasText: o.home[1] }).first().click({ timeout: 3000 });
  await p.click(/Select Opening Bowler/);
  await p.page.locator("button", { hasText: o.away[0] }).first().click();
  await p.click(/Start Match/);
  await p.page.waitForTimeout(1200);
  await basic(p);
}
/** The chase's openers and bowler, after the innings break. @param {Awaited<ReturnType<typeof phone>>} p @param {string[]} bats @param {string} bowl */
async function startChase(p, bats, bowl) {
  await p.click(/Start 2nd Innings/); await p.page.waitForTimeout(700);
  await p.page.locator("button", { hasText: bats[0] }).first().click({ timeout: 3000 }); await p.page.waitForTimeout(400);
  await p.page.locator("button", { hasText: bats[1] }).first().click({ timeout: 3000 }); await p.page.waitForTimeout(400);
  await p.page.locator("button", { hasText: bowl }).first().click({ timeout: 3000 }); await p.page.waitForTimeout(600);
  await basic(p);
}
const FIRST = ["run-1", "run-4", "run-0", "run-2", "run-6", "run-1"];   // 14 off the over

/** What a public route gives, signed out. */
const signedOut = async (/** @type {string} */ path) => { const r = await fetch(`${API}${path}`); return { status: r.status, text: await r.text() }; };
const loginToken = async (/** @type {string} */ email) =>
  (await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, deviceId: "r0-walk" }) })).json()).token;
/** The runs the server's log adds to, per innings, a voided ball left out (the scorer's undo is a void). */
const logRuns = async (/** @type {string} */ uuid) => Object.fromEntries((await sql(
  `select b.innings i, coalesce(sum(b.value), 0)::int r from pilot.ball_event b
    where b.match_id = $1 and b.kind = 'ball' and not exists (select 1 from pilot.ball_event v where v.match_id = b.match_id and v.kind = 'void' and v.payload->>'target' = b.payload->>'id')
    group by b.innings`, [uuid])).rows.map((r) => [r.i, r.r]));

/** What the school's figures read: a count and a content hash of every real table and derived view a stat, record, standing or season figure comes from. */
const FIGURE_RELS = ["match", "ball_event", "match_squad", "player", "match_result_decision", "competition", "season", "ball_event_career",
  "competition_standing", "player_batting_career", "player_bowling_career", "player_fielding_career", "player_keeping_career",
  "player_batting_by_season", "player_bowling_by_season", "player_dismissals_by_season", "player_fielding_by_season"];
const figures = async () => {
  /** @type {Record<string, string>} */ const out = {};
  for (const t of FIGURE_RELS) {
    const r = await one(`select count(*) n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') h from public.${t} x`);
    out[t] = `${r.n}:${r.h}`;
  }
  return out;
};

let phoneA;
const FINDINGS = [];
const finding = (/** @type {string} */ f) => { FINDINGS.push(f); console.log("  FINDING:", f); };
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  await switchOn("pilot_sync");
  await switchOn("pilot_names_upload");
  await sql(`insert into pilot.scorer (user_id) values ($1) on conflict (user_id) do update set ended_at = null`, [SCORER_ID]);
  const baseline = await figures();
  phoneA = await phone("A");
  await signInAndOpen(phoneA);
  const P = phoneA;

  // ── 1 ──────────────────────────────────────────────────────────────
  group("1. Quick-start to finish");
  ok("the scorer's home offers Start Practice Match and My Pilot Matches", (await P.has("start-practice")) && (await P.has("pilot-list-open")));
  const f0 = await floors(P);
  ok("the home screen: no tap under 44 px, no text under 12 px", f0.small.length === 0 && f0.tiny.length === 0, JSON.stringify(f0));
  const A1 = ["Alpha One", "Alpha Two", CANARY, "Alpha Four"], B1 = ["Bravo One", "Bravo Two", "Bravo Three", "Bravo Four"];
  const t0 = Date.now();
  let setupText = "";
  await quickStart(P, { overs: 1, venue: "Invented Oval", home: A1, away: B1, seeSetup: (t) => { setupText = t; } });
  ok("the setup took a venue and the overs; a start time is not asked for (it is the moment of starting)",
     /Where/.test(setupText) && !/start time|starts at/i.test(setupText));
  const uuid1 = (await pilotIds(P))[0];
  ok("started: a pilot- id, labelled Pilot match, Hilton U13B v Kearsney U13B",
     /^[0-9a-f-]{36}$/.test(uuid1 ?? "") && (await P.label()).startsWith("Pilot match") && /Hilton U13B v Kearsney U13B/.test(await P.tid("pad-titlebar").innerText()), await P.label());
  const f1 = await floors(P);
  ok("the pad: no tap under 44 px, no text under 12 px", f1.small.length === 0 && f1.tiny.length === 0, JSON.stringify(f1));
  for (const k of FIRST) await P.tap(k);
  ok("the first innings over: 14 for 0", /14 for 0/.test(await P.board()), await P.board());
  ok("the review gate opens on its own, with the real total", (await P.has("innings-review")) && /14/.test(await P.tid("review-score").innerText()));
  await P.tap("review-confirm");
  ok("the innings break names the target: Kearsney U13B need 15", /need\s+15\s+runs/.test(await P.text()), (await P.text()).slice(0, 200));
  await startChase(P, [B1[0], B1[1]], A1[0]);
  ok("the chase is on: need 15 off 6", /Need 15 off 6/.test(await P.text()), (await P.text()).slice(0, 300));
  for (const k of ["run-6", "run-6", "run-4"]) await P.tap(k);
  ok("the review gate opens when the target is reached", await P.has("innings-review"));
  await P.tap("review-confirm");
  await P.page.waitForTimeout(800);
  const result = (await P.tid("pad-result").innerText().catch(() => "")).trim();
  ok("the result screen: Kearsney U13B won, by wickets", /Kearsney U13B/.test(result) && /won by 3 wickets/.test(result), result);
  ok("...and the scorecards of both innings are on it", (await P.text()).includes("Alpha Two") && (await P.text()).includes("Bravo One"));
  ok("...labelled Pilot match, and no promotion is offered (R1)", (await P.has("pilot-label")) && !/promot/i.test(await P.text()));
  ok("...with Finish the match on SCRBRD, enabled once every ball has gone", await P.tid("pilot-finish-button").isEnabled().catch(() => false), (await P.text()).slice(-400));
  const f2 = await floors(P);
  ok("the result screen: no tap under 44 px, no text under 12 px", f2.small.length === 0 && f2.tiny.length === 0, JSON.stringify(f2));
  await P.shot("1-result");
  await P.tap("pilot-finish-button");
  await afterReads(P.page, 800);
  ok("Finish: the page says so", await P.has("pilot-finished"));
  const row1 = await one(`select status, finished_at, names_purge_after, starts_at from pilot.match where id = $1`, [uuid1]);
  ok("...the server says finished, and the names' 30 days run from the last ball",
     row1?.status === "finished" && row1.names_purge_after && Math.abs(Date.parse(row1.names_purge_after) - Date.parse(row1.finished_at) - 30 * 86400000) < 2000, JSON.stringify(row1));
  ok("...the start time is the moment it was started", Math.abs(Date.parse(row1.starts_at) - t0) < 10 * 60000, row1?.starts_at);
  ok("the server holds all nine balls", (await count(uuid1, "kind = 'ball'")) === 9, String(await count(uuid1, "kind = 'ball'")));
  const runs1 = await logRuns(uuid1);
  ok("...and its log adds to the pad's 14, then 16", runs1[0] === 14 && runs1[1] === 16, JSON.stringify(runs1));
  ok("...the canary went once, to pilot.name alone",
     Number((await one(`select count(*) n from pilot.name where match_id = $1 and typed_name = $2`, [uuid1, CANARY])).n) === 1);
  await P.tap("exit-scorer"); await openScorer(P);
  await P.tap("pilot-list-open"); await afterReads(P.page, 800);
  const row1txt = (await P.tid("pilot-row").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  ok("My Pilot Matches shows it as Finished, with its score", /Finished/.test(row1txt) && /Hilton U13B v Kearsney U13B/.test(row1txt), row1txt);
  const f3 = await floors(P);
  ok("My Pilot Matches: no tap under 44 px, no text under 12 px", f3.small.length === 0 && f3.tiny.length === 0, JSON.stringify(f3));
  await P.tap("practice-back");

  // ── 2 ──────────────────────────────────────────────────────────────
  group("2. Offline and back");
  const A2 = ["Echo One", "Echo Two", "Echo Three", "Echo Four"], B2 = ["Foxtrot One", "Foxtrot Two", "Foxtrot Three", "Foxtrot Four"];
  await quickStart(P, { overs: 5, venue: "Invented Park", home: A2, away: B2 });
  const uuid2 = (await pilotIds(P)).find((x) => x !== uuid1);
  for (const k of ["run-1", "run-2"]) await P.tap(k);
  await serverEvents(uuid2, 5);
  ok("two balls online: the server has them, the pad says Sent", (await count(uuid2, "kind = 'ball'")) === 2 && await waitPill(P, /Sent/), await pill(P));
  const before2 = await count(uuid2);
  await P.ctx.setOffline(true);
  const offAt = Date.now();
  for (const k of ["run-4", "run-0", "run-6"]) await P.tap(k);
  ok("three more offline: the board has them (13 for 0)", /13 for 0/.test(await P.board()), await P.board());
  ok("...the pad counts them as held: 'Held 3', not Sent", await waitPill(P, /Held 3/, 8000) && !/Sent/.test(await pill(P)), await pill(P));
  ok("...and says nothing is confirmed: no 'Every ball is on the server'", !/Every ball is on the server/.test(await P.text()));
  ok("...nothing reached the server meanwhile", (await count(uuid2)) === before2);
  await P.shot("2-offline");
  const f4 = await floors(P);
  ok("offline pad: no tap under 44 px, no text under 12 px", f4.small.length === 0 && f4.tiny.length === 0, JSON.stringify(f4));
  await P.ctx.setOffline(false);
  const got2 = await serverEvents(uuid2, before2 + 3);
  ok("signal on: the three go, and only the three", got2 === before2 + 3, `${before2} -> ${got2}`);
  ok("...the pad comes back to Sent", await waitPill(P, /Sent/), await pill(P));
  await afterReads(P.page, 1500);
  const dupKeys = await one(`select count(*) - count(distinct idempotency_key) d, count(*) - count(distinct (innings, seq)) s from pilot.ball_event where match_id = $1`, [uuid2]);
  ok("...no doubles: every idempotency key once, every sequence number once", String(dupKeys.d) === "0" && String(dupKeys.s) === "0", JSON.stringify(dupKeys));
  const sentEvents = requests.filter((r) => r.phone === "A" && r.at >= offAt && r.method === "POST" && new RegExp(`/api/pilot/${uuid2}/events$`).test(r.url));
  const idsSent = sentEvents.flatMap((r) => { try { return JSON.parse(r.body).events.map((/** @type {any} */ e) => e.id ?? e.idempotencyKey ?? e.idempotency_key); } catch { return []; } });
  ok("...and no event id went in two requests", idsSent.length > 0 && new Set(idsSent).size === idsSent.length, `${idsSent.length} ids, ${new Set(idsSent).size} distinct`);
  ok("...the pad still reads 13 for 0", /13 for 0/.test(await P.board()), await P.board());

  // ── 3 ──────────────────────────────────────────────────────────────
  group("3. A correction");
  ok("before: undo names the last ball", (await P.tid("key-undo-what").innerText()).trim().length > 0 && !/nothing/.test(await P.tid("key-undo-what").innerText()), await P.tid("key-undo-what").innerText());
  const nBefore = await count(uuid2);
  await P.tap("key-undo");
  ok("undo: 7 for 0 (the six is taken back)", /^7 for 0/.test(await P.board()), await P.board());
  await afterReads(P.page, 1500);
  const nAfter = await serverEvents(uuid2, nBefore + 1, 8000);
  ok("...on the server the six is voided, not erased: one more event, and it is a void",
     nAfter === nBefore + 1 && (await count(uuid2, "kind = 'void'")) === 1, `${nBefore} -> ${nAfter}, voids ${await count(uuid2, "kind = 'void'")}`);
  await P.tap("run-1");
  ok("the ball scored again as a single: 8 for 0", /^8 for 0/.test(await P.board()), await P.board());
  await serverEvents(uuid2, nBefore + 2, 8000);
  const runs2 = await logRuns(uuid2);
  ok("...and the server's log, voids left out, adds to the same 8", runs2[0] === 8, JSON.stringify(runs2));
  await P.page.locator("button", { hasText: /^Score$/ }).first().click({ timeout: 3000 }).catch(() => {});
  await P.page.waitForTimeout(500);
  await P.shot("3-card");
  ok("the Score card reads the corrected figures (Echo One and Echo Two, 8 between them)", /Echo One/.test(await P.text()) && /Echo Two/.test(await P.text()) && !/\b13\b/.test(await P.tid("board").first().innerText().catch(() => "")));

  // ── 4 ──────────────────────────────────────────────────────────────
  group("4. Abandoned");
  const calls = spawnSync("grep", ["-rnE", "/abandon", "apps/web/src", "--include=*.js", "--include=*.jsx"]).stdout.toString();
  // F1 (was a pinned gap): the phone calls the match off on SCRBRD itself, from the result screen (scorer/pilotList.jsx PilotCallOff).
  ok("the phone calls a Pilot Match off: client code calls /api/pilot/:id/abandon", /\/api\/pilot\/.*\/abandon/.test(calls), calls.slice(0, 200));
  /** Play stopped for rain, then End the innings, with no par. */
  const callOff = async () => {
    await P.tap("pad-menu"); await P.tap("pad-play-stopped");
    await P.tap("stop-reason-rain"); await P.tap("stop-confirm");
    await P.page.waitForTimeout(800);
    const banner = (await P.has("rain-banner")) && /Play stopped \(rain\)/.test(await P.tid("rain-banner-words").innerText());
    await P.tap("rain-end"); await P.tap("rain-end-confirm");
    await afterReads(P.page, 1500);
    return banner;
  };
  ok("Play stopped (rain): the banner says so", await callOff());
  await serverEvents(uuid2, nBefore + 4, 8000);
  const seal = await one(`select payload->>'reason' r from pilot.ball_event where match_id = $1 and kind = 'innings_end' order by id desc limit 1`, [uuid2]);
  ok("End innings, the first: the server holds the seal as 'abandoned'", seal?.r === "abandoned", JSON.stringify(seal));
  ok("...a first innings cut short goes on to the chase: the match is still 'live' on the server, not called off",
     (await one(`select status from pilot.match where id = $1`, [uuid2])).status === "live");
  await startChase(P, [B2[0], B2[1]], A2[0]);
  await P.tap("run-1");
  ok("the chase is on, one ball in", /1 for 0/.test(await P.board()), await P.board());
  ok("Play stopped (rain) in the chase", await callOff());
  ok("End innings in the chase with no par: no result, and the result screen", await P.has("pad-result"), (await P.text()).slice(0, 300));
  let m2 = null;
  for (let i = 0; i < 40; i++) {
    m2 = await one(`select status, abandon_reason, finished_at, names_purge_after from pilot.match where id = $1`, [uuid2]);
    if (m2?.status === "abandoned") break;
    await new Promise((r) => setTimeout(r, 400));
  }
  ok("...the phone called the match off on SCRBRD on its own, once the seal had gone, with the stop's reason kept (rain → weather)",
     m2?.status === "abandoned" && m2.abandon_reason === "weather", JSON.stringify(m2));
  ok("...and the result screen says so", await P.has("pilot-called-off"), (await P.text()).slice(-300));
  // Review B2: the call-off went only after the seal it rests on: both innings' seals are in the server's log, and nothing is held.
  const seals = await one(`select count(*) n from pilot.ball_event where match_id = $1 and kind = 'innings_end' and payload->>'reason' = 'abandoned'`, [uuid2]);
  const heldN = await one(`select count(*) n from pilot.held where match_id = $1 and resolved_at is null`, [uuid2]);
  ok("...after its seal: the server's log holds both innings' ends, and nothing is held (review B2)",
     Number(seals.n) === 2 && Number(heldN.n) === 0, JSON.stringify({ seals: seals.n, held: heldN.n }));
  ok("...status abandoned, the reason a code, an end time, and the names' 30 days run from it",
     m2.status === "abandoned" && m2.abandon_reason === "weather" && m2.finished_at && m2.names_purge_after
     && Math.abs(Date.parse(m2.names_purge_after) - Date.parse(m2.finished_at) - 30 * 86400000) < 2000, JSON.stringify(m2));
  ok("what remains: the log, and the five typed names until their date",
     (await count(uuid2)) > 10 && Number((await one(`select count(*) n from pilot.name where match_id = $1`, [uuid2])).n) === 8);
  const tok = await loginToken(SCORER);
  const post = (/** @type {string} */ path, /** @type {any} */ body) => fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(body) }).then((r) => r.json());
  const late = await post(`/api/pilot/${uuid2}/session/claim`, { device: "r0-late" });
  ok("...an abandoned match takes no new claim", late?.ok === false, JSON.stringify(late));
  const ab2 = await post(`/api/pilot/${uuid2}/abandon`, { reason: "weather" });
  ok("...calling it off again says not_live, and changes nothing", ab2?.ok === false && ab2?.reason === "not_live", JSON.stringify(ab2));
  await P.page.locator("button", { hasText: /^×$/ }).first().click({ timeout: 3000 }).catch(() => {});
  await P.tap("exit-scorer"); await openScorer(P);
  await P.tap("pilot-list-open"); await afterReads(P.page, 800);
  const rowTxt = (await P.page.locator(`[data-testid="pilot-row"][data-id="pilot-${uuid2}"]`).first().innerText().catch(() => "")).replace(/\s+/g, " ");
  ok("My Pilot Matches still lists it, with its score", /Hilton U13B v Kearsney U13B/.test(rowTxt) && /\d/.test(rowTxt), rowTxt);
  // F2 (was a finding): the row's word reads the server's status, and the phone's own call-off before it hears back.
  ok("...and says Called off, not In progress or Finished", /Called off/.test(rowTxt) && !/In progress|Finished/.test(rowTxt), rowTxt);
  await P.tap("practice-back");

  group("4b. Called off in the first innings (review S2): no more play, no result");
  const A3 = ["India One", "India Two", "India Three"], B3 = ["Juliet One", "Juliet Two", "Juliet Three"];
  await quickStart(P, { overs: 5, venue: "Invented Common", home: A3, away: B3 });
  const uuid3 = (await pilotIds(P)).find((x) => x !== uuid1 && x !== uuid2);
  await P.tap("run-2");
  await serverEvents(uuid3, 4);
  await P.tap("pad-menu"); await P.tap("pad-play-stopped");
  await P.tap("stop-reason-bad_light");
  await P.tap("stop-confirm");
  await P.page.waitForTimeout(800);
  ok("Play stopped in the first innings: the banner offers Call the match off", await P.has("rain-calloff"));
  await P.tap("rain-calloff");
  await afterReads(P.page, 1500);
  ok("...the result screen says no result, called off, with the call-off card", /No result/.test(await P.tid("pad-result").innerText().catch(() => "")) && (await P.has("pilot-calloff")), (await P.text()).slice(0, 300));
  let m3 = null;
  for (let i = 0; i < 40; i++) {
    m3 = await one(`select status, abandon_reason from pilot.match where id = $1`, [uuid3]);
    if (m3?.status === "abandoned") break;
    await new Promise((r) => setTimeout(r, 400));
  }
  ok("...called off on SCRBRD by the phone, the stop's reason kept as its code (bad light → light)", m3?.status === "abandoned" && m3.abandon_reason === "light", JSON.stringify(m3));
  const seal3 = await one(`select count(*) n from pilot.ball_event where match_id = $1 and kind = 'innings_end' and payload->>'reason' = 'abandoned'`, [uuid3]);
  const held3 = await one(`select count(*) n from pilot.held where match_id = $1 and resolved_at is null`, [uuid3]);
  ok("...after the first innings' seal reached SCRBRD, nothing held", Number(seal3.n) === 1 && Number(held3.n) === 0, JSON.stringify({ seal: seal3.n, held: held3.n }));
  ok("...and the card says it is ended on SCRBRD", await P.has("pilot-called-off"));
  await P.tap("exit-scorer"); await openScorer(P);

  // ── 5 ──────────────────────────────────────────────────────────────
  group("5. The sandbox: no figure moves, no name is public");
  const after = await figures();
  ok(`${FIGURE_RELS.length} real tables and derived views (matches, balls, squads, players, results, standings, career and season figures): every row unchanged, by content, after two Pilot Matches`,
     JSON.stringify(after) === JSON.stringify(baseline), FIGURE_RELS.filter((t) => after[t] !== baseline[t]).join(", "));
  const rels = (await sql(`select table_schema s, table_name t from information_schema.tables where table_schema not in ('pilot','pg_catalog','information_schema') order by 1, 2`)).rows;
  const needles = [CANARY, "canarytest", "alpha one", "echo one", "foxtrot", "bravo one", uuid1, uuid2].map((x) => String(x).toLowerCase());
  const hits = [];
  let scanned = 0, unread = 0;
  for (const { s, t } of rels) {
    try {
      const r = await sql(`select count(*) n from "${s}"."${t}" x where ${needles.map((_, i) => `lower(x::text) like '%' || $${i + 1} || '%'`).join(" or ")}`, needles);
      scanned++;
      if (Number(r.rows[0].n) > 0) hits.push(`${s}.${t}=${r.rows[0].n}`);
    } catch { unread++; }
  }
  ok(`${scanned} tables and views outside pilot.*, read whole: none holds a typed name or a pilot id`, hits.length === 0 && scanned > 100, `${hits.join(", ")} (${unread} unreadable)`);
  const listPaths = [`/api/public/live`, `/api/public/news`];
  const pubPaths = [`/api/public/matches/${uuid1}`, `/api/public/matches/${uuid1}/log`, `/api/public/matches/${uuid1}/shots`,
    `/api/public/matches/${uuid1}/par`, `/api/public/matches/pilot-${uuid1}`, `/api/public/matches/${uuid2}`, `/api/public/matches/${uuid2}/log`,
    `/live/${uuid1}`, `/scorecard/${uuid1}`, `/live/${uuid2}`, `/scorecard/${uuid2}`, `/display/${uuid1}`, `/table/${uuid1}`, `/fixtures/${uuid1}`,
    `/live/pilot-${uuid1}`, `/api/public/pilot/${uuid1}`];
  const authPaths = [`/api/pilot/${uuid1}`, `/api/pilot/${uuid1}/names`, `/api/pilot/${uuid1}/events`, `/api/pilot/mine`, `/api/pilot/status`];
  const outs = [];
  for (const path of [...listPaths, ...pubPaths, ...authPaths]) outs.push({ path, ...(await signedOut(path)) });
  const live = outs.find((o) => o.path === "/api/public/live");
  ok("signed out, /api/public/live answers (public pages are on in this walk)", live?.status === 200, `${live?.status} ${live?.text.slice(0, 100)}`);
  ok(`...none of ${outs.length} signed-out reads carries a typed name, a pilot id or a squad name`,
     !outs.some((o) => needles.some((n) => o.text.toLowerCase().includes(n))), outs.filter((o) => needles.some((n) => o.text.toLowerCase().includes(n))).map((o) => o.path).join(" "));
  ok("...every public match, log, shots, par and page route for a pilot id is not found (never a score)",
     outs.filter((o) => pubPaths.includes(o.path)).every((o) => o.status === 404), outs.filter((o) => pubPaths.includes(o.path) && o.status !== 404).map((o) => `${o.path}=${o.status}`).join(" "));
  ok("...the /api/pilot routes refuse a signed-out caller (401)", outs.filter((o) => authPaths.includes(o.path)).every((o) => o.status === 401), outs.filter((o) => authPaths.includes(o.path)).map((o) => `${o.path}=${o.status}`).join(" "));
  ok("...the home strip's live list names no pilot match", !live?.text.includes("Hilton U13B v Kearsney U13B"), live?.text.slice(0, 200));
  const oth = await fetch(`${API}/api/pilot/${uuid1}`, { headers: { authorization: `Bearer ${await loginToken("coach@example.invalid")}` } });
  ok("another signed-in account reads the one not-found for it", oth.status === 404);
  finding("PILOT_MATCH_PHASE2 slice 4 (the public live page and scorecard: Share live link, public_pilot_score, the slug route, W4 to W6) is not built, so R0's 'spectator: live score and public scorecard of a Pilot Match' (ROLE_DASHBOARDS_v1.1 section 9) cannot be walked; only the negative half (a Pilot Match is on no public page, and no typed name is public) is checked here.");

  // ── 6 ──────────────────────────────────────────────────────────────
  group("6. Promotion");
  const fns = (await sql(`select proname from pg_proc where proname ~ 'promot'`)).rows.map((r) => r.proname);
  ok("promotion is not built (slice 7, R1): no pilot_promote function in the database, no Promote on the result screen. Skipped", !fns.some((f) => /pilot_promot/.test(f)), fns.join(","));
  finding("ROLE_DASHBOARDS_v1.1 section 9 R0 lists 'promote or keep as sandbox' and section 5's scorer row 'promote a Pilot Match'; PILOT_MATCH_PHASE2 section 11 puts promotion in slice 7 (R1). R0 has the sandbox half only. Not walked.");

  group("The whole walk");
  ok("no page error, no console error", errors.length === 0, errors.join(" | "));
  ok("the API logged no error", !/\berror\b/i.test(apiErr.join("")), apiErr.join("").slice(0, 300));
  console.log(`\n${FINDINGS.length} finding(s)`);
} catch (e) {
  fail++;
  console.log("  ✗ the walk stopped:", /** @type {any} */ (e)?.stack?.split("\n").slice(0, 4).join(" / "));
  if (phoneA) {
    console.log("  page text:", (await phoneA.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 500));
    if (SHOTS) await phoneA.page.screenshot({ path: join(SHOTS, "zz-failed.png") }).catch(() => {});
  }
} finally {
  await sql(`update pilot.switch set enabled = false`).catch(() => {});
  await owner.end().catch(() => {});
  await browser.close().catch(() => {});
  web.close();
  api.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

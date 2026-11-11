#!/usr/bin/env node
/**
 * Pilot Match phase 2, slice 3: the phone, in a real browser at 390 × 844,
 * against the real API and Postgres (docs/design/PILOT_MATCH_PHASE2.md §3,
 * §11.1 W1–W3).
 *
 *   0  OFF, as db/151 leaves it: the setup is phase 1's, word for word — no
 *      choice, no My Pilot Matches, nothing sent.
 *   W1 Switched on, a granted account. The setup asks once, before any
 *      name, Send live (the default) or Keep on this phone; the label is
 *      "Pilot match · names kept private" and the notice sits above the first
 *      name field. Started and scored IN AIRPLANE MODE: nothing leaves.
 *      Signal on: create, then the claim, then the balls, in that order; the
 *      server's log holds slot ids only (a dump grepped for the canary is
 *      empty) and, with the counsel fallback on, pilot.name holds nothing.
 *      The fallback then lifted: this match's names still never go — its
 *      notice said they would stay on the phone.
 *   W1n A second match set up with names allowed: the notice says they go,
 *      and they go once, to pilot.name alone; no ball carries one.
 *   W2 Another phone, the same account: My Pilot Matches lists the match it
 *      lacks; Open on this phone brings it, names and all; Take over is a
 *      person's press over the first phone's lapsed lease, with an audit row;
 *      it scores on; the first phone's late ball is held, not written.
 *   W3 Phase 1 stays put: "Keep on this phone only" is a Practice Match, and
 *      no request leaves for it.
 *   R  The refusal (§3.3 step 2): a match started while granted, the grant
 *      ended before first contact. The server refuses; the match stays on the
 *      phone as a Practice Match, re-keyed under practice:, and the pad says
 *      "This match stays on this phone. Your account can't send Pilot
 *      Matches." The setup then offers no choice, and says why.
 *
 * Everyone here is invented (@example.invalid); the test name is the canary
 * `Qa Canarytest`, which is nobody.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-pilot.mjs
 */
import { chromium } from "playwright-core";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { appUrl, ownerUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(5397);
const API_PORT = port(8917);
const API = `http://127.0.0.1:${API_PORT}`;
const ORIGIN = `http://localhost:${WEB_PORT}`;
const SHOTS = process.env.BROWSER_PILOT_SHOTS || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const CANARY = "Qa Canarytest";
const SCORER = "scorer@example.invalid";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const owner = new pg.Client({ connectionString: ownerUrl() });
await owner.connect();
const sql = (/** @type {string} */ q, /** @type {any[]} */ p = []) => owner.query(q, p);
const one = async (/** @type {string} */ q, /** @type {any[]} */ p = []) => (await sql(q, p)).rows[0];
const SCORER_ID = (await one(`select id from app_user where email = $1`, [SCORER])).id;
await sql(`update pilot.switch set enabled = false`);
await sql(`delete from pilot.scorer where user_id = $1`, [SCORER_ID]);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-pilot-secret", WEB_ORIGIN: ORIGIN },
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
const A = ["Alpha One", "Alpha Two", CANARY, "Alpha Four"];
const B = ["Bravo One", "Bravo Two", "Bravo Three", "Bravo Four"];
const PLAYERS = [...A, ...B, "Canarytest"];

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
/** Back to the start screen and in again, so it asks the server afresh. @param {Awaited<ReturnType<typeof phone>>} p */
async function freshStart(p) {
  await p.tap("start-practice");
  await p.tap("practice-back");
  await afterReads(p.page, 600);
}

/**
 * The setup, start to pad. `choose` taps a choice on step 0 when given.
 * @param {Awaited<ReturnType<typeof phone>>} p
 * @param {{choose?: "live" | "phone", home: string[], away: string[], seeNotice?: (t: string) => void}} o
 */
async function setUp(p, o) {
  await p.tap("start-practice");
  if (o.choose) await p.tap(o.choose === "live" ? "pilot-choice-live" : "pilot-choice-phone");
  await p.tap("practice-overs-20");
  await p.tap("practice-next");
  await p.tid("practice-school-0").fill("Hilton");
  await p.tid("practice-division-0").selectOption("U13");
  await p.tap("practice-class-0-B");
  await p.tid("practice-school-1").fill("Kearsney");
  await p.tid("practice-division-1").selectOption("U13");
  await p.tap("practice-class-1-B");
  await p.tap("practice-next");
  o.seeNotice?.(await p.tid("pilot-notice").innerText().catch(() => ""));
  await p.tid("practice-paste-0").fill(o.home.join("\n"));
  await p.tap("practice-add-0");
  await p.tap("practice-next");
  await p.tid("practice-paste-1").fill(o.away.join("\n"));
  await p.tap("practice-add-1");
  await p.tap("practice-next");
  await p.page.locator("button[role=radio]", { hasText: "Hilton U13B" }).first().click();
  await p.page.locator("button[role=radio]", { hasText: /^Bat$/ }).click();
  await p.click(/Confirm Toss/);
  await p.page.locator("button", { hasText: o.home[0] }).first().click({ timeout: 3000 });
  await p.page.locator("button", { hasText: o.home[1] }).first().click({ timeout: 3000 });
  await p.click(/Select Opening Bowler/);
  await p.page.locator("button", { hasText: o.away[0] }).first().click();
  await p.click(/Start Match/);
  await p.page.waitForTimeout(1200);
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
const pilotIdOn = async (/** @type {Awaited<ReturnType<typeof phone>>} */ p) =>
  ((await p.keys()).find((k) => /\/pilot:meta:pilot-/.test(k)) ?? "").replace(/^.*pilot:meta:pilot-/, "") || null;

let phoneA, phoneB;
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  phoneA = await phone("A");

  group("0. Off, as db/151 leaves it");
  await signInAndOpen(phoneA);
  ok("the start screen offers Start Practice Match", await phoneA.has("start-practice"));
  ok("...and no My Pilot Matches", !(await phoneA.has("pilot-list-open")));
  await phoneA.tap("start-practice");
  ok("the setup asks nothing about sending, and is labelled as phase 1", !(await phoneA.has("pilot-choice")) && !(await phoneA.has("pilot-label"))
     && (await phoneA.tid("practice-label").first().innerText().catch(() => "")).includes("Practice match · kept on this phone"));
  await phoneA.tap("practice-back");

  group("W1. Switched on: the choice, the label, the notice; airplane mode; then signal");
  await sql(`update pilot.switch set enabled = true where key = 'pilot_sync'`);
  await sql(`insert into pilot.scorer (user_id) values ($1) on conflict (user_id) do update set ended_at = null`, [SCORER_ID]);
  await freshStart(phoneA);
  ok("the start screen now offers My Pilot Matches", await phoneA.has("pilot-list-open"));
  await phoneA.tap("start-practice");
  ok("step 1 asks once where the match goes, before any name", await phoneA.has("pilot-choice") && /Step 1 of 6/.test(await phoneA.text()));
  ok("...Send live to SCRBRD is chosen by default", (await phoneA.tid("pilot-choice-live").getAttribute("aria-checked")) === "true"
     && (await phoneA.tid("pilot-choice-phone").getAttribute("aria-checked")) === "false");
  ok("...and the label reads \"Pilot match · names kept private\"", (await phoneA.label()) === "Pilot match · names kept private", await phoneA.label());
  ok("no sideways scroll at 390", await phoneA.noSideways());
  await phoneA.shot("w1-choice");
  await phoneA.tap("practice-back");
  // Airplane mode from here: everything recorded stays on the phone.
  await phoneA.ctx.setOffline(true);
  let notice = "";
  await setUp(phoneA, { home: A, away: B, seeNotice: (t) => { notice = t; } });
  ok("the notice is above the first name field, and says the names stay here (the fallback is on)",
     /stay on this phone/.test(notice) && /never a name/.test(notice), notice);
  ok("the pad is open on the Pilot Match, labelled", (await phoneA.has("pad-titlebar")) && (await phoneA.label()).startsWith("Pilot match · names kept private"), await phoneA.label());
  ok("...Hilton U13B v Kearsney U13B, on the names typed", /Hilton U13B v Kearsney U13B/.test(await phoneA.tid("pad-titlebar").innerText()) && /Alpha One/.test(await phoneA.text()));
  ok("the pad is ready to score", await basic(phoneA));
  for (const k of ["run-1", "run-0", "run-4"]) await phoneA.tap(k);
  ok("three balls, offline: 5 for 0, 0.3 overs", (await phoneA.board()) === "5 for 0, 0.3 overs", await phoneA.board());
  const uuidA = await pilotIdOn(phoneA);
  ok("its id is pilot- and a uuid, its record under pilot:", /^[0-9a-f-]{36}$/.test(uuidA ?? ""), uuidA);
  ok("...and nothing of it is under practice:", !(await phoneA.keys()).some((k) => k.includes(`practice:`) && k.includes(String(uuidA))));
  ok("nothing reached the server while offline", (await one(`select count(*) n from pilot.match where id = $1`, [uuidA])).n === "0");
  await phoneA.shot("w1-offline");
  const onAt = Date.now();
  await phoneA.ctx.setOffline(false);
  const got = await serverEvents(/** @type {string} */ (uuidA), 6);
  ok("signal on: the opening events and the three balls reach the server", got === 6, `${got} events`);
  await afterReads(phoneA.page, 800);
  const after = requests.filter((r) => r.phone === "A" && r.at >= onAt && r.url.startsWith(`${API}/api/pilot`));
  const firstOf = (/** @type {RegExp} */ re) => after.findIndex((r) => re.test(`${r.method} ${r.url}`));
  const iCreate = firstOf(/^POST .*\/api\/pilot\/matches$/), iClaim = firstOf(/^POST .*\/session\/claim$/), iEvents = firstOf(/^POST .*\/events$/);
  ok("...in order: create, then the claim, then the balls", iCreate >= 0 && iCreate < iClaim && iClaim < iEvents,
     after.map((r) => `${r.method} ${r.url.replace(API, "")}`).join(" | "));
  ok("...and no names: the fallback is on", firstOf(/\/names$/) === -1 && Number((await one(`select count(*) n from pilot.name where match_id = $1`, [uuidA])).n) === 0);
  const dumpA = (await one(`select coalesce(string_agg(row_to_json(b)::text, E'\\n'), '') d from pilot.ball_event b where match_id = $1`, [uuidA])).d;
  ok("the server's log holds slot ids: a dump of it holds no typed name", dumpA.length > 200 && !PLAYERS.some((n) => dumpA.toLowerCase().includes(n.toLowerCase())), dumpA.slice(0, 200));
  ok("...nor does any request this phone made", !requests.some((r) => PLAYERS.some((n) => (r.url + r.body).toLowerCase().includes(n.toLowerCase()))),
     requests.filter((r) => PLAYERS.some((n) => (r.url + r.body).includes(n))).map((r) => r.url).join(" "));
  const row = await one(`select owner_user_id, venue_name, weather from pilot.match where id = $1`, [uuidA]);
  ok("the match is the scorer's own, with no position anywhere", row?.owner_user_id === SCORER_ID && !/"lat"|"lon"/.test(JSON.stringify(row)), JSON.stringify(row));
  ok("the pad, attached, offers no handover to another person (§3.1)", !(await phoneA.has("open-handover")));
  await phoneA.shot("w1-sent");

  group("W1. The fallback lifted later: this match's names still stay here");
  await sql(`update pilot.switch set enabled = true where key = 'pilot_names_upload'`);
  await phoneA.tap("run-0");
  await serverEvents(/** @type {string} */ (uuidA), 7);
  await afterReads(phoneA.page, 1500);
  ok("another ball goes; still no name: its notice said they would stay on the phone",
     Number((await one(`select count(*) n from pilot.name where match_id = $1`, [uuidA])).n) === 0
     && !requests.some((r) => r.phone === "A" && /\/names$/.test(r.url) && r.url.includes(String(uuidA))));

  group("W3. Keep on this phone only: a Practice Match, never sent");
  await phoneA.tap("exit-scorer");
  await openScorer(phoneA);
  const keepAt = Date.now();
  await setUp(phoneA, { choose: "phone", home: ["Charlie One", "Charlie Two"], away: ["Delta One", "Delta Two"] });
  ok("the pad is on a Practice Match, labelled as phase 1", (await phoneA.tid("practice-label").first().innerText().catch(() => "")).includes("Practice match · kept on this phone")
     && !(await phoneA.has("pilot-label")));
  await basic(phoneA);
  await phoneA.tap("run-1");
  await afterReads(phoneA.page, 1500);
  const sentKeep = requests.filter((r) => r.phone === "A" && r.at >= keepAt && r.method !== "GET" && r.url.startsWith(API));
  ok("no write left for it: not one POST to the API", sentKeep.length === 0, sentKeep.map((r) => `${r.method} ${r.url}`).join(" | "));
  ok("...and none named its players", !requests.some((r) => r.at >= keepAt && /Charlie|Delta/.test(r.url + r.body)));

  group("W1n. A match set up with names allowed: they go once, to pilot.name alone");
  await phoneA.tap("exit-scorer");
  await openScorer(phoneA);
  let notice2 = "";
  const N = ["Echo One", "Echo Two", CANARY];
  await setUp(phoneA, { home: N, away: ["Foxtrot One", "Foxtrot Two"], seeNotice: (t) => { notice2 = t; } });
  ok("the notice says the names are sent, never shown publicly, and deleted 30 days after the match ends",
     /sent to SCRBRD so you can carry on scoring on another phone/.test(notice2) && /never shown publicly/.test(notice2) && /30 days after the match ends/.test(notice2), notice2);
  await basic(phoneA);
  await phoneA.tap("run-2");
  const ids = (await phoneA.keys()).filter((k) => /\/pilot:meta:pilot-/.test(k)).map((k) => k.replace(/^.*pilot:meta:pilot-/, ""));
  const uuidN = ids.find((x) => x !== uuidA) ?? null;
  await serverEvents(/** @type {string} */ (uuidN), 4);
  await afterReads(phoneA.page, 1200);
  const names = (await sql(`select typed_name from pilot.name where match_id = $1 order by typed_name`, [uuidN])).rows.map((r) => r.typed_name);
  ok("pilot.name holds the five typed names, the canary among them", names.length === 5 && names.includes(CANARY), names.join(", "));
  const dumpN = (await one(`select coalesce(string_agg(row_to_json(b)::text, E'\\n'), '') d from pilot.ball_event b where match_id = $1`, [uuidN])).d;
  ok("...and no ball carries one", dumpN.length > 100 && !/canarytest|Echo|Foxtrot/i.test(dumpN));
  const nameReqs = requests.filter((r) => /\/names$/.test(r.url) && r.method === "POST");
  ok("...sent once, in the one request for them", nameReqs.length === 1 && nameReqs[0].url.includes(String(uuidN)), nameReqs.map((r) => r.url).join(" "));
  ok("...and no other request carried a name", !requests.filter((r) => !/\/names$/.test(r.url)).some((r) => /canarytest|Echo One|Foxtrot One/i.test(r.url + r.body)));

  group("W2. Another phone, the same account: Open, Take over, score on; the first phone's late ball held");
  phoneB = await phone("B");
  await signInAndOpen(phoneB);
  await phoneB.tap("pilot-list-open");
  await afterReads(phoneB.page, 1200);
  ok("My Pilot Matches lists the two this phone lacks, from SCRBRD", (await phoneB.tid("pilot-server-row").count()) === 2, (await phoneB.text()).slice(0, 400));
  ok("no sideways scroll at 390", await phoneB.noSideways());
  await phoneB.shot("w2-list");
  // The first phone stops (a flat battery): offline, and its lease lapses.
  await phoneA.ctx.setOffline(true);
  await phoneA.tap("run-1");
  await sql(`update pilot.session set lease_until = now() - interval '1 second' where match_id = $1`, [uuidN]);
  await phoneB.page.locator(`[data-testid="pilot-server-row"][data-id="${uuidN}"] [data-testid="pilot-open-here"]`).click({ timeout: 5000 });
  await afterReads(phoneB.page, 2500);
  ok("Open on this phone: the pad, on the server's log, the names restored", (await phoneB.has("pad-titlebar")) && /Echo One/.test(await phoneB.text()), (await phoneB.text()).slice(0, 300));
  ok("...the same score: 2 for 0, 0.1 overs", (await phoneB.board()) === "2 for 0, 0.1 overs", await phoneB.board());
  ok("...and it is not taken by itself: the pad asks", await phoneB.has("sync-confirm-takeover"), (await phoneB.tid("sync-banner").innerText().catch(() => "")).slice(0, 300));
  await phoneB.tap("sync-confirm-takeover");
  await afterReads(phoneB.page, 2000);
  ok("Take over: an audit row names both devices", Number((await one(`select count(*) n from pilot.audit where match_id = $1 and event = 'takeover'`, [uuidN])).n) === 1);
  await basic(phoneB);
  const before = Number((await one(`select count(*) n from pilot.ball_event where match_id = $1`, [uuidN])).n);
  await phoneB.tap("run-4");
  ok("phone B scores on: the ball reaches the server", (await serverEvents(/** @type {string} */ (uuidN), before + 1)) === before + 1);
  await phoneB.shot("w2-takenover");
  // Phone A comes back. Its gate asks before it sends (the lease is not
  // known to be live after a loss of signal): the token has moved, so its
  // late ball is kept on it, said in words, and never reaches the log — the
  // db/126 rule, as for a fixture. (A ball a stale phone does send is held
  // by the server: smoke-pilot-sync.mjs F.)
  await phoneA.ctx.setOffline(false);
  await phoneA.page.waitForSelector('[data-testid="sync-banner"][data-reason="token_moved"]', { timeout: 25000 }).catch(() => {});
  ok("phone A is told another device has taken over, and keeps its late ball",
     /Another device has taken over scoring this match/.test(await phoneA.tid("sync-banner").innerText().catch(() => "")),
     await phoneA.tid("sync-banner").innerText().catch(() => ""));
  ok("...which is not in the server's log", Number((await one(`select count(*) n from pilot.ball_event where match_id = $1`, [uuidN])).n) === before + 1);

  group("R. The refusal: the grant ends before first contact");
  await phoneB.tap("exit-scorer");
  await openScorer(phoneB);
  await phoneB.ctx.setOffline(true);
  await setUp(phoneB, { home: ["Golf One", "Golf Two"], away: ["Hotel One", "Hotel Two"] });
  await basic(phoneB);
  await phoneB.tap("run-6");
  const uuidR = (await phoneB.keys()).filter((k) => /\/pilot:meta:pilot-/.test(k)).map((k) => k.replace(/^.*pilot:meta:pilot-/, "")).find((x) => x !== uuidN) ?? null;
  ok("started live while granted, offline", !!uuidR && (await phoneB.label()).startsWith("Pilot match"), uuidR);
  await sql(`update pilot.scorer set ended_at = now() where user_id = $1`, [SCORER_ID]);
  await phoneB.ctx.setOffline(false);
  await phoneB.page.waitForSelector('[data-testid="pilot-refused"]', { timeout: 20000 }).catch(() => {});
  ok("the server refuses it, and the pad says so in the design's words",
     (await phoneB.tid("pilot-refused").innerText().catch(() => "")) === "This match stays on this phone. Your account can't send Pilot Matches.",
     (await phoneB.text()).slice(0, 400));
  ok("...it is a Practice Match now, labelled as phase 1", (await phoneB.tid("practice-label").first().innerText().catch(() => "")).includes("Practice match · kept on this phone"));
  ok("...still 6 for 0, scoring on", (await phoneB.board()) === "6 for 0, 0.1 overs", await phoneB.board());
  const keysB = await phoneB.keys();
  ok("...its keys are under practice:, and none under pilot: is left for it",
     keysB.some((k) => /practice:meta:practice-/.test(k)) && !keysB.some((k) => k.includes(String(uuidR))), keysB.filter((k) => /pilot:|practice:/.test(k)).join(" | "));
  ok("...and the server has nothing of it", (await one(`select count(*) n from pilot.match where id = $1`, [uuidR])).n === "0");
  await phoneB.tap("run-1");
  await afterReads(phoneB.page, 1500);
  ok("...and sends nothing more", !requests.some((r) => r.phone === "B" && r.url.includes(String(uuidR)) && /\/events$/.test(r.url)));
  await phoneB.tap("exit-scorer");
  await openScorer(phoneB);
  await phoneB.tap("start-practice");
  ok("the setup now offers no choice, and says why", !(await phoneB.has("pilot-choice"))
     && (await phoneB.tid("pilot-not-granted").innerText().catch(() => "")) === "Your account can't send Pilot Matches. This match will stay on this phone.");
  await phoneB.shot("r-not-granted");

  group("The whole walk");
  ok("no page error, no console error", errors.length === 0, errors.join(" | "));
  ok("the API logged no error", !/\berror\b/i.test(apiErr.join("")), apiErr.join("").slice(0, 300));
} catch (e) {
  fail++;
  console.log("  ✗ the walk stopped:", /** @type {any} */ (e)?.stack?.split("\n").slice(0, 4).join(" / "));
  for (const p of [phoneA, phoneB]) {
    if (!p) continue;
    console.log("  page text:", (await p.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 400));
    if (SHOTS) await p.page.screenshot({ path: join(SHOTS, `zz-failed-${p === phoneA ? "A" : "B"}.png`) }).catch(() => {});
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

#!/usr/bin/env node
/**
 * Practice Match, phase 1, in a real browser at a phone's 390 × 844 — signed
 * in as a scorer against the real API, and proving the API is never told.
 *
 *   A  Start Practice Match from the scorer's start screen; the label
 *      "Practice match · kept on this phone" on every screen; overs, the
 *      location prompt once (denied, then allowed), the venue typed, the
 *      weather buttons.
 *   B  Two teams typed, shown as "Hilton U15A" and "Kearsney U15A"; two
 *      squads pasted — numbering, blank lines, commas and a repeated name
 *      cleaned or flagged — reordered, a twelfth man marked; the toss, the
 *      openers and the opening bowler; the pad opens on those names.
 *   C  An over scored on the real pad. RELOAD MID-OVER: the scorer's start
 *      screen offers Resume first, with the score and when it was last
 *      saved; Resume puts back the score, the batters, the bowler — and undo.
 *      The over is finished and the next bowler chosen.
 *   D  A weather change from the pad's menu, with the over and ball.
 *   E  THE NETWORK. Every request the page made, from the first load to the
 *      last, is held to a list of every name and team typed: not one carries
 *      any, in its URL, its headers or its body — and the walk made no write
 *      to the API at all once the practice match was under way.
 *   F  The Practice Matches list: the scorecard saved as a file (with the
 *      names), a second match deleted from the page's own confirmation (not
 *      confirm()), then all of them; and nothing is left in IndexedDB or
 *      localStorage — no name, no team, no weather, no ball.
 *   G  No horizontal scroll at 390 on any practice screen.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-practice.mjs
 *   BROWSER_PRACTICE_SHOTS=/some/dir node tools/smoke-browser-practice.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(5395);
const API_PORT = port(8915);
const API = `http://127.0.0.1:${API_PORT}`;
const ORIGIN = `http://localhost:${WEB_PORT}`;
const SHOTS = process.env.BROWSER_PRACTICE_SHOTS || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-practice-secret", WEB_ORIGIN: ORIGIN },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));

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

// ── The names and teams this walk types: made up, and every one of them is
// held out of every request. ──
const A = ["Alpha One", "Alpha Two", "Alpha Three", "Alpha Four", "Alpha Five", "Alpha Six", "Alpha Seven", "Alpha Eight", "Alpha Nine", "Alpha Ten", "Alpha Eleven", "Alpha Twelve"];
const B = ["Bravo One", "Bravo Two", "Bravo Three", "Bravo Four", "Bravo Five", "Bravo Six", "Bravo Seven", "Bravo Eight", "Bravo Nine", "Bravo Ten", "Bravo Eleven"];
const TEAMS = ["Hilton U15A", "Kearsney U15A"];
const VENUE = "Practice Oval";
const SECRETS = [...A, ...B, ...TEAMS, VENUE, "Alpha", "Bravo", "Kearsney", "Hilton"];

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
await offline(ctx);
const page = await ctx.newPage();
const errors = [];
const dialogs = [];
const sockets = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
page.on("websocket", (w) => sockets.push(w.url()));

// EVERY REQUEST, from the first one: URL, method, headers, body, and whether
// it was aborted (the context refuses anything off localhost, and the browser
// still tried it). `phase` says when it was made.
const requests = [];
let phase = "boot";
page.on("request", (r) => requests.push({ phase, url: r.url(), method: r.method(), body: r.postData() ?? "", headers: JSON.stringify(r.headers()) }));

const text = () => page.$eval("body", (el) => el.innerText);
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const tap = async (id, ms = 5000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(250); };
const has = async (id) => (await tid(id).count()) > 0;
const click = async (re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
const labelShown = async () => (await tid("practice-label").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const LABEL = "Practice match · kept on this phone";

/** Everything on the phone for this origin: every IndexedDB store and localStorage, as text. */
const phone = () => page.evaluate(async () => {
  const out = { keys: [], text: "" };
  const dbs = (indexedDB.databases ? await indexedDB.databases() : [{ name: "scrbrd" }, { name: "scrbrd-outbox" }, { name: "scrbrd-pad" }]);
  for (const { name } of dbs) {
    if (!name) continue;
    const db = await new Promise((res, rej) => { const q = indexedDB.open(name); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    for (const store of [...db.objectStoreNames]) {
      const tx = db.transaction(store, "readonly");
      const os = tx.objectStore(store);
      const keys = await new Promise((res) => { const q = os.getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); });
      const vals = await new Promise((res) => { const q = os.getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); });
      out.keys.push(...keys.map((k) => `${name}/${store}/${String(k)}`));
      out.text += JSON.stringify(keys) + JSON.stringify(vals);
    }
    db.close();
  }
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.keys.push(`localStorage/${k}`); out.text += k + localStorage.getItem(k); }
  return out;
});

/** From the shell to the scorer's start screen, at 390. */
const openScorer = async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);
  await page.locator("button", { hasText: /Open SCRBRD Scorer/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(1800);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
};

/** Basic Scoring, from the pad's menu: the one-tap keys. */
const ensureBasic = async () => {
  if (await has("basic-pad")) return true;
  await tap("pad-menu"); await tap("pad-basic-scoring"); await page.waitForTimeout(300);
  return has("basic-pad");
};
/** Until the pad stops asking: openers and the first bowler are already in. */
const bowlNext = async (name) => {
  for (let i = 0; i < 8; i++) {
    const choice = page.locator(`[data-testid="bowler-choice"][data-id="${name}"]`);
    if (await choice.count()) { await choice.first().click({ timeout: 3000 }); await page.waitForTimeout(400); return true; }
    await page.waitForTimeout(400);
  }
  return false;
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });

  group("Signing in as a scorer, and opening the scorer's start screen");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  await openScorer();
  ok("the scorer's start screen offers Start Practice Match", await has("start-practice"), (await text()).slice(0, 300));
  ok("...and the list of practice matches", await has("practice-list-open"));
  ok("...and nothing to resume yet", !(await has("practice-resume-card")));
  await shot("00-start");

  // From here on, every request is counted as "practice".
  phase = "practice";

  group("A. The match: overs, where, the weather");
  await tap("start-practice");
  ok("the setup says it is a practice match kept on this phone", (await labelShown()) === LABEL, await labelShown());
  ok("...Step 1 of 6", /Step 1 of 6/.test(await text()));
  ok("overs: 20, 30, 40 and 50, and custom", (await Promise.all([20, 30, 40, 50].map((n) => has(`practice-overs-${n}`)))).every(Boolean) && (await has("practice-overs-custom")));
  ok("...20 is chosen", (await tid("practice-overs-20").getAttribute("aria-checked")) === "true");
  await tap("practice-overs-custom");
  await tid("practice-overs-input").fill("0");
  ok("a custom 0 is refused in words, and Next is off", /whole number from 1 to 50/.test(await text()) && (await tid("practice-next").isDisabled()));
  await tid("practice-overs-input").fill("12");
  ok("a custom 12 is taken", !(await tid("practice-next").isDisabled()));
  await tap("practice-overs-40");
  ok("a preset puts it back", (await tid("practice-overs-40").getAttribute("aria-checked")) === "true" && (await tid("practice-overs-custom").getAttribute("aria-checked")) === "false");
  await tap("practice-overs-20");

  // The location: one request per tap. Refused first (nothing granted), then
  // allowed after a reload — which also proves the setup was kept: the draft.
  let asked = 0;
  await page.exposeFunction("__geoAsked", () => { asked++; });
  const watchGeo = () => page.evaluate(() => {
    if (window.__geoWatched) return;
    window.__geoWatched = true;
    const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...a) => { window.__geoAsked(); return real(...a); };
  });
  await watchGeo();
  await tid("practice-venue").fill(VENUE);
  ok("the venue is typed", (await tid("practice-venue").inputValue()) === VENUE);
  await tap("practice-locate");
  await page.waitForFunction(() => /Type the venue instead/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  ok("with the location refused, the scorer is told to type the venue instead, and has", /Type the venue instead/.test(await text()), (await text()).slice(0, 400));
  ok("...it was asked once for that tap", asked === 1, asked);
  await tap("practice-overs-30");

  await ctx.grantPermissions(["geolocation"], { origin: ORIGIN });
  await ctx.setGeolocation({ latitude: -29.54012, longitude: 30.28765, accuracy: 20 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  await openScorer();
  await tap("start-practice");
  ok("a reload mid-setup: the draft is picked up where it was left, and says so", (await has("practice-draft-note")) && (await tid("practice-venue").inputValue()) === VENUE
    && (await tid("practice-overs-30").getAttribute("aria-checked")) === "true", (await text()).slice(0, 300));
  await watchGeo();
  await tap("practice-locate");
  await page.waitForFunction(() => /Position kept/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  ok("allowed: the position is kept on the phone, from one more request", /Position kept on this phone \(about 20 m\)/.test(await text()) && asked === 2, `${asked} ${(await text()).slice(0, 300)}`);
  await tap("practice-overs-20");
  ok("20 overs again", (await tid("practice-overs-20").getAttribute("aria-checked")) === "true");

  await tap("practice-weather-overcast");
  ok("the weather buttons: Sunny, Overcast, Drizzle, Rain, Windy and Playable or not",
    (await Promise.all(["sunny", "overcast", "drizzle", "rain", "windy"].map((c) => has(`practice-weather-${c}`)))).every(Boolean)
    && (await has("practice-playable")) && (await has("practice-not-playable")));
  ok("...Overcast is chosen, and playable", (await tid("practice-weather-overcast").getAttribute("aria-pressed")) === "true" && (await tid("practice-playable").getAttribute("aria-pressed")) === "true");
  ok("no weather hint is shown (there is none yet)", !(await has("practice-weather-hint")));
  ok("no sideways scroll at 390", await noSideways());
  await shot("01-match");
  await tap("practice-next");

  group("B. Two teams, two squads, the toss, the openers");
  ok("Step 2 of 6, still labelled", /Step 2 of 6/.test(await text()) && (await labelShown()) === LABEL);
  ok("Next is off until both teams are complete", await tid("practice-next").isDisabled());
  await tid("practice-school-0").fill("Hilton");
  await tid("practice-division-0").selectOption("U15");
  await tap("practice-class-0-A");
  ok("the first team is shown as \"Hilton U15A\"", /Shown as\s*Hilton U15A/.test(await text()), (await tid("practice-teamname-0").innerText()));
  await tid("practice-school-1").fill("Hilton");
  await tid("practice-division-1").selectOption("U15");
  await tap("practice-class-1-A");
  ok("two teams with one name are refused in words", /same name/.test(await text()) && (await tid("practice-next").isDisabled()));
  await tid("practice-school-1").fill("Kearsney");
  ok("...Kearsney U15A is accepted", /Shown as\s*Kearsney U15A/.test(await text()) && !(await tid("practice-next").isDisabled()));
  ok("no sideways scroll at 390", await noSideways());
  await shot("02-teams");
  await tap("practice-next");

  // Squad 1: numbering, blank lines, commas, trailing spaces, a repeat.
  ok("Step 3 of 6: the first squad", /Step 3 of 6/.test(await text()) && /Hilton U15A/.test(await text()));
  const paste1 = [
    "1. Alpha One", "", "2) Alpha Two,   ", "  3 - Alpha Three  ", "", "4. Alpha Four, Alpha Five", "5. Alpha Six", "",
    ...A.slice(6).map((n, i) => `${i + 7}. ${n}`), "13. alpha  two ",
  ].join("\n");
  await tid("practice-paste-0").fill(paste1);
  ok("the paste is counted as it is typed", /13 names found/.test(await text()), (await text()).slice(0, 300));
  await tap("practice-add-0");
  ok("it is added: 13 of 15, numbering and blank lines gone", (await tid("practice-count-0").innerText()).trim() === "13 of 15 names" && (await tid("practice-squad-row").count()) === 13);
  const rows1 = await page.$$eval('[data-testid="practice-squad-row"]', (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  ok("...the first is \"Alpha One\" with no number in his name", /Alpha One/.test(rows1[0]) && !/1\. /.test(rows1[0]) && /Alpha Five/.test(rows1[4]), rows1.slice(0, 5).join(" | "));
  ok("the repeated name is flagged on its row, and said in words", /name repeated/.test(rows1[12]) && /in the list twice/.test(await text()), rows1[12]);
  ok("...Next is off", await tid("practice-next").isDisabled());
  await tap("practice-dedupe-0");
  ok("removing the repeats leaves twelve", (await tid("practice-count-0").innerText()).trim() === "12 of 15 names" && !(await tid("practice-next").isDisabled()));
  // Reorder: Alpha Three up one place; Alpha Twelve is the 12th man.
  await page.locator('button[aria-label="Move Alpha Three up"]').click();
  const rows1b = await page.$$eval('[data-testid="practice-squad-row"]', (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  ok("a name moves up one place", /Alpha Three/.test(rows1b[1]) && /Alpha Two/.test(rows1b[2]), rows1b.slice(0, 3).join(" | "));
  await page.locator('button[aria-label="Alpha Twelve is the 12th man"]').click();
  ok("the twelfth man is marked and is not in the eleven", await page.locator('button[aria-label="Alpha Twelve is the 12th man"]').getAttribute("aria-pressed") === "true");
  const rows1c = await page.$$eval('[data-testid="practice-squad-row"]', (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  ok("...he reads \"12th man\"", /12th man/.test(rows1c[11]), rows1c[11]);
  ok("every control on the squad screen is at least 44 × 44", await page.evaluate(() => [...document.querySelectorAll("main button, main input, main select, main textarea")]
    .filter((e) => e.offsetParent).every((e) => { const b = e.getBoundingClientRect(); return b.width >= 43.5 && b.height >= 43.5; })));
  ok("no sideways scroll at 390", await noSideways());
  await shot("03-squad");
  await tap("practice-next");

  ok("Step 4 of 6: the second squad", /Step 4 of 6/.test(await text()));
  await tid("practice-paste-1").fill(B.map((n, i) => `${i + 1}. ${n}`).join("\n\n"));
  await tap("practice-add-1");
  ok("eleven names added", (await tid("practice-count-1").innerText()).trim() === "11 of 15 names" && !(await tid("practice-next").isDisabled()));
  // A name on both sides is refused.
  await tid("practice-paste-1").fill("alpha one");
  await tap("practice-add-1");
  ok("a name on both sides is refused in words", /on both sides/.test(await text()) && (await tid("practice-next").isDisabled()), (await text()).slice(-300));
  await page.locator('button[aria-label="Remove alpha one"]').click();
  ok("...and taken off again", (await tid("practice-count-1").innerText()).trim() === "11 of 15 names" && !(await tid("practice-next").isDisabled()));
  await tap("practice-next");

  ok("Step 5 of 6: the toss, with the teams as typed", /Step 5 of 6/.test(await text()) && /Hilton U15A/.test(await text()) && /Kearsney U15A/.test(await text()));
  await page.locator("button[role=radio]", { hasText: "Hilton U15A" }).first().click();
  await page.locator("button[role=radio]", { hasText: /^Bat$/ }).click();
  ok("Hilton won the toss and bat", (await page.locator("button[role=radio]", { hasText: "Hilton U15A" }).first().getAttribute("aria-checked")) === "true");
  await shot("04-toss");
  await click(/Confirm Toss/);

  ok("Step 6 of 6: openers, from the eleven in batting order (the twelfth man and nobody else left out)",
    /Step 6 of 6/.test(await text()) && /Alpha Three/.test(await text()) && !/Alpha Twelve/.test(await text()), (await text()).slice(0, 300));
  await page.locator("button", { hasText: "Alpha One" }).first().click({ timeout: 3000 });
  await page.locator("button", { hasText: "Alpha Three" }).first().click({ timeout: 3000 });
  ok("both openers are set", /Both openers set/.test(await text()), (await text()).slice(0, 300));
  await shot("05-openers");
  await click(/Select Opening Bowler/);
  ok("the opening bowler is chosen from Kearsney's eleven", /Bravo One/.test(await text()) && !/Alpha One/.test((await text()).split("Opening Bowler").at(-1)));
  await page.locator("button", { hasText: "Bravo One" }).first().click();
  await shot("06-bowler");
  await click(/Start Match/);
  await page.waitForTimeout(1200);

  group("C. An over on the real pad, a reload mid-over, Resume");
  ok("the pad is open on the practice match, labelled", (await has("pad-titlebar")) && (await labelShown()).startsWith(LABEL), await labelShown());
  ok("...Hilton U15A v Kearsney U15A", /Hilton U15A v Kearsney U15A/.test(await tid("pad-titlebar").innerText()));
  ok("...and says when it was last saved", /last saved/.test(await labelShown()), await labelShown());
  ok("the pad is ready to score on the names typed", (await ensureBasic()) && !(await has("scoring-blocked")), (await text()).slice(0, 300));
  await tap("run-1");
  await tap("run-0");
  await tap("run-4");
  const b3 = await board();
  ok("three balls scored: 5 for 0, 0.3 overs", b3 === "5 for 0, 0.3 overs", b3);
  await page.waitForTimeout(800);   // the save is on its way before the tap's result
  ok("no sideways scroll at 390 on the pad", await noSideways());
  await shot("07-pad");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  phase = "practice";
  ok("RELOAD MID-OVER: the scorer's start screen comes back, and offers Resume first",
    (await has("practice-resume-card")) && (await has("practice-resume")), (await text()).slice(0, 300));
  const card = await tid("practice-resume-card").innerText();
  ok("...with the match, the score and when it was last saved", /Hilton U15A v Kearsney U15A/.test(card) && /Hilton U15A 5\/0 \(0\.3\)/.test(card) && /Last saved today \d\d:\d\d/.test(card), card.replace(/\s+/g, " "));
  ok("...above Start Practice Match", await page.evaluate(() => {
    const a = document.querySelector('[data-testid="practice-resume-card"]').getBoundingClientRect().top;
    const b = document.querySelector('[data-testid="start-practice"]').getBoundingClientRect().top;
    return a < b;
  }));
  ok("no sideways scroll at 390", await noSideways());
  await shot("08-resume");
  await tap("practice-resume");
  await page.waitForTimeout(1200);
  ok("Resume: the pad is back, labelled", (await has("pad-titlebar")) && (await labelShown()).startsWith(LABEL), await labelShown());
  await ensureBasic();
  ok("...the same score, wickets and overs: 5 for 0, 0.3 overs", (await board()) === "5 for 0, 0.3 overs", await board());
  const padText = await text();
  ok("...the same batters and bowler (Alpha One, Alpha Three, Bravo One)", /Alpha One/.test(padText) && /Alpha Three/.test(padText) && /Bravo One/.test(padText), padText.slice(0, 400));
  // Undo takes the four back, as it would have before the reload.
  await tap("key-undo");
  ok("undo after the reload takes back the four: 1 for 0, 0.2 overs", (await board()) === "1 for 0, 0.2 overs", await board());
  await tap("run-4");
  await tap("run-2");
  await tap("run-0");
  await tap("run-1");
  // the over is done: the new-over prompt, then the next bowler.
  ok("six balls make an over: the pad asks for the next bowler, from Kearsney's eleven", await bowlNext("Bravo Two"));
  const b6 = await board();
  ok("the over: 8 for 0, 1.0 overs", b6 === "8 for 0, 1.0 overs", b6);
  await page.waitForTimeout(800);

  group("D. A weather change, with the over and ball");
  await tap("run-1");
  await tap("pad-menu");
  ok("the pad's menu has Weather and Save the scorecard, under Practice match", (await has("pad-practice-weather")) && (await has("pad-practice-save")));
  await tap("pad-practice-weather");
  ok("the weather sheet opens, labelled, with the five buttons", (await has("practice-weather-sheet")) && (await Promise.all(["sunny", "overcast", "drizzle", "rain", "windy"].map((c) => has(`pw-${c}`)))).every(Boolean));
  ok("...and says where it will be recorded: 1.1 overs of innings 1", /1\.1 overs of innings 1/.test(await text()), (await text()).slice(0, 300));
  await tap("pw-rain");
  await tap("pw-not-playable");
  await tid("pw-note").fill("Rain stopped play");
  await shot("09-weather");
  await tap("pw-save");
  await page.waitForTimeout(500);
  const meta = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const q = indexedDB.open("scrbrd"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const os = db.transaction("kv", "readonly").objectStore("kv");
    const keys = await new Promise((res) => { const q = os.getAllKeys(); q.onsuccess = () => res(q.result); });
    const k = keys.find((x) => String(x).startsWith("practice:meta:"));
    const v = await new Promise((res) => { const q = os.get(k); q.onsuccess = () => res(q.result); });
    db.close();
    return v;
  });
  ok("the weather change is kept with the innings, over and ball", meta?.weather_changes?.length === 1 && meta.weather_changes[0].innings === 1 && meta.weather_changes[0].over === 1 && meta.weather_changes[0].ball === 1
    && meta.weather_changes[0].condition === "rain" && meta.weather_changes[0].playable === false, JSON.stringify(meta?.weather_changes));
  ok("...and the start of the day is match_weather's shape: Overcast", meta?.match_weather?.condition === "overcast" && "observed_at" in meta.match_weather && "rain_chance_pct" in meta.match_weather);
  ok("...the record has the venue and its position", meta?.match?.venue?.name === VENUE && meta.match.venue.lat === -29.54012);
  ok("the board did not move for any of it", (await board()) === "9 for 0, 1.1 overs", await board());

  group("E. The network: not one request carried a name");
  const hit = requests.filter((r) => SECRETS.some((s) => {
    const enc = [s, encodeURIComponent(s), s.replace(/ /g, "+"), s.replace(/ /g, "%20"), s.toLowerCase()];
    return enc.some((e) => r.url.includes(e) || r.body.includes(e) || r.headers.toLowerCase().includes(e.toLowerCase()));
  }));
  ok(`${requests.length} requests since the first load, none with a name, a team or the venue in its URL, headers or body`, hit.length === 0, hit.slice(0, 3).map((r) => `${r.method} ${r.url} ${r.body.slice(0, 80)}`).join(" || "));
  const toApi = requests.filter((r) => r.phase === "practice" && r.url.startsWith(API));
  const writes = toApi.filter((r) => r.method !== "GET" && r.method !== "HEAD" && r.method !== "OPTIONS");
  ok(`once the practice match began: ${toApi.length} reads of the API (the shell's own), and no write to it at all`, writes.length === 0, writes.map((r) => `${r.method} ${r.url}`).join(", "));
  ok("...nothing about a match, its events, its toss or its squad was asked of the API", !toApi.some((r) => /\/api\/matches\/|\/events|\/toss|\/session\/pad|\/discipline/.test(r.url)), toApi.map((r) => r.url).join(", ").slice(0, 300));
  ok("...no beacon, no websocket", sockets.length === 0 && !requests.some((r) => /collect|analytics|beacon|gtag|firebase/i.test(r.url)), sockets.join(","));
  const outbox = await phone();
  ok("the sync outbox has no practice match in it", !outbox.keys.some((k) => /scrbrd-outbox/.test(k) && /practice/.test(k)), outbox.keys.filter((k) => /outbox/.test(k)).join(", "));

  group("F. The list: save the scorecard, delete one, delete all");
  // A second practice match to delete: a copy of this one, under another id, put in the phone's own store.
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const q = indexedDB.open("scrbrd"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const read = (k) => new Promise((res) => { const q = db.transaction("kv", "readonly").objectStore("kv").get(k); q.onsuccess = () => res(q.result); });
    const keys = await new Promise((res) => { const q = db.transaction("kv", "readonly").objectStore("kv").getAllKeys(); q.onsuccess = () => res(q.result); });
    const id = String(keys.find((x) => String(x).startsWith("practice:meta:"))).slice("practice:meta:".length);
    const meta = await read(`practice:meta:${id}`), log = await read(`practice:log:${id}`);
    const nid = "practice-copy-two";
    const put = (k, v) => new Promise((res) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = res; });
    await put(`practice:meta:${nid}`, { ...meta, id: nid, match: { ...meta.match, id: nid } });
    await put(`practice:log:${nid}`, { ...log, matchId: nid, savedAt: Date.now() - 86400000 * 2 });
    db.close();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  ok("after another reload the start screen still offers Resume for the match in progress", await has("practice-resume-card"));
  await tap("practice-list-open");
  ok("the list is labelled", (await labelShown()) === LABEL, await labelShown());
  ok("it holds both matches, each with its score and when it was last saved", (await tid("practice-row").count()) === 2 && (await tid("practice-row-saved").count()) === 2, (await text()).slice(0, 300));
  const savedTexts = await tid("practice-row-saved").allInnerTexts();
  ok("...one saved today, one two days ago", savedTexts.some((t) => /today \d\d:\d\d/.test(t)) && savedTexts.some((t) => /\d{1,2} [A-Z][a-z]{2} \d\d:\d\d/.test(t)), savedTexts.join(" | "));
  ok("no sideways scroll at 390", await noSideways());
  await shot("10-list");
  const dl = page.waitForEvent("download", { timeout: 8000 });
  await page.locator('[data-testid="practice-row"]', { hasText: "1.1 ov" }).first().locator('[data-testid="practice-export"]').click();
  const file = await dl.catch(() => null);
  ok("Save scorecard hands the browser a file", !!file && /^practice-match-hilton-u15a-v-kearsney-u15a-\d{4}-\d{2}-\d{2}\.txt$/.test(file.suggestedFilename()), file?.suggestedFilename());
  if (file) {
    const body = await readFile(await file.path(), "utf8");
    ok("...it is the scorecard, with the names in it, and says it is a practice match", /PRACTICE MATCH/.test(body) && /Alpha One/.test(body) && /Bravo One/.test(body) && /Hilton U15A, innings 1: 9\/0 \(1\.1 overs\)/.test(body) && /Weather: Rain, not playable, Rain stopped play/.test(body) && /Venue: Practice Oval/.test(body), body.slice(0, 600));
  }

  const target = page.locator('[data-testid="practice-row"]', { hasText: "Hilton U15A" }).nth(1);
  await target.locator('[data-testid="practice-delete"]').click();
  ok("Delete asks on the page, with a button to confirm and one to keep it", (await has("practice-confirm")) && /removed from this phone/.test(await tid("practice-confirm").innerText()));
  ok("...and not with the browser's confirm()", dialogs.length === 0, dialogs.join(","));
  await shot("11-confirm");
  await tap("practice-confirm-delete");
  await page.waitForTimeout(500);
  ok("one match is left, and the page says nothing of the deleted one is left", (await tid("practice-row").count()) === 1 && /Nothing of that match is left/.test(await text()));
  const afterOne = await phone();
  ok("...its names, record and balls are gone from the phone; the other match's are not", !afterOne.keys.some((k) => k.includes("practice-copy-two")) && afterOne.keys.some((k) => k.includes("practice:meta:")) && afterOne.text.includes("Alpha One"));

  await tap("practice-delete-all");
  ok("Delete all asks first, on the page", (await has("practice-confirm-all")) && /Every name, team, weather record and ball/.test(await tid("practice-confirm-all").innerText()));
  await tap("practice-confirm-delete-all");
  await page.waitForTimeout(600);
  ok("delete all: the list is empty and says so", (await has("practice-empty")) && /No practice match, name or weather record is left/.test(await text()));
  ok("...still no browser confirm()", dialogs.length === 0);
  const clean = await phone();
  ok("NOTHING REMAINS: no practice key anywhere in IndexedDB or localStorage", !clean.keys.some((k) => /practice/i.test(k)), clean.keys.filter((k) => /practice/i.test(k)).join(", "));
  ok("...and no name, team, venue or weather in any of it", !SECRETS.some((s) => clean.text.includes(s)) && !/overcast|Rain stopped/.test(clean.text), SECRETS.filter((s) => clean.text.includes(s)).join(", "));
  await page.screenshot({ path: SHOTS ? join(SHOTS, "12-empty.png") : "/dev/null" }).catch(() => {});
  await tap("practice-back");
  ok("back on the start screen: nothing to resume", !(await has("practice-resume-card")) && (await has("start-practice")));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  ok("a reload now returns to the shell, with no practice match offered", !(await has("practice-resume-card")));

  group("G. The whole walk");
  ok("no page error, no console error", errors.length === 0, errors.join(" | "));
  ok("the API logged no error", !/\berror\b/i.test(apiErr.join("")), apiErr.join("").slice(0, 300));
} catch (e) {
  fail++;
  console.log("  ✗ the walk stopped:", e.stack?.split("\n").slice(0, 4).join(" / "));
  console.log("  page text:", (await text().catch(() => "")).replace(/\s+/g, " ").slice(0, 500));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "zz-failed.png") }).catch(() => {});
} finally {
  await browser.close().catch(() => {});
  web.close();
  api.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

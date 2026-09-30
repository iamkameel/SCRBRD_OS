#!/usr/bin/env node
/**
 * The pitch deck, in a real browser, as the platform account that may open it.
 *
 * The deck is the one screen that draws in 3D, and three.js is the one
 * dependency the client fetches on demand rather than on load. Both of those
 * are claims a build can silently stop honouring: a static import folds the
 * library into the entry chunk and nothing looks different; a GPU-less runner
 * has no WebGL and a deck that assumed one shows a black rectangle and a
 * stack trace. This walk holds the deck to what it says about itself —
 *
 *   - the three.js chunk is NOT requested until the deck opens, and IS then;
 *   - the stage mounts in whichever mode the browser supports and says which,
 *     with a canvas for WebGL or an SVG for the flat wheel, and no error either
 *     way;
 *   - switching 3D off swaps the canvas for the SVG; switching it back restores
 *     whatever the browser had;
 *   - every slide is reachable from the keyboard, in order, and the keys are
 *     ignored while a field has focus;
 *   - the figures are the figures: the wheel's scoreline is the seeded innings,
 *     the roadmap's three counts are Settings' own list, the school slide's
 *     numbers came from the server and not the demo;
 *   - every control has a name;
 *   - THE LIVE SLIDES (day, field, centre, scorebook, families, safeguard) show the app's own
 *     components in device frames, on demonstration data built in the
 *     browser: each framed component is there (asserted on the components' own
 *     test ids, not on the deck's), the frame is inert, and while they are on
 *     screen the browser makes no request but static files. The day sheet is
 *     DashboardView's own DaySheet on invented fixtures; the scorebook slide is
 *     scorebookcard.jsx's CardReader on an invented card, beside a drawn page,
 *     with the scorecard's "From the scorebook" label. Even a click sent
 *     straight at a control (as a script can, past `inert`) writes nothing;
 *   - the deck's own text is 12px or more and its controls 44px or more, in
 *     both themes, and the live slides fit a phone without a sideways scroll.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-deck.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { UPGRADES } from "../apps/web/src/data/roadmap.js";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(4328);
const API_PORT = port(8797);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_DECK_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, detail) => { if (c) pass++; else { fail++; console.log("  ✗", n, detail ? `— ${String(detail).slice(0, 200)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-deck-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext({ viewport: { width: 1380, height: 860 } });
await offline(ctx);
const page = await ctx.newPage();
const errors = [], refusals = [], sceneRequests = [], requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  const t = m.text();
  if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
  if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
});
// The three.js chunk is named after the module that imports it. Its name is
// the assertion: a static import anywhere in the entry graph and there is no
// such chunk, because the library is inside index-*.js.
page.on("request", (r) => {
  if (/\/assets\/scene-[^/]+\.js$/.test(r.url())) sceneRequests.push(r.url());
  requests.push({ method: r.method(), url: r.url(), at: Date.now() });
});
await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);

const text = () => page.$eval("body", (el) => el.innerText);
const click = async (re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const deck = () => page.locator('[data-testid="deck"]');
// A deck that crashed while rendering a slide is simply gone from the page,
// and the failure should name the error rather than wait thirty seconds for
// an element that will not return.
const slideNow = async () => (await deck().count()) ? deck().getAttribute("data-slide") : `(no deck: ${errors[0] ?? "no error logged"})`;
const stageMode = () => page.locator('[data-testid="deck-stage"]').getAttribute("data-mode");
const count = (sel) => page.locator(sel).count();
const press = async (key, ms = 900) => { await page.keyboard.press(key); await page.waitForTimeout(ms); };

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  // ── Getting there ───────────────────────────────────────────────
  group("The platform account opens the deck");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  // Not on the pilot's account list — it is not a school role — so the
  // address is typed, the way the login page allows.
  await page.locator('input[type="email"]').first().fill("platform@example.invalid");
  ok("Platform Ops signs in", await click(/^Sign In$/, 5000) && (await page.waitForTimeout(2000), /Dashboard|Match Centre/i.test(await text())));
  ok("the three.js chunk has not been fetched yet", sceneRequests.length === 0, sceneRequests[0]);
  const navBtn = page.locator("nav button", { hasText: /Pitch Deck/ }).first();
  ok("Pitch Deck is on the menu", await navBtn.count() === 1);
  await navBtn.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(2500);
  ok("the deck is on screen", await count('[data-testid="deck"]') === 1);
  ok("...and only now was the three.js chunk fetched, once", sceneRequests.length === 1, sceneRequests.join(", "));

  // ── The stage ───────────────────────────────────────────────────
  group("The stage says which way it is drawing, and draws that way");
  const initial = await stageMode();
  if (DEBUG) console.log("[debug] stage mode:", initial);
  ok("the stage settled on WebGL or the flat wheel, not loading", initial === "webgl" || initial === "fallback", initial);
  ok("WebGL means a canvas; the flat wheel means an SVG",
     initial === "webgl" ? (await count('[data-testid="deck-stage"] canvas')) === 1 && (await count('[data-testid="deck-stage"] svg')) === 0
                         : (await count('[data-testid="deck-stage"] svg')) === 1 && (await count('[data-testid="deck-stage"] canvas')) === 0);
  await page.locator('[data-testid="deck-3d-toggle"]').click();
  await page.waitForTimeout(700);
  ok("3D off swaps in the flat wheel", (await stageMode()) === "fallback" && (await count('[data-testid="deck-stage"] svg')) === 1 && (await count('[data-testid="deck-stage"] canvas')) === 0);
  await page.locator('[data-testid="deck-3d-toggle"]').click();
  await page.waitForTimeout(1500);
  ok("3D on restores what the browser had", (await stageMode()) === initial, await stageMode());
  ok("...without fetching the library again", sceneRequests.length === 1);

  // ── The keyboard ────────────────────────────────────────────────
  group("Every slide, from the keyboard");
  const order = ["cover", "problem", "wheel", "day", "field", "centre", "scorebook", "platform", "access", "care", "families", "safeguard", "school", "roadmap", "close"];
  ok("it opens on the cover", (await slideNow()) === "cover");
  for (let i = 1; i < order.length; i++) {
    await press("ArrowRight", 1100);
    const at = await slideNow();
    ok(`→ reaches ${order[i]}`, at === order[i] && (await count(`[data-testid="deck-slide-${order[i]}"]`)) === 1, at);
  }
  await press("ArrowRight", 400);
  ok("→ on the last slide stays put", (await slideNow()) === "close");
  await press("Home", 400);
  ok("Home returns to the cover", (await slideNow()) === "cover");
  await press("3", 900);
  ok("a digit goes straight to that slide", (await slideNow()) === "wheel");
  // The digits follow the slide order, one to nine; a tenth slide has no digit.
  for (const [k, id] of [["1", "cover"], ["2", "problem"], ["4", "day"], ["5", "field"], ["6", "centre"], ["7", "scorebook"], ["8", "platform"], ["9", "access"]]) {
    await press(k, 700);
    ok(`the digit ${k} is slide ${k}, ${id}`, (await slideNow()) === id, await slideNow());
  }
  await press("0", 400);
  ok("0 is not a slide", (await slideNow()) === "access");
  await press("3", 700);
  await press("ArrowLeft", 900);
  ok("← goes back one", (await slideNow()) === "problem");
  // The shell's search palette: keys typed there are typing, not navigation.
  await page.locator("button", { hasText: /Stats-Magic/ }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  const search = page.locator('input[aria-label*="Search" i]').first();
  ok("the search palette opens with its field", (await search.count()) === 1);
  if (await search.count()) {
    await search.focus();
    await press("ArrowRight", 400);
    ok("arrow keys inside a field do not turn the page", (await slideNow()) === "problem");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // ── The figures ─────────────────────────────────────────────────
  group("The figures are the figures");
  await press("3", 1200);
  const innings = await page.locator('[data-testid="deck-innings"]').innerText();
  ok("the wheel's scoreline is the seeded innings, 163/6", /^163\/6$/.test(innings.trim()), innings);
  const zone = page.locator('[data-testid^="deck-zone-"]').first();
  await zone.click();
  await page.waitForTimeout(300);
  ok("picking a sector marks it pressed", (await zone.getAttribute("aria-pressed")) === "true");
  await zone.click();
  await page.waitForTimeout(300);
  ok("...and picking it again releases it", (await zone.getAttribute("aria-pressed")) === "false");
  ok("no filter chip is offered for a line the wheel cannot draw", (await count('[data-testid="deck-key-W"]')) === 0);

  await deck().locator('[data-testid="deck-dot-school"]').click();
  await page.waitForTimeout(1800);
  ok("the school slide is reached from its dot (it has no digit)", (await slideNow()) === "school");
  const summary = page.locator('[data-testid="deck-summary"]');
  ok("the school slide's figures came from the server, not the demo", (await summary.getAttribute("data-live")) === "true");
  ok("...and say what they are scoped to", /summary read/i.test(await page.locator('[data-testid="deck-summary-source"]').innerText()));

  await deck().locator('[data-testid="deck-dot-roadmap"]').click();
  await page.waitForTimeout(1200);
  const want = Object.fromEntries(["shipped", "partial", "planned"].map((s) => [s, UPGRADES.filter((u) => u.status === s).length]));
  for (const st of Object.keys(want)) {
    const col = page.locator(`[data-testid="deck-roadmap-${st}"]`);
    const n = Number((await col.locator(".deck-num").innerText()).trim());
    ok(`the roadmap's ${st} count is Settings' own (${want[st]})`, n === want[st], n);
    ok(`...and lists that many items`, (await col.locator("button").count()) === want[st]);
  }

  // ── The live slides ─────────────────────────────────────────────
  //
  // Real components, on data built in the browser, in frames nobody can
  // operate. Every id below is one the component itself carries, so a slide
  // that quietly turned into a picture, or into a hand-drawn mock, fails here.
  const goTo = async (id) => { await deck().locator(`[data-testid="deck-dot-${id}"]`).click(); await page.waitForTimeout(1300); };
  const inertFrames = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="deck"] .deck-dev')].map((f) => ({
    id: f.getAttribute("data-testid"), inert: f.querySelector(".deck-dev-screen")?.inert === true,
    events: getComputedStyle(f.querySelector(".deck-dev-screen")).pointerEvents })));
  const windowStart = requests.length;

  group("On the field: the pad and its board, in two phone frames");
  await goTo("field");
  ok("the outcome frame and the area frame are both there",
     (await count('[data-testid="showcase-field-outcome"]')) === 1 && (await count('[data-testid="showcase-field-area"]')) === 1);
  ok("each holds the pad's own board", (await count('[data-testid="showcase-field-outcome"] [data-testid="pad-board"]')) === 1
     && (await count('[data-testid="showcase-field-area"] [data-testid="pad-board"]')) === 1);
  ok("the outcome frame is the pad at its third step, with the run keys and the wicket key",
     (await page.locator('[data-testid="showcase-field-outcome"] [data-testid="three-phase-pad"]').getAttribute("data-phase")) === "3"
     && (await count('[data-testid="showcase-field-outcome"] [data-testid="key-wicket"]')) === 1
     && (await count('[data-testid="showcase-field-outcome"] [data-testid="run-4"]')) === 1);
  ok("the area frame is the pad at its second step, with the field to tap",
     (await page.locator('[data-testid="showcase-field-area"] [data-testid="three-phase-pad"]').getAttribute("data-phase")) === "2"
     && (await count('[data-testid="showcase-field-area"] [data-testid="phase-area"]')) === 1);
  ok("the board says the chase, from the fold", /Need \d+ off \d+/.test(await page.locator('[data-testid="showcase-field-outcome"] [data-testid="pad-board"]').innerText()));
  ok("both frames are inert", (await inertFrames()).filter((f) => f.id.startsWith("showcase-field")).every((f) => f.inert && f.events === "none"));
  // A click sent past inert, straight at a control (a script can; a finger
  // cannot), records nothing: the pad's handlers here are `noop`s, and the pad
  // only resets its own local state, as it does after any ball.
  const before = requests.length;
  await page.locator('[data-testid="showcase-field-outcome"] [data-testid="run-4"]').dispatchEvent("click");
  await page.waitForTimeout(500);
  await page.locator('[data-testid="showcase-field-outcome"] [data-testid="key-wicket"]').dispatchEvent("click").catch(() => {});
  await page.locator('[data-testid="showcase-field-area"] [data-testid="area-none"]').dispatchEvent("click");
  await page.locator('[data-testid="showcase-field-area"] [data-testid="key-undo"]').dispatchEvent("click");
  await page.waitForTimeout(500);
  ok("a click sent at a run key, the didn't-travel key and undo sends nothing", requests.length === before, requests.slice(before).map((r) => `${r.method} ${r.url}`).join(", "));
  ok("...and the board is unchanged: the score is the log's, not the pad's", /Need \d+ off \d+/.test(await page.locator('[data-testid="showcase-field-outcome"] [data-testid="pad-board"]').innerText()));

  group("The Match Centre: the real tabs on a demonstration match");
  await goTo("centre");
  ok("a laptop frame at this width, holding the summary", (await page.locator('[data-testid="showcase-centre"]').getAttribute("data-kind")) === "laptop"
     && (await count('[data-testid="showcase-centre"] [data-testid="mc-summary"]')) === 1);
  ok("the summary has the board (card size) and the latest commentary", (await count('[data-testid="showcase-centre"] [data-testid="mc-board"]')) === 1
     && (await count('[data-testid="showcase-centre"] [data-testid="mc-latest"]')) === 1);
  for (const [tab, marker] of [["scorecard", "mc-scorecard"], ["commentary", "mc-commentary"], ["partnerships", "mc-partnerships"], ["analytics", "mc-analytics"]]) {
    await page.locator(`[data-testid="showcase-tab-${tab}"]`).click();
    await page.waitForTimeout(500);
    ok(`the ${tab} tab is the app's own (${marker})`, (await count(`[data-testid="showcase-centre"] [data-testid="${marker}"]`)) === 1
       && (await page.locator(`[data-testid="showcase-tab-${tab}"]`).getAttribute("aria-pressed")) === "true");
  }
  await page.locator('[data-testid="showcase-tab-scorecard"]').click();
  await page.waitForTimeout(400);
  const totals = await page.locator('[data-testid="showcase-centre"] [data-testid="mc-total"]').allInnerTexts();
  ok("the scorecard totals are the fold of the demonstration log (a chase, in progress)", totals.length >= 1 && /\d+\/\d+/.test(totals.join(" ")), totals.join(" | "));
  ok("the frame is inert", (await inertFrames()).filter((f) => f.id === "showcase-centre").every((f) => f.inert && f.events === "none"));

  group("For families: the parent's Me and a pupil's, on the real consent cards");
  await goTo("families");
  ok("both frames are there", (await count('[data-testid="showcase-families-parent"]')) === 1 && (await count('[data-testid="showcase-families-pupil"]')) === 1);
  ok("the parent's has the one-time ask and a switch for each child",
     (await count('[data-testid="showcase-families-parent"] [data-testid^="health-consent-prompt-deck-child"]')) >= 1
     && (await count('[data-testid="showcase-families-parent"] [data-testid^="health-consent-switch-"]')) === 2);
  ok("the pupil's has the eighteen card and his own row",
     (await count('[data-testid="showcase-families-pupil"] [data-testid="eighteen-card"]')) === 1
     && (await count('[data-testid="showcase-families-pupil"] [data-testid="health-consent-section"]')) === 1);
  ok("the switches are named", (await page.locator('[data-testid="showcase-families-parent"] [data-testid^="health-consent-switch-"]').first().getAttribute("aria-label")) !== null);
  const ids = await page.evaluate(() => { const all = [...document.querySelectorAll('[data-testid="deck"] [id]')].map((e) => e.id); return all.filter((x, i) => all.indexOf(x) !== i); });
  ok("no id is drawn twice on the slide", ids.length === 0, ids.join(", "));
  ok("both frames are inert", (await inertFrames()).filter((f) => f.id.startsWith("showcase-families")).every((f) => f.inert && f.events === "none"));
  const beforeFam = requests.length;
  for (const sel of ['[data-testid^="health-consent-switch-"]', '[data-testid="health-consent-prompt-yes-deck-child-a"]', '[data-testid="eighteen-yes"]', '[data-testid="eighteen-no"]']) {
    await page.locator(`[data-testid^="showcase-families"] ${sel}`).first().dispatchEvent("click");
  }
  await page.waitForTimeout(600);
  ok("a click sent at the switches, the ask and the eighteen card writes nothing", requests.length === beforeFam, requests.slice(beforeFam).map((r) => `${r.method} ${r.url}`).join(", "));
  // A switch that is On asks first (local state); the answer to that question is the write, and a drawn row does not send it.
  await page.locator('[data-testid="showcase-families-parent"] [data-testid="health-consent-stop"]').dispatchEvent("click").catch(() => {});
  await page.waitForTimeout(500);
  ok("...nor does the \"turn it off\" it opens", requests.length === beforeFam, requests.slice(beforeFam).map((r) => `${r.method} ${r.url}`).join(", "));

  group("Duty of care in the product: the real form and its receipt");
  await goTo("safeguard");
  ok("both frames are there", (await count('[data-testid="showcase-safeguard-form"]')) === 1 && (await count('[data-testid="showcase-safeguard-receipt"]')) === 1);
  ok("the form says the report is confidential, not anonymous",
     /confidential, not anonymous/i.test(await page.locator('[data-testid="showcase-safeguard-form"] [data-testid="sg-honesty"]').innerText()));
  ok("the form is the real one (the account field, the send key)", (await count('[data-testid="showcase-safeguard-form"] [data-testid="sg-account"]')) === 1
     && (await count('[data-testid="showcase-safeguard-form"] [data-testid="sg-send"]')) === 1);
  ok("the form is empty: nothing typed in, no concern shown", (await page.locator('[data-testid="sg-account"]').inputValue()) === "");
  ok("the receipt is a reference, marked as the demonstration's", /SG-DEMO-\d+/.test(await page.locator('[data-testid="showcase-safeguard-receipt"] [data-testid="sg-reference"]').innerText()));
  ok("both frames are inert", (await inertFrames()).filter((f) => f.id.startsWith("showcase-safeguard")).every((f) => f.inert && f.events === "none"));
  const beforeSg = requests.length;
  await page.locator('[data-testid="sg-send"]').dispatchEvent("click");
  await page.waitForTimeout(600);
  ok("a click sent at the send key sends nothing", requests.length === beforeSg, requests.slice(beforeSg).map((r) => `${r.method} ${r.url}`).join(", "));

  group("The coach's day: the real day sheet, on invented fixtures");
  await goTo("day");
  const day = '[data-testid="showcase-day"]';
  ok("a laptop frame at this width, holding the day sheet",
     (await page.locator(day).getAttribute("data-kind")) === "laptop" && (await count(`${day} [data-testid="day-sheet"]`)) === 1);
  ok("it is the coach's, and says it is a demonstration", /Coach/.test(await page.locator(`${day} h1`).innerText())
     && /Demonstration: invented fixtures and players/.test(await page.locator(`${day} [data-testid="day-sheet"]`).innerText()));
  ok("Now: the live fixture is on the board, from the fold of the demonstration chase",
     (await count(`${day} [data-testid="day-now"] [data-testid="day-board"]`)) === 1
     && /Need \d+ off \d+/.test(await page.locator(`${day} [data-testid="day-board"]`).innerText()));
  const nextTxt = await page.locator(`${day} [data-testid="day-next"]`).innerText();
  ok("Next fixture: the sides, the ground, the bus and the weather",
     /Riverside College 1st XI v Ashdown High 1st XI/.test(nextTxt) && /Ashdown High, Top Field/.test(nextTxt) && /Bus 10:45/.test(nextTxt) && /24° partly cloudy/.test(nextTxt), nextTxt);
  ok("...ready or not, in words: three on record and the ground report not",
     /Team sheet · on record/.test(await page.locator(`${day} [data-testid="ready-squad"]`).innerText())
     && /Transport · on record/.test(await page.locator(`${day} [data-testid="ready-transport"]`).innerText())
     && /Officials · on record/.test(await page.locator(`${day} [data-testid="ready-officials"]`).innerText())
     && /Ground report · nothing on record/.test(await page.locator(`${day} [data-testid="ready-ground"]`).innerText()));
  const outTxt = await page.locator(`${day} [data-testid="day-out"]`).innerText();
  ok("Who is out: two names and when each is back, nothing of the injury",
     (await count(`${day} [data-testid^="out-"]`)) === 2 && /Z Mahlangu/.test(outTxt) && /Y Coetzee/.test(outTxt) && /back /.test(outTxt) && !/hamstring|fracture|severity/i.test(outTxt), outTxt);
  ok("This week: the two fixtures and the two sessions",
     (await count(`${day} [data-testid^="week-fixture-"]`)) === 2 && (await count(`${day} [data-testid^="week-training-"]`)) === 2);
  ok("Alerts: the two unread ones", (await count(`${day} [data-testid^="alert-"]`)) === 2);
  ok("the frame is inert", (await inertFrames()).filter((f) => f.id === "showcase-day").every((f) => f.inert && f.events === "none"));
  const dayIds = await page.evaluate(() => { const all = [...document.querySelectorAll('[data-testid="deck"] [id]')].map((e) => e.id); return all.filter((x, i) => all.indexOf(x) !== i); });
  ok("no id is drawn twice on the slide", dayIds.length === 0, dayIds.join(", "));
  const beforeDay = requests.length;
  await page.locator(`${day} button`, { hasText: /Open scorer/ }).first().dispatchEvent("click");
  await page.waitForTimeout(500);
  ok("a click sent at \"Open scorer\" goes nowhere and sends nothing", requests.length === beforeDay && (await slideNow()) === "day", requests.slice(beforeDay).map((r) => `${r.method} ${r.url}`).join(", "));

  group("A paper scorebook, into the record: a drawn page beside the real card reader");
  await goTo("scorebook");
  const sb = '[data-testid="showcase-scorebook"]';
  ok("the page and the card's frame are both there", (await count('[data-testid="deck-scorebook-photo"]')) === 1 && (await count(sb)) === 1);
  ok("the page is a drawing, named, and no image is fetched for it",
     (await count('[data-testid="deck-scorebook-photo"] svg[role="img"]')) === 1 && (await count('[data-testid="deck-scorebook-photo"] img')) === 0
     && /invented/.test(await page.locator('[data-testid="deck-scorebook-photo"] figcaption').innerText()));
  ok("...with the same total written on it as the card holds", /168/.test(await page.locator('[data-testid="deck-scorebook-photo"] svg').textContent()));
  ok("the \"Read the pages\" hook is there, idle and empty",
     (await page.locator('[data-testid="deck-read-hook"]').getAttribute("data-state")) === "idle"
     && (await page.locator('[data-testid="deck-read-hook"]').evaluate((g) => g.childElementCount)) === 0
     && (await page.locator('[data-testid="deck-read-hook"]').getAttribute("data-hook")) === "read-the-pages");
  ok("the card is the app's own CardReader (its test ids)", (await count(`${sb} [data-testid="sb-read-0"]`)) === 1);
  const totalTxt = await page.locator(`${sb} [data-testid="sb-read-total-0"]`).innerText();
  ok("the card's total is 168 for 6 in 20 overs", /168 for 6 in 20 overs/.test(totalTxt), totalTxt);
  ok("the card lists its batters, and the extras it read", /T Mokoena/.test(await page.locator(`${sb} [data-testid="sb-read-0"]`).innerText())
     && /Extras: byes 2, leg byes 1, wides 5, no-balls 1, penalty 0/.test(await page.locator(`${sb} [data-testid="sb-read-extras-0"]`).innerText()));
  ok("the scorecard's \"From the scorebook\" label, with the same total",
     (await page.locator(`${sb} [data-testid="deck-from-scorebook"]`).innerText()).trim() === "From the scorebook"
     && /168\/6/.test(await page.locator(`${sb} [data-testid="deck-scorecard-head"]`).innerText()));
  ok("the frame is inert", (await inertFrames()).filter((f) => f.id === "showcase-scorebook").every((f) => f.inert && f.events === "none"));

  group("While the live slides were on screen, the browser made no request but static files");
  const web = `http://localhost:${WEB_PORT}/`;
  const stray = requests.slice(windowStart).filter((r) => !(r.method === "GET" && r.url.startsWith(web) && /\/assets\/|\.(js|css|jpg|png|svg|woff2?|map)$/.test(new URL(r.url).pathname)));
  ok("only GETs of the built assets", stray.length === 0, stray.slice(0, 3).map((r) => `${r.method} ${r.url}`).join(" · "));
  ok("...and none to the API", requests.slice(windowStart).every((r) => !r.url.startsWith(API)), requests.slice(windowStart).filter((r) => r.url.startsWith(API)).map((r) => r.url).join(", "));

  // ── Text and targets, in both themes ────────────────────────────
  group("The deck's own type is 12px or more and its controls 44px, in both themes");
  const audit = () => page.evaluate(() => {
    const small = [], short = [];
    const deckEl = document.querySelector('[data-testid="deck"]');
    const walker = document.createTreeWalker(deckEl, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || el.closest(".deck-dev-screen, svg, [data-testid='deck-stage']")) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 12) small.push(`${px}px ${n.textContent.trim().slice(0, 30)}`);
    }
    // The roadmap's list rows are disclosure lines in a list of dozens, not the
    // deck's controls (they are 25px, as they were): left out of the height rule.
    for (const b of deckEl.querySelectorAll("button")) {
      if (b.closest(".deck-dev-screen") || b.classList.contains("deck-dot") || b.closest('[data-testid^="deck-roadmap-"]')) continue;
      const r = b.getBoundingClientRect();
      if (r.height && r.height < 43.5) short.push(`${Math.round(r.height)}px ${(b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 24)}`);
    }
    return { small, short, screenBg: getComputedStyle(document.querySelector(".deck-dev-screen") ?? deckEl).backgroundColor };
  });
  const bgs = {};
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(600);
    for (const id of ["cover", "wheel", "day", "field", "centre", "scorebook", "families", "safeguard", "roadmap", "close"]) {
      await goTo(id);
      const a = await audit();
      ok(`${scheme}: ${id} has no deck text under 12px`, a.small.length === 0, a.small.slice(0, 3).join(" · "));
      ok(`${scheme}: ${id} has no deck control under 44px`, a.short.length === 0, a.short.slice(0, 3).join(" · "));
      if (id === "field") bgs[scheme] = a.screenBg;
    }
    await goTo("field");
    ok(`${scheme}: the frames still draw the pad`, (await count('[data-testid="showcase-field-outcome"] [data-testid="pad-board"]')) === 1 && (await count('[data-testid="showcase-field-area"] [data-testid="phase-area"]')) === 1);
  }
  ok("the two themes give the frames' screens different surfaces (the tokens are read live)", bgs.light !== bgs.dark, JSON.stringify(bgs));

  group("Reduced motion");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await goTo("centre");
  ok("a slide's entrance is cut to a cut", await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid^="deck-slide-"]')).animationDuration) <= 0.002));
  await page.emulateMedia({ reducedMotion: "no-preference" });

  group("At phone width the frames stack and scale, and nothing scrolls sideways");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  for (const id of ["day", "field", "centre", "scorebook", "families", "safeguard"]) {
    await goTo(id);
    const m = await page.evaluate(() => {
      const frames = [...document.querySelectorAll('[data-testid="deck"] .deck-dev')].map((f) => { const r = f.getBoundingClientRect(); const fr = f.querySelector(".deck-dev-frame").getBoundingClientRect(); return { kind: f.getAttribute("data-kind"), top: r.top + scrollY, left: fr.left, right: fr.right, w: fr.width }; });
      return { frames, over: document.documentElement.scrollWidth - innerWidth };
    });
    ok(`${id}: every frame fits inside the screen`, m.frames.length > 0 && m.frames.every((f) => f.left >= -1 && f.right <= 391), JSON.stringify(m.frames));
    ok(`${id}: no sideways scroll`, m.over <= 1, m.over);
    ok(`${id}: frames stack, one under the other`, m.frames.length < 2 || m.frames.every((f, i) => i === 0 || f.top > m.frames[i - 1].top + 50), JSON.stringify(m.frames));
    if (id === "centre") ok("the Match Centre is drawn on a phone frame at this width", m.frames[0]?.kind === "phone", m.frames[0]?.kind);
    if (id === "day") {
      ok("the day sheet is drawn on a phone frame at this width", m.frames[0]?.kind === "phone", m.frames[0]?.kind);
      // The app's grid answers to the window, a frame to its own width: the tiles stack in one column.
      ok("...and its tiles are one column, not a desktop grid",
         await page.evaluate(() => { const a = document.querySelector('[data-testid="showcase-day"] [data-testid="day-next"]'), b = document.querySelector('[data-testid="showcase-day"] [data-testid="day-out"]');
           return !!a && !!b && a.offsetWidth > 300 && b.offsetTop > a.offsetTop; }));
    }
  }
  await page.setViewportSize({ width: 1380, height: 860 });
  await page.waitForTimeout(500);

  // ── Names, errors ───────────────────────────────────────────────
  group("Every control is named, and nothing went wrong");
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="deck"] button, [data-testid="deck"] a[href]')]
      .filter((el) => !(el.getAttribute("aria-label") || el.textContent.replace(/\s+/g, " ").trim()))
      .map((el) => el.outerHTML.slice(0, 80)));
  ok("every button on the deck has a name", unnamed.length === 0, unnamed.slice(0, 3).join(" · "));
  ok("no screen asked the browser to scope for it", refusals.length === 0, refusals[0]);
  ok("the browser logged no errors", errors.length === 0, errors[0]);
} catch (e) {
  fail++;
  console.log("  ✗ walk aborted:", e.message);
} finally {
  await browser.close().catch(() => {});
  web.close();
  api.kill();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}

console.log("\n" + "─".repeat(52));
console.log(`BROWSER DECK SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

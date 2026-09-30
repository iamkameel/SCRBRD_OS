#!/usr/bin/env node
/**
 * The scorebook importer's three screens, in a real browser (SCRBRD-120,
 * phase 1: Match Centre → a played fixture → "Import from a scorebook"),
 * against a real API and Postgres. tools/smoke-scorebook.mjs walks the API;
 * this walks the pages a scorer and a director of sport use.
 *
 *   0  THE ENTRY POINT is drawn only when the API lists the fixture's imports:
 *      with the module off the scorer sees nothing; with it on, a parent
 *      (no capability at all) sees nothing.
 *   A  THE SCORER opens an import and adds pages: a text file and a photo far
 *      over the limit are refused in plain words, a JPEG and a PNG are taken;
 *      the pages are shown from the API into memory (never storage, never an
 *      address), each read on access_log.
 *   B  THE CARD is typed beside the pages: our boys picked from the roster,
 *      the opposition's names typed (they become t:<n> keys, never players);
 *      a total that does not add up is refused beside the cell, and the
 *      book's difference can be recorded as a footnote instead; a tick per
 *      cell; submitting with cells unticked is refused in words; a save over
 *      somebody else's is refused and the latest is loaded; submitted.
 *   C  THE SCORER cannot confirm: no button, the reason in words, and the API
 *      says no.
 *   D  THE DIRECTOR OF SPORT reads the card beside the pages, read-only;
 *      returns it (a note of ten characters first), the scorer sees the note
 *      and changes the card, and the director confirms, after asking once in
 *      the page. The match is complete; its scorecard says "From the
 *      scorebook".
 *   E  A CARD THAT DOES NOT ADD UP (the book's own difference, recorded): the
 *      confirmer sees the footnote, must acknowledge it, and the scorecard
 *      carries it.
 *   F  A PERSON WHO WORKED ON THE CARD (the owner's key holds both halves)
 *      is told why she cannot confirm, not given a dead button.
 *   G  Nothing under 12px, nothing pressed under 44px, no sideways scroll at
 *      390 wide, in Daylight too; no console error, no browser dialog.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-scorebook.mjs
 *   BROWSER_SB_DEBUG=1 node tools/smoke-browser-scorebook.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import pg from "pg";
import { cellPaths } from "@scrbrd/scoring";
import { baseCard, TYPED } from "../packages/scoring/test/scorebook-cards.mjs";
import { jpegWithMetadata, pngWithMetadata } from "../services/api/io/test-images.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(5394);
const API_PORT = port(8894);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_SB_DEBUG;
const DIST = process.env.SB_DIST || "apps/web/dist";
const HIL = "11111111-1111-1111-1111-111111111111";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const P = ["01", "02", "03", "04", "05", "11"].map((n) => `aaaaaaaa-0000-0000-0000-0000000000${n}`);
const STORE = mkdtempSync(join(tmpdir(), "scrbrd-walk-scorebook-"));
const FILES = mkdtempSync(join(tmpdir(), "scrbrd-walk-photos-"));

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "browser-scorebook-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
         SCOREBOOK_STORE_DIR: STORE, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  let body, type;
  try {
    const f = join(DIST, url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = TYPES[extname(f)] ?? "application/octet-stream";
  } catch {
    body = await readFile(join(DIST, "index.html"));
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, r));

const pool = new pg.Pool({ connectionString: ownerUrl() });
const dbq = async (text, params) => (await pool.query(text, params)).rows;
const call = async (path, { method = "GET", token, body } = {}) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
                                       body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const devLogin = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: `sb-walk-${email}` } })).body?.token;
const fixture = async (days = -2) => (await dbq(
  `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
   values ($1, '1XI', 'Northwood Prep', (sa_today() + $2::int)::timestamp AT TIME ZONE 'Africa/Johannesburg' + interval '10 hours', 'T20', 20, 'scheduled')
   returning id`, [HIL, days]))[0].id;
const allTicked = (cards) => Object.fromEntries(cellPaths(cards).map((p) => [p, true]));

/** Every page's console errors, for the report when the walk throws. */
const allErrors = [];
const browser = await chromium.launch({ ...launchOptions() });
async function open(theme = "floodlit", viewport = { width: 1280, height: 1000 }) {
  const ctx = await browser.newContext({ viewport });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  allErrors.push(errors);
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.type()); d.dismiss().catch(() => {}); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};
    try { localStorage.setItem("scrbrd:theme", ${JSON.stringify(theme)}); } catch (e) {}`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, dialogs };
}
const text = (page) => page.$eval("body", (el) => el.innerText);
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const said = async (page, id) => ((await tid(page, id).first().innerText({ timeout: 2500 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tap = async (page, id, ms = 4000) => { await tid(page, id).first().click({ timeout: ms }); await page.waitForTimeout(250); };
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return (await page.locator("nav button").count()) > 0;
}
async function nav(page, label) {
  const l = page.locator("nav button", { hasText: label }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return true;
}
/** Matches → the fixture's card, opened to its side panel. */
async function toFixture(page, id) {
  if (!(await nav(page, /^Matches$|^Match Centre$/))) return false;
  const card = tid(page, `match-card-${id}`);
  await card.waitFor({ timeout: 8000 }).catch(() => {});
  if (!(await card.count())) return false;
  await card.click();
  await page.waitForTimeout(1200);
  return true;
}
/** Every text node under the root, and every control, measured as drawn. */
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA|SUMMARY)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type)) || (n.tagName === "A" && n.getAttribute("href"))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, bg: getComputedStyle(document.body).backgroundColor, sideways: document.documentElement.scrollWidth - window.innerWidth };
  }).catch(() => ({ small: ["(not drawn)"], tiny: [], bg: "", sideways: 0 }));
}
const shot = async (page, name) => { if (process.env.BROWSER_SB_SHOTS) await page.screenshot({ path: join(process.env.BROWSER_SB_SHOTS, `${name}.png`), fullPage: true }).catch(() => {}); };
const floorsOk = (f) => f.small.length === 0 && f.tiny.length === 0;
const floorsWhy = (f) => [...f.small, ...f.tiny].slice(0, 4).join(" · ");

/** A count or overs typed into a cell. */
const put = async (page, cell, value) => { await tid(page, `sb-in-${cell}`).fill(String(value)); };
/** A name typed into an opposition cell, kept when the box is left. */
const name = async (page, cell, value) => { const el = tid(page, `sb-in-${cell}`); await el.fill(value); await el.press("Tab"); await page.waitForTimeout(120); };
/** Photos are sent one after another: wait until the screen says it has finished. */
const uploaded = async (page) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !/Adding photos/.test(document.querySelector('[data-testid="sb-upload-status"]')?.innerText ?? ""), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
};
const pick = async (page, cell, value) => { await tid(page, `sb-in-${cell}`).selectOption(value); };
const tickEverything = (page) => page.evaluate(() => document.querySelectorAll('[data-testid^="sb-tick-"]:not(:checked)').forEach((e) => e.click()));

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const scorerTok = await devLogin("scorer@example.invalid");
  const coachTok = await devLogin("coach@example.invalid");
  const sarahTok = await devLogin("sarah@example.invalid");
  const ownerTok = await devLogin("owner@example.invalid");
  const names = Object.fromEntries((await dbq(`select id, full_name from player where id = any($1::uuid[])`, [P])).map((r) => [r.id, r.full_name]));

  // the photos: a text file, a photo far over the limit, a JPEG, a PNG
  const jpg = join(FILES, "page-one.jpg"), png = join(FILES, "page-two.png"), txt = join(FILES, "notes.txt"), big = join(FILES, "huge.jpg");
  writeFileSync(jpg, jpegWithMetadata({ salt: 1 }));
  writeFileSync(png, pngWithMetadata({ salt: 2 }));
  writeFileSync(txt, "not a photo");
  writeFileSync(big, Buffer.concat([jpegWithMetadata({ salt: 3 }), Buffer.alloc(9 * 1024 * 1024)]));

  // A walk can be run again on the same database: the module starts off.
  await dbq(`delete from feature_grant where key = 'scorebook_import' and school_id = $1`, [HIL]);
  const M = await fixture();

  // ── 0 ──────────────────────────────────────────────────────────
  group("0. The entry point is drawn only where the API lists the fixture's imports");
  const off = await open();
  ok("the scorer signs in", await signIn(off.page, "scorer@example.invalid"));
  ok("Matches → the played fixture's panel", await toFixture(off.page, M));
  await off.page.waitForTimeout(800);
  ok("with the module off, the scorer is offered nothing (the API answers module_disabled)", (await tid(off.page, "scorebook-panel").count()) === 0 && (await tid(off.page, "sb-start").count()) === 0);
  await off.ctx.close().catch(() => {});
  await dbq(`insert into feature_grant (key, school_id, granted, note) values ('scorebook_import', $1, true, 'smoke-browser-scorebook')`, [HIL]);
  const pa = await open();
  ok("a parent signs in", await signIn(pa.page, "parent@example.invalid"));
  const parentSees = await toFixture(pa.page, M);
  await pa.page.waitForTimeout(800);
  ok("with the module on, a parent sees the fixture and no scorebook entry point", parentSees && (await tid(pa.page, "scorebook-panel").count()) === 0 && (await tid(pa.page, "sb-start").count()) === 0);
  ok("no console errors (parent)", pa.errors.length === 0, pa.errors.join(" | "));
  await pa.ctx.close().catch(() => {});

  // ── A ──────────────────────────────────────────────────────────
  group("A. The scorer: an import, and its pages");
  const sc = await open();
  const p = sc.page;
  ok("the scorer signs in", await signIn(p, "scorer@example.invalid"));
  ok("Matches → the played fixture's panel", await toFixture(p, M));
  await tid(p, "sb-start").waitFor({ timeout: 6000 }).catch(() => {});
  ok("the fixture offers 'Import from a scorebook'", (await tid(p, "sb-start").count()) === 1 && (await tid(p, "scorebook-panel").count()) === 1);
  await tap(p, "sb-start");
  await tid(p, "sb-upload").waitFor({ timeout: 6000 }).catch(() => {});
  const I = (await dbq(`select id, state from scorebook_import where match_id = $1`, [M]))[0];
  ok("the import is open, a draft, and the upload screen is showing", I?.state === "draft" && (await tid(p, "sb-upload").count()) === 1, JSON.stringify(I));
  ok("the pages are children's names: it says how they are kept", /kept privately/.test(await text(p)));
  await p.setInputFiles('[data-testid="sb-file"]', txt);
  await uploaded(p);
  ok("a text file is refused in plain words (415), and nothing is stored", /not a JPEG or PNG photo/.test(await said(p, "sb-upload-refused")) && !/not_an_image/.test(await text(p))
     && (await dbq(`select 1 from scorebook_import_page where import_id = $1`, [I.id])).length === 0, await said(p, "sb-upload-status"));
  await p.setInputFiles('[data-testid="sb-file"]', big);
  await uploaded(p);
  ok("a photo far over the limit is refused in plain words (413): 8 MB, take it again", /8 MB/.test(await said(p, "sb-upload-refused")) && !/page_too_large|payload_too_large/.test(await said(p, "sb-upload-refused")), await said(p, "sb-upload-status"));
  await p.setInputFiles('[data-testid="sb-file"]', [jpg, png]);
  await uploaded(p);
  const ups = await p.locator('[data-testid="sb-upload-ok"]').allInnerTexts();
  ok("a JPEG and a PNG are taken, as pages 1 and 2", ups.length === 2 && /page 1/.test(ups[0]) && /page 2/.test(ups[1]), JSON.stringify(ups));
  ok("two pages are stored, under the school and the import", (await dbq(`select 1 from scorebook_import_page where import_id = $1`, [I.id])).length === 2
     && readdirSync(join(STORE, HIL, I.id)).length === 2);
  await tid(p, "sb-thumb-2").waitFor({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(800);
  ok("both pages are shown as thumbnails, from memory (blob URLs)", (await p.locator('[data-testid^="sb-thumb-img-"]').count()) === 2
     && (await p.$$eval('[data-testid^="sb-thumb-img-"]', (im) => im.every((i) => i.src.startsWith("blob:")))));
  await tap(p, "sb-thumb-2");
  ok("page 2 is shown large, with a name for a screen reader, and can be zoomed", (await p.locator('[data-testid="sb-page-img"]').getAttribute("alt")) === "Photo of scorebook page 2"
     && (await p.$eval('[data-testid="sb-page-img"]', (i) => i.naturalWidth)) === 8);
  await tap(p, "sb-zoom-in");
  ok("...zoom widens the page inside its own scrolling box", (await p.$eval('[data-testid="sb-page-img"]', (i) => i.style.width)) === "150%");
  const reads = await dbq(`select fields from access_log where resource = 'scorebook_page' and $1 = any(record_ids)`, [I.id]);
  ok("each page read wrote access_log (page:1, page:2)", reads.length >= 2 && reads.some((r) => r.fields?.[0] === "page:1") && reads.some((r) => r.fields?.[0] === "page:2"), JSON.stringify(reads));
  const stores = await p.evaluate(async () => {
    const dump = [];
    for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) dump.push(s.key(i) + "=" + s.getItem(s.key(i)));
    const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [];
    return { dump: dump.join("\n"), dbs, url: location.href };
  });
  ok("no page image is in localStorage, sessionStorage or an address", !/blob:|data:image|\/9j\/|iVBOR|scorebook\/[0-9a-f-]{36}\/pages/.test(stores.dump + stores.url), stores.dump.slice(0, 200));
  ok("...and no IndexedDB database was made for one", !stores.dbs.some((n) => /scorebook|page|photo/i.test(String(n))), JSON.stringify(stores.dbs));
  await shot(p, "1-upload");
  const fUp = await floors(p, "sb-root");
  ok("the upload screen: nothing under 12px, nothing pressed under 44px", floorsOk(fUp), floorsWhy(fUp));

  // ── B ──────────────────────────────────────────────────────────
  group("B. The card, typed beside the pages");
  await tap(p, "sb-next");
  await tid(p, "sb-review").waitFor({ timeout: 5000 }).catch(() => {});
  ok("the review screen: the pages beside an empty card", (await tid(p, "sb-review").count()) === 1 && (await tid(p, "sb-photos").count()) === 1 && (await tid(p, "sb-empty-card").count()) === 1);
  ok("no innings has deliveries, so nothing is said about any", (await tid(p, "sb-live-innings").count()) === 0);
  await tap(p, "sb-add-innings-go");
  ok("an innings is added: every figure empty, not nought", (await tid(p, "sb-card-0").count()) === 1 && (await tid(p, "sb-in-0.total").inputValue()) === "");
  // the scalars, the extras
  await put(p, "0.total", 80); await put(p, "0.wickets", 2); await put(p, "0.overs", "8");
  await pick(p, "0.endReason", "declared");
  await put(p, "0.extras.byes", 1); await put(p, "0.extras.legByes", 0); await put(p, "0.extras.wides", 3); await put(p, "0.extras.noBalls", 0); await put(p, "0.extras.penalty", 0);
  // the opposition's bowlers, typed
  await tap(p, "sb-add-bowler-0"); await tap(p, "sb-add-bowler-0");
  await name(p, "0.bowling.0.ref", "Opp Bowler Two"); await name(p, "0.bowling.1.ref", "Opp Bowler Three");
  await put(p, "0.bowling.0.overs", "5"); await put(p, "0.bowling.0.maidens", 0); await put(p, "0.bowling.0.runs", 40); await put(p, "0.bowling.0.wickets", 2); await put(p, "0.bowling.0.wides", 3); await put(p, "0.bowling.0.noBalls", 0);
  await put(p, "0.bowling.1.overs", "3"); await put(p, "0.bowling.1.runs", 34); await put(p, "0.bowling.1.wickets", 0);
  // our four batters, from the roster
  for (let i = 0; i < 4; i++) await tap(p, "sb-add-batter-0");
  const roster = await tid(p, "sb-in-0.batting.0.ref").locator("option").allInnerTexts();
  ok("our boys are chosen from the roster: the fixture's team first, the school's other players after", roster.includes(names[P[0]]) && roster.includes(names[P[5]]), roster.join("|"));
  ok("...and a bowler cell offers only the bowlers of this card", JSON.stringify(await tid(p, "sb-in-0.batting.0.bowlerRef").locator("option").allInnerTexts()) === JSON.stringify(["No bowler", "Opp Bowler Two", "Opp Bowler Three"]));
  for (let i = 0; i < 4; i++) await pick(p, `0.batting.${i}.ref`, P[i]);
  await pick(p, "0.batting.0.howOut", "caught"); await name(p, "0.batting.0.fielderRef", "Opp Fielder One"); await pick(p, "0.batting.0.bowlerRef", { label: "Opp Bowler Two" });
  await pick(p, "0.batting.1.howOut", "bowled"); await pick(p, "0.batting.1.bowlerRef", { label: "Opp Bowler Two" });
  await pick(p, "0.batting.2.howOut", "not_out"); await pick(p, "0.batting.3.howOut", "not_out");
  await put(p, "0.batting.0.runs", 34); await put(p, "0.batting.0.balls", 40); await put(p, "0.batting.0.fours", 4); await put(p, "0.batting.0.sixes", 1);
  await put(p, "0.batting.1.runs", 12); await put(p, "0.batting.1.balls", 15); await put(p, "0.batting.1.fours", 1); await put(p, "0.batting.1.sixes", 0);
  await put(p, "0.batting.2.runs", 20); await put(p, "0.batting.3.runs", 5);
  await tap(p, "sb-add-dnb-0"); await pick(p, "0.didNotBat.0", P[4]);
  await p.waitForTimeout(300);
  ok("a typed name is one person: the fielder's name is kept and shown", (await tid(p, "sb-in-0.batting.0.fielderRef").inputValue()) === "Opp Fielder One");
  ok("a blank number is null, not nought: the balls of batter 3 stay empty", (await tid(p, "sb-in-0.batting.2.balls").inputValue()) === "");

  // the arithmetic, beside the cell
  const tot = await said(p, "sb-err-0.total");
  ok("a total that does not add up is refused beside the cell, in words", /do not add up to the total/.test(tot) && !/batting_plus_extras/.test(tot), tot);
  ok("...and listed with the innings and the cell named", /Innings 1, total: /.test(await said(p, "sb-problems")), await said(p, "sb-problems"));
  ok("...and the panel shows the sums: 71 + 4 = 75, the book says 80", /Batters' runs 71 \+ extras 4 = 75\. The book's total is 80\. They differ by 5\./.test(await said(p, "sb-sums-0")), await said(p, "sb-sums-0"));
  await tap(p, "sb-record-diff-0");
  ok("the book's difference can be recorded instead: a footnote, and a note is asked for", /differ from its total by 5 runs/.test(await said(p, "sb-footnote-0")) && /3 characters/.test(await text(p)) && /not a figure the scorecard can hold/.test(await said(p, "sb-err-0.unreconciled")), await said(p, "sb-err-0.unreconciled"));
  await tid(p, "sb-diffnote-0").fill("the book is out by five");
  ok("...with a note the recorded difference is accepted (the bowling, at 80, still is not: it is listed)", (await tid(p, "sb-err-0.unreconciled").count()) === 0 && /The recorded difference/.test(await said(p, "sb-problems")) === false && /bowlers, with the byes/.test(await said(p, "sb-err-0.bowling")), await said(p, "sb-err-0.bowling"));
  await tap(p, "sb-clear-diff-0");
  await put(p, "0.total", 75);
  ok("corrected to 75 (with the difference removed): nothing is refused", (await tid(p, "sb-err-0.total").count()) === 0 && (await tid(p, "sb-problems").count()) === 0 && /They agree/.test(await said(p, "sb-sums-0")), await said(p, "sb-sums-0"));
  await put(p, "0.batting.2.runs", 99);
  ok("boundaries and wickets are asked as she types: 99 for batter 3 breaks the sum", /do not add up/.test(await said(p, "sb-err-0.total")));
  await put(p, "0.batting.2.runs", 20);

  // ticks
  ok("editing ticked what was edited; the rest still needs a tick", /^\d+ of \d+ cells checked$/.test(await said(p, "sb-progress")) && !/^(\d+) of \1 /.test(await said(p, "sb-progress")), await said(p, "sb-progress"));
  await tap(p, "sb-tickrow-0.batting.3");
  ok("'Tick every cell of batter 4' ticks all eight of his cells", (await p.locator('[data-testid="sb-batter-0.3"] input[type=checkbox]:checked').count()) === 8);
  await tap(p, "sb-submit");
  ok("submitting with cells unticked is refused in words, with a count", /cells? still needs? a tick before the card can be submitted/.test(await said(p, "sb-status")), await said(p, "sb-status"));
  ok("...and each unticked cell says 'Still to check'", (await p.locator('[data-testid^="sb-missing-"]').count()) > 5);
  ok("...nothing was submitted", (await dbq(`select state from scorebook_import where id = $1`, [I.id]))[0].state !== "submitted");
  await shot(p, "2-review");
  await tickEverything(p);
  await p.waitForTimeout(300);
  ok("with every cell ticked the count is complete", /^(\d+) of \1 cells checked$/.test(await said(p, "sb-progress")), await said(p, "sb-progress"));
  await tap(p, "sb-save");
  await p.waitForTimeout(700);
  ok("Save keeps it: 'Saved', and the database holds the card and every tick", /^Saved/.test(await said(p, "sb-status")) && /All changes are saved/.test(await said(p, "sb-dirty")), await said(p, "sb-status"));
  const saved = (await call(`/api/scorebook/${I.id}`, { token: scorerTok })).body;
  ok("...as a card the API reads: 75 for 2, opposition names in the typed map only, none unchecked",
     saved.import.cards[0].total === 75 && saved.import.cards[0].wickets === 2 && saved.unchecked.length === 0 && saved.cells > 40
     && Object.values(saved.import.typed).sort().join() === "Opp Bowler Three,Opp Bowler Two,Opp Fielder One", JSON.stringify(saved.import.typed));
  ok("...and no typed name became a player", (await dbq(`select 1 from player where full_name = any($1::text[])`, [["Opp Bowler Two", "Opp Bowler Three", "Opp Fielder One"]])).length === 0);
  ok("...the batters are our players by id, the bowlers typed keys", saved.import.cards[0].batting[0].ref === P[0] && /^t:\d+$/.test(saved.import.cards[0].bowling[0].ref));

  // a save over somebody else's
  const other = await call(`/api/scorebook/${I.id}/save`, { method: "POST", token: coachTok,
    body: { cards: saved.import.cards, typed: saved.import.typed, checked: saved.import.checked, version: saved.import.version } });
  ok("(the coach saves the same import first)", other.status === 200, JSON.stringify(other.body));
  await put(p, "0.extras.wides", 4);
  await tap(p, "sb-save");
  await p.waitForTimeout(900);
  ok("a stale save is refused in words, and the latest is loaded rather than overwritten", /changed by someone else since you opened it/.test(await said(p, "sb-status")) && !/version_conflict/.test(await said(p, "sb-status"))
     && (await tid(p, "sb-in-0.extras.wides").inputValue()) === "3", await said(p, "sb-status"));

  // submit
  await tap(p, "sb-submit");
  await p.waitForTimeout(1500);
  ok("submitted: the state and the words say so, and the card can no longer be edited", (await tid(p, "sb-root").getAttribute("data-state")) === "submitted" && /^Submitted/.test(await said(p, "sb-status"))
     && (await p.locator('[data-testid^="sb-in-"]').count()) === 0, await said(p, "sb-status"));
  ok("...in the database, by the scorer", (await dbq(`select state, submitted_by from scorebook_import where id = $1`, [I.id]))[0].state === "submitted");

  // ── C ──────────────────────────────────────────────────────────
  group("C. The scorer cannot confirm");
  ok("she is told who confirms, and no confirm or return control is drawn", /Waiting to be confirmed/.test(await said(p, "sb-waiting")) && (await tid(p, "sb-confirm-go").count()) === 0 && (await tid(p, "sb-return-go").count()) === 0);
  ok("the API says no as well (not_permitted)", (await call(`/api/scorebook/${I.id}/confirm`, { method: "POST", token: scorerTok, body: {} })).status === 403);
  ok("nothing is written to the match", (await dbq(`select count(*)::int as n from ball_event where match_id = $1`, [M]))[0].n === 0);
  ok("the read-only card is there for her to see, beside the pages", (await tid(p, "sb-cards-read").count()) === 1 && /Innings 1/.test(await said(p, "sb-read-0")) && (await tid(p, "sb-photos").count()) === 1);
  ok("no console errors (scorer, so far)", sc.errors.length === 0, sc.errors.join(" | "));

  // ── D ──────────────────────────────────────────────────────────
  group("D. The director of sport: read, return, confirm");
  const dr = await open();
  const d = dr.page;
  ok("the director of sport signs in", await signIn(d, "sarah@example.invalid"));
  ok("Matches → the fixture's panel", await toFixture(d, M));
  await tid(d, "scorebook-panel").waitFor({ timeout: 6000 }).catch(() => {});
  ok("the panel says: submitted, 2 pages; the way in is 'Review and confirm'; there is no new import to start", /Submitted/.test(await said(d, "sb-import-state")) && /2 pages/.test(await said(d, "sb-import-state"))
     && (await tid(d, `sb-open-${I.id}`).innerText()) === "Review and confirm" && (await tid(d, "sb-start").count()) === 0);
  await tap(d, `sb-open-${I.id}`);
  await tid(d, "sb-confirm").waitFor({ timeout: 6000 }).catch(() => {});
  await d.waitForTimeout(1000);
  ok("the confirm screen: the card read-only beside the pages", (await tid(d, "sb-confirm").count()) === 1 && (await tid(d, "sb-photos").count()) === 1 && (await d.locator('[data-testid^="sb-in-"]').count()) === 0);
  const readTxt = await text(d);
  ok("...our boys by name from the roster, the opposition's as typed, the figures as the book gave them",
     readTxt.includes(names[P[0]]) && readTxt.includes("Opp Bowler Two") && readTxt.includes("Opp Fielder One") && /75 for 2 in 8 overs/.test(await said(d, "sb-read-total-0")), await said(d, "sb-read-total-0"));
  ok("...a figure the book did not give is a dash, not a nought: batter 3's balls", (await d.locator('[data-testid="sb-read-0"] tbody tr').nth(2).locator("td").nth(2).innerText()).trim() === "–");
  ok("...and says every cell was checked", /(\d+) of \1 cells were checked/.test(await said(d, "sb-ticks")), await said(d, "sb-ticks"));
  ok("she is offered Confirm and Return; there is no acknowledgement to tick (the book adds up)", (await tid(d, "sb-confirm-go").count()) === 1 && (await tid(d, "sb-return-go").count()) === 1 && (await tid(d, "sb-ack").count()) === 0);
  await shot(d, "3-confirm");
  const fCf = await floors(d, "sb-root");
  ok("the confirm screen: nothing under 12px, nothing pressed under 44px", floorsOk(fCf), floorsWhy(fCf));

  await tap(d, "sb-return-go");
  await tid(d, "sb-return-note").fill("too short");
  await tap(d, "sb-return-send");
  await d.waitForTimeout(600);
  ok("a return needs a reason of ten characters, in words", /at least ten characters/.test(await said(d, "sb-status")) && !/note_required/.test(await said(d, "sb-status")), await said(d, "sb-status"));
  await tid(d, "sb-return-note").fill("Bowler three conceded one more; check the wides");
  await tap(d, "sb-return-send");
  await d.waitForTimeout(1000);
  ok("returned with a note: the state says so", (await tid(d, "sb-root").getAttribute("data-state")) === "returned" && /^Returned to the scorer/.test(await said(d, "sb-status")));
  ok("...and she could not have changed a figure: there was never an input", (await d.locator('[data-testid^="sb-in-"]').count()) === 0);
  await dr.ctx.close().catch(() => {});

  // the scorer sees the note and corrects
  await tap(p, "sb-back");
  await tid(p, `sb-open-${I.id}`).waitFor({ timeout: 6000 }).catch(() => {});
  ok("the way in is 'Continue the import'", (await tid(p, `sb-open-${I.id}`).innerText()) === "Continue the import");
  await tap(p, `sb-open-${I.id}`);
  await tid(p, "sb-review").waitFor({ timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(800);
  ok("the review screen opens on the card, with the director's note at the top", /Bowler three conceded one more/.test(await said(p, "sb-returned-note")) && (await tid(p, "sb-in-0.total").inputValue()) === "75");
  await put(p, "0.extras.wides", 4); await put(p, "0.bowling.1.runs", 35); await put(p, "0.total", 76);
  await tap(p, "sb-submit");
  await p.waitForTimeout(1800);
  ok("corrected and submitted again", (await tid(p, "sb-root").getAttribute("data-state")) === "submitted" && (await dbq(`select state from scorebook_import where id = $1`, [I.id]))[0].state === "submitted", await said(p, "sb-status"));
  ok("the revision chain shows both people", (await dbq(`select distinct actor_id from scorebook_import_revision where import_id = $1`, [I.id])).length >= 2);
  await sc.ctx.close().catch(() => {});

  const dr2 = await open();
  const e = dr2.page;
  ok("the director of sport signs in again", await signIn(e, "sarah@example.invalid"));
  ok("Matches → the fixture → Review and confirm", await toFixture(e, M) && (await (async () => { await tid(e, `sb-open-${I.id}`).waitFor({ timeout: 6000 }).catch(() => {}); await tap(e, `sb-open-${I.id}`); await tid(e, "sb-confirm").waitFor({ timeout: 6000 }).catch(() => {}); return true; })()));
  await e.waitForTimeout(800);
  ok("she sees the corrected card", /76 for 2 in 8 overs/.test(await said(e, "sb-read-total-0")), await said(e, "sb-read-total-0"));
  await tap(e, "sb-confirm-go");
  ok("Confirm asks first, in the page, and says what it does", /completes the match|cannot be undone/.test(await said(e, "sb-confirm-ask")) && (await tid(e, "sb-confirm-yes").count()) === 1);
  await tap(e, "sb-confirm-no");
  ok("'Not yet' changes nothing", (await dbq(`select state from scorebook_import where id = $1`, [I.id]))[0].state === "submitted");
  await tap(e, "sb-confirm-go");
  await tap(e, "sb-confirm-yes");
  await e.waitForTimeout(2000);
  ok("confirmed: the screen says the innings are in the record", (await tid(e, "sb-root").getAttribute("data-state")) === "confirmed" && /Confirmed\. The innings are now in the match's record/.test(await said(e, "sb-status")), await said(e, "sb-status"));
  const keys = (await dbq(`select idempotency_key, kind from ball_event where match_id = $1 order by seq`, [M]));
  ok("exactly three events, under the derived keys, and the match is complete", keys.length === 3 && keys.map((k) => k.idempotency_key).join() === ["start", "summary", "end"].map((k) => `scorebook:${I.id}:0:${k}`).join()
     && (await dbq(`select status from match where id = $1`, [M]))[0].status === "complete", JSON.stringify(keys));
  ok("the confirmed import offers no editing, no confirm, no return", (await tid(e, "sb-confirm-go").count()) === 0 && (await tid(e, "sb-return-go").count()) === 0 && (await e.locator('[data-testid^="sb-in-"]').count()) === 0 && /Confirmed/.test(await said(e, "sb-confirmed")));
  ok("no console errors (director of sport)", dr2.errors.length === 0 && dr.errors.length === 0, dr.errors.concat(dr2.errors).join(" | "));

  // the scorecard says so
  await tap(e, "sb-back");
  await e.waitForTimeout(1200);
  await tap(e, `mc-open-${M}`);
  await tid(e, "match-view").waitFor({ timeout: 6000 }).catch(() => {});
  await tap(e, "mc-tab-scorecard");
  await e.waitForTimeout(800);
  ok("the match's scorecard: the innings says it is from the scorebook", /From the scorebook/.test(await said(e, "mc-from-scorebook")), await said(e, "mc-from-scorebook"));
  ok("...with its batting as the book gave it: a figure not given is a dash, and extras not given are dashes", (await tid(e, "mc-bat-row").count()) === 4 && /NB 0 · WD 4 · B 1 · LB 0 · PEN 0/.test(await said(e, "mc-extras")), await said(e, "mc-extras"));
  ok("...a book that added up carries no footnote", (await tid(e, "mc-scorebook-footnote").count()) === 0);
  await shot(e, "4-scorecard");
  await dr2.ctx.close().catch(() => {});

  // ── E ──────────────────────────────────────────────────────────
  group("E. A book that does not add up: the difference is acknowledged");
  const M2 = await fixture();
  const card2 = baseCard(P, []);
  card2.batting[4].runs = 37; card2.unreconciled = { runs: 3, note: "the book's batting is three short" };
  const cards2 = [card2];
  const o2 = await call(`/api/matches/${M2}/scorebook`, { method: "POST", token: scorerTok });
  const s2 = await call(`/api/scorebook/${o2.body.id}/save`, { method: "POST", token: scorerTok, body: { cards: cards2, typed: TYPED, checked: allTicked(cards2), version: 1 } });
  const sub2 = await call(`/api/scorebook/${o2.body.id}/submit`, { method: "POST", token: scorerTok, body: { version: s2.body?.version } });
  ok("(an import whose book is three runs out, submitted through the API)", sub2.status === 200, JSON.stringify(sub2.body));
  const dr3 = await open();
  const f = dr3.page;
  ok("the director of sport signs in", await signIn(f, "sarah@example.invalid"));
  ok("Matches → the second fixture → Review and confirm", await toFixture(f, M2) && (await (async () => { await tid(f, `sb-open-${o2.body.id}`).waitFor({ timeout: 6000 }).catch(() => {}); await tap(f, `sb-open-${o2.body.id}`); await tid(f, "sb-confirm").waitFor({ timeout: 6000 }).catch(() => {}); return true; })()));
  await f.waitForTimeout(800);
  ok("the card carries its footnote, in words", /differ from its total by 3 runs/.test(await said(f, "sb-read-footnote-0")), await said(f, "sb-read-footnote-0"));
  ok("with no pages the screen says so, and is still usable", /No pages have been added yet/.test(await said(f, "sb-no-pages")));
  ok("confirming asks her to acknowledge the difference: a tick", (await tid(f, "sb-ack").count()) === 1);
  await tap(f, "sb-confirm-go"); await tap(f, "sb-confirm-yes");
  await f.waitForTimeout(1200);
  ok("without the tick the API refuses, in words, and nothing is written", /Tick that you have seen the difference/.test(await said(f, "sb-status")) && !/unreconciled_not_acknowledged/.test(await said(f, "sb-status"))
     && (await dbq(`select count(*)::int as n from ball_event where match_id = $1`, [M2]))[0].n === 0, await said(f, "sb-status"));
  await tid(f, "sb-ack").check();
  await tap(f, "sb-confirm-yes");
  await f.waitForTimeout(2000);
  ok("acknowledged, it is confirmed", (await tid(f, "sb-root").getAttribute("data-state")) === "confirmed" && (await dbq(`select state from scorebook_import where id = $1`, [o2.body.id]))[0].state === "confirmed", await said(f, "sb-status"));
  ok("...and the read-only card says the confirmer acknowledged it", /acknowledged that the book's figures do not add up/.test(await said(f, "sb-confirmed")), await said(f, "sb-confirmed"));
  await tap(f, "sb-back");
  await f.waitForTimeout(1000);
  await tap(f, `mc-open-${M2}`);
  await tid(f, "match-view").waitFor({ timeout: 6000 }).catch(() => {});
  await tap(f, "mc-tab-scorecard");
  await f.waitForTimeout(800);
  ok("its scorecard says from the scorebook, with the footnote", /From the scorebook/.test(await said(f, "mc-from-scorebook")) && /differ from its total by 3/.test(await said(f, "mc-scorebook-footnote")), await said(f, "mc-scorebook-footnote"));
  await dr3.ctx.close().catch(() => {});

  // ── F ──────────────────────────────────────────────────────────
  group("F. A person who worked on the card is told why she cannot confirm");
  const M3 = await fixture();
  const card3 = [baseCard(P, [])];
  const o3 = await call(`/api/matches/${M3}/scorebook`, { method: "POST", token: scorerTok });
  const s3 = await call(`/api/scorebook/${o3.body.id}/save`, { method: "POST", token: ownerTok, body: { cards: card3, typed: TYPED, checked: allTicked(card3), version: 1 } });
  const sub3 = await call(`/api/scorebook/${o3.body.id}/submit`, { method: "POST", token: scorerTok, body: { version: s3.body?.version } });
  ok("(an import the owner typed a cell of, submitted by the scorer)", sub3.status === 200, JSON.stringify(sub3.body));
  const ow = await open();
  const g = ow.page;
  ok("the owner's key signs in", await signIn(g, "owner@example.invalid"));
  ok("Matches → the third fixture → Review and confirm", await toFixture(g, M3) && (await (async () => { await tid(g, `sb-open-${o3.body.id}`).waitFor({ timeout: 6000 }).catch(() => {}); await tap(g, `sb-open-${o3.body.id}`); await tid(g, "sb-confirm").waitFor({ timeout: 6000 }).catch(() => {}); return true; })()));
  await g.waitForTimeout(800);
  ok("she is told why: the API's own words for cannot_confirm_your_own", /You worked on this card, so you cannot confirm or return it/.test(await said(g, "sb-cannot-confirm-why")) && !/cannot_confirm_your_own/.test(await text(g)), await said(g, "sb-cannot-confirm-why"));
  ok("...and there is no dead button: no Confirm, no Return", (await tid(g, "sb-confirm-go").count()) === 0 && (await tid(g, "sb-return-go").count()) === 0);
  ok("(the API agrees)", (await call(`/api/scorebook/${o3.body.id}/confirm`, { method: "POST", token: ownerTok, body: {} })).body?.error === "cannot_confirm_your_own");
  ok("no console errors (owner)", ow.errors.length === 0, ow.errors.join(" | "));
  await ow.ctx.close().catch(() => {});

  // ── G ──────────────────────────────────────────────────────────
  group("G. A phone's 390 × 844, and Daylight");
  const M4 = await fixture();
  const ph = await open("floodlit", { width: 390, height: 844 });
  const h = ph.page;
  ok("the scorer signs in on a phone", await signIn(h, "scorer@example.invalid"));
  ok("Matches → the fourth fixture", await toFixture(h, M4));
  await tid(h, "sb-start").waitFor({ timeout: 6000 }).catch(() => {});
  await tap(h, "sb-start");
  await tid(h, "sb-upload").waitFor({ timeout: 6000 }).catch(() => {});
  await h.setInputFiles('[data-testid="sb-file"]', [jpg, png]);
  await uploaded(h);
  await shot(h, "5-phone-upload");
  const fpU = await floors(h, "sb-root");
  ok("the upload screen on a phone: no sideways scroll, the same floors", fpU.sideways <= 1 && floorsOk(fpU), `${fpU.sideways} ${floorsWhy(fpU)}`);
  await tap(h, "sb-next");
  await tap(h, "sb-add-innings-go");
  await tap(h, "sb-add-batter-0"); await tap(h, "sb-add-bowler-0"); await tap(h, "sb-add-dnb-0");
  await tap(h, "sb-record-diff-0").catch(() => {});
  await shot(h, "6-phone-review");
  const fpR = await floors(h, "sb-root");
  ok("the review screen on a phone, a batter and a bowler added: no sideways scroll, the same floors", fpR.sideways <= 1 && floorsOk(fpR), `${fpR.sideways} ${floorsWhy(fpR)}`);
  ok("the pages sit above the card, both reachable", (await tid(h, "sb-photos").count()) === 1 && (await tid(h, "sb-card-0").count()) === 1);
  ok("the tick beside a cell is a control of its own: keyboard reachable with a name", await h.$eval('[data-testid="sb-tick-0.total"]', (el) => el.tabIndex >= 0 && el.getAttribute("aria-label") === "Checked: Innings 1, total"));
  await ph.ctx.close().catch(() => {});

  // the confirm screen on a phone: the confirmed second import, read-only
  const ph2 = await open("floodlit", { width: 390, height: 844 });
  const h2 = ph2.page;
  ok("the director of sport signs in on a phone", await signIn(h2, "sarah@example.invalid"));
  ok("Matches → the first fixture", await toFixture(h2, M));
  await tid(h2, `sb-open-${I.id}`).waitFor({ timeout: 6000 }).catch(() => {});
  await tap(h2, `sb-open-${I.id}`);
  await tid(h2, "sb-confirm").waitFor({ timeout: 6000 }).catch(() => {});
  await h2.waitForTimeout(1200);
  await shot(h2, "7-phone-confirm");
  const fpC = await floors(h2, "sb-root");
  ok("the confirm screen on a phone: no sideways scroll, the same floors", fpC.sideways <= 1 && floorsOk(fpC), `${fpC.sideways} ${floorsWhy(fpC)}`);
  await ph2.ctx.close().catch(() => {});

  const day = await open("daylight");
  const y = day.page;
  ok("the director of sport signs in, in Daylight", await signIn(y, "sarah@example.invalid"));
  ok("Matches → the third fixture → Review and confirm (as the owner's, not hers to confirm... she may)", await toFixture(y, M3) && (await (async () => { await tid(y, `sb-open-${o3.body.id}`).waitFor({ timeout: 6000 }).catch(() => {}); await tap(y, `sb-open-${o3.body.id}`); await tid(y, "sb-confirm").waitFor({ timeout: 6000 }).catch(() => {}); return true; })()));
  await y.waitForTimeout(800);
  const theme = await y.evaluate(() => document.documentElement.dataset.theme);
  const fDay = await floors(y, "sb-root");
  ok("the theme is Daylight and the page is light", theme === "daylight" && /rgb\((2[0-9]{2}|1[89][0-9]), /.test(fDay.bg), `${theme} ${fDay.bg}`);
  ok("...with the same floors", floorsOk(fDay), floorsWhy(fDay));
  await shot(y, "8-daylight-confirm");
  ok("no console errors (phone, Daylight)", ph.errors.length + ph2.errors.length + day.errors.length === 0, ph.errors.concat(ph2.errors, day.errors).join(" | "));
  ok("no browser dialog was ever raised (confirm, return and abandon ask in the page)", [pa, sc, dr, dr2, dr3, ow, ph, ph2, day, off].every((x) => x.dialogs.length === 0));
  await day.ctx.close().catch(() => {});
  ok("(the walk left the file of a page nowhere but the private store)", readdirSync(STORE).length === 1);
} catch (e) {
  ok(`the browser scorebook walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) { console.log(e.stack?.split("\n").slice(0, 8).join("\n")); console.log("page errors:", allErrors.flat().slice(0, 6).join(" | ")); }
} finally {
  await dbq(`delete from feature_grant where key = 'scorebook_import' and school_id = $1`, [HIL]).catch(() => {});
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SCOREBOOK SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

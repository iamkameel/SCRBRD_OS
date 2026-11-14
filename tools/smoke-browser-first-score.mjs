#!/usr/bin/env node
/**
 * The scorer's first run (EXPERIENCE_PASS §2.5, slice 1; Q3, Q5 and Q25,
 * decided as recommended on 13 Nov 2026), in a real browser against the real
 * server: a NEW account with no school, from the sign-in screen to its first
 * ball, with no name typed.
 *
 * Sign-up is driven as tools/smoke-browser-signup.mjs drives it, without real
 * Google: the server is started with FIREBASE_TEST_KEYS, the client is the
 * walk's own build (tools/web-test-build.mjs), and the walk answers the
 * Google popup with an ID token it signed for the project scrbrd-os-test.
 *
 *   1. A NEW ACCOUNT lands on the no-school screen, and "Start a match" is
 *      the first thing on it: a Practice Match, which stays on this phone
 *      (the account is granted nothing; Pilot Matches are off as shipped),
 *      its players' names said to be optional. The account holds nothing.
 *   2. THE FIRST BALL, NO NAME TYPED: the pad's own setup opens at its first
 *      step; the overs, the two sides, then "Score by position: on to the toss" (practice-positions; practice-next keeps "Next: the first squad") with no squad
 *      screen; the toss; the openers and bowler by position (Home No. 1,
 *      Home No. 2, Away No. 1); the pad. One run moves the Board. Nothing is
 *      typed into a name field, no shell and no role is drawn, and nothing
 *      about the match is asked of the API: a Practice Match never leaves
 *      the phone.
 *   3. A RELOAD signs out, by design (Q25); signing in again with Google is
 *      the no-school screen, and the match is under "Now", on its Board,
 *      with "Resume scoring", which reopens the pad on the same score.
 *   4. THE RESULT: a one-over match played out by position. "Scoring for a
 *      school? Join it" is never on the pad during play, and is on the
 *      result; it goes to the join form. Home then says what he scored, as a
 *      plain record: balls, kept on this phone, no points, streaks or ranks.
 *   5. 12px and 44px on the screens he passes, no sideways scroll at 390, no
 *      page errors, and the account still holds nothing at the end.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-browser-first-score.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { buildWebForWalk, WEB_TEST_ROOT } from "./web-test-build.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { generateKeyPairSync, createSign } from "node:crypto";
import { appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(4405);
const API_PORT = port(9005);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PHONE = { width: 390, height: 844 };
const PROJECT = "scrbrd-os-test";
const RUN = Date.now().toString(36);

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);

// ── The walk's own "Google" ──
const dir = await mkdtemp(join(tmpdir(), "scrbrd-first-score-"));
const keyFile = join(dir, "keys.json");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
await writeFile(keyFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "walk-1", alg: "RS256", use: "sig" }] }));
const b64 = (s) => Buffer.from(s).toString("base64url");
const idToken = (uid, email) => {
  const t = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, email, email_verified: true, name: "First Scorer",
    iat: t - 5, exp: t + 3600, auth_time: t - 5, firebase: { sign_in_provider: "google.com" } };
  const input = `${b64(JSON.stringify({ alg: "RS256", kid: "walk-1", typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
  const s = createSign("RSA-SHA256"); s.update(input);
  return `${input}.${s.sign(privateKey).toString("base64url")}`;
};

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "browser-first-score-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}`, FIREBASE_TEST_KEYS: keyFile,
         PUBLIC_TRUST_PROXY_HOPS: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

const built = buildWebForWalk();
ok("the walk's own build (test hook, dummy web config for scrbrd-os-test) is made", built.ok, built.out);
const web = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  let body, type;
  try { const f = join(WEB_TEST_ROOT, url === "/" ? "index.html" : url); body = await readFile(f); type = TYPES[extname(f)] ?? "application/octet-stream"; }
  catch { body = await readFile(join(WEB_TEST_ROOT, "index.html")); type = "text/html"; }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, r));
const browser = await chromium.launch({ ...launchOptions() });

const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const exchange = (tok) => call("/api/auth/firebase", { method: "POST", body: { idToken: tok, deviceId: "device-first-score" } });

const ctx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
await offline(ctx);
let next = null;
await ctx.exposeFunction("__walkGoogle", () => (next ? { idToken: next, email: JSON.parse(Buffer.from(next.split(".")[1], "base64url").toString()).email } : null));
const page = await ctx.newPage();
watchReads(page);
const errors = [];
const requests = [];
let phase = "boot";
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on("request", (r) => { const u = new URL(r.url()); requests.push({ phase, method: r.method(), path: u.pathname, body: r.postData() ?? "" }); });
await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)}; window.__SCRBRD_TEST_GOOGLE__ = () => window.__walkGoogle();`);

const tid = (id) => page.locator(`[data-testid="${id}"]`);
const has = async (id) => (await tid(id).count()) > 0;
const text = () => page.$eval("body", (el) => el.innerText);
const tap = async (id, ms = 5000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(250); };
const click = async (re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / }).first().textContent().catch(() => "")) || "").trim();
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** A position's own button: "Home No. 1", never "Home No. 10". @param {string} words */
const posButton = (words) => page.locator("button", { hasText: new RegExp(`${words.replace(/\./g, "\\.")}(?!\\d)`) }).first();
const ensureBasic = async () => {
  if (await has("basic-pad")) return true;
  await tap("pad-menu"); await tap("pad-basic-scoring"); await page.waitForTimeout(300);
  return has("basic-pad");
};
async function google(token, wait = 2500) {
  next = token;
  await page.waitForSelector('[data-testid="google-button"]', { timeout: 8000 }).catch(() => {});
  await tid("google-button").click({ timeout: 5000 });
  await page.waitForTimeout(wait);
  await afterReads(page, 800);
}
/** §3.2 and §3.5 over a region: nothing read under 12px, nothing tapped under 44px. */
async function floors(region) {
  return page.evaluate((region) => {
    const small = [], tiny = [];
    const root = document.querySelector(region);
    if (!root) return { small: ["no such region"], tiny: [] };
    for (const n of [root, ...root.querySelectorAll("*")]) {
      if (n.closest(".sr-only") || n.closest("svg")) continue;
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 43.5) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny };
  }, region);
}
const floorsOk = (f) => f.small.length === 0 && f.tiny.length === 0;
/** This phone's practice matches' ids, from its own store. */
const practiceIds = () => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("scrbrd"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  if (![...db.objectStoreNames].includes("kv")) { db.close(); return []; }
  const keys = await new Promise((res) => { const q = db.transaction("kv", "readonly").objectStore("kv").getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); });
  db.close();
  return keys.map(String).filter((k) => k.startsWith("practice:meta:")).map((k) => k.slice("practice:meta:".length));
});

const UID = `walk-first-${RUN}`, EMAIL = `walk.first.${RUN}@example.invalid`;
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await call("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── 1 · A new account ─────────────────────────────────────────
  group("1. A new Google account: the no-school screen, Start a match first");
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  await click(/Get Started|Log In/, 5000);
  phase = "signin";
  await google(idToken(UID, EMAIL));
  ok("it lands on the no-school screen, with no shell", (await has("pending-requests")) && (await has("no-school-title")) && !(await has("os-main")), (await text()).slice(0, 200));
  ok("Start a match is there", await until(() => has("start-match")), (await text()).slice(0, 300));
  ok("...and it is the first thing on the screen, above the requests and the join form", await page.evaluate(() => {
    const top = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? Infinity;
    return top("start-match") < top("join-school") && top("start-match") < top("no-school-requests") && top("start-match") < top("no-school-help")
      && !document.querySelector('[data-testid="start-now"]');
  }));
  ok("...in the first screenful at 390", await page.evaluate(() => document.querySelector('[data-testid="start-match-go"]').getBoundingClientRect().bottom <= window.innerHeight));
  ok("...a Practice Match, said to stay on this phone, its players' names optional",
     (await tid("start-match-go").innerText()).trim() === "Start Practice Match"
     && /stays on this phone/.test(await tid("start-match-note").innerText()) && /names are optional/.test(await tid("start-match-note").innerText()),
     await tid("start-match").innerText().catch(() => ""));
  const mine = await exchange(idToken(UID, EMAIL));
  ok("the account holds nothing", (await call("/api/session", { token: mine.body?.token })).body?.assignments?.length === 0);
  const f1 = await floors('[data-testid="pending-requests"]');
  ok("the no-school screen: nothing under 12px, nothing under 44px", floorsOk(f1), [...f1.small, ...f1.tiny].join(" | "));
  ok("...no sideways scroll", await noSideways());

  // ── 2 · The first ball ────────────────────────────────────────
  group("2. The first ball, with no name typed");
  phase = "setup";
  await tap("start-match-go");
  ok("the pad's own setup opens, at its first step: a Practice Match", await until(() => has("practice-page")) && /Step 1 of 6/.test(await text()) && (await has("practice-label")), (await text()).slice(0, 200));
  ok("...with no shell and no start screen of the pad's", !(await has("os-main")) && !(await has("start-practice")));
  await tap("practice-overs-custom");
  await tid("practice-overs-input").fill("1");
  await tap("practice-next");
  await tid("practice-school-0").fill("Hilton");
  await tid("practice-division-0").selectOption("U13");
  await tap("practice-class-0-B");
  await tid("practice-school-1").fill("Kearsney");
  await tid("practice-division-1").selectOption("U13");
  await tap("practice-class-1-B");
  ok("the teams step offers the toss next, players by position, and the names step beside it",
     (await has("practice-positions")) && /^Score by position: on to the toss$/.test((await tid("practice-positions").innerText()).trim())
     && /^Next: the first squad$/.test((await tid("practice-next").innerText()).trim())
     && /Home No\. 1 to 11/.test(await tid("practice-positions-note").innerText()), (await text()).slice(-400));
  const f2 = await floors("main");
  ok("...nothing under 12px, nothing under 44px on it", floorsOk(f2), [...f2.small, ...f2.tiny].join(" | "));
  await tap("practice-positions");
  ok("Step 5 of 6: the toss, with no squad screen on the way", /Step 5 of 6/.test(await text()) && (await page.locator('[data-testid^="practice-paste-"]').count()) === 0, (await text()).slice(0, 200));
  await page.locator("button[role=radio]", { hasText: "Hilton U13B" }).first().click();
  await page.locator("button[role=radio]", { hasText: /^Bat$/ }).click();
  await click(/Confirm Toss/);
  ok("Step 6 of 6: the openers, by position", /Step 6 of 6/.test(await text()) && /Home No\. 1/.test(await text()) && /Home No\. 11/.test(await text()), (await text()).slice(0, 300));
  await posButton("Home No. 1").click({ timeout: 3000 });
  await posButton("Home No. 2").click({ timeout: 3000 });
  await click(/Select Opening Bowler/);
  ok("...and the opening bowler from the other side's eleven", /Away No\. 1/.test(await text()));
  await posButton("Away No. 1").click({ timeout: 3000 });
  phase = "pad";
  await click(/Start Match/);
  await page.waitForTimeout(1200);
  ok("the pad is open on the practice match, labelled, Hilton U13B v Kearsney U13B",
     (await has("pad-titlebar")) && /Hilton U13B v Kearsney U13B/.test(await tid("pad-titlebar").innerText()) && (await has("practice-label")));
  ok("...ready to score", (await ensureBasic()) && !(await has("scoring-blocked")), (await text()).slice(0, 300));
  const before = await board();
  await tap("run-1");
  await page.waitForTimeout(400);
  const after = await board();
  ok("THE FIRST BALL MOVES THE BOARD: 1 for 0, 0.1 overs", before !== after && after === "1 for 0, 0.1 overs", `${before} → ${after}`);
  ok("...the batters on the pad are positions", /Home No\. 1/.test(await text()) && /Away No\. 1/.test(await text()));
  ok("Scoring for a school? Join it is never on the pad during play", !(await has("pad-join-school")) && !/Scoring for a school/.test(await text()));
  ok("no shell and no role: the pad alone", !(await has("os-main")) && !(await has("persona-bar")));
  const f3 = await floors("body");
  ok("the pad: nothing under 12px, nothing under 44px", floorsOk(f3), [...f3.small, ...f3.tiny].join(" | "));
  ok("...no sideways scroll on the pad", await noSideways());
  const ids = await practiceIds();
  ok("the match is on this phone, as a practice- match", ids.length === 1 && /^practice-/.test(ids[0]), ids);
  const toApi = requests.filter((r) => (r.phase === "setup" || r.phase === "pad") && /\/api\//.test(r.path));
  ok("nothing about the match was asked of the API while it was set up and scored",
     !toApi.some((r) => /\/api\/(matches|pilot\/matches|pilot\/[0-9a-f-]+|read\/|session\/pad|events)/.test(r.path) || r.method !== "GET"),
     toApi.map((r) => `${r.method} ${r.path}`).join(", "));
  ok("...and no typed name exists to send: none was typed", !requests.some((r) => /Home No|Away No/.test(r.body)));
  await afterReads(page, 800);

  // ── 3 · A reload, and Now ─────────────────────────────────────
  group("3. A reload signs out; signed in again, the match is under Now");
  phase = "reload";
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  ok("a reload signs out, by design (Q25), and says so", await until(() => has("no-school-signed-out")), (await text()).slice(0, 200));
  await tap("no-school-sign-in-again");
  await google(idToken(UID, EMAIL));
  ok("signed in again: the no-school screen", (await has("pending-requests")) && (await has("no-school-title")));
  const id = ids[0];
  ok("the match is under Now", await until(() => has(`now-${id}`)), (await text()).slice(0, 400));
  ok("...Now comes first, above Start a match", await page.evaluate(() =>
    document.querySelector('[data-testid="start-now"]').getBoundingClientRect().top < document.querySelector('[data-testid="start-match"]').getBoundingClientRect().top));
  ok("...on its Board, 1 for 0, kept on this phone, with Resume scoring",
     (await has(`now-${id}-board`)) && /1/.test(await tid(`now-${id}-board`).innerText()) && /Kept on this phone only/.test(await tid(`now-${id}-pending`).innerText())
     && (await tid(`now-${id}-open`).innerText()).trim() === "Resume scoring", await tid(`now-${id}`).innerText().catch(() => ""));
  ok("...no batter or bowler on the home's Board", !/No\. \d/.test(await tid(`now-${id}-board`).innerText()));
  const f4 = await floors('[data-testid="pending-requests"]');
  ok("the home with a match on it: nothing under 12px, nothing under 44px", floorsOk(f4), [...f4.small, ...f4.tiny].join(" | "));
  phase = "pad";
  await tap(`now-${id}-open`);
  await until(() => has("pad-titlebar"));
  await ensureBasic();
  ok("Resume scoring reopens the pad on the same score: 1 for 0, 0.1 overs", (await board()) === "1 for 0, 0.1 overs", await board());

  // ── 4 · The result ────────────────────────────────────────────
  group("4. The result: Scoring for a school? Join it, then the plain record");
  for (const k of ["run-4", "run-0", "run-2", "run-6", "run-1"]) await tap(k);
  ok("the over: 14 for 0, and the review", await until(() => has("innings-review")), await board());
  ok("...Join it still not offered between the innings", !(await has("pad-join-school")));
  await tap("review-confirm");
  await click(/Start 2nd Innings/); await page.waitForTimeout(700);
  await posButton("Away No. 1").click({ timeout: 3000 }); await page.waitForTimeout(400);
  await posButton("Away No. 2").click({ timeout: 3000 }); await page.waitForTimeout(400);
  await posButton("Home No. 1").click({ timeout: 3000 }); await page.waitForTimeout(600);
  await ensureBasic();
  ok("the chase is on: need 15 off 6", /Need 15 off 6/.test(await text()), (await text()).slice(0, 300));
  ok("...and Join it is not offered during it", !(await has("pad-join-school")));
  for (const k of ["run-6", "run-6", "run-4"]) await tap(k);
  ok("the target reached: the review", await until(() => has("innings-review")));
  await tap("review-confirm");
  await page.waitForTimeout(800);
  ok("the result: Kearsney U13B won", /Kearsney U13B/.test(await tid("pad-result").innerText().catch(() => "")) || /Kearsney U13B/.test(await text()), (await text()).slice(0, 300));
  ok("...and on it, Scoring for a school? Join it", (await has("pad-join-school-open")) && /^Scoring for a school\? Join it$/.test((await tid("pad-join-school-open").innerText()).trim()));
  ok("...the way back says Back home, not the pad's start", await page.locator("button", { hasText: /^Back home$/ }).count() === 1);
  const f5 = await floors("body");
  ok("the result: nothing under 12px, nothing under 44px", floorsOk(f5), [...f5.small, ...f5.tiny].join(" | "));
  phase = "join";
  await tap("pad-join-school-open");
  ok("Join it goes home, to the join form", await until(() => has("join-school")) && !(await has("pad-titlebar")));
  ok("...which has the focus", await until(() => page.evaluate(() => document.activeElement?.id === "join-school-title"), 4000));
  ok("home says what he scored, as a plain record: 9 balls, kept on this phone",
     await until(() => has("start-record-match")) && /You scored 9 balls, kept on this phone only\./.test(await tid("start-record-match-words").innerText().catch(() => "")),
     await tid("start-record").innerText().catch(() => "(none)"));
  ok("...with the match's own score, and nothing that ranks it",
     /Hilton U13B 14\/0/.test(await tid("start-record").innerText()) && !/point|streak|rank|best|leader/i.test(await tid("start-record").innerText()));
  ok("...and offers Join it there too", await has("start-record-match-join"));
  ok("a finished match is no longer under Now", !(await has(`now-${id}`)));

  // ── 5 · What it left ──────────────────────────────────────────
  group("5. What it left");
  ok("the account still holds nothing", (await call("/api/session", { token: (await exchange(idToken(UID, EMAIL))).body?.token })).body?.assignments?.length === 0);
  ok("no write of a match reached the API, at any point", !requests.some((r) => r.method !== "GET" && /\/api\/(matches|pilot|events|scoring)/.test(r.path)),
     requests.filter((r) => r.method !== "GET").map((r) => r.path).join(", "));
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e);
} finally {
  await browser.close();
  web.close();
  apiProc.kill();
  await rm(dir, { recursive: true, force: true });
}

if (fail && apiErr.length) console.log("\nserver stderr:\n" + apiErr.join("").slice(-1500));
console.log(`\n${"─".repeat(52)}\nFIRST SCORE BROWSER WALK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

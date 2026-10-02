#!/usr/bin/env node
/**
 * Signing in with Google, from a browser (SCRBRD-140 phase 1, the screens;
 * docs/design/SCRBRD-140_signup_and_school_linking.md §9 proof 3).
 *
 * The server is started with FIREBASE_TEST_KEYS, as tools/smoke-signup.mjs
 * starts it: the walk is its own "Google", a key it generated, for the project
 * scrbrd-os-test. The client is built for the walk (tools/web-test-build.mjs:
 * test hooks on, dummy web config for that project) and the walk answers the
 * Google popup with an ID token it signed. The SDK is still fetched when the
 * button is pressed, so the walk can see WHEN. What it proves, in a browser:
 *
 *   1. THE SIGN-IN SCREEN. The Google button is there and the signed privacy
 *      paragraph is on the screen; the Firebase SDK is NOT fetched before the
 *      button is pressed and IS after; an unverified address is refused in
 *      words; 12px and 44px on the block.
 *   2. A NEW ACCOUNT lands on the no-school screen and nothing else: its name
 *      and address, its requests, the schools, the help link. It sends a
 *      parent's request with the child as FREE TEXT: nothing is looked up
 *      (the only reads are the schools, its own requests and the help link),
 *      the request carries no player, the answer is the same sentence for a
 *      child who is on the school's list and one who is not, nothing says
 *      "found", and nothing is linked: the account still holds nothing. A pupil
 *      under 18 is sent to the office and sends nothing. 12px and 44px.
 *   3. THE OFFICE ANSWERS and the person's next Google sign-in is the school's
 *      shell; Me lists the Google account and the signed paragraph; a second
 *      Google account is added (a stale sign-in and another account's are
 *      refused in the server's words), removed after a confirm, and signs in
 *      to nothing afterwards, said in words.
 *   4. THE CLAIM. An address the office enrolled answers "waiting for your
 *      school office", no shell; the office's Claims list on People shows the
 *      enrolled address beside Google's, confirms with one tap, and the next
 *      Google sign-in is that account. A second claim is answered with a code
 *      instead, shown once.
 *   5. No page errors; both themes on the new screens.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-browser-signup.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { buildWebForWalk, WEB_TEST_ROOT } from "./web-test-build.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { generateKeyPairSync, createSign } from "node:crypto";
import { appUrl, port } from "./db-url.mjs";
import { SIGNIN_NOTICE } from "../apps/web/src/lib/signinNotice.js";

const WEB_PORT = port(4385);
const API_PORT = port(8985);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const PROJECT = "scrbrd-os-test";
const RUN = Date.now().toString(36);
const GUARDIAN_URL = "https://example.invalid/the-guardian";
const FOUND = /\bnot found\b|\bfound\b|couldn.t find|could not find|no such (child|pupil|player|learner)|not on (the|our|a) (list|roll|register)|doesn.t exist|does not exist/i;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);

// ── The walk's own "Google" ──
const dir = await mkdtemp(join(tmpdir(), "scrbrd-signup-browser-"));
const keyFile = join(dir, "keys.json");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
await writeFile(keyFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "walk-1", alg: "RS256", use: "sig" }] }));
const b64 = (s) => Buffer.from(s).toString("base64url");
/** A Firebase ID token for `uid`/`email`, fresh unless told otherwise. */
const idToken = (uid, email, over = {}) => {
  const t = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, email, email_verified: true, name: "Walk Person",
    iat: t - 5, exp: t + 3600, auth_time: t - 5, firebase: { sign_in_provider: "google.com" }, ...over };
  const input = `${b64(JSON.stringify({ alg: "RS256", kid: "walk-1", typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
  const s = createSign("RSA-SHA256"); s.update(input);
  return `${input}.${s.sign(privateKey).toString("base64url")}`;
};

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "browser-signup-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}`, FIREBASE_TEST_KEYS: keyFile,
         GUARDIAN_APP_URL: GUARDIAN_URL, PUBLIC_TRUST_PROXY_HOPS: "0" },
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

// ── API, as a person ──
const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const exchange = (tok) => call("/api/auth/firebase", { method: "POST", body: { idToken: tok, deviceId: "device-signup-browser" } });

// ── The browser ──
const pages = [];
/** A fresh context (so a fresh session) with the walk's Google wired in: set `h.next` before pressing the button. */
async function open({ viewport = DESK, scheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await offline(ctx);
  const h = { ctx, next: null, requests: [], errors: [], posts: [] };
  await ctx.exposeFunction("__walkGoogle", () => {
    if (!h.next) return null;
    return { idToken: h.next, email: JSON.parse(Buffer.from(h.next.split(".")[1], "base64url").toString()).email };
  });
  const page = await ctx.newPage();
  h.page = page;
  page.on("pageerror", (e) => h.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) h.errors.push(m.text()); });
  if (process.env.SIGNUP_DEBUG) page.on("response", async (r) => { if (/\/api\/(auth|session)/.test(r.url())) console.log("   [debug]", r.status(), r.url().replace(API, ""), (await r.text().catch(() => "")).slice(0, 160)); });
  page.on("request", (r) => {
    const u = new URL(r.url());
    h.requests.push(`${r.method()} ${u.pathname}`);
    if (r.method() === "POST" && u.pathname === "/api/requests") { try { h.posts.push(JSON.parse(r.postData() ?? "{}")); } catch { /* not json */ } }
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)}; window.__SCRBRD_TEST_GOOGLE__ = () => window.__walkGoogle();`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  pages.push(h);
  return h;
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const text = (page) => page.$eval("body", (el) => el.innerText);
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
/** Landing → the sign-in screen, and wait for the live check (the Google button appears with it). */
async function toLogin(h) {
  await click(h.page, /Get Started|Log In/, 5000);
  await h.page.waitForSelector("#login-email", { timeout: 6000 }).catch(() => {});
  await h.page.waitForSelector('[data-testid="google-button"]', { timeout: 6000 }).catch(() => {});
}
/** Press Continue with Google as `token`; wait for the screen to settle. */
async function google(h, token, wait = 1800) {
  h.next = token;
  await tid(h.page, "google-button").click({ timeout: 5000 });
  await h.page.waitForTimeout(wait);
}
async function devSignIn(h, email) {
  await toLogin(h);
  await h.page.locator("#login-email").fill(email);
  await click(h.page, /^Sign In$/, 5000);
  await h.page.waitForTimeout(2200);
  return (await tid(h.page, "os-main").count()) === 1;
}
async function go(page, key) {
  const l = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"]`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1200);
  return true;
}
/** Settings → a tab. */
async function settingsTab(page, tab) {
  if (!(await go(page, "settings"))) return false;
  try { await page.locator(`#settings-tab-${tab}`).click({ timeout: 4000 }); } catch { return false; }
  await page.waitForTimeout(1200);
  return true;
}
const inShell = async (page) => (await tid(page, "os-main").count()) === 1 || (await tid(page, "persona-bar").count()) === 1;

/** §3.2 and §3.5 over a region: nothing read under 12px, nothing tapped under 44px. */
async function floors(page, region) {
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
/** Which built scripts a page loaded include the Firebase Auth SDK (identitytoolkit). */
async function sdkScripts(h) {
  const files = new Set();
  for (const r of h.requests) { const m = /^GET (\/assets\/[^?]+\.js)$/.exec(r); if (m) files.add(m[1]); }
  const hits = [];
  for (const f of files) { const body = await readFile(join(WEB_TEST_ROOT, f), "utf8").catch(() => ""); if (body.includes("identitytoolkit.googleapis.com")) hits.push(f); }
  return hits;
}
const sentence = (s) => s.replace(/\s+/g, " ").trim();

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await call("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const files = await readdir(join(WEB_TEST_ROOT, "assets")).catch(() => []);
  ok("the client is built", files.length > 0);
  const office = await call("/api/auth/dev-login", { method: "POST", body: { email: "registrar@example.invalid", deviceId: "device-signup-browser" } }).then((r) => r.body?.token);
  ok("the office signs in by API", !!office);

  // ── 1 · The sign-in screen ──────────────────────────────────────
  group("1. The sign-in screen: the button, the signed paragraph, the SDK only when pressed");
  const NEW_UID = `walkb-new-${RUN}`, NEW_EMAIL = `walk.newcomer.${RUN}@example.invalid`;
  {
    const h = await open({ viewport: PHONE });
    await toLogin(h);
    ok("Continue with Google is on the sign-in screen", (await tid(h.page, "google-button").count()) === 1 && /Continue with Google/.test(await tid(h.page, "google-button").innerText()));
    const shown = sentence(await tid(h.page, "google-notice").innerText());
    ok("the privacy paragraph Kameel signed is on the screen, word for word", shown.includes(sentence(SIGNIN_NOTICE)), shown.slice(0, 120));
    ok("the code form is still there, for anyone without Google", (await h.page.locator("#login-email").count()) === 1 && (await h.page.locator("#login-password").count()) === 1);
    ok("the Firebase Auth SDK has NOT been fetched before the button is pressed", (await sdkScripts(h)).length === 0, await sdkScripts(h));
    const fl = await floors(h.page, '[data-testid="google-signin"]');
    ok("the Google block: nothing under 12px, nothing under 44px", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].join(" | "));

    await google(h, idToken(NEW_UID, NEW_EMAIL, { email_verified: false }));
    ok("...and it IS fetched once the button is pressed", (await sdkScripts(h)).length >= 1);
    ok("an address Google has not verified is refused in words", /not verified/.test(await tid(h.page, "google-error").innerText().catch(() => "")), await text(h.page));
    ok("...with no shell and no token kept", (await tid(h.page, "os-main").count()) === 0);
    await google(h, null);
    ok("a window closed on Google (no token given) is said in words", /Google/.test(await tid(h.page, "google-error").innerText().catch(() => "")));
    await h.ctx.close();
  }

  // ── 2 · A new account ───────────────────────────────────────────
  group("2. A new Google account: the no-school screen, a parent's request as free text, nothing looked up");
  let parentReqs;
  {
    const h = await open({ viewport: PHONE });
    await toLogin(h);
    await google(h, idToken(NEW_UID, NEW_EMAIL), 2500);
    const P = h.page;
    ok("it lands on the no-school screen", (await tid(P, "pending-requests").count()) === 1 && (await tid(P, "no-school-title").count()) === 1, (await text(P)).slice(0, 200));
    ok("...with no shell", (await tid(P, "os-main").count()) === 0 && (await tid(P, "persona-bar").count()) === 0);
    ok("...naming her, from Google's name, and her address", /Hello Walk Person/.test(await tid(P, "no-school-title").innerText()) && (await tid(P, "no-school-email").innerText()) === NEW_EMAIL);
    ok("...and the help link, for a child who needs one without a school", (await tid(P, "no-school-guardian").getAttribute("href").catch(() => null)) === GUARDIAN_URL);
    await P.waitForSelector('[data-testid="join-school"]', { timeout: 5000 }).catch(() => {});
    ok("the schools are offered by name", (await tid(P, `join-school-${HIL}`).count()) === 1 && (await tid(P, `join-school-${WES}`).count()) === 1);
    ok("nothing about who she is asking for is asked until a school is chosen", (await tid(P, "join-kind-parent").count()) === 0);

    // As the account itself, with its own token: it holds nothing.
    const mine = await exchange(idToken(NEW_UID, NEW_EMAIL));
    const before = await call("/api/session", { token: mine.body?.token });
    ok("the account holds nothing", before.body?.assignments?.length === 0, before.body);

    await tid(P, `join-school-${HIL}`).click();
    ok("choosing a school offers the kinds", (await tid(P, "join-kind-parent").count()) === 1);
    // Pupil under 18: told, sends nothing.
    await tid(P, "join-kind-pupil").click();
    await tid(P, "join-pupil-minor").click();
    ok("a pupil under 18 is sent to the office, with no Send button", (await tid(P, "join-pupil-under18").count()) === 1 && (await tid(P, "join-send").count()) === 0 && /sign-in code/.test(await tid(P, "join-pupil-under18").innerText()));

    // The parent, with a child who IS on the school's list: the seed's invented one.
    await tid(P, "join-kind-parent").click();
    ok("the parent's form: free text, no suggestions", (await tid(P, "join-child").getAttribute("autocomplete")) === "off" && (await P.locator("datalist").count()) === 0);
    h.requests.length = 0;
    await tid(P, "join-child").fill("James Whitfield");
    await tid(P, "join-relationship").selectOption("Mother");
    ok("typing a child's name asks the server nothing (no lookup)", h.requests.filter((r) => /\/api\//.test(r)).length === 0, h.requests);
    await tid(P, "join-send").click();
    await P.waitForSelector('[data-testid="join-sent"]', { timeout: 6000 }).catch(() => {});
    const sentOn = sentence(await tid(P, "join-sent").innerText());
    ok("the request is sent, and the answer says nothing is linked automatically", /nothing is linked automatically/.test(sentOn), sentOn);
    ok("...the request carries the child as the note, and no player", h.posts.length === 1 && h.posts[0].role === "guardian" && h.posts[0].schoolId === HIL
       && h.posts[0].note === "Child: James Whitfield · Relationship: Mother" && !("playerId" in h.posts[0]), h.posts);
    // The same form for a child who is on no list at all, at the other school.
    await tid(P, "join-another").click();
    await tid(P, `join-school-${WES}`).click();
    await tid(P, "join-kind-parent").click();
    await tid(P, "join-child").fill("Zzyzx Qwerty Nonesuch");
    await tid(P, "join-relationship").selectOption("Father");
    await tid(P, "join-send").click();
    await P.waitForSelector('[data-testid="join-sent"]', { timeout: 6000 }).catch(() => {});
    const sentOff = sentence(await tid(P, "join-sent").innerText());
    const names = Object.fromEntries((await call("/api/schools")).body.rows.map((x) => [x.id, x.name]));
    const norm = (t) => t.replaceAll(names[HIL], "SCHOOL").replaceAll(names[WES], "SCHOOL");
    ok("a child on no list gets the very same sentence (school aside)", norm(sentOn) === norm(sentOff), `${sentOn} // ${sentOff}`);
    ok("nothing on the screen says found or not found", !FOUND.test(await text(P)), (await text(P)).match(FOUND)?.[0]);
    parentReqs = h.posts.length;
    const reads = h.requests.filter((r) => /\/api\//.test(r)).map((r) => r.replace(/^\w+ /, ""));
    ok("the only things the screen asked for: schools, her own requests, the help link, the sessions, her requests", reads.every((r) => /^\/api\/(schools|session|read\/role_requests|safeguarding\/contacts|requests)$/.test(r)), [...new Set(reads)]);
    ok("...and never a pupil, a child, a squad or a roster", !reads.some((r) => /players|pupils|children|squad|roster|guardians/.test(r)));
    ok("both requests are listed as waiting", (await P.locator('[data-testid="request-pending"]').count()) === 2, await P.locator('[data-testid="request-pending"]').count());

    const after = await call("/api/session", { token: mine.body?.token });
    ok("NOTHING IS LINKED: the account still holds nothing after the parent's requests", after.body?.assignments?.length === 0, after.body);
    // And the office's side shows free text to match by hand.
    const rr = await call("/api/read/role_requests", { token: office });
    const mineRows = rr.body?.rows?.filter((x) => x.email === NEW_EMAIL && x.role === "guardian");
    ok("the office sees the request as free text, with no player named", mineRows?.length >= 1 && mineRows.every((x) => x.player_id == null) && mineRows.some((x) => /Child: James Whitfield/.test(x.note ?? "")), mineRows);

    // Withdraw the Wesley one.
    await P.locator('[data-testid="request-withdraw"]').first().click();
    await P.waitForTimeout(1200);
    ok("one can be withdrawn", (await P.locator('[data-testid="request-withdrawn"]').count()) === 1 || (await P.locator('[data-testid="request-pending"]').count()) === 1);

    // A staff request she keeps: coach at Hilton.
    await tid(P, "join-another").click().catch(() => {});
    await tid(P, `join-school-${HIL}`).click();
    await tid(P, "join-kind-staff").click();
    ok("staff: Send is off until she says what she does", await tid(P, "join-send").isDisabled());
    await tid(P, "join-staff-role").selectOption("coach");
    await tid(P, "join-send").click();
    await P.waitForSelector('[data-testid="join-sent"]', { timeout: 6000 }).catch(() => {});
    ok("a staff request is a request too", h.posts.at(-1)?.role === "coach" && /Somebody there will answer it/.test(await tid(P, "join-sent").innerText()), h.posts.at(-1));
    await tid(P, "join-another").click();
    await tid(P, `join-school-${HIL}`).click();
    await tid(P, "join-kind-parent").click();
    const fl = await floors(P, '[data-testid="pending-requests"]');
    ok("the no-school screen: nothing under 12px, nothing under 44px (390 wide)", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].join(" | "));
    ok("...and no sideways scroll", (await P.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    ok("no page errors on the new account's screens", h.errors.length === 0, h.errors.join(" | "));
    void parentReqs;
    await h.ctx.close();
  }

  // ── 3 · The office answers; Me ──────────────────────────────────
  group("3. The office answers; her next Google sign-in is the school's; Me lists the ways to sign in");
  const ALT_UID = `walkb-alt-${RUN}`, ALT_EMAIL = `walk.alt.${RUN}@example.invalid`;
  {
    const rr = await call("/api/read/role_requests", { token: office });
    const coach = rr.body?.rows?.find((x) => x.email === NEW_EMAIL && x.role === "coach" && x.state === "pending");
    ok("the office finds her coach request", !!coach, rr.body?.rows?.length);
    const dec = await call(`/api/requests/${coach?.id}/decide`, { method: "POST", token: office, body: { grant: true, teamCode: "U15A", note: "Known to the sportsmaster." } });
    ok("the office grants it", dec.status === 200 && dec.body?.state === "granted", dec);

    const h = await open({ viewport: DESK });
    await toLogin(h);
    await google(h, idToken(NEW_UID, NEW_EMAIL), 2800);
    ok("her next Google sign-in is the school's shell", await inShell(h.page), (await text(h.page)).slice(0, 160));
    ok("...not the no-school screen", (await tid(h.page, "pending-requests").count()) === 0);
    ok("Settings → Me opens", await settingsTab(h.page, "me"));
    await h.page.waitForSelector('[data-testid="sign-ins"]', { timeout: 6000 }).catch(() => {});
    await h.page.waitForTimeout(800);
    ok("Me carries Ways to sign in, with her Google account and no uid", (await tid(h.page, "sign-in-live").count()) === 1 && (await tid(h.page, "sign-in-email").first().innerText()) === NEW_EMAIL && !(await tid(h.page, "sign-ins").innerText()).includes(NEW_UID));
    ok("...and the signed paragraph, word for word", sentence(await tid(h.page, "sign-ins-notice").innerText()).includes(sentence(SIGNIN_NOTICE)));

    // A stale Google sign-in is refused in the server's words.
    h.next = idToken(ALT_UID, ALT_EMAIL, { auth_time: Math.floor(Date.now() / 1000) - 600 });
    await tid(h.page, "sign-in-add").click();
    await h.page.waitForSelector('[data-testid="sign-ins-error"]', { timeout: 6000 }).catch(() => {});
    ok("a Google sign-in ten minutes old is not enough, said in words", /sign in with Google again/.test(await tid(h.page, "sign-ins-error").innerText().catch(() => "")));
    // Another account's Google account.
    const OTHER_UID = `walkb-other-${RUN}`, OTHER_EMAIL = `walk.other.${RUN}@example.invalid`;
    const otherIn = await exchange(idToken(OTHER_UID, OTHER_EMAIL));
    ok("(setup) another person's Google account exists", otherIn.status === 200 && otherIn.body?.outcome === "new_account");
    h.next = idToken(OTHER_UID, OTHER_EMAIL);
    await tid(h.page, "sign-in-add").click();
    await h.page.waitForSelector('[data-testid="sign-ins-error"]', { timeout: 6000 }).catch(() => {});
    await h.page.waitForTimeout(500);
    ok("another account's Google account cannot be added, said in words", /already used to sign in/.test(await tid(h.page, "sign-ins-error").innerText().catch(() => "")), await tid(h.page, "sign-ins-error").innerText().catch(() => ""));
    // A fresh second one.
    h.next = idToken(ALT_UID, ALT_EMAIL);
    await tid(h.page, "sign-in-add").click();
    await h.page.waitForSelector('[data-testid="sign-ins-done"]', { timeout: 6000 }).catch(() => {});
    await h.page.waitForTimeout(800);
    ok("a fresh second Google account is added", /Added/.test(await tid(h.page, "sign-ins-done").innerText().catch(() => "")) && (await tid(h.page, "sign-in-live").count()) === 2, await text(h.page).then((t) => t.slice(0, 100)));
    const fl = await floors(h.page, '[data-testid="sign-ins"]');
    ok("Ways to sign in: nothing under 12px, nothing under 44px", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].join(" | "));

    // Remove the added one, after a confirm.
    const rowAlt = h.page.locator('[data-testid="sign-in-live"]', { hasText: ALT_EMAIL });
    await rowAlt.locator('[data-testid="sign-in-remove"]').click();
    ok("removing asks first, and says the session stays", (await tid(h.page, "sign-in-remove-confirm").count()) === 1 && /stay signed in/.test(await tid(h.page, "sign-in-remove-confirm").innerText()));
    await tid(h.page, "sign-in-remove-no").click();
    ok("Keep it keeps it", (await tid(h.page, "sign-in-live").count()) === 2 && (await tid(h.page, "sign-in-remove-confirm").count()) === 0);
    await rowAlt.locator('[data-testid="sign-in-remove"]').click();
    await tid(h.page, "sign-in-remove-yes").click();
    await h.page.waitForSelector('[data-testid="sign-in-removed"]', { timeout: 6000 }).catch(() => {});
    ok("it is removed, and shown as removed", (await tid(h.page, "sign-in-removed").count()) === 1 && (await tid(h.page, "sign-in-live").count()) === 1);
    const gone = await exchange(idToken(ALT_UID, ALT_EMAIL));
    ok("(API) the removed Google account signs in to nothing", gone.status === 401 && gone.body?.error === "identity_revoked", gone);
    ok("no page errors on Me", h.errors.length === 0, h.errors.join(" | "));
    await h.ctx.close();

    const h2 = await open({ viewport: PHONE });
    await toLogin(h2);
    await google(h2, idToken(ALT_UID, ALT_EMAIL));
    ok("the removed Google account is refused on the sign-in screen, in words", /removed/.test(await tid(h2.page, "google-error").innerText().catch(() => "")) && /code/.test(await tid(h2.page, "google-error").innerText().catch(() => "")));
    ok("...with no shell", (await tid(h2.page, "os-main").count()) === 0);
    await h2.ctx.close();
  }

  // ── 4 · The claim ───────────────────────────────────────────────
  group("4. An enrolled address is a claim: the office confirms with one tap, or answers with a code");
  const PARENT_UID = `walkb-parent-${RUN}`;
  {
    const h = await open({ viewport: PHONE });
    await toLogin(h);
    await google(h, idToken(PARENT_UID, "parent@example.invalid"), 2200);
    ok("the enrolled parent's address answers: waiting for your school office", (await tid(h.page, "google-claim-required").count()) === 1 && /Waiting for your school office/.test(await tid(h.page, "google-claim-required").innerText()));
    ok("...no shell, no token", (await tid(h.page, "os-main").count()) === 0 && (await tid(h.page, "pending-requests").count()) === 0);
    ok("...and says nothing of what the account holds", !/child|pupil|Pillay|guardian|parent/i.test(await tid(h.page, "google-claim-required").innerText()), await tid(h.page, "google-claim-required").innerText());
    ok("...the address is put in the code form for her", (await h.page.locator("#login-email").inputValue()) === "parent@example.invalid");
    const fl = await floors(h.page, '[data-testid="google-signin"]');
    ok("the claim state: nothing under 12px, nothing under 44px", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].join(" | "));

    // A second claim, for the code path.
    const c2 = await open({ viewport: PHONE });
    await toLogin(c2);
    await google(c2, idToken(`walkb-coach2-${RUN}`, "coach2@example.invalid"), 2200);
    ok("a coach's address is a claim too", (await tid(c2.page, "google-claim-required").count()) === 1);

    // The office, in a browser.
    const o = await open({ viewport: DESK });
    ok("the office signs in", await devSignIn(o, "registrar@example.invalid"));
    ok("Settings → People opens", await settingsTab(o.page, "users"));
    await o.page.waitForSelector('[data-testid="claims"]', { timeout: 6000 }).catch(() => {});
    await o.page.waitForTimeout(800);
    const parentClaim = o.page.locator('[data-testid="claim"]', { hasText: "parent@example.invalid" }).first();
    ok("the Claims list is on People, with the parent's claim", (await tid(o.page, "claims").count()) === 1 && (await parentClaim.count()) === 1, (await tid(o.page, "claims").innerText().catch(() => "")).slice(0, 200));
    ok("...enrolled address beside Google's, no uid", (await parentClaim.locator('[data-testid="claim-enrolled"]').innerText()) === "parent@example.invalid"
       && (await parentClaim.locator('[data-testid="claim-google"]').innerText()) === "parent@example.invalid" && !(await tid(o.page, "claims").innerText()).includes(PARENT_UID));
    ok("...counted on the People tab", /\d/.test(await o.page.locator("#settings-tab-users").innerText()));
    const flc = await floors(o.page, '[data-testid="claims"]');
    ok("the Claims list: nothing under 12px, nothing under 44px", flc.small.length === 0 && flc.tiny.length === 0, [...flc.small, ...flc.tiny].join(" | "));

    await parentClaim.locator('[data-testid="claim-confirm"]').click();
    await o.page.waitForSelector('[data-testid="claims-done"]', { timeout: 6000 }).catch(() => {});
    await o.page.waitForTimeout(800);
    ok("one tap confirms it, said in words", /Confirmed/.test(await tid(o.page, "claims-done").innerText().catch(() => "")));
    ok("...and it leaves the list", (await o.page.locator('[data-testid="claim"]', { hasText: "parent@example.invalid" }).count()) === 0);

    await google(h, idToken(PARENT_UID, "parent@example.invalid"), 2800);
    ok("the parent's next Google sign-in is the parent's own app", await inShell(h.page), (await text(h.page)).slice(0, 120));
    ok("...not the claim state", (await tid(h.page, "google-claim-required").count()) === 0);

    // The code path.
    const coachClaim = o.page.locator('[data-testid="claim"]', { hasText: "coach2@example.invalid" }).first();
    ok("the coach's claim is on the list", (await coachClaim.count()) === 1);
    await coachClaim.locator('[data-testid="claim-code"]').click();
    await o.page.waitForSelector('[data-testid="issued-code"]', { timeout: 6000 }).catch(() => {});
    ok("Issue a code instead shows the code once", /^[A-Z0-9 -]{6,}$/i.test((await tid(o.page, "issued-code").innerText().catch(() => "")).trim()), await tid(o.page, "issued-code").innerText().catch(() => ""));
    ok("no page errors on the claim screens", h.errors.length + c2.errors.length + o.errors.length === 0, [...h.errors, ...c2.errors, ...o.errors].join(" | "));
    await h.ctx.close(); await c2.ctx.close(); await o.ctx.close();
  }

  // ── 5 · Both themes ─────────────────────────────────────────────
  group("5. Daylight and Floodlit: the new account's screen and the sign-in block hold the floors");
  for (const scheme of ["light", "dark"]) {
    const h = await open({ viewport: PHONE, scheme });
    await toLogin(h);
    const a = await floors(h.page, '[data-testid="google-signin"]');
    ok(`${scheme}: the Google block holds the floors`, a.small.length === 0 && a.tiny.length === 0, [...a.small, ...a.tiny].join(" | "));
    await google(h, idToken(`walkb-theme-${scheme}-${RUN}`, `walk.theme.${scheme}.${RUN}@example.invalid`), 2500);
    await h.page.waitForSelector('[data-testid="join-school"]', { timeout: 5000 }).catch(() => {});
    const b = await floors(h.page, '[data-testid="pending-requests"]');
    ok(`${scheme}: the no-school screen holds the floors`, b.small.length === 0 && b.tiny.length === 0, [...b.small, ...b.tiny].join(" | "));
    ok(`${scheme}: no page errors`, h.errors.length === 0, h.errors.join(" | "));
    await h.ctx.close();
  }
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
console.log(`\n${"─".repeat(52)}\nSIGN-UP BROWSER WALK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

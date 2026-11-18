#!/usr/bin/env node
/**
 * The under-18 basic view, in a browser (SCRBRD-140, the honesty model §3.3
 * and §7 row 2; db/163, Migration A).
 *
 * A boy of fifteen signs in with Google (the walk is its own "Google", as
 * tools/smoke-browser-signup.mjs is), says "I am a pupil", "I am under 18",
 * and sends his claim. The walk then holds his screen to §3.3: EVERY row of
 * its left column is there, and NO row of its right column is, first with
 * his claim at the office and again once the office has recognised him in
 * its own browser (Settings → People → Pupil claims). Row by row:
 *
 *   left (must be there)                    right (must not be)
 *   his account: his name, his sign-ins,    Home, Passport and Me; his profile,
 *     sign out, remove the account            caps, honours, figures, ratings,
 *   his state, in one true sentence, and      injuries, load and consents
 *     how; Q9's date                        his side as a side: fixtures as his,
 *   matches: the schools he follows, their    the signed-in scorecard, the ball
 *     public matches (a follow of his own)    log, the team sheet, bus, training
 *   his own record: nothing                 his availability
 *   what he can answer: nothing             team-mates, Compare, the captain's block
 *   team-mates: nothing                     "Appointed to score"
 *   scoring: a Practice Match on his phone  the side's notices; "Agreed" on Me
 *   safeguarding: recognised, his school's  a request form of any kind
 *     card (officers by name, the line,     a sponsor slot; an analytics event
 *     Raise a concern, Report anonymously)  "Who read my record"
 *   notices: only the system's own
 *   requests: none
 *
 * Also: what the screen asks the server is his own and the public's only;
 * the claim form sends nothing that names a child and no date of birth;
 * Raise a concern works from the basic view (Q8); "Remove this account"
 * removes it; a pupil whose address the office enrolled is told the office
 * is checking, and offered the public pages (the changed claim_required
 * words); 12px and 44px at 390 and 1366, light and dark; no page errors.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-browser-under18.mjs
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
import pg from "pg";
import { appUrl, ownerUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(4386);
const API_PORT = port(8986);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };
const HIL = "11111111-1111-1111-1111-111111111111";
const PROJECT = "scrbrd-os-test";
const RUN = Date.now().toString(36);
const GUARDIAN_URL = "https://example.invalid/the-guardian";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);

// ── The walk's own "Google" ──
const dir = await mkdtemp(join(tmpdir(), "scrbrd-under18-"));
const keyFile = join(dir, "keys.json");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
await writeFile(keyFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "walk-1", alg: "RS256", use: "sig" }] }));
const b64 = (s) => Buffer.from(s).toString("base64url");
const idToken = (uid, email, over = {}) => {
  const t = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, email, email_verified: true, name: "Walk Pupil",
    iat: t - 5, exp: t + 3600, auth_time: t - 5, firebase: { sign_in_provider: "google.com" }, ...over };
  const input = `${b64(JSON.stringify({ alg: "RS256", kid: "walk-1", typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
  const s = createSign("RSA-SHA256"); s.update(input);
  return `${input}.${s.sign(privateKey).toString("base64url")}`;
};

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "browser-under18-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}`, FIREBASE_TEST_KEYS: keyFile,
         GUARDIAN_APP_URL: GUARDIAN_URL, PUBLIC_TRUST_PROXY_HOPS: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

const built = buildWebForWalk();
ok("the walk's own build is made", built.ok, built.out);
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
const exchange = (tok) => call("/api/auth/firebase", { method: "POST", body: { idToken: tok, deviceId: "device-under18" } });

/** A fresh context with the walk's Google wired in: set `h.next` before pressing the button. */
async function open({ viewport = PHONE, scheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await offline(ctx);
  const h = { ctx, next: null, requests: [], errors: [], bodies: [] };
  await ctx.exposeFunction("__walkGoogle", () => {
    if (!h.next) return null;
    return { idToken: h.next, email: JSON.parse(Buffer.from(h.next.split(".")[1], "base64url").toString()).email };
  });
  const page = await ctx.newPage();
  watchReads(page);
  h.page = page;
  page.on("pageerror", (e) => h.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) h.errors.push(m.text()); });
  page.on("request", (r) => {
    const u = new URL(r.url());
    h.requests.push(`${r.method()} ${u.host === new URL(API).host ? u.pathname : u.host + u.pathname}`);
    if (r.method() === "POST") h.bodies.push(`${u.pathname} ${r.postData() ?? ""}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)}; window.__SCRBRD_TEST_GOOGLE__ = () => window.__walkGoogle();`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return h;
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const bodyText = (page) => page.$eval("body", (el) => el.innerText);
const sentence = (s) => s.replace(/\s+/g, " ").trim();
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
async function toLogin(h) {
  await click(h.page, /Get Started|Log In/, 5000);
  await h.page.waitForSelector("#login-email", { timeout: 6000 }).catch(() => {});
  await h.page.waitForSelector('[data-testid="google-button"]', { timeout: 6000 }).catch(() => {});
}
async function google(h, token, wait = 2500) {
  h.next = token;
  await tid(h.page, "google-button").click({ timeout: 5000 });
  await h.page.waitForTimeout(wait);
  await afterReads(h.page, 800);
}
async function devSignIn(h, email) {
  await toLogin(h);
  await h.page.locator("#login-email").fill(email);
  await click(h.page, /^Sign In$/, 5000);
  await afterReads(h.page, 2200);
  return (await tid(h.page, "os-main").count()) === 1;
}
async function go(page, key) {
  const l = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"]`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await afterReads(page, 1200);
  return true;
}
async function settingsTab(page, tab) {
  if (!(await go(page, "settings"))) return false;
  try { await page.locator(`#settings-tab-${tab}`).click({ timeout: 4000 }); } catch { return false; }
  await afterReads(page, 1200);
  return true;
}
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
      if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))
          || (n.tagName === "A" && n.closest("[data-testid=pupil-basic]"))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 43.5) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny };
  }, region);
}
/** No horizontal scroll at this width. */
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// §3.3's right column, as words a screen of his would carry. Each is a
// thing the opened pupil's app shows and the basic view must not.
const RIGHT = [
  ["Home, Passport and Me", /\bPassport\b|\bMy record\b/],
  ["his profile, caps, honours, figures, ratings", /\bCaps?\b|\bHonours\b|\bBatting average\b|\bStrike rate\b|\bEconomy\b|\bRatings?\b/],
  ["his injuries, load and consents", /\bInjur(y|ies)\b|\bWorkload\b|\bBowling load\b|\bHealth monitoring\b/],
  ["his side as a side: fixtures as his, the team sheet, bus, training", /\bTeam sheet\b|\bYour side\b|\bYour next match\b|\bTraining\b|\bThe bus\b|\bU1[0-9][A-F]\b|\b1st XI\b/],
  ["the signed-in scorecard and the ball log", /\bBall log\b|\bBall by ball\b/],
  ["his availability", /\bAvailab(le|ility)\b/],
  ["team-mates, Compare, the captain's block", /\bTeam-?mates?\b|\bCompare\b|\bCaptain\b/],
  ["Appointed to score", /Appointed to score/],
  ["Agreed, with its date, on Me", /\bAgreed\b/],
  ["a request form of any kind", /Join a school|Send my request|Your requests|Ask SCRBRD to add|signed-in view|I work at the school|I am a parent/],
  ["a sponsor slot", /\bSponsor(ed)?\b/],
  ["who read my record", /Who read|who has read/i],
];

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await call("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the client is built", (await readdir(join(WEB_TEST_ROOT, "assets")).catch(() => [])).length > 0);
  // His place on Hilton's roster: a boy of fifteen with no account, as the office's import makes one.
  const own = new pg.Pool({ connectionString: ownerUrl() });
  const BOY = (await own.query(`insert into player (school_id, team_code, full_name, surname, squad_no, playing_role, born)
    values ($1, 'U15A', 'Walk Rosterboy', 'Rosterboy', 98, 'batter', (current_date - interval '15 years')::date) returning id`, [HIL])).rows[0].id;

  const KID_UID = `walku18-${RUN}`, KID_EMAIL = `walk.under18.${RUN}@example.invalid`;

  // ── 1 · He says who he is ───────────────────────────────────────
  group("1. A boy of fifteen signs in with Google and says \"I am a pupil here\"");
  {
    const h = await open({ viewport: PHONE });
    await toLogin(h);
    await google(h, idToken(KID_UID, KID_EMAIL));
    const P = h.page;
    ok("he lands on the no-school screen", (await tid(P, "join-school").count()) === 1, (await bodyText(P)).slice(0, 200));
    await tid(P, `join-school-${HIL}`).click();
    await tid(P, "join-kind-pupil").click();
    ok("being a pupil is offered as telling the school who he is", /Tell your school who you are/.test(await tid(P, "join-kind-pupil").innerText()));
    await tid(P, "join-pupil-minor").click();
    ok("under 18: the claim form, and no request's Send button", (await tid(P, "join-pupil-under18").count()) === 1 && (await tid(P, "join-send").count()) === 0 && (await tid(P, "join-pupil-send").count()) === 1);
    const form = sentence(await tid(P, "join-pupil-under18").innerText());
    ok("...which promises nothing, and says what sending does and how long it is kept",
       /Nothing about you is opened/.test(form) && /pupil under 18/.test(form) && /30 days/.test(form) && /removed/.test(form), form);
    ok("...and asks no date of birth", (await P.locator('[data-testid="join-pupil-under18"] input[type="date"]').count()) === 0 && !/birth/i.test(form));
    const fl = await floors(P, '[data-testid="join-school"]');
    ok("the form: nothing under 12px, nothing under 44px", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].join(" | "));
    h.bodies.length = 0;
    await tid(P, "join-pupil-name").fill("Sipho Walker");
    await tid(P, "join-pupil-year").fill("Grade 9");
    await tid(P, "join-pupil-send").click();
    await P.waitForSelector('[data-testid="pupil-basic"]', { timeout: 8000 }).catch(() => {});
    ok("sent: the screen is his basic view", (await tid(P, "pupil-basic").count()) === 1, (await bodyText(P)).slice(0, 300));
    const sent = h.bodies.filter((b) => b.startsWith("/api/pupil/claim"));
    ok("the claim sent his school, his name and his year, and nothing else", sent.length === 1 && /"name":"Sipho Walker"/.test(sent[0]) && !/born|playerId|player/.test(sent[0]), sent);
    ok("no role was asked for", !h.bodies.some((b) => b.startsWith("/api/requests")), h.bodies);
    await h.ctx.close();
  }

  // ── 2 · §3.3, with the office ────────────────────────────────────
  /** Every row of §3.3's left column, and none of its right. */
  async function holdsTheTable(P, { recognised, label }) {
    const t = sentence(await bodyText(P));
    // His account.
    ok(`${label}: his name and his address`, /Hello Walk Pupil/.test(await tid(P, "no-school-title").innerText()) && (await tid(P, "no-school-email").innerText()) === KID_EMAIL);
    ok(`${label}: his sign-ins, sign out, remove the account`, (await tid(P, "pupil-sign-ins").count()) === 1 && /google\.com|Google/.test(await tid(P, "pupil-sign-ins").innerText())
       && (await tid(P, "no-school-sign-out").count()) === 1 && (await tid(P, "pupil-remove").count()) === 1);
    // His state.
    const state = sentence(await tid(P, "pupil-state").innerText());
    if (recognised) {
      ok(`${label}: his state, the design's sentence`, state.includes("Your school knows this is you.") && state.includes("A parent or guardian needs to say yes before your own page opens."), state);
      ok(`${label}: ...and how a yes comes`, /signed consent form/.test(state) && /office/.test(state), state);
    } else {
      ok(`${label}: his state, the sentence for everyone not yet matched`, /^Sent to the school/.test(state) && /Somebody at Hilton College will answer\./.test(state), state);
    }
    ok(`${label}: the name he typed, never the roster's`, state.includes("Sipho Walker") && !t.includes("Rosterboy"), state);
    ok(`${label}: Q9's date from the first day`, /This account is kept until \d{1,2} [A-Z][a-z]+ \d{4}, 30 days from your last claim/.test(await tid(P, "pupil-keep").innerText()), await tid(P, "pupil-keep").innerText().catch(() => ""));
    // Matches: the schools he follows.
    ok(`${label}: the schools he follows, their public matches`, (await tid(P, "followed-schools").count()) === 1);
    // Scoring: a Practice Match.
    ok(`${label}: a Practice Match on his own phone`, (await tid(P, "start-match").count()) === 1 || (await tid(P, "scoring-block").count()) === 1);
    // Safeguarding.
    if (recognised) {
      const card = sentence(await tid(P, "pupil-safeguarding").innerText().catch(() => ""));
      ok(`${label}: his school's safeguarding card: the officers by name, the line, Raise a concern, Report anonymously`,
         (await tid(P, "pupil-dso").count()) >= 1 && /10111/.test(card) && (await tid(P, "pupil-raise").count()) === 1 && (await tid(P, "pupil-guardian").getAttribute("href")) === GUARDIAN_URL, card);
    } else {
      ok(`${label}: not yet recognised, The Guardian's link only, no school card`, (await tid(P, "no-school-help").count()) === 1
         && (await tid(P, "pupil-safeguarding").count()) === 0 && (await tid(P, "no-school-guardian").getAttribute("href")) === GUARDIAN_URL);
    }
    // Nothing of the shell, his record or his side; no asking.
    ok(`${label}: no shell, no menu`, (await tid(P, "os-main").count()) === 0 && (await tid(P, "persona-bar").count()) === 0 && (await P.locator('[data-testid^="mnav-"], [data-testid^="nav-"]').count()) === 0);
    for (const [row, re] of RIGHT) ok(`${label}: not there: ${row}`, !re.test(t), t.match(re)?.[0]);
    ok(`${label}: no request form, no request list, no school note, no signed-in view to ask for`,
       (await P.locator('[data-testid="join-school"], [data-testid="no-school-requests"], [data-testid="join-school-missing"], [data-testid^="ask-view-"]').count()) === 0);
    ok(`${label}: no notice of the side's, and no notices block`, (await P.locator('[data-testid="no-school-notices"], [data-testid="notice-row"]').count()) === 0);
  }

  group("2. His basic view, with his claim at the office: §3.3, left column there, right column not");
  {
    const h = await open({ viewport: PHONE });
    await toLogin(h);
    await google(h, idToken(KID_UID, KID_EMAIL));
    const P = h.page;
    await P.waitForSelector('[data-testid="pupil-basic"]', { timeout: 8000 }).catch(() => {});
    ok("signing in again, he lands on his basic view", (await tid(P, "pupil-basic").count()) === 1 && (await tid(P, "pupil-basic").getAttribute("data-state")) === "with_office");
    // He follows his school, from his own screen.
    if (await tid(P, "pupil-follow-school").count()) { await tid(P, "pupil-follow-school").click(); await afterReads(P, 1500); }
    ok("he follows Hilton's public matches", (await tid(P, "followed-school-HIL").count()) === 1);
    await holdsTheTable(P, { recognised: false, label: "with the office" });
    const api = [...new Set(h.requests.filter((r) => /^(GET|POST|DELETE) \/api\//.test(r)).map((r) => r.replace(/\/[0-9a-f-]{36}/g, "/:id")))];
    const allowed = /^(GET|POST) \/api\/(health|session|schools|pupil\/state|pupil\/claim|follows(\/today)?|safeguarding\/contacts|auth\/firebase|read\/(my_sign_ins|role_requests|school_add_requests|my_links|notifications))$/;
    ok("what the screen asked the server is his own and the public's only", api.every((r) => allowed.test(r)), api.filter((r) => !allowed.test(r)));
    ok("...and no analytics event left the page", !h.requests.some((r) => /google-analytics|googletagmanager|firebaselogging|app-measurement/.test(r)), h.requests.filter((r) => /analytics|measurement/.test(r)));
    // The same reads, as his token: nothing but his own.
    const tok = (await exchange(idToken(KID_UID, KID_EMAIL))).body?.token;
    for (const res of ["players", "matches", "injuries", "availability", "notifications", "fixture_squads"]) {
      const r = await call(`/api/read/${res}`, { token: tok });
      ok(`his token reads no ${res}`, r.status !== 200 || (r.body?.rows ?? []).length === 0, JSON.stringify(r.body).slice(0, 160));
    }
    for (const [vp, scheme] of [[PHONE, "light"], [DESK, "dark"]]) {
      await P.setViewportSize(vp);
      await P.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await P.waitForTimeout(300);
      const fl = await floors(P, '[data-testid="pupil-basic"]');
      ok(`at ${vp.width} (${scheme}): nothing under 12px, nothing tapped under 44px`, fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].join(" | "));
      ok(`at ${vp.width}: no sideways scroll`, await fits(P));
    }
    ok("no page errors", h.errors.length === 0, h.errors.join(" | "));
    await h.ctx.close();
  }

  // ── 3 · The office recognises him, in its own browser ────────────
  group("3. The office recognises him from Settings → People → Pupil claims; it opens nothing");
  {
    const o = await open({ viewport: DESK });
    ok("the office signs in", await devSignIn(o, "registrar@example.invalid"));
    ok("Settings → People opens", await settingsTab(o.page, "users"));
    await o.page.waitForSelector('[data-testid="pupil-claims"]', { timeout: 6000 }).catch(() => {});
    const row = o.page.locator('[data-testid="pupil-claim"]', { hasText: "Sipho Walker" }).first();
    ok("his claim is on the list, with his address and what he typed", (await row.count()) === 1 && (await row.locator('[data-testid="pupil-claim-address"]').innerText()) === KID_EMAIL);
    ok("...and the office is told recognising opens nothing", /opens nothing/.test(await tid(o.page, "pupil-claims").innerText()));
    await row.locator('[data-testid="pupil-claim-search"]').fill("Rosterboy");
    await row.locator('[data-testid="pupil-claim-pick"]').selectOption(BOY);
    await row.locator('[data-testid="pupil-claim-recognise"]').click();
    await o.page.waitForSelector('[data-testid="pupil-claims-done"]', { timeout: 6000 }).catch(() => {});
    ok("recognised, in words", /Recognised Sipho Walker\. Nothing about him is opened by it\./.test(await tid(o.page, "pupil-claims-done").innerText().catch(() => "")));
    const after = o.page.locator('[data-testid="pupil-claim"]', { hasText: "Sipho Walker" }).first();
    ok("...and the list says so, with his place on the list", (await after.getAttribute("data-state")) === "recognised" && /Walk Rosterboy/.test(await after.innerText()));
    const fl = await floors(o.page, '[data-testid="pupil-claims"]');
    ok("the Pupil claims list: nothing under 12px, nothing under 44px", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].join(" | "));
    ok("no page errors on the office's screens", o.errors.length === 0, o.errors.join(" | "));
    await o.ctx.close();
  }

  // ── 4 · §3.3 again, recognised ──────────────────────────────────
  group("4. Recognised and waiting: §3.3 again, and Raise a concern (Q8)");
  {
    const h = await open({ viewport: PHONE, scheme: "dark" });
    await toLogin(h);
    await google(h, idToken(KID_UID, KID_EMAIL));
    const P = h.page;
    await P.waitForSelector('[data-testid="pupil-safeguarding"]', { timeout: 8000 }).catch(() => {});
    ok("he is recognised", (await tid(P, "pupil-basic").getAttribute("data-state")) === "recognised");
    await holdsTheTable(P, { recognised: true, label: "recognised" });
    const tok = (await exchange(idToken(KID_UID, KID_EMAIL))).body?.token;
    ok("recognised, his session still holds no role", (await call("/api/session", { token: tok })).body?.assignments?.length === 0);
    const players = await call("/api/read/players", { token: tok });
    ok("...and he reads no roster row, his own included", (players.body?.rows ?? []).length === 0);
    await tid(P, "pupil-raise").click();
    await P.waitForSelector('[data-testid="sg-form"]', { timeout: 8000 }).catch(() => {});
    ok("Raise a concern opens the form", (await tid(P, "sg-form").count()) === 1);
    ok("...which lists no child to pick", (await P.locator("#sg-child").count()) === 0);
    await P.locator('[data-testid="sg-about"] button, [data-testid="sg-about"] label').filter({ hasText: /adult/i }).first().click().catch(() => {});
    await P.locator('[data-testid="sg-nature"] button, [data-testid="sg-nature"] label').filter({ hasText: /bully/i }).first().click().catch(() => {});
    await P.locator('[data-testid="sg-certainty"] button, [data-testid="sg-certainty"] label').first().click().catch(() => {});
    await P.locator('[data-testid="sg-how"] button, [data-testid="sg-how"] label').filter({ hasText: /me|happened to/i }).first().click().catch(() => {});
    await tid(P, "sg-account").fill("Somebody at nets keeps shouting at me and pushing me.");
    await tid(P, "sg-send").click();
    await P.waitForSelector('[data-testid="sg-sent"]', { timeout: 8000 }).catch(() => {});
    ok("he raises it from the basic view: a reference, and nothing else", /^SG-[A-Z0-9]{4}-\d{4}$/.test((await tid(P, "sg-reference").innerText().catch(() => "")).trim()), await bodyText(P).then((x) => x.slice(0, 300)));
    await click(P, /^Done$/);
    ok("Done brings back his card", (await tid(P, "pupil-safeguarding").count()) === 1);
    ok("no page errors", h.errors.length === 0, h.errors.join(" | "));
    await h.ctx.close();
  }

  // ── 5 · Remove this account ─────────────────────────────────────
  group("5. \"Remove this account\": asked first, then gone with its follow list");
  {
    const U = `walku18b-${RUN}`, E = `walk.under18b.${RUN}@example.invalid`;
    const h = await open({ viewport: PHONE });
    await toLogin(h);
    await google(h, idToken(U, E));
    const P = h.page;
    await tid(P, `join-school-${HIL}`).click();
    await tid(P, "join-kind-pupil").click();
    await tid(P, "join-pupil-minor").click();
    await tid(P, "join-pupil-name").fill("Lungi Walker");
    await tid(P, "join-pupil-send").click();
    await P.waitForSelector('[data-testid="pupil-basic"]', { timeout: 8000 }).catch(() => {});
    await tid(P, "pupil-remove").click();
    ok("it asks first, saying what goes", /sign-in and the schools you follow/.test(await tid(P, "pupil-remove-ask").innerText().catch(() => "")));
    await tid(P, "pupil-remove-confirm").click();
    await P.waitForTimeout(2000);
    ok("removed: he is signed out", (await tid(P, "pupil-basic").count()) === 0);
    const again = await exchange(idToken(U, E));
    ok("...and his Google account is a stranger's again", again.status === 200 && again.body?.outcome === "new_account", JSON.stringify(again.body));
    ok("no page errors", h.errors.length === 0, h.errors.join(" | "));
    await h.ctx.close();
  }

  // ── 6 · An enrolled pupil's address: the office checks, the public pages meanwhile ──
  group("6. A pupil the office enrolled signs in with Google: a wait, not a refusal, with the public pages");
  {
    const h = await open({ viewport: PHONE });
    await toLogin(h);
    await google(h, idToken(`walku18c-${RUN}`, "pillay@example.invalid"));
    const P = h.page;
    const claim = sentence(await tid(P, "google-claim-required").innerText().catch(() => ""));
    ok("he is told the office is checking it is him, nothing about whose account it is", /Waiting for your school office/.test(claim) && !/pupil|child|player|parent|guardian/i.test(claim), claim);
    ok("...and offered the public pages meanwhile", /public matches are open to you/.test(claim) && (await tid(P, "google-claim-public").getAttribute("href")) === "/");
    ok("...with no shell", (await tid(P, "os-main").count()) === 0 && (await tid(P, "pupil-basic").count()) === 0);
    const fl = await floors(P, '[data-testid="google-claim-required"]');
    ok("the claim block: nothing under 12px, nothing under 44px", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].join(" | "));
    ok("no page errors", h.errors.length === 0, h.errors.join(" | "));
    await h.ctx.close();
  }
  await own.end().catch(() => {});
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
console.log(`\n${"─".repeat(52)}\nUNDER-18 BROWSER WALK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

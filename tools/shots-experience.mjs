#!/usr/bin/env node
/**
 * The experience screenshots: what each person sees, from first run to their
 * three likeliest destinations, for a design pass on the whole product.
 *
 * A tool, not a walk: it asserts nothing and is not in run-smoke-api.mjs.
 * Modelled on tools/shots-cri02.mjs (same way of measuring with
 * tools/a11y-narrow.mjs, same JPEG rule). Nothing in the app is changed.
 *
 * Personas (the seed's invented people, signed in by dev login as the walks do):
 *   director of sport  sarah@        (also a coach and a parent: the staff menu)
 *   sports admin/office registrar@   (schooladmin; the seed holds no "sportsadmin")
 *   coach              coach@
 *   team manager       manager@      (added by this tool to its own database: the seed has none)
 *   scorer             scorer@
 *   parent             parent@
 *   pupil              pillay@
 *   spectator, signed out   the public home page, /live, /scorecard, /display
 *   spectator, signed in    watcher@
 *   platform admin     platform@
 * plus first run: the sign-in screen, the no-school state, and the onboarding
 * flow step by step.
 *
 * Widths 390 (a touch phone) and 1366. Themes Daylight (light) and Floodlit (dark).
 *
 *   SCRBRD_DB=scrbrd_xpshots SCRBRD_DB_PORT=5433 SCRBRD_PORT_OFFSET=37 (the tool itself runs migrate --reset --seed first)
 *   (the walks' build of the client, with the Google test hook:  node -e "import('./tools/web-test-build.mjs').then(m=>m.buildWebForWalk())")
 *   SCRBRD_DB=scrbrd_xpshots SCRBRD_DB_PORT=5433 SCRBRD_PORT_OFFSET=37 node tools/shots-experience.mjs
 *   XP_ONLY=scorer,parent XP_WIDTHS=390 XP_THEMES=light node tools/shots-experience.mjs     a part of it
 *
 * Writes audit/experience-screens/<persona>-<screen>-<width>-<theme>.(png|jpg)
 * and NOTES.md. A picture over about 300 KB is a JPEG at quality 70, one taller
 * than 2400px is cut at 2400. Local databases only: it refuses any other host.
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { buildWebForWalk, WEB_TEST_ROOT } from "./web-test-build.mjs";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createSign } from "node:crypto";
import pg from "pg";
import { ownerUrl, appUrl, port, refuseUnlessLocal } from "./db-url.mjs";
import { buildMatchCentreFixture } from "./fixture-matchcentre.mjs";
import { narrowAudit } from "./a11y-narrow.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

refuseUnlessLocal("shots-experience");
if (/onrender\.com|supabase/i.test(ownerUrl() + appUrl())) throw new Error("not against a live database");

const API_PORT = port(8990);
const BASE = `http://127.0.0.1:${API_PORT}`;
const OUT = "audit/experience-screens";
const WIDTHS = (process.env.XP_WIDTHS || "390,1366").split(",").map(Number);
const THEME_ALL = [["light", "Daylight"], ["dark", "Floodlit"]];
const THEMES = THEME_ALL.filter(([s]) => !process.env.XP_THEMES || process.env.XP_THEMES.split(",").includes(s));
const ONLY = process.env.XP_ONLY ? process.env.XP_ONLY.split(",") : null;
const HEIGHT = { 390: 844, 1366: 900 };
const MAX_H = 2400;
const BIG = 300 * 1024;
const PROJECT = "scrbrd-os-test";
const HIL = "11111111-1111-1111-1111-111111111111";
const RUN = Date.now().toString(36);

// ── The tool's own "Google" (as tools/smoke-browser-signup.mjs): a key it made, for a test project ──
const dir = await mkdtemp(join(tmpdir(), "scrbrd-xp-"));
const keyFile = join(dir, "keys.json");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
await writeFile(keyFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "walk-1", alg: "RS256", use: "sig" }] }));
const b64 = (s) => Buffer.from(s).toString("base64url");
const idToken = (uid, email) => {
  const t = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, email, email_verified: true, name: "Newcomer Example",
    iat: t - 5, exp: t + 3600, auth_time: t - 5, firebase: { sign_in_provider: "google.com" } };
  const input = `${b64(JSON.stringify({ alg: "RS256", kid: "walk-1", typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
  const s = createSign("RSA-SHA256"); s.update(input);
  return `${input}.${s.sign(privateKey).toString("base64url")}`;
};

// ── Build, server, database ──
// A clean database every run (the Match Centre fixture can be written once): migrate --reset refuses a non-local host.
if (!process.env.XP_SKIP_RESET) {
  const { spawnSync } = await import("node:child_process");
  const m = spawnSync(process.execPath, ["tools/migrate.mjs", "--reset", "--seed"], { env: process.env, encoding: "utf8" });
  if (m.status !== 0) { console.log("migrate --reset --seed failed:", (m.stderr || m.stdout).slice(-300)); process.exit(1); }
}
if (!process.env.XP_SKIP_BUILD) {
  const built = buildWebForWalk();
  if (!built.ok) { console.log("the walk's build failed:", built.out); process.exit(1); }
}
const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "shots-experience-secret", PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "shots-experience-pseudonyms-0123456789abcdef",
         PUBLIC_TRUST_PROXY_HOPS: "0", SERVE_CLIENT: WEB_TEST_ROOT, FIREBASE_TEST_KEYS: keyFile },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));
const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await pool.query(text, params)).rows;
const browser = await chromium.launch({ ...launchOptions() });

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const loaded = (page) => page.waitForFunction(() => !/Loading|Reading/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});

async function open({ width, scheme }) {
  const phone = width < 768;
  const ctx = await browser.newContext({
    viewport: { width, height: HEIGHT[width] ?? 900 }, colorScheme: scheme,
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}),
  });
  await offline(ctx);
  const h = { ctx, token: null };
  await ctx.exposeFunction("__xpGoogle", () => (h.token ? { idToken: h.token, email: JSON.parse(Buffer.from(h.token.split(".")[1], "base64url").toString()).email } : null));
  const page = await ctx.newPage();
  h.page = page;
  watchReads(page);
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)}; window.__SCRBRD_TEST_GOOGLE__ = () => window.__xpGoogle();`);
  return h;
}
const toApp = async (page) => { await page.goto(`${BASE}/app`, { waitUntil: "networkidle" }); };
async function toLogin(page) {
  const lg = page.locator("button:not([disabled])", { hasText: /Get Started|Log In/ }).first();
  if (await lg.count()) { await lg.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(500); }
  await page.waitForSelector("#login-email", { timeout: 6000 }).catch(() => {});
  await page.waitForSelector('[data-testid="google-button"]', { timeout: 6000 }).catch(() => {});
}
async function signIn(page, email) {
  await toApp(page);
  await toLogin(page);
  await page.locator("#login-email").fill(email);
  await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForSelector('[data-testid="os-main"]', { timeout: 10000 }).catch(() => {});
  await afterReads(page, 1500);
  return (await tid(page, "os-main").count()) === 1;
}

/** One destination of the menu: the bottom bar, the drawer behind More on a phone, the side nav on a desktop. */
async function openDrawer(page) {
  if (await tid(page, "drawer").count()) return true;
  if (!(await tid(page, "mnav-more").count())) return false;
  await tid(page, "mnav-more").click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(600);
  return (await tid(page, "drawer").count()) > 0;
}
async function closeDrawer(page) {
  if (!(await tid(page, "drawer").count())) return;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  if (await tid(page, "drawer").count()) { await tid(page, "drawer-scrim").click({ timeout: 2000, force: true }).catch(() => {}); await page.waitForTimeout(400); }
}
async function go(page, key) {
  await closeDrawer(page);
  const direct = page.locator(`[data-testid="nav-${key}"], [data-testid="mnav-${key}"]`).first();
  if (await direct.isVisible().catch(() => false)) {
    await direct.click({ timeout: 6000 }).catch(() => {});
  } else if (await openDrawer(page)) {
    const d = tid(page, `drawer-${key}`);
    if (!(await d.count())) { await closeDrawer(page); return false; }
    await d.click({ timeout: 6000 }).catch(() => {});
  } else return false;
  await afterReads(page, 1200);
  await loaded(page);
  return true;
}

/** The pad's own prompts (a bowler, the next batter), answered so it is the pad that is drawn. */
async function clearBlockers(page) {
  for (let i = 0; i < 6; i++) {
    const b = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await b.count()) { await b.first().click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(500); continue; }
    const n = page.locator("button:not([disabled])", { hasText: /Next\s*$/i });
    if (await n.count()) { await n.first().click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(500); continue; }
    break;
  }
}
async function openPad(page) {
  await go(page, "matches");
  let opened = false;
  for (let i = 0; i < 3 && !opened; i++) {
    opened = await page.evaluate(() => {
      const isBtn = (b) => /Start Scoring|Open Live Scorer|Resume/i.test(b.textContent || "");
      for (const b of [...document.querySelectorAll("button")].filter(isBtn)) {
        let card = b;
        while (card.parentElement && [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) card = card.parentElement;
        if (/Westville/i.test(card.textContent || "")) { b.click(); return true; }
      }
      return false;
    });
    if (!opened) await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(2500);
  await clearBlockers(page);
  if (!(await tid(page, "basic-pad").count())) {
    await tid(page, "pad-menu").click({ timeout: 2500 }).catch(() => {});
    await tid(page, "pad-basic-scoring").click({ timeout: 2500 }).catch(() => {});
  }
  await page.waitForTimeout(600);
  return opened && (await tid(page, "basic-pad").count()) > 0;
}
async function openMatch(page, id) {
  await go(page, "matches");
  const btn = tid(page, `mc-open-${id}`);
  await btn.first().waitFor({ timeout: 10000 }).catch(() => {});
  if (!(await btn.count())) return false;
  await btn.first().click({ timeout: 5000 });
  await tid(page, "match-view").waitFor({ timeout: 10000 }).catch(() => {});
  await afterReads(page, 1800);
  return (await tid(page, "match-view").count()) === 1;
}
async function mcTab(page, id) {
  await tid(page, `mc-tab-${id}`).click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
}

/** The page's full height: the shell scrolls its main, so grow the viewport to whatever scrolls (cri02's snap). */
async function snap(page, name, width) {
  const need = await page.evaluate(() => {
    let extra = 0;
    for (const el of [document.documentElement, ...document.querySelectorAll("*")]) {
      const cs = getComputedStyle(el);
      if (el !== document.documentElement && !/(auto|scroll)/.test(cs.overflowY)) continue;
      if (el.scrollHeight > el.clientHeight + 1) extra = Math.max(extra, el.scrollHeight - el.clientHeight);
    }
    return extra;
  });
  const vh = page.viewportSize().height;
  const height = Math.min(MAX_H, vh + need);
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(500);
  const doc = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  const cut = Math.max(height, doc) > MAX_H;
  const opts = { fullPage: true, ...(cut ? { clip: { x: 0, y: 0, width, height: MAX_H } } : {}) };
  let buf = await page.screenshot({ ...opts, type: "png" });
  let file = `${name}.png`;
  if (buf.length > BIG) { buf = await page.screenshot({ ...opts, type: "jpeg", quality: 70 }); file = `${name}.jpg`; }
  await writeFile(join(OUT, file), buf);
  await page.setViewportSize({ width, height: vh });
  await page.waitForTimeout(300);
  return { file, bytes: buf.length, cut, pageHeight: Math.max(height, doc) };
}

const rows = [];       // one per shot
const missed = [];     // screens not reached
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const KINDS = ["sideways", "offscreen", "clipped", "overlap", "small", "tiny", "weak"];

/**
 * Measure, then shoot. `meta` carries the persona, the screen's name and the route.
 * What loaded is the first words of what the screen says, so a reader can see it was not empty or an error.
 */
async function take(page, meta, width, theme) {
  await loaded(page);
  await afterReads(page, 500);
  let audit = null, said = "";
  try {
    audit = await narrowAudit(page, {});
    said = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="os-main"]') || document.querySelector("main") || document.body;
      return (root.innerText || "").replace(/\s+/g, " ").trim().slice(0, 110);
    });
  } catch { /* the audit is a bonus */ }
  const s = await snap(page, `${slug(meta.persona)}-${slug(meta.screen)}-${width}-${theme.toLowerCase()}`, width);
  const counts = audit ? KINDS.map((k) => `${k} ${audit[k].length}`).join(", ") : "not measured";
  const first = audit ? ["sideways", "offscreen", "small"].flatMap((k) => audit[k].slice(0, 1).map((x) => `${k}: ${x}`)).join("; ") : "";
  rows.push({ ...meta, width, theme, file: s.file, bytes: s.bytes, cut: s.cut, pageHeight: s.pageHeight, said, counts, first });
  console.log(`${meta.persona.padEnd(14)} ${meta.screen.padEnd(24)} ${`${width} ${theme}`.padEnd(14)} ${s.file}  ${(s.bytes / 1024).toFixed(0)} KB`);
}
const miss = (persona, screen, width, theme, why) => { missed.push({ persona, screen, width, theme, why }); console.log(`!! ${persona} ${screen} ${width} ${theme}: ${why}`); };
const want = (k) => !ONLY || ONLY.includes(k);

// ── Personas ──
/** destinations: nav keys, in the order shot; `why` is written to NOTES. */
const PERSONAS = [
  { key: "director", persona: "Director of sport", email: "sarah@example.invalid",
    dest: ["matches", "squad", "analytics"],
    why: "Matches is the fixture list and the Match Centre, the thing a director opens first on match day; Squad is the people in his sides; Analytics is how the sides are playing. (Sarah is also a coach and a parent, so her menu is the staff menu with Family beside it.)" },
  { key: "office", persona: "School office", email: "registrar@example.invalid",
    dest: ["management", "staff", "squad"],
    why: "The office (schooladmin; the seed holds no sportsadmin) admits people and answers role requests: Management is where requests and role changes are decided, Staff is the register of who holds what, Squad is the pupils on the roll." },
  { key: "coach", persona: "Coach", email: "coach@example.invalid",
    dest: ["squad", "matches", "skills"],
    why: "A coach picks and reads his side (Squad), reads his fixtures (Matches) and records what a boy can do (Skills, the Develop group)." },
  { key: "manager", persona: "Team manager", email: "manager@example.invalid",
    dest: ["readiness", "logistics", "squad"],
    why: "A team manager runs the day around a fixture: Readiness is who and what is ready, Logistics is transport and kit, Squad is who is turning up." },
  { key: "scorer", persona: "Scorer", email: "scorer@example.invalid", scorer: true,
    dest: ["matches", "readiness", "calendar"],
    why: "Matches is where a scorer opens the pad; Readiness is the day's duties; Calendar is the fixtures coming up for him." },
  { key: "parent", persona: "Parent", email: "parent@example.invalid", parent: true,
    dest: ["fixtures", "notices", "family"],
    why: "The parent's bar is Home (the child), Matches, Notices, Family; Home is the first shot and the other three are the destinations." },
  { key: "pupil", persona: "Pupil", email: "pillay@example.invalid",
    dest: ["mymatches", "passport", "me"],
    why: "The pupil's bar is Home, Matches, Passport, Me; Home is the first shot and the other three are the destinations." },
  { key: "watcher", persona: "Spectator, signed in", email: "watcher@example.invalid", watcher: true,
    dest: ["matches", "calendar", "competitions"],
    why: "A spectator account (watcher@, role spectator) is offered Matches, Calendar and Competitions from Play; those are what he can read." },
  { key: "platform", persona: "Platform admin", email: "platform@example.invalid",
    dest: ["management", "modules", "staff"],
    why: "The platform administrator's menu is short: Management (roles), Modules (features on and off, per school), Staff (people)." },
];

async function runPersona(P, width, scheme, theme, fx) {
  const { ctx, page } = await open({ width, scheme });
  const route = (k) => `/app > ${k}`;
  try {
    if (!(await signIn(page, P.email))) { miss(P.persona, "home", width, theme, `dev sign-in did not reach the shell (${P.email})`); return; }
    await take(page, { persona: P.persona, screen: "home", route: "/app (after sign-in)" }, width, theme);

    // The menu open: a phone's drawer behind More. The persona bars (parent, pupil) have no More: the bar is the menu.
    if (width < 768) {
      if (await openDrawer(page)) { await take(page, { persona: P.persona, screen: "menu", route: "/app > More (drawer)" }, width, theme); await closeDrawer(page); }
      else if (P.parent || P.key === "pupil") await take(page, { persona: P.persona, screen: "menu", route: "/app (the four-item bar is the whole menu; Settings, Raise a concern and sign-out sit behind the name at the top)" }, width, theme);
      else miss(P.persona, "menu", width, theme, "no More button found");
    } else if (!rows.some((r) => r.persona === P.persona && r.screen === "menu")) {
      rows.push({ persona: P.persona, screen: "menu", route: "(side navigation)", width, theme, file: "(not shot)", bytes: 0, said: "On a desktop the menu is the side navigation, always open, so it is in the Home shot.", counts: "", first: "" });
    }

    for (const k of P.dest) {
      if (!(await go(page, k))) { miss(P.persona, k, width, theme, `no "${k}" in this persona's menu at this width`); continue; }
      await take(page, { persona: P.persona, screen: k, route: route(k) }, width, theme);
      if (P.parent && k === "family") {
        // The terms are a row on the child's card on the Family screen (GA-I20 A2); the link rows sit on the same screen.
        const row = page.locator('[data-testid^="family-open-terms-"]').first();
        if (await row.count()) {
          await row.click({ timeout: 4000 }).catch(() => {});
          await afterReads(page, 900);
          if (await tid(page, "family-terms-text").count()) await take(page, { persona: P.persona, screen: "terms", route: "/app > Family > the child's card > the school's terms" }, width, theme);
          else miss(P.persona, "terms", width, theme, "the terms row opened no terms panel");
        } else miss(P.persona, "terms", width, theme, "no terms row (family-open-terms-*) on the Family screen");
      }
    }

    if (P.watcher) {
      if (await openMatch(page, fx.live)) {
        await mcTab(page, "summary");
        await take(page, { persona: P.persona, screen: "match-summary", route: "/app > Matches > live fixture > Summary" }, width, theme);
        await mcTab(page, "scorecard");
        await take(page, { persona: P.persona, screen: "match-scorecard", route: "/app > Matches > live fixture > Scorecard" }, width, theme);
        const bs = tid(page, "mc-bigscreen-open");
        if (await bs.count()) {
          await bs.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(2500);
          if (await tid(page, "mc-bigscreen").count()) await take(page, { persona: P.persona, screen: "match-bigscreen", route: "/app > Matches > live fixture > Big screen" }, width, theme);
          else miss(P.persona, "match-bigscreen", width, theme, "the Big screen button opened nothing");
        } else miss(P.persona, "match-bigscreen", width, theme, "no Big screen button on the watcher's match header");
      } else miss(P.persona, "match-summary / scorecard / big screen", width, theme, "the live fixture did not open from the watcher's Matches list");
    }

    if (P.scorer) {
      await q(`delete from scoring_session where match_id = $1`, [fx.live]).catch(() => {});
      await go(page, "dashboard");
      const padOk = await openPad(page);
      if (padOk) await take(page, { persona: P.persona, screen: "pad-live-fixture", route: "/app > Matches > Start Scoring (Hilton 1XI v Westville, live)" }, width, theme);
      else miss(P.persona, "pad-live-fixture", width, theme, "the pad did not open from the list");
      await q(`delete from scoring_session where match_id = $1`, [fx.live]).catch(() => {});
    }
  } catch (e) { miss(P.persona, "(rest of the persona)", width, theme, e.message.slice(0, 160)); } finally { await ctx.close(); }
}

/** The scorer starts a Pilot Match, up to the first ball (R0: the switches on, the scorer granted; as smoke-browser-scorer-home G). */
async function runPilot(width, scheme, theme) {
  const persona = "Scorer";
  const { ctx, page: g } = await open({ width, scheme });
  const t = (id) => tid(g, id);
  const tap = async (id, ms = 350) => { await t(id).first().click({ timeout: 6000 }); await g.waitForTimeout(ms); };
  const click = async (re, ms = 4000) => { const l = g.locator("button:not([disabled])", { hasText: re }).first(); if (!(await l.count())) return false; try { await l.click({ timeout: ms }); } catch { return false; } await g.waitForTimeout(300); return true; };
  try {
    if (!(await signIn(g, "scorer@example.invalid"))) return miss(persona, "pilot-start", width, theme, "sign-in did not reach the shell");
    await go(g, "dashboard");
    await t("scorer-home").waitFor({ timeout: 8000 }).catch(() => {});
    await afterReads(g, 1200);
    if (!(await t("scorer-start-pilot").count())) return miss(persona, "pilot-start", width, theme, "no Start Pilot Match button on the scorer's home (switch or grant not in effect)");
    await take(g, { persona, screen: "scorer-home-pilot", route: "/app (scorer's home, Pilot Matches on)" }, width, theme);
    await tap("scorer-start-pilot", 1200);
    await t("pilot-choice").waitFor({ timeout: 8000 }).catch(() => {});
    await take(g, { persona, screen: "pilot-1-setup", route: "/app > Start Pilot Match > setup" }, width, theme);
    await tap("practice-overs-custom"); await t("practice-overs-input").fill("1"); await t("practice-venue").fill("Example Oval");
    await tap("practice-next");
    await take(g, { persona, screen: "pilot-2-schools", route: "/app > Start Pilot Match > schools" }, width, theme);
    await t("practice-school-0").fill("Hilton"); await t("practice-division-0").selectOption("U13"); await tap("practice-class-0-B");
    await t("practice-school-1").fill("Kearsney"); await t("practice-division-1").selectOption("U13"); await tap("practice-class-1-B");
    await tap("practice-next");
    const HOME = ["Golf One", "Golf Two", "Golf Three"], AWAY = ["Hotel One", "Hotel Two", "Hotel Three"];
    await t("practice-paste-0").fill(HOME.join("\n")); await tap("practice-add-0");
    await take(g, { persona, screen: "pilot-3-players", route: "/app > Start Pilot Match > home players" }, width, theme);
    await tap("practice-next");
    await t("practice-paste-1").fill(AWAY.join("\n")); await tap("practice-add-1"); await tap("practice-next");
    await g.locator("button[role=radio]", { hasText: "Hilton U13B" }).first().click({ timeout: 4000 });
    await g.locator("button[role=radio]", { hasText: /^Bat$/ }).click({ timeout: 4000 });
    await take(g, { persona, screen: "pilot-4-toss", route: "/app > Start Pilot Match > toss" }, width, theme);
    await click(/Confirm Toss/);
    await g.locator("button", { hasText: HOME[0] }).first().click({ timeout: 3000 });
    await g.locator("button", { hasText: HOME[1] }).first().click({ timeout: 3000 });
    await take(g, { persona, screen: "pilot-5-openers", route: "/app > Start Pilot Match > openers" }, width, theme);
    await click(/Select Opening Bowler/);
    await g.locator("button", { hasText: AWAY[0] }).first().click({ timeout: 3000 });
    await click(/Start Match/);
    await g.waitForTimeout(1500);
    if (!(await t("basic-pad").count())) { await t("pad-menu").click({ timeout: 2500 }).catch(() => {}); await t("pad-basic-scoring").click({ timeout: 2500 }).catch(() => {}); await g.waitForTimeout(600); }
    await take(g, { persona, screen: "pilot-6-pad-first-ball", route: "/app > Start Pilot Match > the pad, before the first ball" }, width, theme);
  } catch (e) { miss(persona, "pilot (rest)", width, theme, e.message.slice(0, 160)); } finally { await ctx.close(); }
}

/** A person who has never signed in: the public pages. */
async function runPublic(width, scheme, theme, fx) {
  const persona = "Spectator, signed out";
  const { ctx, page } = await open({ width, scheme });
  const shot = async (screen, path) => {
    try {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1800);
      await take(page, { persona, screen, route: `${path} (HTTP ${res?.status()})` }, width, theme);
    } catch (e) { miss(persona, screen, width, theme, e.message.slice(0, 160)); }
  };
  try {
    await shot("public-home", "/");
    await shot("live-match-summary", `/live/${fx.live}`);
    await shot("live-match-scorecard", `/scorecard/${fx.live}`);
    await shot("big-screen-display", `/display/${fx.live}`);
  } finally { await ctx.close(); }
}

/** First run: the sign-in screen, the no-school state, the onboarding flow. */
async function runFirstRun(width, scheme, theme) {
  const persona = "New account";
  // 1. the sign-in screen (the Google button is drawn: this is the walks' build, with a test web config).
  {
    const { ctx, page } = await open({ width, scheme });
    try {
      await toApp(page);
      await take(page, { persona, screen: "landing-or-login", route: "/app (signed out, first load)" }, width, theme);
      await toLogin(page);
      await take(page, { persona, screen: "signin", route: "/app > Log In" }, width, theme);
    } catch (e) { miss(persona, "signin", width, theme, e.message.slice(0, 160)); } finally { await ctx.close(); }
  }
  // 2. A new Google account: the no-school state, then choosing a school and a kind.
  {
    const h = await open({ width, scheme });
    const { ctx, page } = h;
    try {
      await toApp(page); await toLogin(page);
      h.token = idToken(`xp-new-${RUN}-${width}-${theme}`, `newcomer.${RUN}.${width}.${theme.toLowerCase()}@example.invalid`);
      await tid(page, "google-button").click({ timeout: 5000 });
      await page.waitForSelector('[data-testid="pending-requests"]', { timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="join-school"]', { timeout: 5000 }).catch(() => {});
      await afterReads(page, 1000);
      if (await tid(page, "no-school-title").count()) {
        await take(page, { persona, screen: "no-school", route: "/app > Continue with Google (new account, no school)" }, width, theme);
        const sch = page.locator('[data-testid^="join-school-"]').first();
        if (await sch.count()) {
          await sch.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(500);
          await take(page, { persona, screen: "no-school-school-chosen", route: "/app > no-school > a school chosen (the kinds)" }, width, theme);
          await tid(page, "join-kind-parent").click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500);
          await take(page, { persona, screen: "no-school-parent-form", route: "/app > no-school > parent (the child as free text)" }, width, theme);
        } else miss(persona, "no-school (school chosen / parent form)", width, theme, "no school offered to choose");
      } else miss(persona, "no-school", width, theme, "the new Google account did not land on the no-school screen");
    } catch (e) { miss(persona, "no-school", width, theme, e.message.slice(0, 160)); } finally { await ctx.close(); }
  }
  // 3. The onboarding flow, step by step (Log In > Create an account).
  {
    const { ctx, page } = await open({ width, scheme });
    try {
      await toApp(page); await toLogin(page);
      const create = page.locator("button, a", { hasText: /Create an account/ }).first();
      if (!(await create.count())) return miss(persona, "onboarding", width, theme, "no Create an account link on the sign-in screen");
      await create.click({ timeout: 4000 }); await page.waitForTimeout(800);
      let n = 1;
      const heading = async () => ((await page.locator("h1:visible, h2:visible").first().innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      const seen = new Set();
      const nextBtn = (re) => page.locator("button:not([disabled])", { hasText: re }).first();
      for (let i = 0; i < 9; i++) {
        const h = await heading();
        if (seen.has(h) && i > 0) break;
        seen.add(h);
        await take(page, { persona, screen: `onboard-${n++}-${slug(h).slice(0, 24) || "step"}`, route: `/app > Create an account > step ${i + 1} ("${h.slice(0, 40)}")` }, width, theme);
        // act on the step: a role or a school chosen advances by itself; a form is filled; else Continue
        if (/role/i.test(h)) { await page.locator("button", { hasText: /Parent \/ Guardian/ }).first().click({ timeout: 3000 }).catch(() => {}); }
        else if (/school/i.test(h)) { await page.locator("button", { hasText: /Hilton/ }).first().click({ timeout: 3000 }).catch(() => {}); }
        else {
          const inputs = page.locator("input:visible");
          for (let k = 0; k < await inputs.count(); k++) {
            const type = await inputs.nth(k).getAttribute("type");
            const hint = ((await inputs.nth(k).getAttribute("placeholder")) || "") + ((await inputs.nth(k).getAttribute("aria-label")) || "") + ((await inputs.nth(k).getAttribute("id")) || "");
            if (type === "email" || /email/i.test(hint)) await inputs.nth(k).fill("newcomer.example@example.invalid").catch(() => {});
            else if (!type || type === "text") await inputs.nth(k).fill(/child|player|link/i.test(hint) ? "Example Child" : "Newcomer Example").catch(() => {});
          }
          await page.waitForTimeout(300);
          const b = nextBtn(/Continue|Next|Get Started|Let.s go|Skip/i);
          if (await b.count()) await b.click({ timeout: 3000 }).catch(() => {});
          else break;   // the last step: nothing more is pressed (no request is sent)
        }
        await page.waitForTimeout(1100);
      }
    } catch (e) { miss(persona, "onboarding (rest)", width, theme, e.message.slice(0, 160)); } finally { await ctx.close(); }
  }
}

// ── NOTES.md ──
function notes() {
  const md = [];
  const total = rows.filter((r) => r.bytes).reduce((n, r) => n + r.bytes, 0);
  md.push("# Experience screens: what each person sees", "");
  md.push("Evidence for a design pass on the whole product. Produced by `tools/shots-experience.mjs`; no app code changed.", "");
  md.push(`- Widths: ${WIDTHS.join(", ")} (390 drawn as a touch phone, 1366 as a desktop). Themes: Daylight (colour scheme light), Floodlit (dark).`);
  md.push("- Data: the seed plus tools/fixture-matchcentre.mjs's live fixture (Hilton College 1XI v Westville Boys' High 1XI). Invented names only (@example.invalid). People sign in by dev login, as the walks do. The seed holds no team manager, so the tool adds `manager@example.invalid` (teammanager, Hilton 1XI) to its own database; it holds no `sportsadmin`, so the school office (`registrar@`, schooladmin) stands for it.");
  md.push("- Pilot Matches: the tool turns the `pilot_sync` switch on and grants the seeded scorer in its own database, as smoke-browser-scorer-home does, so the scorer can start one.");
  md.push("- Audit: `narrowAudit` (tools/a11y-narrow.mjs), the narrow walk's own measurement, in the page: counts of sideways scroll, off-screen, clipped, overlap, text under 12px (small), taps under 44px (tiny), contrast below WCAG (weak). The 44px tap floor is a phone floor; read `tiny` at 1366 as secondary. Shell findings (sidebar, bottom bar) are counted in every row.");
  md.push(`- Pictures: PNG, or JPEG at quality 70 where the PNG ran over about 300 KB; a page taller than ${MAX_H}px is cut at ${MAX_H}px. The shell scrolls its main, so the viewport is grown to the content's height first; on a phone the fixed bottom bar is drawn at the foot of the picture, over the last content.`);
  md.push(`- ${rows.filter((r) => r.bytes).length} pictures, ${(total / 1024 / 1024).toFixed(1)} MB.`, "");
  md.push("## Destinations picked, and why", "");
  for (const P of PERSONAS) md.push(`- **${P.persona}** (${P.email}): ${P.dest.join(", ")}. ${P.why}`);
  md.push("- **Spectator, signed out**: the public home page, the live match (Summary), its Scorecard and the pavilion display (`/display/:id`, the big screen). The signed-in spectator also has the Match Centre's Summary, Scorecard and Big screen.");
  md.push("- **Scorer, beyond the menu**: the pad on the live fixture, and a Pilot Match from the scorer's home up to the pad before the first ball (setup, schools, players, toss, openers, pad).");
  md.push("- **Parent, beyond the menu**: the child's terms (Home, the child, Read and agree). Linking a child is the family screen's links (shot) and, for an account with no school, the first-run request forms (`New account`).");
  md.push("- **New account**: the sign-in screen, the no-school state (a new Google account), and the onboarding flow (Log In, Create an account) step by step.", "");
  md.push("## Shots", "");
  md.push("| Persona | Screen | Route | Width | Theme | File | KB | What loaded | Narrow audit |");
  md.push("|---|---|---|---|---|---|---|---|---|");
  const esc = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
  for (const r of rows) md.push(`| ${r.persona} | ${r.screen} | ${esc(r.route)} | ${r.width} | ${r.theme} | ${r.file}${r.cut ? ` (cut at ${MAX_H} of ${r.pageHeight})` : ""} | ${(r.bytes / 1024).toFixed(0)} | ${esc(r.said)} | ${esc(r.counts)}${r.first ? `. First: ${esc(r.first).slice(0, 160)}` : ""} |`);
  md.push("", "## Not reached", "");
  if (!missed.length) md.push("Everything asked for was reached.");
  else { md.push("| Persona | Screen | Width | Theme | Why |", "|---|---|---|---|---|"); for (const m of missed) md.push(`| ${m.persona} | ${m.screen} | ${m.width} | ${m.theme} | ${esc(m.why)} |`); }
  return md.join("\n") + "\n";
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  // The seed holds no team manager: add one, to this database only.
  await q(`insert into app_user (id, school_id, email, name, role, teams) values ('88888888-0000-0000-0000-0000000000f9', $1, 'manager@example.invalid', 'T Manager', 'teammanager', '{1XI}') on conflict do nothing`, [HIL]);
  await q(`insert into role_assignment (person_id, role, school_id, team_code) select '88888888-0000-0000-0000-0000000000f9', 'teammanager', $1, '1XI'
           where not exists (select 1 from role_assignment where person_id = '88888888-0000-0000-0000-0000000000f9')`, [HIL]);
  // Pilot Matches on, the scorer granted (as smoke-browser-scorer-home G).
  if (want("pilot")) {
    const c = await pool.connect();
    try {
      await c.query(`begin; create function public.pilot_purge_expired() returns void language sql as ''; update pilot.switch set enabled = true where key = 'pilot_sync'; drop function public.pilot_purge_expired(); commit;`);
    } catch (e) { await c.query("rollback").catch(() => {}); console.log("!! pilot switch:", e.message.slice(0, 120)); } finally { c.release(); }
    await q(`insert into pilot.scorer (user_id) select id from app_user where email = 'scorer@example.invalid' on conflict (user_id) do update set ended_at = null`).catch((e) => console.log("!! pilot scorer:", e.message.slice(0, 120)));
  }
  const fx = await buildMatchCentreFixture(q);
  // The public pages answer only for a fixture its school has published and listed: Sarah, the director of sport,
  // does it through the app's own functions, as the school would (smoke-browser-public-live).
  try {
    const sarah = (await q(`select id from app_user where email = 'sarah@example.invalid'`))[0].id;
    const app = new pg.Pool({ connectionString: appUrl() });
    const as = async (text, params) => { const c = await app.connect(); try { await c.query("BEGIN"); await c.query("select set_config('app.user_id', $1, true), set_config('app.device_id', 'shots-experience', true)", [sarah]); await c.query(text, params); await c.query("COMMIT"); } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); } };
    await as(`select * from fixture_publish($1, 'home', true)`, [fx.live]);
    await as(`select * from public_listing_set($1, true)`, [HIL]);
    await app.end();
  } catch (e) { console.log("!! could not publish the live fixture:", e.message.slice(0, 160)); }

  for (const [scheme, theme] of THEMES) {
    for (const width of WIDTHS) {
      if (want("firstrun")) await runFirstRun(width, scheme, theme);
      if (want("public")) await runPublic(width, scheme, theme, fx);
      for (const P of PERSONAS) if (want(P.key)) await runPersona(P, width, scheme, theme, fx);
      if (want("pilot")) await runPilot(width, scheme, theme);
    }
  }
  await writeFile(join(OUT, "NOTES.md"), notes());
  const total = rows.reduce((n, r) => n + r.bytes, 0);
  console.log(`\n${rows.filter((r) => r.bytes).length} pictures, ${(total / 1024 / 1024).toFixed(2)} MB, ${missed.length} not reached, notes in ${OUT}/NOTES.md`);
  if (apiErr.join("").trim()) console.log("API stderr:", apiErr.join("").slice(0, 300));
} finally {
  await browser.close();
  api.kill();
  await pool.end();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

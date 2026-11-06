#!/usr/bin/env node
/**
 * Every role, every page: no panel may fall over.
 *
 * ui/ErrorBoundary.jsx turns a render error into a card in the panel's place
 * ("The Squad panel couldn't be shown.") and logs `[panel] <name> could not be
 * shown: <message>`. That keeps the shell standing, which is its job, but a
 * card where the data should be is still a broken screen, and the demo of
 * 6 Nov 2026 had them across the app once a played season was pasted in. This
 * walk signs in as each account, opens every destination its navigation
 * offers, the sections and tabs on each, the Match Centre's every tab on a
 * completed, a live and an upcoming fixture, and the public pages signed out,
 * and records every boundary that caught, every uncaught page error and every
 * `panel-error` card on screen, with who, where and which tab.
 *
 * It asserts nothing about content. It is a crash sweep: the run fails when
 * any crash is found, and prints them (and writes them, with
 * PANEL_SWEEP_OUT=<file.md>).
 *
 * Accounts: PANEL_SWEEP_ACCOUNTS (comma-separated emails), else the demo
 * cast where the database holds it, else every account the database holds
 * except the 300-odd numbered parents. Fixtures: PANEL_SWEEP_MATCHES
 * (comma-separated ids), else the most-scored complete match, the live one and
 * the soonest scheduled one, at the school PANEL_SWEEP_SCHOOL names (a regex
 * on its name) where given.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-panel-sweep.mjs
 *   PANEL_SWEEP_PHONE=0   desktop only (default: the persona accounts at phone width too)
 *   PANEL_SWEEP_PHONE=all every account at phone width too
 *   PANEL_SWEEP_DESKTOP=0 phone width only
 *   PANEL_SWEEP_DEBUG=1   print each stop as it is visited
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const PORT = port(8871);
const BASE = `http://127.0.0.1:${PORT}`;
const DEBUG = !!process.env.PANEL_SWEEP_DEBUG;
const PHONE = process.env.PANEL_SWEEP_PHONE !== "0";
const PHONE_ALL = process.env.PANEL_SWEEP_PHONE === "all";
const DESKTOP = process.env.PANEL_SWEEP_DESKTOP !== "0";

const DEMO_CAST = [
  "coach.wes.1xi", "coach.wes.u14a", "coach.kea.1xi", "scorer1.wes", "dos.wes", "dos.kea",
  "registrar.wes", "principal.wes", "dso.wes", "manager.wes.u14a",
  "parent.001", "parent.106", "parent.061", "pupil.wes.1xi", "pupil.wes.u16b",
  "league", "driver.wes", "medical.wes", "bursar", "official.wes", "transport.wes", "office.kea",
  "spectator", "watcher", "analyst", "platform", "owner",
].map((e) => (e.includes("@") ? e : `${e}@example.invalid`));

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", SESSION_SECRET: "panel-sweep-secret",
         ALLOW_DEV_LOGIN: "1", PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "panel-sweep-pseudonyms-0123456789abcdef",
         PUBLIC_TRUST_PROXY_HOPS: "1", SERVE_CLIENT: process.env.PANEL_SWEEP_CLIENT || "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = /** @type {string[]} */ ([]);
api.stderr.on("data", (d) => apiErr.push(d.toString()));
api.stdout.on("data", (d) => { if (DEBUG) process.stdout.write(d); });

const owner = new pg.Pool({ connectionString: ownerUrl() });
const q = async (/** @type {string} */ t, /** @type {any[]} */ p = []) => (await owner.query(t, p)).rows;

/** @typedef {{who: string, width: string, url: string, page: string, sub: string, kind: string, panel: string, message: string}} Crash */
/** @type {Crash[]} */
const crashes = [];
/** @type {{who: string, url: string, status: number, path: string}[]} */
const apiFailures = [];
let stops = 0;

const browser = await chromium.launch({ ...launchOptions() });

/**
 * A fresh context per person and width. `here` is where the walk is, read by
 * the listeners when a console line arrives.
 * @param {string} who  @param {"desktop" | "phone"} width
 */
async function open(who, width) {
  // A school's own browser: the SA clock and the SA locale (dates written
  // 2026/11/06), not the container's UTC and en-US, which hid date faults.
  const ctx = await browser.newContext({ viewport: width === "phone" ? { width: 390, height: 844 } : { width: 1366, height: 900 },
    timezoneId: process.env.PANEL_SWEEP_TZ || "Africa/Johannesburg", locale: process.env.PANEL_SWEEP_LOCALE || "en-ZA" });
  await offline(ctx);
  const page = await ctx.newPage();
  // The built bundle's API base, as every browser walk points it (lib/api.js).
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)};`);
  watchReads(page);
  const here = { page: "", sub: "" };
  const record = (/** @type {string} */ kind, /** @type {string} */ panel, /** @type {string} */ message) =>
    crashes.push({ who, width, url: page.url().replace(BASE, ""), page: here.page, sub: here.sub, kind, panel, message });
  page.on("console", (m) => {
    const t = m.text();
    const p = /\[panel\] (.+?) could not be shown: (.*)$/s.exec(t);
    if (p) record("boundary", p[1], p[2]);
  });
  page.on("pageerror", (e) => record("pageerror", "-", String(e.message).slice(0, 300)));
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && u.includes("/api/") && !u.includes("/api/auth/")) {
      apiFailures.push({ who, url: page.url().replace(BASE, ""), status: r.status(), path: u.replace(BASE, "").split("?")[0] });
    }
  });
  return { ctx, page, here };
}

const tid = (/** @type {any} */ page, /** @type {string} */ id) => page.locator(`[data-testid="${id}"]`);

/** The cards on screen now that are not yet recorded at this stop. */
async function scan(/** @type {any} */ s, /** @type {string} */ who, /** @type {string} */ width) {
  stops++;
  const cards = await s.page.$$eval('[data-testid="panel-error"]', (els) => els.map((e) => e.getAttribute("data-panel") ?? "(unnamed)")).catch(() => []);
  for (const panel of cards) {
    const dupe = crashes.some((c) => c.who === who && c.width === width && c.page === s.here.page && c.sub === s.here.sub && c.kind === "card" && c.panel === panel);
    if (!dupe) crashes.push({ who, width, url: s.page.url().replace(BASE, ""), page: s.here.page, sub: s.here.sub, kind: "card", panel, message: "" });
  }
  if (DEBUG) console.log(`    · ${who} ${width} ${s.here.page} ${s.here.sub}${cards.length ? "  ✗ " + cards.join(", ") : ""}`);
}

async function signIn(/** @type {any} */ page, /** @type {string} */ email) {
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  const start = page.locator("button:not([disabled])", { hasText: /Get Started|Log In/ }).first();
  if (await start.count()) await start.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.locator("#login-email").fill(email, { timeout: 5000 }).catch(() => {});
  await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 5000 }).catch(() => {});
  await afterReads(page, 2000);
  return (await tid(page, "os-main").count()) === 1;
}

const NAV_SEL = '[data-testid^="nav-"]:not([data-testid^="nav-group-"]):not([data-testid$="-badge"])';
const shownPage = (/** @type {any} */ page) => tid(page, "os-main").getAttribute("data-page", { timeout: 3000 }).catch(() => null);

/** Opens a destination at either width: the rail, the bar, or the bar's More drawer. */
async function goTo(/** @type {any} */ page, /** @type {string} */ key, /** @type {string} */ width) {
  if (width === "desktop") {
    await tid(page, `nav-${key}`).click({ timeout: 6000 }).catch(() => {});
  } else if (await tid(page, `mnav-${key}`).count()) {
    await tid(page, `mnav-${key}`).click({ timeout: 6000 }).catch(() => {});
  } else {
    await tid(page, "mnav-more").click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    await tid(page, `drawer-${key}`).click({ timeout: 4000 }).catch(() => {});
  }
  await afterReads(page, 900);
  return (await shownPage(page)) === key;
}

// What a sweep must never press: a write, a takeover, a way out.
const SKIP = /save|submit|delete|retire|revoke|withdraw|publish|send|sign out|log out|remove|cancel|approve|reject|start|scor|declare|record|add |new |confirm|agree|accept|decline|dispute|finish|finalise|lift|pause|resume|undo|reset|clear|mark|claim|link|unlink|request|invite|raise|report|close|end |sign|\+/i;
const SKIP_ID = /^(availability-set|sidebar-|mnav-|nav-|drawer-|topbar-|role-option|persona-|panel-error|skip-link|demo-banner)/;

/**
 * The controls on this screen that change what it shows without writing:
 * a home's sections, tabs, a child's chip, a panel that opens; then the
 * first, middle and last of its other buttons, as the read walk pokes them.
 */
async function controls(/** @type {any} */ page) {
  return page.$$eval('[data-testid="os-main"] button:not([disabled]), [data-testid="os-main"] [role="tab"]', (els, [skip, skipId]) => {
    const SK = new RegExp(skip, "i"), SKI = new RegExp(skipId);
    const out = [];
    els.forEach((e, i) => {
      const id = e.getAttribute("data-testid") ?? "";
      const t = (e.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (SKI.test(id) || id.startsWith("mc-tab-") || id === "mc-more") return;
      // An opener is named for what it does, whatever its words say ("The
      // school's terms: agreed" opens the terms; it agrees to nothing).
      const opener = /(^|-)open(-|$)/.test(id);
      if (!opener && (SK.test(t) || SK.test(e.getAttribute("aria-label") ?? ""))) return;
      const kind = opener ? "open"
        : /-section-/.test(id) ? "section"
        : e.getAttribute("role") === "tab" ? "tab"
        : /^child-chip-/.test(id) ? "child"
        : e.hasAttribute("aria-expanded") ? "expand"
        : e.hasAttribute("aria-pressed") ? "toggle" : "button";
      out.push({ i, id, t, kind });
    });
    return out;
  }, [SKIP.source, SKIP_ID.source]);
}

/** Every section, tab, chip and opener on a screen, and a few of its records. */
async function sweepScreen(/** @type {any} */ s, /** @type {string} */ key, /** @type {string} */ who, /** @type {string} */ width) {
  const found = await controls(s.page);
  const strong = found.filter((c) => c.kind !== "button").slice(0, 30);
  const rest = found.filter((c) => c.kind === "button" && c.t.length >= 4);
  const picks = [...new Set([0, Math.floor(rest.length / 2), rest.length - 1])].filter((i) => i >= 0 && i < rest.length).map((i) => rest[i]);
  for (const c of [...strong, ...picks]) {
    // Found by its id or its words again: the screen may have redrawn since.
    const loc = c.id
      ? s.page.locator(`[data-testid="os-main"] [data-testid="${c.id}"]`).first()
      : s.page.locator('[data-testid="os-main"] button:not([disabled])', { hasText: c.t }).first();
    if (!(await loc.count().catch(() => 0))) continue;
    s.here.sub = `${c.kind}: ${c.id || c.t}`;
    await loc.click({ timeout: 2500 }).catch(() => {});
    await afterReads(s.page, 500);
    await scan(s, who, width);
    await s.page.keyboard.press("Escape").catch(() => {});
    if (!(await tid(s.page, "os-main").count())) return false;
    // A button that went to another screen: come back, so the next is on this one.
    if ((await shownPage(s.page)) !== key) await goTo(s.page, key, width);
  }
  s.here.sub = "";
  return true;
}

/** The Match Centre's page for one fixture, every tab. */
async function sweepMatch(/** @type {any} */ s, /** @type {{id: string, label: string}} */ m, /** @type {string} */ who, /** @type {string} */ width, /** @type {string} */ home) {
  s.here.page = `matches:${m.label}`;
  s.here.sub = "summary";
  // In the app, not by loading the address: the token is held in memory
  // (lib/api.js), so a reload signs the person out. Off the Match Centre
  // first, so it mounts afresh and reads the address (App.jsx, CRI-1.3).
  if ((await shownPage(s.page)) === "matches") await goTo(s.page, home, width);
  if (m.id.startsWith("list:")) {
    // The first fixture under one of the list's filters: what THIS person's
    // fixtures read holds, which a fixed id may not be (a U14A coach does not
    // hold the 1XI's match, and is rightly left on the list).
    await goTo(s.page, "matches", width);
    await tid(s.page, `mc-filter-${m.id.slice(5)}`).click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 500);
    const first = s.page.locator('[data-testid^="mc-open-"]').first();
    if (!(await first.count())) { s.here.sub = "(none listed)"; return []; }
    s.here.page = `matches:${m.label}:${((await first.getAttribute("data-testid")) ?? "").slice(8)}`;
    await first.click({ timeout: 4000 }).catch(() => {});
  } else {
    await s.page.evaluate((path) => { window.history.pushState(null, "", path); window.dispatchEvent(new PopStateEvent("popstate")); }, `/app/matches/${m.id}`);
  }
  await afterReads(s.page, 2200);
  await scan(s, who, width);
  if (width === "phone" && (await tid(s.page, "mc-more").count())) {
    await tid(s.page, "mc-more").click({ timeout: 3000 }).catch(() => {});
    await s.page.waitForTimeout(300);
  }
  const tabs = await s.page.$$eval('[data-testid^="mc-tab-"]', (els) => [...new Set(els.map((e) => e.getAttribute("data-testid").slice(7)))]).catch(() => []);
  await s.page.keyboard.press("Escape").catch(() => {});
  for (const t of tabs) {
    s.here.sub = t;
    if (!(await tid(s.page, `mc-tab-${t}`).first().isVisible().catch(() => false)) && (await tid(s.page, "mc-more").count())) {
      await tid(s.page, "mc-more").click({ timeout: 3000 }).catch(() => {});
      await s.page.waitForTimeout(300);
    }
    await tid(s.page, `mc-tab-${t}`).first().click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 900);
    await scan(s, who, width);
  }
  return tabs;
}

/** @param {string} who  @param {"desktop" | "phone"} width  @param {{id: string, label: string}[]} matches */
async function sweepAccount(who, width, matches) {
  const s = await open(who, width);
  try {
    s.here.page = "sign-in";
    if (!(await signIn(s.page, who))) { crashes.push({ who, width, url: "/app", page: "sign-in", sub: "", kind: "sign-in", panel: "-", message: "did not reach the app" }); return; }
    // The rail holds every destination; a phone's bar holds only some, so read
    // the list once from the rail's ids at either width (same nav, same keys).
    let keys = await s.page.$$eval(NAV_SEL, (els) => els.map((e) => e.getAttribute("data-testid").slice(4)));
    if (!keys.length) {
      const bar = await s.page.$$eval('[data-testid^="mnav-"]:not([data-testid$="-badge"]):not([data-testid="mnav-more"])', (els) => els.map((e) => e.getAttribute("data-testid").slice(5)));
      await tid(s.page, "mnav-more").click({ timeout: 3000 }).catch(() => {});
      await s.page.waitForTimeout(300);
      const drawer = await s.page.$$eval('[data-testid^="drawer-"]:not([data-testid^="drawer-group-"])', (els) => els.map((e) => e.getAttribute("data-testid").slice(7)));
      await s.page.keyboard.press("Escape").catch(() => {});
      keys = [...new Set([...bar, ...drawer])].filter((k) => !/signout|close|toggle/.test(k));
    }
    s.here.page = await shownPage(s.page) ?? "home";
    await scan(s, who, width);
    for (const k of keys) {
      s.here.page = k; s.here.sub = "";
      const at = await goTo(s.page, k, width);
      await scan(s, who, width);
      if (!at && !(await tid(s.page, "os-main").count())) { crashes.push({ who, width, url: s.page.url(), page: k, sub: "", kind: "shell-gone", panel: "-", message: "the shell is gone" }); break; }
      if (at) await sweepScreen(s, k, who, width);
    }
    const other = keys.find((k) => k !== "matches") ?? "matches";
    const listed = ["live", "upcoming", "complete"].map((f) => ({ id: `list:${f}`, label: `${f} (listed)` }));
    if (keys.includes("matches")) for (const m of [...listed, ...matches]) await sweepMatch(s, m, who, width, other);
  } finally {
    await s.ctx.close();
  }
}

async function sweepPublic(/** @type {{id: string, label: string}[]} */ matches) {
  const who = "(signed out)";
  const s = await open(who, "phone");
  try {
    const paths = ["/", "/privacy"];
    for (const m of matches) paths.push(`/live/${m.id}`, `/scorecard/${m.id}`, ...["commentary", "partnerships", "analytics", "details"].map((t) => `/live/${m.id}/${t}`), `/display/${m.id}`);
    for (const p of paths) {
      s.here.page = p; s.here.sub = "";
      await s.page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await afterReads(s.page, 1500);
      await scan(s, who, "phone");
    }
  } finally {
    await s.ctx.close();
  }
}

let exit = 0;
try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const all = (await q(`select email from app_user where email is not null order by email`)).map((r) => r.email);
  const asked = process.env.PANEL_SWEEP_ACCOUNTS?.split(",").map((e) => e.trim()).filter(Boolean);
  let accounts = asked ?? DEMO_CAST.filter((e) => all.includes(e));
  if (!accounts.length) accounts = all.filter((e) => !/^parent\.\d+@/.test(e));

  const school = process.env.PANEL_SWEEP_SCHOOL ?? "";
  const pick = async (/** @type {string} */ status, /** @type {string} */ order) => (await q(
    `select m.id from match m join school s on s.id = m.school_id
      where m.status = $1 and ($2 = '' or s.name ~* $2)
      order by ${order} limit 1`, [status, school]))[0]?.id;
  /** @type {{id: string, label: string}[]} */
  let matches;
  if (process.env.PANEL_SWEEP_MATCHES) {
    matches = process.env.PANEL_SWEEP_MATCHES.split(",").map((id, i) => ({ id: id.trim(), label: `m${i + 1}` }));
  } else {
    const done = await pick("complete", "(select count(*) from ball_event b where b.match_id = m.id) desc, m.starts_at desc");
    const live = await pick("live", "m.starts_at desc");
    const next = await pick("scheduled", "m.starts_at asc");
    matches = [[done, "complete"], [live, "live"], [next, "upcoming"]].filter(([id]) => id).map(([id, label]) => ({ id, label }));
  }
  console.log(`panel sweep: ${accounts.length} accounts, matches ${matches.map((m) => `${m.label}=${m.id}`).join(" ")}`);

  for (const who of accounts) {
    const before = crashes.length;
    if (DESKTOP) await sweepAccount(who, "desktop", matches);
    const persona = /^(parent|pupil|pillay|sarah)/.test(who);
    if (PHONE && (persona || PHONE_ALL)) await sweepAccount(who, "phone", matches);
    console.log(`  ${crashes.length > before ? "✗" : "✓"} ${who}${crashes.length > before ? ` — ${crashes.length - before} found` : ""}`);
  }
  await sweepPublic(matches);
  console.log(`  ${crashes.some((c) => c.who === "(signed out)") ? "✗" : "✓"} the public pages`);

  // One line per distinct crash: the same panel and message in many places is one fault seen many times.
  /** @type {Map<string, Crash[]>} */
  const byFault = new Map();
  for (const c of crashes) {
    const k = `${c.kind === "card" ? "card" : c.kind}|${c.panel}|${c.message}`;
    if (!byFault.has(k)) byFault.set(k, []);
    byFault.get(k)?.push(c);
  }
  const lines = [`# Panel sweep — ${new Date().toISOString()}`, "",
    `${accounts.length} accounts, ${stops} stops; matches: ${matches.map((m) => `${m.label} ${m.id}`).join(", ")}.`, "",
    `**${crashes.length} records, ${byFault.size} distinct.**`, ""];
  for (const [k, cs] of byFault) {
    const [kind, panel, message] = k.split("|");
    lines.push(`## ${kind} — ${panel}${message ? `: ${message}` : ""}  (${cs.length}×)`);
    for (const c of cs.slice(0, 40)) lines.push(`- ${c.who} [${c.width}] ${c.page}${c.sub ? ` › ${c.sub}` : ""} — ${c.url}`);
    if (cs.length > 40) lines.push(`- … and ${cs.length - 40} more`);
    lines.push("");
  }
  const fails = new Map();
  for (const f of apiFailures) { const k = `${f.status} ${f.path.replace(/[0-9a-f-]{36}/g, ":id")}`; fails.set(k, [...(fails.get(k) ?? []), f.who]); }
  lines.push("## API answers of 400 or more (for diagnosis; not counted)", "");
  for (const [k, ws] of [...fails].sort()) lines.push(`- ${k} — ${[...new Set(ws)].slice(0, 8).join(", ")}${ws.length > 8 ? " …" : ""} (${ws.length}×)`);
  const md = lines.join("\n") + "\n";
  if (process.env.PANEL_SWEEP_OUT) writeFileSync(process.env.PANEL_SWEEP_OUT, md);
  console.log("\n" + (crashes.length ? md : `no crashes in ${stops} stops`));
  exit = crashes.length ? 1 : 0;
} catch (e) {
  console.error(e);
  exit = 1;
} finally {
  await browser.close().catch(() => {});
  await owner.end().catch(() => {});
  api.kill();
  if (exit && apiErr.length && DEBUG) console.log(apiErr.join("").slice(-3000));
}
process.exit(exit);

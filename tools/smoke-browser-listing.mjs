#!/usr/bin/env node
/**
 * The school's listing switch and Fields → Add ground, from a browser
 * (SCRBRD-142 phase 2; PILOT_LOAD gap 4). tools/smoke-listing.mjs-style route
 * proofs are the API's; this drives the two screens and holds the public
 * read to them:
 *
 *   1. THE DIRECTOR OF SPORT. A fixture today, published from its panel: the
 *      panel's line says her school does not list, and the public
 *      GET /api/public/live does not carry it (published is not listed).
 *      Settings → School: the switch, in the words the design allows; she
 *      switches listing on, and the database holds it, the public read carries
 *      the fixture (team facts, no ground), and the panel's line says it will
 *      appear there. Withdrawn, the read drops it and the line says "once you
 *      publish it"; published again, it is back. Switched off, the read drops
 *      it at once and the line says the school does not list.
 *   2. A publisher for one side only may read the setting and not change it:
 *      the switch is there, disabled, with the sentence why.
 *   3. A coach is offered neither the switch nor the line.
 *   4. THE OFFICE adds a ground on Fields, and a pitch on it: both appear in
 *      the list without a reload, the database holds the pitch's parent; the
 *      same name again (any case) is refused in plain words; a name of one
 *      character is not sent. A coach has no Add ground control.
 *   5. Phone width, Daylight: the switch and the form keep the floors (12px
 *      type, 44px controls) and the page is light.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-listing.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(4363);
const API_PORT = port(8898);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const GROUND = "ffffffff-0000-0000-0000-000000000001";   // Gordon Sherwood Oval
const SIDEBOARD = "88888888-0000-0000-0000-0000000000f1";
const DUPLICATE = "A ground with that name already exists at this school.";
const FIELD = "Memorial Oval", PITCH = "Memorial Pitch 1";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "browser-listing-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-listing-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

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

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;
const browser = await chromium.launch({ ...launchOptions() });

async function open({ theme = "floodlit", width = 1280, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};
    try { localStorage.setItem("scrbrd:theme", ${JSON.stringify(theme)}); } catch (e) {}`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return (await tid(page, "os-main").count()) === 1 || (await tid(page, "persona-bar").count()) === 1;
}
async function go(page, nav) {
  // The rail, or at phone width the bottom bar.
  const rail = page.locator(`[data-testid="nav-${nav}"]:visible`).first();
  const bar = (await rail.count()) ? rail : page.locator(`[data-testid="mnav-${nav}"]:visible`).first();
  let l = bar;
  if (!(await bar.count())) {
    // On a phone the rest are in the More drawer.
    try { await page.locator('[data-testid="mnav-more"]').click({ timeout: 4000 }); } catch { return false; }
    await page.waitForTimeout(500);
    l = page.locator(`[data-testid="drawer-${nav}"]`).first();
    if (!(await l.count())) return false;
  }
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1600);
  return true;
}
/** Text under 12px and controls under 44px inside one block, as drawn. */
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA|SUMMARY)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, wide: el.scrollWidth > el.clientWidth + 1, bg: getComputedStyle(document.body).backgroundColor };
  }).catch(() => ({ small: ["(not drawn)"], tiny: [], wide: false, bg: "" }));
}
const kept = (f) => f.small.length === 0 && f.tiny.length === 0 && !f.wide;
const why = (f) => [...f.small, ...f.tiny].slice(0, 4).join(" · ");

let nextIp = 0;
/** The public home page's list as a stranger reads it, signed out. */
const live = async () => {
  const r = await fetch(`${API}/api/public/live`, { headers: { "x-forwarded-for": `10.86.0.${++nextIp & 255}` } });
  const raw = await r.text();
  return { status: r.status, raw, fixtures: r.status === 200 ? (JSON.parse(raw).fixtures ?? []) : [] };
};
/** Wait for the public list to carry (or not carry) the fixture. */
const carries = async (id, want) => {
  for (let i = 0; i < 20; i++) {
    if ((await live()).fixtures.some((f) => f.id === id) === want) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const listed = async () => (await q(`select listed from public_listing where school_id = $1`, [HIL]))[0]?.listed ?? null;
const token = async (email) => (await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, deviceId: "browser-listing" }) })).json()).token;

/** Settings → School. */
async function toSchool(page) {
  return (await go(page, "settings"))
    && await page.locator("#settings-tab-school").click({ timeout: 4000 }).then(() => true, () => false)
    && (await page.waitForTimeout(1500), true);
}
/** Match Centre → the fixture's card, opened. */
async function toPanel(page, id) {
  if (!(await go(page, "matches"))) return false;
  try { await tid(page, `match-card-${id}`).click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1200);
  return (await tid(page, "publish-panel").count()) === 1;
}
const line = async (page) => (await tid(page, "publish-listing").innerText().catch(() => "")).trim();

let today = null;
const made = { grounds: [] };
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`).then((x) => x.json()); if (r?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // A fixture today (the home page lists today's), Hilton at home to Westville. The seed's own are dated otherwise.
  [{ id: today }] = await q(
    `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, ground_id, starts_at, sport, format, overs, status)
     values ($1, '1XI', $2, '1XI', 'Westville Boys'' High 1XI', $3,
             (sa_today()::timestamp + interval '12 hours') at time zone 'Africa/Johannesburg', 'cricket', 'T20', 20, 'live')
     returning id`, [HIL, WES, GROUND]);
  const [{ name: groundName }] = await q(`select name from ground where id = $1`, [GROUND]);
  // A publisher for the 1XI only: reads the school's setting, may not change it.
  await q(`insert into app_user (id, school_id, email, name, role, teams) values ($1, $2, 'sideboard@example.invalid', 'R Mthembu', 'sportsadmin', '{1XI}')`, [SIDEBOARD, HIL]);
  await q(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'sportsadmin', $2, '1XI')`, [SIDEBOARD, HIL]);

  // ── 1. The director of sport ────────────────────────────────────
  group("1. The director of sport: the switch, the panel's line, and the public list");
  const dos = await open();
  ok("the director of sport signs in", await signIn(dos.page, "sarah@example.invalid"));
  ok("nothing is listed to begin with", (await listed()) == null && !(await live()).fixtures.some((f) => f.id === today));

  ok("Match Centre → the fixture's Public page panel", await toPanel(dos.page, today));
  ok("her school does not list: the line says so, that the fixture will not appear, and where to change it",
     /^Your school does not list its matches on the SCRBRD home page: this fixture will not appear there\. You can change that in Settings → School\.$/.test(await line(dos.page)), await line(dos.page));
  await tid(dos.page, "publish-home-toggle").click();
  await dos.page.waitForTimeout(1500);
  ok("she publishes the home side", /published/.test(await tid(dos.page, "publish-home-state").innerText()) && !/not published/.test(await tid(dos.page, "publish-home-state").innerText()));
  ok("published is not listed: the public list does not carry it", !(await live()).fixtures.some((f) => f.id === today));
  ok("...and the line is still the does-not-list one", /does not list/.test(await line(dos.page)));

  ok("Settings → School", await toSchool(dos.page));
  const panel = tid(dos.page, `listing-${HIL}`);
  ok("Hilton's listing switch is there", await panel.count() === 1);
  const words = await tid(dos.page, "listing-words").innerText().catch(() => "");
  ok("...in two sentences: published matches on the SCRBRD home page, team names and scores only, no player named, never the ground",
     /published matches appear on the SCRBRD home page/.test(words) && /team names and scores only/.test(words) && /no player is named/.test(words)
     && /ground is never shown/.test(words) && (words.match(/\./g) ?? []).length === 2, words);
  ok("...and that switching off takes them off within seconds", /Switching off takes them off the page within seconds/.test(words));
  const sw = tid(dos.page, "listing-switch");
  ok("...not listed, and she may change it", await sw.getAttribute("aria-checked") === "false" && await sw.isEnabled() && await tid(dos.page, "listing-why").count() === 0);
  const f1 = await floors(dos.page, `listing-${HIL}`);
  ok("at 1280 wide: nothing under 12px, no control under 44px", kept(f1), why(f1));
  await sw.click();
  await dos.page.waitForTimeout(1500);
  ok("she lists: the switch says listed, and the database holds it", await sw.getAttribute("aria-checked") === "true" && (await listed()) === true);
  const inkOf = (page) => page.$eval('[data-testid="listing-switch"]', (b) => ({ c: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor })).catch(() => null);
  const onInk = await inkOf(dos.page);
  ok("...its word is drawn in an ink that is not its own background, switched on", onInk && onInk.c !== onInk.bg, JSON.stringify(onInk));
  ok("...and the public list carries the fixture", await carries(today, true));
  const pub = await live();
  const card = pub.fixtures.find((f) => f.id === today);
  ok("...as team facts: both schools, no ground, no player", /Hilton College/.test(JSON.stringify(card)) && /Westville Boys' High/.test(JSON.stringify(card))
     && !pub.raw.includes(groundName) && !/Sherwood/.test(pub.raw) && !/"(player|players|people|names?)"/.test(pub.raw), pub.raw.slice(0, 300));

  ok("Match Centre → the panel again", await toPanel(dos.page, today));
  ok("listed and published: the line says this fixture will appear there",
     await line(dos.page) === "Your school lists its matches on the SCRBRD home page: this fixture will appear there.", await line(dos.page));
  await tid(dos.page, "publish-home-toggle").click();
  await dos.page.waitForTimeout(1500);
  ok("she withdraws the side: the public list drops it", await carries(today, false));
  ok("...and the line says it needs publishing", /will appear there once you publish it/.test(await line(dos.page)), await line(dos.page));
  await tid(dos.page, "publish-home-toggle").click();
  await dos.page.waitForTimeout(1500);
  ok("she publishes again: it is back", await carries(today, true) && /this fixture will appear there\.$/.test(await line(dos.page)));

  ok("Settings → School again", await toSchool(dos.page));
  ok("the switch still says listed (read from the database, not remembered)", await tid(dos.page, "listing-switch").getAttribute("aria-checked") === "true");
  await tid(dos.page, "listing-switch").click();
  await dos.page.waitForTimeout(1500);
  ok("she switches off: the database holds it", await tid(dos.page, "listing-switch").getAttribute("aria-checked") === "false" && (await listed()) === false);
  ok("...and the public list drops the fixture on the next read", await carries(today, false));
  ok("Match Centre → the panel: the line says the school does not list", await toPanel(dos.page, today) && /does not list/.test(await line(dos.page)));
  ok("no page error on her screens", dos.errors.length === 0, dos.errors.join(" | "));

  // ── 2. A publisher for one side ─────────────────────────────────
  group("2. A publisher for one side may read the setting, and not change it");
  const side = await open();
  const stok = await token("sideboard@example.invalid");
  const sg = await fetch(`${API}/api/schools/${HIL}/listing`, { headers: { authorization: `Bearer ${stok}` } });
  const sgb = sg.status === 200 ? await sg.json() : {};
  ok("the route lets him read it and says he may not change it", sg.status === 200 && sgb.mayChange === false, `${sg.status} ${JSON.stringify(sgb)}`);
  ok("he signs in", await signIn(side.page, "sideboard@example.invalid"));
  ok("Settings → School", await toSchool(side.page));
  ok("the switch is there, disabled, with the sentence why", await tid(side.page, "listing-switch").count() === 1 && await tid(side.page, "listing-switch").isDisabled()
     && /only someone who may publish for the whole school can/.test(await tid(side.page, "listing-why").innerText().catch(() => "")));
  const f2 = await floors(side.page, `listing-${HIL}`);
  ok("...keeping the floors", kept(f2), why(f2));
  const before = await listed();
  await tid(side.page, "listing-switch").click({ force: true, timeout: 2000 }).catch(() => {});
  await side.page.waitForTimeout(800);
  ok("pressing it changes nothing", (await listed()) === before && await tid(side.page, "listing-switch").getAttribute("aria-checked") === "false");
  ok("no page error on his screen", side.errors.length === 0, side.errors.join(" | "));

  // ── 3. A coach ──────────────────────────────────────────────────
  group("3. A coach is offered neither");
  const coach = await open();
  ok("the coach signs in", await signIn(coach.page, "coach@example.invalid"));
  await toSchool(coach.page);   // whether the tab is in a coach's Settings or not, no switch is drawn
  ok("Settings → School: no listing switch for a coach", await coach.page.locator('[data-testid^="listing-"]').count() === 0);
  const cm = await go(coach.page, "matches");
  if (cm) { await tid(coach.page, `match-card-${today}`).click({ timeout: 5000 }).catch(() => {}); await coach.page.waitForTimeout(1000); }
  ok("the fixture's panel, if drawn for a coach, carries no listing line", await tid(coach.page, "publish-listing").count() === 0 && await tid(coach.page, "publish-panel").count() === 0);

  // ── 4. The office adds a ground ─────────────────────────────────
  group("4. The office adds a ground, and a pitch on it");
  const office = await open();
  ok("the office signs in", await signIn(office.page, "registrar@example.invalid"));
  ok("Fields", await go(office.page, "fields"));
  ok("the office has Add ground", await tid(office.page, "add-ground-open").count() === 1);
  await tid(office.page, "add-ground-open").click();
  await office.page.waitForTimeout(400);
  const btn = await tid(office.page, "add-ground-open").evaluate((b) => ({ h: b.getBoundingClientRect().height, f: parseFloat(getComputedStyle(b).fontSize) }));
  ok("the Add ground button is 44px tall and 12px or more", btn.h >= 44 && btn.f >= 12, JSON.stringify(btn));
  ok("the form: name, surface, and pitch-on, no school choice (one school)", await tid(office.page, "add-ground-name").count() === 1 && await tid(office.page, "add-ground-surface").count() === 1
     && await tid(office.page, "add-ground-parent").count() === 1 && await tid(office.page, "add-ground-school").count() === 0);
  ok("the pitch-on choice offers Hilton's fields", (await tid(office.page, "add-ground-parent").locator("option").allInnerTexts()).some((t) => /Gordon Sherwood Oval/.test(t)));
  ok("...and none of Westville's", !(await tid(office.page, "add-ground-parent").locator("option").allInnerTexts()).some((t) => /Westville Main/.test(t)));
  await tid(office.page, "add-ground-name").fill("A");
  ok("one character: Add ground waits", await tid(office.page, "add-ground-save").isDisabled());
  const f4 = await floors(office.page, "add-ground-form");
  ok("at 1280 wide: the form keeps the floors", kept(f4), why(f4));

  await tid(office.page, "add-ground-name").fill(FIELD);
  await tid(office.page, "add-ground-surface").fill("grass");
  await tid(office.page, "add-ground-save").click();
  await office.page.waitForTimeout(1800);
  const field = (await q(`select id, school_id, surface, parent_id from ground where name = $1`, [FIELD]))[0];
  if (field) made.grounds.push(field.id);
  ok("she adds a field: the database holds it at Hilton, with its surface", field?.school_id === HIL && field.surface === "grass" && field.parent_id === null, JSON.stringify(field));
  ok("...the form says so", /Added Memorial Oval\./.test(await tid(office.page, "add-ground-added").innerText().catch(() => "")));
  ok("...and it is in the list without a reload", await tid(office.page, `ground-${field?.id}`).count() === 1);

  await tid(office.page, "add-ground-name").fill(PITCH);
  await tid(office.page, "add-ground-parent").selectOption({ label: FIELD });
  await tid(office.page, "add-ground-save").click();
  await office.page.waitForTimeout(1800);
  const pitch = (await q(`select id, parent_id from ground where name = $1`, [PITCH]))[0];
  if (pitch) made.grounds.push(pitch.id);
  ok("she adds a pitch on it: the database holds its parent", pitch?.parent_id === field?.id, JSON.stringify(pitch));
  ok("...and the list says it is a pitch on Memorial Oval, without a reload", /Pitch on Memorial Oval/.test(await tid(office.page, `ground-on-${pitch?.id}`).innerText().catch(() => "")));
  ok("...the field is not offered as a pitch on the pitch", !(await tid(office.page, "add-ground-parent").locator("option").allInnerTexts()).some((t) => t === PITCH));

  await tid(office.page, "add-ground-name").fill("memorial   OVAL");
  await tid(office.page, "add-ground-save").click();
  await office.page.waitForTimeout(1200);
  ok("the same name again, in another case: refused in the promised words", (await tid(office.page, "add-ground-refused").innerText().catch(() => "")) === DUPLICATE,
     await tid(office.page, "add-ground-refused").innerText().catch(() => ""));
  ok("...and nothing was added", (await q(`select count(*)::int as n from ground where school_id = $1 and lower(name) = 'memorial oval'`, [HIL]))[0].n === 1);
  ok("no page error on the office's screen", office.errors.length === 0, office.errors.join(" | "));

  // The coach on Fields.
  const cf = await go(coach.page, "fields");
  ok("a coach on Fields has no Add ground control", await tid(coach.page, "add-ground-open").count() === 0, cf ? "" : "(Fields is not in the coach's navigation, which is also no control)");
  ok("no page error on the coach's screens", coach.errors.length === 0, coach.errors.join(" | "));

  // ── 5. Phone width, Daylight ────────────────────────────────────
  group("5. At 390 wide in Daylight");
  const dayDos = await open({ theme: "daylight", width: 390, height: 844 });
  ok("the director of sport signs in on a phone", await signIn(dayDos.page, "sarah@example.invalid"));
  ok("Settings → School", await toSchool(dayDos.page));
  const f5 = await floors(dayDos.page, `listing-${HIL}`);
  ok("the switch: light page, nothing under 12px, no control under 44px, nothing wider than its card",
     /rgb\((2[0-9]{2}|1[89][0-9]), /.test(f5.bg) && kept(f5), `${f5.bg} ${why(f5)}`);
  const ink = await dayDos.page.$eval('[data-testid="listing-switch"]', (b) => ({ c: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor })).catch(() => null);
  ok("...its word is drawn in an ink that is not its own background", ink && ink.c !== ink.bg, JSON.stringify(ink));
  await tid(dayDos.page, "listing-switch").click({ timeout: 4000 }).catch(() => {});
  await dayDos.page.waitForTimeout(1200);
  const f5on = await floors(dayDos.page, `listing-${HIL}`);
  const ink5 = await inkOf(dayDos.page);
  ok("...switched on, in Daylight: the floors hold and the word is not its own background", await tid(dayDos.page, "listing-switch").getAttribute("aria-checked") === "true"
     && kept(f5on) && ink5 && ink5.c !== ink5.bg, `${why(f5on)} ${JSON.stringify(ink5)}`);
  ok("the panel's line, at phone width, is at least 12px", await toPanel(dayDos.page, today)
     && (await tid(dayDos.page, "publish-listing").evaluate((el) => parseFloat(getComputedStyle(el).fontSize)).catch(() => 0)) >= 12);

  const dayOff = await open({ theme: "daylight", width: 390, height: 844 });
  ok("the office signs in on a phone", await signIn(dayOff.page, "registrar@example.invalid"));
  ok("Fields", await go(dayOff.page, "fields"));
  ok("Add ground opens", await tid(dayOff.page, "add-ground-open").click({ timeout: 4000 }).then(() => true, () => false));
  await dayOff.page.waitForTimeout(400);
  await tid(dayOff.page, "add-ground-name").fill("Memorial Oval");
  await tid(dayOff.page, "add-ground-save").click({ timeout: 4000 }).catch(() => {});
  await dayOff.page.waitForTimeout(1200);
  const f6 = await floors(dayOff.page, "add-ground-form");
  ok("the form, refusal showing: light page, floors kept", /rgb\((2[0-9]{2}|1[89][0-9]), /.test(f6.bg) && kept(f6) && await tid(dayOff.page, "add-ground-refused").count() === 1, `${f6.bg} ${why(f6)}`);
  ok("no page error at phone width", dayDos.errors.length === 0 && dayOff.errors.length === 0, [...dayDos.errors, ...dayOff.errors].join(" | "));
  for (const c of [dos, side, coach, office, dayDos, dayOff]) await c.ctx.close();
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e?.stack ?? e);
} finally {
  // Leave the seed as found: no listing row, no fixture, no extra grounds, no side publisher.
  try {
    if (today) await q(`delete from match where id = $1`, [today]);
    await q(`delete from public_listing where school_id = $1`, [HIL]);
    await q(`delete from ground where school_id = $1 and name in ($2, $3)`, [HIL, FIELD, PITCH]);
    await q(`delete from access_log where person_id = $1`, [SIDEBOARD]);
    await q(`delete from role_assignment where person_id = $1`, [SIDEBOARD]);
    await q(`delete from app_user where id = $1`, [SIDEBOARD]);
  } catch (e) { console.log("  (cleanup:", e?.message, ")"); }
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nBROWSER LISTING: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

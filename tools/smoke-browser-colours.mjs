#!/usr/bin/env node
/**
 * Colours on the Management screen, in a browser (RECOGNITION R8, db/146).
 *
 *   1. THE SIDE'S COACH, on his Squad page (Management is user.role.assign's,
 *      and not his), nominates from his own side's boys only (the door's
 *      `sides`), chooses Full colours, and writes why; a word the side's list
 *      refuses (D2) is named before he can press the button; nominated, he
 *      reads it as with the school to decide, and is offered no decision.
 *   2. A DIRECTOR WHO IS THE BOY'S GUARDIAN (Sarah, K Dlamini's) is offered no
 *      button for her son's nomination and reads who decides instead (D10);
 *      the 1XI boy's she may decide.
 *   3. THE PRINCIPAL awards: one confirm sheet in §7's words, a citation the
 *      list passes, a 56px tap; records no award on the other. Each row then
 *      reads its outcome.
 *   4. A PARENT has no Colours tab. Floors at 390px: nothing under 12px,
 *      nothing tapped under 44px; no page error.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-colours.mjs
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
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(5378);
const API_PORT = port(8878);
const API = `http://127.0.0.1:${API_PORT}`;
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";
const DLAMINI = "aaaaaaaa-0000-0000-0000-000000000006";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PHONE = { width: 390, height: 844 };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-colours-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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
const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const browser = await chromium.launch({ ...launchOptions() });

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
const text = (page) => page.$eval("body", (el) => el.innerText);
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
  if (!(await click(page, new RegExp(email.replace(/[.]/g, "\\.")), 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await afterReads(page, 2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}
/** The coach's side page (Squad), where he nominates; then the phone's width. */
async function toSquadColours(page) {
  const nav = tid(page, "nav-squad").first();
  if (!(await nav.count())) { console.log("    (no Squad in the nav)"); return false; }
  try { await nav.click({ timeout: 6000 }); } catch { console.log("    (Squad would not open)"); return false; }
  try { await tid(page, "squad-colours").waitFor({ timeout: 10000 }); await tid(page, "colours-nominate").waitFor({ timeout: 10000 }); }
  catch { console.log("    (the Colours panel did not draw on Squad)"); return false; }
  await afterReads(page, 1500);
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(300);
  return true;
}
/** To Squad, on the side she coaches, where the coach's Colours form is. */
async function page_goSquad(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await tid(page, "nav-squad").first().click({ timeout: 6000 }).catch(() => {});
  await tid(page, "colours-nominate").waitFor({ timeout: 10000 }).catch(() => {});
  await afterReads(page, 1000);
}
/** Management → Colours (the deciders and the office), then the phone's width. */
async function toColours(page) {
  const nav = tid(page, "nav-management").first();
  if (!(await nav.count())) { console.log("    (no Management in the nav)"); return false; }
  try { await nav.click({ timeout: 6000 }); } catch { console.log("    (Management would not open)"); return false; }
  const tab = tid(page, "mgmt-tab-colours");
  try { await tab.waitFor({ timeout: 8000 }); await tab.click({ timeout: 4000 }); } catch {
    console.log("    (no Colours tab; tabs:", (await page.locator('[data-testid^="mgmt-tab-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")))).join(), ")");
    return false;
  }
  try { await tid(page, "colours").waitFor({ timeout: 10000 }); } catch { console.log("    (the Colours panel did not draw)"); return false; }
  await afterReads(page, 1500);
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(300);
  return true;
}
/** Rendered text under 12px, and things tapped under 44px, inside one element. */
const floors = (page, selector) => page.evaluate((sel) => {
  const root = document.querySelector(sel);
  if (!root) return { small: ["(no such root)"], taps: ["(no such root)"], wide: false };
  const small = [], taps = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 12) small.push(`${px}px "${n.nodeValue.trim().slice(0, 30)}"`);
  }
  for (const el of root.querySelectorAll("button, a[href], select, textarea, input:not([type=hidden]), [role=button], [role=radio]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 43.5 || r.width < 43.5) taps.push(`${Math.round(r.width)}x${Math.round(r.height)} ${(el.innerText || el.getAttribute("aria-label") || el.tagName).slice(0, 24)}`);
  }
  return { small, taps, wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
}, selector);
const floorsOk = async (page, who) => {
  const f = await floors(page, '[data-testid="colours"]');
  ok(`${who}: nothing under 12px, nothing tapped under 44px, no sideways scroll at 390px`, !f.small.length && !f.taps.length && !f.wide,
     JSON.stringify(f));
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const login = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "browser-colours" } })).body?.token;

  group("The side's coach nominates");
  {
    const c = await open();
    ok("the 1XI coach signs in", await signIn(c.page, "coach@example.invalid"));
    ok("...and reaches his side's Colours, on Squad (Management is not his)", await toSquadColours(c.page)
       && (await tid(c.page, "nav-management").count()) === 0);
    const boys = await tid(c.page, "colours-boy").locator("option").evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
    const side = (await q(`select id from player where school_id = '11111111-1111-1111-1111-111111111111' and team_code = '1XI'`)).map((r) => r.id);
    ok("he is offered his own side's boys, and nobody else's", boys.length > 0 && boys.every((b) => side.includes(b)) && !boys.includes(DLAMINI), boys.join());
    const go = tid(c.page, "colours-nominate-go");
    ok("...the button waits for a boy and a kind", await go.isDisabled());
    await tid(c.page, "colours-boy").selectOption(BEKKER);
    await tid(c.page, "colours-kind-colours").click();
    ok("...the choice is a radio, said in words", (await tid(c.page, "colours-kind-colours").getAttribute("aria-checked")) === "true"
       && /◉\s*Full colours/.test(await tid(c.page, "colours-kind-colours").innerText()));
    await tid(c.page, "colours-why").fill("Bowled through a hamstring niggle all season.");
    ok("a refused word is named before he presses (D2), and the button waits",
       /hamstring and niggle/.test(await tid(c.page, "colours-why-refused").innerText().catch(() => "")) && await go.isDisabled());
    await tid(c.page, "colours-why").fill("Thirty wickets and a fifty in the final.");
    ok("...changed, it may go", !(await go.isDisabled()) && /Nominate T Bekker/.test(await go.innerText()));
    await floorsOk(c.page, "the coach's form");
    await go.click();
    await tid(c.page, "colours-said").waitFor({ timeout: 8000 }).catch(() => {});
    ok("nominated, in words", (await tid(c.page, "colours-said").innerText().catch(() => "")) === "Nominated: T Bekker for Full colours. The school decides.");
    await c.page.waitForTimeout(800);
    const row = c.page.locator('[data-testid="colours-row"]', { hasText: "T Bekker" }).first();
    ok("...his list reads it as his, with the school to decide, and offers him no decision",
       /You nominated him/.test(await row.innerText().catch(() => "")) && /With the school to decide\./.test(await row.innerText().catch(() => ""))
       && (await tid(c.page, "colours-award").count()) === 0, await row.innerText().catch(() => ""));
    ok("...and its why", /Why: Thirty wickets and a fifty in the final\./.test(await row.innerText().catch(() => "")));
    ok("no page error", c.errors.length === 0, c.errors.join(" | "));
    await c.ctx.close();
  }

  // K Dlamini, Sarah's son, nominated by another U16B coach (she may not: Kameel, 6 Nov 2026), by the API.
  await q(`insert into role_assignment (person_id, role, school_id, team_code) select id, 'coach', school_id, 'U16B' from app_user where email = 'coach2@example.invalid'`);
  // A second U16B boy, so Sarah's list has someone on it beside her son.
  const MATE = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
                         values ('11111111-1111-1111-1111-111111111111', 'U16B', 'Walk Colours Mate', 77, 'batter', sa_today() - interval '15 years')
                         returning id`))[0].id;
  const dl = await call("/api/colours/nominations", { method: "POST", token: await login("coach2@example.invalid"), body: { playerId: DLAMINI, kind: "half_colours" } });
  ok("(stage) another U16B coach nominates K Dlamini for half colours", dl.status === 200, JSON.stringify(dl.body));

  group("A director who is the boy's guardian");
  {
    const s = await open();
    ok("Sarah signs in", await signIn(s.page, "sarah@example.invalid"));
    ok("...and reaches Management → Colours", await toColours(s.page));
    const decide = s.page.locator('[data-testid="colours-decide-row"]');
    ok("she may decide the 1XI boy's", (await decide.filter({ hasText: "T Bekker" }).count()) === 1);
    ok("...and is offered no button for her son's", (await decide.filter({ hasText: "K Dlamini" }).count()) === 0);
    const row = s.page.locator('[data-testid="colours-row"]', { hasText: "K Dlamini" }).first();
    ok("...whose row says who decides instead", /You are his guardian, so the principal decides\./.test(await row.innerText().catch(() => "")),
       await row.innerText().catch(() => ""));
    await page_goSquad(s.page);
    const offered = await tid(s.page, "colours-boy").locator("option").evaluateAll((els) => els.map((e) => e.value).filter(Boolean)).catch(() => null);
    ok("...and on her U16B Squad page she is offered his team-mate, not her son", Array.isArray(offered) && offered.includes(MATE) && !offered.includes(DLAMINI), JSON.stringify(offered));
    ok("no page error", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  group("The principal decides");
  {
    const p = await open();
    ok("the principal signs in", await signIn(p.page, "principal@example.invalid"));
    ok("...and reaches Management → Colours", await toColours(p.page));
    const bek = p.page.locator('[data-testid="colours-decide-row"]', { hasText: "T Bekker" }).first();
    ok("T Bekker's nomination is hers to decide, with its why", /Full colours \d{4} to decide/.test(await bek.innerText().catch(() => ""))
       && /Why: Thirty wickets/.test(await bek.innerText().catch(() => "")));
    await bek.locator('[data-testid="colours-award"]').click();
    const sheet = bek.locator('[data-testid="colours-confirm"]');
    ok("one confirm sheet, in §7's words", /This awards Full colours \d{4} to T Bekker\./.test(await sheet.innerText().catch(() => "")));
    await sheet.locator('[data-testid="colours-citation"]').fill("For bowling through an injury.");
    const goAward = sheet.locator('[data-testid="colours-award-go"]');
    ok("a refused word in the citation is named, and the tap waits", /injury/.test(await sheet.locator('[data-testid="colours-citation-refused"]').innerText().catch(() => ""))
       && await goAward.isDisabled());
    await sheet.locator('[data-testid="colours-citation"]').fill("Thirty wickets and a fifty in the final.");
    const box = await goAward.boundingBox();
    ok("...the one tap that awards is 56px tall", box && box.height >= 55.5, JSON.stringify(box));
    await floorsOk(p.page, "the principal's confirm sheet");
    await goAward.click();
    await p.page.waitForTimeout(1200);
    const done = p.page.locator('[data-testid="colours-row"]', { hasText: "T Bekker" }).first();
    ok("awarded, the row reads its outcome", /Awarded · /.test(await done.innerText().catch(() => "")), await done.innerText().catch(() => ""));
    const h = (await q(`select h.decided_by, u.email, h.citation from honour h join app_user u on u.id = h.decided_by where h.player_id = $1 and h.kind = 'colours'`, [BEKKER]))[0];
    ok("...the honour is hers, with the citation", h?.email === "principal@example.invalid" && h?.citation === "Thirty wickets and a fifty in the final.", JSON.stringify(h));
    const kd = p.page.locator('[data-testid="colours-decide-row"]', { hasText: "K Dlamini" }).first();
    await kd.locator('[data-testid="colours-no-award"]').click();
    ok("no award asks once, and says nobody is told", /Nobody is told about it\./.test(await kd.locator('[data-testid="colours-no-award-confirm"]').innerText().catch(() => "")));
    await kd.locator('[data-testid="colours-no-award-go"]').click();
    await p.page.waitForTimeout(1200);
    ok("...and the row reads No award", /No award · /.test(await p.page.locator('[data-testid="colours-row"]', { hasText: "K Dlamini" }).first().innerText().catch(() => "")));
    ok("no word on the screen says rejected or declined", !/rejected|declined|overruled/i.test(await tid(p.page, "colours").innerText()));
    ok("no page error", p.errors.length === 0, p.errors.join(" | "));
    await p.ctx.close();
  }

  group("A parent has no Colours");
  {
    const g = await open();
    await signIn(g.page, "parent@example.invalid");   // her app is the family's: no staff home to look for
    ok("R Pillay's mother signs in", (await g.page.locator("button", { hasText: /^Sign In$|Get Started/ }).count()) === 0);
    ok("...and is offered no Management, no Squad and no Colours", (await tid(g.page, "nav-management").count()) === 0
       && (await tid(g.page, "mgmt-tab-colours").count()) === 0 && (await tid(g.page, "colours").count()) === 0);
    await g.ctx.close();
  }
} catch (e) {
  fail++;
  console.log("  ✗ threw:", e?.stack ?? e);
} finally {
  await browser.close();
  apiProc.kill();
  web.close();
  await pool.end();
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n────────────────────────────────────────────────────\nBROWSER COLOURS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

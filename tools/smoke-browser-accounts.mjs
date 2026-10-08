#!/usr/bin/env node
/**
 * Disable account and Enable account, on Management → Users, from a browser
 * (account lifecycle, slice 1: the `accounts` read, db/85's two routes, db/81's
 * rule; no migration).
 *
 *   1. The office sees Disable account beside a coach, and not beside the
 *      principal, the DSO or itself: the button is drawn only where the server
 *      would allow it.
 *   2. Disable opens a confirmation that says every device is signed out now
 *      and the roles stay; "Keep it active" changes nothing.
 *   3. Confirmed: the coach's token is dead on its next request, his row stays
 *      on the list marked "Disabled" in words, every role chip still live, the
 *      "Disabled" filter finds him, and Postgres agrees.
 *   4. Enable account: the row is "Active" again, and the coach signs in from
 *      a browser.
 *   5. An account holding a role at a second school, which the office cannot
 *      see: the button is drawn, the server refuses, and the screen says why in
 *      the server's words; nothing moves.
 *   6. The "coming" line is gone; a coach is offered no Disable at all; the
 *      demonstration offers none.
 *   7. The floors: no text under 12px, nothing tapped under 44px, at 1280 and
 *      at 390 wide with no sideways scroll; under reduced motion the buttons do
 *      not animate.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-accounts.mjs
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

const WEB_PORT = port(4392);
const API_PORT = port(8934);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-accounts-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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
const q = async (text, params) => (await pool.query(text, params)).rows;
const activeOf = async (email) => (await q(`select active from app_user where email = $1`, [email]))[0]?.active;
const rolesOf = async (email) => (await q(
  `select a.role, a.team_code from role_assignment a join app_user u on u.id = a.person_id
    where u.email = $1 and a.active order by a.role, a.team_code`, [email])).map((r) => `${r.role}:${r.team_code ?? ""}`).join(",");

const browser = await chromium.launch({ ...launchOptions() });

async function open({ apiBase = API, viewport = { width: 1280, height: 900 }, reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // A refusal the walk provokes on purpose is the browser logging a 403.
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(apiBase)};`);
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
async function signIn(page, email, password = "") {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  if (password) await page.fill("#login-password", password);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}
async function toUsers(page) {
  const nav = tid(page, "nav-management").first();
  if (!(await nav.count())) return false;
  try { await nav.click({ timeout: 6000 }); } catch { return false; }
  try { await tid(page, "people-panel").waitFor({ timeout: 10000 }); } catch { return false; }
  try { await page.locator('[data-testid^="person-row-"]').first().waitFor({ timeout: 10000 }); } catch { return false; }
  await page.waitForTimeout(600);
  return true;
}
const rowOf = (page, email) => page.locator(`[data-testid^="person-row-"][data-email="${email}"]`);
const idOf = async (page, email) => (await rowOf(page, email).getAttribute("data-testid"))?.replace("person-row-", "");
const chipStates = (row) => row.locator('[data-testid="role-chip"]').evaluateAll((els) =>
  els.map((e) => `${e.getAttribute("data-role")}:${e.getAttribute("data-state")}`));

/** Rendered text under 12px, and things tapped under 44px, inside one element. */
const floors = (page, selector) => page.evaluate((sel) => {
  const root = document.querySelector(sel);
  if (!root) return { small: ["(no such root)"], taps: ["(no such root)"] };
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
  for (const el of root.querySelectorAll("button, a[href], select, textarea, input:not([type=hidden]), [role=button]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const box = el.type === "checkbox" ? el.closest("label").getBoundingClientRect() : r;
    if (box.height < 43.5 || box.width < 43.5) taps.push(`${Math.round(box.width)}x${Math.round(box.height)} ${(el.innerText || el.getAttribute("aria-label") || el.type || el.tagName).slice(0, 24)}`);
  }
  return { small, taps };
}, selector);

const OFFICE = "registrar@example.invalid";
const COACH = "coach@example.invalid";          // C Hendricks, 1XI coach
const PRINCIPAL = "principal@example.invalid";
const DSO = "dso@example.invalid";
const TWO = "two.schools@example.invalid";      // invented for this walk: a coach here, a parent at Westville
const HILTON = "11111111-1111-1111-1111-111111111111";

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // A coach at this school who is also a parent at another: the office cannot
  // read the Westville appointment, so it is offered the button, and the
  // server refuses (db/81: a role this office could not grant stands).
  const [{ id: WESTVILLE }] = await q(`select school_id as id from app_user where email = 'registrar.wes@example.invalid'`);
  await q(`with u as (insert into app_user (school_id, email, name, role) values ($1, $3, 'Two Schools', 'coach') returning id)
           insert into role_assignment (person_id, role, school_id, team_code)
           select id, 'coach', $1, 'U15A' from u union all select id, 'guardian', $2, null from u`, [HILTON, WESTVILLE, TWO]);

  // The coach, signed in on a phone before anything happens.
  const coachToken = (await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: COACH, deviceId: "walk-coach-phone" }) })).json()).token;
  const coachSession = async () => (await fetch(`${API}/api/session`, { headers: { authorization: `Bearer ${coachToken}` } })).status;
  ok("the coach is signed in on his phone", (await coachSession()) === 200);

  // ── 1. Where the button is drawn ─────────────────────────────────
  group("The office is offered Disable only where the server would allow it");
  const off = await open();
  ok("the office signs in and reaches Management → Users", await signIn(off.page, OFFICE) && await toUsers(off.page));
  const coachId = await idOf(off.page, COACH);
  const coachRow = rowOf(off.page, COACH);
  ok("the coach's row offers Disable account", await tid(off.page, `account-disable-${coachId}`).count() === 1);
  ok("...named for whom", (await tid(off.page, `account-disable-${coachId}`).getAttribute("aria-label")) === "Disable C Hendricks's account");
  for (const [who, email] of [["the principal", PRINCIPAL], ["the DSO", DSO], ["the office itself", OFFICE]]) {
    const row = rowOf(off.page, email);
    ok(`no Disable or Enable beside ${who}`, await row.count() === 1
       && await row.locator('[data-testid^="account-disable-"], [data-testid^="account-enable-"]').count() === 0);
  }
  ok("the 'coming' line is gone", await tid(off.page, "people-coming").count() === 0
     && !/Suspending an account is coming/.test(await tid(off.page, "people-panel").innerText()));
  const rolesBefore = await rolesOf(COACH);
  const chipsBefore = await chipStates(coachRow);

  // ── 2. The confirmation ──────────────────────────────────────────
  group("Disable asks first, in plain words, and Keep it active changes nothing");
  await tid(off.page, `account-disable-${coachId}`).click({ timeout: 5000 });
  const form = tid(off.page, "account-disable-form");
  ok("the confirmation opens", await form.count() === 1);
  const warning = await tid(off.page, "account-disable-warning").innerText().catch(() => "");
  ok("...it says every device is signed out now and the roles stay",
     warning === "This signs C Hendricks out of every device now and stops them signing in. Their roles stay. To remove them from the school, end their roles first.", warning);
  ok("...Keep it active has the focus: the destructive button is not the default",
     await off.page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "account-disable-cancel");
  const ff = await floors(off.page, '[data-testid="account-disable-form"]');
  ok("...on the 12px and 44px floors", ff.small.length === 0 && ff.taps.length === 0, ff.small.concat(ff.taps).join(" | "));
  await tid(off.page, "account-disable-cancel").click();
  await off.page.waitForTimeout(400);
  ok("Keep it active closes it, and the account is untouched",
     await form.count() === 0 && (await activeOf(COACH)) === true && (await coachSession()) === 200);

  // ── 3. Disabled ──────────────────────────────────────────────────
  group("Disabled: signed out everywhere, still on the list, every role kept");
  await tid(off.page, `account-disable-${coachId}`).click({ timeout: 5000 });
  await tid(off.page, "account-disable-confirm").click({ timeout: 5000 });
  await tid(off.page, `account-enable-${coachId}`).waitFor({ timeout: 10000 }).catch(() => {});
  ok("Postgres has the account disabled", (await activeOf(COACH)) === false);
  ok("the coach's phone is signed out on its next request", (await coachSession()) === 401);
  ok("the screen says what was done", /Disabled C Hendricks's account\. They are signed out of every device and cannot sign in\. Their roles stay\./
     .test(await tid(off.page, "people-notice").innerText().catch(() => "")));
  ok("the coach stays on the list, once", await rowOf(off.page, COACH).count() === 1);
  ok("...marked Disabled in words", (await rowOf(off.page, COACH).getAttribute("data-status")) === "inactive"
     && (await rowOf(off.page, COACH).locator('[data-testid="account-disabled"]').innerText()).trim() === "Disabled");
  ok("...every role chip as it was, live", JSON.stringify(await chipStates(rowOf(off.page, COACH))) === JSON.stringify(chipsBefore)
     && (await rolesOf(COACH)) === rolesBefore, `${await chipStates(rowOf(off.page, COACH))} / ${chipsBefore}`);
  ok("...and Enable account offered in place of Disable", await tid(off.page, `account-enable-${coachId}`).count() === 1
     && await tid(off.page, `account-disable-${coachId}`).count() === 0);
  await tid(off.page, "people-status-filter").selectOption("inactive");
  await off.page.waitForTimeout(300);
  const disabledShown = await off.page.locator('[data-testid^="person-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-email")));
  ok("the Disabled filter finds him, and only him", JSON.stringify(disabledShown) === JSON.stringify([COACH]), disabledShown.join());
  ok("...the filter's word is Disabled", /Disabled/.test(await tid(off.page, "people-status-filter").locator('option[value="inactive"]').innerText()));
  const pf = await floors(off.page, '[data-testid="people-panel"]');
  ok("the list, filtered, is on the 12px and 44px floors", pf.small.length === 0 && pf.taps.length === 0, pf.small.concat(pf.taps).join(" | "));
  await tid(off.page, "people-status-filter").selectOption("all");
  await off.page.waitForTimeout(300);

  const coachTry = await open();
  ok("the coach cannot sign in from a browser while disabled", !(await signIn(coachTry.page, COACH)));
  await coachTry.ctx.close();

  // ── 4. Enabled ───────────────────────────────────────────────────
  group("Enable account: active again, and he signs in");
  await tid(off.page, `account-enable-${coachId}`).click({ timeout: 5000 });
  await tid(off.page, `account-disable-${coachId}`).waitFor({ timeout: 10000 }).catch(() => {});
  ok("Postgres has the account active", (await activeOf(COACH)) === true);
  ok("the screen says so", /Enabled C Hendricks's account\. They can sign in again/.test(await tid(off.page, "people-notice").innerText().catch(() => "")));
  ok("the row reads Active, with Disable account offered again", (await rowOf(off.page, COACH).getAttribute("data-status")) === "active"
     && await rowOf(off.page, COACH).locator('[data-testid="account-disabled"]').count() === 0
     && await tid(off.page, `account-disable-${coachId}`).count() === 1);
  ok("his old phone token stays signed out", (await coachSession()) === 401);
  ok("every role he held is still held", (await rolesOf(COACH)) === rolesBefore);
  const coachBack = await open();
  ok("the coach signs in again from a browser", await signIn(coachBack.page, COACH));

  // ── 6. A coach is offered nothing ────────────────────────────────
  group("A coach is offered no Disable at all");
  const coachSees = await toUsers(coachBack.page);
  ok("...on any row he can reach",
     !coachSees || await coachBack.page.locator('[data-testid^="account-disable-"], [data-testid^="account-enable-"]').count() === 0);
  ok("no console errors on the coach's session", coachBack.errors.length === 0, coachBack.errors.join(" | "));
  await coachBack.ctx.close();

  // ── 5. Refused in words ──────────────────────────────────────────
  group("A role at a second school: the server refuses, and the screen says why");
  // The account was made before the office signed in, so it is on the list
  // already (a reload would sign the office out: the token lives in memory).
  ok("the account is on the office's list", await rowOf(off.page, TWO).count() === 1);
  const twoId = await idOf(off.page, TWO);
  ok("the office sees the account and its role here, not the one at Westville",
     await rowOf(off.page, TWO).count() === 1 && JSON.stringify(await chipStates(rowOf(off.page, TWO))) === JSON.stringify(["coach:live"]));
  await tid(off.page, `account-disable-${twoId}`).click({ timeout: 5000 });
  await tid(off.page, "account-disable-confirm").click({ timeout: 5000 });
  await tid(off.page, "account-refused").waitFor({ timeout: 8000 }).catch(() => {});
  const said = await tid(off.page, "account-refused").innerText().catch(() => "");
  ok("the refusal is the server's sentence, in words, never a code",
     said === "You cannot do this for that account. The school office that enrolled them can." && !/not_permitted/.test(said), said);
  ok("...the confirmation stays open, and nothing moved", await tid(off.page, "account-disable-form").count() === 1 && (await activeOf(TWO)) === true);
  await tid(off.page, "account-disable-cancel").click();
  ok("no console errors on the office's session", off.errors.length === 0, off.errors.join(" | "));
  await off.ctx.close();

  // ── 7. 390 wide, reduced motion ──────────────────────────────────
  group("At 390 wide under reduced motion: no sideways scroll, the floors, no animation");
  // Signed in at desktop width, then narrowed, as smoke-browser-management
  // does: the shell chooses its navigation by width, and the sign-in screen is
  // not what is being measured.
  const ph = await open({ reducedMotion: "reduce" });
  ok("the office signs in", await signIn(ph.page, OFFICE) && await toUsers(ph.page));
  await ph.page.setViewportSize({ width: 390, height: 844 });
  await ph.page.waitForTimeout(800);
  const pid = await idOf(ph.page, COACH);
  await tid(ph.page, `account-disable-${pid}`).click({ timeout: 5000 });
  await ph.page.waitForTimeout(300);
  // The shell clips its own overflow; what is asked is that nothing in the
  // list or the confirmation is drawn past the edge of the screen.
  const past = await ph.page.evaluate(() => [...document.querySelectorAll('[data-testid="people-panel"], [data-testid="people-panel"] *')]
    .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > window.innerWidth + 1)
    .map((el) => `${el.tagName}.${el.getAttribute("data-testid") || ""} → ${Math.round(el.getBoundingClientRect().right)}`));
  ok("nothing is drawn past the edge of a 390 screen with the confirmation open, and no sideways scroll",
     past.length === 0 && await ph.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
     past.slice(0, 3).join(" | "));
  const phf = await floors(ph.page, '[data-testid="people-panel"]');
  ok("the list and the confirmation are on the 12px and 44px floors", phf.small.length === 0 && phf.taps.length === 0, phf.small.concat(phf.taps).slice(0, 5).join(" | "));
  const motion = await ph.page.evaluate(() => [...document.querySelectorAll('[data-testid="account-disable-form"] button')]
    .map((b) => parseFloat(getComputedStyle(b).transitionDuration) || 0));
  ok("under reduced motion the buttons do not animate", motion.length === 2 && motion.every((s) => s <= 0.001), motion.join());
  await tid(ph.page, "account-disable-cancel").click();
  ok("...and nothing was disabled", (await activeOf(COACH)) === true);
  await ph.ctx.close();

  // ── 6b. The demonstration ────────────────────────────────────────
  group("Nobody signed in: the demonstration offers no Disable");
  const demo = await open({ apiBase: "http://127.0.0.1:9" });
  ok("the demonstration's super admin gets in", await signIn(demo.page, "admin@hilton.co.za", "admin123"));
  await toUsers(demo.page);
  ok("no Disable or Enable anywhere, and no 'coming' line",
     await demo.page.locator('[data-testid^="account-disable-"], [data-testid^="account-enable-"]').count() === 0
     && await tid(demo.page, "people-coming").count() === 0);
  await demo.ctx.close();
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", e.message);
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && apiErr.length) console.log("\nAPI stderr:\n" + apiErr.join("").split("\n").slice(0, 12).join("\n"));
console.log(`\n${"─".repeat(52)}\nBROWSER ACCOUNTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

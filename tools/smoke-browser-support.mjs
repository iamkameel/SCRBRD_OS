#!/usr/bin/env node
/**
 * Support access, from a browser. SCRBRD-012, roadmap up23.
 *
 * tools/smoke-support.mjs proves db/22 over HTTP: the session is one role at
 * one school, it stops by itself, the school can stop it sooner, and every
 * read under it is on the school's record. Nothing proved a PERSON could
 * begin one — the platform side was an API route and no screen. The panel
 * that draws it (apps/web/src/views/support.jsx, Settings › Support) is what
 * this walk drives, and it asks the questions curl cannot:
 *
 *   1. Is the tab offered only to a holder of platform.support.impersonate?
 *      The registrar holds user.role.assign at her school — a wide office
 *      bundle — and must not be drawn it.
 *   2. When the database refuses — no reason worth reading, the same session
 *      twice — does the screen say so in words, and write nothing?
 *   3. Does a session begun from the screen appear on the SCHOOL's side, in
 *      Settings › School, with the reason, as live — and once ended from the
 *      platform side, as over, by whom?
 *   4. Signed out (the demonstration), is nothing invented?
 *
 * Falsified twice. Loosening the tab's gate in SettingsView.jsx to draw it
 * for everyone turned "there is no Support tab" red; loosening the panel's
 * own gate in support.jsx as well turned "no support panel" red too — the
 * registrar was drawn a begin form. Both green again once restored.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-support.mjs
 *   BROWSER_SUPPORT_DEBUG=1 node tools/smoke-browser-support.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 4344;
const API_PORT = 8844;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const REASON = "ticket 5120: fixture import failing at Hilton";
const DEBUG = !!process.env.BROWSER_SUPPORT_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-support-secret",
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

const pool = new pg.Pool({ connectionString: DB });
const dbq = async (text, params) => (await pool.query(text, params)).rows;
const sessionsInDb = () => dbq(
  `select s.id, s.reason, s.role, s.school_id, s.expires_at, s.ended_at, e.email as ended_by,
          a.active as assignment_active
     from support_access s
     join role_assignment a on a.id = s.assignment_id
     left join app_user e on e.id = s.ended_by
    order by s.started_at`);

const browser = await chromium.launch({ ...launchOptions() });

async function open(apiBase = API) {
  const ctx = await browser.newContext();
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
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
/** Accounts on the pilot list are clicked; the platform account is not a
 *  school role and is not on it, so its address is typed. */
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
async function toSettings(page) {
  const l = tid(page, "nav-settings").first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return true;
}
const tab = (page, id) => page.locator(`#settings-tab-${id}`);
async function openTab(page, id) {
  if (!(await tab(page, id).count())) return false;
  await tab(page, id).first().click({ timeout: 6000 });
  await page.waitForTimeout(1500);
  return true;
}
/** The school's own Support access card, under Settings › School. */
const schoolCard = (page) => tid(page, "school-support-access");

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the walk starts with no support session on record", (await sessionsInDb()).length === 0);

  // ── Signed out ───────────────────────────────────────────────────
  group("Signed out, the platform's demo account is told to sign in — nothing is invented");
  {
    const d = await open("http://127.0.0.1:9");
    ok("the demonstration's super admin signs in", await signIn(d.page, "admin@hilton.co.za", "admin123"));
    await toSettings(d.page);
    ok("...and is drawn the Support tab (the demo maps to a platform administrator)", await openTab(d.page, "support"));
    ok("...which says to sign in to the live platform",
       /Sign in to the live platform/.test(await tid(d.page, "support-access").innerText().catch(() => "")));
    ok("...and offers no form that could not be sent", await tid(d.page, "support-begin").count() === 0);
    await d.ctx.close();
  }

  // ── Not offered ──────────────────────────────────────────────────
  group("A school-scoped account is not offered the platform screen");
  const reg = await open();
  ok("the registrar signs in", await signIn(reg.page, "registrar@example.invalid"));
  ok("...and reaches Settings", await toSettings(reg.page));
  ok("...where the People tab is drawn (the tab strip rendered at all)", await tab(reg.page, "users").count() === 1);
  ok("...and there is no Support tab", await tab(reg.page, "support").count() === 0);
  // Were a tab drawn by mistake, open it: the panel carries its own gate too,
  // and this is what proves that one rather than a tab nobody clicked.
  await openTab(reg.page, "support");
  ok("...and no support panel anywhere on the screen, nor a way to begin one",
     await tid(reg.page, "support-access").count() === 0 && await tid(reg.page, "support-begin").count() === 0);
  ok("no console errors on the registrar's session", reg.errors.length === 0, reg.errors.join(" | "));
  await reg.ctx.close();

  // ── Begin ────────────────────────────────────────────────────────
  group("The platform administrator is offered the screen, and every refusal is said in words");
  const plat = await open();
  ok("Platform Ops signs in", await signIn(plat.page, "platform@example.invalid"));
  ok("...reaches Settings", await toSettings(plat.page));
  ok("...and is offered the Support tab", await openTab(plat.page, "support"));
  ok("the panel is drawn", await tid(plat.page, "support-access").count() === 1);
  ok("...with nothing begun yet", /You have not begun a support session/.test(await tid(plat.page, "support-access").innerText()));
  await plat.page.waitForTimeout(800);
  const schoolOptions = await tid(plat.page, "support-school").locator("option").allInnerTexts();
  ok("the schools come from the server", schoolOptions.includes("Hilton College"), schoolOptions.join(" | "));
  const roleOptions = await tid(plat.page, "support-role").locator("option").evaluateAll((os) => os.map((o) => o.value));
  ok("the roles offered are a school's own — no platform role, no parent, no side-less coach",
     roleOptions.includes("directorofsport") &&
     !["platformadmin", "superadmin", "guardian", "selfaccess", "enquiry", "coach"].some((r) => roleOptions.includes(r)),
     roleOptions.join(" "));

  await tid(plat.page, "support-school").selectOption(HIL);
  await tid(plat.page, "support-role").selectOption("directorofsport");
  await tid(plat.page, "support-begin").click({ timeout: 6000 });
  await plat.page.waitForTimeout(1200);
  const noReason = await tid(plat.page, "support-refused").innerText().catch(() => "");
  if (DEBUG) console.log("[debug] refused without a reason:", noReason);
  ok("a begin with no reason is refused, in words", /at least ten characters/i.test(noReason), noReason);
  ok("...and nothing was written", (await sessionsInDb()).length === 0);

  await tid(plat.page, "support-reason").fill("fix");
  await tid(plat.page, "support-begin").click({ timeout: 6000 });
  await plat.page.waitForTimeout(1200);
  ok("a reason nobody could act on is refused the same way",
     /at least ten characters/i.test(await tid(plat.page, "support-refused").innerText().catch(() => "")));
  ok("...and still nothing was written", (await sessionsInDb()).length === 0);

  await tid(plat.page, "support-reason").fill(REASON);
  await tid(plat.page, "support-begin").click({ timeout: 6000 });
  await plat.page.waitForTimeout(1800);
  const begun = await tid(plat.page, "support-begun").innerText().catch(() => "");
  if (DEBUG) console.log("[debug] begun:", begun);
  ok("with a reason, the session begins", /Begun at Hilton College as Director of Sport/.test(begun), begun);
  ok("...and no refusal is left on screen", await tid(plat.page, "support-refused").count() === 0);
  const [row] = await sessionsInDb();
  ok("Postgres holds one session, with the reason as typed", row?.reason === REASON && row?.role === "directorofsport" && row?.school_id === HIL, JSON.stringify(row));
  const mins = (new Date(row?.expires_at) - Date.now()) / 60000;
  ok("...for the hour the form defaulted to", mins > 58 && mins <= 60, String(mins));
  const S = row?.id;
  const live = tid(plat.page, `support-session-${S}`);
  // The list re-reads after the begin; give that read its moment rather than racing it.
  await live.waitFor({ timeout: 8000 }).catch(() => {});
  ok("the session is listed under the operator's own sessions", await live.count() === 1);
  const liveText = await live.innerText().catch(() => "");
  if (DEBUG) console.log("[debug] live row:", liveText);
  ok("...as live, with the reason", /Live now/i.test(liveText) && liveText.includes(REASON), liveText);
  const count1 = await live.locator('[data-testid="support-countdown"]').innerText().catch(() => "");
  const shown = Number(count1.match(/^(\d+) min/)?.[1]);
  ok("...counting down to the server's expires_at", /min \d\d s left/.test(count1) && shown >= 58 && shown <= 59, count1);
  await plat.page.waitForTimeout(2100);
  const count2 = await live.locator('[data-testid="support-countdown"]').innerText().catch(() => "");
  ok("...and the clock moves", count2 !== count1, `${count1} → ${count2}`);

  ok("the reason box is cleared after a session begins, so a second click cannot repeat it",
     (await tid(plat.page, "support-reason").inputValue()) === "");
  await tid(plat.page, "support-reason").fill(REASON);
  await tid(plat.page, "support-begin").click({ timeout: 6000 });
  await plat.page.waitForTimeout(1200);
  const twice =await tid(plat.page, "support-refused").innerText().catch(() => "");
  ok("the same session twice is refused, in words", /already have a session open/i.test(twice), twice);
  ok("...and only one session exists", (await sessionsInDb()).length === 1);

  // ── The school sees it ───────────────────────────────────────────
  group("The school sees it, on its own record");
  const dos = await open();
  ok("the director of sport at Hilton signs in", await signIn(dos.page, "sarah@example.invalid"));
  await toSettings(dos.page);
  ok("...opens Settings › School", await openTab(dos.page, "school"));
  const schoolLive = await schoolCard(dos.page).innerText().catch(() => "");
  if (DEBUG) console.log("[debug] school's card, live:\n" + schoolLive);
  ok("the school's Support access card names who, and as what", /Platform Ops as Director of Sport/.test(schoolLive), schoolLive.slice(0, 300));
  ok("...with the reason the operator typed", schoolLive.includes(REASON));
  ok("...as live now", /Live now/i.test(schoolLive));

  // ── Ended from the platform side ─────────────────────────────────
  group("Ended early from the platform side, it is over for the school too");
  await live.locator('[data-testid="support-end"]').click({ timeout: 6000 });
  await plat.page.waitForTimeout(1800);
  const endedText = await tid(plat.page, `support-session-${S}`).innerText().catch(() => "");
  if (DEBUG) console.log("[debug] platform row, ended:", endedText);
  ok("the operator's row says it is over, and by whom", /Over/i.test(endedText) && /ended .* by Platform Ops/.test(endedText), endedText);
  ok("...and offers no End button any more", await tid(plat.page, "support-end").count() === 0);
  const [after] = await sessionsInDb();
  ok("Postgres agrees: ended, by the platform account, and the assignment is off",
     after?.ended_at && after.ended_by === "platform@example.invalid" && after.assignment_active === false, JSON.stringify(after));

  // Away and back: the School tab remounts and reads the server again.
  await openTab(dos.page, "me");
  await openTab(dos.page, "school");
  const schoolOver = await schoolCard(dos.page).innerText().catch(() => "");
  if (DEBUG) console.log("[debug] school's card, over:\n" + schoolOver);
  ok("the school's card now says over", /Over/i.test(schoolOver) && !/Live now/i.test(schoolOver), schoolOver.slice(0, 300));
  ok("...and who ended it", /by Platform Ops/.test(schoolOver));

  ok("no console errors on the operator's session", plat.errors.length === 0, plat.errors.join(" | "));
  ok("no console errors on the school's session", dos.errors.length === 0, dos.errors.join(" | "));
  await plat.ctx.close().catch(() => {});
  await dos.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser support walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SUPPORT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

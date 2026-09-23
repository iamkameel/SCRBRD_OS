#!/usr/bin/env node
/**
 * A duty's authority, from a browser. SCRBRD-034's screen.
 *
 * tools/smoke-duties.mjs proves the link, the pause and the lift over HTTP.
 * This walk drives the controls on the Officials screen that call them, as
 * the person they are for and as somebody they are not for:
 *
 *   1. The school office links a scorer's appointment to its authority,
 *      suspends it — and cannot until it has said why — and lifts it again,
 *      each time seeing the state the database now holds.
 *   2. A coach who reads the same fixture sees THAT the duty is suspended,
 *      is offered no control, and is never shown the office's reason.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-duties.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 4354;
const API_PORT = 8854;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const REASON = "Scorebook queried by the opposition";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-duties-secret",
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
const browser = await chromium.launch({ ...launchOptions() });

async function open() {
  const ctx = await browser.newContext();
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [], reasons = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  page.on("response", async (r) => {
    if (!r.url().includes("/api/read/duty_suspensions")) return;
    try { reasons.push(...((await r.json())?.rows ?? []).map((x) => x.reason)); } catch { /* not json */ }
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, reasons };
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
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}
async function nav(page, id) {
  const l = tid(page, `nav-${id}`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return true;
}
/** Officials → the named person's card. */
async function openOfficial(page, name) {
  if (!(await nav(page, "officials"))) return false;
  const b = page.locator("button", { hasText: name }).first();
  if (!(await b.count())) return false;
  await b.click({ timeout: 6000 });
  await page.waitForTimeout(800);
  return true;
}
const panel = (page, dutyId) => page.locator(`[data-testid="duty-authority"][data-duty="${dutyId}"]`);
const stateOf = async (page, dutyId) => (await panel(page, dutyId).count())
  ? panel(page, dutyId).first().getAttribute("data-state") : null;
const settle = async (page, dutyId, want) => {
  for (let i = 0; i < 20; i++) {
    if ((await stateOf(page, dutyId)) === want) return true;
    await page.waitForTimeout(250);
  }
  return false;
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // A scorer with an account and an appointment, written as the owner the way
  // the seed writes appointments. The screen does the rest.
  const stamp = Date.now();
  const name = `W Browser ${stamp}`;
  const scorerId = (await dbq(
    `insert into app_user (school_id, email, name, role) values ($1, $2, $3, 'scorer') returning id`,
    [HIL, `duty-browser-${stamp}@example.invalid`, name]))[0].id;
  const m = (await dbq(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Browser Duty XI', now() + interval '5 days','T20',20,'scheduled') returning id`, [HIL]))[0].id;
  const D = (await dbq(
    `insert into match_official (match_id, school_id, duty, person_name, person_id)
     values ($1, $2, 'scorer', $3, $4) returning id`, [m, HIL, name, scorerId]))[0].id;

  group("1. The school office links, suspends with a reason, and lifts");
  const office = await open();
  ok("the registrar signs in", await signIn(office.page, "registrar@example.invalid"));
  ok("...opens Officials and the scorer's card", await openOfficial(office.page, name));
  ok("the appointment is drawn unlinked, with a link control",
     (await stateOf(office.page, D)) === "unlinked" && (await tid(office.page, "duty-link").count()) >= 1);
  await panel(office.page, D).locator('[data-testid="duty-link"]').click({ timeout: 6000 });
  ok("linking it draws it linked", await settle(office.page, D, "linked"));
  const [link] = await dbq(`select assignment_id from match_official where id = $1`, [D]);
  ok("...and the database holds the link", !!link?.assignment_id);

  await panel(office.page, D).locator('[data-testid="duty-suspend"]').click({ timeout: 6000 });
  const confirm = panel(office.page, D).locator('[data-testid="duty-confirm"]');
  ok("suspending asks why, and cannot be sent blank", await confirm.isDisabled());
  await panel(office.page, D).locator('[data-testid="duty-reason"]').fill(REASON);
  await confirm.click({ timeout: 6000 });
  ok("with a reason, it is drawn suspended", await settle(office.page, D, "suspended"));
  await office.page.waitForTimeout(800);
  ok("...the office sees its own reason", (await text(office.page)).includes(REASON));
  const [open1] = await dbq(`select reason, suspended_by from duty_suspension where duty_id = $1 and lifted_at is null`, [D]);
  ok("...and the database holds it, with who", open1?.reason === REASON && !!open1?.suspended_by, JSON.stringify(open1));

  group("2. A coach sees that it is suspended, is offered nothing, and is not told why");
  const coach = await open();
  ok("the 1st XI coach signs in", await signIn(coach.page, "coach@example.invalid"));
  ok("...and opens the same card", await openOfficial(coach.page, name));
  ok("the duty is drawn suspended", (await stateOf(coach.page, D)) === "suspended");
  ok("...with no control to link, suspend or lift",
     (await tid(coach.page, "duty-link").count()) + (await tid(coach.page, "duty-suspend").count())
       + (await tid(coach.page, "duty-lift").count()) === 0);
  ok("...and without the office's reason, on screen or on the wire",
     !(await text(coach.page)).includes(REASON) && !coach.reasons.includes(REASON));
  ok("no page errors for the coach", coach.errors.length === 0, coach.errors.join(" | "));
  await coach.ctx.close();

  await panel(office.page, D).locator('[data-testid="duty-lift"]').click({ timeout: 6000 });
  const lift = panel(office.page, D).locator('[data-testid="duty-confirm"]');
  ok("lifting asks why too", await lift.isDisabled());
  await panel(office.page, D).locator('[data-testid="duty-reason"]').fill("Checked, no fault");
  await lift.click({ timeout: 6000 });
  ok("lifted, it is drawn linked again", await settle(office.page, D, "linked"));
  const [closed] = await dbq(`select lift_reason, lifted_by from duty_suspension where duty_id = $1`, [D]);
  ok("...and the database closed the record with who and why",
     closed?.lift_reason === "Checked, no fault" && !!closed?.lifted_by, JSON.stringify(closed));
  ok("no page errors for the office", office.errors.length === 0, office.errors.join(" | "));
  await office.ctx.close();
} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (apiErr.length) console.log(apiErr.join("").slice(-1500));
} finally {
  await browser.close().catch(() => {});
  await pool.end().catch(() => {});
  apiProc.kill();
  web.close();
  console.log("\n" + "─".repeat(52));
  console.log(`BROWSER DUTIES: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

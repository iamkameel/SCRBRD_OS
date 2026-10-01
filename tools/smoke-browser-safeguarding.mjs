#!/usr/bin/env node
/**
 * Safeguarding, phase 1, from a browser (db/57; SAFEGUARDING_DSO §8, §9.1).
 *
 * tools/smoke-safeguarding.mjs proves the routes. This drives the screen a
 * person actually uses, and asks what curl cannot:
 *
 *   1. A parent finds Safeguarding in the menu, is shown the school's DSO by
 *      name, is told in words that the report is confidential and NOT
 *      anonymous, is offered The Guardian's app for that, raises a concern,
 *      and is shown the receipt — a reference and a time — and nothing else.
 *   2. The DSO finds it in her inbox, on its 24-hour clock, opens it and reads
 *      the account and who raised it, and adds to the record.
 *   3. A coach at the same school sees no inbox, no concern and no notice.
 *   4. Nothing on those screens is set under 12px, nothing pressed is under
 *      44px, and the page draws in Daylight as well as Floodlit.
 *
 * Falsified by drawing the inbox for everyone (SafeguardingView.jsx's isDso
 * gate set true): the parent's and the coach's "no inbox" went red. What the
 * inbox would hold for them is the server's (smoke-safeguarding.mjs, which
 * went red six times with safeguarding.concern.read granted to principal).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-safeguarding.mjs
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

const WEB_PORT = port(4358);
const API_PORT = port(8858);
const API = `http://127.0.0.1:${API_PORT}`;
const GUARDIAN = "https://guardian.example.invalid/report";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const ACCOUNT = "He told me the older boys lock him in the kit room after nets and he is scared to go back.";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-safeguarding-secret", GUARDIAN_APP_URL: GUARDIAN,
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
const browser = await chromium.launch({ ...launchOptions() });

async function open(theme = "floodlit") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
  // A shell: the staff one, or a parent's or a pupil's app (step 4), whose header is the persona bar.
  return /Match Centre|Dashboard/i.test(await text(page)) || (await page.locator('[data-testid="persona-bar"]').count()) === 1;
}
async function toSafeguarding(page) {
  const l = tid(page, "nav-safeguarding").first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return (await tid(page, "safeguarding").count()) > 0;
}
/** Every text node under the page, and every control, measured as drawn. */
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of el.querySelectorAll("*")) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type)) || (n.tagName === "A" && n.getAttribute("href"))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, bg: getComputedStyle(document.body).backgroundColor };
  });
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`).then((x) => x.json()); if (r?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── 1. A parent raises a concern ────────────────────────────────
  group("A parent raises a concern, and keeps a reference");
  const parent = await open();
  ok("the parent signs in", await signIn(parent.page, "parent@example.invalid"));
  ok("Safeguarding is in his menu, and opens", await toSafeguarding(parent.page));
  const card = await tid(parent.page, "sg-dso-card").innerText().catch(() => "");
  ok("the card names Hilton's DSO", /N Dube/.test(card), card.slice(0, 200));
  ok("...and offers The Guardian's app for an anonymous report",
     (await tid(parent.page, "sg-guardian").first().getAttribute("href").catch(() => null)) === GUARDIAN);
  ok("a parent is shown no inbox", (await tid(parent.page, "sg-inbox").count()) === 0);
  const f = await floors(parent.page, "safeguarding");
  ok("nothing on the page is set under 12px", f.small.length === 0, f.small.slice(0, 4).join(" · "));
  ok("nothing pressed on it is under 44px", f.tiny.length === 0, f.tiny.slice(0, 4).join(" · "));

  ok("he opens the form", await click(parent.page, /^Raise a concern$/));
  const honesty = await tid(parent.page, "sg-honesty").innerText().catch(() => "");
  ok("the form says, in words, that it is confidential and not anonymous",
     /confidential, not anonymous/i.test(honesty) && /DSO will know it came from you/i.test(honesty), honesty);
  const ff = await floors(parent.page, "sg-form");
  ok("the form has no type under 12px", ff.small.length === 0, ff.small.slice(0, 4).join(" · "));
  ok("...and no control under 44px", ff.tiny.length === 0, ff.tiny.slice(0, 4).join(" · "));
  await tid(parent.page, "sg-about-child").click();
  await tid(parent.page, "sg-nature-bullying").click();
  await tid(parent.page, "sg-certainty-suspicion").click();
  await tid(parent.page, "sg-how-told").click();
  await tid(parent.page, "sg-account").fill(ACCOUNT);
  ok("he sends it", await click(parent.page, /^Send to the DSO$/, 6000));
  await parent.page.waitForTimeout(1500);
  const sent = await tid(parent.page, "sg-sent").innerText().catch(() => "");
  const reference = (await tid(parent.page, "sg-reference").innerText().catch(() => "")).trim();
  ok("he is told it was received, with a reference", /Received\. The DSO has it\./.test(sent) && /^SG-[0-9A-Z]{4}-\d{4}$/.test(reference), sent);
  ok("...and nothing about who has it or what happens next", !/N Dube|inbox|assigned|clock/i.test(sent), sent);
  const [{ n: held }] = (await pool.query(
    `select count(*)::int n from safeguarding_concern c join safeguarding_concern_reporter r on r.concern_id = c.id
       join app_user u on u.id = r.reporter_id where c.reference = $1 and u.email = 'parent@example.invalid' and c.account = $2`,
    [reference, ACCOUNT])).rows;
  ok("the database holds it, as his, word for word", held === 1);
  await click(parent.page, /^Done$/);
  await parent.page.waitForTimeout(1200);
  ok("his page now lists the reference he raised", (await tid(parent.page, "sg-receipts").innerText().catch(() => "")).includes(reference));
  ok("no page error for the parent", parent.errors.length === 0, parent.errors.join(" | "));
  await parent.ctx.close();

  // ── 2. The DSO sees it ──────────────────────────────────────────
  group("The DSO finds it in her inbox and opens it");
  const dso = await open();
  ok("the DSO signs in", await signIn(dso.page, "dso@example.invalid"));
  ok("Safeguarding opens for her", await toSafeguarding(dso.page));
  await dso.page.waitForTimeout(800);
  const row = dso.page.locator(`[data-testid="sg-inbox-row"][data-reference="${reference}"]`);
  ok("the parent's concern is in her inbox", (await row.count()) === 1);
  ok("...on a 24-hour clock, not overdue",
     /of 24/.test(await row.innerText().catch(() => "")) && (await row.locator('[data-testid="sg-clock"]').getAttribute("data-overdue")) === "false");
  ok("...with no name in the list", !/Pillay|D Pillay/.test(await row.innerText().catch(() => "")));
  await row.click();
  await dso.page.waitForTimeout(1500);
  const record = await tid(dso.page, "sg-concern").innerText().catch(() => "");
  ok("she reads the account as written", (await tid(dso.page, "sg-account-read").innerText().catch(() => "")) === ACCOUNT);
  ok("...and who raised it", /D Pillay/.test(record), record.slice(0, 300));
  await tid(dso.page, "sg-note-body").fill("Spoke to the boy with his father. Kit room now locked after nets.");
  ok("she adds to the record", await click(dso.page, /^Add to the record$/));
  await dso.page.waitForTimeout(1200);
  ok("...and it is there", /Kit room now locked after nets/.test(await tid(dso.page, "sg-notes").innerText().catch(() => "")));
  const fd = await floors(dso.page, "sg-concern");
  ok("the concern page has no type under 12px and no control under 44px", fd.small.length === 0 && fd.tiny.length === 0,
     [...fd.small, ...fd.tiny].slice(0, 4).join(" · "));
  ok("no page error for the DSO", dso.errors.length === 0, dso.errors.join(" | "));
  await dso.ctx.close();

  // ── 3. A coach sees nothing ─────────────────────────────────────
  group("A coach at the same school sees nothing of it");
  const coach = await open();
  ok("the coach signs in", await signIn(coach.page, "coach@example.invalid"));
  ok("Safeguarding opens for him too — he may raise one", await toSafeguarding(coach.page));
  await coach.page.waitForTimeout(800);
  ok("...but there is no inbox", (await tid(coach.page, "sg-inbox").count()) === 0);
  const page = await text(coach.page);
  ok("...no reference and no account anywhere on it", !page.includes(reference) && !page.includes("kit room"));
  const alerts = await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "coach@example.invalid", deviceId: "b-sg" }) }).then((r) => r.json())
    .then(({ token }) => fetch(`${API}/api/read/notifications`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json()));
  ok("...and no safeguarding notice", !(alerts?.rows ?? []).some((n) => n.kind === "safeguarding"));
  await coach.ctx.close();

  // ── 4. Daylight ─────────────────────────────────────────────────
  group("The page in Daylight");
  const day = await open("daylight");
  ok("the parent signs in again", await signIn(day.page, "parent@example.invalid"));
  ok("Safeguarding opens in Daylight", await toSafeguarding(day.page));
  const theme = await day.page.evaluate(() => document.documentElement.dataset.theme);
  const fl = await floors(day.page, "safeguarding");
  ok("the theme is Daylight and the page is light", theme === "daylight" && /rgb\((2[0-9]{2}|1[89][0-9]), /.test(fl.bg), `${theme} ${fl.bg}`);
  ok("...with the same floors", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].slice(0, 4).join(" · "));
  ok("no page error in Daylight", day.errors.length === 0, day.errors.join(" | "));
  await day.ctx.close();
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.message);
} finally {
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nBROWSER SAFEGUARDING: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

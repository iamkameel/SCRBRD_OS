#!/usr/bin/env node
/**
 * The rulebook's clauses, and the workload monitor citing them. SCRBRD-041.
 *
 * Before this the Training screen's load panel printed "U13 · 5/10" beside a
 * boy's name and the rulebook was a page of text hard-coded in the client,
 * none of which said where 5 and 10 came from. db/32 stores the clauses and
 * has every bowling_directive row name the one it enforces; this walk drives
 * both screens in a real browser against the seeded database and asks:
 *
 *   1. Does the rulebook draw the server's clauses — grouped by category,
 *      each with its severity, the age bands it applies to, and the figures
 *      joined from the directive — rather than the hard-coded crib alone?
 *   2. Does the load panel, for a REAL SEEDED bowler (B Khumalo, a U13A
 *      medium-pacer in db/98), cite the U13 clause by code and title beside
 *      his 5/10, and open its text when asked?
 *   3. Does a boy under no limit (S Naidoo, the seed's left-arm spinner)
 *      carry no citation — the screen not claiming a rule applies to him?
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-rulebook.mjs
 *   BROWSER_RULEBOOK_DEBUG=1 node tools/smoke-browser-rulebook.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 4351;
const API_PORT = 8851;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_RULEBOOK_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";   // 1XI, left-arm spin in db/98

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-rulebook-secret",
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
const browser = await chromium.launch({ ...launchOptions() });

async function open() {
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
async function signIn(page, who) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await click(page, who, 4000);
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

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // The seeded medium-pacer, found by name so the walk does not restate a
  // uuid the seed generates.
  const KHUMALO = (await pool.query(`select id from player where full_name = 'B Khumalo'`)).rows[0]?.id;
  ok("the seed has B Khumalo, a U13 medium-pacer",
     !!KHUMALO && (await pool.query(`select age_band(born) b, bowling_style s from player where id = $1`, [KHUMALO])).rows[0]?.b === "U13");

  group("The director of sport opens the rulebook");
  const dos = await open();
  ok("the director of sport signs in", await signIn(dos.page, /sarah@example\.invalid|Director/));
  ok("the rulebook opens", await nav(dos.page, "rulebook"));
  await dos.page.waitForTimeout(800);
  const book = await tid(dos.page, "rulebook").innerText().catch(() => "");
  if (DEBUG) console.log("[debug] rulebook:\n" + book.slice(0, 1500));
  ok("Medical & Safety is offered as a category of platform clauses",
     await tid(dos.page, "rulebook-tab-cat:Medical & Safety").count() === 1);
  ok("...and opens by default, drawn from the server",
     await dos.page.locator('[data-testid="rulebook-category"][data-category="Medical & Safety"]').count() === 1);
  const cards = await dos.page.locator('[data-testid="rulebook-category"] [data-testid^="clause-PACE-"]').evaluateAll(
    (els) => els.map((e) => e.dataset.testid));
  ok("all seven clauses are drawn, in the server's order",
     cards.join() === "clause-PACE-SCOPE,clause-PACE-COUNT,clause-PACE-U13,clause-PACE-U14-U15,clause-PACE-U16,clause-PACE-OPEN,clause-PACE-DOB",
     cards.join());
  const u13 = await tid(dos.page, "clause-PACE-U13").innerText().catch(() => "");
  ok("the U13 clause carries its title and severity", /Pace bowling limits: U13/.test(u13) && /mandatory/i.test(await tid(dos.page, "clause-severity-PACE-U13").innerText()));
  ok("...the band it applies to", (await tid(dos.page, "clause-ages-PACE-U13").innerText()).trim() === "U13");
  ok("...and the directive's figures, joined rather than typed into the text",
     /U13: 5 overs a spell, 10 a day/.test(await tid(dos.page, "clause-limits-PACE-U13").innerText()));
  ok("the shared clause names both bands and both sets of figures",
     /U14[\s\S]*U15/.test(await tid(dos.page, "clause-ages-PACE-U14-U15").innerText())
     && /U14: 6 overs a spell, 12 a day · U15: 6 overs a spell, 12 a day/.test(await tid(dos.page, "clause-limits-PACE-U14-U15").innerText()));
  ok("the Open clause is a guideline with no platform limit",
     /guideline/i.test(await tid(dos.page, "clause-severity-PACE-OPEN").innerText())
     && /Open: no platform limit/.test(await tid(dos.page, "clause-limits-PACE-OPEN").innerText()));
  ok("each clause says where it comes from, and does not pass itself off as official wording",
     /Not official wording/.test(u13));
  ok("the Laws crib is still there, labelled reference only", /Laws summary/i.test(book) && await tid(dos.page, "rulebook-tab-scoring").count() === 1);
  await tid(dos.page, "rulebook-tab-scoring").click();
  await dos.page.waitForTimeout(300);
  ok("...and choosing it swaps the clauses out", await tid(dos.page, "clause-PACE-U13").count() === 0
     && /Scoring & Run Counting/.test(await tid(dos.page, "rulebook").innerText()));

  group("The load panel cites the clause beside a real seeded bowler's limit");
  ok("the Training screen opens", await nav(dos.page, "training"));
  await dos.page.waitForTimeout(1000);
  ok("the load panel is drawn for the director of sport", await tid(dos.page, "load-panel").count() === 1);
  const row = await tid(dos.page, `load-row-${KHUMALO}`).innerText().catch(() => "");
  if (DEBUG) console.log("[debug] Khumalo row:\n" + row);
  ok("B Khumalo's row reads U13 · 5/10", /B Khumalo/.test(row) && /U13 · 5\/10/.test(row), row);
  const cite = tid(dos.page, `load-clause-${KHUMALO}`);
  ok("...with PACE-U13 and its title beside it",
     (await cite.innerText().catch(() => "")).trim() === "PACE-U13 · Pace bowling limits: U13");
  ok("...its text closed until asked for", await tid(dos.page, `load-clause-text-${KHUMALO}`).count() === 0);
  await cite.click();
  await dos.page.waitForTimeout(300);
  const body = await tid(dos.page, `load-clause-text-${KHUMALO}`).innerText().catch(() => "");
  ok("...and opened, the clause's own text and severity", /pace bowler in the U13 band/.test(body) && /Mandatory/.test(body), body.slice(0, 200));
  ok("...the button says it is expanded", (await cite.getAttribute("aria-expanded")) === "true");
  await cite.click();
  await dos.page.waitForTimeout(300);
  ok("...and closes again", await tid(dos.page, `load-clause-text-${KHUMALO}`).count() === 0);

  ok("a spinner's row is drawn", await tid(dos.page, `load-row-${NAIDOO}`).count() === 1);
  ok("...and cites no clause, because no limit applies to him", await tid(dos.page, `load-clause-${NAIDOO}`).count() === 0);

  ok("no console errors on the director of sport's session", dos.errors.length === 0, dos.errors.join(" | "));
  await dos.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser rulebook walk threw: ${e.message?.slice(0, 160)}`, false);
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
console.log(`\n${"─".repeat(52)}\nBROWSER RULEBOOK SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

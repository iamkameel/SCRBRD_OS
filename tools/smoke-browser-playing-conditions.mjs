#!/usr/bin/env node
/**
 * A competition's playing conditions in a real browser (SCRBRD-114, phase 1),
 * against a real API and Postgres:
 *
 *   A  the league publishes a version (over the API; its screen is a later
 *      build): 25 overs, no free hit (unconfirmed), one over a bowler (cited);
 *   B  the director of sport arranges a fixture in the league: the form
 *      offers only the competitions his side entered, and choosing one
 *      pre-fills the format and overs from the version in force that day;
 *      the fixture is stored in the league;
 *   C  the scorer opens it on the pad, at a phone's 390 × 844: the pad says
 *      the conditions in words (no free hit; one over a bowler) and the
 *      bowler on against the cap; the no-ball offers no free hit; the bowled
 *      after it stands — on the board, in the API's live score, and in the
 *      document the first event fixed; and at the over's end the new-over
 *      sheet says the bowler has bowled his over, and still lets him be
 *      chosen (never a refusal, D1).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-playing-conditions.mjs
 *   BROWSER_PC_DEBUG=1 node tools/smoke-browser-playing-conditions.mjs
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

const WEB_PORT = port(5391);
const API_PORT = port(8891);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const DEBUG = !!process.env.BROWSER_PC_DEBUG;
const DIST = process.env.PC_DIST || "apps/web/dist";
const LEAGUE = "99999999-0000-0000-0000-000000000001";
const OPPONENT = "Conditions Walk XI";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-playing-conditions-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  let body, type;
  try {
    const f = join(DIST, url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = TYPES[extname(f)] ?? "application/octet-stream";
  } catch {
    body = await readFile(join(DIST, "index.html"));
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, r));

const pool = new pg.Pool({ connectionString: DB });
const dbq = async (text, params) => (await pool.query(text, params)).rows;
const call = async (path, { method = "GET", token, body } = {}) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
                                       body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const devLogin = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: `pc-walk-${email}` } })).body?.token;

const browser = await chromium.launch({ ...launchOptions() });
async function open(viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
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
async function nav(page, label) {
  const l = page.locator("nav button", { hasText: label }).first();
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
  const [{ today, d1, d3 }] = await dbq(`select sa_today()::text as today, (sa_today() + 2)::text as d1, (sa_today() + 3)::text as d3`);
  if (DEBUG) console.log("[debug] today", today, "version from", d1, "fixture on", d3);

  // ── A ──────────────────────────────────────────────────────────
  group("A. The league publishes its conditions (over the API)");
  const league = await devLogin("league@example.invalid");
  const v = await call(`/api/competitions/${LEAGUE}/playing-conditions`, { method: "POST", token: league,
    body: { title: "KZN Schools T20 2026/27", effectiveFrom: d1 } });
  const S = v.body?.setId;
  const enter = (body) => call(`/api/condition-sets/${S}/values`, { method: "POST", token: league, body });
  const entered = [
    await enter({ key: "format.kind", value: "limited", status: "unconfirmed" }),
    await enter({ key: "format.overs_per_innings", value: 25, status: "unconfirmed" }),
    await enter({ key: "format.free_hit", value: false, status: "unconfirmed" }),
    await enter({ key: "bowling.max_overs_per_bowler_innings", value: 1, status: "confirmed",
                  sourceDocument: "KZN Schools T20 bye-laws 2026/27", sourceClause: "7.3", sourceDate: today }),
  ];
  const pub = await call(`/api/condition-sets/${S}/publish`, { method: "POST", token: league });
  ok("a version from day +2: 25 overs, no free hit, one over a bowler — published",
     !!S && entered.every((e) => e.body?.ok) && pub.body?.ok === true, JSON.stringify(pub.body));

  // ── B ──────────────────────────────────────────────────────────
  group("B. The director of sport arranges a fixture in the league, pre-filled from it");
  const dos = await open();
  ok("the director of sport signs in", await signIn(dos.page, /sarah@example\.invalid|Director/));
  ok("Match Centre opens", await nav(dos.page, /Match Centre/));
  ok("Schedule Match is offered", await click(dos.page, /\+ Schedule Match/, 4000));
  await dos.page.waitForTimeout(500);
  await dos.page.locator("select").first().selectOption("1XI");
  await dos.page.waitForTimeout(1200);   // the side's competitions are fetched
  const comp = dos.page.locator('[data-testid="fixture-competition"]');
  ok("the form offers the competitions the 1st XI entered, beside a friendly", (await comp.count()) === 1
     && /KZN Schools T20 League/.test(await comp.innerText().catch(() => "")) && /A friendly/.test(await comp.innerText().catch(() => "")));
  await dos.page.locator('input[placeholder="e.g. Michaelhouse 1st XI"]').fill(OPPONENT);
  await dos.page.locator('input[type="date"]').first().fill(d3);
  await comp.selectOption({ label: "KZN Schools T20 League" });
  await dos.page.waitForTimeout(1200);   // the version in force that day is read
  const note = await dos.page.locator('[data-testid="fixture-prefill"]').innerText().catch(() => "");
  ok("choosing it pre-fills the format and overs, and says from which version", /KZN Schools T20 2026\/27 v1/.test(note), note);
  const overs = await dos.page.locator('input[type="number"]').first().inputValue().catch(() => "");
  const format = await dos.page.locator('[data-testid="fixture-format"]').inputValue().catch(() => "");
  ok("...T20 at 25 overs", format === "T20" && overs === "25", `${format} ${overs}`);
  ok("the preview says so", /T20 · 25 overs/.test(await dos.page.locator('[data-testid="fixture-preview"]').innerText()));
  ok("he arranges it", await click(dos.page, /Arrange Fixture/, 4000));
  await dos.page.waitForTimeout(1500);
  const [m] = await dbq(`select id, competition_id, format, overs from match where opponent = $1`, [OPPONENT]);
  ok("the fixture is stored in the league, at 25 overs", m?.competition_id === LEAGUE && m?.overs === 25 && m?.format === "T20", JSON.stringify(m));
  ok("no console errors (director of sport)", dos.errors.length === 0, dos.errors.join(" | "));
  await dos.ctx.close().catch(() => {});

  // ── C ──────────────────────────────────────────────────────────
  group("C. The pad says the conditions; the bowled after a no-ball stands; the cap is words");
  const MATCH = m?.id;
  // The home side won the toss and bowls: its bowlers are the 1XI players.
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bowl' from match where id = $1 on conflict (match_id) do nothing`, [MATCH]);
  const sc = await open();
  const page = sc.page;
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const tap = async (id, ms = 4000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(350); };
  const has = async (id) => (await tid(id).count()) > 0;
  const said = async (id) => ((await tid(id).first().innerText({ timeout: 2000 }).catch(() => "")) || "").trim();
  let batterNo = 0;
  const typeBatter = async () => {
    const f = page.locator('input[aria-label="Player name"]');
    if (!(await f.count())) return false;
    batterNo++; await f.fill(`Batter ${batterNo}`);
    await page.locator('[role="dialog"] button:not([disabled])', { hasText: /^Go$/ }).first().click({ timeout: 2000 });
    await page.waitForTimeout(500);
    return true;
  };
  ok("the scorer signs in", await signIn(page, /Scorer/));
  await nav(page, /Match Centre/);
  const opened = await page.evaluate((opp) => {
    const isBtn = (b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "");
    for (const b of [...document.querySelectorAll("button")].filter(isBtn)) {
      let card = b;
      while (card.parentElement && [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) card = card.parentElement;
      if ((card.textContent || "").includes(opp)) { b.click(); return true; }
    }
    return false;
  }, OPPONENT);
  ok("the league fixture offers the scorer", opened);
  await page.waitForTimeout(2500);
  await page.setViewportSize({ width: 390, height: 844 });
  let bowlerPicked = false;
  for (let i = 0; i < 8; i++) {
    if (await has("scoring-blocked-fix") && !(await page.locator('[role="dialog"]').count())) await tap("scoring-blocked-fix").catch(() => {});
    if (await typeBatter()) continue;
    if (/Opening Bowler/i.test(await text(page))) {
      const b = page.locator('[role="dialog"] button:not([disabled])', { hasText: "T Bekker" }).first();
      if (await b.count()) { await b.click({ timeout: 2000 }); await page.waitForTimeout(500); bowlerPicked = true; }
      break;
    }
    await page.waitForTimeout(400);
  }
  ok("the opening bowler is chosen", bowlerPicked);
  if (!(await has("basic-pad"))) { await tap("pad-menu").catch(() => {}); await tap("pad-basic-scoring").catch(() => {}); }
  const words = await said("pad-conditions");
  ok("the pad says the conditions: the version, no free hit (unconfirmed), one over a bowler",
     /KZN Schools T20 2026\/27 v1/.test(words) && /No free hit in this match \(unconfirmed\)/.test(words) && /1 over a bowler/.test(words)
     && !/1 over a bowler \(unconfirmed\)/.test(words), words);
  ok("...and the bowler on against the cap", /T Bekker: Has 1 over left \(1 an innings\)/.test(await said("pad-bowler-cap")), await said("pad-bowler-cap"));

  await tap("key-noball");
  ok("the no-ball offers no free hit", !(await has("nb-free-hit")));
  await tap("extra-run-0");
  await tap("key-wicket");
  await tap("wicket-mode-bowled");
  await tap("wicket-confirm");
  await page.waitForTimeout(800);
  ok("the bowled after the no-ball stands: the next batter is asked for", await typeBatter());
  for (let i = 0; i < 5; i++) { await tap("run-0", 3000); await page.waitForTimeout(150); }
  await page.waitForTimeout(2800);
  const [live] = await dbq(`select wickets, legal_balls from match_live_score where match_id = $1 and innings = 0`, [MATCH]);
  ok("the API's live score has the wicket: no free hit in this league", Number(live?.wickets) === 1 && Number(live?.legal_balls) === 6, JSON.stringify(live));
  const [fixed] = await dbq(`select set_version, doc->'play'->>'format.free_hit' as fh from match_conditions where match_id = $1`, [MATCH]);
  ok("the first event fixed the document: version 1, no free hit", fixed?.set_version === 1 && fixed?.fh === "false", JSON.stringify(fixed));
  ok("the over is done: the new-over sheet", /Over 1 Complete/i.test(await text(page)));
  const bekker = page.locator('[data-testid="bowler-choice"]', { hasText: "T Bekker" }).first();
  ok("it says T Bekker has bowled his one over", /Has bowled his 1 over/.test(await bekker.innerText().catch(() => "")), await bekker.innerText().catch(() => ""));
  ok("...and does not grey him out for it (he may not bowl two in a row, which is the Law's, not the cap's)",
     !/conditions/i.test(await bekker.locator('[data-testid="bowler-unavailable"]').innerText().catch(() => "")));
  ok("no console errors (scorer)", sc.errors.length === 0, sc.errors.join(" | "));
  await sc.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser playing-conditions walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 8).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER PLAYING-CONDITIONS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

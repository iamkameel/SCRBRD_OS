#!/usr/bin/env node
/**
 * The scorer's home (GA-I13), in a real browser against the real server,
 * checked against Postgres and IndexedDB:
 *
 *   A. A scorer signs in and lands on his home, not the day sheet. Nothing
 *      on this device to resume. His fixtures: the one he is APPOINTED to
 *      first (a scorer duty naming him, db/34), though it is days later than
 *      the others; then his side's fixtures by start. A live fixture another
 *      device is scoring says so, and offers the pad (whose take-over is the
 *      route), not a claim. Before the toss of the next fixture: the team
 *      sheet missing, with the coach to set it; the ground; the rest.
 *   B. He starts a fixture: the pad claims it. Back home, the fixture says
 *      it is scoring on this device.
 *   C. No signal: he answers the toss and scores; every event is queued on
 *      the phone, none reaches the server. Back home, "Resume on this device"
 *      counts what is still to send — the outbox's own count.
 *   D. Reloaded with no signal (the token is gone with the reload): the
 *      home opens again, the Resume card is still there with the same count,
 *      and one tap reopens the pad on the same score.
 *   E. A scorer with no fixture: both sections say so, each in its own words.
 *   F. A coach, who also scores, keeps the day sheet.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-scorer-home.mjs
 *   BROWSER_SCORER_HOME_DEBUG=1 node tools/smoke-browser-scorer-home.mjs
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

const WEB_PORT = port(5313);
const API_PORT = port(8816);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const DEBUG = !!process.env.BROWSER_SCORER_HOME_DEBUG;
const HIL = "11111111-1111-1111-1111-111111111111";
const GROUND = "ffffffff-0000-0000-0000-000000000001";
const COACH_ID = "88888888-0000-0000-0000-000000000004";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-scorer-home-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));

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
const errors = [];

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await offline(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page };
}

const made = { matches: [], users: [], sessions: [] };

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── The walk's own fixtures, written as the owner, as the seed writes them ──
  const scorer = (await dbq(`select id, name from app_user where email = 'scorer@example.invalid'`))[0];
  const fixture = async (opponent, startsSql, status = "scheduled") => {
    const id = (await dbq(
      `insert into match (school_id, team_code, opponent, ground_id, starts_at, format, overs, status)
       values ($1, '1XI', $2, $3, ${startsSql}, 'T20', 20, $4) returning id`, [HIL, opponent, GROUND, status]))[0].id;
    made.matches.push(id);
    return id;
  };
  // Appointed, and LATER than both of the others: it must still come first.
  const APPT = await fixture("Home Walk Appointed XI", "now() + interval '6 days'");
  await dbq(`insert into match_official (match_id, school_id, duty, person_name, person_id) values ($1, $2, 'scorer', $3, $4)`,
    [APPT, HIL, scorer.name, scorer.id]);
  // Live, and another device holds the token with a lease that outlasts the walk.
  const OTHER = await fixture("Home Walk Other Device XI", "now() - interval '1 hour'", "live");
  await dbq(`insert into scoring_session (match_id, school_id, state, epoch, holder_user_id, holder_device, lease_until)
             values ($1, $2, 'active', 1, $3, 'dev-another-phone', now() + interval '2 hours')`, [OTHER, HIL, COACH_ID]);
  made.sessions.push(OTHER);
  // Today, later on: the one he scores.
  const MINE = await fixture("Home Walk Resume XI", "now() + interval '2 hours'");

  const S = await open();
  const { page, ctx } = S;
  const reads = [];
  page.on("request", (r) => { if (r.url().startsWith(API)) reads.push(new URL(r.url()).pathname); });
  const text = () => page.$eval("body", (el) => el.innerText).catch(() => "");
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const attr = (id, a) => tid(id).first().getAttribute(a, { timeout: 1500 }).catch(() => null);
  const until = async (fn, ms = 12000, step = 300) => {
    for (let t = 0; t < ms; t += step) { if (await fn()) return true; await page.waitForTimeout(step); }
    return !!(await fn());
  };
  const tap = async (id, ms = 450) => { await tid(id).first().click({ timeout: 5000 }); await page.waitForTimeout(ms); };
  const click = async (re, ms = 3000) => {
    const l = page.locator("button:not([disabled])", { hasText: re }).first();
    if (!(await l.count())) return false;
    try { await l.click({ timeout: ms }); } catch { return false; }
    await page.waitForTimeout(300);
    return true;
  };
  const outbox = () => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("scrbrd-outbox", 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("queue")) req.result.createObjectStore("queue"); };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      const g = db.transaction("queue", "readonly").objectStore("queue").getAllKeys();
      g.onsuccess = () => { db.close(); resolve(g.result); };
      g.onerror = () => { db.close(); resolve(null); };
    };
  }));
  const board = async () => {
    const l = page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / }).first();
    if (!(await l.count())) return "";
    return ((await l.textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
  };
  /** Answer the pad's openers and bowler sheets, then the one-tap pad. */
  let named = 0;
  const onPad = async () => {
    for (let i = 0; i < 12; i++) {
      const body = await text();
      if (/Available to Bat|Batting Order/i.test(body)) {
        const nameField = page.locator('input[aria-label="Player name"]');
        if (await nameField.count()) { named++; await nameField.fill(`Batter ${named}`).catch(() => {}); await nameField.press("Enter").catch(() => {}); await page.waitForTimeout(500); continue; }
      }
      if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
        const field = page.locator("input[placeholder*='name' i], input[placeholder*='Search bowler' i]").last();
        if (await field.count()) {
          await field.fill("B Botha").catch(() => {});
          await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(600);
          continue;
        }
      }
      break;
    }
    if (!(await tid("basic-pad").count())) {
      await tid("pad-menu").click({ timeout: 2500 }).catch(() => {});
      await tid("pad-basic-scoring").click({ timeout: 2500 }).catch(() => {});
    }
    await page.waitForTimeout(300);
    return /\bDOT\b/i.test(await text());
  };
  const score = async (face) => {
    const before = await board();
    if (!(await click(new RegExp(`^${face}$`), 2500))) return false;
    await page.waitForTimeout(600);
    return (await board()) !== before;
  };
  const home = () => until(async () => (await tid("scorer-home").count()) === 1, 10000);
  /** Leave the pad for the shell: a sheet that is up (the toss) is closed first, with Escape, as a person would. */
  const exitPad = async () => {
    for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
    await page.locator(".os-exit-scorer").first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1200);
  };

  // The service worker serves only what it fetched in control (offline-day does this).
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 }).catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  group("A. A scorer signs in and lands on his home");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  ok("he lands on the scorer's home, not the day sheet", await home() && (await tid("day-sheet").count()) === 0);
  ok("nothing on this device to resume, said as that", await until(async () => (await tid("scorer-resume-empty").count()) === 1), (await text()).slice(0, 200));
  ok("his fixtures are listed", await until(async () => (await tid(`fixture-${APPT}`).count()) === 1 && (await tid(`fixture-${MINE}`).count()) === 1));
  const order = await page.$$eval('[data-testid="scorer-fixture-list"] > li', (ls) => ls.map((l) => ({ id: l.dataset.testid.slice(8), group: l.dataset.group, state: l.dataset.state })));
  if (DEBUG) console.log("[debug] order", JSON.stringify(order));
  const at = (id) => order.findIndex((o) => o.id === id);
  ok("the fixture he is appointed to comes first, though it is six days off", order[0]?.id === APPT && order[0]?.group === "appointed", JSON.stringify(order.slice(0, 3)));
  ok("...and says so", /Appointed to score/i.test(await tid(`fixture-${APPT}-appointed`).innerText().catch(() => "")));
  ok("then his side's fixtures, by start: the live one before today's later one",
     at(OTHER) > 0 && at(OTHER) < at(MINE) && order.slice(1).every((o) => o.group === "team"), JSON.stringify(order));
  // The list draws before each fixture's scoring-session read answers: wait for
  // the state the read gives, rather than reading the first paint.
  ok("the live fixture another device holds says so", await until(async () => (await attr(`fixture-${OTHER}`, "data-state")) === "held_other"
     && /another device is scoring/.test(await tid(`fixture-${OTHER}-state`).innerText().catch(() => "")), 10000));
  ok("...and offers the pad, whose take-over is the route, not a claim from here",
     /Open the pad/.test(await tid(`fixture-${OTHER}-open`).innerText().catch(() => "")) && /hands over/.test(await tid(`fixture-${OTHER}`).innerText().catch(() => "")));
  ok("no claim was made by drawing the home",
     (await dbq(`select holder_device from scoring_session where match_id = $1`, [OTHER]))[0]?.holder_device === "dev-another-phone"
     && (await dbq(`select 1 from scoring_session where match_id = any($1::uuid[])`, [[APPT, MINE]])).length === 0);
  ok("today's fixture is not started", (await attr(`fixture-${MINE}`, "data-state")) === "not_started");
  ok("before the toss: the appointed fixture, the next to be played by him", /Appointed XI/.test(await tid("scorer-prep-match").innerText().catch(() => "")));
  ok("...no team sheet: missing, and the coach sets it",
     (await attr("prep-squad", "data-state")) === "missing" && /the coach sets this/.test(await tid("prep-squad").innerText().catch(() => "")));
  ok("...the ground is on the fixture", (await attr("prep-ground", "data-state")) === "ok");
  ok("...a friendly needs no published conditions", (await attr("prep-conditions", "data-state")) === "ok");
  const childReads = reads.filter((r) => /\/api\/read\/(players|readiness|availability|match_squad|roster_on|injuries|career)/.test(r));
  ok("nothing about a child was read for the home (no roster, sheet, availability or injury read)", childReads.length === 0, childReads.join(", "));

  group("B. He starts today's fixture: the pad claims it, and home says it is on this device");
  await tid(`fixture-${MINE}-open`).click({ timeout: 5000 });
  ok("the pad opens and asks the toss", await until(async () => (await tid("toss-sheet").count()) === 1, 10000), (await text()).slice(0, 200));
  ok("the pad claimed it", await until(async () => (await dbq(`select 1 from scoring_session where match_id = $1 and state = 'active'`, [MINE])).length === 1, 8000));
  // No resume credential on this phone (as offline-day): with no token after the reload below, nothing can send.
  await until(async () => (await dbq(`select 1 from pad_resume_credential where match_id = $1`, [MINE])).length === 1, 6000);
  await page.evaluate(() => new Promise((resolve) => { const q = indexedDB.deleteDatabase("scrbrd-pad"); q.onsuccess = q.onerror = q.onblocked = () => resolve(null); }));
  await exitPad();
  ok("back home", await home());
  ok("today's fixture: scoring on this device", await until(async () => (await attr(`fixture-${MINE}`, "data-state")) === "held_here"),
     await attr(`fixture-${MINE}`, "data-state"));
  ok("...said in words", /scoring on this device/.test(await tid(`fixture-${MINE}-state`).innerText().catch(() => "")));

  group("C. No signal: he scores, the events queue on the phone, and home counts them");
  await ctx.setOffline(true);
  await tid(`fixture-${MINE}-open`).click({ timeout: 5000 });
  ok("the pad asks the toss", await until(async () => (await tid("toss-sheet").count()) === 1, 10000));
  await tap("toss-won-home"); await tap("toss-decision-bat"); await tap("toss-confirm", 800);
  ok("on the pad", await onPad());
  let tapped = 0;
  for (const f of ["1", "4"]) if (await score(f)) tapped++;
  ok("two balls with no signal", tapped === 2, tapped);
  await page.waitForTimeout(800);
  const boardC = await board();
  const device = await page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  const queued = ((await outbox()) ?? []).filter((k) => k.startsWith(`${MINE}:${device}:evt:`)).length;
  ok("events are queued on the phone", queued >= 4, queued);
  ok("...and none reached the server", (await dbq(`select 1 from ball_event where match_id = $1`, [MINE])).length === 0);
  await exitPad();
  ok("back home", await home());
  ok("Resume on this device: today's fixture", await until(async () => (await tid(`resume-${MINE}`).count()) === 1, 8000), (await text()).slice(0, 300));
  ok(`...with what is still to send counted (${queued})`, Number(await attr(`resume-${MINE}`, "data-pending")) === queued
     && (await tid(`resume-${MINE}-pending`).innerText().catch(() => "")).startsWith(`${queued} to send`), await attr(`resume-${MINE}`, "data-pending"));
  ok("the fixture list did not answer, and says so (not 'none')",
     await until(async () => (await attr("scorer-fixtures-read", "data-state")) === "failed")
     && /Could not read/.test(await tid("scorer-fixtures-read").innerText().catch(() => "")));

  group("D. Reloaded with no signal: the Resume card is still there, and one tap reopens the pad");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  ok("the home opens again", await home(), (await text()).slice(0, 200));
  ok("Resume on this device: the same fixture, the same count", await until(async () => Number(await attr(`resume-${MINE}`, "data-pending")) === queued, 8000),
     await attr(`resume-${MINE}`, "data-pending"));
  await tap(`resume-${MINE}-open`, 2500);
  ok("one tap reopens the pad on the same score", await until(async () => (await board()) === boardC, 10000), `${await board()} v ${boardC}`);
  ok("...the toss is not asked again", (await tid("toss-sheet").count()) === 0);
  ok("...and still nothing sent", (await dbq(`select 1 from ball_event where match_id = $1`, [MINE])).length === 0);
  await ctx.setOffline(false);
  await ctx.close();

  group("E. A scorer with no fixture: each section says so in its own words");
  const stamp = Date.now();
  const lone = (await dbq(`insert into app_user (school_id, email, name, role) values ($1, $2, 'Lone Scorer', 'scorer') returning id`,
    [HIL, `lone-scorer-${stamp}@example.invalid`]))[0].id;
  made.users.push(lone);
  // Appointed to one fixture only, and it was played last week: nothing of his is today's or next.
  await dbq(`insert into role_assignment (person_id, role, school_id, team_code, fixture_id) values ($1, 'scorer', $2, null, '77777777-0000-0000-0000-000000000001')`, [lone, HIL]);
  const E = await open();
  const tE = (id) => E.page.locator(`[data-testid="${id}"]`);
  await E.page.locator("button", { hasText: /Get Started|Log In/ }).first().click({ timeout: 5000 }).catch(() => {});
  await E.page.waitForTimeout(500);
  await E.page.fill("#login-email", `lone-scorer-${stamp}@example.invalid`).catch(() => {});
  await E.page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 5000 }).catch(() => {});
  let homeE = false;
  for (let i = 0; i < 30 && !homeE; i++) { homeE = (await tE("scorer-home").count()) === 1; if (!homeE) await E.page.waitForTimeout(300); }
  ok("he lands on the scorer's home", homeE, (await E.page.$eval("body", (el) => el.innerText).catch(() => "")).slice(0, 200));
  await E.page.waitForTimeout(1500);
  ok("Resume: nothing on this device", (await tE("scorer-resume-empty").count()) === 1);
  ok("Today and next: no fixture he may score, said as that",
     /No fixture you may score is arranged from today on/.test(await tE("scorer-fixtures").innerText().catch(() => "")));
  ok("...and nothing before the toss", (await tE("scorer-prep").count()) === 0);
  await E.ctx.close();

  group("F. A coach, who also scores, keeps the day sheet");
  const F = await open();
  await F.page.locator("button", { hasText: /Get Started|Log In/ }).first().click({ timeout: 5000 }).catch(() => {});
  await F.page.waitForTimeout(500);
  await F.page.fill("#login-email", "coach@example.invalid").catch(() => {});
  await F.page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 5000 }).catch(() => {});
  let sheet = false;
  for (let i = 0; i < 30 && !sheet; i++) { sheet = (await F.page.locator('[data-testid="day-sheet"]').count()) === 1; if (!sheet) await F.page.waitForTimeout(300); }
  ok("the coach lands on the day sheet", sheet && (await F.page.locator('[data-testid="scorer-home"]').count()) === 0);
  await F.ctx.close();

  ok("no application errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  // What the walk wrote and can take back. A fixture with a scoring session
  // or an audit row behind it stays (both are kept by design); it is today's,
  // the walk's own, and holds no event.
  for (const id of made.sessions) await dbq(`delete from scoring_session where match_id = $1`, [id]).catch(() => {});
  for (const id of made.matches) {
    await dbq(`delete from match_official where match_id = $1`, [id]).catch(() => {});
    await dbq(`delete from match where id = $1`, [id]).catch(() => {});
  }
  for (const id of made.users) {
    await dbq(`delete from role_assignment where person_id = $1`, [id]).catch(() => {});
    await dbq(`delete from app_user where id = $1`, [id]).catch(() => {});
  }
  await browser.close();
  web.close();
  api.kill("SIGTERM");
  await pool.end();
}

if (errors.length) {
  console.log("\nApplication errors:");
  for (const e of [...new Set(errors)].slice(0, 6)) console.log("  " + e);
}
if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 10).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SCORER HOME SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

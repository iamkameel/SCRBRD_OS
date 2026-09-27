#!/usr/bin/env node
/**
 * "Umpire suspended the bowler" (Law 41; SCRBRD-094 item 2), in a real
 * browser against a real API and Postgres, at a phone's 390 × 844.
 *
 * The home side wins the toss and bowls, so its bowlers are players SCRBRD
 * holds rows for (the 1XI squad the pad loads) and every figure can be held
 * to SQL as well as to the board:
 *
 *   A  over 1 by one bowler, a maiden; over 2 begun by a second;
 *   B  suspended mid-over: the pad's menu, the reason in words (no Law clause
 *      numbers), how long it is for, and one row the server stores;
 *   C  the replacement: only the bowlers the Laws take are offered, the
 *      others listed with why not — the suspended man, and the one who bowled
 *      the last over; closed without choosing, the pad says why it cannot
 *      score and its fix reopens the question;
 *   D  the replacement finishes the over (a row with reason "suspended");
 *   E  the next over: the replacement is refused (he bowled part of the last
 *      over) and so is the suspended man, each said in words;
 *   F  later in the innings the suspended bowler is still refused;
 *   G  figures: the scorecard credits each bowler his own balls, the shared
 *      over is a maiden for neither, and the board, the API's live score and
 *      SQL's per-bowler figures agree;
 *   H  a reload keeps it all: the board, the refusal, the scorecard;
 *   I  the umpires' report, from the menu: the bowler and the words, and who
 *      files it (a scorer does not hold discipline.write).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-suspension.mjs
 *   BROWSER_SUSPENSION_DEBUG=1 node tools/smoke-browser-suspension.mjs
 *   SUSPENSION_SHOTS=/some/dir node tools/smoke-browser-suspension.mjs   # screenshots, both themes
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { fromRow } from "@scrbrd/scoring";
import { EVENT_COLUMNS } from "../services/api/write/events-api.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(5373);
const API_PORT = port(8873);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const DEBUG = !!process.env.BROWSER_SUSPENSION_DEBUG;
const SHOTS = process.env.SUSPENSION_SHOTS || null;
const DIST = process.env.SUSPENSION_DIST || "apps/web/dist";
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-suspension-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));

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
const serverEvents = async () =>
  (await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [MATCH])).map(fromRow);

let coachToken = null;
async function read(resource) {
  coachToken ??= (await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "coach@example.invalid", deviceId: "suspension-walk-coach" }) })).json())?.token;
  const r = await fetch(`${API}/api/read/${resource}?matchId=${MATCH}`, { headers: { authorization: `Bearer ${coachToken}` } });
  const rows = (await r.json().catch(() => ({})))?.rows ?? [];
  return rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : v])));
}
const liveScore = async () => Object.fromEntries((await read("live_score")).map((r) => [r.innings, r]));

/** Each bowler's figures as SQL keeps them, from the stored log: legal balls and runs charged. */
async function sqlBowling() {
  const rows = await dbq(
    `select b.bowler_id id,
            count(*) filter (where b.ball_type not in ('Wd','Nb'))::int balls,
            coalesce(sum(case when b.ball_type in ('Wd','Nb') then 1 + coalesce(b.value,0)
                              when b.ball_type in ('run','W') then coalesce(b.value,0) else 0 end),0)::int runs
       from ball_event_live b where b.match_id = $1 and b.kind = 'ball' and b.bowler_id is not null
      group by b.bowler_id`, [MATCH]);
  const figs = new Map((await dbq(`select player_id, wickets, runs_conceded from bowler_innings_figures where match_id = $1`, [MATCH]))
    .map((r) => [r.player_id, r]));
  return new Map(rows.map((r) => [r.id, { balls: r.balls, runs: r.runs, figRuns: Number(figs.get(r.id)?.runs_conceded ?? NaN) }]));
}

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await offline(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
});

const text = () => page.$eval("body", (el) => el.innerText);
const click = async (re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const tap = async (id, ms = 4000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(350); };
const has = async (id) => (await tid(id).count()) > 0;
const said = async (id) => ((await tid(id).first().innerText({ timeout: 2000 }).catch(() => "")) || "").trim();
const lawNumbers = (s) => /\bLaws? \d|\(Law|\b\d+\.\d+\.\d+\b|\b41\.\d+\b|\b17\.\d+\b/.test(s);

const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
const parseBoard = (b) => { const m = b.match(/^(\d+) for (\d+), (\d+)\.(\d) overs$/); return m ? { runs: +m[1], wickets: +m[2], balls: +m[3] * 6 + +m[4] } : null; };
const settle = async () => { await page.waitForTimeout(2600); };
const agree = async (label) => {
  await settle();
  const b = parseBoard(await board());
  const live = (await liveScore())[0];
  ok(`${label}: the board and the API's live score agree (${await board()})`,
     !!b && !!live && live.runs === b.runs && live.wickets === b.wickets && live.legal_balls === b.balls,
     `board ${JSON.stringify(b)} / api ${JSON.stringify(live)}`);
  return b;
};
const basicPad = async () => {
  if (!(await has("basic-pad"))) { await tap("pad-menu").catch(() => {}); await tap("pad-basic-scoring").catch(() => {}); }
  await page.waitForTimeout(300);
};
const openMenu = async (item) => { await tap("pad-menu"); await tap(item); await page.waitForTimeout(300); };
const closeSheet = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(400); };
/** A run key on the Basic pad, by its test id. */
const score = async (v) => { await tap(`run-${v}`, 3000); await page.waitForTimeout(150); };

/** The Batting Order sheet: Michaelhouse is typed, as a real opposition is. */
let batterNo = 0;
const typeBatter = async () => {
  const f = page.locator('input[aria-label="Player name"]');
  if (!(await f.count())) return false;
  batterNo++; await f.fill(`Batter ${batterNo}`); await f.press("Enter"); await page.waitForTimeout(500);
  return true;
};
/** The bowler sheet: pick one by name (a button in the roster). */
const pickBowler = async (name) => {
  const b = page.locator('[role="dialog"] button:not([disabled])', { hasText: name }).first();
  if (!(await b.count())) return false;
  await b.click({ timeout: 2000 }); await page.waitForTimeout(500);
  return true;
};
/** In the open bowler sheet, what a disabled bowler says about himself, by name. */
const whyNot = async (id) => ((await page.locator(`[data-testid="bowler-choice"][data-id="${id}"] [data-testid="bowler-unavailable"]`)
  .first().innerText({ timeout: 2000 }).catch(() => "")) || "").trim();

/** Screenshots of one sheet in both themes, at 390 × 844 (SUSPENSION_SHOTS only). */
async function shoot(name, open) {
  if (!SHOTS) return;
  const wasOpen = (await page.locator('[role="dialog"]').count()) > 0;
  if (wasOpen) await closeSheet();
  for (const theme of ["daylight", "floodlit"]) {
    await tap("pad-menu"); await tap(`pad-theme-choice-${theme}`); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    if (open) await open();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) });
    if (open) await closeSheet();
  }
  await tap("pad-menu"); await tap("pad-theme-choice-system"); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  if (wasOpen && open) await open();
}

try {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // The home side wins the toss and BOWLS: its bowlers are the 1XI players
  // the pad loads, with ids, so SQL's figures can be read per bowler.
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bowl' from match where id = $1 on conflict (match_id) do nothing`, [MATCH]);
  const P = Object.fromEntries((await dbq(`select id, full_name from player where id = any($1)`,
    [["aaaaaaaa-0000-0000-0000-000000000002", "aaaaaaaa-0000-0000-0000-000000000003", "aaaaaaaa-0000-0000-0000-000000000004"]]))
    .map((r) => [r.full_name, r.id]));
  const [A, B, C] = ["T Bekker", "S Naidoo", "M Cele"];   // over 1; over 2, suspended; the one who finishes it
  ok("the three bowlers are seeded players", !!P[A] && !!P[B] && !!P[C], JSON.stringify(P));

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the pad on a real fixture, at 390 × 844: the home side bowls");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);
  const opened = await page.evaluate(() => {
    const isBtn = (b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "");
    for (const b of [...document.querySelectorAll("button")].filter(isBtn)) {
      let card = b;
      while (card.parentElement && [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) card = card.parentElement;
      if (/Michaelhouse/i.test(card.textContent || "")) { b.click(); return true; }
    }
    return false;
  });
  ok("the 1XI fixture offers the scorer", opened);
  await page.waitForTimeout(2500);
  await page.setViewportSize({ width: 390, height: 844 });
  // Openers (typed), then the opening bowler from the home roster.
  for (let i = 0; i < 6; i++) {
    if (await has("scoring-blocked-fix") && !(await page.locator('[role="dialog"]').count())) await tap("scoring-blocked-fix").catch(() => {});
    if (await typeBatter()) continue;
    if (/Opening Bowler/i.test(await text())) { ok(`the opening bowler, ${A}, is offered from the home roster`, await pickBowler(A)); break; }
    await page.waitForTimeout(400);
  }
  await basicPad();
  ok("the pad is ready", !(await has("scoring-blocked")), await said("scoring-blocked"));

  // ── A ────────────────────────────────────────────────────────
  group(`A. Over 1 by ${A}, a maiden; over 2 begun by ${B}`);
  for (let k = 0; k < 6; k++) await score(0);
  ok("the over is done: the new-over sheet asks", /Over 1 Complete/i.test(await text()));
  ok(`...${A} is refused, in words: he bowled the last over`, /Bowled part of the last over/.test(await whyNot(P[A])), await whyNot(P[A]));
  ok(`${B} bowls over 2`, await pickBowler(B));
  await score(0); await score(0);
  const a1 = await agree("two balls into over 2");
  ok("...0 for 0 off 1.2", a1?.runs === 0 && a1?.balls === 8, await board());

  // ── B ────────────────────────────────────────────────────────
  group(`B. The umpire suspends ${B}: the menu, the reason in words, how long, one row`);
  const rowsB0 = (await serverEvents()).length;
  await openMenu("pad-suspend");
  ok("the menu opens the suspension sheet", await has("suspend-sheet"));
  const sheet = await said("suspend-sheet");
  ok(`...naming the bowler on (${B})`, sheet.includes(`${B} may not bowl again`), sheet.slice(0, 120));
  ok("...Record disabled until a reason is chosen, saying so", await tid("suspend-confirm").isDisabled() && /Choose the reason the umpire gave/.test(await said("suspend-hint")));
  ok("...six reasons, in words", (await page.locator('[data-testid^="suspend-reason-"]').count()) === 6
     && /A deliberate front-foot no-ball/.test(sheet) && /Dangerous full tosses above waist height/.test(sheet));
  ok("...with no Law clause numbers anywhere on it", !lawNumbers(sheet), sheet.match(/.{0,30}(Law|\d+\.\d+).{0,30}/)?.[0]);
  await tap("suspend-reason-ball_tampering");
  ok("ball tampering says the rest of the match", /for the rest of the match/.test(await said("suspend-scope")));
  await tap("suspend-reason-deliberate_no_ball");
  ok("a deliberate front-foot no-ball says the rest of the innings", /for the rest of the innings/.test(await said("suspend-scope")));
  await shoot("1-reason", async () => { await openMenu("pad-suspend"); await tap("suspend-reason-deliberate_no_ball"); });
  await tap("suspend-confirm");
  ok("Record moves straight on to who finishes the over", await has("suspend-replace") && /Who finishes the over\?/.test(await text()));
  await settle();
  let evs = await serverEvents();
  const sRow = evs.find((e) => e.kind === "bowler_suspended");
  ok("the server has one more row: bowler_suspended, the bowler, the reason, the scope",
     evs.length === rowsB0 + 1 && sRow?.bowler === P[B] && sRow?.reason === "deliberate_no_ball" && sRow?.scope === "innings", JSON.stringify(sRow));
  const stored = (await dbq(`select kind, ball_type, value, bowler_id from ball_event where match_id = $1 and kind = 'bowler_suspended'`, [MATCH]))[0];
  ok("...a row that is no delivery: no type, no value, the bowler in bowler_id",
     stored?.ball_type == null && stored?.value == null && stored?.bowler_id === P[B], JSON.stringify(stored));

  // ── C ────────────────────────────────────────────────────────
  group("C. The replacement: only the bowlers the Laws take, the rest with why not");
  const eligible = await page.locator('[data-testid^="suspend-pick-"]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace("suspend-pick-", "")));
  ok(`offered: neither ${B} nor ${A} (${eligible.length} others)`, eligible.length >= 2 && !eligible.includes(P[B]) && !eligible.includes(P[A]) && eligible.includes(P[C]),
     eligible.join(","));
  ok(`not offered: ${B}, suspended, in words`, /Suspended by the umpires/.test(await said(`suspend-refused-${P[B]}`)), await said(`suspend-refused-${P[B]}`));
  ok(`...and ${A}, who bowled the last over, in words`, /Bowled part of the last over/.test(await said(`suspend-refused-${P[A]}`)), await said(`suspend-refused-${P[A]}`));
  ok("...no Law clause numbers", !lawNumbers(await said("suspend-replace")));
  await shoot("2-replace", async () => { await tap("scoring-blocked-fix"); });
  // Closed without choosing: the pad says why it cannot score, and its fix is the question again.
  await closeSheet();
  ok("closed without a choice, the pad says why it cannot score", /the umpires suspended the bowler/i.test(await said("scoring-blocked")),
     await said("scoring-blocked"));
  ok("...and a tap on a run key records nothing (it opens the question instead)", await (async () => { const n = (await serverEvents()).length; await tap("run-1"); await settle(); return (await serverEvents()).length === n; })());
  if (!(await has("suspend-replace"))) await tap("scoring-blocked-fix");
  ok("the fix reopens who finishes the over", await has("suspend-replace"));

  // ── D ────────────────────────────────────────────────────────
  group(`D. ${C} finishes the over`);
  await tap(`suspend-pick-${P[C]}`);
  ok("the sheet closes on the choice", !(await has("suspend-replace")));
  evs = await serverEvents();
  const change = evs.at(-1);
  ok(`the server has the change: ${C}, reason "suspended"`, change?.kind === "bowler" && change.bowler === P[C] && change.reason === "suspended", JSON.stringify(change));
  for (let k = 0; k < 4; k++) await score(0);
  ok("the over is done: the new-over sheet asks", /Over 2 Complete/i.test(await text()));

  // ── E ────────────────────────────────────────────────────────
  group("E. The next over: the replacement and the suspended bowler, each refused in words");
  ok(`${C} may not bowl it: he bowled part of the last over`, /Bowled part of the last over/.test(await whyNot(P[C])), await whyNot(P[C]));
  ok(`${B} may not: suspended`, /Suspended by the umpires/.test(await whyNot(P[B])), await whyNot(P[B]));
  ok(`${A} may`, await pickBowler(A));
  for (const v of [1, 4, 0, 2, 0, 1]) await score(v);
  await agree("three overs in");

  // ── F ────────────────────────────────────────────────────────
  group(`F. Later in the innings, ${B} is still refused`);
  ok("the new-over sheet asks for over 4", /Over 3 Complete/i.test(await text()));
  ok(`${B} is still refused as suspended`, /Suspended by the umpires/.test(await whyNot(P[B])), await whyNot(P[B]));

  // ── H (reload before choosing) ───────────────────────────────
  group("H. A reload keeps it all");
  const before = await board();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2800);
  await basicPad();
  ok(`the board is the same (${await board()})`, (await board()) === before, `${before} / ${await board()}`);
  if (!/Over 3 Complete/i.test(await text())) await tap("scoring-blocked-fix").catch(() => {});
  ok(`...and ${B} is still refused, after the reload`, /Suspended by the umpires/.test(await whyNot(P[B])), await whyNot(P[B]));
  ok(`${C} may bowl again now, an over later`, await pickBowler(C));
  for (const v of [0, 1, 0, 0, 0, 0]) await score(v);
  await closeSheet();

  // ── G ────────────────────────────────────────────────────────
  group("G. Figures: each bowler his own balls; the shared over a maiden for neither; SQL agrees");
  const g = await agree("four overs in");
  ok("...9 for 0 off 4.0", g?.runs === 9 && g?.balls === 24, await board());
  await page.locator('nav[aria-label="Scorer views"] button', { hasText: "Cards" }).first().click();
  await page.waitForTimeout(600);
  const row = async (id) => (await said(`card-bowler-${id}`)).split(/\s+/).join(" ");
  const rA = await row(P[A]), rB = await row(P[B]), rC = await row(P[C]);
  // O M R W Econ
  ok(`${A}: 2.0 overs, 1 maiden (over 1), 8 runs`, new RegExp(`^${A} 2\\.0 1 8 0 `).test(rA), rA);
  ok(`${B}: 0.2 overs, no maiden, 0 runs`, new RegExp(`^${B} 0\\.2 0 0 0 `).test(rB), rB);
  ok(`${C}: 1.4 overs (4 balls of over 2, all of over 4), no maiden, 1 run`, new RegExp(`^${C} 1\\.4 0 1 0 `).test(rC), rC);
  ok("the scorecard says who took over, and the suspension in words",
     /took over from S Naidoo \(suspended\)/.test(await said("bowler-changes"))
     && /S Naidoo suspended for a deliberate front-foot no-ball, for the rest of the innings/.test(await said("bowler-suspensions")),
     `${await said("bowler-changes")} | ${await said("bowler-suspensions")}`);
  ok("...no Law clause numbers on it", !lawNumbers(await said("bowler-suspensions")));
  const sql = await sqlBowling();
  ok("SQL credits each bowler his own legal balls and runs (A 12/8, B 2/0, C 10/1)",
     sql.get(P[A])?.balls === 12 && sql.get(P[A])?.runs === 8 && sql.get(P[B])?.balls === 2 && sql.get(P[B])?.runs === 0
     && sql.get(P[C])?.balls === 10 && sql.get(P[C])?.runs === 1, JSON.stringify([...sql]));
  ok("...and bowler_innings_figures' runs conceded are the same", sql.get(P[A])?.figRuns === 8 && sql.get(P[C])?.figRuns === 1,
     JSON.stringify([...sql]));
  await page.locator('nav[aria-label="Scorer views"] button', { hasText: "Score" }).first().click();
  await page.waitForTimeout(400);

  // ── I ────────────────────────────────────────────────────────
  group("I. The umpires' report, from the menu");
  await openMenu("pad-suspend-report");
  ok("the menu offers it once a suspension is recorded", await has("suspend-report"));
  const rep = await said("suspend-report");
  ok(`...naming ${B}, where, why and for how long`, rep.includes(`${B} · innings 1, over 1.2`) && /A deliberate front-foot no-ball\. He may not bowl again for the rest of the innings/.test(rep), rep.slice(0, 300));
  ok("...not filed from here (a reloaded pad is on its resume credential, and a scorer does not file conduct): the sheet says who does, and where", /[Uu]mpires (file the record: in|can also file it from) the Match Centre[:,]? open this fixture, then Report an incident/.test(await said("suspend-report-who")),
     await said("suspend-report-who"));
  ok("...no Law clause numbers", !lawNumbers(rep));
  await shoot("3-report", async () => { await openMenu("pad-suspend-report"); });
  await closeSheet();

  ok("no console errors across the walk", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 8).join("\n"));
  if (DEBUG) console.log("[debug] body:\n" + (await text().catch(() => "")).slice(0, 1500));
} finally {
  await browser.close().catch(() => {});
  web.close();
  api.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SUSPENSION SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * The Laws' 4th Edition on the pad (SCRBRD-113), in a real browser against a
 * real API and Postgres, at a phone's 390 × 844 — on a fixture dated 3
 * October 2026, so the pad and the server both score it under the 4th:
 *
 *   A  words: a wide and a no-ball say a bouncer over head height is a wide;
 *      the height no-ball reads "Waist high", never a bare "Height";
 *   B  the suspension sheet: nine reasons, and how long each is for under the
 *      4th Edition — a deliberate front-foot no-ball and a deliberate beamer
 *      the rest of the MATCH, the dangerous series the innings — no Law
 *      clause numbers; closed, nothing stored;
 *   C  short running: the fielding captain chooses who faces — Record waits
 *      for the choice; the ball (no runs, `facesNext`) and the five stored;
 *      the batter chosen faces the next ball;
 *   D  an obstruction that stopped a catch: no runs, and the fielding
 *      captain chooses the non-striker or the incoming batter — the
 *      non-striker faces, the incoming batter comes in at the other end;
 *   E  a fielder's offence on the delivery (28.2): the ball does not count in
 *      the over — the board's overs do not move, its runs stand with the five
 *      — held to the API's live score (db/54).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-laws4.mjs
 *   BROWSER_LAWS4_DEBUG=1 node tools/smoke-browser-laws4.mjs
 *   LAWS4_SHOTS=/some/dir node tools/smoke-browser-laws4.mjs   # screenshots, both themes
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { fromRow, deriveMatch, lawsEditionOn } from "@scrbrd/scoring";
import { EVENT_COLUMNS } from "../services/api/write/events-api.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(5379);
const API_PORT = port(8879);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const DEBUG = !!process.env.BROWSER_LAWS4_DEBUG;
const SHOTS = process.env.LAWS4_SHOTS || null;
const DIST = process.env.LAWS4_DIST || "apps/web/dist";
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const STARTS = "2026-10-03T08:00:00Z";                    // 10:00 SAST, 3 October 2026: the 4th Edition
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-laws4-secret",
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
/** The server's log, folded as the server folds it: dated by the fixture. */
const serverFold = async () => deriveMatch(await serverEvents(), { startsAt: STARTS, format: "T20" }).innings[0];

let coachToken = null;
async function read(resource) {
  coachToken ??= (await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "coach@example.invalid", deviceId: "laws4-walk-coach" }) })).json())?.token;
  const r = await fetch(`${API}/api/read/${resource}?matchId=${MATCH}`, { headers: { authorization: `Bearer ${coachToken}` } });
  const rows = (await r.json().catch(() => ({})))?.rows ?? [];
  return rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : v])));
}
const liveScore = async () => Object.fromEntries((await read("live_score")).map((r) => [r.innings, r]));

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

// Every refusal the server gives the pad is a failure of this walk: each
// event it sends is one the Laws take.
const refusedBy = [];
page.on("response", async (r) => {
  if (r.request().method() !== "POST" || !/\/api\/matches\/[^/]+\/events$/.test(r.url())) return;
  const body = await r.json().catch(() => null);
  for (const x of body?.refused ?? []) refusedBy.push(`${x.idempotencyKey}: ${x.reason}`);
  if (DEBUG && body) console.log("  POST events →", JSON.stringify(body).slice(0, 400));
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
const lawNumbers = (s) => /\bLaws? \d|\(Law|\b\d+\.\d+\.\d+\b|\b41\.\d+\b|\b17\.\d+\b|\b18\.\d+\b|\b37\.\d+\b/.test(s);

const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
const parseBoard = (b) => { const m = b.match(/^(\d+) for (\d+), (\d+)\.(\d) overs$/); return m ? { runs: +m[1], wickets: +m[2], balls: +m[3] * 6 + +m[4] } : null; };
const settle = async () => { await page.waitForTimeout(2600); };
/** Until the server holds at least `n` events (the pad sends as it can), or ten seconds. */
const waitRows = async (n) => {
  for (let i = 0; i < 40; i++) { if ((await serverEvents()).length >= n) return true; await page.waitForTimeout(250); }
  return false;
};
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
const score = async (v) => { await tap(`run-${v}`, 3000); await page.waitForTimeout(150); };

let batterNo = 0;
const typeBatter = async () => {
  const f = page.locator('input[aria-label="Player name"]');
  if (!(await f.count())) return false;
  // Go, tapped as a phone taps it. (Enter in the field, with a keyboard, lets
  // the keypress land on whatever the closing sheet hands focus back to — the
  // Wicket key, after a wicket — and opens its sheet again.)
  batterNo++; await f.fill(`Batter ${batterNo}`);
  await page.locator('[role="dialog"] button:not([disabled])', { hasText: /^Go$/ }).first().click({ timeout: 2000 });
  await page.waitForTimeout(500);
  return true;
};
const pickBowler = async (name) => {
  const b = page.locator('[role="dialog"] button:not([disabled])', { hasText: name }).first();
  if (!(await b.count())) return false;
  await b.click({ timeout: 2000 }); await page.waitForTimeout(500);
  return true;
};

/** Screenshots of one sheet in both themes, at 390 × 844 (LAWS4_SHOTS only). */
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
  // The fixture, dated 3 October 2026: the 4th Edition, by its date. The
  // home side wins the toss and bowls: its bowlers are the 1XI players.
  await dbq(`update match set starts_at = $2 where id = $1`, [MATCH, STARTS]);
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bowl' from match where id = $1 on conflict (match_id) do nothing`, [MATCH]);
  ok("the fixture is dated in the 4th Edition", lawsEditionOn((await dbq(`select starts_at from match where id = $1`, [MATCH]))[0].starts_at) === 4);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the pad on a fixture dated 3 October 2026, at 390 × 844");
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
  for (let i = 0; i < 6; i++) {
    if (await has("scoring-blocked-fix") && !(await page.locator('[role="dialog"]').count())) await tap("scoring-blocked-fix").catch(() => {});
    if (await typeBatter()) continue;
    if (/Opening Bowler/i.test(await text())) { ok("the opening bowler is offered from the home roster", await pickBowler("T Bekker")); break; }
    await page.waitForTimeout(400);
  }
  await basicPad();
  ok("the pad is ready", !(await has("scoring-blocked")), await said("scoring-blocked"));
  await score(0);
  await agree("one dot");

  // ── A ────────────────────────────────────────────────────────
  group("A. Words: a bouncer over head height is a wide; the height no-ball is a waist-high full toss");
  await tap("key-wide");
  ok("the wide's panel says a bouncer over head height is a wide", /A bouncer over head height is a wide/.test(await said("extra-head-height")),
     await said("extra-panel"));
  await tap("extra-cancel");
  await tap("key-noball");
  ok("the no-ball's kinds: Front foot, Waist high, Beamer — no bare Height",
     (await said("nb-type-height")) === "Waist high" && !/\bHeight\b/.test(await said("nb-type")), await said("nb-type"));
  ok("...and it says the same of a bouncer", /over head height is a wide/.test(await said("extra-head-height")));
  await shoot("1-noball", async () => { await tap("key-noball"); });
  await tap("extra-cancel");

  // ── B ────────────────────────────────────────────────────────
  group("B. The suspension sheet under the 4th Edition: how long each is for");
  const rowsB = (await serverEvents()).length;
  await openMenu("pad-suspend");
  ok("nine reasons, in words", (await page.locator('[data-testid^="suspend-reason-"]').count()) === 9);
  const sheet = await said("suspend-sheet");
  ok("...a deliberate beamer apart from the dangerous ones, throwing, and a serious conduct offence",
     /A deliberate non-landing delivery above waist height/.test(sheet) && /Dangerous non-landing deliveries above waist height/.test(sheet)
     && /Throwing the ball/.test(sheet) && /Level 4 conduct offence/.test(sheet), sheet.slice(0, 400));
  ok("...no Law clause numbers", !lawNumbers(sheet), sheet.match(/.{0,30}(Law|\d+\.\d+).{0,30}/)?.[0]);
  await tap("suspend-reason-deliberate_no_ball");
  ok("a deliberate front-foot no-ball: the rest of the match", /for the rest of the match/.test(await said("suspend-scope")), await said("suspend-scope"));
  await tap("suspend-reason-deliberate_beamer");
  ok("a deliberate beamer: the rest of the match", /for the rest of the match/.test(await said("suspend-scope")));
  await tap("suspend-reason-beamers");
  ok("the dangerous series, after a caution: the rest of the innings", /for the rest of the innings/.test(await said("suspend-scope")));
  await tap("suspend-reason-throwing");
  ok("throwing: the rest of the innings", /for the rest of the innings/.test(await said("suspend-scope")));
  await shoot("2-suspend", async () => { await openMenu("pad-suspend"); await tap("suspend-reason-deliberate_no_ball"); });
  await closeSheet();
  await settle();
  ok("closed without recording: nothing stored", (await serverEvents()).length === rowsB);

  // ── C ────────────────────────────────────────────────────────
  group("C. Short running: the fielding captain chooses who faces");
  const beforeC = await serverFold();
  const [s0, n0] = [beforeC.striker, beforeC.nonStriker];
  ok(`on strike ${s0}, ${n0} at the other end`, !!s0 && !!n0);
  await openMenu("pad-short-run");
  ok("the sheet says the fielding captain chooses", /The fielding captain chooses who faces the next ball/.test(await said("short-run-sheet")),
     (await said("short-run-sheet")).slice(0, 300));
  ok("...Record waits for the choice, and says so", await tid("short-run-confirm").isDisabled() && /Choose who faces the next ball/.test(await said("penalty-hint")));
  ok("...offering the two batters by name", (await said("faces-next-striker")) === s0 && (await said("faces-next-non_striker")) === n0);
  ok("...and no Law clause numbers", !lawNumbers(await said("short-run-sheet")));
  await shoot("3-short-run", async () => { await openMenu("pad-short-run"); await tap("faces-next-non_striker"); });
  await tap("short-run-type-run");
  await tap("faces-next-non_striker");
  ok("chosen, Record is enabled", !(await tid("short-run-confirm").isDisabled()));
  const rowsC = (await serverEvents()).length;
  await tap("short-run-confirm");
  await waitRows(rowsC + 2);
  let evs = await serverEvents();
  const [scBall, scAward] = evs.slice(-2);
  ok("two rows: the ball with no runs and the captain's choice, then five to the fielding side",
     evs.length === rowsC + 2 && scBall?.kind === "ball" && (scBall.value ?? 0) === 0 && scBall.facesNext === "non_striker"
     && scAward?.kind === "penalty" && scAward.toBattingTeam === false && scAward.reason === "short_running", JSON.stringify(evs.slice(-2)));
  const afterC = await serverFold();
  ok(`${n0} faces the next ball, as the fielding captain chose`, afterC.striker === n0 && afterC.nonStriker === s0,
     `${afterC.striker} / ${afterC.nonStriker}`);
  await score(0);
  await settle();
  evs = await serverEvents();
  ok("...and the pad agrees: its next ball is stamped with him on strike", evs.at(-1)?.striker === n0, evs.at(-1)?.striker);
  await agree("after the short run");

  // ── D ────────────────────────────────────────────────────────
  group("D. An obstruction that stopped a catch: the fielding captain chooses the non-striker or the incoming batter");
  const beforeD = await serverFold();
  const [striker, survivor] = [beforeD.striker, beforeD.nonStriker];
  await tap("key-wicket");
  await tap("wicket-mode-obstructing_field");
  ok("the sheet asks whether it stopped a catch", await has("wicket-obstruct-catch"));
  await tap("wicket-catch-yes");
  ok("...and then who faces: the non-striker by name, or the incoming batter",
     (await said("wicket-faces-non_striker")) === survivor && /incoming batter/.test(await said("wicket-faces-incoming")));
  ok("...Confirm waits for the choice", await tid("wicket-confirm").isDisabled());
  await shoot("4-obstruct", async () => { await tap("key-wicket"); await tap("wicket-mode-obstructing_field"); await tap("wicket-catch-yes"); });
  await tap("wicket-faces-non_striker");
  await tap("wicket-confirm");
  await page.waitForTimeout(600);
  ok("the next batter is asked for", await typeBatter());
  await page.waitForTimeout(400);
  await settle();
  evs = await serverEvents();
  const wRow = [...evs].reverse().find((e) => e.kind === "ball" && e.type === "W");
  ok("the wicket row: obstructing the field, no runs, the captain's choice",
     wRow?.dismissal === "obstructing_field" && (wRow.value ?? 0) === 0 && wRow.facesNext === "non_striker", JSON.stringify(wRow));
  const afterD = await serverFold();
  ok(`${survivor} faces; the incoming batter is at the other end; ${striker} is out`,
     afterD.striker === survivor && afterD.nonStriker === `Batter ${batterNo}` && afterD.batsmen.find((b) => b.id === striker)?.status === "out",
     `${afterD.striker} / ${afterD.nonStriker}`);
  await score(0);
  await settle();
  evs = await serverEvents();
  ok("...and the pad's next ball is his", evs.at(-1)?.striker === survivor, evs.at(-1)?.striker);
  await agree("after the obstruction");

  // ── E ────────────────────────────────────────────────────────
  group("E. A fielder's offence on the ball: it does not count in the over (db/54)");
  const b0 = parseBoard(await board());
  await openMenu("pad-penalty");
  await tap("penalty-side-batting");
  ok("the batting side's reasons offer a delivery that does not count", await has("penalty-not-in-over"));
  await tap("penalty-not-in-over");
  ok("the sheet says the delivery does not count", /does not count as one of the over/.test(await said("not-in-over-sheet")));
  ok("...Record waits for the offence", await tid("not-in-over-confirm").isDisabled() && /Choose what the fielder did/.test(await said("penalty-hint")));
  ok("...no Law clause numbers", !lawNumbers(await said("not-in-over-sheet")));
  await tap("not-in-over-reason-illegal_fielding");
  await tap("not-in-over-type-run");
  await tap("not-in-over-runs-2");
  await shoot("5-not-in-over", async () => { await openMenu("pad-penalty"); await tap("penalty-side-batting"); await tap("penalty-not-in-over"); });
  const rowsE = (await serverEvents()).length;
  await tap("not-in-over-confirm");
  await waitRows(rowsE + 2);
  const b1 = await agree("after the ball that does not count");
  evs = await serverEvents();
  const [niBall, niAward] = evs.slice(-2);
  ok("two rows: the ball marked, two runs, then five to the batting side",
     evs.length === rowsE + 2 && niBall?.notInOver === "illegal_fielding" && niBall.value === 2
     && niAward?.kind === "penalty" && niAward.toBattingTeam === true && niAward.reason === "illegal_fielding", JSON.stringify(evs.slice(-2)));
  ok(`the board: seven more runs, the same balls (${b0?.balls})`, !!b0 && !!b1 && b1.runs === b0.runs + 7 && b1.balls === b0.balls,
     `${JSON.stringify(b0)} → ${JSON.stringify(b1)}`);

  group("And nothing went wrong on the page");
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  ok("the server refused nothing the pad sent", refusedBy.length === 0, refusedBy.slice(0, 3).join(" | "));
} catch (err) {
  ok(`the walk threw: ${err.message?.slice(0, 200)}`, false);
  if (DEBUG) {
    console.log(err.stack);
    console.log((await text().catch(() => "")).slice(0, 1500));
    await page.screenshot({ path: "/tmp/claude-0/-home-user-SCRBRD-OS/1d27389e-e6e1-53f8-be25-c3f41d6f24d0/scratchpad/laws4-fail.png" }).catch(() => {});
  }
} finally {
  if (DEBUG && apiErr.length) console.log(apiErr.join("").slice(-2000));
  await browser.close().catch(() => {});
  web.close();
  api.kill("SIGTERM");
  await pool.end();
}

console.log("\n" + "─".repeat(52));
console.log(`BROWSER LAWS 4TH EDITION SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

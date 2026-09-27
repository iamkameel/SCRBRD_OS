#!/usr/bin/env node
/**
 * "Batter retired hurt" (SCRBRD-071), in a real browser against a real API
 * and Postgres, at a phone's 390 × 844.
 *
 * The home side wins the toss and BATS, so its batters are players SCRBRD
 * holds rows for (the 1XI squad the pad loads) and his figures can be held to
 * SQL as well as to the board:
 *
 *   A  two balls of over 1: the striker hits a four and a dot;
 *   B  the striker retires hurt MID-OVER, from the pad's menu: the sheet names
 *      both batters and their ends, Record says who, one row the server
 *      stores — a retire, reason hurt, no W marker — and the wickets, the
 *      balls and the board do not move;
 *   C  the batting-order sheet opens at once and does not offer him back to
 *      the end he left; closed without a choice, the pad says why it cannot
 *      score, the menu offers only the batter who is in, and the pad's fix
 *      reopens the batting-order sheet (not the openers', not a bowler);
 *   D  the next batter comes in and the over is finished;
 *   E  the scorecard says "retired hurt", not a wicket: 0 wickets on it, his
 *      runs and balls as he left them;
 *   F  the next wicket; he walks back in from "Retired hurt — may resume",
 *      and his line goes on: the scorecard, SQL's player_innings (not out)
 *      and his career dismissals, which did not move;
 *   G  who may resume is the Laws' answer (SCRBRD-071): his partner retires
 *      hurt and is not offered back to his own end; the next batter comes in;
 *      then he retires too — and the partner, whose retirement came first,
 *      is offered and walks back in at HIS; he himself is not. The server
 *      takes the return, and no wicket moves;
 *   H  every step: the board and the API's live score (runs, wickets, legal
 *      balls) agree.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-retire.mjs
 *   BROWSER_RETIRE_DEBUG=1 node tools/smoke-browser-retire.mjs
 *   RETIRE_SHOTS=/some/dir node tools/smoke-browser-retire.mjs   # screenshots, Daylight and Floodlit
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

const WEB_PORT = port(5381);
const API_PORT = port(8881);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const DEBUG = !!process.env.BROWSER_RETIRE_DEBUG;
const SHOTS = process.env.RETIRE_SHOTS || null;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-retire-secret",
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
const serverEvents = async () =>
  (await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [MATCH])).map(fromRow);

let coachToken = null;
/** The API's live score for innings 0, as a coach reads it. */
async function liveScore() {
  coachToken ??= (await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "coach@example.invalid", deviceId: "retire-walk-coach" }) })).json())?.token;
  const r = await fetch(`${API}/api/read/live_score?matchId=${MATCH}`, { headers: { authorization: `Bearer ${coachToken}` } });
  const row = ((await r.json().catch(() => ({})))?.rows ?? []).find((x) => Number(x.innings) === 0);
  return row ? { runs: Number(row.runs), wickets: Number(row.wickets), balls: Number(row.legal_balls) } : null;
}
/** A batter's career dismissals, as every career screen reads them. */
const dismissals = async (id) => Number((await dbq(`select coalesce(player_dismissals_since($1, null), 0) n`, [id]))[0].n);

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
const dialog = async () => ((await page.locator('[role="dialog"]').first().innerText({ timeout: 2000 }).catch(() => "")) || "").trim();
const lawNumbers = (s) => /\bLaws? \d|\(Law|\b\d+\.\d+\.\d+\b/.test(s);

const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
const parseBoard = (b) => { const m = b.match(/^(\d+) for (\d+), (\d+)\.(\d) overs$/); return m ? { runs: +m[1], wickets: +m[2], balls: +m[3] * 6 + +m[4] } : null; };
const settle = async () => { await page.waitForTimeout(2600); };
/** The board and the API's live score say the same: runs, wickets, legal balls. */
const agree = async (label, want = null) => {
  await settle();
  const b = parseBoard(await board());
  const live = await liveScore();
  ok(`${label}: the board and the API's live score agree (${await board()})`,
     !!b && !!live && live.runs === b.runs && live.wickets === b.wickets && live.balls === b.balls
     && (!want || (b.runs === want.runs && b.wickets === want.wickets && b.balls === want.balls)),
     `board ${JSON.stringify(b)} / api ${JSON.stringify(live)} / want ${JSON.stringify(want)}`);
  return b;
};
const openMenu = async (item) => { await tap("pad-menu"); await tid(item).first().scrollIntoViewIfNeeded().catch(() => {}); await tap(item); await page.waitForTimeout(300); };
const closeSheet = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(400); };
const score = async (v) => { await tap(`run-${v}`, 3000); await page.waitForTimeout(150); };
/** The bowler sheet: Michaelhouse is typed, as a real opposition is. */
const nameBowler = async (name) => {
  await page.locator("input[aria-label='Bowler name']").first().fill(name);
  await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 3000 });
  await page.waitForTimeout(500);
};
/** The batting-order sheet's suggestion: the batting order's next name. */
const sendNext = async () => {
  const next = page.locator('[data-testid="batter-choice"][data-next]:not([disabled])').first();
  if (!(await next.count())) return false;
  await next.click({ timeout: 2000 }); await page.waitForTimeout(500);
  return true;
};
/**
 * The scorecard's batting rows for a batter, by name: "R Name retired hurt 4 2 1 0 200.00"
 * — the name, the line under it, then R B 4s 6s SR. Every row that reads so,
 * so a batter on the card twice would show as two.
 */
const cardRows = async (name) => page.evaluate((n) => {
  const spans = [...document.querySelectorAll("span")].filter((s) => s.textContent === n);
  return spans.map((s) => s.parentElement?.parentElement?.parentElement?.innerText.replace(/\s+/g, " ").trim() ?? "")
    .filter((t) => t.startsWith(n) && /(\d+ ){4}\S+$/.test(t));
}, name);
const cardRow = async (name) => (await cardRows(name))[0] ?? "";
const cards = async () => { await page.locator('nav[aria-label="Scorer views"] button', { hasText: "Cards" }).first().click(); await page.waitForTimeout(600); };
const pad = async () => { await page.locator('nav[aria-label="Scorer views"] button', { hasText: "Score" }).first().click(); await page.waitForTimeout(400); };

/** Screenshots in Daylight and Floodlit, at 390 × 844 (RETIRE_SHOTS only). `open` draws the thing to shoot. */
async function shoot(name, open, close = closeSheet) {
  if (!SHOTS) return;
  for (const theme of ["daylight", "floodlit"]) {
    await tap("pad-menu"); await tap(`pad-theme-choice-${theme}`); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await open();
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) });
    await close();
  }
  await tap("pad-menu"); await tap("pad-theme-choice-system"); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
}

try {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // The home side wins the toss and BATS: its batters are the 1XI players
  // the pad loads, with ids, so SQL's figures can be read per batter.
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1 on conflict (match_id) do nothing`, [MATCH]);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the pad on a real fixture, at 390 × 844: the home side bats");
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
  // The openers (the batting order's first two), then A Nel to bowl.
  for (let i = 0; i < 10; i++) {
    const sheet = (await page.locator('[role="dialog"]').count()) > 0;
    if (sheet && await sendNext()) continue;
    if (sheet && /Opening Bowler/i.test(await text())) { await nameBowler("A Nel"); continue; }
    if (!sheet && await has("scoring-blocked-fix")) { await tap("scoring-blocked-fix"); continue; }
    if (!sheet && !(await has("scoring-blocked"))) break;
    await page.waitForTimeout(500);
  }
  if (!(await has("basic-pad"))) { await tap("pad-menu"); await tap("pad-basic-scoring"); await page.waitForTimeout(300); }
  ok("the pad is ready: two openers, A Nel to bowl, Basic Scoring", (await has("basic-pad")) && !(await has("scoring-blocked")),
     (await text()).slice(0, 300));
  await settle();
  // The openers' sheet sends each opener as he is picked: the striker, then the non-striker.
  const ev0 = await serverEvents();
  const S1 = ev0.find((e) => e.kind === "batters" && e.striker)?.striker;
  const S2 = ev0.find((e) => e.kind === "batters" && e.nonStriker)?.nonStriker;
  const opening = { S1, S2 };
  const names = Object.fromEntries((await dbq(`select id, full_name from player where id = any($1)`, [[S1, S2].filter(Boolean)]))
    .map((r) => [r.id, r.full_name]));
  ok("the openers are seeded players, by id", !!names[S1] && !!names[S2], JSON.stringify(opening));
  const career0 = await dismissals(S1);

  // ── A ────────────────────────────────────────────────────────
  group(`A. Over 1: ${names[S1]} hits a four, then a dot`);
  await score(4); await score(0);
  await agree("two balls in", { runs: 4, wickets: 0, balls: 2 });

  // ── B ────────────────────────────────────────────────────────
  group(`B. Mid-over, ${names[S1]} retires hurt: the pad's menu, never an interrupt`);
  await tap("pad-menu");
  await tid("pad-retire-hurt").first().scrollIntoViewIfNeeded();
  const item = await said("pad-retire-hurt");
  ok("the menu has it, beside the suspension, in words", /^Batter retired hurt/.test(item) && /Not out, and not a wicket/.test(item)
     && await page.evaluate(() => { const s = document.querySelector('[data-testid="pad-suspend"]'), r = document.querySelector('[data-testid="pad-retire-hurt"]'); return !!s && !!r && s.nextElementSibling === r; }),
     item);
  await closeSheet();
  await shoot("1-menu", async () => { await tap("pad-menu"); await tid("pad-retire-hurt").first().scrollIntoViewIfNeeded(); },
    async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(300); });
  // Shot (RETIRE_SHOTS only) before the walk opens it: opened, chosen, closed unrecorded.
  await shoot("2-choose", async () => { await openMenu("pad-retire-hurt"); await tap("retire-pick-striker"); });
  const rows0 = (await serverEvents()).length;
  await openMenu("pad-retire-hurt");
  ok("the menu opens the retirement sheet", await has("retire-sheet"));
  const sheet = await said("retire-sheet");
  ok("...naming the striker and the non-striker, by name and end", await tid("retire-pick-striker").getAttribute("data-batter") === S1
     && await tid("retire-pick-nonStriker").getAttribute("data-batter") === S2
     && new RegExp(`${names[S1]}\\s+On strike\\s+4 \\(2\\)`).test(sheet) && new RegExp(`${names[S2]}\\s+Non-striker\\s+0 \\(0\\)`).test(sheet), sheet.slice(0, 300));
  ok("...saying it is not out and not a wicket", /not out, and not a wicket/.test(sheet));
  ok("...Record disabled until a batter is chosen, saying so", await tid("retire-confirm").isDisabled() && /Choose the batter who is going off/.test(await said("retire-hint")));
  ok("...no Law clause numbers", !lawNumbers(sheet));
  await tap("retire-pick-striker");
  ok("Record names him", (await said("retire-confirm")) === `Record: ${names[S1]} retired hurt`, await said("retire-confirm"));
  await tap("retire-confirm");
  ok("no wicket moment plays", !/wicket/i.test(await said("board-flash-label")), await said("board-flash-label"));
  await settle();
  const evs = await serverEvents();
  const row = evs.at(-1);
  ok("the server has one more row: a retire, reason hurt, the batter", evs.length === rows0 + 1 && row?.kind === "retire"
     && row.reason === "hurt" && row.batter === S1, JSON.stringify(row));
  const stored = (await dbq(`select ball_type, dismissal, value, payload from ball_event where match_id = $1 and kind = 'retire'`, [MATCH]))[0];
  ok("...stored with no W marker and no dismissal: not a wicket", stored?.ball_type == null && stored?.dismissal == null
     && stored?.value == null && stored?.payload?.reason === "hurt", JSON.stringify(stored));
  await agree("retired hurt: nothing moved", { runs: 4, wickets: 0, balls: 2 });

  // ── C ────────────────────────────────────────────────────────
  group("C. At once, who comes in — and not him, back to the end he left");
  ok("the batting-order sheet is open", /Batting Order/.test(await dialog()) && await has("batter-choice"));
  ok(`...${names[S1]} is not offered to resume at his own end`, !(await has(`resume-${S1}`)));
  await closeSheet();
  ok("closed without a choice, the pad says why it cannot score", /no batter at one end/i.test(await said("scoring-blocked")), await said("scoring-blocked"));
  await openMenu("pad-retire-hurt");
  ok("the menu's sheet now offers only the batter who is in", !(await has("retire-pick-striker")) && await tid("retire-pick-nonStriker").getAttribute("data-batter") === S2);
  await closeSheet();
  await tap("scoring-blocked-fix");
  ok("the pad's fix reopens the batting-order sheet — not the openers', not a bowler", /Batting Order/.test(await dialog())
     && !/Opening Bowler/.test(await dialog()) && await has("batter-choice"), (await dialog()).slice(0, 120));

  // ── D ────────────────────────────────────────────────────────
  group("D. The next batter comes in at his end, and the over is finished");
  ok("the batting order's next name is sent in", await sendNext());
  const S3 = (await serverEvents()).at(-1)?.striker;
  ok("...at the striker's end, the one he left", !!S3 && S3 !== S1 && S3 !== S2);
  const nm3 = (await dbq(`select full_name from player where id = $1`, [S3]))[0]?.full_name ?? S3;
  names[S3] = nm3;
  for (const v of [1, 0, 2, 0]) await score(v);
  ok("the over is done after six legal balls: the new-over sheet asks", /Over 1 Complete/i.test(await text()));
  await nameBowler("B Zulu");
  await agree("over 1 complete", { runs: 7, wickets: 0, balls: 6 });

  // ── E ────────────────────────────────────────────────────────
  group("E. The scorecard says retired hurt, not a wicket");
  await cards();
  const r1 = await cardRow(names[S1]);
  ok(`${names[S1]}: retired hurt, 4 off 2`, /retired hurt/.test(r1) && /\b4 2 1 0\b/.test(r1) && !/\b(b|c|lbw|run out)\b/.test(r1.replace(names[S1], "")), r1);
  const head = await page.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.textContent || "").find((t) => /^\d+\/\d+$/.test(t.trim())) ?? "");
  ok(`...the card's total has no wicket (${head.trim()})`, head.trim() === "7/0", head);
  await pad();

  // ── F ────────────────────────────────────────────────────────
  group(`F. The next wicket, and ${names[S1]} walks back in: his line goes on`);
  // Over 2: the ends changed at the over's end; whoever is on strike is bowled.
  await tap("key-wicket");
  await tap("wicket-mode-bowled");
  await tap("wicket-confirm");
  ok("the batting-order sheet lists him under 'Retired hurt — may resume'", /Retired hurt — may resume/i.test(await dialog()) && await has(`resume-${S1}`),
     (await dialog()).slice(0, 200));
  await tap(`resume-${S1}`);
  const back = (await serverEvents()).at(-1);
  ok("the server has him back at the empty end", back?.kind === "batters" && (back.striker === S1 || back.nonStriker === S1), JSON.stringify(back));
  await agree("one wicket: the bowled, not the retirement", { runs: 7, wickets: 1, balls: 7 });
  // He faces: if he came in at the non-striker's end, a single brings him on strike.
  const onStrike = back.striker === S1;
  if (!onStrike) await score(1);
  await score(2);
  const want = { runs: 6, balls: 3 };
  await agree("his runs after he came back", { runs: onStrike ? 9 : 10, wickets: 1, balls: onStrike ? 8 : 9 });
  await cards();
  const rs = await cardRows(names[S1]);
  ok(`the scorecard: one line, batting, ${want.runs} off ${want.balls} — the four before and the two after`,
     rs.length === 1 && new RegExp(`\\b${want.runs} ${want.balls} 1 0\\b`).test(rs[0]) && !/retired hurt/.test(rs[0]), rs.join(" | "));
  await pad();
  await settle();
  const pi = (await dbq(`select runs, balls_faced, out from player_innings where match_id = $1 and player_id = $2 and innings = 0`, [MATCH, S1]))[0];
  ok(`SQL's player_innings: ${want.runs} off ${want.balls}, not out`, Number(pi?.runs) === want.runs && Number(pi?.balls_faced) === want.balls && pi?.out === false,
     JSON.stringify(pi));
  ok("...and his career dismissals did not move", (await dismissals(S1)) === career0, `${career0} → ${await dismissals(S1)}`);

  // ── G ────────────────────────────────────────────────────────
  group("G. Who may resume is the Laws': not straight back, but at another batter's retirement");
  const endOf = async (id) => (await tid("retire-pick-striker").getAttribute("data-batter")) === id ? "striker" : "nonStriker";
  await openMenu("pad-retire-hurt");
  const P = [await tid("retire-pick-striker").getAttribute("data-batter"), await tid("retire-pick-nonStriker").getAttribute("data-batter")]
    .find((x) => x && x !== S1);
  ok(`his partner is in, beside ${names[S1]}`, !!P, P);
  await tap(`retire-pick-${await endOf(P)}`);
  await tap("retire-confirm");
  await settle();
  ok("the partner's retirement is stored", (await serverEvents()).at(-1)?.kind === "retire" && (await serverEvents()).at(-1)?.batter === P);
  const firstSheet = await dialog();
  ok("the batting-order sheet opens, and does not offer him back to the end he has just left",
     /Batting Order/.test(firstSheet) && !(await has(`resume-${P}`)) && !(await has("resume-list")) && await has("batter-choice"),
     firstSheet.slice(0, 200));
  ok("the next batter comes in", await sendNext());
  const S4 = (await serverEvents()).at(-1);
  ok("...a new batter, at the end the partner left", S4?.kind === "batters" && ![S1, S2, S3, P].includes(S4.striker ?? S4.nonStriker), JSON.stringify(S4));
  await agree("still one wicket", { runs: onStrike ? 9 : 10, wickets: 1, balls: onStrike ? 8 : 9 });

  await openMenu("pad-retire-hurt");
  await tap(`retire-pick-${await endOf(S1)}`);
  await tap("retire-confirm");
  await settle();
  const second = await dialog();
  ok(`${names[S1]} retires too: the sheet offers the partner, whose retirement came first — and not ${names[S1]}`,
     /Retired hurt — may resume/i.test(second) && await has(`resume-${P}`) && !(await has(`resume-${S1}`)), second.slice(0, 240));
  ok("...no Law clause numbers", !lawNumbers(second));
  await tap(`resume-${P}`);
  await settle();
  const back2 = (await serverEvents()).at(-1);
  ok("the server takes him back at the empty end", back2?.kind === "batters" && (back2.striker === P || back2.nonStriker === P), JSON.stringify(back2));
  ok("...nothing held: the pad can score", !(await has("scoring-blocked")), await said("scoring-blocked"));
  await agree("two retirements and a return: still one wicket", { runs: onStrike ? 9 : 10, wickets: 1, balls: onStrike ? 8 : 9 });

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
console.log(`\n${"─".repeat(52)}\nBROWSER RETIRE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

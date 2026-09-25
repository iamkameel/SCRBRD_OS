#!/usr/bin/env node
/**
 * SCRBRD-084 — Season Awards / MVP, from a browser.
 *
 * `career` (services/api/read/read-api.mjs) sums directly off raw
 * `ball_event` rows through `player_batting_career` / `player_bowling_career`
 * (db/02_schema_scoring.sql) — no `innings_start`/`batters`/`bowler`
 * orchestration needed, unlike the fold GET /matches/:id/events replays. So
 * this walk writes plain `kind: 'ball'` rows directly, striker_id/bowler_id
 * set per row, the same shape db/98_seed_pilot.sql's own match uses for an
 * opposition bowler it holds no row for (bowler_id NULL) — here the same
 * trick the other way: a player's batting figures need no bowler on file,
 * and a bowler's figures need no opposition batter on file, so whichever
 * side this fixture is not naming rides as NULL rather than inventing a row.
 *
 * FIVE PLAYERS, EACH PROVING ONE RULE:
 *   Star Allrounder  — clears BOTH floors (packages/scoring's
 *                      MIN_BALLS_FACED / MIN_BALLS_BOWLED): on every table.
 *   Top Scorer       — batting only, comfortably above the batting floor.
 *   Leading Bowler   — bowling only, comfortably above the bowling floor.
 *   Thin Player      — 10 balls faced. On the plain run-scorer count (which
 *                      has no floor) and NOWHERE an index is ranked.
 *   Other Team Star  — a different team_code (10XI), with the single
 *                      highest run total on the platform: present when
 *                      nothing is scoped, gone the moment the Awards tab is
 *                      scoped to team 9XI.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-awards.mjs
 *   BROWSER_AWARDS_DEBUG=1 node tools/smoke-browser-awards.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 5303;
const API_PORT = 8803;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const DEBUG = !!process.env.BROWSER_AWARDS_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 200)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-awards-secret",
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
const q = async (t, p) => (await pool.query(t, p)).rows;

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

  group("Building five players' season figures directly on the ball log");
  const su = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;

  const mkPlayer = async (name, team) => (await q(
    `insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
     values ($1, $2, $3, 91, 'batter', current_date - interval '16 years') returning id`, [HIL, team, name]))[0].id;
  const SA = await mkPlayer("Star Allrounder", "9XI");
  const TS = await mkPlayer("Top Scorer", "9XI");
  const LB = await mkPlayer("Leading Bowler", "9XI");
  const TP = await mkPlayer("Thin Player", "9XI");
  const OT = await mkPlayer("Other Team Star", "10XI");

  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1, '9XI', 'Awards CC', now() - interval '3 days', 'T20', 20, 'complete') returning id`,
    [HIL]))[0].id;

  let seq = 0;
  // A plain `kind: 'ball'` row — no innings_start/batters/bowler needed, since
  // player_batting_career / player_bowling_career (db/02) sum straight off
  // striker_id / bowler_id per row, never through the JS fold. The opposite
  // side of whichever this row is about rides as NULL — the same discipline
  // db/98_seed_pilot.sql's own match uses for a bowler this platform holds no
  // row for, applied here to whichever side a figure is not about.
  const ball = ({ striker = null, bowler = null, value = 0, wicket = false }) => {
    seq += 1;
    return q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                               idempotency_key, client_seq, client_ts, kind, ball_type, value,
                               striker_id, bowler_id, dismissal, payload)
       values ($1,$2,$3,1,0,$4,'device-awards',$5,$3,now(),'ball',$6,$7,$8,$9,$10,'{}'::jsonb)`,
      [m, HIL, seq, su, `awards-${seq}`, wicket ? "W" : "run", value, striker, bowler, wicket ? "bowled" : null]);
  };
  // One helper for a batter's deliveries, one for a bowler's — the FK is
  // nullable on purpose (see the comment above) so each only ever names the
  // side this row is actually about.
  const battingRuns = async (playerId, count, value) => { for (let i = 0; i < count; i++) await ball({ striker: playerId, value }); };
  const bowlingRuns = async (playerId, count, value) => { for (let i = 0; i < count; i++) await ball({ bowler: playerId, value }); };
  const battingWicket = async (playerId) => ball({ striker: playerId, wicket: true });
  const bowlingWicket = async (playerId) => ball({ bowler: playerId, wicket: true });

  // Star Allrounder: 40 balls faced (39 for 39, then out) — clears the
  // 30-ball batting floor; 36 balls bowled, 6 wickets — exactly at the
  // 36-ball bowling floor ("at the floor a number appears", rating.test.mjs).
  await battingRuns(SA, 39, 1); await battingWicket(SA);
  await bowlingRuns(SA, 30, 1); for (let i = 0; i < 6; i++) await bowlingWicket(SA);

  // Top Scorer: batting only, well clear of the floor.
  await battingRuns(TS, 59, 2); await battingWicket(TS);

  // Leading Bowler: bowling only, well clear of the floor, more wickets than
  // anyone — but a worse economy than the allrounder, so this also proves the
  // index ranks the RATE, not the raw wicket count.
  await bowlingRuns(LB, 52, 1); for (let i = 0; i < 8; i++) await bowlingWicket(LB);

  // Thin Player: ten balls faced — below MIN_BALLS_FACED. A real score
  // (it counts on the plain run-scorer list, which has no floor) but never
  // enough of a sample for the index to speak about.
  await battingRuns(TP, 8, 2); await battingRuns(TP, 2, 0);

  // Other Team Star: the single highest run total on the platform, on a
  // DIFFERENT team — present the moment nothing is scoped, gone the moment
  // the tab is scoped to team 9XI.
  await battingRuns(OT, 65, 2); await battingWicket(OT);

  group("A director of sport opens Leagues and the Awards tab");
  const dos = await open();
  ok("signs in as the director of sport", await signIn(dos.page, /sarah@example\.invalid|Director/));
  ok("Leagues opens", await nav(dos.page, /Leagues/));
  ok("the Awards tab is offered", await click(dos.page, /^Awards$/i, 4000));
  // Wait for the DATA, not a fixed time: the lists come from /read/career,
  // and on a slower machine (CI) 1.2 s was not enough, so every name check
  // failed on an empty screen. A timeout here is not a pass: the checks
  // below still run and fail on whatever did render.
  await dos.page.waitForFunction(
    () => /Leading Bowler/.test(document.querySelector('[data-testid="season-awards"]')?.textContent ?? ""),
    null, { timeout: 20000 }).catch(() => {});
  const awards = dos.page.locator('[data-testid="season-awards"]');
  ok("the Awards screen renders", await awards.count() === 1);

  group("Unscoped: every real figure is on some list, the floor already applied");
  const allText = await awards.innerText();
  if (DEBUG) console.log("[debug] awards (all teams):\n" + allText);
  ok("the season's single highest scorer (a different team) is named",
     /Other Team Star/.test(allText));
  ok("a thin sample is still a real score on the run-scorers list", /Thin Player/.test(allText));
  ok("the leading wicket-taker is named", /Leading Bowler/.test(allText));
  const runScorersAll = await dos.page.locator('[data-testid="awards-run-scorers-row"]').allInnerTexts();
  ok("Other Team Star outranks Top Scorer on runs alone", runScorersAll.findIndex((t) => /Other Team Star/.test(t)) < runScorersAll.findIndex((t) => /Top Scorer/.test(t)), runScorersAll.join(" | "));

  group("The sample floor: a thin batting sample never reaches an index table");
  const battingIndexRows = await dos.page.locator('[data-testid="awards-batting-index-row"]').allInnerTexts();
  ok("Thin Player is on no index table", !battingIndexRows.some((t) => /Thin Player/.test(t)), battingIndexRows.join(" | "));
  const mvpRowsAll = await dos.page.locator('[data-testid="awards-mvp-row"]').allInnerTexts();
  ok("...nor the MVP table", !mvpRowsAll.some((t) => /Thin Player/.test(t)), mvpRowsAll.join(" | "));
  ok("the allrounder — both floors cleared — IS on the MVP table", mvpRowsAll.some((t) => /Star Allrounder/.test(t)));

  group("Scoped to team 9XI: the other team's star disappears entirely");
  ok("the team selector is offered", await dos.page.locator('[data-testid="awards-team-select"]').count() === 1);
  await dos.page.selectOption('[data-testid="awards-team-select"]', "9XI");
  // Same: wait until the scope has applied (the other team's star is gone and
  // this team's is shown), not a fixed 600 ms. On timeout the checks decide.
  await dos.page.waitForFunction(() => {
    const t = document.querySelector('[data-testid="season-awards"]')?.textContent ?? "";
    return !/Other Team Star/.test(t) && /Top Scorer/.test(t);
  }, null, { timeout: 20000 }).catch(() => {});
  const scopedText = await awards.innerText();
  if (DEBUG) console.log("[debug] awards (team 9XI):\n" + scopedText);
  ok("Other Team Star is gone from every list once scoped to 9XI", !/Other Team Star/.test(scopedText), scopedText.slice(0, 400));
  ok("Top Scorer is still here — the same team, unaffected by the scope narrowing", /Top Scorer/.test(scopedText));

  group("MVP: the batting specialist at the index ceiling outranks a blended, sub-ceiling rating");
  const mvpRowsScoped = await dos.page.locator('[data-testid="awards-mvp-row"]').allInnerTexts();
  ok("Top Scorer (batting index at its ceiling — see STAT_ANCHORS) ranks first once Other Team Star is scoped out",
     /Top Scorer/.test(mvpRowsScoped[0] ?? ""), mvpRowsScoped.join(" | "));
  ok("the allrounder is still on the table, ranked below the ceiling specialist",
     mvpRowsScoped.some((t) => /Star Allrounder/.test(t)) && mvpRowsScoped.findIndex((t) => /Star Allrounder/.test(t)) > 0,
     mvpRowsScoped.join(" | "));

  ok("no console errors on the director of sport's session", dos.errors.length === 0, dos.errors.join(" | "));
  await dos.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser awards walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 10).join("\n"));
} finally {
  await pool.end().catch(() => {});
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SEASON AWARDS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

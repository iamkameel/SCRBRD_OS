#!/usr/bin/env node
/**
 * The pad's penalty runs sheet (Law 41; SCRBRD-094 item 1: the screen), in a
 * real browser against a real API and Postgres, at a phone's 390 × 844.
 *
 * The engine was built first (the fold's cross-innings credit, the closed
 * list of reasons, lawsRefusal, db/48's SQL). This walk is the screen's proof
 * that what the scorer taps reaches the server in the shape the fold reads,
 * and that the board the scorer is looking at says what the server says:
 *
 *   A  five to the batting side, for two different reasons — the sheet asks
 *      the side first and then offers only that side's reasons, in words,
 *      with no Law clause numbers;
 *   B  five to the fielding side in the first innings: nobody's total moves,
 *      the pad says "Michaelhouse start their innings on 5" before that
 *      innings exists, a reload keeps it, and the second innings opens on 5;
 *   C  a short run in the chase: a delivery with no runs, then five to the
 *      fielding side — two rows, in order — and the target rises by five;
 *   D  an award to the fielding side mid-chase raises the target on the board
 *      and the first innings' total with it;
 *   E  once the chase is won, an award to the fielding side is refused in
 *      place, in words, with the Award button disabled — and nothing is sent;
 *   F  a reload keeps everything (the saved log).
 *
 * THE SERVER AGREES. At every step the board — as the screen reader hears it,
 * and the chase line under it — is held to the match's live score read
 * through the API (GET /api/read/live_score, the SQL fold db/48 brought into
 * line with penaltyCredits()), and the target to the broadcast read
 * (GET /api/read/broadcast_state, `innings_target_as_folded()`).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-penalty.mjs
 *   BROWSER_PENALTY_DEBUG=1 node tools/smoke-browser-penalty.mjs
 *   PENALTY_SHOTS=/some/dir node tools/smoke-browser-penalty.mjs   # screenshots, both themes
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

const WEB_PORT = 5341;
const API_PORT = 8841;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_PENALTY_DEBUG;
const SHOTS = process.env.PENALTY_SHOTS || null;
const DIST = process.env.PENALTY_DIST || "apps/web/dist";
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

const BATTING_REASONS = ["helmet_struck", "illegal_fielding", "ball_tampering", "fielding_time_wasting", "unfair_play", "fielding_restrictions", "other"];
let HOME = "";
const FIELDING_REASONS = ["obstruction_distraction", "pitch_damage", "protected_area", "striking_pitch", "time_wasting", "other"];

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-penalty-secret",
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

/** The server's rows for this match, in order, as events. */
const serverEvents = async () =>
  (await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [MATCH])).map(fromRow);

/** A reader's token (the 1XI coach), for the API reads the walk checks the board against. */
let coachToken = null;
async function read(resource) {
  coachToken ??= (await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "coach@example.invalid", deviceId: "penalty-walk-coach" }) })).json())?.token;
  const r = await fetch(`${API}/api/read/${resource}?matchId=${MATCH}`, { headers: { authorization: `Bearer ${coachToken}` } });
  const rows = (await r.json().catch(() => ({})))?.rows ?? [];
  return rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : v])));
}
/** The live score through the API: innings number → {runs, wickets, legal_balls}. */
const liveScore = async () => Object.fromEntries((await read("live_score")).map((r) => [r.innings, r]));
/** The board's target through the API (broadcast_state: the fold's `inn.target`). */
const liveTarget = async () => (await read("broadcast_state"))[0]?.target ?? null;

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

/** The pad's board, as the screen reader hears it: "11 for 0, 1.2 overs". */
const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
const parseBoard = (b) => { const m = b.match(/^(\d+) for (\d+), (\d+)\.(\d) overs$/); return m ? { runs: +m[1], wickets: +m[2], balls: +m[3] * 6 + +m[4] } : null; };
/** The target the board shows: "Need 14 off 118" + the total, or null outside a chase. */
const boardTarget = async () => {
  const sub = await said("board-sub");
  const need = sub.match(/Need (\d+) off/);
  const b = parseBoard(await board());
  if (/Target reached/.test(sub)) return "reached";
  return need && b ? Number(need[1]) + b.runs : null;
};

/** The pad's own prompts, answered: a bowler, the next batter, the openers. */
let batterCounter = 0;
const clearBlockers = async () => {
  for (let i = 0; i < 12; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const next = page.locator("button:not([disabled])", { hasText: /Next\s*$/i });
    if (await next.count()) { try { await next.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    const body = await text();
    if (/Available to Bat|Batting Order/i.test(body)) {
      // Michaelhouse has no seeded roster: its batters are typed.
      const nameField = page.locator('input[aria-label="Player name"]');
      if (await nameField.count()) {
        try { batterCounter++; await nameField.fill(`Batter ${batterCounter}`); await nameField.press("Enter"); } catch {}
        await page.waitForTimeout(500);
        continue;
      }
    }
    if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
      const field = page.locator("input[placeholder*='name' i], input[placeholder*='Search bowler' i]").last();
      if (await field.count()) {
        try {
          await field.fill(`Bowler ${Math.floor(Math.random() * 1e6)}`);
          await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 1500 });
        } catch {}
        await page.waitForTimeout(600);
        continue;
      }
    }
    return;
  }
};
/** Until the pad says nothing is missing. */
const makeReady = async () => {
  for (let i = 0; i < 8; i++) {
    await clearBlockers();
    if (!(await has("scoring-blocked-fix"))) {
      if (!/Batting Order|Opening Bowler|Over \d+ Complete|Available to Bat/i.test(await text())) return true;
      continue;
    }
    try { await tid("scoring-blocked-fix").first().click({ timeout: 2000 }); } catch {}
    await page.waitForTimeout(700);
  }
  return false;
};
const basicPad = async () => {
  if (!(await has("basic-pad"))) { await tap("pad-menu").catch(() => {}); await tap("pad-basic-scoring").catch(() => {}); }
  await page.waitForTimeout(300);
};
/** Let the outbox send and the server answer. */
const settle = async () => { await page.waitForTimeout(2600); };

/** The board, the server's rows and the API's live score say the same. */
const agree = async (label, innings) => {
  await settle();
  const b = parseBoard(await board());
  const live = (await liveScore())[innings];
  ok(`${label}: the board and the live score through the API agree (${await board()})`,
     !!b && !!live && live.runs === b.runs && live.wickets === b.wickets && live.legal_balls === b.balls,
     `board ${JSON.stringify(b)} / api ${JSON.stringify(live)}`);
  return { b, live };
};

const openSheet = async (item) => { await tap("pad-menu"); await tap(item); await page.waitForTimeout(300); };
const closeSheet = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(400); };
const shownReasons = async () => (await page.locator('[data-testid^="penalty-reason-"]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace("penalty-reason-", "")))).sort();
const lawNumbers = (s) => /\bLaws? \d|\(Law|\b\d+\.\d+(\.\d+)?\b(?! overs)/.test(s);
const awardEnabled = async () => !(await tid("penalty-award").isDisabled());

/** Screenshots of one state in both themes, at 390 × 844 (PENALTY_SHOTS only). */
async function shoot(name, open) {
  if (!SHOTS) return;
  // The theme is on the pad's menu, behind any sheet: close the sheet, shoot
  // it in each theme, and leave it as it was found.
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

/** One wicket through the sheet (bowled, the sheet's default). */
const takeWicket = async () => {
  await clearBlockers();
  if (!(await click(/Wicket/, 2500))) return false;
  await page.waitForTimeout(400);
  for (let a = 0; a < 4; a++) {
    if (await has("wicket-confirm")) { await tap("wicket-confirm"); break; }
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(500);
  return true;
};

try {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // The home side bats first (SCRBRD-067), and the board is published, so
  // broadcast_state() answers for the match (its target is the fold's).
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1 on conflict (match_id) do nothing`, [MATCH]);
  await dbq(`insert into match_broadcast (match_id, school_id, published)
             select id, school_id, true from match where id = $1 on conflict (match_id) do update set published = true`, [MATCH]);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the pad on a real fixture, at 390 × 844");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));
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
  await clearBlockers();
  await basicPad();
  ok("the scorer opens on the pad", /\bDOT\b/i.test(await text()));
  ok("the openers and the bowler are named on the pad's own sheets", await makeReady());
  await click(/^1$/); await click(/^2$/);
  const s0 = await agree("two balls in", 0);
  ok("...3 for 0 off two balls", s0.b?.runs === 3 && s0.b?.balls === 2, await board());

  // ── A ────────────────────────────────────────────────────────
  group("A. Five to the batting side: the side first, then only its reasons, in words");
  await openSheet("pad-penalty");
  ok("the menu opens the penalty sheet", await has("penalty-sheet"));
  // The home side's name as the fixture has it (the 1XI), read off the sheet.
  HOME = (await said("penalty-side-batting")).split("\n").map((x) => x.trim()).filter(Boolean)[1] ?? "";
  ok(`...offering both sides by name (${HOME} and Michaelhouse)`, HOME.length > 0 && /Michaelhouse/i.test(await said("penalty-side-fielding")),
     `${await said("penalty-side-batting")} | ${await said("penalty-side-fielding")}`);
  ok("...no reason before a side is chosen", (await shownReasons()).length === 0);
  ok("...and Award disabled, saying what is missing", !(await awardEnabled()) && /Choose who gets the five runs/.test(await said("penalty-hint")));
  await tap("penalty-side-batting");
  await shoot("side-chosen", async () => { await openSheet("pad-penalty"); await tap("penalty-side-batting"); });
  const batReasons = await shownReasons();
  ok(`the batting side is offered exactly its own reasons (${batReasons.length})`,
     JSON.stringify(batReasons) === JSON.stringify([...BATTING_REASONS].sort()), batReasons.join(","));
  ok("...none of the fielding side's", !batReasons.some((r) => FIELDING_REASONS.includes(r) && r !== "other"));
  ok("...nor short running, which is its own action", !(await has("penalty-short-run")));
  const sheetText = await said("penalty-sheet");
  ok("the reasons are in words", /The ball striking a fielder's helmet on the ground/.test(sheetText) && /Changing the condition of the ball/.test(sheetText));
  ok("...with no Law clause numbers anywhere on the sheet", !lawNumbers(sheetText), sheetText.match(/.{0,30}(Law|\d+\.\d+).{0,30}/)?.[0]);
  ok("...and where the runs go, said", (await said("penalty-where")) === `Added to ${HOME}'s total now.`);
  ok("Award waits for a reason", !(await awardEnabled()) && /Choose what the runs are for/.test(await said("penalty-hint")));
  await tap("penalty-reason-helmet_struck");
  ok("a reason chosen: Award is enabled, naming the side", await awardEnabled() && (await said("penalty-award")) === `Award 5 to ${HOME}`);
  ok("...and the umpires' report is one line, not a form", /umpires report the offence to the offending side/i.test(await said("penalty-report-note")));
  const rowsA0 = (await serverEvents()).length;
  await tap("penalty-award");
  ok("the sheet closes on the award", !(await has("penalty-sheet")));
  const a1 = await agree("helmet struck", 0);
  ok("...8 for 0: five more, no ball", a1.b?.runs === 8 && a1.b?.balls === 2, await board());
  let evs = await serverEvents();
  let last = evs.at(-1);
  ok("the server has one more row: a penalty, 5 to the batting side, helmet struck",
     evs.length === rowsA0 + 1 && last?.kind === "penalty" && last.runs === 5 && last.toBattingTeam === true && last.reason === "helmet_struck", JSON.stringify(last));

  await openSheet("pad-penalty");
  await tap("penalty-side-batting");
  await tap("penalty-reason-ball_tampering");
  await tap("penalty-award");
  const a2 = await agree("ball tampering", 0);
  ok("...13 for 0", a2.b?.runs === 13, await board());
  last = (await serverEvents()).at(-1);
  ok("the server has the second award, for changing the condition of the ball",
     last?.kind === "penalty" && last.toBattingTeam === true && last.reason === "ball_tampering", JSON.stringify(last));

  // ── B ────────────────────────────────────────────────────────
  group("B. Five to the fielding side in the first innings: Michaelhouse will start on 5");
  await openSheet("pad-penalty");
  await tap("penalty-side-fielding");
  const fieldReasons = await shownReasons();
  ok(`the fielding side is offered exactly its own reasons (${fieldReasons.length})`,
     JSON.stringify(fieldReasons) === JSON.stringify([...FIELDING_REASONS].sort()), fieldReasons.join(","));
  ok("...and short running as its own action", /Short run: the umpire gave five to the fielding side/.test(await said("penalty-short-run")));
  ok("...saying where the runs go", /Michaelhouse start their innings on 5/.test(await said("penalty-where")));
  await tap("penalty-reason-pitch_damage");
  await shoot("reasons", async () => { await openSheet("pad-penalty"); await tap("penalty-side-fielding"); await tap("penalty-reason-pitch_damage"); });
  ok("no Law clause numbers on the fielding side either", !lawNumbers(await said("penalty-sheet")));
  await tap("penalty-award");
  const b1 = await agree("pitch damage, to the fielding side", 0);
  ok("...the batting side's total does not move (13)", b1.b?.runs === 13, await board());
  last = (await serverEvents()).at(-1);
  ok("the server has a penalty to the fielding side, for damaging the pitch",
     last?.kind === "penalty" && last.toBattingTeam === false && last.reason === "pitch_damage" && last.innings === 0, JSON.stringify(last));
  ok("the pad says the credit is pending, in words, before that innings exists",
     /Michaelhouse start their innings on 5/.test(await said("pad-penalty-pending")), await said("pad-penalty-pending"));
  ok("...and the API has no second innings yet", (await liveScore())[1] == null);
  await shoot("pending", null);

  group("F. A reload keeps the awards and the pending credit");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await basicPad();
  ok("after the reload the board is the same (13 for 0)", parseBoard(await board())?.runs === 13, await board());
  ok("...and the pending line is back", /Michaelhouse start their innings on 5/.test(await said("pad-penalty-pending")));

  // ── Close the first innings ──────────────────────────────────
  group("The first innings ends; the break says Michaelhouse start on 5");
  let reviewOpen = false;
  for (let i = 0; i < 11 && !reviewOpen; i++) {
    await takeWicket();
    reviewOpen = await has("innings-review");
    if (!reviewOpen) await clearBlockers();
  }
  ok("wickets through the sheet ended the innings (the review opened)", reviewOpen);
  const first = parseBoard(await board());
  const firstLive = (await agree("first innings over", 0)).live;
  await tap("review-confirm");
  await page.waitForTimeout(800);
  ok("the break sheet says the chase opens on the credit",
     /Michaelhouse start their innings on 5 \(penalty runs\)/.test(await said("innings2-penalty-note")), await said("innings2-penalty-note"));
  const breakTarget = Number(((await page.locator('[role="dialog"]').first().innerText().catch(() => "")) || "").match(/need\s*\n?\s*(\d+)/i)?.[1]);
  ok(`the target at the break is the first innings' credited total + 1 (${breakTarget})`, breakTarget === first.runs + 1 && breakTarget === firstLive.runs + 1);
  ok("...and the pending line is still said under the board", await has("pad-penalty-pending"));
  await click(/Start 2nd Innings/, 4000);
  await page.waitForTimeout(800);
  await clearBlockers();
  await basicPad();
  ok("the second innings opens on 5, before a ball", /^5 for 0, 0\.0 overs$/.test(await board()), await board());
  ok("...the pending line is gone: it is in the total now", !(await has("pad-penalty-pending")));
  ok("the board's target is the break's", (await boardTarget()) === breakTarget, `${await boardTarget()} / ${breakTarget}`);
  await settle();
  const live1 = (await liveScore())[1];
  ok("the API's live score has the second innings on 5", live1?.runs === 5 && live1?.legal_balls === 0, JSON.stringify(live1));
  ok("...and the API's target is the board's", (await liveTarget()) === breakTarget, `${await liveTarget()} / ${breakTarget}`);

  // ── C ────────────────────────────────────────────────────────
  group("C. A short run in the chase: the delivery with no runs, then five to the side that batted first");
  ok("the pad is ready for the chase", await makeReady());
  await click(/^1$/);
  const c0 = await agree("one run in the chase", 1);
  ok("...6 for 0", c0.b?.runs === 6, await board());
  const rowsC0 = (await serverEvents()).length;
  await openSheet("pad-short-run");
  ok("the menu's Short run opens its own sheet", await has("short-run-sheet"));
  ok("...saying what it does, in words", /The delivery counts, with no runs/.test(await said("short-run-sheet")) && (await said("short-run-sheet")).includes(`Five penalty runs go to ${HOME}`));
  ok("...naming who faced it and who bowled it", /Faced by .+ bowled by /.test(await said("short-run-crease")), await said("short-run-crease"));
  ok("...and no Law clause numbers", !lawNumbers(await said("short-run-sheet")));
  await tap("short-run-type-run");
  await shoot("short-run", async () => { await openSheet("pad-short-run"); await tap("short-run-type-run"); });
  const targetC0 = await boardTarget();
  await tap("short-run-confirm");
  const c1 = await agree("after the short run", 1);
  ok("...a ball faced, no run: 6 for 0 off two", c1.b?.runs === 6 && c1.b?.balls === 2, await board());
  evs = await serverEvents();
  const [sb, sp] = evs.slice(-2);
  ok("the server has two more rows, in order", evs.length === rowsC0 + 2);
  ok("...the delivery, no runs, in the chase", sb?.kind === "ball" && sb.type === "run" && (sb.value ?? 0) === 0 && sb.innings === 1, JSON.stringify(sb));
  ok("...then five to the fielding side, for short running", sp?.kind === "penalty" && sp.toBattingTeam === false && sp.reason === "short_running" && sp.runs === 5 && sp.innings === 1, JSON.stringify(sp));
  const targetC1 = await boardTarget();
  ok(`the board's target rose by five (${targetC0} → ${targetC1})`, targetC1 === targetC0 + 5);
  ok("...and so did the API's", (await liveTarget()) === targetC1, `${await liveTarget()} / ${targetC1}`);
  ok("...and the first innings' total through the API", (await liveScore())[0]?.runs === firstLive.runs + 5, JSON.stringify((await liveScore())[0]));

  // ── D ────────────────────────────────────────────────────────
  group("D. Five to the fielding side mid-chase: the target rises on the board");
  await openSheet("pad-penalty");
  await tap("penalty-side-fielding");
  ok("the sheet says the target rises", (await said("penalty-where")) === `Added to ${HOME}'s total. The target rises by 5.`, await said("penalty-where"));
  await tap("penalty-reason-time_wasting");
  await tap("penalty-award");
  const d1 = await agree("time wasting, mid-chase", 1);
  ok("...the chase's own total does not move", d1.b?.runs === 6, await board());
  const targetD = await boardTarget();
  ok(`the board's target rose by five again (${targetC1} → ${targetD})`, targetD === targetC1 + 5);
  ok("...the API's target is the board's", (await liveTarget()) === targetD, `${await liveTarget()} / ${targetD}`);
  ok("...and the first innings' total through the API rose with it", (await liveScore())[0]?.runs === firstLive.runs + 10);
  last = (await serverEvents()).at(-1);
  ok("the server has the award, to the fielding side, for a batter wasting time", last?.kind === "penalty" && last.toBattingTeam === false && last.reason === "time_wasting");

  // ── E ────────────────────────────────────────────────────────
  group("E. The chase is won; an award to the fielding side is refused in place, and nothing is sent");
  let won = false;
  for (let i = 0; i < 30 && !won; i++) {
    await clearBlockers();
    won = await has("innings-review");
    if (won) break;
    await click(/^6$/, 2000);
    await page.waitForTimeout(300);
  }
  ok("sixes reached the target and the review opened", won && /target/i.test(await said("review-reason")), await said("review-reason"));
  await closeSheet();
  ok("the review closes to the pad, the innings over and not yet sealed", !(await has("innings-review")));
  const rowsE0 = (await serverEvents()).length;
  const boardE0 = await board();
  await openSheet("pad-penalty");
  await tap("penalty-side-fielding");
  const early = await said("penalty-refusal");
  ok("the refusal is said as soon as the side is chosen, before a reason", /The match is decided/.test(early), early);
  ok("...in place of where the runs would go", !(await has("penalty-where")));
  await tap("penalty-reason-protected_area");
  const refusal = await said("penalty-refusal");
  ok("the Laws' refusal is on the sheet, in words", /The match is decided/.test(refusal), refusal);
  ok("...with no Law clause numbers", !lawNumbers(refusal));
  ok("Award is disabled, not hidden", await has("penalty-award") && !(await awardEnabled()));
  ok("...and described by the refusal",
     (await tid("penalty-award").getAttribute("aria-describedby")) === (await tid("penalty-refusal").getAttribute("id")));
  await shoot("refused", async () => { await openSheet("pad-penalty"); await tap("penalty-side-fielding"); await tap("penalty-reason-protected_area"); });
  await shoot("refused-award", async () => {
    await openSheet("pad-penalty"); await tap("penalty-side-fielding"); await tap("penalty-reason-protected_area");
    await tid("penalty-award").scrollIntoViewIfNeeded();
  });
  await tid("penalty-award").click({ force: true, timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok("a forced tap on it does nothing: the sheet stays", await has("penalty-sheet"));
  await closeSheet();
  await settle();
  ok("nothing was sent: the server has the same rows", (await serverEvents()).length === rowsE0);
  ok("...and the board did not move", (await board()) === boardE0, `${boardE0} / ${await board()}`);
  ok("the batting side's award is not refused after the result (as the Laws have it)", await (async () => {
    await openSheet("pad-penalty"); await tap("penalty-side-batting"); await tap("penalty-reason-other");
    const r = !(await has("penalty-refusal")) && await awardEnabled();
    await closeSheet();
    return r;
  })());

  // ── F ────────────────────────────────────────────────────────
  group("F. A reload keeps everything");
  const before = { board: await board(), sub: await said("board-sub") };
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2800);
  await basicPad();
  ok(`the board is the same after the reload (${await board()})`, (await board()) === before.board, `${before.board} / ${await board()}`);
  ok("...and so is the chase line", (await said("board-sub")) === before.sub, `${before.sub} / ${await said("board-sub")}`);
  const fin = await agree("after the reload", 1);
  const liveEnd = await liveScore();
  ok("the API's first innings has both awards to the side that batted first in it", liveEnd[0]?.runs === firstLive.runs + 10, JSON.stringify(liveEnd[0]));
  ok("...and the chase has its opening five", fin.live?.runs === fin.b?.runs && fin.b?.runs >= 5);

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
console.log(`\n${"─".repeat(52)}\nBROWSER PENALTY SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

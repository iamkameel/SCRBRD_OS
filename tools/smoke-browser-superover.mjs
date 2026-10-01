#!/usr/bin/env node
/**
 * The super over on the pad and the Match Centre (SCRBRD-114 phase 3b, the
 * Sonnet items: docs/design/SCRBRD-114_phase3_results_super_over.md §3.5,
 * §3.6, §4, §11.3), in a real browser against a real API and Postgres, at a
 * phone's 390 × 844:
 *
 *   A  A tied cup match scored on the pad: the result screen words it as the
 *      engine does ("Match tied"), and offers the Super over button — the
 *      match's conditions provide one, its last pair is level and sealed
 *   B  The button opens its sheet: the standard order (the side that batted
 *      second bats first), the one-line notice when the order is changed,
 *      one over and two wickets, and what the pad does not record, said once
 *   C  The first innings of the pair: the board's block — the target, the
 *      balls left, the wickets left of two — and two wickets end it (the
 *      review, the seal, the chase's sheet with the target)
 *   D  The chase, tied again: the result screen words it ("the super over
 *      tied") and offers the next
 *   E  The second super over: the batter who was out, and the bowler, of the
 *      first are named in words (and can still be chosen: the umpires
 *      decide), the pair is played to a decision, and the result line reads
 *      as the engine words it
 *   F  What the server holds: the markers, the seals, GET /result
 *   G  The scorecard block: on the pad's result screen and the Match Centre,
 *      below the match's innings and never mixed into their figures
 *   H  A league tie (a friendly whose conditions provide no super over):
 *      no button, and the engine's words why
 *   I  The public page: the same block, signed out
 *
 * Every date is explicit (3 October 2026, the 4th Edition); nothing reads the
 * clock. 12px and 44px are measured on what this adds.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-superover.mjs
 *   BROWSER_SUPEROVER_DEBUG=1 node tools/smoke-browser-superover.mjs
 *   SUPEROVER_SHOTS=/some/dir node tools/smoke-browser-superover.mjs   # screenshots
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { REFUSAL_TEXT } from "@scrbrd/scoring";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(5391);
const API_PORT = port(8891);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const DEBUG = !!process.env.BROWSER_SUPEROVER_DEBUG;
const SHOTS = process.env.SUPEROVER_SHOTS || null;
const DIST = process.env.SUPEROVER_DIST || "apps/web/dist";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const OWNER = "88888888-0000-0000-0000-000000000022";
const STARTS = "2026-10-03T10:00:00+02:00";     // the 4th Edition, by its date
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-superover-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
         // The public page is served by the API itself, same-origin (browser-public does the same).
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-superover-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1",
         SERVE_CLIENT: DIST },
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

let token = null;
async function get(path) {
  token ??= (await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "sarah@example.invalid", deviceId: "superover-walk-sarah" }) })).json())?.token;
  const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
// event it sends is one the Laws and the match's conditions take.
const refusedBy = [];
page.on("response", async (r) => {
  if (r.request().method() !== "POST" || !/\/api\/matches\/[^/]+\/events$/.test(r.url())) return;
  const body = await r.json().catch(() => null);
  for (const x of body?.refused ?? []) refusedBy.push(`${x.idempotencyKey}: ${x.reason}`);
});

const text = () => page.$eval("body", (el) => el.innerText);
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const has = async (id) => (await tid(id).count()) > 0;
const said = async (id) => ((await tid(id).first().innerText({ timeout: 2500 }).catch(() => "")) || "").trim();
const tap = async (id, ms = 5000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(350); };
const click = async (re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const settle = async () => { await page.waitForTimeout(2600); };
const boardSub = () => said("board-sub");

let typed = 0;
const typeIn = async (label) => {
  const f = page.locator(`[role="dialog"] input[aria-label="${label}"]`);
  if (!(await f.count())) return false;
  typed++; await f.fill(`${label === "Player name" ? "Batter" : "Bowler"} ${typed}`);
  await page.locator('[role="dialog"] button:not([disabled])', { hasText: /^Go$/ }).first().click({ timeout: 2000 });
  await page.waitForTimeout(500);
  return true;
};

/**
 * Answer whatever the pad is asking — a batter, a bowler — until it is ready
 * to score or stops at a sheet this walk wants to look at. A roster is
 * picked from (a name with no note beside it); a side with no roster is typed.
 */
async function fillCrease(stopAt = null) {
  for (let i = 0; i < 14; i++) {
    if (await has("innings-review") || await has("innings2-start") || await has("superover-confirm")) return;
    const dlg = page.locator('[role="dialog"]');
    if (!(await dlg.count())) {
      if (await has("scoring-blocked-fix")) { await tap("scoring-blocked-fix").catch(() => {}); continue; }
      return;
    }
    const title = ((await dlg.locator("h2").first().innerText().catch(() => "")) || "").trim();
    if (stopAt && stopAt.test(title)) return;
    if (/Batting Order/.test(title)) {
      const pick = page.locator('[role="dialog"] [data-testid="batter-choice"]:not(:has([data-testid="batter-superover-note"]))').first();
      if (await pick.count()) { await pick.click({ timeout: 2000 }); await page.waitForTimeout(500); }
      else if (!(await typeIn("Player name"))) return;
    } else if (/Opening Bowler|Over \d+ Complete|Change of Bowler/.test(title)) {
      const pick = page.locator('[role="dialog"] [data-testid="bowler-choice"]:not([disabled]):not(:has([data-testid="bowler-superover-note"]))').first();
      if (await pick.count()) { await pick.click({ timeout: 2000 }); await page.waitForTimeout(500); }
      else if (!(await typeIn("Bowler name"))) return;
    } else return;
  }
}

/** One ball: a figure for the runs off the bat, "W" for a wicket (bowled). */
async function ball(v) {
  await fillCrease();
  await basicPad();
  if (v === "W") { await tap("key-wicket"); await tap("wicket-confirm"); }
  else await tap(`run-${v}`);
  await page.waitForTimeout(250);
}
const balls = async (vs) => { for (const v of vs) await ball(v); };
/** The review sheet, confirmed: the innings closed. */
async function closeInnings() {
  for (let i = 0; i < 6 && !(await has("innings-review")); i++) await page.waitForTimeout(400);
  await tap("review-confirm");
  await page.waitForTimeout(500);
}

const basicPad = async () => {
  if (!(await has("basic-pad"))) { await tap("pad-menu").catch(() => {}); await tap("pad-basic-scoring").catch(() => {}); }
  await page.waitForTimeout(300);
};
const openScorer = async (matchId) => {
  await page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const opened = await page.evaluate((id) => {
    const card = document.querySelector(`[data-testid="match-card-${id}"]`);
    const b = [...(card?.querySelectorAll("button") ?? [])].find((x) => /Start Scoring|Open Live Scorer/i.test(x.textContent || ""));
    if (!b) return false;
    b.click();
    return true;
  }, matchId);
  await page.waitForTimeout(2800);
  if (opened) await basicPad();
  return opened;
};

/** 12px and 44px on what this adds, inside `roots`. */
async function floors(roots) {
  return page.evaluate((sel) => {
    const small = [], tiny = [];
    for (const root of document.querySelectorAll(sel)) {
      for (const n of [root, ...root.querySelectorAll("*")]) {
        if (n.closest(".sr-only")) continue;
        const cs = getComputedStyle(n);
        const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
        if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))) {
          const r = n.getBoundingClientRect();
          if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
        }
      }
    }
    return { small, tiny };
  }, roots);
}
const shoot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };

const serverRows = async (match) => dbq(`select innings, kind, payload, seq from ball_event where match_id = $1 order by seq`, [match]);
const upper = (s) => s[0].toUpperCase() + s.slice(1);

try {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── The fixtures ───────────────────────────────────────────────
  // A cup: its published conditions send a tie to a super over. A friendly:
  // the platform's defaults, which do not. One over a side in both.
  const [{ id: cup }] = await dbq(`insert into competition (school_id, name, comp_type, format, level) values ($1, 'Walk Shield', 'knockout', 'T20', 'school') returning id`, [HIL]);
  for (const [school, name] of [[HIL, "Walk Hilton 1st XI"], [WES, "Walk Westville 1st XI"]]) {
    await dbq(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, '1XI', $3)`, [cup, school, name]);
  }
  const [{ id: set }] = await dbq(`insert into condition_set (competition_id, version, title, effective_from, created_by) values ($1, 1, 'Walk Shield v1', '2026-09-28', $2) returning id`, [cup, OWNER]);
  await dbq(`insert into condition_value (set_id, key, value, status, source_document, source_clause, source_date, entered_by)
             values ($1, 'result.tie_break', '"super_over"', 'confirmed', 'Pilot league decision, Kameel', '8.3a', '2026-09-30', $2)`, [set, OWNER]);
  await dbq(`update condition_set set status = 'published', published_by = $2, published_at = '2026-09-27 12:00+02' where id = $1`, [set, OWNER]);
  const [M] = await dbq(`insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status, competition_id)
                         values ($1, '1XI', $2, '1XI', 'Shield Rivals', $3, 'cricket', 'T20', 1, 'scheduled', $4) returning id`, [HIL, WES, STARTS, cup]);
  const [G] = await dbq(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
                         values ($1, '1XI', 'Friendlywalk Rivals', $2, 'cricket', 'T20', 1, 'scheduled') returning id`, [HIL, STARTS]);
  for (const m of [M, G]) {
    await dbq(`insert into match_toss (match_id, school_id, won_by, decision) values ($1, $2, 'home', 'bat')`, [m.id, HIL]);
  }
  const fold = (await get(`/api/matches/${M.id}/events?since=2147483647`)).body?.fold;
  ok("the cup match's document provides a super over, limited overs",
     fold?.conditions?.["result.tie_break"] === "super_over" && fold?.conditions?.["format.kind"] === "limited", JSON.stringify(fold?.conditions));

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));

  // ── A ────────────────────────────────────────────────────────
  group("A. A tied cup match scored on the pad: the result as the engine words it, and the button");
  ok("the cup fixture offers the scorer", await openScorer(M.id));
  await fillCrease();
  ok("the pad is ready", !(await has("scoring-blocked")), await said("scoring-blocked"));
  await balls([1, 1, 1, 1, 1, 1]);            // the first innings: six
  await closeInnings();
  await tap("innings2-start");                // the chase of 7
  await balls([1, 1, 1, 1, 1]);
  ok("mid-chase the match is not level: nothing is offered", !(await has("pad-superover-offer")) && !(await has("pad-superover-why")));
  await ball(1);                              // six: level
  await closeInnings();
  await page.waitForTimeout(600);
  ok("the result screen words it as the engine does: Match tied", (await said("pad-result")) === "Match tied", await said("pad-result"));
  ok("the Super over button is offered", (await said("pad-superover-start")) === "Super over");
  const offerWords = await said("pad-superover-words");
  ok("...with the match's conditions in words: they provide a super over, and who bats first",
     /^Match tied\. This match's playing conditions provide a super over: .+ bat first\.$/.test(offerWords), offerWords);
  const first = await dbq(`select payload->>'battingTeam' bat from ball_event where match_id = $1 and kind = 'innings_start' and innings = 1`, [M.id]);
  ok("...the side that batted second, by the standard order", offerWords.includes(`${first[0].bat} bat first`), offerWords);
  let f = await floors('[data-testid="pad-superover-offer"]');
  ok("12px and 44px on the strip", !f.small.length && !f.tiny.length, JSON.stringify(f));
  const r0 = await get(`/api/matches/${M.id}/result`);
  ok("the server agrees: a tie nobody has decided", r0.body?.result?.outcome === "tie" && r0.body.result.decidedBy === null, JSON.stringify(r0.body?.result));
  await shoot("1-offer");

  // ── B ────────────────────────────────────────────────────────
  group("B. The button opens its sheet: the standard order, one over, two wickets, and what is not recorded");
  await tap("pad-superover-start");
  ok("the sheet is Super over 1", (await page.locator('[role="dialog"] h2').first().innerText()) === "Super over 1");
  const standardWords = await said("superover-order-standard");
  ok("the standard order is the first choice, named so", standardWords.replace(/^\S*\s*/, "").startsWith(`${first[0].bat} bat first (the standard order)`) || standardWords.includes(`${first[0].bat} bat first (the standard order)`), standardWords);
  ok("...no notice while it is", !(await has("superover-standard-notice")));
  await tap("superover-order-other");
  ok("the order changed: one line says what the standard is", /^The standard order is .+ first\./.test(await said("superover-standard-notice")), await said("superover-standard-notice"));
  await tap("superover-order-standard");
  ok("...and chosen back, the line goes", !(await has("superover-standard-notice")));
  const sheet = await said("superover-sheet");
  ok("one over, and two wickets end an innings", /one over/.test(sheet) && /Two wickets end an innings/.test(sheet), sheet);
  ok("what the pad does not record is said, once", /does not record the ends, the interval, fielding restrictions or nominated batters/.test(await said("superover-not-recorded")));
  ok("no eligibility words for the first", !(await has("superover-eligibility")));
  f = await floors('[data-testid="superover-sheet"]');
  ok("12px and 44px on the sheet", !f.small.length && !f.tiny.length, JSON.stringify(f));
  await shoot("2-sheet");
  await tap("superover-confirm");
  await fillCrease();
  await basicPad();
  await settle();
  const so1 = await dbq(`select innings, payload from ball_event where match_id = $1 and kind = 'innings_start' and innings = 2`, [M.id]);
  ok("the first super over opened at innings 2 with its marker, one over", so1.length === 1 && so1[0].payload.superOver === 1 && so1[0].payload.overs === 1, JSON.stringify(so1));

  // ── C ────────────────────────────────────────────────────────
  group("C. The first innings of the pair: the board's block, and two wickets end it");
  ok("the header says which innings this is", /Super over 1 · first innings · 1ov/.test(await said("pad-titlebar")), (await said("pad-titlebar")).slice(0, 120));
  ok("the board: 6 balls left, 2 wickets left of 2", (await boardSub()) === "Super over 1 · 6 balls left · 2 wickets left of 2", await boardSub());
  await balls([4, 1]);
  ok("after two balls: 4 left", (await boardSub()) === "Super over 1 · 4 balls left · 2 wickets left of 2", await boardSub());
  await ball("W");
  await fillCrease();
  ok("a wicket: 1 wicket left of 2", (await boardSub()) === "Super over 1 · 3 balls left · 1 wicket left of 2", await boardSub());
  await ball(1);
  await ball("W");
  ok("the second wicket ends the innings: the review opens", await has("innings-review"));
  ok("...its title names the super over's first innings", /^Super over 1, first innings — check before closing/.test(await page.locator('[role="dialog"] h2').first().innerText()));
  ok("...6 for 2, all out", (await said("review-score")) === "6/2" && /All out/i.test(await said("review-reason")), `${await said("review-score")} ${await said("review-reason")}`);
  ok("...and the board behind it: no wickets left of 2", /no wickets left of 2/.test(await boardSub()), await boardSub());
  await closeInnings();
  const chaseSheet = await page.locator('[role="dialog"]').innerText();
  ok("the chase's sheet follows: Super over 1, what the first made, and the target 7",
     /^Super over 1/.test(await page.locator('[role="dialog"] h2').first().innerText()) && (await said("innings2-lead")).includes("made 6 for 2") && /\b7\b/.test(chaseSheet), chaseSheet);
  await shoot("3-chase");
  await tap("innings2-start");

  // ── D ────────────────────────────────────────────────────────
  group("D. The chase, tied again: the next super over is offered");
  await fillCrease();
  await basicPad();
  await settle();
  const so1b = await dbq(`select payload from ball_event where match_id = $1 and kind = 'innings_start' and innings = 3`, [M.id]);
  ok("the chase opened at innings 3: the same marker, the target 7", so1b.length === 1 && so1b[0].payload.superOver === 1 && so1b[0].payload.target === 7, JSON.stringify(so1b));
  ok("the board: need 7 off 6, 2 wickets left of 2", (await boardSub()) === "Super over 1 · Need 7 off 6 · 2 wickets left of 2", await boardSub());
  await ball(1);
  ok("one off the first: need 6 off 5", (await boardSub()) === "Super over 1 · Need 6 off 5 · 2 wickets left of 2", await boardSub());
  await ball("W");
  await fillCrease();
  ok("a wicket: need 6 off 4, 1 wicket left of 2", (await boardSub()) === "Super over 1 · Need 6 off 4 · 1 wicket left of 2", await boardSub());
  await balls([1, 1, 1, 2]);                  // 6 off 6: one short of 7
  ok("the over is done: the review", await has("innings-review"));
  await closeInnings();
  await page.waitForTimeout(600);
  ok("the result screen: tied, and the super over tied too — the engine's words", (await said("pad-result")) === "Match tied; the super over tied", await said("pad-result"));
  ok("...and the next is offered", (await said("pad-superover-start")) === "Super over");
  await shoot("4-again");

  // ── E ────────────────────────────────────────────────────────
  group("E. The second super over: who may not play, in words, and a decision");
  await tap("pad-superover-start");
  ok("the sheet is Super over 2", (await page.locator('[role="dialog"] h2').first().innerText()) === "Super over 2");
  ok("it says one has been played already", /played 1 super over already/.test(await said("superover-eligibility") + await said("superover-sheet")), await said("superover-sheet"));
  await tap("superover-confirm");
  await fillCrease(/Batting Order/);
  const noted = page.locator('[role="dialog"] [data-testid="batter-superover-note"]');
  ok("the batter who was out in the first is named: may not bat in this one", (await noted.count()) === 1 && (await noted.first().innerText()) === "Out in super over 1: may not bat in this one",
     `${await noted.count()} ${await noted.first().innerText().catch(() => "")}`);
  ok("...and the umpires decide", /The umpires decide who may play\. The pad records what happened\./.test(await said("batting-footer")), await said("batting-footer"));
  await shoot("5-batter-note");
  // Declaring what the innings will capture re-opens it with a new innings_start:
  // the marker must ride along, or the Laws read a third match innings.
  await tap("capture-profile-standard");
  await page.waitForTimeout(500);
  await fillCrease();
  await basicPad();
  await settle();
  const so2 = await dbq(`select innings, payload from ball_event where match_id = $1 and kind = 'innings_start' and innings = 4`, [M.id]);
  ok("the second super over opened at innings 4, numbered 2 on each innings_start (opened, then its capture declared)",
     so2.length === 2 && so2.every((r) => r.payload.superOver === 2 && r.payload.overs === 1), JSON.stringify(so2));
  ok("the board: Super over 2", (await boardSub()) === "Super over 2 · 6 balls left · 2 wickets left of 2", await boardSub());
  await balls([6, 1, 1, 0, 0, 0]);            // eight
  await closeInnings();
  ok("the chase of 9", /\b9\b/.test(await page.locator('[role="dialog"]').innerText()), await page.locator('[role="dialog"]').innerText());
  await tap("innings2-start");
  await fillCrease(/Opening Bowler/);
  const bowlNote = page.locator('[role="dialog"] [data-testid="bowler-superover-note"]');
  ok("the bowler of the first is named: may not bowl in this one", (await bowlNote.count()) >= 1 && (await bowlNote.first().innerText()) === "Bowled super over 1: may not bowl in this one",
     `${await bowlNote.count()} ${await bowlNote.first().innerText().catch(() => "")}`);
  ok("...and he can still be chosen (the umpires decide, the pad records)",
     (await page.locator('[role="dialog"] [data-testid="bowler-choice"]:not([disabled]):has([data-testid="bowler-superover-note"])').count()) >= 1);
  await shoot("6-bowler-note");
  await fillCrease();
  await basicPad();
  ok("the chase: need 9 off 6", (await boardSub()) === "Super over 2 · Need 9 off 6 · 2 wickets left of 2", await boardSub());
  await ball(4);
  await ball("W");
  await fillCrease();
  await balls([0, 0]);
  await ball("W");
  ok("two wickets: the review", await has("innings-review"));
  await closeInnings();
  await page.waitForTimeout(600);
  const final = await said("pad-result");
  ok("the result line reads as the engine words it: tied, the first super over tied, a side won the second",
     /^Match tied; the first super over tied; .+ won the second$/.test(final), final);
  ok("...no further button, and no 'why': the match is decided", !(await has("pad-superover-start")) && !(await has("pad-superover-why")));
  ok("the screen says the match is complete", /Match Complete/i.test(await text()));

  // ── F ────────────────────────────────────────────────────────
  group("F. What the server holds");
  await settle();
  const rows = await serverRows(M.id);
  const starts = rows.filter((r) => r.kind === "innings_start").map((r) => [r.innings, r.payload.superOver ?? null]);
  ok("the innings_starts: the match's two, then the pairs numbered 1 and 2 — the second super over's first innings declared its capture, and kept its marker",
     JSON.stringify(starts) === JSON.stringify([[0, null], [1, null], [2, 1], [3, 1], [4, 2], [4, 2], [5, 2]]), JSON.stringify(starts));
  const ends = rows.filter((r) => r.kind === "innings_end").map((r) => [r.innings, r.payload.reason]);
  ok("each innings sealed, the super overs' with the reasons the Laws give: two wickets is all out, six balls overs complete",
     JSON.stringify(ends) === JSON.stringify([[0, "overs_complete"], [1, "overs_complete"], [2, "all_out"], [3, "overs_complete"], [4, "overs_complete"], [5, "all_out"]]), JSON.stringify(ends));
  const r1 = await get(`/api/matches/${M.id}/result`);
  const res = r1.body?.result;
  ok("GET /result: a tie, decided by a super over; the pairs: tied, then won",
     res?.outcome === "tie" && res.decidedBy === "super_over" && JSON.stringify(res.superOvers?.map((x) => x.state)) === JSON.stringify(["tied", "won"]), JSON.stringify(res));
  ok("...in the same words", /^Match tied; the first super over tied; .+ won the second$/.test(res?.text ?? ""), res?.text);
  ok("the server refused nothing the pad sent", refusedBy.length === 0, refusedBy.join(" | "));

  // ── G ────────────────────────────────────────────────────────
  group("G. The scorecard block: below the match's innings, never mixed into them");
  const cards = await page.evaluate(() => {
    const two = [...document.querySelectorAll("*")].filter((n) => n.children.length === 0 && /· Innings [12]$/.test(n.textContent || ""));
    const b1 = document.querySelector('[data-testid="pad-superover-card-1"]'), b2 = document.querySelector('[data-testid="pad-superover-card-2"]');
    const after = (a, b) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { matchInnings: two.length, b1: b1?.innerText ?? null, b2: b2?.innerText ?? null, third: !!document.querySelector('[data-testid="pad-superover-card-3"]'),
             order: two.every((n) => after(n, b1)) && after(b1, b2) };
  });
  ok("the pad's result screen: the match's two innings, then Super over 1 and Super over 2 under them", cards.matchInnings === 2 && cards.order && !cards.third,
     JSON.stringify({ ...cards, b1: undefined, b2: undefined }));
  ok("...each block holds its pair: first innings and second innings", /Super over 1, first innings/.test(cards.b1 ?? "") && /Super over 1, second innings/.test(cards.b1 ?? "")
     && /Super over 2, first innings/.test(cards.b2 ?? "") && /Super over 2, second innings/.test(cards.b2 ?? ""), `${cards.b1?.slice(0, 80)} | ${cards.b2?.slice(0, 80)}`);
  await tap("exit-scorer");
  await page.waitForTimeout(800);
  await page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await tap(`mc-open-${M.id}`);
  await page.waitForTimeout(1800);
  ok("the Match Centre opens the cup match", await has("match-view"));
  ok("the header: the result as the server words it", /^Match tied; the first super over tied; .+ won the second$/.test(await said("mc-result")), await said("mc-result"));
  const scores = await page.evaluate(() => ({
    lines: document.querySelectorAll('[data-testid="mc-scores"] > div').length,
    so1: document.querySelector('[data-testid="mc-superover-score-1"]')?.innerText ?? null,
    so2: document.querySelector('[data-testid="mc-superover-score-2"]')?.innerText ?? null,
  }));
  ok("the header scores: two match lines, and each super over apart and labelled", scores.lines === 4 && /^Super over 1\n/i.test(scores.so1 ?? "") && /^Super over 2\n/i.test(scores.so2 ?? ""), JSON.stringify(scores));
  await tap("mc-tab-scorecard");
  ok("the innings toggle offers the match's own two innings only", (await page.locator('[data-testid="mc-innings-toggle"] button').count()) === 2);
  const sc = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="mc-scorecard"]');
    const own = [...root.querySelectorAll('[data-testid="mc-total"]')].filter((n) => !n.closest('[data-testid^="mc-superover-"]'));
    const so = [...root.querySelectorAll('section[data-testid^="mc-superover-"]')];
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { ownTotals: own.map((n) => n.innerText.replace(/\s+/g, " ")), blocks: so.map((n) => n.getAttribute("data-testid")),
             below: so.every((n) => own.every((t) => after(t, n))),
             inside: so.map((n) => n.querySelectorAll('[data-testid="mc-total"]').length),
             states: so.map((n) => n.querySelector('[data-testid="mc-superover-state"]')?.innerText) };
  });
  ok("the match innings' own total is the match's: 6/0 in the chase's 1 over", sc.ownTotals.length === 1 && /6\/0/.test(sc.ownTotals[0]), JSON.stringify(sc.ownTotals));
  ok("Super over 1 and Super over 2 are blocks below it, each with a card of its own",
     JSON.stringify(sc.blocks) === JSON.stringify(["mc-superover-1", "mc-superover-2"]) && sc.below && sc.inside.every((n) => n === 1), JSON.stringify(sc));
  ok("...their states in words: the first level, the second won", sc.states[0] === "Level" && /won$/.test(sc.states[1] ?? ""), JSON.stringify(sc.states));
  await tap("mc-superover-1-innings-1");
  const soTotal = await page.locator('[data-testid="mc-superover-1"] [data-testid="mc-total"]').innerText();
  ok("the pair's second innings can be read: 6/1 in Super over 1", /6\/1/.test(soTotal), soTotal);
  f = await floors('[data-testid="mc-superover-1"], [data-testid="mc-superover-2"], [data-testid="mc-superover-score-1"]');
  ok("12px and 44px on the block", !f.small.length && !f.tiny.length, JSON.stringify(f));
  await shoot("7-scorecard-block");
  await tap("mc-tab-summary");
  ok("the Summary's board carries the block", /^Super over 2 · /.test(await said("mc-board-sub")), await said("mc-board-sub"));
  await tap("mc-tab-commentary");
  const comm = await text();
  ok("the commentary opens each super over in its own words",
     /Super over 1\. .+ to bat first: one over, and two wickets end it\./.test(comm) && /Super over 2\. .+ need 9 to win from one over; two wickets end it\./.test(comm), comm.slice(0, 300));
  ok("...and ends the over as a super over's: 'End of the super over'", /End of the super over:/.test(comm));

  // ── H ────────────────────────────────────────────────────────
  group("H. A league tie: no button, and the words why");
  await page.locator('[data-testid="mc-back"]').first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(800);
  ok("the friendly fixture offers the scorer", await openScorer(G.id));
  await fillCrease();
  await balls([1, 1, 1, 1, 1, 1]);
  await closeInnings();
  await tap("innings2-start");
  await balls([1, 1, 1, 1, 1, 1]);
  await closeInnings();
  await page.waitForTimeout(600);
  ok("the result screen words a tie as the engine does", (await said("pad-result")) === "Match tied", await said("pad-result"));
  ok("...with no Super over button", !(await has("pad-superover-start")) && !(await has("pad-superover-offer")));
  const why = await said("pad-superover-why");
  ok("...and the engine's own words why: this match's conditions provide none, a tie stands",
     why === `Match tied. ${upper(REFUSAL_TEXT.super_over_not_provided)}.`, why);
  f = await floors('[data-testid="pad-superover-why"]');
  ok("12px and 44px on the words", !f.small.length && !f.tiny.length, JSON.stringify(f));
  await shoot("8-league");
  const gStarts = (await serverRows(G.id)).filter((r) => r.kind === "innings_start").length;
  ok("nothing was sent for a super over: two innings_starts", gStarts === 2, String(gStarts));

  // ── I ────────────────────────────────────────────────────────
  group("I. The public page: the same block, signed out");
  await dbq(`insert into fixture_publication (match_id, side, school_id, team_code, published, set_by) values ($1, 'home', $2, '1XI', true, $3)`, [M.id, HIL, OWNER]);
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.91.0.1" } });
  await offline(pctx);
  const pub = await pctx.newPage();
  const pubErrors = [];
  pub.on("pageerror", (e) => pubErrors.push(`pageerror: ${e.message}`));
  pub.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) pubErrors.push(`console.error: ${m.text()}`); });
  await pub.goto(`${API}/scorecard/${M.id}`, { waitUntil: "networkidle" });
  await pub.waitForTimeout(1500);
  const ptid = (id) => pub.locator(`[data-testid="${id}"]`);
  ok("the public scorecard opens", (await ptid("mc-panel-scorecard").count()) === 1);
  const pres = ((await ptid("mc-result").first().innerText().catch(() => "")) || "").trim();
  ok("its result line: the engine's words, sides named, nobody else", /^Match tied; the first super over tied; .+ won the second$/.test(pres), pres);
  const psc = await pub.evaluate(() => {
    const root = document.querySelector('[data-testid="mc-scorecard"]');
    const own = [...root.querySelectorAll('[data-testid="mc-total"]')].filter((n) => !n.closest('[data-testid^="mc-superover-"]'));
    const so = [...root.querySelectorAll('section[data-testid^="mc-superover-"]')];
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { toggles: root.querySelectorAll('[data-testid="mc-innings-toggle"] button').length, ownTotals: own.length,
             blocks: so.map((n) => n.getAttribute("data-testid")), below: so.every((n) => own.every((t) => after(t, n))),
             scores: [...document.querySelectorAll('[data-testid^="mc-superover-score-"]')].length };
  });
  ok("the public scorecard: the match's two innings in the toggle, the super overs below as blocks, and in the header",
     psc.toggles === 2 && psc.ownTotals === 1 && JSON.stringify(psc.blocks) === JSON.stringify(["mc-superover-1", "mc-superover-2"]) && psc.below && psc.scores === 2, JSON.stringify(psc));
  const pf = await pub.evaluate(() => {
    const small = [], tiny = [];
    for (const root of document.querySelectorAll('[data-testid="mc-superover-1"], [data-testid="mc-superover-score-1"]')) {
      for (const n of [root, ...root.querySelectorAll("*")]) {
        const cs = getComputedStyle(n);
        const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize}`);
        if (n.tagName === "BUTTON" && n.getBoundingClientRect().height < 44) tiny.push(`${Math.round(n.getBoundingClientRect().height)}px`);
      }
    }
    return { small, tiny };
  });
  ok("12px and 44px on the public block", !pf.small.length && !pf.tiny.length, JSON.stringify(pf));
  await ptid("mc-tab-commentary").click({ timeout: 4000 });
  await pub.waitForTimeout(500);
  const pc = await pub.$eval("body", (el) => el.innerText);
  ok("its commentary opens each super over in its own words", /Super over 1\. .+ to bat first/.test(pc) && /Super over 2\. .+ need 9 to win/.test(pc), pc.slice(0, 200));
  ok("no page error on the public page", pubErrors.length === 0, pubErrors.join(" | "));

  ok("no page error", errors.length === 0, errors.join(" | "));
  ok("the server's stderr is quiet", !/error/i.test(apiErr.join("").replace(/ExperimentalWarning/g, "")), apiErr.join("").slice(0, 300));
} catch (err) {
  ok(`the walk threw: ${err.message?.slice(0, 300)}`, false);
  console.log(err.stack?.split("\n").slice(0, 6).join("\n"));
  if (DEBUG) { console.log("[debug] body:\n" + (await text().catch(() => "")).slice(0, 1500)); await page.screenshot({ path: "/tmp/superover-fail.png" }).catch(() => {}); }
} finally {
  await browser.close();
  api.kill("SIGTERM");
  web.close();
  await pool.end();
}
console.log(`\n${"─".repeat(52)}\nBROWSER SUPER OVER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

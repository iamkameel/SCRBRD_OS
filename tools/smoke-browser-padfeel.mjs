#!/usr/bin/env node
/**
 * The pad's premium feel (SCRBRD-100, "Left, on the pad"), in a real browser
 * against a real API and Postgres, at a phone's 390 × 844.
 *
 *   A  Dot and 1 are the biggest run keys, the lowest, next to the strip —
 *      on Basic Scoring and the three-phase outcome — and no key moves from
 *      one ball to the next.
 *   B  Every extra is two taps, its kind then its runs, with the likely runs
 *      marked and focused: a wide, a wide with runs, no-balls (front foot,
 *      height with leg byes, off the bat), a bye and leg byes; on the
 *      three-phase pad a bye from the idle pad, a wide mid-ball and byes after
 *      a miss. EACH ONE REACHES THE SERVER AS THE EVENT THE PAD ALWAYS SENT:
 *      the stored row, read back through fromRow(), is field for field the
 *      event ball() builds from the old pad's call (apps/web/test/pad-feel
 *      proves the bytes over every combination; this proves the wire). And
 *      the board, the server's fold and the API's live score agree after
 *      each. The strip does not move while the runs are asked.
 *   C  Undo says what it will take back ("Undo: 4 to R Pillay", "Undo: 3 leg
 *      byes"), and mid-ball "Undo: start this ball again"; it takes back
 *      what it said.
 *   D  The new-over prompt lists the likely bowler first — the one who bowled
 *      the over before last — with the last over's bowler unavailable in
 *      words; one tap on him confirms. The new-batter prompt lists the
 *      batting order's next name first; one tap sends him in.
 *   E  A refusal says its likely cause: the pad closed the over, the scorer
 *      closes the new-over prompt, and the pad asks "N balls in this over?
 *      … Was one of them a wide or no-ball?" — no clause numbers.
 *   F  The haptic tick: one 10 ms buzz per recorded ball, none under reduced
 *      motion, none with the pad menu's switch off.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-padfeel.mjs
 *   BROWSER_PADFEEL_DEBUG=1 node tools/smoke-browser-padfeel.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { deriveInnings, fromRow, toRow } from "@scrbrd/scoring";
import { deliveryEvents, didNotTravel, noBallEvent } from "../apps/web/src/scorer/delivery.js";
import { EVENT_COLUMNS } from "../services/api/write/events-api.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 5363;
const API_PORT = 8863;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_PADFEEL_DEBUG;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-padfeel-secret",
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

/** The server's log for this match, folded the way every reader folds it. */
async function serverLog(innings = 0) {
  const rows = await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [MATCH]);
  const evs = rows.map(fromRow).filter((e) => (e.innings ?? 0) === innings);
  return { rows, evs, inn: deriveInnings(evs) };
}

/** The live score through the API, as the 1XI coach reads it. */
let coachToken = null;
async function liveScore(innings = 0) {
  coachToken ??= (await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "coach@example.invalid", deviceId: "padfeel-walk-coach" }) })).json())?.token;
  const r = await fetch(`${API}/api/read/live_score?matchId=${MATCH}`, { headers: { authorization: `Bearer ${coachToken}` } });
  const rows = (await r.json().catch(() => ({})))?.rows ?? [];
  const row = rows.find((x) => Number(x.innings) === innings);
  return row ? { runs: Number(row.runs), wickets: Number(row.wickets), balls: Number(row.legal_balls) } : null;
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
const tap = async (id, ms = 4000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(300); };
const has = async (id) => (await tid(id).count()) > 0;
const attr = async (id, a) => tid(id).first().getAttribute(a).catch(() => null);

/** The pad's board, as the screen reader hears it: "11 for 0, 1.2 overs". */
const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
const boardOf = (inn) => `${inn.runs} for ${inn.wickets}, ${Math.floor(inn.balls / 6)}.${inn.balls % 6} overs`;

/** Bowlers are typed (Michaelhouse has no seeded roster): the walk names them. */
const nameBowler = async (name) => {
  const field = page.locator("input[aria-label='Bowler name']").first();
  await field.fill(name);
  await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 3000 });
  await page.waitForTimeout(500);
};
/** Until the pad says nothing is missing: its fix button, the openers (Next, twice), A Nel to open the bowling. */
const ready = async () => {
  for (let i = 0; i < 10; i++) {
    const sheet = (await page.locator('[role="dialog"]').count()) > 0;
    const next = page.locator("button:not([disabled])", { hasText: /Next\s*$/i });
    if (sheet && await next.count()) { await next.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500); continue; }
    if (sheet && /Opening Bowler/i.test(await text())) { await nameBowler("A Nel"); continue; }
    if (!sheet && await has("scoring-blocked-fix")) { await tap("scoring-blocked-fix"); await page.waitForTimeout(400); continue; }
    if (!sheet && !(await has("scoring-blocked"))) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const settle = async () => { await page.waitForTimeout(2500); };
/** The board, the server's fold and the API's live score say the same. */
const agree = async (label) => {
  await settle();
  const s = await serverLog(0);
  const b = await board();
  const live = await liveScore(0);
  ok(`${label}: the board, the server's fold and the API's live score agree (${b})`,
     b === boardOf(s.inn) && live?.runs === s.inn.runs && live?.wickets === s.inn.wickets && live?.balls === s.inn.balls,
     `board ${b} / server ${boardOf(s.inn)} / api ${JSON.stringify(live)}`);
  return s;
};

/**
 * The event the pad's existing path builds for this extra — the engine's own
 * delivery code (delivery.js: commitBall's events, and the no-ball sheet's
 * confirm, which the old pad reached) given the old pad's call — against the
 * row the server stored, read back through fromRow(). Built by the path, not
 * written out here, so whatever that path emits (a field ball() comes to
 * keep) is expected here too. Every field but the id, the clock, the
 * server's seq and the free-hit flag (the pad's own state;
 * apps/web/test/pad-feel.test.mjs holds it, byte for byte against the pad as
 * it was).
 */
const expected = {
  // commitBall(type, value, shot, null, null, approach): the one-tap wide
  // (runs 0; with runs, the engine's onScore("Wd", n)), Basic Scoring's byes,
  // the outcome phase's byes with their shot. No pro-hub approach here.
  commit: (before, type, value, shot = null, placement = undefined) =>
    deliveryEvents({ curIn: 0, before, freeHit: false, type, value, shot, seg: null, zone: null, approach: null, placement })[0],
  // The no-ball sheet's confirm: whose the runs are only for runs taken.
  noBall: (before, nbType, value, nbRuns) =>
    noBallEvent({ inn: before, nbType, runs: value, nbRuns: value > 0 ? nbRuns : null, selShot: null, selSeg: null }),
};
const same = (want, got) => {
  const w = fromRow(toRow(want));
  const keys = [...new Set([...Object.keys(w), ...Object.keys(got ?? {})])]
    .filter((k) => !["id", "clientTs", "freeHit", "innings", "seq"].includes(k));
  const diff = keys.filter((k) => JSON.stringify(w[k] ?? null) !== JSON.stringify(got?.[k] ?? null))
    .map((k) => `${k}: want ${JSON.stringify(w[k] ?? null)} got ${JSON.stringify(got?.[k] ?? null)}`);
  return { ok: diff.length === 0, diff: diff.join("; ") };
};
/** An extra in two taps, checked on the screen, on the wire and on the board. */
const extra = async (label, kindKey, runsKey, { before, want, setup = null, kind }) => {
  const stripTop = async () => page.evaluate(() => Math.round(document.querySelector('[data-testid="pad-strip"]').getBoundingClientRect().top));
  const top0 = await stripTop();
  await tap(kindKey);
  ok(`${label}: the kind opens its runs (${kind})`, (await attr("extra-panel", "data-kind")) === kind);
  ok(`${label}: ...the strip does not move`, (await stripTop()) === top0);
  if (setup) await setup();
  const rowsBefore = (await serverLog(0)).rows.length;
  await tap(runsKey);
  ok(`${label}: ...and one tap on the runs records it`, !(await has("extra-panel")));
  const s = await agree(label);
  const got = s.evs.at(-1);
  const cmp = same(want(before), got);
  ok(`${label}: the server stored the event the pad always sent`, s.rows.length === rowsBefore + 1 && cmp.ok, cmp.diff);
  return s;
};

const vibes = () => page.evaluate(() => window.__vib?.length ?? -1);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1 on conflict (match_id) do nothing`, [MATCH]);

  // The haptic tick, counted: a device that can buzz, recorded.
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};
    window.__vib = []; try { Object.defineProperty(navigator, "vibrate", { value: (ms) => { window.__vib.push(ms); return true; }, configurable: true }); } catch {}`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the pad on a real fixture, at 390 × 844");
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
  const isReady = await ready();
  if (!(await has("basic-pad"))) { await tap("pad-menu"); await tap("pad-basic-scoring"); await page.waitForTimeout(300); }
  ok("the pad is ready: openers in, A Nel to bowl, Basic Scoring", isReady && (await has("basic-pad")) && !(await has("scoring-blocked")),
     (await text()).slice(0, 400));
  if (!isReady) throw new Error("the pad never became ready");

  // ── A ────────────────────────────────────────────────────────
  group("A. Dot and 1: the biggest run keys, next to the strip, fixed ball to ball");
  const keys = () => page.evaluate(() => {
    const r = (id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), a: Math.round(b.width * b.height) }; };
    return Object.fromEntries(["run-0", "run-1", "run-2", "run-3", "run-4", "run-6", "key-wicket", "key-dot", "key-undo", "key-wide", "pad-strip"].map((k) => [k, r(k)]));
  });
  const k0 = await keys();
  const runKeys = ["run-2", "run-3", "run-4", "run-6"];
  ok(`dot and 1 are the biggest run keys (${k0["run-0"].w}×${k0["run-0"].h} and ${k0["run-1"].w}×${k0["run-1"].h}; 4 is ${k0["run-4"].w}×${k0["run-4"].h})`,
     runKeys.every((k) => k0["run-0"].a > k0[k].a && k0["run-1"].a > k0[k].a && k0["run-0"].h > k0[k].h));
  const gap = k0["pad-strip"].y - (k0["run-0"].y + k0["run-0"].h);
  // The thumb's half: their centre below the middle of the screen. (Basic
  // Scoring is top-anchored, so on a tall phone there is room below the
  // strip; the keys follow the strip, not the bottom of the glass.)
  const mid = k0["run-0"].y + k0["run-0"].h / 2;
  ok(`...the lowest run keys, just above the strip (${gap}px), in the thumb's half of the screen (centre at ${mid} of 844)`,
     runKeys.every((k) => k0["run-0"].y > k0[k].y) && gap >= 0 && gap <= 16 && mid > 844 / 2, JSON.stringify(k0));
  ok("...every key at least 44 × 44", Object.entries(k0).filter(([k]) => k !== "pad-strip").every(([, b]) => b && b.w >= 44 && b.h >= 44));
  await tap("run-1");
  await agree("a single");
  ok("the haptic tick: one 10 ms buzz for the ball", JSON.stringify(await page.evaluate(() => window.__vib)) === "[10]");
  // From one ball to the next within the over (the first ball of an over
  // adds the board's row of chips, which moves the whole pad once).
  const kA = await keys();
  await tap("run-0");
  const s1b = await agree("a dot");
  const kB = await keys();
  const movedKeys = Object.keys(kA).filter((k) => JSON.stringify(kA[k]) !== JSON.stringify(kB[k]));
  ok("no key moved from one ball to the next", movedKeys.length === 0, movedKeys.map((k) => `${k} ${JSON.stringify(kA[k])}→${JSON.stringify(kB[k])}`).join("; "));

  // ── B ────────────────────────────────────────────────────────
  group("B. Every extra in two taps: the kind, then the runs — the event it always was");
  let st = s1b;
  await tap("key-wide");
  ok("the wide's runs: 0 is the likely one, marked", (await attr("extra-run-0", "data-likely")) === "true" && /the usual/.test(await attr("extra-run-0", "aria-label") ?? ""));
  ok("...and focused, so one more press takes it", await page.evaluate(() => document.activeElement?.dataset?.testid) === "extra-run-0");
  ok("...Undo while it is asked says so", (await attr("key-undo", "aria-label")) === "Undo: start this ball again");
  await tap("extra-cancel");
  ok("Cancel puts the pad back", !(await has("extra-panel")) && (await has("run-0")));
  st = await extra("a wide", "key-wide", "extra-run-0", { kind: "Wd", before: st.inn, want: (b) => expected.commit(b, "Wd", 0) });
  ok("...one tick per ball", (await vibes()) === 3);
  st = await extra("a wide the batters ran two off", "key-wide", "extra-run-2", { kind: "Wd", before: st.inn, want: (b) => expected.commit(b, "Wd", 2) });
  st = await extra("a front-foot no-ball", "key-noball", "extra-run-0", { kind: "Nb", before: st.inn, want: (b) => expected.noBall(b, "front_foot", 0, null),
    setup: async () => {
      ok("the no-ball asks its type and whose the runs are, each on its commonest answer",
         (await attr("nb-type-front_foot", "aria-checked")) === "true" && (await attr("nb-runs-bat", "aria-checked")) === "true");
      ok("...and its runs from 0, the likely one", (await attr("extra-run-0", "data-likely")) === "true" && (await has("extra-run-6")));
    } });
  st = await extra("a height no-ball, two leg byes", "key-noball", "extra-run-2", { kind: "Nb", before: st.inn, want: (b) => expected.noBall(b, "height", 2, "leg_byes"),
    setup: async () => {
      await tap("nb-type-height");
      ok("a height no-ball says the free hit", /Free hit/i.test(await tid("nb-free-hit").innerText().catch(() => "")));
      await tap("nb-runs-leg_byes");
    } });
  const striker = st.inn.batsmen.find((b) => b.id === st.inn.striker);
  st = await extra("a no-ball hit for one", "key-noball", "extra-run-1", { kind: "Nb", before: st.inn, want: (b) => expected.noBall(b, "front_foot", 1, null) });
  ok(`...the run off the bat is the striker's (${striker?.name})`, st.inn.batsmen.find((b) => b.id === striker?.id)?.runs === (striker?.runs ?? 0) + 1);
  await tap("key-byes");
  ok("a bye's runs start at 1, the likely one", (await attr("extra-run-1", "data-likely")) === "true" && !(await has("extra-run-0")));
  await tap("key-byes");
  ok("...a second tap on the kind closes them", !(await has("extra-panel")));
  st = await extra("a bye", "key-byes", "extra-run-1", { kind: "B", before: st.inn, want: (b) => expected.commit(b, "B", 1) });
  st = await extra("three leg byes", "key-legbyes", "extra-run-3", { kind: "LB", before: st.inn, want: (b) => expected.commit(b, "LB", 3) });

  // ── C ────────────────────────────────────────────────────────
  group("C. Undo says what it will take back");
  ok(`after three leg byes: "${await attr("key-undo", "aria-label")}"`, (await attr("key-undo", "aria-label")) === "Undo: 3 leg byes"
     && /3 leg byes/.test(await tid("key-undo").innerText()));
  const facing = st.inn.batsmen.find((b) => b.id === st.inn.striker)?.name;
  await tap("run-4");
  const four = await agree("a four");
  const label4 = await attr("key-undo", "aria-label");
  ok(`after a four: "${label4}" — the name the board shows, never an id`, label4 === `Undo: 4 to ${facing}` && !/[0-9a-f]{8}-/.test(label4));
  await tap("key-undo");
  const undone = await agree("the four undone");
  ok("undo took back the four it named", undone.inn.runs === four.inn.runs - 4 && undone.inn.balls === four.inn.balls - 1);
  ok(`...and now names the leg byes again ("${await attr("key-undo", "aria-label")}")`, (await attr("key-undo", "aria-label")) === "Undo: 3 leg byes");

  // ── E ────────────────────────────────────────────────────────
  group("E. A refusal says its likely cause");
  // Legal so far: 1, a dot, the bye, the leg byes. Two dots end the over.
  const vBefore = await vibes();
  for (let i = 0; i < 2; i++) { await tap("run-0"); await page.waitForTimeout(250); }
  const endOver = await agree("the over's last balls");
  ok("two dots, two ticks", (await vibes()) === vBefore + 2);
  ok("the pad closes the over and asks for the next bowler", /Over 1 Complete/i.test(await text()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const delivered = endOver.inn.ballLog.filter((b) => b.over === 0).length;
  const cause = (await tid("scoring-blocked-cause").innerText().catch(() => "")).trim();
  ok(`the scorer who thinks the over is not done is told what probably happened ("${cause}")`,
     cause === `${delivered + 1} balls in this over? Six legal balls are already recorded in over 1. Was one of them a wide or no-ball?`);
  ok("...under the reason, with no clause number", /Can't score yet/.test(await tid("scoring-blocked").innerText()) && !/\bLaw\b|\d+\.\d+\.\d/.test(cause));
  const rowsAt = (await serverLog(0)).rows.length;
  await tap("run-0");
  await page.waitForTimeout(600);
  ok("a seventh ball is not recorded: the tap opens the fix", (await serverLog(0)).rows.length === rowsAt && /Over 1 Complete/i.test(await text()));
  await nameBowler("B Zulu");

  // ── Three-phase ──────────────────────────────────────────────
  group("B, C on the three-phase pad");
  await tap("pad-menu"); await tap("pad-basic-scoring"); await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  ok("the three-phase pad opens on the shot, the extras on its strip", (await attr("three-phase-pad", "data-phase")) === "1" && (await has("key-byes")));
  await tap("shot-drive");
  ok(`mid-ball, undo says so ("${await attr("key-undo", "aria-label")}")`, (await attr("key-undo", "aria-label")) === "Undo: start this ball again");
  await tap("key-undo");
  ok("...and starts the ball again, recording nothing", (await attr("three-phase-pad", "data-phase")) === "1");
  let tp = await serverLog(0);
  tp = await extra("a bye from the idle three-phase pad", "key-byes", "extra-run-2", { kind: "B", before: tp.inn, want: (b) => expected.commit(b, "B", 2) });
  await tap("shot-pull"); await tap("area-none");
  ok("the outcome phase", (await attr("three-phase-pad", "data-phase")) === "3");
  const kOut = await keys();
  ok(`...dot and 1 the biggest run keys there too (${kOut["run-0"].w}×${kOut["run-0"].h})`,
     runKeys.every((k) => kOut["run-0"].a > kOut[k].a && kOut["run-1"].a > kOut[k].a && kOut["run-0"].y > kOut[k].y));
  tp = await extra("a wide mid-ball drops the shot, as it always did", "key-wide", "extra-run-0", { kind: "Wd", before: tp.inn, want: (b) => expected.commit(b, "Wd", 0) });
  ok("...and the pad starts the next ball", (await attr("three-phase-pad", "data-phase")) === "1");
  await tap("shot-missed"); await tap("area-none");
  tp = await extra("a bye after a miss carries the shot", "key-byes", "extra-run-1", { kind: "B", before: tp.inn, want: (b) => expected.commit(b, "B", 1, "missed", didNotTravel("missed")) });
  for (let i = 0; i < 4; i++) { await tap("key-dot"); await page.waitForTimeout(250); }
  await agree("over two done");

  // ── D ────────────────────────────────────────────────────────
  group("D. The new-over prompt: the likely bowler first");
  ok("the over ends and the pad asks for the next bowler", /Over 2 Complete/i.test(await text()));
  const rows = await page.locator('[data-testid="bowler-choice"]').evaluateAll((els) => els.map((e) => ({
    text: e.innerText.split("\n")[0].trim(), likely: e.dataset.likely === "true", disabled: e.disabled, why: e.querySelector('[data-testid="bowler-unavailable"]')?.innerText ?? null })));
  ok(`A Nel, who bowled the over before last, is first and marked likely (${rows.map((r) => `${r.text}${r.likely ? "*" : ""}${r.disabled ? "!" : ""}`).join(", ")})`,
     rows[0]?.text === "A Nel" && rows[0].likely && !rows[0].disabled);
  ok(`...B Zulu, who bowled the last over, is there, unavailable, in words ("${rows.find((r) => r.text === "B Zulu")?.why}")`,
     rows.some((r) => r.text === "B Zulu" && r.disabled && /^Bowled (part of )?the last over/.test(r.why ?? "")));
  await page.locator('[data-testid="bowler-choice"]').first().click({ timeout: 3000 });
  await page.waitForTimeout(600);
  const o3 = await serverLog(0);
  ok("one tap on the likely bowler confirms him", o3.inn.bowler === "A Nel" && o3.evs.at(-1)?.kind === "bowler" && o3.evs.at(-1)?.bowler === "A Nel");
  for (let i = 0; i < 6; i++) { await tap("key-dot"); await page.waitForTimeout(250); }
  const rows4 = await page.locator('[data-testid="bowler-choice"]').evaluateAll((els) => els.map((e) => ({ text: e.innerText.split("\n")[0].trim(), likely: e.dataset.likely === "true", disabled: e.disabled })));
  ok(`the next over: B Zulu first, A Nel unavailable (${rows4.map((r) => `${r.text}${r.likely ? "*" : ""}${r.disabled ? "!" : ""}`).join(", ")})`,
     rows4[0]?.text === "B Zulu" && rows4[0].likely && rows4.some((r) => r.text === "A Nel" && r.disabled));
  await page.locator('[data-testid="bowler-choice"]').first().click({ timeout: 3000 });
  await page.waitForTimeout(500);

  group("D. The new-batter prompt: the batting order's next name first");
  await tap("pad-menu"); await tap("pad-basic-scoring"); await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  await click(/Wicket/, 2500);
  await tap("wicket-confirm");
  await page.waitForTimeout(700);
  const w = await serverLog(0);
  const inOrOut = new Set(w.inn.batsmen.filter((b) => b.status !== "dnb").map((b) => b.id));
  const due = (w.inn.squad ?? []).find((p) => !inOrOut.has(p.id ?? p));
  const firstBat = await page.locator('[data-testid="batter-choice"]').first().evaluate((e) => ({ next: e.dataset.next === "true", text: e.innerText }));
  ok(`the next in the order is first, marked Next (${firstBat.text.replace(/\s+/g, " ")})`, firstBat.next && !!due && firstBat.text.includes(due.name ?? due));
  await page.locator('[data-testid="batter-choice"]').first().click({ timeout: 3000 });
  await page.waitForTimeout(600);
  const nb = await agree("the new batter in");
  const arrived = nb.evs.at(-1);
  ok("one tap sends him in", arrived?.kind === "batters" && (arrived.striker ?? arrived.nonStriker) === (due?.id ?? due));

  // ── F ────────────────────────────────────────────────────────
  group("F. The haptic tick: never under reduced motion, and a switch on the pad's menu");
  const v0 = await vibes();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await tap("run-0");
  ok("a ball under reduced motion: no buzz", (await vibes()) === v0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await tap("pad-menu");
  ok("the pad's menu has the switch, on", (await attr("pad-haptic", "aria-checked")) === "true");
  await tap("pad-haptic");
  await page.keyboard.press("Escape");
  await tap("run-0");
  ok("switched off: no buzz", (await vibes()) === v0);
  ok("...remembered on this device", await page.evaluate(() => localStorage.getItem("scrbrd:haptic")) === "off");
  await tap("pad-menu"); await tap("pad-haptic"); await page.keyboard.press("Escape");
  await tap("run-0");
  ok("back on: one buzz for the ball", (await vibes()) === v0 + 1);
  await agree("the end of the walk");

  ok("no console errors on the pad", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the walk threw: ${e.message?.slice(0, 200)}`, false);
  console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
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
console.log(`\n${"─".repeat(52)}\nBROWSER PADFEEL SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

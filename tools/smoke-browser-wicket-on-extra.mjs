#!/usr/bin/env node
/**
 * A wicket on a wide or a no-ball (Law 22.9, Law 21.17; db/87), asked on the
 * pad in a real browser against a real API and Postgres.
 *
 * Before, a wicket was its own delivery type, W, and a W is a ball of the
 * over: a scorer had no correct way to record a run out off a no-ball or a
 * stumping off a wide. Now the wide's or the no-ball's runs panel carries a
 * Wicket toggle, and the wicket sheet that follows offers only the ways out
 * the Law allows off that extra. One event goes to the server: the extra,
 * carrying the wicket.
 *
 * The scorer records, through the pad:
 *   1. a single;
 *   2. a run out off a no-ball: one run completed off the bat, the
 *      non-striker run out at the striker's end;
 *   3. the free hit, a dot;
 *   4. a stumping off a wide.
 * At each step the board, the server's fold of its own rows and
 * match_live_score (the SQL fold the public score and the handover read)
 * agree. Then the same score is held to: the board's chips for the over
 * ("2nb+W", "wd+W"), the scorer's scorecard (the total, the fall of wickets,
 * the dismissals, the bowler's wicket), the career read (/read/career, the
 * SQL careers db/87 brought into line), and the public page (/live/:match),
 * its score and its fall of wickets.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-wicket-on-extra.mjs
 *   BROWSER_WICKET_EXTRA_DEBUG=1 node tools/smoke-browser-wicket-on-extra.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { deriveInnings, fromRow } from "@scrbrd/scoring";
import { EVENT_COLUMNS } from "../services/api/write/events-api.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(5327);
const API_PORT = port(8827);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_WICKET_EXTRA_DEBUG;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const SARAH = "88888888-0000-0000-0000-000000000007";   // Hilton's director of sport, who publishes it
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

// The API serves the public page itself (SERVE_CLIENT), as it does in
// production; the pad is served on its own origin, as the other pad walks do.
const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-wicket-extra-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-wicket-extra-pseudonyms-0123456789", PUBLIC_TRUST_PROXY_HOPS: "1",
         SERVE_CLIENT: "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = /** @type {string[]} */ ([]);
api.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x").pathname;
  let body, type;
  try {
    const f = join("apps/web/dist", url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = /** @type {Record<string, string>} */ (TYPES)[extname(f)] ?? "application/octet-stream";
  } catch {
    body = await readFile("apps/web/dist/index.html");
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, () => r(null)));

const pool = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const dbq = async (/** @type {string} */ text, /** @type {any[]} */ params = []) => (await pool.query(text, params)).rows;
/** One statement as a user, through the application role and its policies. */
async function as(/** @type {string} */ user, /** @type {string} */ text, /** @type {any[]} */ params = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.device_id', 'browser-wicket-extra', true)", [user]);
    const r = (await c.query(text, params)).rows;
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

/** The server's log for this match, folded the way every reader folds it. */
async function serverLog(innings = 0) {
  const rows = await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [MATCH]);
  const evs = rows.map(fromRow).filter((e) => (e.innings ?? 0) === innings);
  return { rows: rows.filter((r) => (r.innings ?? 0) === innings), evs, inn: deriveInnings(/** @type {any} */ (evs)) };
}

/** /read/career, as the 1XI coach reads it, by player id. Figures as numbers. */
let coachToken = /** @type {string | null} */ (null);
async function careerRead() {
  coachToken ??= (await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "coach@example.invalid", deviceId: "wicket-extra-coach" }) })).json())?.token;
  const r = await fetch(`${API}/api/read/career`, { headers: { authorization: `Bearer ${coachToken}` } });
  const rows = (await r.json())?.rows ?? [];
  const num = (/** @type {Record<string, any>} */ x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v]));
  return Object.fromEntries(rows.map((/** @type {any} */ x) => [x.player_id, num(x)]));
}
/** What moved in one player's career between two reads (a missing row is zeros). */
const moved = (/** @type {any} */ a, /** @type {any} */ b, /** @type {string} */ id, /** @type {string} */ k) => (b[id]?.[k] ?? 0) - (a[id]?.[k] ?? 0);

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext();
await offline(ctx);
const page = await ctx.newPage();
const errors = /** @type {string[]} */ ([]);
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
});

const text = () => page.$eval("body", (el) => /** @type {HTMLElement} */ (el).innerText);
const click = async (/** @type {RegExp} */ re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tid = (/** @type {string} */ id) => page.locator(`[data-testid="${id}"]`);
const tap = async (/** @type {string} */ id, ms = 4000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(350); };

/** The pad's board, as the screen reader hears it: "11 for 0, 1.2 overs". */
const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
const boardOf = (/** @type {any} */ inn) => `${inn.runs} for ${inn.wickets}, ${Math.floor(inn.balls / 6)}.${inn.balls % 6} overs`;

/** The pad's own prompts, answered: a bowler, the next batter. */
const clearBlockers = async () => {
  for (let i = 0; i < 10; i++) {
    const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await bowlers.count()) { try { await bowlers.first().click({ timeout: 1500 }); } catch { /* next pass */ } await page.waitForTimeout(500); continue; }
    const next = page.locator("button:not([disabled])", { hasText: /Next\s*$/i });
    if (await next.count()) { try { await next.first().click({ timeout: 1500 }); } catch { /* next pass */ } await page.waitForTimeout(500); continue; }
    const body = await text();
    if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
      const field = page.locator("input[placeholder*='name' i], input[placeholder*='Search bowler' i]").last();
      if (await field.count()) {
        try {
          await field.fill("A Nel");
          await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 1500 });
        } catch { /* next pass */ }
        await page.waitForTimeout(600);
        continue;
      }
    }
    return;
  }
};
const makeReady = async () => {
  for (let i = 0; i < 6; i++) {
    await clearBlockers();
    if (!/Can't score yet/i.test(await text()) && !(await tid("scoring-blocked-fix").count())) {
      if (!/Batting Order|Opening Bowler|Over \d+ Complete/i.test(await text())) return true;
      continue;
    }
    try { await tid("scoring-blocked-fix").first().click({ timeout: 2000 }); } catch { /* next pass */ }
    await page.waitForTimeout(700);
  }
  return false;
};
const settle = async () => { await page.waitForTimeout(2500); };
const agree = async (/** @type {string} */ label) => {
  await settle();
  const s = await serverLog(0);
  const b = await board();
  ok(`${label}: the board and the server's fold agree (${b})`, b === boardOf(s.inn), `board ${b} / server ${boardOf(s.inn)}`);
  const [live] = await dbq(`select runs::int, wickets::int, legal_balls::int from match_live_score where match_id = $1 and innings = 0`, [MATCH]);
  ok(`${label}: ...and so does match_live_score`,
     live?.runs === s.inn.runs && live?.wickets === s.inn.wickets && live?.legal_balls === s.inn.balls,
     `${JSON.stringify(live)} / ${boardOf(s.inn)}`);
  return s;
};
/** The ways out the open wicket sheet offers, by their canonical value. */
const modesOffered = async () => (await page.locator('[data-testid^="wicket-mode-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid"))))
  .map((s) => String(s).replace("wicket-mode-", "")).sort().join(",");

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1
             on conflict (match_id) do nothing`, [MATCH]);
  const careerAt = await careerRead();
  ok("the coach reads the career figures before a ball is bowled", Object.keys(careerAt).length > 0);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the pad on a real fixture");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);
  const opened = await page.evaluate(() => {
    const isBtn = (/** @type {Element} */ b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "");
    for (const b of [...document.querySelectorAll("button")].filter(isBtn)) {
      let card = /** @type {Element} */ (b);
      while (card.parentElement && [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) card = card.parentElement;
      if (/Michaelhouse/i.test(card.textContent || "")) { b.click(); return true; }
    }
    return false;
  });
  ok("the 1XI fixture offers the scorer", opened);
  await page.waitForTimeout(2500);
  await clearBlockers();
  if (!(await tid("basic-pad").count())) { await tid("pad-menu").click({ timeout: 2500 }).catch(() => {}); await tid("pad-basic-scoring").click({ timeout: 2500 }).catch(() => {}); }
  await page.waitForTimeout(400);
  ok("the scorer opens on the pad", /\bDOT\b/i.test(await text()));
  ok("the openers and the bowler are named on the pad's own sheets", await makeReady());

  await click(/^1$/);
  const one = await agree("a single");
  ok("...one ball, one run", one.inn.balls === 1 && one.inn.runs === 1, boardOf(one.inn));

  // ── 1. A run out off a no-ball ─────────────────────────────────
  group("A run out off a no-ball (Law 21.17): the no-ball's runs, then the wicket");
  const S = one.inn.striker, N = one.inn.nonStriker;
  await tap("key-noball");
  ok("the no-ball asks its runs, and offers a wicket with them", (await tid("extra-panel").getAttribute("data-kind").catch(() => null)) === "Nb"
     && await tid("extra-wicket").count() === 1 && (await tid("extra-wicket").getAttribute("aria-pressed")) === "false");
  await tap("extra-wicket");
  ok("...pressed, it says so", (await tid("extra-wicket").getAttribute("aria-pressed")) === "true");
  await tap("extra-run-1");
  ok("one run completed: the wicket sheet opens, off a no ball", await tid("wicket-off-extra").count() === 1
     && /Off a no ball \(1 run completed\)/.test(await tid("wicket-off-extra").innerText()), await tid("wicket-off-extra").innerText().catch(() => ""));
  const nbModes = await modesOffered();
  ok(`...offering only run out, hit the ball twice and obstructing the field (${nbModes})`, nbModes === "hit_twice,obstructing_field,run_out");
  ok("...nothing is recorded yet", (await serverLog(0)).inn.balls === 1 && (await dbq(`select count(*)::int n from ball_event where match_id = $1 and ball_type = 'Nb'`, [MATCH]))[0].n === 0);
  await tap("wicket-who-nonstriker");
  ok("a run completed: it asks the end", await tid("wicket-end").count() === 1 && await tid("wicket-confirm").first().isDisabled());
  await tap("wicket-end-striker");
  await tap("wicket-confirm");
  await page.waitForTimeout(600);
  ok("the batting-order sheet asks for the next man", /Available to Bat/i.test(await text()));
  await clearBlockers();
  const ro = await agree("after the run out off the no-ball");
  const roRow = ro.rows.filter((r) => r.kind === "ball").at(-1);
  ok("the server stored one row: the no-ball, carrying the run out",
     roRow?.ball_type === "Nb" && roRow?.dismissal === "run_out" && roRow?.value === 1 && roRow?.payload?.outAt === "striker_end"
     && (roRow?.dismissed_id ?? roRow?.payload?.dismissed) === N
     && ro.rows.filter((r) => r.kind === "ball").length === 2, JSON.stringify(roRow && { type: roRow.ball_type, d: roRow.dismissal, v: roRow.value, p: roRow.payload }));
  ok("...a wicket: 3 for 1, still one ball of the over", ro.inn.runs === 3 && ro.inn.wickets === 1 && ro.inn.balls === 1);
  const sBefore = one.inn.batsmen.find((b) => b.id === S) ?? { runs: 0, balls: 0 };
  ok("...the run the striker's, and the no-ball a ball he faced", ro.inn.batsmen.find((b) => b.id === S)?.runs === sBefore.runs + 1
     && ro.inn.batsmen.find((b) => b.id === S)?.balls === sBefore.balls + 1);
  const nel = (/** @type {any} */ inn) => inn.bowlers.find((/** @type {any} */ b) => b.id === "A Nel");
  ok("...the bowler charged the no-ball and the run, no wicket, one ball", nel(ro.inn)?.runs === 3 && nel(ro.inn)?.wickets === 0 && nel(ro.inn)?.balls === 1);
  ok("...the survivor at the bowler's end, the new man at the striker's", ro.inn.nonStriker === S && ro.inn.striker != null && ro.inn.striker !== N);
  ok("...and a free hit to come", ro.inn.freeHit === true);

  // ── The free hit ──────────────────────────────────────────────
  await makeReady();
  await click(/^·/, 2000);
  const fh = await agree("the free hit, a dot");
  ok("...the free hit is taken", fh.inn.freeHit === false && fh.inn.balls === 2);

  // ── 2. A stumping off a wide ───────────────────────────────────
  group("A stumping off a wide (Law 22.9): the wide's runs, then the wicket");
  const out2 = fh.inn.striker;
  await tap("key-wide");
  ok("the wide asks its runs, and offers a wicket with them", (await tid("extra-panel").getAttribute("data-kind").catch(() => null)) === "Wd"
     && await tid("extra-wicket").count() === 1);
  await tap("extra-wicket");
  await tap("extra-run-0");
  ok("the wicket sheet opens, off a wide", /Off a wide: /.test(await tid("wicket-off-extra").innerText().catch(() => "")));
  const wdModes = await modesOffered();
  ok(`...offering only run out, stumped, hit wicket and obstructing the field (${wdModes})`, wdModes === "hit_wicket,obstructing_field,run_out,stumped");
  await tap("wicket-mode-stumped");
  await tap("wicket-confirm");
  await page.waitForTimeout(600);
  ok("the batting-order sheet asks for the next man", /Available to Bat/i.test(await text()));
  await clearBlockers();
  const st = await agree("after the stumping off the wide");
  const stRow = st.rows.filter((r) => r.kind === "ball").at(-1);
  ok("the server stored one row: the wide, carrying the stumping", stRow?.ball_type === "Wd" && stRow?.dismissal === "stumped" && stRow?.value === 0,
     JSON.stringify(stRow && { type: stRow.ball_type, d: stRow.dismissal, v: stRow.value }));
  ok("...4 for 2, still two balls of the over", st.inn.runs === 4 && st.inn.wickets === 2 && st.inn.balls === 2);
  ok("...the striker out stumped, the wide no ball he faced", st.inn.batsmen.find((b) => b.id === out2)?.status === "out"
     && /^st /.test(st.inn.batsmen.find((b) => b.id === out2)?.dismissal ?? "") && st.inn.batsmen.find((b) => b.id === out2)?.balls === fh.inn.batsmen.find((b) => b.id === out2)?.balls);
  ok("...the bowler's wicket: 1 for 4 off two balls, a wide and a no-ball", nel(st.inn)?.wickets === 1 && nel(st.inn)?.runs === 4
     && nel(st.inn)?.balls === 2 && nel(st.inn)?.wides === 1 && nel(st.inn)?.noBalls === 1);
  ok("...the fall of wickets 3-1 and 4-2, both at a ball of the over before them",
     st.inn.fow.map((f) => `${f.runs}-${f.wickets}@${f.overs}`).join(" ") === "3-1@0.1 4-2@0.2", JSON.stringify(st.inn.fow));

  // ── The same score everywhere ────────────────────────────────
  group("The board's over, the scorecard, the careers and the public page say the same");
  const chips = await page.locator('[data-chip="wicket"]').allInnerTexts();
  ok(`the board's over shows each as the extra and the wicket (${chips.join(" ")})`, chips.includes("2nb+W") && chips.includes("wd+W"));
  await page.locator("button", { hasText: /^\s*Cards$/ }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  const cards = await text();
  ok("the scorecard: 4/2, 0.2 overs", /4\s*\/\s*2/.test(cards) && /0\.2 overs/.test(cards));
  ok("...the fall of wickets 3/1 and 4/2", /3\/1/.test(cards) && /4\/2/.test(cards));
  ok("...the run out and the stumping on the card", /run out/.test(cards) && /\bst .*b A Nel/.test(cards));
  ok("...the bowler 1 for 4", /1/.test(await tid("card-bowler-A Nel").innerText().catch(() => ""))
     && (await tid("card-bowler-A Nel").innerText().catch(() => "")).replace(/\s+/g, " ").includes("4 1"),
     await tid("card-bowler-A Nel").innerText().catch(() => ""));
  await page.locator("button", { hasText: /^\s*Score$/ }).first().click({ timeout: 3000 }).catch(() => {});

  const careerNow = await careerRead();
  ok(`the career read: the man run out off the no-ball has the dismissal (+${moved(careerAt, careerNow, N, "dismissals")})`,
     moved(careerAt, careerNow, N, "dismissals") === 1);
  ok(`...the man stumped off the wide too (+${moved(careerAt, careerNow, out2, "dismissals")}), and the wide no ball he faced`,
     moved(careerAt, careerNow, out2, "dismissals") === 1
     && moved(careerAt, careerNow, out2, "balls_faced") === st.inn.batsmen.find((b) => b.id === out2)?.balls);
  ok(`...the striker the run off the no-ball and the no-ball faced, as the card has him (+${moved(careerAt, careerNow, S, "runs")} off +${moved(careerAt, careerNow, S, "balls_faced")})`,
     moved(careerAt, careerNow, S, "runs") === st.inn.batsmen.find((b) => b.id === S)?.runs
     && moved(careerAt, careerNow, S, "balls_faced") === st.inn.batsmen.find((b) => b.id === S)?.balls);

  await as(SARAH, `select * from fixture_publish($1, 'home', true)`, [MATCH]);
  const pctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.87.0.1" } });
  await offline(pctx);
  const pub = await pctx.newPage();
  const pubErrors = /** @type {string[]} */ ([]);
  pub.on("pageerror", (e) => pubErrors.push(`pageerror: ${e.message}`));
  pub.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) pubErrors.push(`console.error: ${m.text()}`); });
  await pub.goto(`${API}/live/${MATCH}`, { waitUntil: "networkidle" });
  await pub.waitForSelector('[data-testid="mc-scores"]', { timeout: 15000 }).catch(() => {});
  const scores = await pub.locator('[data-testid="mc-scores"]').innerText().catch(() => "");
  ok(`the public page: 4/2 (0.2), as the pad and the server (${scores.replace(/\s+/g, " ").trim()})`, /4\/2\s*\(0\.2\)/.test(scores));
  await pub.locator('[data-testid="mc-tab-scorecard"]').click({ timeout: 4000 }).catch(() => {});
  await pub.waitForTimeout(500);
  const fow = await pub.locator('[data-testid="mc-fow-line"]').allInnerTexts();
  ok(`...its fall of wickets: 3/1 at 0.1 and 4/2 at 0.2 (${fow.join(" | ")})`,
     fow.length === 2 && /^3\/1 · .* · 0\.1$/.test(fow[0].trim()) && /^4\/2 · .* · 0\.2$/.test(fow[1].trim()));
  ok("no console errors on the public page", pubErrors.length === 0, pubErrors.slice(0, 3).join(" | "));
  await pctx.close();

  ok("no console errors on the pad", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the walk threw: ${/** @type {any} */ (e).message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(/** @type {any} */ (e).stack?.split("\n").slice(0, 8).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  api.kill("SIGTERM");
  await pool.end();
  await app.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER WICKET-ON-EXTRA SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

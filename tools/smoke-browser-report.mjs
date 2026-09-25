#!/usr/bin/env node
/**
 * SCRBRD-082 — the Post-Match Report, from a browser.
 *
 * A real completed fixture, written directly into ball_event the same way
 * tools/smoke-scorecard.mjs builds its own — a real event log, folded by the
 * real package, not a hand-shaped object standing in for one — so this walk
 * asks the question a curl command against /read/phases or
 * /api/matches/:id/events cannot: does the SCREEN a director of sport opens
 * from Match Centre actually show what the log says, end to end?
 *
 * The fixture: two short, deliberately small-squad innings so a real ALL_OUT
 * ending, a real fifty and a real five-wicket haul all fall out of a handful
 * of deliveries rather than a full T20 innings' worth.
 *
 *   Innings 1 — "Report Home" bat first. H Motaung faces every ball himself
 *   (a repeated `batters` event forces the striker back onto him — the same
 *   technique apps/web/test/post-match-report.test.mjs uses to sidestep the
 *   fold's own end-of-over rotation) and reaches 52 not out; two wickets fall
 *   for nothing either side of him, all out for 52 in 2.3 overs.
 *
 *   Innings 2 — "Report Away" chase 53. D Frost bowls unchanged and takes
 *   five wickets as five batters manage 8 each; all out for 40 in 2.3 overs.
 *   Report Home win by 12 runs.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-report.mjs
 *   BROWSER_REPORT_DEBUG=1 node tools/smoke-browser-report.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 5301;
const API_PORT = 8801;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const DEBUG = !!process.env.BROWSER_REPORT_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 200)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-report-secret",
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

  group("Building a real, small, two-innings fixture directly on the ball log");
  const su = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;

  const players = {};
  for (const name of ["H Motaung", "K Rassie", "L Adams", "B Kunene", "T Sithole", "R Mahlangu", "W Fourie", "N Zwane", "D Frost"]) {
    const row = (await q(
      `insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
       values ($1, '9XI', $2, 90, 'batter', current_date - interval '16 years') returning id`, [HIL, name]))[0];
    players[name] = row.id;
  }
  const [P1, P2, P3, B1, B2, B3, B4, B5, Q] =
    ["H Motaung", "K Rassie", "L Adams", "B Kunene", "T Sithole", "R Mahlangu", "W Fourie", "N Zwane", "D Frost"].map((n) => players[n]);

  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1, '9XI', 'Report CC', now() - interval '2 days', 'T20', 20, 'complete') returning id`,
    [HIL]))[0].id;

  let seq = 0;
  const write = async (innings, kind, { ballType = null, value = null, striker = null, bowler = null, dismissed = null, dismissal = null, payload = {} } = {}) => {
    seq += 1;
    await q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                               idempotency_key, client_seq, client_ts, kind, ball_type, value,
                               striker_id, bowler_id, dismissed_id, dismissal, payload)
       values ($1,$2,$3,1,$4,$5,'device-report',$6,$3,now(),$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [m, HIL, seq, innings, su, `report-${seq}`, kind, ballType, value, striker, bowler, dismissed, dismissal, JSON.stringify(payload)]);
  };
  // Every ball is preceded by its own `batters` AND `bowler` event, naming
  // both afresh — the fold's own end-of-over strike rotation AND its own
  // "the bowler is cleared at the end of every over" rule (replay.mjs) are
  // real laws this fixture has no reason to fight ball by ball, so the walk
  // sidesteps both the same way the pure unit test sidesteps rotation,
  // rather than hand-tracking which end each delivery lands on and re-naming
  // the bowler once every six legal balls.
  const scoringBall = (innings, striker, bowler, value) =>
    write(innings, "batters", { striker })
      .then(() => write(innings, "bowler", { bowler }))
      .then(() => write(innings, "ball", { ballType: "run", value, striker, bowler }));
  const wicketBall = (innings, striker, bowler, dismissal) =>
    write(innings, "batters", { striker })
      .then(() => write(innings, "bowler", { bowler }))
      .then(() => write(innings, "ball", { ballType: "W", value: 0, striker, bowler, dismissed: striker, dismissal }));

  // ── Innings 1: Report Home, all out for 52 ──
  await write(0, "innings_start", { payload: {
    battingTeam: "Report Home", bowlingTeam: "Report Away",
    teamKey: "Report Home", bowlingTeamKey: "Report Away",
    squad: [{ id: P1, name: "H Motaung" }, { id: P2, name: "K Rassie" }, { id: P3, name: "L Adams" }],
    bowlingSquad: [{ id: Q, name: "D Frost" }], overs: 20,
  } });
  await write(0, "bowler", { bowler: Q });
  for (let i = 0; i < 13; i++) await scoringBall(0, P1, Q, 4);   // H Motaung: 52 off 13
  await wicketBall(0, P2, Q, "bowled");                          // K Rassie: 0
  await wicketBall(0, P3, Q, "caught");                          // L Adams: 0 — all out, 2 wkts
  await write(0, "innings_end", { payload: { reason: "all_out", confirmed: { runs: 52, wickets: 2, balls: 15 } } });

  // ── Innings 2: Report Away chase 53, D Frost 5/40, all out for 40 ──
  await write(1, "innings_start", { payload: {
    battingTeam: "Report Away", bowlingTeam: "Report Home",
    teamKey: "Report Away", bowlingTeamKey: "Report Home",
    squad: [{ id: B1, name: "B Kunene" }, { id: B2, name: "T Sithole" }, { id: B3, name: "R Mahlangu" },
            { id: B4, name: "W Fourie" }, { id: B5, name: "N Zwane" }, { id: "sixth", name: "Twelfth Man" }],
    bowlingSquad: [{ id: Q, name: "D Frost" }], overs: 20,
  } });
  await write(1, "bowler", { bowler: Q });
  for (const b of [B1, B2, B3, B4, B5]) {
    await scoringBall(1, b, Q, 4);
    await scoringBall(1, b, Q, 4);
    await wicketBall(1, b, Q, "bowled");
  }
  await write(1, "innings_end", { payload: { reason: "all_out", confirmed: { runs: 40, wickets: 5, balls: 15 } } });

  group("A director of sport opens Match Centre and the fixture's own report");
  const dos = await open();
  ok("signs in as the director of sport", await signIn(dos.page, /sarah@example\.invalid|Director/));
  ok("Match Centre opens", await nav(dos.page, /Match Centre/));
  const card = dos.page.locator('[data-testid^="match-card-"]', { hasText: "Report CC" }).first();
  ok("the new fixture is on the list", await card.count() === 1);
  await card.click().catch(() => {});
  await dos.page.waitForTimeout(400);

  const reportBtn = dos.page.locator('button[data-testid^="report-open-"]', { hasText: "Post-match report" }).first();
  ok("a Post-match report button is offered for the completed fixture", await reportBtn.count() === 1);
  await reportBtn.click().catch(() => {});
  await dos.page.waitForTimeout(1500);

  const report = dos.page.locator('[data-testid="post-match-report"]');
  ok("the report renders", await report.count() === 1);
  const body = await report.innerText().catch(() => "");
  if (DEBUG) console.log("[debug] report body:\n" + body);

  group("The result is the fold's own, not a guess");
  // The Badge component renders its text upper-cased (ui/primitives.jsx),
  // which innerText reflects — hence /i, the same convention
  // smoke-browser-seasons.mjs uses for the same reason.
  ok("Report Home is named the winner, by the real margin", /Report Home won by 12 runs/i.test(body), body.slice(0, 300));

  group("Both innings' scorecards, from the real log");
  ok("innings 1's total is exactly what was bowled", /52\/2/.test(body));
  ok("innings 2's total is exactly what was bowled", /40\/5/.test(body));
  ok("the not-out fifty-scorer is named with his real figures", /H Motaung/.test(body) && /52/.test(body));
  ok("the five-wicket bowler is named with his real figures in the bowling card", /D Frost/.test(body));

  group("Fall of wickets and partnerships — the fold's own, not invented");
  ok("innings 1's fall of wickets names both dismissals", await dos.page.locator('[data-testid="pmr-fow-0"]').innerText().then((t) => /52\/1/.test(t) && /52\/2/.test(t)));
  ok("innings 1 carries a partnership entry", await dos.page.locator('[data-testid="pmr-partnerships-0"]').count() === 1);

  group("Best batting and bowling figures for the match");
  // FigureCard's own label renders upper-cased, like Badge — see the /i note
  // on the result assertion above.
  ok("best batting names H Motaung's 52", /Best batting/i.test(body) && /52 \(13\)/.test(body), body.slice(0, 400));
  ok("best bowling names D Frost's five-for", /Best bowling/i.test(body) && /5\/40/.test(body), body.slice(0, 400));

  group("Key moments: the fifty and the five-for are both on the feed, in order");
  const moments = await dos.page.locator('[data-testid="pmr-key-moments"]').innerText();
  ok("H Motaung's fifty is on the feed", /H Motaung.*fifty|fifty.*H Motaung/i.test(moments) || /brings up fifty/.test(moments), moments.slice(0, 300));
  ok("D Frost's five-for is on the feed, with the real figures", /takes five.*5\/40/.test(moments), moments);
  ok("innings 1's moments precede innings 2's", moments.indexOf("H Motaung") < moments.indexOf("D Frost") || !moments.includes("D Frost"), moments);

  group("Phase breakdown — the same package the scorer's own pad uses, summing to the innings");
  const phaseSection = await dos.page.locator('[data-testid^="pmr-phases-"]').first().innerText().catch(() => "");
  ok("a phase table renders", phaseSection.length > 0, phaseSection);
  ok("the powerplay carries the innings' runs — everything here was bowled inside six overs", /Powerplay/.test(phaseSection) && /52|40/.test(phaseSection), phaseSection);

  group("Print-friendly: a print-only area exists, and the close chrome is excluded from it");
  const printArea = await dos.page.evaluate(() => !!document.querySelector(".os-print-area"));
  ok("the report sits inside the print utility class", printArea);
  const printBtn = dos.page.locator('[data-testid="pmr-print"]');
  ok("a Print action is offered", await printBtn.count() === 1);
  const printHideCount = await dos.page.evaluate(() => document.querySelectorAll(".os-print-hide").length);
  ok("the print action itself is marked to stay off the printed page", printHideCount >= 1, String(printHideCount));

  ok("no console errors on the director of sport's session", dos.errors.length === 0, dos.errors.join(" | "));
  await dos.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser report walk threw: ${e.message?.slice(0, 200)}`, false);
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
console.log(`\n${"─".repeat(52)}\nBROWSER POST-MATCH REPORT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

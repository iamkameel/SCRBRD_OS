#!/usr/bin/env node
/**
 * Match results and the league table, in a real browser (SCRBRD-114 phase 3a,
 * db/69), against a real API and Postgres: the screens a league's organiser,
 * a participant school and a stranger use.
 *
 *   A  THE ORGANISER. Competitions → the league: the table worked out from
 *      the results under the league's confirmed points, said so; the order it
 *      is ranked by; each result in words. The decision sheet on a match with
 *      no ball bowled offers a concession or a walkover and no award; a short
 *      reason is refused in words; a walkover lands, said, and the table and
 *      the result's words follow. The adjustment sheet offers an over-rate
 *      penalty (the league counts them in points); −2 for conduct lands and is
 *      withdrawn with a note.
 *   B  A PARTICIPANT. Westville's coach reads the same table and the same
 *      results, and is offered no sheet.
 *   C  THE MATCH CENTRE. The director of sport opens the walkover: the result
 *      line is the server's, "Walkover to …" — a fold of an empty log has none.
 *   D  SIGNED OUT. The served fixture's page says the result in the server's
 *      words, the sides named, no reason.
 *   E  Nothing is set under 12px, nothing pressed is under 44px, at a desktop,
 *      at 390 wide with no sideways scroll, and in Daylight.
 *
 * Every date is explicit (3 October 2026, the 4th Edition).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-results.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { toRow } from "@scrbrd/scoring";
import { buildLog } from "../packages/scoring/test/result-logs.mjs";

const PORT = port(8902);
const BASE = `http://127.0.0.1:${PORT}`;
const DEBUG = !!process.env.BROWSER_RESULTS_DEBUG;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const OWNER = "88888888-0000-0000-0000-000000000022";
const SCORER = "88888888-0000-0000-0000-000000000006";
const STARTS = "2026-10-03T10:00:00+02:00";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "browser-results-secret", PUBLIC_PAGES: "on",
         PUBLIC_PSEUDONYM_SECRET: "browser-results-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1",
         SERVE_CLIENT: process.env.RESULTS_DIST || "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));
api.stdout.on("data", (d) => { if (DEBUG) process.stdout.write(d); });

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await pool.query(text, params)).rows;

/** The league, its figures, and two matches: one played, one not yet. */
async function seed() {
  const [{ id: c }] = await q(`insert into competition (school_id, name, comp_type, format, level) values (null, 'Walk 069 League', 'league', 'T20', 'school') returning id`);
  for (const [school, team, name] of [[HIL, "1XI", "Walk 069 Hilton 1st XI"], [WES, "1XI", "Walk 069 Westville 1st XI"], [HIL, "2XI", "Walk 069 Hilton 2nd XI"]]) {
    await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, $3, $4)`, [c, school, team, name]);
  }
  const [{ id: s }] = await q(`insert into condition_set (competition_id, version, title, effective_from, created_by) values ($1, 1, 'Walk 069 v1', '2026-09-28', $2) returning id`, [c, OWNER]);
  for (const [k, v] of [["points.win", 4], ["points.tie", 2], ["points.no_result", 2], ["points.loss", 0], ["over_rate.kind", "points"]]) {
    await q(`insert into condition_value (set_id, key, value, status, source_document, source_clause, source_date, entered_by)
             values ($1, $2, $3, 'confirmed', 'Pilot league decision, Kameel', '8.3a', '2026-09-30', $4)`, [s, k, JSON.stringify(v), OWNER]);
  }
  await q(`update condition_set set status = 'published', published_by = $2, published_at = '2026-09-27 12:00+02' where id = $1`, [s, OWNER]);
  const [m1] = await q(`insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status, competition_id)
                        values ($1, '1XI', $2, '1XI', 'x', $3, 'cricket', 'T20', 20, 'complete', $4) returning id, opponent`, [HIL, WES, STARTS, c]);
  const [m2] = await q(`insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status, competition_id)
                        values ($1, '1XI', $2, '2XI', 'x', $3, 'cricket', 'T20', 20, 'scheduled', $4) returning id, opponent`, [WES, HIL, STARTS, c]);
  await q(`insert into match_conditions (match_id, set_id, set_version, doc, sources, doc_hash)
           select $1, r.set_id, r.set_version, r.doc, r.sources, '' from match_conditions_compute($1) r`, [m1.id]);
  // M1 as the pad writes it: Hilton 6 off an over, Westville none chasing 7.
  const log = buildLog([{ bat: "1XI", bowl: m1.opponent, steps: [1, 1, 1, 1, 1, 1], overs: 1 },
                        { bat: m1.opponent, bowl: "1XI", steps: [0, 0, 0, 0, 0, 0], overs: 1, target: 7 }]);
  let seq = 0;
  for (const ev of log) {
    const r = toRow(ev);
    seq++;
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq, client_ts,
                                     kind, ball_type, value, striker_id, non_striker_id, bowler_id, dismissed_id, dismissal, payload)
             values ($1, $2, $3, 1, $4, $5, 'walk-069', $6, $3, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [m1.id, HIL, seq, r.innings, SCORER, `${m1.id}:${ev.id}`, r.client_ts, r.kind, r.ball_type, r.value, r.striker_id, r.non_striker_id,
       r.bowler_id, r.dismissed_id, r.dismissal ?? null, JSON.stringify(r.payload)]);
  }
  return { c, m1: m1.id, m2: m2.id };
}

const browser = await chromium.launch({ ...launchOptions() });
let ipN = 0;
async function open(theme = "floodlit", viewport = { width: 1280, height: 900 }, path = "/") {
  const ctx = await browser.newContext({ viewport, extraHTTPHeaders: { "x-forwarded-for": `10.69.0.${++ipN}` } });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("dialog", (d) => { d.dismiss().catch(() => {}); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)};
    try { localStorage.setItem("scrbrd:theme", ${JSON.stringify(theme)}); } catch (e) {}`);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const words = async (loc) => ((await loc.first().innerText({ timeout: 3000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return (await page.locator("nav button").count()) > 0;
}
async function toLeague(page, c) {
  const l = page.locator("nav button", { hasText: /^Competitions$/ }).first();
  if (!(await l.count())) return false;
  await l.click({ timeout: 6000 });
  await page.waitForTimeout(1200);
  const b = tid(page, `competition-${c}`);
  if (!(await b.count())) return false;
  await b.click({ timeout: 5000 });
  await page.waitForTimeout(1800);
  return (await tid(page, "standings").count()) === 1;
}
const table = async (page) => page.locator('[data-testid="standings-row"]').evaluateAll((els) =>
  els.map((e) => `${e.getAttribute("data-side").replace("Walk 069 ", "")}=${e.getAttribute("data-points")}@${e.getAttribute("data-rank")}`).join(" "));
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA|SUMMARY)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio", "hidden"].includes(n.type))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, sideways: document.documentElement.scrollWidth - window.innerWidth };
  }).catch(() => ({ small: ["(not drawn)"], tiny: [], sideways: 0 }));
}
const floorsOk = (f) => f.small.length === 0 && f.tiny.length === 0;
const floorsWhy = (f) => [...f.small, ...f.tiny].slice(0, 4).join(" · ");

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const L = await seed();

  // ── A ──────────────────────────────────────────────────────────
  group("A. The organiser: the table, the decision sheet, the adjustment sheet");
  const org = await open();
  ok("the league's administrator signs in", await signIn(org.page, "league@example.invalid"));
  ok("Competitions → the league draws its table", await toLeague(org.page, L.c));
  const p = org.page;
  ok("worked out from the results, and says so", (await tid(p, "standings-basis").getAttribute("data-basis")) === "computed"
     && /confirmed points/.test(await words(tid(p, "standings-basis"))));
  ok("...ranked by points, then wins, then net run rate", /Ranked by points, then wins, then net run rate/.test(await words(tid(p, "standings-order"))));
  ok("Hilton's win puts it top on 4", (await table(p)) === "Hilton 1st XI=4@1 Westville 1st XI=0@2 Hilton 2nd XI=0@3", await table(p));
  const m1row = p.locator(`[data-testid="result-row"][data-match="${L.m1}"]`);
  ok("the result in words, the side by its name", (await words(m1row.locator('[data-testid="result-text"]'))) === "Hilton College 1XI won by 6 runs",
     await words(m1row));
  const m2row = p.locator(`[data-testid="result-row"][data-match="${L.m2}"]`);
  await m2row.locator('[data-testid="decision-open"]').click({ timeout: 5000 });
  await p.waitForTimeout(400);
  const sheet = tid(p, "decision-sheet");
  ok("no ball bowled: the sheet offers a concession or a walkover, and no award",
     (await sheet.locator('[data-testid="decision-kind-walkover"]').count()) === 1 && (await sheet.locator('[data-testid="decision-kind-awarded"]').count()) === 0);
  await sheet.locator('[data-testid="decision-kind-walkover"]').click();
  await sheet.locator('[data-testid="decision-side-home"]').click();
  await sheet.locator('[data-testid="decision-reason"]').fill("late");
  await sheet.locator('[data-testid="decision-save"]').click();
  await p.waitForTimeout(800);
  ok("a short reason is refused, in words", (await words(tid(p, "decision-error"))) === "Say why, in ten characters or more.", await words(tid(p, "decision-error")));
  await sheet.locator('[data-testid="decision-reason"]').fill("Hilton's 2nd XI did not arrive at the ground");
  await sheet.locator('[data-testid="decision-save"]').click();
  await p.waitForTimeout(1800);
  ok("the walkover lands, said", /Recorded: Walkover to Westville Boys' High 1XI/.test(await words(tid(p, "standings-said"))), await words(tid(p, "standings-said")));
  ok("...the result in words, decided by the organiser",
     (await words(p.locator(`[data-testid="result-row"][data-match="${L.m2}"] [data-testid="result-text"]`))) === "Walkover to Westville Boys' High 1XI"
     && (await p.locator(`[data-testid="result-row"][data-match="${L.m2}"] [data-testid="result-decided"]`).count()) === 1);
  ok("...and the table follows: Westville level on points and wins, behind on run rate",
     (await table(p)) === "Hilton 1st XI=4@1 Westville 1st XI=4@2 Hilton 2nd XI=0@3", await table(p));
  await tid(p, "adjust-open").click({ timeout: 5000 });
  await p.waitForTimeout(300);
  const kinds = await tid(p, "adjust-kind").locator("option").evaluateAll((os) => os.map((o) => o.value));
  ok("the adjustment sheet offers an over-rate penalty: the league counts them in points",
     kinds[0] === "over_rate" && /in points/.test(await words(tid(p, "over-rate-words"))), JSON.stringify(kinds));
  await tid(p, "adjust-side").selectOption({ label: "Walk 069 Westville 1st XI" });
  await tid(p, "adjust-kind").selectOption("conduct");
  await tid(p, "adjust-points").fill("-2");
  await tid(p, "adjust-reason").fill("umpires' report: dissent after the walkover");
  await tid(p, "adjust-save").click();
  await p.waitForTimeout(1800);
  ok("−2 for conduct lands, said, and the table has it",
     /−2 to Walk 069 Westville 1st XI/.test(await words(tid(p, "standings-said"))) && (await table(p)) === "Hilton 1st XI=4@1 Westville 1st XI=2@2 Hilton 2nd XI=0@3",
     `${await words(tid(p, "standings-said"))} | ${await table(p)}`);
  const f1 = await floors(p, "standings");
  ok("E: 12px and 44px floors at a desktop", floorsOk(f1), floorsWhy(f1));
  await tid(p, "adjustment-withdraw-open").first().click();
  await tid(p, "adjustment-withdraw-note").first().fill("the umpires withdrew the report");
  await tid(p, "adjustment-withdraw").first().click();
  await p.waitForTimeout(1800);
  ok("withdrawn with a note: the table restored, the adjustment kept and struck",
     (await table(p)) === "Hilton 1st XI=4@1 Westville 1st XI=4@2 Hilton 2nd XI=0@3"
     && (await p.locator('[data-testid="adjustment-row"][data-withdrawn="yes"]').count()) === 1, await table(p));
  ok("no console errors", org.errors.length === 0, org.errors.join(" | "));
  await org.ctx.close();

  // ── B ──────────────────────────────────────────────────────────
  group("B. A participant reads the same table and is offered no sheet; at 390 wide");
  const wes = await open();
  ok("Westville's coach signs in", await signIn(wes.page, "coach.wes@example.invalid"));
  ok("...and reads the league's table", await toLeague(wes.page, L.c));
  ok("the same table", (await table(wes.page)) === "Hilton 1st XI=4@1 Westville 1st XI=4@2 Hilton 2nd XI=0@3", await table(wes.page));
  ok("no decision, no adjustment offered", (await tid(wes.page, "decision-open").count()) === 0 && (await tid(wes.page, "adjust-open").count()) === 0);
  await wes.page.setViewportSize({ width: 390, height: 844 });
  await wes.page.waitForTimeout(800);
  const f2 = await floors(wes.page, "standings");
  ok("E: the floors at 390 wide, and no sideways scroll", floorsOk(f2) && f2.sideways <= 0, `${floorsWhy(f2)} sideways ${f2.sideways}`);
  ok("no console errors", wes.errors.length === 0, wes.errors.join(" | "));
  await wes.ctx.close();

  // ── C ──────────────────────────────────────────────────────────
  group("C. The Match Centre says the server's result");
  const ds = await open("daylight");
  ok("the director of sport signs in (Daylight)", await signIn(ds.page, "sarah@example.invalid"));
  await ds.page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
  await ds.page.waitForTimeout(1200);
  await tid(ds.page, "mc-filter-all").first().click({ timeout: 4000 }).catch(() => {});
  await ds.page.waitForTimeout(600);
  const openBtn = tid(ds.page, `mc-open-${L.m2}`);
  ok("the walkover is on the fixture list", (await openBtn.count()) === 1);
  if (await openBtn.count()) {
    await openBtn.click({ timeout: 5000 });
    await ds.page.waitForTimeout(2000);
    ok("the result line is the server's: a fold of an empty log has none",
       (await words(tid(ds.page, "mc-result"))) === "Walkover to Westville Boys' High 1XI", await words(tid(ds.page, "mc-result")));
  }
  // The table in Daylight.
  ok("Competitions → the league, in Daylight", await toLeague(ds.page, L.c));
  const f3 = await floors(ds.page, "standings");
  ok("E: the floors in Daylight", floorsOk(f3), floorsWhy(f3));
  ok("no console errors", ds.errors.length === 0, ds.errors.join(" | "));
  await ds.ctx.close();

  // ── D ──────────────────────────────────────────────────────────
  group("D. Signed out: the served fixture says the result, sides named, no reason");
  await q(`insert into fixture_publication (match_id, side, school_id, team_code, published, set_by) values ($1, 'home', $2, '1XI', true, $3)`, [L.m2, WES, OWNER]);
  const pub = await open("floodlit", { width: 390, height: 844 }, `/live/${L.m2}`);
  await pub.page.waitForTimeout(1500);
  ok("the public page says the walkover, in the server's words", (await words(tid(pub.page, "mc-result"))) === "Walkover to Westville Boys' High 1XI",
     await words(tid(pub.page, "mc-result")));
  const body = await pub.page.$eval("body", (el) => el.innerText);
  ok("...and not the organiser's reason", !/did not arrive/.test(body));
  ok("no console errors", pub.errors.length === 0, pub.errors.join(" | "));
  await pub.ctx.close();
} catch (err) {
  ok(`the walk threw: ${err.message?.slice(0, 300)}`, false);
  console.log(err.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await browser.close().catch(() => {});
  api.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 16).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER RESULTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

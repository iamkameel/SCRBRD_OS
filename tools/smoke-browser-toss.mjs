#!/usr/bin/env node
/**
 * The first innings follows the toss (SCRBRD-067).
 *
 * A live fixture's first `innings_start` used to name the home side (team1)
 * as batting whatever the toss said, and innings_start is the one event undo
 * will not walk past — so a side that won the toss and chose to field had
 * the whole first innings recorded against the wrong team, with no way back
 * on the pad. The toss has been recorded server-side (match_toss) all along.
 *
 *   A. A toss the server has, where the AWAY side bats first: the pad opens
 *      the innings with the away side batting and the home roster bowling,
 *      without asking, and the server's innings_start says the same.
 *   B. No toss recorded: the pad asks (winner, then bat or bowl) before any
 *      innings opens, opens nothing while unanswered, comes back to the
 *      question from the "can't score yet" fix, and — answered — opens the
 *      innings the answer puts in and records the answer as the toss.
 *
 * Checked against Postgres, not the page.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-toss.mjs
 *   BROWSER_TOSS_DEBUG=1 node tools/smoke-browser-toss.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { fromRow } from "@scrbrd/scoring";
import { EVENT_COLUMNS } from "../services/api/write/events-api.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 5297;
const API_PORT = 8797;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_TOSS_DEBUG;
const HIL = "11111111-1111-1111-1111-111111111111";
const MICHAELHOUSE = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: no toss, nothing scored
const KEARSNEY = "77777777-0000-0000-0000-000000000003";       // U16B v Kearsney College: the same
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-toss-secret",
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

/** Every event the server holds for a match, as the fold reads them. */
const serverEvents = async (match) =>
  (await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [match])).map(fromRow);
const serverOpen = async (match) => (await serverEvents(match)).find((e) => e.kind === "innings_start") ?? null;
/** The home side's players, by id — what the pad's roster read can return. */
const rosterIds = async (team) => new Set((await dbq(
  `select id from player where school_id = $1 and team_code = $2`, [HIL, team])).map((r) => r.id));

const browser = await chromium.launch({ ...launchOptions() });
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

const text = () => page.$eval("body", (el) => el.innerText);
const click = async (re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const tap = async (id, ms = 4000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(350); };

/** The pad's saved log for a match (persist.js: `kv` in `scrbrd`). */
const readSaved = (match) => page.evaluate((key) => new Promise((resolve, reject) => {
  const req = indexedDB.open("scrbrd", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const g = db.transaction("kv", "readonly").objectStore("kv").get(key);
    g.onsuccess = () => { db.close(); resolve(g.result ?? null); };
    g.onerror = () => { db.close(); reject(g.error); };
  };
}), `match:${match}`);
const padOpen = async (match) => ((await readSaved(match))?.events?.[0] ?? []).find((e) => e.kind === "innings_start") ?? null;

/** Open a fixture's scorer from the Match Centre, by the opponent's name. */
async function openFixture(opponent) {
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);
  const opened = await page.evaluate((name) => {
    const isBtn = (b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "");
    for (const b of [...document.querySelectorAll("button")].filter(isBtn)) {
      let card = b;
      while (card.parentElement && [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) card = card.parentElement;
      if (new RegExp(name, "i").test(card.textContent || "")) { b.click(); return true; }
    }
    return false;
  }, opponent);
  // The roster and the toss are read, the match claimed, the log offered.
  await page.waitForTimeout(4000);
  return opened;
}
async function exitScorer() {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator("button.os-exit-scorer").first().click({ timeout: 4000 });
  await page.waitForTimeout(800);
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Signing in");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));
  ok("neither fixture has a toss or a ball yet",
     (await dbq(`select 1 from match_toss where match_id = any($1)`, [[MICHAELHOUSE, KEARSNEY]])).length === 0
     && (await dbq(`select 1 from ball_event where match_id = any($1)`, [[MICHAELHOUSE, KEARSNEY]])).length === 0);

  group("A. The recorded toss puts the away side in: the innings opens that way, unasked");
  // The toss is called the real way — the route smoke-toss.mjs walks — by
  // the same seeded scorer: 1XI won it and chose to bowl, so Michaelhouse bat.
  const token = (await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "scorer@example.invalid", deviceId: "device-toss-walk" }) })).json())?.token;
  const called = await (await fetch(`${API}/api/matches/${MICHAELHOUSE}/toss`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ wonBy: "home", decision: "bowl" }) })).json();
  ok("the toss is recorded: home won, chose to bowl, away bats first", called?.batsFirst === "away", JSON.stringify(called));

  ok("the fixture opens on the pad", await openFixture("Michaelhouse"));
  ok("the pad does not ask about a toss it already has", await tid("toss-sheet").count() === 0);
  const pad = await padOpen(MICHAELHOUSE);
  if (DEBUG) console.log("[debug] pad innings_start:", JSON.stringify(pad)?.slice(0, 600));
  ok("the pad's innings_start names Michaelhouse batting", pad?.battingTeam === "Michaelhouse", pad?.battingTeam);
  ok("...and 1XI bowling", pad?.bowlingTeam === "1XI", pad?.bowlingTeam);
  const xi = await rosterIds("1XI");
  ok("the home roster went with the home side: it is the BOWLING squad",
     (pad?.bowlingSquad?.length ?? 0) > 0 && pad.bowlingSquad.every((p) => xi.has(p.id)), JSON.stringify(pad?.bowlingSquad)?.slice(0, 200));
  ok("...and the batting squad is empty — Michaelhouse are named as they come in", Array.isArray(pad?.squad) && pad.squad.length === 0,
     JSON.stringify(pad?.squad)?.slice(0, 200));
  const srv = await serverOpen(MICHAELHOUSE);
  ok("the server's innings_start says the same", srv?.id === pad?.id && srv?.battingTeam === "Michaelhouse" && srv?.bowlingTeam === "1XI"
     && srv?.squad?.length === 0 && srv?.bowlingSquad?.length === pad?.bowlingSquad?.length, JSON.stringify(srv)?.slice(0, 300));
  ok("...and it is the only one", (await serverEvents(MICHAELHOUSE)).filter((e) => e.kind === "innings_start").length === 1);

  group("B. No toss recorded: the pad asks first, and opens nothing until answered");
  await exitScorer();
  ok("the fixture opens on the pad", await openFixture("Kearsney"));
  ok("the pad asks who won the toss", await tid("toss-sheet").count() === 1);
  ok("...with nothing chosen for the scorer", await page.locator('[data-testid^="toss-"][aria-checked="true"]').count() === 0);
  ok("...and the innings cannot be opened on half an answer",
     await page.locator('[data-testid="toss-confirm"][disabled]').count() === 1);
  ok("nothing is open on the pad", !(await padOpen(KEARSNEY)));
  ok("...or on the server", (await serverEvents(KEARSNEY)).length === 0);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  ok("closing the question opens nothing: the pad says the batting side is not set",
     await tid("toss-sheet").count() === 0 && /batting side for this innings has not been set/i.test(await text()));
  await tap("scoring-blocked-fix");
  ok("...and its fix asks the question again, rather than defaulting", await tid("toss-sheet").count() === 1);

  await tap("toss-won-away");
  ok("half an answer still opens nothing", await page.locator('[data-testid="toss-confirm"][disabled]').count() === 1);
  await tap("toss-decision-bat");
  const confirmText = (await tid("toss-confirm").first().innerText()).trim();
  ok("the answer is read back before it is used: Kearsney College to bat", /Kearsney College to bat/i.test(confirmText), confirmText);
  await tap("toss-confirm");
  await page.waitForTimeout(3000);
  ok("the sheet is gone", await tid("toss-sheet").count() === 0);

  const pad2 = await padOpen(KEARSNEY);
  if (DEBUG) console.log("[debug] pad innings_start:", JSON.stringify(pad2)?.slice(0, 600));
  ok("the innings opens with the side the answer put in: Kearsney College batting",
     pad2?.battingTeam === "Kearsney College" && pad2?.bowlingTeam === "U16B", `${pad2?.battingTeam} v ${pad2?.bowlingTeam}`);
  const u16 = await rosterIds("U16B");
  ok("...the home roster bowling, and nobody's batting",
     (pad2?.squad?.length ?? -1) === 0 && (pad2?.bowlingSquad ?? []).every((p) => u16.has(p.id) || !u16.size),
     JSON.stringify(pad2?.bowlingSquad)?.slice(0, 200));
  const srv2 = await serverOpen(KEARSNEY);
  ok("the server has the same innings_start", srv2?.id === pad2?.id && srv2?.battingTeam === "Kearsney College");
  const toss = (await dbq(`select t.won_by, t.decision, bats_first(t.won_by, t.decision) as bats_first, u.email
                             from match_toss t left join app_user u on u.id = t.called_by where t.match_id = $1`, [KEARSNEY]))[0];
  ok("the answer is recorded as the toss", toss?.won_by === "away" && toss?.decision === "bat" && toss?.bats_first === "away", JSON.stringify(toss));
  ok("...called by the scorer on the pad", toss?.email === "scorer@example.invalid", toss?.email);

  group("C. Reopened, the pad reads its own log — it does not ask again");
  await exitScorer();
  ok("the fixture reopens", await openFixture("Kearsney"));
  ok("no question", await tid("toss-sheet").count() === 0);
  ok("still one innings_start, on the pad and on the server",
     ((await readSaved(KEARSNEY))?.events?.[0] ?? []).filter((e) => e.kind === "innings_start").length === 1
     && (await serverEvents(KEARSNEY)).filter((e) => e.kind === "innings_start").length === 1);

  ok("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await ctx.close().catch(() => {});
  await browser.close();
  web.close();
  api.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 10).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER TOSS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

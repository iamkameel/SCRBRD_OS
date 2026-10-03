#!/usr/bin/env node
/**
 * The live scorer scores the side the coach named (scorer/side.js).
 *
 * A coach names the side for a fixture (Pick the side, POST /matches/:id/squad
 * into `match_squad`, where the age and registration triggers live). The pad
 * used to read the team's whole roster instead, so the coach's sheet and the
 * scorer could disagree, and a boy the triggers refused could still be scored.
 * Seeded people and boys invented for the walk:
 *
 *   A. A NAMED SIDE: the U14A coach names thirteen, then names the side again
 *      as eleven and a twelfth — the boy left out is withdrawn, not deleted.
 *      The toss puts U14A in. The scorer opens the fixture: the innings_start
 *      the pad writes (and the server holds) has exactly those eleven, in the
 *      batting order the coach gave; the openers' sheet says "The side the
 *      coach named" and offers those eleven in that order — not the twelfth,
 *      not the withdrawn boy, not the rest of the roster.
 *   B. NO SIDE NAMED: another U14A fixture, the same toss. The pad opens with
 *      the U14A roster, exactly as before, and says "The whole U14A roster: no
 *      side has been named".
 *   C. THE AWAY SIDE BATS FIRST on a named side: the coach's eleven bowl, in
 *      order; the away batting squad is empty, typed as they come in (a school
 *      not on SCRBRD); the openers' sheet says nothing about where a side came
 *      from, because none did; and the opening bowler's sheet says "The side
 *      the coach named" and offers those eleven, nobody else.
 *
 * Checked against Postgres, not the page.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-scorer-side.mjs
 *   BROWSER_SIDE_DEBUG=1 node tools/smoke-browser-scorer-side.mjs
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
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(5397);
const API_PORT = port(8918);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_SIDE_DEBUG;
const HIL = "11111111-1111-1111-1111-111111111111";
const GUARDIAN = "88888888-0000-0000-0000-0000000000f6";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-scorer-side-secret",
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

const pool = new pg.Pool({ connectionString: ownerUrl() });
const dbq = async (text, params) => (await pool.query(text, params)).rows;
const serverEvents = async (match) =>
  (await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [match])).map(fromRow);
const serverOpen = async (match) => (await serverEvents(match)).find((e) => e.kind === "innings_start") ?? null;

const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-scorer-side" } })).body?.token;

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
  // The roster, the sheet and the toss are read, the match claimed, the log offered.
  await page.waitForTimeout(4000);
  return opened;
}
async function exitScorer() {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator("button.os-exit-scorer").first().click({ timeout: 4000 });
  await page.waitForTimeout(800);
}
/** The openers' sheet, opened from the "can't score yet" fix: its line and the names it offers, in order. */
async function openersSheet() {
  if (await tid("scoring-blocked-fix").count()) await tap("scoring-blocked-fix");
  await page.waitForTimeout(400);
  const line = await tid("side-source").count() ? { words: (await tid("side-source").first().innerText()).trim(), source: await tid("side-source").first().getAttribute("data-source") } : null;
  const names = await page.$$eval('[role="dialog"] button, [data-testid="sheet"] button', (els) => els.map((e) => (e.textContent || "").trim()));
  return { line, names, body: await text() };
}
const ids = (xs) => (xs ?? []).map((p) => p?.id ?? p);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ══ The stage ══════════════════════════════════════════════════════════
  group("Set the stage: thirteen registered U14A boys, three fixtures, no ball bowled");
  await dbq(`insert into app_user (id, school_id, email, name, role) values ($1, $2, 'side.parent@example.invalid', 'A Side Parent', 'parent')`, [GUARDIAN, HIL]);
  const registrar = await login("registrar@example.invalid");
  const num = (i) => String(i).padStart(2, "0");
  /** @type {Record<string, string>} */
  const boy = {};
  for (let i = 1; i <= 13; i++) {
    // A little under thirteen: inside U14, a minor, so each needs a verified guardian and consent.
    const id = (await dbq(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born) values ($1, 'U14A', $2, $3, 'batter', current_date - interval '12 years 6 months') returning id`,
      [HIL, `Verify Side ${num(i)}`, 60 + i]))[0].id;
    boy[num(i)] = id;
    await call(`/api/players/${id}/guardians`, { method: "POST", token: registrar, body: { guardianId: GUARDIAN, relationship: "parent" } });
    await call(`/api/players/${id}/guardians/verify`, { method: "POST", token: registrar, body: { guardianId: GUARDIAN, consentVersion: "popia-2026-01" } });
  }
  const fixture = async (opponent) => (await dbq(
    `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, 'U14A', $2, now() + interval '2 days', 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL, opponent]))[0].id;
  const NAMED = await fixture("Verify Named XI");
  const ROSTER = await fixture("Verify Roster XI");
  const AWAY = await fixture("Verify Away XI");
  const u14 = (await dbq(`select id from player where school_id = $1 and team_code = 'U14A'`, [HIL])).map((r) => r.id);
  ok("the stage is set", !!NAMED && !!ROSTER && !!AWAY && Object.keys(boy).length === 13 && u14.length >= 13);

  // The coach names thirteen for NAMED, then names the side again without
  // boy 13 and with boy 12 as twelfth man: boy 13's row is withdrawn.
  const coach = await login("u14coach@example.invalid");
  const first = await call(`/api/matches/${NAMED}/squad`, { method: "POST", token: coach, body: { side: "home",
    players: [...Array.from({ length: 11 }, (_, i) => ({ playerId: boy[num(i + 1)], battingNo: i + 1 })), { playerId: boy["13"] }, { playerId: boy["12"], twelfth: true }] } });
  ok("the coach names thirteen", first.status === 200 && first.body?.selected === 13, JSON.stringify(first.body));
  // The order he settles on: 11 opens, 1 is last, the rest as numbered.
  const order = ["11", "02", "03", "04", "05", "06", "07", "08", "09", "10", "01"];
  const side = order.map((k, i) => ({ playerId: boy[k], battingNo: i + 1 }));
  const second = await call(`/api/matches/${NAMED}/squad`, { method: "POST", token: coach, body: { side: "home", players: [...side, { playerId: boy["12"], twelfth: true }] } });
  ok("...then the side again: eleven and a twelfth", second.status === 200 && second.body?.selected === 12, JSON.stringify(second.body));
  const held = await dbq(`select player_id, batting_no, twelfth, withdrawn from match_squad where match_id = $1`, [NAMED]);
  ok("the database holds boy 13 withdrawn, not deleted", held.find((r) => r.player_id === boy["13"])?.withdrawn === true && held.filter((r) => !r.withdrawn).length === 12);
  const third = await call(`/api/matches/${AWAY}/squad`, { method: "POST", token: coach, body: { side: "home", players: side } });
  ok("the same eleven named for the fixture the away side will bat first in", third.status === 200 && third.body?.selected === 11, JSON.stringify(third.body));

  // The tosses, called the real way by the scorer: U14A bat in NAMED and
  // ROSTER; in AWAY, U14A win and bowl.
  const scorer = await login("scorer@example.invalid");
  for (const [m, wonBy, decision, bats] of [[NAMED, "home", "bat", "home"], [ROSTER, "home", "bat", "home"], [AWAY, "home", "bowl", "away"]]) {
    const t = await call(`/api/matches/${m}/toss`, { method: "POST", token: scorer, body: { wonBy, decision } });
    ok(`the toss is recorded (${bats} bats first)`, t.body?.batsFirst === bats, JSON.stringify(t.body));
  }
  // What the scorer may read of the sheet: the governed read the pad uses.
  const read = await call(`/api/read/match_squad?matchId=${NAMED}`, { token: scorer });
  ok("the scorer may read the named side (player.profile.read): twelve rows, boy 13 not among them",
     read.status === 200 && read.body?.rows?.length === 12 && !read.body.rows.some((r) => r.player_id === boy["13"]), JSON.stringify(read.body)?.slice(0, 200));

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));

  // ══ A ═════════════════════════════════════════════════════════════════
  group("A. A named side: the pad opens with exactly those eleven, in the coach's order");
  ok("the fixture opens on the pad", await openFixture("Verify Named XI"));
  const padA = await padOpen(NAMED);
  if (DEBUG) console.log("[debug] pad innings_start:", JSON.stringify(padA)?.slice(0, 800));
  const want = order.map((k) => boy[k]);
  ok("the pad's innings_start has U14A batting", padA?.battingTeam === "U14A", padA?.battingTeam);
  ok("...with exactly the eleven named, in the batting order given", JSON.stringify(ids(padA?.squad)) === JSON.stringify(want), JSON.stringify(ids(padA?.squad)));
  ok("...not the twelfth man, not the withdrawn boy, not the rest of the roster",
     !ids(padA?.squad).includes(boy["12"]) && !ids(padA?.squad).includes(boy["13"]) && padA?.squad?.length === 11);
  ok("...each a squad member as before: id, name and batting hand",
     padA?.squad?.[0]?.name === "Verify Side 11" && padA.squad.every((p) => p.batHand === "R"), JSON.stringify(padA?.squad?.[0]));
  ok("...and no twelfth man on the event, as before", (padA?.twelfthMan ?? null) === null);
  await page.waitForTimeout(1500);
  const srvA = await serverOpen(NAMED);
  ok("the server's innings_start says the same", srvA?.id === padA?.id && JSON.stringify(ids(srvA?.squad)) === JSON.stringify(want), JSON.stringify(ids(srvA?.squad)));
  const shA = await openersSheet();
  if (DEBUG) console.log("[debug] openers:", JSON.stringify(shA.line), shA.names.slice(0, 16));
  ok("the openers' sheet says the side the coach named", shA.line?.words === "The side the coach named" && shA.line?.source === "named", JSON.stringify(shA.line));
  const offered = shA.names.filter((n) => /Verify Side \d\d/.test(n)).map((n) => n.match(/Verify Side \d\d/)[0]);
  ok("...offers those eleven, number 11 first and number 1 last",
     offered.length === 11 && offered[0] === "Verify Side 11" && offered[10] === "Verify Side 01", offered.join(", "));
  ok("...and never the withdrawn boy", !/Verify Side 13/.test(shA.body));
  ok("...the twelfth man is not offered to bat", !offered.includes("Verify Side 12"));
  await exitScorer();

  // ══ B ═════════════════════════════════════════════════════════════════
  group("B. No side named: the U14A roster, as before, and the pad says so");
  ok("the fixture opens on the pad", await openFixture("Verify Roster XI"));
  const padB = await padOpen(ROSTER);
  if (DEBUG) console.log("[debug] pad innings_start:", JSON.stringify(padB)?.slice(0, 400));
  ok("the batting squad is the whole U14A roster",
     padB?.squad?.length === u14.length && ids(padB.squad).every((id) => u14.includes(id)), `${padB?.squad?.length} of ${u14.length}`);
  ok("...withdrawn and twelfth elsewhere change nothing here: boys 12 and 13 are in it", ids(padB?.squad).includes(boy["12"]) && ids(padB?.squad).includes(boy["13"]));
  const shB = await openersSheet();
  ok("the openers' sheet says: the whole U14A roster, no side named",
     shB.line?.words === "The whole U14A roster: no side has been named" && shB.line?.source === "roster", JSON.stringify(shB.line));
  await exitScorer();

  // ══ C ═════════════════════════════════════════════════════════════════
  group("C. The away side bats first: the named eleven bowl, the away side is typed");
  ok("the fixture opens on the pad", await openFixture("Verify Away XI"));
  const padC = await padOpen(AWAY);
  ok("the away side is batting", padC?.battingTeam === "Verify Away XI" && padC?.bowlingTeam === "U14A", `${padC?.battingTeam} v ${padC?.bowlingTeam}`);
  ok("...the named eleven are the bowling squad, in order", JSON.stringify(ids(padC?.bowlingSquad)) === JSON.stringify(want), JSON.stringify(ids(padC?.bowlingSquad)));
  ok("...and the batting squad is empty, typed as they come in", Array.isArray(padC?.squad) && padC.squad.length === 0);
  const shC = await openersSheet();
  ok("the openers' sheet says nothing about a side nobody gave the pad", shC.line === null, JSON.stringify(shC.line));
  // Two openers typed, as an away side's are; the opening bowler's sheet follows.
  for (const n of ["Verify Opener A", "Verify Opener B"]) {
    await page.locator('input[aria-label="Player name"]').first().fill(n);
    await page.locator('input[aria-label="Player name"]').first().press("Enter");
    await page.waitForTimeout(500);
  }
  await page.waitForSelector('[data-testid="bowler-choices"]', { timeout: 6000 }).catch(() => {});
  const bowlLine = await tid("side-source").count() ? (await tid("side-source").first().innerText()).trim() : null;
  ok("the opening bowler's sheet says the side the coach named", bowlLine === "The side the coach named", String(bowlLine));
  const bowlers = await page.$$eval('[data-testid="bowler-choice"]', (els) => els.map((e) => e.getAttribute("data-id")));
  ok("...and offers those eleven to bowl, nobody else", bowlers.length === 11 && bowlers.every((id) => want.includes(id)), JSON.stringify(bowlers));
  await exitScorer();

  ok("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await ctx.close().catch(() => {});
  await browser.close();
  web.close();
  apiProc.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 10).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SCORER SIDE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

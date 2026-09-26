#!/usr/bin/env node
/**
 * An event the server refused, from the pad (SCRBRD-070).
 *
 * Since db/36 the server judges every live event against the Laws and writes
 * nothing it refuses; the device holds its copy (packages/sync, `held`). Until
 * this walk nothing showed a scorer what was held or let them resolve it, and
 * the pad's own board went on counting the refused events — so the device
 * and the server disagreed, silently, until someone noticed the score.
 *
 * The refusal is provoked the honest way: a log on the device that the
 * server's Laws will not take — the same bowler for two overs running, and
 * the balls after him (which the server, never having had a bowler, refuses
 * too: the cascade). It is put where the pad keeps its log, exactly as a
 * build with a weaker gate, a second client or a replayed queue would leave
 * it, and the real pad sends it to the real server.
 *
 * Then the questions:
 *   A. The pad says so: "Refused 3", and the sheet names each one in words.
 *   B. Discard one: it leaves the board, and the board re-derives.
 *   C. Close and reopen: the held events come back ONCE, not doubled.
 *   D. The cascade, repaired: discard the bowler, name the right one on the
 *      pad, and record the refused ball again — the server takes it, credited
 *      to the right bowler, and nothing is written twice.
 *   E. The cascade, let go: "discard this and the N after it" — and the
 *      handover sheet warns (and does not block) while any are held.
 *   F. Undo reaches a refused event that is NOT the last one (SCRBRD-071):
 *      it leaves the pad's log like an unsent event and its held copy goes —
 *      no void is sent, which the server would only refuse and hold too.
 * After B-less-held, D and E, the board and the server's log agree event for
 * event and figure for figure — checked against Postgres, not the page.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-held.mjs
 *   BROWSER_HELD_DEBUG=1 node tools/smoke-browser-held.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { inningsStart, batters, bowler, ball, voidEvent, BALL_TYPE, deriveInnings, fromRow } from "@scrbrd/scoring";
import { EVENT_COLUMNS } from "../services/api/write/events-api.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 5293;
const API_PORT = 8793;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_HELD_DEBUG;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const SQUAD = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "James Whitfield" },
  { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "T Bekker" },
  { id: "aaaaaaaa-0000-0000-0000-000000000003", name: "S Naidoo" },
];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-held-secret",
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
async function serverLog() {
  const rows = await dbq(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [MATCH]);
  const evs = rows.map(fromRow).filter((e) => (e.innings ?? 0) === 0);
  return { rows, ids: evs.map((e) => e.id), inn: deriveInnings(evs) };
}
const figures = (inn) => inn && `${inn.runs}/${inn.wickets} in ${inn.balls} balls`;

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

/** The pad's board, as the screen reader hears it: "11 for 0, 1.2 overs". */
const board = async () => ((await page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / })
  .first().textContent().catch(() => "")) || "").trim();
const boardOf = (inn) => `${inn.runs} for ${inn.wickets}, ${Math.floor(inn.balls / 6)}.${inn.balls % 6} overs`;
const pill = async () => ((await tid("held-open").first().innerText().catch(() => "")) || "").trim();

/** IndexedDB, as the pad keeps it: persist.js's `kv` store in `scrbrd`. */
const readSaved = () => page.evaluate((key) => new Promise((resolve, reject) => {
  const req = indexedDB.open("scrbrd", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const g = db.transaction("kv", "readonly").objectStore("kv").get(key);
    g.onsuccess = () => { db.close(); resolve(g.result ?? null); };
    g.onerror = () => { db.close(); reject(g.error); };
  };
}), `match:${MATCH}`);
const writeSaved = (value) => page.evaluate(([key, v]) => new Promise((resolve, reject) => {
  const req = indexedDB.open("scrbrd", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const t = db.transaction("kv", "readwrite");
    t.objectStore("kv").put(v, key);
    t.oncomplete = () => { db.close(); resolve(true); };
    t.onerror = () => { db.close(); reject(t.error); };
  };
}), [`match:${MATCH}`, value]);
/** The outbox's held copies on disk (packages/sync indexeddb-storage). */
const heldOnDisk = () => page.evaluate((prefix) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd-outbox", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("queue")) req.result.createObjectStore("queue"); };
  req.onerror = () => resolve(-1);
  req.onsuccess = () => {
    const db = req.result;
    const k = db.transaction("queue", "readonly").objectStore("queue").getAllKeys();
    k.onsuccess = () => { db.close(); resolve(k.result.filter((x) => String(x).startsWith(prefix) && String(x).includes(":held:")).length); };
    k.onerror = () => { db.close(); resolve(-1); };
  };
}), `${MATCH}:`);
const padIds = async () => ((await readSaved())?.events?.[0] ?? []).map((e) => e.id);

/** Balls attributed the way the pad attributes them: the crease before the ball. */
function attributed(log, evs) {
  const out = [...log];
  for (const ev of evs) {
    if (ev.kind === "ball") {
      const before = deriveInnings(out);
      Object.assign(ev, { striker: before.striker, nonStriker: before.nonStriker, bowler: before.bowler });
    }
    out.push(ev);
  }
  return evs;
}

async function openFixture() {
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
  await page.waitForTimeout(2500);
  if (!(await page.locator('[data-testid="basic-pad"]').count())) { await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).catch(() => {}); await page.locator('[data-testid="pad-basic-scoring"]').click({ timeout: 2500 }).catch(() => {}); }
  // Let the pad offer its log and the server answer.
  await page.waitForTimeout(3500);
  return opened;
}
async function exitScorer() {
  await page.locator("button.os-exit-scorer").first().click({ timeout: 4000 });
  await page.waitForTimeout(800);
}
/** The row for one held event in the sheet, by its key. */
const item = (key) => page.locator(`[data-testid="held-item"][data-held-key="${key}"]`);
const confirmYes = async () => { await tap("held-confirm-yes"); await page.waitForTimeout(900); };

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Signing in, and a log on the device the server's Laws will not take");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));

  const device = await page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  ok("the device has its id", !!device, device);
  let n = 0;
  const id = () => `${device}:${MATCH}:held-walk:${++n}`;
  const w = (ev) => ({ ...ev, id: id() });

  const OPEN = w(inningsStart({ innings: 0, battingTeam: "Hilton 1XI", bowlingTeam: "Michaelhouse", squad: SQUAD, bowlingSquad: [], overs: 20 }));
  const PAIR = w(batters({ innings: 0, striker: SQUAD[0].id, nonStriker: SQUAD[1].id }));
  const NEL = w(bowler({ innings: 0, bowler: "A Nel" }));
  const prefix = [OPEN, PAIR, NEL];
  const OVER1 = attributed(prefix, [1, 0, 0, 4, 0, 0].map((v) => w(ball({ innings: 0, type: BALL_TYPE.RUN, value: v }))));
  // Law 17.8: not two overs running. The pad's own new-over sheet would not
  // offer him; a log from anywhere else can still carry it.
  const NEL_AGAIN = w(bowler({ innings: 0, bowler: "A Nel" }));
  const [B1, B2] = attributed([...prefix, ...OVER1, NEL_AGAIN],
    [4, 2].map((v) => w(ball({ innings: 0, type: BALL_TYPE.RUN, value: v }))));
  const LOG = [...prefix, ...OVER1, NEL_AGAIN, B1, B2];
  await writeSaved({ events: [LOG, []], curIn: 0, cfg: null, matchId: MATCH, savedAt: Date.now() });

  group("A. The pad sends it, the server refuses three, and the pad says so in words");
  ok("the fixture opens on the pad", await openFixture());
  const s0 = await serverLog();
  ok("the server wrote the legal part — innings, batters, bowler, one over", s0.ids.length === 9 && s0.ids.every((k, i) => k === LOG[i].id), s0.ids.length);
  ok("...and none of the three it refused", ![NEL_AGAIN.id, B1.id, B2.id].some((k) => s0.ids.includes(k)));
  ok("the pill names them: Refused 3", /Refused 3/.test(await pill()), await pill());
  ok("the board still counts them — the disagreement this is about", (await board()) === "11 for 0, 1.2 overs", await board());
  ok("...while the server has 5 in one over", figures(s0.inn) === "5/0 in 6 balls", figures(s0.inn));

  await tap("held-open");
  ok("tapping the pill opens the sheet", await tid("held-sheet").count() === 1);
  ok("...listing all three", await tid("held-item").count() === 3);
  const bowlerRow = await item(NEL_AGAIN.id).innerText();
  if (DEBUG) console.log("[debug] bowler row:\n" + bowlerRow);
  ok("the bowler, by name", /Bowler — A Nel to bowl/.test(bowlerRow), bowlerRow);
  ok("...refused in words: two overs running", /a bowler may not bowl two overs in a row/.test(bowlerRow), bowlerRow);
  ok("...with the cascade offered as one choice", /Discard this and the 2 after it/.test(bowlerRow));
  const ballRow = await item(B1.id).innerText();
  if (DEBUG) console.log("[debug] ball row:\n" + ballRow);
  ok("a ball, with the batter's name", /Ball — 4 runs, T Bekker facing A Nel|Ball — 4 runs, James Whitfield facing A Nel/.test(ballRow), ballRow);
  ok("...refused because nobody was bowling, on the server", /nobody had been named to bowl the over/.test(ballRow), ballRow);
  ok("...and recording it again is NOT offered — it would be refused the same way",
     /Recording it again would be refused too/.test(ballRow) && await item(B1.id).locator('[data-testid^="held-resend"]').count() === 0);

  group("B. Discard one: it leaves the board, and nothing else moves");
  await item(B2.id).locator('[data-testid^="held-discard-"]').filter({ hasText: /^Discard$/ }).first().click({ timeout: 3000 });
  await page.waitForTimeout(300);
  ok("discarding asks first", await tid("held-confirm").count() === 1);
  await confirmYes();
  ok("two left in the sheet", await tid("held-item").count() === 2);
  ok("the board lost its 2 runs and its ball", (await board()) === "9 for 0, 1.1 overs", await board());
  ok("...the pad's saved log no longer has it", !(await padIds()).includes(B2.id));
  ok("...and the server's log did not change", (await serverLog()).ids.length === 9);

  group("C. Close the pad and open it again: held once, not twice");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await exitScorer();
  ok("the fixture reopens", await openFixture());
  ok("still Refused 2 — the pad re-offered its whole log and the held ones were not queued again", /Refused 2/.test(await pill()), await pill());
  ok("...two held copies on disk, not four", (await heldOnDisk()) === 2, await heldOnDisk());
  ok("...the server's log unchanged", (await serverLog()).ids.length === 9);

  group("D. The cascade, repaired: discard the bowler, name the right one, record the ball again");
  await tap("held-open");
  await item(NEL_AGAIN.id).locator('[data-testid^="held-discard-"]').filter({ hasText: /^Discard$/ }).first().click({ timeout: 3000 });
  await confirmYes();
  ok("one left: the ball", await tid("held-item").count() === 1);
  ok("...still not offered for recording again — letting the bowler go gave the server no bowler",
     await item(B1.id).locator('[data-testid^="held-resend"]').count() === 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // The pad now asks for a bowler (its board: an over by nobody after the
  // first). The scorer names the one who actually bowled.
  await tid("scoring-blocked-fix").first().click({ timeout: 3000 });
  await page.waitForTimeout(500);
  await page.locator("input[placeholder*='Bowler name' i]").last().fill("B Botha");
  await click(/^Go$/, 2000);
  await page.waitForTimeout(2500);
  const s1 = await serverLog();
  ok("the right bowler reached the server", s1.rows.some((r) => r.kind === "bowler" && r.payload?.bowler === "B Botha"));

  await tap("held-open");
  const offer = await item(B1.id).innerText();
  if (DEBUG) console.log("[debug] ball row, bowler named:\n" + offer);
  ok("now the ball can be recorded again", await item(B1.id).locator('[data-testid^="held-resend-"]').count() === 1, offer);
  ok("...shown as it will be recorded: credited to the bowler now on", /Recorded again it would be: Ball — 4 runs, .* facing B Botha/.test(offer), offer);
  await item(B1.id).locator('[data-testid^="held-resend-"]').first().click({ timeout: 3000 });
  await page.waitForTimeout(300);
  ok("recording again asks first", await tid("held-confirm").count() === 1);
  await confirmYes();
  await page.waitForTimeout(2500);
  ok("nothing is held", await tid("held-empty").count() === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok("the pill says Sent", /\bSent\b/.test(await text()));

  const s2 = await serverLog();
  const copyRow = s2.rows.find((r) => r.payload?.resentFrom === B1.id);
  ok("the server has the ball, under a new id that says what it replaces", !!copyRow && copyRow.idempotency_key !== B1.id, JSON.stringify(copyRow?.payload));
  ok("...credited to B Botha", copyRow?.payload?.bowler === "B Botha");
  ok("...and none of the three original keys, ever", ![NEL_AGAIN.id, B1.id, B2.id].some((k) => s2.ids.includes(k)));
  const ids2 = await padIds();
  ok("the pad's log and the server's log hold the same events, in the same order",
     JSON.stringify(ids2) === JSON.stringify(s2.ids), `${ids2.length} v ${s2.ids.length}`);
  ok("...and the board shows the server's figures", (await board()) === boardOf(s2.inn), `${await board()} v ${boardOf(s2.inn)}`);
  ok("...9 runs in 7 balls", figures(s2.inn) === "9/0 in 7 balls", figures(s2.inn));

  group("E. The cascade, let go — and the handover warns while it is held");
  await exitScorer();
  const saved = await readSaved();
  const log2 = saved.events[0];
  const rest = attributed(log2, [1, 0, 0, 0, 0].map((v) => w(ball({ innings: 0, type: BALL_TYPE.RUN, value: v }))));
  const BOTHA_AGAIN = w(bowler({ innings: 0, bowler: "B Botha" }));
  const [C1, C2] = attributed([...log2, ...rest, BOTHA_AGAIN], [6, 1].map((v) => w(ball({ innings: 0, type: BALL_TYPE.RUN, value: v }))));
  await writeSaved({ ...saved, events: [[...log2, ...rest, BOTHA_AGAIN, C1, C2], []], savedAt: Date.now() });
  ok("the fixture reopens", await openFixture());
  ok("Refused 3: the second bowler and both balls after him", /Refused 3/.test(await pill()), await pill());
  ok("...the five legal balls went through", (await serverLog()).ids.length === s2.ids.length + 5);

  await tap("open-handover");
  ok("the handover sheet warns that refused events are held", await tid("handover-held-warning").count() === 1);
  ok("...and does not block: the handover can still be armed", await page.locator('[data-testid="handover-arm"]:not([disabled])').count() === 1);
  await tap("handover-held-review");
  ok("...and its warning leads to the list", await tid("held-sheet").count() === 1 && await tid("held-item").count() === 3);

  const cascade = await item(BOTHA_AGAIN.id).innerText();
  ok("the bowler offers to take the two after him with him", /Discard this and the 2 after it/.test(cascade), cascade);
  await item(BOTHA_AGAIN.id).locator('[data-testid^="held-discard-from-"]').first().click({ timeout: 3000 });
  await page.waitForTimeout(300);
  const ask = await tid("held-confirm").innerText();
  ok("...and says which three before anything goes", /Bowler — B Botha to bowl/.test(ask) && /6 runs/.test(ask) && /1 run\b/.test(ask), ask);
  await confirmYes();
  ok("nothing is held", await tid("held-empty").count() === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  ok("the pill says Sent", /\bSent\b/.test(await text()));

  const s3 = await serverLog();
  const ids3 = await padIds();
  ok("the pad's log and the server's log hold the same events, in the same order",
     JSON.stringify(ids3) === JSON.stringify(s3.ids), `${ids3.length} v ${s3.ids.length}`);
  ok("...and the board shows the server's figures", (await board()) === boardOf(s3.inn), `${await board()} v ${boardOf(s3.inn)}`);
  ok("...10 runs in 12 balls, none of the three it refused", figures(s3.inn) === "10/0 in 12 balls"
     && ![BOTHA_AGAIN.id, C1.id, C2.id].some((k) => s3.ids.includes(k)), figures(s3.inn));
  ok("no held copies left on disk", (await heldOnDisk()) === 0);

  group("F. Undo of a refused event that is not the last one: it leaves the log, and nothing is sent");
  await exitScorer();
  const saved3 = await readSaved();
  const log3 = saved3.events[0];
  // Botha a third over running (refused, Law 17.8); then C Cele, whom the
  // server takes — it had nobody bowling — and the scorer's undo of Cele,
  // which it also takes (Cele was the latest). The next undo reaches Botha:
  // held, with two events the server accepted sitting after him.
  const BOTHA_THIRD = w(bowler({ innings: 0, bowler: "B Botha" }));
  const CELE = w(bowler({ innings: 0, bowler: "C Cele" }));
  const UNDO_CELE = w(voidEvent({ innings: 0, target: CELE.id }));
  await writeSaved({ ...saved3, events: [[...log3, BOTHA_THIRD, CELE, UNDO_CELE], []], savedAt: Date.now() });
  ok("the fixture reopens", await openFixture());
  const s4 = await serverLog();
  ok("the server refused Botha and took Cele and the undo of him",
     !s4.ids.includes(BOTHA_THIRD.id) && s4.ids.includes(CELE.id) && s4.ids.includes(UNDO_CELE.id), s4.ids.slice(-3).join(" "));
  ok("the pill says Refused 1", /Refused 1/.test(await pill()), await pill());
  ok("...and the refused bowler is not the last event on the pad", (await padIds()).at(-1) === UNDO_CELE.id);

  await page.getByRole("button", { name: "Undo the last ball" }).first().click({ timeout: 4000 });
  await page.waitForTimeout(3000);
  const afterUndo = (await readSaved())?.events?.[0] ?? [];
  ok("undo takes the refused bowler out of the pad's log", !afterUndo.some((e) => e.id === BOTHA_THIRD.id));
  ok("...without a void of him — on the pad", !afterUndo.some((e) => e.kind === "void" && e.target === BOTHA_THIRD.id));
  const s5 = await serverLog();
  ok("...or on the server: nothing new was sent", s5.rows.length === s4.rows.length, `${s5.rows.length} v ${s4.rows.length}`);
  ok("...Cele and the undo of him stay where they were", JSON.stringify(afterUndo.slice(-2).map((e) => e.id)) === JSON.stringify([CELE.id, UNDO_CELE.id]));
  ok("its held copy is gone, and nothing new is held: the pill says Sent",
     await tid("held-open").count() === 0 && /\bSent\b/.test(await text()), await pill());
  ok("...no held copies on disk", (await heldOnDisk()) === 0, await heldOnDisk());
  ok("the pad's log and the server's log hold the same events, in the same order",
     JSON.stringify(afterUndo.map((e) => e.id)) === JSON.stringify(s5.ids), `${afterUndo.length} v ${s5.ids.length}`);
  ok("...and the board shows the server's figures", (await board()) === boardOf(s5.inn), `${await board()} v ${boardOf(s5.inn)}`);

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
console.log(`\n${"─".repeat(52)}\nBROWSER HELD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

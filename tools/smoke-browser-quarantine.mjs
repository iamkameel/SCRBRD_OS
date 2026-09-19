#!/usr/bin/env node
/**
 * The way out of quarantine, from a browser. SCRBRD-003.
 *
 * tools/smoke-quarantine.mjs proves the two routes and db/14's own function —
 * from Node, straight at the API. Nothing before this proved a PERSON could
 * ever reach that door: `grep -rn quarantine apps/web/src` found only a
 * roadmap sentence, and the panel that finally answers it
 * (apps/web/src/views/quarantine.jsx) is the thing this walk drives.
 *
 * A stale-epoch ball is put into quarantine the same way a real handover
 * does — the exact walk smoke-quarantine.mjs takes — and then the SCREEN is
 * asked three questions a curl command cannot:
 *
 *   1. Does the panel actually appear, only for the person who holds
 *      scoring.amend.approve, with enough about the ball to decide on it
 *      without guessing (what it was, who sent it, when)?
 *   2. When the server refuses the decision — the submitting scorer trying to
 *      release her own ball, which quarantine_resolve() refuses by name — does
 *      the panel say so, or does it silently do nothing and look the same as
 *      success? `quarantine_resolve()` answers `{ ok: false, reason }` on a
 *      200, not a 4xx, so a component that only checked the HTTP status would
 *      show a released ball that was never released.
 *   3. Does releasing really put the ball back in the log at the next seq —
 *      the same assertion smoke-quarantine.mjs makes, asked of the same
 *      /api/matches/:id/events read the scorecard itself uses — and does
 *      discarding remove it from the panel for good, never to reappear?
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-quarantine.mjs
 *   BROWSER_QUARANTINE_DEBUG=1 node tools/smoke-browser-quarantine.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 4329;
const API_PORT = 8798;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
// The same fixture smoke-quarantine.mjs uses: a real squad seeded against it,
// and nothing else writing to it in this run.
const MATCH = "77777777-0000-0000-0000-000000000002";
const P = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002", "aaaaaaaa-0000-0000-0000-000000000003"];
const DEBUG = !!process.env.BROWSER_QUARANTINE_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-quarantine-secret",
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
const dbq = async (text, params) => (await pool.query(text, params)).rows;

// ── The API, direct — for seeding the quarantined ball the way a real
//    handover creates one, before any browser gets involved. ─────────
const fapi = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const devLogin = async (email, deviceId) => (await fapi("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const post = (token, device, epoch, evs, from = 1) => fapi(`/api/matches/${MATCH}/events`, {
  method: "POST", token,
  body: { events: evs.map((payload, i) => ({ epoch, deviceId: device, idempotencyKey: `${device}:${epoch}:${from + i}`,
                                              clientSeq: from + i, clientTs: Date.now(), innings: 0, payload })) },
});
const eventsLog = async (token) => ((await fapi(`/api/matches/${MATCH}/events?since=0`, { token })).body?.events) || [];

// ── The browser ────────────────────────────────────────────────────
const browser = await chromium.launch({ ...launchOptions() });

/** A fresh context per person, exactly as smoke-browser-read.mjs does it. */
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
async function toMatchCentre(page) {
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);
}
const matchCard = (page) => page.locator(`[data-testid="match-card-${MATCH}"]`).first();
async function selectMatch(page) {
  await matchCard(page).click({ timeout: 6000 });
  await page.waitForTimeout(1200);
}
/** Deselect and reselect — the only way this session re-fetches the panel
 *  without a page reload, and a reload would drop the in-memory session
 *  token (deliberately: see lib/api.js). Used to prove a discarded ball does
 *  not come back on a fresh look, not just that it was gone a moment ago. */
async function reselectMatch(page) {
  await matchCard(page).click({ timeout: 6000 });
  await page.waitForTimeout(400);
  await matchCard(page).click({ timeout: 6000 });
  await page.waitForTimeout(1200);
}
const panel = (page) => page.locator('[data-testid="quarantine-panel"]');

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  group("Seeding a quarantined wicket and a quarantined run, the way a real handover creates them");
  const scorerTok = await devLogin("sarah@example.invalid", "browser-quarantine-a");
  const claim = await fapi(`/api/matches/${MATCH}/session/claim`, { method: "POST", token: scorerTok, body: { device: "browser-quarantine-a" } });
  ok("sarah claims the match", claim.body?.ok === true, JSON.stringify(claim.body));
  const epoch = claim.body.epoch;
  const opened = await post(scorerTok, "browser-quarantine-a", epoch, [
    inningsStart({ innings: 0, battingTeam: "HIL", bowlingTeam: "MHS", oversLimit: 20 }),
    batters({ striker: P[0], nonStriker: P[1] }), bowler({ bowler: P[2] }),
  ]);
  ok("the live setup events are accepted", opened.body?.accepted?.length === 3, JSON.stringify(opened.body).slice(0, 200));
  const stale = await post(scorerTok, "browser-quarantine-a", epoch + 5, [
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "Run Out", fielder: "L Govender", striker: P[0], nonStriker: P[1], bowler: P[2] }),
    ball({ type: BALL_TYPE.RUN, value: 1, striker: P[0], nonStriker: P[1], bowler: P[2] }),
  ], 10);
  ok("both stale balls are quarantined, not merged", stale.body?.quarantined?.length === 2 && stale.body.accepted.length === 0, JSON.stringify(stale.body).slice(0, 200));

  const before = (await dbq(`select count(*)::int n, coalesce(max(id),0) as high from ball_event where match_id = $1`, [MATCH]))[0];

  group("The panel is offered to whoever holds scoring.amend.approve, with the ball's own context shown");
  const dos = await open();
  ok("the director of sport signs in", await signIn(dos.page, /sarah@example\.invalid|Director/));
  await toMatchCentre(dos.page);
  await selectMatch(dos.page);
  ok("the quarantine panel appears for her", await panel(dos.page).count() === 1);
  const dosText = await panel(dos.page).innerText();
  if (DEBUG) console.log("[debug] director of sport's panel:\n" + dosText);
  ok("...with both quarantined balls named", /2 waiting/.test(dosText));
  ok("...naming what one of them was", /Wicket.*Run Out/i.test(dosText));
  ok("...and the other", /1 run\b/.test(dosText));
  ok("...who sent them", /Sarah Mokoena/.test(dosText));
  ok("...and the epoch that sent them there, against the one now current",
     new RegExp(`epoch ${epoch + 5}`).test(dosText) && new RegExp(`now ${epoch}`).test(dosText), dosText.slice(0, 300));

  group("The server refuses the decision, and the panel says so honestly");
  // Sarah sent both balls herself. quarantine_resolve() refuses the person who
  // submitted a ball from being the one who releases it — same rule as an
  // amendment — and answers 200 with { ok:false, reason:"cannot_release_your_own" },
  // not a 4xx. A component that trusted the HTTP status alone would show
  // nothing wrong here.
  ok("she tries to release one", await click(dos.page, /^Release$/, 4000));
  await dos.page.waitForTimeout(900);
  const afterOwn = await panel(dos.page).innerText();
  if (DEBUG) console.log("[debug] after her own attempt:\n" + afterOwn);
  ok("the refusal is shown in the panel, not swallowed", /sent this ball yourself/i.test(afterOwn), afterOwn.slice(0, 300));
  ok("...and nothing moved — both are still waiting", /2 waiting/.test(afterOwn));
  ok("no console errors on her session", dos.errors.length === 0, dos.errors.join(" | "));

  group("Somebody else releases the wicket, from the panel");
  const principal = await open();
  ok("the principal signs in", await signIn(principal.page, /principal@example\.invalid|Principal/));
  await toMatchCentre(principal.page);
  await selectMatch(principal.page);
  ok("the panel is offered to her too — she also holds the approval capability", await panel(principal.page).count() === 1);
  const beforeRelease = await panel(principal.page).innerText();
  ok("...showing the same two waiting balls", /2 waiting/.test(beforeRelease));
  ok("she releases the first one", await click(principal.page, /^Release$/, 4000));
  await principal.page.waitForTimeout(1200);
  const afterRelease = await panel(principal.page).innerText();
  if (DEBUG) console.log("[debug] after release:\n" + afterRelease);
  ok("it disappears from the panel — one left waiting", /1 waiting/.test(afterRelease));
  ok("no refusal is shown — this decision was allowed", !/refused|not permitted|permission/i.test(afterRelease));

  group("The released ball is back in the log the scorecard reads, at the next seq");
  // The same read /matches/:id/events the ScorecardModal calls
  // (apps/web/src/views/shared.jsx), and the same assertion
  // smoke-quarantine.mjs makes of the API directly — now proved to be what a
  // released ball looks like after going through the SCREEN.
  const afterLog = await eventsLog(scorerTok);
  const newRows = afterLog.filter((e) => e.seq > before.n);
  if (DEBUG) console.log("[debug] new rows:", JSON.stringify(newRows));
  ok("exactly one new ball reached the log", newRows.length === 1, JSON.stringify(newRows.map((r) => r.seq)));
  ok("...at the next seq", newRows[0]?.seq === before.n + 1);
  ok("...under the current epoch, not the stale one it was sent under", newRows[0]?.epoch === epoch);
  ok("...marked recovered", newRows[0]?.recovered === true);
  ok("...and it is the wicket, dismissal intact", newRows[0]?.dismissal === "run_out");
  const dbRow = await dbq(`select seq, epoch, recovered from ball_event where match_id = $1 and id > $2`, [MATCH, before.high]);
  ok("Postgres agrees — not just the read API's own opinion of itself",
     dbRow.length === 1 && dbRow[0].seq === before.n + 1 && dbRow[0].recovered === true, JSON.stringify(dbRow));

  group("Discarding the second writes nothing, and it does not come back");
  ok("she discards the one left", await click(principal.page, /^Discard$/, 4000));
  await principal.page.waitForTimeout(1200);
  const afterDiscard = await panel(principal.page).innerText();
  ok("the panel is empty", /Nothing waiting for review/.test(afterDiscard), afterDiscard);
  const afterDiscardLog = await eventsLog(scorerTok);
  ok("nothing new reached the log for the discarded ball", afterDiscardLog.length === afterLog.length);

  // A fresh look, not the same page state that already knew it was gone —
  // reselecting the match remounts the panel and re-fetches from the server.
  await reselectMatch(principal.page);
  const reopened = await panel(principal.page).innerText();
  ok("a fresh read of the panel still shows nothing waiting — it did not come back", /Nothing waiting for review/.test(reopened));
  ok("no console errors on the principal's session", principal.errors.length === 0, principal.errors.join(" | "));

  group("Falsified against the table itself");
  const resolved = await dbq(
    `select resolution from ball_event_quarantine where match_id = $1 order by id`, [MATCH]);
  ok("both rows are resolved, one of each kind", resolved.length === 2 &&
     new Set(resolved.map((r) => r.resolution)).size === 2 &&
     resolved.every((r) => ["accepted", "rejected"].includes(r.resolution)),
     JSON.stringify(resolved));

  await dos.ctx.close().catch(() => {});
  await principal.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser quarantine walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER QUARANTINE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

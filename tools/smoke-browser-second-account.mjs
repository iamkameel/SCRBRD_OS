#!/usr/bin/env node
/**
 * A second account, reviewed from a browser. docs/design/TWO_PHONES.md
 * slice 2 (R4–R6, db/136).
 *
 * Two phones scored the same over. The coach's phone held the pen for the
 * setup and the first over; its lease lapsed, and the director of sport
 * force-released it and took the pen herself (epoch 2): the pen's second
 * over runs to 1.5. The coach's phone, still offline, scored the whole second
 * over and sent it under the epoch it last held: the server set all seven
 * events aside (a bowler named, six balls) and merged none. Five say what the
 * pen's say; at 1.3 the pen has 4 and the other phone 6; 1.6 the pen has not.
 *
 * Before slice 2 the reviewer saw seven Release buttons, and releasing a
 * ball the pen also scored appended it: the over counted twice. This walk
 * proves the comparison instead:
 *
 *   1. The director, who holds the pen, scored and holds the approval, may
 *      read the review but not decide it: you_scored_this_match, through the
 *      API (R6).
 *   2. The principal, who kept neither book, opens it: each of the other
 *      phone's balls beside the pen's at its place; 1.3 offers no release.
 *   3. The server refuses a release of 1.3 (pen_has_this_ball) and of the
 *      bowler change (not_a_ball), writing nothing (the red-team's F1, F6).
 *   4. "Pen stands for the 5 that agree" closes them in one tap; 1.3 is
 *      decided "Pen stands" with her reason; the log, the fold and
 *      match_live_score are what they were.
 *   5. 1.6 is released ("Pen missed this ball"): one ball more, at the next
 *      seq, recovered. The record holds one second_account_resolved row per
 *      decision, naming the pen's ball and her reason.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-second-account.mjs
 *   BROWSER_SECOND_ACCOUNT_DEBUG=1 node tools/smoke-browser-second-account.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { inningsStart, batters, bowler, ball, BALL_TYPE, fromRow, deriveInnings } from "@scrbrd/scoring";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(4341);
const API_PORT = port(8811);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
// The seed's Michaelhouse fixture, which the browser quarantine walk also
// uses (each walk has its own reset).
const MATCH = "77777777-0000-0000-0000-000000000002";
const P = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002",
           "aaaaaaaa-0000-0000-0000-000000000003", "aaaaaaaa-0000-0000-0000-000000000004"];
const DEBUG = !!process.env.BROWSER_SECOND_ACCOUNT_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-second-account-secret",
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

const fapi = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const devLogin = async (email, deviceId) => (await fapi("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const post = (token, device, epoch, evs, from) => fapi(`/api/matches/${MATCH}/events`, {
  method: "POST", token,
  body: { events: evs.map((payload, i) => ({ epoch, deviceId: device, idempotencyKey: `${device}:${from + i}`,
                                              clientSeq: from + i, clientTs: Date.now(), innings: 0, payload })) },
});

/** The match as everything that reads it says it: the log, the server's fold of it, SQL's live score. */
async function totals(token) {
  const read = (await fapi(`/api/matches/${MATCH}/events?since=0`, { token })).body;
  const inn = deriveInnings((read?.events ?? []).filter((r) => r.innings === 0).map(fromRow), read?.fold ?? {});
  const live = (await dbq(`select * from match_live_score where match_id = $1`, [MATCH]))[0] ?? null;
  const rows = (await dbq(`select count(*)::int as n, coalesce(max(seq), 0) as head from ball_event where match_id = $1`, [MATCH]))[0];
  return { events: read?.events?.length ?? -1, runs: inn.runs, wickets: inn.wickets, balls: inn.balls,
           live: live ? JSON.stringify(live) : null, rows: rows.n, head: rows.head };
}

const browser = await chromium.launch({ ...launchOptions() });
async function open() {
  const ctx = await browser.newContext();
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
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
  await afterReads(page, 2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}
const panel = (page) => page.locator('[data-testid="quarantine-panel"]');
const row = (page, ball) => panel(page).locator("li[data-status]", { hasText: new RegExp(`^${ball.replace(".", "\\.")}\\b`) }).first();

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  group("Two phones score the second over: the coach's under a pen it no longer holds");
  const coachTok = await devLogin("coach@example.invalid", "sa-phone");
  const c1 = await fapi(`/api/matches/${MATCH}/session/claim`, { method: "POST", token: coachTok, body: { device: "sa-phone" } });
  ok("the coach's phone takes the pen", c1.body?.ok === true, JSON.stringify(c1.body));
  const e1 = c1.body?.epoch;
  const over1 = [1, 0, 2, 0, 1, 4].map((v) => ball({ type: BALL_TYPE.RUN, value: v, striker: P[0], nonStriker: P[1], bowler: P[2] }));
  const first = await post(coachTok, "sa-phone", e1, [
    inningsStart({ innings: 0, battingTeam: "HIL", bowlingTeam: "MHS", oversLimit: 20 }),
    batters({ striker: P[0], nonStriker: P[1] }), bowler({ bowler: P[2] }), ...over1,
  ], 1);
  ok("...and scores the setup and the first over", first.body?.accepted?.length === 9, JSON.stringify(first.body).slice(0, 200));

  // The coach's lease lapses; the director of sport puts the pen down and
  // takes it herself (R6's case: at a small school the director scores).
  await dbq(`update scoring_session set lease_until = now() - interval '5 minutes' where match_id = $1`, [MATCH]);
  const sarahTok = await devLogin("sarah@example.invalid", "sa-pen");
  const fr = await fapi(`/api/matches/${MATCH}/session/force-release`, { method: "POST", token: sarahTok, body: {} });
  ok("the director of sport force-releases the lapsed pen", fr.body?.ok === true, JSON.stringify(fr.body));
  const c2 = await fapi(`/api/matches/${MATCH}/session/claim`, { method: "POST", token: sarahTok, body: { device: "sa-pen" } });
  ok("...and takes it, a new epoch", c2.body?.ok === true && c2.body.epoch > e1, JSON.stringify(c2.body));
  const e2 = c2.body?.epoch;
  // The second over as the other phone has it: 0 1 6 0 2 1. The pen has
  // 0 1 4 0 2 and no sixth ball yet: 1.3 differs, 1.6 the pen does not have.
  const otherOver = [bowler({ bowler: P[3] }),
    ...[0, 1, 6, 0, 2, 1].map((v) => ball({ type: BALL_TYPE.RUN, value: v, striker: P[0], nonStriker: P[1], bowler: P[3] }))];
  const strike = [P[1], P[0]];   // strike as the fold has it, ball by ball, so the Laws take each
  for (const ev of otherOver.slice(1)) {
    ev.striker = strike[0]; ev.nonStriker = strike[1];
    if (ev.value % 2) strike.reverse();
  }
  const penOver = otherOver.slice(0, 6).map((ev, i) => (i === 3 ? { ...ev, value: 4 } : { ...ev }));
  const second = await post(sarahTok, "sa-pen", e2, penOver, 1);
  ok("the pen scores the second over to 1.5", second.body?.accepted?.length === 6, JSON.stringify(second.body).slice(0, 300));
  const held = await post(coachTok, "sa-phone", e1, otherOver, 100);
  ok("the other phone's second over is set aside, all seven, none merged",
     held.body?.quarantined?.length === 7 && held.body.accepted.length === 0
     && held.body.quarantined.every((q) => q.reason === "stale_epoch_or_lease"), JSON.stringify(held.body).slice(0, 300));
  const heldIds = await dbq(`select id, idempotency_key as k from ball_event_quarantine where match_id = $1 order by id`, [MATCH]);
  const idOf = (/** @type {number} */ n) => heldIds.find((h) => h.k === `sa-phone:${n}`)?.id;
  const before = await totals(sarahTok);
  if (DEBUG) console.log("[debug] before:", before);
  ok("the match reads the pen's book: 15 off 1.5", before.runs === 15 && before.balls === 11, JSON.stringify(before));

  group("The pen-holder, a director who scored and holds the approval, may not decide it");
  const sa = await fapi(`/api/matches/${MATCH}/second-account`, { token: sarahTok });
  ok("she may read the review, and it says she is a party", sa.status === 200 && sa.body?.viewer?.scoredThisMatch === true && sa.body?.open === 7,
     JSON.stringify(sa.body?.viewer));
  const saStands = await fapi(`/api/matches/${MATCH}/second-account/pen-stands`, { method: "POST", token: sarahTok,
    body: { ids: [idOf(101)], note: "Both accounts agree" } });
  ok("...pen stands is refused her by name: you_scored_this_match",
     saStands.body?.ok === false && saStands.body?.reason === "you_scored_this_match", JSON.stringify(saStands.body));
  const saRelease = await fapi(`/api/quarantine/${idOf(106)}/resolve`, { method: "POST", token: sarahTok, body: { accept: true } });
  ok("...and so is a release", saRelease.body?.ok === false && saRelease.body?.reason === "you_scored_this_match", JSON.stringify(saRelease.body));
  ok("...nothing decided, nothing written", JSON.stringify(await totals(sarahTok)) === JSON.stringify(before)
     && (await dbq(`select count(*)::int as n from ball_event_quarantine where match_id = $1 and resolved_at is null`, [MATCH]))[0].n === 7);

  group("The principal, who kept neither book, opens the review");
  const prTok = await devLogin("principal@example.invalid", "sa-principal");
  const pr = await open();
  ok("the principal signs in", await signIn(pr.page, /principal@example\.invalid|Principal/));
  await pr.page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await pr.page.waitForTimeout(1200);
  await pr.page.locator(`[data-testid="match-card-${MATCH}"]`).first().click({ timeout: 6000 });
  await afterReads(pr.page, 1500);
  ok("the review appears", await panel(pr.page).count() === 1);
  const seen = await panel(pr.page).innerText();
  if (DEBUG) console.log("[debug] the review:\n" + seen);
  ok("...seven waiting", /7 waiting/.test(seen), seen.slice(0, 300));
  ok("...the other phone's account is set beside the pen's book, which is the record",
     /The pen's book is the match's record/.test(seen) && /Sent by C Hendricks from another phone/.test(seen), seen.slice(0, 500));
  ok("...the two books' totals side by side", /the pen's book 15\/0 \(1\.5\) · the other phone's 18\/0 \(2\.0\)/.test(seen), seen);
  ok("...and that a released ball is written at the innings' end",
     /written at the end of the log, at the innings' end/.test(seen));
  const differs = row(pr.page, "1.3");
  const dt = await differs.innerText().catch(() => "");
  ok("1.3 differs, in words and not by colour alone", (await differs.getAttribute("data-status")) === "differs"
     && /≠\s*Differs: runs or extras/.test(dt), dt);
  ok("...the pen's 4 beside the other phone's 6", /Pen\s*4 runs/.test(dt) && /Other phone\s*6 runs/.test(dt));
  ok("...offering Pen stands and The other phone was right, and never a release of a ball the pen has",
     /Pen stands/.test(dt) && /The other phone was right/.test(dt) && !/Pen missed this ball/.test(dt), dt);
  const missing = row(pr.page, "1.6");
  const mt = await missing.innerText().catch(() => "");
  ok("1.6: the pen has no ball here, and may have missed it", (await missing.getAttribute("data-status")) === "missing"
     && /Pen has no ball here/.test(mt) && /Pen missed this ball/.test(mt), mt);
  ok("the other five agree", await panel(pr.page).locator('li[data-status="agrees"]').count() === 5);
  ok("no accounts drift here", !/stop lining up/.test(seen));
  const tall = await panel(pr.page).locator("button").evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
  ok("every control is at least 44px to tap", tall.length > 0 && tall.every((h) => h >= 44), JSON.stringify(tall));
  const tiny = await panel(pr.page).evaluate((el) => [...el.querySelectorAll("*")]
    .filter((n) => n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()))
    .map((n) => parseFloat(getComputedStyle(n).fontSize)).filter((s) => s < 12));
  ok("nothing in it is under 12px", tiny.length === 0, JSON.stringify(tiny));

  group("The server, not the screen, refuses to release a ball the pen has");
  const r13 = await fapi(`/api/quarantine/${idOf(103)}/resolve`, { method: "POST", token: prTok, body: { accept: true } });
  ok("releasing the other phone's 1.3 is refused: the pen has a ball here",
     r13.body?.ok === false && r13.body?.reason === "pen_has_this_ball" && /The pen has a ball here/.test(r13.body?.text ?? ""), JSON.stringify(r13.body));
  const rBowler = await fapi(`/api/quarantine/${idOf(100)}/resolve`, { method: "POST", token: prTok, body: { accept: true } });
  ok("...and a change of bowler is never released", rBowler.body?.ok === false && rBowler.body?.reason === "not_a_ball", JSON.stringify(rBowler.body));
  ok("...nothing written, nothing decided", JSON.stringify(await totals(sarahTok)) === JSON.stringify(before)
     && (await dbq(`select count(*)::int as n from ball_event_quarantine where match_id = $1 and resolved_at is null`, [MATCH]))[0].n === 7);

  group("One tap closes the five that agree");
  ok("she presses \"Pen stands for the 5 that agree\"", await click(pr.page, /^Pen stands for the 5 that agree$/, 4000));
  await afterReads(pr.page, 1500);
  const afterBulk = await panel(pr.page).innerText();
  if (DEBUG) console.log("[debug] after the one tap:\n" + afterBulk);
  ok("two left waiting: the one that differs and the one the pen has not", /2 waiting/.test(afterBulk) && /≠\s*Differs/.test(afterBulk), afterBulk.slice(0, 400));
  ok("no refusal is shown", !/refused|not permitted|party to/i.test(afterBulk));

  group("The one that differs: the pen stands, with her reason");
  await row(pr.page, "1.3").locator('input[data-testid$="-note"]').fill("The paper book says 4");
  ok("she presses Pen stands on 1.3", await (async () => {
    const b = row(pr.page, "1.3").locator('button:not([disabled])', { hasText: /^Pen stands$/ }).first();
    if (!(await b.count())) return false;
    await b.click({ timeout: 4000 }); return true;
  })());
  await afterReads(pr.page, 1500);
  ok("one left waiting", /1 waiting/.test(await panel(pr.page).innerText()));
  const mid = await totals(sarahTok);
  ok("the log, the fold and match_live_score are what they were", JSON.stringify(mid) === JSON.stringify(before),
     `${JSON.stringify(before)} → ${JSON.stringify(mid)}`);

  group("1.6, which the pen never had: released, at the innings' end");
  await row(pr.page, "1.6").locator('input[data-testid$="-note"]').fill("The paper book has a single at 1.6");
  ok("she presses Pen missed this ball on 1.6", await (async () => {
    const b = row(pr.page, "1.6").locator('button:not([disabled])', { hasText: /^Pen missed this ball$/ }).first();
    if (!(await b.count())) return false;
    await b.click({ timeout: 4000 }); return true;
  })());
  await afterReads(pr.page, 1500);
  const afterAll = await panel(pr.page).innerText();
  ok("nothing waits for review", /Nothing waiting for review/.test(afterAll), afterAll.slice(0, 300));
  ok("no console errors on her session", pr.errors.length === 0, pr.errors.join(" | "));
  const after = await totals(sarahTok);
  if (DEBUG) console.log("[debug] after:", after);
  ok("the log grew by that one ball and no other: 16 off 2.0", after.runs === before.runs + 1 && after.balls === before.balls + 1
     && after.rows === before.rows + 1 && after.head === before.head + 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  const rec = await dbq(`select seq, recovered, device_id from ball_event where match_id = $1 order by seq desc limit 1`, [MATCH]);
  ok("...written at the next seq, recovered, from the other phone", rec[0]?.seq === before.head + 1 && rec[0]?.recovered === true
     && rec[0]?.device_id === "sa-phone", JSON.stringify(rec));

  group("The record says who decided what and why");
  const q = await dbq(`select resolution, count(*)::int as n from ball_event_quarantine where match_id = $1 group by 1 order by 1`, [MATCH]);
  ok("one released, six set aside", JSON.stringify(q) === JSON.stringify([{ resolution: "accepted", n: 1 }, { resolution: "rejected", n: 6 }]), JSON.stringify(q));
  const audit = await dbq(
    `select s.detail, u.email from scoring_audit s join app_user u on u.id = s.actor_id
      where s.match_id = $1 and s.event = 'second_account_resolved' order by s.id`, [MATCH]);
  ok("one second_account_resolved row per decision, the principal's", audit.length === 7
     && audit.every((a) => a.email === "principal@example.invalid"), JSON.stringify(audit.map((a) => a.email)));
  const rejected = audit.filter((a) => a.detail.resolution === "rejected");
  ok("...each set aside names the pen's ball it was compared with", rejected.length === 6
     && rejected.every((a) => typeof a.detail.counterpart_key === "string" && a.detail.counterpart_key.startsWith("sa-pen:")));
  const d13 = audit.find((a) => a.detail.ball === "1.3");
  ok("...1.3's carries her reason, and the pen's ball", d13?.detail.note === "The paper book says 4" && d13?.detail.counterpart_key === "sa-pen:4",
     JSON.stringify(d13?.detail));
  ok("...the five that agree say so", audit.filter((a) => a.detail.note === "Both accounts agree").length === 5);
  const rel = audit.find((a) => a.detail.resolution === "accepted");
  ok("...the release: no counterpart, its place and seq in the log, her reason", rel?.detail.counterpart_key === null
     && rel?.detail.ball === "1.6" && rel?.detail.seq === before.head + 1 && rel?.detail.note === "The paper book has a single at 1.6",
     JSON.stringify(rel?.detail));

  await pr.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser second-account walk threw: ${e.message?.slice(0, 200)}`, false);
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
console.log(`\n${"─".repeat(52)}\nBROWSER SECOND ACCOUNT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

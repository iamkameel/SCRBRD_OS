#!/usr/bin/env node
/**
 * Corrections everywhere, A0 and A1 (GA-I36), from browsers, on a finished
 * fixture that is published.
 *
 *   1. The scorer asks for a correction from the Match Centre's full-time
 *      prompt, in the request sheet's words ("this does not change the score
 *      until it is approved"), and sees it waiting on the fixture.
 *   2. The fixture is open in two browsers that only watch: the coach's Match
 *      Centre and a signed-out visitor's public page. Neither knows anything
 *      is pending (D12: the coach is no reader of the request).
 *   3. In a third, the director of sport finds it on her To-resolve screen
 *      (Readiness, row O7), opens the fixture's Corrections sheet from it,
 *      reads the ball, the reason, the requester, "removes this ball; nothing
 *      replaces it" and the effect, and approves.
 *   4. Within a poll both watchers say "Updated · refresh" — a live region,
 *      44px — and their figures do NOT move until they tap; on the tap the
 *      total falls by the four, "Corrected HH:MM" appears beside it and on
 *      the innings line, and the commentary has its one quiet line.
 *   5. The public page's chip and line say when, team-level: no reason, no
 *      requester or approver, no boy's name; nor does anything it received.
 *   6. No Approve button on the approver's own request; a declined request
 *      shows its note to the scorer.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-corrections.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { buildPublicFixture, HIL } from "./fixture-public.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8849);
const BASE = `http://127.0.0.1:${PORT}`;
const REASON = "Four given to the batter off the pad; the book has four leg byes.";
const NOTE = "The umpire signalled runs; the pad is right.";
const DEBUG = !!process.env.BROWSER_CORR_DEBUG;

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", SESSION_SECRET: "browser-corrections-secret",
         ALLOW_DEV_LOGIN: "1", PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-corrections-pseudonyms-0123456789abcdef",
         PUBLIC_TRUST_PROXY_HOPS: "1", SERVE_CLIENT: "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));
api.stdout.on("data", (d) => { if (DEBUG) process.stdout.write(d); });

const owner = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const q = async (t, p = []) => (await owner.query(t, p)).rows;
async function as(user, text, params = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.device_id', 'browser-corrections', true)", [user]);
    const r = (await c.query(text, params)).rows;
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
const userId = async (email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;

const browser = await chromium.launch({ ...launchOptions() });
let ipN = 0;
/** A browser of its own: signed out, from an address of its own, polling every second. */
async function open(path = "/app", { width = 1280 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.85.0.${++ipN}` } });
  await offline(ctx);
  const page = await ctx.newPage();
  await page.addInitScript(`window.__SCRBRD_LIVE_MS__ = 1000; window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)};`);
  const errors = [];
  const bodies = [];
  page.on("response", (r) => { if (new URL(r.url()).pathname.startsWith("/api/public/")) bodies.push(r.text().catch(() => "")); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return { ctx, page, errors, bodies };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const text = (page) => page.$eval("body", (el) => el.innerText);
const until = async (page, fn, ms = 8000, arg = undefined) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; }
};
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
// The app is at /app (/ is the public home page) and opens on its login screen.
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  if (!(await click(page, new RegExp(email.replace(/[.]/g, "\\.")), 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return (await page.locator("nav button").count()) > 0;
}
async function go(page, key) {
  const l = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"]`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1600);
  return true;
}
async function openMatch(page, id) {
  if (!(await go(page, "matches"))) { if (DEBUG) console.log("    (no nav to matches)", (await text(page)).slice(0, 300)); return false; }
  const btn = tid(page, `mc-open-${id}`);
  if (!(await btn.count())) {
    if (DEBUG) console.log("    (no mc-open for", id, "; on screen:", await page.locator('[data-testid^="mc-open-"]').evaluateAll((els) => els.map((e) => e.dataset.testid).join(" ")), ")");
    return false;
  }
  await btn.click({ timeout: 5000 });
  const opened = await until(page, () => !!document.querySelector('[data-testid="match-view"]'), 8000);
  if (!opened && DEBUG) console.log("    (match-view did not open)", (await text(page)).slice(0, 600));
  await page.waitForTimeout(800);
  return opened;
}
/** The 12px floor and the 44px target, measured. */
const measure = (page, id) => tid(page, id).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const fs = parseFloat(getComputedStyle(el).fontSize);
  return { h: r.height, fs };
});

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const fx = await buildPublicFixture(q);
  const { pub2, ids } = fx;
  const SARAH = await userId("sarah@example.invalid");
  // Daniel Erasmus consented, so the public page names him: the correction line must still not.
  await as(fx.guardians.erasmus, `select * from public_name_consent_set($1, true, 'public-names-2026-09')`, [ids.erasmus]);
  await as(SARAH, `select * from fixture_publish($1, 'home', true)`, [pub2]);
  const [{ name: REQUESTER }] = await q(`select name from app_user where email = 'scorer@example.invalid'`);
  const [{ name: APPROVER }] = await q(`select name from app_user where email = 'sarah@example.invalid'`);
  const four = (await q(`select idempotency_key from ball_event where match_id = $1 and kind = 'ball' and value = 4`, [pub2]))[0].idempotency_key;
  const one = (await q(`select idempotency_key from ball_event where match_id = $1 and kind = 'ball' and value = 1`, [pub2]))[0].idempotency_key;

  group("1. The scorer asks, in the request sheet's words");
  const sc = await open();
  ok("the scorer signs in", await signIn(sc.page, "scorer@example.invalid"));
  ok("the finished fixture opens", await openMatch(sc.page, pub2));
  await tid(sc.page, "mc-confirm-open").click({ timeout: 4000 });
  await sc.page.waitForTimeout(300);
  const optIndex = await tid(sc.page, "mc-confirm-delivery").locator("option").evaluateAll((os, key) => os.findIndex((o) => o.value === key), four);
  ok("the four is a delivery he can name", optIndex > 0, optIndex);
  await tid(sc.page, "mc-confirm-delivery").selectOption({ index: optIndex });
  await tid(sc.page, "mc-confirm-reason").fill(REASON);
  await tid(sc.page, "mc-confirm-submit").click();
  ok("filed: 'with the director of sport … does not change the score until it is approved'",
    await until(sc.page, () => /with the director of sport · asked \d\d:\d\d · this does not change the score until it is approved/.test(document.querySelector('[data-testid="mc-confirm-said"]')?.textContent ?? ""), 6000),
    await tid(sc.page, "mc-confirm-said").innerText().catch(() => "∅"));
  ok("...and the fixture now says it is waiting", await until(sc.page, () => /1 correction awaiting approval/.test(document.querySelector('[data-testid="mc-corrections-open"]')?.textContent ?? ""), 6000));
  await tid(sc.page, "mc-corrections-open").click();
  await sc.page.waitForTimeout(500);
  const scSheet = await tid(sc.page, "corrections-sheet").innerText().catch(() => "");
  ok("his sheet: his request, with him, not his to approve", /Your request is with the director of sport/.test(scSheet) && await sc.page.locator('[data-testid^="corr-approve-"]').count() === 0, scSheet.slice(0, 400));
  await sc.page.keyboard.press("Escape");
  ok("no console errors (scorer)", sc.errors.length === 0, sc.errors.join(" | "));

  group("2. Two browsers watch the finished fixture");
  const co = await open();
  ok("the coach signs in", await signIn(co.page, "coach@example.invalid"));
  ok("...and opens the fixture", await openMatch(co.page, pub2));
  ok("a pending request is nothing to him (D12, and he is no reader of it)", await tid(co.page, "mc-corrections-open").count() === 0
    && !(await text(co.page)).includes(REASON));
  ok("no chip yet: nothing has been corrected", await tid(co.page, "mc-corrected").count() === 0);
  const coBefore = await tid(co.page, "mc-scores").innerText();
  const pu = await open(`/live/${pub2}`);
  await pu.page.waitForSelector('[data-testid="public-match"]', { timeout: 8000 }).catch(() => {});
  const puBefore = await tid(pu.page, "mc-scores").innerText().catch(() => "");
  ok("the public page draws the finished match", /\d+\/\d+/.test(puBefore), puBefore);
  ok("...with no chip and nothing about a request", await tid(pu.page, "mc-corrected").count() === 0 && !/awaiting|pending|review/i.test(await text(pu.page)));
  const runsOf = (s) => Number((/(\d+)\/\d+/.exec(s) ?? [])[1]);

  group("3. The director finds it on To resolve, and approves it from the sheet");
  const ds = await open();
  ok("the director of sport signs in", await signIn(ds.page, "sarah@example.invalid"));
  // Her own request, planted past the policy (she cannot file one): her sheet must draw no Approve on it.
  const [{ id: OWN }] = await q(`insert into scoring_amendment (match_id, school_id, target_key, reason, requested_by)
    values ($1, $2, $3, 'Planted: her own.', $4) returning id`, [pub2, HIL, one, SARAH]);
  ok("she reaches Readiness", await go(ds.page, "readiness"));
  await ds.page.waitForSelector(`[data-testid="o7-open-${pub2}"]`, { timeout: 8000 }).catch(() => {});
  const o7 = await tid(ds.page, `o7-open-${pub2}`).innerText().catch(() => "");
  ok("O7: the fixture, '2 corrections awaiting approval · asked … ago'", /2 corrections awaiting approval · asked (just now|\d+ minutes? ago)/.test(o7), o7);
  ok("...a count, no reason and no name", !o7.includes(REASON) && !o7.includes(REQUESTER) && !/Erasmus/.test(o7));
  const o7m = await measure(ds.page, `o7-open-${pub2}`);
  ok("...one 44px row", o7m.h >= 44, JSON.stringify(o7m));
  await tid(ds.page, `o7-open-${pub2}`).click();
  ok("the row opens the fixture on its Corrections sheet", await until(ds.page, () => !!document.querySelector('[data-testid="corrections-sheet"]'), 8000));
  const asked = (await q(`select id from scoring_amendment where match_id = $1 and requested_by <> $2 and state = 'pending'`, [pub2, SARAH]))[0].id;
  await ds.page.waitForSelector(`[data-testid="corr-amend-${asked}"]`, { timeout: 6000 }).catch(() => {});
  const row = await tid(ds.page, `corr-amend-${asked}`).innerText().catch(() => "");
  ok("the ball as recorded, in the commentary's words", /^0\.1 · .*four/i.test(row), row.slice(0, 200));
  ok("the requester, by role and by name (she may decide it)", row.includes(`Asked by the scorer (${REQUESTER})`), row.slice(0, 300));
  ok("the reason", row.includes(REASON));
  ok("'Approving removes this ball; nothing replaces it.'", row.includes("Approving removes this ball; nothing replaces it."));
  const eff = await tid(ds.page, `corr-effect-${asked}`).innerText().catch(() => "");
  ok("the effect, folded: the innings before → after, and the result", /\d+\/\d+ \(.+\) → \d+\/\d+/.test(eff) && /Result (unchanged|changes)/.test(eff), eff);
  ok("no Approve on her own request", await tid(ds.page, `corr-approve-${OWN}`).count() === 0 && await tid(ds.page, `corr-mine-${OWN}`).count() === 1);
  const ap = await measure(ds.page, `corr-approve-${asked}`);
  ok("Approve is a 44px target on the 12px floor", ap.h >= 44 && ap.fs >= 12, JSON.stringify(ap));
  await tid(ds.page, `corr-approve-${asked}`).click();
  ok("approved, with the server's result words before and after",
    await until(ds.page, (k) => /Approved: the ball is removed\. Result as the server reads it: .+ → .+\./.test(document.querySelector(`[data-testid="corr-said-${k}"]`)?.textContent ?? ""), 8000, asked),
    await tid(ds.page, `corr-said-${asked}`).innerText().catch(() => "∅"));
  // Plant a second scorer request and decline it with a note, for the scorer to read.
  const [{ id: DECL }] = await as(await userId("scorer@example.invalid"), `insert into scoring_amendment (match_id, school_id, target_key, reason, requested_by)
    select $1, school_id, $2, 'Was it a one?', app_user_id() from match where id = $1 returning id`, [pub2, (await q(
    `select idempotency_key from ball_event where match_id = $1 and kind = 'ball' and ball_type = 'W'`, [pub2]))[0].idempotency_key]);
  await ds.page.keyboard.press("Escape");
  await ds.page.waitForTimeout(400);
  await tid(ds.page, "mc-corrections-open").click({ timeout: 6000 }).catch(() => {});
  await ds.page.waitForSelector(`[data-testid="corr-decline-${DECL}"]`, { timeout: 6000 }).catch(() => {});
  await tid(ds.page, `corr-note-${DECL}`).fill(NOTE);
  await tid(ds.page, `corr-decline-${DECL}`).click();
  ok("she declines the other with a note", await until(ds.page, (k) => /Declined\. Nothing in the scorecard changed\./.test(document.querySelector(`[data-testid="corr-said-${k}"]`)?.textContent ?? ""), 6000, DECL));
  ok("no console errors (director)", ds.errors.length === 0, ds.errors.join(" | "));

  group("4. Both watchers: 'Updated · refresh' within a poll, the figures still until the tap");
  for (const [who, b, before] of [["coach", co, coBefore], ["public page", pu, puBefore]]) {
    ok(`${who}: "Updated · refresh"`, await until(b.page, () => /Updated · refresh/.test(document.querySelector('[data-testid="mc-stale"]')?.textContent ?? ""), 6000));
    ok(`${who}: ...said in a live region`, await tid(b.page, "mc-stale-region").getAttribute("role") === "status");
    const m = await measure(b.page, "mc-stale");
    ok(`${who}: ...a 44px target on the 12px floor`, m.h >= 44 && m.fs >= 12, JSON.stringify(m));
    await b.page.waitForTimeout(2500);
    ok(`${who}: the figures have not moved under the reader`, (await tid(b.page, "mc-scores").innerText()) === before);
    await tid(b.page, "mc-stale").click();
    ok(`${who}: on the tap the total falls by the four`, await until(b.page, (r) => {
      const t = document.querySelector('[data-testid="mc-scores"]')?.textContent ?? "";
      return Number((/(\d+)\/\d+/.exec(t) ?? [])[1]) === r - 4;
    }, 6000, runsOf(before)), await tid(b.page, "mc-scores").innerText());
    ok(`${who}: the stale line is gone`, await until(b.page, () => !document.querySelector('[data-testid="mc-stale"]'), 4000));
    const chip = await tid(b.page, "mc-corrected").innerText().catch(() => "");
    ok(`${who}: "Corrected HH:MM"`, /^Corrected \d\d:\d\d$/.test(chip.trim()), chip);
    const cm = await measure(b.page, "mc-corrected");
    ok(`${who}: ...a 44px chip on the 12px floor`, cm.h >= 44 && cm.fs >= 12, JSON.stringify(cm));
    ok(`${who}: the innings line says it too`, /corrected \d\d:\d\d/.test(await tid(b.page, "mc-score-corrected").first().innerText().catch(() => "")));
  }

  group("5. What each says of it");
  await tid(co.page, "mc-corrected").click();
  const coLines = await tid(co.page, "mc-corrected-lines").innerText().catch(() => "");
  ok("the coach: when, by role, and the ball in the fold's words", /^\d\d:\d\d · asked by the scorer and approved · removed: 0\.1 · /.test(coLines.trim()), coLines);
  ok("...and no reason (the policy does not show him one)", !coLines.includes(REASON) && !(await text(co.page)).includes(REASON));
  await tid(pu.page, "mc-corrected").click();
  const puLines = await tid(pu.page, "mc-corrected-lines").innerText().catch(() => "");
  ok("the public chip's line: 'The scorecard was corrected after the match.'", puLines.trim() === "The scorecard was corrected after the match.", puLines);
  await tid(pu.page, "mc-tab-commentary").click();
  await pu.page.waitForTimeout(500);
  const commentary = await tid(pu.page, "mc-panel-commentary").innerText();
  ok("the public commentary has the one quiet line", (commentary.match(/The scorecard was corrected after the match\./g) ?? []).length === 1, commentary.slice(0, 400));
  ok("...and no card for it", await tid(pu.page, "mc-moment").count() === 0);
  const page = await text(pu.page);
  ok("the public page names the consented boy elsewhere (the check is a real one)", /D Erasmus/.test(page));
  ok("...but the correction line names nobody", !/Erasmus|Botha|Batter|Bowler/.test(puLines));
  ok("the rendered public page has no reason, no note, no requester, no approver",
    !page.includes(REASON) && !page.includes(NOTE) && !page.includes(REQUESTER) && !page.includes(APPROVER) && !/Daniel/.test(page));
  const got = (await Promise.all(pu.bodies)).join("\n");
  ok("...nor did anything the page received", got.length > 0 && !got.includes(REASON) && !got.includes(NOTE) && !got.includes(REQUESTER)
    && !got.includes(APPROVER) && !/approved_by|"amendment":(?!true)|requested/.test(got));
  ok("no console errors (coach, public)", co.errors.length === 0 && pu.errors.length === 0, [...co.errors, ...pu.errors].join(" | "));

  group("6. The scorer reads the decline and its note");
  await tid(sc.page, "mc-back").click({ timeout: 4000 });
  await sc.page.waitForTimeout(800);
  await tid(sc.page, `mc-open-${pub2}`).click({ timeout: 5000 });
  ok("the scorer reopens the fixture", await until(sc.page, () => !!document.querySelector('[data-testid="match-view"]'), 6000));
  await until(sc.page, () => !!document.querySelector('[data-testid="mc-corrections-open"]'), 6000);
  const scRow = await tid(sc.page, "mc-corrections-open").innerText().catch(() => "");
  ok("his line: one of his requests was declined", /1 of your requests was declined/.test(scRow), scRow);
  await tid(sc.page, "mc-corrections-open").click();
  await sc.page.waitForTimeout(500);
  const decl = await tid(sc.page, `corr-decided-${DECL}`).innerText().catch(() => "");
  ok("'Declined HH:MM: <note>'", new RegExp(`^Declined \\d\\d:\\d\\d: ${NOTE.replace(/[.;]/g, "\\$&")}`).test(decl.trim()), decl);
  ok("no console errors (scorer, again)", sc.errors.length === 0, sc.errors.join(" | "));
  for (const b of [sc, co, pu, ds]) await b.ctx.close();
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", e.stack || e.message);
} finally {
  await browser.close().catch(() => {});
  api.kill("SIGTERM");
  await owner.end().catch(() => {});
  await app.end().catch(() => {});
}
if (fail && apiErr.length) console.log("\nAPI stderr:\n" + apiErr.join("").split("\n").slice(0, 12).join("\n"));
console.log(`\n${"─".repeat(52)}\nCORRECTIONS BROWSER SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

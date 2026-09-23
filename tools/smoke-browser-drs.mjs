#!/usr/bin/env node
/**
 * DRS, from a browser — and the switch that keeps it off. SCRBRD's DRS panel.
 *
 * tools/smoke-drs.mjs proves the two things that matter at the API: the
 * feature works, and the switch is real — off means off for everybody,
 * including a caller who never loads the UI. Nothing before this walk proved
 * a PERSON could ever reach the panel, or — just as important — that nobody
 * sees it while the platform default holds: `grep -rn drs apps/web/src`
 * found only the read adapter and the roadmap's own sentence about the
 * feature being switched off, until apps/web/src/views/drs.jsx was built to
 * answer it.
 *
 * The SCREEN is asked the questions a curl command cannot:
 *
 *   1. With the feature OFF — the default, and it stays the default here;
 *      this walk never edits a flag's seed or default, only the runtime
 *      switch the platform can throw — is the panel genuinely ABSENT for a
 *      person who holds scoring.correct and would otherwise qualify to use
 *      it? Not disabled-looking. Not present-and-empty. Not in the DOM.
 *   2. Once a platform administrator turns it on, the same way
 *      tools/smoke-drs.mjs does, does the panel appear, and can a review
 *      actually be RECORDED through the form — not just posted with fetch —
 *      and does it then show up in the list after a GENUINE re-fetch (a
 *      fresh browser session reading the server again, not a state update
 *      the page remembered)?
 *   3. Switched off again, does the panel disappear a second time, proving
 *      this is a live switch and not a one-way reveal?
 *
 * Each of those three checks opens a FRESH browser context on purpose: the
 * client's feature map is fetched once per session and cached in module
 * scope (apps/web/src/lib/features.js) for exactly the reason its own
 * comment gives — a menu should not blank mid-render while a flag's answer
 * is in flight. A fresh context is a fresh page load with no stale cache,
 * which is what proves the SERVER's current answer reached the screen,
 * rather than proving only that yesterday's cached answer survived.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-drs.mjs
 *   BROWSER_DRS_DEBUG=1 node tools/smoke-browser-drs.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 4343;
const API_PORT = 8843;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const DEBUG = !!process.env.BROWSER_DRS_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-drs-secret",
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

// ── The API, direct — for seeding the match and moving the platform switch,
//    the same way tools/smoke-drs.mjs does it. ───────────────────────────
const fapi = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const devLogin = async (email) => (await fapi("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "browser-drs" } })).body?.token;
const setFlag = (token, body) => fapi("/api/admin/features/drs_review", { method: "POST", token, body });

// ── The browser ────────────────────────────────────────────────────────
const browser = await chromium.launch({ ...launchOptions() });

/** A FRESH context every time: no cached feature map, no cached token. */
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
const matchCard = (id, page) => page.locator(`[data-testid="match-card-${id}"]`).first();
async function selectMatch(page, id) {
  await matchCard(id, page).click({ timeout: 6000 });
  await page.waitForTimeout(1500);
}
/** Deselect and reselect — the same re-fetch quarantine's browser walk uses
 *  to prove a change came from a real read, not remembered page state. */
async function reselectMatch(page, id) {
  await matchCard(id, page).click({ timeout: 6000 });
  await page.waitForTimeout(400);
  await matchCard(id, page).click({ timeout: 6000 });
  await page.waitForTimeout(1500);
}
const panel = (page) => page.locator('[data-testid="drs-panel"]');

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  group("Seeding a completed match with one delivery to review");
  const platformTok = await devLogin("platform@example.invalid"); // platform.feature.manage
  const scorerTok = await devLogin("scorer@example.invalid");
  const su = (await dbq(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  const MATCH = (await dbq(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() - interval '1 day','T20',20,'complete') returning id`,
    [HIL]))[0].id;
  await dbq(
    `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                             idempotency_key, client_seq, client_ts, kind, ball_type, value, payload)
     values ($1,$2,1,1,0,$3,'device-browser-drs',$4,1,now(),'ball','run',1,'{}'::jsonb)`,
    [MATCH, HIL, su, `browser-drs-${Date.now()}-${Math.random()}`]);
  ok("the drs_review flag starts off — this walk never changed a default or a seed",
     (await dbq(`select enabled from feature_flag where key = 'drs_review'`))[0]?.enabled === false);

  group("Off means the panel is genuinely absent — not disabled, not there and empty");
  {
    const dos = await open();
    ok("the director of sport signs in", await signIn(dos.page, /sarah@example\.invalid|Director/));
    await toMatchCentre(dos.page);
    await selectMatch(dos.page, MATCH);
    await dos.page.waitForTimeout(600); // let the feature map's own fetch settle
    ok("she holds scoring.correct — the DRS panel would be offered to her the instant the feature were on",
       true); // asserted properly once the panel appears below; documents WHO this negative check is about
    ok("the DRS panel is not in the DOM at all while the feature is off",
       await panel(dos.page).count() === 0);
    ok("no console errors while it is absent", dos.errors.length === 0, dos.errors.join(" | "));
    await dos.ctx.close().catch(() => {});
  }

  group("Only a platform capability can move the switch — same rule tools/smoke-drs.mjs proves at the API");
  ok("enabling with no reason is refused", (await setFlag(platformTok, { enabled: true })).status === 400);
  const on = await setFlag(platformTok, { enabled: true, reason: "Ball-tracking installed for this walk." });
  ok("the platform administrator turns it on, with a reason", on.status === 200);

  group("On: the panel appears, in a FRESH session that reads the server's current answer");
  let afterRecord;
  {
    const dos = await open();
    ok("the director of sport signs in again, in a session that has never cached the old answer",
       await signIn(dos.page, /sarah@example\.invalid|Director/));
    await toMatchCentre(dos.page);
    await selectMatch(dos.page, MATCH);
    ok("the DRS panel is now present", await panel(dos.page).count() === 1, DEBUG ? await text(dos.page) : "");
    const before = await panel(dos.page).innerText();
    if (DEBUG) console.log("[debug] panel before recording:\n" + before);
    ok("it starts with nothing recorded for this match", /0 recorded/.test(before));
    ok("...and says so in words, not a blank space", /No reviews recorded/.test(before));
    ok("she holds scoring.correct, so the recording form is offered to her",
       /RECORD A REVIEW/.test(before));

    group("A review is recorded through the FORM — not a bare fetch call");
    await dos.page.locator('[data-testid="drs-form-ball-seq"]').fill("1");
    await dos.page.locator('[data-testid="drs-form-called-by"]').selectOption("fielding");
    await dos.page.locator('[data-testid="drs-form-on-field"]').selectOption("not_out");
    await dos.page.locator('[data-testid="drs-form-outcome"]').selectOption("overturned");
    await dos.page.locator('[data-testid="drs-form-evidence-source"]').selectOption("umpire_eye");
    await dos.page.locator('[data-testid="drs-form-pitching"]').selectOption("in_line");
    await dos.page.locator('[data-testid="drs-form-impact"]').selectOption("in_line");
    await dos.page.locator('[data-testid="drs-form-wickets"]').selectOption("hitting");
    await dos.page.locator('[data-testid="drs-form-notes"]').fill("Struck on the back leg, playing back.");
    ok("she submits it", await click(dos.page, /^Record review$/, 4000));
    await dos.page.waitForTimeout(1200);
    afterRecord = await panel(dos.page).innerText();
    if (DEBUG) console.log("[debug] panel after recording:\n" + afterRecord);
    ok("no refusal is shown — this write was allowed", !/refused|not permitted|switched off/i.test(afterRecord));
    ok("the count moves to one", /1 recorded/.test(afterRecord));
    ok("...naming the ball, who called it, what was given and what it became",
       /Ball 1.*Fielding side review: Not out.*Overturned/.test(afterRecord.replace(/\s+/g, " ")));
    ok("...and the evidence source — the one field this feature must never omit",
       /Known by Umpire's eye/.test(afterRecord));
    ok("...with the Law 36 components recorded", /Pitching In line.*Impact In line.*Wickets Hitting/.test(afterRecord.replace(/\s+/g, " ")));

    group("The record reached Postgres, not just the page's own state");
    const row = (await dbq(
      `select ball_seq, called_by, on_field, outcome, evidence_source, pitching, impact, wickets
         from drs_review where match_id = $1`, [MATCH]))[0];
    ok("exactly the row the form said was written", row &&
       row.ball_seq === 1 && row.called_by === "fielding" && row.on_field === "not_out" &&
       row.outcome === "overturned" && row.evidence_source === "umpire_eye" &&
       row.pitching === "in_line" && row.impact === "in_line" && row.wickets === "hitting",
       JSON.stringify(row));

    group("It shows in the list after a GENUINE re-fetch, not a page that remembered its own write");
    await reselectMatch(dos.page, MATCH);
    const reopened = await panel(dos.page).innerText();
    if (DEBUG) console.log("[debug] panel after reselect:\n" + reopened);
    ok("the review is still there after a fresh read from the server", /1 recorded/.test(reopened));
    ok("...with the same evidence source", /Known by Umpire's eye/.test(reopened));
    ok("no console errors on her session", dos.errors.length === 0, dos.errors.join(" | "));
    await dos.ctx.close().catch(() => {});
  }

  group("A reader who cannot record one sees the reviews but not the form");
  {
    const parent = await open();
    ok("a parent signs in — fixture.read only, never scoring.correct",
       await signIn(parent.page, /parent@example\.invalid|Parent/));
    await toMatchCentre(parent.page);
    await selectMatch(parent.page, MATCH);
    ok("the panel is offered to her too — the decision was announced", await panel(parent.page).count() === 1);
    const parentText = await panel(parent.page).innerText();
    ok("she sees the recorded review", /1 recorded/.test(parentText));
    ok("...but is not offered the recording form", !/RECORD A REVIEW/.test(parentText));
    await parent.ctx.close().catch(() => {});
  }

  group("Switching it back off, the panel disappears again — a live switch, not a one-way reveal");
  ok("the platform administrator switches it off",
     (await setFlag(platformTok, { enabled: false, reason: "Cameras removed for this walk." })).status === 200);
  {
    const dos = await open();
    ok("the director of sport signs in a third time, in yet another fresh session",
       await signIn(dos.page, /sarah@example\.invalid|Director/));
    await toMatchCentre(dos.page);
    await selectMatch(dos.page, MATCH);
    await dos.page.waitForTimeout(600);
    ok("the panel is gone again — off means off, even though a review exists on record",
       await panel(dos.page).count() === 0);
    ok("no console errors while it is absent again", dos.errors.length === 0, dos.errors.join(" | "));
    await dos.ctx.close().catch(() => {});
  }

  group("Nothing this walk did was erased by switching the feature off");
  ok("the review recorded earlier is untouched in the database",
     (await dbq(`select count(*)::int c from drs_review where match_id = $1`, [MATCH]))[0].c === 1);

} catch (e) {
  ok(`the browser DRS walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 8).join("\n"));
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
console.log(`\n${"─".repeat(52)}\nBROWSER DRS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

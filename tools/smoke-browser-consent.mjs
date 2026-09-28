#!/usr/bin/env node
/**
 * Health monitoring's consent, from a browser (SCRBRD-110 phase 1, db/60).
 *
 * tools/smoke-load.mjs proves the routes. This drives the three screens a
 * family actually uses, and asks what curl cannot:
 *
 *   1. SETTINGS → ME. A parent finds "Health monitoring" with her son's row,
 *      off and unanswered; turns it on with one switch and the database holds
 *      her yes; turning it off asks first, in words, and the database holds
 *      the withdrawal.
 *   2. THE EIGHTEEN CARD. A boy who has just turned eighteen, whose parent
 *      said yes while he was a child, is asked on his Me screen whether it is
 *      still all right — in today's words (her agreement ended on his
 *      birthday: phase 0 has not landed) — answers, and the card goes.
 *   3. STAFF. A coach's Me screen draws neither.
 *   4. SIGN-UP. The guardian's step of the sign-up flow shows the separate,
 *      off consent and takes no answer.
 *   5. Nothing on those pieces is set under 12px, nothing pressed is under
 *      44px, and they draw in Daylight as well as Floodlit.
 *
 * Leaves the database as it found it.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-consent.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(4359);
const API_PORT = port(8896);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";
const REGISTRAR = "88888888-0000-0000-0000-00000000000c";   // the office that verifies links
// The boy who turned eighteen ten days ago, and the people around him.
const SIPHO = "aaaaaaaa-0000-0000-0000-0000000000b8";
const U_SIPHO = "88888888-0000-0000-0000-0000000000b8";
const U_MUM = "88888888-0000-0000-0000-0000000000b9";
const A = { self: "a5510000-0000-0000-0000-0000000000b8", player: "a5510000-0000-0000-0000-0000000000b9", mum: "a5510000-0000-0000-0000-0000000000ba" };
const L = { self: "a5520000-0000-0000-0000-0000000000b8", mum: "a5520000-0000-0000-0000-0000000000b9" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-consent-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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
const q = async (t, p) => (await pool.query(t, p)).rows;
const browser = await chromium.launch({ ...launchOptions() });

async function open(theme = "floodlit") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};
    try { localStorage.setItem("scrbrd:theme", ${JSON.stringify(theme)}); } catch (e) {}`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
const text = (page) => page.$eval("body", (el) => el.innerText);
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
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
  return /Match Centre|Dashboard/i.test(await text(page));
}
async function toMe(page) {
  const l = tid(page, "nav-settings").first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1000);
  try { await page.locator("#settings-tab-me").click({ timeout: 4000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return true;
}
/** Every text node under the element, and every control, measured as drawn. */
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA|SUMMARY)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type)) || (n.tagName === "A" && n.getAttribute("href"))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, bg: getComputedStyle(document.body).backgroundColor };
  }).catch(() => ({ small: ["(not drawn)"], tiny: [], bg: "" }));
}
const records = async (player) => q(`select given_by, end_reason, ended_on is null as open from health_monitoring_consent
                                      where player_id = $1 order by seq`, [player]);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`).then((x) => x.json()); if (r?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // The boy who turned eighteen ten days ago: his account (player and his own
  // file), his mother's link — ended on his birthday, as it is today — and
  // her yes, given a month before it. Anything a broken earlier run left
  // behind goes first.
  await q(`delete from health_monitoring_consent where player_id in ($1, $2)`, [PILLAY, SIPHO]);
  await q(`delete from access_log where person_id in ($1, $2)`, [U_SIPHO, U_MUM]).catch(() => {});
  await q(`delete from app_user where id in ($1, $2)`, [U_SIPHO, U_MUM]);
  await q(`delete from player where id = $1`, [SIPHO]);
  await q(`insert into player (id, school_id, team_code, full_name, surname, squad_no, playing_role, born)
           values ($1, $2, '1XI', 'Sipho Eighteen', 'Eighteen', 88, 'bowler', (current_date - interval '18 years 10 days')::date)`, [SIPHO, HIL]);
  await q(`insert into app_user (id, school_id, email, name, role) values
             ($1, $3, 'sipho.eighteen@example.invalid', 'Sipho Eighteen', 'player'),
             ($2, $3, 'mum.eighteen@example.invalid', 'N Eighteen', 'guardian')`, [U_SIPHO, U_MUM, HIL]);
  await q(`insert into role_assignment (id, person_id, role, school_id, team_code) values
             ($1, $4, 'selfaccess', $6, null), ($2, $4, 'player', $6, '1XI'), ($3, $5, 'guardian', $6, null)`,
          [A.self, A.player, A.mum, U_SIPHO, U_MUM, HIL]);
  await q(`insert into assignment_subject (id, assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                           consent_state, consent_version, consent_at, valid_from, valid_until) values
             ($1, $3, $5, 'self',   'verified', $6, now(), 'granted', 'popia-2026-01', now(), current_date - 30, null),
             ($2, $4, $5, 'parent', 'verified', $6, now() - interval '400 days', 'granted', 'popia-2026-01', now() - interval '400 days',
              current_date - 400, majority_on((current_date - interval '18 years 10 days')::date))`,
          [L.self, L.mum, A.self, A.mum, SIPHO, REGISTRAR]);
  await q(`insert into health_monitoring_consent (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on, recorded_by)
           values ($1, 'guardian', $2, $3, 'health-monitoring-2026-09', current_date - 40, $4)`, [SIPHO, A.mum, L.mum, U_MUM]);

  // ── 1. A parent, on Settings → Me ───────────────────────────────
  group("A parent turns health monitoring on, and off");
  const parent = await open();
  ok("the parent signs in", await signIn(parent.page, "parent@example.invalid"));
  ok("Settings → Me opens", await toMe(parent.page));
  ok("Health monitoring is drawn for her", (await tid(parent.page, "health-consent-section").count()) === 1);
  const sw = tid(parent.page, `health-consent-switch-${PILLAY}`);
  ok("R Pillay's row is off, and nobody has answered",
     (await sw.getAttribute("aria-checked").catch(() => null)) === "false"
     && /nobody has answered/.test(await tid(parent.page, `health-consent-state-${PILLAY}`).innerText().catch(() => "")));
  ok("...the eighteen card is not drawn for her", (await tid(parent.page, "eighteen-card").count()) === 0);
  await tid(parent.page, "health-consent-words").locator("summary").click();
  ok("what it covers is in words, the nets count said to be separate",
     /check-in/.test(await tid(parent.page, "health-consent-words").innerText().catch(() => ""))
     && /counted either way/.test(await tid(parent.page, "health-consent-words").innerText().catch(() => "")));
  const f = await floors(parent.page, "health-consent-section");
  ok("nothing in it is set under 12px", f.small.length === 0, f.small.slice(0, 4).join(" · "));
  ok("nothing pressed in it is under 44px", f.tiny.length === 0, f.tiny.slice(0, 4).join(" · "));
  await sw.click();
  await parent.page.waitForTimeout(1500);
  ok("one switch turns it on", (await sw.getAttribute("aria-checked").catch(() => null)) === "true"
     && /On — agreed by you/.test(await tid(parent.page, `health-consent-state-${PILLAY}`).innerText().catch(() => "")));
  let recs = await records(PILLAY);
  ok("...and the database holds her yes", recs.length === 1 && recs[0].given_by === "guardian" && recs[0].open, JSON.stringify(recs));
  await sw.click();
  await parent.page.waitForTimeout(500);
  const confirm = await tid(parent.page, "health-consent-confirm").innerText().catch(() => "");
  ok("turning it off asks first, and says collection stops and nothing is deleted today",
     /Collection stops at once/.test(confirm) && /Nothing is deleted today/.test(confirm), confirm);
  recs = await records(PILLAY);
  ok("...and has not withdrawn it yet", recs.length === 1 && recs[0].open);
  const fc = await floors(parent.page, "health-consent-confirm");
  ok("the question has no type under 12px and no control under 44px", fc.small.length === 0 && fc.tiny.length === 0,
     [...fc.small, ...fc.tiny].slice(0, 4).join(" · "));
  await tid(parent.page, "health-consent-stop").click();
  await parent.page.waitForTimeout(1500);
  recs = await records(PILLAY);
  ok("she confirms: off, and the database holds the withdrawal",
     (await sw.getAttribute("aria-checked").catch(() => null)) === "false" && recs.length === 1 && recs[0].end_reason === "withdrawn",
     JSON.stringify(recs));
  ok("no page error for the parent", parent.errors.length === 0, parent.errors.join(" | "));
  await parent.ctx.close();

  // ── 2. Eighteen ─────────────────────────────────────────────────
  group("He turned eighteen: the card asks him once");
  const sipho = await open();
  ok("Sipho signs in", await signIn(sipho.page, "sipho.eighteen@example.invalid"));
  ok("Settings → Me opens", await toMe(sipho.page));
  const card = await tid(sipho.page, "eighteen-card").innerText().catch(() => "");
  ok("the card asks whether it is still all right", /You are 18 — is this still all right\?/.test(card), card.slice(0, 200));
  ok("...in today's words: her agreement ended on his birthday (phase 0 flips this)",
     /ended on your eighteenth birthday/.test(card) && /nothing about your body is being collected/.test(card), card.slice(0, 400));
  const fe = await floors(sipho.page, "eighteen-card");
  ok("the card has no type under 12px and no control under 44px", fe.small.length === 0 && fe.tiny.length === 0,
     [...fe.small, ...fe.tiny].slice(0, 4).join(" · "));
  await tid(sipho.page, "eighteen-yes").click();
  await sipho.page.waitForTimeout(1800);
  recs = await records(SIPHO);
  ok("he says yes for himself: the database holds his own record", recs.some((r) => r.given_by === "self" && r.open), JSON.stringify(recs));
  ok("...and the card is gone", (await tid(sipho.page, "eighteen-card").count()) === 0);
  ok("his own row now reads on, agreed by him",
     /On — agreed by you/.test(await tid(sipho.page, `health-consent-state-${SIPHO}`).innerText().catch(() => "")));
  ok("no page error for him", sipho.errors.length === 0, sipho.errors.join(" | "));
  await sipho.ctx.close();

  // ── 3. Staff ────────────────────────────────────────────────────
  group("A coach's Me screen draws neither");
  const coach = await open();
  ok("the coach signs in", await signIn(coach.page, "coach@example.invalid"));
  ok("Settings → Me opens", await toMe(coach.page));
  ok("...with no health-monitoring section and no eighteen card",
     (await tid(coach.page, "health-consent-section").count()) === 0 && (await tid(coach.page, "eighteen-card").count()) === 0);
  await coach.ctx.close();

  // ── 4. Sign-up ──────────────────────────────────────────────────
  group("The sign-up flow says it is separate and off");
  const signup = await open();
  await click(signup.page, /Get Started/, 5000);
  await click(signup.page, /^Continue/);
  await click(signup.page, /Parent \/ Guardian/);
  await signup.page.waitForTimeout(600);
  await click(signup.page, /Hilton College/);
  await signup.page.waitForTimeout(600);
  await signup.page.fill('input[placeholder="e.g. James Whitfield"]', "A Newparent").catch(() => {});
  await signup.page.fill('input[placeholder="james@school.co.za"]', "a.newparent@example.invalid").catch(() => {});
  await click(signup.page, /^Continue/);
  await signup.page.waitForTimeout(600);
  const row = await tid(signup.page, "signup-health-consent").innerText().catch(() => "");
  ok("the guardian's step shows health monitoring as separate and off", /separate, and off/.test(row) && /under Settings, Me/.test(row), row);
  ok("...and takes no answer (no switch, no box)",
     (await tid(signup.page, "signup-health-consent").locator("button, input").count()) === 0);
  const fs = await floors(signup.page, "signup-health-consent");
  ok("...with no type under 12px", fs.small.length === 0, fs.small.slice(0, 4).join(" · "));
  await signup.ctx.close();

  // ── 5. Daylight ─────────────────────────────────────────────────
  group("The section in Daylight");
  const day = await open("daylight");
  ok("the parent signs in again", await signIn(day.page, "parent@example.invalid"));
  ok("Settings → Me opens in Daylight", await toMe(day.page));
  const theme = await day.page.evaluate(() => document.documentElement.dataset.theme);
  const fl = await floors(day.page, "health-consent-section");
  ok("the theme is Daylight and the page is light", theme === "daylight" && /rgb\((2[0-9]{2}|1[89][0-9]), /.test(fl.bg), `${theme} ${fl.bg}`);
  ok("...with the same floors", fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].slice(0, 4).join(" · "));
  const on = await day.page.$eval(`[data-testid="health-consent-switch-${PILLAY}"]`,
    (b) => ({ c: getComputedStyle(b).color, bg: getComputedStyle(document.body).backgroundColor })).catch(() => null);
  ok("...and its switch is drawn in the theme's own ink", on && on.c !== on.bg, JSON.stringify(on));
  ok("no page error in Daylight", day.errors.length === 0, day.errors.join(" | "));
  await day.ctx.close();
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.message);
} finally {
  await q(`delete from health_monitoring_consent where player_id in ($1, $2)`, [PILLAY, SIPHO]).catch(() => {});
  // His sign-in wrote access_log rows under his id; they go with the fixture.
  await q(`delete from access_log where person_id in ($1, $2)`, [U_SIPHO, U_MUM]).catch(() => {});
  await q(`delete from app_user where id in ($1, $2)`, [U_SIPHO, U_MUM]).catch(() => {});
  await q(`delete from player where id = $1`, [SIPHO]).catch(() => {});
  await q(`delete from role_request where email = 'a.newparent@example.invalid'`).catch(() => {});
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nBROWSER CONSENT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * Parent lift clubs, phase 1, from a browser (SCRBRD-124; db/70).
 *
 * tools/smoke-lifts.mjs proves the routes. This drives the screens the people
 * involved actually use, with the seed's own invented families:
 *
 *   1. The principal signs the school's lift policy on Settings → School,
 *      starting from the template, with the school's meeting point.
 *   2. H Whitfield reads the policy and makes her declaration on Settings →
 *      Me, choosing her own number from her son's contact card, and her
 *      standing line says she may drive.
 *   3. On the Squad screen she offers a round trip to her son's fixture in one
 *      form, and her driver's card appears.
 *   4. A Bekker sees the offer — the driver's name, the school's point, the
 *      seats left — and asks for a seat for her son, and only her son.
 *   5. The driver accepts him from her card; his mother sees "Confirmed".
 *   6. The office sees counts and no names; the coach sees no lifts block.
 *   7. With the platform's grant taken back, no family sees a lifts block.
 *   8. On the lift screens nothing read is under 12px and nothing pressed is
 *      under 44px.
 *
 * Falsified by drawing the family block whatever the module (LiftsForFixture's
 * familyLive forced true): (7) went red. Who sees which rows is not this
 * screen's to falsify: the rows come from the server (db/99 §48).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-lifts.mjs
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

const WEB_PORT = port(5471);
const API_PORT = port(5472);
const API = `http://127.0.0.1:${API_PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-lifts-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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
const grant = (on) => q(`insert into feature_grant (key, school_id, granted, note) values ('lift_club', $1, $2, 'browser-lifts')
                         on conflict (key, school_id) do update set granted = excluded.granted`, [HIL, on]);
const browser = await chromium.launch({ ...launchOptions() });

async function open() {
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
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
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
async function go(page, nav) {
  const l = tid(page, `nav-${nav}`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1600);
  return true;
}
async function settingsTab(page, id) {
  if (!(await go(page, "settings"))) return false;
  const t = page.locator(`#settings-tab-${id}`);
  if (!(await t.count())) return false;
  await t.click({ timeout: 6000 });
  await page.waitForTimeout(1500);
  return true;
}
/** The lifts block on the Squad screen, on this walk's fixture. */
async function liftsOn(page, matchId) {
  if (!(await go(page, "squad"))) return false;
  const panel = tid(page, "lifts-panel");
  try { await panel.waitFor({ timeout: 6000 }); } catch { return false; }
  const sel = panel.locator("select").first();
  if (await sel.count()) { await sel.selectOption(matchId).catch(() => {}); await page.waitForTimeout(1200); }
  return true;
}
/** Text under 12px and controls under 44px, inside one block, as drawn. */
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of el.querySelectorAll("*")) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny };
  });
}

const all = [];
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`).then((x) => x.json()); if (r?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await grant(true);
  // The fixture, on an explicit day at an explicit hour, Johannesburg time.
  const [m] = await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
                       values ($1, '1XI', 'Browser Lifts', ((current_date + 6)::timestamp + time '09:00') at time zone 'Africa/Johannesburg',
                               'T20', 20, 'scheduled') returning id`, [HIL]);

  // ── 1. The principal signs ────────────────────────────────────────
  group("The principal signs the school's lift policy (Settings → School)");
  const head = await open(); all.push(head);
  ok("the principal signs in", await signIn(head.page, "principal@example.invalid"));
  ok("...and finds the lift policy on the School tab", await settingsTab(head.page, "school") && await tid(head.page, "lift-policy-panel").count() === 1);
  ok("...which says none is signed", /No policy is signed/.test(await tid(head.page, "lift-policy-state").innerText()));
  ok("...and offers the template to start from",
     /arranged between families/.test(await tid(head.page, "lift-policy-body").inputValue()));
  await tid(head.page, "lift-policy-meet").fill("the Chapel car park");
  await tid(head.page, "lift-policy-sign").click();
  await head.page.waitForTimeout(1500);
  ok("she signs it, and lift clubs are live", /Version 1/.test(await tid(head.page, "lift-policy-state").innerText())
     && /live/.test(await tid(head.page, "lift-policy-state").innerText()));
  const pf = await floors(head.page, "lift-policy-panel");
  ok("the policy screen keeps the floors", pf.small.length === 0 && pf.tiny.length === 0, [...pf.small, ...pf.tiny].join(" · "));

  // ── 2. The driver declares ────────────────────────────────────────
  group("A parent declares (Settings → Me)");
  const drv = await open(); all.push(drv);
  ok("H Whitfield signs in", await signIn(drv.page, "parent.whitfield@example.invalid"));
  ok("...and finds her lift club on Me", await settingsTab(drv.page, "me") && await tid(drv.page, "lift-declaration-panel").count() === 1);
  ok("...whose standing line asks for a declaration, in the school's words",
     /declaration/.test(await tid(drv.page, "lift-standing").innerText()));
  ok("...and shows the school's policy to read first", /Chapel|arranged between families/.test(await tid(drv.page, "lift-policy-text").innerText()));
  await tid(drv.page, "lift-declare-vehicle").fill("silver Toyota Fortuner");
  await tid(drv.page, "lift-declare-registration").fill("nd 123-456");
  for (const t of ["licence", "insured", "roadworthy", "belts", "code"]) await tid(drv.page, `lift-declare-${t}`).check();
  const radio = drv.page.locator('[data-testid^="lift-declare-contact-"]').first();
  ok("...she chooses her number from her son's contact card", await radio.count() === 1);
  await radio.check();
  await tid(drv.page, "lift-declare-submit").click();
  await drv.page.waitForTimeout(1500);
  ok("...and may drive, in the car she declared", /may offer lifts.*Fortuner.*ND 123 456/.test(await tid(drv.page, "lift-standing").innerText()));
  const df = await floors(drv.page, "lift-declaration-panel");
  ok("the declaration keeps the floors", df.small.length === 0 && df.tiny.length === 0, [...df.small, ...df.tiny].join(" · "));

  // ── 3. She offers a round trip ────────────────────────────────────
  group("She offers a round trip on the Squad screen");
  ok("the lifts block is on her son's side's fixture", await liftsOn(drv.page, m.id));
  await tid(drv.page, "lift-offer-form").locator("summary").click();
  await drv.page.waitForTimeout(300);
  ok("...the form offers both ways by default", /Offer both ways/.test(await tid(drv.page, "lift-form-submit").innerText()));
  await tid(drv.page, "lift-form-note").fill("silver Fortuner, by the scoreboard");
  await tid(drv.page, "lift-form-submit").click();
  await drv.page.waitForTimeout(1800);
  ok("...and her two driver's cards appear", await drv.page.locator('[data-testid^="lift-driver-card-"]').count() === 2,
     await tid(drv.page, "lift-form-said").innerText().catch(() => ""));
  const [out] = await q(`select id from lift_offer where match_id = $1 and leg = 'out'`, [m.id]);

  // ── 4. A family asks ──────────────────────────────────────────────
  group("Another family sees the offer and asks for its son");
  const fam = await open(); all.push(fam);
  ok("A Bekker signs in", await signIn(fam.page, "parent.bekker@example.invalid"));
  ok("...and sees the lifts block", await liftsOn(fam.page, m.id));
  const offerText = await tid(fam.page, `lift-offer-${out?.id}`).innerText().catch(() => "");
  ok("...with the driver's name, the school's point and the seats left",
     /H Whitfield/.test(offerText) && /Chapel car park/.test(offerText) && /of 3 seats left/.test(offerText), offerText);
  ok("...the driver's note", /scoreboard/.test(offerText));
  ok("...and only her own son to ask for", (await fam.page.locator(`[data-testid^="lift-ask-${out?.id}-"]`).count()) === 1
     && /T Bekker/.test(offerText) && !/Whitfield,|James|Cele/.test(offerText));
  ok("...told he would be the only other boy in the car", /only other boy in the car/.test(offerText));
  await fam.page.locator(`[data-testid^="lift-ask-${out?.id}-"]`).first().click();
  await fam.page.waitForTimeout(1500);
  ok("she asks, and the seat reads as waiting for the driver",
     /waiting for the driver/i.test(await tid(fam.page, `lift-offer-${out?.id}`).innerText()));
  const ff = await floors(fam.page, "lifts-panel");
  ok("the lifts block keeps the floors", ff.small.length === 0 && ff.tiny.length === 0, [...ff.small, ...ff.tiny].join(" · "));

  // ── 5. The driver accepts ─────────────────────────────────────────
  group("The driver accepts him from her card");
  // Away and back: a reload would end the session (the token is in memory).
  await go(drv.page, "settings");
  ok("her lifts block again", await liftsOn(drv.page, m.id));
  const card = tid(drv.page, `lift-driver-card-${out?.id}`);
  ok("...the request is on her card, by name", /T Bekker/.test(await card.innerText()));
  await card.locator('[data-testid^="lift-pick-"]').first().check();
  ok("...ticked alone, he is named the only other boy", /only other boy/.test(await card.innerText()));
  await tid(drv.page, `lift-accept-${out?.id}`).click();
  await drv.page.waitForTimeout(1500);
  ok("...accepted", /confirmed/i.test(await tid(drv.page, `lift-driver-card-${out?.id}`).innerText()),
     `${await tid(drv.page, `lift-driver-card-${out?.id}`).innerText()} | ${JSON.stringify(await q(`select state, guardian_ok_version, driver_ok_version from lift_seat where offer_id = $1`, [out?.id]))}`);
  await go(fam.page, "settings");
  await liftsOn(fam.page, m.id);
  ok("his mother sees it confirmed", /confirmed/i.test(await tid(fam.page, `lift-offer-${out?.id}`).innerText()));

  // ── 6. The office and the coach ───────────────────────────────────
  group("The office sees counts and no names; the coach sees no lifts");
  const off = await open(); all.push(off);
  ok("the office signs in", await signIn(off.page, "registrar@example.invalid"));
  ok("...and sees the counts on the fixture", await liftsOn(off.page, m.id) && await tid(off.page, "lift-office-counts").count() === 1);
  const counts = await tid(off.page, "lift-office-counts").innerText().catch(() => "");
  ok("...one lift each way, three seats, one confirmed", /There: 1 lift, 3 seats, 1 confirmed/.test(counts), counts);
  ok("...and no name", !/Bekker|Whitfield/.test(await tid(off.page, "lifts-panel").innerText()));
  const co = await open(); all.push(co);
  ok("the 1XI coach signs in", await signIn(co.page, "coach@example.invalid"));
  await go(co.page, "squad");
  ok("...and his Squad screen has no lifts block", await tid(co.page, "lifts-panel").count() === 0);

  // ── 7. The platform takes the module back ─────────────────────────
  group("With the module taken back, no family sees a lifts block");
  await grant(false);
  await go(fam.page, "settings");
  await go(fam.page, "squad");
  await fam.page.waitForTimeout(1500);
  ok("Bekker's Squad screen has no lifts block", await tid(fam.page, "lifts-panel").count() === 0);

  for (const [who, c] of [["principal", head], ["driver", drv], ["family", fam], ["office", off], ["coach", co]]) {
    ok(`the ${who}'s session raised no page errors`, c.errors.length === 0, c.errors.slice(0, 2).join(" · "));
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e);
} finally {
  await grant(false).catch(() => {});
  for (const c of all) await c.ctx.close().catch(() => {});
  await browser.close();
  await pool.end();
  web.close();
  apiProc.kill();
}

if (apiErr.join("").match(/Error/)) console.log(apiErr.join("").slice(0, 1500));
console.log("\n" + "─".repeat(52));
console.log(`BROWSER LIFTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

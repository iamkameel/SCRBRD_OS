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
 *      R Pillay, put at eighteen and still at school, sees a simple block on
 *      his own fixture — the place and time, no driver's name yet, one "Ask
 *      for a seat", for himself — asks and withdraws; at sixteen again, none
 *      (Kameel's follow-up, 2026-10-01).
 *   6c. The day (phase 2, db/76), on a fixture tomorrow: R Pillay, at
 *      eighteen, reads his own lift on his Home with no number; the driver
 *      marks T Bekker in, the lift as left and him handed over from her
 *      day card (his family's number on it); the coach's Squad lists him
 *      arriving and the coach says "with us"; on the way home Bekker's
 *      mother's Home carries the lift — the driver, the car, her number —
 *      and she confirms collected; R Pillay, not collected, is on the
 *      office's exceptions by name and resolved there; the office purges a
 *      lift of three years ago from Settings → School.
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
  // Staff land on the Dashboard; a parent or a pupil lands in their own app (step 4).
  return /Match Centre|Dashboard/i.test(await text(page)) || (await tid(page, "persona-bar").count()) === 1;
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
/**
 * The lifts block on this walk's fixture. Staff open it on the Squad screen; a
 * parent's or a pupil's app has no Squad (step 4), so they open the fixture
 * from Matches and the block is on it (FixtureLifts).
 */
async function toFixture(page, matchId) {
  if (await go(page, "squad")) return true;
  if (!(await go(page, "fixtures")) && !(await go(page, "mymatches"))) return false;
  const row = tid(page, `fixture-row-${matchId}`).first();
  try { await row.waitFor({ timeout: 6000 }); await row.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return true;
}
async function liftsOn(page, matchId) {
  if (!(await toFixture(page, matchId))) return false;
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

  // ── 6b. A pupil of eighteen still at school (Kameel, 2026-10-01) ──
  group("A pupil of eighteen still at school asks for himself on his fixture");
  const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";
  const [{ born: pillayBorn }] = await q(`select born::text from player where id = $1`, [PILLAY]);
  await q(`update player set born = (current_date - interval '18 years' - interval '30 days')::date where id = $1`, [PILLAY]);
  const boy = await open(); all.push(boy);
  ok("R Pillay, put at eighteen, signs in", await signIn(boy.page, "pillay@example.invalid"));
  await toFixture(boy.page, m.id);
  const self = tid(boy.page, "lifts-self");
  try { await self.waitFor({ timeout: 6000 }); } catch { /* counted below */ }
  const selfText = await self.innerText().catch(() => "");
  ok("...and sees a simple lifts block on his own fixture", await self.count() === 1, selfText);
  ok("...with the place and time, no driver's name yet, and nobody else's son",
     /Chapel car park/.test(selfText) && /named once your seat is confirmed/.test(selfText)
     && !/H Whitfield|T Bekker|Cele/.test(selfText), selfText);
  const ask = boy.page.locator(`[data-testid="lift-ask-${out?.id}-${PILLAY}"]`);
  ok("...one 'Ask for a seat', for himself", await ask.count() === 1
     && await self.locator('[data-testid^="lift-ask-"]').count() === 2);
  await ask.click();
  await boy.page.waitForTimeout(1500);
  ok("he asks, and his seat reads as waiting for the driver",
     /waiting for the driver/i.test(await tid(boy.page, `lift-offer-${out?.id}`).innerText()));
  const [ps] = await q(`select consent_by from lift_seat where offer_id = $1 and player_id = $2 and state = 'requested'`, [out?.id, PILLAY]);
  ok("...a seat on his own say", ps?.consent_by === "self");
  const bf = await floors(boy.page, "lifts-self");
  ok("the pupil's block keeps the floors", bf.small.length === 0 && bf.tiny.length === 0, [...bf.small, ...bf.tiny].join(" · "));
  await tid(boy.page, `lift-withdraw-${out?.id}-${PILLAY}`).click();
  await boy.page.waitForTimeout(1500);
  ok("...and withdraws it", (await q(`select state from lift_seat where offer_id = $1 and player_id = $2`, [out?.id, PILLAY]))[0]?.state === "withdrawn");
  await q(`update player set born = $2::date where id = $1`, [PILLAY, pillayBorn]);
  await go(boy.page, "settings");
  await toFixture(boy.page, m.id);
  await boy.page.waitForTimeout(1500);
  ok("at sixteen again, his fixture has no lifts block",
     await tid(boy.page, "lifts-self").count() === 0 && await tid(boy.page, "lifts-panel").count() === 0);

  // ── 6c. The day (phase 2, db/76) ──────────────────────────────────
  group("The day: the driver's card, the coach's list, the family's card, the office, the pupil's line (db/76)");
  /** The routes as a person, for the arrangement the day starts from (phase 1's screens are walked above). */
  const as = async (email) => (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, deviceId: "browser-lifts-day" }) }).then((x) => x.json())).token;
  const call = (token, path, body) => fetch(`${API}${path}`, { method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
    .then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }));
  const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";
  // His mother's number on his card, as the family keeps it.
  await q(`insert into emergency_contact (player_id, priority, name, relationship, phone) values ($1, 1, 'A Bekker', 'mother', '+27 82 000 0102')`, [BEKKER]);
  const tDrv = await as("parent.whitfield@example.invalid");
  const tFam = await as("parent.bekker@example.invalid");
  const tBoy = await as("pillay@example.invalid");
  await q(`update player set born = (current_date - interval '18 years' - interval '30 days')::date where id = $1`, [PILLAY]);
  // Tomorrow at ten, Johannesburg time: inside the day window.
  const [d] = await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
                       values ($1, '1XI', 'Browser Lifts Day', ((current_date + 1)::timestamp + time '10:00') at time zone 'Africa/Johannesburg',
                               'T20', 20, 'scheduled') returning id, starts_at`, [HIL]);
  const ds = new Date(d.starts_at).getTime();
  const made = await call(tDrv, `/api/matches/${d.id}/lifts`, { legs: [
    { leg: "out", seats: 3, meetKind: "school", meetAt: new Date(ds - 90 * 60_000).toISOString() },
    { leg: "back", seats: 3, meetKind: "ground", meetAt: new Date(ds + 300 * 60_000).toISOString() }] });
  const DOUT = made.body?.offers?.find((o) => o.leg === "out")?.id;
  const DBACK = made.body?.offers?.find((o) => o.leg === "back")?.id;
  const sOut = (await call(tFam, `/api/lifts/${DOUT}/seats`, { playerId: BEKKER })).body?.seatId;
  const sBack = (await call(tFam, `/api/lifts/${DBACK}/seats`, { playerId: BEKKER })).body?.seatId;
  const sBoy = (await call(tBoy, `/api/lifts/${DBACK}/seats`, { playerId: PILLAY })).body?.seatId;
  const a1 = await call(tDrv, `/api/lifts/${DOUT}/accept`, { seatIds: [sOut] });
  const a2 = await call(tDrv, `/api/lifts/${DBACK}/accept`, { seatIds: [sBack, sBoy] });
  ok("tomorrow's lifts are arranged (the routes, as phase 1's screens make them)", Boolean(DOUT && DBACK && sOut && sBack && sBoy)
     && a1.status === 200 && a2.status === 200, JSON.stringify([made.body, a1.body, a2.body]));

  // The pupil's own line, before the day's marks: who drives, where, when, the car — no number.
  await go(boy.page, "settings");
  await go(boy.page, "myhome");
  const mine = tid(boy.page, "my-lifts");
  try { await mine.waitFor({ timeout: 6000 }); } catch { /* counted below */ }
  const mineText = await mine.innerText().catch(() => "");
  ok("R Pillay, at eighteen, reads his own lift on his Home: the driver, the place, the time, the car",
     /Lift home with H Whitfield/.test(mineText) && /At the ground/.test(mineText) && /Fortuner/.test(mineText), mineText);
  ok("...and no number", !/\+27|082|\d{3} \d{4}/.test(mineText), mineText);

  // The driver's card on the way there: in the car, left, handed over.
  await go(drv.page, "settings");
  await toFixture(drv.page, d.id);
  const dcard = tid(drv.page, `lift-day-driver-${DOUT}`);
  try { await dcard.waitFor({ timeout: 6000 }); } catch { /* counted below */ }
  ok("the driver's day card is on her son's fixture, naming T Bekker", /T Bekker/.test(await dcard.innerText().catch(() => "")));
  ok("...with his family's number to ring, and who consented", (await dcard.locator('a[href^="tel:"]').count()) >= 1
     && /Consent given by A Bekker/.test(await dcard.innerText().catch(() => "")), await dcard.innerText().catch(() => ""));
  await tid(drv.page, `lift-board-${sOut}`).click();
  await drv.page.waitForTimeout(1200);
  await tid(drv.page, `lift-left-${DOUT}`).click();
  await drv.page.waitForTimeout(1200);
  await tid(drv.page, `lift-handover-${sOut}`).click();
  await drv.page.waitForTimeout(1200);
  ok("she marks him in, the lift as left, and him handed over", /In the car .*Handed over/.test(await tid(drv.page, `lift-day-marks-${sOut}`).innerText().catch(() => "")),
     await tid(drv.page, `lift-day-marks-${sOut}`).innerText().catch(() => ""));
  const dcf = await floors(drv.page, `lift-day-driver-${DOUT}`);
  ok("the driver's day card keeps the floors", dcf.small.length === 0 && dcf.tiny.length === 0, [...dcf.small, ...dcf.tiny].join(" · "));

  // The coach's list, and "with us".
  await go(co.page, "settings");
  await go(co.page, "squad");
  const exp = tid(co.page, `lift-expected-${d.id}`);
  try { await exp.waitFor({ timeout: 6000 }); } catch { /* counted below */ }
  ok("the coach's Squad lists T Bekker arriving by lift with H Whitfield", /T Bekker/.test(await exp.innerText().catch(() => ""))
     && /H Whitfield/.test(await exp.innerText().catch(() => "")));
  const ef = await floors(co.page, `lift-expected-${d.id}`);
  ok("the expected list keeps the floors", ef.small.length === 0 && ef.tiny.length === 0, [...ef.small, ...ef.tiny].join(" · "));
  await tid(co.page, `lift-with-us-${sOut}`).click();
  await co.page.waitForTimeout(1500);
  ok("he says \"with us\"", (await q(`select acknowledged_at from lift_seat where id = $1`, [sOut]))[0]?.acknowledged_at != null
     && await tid(co.page, `lift-with-us-${sOut}`).count() === 0);
  await tid(drv.page, `lift-arrived-${DOUT}`).click();
  await drv.page.waitForTimeout(1500);
  ok("the driver arrives and the way there is done", (await q(`select state from lift_offer where id = $1`, [DOUT]))[0]?.state === "done");

  // The way home: both in, left; T Bekker handed over, R Pillay not collected.
  for (const s of [sBack, sBoy]) { await tid(drv.page, `lift-board-${s}`).click(); await drv.page.waitForTimeout(1000); }
  await tid(drv.page, `lift-left-${DBACK}`).click();
  await drv.page.waitForTimeout(1200);
  await tid(drv.page, `lift-handover-${sBack}`).click();
  await drv.page.waitForTimeout(1000);
  await tid(drv.page, `lift-notcollected-${sBoy}`).click();
  await drv.page.waitForTimeout(1200);
  ok("on the way home she hands T Bekker over and marks R Pillay not collected",
     (await q(`select handover_kind from lift_seat where id = $1`, [sBoy]))[0]?.handover_kind === "not_collected");

  // The family's card on Home: the driver's number and car, and "confirm collected".
  await go(fam.page, "settings");
  await go(fam.page, "children");
  const fcard = tid(fam.page, `lift-day-family-${DBACK}`);
  try { await fcard.waitFor({ timeout: 6000 }); } catch { /* counted below */ }
  const fText = await fcard.innerText().catch(() => "");
  ok("Bekker's mother's Home carries his lift home: with H Whitfield, the car and her number", /H Whitfield/.test(fText)
     && /Fortuner/.test(fText) && /ND 123 456/.test(fText) && (await fcard.locator('a[href^="tel:"]').count()) >= 1, fText);
  ok("...and nobody else's son", !/Pillay/.test(fText), fText);
  const ff2 = await floors(fam.page, `lift-day-family-${DBACK}`);
  ok("the family's day card keeps the floors", ff2.small.length === 0 && ff2.tiny.length === 0, [...ff2.small, ...ff2.tiny].join(" · "));
  await tid(fam.page, `lift-collected-${sBack}`).click();
  await fam.page.waitForTimeout(1500);
  ok("she confirms she has him", (await q(`select acknowledged_by from lift_seat where id = $1`, [sBack]))[0]?.acknowledged_by != null
     && /Received/.test(await tid(fam.page, `lift-day-marks-${sBack}`).innerText().catch(() => "")));

  // The office: the exception by name, resolved.
  await go(off.page, "settings");
  await go(off.page, "squad");
  const exc = tid(off.page, `lift-exception-${sBoy}`);
  try { await exc.waitFor({ timeout: 6000 }); } catch { /* counted below */ }
  ok("the office's Squad shows R Pillay not collected, by name", /R Pillay/.test(await exc.innerText().catch(() => ""))
     && /Not collected/.test(await exc.innerText().catch(() => "")));
  const xf = await floors(off.page, "lift-exceptions");
  ok("the exceptions keep the floors", xf.small.length === 0 && xf.tiny.length === 0, [...xf.small, ...xf.tiny].join(" · "));
  await tid(off.page, `lift-resolution-${sBoy}`).selectOption("school_office");
  await tid(off.page, `lift-resolve-${sBoy}`).click();
  await off.page.waitForTimeout(1500);
  ok("she resolves it: with the school office, and the line goes",
     (await q(`select resolution from lift_seat where id = $1`, [sBoy]))[0]?.resolution === "school_office"
     && await tid(off.page, `lift-exception-${sBoy}`).count() === 0);
  await tid(drv.page, `lift-arrived-${DBACK}`).click();
  await drv.page.waitForTimeout(1500);
  ok("the driver arrives home and the way home is done", (await q(`select state from lift_offer where id = $1`, [DBACK]))[0]?.state === "done");
  await q(`update player set born = $2::date where id = $1`, [PILLAY, pillayBorn]);

  // The purge list (Settings → School, the office): a lift of three years ago.
  const [old] = await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
                         values ($1, '1XI', 'Browser Lifts Long Ago', ((current_date - interval '3 years' - interval '10 days')::date::timestamp + time '09:00') at time zone 'Africa/Johannesburg',
                                 'T20', 20, 'complete') returning id, starts_at`, [HIL]);
  const [oldOffer] = await q(`insert into lift_offer (school_id, match_id, team_code, leg, driver_id, declaration_id, seats, meet_kind, meet_at, fixture_starts_at)
                              select $1, $2, '1XI', 'out', d.person_id, d.id, 2, 'school', $3::timestamptz - interval '90 minutes', $3
                                from lift_driver_declaration d join app_user u on u.id = d.person_id
                               where u.email = 'parent.whitfield@example.invalid' order by d.declared_at desc limit 1 returning id`,
                            [HIL, old.id, old.starts_at]);
  ok("the office's School tab lists the lift due for purge", await settingsTab(off.page, "school")
     && await tid(off.page, `lift-purge-row-${oldOffer.id}`).count() === 1);
  const pf2 = await floors(off.page, "lift-purge-panel");
  ok("the purge list keeps the floors", pf2.small.length === 0 && pf2.tiny.length === 0, [...pf2.small, ...pf2.tiny].join(" · "));
  await tid(off.page, `lift-purge-${oldOffer.id}`).click();
  await off.page.waitForTimeout(1500);
  ok("she purges it, and a row of counts remains", (await q(`select count(*)::int n from lift_offer where id = $1`, [oldOffer.id]))[0].n === 0
     && (await q(`select count(*)::int n from lift_purge_log where school_id = $1`, [HIL]))[0].n >= 1);

  // ── 7. The platform takes the module back ─────────────────────────
  group("With the module taken back, no family sees a lifts block");
  await grant(false);
  await go(fam.page, "settings");
  await toFixture(fam.page, m.id);
  await fam.page.waitForTimeout(1500);
  ok("Bekker's fixture has no lifts block", await tid(fam.page, "lifts-panel").count() === 0);

  for (const [who, c] of [["principal", head], ["driver", drv], ["family", fam], ["office", off], ["coach", co], ["pupil", boy]]) {
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

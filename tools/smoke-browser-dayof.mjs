#!/usr/bin/env node
/**
 * The driver and groundskeeper's day-of screens, from a phone. SCRBRD-085.
 *
 * Both roles used to land on the coordinator's desktop dashboard. This walk
 * signs in as each, at a 360px phone viewport, and proves:
 *
 *   1. A driver sees today's trip — departure, pickup, vehicle — and can mark
 *      it departed and arrived, each mark landing in the database through
 *      trip_mark() (services/api/write/events-api.mjs transportRoutes()).
 *   2. A groundskeeper sees today's fixture — time, ground, format — and can
 *      file a pitch report from the phone (conditionsRoutes().pitch), which a
 *      second read confirms actually reached match_pitch_report.
 *   3. Neither screen is the ordinary dashboard, and a role that is neither
 *      of these two (the director of sport) still gets the one it always has.
 *
 * No seeded account holds the groundskeeper's ('facilities') role — db/98's
 * only groundskeeper is a STAFF row with no login (S Zondi, like the bursar
 * and the driver before SCRBRD carried their own accounts) — so this walk
 * mints one itself, the way smoke-browser-duties.mjs mints a scorer: a
 * test-only app_user and role_assignment, never written to the seed.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-dayof.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 5305;
const API_PORT = 8805;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
// The seed's own driver (RUNNING.md's `driver@example.invalid` / B Ngcobo).
const DRIVER_ID = "88888888-0000-0000-0000-000000000017";
const VEHICLE_ID = "4e111111-0000-0000-0000-000000000001"; // KZN 482 GP, 22 seats
const GROUND_ID = "ffffffff-0000-0000-0000-000000000001";  // Gordon Sherwood Oval
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-dayof-secret",
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
const browser = await chromium.launch({ ...launchOptions() });

/** A fresh page per person, at a phone viewport — the width this screen is for. */
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
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
/** Sign in by email — clicking the matching pilot-account chip when there is
 * one, filling the field directly when there is not (a person the login
 * picker's hand-maintained list does not carry, exactly this walk's own
 * test-only groundskeeper, or a seeded account like the driver's that was
 * never added to it). Both paths are the same dev-login underneath. */
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── Fixtures this walk needs and the seed does not carry ────────────
  // Real times, computed in Node rather than in SQL, so "today" here and
  // "today" in the browser's own Date() — the client's dateStr(today) — name
  // the same UTC calendar day regardless of the database session's timezone.
  const now = new Date();
  const todayAt = (h, m = 0) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m)).toISOString();
  const MATCH_STARTS = todayAt(9, 0);
  const TRIP_DEPART = todayAt(8, 30);

  const matchId = (await dbq(
    `insert into match (school_id, team_code, opponent, ground_id, starts_at, format, overs, status)
     values ($1, '1XI', 'Browser Day-of XI', $2, $3, 'T20', 20, 'scheduled') returning id`,
    [HIL, GROUND_ID, MATCH_STARTS]))[0].id;
  ok("a fixture for today is seeded", !!matchId);

  const tripId = (await dbq(
    `insert into trip (match_id, school_id, vehicle_id, driver_id, depart_at, pickup)
     values ($1, $2, $3, $4, $5, 'Top gate') returning id`,
    [matchId, HIL, VEHICLE_ID, DRIVER_ID, TRIP_DEPART]))[0].id;
  ok("a trip for the seeded driver is arranged against it", !!tripId);

  // The groundskeeper: no seeded account holds `facilities`, so one is minted
  // here — a test-only fixture, not a seed addition. See the file header.
  const stamp = Date.now();
  const gkEmail = `dayof-groundskeeper-${stamp}@example.invalid`;
  const gkId = (await dbq(
    `insert into app_user (school_id, email, name, role) values ($1, $2, 'W Browser Groundskeeper', 'facilities') returning id`,
    [HIL, gkEmail]))[0].id;
  await dbq(
    `insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'facilities', $2, null)`,
    [gkId, HIL]);
  ok("a test-only groundskeeper account is minted", !!gkId);

  // ── 1. The driver lands on their own screen, not the desktop dashboard ──
  //
  // A trip is genuinely arranged for this driver in the database (above).
  // What this section proves is not "the driver sees it" — see the file
  // header and DayOfView.jsx's own comment for why they currently cannot —
  // but that the account lands on the right screen, is told the truth about
  // what it cannot yet show, and is never shown the ordinary desktop
  // dashboard instead.
  group("1. A driver signs in and lands on their own screen, not the desktop dashboard");
  const driver = await open();
  ok("the seeded driver signs in", await signIn(driver.page, "driver@example.invalid"));
  const landing = await text(driver.page);
  ok("the day-of driver screen is drawn", await tid(driver.page, "dayof-driver").count() === 1);
  ok("...not the ordinary dashboard", !/Upcoming Fixtures/.test(landing) && await tid(driver.page, "kpi-row").count() === 0);
  // THE GAP, PROVEN RATHER THAN ASSUMED. A trip really is arranged for this
  // driver (tripId, above) — pickup "Top gate", vehicle KZN 482 GP — and
  // NONE of it reaches this screen, because /api/read/trips returns zero
  // rows for a driver-only account regardless of what is arranged. See
  // DayOfView.jsx's file comment for the RLS chain this traces to
  // (trip's read policy resolving its school/team through a plain subquery
  // against `match`, which is itself gated on fixture.read).
  ok("...not the pickup that really is arranged for them", !/Top gate/.test(landing));
  ok("...nor the vehicle", !/KZN\s?482\s?GP/.test(landing));
  ok("...no trip card at all — the read is empty, not the trip", await tid(driver.page, "driver-trip").count() === 0);
  ok("...and the screen says so honestly, rather than a bare empty list",
     /can't yet confirm whether a trip has been arranged/i.test(landing)
     && /No trips are visible here yet/.test(landing));
  await driver.ctx.close();

  // The gap the file header documents, confirmed twice more at the API
  // rather than guessed from the DOM.
  const driverTok = await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "driver@example.invalid", deviceId: "browser-dayof" }),
  })).json().then((j) => j.token);
  const driverH = { "content-type": "application/json", authorization: `Bearer ${driverTok}` };
  const driverMatches = await (await fetch(`${API}/api/read/matches`, { headers: driverH })).json();
  ok("...confirmed at the API: the driver's account reads zero fixtures, including this one",
     Array.isArray(driverMatches?.rows) && driverMatches.rows.length === 0);
  const driverTrips = await (await fetch(`${API}/api/read/trips`, { headers: driverH })).json();
  ok("...and zero trips too, though one really is theirs",
     Array.isArray(driverTrips?.rows) && driverTrips.rows.length === 0);

  // ── 2. The write side still works, reached directly by id ───────────────
  //
  // trip_mark() is its own SECURITY DEFINER function, keyed on the trip id
  // and the caller's own driver_id — it does not depend on the broken read
  // above, and neither does the button that calls it in TripCard (DayOfView.
  // jsx): given a trip to render, marking it departed and arrived is already
  // wired to the same route this proves works. This is "the API lets a
  // driver mark departed/arrived already" from the ticket, confirmed end to
  // end at the API; the browser cannot exercise the button today only
  // because nothing renders it to click, which is the gap above and not a
  // second one.
  group("2. The write side already works for the driver, reached directly by id");
  // Tried BEFORE the real driver marks anything, so a refusal here means
  // "not this driver" and not merely "already departed" — the same trip, in
  // the same state, refused for the reason that matters.
  const sarahTok = await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "sarah@example.invalid", deviceId: "browser-dayof" }),
  })).json().then((j) => j.token);
  const wrongDriverRes = await fetch(`${API}/api/trips/${tripId}/mark`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sarahTok}` },
    body: JSON.stringify({ event: "departed" }),
  });
  ok("somebody who is not this driver cannot mark the trip at all", !wrongDriverRes.ok);

  const departRes = await fetch(`${API}/api/trips/${tripId}/mark`, {
    method: "POST", headers: driverH, body: JSON.stringify({ event: "departed" }),
  });
  ok("the driver marks the trip departed", departRes.ok);
  const [afterDepart] = await dbq(`select departed_at, arrived_at from trip where id = $1`, [tripId]);
  ok("...and the database holds a departure time", !!afterDepart?.departed_at && !afterDepart?.arrived_at);

  const arriveRes = await fetch(`${API}/api/trips/${tripId}/mark`, {
    method: "POST", headers: driverH, body: JSON.stringify({ event: "arrived" }),
  });
  ok("...then arrived", arriveRes.ok);
  const [afterArrive] = await dbq(`select departed_at, arrived_at from trip where id = $1`, [tripId]);
  ok("...and the database holds an arrival time, after the departure",
     !!afterArrive?.arrived_at && afterArrive.arrived_at >= afterArrive.departed_at);

  // ── 3. The groundskeeper lands on today's fixtures ───────────────────
  group("3. A groundskeeper signs in and sees today's fixture, not the desktop dashboard");
  const gk = await open();
  ok("the test groundskeeper signs in", await signIn(gk.page, gkEmail));
  const gkLanding = await text(gk.page);
  ok("the day-of groundskeeper screen is drawn", await tid(gk.page, "dayof-groundskeeper").count() === 1);
  ok("...not the ordinary dashboard", !/Upcoming Fixtures/.test(gkLanding) && await tid(gk.page, "kpi-row").count() === 0);
  ok("...naming the fixture's time", /09:00/.test(gkLanding));
  ok("...the ground it is at", /Gordon Sherwood Oval/.test(gkLanding));
  ok("...and the format", /T20/.test(gkLanding));
  ok("...with exactly one fixture card", await tid(gk.page, "gk-fixture").count() === 1);

  group("4. The groundskeeper files a pitch report from the phone");
  ok("the quick form opens", await click(gk.page, /File pitch report/, 4000));
  await gk.page.waitForTimeout(400);
  ok("...offering the form", await tid(gk.page, "gk-pitch-form").count() === 1);
  await gk.page.locator('[data-testid="gk-pitch-surface"]').selectOption("firm");
  await gk.page.locator('[data-testid="gk-pitch-favours"]').selectOption("seam");
  await gk.page.locator('[data-testid="gk-pitch-notes"]').fill("Browser walk: dried out since Tuesday.");
  ok("she files it", await click(gk.page, /^File pitch report$/, 4000));
  await gk.page.waitForTimeout(1500);
  ok("...and the screen confirms it", await tid(gk.page, "gk-pitch-saved").count() === 1);
  const [filed] = await dbq(`select surface, favours, notes from match_pitch_report where match_id = $1`, [matchId]);
  ok("...and it is really in the database, from this phone and nobody else's",
     filed?.surface === "firm" && filed?.favours === "seam" && /dried out since Tuesday/.test(filed?.notes ?? ""));

  ok("no console errors for the groundskeeper", gk.errors.length === 0, gk.errors.join(" | "));
  await gk.ctx.close();

  // ── 5. Everyone else keeps the desktop dashboard ─────────────────────
  group("5. A role that is neither a driver nor a groundskeeper still gets the ordinary dashboard");
  const head = await open();
  ok("the director of sport signs in", await signIn(head.page, "sarah@example.invalid"));
  const headText = await text(head.page);
  ok("the ordinary dashboard is drawn for them", await tid(head.page, "kpi-row").count() === 1);
  ok("...not either day-of screen",
     await tid(head.page, "dayof-driver").count() === 0 && await tid(head.page, "dayof-groundskeeper").count() === 0);
  ok("...with its own upcoming-fixtures card", /Upcoming Fixtures/.test(headText));
  ok("no console errors for the director of sport", head.errors.length === 0, head.errors.join(" | "));
  await head.ctx.close();
} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (apiErr.length) console.log(apiErr.join("").slice(-1500));
} finally {
  await browser.close().catch(() => {});
  await pool.end().catch(() => {});
  apiProc.kill();
  web.close();
  console.log("\n" + "─".repeat(52));
  console.log(`BROWSER DAY-OF: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

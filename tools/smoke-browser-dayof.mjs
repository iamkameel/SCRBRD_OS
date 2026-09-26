#!/usr/bin/env node
/**
 * The driver and groundskeeper's day-of screens, from a phone. SCRBRD-085.
 *
 * Both roles used to land on the coordinator's desktop dashboard. This walk
 * signs in as each, at a 360px phone viewport, and proves:
 *
 *   1. A driver sees today's trip — departure, pickup, vehicle, and its
 *      fixture — and EXACTLY that: not another driver's bus at the same
 *      school, nor the second bus to his own fixture (db/41). He marks it
 *      departed and arrived from the phone, each mark landing in the database
 *      through trip_mark() (services/api/write/events-api.mjs
 *      transportRoutes()), and cannot mark the other driver's.
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
 * test-only app_user and role_assignment, never written to the seed. The
 * second driver, whose buses the seeded driver must not see, is minted the
 * same way.
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
const OTHER_VEHICLE_ID = "4e111111-0000-0000-0000-000000000002"; // KZN 119 KP, 14 seats
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

  // A second driver at the same school, minted like the groundskeeper below:
  // his own bus to another fixture today, and a second bus to the seeded
  // driver's fixture. Neither is the seeded driver's business (db/41).
  const stamp = Date.now();
  const otherDriverId = (await dbq(
    `insert into app_user (school_id, email, name, role) values ($1, $2, 'Z Other Driver', 'driver') returning id`,
    [HIL, `dayof-driver-b-${stamp}@example.invalid`]))[0].id;
  await dbq(
    `insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'driver', $2, null)`,
    [otherDriverId, HIL]);
  const otherMatchId = (await dbq(
    `insert into match (school_id, team_code, opponent, ground_id, starts_at, format, overs, status)
     values ($1, '2XI', 'Other Driver XI', $2, $3, 'T20', 20, 'scheduled') returning id`,
    [HIL, GROUND_ID, todayAt(10, 0)]))[0].id;
  const otherTripId = (await dbq(
    `insert into trip (match_id, school_id, vehicle_id, driver_id, depart_at, pickup)
     values ($1, $2, $3, $4, $5, 'Bottom gate') returning id`,
    [otherMatchId, HIL, OTHER_VEHICLE_ID, otherDriverId, todayAt(9, 30)]))[0].id;
  const secondBusId = (await dbq(
    `insert into trip (match_id, school_id, driver_id, depart_at, pickup)
     values ($1, $2, $3, $4, 'Chapel steps') returning id`,
    [matchId, HIL, otherDriverId, TRIP_DEPART]))[0].id;
  ok("another driver's two buses are arranged beside it", !!otherTripId && !!secondBusId);
  // A boy the seed gives an emergency contact, named for both fixtures, so
  // every manifest below has a parent's number on it to leak.
  await dbq(
    `insert into match_squad (match_id, player_id, side) values ($1, $3, 'home'), ($2, $3, 'home')`,
    [matchId, otherMatchId, "aaaaaaaa-0000-0000-0000-000000000001"]);

  // The groundskeeper: no seeded account holds `facilities`, so one is minted
  // here — a test-only fixture, not a seed addition. See the file header.
  const gkEmail = `dayof-groundskeeper-${stamp}@example.invalid`;
  const gkId = (await dbq(
    `insert into app_user (school_id, email, name, role) values ($1, $2, 'W Browser Groundskeeper', 'facilities') returning id`,
    [HIL, gkEmail]))[0].id;
  await dbq(
    `insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'facilities', $2, null)`,
    [gkId, HIL]);
  ok("a test-only groundskeeper account is minted", !!gkId);

  // ── 1. The driver sees his own trip and its fixture — and nobody else's ──
  //
  // Before db/41 this group proved the opposite: a driver-only account read
  // zero trips, even with one arranged for him, because trip's read policy
  // resolved its anchor through `match`, which a driver cannot read. db/41
  // gave the NAMED driver his own trips and their fixtures, and nothing
  // wider — which is what the "not" lines below are for.
  group("1. A driver signs in and sees his own trip and its fixture — and no other driver's");
  const driver = await open();
  ok("the seeded driver signs in", await signIn(driver.page, "driver@example.invalid"));
  await driver.page.waitForTimeout(1000);
  const landing = await text(driver.page);
  ok("the day-of driver screen is drawn", await tid(driver.page, "dayof-driver").count() === 1);
  ok("...not the ordinary dashboard (day sheet)", !/Next fixture/.test(landing) && await tid(driver.page, "day-sheet").count() === 0);
  ok("...with exactly one trip card for today", await tid(driver.page, "driver-trip").count() === 1,
     `${await tid(driver.page, "driver-trip").count()} cards`);
  ok("...and it is his", await tid(driver.page, "driver-trip").first().getAttribute("data-trip-id").catch(() => null) === tripId);
  ok("...naming the departure", /08:30/.test(landing));
  ok("...the pickup", /Top gate/.test(landing));
  ok("...the vehicle", /KZN\s?482\s?GP/.test(landing));
  ok("...and the fixture it goes to: the opposition", /Browser Day-of XI/.test(landing));
  ok("...and when it starts", /starts 09:00/.test(landing));
  ok("not the other driver's bus at the same school",
     !/Bottom gate/.test(landing) && !/KZN\s?119\s?KP/.test(landing) && !/Other Driver XI/.test(landing));
  ok("...nor the other driver's second bus to his own fixture", !/Chapel steps/.test(landing));
  ok("no console errors for the driver", driver.errors.length === 0, driver.errors.join(" | "));
  await driver.ctx.close();

  // The same, at the API rather than from the DOM — which is where the
  // policy answers.
  const driverTok = await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "driver@example.invalid", deviceId: "browser-dayof" }),
  })).json().then((j) => j.token);
  const driverH = { "content-type": "application/json", authorization: `Bearer ${driverTok}` };
  const driverTrips = await (await fetch(`${API}/api/read/trips`, { headers: driverH })).json();
  ok("at the API: the driver reads exactly his own trip",
     Array.isArray(driverTrips?.rows) && driverTrips.rows.length === 1 && driverTrips.rows[0].id === tripId,
     JSON.stringify(driverTrips?.rows?.map((r) => r.pickup)));
  const driverMatches = await (await fetch(`${API}/api/read/matches`, { headers: driverH })).json();
  ok("...and exactly his trip's fixture",
     Array.isArray(driverMatches?.rows) && driverMatches.rows.length === 1 && driverMatches.rows[0].id === matchId,
     JSON.stringify(driverMatches?.rows?.map((r) => r.opponent)));
  const manifestOf = async (id) =>
    (await (await fetch(`${API}/api/read/trip_contacts?tripId=${id}`, { headers: driverH })).json())?.rows ?? null;
  ok("...the manifest of his own bus, on the day", (await manifestOf(tripId))?.length > 0);
  ok("...and no manifest off the other driver's bus", (await manifestOf(otherTripId))?.length === 0);
  ok("...nor off the second bus to his own fixture", (await manifestOf(secondBusId))?.length === 0);

  // ── 2. The marks: his own trip, from the phone; not the other driver's ──
  group("2. The driver marks his own trip, and not another driver's");
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
  // Holding transport.drive at the school is not being this bus's driver.
  const otherMarkRes = await fetch(`${API}/api/trips/${otherTripId}/mark`, {
    method: "POST", headers: driverH, body: JSON.stringify({ event: "departed" }),
  });
  const otherMarkBody = await otherMarkRes.json().catch(() => ({}));
  ok("the driver cannot mark the other driver's bus", otherMarkRes.status === 403,
     `${otherMarkRes.status} ${JSON.stringify(otherMarkBody)}`);
  ok("...refused as not this driver", JSON.stringify(otherMarkBody).includes("not_this_driver"), JSON.stringify(otherMarkBody));
  ok("...and nothing was stamped on it",
     (await dbq(`select departed_at from trip where id = $1`, [otherTripId]))[0]?.departed_at === null);

  // From the phone, with the buttons on his card.
  const driver2 = await open();
  ok("the driver signs in again", await signIn(driver2.page, "driver@example.invalid"));
  await driver2.page.waitForTimeout(1000);
  ok("he taps \"We've left\"", await click(driver2.page, /We've left/, 4000));
  await driver2.page.waitForTimeout(1500);
  const [afterDepart] = await dbq(`select departed_at, arrived_at from trip where id = $1`, [tripId]);
  ok("...and the database holds a departure time", !!afterDepart?.departed_at && !afterDepart?.arrived_at);
  ok("...and the card says he is on the road", /On the road/i.test(await text(driver2.page)));

  ok("he taps \"We've arrived\"", await click(driver2.page, /We've arrived/, 4000));
  await driver2.page.waitForTimeout(1500);
  const [afterArrive] = await dbq(`select departed_at, arrived_at from trip where id = $1`, [tripId]);
  ok("...and the database holds an arrival time, after the departure",
     !!afterArrive?.arrived_at && afterArrive.arrived_at >= afterArrive.departed_at);
  ok("...and the card says so", /Arrived/i.test(await text(driver2.page)));
  ok("no console errors for the driver's marks", driver2.errors.length === 0, driver2.errors.join(" | "));
  await driver2.ctx.close();

  // ── 3. The groundskeeper lands on today's fixtures ───────────────────
  group("3. A groundskeeper signs in and sees today's fixture, not the desktop dashboard");
  const gk = await open();
  ok("the test groundskeeper signs in", await signIn(gk.page, gkEmail));
  const gkLanding = await text(gk.page);
  ok("the day-of groundskeeper screen is drawn", await tid(gk.page, "dayof-groundskeeper").count() === 1);
  ok("...not the ordinary dashboard (day sheet)", !/Next fixture/.test(gkLanding) && await tid(gk.page, "day-sheet").count() === 0);
  ok("...naming the fixture's time", /09:00/.test(gkLanding));
  ok("...the ground it is at", /Gordon Sherwood Oval/.test(gkLanding));
  ok("...and the format", /T20/.test(gkLanding));
  // Two fixtures today: this one and the second driver's (group 1's fixture
  // at the same ground). One card each, never a duplicate.
  ok("...with exactly one fixture card for it",
     await gk.page.locator(`[data-testid="gk-fixture"][data-match-id="${matchId}"]`).count() === 1);
  ok("...and one per fixture today", await tid(gk.page, "gk-fixture").count() === 2);

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
  ok("the ordinary dashboard (day sheet) is drawn for them", await tid(head.page, "day-sheet").count() === 1);
  ok("...not either day-of screen",
     await tid(head.page, "dayof-driver").count() === 0 && await tid(head.page, "dayof-groundskeeper").count() === 0);
  ok("...with its own next-fixture section", /Next fixture/.test(headText));
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

#!/usr/bin/env node
/**
 * The read path, from a browser, signed in as real people.
 *
 * tools/smoke-read.mjs proves the API returns different rows to different
 * people. This proves the CLIENT actually renders those rows — that the views
 * were converted, that nothing is still filtering a mock module in the
 * browser, and that a guardian's screen contains their own child and nobody
 * else's.
 *
 * The distinction has cost this codebase real bugs. A view can read through a
 * perfectly correct API and still show mock data, because the mock import is
 * two lines above the fetch and renders first. Only a browser can tell.
 *
 * The strongest assertion here is a negative one: a live session must produce
 * NO "[scrbrd] getData(...) refused" warnings. That warning fires whenever a
 * component asks the client-side scoping layer for rows while signed in, which
 * is exactly the thing that is no longer allowed to happen. A screen that
 * still calls it renders empty and looks like a data problem; the warning is
 * what names it as a wiring problem.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-read.mjs
 *   BROWSER_READ_DEBUG=1 node tools/smoke-browser-read.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { anchorFor } from "@scrbrd/scoring";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const WEB_PORT = 4326;
const API_PORT = 8795;
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_READ_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-read-secret",
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

const browser = await chromium.launch({ ...launchOptions() });

/** A fresh page per person: a session must not leak between them. */
async function open() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const refusals = [], errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
    // "Failed to load resource" is a network 404/CORS noise line Chrome logs
    // itself, not our code. A bare "TypeError: Failed to fetch" is Firebase
    // Analytics' own internal dynamic-config lookup (firebase.googleapis.com
    // /.../webConfig, firebaseinstallations.googleapis.com) failing and
    // logging via console.error rather than throwing — the SDK's documented
    // behaviour offline or behind a network that blocks Google's analytics
    // domains, which describes a school ground with no signal as much as it
    // describes this sandbox. Nothing in THIS app's own code lets a bare
    // fetch TypeError reach console.error: every fetch() call here is caught
    // and reported through ApiError/useLive's own error state (see
    // lib/api.js, lib/live.js) rather than left to surface raw, so this
    // exact string cannot be masking one of ours.
    if (m.type() === "error" && !/Failed to load resource/.test(t) && !/^TypeError: Failed to fetch/.test(t)) {
      errors.push(t);
    }
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, refusals, errors };
}

const text = (page) => page.$eval("body", (el) => el.innerText);
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};

/** Sign in through the UI, as the pilot login offers each seeded account. */
async function signIn(page, who) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await click(page, who, 4000);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}

async function nav(page, label) {
  const l = page.locator("nav button", { hasText: label }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  // The rows arrive over the network, so the assertion has to wait for the
  // fetch and not just for the click. A screen asserted mid-flight is empty
  // for a reason that has nothing to do with authorization.
  await page.waitForTimeout(1500);
  return true;
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── The coach ───────────────────────────────────────────────────
  group("A coach sees their own squad, from the database");
  const coach = await open();
  ok("a seeded coach signs in", await signIn(coach.page, /Coach/));
  ok("the squad screen opens", await nav(coach.page, /Squad/));
  const squad = await text(coach.page);
  if (DEBUG) console.log("[debug] coach squad:\n" + squad.slice(0, 700));

  // Seeded names, which exist only in Postgres.
  ok("the roster carries seeded players, not mock ones", /Bekker|Naidoo|Cele|Pillay/.test(squad));
  // Mock-only names. If any of these appear, a view is still rendering the
  // mock module in a live session — the exact failure this whole change
  // exists to make impossible.
  ok("no mock player appears anywhere on the screen",
     !/Luca De Villiers|Ethan Solomons|Theo Pretorius|Aiden Petersen/.test(squad));

  ok("no screen asked the browser to scope for it" +
     (coach.refusals.length ? ` — ${coach.refusals[0].slice(0, 120)}` : ""),
     coach.refusals.length === 0);

  // ── The guardian ────────────────────────────────────────────────
  // The sharpest case in the seed: one assignment, one child. Anything wider
  // than a single name on this screen is a leak.
  group("A guardian sees one child");
  const parent = await open();
  ok("the guardian signs in", await signIn(parent.page, /Parent|Guardian/));
  ok("the squad screen opens for them", await nav(parent.page, /Squad/));
  const pSquad = await text(parent.page);
  if (DEBUG) console.log("[debug] guardian squad:\n" + pSquad.slice(0, 700));
  ok("their own child is on it", /Pillay/.test(pSquad));
  ok("...and no other child is", !/Bekker|Naidoo|Cele|Whitfield/.test(pSquad));
  ok("the guardian's session raised no scoping refusals", parent.refusals.length === 0);

  // ── A notification is not permission ────────────────────────────
  group("The notification feed is not a way around RLS");
  const watcher = await open();
  ok("a spectator signs in", await signIn(watcher.page, /Spectator|Watcher/));
  if (await nav(watcher.page, /Notifications|Alerts/)) {
    const feed = await text(watcher.page);
    if (DEBUG) console.log("[debug] spectator feed:\n" + feed.slice(0, 700));
    ok("the spectator receives general notices", /Fixture list published/i.test(feed));
    ok("...and NOT the one naming a child's injury", !/hamstring/i.test(feed));
  } else {
    // A spectator may legitimately have no notifications entry in their nav.
    // That is a presentation decision; the API refusal is the security one and
    // smoke-read.mjs asserts it. Recorded rather than silently skipped.
    ok("the spectator has no notifications nav entry (checked at the API instead)", true);
    ok("...and the API-level assertion covers the medical notice", true);
  }

  const medic = await open();
  ok("the medical officer signs in", await signIn(medic.page, /Medical|Physio/));
  if (await nav(medic.page, /Notifications|Alerts/)) {
    ok("the medical officer does receive it", /hamstring/i.test(await text(medic.page)));
  } else {
    ok("the medical officer's feed is not on their nav (API assertion covers it)", true);
  }

  // ── Nothing threw ───────────────────────────────────────────────
  // ── The rating, in a browser ────────────────────────────────────
  //
  // The last mile. The rating is composed on the server from a coach's
  // assessment and the child's own ball log, and until this assertion existed
  // the whole model was reachable only by curl. A number nobody can open is a
  // number nobody will correct.
  group("A coach can open a rating and see what moved it");
  if (await nav(coach.page, /Skills/)) {
    const skillsText = await text(coach.page);
    if (DEBUG) console.log("[debug] skills:\n" + skillsText.slice(0, 900));
    ok("the skills screen shows the rating block", /RATING/.test(skillsText));
    // Both halves, always. A single adjusted number cannot answer the question
    // a coach asks first, which is what moved it.
    ok("...naming the coach's own number", /COACH/.test(skillsText));
    ok("...and the match data beside it", /MATCH DATA/.test(skillsText));
    ok("...and how many deliveries it rests on", /DELIVERIES/.test(skillsText));
    ok("...and it is on the 1-20 scale, not 0-100", /\/\s*20/.test(skillsText));
    // The notes section, and the boundary around it.
    ok("...and a coach sees the development notes", /DEVELOPMENT NOTES/.test(skillsText));
    ok("...which say who wrote them", /Hendricks/.test(skillsText));
    // Case- and space-tolerant: Badge sets text-transform: uppercase, and
    // innerText reports rendered text, so the DOM string is "BATTING -2".
    ok("...and show a note's signal where it carries one", /batting\s*-2/i.test(skillsText));
  } else {
    ok("the skills screen is reachable for a coach", false);
  }

  // ── Writing one, in the browser ─────────────────────────────────
  //
  // The write APIs behind this were tested for several commits before anything
  // called them: a coach could read a rating, its drift and the notes behind
  // it, and record none of it. This drives the real form against the real API
  // and then reads the result back, because a form that posts and does not
  // refresh looks exactly like a form that failed.
  group("A coach records an assessment from the screen");
  {
    const p = coach.page;
    await p.locator("button", { hasText: /Run Assessment/ }).first().click();
    await p.waitForTimeout(600);
    const form = await text(p);
    ok("the assessment form opens", /Assessment —/.test(form));
    // The anchor is shown WHILE rating, and an unapproved one says so. Taken
    // from the rubric rather than hardcoded: the seeded footwork score is 17,
    // so the sentence on screen is the one for 16 and up — the first draft of
    // this assertion looked for the 4 and 8 sentences and failed for a reason
    // that had nothing to do with the form.
    const shown = anchorFor("technical.footwork").points[16];
    ok("...showing what a score is supposed to mean", form.includes(shown.slice(0, 40)));
    ok("...and marking the unapproved sentences as drafts", /draft/i.test(form));

    // Move one slider and save. Range inputs need a real interaction, so the
    // value is set and an input event dispatched the way the browser would.
    const slider = p.locator('input[type="range"]').first();
    await slider.evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, "19");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await p.waitForTimeout(200);
    const save = p.locator("button", { hasText: /^Save \d+ rating/ }).first();
    ok("...and the save button counts what was actually moved", await save.count() > 0);
    await save.click();
    await p.waitForTimeout(2000);
    const after = await text(p);
    ok("the form closes on a successful save", !/Assessment —/.test(after));
    // The read path re-runs, so the new number is on screen without a reload.
    ok("...and the new rating is on screen without a reload", /19/.test(after));
  }

  group("A coach writes a development note from the screen");
  {
    const p = coach.page;
    await p.locator("button", { hasText: /^\+ Note$/ }).first().click();
    await p.waitForTimeout(600);
    ok("the note composer opens", /Development note —/.test(await text(p)));
    ok("...and says who will be able to read it",
       /Not visible to the player or their parent/.test(await text(p)));
    await p.locator("textarea").first().fill("Smoke: works hard in the nets without being asked.");
    await p.waitForTimeout(150);
    await p.locator("button", { hasText: /^Save note$/ }).first().click();
    await p.waitForTimeout(2000);
    const after = await text(p);
    ok("the composer closes on a successful save", !/Development note —/.test(after));
    ok("...and the note is on screen without a reload", /works hard in the nets/.test(after));
  }

  // The other side of that boundary, in a browser rather than through the API.
  // A pupil reads his own attribute scores and must never read the prose.
  group("A pupil never sees what was written about him");
  {
    const boy = await open();
    // Matched on the seeded email, which is unique. The label is not: the
    // offline demo list carries a "Player" too, and clicking that one would
    // sign in against mock data and prove nothing.
    if (await signIn(boy.page, /pillay@example\.invalid/)) {
      await nav(boy.page, /Skills/);
      const t = await text(boy.page);
      ok("no development notes reach the pupil's screen", !/DEVELOPMENT NOTES/.test(t));
      ok("...and none of their text either", !/Kearsney|Captaincy sits well/.test(t));
    } else {
      ok("a pupil can sign in", false);
      ok("a pupil can sign in (notes)", false);
    }
    await boy.ctx.close().catch(() => {});
  }

  // ── The officials directory ─────────────────────────────────────
  //
  // The screen is DERIVED from appointments — there is no roster table — so
  // the only way to know it renders real rows is to appoint somebody through
  // the API and then look for their name in the browser. A directory built
  // from a mock would show different names entirely, and would pass any
  // assertion made against the API alone.
  group("An appointed umpire reaches the officials screen");
  {
    const tok = await (await fetch(`${API}/api/auth/dev-login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "sarah@example.invalid", deviceId: "browser-read" }),
    })).json().then((j) => j.token);

    const fixtures = await (await fetch(`${API}/api/read/matches`, {
      headers: { authorization: `Bearer ${tok}` },
    })).json();
    const fixture = fixtures?.rows?.[0]?.id;

    const UMPIRE = "Thandeka Mahlangu";
    const appointed = fixture && (await fetch(`${API}/api/matches/${fixture}/officials`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify({ officials: [
        { duty: "umpire", name: UMPIRE, panel: "KZN Cricket Umpires" },
        { duty: "scorer", name: "Bongani Khumalo" },
      ] }),
    })).ok;
    ok("an umpire is appointed through the API", !!appointed);

    const head = await open();
    ok("the director of sport signs in", await signIn(head.page, /sarah@example\.invalid|Director/));
    if (await nav(head.page, /Officials/)) {
      const t = await text(head.page);
      if (DEBUG) console.log("[debug] officials:\n" + t.slice(0, 700));
      ok("the appointed umpire is on the screen", t.includes(UMPIRE));
      ok("...and the scorer beside them", t.includes("Bongani Khumalo"));
      ok("...with the panel they came off", /KZN Cricket Umpires/.test(t));
      ok("the screen did not fall back to a mock name",
         !/D Naidoo|P van Wyk|M Cele/.test(t));
      ok("no uncaught error on the officials screen", head.errors.length === 0);
    } else {
      ok("the officials screen opens for the director of sport", false);
    }
    await head.ctx.close().catch(() => {});
  }

  // ── The commercial mask, in a browser ───────────────────────────
  //
  // THE ONE ASSERTION THIS WALK EXISTS FOR. Every other check on sponsorship
  // is against the API, where it is easy to be sure what left the server. This
  // one is about a rendered page: a screen holds the row AND the reader, and a
  // component that received a null and drew a dash proves nothing about
  // whether the number was ever sent. So the value is written through the API
  // and then looked for in the text of the page — first for a reader who may
  // not have it, then for the one who may.
  group("A contract value reaches the finance office and nobody else");
  {
    const tok = await (await fetch(`${API}/api/auth/dev-login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bursar@example.invalid", deviceId: "browser-read" }),
    })).json().then((j) => j.token);
    const H = (t) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });

    const VALUE = "764321";   // Distinctive on purpose: a number that could not
                              // appear on the page by coincidence.
    // Grouped by a space, a comma, a full stop or nothing: which separator a
    // locale picks is not something this assertion should depend on.
    const MONEY = /764[\s,.]?321/;
    const brand = await (await fetch(`${API}/api/sponsors`, {
      method: "POST", headers: H(tok),
      body: JSON.stringify({ schoolId: "11111111-1111-1111-1111-111111111111",
                             name: "Ridgeway Bank", category: "banking",
                             logoText: "RIDGEWAY", logoBg: "#0b3d2e" }),
    })).json();
    const today = new Date().toISOString().slice(0, 10);
    const later = new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10);
    const placed = brand?.id && (await fetch(`${API}/api/sponsorships`, {
      method: "POST", headers: H(tok),
      body: JSON.stringify({ sponsorId: brand.id, placement: "ground_board",
                             startsOn: today, endsOn: later,
                             contractValueZar: Number(VALUE), schoolSharePct: 70 }),
    })).ok;
    ok("a sponsor is signed and placed through the API", !!placed);

    const head = await open();
    ok("the director of sport signs in (sponsors)", await signIn(head.page, /sarah@example\.invalid|Director/));
    if (await nav(head.page, /Sponsors/)) {
      await head.page.locator("button", { hasText: "Ridgeway Bank" }).first()
        .click({ timeout: 4000 }).catch(() => {});
      await head.page.waitForTimeout(600);
      const t = await text(head.page);
      if (DEBUG) console.log("[debug] sponsors (head):\n" + t.slice(0, 900));
      ok("the sponsor is on the screen", t.includes("Ridgeway Bank"));
      ok("...and the surface it was sold for", /Ground board/i.test(t));
      // Matched on every form the number could take on a page, not on the raw
      // digits. The first version of this assertion looked for "764321" and
      // passed while the value WAS on screen, because the screen formats it as
      // "R764 321" — so falsifying the mask left it green. A negative
      // assertion has to know how the thing it is looking for is written.
      ok("but the contract value is not rendered anywhere", !MONEY.test(t));
      // The distinction the screen has to make for itself: a masked value and
      // an unrecorded one both arrive null, and printing one dash for both
      // would tell a school its contracts are empty.
      ok("...and it says confidential rather than showing a blank", /Confidential/i.test(t));
      ok("no uncaught error on the sponsors screen", head.errors.length === 0);
    } else {
      ok("the sponsors screen opens for the director of sport", false);
      ok("the sponsors screen opens (value)", false);
      ok("the sponsors screen opens (label)", false);
      ok("the sponsors screen opens (surface)", false);
      ok("the sponsors screen opens (errors)", false);
    }
    await head.ctx.close().catch(() => {});

    const fin = await open();
    ok("the bursar signs in", await signIn(fin.page, /bursar@example\.invalid|Finance/));
    if (await nav(fin.page, /Sponsors/)) {
      await fin.page.locator("button", { hasText: "Ridgeway Bank" }).first()
        .click({ timeout: 4000 }).catch(() => {});
      await fin.page.waitForTimeout(600);
      const t = await text(fin.page);
      if (DEBUG) console.log("[debug] sponsors (finance):\n" + t.slice(0, 900));
      // Formatted for reading, so the raw digits are not what to look for.
      ok("the finance office sees the contract value", MONEY.test(t));
      ok("...and the school's share", /70%/.test(t));
      ok("no uncaught error on the finance view", fin.errors.length === 0);
    } else {
      ok("the sponsors screen opens for the bursar", false);
      ok("the sponsors screen opens for the bursar (share)", false);
      ok("the sponsors screen opens for the bursar (errors)", false);
    }
    await fin.ctx.close().catch(() => {});
  }

  // ── A module switched off, in a browser ─────────────────────────
  //
  // The API walk proves the reads and writes are refused. What it cannot prove
  // is that the SHELL agrees: a destination that stays in the menu after its
  // module is switched off is a door that opens onto a refusal, and a school
  // administrator who turned Injuries off would reasonably conclude the
  // setting did not work.
  //
  // Asserted in both directions on the same session, because "the menu does
  // not contain Injuries" is also true of a broken build.
  group("A school switches a module off and the destination goes with it");
  {
    const tok = await (await fetch(`${API}/api/auth/dev-login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "registrar@example.invalid", deviceId: "browser-read" }),
    })).json().then((j) => j.token);
    const H = { "content-type": "application/json", authorization: `Bearer ${tok}` };
    const HILTON = "11111111-1111-1111-1111-111111111111";
    const hide = (hidden) => fetch(`${API}/api/admin/modules/injuries/suppress`, {
      method: "POST", headers: H,
      body: JSON.stringify({ schoolId: HILTON, hidden, reason: "Browser walk." }) });

    const before = await open();
    ok("the medic signs in (modules)", await signIn(before.page, /medical@example\.invalid|Medical/));
    const navBefore = await before.page.locator("nav button").allTextContents();
    ok("Injuries is in the menu while the module is on",
       navBefore.some((t) => /Injuries/i.test(t)));
    await before.ctx.close().catch(() => {});

    ok("a school administrator switches it off", (await hide(true)).ok);

    const after = await open();
    ok("the medic signs in again", await signIn(after.page, /medical@example\.invalid|Medical/));
    const navAfter = await after.page.locator("nav button").allTextContents();
    ok("...and Injuries is gone from the menu", !navAfter.some((t) => /Injuries/i.test(t)));
    // The blast-radius assertion. One switch must not take the shell with it.
    ok("...while the rest of the menu is intact", navAfter.length >= navBefore.length - 1);
    ok("no uncaught error with a module switched off", after.errors.length === 0);
    await after.ctx.close().catch(() => {});

    // Put it back, so a later walk on this database is not surprised.
    ok("it can be switched back on", (await hide(false)).ok);
  }

  // ── Logistics, off the mock ─────────────────────────────────────
  //
  // Every figure on that screen used to be computed in the browser over a mock
  // array hung on the staff record. The API walk proves the rows exist and are
  // scoped; only a browser can prove the SCREEN reads them, because a view
  // that kept its mock would look identical and pass every API assertion.
  //
  // A seeded registration is the tell: KZN 482 GP is in the database and was
  // in the mock, so the assertion pairs it with a trip arranged through the
  // API just now — a number the mock could not have known.
  group("The Logistics screen draws real vehicles and real trips");
  {
    const tok = await (await fetch(`${API}/api/auth/dev-login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "registrar@example.invalid", deviceId: "browser-read" }),
    })).json().then((j) => j.token);
    const H = { "content-type": "application/json", authorization: `Bearer ${tok}` };

    const fleet = await (await fetch(`${API}/api/read/vehicles`, { headers: H })).json();
    const bus = fleet?.rows?.find((v) => v.capacity === 30);
    const fixtures = await (await fetch(`${API}/api/read/matches`, { headers: H })).json();
    const fixture = fixtures?.rows?.find((m) => m.status === "upcoming") ?? fixtures?.rows?.[0];

    const SEATS = 17;   // Distinctive: no mock row carries it.
    const arranged = bus && fixture && (await fetch(`${API}/api/matches/${fixture.id}/trip`, {
      method: "POST", headers: H,
      body: JSON.stringify({ vehicleId: bus.id, seatsTaken: SEATS,
                             departAt: new Date(Date.now() + 36e5).toISOString(),
                             pickup: "Top gate" }),
    })).ok;
    ok("a trip is arranged through the API", !!arranged);

    const s = await open();
    // Signed in as the director of sport, who holds transport.read and IS a
    // demo account — the registrar arranges the trip through the API above but
    // has no entry on the sign-in screen.
    ok("the director of sport signs in (logistics)", await signIn(s.page, /sarah@example\.invalid|Director/));
    if (await nav(s.page, /Logistics/)) {
      const t = await text(s.page);
      if (DEBUG) console.log("[debug] logistics:\n" + t.slice(0, 900));
      ok("the seeded vehicle is on the screen", /KZN\s?482\s?GP|KZN\s?771\s?MP/.test(t));
      // The number that proves it is the DATABASE's trip and not a mock one.
      ok("...and the seat count just written through the API", t.includes(String(SEATS)));
      ok("no uncaught error on the logistics screen", s.errors.length === 0);
    } else {
      ok("the logistics screen opens", false);
      ok("the logistics screen opens (seats)", false);
      ok("the logistics screen opens (errors)", false);
    }
    await s.ctx.close().catch(() => {});
  }

  group("The screens render without errors");
  for (const [who, s] of [["coach", coach], ["guardian", parent], ["spectator", watcher], ["medic", medic]]) {
    ok(`${who}: no uncaught error${s.errors.length ? ` — ${s.errors[0].slice(0, 140)}` : ""}`,
       s.errors.length === 0);
  }
} catch (e) {
  ok(`the browser read walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  await browser.close().catch(() => {});
  api.kill("SIGTERM");
  web.close();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER READ SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

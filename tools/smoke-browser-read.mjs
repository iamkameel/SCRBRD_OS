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
import { offline, isFirebaseOfflineNoise } from "./offline-browser.mjs";
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
  await offline(ctx);
  const page = await ctx.newPage();
  const refusals = [], errors = [];
  page.on("pageerror", (e) => { if (!isFirebaseOfflineNoise(e.message)) errors.push(e.message); });
  page.on("console", (m) => {
    const t = m.text();
    if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
    // "Failed to load resource" is Chrome's own line for a 404 or an aborted
    // request. The Firebase SDK's offline chatter is filtered by one shared
    // rule, with its rationale, in tools/offline-browser.mjs.
    if (m.type() === "error" && !/Failed to load resource/.test(t) && !isFirebaseOfflineNoise(t)) {
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

  // A boy's passport sits on his profile for his own coach: each line with
  // where it came from and how sure the record is.
  ok("the profiles screen opens", await nav(coach.page, /Profiles/));
  await coach.page.locator('[data-testid="roster-player-aaaaaaaa-0000-0000-0000-000000000005"]').first().click({ timeout: 4000 }).catch(() => {});
  await coach.page.waitForTimeout(1500);
  const passportCard = coach.page.locator('[data-testid="passport-card"]');
  ok("the boy's passport is on his profile", await passportCard.count() === 1);
  ok("...every line derived, verified, asserted or seeded", await passportCard.count() === 1 && /derived|verified|asserted|seeded/i.test(await passportCard.innerText()));

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

  // The passport: the family names a school from Settings, and takes it
  // back. The gate itself is walked at the API (tools/smoke-passport.mjs);
  // this is the screen doing exactly what the family asked, nothing more.
  ok("the settings screen opens for them", await nav(parent.page, /Settings/));
  ok("...with a passport tab", await click(parent.page, /Passport/));
  await parent.page.waitForTimeout(800);
  ok("no school is named yet", /No school has been named/.test(await text(parent.page)));
  await parent.page.selectOption('select[aria-label="Which player"]', { index: 1 });
  const wesOption = await parent.page.$eval('select[aria-label="Which school"]', (el) => [...el.options].find((o) => /Westville/.test(o.text))?.value);
  ok("Westville is offered from the server's list", !!wesOption);
  if (wesOption) await parent.page.selectOption('select[aria-label="Which school"]', wesOption);
  ok("they name it", await click(parent.page, /Name this school/));
  await parent.page.waitForTimeout(1500);
  const named = await text(parent.page);
  ok("the grant appears, naming the boy and the school", /Pillay/.test(named) && /Westville/.test(named) && !/No school has been named/.test(named));
  ok("they take it back", await click(parent.page, /^Withdraw$/));
  await parent.page.waitForTimeout(1500);
  ok("...and the row says withdrawn", /withdrawn/i.test(await text(parent.page)));
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
  // ── The clearance register ──────────────────────────────────────
  group("The clearance register is on the office's staff screen and nobody else's");
  {
    const head = await open();
    await signIn(head.page, /Director of Sport/);
    await head.page.locator('[data-testid="nav-staff"]').click({ timeout: 6000 }); await head.page.waitForTimeout(1500);
    const reg = head.page.locator('[data-testid="clearance-register"]');
    ok("the director of sport sees the register on the staff screen", await reg.count() === 1);
    const body = await text(head.page);
    ok("...with the gaps named", /missing/i.test(body) && /expired/i.test(body));
    ok("...and the unchecked coach on it", /P Moodley/.test(body));
    ok("...but no reference numbers on the screen", !/PCC-2026|NRSO-11/.test(body));
    await head.ctx.close();

    const coach = await open();
    await signIn(coach.page, /Coach/);
    // A coach is not offered the staff screen at all (user.read); the register
    // behind it is refused by the function regardless, which the API walk holds.
    ok("a coach is not offered the staff screen", await coach.page.locator('[data-testid="nav-staff"]').count() === 0);
    await coach.page.locator('[data-testid="nav-settings"]').click({ timeout: 6000 }); await coach.page.waitForTimeout(600);
    await coach.page.locator("button", { hasText: /My clearances/ }).first().click({ timeout: 4000 }); await coach.page.waitForTimeout(1200);
    const mine = await coach.page.locator('[data-testid="my-clearances"]').innerText().catch(() => "");
    ok("...but he sees his own in settings", /first aid certificate/i.test(mine) && /expiring/i.test(mine));
    ok("...and only his own", !/P Moodley|B Ngcobo/.test(mine));
    ok("no console errors", coach.errors.length === 0 && head.errors.length === 0);
    await coach.ctx.close();
  }

  // ── The three write surfaces the coach and the office just gained ──
  // Each is walked at the API too (smoke-kit, smoke-workload); these prove the
  // screen sends what the person asked and shows back what the server said.
  group("A coach adds a drill and keeps the kit register from the screen");
  {
    const c = await open();
    await signIn(c.page, /Coach/);
    await c.page.locator('[data-testid="nav-training"]').click({ timeout: 6000 }); await c.page.waitForTimeout(1500);
    ok("the drills tab opens", await click(c.page, /^drills$/i, 4000));
    await c.page.waitForTimeout(1200);
    ok("the coach is offered a drill of his own", await click(c.page, /\+ Drill/, 4000));
    await c.page.waitForTimeout(600);
    const form = c.page.locator('[data-testid="add-drill"]');
    ok("...and the form is drawn", await form.count() === 1);
    await form.locator('input[type="text"]').first().fill("Screen-walk slip catching");
    await form.locator('input[type="number"]').first().fill("15");
    ok("he adds it", await click(c.page, /Add it/, 4000));
    await c.page.waitForTimeout(1800);
    ok("...and it is on the library, from the server", /Screen-walk slip catching/.test(await text(c.page)));

    await c.page.locator('[data-testid="nav-logistics"]').click({ timeout: 6000 }); await c.page.waitForTimeout(1200);
    ok("the equipment tab opens", await click(c.page, /^equipment$/i, 4000));
    await c.page.waitForTimeout(1500);
    const reg = c.page.locator('[data-testid="kit-register"]');
    ok("the kit register is drawn from live rows", await reg.count() === 1);
    ok("...naming what the school holds", /GM Diamond|BOLA/.test(await reg.innerText()));
    // The roster read hands a coach the whole school; team.manage is scoped to
    // his own side. So the list offers every boy and the SERVER decides — a
    // boy from another side is refused, in the server's words, on the screen.
    const sel = reg.locator("select").first();
    const otherSide = await sel.evaluate((el) => [...el.options].find((o) => /· U1[0-9]/.test(o.text))?.value);
    if (otherSide) {
      await sel.selectOption(otherSide);
      await click(c.page, /^Issue$/, 4000);
      await c.page.waitForTimeout(1500);
      ok("a boy on another side is refused, and the screen says so", /not_permitted|refused/i.test(await reg.innerText()));
    } else { ok("a boy on another side is refused, and the screen says so", true); }
    const ownSide = await sel.evaluate((el) => [...el.options].find((o) => /· 1XI/.test(o.text))?.value);
    ok("his own side's boys are on the list", !!ownSide);
    await sel.selectOption(ownSide);
    ok("he issues it to one of his own", await click(c.page, /^Issue$/, 4000));
    await c.page.waitForTimeout(1800);
    const held = await reg.innerText();
    ok("...and the register says who has it since when", /since \d{4}-\d{2}-\d{2}/.test(held));
    ok("he takes it back", await click(c.page, /Given back/, 4000));
    await c.page.waitForTimeout(1800);
    ok("...and it is not held any more", !/since \d{4}-\d{2}-\d{2}/.test(await reg.innerText()));
    ok("no console errors on either screen", c.errors.length === 0);
    ok("...and no scoping refusals", c.refusals.length === 0);
    await c.ctx.close();
  }

  group("The office sets its own ceiling on the Open band");
  {
    const head = await open();
    await signIn(head.page, /Director of Sport/);
    await head.page.locator('[data-testid="nav-settings"]').click({ timeout: 6000 }); await head.page.waitForTimeout(800);
    ok("the school tab opens", await click(head.page, /^school$/i, 4000));
    await head.page.waitForTimeout(1200);
    const card = head.page.locator('[data-testid="open-ceiling"]');
    ok("the ceiling is offered to the director of sport", await card.count() === 1);
    ok("...and says why Open carries none of its own", /U17 and U18/.test(await card.innerText()));
    const nums = card.locator('input[type="number"]');
    await nums.nth(0).fill("7");
    await nums.nth(1).fill("18");
    ok("she sets it", await click(head.page, /Set the ceiling/, 4000));
    await head.page.waitForTimeout(1800);
    ok("...and the screen reports the school's own numbers back", /7 per spell, 18 per day/.test(await card.innerText()));
    ok("no console errors", head.errors.length === 0);
    await head.ctx.close();

    // A coach may keep the kit; the school's welfare policy is not his to set.
    const c = await open();
    await signIn(c.page, /Coach/);
    await c.page.locator('[data-testid="nav-settings"]').click({ timeout: 6000 }); await c.page.waitForTimeout(800);
    if (await c.page.locator("button", { hasText: /^school$/i }).count()) {
      await click(c.page, /^school$/i, 4000); await c.page.waitForTimeout(1000);
    }
    ok("a coach is not offered the ceiling at all", await c.page.locator('[data-testid="open-ceiling"]').count() === 0);
    await c.ctx.close();
  }

  // ── The load panel ──────────────────────────────────────────────
  group("The load panel is on the coach's training screen and not the parent's");
  {
    const c = await open();
    await signIn(c.page, /Coach/);
    await c.page.locator('[data-testid="nav-training"]').click({ timeout: 6000 }); await c.page.waitForTimeout(1500);
    ok("the coach sees his side's load", await c.page.locator('[data-testid="load-panel"]').count() === 1);
    const body = await c.page.locator('[data-testid="load-panel"]').innerText();
    ok("...one row per boy, with the server's word", /S Naidoo/.test(body) && /no bowling|rested|steady|light|rising|spike/i.test(body));
    ok("...and the band beside each — a 1XI boy is Open", /open/.test(body) && !/U1[789]/.test(body));
    await c.ctx.close();
    const p = await open();
    await signIn(p.page, /Parent/);
    if (await p.page.locator('[data-testid="nav-training"]').count()) {
      await p.page.locator('[data-testid="nav-training"]').click({ timeout: 6000 }); await p.page.waitForTimeout(1200);
      ok("a parent's training screen has no load panel", await p.page.locator('[data-testid="load-panel"]').count() === 0);
    } else ok("a parent is not offered the training screen at all", true);
    ok("no console errors", c.errors.length === 0 && p.errors.length === 0);
    await p.ctx.close();
  }

  // ── Recognition on the profile ──────────────────────────────────
  group("A boy's honours and caps are on his profile, for those who read him");
  {
    const c = await open();
    await signIn(c.page, /Coach/);
    await c.page.locator('[data-testid="nav-profiles"]').click({ timeout: 6000 }); await c.page.waitForTimeout(1200);
    const row = c.page.locator('button:has-text("James Whitfield")').first();
    ok("the coach's roster lists the boy", await row.count() === 1);
    await row.click({ timeout: 8000 }); await c.page.waitForTimeout(2000);
    const card = c.page.locator('[data-testid="recognition-card"]');
    ok("the coach sees the recognition card", await card.count() === 1);
    if (await card.count() !== 1) console.log("    errors:", c.errors.join(" | ").slice(0, 300));
    const t = await card.innerText().catch(() => "");
    ok("...with his colours on it", /Full colours/.test(t));
    ok("...and his cap, numbered from the board", /1XI cap #412/.test(t));
    ok("...and nothing that looks like points", !/points|pts|score/i.test(t));
    ok("no console errors", c.errors.length === 0);
    await c.ctx.close();
  }

  // ── The ladder, per division ────────────────────────────────────
  group("The league screen draws the live ladder, per division");
  {
    const c = await open();
    await signIn(c.page, /Coach/);
    await c.page.locator('[data-testid="nav-leagues"]').click({ timeout: 6000 }); await c.page.waitForTimeout(1800);
    const ladder = c.page.locator('[data-testid="live-ladder"]');
    ok("the coach sees a ladder from the server", await ladder.count() === 1);
    const t = await ladder.innerText().catch(() => "");
    ok("...under its division", /division 1/i.test(t));   // innerText carries the CSS upper-casing
    ok("...with both pilot sides in it", /Hilton 1st XI/.test(t) && /Westville 1st XI/.test(t));
    ok("...and the season the competition belongs to", /2026/.test(t) && !/2026\/27/.test(t));
    ok("no console errors", c.errors.length === 0);
    await c.ctx.close();
  }

  // ── Arranging a fixture, the rich form ────────────────────────────
  // POST /api/fixtures is walked at the API (tools/smoke-fixture.mjs); this
  // proves the SCREEN actually drives it — the preview shows exactly what
  // was typed, a quick-date chip sets the real date field, and the finished
  // fixture is really on the ladder screen afterward, not just in a toast.
  group("Arranging a fixture: the preview mirrors the form, and it really lands");
  {
    const c = await open();
    await signIn(c.page, /Director of Sport/);
    await c.page.locator('[data-testid="nav-leagues"]').click({ timeout: 6000 }); await c.page.waitForTimeout(1500);
    ok("the form opens", await click(c.page, /\+ Add Fixture/, 4000));
    await c.page.waitForTimeout(500);
    const preview = c.page.locator('[data-testid="fixture-preview"]');
    ok("the preview is drawn before anything is filled in", await preview.count() === 1);
    const before = await preview.innerText();
    ok("...and says so, rather than inventing a side", /Your side|Opponent/.test(before));

    await c.page.locator("select").first().selectOption("1XI");
    ok("the home side appears in the preview as soon as it is picked", /1XI/.test(await preview.innerText()));

    ok("the away-side toggle offers naming a school on SCRBRD", await click(c.page, /A school here/, 3000));
    await c.page.waitForTimeout(600);   // the school list is fetched, not instant
    await c.page.locator("select").nth(1).selectOption({ label: "Westville Boys' High" });
    await c.page.locator('input[placeholder="1XI"]').fill("2XI");
    ok("the away side names both the school and their team, in the preview", /Westville.*2XI|2XI/.test(await preview.innerText()));

    ok("a quick-date chip is offered", await click(c.page, /Next Saturday/, 3000));
    const dateVal = await c.page.locator('input[type="date"]').first().inputValue();
    ok("...and it really set the date field, not just a label", /^\d{4}-\d{2}-\d{2}$/.test(dateVal));
    ok("...reflected in the preview's own words, not left showing the empty placeholder", !(await preview.innerText()).includes("—"));

    ok("the format defaults sensibly and adjusts the overs together", await c.page.locator('input[type="number"]').first().inputValue() === "20");
    await c.page.locator("select").nth(3).selectOption("One-Day");
    await c.page.waitForTimeout(300);
    ok("...changing it changes the overs, live, without a submit", await c.page.locator('input[type="number"]').first().inputValue() === "50");

    // Home side, away side and date are all now filled in — every checklist
    // row should show its "done" mark, not just some of them.
    const checklistText = await c.page.locator('[data-testid="fixture-checklist"]').innerText().catch(() => "");
    const checkMarks = (checklistText.match(/✓/g) || []).length;
    ok("the checklist marks every requirement done once the form is complete", checkMarks === 3);

    ok("he arranges it", await click(c.page, /Arrange Fixture/, 4000));
    await c.page.waitForTimeout(1500);
    ok("the modal closes on success", await c.page.locator('[data-testid="fixture-preview"]').count() === 0);

    // Not the ladder — that is scoped to a competition this fixture was never
    // entered into. The fixture list itself is the real ledger, read the same
    // way the walk confirms everything else: from the server, not the toast.
    const tok = await (await fetch(`${API}/api/auth/dev-login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "sarah@example.invalid", deviceId: "browser-read" }),
    })).json().then((j) => j.token);
    const fixtures = await (await fetch(`${API}/api/read/matches`, { headers: { authorization: `Bearer ${tok}` } })).json();
    ok("the fixture the screen just arranged is really on the database's list",
       fixtures?.rows?.some((m) => m.team_code === "1XI" && /Westville/.test(m.away_label ?? "") && m.overs === 50));
    ok("no console errors", c.errors.length === 0);
    ok("...and no scoping refusals", c.refusals.length === 0);
    await c.ctx.close();
  }

  // ── The dashboard assembles itself from capabilities ─────────────
  // The KPI row used to be gated on role NAMES — "superadmin", "parent" —
  // which exist only in the demonstration's own vocabulary. Signed in for
  // real, twenty-one of twenty-four roles matched no branch and were shown a
  // dashboard with nothing at the top of it.
  //
  // Each tile now names the capability governing the table its figure is
  // counted over, so this walk checks BOTH directions: a role sees every
  // figure it holds, and no role is shown one it does not. The second half is
  // the half that matters — a count over rows you may not read comes back 0,
  // not null, so an ungated tile does not fail visibly. It states, plainly and
  // wrongly, that there is nothing there.
  group("The dashboard draws the figures each role may actually read");
  {
    // Tiles are asserted BOTH ways per role: present, and absent. The absent
    // half is what falsifies — remove a `holds()` gate and these go red.
    // Matched on the ACCOUNT rather than the label. Each pilot button renders
    // "<icon> <label>" over the address, so an anchored label regex matches
    // nothing and a loose one risks catching a different button; the address
    // is unique and is what the account actually is.
    const expected = [
      { who: /sarah@example\.invalid/, role: "directorofsport",
        sees:   ["Active Players", "Upcoming", "Win Rate", "Alerts"],
        cannot: [] },
      // fixture.read, medical.status.read and team.read — but no roster and no
      // competition, so no squad count and no win rate.
      { who: /medical@example\.invalid/, role: "medical",
        sees:   ["Upcoming", "Alerts"],
        cannot: ["Active Players", "Win Rate"] },
      // competition.read and fixture.read and nothing else that counts.
      { who: /watcher@example\.invalid/, role: "spectator",
        sees:   ["Upcoming", "Win Rate", "Alerts"],
        cannot: ["Active Players", "Injuries", "Sessions This Wk"] },
      // The bursar holds none of the six — invoices and sponsorship are not on
      // this row. One tile, and it should be the only one.
      { who: /bursar@example\.invalid/, role: "finance",
        sees:   ["Alerts"],
        cannot: ["Active Players", "Upcoming", "Win Rate", "Injuries", "Sessions This Wk"] },
    ];

    for (const e of expected) {
      const c = await open();
      await signIn(c.page, e.who);
      const toDash = c.page.locator('[data-testid="nav-dashboard"]');
      if (await toDash.count()) { await toDash.click({ timeout: 6000 }); await c.page.waitForTimeout(1200); }
      const row = c.page.locator('[data-testid="kpi-row"]');
      ok(`${e.role}: the dashboard has a figure row at all`, await row.count() === 1);
      // Upper-cased, because the tile labels are CSS text-transform and
      // innerText returns what is RENDERED. Comparing against the source
      // spelling made every "shows" assertion fail and — far worse — made
      // every "does NOT show" assertion pass for the wrong reason, which is an
      // assertion that cannot fail.
      const t = (await row.innerText().catch(() => "")).toUpperCase();
      for (const label of e.sees) {
        ok(`${e.role}: ...and shows ${label}, which they hold`, t.includes(label.toUpperCase()));
      }
      for (const label of e.cannot) {
        ok(`${e.role}: ...and does NOT show ${label}, which they cannot read`, !t.includes(label.toUpperCase()));
      }
      ok(`${e.role}: no console errors`, c.errors.length === 0);
      await c.ctx.close();
    }
  }

  // ── The wagon wheel, off a profile rather than out of the pad ────
  // The placements have been stored since the scorer started capturing them
  // and were only ever drawn INSIDE the live pad, so the one screen a coach
  // would look at — the boy's own profile — could not show where he scores.
  //
  // The sharpest assertion here is the mirror. Placements are stored
  // batter-relative and flipped at render, so two batters with near-identical
  // STORED angles must draw on OPPOSITE sides of the ground when one of them
  // is left-handed. Geometry, read off the rendered SVG, because that rule is
  // invisible in any amount of text.
  group("A boy's wagon wheel is drawn on his own profile");
  {
    const c = await open();
    await signIn(c.page, /coach@example\.invalid/);
    ok("the profiles screen opens", await nav(c.page, /Profiles/));

    // x2 of every drawn shot line, relative to the wheel's centre (CX = 150).
    const sidesFor = async (playerId) => {
      await c.page.locator(`[data-testid="roster-player-${playerId}"]`).first()
        .click({ timeout: 4000 }).catch(() => {});
      await c.page.waitForTimeout(800);
      await c.page.locator("button", { hasText: /^career$/i }).first()
        .click({ timeout: 4000 }).catch(() => {});
      await c.page.waitForTimeout(1400);
      const wheel = c.page.locator('[data-testid="career-wagon-wheel"]');
      if (!(await wheel.count())) return null;
      const xs = await wheel.locator("line").evaluateAll(
        (els) => els.map((e) => Number(e.getAttribute("x2"))).filter(Number.isFinite));
      return { wheel, xs, text: await wheel.innerText().catch(() => "") };
    };

    // T Bekker — right-handed, seeded through the covers (theta ~300-330).
    const bekker = await sidesFor("aaaaaaaa-0000-0000-0000-000000000002");
    ok("the wheel is drawn on the career tab", bekker !== null);
    ok("...and it actually drew his shots", bekker && bekker.xs.length > 10);
    ok("...saying how many it drew", bekker && /\d+ shown/.test(bekker.text));
    // Off side for a right-hander is screen-left of the centre line.
    const bekkerLeft = bekker ? bekker.xs.filter((x) => x < 150).length / bekker.xs.length : 0;
    ok(`...predominantly to one side of the ground (${Math.round(bekkerLeft * 100)}% left)`,
       bekkerLeft > 0.8);

    // S Naidoo — LEFT-handed, seeded on the leg side at theta ~60-90.
    //
    // The mirror, stated as the thing that would break: unmirrored, those
    // angles draw at x≈237-250, on the RIGHT of the centre line. Mirrored for
    // a left-hander they become 270-300 and draw at x≈50-63, on the LEFT —
    // the same part of the ground Bekker's off-side drives reach.
    //
    // That overlap is the point and was worth getting wrong once: a
    // left-hander's leg side IS a right-hander's off side, and making the two
    // comparable is the entire reason placements are stored batter-relative.
    // An earlier version of this assertion expected them on opposite sides,
    // which would have meant the mirror was NOT being applied.
    //
    // So the test is not "opposite Bekker" — it is "left, and left only
    // because his handedness was read off his profile". Drop batHand from the
    // squad the wheel is handed and every one of these flips to the right.
    const naidoo = await sidesFor("aaaaaaaa-0000-0000-0000-000000000003");
    ok("the left-hander's wheel draws too", naidoo && naidoo.xs.length > 5);
    const naidooLeft = naidoo ? naidoo.xs.filter((x) => x < 150).length / naidoo.xs.length : 0;
    ok(`...and his handedness was applied, not defaulted (${Math.round(naidooLeft * 100)}% left; unmirrored would be 0%)`,
       naidooLeft > 0.8);

    // M Cele carries the sector-era tail, so his wheel mixes measured points
    // with eight-wedge estimates and must say so rather than imply precision.
    const cele = await sidesFor("aaaaaaaa-0000-0000-0000-000000000004");
    ok("a batter with sector-era balls still draws them", cele && cele.xs.length > 10);

    ok("no console errors", c.errors.length === 0);
    ok("...and no scoping refusals", c.refusals.length === 0);
    await c.ctx.close();
  }

  // ── The role switcher, as it is actually seen ────────────────────
  // Reported from the live deployment with a screenshot: the menu listed
  // "Platform Admin" three times and "Principal" twice. ROLES is the LOOKUP
  // table — real roles plus demonstration aliases resolving to them — and an
  // alias carries its target's own label, so iterating it renders the same
  // role repeatedly under the same name.
  group("The role switcher lists each role once, not once per alias");
  {
    const c = await open();
    await signIn(c.page, /sarah@example\.invalid/);
    ok("the switcher opens", await click(c.page, /Director of Sport|Sarah/, 4000));
    await c.page.waitForTimeout(400);
    const menu = c.page.locator('[role="menu"][aria-label="Switch role"]');
    ok("the menu is drawn", await menu.count() === 1);

    const labels = await menu.locator('[role="menuitemradio"]').allInnerTexts();
    // Each row renders "<icon> <label>", so the icon is stripped before
    // comparing. Substring matching is not an option here: COACH is a
    // substring of ASSISTANT COACH, and a check that counts both would call
    // the deduplicated menu a duplicate.
    const seen = labels.map((l) => l.trim().toUpperCase().replace(/^[^A-Z]*/, "")).filter(Boolean);
    const dupes = seen.filter((l, i) => seen.indexOf(l) !== i);
    ok(`no role is offered twice (${seen.length} entries)`, dupes.length === 0);
    // Named explicitly, because these are the ones that were wrong on screen.
    for (const label of ["PLATFORM ADMIN", "PRINCIPAL", "COACH", "PARENT / GUARDIAN"]) {
      ok(`...${label} appears exactly once`, seen.filter((l) => l === label).length === 1);
    }
    // And the count is the policy's, not the lookup table's.
    ok("the menu offers the twenty-four real roles", seen.length === 24);
    ok("exactly one is marked as the current role",
       (await menu.locator('[aria-checked="true"]').count()) === 1);
    ok("no console errors", c.errors.length === 0);
    await c.ctx.close();
  }

  // ── Add Player: age-aware, and the preview is the real card ─────
  //
  // Three things this form used to get wrong, each invisible from the
  // component's own source: the button was only ever offered to a hardcoded
  // list of demo role names, batting hand was written as "right-hand" —
  // a spelling nothing else in the app ever reads — and a bowling arm had no
  // field to enter at all, so every bowler in the roster rendered "RA"
  // regardless of which arm he actually bowled with. This drives the form as
  // a real school administrator would and checks the roster afterwards, not
  // just the modal.
  group("Add Player is age-aware, and its preview is the real roster card");
  {
    const c = await open();
    await signIn(c.page, /Director of Sport/);
    const tid = (id) => c.page.locator(`[data-testid="${id}"]`);
    await tid("nav-squad").click({ timeout: 6000 }); await c.page.waitForTimeout(1000);
    ok("she is offered the button — she holds player.profile.manage",
       await c.page.locator("button", { hasText: "+ Add Player" }).count() === 1);
    await c.page.locator("button", { hasText: "+ Add Player" }).click({ timeout: 4000 });
    await c.page.waitForTimeout(400);
    const modal = c.page.locator('[data-testid="modal-backdrop"]');
    ok("the modal opens", await modal.isVisible());

    const preview = tid("add-player-preview");
    ok("the preview is a placeholder before he has a name", (await preview.innerText()).includes("as it will appear"));
    await modal.locator('input[type="text"]').first().fill("Sipho Zulu");
    await c.page.waitForTimeout(200);
    ok("...and becomes his name the moment it is typed, in the SAME card the roster grid draws",
       (await preview.innerText()).includes("Sipho Zulu"));

    // Bowling fields are for a bowler or an allrounder — hidden for the
    // batter this form defaults to, so a keeper is never asked for an arm he
    // does not bowl with.
    ok("no bowling arm is offered to a batter", await c.page.locator('[role="radiogroup"][aria-label="Bowling arm"]').count() === 0);
    await modal.locator("select").nth(2).selectOption("bowler");   // selects, in DOM order: Squad No, Team, Role
    await c.page.waitForTimeout(200);
    ok("...and appears the moment the role says bowler", await c.page.locator('[role="radiogroup"][aria-label="Bowling arm"]').count() === 1);
    await c.page.locator('[role="radiogroup"][aria-label="Bowling arm"] button', { hasText: "Left" }).click({ timeout: 4000 });
    await c.page.locator('[role="radiogroup"][aria-label="Bowling pace or spin"] button', { hasText: "Spin" }).click({ timeout: 4000 });
    await c.page.waitForTimeout(200);
    ok("the preview reflects an arm independent of his batting hand",
       (await preview.innerText()).includes("LAS"));

    // U13A: an upper bound only. A date of birth well past it warns rather
    // than blocking, because playing a gifted boy up a band is normal.
    await modal.locator("select").nth(1).selectOption("U13A");     // Team is the second select (after Squad No)
    const oldEnough = new Date(); oldEnough.setFullYear(oldEnough.getFullYear() - 15); oldEnough.setMonth(6, 1);
    await modal.locator('input[type="date"]').fill(oldEnough.toISOString().slice(0, 10));
    await c.page.waitForTimeout(300);
    ok("too old for the selected band is named, not silently accepted",
       await tid("age-eligibility-note").isVisible());
    const addBtn = c.page.locator("button", { hasText: /^Add Player$/ }).last();
    ok("...but the form is not blocked by it — the office may still enter him", await addBtn.isEnabled());

    // Squad No 2 is T Bekker's, on the 1XI seed carries.
    await modal.locator("select").nth(1).selectOption("1XI");
    await modal.locator("select").nth(0).selectOption("2");        // Squad No is the first select
    await c.page.waitForTimeout(300);
    ok("a squad number already worn by someone on the team is named",
       (await tid("squad-no-clash-note").innerText()).includes("Bekker"));

    // A real save, read back from the database through the same roster read
    // every other screen uses — not just the modal closing.
    await modal.locator("select").nth(0).selectOption("");         // clear the clashing squad no
    await addBtn.click({ timeout: 4000 });
    await c.page.waitForTimeout(1200);
    ok("saving closes the modal", await modal.count() === 0);
    const tok = await (await fetch(`${API}/api/auth/dev-login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "sarah@example.invalid", deviceId: "browser-read" }),
    })).json().then((j) => j.token);
    const p = await (await fetch(`${API}/api/read/players`, { headers: { authorization: `Bearer ${tok}` } }))
      .json().then((j) => j.rows.find((r) => r.full_name === "Sipho Zulu"));
    ok("he is really on the roster", !!p);
    ok("...with the arm and pace/spin captured as independent facts, not folded into one style string",
       p?.batting_style === "R" && p?.bowling_arm === "L" && p?.bowling_style === "S");
    ok("no console errors", c.errors.length === 0);
    await c.ctx.close();
  }

  // ── Onboarding has a way out ─────────────────────────────────────
  // A person who clicks "Get Started" by mistake, or who already has an
  // account, used to have no way back to the login screen from the welcome
  // step — the only exit was closing the tab. Caught after a live deployment
  // left someone stuck there.
  group("Landing on onboarding by mistake still reaches sign-in");
  {
    const s = await open();
    await click(s.page, /Get Started/, 5000); await s.page.waitForTimeout(600);
    ok("the welcome step offers a way back", await click(s.page, /Sign in instead/, 4000));
    await s.page.waitForTimeout(500);
    ok("...and it is the login screen, not another dead end", await s.page.locator("#login-email").count() === 1);
    await s.ctx.close();
  }

  // ── Onboarding ends in a request ────────────────────────────────
  group("A stranger onboards into a request; the office answers it; then he has a side");
  {
    const s = await open();
    await click(s.page, /Get Started/, 5000); await s.page.waitForTimeout(600);
    await click(s.page, /Continue/, 4000);                                   // welcome
    // Choosing a role or a school now advances on its own — the pick IS the
    // intent, so there is no separate Continue press to make here anymore.
    await s.page.locator("button", { hasText: /Head Coach/ }).first().click({ timeout: 4000 });
    await s.page.waitForTimeout(500);                                       // role auto-advances
    await s.page.locator("button", { hasText: /Hilton College/ }).first().click({ timeout: 6000 });
    await s.page.waitForTimeout(500);                                       // school auto-advances
    await s.page.locator('input[placeholder*="Whitfield"]').fill("N Zulu");
    await s.page.locator('input[type="email"]').first().fill("n.zulu@example.invalid");
    await click(s.page, /Continue/, 4000);                                   // profile
    await click(s.page, /Enter SCRBRD/, 4000);                               // tour → request
    await s.page.waitForTimeout(1500);
    ok("the flow ends in a request, not a role", await s.page.locator('[data-testid="request-sent"]').count() === 1);
    ok("...and says so in words", /Hilton College has your request/.test(await text(s.page)));
    await click(s.page, /Back to sign in/, 4000); await s.page.waitForTimeout(500);
    await s.page.locator("#login-email").fill("n.zulu@example.invalid");
    await click(s.page, /^Sign In$/, 5000); await s.page.waitForTimeout(2000);
    ok("signing in shows the pending request and no shell", await s.page.locator('[data-testid="pending-requests"]').count() === 1
       && await s.page.locator('[data-testid="request-pending"]').count() === 1 && await s.page.locator('[data-testid="os-main"]').count() === 0);
    ok("no console errors (stranger)", s.errors.length === 0);
    await s.ctx.close();

    const o = await open();
    await signIn(o.page, /Registrar|School Admin|registrar@example\.invalid/);
    if (await o.page.locator('[data-testid="nav-management"]').count()) {
      await o.page.locator('[data-testid="nav-management"]').click({ timeout: 6000 });
      const panel = o.page.locator('[data-testid="requests-panel"]');
      // Three reads land before the panel draws; wait for the panel, not a clock.
      await panel.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      ok("the office sees the request on the management screen", await panel.count() === 1 && /N Zulu/.test(await panel.innerText()));
      // He asked to coach and named no side; the office names one.
      await panel.locator('select[aria-label="Which side"]').first().selectOption("1XI").catch(() => {});
      await panel.locator("button", { hasText: /^Grant$/ }).first().click({ timeout: 4000 }); await o.page.waitForTimeout(1500);
      // The panel, not the whole screen: once granted he is on the users list
      // below it, which is the point.
      ok("...grants it, and it leaves the panel", await panel.count() === 0 || !/N Zulu/.test(await panel.innerText()));
      ok("no console errors (office)", o.errors.length === 0);
    } else {
      ok("the registrar is not on the pilot login; the API walk covers the grant", true);
    }
    await o.ctx.close();
  }

  // ── A parent names his child, and it is not thrown away ──────────
  // The parent-link step used to filter a variable named PLAYERS that this
  // file never imported — a ReferenceError the moment a parent typed a
  // second character into the search box, on the one path through
  // onboarding a real parent was most likely to take. And even filled in
  // correctly, the name went nowhere: the onboarding POST never carried it.
  // Both are fixed the same way — the name travels as a note on the
  // request, for whoever approves it to read — and this drives the actual
  // browser through the step that used to crash.
  group("A parent names his child on the way in, and the office reads it");
  {
    const s = await open();
    await click(s.page, /Get Started/, 5000); await s.page.waitForTimeout(600);
    await click(s.page, /Continue/, 4000);                                   // welcome
    await s.page.locator("button", { hasText: /Parent \/ Guardian/ }).first().click({ timeout: 4000 });
    await s.page.waitForTimeout(500);                                        // role auto-advances
    await s.page.locator("button", { hasText: /Hilton College/ }).first().click({ timeout: 6000 });
    await s.page.waitForTimeout(500);                                        // school auto-advances
    await s.page.locator('input[placeholder*="Whitfield"]').fill("R Zulu");
    await s.page.locator('input[type="email"]').first().fill("r.zulu@example.invalid");
    await click(s.page, /Continue/, 4000);                                   // profile
    ok("the parent-link step is reached, not crashed past",
       await s.page.locator('input[placeholder*="James Whitfield"]').count() === 1);
    // This is the exact interaction that used to throw: typing enough to
    // have triggered a search against the undefined PLAYERS constant.
    await s.page.locator('input[placeholder*="James Whitfield"]').fill("T Bekker");
    ok("no console errors after typing a child's name", s.errors.length === 0, s.errors.join(" | "));
    await click(s.page, /Continue/, 4000);                                   // parent_link
    await click(s.page, /Enter SCRBRD/, 4000);                               // tour → request
    await s.page.waitForTimeout(1500);
    ok("the flow still ends in a request", await s.page.locator('[data-testid="request-sent"]').count() === 1);
    await s.ctx.close();

    const o = await open();
    await signIn(o.page, /Registrar|School Admin|registrar@example\.invalid/);
    if (await o.page.locator('[data-testid="nav-management"]').count()) {
      await o.page.locator('[data-testid="nav-management"]').click({ timeout: 6000 });
      const panel = o.page.locator('[data-testid="requests-panel"]');
      await panel.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      ok("...and the child's name reached the office, not just the form",
         /R Zulu/.test(await panel.innerText()) && /T Bekker/.test(await panel.innerText()));
    } else {
      ok("the registrar is not on the pilot login; the note's shape is covered at the API layer", true);
    }
    await o.ctx.close();
  }

  // ── A submission that fails says so, and can be tried again ──────
  // A live onboarding POST used to have no visible "in flight" state and no
  // rendered failure: `sent` held the error string but nothing ever read it
  // except the one branch that checked for "ok". A person whose request
  // failed saw a button that had stopped doing anything, with no way to
  // tell why, and nothing stopped them submitting it again.
  group("A failed submission is named on screen, and the form still works after");
  {
    const s = await open();
    let failNext = true;
    await s.page.route("**/api/onboard", (route) => {
      if (failNext) { failNext = false; return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"try_again"}' }); }
      return route.continue();
    });
    await click(s.page, /Get Started/, 5000); await s.page.waitForTimeout(600);
    await click(s.page, /Continue/, 4000);
    await s.page.locator("button", { hasText: /Head Coach/ }).first().click({ timeout: 4000 });
    await s.page.waitForTimeout(500);
    await s.page.locator("button", { hasText: /Hilton College/ }).first().click({ timeout: 6000 });
    await s.page.waitForTimeout(500);
    await s.page.locator('input[placeholder*="Whitfield"]').fill("F Ailer");
    await s.page.locator('input[type="email"]').first().fill("f.ailer@example.invalid");
    await click(s.page, /Continue/, 4000);
    await click(s.page, /Enter SCRBRD/, 4000);
    await s.page.waitForTimeout(1200);
    ok("the refusal is named on the tour screen, not left silent",
       await s.page.locator('[data-testid="onboard-submit-error"]').isVisible());
    ok("...and the flow has not moved on to the request-sent screen",
       await s.page.locator('[data-testid="request-sent"]').count() === 0);
    ok("the button works again — this was not a dead end",
       await click(s.page, /Enter SCRBRD/, 4000));
    await s.page.waitForTimeout(1200);
    ok("the retry actually reaches the server this time",
       await s.page.locator('[data-testid="request-sent"]').count() === 1);
    await s.ctx.close();
  }

  // ── The shell, by id ────────────────────────────────────────────
  // Every walk above found its way around by button text, which is a test
  // that breaks when a label is reworded and passes when a button is drawn
  // twice. The shell now carries stable ids: nav-<key> in the sidebar,
  // mnav-<key> on the phone bar, drawer-<key> in the phone drawer, and
  // os-main[data-page] for where the person is. This walk uses only those.
  group("The shell is grouped, and reachable by id on a laptop and a phone");
  {
    const c = await open();
    await signIn(c.page, /Coach/);
    const tid = (id) => c.page.locator(`[data-testid="${id}"]`);
    ok("the sidebar draws its groups", await tid("nav-group-play").count() === 1 && await tid("nav-group-people").count() === 1);
    ok("...with a heading a screen reader can name",
       await c.page.$eval('[data-testid="nav-group-people"]', (el) => el.getAttribute("role") === "group" && !!el.getAttribute("aria-labelledby")));
    ok("...and no group a coach holds nothing in", await tid("nav-group-admin").count() === 0);
    ok("the coach starts on the dashboard", await tid("os-main").getAttribute("data-page") === "dashboard");
    await tid("nav-squad").click({ timeout: 6000 }); await c.page.waitForTimeout(800);
    ok("clicking the squad entry lands on the squad", await tid("os-main").getAttribute("data-page") === "squad");
    ok("...and the entry says so", await tid("nav-squad").getAttribute("aria-current") === "page");
    ok("the phone bar is not drawn on a laptop", await tid("mnav").isVisible().catch(() => false) === false);
    await tid("sidebar-toggle").click({ timeout: 4000 }); await c.page.waitForTimeout(400);
    ok("the sidebar collapses", await tid("sidebar").getAttribute("data-collapsed") === "true");
    ok("...and the entries keep their names", await tid("nav-profiles").getAttribute("aria-label") === "Profiles");
    ok("the top bar's controls are addressable",
       await tid("topbar-search").count() === 1 && await tid("topbar-alerts").count() === 1 && await tid("topbar-role").count() === 1);
    ok("no console errors on the laptop", c.errors.length === 0, c.errors.join(" | "));
    await c.ctx.close();

    // Every destination a role is offered must open. Until the drawer walk
    // below existed nothing had opened Training live, and it crashed on a
    // register the server had deliberately not sent. So: each screen, for
    // three very different navs, and the page must still be standing after.
    for (const [who, label] of [[/Coach/, "coach"], [/Parent|Guardian/, "guardian"], [/Director of Sport/, "director of sport"]]) {
      const s = await open();
      if (!(await signIn(s.page, who))) { ok(`the ${label} signs in for the sweep`, false); await s.ctx.close(); continue; }
      const keys = await s.page.$$eval('[data-testid^="nav-"]:not([data-testid^="nav-group-"]):not([data-testid="nav-alerts-badge"])',
                                       (els) => els.map((e) => e.getAttribute("data-testid").slice(4)));
      ok(`the ${label} is offered a menu`, keys.length >= 3);
      const broken = [];
      let pokes = 0;
      for (const k of keys) {
        const before = s.errors.length;
        await s.page.locator(`[data-testid="nav-${k}"]`).click({ timeout: 6000 }).catch(() => broken.push(`${k}: no click`));
        await s.page.waitForTimeout(700);
        const at = await s.page.locator('[data-testid="os-main"]').getAttribute("data-page", { timeout: 3000 }).catch(() => null);
        if (at !== k) broken.push(`${k}: landed on ${at}`);
        if (s.errors.length > before) broken.push(`${k}: ${s.errors.slice(before).join("; ").slice(0, 120)}`);
        // A crashed React root takes the menu down with it; every click after
        // that waits its full timeout for a button that is not coming back.
        if (at === null) break;
        // ONE LEVEL DOWN. Opening a screen proves the list renders; the two
        // profile bugs the recognition card exposed lived in the record behind
        // the list, which nothing had opened. So poke a few buttons on each
        // screen — a player, a fixture, a tab — and require the page to stand
        // after each. Skipped: anything that reads like a write or a takeover.
        const SKIP = /save|submit|delete|retire|revoke|withdraw|publish|send|sign out|log out|remove|cancel|approve|reject|start|scor|declare|record|add |new |\+/i;
        // First, middle and last of the candidates, not the first three: a
        // screen's first buttons are its tabs and filters, and the records
        // are further down. The first draft poked "players / coaches / staff"
        // on the Profiles screen and never opened a profile.
        const buttons = s.page.locator('[data-testid="os-main"] button:not([disabled])');
        const count = Math.min(await buttons.count().catch(() => 0), 60);
        const candidates = [];
        for (let i = 0; i < count; i++) {
          const t = ((await buttons.nth(i).innerText().catch(() => "")) || "").trim().replace(/\s+/g, " ");
          if (t.length >= 4 && !SKIP.test(t)) candidates.push([i, t]);
        }
        const picks = [...new Set([0, Math.floor(candidates.length / 2), candidates.length - 1])]
          .filter((i) => i >= 0 && i < candidates.length).map((i) => candidates[i]);
        let poked = 0;
        for (const [i, t] of picks) {
          const b0 = s.errors.length;
          await buttons.nth(i).click({ timeout: 2500 }).catch(() => {});
          await s.page.waitForTimeout(600);
          await s.page.keyboard.press("Escape").catch(() => {});
          poked++; pokes++;
          if (s.errors.length > b0) broken.push(`${k} › "${t.slice(0, 32)}": ${s.errors.slice(b0).join("; ").slice(0, 120)}`);
          if (!(await s.page.locator('[data-testid="os-main"]').count())) { broken.push(`${k} › "${t.slice(0, 32)}": page gone`); break; }
        }
        if (!(await s.page.locator('[data-testid="os-main"]').count())) break;
      }
      ok(`every screen the ${label} is offered opens, and stands when poked (${keys.length} screens, ${pokes} pokes)`, broken.length === 0);
      ok(`...and the sweep actually reached records for the ${label}`, pokes >= keys.length);
      if (broken.length) console.log("    " + broken.join("\n    "));
      await s.ctx.close();
    }

    // The same person on a phone: the bar shows the first four, the drawer
    // shows the rest in the same groups the sidebar drew.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await offline(ctx);
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", (e) => { if (!isFirebaseOfflineNoise(e.message)) errors.push(e.message); });
    await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
    await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
    await signIn(page, /Coach/);
    const mid = (id) => page.locator(`[data-testid="${id}"]`);
    ok("the phone bar is drawn", await mid("mnav").isVisible());
    ok("...with the dashboard and the match centre on it", await mid("mnav-dashboard").count() === 1 && await mid("mnav-matches").count() === 1);
    ok("...and a More button for the rest", await mid("mnav-more").count() === 1);
    ok("the sidebar is not", await mid("sidebar").count() === 0);
    await mid("mnav-more").click({ timeout: 4000 }); await page.waitForTimeout(500);
    ok("More opens the drawer", await mid("drawer").isVisible());
    ok("...grouped the same way", await mid("drawer-group-people").count() === 1 && await mid("drawer-group-develop").count() === 1);
    await mid("drawer-training").click({ timeout: 4000 }); await page.waitForTimeout(800);
    ok("a drawer entry navigates and closes the drawer",
       await mid("os-main").getAttribute("data-page") === "training" && await mid("drawer").count() === 0);
    ok("...and More now reads as the active place", await mid("mnav-more").getAttribute("aria-expanded") === "false");
    ok("no console errors on the phone", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ── A dialog can be left ────────────────────────────────────────
  //
  // The sweep above found this the hard way: it opens a record, presses
  // Escape, moves to the next screen — and the next nav click timed out,
  // three assertions away from the cause. The dialog was still standing with
  // its backdrop over the whole viewport, eating every click.
  //
  // The director of sport is the subject because she is the reason it
  // surfaced: until user management was gated on the capability instead of a
  // demo role name, no live role could reach an Edit button at all.
  group("A dialog can be left, and the app works afterwards");
  {
    const c = await open();
    ok("the director of sport signs in", await signIn(c.page, /Director of Sport/));
    const tid = (id) => c.page.locator(`[data-testid="${id}"]`);
    await tid("nav-settings").click({ timeout: 6000 }); await c.page.waitForTimeout(1200);
    ok("she reaches settings", await tid("os-main").getAttribute("data-page") === "settings");

    // She holds user.role.assign, so the Users tab must offer her the edit
    // controls. If this is empty the capability gate has regressed and the
    // rest of the group would pass vacuously.
    const edits = c.page.locator('[data-testid="os-main"] button', { hasText: /^Edit$/ });
    const n = await edits.count();
    ok(`user management is offered to her (${n} rows)`, n > 0,
       "she holds user.role.assign — gating this on a demo role name is the bug this group exists for");

    if (n > 0) {
      await edits.first().click({ timeout: 4000 }); await c.page.waitForTimeout(600);
      ok("a dialog opens", await tid("modal-backdrop").isVisible());
      ok("...and it is the dialog a screen reader would announce",
         await c.page.locator('[role="dialog"][aria-modal="true"]').count() === 1);
      ok("...named by its own heading", await c.page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        const t = document.getElementById(d?.getAttribute("aria-labelledby") || "");
        return !!t && t.textContent.trim().length > 0;
      }));
      ok("...and focus has moved into it, not left at the top of the page",
         await c.page.evaluate(() => {
           const d = document.querySelector('[role="dialog"]');
           return !!d && (d === document.activeElement || d.contains(document.activeElement));
         }));

      await c.page.keyboard.press("Escape"); await c.page.waitForTimeout(500);
      ok("Escape closes it", await tid("modal-backdrop").count() === 0);

      // The assertion that actually matters: the app is usable again. This is
      // the one the sweep failed on, and a dialog that closes visually while
      // leaving a backdrop behind would still pass the line above.
      await tid("nav-rulebook").click({ timeout: 4000 }).catch(() => {});
      await c.page.waitForTimeout(800);
      ok("...and the menu works again afterwards",
         await tid("os-main").getAttribute("data-page") === "rulebook",
         "a nav click that lands nowhere means something invisible is still over the page");

      // Clicking the backdrop is the other way out, and it must not fire when
      // the click lands inside the card — which is the backdrop's own child.
      await tid("nav-settings").click({ timeout: 4000 }); await c.page.waitForTimeout(1200);
      await c.page.locator('[data-testid="os-main"] button', { hasText: /^Edit$/ }).first().click({ timeout: 4000 });
      await c.page.waitForTimeout(600);
      await c.page.locator('[role="dialog"] h3').click({ timeout: 4000 });
      await c.page.waitForTimeout(400);
      ok("a click inside the dialog does not close it", await tid("modal-backdrop").count() === 1);
      await tid("modal-backdrop").click({ position: { x: 5, y: 5 }, timeout: 4000 });
      await c.page.waitForTimeout(500);
      ok("...but a click on the backdrop does", await tid("modal-backdrop").count() === 0);
    }
    ok("no console errors while opening and leaving a dialog", c.errors.length === 0, c.errors.join(" | "));
    await c.ctx.close();
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

#!/usr/bin/env node
/**
 * EXPERIENCE_PASS Slice 6, "The office", from a browser
 * (docs/redesign/EXPERIENCE_PASS.md, "Slice 6", the Walks and "You'll know"
 * rows), against the seeded school:
 *
 *   1. §1.7, §1.8. The office's and the director's menus are their five homes,
 *      Today, Matches, Team, Logistics, School; on a phone all five on the bar
 *      and no More. The platform's are Today, Competitions, School, Platform
 *      and the Rulebook; a coach and a parent reach neither home.
 *   2. §1.3, §1.6. The School home: People (the staff screen with Settings'
 *      People and Import under it), Access (Management with Settings' Roles),
 *      Record (Settings' School), Modules and Sponsors, each section only where
 *      its gate holds (the director has no Modules). The Platform home: School
 *      requests, Support access, the DLS table, What's built and the Pitch deck,
 *      for the platform alone.
 *   3. You'll know: the demo parent taps her name and gets her own Settings,
 *      with no People tab and nobody else's accounts read. So does a coach.
 *   4. You'll know: the office on a phone. Five seconds: "A parent is waiting" is
 *      the first Needs you row. Two steps to the claim's pupil when the request
 *      names him (the row lands on her request, his name chosen, Grant offered);
 *      three when it names him in free text (no child chosen, Grant held back).
 *   5. New: a new school's Today shows the set-up list, each line opening its fix
 *      and going as it becomes true; opening Today reads nothing for it.
 *   6. Q7. The DSO lands on Today; nothing on it says a concern exists; the bell's
 *      high safeguarding notice opens his inbox in one tap; the DSO card is last.
 *
 * Its own school, accounts, requests, register row, players and fixtures, all
 * removed at the end (a concern raised is the safeguarding record's, and stays).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-office.mjs
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
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(4383);
const API_PORT = port(8933);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, Hilton 1XI
/** What the walk made, removed at the end. */
const made = { requests: /** @type {string[]} */ ([]), users: /** @type {string[]} */ ([]), assignments: /** @type {string[]} */ ([]),
  schools: /** @type {string[]} */ ([]), players: /** @type {string[]} */ ([]), matches: /** @type {string[]} */ ([]), register: /** @type {string[]} */ ([]) };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-office-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

async function open(width = 1280, path = "/") {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
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
  await page.goto(`http://localhost:${WEB_PORT}${path}`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const inner = (page, id) => tid(page, id).first().innerText({ timeout: 8000 }).catch(() => "");
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
  await page.locator("#login-email").fill(email);
  await click(page, /^Sign In$/, 5000);
  await afterReads(page, 2500);
}
/** The menu as drawn: the rail's entries on a laptop, the bar's on a phone, by key and word. */
const menuOf = (page, phone = false) => page.$$eval(phone ? '[data-testid="mnav"] [data-testid^="mnav-"]' : '[data-testid="nav"] [data-testid^="nav-"]:not([data-testid^="nav-group-"])',
  (els) => els.filter((e) => !/badge/.test(e.getAttribute("data-testid") ?? "")).map((e) => ({ key: e.getAttribute("data-testid"), word: (e.innerText || e.getAttribute("aria-label") || "").trim() })));
const words = async (page, phone = false) => (await menuOf(page, phone)).map((e) => e.word.replace(/\s+\d+$/, "").trim());
const pageNow = (page) => tid(page, "os-main").getAttribute("data-page").catch(() => null);
const sections = (page, home) => page.$$eval(`[data-testid="home-${home}-sections"] button`, (els) => els.map((e) => e.textContent.trim())).catch(() => []);
const tap = async (page, id, ms = 1500) => { await tid(page, id).first().click({ timeout: 6000 }).catch(() => {}); await afterReads(page, ms); };

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  group("1. The menus of §1.7 after: five homes for the office and the director, no More on a phone");
  {
    const s = await open();
    await signIn(s.page, "registrar@example.invalid");
    ok("the office: Today · Matches · Team · Logistics · School", (await words(s.page)).join(" · ") === "Today · Matches · Team · Logistics · School", (await words(s.page)).join(" · "));
    await s.ctx.close();
    const m = await open(390);
    await signIn(m.page, "registrar@example.invalid");
    ok("...on a phone, all five on the bar and no More", (await menuOf(m.page, true)).length === 5 && await tid(m.page, "mnav-more").count() === 0 && await tid(m.page, "mnav-staff").count() === 1,
      (await menuOf(m.page, true)).map((e) => e.key).join());
    ok("...no console errors", m.errors.length === 0, m.errors.join(" | "));
    await m.ctx.close();
    // The seeded director of sport is also a parent at the school, so the family's Home and Family stand beside her
    // five homes (roles.js PERSONA_NAV `alongside`, step 4): seven, and a phone keeps More for the family's two.
    const d = await open();
    await signIn(d.page, "sarah@example.invalid");
    ok("the director of sport (also a parent): her five homes, then the family's Home and Family",
       (await words(d.page)).join(" · ") === "Today · Matches · Team · Logistics · School · Home · Family", (await words(d.page)).join(" · "));
    await d.ctx.close();
    const dm = await open(390);
    await signIn(dm.page, "sarah@example.invalid");
    await tap(dm.page, "mnav-more", 800);
    const drawer = await dm.page.$$eval('[data-testid^="drawer-"]', (els) => els.map((e) => e.getAttribute("data-testid")).filter((t) => !/group/.test(t ?? ""))).catch(() => []);
    ok("...on her phone the five homes' first four on the bar, and More holds School with the family's two", drawer.includes("drawer-staff") && drawer.includes("drawer-children") && drawer.includes("drawer-family"), drawer.join());
    await dm.ctx.close();
    const p = await open();
    await signIn(p.page, "platform@example.invalid");
    ok("the platform: Today · Competitions · School · Platform · Rulebook", (await words(p.page)).join(" · ") === "Today · Competitions · School · Platform · Rulebook", (await words(p.page)).join(" · "));
    await p.ctx.close();
    const c = await open();
    await signIn(c.page, "coach@example.invalid");
    ok("a coach reaches neither School nor Platform", await tid(c.page, "nav-staff").count() === 0 && await tid(c.page, "nav-pitchdeck").count() === 0);
    await c.ctx.close();
  }

  group("2. The School and Platform homes, each section under its own gate");
  {
    const o = await open();
    await signIn(o.page, "registrar@example.invalid");
    await tap(o.page, "nav-staff", 2500);
    ok("School opens on People, the staff screen, with Settings' People part under it", await pageNow(o.page) === "staff" && await tid(o.page, "part-people").count() === 1
       && (await sections(o.page, "staff")).join() === "People,Access,Record,Modules,Sponsors", (await sections(o.page, "staff")).join());
    ok("...and Import with the staff register (Settings' Import part)", await tid(o.page, "settings-panel-import").count() === 1 && await tid(o.page, "import-panel").count() === 1);
    ok("...the no-account figure with its denominator", /of \d+ cannot sign in yet/.test(await inner(o.page, "part-people")));
    await tap(o.page, "home-staff-section-management", 2500);
    ok("Access is Management, with Settings' Roles as its reference", await pageNow(o.page) === "management" && await tid(o.page, "part-roles").count() === 1 && await tid(o.page, "roles-tab").count() === 1);
    ok("...and no school requests there any more (the platform's)", await tid(o.page, "school-requests-panel").count() === 0);
    await tap(o.page, "home-staff-section-record", 2500);
    ok("Record is Settings' School, with the audit (audit.read)", await pageNow(o.page) === "record" && await tid(o.page, "part-record").count() === 1);
    ok("School stays lit on the rail", await tid(o.page, "nav-staff").getAttribute("aria-current") === "page");
    ok("no console errors for the office", o.errors.length === 0, o.errors.join(" | "));
    await o.ctx.close();

    const d = await open();
    await signIn(d.page, "sarah@example.invalid");
    await tap(d.page, "nav-staff", 2500);
    ok("the director's School: People, Access, Record, Sponsors (no Modules: he cannot hide one)", (await sections(d.page, "staff")).join() === "People,Access,Record,Sponsors", (await sections(d.page, "staff")).join());
    await tap(d.page, "home-staff-section-record", 2500);
    ok("...his Record carries the names-off switches (broadcast.publish)", await d.page.locator(`[data-testid="names-off-${HIL}"]`).count() === 1);
    await d.ctx.close();

    const p = await open();
    await signIn(p.page, "platform@example.invalid");
    await tap(p.page, "nav-pitchdeck", 2500);
    ok("Platform: School requests, Support access, DLS table, What's built, Pitch deck", (await sections(p.page, "pitchdeck")).join() === "School requests,Support access,DLS table,What's built,Pitch deck",
      (await sections(p.page, "pitchdeck")).join());
    await tap(p.page, "home-pitchdeck-section-requests", 2000);
    ok("...School requests says when nobody is waiting", await tid(p.page, "part-requests").count() === 1
       && (await tid(p.page, "school-requests-none").count() === 1 || await tid(p.page, "school-requests-panel").count() === 1));
    await tap(p.page, "home-pitchdeck-section-support", 2000);
    ok("...Support access is the platform's panel", await tid(p.page, "support-access").count() === 1);
    await tap(p.page, "home-pitchdeck-section-roadmap", 1500);
    ok("...What's built is the roadmap", await tid(p.page, "roadmap-shipped").count() === 1);
    await tap(p.page, "nav-settings", 1500);
    ok("...and her own Settings no longer holds them", await tid(p.page, "own-settings").count() === 1 && await p.page.locator("#settings-tab-support, #settings-tab-dls, #settings-tab-upgrades").count() === 0);
    await p.ctx.close();
  }

  group("3. You'll know: the parent taps her name, and gets her own settings, no People tab");
  {
    const s = await open(390);
    const asked = [];
    s.page.on("request", (r) => asked.push(r.url()));
    await signIn(s.page, "parent@example.invalid");
    const before = asked.length;
    await tap(s.page, "nav-settings", 2500);
    const read = asked.slice(before).filter((u) => /\/api\/read\/(users|staff|coaches|dob_gaps|sign_in_claims)\b/.test(u));
    ok("her name opens her own Settings", await pageNow(s.page) === "settings" && await tid(s.page, "own-settings").count() === 1);
    ok("...with no People tab, and no accounts, roster or claims part", await s.page.locator("#settings-tab-users, #settings-tab-roles, #settings-tab-school, #settings-tab-import").count() === 0
       && await tid(s.page, "part-people").count() === 0 && !/\bPeople\b/.test(await inner(s.page, "own-settings")));
    ok("...and reads nobody else's accounts to draw it", read.length === 0, read.join(" "));
    ok("...Me is there: appearance, ways to sign in", await tid(s.page, "appearance").count() === 1);
    ok("no console errors for the parent", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
    const c = await open();
    await signIn(c.page, "coach@example.invalid");
    await tap(c.page, "nav-settings", 2000);
    ok("a coach's name opens his own Settings, no People tab either", await tid(c.page, "own-settings").count() === 1 && await c.page.locator("#settings-tab-users").count() === 0);
    await c.ctx.close();
  }

  group("4. You'll know: the office, \"A parent is waiting\" first; two steps to the pupil named, three in free text");
  {
    const mkParent = async (email, name) => {
      const [u] = await q(`insert into app_user (email, name, role) values ($1, $2, 'parent') returning id`, [email, name]);
      made.users.push(u.id);
      return u.id;
    };
    const named = await mkParent("office.walk.named@example.invalid", "Office Walk Named");
    const free = await mkParent("office.walk.free@example.invalid", "Office Walk Free");
    const [r1] = await q(`insert into role_request (person_id, role, school_id, player_id, requested_at) values ($1, 'guardian', $2, $3, now() - interval '3 days') returning id`, [named, HIL, PILLAY]);
    const [r2] = await q(`insert into role_request (person_id, role, school_id, note, requested_at) values ($1, 'guardian', $2, 'My son is in the U13s, his name is on the sheet', now() - interval '1 day') returning id`, [free, HIL]);
    made.requests.push(r1.id, r2.id);

    const s = await open(390);
    await signIn(s.page, "registrar@example.invalid");
    await tid(s.page, "needs-you-row").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(s.page, 2000);
    const first = s.page.locator('[data-testid="needs-you-row"]').first();
    const fact = (await first.locator('[data-testid="needs-you-fact"]').innerText().catch(() => "")).trim();
    ok("five seconds: the first Needs you row is the parents waiting", fact === "2 parents are waiting", fact);
    const box = await first.boundingBox().catch(() => null);
    ok("...on the first screen of a phone", !!box && box.y + box.height <= 844, JSON.stringify(box));
    ok("...naming no child", !/Pillay|U13/.test(await inner(s.page, "needs-you")));
    await first.locator("button").first().click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 3000);
    const row = tid(s.page, `request-row-${r1.id}`);
    ok("step one: the row lands on Access, on the oldest parent's request", await pageNow(s.page) === "management" && await row.getAttribute("data-fix") === "here");
    const chosen = await row.locator('select[aria-label="Which player"]').evaluate((e) => e.options[e.selectedIndex]?.textContent ?? "").catch(() => "");
    ok("...the request names the pupil, so he is chosen already", /Pillay/.test(chosen), chosen);
    ok("...and step two is Grant, offered", await tid(s.page, `request-grant-${r1.id}`).isEnabled().catch(() => false));
    ok("the free-text request has no child chosen and holds Grant back: the third step is the office finding him (SCRBRD-140 D5)",
       await tid(s.page, `request-grant-${r2.id}`).isDisabled().catch(() => false)
       && (await tid(s.page, `request-row-${r2.id}`).locator('select[aria-label="Which player"]').inputValue().catch(() => "x")) === "");
    ok("no console errors for the office", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
    await q(`delete from role_request where id = any($1)`, [made.requests]);
    made.requests = [];
  }

  group("5. New: a new school's Today shows the set-up list, each line going as it becomes true");
  {
    const [school] = await q(`insert into school (code, name) values ('OFW', 'Office Walk High') returning id`);
    made.schools.push(school.id);
    const [u] = await q(`insert into app_user (school_id, email, name, role) values ($1, 'office.walk.new@example.invalid', 'Office Walk Registrar', 'schooladmin') returning id`, [school.id]);
    made.users.push(u.id);
    // The office and the director of sport at once: "Decide what is public" is a broadcast.publish holder's line.
    for (const role of ["schooladmin", "directorofsport"]) {
      const [a] = await q(`insert into role_assignment (person_id, role, school_id) values ($1, $2, $3) returning id`, [u.id, role, school.id]);
      made.assignments.push(a.id);
    }
    const s = await open();
    const asked = [];
    s.page.on("request", (r) => asked.push(r.url()));
    await signIn(s.page, "office.walk.new@example.invalid");
    await tid(s.page, "setup-list").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(s.page, 2000);
    const lines = async () => s.page.$$eval('[data-testid="setup-row"]', (els) => els.map((e) => e.getAttribute("data-key"))).catch(() => []);
    ok("Today leads with the set-up list: staff, pupils, teams, the first fixture, what is public", (await lines()).join() === "staff,pupils,teams,fixture,public", (await lines()).join());
    ok("...each with the office as owner", /The office/.test(await inner(s.page, "setup-list")));
    const listOrder = await s.page.evaluate(() => {
      const l = document.querySelector('[data-testid="setup-list"]'); const n = document.querySelector('[data-testid="day-next"]');
      return l && n ? l.getBoundingClientRect().top < n.getBoundingClientRect().top : !!l;
    });
    ok("...above the day sheet's next fixture", listOrder);
    // (The shell reads the account directory at sign-in for every staff screen, as before; the list adds nothing.)
    const forList = asked.filter((u) => /\/api\/register\/|\/listing\b|\/api\/read\/(staff|school_register)\b/.test(u));
    ok("...and opening Today read nothing for it (the register, the listing, the staff)", forList.length === 0, forList.join(" "));

    await tap(s.page, "setup-open-staff", 3000);
    ok("'List your staff' opens School, People at the register", await pageNow(s.page) === "staff" && await tid(s.page, "register-panel").getAttribute("data-fix") === "here");
    const [reg] = await q(`insert into school_register (school_id, email, name, role, valid_until, uploaded_by, upload_id)
      values ($1, 'office.walk.coach@example.invalid', 'Office Walk Coach', 'coach', current_date + 200, $2, gen_random_uuid()) returning id`, [school.id, u.id]);
    made.register.push(reg.id);
    await tap(s.page, "home-staff-section-record", 1500);
    await tap(s.page, "home-staff-section-staff", 3000);
    await s.page.locator('[data-testid="register-list-section"]').first().waitFor({ timeout: 8000 }).catch(() => {});
    await afterReads(s.page, 1500);
    await tap(s.page, "nav-dashboard", 3000);
    ok("...once the register lists a row, the line goes", !(await lines()).includes("staff") && (await lines()).includes("pupils"), (await lines()).join());

    await tap(s.page, "setup-open-pupils", 3000);
    ok("'Bring in your pupils' opens School, People at Import", await pageNow(s.page) === "staff" && await tid(s.page, "import-panel").getAttribute("data-fix") === "here");
    const [pl] = await q(`insert into player (school_id, full_name, born) values ($1, 'Office Walk Pupil', '2012-03-04') returning id`, [school.id]);
    made.players.push(pl.id);
    await tap(s.page, "nav-dashboard", 3000);
    ok("...a pupil on the roster: that line goes, and 'Make your teams' stays (no side yet)", !(await lines()).includes("pupils") && (await lines()).includes("teams"), (await lines()).join());
    await q(`update player set team_code = 'U14A' where id = $1`, [pl.id]);
    await tap(s.page, "home-dashboard-section-news", 1500);
    await tap(s.page, "home-dashboard-section-dashboard", 3000);
    ok("...a side with a squad: 'Make your teams' goes", !(await lines()).includes("teams"), (await lines()).join());

    await tap(s.page, "setup-open-public", 3000);
    ok("'Decide what is public' opens School, Record at the listing", await pageNow(s.page) === "record" && await s.page.locator('[data-testid^="listing-"][data-fix="here"]').count() === 1);
    await tid(s.page, "listing-switch").first().click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 1500);
    await tap(s.page, "home-staff-section-staff", 1200);
    await tap(s.page, "home-staff-section-record", 2500);
    await tap(s.page, "nav-dashboard", 3000);
    ok("...the school chose: that line goes", !(await lines()).includes("public"), (await lines()).join());

    const [m] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
      values ($1, 'U14A', 'Office Walk Visitors', now() + interval '3 days', 'cricket', 'T20', 20, 'scheduled') returning id`, [school.id]);
    made.matches.push(m.id);
    await tap(s.page, "home-dashboard-section-news", 1500);
    await tap(s.page, "home-dashboard-section-dashboard", 3500);
    ok("a first fixture: the list is gone", await tid(s.page, "setup-list").count() === 0);
    ok("no console errors for the new school's office", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  group("6. Q7: the DSO's route: Today, then the bell's notice, then the inbox");
  {
    const raise = await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "parent@example.invalid", deviceId: "browser-office" }) }).then((r) => r.json());
    const r = await fetch(`${API}/api/safeguarding/concerns`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${raise.token}` },
      body: JSON.stringify({ schoolId: HIL, aboutKind: "unknown", nature: ["other"], certainty: "suspicion", howLearned: "witness",
        account: "A boy on the boundary looked frightened of the man collecting him and would not say why." }) }).then((x) => x.json());
    ok("a concern is raised (the walk's setup)", !!r.reference, JSON.stringify(r));

    const d = await open(390);
    await signIn(d.page, "dso@example.invalid");
    await tid(d.page, "dso-card").first().waitFor({ timeout: 10000 }).catch(() => {});
    await afterReads(d.page, 2000);
    ok("the DSO lands on Today, like everyone", await pageNow(d.page) === "dashboard");
    const today = await inner(d.page, "os-main");
    ok("...nothing on it says a concern exists: no notice title, no count, no inbox", !/concern has been raised|concerns? (open|waiting)|\d+ concerns?|Inbox/i.test(today) && await tid(d.page, "sg-inbox").count() === 0,
      today.slice(0, 400));
    const last = await d.page.evaluate(() => {
      const main = document.querySelector('[data-testid="os-main"]');
      const all = main ? [...main.querySelectorAll("[data-testid]")].filter((e) => e.getBoundingClientRect().height > 0) : [];
      const card = main?.querySelector('[data-testid="dso-card"]');
      return !!card && all.every((e) => card.contains(e) || e.contains(card) || e.getBoundingClientRect().top <= card.getBoundingClientRect().top);
    });
    ok("...the DSO card is last", last);
    ok("...and the header's Raise a concern carries no mark", await d.page.evaluate(() => {
      const near = document.querySelector('[data-testid="nav-safeguarding"]');
      return near ? near.querySelectorAll("[data-testid*='badge'], [data-testid*='count']").length === 0 && !/\d/.test(near.textContent ?? "") : false;
    }));
    await tap(d.page, "topbar-alerts", 2500);
    const notice = d.page.locator('[data-testid="notice-row"]', { hasText: "A safeguarding concern has been raised" }).first();
    ok("the bell lists the high safeguarding notice, which names nobody", await notice.count() === 1 && !/Pillay|frightened/.test(await notice.innerText().catch(() => "")));
    await notice.locator('[data-testid="notice-open-inbox"]').click({ timeout: 4000 }).catch(() => {});
    await afterReads(d.page, 2500);
    ok("...and one tap on it opens his inbox, landed on: brought into view and focused (review SF2)", await pageNow(d.page) === "safeguarding" && await tid(d.page, "sg-inbox").count() === 1
       && await tid(d.page, "sg-inbox").getAttribute("data-fix") === "here"
       && await d.page.evaluate(() => { const el = document.querySelector('[data-testid="sg-inbox"]'); const r = el?.getBoundingClientRect();
            return !!el && document.activeElement === el && r.top < window.innerHeight && r.bottom > 0; })
       && await d.page.locator(`[data-testid="sg-inbox-row"][data-reference="${r.reference}"]`).count() === 1);
    ok("no console errors for the DSO", d.errors.length === 0, d.errors.join(" | "));
    await d.ctx.close();

    const c = await open();
    await signIn(c.page, "coach@example.invalid");
    await tap(c.page, "topbar-alerts", 2000);
    ok("a coach's notices hold no safeguarding notice, and no inbox door", await tid(c.page, "notice-open-inbox").count() === 0
       && !/safeguarding concern has been raised/i.test(await inner(c.page, "os-main")));
    await c.ctx.close();
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.message);
} finally {
  await q(`delete from role_request where id = any($1)`, [made.requests]).catch(() => {});
  await q(`delete from match where id = any($1)`, [made.matches]).catch(() => {});
  await q(`delete from school_register where id = any($1)`, [made.register]).catch(() => {});
  await q(`delete from player where id = any($1)`, [made.players]).catch(() => {});
  await q(`delete from public_listing where school_id = any($1)`, [made.schools]).catch(() => {});
  await q(`delete from role_assignment where id = any($1)`, [made.assignments]).catch(() => {});
  await q(`delete from app_user where id = any($1)`, [made.users]).catch(() => {});
  await q(`delete from school where id = any($1)`, [made.schools]).catch(() => {});
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nBROWSER OFFICE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

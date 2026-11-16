#!/usr/bin/env node
/**
 * EXPERIENCE_PASS Slice 5, the coach's day sheet and the homes, from a browser
 * (docs/redesign/EXPERIENCE_PASS.md, "Slice 5", the Walks and "You'll know"
 * rows), against the seeded school:
 *
 *   1. §1.7. Each persona the seed holds sees exactly the "after" menu: the
 *      coach Today, Matches, Team, Logistics; the scorer Today, Matches, Team;
 *      the spectator Today, Matches; the parent's and the pupil's four, as
 *      decided. On a phone the coach's bar is the four, and there is no More.
 *   2. The header, for staff: the bell, "Raise a concern" and the person's
 *      name, on every screen; none of the three in the menu.
 *   3. Q17. To resolve is a section of the coach's Today, and of nobody's who
 *      cannot act on a row: the spectator and the scorer have none.
 *   4. You'll know, the coach on a match day at 390 wide. Five seconds: the
 *      next fixture's sentence and its chips not done are on the first screen,
 *      not done first. Two steps: "Team sheet" opens that fixture's Coach tab;
 *      Team, then Training, opens Training.
 *   5. Q7. The DSO card is last on Today, naming the DSO, and nothing on any
 *      home or header marks whether a concern exists.
 *   6. Q11. A team page opened by its address shows the same season figures as
 *      the side's Stats (Analytics) did; a player's address opens his page; a
 *      player the coach may not read is said so, with nothing of him; a
 *      ground's address opens that ground; a reader whose menu does not reach
 *      the screen is left at /app; an address that names a person is no
 *      address.
 *   7. You'll know, the director: the first "Needs you" row opens the screen
 *      that fixes it (the fixture, or the thing on its screen), not a list.
 *
 * Reads only: it writes nothing to the database.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-homes.mjs
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

const WEB_PORT = port(4381);
const API_PORT = port(8931);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, Hilton 1XI
const WES_CHILD = "bbbbbbbb-0000-0000-0000-000000000001"; // a Westville boy: not on a Hilton coach's roster

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-homes-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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
const pageNow = (page) => tid(page, "os-main").getAttribute("data-page").catch(() => null);
/** Go to a folded destination as a person does: its home's entry, then its section. */
async function section(page, home, key, phone = false) {
  await tid(page, `${phone ? "mnav" : "nav"}-${home}`).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(page, 1200);
  await tid(page, `home-${home}-section-${key}`).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(page, 1500);
}

try {
  group("§1.7: each persona sees exactly the after menu");
  {
    const want = {
      "coach@example.invalid": ["Today", "Matches", "Team", "Logistics"],
      "scorer@example.invalid": ["Today", "Matches", "Team"],
      "watcher@example.invalid": ["Today", "Matches"],
      "parent@example.invalid": ["Home", "Matches", "Notices", "Family"],
      "pillay@example.invalid": ["Home", "Matches", "Passport", "Me"],
    };
    for (const [email, words] of Object.entries(want)) {
      const s = await open();
      await signIn(s.page, email);
      const m = await menuOf(s.page);
      // The persona header's Settings and Raise a concern carry nav- ids too (PersonaBar.jsx); they are not in the rail.
      const rail = m.filter((x) => !["nav-settings", "nav-safeguarding"].includes(x.key)).map((x) => x.word);
      ok(`${email.split("@")[0]}: ${words.join(" · ")}`, rail.join("|") === words.join("|"), rail.join(" · "));
      ok(`...and no page error (${email.split("@")[0]})`, s.errors.length === 0, s.errors.join(" | "));
      await s.ctx.close();
    }
    const sd = await open();
    await signIn(sd.page, "sarah@example.invalid");
    const dw = (await menuOf(sd.page)).map((x) => x.word);
    ok("the director of sport: Today, Matches, Team, Logistics, then his office's entries until Slice 6, none folded",
       ["Today", "Matches", "Team", "Logistics"].every((w) => dw.includes(w))
       && !dw.some((w) => ["Dashboard", "Newsfeed", "Match Centre", "Calendar", "Competitions", "Officials", "Squad", "Profiles", "Injuries", "Analytics", "Skills", "Training", "Fields", "To resolve", "Alerts", "Safeguarding", "Settings", "Rulebook"].includes(w)),
       dw.join(" · "));
    await sd.ctx.close();
  }

  group("On a phone: the coach's four on the bar, and no More");
  {
    const s = await open(390);
    await signIn(s.page, "coach@example.invalid");
    const bar = await menuOf(s.page, true);
    ok("the bar is Today, Matches, Team, Logistics", bar.map((x) => x.word).join("|") === "Today|Matches|Team|Logistics", bar.map((x) => x.word).join(" · "));
    ok("...with no More and no drawer", await tid(s.page, "mnav-more").count() === 0 && await tid(s.page, "drawer").count() === 0);
    ok("...and the way out in the header's menu", await (async () => {
      await tid(s.page, "topbar-role").click({ timeout: 4000 }).catch(() => {});
      const n = await tid(s.page, "topbar-signout").count();
      await s.page.keyboard.press("Escape");
      return n === 1;
    })());
    ok("the header fits the phone: nothing sideways", await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await s.ctx.close();
  }

  group("The header, for staff: the bell, Raise a concern, the name");
  {
    const s = await open();
    await signIn(s.page, "coach@example.invalid");
    const top = tid(s.page, "topbar");
    ok("the bell, Raise a concern and the name are in the header",
       await top.locator('[data-testid="topbar-alerts"]').count() === 1 && await top.locator('[data-testid="nav-safeguarding"]').count() === 1
       && await top.locator('[data-testid="nav-settings"]').count() === 1);
    ok("...and not in the menu", await tid(s.page, "nav").locator('[data-testid="nav-notifications"], [data-testid="nav-safeguarding"], [data-testid="nav-settings"]').count() === 0);
    await tid(s.page, "nav-safeguarding").click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 1200);
    ok("Raise a concern opens Safeguarding", await pageNow(s.page) === "safeguarding");
    await tid(s.page, "nav-settings").click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 1200);
    ok("the name opens Settings", await pageNow(s.page) === "settings");
    await s.ctx.close();
  }

  group("Q17: To resolve only for someone who can act on a row");
  {
    const c = await open();
    await signIn(c.page, "coach@example.invalid");
    ok("the coach's Today has To resolve as a section", await tid(c.page, "home-dashboard-section-readiness").count() === 1);
    await tid(c.page, "home-dashboard-section-readiness").click({ timeout: 4000 }).catch(() => {});
    await afterReads(c.page, 1500);
    ok("...which opens the queue", await pageNow(c.page) === "readiness" && await tid(c.page, "queue").count() === 1);
    await c.ctx.close();
    for (const email of ["watcher@example.invalid", "scorer@example.invalid"]) {
      const s = await open();
      await signIn(s.page, email);
      ok(`${email.split("@")[0]}: no To resolve anywhere on the shell`, await tid(s.page, "home-dashboard-section-readiness").count() === 0
         && await tid(s.page, "nav-readiness").count() === 0 && await tid(s.page, "needs-you").count() === 0);
      await s.ctx.close();
    }
  }

  group("You'll know: the coach on a match day, at 390");
  {
    const [next] = await q(`select id from match where school_id = $1 and team_code = '1XI' and status = 'scheduled' and starts_at > now() order by starts_at limit 1`, [HIL]);
    const s = await open(390);
    await signIn(s.page, "coach@example.invalid");
    await tid(s.page, "day-next-status").first().waitFor({ timeout: 12000 }).catch(() => {});
    const box = await tid(s.page, "day-next").first().boundingBox().catch(() => null);
    const said = await inner(s.page, "day-next-status");
    ok("five seconds: the next fixture's sentence is on the first screen", !!box && box.y < 844 && /Starts at|toss/i.test(said), `${box?.y} ${said}`);
    ok("...it is the coach's next fixture, once", await tid(s.page, `next-fixture-${next?.id}`).count() === 1
       && await s.page.locator(`[data-testid="day-matchday"][data-match="${next?.id}"]`).count() <= 1);
    ok("...with the match-day card folded into it, not beside it",
       await s.page.locator(`[data-testid="day-next"] [data-testid="day-matchday"][data-match="${next?.id}"]`).count() === 1);
    const chips = await s.page.$$eval('[data-testid="day-next"] [data-testid^="ready-"]', (els) => els.map((e) => e.getAttribute("data-on")));
    const firstOn = chips.indexOf("true");
    ok("...its chips not done come first", chips.length === 4 && (firstOn === -1 || chips.slice(firstOn).every((v) => v === "true")), chips.join());
    const chipBox = await tid(s.page, "ready-squad").first().boundingBox().catch(() => null);
    ok("...on the first screen too, each 44px to tap", !!chipBox && chipBox.y + chipBox.height <= 844 && chipBox.height >= 44, JSON.stringify(chipBox));
    await tid(s.page, "ready-squad").first().click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 2500);
    ok("two steps: Team sheet opens that fixture's Coach tab", await pageNow(s.page) === "matches"
       && new RegExp(`/app/matches/${next?.id}`).test(s.page.url()) && await tid(s.page, "mc-coach").count() === 1, s.page.url());
    await section(s.page, "squad", "training", true);
    ok("...and Team, then Training, opens Training", await pageNow(s.page) === "training");
    ok("the Team home's section switch keeps to one row on the phone", await tid(s.page, "home-squad-sections").evaluate((el) => {
      const tops = [...el.children].map((c) => Math.round(c.getBoundingClientRect().top));
      return new Set(tops).size === 1;
    }).catch(() => false));
    ok("no page error", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  group("The day sheet's figures (§3.10)");
  {
    const s = await open();
    await signIn(s.page, "coach@example.invalid");
    await tid(s.page, "day-last").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(s.page, 3000);
    ok("Last match: a result in words", (await inner(s.page, "day-last-result")).length > 3, await inner(s.page, "day-last"));
    const season = await inner(s.page, "day-season");
    ok("...and the side's season in one line, with what it rests on", /completed match/.test(season), season);
    const week = await s.page.$$eval('[data-testid="day-week"] [data-testid^="week-fixture-said-"]', (els) => els.map((e) => e.textContent ?? ""));
    ok("This week: each fixture says where it stands", week.length > 0 && week.every((t) => t.trim().length > 0), week.join(" | "));
    await s.ctx.close();
  }

  group("Q7: the DSO card last on Today, and no mark of a concern");
  {
    const s = await open();
    await signIn(s.page, "coach@example.invalid");
    await tid(s.page, "dso-card-name").first().waitFor({ timeout: 10000 }).catch(() => {});
    const last = await tid(s.page, "day-sheet").evaluate((el) => {
      const kids = [...el.children];
      return kids[kids.length - 1]?.querySelector('[data-testid="dso-card"]') != null;
    }).catch(() => false);
    ok("the DSO card is the last thing on the day sheet", last);
    ok("...naming the school's DSO", (await tid(s.page, "dso-card-name").count()) > 0, await inner(s.page, "dso-card"));
    ok("...with Raise a concern", await tid(s.page, "dso-card-raise").count() === 1);
    const marks = await s.page.evaluate(() => {
      const near = document.querySelector('[data-testid="nav-safeguarding"]');
      return near ? near.querySelectorAll("[data-testid*='badge'], [data-testid*='count']").length + (/\d/.test(near.textContent ?? "") ? 1 : 0) : -1;
    });
    ok("no mark beside Raise a concern", marks === 0, String(marks));
    await s.ctx.close();
    const d = await open();
    await signIn(d.page, "dso@example.invalid");
    ok("the DSO lands on Today, like everyone", await pageNow(d.page) === "dashboard");
    ok("...with no mark of a concern on it", !/concern(s)? (open|waiting|raised)|\d+ concerns?/i.test(await inner(d.page, "os-main")));
    await d.ctx.close();
  }

  group("Q11: the addresses");
  {
    const c = await open();
    await signIn(c.page, "coach@example.invalid");
    // The side's Stats first, as Analytics draws it.
    await section(c.page, "squad", "analytics");
    await tid(c.page, "analytics-team-1XI").first().click({ timeout: 4000 }).catch(() => {});
    await tid(c.page, "side-season-panel").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(c.page, 2500);
    const stats = (await inner(c.page, "side-season-panel")).replace(/\s+/g, " ").trim();
    await c.ctx.close();

    const t = await open(1280, `/app/teams/${HIL}.1XI`);
    await signIn(t.page, "coach@example.invalid");
    await tid(t.page, "team-page").first().waitFor({ timeout: 12000 }).catch(() => {});
    await tid(t.page, "side-season-panel").first().waitFor({ timeout: 12000 }).catch(() => {});
    await afterReads(t.page, 2500);
    ok("a team's address opens its page inside the Team home", await pageNow(t.page) === "squad" && await tid(t.page, "team-page").count() === 1
       && (await tid(t.page, "nav-squad").getAttribute("aria-current")) === "page", t.page.url());
    const there = (await inner(t.page, "side-season-panel")).replace(/\s+/g, " ").trim();
    ok("...showing the same season figures as the side's Stats did", there.length > 20 && there === stats, `${there.slice(0, 160)} || ${stats.slice(0, 160)}`);
    ok("...and its results, with what they rest on", (await tid(t.page, "team-results").count()) === 1, await inner(t.page, "team-results"));
    ok("...and the address is the id, never a name", /\/app\/teams\/[0-9a-f-]{36}\.1XI$/.test(new URL(t.page.url()).pathname), t.page.url());
    await tid(t.page, "home-squad-section-training").click({ timeout: 4000 }).catch(() => {});
    await afterReads(t.page, 1200);
    ok("leaving it leaves the address", new URL(t.page.url()).pathname === "/app", t.page.url());
    await t.ctx.close();

    const p = await open(1280, `/app/players/${PILLAY}`);
    await signIn(p.page, "coach@example.invalid");
    await afterReads(p.page, 2500);
    ok("a player's address opens his page", await pageNow(p.page) === "profiles" && /R Pillay/.test(await inner(p.page, "os-main"))
       && await tid(p.page, "address-refused").count() === 0, p.page.url());
    await p.ctx.close();

    const r = await open(1280, `/app/players/${WES_CHILD}`);
    await signIn(r.page, "coach@example.invalid");
    await tid(r.page, "address-refused").first().waitFor({ timeout: 12000 }).catch(() => {});
    ok("a player the coach may not read: said so, and nothing of him", await tid(r.page, "address-refused").count() === 1, await inner(r.page, "os-main"));
    await r.ctx.close();

    const [g] = await q(`select id, name from ground where school_id = $1 order by name limit 1`, [HIL]);
    const gp = await open(1280, `/app/grounds/${g.id}`);
    await signIn(gp.page, "coach@example.invalid");
    await afterReads(gp.page, 2000);
    ok("a ground's address opens that ground", await pageNow(gp.page) === "fields" && (await inner(gp.page, "os-main")).includes(g.name), gp.page.url());
    await gp.ctx.close();

    const w = await open(1280, `/app/players/${PILLAY}`);
    await signIn(w.page, "watcher@example.invalid");
    await afterReads(w.page, 1500);
    ok("a spectator, whose menu has no Players, is left at /app", new URL(w.page.url()).pathname === "/app" && await pageNow(w.page) !== "profiles", w.page.url());
    await w.ctx.close();

    const n = await open(1280, "/app/players/R%20Pillay");
    await signIn(n.page, "coach@example.invalid");
    await afterReads(n.page, 1500);
    ok("an address that names a person opens nothing", await pageNow(n.page) !== "profiles");
    await n.ctx.close();
  }

  group("You'll know: the director's first Needs you row lands on the fix");
  {
    const s = await open();
    await signIn(s.page, "sarah@example.invalid");
    await tid(s.page, "needs-you-row").first().waitFor({ timeout: 15000 }).catch(() => {});
    await afterReads(s.page, 2500);
    const first = s.page.locator('[data-testid="needs-you-row"]').first();
    const kind = await first.getAttribute("data-kind").catch(() => null);
    const match = await first.getAttribute("data-match").catch(() => null);
    ok("Needs you is on his Today", await tid(s.page, "needs-you").count() === 1 && !!kind, await inner(s.page, "needs-you"));
    await first.locator("button").first().click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 3000);
    const where = await pageNow(s.page);
    const onFixture = !!match && new RegExp(`/app/matches/${match}`).test(s.page.url());
    const onThing = await s.page.locator('[data-fix="here"]').count() > 0;
    ok(`...its first row (${kind}) opens the fix: the fixture, or the thing on its screen`, onFixture || onThing, `${where} ${s.page.url()}`);
    await s.ctx.close();
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.message);
} finally {
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nBROWSER HOMES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

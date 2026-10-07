#!/usr/bin/env node
/**
 * The prototype leftovers, taken down (Wave A of 1 October 2026), from a browser.
 *
 * Each of these used to show a signed-in person something invented or offer a
 * control that did nothing. This walk holds them gone:
 *
 *   1. Logistics → Equipment draws the school's kit register and nothing else:
 *      no fixed inventory, no tiles counted from one.
 *   2. Injuries has no Update Progress, Clear for Training, Refer to Physio or
 *      Log Injury form; one line says recording is coming.
 *   3. Skills' bar axis reads 1 and 20 at 12px, with no invented target.
 *   4. Global search finds schools from the platform's own list when signed in,
 *      and a school that is only in the sample registry is not a result.
 *   5. Profiles names a school only from the read: no sample lookup, no
 *      hard-coded Hilton College.
 *   6. Squad's player panel: Set Availability saves through the existing route
 *      (checked against match_availability); Edit Profile offers the side, a
 *      missing birthday and who to ring, and a coach without those capabilities
 *      is not offered it; Log Injury is gone; a demonstration offers no writes.
 *   7. The Fields pitch drawing is the same on every render.
 *
 * Falsified one assertion at a time (see the commit message for which):
 * putting each leftover back turned its own assertion red.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-cleanup.mjs
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

const WEB_PORT = port(5481);
const API_PORT = port(5482);
const API = `http://127.0.0.1:${API_PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-cleanup-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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
  return (await tid(page, "os-main").count()) === 1;
}
/**
 * A demonstration: the shell with no token, which is what a restored session
 * with nobody signed in is (the same way smoke-browser-read reaches it).
 */
async function openDemo(role) {
  const c = await open();
  await click(c.page, /Get Started|Log In/, 5000); await c.page.waitForTimeout(500);
  await c.page.evaluate((r) => new Promise((resolve, reject) => {
    const req = indexedDB.open("scrbrd");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) return resolve("no-kv");
      const put = db.transaction("kv", "readwrite").objectStore("kv")
        .put({ appState: "app", role: r, userName: "Demo Person", page: "dashboard" }, "session");
      put.onsuccess = () => resolve("ok"); put.onerror = () => reject(put.error);
    };
  }), role);
  await c.page.reload({ waitUntil: "networkidle" }); await c.page.waitForTimeout(1500);
  return c;
}
async function go(page, nav) {
  const l = tid(page, `nav-${nav}`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1600);
  return true;
}
const main = async (page) => (await tid(page, "os-main").count()) ? tid(page, "os-main").innerText() : text(page);
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
let movedBack = false;
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`).then((x) => x.json()); if (r?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // A fixture on an explicit day at an explicit hour, Johannesburg time, with
  // an opponent no seeded fixture has, so the walk can pick it by its name.
  const scrub = async () => {
    await q(`delete from match_availability where match_id in (select id from match where opponent = 'Cleanup Walk XI')`);
    await q(`delete from match where opponent = 'Cleanup Walk XI'`);
  };
  await scrub();
  const [m] = await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
                       values ($1, '1XI', 'Cleanup Walk XI', ((current_date + 5)::timestamp + time '09:00') at time zone 'Africa/Johannesburg',
                               'T20', 20, 'scheduled') returning id`, [HIL]);
  const realSchools = (await q(`select name from school`)).map((r) => r.name);
  const mockOnly = "Kearsney College";

  // ── The director signs in ─────────────────────────────────────────
  const dir = await open(); all.push(dir);
  ok("the director of sport signs in", await signIn(dir.page, "sarah@example.invalid"));

  // ── 1. Logistics → Equipment ──────────────────────────────────────
  group("Logistics → Equipment is the kit register and nothing else");
  ok("Logistics opens", await go(dir.page, "logistics"));
  ok("the equipment tab opens", await click(dir.page, /^equipment$/i, 4000));
  await dir.page.waitForTimeout(1500);
  const eqText = await main(dir.page);
  ok("the real kit register is drawn", await tid(dir.page, "kit-register").count() === 1);
  ok("no hard-coded inventory", !/Match Balls \(Dukes\)|Batting Helmets \(Adult\)|AED Defibrillator|Boundary Rope/.test(eqText));
  ok("no tiles counted from one", !/Total Line Items|Needs Attention|Safety Items/.test(eqText));

  // ── 2. Injuries ───────────────────────────────────────────────────
  group("Injuries offers no control that does nothing");
  ok("Injuries opens", await go(dir.page, "injuries"));
  await dir.page.waitForTimeout(800);
  const card = dir.page.locator("text=/Phase:/").first();
  if (await card.count()) { await card.click({ timeout: 4000 }).catch(() => {}); await dir.page.waitForTimeout(500); }
  const injText = await main(dir.page);
  ok("an injury can be read (the detail panel opens)", /Injury Report/.test(injText));
  ok("no Update Progress, Clear for Training or Refer to Physio", !/Update Progress|Clear for Training|Refer to Physio/.test(injText));
  ok("no Log Injury button or form", !/Log Injury/.test(injText) && await dir.page.locator('[role="dialog"], input[type="date"]').count() === 0);
  ok("one plain line says recording is coming", /Recording and updating injuries is coming\./.test(injText)
     && await tid(dir.page, "injury-writes-coming").count() === 1);

  // ── 4. Global search ──────────────────────────────────────────────
  group("Global search finds only the platform's own schools when signed in");
  const search = async (qs) => {
    await tid(dir.page, "topbar-search").click({ timeout: 6000 });
    await dir.page.waitForTimeout(400);
    await dir.page.fill('input[aria-label="Search, or ask Stats-Magic"]', qs);
    await dir.page.waitForTimeout(1000);
    const n = await tid(dir.page, "search-school").count();
    const t = n ? await tid(dir.page, "search-school").first().innerText() : "";
    await dir.page.keyboard.press("Escape");
    await dir.page.waitForTimeout(300);
    return { n, t };
  };
  const real = realSchools.find((n) => /Westville/.test(n)) ?? realSchools[0];
  const hit = await search(real.slice(0, 7));
  ok("a school on the platform is a result", hit.n >= 1 && hit.t.includes(real), hit.t);
  const miss = await search("Kearsney");
  ok("a school only in the sample registry is not", !realSchools.includes(mockOnly) && miss.n === 0, `${miss.n} ${miss.t}`);
  ok("a school result is a line, not a button that does nothing",
     (await tid(dir.page, "search-school").count()) === 0 || (await tid(dir.page, "search-school").first().evaluate((e) => e.tagName)) !== "BUTTON");

  // ── 6. Squad → player panel ───────────────────────────────────────
  group("Squad → player panel: Set Availability saves; Edit Profile offers only what routes can change");
  ok("Squad opens", await go(dir.page, "squad"));
  // She also coaches U16B, so Squad opens on the side she holds (GA-I07); the 1st XI is a tap away.
  ok("...on the side she coaches", await tid(dir.page, "squad-team-U16B").getAttribute("aria-pressed") === "true");
  await tid(dir.page, "squad-team-1XI").click();
  await dir.page.waitForTimeout(400);
  const pick = async (page, id) => {
    const c = tid(page, `squad-card-${id}`);
    try { await c.click({ timeout: 5000 }); } catch { return false; }
    await page.waitForTimeout(600);
    return true;
  };
  ok("he opens a player's panel", await pick(dir.page, PILLAY));
  const pt = await main(dir.page);
  ok("Log Injury is gone", !/Log Injury/.test(pt));
  ok("Edit Profile and Set Availability are offered to him",
     await tid(dir.page, "player-edit-profile").count() === 1 && await tid(dir.page, "player-set-availability").count() === 1);

  await tid(dir.page, "player-set-availability").click();
  await dir.page.waitForTimeout(1500);
  const sa = tid(dir.page, "set-availability");
  ok("Set Availability opens on the side's coming fixture", await sa.count() === 1);
  const sel = sa.locator("select");
  if (await sel.count()) {
    await sel.selectOption(m.id); await dir.page.waitForTimeout(1200);
  }
  ok("...naming the fixture", /Cleanup Walk XI/.test(await sa.innerText()));
  await tid(dir.page, "set-availability-doubtful").click();
  await dir.page.waitForTimeout(1800);
  const [row] = await q(`select status from match_availability where match_id = $1 and player_id = $2`, [m.id, PILLAY]);
  ok("it saves: the database holds his answer", row?.status === "doubtful", JSON.stringify(row));
  ok("...and the screen says so, from the server's re-read", /marked doubtful/.test(await sa.innerText())
     && /doubtful/i.test(await tid(dir.page, "set-availability-state").innerText()));
  await tid(dir.page, "set-availability-available").click();
  await dir.page.waitForTimeout(1800);
  ok("a second answer replaces the first",
     (await q(`select status from match_availability where match_id = $1 and player_id = $2`, [m.id, PILLAY]))[0]?.status === "available");
  const af = await floors(dir.page, "set-availability");
  ok("Set Availability keeps the floors", af.small.length === 0 && af.tiny.length === 0, [...af.small, ...af.tiny].join(" · "));

  await tid(dir.page, "player-edit-profile").click();
  await dir.page.waitForTimeout(1500);
  const ep = tid(dir.page, "edit-profile");
  ok("Edit Profile opens", await ep.count() === 1);
  ok("...offering the side and who to ring", await tid(dir.page, "edit-side").count() === 1 && await tid(dir.page, "edit-contacts").count() === 1);
  const epText = await ep.innerText();
  ok("...and nothing no route can change", !/Squad No|Playing Role|Batting Hand|Bowling|Injury/i.test(epText), epText.slice(0, 200));
  const ef = await floors(dir.page, "edit-profile");
  ok("Edit Profile keeps the floors", ef.small.length === 0 && ef.tiny.length === 0, [...ef.small, ...ef.tiny].join(" · "));
  const side = tid(dir.page, "edit-side-select");
  ok("Move is not offered for the side he is already in", await tid(dir.page, "edit-side-save").isDisabled());
  const to = await side.evaluate((el) => [...el.options].find((o) => o.value === "2XI")?.value ?? [...el.options].find((o) => o.value !== el.value)?.value);
  await side.selectOption(to);
  await tid(dir.page, "edit-side-save").click();
  await dir.page.waitForTimeout(2000);
  const [moved] = await q(`select team_code from player where id = $1`, [PILLAY]);
  ok("moving him changes his side in the database", moved?.team_code === to, JSON.stringify(moved));
  await q(`update player set team_code = '1XI' where id = $1`, [PILLAY]);
  movedBack = true;

  // A coach holds neither player.profile.manage nor player.emergency.manage.
  const coach = await open(); all.push(coach);
  ok("the coach signs in", await signIn(coach.page, "coach@example.invalid"));
  ok("Squad opens (coach)", await go(coach.page, "squad"));
  ok("he opens a player's panel", await pick(coach.page, PILLAY));
  ok("the coach is offered Set Availability and not Edit Profile",
     await tid(coach.page, "player-set-availability").count() === 1 && await tid(coach.page, "player-edit-profile").count() === 0);
  ok("...and no Log Injury", !/Log Injury/.test(await main(coach.page)));

  // ── 5. Profiles, 3, 7. In a demonstration ─────────────────────────
  group("A demonstration offers no writes, and names no school it does not know");
  const demo = await openDemo("directorofsport"); all.push(demo);
  ok("the demonstration says it is one", await tid(demo.page, "demo-banner").count() === 1);
  ok("Squad opens (demo)", await go(demo.page, "squad"));
  const firstCard = demo.page.locator('[data-testid^="squad-card-"]').first();
  await firstCard.click({ timeout: 5000 }).catch(() => {});
  await demo.page.waitForTimeout(600);
  ok("a player's panel opens", /SEASON STATS/.test(await main(demo.page)));
  ok("...with no Edit Profile, Set Availability or Log Injury",
     await tid(demo.page, "player-edit-profile").count() === 0 && await tid(demo.page, "player-set-availability").count() === 0
     && !/Log Injury/.test(await main(demo.page)));

  ok("Profiles opens (demo)", await go(demo.page, "profiles"));
  const rp = demo.page.locator('[data-testid^="roster-player-"]').first();
  await rp.click({ timeout: 5000 }).catch(() => {});
  await demo.page.waitForTimeout(800);
  const profText = await main(demo.page);
  ok("a profile is open", /overview/i.test(profText) && await rp.count() === 1);
  ok("no school is named where the read names none (no Hilton College fallback)", !/Hilton College/i.test(profText), profText.match(/.{20}Hilton College.{10}/i)?.[0]);

  ok("Logistics opens (demo)", await go(demo.page, "logistics"));
  await click(demo.page, /^equipment$/i, 4000);
  await demo.page.waitForTimeout(800);
  const dEq = await main(demo.page);
  ok("the demonstration shows no fixed inventory either", !/Match Balls \(Dukes\)|Total Line Items/.test(dEq) && /Sign in to see the kit register/.test(dEq));

  // The sample registry may stay in a demonstration.
  await tid(demo.page, "topbar-search").click({ timeout: 6000 });
  await demo.page.fill('input[aria-label="Search, or ask Stats-Magic"]', "Kearsney");
  await demo.page.waitForTimeout(800);
  ok("search in a demonstration still has the sample schools", await tid(demo.page, "search-school").count() === 1);
  await demo.page.keyboard.press("Escape");

  // ── 3. Skills ─────────────────────────────────────────────────────
  group("Skills' axis reads 1 and 20 at 12px");
  ok("Skills opens (demo)", await go(demo.page, "skills"));
  await demo.page.waitForTimeout(800);
  const sk = await main(demo.page);
  ok("no invented target", !/Target: 90/.test(sk) && !/Target/.test(sk));
  const axes = demo.page.locator('[data-testid="skill-axis"]');
  ok("each bar has an axis", await axes.count() > 0);
  const axis = await axes.evaluateAll((els) => els.map((e) => ({ t: e.innerText.replace(/\s+/g, " ").trim(),
    fs: Math.min(...[...e.querySelectorAll("span")].map((s) => parseFloat(getComputedStyle(s).fontSize))) })));
  ok("...which reads 1 and 20", axis.length > 0 && axis.every((a) => a.t === "1 20"), JSON.stringify(axis[0]));
  ok("...at 12px or more", axis.length > 0 && axis.every((a) => a.fs >= 12), JSON.stringify(axis[0]));

  // ── 7. Fields ─────────────────────────────────────────────────────
  group("The Fields pitch drawing is the same on every render");
  ok("Fields opens (demo)", await go(demo.page, "fields"));
  ok("the pitches tab opens", await click(demo.page, /^pitches$/i, 4000));
  const strips = demo.page.locator("button", { hasText: /^Strip \d+$/ });
  const nStrips = await strips.count();
  const cracks = () => tid(demo.page, "pitch-crack").evaluateAll((ls) => ls.map((l) => ["x1", "y1", "x2", "y2"].map((a) => l.getAttribute(a)).join(",")).join(" | "));
  let withCracks = null, seen = "";
  for (let i = 0; i < nStrips; i++) {
    await strips.nth(i).click();
    await demo.page.waitForTimeout(300);
    seen = await cracks();
    if (seen) { withCracks = i; break; }
  }
  ok("a strip with cracks is drawn", withCracks != null && seen.length > 0);
  if (withCracks != null) {
    const again = [];
    for (let k = 0; k < 3; k++) {
      // Another strip and back, a new render each time.
      await strips.nth(withCracks === 0 ? Math.min(1, nStrips - 1) : 0).click(); await demo.page.waitForTimeout(250);
      await strips.nth(withCracks).click(); await demo.page.waitForTimeout(250);
      again.push(await cracks());
    }
    ok("...the same cracks on three more renders", again.every((c) => c === seen), `${seen} vs ${again.join(" ; ")}`);
  }

  for (const [who, c] of [["director", dir], ["coach", coach], ["demonstration", demo]]) {
    ok(`the ${who}'s session raised no page errors`, c.errors.length === 0, c.errors.slice(0, 2).join(" · "));
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e);
} finally {
  await q(`delete from match_availability where match_id in (select id from match where opponent = 'Cleanup Walk XI')`).catch(() => {});
  await q(`delete from match where opponent = 'Cleanup Walk XI'`).catch(() => {});
  if (!movedBack) await q(`update player set team_code = '1XI' where id = $1`, [PILLAY]).catch(() => {});
  for (const c of all) await c.ctx.close().catch(() => {});
  await browser.close();
  await pool.end();
  web.close();
  apiProc.kill();
}

if (apiErr.join("").match(/Error/)) console.log(apiErr.join("").slice(0, 1500));
console.log("\n" + "─".repeat(52));
console.log(`BROWSER CLEANUP: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

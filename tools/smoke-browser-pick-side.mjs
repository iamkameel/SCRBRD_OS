#!/usr/bin/env node
/**
 * Pick the side, from a browser (the screen where a coach names the XI for a
 * fixture: views/cockpit/PickSide.jsx, from the Coach tab's side panel and from
 * the Match Centre's Match Details). tools/smoke-squad.mjs proves the route and
 * its two triggers; this drives the screen and holds it to them, with the
 * seed's invented people and boys made up for the walk:
 *
 *   1. THE COACH of the U14A names an XI with a batting order and a twelfth man.
 *      The Coach tab said "No sheet has been published"; he picks eleven (the
 *      twelfth boy is refused a place by the screen itself), swaps two numbers
 *      through a clash the screen names, names a twelfth, saves. The database
 *      holds the side in that order, and the Coach tab shows it WITHOUT a reload
 *      (a marker on window survives). Each boy's answer for the day is beside him;
 *      the reason a family gave is nowhere on the screen.
 *   2. MATCH DETAILS offers the same screen, and shows the side that stands.
 *   3. A BOY TOO OLD for the age group is refused with the trigger's own words
 *      beside him; nothing is saved and the old side stands, row for row.
 *   4. DUPLICATE BATTING NUMBERS are said before anything is sent: no request
 *      reaches /squad, and the database is unchanged.
 *   5. A good change is saved from Match Details and is on the Coach tab.
 *   6. A COACH OF ANOTHER TEAM, and A PARENT, are offered nothing, and a forced
 *      post to the route is a 403 with the side untouched; signed out, a 401.
 *   7. Floors: nothing read under 12px, nothing tapped under 44px, at 1280
 *      (Floodlit) and 390 (Daylight), nothing wider than the screen.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-pick-side.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { appUrl, ownerUrl, port } from "./db-url.mjs";

const WEB_PORT = port(4390);
const API_PORT = port(8990);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const HIL = "11111111-1111-1111-1111-111111111111";
const U14_COACH = "88888888-0000-0000-0000-00000000000b";   // T Ndlovu, coach of U14A at Hilton
const GUARDIAN = "88888888-0000-0000-0000-0000000000f5";
const PRIVATE = "A private reason the family gave";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-pick-side-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const owner = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await owner.query(text, params)).rows;
const browser = await chromium.launch({ ...launchOptions() });

const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-pick-side" } })).body?.token;

async function open({ width = 1280, height = 900, theme = "floodlit" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme === "daylight" ? "light" : "dark",
    ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [], posts = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("request", (r) => { if (r.method() === "POST" && /\/squad$/.test(new URL(r.url()).pathname)) posts.push(r.postData()); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};
    try { localStorage.setItem("scrbrd:theme", ${JSON.stringify(theme)}); } catch (e) {}`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, posts };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const text = (page) => page.$eval("body", (el) => el.innerText);
const inner = (page, id) => tid(page, id).first().innerText({ timeout: 4000 }).catch(() => "");
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
  await page.waitForTimeout(2200);
  return (await tid(page, "os-main").count()) === 1;
}
async function go(page, key) {
  const l = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"]`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1600);
  return true;
}
async function openMatch(page, id) {
  if (!(await go(page, "matches"))) return false;
  const btn = tid(page, `mc-open-${id}`);
  if (!(await btn.count())) return false;
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(1800);
  return (await tid(page, "match-view").count()) === 1;
}
async function coachTab(page) {
  await tid(page, "mc-tab-coach").click({ timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => { const t = document.querySelector('[data-testid="mc-coach"]'); return t && !document.querySelector('[data-testid="mc-coach-loading"]'); }, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(500);
}
/** The Pick the side dialog, its boys read. */
async function dialog(page) {
  await page.waitForSelector('[data-testid="pick-side"] [data-testid^="pick-xi-"]', { timeout: 8000 }).catch(() => {});
  return (await tid(page, "pick-side").count()) === 1;
}
/** The live side in the database: [name, battingNo, twelfth], in order. */
const side = async (match) => (await q(
  `select p.full_name as n, s.batting_no as no, s.twelfth as t from match_squad s join player p on p.id = s.player_id
    where s.match_id = $1 and not s.withdrawn order by s.twelfth, s.batting_no, p.full_name`, [match])).map((r) => `${r.n}|${r.no}|${r.t}`);
/** Text under 12px and controls under 44px inside one block, as drawn. */
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && cs.display !== "none" && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 43.5) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, wide: el.scrollWidth > el.clientWidth + 1, bg: getComputedStyle(document.body).backgroundColor };
  }).catch(() => ({ small: ["(not drawn)"], tiny: [], wide: false, bg: "" }));
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ══ The stage ══════════════════════════════════════════════════════════
  group("Set the stage: a U14A fixture three days off, thirteen registered boys and one far too old");
  await q(`insert into app_user (id, school_id, email, name, role) values ($1, $2, 'pick.parent@example.invalid', 'A Pick Parent', 'parent')`, [GUARDIAN, HIL]);
  const registrar = await login("registrar@example.invalid");
  const num = (i) => String(i).padStart(2, "0");
  /** @type {Record<string, string>} */
  const boy = {};
  for (let i = 1; i <= 13; i++) {
    // Born a little under thirteen: well inside U14, a minor, so each needs a verified guardian and consent.
    const id = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born) values ($1, 'U14A', $2, $3, 'batter', current_date - interval '12 years 6 months') returning id`,
      [HIL, `Verify Pick ${num(i)}`, 80 + i]))[0].id;
    boy[num(i)] = id;
    await call(`/api/players/${id}/guardians`, { method: "POST", token: registrar, body: { guardianId: GUARDIAN, relationship: "parent" } });
    await call(`/api/players/${id}/guardians/verify`, { method: "POST", token: registrar, body: { guardianId: GUARDIAN, consentVersion: "popia-2026-01" } });
  }
  // Twenty and on the U14A's list: an adult, so registered, and nowhere near U14.
  boy.old = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born) values ($1, 'U14A', 'Verify Pick Old', 99, 'batter', current_date - interval '20 years') returning id`, [HIL]))[0].id;
  const M = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, 'U14A', 'Verify Pick XI', now() + interval '3 days', 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL]))[0].id;
  // Two answers for the day, one with a reason that must never be drawn.
  await q(`insert into match_availability (match_id, player_id, school_id, status, reason_kind, note, declared_by) values ($1, $2, $4, 'unavailable', 'family', $5, $6), ($1, $3, $4, 'available', null, null, $6)`,
    [M, boy["01"], boy["02"], HIL, PRIVATE, U14_COACH]);
  ok("the stage is set", !!M && Object.keys(boy).length === 14);
  ok("no side has been named", (await side(M)).length === 0);

  // ══ 1. The coach names the side from the Coach tab ═════════════════════
  group("1. The U14A coach names an XI, a batting order and a twelfth from the Coach tab");
  const c = await open();
  ok("the coach signs in", await signIn(c.page, "u14coach@example.invalid"));
  ok("he opens the fixture", await openMatch(c.page, M));
  await coachTab(c.page);
  ok("the Coach tab says no sheet has been published", /No sheet has been published for this fixture\./.test(await inner(c.page, "coach-side")));
  ok("...and offers Pick the side", (await inner(c.page, "pick-side-open")).trim() === "Pick the side");
  await c.page.evaluate(() => { window.__marker = "same page"; });
  await tid(c.page, "pick-side-open").click();
  ok("the dialog opens with the team", await dialog(c.page));
  ok("...fourteen boys, by name", await c.page.locator('[data-testid="pick-side"] li').count() === 14);
  ok("...titled Pick the side", (await c.page.locator("#pick-side-title").innerText()).trim() === "Pick the side");
  const dlg0 = await text(c.page);
  ok("each boy's answer for the day is beside him", /unavailable/.test(await inner(c.page, `pick-state-${boy["01"]}`)) && /^available/.test(await inner(c.page, `pick-state-${boy["02"]}`)) && /no answer/.test(await inner(c.page, `pick-state-${boy["03"]}`)));
  ok("the reason a family gave is nowhere on the screen", !dlg0.includes(PRIVATE) && !/funeral|family/i.test(await inner(c.page, "pick-side")));
  const f1 = await floors(c.page, "pick-side");
  ok(`1280 Floodlit: nothing under 12px (${f1.small.length}), nothing tapped under 44px (${f1.tiny.length}), nothing wider than the dialog (${f1.wide})`, !f1.small.length && !f1.tiny.length && !f1.wide, [...f1.small, ...f1.tiny].slice(0, 4).join(" · "));

  for (let i = 1; i <= 11; i++) await tid(c.page, `pick-xi-${boy[num(i)]}`).click();
  ok("eleven are in the XI, numbered 1 to 11 as picked", await c.page.locator('[data-testid="pick-side"] li[data-picked="xi"]').count() === 11
    && (await tid(c.page, `pick-no-${boy["11"]}`).inputValue()) === "11" && (await tid(c.page, `pick-no-${boy["01"]}`).inputValue()) === "1");
  ok("the twelfth boy cannot be added to a full XI", await tid(c.page, `pick-xi-${boy["12"]}`).isDisabled());
  ok("...and the foot says the XI is full", /11 in the XI\. The XI is full/.test(await inner(c.page, "pick-side-foot")));
  // Swap numbers 1 and 11: the first move clashes, and the screen says so beside both boys.
  await tid(c.page, `pick-no-${boy["01"]}`).selectOption("11");
  ok("a clash is named beside both boys before anything is sent", /same batting number/.test(await inner(c.page, `pick-note-${boy["01"]}`)) && /same batting number/.test(await inner(c.page, `pick-note-${boy["11"]}`)));
  await tid(c.page, `pick-no-${boy["11"]}`).selectOption("1");
  ok("...and when it is put right the words go", await tid(c.page, `pick-note-${boy["01"]}`).count() === 0 && await tid(c.page, `pick-note-${boy["11"]}`).count() === 0);
  await tid(c.page, `pick-twelfth-${boy["12"]}`).click();
  ok("a twelfth man is named", (await tid(c.page, `pick-twelfth-${boy["12"]}`).getAttribute("aria-pressed")) === "true"
    && /twelfth man: Verify Pick 12/.test(await inner(c.page, "pick-side-foot")));
  await tid(c.page, "pick-side-save").click();
  await c.page.waitForFunction(() => !document.querySelector('[data-testid="pick-side"]'), null, { timeout: 8000 }).catch(() => {});
  ok("saved: the dialog closes", await tid(c.page, "pick-side").count() === 0);
  const want1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `Verify Pick ${num(i)}|${i === 1 ? 11 : i === 11 ? 1 : i}|false`);
  const have1 = await side(M);
  ok("the database holds the side in that order, with the twelfth and no number for him",
    have1.length === 12 && have1[0] === "Verify Pick 11|1|false" && have1[10] === "Verify Pick 01|11|false" && have1[11] === "Verify Pick 12|null|true"
    && want1.every((w) => have1.includes(w)), have1.join(" ; "));
  await c.page.waitForTimeout(800);
  const sideText = await inner(c.page, "coach-side");
  ok("the Coach tab shows the sheet, with no reload", (await c.page.evaluate(() => window.__marker)) === "same page"
    && await tid(c.page, `coach-side-${boy["11"]}`).count() === 1 && await tid(c.page, `coach-side-${boy["12"]}`).count() === 1 && !/No sheet has been published/.test(sideText), sideText.slice(0, 200));
  ok("...in batting order: number 1 first, the twelfth last", await c.page.$$eval('[data-testid^="coach-side-"][data-state]', (els) => els.map((e) => e.getAttribute("data-testid"))).then((ids) => ids[0] === `coach-side-${boy["11"]}` && ids.at(-1) === `coach-side-${boy["12"]}`));
  ok("...its foot counts twelve named", /^12 named/.test(await inner(c.page, "coach-side-foot")));
  ok("...and the button now says Change the side", (await inner(c.page, "pick-side-open")).trim() === "Change the side");
  ok("no page errors", c.errors.length === 0, c.errors.join(" | "));
  await c.ctx.close();

  // ══ 2 to 5. Match Details ══════════════════════════════════════════════
  group("2. Match Details offers the screen and shows the side that stands");
  const d = await open();
  await signIn(d.page, "u14coach@example.invalid");
  await go(d.page, "matches");
  await tid(d.page, `match-card-${M}`).click();
  await d.page.waitForTimeout(800);
  ok("the fixture's Match Details has Pick the side", await tid(d.page, "pick-side-entry").count() === 1);
  await tid(d.page, "pick-side-entry").click();
  ok("it opens", await dialog(d.page));
  ok("the title says Change the side, and the side that stands is shown", /^Change the side$/.test((await d.page.locator("#pick-side-title").innerText()).trim())
    && await d.page.locator('[data-testid="pick-side"] li[data-picked="xi"]').count() === 11 && (await tid(d.page, `pick-twelfth-${boy["12"]}`).getAttribute("aria-pressed")) === "true");
  ok("...each boy at the number the database holds", (await tid(d.page, `pick-no-${boy["11"]}`).inputValue()) === "1" && (await tid(d.page, `pick-no-${boy["01"]}`).inputValue()) === "11" && (await tid(d.page, `pick-no-${boy["07"]}`).inputValue()) === "7");

  group("3. A boy too old for the age group is refused in the trigger's words, beside him");
  const before = await side(M);
  await tid(d.page, `pick-xi-${boy["03"]}`).click();                 // number 3 is freed
  await tid(d.page, `pick-xi-${boy.old}`).click();                   // the twenty-year-old takes it
  ok("he is in the draft at number 3", (await tid(d.page, `pick-no-${boy.old}`).inputValue()) === "3");
  d.posts.length = 0;
  await tid(d.page, "pick-side-save").click();
  await d.page.waitForTimeout(1200);
  const refused = await inner(d.page, `pick-note-${boy.old}`);
  ok("the screen is still open", await tid(d.page, "pick-side").count() === 1);
  ok("the trigger's own words are beside him", /Verify Pick Old is \d+ on 1 January and cannot play U14A: the limit is 14/.test(refused), refused);
  ok("...and no other boy carries it", await d.page.locator('[data-testid^="pick-note-"]').count() === 1);
  ok("...and the foot says nothing was saved", /Nothing was saved/.test(await inner(d.page, "pick-side-said")));
  ok("one request was made, and it was refused", d.posts.length === 1);
  const after = await side(M);
  ok("the old side stands, row for row", JSON.stringify(after) === JSON.stringify(before), after.join(" ; "));
  ok("...and nothing was withdrawn along the way", (await q(`select count(*)::int n from match_squad where match_id = $1 and withdrawn`, [M]))[0].n === 0);
  await tid(d.page, `pick-xi-${boy.old}`).click();
  ok("taking him out clears the words", await d.page.locator('[data-testid^="pick-note-"]').count() === 0 && await tid(d.page, "pick-side-said").count() === 0);

  group("4. Duplicate batting numbers are refused before anything is sent");
  await tid(d.page, `pick-no-${boy["04"]}`).selectOption("5");
  ok("both boys on number 5 are named", /same batting number/.test(await inner(d.page, `pick-note-${boy["04"]}`)) && /same batting number/.test(await inner(d.page, `pick-note-${boy["05"]}`)));
  d.posts.length = 0;
  await tid(d.page, "pick-side-save").click();
  await d.page.waitForTimeout(800);
  ok("the foot says it in the route's words", /Two boys have the same batting number\. Each number goes to one boy\. Nothing was saved\./.test(await inner(d.page, "pick-side-said")));
  ok("no request reached the squad route", d.posts.length === 0, d.posts.join(" | "));
  ok("the database is unchanged", JSON.stringify(await side(M)) === JSON.stringify(before));
  const f2 = await floors(d.page, "pick-side");
  ok(`with words beside the boys: nothing under 12px (${f2.small.length}), nothing under 44px (${f2.tiny.length})`, !f2.small.length && !f2.tiny.length, [...f2.small, ...f2.tiny].slice(0, 4).join(" · "));

  group("5. A good change, saved from Match Details, is on the Coach tab");
  await tid(d.page, `pick-no-${boy["04"]}`).selectOption("4");
  await tid(d.page, `pick-xi-${boy["13"]}`).click();                  // takes the number 3 left free
  ok("the new boy takes the free number", (await tid(d.page, `pick-no-${boy["13"]}`).inputValue()) === "3");
  d.posts.length = 0;
  await tid(d.page, "pick-side-save").click();
  await d.page.waitForFunction(() => !document.querySelector('[data-testid="pick-side"]'), null, { timeout: 8000 }).catch(() => {});
  ok("saved: it closes, and Match Details says so", await tid(d.page, "pick-side").count() === 0 && /The side was saved/.test(await inner(d.page, "pick-side-entry-saved")));
  ok("focus came back to the button that opened it", await d.page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "pick-side-entry");
  const now = await side(M);
  ok("the database: Pick 03 is out and Pick 13 is in at number 3", now.length === 12 && !now.some((s) => s.startsWith("Verify Pick 03|")) && now.includes("Verify Pick 13|3|false") && now.includes("Verify Pick 12|null|true"), now.join(" ; "));
  ok("...the dropped boy is withdrawn, not deleted", (await q(`select count(*)::int n from match_squad where match_id = $1 and player_id = $2 and withdrawn`, [M, boy["03"]]))[0].n === 1);
  await d.page.keyboard.press("Escape").catch(() => {});
  await openMatch(d.page, M);
  await coachTab(d.page);
  ok("the Coach tab shows the change", await tid(d.page, `coach-side-${boy["13"]}`).count() === 1 && await tid(d.page, `coach-side-${boy["03"]}`).count() === 0);
  ok("no page errors", d.errors.length === 0, d.errors.join(" | "));
  await d.ctx.close();

  // ══ 6. Who is not offered it ═══════════════════════════════════════════
  group("6. A coach of another team and a parent are offered nothing, and a forced post is refused");
  const keep = await side(M);
  const lineup = [1, 2, 4].map((i, k) => ({ playerId: boy[num(i)], battingNo: k + 1 }));
  const o = await open();
  ok("the 1XI coach signs in", await signIn(o.page, "coach@example.invalid"));
  await go(o.page, "matches");
  const there = await tid(o.page, `match-card-${M}`).count();
  if (there) { await tid(o.page, `match-card-${M}`).click(); await o.page.waitForTimeout(700); }
  ok("he is offered no Pick the side in Match Details", await tid(o.page, "pick-side-entry").count() === 0, `card on his list: ${there}`);
  if (there && await openMatch(o.page, M)) {
    ok("...and the fixture has no Coach tab for him", await tid(o.page, "mc-tab-coach").count() === 0 && await tid(o.page, "pick-side-open").count() === 0);
  } else ok("...and the fixture is not his to open", true);
  ok("...Pick the side is nowhere on his screen", !/Pick the side|Change the side/.test(await text(o.page)));
  await o.ctx.close();
  const other = await login("coach@example.invalid");
  const forcedCoach = await call(`/api/matches/${M}/squad`, { method: "POST", token: other, body: { side: "home", players: lineup } });
  ok("his forced post to the route is a 403", forcedCoach.status === 403, JSON.stringify(forcedCoach));
  ok("...and the side is untouched", JSON.stringify(await side(M)) === JSON.stringify(keep));

  const p = await open();
  ok("a parent signs in", await signIn(p.page, "parent@example.invalid"));
  await go(p.page, "matches").catch(() => {});
  ok("she is offered no Pick the side anywhere", !/Pick the side|Change the side/.test(await text(p.page)) && await tid(p.page, "pick-side-entry").count() === 0 && await tid(p.page, "pick-side-open").count() === 0);
  await p.ctx.close();
  const mum = await login("parent@example.invalid");
  const forcedParent = await call(`/api/matches/${M}/squad`, { method: "POST", token: mum, body: { side: "home", players: lineup } });
  ok("her forced post to the route is a 403", forcedParent.status === 403, JSON.stringify(forcedParent));
  // The age check fires before the insert policy, so the route asks for
  // team.select first: a boy too old for the side, posted by someone who may
  // not name it, is a bare 403 and never the trigger's sentence with his name.
  for (const [who, tok] of [["the other coach", other], ["the parent", mum]]) {
    const probe = await call(`/api/matches/${M}/squad`, { method: "POST", token: tok, body: { side: "home", players: [{ playerId: boy.old, battingNo: 1 }] } });
    ok(`${who}'s post of the too-old boy is a 403 that names nobody`, probe.status === 403 && !/Verify Pick Old|on 1 January/.test(JSON.stringify(probe)), JSON.stringify(probe));
  }
  const signedOut = await call(`/api/matches/${M}/squad`, { method: "POST", body: { side: "home", players: lineup } });
  ok("signed out, it is a 401", signedOut.status === 401, JSON.stringify(signedOut));
  ok("...and the side is untouched", JSON.stringify(await side(M)) === JSON.stringify(keep));

  // ══ 7. A phone, in Daylight ════════════════════════════════════════════
  group("7. At 390 wide, in Daylight");
  const ph = await open({ width: 390, height: 844, theme: "daylight" });
  ok("the coach signs in on a phone", await signIn(ph.page, "u14coach@example.invalid"));
  ok("he opens the fixture", await openMatch(ph.page, M));
  await coachTab(ph.page);
  const fp0 = await floors(ph.page, "mc-coach");
  ok(`the Coach tab, with the new button: nothing under 12px (${fp0.small.length}), nothing under 44px (${fp0.tiny.length}), nothing wider (${fp0.wide})`, !fp0.small.length && !fp0.tiny.length && !fp0.wide, [...fp0.small, ...fp0.tiny].slice(0, 4).join(" · "));
  await tid(ph.page, "pick-side-open").click();
  ok("the dialog opens on a phone, and shows the side that stands", await dialog(ph.page) && await ph.page.locator('[data-testid="pick-side"] li[data-picked="xi"]').count() === 11);
  const fp = await floors(ph.page, "pick-side");
  ok(`the dialog: nothing under 12px (${fp.small.length}), nothing tapped under 44px (${fp.tiny.length}), nothing wider than the screen (${fp.wide})`, !fp.small.length && !fp.tiny.length && !fp.wide, [...fp.small, ...fp.tiny].slice(0, 4).join(" · "));
  ok("Daylight draws it on a light page", /rgb\((2[0-9]{2}|1[89][0-9]), /.test(fp.bg), fp.bg);
  ok("the save button and the list are both reachable without leaving the dialog", await ph.page.evaluate(() => {
    const dlg = document.querySelector('[data-testid="pick-side"]'), save = document.querySelector('[data-testid="pick-side-save"]');
    const r = dlg.getBoundingClientRect(), s = save.getBoundingClientRect();
    return s.bottom <= r.bottom + 1 && s.top >= r.top && r.width <= window.innerWidth;
  }));
  await ph.page.keyboard.press("Escape");
  await ph.page.waitForTimeout(300);
  ok("Escape closes it, and focus comes back to its button", await tid(ph.page, "pick-side").count() === 0 && await ph.page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "pick-side-open");
  ok("closing saved nothing", JSON.stringify(await side(M)) === JSON.stringify(keep));
  ok("no page errors on the phone", ph.errors.length === 0, ph.errors.join(" | "));
  await ph.ctx.close();

  ok("the API raised nothing unexpected", !apiErr.join("").match(/Unhandled|TypeError|ReferenceError/), apiErr.join("").slice(0, 300));
} catch (e) {
  fail++;
  console.log("  ✗ the walk itself threw", e?.stack ?? e);
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill();
  await owner.end().catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

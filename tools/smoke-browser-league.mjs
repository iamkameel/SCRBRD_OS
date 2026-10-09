#!/usr/bin/env node
/**
 * Making a league and planning its fixtures, in a real browser (SCRBRD-127 the
 * league wizard, SCRBRD-123 the fixture planner screen), against a real API and
 * Postgres. tools/smoke-competition.mjs walks the same routes from a script;
 * this walks the screens a league administrator, two schools and a ground
 * owner use.
 *
 *   A  THE LEAGUE ADMINISTRATOR'S WIZARD. Competitions → "+ New Competition":
 *      step 1 makes the league; step 2 invites four teams (two each at Hilton
 *      and Westville) and says, in words, that the organiser cannot accept for
 *      a school; step 3 starts the conditions from the Laws and the platform's
 *      defaults (the bowling limits by band, sourced exactly as the API words
 *      them, never as CSA), ticks a default, enters points 4/2/2/0 (one with a
 *      document, clause and date) and a super over tie break; step 4 says a
 *      start today is refused before submit, is refused in words when tried,
 *      and publishes from tomorrow.
 *   B  THE SCHOOLS ANSWER. Hilton's director of sport accepts both sides from
 *      "Invitations to leagues"; Westville's administrator accepts one and
 *      declines the other (after an in-page question). The organiser's wizard
 *      then reads 3 accepted, 1 declined. A director of sport is offered no
 *      "+ New Competition".
 *   C  GROUND OWNERS. Hilton's director of sport offers three slots at the
 *      Oval (Fields → Fixture slots), closes it for a spell, and names its
 *      ends; Westville's offer is made by the API (the same routes).
 *   D  THE PLANNER. From the wizard's last step: a knockout shows the bracket
 *      ("Winner of R1 · Match 2"); a strict rest rule leaves a fixture with no
 *      slot and its reasons in words; a league blackout is added and removed;
 *      a round robin of the three that accepted places three fixtures; one is
 *      locked, the draw regenerated with the lock kept; it is published and the
 *      report says three created; a second publish of the same version changes
 *      nothing; the versions list shows published and replaced; the matches
 *      exist and there is none for the side that declined.
 *   E  COME BACK LATER. A league left after step 1 is reopened from the
 *      Competitions screen at the step it had reached.
 *      A league's card says where its setup stands (a league with no sides,
 *      or with sides and no conditions, says "Setting up: step N of 4" and
 *      keeps "Finish setting up"; a complete league has neither), and a failed
 *      read leaves a card as it was. The navigation badges Competitions with
 *      the invitations waiting (two, one, none once answered, none for the
 *      organiser, none when the read fails), named in words, on a laptop and a
 *      phone.
 *   F  Nothing is set under 12px, nothing pressed is under 44px, at a desktop,
 *      at 390 wide with no sideways scroll, and in Daylight.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-league.mjs
 *   BROWSER_LEAGUE_DEBUG=1 node tools/smoke-browser-league.mjs
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

const WEB_PORT = port(5393);
const API_PORT = port(8897);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_LEAGUE_DEBUG;
const DIST = process.env.LEAGUE_DIST || "apps/web/dist";
const HIL = "11111111-1111-1111-1111-111111111111";
const WM = "ffffffff-0000-0000-0000-000000000002";
const OVAL = "ffffffff-0000-0000-0000-000000000001";
const LEAGUE_NAME = "Walk Schools League";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-league-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  let body, type;
  try {
    const f = join(DIST, url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = TYPES[extname(f)] ?? "application/octet-stream";
  } catch {
    body = await readFile(join(DIST, "index.html"));
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, r));

const pool = new pg.Pool({ connectionString: ownerUrl() });
const dbq = async (text, params) => (await pool.query(text, params)).rows;
const call = async (path, { method = "GET", token, body } = {}) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
                                       body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const devLogin = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: `league-walk-${email}` } })).body?.token;

const browser = await chromium.launch({ ...launchOptions() });
let lastPage = null;
async function open(theme = "floodlit", viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await offline(ctx);
  const page = await ctx.newPage();
  lastPage = page;
  const errors = [];
  page.on("dialog", (d) => { d.dismiss().catch(() => {}); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};
    try { localStorage.setItem("scrbrd:theme", ${JSON.stringify(theme)}); } catch (e) {}`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const said = async (page, id) => ((await tid(page, id).first().innerText({ timeout: 2500 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
const has = async (page, id) => (await tid(page, id).count()) > 0;
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tap = async (page, id, ms = 5000) => { lastPage = page; await tid(page, id).first().click({ timeout: ms }); await page.waitForTimeout(350); };
const fill = async (page, id, v) => { await tid(page, id).first().fill(String(v)); };
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return (await page.locator("nav button").count()) > 0;
}
/** Every read the page has asked for has come back (and a moment for what it did with it). */
const settled = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(500); };
async function nav(page, label) {
  // GA-I30: Leagues is a section of the Competitions home, not a menu entry of its own.
  if (/Leagues/.test(String(label))) {
    // Inside the planner, the Competitions menu entry is the page already on
    // show, so it does not leave the planner: back out the way a user would.
    const back = page.locator('[data-testid="pl-back"]');
    if (await back.count()) { await back.first().click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(800); }
    if (!(await nav(page, /^Competitions\d*$/))) return false;
    // The home loads its section's screen lazily, so wait for it: either the
    // section switch (a reader with both) or League Management itself (a
    // reader whose only section is Leagues gets no switch).
    const s = page.locator('[data-testid="home-competitions-section-leagues"]');
    await page.waitForFunction((sel) => !!document.querySelector(sel) || /League Management/.test(document.body.innerText),
      '[data-testid="home-competitions-section-leagues"]', { timeout: 10000 }).catch(() => {});
    if (await s.count()) {
      try { await s.click({ timeout: 6000 }); } catch { return false; }
    }
    return page.waitForFunction(() => /League Management/.test(document.body.innerText), null, { timeout: 10000 })
      .then(() => true, async () => { if (process.env.LEAGUE_DEBUG) console.log("LEAGUE-DEBUG", JSON.stringify((await page.innerText("body")).slice(0, 600))); return false; });
  }
  const l = page.locator("nav button", { hasText: label }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return true;
}
/** Every text node under the root, and every control, measured as drawn. */
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA|SUMMARY)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio", "hidden"].includes(n.type)) || (n.tagName === "A" && n.getAttribute("href"))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, bg: getComputedStyle(document.body).backgroundColor, sideways: document.documentElement.scrollWidth - window.innerWidth };
  }).catch(() => ({ small: ["(not drawn)"], tiny: [], bg: "", sideways: 0 }));
}
const shot = async (page, name) => { if (process.env.BROWSER_LEAGUE_SHOTS) await page.screenshot({ path: join(process.env.BROWSER_LEAGUE_SHOTS, `${name}.png`), fullPage: true }).catch(() => {}); };
const floorsOk = (f) => f.small.length === 0 && f.tiny.length === 0;
const floorsWhy = (f) => [...f.small, ...f.tiny].slice(0, 4).join(" · ");

/** Enter one figure of the checklist through its editor. */
async function enter(page, key, { band, value, status = "unconfirmed", doc, clause, docDate }) {
  const suffix = band ? `${key}-${band}` : key;
  await tap(page, `pc-enter-${suffix}`);
  const ed = tid(page, `pc-editor-${suffix}`);
  if (value !== undefined) {
    const f = ed.locator('[data-testid="pc-f-value"]');
    if ((await f.evaluate((n) => n.tagName)) === "SELECT") await f.selectOption(String(value)); else await f.fill(String(value));
  }
  if (status === "confirmed") await ed.locator('[data-testid="pc-status-confirmed"]').click();
  if (doc !== undefined) await ed.locator('[data-testid="pc-f-doc"]').fill(doc);
  if (clause !== undefined) await ed.locator('[data-testid="pc-f-clause"]').fill(clause);
  if (docDate !== undefined) await ed.locator('[data-testid="pc-f-docdate"]').fill(docDate);
  await ed.locator('[data-testid="pc-save"]').click();
  await page.waitForTimeout(800);
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const [{ today }] = await dbq(`select sa_today()::text as today`);
  const dayOf = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const at = (day, hhmm) => `${day}T${hhmm}:00+02:00`;
  const wesAdmin = await devLogin("registrar.wes@example.invalid");

  // ── A ──────────────────────────────────────────────────────────
  group("A. The league administrator's wizard");
  const org = await open();
  ok("the league administrator signs in", await signIn(org.page, "league@example.invalid"));
  ok("Competitions opens", await nav(org.page, /^Competitions\d*$/));
  ok("\"+ New Competition\" is offered to a holder of competition.manage", await has(org.page, "new-competition"));
  await tap(org.page, "new-competition");
  ok("the wizard opens at step 1 of 4", await has(org.page, "lw-root") && /Step 1 of 4: The league/.test(await said(org.page, "lw-root")), await said(org.page, "lw-heading"));
  const steps = await org.page.locator('[data-testid="lw-steps"] li').count();
  ok("a step indicator shows the four steps, this one current",
     steps === 4 && (await tid(org.page, "lw-step-1").getAttribute("aria-current")) === "step", steps);
  ok("overs are not asked for: the page says they come from the format", /Overs are not typed here/.test(await said(org.page, "lw-overs-note")));
  await fill(org.page, "lw-name", LEAGUE_NAME);
  await tid(org.page, "lw-season").selectOption("2026");
  await fill(org.page, "lw-age", "1XI");
  await tid(org.page, "lw-gender").selectOption("boys");
  await tid(org.page, "lw-format").selectOption("T20");
  await shot(org.page, "1-league");
  await tap(org.page, "lw-league-next");
  await org.page.waitForTimeout(800);
  ok("the league is made and step 2 opens", await has(org.page, "lw-entrants") && /was made/.test(await said(org.page, "lw-status")), await said(org.page, "lw-status"));
  const [made] = await dbq(`select id, school_id, format, age_group, gender, level from competition where name = $1`, [LEAGUE_NAME]);
  ok("...a T20 league with no organising school, for the 1XI", made && made.school_id === null && made.format === "T20" && made.age_group === "1XI" && made.gender === "boys", JSON.stringify(made));
  const C = made?.id;

  // Step 2: four teams.
  const schoolOption = async (re) => tid(org.page, "lw-school").locator("option").evaluateAll((os, src) => os.find((o) => new RegExp(src).test(o.textContent))?.value ?? "", re.source);
  for (const [re, team] of [[/Hilton/, "1XI"], [/Hilton/, "2XI"], [/Westville/, "1XI"], [/Westville/, "2XI"]]) {
    await tid(org.page, "lw-school").selectOption(await schoolOption(re));
    await fill(org.page, "lw-team", team);
    await tap(org.page, "lw-invite");
    await org.page.waitForTimeout(500);
  }
  ok("four teams are invited and the page counts them as waiting", /0 accepted, 0 declined, 4 waiting/.test(await said(org.page, "lw-entrant-summary")), await said(org.page, "lw-entrant-summary"));
  ok("each invited side is worded as waiting for its school", (await tid(org.page, "lw-entrant-invited").count()) === 4
     && /Waiting for the school to answer/.test(await said(org.page, "lw-entrant-words")));
  const cannot = await said(org.page, "lw-cannot-accept");
  ok("the organiser is told, in words, that she cannot accept for a school",
     /cannot accept for a school/.test(cannot) && /you cannot accept on its behalf/.test(await said(org.page, "lw-entrant-words")), cannot);
  ok("...and no Accept control is offered to her", (await org.page.locator("button", { hasText: /^Accept$/ }).count()) === 0);
  await tid(org.page, "lw-team").fill("Firsts");
  await tid(org.page, "lw-school").selectOption(await schoolOption(/Hilton/));
  await tap(org.page, "lw-invite");
  ok("a team that is not a team is refused in words", /not a team/.test(await said(org.page, "lw-invite-error")), await said(org.page, "lw-invite-error"));
  await shot(org.page, "2-entrants");
  const fEnt = await floors(org.page, "lw-root");
  ok("step 2: nothing under 12px, nothing pressed under 44px", floorsOk(fEnt), floorsWhy(fEnt));

  // ── B ──────────────────────────────────────────────────────────
  group("B. The schools answer");
  const hil = await open();
  ok("Hilton's director of sport signs in", await signIn(hil.page, "sarah@example.invalid"));
  ok("Competitions opens", await nav(hil.page, /^Competitions\d*$/));
  ok("...without \"+ New Competition\" (no competition.manage)", !(await has(hil.page, "new-competition")));
  ok("\"Invitations to leagues\" shows the two Hilton sides, and only those",
     (await tid(hil.page, "invitation").count()) === 2 && (await hil.page.locator('[data-testid="invitation"]', { hasText: /Westville/ }).count()) === 0, await said(hil.page, "invitations"));
  ok("...each naming the league", /Walk Schools League/.test(await said(hil.page, "invitation")));
  await shot(hil.page, "3-invitations");
  const fInv = await floors(hil.page, "invitations");
  ok("the invitations: 12px and 44px", floorsOk(fInv), floorsWhy(fInv));
  // The navigation says so without opening Competitions (the API writes no notification yet).
  await settled(hil.page);
  ok("the navigation badges Competitions with the count, in words a screen reader hears",
     (await said(hil.page, "nav-invites-badge")) === "2" && (await tid(hil.page, "nav-competitions").getAttribute("aria-label")) === "Competitions, 2 league invitations waiting",
     `${await said(hil.page, "nav-invites-badge")} | ${await tid(hil.page, "nav-competitions").getAttribute("aria-label")}`);
  ok("...the badge's own text is 12px at the least", (await tid(hil.page, "nav-invites-badge").evaluate((n) => parseFloat(getComputedStyle(n).fontSize))) >= 12);
  await tap(hil.page, "invitation-accept");
  await tap(hil.page, "invitation-accept");
  ok("Hilton accepts both; the page says so", (await tid(hil.page, "invitation").count()) === 0 && /is now in Walk Schools League/.test(await said(hil.page, "invitations-status")), await said(hil.page, "invitations-status"));
  await settled(hil.page);
  ok("...and the badge goes with them", !(await has(hil.page, "nav-invites-badge")) && (await tid(hil.page, "nav-competitions").getAttribute("aria-label")) === null);
  await hil.ctx.close().catch(() => {});

  const wes = await open();
  ok("Westville's administrator signs in", await signIn(wes.page, "registrar.wes@example.invalid"));
  ok("Competitions opens", await nav(wes.page, /^Competitions\d*$/));
  ok("two invitations, both Westville's", (await tid(wes.page, "invitation").count()) === 2);
  await settled(wes.page);
  ok("Westville's navigation badges the two", (await said(wes.page, "nav-invites-badge")) === "2" && (await tid(wes.page, "nav-competitions").getAttribute("aria-label")) === "Competitions, 2 league invitations waiting");
  const w1 = wes.page.locator('[data-testid="invitation"]', { hasText: /1XI/ });
  const w2 = wes.page.locator('[data-testid="invitation"]', { hasText: /2XI/ });
  await w1.locator('[data-testid="invitation-accept"]').click(); await wes.page.waitForTimeout(700);
  await w2.locator('[data-testid="invitation-decline"]').click(); await wes.page.waitForTimeout(300);
  ok("declining asks once, in the page, first", await has(wes.page, "invitation-decline-confirm") && (await wes.page.locator("button", { hasText: /Decline the invitation/ }).count()) === 1);
  await tap(wes.page, "invitation-decline-yes"); await wes.page.waitForTimeout(700);
  ok("Westville accepts its 1st XI and declines its 2nd XI", /declined Walk Schools League/.test(await said(wes.page, "invitations-status")) && (await tid(wes.page, "invitation").count()) === 0, await said(wes.page, "invitations-status"));
  await settled(wes.page);
  ok("...and none once both are answered", !(await has(wes.page, "nav-invites-badge")));
  const answers = await dbq(`select team_code, school_id, status from competition_entrant where competition_id = $1 order by school_id, team_code`, [C]);
  ok("the database agrees: three accepted, one declined",
     answers.filter((a) => a.status === "accepted").length === 3 && answers.filter((a) => a.status === "declined").length === 1, JSON.stringify(answers));
  await wes.ctx.close().catch(() => {});

  await tap(org.page, "lw-refresh");
  await org.page.waitForTimeout(800);
  ok("back in the wizard: 3 accepted, 1 declined, 0 waiting", /3 accepted, 1 declined, 0 waiting/.test(await said(org.page, "lw-entrant-summary")), await said(org.page, "lw-entrant-summary"));
  ok("a declined side may be invited again", await has(org.page, "lw-invite-again"));

  // ── Step 3 ─────────────────────────────────────────────────────
  group("A (continued). Playing conditions, a checklist");
  await tap(org.page, "lw-next");
  ok("step 3 offers the two shortcuts", await has(org.page, "lw-start-defaults") && await has(org.page, "lw-start-copy")
     && /Start from the MCC Laws and platform defaults/.test(await said(org.page, "lw-start-defaults")) && /Copy from another league/.test(await said(org.page, "lw-start-copy")));
  ok("copying with no league chosen is not offered", await tid(org.page, "lw-start-copy").isDisabled());
  await tap(org.page, "lw-start-defaults");
  await org.page.waitForTimeout(1200);
  ok("started: the checklist is drawn, every catalogue key a row", await has(org.page, "lw-checklist-count")
     && (await org.page.locator('[data-testid^="lw-row-"]').count()) >= 20, await said(org.page, "lw-checklist-count"));
  const b13 = org.page.locator('[data-testid="lw-row-bowling.limit|U13"]');
  ok("the bowling limit shows per age band (U13 5 a spell, 10 a day)", (await b13.count()) === 1 && /5 overs a spell, 10 overs a day/.test(await b13.innerText()), await b13.innerText().catch(() => ""));
  const bandText = await b13.innerText().catch(() => "");
  ok("...its source is the API's own words: the platform's fast-bowling directive, unconfirmed", /Platform fast-bowling directive/.test(bandText) && /unconfirmed/i.test(bandText), bandText);
  const bandsPara = await said(org.page, "lw-bands-bowling.limit");
  ok("the page says the bowling defaults are ECB directives mapped onto school bands, not CSA figures",
     /ECB fast-bowling directives mapped onto school age bands/.test(bandsPara) && /not CSA figures/.test(bandsPara), bandsPara.slice(0, 300));
  ok("...and nowhere labels a default as a CSA figure", !/CSA (figure|limit|directive|default)s? (is|are|of)/i.test(await said(org.page, "lw-conditions")) );
  const stored = await dbq(`select v.source_note from condition_value v join condition_set s on s.id = v.set_id where s.competition_id = $1 and v.key = 'bowling.limit' and v.age_band = 'U13'`, [C]);
  ok("...exactly as the API returns it", stored[0] && bandText.replace(/\s+/g, " ").includes(stored[0].source_note.slice(0, 60).replace(/\s+/g, " ")), stored[0]?.source_note?.slice(0, 120));
  const tb = org.page.locator('[data-testid="lw-row-result.tie_break"]');
  ok("the tie break default cites the Laws (Law 16), unconfirmed", /Law 16/.test(await tb.innerText()) && /unconfirmed/i.test(await tb.innerText()));
  ok("no points are invented: the points rows read as the platform default, unconfirmed",
     /platform default, unconfirmed/i.test(await org.page.locator('[data-testid="lw-row-points.win"]').innerText()));
  // a tick
  await org.page.locator('[data-testid="lw-tick-format.kind"]').check();
  ok("ticking \"Use this default\" marks the row and keeps it unconfirmed",
     (await tid(org.page, "lw-row-format.kind").getAttribute("data-ticked")) === "yes" && /unconfirmed/i.test(await org.page.locator('[data-testid="lw-row-format.kind"]').innerText()));
  ok("...and the count follows", /1 using the default/.test(await said(org.page, "lw-checklist-count")), await said(org.page, "lw-checklist-count"));
  // own values
  await enter(org.page, "points.win", { value: 4, status: "confirmed", doc: "Walk League Rules", clause: "4.1", docDate: "2026-01-15" });
  await enter(org.page, "points.tie", { value: 2 });
  await enter(org.page, "points.no_result", { value: 2 });
  await enter(org.page, "points.loss", { value: 0 });
  await enter(org.page, "result.tie_break", { value: "super_over" });
  const pw = org.page.locator('[data-testid="lw-row-points.win"]');
  ok("points.win is confirmed with its document, clause and date", /Walk League Rules, clause 4\.1, 15 Jan 2026/.test(await pw.innerText()), await pw.innerText());
  ok("the other figures are the league's own, unconfirmed", /4 confirmed|1 confirmed/.test(await said(org.page, "lw-checklist-count")) && /entered unconfirmed/.test(await said(org.page, "lw-checklist-count")), await said(org.page, "lw-checklist-count"));
  ok("the tie break now reads super over", /Super over/.test(await tb.innerText()), await tb.innerText());
  const vals = await dbq(`select v.key, v.value::text, v.status from condition_value v join condition_set s on s.id = v.set_id where s.competition_id = $1 and v.key like 'points.%' order by v.key`, [C]);
  ok("the draft holds points 4/2/2/0", JSON.stringify(vals.map((v) => [v.key, v.value])) === JSON.stringify([["points.loss", "0"], ["points.no_result", "2"], ["points.tie", "2"], ["points.win", "4"]]), JSON.stringify(vals));
  // a confirmed figure with no citation is refused in words
  await tap(org.page, "pc-enter-points.draw");
  await org.page.locator('[data-testid="pc-editor-points.draw"] [data-testid="pc-f-value"]').fill("1");
  await org.page.locator('[data-testid="pc-editor-points.draw"] [data-testid="pc-status-confirmed"]').click();
  await org.page.locator('[data-testid="pc-editor-points.draw"] [data-testid="pc-save"]').click();
  await org.page.waitForTimeout(700);
  ok("a confirmed figure with no citation is refused, in words", /must say where it comes from/.test(await said(org.page, "pc-error-citation")), await said(org.page, "pc-error-citation"));
  await org.page.locator('[data-testid="pc-editor-points.draw"] [data-testid="pc-cancel"]').click();
  await tap(org.page, "lw-tick-all");
  ok("\"Use every default below\" ticks the rest", /0 unconfirmed and not yet checked|[1-9] using the default/.test(await said(org.page, "lw-checklist-count")), await said(org.page, "lw-checklist-count"));
  await shot(org.page, "4-conditions");
  const fCond = await floors(org.page, "lw-root");
  ok("step 3: nothing under 12px, nothing pressed under 44px", floorsOk(fCond), floorsWhy(fCond));

  // ── Step 4 ─────────────────────────────────────────────────────
  group("A (continued). Review and publish");
  await tap(org.page, "lw-next");
  ok("step 4 summarises the league, its entrants and its conditions",
     /Walk Schools League/.test(await said(org.page, "lw-sum-league")) && /3 accepted, 1 declined, 0 waiting/.test(await said(org.page, "lw-sum-entrants"))
     && /Version 1, a draft/.test(await said(org.page, "lw-sum-conditions")), await said(org.page, "lw-summary"));
  ok("before submit, it says a start today or earlier is refused", /A start today or earlier is refused/.test(await said(org.page, "lw-effective-note")));
  ok("the date defaults to tomorrow", (await tid(org.page, "lw-effective").inputValue()) === dayOf(1), await tid(org.page, "lw-effective").inputValue());
  await fill(org.page, "lw-effective", today);
  await tap(org.page, "lw-publish");
  await tap(org.page, "lw-publish-yes");
  await org.page.waitForTimeout(700);
  ok("publishing for today is refused, in words", /after today|Choose tomorrow or later/.test(await said(org.page, "lw-publish-error")), await said(org.page, "lw-publish-error"));
  await tap(org.page, "lw-publish-no");
  await fill(org.page, "lw-effective", dayOf(1));
  await tap(org.page, "lw-publish");
  await tap(org.page, "lw-publish-yes");
  await org.page.waitForTimeout(1200);
  ok("published from tomorrow, and the page offers the planner", await has(org.page, "lw-open-planner") && /is published, from/.test(await said(org.page, "lw-published")), await said(org.page, "lw-next"));
  const [pubSet] = await dbq(`select status, effective_from::text as eff from condition_set where competition_id = $1`, [C]);
  ok("the database: published, effective tomorrow", pubSet?.status === "published" && pubSet.eff === dayOf(1), JSON.stringify(pubSet));
  const fPub = await floors(org.page, "lw-root");
  ok("step 4: nothing under 12px, nothing pressed under 44px", floorsOk(fPub), floorsWhy(fPub));

  // ── C ──────────────────────────────────────────────────────────
  group("C. Ground owners: slots, a closure, the ends");
  const own = await open();
  ok("Hilton's director of sport signs in", await signIn(own.page, "sarah@example.invalid"));
  ok("Fields opens", await nav(own.page, /^Fields$/));
  await own.page.locator("button", { hasText: /Gordon Sherwood Oval/ }).first().click();
  await own.page.waitForTimeout(500);
  await tap(own.page, "fields-tab-offers");
  ok("\"Fixture slots\" opens the ground owner's panel", await has(own.page, "go-root") && await has(own.page, "go-offer") && await has(own.page, "go-close") && await has(own.page, "go-ends"));
  for (const n of [8, 15, 22]) {
    await fill(own.page, "go-slot-day", dayOf(n));
    await fill(own.page, "go-slot-start", "09:00");
    await fill(own.page, "go-slot-end", "13:00");
    await own.page.locator('[data-testid="go-slot-league"]').selectOption({ label: LEAGUE_NAME });
    await tap(own.page, "go-slot-add");
    await own.page.waitForTimeout(400);
  }
  ok("three slots are offered to the league and listed", (await tid(own.page, "go-window").count()) === 3 && /Offered/.test(await said(own.page, "go-status")), await said(own.page, "go-windows"));
  // a slot over a week is refused in words
  await fill(own.page, "go-slot-day", dayOf(40)); await fill(own.page, "go-slot-start", "13:00"); await fill(own.page, "go-slot-end", "09:00");
  await tap(own.page, "go-slot-add");
  ok("a slot that ends before it starts is refused, in words", /must end after it starts/.test(await said(own.page, "go-slot-error")), await said(own.page, "go-slot-error"));
  await fill(own.page, "go-close-from", dayOf(40)); await fill(own.page, "go-close-to", dayOf(41));
  await tap(own.page, "go-close-add");
  ok("a closure needs a reason, in words", /Say why/.test(await said(own.page, "go-close-error")), await said(own.page, "go-close-error"));
  await fill(own.page, "go-close-reason", "Outfield being relaid");
  await tap(own.page, "go-close-add");
  ok("the ground is closed for two days and the closure is listed", (await tid(own.page, "go-closure").count()) === 1 && /Outfield being relaid/.test(await said(own.page, "go-closures")), await said(own.page, "go-closures"));
  await fill(own.page, "go-end-a", "Pavilion End"); await fill(own.page, "go-end-b", "School End");
  await tap(own.page, "go-ends-save");
  const [ends] = await dbq(`select end_a_name, end_b_name from ground where id = $1`, [OVAL]);
  ok("the ends are named and kept", ends?.end_a_name === "Pavilion End" && ends?.end_b_name === "School End" && /Pavilion End and School End/.test(await said(own.page, "go-status")), JSON.stringify(ends));
  await fill(own.page, "go-end-b", "Pavilion End");
  await tap(own.page, "go-ends-save");
  ok("the same name twice is refused, in words", /Name both ends/.test(await said(own.page, "go-ends-error")), await said(own.page, "go-ends-error"));
  await shot(own.page, "5-ground");
  const fGo = await floors(own.page, "go-root");
  ok("the ground panel: 12px and 44px", floorsOk(fGo), floorsWhy(fGo));
  await own.ctx.close().catch(() => {});
  for (const n of [8, 15, 22]) {
    await call(`/api/grounds/${WM}/windows`, { method: "POST", token: wesAdmin, body: { startsAt: at(dayOf(n), "09:00"), endsAt: at(dayOf(n), "13:00"), competitionId: C } });
  }

  // ── D ──────────────────────────────────────────────────────────
  group("D. The fixture planner");
  await tap(org.page, "lw-open-planner");
  await tid(org.page, "pl-root").waitFor({ timeout: 8000 }).catch(() => {});
  await org.page.waitForTimeout(1200);
  ok("\"Open the fixture planner\" opens this league's planner", await has(org.page, "pl-root") && /Walk Schools League/.test(await said(org.page, "pl-heading")), await said(org.page, "pl-heading"));
  await fill(org.page, "pl-from", dayOf(7));
  await fill(org.page, "pl-to", dayOf(30));
  await org.page.waitForTimeout(1200);
  ok("the inputs list the six slots the grounds offered", (await tid(org.page, "pl-window").count()) === 6, await said(org.page, "pl-windows"));
  ok("...the closure is outside these days, so it is not listed", /No ground is closed in these days/.test(await said(org.page, "pl-closures")));
  ok("only the three sides that accepted are drawn", /3 sides have accepted/.test(await said(org.page, "pl-entrants-note")), await said(org.page, "pl-entrants-note"));

  // a knockout, for its bracket
  await tap(org.page, "pl-format-knockout");
  ok("a knockout offers the seed order", (await tid(org.page, "pl-seed").count()) === 3);
  await tap(org.page, "pl-generate");
  await org.page.waitForTimeout(1200);
  ok("the knockout's bracket is drawn", await has(org.page, "pl-bracket") && (await tid(org.page, "pl-bracket-match").count()) === 2, await said(org.page, "pl-summary"));
  ok("a later round shows \"Winner of R1 · Match 2\"", /Winner of R1 · Match \d/.test(await said(org.page, "pl-bracket-round-2")), await said(org.page, "pl-bracket-round-2"));
  ok("the bye is told", /has a bye in round 1/.test(await said(org.page, "pl-byes")), await said(org.page, "pl-byes"));
  await shot(org.page, "6-bracket");
  const fBr = await floors(org.page, "pl-root");
  ok("the planner with a bracket: 12px and 44px", floorsOk(fBr), floorsWhy(fBr));

  // a rule too strict for the slots: a fixture with no slot, and why
  await tap(org.page, "pl-format-double_round_robin");
  await fill(org.page, "pl-rule-restMinutes", 14400);
  await tap(org.page, "pl-generate");
  await org.page.waitForTimeout(1200);
  const unsched = await tid(org.page, "pl-unscheduled").count();
  ok("with ten days' rest, some fixtures have no slot", unsched >= 1, await said(org.page, "pl-summary"));
  ok("...each with its reasons in plain words", /would not have its rest/.test(await said(org.page, "pl-unscheduled")), await said(org.page, "pl-unscheduled"));
  await shot(org.page, "7-unscheduled");

  // a league blackout
  await fill(org.page, "pl-blackout-day", dayOf(29));
  await fill(org.page, "pl-blackout-reason", "Provincial exams");
  await tap(org.page, "pl-blackout-add");
  ok("a league blackout is added and listed", (await tid(org.page, "pl-blackout").count()) === 1 && /Provincial exams/.test(await said(org.page, "pl-blackouts")), await said(org.page, "pl-blackouts"));
  ok("...with a Remove, since it is the league's own", await has(org.page, "pl-blackout-remove"));
  await tap(org.page, "pl-blackout-remove");
  ok("...and removed", (await tid(org.page, "pl-blackout").count()) === 0);

  // the round robin of the three
  await tap(org.page, "pl-format-round_robin");
  await fill(org.page, "pl-rule-restMinutes", "");
  await tap(org.page, "pl-generate");
  await org.page.waitForTimeout(1200);
  ok("a round robin of three: three fixtures, all placed", /3 fixtures, 3 placed, 0 without a slot/.test(await said(org.page, "pl-summary")) && (await tid(org.page, "pl-fixture").count()) === 3, await said(org.page, "pl-summary"));
  ok("the list is grouped by round", await has(org.page, "pl-group-r1") && await has(org.page, "pl-group-r3"));
  await tap(org.page, "pl-view-day");
  ok("...and by day", (await org.page.locator('[data-testid^="pl-group-2"]').count()) >= 1, await org.page.locator('[data-testid^="pl-group-"]').count());
  await tap(org.page, "pl-view-round");
  const firstFixture = org.page.locator('[data-testid="pl-fixture"]').first();
  const firstId = await firstFixture.getAttribute("data-fixture");
  const firstSlot = await firstFixture.locator('[data-testid="pl-slot"]').innerText();
  await firstFixture.locator('[data-testid="pl-lock"]').click();
  await org.page.waitForTimeout(900);
  ok("one fixture is locked in place", (await org.page.locator('[data-testid="pl-fixture"][data-locked="yes"]').count()) === 1 && /Locked in place/.test(await said(org.page, "pl-status")), await said(org.page, "pl-status"));
  await tap(org.page, "pl-regenerate");
  await org.page.waitForTimeout(1200);
  const again = org.page.locator(`[data-testid="pl-fixture"][data-fixture="${firstId}"]`);
  ok("regenerating makes a new version and keeps the lock where it was",
     /Version 3|Version 4/.test(await said(org.page, "pl-draw")) && (await again.getAttribute("data-locked")) === "yes" && (await again.locator('[data-testid="pl-slot"]').innerText()) === firstSlot, await said(org.page, "pl-status"));
  await again.locator('[data-testid="pl-unlock"]').click();
  await org.page.waitForTimeout(800);
  ok("a locked fixture can be unlocked", (await org.page.locator('[data-testid="pl-fixture"][data-locked="yes"]').count()) === 0);
  await org.page.locator(`[data-testid="pl-fixture"][data-fixture="${firstId}"] [data-testid="pl-lock"]`).click();
  await org.page.waitForTimeout(800);
  const vBeforePublish = await dbq(`select version, state from fixture_plan where competition_id = $1 order by version`, [C]);
  await shot(org.page, "8-draw");
  const fDraw = await floors(org.page, "pl-root");
  ok("the draw: 12px and 44px", floorsOk(fDraw), floorsWhy(fDraw));

  // publish
  await tap(org.page, "pl-publish");
  ok("publishing asks once, in the page, first", await has(org.page, "pl-publish-confirm"));
  await tap(org.page, "pl-publish-yes");
  await org.page.waitForTimeout(2500);
  ok("the report says three were created", /3 created, 0 already made, 0 refused, 0 held back/.test(await said(org.page, "pl-report-counts")), await said(org.page, "pl-report-counts"));
  ok("...fixture by fixture", (await org.page.locator('[data-testid="pl-result"][data-outcome="created"]').count()) === 3);
  const matches = await dbq(`select school_id, team_code, away_school_id, away_team_code, format, overs from match where competition_id = $1`, [C]);
  ok("three matches exist, none for the side that declined",
     matches.length === 3 && !matches.some((m) => (m.school_id === "22222222-2222-2222-2222-222222222222" && m.team_code === "2XI") || (m.away_school_id === "22222222-2222-2222-2222-222222222222" && m.away_team_code === "2XI")), JSON.stringify(matches));
  ok("...each a T20 of twenty overs, from the published conditions", matches.every((m) => m.format === "T20" && m.overs === 20), JSON.stringify(matches));
  ok("the versions list shows the published version and the replaced drafts", (await org.page.locator('[data-testid^="pl-version-"][data-state="published"]').count()) === 1
     && (await org.page.locator('[data-testid^="pl-version-"][data-state="superseded"]').count()) >= 1, await said(org.page, "pl-versions"));
  ok("the published version has no publish button", !(await has(org.page, "pl-publish")));
  ok("the database agrees", vBeforePublish.length >= 3, JSON.stringify(vBeforePublish));
  // a retry: publish the same version again through the API
  const latest = (await call(`/api/competitions/${C}/plans`, { token: await devLogin("league@example.invalid") })).body?.plans?.[0];
  const retry = await call(`/api/competitions/${C}/plans/${latest.id}/publish`, { method: "POST", token: await devLogin("league@example.invalid") });
  ok("publishing again makes nothing twice (already)", retry.body?.counts?.already === 3 && retry.body?.counts?.created === 0, JSON.stringify(retry.body?.counts));
  ok("...the matches are still three", (await dbq(`select count(*)::int as n from match where competition_id = $1`, [C]))[0].n === 3);
  await shot(org.page, "9-published");
  const fRep = await floors(org.page, "pl-root");
  ok("the report: 12px and 44px", floorsOk(fRep), floorsWhy(fRep));
  ok("no console errors (organiser)", org.errors.length === 0, org.errors.join(" | "));

  // the planner again, from the league's own screen, for its manager only
  ok("Leagues opens", await nav(org.page, /^Leagues$/));
  await org.page.locator("button", { hasText: new RegExp(LEAGUE_NAME) }).first().click();
  await org.page.waitForTimeout(600);
  ok("the league offers a \"Fixture planner\" tab", await has(org.page, "league-tab-planner"));
  await tap(org.page, "league-tab-planner");
  await org.page.waitForTimeout(1500);
  ok("...which shows the versions and the published draw", await has(org.page, "pl-root") && await has(org.page, "pl-versions"), await said(org.page, "pl-root"));
  await org.ctx.close().catch(() => {});

  const hil2 = await open();
  await signIn(hil2.page, "sarah@example.invalid");
  await nav(hil2.page, /^Leagues$/);
  await hil2.page.locator("button", { hasText: new RegExp(LEAGUE_NAME) }).first().click().catch(() => {});
  await hil2.page.waitForTimeout(600);
  ok("a director of sport is offered no planner tab", !(await has(hil2.page, "league-tab-planner")));
  await nav(hil2.page, /^Competitions\d*$/);
  ok("...nor a \"Fixture planner\" or \"Finish setting up\" on Competitions", !(await has(hil2.page, "open-planner")) && !(await has(hil2.page, "finish-setup")));
  await hil2.ctx.close().catch(() => {});

  // ── E ──────────────────────────────────────────────────────────
  group("E. Save and come back later");
  // A third league made through the API, with one side invited and no conditions
  // yet: it waits for Hilton and is part-made at step 3.
  const orgToken = await devLogin("league@example.invalid");
  const three = await call("/api/competitions", { method: "POST", token: orgToken, body: { name: "Walk Cup Three", format: "T20", ageGroup: "1XI", gender: "boys", season: "2026" } });
  const threeInvite = await call(`/api/competitions/${three.body?.id}/entrants`, { method: "POST", token: orgToken, body: { schoolId: HIL, teamCode: "1XI" } });
  ok("a third league is made with one side invited (through the API)", three.status === 200 && threeInvite.status === 200, `${three.status} ${threeInvite.status}`);
  const again1 = await open();
  ok("the league administrator signs in again", await signIn(again1.page, "league@example.invalid"));
  await nav(again1.page, /^Competitions\d*$/);
  await settled(again1.page);
  ok("the organiser is never shown an invitation badge: the API lists none for her", !(await has(again1.page, "nav-invites-badge")));
  // Part-made and complete, from what the wizard itself reads.
  await again1.page.locator("button", { hasText: new RegExp(LEAGUE_NAME) }).first().click();
  await again1.page.waitForTimeout(400);
  const doneGone = await again1.page.waitForSelector('[data-testid="finish-setup"]', { state: "detached", timeout: 6000 }).then(() => true, () => false);
  ok("a complete league (sides and published conditions) offers no \"Finish setting up\"", doneGone);
  ok("...says nothing is left to set up", !(await has(again1.page, "league-setup-state")));
  ok("...and keeps its \"Fixture planner\"", await has(again1.page, "open-planner"));
  await again1.page.locator("button", { hasText: /Walk Cup Three/ }).first().click();
  await again1.page.waitForTimeout(400);
  await tid(again1.page, "league-setup-state").first().waitFor({ timeout: 6000 }).catch(() => {});
  ok("a league with sides but no conditions says so: step 3", (await said(again1.page, "league-setup-state")) === "Setting up: step 3 of 4, Playing conditions" && await has(again1.page, "finish-setup"), await said(again1.page, "league-setup-state"));
  await tap(again1.page, "new-competition");
  await fill(again1.page, "lw-name", "Walk Cup Two");
  await tap(again1.page, "lw-league-next");
  await again1.page.waitForTimeout(800);
  await tap(again1.page, "lw-save-return");
  await again1.page.waitForTimeout(1200);
  ok("leaving after step 1 goes back to Competitions", !(await has(again1.page, "lw-root")) && (await again1.page.locator("button", { hasText: /Walk Cup Two/ }).count()) >= 1);
  await again1.page.locator("button", { hasText: /Walk Cup Two/ }).first().click();
  await again1.page.waitForTimeout(500);
  await tid(again1.page, "league-setup-state").first().waitFor({ timeout: 6000 }).catch(() => {});
  ok("a league with no sides says so: step 2, in the wizard's own words, and keeps \"Finish setting up\"",
     (await said(again1.page, "league-setup-state")) === "Setting up: step 2 of 4, Entrants" && await has(again1.page, "finish-setup"), await said(again1.page, "league-setup-state"));
  const fMark = await floors(again1.page, "league-setup-state");
  ok("...the marker is 12px at the least", floorsOk(fMark), floorsWhy(fMark));
  await tap(again1.page, "finish-setup");
  await again1.page.waitForTimeout(1500);
  ok("\"Finish setting up\" reopens it at step 2, the first not done", /Step 2 of 4: Entrants/.test(await said(again1.page, "lw-root")), (await said(again1.page, "lw-root")).slice(0, 200));
  await tid(again1.page, "lw-step-1").click();
  await again1.page.waitForTimeout(400);
  ok("step 1 of a league already made can rename it, and fixes the rest", await has(again1.page, "lw-league-facts") && !(await has(again1.page, "lw-format")));
  await tap(again1.page, "lw-step-2");
  await tap(again1.page, "lw-next");
  await again1.page.waitForTimeout(600);
  // copy from another league: nothing in force yet (the first league's starts tomorrow)
  await again1.page.locator('[data-testid="lw-copy-source"]').selectOption({ label: LEAGUE_NAME }).catch(() => {});
  await tap(again1.page, "lw-start-copy").catch(() => {});
  await again1.page.waitForTimeout(800);
  ok("copying a league with nothing in force today is refused, in words", /no playing conditions in force today/.test(await said(again1.page, "lw-conditions-error")), await said(again1.page, "lw-conditions-error"));
  ok("no console errors (come back)", again1.errors.length === 0, again1.errors.join(" | "));
  await again1.ctx.close().catch(() => {});

  // A read that fails leaves the card as it was: the league still offers "Finish setting up".
  const failing = await open();
  await failing.ctx.route(/\/api\/competitions\/[^/]+\/entrants$/, (r) => r.abort());
  ok("the organiser signs in (entrants reads will fail)", await signIn(failing.page, "league@example.invalid"));
  await nav(failing.page, /^Competitions\d*$/);
  for (const name of [LEAGUE_NAME, "Walk Cup Three"]) {
    await failing.page.locator("button", { hasText: new RegExp(name) }).first().click();
    await settled(failing.page);
    ok(`when the reads fail, ${name} is as it was: "Finish setting up", no marker, no broken card`,
       (await has(failing.page, "finish-setup")) && !(await has(failing.page, "league-setup-state")) && (await has(failing.page, "open-planner")));
  }
  ok("no console errors (a failed read)", failing.errors.length === 0, failing.errors.join(" | "));
  await failing.ctx.close().catch(() => {});

  // One waiting invitation, in the singular; nothing when the read fails; a phone.
  const hil3 = await open();
  ok("Hilton's director of sport signs in again", await signIn(hil3.page, "sarah@example.invalid"));
  await settled(hil3.page);
  ok("one invitation is \"1 league invitation waiting\", badged without opening Competitions",
     (await said(hil3.page, "nav-invites-badge")) === "1" && (await tid(hil3.page, "nav-competitions").getAttribute("aria-label")) === "Competitions, 1 league invitation waiting"
     && !(await has(hil3.page, "invitations")), await tid(hil3.page, "nav-competitions").getAttribute("aria-label"));
  await nav(hil3.page, /^Competitions\d*$/);
  ok("...and Competitions shows that invitation, from Walk Cup Three", /Walk Cup Three/.test(await said(hil3.page, "invitation")));
  await hil3.ctx.close().catch(() => {});

  const hil4 = await open();
  await hil4.ctx.route(/\/api\/competition-invitations$/, (r) => r.abort());
  ok("Hilton signs in (invitation reads will fail)", await signIn(hil4.page, "sarah@example.invalid"));
  await settled(hil4.page);
  ok("a failed read badges nothing", !(await has(hil4.page, "nav-invites-badge")) && (await tid(hil4.page, "nav-competitions").getAttribute("aria-label")) === null);
  ok("no console errors (a failed invitations read)", hil4.errors.length === 0, hil4.errors.join(" | "));
  await hil4.ctx.close().catch(() => {});

  const hil5 = await open("floodlit", { width: 390, height: 844 });
  ok("Hilton signs in on a phone", await signIn(hil5.page, "sarah@example.invalid"));
  await settled(hil5.page);
  const onBar = await has(hil5.page, "mnav-competitions");
  const holder = tid(hil5.page, onBar ? "mnav-competitions" : "mnav-more");
  ok("on a phone the bar says so, in words, on the button that leads to Competitions",
     (await holder.getAttribute("aria-label")) === (onBar ? "Competitions, 1 league invitation waiting" : "More, 1 league invitation waiting"), await holder.getAttribute("aria-label"));
  ok("...with a badge of 12px at the least", (await tid(hil5.page, "mnav-invites-badge").first().evaluate((n) => parseFloat(getComputedStyle(n).fontSize))) >= 12);
  if (!onBar) {
    await tap(hil5.page, "mnav-more");
    ok("...and the drawer's Competitions says so too", (await tid(hil5.page, "drawer-competitions").getAttribute("aria-label")) === "Competitions, 1 league invitation waiting");
  }
  ok("no sideways scroll with the badge", (await hil5.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  ok("no console errors (phone, badge)", hil5.errors.length === 0, hil5.errors.join(" | "));
  await hil5.ctx.close().catch(() => {});

  // ── F ──────────────────────────────────────────────────────────
  group("F. Phone width and Daylight");
  const ph = await open();
  ok("the organiser signs in on a phone", await signIn(ph.page, "league@example.invalid"));
  await nav(ph.page, /^Competitions\d*$/);
  await ph.page.setViewportSize({ width: 390, height: 844 });
  await ph.page.waitForTimeout(1200);
  const hasNew = await has(ph.page, "new-competition");
  ok("\"+ New Competition\" is reachable at 390 wide", hasNew);
  if (hasNew) {
    await tap(ph.page, "new-competition");
    const f1 = await floors(ph.page, "lw-root");
    ok("the wizard at 390 wide: no sideways scroll, 12px and 44px", f1.sideways <= 0 && floorsOk(f1), `${f1.sideways} ${floorsWhy(f1)}`);
    await ph.page.locator("button", { hasText: /Save and come back|Cancel/ }).first().click().catch(() => {});
    await ph.page.waitForTimeout(800);
    await ph.page.locator("button", { hasText: new RegExp(LEAGUE_NAME) }).first().click().catch(() => {});
    await ph.page.waitForTimeout(500);
    await tap(ph.page, "open-planner").catch(() => {});
    await ph.page.waitForTimeout(1500);
    if (await has(ph.page, "pl-root")) {
      const f2 = await floors(ph.page, "pl-root");
      ok("the planner at 390 wide: no sideways scroll, 12px and 44px", f2.sideways <= 0 && floorsOk(f2), `${f2.sideways} ${floorsWhy(f2)}`);
    } else ok("the planner opens from the league's card at 390 wide", false);
  }
  ok("no console errors (phone)", ph.errors.length === 0, ph.errors.join(" | "));
  await ph.ctx.close().catch(() => {});

  const day = await open("daylight");
  ok("the organiser signs in again", await signIn(day.page, "league@example.invalid"));
  await nav(day.page, /^Competitions\d*$/);
  await day.page.locator("button", { hasText: new RegExp(LEAGUE_NAME) }).first().click().catch(() => {});
  await tap(day.page, "open-planner").catch(() => {});
  await day.page.waitForTimeout(1500);
  const theme = await day.page.evaluate(() => document.documentElement.dataset.theme);
  const fDay = await floors(day.page, "pl-root");
  ok("in Daylight the planner is light, with the same floors", theme === "daylight" && /rgb\((2[0-9]{2}|1[89][0-9]), /.test(fDay.bg) && floorsOk(fDay), `${theme} ${fDay.bg} ${floorsWhy(fDay)}`);
  await tap(day.page, "pl-back");
  // The wizard, from a league still part-made (the walk's league is complete by now).
  await day.page.locator("button", { hasText: /Walk Cup Two/ }).first().click();
  await tap(day.page, "finish-setup");
  await day.page.waitForTimeout(1200);
  const fDayW = await floors(day.page, "lw-root");
  ok("in Daylight the wizard has the same floors", floorsOk(fDayW), floorsWhy(fDayW));
  ok("no console errors (Daylight)", day.errors.length === 0, day.errors.join(" | "));
  await day.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser league walk threw: ${e.message?.slice(0, 300)}`, false);
  if (DEBUG) {
    console.log(e.stack?.split("\n").slice(0, 10).join("\n"));
    console.log("--- the page, when it threw ---\n" + (await lastPage?.$eval("body", (el) => el.innerText).catch(() => ""))?.slice(0, 2500));
  }
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER LEAGUE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

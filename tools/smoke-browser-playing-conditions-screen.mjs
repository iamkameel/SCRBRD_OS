#!/usr/bin/env node
/**
 * A competition's playing-conditions screen, in a real browser (SCRBRD-114,
 * phase 1: Leagues → the competition → "Playing conditions"), against a real
 * API and Postgres. tools/smoke-browser-playing-conditions.mjs walks what the
 * conditions do on the pad; this walks the page a league's organiser uses to
 * state them, and the page everyone else reads.
 *
 *   A  A MANAGER (the league's organiser, competitionadmin).
 *      No version is in force: the page says every figure is the platform
 *      default, unconfirmed, and offers a new draft.
 *      She creates a draft dated today, enters an unconfirmed figure (its
 *      chip), a yes-or-no as a toggle, and a confirmed one, trying it with no
 *      citation first: the words explain what a confirmed figure needs before
 *      she tries and again when the database refuses it. A limit by age band
 *      is a small table; a reserved key sits under "Recorded, not applied" and
 *      is not counted. "N of M figures confirmed" follows each entry.
 *      Publishing for today is refused in plain words; she moves it to
 *      tomorrow and publishes, after an in-page confirm. The published version
 *      cannot be changed; a new version copies it; she withdraws that one
 *      (published, not yet in force) with a note, refused until the note is
 *      ten characters.
 *   B  THE DAY COMES. The published version's day passes (a fixture of this
 *      walk: the clock cannot be moved, so the date is): the page says it is
 *      in force, its date, the count, every figure grouped by part with its
 *      source or the chip, who published it and when, and offers a new
 *      version and no withdrawal.
 *   C  A READER (the director of sport at an entrant school): the same page,
 *      read-only. No draft is shown, nothing to create, enter, publish or
 *      withdraw; the count and the sources are.
 *   D  Nothing on the page is set under 12px, nothing pressed is under 44px,
 *      at a desktop, at 390 wide with no sideways scroll, and in Daylight.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-playing-conditions-screen.mjs
 *   BROWSER_PCS_DEBUG=1 node tools/smoke-browser-playing-conditions-screen.mjs
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

const WEB_PORT = port(5392);
const API_PORT = port(8892);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_PCS_DEBUG;
const DIST = process.env.PC_DIST || "apps/web/dist";
const LEAGUE = "99999999-0000-0000-0000-000000000001";
const LEAGUE_NAME = "KZN Schools T20 League";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-playing-conditions-screen-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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
const devLogin = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: `pcs-walk-${email}` } })).body?.token;

const browser = await chromium.launch({ ...launchOptions() });
async function open(theme = "floodlit", viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.type()); d.dismiss().catch(() => {}); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};
    try { localStorage.setItem("scrbrd:theme", ${JSON.stringify(theme)}); } catch (e) {}`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, dialogs };
}
const text = (page) => page.$eval("body", (el) => el.innerText);
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const said = async (page, id) => ((await tid(page, id).first().innerText({ timeout: 2500 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tap = async (page, id, ms = 4000) => { await tid(page, id).first().click({ timeout: ms }); await page.waitForTimeout(350); };
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return (await page.locator("nav button").count()) > 0;
}
async function nav(page, label) {
  const l = page.locator("nav button", { hasText: label }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return true;
}
/** Leagues → the competition → its "Playing conditions" tab. */
async function toConditions(page) {
  if (!(await nav(page, /^Leagues$/))) return false;
  if (!(await click(page, new RegExp(LEAGUE_NAME), 4000))) return false;
  if (!(await click(page, /^Playing conditions$/, 4000))) return false;
  await tid(page, "pc-root").waitFor({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return (await tid(page, "pc-root").count()) === 1;
}
/** Every text node under the root, and every control, measured as drawn. */
async function floors(page, root = "pc-root") {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA|SUMMARY)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type)) || (n.tagName === "A" && n.getAttribute("href"))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, bg: getComputedStyle(document.body).backgroundColor, sideways: document.documentElement.scrollWidth - window.innerWidth };
  }).catch(() => ({ small: ["(not drawn)"], tiny: [], bg: "", sideways: 0 }));
}
// BROWSER_PCS_SHOTS=<dir> keeps a picture of each stage, for a person to look at.
const shot = async (page, name) => { if (process.env.BROWSER_PCS_SHOTS) await page.screenshot({ path: join(process.env.BROWSER_PCS_SHOTS, `${name}.png`), fullPage: true }).catch(() => {}); };
const floorsOk = (f) => f.small.length === 0 && f.tiny.length === 0;
const floorsWhy = (f) => [...f.small, ...f.tiny].slice(0, 4).join(" · ");

/** Enter one figure through its editor. */
async function enter(page, key, { band, value, spell, day, none, status = "unconfirmed", doc, clause, docDate, save = true }) {
  const suffix = band ? `${key}-${band}` : key;
  await tap(page, `pc-enter-${suffix}`);
  const ed = tid(page, `pc-editor-${suffix}`);
  if (value !== undefined) await ed.locator('[data-testid="pc-f-value"]').fill(String(value));
  if (spell !== undefined) await ed.locator('[data-testid="pc-f-spell"]').fill(String(spell));
  if (day !== undefined) await ed.locator('[data-testid="pc-f-day"]').fill(String(day));
  if (none) await ed.locator('[data-testid="pc-f-none"]').check();
  if (status === "confirmed") await ed.locator('[data-testid="pc-status-confirmed"]').click();
  if (doc !== undefined) await ed.locator('[data-testid="pc-f-doc"]').fill(doc);
  if (clause !== undefined) await ed.locator('[data-testid="pc-f-clause"]').fill(clause);
  if (docDate !== undefined) await ed.locator('[data-testid="pc-f-docdate"]').fill(docDate);
  if (save) { await ed.locator('[data-testid="pc-save"]').click(); await page.waitForTimeout(700); }
  return ed;
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const [{ today, d1, d2, yesterday }] = await dbq(
    `select sa_today()::text as today, (sa_today() + 1)::text as d1, (sa_today() + 2)::text as d2, (sa_today() - 1)::text as yesterday`);
  const league = await devLogin("league@example.invalid");
  const cat = (await call("/api/playing-conditions/catalogue", { token: league })).body;
  const M = cat.keys.filter((k) => !k.reserved).reduce((n, k) => n + (k.byAgeBand ? cat.ageBands.length : 1), 0);
  if (DEBUG) console.log("[debug] today", today, "M", M);

  // ── A ──────────────────────────────────────────────────────────
  group("A. The organiser: a draft, its figures, publishing, a new version, a withdrawal");
  const mgr = await open();
  const p = mgr.page;
  ok("the league's organiser signs in", await signIn(p, "league@example.invalid"));
  ok("Leagues → the competition → Playing conditions", await toConditions(p));
  ok("nothing in force: the platform's defaults, unconfirmed, said in words",
     /platform default, unconfirmed/.test(await said(p, "pc-none-in-force")) && /No version is in force today/.test(await said(p, "pc-in-force")));
  ok(`the count is 0 of ${M} figures confirmed`, (await said(p, "pc-count")) === `0 of ${M} figures confirmed`, await said(p, "pc-count"));
  ok("every figure carries the chip, and the by-band limit is a table", (await tid(p, "pc-chip-default").count()) >= M
     && (await tid(p, "pc-figure-bowling.limit").locator("table").count()) === 1 && (await tid(p, "pc-figure-bowling.limit").locator("tbody tr").count()) === cat.ageBands.length);
  ok("a figure with no league figure says what applies: 'platform default, unconfirmed: <the default>'",
     /platform default, unconfirmed: Points, then Wins, then Net run rate/i.test(await said(p, "pc-figure-table.order"))
     && /platform default, unconfirmed: no cap/i.test(await said(p, "pc-figure-bowling.max_overs_per_bowler_innings"))
     && /platform default, unconfirmed: None/i.test(await said(p, "pc-figure-result.tie_break")), await said(p, "pc-figure-table.order"));
  ok("...and a band shows the platform's own figures, from the catalogue, not from the screen",
     /5 overs.*10 overs.*platform default/i.test(await said(p, "pc-figure-bowling.limit-U13")) && /6 overs.*12 overs.*platform default/i.test(await said(p, "pc-figure-bowling.limit-U14")));
  ok("she is offered a new draft", (await tid(p, "pc-new-draft").count()) === 1 && (await tid(p, "pc-readonly").count()) === 0);
  ok("the three parts are there: play, table, sheet", (await tid(p, "pc-part-play").count()) === 1 && (await tid(p, "pc-part-table").count()) === 1 && (await tid(p, "pc-part-sheet").count()) === 1);
  ok("with no draft there is nothing to record under 'Recorded, not applied', so it is not drawn", (await tid(p, "pc-reserved").count()) === 0);

  // a draft, refused for a title too short, then dated today
  await tid(p, "pc-draft-title").fill("x");
  await tid(p, "pc-draft-date").fill(today);
  await tap(p, "pc-draft-create");
  await p.waitForTimeout(500);
  ok("a title too short is refused beside the form, in words (no code)", /title of 3 to 120 characters/.test(await said(p, "pc-draft-error")) && !/title_invalid/.test(await said(p, "pc-draft-error")), await said(p, "pc-draft-error"));
  await tid(p, "pc-draft-title").fill("Screen walk 2026/27");
  await tap(p, "pc-draft-create");
  await p.waitForTimeout(1200);
  ok("the draft is version 1, and the page shows it", /Version 1: Screen walk 2026\/27/.test(await said(p, "pc-version-1")) && (await tid(p, "pc-version-1").getAttribute("data-standing")) === "draft");
  ok("reserved keys are under 'Recorded, not applied', all of them, for the organiser of a draft", /Recorded, not applied/.test(await said(p, "pc-reserved")) && (await tid(p, "pc-reserved").locator('[data-testid^="pc-figure-"]').count()) === cat.keys.filter((k) => k.reserved).length);
  ok("...its figures are shown, with enter buttons", /Figures of version 1/.test(await said(p, "pc-shown")) && (await tid(p, "pc-enter-format.overs_per_innings").count()) === 1);

  // an unconfirmed figure
  await enter(p, "format.overs_per_innings", { value: 30 });
  const overs = tid(p, "pc-figure-format.overs_per_innings");
  ok("an unconfirmed figure: its value and unit, and the chip 'unconfirmed'", /30 overs/.test(await overs.innerText()) && (await overs.locator('[data-testid="pc-chip-unconfirmed"]').count()) === 1, await overs.innerText());
  // a yes-or-no is a toggle
  await tap(p, "pc-enter-format.free_hit");
  const fh = tid(p, "pc-editor-format.free_hit");
  ok("a yes-or-no is a toggle, not a box to type in", (await fh.locator('[data-testid="pc-bool-yes"]').count()) === 1 && (await fh.locator('[data-testid="pc-bool-no"]').count()) === 1 && (await fh.locator('[data-testid="pc-f-value"]').count()) === 0);
  await fh.locator('[data-testid="pc-bool-no"]').click();
  await fh.locator('[data-testid="pc-save"]').click();
  await p.waitForTimeout(700);
  const fhRow = tid(p, "pc-figure-format.free_hit");
  ok("...saved as No, unconfirmed", (await fhRow.locator('[data-testid="pc-value"]').innerText()) === "No" && (await fhRow.locator('[data-testid="pc-chip-unconfirmed"]').count()) === 1, await fhRow.innerText());
  // an enum is a select
  await tap(p, "pc-enter-format.kind");
  const kind = tid(p, "pc-editor-format.kind");
  ok("an enum is a select of its own values", (await kind.locator("select").count()) === 1 && (await kind.locator("select option").allInnerTexts()).join("|").includes("Limited overs"));
  await kind.locator("select").selectOption("limited");
  await kind.locator('[data-testid="pc-save"]').click();
  await p.waitForTimeout(700);
  ok("...saved: Limited overs", /Limited overs/.test(await said(p, "pc-figure-format.kind")));

  // a confirmed figure: the words come first, then the refusal, then the citation
  const cap = await enter(p, "bowling.max_overs_per_bowler_innings", { value: 5, status: "confirmed", save: false });
  ok("choosing Confirmed explains what it needs, before anything is sent",
     /point at the document.*name, the clause and the date/.test(await said(p, "pc-citation-hint")) && (await cap.locator('[data-testid="pc-f-doc"]').count()) === 1, await said(p, "pc-citation-hint"));
  await shot(p, "0-confirmed-editor");
  const editFloors = await floors(p);
  ok("with an editor open: nothing under 12px, nothing pressed under 44px", floorsOk(editFloors), floorsWhy(editFloors));
  await cap.locator('[data-testid="pc-save"]').click();
  await p.waitForTimeout(700);
  const cit = await said(p, "pc-error-citation");
  ok("with no citation the database refuses it, and the refusal is explained beside the field",
     /must say where it comes from/.test(cit) && /document, the clause and the date/.test(cit) && !/citation_required/.test(cit), cit);
  ok("...and nothing was saved", (await dbq(`select 1 from condition_value where key = 'bowling.max_overs_per_bowler_innings'`)).length === 0);
  await cap.locator('[data-testid="pc-f-doc"]').fill("KZNCU Schools Bye-laws");
  await cap.locator('[data-testid="pc-f-clause"]').fill("7.3");
  await cap.locator('[data-testid="pc-f-docdate"]').fill("2026-09-15");
  await cap.locator('[data-testid="pc-save"]').click();
  await p.waitForTimeout(800);
  const capRow = await said(p, "pc-figure-bowling.max_overs_per_bowler_innings");
  ok("cited, it is saved, and its source is worded: document, clause, date", /5 overs/.test(capRow) && /KZNCU Schools Bye-laws, clause 7\.3, 15 Sep/.test(capRow), capRow);
  ok("a bad value is refused beside the field, by the figure's name, not its key", await (async () => {
    await enter(p, "format.overs_per_innings", { value: 0 });
    const w = await said(p, "pc-error-value");
    await tap(p, "pc-cancel");
    return /Overs an innings is at least 1/.test(w) && !/format\.overs/.test(w);
  })());

  // a limit by age band, cited
  await enter(p, "bowling.limit", { band: "U15", spell: 6, day: 12, status: "confirmed", doc: "KZNCU Schools Bye-laws", clause: "7.4", docDate: "2026-09-15" });
  const u15 = await said(p, "pc-figure-bowling.limit-U15");
  ok("a limit by band is a row of its table: a spell, a day, its source", /U15/.test(u15) && /6 overs/.test(u15) && /12 overs/.test(u15) && /clause 7\.4/.test(u15), u15);
  ok("...and who entered it: 'Entered by you' (her own id, so not her name)", /Entered by you/.test(u15), u15);
  ok("...the other bands still say platform default", /U16.*platform default, unconfirmed/i.test(await said(p, "pc-figure-bowling.limit-U16")));
  // a reserved key
  await p.locator('[data-testid="pc-reserved"] summary').click();
  await enter(p, "pitch.length_m", { value: 20 });
  ok("a reserved key is recorded, under 'Recorded, not applied'", /20 m/.test(await said(p, "pc-figure-pitch.length_m")));
  ok(`the count is 2 of ${M} figures confirmed: unconfirmed and reserved figures are not counted`, (await said(p, "pc-set-count")) === `2 of ${M} figures confirmed`, await said(p, "pc-set-count"));
  // clearing one
  await tap(p, "pc-clear-pitch.length_m");
  await p.waitForTimeout(600);
  ok("a figure can be cleared", /Nothing recorded/.test(await said(p, "pc-figure-pitch.length_m")));

  // publishing for today is refused
  await tap(p, "pc-publish");
  const conf = await said(p, "pc-publish-confirm");
  ok("publishing asks first, in the page: the version, its day, the count", /Publish version 1/.test(conf) && new RegExp(`2 of ${M} figures are confirmed`).test(conf), conf);
  await tap(p, "pc-publish-yes");
  await p.waitForTimeout(700);
  const refused = await said(p, "pc-error-publish");
  ok("for today it is refused, in plain words: a day after today, move the date",
     /after today/.test(refused) && /tomorrow or later/.test(refused) && !/effective_from_not_future/.test(refused), refused);
  ok("...and it is still a draft", (await dbq(`select status from condition_set where competition_id = $1`, [LEAGUE]))[0]?.status === "draft");
  // move it to tomorrow, publish
  await tap(p, "pc-publish-no");
  await tap(p, "pc-amend");
  await tid(p, "pc-amend-date").fill(d1);
  await tap(p, "pc-amend-save");
  await p.waitForTimeout(800);
  ok("the draft's date is now tomorrow", new RegExp(`Starts 0?${Number(d1.slice(8))} `).test(await said(p, "pc-version-1")), await said(p, "pc-version-1"));
  await tap(p, "pc-publish");
  await tap(p, "pc-publish-yes");
  await p.waitForTimeout(1000);
  const v1 = (await dbq(`select id, status, effective_from::text as eff from condition_set where competition_id = $1 order by version`, [LEAGUE]))[0];
  ok("for tomorrow it is published", v1?.status === "published" && v1?.eff === d1, JSON.stringify(v1));
  ok("...the page says: published, not yet in force, by you", (await tid(p, "pc-version-1").getAttribute("data-standing")) === "scheduled" && /Published by you/.test(await said(p, "pc-version-1")), await said(p, "pc-version-1"));
  ok("...still nothing in force today", /No version is in force today/.test(await said(p, "pc-in-force")));
  ok("a published version cannot be changed: no enter, clear or publish on it",
     (await tid(p, "pc-enter-format.overs_per_innings").count()) === 0 && (await tid(p, "pc-clear-format.kind").count()) === 0 && (await tid(p, "pc-publish").count()) === 0);
  ok("...its figures and sources are still there", /30 overs/.test(await said(p, "pc-figure-format.overs_per_innings")) && /clause 7\.3/.test(await said(p, "pc-figure-bowling.max_overs_per_bowler_innings")));

  // a new version from it; dated and published; then withdrawn
  await tap(p, "pc-newversion");
  await p.waitForTimeout(1200);
  ok("a new version copies it: version 2, a draft, showing", (await tid(p, "pc-version-2").getAttribute("data-standing")) === "draft" && /Figures of version 2/.test(await said(p, "pc-shown")));
  ok("...with the figures it copied", /30 overs/.test(await said(p, "pc-figure-format.overs_per_innings")) && (await said(p, "pc-set-count")) === `2 of ${M} figures confirmed`);
  await tap(p, "pc-amend");
  await tid(p, "pc-amend-title").fill("Screen walk 2026/27, corrected");
  await tid(p, "pc-amend-date").fill(d2);
  await tap(p, "pc-amend-save");
  await p.waitForTimeout(800);
  await tap(p, "pc-publish");
  await tap(p, "pc-publish-yes");
  await p.waitForTimeout(1000);
  ok("version 2 is published, from the day after tomorrow", (await tid(p, "pc-version-2").getAttribute("data-standing")) === "scheduled");
  await tap(p, "pc-withdraw");
  ok("withdrawing asks first, in the page, and asks why", /Withdraw version 2/.test(await said(p, "pc-withdraw-confirm")) && (await tid(p, "pc-withdraw-note").count()) === 1);
  await tid(p, "pc-withdraw-note").fill("too short");
  await tap(p, "pc-withdraw-yes");
  await p.waitForTimeout(600);
  ok("a note under ten characters is refused, in words", /at least 10 characters/.test(await said(p, "pc-error-withdraw")) && !/note_required/.test(await said(p, "pc-error-withdraw")), await said(p, "pc-error-withdraw"));
  ok("...and it is still published", (await dbq(`select status from condition_set where competition_id = $1 and version = 2`, [LEAGUE]))[0]?.status === "published");
  await tid(p, "pc-withdraw-note").fill("Dated wrongly; version 1 stands until the union rules");
  await tap(p, "pc-withdraw-yes");
  await p.waitForTimeout(1000);
  const v2 = (await dbq(`select status, withdrawn_note from condition_set where competition_id = $1 and version = 2`, [LEAGUE]))[0];
  ok("with a note it is withdrawn", v2?.status === "withdrawn" && /Dated wrongly/.test(v2?.withdrawn_note ?? ""), JSON.stringify(v2));
  ok("...the page says so, with the note and who withdrew it", (await tid(p, "pc-version-2").getAttribute("data-standing")) === "withdrawn"
     && /Withdrawn by you/.test(await said(p, "pc-version-2")) && /Dated wrongly/.test(await said(p, "pc-version-2")), await said(p, "pc-version-2"));
  ok("...and a withdrawn version offers no more actions", (await tid(p, "pc-actions").locator("button").count()) === 0);
  ok("no console errors (organiser), and no browser dialog was ever raised (publish and withdraw asked in the page)", mgr.errors.length === 0 && mgr.dialogs.length === 0, mgr.errors.concat(mgr.dialogs).join(" | "));

  // a draft for a reader to NOT see (group C)
  const d3 = await call(`/api/competitions/${LEAGUE}/playing-conditions`, { method: "POST", token: league, body: { title: "Unpublished ideas", effectiveFrom: d2 } });
  ok("(a third version is left as a draft)", d3.body?.ok === true, JSON.stringify(d3.body));

  // ── B ──────────────────────────────────────────────────────────
  group("B. The day comes: in force today");
  // The clock cannot be moved, so the day is: version 1's date is yesterday.
  await pool.query(`alter table condition_set disable trigger condition_set_guard`);
  try { await pool.query(`update condition_set set effective_from = $2::date where id = $1`, [v1.id, yesterday]); }
  finally { await pool.query(`alter table condition_set enable trigger condition_set_guard`); }
  ok("Playing conditions is opened again", (await nav(p, /^Matches$|^Match Centre$/)) && await toConditions(p));
  const inForce = await said(p, "pc-in-force");
  ok("the page says which version is in force today, and from when", /In force today: Screen walk 2026\/27/.test(inForce) && /Version 1/i.test(inForce) && /From /.test(await said(p, "pc-in-force-date")), inForce);
  ok(`...and the count: 2 of ${M} figures confirmed`, (await said(p, "pc-count")) === `2 of ${M} figures confirmed`, await said(p, "pc-count"));
  ok("...the version is marked in force in the list, with who published it and when", (await tid(p, "pc-version-1").getAttribute("data-standing")) === "in_force"
     && /Published by you, \d/.test(await said(p, "pc-version-1")), await said(p, "pc-version-1"));
  ok("...its figures are shown by default, grouped: value and unit, source or chip",
     /Limited overs/.test(await said(p, "pc-figure-format.kind")) && /30 overs/.test(await said(p, "pc-figure-format.overs_per_innings"))
     && /clause 7\.3/.test(await said(p, "pc-figure-bowling.max_overs_per_bowler_innings"))
     && /platform default, unconfirmed/i.test(await said(p, "pc-figure-points.win")) && /platform default, unconfirmed/i.test(await said(p, "pc-figure-eligibility.age_on")));
  ok("...the by-band table shows U15 as cited and U13 as the platform's default", /6 overs.*12 overs.*clause 7\.4/.test(await said(p, "pc-figure-bowling.limit-U15"))
     && /5 overs.*10 overs.*platform default, unconfirmed/i.test(await said(p, "pc-figure-bowling.limit-U13")));
  ok("the version in force is corrected by a new version, never withdrawn: no withdrawal offered", (await tid(p, "pc-withdraw").count()) === 0 && (await tid(p, "pc-newversion").count()) === 1);
  ok("the organiser's own draft is listed to her, as a draft", (await tid(p, "pc-version-3").getAttribute("data-standing")) === "draft");
  await shot(p, "1-in-force-desktop");
  const fDesk = await floors(p);
  ok("desktop, Floodlit: nothing under 12px, nothing pressed under 44px", floorsOk(fDesk), floorsWhy(fDesk));

  // ── D (phone) ──────────────────────────────────────────────────
  group("D. At a phone's 390 × 844");
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(700);
  await shot(p, "2-in-force-phone");
  const fPhone = await floors(p);
  ok("no sideways scroll", fPhone.sideways <= 1, String(fPhone.sideways));
  ok("nothing under 12px, nothing pressed under 44px", floorsOk(fPhone), floorsWhy(fPhone));
  await tap(p, "pc-show-3");
  await tap(p, "pc-enter-bowling.limit-U14");
  await shot(p, "3-band-editor-phone");
  const fEdit = await floors(p);
  ok("with a band's editor open: no sideways scroll, the same floors", fEdit.sideways <= 1 && floorsOk(fEdit), `${fEdit.sideways} ${floorsWhy(fEdit)}`);
  await tap(p, "pc-cancel");
  await tap(p, "pc-withdraw");
  const fWd = await floors(p);
  ok("with the withdraw confirm open: the same floors", fWd.sideways <= 1 && floorsOk(fWd), `${fWd.sideways} ${floorsWhy(fWd)}`);
  await mgr.ctx.close().catch(() => {});

  // ── C ──────────────────────────────────────────────────────────
  group("C. A reader: the director of sport at an entrant school");
  const rd = await open();
  const r = rd.page;
  ok("the director of sport signs in", await signIn(r, "sarah@example.invalid"));
  ok("Leagues → the competition → Playing conditions", await toConditions(r));
  ok("she is told it is read-only", /Only this competition's organiser can change these/.test(await said(r, "pc-readonly")));
  ok("she sees what is in force, from when, and the count", /In force today: Screen walk 2026\/27/.test(await said(r, "pc-in-force")) && (await said(r, "pc-count")) === `2 of ${M} figures confirmed`, await said(r, "pc-count"));
  ok("...the figures, each with its source or the chip", /clause 7\.3/.test(await said(r, "pc-figure-bowling.max_overs_per_bowler_innings")) && /platform default, unconfirmed/i.test(await said(r, "pc-figure-points.win"))
     && /6 overs.*12 overs.*clause 7\.4/.test(await said(r, "pc-figure-bowling.limit-U15")));
  ok("...the versions that are hers to see: 1 (in force) and 2 (withdrawn, with its note)", (await tid(r, "pc-version-1").count()) === 1 && (await tid(r, "pc-version-2").getAttribute("data-standing")) === "withdrawn"
     && /Dated wrongly/.test(await said(r, "pc-version-2")));
  ok("...who published it, by name where she may read that user, else 'another administrator' (never an id)",
     /Published by (K Naidu|another administrator), \d/.test(await said(r, "pc-version-1")) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(await said(r, "pc-version-1")), await said(r, "pc-version-1"));
  ok("...and no draft: the third version is not there", (await tid(r, "pc-version-3").count()) === 0 && !/Unpublished ideas/.test(await text(r)));
  ok("nothing to create, enter, clear, publish, amend or withdraw",
     (await tid(r, "pc-new-draft").count()) === 0 && (await r.locator('[data-testid^="pc-enter-"], [data-testid^="pc-clear-"]').count()) === 0
     && (await tid(r, "pc-publish").count()) === 0 && (await tid(r, "pc-amend").count()) === 0 && (await tid(r, "pc-withdraw").count()) === 0 && (await tid(r, "pc-newversion").count()) === 0);
  ok("...she may open the other version's figures, and they are read-only too", await (async () => {
    await tap(r, "pc-show-2");
    return /Figures of version 2/.test(await said(r, "pc-shown")) && (await r.locator('[data-testid^="pc-enter-"]').count()) === 0;
  })());
  ok("reserved keys: 'Recorded, not applied' shows only what was recorded (nothing was)", (await tid(r, "pc-reserved").count()) === 0);
  await shot(r, "4-reader");
  const fRead = await floors(r);
  ok("desktop, Floodlit: nothing under 12px, nothing pressed under 44px", floorsOk(fRead), floorsWhy(fRead));
  // the API agrees: she cannot write
  const sarah = await devLogin("sarah@example.invalid");
  const denied = await call(`/api/competitions/${LEAGUE}/playing-conditions`, { method: "POST", token: sarah, body: { title: "Not hers to write", effectiveFrom: d2 } });
  ok("(the API refuses her a draft, as the page does not offer one)", denied.status === 403 && denied.body?.error === "not_permitted", JSON.stringify(denied));
  ok("no console errors (reader)", rd.errors.length === 0, rd.errors.join(" | "));
  await rd.ctx.close().catch(() => {});

  // ── D (Daylight) ───────────────────────────────────────────────
  group("D. In Daylight");
  const day = await open("daylight");
  ok("the organiser signs in again", await signIn(day.page, "league@example.invalid"));
  ok("Playing conditions opens in Daylight", await toConditions(day.page));
  const theme = await day.page.evaluate(() => document.documentElement.dataset.theme);
  const fDay = await floors(day.page);
  ok("the theme is Daylight and the page is light", theme === "daylight" && /rgb\((2[0-9]{2}|1[89][0-9]), /.test(fDay.bg), `${theme} ${fDay.bg}`);
  ok("...with the same floors", floorsOk(fDay), floorsWhy(fDay));
  await tap(day.page, "pc-show-3");
  await tap(day.page, "pc-enter-format.free_hit");
  await shot(day.page, "5-daylight-editor");
  const fDayEd = await floors(day.page);
  ok("...and with an editor open", floorsOk(fDayEd), floorsWhy(fDayEd));
  // the toggle's on-state is drawn in the theme's own ink: text is not the fill
  const on = await day.page.$eval('[data-testid="pc-bool-no"]', (b) => ({ c: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor })).catch(() => null);
  ok("...its toggle is legible: ink differs from its ground", on && on.c !== on.bg, JSON.stringify(on));
  await tap(day.page, "pc-bool-yes");
  const on2 = await day.page.$eval('[data-testid="pc-bool-yes"]', (b) => ({ c: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor })).catch(() => null);
  ok("...pressed too", on2 && on2.c !== on2.bg, JSON.stringify(on2));
  ok("no console errors (Daylight)", day.errors.length === 0, day.errors.join(" | "));
  await day.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser playing-conditions screen walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 8).join("\n"));
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
console.log(`\n${"─".repeat(52)}\nBROWSER PLAYING-CONDITIONS SCREEN SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

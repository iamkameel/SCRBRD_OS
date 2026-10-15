#!/usr/bin/env node
/**
 * The Injuries screens, from a browser (GA-I19 slice B; the API is slice A,
 * db/111, and tools/smoke-injury.mjs walks it over HTTP).
 *
 * What this drives is what a physio, a coach, a director, a principal, a
 * parent and a boy each actually see and can do:
 *
 *   1. THE PHYSIO. "Reviews due" is her list, drawn for her alone, one reason
 *      a row; a boy who has left the school is off it and marked on the
 *      Injuries list. The Record form refuses an empty form in words and puts
 *      focus on the field, wants a next-review date (+7 and +14 set it) and
 *      saves one injury, its recording, and nothing else. The Review form
 *      steps him to rehabilitating on a named next review, and clearing him
 *      asks first and ends the injury. Focus goes into a form, to the
 *      opened injury, and back to the button that opened them.
 *   2. THE COACH AND THE DIRECTOR read the Injuries screen with no "review"
 *      word, no clinical note, no count, no worklist and no form: no request
 *      for the worklist is ever made. The coach's notice says a thing
 *      happened and, unopened, names nobody and no injury.
 *   3. THE PRINCIPAL reads status only: that a boy is out and until when, no
 *      phase word, no type, no note.
 *   4. THE PARENT reads her child's Health history in the school's three
 *      words, with the physio's note on a tap, and the boy reads his own.
 *   5. Nothing the walk draws is under 12px or tapped under 44px, the
 *      screens draw in Daylight, and motion is off under reduced motion.
 *
 * Leaves the database as it found it.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-injuries.mjs
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

const WEB_PORT = port(4397);
const API_PORT = port(8998);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const HIL = "11111111-1111-1111-1111-111111111111";
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";   // a 1XI boy, uninjured in the seed
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";      // the pupil, and the parent's son
const PILLAY_INJ = "cccccccc-0000-0000-0000-000000000001";  // his hamstring, in the seed
const SEED_INJ = [PILLAY_INJ, "cccccccc-0000-0000-0000-000000000002", "cccccccc-0000-0000-0000-000000000003"];
const LEAVER = "aaaaaaaa-0000-0000-0000-0000000000e1";
const LEAVER_INJ = "cccccccc-0000-0000-0000-0000000000e1";
const FAMILY_NOTE = "Smoke physio note for the family";
const CLINICAL = "Smoke clinical note";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-injuries-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

/** A sitting: its page, the page's errors and refusals, and every worklist request it made. */
async function open({ phone = false, theme = "floodlit", reduced = false } = {}) {
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    ...(phone ? { isMobile: true, hasTouch: true } : {}),
    ...(reduced ? { reducedMotion: "reduce" } : {}),
  });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [], refusals = [], worklist = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
    if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  page.on("request", (r) => { if (r.url().includes("/api/read/injury_worklist")) worklist.push(r.url()); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};
    try { localStorage.setItem("scrbrd:theme", ${JSON.stringify(theme)}); } catch (e) {}`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, refusals, worklist };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const inner = (page, id) => tid(page, id).innerText({ timeout: 4000 }).catch(() => "");
const main = async (page) => ((await tid(page, "os-main").count()) ? tid(page, "os-main").innerText() : page.$eval("body", (el) => el.innerText));
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
  await page.waitForTimeout(2200);
  return /Match Centre|Dashboard/i.test(await page.$eval("body", (el) => el.innerText)) || (await tid(page, "persona-bar").count()) === 1;
}
async function go(page, key) {
  const l = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"]`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1800);
  return true;
}
/** Text under 12px, and controls under 44px, inside each root, as drawn. */
async function floors(page, roots) {
  return page.evaluate((sel) => {
    const small = [], tiny = [];
    for (const root of document.querySelectorAll(sel)) {
      for (const n of [root, ...root.querySelectorAll("*")]) {
        if (n.closest(".sr-only")) continue;
        const cs = getComputedStyle(n);
        const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
        if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))) {
          const r = n.getBoundingClientRect();
          if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
        }
        if (n.tagName === "INPUT" && n.type === "checkbox") {
          const r = n.getBoundingClientRect();
          const row = n.closest("label")?.getBoundingClientRect();
          if (row && row.height < 44) tiny.push(`checkbox row ${Math.round(row.height)}px`);
          if (r.width && r.width < 24) tiny.push(`checkbox ${Math.round(r.width)}px`);
        }
      }
    }
    return { small, tiny };
  }, roots);
}
const focusedId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("data-testid") || document.activeElement?.tagName);
const saToday = async () => String((await q(`select to_char(sa_today(), 'YYYY-MM-DD') as d`))[0].d);
const plus = async (n) => String((await q(`select to_char(sa_today() + $1::int, 'YYYY-MM-DD') as d`, [n]))[0].d);
const human = async (iso) => String((await q(`select to_char($1::date, 'Dy FMDD Mon') as d`, [iso]))[0].d);

async function cleanup() {
  await q(`delete from notification where subject_kind = 'injury' and subject_id in (select id from injury where injury_type like 'Smoke%' or id = $1)`, [LEAVER_INJ]).catch(() => {});
  await q(`delete from injury_review where injury_id in (select id from injury where injury_type like 'Smoke%' or id = $1) or injury_id = $2`, [LEAVER_INJ, PILLAY_INJ]).catch(() => {});
  await q(`delete from injury where injury_type like 'Smoke%' or id = $1`, [LEAVER_INJ]).catch(() => {});
  await q(`delete from team_membership where player_id = $1`, [LEAVER]).catch(() => {});
  await q(`delete from player where id = $1`, [LEAVER]).catch(() => {});
  await q(`update injury set phase = 'rehab', restricted = true, next_review_on = null where id = $1`, [PILLAY_INJ]).catch(() => {});
  await q(`update player set fitness = 'fit' where id = $1`, [WHITFIELD]).catch(() => {});
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`).then((x) => x.json()); if (r?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await cleanup();

  // A boy who has left the school, with an injury still open: made as the
  // owner (the seed's way), then moved out of his side, which closes his
  // membership (db/08).
  await q(`insert into player (id, school_id, team_code, full_name, surname, squad_no, playing_role, born)
           values ($1, $2, '1XI', 'Leaver Boy', 'Boy', 87, 'bowler', (current_date - interval '16 years')::date)`, [LEAVER, HIL]);
  await q(`insert into injury (id, school_id, player_id, injury_type, severity, date_injured, rtw_date, phase, restricted, notes, physio)
           values ($1, $2, $3, 'Smoke leaver strain', 'minor', current_date - 3, current_date + 10, 'rehab', true, 'Smoke leaver note', 'Physio: rest')`,
          [LEAVER_INJ, HIL, LEAVER]);
  await q(`update player set team_code = null where id = $1`, [LEAVER]);
  const [{ n: gone }] = await q(`select count(*)::int as n from team_membership where player_id = $1 and left_on is null`, [LEAVER]);
  ok("the fixture boy has left (no open membership)", gone === 0);
  const [{ id: PHYSIO_ID }] = await q(`select id from app_user where email = 'medical@example.invalid'`);
  const today = await saToday();

  // ── 1. The physio ────────────────────────────────────────────────
  group("1. The physio: Reviews due, the Record form, the Review form");
  const p = await open({ reduced: true });
  const P = p.page;
  ok("the physio signs in", await signIn(P, "medical@example.invalid"));
  ok("Injuries opens", await go(P, "injuries"));
  await P.waitForTimeout(800);
  ok("Reviews due is drawn for her", await tid(P, "reviews-due").count() === 1);
  const rowIds = await P.$$eval('[data-testid^="review-due-"]', (els) => els.map((e) => e.getAttribute("data-testid").slice("review-due-".length)));
  ok("...one row for each of the seed's open injuries, each with its one reason",
     SEED_INJ.every((id) => rowIds.includes(id)) && (await P.$$eval('[data-testid^="review-due-"]', (els) => els.every((e) => e.getAttribute("data-reason")))), rowIds.join());
  ok("...a boy who has left the school is not on it", !rowIds.includes(LEAVER_INJ));
  ok("...but is on the Injuries list, marked left the school",
     (await inner(P, `left-school-${LEAVER_INJ}`)).toLowerCase().includes("left the school"));
  ok("the old 'is coming' line is gone", await tid(P, "injury-writes-coming").count() === 0 && !/is coming/.test(await main(P)));
  const navText = await P.locator('[data-testid="nav-injuries"]').first().innerText().catch(() => "?");
  ok("no count on the Injuries nav item, not even for her", !/\d/.test(navText) && (await P.locator('[data-testid="nav-injuries"] [data-testid$="badge"]').count()) === 0, navText);
  ok("the count sits in her list's own heading and nowhere else",
     (await tid(P, "reviews-due-count").count()) === 1 && (await P.locator('[data-testid="reviews-due-count"]').evaluate((e) => !!e.closest('[data-testid="reviews-due"]')).catch(() => false)));
  const tr = await P.$eval('[data-testid="record-injury-open"]', (b) => parseFloat(getComputedStyle(b).transitionDuration)).catch(() => 9);
  ok("under reduced motion her buttons do not animate", tr <= 0.001, String(tr));

  // The Record form: refused empty, in words, focus on the field.
  const before = (await q(`select count(*)::int as n from injury`))[0].n;
  await tid(P, "record-injury-open").click({ timeout: 5000 });
  await P.waitForTimeout(400);
  ok("Record an injury opens a form", await tid(P, "record-injury-form").count() === 1);
  ok("...focus is in it, on the first field", (await focusedId(P)) !== "BODY" && await P.evaluate(() => !!document.activeElement?.closest('[data-testid="record-injury-form"]')));
  ok("...it says it is the school's record and not a medical file", /school's record, not a medical file/.test(await inner(P, "record-injury-form")));
  ok("...and says what a serious injury tells the safeguarding officer, naming nobody", /names nobody/.test(await inner(P, "record-serious-note")));
  await tid(P, "record-save").click();
  await P.waitForTimeout(400);
  ok("empty, it is refused in words", /Choose the boy/.test(await inner(P, "record-refused")));
  ok("...and focus goes to the boy field", (await P.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "record-player");
  await tid(P, "record-player").selectOption(WHITFIELD);
  await tid(P, "record-type").fill("Smoke strain");
  await tid(P, "record-severity").selectOption("moderate");
  await tid(P, "record-notes").fill(CLINICAL);
  await tid(P, "record-save").click();
  await P.waitForTimeout(400);
  ok("without a next review, it is refused and focus goes to that field",
     /next/i.test(await inner(P, "record-refused")) && (await P.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "next-review");
  ok("...and nothing was written", (await q(`select count(*)::int as n from injury`))[0].n === before);
  const d7 = await plus(7), d14 = await plus(14);
  await tid(P, "next-review-plus-14").click();
  ok("+14 sets the date fourteen days on", await tid(P, "next-review").inputValue() === d14, await tid(P, "next-review").inputValue());
  await tid(P, "next-review-plus-7").click();
  ok("+7 sets seven days on and says it is pressed", await tid(P, "next-review").inputValue() === d7
     && await tid(P, "next-review-plus-7").getAttribute("aria-pressed") === "true" && await tid(P, "next-review-plus-14").getAttribute("aria-pressed") === "false");
  await tid(P, "next-review").fill(await plus(-1));
  await tid(P, "record-save").click();
  await P.waitForTimeout(900);
  ok("a date already past is the server's refusal, in a sentence", /today or later/.test(await inner(P, "record-refused")));
  ok("...and still nothing was written", (await q(`select count(*)::int as n from injury`))[0].n === before);
  const fr = await floors(P, '[data-testid="record-injury-form"], [data-testid="reviews-due"]');
  ok(`the form and her list: nothing under 12px (${fr.small.length}), nothing tapped under 44px (${fr.tiny.length})`,
     fr.small.length === 0 && fr.tiny.length === 0, [...fr.small, ...fr.tiny].slice(0, 4).join(" · "));
  await tid(P, "next-review-plus-7").click();
  await tid(P, "record-save").click();
  await P.waitForTimeout(1500);
  const made = (await q(`select i.id, i.recorded_by, i.next_review_on::text as nr, i.phase, i.severity,
                                (select count(*)::int from injury_review r where r.injury_id = i.id) as reviews
                           from injury i where i.injury_type = 'Smoke strain'`));
  ok("saved: one injury, by her, on the date she chose, and its one review (the recording)",
     made.length === 1 && made[0].recorded_by === PHYSIO_ID && made[0].nr === d7 && made[0].reviews === 1 && made[0].phase === "active", JSON.stringify(made));
  const NEW = made[0]?.id;
  const saved = await inner(P, "injury-saved");
  ok("the form closes and says so, without a name in it", saved.trim() === "Injury recorded." && !/Whitfield/.test(saved), saved);
  ok("...focus returns to the button that opened it", (await P.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "record-injury-open");
  ok("...and he is on her list: his next review is within the week, so it is due", (await tid(P, `review-due-${NEW}`).getAttribute("data-reason").catch(() => null)) === "due");

  // Open him from the worklist; review him.
  await tid(P, `review-due-${NEW}`).click();
  await P.waitForTimeout(1500);
  ok("tapping a row opens the injury and moves focus to its heading", await tid(P, "injury-detail").count() === 1 && (await focusedId(P)) === "injury-detail-title");
  const detail = await inner(P, "injury-detail");
  ok("...her clock is in it: the next review date", new RegExp(`Next review[\\s\\S]*${(await human(d7)).split(" ").slice(1).join(" ")}`).test(detail), detail.slice(0, 300));
  ok("...the history opens with the recording, and her note on it", /Recorded/.test(await inner(P, "injury-history")) && (await inner(P, "history-note")).includes(CLINICAL));
  await tid(P, "review-open").click();
  await P.waitForTimeout(400);
  ok("Review opens a form with focus in it", await tid(P, "review-form").count() === 1 && await P.evaluate(() => !!document.activeElement?.closest('[data-testid="review-form"]')));
  const phases = await P.$$eval('[data-testid="review-phase"] option', (o) => o.map((x) => x.textContent));
  ok("the phases are Injured, Rehabilitating, Cleared", phases.join() === "Injured,Rehabilitating,Cleared", phases.join());
  await tid(P, "review-phase").selectOption("rehab");
  await tid(P, "review-save").click();
  await P.waitForTimeout(400);
  ok("a step that does not clear him needs a next review", /next/i.test(await inner(P, "review-refused")) && (await P.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "next-review");
  ok("...and wrote nothing", (await q(`select count(*)::int as n from injury_review where injury_id = $1`, [NEW]))[0].n === 1);
  await tid(P, "next-review-plus-14").click();
  await tid(P, "review-note").fill("Smoke step to rehab");
  await tid(P, "review-save").click();
  await P.waitForTimeout(1800);
  const stepped = (await q(`select i.phase, i.next_review_on::text as nr, p.fitness, (select count(*)::int from injury_review r where r.injury_id = i.id) as reviews
                              from injury i join player p on p.id = i.player_id where i.id = $1`, [NEW]))[0];
  ok("saved: rehabilitating, next review +14, his fitness follows, two reviews", stepped.phase === "rehab" && stepped.nr === d14 && stepped.fitness === "rehab" && stepped.reviews === 2, JSON.stringify(stepped));
  ok("...the form closed, 'Review saved.', focus back on the button", (await inner(P, "injury-saved")).trim() === "Review saved."
     && await tid(P, "review-form").count() === 0 && (await P.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "review-open");
  ok("...and the history has both, newest first", (await P.$$eval('[data-testid="history-row"]', (r) => r.map((x) => x.innerText))).length === 2);

  // Clear him: asks first; "Not yet" writes nothing; yes ends the injury.
  await tid(P, "review-open").click();
  await tid(P, "review-phase").selectOption("cleared");
  ok("choosing Cleared drops the next review and unchecks restricted",
     await tid(P, "next-review").count() === 0 && await tid(P, "review-next-none").count() === 1
     && await tid(P, "review-restricted").isDisabled() && !(await tid(P, "review-restricted").isChecked()));
  await tid(P, "review-save").click();
  await P.waitForTimeout(400);
  ok("clearing asks first, in words", /cannot be reopened/.test(await inner(P, "review-clear-confirm")));
  await click(P, /^Not yet$/);
  ok("'Not yet' writes nothing", (await q(`select phase from injury where id = $1`, [NEW]))[0].phase === "rehab" && await tid(P, "review-clear-confirm").count() === 0);
  await tid(P, "review-save").click();
  await P.waitForTimeout(300);
  await tid(P, "review-clear-yes").click();
  await P.waitForTimeout(1800);
  const cleared = (await q(`select i.phase, i.restricted, i.next_review_on, p.fitness from injury i join player p on p.id = i.player_id where i.id = $1`, [NEW]))[0];
  ok("cleared: no longer restricted, no next review, he is fit", cleared.phase === "cleared" && cleared.restricted === false && cleared.next_review_on === null && cleared.fitness === "fit", JSON.stringify(cleared));
  ok("...the screen says so, offers no Review and tells her to record a new injury if he is hurt again",
     (await inner(P, "injury-saved")).trim() === "Cleared to play." && await tid(P, "review-open").count() === 0 && /record a new injury/.test(await inner(P, "review-closed")));
  ok("...and he is off her list", await tid(P, `review-due-${NEW}`).count() === 0);
  ok("his coach was told 'Cleared to play', in words that name nobody",
     (await q(`select title, body is not null as has_body from notification where subject_id = $1 and title = 'Cleared to play'`, [NEW])).length === 1);

  // R Pillay's seeded injury: the review the family will read.
  await tid(P, `injury-${PILLAY_INJ}`).click();
  await P.waitForTimeout(1200);
  await tid(P, "review-open").click();
  await tid(P, "review-phase").selectOption("rehab");
  await tid(P, "next-review-plus-7").click();
  await tid(P, "review-note").fill(FAMILY_NOTE);
  await tid(P, "review-save").click();
  await P.waitForTimeout(1800);
  ok("a review of the seed's own injury is saved", (await q(`select count(*)::int as n from injury_review where injury_id = $1`, [PILLAY_INJ]))[0].n === 1);
  ok("...its history, which had no recording, calls it a review, not a recording",
     /Review/.test(await inner(P, "injury-history")) && !/Recorded/.test(await inner(P, "injury-history")));

  // The boy who left.
  await tid(P, `injury-${LEAVER_INJ}`).click();
  await P.waitForTimeout(1200);
  ok("a boy who left: the report says so, and that he is not on her list", /left the school[\s\S]*not on your list/.test(await inner(P, "injury-detail")));
  const fd = await floors(P, '[data-testid="injury-detail"], ul[aria-label="Injuries"], [data-testid="reviews-due"]');
  ok(`her screen: nothing under 12px (${fd.small.length}), nothing tapped under 44px (${fd.tiny.length})`, fd.small.length === 0 && fd.tiny.length === 0, [...fd.small, ...fd.tiny].slice(0, 4).join(" · "));
  ok("no page error, no client-side scoping", p.errors.length === 0 && p.refusals.length === 0, [...p.errors, ...p.refusals].join(" | "));
  await p.ctx.close();

  // ── 2. The coach and the director ───────────────────────────────
  const secrets = (await q(`select notes, physio from injury where id = $1`, [PILLAY_INJ]))[0];
  for (const [who, email, label] of [["coach", "coach@example.invalid", "A coach (1XI)"], ["director", "sarah@example.invalid", "The director of sport"]]) {
    group(`2. ${label} reads the Injuries screen: status and nature, no note, no review, no count`);
    const c = await open();
    const C = c.page;
    ok(`${who} signs in`, await signIn(C, email));
    ok("Injuries opens", await go(C, "injuries"));
    await C.waitForTimeout(800);
    await tid(C, `injury-${PILLAY_INJ}`).click({ timeout: 5000 }).catch(() => {});
    await C.waitForTimeout(1500);
    const t = await main(C);
    ok("the injury and its phase are there, in the school's words", /Rehabilitating/.test(t) && /Grade 2 hamstring strain/.test(t));
    ok("the screen has no 'review' word anywhere", !/review/i.test(t), t.match(/.{0,30}review.{0,30}/i)?.[0]);
    ok("...no worklist, no Record, no Review, no count", await tid(C, "reviews-due").count() === 0 && await tid(C, "reviews-due-count").count() === 0
       && await tid(C, "record-injury-open").count() === 0 && await tid(C, "review-open").count() === 0 && c.worklist.length === 0, `${c.worklist.length} worklist requests`);
    ok("...no clinical note, the seed's or the physio's", await tid(C, "injury-clinical-notes").count() === 0 && await tid(C, "history-note").count() === 0
       && !t.includes(secrets.notes.slice(0, 25)) && !t.includes(FAMILY_NOTE) && !/eccentric/i.test(t));
    ok("...but the history of the physio's looks, with dates", /Seen by the physio/.test(await inner(C, "injury-history")) && (await C.locator('[data-testid="history-row"]').count()) >= 1);
    ok("...and no clock: no next date of the physio's", !/next/i.test(await inner(C, "injury-history")));
    const nav = await C.locator('[data-testid="nav-injuries"]').first().innerText().catch(() => "?");
    ok("no count on the Injuries nav item", !/\d/.test(nav), nav);
    ok("no page error", c.errors.length === 0 && c.refusals.length === 0, [...c.errors, ...c.refusals].join(" | "));
    if (who === "coach") {
      ok("Notices opens", await go(C, "notifications"));
      const rows = await C.$$eval('[data-testid="notice-row"]', (els) => els.map((e) => e.innerText));
      const injury = rows.filter((r) => /Injury recorded|Cleared to play|Return date updated/.test(r));
      ok("his injury notices are listed by title alone: 'Open to read', no name and no injury in the preview",
         injury.length >= 1 && injury.every((r) => /Open to read/.test(r) && !/Whitfield|Pillay|strain|hamstring/i.test(r)), injury.join(" | ").slice(0, 200));
    }
    await c.ctx.close();
  }

  // ── 3. The principal: status only ───────────────────────────────
  group("3. The principal reads status only");
  const pr = await open();
  const R = pr.page;
  ok("the principal signs in", await signIn(R, "principal@example.invalid"));
  ok("Injuries opens", await go(R, "injuries"));
  await R.waitForTimeout(800);
  await tid(R, `injury-${PILLAY_INJ}`).click({ timeout: 5000 }).catch(() => {});
  await R.waitForTimeout(1500);
  const rt = await main(R);
  ok("a boy is out, and until when: the Out tile and the return date", /\bout\b/i.test(rt) && !/Rehabilitating/.test(rt) && /Restricted/.test(rt) && /RTW/.test(rt));
  ok("...no phase, no kind of injury, no note", !/Phase:\s*(Injured|Rehabilitating|Cleared)/.test(rt) && /Details withheld/.test(rt) && !/hamstring/i.test(rt)
     && await tid(R, "injury-clinical-notes").count() === 0 && !rt.includes(FAMILY_NOTE));
  ok("...no 'review' word, no worklist, no forms", !/review/i.test(rt) && pr.worklist.length === 0 && await tid(R, "reviews-due").count() === 0 && await tid(R, "record-injury-open").count() === 0);
  const hist = await inner(R, "injury-history");
  ok("...the history says only that he was seen, and what it left him as", /Seen by the physio/.test(hist) && /Restricted/.test(hist) && !/Rehabilitating|Injured|Cleared/.test(hist), hist);
  ok("no page error", pr.errors.length === 0 && pr.refusals.length === 0, [...pr.errors, ...pr.refusals].join(" | "));
  await pr.ctx.close();

  // ── 4. The parent and the boy ───────────────────────────────────
  group("4. The parent reads her child's Health history, and the boy his own");
  const pa = await open({ phone: true });
  const A = pa.page;
  ok("the parent signs in", await signIn(A, "parent@example.invalid"));
  ok("Family opens", await go(A, "family"));
  await tid(A, `family-open-health-${PILLAY}`).click({ timeout: 5000 }).catch(() => {});
  await A.waitForTimeout(1500);
  ok("the card is called Health history", /Health history/.test(await inner(A, `family-open-health-${PILLAY}`)));
  const line = await inner(A, `injury-line-${PILLAY_INJ}`);
  ok("his injury, in the school's words: Rehabilitating, Moderate, and when he is back", /Rehabilitating/.test(line) && /Moderate/.test(line) && /back/.test(line), line);
  await tid(A, `injury-history-open-${PILLAY_INJ}`).click({ timeout: 4000 }).catch(() => {});
  await A.waitForTimeout(1500);
  const ph = await inner(A, `injury-history-${PILLAY_INJ}`);
  ok("how it has gone: the physio's look, dated, with her note, which is the parent's to read", /Seen by the physio/.test(ph) && ph.includes(FAMILY_NOTE), ph);
  ok("...no clock and no worklist", !/next review/i.test(ph) && pa.worklist.length === 0 && await tid(A, "reviews-due").count() === 0);
  const ft = await floors(A, '[data-testid="health"]');
  ok(`Health history on a phone: nothing under 12px (${ft.small.length}), nothing tapped under 44px (${ft.tiny.length})`, ft.small.length === 0 && ft.tiny.length === 0, [...ft.small, ...ft.tiny].slice(0, 4).join(" · "));
  ok("no other child's injury", !/Whitfield|Smoke strain|Smoke leaver|shoulder|Wrist/i.test(await inner(A, "health")));
  ok("no page error", pa.errors.length === 0 && pa.refusals.length === 0, [...pa.errors, ...pa.refusals].join(" | "));
  await pa.ctx.close();

  const pu = await open({ phone: true, theme: "daylight" });
  const U = pu.page;
  ok("the boy signs in", await signIn(U, "pillay@example.invalid"));
  ok("Me opens", await go(U, "me"));
  await tid(U, `injury-history-open-${PILLAY_INJ}`).click({ timeout: 5000 }).catch(() => {});
  await U.waitForTimeout(1500);
  const mine = await inner(U, "me-health");
  ok("his own injury and its history, with the physio's note, in Daylight too",
     /Rehabilitating/.test(mine) && mine.includes(FAMILY_NOTE) && await U.evaluate(() => document.documentElement.dataset.theme) === "daylight", mine.slice(0, 200));
  ok("...and no team-mate's, and no list of anyone's reviews", !/Whitfield|Smoke strain|Smoke leaver|shoulder|Wrist/i.test(mine) && pu.worklist.length === 0);
  const fu = await floors(U, '[data-testid="me-health"]');
  ok("...nothing under 12px, nothing tapped under 44px", fu.small.length === 0 && fu.tiny.length === 0, [...fu.small, ...fu.tiny].slice(0, 4).join(" · "));
  ok("no page error", pu.errors.length === 0 && pu.refusals.length === 0, [...pu.errors, ...pu.refusals].join(" | "));
  await pu.ctx.close();
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.message);
} finally {
  await cleanup();
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nBROWSER INJURIES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

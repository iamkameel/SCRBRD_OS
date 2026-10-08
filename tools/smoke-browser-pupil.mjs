#!/usr/bin/env node
/**
 * The pupil's app, from a browser, signed in as the pupil (redesign step 4,
 * phase A; docs/design/STEP4_parent_pupil.md §2.2, §8).
 *
 * R Pillay holds `player` on the 1st XI and `selfaccess` on his own record
 * (db/98). His app is Home · Matches · Passport · Me: his next fixture with
 * his team-sheet line, his bus and HIS answer; his side's matches; his
 * passport, figures first; and his own file. What the walk proves:
 *
 *   - Home shows his team-sheet line and his own availability, and no
 *     team-mate's answer, reason or name;
 *   - he answers for himself from his fixture, and the row says he did;
 *   - Passport shows his figures — a scorebook innings he played — and the
 *     Wheel tab (SCRBRD-102) draws;
 *   - the Match Centre lights his own row and offers a wheel for him only;
 *   - Me shows his own injury record, the nature and the physio's notes
 *     (selfaccess), and his conduct record only when he asks for it (§9 Q6);
 *   - THE FLIPPED ASSERTION (K3, db/55): no team-mate's injury, fitness or
 *     return date reaches him — not on the team sheet, and not through the
 *     reads behind it;
 *   - nothing read under 12px and nothing tapped under 44px, at phone width;
 *   - no scoping refusals, no page errors;
 *   - THE CAPTAIN'S VIEW (SCRBRD-138 phase A): the seed's pupil is awarded
 *     `captain` for the walk and it is withdrawn after. With it, his Home
 *     carries the card, his fixture the section, his match the tab; a
 *     team-mate without the honour has none of them; after the withdrawal
 *     they are gone on the next load; so they are when the honour's side is
 *     not his; a vice-captain has the same view under his own label. The tab
 *     says overs left in the cap's own words (the pad's sentence, from the
 *     scoring package), says no injury, fitness word, guideline,
 *     availability or reason, offers no row to open, and puts no child of
 *     another school on screen beyond the log's own names.
 *
 * Every fixture here takes an explicit date.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-pupil.mjs
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
import { bookCard, writeBookInnings } from "./book-innings.mjs";
import { capWords } from "@scrbrd/scoring";
import { ATTACK, buildCaptainFixtures, fixConditions, PLAY } from "./fixture-captain.mjs";

const WEB_PORT = port(4366);
const API_PORT = port(8966);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 220)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";      // the pupil
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";   // a team-mate
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";      // a team-mate, injured (rtw 2026-10-10)
const NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";
const OVAL = "ffffffff-0000-0000-0000-000000000001";
// A team-mate's health, in every form it could leak in: the injury, the tier
// word, the fitness column's words, the return date written either way.
// (Not "unavailable": it is one of his own three answer keys on this screen.)
const HEALTH = /shoulder|impingement|rehab|injur|fitness|not fit|10 Oct|2026-10-10|Back Sat 10/i;

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-pupil-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const owner = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await owner.query(text, params)).rows;
const browser = await chromium.launch({ ...launchOptions() });

/** A fresh context per sitting; a phone by default. `reads` records the conduct record's read. */
async function open({ phone = true } = {}) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [], refusals = [], reads = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
    if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
  });
  page.on("request", (r) => { if (r.url().includes("/api/read/disciplinary_records")) reads.push(r.url()); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, refusals, reads };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const inner = (page, id) => tid(page, id).first().innerText({ timeout: 5000 }).catch(() => "");
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
async function signIn(page) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await click(page, /pillay@example\.invalid/, 4000);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  return (await tid(page, "persona-bar").count()) === 1;
}
async function go(page, key) {
  const l = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"]`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1800);
  return (await tid(page, "os-main").getAttribute("data-page")) === key;
}
/** §3.2 and §3.5 over the main area, the header and the bar. */
async function floors(page) {
  return page.evaluate(() => {
    const small = [], tiny = [];
    for (const root of document.querySelectorAll('[data-testid="os-main"], [data-testid="persona-bar"], [data-testid="mnav"]')) {
      for (const n of [root, ...root.querySelectorAll("*")]) {
        if (n.closest(".sr-only")) continue;
        const cs = getComputedStyle(n);
        const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
        if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))) {
          const r = n.getBoundingClientRect();
          if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
        }
      }
    }
    return { small, tiny };
  });
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── The fixture: his side's next, with a team sheet, a bus and answers ──
  // Explicit dates throughout, all after the Laws' 4th Edition (1 Oct 2026).
  const NEXT = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status, ground_id)
     values ($1, '1XI', 'Verify Pupil XI', '2026-10-02 07:00+02', 'T20', 20, 'scheduled', $2) returning id`, [HIL, OVAL]))[0].id;
  // His side's next, whatever the clock: dated well ahead, and the seeded
  // fixtures moved past it.
  await q(`update match set starts_at = '2027-06-05 09:00+02' where school_id = $1 and team_code = '1XI' and status = 'scheduled' and id <> $2`, [HIL, NEXT]);
  await q(`update match set starts_at = '2027-02-20 09:00+02' where id = $1`, [NEXT]);
  await q(`insert into match_squad (match_id, player_id, side, batting_no) values
             ($1, $2, 'home', 4), ($1, $3, 'home', 1), ($1, $4, 'home', 2), ($1, $5, 'home', 3)`, [NEXT, PILLAY, WHITFIELD, BEKKER, NAIDOO]);
  await q(`insert into trip (match_id, school_id, depart_at, pickup) values ($1, $2, '2027-02-20 07:15+02', 'the Chapel car park')`, [NEXT, HIL]);
  const coachId = (await q(`select id from app_user where email = 'coach@example.invalid'`))[0].id;
  const pupilId = (await q(`select id from app_user where email = 'pillay@example.invalid'`))[0].id;
  // A team-mate's answer, with its reason: his home life, not the pupil's to read.
  await q(`insert into match_availability (match_id, player_id, school_id, status, reason_kind, note, declared_by)
           values ($1, $2, $3, 'unavailable', 'family', 'A family funeral', $4)`, [NEXT, WHITFIELD, HIL, coachId]);
  // His own innings, from a scorebook, on a date of its own.
  const scorer = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  const players = [PILLAY, WHITFIELD, BEKKER, NAIDOO, "aaaaaaaa-0000-0000-0000-000000000004", "aaaaaaaa-0000-0000-0000-000000000011"];
  const PLAYED = await writeBookInnings(owner, { school: HIL, startsAt: "2026-09-26 09:00+02", scorerUserId: scorer,
                                                card: bookCard(players), ours: "Hilton 1XI", opponent: "Verify Book XI",
                                                squad: (await q(`select id, full_name as name from player where id = any($1::uuid[])`, [players])) });

  group("The pupil's app: Home · Matches · Passport · Me");
  const s = await open();
  // GA-I20 A1 (D12): what his own To-do list asks the server for.
  const asked = [];
  s.page.on("request", (r) => { if (r.url().includes("/api/")) asked.push(new URL(r.url()).pathname); });
  ok("the pupil signs in, to his own app's header", await signIn(s.page));
  ok("...and lands on his Home", await tid(s.page, "os-main").getAttribute("data-page") === "myhome");
  const bar = await s.page.$$eval('[data-testid^="mnav-"]', (els) => els.map((e) => e.getAttribute("data-testid")));
  ok("the bar is his four, in order, with no More", bar.join() === "mnav-myhome,mnav-mymatches,mnav-passport,mnav-me", bar.join());
  ok("...and no drawer", await tid(s.page, "mnav-more").count() === 0 && await tid(s.page, "drawer").count() === 0);

  group("Home: his next fixture, his line on the sheet, his own answer — and no team-mate's");
  const home = await inner(s.page, "pupil-home");
  ok("his next fixture first", /Verify Pupil XI/.test(await inner(s.page, "next-fixture-title")));
  ok("his team-sheet line: in the side, batting 4", /You're in the side · batting 4/.test(await inner(s.page, "teamsheet-line")));
  ok("the bus", /Bus leaves 07:15 · the Chapel car park/.test(await inner(s.page, "bus-line")));
  ok("his own answer: not given yet", /No answer yet/.test(await inner(s.page, `availability-state-${PILLAY}`)));
  ok("no team-mate's answer, reason or name is on his Home",
     !/Whitfield|Bekker|Naidoo|funeral|family/i.test(home) && await tid(s.page, `availability-state-${WHITFIELD}`).count() === 0, home.slice(0, 300));
  ok("what the coach and the school posted is on his Home (§1.2 job 6)", await tid(s.page, "news-card").count() === 1);
  const fh = await floors(s.page);
  ok(`Home at phone width: nothing read under 12px (${fh.small.length})`, fh.small.length === 0, fh.small.slice(0, 4).join(" · "));
  ok(`...nothing tapped under 44px (${fh.tiny.length})`, fh.tiny.length === 0, fh.tiny.slice(0, 4).join(" · "));

  group("His own To-do list (GA-I20 A1, D12): his answers, and no lift, consent or contact row");
  {
    await s.page.waitForFunction(() => { const e = document.querySelector('[data-testid="todo-count"]'); return !!e && !/^Reading/.test(e.innerText); }, null, { timeout: 9000 }).catch(() => {});
    const card = await inner(s.page, "todo-card");
    const order = await s.page.$$eval('[data-testid="pupil-home"] > *', (els) => els.map((e) => e.getAttribute("data-testid")).filter(Boolean));
    ok("'To do for you', under his next fixture", /To do for you/i.test(card) && order.indexOf("todo-card") === order.indexOf("next-fixture") + 1, order.join());
    // Every fixture of his side is months away (dated so above): the window is fourteen days, and the rest fold.
    ok("nothing inside fourteen days, said for the window; his unanswered fixtures folded under 'Later'",
       /Nothing to do for you in the next 14 days/.test(card) && /Later · \d+ to answer/.test(card), card);
    await tid(s.page, "todo-later").click({ timeout: 4000 }).catch(() => {});
    await s.page.waitForTimeout(300);
    const rows = await s.page.$$eval('[data-testid="todo-card"] [data-testid^="todo-row-"]', (els) => els.map((e) => e.getAttribute("data-testid")));
    ok("...unfolded: one row per fixture, each his own answer (R1), worded to him", rows.includes(`todo-row-${NEXT}`) && rows.every((r) => !/^todo-row-R\d/.test(r))
       && /Answer for \w{3} v Verify Pupil XI/.test(await inner(s.page, `todo-row-${NEXT}`)) && /you or your parents/.test(await inner(s.page, `todo-row-${NEXT}`)), rows);
    ok("no lift, consent or contact row, and no 'What you have agreed' card", !/seat|lift|consent|public pages|Health monitoring|number|ring/i.test(await inner(s.page, "todo-card"))
       && await tid(s.page, "todo-record").count() === 0);
    ok("...and his list never asked for a contact count, a lift, a driver's requests or the public-name answer",
       !asked.some((p) => /emergency_contact|\/matches\/[^/]+\/lifts|lifts\/requests|public-name/.test(p)), asked.filter((p) => /emergency_contact|\/matches\/[^/]+\/lifts|lifts\/requests|public-name/.test(p)));
    ok("no team-mate's name on it", !/Whitfield|Bekker|Naidoo/.test(await inner(s.page, "todo-card")));
    await tid(s.page, "todo-later").click({ timeout: 4000 }).catch(() => {});
  }

  group("He answers for himself, from the fixture");
  await tid(s.page, "next-fixture-open").click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(1500);
  ok("the fixture opens", /Verify Pupil XI/.test(await inner(s.page, "fixture-title")));
  const sheet = await inner(s.page, "side-sheet");
  ok("the team sheet: his side, by name and place", /R Pillay/.test(sheet) && /James Whitfield/.test(sheet) && /T Bekker/.test(sheet));
  // K3 (db/55), the flipped assertion: before db/55 a pupil read every
  // team-mate's injury status. The sheet is names and places, and nothing on
  // the fixture says who is hurt, how, or until when.
  const fixtureText = await inner(s.page, "os-main");
  ok("...and no team-mate's injury, fitness or return date anywhere on it (K3)", !HEALTH.test(fixtureText), fixtureText.match(HEALTH)?.[0]);
  ok("...nor a team-mate's answer or its reason", await tid(s.page, `availability-state-${WHITFIELD}`).count() === 0 && !/funeral|family/i.test(fixtureText));
  await tid(s.page, `availability-set-${PILLAY}-doubtful`).click({ timeout: 4000 }).catch(() => {});
  await s.page.selectOption(`[data-testid="availability-reason-${PILLAY}"]`, "illness").catch(() => {});
  await tid(s.page, `availability-send-${PILLAY}`).click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(1500);
  ok("he says doubtful, and the screen says he said it",
     /Doubtful/.test(await inner(s.page, `availability-state-${PILLAY}`)) && /said by you/.test(await inner(s.page, `availability-by-${PILLAY}`)));
  const row = (await q(`select status, reason_kind, declared_by from match_availability where match_id = $1 and player_id = $2`, [NEXT, PILLAY]))[0];
  ok("...the row is his own declaration", row?.status === "doubtful" && row?.reason_kind === "illness" && row?.declared_by === pupilId, JSON.stringify(row));
  ok("...and the team-mate's answer is untouched", (await q(`select status from match_availability where match_id = $1 and player_id = $2`, [NEXT, WHITFIELD]))[0]?.status === "unavailable");

  group("Matches: his side's, his line on a played match, and the Match Centre lighting him");
  ok("Matches opens", await go(s.page, "mymatches"));
  ok("...the fixture coming up, his answer on its row", /Doubtful/.test(await inner(s.page, `fixture-chip-${NEXT}`)));
  ok("...the played match, with his line in words and no other name in it",
     /You: 34 off 40, caught$/.test((await inner(s.page, `played-line-${PLAYED}`)).trim()), await inner(s.page, `played-line-${PLAYED}`));
  await tid(s.page, `played-row-${PLAYED}`).click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(2000);
  await tid(s.page, "mc-tab-scorecard").click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(800);
  const lit = await s.page.$$eval('[data-testid="mc-bat-row"][data-focus="true"]', (els) => els.map((e) => e.innerText));
  ok("the scorecard lights his row, and only his, with a word", lit.length === 1 && /R Pillay/.test(lit[0]) && /\bYou\b/i.test(lit[0]), lit.join(" | "));
  await tid(s.page, "mc-tab-analytics").click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(800);
  const whose = await s.page.$$eval('[aria-label="Whose shots"] button', (els) => els.map((e) => e.innerText.trim()));
  ok("Analytics offers a wheel for him only, beside the whole innings", whose.join() === "Whole innings,R Pillay", whose.join());
  await tid(s.page, "mc-back").click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(600);

  group("Passport: his figures, on the board; the Wheel tab");
  ok("Passport opens", await go(s.page, "passport"));
  ok("the board: his 34 runs from the scorebook innings", (await inner(s.page, "passport-runs")).trim() === "34");
  ok("...and his average, figures first", /AVG 34/.test(await inner(s.page, "passport-board")));
  ok("the season tab carries his season", /34 runs/.test(await inner(s.page, "passport-panel-season")));
  await tid(s.page, "passport-tab-wheel").click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(1500);
  ok("the Wheel tab draws his own wheel (SCRBRD-102)", await tid(s.page, "career-wagon-wheel").count() === 1);
  await tid(s.page, "passport-tab-honours").click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(1200);
  ok("the Honours tab draws", await tid(s.page, "passport-milestones").count() === 1 && await tid(s.page, "passport-honours").count() === 1);
  const fp = await floors(s.page);
  ok(`Passport at phone width: nothing read under 12px (${fp.small.length})`, fp.small.length === 0, fp.small.slice(0, 4).join(" · "));
  ok(`...nothing tapped under 44px (${fp.tiny.length})`, fp.tiny.length === 0, fp.tiny.slice(0, 4).join(" · "));

  group("Me: his own injury record, the nature and the notes (selfaccess); his conduct only when he asks");
  ok("Me opens", await go(s.page, "me"));
  const health = await inner(s.page, "me-health");
  ok("his injury, by its nature", /Grade 2 hamstring strain/.test(health));
  ok("...and only his: no team-mate's", !/shoulder|Wrist/i.test(health));
  const inj = await s.page.$eval('[data-testid^="injury-open-"]', (e) => e.getAttribute("data-testid")).catch(() => null);
  if (inj) await tid(s.page, inj).click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(400);
  const notes = (await q(`select notes from injury where player_id = $1`, [PILLAY]))[0]?.notes;
  ok("...and the physio's notes, which are his to read", !!notes && (await inner(s.page, "injury-notes")).includes(notes.slice(0, 20)), notes);
  ok("his conduct record was not read before he asked for it (§9 Q6)", s.reads.length === 0, s.reads.join(" "));
  await tid(s.page, "me-conduct-show").click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(1500);
  ok("...and is, when he does", s.reads.length === 1 && await tid(s.page, "me-conduct").count() === 1);
  await tid(s.page, "me-record-show").click({ timeout: 4000 }).catch(() => {});
  await s.page.waitForTimeout(1500);
  // The seed's birthdays are relative to today (db/98), so the day is read, not pinned.
  const bornWords = (await q(`select to_char(born, 'FMDD Mon YYYY') as d from player where full_name = 'R Pillay'`))[0]?.d;
  ok(`his own record: his date of birth (${bornWords}), his ID behind a tap`,
     !!bornWords && (await inner(s.page, "their-record")).includes(bornWords) && await tid(s.page, "record-id").count() === 0 && await tid(s.page, "record-id-show").count() === 1);
  const fm = await floors(s.page);
  ok(`Me at phone width: nothing read under 12px (${fm.small.length})`, fm.small.length === 0, fm.small.slice(0, 4).join(" · "));
  ok(`...nothing tapped under 44px (${fm.tiny.length})`, fm.tiny.length === 0, fm.tiny.slice(0, 4).join(" · "));
  ok("no scoping refusals in his session", s.refusals.length === 0, s.refusals[0]);
  ok("no page errors in his session", s.errors.length === 0, s.errors.join(" | "));
  await s.ctx.close();

  // ── K3 (db/55), at the reads behind the screens ──
  // The flipped assertion, where a screen cannot hide it: his session's own
  // reads return no team-mate's injury row, and no team-mate's fitness.
  group("K3: no team-mate's injury, fitness or return date reaches him through the reads");
  {
    const { token } = await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pillay@example.invalid", deviceId: "pupil-walk" }) })).json();
    const read = async (r) => (await (await fetch(`${API}/api/read/${r}`, { headers: { authorization: `Bearer ${token}` } })).json()).rows ?? [];
    const injuries = await read("injuries");
    ok("injuries: his own row and nobody else's", injuries.length >= 1 && injuries.every((i) => i.player_id === PILLAY), JSON.stringify(injuries.map((i) => i.player_id)));
    const roster = await read("players");
    const mates = roster.filter((p) => p.id !== PILLAY);
    ok("players: his side by name", mates.some((p) => p.id === BEKKER) && mates.some((p) => p.id === WHITFIELD));
    ok("...and no team-mate's fitness, which is health (db/58)", mates.every((p) => p.fitness == null), JSON.stringify(mates.map((p) => p.fitness)));
    const avail = await read(`availability?matchId=${NEXT}`);
    ok("availability: his own answer and no team-mate's", avail.every((a) => a.player_id === PILLAY || a.status == null) && !avail.some((a) => a.reason_kind === "family"),
       JSON.stringify(avail.map((a) => [a.player_id.slice(-2), a.status, a.reason_kind])));
  }

  // ══ SCRBRD-138 phase A: the captain's view ══════════════════════════════
  // Dates here are the fixtures' own, explicit; the one "tomorrow" fixture is
  // relative to the clock only so that it is within a week of the Home card's
  // test (and in the current school season, bar the last day of the year).
  // Nothing is pinned to a birthday the seed computes.
  group("The captain's view (SCRBRD-138): set the stage");
  const WES = "22222222-2222-2222-2222-222222222222";
  const MKHIZE = "bbbbbbbb-0000-0000-0000-000000000001";   // Westville's, the other school's child
  const SEASON = (await q(`select id, label from season_for(sa_today(), 'school')`))[0];
  // Two more on the sheet: of age (eighteen), because a minor needs a verified guardian link and consent before he may be selected.
  const SIX = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
                        values ($1, '1XI', 'V Mate Six', 66, 'batter', current_date - interval '19 years') returning id`, [HIL]))[0].id;
  const SEVEN = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
                          values ($1, '1XI', 'V Mate Seven', 67, 'bowler', current_date - interval '19 years') returning id`, [HIL]))[0].id;
  await q(`update player set bowling_style = 'F' where id = $1`, [NAIDOO]);
  const nm = Object.fromEntries((await q(`select id, full_name from player where id = any($1::uuid[])`,
    [[PILLAY, WHITFIELD, BEKKER, NAIDOO, SEVEN, SIX]])).map((r) => [r.id, r.full_name]));
  const ids = { pillay: PILLAY, whitfield: WHITFIELD, bekker: BEKKER, naidoo: NAIDOO, seven: SEVEN, six: SIX };
  const names = { pillay: nm[PILLAY], whitfield: nm[WHITFIELD], bekker: nm[BEKKER], naidoo: nm[NAIDOO], seven: nm[SEVEN], six: nm[SIX] };
  const { field: FIELD, bat: BAT } = await buildCaptainFixtures(q, { school: HIL, ids, names, westville: WES });
  // Tomorrow: with the day's terms, a report, a sheet, and a team-mate's answer and injury he must not learn.
  const DAY = (await q(
    `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, '1XI', $2, '1XI', 'Westville Boys'' High 1XI', now() + interval '1 day', 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL, WES]))[0].id;
  await fixConditions(q, DAY);
  await q(`insert into match_squad (match_id, player_id, side, batting_no) values
             ($1, $2, 'home', 1), ($1, $3, 'home', 2), ($1, $4, 'home', 3), ($1, $5, 'home', 4), ($1, $6, 'home', 5), ($1, $7, 'home', 6)`,
    [DAY, WHITFIELD, BEKKER, NAIDOO, PILLAY, SEVEN, SIX]);
  await q(`insert into match_pitch_report (match_id, school_id, surface, grass, bounce, pace, favours) values ($1, $2, 'firm', 'covered', 'even', 'quick', 'seam')`, [DAY, HIL]);
  await q(`insert into match_availability (match_id, player_id, school_id, status, reason_kind, note, declared_by)
           values ($1, $2, $3, 'unavailable', 'illness', 'Shoulder impingement, physio says rest', $4)`, [DAY, BEKKER, HIL, coachId]);
  // Batter against bowler: R Pillay faced a team-mate (fast) six times and Westville's D Mkhize three times.
  const MU = (await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status) values ($1, '1XI', 'Verify Nets XI', '2026-09-20 09:00+02', 'T20', 20, 'complete') returning id`, [HIL]))[0].id;
  const scorerId = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  let seq = 0;
  for (const [bowl, v] of [[NAIDOO, 1], [NAIDOO, 0], [NAIDOO, 4], [NAIDOO, 0], [NAIDOO, 1], [NAIDOO, 2], [MKHIZE, 1], [MKHIZE, 1], [MKHIZE, 0]]) {
    seq += 1;
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id, payload)
             values ($1, $2, $3, 1, 0, $4, 'device-cap', $5, $3, now(), 'ball', 'run', $6, $7, $8, '{}'::jsonb)`, [MU, HIL, seq, scorerId, `cap-mu-${seq}`, v, PILLAY, bowl]);
  }
  // A team-mate with an account of his own and no honour but last season's colours.
  const MATE_EMAIL = "mate.pupil@example.invalid";
  const MATE_USER = "cafe0000-0000-0000-0000-0000000000a1";
  await q(`insert into app_user (id, school_id, email, name, role, player_id, teams) values ($1, $2, $3, 'James Whitfield', 'player', $4, '{1XI}')`, [MATE_USER, HIL, MATE_EMAIL, WHITFIELD]);
  await q(`insert into role_assignment (id, person_id, role, school_id, team_code) values
             ('a5510000-0000-0000-0000-0000000000a1', $1, 'player', $2, '1XI'), ('a5510000-0000-0000-0000-0000000000a2', $1, 'selfaccess', $2, NULL)`, [MATE_USER, HIL]);
  await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at, consent_state, consent_version, consent_at, created_by)
           values ('a5510000-0000-0000-0000-0000000000a2', $1, 'self', 'verified', '88888888-0000-0000-0000-00000000000c', now(), 'granted', 'popia-2026-01', now(), '88888888-0000-0000-0000-00000000000c')`, [WHITFIELD]);

  // What the tab may never say (§4): the walk's own list, kept apart from the screen's.
  const NEVER = /injur|fitness|\bfit\b|physio|rehab|restrict|return date|guideline|workload|wellness|available|unavailable|doubtful|\breason|because|\bwhy\b|threat|probab|win chance|shoulder|impingement|hamstring|funeral|10 Oct|2026-10-10/i;
  async function signInAs(page, email) {
    await click(page, /Get Started|Log In/, 5000);
    await page.waitForTimeout(500);
    await page.locator("#login-email").fill(email);
    await click(page, /^Sign In$/, 5000);
    await page.waitForTimeout(2200);
    return (await tid(page, "persona-bar").count()) === 1;
  }
  /**
   * Where the captain's view shows, read off a fresh sitting: the card on Home,
   * the section on `day`'s fixture screen, the tab on `live`'s match.
   */
  async function surfaces(email, { day = DAY, live = FIELD } = {}) {
    const x = await open();
    const out = { signedIn: await signInAs(x.page, email) };
    await x.page.waitForTimeout(800);
    out.card = await tid(x.page, "captain-card").count() === 1;
    out.cardText = out.card ? await inner(x.page, "captain-card") : "";
    await go(x.page, "mymatches");
    await tid(x.page, `fixture-row-${day}`).click({ timeout: 4000 }).catch(() => {});
    await x.page.waitForTimeout(1500);
    out.section = await tid(x.page, "captain-section").count() === 1;
    await tid(x.page, "family-back").click({ timeout: 4000 }).catch(() => {});
    await x.page.waitForTimeout(500);
    await tid(x.page, `live-row-${live}`).click({ timeout: 4000 }).catch(() => {});
    await x.page.waitForTimeout(2000);
    out.tab = await tid(x.page, "mc-tab-captain").count() === 1;
    out.tabs = await x.page.$$eval('[data-testid^="mc-tab-"]', (els) => els.map((e) => e.getAttribute("data-testid").replace("mc-tab-", "")));
    out.errors = x.errors.length; out.refusals = x.refusals.length;
    await x.ctx.close();
    return out;
  }

  group("Without the honour: no card, no section, no tab — and nothing suggests one is missing");
  {
    const none = await surfaces("pillay@example.invalid");
    ok("R Pillay with no captaincy: no Home card, no section, no tab", none.signedIn && !none.card && !none.section && !none.tab, JSON.stringify(none));
    ok("...and his tabs are the six, as built", none.tabs.join() === "summary,scorecard,commentary,partnerships,analytics,details", none.tabs.join());
  }

  const honourId = (await q(`insert into honour (player_id, kind, season_id, citation) values ($1, 'captain', $2, 'the walk') returning id`, [PILLAY, SEASON.id]))[0].id;
  const stamped = (await q(`select school_id, team_code, withdrawn_at from honour where id = $1`, [honourId]))[0];
  ok("the honour is his side's, stamped at the award: Hilton, the 1XI, live", stamped.school_id === HIL && stamped.team_code === "1XI" && stamped.withdrawn_at === null, JSON.stringify(stamped));

  group("Captain: the card on Home, the section on the fixture, the tab in the match");
  const c = await open();
  ok("R Pillay signs in", await signInAs(c.page, "pillay@example.invalid"));
  await c.page.waitForTimeout(1200);
  ok("his next fixture is still first, ahead of the card",
     await c.page.$$eval('[data-testid="next-fixture"], [data-testid="captain-card"]', (els) => els.map((e) => e.getAttribute("data-testid")).join()) === "next-fixture,captain-card");
  const card = await inner(c.page, "captain-card");
  const dbg = (t, v) => { if (process.env.CAPTAIN_DEBUG) console.log(`\n--- ${t}\n${v}`); };
  dbg("CARD", card);
  ok("the Home card says Captain, his side, and the match live now", /^CAPTAIN/i.test(card) && /1XI/i.test(card) && /live now/.test(card) && /v Westville/.test(card), card);
  ok("...a count of the side and no name on it", /\d+ named in the side/.test(card) && !/Whitfield|Bekker|Naidoo|Seven|Mate Six/.test(card), card);
  ok("...no plan line: the coach's plan is phase B", !/plan/i.test(card));
  const f1 = await floors(c.page);
  ok(`Home with the card: nothing read under 12px (${f1.small.length}), nothing tapped under 44px (${f1.tiny.length})`, f1.small.length === 0 && f1.tiny.length === 0, [...f1.small, ...f1.tiny].slice(0, 4).join(" · "));

  // C2 — the fixture's Captain section.
  ok("Matches opens", await go(c.page, "mymatches"));
  await tid(c.page, `fixture-row-${DAY}`).click({ timeout: 4000 }).catch(() => {});
  await c.page.waitForTimeout(2200);
  const sec = await inner(c.page, "captain-section");
  dbg("SECTION", sec);
  const dayLine = await inner(c.page, "captain-day-line");
  ok("the fixture carries a Captain section", await tid(c.page, "captain-section").count() === 1 && /^CAPTAIN/i.test(sec), sec.slice(0, 80));
  ok("...the day: the format and overs, the document's own words (cap, free hit)",
     /T20/.test(dayLine) && /20 overs/.test(dayLine) && /4 overs a bowler/.test(dayLine) && /Free hit after a no-ball/.test(dayLine), dayLine);
  ok("...the band's one line for the side, for every bowler", (await inner(c.page, "captain-band-rule")).trim() === "Open rule: 6-over spells, 12 a day, for every bowler", await inner(c.page, "captain-band-rule"));
  ok("...the groundsman's report, written for him", /firm, good grass cover, even bounce, quick pace, favours seam/.test(await inner(c.page, "captain-pitch")), await inner(c.page, "captain-pitch"));
  const side = await inner(c.page, "captain-side");
  ok("...the side, by name and place, once on the screen", /6 named/i.test(side) && [WHITFIELD, BEKKER, NAIDOO, PILLAY, SEVEN, SIX].every((id) => side.includes(nm[id])) && await tid(c.page, "side-sheet").count() === 1, side);
  ok("...this season's figures for a boy on the sheet, in the figure line", /inns · \d+ runs · avg \d/.test(await inner(c.page, `captain-season-${PILLAY}`)), await inner(c.page, `captain-season-${PILLAY}`));
  ok("...nothing of the plan, and no place held for it", !/plan/i.test(sec));
  const secAll = await inner(c.page, "os-main");
  ok("...and no team-mate's injury, answer or reason anywhere on the screen (D7, K3)",
     !HEALTH.test(secAll) && !/physio says rest|illness/i.test(secAll) && await tid(c.page, `availability-state-${BEKKER}`).count() === 0, secAll.match(HEALTH)?.[0]);
  ok("the section itself says no injury, fitness word, guideline, availability or reason", !NEVER.test(sec), sec.match(NEVER)?.[0]);
  const f2 = await floors(c.page);
  ok(`the fixture with the section: nothing under 12px (${f2.small.length}), nothing tapped under 44px (${f2.tiny.length})`, f2.small.length === 0 && f2.tiny.length === 0, [...f2.small, ...f2.tiny].slice(0, 4).join(" · "));

  // C4 — fielding.
  await tid(c.page, "family-back").click({ timeout: 4000 }).catch(() => {});
  await c.page.waitForTimeout(500);
  await tid(c.page, `live-row-${FIELD}`).click({ timeout: 4000 }).catch(() => {});
  await c.page.waitForTimeout(2200);
  const tabs = await c.page.$$eval('[data-testid^="mc-tab-"]', (els) => els.map((e) => e.getAttribute("data-testid").replace("mc-tab-", "")));
  ok("the Match Centre has a Captain tab after the Summary", tabs.join() === "summary,captain,scorecard,commentary,partnerships,analytics,details", tabs.join());
  await tid(c.page, "mc-tab-captain").click({ timeout: 4000 }).catch(() => {});
  await c.page.waitForTimeout(1500);
  const field = await c.page.$eval('[data-testid="mc-panel-captain"]', (e) => e.innerText).catch(() => "");
  dbg("FIELDING", field);
  ok("the tab is labelled for what he is", /^CAPTAIN/i.test(await inner(c.page, "mc-captain-label")), await inner(c.page, "mc-captain-label"));
  ok("the Board is on it", await tid(c.page, "mc-captain-board").count() === 1);
  ok("OUR BOWLERS · overs left", /Our bowlers/i.test(field));
  // The cap's own words, against the scoring package's — the pad's sentence for the same balls.
  // Six legal balls an over; the fixture records who bowled each (ATTACK), so the balls are counted from it, not read back off the screen.
  const bowled = Object.fromEntries(Object.entries(ids).map(([k, id]) => [id, ATTACK.filter((w) => w === k).length * 6]));
  for (const [who, id] of [["Naidoo", NAIDOO], ["Whitfield", WHITFIELD], ["Bekker", BEKKER], ["Seven", SEVEN]]) {
    const want = capWords(bowled[id], PLAY, { unconfirmed: false });
    const got = (await tid(c.page, `mc-captain-cap-${id}`).first().innerText({ timeout: 1500 }).catch(() => null))?.trim() ?? null;
    ok(`${who} (${bowled[id]} balls): the screen says ${want === null ? "nothing" : `"${want}"`}, as capWords() does for the pad`, got === want, `${got} v ${want}`);
  }
  ok("...the three sentences are the three, verbatim",
     capWords(24, PLAY) === "Has bowled his 4 overs" && capWords(18, PLAY) === "Has 1 over left (4 an innings)" && capWords(30, PLAY) === "5 overs; the conditions allow 4");
  ok("not yet bowled: the boy who has not, by name", new RegExp(`Not yet bowled:.*${nm[PILLAY]}`).test(field), field.slice(0, 300));
  ok("where they have scored: the side's wheel, with no batter named in its place", await tid(c.page, "mc-captain-wheel").count() === 1);
  ok("nothing on the tab is an injury, a fitness word, a guideline, an availability, a reason, a win chance or a threat level", !NEVER.test(field), field.match(NEVER)?.[0]);
  ok("no per-boy limit, spell count or source of one", !/spell|directive|limit|guideline/i.test(field), field.match(/spell|directive|limit/i)?.[0]);
  ok("no row of the tab opens: nothing on it is a button or a link",
     await c.page.$$eval('[data-testid="mc-panel-captain"] button, [data-testid="mc-panel-captain"] a, [data-testid="mc-panel-captain"] [role="button"]', (e) => e.length) === 0);
  ok("no other school's child by name beyond the log's own opposition names", !/Mkhize|Botha/.test(field));
  const f3 = await floors(c.page);
  ok(`the tab fielding: nothing under 12px (${f3.small.length}), nothing tapped under 44px (${f3.tiny.length})`, f3.small.length === 0 && f3.tiny.length === 0, [...f3.small, ...f3.tiny].slice(0, 4).join(" · "));

  // C3 — batting.
  await tid(c.page, "mc-back").click({ timeout: 4000 }).catch(() => {});
  await c.page.waitForTimeout(500);
  await tid(c.page, `live-row-${BAT}`).click({ timeout: 4000 }).catch(() => {});
  await c.page.waitForTimeout(2200);
  await tid(c.page, "mc-tab-captain").click({ timeout: 4000 }).catch(() => {});
  await c.page.waitForTimeout(1500);
  const batTab = await c.page.$eval('[data-testid="mc-panel-captain"]', (e) => e.innerText).catch(() => "");
  dbg("BATTING", batTab);
  const nextInText = await inner(c.page, "mc-captain-next-in");
  ok("next in is the sheet minus the batted: the fourth to the sixth", nextInText.includes(nm[PILLAY]) && nextInText.includes(nm[SEVEN]) && nextInText.includes(nm[SIX])
     && !nextInText.includes(nm[WHITFIELD]) && !nextInText.includes(nm[BEKKER]) && !nextInText.includes(nm[NAIDOO]), nextInText);
  ok("...in the sheet's order", nextInText.indexOf(nm[PILLAY]) < nextInText.indexOf(nm[SEVEN]) && nextInText.indexOf(nm[SEVEN]) < nextInText.indexOf(nm[SIX]), nextInText);
  ok("our batters today: the two in and the one out", /Our batters today/i.test(batTab) && batTab.includes(nm[WHITFIELD]) && batTab.includes(nm[NAIDOO]), batTab.slice(0, 300));
  ok("fielding sections are not drawn while his side bats (no bowlers of his own)", !/Our bowlers/i.test(batTab));
  ok("the tab batting says no injury, fitness word, guideline, availability or reason", !NEVER.test(batTab), batTab.match(NEVER)?.[0]);
  const f4 = await floors(c.page);
  ok(`the tab batting: nothing under 12px (${f4.small.length}), nothing tapped under 44px (${f4.tiny.length})`, f4.small.length === 0 && f4.tiny.length === 0, [...f4.small, ...f4.tiny].slice(0, 4).join(" · "));

  // C5 — after: his batters in words, and against bowling types.
  await tid(c.page, "mc-back").click({ timeout: 4000 }).catch(() => {});
  await c.page.waitForTimeout(500);
  await tid(c.page, `played-row-${PLAYED}`).click({ timeout: 4000 }).catch(() => {});
  await c.page.waitForTimeout(2200);
  await tid(c.page, "mc-tab-captain").click({ timeout: 4000 }).catch(() => {});
  await c.page.waitForTimeout(2000);
  const after = await c.page.$eval('[data-testid="mc-panel-captain"]', (e) => e.innerText).catch(() => "");
  dbg("AFTER", after);
  ok("after the match: his batters' innings in words", /Our innings, in words/i.test(after) && after.includes(nm[PILLAY]), after.slice(0, 300));
  ok("...a blank in the paper scorebook is said as a blank, never drawn as a number", /balls not recorded/.test(after) && !/off null|\(\)/.test(after), after.match(/.*(null|\(\)).*/)?.[0]);
  const mu = await inner(c.page, "mc-captain-matchups");
  ok("his batter against pace: 8 off 6 balls, not out — from the team-mate who bowled at him", /v pace: 8 off 6 balls, not out/.test(mu) && mu.includes(nm[PILLAY]), mu);
  ok("...and no row for Westville's bowler: nothing names him, and no type is drawn for him", !after.includes("Mkhize") && !/spin/.test(mu), mu);
  ok("...and no bowler is named in a matchup", !mu.includes(nm[NAIDOO]));
  ok("no overs-left words on a finished match", !/over left|bowled his|conditions allow/.test(after));
  ok("after: nothing is an injury, a fitness word, a guideline, an availability or a reason", !NEVER.test(after), after.match(NEVER)?.[0]);
  const f5 = await floors(c.page);
  ok(`the tab after: nothing under 12px (${f5.small.length}), nothing tapped under 44px (${f5.tiny.length})`, f5.small.length === 0 && f5.tiny.length === 0, [...f5.small, ...f5.tiny].slice(0, 4).join(" · "));
  ok("no scoping refusals and no page errors in the captain's sitting", c.refusals.length === 0 && c.errors.length === 0, c.refusals[0] ?? c.errors.join(" | "));
  await c.ctx.close();

  group("A team-mate without the honour has none of it");
  {
    const mate = await surfaces(MATE_EMAIL);
    ok("a team-mate with only last season's colours: no card, no section, no tab", mate.signedIn && !mate.card && !mate.section && !mate.tab, JSON.stringify(mate));
    ok("...he has the six tabs, as built", mate.tabs.join() === "summary,scorecard,commentary,partnerships,analytics,details", mate.tabs.join());
  }

  group("The reads behind it: no other school's child reaches him");
  {
    const { token } = await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pillay@example.invalid", deviceId: "pupil-captain-walk" }) })).json();
    const read = async (r) => (await (await fetch(`${API}/api/read/${r}`, { headers: { authorization: `Bearer ${token}` } })).json()).rows ?? [];
    const rows = await read(`matchups?batterId=${PILLAY}`);
    ok("matchups for his batter: the team-mate's row", rows.some((r) => r.bowler_id === NAIDOO && r.balls === 6), JSON.stringify(rows.map((r) => [r.bowler_id?.slice(-2), r.balls])));
    ok("...and no row naming Westville's bowler, though the log holds three balls to him",
       !rows.some((r) => r.bowler_id === MKHIZE) && (await q(`select count(*)::int as n from ball_event where striker_id = $1 and bowler_id = $2`, [PILLAY, MKHIZE]))[0].n === 3);
    const players = await read("players");
    ok("players: nobody of Westville's", players.every((p) => p.school_id === HIL), JSON.stringify(players.filter((p) => p.school_id !== HIL).map((p) => p.id)));
    const honours = await read("honours");
    ok("honours: his own live captaincy is on the read, as a row of the side", honours.some((h) => h.player_id === PILLAY && h.kind === "captain" && h.team_code === "1XI" && h.school_id === HIL));
  }

  group("Withdrawn: gone on the next load");
  await q(`update honour set withdrawn_at = now(), withdrawn_reason = 'the walk: withdrawn' where id = $1`, [honourId]);
  {
    const gone = await surfaces("pillay@example.invalid");
    ok("after the withdrawal: no card, no section, no tab", gone.signedIn && !gone.card && !gone.section && !gone.tab, JSON.stringify(gone));
    const { token } = await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pillay@example.invalid", deviceId: "pupil-captain-walk2" }) })).json();
    const hs = (await (await fetch(`${API}/api/read/honours`, { headers: { authorization: `Bearer ${token}` } })).json()).rows ?? [];
    ok("...the read no longer returns it", !hs.some((h) => h.player_id === PILLAY && h.kind === "captain"));
  }

  group("A vice-captain has the same view, under his own label");
  const viceId = (await q(`insert into honour (player_id, kind, season_id) values ($1, 'vice_captain', $2) returning id`, [PILLAY, SEASON.id]))[0].id;
  {
    const v = await surfaces("pillay@example.invalid");
    ok("the card, the section and the tab", v.signedIn && v.card && v.section && v.tab, JSON.stringify(v));
    ok("...the card says Vice-captain, not Captain", /^VICE-CAPTAIN/i.test(v.cardText), v.cardText);
  }
  await q(`update honour set withdrawn_at = now(), withdrawn_reason = 'the walk: withdrawn' where id = $1`, [viceId]);

  group("Last season's captaincy, and another side's, switch nothing on");
  const lastSeason = (await q(`select id from season where level = 'school' and label = ($1::int - 1)::text`, [SEASON.label]))[0].id;
  const oldId = (await q(`insert into honour (player_id, kind, season_id) values ($1, 'captain', $2) returning id`, [PILLAY, lastSeason]))[0].id;
  {
    const old = await surfaces("pillay@example.invalid");
    ok("a captaincy of last season: no card, no section, no tab", old.signedIn && !old.card && !old.section && !old.tab, JSON.stringify(old));
  }
  await q(`update honour set withdrawn_at = now(), withdrawn_reason = 'the walk: withdrawn' where id = $1`, [oldId]);
  // A captaincy of the 2XI, awarded while he was on it, and then he moved up to the 1XI: "an honour does not
  // move sides when he does" (db/08), so on the 1XI's fixtures it is not the side's captaincy.
  await q(`update player set team_code = '2XI' where id = $1`, [PILLAY]);
  const kept = (await q(`insert into honour (player_id, kind, season_id) values ($1, 'captain', $2) returning id, team_code`, [PILLAY, SEASON.id]))[0];
  await q(`update player set team_code = '1XI' where id = $1`, [PILLAY]);
  try {
    ok("the honour is stamped with the side he was on when it was awarded: the 2XI", kept.team_code === "2XI", kept.team_code);
    const moved = await surfaces("pillay@example.invalid");
    ok("a live captaincy of this season at his school, for a side that is not his: no card, no section, no tab",
       moved.signedIn && !moved.card && !moved.section && !moved.tab, JSON.stringify(moved));
    ok("...and the 1XI's fixtures were there to be seen (the gate, not an empty list, is what refused)", moved.signedIn && moved.tabs.length === 6, moved.tabs.join());
  } finally {
    await q(`update honour set withdrawn_at = now(), withdrawn_reason = 'the walk: withdrawn' where id = $1`, [kept.id]);
  }

  group("Reduced motion: the captain's tab does not animate");
  const keptAgain = (await q(`insert into honour (player_id, kind, season_id) values ($1, 'captain', $2) returning id`, [PILLAY, SEASON.id]))[0].id;
  {
    const rm = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    await offline(rm);
    const page = await rm.newPage();
    await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
    await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
    await signInAs(page, "pillay@example.invalid");
    await go(page, "mymatches");
    await tid(page, `live-row-${BAT}`).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await tid(page, "mc-tab-captain").click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1500);
    ok("the device asks for reduced motion", await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));
    const anims = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="mc-panel-captain"]');
      return p ? p.getAnimations({ subtree: true }).filter((a) => a.playState === "running" && (a.effect?.getComputedTiming?.().iterations ?? 1) !== 1).length : -1;
    });
    ok("...and nothing in the tab loops or pulses", anims === 0, anims);
    await rm.close();
  }
  await q(`update honour set withdrawn_at = now(), withdrawn_reason = 'the walk: withdrawn' where id = $1`, [keptAgain]);
  ok("the walk leaves no live captaincy of his behind", (await q(`select count(*)::int as n from honour where player_id = $1 and withdrawn_at is null`, [PILLAY]))[0].n === 0);
} catch (e) {
  ok(`the pupil walk threw: ${e.message?.slice(0, 200)}`, false);
} finally {
  await browser.close().catch(() => {});
  await owner.end().catch(() => {});
  api.kill("SIGTERM");
  web.close();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER PUPIL SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

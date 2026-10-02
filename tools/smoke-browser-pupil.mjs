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
 *   - no scoping refusals, no page errors.
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

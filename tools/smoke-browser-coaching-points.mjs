#!/usr/bin/env node
/**
 * GA-I27 slice 2 (C4) — coaching points, from a browser, as the people who
 * may and may not read them (docs/design/GA-I27_coach_cards.md §1.3, §4.2,
 * §5.2, §5.3, §7; GA-I26a AH-D2, AH-D3, slice A4).
 *
 * The table, the write and the read are db/104's and are proved there and in
 * the API walk. This proves what the screens draw from them:
 *
 *   The coach (C Hendricks, 1XI), on a fixture tonight with R Pillay named:
 *     - S5 in the drawer (R Pillay v pace, 36 balls, from a match the walk
 *       scores) offers "Make a coaching point of this", 44px; it opens his
 *       development panel (Skills) on him, the field labelled "Coaching
 *       point" with the card's line and "as at" above it
 *     - the field refuses a never-word and another boy's name before it
 *       sends (nothing is written), and saves a plain sentence: one
 *       development_note with the S5 pointer, the card's lines and the fixture
 *     - a dot on his strip offers the same, pointing at that score
 *     - the panel lists both, "stood on" each; S13 in the drawer draws the
 *       fixture's point, and its link opens the panel on him
 *     - THE CORRECTION (§7): an approved amendment voids one of his balls;
 *       S5 moves, S13 and the panel keep "stood on: … 36 balls" and add
 *       "now: … 35 balls … corrected"; the stored lines did not change
 *     - withdrawn from the panel: struck, kept, and gone from the drawer
 *   The assistant coach and the director of sport read the points (and the
 *     assistant is offered no "Make a coaching point")
 *   The team manager: no S13, and no coaching_points read is made
 *   R Pillay himself, through his Skills door, and his parent: no point, no
 *     panel, no read made; the API gives each of them no row
 *   Floors: 12px, 44px at 390; none of the cockpit's never-words; no
 *     notification written (the drawer pushes nothing).
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-coaching-points.mjs
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
import { writeEvents } from "./fixture-matchcentre.mjs";
import { NEVER_ON_THE_COCKPIT } from "../apps/web/src/lib/cockpitNever.js";
import { afterReads, watchReads } from "./walk-wait.mjs";
import { pickTab } from "./walk-tabs.mjs";

const WEB_PORT = port(4402);
const API_PORT = port(9002);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };
const DEBUG = !!process.env.POINTS_DEBUG;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "11111111-1111-1111-1111-111111111111";
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";
const NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, 1XI, an account of his own

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-coaching-points-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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
const login = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-points" } })).body?.token;

// The fixture is tonight on the SA clock, still to be played (S5 speaks only
// before the first ball). After 22:00 SA time it is tomorrow at 01:00 and the
// browser's clock is set just past midnight, as the cockpit walk does.
const STARTED = Date.now();
const SA_LATE = new Date(STARTED + 2 * 3600e3).getUTCHours() >= 22;
const browserNow = () => {
  const d = new Date(STARTED + 2 * 3600e3);
  return Math.max(Date.now(), Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22, 5));
};

async function open({ viewport = DESK } = {}) {
  const ctx = await browser.newContext({ viewport, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  if (SA_LATE) await ctx.clock.install({ time: browserNow() });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  const errors = [], pointReads = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // Every coaching_points read the page makes, seen from outside it.
  page.on("request", (r) => { if (/\/api\/read\/coaching_points/.test(r.url())) pointReads.push(r.url()); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, pointReads };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const text = (page) => page.$eval("body", (el) => el.innerText);
const said = (page, sel = '[data-testid="os-main"]') => page.evaluate((s) => [...document.querySelectorAll(s)].map((m) =>
  [m.innerText, ...[...m.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label"))].join(" | ")).join(" | "), sel);
async function signIn(page, email) {
  await page.locator("button:not([disabled])", { hasText: /Get Started|Log In/ }).first().click({ timeout: 8000 }).catch(() => {});
  await page.locator("#login-email").fill(email);
  await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 8000 });
  try { await tid(page, "os-main").waitFor({ timeout: 12000 }); await afterReads(page, 1500); return true; } catch { return false; }
}
async function go(page, key) {
  // The drawer is a dialog over the menu: close it first.
  if (await tid(page, "signals").count()) { await page.keyboard.press("Escape"); await tid(page, "signals").waitFor({ state: "detached", timeout: 4000 }).catch(() => {}); }
  const l = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"]`).first();
  try { await l.waitFor({ timeout: 8000 }); await l.click({ timeout: 6000 }); } catch { return false; }
  await afterReads(page, 1200);
  return true;
}
async function openDrawerOn(page, id) {
  if (!(await go(page, "matches"))) return false;
  await tid(page, `mc-open-${id}`).first().waitFor({ timeout: 10000 }).catch(() => {});
  await tid(page, `mc-open-${id}`).first().click({ timeout: 6000 }).catch(() => {});
  await tid(page, "match-view").waitFor({ timeout: 10000 }).catch(() => {});
  await pickTab(page, "coach").catch(() => {});
  await page.waitForFunction(() => { const t = document.querySelector('[data-testid="mc-coach"]'); return t && !document.querySelector('[data-testid="mc-coach-loading"]'); }, null, { timeout: 15000 }).catch(() => {});
  await afterReads(page, 1200);
  await tid(page, "coach-signals-open").click({ timeout: 6000 }).catch(() => {});
  await tid(page, "signals").waitFor({ timeout: 8000 }).catch(() => {});
  return (await tid(page, "signals").count()) === 1;
}
const cardsOf = (page, rule) => page.$$eval(`[data-testid="signals"] article[data-rule="${rule}"]`, (els) => els.map((e) => e.innerText));
/** Click and wait for the response a write makes. */
async function clickAndWait(page, locator, urlRe, method = "POST") {
  const [res] = await Promise.all([
    page.waitForResponse((r) => urlRe.test(r.url()) && r.request().method() === method, { timeout: 12000 }),
    locator.click({ timeout: 8000 }),
  ]);
  return res;
}
/** §3.2 floors over what is on screen. */
const floors = (page, within) => page.evaluate((within) => {
  const small = [], tiny = [];
  for (const root of document.querySelectorAll(within)) {
    for (const n of [root, ...root.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName)) { const r = n.getBoundingClientRect(); if (r.height && r.height < 43.5) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${n.textContent.trim().slice(0, 30)}"`); }
    }
  }
  return { small, tiny };
}, within);
const points = async () => q(`select id, body, match_id, evidence_rule, evidence_read, evidence_params, evidence_text, author_id, withdrawn_at
                                  from development_note where player_id = $1 and evidence_read is not null order by created_at`, [PILLAY]);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ══ The stage ══════════════════════════════════════════════════════════
  group("Set the stage: a scored match with 36 of his balls against pace, a fixture tonight with him named, a score on his strip");
  const nm = Object.fromEntries((await q(`select id, full_name from player where id = any($1::uuid[])`, [[PILLAY, WHITFIELD, BEKKER, NAIDOO]])).map((r) => [r.id, r.full_name]));
  const ME = nm[PILLAY];
  await q(`update player set bowling_style = 'F' where id = any($1::uuid[])`, [[NAIDOO, BEKKER]]);
  // A practice match of the 1XI two days ago: he faces six overs from two of
  // his side's quicks, 0 2 0 4 0 1 each (the single keeps him on strike).
  const PRAC = (await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
                          values ($1, '1XI', 'Practice XI', now() - interval '2 days', 'cricket', 'T20', 6, 'live') returning id`, [HIL]))[0].id;
  const { inningsStart, batters, bowler, ball, voidEvent, BALL_TYPE } = await import("@scrbrd/scoring");
  const log = [];
  const add = (ev) => log.push({ ...ev, innings: 0, id: `points-${log.length + 1}`, clientTs: Date.now() - 2 * 86400e3 + log.length * 20000 });
  add(inningsStart({ battingTeam: "1XI", bowlingTeam: "Practice XI", squad: [{ id: PILLAY, name: ME }, { id: WHITFIELD, name: nm[WHITFIELD] }],
    bowlingSquad: [{ id: NAIDOO, name: nm[NAIDOO] }, { id: BEKKER, name: nm[BEKKER] }], overs: 6, captureProfile: "full" }));
  add(batters({ striker: PILLAY, nonStriker: WHITFIELD }));
  for (let o = 0; o < 6; o++) {
    const b = o % 2 ? BEKKER : NAIDOO;
    add(bowler({ bowler: b }));
    for (const v of [0, 2, 0, 4, 0, 1]) add({ ...ball({ type: BALL_TYPE.RUN, value: v }), striker: PILLAY, nonStriker: WHITFIELD, bowler: b });
  }
  await writeEvents(q, PRAC, log);
  await q(`update match set status = 'complete' where id = $1`, [PRAC]);
  // The fixture: tonight at 23:30 SA time (or tomorrow 01:00 on a late run), him named.
  const DAY = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, '1XI', 'Verify Points XI',
             case when $2 then (sa_today()::timestamp + interval '1 day' + time '01:00') else (sa_today()::timestamp + time '23:30') end at time zone 'Africa/Johannesburg',
             'cricket', 'T20', 20, 'scheduled') returning id`, [HIL, SA_LATE]))[0].id;
  await q(`insert into match_squad (match_id, player_id, side, batting_no) select $1, p, 'home', n from unnest($2::uuid[]) with ordinality as t(p, n)`, [DAY, [PILLAY, WHITFIELD, BEKKER, NAIDOO]]);
  const coach = await login("coach@example.invalid");
  const COACH = (await q(`select name from app_user where email = 'coach@example.invalid'`))[0].name;
  const asses = await call(`/api/players/${PILLAY}/assessment`, { method: "POST", token: coach, body: { assessedOn: new Date(Date.now() - 20 * 86400e3).toISOString().slice(0, 10), scores: { technical: { againstPace: 11 } } } });
  // The assistant coach and the team manager of the 1XI: nobody the seed has.
  for (const [email, name, role] of [["assist.points@example.invalid", "A Assistant", "assistantcoach"], ["manager.points@example.invalid", "T Manager", "teammanager"]]) {
    await q(`insert into app_user (school_id, email, name, role, teams) values ($1, $2, $3, $4, '{1XI}')`, [HIL, email, name, role]);
    await q(`insert into role_assignment (person_id, role, school_id, team_code) select id, $2, school_id, '1XI' from app_user where email = $1`, [email, role]);
  }
  const mu = (await call(`/api/read/matchups?batterId=${PILLAY}`, { token: coach })).body?.rows ?? [];
  ok("the stage is set: his matchups read gives 36 balls and 42 runs against the two quicks", asses.status === 200
     && mu.reduce((a, r) => a + r.balls, 0) === 36 && mu.reduce((a, r) => a + r.runs, 0) === 42, JSON.stringify(mu.map((r) => [r.balls, r.runs, r.bowling_style])));
  const notices0 = (await q(`select count(*)::int n from notification`))[0].n;
  const STOOD = `${ME} v pace · 36 balls · 42 runs · not out`;

  // ══ The coach makes a point from S5 ════════════════════════════════════
  group("The coach: S5 in the drawer opens his development panel with the pointer filled in");
  const c = await open({ viewport: PHONE });
  ok("the coach signs in", await signIn(c.page, "coach@example.invalid"));
  ok("...and opens tonight's fixture's drawer", await openDrawerOn(c.page, DAY));
  const s5 = await cardsOf(c.page, "S5");
  ok("S5 says what the matchups read says", s5.some((t) => t.includes(STOOD)), s5.join(" / "));
  const make = c.page.locator('[data-testid="signals"] article[data-rule="S5"]', { hasText: STOOD }).locator('[data-testid="signal-point-S5"]');
  ok("...and offers \"Make a coaching point of this\", a 44px target", await make.count() === 1 && ((await make.boundingBox())?.height ?? 0) >= 44);
  ok("no other card offers one (C-D7)", await c.page.locator('[data-testid^="signal-point-"]:not([data-testid="signal-point-S5"])').count() === 0);
  await make.click({ timeout: 6000 });
  await tid(c.page, "point-form").waitFor({ timeout: 12000 }).catch(() => {});
  ok("it opens Skills, on him, with the field", await tid(c.page, "os-main").getAttribute("data-page") === "skills" && await tid(c.page, "point-form").count() === 1
     && (await c.page.locator('[role="dialog"], [data-testid="point-form"]').first().innerText()).includes(ME));
  const pointerTxt = await tid(c.page, "point-pointer").innerText();
  ok("...the pointer above it is the card's line and 'as at'", new RegExp(`^${STOOD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · as at \\d{2}:\\d{2}`).test(pointerTxt), pointerTxt);
  ok("...the field is labelled Coaching point, and says who does not read it", /Coaching point — coaching staff only; he and his parents do not read it/.test(await c.page.locator('label[for="point-body"]').innerText()));
  const n0 = (await points()).length;
  await tid(c.page, "point-body").fill(`Bat him above ${nm[NAIDOO]}`);
  await tid(c.page, "point-save").click();
  ok("another boy's name is refused before it sends", /names another boy/.test(await tid(c.page, "point-said").innerText().catch(() => "")) && (await points()).length === n0);
  await tid(c.page, "point-body").fill("A hamstring niggle late on");
  await tid(c.page, "point-save").click();
  ok("...and a never-word", /not allowed here/.test(await tid(c.page, "point-said").innerText().catch(() => "")) && (await points()).length === n0);
  const f1 = await floors(c.page, '[data-testid="point-form"]');
  ok(`the field at 390: nothing under 12px (${f1.small.length}), nothing tapped under 44px (${f1.tiny.length})`, !f1.small.length && !f1.tiny.length, [...f1.small, ...f1.tiny].join(" · "));
  const BODY = "Plays across the line to the quicks; work on a straight front foot";
  await tid(c.page, "point-body").fill(BODY);
  const w1 = await clickAndWait(c.page, tid(c.page, "point-save"), /\/api\/players\/[^/]+\/coaching-points$/);
  ok("a plain sentence saves", w1.status() === 200, String(w1.status()));
  const [row] = (await points()).filter((r) => r.body === BODY);
  ok("...one development_note: the S5 pointer, the card's lines, the fixture, the coach as author",
     !!row && row.evidence_rule === "S5" && row.evidence_read === "matchups" && row.match_id === DAY && row.evidence_params?.playerId === PILLAY
     && row.evidence_params?.type === "pace" && row.evidence_text?.[0] === STOOD
     && row.author_id === (await q(`select id from app_user where email = 'coach@example.invalid'`))[0].id, JSON.stringify(row));
  await tid(c.page, `point-${row?.id}`).waitFor({ timeout: 10000 }).catch(() => {});
  const p1 = await tid(c.page, `point-${row?.id}`).innerText().catch(() => "");
  ok("the panel lists it: the sentence and what it stood on, no 'now'", p1.includes(BODY) && p1.includes(`stood on: ${STOOD} · as at`) && !/now:/.test(p1), p1);

  group("The coach: a dot on his strip offers the same, pointing at that score");
  await c.page.locator('[data-testid="history-technical-againstPace"] button[data-testid^="history-dot-"]').last().click({ timeout: 8000 });
  await tid(c.page, "dot-sheet").waitFor({ timeout: 8000 });
  ok("the dot's sheet offers \"Make a coaching point of this\"", await tid(c.page, "make-point-dot").count() === 1);
  await tid(c.page, "make-point-dot").click();
  await tid(c.page, "point-form").waitFor({ timeout: 8000 });
  ok("...its pointer is the score and its day", /^against pace 11 · \d{1,2} [A-Z][a-z]{2}$/.test(await tid(c.page, "point-pointer").innerText()), await tid(c.page, "point-pointer").innerText());
  const BODY2 = "Gets squared up early to the short ball";
  await tid(c.page, "point-body").fill(BODY2);
  const w2 = await clickAndWait(c.page, tid(c.page, "point-save"), /\/api\/players\/[^/]+\/coaching-points$/);
  const [row2] = (await points()).filter((r) => r.body === BODY2);
  const skillId = (await q(`select id from player_skill where player_id = $1 and metric = 'againstPace' and withdrawn_at is null order by assessed_on desc limit 1`, [PILLAY]))[0]?.id;
  ok("...saved on that score: evidence 'skills', the row's id, no fixture", w2.status() === 200 && row2?.evidence_read === "skills" && row2?.evidence_params?.skillId === skillId && row2?.match_id === null, JSON.stringify(row2));
  await tid(c.page, `point-${row2?.id}`).waitFor({ timeout: 10000 }).catch(() => {});
  ok("...and the panel says it stood on against pace 11", /stood on: against pace 11 · /.test(await tid(c.page, `point-${row2?.id}`).innerText().catch(() => "")));
  const panel = await said(c.page, '[data-testid="coaching-points"]');
  ok("none of the cockpit's never-words on the panel", !NEVER_ON_THE_COCKPIT.test(panel), panel.match(NEVER_ON_THE_COCKPIT)?.[0]);
  const f2 = await floors(c.page, '[data-testid="coaching-points"]');
  ok(`the panel at 390: nothing under 12px (${f2.small.length}), nothing tapped under 44px (${f2.tiny.length})`, !f2.small.length && !f2.tiny.length, [...f2.small, ...f2.tiny].join(" · "));

  group("The coach: S13 in the drawer draws the fixture's point, and opens the panel on him");
  ok("back to tonight's drawer", await openDrawerOn(c.page, DAY));
  const s13 = await cardsOf(c.page, "S13");
  ok("one S13: his name and the sentence, what it stood on (the dot's point is about no fixture)", s13.length === 1 && s13[0].includes(`${ME}: ${BODY}`) && s13[0].includes(`stood on: ${STOOD}`) && !/now:/.test(s13[0]), s13.join(" / "));
  ok("...gated by the note's capability, from coaching_points", /From coaching_points\. You see it through coach with player\.note\.read\./.test(s13[0] ?? ""));
  ok("...and no Make a coaching point on it", await c.page.locator('[data-testid="signals"] article[data-rule="S13"] [data-testid^="signal-point-"]').count() === 0);
  await c.page.locator('[data-testid="signals"] article[data-rule="S13"] [data-testid="signal-trail-S13"]').click({ timeout: 6000 });
  await c.page.locator('[data-testid="signals"] article[data-rule="S13"] [data-testid="evidence-trail-link"]').waitFor({ timeout: 8000 }).catch(() => {});
  await c.page.locator('[data-testid="signals"] article[data-rule="S13"] [data-testid="evidence-trail-link"]').click({ timeout: 6000 }).catch(() => {});
  await tid(c.page, `point-${row?.id}`).waitFor({ timeout: 12000 }).catch(() => {});
  ok("its link opens Skills on him, the point there", await tid(c.page, "os-main").getAttribute("data-page") === "skills" && await tid(c.page, `point-${row?.id}`).count() === 1);
  ok("no page errors for the coach", c.errors.length === 0, c.errors.join(" | "));
  await c.ctx.close();

  // ══ The correction ═════════════════════════════════════════════════════
  group("A correction (GA-I27 §7): a ball of his voided; stood on stays, now says corrected");
  const four = log.find((e) => e.kind === "ball" && e.value === 4);
  const lastSeq = (await q(`select max(seq)::int s from ball_event where match_id = $1`, [PRAC]))[0].s;
  await writeEvents(q, PRAC, [{ ...voidEvent({ target: four.id, reason: "amendment" }), amendment: "points-1", innings: 0, id: "amendment:points-1", clientTs: Date.now() }], lastSeq);
  const mu2 = (await call(`/api/read/matchups?batterId=${PILLAY}`, { token: coach })).body?.rows ?? [];
  ok("the matchups read moves: 35 balls, 38 runs", mu2.reduce((a, r) => a + r.balls, 0) === 35 && mu2.reduce((a, r) => a + r.runs, 0) === 38, JSON.stringify(mu2.map((r) => [r.balls, r.runs])));
  const NOW_LINE = `now: ${ME} v pace · 35 balls · 38 runs · not out · as at`;
  const k = await open({ viewport: DESK });
  await signIn(k.page, "coach@example.invalid");
  await openDrawerOn(k.page, DAY);
  const s13b = (await cardsOf(k.page, "S13"))[0] ?? "";
  ok("S13 keeps what it stood on, and adds now, corrected", s13b.includes(`stood on: ${STOOD}`) && s13b.includes(NOW_LINE) && /· corrected/.test(s13b), s13b);
  ok("...and S5 itself reads the corrected figure", (await cardsOf(k.page, "S5")).some((t) => t.includes(`${ME} v pace · 35 balls · 38 runs · not out`)));
  ok("he opens Skills", await go(k.page, "skills"));
  await k.page.locator("button", { hasText: /Pillay/ }).first().click({ timeout: 8000 }).catch(() => {});
  await tid(k.page, `point-${row?.id}`).waitFor({ timeout: 12000 }).catch(() => {});
  await k.page.waitForFunction((id) => !!document.querySelector(`[data-testid="point-${id}"] [data-testid="point-now"]`), row?.id, { timeout: 12000 }).catch(() => {});
  const pk = await tid(k.page, `point-${row?.id}`).innerText().catch(() => "");
  ok("the panel says the same: stood on 36 balls, now 35, corrected", pk.includes(`stood on: ${STOOD}`) && pk.includes(NOW_LINE) && /· corrected/.test(pk), pk);
  ok("...and the stored lines did not change (both versions kept)", (await points()).find((r) => r.id === row?.id)?.evidence_text?.[0] === STOOD);

  group("Withdrawn: struck, kept, gone from the drawer");
  await clickAndWait(k.page, tid(k.page, `point-withdraw-${row?.id}`), /\/api\/notes\/[^/]+\/withdraw$/);
  await k.page.waitForFunction((id) => document.querySelector(`[data-testid="point-${id}"]`)?.getAttribute("data-withdrawn") === "yes", row?.id, { timeout: 10000 }).catch(() => {});
  ok("the point stays on the panel, struck", await tid(k.page, `point-${row?.id}`).getAttribute("data-withdrawn") === "yes"
     && /withdrawn/.test(await tid(k.page, `point-${row?.id}`).innerText()));
  const wr = (await points()).find((r) => r.id === row?.id);
  ok("...the row is kept with its body and its pointer, withdrawn_at set", !!wr?.withdrawn_at && wr.body === BODY && wr.evidence_text?.[0] === STOOD);
  await openDrawerOn(k.page, DAY);
  ok("...and S13 is gone from the drawer", (await cardsOf(k.page, "S13")).length === 0);
  ok("no page errors", k.errors.length === 0, k.errors.join(" | "));
  await k.ctx.close();
  // A standing point for tonight again, for the readers below.
  const again = await call(`/api/players/${PILLAY}/coaching-points`, { method: "POST", token: coach, body: { matchId: DAY, body: BODY,
    evidence: { rule: "S5", read: "matchups", params: { playerId: PILLAY, type: "pace" }, asOf: new Date().toISOString(), text: [STOOD] } } });
  ok("(a standing point for tonight, for the readers below)", again.status === 200, JSON.stringify(again.body));

  // ══ Who reads it ═══════════════════════════════════════════════════════
  group("The assistant coach and the director of sport read the points");
  const a = await open({ viewport: DESK });
  ok("the assistant coach signs in", await signIn(a.page, "assist.points@example.invalid"));
  await openDrawerOn(a.page, DAY);
  ok("his drawer has S13, and no Make a coaching point anywhere (he does not write development)",
     (await cardsOf(a.page, "S13")).some((t) => t.includes(BODY)) && await a.page.locator('[data-testid^="signal-point-"]').count() === 0);
  await go(a.page, "skills");
  await a.page.locator("button", { hasText: /Pillay/ }).first().click({ timeout: 8000 }).catch(() => {});
  await a.page.locator('[data-testid="coaching-points"] [data-testid^="point-"]', { hasText: BODY2 }).first().waitFor({ timeout: 12000 }).catch(() => {});
  ok("on Skills: the panel and the points", (await tid(a.page, "coaching-points").innerText().catch(() => "")).includes(BODY2));
  ok("...and no field to make one from a dot", await (async () => {
    await a.page.locator('[data-testid="history-technical-againstPace"] button[data-testid^="history-dot-"]').last().click({ timeout: 8000 }).catch(() => {});
    await tid(a.page, "dot-sheet").waitFor({ timeout: 6000 }).catch(() => {});
    return await tid(a.page, "dot-sheet").count() === 1 && await tid(a.page, "make-point-dot").count() === 0;
  })());
  await a.ctx.close();
  const d = await open({ viewport: DESK });
  ok("the director of sport signs in", await signIn(d.page, "sarah@example.invalid"));
  await go(d.page, "skills");
  await d.page.locator("button", { hasText: /Pillay/ }).first().click({ timeout: 8000 }).catch(() => {});
  await d.page.locator('[data-testid="coaching-points"] [data-testid^="point-"]', { hasText: BODY2 }).first().waitFor({ timeout: 12000 }).catch(() => {});
  const dp = await tid(d.page, "coaching-points").innerText().catch(() => "");
  ok("...reads the points on Skills, the author named as staff are told", dp.includes(BODY2) && dp.includes(`${COACH}, coach`), dp.slice(0, 300));
  await d.ctx.close();

  group("The team manager: no S13, and no coaching_points read is made");
  const t = await open({ viewport: DESK });
  ok("the team manager signs in", await signIn(t.page, "manager.points@example.invalid"));
  await openDrawerOn(t.page, DAY);
  ok("his drawer has no S13 and offers no point", (await cardsOf(t.page, "S13")).length === 0 && await t.page.locator('[data-testid^="signal-point-"]').count() === 0);
  ok("...no coaching_points read was made", t.pointReads.length === 0, t.pointReads.join(" "));
  ok("...and none of the point's words reach him", !(await text(t.page)).includes(BODY));
  await t.ctx.close();

  group("The boy himself and his parent: no point, no panel, no read");
  const b = await open({ viewport: PHONE });
  ok("R Pillay signs in", await signIn(b.page, "pillay@example.invalid"));
  await go(b.page, "me");
  await tid(b.page, "me-skills-open").click({ timeout: 8000 }).catch(() => {});
  await tid(b.page, "skills-self").waitFor({ timeout: 12000 }).catch(() => {});
  await tid(b.page, "history-strip").first().waitFor({ timeout: 12000 }).catch(() => {});
  ok("his Skills door opens his own screen", await tid(b.page, "skills-self").count() === 1);
  const bt = await said(b.page, "body");
  ok("...with no coaching point, no panel, no Make a coaching point", await tid(b.page, "coaching-points").count() === 0
     && !bt.includes(BODY) && !bt.includes(BODY2) && !/coaching point/i.test(bt), bt.match(/coaching point/i)?.[0]);
  await b.page.locator('[data-testid="history-technical-againstPace"] button[data-testid^="history-dot-"]').last().click({ timeout: 8000 }).catch(() => {});
  await tid(b.page, "dot-sheet").waitFor({ timeout: 6000 }).catch(() => {});
  ok("...a dot's sheet holds no point and offers none", await tid(b.page, "dot-sheet").count() === 1 && await tid(b.page, "make-point-dot").count() === 0
     && !(await tid(b.page, "dot-sheet").innerText()).includes(BODY2));
  ok("...and his screens made no coaching_points read", b.pointReads.length === 0, b.pointReads.join(" "));
  ok("no page errors for him", b.errors.length === 0, b.errors.join(" | "));
  await b.ctx.close();
  const pa = await open({ viewport: PHONE });
  ok("his parent signs in", await signIn(pa.page, "parent@example.invalid"));
  ok("...has no Skills door", await tid(pa.page, "nav-skills").count() === 0 && await tid(pa.page, "mnav-skills").count() === 0);
  ok("...no point's words on her Home, and no coaching_points read", !(await text(pa.page)).includes(BODY) && pa.pointReads.length === 0);
  await pa.ctx.close();
  // The read itself, as each of them: no row (the server's answer, not the screen's).
  for (const [who, email] of [["the boy himself", "pillay@example.invalid"], ["his parent", "parent@example.invalid"], ["the team manager", "manager.points@example.invalid"], ["the analyst", "analyst@example.invalid"]]) {
    const tok = await login(email);
    const r = await call(`/api/read/coaching_points?playerId=${PILLAY}`, { token: tok });
    ok(`the coaching_points read as ${who}: no row`, (r.body?.rows ?? []).length === 0, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  const rc = await call(`/api/read/coaching_points?playerId=${PILLAY}`, { token: coach });
  ok("...and as the coach: his three, the withdrawn one struck", (rc.body?.rows ?? []).length === 3 && (rc.body?.rows ?? []).filter((r) => r.withdrawn_at).length === 1);
  ok("the drawer and the panel notified nobody: no notification written", (await q(`select count(*)::int n from notification`))[0].n === notices0);
} catch (e) {
  ok(`the walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 8).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
  await owner.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER COACHING POINTS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

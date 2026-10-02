#!/usr/bin/env node
/**
 * The coach's match-day cockpit and the intelligence feed, from a browser
 * (SCRBRD-136 / 137 phase A; docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md
 * §9). What the walk proves, with the seed's invented people:
 *
 *   1. WHO GETS IT, by capability and never by title. The walk asks the
 *      policy (roles.mjs, through lib/cockpit.js) which roles pass the entry
 *      rule and which panels each grants, signs in as one of each kind, and
 *      holds the screen to the policy: the coach sees the tab; the assistant
 *      coach sees the load and not the selection signals; the team manager
 *      sees the side and the bus and no load; the physio sees the load and no
 *      side; a scorer, a parent and a pupil see no tab, no card and nothing
 *      that suggests one is missing.
 *   2. WHAT IT NEVER SAYS. The rendered tab and drawer are read against the
 *      real injury rows (the nature, severity, phase, the physio's notes) and
 *      the real reason a family gave for an absence: none appears. No wellness
 *      word, no ratio, no percentage beside a name, no phone number. Restricted
 *      reads "restricted · back 11 Oct", and the load reads a word and the
 *      fixed sentence.
 *   3. THE FEED'S EVIDENCE MATCHES THE READS. Every card's count and sentence is
 *      checked against the same reads fetched here, raw, with the coach's own
 *      token, by arithmetic written again in this file.
 *   4. THE LIVE TAB. Our bowlers' overs left are the pad's own sentences
 *      (capWords from the scoring package), the Board, the over strip, the
 *      phases and the wheel draw; a team manager has the same without the
 *      directive's spell line.
 *   5. SEEN. Dismissing hides a card for that person, on that device, across
 *      a reload; a changed answer brings it back; one person's dismissal is
 *      not another's. Nothing is written to the database by it.
 *   6. THE DASHBOARD CARD: the next fixture within seven days, its count equal
 *      to the drawer's, one tap into the tab with the drawer open; none for a
 *      scorer, a parent or a pupil.
 *   7. Floors: nothing read under 12px, nothing tapped under 44px, at 390
 *      wide, in both themes; reduced motion respected; no page errors.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-cockpit.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { capWords } from "@scrbrd/scoring";
import { appUrl, ownerUrl, port } from "./db-url.mjs";
import { ATTACK, PLAY, captainLogs, fixConditions } from "./fixture-captain.mjs";
import { writeEvents } from "./fixture-matchcentre.mjs";
import { entryTable, LOAD_SENTENCE } from "../apps/web/src/lib/cockpit.js";
import { NEVER_ON_THE_COCKPIT } from "../apps/web/src/lib/cockpitNever.js";

const WEB_PORT = port(4380);
const API_PORT = port(8980);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 260)}`); } };
const group = (t) => console.log("\n" + t);
const DEBUG = !!process.env.COCKPIT_DEBUG;
const dbg = (t, v) => { if (DEBUG) console.log(`\n--- ${t}\n${v}`); };

const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";
const NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-cockpit-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

// ── API, as a person (the reads the walk checks the screen against) ──
const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-cockpit" } })).body?.token;
const rows = async (token, path) => (await call(`/api/read/${path}`, { token })).body?.rows ?? [];

// ── The browser ──
async function open({ viewport = DESK, scheme = "light", reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: reduced ? "reduce" : "no-preference",
    ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [], refusals = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
    if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, refusals };
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
/** The staff Match Centre, a fixture open. */
async function openMatch(page, id) {
  if (!(await go(page, "matches"))) return false;
  const btn = tid(page, `mc-open-${id}`);
  if (!(await btn.count())) return false;
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(1800);
  return (await tid(page, "match-view").count()) === 1;
}
const tabIds = (page) => page.$$eval('[data-testid^="mc-tab-"]', (els) => els.map((e) => e.getAttribute("data-testid").replace("mc-tab-", "")));
async function coachTab(page) {
  await tid(page, "mc-tab-coach").click({ timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => { const t = document.querySelector('[data-testid="mc-coach"]'); return t && !document.querySelector('[data-testid="mc-coach-loading"]'); }, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(600);
}
async function openDrawer(page) {
  await tid(page, "coach-signals-open").click({ timeout: 4000 });
  await page.waitForTimeout(400);
  return (await tid(page, "signals").count()) === 1;
}
const cards = (page) => page.$$eval('[data-testid^="signal-"][data-rule]', (els) => els.map((e) => ({
  rule: e.getAttribute("data-rule"), count: Number(e.getAttribute("data-count")), seen: e.getAttribute("data-seen"), text: e.innerText })));
const byRule = (cs, r) => cs.filter((c) => c.rule === r);

/** §3.2 and §3.5 over what is on screen: the main area and the drawer. */
async function floors(page) {
  return page.evaluate(() => {
    const small = [], tiny = [];
    for (const root of document.querySelectorAll('[data-testid="os-main"], [data-testid="signals"]')) {
      for (const n of [root, ...root.querySelectorAll("*")]) {
        if (n.closest(".sr-only")) continue;
        const cs = getComputedStyle(n);
        const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (own && cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
        if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))) {
          const r = n.getBoundingClientRect();
          if (r.height && r.height < 43.5) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
        }
      }
    }
    return { small, tiny };
  });
}

/** A reload loses the session on purpose (the token lives in memory): sign in again and come back to the Coach tab. */
async function backTo(page, email, id, drawer = true) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  // The reload drops the token: the app comes back as its demonstration, and the coach signs in again.
  if (/Demonstration\./.test(await text(page))) { await click(page, /^Sign in$/i); await page.waitForTimeout(500); await signIn(page, email); }
  const opened = await openMatch(page, id);
  await coachTab(page);
  if (!opened || (await tid(page, "coach-signals-open").count()) === 0) throw new Error(`could not come back to the Coach tab (opened=${opened}): ${(await text(page)).slice(0, 400).replace(/\s+/g, " ")}`);
  if (drawer) await openDrawer(page);
}

const SAFE_WORDS = (t) => t.replaceAll(LOAD_SENTENCE, "");

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ══ The stage ══════════════════════════════════════════════════════════
  group("Set the stage: two live matches, a fixture today with a sheet, a bus, a lift, an answer with a reason");
  const SIX = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born) values ($1, '1XI', 'V Mate Six', 66, 'batter', current_date - interval '19 years') returning id`, [HIL]))[0].id;
  const SEVEN = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born) values ($1, '1XI', 'V Mate Seven', 67, 'bowler', current_date - interval '19 years') returning id`, [HIL]))[0].id;
  const EXTRA = [];
  for (const [i, n] of [[68, "V Mate Eight"], [69, "V Mate Nine"], [70, "V Mate Ten"], [71, "V Mate Eleven"]]) {
    EXTRA.push((await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born) values ($1, '1XI', $3, $2, 'batter', current_date - interval '19 years') returning id`, [HIL, i, n]))[0].id);
  }
  await q(`update player set bowling_style = 'F' where id = $1`, [NAIDOO]);
  const nm = Object.fromEntries((await q(`select id, full_name from player where id = any($1::uuid[])`, [[PILLAY, WHITFIELD, BEKKER, NAIDOO, SEVEN, SIX, ...EXTRA]])).map((r) => [r.id, r.full_name]));
  const ids = { pillay: PILLAY, whitfield: WHITFIELD, bekker: BEKKER, naidoo: NAIDOO, seven: SEVEN, six: SIX };
  const names = { pillay: nm[PILLAY], whitfield: nm[WHITFIELD], bekker: nm[BEKKER], naidoo: nm[NAIDOO], seven: nm[SEVEN], six: nm[SIX] };
  // The captain walk's two live matches (tools/fixture-captain.mjs), written here so that each ball
  // carries its bowler as the pad's server stamps it: the overs, the spells and the week's load
  // then read as they would from a scored match.
  const mk = async (status, startsAt) => (await q(
    `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, '1XI', $2, '1XI', 'Westville Boys'' High 1XI', $3, 'cricket', 'T20', 20, $4) returning id`, [HIL, WES, startsAt, status]))[0].id;
  const FIELD = await mk("live", new Date(Date.now() - 3 * 3600e3).toISOString());
  const BAT = await mk("live", new Date(Date.now() - 2 * 3600e3).toISOString());
  for (const m of [FIELD, BAT]) {
    await fixConditions(q, m);
    await q(`insert into match_squad (match_id, player_id, side, batting_no) values
               ($1, $2, 'home', 1), ($1, $3, 'home', 2), ($1, $4, 'home', 3), ($1, $5, 'home', 4), ($1, $6, 'home', 5), ($1, $7, 'home', 6)`,
      [m, ids.whitfield, ids.bekker, ids.naidoo, ids.pillay, ids.seven, ids.six]);
  }
  const logs = captainLogs({ ids, names });
  const stamped = (log) => { let on = null; return log.map((ev) => { if (ev.kind === "bowler") on = ev.bowler; return ev.kind === "ball" && on && Object.values(ids).includes(on) ? { ...ev, bowler: on } : ev; }); };
  await writeEvents(q, FIELD, stamped(logs.field));
  await writeEvents(q, BAT, stamped(logs.bat));
  // Played "now" so the 7-day week reads them; the log is the same.

  // The fixture today, 23:00 SA time: soon, and the match day.
  const DAY = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, '1XI', 'Verify Cockpit XI', (sa_today()::timestamp + time '23:00') at time zone 'Africa/Johannesburg', 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL]))[0].id;
  const SHEET = [WHITFIELD, BEKKER, NAIDOO, PILLAY, SEVEN, SIX, ...EXTRA];
  await q(`insert into match_squad (match_id, player_id, side, batting_no) select $1, p, 'home', n from unnest($2::uuid[]) with ordinality as t(p, n)`, [DAY, SHEET]);
  await q(`insert into match_pitch_report (match_id, school_id, surface, grass, bounce, pace, favours) values ($1, $2, 'firm', 'covered', 'even', 'quick', 'seam')`, [DAY, HIL]);
  await q(`insert into match_weather (match_id, condition, temp_c, rain_chance_pct, forecast, playable) values ($1, 'Showers', 18, 70, 'Rain likely from 14:00', true)`, [DAY]);
  const coachId = (await q(`select id from app_user where email = 'coach@example.invalid'`))[0].id;
  const REASON = "A family funeral in Durban";
  await q(`insert into match_availability (match_id, player_id, school_id, status, reason_kind, note, declared_by)
           values ($1, $2, $3, 'unavailable', 'family', $4, $5)`, [DAY, WHITFIELD, HIL, REASON, coachId]);
  await q(`insert into match_availability (match_id, player_id, school_id, status, declared_by) values ($1, $2, $3, 'available', $4), ($1, $5, $3, 'available', $4)`,
    [DAY, SEVEN, HIL, coachId, SIX]);
  await q(`insert into notification (school_id, team_code, scope_level, kind, urgency, title, body, required_capability, subject_kind, subject_id)
           values ($1, '1XI', 'team', 'selection', 'low', 'The sheet has changed', 'The sheet for tonight was changed by the selector.', 'news.read', 'match', $2)`, [HIL, DAY]);
  // The bus: a four-seater, and a big one to swap to.
  const SMALL = (await q(`insert into vehicle (school_id, registration, description, kind, capacity) values ($1, 'KZN 4 SEAT', 'Verify four-seater', 'van', 4) returning id`, [HIL]))[0].id;
  const BIG = "4e111111-0000-0000-0000-000000000001";
  const TRIP = (await q(`insert into trip (match_id, school_id, vehicle_id, depart_at, pickup) values ($1, $2, $3, (sa_today()::timestamp + time '21:00') at time zone 'Africa/Johannesburg', 'the Chapel car park') returning id`, [DAY, HIL, SMALL]))[0].id;
  ok("the stage is set", !!DAY && !!TRIP);
  const reads0 = (await q(`select count(*)::int n from notification_read`))[0].n;

  // The lift: one boy arrives by lift, the lift is late and not marked as leaving.
  const head = await login("principal@example.invalid"), driver = await login("parent.whitfield@example.invalid"), mum = await login("parent.bekker@example.invalid");
  await q(`insert into feature_grant (key, school_id, granted, note) values ('lift_club', $1, true, 'browser-cockpit') on conflict (key, school_id) do update set granted = true`, [HIL]);
  await call("/api/lifts/policy", { method: "POST", token: head, body: { schoolId: HIL, body: "Lifts are arranged between families; the school facilitates and does not operate them. A driver undertakes that she holds a licence, that the car is insured and roadworthy, and that every boy wears a belt." } });
  const card = (await q(`select id from emergency_contact where player_id = $1 and active order by priority limit 1`, [WHITFIELD]))[0];
  await call("/api/lifts/declaration", { method: "POST", token: driver, body: { schoolId: HIL, vehicle: "silver Toyota Fortuner", registration: "nd 123-456", seats: 3,
    licenceHeld: true, insured: true, roadworthy: true, belts: true, codeAcknowledged: true, contactId: card.id } });
  const startsAt = new Date((await q(`select starts_at from match where id = $1`, [DAY]))[0].starts_at);
  const at = (min) => new Date(startsAt.getTime() + min * 60000).toISOString();
  const offer = await call(`/api/matches/${DAY}/lifts`, { method: "POST", token: driver, body: { legs: [
    { leg: "out", seats: 3, meetKind: "school", meetAt: at(-105) }, { leg: "back", seats: 3, meetKind: "ground", meetAt: at(300) }] } });
  const OUT = offer.body?.offers?.find((o) => o.leg === "out")?.id;
  const seat = await call(`/api/lifts/${OUT}/seats`, { method: "POST", token: mum, body: { playerId: BEKKER } });
  await call(`/api/lifts/${OUT}/accept`, { method: "POST", token: driver, body: { seatIds: [seat.body?.seatId] } });
  await q(`update lift_offer set meet_at = now() - interval '3 hours' where id = $1`, [OUT]);
  ok("a lift is arranged for one boy and is late", !!OUT && !!seat.body?.seatId);

  // Two more staff, appointed to the 1XI: nobody the seed has.
  for (const [email, name, role] of [["assist.cockpit@example.invalid", "A Assistant", "assistantcoach"], ["manager.cockpit@example.invalid", "T Manager", "teammanager"]]) {
    await q(`insert into app_user (school_id, email, name, role, teams) values ($1, $2, $3, $4, '{1XI}')`, [HIL, email, name, role]);
    await q(`insert into role_assignment (person_id, role, school_id, team_code) select id, $2, school_id, '1XI' from app_user where email = $1`, [email, role]);
  }
  // What must never appear, read from the rows themselves.
  const inj = await q(`select injury_type, severity, phase, notes, physio from injury`);
  const NEVER_VALUES = [...inj.flatMap((r) => [r.injury_type, r.notes, r.physio]), REASON, "family funeral", "Durban"].filter(Boolean);
  const PHONE_NO = /\+?27[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}|\b0\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/;
  const leaks = (t) => [...NEVER_VALUES.filter((v) => t.includes(v)), ...(SAFE_WORDS(t).match(NEVER_ON_THE_COCKPIT) ?? []), ...(t.match(PHONE_NO) ?? []),
    ...(/\b(hamstring|impingement|rehab|sprain|physio)\b/i.test(t) ? ["clinical word"] : []), ...(t.includes(REASON) ? [] : [])];

  // ══ 1 · Who gets it ═════════════════════════════════════════════════════
  group("Who gets it: by capability, the policy's table held to the screen");
  const table = Object.fromEntries(entryTable().map((r) => [r.role, r]));
  const PERSONAS = [
    ["coach", "coach@example.invalid", "coach"], ["assistant coach", "assist.cockpit@example.invalid", "assistantcoach"],
    ["team manager", "manager.cockpit@example.invalid", "teammanager"], ["physio", "medical@example.invalid", "medical"],
    ["director of sport", "sarah@example.invalid", "directorofsport"],
  ];
  const seen = {};
  for (const [label, email, role] of PERSONAS) {
    const s = await open({ viewport: PHONE });
    const signed = await signIn(s.page, email);
    const entered = await openMatch(s.page, DAY);
    const tabs = entered ? await tabIds(s.page) : [];
    const want = table[role];
    ok(`${label}: signs in and opens the fixture`, signed && entered);
    ok(`${label}: the policy says ${want.enters ? "enters" : "does not enter"}; the screen has ${tabs.includes("coach") ? "the tab" : "no tab"}`, tabs.includes("coach") === !!want.enters, tabs.join());
    if (want.enters) {
      ok(`${label}: the Coach tab is the second, after the Summary`, tabs.join() === "summary,coach,scorecard,commentary,partnerships,analytics,details", tabs.join());
      await coachTab(s.page);
      const p = want.panels;
      const have = { day: await tid(s.page, "coach-day").count() === 1, side: await tid(s.page, "coach-side").count() === 1, load: await tid(s.page, "coach-week").count() === 1 };
      ok(`${label}: the day panel follows fixture.read (${p.day})`, have.day === p.day);
      ok(`${label}: the side panel follows availability.read + team.read (${p.side})`, have.side === p.side);
      ok(`${label}: the load panel follows player.workload.read (${p.load})`, have.load === p.load);
      const lifts = await tid(s.page, "coach-day-bus").count();
      ok(`${label}: the bus line follows transport.read (${p.bus})`, (lifts === 1) === p.bus, `${lifts}`);
      seen[label] = { panels: p, tabText: await inner(s.page, "mc-panel-coach") };
    }
    ok(`${label}: no page errors, no scoping refusals`, s.errors.length === 0 && s.refusals.length === 0, [...s.errors, ...s.refusals].join(" | "));
    await s.ctx.close();
  }
  for (const [label, email] of [["scorer", "scorer@example.invalid"], ["spectator", "watcher@example.invalid"], ["analyst", "analyst@example.invalid"]]) {
    const s = await open({ viewport: PHONE });
    await signIn(s.page, email);
    const entered = await openMatch(s.page, DAY);
    const tabs = entered ? await tabIds(s.page) : [];
    ok(`${label}: no tab, and the six as built`, entered && tabs.join() === "summary,scorecard,commentary,partnerships,analytics,details", tabs.join());
    await go(s.page, "dashboard");
    ok(`${label}: no card on the Dashboard`, (await tid(s.page, "day-matchday").count()) === 0);
    ok(`${label}: nothing on the page says Coach or Signals`, !/\bCoach\b|Signals \(/.test(await text(s.page).catch(() => "")));
    await s.ctx.close();
  }
  {
    const s = await open({ viewport: PHONE });
    await signIn(s.page, "parent@example.invalid");
    ok("a parent: no card on Home", (await tid(s.page, "day-matchday").count()) === 0);
    await go(s.page, "fixtures");
    await tid(s.page, `live-row-${FIELD}`).click({ timeout: 4000 }).catch(() => {});
    await s.page.waitForTimeout(2000);
    const tabs = await tabIds(s.page);
    ok("a parent: the live match has the six tabs and no Coach", tabs.length > 0 && !tabs.includes("coach"), tabs.join());
    await s.ctx.close();
    const p = await open({ viewport: PHONE });
    await signIn(p.page, "pillay@example.invalid");
    ok("a pupil: no card on Home", (await tid(p.page, "day-matchday").count()) === 0);
    await go(p.page, "mymatches");
    await tid(p.page, `live-row-${FIELD}`).click({ timeout: 4000 }).catch(() => {});
    await p.page.waitForTimeout(2000);
    const tabs2 = await tabIds(p.page);
    ok("a pupil: the live match has the six tabs and no Coach", tabs2.length > 0 && !tabs2.includes("coach"), tabs2.join());
    await p.ctx.close();
  }

  // ══ 2 · The coach, before the match ═════════════════════════════════════
  group("The coach's tab, before the first ball: the day, the side, the week");
  const coach = await login("coach@example.invalid");
  const c = await open({ viewport: PHONE });
  ok("the coach signs in", await signIn(c.page, "coach@example.invalid"));
  ok("...and opens tonight's fixture", await openMatch(c.page, DAY));
  await coachTab(c.page);
  const tab = await inner(c.page, "mc-panel-coach");
  dbg("COACH TAB (before)", tab);
  ok("the label names the side", /^COACH/i.test(await inner(c.page, "mc-coach-label")), await inner(c.page, "mc-coach-label"));
  const day = await inner(c.page, "coach-day");
  ok("THE DAY: the overs and the pitch, in words", /20 overs/.test(day) && /firm, good grass cover, even bounce, quick pace/.test(day), day);
  ok("...the weather, in words", /18° showers, rain likely/.test(day), day);
  ok("...no umpire and no scorer on record, said", /Umpires: none on record/.test(day) && /no scorer on record/.test(day), day);
  const bus = await inner(c.page, "coach-day-bus");
  ok("...the bus: four seats, ten named, one arriving by lift", /4 seats/.test(bus) && /10 named/.test(bus) && /1 arriving by lift/.test(bus), bus);
  ok("...and the lift as a head count: no driver, no boy's name beside it", !/Whitfield|Bekker|Fortuner/.test(bus + day), bus);

  const sideRows = await c.page.$$eval('[data-testid^="coach-side-"][data-state]', (els) => els.map((e) => ({ id: e.getAttribute("data-testid").replace("coach-side-", ""), state: e.getAttribute("data-state"), text: e.innerText })));
  ok("THE SIDE: ten named, in batting order", sideRows.length === 10 && sideRows[0].id === WHITFIELD, sideRows.length);
  ok("...Bekker reads restricted and the date he is back, nothing more", /restricted/.test(sideRows.find((r) => r.id === BEKKER)?.text ?? "") && /back 11 Oct/.test(sideRows.find((r) => r.id === BEKKER)?.text ?? ""), sideRows.find((r) => r.id === BEKKER)?.text);
  ok("...Pillay too, back 18 Oct", /back 18 Oct/.test(sideRows.find((r) => r.id === PILLAY)?.text ?? ""));
  ok("...Whitfield reads unavailable, with no reason", sideRows.find((r) => r.id === WHITFIELD)?.state === "unavailable" && !/funeral|family|Durban/i.test(sideRows.find((r) => r.id === WHITFIELD)?.text ?? ""), sideRows.find((r) => r.id === WHITFIELD)?.text);
  ok("...Naidoo has not answered, in words", sideRows.find((r) => r.id === NAIDOO)?.state === "unanswered" && /no answer/.test(sideRows.find((r) => r.id === NAIDOO).text));
  ok("...the foot counts them", /10 named · 5 to chase · 1 unavailable · 2 restricted/.test(await inner(c.page, "coach-side-foot")), await inner(c.page, "coach-side-foot"));

  const wk = await inner(c.page, "coach-week");
  const weekRows = await c.page.$$eval('[data-testid^="coach-week-"]:not([data-testid="coach-week-sentence"])', (els) => els.map((e) => e.innerText));
  ok("OUR BOWLERS THIS WEEK: the word, with the fixed sentence beneath", weekRows.length >= 3 && /spike|rising|steady|light|rested|too little to say|no load/.test(weekRows.join(" ")) && wk.includes(LOAD_SENTENCE), wk);
  ok("...a limit beside each, with its clause", /\d a spell, \d+ a day/.test(wk), wk);

  const full = await text(c.page);
  const bad = leaks(full);
  ok(`NEVER: no injury nature, severity, physio note, reason for an absence, wellness word, ratio, percentage or phone number anywhere on the screen (${bad.length})`, bad.length === 0, bad.join(" | "));
  ok("...the 'Signals' button carries a count", /Signals \(\d+\)/.test(await inner(c.page, "coach-signals-open")));
  const f1 = await floors(c.page);
  ok(`phone, daylight: nothing under 12px (${f1.small.length}), nothing tapped under 44px (${f1.tiny.length})`, f1.small.length === 0 && f1.tiny.length === 0, [...f1.small, ...f1.tiny].slice(0, 4).join(" · "));

  // ══ 3 · The drawer: the feed's evidence against the reads ═══════════════
  group("The feed: every card's evidence equals the reads, fetched raw with the coach's own token");
  ok("the drawer opens", await openDrawer(c.page));
  const cs = await cards(c.page);
  dbg("CARDS", cs.map((x) => `${x.rule} [${x.count}] ${x.text.replace(/\n+/g, " | ")}`).join("\n"));
  const rawSquad = await rows(coach, `match_squad?matchId=${DAY}`);
  const rawTrips = await rows(coach, `trips?matchId=${DAY}`);
  const rawReady = await rows(coach, `readiness?matchId=${DAY}`);
  const rawLifts = (await call(`/api/matches/${DAY}/lifts/expected`, { token: coach })).body?.rows ?? [];
  const rawWeather = (await rows(coach, "weather")).find((w) => w.match_id === DAY);
  const rawDuties = await rows(coach, `match_duties?matchId=${DAY}`);
  const rawWork = await rows(coach, "workload?teamCode=1XI");
  const rawNotes = await rows(coach, "notifications");
  const home = rawSquad.filter((r) => r.side === "home");
  const sheetIds = new Set(home.map((r) => r.player_id));
  const byLift = new Set(rawLifts.map((r) => r.playerId).filter((id) => sheetIds.has(id))).size;
  const cap = rawTrips.filter((t) => t.state !== "cancelled").reduce((n, t) => n + t.capacity, 0);
  const travelling = home.length - byLift;

  const s1 = byRule(cs, "S1");
  ok("S1: the bus is short, by the arithmetic of the reads", s1.length === 1 && s1[0].count === travelling - cap && travelling > cap, `${JSON.stringify(s1)} v ${travelling}-${cap}`);
  ok(`S1: says "Bus seats ${cap} · ${home.length} named, ${byLift} by lift → ${travelling} travelling"`, s1[0]?.text.includes(`Bus seats ${cap} · ${home.length} named, ${byLift} by lift → ${travelling} travelling`), s1[0]?.text);
  ok("S1: names nobody", !/Whitfield|Bekker|Naidoo/.test(s1[0]?.text ?? ""));

  const s3 = byRule(cs, "S3");
  const wantS3 = rawReady.filter((r) => r.selected && (r.state === "restricted" || r.state === "unavailable" || r.declared_status === "needs_reconfirming"));
  ok(`S3: one card per picked boy who is restricted, unavailable or asked again (${wantS3.length})`, s3.length === wantS3.length && wantS3.length >= 3, `${s3.length} v ${wantS3.length}`);
  ok("S3: Bekker restricted · back 11 Oct, Whitfield unavailable", s3.some((x) => /Bekker · restricted · back 11 Oct/.test(x.text)) && s3.some((x) => /Whitfield · on the sheet · marked unavailable/.test(x.text)));
  ok("S3: no reason and no nature on any", s3.every((x) => leaks(x.text).length === 0), s3.map((x) => leaks(x.text)).flat().join());

  const s4 = byRule(cs, "S4a");
  const lateOffers = new Set(rawLifts.filter((r) => r.notLeft).map((r) => r.offerId)).size;
  ok("S4a: one lift not marked as leaving, as a head count", s4.length === 1 && lateOffers === 1 && s4[0].count === byLift && /1 arriving by lift/.test(s4[0].text) && /1 lift not marked as leaving/.test(s4[0].text), JSON.stringify(s4));
  ok("S4a: no name, no driver, no number", !/Bekker|Whitfield|Fortuner|\d{3} \d{3}/.test(s4[0]?.text ?? ""));
  ok("S4b: not the coach's (the office's, by name)", byRule(cs, "S4b").length === 0);

  const s6 = byRule(cs, "S6");
  ok(`S6: the sheet is thin (${home.filter((r) => !r.twelfth).length} named)`, s6.length === 1 && s6[0].count === home.filter((r) => !r.twelfth).length && /10 named · a side needs 11/.test(s6[0].text), JSON.stringify(s6));
  const s7 = byRule(cs, "S7");
  const none = rawReady.filter((r) => r.declared_status == null).length, again = rawReady.filter((r) => r.declared_status === "needs_reconfirming").length;
  ok(`S7: ${none} have not answered, as a count and not a name`, s7.length === 1 && s7[0].count === none + again && new RegExp(`${none} have not answered`).test(s7[0].text) && !/Naidoo|Pillay/.test(s7[0].text), `${JSON.stringify(s7)} v ${none}/${again}`);
  const s8 = byRule(cs, "S8");
  const wantS8 = ["scorer", "umpire"].filter((d) => !rawDuties.some((r) => r.duty === d));
  ok("S8: no scorer and no umpire on record, one card each", s8.length === wantS8.length && wantS8.length === 2 && s8.every((x) => /No (scorer|umpire) on record for/.test(x.text)), JSON.stringify(s8));
  const s9 = byRule(cs, "S9");
  ok(`S9: the weather read's own words (${rawWeather?.forecast})`, s9.length === 1 && s9[0].text.includes(rawWeather.forecast) && /70 in 100 chance of rain/.test(s9[0].text), JSON.stringify(s9));
  ok("S10: no conditions set for the fixture, said as the document says it", byRule(cs, "S10").length === 1 && /platform defaults/.test(byRule(cs, "S10")[0].text), JSON.stringify(byRule(cs, "S10")));
  const s11 = byRule(cs, "S11");
  const wantS11 = rawWork.filter((w) => w.pace && sheetIds.has(w.player_id) && ["rising", "spike"].includes(w.load_word));
  ok(`S11: a card for each pace bowler on the sheet whose word is rising or spike (${wantS11.length})`, s11.length === wantS11.length && wantS11.length >= 2, `${s11.length} v ${wantS11.length}`);
  ok("S11: the word and the fixed sentence, never a ratio", s11.every((x) => x.text.includes(LOAD_SENTENCE) && /this week · (rising|spike)/.test(x.text) && !/\d\.\d\d|ratio|risk/i.test(SAFE_WORDS(x.text))), s11[0]?.text);
  const s12 = byRule(cs, "S12");
  const wantS12 = rawNotes.filter((n) => n.subject_kind === "match" && n.subject_id === DAY && ["welfare", "selection", "transport"].includes(n.kind));
  ok("S12: the notice for this fixture, as published", s12.length === wantS12.length && wantS12.length === 1 && s12[0].text.includes(wantS12[0].title) && s12[0].text.includes(wantS12[0].body), JSON.stringify(s12));
  ok("S2a, S2b, S5: nothing yet (nobody has bowled; no matchup has thirty balls)", byRule(cs, "S2a").length === 0 && byRule(cs, "S2b").length === 0 && byRule(cs, "S5").length === 0);
  ok("every card says where it came from and which capability let him see it", cs.every((x) => /From .+\. You see it through coach with /.test(x.text)));
  const drawerText = await inner(c.page, "signals");
  const bad2 = leaks(drawerText);
  ok(`the drawer: none of the never-words (${bad2.length})`, bad2.length === 0, bad2.join(" | "));
  const f2 = await floors(c.page);
  ok(`the drawer, phone: nothing under 12px (${f2.small.length}), nothing tapped under 44px (${f2.tiny.length})`, f2.small.length === 0 && f2.tiny.length === 0, [...f2.small, ...f2.tiny].slice(0, 4).join(" · "));
  ok("the drawer is a dialog named by its heading, and the cards are articles with their evidence as text",
     await c.page.$eval('[data-testid="signals"]', (e) => e.getAttribute("role") === "dialog" && !!document.getElementById(e.getAttribute("aria-labelledby"))) && (await c.page.$$('[data-testid="signals"] article')).length === cs.length);
  await c.page.keyboard.press("Escape");
  await c.page.waitForTimeout(300);
  ok("Escape closes it, and focus returns to the button that opened it", (await tid(c.page, "signals").count()) === 0 && await c.page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "coach-signals-open");

  // ══ 4 · Seen ════════════════════════════════════════════════════════════
  group("Seen: per person, per evidence, on the device — and a changed answer brings it back");
  const before = cs.length;
  await openDrawer(c.page);
  await tid(c.page, "signal-seen-S7").click({ timeout: 4000 });
  await c.page.waitForTimeout(300);
  const after = await cards(c.page);
  ok("Seen hides the card (S7), and the count falls by one", byRule(after, "S7").length === 0 && after.length === before - 1 && Number(await inner(c.page, "signals-count")) === before - 1, `${after.length} v ${before}`);
  ok("...Show N I have seen brings it back, marked seen", await click(c.page, /^Show 1 I have seen/) && byRule(await cards(c.page), "S7")[0]?.seen === "yes");
  await c.page.keyboard.press("Escape");
  await backTo(c.page, "coach@example.invalid", DAY);
  ok("...across a reload it is still hidden (held on the device)", byRule(await cards(c.page), "S7").length === 0 && await click(c.page, /^Show 1 I have seen/) && byRule(await cards(c.page), "S7")[0]?.seen === "yes");
  ok("...and the database holds nothing of it: no notice marked read, no row written", (await q(`select count(*)::int n from notification_read`))[0].n === reads0);
  await c.page.keyboard.press("Escape");
  // Naidoo answers: the evidence changes, and the card comes back.
  await q(`insert into match_availability (match_id, player_id, school_id, status, declared_by) values ($1, $2, $3, 'available', $4)`, [DAY, NAIDOO, HIL, coachId]);
  await backTo(c.page, "coach@example.invalid", DAY);
  const back = byRule(await cards(c.page), "S7");
  ok("a new answer changes the count (five now have not answered) and S7 comes back unseen", back.length === 1 && back[0].seen === "no" && back[0].count === none - 1, JSON.stringify(back));
  await c.page.keyboard.press("Escape");
  // The bus swaps to the big one: S1 clears; swapped back, it returns.
  await q(`update trip set vehicle_id = $1 where id = $2`, [BIG, TRIP]);
  await backTo(c.page, "coach@example.invalid", DAY);
  ok("swap the bus to a 22-seater: S1 clears", byRule(await cards(c.page), "S1").length === 0);
  await c.page.keyboard.press("Escape");
  await q(`update trip set vehicle_id = $1 where id = $2`, [SMALL, TRIP]);
  await backTo(c.page, "coach@example.invalid", DAY);
  ok("...and back to the four-seater: S1 returns", byRule(await cards(c.page), "S1").length === 1);
  await c.page.keyboard.press("Escape");
  ok("the coach's tab raised no error and no scoping refusal", c.errors.length === 0 && c.refusals.length === 0, [...c.errors, ...c.refusals].join(" | "));

  // ══ 5 · The team manager and the assistant: their own feeds ═════════════
  group("The team manager and the assistant coach: each card checks its own capability");
  const tm = await open({ viewport: PHONE });
  await signIn(tm.page, "manager.cockpit@example.invalid"); await openMatch(tm.page, DAY); await coachTab(tm.page); await openDrawer(tm.page);
  const tmCards = await cards(tm.page);
  const tmRules = [...new Set(tmCards.map((x) => x.rule))].sort();
  ok(`the team manager's drawer has S1, S3, S6–S10 (and S12, S7) and no S11 (${tmRules.join()})`,
     ["S1", "S3", "S6", "S7", "S8", "S9", "S10"].every((r) => tmRules.includes(r)) && !tmRules.includes("S11"), tmRules.join());
  ok("...no load anywhere on his tab", (await tid(tm.page, "coach-week").count()) === 0 && !/spike|rising|A guide to a conversation/.test(await inner(tm.page, "signals")));
  const bad3 = leaks(await inner(tm.page, "signals"));
  ok("...and none of the never-words in his drawer", bad3.length === 0, bad3.join());
  await tid(tm.page, "signal-seen-S7").click({ timeout: 3000 }).catch(() => {});
  await tm.ctx.close();
  const as = await open({ viewport: PHONE });
  await signIn(as.page, "assist.cockpit@example.invalid"); await openMatch(as.page, DAY); await coachTab(as.page); await openDrawer(as.page);
  const asRules = [...new Set((await cards(as.page)).map((x) => x.rule))].sort();
  ok(`the assistant coach has the load (S11) and no selection signals — no S3, no S6 (${asRules.join()})`,
     asRules.includes("S11") && !asRules.includes("S3") && !asRules.includes("S6") && asRules.includes("S7"), asRules.join());
  ok("...and the side panel without the selection", (await tid(as.page, "coach-side").count()) === 1);
  await as.ctx.close();
  {
    // The manager dismissed S7 on his own device; the coach's feed is the coach's.
    const c2 = await open({ viewport: PHONE });
    await signIn(c2.page, "coach@example.invalid"); await openMatch(c2.page, DAY); await coachTab(c2.page); await openDrawer(c2.page);
    ok("one person's Seen is not another's: the coach's S7 is unseen", byRule(await cards(c2.page), "S7")[0]?.seen === "no");
    await c2.ctx.close();
  }

  // ══ 6 · The Dashboard card ══════════════════════════════════════════════
  group("The match-day card on the Dashboard");
  const d = await open({ viewport: PHONE });
  await signIn(d.page, "coach@example.invalid");
  await go(d.page, "dashboard");
  await d.page.waitForFunction(() => document.querySelector('[data-testid="matchday-count"]'), null, { timeout: 12000 }).catch(() => {});
  const cardText = await inner(d.page, "day-matchday");
  dbg("CARD", cardText);
  ok("the coach's Dashboard carries the card for the fixture today", await tid(d.page, "day-matchday").count() === 1 && /v Verify Cockpit XI/.test(cardText), cardText);
  const cardCount = Number((await inner(d.page, "matchday-count")).match(/\d+/)?.[0]);
  ok("...the side in a line: ten named, five to chase, two restricted", /10 named/.test(await inner(d.page, "matchday-side")) && /2 restricted/.test(await inner(d.page, "matchday-side")), await inner(d.page, "matchday-side"));
  await tid(d.page, "matchday-signals").click({ timeout: 4000 });
  await d.page.waitForTimeout(3500);
  ok("one tap on the count opens the Coach tab of that fixture, with the drawer open", await tid(d.page, "mc-coach").count() === 1 && await tid(d.page, "signals").count() === 1);
  const drawerOpen = Number((await inner(d.page, "signals-count")).match(/\d+/)?.[0]);
  ok(`...and the card's count (${cardCount}) is the drawer's (${drawerOpen})`, cardCount === drawerOpen);
  const f3 = await floors(d.page);
  ok(`the Dashboard and the drawer: nothing under 12px (${f3.small.length}), nothing tapped under 44px (${f3.tiny.length})`, f3.small.length === 0 && f3.tiny.length === 0, [...f3.small, ...f3.tiny].slice(0, 4).join(" · "));
  await d.ctx.close();

  // ══ 7 · The live tab ════════════════════════════════════════════════════
  group("The live tab: the Board, our bowlers with the cap's own words, the strip, the phases, the wheel");
  const bowled = Object.fromEntries(Object.entries(ids).map(([k, id]) => [id, ATTACK.filter((w) => w === k).length * 6]));
  const lv = await open({ viewport: DESK });
  await signIn(lv.page, "coach@example.invalid");
  ok("the coach opens the live fixture", await openMatch(lv.page, FIELD));
  await coachTab(lv.page);
  ok("the Board is on it", await tid(lv.page, "coach-board").count() === 1);
  for (const [who, id] of [["Naidoo", NAIDOO], ["Whitfield", WHITFIELD], ["Bekker", BEKKER], ["Seven", SEVEN]]) {
    const want = capWords(bowled[id], PLAY, { unconfirmed: false });
    const got = (await tid(lv.page, `coach-cap-${id}`).first().innerText({ timeout: 1500 }).catch(() => null))?.trim() ?? null;
    ok(`${who} (${bowled[id]} balls): the tab says ${want === null ? "nothing" : `"${want}"`}, as capWords() does for the pad and the Captain tab`, got === want, `${got} v ${want}`);
  }
  ok("OUR BOWLERS · overs left", /Our bowlers · overs left/i.test(await inner(lv.page, "coach-bowlers")));
  ok("...the phases draw", await tid(lv.page, "coach-phase-powerplay").count() === 1, await inner(lv.page, "coach-phases"));
  ok("...the over story, last two", (await lv.page.$$('[data-testid="coach-story"] li')).length === 2);
  ok("...the wheel, and a filter by shot", await tid(lv.page, "coach-wheel").count() >= 1 && await tid(lv.page, "coach-wheel-drive").count() === 1);
  await tid(lv.page, "coach-wheel-drive").click({ timeout: 3000 });
  ok("...filtering to the drive keeps a wheel", await tid(lv.page, "shot-wheel").count() >= 1);
  await openDrawer(lv.page);
  const lcs = await cards(lv.page);
  const s2a = byRule(lcs, "S2a");
  ok("S2a: a card for Naidoo (at the cap), Whitfield (one over left) and Bekker (past it) — the cap's own sentences, verbatim",
     s2a.length === 3 && [[NAIDOO, "Has bowled his 4 overs"], [WHITFIELD, "Has 1 over left (4 an innings)"], [BEKKER, "5 overs; the conditions allow 4"]].every(([id, w]) => s2a.some((x) => x.text.includes(`${nm[id]} · ${w}`))), JSON.stringify(s2a.map((x) => x.text.split("\n")[1])));
  ok("S2a: in play, a card cannot be dismissed (it clears with the over)", s2a.every((x) => /clears by itself/.test(x.text)) && await tid(lv.page, "signal-seen-S2a").count() === 0);
  const lb = leaks(await inner(lv.page, "mc-panel-coach"));
  ok(`the live tab and its drawer: none of the never-words (${lb.length})`, lb.length === 0, lb.join(" | "));
  await lv.page.keyboard.press("Escape");
  // The manager on the same live match: the cap sentences (fixture.read), no spell line.
  const lm = await open({ viewport: DESK });
  await signIn(lm.page, "manager.cockpit@example.invalid"); await openMatch(lm.page, FIELD); await coachTab(lm.page);
  ok("the team manager's live tab has the same cap sentences", (await tid(lm.page, `coach-cap-${NAIDOO}`).first().innerText({ timeout: 1500 }).catch(() => "")).trim() === "Has bowled his 4 overs");
  ok("...and no spell line against the directive", await lm.page.$$eval('[data-testid^="coach-spell-"]', (e) => e.length) === 0);
  await lm.ctx.close();
  // After the match: the spells as recorded, and the cap's past-the-cap sentence.
  await q(`update match set status = 'complete' where id = $1`, [FIELD]);
  await backTo(lv.page, "coach@example.invalid", FIELD, false);
  ok("after: the spells as the log recorded them", await tid(lv.page, "coach-spells").count() === 1, await inner(lv.page, "mc-panel-coach"));
  await openDrawer(lv.page);
  const after2 = byRule(await cards(lv.page), "S2a");
  ok("after: only the bowler who went past the cap keeps a card, and it can be marked seen", after2.length === 1 && /Bekker · 5 overs; the conditions allow 4/.test(after2[0].text) && await tid(lv.page, "signal-seen-S2a").count() === 1, JSON.stringify(after2));
  await lv.page.keyboard.press("Escape");
  ok("the live tab raised no error", lv.errors.length === 0 && lv.refusals.length === 0, [...lv.errors, ...lv.refusals].join(" | "));
  await lv.ctx.close();

  // ══ 8 · Both themes, reduced motion ═════════════════════════════════════
  group("Floodlit, and reduced motion");
  {
    const fl = await open({ viewport: PHONE, scheme: "dark", reduced: true });
    await signIn(fl.page, "coach@example.invalid");
    await openMatch(fl.page, DAY); await coachTab(fl.page);
    const f4 = await floors(fl.page);
    ok(`floodlit, phone: nothing under 12px (${f4.small.length}), nothing tapped under 44px (${f4.tiny.length})`, f4.small.length === 0 && f4.tiny.length === 0, [...f4.small, ...f4.tiny].slice(0, 4).join(" · "));
    await openDrawer(fl.page);
    const f5 = await floors(fl.page);
    ok(`floodlit drawer: nothing under 12px (${f5.small.length}), nothing tapped under 44px (${f5.tiny.length})`, f5.small.length === 0 && f5.tiny.length === 0, [...f5.small, ...f5.tiny].slice(0, 4).join(" · "));
    ok("reduced motion: no animation runs on the tab or the drawer",
       await fl.page.evaluate(() => [...document.querySelectorAll('[data-testid="mc-coach"] *, [data-testid="signals"], [data-testid="signals"] *')]
         .every((n) => getComputedStyle(n).animationName === "none" || getComputedStyle(n).animationDuration === "0s")));
    await fl.ctx.close();
  }

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

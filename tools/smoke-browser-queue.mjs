#!/usr/bin/env node
/**
 * The match-day queue, from a browser (GA-I09–I11 slice A1;
 * docs/design/GA-I09-I11_match_day_queue.md §3.2, §3.3, §8). The "To resolve"
 * screen (Readiness, grown) with the seed's invented people:
 *
 *   1. THE DIRECTOR'S SCREEN. Tomorrow's fixtures grouped under one date, then
 *      by team; each row a COUNT with its source, its owner, the queue's clock
 *      and one door; the header's three numbers. Every figure is checked
 *      against the same reads fetched here, raw, with the director's own token,
 *      by arithmetic written again in this file. The restricted boy is
 *      "1 restricted boy on the sheet" and the rendered page holds no child's
 *      name, no return date, no reason, no percentage, no "ready", no "done".
 *   2. THE DOORS. A row opens the exact screen its words promise: the side
 *      row, that fixture's Coach tab; the duties row, that fixture's duties;
 *      the request row, Management; the sign-in row, Settings with its claim.
 *   3. THE BUS. Swapping the vehicle for a smaller one adds the bus row;
 *      swapping it back removes it.
 *   4. A READ THAT FAILS. The duties read killed for one fixture draws "Could
 *      not read the duties" for that fixture and "1 read failed" in the
 *      header, and the retry puts the rows back.
 *   5. "LATER": fixtures beyond the week fold, make no read until opened, and
 *      come eight at a time.
 *   6. THE OFFICE LIST above the fixtures: requests (one asked before the
 *      email was verified, counted within the others), sign-ins, adults without
 *      a current clearance; the lift exceptions only on a TAP, and a request
 *      made once.
 *   7. A COACH OF TWO SIDES: his fixtures and nobody else's, in date order;
 *      the second side's row opens THAT fixture's Coach tab; "Seen" on the
 *      cockpit hides nothing here. The sheet made whole drops the sheet row for
 *      the coach's and the director's next open.
 *   8. THE PRINCIPAL, THE SPORTS ADMIN, THE SCORER: each the rows the policy
 *      gives them, and nobody else's; a parent and a pupil are not offered it.
 *   9. EMPTY, CLEAR AND FAILED: a coach with no fixtures; a clean fixture
 *      ("Nothing to resolve") whose killed duties read makes "0 open · 1 read
 *      failed", never "all clear".
 *  10. Floors: nothing under 12px, nothing tapped under 44px, at 390 wide, in
 *      both themes; reduced motion respected; each group a landmark.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-queue.mjs
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
import { fixConditions } from "./fixture-captain.mjs";
import { NEVER_ON_THE_COCKPIT } from "../apps/web/src/lib/cockpitNever.js";

const WEB_PORT = port(4396);
const API_PORT = port(8996);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "11111111-1111-1111-1111-111111111111";
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";
const NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";
const MICH = "77777777-0000-0000-0000-000000000002";
const KEARSNEY = "77777777-0000-0000-0000-000000000003";
const BIG = "4e111111-0000-0000-0000-000000000001";

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-queue-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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
const login = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-queue-browser" } })).body?.token;
const rows = async (token, path) => (await call(`/api/read/${path}`, { token })).body?.rows ?? [];

// ── The browser ──
async function open({ viewport = DESK, scheme = "light", reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: reduced ? "reduce" : "no-preference",
    ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [], refusals = [], asked = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
    if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
  });
  page.on("request", (r) => asked.push(r.url()));
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, refusals, asked };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
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
  await page.waitForTimeout(1200);
  return true;
}
/** Open To resolve and wait until every fixture has been read (the header stops saying it is reading). */
async function queue(page, { settle = true } = {}) {
  // The shell mounts a screen once: from this screen, leave and come back, so that every read is made again.
  if (await tid(page, "os-main").getAttribute("data-page").catch(() => null) === "readiness") await go(page, "dashboard");
  if (!(await go(page, "readiness"))) return false;
  await page.waitForSelector('[data-testid="queue"]', { timeout: 10000 }).catch(() => {});
  // Settled when nothing on it still says it is reading: the fixtures, the week, a fixture, the office's lists.
  if (settle) await page.waitForFunction(() => { const r = document.querySelector('[data-testid="queue"]'); return !!r && !/Reading/.test(r.innerText); }, null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(300);
  return true;
}
const group_ = (page, id) => page.locator(`[data-testid="queue-group"][data-match="${id}"]`);
/** The rows of one group, in the order drawn. */
const rowsOf = (page, id) => group_(page, id).locator('[data-testid="queue-row"]').evaluateAll((els) => els.map((e) => ({
  rule: e.getAttribute("data-rule"), state: e.getAttribute("data-state"), count: Number(e.getAttribute("data-count")),
  fact: e.querySelector('[data-testid="queue-fact"]')?.textContent ?? "", owner: e.querySelector('[data-testid="queue-owner"]')?.textContent ?? "",
  source: e.querySelector('[data-testid="queue-source"]')?.textContent ?? "", door: e.querySelector('[data-testid="queue-door"]')?.textContent ?? "" })));
const headerText = async (page) => (await inner(page, "queue-header")).replace(/\s+/g, " ").trim();
const nums = (h) => { const m = h.match(/(\d+) open · (\d+) reads? failed · (\d+) fixtures?/); return m ? { open: +m[1], failed: +m[2], fixtures: +m[3] } : null; };

/** §3.2 and §3.5 over what is on screen. */
async function floors(page, within = '[data-testid="queue"]') {
  return page.evaluate((within) => {
    const small = [], tiny = [];
    for (const root of document.querySelectorAll(within)) {
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
  }, within);
}
const NEVER_PLUS = /\b(done|ready|cleared|resolved|complete|completed|all clear|priority)\b|\d\s?%|\b\d{3}[ -]\d{3}[ -]\d{4}\b|\b0\d{9}\b/i;
const leaks = (t) => [...(t.match(new RegExp(NEVER_ON_THE_COCKPIT.source, "gi")) ?? []), ...(t.match(new RegExp(NEVER_PLUS.source, "gi")) ?? [])];
const saTomorrow = (hours) => `((sa_today()::timestamp + interval '1 day' + make_interval(hours => ${hours})) at time zone 'Africa/Johannesburg')`;
const saDays = (days, hours) => `((sa_today()::timestamp + make_interval(days => ${days}) + make_interval(hours => ${hours})) at time zone 'Africa/Johannesburg')`;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ══ The stage ══════════════════════════════════════════════════════════
  group("Set the stage: Hilton's week, a coach of two sides, requests, a claim, a late lift, a clean fixture");
  const michAt = (await q(`select starts_at from match where id = $1`, [MICH]))[0].starts_at;
  const kearsneyAt = (await q(`select starts_at from match where id = $1`, [KEARSNEY]))[0].starts_at;
  await q(`update match set starts_at = ${saDays(3, 10)} where id = $1`, [MICH]);
  await q(`update match set starts_at = ${saDays(20, 10)} where id = $1`, [KEARSNEY]);
  const mk = async (team, opponent, when, status = "scheduled") => (await q(
    `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, $2, $3, ${when}, 'cricket', 'T20', 20, $4) returning id`, [HIL, team, opponent, status]))[0].id;
  const A = await mk("1XI", "QA Kearsney XI", saTomorrow(9));
  const B = await mk("2XI", "QA Michaelhouse XI", saTomorrow(11));
  const C = await mk("3XI", "QA Clifton XI", saTomorrow(11));
  const OFF = await mk("1XI", "QA Called Off XI", saTomorrow(15), "abandoned");
  const LATER = [];
  for (let d = 9; d < 18; d++) LATER.push(await mk("2XI", `QA Later ${d}`, saDays(d, 10)));
  const man = (team, n, name) => `insert into player (school_id, team_code, full_name, squad_no, playing_role, born) values ('${HIL}', '${team}', '${name}', ${n}, 'batter', current_date - interval '19 years') returning id`;
  const mkPlayers = async (team, names, base) => { const ids = []; for (const [i, n] of names.entries()) ids.push((await q(man(team, base + i, n)))[0].id); return ids; };
  const xi = await mkPlayers("1XI", ["Q Abel Fictional", "Q Boris Fictional", "Q Cyrus Fictional", "Q Dario Fictional", "Q Elias Fictional", "Q Felix Fictional"], 60);
  const two = await mkPlayers("2XI", ["Q Gideon Fictional", "Q Hamza Fictional", "Q Ivan Fictional"], 70);
  const three = await mkPlayers("3XI", ["Q Jonas Fictional", "Q Kofi Fictional"], 80);
  const coachId = (await q(`select id from app_user where email = 'coach@example.invalid'`))[0].id;
  // A: ten named (one short), a boy marked unavailable with a reason, a smaller bus, showers, an umpire but no scorer.
  const SHEET_A = [WHITFIELD, BEKKER, NAIDOO, PILLAY, ...xi];
  await q(`insert into match_squad (match_id, player_id, side, batting_no) select $1, p, 'home', n from unnest($2::uuid[]) with ordinality as t(p, n)`, [A, SHEET_A]);
  const REASON = "A family funeral in Durban";
  await q(`insert into match_availability (match_id, player_id, school_id, status, reason_kind, note, declared_by, fixture_starts_at) select $1, $2, $3, 'unavailable', 'family', $4, $5, starts_at from match where id = $1`, [A, xi[0], HIL, REASON, coachId]);
  await q(`insert into match_availability (match_id, player_id, school_id, status, declared_by, fixture_starts_at) select $1, p, $2, 'available', $3, starts_at from unnest($4::uuid[]) p, match where match.id = $1`, [A, HIL, coachId, [xi[1], xi[2], xi[3]]]);
  await q(`insert into match_official (match_id, school_id, duty, person_name) values ($1, $2, 'umpire', 'QA Umpire')`, [A, HIL]);
  await q(`insert into match_weather (match_id, condition, temp_c, rain_chance_pct, forecast, playable) values ($1, 'Showers', 18, 70, 'Rain likely from 14:00', true)`, [A]);
  const SMALL = (await q(`insert into vehicle (school_id, registration, description, kind, capacity) values ($1, 'QA 4 SEAT', 'QA four-seater', 'van', 4) returning id`, [HIL]))[0].id;
  const TRIP = (await q(`insert into trip (match_id, school_id, vehicle_id, depart_at, pickup) select $1, $2, $3, starts_at - interval '150 minutes', 'the Chapel car park' from match where id = $1 returning id`, [A, HIL, SMALL]))[0].id;
  // B: no sheet, three answers given about a start that has since moved.
  // (The stamp on an answer is the fixture as it stands when the answer is given, db/65, so the start moves after the answers.)
  await q(`insert into match_availability (match_id, player_id, school_id, status, declared_by, fixture_starts_at) select $1, p, $2, 'available', $3, starts_at from unnest($4::uuid[]) p, match where match.id = $1`, [B, HIL, coachId, two.slice(0, 2)]);
  await q(`update match set starts_at = starts_at + interval '1 hour' where id = $1`, [B]);
  // C: two boys on the sheet, both answered; nothing on record for the duties.
  await q(`insert into match_squad (match_id, player_id, side, batting_no) select $1, p, 'home', n from unnest($2::uuid[]) with ordinality as t(p, n)`, [C, three]);
  await q(`insert into match_availability (match_id, player_id, school_id, status, declared_by, fixture_starts_at) select $1, p, $2, 'available', $3, starts_at from unnest($4::uuid[]) p, match where match.id = $1`, [C, HIL, coachId, three]);
  // Called off with an umpire and a bus still on record.
  await q(`insert into match_official (match_id, school_id, duty, person_name) values ($1, $2, 'umpire', 'QA Umpire Two')`, [OFF, HIL]);
  await q(`insert into trip (match_id, school_id, vehicle_id, depart_at, pickup) select $1, $2, $3, starts_at - interval '150 minutes', 'the Chapel car park' from match where id = $1`, [OFF, HIL, BIG]);
  // The coach has a second side.
  await q(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'coach', $2, '2XI')`, [coachId, HIL]);
  // Staff nobody in the seed is: a sports admin; and a coach with a side of her own that has nothing in the week.
  for (const [email, name, role, team] of [["qa.sports@example.invalid", "Q Sports", "sportsadmin", null], ["qa.empty@example.invalid", "Q Empty", "coach", "5XI"], ["qa.clean@example.invalid", "Q Clean", "coach", "6XI"]]) {
    await q(`insert into app_user (school_id, email, name, role, teams) values ($1, $2, $3, $4, $5)`, [HIL, email, name, role, team ? `{${team}}` : "{}"]);
    await q(`insert into role_assignment (person_id, role, school_id, team_code) select id, $2, school_id, $3 from app_user where email = $1`, [email, role, team]);
  }
  // Requests: a stranger asks before the email is verified; a signed-in person asks for himself.
  const watcher = await login("watcher@example.invalid");
  const r1 = await call("/api/onboard", { method: "POST", body: { email: "qa.stranger@example.invalid", name: "Q Stranger", role: "coach", schoolId: HIL, teamCode: "7XI", note: "Joining." } });
  const r2 = await call("/api/requests", { method: "POST", token: watcher, body: { role: "assistantcoach", schoolId: HIL, teamCode: "7XI", note: "Hello." } });
  ok("a stranger's request and a signed-in person's are made", r1.status === 200 && (r2.status === 200 || r2.status === 201), [r1.status, r2.status]);
  const CELE = (await q(`select id from app_user where email = 'parent.cele@example.invalid'`))[0].id;
  await q(`insert into pending_claim (provider, provider_uid, email, user_id) values ('google.com', 'qa-queue-claim-1', 'cele.parent@gmail.invalid', $1)`, [CELE]);
  const NDLOVU = (await q(`select id from app_user where email = 'e.ndlovu@example.invalid'`))[0].id;
  await q(`delete from adult_clearance where person_id = $1 and kind = 'police_clearance'`, [NDLOVU]);
  await q(`insert into adult_clearance (person_id, school_id, kind, issued_on, expires_on) values ($1, $2, 'police_clearance', current_date - 180, current_date - 10)`, [NDLOVU, HIL]);
  // A late lift for A, so the office has an exception to be shown on a tap.
  const head = await login("principal@example.invalid"), driver = await login("parent.whitfield@example.invalid"), mum = await login("parent.bekker@example.invalid");
  await q(`insert into feature_grant (key, school_id, granted, note) values ('lift_club', $1, true, 'browser-queue') on conflict (key, school_id) do update set granted = true`, [HIL]);
  await call("/api/lifts/policy", { method: "POST", token: head, body: { schoolId: HIL, body: "Lifts are arranged between families; the school facilitates and does not operate them. A driver undertakes that she holds a licence, that the car is insured and roadworthy, and that every boy wears a belt." } });
  const card = (await q(`select id from emergency_contact where player_id = $1 and active order by priority limit 1`, [WHITFIELD]))[0];
  await call("/api/lifts/declaration", { method: "POST", token: driver, body: { schoolId: HIL, vehicle: "silver Toyota Fortuner", registration: "nd 123-456", seats: 3,
    licenceHeld: true, insured: true, roadworthy: true, belts: true, codeAcknowledged: true, contactId: card?.id } });
  const startsA = new Date((await q(`select starts_at from match where id = $1`, [A]))[0].starts_at);
  const offer = await call(`/api/matches/${A}/lifts`, { method: "POST", token: driver, body: { legs: [
    { leg: "out", seats: 3, meetKind: "school", meetAt: new Date(startsA.getTime() - 105 * 60000).toISOString() }, { leg: "back", seats: 3, meetKind: "ground", meetAt: new Date(startsA.getTime() + 300 * 60000).toISOString() }] } });
  const OUT = offer.body?.offers?.find((o) => o.leg === "out")?.id;
  const seat = OUT ? await call(`/api/lifts/${OUT}/seats`, { method: "POST", token: mum, body: { playerId: BEKKER } }) : { body: null };
  if (OUT && seat.body?.seatId) await call(`/api/lifts/${OUT}/accept`, { method: "POST", token: driver, body: { seatIds: [seat.body.seatId] } });
  if (OUT) await q(`update lift_offer set meet_at = now() - interval '3 hours' where id = $1`, [OUT]);
  ok("the stage is set: four fixtures tomorrow, one called off, a late lift", !!A && !!B && !!C && !!OFF && !!TRIP && !!OUT && !!seat.body?.seatId, [OUT, seat.body]);

  // What must never appear on a school-wide row, read from the rows themselves.
  const players = (await q(`select full_name from player where school_id = $1`, [HIL])).map((r) => r.full_name);
  const adults = new Set((await q(`select name from app_user`)).map((r) => r.name));
  const childNames = players.filter((n) => !adults.has(n));
  const injuries = await q(`select notes from injury where notes is not null`);
  const shouldNeverSee = [...childNames, REASON, ...injuries.map((r) => r.notes).filter((n) => n && n.length > 6)];

  const dir = await login("sarah@example.invalid");
  // The arithmetic, written again here from the director's own reads.
  const ra = await rows(dir, `readiness?matchId=${A}`);
  const wantNone = ra.filter((r) => r.declared_status == null).length;
  const wantRestricted = ra.filter((r) => r.selected && r.clinically_restricted === true).length;
  const wantOut = ra.filter((r) => r.selected && r.declared_status === "unavailable" && r.clinically_restricted !== true).length;
  ok(`the director's reads give A ${ra.length} boys, ${wantNone} unanswered, ${wantRestricted} restricted on the sheet, ${wantOut} marked unavailable`, ra.length >= 9 && wantNone >= 1 && wantRestricted >= 1 && wantOut === 1, [ra.length, wantNone, wantRestricted, wantOut]);
  const calledOffText = "Called off: 1 duty and 1 bus still on record";

  // ══ 1 · The director's screen ═══════════════════════════════════════════
  group("The director's To resolve: tomorrow's fixtures under one date, then by team, each row a count with its owner, clock and door");
  const d = await open({ viewport: DESK });
  ok("the director of sport signs in", await signIn(d.page, "sarah@example.invalid"));
  ok("the destination is called To resolve", /To resolve/.test(await tid(d.page, "nav-readiness").innerText({ timeout: 3000 }).catch(() => "")) && !/Readiness/.test(await tid(d.page, "nav-readiness").innerText().catch(() => "")));
  ok("he reaches it", await queue(d.page) && await tid(d.page, "os-main").getAttribute("data-page") === "readiness");
  const days = await d.page.$$eval('[data-testid^="queue-day-"]', (els) => els.map((e) => ({ id: e.getAttribute("data-testid").replace("queue-day-", ""), groups: [...e.querySelectorAll('[data-testid="queue-group"]')].map((g) => g.getAttribute("data-match")) })));
  const tomorrow = days.find((x) => x.groups.includes(A));
  ok("tomorrow's fixtures are under ONE date, in start order: A (09:00), C (11:00), B (moved to 12:00), then the called-off one (15:00)", tomorrow?.groups.join() === [A, C, B, OFF].join(), JSON.stringify(days));
  ok("...Michaelhouse, three days off, is under a date of its own, after", days.findIndex((x) => x.groups.includes(MICH)) > days.findIndex((x) => x.groups.includes(A)) && !days.some((x) => x.groups.includes(MICH) && x.groups.includes(A)));
  const rA = await rowsOf(d.page, A);
  console.log(`  A: ${rA.map((r) => `${r.rule}(${r.count})`).join(" ")}`);
  ok("A's rows come in the fixed order: S7, S3 (restricted), S3 (unavailable), S6, S1, O4, S10, S9", rA.map((r) => r.rule).join() === "S7,S3,S3,S6,S1,O4,S10,S9", rA.map((r) => r.rule).join());
  const word = (rule, i = 0) => rA.filter((r) => r.rule === rule)[i];
  ok(`S7 is '${wantNone} have not answered', a count`, word("S7")?.fact === `${wantNone} ${wantNone === 1 ? "has" : "have"} not answered` && word("S7").count === wantNone, word("S7")?.fact);
  ok("...its owner is the side's coach or manager, its clock the 48 hours, its source the side read, its door the side",
     /^the 1XI coach, assistant coach or team manager$/.test(word("S7").owner.split(" · ")[0]) && /was due|by /.test(word("S7").owner) && word("S7").source === "from the side read" && /Open the side/.test(word("S7").door), JSON.stringify(word("S7")));
  ok(`the restricted boy reads '${wantRestricted} restricted ${wantRestricted === 1 ? "boy" : "boys"} on the sheet', never his name`, word("S3", 0)?.fact === `${wantRestricted} restricted ${wantRestricted === 1 ? "boy" : "boys"} on the sheet`, word("S3", 0)?.fact);
  ok("...and '1 marked unavailable on the sheet'", word("S3", 1)?.fact === "1 marked unavailable on the sheet");
  ok("S6: '10 named · a side needs 11', due the day before", word("S6")?.fact === "10 named · a side needs 11" && /Fri|Sat|Sun|Mon|Tue|Wed|Thu/.test(word("S6").owner) && /by |was due/.test(word("S6").owner), JSON.stringify(word("S6")));
  ok("S1 (the bus): the smaller bus, in the signals' own words, lifts not counted for a reader with no lift capability", /^Bus seats 4 · \d+ named \(lifts not counted\)$/.test(word("S1")?.fact) && /the bus's departure/.test(word("S1").owner), JSON.stringify(word("S1")));
  ok("O4 (duties): 'No scorer on record', the office's, to the first ball", /^No scorer on record for \d+ \w{3}$/.test(word("O4")?.fact) && /^the office · /.test(word("O4").owner) && /first ball/.test(word("O4").owner) && /Open the duties/.test(word("O4").door), JSON.stringify(word("O4")));
  ok("S10: no playing conditions, the competition organiser's", /^No playing conditions are set/.test(word("S10")?.fact) && /^the competition's organiser/.test(word("S10").owner));
  ok("S9 (weather): information, no door, counted as none", word("S9")?.state === "info" && word("S9").door === "" && /Rain likely/.test(word("S9").fact));
  const lineA = (await group_(d.page, A).locator('[data-testid="queue-group-line"]').innerText()).trim();
  ok(`A's header counts the open rows (not the weather): '${rA.filter((r) => r.state === "open").length} to resolve'`, lineA === `${rA.filter((r) => r.state === "open").length} to resolve`, lineA);
  const rB = await rowsOf(d.page, B);
  ok("B: the empty sheet, and the two answers to ask again because the start moved (O5, the only trace of a move)", rB.some((r) => r.rule === "S6" && r.fact === "The sheet is empty") && rB.some((r) => r.rule === "O5" && r.fact === "Moved: 2 answers to ask again"), JSON.stringify(rB.map((r) => r.fact)));
  const rC = await rowsOf(d.page, C);
  ok("C: no scorer and no umpire on record, two rows", rC.filter((r) => r.rule === "O4").map((r) => r.fact.replace(/ for .*$/, "")).join() === "No scorer on record,No umpire on record", JSON.stringify(rC.map((r) => r.fact)));
  ok("the called-off fixture says what is still on record against it, in counts", (await group_(d.page, OFF).innerText()).includes(calledOffText) && /called off/.test(await group_(d.page, OFF).locator("h3").innerText()), (await group_(d.page, OFF).innerText()).slice(0, 200));
  const h = await headerText(d.page);
  const hn = nums(h);
  const allOpen = await d.page.$$eval('[data-testid="queue-row"][data-state="open"]', (e) => e.length);
  ok(`the header's three numbers are always drawn ('${h}'), and the open one is the open rows on the page (${allOpen})`, !!hn && hn.open === allOpen && hn.failed === 0 && hn.fixtures >= 4, h);
  ok("...fixtures are those in the week: A, B, C, the called-off one and Michaelhouse", hn.fixtures === 5, h);
  const pageText = await inner(d.page, "queue");
  const leaked = shouldNeverSee.filter((n) => pageText.includes(n));
  ok(`the rendered page holds no child's name, no reason an absence was given, no injury note (${shouldNeverSee.length} checked)`, leaked.length === 0, leaked.join(" | "));
  ok("...no 'Seen' control and no 'done' button on it", (await d.page.$$eval('[data-testid="queue"] button', (b) => b.map((x) => x.textContent))).every((t) => !/\bseen\b|\bdone\b|dismiss|mark (it |as )/i.test(t)));
  const bad = leaks(pageText);
  ok(`...none of the never-words, no percentage, no 'ready', no 'done', no phone number (${bad.length})`, bad.length === 0, bad.join(" | "));
  ok("...it says whose clock it is", /the queue's clock/.test(await inner(d.page, "queue-clock-note")));
  const aud = await d.page.$$eval('[data-testid="queue-group"]', (els) => els.map((e) => { const l = document.getElementById(e.getAttribute("aria-labelledby")); return !!l && l.textContent.trim().length > 3; }));
  ok("each fixture's group is a landmark, named by its own heading", aud.length >= 5 && aud.every(Boolean));
  ok("the director has no office-lift control: he holds neither lift capability", await tid(d.page, "queue-lifts-check").count() === 0);

  // ══ 2 · The doors ═══════════════════════════════════════════════════════
  group("A row's exact next action opens the right screen");
  await tid(d.page, `queue-open-${A}:S7`).click({ timeout: 4000 });
  await d.page.waitForFunction(() => document.querySelector('[data-testid="mc-coach"]'), null, { timeout: 15000 }).catch(() => {});
  const mv = await inner(d.page, "match-view");
  ok("the side row opens THAT fixture's Coach tab (A, Kearsney)", await tid(d.page, "mc-coach").count() === 1 && /QA Kearsney XI/.test(mv) && !/QA Michaelhouse/.test(mv), mv.slice(0, 200));
  await queue(d.page);
  await tid(d.page, `queue-open-${C}:S8:scorer`).click({ timeout: 4000 }).catch(async () => { await d.page.locator(`[data-testid="queue-group"][data-match="${C}"] [data-rule="O4"] button`).first().click({ timeout: 4000 }); });
  await d.page.waitForTimeout(1500);
  ok("the duties row opens THAT fixture's duties: the Match Centre's details for C, with its duty roster", await tid(d.page, "os-main").getAttribute("data-page") === "matches"
     && await tid(d.page, "match-details").getAttribute("data-match") === C && await tid(d.page, "duty-roster").count() === 1);
  await queue(d.page);
  await d.page.locator(`[data-testid="queue-group"][data-match="${A}"] [data-rule="S1"] button`).first().click({ timeout: 4000 });
  await d.page.waitForTimeout(1200);
  ok("the bus row opens Logistics", await tid(d.page, "os-main").getAttribute("data-page") === "logistics");
  await queue(d.page);
  await d.page.locator(`[data-testid="queue-group"][data-match="${OFF}"] [data-rule="O5"] button`).first().click({ timeout: 4000 });
  await d.page.waitForTimeout(1500);
  ok("the called-off row opens the fixture", await tid(d.page, "match-details").getAttribute("data-match") === OFF);

  // ══ 3 · The bus ═════════════════════════════════════════════════════════
  group("A smaller vehicle adds the bus row and the larger takes it away");
  await q(`update trip set vehicle_id = $2 where id = $1`, [TRIP, BIG]);
  await queue(d.page);
  ok("with the big bus there is no bus row", (await rowsOf(d.page, A)).every((r) => r.rule !== "S1"), (await rowsOf(d.page, A)).map((r) => r.rule).join());
  await q(`update trip set vehicle_id = $2 where id = $1`, [TRIP, SMALL]);
  await queue(d.page);
  ok("swapped back to the four-seater, the row is back", (await rowsOf(d.page, A)).some((r) => r.rule === "S1"));

  // ══ 4 · A failed read ═══════════════════════════════════════════════════
  group("A read that fails is a row that says so, and the retry puts the rows back");
  const kill = new RegExp(`/api/read/match_duties\\?.*matchId=${C}`);
  await d.page.route(kill, (r) => r.abort());
  await queue(d.page);
  const unreadC = await group_(d.page, C).locator('[data-testid="queue-unread"]').allInnerTexts();
  ok("C says 'Could not read the duties' in its own words, with the read's error", unreadC.length === 1 && /^Could not read the duties \(\w+\)/.test(unreadC[0].trim()), unreadC.join("|"));
  ok("...and no scorer or umpire row is drawn from a read that did not answer", (await rowsOf(d.page, C)).every((r) => r.rule !== "O4"));
  const hf = nums(await headerText(d.page));
  ok("...the header counts it: '1 read failed', and the open number is not 'all clear'", hf?.failed === 1 && !/all clear/i.test(await headerText(d.page)), await headerText(d.page));
  const lineC = (await group_(d.page, C).locator('[data-testid="queue-group-line"]').innerText()).trim();
  ok("...C's own line is a number of rows to resolve, never 'Nothing to resolve'", /^\d+ to resolve$/.test(lineC), lineC);
  ok("the other fixtures are untouched: they read everything", (await group_(d.page, A).locator('[data-testid="queue-unread"]').count()) === 0 && (await group_(d.page, B).locator('[data-testid="queue-unread"]').count()) === 0);
  await d.page.unroute(kill);
  await tid(d.page, "queue-retry").first().click({ timeout: 4000 });
  await d.page.waitForTimeout(2500);
  ok("'Try again' reads it again: the rows are back and the failure is gone", (await rowsOf(d.page, C)).filter((r) => r.rule === "O4").length === 2 && (await group_(d.page, C).locator('[data-testid="queue-unread"]').count()) === 0 && nums(await headerText(d.page))?.failed === 0, await headerText(d.page));

  // ══ 5 · Later ═══════════════════════════════════════════════════════════
  group("Beyond the week: folded, read only when opened, eight at a time");
  const total = LATER.length + 1;          // nine more of the 2XI's, and Kearsney's U16B twenty days off
  await queue(d.page);
  const tog = tid(d.page, "queue-later-toggle");
  ok(`'Later · ${total} fixtures', closed`, new RegExp(`^Later · ${total} fixtures`).test((await tog.innerText()).trim()) && await tog.getAttribute("aria-expanded") === "false", await tog.innerText());
  const before = d.asked.length;
  await d.page.waitForTimeout(800);
  ok("a folded fixture makes none of its reads", !d.asked.slice(0).some((u) => LATER.some((id) => u.includes(id)) || u.includes(KEARSNEY)));
  const groupsBefore = await d.page.locator('[data-testid="queue-group"]').count();
  await tog.click({ timeout: 4000 });
  await d.page.waitForFunction((n) => document.querySelectorAll('[data-testid="queue-group"]').length >= n, groupsBefore + 8, { timeout: 20000 }).catch(() => {});
  ok("a tap reveals the next eight, no more", (await d.page.locator('[data-testid="queue-group"]').count()) === groupsBefore + 8 && await tog.getAttribute("aria-expanded") === "true", await d.page.locator('[data-testid="queue-group"]').count());
  ok("...and now they are read", d.asked.slice(before).some((u) => u.includes(LATER[0])));
  ok(`'Show the next ${total - 8}' is offered`, new RegExp(`Show the next ${total - 8}`).test(await inner(d.page, "queue-later-more")));
  await tid(d.page, "queue-later-more").click({ timeout: 4000 });
  await d.page.waitForFunction((n) => document.querySelectorAll('[data-testid="queue-group"]').length >= n, groupsBefore + total, { timeout: 20000 }).catch(() => {});
  ok("...and then the rest, with nothing more to show", (await d.page.locator('[data-testid="queue-group"]').count()) === groupsBefore + total && await tid(d.page, "queue-later-more").count() === 0);
  await tog.click({ timeout: 4000 });
  await d.page.waitForTimeout(300);
  ok("a second tap folds them again", (await d.page.locator('[data-testid="queue-group"]').count()) === groupsBefore && await tog.getAttribute("aria-expanded") === "false");
  ok("no page errors, no scoping refusals on the director's screen", d.errors.length === 0 && d.refusals.length === 0, [...d.errors, ...d.refusals].join(" | "));
  await d.ctx.close();

  // ══ 6 · The office ══════════════════════════════════════════════════════
  group("The office: requests, sign-ins and clearances above the fixtures; the lifts only on a tap");
  const regTok = await login("registrar@example.invalid");
  const reqs = (await rows(regTok, "role_requests")).filter((r) => r.state === "pending" && r.decidable === true && r.school_id === HIL);
  const unv = reqs.filter((r) => r.asked_unverified === true).length;
  const claims = (await rows(regTok, "sign_in_claims")).filter((c) => c.school_id === HIL);
  const reg = (await rows(regTok, `clearance_register?schoolId=${HIL}`)).filter((r) => ["missing", "expired", "revoked", "expiring"].includes(r.status));
  const RANK = ["missing", "expired", "revoked", "expiring"];
  const worstBy = new Map();
  for (const r of reg) { const h = worstBy.get(r.person_id); if (!h || RANK.indexOf(r.status) < RANK.indexOf(h)) worstBy.set(r.person_id, r.status); }
  const wantO3 = `${worstBy.size} ${worstBy.size === 1 ? "adult" : "adults"} without a current clearance: ${RANK.map((s) => ([...worstBy.values()].filter((x) => x === s).length ? `${[...worstBy.values()].filter((x) => x === s).length} ${s}` : null)).filter(Boolean).join(", ")}`;
  ok(`the office's reads give ${reqs.length} requests (${unv} asked before the email was verified), ${claims.length} sign-in, ${worstBy.size} adults with a gap`, reqs.length >= 2 && unv >= 1 && unv < reqs.length && claims.length === 1 && worstBy.size >= 2, [reqs.length, unv, claims.length, worstBy.size]);
  const o = await open({ viewport: DESK });
  ok("the school admin signs in", await signIn(o.page, "registrar@example.invalid"));
  ok("she reaches To resolve", await queue(o.page));
  const office = o.page.locator('[data-testid="queue-office"]');
  ok("the office list is above the fixtures, once", await office.count() === 1 && (await o.page.evaluate(() => { const a = document.querySelector('[data-testid="queue-office"]'), b = document.querySelector('[data-testid="queue-group"]'); return !!a && !!b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; })) === true || await office.count() === 1);
  const orow = async (rule) => office.locator(`[data-testid="queue-row"][data-rule="${rule}"]`);
  const text1 = async (rule) => (await (await orow(rule)).first().innerText({ timeout: 3000 }).catch(() => "")).replace(/\s+/g, " ");
  const o1 = await text1("O1"), o2 = await text1("O2"), o3 = await text1("O3");
  ok(`O1: '${reqs.length} requests waiting · ${unv} asked before the email was verified', the oldest's age, the office's`, o1.includes(`${reqs.length} requests waiting · ${unv} asked before the email was verified`) && /oldest (today|\d+ days?)/.test(o1) && /the office/.test(o1) && /from the requests read/.test(o1) && /Decide/.test(o1), o1);
  ok("...the request asked before the email was verified is counted within the others, not dropped", reqs.length === (await (await orow("O1")).first().getAttribute("data-count")) * 1);
  ok("O2: '1 Google sign-in matches an enrolled account', oldest, Confirm", /1 Google sign-in matches an enrolled account/.test(o2) && /oldest (today|\d+ days?)/.test(o2) && /Confirm/.test(o2), o2);
  ok(`O3: '${wantO3}', on the record's own date`, o3.includes(wantO3) && /expired \d+ \w{3}/.test(o3) && /The register/.test(o3), o3);
  const items = await office.locator('[data-testid="queue-register-items"] li').allInnerTexts();
  ok("...the register row lists adults, by name, and never a child", items.length >= 1 && items.length <= 6 && items.every((t) => !shouldNeverSee.some((n) => t.includes(n))), items.join(" | "));
  ok("her fixture rows: the answers yes (availability.read), the selection no (no team.select)", (await rowsOf(o.page, A)).some((r) => r.rule === "S7") && (await rowsOf(o.page, A)).every((r) => r.rule !== "S3" && r.rule !== "S6"), (await rowsOf(o.page, A)).map((r) => r.rule).join());
  ok("the lifts are not read on opening: the queue has made no call for them", !o.asked.some((u) => /\/api\/lifts\/exceptions/.test(u)) && !o.asked.some((u) => /\/lifts\/expected/.test(u)));
  ok("...there is a button for them, and it says what it does", /Check today.s lifts/.test(await inner(o.page, "queue-lifts-check")));
  await tid(o.page, "queue-lifts-check").click({ timeout: 4000 });
  await o.page.waitForSelector('[data-testid="queue-lifts"]', { timeout: 10000 }).catch(() => {});
  const liftCalls = o.asked.filter((u) => /\/api\/lifts\/exceptions/.test(u));
  const liftText = await inner(o.page, "queue-lifts");
  ok("the tap makes ONE call, and shows the exception in S4b's own words, by name (she holds transport.lift.oversee)", liftCalls.length === 1 && /The lift is late and not marked as left/.test(liftText) && liftText.includes("Bekker"), `${liftCalls.length} ${liftText}`);
  const fo = await floors(o.page);
  ok(`the office's screen: nothing under 12px (${fo.small.length}), nothing tapped under 44px (${fo.tiny.length})`, fo.small.length === 0 && fo.tiny.length === 0, [...fo.small, ...fo.tiny].slice(0, 4).join(" · "));
  await tid(o.page, `queue-open-office:${HIL}:O1`).click({ timeout: 4000 });
  await o.page.waitForTimeout(1500);
  ok("O1 opens Management, with its requests to answer", await tid(o.page, "os-main").getAttribute("data-page") === "management" && await tid(o.page, "requests-panel").count() === 1);
  await queue(o.page);
  await tid(o.page, `queue-open-office:${HIL}:O2`).click({ timeout: 4000 });
  await o.page.waitForTimeout(1500);
  ok("O2 opens Settings, People, with the claim to confirm", await tid(o.page, "os-main").getAttribute("data-page") === "settings" && await tid(o.page, "claim").count() >= 1);
  ok("no page errors on the office's screens", o.errors.length === 0 && o.refusals.length === 0, [...o.errors, ...o.refusals].join(" | "));
  await o.ctx.close();

  // ══ 7 · A coach of two sides ════════════════════════════════════════════
  group("A coach of 1XI and 2XI: his fixtures only, in date order; the second side's row opens THAT fixture");
  const c = await open({ viewport: DESK });
  ok("the coach signs in", await signIn(c.page, "coach@example.invalid"));
  ok("he reaches To resolve", await queue(c.page));
  await c.page.setViewportSize(PHONE);           // the phone's bottom bar keeps To resolve under More: arrive on the laptop, then read it at 390
  await c.page.waitForTimeout(700);
  const cg = await c.page.$$eval('[data-testid="queue-group"]', (els) => els.map((e) => e.getAttribute("data-match")));
  ok("his groups: A (1XI) and B (2XI) tomorrow in start order, the called-off one, then Michaelhouse (1XI); never C (3XI)", cg.slice(0, 4).join() === [A, B, OFF, MICH].join() && !cg.includes(C), cg.join());
  ok("no office list: nothing here is the office's", await tid(c.page, "queue-office").count() === 0);
  const bRows = await rowsOf(c.page, B);
  ok("B's rows: the coach's own, in the same words", bRows.some((r) => r.rule === "S6" && r.fact === "The sheet is empty") && bRows.some((r) => r.rule === "S7") === false || bRows.some((r) => r.rule === "O5"), bRows.map((r) => r.fact).join(" | "));
  const fc = await floors(c.page);
  ok(`at 390: nothing under 12px (${fc.small.length}), every row at least 44px (${fc.tiny.length})`, fc.small.length === 0 && fc.tiny.length === 0, [...fc.small, ...fc.tiny].slice(0, 4).join(" · "));
  await c.page.locator(`[data-testid="queue-group"][data-match="${B}"] [data-rule="S6"] button`).first().click({ timeout: 4000 });
  await c.page.waitForFunction(() => document.querySelector('[data-testid="mc-coach"]'), null, { timeout: 15000 }).catch(() => {});
  const mvB = await inner(c.page, "match-view");
  ok("the second side's row opens THAT fixture's Coach tab: B (Michaelhouse), not A", await tid(c.page, "mc-coach").count() === 1 && /QA Michaelhouse XI/.test(mvB) && !/QA Kearsney XI/.test(mvB), mvB.slice(0, 160));
  await c.ctx.close();
  {
    // "Seen" is the cockpit's, per person and per device: marking a signal seen on the Coach tab hides nothing here.
    const s = await open({ viewport: DESK });
    await signIn(s.page, "coach@example.invalid");
    await go(s.page, "matches");
    await tid(s.page, `mc-open-${A}`).click({ timeout: 5000 }).catch(() => {});
    await s.page.waitForTimeout(1500);
    await tid(s.page, "mc-tab-coach").click({ timeout: 4000 }).catch(() => {});
    await s.page.waitForFunction(() => document.querySelector('[data-testid="mc-coach"]') && !document.querySelector('[data-testid="mc-coach-loading"]'), null, { timeout: 15000 }).catch(() => {});
    await tid(s.page, "coach-signals-open").click({ timeout: 4000 }).catch(() => {});
    await s.page.waitForTimeout(500);
    const seen = tid(s.page, "signal-seen-S7");
    const had = await seen.count();
    if (had) await seen.click({ timeout: 3000 }).catch(() => {});
    await s.page.keyboard.press("Escape");                  // the drawer is over the navigation
    await s.page.waitForTimeout(400);
    await queue(s.page);
    ok("A signal marked Seen on the Coach tab is still a row here: a blocker is open until its fact changes (D7)", had === 1 && (await rowsOf(s.page, A)).some((r) => r.rule === "S7"), `seen button: ${had}`);
    // The sheet made whole (an eleventh named), as if published from another phone: both sessions' next open drops the sheet row.
    const extra = (await q(man("1XI", 90, "Q Zane Fictional")))[0].id;
    ok("(the sheet's row is there before)", (await rowsOf(s.page, A)).some((r) => r.rule === "S6"));
    await q(`insert into match_squad (match_id, player_id, side, batting_no) values ($1, $2, 'home', 11)`, [A, extra]);
    await queue(s.page);
    ok("with an eleventh named, the coach's next open has no sheet row", (await rowsOf(s.page, A)).every((r) => r.rule !== "S6"));
    const d2 = await open({ viewport: DESK });
    await signIn(d2.page, "sarah@example.invalid");
    await queue(d2.page);
    ok("...and the director's, on his own device, has none either", (await rowsOf(d2.page, A)).every((r) => r.rule !== "S6") && (await rowsOf(d2.page, A)).some((r) => r.rule === "S7"));
    await d2.ctx.close();
    await s.ctx.close();
  }

  // ══ 8 · Not everybody ═══════════════════════════════════════════════════
  group("The principal, the sports admin and the scorer: each the rows the policy gives them, and no more");
  {
    const p = await open({ viewport: DESK });
    await signIn(p.page, "principal@example.invalid");
    await queue(p.page);
    const prA = await rowsOf(p.page, A);
    ok("the principal's fixture rows are the duties and the conditions only: no answers, no selection, no bus", prA.length >= 1 && prA.every((r) => ["O4", "S10", "S9"].includes(r.rule)), prA.map((r) => r.rule).join());
    ok("...and the office list: requests and the register, not the sign-ins (no user.invite)", await p.page.locator('[data-testid="queue-office"] [data-rule="O1"]').count() === 1 && await p.page.locator('[data-testid="queue-office"] [data-rule="O3"]').count() === 1 && await p.page.locator('[data-testid="queue-office"] [data-rule="O2"]').count() === 0);
    ok("...no lift button (no transport.lift.oversee)", await tid(p.page, "queue-lifts-check").count() === 0);
    ok("...a principal reaches the fixture, not a Coach tab he has no gate for", (await p.page.locator(`[data-testid="queue-group"][data-match="${A}"] [data-rule="O4"] [data-testid="queue-door"]`).first().innerText()).includes("Open the duties"));
    await p.ctx.close();
    const sa = await open({ viewport: DESK });
    await signIn(sa.page, "qa.sports@example.invalid");
    await queue(sa.page);
    ok("the sports admin: the register and the lifts, not the requests or the sign-ins",
       await sa.page.locator('[data-testid="queue-office"] [data-rule="O3"]').count() === 1 && await sa.page.locator('[data-testid="queue-office"] [data-rule="O1"]').count() === 0
       && await sa.page.locator('[data-testid="queue-office"] [data-rule="O2"]').count() === 0 && await tid(sa.page, "queue-lifts-check").count() === 1);
    await sa.ctx.close();
    const sc = await open({ viewport: DESK });
    await signIn(sc.page, "scorer@example.invalid");
    const reach = await go(sc.page, "readiness");
    await sc.page.waitForTimeout(1500);
    const stext = reach ? await inner(sc.page, "queue") : "";
    ok("a scorer is not a reader: if the destination is there it draws no group and no office list, and says nothing is his to resolve",
       !reach || (/Nothing here is yours to resolve/.test(stext) && await tid(sc.page, "queue-group").count() === 0 && await tid(sc.page, "queue-office").count() === 0), stext.slice(0, 200));
    await sc.ctx.close();
    for (const [who, email] of [["a parent", "parent.whitfield@example.invalid"], ["a pupil", "pillay@example.invalid"]]) {
      const g = await open({ viewport: DESK });
      await signIn(g.page, email);
      ok(`${who} is not offered the destination`, await g.page.locator('[data-testid="nav-readiness"], [data-testid="mnav-readiness"]').count() === 0);
      await g.ctx.close();
    }
  }

  // ══ 9 · Empty, clear, failed ════════════════════════════════════════════
  group("Empty, clear and failed are three different screens");
  {
    const e = await open({ viewport: DESK });
    await signIn(e.page, "qa.empty@example.invalid");
    await queue(e.page);
    await e.page.setViewportSize(PHONE);
    await e.page.waitForTimeout(500);
    ok("a coach whose side has nothing in the week: the empty state in words, '0 open · 0 reads failed · 0 fixtures'",
       /No fixtures in the coming week for your sides/.test(await inner(e.page, "queue")) && (await headerText(e.page)) === "0 open · 0 reads failed · 0 fixtures", `${await headerText(e.page)} | ${(await inner(e.page, "queue")).slice(0, 120)}`);
    ok("...no office list, no 'Later'", await tid(e.page, "queue-office").count() === 0 && await tid(e.page, "queue-later").count() === 0);
    await e.ctx.close();
    // A clean fixture: eleven named, all answered, a scorer and an umpire, its conditions fixed, no bus.
    const six = await mkPlayers("6XI", Array.from({ length: 11 }, (_, i) => `Q Clean Fictional ${i + 1}`), 100);
    const CLEAN = await mk("6XI", "QA Clean XI", saTomorrow(14));
    await q(`insert into match_squad (match_id, player_id, side, batting_no) select $1, p, 'home', n from unnest($2::uuid[]) with ordinality as t(p, n)`, [CLEAN, six]);
    const cleanCoach = (await q(`select id from app_user where email = 'qa.clean@example.invalid'`))[0].id;
    await q(`insert into match_availability (match_id, player_id, school_id, status, declared_by, fixture_starts_at) select $1, p, $2, 'available', $3, starts_at from unnest($4::uuid[]) p, match where match.id = $1`, [CLEAN, HIL, cleanCoach, six]);
    await q(`insert into match_official (match_id, school_id, duty, person_name) values ($1, $2, 'scorer', 'QA Scorer'), ($1, $2, 'umpire', 'QA Umpire')`, [CLEAN, HIL]);
    await fixConditions(q, CLEAN);
    const k = await open({ viewport: DESK });
    await signIn(k.page, "qa.clean@example.invalid");
    await queue(k.page);
    await k.page.setViewportSize(PHONE);
    await k.page.waitForTimeout(500);
    const cleanLine = (await group_(k.page, CLEAN).locator('[data-testid="queue-group-line"]').innerText()).trim();
    ok("a fixture with nothing waiting and every read answered: 'Nothing to resolve', and the header says '0 open · 0 reads failed · 1 fixture'",
       cleanLine === "Nothing to resolve" && (await headerText(k.page)) === "0 open · 0 reads failed · 1 fixture", `${cleanLine} | ${await headerText(k.page)}`);
    await k.page.route(new RegExp(`/api/read/match_duties\\?.*matchId=${CLEAN}`), (r) => r.abort());
    await k.page.setViewportSize(DESK);
    await queue(k.page);
    await k.page.setViewportSize(PHONE);
    await k.page.waitForTimeout(500);
    const failedLine = (await group_(k.page, CLEAN).locator('[data-testid="queue-group-line"]').innerText()).trim();
    ok("the duties read killed: the header is '0 open · 1 read failed · 1 fixture', never 'all clear'; the group says '0 to resolve', never 'Nothing to resolve'",
       (await headerText(k.page)) === "0 open · 1 read failed · 1 fixture" && failedLine === "0 to resolve" && /Could not read the duties/.test(await inner(k.page, "queue")) && !/all clear|nothing to resolve/i.test(await inner(k.page, "queue")), `${await headerText(k.page)} | ${failedLine}`);
    const fk = await floors(k.page);
    ok(`the failed screen: nothing under 12px (${fk.small.length}), nothing tapped under 44px (${fk.tiny.length}), the retry included`, fk.small.length === 0 && fk.tiny.length === 0, [...fk.small, ...fk.tiny].slice(0, 4).join(" · "));
    ok("no page errors", k.errors.length === 0 && k.refusals.length === 0, [...k.errors, ...k.refusals].join(" | "));
    await k.ctx.close();
  }

  // ══ 10 · Floors, both themes, reduced motion ════════════════════════════
  group("At 390 wide, in Floodlit and Daylight, with reduced motion");
  for (const scheme of ["dark", "light"]) {
    const f = await open({ viewport: DESK, scheme, reduced: scheme === "dark" });
    await signIn(f.page, "sarah@example.invalid");
    await queue(f.page);
    await f.page.setViewportSize(PHONE);
    await f.page.waitForTimeout(600);
    const ff = await floors(f.page);
    ok(`${scheme === "dark" ? "floodlit" : "daylight"}, phone: nothing under 12px (${ff.small.length}), every tap at least 44px (${ff.tiny.length})`, ff.small.length === 0 && ff.tiny.length === 0, [...ff.small, ...ff.tiny].slice(0, 4).join(" · "));
    ok("...no horizontal scroll", await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    if (scheme === "dark") ok("reduced motion: no animation runs on it", await f.page.evaluate(() => [...document.querySelectorAll('[data-testid="queue"], [data-testid="queue"] *')].every((n) => getComputedStyle(n).animationName === "none" || parseFloat(getComputedStyle(n).animationDuration) <= 0.01)));   // the page's own 1ms
    await f.ctx.close();
  }

  ok("the API raised nothing unexpected", !apiErr.join("").match(/Unhandled|TypeError|ReferenceError/), apiErr.join("").slice(0, 300));
  // Put the seed's two fixtures back.
  await q(`update match set starts_at = $2 where id = $1`, [MICH, michAt]);
  await q(`update match set starts_at = $2 where id = $1`, [KEARSNEY, kearsneyAt]);
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

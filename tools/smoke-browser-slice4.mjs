#!/usr/bin/env node
/**
 * EXPERIENCE_PASS Slice 4, parent and pupil, from a browser: the walks the
 * slice names (docs/redesign/EXPERIENCE_PASS.md, "Slice 4 · Parent and
 * pupil", Walks row), each against the seeded school and a fixture of its own.
 *
 *   1. Q2. A pupil who is also appointed to score keeps the pupil's
 *      four-item bar at phone width (no fifth item, no More), lands on his
 *      own Home, and sees "Appointed to score" there, word for word the
 *      scorer's home's.
 *   2. Q12. A child with one innings of three balls: his parent's season card
 *      says his runs and "3 balls: a guide, not a figure", and no average;
 *      the innings-by-innings panel says the same in its Average cell.
 *   3. DESIGN_DIRECTION §6. A parent with children at two schools: Family is
 *      two sections, each its own child at its own school, neither naming the
 *      other; Home is one child at a time, never the two merged.
 *   4. Q15. A waiting parent: a link the office has not checked, and a
 *      request to be linked from the no-school home. Each may open the terms
 *      and read them whole, and neither is offered "I agree". When the office
 *      answers, the no-school home carries one notice, "The school has
 *      answered your request", which says nothing of the answer (db/161).
 *   5. Q7. The DSO card is on the parent's and the pupil's Home, last, with
 *      "Raise a concern", which opens Safeguarding.
 *   6. §1.9, §1.10. While her child's match is live, its card leads his
 *      section of her Home; with nothing live, the next fixture leads.
 *   7. Q10 (Kameel, 15 Nov: "eleven"). On her child's next fixture, the
 *      eleven in batting order, her child's row marked, his side only.
 *
 * Leaves the database as it found it.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-slice4.mjs
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
import { afterReads, watchReads } from "./walk-wait.mjs";
import { destLocator } from "./walk-nav.mjs";

const WEB_PORT = port(4371);
const API_PORT = port(8911);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";   // the pupil, R Pillay, 1XI; his mother is parent@
const KD = "aaaaaaaa-0000-0000-0000-000000000006";       // Sarah's Hilton child
const DM = "bbbbbbbb-0000-0000-0000-000000000001";       // Sarah's Westville child
const REGISTRAR = "88888888-0000-0000-0000-00000000000c";
const SCORER = "88888888-0000-0000-0000-000000000006";
const TAG = "slice4-walk";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-slice4-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

async function open(width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
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
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const inner = (page, id) => tid(page, id).first().innerText({ timeout: 6000 }).catch(() => "");
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
  await afterReads(page, 2500);
}
async function go(page, key) {
  const l = (await destLocator(page, key));
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await afterReads(page, 1800);
  return true;
}
/** Answer a role request as the office does, through decide_role_request(), under its session. */
async function decide(request, grant, player = null) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true)", [REGISTRAR]);
    const r = (await c.query("select ok, reason from decide_role_request($1, $2, 'slice4 walk', $3, null)", [request, grant, player])).rows[0];
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
}

// ── Fixtures, all the walk's own ────────────────────────────────────
const made = { matches: [], players: [], users: [], assignments: [] };
const at = (hours) => new Date(Date.now() + hours * 3600e3).toISOString();
async function match({ team = "1XI", status = "scheduled", startsAt, opponent = "Slice Four XI" }) {
  const [m] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
                       values ($1, $2, $3, $4, 'cricket', 'T20', 20, $5) returning id`, [HIL, team, opponent, startsAt, status]);
  made.matches.push(m.id);
  return m.id;
}
async function user(email, name, role, school = HIL) {
  const [u] = await q(`insert into app_user (school_id, email, name, role) values ($1, $2, $3, $4) returning id`, [school, email, name, role]);
  made.users.push(u.id);
  return u.id;
}
async function child(name, team = "U13F", born = "2013-03-01") {
  const [p] = await q(`insert into player (school_id, team_code, full_name, surname, squad_no, playing_role, born)
                       values ($1, $2, $3, $4, $6, 'batter', $5) returning id`, [HIL, team, name, name.split(" ").pop(), born, 940 + made.players.length]);
  made.players.push(p.id);
  return p.id;
}
/** A guardian link: verified and consented, or waiting on the office. */
async function link(person, player, state = "verified") {
  const [a] = await q(`insert into role_assignment (person_id, role, school_id, valid_from) values ($1, 'guardian', $2, current_date - 30) returning id`, [person, HIL]);
  made.assignments.push(a.id);
  const v = state === "verified";
  await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                           consent_state, consent_version, consent_at, created_by, valid_from)
           values ($1, $2, 'parent', $3, $4, $5, $6, $7, $5, $8, current_date - 30)`,
          [a.id, player, state, v ? REGISTRAR : null, v ? new Date() : null, v ? "granted" : "pending", v ? "popia-2026-01" : null, REGISTRAR]);
}
let seq = 0;
async function ev(m, kind, { t = null, v = null, s = null, payload = {} } = {}) {
  seq++;
  await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                   client_seq, client_ts, kind, ball_type, value, dismissal, striker_id, bowler_id, payload)
           values ($1, $2, $3, 1, 0, $4, 'walk-slice4', $5, $3, now(), $6, $7, $8, $9, $10, null, $11)`,
          [m, HIL, seq, SCORER, `${TAG}:${m}:${seq}`, kind, t, v, t === "W" ? "bowled" : null, s, payload]);
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`).then((x) => x.json()); if (r?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const pupilUser = (await q(`select id from app_user where email = 'pillay@example.invalid'`))[0].id;

  // ── 1. Q2: the pupil who scores ──────────────────────────────────
  group("1. A pupil appointed to score keeps his own four-item app (Q2)");
  const toScore = await match({ startsAt: at(3), opponent: "Slice Four Scorers XI" });
  const [sa] = await q(`insert into role_assignment (person_id, role, school_id, team_code, fixture_id) values ($1, 'scorer', $2, '1XI', $3) returning id`,
                       [pupilUser, HIL, toScore]);
  made.assignments.push(sa.id);
  {
    const s = await open(390);
    await signIn(s.page, "pillay@example.invalid");
    ok("he signs in to the pupil's app: the persona header", (await tid(s.page, "persona-bar").count()) === 1);
    const items = await s.page.locator('[data-testid="mnav"] [data-testid^="mnav-"]:not([data-testid$="-badge"])').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    ok("...with the four items, Home · Matches · Passport · Me, and no fifth", items.join() === "mnav-myhome,mnav-mymatches,mnav-passport,mnav-me", items.join());
    ok("...and no More and no staff destination", (await tid(s.page, "mnav-more").count()) === 0 && (await tid(s.page, "mnav-dashboard").count()) === 0);
    ok("he lands on his own Home", (await s.page.locator('[data-testid="os-main"]').getAttribute("data-page").catch(() => "")) === "myhome");
    await tid(s.page, "appointed-card").first().waitFor({ timeout: 10000 }).catch(() => {});
    // As written, not as drawn: the label's capitals are CSS (innerText would give "APPOINTED TO SCORE").
    const card = await tid(s.page, "appointed-card").first().textContent({ timeout: 6000 }).catch(() => "");
    ok("Home carries the block: \"Appointed to score\", word for word", /Appointed to score/.test(card) && /Open the pad/.test(card), card);
    ok("...for the fixture he is appointed to", (await s.page.locator(`[data-testid="appointed"][data-match="${toScore}"]`).count()) === 1);
    ok("no page error", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }
  // Review S6: a pupil who scores for his side with no appointment to a fixture (Kameel, 8 Oct: the
  // appointment only shapes the list) still reaches the pad from his Home: his side's fixture, listed.
  await q(`delete from role_assignment where id = $1`, [sa.id]);
  const [side] = await q(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'scorer', $2, '1XI') returning id`,
                         [pupilUser, HIL]);
  made.assignments.push(side.id);
  {
    const s = await open(390);
    await signIn(s.page, "pillay@example.invalid");
    const items = await s.page.locator('[data-testid="mnav"] [data-testid^="mnav-"]:not([data-testid$="-badge"])').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    ok("a side-wide pupil scorer, no appointment: still the four items", items.join() === "mnav-myhome,mnav-mymatches,mnav-passport,mnav-me", items.join());
    await tid(s.page, "appointed-card").first().waitFor({ timeout: 10000 }).catch(() => {});
    const row = s.page.locator(`[data-testid="appointed"][data-match="${toScore}"]`);
    const words = await row.locator('[data-testid="appointed-words"]').first().textContent({ timeout: 6000 }).catch(() => "");
    ok("...his side's fixture is on his Home, in the scorer's home's words", words === "Your side's fixture" && (await row.getAttribute("data-group").catch(() => "")) === "team", words);
    ok("...with the pad one tap away", (await tid(s.page, "appointed-open").count()) >= 1);
    await s.ctx.close();
  }

  // ── 2. Q12: three balls ──────────────────────────────────────────
  group("2. A child with three balls: his runs, \"3 balls\", and no average (Q12)");
  const three = await child("Threeball Kid");
  const threeMum = await user("slice4.threemum@example.invalid", "T Threeball", "guardian");
  await link(threeMum, three);
  {
    const m = await match({ team: "U13F", status: "complete", startsAt: at(-50), opponent: "Slice Four Short XI" });
    await ev(m, "innings_start", { payload: { battingTeam: "Hilton U13F", bowlingTeam: "Slice Four Short XI", overs: 20,
      squad: [{ id: three, name: "Threeball Kid" }] } });
    await ev(m, "ball", { t: "run", v: 2, s: three });
    await ev(m, "ball", { t: "run", v: 1, s: three });
    await ev(m, "ball", { t: "W", v: 0, s: three });
    await ev(m, "innings_end", { payload: { reason: "declared", confirmed: { runs: 3, wickets: 1, balls: 3 } } });
    // On the sheet: a parent reads her child's matches through it.
    await q(`insert into match_squad (match_id, player_id, side, batting_no) values ($1, $2, 'home', 1)`, [m, three]);
    const [c] = await q(`select balls_faced::int as b, runs::int as r from player_batting_career where player_id = $1`, [three]);
    ok("the fixture: one innings, three balls, three runs, out", c?.b === 3 && c?.r === 3, JSON.stringify(c));
    const s = await open();
    await signIn(s.page, "slice4.threemum@example.invalid");
    await tid(s.page, "season-line").first().waitFor({ timeout: 12000 }).catch(() => {});
    const line = await inner(s.page, "season-line");
    ok("his season card says his runs and \"average: 3 balls: a guide, not a figure\"", /3 runs in 1 innings/.test(line) && /average: 3 balls: a guide, not a figure/.test(line), line);
    ok("...and no average figure", !/average \d/.test(line) && !/\b3\.0\b/.test(line), line);
    const avg = await s.page.locator('[data-testid="family-trend"] dd[data-figure="Average"]').first().innerText({ timeout: 6000 }).catch(() => "");
    ok("the innings-by-innings panel draws the same in place of the average", /3 balls: a guide, not a figure/.test(avg), avg);
    ok("no page error", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  // ── 3. Two schools ───────────────────────────────────────────────
  group("3. A parent with children at two schools: two sections, never merged");
  {
    const s = await open();
    await signIn(s.page, "sarah@example.invalid");
    await go(s.page, "family");
    await tid(s.page, `family-child-${KD}`).waitFor({ timeout: 12000 }).catch(() => {});
    const kd = await inner(s.page, `family-child-${KD}`), dm = await inner(s.page, `family-child-${DM}`);
    ok("Family is two sections, one per child", (await tid(s.page, `family-child-${KD}`).count()) === 1 && (await tid(s.page, `family-child-${DM}`).count()) === 1);
    ok("...K Dlamini's at Hilton College, naming nobody else", /K Dlamini/.test(kd) && /Hilton College/.test(kd) && !/D Mkhize|Westville/.test(kd), kd.slice(0, 200));
    ok("...D Mkhize's at Westville Boys' High, naming nobody else", /D Mkhize/.test(dm) && /Westville/.test(dm) && !/K Dlamini|Hilton College/.test(dm), dm.slice(0, 200));
    await go(s.page, "children");
    await tid(s.page, "family-home-body").waitFor({ timeout: 12000 }).catch(() => {});
    const body = await inner(s.page, "family-home-body");
    ok("Home is one child at a time, never the two in one list", /K Dlamini|D Mkhize/.test(body) && !(/K Dlamini/.test(body) && /D Mkhize/.test(body)), body.slice(0, 200));
    await s.ctx.close();
  }

  // ── 4. Q15: the waiting parent ───────────────────────────────────
  group("4. A waiting parent reads the terms and cannot agree; the office's answer is one notice (Q15)");
  const waitKid = await child("Waitlink Kid");
  const waitMum = await user("slice4.waitmum@example.invalid", "W Waitlink", "guardian");
  await link(waitMum, waitKid, "pending");
  {
    const s = await open();
    await signIn(s.page, "slice4.waitmum@example.invalid");
    await tid(s.page, "waiting-terms").first().waitFor({ timeout: 12000 }).catch(() => {});
    const wt = await inner(s.page, "waiting-terms");
    ok("a link the office has not checked: the terms are offered to read now", /You will be asked to agree once the school has checked your link/.test(wt)
       && /Health monitoring is separate, and off/.test(wt), wt);
    await tid(s.page, "waiting-terms-open").first().click({ timeout: 4000 }).catch(() => {});
    await s.page.waitForTimeout(400);
    const terms = await inner(s.page, "waiting-terms-text");
    ok("...she reads them whole, to their end", /popia-2026-01/.test(terms) && /End of the terms\./.test(terms), terms.slice(0, 120));
    ok("...and there is no \"I agree\" anywhere", (await tid(s.page, "family-terms-agree").count()) === 0
       && (await s.page.locator("button", { hasText: /I agree/ }).count()) === 0);
    ok("no page error", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }
  const askMum = await user("slice4.askmum@example.invalid", "A Asklink", "none", null);
  const [req] = await q(`insert into role_request (person_id, role, school_id, note) values ($1, 'guardian', $2, 'For my son in the U13F') returning id`, [askMum, HIL]);
  {
    const s = await open();
    await signIn(s.page, "slice4.askmum@example.invalid");
    await tid(s.page, "request-pending").first().waitFor({ timeout: 12000 }).catch(() => {});
    ok("a request from the no-school home: waiting", (await tid(s.page, "request-pending").count()) === 1);
    await tid(s.page, "waiting-terms-open").first().click({ timeout: 6000 }).catch(() => {});
    await s.page.waitForTimeout(400);
    ok("...the terms open to read, and no \"I agree\"", /End of the terms\./.test(await inner(s.page, "waiting-terms-text"))
       && (await s.page.locator("button", { hasText: /I agree/ }).count()) === 0);
    ok("...and no notice yet", (await tid(s.page, "no-school-notice").count()) === 0);
    await s.ctx.close();
  }
  const answered = await decide(req.id, false);
  ok("the office declines her request", answered?.ok === true, JSON.stringify(answered));
  {
    const s = await open();
    await signIn(s.page, "slice4.askmum@example.invalid");
    await tid(s.page, "no-school-notice").first().waitFor({ timeout: 12000 }).catch(() => {});
    const n = await inner(s.page, "no-school-notices");
    ok("she finds one notice: \"The school has answered your request\"", (await tid(s.page, "no-school-notice").count()) === 1
       && /The school has answered your request/.test(n) && /Hilton College/.test(n), n);
    ok("...which says nothing of the answer, and names no child", !/declin|grant|approv|refus|verified|Waitlink|son/i.test(n.replace(/answered your request/g, "")), n);
    ok("...while her requests list says which", (await tid(s.page, "request-declined").count()) === 1);
    ok("no page error", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }
  // Red-team S4: a link the office set up from a paper form, then ended unverified. No request of hers
  // exists, and with her only link her role ends too, so she lands here: the answered notice must point
  // at something, and the no-school home says the link ended, in Family's words.
  const formKid = await child("Formlink Kid");
  const formMum = await user("slice4.formmum@example.invalid", "F Formlink", "guardian");
  await link(formMum, formKid, "pending");
  {
    const [{ id: formLink }] = await q(`select s.id from assignment_subject s join role_assignment a on a.id = s.assignment_id where a.person_id = $1`, [formMum]);
    const c = await pool.connect();
    let ended = null;
    try {
      await c.query("BEGIN");
      await c.query("select set_config('app.user_id', $1, true)", [REGISTRAR]);
      ended = (await c.query("select ok, reason from guardian_link_revoke($1, 'office', 'slice4 walk: not this family, checked.')", [formLink])).rows[0];
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    ok("the office ends the link it set up, unverified", ended?.ok === true, JSON.stringify(ended));
    const s = await open();
    await signIn(s.page, "slice4.formmum@example.invalid");
    await tid(s.page, "no-school-notice").first().waitFor({ timeout: 12000 }).catch(() => {});
    ok("she reads the one answered notice", /The school has answered your request/.test(await inner(s.page, "no-school-notices")));
    const line = await inner(s.page, "no-school-link");
    ok("...and the no-school home says where the answer is: her link ended, in Family's words",
       (await tid(s.page, "no-school-link").count()) === 1 && (await tid(s.page, "no-school-link").getAttribute("data-kind")) === "ended"
       && /Your link to a child at Hilton College ended on/.test(line) && /The school office can say why/.test(line) && !/Formlink/.test(line), line);
    ok("no page error", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  // ── 5. Q7: the DSO card ──────────────────────────────────────────
  group("5. The DSO card, last on the parent's and the pupil's Home (Q7)");
  for (const [who, email, home] of [["the parent", "parent@example.invalid", "family-home"], ["the pupil", "pillay@example.invalid", "pupil-home"]]) {
    const s = await open();
    await signIn(s.page, email);
    await tid(s.page, "dso-card").first().waitFor({ timeout: 12000 }).catch(() => {});
    const card = await inner(s.page, "dso-card");
    ok(`${who}'s Home carries it: the DSOs, "Raise a concern", "Report anonymously"`,
       /Raise a concern/.test(card) && /Report anonymously/.test(card) && /SAPS on 10111/.test(card)
       && ((await tid(s.page, "dso-card-name").count()) > 0 || (await tid(s.page, "dso-card-none").count()) > 0), card);
    const last = await s.page.locator(`[data-testid="${home}"] > *`).evaluateAll((els) => els.at(-1)?.getAttribute("data-testid"));
    ok("...last", last === "dso-card", last);
    await tid(s.page, "dso-card-raise").click({ timeout: 4000 }).catch(() => {});
    await afterReads(s.page, 1200);
    ok("...and \"Raise a concern\" opens Safeguarding", (await s.page.locator('[data-testid="os-main"]').getAttribute("data-page").catch(() => "")) === "safeguarding");
    await s.ctx.close();
  }

  // ── 6. The live card leads ───────────────────────────────────────
  group("6. While his match is live, its card leads his section (§1.9)");
  {
    const s = await open();
    await signIn(s.page, "parent@example.invalid");
    await tid(s.page, "family-home-body").waitFor({ timeout: 12000 }).catch(() => {});
    let order = await s.page.locator('[data-testid="family-home-body"] > *').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    ok("nothing live: the next fixture leads, under his name", order[1] === "next-fixture" && !order.includes("live-card"), order.join());
    await s.ctx.close();
    await match({ status: "live", startsAt: at(-1), opponent: "Slice Four Live XI" });
    const t = await open();
    await signIn(t.page, "parent@example.invalid");
    await tid(t.page, "live-card").first().waitFor({ timeout: 12000 }).catch(() => {});
    order = await t.page.locator('[data-testid="family-home-body"] > *').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    ok("his match live: the live card leads, before the next fixture", order[1] === "live-card" && order.indexOf("next-fixture") > 1, order.join());
    ok("no page error", t.errors.length === 0, t.errors.join(" | "));
    await t.ctx.close();
  }

  // ── 7. Q10: the eleven ───────────────────────────────────────────
  group("7. Her child's next fixture: the eleven in order, her child marked (Q10, Kameel 15 Nov)");
  {
    // The seed's 1XI is five boys; the eleven is filled with boys of the walk's own, each registered
    // (a verified, consented guardian: a minor is selected only then), one parent standing in for theirs.
    const standIn = await user("slice4.standin@example.invalid", "S Standin", "guardian");
    const mates = [];
    for (let i = 1; i <= 10; i++) {
      const b = await child(`Sheetmate ${String(i).padStart(2, "0")}`, "1XI");
      await link(standIn, b);
      mates.push({ id: b });
    }
    const next = await match({ startsAt: at(2), opponent: "Slice Four Sheet XI" });
    const ids = [mates[0].id, mates[1].id, mates[2].id, PILLAY, ...mates.slice(3).map((r) => r.id)];
    for (let i = 0; i < ids.length; i++) {
      await q(`insert into match_squad (match_id, player_id, side, batting_no) values ($1, $2, 'home', $3)`, [next, ids[i], i + 1]);
    }
    const s = await open();
    await signIn(s.page, "parent@example.invalid");
    await tid(s.page, "side-sheet").first().waitFor({ timeout: 12000 }).catch(() => {});
    const card = await inner(s.page, "next-fixture");
    ok("the next fixture is the walk's", /Slice Four Sheet XI/.test(card), card.slice(0, 160));
    const rows = await s.page.locator('[data-testid="next-fixture"] [data-testid="side-sheet-row"]').allInnerTexts().catch(() => []);
    ok(`the eleven, in batting order (${rows.length})`, rows.length === ids.length && rows.every((r, i) => r.trim().startsWith(String(i + 1))), rows.join(" | "));
    const his = await s.page.locator('[data-testid="next-fixture"] [data-testid="side-sheet-row"][data-his="true"]').allInnerTexts().catch(() => []);
    ok("...her child's row marked, and only his", his.length === 1 && /R Pillay/.test(his[0]) && /your child/.test(his[0]) && his[0].trim().startsWith("4"), his.join(" | "));
    ok("...with his own line above it", /Team sheet: named, batting 4/.test(await inner(s.page, "teamsheet-line")));
    ok("no page error", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.message);
} finally {
  const m = made.matches, u = made.users, p = made.players;
  await q(`delete from match_squad where match_id = any($1)`, [m]).catch(() => {});
  await q(`delete from ball_event where match_id = any($1)`, [m]).catch(() => {});
  await q(`delete from notification where recipient_id = any($1) or (title = 'A parent claim was declined' and published_at > now() - interval '1 hour' and school_id = $2)`, [u, HIL]).catch(() => {});
  await q(`delete from role_request where person_id = any($1)`, [u]).catch(() => {});
  await q(`delete from request_cooldown where person_id = any($1)`, [u]).catch(() => {});
  await q(`delete from assignment_subject where assignment_id = any($1) or player_id = any($2)`, [made.assignments, p]).catch(() => {});
  await q(`delete from role_assignment where id = any($1) or person_id = any($2)`, [made.assignments, u]).catch(() => {});
  await q(`delete from access_log where person_id = any($1)`, [u]).catch(() => {});
  await q(`delete from match where id = any($1)`, [m]).catch(() => {});
  await q(`delete from app_user where id = any($1)`, [u]).catch(() => {});
  await q(`delete from player where id = any($1)`, [p]).catch(() => {});
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nBROWSER SLICE 4: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

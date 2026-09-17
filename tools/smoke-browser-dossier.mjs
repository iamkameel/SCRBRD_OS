#!/usr/bin/env node
/**
 * The opposition dossier, ON SCREEN, in a real browser.
 *
 * tools/smoke-opposition.mjs proves the API and the two SECURITY DEFINER
 * functions behind it: off by default, a head-to-head fixture you are in or
 * nothing, a fourteen-day window, cricket columns only, figures withheld
 * below the evidence floor, every read written down. All of that was true
 * before this walk existed and NOTHING DREW IT — for months the largest gap
 * in the product was a dossier nobody could open.
 *
 * So this walk asserts the half the API cannot: that the screen renders those
 * rows, and renders the THREE DIFFERENT KINDS OF EMPTY as three different
 * things rather than one blank panel —
 *
 *   no rows          → "no dossier for you", saying nothing about the fixture
 *   open false       → the reason, in words, and when the window opens
 *   figures withheld → an em dash and the evidence label, never a 0.0
 *
 * And the negative that matters most: a child's PERSONAL columns must not be
 * anywhere in the rendered page. The API walk proves the payload omits them;
 * this proves no component put them back — a profile card reached from a name,
 * a tooltip, a hidden div. The dossier is the one screen in SCRBRD that draws
 * another school's children and it is the one screen where that would be a
 * disclosure rather than a bug.
 *
 * It also covers Analytics, whose Head-to-Head tab showed a hand-written table
 * of invented results against six named KZN schools until this change. That is
 * worse than an empty screen, and the assertion is that the fabricated rows
 * are gone and the derived ones are there.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-dossier.mjs
 *   BROWSER_DOSSIER_DEBUG=1 node tools/smoke-browser-dossier.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 4329;
const API_PORT = 8798;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const MKHIZE = "bbbbbbbb-0000-0000-0000-000000000001";   // Westville 1XI
const BOTHA  = "bbbbbbbb-0000-0000-0000-000000000002";   // Westville 1XI
const DEBUG = !!process.env.BROWSER_DOSSIER_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, detail) => { if (c) pass++; else { fail++; console.log("  ✗", n, detail ? `— ${String(detail).slice(0, 220)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-dossier-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await call("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-browser-dossier" } })).body?.token;

/** A fixture, hosted by `home`, against a tenant side or a typed name. */
const fixture = async (home, homeTeam, { awaySchool = null, awayTeam = null, opponent = "x", days, status = "scheduled" }) =>
  (await q(`insert into match (school_id, team_code, away_school_id, away_team_code, opponent,
                               starts_at, sport, format, overs, status)
            values ($1,$2,$3,$4,$5, now() + make_interval(days => $6), 'cricket','T20',20,$7)
            returning id`, [home, homeTeam, awaySchool, awayTeam, opponent, days, status]))[0].id;

let seqBase = 0;
const balls = async (matchId, hostSchool, n, { striker, bowler = null, nonStriker = null, wicketsAt = [] }) => {
  const scorer = (await q(`select id from app_user where email='scorer@example.invalid'`))[0].id;
  const pattern = [0, 1, 0, 4, 0, 1, 2, 0];
  for (let i = 1; i <= n; i++) {
    const isW = wicketsAt.includes(i);
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                                     idempotency_key, client_seq, client_ts, kind, ball_type, value,
                                     striker_id, non_striker_id, bowler_id, dismissal, dismissed_id)
             values ($1,$2,$3,1,1,$4,'d',$5,$3, now(),'ball',$6,$7,$8,$9,$10,$11,$12)`,
      [matchId, hostSchool, seqBase + i, scorer, `bdoss-${matchId}-${seqBase + i}`,
       isW ? "W" : "run", isW ? 0 : pattern[i % pattern.length],
       striker, nonStriker, bowler, isW ? "bowled" : null, isW ? striker : null]);
  }
  seqBase += n;
};

const browser = await chromium.launch({ ...launchOptions() });

/** A fresh page per person: a session must not leak between them. */
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1420, height: 900 } });
  await offline(ctx);
  const page = await ctx.newPage();
  const refusals = [], errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (/\[scrbrd\] getData\(/.test(t)) refusals.push(t);
    if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, refusals, errors };
}

const text = (page) => page.$eval("body", (el) => el.innerText);
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};

/** Sign in by typing the address, which every seeded account allows. */
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await page.locator('input[type="email"]').first().fill(email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  return /Match Centre|Dashboard/i.test(await text(page));
}

async function nav(page, label) {
  const l = page.locator("nav button", { hasText: label }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return true;
}

/** Open the dossier for one fixture from Match Centre. */
async function openDossier(page, matchId) {
  const btn = page.locator(`[data-testid="dossier-open-${matchId}"]`);
  if (!(await btn.count())) return false;
  await btn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1800);
  return (await page.locator('[data-testid="dossier"]').count()) === 1;
}
const closeDossier = async (page) => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
};

let soon, later, solo, wrongSide;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await call("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const platform = await login("platform@example.invalid");
  // Switched off EXPLICITLY rather than relying on the seed's default. The
  // runner reseeds before every walk, but this file is also meant to be run
  // by hand, and a walk whose first group silently passes or fails on
  // leftover state is not testing the thing it names.
  await call("/api/admin/features/opposition", { method: "POST", token: platform,
    body: { enabled: false, reason: "Browser walk: prove off means off first" } });
  const hilBoy = (await q(`select id from player where school_id=$1 and team_code='1XI'
                            order by full_name limit 1`, [HIL]))[0].id;

  // ── The log the dossier is derived from ──
  // Westville's Botha bowled 36 balls at Hilton (enough to be graded) and
  // batted 10 (below the thirty-ball floor, so his strike rate is withheld).
  // Mkhize batted 44 across two fixtures, so his IS stated.
  const past = await fixture(HIL, "1XI", { awaySchool: WES, awayTeam: "1XI", days: -20, status: "complete" });
  await balls(past, HIL, 36, { striker: hilBoy, bowler: BOTHA, wicketsAt: [18] });
  await balls(past, HIL, 12, { striker: MKHIZE, nonStriker: BOTHA, bowler: hilBoy });
  const kears = await fixture(WES, "1XI", { opponent: "Kearsney 1st XI", days: -10, status: "complete" });
  await balls(kears, WES, 32, { striker: MKHIZE, nonStriker: BOTHA });
  await balls(kears, WES, 10, { striker: BOTHA, nonStriker: MKHIZE });

  // A pairing BOTH ends of which this coach may read. `matchups` joins
  // `player` for the batter and the bowler, so a Hilton batter against a
  // Westville bowler is invisible there by design — an aggregate that named a
  // player the reader may not see would be the leak the whole model exists to
  // prevent, and tools/smoke-matchups.mjs carries the same lesson after its
  // first draft tripped on it. So the match-up drawn on screen is Hilton's own
  // bowler at Hilton's own batter, which is what a squad's net session is.
  const hilPair = await q(`select id, full_name from player
                            where school_id = $1 and team_code = '1XI'
                            order by full_name limit 2`, [HIL]);
  const hilBowler = (await q(`update player set bowling_style = 'S' where id = $1 returning id`,
                             [hilPair[1].id]))[0].id;
  const nets = await fixture(HIL, "1XI", { opponent: "Michaelhouse 2nd XI", days: -4, status: "complete" });
  await balls(nets, HIL, 24, { striker: hilPair[0].id, bowler: hilBowler, wicketsAt: [20] });

  soon      = await fixture(HIL, "1XI", { awaySchool: WES, awayTeam: "1XI", days: 7 });
  later     = await fixture(HIL, "1XI", { awaySchool: WES, awayTeam: "1XI", days: 40 });
  solo      = await fixture(HIL, "1XI", { opponent: "Michaelhouse 1st XI", days: 7 });
  wrongSide = await fixture(HIL, "2XI", { awaySchool: WES, awayTeam: "2XI", days: 7 });

  // ── Off by default, on screen ───────────────────────────────────
  group("Switched off, the coach is told so rather than shown a blank");
  {
    const coach = await open();
    ok("the Hilton 1XI coach signs in", await signIn(coach.page, "coach@example.invalid"));
    ok("Match Centre opens", await nav(coach.page, /Match Centre/));
    ok("the dossier is offered on an upcoming fixture",
       (await coach.page.locator(`[data-testid="dossier-open-${soon}"]`).count()) === 1);
    ok("it opens", await openDossier(coach.page, soon));
    const off = await coach.page.locator('[data-testid="dossier"]').innerText();
    if (DEBUG) console.log("[debug] feature off:\n" + off);
    // The feature being off reaches the client as a 403 the read layer
    // translates, so there is no context row and the panel must still say why.
    ok("...and says the feature is switched off, not that there is no data",
       /switched off/i.test(off), off.replace(/\s+/g, " ").slice(0, 160));
    ok("...naming no Westville pupil while it is off", !/Mkhize|Botha/.test(off));
    await coach.ctx.close();
  }

  ok("the platform switches opposition intelligence on",
     (await call("/api/admin/features/opposition", { method: "POST", token: platform,
       body: { enabled: true, reason: "Browser walk: the dossier screen" } })).status === 200);

  // ── The dossier, drawn ──────────────────────────────────────────
  group("The coach of the side playing reads the other side");
  const coach = await open();
  ok("the coach signs in again", await signIn(coach.page, "coach@example.invalid"));
  ok("Match Centre opens", await nav(coach.page, /Match Centre/));
  ok("the dossier opens for the fixture next week", await openDossier(coach.page, soon));
  const dossier = coach.page.locator('[data-testid="dossier"]');
  const body = await dossier.innerText();
  if (DEBUG) console.log("[debug] dossier:\n" + body);

  ok("the squad table is drawn", (await coach.page.locator('[data-testid="dossier-squad"]').count()) === 1);
  ok("...naming the other side's players", /Mkhize/.test(body) && /Botha/.test(body));
  ok("...and saying whose side it is", /Westville/i.test(body));
  ok("the header counts the games the figures came from", /Games read/i.test(body));
  ok("...and when the window shuts", /Window shuts/i.test(body));

  // ── The evidence floor, on screen ──
  //
  // The expectation is DERIVED FROM THE SERVER rather than hard-coded against
  // a named boy. The walk inserts deliveries, so a player who is below the
  // thirty-ball floor on a fresh seed is above it after the walk has run
  // twice — and an assertion that "Botha is too thin" then fails for a
  // reason that has nothing to do with the screen. What must hold on every
  // row, whatever the sample, is the equivalence: a figure is shown exactly
  // when the server sent one, and where it did not, the reason is.
  const coachToken = await login("coach@example.invalid");
  const served = (await call(`/api/read/opposition_squad?matchId=${soon}`, { token: coachToken })).body?.rows ?? [];
  ok("the server served a squad to compare the screen against", served.length > 0, `${served.length} rows`);

  let floorOk = 0, floorBad = [];
  for (const r of served) {
    const row = coach.page.locator(`[data-testid="dossier-player-${r.player_id}"]`);
    if (!(await row.count())) { floorBad.push(`${r.full_name}: no row drawn`); continue; }
    const t = (await row.innerText()).replace(/\s+/g, " ");
    const withheld = r.strike_rate == null;
    // An em dash where the server withheld; a figure where it did not. And
    // never a zero standing in for a withheld one, which is the specific lie
    // this whole mechanism exists to prevent.
    if (withheld && !/—/.test(t)) floorBad.push(`${r.full_name}: withheld but no em dash — ${t}`);
    else if (withheld && /\b0\.0\b/.test(t)) floorBad.push(`${r.full_name}: withheld but rendered 0.0 — ${t}`);
    else if (!withheld && !new RegExp(String(Number(r.strike_rate).toFixed(1)).replace(".", "\\.")).test(t))
      floorBad.push(`${r.full_name}: served ${r.strike_rate} but the screen does not show it — ${t}`);
    else floorOk++;
  }
  ok(`every figure matches what the server sent or says why not (${floorOk}/${served.length})`,
     floorBad.length === 0, floorBad.slice(0, 3).join(" · "));

  // At least one row of each kind, so the equivalence above is not vacuous.
  const thin = served.filter((r) => r.strike_rate == null);
  const stated = served.filter((r) => r.strike_rate != null);
  ok("...with at least one figure actually withheld", thin.length > 0, `${thin.length} withheld`);
  if (thin.length) {
    const t = await coach.page.locator(`[data-testid="dossier-player-${thin[0].player_id}"]`).innerText();
    ok("...whose row names the evidence rather than a number",
       /too thin|no log|thin/i.test(t), t.replace(/\s+/g, " "));
  }
  ok("...and at least one stated", stated.length > 0, `${stated.length} stated`);

  // The bowling half grades separately: a boy can be too thin to read with the
  // bat and perfectly readable with the ball, and the two labels are distinct.
  const bowlGraded = served.filter((r) => r.economy != null);
  ok("a bowler with enough deliveries has an economy stated", bowlGraded.length > 0, `${bowlGraded.length}`);
  if (bowlGraded.length) {
    const t = await coach.page.locator(`[data-testid="dossier-player-${bowlGraded[0].player_id}"]`).innerText();
    ok("...and it is on the screen to two places",
       new RegExp(String(Number(bowlGraded[0].economy).toFixed(2)).replace(".", "\\.")).test(t),
       t.replace(/\s+/g, " "));
  }

  ok("the panel says the read is on the other school's record", /access log/i.test(body));

  // ── The negative that matters most ──────────────────────────────
  group("Nothing about a child's person is on the page");
  {
    // What the away pupils' rows actually hold, read as the owner. If any of
    // these values is anywhere in the rendered page, a component put back a
    // column the function deliberately left out.
    const secrets = await q(`select born::text, id_number, address, guardian, height::text, weight::text, fitness
                               from player where id = any($1)`, [[MKHIZE, BOTHA]]);
    const values = secrets.flatMap((r) => Object.values(r)).filter((v) => v != null && String(v).length > 2);
    ok("their rows do hold personal columns to leak", values.length > 0, `${values.length} values`);
    // The DOSSIER's own markup, not the whole document: the page also carries
    // the app's stylesheet, and a short enum value like the fitness state
    // 'fit' is a substring of `repeat(auto-fit,…)`. Scoping to the panel and
    // matching short values on a word boundary is what makes this assertion
    // about the component rather than about CSS.
    // Inline styles stripped first. The panel's own grid rule is
    // `repeat(auto-fit,minmax(...))`, and the clinical fitness enum 'fit' sits
    // inside `auto-fit` on a word boundary — a CSS value, not a disclosure.
    const scope = (await coach.page.locator('[data-testid="dossier"]').innerHTML())
      .replace(/style="[^"]*"/g, "");
    const leaked = values.filter((v) => {
      const t = String(v);
      return t.length >= 5
        ? scope.includes(t)
        : new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(scope);
    });
    ok("...and not one of them is in the dossier", leaked.length === 0, leaked.join(", "));
    // The column HEADINGS too: a table that renders an empty "Date of birth"
    // column has still told the reader that the field exists and is tracked.
    const headings = await coach.page.locator('[data-testid="dossier-squad"] th').allInnerTexts();
    const forbidden = headings.filter((h) => /born|birth|dob|id number|address|guardian|height|weight|fitness|injur|note/i.test(h));
    ok("no personal column is even offered as a heading", forbidden.length === 0, forbidden.join(", "));
  }

  // ── Sorting, which must not invent an order ─────────────────────
  group("The squad can be re-ordered without changing what it says");
  {
    await coach.page.locator('[data-testid="dossier-sort-bowling"]').click();
    await coach.page.waitForTimeout(400);
    const rows = await coach.page.locator('[data-testid="dossier-squad"] tbody tr').count();
    ok("sorting by wickets keeps every player", rows >= 2, String(rows));
    const first = await coach.page.locator('[data-testid="dossier-squad"] tbody tr').first().innerText();
    ok("...and puts the wicket-taker first", /Botha/.test(first), first.replace(/\s+/g, " ").slice(0, 80));
    await coach.page.locator('[data-testid="dossier-sort-batting"]').click();
    await coach.page.waitForTimeout(400);
  }

  // ── The three kinds of empty ────────────────────────────────────
  group("A window that has not opened says when it will");
  {
    await closeDossier(coach.page);
    ok("the dossier for a fixture forty days out opens", await openDossier(coach.page, later));
    const shut = await coach.page.locator('[data-testid="dossier-shut-not_yet_open"]').count();
    ok("...and is shut with the reason named", shut === 1);
    const t = await coach.page.locator('[data-testid="dossier"]').innerText();
    ok("...saying the window opens fourteen days before", /fourteen days/i.test(t));
    ok("...and when", /Opens/.test(t));
    ok("...naming no pupil of theirs", !/Mkhize|Botha/.test(t), t.replace(/\s+/g, " ").slice(0, 160));
    // The count a shut window must NOT give: how much there would be to read.
    ok("...and not counting what it is not showing", !/Deliveries/i.test(t));
  }

  group("An opponent who is not on SCRBRD has nothing to read");
  {
    await closeDossier(coach.page);
    ok("the dossier for the Michaelhouse fixture opens", await openDossier(coach.page, solo));
    ok("...and says the opponent is not on the platform",
       (await coach.page.locator('[data-testid="dossier-shut-opponent_not_on_scrbrd"]').count()) === 1);
    const t = await coach.page.locator('[data-testid="dossier"]').innerText();
    ok("...and does not infer one from our own scorecards", /nothing is inferred/i.test(t));
  }

  ok("the coach's session raised no scoping refusals", coach.refusals.length === 0, coach.refusals[0]);
  ok("...and no errors", coach.errors.length === 0, coach.errors[0]);

  group("A coach of another side at the same school is told nothing");
  {
    const other = await open();
    ok("the Hilton 2XI coach signs in", await signIn(other.page, "coach2@example.invalid"));
    ok("Match Centre opens for them", await nav(other.page, /Match Centre/));
    // Their own fixture, which they ARE in, is fine. The 1XI's is not theirs.
    if (await openDossier(other.page, soon)) {
      const t = await other.page.locator('[data-testid="dossier"]').innerText();
      if (DEBUG) console.log("[debug] wrong side:\n" + t);
      ok("the 1XI's dossier shows them no standing",
         (await other.page.locator('[data-testid="dossier-none"]').count()) === 1, t.replace(/\s+/g, " ").slice(0, 160));
      ok("...naming no Westville pupil", !/Mkhize|Botha/.test(t));
      // A REASON would confirm the fixture exists. "No dossier for you" must
      // not become "the window has not opened", which says there is one.
      ok("...and giving no reason that would confirm the fixture", !/window|not yet|opens/i.test(t));
    } else {
      ok("the 1XI's dossier is not even offered to them", true);
    }
    ok("their own side's dossier is offered",
       (await other.page.locator(`[data-testid="dossier-open-${wrongSide}"]`).count()) === 1);
    await other.ctx.close();
  }

  group("A parent is offered no dossier at all");
  {
    const parent = await open();
    ok("the guardian signs in", await signIn(parent.page, "parent@example.invalid"));
    ok("Match Centre opens for them", await nav(parent.page, /Match Centre/));
    const any = await parent.page.locator('[data-testid^="dossier-open-"]').count();
    ok("no fixture offers them a dossier button", any === 0, `${any} buttons`);
    await parent.ctx.close();
  }

  // ── Analytics: derived, not invented ────────────────────────────
  group("Head-to-Head is derived from the fixtures, not typed in");
  {
    // The dialog is modal, so it must be dismissed before the navigation —
    // clicking through a backdrop is exactly what aria-modal promises cannot
    // happen, and a walk that "failed to open Analytics" was really a walk
    // that left a dialog up.
    await closeDossier(coach.page);
    ok("Analytics opens", await nav(coach.page, /Analytics/));
    ok("...and the Head-to-Head tab", await click(coach.page, /Head-to-Head/, 4000));
    await coach.page.waitForTimeout(1600);
    const h2h = await text(coach.page);
    if (DEBUG) console.log("[debug] h2h:\n" + h2h.slice(0, 900));
    // The fabricated table this replaced, identified by ITS OWN strings
    // rather than by a school name: "Maritzburg College" is genuine seeded
    // data and appears in the derived record too, so a name cannot tell the
    // invented table from the real one. The invented RESULTS can.
    ok("the invented KZN table is gone",
       !/Won by 28 runs/.test(h2h) && !/Rain — No result/.test(h2h)
       && !/All-time results vs KZN school opponents/.test(h2h),
       h2h.replace(/\s+/g, " ").slice(0, 200));
    ok("...and the record says it is derived", /Derived from completed fixtures/i.test(h2h));
    ok("the Westville rivalry is there, from the fixtures", /Westville/i.test(h2h));
    // The honest column. The seeded past fixture has no toss recorded, so its
    // winner is not attributable and the screen must say so rather than
    // quietly filing it as a loss.
    ok("...with the undecided games counted, not dropped",
       /no toss recorded/i.test(h2h) || /Not decidable/i.test(h2h), h2h.replace(/\s+/g, " ").slice(0, 300));
  }

  group("Match-ups say how much of the log they speak for");
  {
    ok("the Match-ups tab opens", await click(coach.page, /Match-ups/, 4000));
    await coach.page.waitForTimeout(1600);
    const mu = await text(coach.page);
    if (DEBUG) console.log("[debug] matchups:\n" + mu.slice(0, 900));
    ok("the coverage is stated", /Deliveries attributed/i.test(mu));
    ok("...including what cannot be attributed", /Not attributable/i.test(mu));
    // Hilton's boy faced Botha for 36 balls, so a pair exists to draw.
    ok("a batter-against-bowler pair is drawn",
       (await coach.page.locator('[data-testid^="matchup-"]').count()) > 0);
    ok("...naming the bowler faced", new RegExp(hilPair[1].full_name.split(" ").pop()).test(mu),
       mu.replace(/\s+/g, " ").slice(0, 200));
    ok("the unattributable deliveries are explained, not hidden",
       !/Not attributable/.test(mu) || /nobody named|not on SCRBRD|does not keep its roster/i.test(mu),
       mu.replace(/\s+/g, " ").slice(0, 240));
  }

  ok("the whole session raised no scoping refusals", coach.refusals.length === 0, coach.refusals[0]);
  ok("...and no browser errors", coach.errors.length === 0, coach.errors[0]);
  await coach.ctx.close();
} catch (e) {
  fail++;
  console.log("  ✗ walk aborted:", e.message);
} finally {
  await browser.close().catch(() => {});
  web.close();
  api.kill();
  await pool.end().catch(() => {});
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}

console.log("\n" + "─".repeat(52));
console.log(`BROWSER DOSSIER SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

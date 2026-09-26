#!/usr/bin/env node
/**
 * SCRBRD-084 / SCRBRD-086 — Season Awards / MVP, from a browser, season by
 * season.
 *
 * `career` (services/api/read/read-api.mjs) sums directly off raw
 * `ball_event` rows through `player_batting_career` / `player_bowling_career`
 * (db/02_schema_scoring.sql), and `career_by_season` sums the same rows
 * grouped by the school season each MATCH is in (db/44). Neither needs the
 * `innings_start`/`batters`/`bowler` orchestration the fold GET
 * /matches/:id/events replays, so this walk writes plain `kind: 'ball'` rows
 * directly, striker_id/bowler_id set per row, the same shape
 * db/98_seed_pilot.sql's own match uses for an opposition bowler it holds no
 * row for (bowler_id NULL) — here the same trick the other way: a player's
 * batting figures need no bowler on file, and a bowler's figures need no
 * opposition batter on file, so whichever side this fixture is not naming
 * rides as NULL rather than inventing a row.
 *
 * THREE FIXTURES, TWO SCHOOL SEASONS. The seasons are asked of the database
 * (school_season_of(), db/44), never worked out here:
 *   this season  — today, 09:00 in Johannesburg;
 *   New Year     — 23:30 UTC on 31 December of last year: 01:30 on 1 January
 *                  in Johannesburg, so THIS season, though its UTC date is
 *                  last year's;
 *   last season  — a year ago today.
 *
 * EIGHT PLAYERS, EACH PROVING ONE RULE:
 *   Star Allrounder  — clears BOTH floors (packages/scoring's
 *                      MIN_BALLS_FACED / MIN_BALLS_BOWLED) this season: on
 *                      every table.
 *   Top Scorer       — batting only, comfortably above the batting floor.
 *   Leading Bowler   — bowling only, comfortably above the bowling floor.
 *   Thin Player      — 10 balls faced. On the plain run-scorer count (which
 *                      has no floor) and NOWHERE an index is ranked.
 *   Other Team Star  — a different team_code (10XI), with this season's
 *                      single highest run total: present when nothing is
 *                      scoped, gone the moment the tab is scoped to 9XI.
 *   Last Season Star — last season only, and more runs than anybody this
 *                      season: absent from this season's lists, first on
 *                      last season's, first across every season.
 *   Split Allrounder — 20 balls faced and 24 bowled in EACH season: below
 *                      both floors in either, above both across the two. The
 *                      floor applies per season.
 *   New Year Boy     — twelve balls, all in the New Year fixture: this
 *                      season's, by the Johannesburg calendar.
 *
 * WHAT IS CHECKED. Through the API: the season rows summed over seasons are
 * `career`, for every player, for a director, a 1XI coach and a Westville
 * administrator — and the Westville administrator reads nothing of Hilton's.
 * Through the screen: the tab opens on this season and offers only the
 * seasons with figures; each season shows its own players; and "All seasons"
 * is the tab exactly as it was before seasons existed — the `career` read,
 * ranked by the same functions, list for list and row for row.
 *
 * Every wait is on data — a name on the screen, a value in a select — never
 * on a fixed time: a fixed 1.2 s was what failed on a slower CI machine.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-awards.mjs
 *   BROWSER_AWARDS_DEBUG=1 node tools/smoke-browser-awards.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
// The rankings the tab itself runs (unchanged by SCRBRD-086), so "All
// seasons" can be held to what the `career` read ranks to — the tab's
// behaviour before seasons. NOT the new season helpers: the expected season
// lists are built below without them, so a bug in one cannot hide in both.
import {
  bestBattingAverages, bestBowlingEconomies, mvpRanking, topRunScorers, topWicketTakers,
} from "../apps/web/src/lib/seasonAwards.js";

const WEB_PORT = 5303;
const API_PORT = 8803;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const DEBUG = !!process.env.BROWSER_AWARDS_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const WAIT = 20000;

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-awards-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

// ── The API, as a person ──────────────────────────────────────────
const token = async (email) => (await (await fetch(`${API}/api/auth/dev-login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, deviceId: "device-awards-api" }) })).json())?.token;
const read = async (tok, resource) => {
  const r = await fetch(`${API}/api/read/${resource}`, { headers: { authorization: `Bearer ${tok}` } });
  if (r.status !== 200) throw new Error(`${resource}: ${r.status} ${await r.text()}`);
  return (await r.json()).rows;
};
const FIGURES = ["bat_matches", "runs", "balls_faced", "fours", "sixes", "dismissals",
                 "bowl_matches", "runs_conceded", "balls_bowled", "wickets"];
/** Players whose `career` row is not the sum of their `career_by_season` rows. */
function drift(career, bySeason) {
  const sums = new Map();
  for (const r of bySeason) {
    const s = sums.get(r.player_id) ?? Object.fromEntries(FIGURES.map((f) => [f, 0]));
    for (const f of FIGURES) s[f] += Number(r[f]);
    sums.set(r.player_id, s);
  }
  const out = [];
  for (const c of career) {
    const s = sums.get(c.player_id) ?? Object.fromEntries(FIGURES.map((f) => [f, 0]));
    const bad = FIGURES.filter((f) => Number(c[f]) !== s[f]);
    if (bad.length) out.push(`${c.full_name}: ${bad.map((f) => `${f} ${c[f]} vs ${s[f]}`).join(", ")}`);
    sums.delete(c.player_id);
  }
  for (const id of sums.keys()) out.push(`${id}: in career_by_season, not in career`);
  return out;
}

// asCareer() (apps/web/src/lib/live.js), for the fields the rankings read.
const round2 = (n) => Math.round(n * 100) / 100;
const asCareerLite = (r) => {
  const runs = Number(r.runs), balls = Number(r.balls_faced), outs = Number(r.dismissals);
  const conceded = Number(r.runs_conceded), bowled = Number(r.balls_bowled), wkts = Number(r.wickets);
  return { id: r.player_id, name: r.full_name, team: r.team_code, school: r.school_id, season: r.season,
           runs, ballsFaced: balls, dismissals: outs, avg: outs > 0 ? round2(runs / outs) : null,
           wkts, ballsBowled: bowled, runsConceded: conceded, econ: bowled > 0 ? round2((conceded * 6) / bowled) : null };
};
/** The five lists the tab draws, as player ids in order, from ranking input. */
const rank = (players) => ({
  runs: topRunScorers(players).map((p) => p.id),
  wkts: topWicketTakers(players).map((p) => p.id),
  bat: bestBattingAverages(players).map((x) => x.player.id),
  bowl: bestBowlingEconomies(players).map((x) => x.player.id),
  mvp: mvpRanking(players).map((x) => x.player.id),
});

// ── The screen ────────────────────────────────────────────────────
const browser = await chromium.launch({ ...launchOptions() });

async function open() {
  const ctx = await browser.newContext();
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  // Every read the screen makes, and how it ended: printed beside a failed
  // check, so a failure on a slower machine says which read did not arrive
  // rather than only that a list was empty.
  const reads = [];
  const t0 = Date.now();
  page.on("requestfinished", async (r) => {
    if (!/\/api\/read\//.test(r.url())) return;
    const res = await r.response().catch(() => null);
    reads.push(`${r.url().replace(/^.*\/api\/read\//, "")} ${res?.status() ?? "?"} @${Date.now() - t0}ms`);
  });
  page.on("requestfailed", (r) => {
    if (/\/api\/read\//.test(r.url())) reads.push(`${r.url().replace(/^.*\/api\/read\//, "")} FAILED ${r.failure()?.errorText} @${Date.now() - t0}ms`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, reads };
}

/** Click the first enabled button matching `re`, waiting for it to exist. */
const press = async (page, re, scope = "button:not([disabled])") => {
  try { await page.locator(scope, { hasText: re }).first().click({ timeout: WAIT }); return true; }
  catch { return false; }
};
/** Wait until `fn(arg)` is true in the page; false on timeout — the checks after it decide. */
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: WAIT }).then(() => true, () => false);

async function signIn(page, who) {
  if (!(await press(page, /Get Started|Log In/))) return false;
  // The pilot accounts appear once the page has found the server.
  if (!(await press(page, who))) return false;
  if (!(await press(page, /^Sign In$/))) return false;
  return until(page, () => /Match Centre|Dashboard/i.test(document.body.innerText));
}
async function nav(page, label) {
  if (!(await press(page, label, "nav button"))) return false;
  return until(page, () => /League Management/.test(document.body.innerText));
}

/** What the Awards tab shows right now: the season select, and each list's player ids. */
const screen = (page) => page.evaluate(() => {
  const sel = document.querySelector('[data-testid="awards-season-select"]');
  const ids = (id) => [...document.querySelectorAll(`[data-testid="${id}-row"]`)].map((e) => e.getAttribute("data-player"));
  return {
    season: sel?.value ?? null,
    disabled: sel?.disabled ?? null,
    options: sel ? [...sel.options].map((o) => o.value) : [],
    scope: document.querySelector('[data-testid="awards-season-scope"]')?.textContent ?? "",
    lists: { runs: ids("awards-run-scorers"), wkts: ids("awards-wicket-takers"), bat: ids("awards-batting-index"),
             bowl: ids("awards-bowling-index"), mvp: ids("awards-mvp") },
  };
});
/** Wait until the select reads `season` and the named players are on / off the run-scorers list. */
const settled = (page, season, on = [], off = []) => until(page, ({ season, on, off }) => {
  const sel = document.querySelector('[data-testid="awards-season-select"]');
  if (!sel || sel.disabled || sel.value !== season) return false;
  const ids = [...document.querySelectorAll('[data-testid="awards-run-scorers-row"]')].map((e) => e.getAttribute("data-player"));
  return on.every((id) => ids.includes(id)) && off.every((id) => !ids.includes(id));
}, { season, on, off });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const everywhere = (lists, id) => Object.values(lists).some((l) => l.includes(id));

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  group("Building eight players' figures across two school seasons, directly on the ball log");
  const su = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  // The seasons, from the database: this one, and the one a year ago.
  const [{ cur, prev }] = await q(`select school_season_of(now()) as cur,
                                          school_season_of(now() - interval '1 year') as prev`);
  ok(`two different school seasons to split (${cur} and ${prev})`, cur && prev && cur !== prev, `${cur} / ${prev}`);

  const mkPlayer = async (name, team) => (await q(
    `insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
     values ($1, $2, $3, 91, 'batter', current_date - interval '16 years') returning id`, [HIL, team, name]))[0].id;
  const SA = await mkPlayer("Star Allrounder", "9XI");
  const TS = await mkPlayer("Top Scorer", "9XI");
  const LB = await mkPlayer("Leading Bowler", "9XI");
  const TP = await mkPlayer("Thin Player", "9XI");
  const OT = await mkPlayer("Other Team Star", "10XI");
  const LS = await mkPlayer("Last Season Star", "9XI");
  const SP = await mkPlayer("Split Allrounder", "9XI");
  const NY = await mkPlayer("New Year Boy", "9XI");
  const NAME = { [SA]: "Star Allrounder", [TS]: "Top Scorer", [LB]: "Leading Bowler", [TP]: "Thin Player",
                 [OT]: "Other Team Star", [LS]: "Last Season Star", [SP]: "Split Allrounder", [NY]: "New Year Boy" };

  const fixture = async (opponent, startsAtSql, school = HIL, team = "9XI") => (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1, $3, $2, ${startsAtSql}, 'T20', 20, 'complete') returning id, starts_at`, [school, opponent, team]))[0];
  // Today at 09:00 in Johannesburg: this season whatever the date (a
  // "three days ago" fixture is last season for three days every January).
  const mCur = await fixture("Awards CC", `(sa_today() + time '09:00') at time zone 'Africa/Johannesburg'`);
  const mPrev = await fixture("Awards CC (last season)", `(sa_today() - interval '1 year' + time '09:00') at time zone 'Africa/Johannesburg'`);
  // 23:30 UTC on 31 December of the year before this season's: 01:30 on
  // 1 January in Johannesburg — this season, on last year's UTC date.
  const mNY = await fixture("Awards CC (New Year)", `make_timestamptz(${Number(cur) - 1}, 12, 31, 23, 30, 0, 'UTC')`);
  // Westville's own fixture this season, so a Westville reader has figures
  // to read at all — with one delivery bowled by a Hilton boy, which neither
  // school may read the other's side of.
  const mWes = await fixture("Awards Westville XI", `(sa_today() + time '09:00') at time zone 'Africa/Johannesburg'`, WES, "1XI");
  const MKHIZE = "bbbbbbbb-0000-0000-0000-000000000001";

  let seq = 0;
  // A plain `kind: 'ball'` row — no innings_start/batters/bowler needed, since
  // the career views sum straight off striker_id / bowler_id per row, never
  // through the JS fold. The opposite side of whichever this row is about
  // rides as NULL — the same discipline db/98_seed_pilot.sql's own match uses
  // for a bowler this platform holds no row for.
  // school_id from the match, as the write path stamps it (match_school()).
  const ball = (match, { striker = null, bowler = null, value = 0, wicket = false }) => {
    seq += 1;
    return q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                               idempotency_key, client_seq, client_ts, kind, ball_type, value,
                               striker_id, bowler_id, dismissal, payload)
       values ($1,match_school($1),$2,1,0,$3,'device-awards',$4,$2,now(),'ball',$5,$6,$7,$8,$9,'{}'::jsonb)`,
      [match, seq, su, `awards-${seq}`, wicket ? "W" : "run", value, striker, bowler, wicket ? "bowled" : null]);
  };
  const battingRuns = async (m, p, count, value) => { for (let i = 0; i < count; i++) await ball(m, { striker: p, value }); };
  const bowlingRuns = async (m, p, count, value) => { for (let i = 0; i < count; i++) await ball(m, { bowler: p, value }); };
  const battingWicket = (m, p) => ball(m, { striker: p, wicket: true });
  const bowlingWicket = (m, p) => ball(m, { bowler: p, wicket: true });

  // THIS SEASON. Star Allrounder: 40 balls faced (39 for 39, then out) —
  // clears the 30-ball batting floor; 36 balls bowled, 6 wickets — exactly
  // at the 36-ball bowling floor ("at the floor a number appears").
  await battingRuns(mCur.id, SA, 39, 1); await battingWicket(mCur.id, SA);
  await bowlingRuns(mCur.id, SA, 30, 1); for (let i = 0; i < 6; i++) await bowlingWicket(mCur.id, SA);
  // Top Scorer: batting only, well clear of the floor.
  await battingRuns(mCur.id, TS, 59, 2); await battingWicket(mCur.id, TS);
  // Leading Bowler: bowling only, more wickets than anyone — but a worse
  // economy than the allrounder, so the index ranks the RATE, not the count.
  await bowlingRuns(mCur.id, LB, 52, 1); for (let i = 0; i < 8; i++) await bowlingWicket(mCur.id, LB);
  // Thin Player: ten balls faced — below MIN_BALLS_FACED.
  await battingRuns(mCur.id, TP, 8, 2); await battingRuns(mCur.id, TP, 2, 0);
  // Other Team Star: this season's single highest run total, on 10XI.
  await battingRuns(mCur.id, OT, 65, 2); await battingWicket(mCur.id, OT);
  // New Year Boy: twelve singles, all in the New Year fixture.
  await battingRuns(mNY.id, NY, 12, 1);

  // LAST SEASON. Last Season Star: 140 runs, more than anybody this season.
  await battingRuns(mPrev.id, LS, 70, 2); await battingWicket(mPrev.id, LS);

  // BOTH. Split Allrounder: 20 balls faced (19 singles, then out) and 24
  // bowled (23 singles, then a wicket) in each season — under both floors
  // in either, over both across the two.
  for (const m of [mCur.id, mPrev.id]) {
    await battingRuns(m, SP, 19, 1); await battingWicket(m, SP);
    await bowlingRuns(m, SP, 23, 1); await bowlingWicket(m, SP);
  }

  // WESTVILLE. D Mkhize faces six; one of them is bowled by Leading Bowler.
  await battingRuns(mWes.id, MKHIZE, 5, 1);
  await ball(mWes.id, { striker: MKHIZE, bowler: LB, value: 4 });

  group("Through the API: a season is the match's, and the seasons add up to the career");
  const [sarahTok, coachTok, wesTok] = await Promise.all(
    ["sarah@example.invalid", "coach@example.invalid", "registrar.wes@example.invalid"].map(token));
  ok("three people signed in for the API checks", !!(sarahTok && coachTok && wesTok));
  const sarahCareer = await read(sarahTok, "career");
  const sarahSeasons = await read(sarahTok, "career_by_season");
  const seasonsSeen = [...new Set(sarahSeasons.map((r) => r.season))].sort();
  ok(`the director's figures fall in exactly this season and last (${cur}, ${prev})`,
     same(seasonsSeen, [prev, cur].sort()), seasonsSeen.join(", "));
  const d = drift(sarahCareer, sarahSeasons);
  ok("for every player the director can read, the seasons sum to /read/career — every figure", d.length === 0, d.join(" | "));
  ok("...and there is something to sum: the split allrounder has a row in each season",
     sarahSeasons.filter((r) => r.player_id === SP).length === 2);
  ok("current_season is exactly this season's rows",
     sarahSeasons.every((r) => r.current_season === (r.season === cur)));
  const nyRows = sarahSeasons.filter((r) => r.player_id === NY);
  ok(`the New Year fixture's runs are ${cur}'s — the Johannesburg date, not the UTC one`,
     nyRows.length === 1 && nyRows[0].season === cur && Number(nyRows[0].runs) === 12, JSON.stringify(nyRows));
  const [nyUtc] = await q(`select extract(year from starts_at at time zone 'UTC')::int as y from match where id = $1`, [mNY.id]);
  ok("...and it really does straddle the line: its UTC date is last year's", nyUtc.y === Number(cur) - 1, nyUtc.y);
  const nyFixture = (await read(sarahTok, "matches")).find((m) => m.id === mNY.id);
  ok("the fixture list files the same fixture under the same season", nyFixture?.season === cur, nyFixture?.season);
  const onlyCur = await read(sarahTok, `career_by_season?season=${encodeURIComponent(cur)}`);
  ok(`?season=${cur} is exactly that season's rows`,
     onlyCur.length > 0 && same(onlyCur, sarahSeasons.filter((r) => r.season === cur)), `${onlyCur.length} rows`);
  ok("a season nobody played in has no rows", (await read(sarahTok, `career_by_season?season=${Number(prev) - 1}`)).length === 0);

  const coachCareer = await read(coachTok, "career");
  const coachSeasons = await read(coachTok, "career_by_season");
  const dc = drift(coachCareer, coachSeasons);
  ok("the 1XI coach's seasons sum to HIS career read — a narrower reader, the same rule", dc.length === 0, dc.join(" | "));
  ok("...who reads no figure from the 9XI fixtures he cannot see",
     !coachSeasons.some((r) => Object.keys(NAME).includes(r.player_id)), coachSeasons.map((r) => r.full_name).join(", "));
  const wesSeasons = await read(wesTok, "career_by_season");
  const mkhize = wesSeasons.filter((r) => r.player_id === MKHIZE);
  ok(`a Westville administrator reads his own boy's ${cur} figures`,
     mkhize.length === 1 && mkhize[0].season === cur && Number(mkhize[0].runs) === 9, JSON.stringify(mkhize));
  ok("...and nothing of Hilton's by season — not even the Hilton boy who bowled in his fixture",
     wesSeasons.length > 0 && wesSeasons.every((r) => r.school_id === WES) && !wesSeasons.some((r) => r.player_id === LB),
     wesSeasons.map((r) => r.full_name).join(", "));
  const dw = drift(await read(wesTok, "career"), wesSeasons);
  ok("...and his own seasons sum to his own career read", dw.length === 0, dw.join(" | "));
  const lbCur = sarahSeasons.find((r) => r.player_id === LB && r.season === cur);
  ok("the director's figures for that Hilton boy leave out the Westville delivery she cannot read (60 balls, not 61)",
     Number(lbCur?.balls_bowled) === 60, JSON.stringify(lbCur));

  // What the tab should draw, from the same reads and the same rankings.
  const players = (await read(sarahTok, "players")).map((p) => ({ id: p.id, name: p.full_name, team: p.team_code, school: p.school_id }));
  const careerById = new Map(sarahCareer.map((c) => [c.player_id, asCareerLite(c)]));
  // usePlayersWithCareer(): each player row with its career laid over it.
  const allSeasons = players.map((p) => { const c = careerById.get(p.id); return c ? { ...p, ...c, name: p.name ?? c.name } : p; });
  const bySeason = sarahSeasons.map(asCareerLite);
  // One season's ranking input, written out here rather than imported: that
  // season's rows of the read, each over the player's own row, in the read's
  // order.
  const byId = new Map(players.map((p) => [p.id, p]));
  const inSeason = (label) => bySeason.filter((r) => r.season === label)
    .map((r) => ({ ...(byId.get(r.id) ?? {}), ...r, name: byId.get(r.id)?.name ?? r.name }));
  const EXPECT = { all: rank(allSeasons), [cur]: rank(inSeason(cur)), [prev]: rank(inSeason(prev)) };
  if (DEBUG) console.log("[debug] expected:", JSON.stringify(EXPECT, null, 1));

  group("A director of sport opens Leagues and the Awards tab");
  const dos = await open();
  ok("signs in as the director of sport", await signIn(dos.page, /sarah@example\.invalid|Director/));
  ok("Leagues opens", await nav(dos.page, /Leagues/));
  ok("the Awards tab is offered", await press(dos.page, /^Awards$/i));
  const awards = dos.page.locator('[data-testid="season-awards"]');

  group(`It opens on this season (${cur}), and offers only the seasons with figures`);
  ok(`the season select settles on ${cur}, with this season's run-scorers loaded`,
     await settled(dos.page, cur, [TS, OT], [LS]));
  ok("the Awards screen renders", await awards.count() === 1);
  let s = await screen(dos.page);
  if (DEBUG) console.log("[debug] this season:", JSON.stringify(s));
  ok(`the default is the current season, ${cur}`, s.season === cur, s.season);
  ok(`the options are every season, ${cur} and ${prev} — no empty season offered`,
     same(s.options, ["all", cur, prev]), s.options.join(", "));
  ok("the screen says which season the lists cover", s.scope.includes(cur), s.scope);

  group("This season: only this season's players");
  ok("Last Season Star is on no list this season", !everywhere(s.lists, LS), JSON.stringify(s.lists));
  ok("every player on every list has figures this season",
     Object.values(s.lists).flat().every((id) => bySeason.some((r) => r.id === id && r.season === cur)));
  ok("the New Year fixture's runs count this season (the Johannesburg calendar)", s.lists.runs.includes(NY), s.lists.runs.map((id) => NAME[id] ?? id).join(", "));
  ok("every list is exactly this season's ranking, row for row", same(s.lists, EXPECT[cur]),
     `${JSON.stringify(s.lists)} vs ${JSON.stringify(EXPECT[cur])}`);
  ok("the season's single highest scorer (a different team) is named", s.lists.runs[0] === OT, s.lists.runs.map((id) => NAME[id] ?? id).join(", "));
  ok("a thin sample is still a real score on the run-scorers list", s.lists.runs.includes(TP));
  ok("the leading wicket-taker is named", s.lists.wkts.includes(LB));
  ok("Other Team Star outranks Top Scorer on runs alone", s.lists.runs.indexOf(OT) < s.lists.runs.indexOf(TS), s.lists.runs.join(" | "));

  group("The sample floor, per season: this season's balls alone");
  ok("Thin Player is on no index table", !s.lists.bat.includes(TP) && !s.lists.bowl.includes(TP));
  ok("...nor the MVP table", !s.lists.mvp.includes(TP));
  ok("the allrounder — both floors cleared — IS on the MVP table", s.lists.mvp.includes(SA));
  ok("the split allrounder's twenty balls are a score on the run-scorers list", s.lists.runs.includes(SP));
  ok("...but no batting index, no bowling index and no MVP rating this season",
     !s.lists.bat.includes(SP) && !s.lists.bowl.includes(SP) && !s.lists.mvp.includes(SP), JSON.stringify(s.lists));

  group(`Switching to last season (${prev}) changes the lists`);
  await dos.page.selectOption('[data-testid="awards-season-select"]', prev);
  ok(`the lists settle on ${prev}: Last Season Star in, Top Scorer out`, await settled(dos.page, prev, [LS], [TS]));
  s = await screen(dos.page);
  if (DEBUG) console.log("[debug] last season:", JSON.stringify(s));
  ok("Last Season Star tops last season's run-scorers", s.lists.runs[0] === LS, s.lists.runs.map((id) => NAME[id] ?? id).join(", "));
  ok("this season's players are gone: Top Scorer, Other Team Star, Leading Bowler, Star Allrounder, New Year Boy",
     ![TS, OT, LB, SA, NY].some((id) => everywhere(s.lists, id)), JSON.stringify(s.lists));
  ok("the split allrounder is on last season's run-scorers, and still below both floors",
     s.lists.runs.includes(SP) && !s.lists.bat.includes(SP) && !s.lists.bowl.includes(SP) && !s.lists.mvp.includes(SP));
  ok("every list is exactly last season's ranking, row for row", same(s.lists, EXPECT[prev]),
     `${JSON.stringify(s.lists)} vs ${JSON.stringify(EXPECT[prev])}`);
  ok("the screen says so", s.scope.includes(prev), s.scope);

  group("All seasons is the tab as it was before seasons: the career read, ranked the same way");
  await dos.page.selectOption('[data-testid="awards-season-select"]', "all");
  const allSettled = await settled(dos.page, "all", [LS, TS, OT]);
  ok("the lists settle on every season: both seasons' stars", allSettled,
     allSettled ? "" : `reads: ${dos.reads.filter((r) => /^(players|career)\b/.test(r)).join("; ")} | errors: ${dos.errors.join("; ").slice(0, 300)}`);
  s = await screen(dos.page);
  if (DEBUG) console.log("[debug] all seasons:", JSON.stringify(s));
  for (const list of ["runs", "wkts", "bat", "bowl", "mvp"])
    ok(`"${list}" is exactly /read/career's ranking, row for row`, same(s.lists[list], EXPECT.all[list]),
       `${s.lists[list].map((id) => NAME[id] ?? id).join(", ")} vs ${EXPECT.all[list].map((id) => NAME[id] ?? id).join(", ")}`);
  ok("Last Season Star's 140 tops the run-scorers across every season", s.lists.runs[0] === LS);
  ok("the split allrounder's two seasons clear both floors together: batting index, bowling index and MVP",
     s.lists.bat.includes(SP) && s.lists.bowl.includes(SP) && s.lists.mvp.includes(SP), JSON.stringify(s.lists));
  ok("the screen says every season", /every season/i.test(s.scope), s.scope);

  group("Scoped to team 9XI, this season: the other team's star disappears entirely");
  await dos.page.selectOption('[data-testid="awards-season-select"]', cur);
  ok(`back on ${cur}`, await settled(dos.page, cur, [TS], [LS]));
  ok("the team selector is offered", await dos.page.locator('[data-testid="awards-team-select"]').count() === 1);
  await dos.page.selectOption('[data-testid="awards-team-select"]', "9XI");
  ok("the scope applies: Other Team Star gone, Top Scorer still here", await settled(dos.page, cur, [TS], [OT]));
  const scopedText = await awards.innerText();
  if (DEBUG) console.log("[debug] awards (team 9XI):\n" + scopedText);
  ok("Other Team Star is gone from every list once scoped to 9XI", !/Other Team Star/.test(scopedText), scopedText.slice(0, 400));
  ok("Top Scorer is still here — the same team, unaffected by the scope narrowing", /Top Scorer/.test(scopedText));

  group("MVP: the batting specialist at the index ceiling outranks a blended, sub-ceiling rating");
  s = await screen(dos.page);
  ok("Top Scorer (batting index at its ceiling — see STAT_ANCHORS) ranks first once Other Team Star is scoped out",
     s.lists.mvp[0] === TS, s.lists.mvp.map((id) => NAME[id] ?? id).join(" | "));
  ok("the allrounder is still on the table, ranked below the ceiling specialist",
     s.lists.mvp.indexOf(SA) > 0, s.lists.mvp.map((id) => NAME[id] ?? id).join(" | "));

  ok("no console errors on the director of sport's session", dos.errors.length === 0, dos.errors.join(" | "));
  await dos.ctx.close().catch(() => {});

  // CI once saw exactly this: `career FAILED net::ERR_ABORTED` at the client's
  // ten seconds. Five empty lists would say nobody scored; the tab must say
  // the figures did not arrive, and offer to ask again.
  group("A career read that fails is said, with a Retry — never drawn as empty lists");
  const bad = await open();
  let failing = true;
  await bad.page.route(/\/api\/read\/career(\?.*)?$/, (route) => (failing ? route.abort("timedout") : route.continue()));
  ok("signs in as the director of sport", await signIn(bad.page, /sarah@example\.invalid|Director/));
  ok("Leagues opens", await nav(bad.page, /Leagues/));
  ok("the Awards tab is offered", await press(bad.page, /^Awards$/i));
  ok(`this season still ranks: it is career_by_season's (${cur})`, await settled(bad.page, cur, [TS], [LS]));
  await bad.page.selectOption('[data-testid="awards-season-select"]', "all");
  const said = await until(bad.page, () => !!document.querySelector('[data-testid="awards-error"]'));
  ok("every season, whose read failed, says the figures could not be loaded", said,
     (await bad.page.locator('[data-testid="season-awards"]').innerText().catch(() => "")).slice(0, 300));
  const errText = said ? await bad.page.locator('[data-testid="awards-error"]').innerText() : "";
  ok("...in plain words", /could not be loaded/i.test(errText) && /not a season in which nobody scored/i.test(errText), errText);
  ok("...and draws no list at all", await bad.page.locator('[data-testid="awards-run-scorers"]').count() === 0);
  const retry = bad.page.locator('[data-testid="awards-retry"]');
  const box = said ? await retry.boundingBox() : null;
  ok("a Retry button, at least 44px tall and wide", !!box && box.height >= 44 && box.width >= 44, JSON.stringify(box));
  failing = false;
  if (said) await retry.click();
  const back = await settled(bad.page, "all", [LS, TS, OT]);
  ok("Retry reads again, and the lists arrive", back, bad.reads.filter((r) => /^career\b/.test(r)).join("; "));
  ok("...and the error is gone", back && await bad.page.locator('[data-testid="awards-error"]').count() === 0);
  await bad.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser awards walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 10).join("\n"));
} finally {
  await pool.end().catch(() => {});
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SEASON AWARDS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

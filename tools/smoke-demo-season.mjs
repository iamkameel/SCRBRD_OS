#!/usr/bin/env node
/**
 * The demo season, proved through the real API with dev login.
 *
 * RUN BY HAND, never in CI, and only against a local REPLICA of the demo:
 *
 *   SCRBRD_DB=demo_season SCRBRD_DB_PORT=5433 node tools/migrate.mjs --reset --seed
 *   SCRBRD_DB=demo_season SCRBRD_DB_PORT=5433 node tools/demo-replica.mjs
 *   node tools/demo-season.mjs <dir>  &&  psql … -f <dir>/demo-season-1.sql … -N.sql
 *   SCRBRD_DB=demo_season SCRBRD_DB_PORT=5433 SCRBRD_PORT_OFFSET=171 node tools/smoke-demo-season.mjs
 *   node tools/demo-season.mjs --live <ISO> <dir>  &&  psql … -f <dir>/demo-live.sql
 *   … node tools/smoke-demo-season.mjs --live      the live match: par, and the pad scores one more ball
 *   … node tools/smoke-demo-season.mjs --browser [shots-dir]   screenshots (needs apps/web/dist)
 *
 * It starts the API with NODE_ENV=development and ALLOW_DEV_LOGIN=1, as the
 * demo service runs, signs in by email as the cast, and reads what their
 * screens read. --live also WRITES one ball, through the pad's own routes.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { deriveMatch, fromRow, ball, BALL_TYPE } from "@scrbrd/scoring";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const LIVE = process.argv.includes("--live");
const BROWSER = process.argv.includes("--browser");
const SHOTS = BROWSER ? (process.argv[process.argv.indexOf("--browser") + 1] ?? "/tmp/demo-season-shots") : null;
const API_PORT = port(8874);
const WEB_PORT = port(4374);
const API = `http://127.0.0.1:${API_PORT}`;
const WES = "22222222-2222-2222-2222-222222222222";
const KEA = "33333333-3333-3333-3333-333333333333";
const LEAGUE = "99999999-0000-0000-0000-000000000001";
const CAPTAIN = "de300000-0000-4000-8000-000000000001";
const U14A_BOY = "de300000-0000-4000-8000-000000000106";
const LIVE_ID = "de5e0000-0000-4000-a000-000000000201";
const DUTIES = ["umpire", "third_umpire", "referee", "scorer", "scoring", "squad", "ground", "transport"];

let pass = 0, fail = 0;
const TIMES = [];
const ok = (n, c, d) => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 400)}`); } };
const group = (t) => console.log("\n" + t);

const dbUrl = new URL(ownerUrl());
if (!["127.0.0.1", "localhost", "::1"].includes(dbUrl.hostname)) {
  console.error("✗ refusing: this proof runs against a database on this machine only, never the demo itself.");
  process.exit(2);
}
const owner = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await owner.query(text, params)).rows;
const [{ played }] = await q(`select count(*)::int as played from match where status = 'complete' and away_school_id = $1 or (status = 'complete' and school_id = $1)`, [KEA]);
if (played < 10) {
  console.error(`✗ this database (${dbUrl.pathname.slice(1)}) holds no demo season (${played} matches). Paste it first (see the header).`);
  await owner.end(); process.exit(2);
}

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-demo-season-secret",
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "smoke-demo-season-public-pseudonym-secret-0123456789",
         ...(BROWSER ? { WEB_ORIGIN: `http://localhost:${WEB_PORT}` } : {}) },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const call = async (path, { method = "GET", token, body, wait = 45000 } = {}) => {
  const t0 = Date.now();
  const res = await fetch(API + path, {
    signal: AbortSignal.timeout(wait),
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const out = { status: res.status, body: await res.json().catch(() => null), ms: Date.now() - t0 };
  if (out.ms > 5000) console.log(`    (slow: ${path.split("?")[0]} took ${(out.ms / 1000).toFixed(1)} s)`);
  return out;
};
const login = async (email, deviceId = "device-demo-season") =>
  (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const rows = async (token, resource, qs = "") => {
  try {
    const r = await call(`/api/read/${resource}${qs}`, { token });
    return r.status === 200 ? (r.body?.rows ?? []) : null;
  } catch (e) { console.log(`    (${resource}: ${e.name === "TimeoutError" ? "no answer in 45 s" : e.message})`); return null; }
};

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await call("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the API is up with dev login on", (await call("/api/health")).body?.auth === "dev_login_enabled");
  if (BROWSER) await browserCheck();
  else if (LIVE) await liveCheck();
  else await seasonCheck();
} catch (e) {
  fail++;
  console.log("  ✗ the run stopped:", e?.stack ?? e);
} finally {
  server.kill();
  await owner.end();
  if (fail && serverErr.length) console.log("\nAPI stderr (tail):\n" + serverErr.join("").slice(-1500));
  console.log(`\n${"─".repeat(52)}\nDEMO SEASON ${BROWSER ? "BROWSER" : LIVE ? "LIVE" : "API"}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

async function seasonCheck() {
  const t = {};
  for (const e of ["coach.wes.1xi", "coach.wes.u14a", "coach.kea.1xi", "scorer1.wes", "dos.wes", "parent.106", "parent.001",
                   "pupil.wes.1xi", "pupil.wes.u14a", "league", "transport.wes", "driver.wes"]) t[e] = await login(`${e}@example.invalid`);
  group("The cast signs in");
  for (const [e, v] of Object.entries(t)) ok(`${e} signs in`, !!v);

  group("The reads the tour uses, timed (target: under 3 s each)");
  const [m17] = await q(`select id from match where school_id = $1 and team_code = '1XI' and starts_at = timestamptz '2026-10-17 08:00:00+00'`, [WES]);
  const timed = [
    ["career, the 1XI coach (his school)", "coach.wes.1xi", "/api/read/career"],
    ["career_by_season, the 1XI coach", "coach.wes.1xi", "/api/read/career_by_season"],
    ["career, a parent (one child)", "parent.106", "/api/read/career"],
    ["milestones, the 1XI", "coach.wes.1xi", "/api/read/milestones?teamCode=1XI"],
    ["milestones, a parent's child", "parent.106", `/api/read/milestones?playerId=${U14A_BOY}`],
    ["personal_bests, the captain", "pupil.wes.1xi", `/api/read/personal_bests?playerId=${CAPTAIN}`],
    ["matches, the 1XI coach", "coach.wes.1xi", "/api/read/matches"],
    ["matches, the director of sport", "dos.wes", "/api/read/matches"],
    ["record_boards, the 1XI", "coach.wes.1xi", `/api/read/record_boards?schoolId=${WES}&teamCode=1XI`],
    ["the Match Centre scorecard's log", "coach.wes.1xi", `/api/matches/${m17.id}/events`],
  ];
  for (const [label, who, path] of timed) {
    let r;
    try { r = await call(path, { token: t[who], wait: 60000 }); } catch (e) { r = { status: e.name, ms: 60000 }; }
    TIMES.push([label, r.ms, r.status]);
    ok(`${label}: ${(r.ms / 1000).toFixed(2)} s (${r.status})`, r.status === 200 && r.ms < 3000);
  }

  group("The Match Centre: results, each with a scorecard (GET /api/read/matches, /api/matches/:id/events)");
  const ms = (await rows(t["scorer1.wes"], "matches")) ?? [];
  const done = ms.filter((m) => m.status === "complete" && (m.school_id === KEA || m.away_school_id === KEA));
  ok(`a Westville scorer sees the season's results (${done.length} complete)`, done.length >= 10);
  const one = done.find((m) => m.team_code === "1XI" && m.school_id === WES);
  const ev = await call(`/api/matches/${one.id}/events`, { token: t["scorer1.wes"] });
  const evs = ev.body?.events ?? ev.body?.rows ?? [];
  ok(`the 1XI's result has its ball log (${evs.length} events)`, evs.length > 200, ev.status);
  const fold = evs.length ? deriveMatch(evs.map(fromRow)) : null;
  const inns = fold?.innings ?? [];
  ok(`...which folds to two sealed innings (${inns.map((i) => `${i?.runs}/${i?.wickets}`).join(", ")})`,
     inns.length === 2 && inns.every((i) => i?.sealed));
  const res = await q(`select outcome, winner_team_code from match_result_compute($1)`, [one.id]);
  ok(`...and a result from play (${res[0]?.outcome})`, /win/.test(res[0]?.outcome ?? ""));

  group("Match Details: every duty on record (GET /api/read/match_duties)");
  t["dos.kea"] = await login("dos.kea@example.invalid");
  for (const m of [one, done.find((x) => x.school_id === KEA), ms.find((x) => x.id === LIVE_ID)].filter(Boolean)) {
    // Read by the home school's director: each row is under its own policy, and
    // the transport and the pen are the home school's (a visitor's card shows less).
    const d = (await rows(t[m.school_id === KEA ? "dos.kea" : "dos.wes"], "match_duties", `?matchId=${m.id}`)) ?? [];
    const [{ n: named }] = await q(`select count(*)::int n from match_squad where match_id = $1 and not withdrawn`, [m.id]);
    const have = new Set(d.map((r) => r.duty));
    const umps = d.filter((r) => r.duty === "umpire").length;
    const missing = DUTIES.filter((k) => !have.has(k));
    const sheet = d.find((r) => r.duty === "squad")?.detail;
    const wantScoring = m.id !== LIVE_ID;   // the live match's pen is taken when the scorer opens it
    ok(`${m.team_code} ${m.starts_at.slice(0, 10)} (${m.school_id === KEA ? "at Kearsney" : "at Westville"}): ${DUTIES.length - missing.length} of 8 on record, ${umps} umpires, sheet "${sheet}" (both sides: ${named})`,
       missing.filter((k) => wantScoring || k !== "scoring").length === 0 && umps >= 2 && named === 22, missing.join(", "));
  }

  group("The coach's dashboard and cockpit");
  const cm = (await rows(t["coach.wes.1xi"], "matches")) ?? [];
  ok(`the 1XI coach's fixtures: ${cm.filter((m) => m.status === "complete").length} played, ${cm.filter((m) => m.status === "scheduled").length} ahead`,
     cm.filter((m) => m.status === "complete").length >= 3 && cm.some((m) => m.status === "scheduled"));
  const feed = await call("/api/player-of-match/to-decide", { token: t["coach.wes.u14a"] });
  ok(`the U14A coach's queue answers (${feed.status}; ${feed.body?.rows?.length ?? 0} to decide)`, feed.status === 200);
  const news = (await rows(t["parent.106"], "news")) ?? [];
  ok(`the coaches' news reaches a parent (${news.length} posts)`, news.length >= 1);

  group("Player of the Match");
  const hon = (await rows(t["coach.wes.1xi"], "honours", "?teamCode=1XI")) ?? [];
  const potm = hon.filter((h) => h.kind === "player_of_match");
  ok(`the 1XI's Players of the Match (${potm.length}), the captain among them`, potm.length >= 3 && potm.some((h) => h.player_id === CAPTAIN));
  const [nom] = await q(`select status from recognition_nomination where nominated_by_player_id = $1`, [CAPTAIN]);
  ok(`the captain's nomination was confirmed by his coach (${nom?.status})`, nom?.status === "confirmed");

  group("Records and personal bests");
  const boards = (await rows(t["coach.wes.1xi"], "record_boards", `?schoolId=${WES}&teamCode=1XI`)) ?? [];
  const held = boards.filter((b) => b.player_id);
  ok(`the 1XI's record boards have holders (${held.length} rows)`, held.length >= 2);
  const hs = boards.find((b) => b.metric === "highest_innings" && b.class_group === "school_records" && b.line === "holder");
  ok(`...the captain holds the highest innings (${hs?.runs}${hs?.not_out ? "*" : ""})`, hs?.player_id === CAPTAIN && hs.runs >= 100, JSON.stringify(hs));
  const pb = (await rows(t["pupil.wes.1xi"], "personal_bests", `?playerId=${CAPTAIN}`)) ?? [];
  ok(`the captain reads his own personal bests (${pb.length} rows)`, pb.length >= 2);
  const mst = (await rows(t["parent.106"], "milestones", `?playerId=${U14A_BOY}`)) ?? [];
  ok(`the U14A boy's first fifty is a milestone his parent reads (${mst.map((m) => m.label).join(", ")})`, mst.some((m) => /50|fifty/i.test(m.label ?? "")));

  group("The league table (GET /api/read/league)");
  const lg = (await rows(t["league"], "league", `?competitionId=${LEAGUE}`)) ?? [];
  const wes1 = lg.find((r) => r.school_id === WES);
  ok(`the KZN Schools T20 League has rows (${lg.map((r) => `${r.display_name} P${r.played} W${r.won} L${r.lost}`).join("; ")})`,
     lg.length >= 3 && wes1?.played >= 3 && wes1?.lost === 0);
  const lgc = (await rows(t["coach.wes.1xi"], "league", `?competitionId=${LEAGUE}`)) ?? [];
  ok(`...and the 1XI coach reads it too (${lgc.length} rows)`, lgc.length >= 3);

  group("A parent sees his child's season");
  const kids = (await rows(t["parent.106"], "my_children")) ?? [];
  ok("parent.106's child is the U14A boy", kids.length === 1 && kids[0].player_id === U14A_BOY);
  const car = (await rows(t["parent.106"], "career", `?playerId=${U14A_BOY}`)) ?? [];
  const mine = car.find((r) => r.player_id === U14A_BOY);
  ok(`...and reads his season (${mine?.bat_matches} matches, ${mine?.runs} runs)`, Number(mine?.bat_matches) >= 2 && Number(mine?.runs) >= 70, JSON.stringify(car).slice(0, 200));

  group("The public page: names for the consented, positions for the rest");
  const pub = await call(`/api/public/matches/${one.id}/log`);
  const text = JSON.stringify(pub.body ?? {});
  const [cap] = await q(`select full_name, surname from player where id = $1`, [CAPTAIN]);
  ok(`the public log of a 1XI result answers (${pub.status})`, pub.status === 200);
  ok("...naming the captain, whose name is consented", text.includes(cap.surname));
  const [anon] = await q(`select p.full_name, p.surname from match_squad s join player p on p.id = s.player_id
                           where s.match_id = $1 and p.school_id = $2 and not exists (select 1 from public_name_consent c where c.player_id = p.id and c.ended_on is null)
                           limit 1`, [one.id, WES]);
  ok(`...and not naming a boy without consent`, anon && !text.includes(anon.surname));
  const live = await call("/api/public/live");
  ok(`the home page's strip answers (${live.status})`, live.status === 200);
}

async function liveCheck() {
  group("The live 1XI: Westville v Kearsney at Westville Main");
  const [m] = await q(`select status, starts_at from match where id = $1`, [LIVE_ID]);
  ok(`the fixture is live, started ${m?.starts_at?.toISOString?.()}`, m?.status === "live");
  const par = await call(`/api/public/matches/${LIVE_ID}/par`);
  ok(`the par estimate shows (${par.status}: ${JSON.stringify(par.body).slice(0, 160)})`, par.status === 200 && par.body && JSON.stringify(par.body).includes("par"));
  const head = await call(`/api/public/matches/${LIVE_ID}`);
  ok(`the public header answers (${head.status})`, head.status === 200);
  const tok = await login("scorer1.wes@example.invalid", "kameel-pad");
  const claim = await call(`/api/matches/${LIVE_ID}/session/claim`, { method: "POST", token: tok, body: { device: "kameel-pad" } });
  ok(`scorer1.wes's pad takes the pen (${claim.status}, epoch ${claim.body?.epoch})`, claim.status === 200 && claim.body?.ok !== false, JSON.stringify(claim.body));
  const ev = await call(`/api/matches/${LIVE_ID}/events`, { token: tok });
  const evs = (ev.body?.events ?? ev.body?.rows ?? []).map(fromRow);
  const fold = deriveMatch(evs);
  const inn = fold.innings[1];
  ok(`the chase stands at ${inn?.runs}/${inn?.wickets} after ${Math.floor((inn?.balls ?? 0) / 6)}.${(inn?.balls ?? 0) % 6}, target ${inn?.target}`, inn && !inn.complete && inn.target > inn.runs);
  const next = ball({ type: BALL_TYPE.RUN, value: 1, striker: inn.striker, nonStriker: inn.nonStriker, bowler: inn.bowler });
  const e = { ...next, innings: 1, id: "kameel-pad-1", clientTs: Date.now() };
  const send = await call(`/api/matches/${LIVE_ID}/events`, { method: "POST", token: tok,
    body: { events: [{ idempotencyKey: e.id, deviceId: "kameel-pad", epoch: claim.body?.epoch ?? 1, clientSeq: 1, clientTs: e.clientTs, payload: e }] } });
  ok(`...and scores one more ball (${send.status}: ${JSON.stringify(send.body).slice(0, 200)})`, send.status === 200 && (send.body?.accepted?.length ?? 0) === 1);
}

async function browserCheck() {
  const { chromium } = await import("playwright-core");
  const { launchOptions } = await import("./chromium.mjs");
  const { offline } = await import("./offline-browser.mjs");
  const { createServer } = await import("node:http");
  const { readFile } = await import("node:fs/promises");
  const { join, extname } = await import("node:path");
  mkdirSync(SHOTS, { recursive: true });
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".map": "application/json" };
  const web = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x").pathname;
    let body, type;
    try { const f = join("apps/web/dist", url === "/" ? "index.html" : url); body = await readFile(f); type = TYPES[extname(f)] ?? "application/octet-stream"; }
    catch { body = await readFile("apps/web/dist/index.html"); type = "text/html"; }
    res.writeHead(200, { "content-type": type });
    res.end(body);
  });
  await new Promise((r) => web.listen(WEB_PORT, r));
  const browser = await chromium.launch({ ...launchOptions() });
  const open = async (email, { wide = false } = {}) => {
    const ctx = await browser.newContext(wide ? { viewport: { width: 1280, height: 900 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await offline(ctx);
    const page = await ctx.newPage();
    await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
    await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
    if (email) {
      await page.locator("button:not([disabled]), a", { hasText: /Get Started|Log In/ }).first().click({ timeout: 8000 }).catch(() => {});
      await page.locator("#login-email").fill(email, { timeout: 8000 });
      await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 8000 });
      await page.locator('[data-testid="os-main"]').waitFor({ timeout: 20000 }).catch(() => {});
    }
    return { ctx, page };
  };
  const shot = async (page, name) => { await page.waitForTimeout(2500); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false }); ok(`screenshot ${name}`, true); };
  const nav = async (page, id) => { await page.locator(`[data-testid="mnav-${id}"], [data-testid="nav-${id}"]`).first().click({ timeout: 8000 }).catch(() => {}); };
  try {
    const [one] = await q(`select id from match where school_id = $1 and team_code = '1XI' and status = 'complete' and starts_at = timestamptz '2026-10-17 08:00:00+00'`, [WES]);
    const coach = await open("coach.wes.1xi@example.invalid");
    await shot(coach.page, "01-coach-dashboard");
    await nav(coach.page, "matches");
    await shot(coach.page, "02-match-centre-results");
    const card = coach.page.locator(`[data-testid="match-card-${one.id}"]`).first();
    await card.click({ timeout: 8000 }).catch(() => {});
    await shot(coach.page, "03-scorecard-1xi-hundred");
    await coach.page.locator('[data-testid="duty-roster"]').first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await shot(coach.page, "04-match-details-duties");
    await coach.ctx.close();
    const parent = await open("parent.106@example.invalid");
    await shot(parent.page, "05-parent-home");
    await parent.ctx.close();
    const pupil = await open("pupil.wes.1xi@example.invalid");
    await shot(pupil.page, "06-captain-home");
    await pupil.ctx.close();
    const league = await open("league@example.invalid", { wide: true });
    await shot(league.page, "07-league-admin");
    await league.ctx.close();
    const pub = await open(null);
    await pub.page.goto(`http://localhost:${WEB_PORT}/scorecard/${one.id}`, { waitUntil: "networkidle" }).catch(() => {});
    await shot(pub.page, "08-public-scorecard");
    const [lv] = await q(`select id from match where id = $1 and status = 'live'`, [LIVE_ID]);
    if (lv) {
      await pub.page.goto(`http://localhost:${WEB_PORT}/live/${LIVE_ID}`, { waitUntil: "networkidle" }).catch(() => {});
      await shot(pub.page, "09-public-live-chase");
      await pub.page.goto(`http://localhost:${WEB_PORT}/display/${LIVE_ID}`, { waitUntil: "networkidle" }).catch(() => {});
      await shot(pub.page, "10-ground-display");
    }
    await pub.ctx.close();
  } finally {
    await browser.close();
    web.close();
  }
}

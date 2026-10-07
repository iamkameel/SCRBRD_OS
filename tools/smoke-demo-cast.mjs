#!/usr/bin/env node
/**
 * The demo cast, proved through the real API with dev login (docs/pilot/SOLO_TEST.md).
 *
 * RUN BY HAND, never in CI, and only against a database of your own on this
 * machine that holds the seed, the 330 invented players and the cast:
 *
 *   unset SCRBRD_DB; eval "$(node tools/worktree-db.mjs solocast | grep '^export')"
 *   flock /tmp/scrbrd-db.lock node tools/migrate.mjs --reset --seed
 *   psql … -f demo-players-330.sql            (kept out of this repository)
 *   node tools/demo-cast.mjs demo-cast.sql && psql … -f demo-cast.sql
 *   node tools/smoke-demo-cast.mjs             the API proof
 *   pnpm build && flock /tmp/scrbrd-browser.lock node tools/smoke-demo-cast.mjs --browser
 *                                              the coach's card and the scorer, in a browser
 *
 * It starts the API locally with NODE_ENV=development and ALLOW_DEV_LOGIN=1,
 * as the demo service runs, signs in as a sample of the cast by email with no
 * code, and fetches the reads their screens make. What it shows:
 *
 *   - each person sees his own side, school or child, and the counts say so
 *   - a Westville coach reads no Kearsney boy and may not name Kearsney's XI
 *   - a parent reads his own child and nobody else
 *   - a pupil reads his own record, and no team-mate's private columns
 *   - a concern a coach raises reaches his school's DSO and nobody else
 *   - signing out everywhere ends every session of that account (db/85)
 *
 * It writes one safeguarding concern (invented, naming nobody) and session
 * rows. The browser mode writes nothing.
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const BROWSER = process.argv.includes("--browser");
const API_PORT = port(8873);
const WEB_PORT = port(4373);
const API = `http://127.0.0.1:${API_PORT}`;
const WES = "22222222-2222-2222-2222-222222222222";
const KEA = "33333333-3333-3333-3333-333333333333";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);

// ── Only ever a local database, and only one that holds the cast ──
const dbUrl = new URL(ownerUrl());
if (!["127.0.0.1", "localhost", "::1"].includes(dbUrl.hostname)) {
  console.error("✗ refusing: this proof runs against a database on this machine only, never a remote one.");
  process.exit(2);
}
const owner = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await owner.query(text, params)).rows;
const [{ cast }] = await q(`select count(*)::int as cast from app_user where email like '%.wes%@example.invalid' and email like 'coach.%'`);
const [{ boys }] = await q(`select count(*)::int as boys from player where id::text like 'de300000-0000-4000-8000-%'`);
if (cast < 11 || boys !== 330) {
  console.error(`✗ this database (${dbUrl.pathname.slice(1)}) does not hold the 330 players and the cast. Load them first (see the header).`);
  await owner.end();
  process.exit(2);
}

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-demo-cast-secret",
         ...(BROWSER ? { WEB_ORIGIN: `http://localhost:${WEB_PORT}` } : {}) },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email, deviceId = "device-demo-cast") =>
  (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const rows = async (token, resource) => {
  const r = await call(`/api/read/${resource}`, { token });
  return r.status === 200 ? (r.body?.rows ?? []) : null;
};

// The facts the reads are checked against, read as the owner.
const today = (await q(`select m.id from match m where m.school_id = $1 and m.away_school_id = $2 and m.team_code = '1XI'
                          and (m.starts_at at time zone 'Africa/Johannesburg')::date = sa_today()`, [WES, KEA]))[0]?.id;
const fixturesBy = async (team) => (await q(`select count(*)::int n from match where school_id = $1 and away_school_id = $2
                                               and ($3::text is null or team_code = $3)`, [WES, KEA, team]))[0].n;
const playersAt = async (school, team = null) => (await q(`select count(*)::int n from player where school_id = $1
                                                             and ($2::text is null or team_code = $2)`, [school, team]))[0].n;
const pupil = async (email) => (await q(`select u.player_id, p.team_code from app_user u join player p on p.id = u.player_id where u.email = $1`, [email]))[0];

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await call("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the API is up with dev login on", (await call("/api/health")).body?.auth === "dev_login_enabled");
  ok("today's Westville v Kearsney 1XI fixture is there", !!today);

  if (BROWSER) await browserCheck();
  else await apiCheck();
} catch (e) {
  fail++;
  console.log("  ✗ the run stopped:", e?.stack ?? e);
} finally {
  server.kill();
  await owner.end();
  if (fail && serverErr.length) console.log("\nAPI stderr (tail):\n" + serverErr.join("").slice(-1500));
  console.log(`\n${"─".repeat(52)}\nDEMO CAST ${BROWSER ? "BROWSER" : "API"}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

async function apiCheck() {
  const who = {};
  for (const e of ["coach.wes.1xi", "coach.kea.1xi", "manager.wes.u14a", "assistant.wes.1xi", "scorer1.wes", "scorer2.wes",
                   "registrar.wes", "office.kea", "dso.wes", "dso.kea", "dos.wes", "principal.wes", "medical.wes",
                   "transport.wes", "driver.wes", "official.wes", "pupil.wes.u14a", "pupil.wes.1xi", "parent.106"]) {
    who[e] = await login(`${e}@example.invalid`);
  }
  group("Every sample account signs in by email, the code left blank");
  for (const [e, t] of Object.entries(who)) ok(`${e} signs in`, !!t);

  group("Each holds the role the cast gave him (GET /api/session)");
  const roles = async (t) => ((await call("/api/session", { token: t })).body?.assignments ?? [])
    .map((a) => `${a.role}@${a.school === WES ? "WES" : a.school === KEA ? "KEA" : a.school}${a.team ? "/" + a.team : ""}${a.fixture ? "/fixture" : ""}`).sort();
  const expect = {
    "coach.wes.1xi": ["coach@WES/1XI"], "coach.kea.1xi": ["coach@KEA/1XI"], "manager.wes.u14a": ["teammanager@WES/U14A"],
    "assistant.wes.1xi": ["assistantcoach@WES/1XI"], "registrar.wes": ["schooladmin@WES"], "dso.wes": ["dso@WES"],
    "dos.wes": ["directorofsport@WES"], "principal.wes": ["principal@WES"], "medical.wes": ["medical@WES"],
    "transport.wes": ["transportcoordinator@WES"], "driver.wes": ["driver@WES"],
    "pupil.wes.u14a": ["player@WES/U14A", "selfaccess@WES"], "parent.106": ["guardian@WES"],
  };
  for (const [e, want] of Object.entries(expect)) {
    const got = await roles(who[e]);
    ok(`${e}: ${want.join(", ")}`, JSON.stringify(got) === JSON.stringify(want), got.join(", "));
  }
  const sc = await roles(who["scorer1.wes"]);
  ok(`scorer1.wes: scorer at WES, plus one fixture-scoped scorer duty for each appointment (${sc.length - 1} linked)`,
     sc.includes("scorer@WES") && sc.filter((r) => r === "scorer@WES/fixture").length === 3, sc.join(", "));
  const of = await roles(who["official.wes"]);
  ok("official.wes: official at WES, plus today's umpire duty", of.includes("official@WES") && of.includes("official@WES/fixture"), of.join(", "));

  group("The fixtures each one sees (GET /api/read/matches)");
  const castMatches = (list) => (list ?? []).filter((m) => m.school_id === WES && m.away_school_id === KEA);
  const wes1 = castMatches(await rows(who["coach.wes.1xi"], "matches"));
  ok(`the WES 1XI coach sees the 1XI's fixtures and no other side's (${wes1.length} of ${await fixturesBy("1XI")})`,
     wes1.length === await fixturesBy("1XI") && wes1.every((m) => m.team_code === "1XI" && m.my_side === "home"));
  const kea1 = castMatches(await rows(who["coach.kea.1xi"], "matches"));
  ok(`the KEA 1XI coach sees the same fixtures, from the away end (${kea1.length})`,
     kea1.length === wes1.length && kea1.every((m) => m.away_team_code === "1XI" && m.my_side === "away"));
  const u14 = castMatches(await rows(who["manager.wes.u14a"], "matches"));
  ok(`the WES U14A team manager sees the U14A fixture only (${u14.length})`, u14.length === 1 && u14[0].team_code === "U14A");
  const all = await fixturesBy(null);
  const sco = castMatches(await rows(who["scorer1.wes"], "matches"));
  ok(`a WES scorer sees every WES v KEA fixture (${sco.length} of ${all})`, sco.length === all);
  const dos = castMatches(await rows(who["dos.wes"], "matches"));
  ok(`the WES director of sport sees every one (${dos.length} of ${all})`, dos.length === all);
  const pm = castMatches(await rows(who["pupil.wes.u14a"], "matches"));
  ok(`the U14A pupil sees his side's fixture only (${pm.length})`, pm.length === 1 && pm[0].team_code === "U14A");

  group("Players: own school only (GET /api/read/players)");
  const wesN = await playersAt(WES), keaN = await playersAt(KEA);
  for (const e of ["coach.wes.1xi", "dos.wes", "registrar.wes"]) {
    const p = await rows(who[e], "players") ?? [];
    ok(`${e} reads Westville's roll (${p.filter((r) => r.school_id === WES).length} of ${wesN}) and no Kearsney boy (${p.filter((r) => r.school_id === KEA).length})`,
       p.filter((r) => r.school_id === WES).length === wesN && p.every((r) => r.school_id !== KEA));
  }
  const kp = await rows(who["coach.kea.1xi"], "players") ?? [];
  ok(`the KEA 1XI coach reads Kearsney's roll (${kp.length} of ${keaN}) and no Westville boy`,
     kp.length === keaN && kp.every((r) => r.school_id === KEA));
  const coachP = await rows(who["coach.wes.1xi"], "players") ?? [];
  // Every coach reads a name, a side and an age for the whole school; the
  // fitness word (medical.status.read, team-scoped) only for his own side.
  const fitness = coachP.filter((r) => r.fitness != null);
  ok(`the WES 1XI coach reads a fitness word for his own side only (${fitness.length} boys, all 1XI)`,
     fitness.length > 0 && fitness.every((r) => r.team_code === "1XI" && r.school_id === WES));

  group("A Westville coach is refused Kearsney's side");
  const keaXI = (await q(`select player_id from match_squad where match_id = $1 and side = 'away' and not withdrawn order by batting_no`, [today])).map((r) => r.player_id);
  const name = await call(`/api/matches/${today}/squad`, { method: "POST", token: who["coach.wes.1xi"],
    body: { side: "away", players: keaXI.map((id, i) => ({ playerId: id, battingNo: i + 1 })) } });
  ok(`naming Kearsney's XI on today's fixture is refused (${name.status})`, name.status === 403, JSON.stringify(name.body));
  const after = (await q(`select count(*)::int n from match_squad where match_id = $1 and side = 'away' and not withdrawn
                            and selected_by = (select id from app_user where email = 'coach.kea.1xi@example.invalid')`, [today]))[0].n;
  ok(`...and Kearsney's XI is still the one their coach named (${after} of 11)`, after === 11);
  // An away side's sheet is read at the away school (match_squad_read): the
  // Kearsney coach reads his XI, and the Westville scorer types Kearsney's
  // names as they come in (scorer/engine.jsx liveSides, by design).
  const sheet = async (t) => ((await call(`/api/read/match_squad?matchId=${today}`, { token: t })).body?.rows ?? [])
    .filter((r) => r.side === "away").length;
  const [kc, wc, ws] = [await sheet(who["coach.kea.1xi"]), await sheet(who["coach.wes.1xi"]), await sheet(who["scorer1.wes"])];
  ok(`the KEA 1XI coach reads today's sheet: his 11 named (${kc})`, kc === 11);
  ok(`the WES coach reads none of Kearsney's sheet (${wc})`, wc === 0);
  ok(`nor does the WES scorer, who types Kearsney's names on the pad (${ws})`, ws === 0);

  group("A parent sees his own child (GET /api/read/my_children, players)");
  const boy = await pupil("pupil.wes.u14a@example.invalid");
  const kids = await rows(who["parent.106"], "my_children") ?? [];
  ok(`parent.106 has one child, the U14A pupil (${kids.length})`, kids.length === 1 && kids[0].player_id === boy.player_id);
  const pp = await rows(who["parent.106"], "players") ?? [];
  ok(`...and the roster read gives him that one boy (${pp.length})`, pp.length === 1 && pp[0].id === boy.player_id);
  const otherParent = await login("parent.061@example.invalid");
  const ok2 = await rows(otherParent, "my_children") ?? [];
  ok(`another parent (parent.061) has his own boy, not this one (${ok2.length})`, ok2.length === 1 && ok2[0].player_id !== boy.player_id);

  group("A pupil sees himself");
  const pr = await rows(who["pupil.wes.u14a"], "players") ?? [];
  const private_ = pr.filter((r) => r.born != null);
  ok(`the U14A pupil's roster read: his side in outline (${pr.length}), every row U14A`, pr.length > 0 && pr.every((r) => r.team_code === "U14A" && r.school_id === WES));
  ok(`...and a date of birth on one row only, his own (${private_.length})`, private_.length === 1 && private_[0].id === boy.player_id);
  const pk = await rows(who["pupil.wes.u14a"], "my_children") ?? [];
  ok("...and no child of his own to answer for", pk.length === 0);
  const capt = await pupil("pupil.wes.1xi@example.invalid");
  const hon = await rows(who["pupil.wes.1xi"], "honours") ?? [];
  ok(`the 1XI pupil reads his captaincy (${hon.filter((h) => h.kind === "captain").length})`,
     hon.some((h) => h.kind === "captain" && h.player_id === capt.player_id));

  group("Transport: today's minibus, for the coordinator and the driver (GET /api/read/trips)");
  const tripsOf = async (t) => ((await rows(t, "trips")) ?? []).filter((r) => r.match_id === today);
  const [tc, dr, kd] = [await tripsOf(who["transport.wes"]), await tripsOf(who["driver.wes"]), await tripsOf(await login("driver.kea@example.invalid"))];
  ok(`the WES transport coordinator reads today's trip (${tc.length})`, tc.length === 1);
  ok(`the WES driver reads it, his own (${dr.length})`, dr.length === 1);
  ok(`Kearsney's driver does not (${kd.length})`, kd.length === 0);

  group("A concern reaches the school's DSO and nobody else");
  const cards = (await call("/api/safeguarding/contacts", { token: who["parent.106"] })).body?.rows ?? [];
  ok("a Westville parent is shown Westville's DSO by name", cards.some((c) => c.schoolId === WES && /Safeguarding Officer/.test(c.name)));
  const raised = await call("/api/safeguarding/concerns", { method: "POST", token: who["manager.wes.u14a"],
    body: { schoolId: WES, aboutKind: "unknown", nature: ["other"], certainty: "suspicion", howLearned: "witness",
            account: "Demo cast proof: an invented concern that names nobody." } });
  ok(`the U14A team manager raises one and gets a reference back (${raised.status})`, raised.status === 200 && /^SG-/.test(raised.body?.reference ?? ""));
  const inbox = async (t) => ((await call("/api/safeguarding/inbox", { token: t })).body?.rows ?? []).filter((r) => r.reference === raised.body?.reference).length;
  ok("Westville's DSO has it", (await inbox(who["dso.wes"])) === 1);
  for (const e of ["dso.kea", "dos.wes", "principal.wes", "registrar.wes", "coach.wes.1xi"]) ok(`${e} does not`, (await inbox(who[e])) === 0);
  const rec = (await call("/api/safeguarding/receipts", { token: who["manager.wes.u14a"] })).body?.rows ?? [];
  ok("the person who raised it keeps the reference", rec.some((r) => r.reference === raised.body?.reference));

  group("Signing out everywhere ends every session of that account (db/85)");
  const a = await login("transport.wes@example.invalid", "device-a");
  const b = await login("transport.wes@example.invalid", "device-b");
  ok("two devices are signed in", (await call("/api/session", { token: a })).status === 200 && (await call("/api/session", { token: b })).status === 200);
  const out = await call("/api/auth/sign-out-everywhere", { method: "POST", token: a });
  ok(`sign out everywhere answers (${out.status})`, out.status === 200);
  ok("device A is signed out", (await call("/api/session", { token: a })).status === 401);
  ok("device B is signed out", (await call("/api/session", { token: b })).status === 401);
  ok("signing in again works", (await call("/api/session", { token: await login("transport.wes@example.invalid", "device-a") })).status === 200);
}

async function browserCheck() {
  const { chromium } = await import("playwright-core");
  const { launchOptions } = await import("./chromium.mjs");
  const { offline } = await import("./offline-browser.mjs");
  const { createServer } = await import("node:http");
  const { readFile } = await import("node:fs/promises");
  const { join, extname } = await import("node:path");
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
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
  /** A phone, signed in through the sign-in screen by email with the code left blank, as Kameel will. */
  const open = async (email) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await offline(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
    await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
    await page.locator("button:not([disabled]), a", { hasText: /Get Started|Log In/ }).first().click({ timeout: 8000 }).catch(() => {});
    await page.locator("#login-email").fill(email, { timeout: 8000 });
    await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 8000 });
    const signedIn = await page.locator('[data-testid="os-main"]').waitFor({ timeout: 20000 }).then(() => true, () => false);
    return { ctx, page, errors, signedIn };
  };
  try {
    group("The WES 1XI coach: today's fixture on the Dashboard's Match day card");
    const coach = await open("coach.wes.1xi@example.invalid");
    ok("coach.wes.1xi signs in with the code left blank", coach.signedIn);
    const card = coach.page.locator(`[data-testid="day-matchday"][data-match="${today}"]`);
    await card.waitFor({ timeout: 20000 }).catch(() => {});
    ok("the Match day card is drawn for today's fixture", (await card.count()) === 1);
    const line = (await card.locator('[data-testid="matchday-line"]').first().innerText({ timeout: 4000 }).catch(() => "")).trim();
    ok(`...against Kearsney ("${line}")`, /Kearsney/.test(line));
    const side = (await card.locator('[data-testid="matchday-side"]').first().innerText({ timeout: 8000 }).catch(() => "")).trim();
    ok(`...with the minibus the cast booked ("${side}")`, /bus 22 seats/.test(side));
    ok("no page errors", coach.errors.length === 0, coach.errors.join(" | "));
    await coach.ctx.close();

    group("The WES scorer: today's fixture opens on the pad");
    const sc = await open("scorer1.wes@example.invalid");
    ok("scorer1.wes signs in with the code left blank", sc.signedIn);
    await sc.page.locator('[data-testid="mnav-matches"], [data-testid="nav-matches"]').first().click({ timeout: 8000 }).catch(() => {});
    const fixture = sc.page.locator(`[data-testid="match-card-${today}"]`);
    await fixture.waitFor({ timeout: 20000 }).catch(() => {});
    ok("today's fixture is in the Match Centre", (await fixture.count()) === 1);
    const start = fixture.locator("button", { hasText: /Start Scoring →|Open Live Scorer →/ }).first();
    ok("...with Start Scoring on its card", (await start.count()) === 1);
    await start.click({ timeout: 8000 }).catch(() => {});
    const toss = sc.page.locator('[data-testid="toss-sheet"]');
    await toss.waitFor({ timeout: 20000 }).catch(() => {});
    ok("the pad opens on it and asks The toss", (await toss.count()) === 1);
    ok("no page errors", sc.errors.length === 0, sc.errors.join(" | "));
    await sc.ctx.close();
  } finally {
    await browser.close();
    web.close();
  }
}

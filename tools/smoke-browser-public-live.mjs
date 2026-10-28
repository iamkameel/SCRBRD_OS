#!/usr/bin/env node
/**
 * The public live match page, signed out, against the SEED's own pupils
 * (Cricinfo plan CRI-0.3; SCRBRD-083, docs/policy/PUBLIC_DATA.md).
 *
 * smoke-browser-public.mjs holds the name rule branch by branch on a fixture
 * of its own, and reads the DOM. This walk asks the two questions CRI-0.3
 * asks, the way a stranger meets the page, and keeps asking them:
 *
 *   1. Is it mounted? From the home page at `/`, a signed-out visitor taps a
 *      listed fixture's card and lands on /live/:id, which draws the seed's
 *      Hilton 1XI v Michaelhouse, scored live while he watches; /scorecard/:id
 *      and the pavilion display /display/:id answer too.
 *   2. Does anything it SENDS carry a child's identity? Every response the
 *      browser receives on its own origin — the HTML shells, the bundles, the
 *      CSS, every /api/public/ JSON body, the home page's strip and news —
 *      is scanned, not the DOM, against needles read from the database:
 *        · every seeded pupil's name (db/98's player rows, read from the
 *          database, so a boy the seed adds tomorrow is a needle tomorrow),
 *          each word of it (an initial excepted), his stored surname and the
 *          name he is known by;
 *        · the names the scorer typed for Michaelhouse (L6);
 *        · every pupil's date of birth, written three ways (N1);
 *        · his hometown, his house, his guardian's name and number, every
 *          login email in the database (N4);
 *        · the reason for a never-public mark (C5);
 *      and, in the API's JSON and HTML only (a bundle holds the words of the
 *      code that redacts them), the words of health and discipline (N2, N3)
 *      and any placement coordinate (L7 as amended, SCRBRD-139).
 *      The one label the rule allows — "J Whitfield", consented, his school
 *      published — is taken out before the scan; it must be there, so the
 *      scan is not passing on a page that names nobody.
 *   3. Nothing else a stranger's browser would hold: no Set-Cookie, no image
 *      but the app's own assets, no Authorization or Cookie header sent.
 *   4. The scanner finds what it looks for: every needle is found in the
 *      owner's own rows (the seed's player rows and the typed log), so a
 *      clean result is a scan that could have failed.
 *
 * Falsified 2026-10-28: services/api/public/public-api.mjs's header route
 * made to add the home captain's full name to /api/public/matches/:id — the
 * walk failed on that route and that word; restored, green.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-public-live.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { writeEvents, HIL } from "./fixture-matchcentre.mjs";
import { ball, batters, bowler, inningsStart, retire, penalty, placementFromTap, BALL_TYPE } from "@scrbrd/scoring";
import { afterReads, watchReads } from "./walk-wait.mjs";

const PORT = port(8971);
const BASE = `http://127.0.0.1:${PORT}`;
const DEBUG = !!process.env.BROWSER_PUBLIC_DEBUG;

/** The seed's fixtures (db/98): one to score live, one finished with a ball log of its own. */
const LIVE = "77777777-0000-0000-0000-000000000002";      // Hilton 1XI v Michaelhouse
const DONE = "77777777-0000-0000-0000-000000000004";      // Hilton 1XI v Maritzburg College
/** The seed's Hilton 1XI (db/98). */
const P = {
  whitfield: "aaaaaaaa-0000-0000-0000-000000000001",      // consented → "J Whitfield"
  bekker:    "aaaaaaaa-0000-0000-0000-000000000002",      // consented AND never-public → a position
  naidoo:    "aaaaaaaa-0000-0000-0000-000000000003",      // nothing recorded
  cele:      "aaaaaaaa-0000-0000-0000-000000000004",      // nothing recorded
  pillay:    "aaaaaaaa-0000-0000-0000-000000000005",      // injured (db/98), retired hurt here
};
const ALLOWED = ["J Whitfield"];
/** db/98's player ids. */
const SEED_ID = "^(aaaaaaaa|bbbbbbbb)-0000-0000-0000-";
/** Michaelhouse is not on SCRBRD: its boys are names the scorer typed (L6). */
const TYPED = ["Nathan Pretorius", "Kyle Venter", "Liam Gutteridge"];
const MARK_REASON = "a protection order from the family court";
const COACH2 = "88888888-0000-0000-0000-00000000000a";    // the 2XI coach: news.publish.team at Hilton
const NEWS_TITLE = "Second XI through to the final";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) { pass++; if (DEBUG) console.log("  ✓", n); } else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 600)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", SESSION_SECRET: "browser-public-live-secret",
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-public-live-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1",
         SERVE_CLIENT: "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = /** @type {string[]} */ ([]);
api.stderr.on("data", (d) => apiErr.push(d.toString()));
api.stdout.on("data", (d) => { if (DEBUG) process.stdout.write(d); });

const owner = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const q = async (/** @type {string} */ t, /** @type {any[]} */ p = []) => (await owner.query(t, p)).rows;
async function as(/** @type {string} */ user, /** @type {string} */ text, /** @type {any[]} */ params = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.device_id', 'browser-public-live', true)", [user]);
    const r = (await c.query(text, params)).rows;
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

// ── The needles ─────────────────────────────────────────────────

const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A word, not part of a longer one. */
const wordRe = (/** @type {string} */ w) => new RegExp(`(?<![\\p{L}])${esc(w)}(?![\\p{L}])`, "u");
/** A date three ways: 2009-01-09, 09/01/2009, 9 January 2009. */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dateForms = (/** @type {string} */ iso) => {
  const [y, m, d] = iso.split("-");
  return [iso, `${d}/${m}/${y}`, `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`];
};

/**
 * Everything a public payload must never hold, from the database itself.
 * Each needle: { what, re } where `what` names the KIND and the row, never
 * the value (a failure line never prints a child's name; the lead reads the
 * value from the database by the row id).
 * @returns {Promise<{needles: {what: string, re: RegExp, word: string}[], skipped: string[]}>}
 */
async function needlesFrom() {
  // The seed's pupils (db/98's fixed ids) and anyone in a squad this walk serves. Not every
  // row in the database: the browser set shares it, and a walk's "V Mate Six" would make
  // "Six" a needle every commentary line trips.
  const rows = await q(`select p.id, to_jsonb(p) as j, to_char(p.born, 'YYYY-MM-DD') as born from player p
                         where p.id::text ~ $1 or p.id = any($2::uuid[])`, [SEED_ID, Object.values(P)]);
  const teamWords = (await q(
    `select name as w from school union all select name from ground union all select opponent from match where opponent is not null
     union all select team_code from match`)).map((r) => String(r.w));
  /** Words a team-level fact may carry: a hometown that is also a school's name is not a leak of it. */
  const isTeamWord = (/** @type {string} */ w) => teamWords.some((t) => wordRe(w).test(t));
  /** @type {{what: string, re: RegExp, word: string}[]} */
  const needles = [];
  const skipped = /** @type {string[]} */ ([]);
  const add = (/** @type {string} */ what, /** @type {unknown} */ v, { words = false, team = true } = {}) => {
    if (typeof v !== "string" || !v.trim()) return;
    const parts = words ? v.split(/[\s,]+/).filter((w) => w.replace(/\./g, "").length >= 2) : [v.trim()];
    for (const w of parts) {
      if (team && isTeamWord(w)) { skipped.push(what); continue; }
      needles.push({ what, re: wordRe(w), word: w });
    }
  };
  for (const { id, j, born } of rows) {
    const tag = `player ${id}`;
    add(`${tag}: a word of his full name`, j.full_name, { words: true });
    add(`${tag}: his stored surname`, j.surname, { words: true });
    add(`${tag}: the name he is known by`, j.known_as, { words: true });
    add(`${tag}: his hometown`, j.hometown);
    add(`${tag}: his house`, j.houseatschool);
    const g = j.guardian && typeof j.guardian === "object" ? j.guardian : null;
    if (g) { add(`${tag}: his guardian's name`, g.name, { team: false }); add(`${tag}: his guardian's number`, g.phone, { team: false }); }
    for (const k of ["id_number", "email", "phone", "address"]) add(`${tag}: his ${k}`, j[k], { team: false });
    if (born) for (const f of dateForms(born)) needles.push({ what: `${tag}: his date of birth`, re: new RegExp(`(?<![0-9])${esc(f)}(?![0-9])`), word: f });
  }
  for (const n of TYPED) add("a name the scorer typed for Michaelhouse", n, { words: true });
  for (const { email } of await q(`select email from app_user where email is not null`)) add("a login email", email, { team: false });
  add("the never-public mark's reason", MARK_REASON, { team: false });
  return { needles, skipped };
}

/** Health and discipline (N2, N3), in what the API says — never in a bundle, which holds the code that redacts them. */
const N23 = /\b(injur\w*|unavailab\w*|hurt|ill(ness)?|sick|suspen\w*|disciplin\w*|conduct)\b/i;
/** Placement keys no public answer may carry (L7 as amended). */
const COORDINATES = new Set(["theta", "radius", "seg", "zone", "place", "placement", "placementSource", "placementNull", "closePosition",
  "captureProfile", "contact", "trajectory", "bowlerApproach"]);
const keysIn = (/** @type {unknown} */ v) => /** @type {string[]} */ (Array.isArray(v) ? v.flatMap(keysIn)
  : v != null && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysIn(x)]) : []);
/** Every string value in a JSON value (N2/N3 are judged on values, not on key names like "retired"). */
const valuesIn = (/** @type {unknown} */ v) => /** @type {string[]} */ (Array.isArray(v) ? v.flatMap(valuesIn)
  : v != null && typeof v === "object" ? Object.values(v).flatMap(valuesIn) : typeof v === "string" ? [v] : []);

/** The allowed labels out, then every needle that is still there. */
const scan = (/** @type {string} */ body, /** @type {{what: string, re: RegExp}[]} */ needles) => {
  let b = body;
  for (const a of ALLOWED) b = b.split(a).join(" ");
  return needles.filter((n) => n.re.test(b)).map((n) => n.what);
};

const browser = await chromium.launch({ ...launchOptions() });

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const SARAH = (await q(`select id from app_user where email = 'sarah@example.invalid'`))[0].id;

  group("0. The seed's fixture, published and scored live");
  // Two of the seed's boys get a verified guardian of their own, the way
  // db/99 §25 and fixture-public.mjs make one, and consent through the door.
  for (const key of /** @type {const} */ (["whitfield", "bekker"])) {
    const uid = (await q(`insert into app_user (school_id, email, name, role) values ($1, $2, 'A Guardian', 'guardian') returning id`,
      [HIL, `guardian.live.${key}@example.invalid`]))[0].id;
    const asg = (await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`, [uid, HIL]))[0].id;
    await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                             consent_state, consent_version, consent_at, created_by, valid_from)
             values ($1, $2, 'parent', 'verified', $3, now() - interval '30 days', 'granted', 'popia-2026-01', now() - interval '30 days', $3,
                     current_date - 30)`, [asg, P[key], uid]);
    const [c] = await as(uid, `select ok, reason from public_name_consent_set($1, true, 'public-names-2026-09')`, [P[key]]);
    ok(`the guardian of the seed's ${key === "whitfield" ? "first" : "second"} 1XI boy consents`, c?.ok === true, c?.reason);
  }
  const [m] = await as(SARAH, `select * from player_never_public_set($1, $2)`, [P.bekker, MARK_REASON]);
  ok("the office marks the second boy never-public", m && (m.ok ?? true) !== false, JSON.stringify(m));

  await q(`update match set status = 'live',
             starts_at = (sa_today()::timestamp + interval '9 hours') at time zone 'Africa/Johannesburg' where id = $1`, [LIVE]);
  await q(`insert into match_toss (match_id, school_id, won_by, decision) values ($1, $2, 'home', 'bat') on conflict do nothing`, [LIVE, HIL]);
  const names = Object.fromEntries((await q(`select id, full_name from player where id = any($1::uuid[])`, [Object.values(P)])).map((r) => [r.id, r.full_name]));
  const squad = Object.values(P).map((id) => ({ id, name: names[id] }));
  let n = 0;
  const t0 = Date.now() - 40 * 60000;
  const at = (/** @type {any} */ ev) => ({ ...ev, innings: 0, id: `cri03-${++n}`, clientTs: t0 + n * 30000 });
  const opp = "Michaelhouse";
  const log = [
    at(inningsStart({ battingTeam: "1XI", bowlingTeam: opp, teamKey: "1XI", bowlingTeamKey: opp, squad,
      bowlingSquad: TYPED.map((nm) => ({ id: nm, name: nm })), overs: 20, captureProfile: "full" })),
    at(batters({ striker: P.whitfield, nonStriker: P.bekker })),
    at(bowler({ bowler: TYPED[0] })),
    at(ball({ type: BALL_TYPE.RUN, value: 4, shot: "drive", ...placementFromTap({ angle: 235, radius: 0.9 }) })),
    at(ball({ type: BALL_TYPE.RUN, value: 1, ...placementFromTap({ angle: 60, radius: 0.5 }) })),
    at(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: TYPED[2], shot: "pull" })),
    at(batters({ striker: P.pillay })),
    at(ball({ type: BALL_TYPE.RUN, value: 2, ...placementFromTap({ angle: 120, radius: 0.8 }) })),
    at(bowler({ bowler: TYPED[1], reason: "injury" })),
    at(ball({ type: BALL_TYPE.WIDE, value: 0 })),
    at(retire({ batter: P.pillay, reason: "hurt" })),
    at(batters({ striker: P.naidoo })),
    at(penalty({ runs: 5, toBattingTeam: true, reason: "helmet_struck" })),
    at(ball({ type: BALL_TYPE.RUN, value: 6, ...placementFromTap({ angle: 180, radius: 1 }) })),
    at(ball({ type: BALL_TYPE.RUN, value: 1 })),
  ];
  await writeEvents(q, LIVE, log);
  await as(SARAH, `select * from fixture_publish($1, 'home', true)`, [LIVE]);
  await as(SARAH, `select * from fixture_publish($1, 'home', true)`, [DONE]);
  await as(SARAH, `select * from public_listing_set($1, true)`, [HIL]);
  // A team's news post, asked for by its coach and approved by the director of sport (db/83).
  const [{ id: post }] = await as(COACH2,
    `insert into news_post (scope, school_id, team_code, title, body, published_at)
     values ('team', $1, '2XI', $2, 'The side beat Westville by six wickets on Saturday. Teas in the pavilion from three.', now()) returning id`,
    [HIL, NEWS_TITLE]);
  await as(COACH2, `select * from news_public_request($1)`, [post]);
  const [appr] = await as(SARAH, `select * from news_public_approve($1)`, [post]);
  ok("a team's news post is approved for the home page", appr?.ok === true, appr?.reason);

  const { needles, skipped } = await needlesFrom();
  const players = Number((await q(`select count(*) as c from player where id::text ~ $1`, [SEED_ID]))[0].c);
  ok(`needles read from the database: ${needles.length} from ${players} pupils, the typed names, the emails`, needles.length > players * 2,
     `${needles.length}`);
  if (DEBUG) console.log(`  (left out as team words: ${skipped.length})`);

  group("4. The scanner finds what it looks for");
  {
    const rows = await q(`select to_jsonb(p)::text as t from player p where p.id::text ~ $1`, [SEED_ID]);
    const typed = await q(`select payload::text as t from ball_event where match_id = $1`, [LIVE]);
    const own = rows.map((r) => r.t).join("\n") + "\n" + typed.map((r) => r.t).join("\n");
    const found = new Set(scan(own, needles));
    const missed = [...new Set(needles.map((x) => x.what))].filter((w) => !found.has(w) && !/login email|mark's reason|date of birth/.test(w));
    ok("every name-needle is found in the owner's own rows (player rows, the typed log)", missed.length === 0, missed.slice(0, 6).join(" | "));
    ok("...and a date of birth written the second way is found", needles.some((x) => /date of birth/.test(x.what) && x.re.test(`born ${x.word}`)));
  }

  group("1. Mounted: from the home page to the live page, signed out");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.85.0.1" } });
  await offline(ctx);
  /** @type {Promise<{url: string, path: string, status: number, type: string, cookie: boolean, body: string}>[]} */
  const got = [];
  ctx.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin !== BASE) return;
    const h = r.headers();
    got.push(r.body().then((buf) => buf.toString("utf8"), () => "").then((body) => ({
      url: r.url(), path: u.pathname, status: r.status(), type: h["content-type"] ?? "", cookie: "set-cookie" in h, body })));
  });
  const sent = /** @type {{url: string, auth: boolean}[]} */ ([]);
  ctx.on("request", (r) => { const h = r.headers(); sent.push({ url: r.url(), auth: !!(h.authorization || h.cookie) }); });
  const errors = /** @type {string[]} */ ([]);
  const page = await ctx.newPage();
  watchReads(page);
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(`console.error: ${msg.text()}`); });
  await page.addInitScript(`window.__SCRBRD_LIVE_MS__ = 1000;`);

  const card = page.locator(`a[data-testid="home-card"][href="/live/${LIVE}"]`);
  let listed = false;
  for (let i = 0; i < 30 && !listed; i++) {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    listed = (await card.count()) > 0;
    if (!listed) await page.waitForTimeout(400);
  }
  ok("the home page at / lists the seed's live fixture", listed);
  ok("...and its news carries the approved post", await page.locator('[data-testid="home-news-post"]', { hasText: NEWS_TITLE }).count() > 0);
  await card.first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForURL(new RegExp(`/live/${LIVE}$`), { timeout: 8000 }).catch(() => {});
  ok(`the tap lands on /live/${LIVE}`, new URL(page.url()).pathname === `/live/${LIVE}`, page.url());
  await page.waitForSelector('[data-testid="public-match"]', { timeout: 10000 }).catch(() => {});
  ok("the live page draws the match", await page.locator('[data-testid="public-match"]').count() === 1);
  const title = await page.locator('[data-testid="mc-title"]').innerText().catch(() => "");
  ok("...Hilton College 1XI v Michaelhouse", /Hilton College/.test(title) && /Michaelhouse/.test(title), title);
  ok("...Live", (await page.locator('[data-testid="mc-status"]').textContent().catch(() => "")) === "Live");
  for (const t of ["scorecard", "commentary", "partnerships", "analytics", "details", "summary"]) {
    await page.locator(`[data-testid="mc-tab-${t}"]`).click({ timeout: 4000 }).catch(() => {});
    await afterReads(page, 400);
    if (t === "scorecard") {
      const rows = (await page.locator('[data-testid="mc-bat-row"]').allInnerTexts()).map((r) => r.split("\n")[0].replace("*", "").trim());
      ok("the scorecard names the consented boy by the rule, and the rest are positions",
         rows.includes("J Whitfield") && rows.filter((x) => x === "Batter").length >= 3, rows.join(" | "));
    }
  }
  // A ball arrives while he watches: the page's ?since= read is captured too.
  await writeEvents(q, LIVE, [at(ball({ type: BALL_TYPE.RUN, value: 4, shot: "cut", ...placementFromTap({ angle: 250, radius: 1 }) }))], log.length);
  const since = await page.waitForResponse((r) => /\/api\/public\/matches\/[^/]+\/log\?since=/.test(r.url()), { timeout: 20000 }).then(() => true, () => false);
  ok("a ball scored while he watches arrives by the page's ?since= read", since);
  await afterReads(page, 1500);

  for (const path of [`/scorecard/${LIVE}`, `/scorecard/${DONE}`, `/display/${LIVE}`]) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await afterReads(page, 1200);
    ok(`${path.split("/")[1]} answers 200, noindex`, res?.status() === 200 && /noindex/.test(res?.headers()["x-robots-tag"] ?? ""),
       `${res?.status()} ${res?.headers()["x-robots-tag"]}`);
  }
  ok("no console errors on any page", errors.length === 0, errors.join(" | "));

  group("2. Nothing the browser received carries a child's identity");
  const all = await Promise.all(got);
  const json = all.filter((r) => /json/.test(r.type));
  const html = all.filter((r) => /html/.test(r.type));
  const code = all.filter((r) => /javascript|css/.test(r.type));
  const apiPaths = [...new Set(json.map((r) => r.path.replace(/[0-9a-f-]{36}/g, ":id")))].sort();
  console.log(`  received ${all.length}: ${html.length} HTML, ${json.length} JSON, ${code.length} script/style, ${all.length - html.length - json.length - code.length} other`);
  console.log(`  JSON routes: ${apiPaths.join(", ")}`);
  ok("the page read the home strip, the news, the header, the log, the sectors and par",
     ["/api/public/live", "/api/public/news", "/api/public/matches/:id", "/api/public/matches/:id/log", "/api/public/matches/:id/shots"]
       .every((p) => apiPaths.includes(p)), apiPaths.join(", "));
  const named = json.filter((r) => ALLOWED.every((a) => r.body.includes(a)));
  ok("the allowed label is in what was sent (the scan is not passing on a page that names nobody)", named.length > 0);
  const hits = all.flatMap((r) => scan(r.body, needles).map((what) => `${r.status} ${r.path}: ${what}`));
  ok(`no pupil's name, typed name, date of birth, contact, home or mark reason in any of the ${all.length} responses`,
     hits.length === 0, [...new Set(hits)].slice(0, 12).join(" | "));
  const health = [...json, ...html].flatMap((r) => {
    /** @type {string[]} */
    let words;
    try { words = valuesIn(JSON.parse(r.body)); } catch { words = [r.body.replace(/<script[\s\S]*?<\/script>/g, "")]; }
    return words.filter((w) => N23.test(w)).map((w) => `${r.path}: ${w.match(N23)?.[0]}`);
  });
  ok("no word of health or discipline in any API answer or shell (N2, N3)", health.length === 0, [...new Set(health)].slice(0, 8).join(" | "));
  const coords = json.flatMap((r) => { try { return keysIn(JSON.parse(r.body)).filter((k) => COORDINATES.has(k)).map((k) => `${r.path}: ${k}`); } catch { return []; } });
  ok("no placement coordinate in any JSON answer (L7)", coords.length === 0, [...new Set(coords)].join(" | "));

  group("3. Nothing else a stranger's browser holds");
  ok("no response set a cookie", all.every((r) => !r.cookie), all.filter((r) => r.cookie).map((r) => r.path).join(" "));
  const images = all.filter((r) => /^image\//.test(r.type) && !/^\/(assets\/|favicon|icon|apple-touch|brand\/)/.test(r.path));
  ok("no image but the app's own assets (no photograph of a pupil, A8)", images.length === 0, images.map((r) => r.path).join(" "));
  ok("no Authorization or Cookie header was ever sent", sent.every((r) => !r.auth), sent.filter((r) => r.auth).map((r) => r.url).join(" "));
  ok("nothing was read from a signed-in route", sent.every((r) => !/\/api\/(read|matches|auth|me)\b/.test(new URL(r.url).pathname)),
     sent.map((r) => new URL(r.url).pathname).filter((p) => /\/api\/(read|matches|auth|me)\b/.test(p)).join(" "));
  await ctx.close();
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", /** @type {any} */ (e)?.stack ?? e);
} finally {
  await browser.close();
  api.kill();
  await owner.end();
  await app.end();
}
if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\nPUBLIC LIVE PAGE (browser, seed): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

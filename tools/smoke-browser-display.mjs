#!/usr/bin/env node
/**
 * The ground display, signed out, in a browser (SCRBRD-133 G1).
 *
 * The API serves everything from one origin (SERVE_CLIENT=apps/web/dist): the
 * /display shell, /public-app.js and its lazy display chunk, /api/public/*.
 * Nobody signs in; the browser holds no token and sends none. At 1920×1080,
 * 1024×768 and 390×844:
 *
 *   1. Names only under the rule (the consent cases of smoke-browser-public):
 *      L Botha (consented, Hilton published) is named; Westville's consenting
 *      boy is "Batter" until Westville publishes and "R Visser" after; the
 *      office withdraws L Botha's consent and the OPEN display shows "Bowler"
 *      within a read or two (the display's reads are incremental, and a names
 *      map that changed is a full read). No full name, no first name, no
 *      date, no reason, no pseudonym, anywhere in the DOM.
 *   2. No token and no API client: the page asks for its shell, its bundle,
 *      /api/public/ and the font sheet, never with an Authorization header;
 *      no cookie, nothing in storage.
 *   3. No text under 12px at any of the three sizes, on every panel the
 *      rotation shows and on every hold.
 *   4. An unpublished fixture's /display is the one 404; a publication
 *      withdrawn while the display is open says so and stops reading.
 *   5. The rotation skips an empty panel (no pair in: no partnership) and,
 *      after a wicket, shows its fall and then resumes where it was.
 *   6. The innings break and the result hold through dwell after dwell.
 *   7. Full time: the result holds, then the display sleeps — dims, and makes
 *      no further request.
 *   8. Daylight lifts the dim token, rules the rows at 2px; Reduce motion
 *      marks the root; nothing on the page can be tapped or focused.
 *   8b. Par and pressure (G2, design §3): at a ground of the walk's own with
 *      six innings (par 80), a first innings 6 ahead says so on the Board's
 *      second line, the rate track draws par and score with "+6", and the
 *      worm panel draws the par dashed and labelled "Par here 80 (6
 *      innings)"; a chase says what it needs and that the required rate is
 *      climbing, its track the two rates, its worm the target solid; at a
 *      ground with no par nothing is said about par and no track or par line
 *      is drawn; the /par read is no-store, team-level, and an unpublished
 *      fixture's is the one 404; Reduce motion makes the ticks a cut. No
 *      pressure percentage anywhere.
 *   9. The setup section on the fixture's Publication panel, signed in as
 *      the director of sport: the link and its QR code, the three settings
 *      in the link, and "N of M named on public surfaces · K shown by
 *      position" — the count the live page itself shows, and no name.
 *
 * The test hooks are the page's own: window.__SCRBRD_LIVE_MS__ (the poll),
 * __SCRBRD_DISPLAY_DWELL_MS__ (the dwell) and __SCRBRD_DISPLAY_SLEEP_MS__.
 * Every date here is relative to now() or fixed in the past; none is pinned
 * to a day a seed computes.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-display.mjs
 *   DISPLAY_SHOTS=<dir> also saves each size as drawn.
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { buildPublicFixture, HIL } from "./fixture-public.mjs";
import { writeEvents } from "./fixture-matchcentre.mjs";
import { ball, batters, bowler, inningsStart, sealInnings, deriveInnings, BALL_TYPE, INNINGS_END_REASON } from "@scrbrd/scoring";

const PORT = port(8849);
const BASE = `http://127.0.0.1:${PORT}`;
const MISSING = "77777777-0000-0000-0000-0000000fffff";
const GROUND = "ffffffff-0000-0000-0000-000000000001";
const SHOTS = process.env.DISPLAY_SHOTS || null;
const DEBUG = !!process.env.BROWSER_DISPLAY_DEBUG;
const SIZES = [[1920, 1080], [1024, 768], [390, 844]];

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 500)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", SESSION_SECRET: "browser-display-secret",
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-display-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1",
         SERVE_CLIENT: "apps/web/dist", ALLOW_DEV_LOGIN: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));
api.stdout.on("data", (d) => { if (DEBUG) process.stdout.write(d); });

const owner = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const q = async (/** @type {string} */ t, /** @type {any[]} */ p = []) => (await owner.query(t, p)).rows;
async function as(/** @type {string} */ user, /** @type {string} */ text, /** @type {any[]} */ params = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.device_id', 'browser-display', true)", [user]);
    const r = (await c.query(text, params)).rows;
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
const userId = async (/** @type {string} */ email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;
const lastSeq = async (/** @type {string} */ m) => Number((await q(`select coalesce(max(seq), 0) as s from ball_event where match_id = $1`, [m]))[0].s);

const browser = await chromium.launch({ ...launchOptions() });
let ipN = 0;
/**
 * A fresh TV: a context of its own, from an address of its own, signed out,
 * with the page's test hooks set before its script runs.
 * @param {string} path @param {{width?: number, height?: number, hooks?: Record<string, number>}} [o]
 */
async function tv(path, { width = 1920, height = 1080, hooks = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, extraHTTPHeaders: { "x-forwarded-for": `10.85.0.${++ipN}` } });
  await offline(ctx);
  const page = await ctx.newPage();
  const init = Object.entries({ __SCRBRD_LIVE_MS__: 1000, ...hooks }).map(([k, v]) => `window.${k} = ${JSON.stringify(v)};`).join("\n");
  await page.addInitScript(init);
  const errors = [], requests = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  page.on("request", (r) => requests.push({ url: r.url(), auth: r.headers().authorization ?? null, at: Date.now() }));
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  return { ctx, page, res, errors, requests };
}
const tid = (/** @type {any} */ page, /** @type {string} */ id) => page.locator(`[data-testid="${id}"]`);
const panelOf = (/** @type {any} */ page) => page.evaluate(() => document.querySelector('[data-testid="display"]')?.getAttribute("data-panel") ?? null);
/** Wait for `fn` to hold in the page. */
const until = async (/** @type {any} */ page, /** @type {any} */ fn, ms = 15000, arg = undefined) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; }
};
/** Every panel the display shows over `ms`, in order, without repeats. */
async function watch(/** @type {any} */ page, ms) {
  const seen = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = await panelOf(page);
    if (seen[seen.length - 1] !== p) seen.push(p);
    await sleep(100);
  }
  return seen;
}
/** Visible text under 12px: [size, text] for each, sr-only text excepted (as smoke-a11y counts it). */
const smallText = (/** @type {any} */ page) => page.evaluate(() => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest(".sr-only, svg, script, style, noscript")) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.visibility === "hidden" || cs.display === "none" || r.width < 1 || r.height < 1) continue;
    const size = parseFloat(cs.fontSize);
    if (size < 12) out.push(`${size}px "${n.nodeValue.trim().slice(0, 24)}"`);
  }
  return out;
});
/** Anything that can be pressed or focused. */
const tappable = (/** @type {any} */ page) => page.evaluate(() => [...document.querySelectorAll(
  "a[href], button, input, select, textarea, summary, [tabindex], [role=button], [role=link], [role=tab], [onclick], [contenteditable]")]
  .map((e) => e.outerHTML.slice(0, 80)));
const text = (/** @type {any} */ page) => page.$eval("body", (/** @type {any} */ el) => el.innerText);

/** Every word the display must not show (smoke-browser-public's list). */
const NEVER = ["Daniel", "Liam", "Pieter", "Markham", "Sipho", "Ndaba", "Thabo", "Nkosi", "Musa", "Zulu", "Warren", "Guest",
  "Gareth", "Oakes", "Henry", "Bramwell", "Twelfth", "Mansfield", "hurt", "injur", "unavail", "suspend", "Ruan", "Typed"];
const leaks = (/** @type {string} */ s, /** @type {string[]} */ also = [], asText = true) => [...NEVER, ...also].filter((w) => s.includes(w))
  .concat(/\b(19|20)\d\d-\d\d-\d\d\b/.test(s) ? ["a date"] : [])
  .concat(asText && /\b[0-9a-f]{12}\b/.test(s) ? ["a pseudonym shown as text"] : []);

/** A side of eleven whose names were typed: shown by position on any public page (L6). Nobody real. */
const typedXI = (/** @type {string} */ p) => Array.from({ length: 11 }, (_, i) => ({ id: `Typed ${p} ${i + 1}`, name: `Typed ${p} ${i + 1}` }));

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await sleep(250);
  }
  const fx = await buildPublicFixture(q);
  const { pub, pub2, ids } = fx;
  const SARAH = await userId("sarah@example.invalid");
  const REGISTRAR = await userId("registrar@example.invalid");
  const WESPUB = await userId("publisher.wes@example.invalid");
  for (const key of Object.keys(fx.guardians)) await as(fx.guardians[key], `select * from public_name_consent_set($1, true, 'public-names-2026-09')`, [ids[key]]);
  await as(SARAH, `select * from player_never_public_set($1, 'a protection order')`, [ids.markham]);
  await as(SARAH, `select * from fixture_publish($1, 'home', true)`, [pub]);

  /** A fixture of this walk's own, Hilton at home, published, with typed sides. */
  let n = 0;
  const fixture = async (/** @type {string} */ status, /** @type {(at: (ev: any, inn: number) => any) => any[]} */ build,
                         { ground = GROUND, ago = "1 hour", publish = true } = {}) => {
    const id = (await q(
      `insert into match (school_id, team_code, opponent, ground_id, starts_at, sport, format, overs, status)
       values ($1, '1XI', 'Kearsney College 1XI', $2, now() - $4::interval, 'cricket', 'T10', 10, $3) returning id`, [HIL, ground, status, ago]))[0].id;
    if (publish) await as(SARAH, `select * from fixture_publish($1, 'home', true)`, [id]);
    const at = (/** @type {any} */ ev, /** @type {number} */ inn) => ({ ...ev, innings: inn, id: `disp-${++n}`, clientTs: Date.parse("2026-09-30T08:00:00Z") + n * 30_000 });
    await writeEvents(q, id, build(at));
    return { id, at };
  };
  const H = typedXI("Hilton"), K = typedXI("Kearsney");
  const open0 = (/** @type {any} */ at) => [
    at(inningsStart({ battingTeam: "1XI", bowlingTeam: "Kearsney College 1XI", teamKey: "1XI", bowlingTeamKey: "Kearsney College 1XI", squad: H, bowlingSquad: K, overs: 10 }), 0),
    at(batters({ striker: H[0].id, nonStriker: H[1].id }), 0), at(bowler({ bowler: K[0].id }), 0)];
  // ROT: live, an over and two balls bowled, a pair in — every panel of the cycle has something.
  const ROT = await fixture("live", (at) => [...open0(at),
    ...[1, 0, 4, 0, 2, 1].map((v) => at(ball({ value: v }), 0)), at(bowler({ bowler: K[1].id }), 0),
    at(ball({ value: 0 }), 0), at(ball({ value: 1 }), 0)]);
  // BRK: the first innings over, the second not begun.
  // Ten overs of singles, the two bowlers turn about, and the seal.
  const firstInnings = (/** @type {any} */ at) => {
    const all = [...open0(at)];
    for (let o = 0; o < 10; o++) {
      if (o) all.push(at(bowler({ bowler: K[o % 2].id }), 0));
      for (let b = 0; b < 6; b++) all.push(at(ball({ value: 1 }), 0));
    }
    return [...all, at(sealInnings(deriveInnings(all), "overs"), 0)];
  };
  const BRK = await fixture("live", (at) => firstInnings(at));
  // FT: live in the header (nobody has finalised it), and the chase reached in the log: play has decided it.
  const FT = await fixture("live", (at) => {
    const first = firstInnings(at);
    const runs = deriveInnings(first.filter((e) => e.kind !== "innings_end")).runs;
    const need = runs + 1;
    const chase = [at(inningsStart({ battingTeam: "Kearsney College 1XI", bowlingTeam: "1XI", teamKey: "Kearsney College 1XI", bowlingTeamKey: "1XI",
      squad: K, bowlingSquad: H, overs: 10, target: need }), 1), at(batters({ striker: K[0].id, nonStriker: K[1].id }), 1), at(bowler({ bowler: H[0].id }), 1)];
    let got = 0, legal = 0;
    while (got < need) {
      if (legal && legal % 6 === 0) chase.push(at(bowler({ bowler: H[(legal / 6) % 2].id }), 1));
      chase.push(at(ball({ value: 6 }), 1)); got += 6; legal++;
    }
    return [...first, ...chase];
  });

  // ── G2: par and pressure. Two grounds of this walk's own, new each run so
  // a database walked before cannot move the figures. PAR_G: five complete
  // T10 matches with first innings of 70, 75, 80, 85 and 90, and PARC's
  // sealed 80 — six innings, par round(480 ÷ 6) = 80. FEW_G: none.
  /** Hilton's first innings of `runs` off 60 balls (twos, a one when odd, dots), the bowlers turning about. */
  const innings60 = (/** @type {any} */ at, /** @type {number} */ runs, seal = true) => {
    const all = [...open0(at)];
    const steps = [...Array(Math.floor(runs / 2)).fill(2), ...(runs % 2 ? [1] : [])];
    while (steps.length < 60) steps.push(0);
    steps.forEach((v, k) => { if (k && k % 6 === 0) all.push(at(bowler({ bowler: K[(k / 6) % 2].id }), 0)); all.push(at(ball({ value: v }), 0)); });
    // Sealed "overs_complete", the fold's own reason, which venue par's pool reads (db/74).
    return seal ? [...all, at(sealInnings(deriveInnings(all), INNINGS_END_REASON.OVERS), 0)] : all;
  };
  const PAR_G = (await q(`insert into ground (school_id, name) values ($1, $2) returning id`, [HIL, `Display par oval ${Date.now()}`]))[0].id;
  const FEW_G = (await q(`insert into ground (school_id, name) values ($1, $2) returning id`, [HIL, `Display new oval ${Date.now()}`]))[0].id;
  for (const [k, runs] of [70, 75, 80, 85, 90].entries()) {
    await fixture("complete", (at) => innings60(at, runs), { ground: PAR_G, ago: `${k + 2} days`, publish: false });
  }
  // PAR1: a first innings at three overs, 30 (ten an over): par here
  // round(80 × 18 ÷ 60) = 24, so "6 ahead"; CRR 10.00.
  const PAR1 = await fixture("live", (at) => {
    const all = [...open0(at)];
    for (let o = 0; o < 3; o++) {
      if (o) all.push(at(bowler({ bowler: K[o % 2].id }), 0));
      for (const v of [2, 2, 2, 2, 1, 1]) all.push(at(ball({ value: v }), 0));
    }
    return all;
  }, { ground: PAR_G });
  // PARC: Hilton 80 sealed; Kearsney need 81 and have 12 off three overs:
  // 69 off 42 — RRR 69 × 6 ÷ 42 = 9.86, against 81 × 6 ÷ 60 = 8.10 at the
  // start: climbing.
  const PARC = await fixture("live", (at) => {
    const chase = [at(inningsStart({ battingTeam: "Kearsney College 1XI", bowlingTeam: "1XI", teamKey: "Kearsney College 1XI", bowlingTeamKey: "1XI",
      squad: K, bowlingSquad: H, overs: 10, target: 81 }), 1), at(batters({ striker: K[0].id, nonStriker: K[1].id }), 1), at(bowler({ bowler: H[0].id }), 1)];
    for (let o = 0; o < 3; o++) {
      if (o) chase.push(at(bowler({ bowler: H[o % 2].id }), 1));
      for (const v of [2, 2, 0, 0, 0, 0]) chase.push(at(ball({ value: v }), 1));
    }
    return [...innings60(at, 80), ...chase];
  }, { ground: PAR_G });
  // FEW: the same first innings at a ground with no record: nothing about par.
  const FEW = await fixture("live", (at) => {
    const all = [...open0(at)];
    for (let o = 0; o < 3; o++) {
      if (o) all.push(at(bowler({ bowler: K[o % 2].id }), 0));
      for (const v of [2, 2, 2, 2, 1, 1]) all.push(at(ball({ value: v }), 0));
    }
    return all;
  }, { ground: FEW_G });

  group("1. Names only under the rule, at three sizes");
  for (const [w, h] of SIZES) {
    const v = await tv(`/display/${pub}`, { width: w, height: h });
    ok(`${w}×${h}: the shell answers 200, noindex`, v.res?.status() === 200 && /noindex/.test(v.res?.headers()["x-robots-tag"] ?? ""));
    ok(`${w}×${h}: the display draws the Board`, await until(v.page, () => !!document.querySelector('[data-testid="display-total"]')), (await text(v.page)).slice(0, 200));
    const bowl = await tid(v.page, "display-bowler").innerText().catch(() => "");
    ok(`${w}×${h}: the bowler on is L Botha (consented, Hilton published)`, /^L Botha\b/.test(bowl), bowl);
    const bats = await v.page.locator('[data-testid="display-batter"]').allInnerTexts();
    ok(`${w}×${h}: Westville's batters are "Batter" — R Visser consented, but Westville has not published`,
       bats.length === 2 && bats.every((b) => /^●?\s*(on strike: )?Batter\b/.test(b.replace(/\n/g, " "))), bats.join(" | "));
    const body = await text(v.page), html = await v.page.content();
    ok(`${w}×${h}: nothing the rule forbids, in the text or the DOM`, leaks(body).length === 0 && leaks(html, ["Visser"], false).length === 0,
       [...leaks(body), ...leaks(html, ["Visser"], false)].join(","));
    if (SHOTS) await v.page.screenshot({ path: `${SHOTS}/display-pub-${w}x${h}.png` });
    ok(`${w}×${h}: no console errors`, v.errors.length === 0, v.errors.join(" | "));
    await v.ctx.close();
  }
  {
    // One display stays open while the rule's inputs change under it.
    const v = await tv(`/display/${pub}`);
    await until(v.page, () => !!document.querySelector('[data-testid="display-bowler"]'));
    await as(WESPUB, `select * from fixture_publish($1, 'away', true)`, [pub]);
    ok("Westville publishes: the open display names R Visser within a few reads",
       await until(v.page, () => [...document.querySelectorAll('[data-testid="display-batter"]')].some((e) => /R Visser/.test(e.textContent)), 20000),
       (await v.page.locator('[data-testid="display-batter"]').allInnerTexts()).join(" | "));
    const [w] = await as(REGISTRAR, `select ok, reason from public_name_consent_set($1, false, 'public-names-2026-09', $2)`, [ids.botha, fx.guardians.botha]);
    ok("the office withdraws L Botha's consent", w.ok === true, w.reason);
    ok("...and the OPEN display shows \"Bowler\" — a changed names map is a full read, never a label held from before",
       await until(v.page, () => /^Bowler\b/.test(document.querySelector('[data-testid="display-bowler"]')?.textContent ?? ""), 20000),
       await tid(v.page, "display-bowler").innerText().catch(() => ""));
    ok("...and \"Botha\" is nowhere on it", !(await v.page.content()).includes("Botha"));
    ok("no console errors (names changing under an open display)", v.errors.length === 0, v.errors.join(" | "));

    group("2. No token, no API client");
    const allowed = (/** @type {string} */ u) => u.startsWith("https://fonts.googleapis.com/") || u.startsWith("https://fonts.gstatic.com/")
      || (u.startsWith(BASE) && /^\/display\/|^\/public-app\.js$|^\/assets\/|^\/api\/public\/matches\//.test(new URL(u).pathname));
    ok(`the display asked for nothing but its shell, its bundle and /api/public/ (${v.requests.length} requests)`,
       v.requests.length > 5 && v.requests.every((r) => allowed(r.url)), v.requests.map((r) => r.url).filter((u) => !allowed(u)).join(" "));
    ok("...never with an Authorization header", v.requests.every((r) => r.auth == null));
    ok("...its live reads are incremental: /log?since=", v.requests.some((r) => /\/log\?since=\d+$/.test(r.url)));
    const held = await v.page.evaluate(() => ({ cookie: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    ok("no cookie, nothing in local or session storage", held.cookie === "" && held.local.length === 0 && held.session.length === 0, JSON.stringify(held));
    await v.ctx.close();
  }

  group("3. No text under 12px, at three sizes, on every panel and hold");
  for (const [w, h] of SIZES) {
    const small = new Set();
    const seen = new Set();
    for (const [id, label] of [[ROT.id, "the cycle"], [BRK.id, "the break"], [FT.id, "the result"], [PAR1.id, "par"], [PARC.id, "the chase"]]) {
      const v = await tv(`/display/${id}`, { width: w, height: h, hooks: { __SCRBRD_DISPLAY_DWELL_MS__: 1200 } });
      await until(v.page, () => !!document.querySelector('[data-testid="display"]'));
      // Fourteen looks half a second apart: the four panels of the cycle at a 1.2 s dwell, with room.
      for (let i = 0; i < 14; i++) {
        const key = `${label}:${await panelOf(v.page)}`;
        if (SHOTS && !seen.has(key)) await v.page.screenshot({ path: `${SHOTS}/display-${key.replace(/\W+/g, "-")}-${w}x${h}.png` });
        seen.add(key);
        for (const s of await smallText(v.page)) small.add(s);
        await sleep(500);
      }
      const box = await v.page.evaluate(() => {
        const t = document.querySelector('[data-testid="display-total"]')?.getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, total: t ? t.right <= innerWidth + 1 && t.bottom <= innerHeight + 1 : null };
      });
      ok(`${w}×${h} (${label}): nothing wider than the screen, the total wholly on it`, !box.overflow && box.total !== false, JSON.stringify(box));
      await v.ctx.close();
    }
    ok(`${w}×${h}: no text under 12px across ${[...seen].join(", ")}`, small.size === 0, [...small].slice(0, 8).join(" · "));
    ok(`${w}×${h}: the walk saw all three panels of the cycle and both holds`,
       ["the cycle:partnership", "the cycle:overs", "the cycle:bowling", "the break:break", "the result:result"].every((p) => seen.has(p)), [...seen].join(", "));
    ok(`${w}×${h}: ...and the worm, with its par line and the rate track, in the sweep (G2)`,
       ["par:worm", "the chase:worm"].every((p) => seen.has(p)), [...seen].join(", "));
  }

  group("4. Not published is not found");
  {
    const unpub = (await q(`insert into match (school_id, team_code, opponent, ground_id, starts_at, sport, format, overs, status)
      values ($1, '1XI', 'Kearsney College 1XI', $2, now() - interval '1 hour', 'cricket', 'T10', 10, 'live') returning id`, [HIL, GROUND]))[0].id;
    const a = await tv(`/display/${unpub}`), b = await tv(`/display/${MISSING}`), c = await tv(`/live/${MISSING}`);
    const [ta, tb, tc] = await Promise.all([a, b, c].map((x) => x.res?.text() ?? ""));
    ok("an unpublished fixture's /display: 404, the same page as a missing one's and as /live's", a.res?.status() === 404 && b.res?.status() === 404
       && ta === tb && tb === tc, `${a.res?.status()} ${b.res?.status()}`);
    ok("...noindex, no-store", /noindex/.test(a.res?.headers()["x-robots-tag"] ?? "") && a.res?.headers()["cache-control"] === "no-store");
    ok("...and no bundle was loaded for it", !a.requests.some((r) => /public-app\.js/.test(r.url)));
    const pu = await fetch(`${BASE}/api/public/matches/${unpub}/par`, { headers: { "x-forwarded-for": "10.85.2.9" } });
    const pm = await fetch(`${BASE}/api/public/matches/${MISSING}/par`, { headers: { "x-forwarded-for": "10.85.2.9" } });
    ok("...its par read (G2) is the same 404 as a missing fixture's", pu.status === 404 && pm.status === 404 && (await pu.text()) === (await pm.text()));
    for (const x of [a, b, c]) await x.ctx.close();
  }

  group("5. The rotation: an empty panel skipped; a wicket, then where it was");
  {
    const v = await tv(`/display/${ROT.id}`, { hooks: { __SCRBRD_DISPLAY_DWELL_MS__: 1500 } });
    await until(v.page, () => !!document.querySelector('[data-testid="display-panel"] section'));
    const before = await watch(v.page, 7000);
    ok(`a pair in: the cycle shows all three (${before.join(" → ")})`, ["partnership", "overs", "bowling"].every((p) => before.includes(p)));
    // Hold the cycle on bowling, the third, with a long dwell, then the wicket.
    ok("the cycle reaches bowling", await until(v.page, () => document.querySelector('[data-testid="display"]')?.getAttribute("data-panel") === "bowling", 10000));
    await v.page.evaluate(() => { /** @type {any} */ (window).__SCRBRD_DISPLAY_DWELL_MS__ = 600000; });
    await writeEvents(q, ROT.id, [ROT.at(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }), 0)], await lastSeq(ROT.id));
    ok("a wicket: the fall of the wicket, within a read", await until(v.page, () => document.querySelector('[data-testid="display"]')?.getAttribute("data-panel") === "fow", 10000),
       await panelOf(v.page));
    const fow = await tid(v.page, "display-panel-fow").innerText().catch(() => "");
    ok("...by position, with how he went and the score at the fall", /Batter/.test(fow) && /\bb Bowler\b/.test(fow) && /Score at the fall/.test(fow) && leaks(fow).length === 0, fow);
    const said = await tid(v.page, "display-fow-line").innerText().catch(() => "");
    ok(`...and the generator's own line for it, nobody named who is not ("${said}")`, /bowled/i.test(said) && /the striker/i.test(said) && leaks(said).length === 0);
    const t0 = Date.now();
    ok("...then BOWLING again, where the cycle was — not its start", await until(v.page, () => document.querySelector('[data-testid="display"]')?.getAttribute("data-panel") === "bowling", 12000),
       await panelOf(v.page));
    const took = Date.now() - t0;
    ok(`...after the fall's eight seconds (${Math.round(took / 100) / 10} s more)`, took > 4000 && took < 11000, String(took));
    await v.page.evaluate(() => { /** @type {any} */ (window).__SCRBRD_DISPLAY_DWELL_MS__ = 1500; });
    const noPair = await watch(v.page, 7000);
    ok(`no pair in (the next batter not yet out): the partnership is skipped (${noPair.join(" → ")})`,
       !noPair.includes("partnership") && noPair.includes("overs") && noPair.includes("bowling"));
    await writeEvents(q, ROT.id, [ROT.at(batters({ striker: H[2].id }), 0)], await lastSeq(ROT.id));
    ok("the next batter in: the partnership is back in the cycle",
       await until(v.page, () => document.querySelector('[data-testid="display"]')?.getAttribute("data-panel") === "partnership", 12000));
    ok("no console errors (the rotation)", v.errors.length === 0, v.errors.join(" | "));
    await v.ctx.close();
  }

  group("6. The break and the result hold");
  {
    const b = await tv(`/display/${BRK.id}`, { hooks: { __SCRBRD_DISPLAY_DWELL_MS__: 1000 } });
    await until(b.page, () => !!document.querySelector('[data-testid="display-panel-break"]'));
    const seenB = await watch(b.page, 5000);
    ok(`the innings break holds through five dwells (${seenB.join(" → ")})`, seenB.join() === "break");
    const words = await tid(b.page, "display-panel-break").innerText().catch(() => "");
    ok("...the chase's target in words and the four facts", /Kearsney College 1XI need \d+ to win from 10 overs/.test(words) && /Top scorers/i.test(words) && /Best bowling/i.test(words), words);
    await b.ctx.close();
    const r = await tv(`/display/${FT.id}`, { hooks: { __SCRBRD_DISPLAY_DWELL_MS__: 1000 } });
    await until(r.page, () => !!document.querySelector('[data-testid="display-panel-result"]'));
    const seenR = await watch(r.page, 5000);
    ok(`the result holds through five dwells (${seenR.join(" → ")})`, seenR.join() === "result");
    ok("...in the result's words", /won by \d+ wickets?/.test(await tid(r.page, "display-result-words").innerText().catch(() => "")),
       await tid(r.page, "display-result-words").innerText().catch(() => ""));
    await r.ctx.close();
  }

  group("7. Full time: the result holds, then the display sleeps and stops reading");
  {
    const v = await tv(`/display/${FT.id}`, { hooks: { __SCRBRD_DISPLAY_SLEEP_MS__: 5000 } });
    await until(v.page, () => !!document.querySelector('[data-testid="display-panel-result"]'));
    const reads = () => v.requests.filter((x) => /\/api\/public\//.test(x.url)).length;
    const r0 = reads();
    await sleep(2500);
    ok(`before it sleeps it is still reading (${reads() - r0} reads in 2.5 s)`, reads() > r0);
    ok("after the sleep time it sleeps", await until(v.page, () => document.querySelector('[data-testid="display"]')?.getAttribute("data-sleeping") === "true", 8000));
    const dim = await v.page.evaluate(() => getComputedStyle(document.querySelector(".dv-board")).opacity);
    await sleep(1300);
    ok(`...the Board dims (opacity ${await v.page.evaluate(() => getComputedStyle(document.querySelector(".dv-board")).opacity)})`,
       Number(await v.page.evaluate(() => getComputedStyle(document.querySelector(".dv-board")).opacity)) <= 0.41, dim);
    ok("...the result still on it", await tid(v.page, "display-panel-result").isVisible());
    const r1 = reads();
    await sleep(6000);
    ok(`...and in six seconds it makes no request at all (${reads() - r1})`, reads() === r1);
    await v.ctx.close();
  }

  group("8. Daylight, Reduce motion, and nothing to press");
  {
    const read = async (/** @type {string} */ qs) => {
      const v = await tv(`/display/${ROT.id}${qs}`);
      await until(v.page, () => !!document.querySelector(".dv-overs small"));
      const got = await v.page.evaluate(() => ({
        dim: getComputedStyle(document.querySelector(".dv-overs small")).color,
        rule: getComputedStyle(document.querySelector(".dv-row")).borderTopWidth,
        figure: getComputedStyle(document.querySelector('[data-testid="display-total"]')).color,
        face: getComputedStyle(document.querySelector('[data-testid="display"]')).backgroundColor,
        theme: document.querySelector('[data-testid="display"]').getAttribute("data-theme-display"),
        reduce: document.documentElement.hasAttribute("data-reduce-motion"),
        dwell: document.querySelector('[data-testid="display"]').getAttribute("data-dwell"),
      }));
      return { v, got };
    };
    const flood = await read("");
    const day = await read("?theme=daylight&dwell=long&motion=reduce");
    ok(`Floodlit: board.dim as built (${flood.got.dim}), 1px rules`, flood.got.dim === "rgb(138, 148, 165)" && flood.got.rule === "1px" && flood.got.theme === "floodlit");
    ok(`Daylight lifts the dim token (${day.got.dim}) and rules the rows at 2px`, day.got.dim === "rgb(184, 192, 204)" && day.got.rule === "2px" && day.got.theme === "daylight");
    ok("...and the board's black and white do not move", day.got.face === flood.got.face && day.got.figure === flood.got.figure && day.got.face === "rgb(11, 14, 11)");
    ok("Long dwell and Reduce motion from the same address", day.got.dwell === "long" && day.got.reduce === true && flood.got.reduce === false);
    for (const x of [flood, day]) {
      ok(`nothing to tap or focus (${x.got.theme})`, (await tappable(x.v.page)).length === 0, (await tappable(x.v.page)).join(" "));
      await x.v.page.keyboard.press("Tab");
      ok(`...Tab lands nowhere (${x.got.theme})`, await x.v.page.evaluate(() => document.activeElement === document.body || document.activeElement == null));
      const url = x.v.page.url();
      await x.v.page.mouse.click(400, 400);
      await sleep(200);
      ok(`...a click goes nowhere (${x.got.theme})`, x.v.page.url() === url);
      await x.v.ctx.close();
    }
  }

  group("8b. Par and pressure (G2): the second line, the rate track, the worm's par");
  {
    const sub = (/** @type {any} */ page) => tid(page, "display-sub").innerText().catch(() => "");
    const p1 = await tv(`/display/${PAR1.id}`, { hooks: { __SCRBRD_DISPLAY_DWELL_MS__: 1500 } });
    const want1 = "6 ahead of par for this ground · CRR 10.00";
    ok(`a first innings at 30 after three overs, par here 24: "${want1}"`,
       await until(p1.page, (/** @type {string} */ w) => document.querySelector('[data-testid="display-sub"]')?.textContent === w, 15000, want1), await sub(p1.page));
    const rt = await p1.page.evaluate(() => {
      const t = document.querySelector('[data-testid="display-rate-track"]');
      return t && { kind: t.getAttribute("data-kind"), from: t.querySelector('[data-testid="display-rate-track-from"]')?.textContent,
        to: t.querySelector('[data-testid="display-rate-track-to"]')?.textContent, gap: t.querySelector('[data-testid="display-rate-track-gap"]')?.textContent,
        marks: [...t.querySelectorAll("[data-mark]")].map((m) => m.getAttribute("data-mark")).join(), said: t.querySelector(".sr-only")?.textContent };
    });
    ok('...the rate track: par 24 a bar, the score 30 a dot, "+6", and the same in words for a reader',
       rt?.kind === "par" && rt.from === "par 24" && /\b30$/.test(rt.to ?? "") && rt.gap === "+6" && rt.marks === "bar,dot"
       && /par 24, .*30: 6 ahead of par for this ground/.test(rt.said ?? ""), JSON.stringify(rt));
    ok("...the worm panel comes round", await until(p1.page, () => document.querySelector('[data-testid="display"]')?.getAttribute("data-panel") === "worm", 12000));
    const worm1 = await p1.page.evaluate(() => ({
      par: !!document.querySelector('[data-testid="display-worm-par"]'),
      dash: document.querySelector('[data-testid="display-worm-par"]')?.getAttribute("stroke-dasharray"),
      label: document.querySelector('[data-testid="display-worm-par-label"]')?.textContent,
      legend: document.querySelector('[data-testid="display-worm-legend"]')?.textContent,
      said: document.querySelector('[data-testid="display-worm"] [role="img"]')?.getAttribute("aria-label"),
    }));
    ok('...the par dashed, "Par here 80 (6 innings)", the legend saying what it is',
       worm1.par && !!worm1.dash && worm1.label === "Par here 80 (6 innings)" && /Par: this ground, 6 innings \(dashed\) · proportion of overs; no DLS table loaded/.test(worm1.legend ?? "")
       && /Par here 80 \(6 innings\), dashed/.test(worm1.said ?? ""), JSON.stringify(worm1));
    const body1 = await text(p1.page);
    ok("...no pressure figure and no percentage anywhere (D4)", !/pressure|\d\s?%/i.test(body1) && leaks(body1).length === 0, body1.slice(0, 300));
    const parRead = p1.requests.find((r) => /\/api\/public\/matches\/[^/]+\/par$/.test(r.url));
    ok("...read from /api/public/…/par, with no Authorization header", !!parRead && parRead.auth == null);
    const pj = await fetch(`${BASE}/api/public/matches/${PAR1.id}/par`, { headers: { "x-forwarded-for": "10.85.2.8" } });
    const pb = await pj.text();
    const pv = JSON.parse(pb);
    ok("the read: no-store, the ground's par 80 from 6 and par here 24, team-level — no innings list, no ground, no name",
       pj.headers.get("cache-control") === "no-store" && pv.venue?.par === 80 && pv.venue.n === 6 && pv.venue.parAt === 24
       && !/innings"|breakdown|ground|match_id|"name"/.test(JSON.stringify(pv.venue)) && !/cells|resource|"name"|ground/.test(pb)
       // (asText off: the answer carries the fixture's own uuid, which is no pseudonym.)
       && leaks(pb, [], false).length === 0, pb.slice(0, 300));
    ok("no console errors (par, first innings)", p1.errors.length === 0, p1.errors.join(" | "));
    await p1.ctx.close();

    const pc = await tv(`/display/${PARC.id}`, { hooks: { __SCRBRD_DISPLAY_DWELL_MS__: 1500 } });
    const wantC = "Need 69 off 42 · RRR 9.86, climbing";
    ok(`a chase of 81 at 12 after three overs: "${wantC}"`,
       await until(pc.page, (/** @type {string} */ w) => document.querySelector('[data-testid="display-sub"]')?.textContent === w, 15000, wantC), await sub(pc.page));
    const rc = await pc.page.evaluate(() => {
      const t = document.querySelector('[data-testid="display-rate-track"]');
      return t && { kind: t.getAttribute("data-kind"), from: t.querySelector('[data-testid="display-rate-track-from"]')?.textContent,
        to: t.querySelector('[data-testid="display-rate-track-to"]')?.textContent, gap: t.querySelector('[data-testid="display-rate-track-gap"]')?.textContent };
    });
    ok('...the rate track: CRR 4.00 against RRR 9.86, "climbing"', rc?.kind === "rate" && rc.from === "CRR 4.00" && rc.to === "RRR 9.86" && rc.gap === "climbing", JSON.stringify(rc));
    ok("...the worm comes round", await until(pc.page, () => document.querySelector('[data-testid="display"]')?.getAttribute("data-panel") === "worm", 12000));
    const wormC = await pc.page.evaluate(() => ({
      target: document.querySelector('[data-testid="display-worm-target-label"]')?.textContent,
      lines: [...document.querySelectorAll('[data-testid="display-worm-line"]')].map((l) => l.getAttribute("data-tone")).join(),
      par: document.querySelector('[data-testid="display-worm-par-label"]')?.textContent,
    }));
    ok('...the target solid, "Target 81"; the first innings dim; the ground\'s par dashed (drawn, not said)',
       wormC.target === "Target 81" && wormC.lines === "dim,main" && wormC.par === "Par here 80 (6 innings)", JSON.stringify(wormC));
    ok("no console errors (par, the chase)", pc.errors.length === 0, pc.errors.join(" | "));
    await pc.ctx.close();

    const pf = await tv(`/display/${FEW.id}`, { hooks: { __SCRBRD_DISPLAY_DWELL_MS__: 1500 } });
    ok('a ground with no record: the line as it was — "CRR 10.00 · At this rate: 100" — nothing about par',
       await until(pf.page, () => /^CRR 10\.00/.test(document.querySelector('[data-testid="display-sub"]')?.textContent ?? ""), 15000)
       && !/par/i.test(await sub(pf.page)), await sub(pf.page));
    ok("...no rate track", await tid(pf.page, "display-rate-track").count() === 0);
    ok("...the worm draws no par line", await until(pf.page, () => document.querySelector('[data-testid="display"]')?.getAttribute("data-panel") === "worm", 12000)
       && await tid(pf.page, "display-worm-par").count() === 0 && await tid(pf.page, "display-worm-line").count() === 1);
    const fj = await (await fetch(`${BASE}/api/public/matches/${FEW.id}/par`, { headers: { "x-forwarded-for": "10.85.2.8" } })).json();
    ok("...its read says nothing of par: no venue, no track", fj.venue === null && fj.track.length === 0 && fj.trackOf === null, JSON.stringify(fj));
    await pf.ctx.close();

    // Reduce motion: the ticks are a cut, not a slide (§3.5, §4.3).
    const tick = async (/** @type {string} */ qs) => {
      const v = await tv(`/display/${PAR1.id}${qs}`);
      await until(v.page, () => !!document.querySelector('[data-testid="display-rate-track"] .os-tick'));
      const t = await v.page.evaluate(() => { const c = getComputedStyle(document.querySelector('[data-testid="display-rate-track"] .os-tick')); return `${c.transitionProperty} ${c.transitionDuration}`; });
      await v.ctx.close();
      return t;
    };
    const moving = await tick(""), still = await tick("?motion=reduce");
    ok(`the ticks slide by transform (${moving}); under Reduce motion they cut (${still})`,
       /transform/.test(moving) && !/^(none|all) 0s$/.test(moving) && (/^none\b/.test(still) || / 0s$/.test(still)), `${moving} | ${still}`);
  }

  group("9. The setup section, signed in as the director of sport");
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.85.1.${++ipN}` } });
    await offline(ctx);
    const page = await ctx.newPage();
    await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)};`);
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    // The app is at /app since SCRBRD-142; / is the public home page.
    await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    const press = async (/** @type {RegExp} */ re) => {
      const l = page.locator("button:not([disabled])", { hasText: re }).first();
      if (await l.count()) { await l.click({ timeout: 5000 }).catch(() => {}); await sleep(500); }
    };
    await press(/Get Started|Log In/); await press(/sarah@example\.invalid|Director/); await press(/^Sign In$/);
    await sleep(1500);
    await page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
    await sleep(1500);
    await tid(page, `match-card-${pub}`).click({ timeout: 6000 }).catch(() => {});
    const shown = await until(page, () => !!document.querySelector('[data-testid="display-setup"]'), 15000);
    ok("the fixture's Publication panel carries the Ground display section (Hilton has published)", shown, (await text(page)).slice(0, 300));
    const link = () => tid(page, "display-setup-link").innerText().catch(() => "");
    const qr = () => page.locator('[data-testid="display-setup-qr"] path').getAttribute("d").catch(() => "");
    ok("the link is the display's own address, plain", (await link()) === `${BASE}/display/${pub}`, await link());
    const qr0 = await qr();
    ok("...with a QR code drawn for it", (qr0 ?? "").length > 500);
    await tid(page, "display-setup-theme-daylight").click();
    await tid(page, "display-setup-dwell-long").click();
    await tid(page, "display-setup-motion").check();
    ok("Daylight, Long and Reduce motion travel in the link", (await link()) === `${BASE}/display/${pub}?theme=daylight&dwell=long&motion=reduce`, await link());
    ok("...and the QR code follows the link", (await qr()) !== qr0);
    ok("...the choices are radios that say which is chosen",
       await tid(page, "display-setup-theme-daylight").getAttribute("aria-checked") === "true"
       && await tid(page, "display-setup-theme-floodlit").getAttribute("aria-checked") === "false");
    // What the live page names of Hilton's side right now, from the public answer itself.
    const l = await (await fetch(`${BASE}/api/public/matches/${pub}/log`, { headers: { "x-forwarded-for": "10.85.2.1" } })).json();
    const s0 = l.events.find((/** @type {any} */ e) => e.kind === "innings_start" && e.innings === 0);
    const hilton = (s0?.squad ?? []).map((/** @type {any} */ m) => m.label);
    const named = hilton.filter((/** @type {string} */ x) => x !== "Batter").length;
    const line = await tid(page, "display-setup-names-home").innerText().catch(() => "");
    ok(`"${line}" — the live page's own count (${named} of ${hilton.length})`,
       line === `Home side: ${named} of ${hilton.length} named on public surfaces · ${hilton.length - named} shown by position`, line);
    ok("...no count for Westville's side (Sarah may not publish it)", await tid(page, "display-setup-names-away").count() === 0);
    const setup = await tid(page, "display-setup").innerText();
    // (asText off: the section's link carries the fixture's own uuid, which is no pseudonym.)
    ok("...and no boy's name in the section", leaks(setup, ["Erasmus", "Visser", "Botha", "Nkosi"], false).length === 0,
       leaks(setup, ["Erasmus", "Visser", "Botha", "Nkosi"], false).join(","));
    ok("...which points at consent as the way a boy is named", /consent/i.test(await tid(page, "display-setup-consent").textContent() ?? ""));
    ok("no page errors (the setup section)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  group("4b. A publication withdrawn while the display is open");
  {
    const v = await tv(`/display/${ROT.id}`);
    await until(v.page, () => !!document.querySelector('[data-testid="display-total"]'));
    await as(SARAH, `select * from fixture_publish($1, 'home', false)`, [ROT.id]);
    ok("Hilton withdraws its side: \"This display is no longer available\"", await until(v.page, () => !!document.querySelector('[data-testid="display-gone"]'), 15000));
    const r1 = v.requests.length;
    await sleep(4000);
    ok("...and it stops reading", v.requests.length === r1, String(v.requests.length - r1));
    await v.ctx.close();
  }
  void pub2;
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
console.log(`\nGROUND DISPLAY (browser): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

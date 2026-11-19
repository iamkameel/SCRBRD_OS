#!/usr/bin/env node
/**
 * A knockout competition's bracket, in a real browser (SCRBRD-060), against a
 * real API and Postgres. The cup is made by this walk alone: three teams, a
 * knockout drawn and published by the planner through the API, so the top
 * seed has a bye, one semi-final is made and the final is held.
 *
 *   A  AN ENTRANT SCHOOL, BEFORE A BALL. Westville's administrator opens
 *      Competitions → the cup: a bracket, not a league table. Two rounds; the
 *      bye said as a bye; the final's one side the top seed, the other "To be
 *      decided" with the semi-final it waits for; its date a plan's.
 *   B  THE SEMI-FINAL PLAYED, THE FINAL MADE. Its log written as the pad
 *      writes it, the organiser publishes again: the semi-final's result in
 *      words, its winner marked Through, and the final's two sides named.
 *   C  LEAGUES. Leagues → the cup opens on its Bracket tab, with no table tab
 *      and no "No standings yet".
 *   D  Nothing set under 12px, nothing pressed under 44px; the rounds side by
 *      side at 1366 and one after another at 390 with no sideways scroll;
 *      nothing in the bracket animates under reduced motion; Daylight.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-bracket.mjs
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import pg from "pg";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";
import { destByWord } from "./walk-nav.mjs";

const PORT = port(9061);
const BASE = `http://127.0.0.1:${PORT}`;
const DEBUG = !!process.env.BROWSER_BRACKET_DEBUG;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const WM = "ffffffff-0000-0000-0000-000000000002";
const OVAL = "ffffffff-0000-0000-0000-000000000001";
const SCORER = "88888888-0000-0000-0000-000000000006";
const CUP_NAME = "Walk 060 Cup";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "browser-bracket-secret", SERVE_CLIENT: process.env.BRACKET_DIST || "apps/web/dist" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
server.stdout.on("data", (d) => { if (DEBUG) process.stdout.write(d); });

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await pool.query(text, params)).rows;
const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "bracket-desk" } })).body?.token;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

/** A one-over match's log as the pad writes it: six singles, then a chase of `chase`. */
async function play(m, chase, startsAt) {
  const [x] = await q(`select school_id, team_code, opponent from match where id = $1`, [m]);
  const t0 = Date.parse(startsAt);
  let seq = 0;
  const ev = async (innings, kind, ballType, value, payload) => {
    seq++;
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                     client_seq, client_ts, kind, ball_type, value, payload)
             values ($1, $2, $3, 1, $4, $5, 'bracket-pad', $6, $3, $7, $8, $9, $10, $11)`,
      [m, x.school_id, seq, innings, SCORER, `br:${m}:${seq}`, new Date(t0 + seq * 20_000).toISOString(), kind, ballType, value, JSON.stringify(payload ?? {})]);
  };
  await ev(0, "innings_start", null, null, { battingTeam: x.team_code, bowlingTeam: x.opponent, overs: 1 });
  for (let i = 0; i < 6; i++) await ev(0, "ball", "run", 1);
  await ev(0, "innings_end", null, null, { reason: "overs_complete", confirmed: { runs: 6, wickets: 0, balls: 6 } });
  await ev(1, "innings_start", null, null, { battingTeam: x.opponent, bowlingTeam: x.team_code, overs: 1, target: 7 });
  for (const v of chase) await ev(1, "ball", "run", v);
}

const browser = await chromium.launch({ ...launchOptions() });
async function open({ theme = "floodlit", viewport = { width: 1366, height: 900 }, reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  const errors = [];
  page.on("dialog", (d) => { d.dismiss().catch(() => {}); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(BASE)};
    try { localStorage.setItem("scrbrd:theme", ${JSON.stringify(theme)}); } catch (e) {}`);
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const words = async (loc) => ((await loc.first().innerText({ timeout: 3000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
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
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await afterReads(page, 2000);
  return (await page.locator("nav button").count()) > 0;
}
async function toCompetitions(page) {
  const l = await destByWord(page, /^Competitions$/);
  if (!(await l.count())) return false;
  await l.click({ timeout: 6000 });
  await afterReads(page, 1200);
  return true;
}
async function toCup(page, c) {
  if (!(await toCompetitions(page))) return false;
  const b = tid(page, `competition-${c}`);
  if (!(await b.count())) return false;
  await b.click({ timeout: 5000 });
  await afterReads(page, 1500);
  await tid(page, "league-bracket").first().waitFor({ timeout: 6000 }).catch(() => {});
  return (await tid(page, "league-bracket").count()) === 1;
}
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA|SUMMARY)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio", "hidden"].includes(n.type))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, sideways: document.documentElement.scrollWidth - window.innerWidth };
  }).catch(() => ({ small: ["(not drawn)"], tiny: [], sideways: 0 }));
}
const floorsOk = (f) => f.small.length === 0 && f.tiny.length === 0;
const floorsWhy = (f) => [...f.small, ...f.tiny].slice(0, 4).join(" · ");
/** Where round 1 and round 2 sit: side by side, or one after the other. */
const layout = (page) => page.evaluate(() => {
  const a = document.querySelector('[data-testid="league-bracket"] [data-testid="bracket-round-1"]')?.getBoundingClientRect();
  const b = document.querySelector('[data-testid="league-bracket"] [data-testid="bracket-round-2"]')?.getBoundingClientRect();
  if (!a || !b) return "missing";
  if (Math.abs(a.top - b.top) < 2 && b.left >= a.right - 1) return "columns";
  if (b.top >= a.bottom - 1) return "stacked";
  return `other ${JSON.stringify({ a: [a.left, a.top, a.right, a.bottom], b: [b.left, b.top, b.right, b.bottom] })}`;
});
const sideOf = async (tie, which) => ({
  known: await tie.locator(`[data-testid="bracket-${which}"]`).getAttribute("data-known"),
  text: await words(tie.locator(`[data-testid="bracket-${which}"] [data-testid="bracket-side-said"]`)),
});

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const league = await login("league@example.invalid");   // competitionadmin, no school: the organiser
  ok("the organiser signs in through the API", !!league);

  // ── The cup, made by this walk ─────────────────────────────────
  const [{ today }] = await q(`select sa_today()::text as today`);
  const dayOf = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const at = (day, hhmm) => `${day}T${hhmm}:00+02:00`;
  const SEMI = dayOf(8), FINAL = dayOf(15);
  const [{ id: CUP }] = await q(`insert into competition (school_id, name, comp_type, format, level) values (null, $1, 'knockout', 'T20', 'school') returning id`, [CUP_NAME]);
  for (const [name, school, team] of [["Walk 060 Hilton 1st XI", HIL, "1XI"], ["Walk 060 Westville 1st XI", WES, "1XI"], ["Walk 060 Hilton 2nd XI", HIL, "2XI"]]) {
    await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, $3, $4)`, [CUP, school, team, name]);
  }
  for (const [ground, day] of [[OVAL, SEMI], [WM, SEMI], [OVAL, FINAL]]) {
    await q(`insert into ground_window (ground_id, starts_at, ends_at, competition_id) values ($1, $2, $3, $4)`, [ground, at(day, "09:00"), at(day, "13:00"), CUP]);
  }
  const drawn = await call(`/api/competitions/${CUP}/plans`, { method: "POST", token: league,
    body: { format: "knockout", from: SEMI, to: FINAL, rules: { durationMinutes: 180, preparationMinutes: 30 } } });
  ok("the planner draws the cup: one semi-final and a final, and a bye", drawn.status === 200 && drawn.body?.fixtures?.length === 2
     && drawn.body?.byes?.length === 1, show(drawn));
  const pub = await call(`/api/competitions/${CUP}/plans/${drawn.body?.id}/publish`, { method: "POST", token: league });
  ok("...published: the semi-final made, the final held", pub.status === 200 && pub.body?.counts?.created === 1 && pub.body?.counts?.held === 1, show(pub));
  const SEMI_MATCH = pub.body?.results?.find((r) => r.matchId)?.matchId;
  const seed1 = drawn.body?.byes?.[0]?.name;

  // ── A ──────────────────────────────────────────────────────────
  group("A. An entrant school, before a ball: Competitions → the cup draws a bracket");
  const wes = await open();
  ok("Westville's administrator signs in", await signIn(wes.page, "registrar.wes@example.invalid"));
  let p = wes.page;
  ok("Competitions → the cup draws a bracket", await toCup(p, CUP));
  ok("...and no league table", (await tid(p, "standings").count()) === 0);
  const br = tid(p, "league-bracket");
  ok("two rounds: the semi-finals, then the final",
     /^Semi-finals/i.test(await words(br.locator('[data-testid="bracket-round-1"] h3'))) && /^Final/i.test(await words(br.locator('[data-testid="bracket-round-2"] h3'))),
     `${await words(br.locator('[data-testid="bracket-round-1"] h3'))} / ${await words(br.locator('[data-testid="bracket-round-2"] h3'))}`);
  ok("the bye is said as a bye, to the top seed", (await words(br.locator('[data-testid="bracket-byes"]'))) === `${seed1} has a bye in Semi-finals.`,
     await words(br.locator('[data-testid="bracket-byes"]')));
  const finalTie = br.locator('[data-testid="bracket-round-2"] [data-testid="bracket-tie"]');
  const fh = await sideOf(finalTie, "home"), fa = await sideOf(finalTie, "away");
  const [seeded, waiting] = fh.known === "yes" ? [fh, fa] : [fa, fh];
  ok("the final: the top seed named", seeded.known === "yes" && seeded.text === seed1, JSON.stringify({ fh, fa }));
  ok("...the other side \"To be decided\", naming the semi-final it waits for",
     waiting.known === "no" && waiting.text === "To be decided Winner of Semi-finals · Match 2", JSON.stringify(waiting));
  ok("...its date the plan's, said as a plan", /^Planned for /.test(await words(finalTie.locator('[data-testid="bracket-when"]'))),
     await words(finalTie.locator('[data-testid="bracket-when"]')));
  const semiTie = br.locator('[data-testid="bracket-round-1"] [data-testid="bracket-tie"]');
  ok("the semi-final: its fixture, both sides named, a date, no result yet",
     (await semiTie.getAttribute("data-match-id")) === SEMI_MATCH && (await sideOf(semiTie, "home")).known === "yes" && (await sideOf(semiTie, "away")).known === "yes"
     && (await semiTie.locator('[data-testid="bracket-when"]').getAttribute("data-known")) === "yes" && (await semiTie.locator('[data-testid="bracket-result"]').count()) === 0);
  ok("the source is said: the published draw", /From the published draw \(version 1\)/.test(await words(br.locator('[data-testid="bracket-source"]'))));

  // ── B ──────────────────────────────────────────────────────────
  group("B. The semi-final played; the final made from its winner");
  await play(SEMI_MATCH, [0, 0, 0, 0, 0, 0], at(SEMI, "09:00"));   // the home side by 6 runs
  await q(`update match set status = 'complete' where id = $1`, [SEMI_MATCH]);
  const pub2 = await call(`/api/competitions/${CUP}/plans/${drawn.body?.id}/publish`, { method: "POST", token: league });
  ok("...publishing again makes the final", pub2.status === 200 && pub2.body?.counts?.created === 1, show(pub2));
  // Away to Leagues and back: the Competitions screen mounts again and reads afresh.
  await tid(p, "home-competitions-section-leagues").click({ timeout: 5000 }).catch(() => {});
  await afterReads(p, 1200);
  await tid(p, "home-competitions-section-competitions").click({ timeout: 5000 }).catch(() => {});
  await afterReads(p, 1200);
  await tid(p, `competition-${CUP}`).click({ timeout: 5000 }).catch(() => {});
  await afterReads(p, 1500);
  await p.locator('[data-testid="league-bracket"] [data-testid="bracket-round-2"] [data-testid="bracket-tie"][data-match-id]:not([data-match-id=""])')
    .first().waitFor({ timeout: 6000 }).catch(() => {});
  ok("the cup again, read afresh", (await tid(p, "league-bracket").count()) === 1);
  const semiHome = (await sideOf(semiTie, "home")).text;
  ok("the semi-final's result in words, the home side marked Through",
     /won by 6 runs/.test(await words(semiTie.locator('[data-testid="bracket-result"]')))
     && (await semiTie.locator('[data-testid="bracket-home"] [data-testid="bracket-through"]').count()) === 1
     && (await semiTie.locator('[data-testid="bracket-away"] [data-testid="bracket-through"]').count()) === 0,
     await words(semiTie));
  const fh2 = await sideOf(finalTie, "home"), fa2 = await sideOf(finalTie, "away");
  ok("the final's two sides named: the top seed and the semi-final's winner",
     fh2.known === "yes" && fa2.known === "yes" && [fh2.text, fa2.text].sort().join() === [seed1, semiHome].sort().join(),
     JSON.stringify({ fh2, fa2, semiHome }));
  ok("...each side by its entered name, as the draw named it", /^Walk 060 /.test(fh2.text) && /^Walk 060 /.test(fa2.text), JSON.stringify({ fh2, fa2 }));
  ok("...with its fixture's date now, not the plan's", !!(await finalTie.getAttribute("data-match-id"))
     && !/^Planned/.test(await words(finalTie.locator('[data-testid="bracket-when"]'))), await words(finalTie));
  ok("no page error", wes.errors.length === 0, wes.errors.join(" | "));

  // ── C ──────────────────────────────────────────────────────────
  group("C. Leagues → the cup opens on its bracket");
  const sec = tid(p, "home-competitions-section-leagues");
  ok("the Leagues section is offered", (await sec.count()) === 1);
  if (await sec.count()) {
    await sec.click({ timeout: 5000 });
    await afterReads(p, 1500);
    const pick = tid(p, `league-comp-${CUP}`);
    ok("...the cup is listed", (await pick.count()) === 1);
    if (await pick.count()) { await pick.click({ timeout: 5000 }); await afterReads(p, 1500); }
    await tid(p, "league-bracket").first().waitFor({ timeout: 6000 }).catch(() => {});
    ok("...it opens on the Bracket tab, pressed", (await tid(p, "league-tab-bracket").getAttribute("aria-pressed").catch(() => null)) === "true");
    ok("...no table tab and no \"No standings yet\"", (await tid(p, "league-tab-table").count()) === 0
       && !(await p.getByText("No standings yet.").count()));
    ok("...the same bracket: the final's sides named", (await p.locator('[data-testid="league-bracket"] [data-testid="bracket-round-2"] [data-known="no"]').count()) === 0
       && (await p.locator('[data-testid="league-bracket"] [data-testid="bracket-tie"]').count()) === 2);
  }
  await wes.ctx.close();

  // ── D ──────────────────────────────────────────────────────────
  group("D. The floors: 1366, 390, Daylight, reduced motion");
  const wide = await open();
  await signIn(wide.page, "registrar.wes@example.invalid");
  await toCup(wide.page, CUP);
  const fw = await floors(wide.page, "league-bracket");
  ok("1366: nothing under 12px, nothing pressed under 44px", floorsOk(fw), floorsWhy(fw));
  ok("1366: the rounds side by side", (await layout(wide.page)) === "columns", await layout(wide.page));
  await wide.ctx.close();

  // Reached at a desktop, then narrowed (as browser-league does): the phone's
  // own navigation is browser-narrow's walk, not this one's.
  const phone = await open();
  await signIn(phone.page, "registrar.wes@example.invalid");
  const reached = await toCup(phone.page, CUP);
  await phone.page.setViewportSize({ width: 390, height: 844 });
  await afterReads(phone.page, 1000);
  ok("390: the cup draws a bracket", reached && (await tid(phone.page, "league-bracket").count()) === 1);
  const fp = await floors(phone.page, "league-bracket");
  ok("390: nothing under 12px, nothing pressed under 44px", floorsOk(fp), floorsWhy(fp));
  ok("390: no sideways scroll", fp.sideways <= 0, `${fp.sideways}px`);
  ok("390: the rounds one after another", (await layout(phone.page)) === "stacked", await layout(phone.page));
  await phone.ctx.close();

  const day = await open({ theme: "daylight", reducedMotion: "reduce" });
  await signIn(day.page, "registrar.wes@example.invalid");
  ok("Daylight: the cup draws a bracket", await toCup(day.page, CUP));
  const fd = await floors(day.page, "league-bracket");
  ok("Daylight: the floors hold", floorsOk(fd), floorsWhy(fd));
  const moving = await day.page.$eval('[data-testid="league-bracket"]', (el) =>
    [el, ...el.querySelectorAll("*")].flatMap((n) => n.getAnimations()).filter((a) => a.playState === "running").length).catch(() => -1);
  ok("reduced motion: nothing in the bracket animates", moving === 0, String(moving));
  ok("no page error", day.errors.length === 0, day.errors.join(" | "));
  await day.ctx.close();
} catch (err) {
  ok(`the walk threw: ${err.message?.slice(0, 300)}`, false);
  console.log(err.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await browser.close().catch(() => {});
  server.kill("SIGTERM");
  await pool.end();
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 16).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER BRACKET SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

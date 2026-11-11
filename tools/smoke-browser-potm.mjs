#!/usr/bin/env node
/**
 * RECOGNITION R6 — Player of the Match, the coach's path, from a browser
 * (docs/design/RECOGNITION_design.md D17, D18, D21, §7 "the coach"; db/142).
 *
 * One finished fixture, scored on the real write path with both innings
 * sealed: Hilton's 1XI at home to Westville's 1XI, today. Then, at phone
 * width (390 × 844):
 *
 *   1. The side's coach opens it. The Match Centre's staff sheet carries
 *      "Player of the Match": "Based on batting and bowling only.", two
 *      suggestions with their figures, none chosen, the award button
 *      disabled until he chooses; "Someone else…" opens the rest of the
 *      sheet, where the boy he is guardian of cannot be chosen and the line
 *      says the director of sport decides.
 *   2. He chooses, reads "This awards Player of the Match to T Bekker and
 *      tells the side.", awards it; the standing award is drawn with his
 *      name; the side's notice is in the database at team scope, to nobody
 *      alone.
 *   3. He withdraws it after a correction, with a reason: the side's second
 *      notice names nobody.
 *   4. The floors: no text under 12px, nothing tapped under 44px in the
 *      sheet, a choice is a radio (never colour alone); no console error.
 *   5. A parent and the 2XI coach arrive on the same fixture: no sheet at
 *      all, and the API gives them no side to decide.
 *   6. RECOGNITION R7 (db/144): R Pillay, the season's captain, signed in as
 *      himself on a second finished fixture: his Captain tab says "Nominate
 *      one team-mate. <coach> decides. You cannot choose yourself.", the
 *      coach's two suggestions with figures, none chosen, himself on neither
 *      list, the other side's boys nowhere; the floors; one confirm sheet;
 *      then his row "You nominated T Bekker · …" "With <coach>." The coach's
 *      To-resolve list carries "Player of the Match to decide · the captain
 *      nominated T Bekker"; his sheet "The captain nominated T Bekker ·
 *      decide by …", Confirm in one tap and a confirm sheet; R6's honour is
 *      tied to the nomination; the captain's tab then reads the award.
 *   7. RECOGNITION R10 (db/148): a third finished fixture, its balls stamped
 *      as the pad stamps them; the coach awards J Whitfield; an amendment
 *      voids his first six. The award stands. The coach's To-resolve list
 *      carries "Player of the Match to review · J Whitfield · the scorecard
 *      was corrected"; its door opens the fixture, where the sheet reads
 *      "The figures this award cited have changed: 17* (6) → 11* (5).
 *      Withdraw, or let it stand." He lets it stand, in one tap of 44px:
 *      the review is gone and the award still stands; the floors hold; no
 *      console error.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-potm.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { inningsStart, batters, bowler, ball, sealInnings, deriveInnings, BALL_TYPE } from "@scrbrd/scoring";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";
import { pickTab } from "./walk-tabs.mjs";

const WEB_PORT = port(5371);
const API_PORT = port(8971);
const API = `http://127.0.0.1:${API_PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";
const NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PHONE = { width: 390, height: 844 };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-potm-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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
const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const browser = await chromium.launch({ ...launchOptions() });

async function open() {
  const ctx = await browser.newContext({ viewport: PHONE, colorScheme: "light", reducedMotion: "reduce" });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  return { ctx, page, errors };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const until = async (page, fn, ms = 10000, arg = undefined) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }); return true; } catch { return false; }
};
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
/** Arrive on the fixture's own address, then sign in as `who`. */
async function arrive(page, match, who) {
  await page.goto(`http://localhost:${WEB_PORT}/app/matches/${match}`, { waitUntil: "networkidle" });
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(400);
  await click(page, who, 4000);
  await click(page, /^Sign In$/, 5000);
  await tid(page, "match-view").waitFor({ timeout: 12000 }).catch(() => {});
  await afterReads(page, 1500);
  return (await tid(page, "match-view").count()) === 1;
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  group("A finished fixture, scored on the write path");
  const scorerTok = (await call("/api/auth/dev-login", { method: "POST", body: { email: "scorer@example.invalid", deviceId: "potm-pad" } })).body?.token;
  const [{ id: M }] = await q(
    `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, '1XI', $2, '1XI', 'Westville', now() - interval '3 hours', 'cricket', 'T20', 1, 'scheduled') returning id`, [HIL, WES]);
  const HXI = [WHITFIELD, BEKKER, NAIDOO, PILLAY].map((id, i) => ({ id, name: `Hilton ${i + 1}` }));
  const WXI = ["01", "02"].map((n) => ({ id: `bbbbbbbb-0000-0000-0000-0000000000${n}`, name: `Westville ${n}` }));
  for (const p of HXI) await q(`insert into match_squad (match_id, player_id, side) values ($1, $2, 'home')`, [M, p.id]);
  for (const p of WXI) await q(`insert into match_squad (match_id, player_id, side) values ($1, $2, 'away')`, [M, p.id]);
  const claim = await call(`/api/matches/${M}/session/claim`, { method: "POST", token: scorerTok, body: { device: "potm-pad" } });
  let cs = 0, k = 0, refused = [];
  const T0 = Date.now() - 3 * 3600_000;
  for (const [i, inn] of [
    { bat: "1XI", bowl: "Westville 1XI", squad: HXI, bowlingSquad: WXI, balls: [6, 4, 6, 0, 0, 1].map((v) => ball({ type: BALL_TYPE.RUN, value: v })) },
    { bat: "Westville 1XI", bowl: "1XI", squad: WXI, bowlingSquad: [HXI[1], HXI[0]], target: 18,
      balls: [ball({ type: BALL_TYPE.RUN, value: 0 }), ball({ type: BALL_TYPE.RUN, value: 0 }), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })] },
  ].entries()) {
    const evs = [inningsStart({ battingTeam: inn.bat, bowlingTeam: inn.bowl, squad: inn.squad, bowlingSquad: inn.bowlingSquad, overs: 1, target: inn.target ?? null }),
      batters({ striker: inn.squad[0].id, nonStriker: inn.squad[1].id }), bowler({ bowler: inn.bowlingSquad[0].id }), ...inn.balls]
      .map((e) => ({ ...e, innings: i }));
    evs.push({ ...sealInnings(deriveInnings(evs)), innings: i });
    const r = await call(`/api/matches/${M}/events`, { method: "POST", token: scorerTok, body: { events: evs.map((ev) => ({
      epoch: claim.body?.epoch, deviceId: "potm-pad", idempotencyKey: `bpotm-${M}-${++k}`, clientSeq: ++cs, clientTs: T0 + k * 20_000, innings: i, payload: ev })) } });
    refused = refused.concat(r.body?.refused ?? []);
  }
  await call(`/api/matches/${M}/session/release`, { method: "POST", token: scorerTok, body: { device: "potm-pad" } }).catch(() => null);
  await q(`update match set status = 'complete' where id = $1`, [M]);
  ok("scored, sealed and finished: the database calls it verified", claim.body?.ok === true && refused.length === 0
     && (await q(`select match_verified($1) v`, [M]))[0].v === true, JSON.stringify(refused).slice(0, 200));
  // The coach is Naidoo's guardian too (a pending link).
  const coachId = (await q(`select id from app_user where email = 'coach@example.invalid'`))[0].id;
  const coachName = (await q(`select name from app_user where id = $1`, [coachId]))[0].name;
  const [{ id: gA }] = await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`, [coachId, HIL]);
  await q(`insert into assignment_subject (assignment_id, player_id, relationship) values ($1, $2, 'parent')`, [gA, NAIDOO]);

  group("The side's coach decides it, on the staff sheet");
  const co = await open();
  ok("the coach arrives on the fixture and signs in", await arrive(co.page, M, /coach@example\.invalid|Head Coach/));
  ok("the sheet carries Player of the Match", await until(co.page, () => !!document.querySelector('[data-testid="mc-potm"]'), 12000));
  ok("...based on batting and bowling only", (await tid(co.page, "mc-potm-basis").innerText().catch(() => "")) === "Based on batting and bowling only.");
  const sugg = await co.page.$$eval('[data-testid="mc-potm-suggestions"] label', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, " ").trim()));
  ok("...two suggestions, each with its figures", sugg.length === 2 && /T Bekker 1\/0 \(0\.3\)/.test(sugg[0]) && /James Whitfield 17\* \(6\)/.test(sugg[1]), sugg.join(" | "));
  ok("...none chosen for him", await co.page.$$eval('[data-testid="mc-potm"] input[type="radio"]', (rs) => rs.every((r) => !r.checked)));
  ok("...and the award waits for his choice", await tid(co.page, "mc-potm-award").isDisabled()
     && /Choose a player first/.test(await tid(co.page, "mc-potm-award").innerText()));
  await tid(co.page, "mc-potm-more").click();
  ok("Someone else… opens the rest of the side", (await tid(co.page, "mc-potm-more").getAttribute("aria-expanded")) === "true"
     && await tid(co.page, "mc-potm-sheet").locator("label").count() === 2);
  const own = tid(co.page, `mc-potm-option-${NAIDOO}`);
  ok("...where the boy he is guardian of cannot be chosen, and the line says who decides",
     await own.locator("input").isDisabled() && /You are his guardian, so the director of sport decides\./.test(await own.innerText()));
  await tid(co.page, `mc-potm-option-${BEKKER}`).locator("input").check();
  ok("choosing names the award", /Award to T Bekker/.test(await tid(co.page, "mc-potm-award").innerText()) && !(await tid(co.page, "mc-potm-award").isDisabled()));

  // The floors, with the whole sheet drawn.
  const floors = await co.page.$eval('[data-testid="mc-potm"]', (root) => {
    const small = [], short = [];
    for (const el of root.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 12) small.push(el.textContent.trim().slice(0, 30));
    }
    for (const el of root.querySelectorAll("button, label")) {
      const r = el.getBoundingClientRect();
      if (r.height && r.height < 44) short.push(`${el.tagName} ${Math.round(r.height)} ${el.textContent.trim().slice(0, 20)}`);
    }
    return { small, short, wide: root.scrollWidth <= root.clientWidth + 1 };
  });
  ok("no text under 12px", floors.small.length === 0, floors.small.join(" | "));
  ok("nothing tapped under 44px", floors.short.length === 0, floors.short.join(" | "));
  ok("nothing wider than the phone", floors.wide);
  const awardH = (await tid(co.page, "mc-potm-award").boundingBox())?.height ?? 0;
  ok("the one tap is 56px", awardH >= 56, String(awardH));

  await tid(co.page, "mc-potm-award").click();
  ok("the confirm sheet says what it does, in §7's words",
     (await tid(co.page, "mc-potm-confirm-words").innerText().catch(() => "")) === "This awards Player of the Match to T Bekker and tells the side.");
  await tid(co.page, "mc-potm-confirm-go").click();
  ok("awarded, in words", await until(co.page, () => /Awarded: T Bekker is Player of the Match, and the side is told\./.test(document.querySelector('[data-testid="mc-potm-said"]')?.textContent ?? "")));
  ok("...and the standing award is drawn, with who decided it",
     await until(co.page, (n) => (document.querySelector('[data-testid="mc-potm-standing"]')?.textContent ?? "").includes(`Player of the Match: T Bekker · decided by ${n}`), 10000, coachName),
     await tid(co.page, "mc-potm-standing").innerText().catch(() => "∅"));
  const said = await q(`select title, scope_level, recipient_id from notification where kind = 'recognition' and subject_kind = 'match' and subject_id = $1`, [M]);
  ok("the side is told, at team scope, to nobody alone", said.length === 1 && said[0].scope_level === "team" && said[0].recipient_id === null
     && /^Player of the Match · .+ v Westville Boys' High 1XI: T Bekker$/.test(said[0].title), JSON.stringify(said));

  group("He withdraws it after a correction");
  await tid(co.page, "mc-potm-withdraw").click();
  ok("the sheet asks why, in two kinds, and says what each tells the side",
     await tid(co.page, "mc-potm-withdraw-sheet").count() === 1
     && /Nobody is named/.test(await tid(co.page, "mc-potm-kind-correction").innerText())
     && /nothing more is said/.test(await tid(co.page, "mc-potm-kind-other").innerText()));
  await tid(co.page, "mc-potm-withdraw-go").click();
  ok("a withdrawal with no kind is refused in words", /Say whether it is withdrawn/.test(await tid(co.page, "mc-potm-said").innerText().catch(() => "")));
  await tid(co.page, "mc-potm-kind-correction").locator("input").check();
  await tid(co.page, "mc-potm-reason").fill("The scorecard was corrected after the match");
  await tid(co.page, "mc-potm-withdraw-go").click();
  ok("withdrawn, in words", await until(co.page, () => /Withdrawn\. The side is told it was withdrawn after the scorecard was corrected\./.test(document.querySelector('[data-testid="mc-potm-said"]')?.textContent ?? "")));
  ok("...and the side may be given one again", await until(co.page, () => !!document.querySelector('[data-testid="mc-potm-suggestions"]'), 10000));
  const told = await q(`select title, body, subject_person_id, retracted_at from notification where kind = 'recognition' and subject_kind = 'match' and subject_id = $1`, [M]);
  ok("the side's notice is taken back and one more names nobody", told.length === 2 && told.filter((x) => x.retracted_at).length === 1
     && told.some((x) => !x.retracted_at && x.subject_person_id === null && /the award was withdrawn after the scorecard was corrected\.$/.test(x.body) && !/Bekker/.test(x.title + x.body)),
     JSON.stringify(told));
  ok("no console errors (the coach)", co.errors.length === 0, co.errors.join(" | "));
  await co.ctx.close();

  group("The captain nominates, on his Captain tab (RECOGNITION R7, db/144)");
  // R Pillay is the 1XI's captain this season; a second finished fixture
  // with him on the sheet (Whitfield 17* off 6, Bekker 1/0, and Naidoo).
  const SEASON = (await q(`select id from season_for(sa_today(), 'school')`))[0].id;
  await q(`insert into honour (player_id, kind, season_id, citation) values ($1, 'captain', $2, 'the walk')`, [PILLAY, SEASON]);
  const [{ id: M2 }] = await q(
    `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, '1XI', $2, '1XI', 'Westville', now() - interval '2 hours', 'cricket', 'T20', 1, 'scheduled') returning id`, [HIL, WES]);
  const HXI2 = [PILLAY, WHITFIELD, BEKKER, NAIDOO].map((id, i) => ({ id, name: `Hilton ${i + 1}` }));
  for (const p of HXI2) await q(`insert into match_squad (match_id, player_id, side) values ($1, $2, 'home')`, [M2, p.id]);
  for (const p of WXI) await q(`insert into match_squad (match_id, player_id, side) values ($1, $2, 'away')`, [M2, p.id]);
  {
    const claim2 = await call(`/api/matches/${M2}/session/claim`, { method: "POST", token: scorerTok, body: { device: "potm-pad" } });
    let cs2 = 0, k2 = 0, refused2 = [];
    const T1 = Date.now() - 2 * 3600_000;
    for (const [i, inn] of [
      { bat: "1XI", bowl: "Westville 1XI", squad: HXI2, bowlingSquad: WXI, balls: [6, 4, 6, 0, 0, 1].map((v) => ball({ type: BALL_TYPE.RUN, value: v })) },
      { bat: "Westville 1XI", bowl: "1XI", squad: WXI, bowlingSquad: [HXI2[2], HXI2[1]], target: 18,
        balls: [ball({ type: BALL_TYPE.RUN, value: 0 }), ball({ type: BALL_TYPE.RUN, value: 0 }), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })] },
    ].entries()) {
      const evs = [inningsStart({ battingTeam: inn.bat, bowlingTeam: inn.bowl, squad: inn.squad, bowlingSquad: inn.bowlingSquad, overs: 1, target: inn.target ?? null }),
        batters({ striker: inn.squad[i === 0 ? 1 : 0].id, nonStriker: inn.squad[i === 0 ? 2 : 1].id }), bowler({ bowler: inn.bowlingSquad[0].id }), ...inn.balls]
        .map((e) => ({ ...e, innings: i }));
      evs.push({ ...sealInnings(deriveInnings(evs)), innings: i });
      const r = await call(`/api/matches/${M2}/events`, { method: "POST", token: scorerTok, body: { events: evs.map((ev) => ({
        epoch: claim2.body?.epoch, deviceId: "potm-pad", idempotencyKey: `bnom-${M2}-${++k2}`, clientSeq: ++cs2, clientTs: T1 + k2 * 20_000, innings: i, payload: ev })) } });
      refused2 = refused2.concat(r.body?.refused ?? []);
    }
    await call(`/api/matches/${M2}/session/release`, { method: "POST", token: scorerTok, body: { device: "potm-pad" } }).catch(() => null);
    await q(`update match set status = 'complete' where id = $1`, [M2]);
    ok("a second fixture, R Pillay the captain on its sheet, verified", claim2.body?.ok === true && refused2.length === 0
       && (await q(`select match_verified($1) v`, [M2]))[0].v === true, JSON.stringify(refused2).slice(0, 200));
  }

  let pu = await open();
  // His own app: signed in as himself, Matches, the played match (as smoke-browser-pupil walks it).
  const toHisTab = async () => {
    await pu.page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
    await click(pu.page, /Get Started|Log In/, 5000);
    await pu.page.waitForTimeout(400);
    await click(pu.page, /pillay@example\.invalid/, 4000);
    await click(pu.page, /^Sign In$/, 5000);
    await afterReads(pu.page, 2200);
    const nav = pu.page.locator('[data-testid="mnav-mymatches"], [data-testid="nav-mymatches"]').first();
    await nav.click({ timeout: 6000 }).catch(() => {});
    await afterReads(pu.page, 1800);
    await tid(pu.page, `played-row-${M2}`).click({ timeout: 6000 }).catch(() => {});
    await pu.page.waitForTimeout(2200);
    await pickTab(pu.page, "captain").catch(() => {});
    await afterReads(pu.page, 1500);
  };
  await toHisTab();
  ok("R Pillay, signed in as himself, opens the played match's Captain tab", (await tid(pu.page, "mc-captain").count()) === 1);
  ok("his Captain tab carries Player of the Match", await until(pu.page, () => !!document.querySelector('[data-testid="mc-captain-potm"]'), 12000));
  ok("...in §7's words: one team-mate, the coach decides, never himself",
     (await tid(pu.page, "mc-captain-potm-lead").innerText().catch(() => "")) === `Nominate one team-mate. ${coachName} decides. You cannot choose yourself.`,
     await tid(pu.page, "mc-captain-potm-lead").innerText().catch(() => "∅"));
  ok("...based on batting and bowling only", (await tid(pu.page, "mc-captain-potm-basis").innerText().catch(() => "")) === "Based on batting and bowling only.");
  const csugg = await pu.page.$$eval('[data-testid="mc-captain-potm-suggestions"] label', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, " ").trim()));
  ok("...the coach's two suggestions, with the figures he reads on the scorecard",
     csugg.length === 2 && /T Bekker 1\/0 \(0\.3\)/.test(csugg[0]) && /J(ames)? Whitfield 17\* \(6\)/.test(csugg[1]), csugg.join(" | "));
  ok("...none chosen for him, and the tap waits", await pu.page.$$eval('[data-testid="mc-captain-potm"] input[type="radio"]', (rs) => rs.every((r) => !r.checked))
     && await tid(pu.page, "mc-captain-potm-nominate").isDisabled() && /Choose a team-mate first/.test(await tid(pu.page, "mc-captain-potm-nominate").innerText()));
  await tid(pu.page, "mc-captain-potm-more").click();
  const blockText = await tid(pu.page, "mc-captain-potm").innerText();
  ok("Someone else… opens the rest of his side, and he is on neither list", await tid(pu.page, "mc-captain-potm-sheet").locator("label").count() === 1
     && await tid(pu.page, `mc-captain-potm-option-${PILLAY}`).count() === 0, blockText);
  ok("...no boy of the other side is offered", !/Westville 0/.test(blockText) && await tid(pu.page, "mc-captain-potm-option-bbbbbbbb-0000-0000-0000-000000000001").count() === 0);
  const cfloors = await pu.page.$eval('[data-testid="mc-captain-potm"]', (root) => {
    const small = [], short = [];
    for (const el of root.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 12) small.push(el.textContent.trim().slice(0, 30));
    }
    for (const el of root.querySelectorAll("button, label")) {
      const r = el.getBoundingClientRect();
      if (r.height && r.height < 44) short.push(`${el.tagName} ${Math.round(r.height)} ${el.textContent.trim().slice(0, 20)}`);
    }
    return { small, short, wide: root.scrollWidth <= root.clientWidth + 1 };
  });
  ok("no text under 12px on his block", cfloors.small.length === 0, cfloors.small.join(" | "));
  ok("nothing tapped under 44px on his block", cfloors.short.length === 0, cfloors.short.join(" | "));
  ok("nothing wider than the phone", cfloors.wide);
  ok("the one tap is 56px", ((await tid(pu.page, "mc-captain-potm-nominate").boundingBox())?.height ?? 0) >= 56);
  await tid(pu.page, `mc-captain-potm-option-${BEKKER}`).locator("input").check();
  ok("choosing names the tap", /^Nominate T Bekker$/.test((await tid(pu.page, "mc-captain-potm-nominate").innerText()).trim()));
  await tid(pu.page, "mc-captain-potm-nominate").click();
  ok("one confirm sheet, saying who decides", /^This sends T Bekker to .+ as your nomination\. He decides, and the side hears it from him\.$/.test(
     await tid(pu.page, "mc-captain-potm-confirm-words").innerText().catch(() => "")), await tid(pu.page, "mc-captain-potm-confirm-words").innerText().catch(() => "∅"));
  await tid(pu.page, "mc-captain-potm-confirm-go").click();
  ok("his row reads his nomination, with the coach", await until(pu.page, (n) => {
    const t = document.querySelector('[data-testid="mc-captain-potm-mine"]')?.innerText ?? "";
    return /You nominated T Bekker · \w{3} \d\d:\d\d/.test(t) && t.includes(`With ${n}.`);
  }, 10000, coachName), await tid(pu.page, "mc-captain-potm-mine").innerText().catch(() => "∅"));
  ok("...and the pick is gone", await tid(pu.page, "mc-captain-potm-choose").count() === 0);
  const nrow = await q(`select status, nominee_player_id, nominated_by_player_id from recognition_nomination where match_id = $1`, [M2]);
  ok("the database holds one open nomination, his, of T Bekker", nrow.length === 1 && nrow[0].status === "open" && nrow[0].nominee_player_id === BEKKER
     && nrow[0].nominated_by_player_id === PILLAY, JSON.stringify(nrow));
  ok("...and nobody was sent a notice about it", (await q(`select count(*)::int n from notification where subject_id = $1`, [M2]))[0].n === 0);
  ok("no verdict word anywhere on his tab", !/rejected|declined|overruled/i.test(await tid(pu.page, "mc-captain-potm").innerText()));
  ok("no console errors (the captain)", pu.errors.length === 0, pu.errors.join(" | "));

  group("The coach reads it on his To-resolve list, and confirms it on the sheet");
  const cq = await open();
  await cq.page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  await click(cq.page, /Get Started|Log In/, 5000);
  await cq.page.waitForTimeout(400);
  await click(cq.page, /coach@example\.invalid|Head Coach/, 4000);
  await click(cq.page, /^Sign In$/, 5000);
  await afterReads(cq.page, 2000);
  // To resolve is under Operate on the coach's nav.
  for (const sel of ['[data-testid="mnav-readiness"]', '[data-testid="nav-readiness"]']) {
    const l = cq.page.locator(sel).first();
    if (await l.count()) { await l.click({ timeout: 6000 }).catch(() => {}); break; }
  }
  if ((await tid(cq.page, "queue").count()) === 0) {
    await cq.page.locator("button", { hasText: /^More$|Operate/ }).first().click({ timeout: 3000 }).catch(() => {});
    await cq.page.locator('[data-testid="mnav-readiness"], [data-testid="nav-readiness"], button:has-text("To resolve")').first().click({ timeout: 4000 }).catch(() => {});
  }
  await afterReads(cq.page, 2000);
  const qrow = await until(cq.page, () => /Player of the Match to decide · the captain nominated T Bekker/.test(document.querySelector('[data-testid="queue-potm"]')?.innerText ?? ""), 12000);
  ok("his To-resolve list carries the row, with its deadline", qrow && /by \w{3} \d\d:\d\d/.test(await tid(cq.page, "queue-potm").innerText().catch(() => "")),
     await tid(cq.page, "queue-potm").innerText().catch(() => "∅"));
  ok("no console errors (the To-resolve list)", cq.errors.length === 0, cq.errors.join(" | "));
  await cq.ctx.close();

  const c2 = await open();
  ok("the coach arrives on the fixture", await arrive(c2.page, M2, /coach@example\.invalid|Head Coach/));
  ok("the sheet says the captain nominated T Bekker, and by when",
     await until(c2.page, () => /^The captain nominated T Bekker · decide by \w{3} \d\d:\d\d$/.test((document.querySelector('[data-testid="mc-potm-nomination-line"]')?.textContent ?? "").trim()), 12000),
     await tid(c2.page, "mc-potm-nomination-line").innerText().catch(() => "∅"));
  ok("...Confirm is the one tap, 56px; Choose another and No award beside it",
     ((await tid(c2.page, "mc-potm-nomination-confirm").boundingBox())?.height ?? 0) >= 56
     && await tid(c2.page, "mc-potm-nomination-another").count() === 1 && await tid(c2.page, "mc-potm-nomination-none").count() === 1);
  ok("...and R6's picker waits behind Choose another", await tid(c2.page, "mc-potm-choose").count() === 0);
  await tid(c2.page, "mc-potm-nomination-confirm").click();
  ok("the confirm sheet is §7's", (await tid(c2.page, "mc-potm-nomination-words").innerText().catch(() => "")) === "This awards Player of the Match to T Bekker and tells the side.");
  await tid(c2.page, "mc-potm-nomination-go").click();
  ok("awarded, in words, and the standing award drawn", await until(c2.page, () => /Awarded: T Bekker is Player of the Match/.test(document.querySelector('[data-testid="mc-potm-said"]')?.textContent ?? "")
     && /Player of the Match: T Bekker/.test(document.querySelector('[data-testid="mc-potm-standing"]')?.textContent ?? ""), 10000));
  const done = await q(`select n.status, h.player_id, h.nomination_id = n.id as tied from recognition_nomination n join honour h on h.id = n.honour_id where n.match_id = $1`, [M2]);
  ok("the nomination is confirmed by R6's honour, tied to it", done.length === 1 && done[0].status === "confirmed" && done[0].player_id === BEKKER && done[0].tied, JSON.stringify(done));
  ok("no console errors (the coach, R7)", c2.errors.length === 0, c2.errors.join(" | "));
  await c2.ctx.close();

  await pu.ctx.close();
  pu = await open();
  await toHisTab();
  ok("the captain's tab reads the award as the side sees it", await until(pu.page,
     () => /Player of the Match: T Bekker/.test(document.querySelector('[data-testid="mc-captain-potm-mine"]')?.innerText ?? ""), 12000),
     await tid(pu.page, "mc-captain-potm-mine").innerText().catch(() => "∅"));
  await pu.ctx.close();

  group("A correction returns the award to its decider (RECOGNITION R10, db/148)");
  {
    const headTok = (await call("/api/auth/dev-login", { method: "POST", body: { email: "sarah@example.invalid", deviceId: "potm-r10" } })).body?.token;
    const coachTok = (await call("/api/auth/dev-login", { method: "POST", body: { email: "coach@example.invalid", deviceId: "potm-r10" } })).body?.token;
    const [{ id: M3 }] = await q(
      `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
       values ($1, '1XI', $2, '1XI', 'Westville', now() - interval '1 hour', 'cricket', 'T20', 1, 'scheduled') returning id`, [HIL, WES]);
    for (const p of HXI) await q(`insert into match_squad (match_id, player_id, side) values ($1, $2, 'home')`, [M3, p.id]);
    for (const p of WXI) await q(`insert into match_squad (match_id, player_id, side) values ($1, $2, 'away')`, [M3, p.id]);
    const claim3 = await call(`/api/matches/${M3}/session/claim`, { method: "POST", token: scorerTok, body: { device: "potm-pad" } });
    let cs3 = 0, k3 = 0, refused3 = [];
    const T3 = Date.now() - 3600_000;
    const W1 = WXI[0].id;
    // Stamped with striker and bowler, as the pad stamps a ball (engine.jsx).
    for (const [i, inn] of [
      { bat: "1XI", bowl: "Westville 1XI", squad: HXI, bowlingSquad: WXI,
        balls: [6, 4, 6, 0, 0, 1].map((v) => ball({ type: BALL_TYPE.RUN, value: v, striker: WHITFIELD, bowler: W1 })) },
      { bat: "Westville 1XI", bowl: "1XI", squad: WXI, bowlingSquad: [HXI[1], HXI[0]], target: 18,
        balls: [ball({ type: BALL_TYPE.RUN, value: 0, striker: W1, bowler: BEKKER }), ball({ type: BALL_TYPE.RUN, value: 0, striker: W1, bowler: BEKKER }),
                ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled", striker: W1, bowler: BEKKER })] },
    ].entries()) {
      const evs = [inningsStart({ battingTeam: inn.bat, bowlingTeam: inn.bowl, squad: inn.squad, bowlingSquad: inn.bowlingSquad, overs: 1, target: inn.target ?? null }),
        batters({ striker: inn.squad[0].id, nonStriker: inn.squad[1].id }), bowler({ bowler: inn.bowlingSquad[0].id }), ...inn.balls]
        .map((e) => ({ ...e, innings: i }));
      evs.push({ ...sealInnings(deriveInnings(evs)), innings: i });
      const r = await call(`/api/matches/${M3}/events`, { method: "POST", token: scorerTok, body: { events: evs.map((ev) => ({
        epoch: claim3.body?.epoch, deviceId: "potm-pad", idempotencyKey: `bpotm10-${M3}-${++k3}`, clientSeq: ++cs3, clientTs: T3 + k3 * 20_000, innings: i, payload: ev })) } });
      refused3 = refused3.concat(r.body?.refused ?? []);
    }
    await call(`/api/matches/${M3}/session/release`, { method: "POST", token: scorerTok, body: { device: "potm-pad" } }).catch(() => null);
    await q(`update match set status = 'complete' where id = $1`, [M3]);
    const hs3 = (await call(`/api/matches/${M3}/player-of-match`, { token: coachTok })).body?.sides?.[0]?.headSeq;
    const a3 = await call(`/api/matches/${M3}/player-of-match`, { method: "POST", token: coachTok, body: { playerId: WHITFIELD, headSeq: hs3 } });
    const asked = await call(`/api/matches/${M3}/amendments`, { method: "POST", token: scorerTok, body: { targetKey: `bpotm10-${M3}-4`, reason: "The first six was a dot ball." } });
    const ap = await call(`/api/amendments/${asked.body?.id}/decide`, { method: "POST", token: headTok, body: { approve: true } });
    ok("a third fixture scored, the coach's award, then an amendment voids the awardee's first six",
       claim3.body?.ok === true && refused3.length === 0 && a3.status === 200 && ap.body?.ok === true, JSON.stringify([refused3, a3.body, ap.body]).slice(0, 400));

    const cr = await open();
    await cr.page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
    await click(cr.page, /Get Started|Log In/, 5000);
    await cr.page.waitForTimeout(400);
    await click(cr.page, /coach@example\.invalid|Head Coach/, 4000);
    await click(cr.page, /^Sign In$/, 5000);
    await afterReads(cr.page, 2000);
    for (const sel of ['[data-testid="mnav-readiness"]', '[data-testid="nav-readiness"]']) {
      const l = cr.page.locator(sel).first();
      if (await l.count()) { await l.click({ timeout: 6000 }).catch(() => {}); break; }
    }
    if ((await tid(cr.page, "queue").count()) === 0) {
      await cr.page.locator("button", { hasText: /^More$|Operate/ }).first().click({ timeout: 3000 }).catch(() => {});
      await cr.page.locator('[data-testid="mnav-readiness"], [data-testid="nav-readiness"], button:has-text("To resolve")').first().click({ timeout: 4000 }).catch(() => {});
    }
    await afterReads(cr.page, 2000);
    ok("his To-resolve list carries the review", await until(cr.page,
       () => /Player of the Match to review · J Whitfield · the scorecard was corrected/.test(document.querySelector('[data-testid="queue-potm"]')?.innerText ?? ""), 12000),
       await tid(cr.page, "queue-potm").innerText().catch(() => "∅"));
    const door = tid(cr.page, "queue-potm").locator("button", { hasText: /Review it/ }).first();
    ok("...with its door, 44px", (await door.count()) === 1 && ((await door.boundingBox())?.height ?? 0) >= 44);
    ok("no console errors (the To-resolve list, R10)", cr.errors.length === 0, cr.errors.join(" | "));
    await cr.ctx.close();

    const cs = await open();
    ok("the coach arrives on the fixture", await arrive(cs.page, M3, /coach@example\.invalid|Head Coach/));
    ok("the sheet says the figures moved, in §7's words", await until(cs.page,
       () => (document.querySelector('[data-testid="mc-potm-review-words"]')?.textContent ?? "").trim()
             === "The figures this award cited have changed: 17* (6) → 11* (5). Withdraw, or let it stand.", 12000),
       await tid(cs.page, "mc-potm-review-words").innerText().catch(() => "∅"));
    ok("...beside the award, which stands", /Player of the Match: James Whitfield/.test(await tid(cs.page, "mc-potm-standing").innerText().catch(() => "")));
    const standH = (await tid(cs.page, "mc-potm-stand").boundingBox())?.height ?? 0;
    const tiny = await cs.page.$eval('[data-testid="mc-potm-review"]', (root) =>
      [...root.querySelectorAll("*")].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        && parseFloat(getComputedStyle(e).fontSize) < 12).length);
    ok("...Let it stand is 44px, and nothing in it is under 12px", standH >= 44 && tiny === 0, `${standH} / ${tiny}`);
    await tid(cs.page, "mc-potm-withdraw").click();
    ok("...withdrawing it starts at 'after a scorecard correction'", await tid(cs.page, "mc-potm-kind-correction").locator("input").isChecked());
    await tid(cs.page, "mc-potm-cancel").click();
    await tid(cs.page, "mc-potm-stand").click();
    ok("he lets it stand, in words", await until(cs.page,
       () => /It stands\. The review is closed with your name/.test(document.querySelector('[data-testid="mc-potm-said"]')?.textContent ?? ""), 10000),
       await tid(cs.page, "mc-potm-said").innerText().catch(() => "∅"));
    ok("...the review is gone and the award still stands", await until(cs.page, () => !document.querySelector('[data-testid="mc-potm-review"]')
       && /Player of the Match: James Whitfield/.test(document.querySelector('[data-testid="mc-potm-standing"]')?.textContent ?? ""), 10000));
    const rv = await q(`select r.outcome, h.withdrawn_at from recognition_review r join honour h on h.id = r.honour_id where r.match_id = $1`, [M3]);
    ok("...the database agrees: stands, not withdrawn", rv.length === 1 && rv[0].outcome === "stands" && rv[0].withdrawn_at === null, JSON.stringify(rv));
    ok("no console errors (the coach, R10)", cs.errors.length === 0, cs.errors.join(" | "));
    await cs.ctx.close();
  }

  group("Nobody else is shown it");
  // A parent's app and another side's coach may not open this fixture at
  // all; whether it opens or not, no sheet is drawn, and the API gives them
  // no side to decide.
  for (const [who, re, email] of [["a parent", /parent@example\.invalid|Parent/, "parent@example.invalid"],
                                  ["the 2XI coach", /coach2@example\.invalid|2XI/, "coach2@example.invalid"]]) {
    const s = await open();
    const opened = await arrive(s.page, M, re);
    await afterReads(s.page, 1500);
    ok(`${who} (the fixture ${opened ? "opens" : "does not open"}) sees no Player of the Match sheet`, await tid(s.page, "mc-potm").count() === 0);
    const tok = (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "potm-other" } })).body?.token;
    ok(`...and the API gives ${who} no side to decide`, ((await call(`/api/matches/${M}/player-of-match`, { token: tok })).body?.sides ?? ["x"]).length === 0);
    ok(`no console errors (${who})`, s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  ok("the API logged no errors", apiErr.join("").trim() === "", apiErr.join("").slice(0, 3000));
} catch (e) {
  fail++;
  console.log("  ✗ threw:", e.message);
} finally {
  await browser.close().catch(() => {});
  apiProc.kill();
  web.close();
  await pool.end();
}
console.log(`\n${"─".repeat(52)}\nBROWSER PLAYER OF THE MATCH: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

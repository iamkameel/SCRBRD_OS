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

  ok("the API logged no errors", apiErr.join("").trim() === "", apiErr.join("").slice(0, 400));
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

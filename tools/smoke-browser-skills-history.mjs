#!/usr/bin/env node
/**
 * GA-I26a A3 — the assessment history screens, from a browser, as the people
 * who may and may not read them.
 *
 * The API walk (smoke-assessment-history.mjs) proves the reads and who they
 * answer. This proves what the screens DRAW from them, and that they draw no
 * more than they were sent:
 *
 *   The coach (C Hendricks, 1XI) on Skills, R Pillay:
 *     - the strip under "against pace" has two dots (8 and 11), each a 44px
 *       target, every word on it 12px or more, a hairline between them
 *     - a dot opens its sheet: the score, the date, "by C Hendricks, coach"
 *     - "Set target" writes the target and its Why (a coaching point staff
 *       read), the tick and "target 14 · … · drill: …" draw, the focus areas
 *       receive it, and a refused wording leaves nothing behind
 *     - "Since the last look" counts the sessions the side held, what the
 *       register says he attended, the drills the plan ran, and his target's
 *       drill ran N times and he was there for M (all of it entered through
 *       the Training screen first)
 *     - a wrong score withdrawn from its sheet stays on the strip, hollow,
 *       and the bar goes back to the score that stands
 *     - nothing on the Skills screen is a direction, a rank, a miss or a
 *       health word (the design's list, and the cockpit's never-words)
 *     - the hairline has an animation, and none under prefers-reduced-motion
 *   The coach on Training: a plan edited and saved, the register marked, four
 *     states and no fifth, the plan naming nobody
 *   The boy himself and his parent: walked when their shells have a door to
 *     Skills and Training (they have none yet, and the walk says so); the
 *     unit test holds what they would be drawn
 *   The director of sport: the strip, the target and the coach's name; a
 *     target for a boy of a side he does not coach is refused by the server and
 *     said in words (the screen draws from the roles held; the database
 *     decides); on Training the plan editor and the register, four states and no
 *     fifth
 *
 * Every wait is on a response or on the DOM, never on a fixed time.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-skills-history.mjs
 *   BROWSER_SKILLS_DEBUG=1 node tools/smoke-browser-skills-history.mjs
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

const WEB_PORT = port(4398);
const API_PORT = port(8998);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_SKILLS_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const HIL = "11111111-1111-1111-1111-111111111111";
const P_SELF = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, 1XI, an account of his own
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);
/** A panel's text on one line, so a failure prints all of it where a log keeps one line. */
const flat = (s) => String(s ?? "").replace(/\n+/g, " / ");

/** The design's never-words (GA-I26a §7.3), whole words, and the cockpit's own list. */
const NEVER = /\b(improv\w*|declin\w*|stall\w*|plateau\w*|regress\w*|form|fatigue\w*|injur\w*|absent|absence|missed|rank\w*|percentile)\b/i;
const COCKPIT = /\brisk\b|danger|unsafe|wellness|check-?in|soreness|\bflag\b|guideline|hamstring|shoulder|fracture|sprain|strain|concussion|tendon|impingement|grade [123]|ewma|\bacwr\b|\bratio\b|diagnos|win chance|chance of winning|probab|threat|pressure|\d\s?%/i;

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-skills-history-secret",
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

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
const browser = await chromium.launch({ ...launchOptions() });

/** The API, as a person, for the setup the screens then read. */
async function call(path, { method = "GET", token, body } = {}) {
  const res = await fetch(API + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const login = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-skills" } })).body?.token;

async function open(opts = {}) {
  const ctx = await browser.newContext(opts);
  await offline(ctx);
  const page = await ctx.newPage();
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
const text = (page) => page.$eval("body", (el) => el.innerText);
/** Everything a reader or a screen reader gets: visible text and every aria-label. */
// The screen's own main area: the menu's words ("Injuries") are the menu's, not the screen's.
const said = (page) => page.evaluate(() => {
  const main = document.querySelector('[data-testid="os-main"]') ?? document.body;
  return [main.innerText, ...[...main.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label"))].join(" | ");
});
async function signIn(page, email) {
  await page.locator("button:not([disabled])", { hasText: /Get Started|Log In/ }).first().click({ timeout: 8000 }).catch(() => {});
  await page.locator("#login-email").fill(email);
  await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 8000 });
  try { await tid(page, "os-main").waitFor({ timeout: 12000 }); return true; } catch { return false; }
}
async function nav(page, id) {
  const l = tid(page, `nav-${id}`).first();
  try { await l.waitFor({ timeout: 8000 }); await l.click({ timeout: 6000 }); return true; } catch { return false; }
}
/** Click and wait for the response a write makes, so nothing is judged before it answers. */
async function clickAndWait(page, locator, urlRe, method = "POST") {
  const [res] = await Promise.all([
    page.waitForResponse((r) => urlRe.test(r.url()) && r.request().method() === method, { timeout: 12000 }),
    locator.click({ timeout: 8000 }),
  ]);
  return res;
}
/** Pick R Pillay in the Skills list and wait for his strip to be on the screen. */
async function pickPillay(page) {
  await page.locator("button", { hasText: /Pillay/ }).first().click({ timeout: 8000 });
  await tid(page, "history-strip").first().waitFor({ timeout: 12000 });
}
/** Every text-bearing element under a root, and the smallest type it is set in. */
const smallestType = (page, sel) => page.evaluate((s) => {
  let min = Infinity;
  for (const root of document.querySelectorAll(s)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      min = Math.min(min, parseFloat(getComputedStyle(n.parentElement).fontSize));
    }
  }
  return min;
}, sel);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── Setup, through the API, as the people who would do it ──────────────
  const coachEmail = "coach@example.invalid";
  const coach = await login(coachEmail);
  const [coachRow] = await q(`select name from app_user where email = $1`, [coachEmail]);
  const COACH = coachRow.name;                                   // "C Hendricks"
  const asses = (on, scores) => call(`/api/players/${P_SELF}/assessment`, { method: "POST", token: coach, body: { assessedOn: on, scores } });
  ok("setup: the coach rates against pace 8 long ago and 11 recently, and footwork 10",
     (await asses(day(-200), { technical: { againstPace: 8 } })).status === 200
     && (await asses(day(-41), { technical: { againstPace: 11, footwork: 10 } })).status === 200);
  ok("setup: ...and, in error, footwork 2 two days later", (await asses(day(-39), { technical: { footwork: 2 } })).status === 200);

  // Three sessions of his side since the last look; the register and the plan go in through the screen.
  const sess = [];
  for (const [n, title] of [[-20, "Nets one"], [-10, "Nets two"], [-3, "Nets three"]]) {
    const r = await call("/api/training", { method: "POST", token: coach, body: {
      schoolId: HIL, teamCode: "1XI", title, sessionType: "batting", startsAt: new Date(Date.now() + n * 86400000).toISOString(), durationMin: 60, venue: "Nets 1-3" } });
    sess.push(r.body?.id);
  }
  ok("setup: three sessions for his side", sess.every(Boolean));
  const [drill] = await q(`select id, name from drill where school_id is null and category = 'batting' and not retired order by name limit 1`);

  group("The coach plans a session and takes its register");
  const c = await open();
  ok("the coach signs in", await signIn(c.page, coachEmail));
  ok("Training opens", await nav(c.page, "training"));
  await tid(c.page, `plan-open-${sess[1]}`).waitFor({ timeout: 12000 }).catch(() => {});
  ok("a session offers Plan and Register, to a coach", await tid(c.page, `plan-open-${sess[1]}`).count() === 1 && await tid(c.page, `register-open-${sess[1]}`).count() === 1);
  const tp = await tid(c.page, `plan-open-${sess[1]}`).boundingBox();
  const tr = await tid(c.page, `register-open-${sess[1]}`).boundingBox();
  ok("...each a 44px target", tp?.height >= 44 && tp?.width >= 44 && tr?.height >= 44 && tr?.width >= 44, JSON.stringify([tp, tr]));
  await tid(c.page, `plan-open-${sess[1]}`).click();
  await tid(c.page, "plan-editor").waitFor({ timeout: 8000 });
  ok("the plan editor says it names nobody", /names nobody/.test(await tid(c.page, "plan-editor").innerText()));
  ok("...and offers the batting drills first", await tid(c.page, `plan-add-${drill.id}`).count() === 1);
  await tid(c.page, `plan-add-${drill.id}`).click();
  await tid(c.page, "plan-line-0").waitFor({ timeout: 4000 });
  const planRes = await clickAndWait(c.page, tid(c.page, "plan-save"), /\/api\/training\/[^/]+\/plan$/);
  ok("the plan saves", planRes.status() === 200);
  await tid(c.page, "plan-editor").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  await c.page.locator('[data-testid="session-plan"]', { hasText: drill.name }).first().waitFor({ timeout: 12000 }).catch(() => {});
  ok("...and the session's card lists the drill", (await text(c.page)).includes(`${drill.name} ·`));
  ok("the plan row is the drill and the session, and names no boy",
     (await q(`select count(*)::int n from training_session_drill where session_id = $1 and drill_id = $2`, [sess[1], drill.id]))[0].n === 1);

  await tid(c.page, `register-open-${sess[1]}`).click();
  await tid(c.page, "register-sheet").waitFor({ timeout: 8000 });
  ok("the register has the four states for R Pillay", await tid(c.page, `register-${P_SELF}-present`).count() === 1 && await c.page.locator(`[data-testid^="register-${P_SELF}-"]`).count() === 4);
  const regTxt = await tid(c.page, "register-sheet").innerText();
  ok("...and no injured, and no free text", !/injur/i.test(regTxt) && await tid(c.page, "register-sheet").locator("textarea, input").count() === 0);
  const sb = await tid(c.page, `register-${P_SELF}-late`).boundingBox();
  ok("...each state a 44px target", sb?.height >= 44 && sb?.width >= 44, JSON.stringify(sb));
  ok("Save is off until somebody is marked", await tid(c.page, "register-save").isDisabled());
  await tid(c.page, `register-${P_SELF}-present`).click();
  ok("a pressed state is checked", (await tid(c.page, `register-${P_SELF}-present`).getAttribute("aria-checked")) === "true");
  const regRes = await clickAndWait(c.page, tid(c.page, "register-save"), /\/api\/training\/[^/]+\/attendance$/);
  ok("the register saves", regRes.status() === 200);
  await tid(c.page, "register-sheet").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  ok("...as present, the one word asked",
     (await q(`select status from training_attendance where session_id = $1 and player_id = $2`, [sess[1], P_SELF]))[0]?.status === "present");
  ok("no console errors on Training", c.errors.length === 0, c.errors.join(" | "));

  group("The coach on Skills: the strip, the sheet, the target");
  ok("Skills opens", await nav(c.page, "skills"));
  await pickPillay(c.page);
  const strip = tid(c.page, "history-technical-againstPace").locator('[data-testid="history-strip"]');
  const dots = strip.locator('button[data-testid^="history-dot-"]');
  ok("the against-pace strip has two dots", await dots.count() === 2);
  const boxes = await dots.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
  ok("...each a 44px hit area", boxes.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(boxes));
  ok("...and a hairline joins them", await strip.locator('[data-testid="hairline"]').count() === 1);
  ok("the strip says its figures, with dates, in its label",
     /8 on .*then 11 on /.test((await strip.getAttribute("aria-label")) ?? ""), await strip.getAttribute("aria-label"));
  ok("no word on the strip is under 12px", (await smallestType(c.page, '[data-testid="history-strip"]')) >= 12, await smallestType(c.page, '[data-testid="history-strip"]'));
  ok("the footwork strip holds the standing 10 and the 2 in error", await tid(c.page, "history-technical-footwork").locator('button[data-testid^="history-dot-"]').count() === 2);

  await dots.first().click();
  await tid(c.page, "dot-sheet").waitFor({ timeout: 8000 });
  ok("a dot's sheet says the score, the date and the coach by name",
     new RegExp(`Rated 8 on .* by ${COACH}, coach`).test(await tid(c.page, "dot-sheet").innerText()), await tid(c.page, "dot-sheet").innerText());
  await c.page.keyboard.press("Escape");
  await tid(c.page, "dot-sheet").waitFor({ state: "detached", timeout: 4000 }).catch(() => {});

  // Set target, with a Why the cockpit would refuse first.
  await tid(c.page, "set-target-againstPace").click();
  await tid(c.page, "target-form").waitFor({ timeout: 8000 });
  ok("the form labels its Why for what it is", /Why — staff only; the boy sees the target, not this/.test(await tid(c.page, "target-form").innerText()));
  await tid(c.page, "target-score").fill("11");
  ok("a target at where he stands is 'already there', and cannot be saved",
     /already there/.test(await tid(c.page, "target-problem").innerText()) && await tid(c.page, "target-save").isDisabled());
  await tid(c.page, "target-score").fill("14");
  ok("...above it is allowed", (await tid(c.page, "target-problem").innerText()).trim() === "" && !(await tid(c.page, "target-save").isDisabled()));
  const optionTexts = await tid(c.page, "target-drill").locator("optgroup").evaluateAll((gs) => gs.map((g) => g.label));
  ok("the drill picker puts what suits against pace first", /^Suits against pace$/.test(optionTexts[0] ?? ""), optionTexts.join());
  await tid(c.page, "target-drill").selectOption(drill.id);
  await tid(c.page, "target-why").fill("risk of getting hit on the helmet");
  const refused = await tid(c.page, "target-save").click().then(() => tid(c.page, "target-said").waitFor({ timeout: 8000 }).then(() => tid(c.page, "target-said").innerText()), () => "");
  ok("a Why the cockpit would refuse is refused before it is sent, in words", /not allowed here/.test(refused), refused);
  ok("...and nothing was left behind", (await q(`select count(*)::int n from development_note where player_id = $1 and evidence_read is not null`, [P_SELF]))[0].n === 0
     && (await q(`select count(*)::int n from development_target where player_id = $1`, [P_SELF]))[0].n === 0);
  await tid(c.page, "target-why").fill("Gets squared up early; work on getting forward to the short ball.");
  // The save bumps the screen's nonce and every read of the boy goes again in
  // parallel; the panel keeps its old rows until "since the last look" answers,
  // and that read is the heaviest. So the panel is judged on THAT answer, armed
  // before the save so it cannot be missed, not on the target line's read.
  const sinceAfterSave = c.page.waitForResponse((r) => /\/api\/read\/development_since\b/.test(r.url()) && r.request().method() === "GET", { timeout: 15000 }).catch(() => null);
  const tRes = await clickAndWait(c.page, tid(c.page, "target-save"), /\/api\/players\/[^/]+\/targets$/);
  ok("the target saves", tRes.status() === 200);
  await tid(c.page, "target-form").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  await tid(c.page, "target-line").first().waitFor({ timeout: 12000 });
  const tl = await tid(c.page, "target-line").first().innerText();
  ok("the line under the strip is the target, set date and drill", new RegExp(`^target 14 · set \\d+ \\w+ · drill: ${drill.name}`).test(tl), tl);
  ok("...with its tick on the axis", await strip.locator('[data-testid="target-tick"]').count() === 1);
  ok("the focus areas received the saved target", /target 14/.test(await tid(c.page, "focus-againstPace").innerText().catch(() => "")), await tid(c.page, "focus-againstPace").innerText().catch(() => "none"));
  const [tgt] = await q(`select target_score, drill_id, note_id from development_target where player_id = $1 and withdrawn_at is null`, [P_SELF]);
  ok("the target row points at the drill and at the reason", tgt?.target_score === 14 && tgt?.drill_id === drill.id && !!tgt?.note_id);
  const [pt] = await q(`select evidence_read, evidence_params->>'skillId' as sk, body from development_note where id = $1`, [tgt?.note_id]);
  ok("...and the reason is a coaching point standing on a score of his", pt?.evidence_read === "skills" && !!pt?.sk);

  // A dot's sheet shows the point to staff.
  await dots.last().click();
  await tid(c.page, "dot-sheet").waitFor({ timeout: 8000 });
  ok("the newest score's sheet shows the coaching point that stood on it, to staff",
     /Gets squared up early/.test(await tid(c.page, "dot-sheet").innerText()), await tid(c.page, "dot-sheet").innerText());
  await c.page.keyboard.press("Escape");

  group("Since the last look");
  await tid(c.page, "since-batting").waitFor({ timeout: 12000 });
  const staleTxt = await tid(c.page, "since-batting").innerText();
  const sinceRes = await sinceAfterSave;
  ok("the panel is read again after the target saves", sinceRes?.status() === 200, sinceRes ? String(sinceRes.status()) : "no read");
  // ...and drawn from that answer: the line the target gives the panel.
  await c.page.locator('[data-testid="since-batting"]', { hasText: /Target: against pace 14/ }).waitFor({ timeout: 12000 }).catch(() => {});
  const sinceTxt = await tid(c.page, "since-batting").innerText();
  const targetLine = sinceTxt.split("\n").find((l) => l.startsWith("Target:")) ?? "(no Target line)";
  if (DEBUG) console.log(`[debug] since-batting when the target line drew (it had ${/Target:/.test(staleTxt) ? "it already" : "no target line"} before the re-read answered):\n${sinceTxt}`);
  ok("batting names its last look and the coach", new RegExp(`Batting · last looked \\d+ \\w+ \\(${COACH}, coach\\)`).test(sinceTxt), sinceTxt.split("\n")[0]);
  ok("the sessions the side held", /Since then 1XI held 3 sessions\./.test(sinceTxt), flat(sinceTxt));
  ok("what he was marked at; a register at one of three is said so", /R Pillay was marked present at 1 \(a register was taken at 1 of 3\)\./.test(sinceTxt), flat(sinceTxt));
  ok("the drills the plan ran", new RegExp(`Drills on those sessions: ${drill.name} ×1\\.`).test(sinceTxt), flat(sinceTxt));
  ok("the target, its drill, how often it ran and how often he was there",
     new RegExp(`Target: against pace 14, set \\d+ \\w+ — the drill for it, ${drill.name}, ran 1 time; he was there for 1\\.`).test(sinceTxt),
     `${targetLine} | the panel: ${flat(sinceTxt)}`);
  ok("the footer names its source and window", /From the training sessions, the register and the plan; 1XI, \d+ \w+ to today\./.test(sinceTxt), flat(sinceTxt));
  ok("a discipline he was never rated in is not given a number", /Not yet rated for keeping\./.test(await tid(c.page, "since-keeping").innerText()) || await tid(c.page, "since-keeping").count() === 0);
  ok("no word of the panel is under 12px", (await smallestType(c.page, '[data-testid="since-panel"]')) >= 12, await smallestType(c.page, '[data-testid="since-panel"]'));

  group("A wrong score is withdrawn from its sheet");
  await tid(c.page, "history-technical-footwork").locator('button[data-testid^="history-dot-"]').last().click();
  await tid(c.page, "dot-sheet").waitFor({ timeout: 8000 });
  ok("the sheet is of the 2", /Rated 2 on /.test(await tid(c.page, "dot-sheet").innerText()));
  ok("Withdraw is off until a reason is given", await tid(c.page, "withdraw-score").isDisabled());
  await tid(c.page, "withdraw-reason").fill("rated the wrong attribute");
  const wRes = await clickAndWait(c.page, tid(c.page, "withdraw-score"), /\/api\/skills\/[^/]+\/withdraw$/);
  ok("the score is withdrawn", wRes.status() === 200);
  await tid(c.page, "dot-sheet").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  await c.page.locator('[data-testid="history-technical-footwork"] button[data-withdrawn="1"]').first().waitFor({ timeout: 12000 }).catch(() => {});
  const fw = tid(c.page, "history-technical-footwork");
  ok("the dot stays on the strip, hollow", await fw.locator('button[data-withdrawn="1"]').count() === 1 && await fw.locator('button[data-testid^="history-dot-"]').count() === 2);
  ok("...and the label says it was withdrawn", /withdrawn/.test((await fw.locator('button[data-withdrawn="1"]').getAttribute("aria-label")) ?? ""));
  // The hollow dot draws at once, from the screen's own state; the bar comes
  // from the server's re-read, which can land later (CI, 30 Oct: the one
  // assertion that failed in an otherwise green walk). So poll the bar's text
  // until it shows the standing 10, bounded, then judge it once.
  const barBox = fw.locator("xpath=..");
  const barStands = (t) => /\b10\b/.test(t) && !/\b2\b\s*Poor/.test(t);
  let barTxt = await barBox.innerText();
  for (const deadline = Date.now() + 15000; !barStands(barTxt) && Date.now() < deadline;) {
    await new Promise((r) => setTimeout(r, 150));
    barTxt = await barBox.innerText().catch(() => barTxt);
  }
  ok("...and the bar is back at the 10 that stands", barStands(barTxt), flat(barTxt));

  group("Nothing here is a verdict, a miss or a health word");
  const all = await said(c.page);
  const bad = all.match(NEVER)?.[0], badCockpit = all.match(COCKPIT)?.[0];
  ok("none of the design's never-words on the rendered Skills screen", !bad, bad);
  if (badCockpit) {
    // Report where the cockpit's list is tripped before judging it: existing copy (the rating card, say) is not this slice's.
    const around = all.slice(Math.max(0, all.search(COCKPIT) - 40), all.search(COCKPIT) + 40).replace(/\s+/g, " ");
    console.log(`  (cockpit list matched "${badCockpit}" near: ${around})`);
  }
  ok("none of the cockpit's never-words on the rendered Skills screen", !badCockpit, badCockpit);
  const histTxt = await c.page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-"], [data-testid="since-panel"], [data-testid="target-line"]')].map((e) => e.innerText + " " + [...e.querySelectorAll("[aria-label]")].map((x) => x.getAttribute("aria-label")).join(" ")).join(" | "));
  ok("none of either on the strips, the targets and the panel themselves", !NEVER.test(histTxt) && !COCKPIT.test(histTxt), histTxt.match(NEVER)?.[0] ?? histTxt.match(COCKPIT)?.[0]);
  ok("the screen shows no load, wellness or discipline", !/\bload\b|wellness|disciplin|workload/i.test(all));
  ok("no console errors on Skills", c.errors.length === 0, c.errors.join(" | "));
  await c.ctx.close().catch(() => {});

  group("Motion: the hairline draws, and under reduced motion it does not move");
  const m1 = await open();
  await signIn(m1.page, coachEmail); await nav(m1.page, "skills"); await pickPillay(m1.page);
  const animOn = await tid(m1.page, "hairline").first().evaluate((e) => getComputedStyle(e).animationName);
  ok("by default the hairline has its 200ms draw", animOn === "hairDraw", animOn);
  await m1.ctx.close().catch(() => {});
  const m2 = await open({ reducedMotion: "reduce" });
  await signIn(m2.page, coachEmail); await nav(m2.page, "skills"); await pickPillay(m2.page);
  const animOff = await tid(m2.page, "hairline").first().evaluate((e) => getComputedStyle(e).animationName);
  ok("under prefers-reduced-motion the hairline has no animation", animOff === "none", animOff);
  await m2.ctx.close().catch(() => {});

  group("The boy himself, and his parent");
  // The pupil's and the family's apps are their own shells (step 4) and, as
  // built, have no door to Skills or Training. The screens are written for the
  // reader who holds the capability, so when a door opens they are walked
  // here; until then this says so and does not fail on a menu that is not ours.
  const b = await open();
  ok("R Pillay signs in", await signIn(b.page, "pillay@example.invalid"));
  if (await tid(b.page, "nav-skills").count()) {
    ok("he has the Skills screen", await nav(b.page, "skills"));
    await tid(b.page, "history-strip").first().waitFor({ timeout: 12000 }).catch(() => {});
    ok("his strip draws, with the two scores", await tid(b.page, "history-technical-againstPace").locator('button[data-testid^="history-dot-"]').count() === 2);
    ok("...and his target", /target 14/.test(await tid(b.page, "target-line").first().innerText().catch(() => "")));
    await b.page.setViewportSize({ width: 390, height: 844 });
    const bdots = await tid(b.page, "history-technical-againstPace").locator('button[data-testid^="history-dot-"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
    ok("...each dot a 44px target on a phone", bdots.length === 2 && bdots.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(bdots));
    await tid(b.page, "since-batting").waitFor({ timeout: 12000 }).catch(() => {});
    const bsince = await tid(b.page, "since-batting").innerText().catch(() => "");
    ok("the panel speaks to him: 'your coach', 'you were'", /\(your coach\)/.test(bsince) && /You were marked present at 1/.test(bsince) && /you were there for 1/.test(bsince), bsince);
    ok("...and names no coach", !new RegExp(COACH).test(bsince));
    await b.page.locator('[data-testid^="history-dot-"]').last().click();
    await tid(b.page, "dot-sheet").waitFor({ timeout: 8000 });
    const bsheet = await tid(b.page, "dot-sheet").innerText();
    ok("a dot's sheet says 'your coach' and shows no coaching point", /by your coach/.test(bsheet) && !/Gets squared up early/.test(bsheet) && !/COACHING POINTS/.test(bsheet), bsheet);
    ok("...and offers no withdrawal", await tid(b.page, "withdraw-score").count() === 0);
    await b.page.keyboard.press("Escape");
    const btext = await text(b.page);
    ok("he is not offered Set target, a Why, or the notes", await b.page.locator('[data-testid^="set-target-"]').count() === 0 && await tid(b.page, "target-why").count() === 0 && !/DEVELOPMENT NOTES/.test(btext) && !/Gets squared up early/.test(btext));
    ok("the coach's name is nowhere on his screen", !new RegExp(COACH).test(await said(b.page)));
    ok("his list holds himself alone", await b.page.locator("button", { hasText: /Pillay/ }).count() === 1 && !/Whitfield|Naidoo|Erasmus/.test(btext));
    const bad2 = (await said(b.page)).match(NEVER)?.[0];
    ok("none of the never-words on his screen either", !bad2, bad2);
  } else {
    console.log("  (the pupil's shell has no Skills door yet: his view is held by the unit test, not walked here)");
  }
  ok("no console errors on his session", b.errors.length === 0, b.errors.join(" | "));
  await b.ctx.close().catch(() => {});

  const p = await open();
  ok("the parent signs in", await signIn(p.page, "parent@example.invalid"));
  ok("she has no Skills screen", await tid(p.page, "nav-skills").count() === 0);
  if (await tid(p.page, "nav-training").count()) {
    ok("she has Training", await nav(p.page, "training"));
    await p.page.locator('[data-testid="session-plan"]', { hasText: drill.name }).first().waitFor({ timeout: 12000 }).catch(() => {});
    const ptxt = await text(p.page);
    ok("...with the side's sessions and the plan", /Nets two/.test(ptxt) && ptxt.includes(`${drill.name} ·`), ptxt.slice(0, 200));
    ok("...and no Plan, Register or Set target", await p.page.locator('[data-testid^="plan-open-"], [data-testid^="register-open-"], [data-testid^="set-target-"]').count() === 0 && !/Set target/.test(ptxt));
    ok("...and no target, no score and no coaching point anywhere", !/target 14|Gets squared up|against pace/i.test(ptxt));
  } else {
    console.log("  (the family shell has no Training door yet: her view is held by the unit test, not walked here)");
  }
  ok("no console errors on her session", p.errors.length === 0, p.errors.join(" | "));
  await p.ctx.close().catch(() => {});

  group("The director of sport reads the history; the server decides what he may write");
  const d = await open();
  ok("the director signs in", await signIn(d.page, "sarah@example.invalid"));
  ok("he opens Skills", await nav(d.page, "skills"));
  await pickPillay(d.page);
  ok("he sees the strip and the target", await tid(d.page, "history-technical-againstPace").locator('button[data-testid^="history-dot-"]').count() === 2
     && /target 14/.test(await tid(d.page, "target-line").first().innerText().catch(() => "")));
  ok("...with the coach's name, as staff are told", new RegExp(`${COACH}, coach`).test(await said(d.page)));
  // He is also a coach (of U16B), so the screen, which only decides what to
  // draw from the roles held, offers Set target; the database decides, and
  // R Pillay is not on a side he coaches. The screen says so, in words.
  await tid(d.page, "set-target-againstPace").click();
  await tid(d.page, "target-form").waitFor({ timeout: 8000 });
  await tid(d.page, "target-score").fill("15");
  const dRes = await clickAndWait(d.page, tid(d.page, "target-save"), /\/api\/players\/[^/]+\/targets$/);
  ok("a target for a boy of another side is refused by the server", dRes.status() === 403, String(dRes.status()));
  ok("...the screen says so in words, and the form stays", /may not do that/.test(await tid(d.page, "target-said").innerText()) && await tid(d.page, "target-form").count() === 1);
  ok("...and nothing was written", (await q(`select count(*)::int n from development_target where player_id = $1 and set_by = (select id from app_user where email = 'sarah@example.invalid')`, [P_SELF]))[0].n === 0);
  await d.page.keyboard.press("Escape");
  // He may plan and take the register (team.training.run), and has the four
  // words like everyone: no fifth. (The team manager and the school's
  // administrator hold the capability but, as built, have no Training door.)
  ok("he opens Training", await nav(d.page, "training"));
  await tid(d.page, `register-open-${sess[0]}`).waitFor({ timeout: 12000 }).catch(() => {});
  ok("...with Plan and Register on a session", await tid(d.page, `plan-open-${sess[0]}`).count() === 1 && await tid(d.page, `register-open-${sess[0]}`).count() === 1);
  await tid(d.page, `register-open-${sess[0]}`).click();
  await tid(d.page, "register-sheet").waitFor({ timeout: 8000 });
  const states = await d.page.locator('[data-testid^="register-row-"]').first().locator('[role="radio"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  ok("the register has four states and no fifth", states.join() === "present,late,excused,absent", states.join());
  ok("...and no injured anywhere on it", !/injur/i.test(await tid(d.page, "register-sheet").innerText()));
  await d.page.keyboard.press("Escape");
  ok("no console errors on his session", d.errors.length === 0, d.errors.join(" | "));
  await d.ctx.close().catch(() => {});
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 8).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER SKILLS HISTORY SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

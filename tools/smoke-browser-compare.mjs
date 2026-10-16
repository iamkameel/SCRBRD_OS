#!/usr/bin/env node
/**
 * Compare, from a browser (GA-I24-I25 S1 and the pupil's card, D10;
 * docs/design/GA-I24-I25_compare_and_combine.md, Q1–Q10 as Kameel decided
 * them on 8 October 2026).
 *
 *   - THE PICKER OFFERS ONLY READABLE PLAYERS. The 1XI coach's picker holds
 *     his side and nobody else, though the career read returns other sides'
 *     boys in outline; the analyst's holds the school; a boy who has left (no
 *     side) is in neither, though the read still returns him (Q6).
 *   - THE FLOOR AND THE COUNTS (D4, Q8). Every ball count is drawn with its
 *     evidence word; a rate under thirty legal balls is an em dash and
 *     "insufficient" (or "none"); "not enough balls to compare" is said in
 *     words; each figure drawn is the server's, held against the career read.
 *   - NO FORBIDDEN FIELD ANYWHERE IN THE DOM (D3, D5, D7, D8, §4): no skill,
 *     rating, note, fitness, injury, workload, availability, age, birthday or
 *     discipline, in words or as the compared boys' own values; no verdict;
 *     no absence; no bowler's name; and no read of any of those resources.
 *   - NOTHING KEPT (D9, Q10): no store holds either boy after a comparison,
 *     and no export, share or download is offered.
 *   - EVERY PANEL SAYS ITS SOURCE, SCOPE, WINDOW AND BASIS (I22), and the
 *     screen says when it read (D14).
 *   - A PUPIL COMPARES HIMSELF WITH ONE TEAM-MATE ONLY (D10, Q1): he is the
 *     left column, there is one picker, and it holds his side, never himself.
 *   - A PARENT HAS NO COMPARE (D11, Q2): no Analytics, no card, anywhere in
 *     her app.
 *   - 12px and 44px over the compare screen at 390 wide, both people.
 *
 * Screenshots go to $COMPARE_SHOTS when it is set.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-compare.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { appUrl, ownerUrl, port } from "./db-url.mjs";

const WEB_PORT = port(4378);
const API_PORT = port(8978);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const SHOTS = process.env.COMPARE_SHOTS || null;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 260)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "11111111-1111-1111-1111-111111111111";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-compare-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const owner = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await owner.query(text, params)).rows;
const call = async (path, token) => {
  const res = await fetch(API + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const tokenOf = async (email) => (await (await fetch(`${API}/api/auth/dev-login`, { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ email, deviceId: "device-browser-compare" }) })).json()).token;
const browser = await chromium.launch({ ...launchOptions() });

/** A fresh context per person. `asked` is every /api/ path the page read. */
async function open({ phone = false } = {}) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1420, height: 900 } });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [], asked = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("request", (r) => { if (r.url().includes("/api/")) asked.push(new URL(r.url()).pathname + new URL(r.url()).search); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, asked };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const inner = (page, id) => tid(page, id).first().innerText({ timeout: 5000 }).catch(() => "");
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
  await page.locator('input[type="email"]').first().fill(email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  return (await tid(page, "os-main").count()) === 1;
}
async function go(page, key) {
  const l = page.locator(`[data-testid="nav-${key}"], [data-testid="mnav-${key}"]`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1800);
  return (await tid(page, "os-main").getAttribute("data-page")) === key;
}
/** The options a picker offers, as ids, the placeholder aside. */
const options = (page, id) => page.$$eval(`[data-testid="${id}"] option`, (os) => os.map((o) => o.value).filter(Boolean));
/** Wait for the compare panels to have read. */
const settled = (page) => page.waitForFunction(() => {
  const e = document.querySelector('[data-testid="compare-as-at"]');
  return !!e && /^As at /.test(e.innerText) && !!document.querySelector('[data-testid="compare-bat-table"]')
    && !document.querySelector('[data-testid="compare-matchups-read-state"][data-state="loading"]');
}, null, { timeout: 12000 }).then(() => true).catch(() => false);
/** §3.2 and §3.5 over one root. */
async function floors(page, sel) {
  return page.evaluate((s) => {
    const small = [], tiny = [];
    for (const root of document.querySelectorAll(s)) {
      for (const n of [root, ...root.querySelectorAll("*")]) {
        if (n.closest(".sr-only")) continue;
        const cs = getComputedStyle(n);
        const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
        if (/^(BUTTON|SELECT)$/.test(n.tagName)) {
          const r = n.getBoundingClientRect();
          if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
        }
      }
    }
    return { small, tiny };
  }, sel);
}
/** Every client store the page can write, as one string: localStorage, sessionStorage, and every IndexedDB store. */
const stores = (page) => page.evaluate(async () => {
  const out = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
  const dbs = indexedDB.databases ? await indexedDB.databases() : [];
  for (const { name } of dbs) {
    if (!name) continue;
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const s of db.objectStoreNames) {
      const all = await new Promise((res) => { const t = db.transaction(s).objectStore(s).getAll(); t.onsuccess = () => res(t.result); t.onerror = () => res([]); });
      out.push(JSON.stringify(all));
    }
    db.close();
  }
  return out.join("\n");
});
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {}); };

// The words and reads a comparison never carries (§4), held over the page.
const NEVER_WORDS = /skill|rating|coach'?s note|fitness|rehab|injur|workload|\bload\b|availab|discipline|conduct|date of birth|\bborn\b|age band|absent|missed|did not play|better|worse|winner|outperform|export|download|share/i;
const NEVER_READS = /\/api\/read\/(skills|skills_history|ratings|notes|coaching_points|targets|development_since|injuries|injury_|workload|load|bowling_spells|bowler_day|availability|disciplinary_records|opposition_|players_masked)|\/api\/export\//;

/** The expected cells for a career row, from the server's own figures (D4). */
function expected(c) {
  const bf = c.balls_faced == null ? null : Number(c.balls_faced);
  const bb = Number(c.balls_bowled);
  const word = (n) => (n == null ? "balls not recorded" : n === 0 ? "none" : n < 30 ? "insufficient" : n < 100 ? "low" : n < 250 ? "moderate" : "high");
  return {
    balls: String(bf ?? "—"), ballsWord: word(bf), batHeld: bf == null || bf < 30,
    bowled: String(bb), bowledWord: word(bb), bowlHeld: bb < 30,
    runs: String(c.runs), name: c.full_name,
  };
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── The stage ──
  // The performance analyst the seed does not have (its analyst@ is a scout).
  await q(`insert into app_user (school_id, email, name, role) values ($1, 'analyst.cmp@example.invalid', 'P Analyst', 'analyst')`, [HIL]);
  await q(`insert into role_assignment (person_id, role, school_id) select id, 'analyst', school_id from app_user where email = 'analyst.cmp@example.invalid'`);
  // A boy who has left: no current side (ACCOUNT_LIFECYCLE §3: "a departed
  // pupil is a player row with no current side").
  const [LEFT] = await q(`update player set team_code = null where id = (select id from player where school_id = $1 and team_code = 'U13A'
                          order by full_name limit 1) returning id, full_name`, [HIL]);
  // A played 1XI fixture of the walk's own: J Whitfield faces twenty balls of
  // spin (under the floor with the bat) and bowls forty at M Cele (over it
  // with the ball); Cele faces those forty, pace. Every expectation below is
  // then read back from the server, not pinned.
  const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001", NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";
  const CELE = (await q(`select id from player where school_id = $1 and full_name = 'M Cele'`, [HIL]))[0].id;
  await q(`update player set bowling_style = 'M' where id = $1`, [WHITFIELD]);
  const scorer = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  const PLAYED = (await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
                           values ($1, '1XI', 'Verify Compare XI', '2026-10-03 09:00+02', 'cricket', 'T20', 20, 'complete') returning id`, [HIL]))[0].id;
  let seq = 0;
  const balls = async (n, striker, bowler, pattern) => {
    for (let i = 0; i < n; i++) {
      seq++;
      await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                       client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id)
               values ($1, $2, $3, 1, 1, $4, 'd-cmp', $5, $3, now(), 'ball', 'run', $6, $7, $8)`,
              [PLAYED, HIL, seq, scorer, `cmp-${PLAYED}-${seq}`, pattern[i % pattern.length], striker, bowler]);
    }
  };
  await balls(20, WHITFIELD, NAIDOO, [0, 1, 0, 2]);
  await balls(40, CELE, WHITFIELD, [1, 0, 4, 1, 0]);
  // The two the coach compares carry a fitness word and a birthday, so the
  // DOM can be held apart from their values, not only from the column names.
  const coachTok = await tokenOf("coach@example.invalid");
  const analystTok = await tokenOf("analyst.cmp@example.invalid");
  const career = async (tok) => (await call("/api/read/career", tok)).body?.rows ?? [];
  const coachCareer = await career(coachTok);
  const analystCareer = await career(analystTok);
  const own1XI = coachCareer.filter((r) => r.school_id === HIL && r.team_code === "1XI");
  // One under the floor with the bat and over it with the ball, one over with the bat.
  const thin = own1XI.find((r) => r.player_id === WHITFIELD && Number(r.balls_faced) > 0 && Number(r.balls_faced) < 30 && Number(r.balls_bowled) >= 30);
  const set = own1XI.find((r) => r.player_id === CELE && Number(r.balls_faced) >= 30);
  ok("the stage: a 1XI boy under the floor with the bat and over it with the ball, and one over it with the bat",
     !!thin && !!set, own1XI.map((r) => `${r.full_name}:${r.balls_faced}/${r.balls_bowled}`).join(" "));
  await q(`update player set fitness = 'rehab' where id = $1`, [set.player_id]);
  const secrets = await q(`select born::text as iso, to_char(born, 'FMDD Mon YYYY') as dmy, fitness from player where id = any($1::uuid[])`, [[thin.player_id, set.player_id]]);
  const SECRET_VALUES = new RegExp(secrets.flatMap((s) => [s.iso, s.dmy]).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
  ok("the career read still returns the boy who has left, to the analyst (so the picker is what keeps him out)",
     analystCareer.some((r) => r.player_id === LEFT.id && r.team_code == null), LEFT);
  ok("...and returns the coach other sides' boys in outline", coachCareer.some((r) => r.team_code !== "1XI"));

  // ══ The coach ══
  group("The 1XI coach: Compare on Analytics, his side only");
  const c = await open();
  ok("the coach signs in", await signIn(c.page, "coach@example.invalid"));
  ok("Analytics opens", await go(c.page, "analytics"));
  // What the shell read before Compare opened is not Compare's: the reads
  // held below are the ones from here on.
  const cFrom = c.asked.length;
  await tid(c.page, "analytics-view-compare").click({ timeout: 5000 }).catch(() => {});
  await c.page.waitForTimeout(1500);
  ok("the Compare sub-view draws", await tid(c.page, "compare").count() === 1 && await tid(c.page, "compare").getAttribute("data-mode") === "staff");
  ok("...and asks for two players before drawing a figure", /Choose two players/.test(await inner(c.page, "compare-prompt")) && await tid(c.page, "compare-bat-table").count() === 0);
  const offeredA = await options(c.page, "compare-pick-a");
  ok("THE PICKER OFFERS HIS SIDE AND NOBODY ELSE", offeredA.sort().join() === own1XI.map((r) => r.player_id).sort().join(),
     `${offeredA.length} offered, ${own1XI.length} on his side`);
  ok("...no boy of another side, though the read returned them", !offeredA.some((id) => coachCareer.find((r) => r.player_id === id)?.team_code !== "1XI"));
  ok("...and not the boy who has left", !offeredA.includes(LEFT.id));
  await tid(c.page, "compare-pick-a").selectOption(thin.player_id);
  await c.page.waitForTimeout(300);
  ok("the second picker never offers the boy already chosen", !(await options(c.page, "compare-pick-b")).includes(thin.player_id));
  await tid(c.page, "compare-pick-b").selectOption(set.player_id);
  ok("the panels read", await settled(c.page));
  const A = expected(thin), B = expected(set);

  group("The floor and the counts (D4)");
  {
    ok(`his balls faced are drawn, ${A.balls}, with "${A.ballsWord}"`, (await inner(c.page, "compare-bat-balls-a")).startsWith(A.balls)
       && (await inner(c.page, "compare-bat-balls-a-word")) === A.ballsWord, await inner(c.page, "compare-bat-balls-a"));
    ok(`...and the other's, ${B.balls}, with "${B.ballsWord}"`, (await inner(c.page, "compare-bat-balls-b")).startsWith(B.balls)
       && (await inner(c.page, "compare-bat-balls-b-word")) === B.ballsWord);
    ok("his average and strike rate are withheld: an em dash and insufficient",
       /^—/.test(await inner(c.page, "compare-bat-avg-a")) && (await inner(c.page, "compare-bat-avg-a-word")) === "insufficient"
       && /^—/.test(await inner(c.page, "compare-bat-sr-a")) && (await inner(c.page, "compare-bat-sr-a-word")) === "insufficient");
    const avgB = Number(set.dismissals) > 0 ? (Number(set.runs) / Number(set.dismissals)).toFixed(2) : "—";
    ok(`...the other's average is the server's figure, ${avgB}`, (await inner(c.page, "compare-bat-avg-b")).startsWith(avgB), await inner(c.page, "compare-bat-avg-b"));
    ok("...his runs are a count, as the read gave them", (await inner(c.page, "compare-bat-runs-a")) === A.runs && (await inner(c.page, "compare-bat-runs-b")) === B.runs);
    ok("NOT ENOUGH BALLS TO COMPARE, said in words, naming him", new RegExp(`Not enough balls to compare.*${A.name}, ${A.balls} balls faced`).test(await inner(c.page, "compare-batting-floor")),
       await inner(c.page, "compare-batting-floor"));
    ok(`with the ball he clears it (${A.bowled}): an economy, "${A.bowledWord}"`, !/^—/.test(await inner(c.page, "compare-bowl-econ-a"))
       && (await inner(c.page, "compare-bowl-balls-a-word")) === A.bowledWord);
    ok(`...the other's ${B.bowled} bowled are "${B.bowledWord}"${B.bowlHeld ? ", his economy withheld" : ""}`,
       (await inner(c.page, "compare-bowl-balls-b-word")) === B.bowledWord && (!B.bowlHeld || /^—/.test(await inner(c.page, "compare-bowl-econ-b"))));
    const marks = await c.page.$$eval('[data-testid="compare"] td[data-held="true"]', (els) => els.length);
    ok(`every withheld cell is marked and carries a word (${marks})`, marks >= 2
       && await c.page.$$eval('[data-testid="compare"] td[data-held="true"]', (els) => els.every((e) => /—/.test(e.innerText) && e.querySelector('[data-testid$="-word"]'))));
  }

  group("Every panel says its source, scope, window and basis; the screen says when it read");
  {
    for (const p of ["batting", "bowling", "matchups"]) {
      const line = await inner(c.page, `source-line-compare-${p}`);
      ok(`${p}: source, scope, window, basis`, /Source/.test(line) && /Scope/.test(line) && /Window/.test(line) && /Basis/.test(line), line.replace(/\s+/g, " "));
    }
    const bat = await inner(c.page, "source-line-compare-batting");
    ok("...the batting basis is both ball counts, by name", new RegExp(`${A.balls} by ${A.name}`).test(bat) && new RegExp(`${B.balls} by ${B.name}`).test(bat), bat);
    ok("...the window is every season on record", /Every season on record/.test(bat));
    ok("as at a time, and a way to read again", /^As at \d{2}:\d{2} on /.test(await inner(c.page, "compare-as-at")) && await tid(c.page, "compare-reread").count() === 1);
    const before = c.asked.filter((p) => /\/api\/read\/career(\?|$)/.test(p)).length;
    await tid(c.page, "compare-reread").click();
    await settled(c.page);
    ok("...which reads again", c.asked.filter((p) => /\/api\/read\/career(\?|$)/.test(p)).length > before);
  }

  group("Types only (D7), and no forbidden field anywhere in the DOM (§4)");
  {
    const mu = await inner(c.page, "compare-matchups");
    ok("the match-ups panel speaks in types", /Against pace|Against spin|no bowling type/.test(mu), mu.slice(0, 200));
    const bowlers = (await call(`/api/read/matchups?batterId=${thin.player_id}`, coachTok)).body?.rows ?? [];
    ok("...and names no bowler the log has him facing", !bowlers.some((r) => mu.includes(r.bowler_name)), bowlers.map((r) => r.bowler_name).join());
    const html = await c.page.$eval('[data-testid="compare"]', (e) => e.innerHTML);
    const words = await c.page.$eval('[data-testid="compare"]', (e) => e.innerText);
    ok("NO FORBIDDEN WORD on the compare screen", !NEVER_WORDS.test(words), words.match(NEVER_WORDS)?.[0]);
    ok("...nor in its markup", !NEVER_WORDS.test(html.replace(/data-testid="[^"]*"/g, "")), html.replace(/data-testid="[^"]*"/g, "").match(NEVER_WORDS)?.[0]);
    const page = await c.page.content();
    ok("THE COMPARED BOYS' BIRTHDAYS ARE NOWHERE IN THE PAGE", !SECRET_VALUES.test(page), page.match(SECRET_VALUES)?.[0]);
    ok("...nor his fitness word", !/rehab/i.test(await c.page.$eval("body", (b) => b.innerText)));
    ok("no colour judges: every figure is the same colour",
       new Set(await c.page.$$eval('[data-testid="compare"] td > span:first-child', (els) => els.map((e) => getComputedStyle(e).color))).size === 1);
    ok("no export, share or download is offered", await c.page.locator('[data-testid="compare"] a[download], [data-testid="compare"] [data-testid*="share"], [data-testid="compare"] [data-testid*="export"]').count() === 0);
    const reads = c.asked.slice(cFrom).filter((p) => NEVER_READS.test(p));
    ok("COMPARE READ NO SKILL, RATING, NOTE, HEALTH, LOAD, AVAILABILITY, CONDUCT OR OPPOSITION RESOURCE, and nothing went to the export route",
       reads.length === 0, reads.slice(0, 4).join(" "));
    ok("...its match-ups were asked for the two boys only", c.asked.filter((p) => /\/api\/read\/matchups/.test(p)).every((p) => p.includes(thin.player_id) || p.includes(set.player_id)),
       c.asked.filter((p) => /\/api\/read\/matchups/.test(p)).join(" "));
    const kept = await stores(c.page);
    ok("NOTHING IS KEPT: no client store holds either boy", !kept.includes(thin.player_id) && !kept.includes(set.player_id) && !kept.includes(thin.full_name) && !kept.includes(set.full_name));
  }

  group("At 390 wide: 12px and 44px over the compare screen");
  {
    await c.page.setViewportSize({ width: 390, height: 844 });
    await c.page.waitForTimeout(500);
    const f = await floors(c.page, '[data-testid="compare"]');
    ok(`nothing read under 12px (${f.small.length})`, f.small.length === 0, f.small.slice(0, 4).join(" · "));
    ok(`nothing tapped under 44px (${f.tiny.length})`, f.tiny.length === 0, f.tiny.slice(0, 4).join(" · "));
    ok("no sideways scroll at 390", await c.page.evaluate(() => document.querySelector('[data-testid="compare"]').scrollWidth <= document.querySelector('[data-testid="compare"]').clientWidth + 1));
    await shot(c.page, "compare-coach-390");
    ok("no page errors", c.errors.length === 0, c.errors.slice(0, 3).join(" | "));
  }
  await c.ctx.close();

  // ══ The analyst ══
  group("The analyst: the school's sides, never the boy who has left");
  const a = await open();
  ok("the analyst signs in", await signIn(a.page, "analyst.cmp@example.invalid"));
  ok("...and Analytics is his", await go(a.page, "analytics"));
  await tid(a.page, "analytics-view-compare").click({ timeout: 5000 }).catch(() => {});
  await a.page.waitForTimeout(1500);
  await a.page.waitForFunction(() => document.querySelectorAll('[data-testid="compare-pick-a"] option').length > 1, null, { timeout: 9000 }).catch(() => {});
  const offered = await options(a.page, "compare-pick-a");
  if (!offered.length) console.log("    (analyst's compare said:", (await inner(a.page, "compare")).replace(/\s+/g, " ").slice(0, 300), ")");
  const schoolWithSide = analystCareer.filter((r) => r.school_id === HIL && r.team_code);
  ok("his picker offers every Hilton boy with a side", offered.sort().join() === schoolWithSide.map((r) => r.player_id).sort().join(), `${offered.length} of ${schoolWithSide.length}`);
  ok("A BOY WHO HAS LEFT IS IN NO PICKER (Q6)", !offered.includes(LEFT.id) && !(await a.page.$eval('[data-testid="compare-pick-a"]', (e) => e.innerText)).includes(LEFT.full_name));
  ok("...grouped by side", (await a.page.$$eval('[data-testid="compare-pick-a"] optgroup', (gs) => gs.map((g) => g.label))).length >= 3);
  const u14 = schoolWithSide.filter((r) => r.team_code !== "1XI").sort((x, y) => Number(y.balls_faced) - Number(x.balls_faced))[0];
  await a.page.locator('[data-testid="compare-pick-a"]').selectOption(u14.player_id);
  await a.page.locator('[data-testid="compare-pick-b"]').selectOption(set.player_id);
  ok("two sides side by side read", await settled(a.page));
  // D8: a season is offered only where both have figures. The seed's U14A
  // log is in no school season; the walk's 1XI fixture is in this one.
  const seasonRows = (await call("/api/read/career_by_season", analystTok)).body?.rows ?? [];
  const seasonsOf = (id) => new Set(seasonRows.filter((r) => r.player_id === id).map((r) => r.season));
  const chips = () => a.page.$$eval('[data-testid^="compare-season-"]', (bs) => bs.map((b) => b.getAttribute("data-testid")));
  const sharedU14 = [...seasonsOf(u14.player_id)].filter((x) => seasonsOf(set.player_id).has(x));
  ok(`across two sides with ${sharedU14.length ? "a season" : "no season"} in common, the window offers ${sharedU14.length ? "it" : "none and draws no gap"}`,
     sharedU14.length ? (await chips()).length === sharedU14.length + 1 : (await chips()).length === 0, (await chips()).join());
  await a.page.locator('[data-testid="compare-pick-a"]').selectOption(thin.player_id);
  ok("two of a side read", await settled(a.page));
  const shared = [...seasonsOf(thin.player_id)].filter((x) => seasonsOf(set.player_id).has(x));
  const seasons = await chips();
  ok(`the window offers every season and the ${shared.length} both have figures in (D8)`, shared.length > 0 && seasons[0] === "compare-season-all"
     && seasons.slice(1).sort().join() === shared.map((x) => `compare-season-${x}`).sort().join(), seasons.join());
  if (seasons.length > 1) {
    await tid(a.page, seasons[1]).click();
    await a.page.waitForTimeout(400);
    ok("...a season narrows the window, and the line says which", new RegExp(`The ${shared[0]} school season`).test(await inner(a.page, "source-line-compare-batting")),
       await inner(a.page, "source-line-compare-batting"));
    await tid(a.page, "compare-season-all").click();
  }
  ok("no forbidden word for the analyst either", !NEVER_WORDS.test(await inner(a.page, "compare")));
  await shot(a.page, "compare-analyst-desktop");
  ok("no page errors", a.errors.length === 0, a.errors.slice(0, 3).join(" | "));
  await a.ctx.close();

  // ══ The pupil ══
  group("A pupil compares himself with one team-mate only (D10, Q1)");
  const p = await open({ phone: true });
  ok("the pupil signs in", await signIn(p.page, "pillay@example.invalid"));
  ok("...to his own app, with no Analytics", await tid(p.page, "mnav-analytics").count() === 0 && await tid(p.page, "nav-analytics").count() === 0);
  ok("Passport opens", await go(p.page, "passport"));
  const pFrom = p.asked.length;
  await tid(p.page, "passport-tab-compare").click({ timeout: 5000 }).catch(() => {});
  await p.page.waitForTimeout(1500);
  ok("the card is his: 'Me v a team-mate'", await tid(p.page, "compare").getAttribute("data-mode") === "pupil" && /Me v a team-mate/i.test(await inner(p.page, "compare-head")));
  ok("HE IS THE LEFT COLUMN, and not a choice", /R Pillay/.test(await inner(p.page, "compare-self")) && await tid(p.page, "compare-pick-a").count() === 0);
  ok("ONE PICKER: never two team-mates against each other", await p.page.locator('[data-testid="compare"] select').count() === 1);
  const pupilCareer = await career(await tokenOf("pillay@example.invalid"));
  const mates = pupilCareer.filter((r) => r.team_code === "1XI" && r.school_id === HIL && r.player_id !== PILLAY).map((r) => r.player_id).sort();
  const offeredP = (await options(p.page, "compare-pick-b")).sort();
  ok("...holding his side's boys", offeredP.join() === mates.join(), `${offeredP.length} offered, ${mates.length} team-mates`);
  ok("...never himself, and no boy of another side", !offeredP.includes(PILLAY) && offeredP.every((id) => pupilCareer.find((r) => r.player_id === id)?.team_code === "1XI"));
  await tid(p.page, "compare-pick-b").selectOption(set.player_id);
  ok("his figures beside the team-mate's read", await settled(p.page));
  const head = await p.page.$$eval('[data-testid="compare-bat-table"] thead th', (ths) => ths.map((t) => t.innerText.trim()));
  ok("...himself on the left, the team-mate on the right", head[0]?.toLowerCase() === "r pillay" && head[2]?.toLowerCase() === set.full_name.toLowerCase(), head.join(" | "));
  ok("...the floor applies to him as to anyone", (await p.page.$$eval('[data-testid="compare"] td[data-held="true"]', (els) => els.length)) >= 1);
  ok("no forbidden word on his card", !NEVER_WORDS.test(await inner(p.page, "compare")), (await inner(p.page, "compare")).match(NEVER_WORDS)?.[0]);
  ok("...nor the team-mate's fitness word or birthday anywhere in the page", !/rehab/i.test(await p.page.$eval("body", (b) => b.innerText)) && !SECRET_VALUES.test(await p.page.content()));
  ok("...and no read of a team-mate's health, load or conduct", p.asked.slice(pFrom).filter((x) => NEVER_READS.test(x)).length === 0, p.asked.slice(pFrom).filter((x) => NEVER_READS.test(x)).join(" "));
  const fp = await floors(p.page, '[data-testid="compare"], [data-testid="pupil-passport"] [role="tablist"]');
  ok(`at 390 wide: nothing read under 12px (${fp.small.length}), nothing tapped under 44px (${fp.tiny.length})`, fp.small.length === 0 && fp.tiny.length === 0, [...fp.small, ...fp.tiny].slice(0, 4).join(" · "));
  await shot(p.page, "compare-pupil-390");
  const keptP = await stores(p.page);
  ok("nothing kept on his phone", !keptP.includes(set.player_id) && !keptP.includes(set.full_name));
  ok("no page errors", p.errors.length === 0, p.errors.slice(0, 3).join(" | "));
  await p.ctx.close();

  // ══ The parent ══
  group("A parent has no Compare (D11, Q2)");
  const m = await open({ phone: true });
  ok("the parent signs in", await signIn(m.page, "parent@example.invalid"));
  const bar = await m.page.$$eval('[data-testid^="mnav-"], [data-testid^="nav-"]', (els) => els.map((e) => e.getAttribute("data-testid")));
  ok("her app offers no Analytics and no Passport", !bar.some((b) => /analytics|passport/.test(b)), bar.join());
  let anyCompare = 0;
  for (const key of bar.map((b) => b.replace(/^m?nav-/, "")).filter((k) => !/^(more|settings|safeguarding|invites|alerts|group)/.test(k))) {
    if (await go(m.page, key)) anyCompare += await m.page.locator('[data-testid="compare"], [data-testid^="compare-"]').count();
  }
  ok("no compare screen or card on any page of hers", anyCompare === 0, anyCompare);
  ok("no page errors", m.errors.length === 0, m.errors.slice(0, 3).join(" | "));
  await m.ctx.close();
} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.stack ?? e.message);
  if (apiErr.length) console.log(apiErr.join("").slice(-1500));
} finally {
  await browser.close().catch(() => {});
  await owner.end().catch(() => {});
  api.kill();
  web.close();
  console.log("\n" + "─".repeat(52));
  console.log(`BROWSER COMPARE SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

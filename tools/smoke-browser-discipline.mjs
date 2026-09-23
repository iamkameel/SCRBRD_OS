#!/usr/bin/env node
/**
 * The disciplinary record, from a browser. SCRBRD-053's screen.
 *
 * tools/smoke-discipline.mjs proves the table, the read and both writes over
 * HTTP. This walk drives the two surfaces that finally call them —
 * apps/web/src/views/discipline.jsx — as the people they are for, and as the
 * people they are NOT for:
 *
 *   1. A director of sport files a school-side matter from a boy's Conduct
 *      tab, sees it there, and concludes it — and is told in words when she
 *      leaves out what was decided, and when the server refuses her.
 *   2. The umpire reports an incident from Match Centre, for the fixture he
 *      stood at, and is told it landed — WITHOUT the screen reading it back,
 *      because he holds discipline.write and not discipline.read. When his
 *      appointment is withdrawn under him, the refusal is said, not swallowed.
 *   3. The principal and the registrar read what was filed; neither is
 *      offered a way to file or conclude (neither holds discipline.write).
 *   4. STAFF ONLY, BY PRODUCT DECISION. The pupil — whom the database WOULD
 *      let read his own record — sees no Conduct tab and never asks for the
 *      record at all. A coach, who does not hold discipline.read, neither.
 *   5. Signed out, the tab draws an honest "sign in" state, never a matter.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-discipline.mjs
 *   BROWSER_DISCIPLINE_DEBUG=1 node tools/smoke-browser-discipline.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 4342;
const API_PORT = 8842;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const P_SELF   = "aaaaaaaa-0000-0000-0000-000000000005";  // R Pillay, 1XI — the pupil with an account
const P_BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";  // T Bekker — in the ball log of M_STOOD, out bowled
const P_WES    = "bbbbbbbb-0000-0000-0000-000000000001";  // D Mkhize, Westville — Sarah's own child there
const M_STOOD  = "77777777-0000-0000-0000-000000000004";  // the one fixture E Ndlovu is appointed to
const U_SARAH  = "88888888-0000-0000-0000-000000000007";
const U_UMPIRE = "88888888-0000-0000-0000-000000000023";
const A_UMPIRE = "a5510000-0000-0000-0000-000000000023";  // his seeded appointment
const DEBUG = !!process.env.BROWSER_DISCIPLINE_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-discipline-secret",
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
const dbq = async (text, params) => (await pool.query(text, params)).rows;

const browser = await chromium.launch({ ...launchOptions() });

/**
 * A fresh context per person. `reads` collects every request this session
 * makes for the record, so "the pupil never asked for it" is a fact about the
 * network, not only about what was drawn.
 */
async function open(apiBase = API) {
  const ctx = await browser.newContext();
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [], reads = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  page.on("request", (r) => { if (r.url().includes("/api/read/disciplinary_records")) reads.push(r.url()); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(apiBase)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, reads };
}
const text = (page) => page.$eval("body", (el) => el.innerText);
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
/** Sign in as a seeded account. Accounts on the pilot list are clicked; any
 *  other (the umpire is not on it) is typed — the same development route. */
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}
async function nav(page, id) {
  const l = tid(page, `nav-${id}`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return true;
}
/** Profiles → one boy. False when he is not on this reader's roster. */
async function openProfile(page, playerId) {
  if (!(await nav(page, "profiles"))) return false;
  const row = tid(page, `roster-player-${playerId}`).first();
  if (!(await row.count())) return false;
  await row.click({ timeout: 6000 });
  await page.waitForTimeout(1500);
  return true;
}
const conductTab = (page) => tid(page, "profile-tab-conduct");
async function openConduct(page) {
  if (!(await conductTab(page).count())) return false;
  await conductTab(page).first().click({ timeout: 6000 });
  await page.waitForTimeout(1800);
  return (await tid(page, "conduct-tab").count()) === 1;
}
async function toMatch(page, matchId) {
  if (!(await nav(page, "matches"))) return false;
  const card = tid(page, `match-card-${matchId}`).first();
  if (!(await card.count())) return false;
  await card.click({ timeout: 6000 });
  await page.waitForTimeout(1500);
  return true;
}
/** Appoint the umpire to his fixture again, unless he already is. */
const reappoint = () => dbq(
  `insert into role_assignment (person_id, role, school_id, team_code, fixture_id)
   select $1, 'official', '11111111-1111-1111-1111-111111111111', null, $2
    where not exists (select 1 from role_assignment
                       where person_id = $1 and role = 'official' and fixture_id = $2 and active)`,
  [U_UMPIRE, M_STOOD]);
const matters = async (where = "") => dbq(
  `select id, player_id, match_id, recorded_by, state, outcome, body from disciplinary_record ${where} order by created_at`);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the walk starts from a record with nothing in it", (await matters()).length === 0);

  // ── 5. Signed out ────────────────────────────────────────────────
  group("Signed out, the tab says to sign in — it never draws a matter");
  {
    // A dead API base is how the app decides there is no server, and the demo
    // entry is only offered then.
    const d = await open("http://127.0.0.1:9");
    await click(d.page, /Get Started|Log In/, 5000);
    await d.page.waitForTimeout(800);
    const demo = tid(d.page, "login-demo");
    ok("the demonstration is offered with no server", await demo.count() === 1);
    await demo.click({ timeout: 6000 }).catch(() => {});
    await d.page.waitForTimeout(2000);
    ok("the demo's profiles screen opens", await nav(d.page, "profiles"));
    await d.page.locator('[data-testid^="roster-player-"]').first().click({ timeout: 6000 }).catch(() => {});
    await d.page.waitForTimeout(1200);
    ok("a demo school administrator is drawn the tab (the gate is by capability)", await conductTab(d.page).count() === 1);
    await conductTab(d.page).first().click({ timeout: 6000 }).catch(() => {});
    await d.page.waitForTimeout(800);
    ok("...which says to sign in", await tid(d.page, "conduct-signed-out").count() === 1);
    ok("...and invents no matter", await d.page.locator('[data-testid^="conduct-matter-"]').count() === 0);
    ok("...and offers no form that could not be sent", await tid(d.page, "conduct-record-form").count() === 0);
    await d.ctx.close();
  }

  // ── 1. The director of sport ─────────────────────────────────────
  group("A director of sport files a school-side matter, sees it, and concludes it");
  const dos = await open();
  ok("the director of sport signs in", await signIn(dos.page, "sarah@example.invalid"));
  ok("she opens the pupil's profile", await openProfile(dos.page, P_SELF));
  ok("the Conduct tab is drawn for her", await openConduct(dos.page));
  ok("...empty to begin with", /0 matters/.test(await tid(dos.page, "conduct-count").innerText().catch(() => "")));
  ok("...with the form to record one", await tid(dos.page, "conduct-record-form").count() === 1);

  await tid(dos.page, "conduct-record-submit").click();
  await dos.page.waitForTimeout(400);
  ok("an empty account is refused in words, not silently",
     /Say what happened/.test(await tid(dos.page, "conduct-record-refused").innerText().catch(() => "")));
  ok("...and nothing was written", (await matters()).length === 0);

  const ACCOUNT = "Left the nets without permission and was rude to the groundsman.";
  await tid(dos.page, "conduct-record-body").fill(ACCOUNT);
  await tid(dos.page, "conduct-record-submit").click();
  await dos.page.waitForTimeout(2000);
  ok("she is told it was recorded", await tid(dos.page, "conduct-record-done").count() === 1);
  const [filed] = await matters(`where player_id = '${P_SELF}'`);
  ok("Postgres has the matter, about him, with no fixture, as hers",
     filed && filed.match_id === null && filed.recorded_by === U_SARAH && filed.state === "open", JSON.stringify(filed));
  const card = tid(dos.page, `conduct-matter-${filed?.id}`);
  ok("the tab now lists it", await card.count() === 1);
  const cardText = await card.innerText().catch(() => "");
  if (DEBUG) console.log("[debug] her matter:\n" + cardText);
  ok("...with the account", cardText.includes(ACCOUNT));
  ok("...as a school matter", /School matter — no fixture/.test(cardText));
  ok("...who recorded it", /Recorded by Sarah Mokoena/.test(cardText));
  ok("...and that it is open", /open/i.test(await tid(dos.page, `conduct-state-${filed?.id}`).innerText().catch(() => "")));

  await tid(dos.page, `conduct-conclude-${filed?.id}`).click();
  await dos.page.waitForTimeout(500);
  ok("concluding without an outcome is refused in words",
     /without saying what was decided/.test(await tid(dos.page, `conduct-refused-${filed?.id}`).innerText().catch(() => "")));
  ok("...and the matter is still open in Postgres", (await matters(`where id = '${filed?.id}'`))[0]?.state === "open");

  const OUTCOME = "Apologised to the groundsman; one week off the nets roster.";
  await tid(dos.page, `conduct-outcome-input-${filed?.id}`).fill(OUTCOME);
  await tid(dos.page, `conduct-conclude-${filed?.id}`).click();
  await dos.page.waitForTimeout(2000);
  const concluded = (await matters(`where id = '${filed?.id}'`))[0];
  ok("she concludes it, and Postgres agrees", concluded?.state === "concluded" && concluded?.outcome === OUTCOME, JSON.stringify(concluded));
  ok("the tab shows it concluded", /concluded/i.test(await tid(dos.page, `conduct-state-${filed?.id}`).innerText().catch(() => "")));
  ok("...with the outcome beside it", (await tid(dos.page, `conduct-outcome-${filed?.id}`).innerText().catch(() => "")) === OUTCOME);
  ok("...and no longer offers to conclude it", await tid(dos.page, `conduct-conclude-${filed?.id}`).count() === 0);

  group("The server refuses her about a child at another school, and the form says so");
  // Her own son at Westville, where she is a parent and not the director of
  // sport. The tab is drawn (her persona reads the record), the read comes back
  // empty (RLS: not her school), and a filing is refused by the INSERT policy —
  // 42501, mapped to not_permitted — rather than appearing to succeed.
  if (await openProfile(dos.page, P_WES) && await openConduct(dos.page)) {
    ok("the tab shows nothing of his to her", /0 matters/.test(await tid(dos.page, "conduct-count").innerText().catch(() => "")));
    await tid(dos.page, "conduct-record-body").fill("Not a matter for this school.");
    await tid(dos.page, "conduct-record-submit").click();
    await dos.page.waitForTimeout(1800);
    const said = await tid(dos.page, "conduct-record-refused").innerText().catch(() => "");
    ok("the refusal is shown in words", /Refused — your role does not reach/.test(said), said);
    ok("...not a claim that it was recorded", await tid(dos.page, "conduct-record-done").count() === 0);
    ok("...and nothing was written about him", (await matters(`where player_id = '${P_WES}'`)).length === 0);
  } else {
    ok("her Westville child's profile opens, to be refused at", false);
  }
  ok("no console errors on her session", dos.errors.length === 0, dos.errors.join(" | "));

  // ── 2. The umpire ────────────────────────────────────────────────
  group("The umpire reports an incident from the fixture he stood at");
  const ump = await open();
  ok("the umpire signs in", await signIn(ump.page, "e.ndlovu@example.invalid"));
  ok("his fixture is in Match Centre", await toMatch(ump.page, M_STOOD));
  ok("he is offered the report", await tid(ump.page, "incident-open").count() === 1);
  await tid(ump.page, "incident-open").click();
  await ump.page.waitForTimeout(1800);
  const options = await ump.page.$$eval('[data-testid="incident-player"] option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })));
  if (DEBUG) console.log("[debug] who he can name:", JSON.stringify(options));
  const bowled = options.find((o) => /out, bowled/.test(o.t));
  ok("the players he can name come from the ball log he stood over", !!bowled && bowled.v === P_BEKKER, JSON.stringify(options));
  ok("...said as what they did, not as a uuid", options.every((o) => !/[0-9a-f]{8}-/.test(o.t)));
  ok("...and the screen says why it is not the team sheet", /does not include the team sheet/.test(await tid(ump.page, "incident-panel").innerText()));

  // His appointment withdrawn under him, between opening the form and sending
  // it. app_can() reads the assignment on every evaluation, so the INSERT is
  // refused — and the screen must say so rather than confirm.
  await dbq(`update role_assignment set active = false where id = $1`, [A_UMPIRE]);
  await ump.page.selectOption('[data-testid="incident-player"]', P_BEKKER);
  await tid(ump.page, "incident-body").fill("Showed dissent at an lbw decision.");
  await tid(ump.page, "incident-submit").click();
  await ump.page.waitForTimeout(1800);
  const refused = await tid(ump.page, "incident-refused").innerText().catch(() => "");
  ok("with his appointment withdrawn, the refusal is shown in words", /Refused — your role does not reach/.test(refused), refused);
  ok("...and no confirmation is shown", await tid(ump.page, "incident-recorded").count() === 0);
  ok("...and nothing was written", (await matters(`where match_id = '${M_STOOD}'`)).length === 0);
  // A withdrawn assignment is never reactivated (db/01 refuses it); the school
  // makes the appointment again, which is what reinstating him means.
  await reappoint();

  const INCIDENT = "Threw the ball at the stumps after being bowled, and swore at the bowler.";
  await tid(ump.page, "incident-body").fill(INCIDENT);
  await tid(ump.page, "incident-submit").click();
  await ump.page.waitForTimeout(2000);
  const conf = await tid(ump.page, "incident-recorded").innerText().catch(() => "");
  ok("reinstated, he is told it landed", /Recorded — the school has it/.test(conf), conf);
  const [incident] = await matters(`where match_id = '${M_STOOD}'`);
  ok("Postgres has it: about the boy he chose, at his fixture, as his",
     incident?.player_id === P_BEKKER && incident?.recorded_by === U_UMPIRE && incident?.state === "open", JSON.stringify(incident));
  ok("the screen never asked for the record back", ump.reads.length === 0, ump.reads.join(" "));
  ok("...and does not show him his own account", !(await text(ump.page)).includes(INCIDENT));
  ok("no console errors on his session", ump.errors.length === 0, ump.errors.join(" | "));
  await ump.ctx.close();

  group("The director of sport sees the umpire's report, and withdraws it with a reason");
  ok("she opens the boy he reported", await openProfile(dos.page, P_BEKKER));
  ok("...and his Conduct tab", await openConduct(dos.page));
  const umpText = await tid(dos.page, `conduct-matter-${incident?.id}`).innerText().catch(() => "");
  if (DEBUG) console.log("[debug] the umpire's matter, as she sees it:\n" + umpText);
  ok("it is there, in the umpire's words", umpText.includes(INCIDENT));
  ok("...at the fixture", /At the fixture v Maritzburg College/.test(umpText), umpText);
  ok("...recorded by the umpire, not by her", /Recorded by E Ndlovu/.test(umpText));
  await tid(dos.page, `conduct-outcome-input-${incident?.id}`).fill("Withdrawn: the umpire's report was of a different boy.");
  await tid(dos.page, `conduct-withdraw-${incident?.id}`).click();
  await dos.page.waitForTimeout(2000);
  const w = (await matters(`where id = '${incident?.id}'`))[0];
  ok("she withdraws it, and Postgres agrees", w?.state === "withdrawn" && /different boy/.test(w?.outcome ?? ""), JSON.stringify(w));
  ok("...with authorship still the umpire's", w?.recorded_by === U_UMPIRE);
  ok("...and the tab shows it withdrawn", /withdrawn/i.test(await tid(dos.page, `conduct-state-${incident?.id}`).innerText().catch(() => "")));
  ok("no console errors on her session", dos.errors.length === 0, dos.errors.join(" | "));
  await dos.ctx.close();

  // ── 3. The principal and the registrar ───────────────────────────
  for (const [who, email] of [["principal", "principal@example.invalid"], ["registrar", "registrar@example.invalid"]]) {
    group(`The ${who} reads what was filed, and is offered nothing to write`);
    await dbq(`delete from access_log where resource = 'disciplinary_records'`);
    const s = await open();
    ok(`the ${who} signs in`, await signIn(s.page, email));
    ok(`...opens the pupil's profile`, await openProfile(s.page, P_SELF));
    ok("...and is drawn the Conduct tab", await openConduct(s.page));
    const t = await tid(s.page, `conduct-matter-${filed?.id}`).innerText().catch(() => "");
    ok("the concluded matter is there", t.includes(ACCOUNT) && /concluded/i.test(t), t.slice(0, 200));
    ok("...with its outcome", t.includes(OUTCOME));
    ok("...and only his: the umpire's report about another boy is not on this page",
       !(await text(s.page)).includes(INCIDENT));
    ok("no form to record a matter", await tid(s.page, "conduct-record-form").count() === 0);
    ok("no way to conclude or withdraw", await s.page.locator('[data-testid^="conduct-conclude-"],[data-testid^="conduct-withdraw-"]').count() === 0);
    // The read was narrowed to one boy on the server, so the school's log says
    // his record was read — and not every child's with a matter on file.
    const log = await dbq(`select record_ids, fields from access_log where resource = 'disciplinary_records'`);
    ok("the read is on the school's access log", log.length >= 1);
    ok("...naming him and only him", log.length >= 1 && log.every((l) => l.record_ids.length === 1 && l.record_ids[0] === P_SELF),
       JSON.stringify(log));
    ok("no console errors", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  // ── 4. The pupil, and a coach ────────────────────────────────────
  group("The pupil sees no Conduct tab — staff only, by product decision");
  {
    const s = await open();
    ok("the pupil signs in", await signIn(s.page, "pillay@example.invalid"));
    ok("...opens his own profile", await openProfile(s.page, P_SELF));
    ok("no Conduct tab is drawn for him", await conductTab(s.page).count() === 0);
    ok("...though the rest of his profile is", await tid(s.page, "profile-tab-overview").count() === 1);
    ok("his matter's account is nowhere on the page", !(await text(s.page)).includes(ACCOUNT));
    ok("he is not offered an incident report on a fixture", await toMatch(s.page, M_STOOD) && await tid(s.page, "incident-panel").count() === 0);
    ok("the app never asked for his record", s.reads.length === 0, s.reads.join(" "));
    ok("no console errors", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  group("A coach sees no Conduct tab — he does not hold discipline.read");
  {
    const s = await open();
    ok("the coach signs in", await signIn(s.page, "coach@example.invalid"));
    ok("...opens a boy in his side", await openProfile(s.page, P_SELF));
    ok("no Conduct tab is drawn for him", await conductTab(s.page).count() === 0);
    ok("...nor an incident report on a fixture", await toMatch(s.page, M_STOOD) && await tid(s.page, "incident-panel").count() === 0);
    ok("the app never asked for the record", s.reads.length === 0, s.reads.join(" "));
    ok("no console errors", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
  }

  group("Falsified against the table itself");
  const all = await matters();
  ok("exactly the two matters the screens filed exist — no refusal wrote one", all.length === 2, JSON.stringify(all.map((m) => m.id)));
} catch (e) {
  ok(`the browser discipline walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  // Leave him appointed, whatever happened above.
  await reappoint().catch(() => {});
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER DISCIPLINE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

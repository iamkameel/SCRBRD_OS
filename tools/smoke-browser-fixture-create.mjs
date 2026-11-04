#!/usr/bin/env node
/**
 * Scheduling a match from Match Centre, from a browser.
 *
 * apps/web/src/views/MatchCentreView.jsx:43 offered "+ Schedule Match" to
 * anyone holding fixture.create and did nothing when clicked — the exact
 * stub docs/redesign/SCREEN_MAP.md names. POST /api/fixtures already existed
 * (services/api/write/fixture-api.mjs, walked directly by
 * tools/smoke-fixture.mjs) and so did a full arranging form — AddFixtureModal,
 * built for the Leagues screen. This walk proves the Match Centre button now
 * opens that same form, that a real fixture arranged through it really lands
 * and really appears back in Match Centre's own list, that a role without
 * fixture.create is never shown the button, and that a real refusal from the
 * database — a side playing itself — reaches the screen as a sentence rather
 * than a bare error code.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-fixture-create.mjs
 *   BROWSER_FIXTURE_CREATE_DEBUG=1 node tools/smoke-browser-fixture-create.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { appUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(5295);
const API_PORT = port(8795);
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG = !!process.env.BROWSER_FIXTURE_CREATE_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-fixture-create-secret",
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

const browser = await chromium.launch({ ...launchOptions() });

async function open() {
  // South African time, so a date and a time typed into the forms are the
  // ones the database reads (db/133's clash words are SAST).
  const ctx = await browser.newContext({ timezoneId: "Africa/Johannesburg" });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
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

const text = (page) => page.$eval("body", (el) => el.innerText);
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
async function signIn(page, who) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await click(page, who, 4000);
  await click(page, /^Sign In$/, 5000);
  await afterReads(page, 2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}
async function signInAs(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await page.locator("#login-email").fill(email);
  await click(page, /^Sign In$/, 5000);
  await afterReads(page, 2200);
  return (await page.locator('[data-testid="persona-bar"]').count()) === 1;
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const inner = (page, id) => tid(page, id).first().innerText().catch(() => "");
/** An instant as the Johannesburg wall clock reads it: { date: "YYYY-MM-DD", time: "HH:MM" }. */
const sast = (ms) => {
  const s = new Date(ms + 2 * 3600e3).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
};
async function nav(page, label) {
  const l = page.locator("nav button", { hasText: label }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await afterReads(page, 1500);
  return true;
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── A role without fixture.create never sees the button ──────────
  group("A coach, who holds no fixture.create, is not offered Schedule Match");
  {
    const c = await open();
    ok("the coach signs in", await signIn(c.page, /coach@example\.invalid|Head Coach/));
    ok("Match Centre opens", await nav(c.page, /Match Centre/));
    ok("no Schedule Match button is drawn",
       (await c.page.locator("button", { hasText: /Schedule Match/ }).count()) === 0);
    ok("no console errors (coach)", c.errors.length === 0, c.errors.join(" | "));
    await c.ctx.close().catch(() => {});
  }

  // ── The director of sport arranges a real fixture from Match Centre ──
  group("The director of sport opens Match Centre and schedules a match");
  const dos = await open();
  ok("the director of sport signs in", await signIn(dos.page, /sarah@example\.invalid|Director/));
  ok("Match Centre opens", await nav(dos.page, /Match Centre/));
  ok("Schedule Match is offered", await click(dos.page, /\+ Schedule Match/, 4000));
  await dos.page.waitForTimeout(500);
  ok("the arranging form opens (the same one Leagues uses)",
     await dos.page.locator('[data-testid="fixture-preview"]').count() === 1);

  const OPPONENT = "Browser Create FC";
  await dos.page.locator("select").first().selectOption("1XI");
  ok("the home side is picked", /1XI/.test(await dos.page.locator('[data-testid="fixture-preview"]').innerText()));
  // Left on "Not on SCRBRD" (the default) — a free-text opponent, exactly the
  // path most schools use, distinct from browser-read.mjs's tenant-school walk.
  await dos.page.locator('input[placeholder="e.g. Michaelhouse 1st XI"]').fill(OPPONENT);
  ok("a quick-date chip sets the date", await click(dos.page, /Next Saturday/, 3000));
  const preview = await dos.page.locator('[data-testid="fixture-preview"]').innerText();
  ok("the preview names the opponent as typed", preview.includes(OPPONENT), preview);

  ok("he arranges it", await click(dos.page, /Arrange Fixture/, 4000));
  await afterReads(dos.page, 1500);
  ok("the form closes on success", await dos.page.locator('[data-testid="fixture-preview"]').count() === 0);

  group("The fixture just arranged is really back on Match Centre's own list");
  await dos.page.waitForTimeout(500);
  const centreText = await text(dos.page);
  if (DEBUG) console.log("[debug] Match Centre after arranging:\n" + centreText.slice(0, 800));
  ok("the new opponent is listed", centreText.includes(OPPONENT), centreText.slice(0, 500));

  // Confirmed against the database directly too, the same way
  // smoke-browser-seasons.mjs closes its own loop: the screen is not just
  // showing a toast, the row is really there for the next reader.
  const tok = await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "sarah@example.invalid", deviceId: "browser-fixture-create" }),
  })).json().then((j) => j.token);
  const fixtures = await (await fetch(`${API}/api/read/matches`, { headers: { authorization: `Bearer ${tok}` } })).json();
  ok("...and it is really in the database, not just rendered",
     fixtures?.rows?.some((m) => m.team_code === "1XI" && m.opponent === OPPONENT));

  // ── A real refusal reaches the screen as a sentence ───────────────
  group("A side that cannot play itself is refused, in plain words — not a bare code");
  ok("Schedule Match is offered again", await click(dos.page, /\+ Schedule Match/, 4000));
  await dos.page.waitForTimeout(500);
  await dos.page.locator("select").first().selectOption("1XI");
  ok("the away-side toggle offers naming a school on SCRBRD", await click(dos.page, /A school here/, 3000));
  await dos.page.waitForTimeout(700);   // the school list is fetched, not instant
  await dos.page.locator("select").nth(1).selectOption({ label: "Hilton College" });
  await dos.page.locator('input[placeholder="1XI"]').fill("1XI");
  await click(dos.page, /This Saturday|Next Saturday/, 3000);
  ok("he tries to arrange Hilton 1XI against Hilton 1XI", await click(dos.page, /Arrange Fixture/, 4000));
  await dos.page.waitForTimeout(1200);
  const refused = dos.page.locator('[data-testid="fixture-refused"]');
  ok("the refusal is shown on screen", await refused.count() === 1);
  const refusedText = await refused.innerText().catch(() => "");
  if (DEBUG) console.log("[debug] refusal shown:", refusedText);
  ok("...as a sentence, not the bare code the API returned",
     refusedText.length > 0 && !/^invalid_fixture$/.test(refusedText.trim()));
  ok("...naming the actual rule broken", /differ|rules|itself/i.test(refusedText), refusedText);
  ok("the form is still open — nothing was silently arranged",
     await dos.page.locator('[data-testid="fixture-preview"]').count() === 1);
  await click(dos.page, /^Cancel$/, 3000);

  // ── db/133 (Kameel, 4 Nov 2026): one ground at a time, no override ──
  // The seed's 1XI v Michaelhouse (M2) is on Gordon Sherwood Oval; a U15A
  // fixture half an hour into it, on the same ground, is refused, naming it.
  const M2 = "77777777-0000-0000-0000-000000000002";
  const auth = { headers: { authorization: `Bearer ${tok}` } };
  const m2Of = async () => (await (await fetch(`${API}/api/read/matches`, auth)).json())?.rows?.find((m) => m.id === M2);
  const m2 = await m2Of();
  ok("the seed's 1XI v Michaelhouse is on a ground", !!m2?.starts_at && !!m2?.ground, JSON.stringify(m2 ?? null).slice(0, 200));
  group("A fixture on a ground already taken then is refused, and the clash is named");
  ok("Schedule Match is offered again", await click(dos.page, /\+ Schedule Match/, 4000));
  await dos.page.waitForTimeout(500);
  await dos.page.locator("select").first().selectOption("U15A");
  await dos.page.locator('input[placeholder="e.g. Michaelhouse 1st XI"]').fill("Kearsney Clash XI");
  const over = sast(Date.parse(m2.starts_at) + 30 * 60e3);
  await dos.page.locator('input[type="date"]').first().fill(over.date);
  await dos.page.locator('input[type="time"]').first().fill(over.time);
  await dos.page.locator('select:has(option:has-text("Gordon Sherwood Oval"))').first().selectOption({ label: "Gordon Sherwood Oval" });
  ok("he tries to book the Oval half an hour into the 1XI's match", await click(dos.page, /Arrange Fixture/, 4000));
  await dos.page.waitForTimeout(1200);
  const clashText = await dos.page.locator('[data-testid="fixture-refused"]').innerText().catch(() => "");
  if (DEBUG) console.log("[debug] clash shown:", clashText);
  ok("...refused, naming the clash in the database's words",
     /^Not booked: 1XI v Michaelhouse is on Gordon Sherwood Oval \d\d:\d\d-\d\d:\d\d on \w{3} \d{1,2} \w{3}\. Choose another time or ground\.$/.test(clashText.trim()), clashText);
  ok("...and nothing was arranged",
     !((await (await fetch(`${API}/api/read/matches`, auth)).json())?.rows ?? []).some((m) => m.opponent === "Kearsney Clash XI"));
  await click(dos.page, /^Cancel$/, 3000);

  // ── Postponed, by the office, from the fixture's own panel ──
  group("The director of sport postpones the 1XI v Michaelhouse, and the side is told");
  await tid(dos.page, `match-card-${M2}`).click({ timeout: 4000 }).catch(() => {});
  await afterReads(dos.page, 800);
  ok("the fixture's panel offers Reschedule or postpone", await click(dos.page, /^Reschedule or postpone$/, 4000));
  ok("...Postpone is offered", await tid(dos.page, "fixture-postpone").count() === 1);
  await tid(dos.page, "fixture-postpone").click({ timeout: 4000 }).catch(() => {});
  ok("...and asks once more, saying the side is told", /side's parents and pupils are told now/.test(await inner(dos.page, "fixture-status-ask")));
  await tid(dos.page, "fixture-status-confirm").click({ timeout: 4000 }).catch(() => {});
  await afterReads(dos.page, 1500);
  ok("the card now says Postponed", (await tid(dos.page, `mc-card-status-${M2}`).getAttribute("data-state").catch(() => null)) === "postponed"
     && (await inner(dos.page, `mc-card-status-${M2}`)).trim() === "Postponed", await inner(dos.page, `mc-card-status-${M2}`));
  ok("...and so does the database", (await m2Of())?.status === "postponed");
  ok("...with no Start Scoring on it", (await tid(dos.page, `match-card-${M2}`).locator("button", { hasText: /Start Scoring/ }).count()) === 0);

  // ── The parent: Postponed on the fixture, and the notice ──
  group("R Pillay's parent sees Postponed on the fixture, and a notice that names no child");
  const pa = await open();
  ok("the parent signs in", await signInAs(pa.page, "parent@example.invalid"));
  await pa.page.locator("nav button", { hasText: /^Matches$/ }).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(pa.page, 1500);
  ok("his Matches list marks the fixture Postponed", (await inner(pa.page, `fixture-chip-${M2}`)).trim() === "Postponed", await inner(pa.page, `fixture-chip-${M2}`));
  await tid(pa.page, `fixture-row-${M2}`).click({ timeout: 4000 }).catch(() => {});
  await afterReads(pa.page, 1200);
  ok("...and the fixture says so, asking no answer for a day it is not on",
     /^Postponed\. It stays on the calendar/.test(await inner(pa.page, "fixture-postponed")) && await tid(pa.page, "fixture-availability").count() === 0,
     await inner(pa.page, "fixture-postponed"));
  await pa.page.locator("nav button", { hasText: /^Notices$/ }).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(pa.page, 1500);
  const notices = await tid(pa.page, "family-notices").innerText().catch(() => "");
  ok("her Notices hold 'Postponed · 1XI v Michaelhouse'", notices.includes("Postponed · 1XI v Michaelhouse"), notices.slice(0, 300));
  const paTok = await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "parent@example.invalid", deviceId: "browser-fixture-create-parent" }) })).json().then((j) => j.token);
  const paNotes = (await (await fetch(`${API}/api/read/notifications`, { headers: { authorization: `Bearer ${paTok}` } })).json())?.rows ?? [];
  const told = paNotes.filter((n) => n.subject_id === M2 && /^Postponed · /.test(n.title ?? ""));
  ok("...one notice, the side's, naming no child and addressed to nobody",
     told.length === 1 && !/Pillay/i.test(`${told[0]?.title} ${told[0]?.body}`) && !told[0]?.subject_person_id && !told[0]?.recipient_id,
     JSON.stringify(told).slice(0, 300));
  ok("no page errors on the parent's session", pa.errors.length === 0, pa.errors.join(" | "));

  // ── Back on, with a new date ──
  group("The director of sport gives it a new date: it is back on, and the side is told again");
  await afterReads(dos.page, 500);
  if (!(await tid(dos.page, "fixture-reschedule").count())) await click(dos.page, /^Give it a new date$/, 4000);
  ok("the panel offers the new-date path for a postponed fixture", /Put this fixture back on/.test(await inner(dos.page, "fixture-reschedule")), await inner(dos.page, "fixture-reschedule"));
  ok("...and Put it back on waits for a date and a time", await tid(dos.page, "fixture-reschedule-save").isDisabled().catch(() => false));
  const again = sast(Date.parse(m2.starts_at) + 2 * 86400e3);
  await tid(dos.page, "fixture-reschedule").locator('input[type="date"]').fill(again.date);
  await tid(dos.page, "fixture-reschedule").locator('input[type="time"]').fill(again.time);
  await tid(dos.page, "fixture-reschedule-save").click({ timeout: 4000 }).catch(() => {});
  await afterReads(dos.page, 1500);
  const back = await m2Of();
  ok("it is scheduled again, on the new date", back?.status === "scheduled" && Date.parse(back.starts_at) === Date.parse(m2.starts_at) - (Date.parse(m2.starts_at) % 60e3) + 2 * 86400e3,
     JSON.stringify({ status: back?.status, at: back?.starts_at }));
  ok("...and the card no longer says Postponed", (await tid(dos.page, `mc-card-status-${M2}`).getAttribute("data-state").catch(() => null)) !== "postponed");
  await pa.page.reload({ waitUntil: "networkidle" });
  await afterReads(pa.page, 1500);
  await pa.page.locator("nav button", { hasText: /^Notices$/ }).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(pa.page, 1500);
  const notices2 = await tid(pa.page, "family-notices").innerText().catch(() => "");
  ok("the parent's Notices now hold 'Back on · 1XI v Michaelhouse' as well", notices2.includes("Back on · 1XI v Michaelhouse") && notices2.includes("Postponed · 1XI v Michaelhouse"), notices2.slice(0, 300));
  await pa.ctx.close().catch(() => {});

  ok("no console errors on the director of sport's session", dos.errors.length === 0, dos.errors.join(" | "));
  await dos.ctx.close().catch(() => {});

} catch (e) {
  ok(`the browser fixture-create walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await browser.close().catch(() => {});
  web.close();
  apiProc.kill("SIGTERM");
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER FIXTURE-CREATE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

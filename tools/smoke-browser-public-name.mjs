#!/usr/bin/env node
/**
 * A child's name on the public pages, from a browser (SCRBRD-083 C1–C5;
 * PILOT_LOAD gap 5). tools/smoke-public-name.mjs proves the routes; this
 * drives the three screens and holds the public page to them:
 *
 *   1. THE PARENT. On her own child's file → Consents: one switch, "Show
 *      T Bekker on public match pages", with what is shown (initial and
 *      surname, never more) and that a no takes effect at once. She turns it
 *      on: the database holds her yes and the public log names T Bekker on
 *      the next request. Nothing on it names another child.
 *   2. THE OFFICE. Squad → T Bekker → Edit Profile: her answer, recorded by
 *      the guardian; "Never show this child publicly" with a reason. Set, the
 *      public log drops him on the next request though her yes stands, and
 *      the reason is on the office's screen — and on hers, nowhere: her
 *      switch still says on, and her page carries no word of the mark. The
 *      office removes the mark; then records a no on the family's word, and
 *      her switch says the office turned it off.
 *   3. THE DIRECTOR OF SPORT. Settings → School: the names-off switches per
 *      age group; open sides off drops the name, on puts it back.
 *   4. A coach is offered none of it.
 *   5. Nothing on the new controls is under 12px or 44px, at phone width for
 *      the parent; Daylight draws her switch in its own ink.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-public-name.mjs
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

const WEB_PORT = port(4362);
const API_PORT = port(8899);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const HIL = "11111111-1111-1111-1111-111111111111";
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";   // T Bekker, 1XI, sixteen; his guardian is parent.bekker
const SEEDED = "77777777-0000-0000-0000-000000000004";   // the seed's scored fixture, T Bekker in it
const REASON = "Protection order on file, walk only";
const OTHERS = /Naidoo|Cele|Whitfield|Mkhize|Dlamini|Pillay/;

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "browser-public-name-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
         PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "browser-public-name-pseudonyms-0123456789" },
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
const browser = await chromium.launch({ ...launchOptions() });

async function open({ theme = "floodlit", width = 1280, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};
    try { localStorage.setItem("scrbrd:theme", ${JSON.stringify(theme)}); } catch (e) {}`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
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
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return (await tid(page, "os-main").count()) === 1 || (await tid(page, "persona-bar").count()) === 1;
}
async function go(page, nav) {
  // The rail, or at phone width the bottom bar.
  const rail = page.locator(`[data-testid="nav-${nav}"]:visible`).first();
  const l = (await rail.count()) ? rail : page.locator(`[data-testid="mnav-${nav}"]:visible`).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1600);
  return true;
}
/** Text under 12px and controls under 44px inside one block, as drawn. */
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA|SUMMARY)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, wide: el.scrollWidth > el.clientWidth + 1, bg: getComputedStyle(document.body).backgroundColor };
  }).catch(() => ({ small: ["(not drawn)"], tiny: [], wide: false, bg: "" }));
}
let nextIp = 0;
/** The names the public log gives right now, signed out. */
const named = async () => {
  const r = await fetch(`${API}/api/public/matches/${SEEDED}/log`, { headers: { "x-forwarded-for": `10.85.0.${++nextIp & 255}` } });
  return r.status === 200 ? Object.values((await r.json()).people ?? {}) : [`(status ${r.status})`];
};
const records = async () => q(`select given_by, end_reason, ended_on is null as open, form_name from public_name_consent
                                where player_id = $1 order by seq`, [BEKKER]);
/** The parent's Family → T Bekker → Consents. */
async function toConsents(page) {
  if (!(await go(page, "family"))) return false;
  try { await tid(page, `family-open-consents-${BEKKER}`).click({ timeout: 5000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return (await tid(page, `public-name-${BEKKER}`).count()) === 1;
}
/** Squad → T Bekker → Edit Profile. */
async function toEdit(page) {
  if (!(await go(page, "squad"))) return false;
  try { await tid(page, `squad-card-${BEKKER}`).click({ timeout: 5000 }); } catch { return false; }
  await page.waitForTimeout(600);
  try { await tid(page, "player-edit-profile").click({ timeout: 4000 }); } catch { return false; }
  await page.waitForTimeout(1500);
  return true;
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`).then((x) => x.json()); if (r?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // The seed's scored fixture, published by Hilton through the route, so the
  // public log is the one a stranger reads.
  const sarahTok = (await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "sarah@example.invalid", deviceId: "browser-public-name" }) })).json()).token;
  const pubd = await fetch(`${API}/api/matches/${SEEDED}/publication`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sarahTok}` }, body: JSON.stringify({ side: "home", published: true }) });
  ok("Hilton publishes the seed's scored fixture", pubd.status === 200);
  ok("...and nobody is named on it yet", (await named()).length === 0, (await named()).join(","));

  // ── 1. The parent ───────────────────────────────────────────────
  group("1. The parent's switch, on her own child's file");
  const mum = await open({ width: 390, height: 844 });
  ok("T Bekker's guardian signs in", await signIn(mum.page, "parent.bekker@example.invalid"));
  ok("Family → T Bekker → Consents shows the switch", await toConsents(mum.page));
  const sw = tid(mum.page, `public-name-switch-${BEKKER}`);
  const card = tid(mum.page, `public-name-${BEKKER}`);
  const words = await card.innerText().catch(() => "");
  ok("it says \"Show T Bekker on public match pages\"", /Show T Bekker on public match pages/.test(words), words.slice(0, 200));
  ok("...that it shows initial and surname, never more", /initial and surname, never more/.test(words)
     && /full name, a first name alone, a photo or a date of birth is never shown/.test(words));
  ok("...and that a no takes effect at once, finished scorecards included", /takes effect at once/.test(words) && /finished scorecards included/.test(words));
  ok("...off, with nobody having answered", await sw.getAttribute("aria-checked") === "false"
     && /Nobody has answered yet/.test(await tid(mum.page, `public-name-state-${BEKKER}`).innerText()));
  ok("...and it names no other child", !OTHERS.test(await tid(mum.page, "family-file").innerText()),
     (await tid(mum.page, "family-file").innerText()).match(OTHERS)?.[0]);
  const fl = await floors(mum.page, `public-name-${BEKKER}`);
  ok("at 390 wide: nothing under 12px, no control under 44px, nothing wider than the card", fl.small.length === 0 && fl.tiny.length === 0 && !fl.wide,
     [...fl.small, ...fl.tiny].slice(0, 4).join(" · "));
  await sw.click();
  await mum.page.waitForTimeout(1500);
  ok("she turns it on: the switch says on", await sw.getAttribute("aria-checked") === "true"
     && /On since .*recorded by you/.test(await tid(mum.page, `public-name-state-${BEKKER}`).innerText()));
  const r1 = await records();
  ok("...the database holds her yes, from the guardian, open", r1.length === 1 && r1[0].given_by === "guardian" && r1[0].open, JSON.stringify(r1));
  ok("...and the public page names T Bekker on the next request", (await named()).includes("T Bekker"), (await named()).join(","));
  ok("no page error on her screen", mum.errors.length === 0, mum.errors.join(" | "));

  // ── 2. The office ───────────────────────────────────────────────
  group("2. The office: her answer, and \"Never show this child publicly\"");
  const office = await open();
  ok("the office signs in", await signIn(office.page, "registrar@example.invalid"));
  ok("Squad → T Bekker → Edit Profile", await toEdit(office.page));
  const ep = tid(office.page, "edit-public-name");
  ok("the public-name section is there", await ep.count() === 1);
  const epText = await ep.innerText().catch(() => "");
  ok("...naming him as the page would, and A Bekker's yes, recorded by the guardian", /T Bekker/.test(epText) && /A Bekker/.test(epText)
     && /On since .*recorded by the guardian/.test(epText), epText.slice(0, 300));
  ok("...and \"Never show this child publicly\", with a reason field", await tid(office.page, "never-public").count() === 1
     && await tid(office.page, "never-public-reason-input").count() === 1);
  ok("...whose button waits for a reason", await tid(office.page, "never-public-set").isDisabled());
  const ef = await floors(office.page, "edit-public-name");
  ok("the section keeps the floors", ef.small.length === 0 && ef.tiny.length === 0, [...ef.small, ...ef.tiny].slice(0, 4).join(" · "));
  await tid(office.page, "never-public-reason-input").fill(REASON);
  await tid(office.page, "never-public-set").click();
  await office.page.waitForTimeout(1500);
  const mark = await q(`select reason, ended_on from player_never_public where player_id = $1`, [BEKKER]);
  ok("she marks him: the database holds the mark and its reason", mark.length === 1 && mark[0].reason === REASON && mark[0].ended_on === null, JSON.stringify(mark));
  ok("...her screen says so, with the reason", /Marked since/.test(await tid(office.page, "never-public-state").innerText().catch(() => ""))
     && (await tid(office.page, "never-public-reason").innerText().catch(() => "")).includes(REASON));
  ok("...and the public page drops him on the next request, though the yes stands", !(await named()).includes("T Bekker")
     && (await records()).some((r) => r.open), (await named()).join(","));
  const mf = await floors(office.page, "edit-public-name");
  ok("the marked state keeps the floors", mf.small.length === 0 && mf.tiny.length === 0, [...mf.small, ...mf.tiny].slice(0, 4).join(" · "));

  // The parent, with the mark set: her answer as it is, and no word of the mark.
  await go(mum.page, "children");
  ok("the parent's screen again", await toConsents(mum.page));
  const mumText = await text(mum.page);
  ok("...her switch still says on (her answer is hers)", await tid(mum.page, `public-name-switch-${BEKKER}`).getAttribute("aria-checked") === "true");
  ok("...and nothing of the mark or its reason reaches her", !mumText.includes(REASON) && !/never show this child|never-public|marked since/i.test(mumText),
     mumText.match(/never show this child|never-public|marked since/i)?.[0]);

  await tid(office.page, "never-public-end").click();
  await office.page.waitForTimeout(1500);
  ok("the office removes the mark: end-dated, not deleted", (await q(`select ended_on is not null as ended from player_never_public where player_id = $1`, [BEKKER]))
       .map((r) => r.ended).join() === "true");
  ok("...and T Bekker is named again on the next request", (await named()).includes("T Bekker"));

  const g = await q(`select a.person_id from role_assignment a join assignment_subject s on s.assignment_id = a.id
                      where s.player_id = $1 and a.role = 'guardian'`, [BEKKER]);
  await tid(office.page, `public-name-withdraw-${g[0].person_id}`).click();
  await office.page.waitForTimeout(1500);
  const r2 = await records();
  ok("the office records a no on the family's word: her record end-dated as withdrawn", r2.length === 1 && r2[0].end_reason === "withdrawn", JSON.stringify(r2));
  ok("...the office's screen says off", /Off since .*turned off by you/.test(await tid(office.page, `public-name-guardian-state-${g[0].person_id}`).innerText().catch(() => "")));
  ok("...and the public page drops him on the next request", !(await named()).includes("T Bekker"));
  await go(mum.page, "children");
  ok("the parent's screen again", await toConsents(mum.page));
  ok("...her switch says off, turned off by the office on the family's word",
     await tid(mum.page, `public-name-switch-${BEKKER}`).getAttribute("aria-checked") === "false"
     && /turned off by the office, on the family's word/.test(await tid(mum.page, `public-name-state-${BEKKER}`).innerText()));
  ok("no page error on the office's screen", office.errors.length === 0, office.errors.join(" | "));
  // She says yes again, for section 3.
  await tid(mum.page, `public-name-switch-${BEKKER}`).click();
  await mum.page.waitForTimeout(1500);
  ok("she says yes again, and he is named", (await named()).includes("T Bekker"));

  // ── 3. The director of sport ────────────────────────────────────
  group("3. The director of sport: names off per age group");
  const dos = await open();
  ok("the director of sport signs in", await signIn(dos.page, "sarah@example.invalid"));
  ok("Settings → School", await go(dos.page, "settings")
     && await dos.page.locator("#settings-tab-school").click({ timeout: 4000 }).then(() => true, () => false));
  await dos.page.waitForTimeout(1500);
  const panel = tid(dos.page, `names-off-${HIL}`);
  ok("Hilton's names-off switches are there", await panel.count() === 1);
  ok("...one per age group the school fields, all names shown", (await panel.locator('[role="switch"]').count()) === 9
     && (await panel.locator('[role="switch"][aria-checked="true"]').count()) === 0);
  const nf = await floors(dos.page, `names-off-${HIL}`);
  ok("...keeping the floors", nf.small.length === 0 && nf.tiny.length === 0, [...nf.small, ...nf.tiny].slice(0, 4).join(" · "));
  await tid(dos.page, "names-off-open").click();
  await dos.page.waitForTimeout(1500);
  ok("open sides off: the switch says so, and the database holds it", await tid(dos.page, "names-off-open").getAttribute("aria-checked") === "true"
     && (await q(`select names_off from public_names_off where school_id = $1 and age_group = 'open'`, [HIL]))[0]?.names_off === true);
  ok("...and T Bekker (1XI) is not named on the next request", !(await named()).includes("T Bekker"));
  await tid(dos.page, "names-off-open").click();
  await dos.page.waitForTimeout(1500);
  ok("back on: named again", await tid(dos.page, "names-off-open").getAttribute("aria-checked") === "false" && (await named()).includes("T Bekker"));
  ok("no page error on her screen", dos.errors.length === 0, dos.errors.join(" | "));

  // ── 4. A coach ──────────────────────────────────────────────────
  group("4. A coach is offered none of it");
  const coach = await open();
  ok("the coach signs in", await signIn(coach.page, "coach@example.invalid"));
  ok("Squad → T Bekker: no Edit Profile", await go(coach.page, "squad")
     && await tid(coach.page, `squad-card-${BEKKER}`).click({ timeout: 5000 }).then(() => true, () => false)
     && await tid(coach.page, "player-edit-profile").count() === 0);
  ok("...and no public-name section or names-off switch anywhere", await tid(coach.page, "edit-public-name").count() === 0
     && await coach.page.locator('[data-testid^="names-off-"]').count() === 0);

  // ── 5. Daylight ─────────────────────────────────────────────────
  group("5. The parent's switch in Daylight");
  const day = await open({ theme: "daylight", width: 390, height: 844 });
  ok("the parent signs in again", await signIn(day.page, "parent.bekker@example.invalid"));
  ok("...and opens the switch", await toConsents(day.page));
  const dfl = await floors(day.page, `public-name-${BEKKER}`);
  ok("Daylight: the page is light and the floors hold", /rgb\((2[0-9]{2}|1[89][0-9]), /.test(dfl.bg) && dfl.small.length === 0 && dfl.tiny.length === 0,
     `${dfl.bg} ${[...dfl.small, ...dfl.tiny].slice(0, 3).join(" · ")}`);
  const ink = await day.page.$eval(`[data-testid="public-name-switch-${BEKKER}"]`, (b) => ({ c: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor })).catch(() => null);
  ok("...and the switch's word is drawn in an ink that is not its own background", ink && ink.c !== ink.bg, JSON.stringify(ink));
  ok("no page error in Daylight", day.errors.length === 0, day.errors.join(" | "));
  for (const c of [mum, office, dos, coach, day]) await c.ctx.close();
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e?.stack ?? e);
} finally {
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (fail && apiErr.length) console.log(apiErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nBROWSER PUBLIC NAME: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

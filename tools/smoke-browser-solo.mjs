#!/usr/bin/env node
/**
 * The three screens the solo test could not reach (7 October 2026), from a
 * browser. Each is a screen over a route that already existed:
 *
 *   1. THE OFFICE VERIFIES A PARENT'S LINK AND RECORDS THE FAMILY'S AGREEMENT.
 *      Squad → T Bekker → Edit Profile → Guardian links. The registrar (who
 *      holds guardian.link.manage) picks a parent; a link nobody has verified
 *      is verified, then the agreement is recorded with its version, and the
 *      database row says so: verified_by the registrar, consent granted, the
 *      version "popia-2026-01". The wrong pick is refused in words and changes
 *      nothing; the agreement before the verification is refused in words; a
 *      request that never arrives is a failure in words and changes nothing;
 *      while the parents are being read it says so. The director of sport,
 *      who is on the same panel and does not hold the capability, is not
 *      offered it, and a coach is not offered Edit Profile at all.
 *   2. BOOKING A VEHICLE AND A TRIP. Logistics → transport. A transport
 *      coordinator and the registrar add a vehicle (a registration that is
 *      already there is updated, not doubled) and book a trip to a fixture the
 *      school hosts: a lapsed insurance date, a bus that seats fourteen
 *      carrying fifteen and a request that never arrives each come back as
 *      words with the form kept and no trip written; the booking that works
 *      writes the trip, arranged_by the person who booked it. A fixture
 *      another school hosts is named and not offered, and a forced post is
 *      refused. The director of sport is on the page and is not offered it.
 *   3. SIGN OUT EVERYWHERE. Settings → Me. The question is asked in its words
 *      and "Stay signed in" changes nothing; a request that never arrives
 *      leaves the person signed in; once the server answers OK, this device is
 *      signed out and another device's token is refused, the epoch in
 *      auth_epoch says who and why, and the person can sign in again.
 *
 * Every write is checked against its row. Nothing says it is saved before the
 * server has answered. Type is 12px or more and every control 44px, at
 * desktop and at 390 wide. Only the seed's invented people are used, with a
 * parent, a coordinator and two fixtures made for the walk and removed.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-solo.mjs
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

const WEB_PORT = port(5631);
const API_PORT = port(5632);
const API = `http://127.0.0.1:${API_PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";     // T Bekker, 1XI, sixteen
const KZN_14 = "4e111111-0000-0000-0000-000000000002";     // KZN 119 KP, 14 seats
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const STAMP = Date.now();

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-solo-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email, deviceId = "device-solo-api") => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;

async function open({ width = 1280, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const inner = (page, id) => tid(page, id).first().innerText({ timeout: 4000 }).catch(() => "");
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
  await page.locator("#login-email").fill(email);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  return (await tid(page, "os-main").count()) === 1;
}
async function go(page, key) {
  const l = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"]`).first();
  if (!(await l.count())) {
    // On a phone the less-used screens sit in the drawer under More.
    await tid(page, "mnav-more").click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const m = page.locator(`[data-testid="mnav-${key}"], [data-testid="nav-${key}"], [data-testid="drawer-${key}"]`).first();
  if (!(await m.count())) return false;
  try { await m.click({ timeout: 6000 }); } catch { return false; }
  await page.waitForTimeout(1600);
  return true;
}
const wait = (page, id, ms = 6000) => tid(page, id).first().waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);
/** Text under 12px, controls under 44px and a sideways scroll, inside one block, as drawn. */
async function floors(page, root) {
  return page.$eval(`[data-testid="${root}"]`, (el) => {
    const small = [], tiny = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (own && cs.display !== "none" && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
      if (/^(BUTTON|SELECT|TEXTAREA)$/.test(n.tagName) || (n.tagName === "INPUT" && !["checkbox", "radio"].includes(n.type))) {
        const r = n.getBoundingClientRect();
        if (r.height && r.height < 43.5) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
      }
    }
    return { small, tiny, wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
  }).catch(() => ({ small: ["(not drawn)"], tiny: [], wide: false }));
}
const keepsFloors = async (name, page, root) => {
  const f = await floors(page, root);
  ok(`${name} keeps the floors (12px, 44px, no sideways scroll)`, f.small.length === 0 && f.tiny.length === 0 && !f.wide, [...f.small, ...f.tiny, f.wide ? "wide" : ""].join(" · "));
};

const all = [];
const made = { users: [], matches: [], vehicles: [] };
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`).then((x) => x.json()); if (r?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ══ The stage ═══════════════════════════════════════════════════════
  group("Set the stage: a parent whose link nobody has verified, a coordinator, and fixtures");
  const [{ id: BEKKER_PARENT }] = await q(`select id from app_user where email = 'parent.bekker@example.invalid'`);
  const [{ id: PARENT }] = await q(`insert into app_user (school_id, email, name, role) values ($1, $2, 'A Walk Parent', 'parent') returning id`, [HIL, `solo.parent.${STAMP}@example.invalid`]);
  made.users.push(PARENT);
  const registrar = await login("registrar@example.invalid");
  const est = await call(`/api/players/${BEKKER}/guardians`, { method: "POST", token: registrar, body: { guardianId: PARENT, relationship: "parent" } });
  ok("the parent's link is established, as the school does it", est.status === 200, JSON.stringify(est.body));
  const link = async (g) => (await q(
    `select s.verification_state as v, s.verified_by, s.verified_at, s.consent_state as c, s.consent_version, s.consent_at
       from assignment_subject s join role_assignment a on a.id = s.assignment_id
      where a.person_id = $1 and a.role = 'guardian' and s.player_id = $2`, [g, BEKKER]))[0];
  const l0 = await link(PARENT);
  ok("...pending, with nothing agreed", l0?.v === "pending" && l0?.c === "pending" && !l0?.consent_version, JSON.stringify(l0));
  const bekkerBefore = await link(BEKKER_PARENT);
  ok("his seeded guardian's link is verified and agreed, to be left alone", bekkerBefore?.v === "verified" && bekkerBefore?.c === "granted", JSON.stringify(bekkerBefore));

  const [{ id: COORD }] = await q(`insert into app_user (school_id, email, name, role) values ($1, $2, 'T Walk Coordinator', 'transportcoordinator') returning id`, [HIL, `solo.coord.${STAMP}@example.invalid`]);
  made.users.push(COORD);
  await q(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'transportcoordinator', $2, null)`, [COORD, HIL]);
  const COORD_EMAIL = (await q(`select email from app_user where id = $1`, [COORD]))[0].email;
  const day = (n) => q(`select (current_date + $1::int)::text as d`, [n]).then((r) => r[0].d);
  const mk = async (school, away, opp, n) => {
    const [m] = await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status, away_school_id, away_team_code)
                         values ($1, '1XI', $2, ((current_date + $3::int)::timestamp + time '09:00') at time zone 'Africa/Johannesburg', 'T20', 20, 'scheduled', $4, $5) returning id`,
      [school, opp, n, away, away ? "1XI" : null]);
    made.matches.push(m.id);
    return m.id;
  };
  const M1 = await mk(HIL, null, "Solo Walk XI", 6);       // the registrar books this one
  const M2 = await mk(HIL, null, "Solo Walk Second XI", 7); // the coordinator books this one
  const M3 = await mk(WES, HIL, "Solo Walk Visitors", 8);   // another school hosts it
  ok("the stage is set", !!M1 && !!M2 && !!M3 && !!COORD);

  // ══ 1. The office verifies a link and records the agreement ═════════
  group("1. Squad → Edit Profile → Guardian links: the registrar verifies a link and records the agreement");
  const office = await open(); all.push(office);
  const { page } = office;
  ok("the registrar signs in", await signIn(page, "registrar@example.invalid"));
  ok("Squad opens", await go(page, "squad"));
  const side = tid(page, "squad-team-1XI");
  if ((await side.getAttribute("aria-pressed")) !== "true") { await side.click(); await page.waitForTimeout(500); }
  await tid(page, `squad-card-${BEKKER}`).click({ timeout: 6000 });
  await page.waitForTimeout(600);

  // Loading: the school's parents are asked for, and the screen says so while it waits.
  let release; const gate = new Promise((r) => { release = r; });
  // Left in place: once the gate is open every later read passes straight through.
  await page.route("**/api/read/assignments**", async (route) => { await gate; await route.continue(); });
  await tid(page, "player-edit-profile").click();
  ok("while the parents are read, it says so and offers nothing to pick", await wait(page, "guardian-links-loading", 4000) && await tid(page, "guardian-links-pick").count() === 0);
  release();
  ok("then the parents are offered", await wait(page, "guardian-links-pick"));

  const optionsOf = () => tid(page, "guardian-links-pick").evaluate((el) => [...el.options].map((o) => ({ v: o.value, t: o.textContent })));
  const opts = await optionsOf();
  ok("the registrar is offered the section", await tid(page, "guardian-links").count() === 1);
  ok("it names the child it is about", /T Bekker/.test(await inner(page, "guardian-links")));
  ok("...the pending parent is on the list, by name and address", opts.some((o) => o.v === PARENT && o.t === `A Walk Parent · solo.parent.${STAMP}@example.invalid`), JSON.stringify(opts.map((o) => o.t)));
  ok("...and so is the verified one", opts.some((o) => o.v === BEKKER_PARENT && /A Bekker/.test(o.t)));
  // The list is the school's live guardian appointments, one per person: held to the database.
  const guardiansNow = (await q(
    `select distinct a.person_id from role_assignment a
      where a.role = 'guardian' and a.active and a.school_id = $1
        and (a.valid_until is null or a.valid_until > current_date)`, [HIL])).map((r) => r.person_id).sort();
  ok("the parents on offer are exactly this school's live guardian appointments, once each",
     JSON.stringify(opts.filter((o) => o.v).map((o) => o.v).sort()) === JSON.stringify(guardiansNow), `${opts.length - 1} offered, ${guardiansNow.length} in the database`);
  ok("nothing can be done until a parent is chosen", await tid(page, "guardian-links-verify").count() === 0 && await tid(page, "guardian-links-consent").count() === 0);
  await keepsFloors("Guardian links", page, "guardian-links");

  // Refused: the agreement before there is a verified link.
  await tid(page, "guardian-links-pick").selectOption(PARENT);
  ok("with a parent chosen, the terms version is shown", /popia-2026-01/.test(await inner(page, "guardian-links-version")));
  await tid(page, "guardian-links-consent").click();
  const askC = await inner(page, "guardian-links-confirm");
  ok("the agreement asks first, naming the child, the parent and the version", /T Bekker/.test(askC) && /A Walk Parent/.test(askC) && /popia-2026-01/.test(askC), askC);
  await tid(page, "guardian-links-yes").click();
  ok("an agreement on a link not yet verified is refused in words", await wait(page, "guardian-links-refused") && /not verified yet/.test(await inner(page, "guardian-links-refused")), await inner(page, "guardian-links-refused"));
  ok("...nothing says it was recorded", !/Recorded\./.test(await inner(page, "guardian-links")));
  const l1 = await link(PARENT);
  ok("...and the row has not moved", l1?.v === "pending" && l1?.c === "pending" && !l1?.consent_version, JSON.stringify(l1));
  ok("...the parent stays chosen", await tid(page, "guardian-links-pick").inputValue() === PARENT);

  // Refused: verify a parent who has no link waiting.
  await tid(page, "guardian-links-pick").selectOption(BEKKER_PARENT);
  ok("changing the parent clears the last answer", await tid(page, "guardian-links-refused").count() === 0);
  await tid(page, "guardian-links-verify").click();
  await tid(page, "guardian-links-yes").click();
  ok("verifying a link that is not waiting is refused in words, naming both",
     await wait(page, "guardian-links-refused") && /A Bekker has no link to T Bekker waiting to be verified/.test(await inner(page, "guardian-links-refused")), await inner(page, "guardian-links-refused"));
  const bekkerAfter = await link(BEKKER_PARENT);
  ok("...his seeded guardian's link is exactly as it was", JSON.stringify(bekkerAfter) === JSON.stringify(bekkerBefore), JSON.stringify(bekkerAfter));

  // Cancel changes nothing and says nothing.
  await tid(page, "guardian-links-pick").selectOption(PARENT);
  await tid(page, "guardian-links-verify").click();
  const askV = await inner(page, "guardian-links-confirm");
  ok("verifying asks first, naming the child and the parent and what the act is", /Verify that A Walk Parent is a parent or guardian of T Bekker\?/.test(askV) && /paperwork/.test(askV), askV);
  await tid(page, "guardian-links-cancel").click();
  ok("cancelling closes the question and writes nothing", await tid(page, "guardian-links-confirm").count() === 0 && (await link(PARENT))?.v === "pending");

  // Failed: the request never arrives.
  await page.route("**/api/players/*/guardians/verify", (route) => route.abort());
  await tid(page, "guardian-links-verify").click();
  await tid(page, "guardian-links-yes").click();
  ok("a request that never arrives is a failure, in words, and not a refusal", await wait(page, "guardian-links-failed") && /Could not reach SCRBRD/.test(await inner(page, "guardian-links-failed")) && await tid(page, "guardian-links-refused").count() === 0, await inner(page, "guardian-links"));
  ok("...it says nothing was changed, and the row has not moved", /Nothing was changed/.test(await inner(page, "guardian-links-failed")) && (await link(PARENT))?.v === "pending");
  ok("...the form is kept, ready to try again", await tid(page, "guardian-links-pick").inputValue() === PARENT && await tid(page, "guardian-links-yes").isEnabled());
  await page.unroute("**/api/players/*/guardians/verify");

  // Verified.
  await tid(page, "guardian-links-yes").click();
  ok("verifying says so, by name, only once the server answered", await wait(page, "guardian-links-ok") && /Verified\. A Walk Parent's link to T Bekker is checked\./.test(await inner(page, "guardian-links-ok")), await inner(page, "guardian-links"));
  const l2 = await link(PARENT);
  ok("the row is verified, by the registrar, now", l2?.v === "verified" && l2?.verified_by && l2?.verified_at, JSON.stringify(l2));
  ok("...checked by the person who pressed it", l2?.verified_by === (await q(`select id from app_user where email = 'registrar@example.invalid'`))[0].id);
  ok("...with the family's agreement still to come", l2?.c === "pending" && !l2?.consent_version && !l2?.consent_at, JSON.stringify(l2));

  // Agreed.
  await tid(page, "guardian-links-consent").click();
  await tid(page, "guardian-links-yes").click();
  ok("recording the agreement says so, with the version", await wait(page, "guardian-links-ok") && /Recorded\. A Walk Parent agrees to the school's terms for T Bekker, version popia-2026-01\./.test(await inner(page, "guardian-links-ok")), await inner(page, "guardian-links"));
  const l3 = await link(PARENT);
  ok("the row holds the agreement, its version and its time", l3?.c === "granted" && l3?.consent_version === "popia-2026-01" && l3?.consent_at, JSON.stringify(l3));
  ok("...and the verification is the same one", l3?.verified_by === l2?.verified_by && String(l3?.verified_at) === String(l2?.verified_at));
  const kids = await (async () => {
    const t = await login(`solo.parent.${STAMP}@example.invalid`, "device-solo-parent");
    return (await call("/api/read/my_children", { token: t })).body?.rows ?? [];
  })();
  ok("...his own family's read now lists T Bekker's link as verified and agreed", kids.some((x) => x.player_id === BEKKER && x.verification_state === "verified" && x.consent_state === "granted"), JSON.stringify(kids));

  // A read that fails is not an empty list.
  await tid(page, "player-edit-profile").click();           // close
  const abortReads = (route) => route.abort();
  await page.route("**/api/read/assignments**", abortReads);   // the latest route is asked first
  await tid(page, "player-edit-profile").click();           // open again, and ask again
  ok("a read that fails says so and offers a way to read again, and is not 'no parents'",
     await wait(page, "guardian-links-unread") && /could not be read/.test(await inner(page, "guardian-links-unread")) && await tid(page, "guardian-links-none").count() === 0);
  await page.unroute("**/api/read/assignments**", abortReads);
  await tid(page, "guardian-links-reread").click();
  ok("...and reading again brings the parents back", await wait(page, "guardian-links-pick"));

  // Who is offered it.
  const dirc = await open(); all.push(dirc);
  ok("the director of sport signs in", await signIn(dirc.page, "sarah@example.invalid"));
  ok("Squad opens (director)", await go(dirc.page, "squad"));
  await tid(dirc.page, "squad-team-1XI").click().catch(() => {});
  await dirc.page.waitForTimeout(500);
  await tid(dirc.page, `squad-card-${BEKKER}`).click({ timeout: 6000 }).catch(() => {});
  await dirc.page.waitForTimeout(600);
  await tid(dirc.page, "player-edit-profile").click({ timeout: 4000 }).catch(() => {});
  await dirc.page.waitForTimeout(1500);
  ok("the director is on Edit Profile", await tid(dirc.page, "edit-profile").count() === 1);
  ok("...and is not offered Guardian links (she does not hold the capability)", await tid(dirc.page, "guardian-links").count() === 0 && !/Guardian links/.test(await inner(dirc.page, "edit-profile")));
  const coach = await open(); all.push(coach);
  ok("a coach signs in", await signIn(coach.page, "coach@example.invalid"));
  ok("Squad opens (coach)", await go(coach.page, "squad"));
  await tid(coach.page, `squad-card-${BEKKER}`).click({ timeout: 6000 }).catch(() => {});
  await coach.page.waitForTimeout(600);
  ok("the coach is offered neither Edit Profile nor Guardian links", await tid(coach.page, "player-edit-profile").count() === 0 && await tid(coach.page, "guardian-links").count() === 0);
  // The server says the same to a forced post: a coach may not verify or record.
  const coachToken = await login("coach@example.invalid", "device-solo-coach");
  const forced = await call(`/api/players/${BEKKER}/guardians/consent`, { method: "POST", token: coachToken, body: { guardianId: PARENT, consentVersion: "popia-2026-01" } });
  ok("a forced post by the coach is refused as not permitted", forced.status === 403 && forced.body?.error === "not_permitted", JSON.stringify(forced));

  // ══ 2. Booking a vehicle and a trip ════════════════════════════════
  group("2. Logistics → transport: the coordinator adds a vehicle and books a trip");
  const co = await open(); all.push(co);
  ok("the transport coordinator signs in", await signIn(co.page, COORD_EMAIL));
  // Loading: the fleet is asked for, and the panel says so while it waits.
  let release2; const gate2 = new Promise((r) => { release2 = r; });
  // Left in place: once the gate is open every later read passes straight through.
  await co.page.route("**/api/read/vehicles**", async (route) => { await gate2; await route.continue(); });
  ok("Logistics opens", await go(co.page, "logistics"));
  ok("while the fleet is read, the panel says so and offers nothing to book", await wait(co.page, "transport-book-loading", 4000) && await tid(co.page, "transport-add-vehicle-open").count() === 0);
  release2();
  ok("the Book a bus panel is offered to the coordinator", await wait(co.page, "transport-book"));
  await keepsFloors("Book a bus", co.page, "transport-book");
  ok("the fixture this school hosts is offered, with the sides and the day", /Solo Walk Second XI/.test(await inner(co.page, `trip-fixture-${M2}`)));
  ok("the fixture another school hosts is not offered", await tid(co.page, `trip-fixture-${M3}`).count() === 0);
  ok("...it is named in one plain sentence: a trip belongs to the host school", /hosted by another school/.test(await inner(co.page, "trip-elsewhere")) && /only that school books its bus/.test(await inner(co.page, "trip-elsewhere")), await inner(co.page, "trip-elsewhere"));
  const forcedAway = await call(`/api/matches/${M3}/trip`, { method: "POST", token: await login(COORD_EMAIL, "device-solo-coord"), body: { departAt: new Date().toISOString() } });
  ok("a forced booking for the other school's fixture is refused as not permitted, and writes nothing",
     forcedAway.status === 403 && forcedAway.body?.error === "not_permitted" && (await q(`select count(*)::int as n from trip where match_id = $1`, [M3]))[0].n === 0, JSON.stringify(forcedAway));

  // A vehicle.
  await tid(co.page, "transport-add-vehicle-open").click();
  await tid(co.page, "vehicle-save").click();
  ok("an empty vehicle form is told what is missing, and nothing is sent", await wait(co.page, "vehicle-problem", 3000) && /registration/.test(await inner(co.page, "vehicle-problem")) && (await q(`select count(*)::int as n from vehicle where registration like 'SOLO WALK%'`))[0].n === 0);
  const addVehicle = async (page, reg, desc, seats, insurance) => {
    await tid(page, "vehicle-registration").fill(reg);
    await tid(page, "vehicle-description").fill(desc);
    await tid(page, "vehicle-kind").selectOption("minibus");
    await tid(page, "vehicle-seats").fill(String(seats));
    await tid(page, "vehicle-insurance").fill(insurance);
    await tid(page, "vehicle-roadworthy").fill("2027-06-01");
    await tid(page, "vehicle-save").click();
  };
  await addVehicle(co.page, "SOLO WALK 1", "Walk minibus", 15, "2027-06-01");
  ok("adding a vehicle says so only after the server answered", await wait(co.page, "vehicle-ok") && /Added\. SOLO WALK 1 is on the register\./.test(await inner(co.page, "vehicle-ok")), await inner(co.page, "transport-add-vehicle"));
  const v1 = (await q(`select id, school_id, description, kind, capacity, active, insurance_expires_on::text as ins, roadworthy_expires_on::text as rw from vehicle where registration = 'SOLO WALK 1'`))[0];
  made.vehicles.push(v1?.id);
  ok("the vehicle is in the database, at this school, as typed", v1?.school_id === HIL && v1?.description === "Walk minibus" && v1?.kind === "minibus" && v1?.capacity === 15 && v1?.active === true && v1?.ins === "2027-06-01" && v1?.rw === "2027-06-01", JSON.stringify(v1));
  ok("the form is empty again for the next one", await tid(co.page, "vehicle-registration").inputValue() === "");
  await addVehicle(co.page, "solo walk 1", "Walk minibus", 16, "2027-06-01");
  ok("a registration already on the register is updated and says so", await wait(co.page, "vehicle-ok") && /already on the register, and has been updated/.test(await inner(co.page, "vehicle-ok")), await inner(co.page, "vehicle-ok"));
  const v1b = await q(`select id, capacity from vehicle where upper(registration) = 'SOLO WALK 1'`);
  ok("...one vehicle, now of sixteen seats", v1b.length === 1 && v1b[0].capacity === 16, JSON.stringify(v1b));
  await addVehicle(co.page, "SOLO WALK 2", "Walk minibus, cover lapsed", 15, "2026-01-01");
  ok("a vehicle with lapsed insurance can be put on the register", await wait(co.page, "vehicle-ok"));
  const v2 = (await q(`select id from vehicle where registration = 'SOLO WALK 2'`))[0];
  made.vehicles.push(v2?.id);
  await tid(co.page, "vehicle-close").click();

  // A trip. The coordinator cannot read the school's accounts, so no driver can be named.
  await tid(co.page, `trip-open-${M2}`).click();
  ok("the trip form opens for that fixture", await wait(co.page, `trip-form-${M2}`));
  ok("the coordinator reads no driver accounts, and is told the trip goes without one", await tid(co.page, "trip-driver").count() === 0 && /no driver/i.test(await inner(co.page, "trip-no-drivers")), await inner(co.page, `trip-form-${M2}`));
  const opts2 = await tid(co.page, "trip-vehicle").evaluate((el) => [...el.options].map((o) => o.textContent));
  ok("the vehicles offered are this school's own, with their seats and cover", opts2.some((t) => /SOLO WALK 1.* 16 seats · cover current/.test(t)) && opts2.some((t) => /SOLO WALK 2.*cover lapsed/.test(t)) && opts2.some((t) => /KZN 482 GP/.test(t)), JSON.stringify(opts2));
  await tid(co.page, "trip-book").click();
  ok("a trip with no vehicle is told so before anything is sent", await wait(co.page, "trip-problem", 3000) && /Choose the vehicle/.test(await inner(co.page, "trip-problem")));
  await tid(co.page, "trip-vehicle").selectOption(v1.id);
  await tid(co.page, "trip-book").click();
  ok("...or no departure", /when it leaves/.test(await inner(co.page, "trip-problem")));
  const d2 = await day(7);
  await tid(co.page, "trip-departs").fill(`${d2}T10:00`);
  await tid(co.page, "trip-returns").fill(`${d2}T09:00`);
  await tid(co.page, "trip-book").click();
  ok("...or a return before the departure", /before the departure/.test(await inner(co.page, "trip-problem")));
  await tid(co.page, "trip-returns").fill(`${d2}T17:00`);
  await tid(co.page, "trip-pickup").fill("Main gate");

  // Failed: no answer.
  await co.page.route(`**/api/matches/${M2}/trip`, (route) => route.abort());
  await tid(co.page, "trip-book").click();
  const conf = await inner(co.page, "trip-confirm");
  ok("it asks first, naming the vehicle and the fixture, and says a trip cannot be changed here yet", /Book SOLO WALK 1 for/.test(conf) && /Solo Walk Second XI/.test(conf) && /cannot be changed or cancelled here yet/.test(conf), conf);
  await tid(co.page, "trip-yes").click();
  ok("a request that never arrives is a failure in words, not a refusal", await wait(co.page, "trip-failed") && /Could not reach SCRBRD/.test(await inner(co.page, "trip-failed")) && await tid(co.page, "trip-refused").count() === 0, await inner(co.page, `trip-form-${M2}`));
  ok("...no trip is written, and what was typed is kept", (await q(`select count(*)::int as n from trip where match_id = $1`, [M2]))[0].n === 0
     && await tid(co.page, "trip-pickup").inputValue() === "Main gate" && await tid(co.page, "trip-vehicle").inputValue() === v1.id);
  await co.page.unroute(`**/api/matches/${M2}/trip`);

  // Refused: cover has lapsed.
  await tid(co.page, "trip-vehicle").selectOption(v2.id);
  await tid(co.page, "trip-book").click();
  await tid(co.page, "trip-yes").click();
  ok("a vehicle whose insurance has lapsed is refused in the database's words", await wait(co.page, "trip-refused") && /insurance expired on 2026-01-01/.test(await inner(co.page, "trip-refused")), await inner(co.page, "trip-refused"));
  ok("...no trip is written, nothing says booked, the form is kept", (await q(`select count(*)::int as n from trip where match_id = $1`, [M2]))[0].n === 0
     && !/Booked\./.test(await inner(co.page, "transport-book")) && await tid(co.page, "trip-pickup").inputValue() === "Main gate" && await tid(co.page, "trip-vehicle").inputValue() === v2.id);

  // Refused: more passengers than seats.
  await tid(co.page, "trip-vehicle").selectOption(KZN_14);
  await tid(co.page, "trip-seats").fill("15");
  await tid(co.page, "trip-book").click();
  await tid(co.page, "trip-yes").click();
  ok("fifteen on a fourteen-seater is refused in the database's words", await wait(co.page, "trip-refused") && /seats 14, and this trip names 15 passengers/.test(await inner(co.page, "trip-refused")), await inner(co.page, "trip-refused"));
  ok("...no trip is written", (await q(`select count(*)::int as n from trip where match_id = $1`, [M2]))[0].n === 0);

  // Booked.
  await tid(co.page, "trip-vehicle").selectOption(v1.id);
  await tid(co.page, "trip-seats").fill("14");
  await tid(co.page, "trip-book").click();
  await tid(co.page, "trip-yes").click();
  ok("a booking that works says so, naming the vehicle and the fixture", await wait(co.page, "book-ok") && /Booked\. SOLO WALK 1 is booked for .*Solo Walk Second XI/.test(await inner(co.page, "book-ok")), await inner(co.page, "transport-book"));
  const [trip] = await q(`select t.vehicle_id, t.driver_id, t.school_id, t.arranged_by, t.seats_taken, t.pickup, t.depart_at, t.return_at from trip t where t.match_id = $1`, [M2]);
  ok("the trip is in the database: this fixture, this vehicle, this school, this many seats, this pick-up", trip?.vehicle_id === v1.id && trip?.school_id === HIL && trip?.seats_taken === 14 && trip?.pickup === "Main gate", JSON.stringify(trip));
  ok("...arranged by the coordinator who booked it, with no driver named", trip?.arranged_by === COORD && trip?.driver_id === null);
  ok("...and the departure is the minute typed", trip && Math.abs(new Date(trip.depart_at) - new Date(`${d2}T10:00`)) < 1000 && Math.abs(new Date(trip.return_at) - new Date(`${d2}T17:00`)) < 1000, JSON.stringify(trip));
  ok("the fixture has left the 'no bus yet' list", await tid(co.page, `trip-fixture-${M2}`).count() === 0);
  await co.page.waitForFunction((id) => /SOLO WALK 1/.test(document.querySelector('[data-testid="os-main"]')?.innerText ?? ""), M2, { timeout: 8000 }).catch(() => {});
  ok("...and its trip is on the page, from the server's re-read", /SOLO WALK 1/.test(await inner(co.page, "os-main")), (await inner(co.page, "os-main")).slice(0, 400));
  const dupe = await call(`/api/matches/${M2}/trip`, { method: "POST", token: await login(COORD_EMAIL, "device-solo-coord"), body: { vehicleId: v1.id, departAt: new Date().toISOString() } });
  ok("...forced, it is a 409 vehicle_already_on_this_fixture", dupe.status === 409 && dupe.body?.error === "vehicle_already_on_this_fixture", JSON.stringify(dupe));
  ok("Logistics keeps the floors at desktop", (await floors(co.page, "transport-book")).small.length === 0);

  // The registrar holds the capability too, and can read the drivers.
  group("2b. The registrar books a trip and names the driver");
  ok("Logistics opens (registrar)", await go(page, "logistics"));
  ok("the Book a bus panel is offered to the registrar", await wait(page, "transport-book"));
  ok("the fixture the coordinator booked is not offered again; the other hosted one is", await tid(page, `trip-fixture-${M2}`).count() === 0 && await tid(page, `trip-fixture-${M1}`).count() === 1);
  await tid(page, `trip-open-${M1}`).click();
  ok("the registrar reads the driver accounts, and is offered the seeded driver", await wait(page, "trip-driver") && (await tid(page, "trip-driver").evaluate((el) => [...el.options].map((o) => o.textContent))).includes("B Ngcobo"));
  const driver = (await q(`select id from app_user where email = 'driver@example.invalid'`))[0].id;
  await tid(page, "trip-vehicle").selectOption(KZN_14);
  await tid(page, "trip-driver").selectOption(driver);
  await tid(page, "trip-departs").fill(`${await day(6)}T08:30`);
  await tid(page, "trip-seats").fill("12");
  await tid(page, "trip-book").click();
  await tid(page, "trip-yes").click();
  ok("the booking says so", await wait(page, "book-ok") && /Booked\. KZN 119 KP is booked for/.test(await inner(page, "book-ok")), await inner(page, "transport-book"));
  const [trip1] = await q(`select vehicle_id, driver_id, arranged_by, seats_taken from trip where match_id = $1`, [M1]);
  const registrarId = (await q(`select id from app_user where email = 'registrar@example.invalid'`))[0].id;
  ok("the trip names the driver and the registrar who arranged it", trip1?.vehicle_id === KZN_14 && trip1?.driver_id === driver && trip1?.arranged_by === registrarId && trip1?.seats_taken === 12, JSON.stringify(trip1));
  const driverToken = await login("driver@example.invalid", "device-solo-driver");
  const dMine = await call(`/api/read/trips?matchId=${M1}`, { token: driverToken });
  ok("the driver now has that trip", dMine.status === 200 && dMine.body?.rows?.length === 1, JSON.stringify(dMine.body).slice(0, 200));

  // Who is not offered it.
  const dir2 = await open(); all.push(dir2);
  ok("the director of sport signs in", await signIn(dir2.page, "sarah@example.invalid"));
  ok("Logistics opens (director)", await go(dir2.page, "logistics"));
  await dir2.page.waitForTimeout(800);
  ok("the director sees the transport page and is not offered Book a bus", await tid(dir2.page, "os-main").count() === 1 && /upcoming away trips/i.test(await inner(dir2.page, "os-main")) && await tid(dir2.page, "transport-book").count() === 0 && await tid(dir2.page, "transport-add-vehicle-open").count() === 0);
  const dirToken = await login("sarah@example.invalid", "device-solo-dir");
  const forcedVehicle = await call("/api/vehicles", { method: "POST", token: dirToken, body: { schoolId: HIL, registration: "SOLO FORCED", description: "x", kind: "minibus", capacity: 10 } });
  ok("a forced vehicle by the director is refused, and writes nothing", forcedVehicle.status === 403 && (await q(`select count(*)::int as n from vehicle where registration = 'SOLO FORCED'`))[0].n === 0, JSON.stringify(forcedVehicle));
  const demo = await open();
  all.push(demo);
  ok("a demonstration (nobody signed in) is offered no booking", await tid(demo.page, "transport-book").count() === 0);

  // On a phone.
  const ph = await open({ width: 390, height: 844 }); all.push(ph);
  ok("the coordinator signs in on a phone", await signIn(ph.page, COORD_EMAIL));
  ok("Logistics opens on the phone", await go(ph.page, "logistics"));
  ok("Book a bus is on the phone", await wait(ph.page, "transport-book"));
  await tid(ph.page, "transport-add-vehicle-open").click();
  await ph.page.waitForTimeout(300);
  await keepsFloors("Book a bus on a phone", ph.page, "transport-book");

  // ══ 3. Sign out everywhere ═════════════════════════════════════════
  group("3. Settings → Me: sign out everywhere");
  const SELF = "coach2@example.invalid";
  const selfId = (await q(`select id from app_user where email = $1`, [SELF]))[0].id;
  const other = await login(SELF, "device-solo-other");
  const epoch = async () => (await q(`select epoch, reason, bumped_by from auth_epoch where user_id = $1`, [selfId]))[0] ?? { epoch: 0 };
  const e0 = await epoch();
  ok("another device holds a working sign-in", (await call("/api/session", { token: other })).status === 200);
  const me = await open(); all.push(me);
  ok("the coach signs in", await signIn(me.page, SELF));
  ok("Settings opens", await go(me.page, "settings"));
  await me.page.getByRole("tab", { name: /^Me/ }).click();
  await me.page.waitForTimeout(800);
  ok("Sign out everywhere is on Me, beside Ways to sign in", await wait(me.page, "sign-out-everywhere") && await tid(me.page, "sign-ins").count() === 1);
  ok("it says what it does before it is pressed", /every phone, tablet and computer/.test(await inner(me.page, "sign-out-everywhere")));
  ok("the question has not been asked yet", await tid(me.page, "sign-out-everywhere-confirm").count() === 0);
  await keepsFloors("Sign out everywhere", me.page, "sign-out-everywhere");
  let posts = 0;
  me.page.on("request", (r) => { if (r.method() === "POST" && /sign-out-everywhere/.test(r.url())) posts++; });
  await tid(me.page, "sign-out-everywhere-ask").click();
  ok("it asks, in these words", (await inner(me.page, "sign-out-everywhere-confirm")).includes("This signs you out on every device, including this one."), await inner(me.page, "sign-out-everywhere-confirm"));
  await keepsFloors("The question", me.page, "sign-out-everywhere");
  await tid(me.page, "sign-out-everywhere-no").click();
  ok("Stay signed in sends nothing and changes nothing", posts === 0 && await tid(me.page, "sign-out-everywhere-confirm").count() === 0 && (await epoch()).epoch === e0.epoch && (await call("/api/session", { token: other })).status === 200);

  // Failed: the request never arrives.
  await me.page.route("**/api/auth/sign-out-everywhere", (route) => route.abort());
  await tid(me.page, "sign-out-everywhere-ask").click();
  await tid(me.page, "sign-out-everywhere-yes").click();
  ok("a request that never arrives is a failure in words, and nobody is signed out", await wait(me.page, "sign-out-everywhere-failed") && /Could not reach SCRBRD, so nobody was signed out/.test(await inner(me.page, "sign-out-everywhere-failed")), await inner(me.page, "sign-out-everywhere"));
  ok("...this device is still signed in, and so is the other", await tid(me.page, "os-main").count() === 1 && (await epoch()).epoch === e0.epoch && (await call("/api/session", { token: other })).status === 200);
  ok("...the question stays, to try again", await tid(me.page, "sign-out-everywhere-yes").isEnabled());
  await me.page.unroute("**/api/auth/sign-out-everywhere");

  // OK: this device follows the server.
  await tid(me.page, "sign-out-everywhere-yes").click();
  await me.page.waitForSelector("#login-email, [data-testid='login-email']", { timeout: 8000 }).catch(() => {});
  await me.page.waitForTimeout(800);
  ok("once the server answers OK, this device is signed out: the sign-in screen is shown", await tid(me.page, "os-main").count() === 0 && (await me.page.locator("#login-email").count() > 0 || /Sign In|Log in|Continue with Google/i.test(await me.page.$eval("body", (e) => e.innerText))));
  const e1 = await epoch();
  ok("the database moved the epoch, for this person, by this person, and says why", e1.epoch === e0.epoch + 1 && e1.reason === "signed_out_everywhere" && e1.bumped_by === selfId, JSON.stringify(e1));
  ok("another device's token is refused on its next request", (await call("/api/session", { token: other })).status === 401);
  ok("one request was made", posts === 1 || posts === 2, String(posts));
  const me2 = await open(); all.push(me2);
  ok("the same person can sign in again", await signIn(me2.page, SELF));
  ok("...and has a working session under the new epoch", (await call("/api/session", { token: await login(SELF, "device-solo-after") })).status === 200);
  // An unrelated person is untouched.
  ok("nobody else was signed out: the coach who was not asked still has her session", (await call("/api/session", { token: coachToken })).status === 200);

  for (const [who, c] of [["office", office], ["director", dirc], ["coach", coach], ["coordinator", co], ["registrar's director", dir2], ["phone", ph], ["person", me], ["person again", me2]]) {
    ok(`the ${who}'s session raised no page errors`, c.errors.length === 0, c.errors.slice(0, 2).join(" · "));
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e);
} finally {
  const quiet = (p) => p.catch(() => {});
  await quiet(q(`delete from trip where match_id = any($1)`, [made.matches]));
  await quiet(q(`delete from match where id = any($1)`, [made.matches]));
  await quiet(q(`delete from vehicle where registration like 'SOLO WALK%'`));
  await quiet(q(`delete from assignment_subject where assignment_id in (select id from role_assignment where person_id = any($1))`, [made.users]));
  await quiet(q(`delete from role_assignment where person_id = any($1)`, [made.users]));
  // An account that has signed in is on the access log, which keeps it: it is set aside, not deleted.
  await quiet(q(`update app_user set active = false where id = any($1)`, [made.users]));
  for (const c of all) await c.ctx.close().catch(() => {});
  await browser.close();
  await pool.end();
  web.close();
  apiProc.kill();
}

if (apiErr.join("").match(/Error/)) console.log(apiErr.join("").slice(0, 1500));
console.log("\n" + "─".repeat(52));
console.log(`BROWSER SOLO SCREENS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

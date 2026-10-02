#!/usr/bin/env node
/**
 * Management → Users, on the real directory, from a browser.
 *
 * The screen used to show one role per person, and its Add / Edit / Promote /
 * Suspend / Delete changed React state and nothing else: reload and they were
 * gone. It now reads the `users` and `assignments` reads, shows each person
 * with every role they hold, and saves Add user / Add role through POST
 * /api/users — the call Settings → People makes — so what is asked of this walk
 * is what a school office would ask of the screen:
 *
 *   1. Signed in as the school admin, a seeded person appears with EVERY role
 *      they hold — live ones as chips with their side, ended ones muted and
 *      labelled "ended" in words (a fixture dates two out, on named days) —
 *      checked against role_assignment itself, not against the screen's idea.
 *   2. The filters work over all of a person's roles, ended ones included.
 *   3. "Add role" gives that same person a second role; the form opens with
 *      the name and email fixed; a fresh load shows both roles, and Postgres
 *      holds one account with both appointments — not a second account.
 *   4. A role the caller may not grant is not offered; a post forced past the
 *      picker is refused by the server, and the screen says so in words,
 *      beside the form, never as a code; nothing is written.
 *   5. The fake actions are gone, the plain line is there, and a person who
 *      cannot assign roles is offered nothing to write with.
 *   6. Nobody signed in (the demonstration): the seeded directory, one role
 *      each, and nothing offered that would write.
 *   7. The floors: no rendered text under 12px, nothing tapped under 44px,
 *      no sideways page scroll at 390 wide.
 *   8. The tabs a person has are the capabilities they hold (checked against
 *      the policy itself, not against a list in this file): a registrar, a
 *      principal, a director of sport, and a groundskeeper.
 *   9. No invented text: the audit log is the school's own (db/79) — a child
 *      in initials, no safeguarding row, reading it on the record, a filter
 *      by kind and by date, roles granted beside roles ended (db/80), one plain line when nothing matches, and in the
 *      demonstration only "Sign in to see the audit log" — and Ground tasks are
 *      the fixtures at the grounds the reader may see, with the pitch report's
 *      standing from the database — and one plain line when there are none.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-management.mjs
 *   BROWSER_MANAGEMENT_DEBUG=1 node tools/smoke-browser-management.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { roleGrants } from "../packages/policy/src/roles.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const WEB_PORT = port(4372);
const API_PORT = port(8912);
const API = `http://127.0.0.1:${API_PORT}`;
const DB = ownerUrl();
const DEBUG = !!process.env.BROWSER_MANAGEMENT_DEBUG;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const VERBOSE = !!process.env.BROWSER_MANAGEMENT_VERBOSE;
const ok = (n, c, d = "") => { if (c) { pass++; if (VERBOSE) console.log("  ✓", n); } else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-management-secret",
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
const q = async (text, params) => (await pool.query(text, params)).rows;
const heldIn = (email, school = null) => q(
  `select a.role, a.team_code, a.active, a.valid_until::text as valid_until
     from role_assignment a join app_user u on u.id = a.person_id
    where u.email = $1 and ($2::uuid is null or a.school_id = $2) order by a.created_at, a.role`, [email, school]);
const accountsFor = (email) => q(`select id from app_user where lower(email) = lower($1)`, [email]);

const browser = await chromium.launch({ ...launchOptions() });

async function open(apiBase = API, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await offline(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // A refusal the walk forces on purpose is the browser logging a 403.
    if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(apiBase)};`);
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
async function signIn(page, email, password = "") {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  const re = new RegExp(email.replace(/[.]/g, "\\."));
  if (!(await click(page, re, 3000))) await page.fill("#login-email", email);
  if (password) await page.fill("#login-password", password);
  await click(page, /^Sign In$/, 5000);
  await page.waitForTimeout(2000);
  return /Match Centre|Dashboard/i.test(await text(page));
}
/** To Management → Users, waiting for the list to be drawn rather than for a clock. */
async function toUsers(page) {
  const nav = tid(page, "nav-management").first();
  if (!(await nav.count())) return false;
  try { await nav.click({ timeout: 6000 }); } catch { return false; }
  try { await tid(page, "people-panel").waitFor({ timeout: 10000 }); } catch { return false; }
  try { await page.locator('[data-testid^="person-row-"]').first().waitFor({ timeout: 10000 }); } catch { return false; }
  await page.waitForTimeout(600);
  return true;
}
const rowOf = (page, email) => page.locator(`[data-testid^="person-row-"][data-email="${email}"]`);
/** [{ role, state, text }] for the chips in one person's row. */
const chips = (row) => row.locator('[data-testid="role-chip"]').evaluateAll((els) =>
  els.map((e) => ({ role: e.getAttribute("data-role"), state: e.getAttribute("data-state"), text: e.innerText.replace(/\s+/g, " ").trim(),
                    dashed: getComputedStyle(e).borderTopStyle === "dashed" })));

/** Rendered text under 12px, and things tapped under 44px, inside one element. */
const floors = (page, selector) => page.evaluate((sel) => {
  const root = document.querySelector(sel);
  if (!root) return { small: ["(no such root)"], taps: ["(no such root)"] };
  const small = [], taps = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 12) small.push(`${px}px "${n.nodeValue.trim().slice(0, 30)}"`);
  }
  for (const el of root.querySelectorAll("button, a[href], select, textarea, input:not([type=hidden]), [role=button]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // A checkbox is tapped through its label, which is the 44px target.
    const box = el.type === "checkbox" ? el.closest("label").getBoundingClientRect() : r;
    if (box.height < 43.5 || box.width < 43.5) taps.push(`${Math.round(box.width)}x${Math.round(box.height)} ${(el.innerText || el.getAttribute("aria-label") || el.type || el.tagName).slice(0, 24)}`);
  }
  return { small, taps };
}, selector);

const SARAH = "sarah@example.invalid";
const PILLAY = "pillay@example.invalid";
const WESSELS = "scorer@example.invalid";          // A Wessels: a scorer, one role
const NDLOVU_B = "registrar.wes@example.invalid";   // T Ndlovu at Westville: not this school's to see
// The capability that opens each tab. This is the screen's own table, restated
// so the walk can ask the POLICY who should have each tab and hold the screen to it.
const TAB_CAP = { users: "user.role.assign", squad: "team.manage", fixtures: "fixture.create",
                  broadcast: "broadcast.publish", audit: "audit.read", grounds: "facility.manage" };
const tabsFor = (role) => Object.keys(TAB_CAP).filter((id) => roleGrants(role, TAB_CAP[id]));
const tabsShown = (page) => page.locator('[data-testid^="mgmt-tab-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("mgmt-tab-", "")));
const INVENTED = /Updated fixture|Added training session|role changed|scorecard submitted|Medical clearance|New user created|Coaching Asst|Pretorius|Irrigation|Roll and mark|Outfield mowing|Prepare Main Oval|Mzimba|Hadebe/;
const HIL_OVAL = "ffffffff-0000-0000-0000-000000000001";
const NOT_OFFERED = ["medical", "finance", "sponsorship", "principal", "directorofsport", "dso", "sportsadmin", "superadmin", "platformadmin", "fitness"];

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Two appointments the seed does not have, on named days: one dated out last
  // season, one withdrawn in March. Fixtures take explicit dates.
  await q(`insert into role_assignment (person_id, role, school_id, team_code, valid_from, valid_until)
           select id, 'assistantcoach', school_id, '1XI', date '2025-01-01', date '2025-12-31' from app_user where email = $1`, [SARAH]);
  // A withdrawal is stamped with now() by role_assignment_revoke_guard, so a
  // withdrawal on a NAMED day is made with that one trigger off, in one transaction.
  {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(`insert into role_assignment (person_id, role, school_id, team_code, valid_from)
                     select id, 'teammanager', school_id, '2XI', date '2025-01-01' from app_user where email = $1`, [SARAH]);
      await c.query("alter table role_assignment disable trigger role_assignment_revoke_guard");
      await c.query(`update role_assignment set active = false, revoked_at = timestamptz '2026-03-12 08:00+00'
                      where role = 'teammanager' and person_id = (select id from app_user where email = $1)`, [SARAH]);
      await c.query("alter table role_assignment enable trigger role_assignment_revoke_guard");
      await c.query("commit");
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  }
  // A second account with the same name at the same school: two people, not one.
  await q(`with u as (insert into app_user (school_id, email, name, role)
                      select school_id, 'sarah.twin@example.invalid', 'Sarah Mokoena', 'coach' from app_user where email = $1 returning id, school_id)
           insert into role_assignment (person_id, role, school_id, team_code) select id, 'coach', school_id, 'U15A' from u`, [SARAH]);

  // Two fixtures at the Hilton oval on named days, long after any run of this
  // walk; the first has a pitch report on file, the second has not.
  const FX_A = "77777777-0000-0000-0000-0000000000a1", FX_B = "77777777-0000-0000-0000-0000000000a2";
  const [{ school_id: HILTON }] = await q(`select school_id from app_user where email = 'registrar@example.invalid'`);
  await q(`insert into match (id, school_id, team_code, opponent, ground_id, starts_at, format, overs, status) values
             ($1, $3, '1XI', 'Walk Opponent A', $4, timestamptz '2099-03-14 09:00+00', 'T20', 20, 'scheduled'),
             ($2, $3, 'U16B', 'Walk Opponent B', $4, timestamptz '2099-03-21 09:30+00', 'T20', 20, 'scheduled')`, [FX_A, FX_B, HILTON, HIL_OVAL]);
  await q(`insert into match_pitch_report (match_id, school_id, surface, grass) values ($1, $2, 'firm', 'light')`, [FX_A, HILTON]);

  // ── 1. Every role a person holds ─────────────────────────────────
  group("Signed in as the school admin, a person appears with every role they hold");
  const off = await open();
  ok("the registrar signs in", await signIn(off.page, "registrar@example.invalid"));
  ok("...and reaches Management → Users", await toUsers(off.page));
  const panel = tid(off.page, "people-panel");
  ok("the list is the real directory — the seeded people are there", (await off.page.locator('[data-testid^="person-row-"]').count()) >= 15);

  const sarahRow = rowOf(off.page, SARAH);
  ok("Sarah Mokoena is on the list once", await sarahRow.count() === 1);
  const sarahChips = await chips(sarahRow);
  const sarahDb = await heldIn(SARAH, HILTON);
  const liveDb = sarahDb.filter((a) => a.active && !(a.valid_until && a.valid_until <= "2026-10-01")).map((a) => a.role).sort();
  const liveShown = sarahChips.filter((c) => c.state === "live").map((c) => c.role).sort();
  if (DEBUG) console.log("[debug] sarah chips:", JSON.stringify(sarahChips), "db:", JSON.stringify(sarahDb));
  ok("...with every role the database says she holds now (more than one)", liveShown.length > 1 && JSON.stringify(liveShown) === JSON.stringify(liveDb),
     `${liveShown} vs ${liveDb}`);
  ok("...a coach of a named side shows the side", sarahChips.some((c) => c.role === "coach" && /Coach/.test(c.text) && /U16B/.test(c.text)), JSON.stringify(sarahChips));
  ok("...and a director of sport, as a second role", sarahChips.some((c) => c.role === "directorofsport" && c.state === "live"));
  ok("...and a guardian, as a third", sarahChips.some((c) => c.role === "guardian" && c.state === "live"));

  const ended = sarahChips.filter((c) => c.state === "ended");
  ok("the two ended roles are shown, not hidden", ended.length === 2 && ended.some((c) => c.role === "assistantcoach") && ended.some((c) => c.role === "teammanager"), JSON.stringify(ended));
  ok("...each labelled \"ended\" in words", ended.length > 0 && ended.every((c) => /\bended\b/.test(c.text)), JSON.stringify(ended));
  ok("...with the day it ended, as dated", ended.find((c) => c.role === "assistantcoach")?.text.includes("31 Dec")
     && ended.find((c) => c.role === "teammanager")?.text.includes("12 Mar"), JSON.stringify(ended));
  ok("...and drawn differently from a live one (dashed), as well as worded", ended.length > 0 && ended.every((c) => c.dashed) && liveShown.length > 0 && sarahChips.filter((c) => c.state === "live").every((c) => !c.dashed));
  ok("...a live role does not say \"ended\"", liveShown.length > 0 && sarahChips.filter((c) => c.state === "live").every((c) => !/\bended\b/.test(c.text)));
  ok("...ended roles come after the live ones", sarahChips.map((c) => c.state).join(",").replace(/live,?/g, "L").replace(/ended,?/g, "E").replace(/L+/, "L").replace(/E+/, "E") === "LE",
     sarahChips.map((c) => c.state).join(","));

  const pil = await chips(rowOf(off.page, PILLAY));
  ok("a pupil shows his team role with his side, and his own-record access", pil.some((c) => c.role === "player" && /1XI/.test(c.text)) && pil.some((c) => c.role === "selfaccess" && /own record/.test(c.text)), JSON.stringify(pil));
  ok("two accounts of one name at one school are two rows, each with its own roles",
     await rowOf(off.page, SARAH).count() === 1 && await rowOf(off.page, "sarah.twin@example.invalid").count() === 1
     && (await chips(rowOf(off.page, "sarah.twin@example.invalid"))).length === 1);
  ok("a person at another school is not on this school's list", await rowOf(off.page, NDLOVU_B).count() === 0 && await rowOf(off.page, "coach.wes@example.invalid").count() === 0);
  ok("the count of people with more than one role is drawn", /With more than one role/.test(await panel.innerText()));

  // ── 2. The filters ───────────────────────────────────────────────
  group("The filters work over all of a person's roles");
  const shownEmails = () => off.page.locator('[data-testid^="person-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-email")));
  await tid(off.page, "people-role-filter").selectOption("directorofsport");
  await off.page.waitForTimeout(300);
  ok("by a role that is not her first: the director of sport is Sarah", JSON.stringify(await shownEmails()) === JSON.stringify([SARAH]), (await shownEmails()).join());
  await tid(off.page, "people-role-filter").selectOption("teammanager");
  await off.page.waitForTimeout(300);
  ok("by a role she no longer holds: she was a team manager", JSON.stringify(await shownEmails()) === JSON.stringify([SARAH]), (await shownEmails()).join());
  await tid(off.page, "people-role-filter").selectOption("all");
  await tid(off.page, "people-search").fill("u16b");
  await off.page.waitForTimeout(300);
  ok("search finds a side", JSON.stringify(await shownEmails()) === JSON.stringify([SARAH]), (await shownEmails()).join());
  await tid(off.page, "people-search").fill("Director of Sport");
  await off.page.waitForTimeout(300);
  ok("...and a role by the words on screen", (await shownEmails()).includes(SARAH));
  await tid(off.page, "people-search").fill("pillay@");
  await off.page.waitForTimeout(300);
  ok("...and an email", JSON.stringify(await shownEmails()) === JSON.stringify([PILLAY]), (await shownEmails()).join());
  await tid(off.page, "people-search").fill("zzzz-nobody");
  await off.page.waitForTimeout(300);
  ok("a filter that matches no one says so", /No one matches the current filter/.test(await panel.innerText()));
  await tid(off.page, "people-search").fill("");
  await tid(off.page, "people-status-filter").selectOption("inactive");
  await off.page.waitForTimeout(300);
  ok("status: nobody on the seeded list is inactive", (await shownEmails()).length === 0);
  await tid(off.page, "people-status-filter").selectOption("all");
  await off.page.waitForTimeout(300);

  // ── 5a. What is no longer there ──────────────────────────────────
  group("The fake actions are gone, and one plain line says what is coming");
  const buttons = await off.page.locator('[data-testid="os-main"] button').allInnerTexts();
  ok("no Edit, Promote, Suspend, Restore or Delete anywhere on the screen", !buttons.some((b) => /^(Edit|Promote|Suspend|Restore|Delete)\b/i.test(b.trim())), buttons.join(" | "));
  ok("no per-row status toggle or role dropdown on a row: only Add role, and End role beside each live appointment",
     await sarahRow.locator("select").count() === 0
     && (await sarahRow.locator("button").allInnerTexts()).every((t) => /^(Add role|End role)$/.test(t.trim()))
     && await sarahRow.locator('[data-testid^="add-role-"]').count() === 1,
     (await sarahRow.locator("button").allInnerTexts()).join(" | "));
  ok("the line is there, word for word", (await tid(off.page, "people-coming").innerText()).trim() === "Suspending an account is coming.");

  // ── 7a. The floors, on the list ──────────────────────────────────
  group("The list is on the 12px and 44px floors");
  const fl = await floors(off.page, '[data-testid="people-panel"]');
  ok("no text under 12px in the list", fl.small.length === 0, fl.small.slice(0, 5).join(" | "));
  ok("nothing tapped under 44px in the list", fl.taps.length === 0, fl.taps.slice(0, 5).join(" | "));

  // ── 8a. Tabs, for the registrar ──────────────────────────────────
  group("The registrar's tabs are the capabilities the policy gives her");
  const regTabs = await tabsShown(off.page);
  ok("they are exactly the ones the policy says a school admin earns", JSON.stringify(regTabs) === JSON.stringify(tabsFor("schooladmin")), regTabs.join());
  ok("...which does not include Broadcast, which she does not hold", !regTabs.includes("broadcast") && !roleGrants("schooladmin", "broadcast.publish"));
  const tf = await floors(off.page, '[role="group"][aria-label="Management sections"]');
  ok("the tab strip is on the 12px and 44px floors", tf.small.length === 0 && tf.taps.length === 0, tf.small.concat(tf.taps).slice(0, 4).join(" | "));

  group("The audit log is the school's own, a child in initials, and reading it is on it");
  // A pupil made up for this walk reads his own record, and the DSO reads a
  // concern: both filed as log_restricted_read() files them, a minute ago.
  const [walkBoy] = await q(`insert into player (school_id, team_code, full_name, surname, squad_no, playing_role, born)
     values ($1, 'U15A', 'Walkbrowser Mgmt Pupil', 'Pupil', 978, 'batter', current_date - interval '15 years') returning id`, [HILTON]);
  const [walkBoyUser] = await q(`insert into app_user (school_id, email, name, role, player_id)
     values ($1, 'mgmt.walk.pupil@example.invalid', 'Walkbrowser Mgmt Pupil', 'player', $2) returning id`, [HILTON, walkBoy.id]);
  await q(`insert into access_log (school_id, person_id, resource, record_ids, record_count, fields, occurred_at)
           values ($1, $2, 'players', array[$3::uuid], 1, '{born}', now() - interval '1 minute'),
                  ($1, $2, 'safeguarding_concern', array[gen_random_uuid()], 1, '{account}', now() - interval '1 minute')`,
          [HILTON, walkBoyUser.id, walkBoy.id]);
  const readsBefore = Number((await q(`select count(*) from access_log l join app_user u on u.id = l.person_id
     where l.resource = 'audit_log' and u.email = 'registrar@example.invalid'`))[0].count);
  if (await tid(off.page, "mgmt-tab-audit").count()) await tid(off.page, "mgmt-tab-audit").click({ timeout: 5000 });
  await tid(off.page, "audit-rows").waitFor({ timeout: 10000 }).catch(() => {});
  ok("she holds audit.read, so the tab opens on the log", await tid(off.page, "audit-log").count() === 1);
  ok("...the line that it is coming is gone", await tid(off.page, "audit-coming").count() === 0);
  const auditText = await tid(off.page, "audit-log").innerText().catch(() => "");
  ok("...it lists entries", await off.page.locator('[data-testid="audit-row"]').count() > 0, auditText.slice(0, 300));
  ok("...the boy's read of his own record, by initials", /W M Pupil/.test(auditText), auditText.slice(0, 400));
  ok("...and his name nowhere whole", !/Walkbrowser Mgmt/.test(auditText));
  ok("...no safeguarding row", !/safeguarding/i.test(auditText));
  ok("...no invented entry, no medical clearance", !INVENTED.test(await tid(off.page, "os-main").innerText()), (await tid(off.page, "os-main").innerText()).slice(0, 300));
  const readsAfter = Number((await q(`select count(*) from access_log l join app_user u on u.id = l.person_id
     where l.resource = 'audit_log' and u.email = 'registrar@example.invalid'`))[0].count);
  ok("her reading it is on the record", readsAfter >= readsBefore + 1, `${readsBefore} → ${readsAfter}`);
  const af = await floors(off.page, '[data-testid="audit-log"]');
  ok("the log is on the 12px and 44px floors", af.small.length === 0 && af.taps.length === 0, af.small.concat(af.taps).slice(0, 4).join(" | "));
  await tid(off.page, "audit-kind").selectOption("access");
  await off.page.waitForTimeout(1200);
  const kinds = await off.page.locator('[data-testid="audit-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
  ok("filtered by kind, it lists that kind alone", kinds.length > 0 && kinds.every((k) => k === "access"), kinds.join());
  // Roles granted as well as ended (db/80): the seed's appointments were made
  // by nobody, and the tab says the system made them.
  await tid(off.page, "audit-kind").selectOption("role");
  await off.page.waitForTimeout(1200);
  const roleKinds = await off.page.locator('[data-testid="audit-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
  const roleText = await tid(off.page, "audit-log").innerText().catch(() => "");
  ok("filtered to roles, it lists roles alone", roleKinds.length > 0 && roleKinds.every((k) => k === "role"), roleKinds.join());
  ok("...a role granted among them, by the system when nobody made it", /The system · Granted a role: /.test(roleText), roleText.slice(0, 400));
  ok("...and no free text, no invented entry", !INVENTED.test(roleText));
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await tid(off.page, "audit-from").fill(tomorrow);
  await tid(off.page, "audit-none").waitFor({ timeout: 8000 }).catch(() => {});
  ok("filtered to a day still to come, it says so in one plain line",
     (await tid(off.page, "audit-none").innerText().catch(() => "")).trim() === "Nothing on the audit log for this filter.");

  group("Ground tasks are the fixtures at the grounds, with the pitch report from the database");
  if (await tid(off.page, "mgmt-tab-grounds").count()) await tid(off.page, "mgmt-tab-grounds").click({ timeout: 5000 });
  await off.page.waitForTimeout(1500);
  const duties = off.page.locator('[data-testid="ground-duty"]');
  const dutyIds = await duties.evaluateAll((els) => els.map((e) => e.getAttribute("data-match-id")));
  const upcomingDb = (await q(`select id from match where school_id = $1 and status in ('scheduled', 'live') and starts_at >= now() - interval '1 day'`, [HILTON])).map((r) => r.id);
  ok("every fixture still to be played at her grounds is listed, and nothing else", JSON.stringify([...dutyIds].sort()) === JSON.stringify([...upcomingDb].sort()) && dutyIds.length >= 2,
     `${dutyIds.length} shown, ${upcomingDb.length} in the database`);
  ok("...the two the walk dated are among them", dutyIds.includes(FX_A) && dutyIds.includes(FX_B));
  const dA = await off.page.locator(`[data-match-id="${FX_A}"]`).innerText({ timeout: 3000 }).catch(() => "(not listed)");
  const dB = await off.page.locator(`[data-match-id="${FX_B}"]`).innerText({ timeout: 3000 }).catch(() => "(not listed)");
  ok("...each names the ground and the day, from the fixture", /Gordon Sherwood Oval/.test(dA) && /14 Mar/.test(dA) && /09:00/.test(dA), dA);
  ok("...the one with a report on file says so", /Pitch report filed/.test(dA) && !/not yet/.test(dA), dA);
  ok("...the one without says that", /Pitch report not yet filed/.test(dB), dB);
  ok("...and a fixture already played is not a duty", !dutyIds.includes("77777777-0000-0000-0000-000000000001"));
  ok("none of the invented tasks, and no fake New Task button", !INVENTED.test(await tid(off.page, "os-main").innerText()) && !/New Task/.test(await tid(off.page, "os-main").innerText()));
  if (await tid(off.page, "mgmt-tab-users").count()) await tid(off.page, "mgmt-tab-users").click({ timeout: 5000 });
  await off.page.waitForTimeout(600);

  // ── 3. Add role ──────────────────────────────────────────────────
  group("\"Add role\" gives the same person a second role, and it is real");
  const before = await heldIn(WESSELS);
  const wRow = rowOf(off.page, WESSELS);
  ok("A Wessels is a scorer, and only a scorer", before.length === 1 && before[0].role === "scorer" && (await chips(wRow)).length === 1);
  const wId = (await wRow.getAttribute("data-testid")).replace("person-row-", "");
  await tid(off.page, `add-role-${wId}`).click({ timeout: 5000 });
  await off.page.waitForTimeout(500);
  const dlg = off.page.locator('[role="dialog"]');
  ok("the form opens", await dlg.count() === 1 && /Add a role for A Wessels/.test(await dlg.innerText()));
  ok("...with the name and the email fixed, as they are on the account",
     await tid(off.page, "enrol-name").inputValue() === "A Wessels" && await tid(off.page, "enrol-email").inputValue() === WESSELS
     && await tid(off.page, "enrol-name").getAttribute("readonly") !== null && await tid(off.page, "enrol-email").getAttribute("readonly") !== null);
  const offered = await tid(off.page, "enrol-role").locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  ok("the roles offered are the school office's own", offered.includes("coach") && offered.includes("guardian") && offered.includes("official"), offered.join());
  ok("...and none that it may not grant", !NOT_OFFERED.some((r) => offered.includes(r)), offered.join());
  ok("...Add role is not enabled until a role is chosen", await tid(off.page, "enrol-submit").isDisabled());
  await tid(off.page, "enrol-role").selectOption("coach");
  ok("a coach needs a side: it asks for one", await tid(off.page, "enrol-team").count() === 1 && await tid(off.page, "enrol-submit").isDisabled());
  ok("...and a sign-in code is not issued by default for an account that already exists", !(await tid(off.page, "enrol-code").isChecked()));
  const dfl = await floors(off.page, '[role="dialog"]');
  ok("the form is on the 12px floor", dfl.small.length === 0, dfl.small.slice(0, 5).join(" | "));
  ok("...and every control in it is 44px", dfl.taps.length === 0, dfl.taps.slice(0, 5).join(" | "));
  await tid(off.page, "enrol-team").selectOption("2XI");
  await tid(off.page, "enrol-submit").click({ timeout: 5000 });
  await off.page.waitForTimeout(2200);
  ok("the dialog closes on the server's yes", await off.page.locator('[role="dialog"]').count() === 0);
  ok("...and says what was done", /Added Coach \(2XI\) to A Wessels's account/.test(await tid(off.page, "people-notice").innerText().catch(() => "")));
  const wAfter = await chips(rowOf(off.page, WESSELS));
  ok("the row now shows both roles", wAfter.length === 2 && wAfter.some((c) => c.role === "scorer") && wAfter.some((c) => c.role === "coach" && /2XI/.test(c.text)), JSON.stringify(wAfter));
  ok("...on the same row — still one A Wessels", await off.page.locator('[data-testid^="person-row-"]', { hasText: "A Wessels" }).count() === 1);
  const dbAfter = await heldIn(WESSELS);
  ok("Postgres holds both appointments, live", dbAfter.length === 2 && dbAfter.some((a) => a.role === "coach" && a.team_code === "2XI" && a.active) && dbAfter.some((a) => a.role === "scorer" && a.active),
     JSON.stringify(dbAfter));
  ok("...on the one account — no second account was made", (await accountsFor(WESSELS)).length === 1
     && (await q(`select id from app_user where name = 'A Wessels'`)).length === 1);
  ok("...and the request that granted it is on the record, decided",
     (await q(`select count(*)::int as n from role_request r join app_user u on u.id = r.person_id
                where u.email = $1 and r.role = 'coach' and r.state = 'granted' and r.team_code = '2XI'`, [WESSELS]))[0].n === 1);
  ok("no console errors on the office's session", off.errors.length === 0, off.errors.join(" | "));
  await off.ctx.close();

  const again = await open();
  ok("a fresh load, signed in again", await signIn(again.page, "registrar@example.invalid") && await toUsers(again.page));
  const wReload = await chips(rowOf(again.page, WESSELS));
  ok("both roles are still there — it was saved, not held in the page", wReload.length === 2 && wReload.some((c) => c.role === "scorer") && wReload.some((c) => c.role === "coach" && /2XI/.test(c.text)), JSON.stringify(wReload));

  // ── 3b. End a role (db/77): the second role ends with a reason, the first stays ──
  group("\"End role\" ends one appointment with a reason, on the record, and leaves the other");
  const wRow2 = rowOf(again.page, WESSELS);
  const ends = wRow2.locator('[data-testid="end-role"]');
  ok("each live appointment has its own End role", await ends.count() === 2);
  const coachEnd = wRow2.locator('[data-testid="end-role"][aria-label*="Coach"]');
  ok("...named by the role it ends", await coachEnd.count() === 1);
  await coachEnd.click({ timeout: 5000 });
  await again.page.waitForTimeout(400);
  ok("it asks for a reason before it will end anything", await tid(again.page, "end-role-confirm").isDisabled());
  await tid(again.page, "end-role-reason").fill("Moved to umpiring this term only");
  await tid(again.page, "end-role-confirm").click({ timeout: 5000 });
  await again.page.waitForTimeout(2200);
  ok("...and says what was done", /Ended Coach \(2XI\) for A Wessels/.test(await tid(again.page, "people-notice").innerText().catch(() => "")));
  const wEnded = await chips(rowOf(again.page, WESSELS));
  ok("the coach role now reads ended; the scorer role is untouched", wEnded.some((c) => c.role === "coach" && /ended/.test(c.text))
     && wEnded.some((c) => c.role === "scorer" && !/ended/.test(c.text)), JSON.stringify(wEnded));
  const dbEnded = await heldIn(WESSELS);
  ok("Postgres: the coach appointment is withdrawn, not deleted; the scorer one stays live",
     dbEnded.some((a) => a.role === "coach" && !a.active) && dbEnded.some((a) => a.role === "scorer" && a.active), JSON.stringify(dbEnded));
  ok("...and the reason is on the school's record",
     (await q(`select count(*)::int as n from role_assignment_ending e join role_assignment a on a.id = e.assignment_id
                join app_user u on u.id = a.person_id where u.email = $1 and e.reason = 'Moved to umpiring this term only'`, [WESSELS]))[0].n === 1);

  // ── 4. What she may not grant ────────────────────────────────────
  group("A role the caller may not grant is not offered, and a forced post is refused in words");
  const target = rowOf(again.page, "coach2@example.invalid");
  const tId = (await target.getAttribute("data-testid")).replace("person-row-", "");
  const tBefore = await heldIn("coach2@example.invalid");
  await tid(again.page, `add-role-${tId}`).click({ timeout: 5000 });
  await again.page.waitForTimeout(500);
  await tid(again.page, "enrol-role").selectOption("official");
  // The picker will not offer a clinical role, so the request is rewritten in
  // flight: the server is asked for what the screen would never ask.
  let sent = null;
  await again.page.route("**/api/users", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const body = JSON.parse(req.postData() || "{}");
    sent = { ...body };
    await route.continue({ postData: JSON.stringify({ ...body, role: "medical" }) });
  });
  await tid(again.page, "enrol-submit").click({ timeout: 5000 });
  await again.page.waitForTimeout(1800);
  ok("the post went out, with the role swapped for one she cannot grant", sent?.role === "official" && sent?.email === "coach2@example.invalid", JSON.stringify(sent));
  const err = tid(again.page, "enrol-error");
  const said = await err.innerText().catch(() => "");
  ok("the server refused, and the screen says so beside the form", await err.count() === 1 && await again.page.locator('[role="dialog"]').count() === 1, said);
  ok("...in words — about the role, not a code", /you may not do that here/i.test(said) && /may grant/.test(said) && !/not_permitted|_/.test(said), said);
  ok("...nothing was written", JSON.stringify(await heldIn("coach2@example.invalid")) === JSON.stringify(tBefore)
     && (await q(`select count(*)::int as n from role_assignment where role = 'medical' and person_id = (select id from app_user where email = $1)`, ["coach2@example.invalid"]))[0].n === 0);
  await again.page.unroute("**/api/users");
  await click(again.page, /^Cancel$/, 4000);
  ok("Cancel closes it, and the list is as it was", await again.page.locator('[role="dialog"]').count() === 0);

  // The same thing from outside the page, to the server directly.
  const dev = await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "registrar@example.invalid", deviceId: "browser-management" }) })).json();
  const hil = (await q(`select school_id::text as s from app_user where email = 'registrar@example.invalid'`))[0].s;
  const forced = await fetch(`${API}/api/users`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${dev.token}` },
    body: JSON.stringify({ email: "coach2@example.invalid", name: "P Moodley", role: "medical", schoolId: hil }) });
  ok("a forced post straight to the API is refused by the server too (403)", forced.status === 403, String(forced.status));
  ok("no console errors on the second session", again.errors.length === 0, again.errors.join(" | "));

  // ── Add user ─────────────────────────────────────────────────────
  group("\"Add user\" opens a real account, and the code is shown once");
  await tid(again.page, "add-user").click({ timeout: 5000 });
  await again.page.waitForTimeout(500);
  const newEmail = `walk.management.${Date.now()}@example.invalid`;
  ok("the name and email are editable for a new person", await tid(again.page, "enrol-name").getAttribute("readonly") === null
     && await tid(again.page, "enrol-email").getAttribute("readonly") === null);
  await tid(again.page, "enrol-name").fill("W Walker", { timeout: 3000 }).catch(() => {});
  await tid(again.page, "enrol-email").fill(newEmail, { timeout: 3000 }).catch(() => {});
  await tid(again.page, "enrol-role").selectOption("scorer");
  ok("a sign-in code is asked for by default for a new account", await tid(again.page, "enrol-code").isChecked());
  await tid(again.page, "enrol-submit").click({ timeout: 5000 });
  await again.page.waitForTimeout(2200);
  ok("the code comes back once", await tid(again.page, "issued-code").count() === 1 && (await tid(again.page, "issued-code").innerText()).trim().length >= 6);
  await click(again.page, /^Done$/, 4000);
  await again.page.waitForTimeout(1500);
  ok("...and the new person is on the list with the role", (await chips(rowOf(again.page, newEmail))).some((c) => c.role === "scorer" && c.state === "live"));
  const created = await q(`select u.id, count(a.id)::int as n from app_user u left join role_assignment a on a.person_id = u.id where u.email = $1 group by u.id`, [newEmail]);
  ok("...and Postgres holds the account with that one appointment", created.length === 1 && created[0].n === 1, JSON.stringify(created));
  // The existing email, through Add user: the role goes on the existing account.
  await tid(again.page, "add-user").click({ timeout: 5000 });
  await again.page.waitForTimeout(500);
  await tid(again.page, "enrol-name").fill("A Wessels");
  await tid(again.page, "enrol-email").fill(WESSELS);
  await tid(again.page, "enrol-role").selectOption("official");
  await tid(again.page, "enrol-code").uncheck();
  await tid(again.page, "enrol-submit").click({ timeout: 5000 });
  await again.page.waitForTimeout(2200);
  ok("an email that already belongs to someone gets the role on their account", (await accountsFor(WESSELS)).length === 1
     && (await heldIn(WESSELS)).some((a) => a.role === "official" && a.active));
  await again.ctx.close();

  // ── 5b. A person who cannot assign roles ─────────────────────────
  group("A person who cannot assign roles is offered nothing to write with");
  const coach = await open();
  ok("the 1XI coach signs in", await signIn(coach.page, "coach@example.invalid"));
  // Management is offered for user.role.assign (design/roles.js NAV_CAPABILITY);
  // a coach does not hold it, and nothing of the directory is drawn for him.
  ok("Management is not in a coach's menu", await tid(coach.page, "nav-management").count() === 0);
  ok("...so he has no directory, no Add user and no Add role anywhere", await tid(coach.page, "people-panel").count() === 0
     && await tid(coach.page, "add-user").count() === 0 && await coach.page.locator('[data-testid^="add-role-"]').count() === 0);
  await coach.ctx.close();

  group("The principal, the director of sport and the groundskeeper: tabs follow capabilities");
  const prin = await open();
  ok("the principal signs in", await signIn(prin.page, "principal@example.invalid"));
  ok("...and reaches Management", await toUsers(prin.page));
  const prinTabs = await tabsShown(prin.page);
  ok("her tabs are Users and Audit log — what she holds — and not a coach's squad tools",
     JSON.stringify(prinTabs) === JSON.stringify(tabsFor("principal")) && JSON.stringify(prinTabs) === JSON.stringify(["users", "audit"]), prinTabs.join());
  await prin.ctx.close();

  const dos = await open();
  ok("the director of sport signs in", await signIn(dos.page, SARAH));
  ok("...holds user.role.assign, so Management → Users is hers and offers Add user",
     await toUsers(dos.page) && await tid(dos.page, "add-user").count() === 1);
  ok("...and she has every tab the policy gives a director of sport", JSON.stringify(await tabsShown(dos.page)) === JSON.stringify(tabsFor("directorofsport")), (await tabsShown(dos.page)).join());
  await dos.page.locator('[data-testid="add-user"]').click({ timeout: 5000 });
  await dos.page.waitForTimeout(500);
  const dosOffered = await tid(dos.page, "enrol-role").locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  ok("...and is offered the clinical role the office is not (her own grant list)", dosOffered.includes("medical") && dosOffered.includes("fitness") && !dosOffered.includes("guardian"), dosOffered.join());
  await dos.ctx.close();

  // The groundskeeper is not offered Management in the shell (the screen's nav
  // entry is user.role.assign), so the walk puts the screen in front of the
  // demonstration's groundskeeper by the session the app itself restores from.
  group("A groundskeeper, put in front of Management, has the tab his capability gives him");
  const gk = await open("http://127.0.0.1:9");
  ok("the demonstration's groundskeeper signs in", await signIn(gk.page, "emzimba@hilton.co.za", "ground123"));
  ok("...and the shell does not offer him Management", await tid(gk.page, "nav-management").count() === 0);
  await gk.page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open("scrbrd", 1);
    r.onsuccess = () => {
      const db = r.result, t = db.transaction("kv", "readwrite");
      t.objectStore("kv").put({ appState: "app", role: "facilities", userName: "Ernest Mzimba", page: "management" }, "session");
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    r.onerror = () => reject(r.error);
  }));
  await gk.page.reload({ waitUntil: "networkidle" });
  await gk.page.waitForTimeout(1200);
  const gkTabs = await tabsShown(gk.page);
  ok("his tabs are what the policy says: Ground tasks, and no Users, Squad, Fixtures, Broadcast or Audit",
     JSON.stringify(gkTabs) === JSON.stringify(tabsFor("facilities")) && JSON.stringify(gkTabs) === JSON.stringify(["grounds"]), gkTabs.join());
  ok("...opened on it, with the fixtures at his grounds", await tid(gk.page, "ground-duties").count() === 1 && await gk.page.locator('[data-testid="ground-duty"]').count() > 0);
  ok("...and no directory, no Add user", await tid(gk.page, "people-panel").count() === 0 && await tid(gk.page, "add-user").count() === 0);
  ok("...and none of the invented tasks", !INVENTED.test(await tid(gk.page, "os-main").innerText()));
  ok("...and it claims nothing about pitch reports: the demonstration has none to read", !/Pitch report/.test(await tid(gk.page, "ground-duties").innerText().catch(() => "Pitch report (no list at all)")));
  await gk.ctx.close();

  // ── 7b. Phone width ──────────────────────────────────────────────
  group("At 390 wide: no sideways scroll, and the floors hold");
  // Signed in at desktop width, then narrowed: the shell chooses its navigation
  // by width, and the sign-in screen is not what is being measured.
  const ph = await open();
  ok("the registrar signs in", await signIn(ph.page, "registrar@example.invalid"));
  ok("...and reaches the list", await toUsers(ph.page));
  await ph.page.setViewportSize({ width: 390, height: 844 });
  await ph.page.waitForTimeout(800);
  // The shell clips its own overflow, so the document never scrolls sideways
  // whatever is drawn; what is asked instead is that nothing in the list is
  // drawn past the edge of the screen.
  const past = await ph.page.evaluate(() => [...document.querySelectorAll('[data-testid="people-panel"], [data-testid="people-panel"] *')]
    .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > window.innerWidth + 1)
    .map((el) => `${el.tagName}.${el.getAttribute("data-testid") || ""} → ${Math.round(el.getBoundingClientRect().right)}`));
  ok("nothing in the list is drawn past the edge of a 390 screen", past.length === 0 && await ph.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), past.slice(0, 3).join(" | "));
  const pf = await floors(ph.page, '[data-testid="people-panel"]');
  ok("no text under 12px on the phone", pf.small.length === 0, pf.small.slice(0, 5).join(" | "));
  ok("nothing tapped under 44px on the phone", pf.taps.length === 0, pf.taps.slice(0, 5).join(" | "));
  await ph.page.locator('[data-testid^="add-role-"]').first().click({ timeout: 5000 });
  await ph.page.waitForTimeout(500);
  const pdf = await floors(ph.page, '[role="dialog"]');
  ok("the form on the phone: 12px", pdf.small.length === 0, pdf.small.slice(0, 5).join(" | "));
  ok("...and 44px, close button included", pdf.taps.length === 0, pdf.taps.slice(0, 5).join(" | "));
  ok("no console errors on the phone", ph.errors.length === 0, ph.errors.join(" | "));
  await ph.ctx.close();

  group("With no fixtures to come, Ground tasks is one plain line");
  await q(`update match set status = 'complete' where status in ('scheduled', 'live')`);
  const none = await open();
  ok("the registrar signs in", await signIn(none.page, "registrar@example.invalid") && await toUsers(none.page));
  await tid(none.page, "mgmt-tab-grounds").click({ timeout: 5000 });
  await none.page.waitForTimeout(1500);
  ok("nothing is invented to fill the space", await none.page.locator('[data-testid="ground-duty"]').count() === 0);
  ok("...one plain line says so", (await tid(none.page, "ground-duties-none").innerText().catch(() => "")).trim() === "No fixtures are coming up at your grounds.");
  ok("no console errors", none.errors.length === 0, none.errors.join(" | "));
  await none.ctx.close();

  // ── 6. Demonstration ─────────────────────────────────────────────
  group("Nobody signed in: the seeded directory, and nothing offered");
  const posts = [];
  const demo = await open("http://127.0.0.1:9");
  demo.page.on("request", (r) => { if (r.method() === "POST") posts.push(r.url()); });
  ok("the demonstration's super admin gets in", await signIn(demo.page, "admin@hilton.co.za", "admin123"));
  ok("...and reaches Management → Users", await toUsers(demo.page));
  const demoRows = await demo.page.locator('[data-testid^="person-row-"]').count();
  ok("the seeded directory is listed", demoRows >= 10, String(demoRows));
  ok("...one role each (the demonstration has no appointments to read)", await demo.page.locator('[data-testid="role-chip"]').count() === demoRows);
  ok("no Add user", await tid(demo.page, "add-user").count() === 0);
  ok("no Add role", await demo.page.locator('[data-testid^="add-role-"]').count() === 0);
  ok("it says it is the demonstration", await tid(demo.page, "people-demo").count() === 1);
  ok("...and the plain line is there", /Suspending an account is coming\./.test(await tid(demo.page, "people-coming").innerText()));
  const demoButtons = await demo.page.locator('[data-testid="os-main"] button').allInnerTexts();
  ok("no Edit, Promote, Suspend or Delete", !demoButtons.some((b) => /^(Edit|Promote|Suspend|Restore|Delete)\b/i.test(b.trim())), demoButtons.join(" | "));
  if (await tid(demo.page, "mgmt-tab-audit").count()) await tid(demo.page, "mgmt-tab-audit").click({ timeout: 5000 });
  await demo.page.waitForTimeout(400);
  ok("the audit log asks for a sign-in, and shows nothing else",
     (await tid(demo.page, "audit-signin").innerText().catch(() => "")).trim() === "Sign in to see the audit log."
     && await demo.page.locator('[data-testid="audit-row"]').count() === 0);
  ok("nothing was posted", posts.length === 0, posts.join(","));
  ok("no console errors in the demonstration", demo.errors.length === 0, demo.errors.join(" | "));
  await demo.ctx.close();
} finally {
  await browser.close();
  web.close();
  apiProc.kill();
  await pool.end();
}

if (DEBUG && apiErr.length) console.log("[api stderr]", apiErr.join("").slice(0, 2000));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

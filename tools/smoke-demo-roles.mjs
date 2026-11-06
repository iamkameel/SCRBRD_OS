#!/usr/bin/env node
/**
 * Every role's home, proved through the real API with dev login, on a LOCAL
 * replica of the demo copy after tools/demo-roles.mjs's file is pasted.
 *
 * RUN BY HAND, never in CI, and only against a database of your own on this
 * machine:
 *
 *   SCRBRD_DB=<db> SCRBRD_DB_PORT=5433 node tools/migrate.mjs --reset --seed
 *   SCRBRD_DB=<db> SCRBRD_DB_PORT=5433 node tools/demo-replica.mjs      (claude/wip-demo-season)
 *   node tools/demo-roles.mjs roles.sql && psql … -f roles.sql
 *   SCRBRD_DB=<db> SCRBRD_DB_PORT=5433 SCRBRD_PORT_OFFSET=181 node tools/smoke-demo-roles.mjs
 *   …  --shots <dir>     also a phone screenshot of each role's home (needs apps/web/dist)
 *
 * It starts the API with NODE_ENV=development and ALLOW_DEV_LOGIN=1, signs in
 * as each role by email with no code, and asks each home's reads. A read that
 * answers with rows passes; one that answers empty, or refuses, fails. It also
 * checks the separations the fill must not break: KEA's office reads none of
 * WES's register, a WES coach no KEA injury, only the WES DSO the concern.
 * It writes nothing but sign-in rows.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const API_PORT = port(8874);
const WEB_PORT = port(4374);
const API = `http://127.0.0.1:${API_PORT}`;
const WES = "22222222-2222-2222-2222-222222222222";
const KEA = "33333333-3333-3333-3333-333333333333";
const HIL = "11111111-1111-1111-1111-111111111111";
const COMPETITION = "99999999-0000-0000-0000-000000000001";
const pid = (n) => `de300000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);

const dbUrl = new URL(ownerUrl());
if (!["127.0.0.1", "localhost", "::1"].includes(dbUrl.hostname)) {
  console.error("✗ refusing: this proof runs against a database on this machine only, never a remote one.");
  process.exit(2);
}
const owner = new pg.Pool({ connectionString: ownerUrl() });
const [{ filled }] = (await owner.query(`select count(*)::int as filled from adult_clearance where note = 'Recorded for the demo (demo-roles)'`)).rows;
if (!filled) {
  console.error(`✗ this database (${dbUrl.pathname.slice(1)}) does not hold the demo roles. Paste tools/demo-roles.mjs's file first.`);
  await owner.end();
  process.exit(2);
}

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-demo-roles-secret",
         ...(SHOTS ? { WEB_ORIGIN: `http://localhost:${WEB_PORT}` } : {}) },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(API + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const tokens = {};
const login = async (who) => {
  if (!tokens[who]) tokens[who] = (await call("/api/auth/dev-login", { method: "POST", body: { email: `${who}@example.invalid`, deviceId: "device-demo-roles" } })).body?.token;
  return tokens[who];
};
/** The rows a read answers with, or null when it refuses. */
const read = async (who, resource, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  const r = await call(`/api/read/${resource}${qs ? `?${qs}` : ""}`, { token: await login(who) });
  return r.status === 200 ? (r.body?.rows ?? []) : null;
};
const get = async (who, path) => (await call(path, { token: await login(who) }));
/** One home card: its read answers with at least `min` rows that pass `keep`. */
const card = async (who, label, resource, params, min = 1, keep = () => true) => {
  const rows = await read(who, resource, params);
  const n = rows ? rows.filter(keep).length : null;
  ok(`${who} · ${label} (${resource}): ${n ?? "refused"} row${n === 1 ? "" : "s"}`, n != null && n >= min);
  return rows ?? [];
};

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await call("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the API is up with dev login on", (await call("/api/health")).body?.auth === "dev_login_enabled");
  await apiCheck();
  if (SHOTS) await shots();
} catch (e) {
  fail++;
  console.log("  ✗ the run stopped:", e?.stack ?? e);
} finally {
  server.kill();
  await owner.end();
  if (fail && serverErr.length) console.log("\nAPI stderr (tail):\n" + serverErr.join("").slice(-1500));
  console.log(`\n${"─".repeat(52)}\nDEMO ROLES: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

async function apiCheck() {
  group("Coaches: the day sheet's training and who is out, the training screen, skills");
  await card("coach.wes.1xi", "This week: training", "training", {}, 6, (r) => (r.team_code ?? r.teamCode) === "1XI");
  const out = await card("coach.wes.1xi", "Who is out", "injuries", {}, 1);
  ok("...and no Kearsney boy among them", out.every((r) => (r.school_id ?? r.schoolId ?? WES) !== KEA));
  await card("coach.wes.1xi", "the register", "training_attendance", {}, 20);
  await card("coach.wes.1xi", "the drill library, the school's own two", "drills", {}, 2, (r) => (r.school_id ?? r.schoolId) === WES);
  await card("coach.wes.1xi", "skills", "skills", {}, 10);
  await card("coach.wes.1xi", "development notes", "notes", {}, 3);
  await card("coach.wes.1xi", "nets load (a consented seamer)", "load", { playerId: pid(8) }, 1);
  await card("coach.wes.u14a", "This week: training", "training", {}, 6, (r) => (r.team_code ?? r.teamCode) === "U14A");
  await card("coach.wes.u12a", "This week: one session", "training", {}, 1, (r) => (r.team_code ?? r.teamCode) === "U12A");
  await card("coach.kea.1xi", "This week: training", "training", {}, 6, (r) => (r.team_code ?? r.teamCode) === "1XI");
  await card("coach.kea.1xi", "Who is out", "injuries", {}, 1);
  await card("assistant.wes.1xi", "This week: training", "training", {}, 6);
  await card("manager.wes.u16b", "This week: training", "training", {}, 6);

  group("Medical: injuries, the worklist, the return-to-play reviews");
  const inj = await card("medical.wes", "injuries", "injuries", {}, 3);
  await card("medical.wes", "the worklist", "injury_worklist", {}, 2);
  const reviewed = inj.find((r) => /back/i.test(r.injury_type ?? r.injuryType ?? ""));
  if (reviewed) await card("medical.wes", "a back injury's reviews", "injury_reviews", { injuryId: reviewed.id }, 1);
  else ok("medical.wes · the back injury is on the list", false);
  await card("medical.kea", "injuries", "injuries", {}, 1);

  group("The DSO: the concern, and only at Westville");
  const inbox = async (who) => ((await get(who, "/api/safeguarding/inbox")).body?.rows ?? []).length;
  const dso = await inbox("dso.wes");
  ok(`dso.wes · the inbox holds the concern (${dso})`, dso >= 1);
  for (const who of ["dso.kea", "dos.wes", "principal.wes", "coach.wes.1xi"]) ok(`${who} · reads no concern`, (await inbox(who)) === 0);
  const receipts = (await get("coach.wes.u14a", "/api/safeguarding/receipts")).body?.rows ?? [];
  ok(`coach.wes.u14a · keeps the reference of the one he raised (${receipts.length})`, receipts.length >= 1);

  group("The office: the register, the request, the pending link, contacts");
  const reg = await card("registrar.wes", "the clearance register", "clearance_register", { schoolId: WES }, 20);
  const statuses = (rows) => [...new Set(rows.map((r) => r.status))].sort().join(", ");
  const soon = reg.filter((r) => r.status !== "current");
  ok(`...statuses ${statuses(reg)}; not current: ${soon.map((r) => `${r.role} ${r.kind} ${r.status}`).join("; ") || "none"}`,
     soon.length >= 1 && soon.every((r) => r.role === "coach" && r.kind === "safeguarding_awareness"));
  const keaReg = await card("office.kea", "the clearance register", "clearance_register", { schoolId: KEA }, 20);
  const gap = keaReg.filter((r) => r.status !== "current");
  ok(`...statuses ${statuses(keaReg)}; not current: ${gap.map((r) => `${r.role} ${r.kind} ${r.status}`).join("; ") || "none"}`,
     gap.length >= 1 && gap.every((r) => r.role === "coach" && r.kind === "first_aid" && r.status === "missing"));
  ok("...KEA's office reads no Westville row", keaReg.every((r) => (r.school_id ?? r.schoolId ?? KEA) !== WES));
  const wesAsKea = await read("office.kea", "clearance_register", { schoolId: WES });
  ok(`...and asked for Westville's, gets none (${wesAsKea?.length ?? "refused"})`, !wesAsKea || wesAsKea.length === 0);
  await card("registrar.wes", "To resolve: a role request", "role_requests", {}, 1, (r) => r.decidable !== false && r.state === "pending");
  await card("registrar.wes", "a pending guardian link", "child_links", { playerId: pid(140) }, 1, (r) => /pending/.test(JSON.stringify(r)));
  await card("registrar.wes", "a pupil's emergency contacts", "emergency_contacts", { playerId: pid(106) }, 2);
  await card("dos.wes", "the clearance register", "clearance_register", { schoolId: WES }, 20);

  group("Parents and pupils");
  await card("parent.106", "his son's emergency contacts", "emergency_contacts", { playerId: pid(106) }, 2);
  await card("parent.020", "his own request to score", "role_requests", {}, 1, (r) => r.state === "pending");
  const links = await read("parent.030", "my_links");
  ok(`parent.030 · a link waiting to be verified (${links?.length ?? "refused"} links)`, (links ?? []).some((r) => /pending/.test(JSON.stringify(r))));
  const standing = (await get("parent.002", `/api/lifts/standing?schoolId=${WES}`)).body;
  ok(`parent.002 · his driver's declaration stands (${standing?.declaration?.registration ?? "none"})`, !!standing?.declaration);
  await card("parent.008", "health monitoring consent given", "consents", {}, 1);
  await card("pupil.wes.u14a", "his side's training", "training", {}, 6);
  await card("pupil.wes.1xi", "his side's training", "training", {}, 6);

  group("Principal, platform, finance and sponsorship");
  await card("principal.wes", "sponsorships (one under a waiver)", "sponsorships", {}, 2);
  await card("principal.wes", "module switches", "module_settings", { schoolId: WES }, 5);
  await card("principal.kea", "module switches", "module_settings", { schoolId: KEA }, 5);
  await card("platform", "module switches at WES", "module_settings", { schoolId: WES }, 5);
  await card("bursar", "sponsors", "sponsors", {}, 2);
  await card("bursar", "placements", "sponsorships", {}, 2);

  group("League, transport, news");
  await card("league", "divisions", "competition_divisions", { competitionId: COMPETITION }, 2);
  const ent = (await get("league", `/api/competitions/${COMPETITION}/entrants`)).body;
  const entrants = ent?.rows ?? ent?.entrants ?? [];
  ok(`league · entrants, Kearsney's 1XI among them (${entrants.length})`, entrants.some((e) => /Kearsney/.test(JSON.stringify(e))));
  const pc = await get("league", `/api/competitions/${COMPETITION}/playing-conditions`);
  // Ours is a draft; where the season published its own first, ours was not written and theirs is read.
  ok(`league · the league's playing conditions (${pc.status})`, pc.status === 200 && /"version"|League table rules|points\.win/.test(JSON.stringify(pc.body)));
  await card("transport.wes", "vehicles", "vehicles", {}, 2);
  await card("transport.kea", "vehicles", "vehicles", {}, 1);
  await card("dos.wes", "Newsfeed", "news", {}, 2, (r) => r.scope === "school");
  await card("parent.106", "Newsfeed", "news", {}, 2, (r) => r.scope === "school");
  await card("dos.kea", "Newsfeed", "news", {}, 1, (r) => r.scope === "school");
  await card("coach.wes.1xi", "Alerts: the school's notices", "notifications", {}, 1);
}

async function shots() {
  const { chromium } = await import("playwright-core");
  const { launchOptions } = await import("./chromium.mjs");
  const { offline } = await import("./offline-browser.mjs");
  const { createServer } = await import("node:http");
  const { readFile } = await import("node:fs/promises");
  const { join, extname } = await import("node:path");
  mkdirSync(SHOTS, { recursive: true });
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".map": "application/json" };
  const web = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x").pathname;
    let body, type;
    try { const f = join("apps/web/dist", url === "/" ? "index.html" : url); body = await readFile(f); type = TYPES[extname(f)] ?? "application/octet-stream"; }
    catch { body = await readFile("apps/web/dist/index.html"); type = "text/html"; }
    res.writeHead(200, { "content-type": type });
    res.end(body);
  });
  await new Promise((r) => web.listen(WEB_PORT, r));
  const browser = await chromium.launch({ ...launchOptions() });
  // who, a file name, and the menu entry to open after the home (null: the home only)
  const WHO = [
    ["coach.wes.1xi", "coach", null], ["coach.wes.1xi", "coach-training", "training"],
    ["medical.wes", "medical", null], ["medical.wes", "medical-injuries", "injuries"],
    ["dso.wes", "dso", "safeguarding"], ["registrar.wes", "office", null], ["registrar.wes", "office-to-resolve", "readiness"],
    ["registrar.wes", "office-staff", "staff"], ["dos.wes", "dos", null], ["dos.wes", "dos-to-resolve", "readiness"],
    ["principal.wes", "principal", null], ["principal.wes", "principal-sponsors", "sponsors"], ["principal.wes", "principal-modules", "modules"],
    ["bursar", "bursar-sponsors", "sponsors"], ["league", "league", "competitions"], ["transport.wes", "transport", "logistics"],
    ["parent.106", "parent", null], ["parent.030", "parent-pending-link", null], ["pupil.wes.u14a", "pupil", null],
    ["platform", "platform-modules", "modules"], ["watcher", "spectator", null], ["analyst", "scout", null],
  ];
  try {
    for (const [email, file, nav] of WHO) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await offline(ctx);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
      await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
      await page.locator("button:not([disabled]), a", { hasText: /Get Started|Log In/ }).first().click({ timeout: 8000 }).catch(() => {});
      await page.locator("#login-email").fill(`${email}@example.invalid`, { timeout: 8000 });
      await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 8000 });
      const signedIn = await page.locator('[data-testid="os-main"]').waitFor({ timeout: 20000 }).then(() => true, () => false);
      if (nav) {
        const direct = page.locator(`[data-testid="mnav-${nav}"]`);
        if (await direct.count()) await direct.first().click({ timeout: 4000 }).catch(() => {});
        else {
          await page.locator('[data-testid="mnav-more"]').first().click({ timeout: 4000 }).catch(() => {});
          await page.locator(`[data-testid="drawer-${nav}"]`).first().click({ timeout: 4000 }).catch(() => {});
        }
      }
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
      const shown = await page.locator('[data-testid="os-main"]').getAttribute("data-page").catch(() => null);
      await page.screenshot({ path: join(SHOTS, `${file}.png`), fullPage: true });
      ok(`${file}: ${email} signed in, on ${shown ?? "?"}${nav ? ` (asked for ${nav})` : ""}, no page errors`,
         signedIn && (!nav || shown === nav) && errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
  } finally {
    await browser.close();
    web.close();
  }
}

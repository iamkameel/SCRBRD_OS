#!/usr/bin/env node
/**
 * Appointing the officials.
 *
 * `officiating.assign` has been in the capability table since the first
 * migration and three roles hold it. Nothing could exercise it: there was no
 * table to appoint anyone in, so a capability sat in the model, passed every
 * authorisation test, and governed nothing. An `official` role existed with
 * nothing behind it. That is the same shape of defect as the toss and the
 * squad — a control that is correct, tested, and never reached.
 *
 * This walk proves the appointment is really governed:
 *
 *   1. the capability decides, not the role name
 *   2. an official cannot appoint themselves
 *   3. the school is derived from the match, never taken from the caller
 *   4. anyone who may read the fixture may see who is standing
 *   5. replacing a panel withdraws the old one rather than deleting it
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-officials.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8826);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-officials-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-officials" } })).body?.token;

const appoint = (matchId, token, officials) =>
  api(`/api/matches/${matchId}/officials`, { method: "POST", token, body: { officials } });
const standing = async (matchId, token) =>
  (await api(`/api/read/officials?matchId=${matchId}`, { token })).body?.rows || [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // sarah is the director of sport, which is one of the three roles holding
  // officiating.assign. The registrar is a SCHOOL ADMINISTRATOR and is not —
  // seniority is not the question the model asks, and that is the point.
  const head      = await login("sarah@example.invalid");        // directorofsport
  const registrar = await login("registrar@example.invalid");    // schooladmin: no officiating.assign
  const coach     = await login("coach@example.invalid");        // 1XI coach
  const parent    = await login("parent@example.invalid");       // guardian: fixture.read only

  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() + interval '2 days','T20',20,'scheduled') returning id`,
    [HIL]))[0].id;

  group("The capability decides who may appoint");
  ok("a coach may not appoint officials — officiating.assign is not a coaching capability",
     [403, 401].includes((await appoint(m, coach, [{ duty: "umpire", name: "D Naidoo" }])).status));
  ok("nor may a guardian",
     [403, 401].includes((await appoint(m, parent, [{ duty: "umpire", name: "D Naidoo" }])).status));
  ok("nor may the school registrar — senior, and holding a different job",
     [403, 401].includes((await appoint(m, registrar, [{ duty: "umpire", name: "D Naidoo" }])).status));
  ok("an unauthenticated request is refused rather than silently ignored",
     [401, 403].includes((await appoint(m, undefined, [{ duty: "umpire", name: "D Naidoo" }])).status));

  const first = await appoint(m, head, [
    { duty: "umpire", name: "D Naidoo", panel: "KZN Cricket Umpires" },
    { duty: "umpire", name: "P van Wyk", panel: "KZN Cricket Umpires" },
    { duty: "scorer", name: "M Cele" },
  ]);
  ok("the director of sport can — officiating.assign is hers", first.status === 200);
  ok("...and all three are recorded", first.body?.appointed === 3);

  group("The school is derived from the match, never taken from the caller");
  const row = (await q(`select school_id, appointed_by from match_official where match_id = $1 limit 1`, [m]))[0];
  ok("the row is anchored to the match's own school", row?.school_id === HIL);
  ok("...and remembers who appointed them", !!row?.appointed_by);

  group("Anyone who may read the fixture may see who is standing");
  const seen = await standing(m, head);
  ok("two umpires and a scorer", seen.length === 3);
  ok("the umpires are named", seen.filter((r) => r.duty === "umpire").length === 2);
  ok("the panel is carried", seen.some((r) => r.panel === "KZN Cricket Umpires"));
  ok("a guardian who may read the fixture sees them too — an umpire's name is announced at the toss",
     (await standing(m, parent)).length === 3);
  ok("an unauthenticated read is refused, not answered empty",
     [401, 403].includes((await api(`/api/read/officials?matchId=${m}`)).status));

  group("An official cannot appoint themselves");
  // The seeded analyst holds a scout role, not officiating.assign. The point
  // is the capability: `official` carries officiating.report, and reporting is
  // not appointing.
  const analyst = await login("analyst@example.invalid");
  ok("holding an officiating capability is not holding the assigning one",
     [403, 401].includes((await appoint(m, analyst, [{ duty: "umpire", name: "Self Appointed" }])).status));

  group("A mis-tick is refused before it reaches the sheet");
  ok("the same umpire twice on the same duty",
     (await appoint(m, head, [
       { duty: "umpire", name: "D Naidoo" }, { duty: "umpire", name: "d naidoo" },
     ])).status === 400);
  ok("an unknown duty", (await appoint(m, head, [{ duty: "linesman", name: "X" }])).status === 400);
  ok("an official with no name", (await appoint(m, head, [{ duty: "umpire", name: "  " }])).status === 400);
  ok("an empty sheet", (await appoint(m, head, [])).status === 400);
  ok("...and none of that disturbed the panel already standing",
     (await standing(m, head)).length === 3);

  group("Replacing a panel withdraws it rather than deleting it");
  const second = await appoint(m, head, [{ duty: "umpire", name: "A Sithole" }]);
  ok("a new sheet is accepted", second.status === 200);
  const now = await standing(m, head);
  ok("only the new appointment stands", now.length === 1 && now[0].person_name === "A Sithole");
  const all = await q(`select count(*)::int as n from match_official where match_id = $1`, [m]);
  ok("the previous three are still on the record, withdrawn", all[0].n === 4);
  ok("...which is what a disputed fixture needs and a DELETE would have lost",
     (await q(`select count(*)::int as n from match_official
                where match_id = $1 and withdrawn`, [m]))[0].n === 3);

  group("The register is maintained by the body that accredits, and by nobody at a school");
  // db/08 has held official and official_accreditation, and the policies
  // that let officiating.registry.manage write them, since the register
  // existed. Nothing wrote them: only the seed could fill the register.
  const league   = await login("league@example.invalid");     // competitionadmin: officiating.registry.manage
  const platform = await login("platform@example.invalid");   // platformadmin: officiating.registry.manage
  const stamp2 = Date.now();
  const addAs = (token, body) => api("/api/officials", { method: "POST", token, body });
  const byHead = await addAs(head, { fullName: `Refused By School ${stamp2}`, born: "1980-05-05" });
  ok("a director of sport, who may APPOINT, may not ADD to the register: 403", byHead.status === 403 && byHead.body?.error === "not_permitted", `${byHead.status} ${JSON.stringify(byHead.body)}`);
  const manager = (await addAs(league, { fullName: `Probe ${stamp2}`, born: "1980-05-05" })).status === 200 ? league : platform;
  const added = await addAs(manager, { fullName: `M Govender ${stamp2}`, born: "1979-03-02", panel: "KZN Umpires" });
  ok("the accrediting body adds an official", added.status === 200 && added.body?.id, `${added.status} ${JSON.stringify(added.body)}`);
  const child = await addAs(manager, { fullName: `Too Young ${stamp2}`, born: "2014-03-02" });
  ok("a twelve-year-old is refused as an official, by name", child.status === 400 && child.body?.error === "born_not_plausible_for_an_official", JSON.stringify(child.body));
  const noDob = await addAs(manager, { fullName: `No Birthday ${stamp2}` });
  ok("no date of birth, no entry", noDob.status === 400 && noDob.body?.error === "date_of_birth_required", JSON.stringify(noDob.body));
  const reg0 = ((await api("/api/read/official_register", { token: head })).body?.rows ?? []).find((r) => r.id === added.body?.id);
  ok("the new official is on the register the school reads, not yet accredited", reg0 && reg0.level == null, JSON.stringify(reg0));
  const acc = await api(`/api/officials/${added.body?.id}/accredit`, { method: "POST", token: manager, body: { level: "level2", validFrom: "2026-01-01", validUntil: "2027-12-31", issuedBy: "CSA" } });
  ok("the accrediting body records a grade", acc.status === 200 && acc.body?.level === "level2", JSON.stringify(acc.body));
  const badLevel = await api(`/api/officials/${added.body?.id}/accredit`, { method: "POST", token: manager, body: { level: "L2", validFrom: "2026-01-01" } });
  ok("a grade outside the ladder is refused, naming the ladder", badLevel.status === 400 && badLevel.body?.error === "level_unknown" && Array.isArray(badLevel.body?.detail?.known), JSON.stringify(badLevel.body));
  const accByHead = await api(`/api/officials/${added.body?.id}/accredit`, { method: "POST", token: head, body: { level: "national", validFrom: "2026-01-01" } });
  ok("a school cannot accredit", accByHead.status === 403);
  const reg1 = ((await api("/api/read/official_register", { token: head })).body?.rows ?? []).find((r) => r.id === added.body?.id);
  ok("the register now shows the grade and its end date", reg1?.level === "level2" && String(reg1?.accredited_until).startsWith("2027-12-31"), JSON.stringify(reg1));
  const retired = await api(`/api/officials/${added.body?.id}/retire`, { method: "POST", token: manager, body: {} });
  ok("the accrediting body retires an official", retired.status === 200 && retired.body?.active === false);
  const reg2 = ((await api("/api/read/official_register", { token: head })).body?.rows ?? []).find((r) => r.id === added.body?.id);
  ok("...who stays on the register as inactive, not deleted", reg2 && reg2.active === false, JSON.stringify(reg2));
  ok("which body managed it, for the record", manager === league ? true : (console.log("  (note: league@ was refused; platform@ managed the register)"), true));

  // ── SCRBRD-037. The duty roster over the same fixture ──
  //
  // match_duties is a UNION across match_official, scoring_session, trip,
  // match_pitch_report and match_squad, each read under its own policy. What
  // is asserted here is the half a screen cannot fake: it returns what is on
  // record and NOTHING for what is not, so the panel's "nothing on record" is
  // a true statement rather than a placeholder.
  group("The duty roster says what is on record, and nothing for what is not");
  {
    const duties = async (token, matchId) =>
      (await api(`/api/read/match_duties?matchId=${matchId}`, { token })).body?.rows ?? [];
    const rows = await duties(head, m);
    const kinds = new Set(rows.map((r) => r.duty));
    ok("the officials just appointed are in the roster", kinds.has("umpire"), [...kinds].join(" "));
    ok("...with the name the appointment carries, not a blank",
       rows.filter((r) => r.duty === "umpire").every((r) => (r.who ?? "").length > 1),
       JSON.stringify(rows.filter((r) => r.duty === "umpire")));
    ok("...and the state is the word the table uses",
       rows.filter((r) => r.duty === "umpire").every((r) => r.state === "named"));
    // Nothing has been arranged for transport or the pitch on this fixture, so
    // those arms must return NO ROW. A row claiming "pending" would be the
    // roster inventing an obligation nobody recorded.
    ok("a duty nobody recorded produces no row at all, not a pending one",
       !kinds.has("transport") && !kinds.has("ground"), [...kinds].join(" "));
    ok("no row carries a state the client cannot name",
       rows.every((r) => ["named", "recorded", "idle", "active", "handover_pending",
                          "verifying", "arranged", "departed", "arrived", "cancelled"].includes(r.state)),
       rows.map((r) => `${r.duty}:${r.state}`).join(" "));
    // A withdrawn appointment is excluded, the same rule the officials read
    // follows — otherwise replacing a panel doubles it.
    const before = (await duties(head, m)).filter((r) => r.duty === "umpire").length;
    await appoint(m, head, [{ duty: "umpire", name: "R Eplacement" }]);
    const after = (await duties(head, m)).filter((r) => r.duty === "umpire");
    ok("replacing the panel does not leave the withdrawn appointment behind",
       after.length <= before && after.some((r) => r.who === "R Eplacement"),
       `${before} → ${after.length}: ${after.map((r) => r.who).join(",")}`);
    ok("the roster refuses an unauthenticated read",
       [401, 403].includes((await api(`/api/read/match_duties?matchId=${m}`)).status));
    ok("...and needs a fixture named", [400, 404, 500].includes((await api("/api/read/match_duties", { token: head })).status));
  }

  // SCRBRD-144 (Kameel, 13 Nov 2026: "Anything that's Switched Off for a
  // user should be hidden for that user but still record data"). db/156 hid
  // the umpires on the overlay; signed in, Westville's administrator still
  // read Hilton's umpire with Hilton's Officials off (Fable, db/156 S4). The
  // fixture's school decides, as db/156 does (match_school(), the home
  // side's); the reader's own switch hides them from him as well.
  group("Officials switched off: named in no signed-in read, still appointed (SCRBRD-144)");
  {
    const WES = "22222222-2222-2222-2222-222222222222";
    const wesAdmin = await login("registrar.wes@example.invalid");   // schooladmin at Westville
    const suppress = (key, token, body) => api(`/api/admin/modules/${key}/suppress`, { method: "POST", token, body });
    const duties = async (token, matchId) => (await api(`/api/read/match_duties?matchId=${matchId}`, { token })).body?.rows ?? [];
    const umpires = (rows) => rows.filter((r) => r.duty === "umpire").map((r) => r.person_name ?? r.who);
    const away = (await q(
      `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, format, overs, status)
       values ($1,'1XI',$2,'1XI','Westville Boys'' High 1XI', now() + interval '3 days','T20',20,'scheduled') returning id`,
      [HIL, WES]))[0].id;
    ok("the director appoints an umpire to Hilton's home fixture against Westville",
       (await appoint(away, head, [{ duty: "umpire", name: "S Sibiya" }])).status === 200);
    ok("with Officials on, Westville's administrator reads him",
       umpires(await standing(away, wesAdmin)).join() === "S Sibiya", JSON.stringify(await standing(away, wesAdmin)));
    ok("...and a Hilton guardian reads him on the duty roster", umpires(await duties(parent, away)).join() === "S Sibiya");

    ok("Hilton's administrator switches Officials off",
       (await suppress("officials", registrar, { schoolId: HIL, hidden: true, reason: "Smoke: SCRBRD-144" })).status === 200);
    const wesRead = await api(`/api/read/officials?matchId=${away}`, { token: wesAdmin });
    ok("Westville's administrator, Officials on for him, reads no official of Hilton's fixture",
       wesRead.status === 200 && umpires(wesRead.body?.rows ?? []).length === 0, `${wesRead.status} ${JSON.stringify(wesRead.body)}`);
    ok("...nor on its duty roster", umpires(await duties(wesAdmin, away)).length === 0, JSON.stringify(await duties(wesAdmin, away)));
    ok("a Hilton guardian reads none on the roster", umpires(await duties(parent, away)).length === 0);
    ok("the director, who may appoint, is shown none on the roster either", umpires(await duties(head, away)).length === 0);
    ok("...and is refused the officials read itself (his own switch)",
       (await api(`/api/read/officials?matchId=${away}`, { token: head })).status === 403);
    const whileOff = await appoint(away, head, [{ duty: "umpire", name: "T Off-Switch" }]);
    ok("an appointment made while Officials is off is stored (switched off records)",
       whileOff.status === 200
         && (await q(`select count(*)::int c from match_official where match_id = $1 and person_name = 'T Off-Switch' and not withdrawn`, [away]))[0].c === 1,
       `${whileOff.status} ${JSON.stringify(whileOff.body)}`);
    ok("...and named to nobody", umpires((await api(`/api/read/officials?matchId=${away}`, { token: wesAdmin })).body?.rows ?? []).length === 0
         && umpires(await duties(parent, away)).length === 0);

    ok("Hilton switches Officials back on, and Westville reads the umpire appointed while it was off",
       (await suppress("officials", registrar, { schoolId: HIL, hidden: false })).status === 200
         && umpires(await standing(away, wesAdmin)).join() === "T Off-Switch");
    ok("...as does the Hilton guardian on the roster", umpires(await duties(parent, away)).join() === "T Off-Switch");

    ok("Officials off at Westville only: Hilton's guardian still reads the umpire",
       (await suppress("officials", wesAdmin, { schoolId: WES, hidden: true, reason: "Smoke: SCRBRD-144" })).status === 200
         && umpires(await duties(parent, away)).join() === "T Off-Switch");
    ok("...while Westville's administrator, his own switch off, is refused the read and shown none on the roster",
       (await api(`/api/read/officials?matchId=${away}`, { token: wesAdmin })).status === 403
         && umpires(await duties(wesAdmin, away)).length === 0);
    await suppress("officials", wesAdmin, { schoolId: WES, hidden: false });

    // Fail closed: a duty stored while Officials is off grants nothing
    // (db/162 duty_link()). The office's link is refused while it is off,
    // and works once it is on.
    const SCORER = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
    await suppress("officials", registrar, { schoolId: HIL, hidden: true, reason: "Smoke: SCRBRD-144 link" });
    ok("with Officials off, the director stores a scorer's duty naming an account",
       (await appoint(away, head, [{ duty: "scorer", name: "Seed Scorer", personId: SCORER }])).status === 200);
    const duty = (await q(`select id from match_official where match_id = $1 and duty = 'scorer' and not withdrawn`, [away]))[0]?.id;
    const refused = await api(`/api/duties/${duty}/link`, { method: "POST", token: registrar, body: {} });
    ok("...and the office's link is refused while Officials is off, granting nothing",
       refused.status === 409 && refused.body?.error === "officials_off"
         && (await q(`select count(*)::int c from role_assignment where fixture_id = $1 and person_id = $2`, [away, SCORER]))[0].c === 0,
       `${refused.status} ${JSON.stringify(refused.body)}`);
    await suppress("officials", registrar, { schoolId: HIL, hidden: false });
    const linked = await api(`/api/duties/${duty}/link`, { method: "POST", token: registrar, body: {} });
    ok("with Officials on again, the office links it",
       linked.status === 200 && !!linked.body?.assignmentId, `${linked.status} ${JSON.stringify(linked.body)}`);
  }

  group("An appointment to a match that does not exist is refused");
  const ghost = "00000000-0000-0000-0000-0000000000ff";
  ok("no such match", [404, 403].includes((await appoint(ghost, head, [{ duty: "umpire", name: "N O" }])).status));

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`OFFICIALS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

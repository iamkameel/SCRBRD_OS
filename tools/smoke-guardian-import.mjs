#!/usr/bin/env node
/**
 * Parents in bulk: IMPORTS.guardians (PILOT_LOAD.md gap 3), over HTTP.
 *
 * Kameel's decision, 3 October 2026: the office vouches for every
 * parent–child link in the file, exactly as it vouches for one typed on
 * Settings → People. So each row is enrol_person() under the importer's own
 * identity, and this walk holds the import to the one-at-a-time path:
 *
 *   1. a dry run says what would happen and writes nothing
 *   2. a commit links each parent verified by the office, consent pending,
 *      and the parent reads her children back; one email covers two boys
 *   3. every refusal on its own line: a boy not found or not told apart, an
 *      adult, a guardian with no name, the same line twice, one email under
 *      two names, an email that is another person's account or a pupil's,
 *      another school's account, a relationship enrolment cannot record —
 *      and a file with any of them commits nothing, even when asked
 *   4. nothing grants more than guardian, whatever columns the file carries
 *   5. a boy under a never-public mark is linked as POST /api/users links him
 *   6. who may: the office of that school; a coach and another school's
 *      office are refused the file
 *   7. sending the file again changes nothing
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-guardian-import.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8916);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const HEAD = "player_full_name,guardian_name,guardian_email,relationship";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-guardian-import-secret" },
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
  method: "POST", body: { email, deviceId: "device-guardian-import" } })).body?.token;
const importGuardians = (token, csv, extra = {}) =>
  api("/api/import/guardians", { method: "POST", token, body: { csv, schoolId: HIL, ...extra } });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
// Everything an import could write, counted: an unchanged count is "wrote nothing".
const footprint = async () => (await q(
  `select (select count(*) from app_user)::int u, (select count(*) from role_request)::int r,
          (select count(*) from role_assignment)::int a, (select count(*) from assignment_subject)::int s`))[0];
const same = (a, b) => a.u === b.u && a.r === b.r && a.a === b.a && a.s === b.s;
const errAt = (report, line) => (report?.errors ?? []).filter((e) => e.line === line);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Invented boys, at Hilton unless said otherwise.
  const boy = async (name, born, school = HIL) => (await q(
    `insert into player (school_id, full_name, born) values ($1, $2, ${born}) returning id`, [school, name]))[0].id;
  const ALPHA  = await boy("Fake Pupil Alpha", "current_date - interval '13 years'");
  const BETA   = await boy("Fake Pupil Beta", "current_date - interval '12 years'");
  await boy("Fake Pupil Twin", "current_date - interval '14 years'");
  await boy("Fake Pupil Twin", "current_date - interval '14 years 2 months'");
  await boy("Fake Pupil Grown", "current_date - interval '19 years'");
  const MARKED = await boy("Fake Pupil Marked", "current_date - interval '15 years'");
  await boy("Fake Pupil West", "current_date - interval '13 years'", WES);

  const office   = await login("registrar@example.invalid");      // schooladmin, Hilton
  const coach    = await login("coach@example.invalid");          // 1XI coach, no user.role.assign
  const wesOffice = await login("registrar.wes@example.invalid"); // schooladmin, Westville
  const OFFICE = (await q(`select id from app_user where email = 'registrar@example.invalid'`))[0].id;
  // The never-public mark, set as the table's owner (no route sets it yet, gap 5).
  await q(`insert into player_never_public (player_id, reason, set_on, set_by)
           values ($1, 'smoke: a court order', current_date, $2)`, [MARKED, OFFICE]);

  const clean = [HEAD,
    "Fake Pupil Alpha,Fake Parent One,fake.parent.one@example.invalid,parent",
    "Fake Pupil Beta,Fake Parent One,fake.parent.one@example.invalid,Parent",
    "fake pupil alpha,Fake Parent Two,fake.parent.two@example.invalid,parent",
  ].join("\n");

  group("1. A dry run says what would happen, and writes nothing");
  {
    const before = await footprint();
    const dry = await importGuardians(office, clean);
    ok("the office's dry run answers 200", dry.status === 200);
    ok("...clean, three links it would make", dry.body?.clean === true && dry.body?.wouldInsert === 3);
    ok("...and not committed", dry.body?.committed === false);
    ok("...and not one account, request, role or link was written", same(before, await footprint()));
  }

  group("2. A commit links each parent: verified by the office, consent pending");
  {
    const done = await importGuardians(office, clean, { commit: true });
    ok("the commit answers committed, three inserted", done.body?.committed === true && done.body?.inserted === 3);
    const one = (await q(`select id, school_id, name from app_user where email = 'fake.parent.one@example.invalid'`));
    ok("one email, one account, for two boys", one.length === 1 && one[0].school_id === HIL);
    const links = await q(
      `select s.player_id, s.relationship, s.verification_state, s.verified_by, s.consent_state,
              s.created_by, a.role, a.school_id
         from assignment_subject s join role_assignment a on a.id = s.assignment_id
        where a.person_id = $1`, [one[0].id]);
    ok("...linked to Alpha and to Beta",
       links.length === 2 && links.some((l) => l.player_id === ALPHA) && links.some((l) => l.player_id === BETA));
    ok("...each verified by the office that imported it",
       links.every((l) => l.verification_state === "verified" && l.verified_by === OFFICE && l.created_by === OFFICE));
    ok("...each with the family's consent still pending", links.every((l) => l.consent_state === "pending"));
    ok("...each a parent link, at this school", links.every((l) => l.relationship === "parent" && l.school_id === HIL));
    const reqs = await q(`select state, decided_by, note from role_request where person_id = $1`, [one[0].id]);
    ok("...and the record says who decided each: the office, by import",
       reqs.length === 2 && reqs.every((r) => r.state === "granted" && r.decided_by === OFFICE && r.note === "guardians import"));

    const parent = await login("fake.parent.one@example.invalid");
    const mine = (await api("/api/read/my_children", { token: parent })).body?.rows ?? [];
    ok("the parent signs in and reads both her boys back",
       mine.length === 2 && [ALPHA, BETA].every((id) => mine.some((m) => m.player_id === id)));
    ok("...verified, with consent pending, as she sees it",
       mine.every((m) => m.verification_state === "verified" && m.consent_state === "pending"));
  }

  group("3. Every refusal is on its own line, and a file with one commits nothing");
  {
    const messy = [HEAD,
      /* 2 */ "Fake Pupil Nobody,Fake Parent Three,fake.parent.three@example.invalid,parent",
      /* 3 */ "Fake Pupil Twin,Fake Parent Four,fake.parent.four@example.invalid,parent",
      /* 4 */ "Fake Pupil Grown,Fake Parent Five,fake.parent.five@example.invalid,parent",
      /* 5 */ "Fake Pupil Alpha,,fake.parent.six@example.invalid,parent",
      /* 6 */ "Fake Pupil Beta,Fake Parent Seven,fake.parent.seven@example.invalid,parent",
      /* 7 */ "Fake Pupil Beta,Fake Parent Seven,fake.parent.seven@example.invalid,parent",
      /* 8 */ "Fake Pupil Alpha,Fake Parent Eight,fake.parent.seven@example.invalid,parent",
      /* 9 */ "Fake Pupil Alpha,Fake Parent Wrong,coach@example.invalid,parent",
      /* 10 */ "Fake Pupil Alpha,R Pillay,pillay@example.invalid,parent",
      /* 11 */ "Fake Pupil Alpha,T Ndlovu,registrar.wes@example.invalid,parent",
      /* 12 */ "Fake Pupil Alpha,Fake Parent Nine,fake.parent.nine@example.invalid,grandparent",
      /* 13 */ "Fake Pupil West,Fake Parent Ten,fake.parent.ten@example.invalid,parent",
      /* 14 */ "Fake Pupil Alpha,Fake Parent Eleven,fake.parent.eleven@example.invalid,self",
      /* 15 */ "Fake Pupil Alpha,Fake Parent Twelve,not-an-email,parent",
    ].join("\n");
    const before = await footprint();
    const r = (await importGuardians(office, messy, { commit: true })).body;
    ok("asked to commit, it does not", r?.committed === false && r?.clean === false);
    ok("...and nothing at all was written", same(before, await footprint()));
    const says = (line, column, re) => errAt(r, line).some((e) => e.column === column && re.test(e.message));
    ok("line 2: a boy not at this school is an error, never a guess", says(2, "player_full_name", /no player at this school/));
    ok("line 3: two boys of one name are refused, not told apart by guessing", says(3, "player_full_name", /more than one player/));
    ok("line 4: an adult is refused as enrolment refuses him", says(4, "player_full_name", /eighteen/));
    ok("line 5: a guardian with no name", says(5, "guardian_name", /required/));
    ok("line 6: a good line is not an error", errAt(r, 6).length === 0);
    ok("line 7: the same guardian and child twice", errAt(r, 7).some((e) => /line 6/.test(e.message)));
    ok("line 8: one email under a second name", says(8, "guardian_email", /one email is one person/));
    ok("line 9: an email that is already another person's account", says(9, "guardian_email", /already C Hendricks's account/));
    ok("line 10: a pupil's own account is never a guardian", says(10, "guardian_email", /pupil's own account/));
    ok("line 11: another school's account, refused by enrolment", says(11, "guardian_email", /another school/));
    ok("line 12: a relationship enrolment cannot record is refused, not recorded as parent",
       says(12, "relationship", /parent link only/));
    ok("line 13: another school's boy is not found here", says(13, "player_full_name", /no player at this school/));
    ok("line 14: 'self' is not a guardian's relationship", says(14, "relationship", /must be one of/));
    ok("line 15: an email that is not one", says(15, "guardian_email", /email/));
    ok("the would-be count is the one good line", r?.wouldInsert === 1);
  }

  group("4. Nothing grants more than guardian");
  {
    const sneaky = ["player_full_name,guardian_name,guardian_email,relationship,role,team_code",
      "Fake Pupil Beta,Fake Parent Thirteen,fake.parent.thirteen@example.invalid,parent,schooladmin,1XI"].join("\n");
    const r = (await importGuardians(office, sneaky, { commit: true })).body;
    ok("a role column is reported as not read", r?.committed === true && r?.unknownColumns?.includes("role"));
    const roles = await q(
      `select a.role, a.team_code from role_assignment a join app_user u on u.id = a.person_id
        where u.email = 'fake.parent.thirteen@example.invalid'`);
    ok("...and the person holds guardian, and only guardian", roles.length === 1 && roles[0].role === "guardian" && roles[0].team_code == null);
    const all = await q(
      `select distinct a.role from role_assignment a join role_request r on r.assignment_id = a.id
        where r.note = 'guardians import'`);
    ok("every role the import ever granted is guardian", all.length === 1 && all[0].role === "guardian");
  }

  group("5. A boy under a never-public mark is linked as POST /api/users links him");
  {
    const one = await api("/api/users", { method: "POST", token: office, body: {
      email: "fake.parent.fourteen@example.invalid", name: "Fake Parent Fourteen", role: "guardian",
      schoolId: HIL, playerId: MARKED } });
    const r = (await importGuardians(office,
      [HEAD, "Fake Pupil Marked,Fake Parent Fifteen,fake.parent.fifteen@example.invalid,parent"].join("\n"),
      { commit: true })).body;
    ok("one at a time, the office links him", one.status === 200);
    ok("...and the import does the same", r?.committed === true && r?.inserted === 1);
    const links = await q(
      `select u.email, s.verification_state, s.consent_state, s.relationship, s.valid_until
         from assignment_subject s join role_assignment a on a.id = s.assignment_id
         join app_user u on u.id = a.person_id where s.player_id = $1 order by u.email`, [MARKED]);
    ok("...two links, written alike", links.length === 2 &&
       ["verification_state", "consent_state", "relationship", "valid_until"].every((k) => String(links[0][k]) === String(links[1][k])));
  }

  group("6. Who may: the office of that school, and nobody else");
  {
    const before = await footprint();
    const byCoach = await importGuardians(coach, clean);
    ok("a coach is refused the file (403), even a dry run", byCoach.status === 403 && byCoach.body?.error === "not_permitted");
    const byWes = await importGuardians(wesOffice, clean, { commit: true });
    ok("another school's office is refused this school's file (403)", byWes.status === 403);
    ok("unauthenticated is refused", [401, 403].includes((await importGuardians(undefined, clean)).status));
    ok("...and none of them wrote anything", same(before, await footprint()));
    const own = await api("/api/import/guardians", { method: "POST", token: wesOffice, body: {
      csv: [HEAD, "Fake Pupil West,Fake Parent Ten,fake.parent.ten@example.invalid,parent"].join("\n"), schoolId: WES } });
    ok("...while Westville's office may dry-run its own", own.status === 200 && own.body?.clean === true);
  }

  group("7. Sending the file again changes nothing");
  {
    const before = await footprint();
    const again = (await importGuardians(office, clean, { commit: true })).body;
    ok("committed, nothing inserted, three unchanged",
       again?.committed === true && again?.inserted === 0 && again?.unchanged === 3);
    ok("...and no second link, account or request", same(before, await footprint()));
  }

  group("The template the route serves is the file the importer reads");
  {
    const t = await fetch(`${BASE}/api/import/guardians/template`);
    const text = (await t.text()).replace(/^﻿/, "");
    ok("its header", t.status === 200 && text.split(/\r?\n/)[0] === HEAD);
  }
} catch (e) {
  fail++;
  console.log("  ✗ walk threw:", e?.stack || e);
} finally {
  server.kill();
  await pool.end();
}

if (fail && serverErr.length) console.log(serverErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nGUARDIAN IMPORT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

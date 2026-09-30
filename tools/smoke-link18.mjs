#!/usr/bin/env node
/**
 * SCRBRD-110 phase 0 over HTTP and real commits: the guardian link past
 * eighteen (db/62), and SCRBRD-083 §6.3's option C on top of it.
 *
 * db/99 section 40 proves the database inside one rolled-back transaction,
 * firing db/62's deferred triggers by hand. This walks the same life as the
 * application lives it — every statement its own committed transaction, the
 * links made and the sides changed through the routes a screen uses — and
 * asks what only that can answer:
 *
 *   1. THE LINK. The office links a parent to a pupil of seventeen and to a
 *      club member of seventeen: the pupil's is open, the club member's ends
 *      on his birthday. A parent cannot be linked to a pupil of eighteen.
 *   2. HIS BIRTHDAY. Time passes (his history is wound back, as the owner):
 *      the pupil's mother still reads him and her health "yes" still counts;
 *      the club member's reads nothing. Her health "yes" after it is refused
 *      and her "no" is taken.
 *   3. A MOVE. Ten days past his birthday the pupil is moved from the 1st
 *      XI to the 2nd XI through the move route — a close and an open in one
 *      committed transaction — and his mother keeps him.
 *   4. THE PUBLIC NAME (option C). His father's pre-18 yes names him; his
 *      mother's yes after eighteen is refused, her no is taken and — through
 *      publicName() itself — beats his father's yes; his own yes then names
 *      him over hers.
 *   5. LEAVING. A minor who leaves keeps his parent until his birthday and
 *      has her back when he returns; the adult pupil who leaves takes her
 *      access, and the health consent through it, with him that day.
 *   6. db/10 IS UNCHANGED: its hash is the one db/SHIPPED.sha256 records and
 *      the one this database's ledger ran.
 *
 * Leaves the database as it found it.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-link18.mjs
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { publicName } from "../packages/policy/src/public.mjs";

const PORT = port(8898);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const CLUB = "62626262-0000-0000-0000-00000000c1ab";
const P = {       // the boys
  pupil: "62626262-0000-0000-0000-000000000001",   // 17, Hilton 1XI
  minor: "62626262-0000-0000-0000-000000000002",   // 16, Hilton 1XI
  club:  "62626262-0000-0000-0000-000000000003",   // 17, a club
  grown: "62626262-0000-0000-0000-000000000004",   // 18 and four months, Hilton 1XI
};
const U = {       // the people
  mum:     "62626262-0000-0000-0000-0000000000a1",
  dad:     "62626262-0000-0000-0000-0000000000a2",
  mmum:    "62626262-0000-0000-0000-0000000000a3",
  cmum:    "62626262-0000-0000-0000-0000000000a4",
  gmum:    "62626262-0000-0000-0000-0000000000a5",
  coffice: "62626262-0000-0000-0000-0000000000a6",
  self:    "62626262-0000-0000-0000-0000000000a7",
};
const HEALTH = "health-monitoring-2026-09";
const NAME = "public-name-2026-09";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-link18-secret" },
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
  method: "POST", body: { email, deviceId: "device-link18" } })).body?.token;

const owner = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const q = async (t, p) => (await owner.query(t, p)).rows;
/** A statement AS a person, through the application role (a door with no route yet). */
async function as(uid, text, params) {
  const c = await app.connect();
  try {
    await c.query("select set_config('app.user_id', $1, false)", [uid]);
    return (await c.query(text, params)).rows;
  } finally {
    await c.query("select set_config('app.user_id', '', false)").catch(() => {});
    c.release();
  }
}
const link = async (player, person) => (await q(
  `select s.valid_until::text as until, s.valid_until is null as open, majority_on(p.born)::text as majority
     from assignment_subject s join role_assignment a on a.id = s.assignment_id and a.role = 'guardian'
     join player p on p.id = s.player_id
    where s.player_id = $1 and a.person_id = $2 order by s.created_at desc limit 1`, [player, person]))[0];
const reads = async (token, player) =>
  ((await api("/api/read/players", { token })).body?.rows ?? []).some((r) => r.id === player);
const healthLive = async (player) => (await q(`select health_consent_live($1) as live`, [player]))[0].live;
const today = async () => (await q(`select current_date::text as d, sa_today()::text as sa`))[0];
// Everything about him happened d days sooner: his birthday, his parents'
// links, both consents, his memberships' start (db/99's _v62_older()).
const older = async (player, days) => {
  await q(`update player set born = born - $2::int where id = $1`, [player, days]);
  await q(`update assignment_subject set valid_from = valid_from - $2::int, valid_until = valid_until - $2::int,
             verified_at = verified_at - make_interval(days => $2::int), consent_at = consent_at - make_interval(days => $2::int)
            where player_id = $1 and relationship is distinct from 'self'`, [player, days]);
  for (const t of ["health_monitoring_consent", "public_name_consent"]) {
    await q(`update ${t} set given_on = given_on - $2::int, ended_on = ended_on - $2::int, form_date = form_date - $2::int,
               recorded_at = recorded_at - make_interval(days => $2::int), ended_at = ended_at - make_interval(days => $2::int)
              where player_id = $1`, [player, days]);
  }
  await q(`update team_membership set joined_on = joined_on - $2::int where player_id = $1`, [player, days]);
};
const turnEighteen = async (player) =>
  older(player, (await q(`select majority_on(born) - current_date as d from player where id = $1`, [player]))[0].d);
const cleanup = async () => {
  const boys = Object.values(P), people = Object.values(U);
  await q(`delete from health_monitoring_consent where player_id = any($1)`, [boys]);
  await q(`delete from public_name_consent where player_id = any($1)`, [boys]);
  await q(`delete from access_log where person_id = any($1)`, [people]).catch(() => {});
  await q(`delete from assignment_subject where player_id = any($1)`, [boys]);
  await q(`delete from role_assignment where person_id = any($1)`, [people]);
  await q(`delete from team_membership where player_id = any($1)`, [boys]);
  await q(`delete from player where id = any($1)`, [boys]);
  await q(`delete from app_user where id = any($1)`, [people]);
  await q(`delete from school where id = $1`, [CLUB]);
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await cleanup();
  await q(`insert into school (id, code, name, kind, province) values ($1, 'L18C', 'Link Eighteen Cricket Club', 'club', 'KwaZulu-Natal')`, [CLUB]);
  await q(`insert into player (id, school_id, team_code, full_name, surname, squad_no, playing_role, born) values
             ($1, $5, '1XI', 'Pieter Linkeighteen', 'Linkeighteen', 181, 'batter', (current_date - interval '17 years 40 days')::date),
             ($2, $5, '1XI', 'Mike Linkminor',      'Linkminor',     182, 'batter', (current_date - interval '16 years 40 days')::date),
             ($3, $6, '1XI', 'Craig Linkclub',      'Linkclub',      183, 'batter', (current_date - interval '17 years 40 days')::date),
             ($4, $5, '1XI', 'Gary Linkgrown',      'Linkgrown',     184, 'batter', (current_date - interval '18 years 120 days')::date)`,
          [P.pupil, P.minor, P.club, P.grown, HIL, CLUB]);
  await q(`insert into app_user (id, school_id, email, name, role) values
             ($1, $8, 'link18.mum@example.invalid',     'L18 Mum',        'guardian'),
             ($2, $8, 'link18.dad@example.invalid',     'L18 Dad',        'guardian'),
             ($3, $8, 'link18.mmum@example.invalid',    'L18 Minor Mum',  'guardian'),
             ($4, $9, 'link18.cmum@example.invalid',    'L18 Club Mum',   'guardian'),
             ($5, $8, 'link18.gmum@example.invalid',    'L18 Grown Mum',  'guardian'),
             ($6, $9, 'link18.coffice@example.invalid', 'L18 Club Office','schooladmin'),
             ($7, $8, 'link18.self@example.invalid',    'Pieter Linkeighteen', 'player')`,
          [U.mum, U.dad, U.mmum, U.cmum, U.gmum, U.coffice, U.self, HIL, CLUB]);
  await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'schooladmin', $2)`, [U.coffice, CLUB]);
  const [{ id: selfAsg }] = await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'selfaccess', $2) returning id`, [U.self, HIL]);
  const REGISTRAR = "88888888-0000-0000-0000-00000000000c";
  await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                           consent_state, consent_version, consent_at, valid_from)
           values ($1, $2, 'self', 'verified', $3, now(), 'granted', 'popia-2026-01', now(), current_date - 30)`, [selfAsg, P.pupil, REGISTRAR]);

  const reg = await login("registrar@example.invalid");
  const coff = await login("link18.coffice@example.invalid");
  const mum = await login("link18.mum@example.invalid");
  const dad = await login("link18.dad@example.invalid");
  const mmum = await login("link18.mmum@example.invalid");
  const cmum = await login("link18.cmum@example.invalid");
  const self = await login("link18.self@example.invalid");
  ok("the offices, the parents and the boy sign in", reg && coff && mum && dad && mmum && cmum && self);

  // ── 1. The link ────────────────────────────────────────────────
  group("1. A pupil's link is open; a club member's ends on his birthday; none for an adult");
  const establish = async (token, player, guardianId) => {
    const e = await api(`/api/players/${player}/guardians`, { method: "POST", token, body: { guardianId, relationship: "parent" } });
    const v = await api(`/api/players/${player}/guardians/verify`, { method: "POST", token, body: { guardianId, consentVersion: "popia-2026-01" } });
    return e.status === 200 && e.body?.ok === true && v.body?.ok === true;
  };
  ok("Hilton's office links and verifies three parents over HTTP",
     await establish(reg, P.pupil, U.mum) && await establish(reg, P.pupil, U.dad) && await establish(reg, P.minor, U.mmum));
  ok("the club's office links and verifies one", await establish(coff, P.club, U.cmum));
  const lp = await link(P.pupil, U.mum), lc = await link(P.club, U.cmum);
  ok("the pupil's link is open while he is at school", lp?.open === true, JSON.stringify(lp));
  ok("the club member's ends on his eighteenth birthday, as before", lc?.until === lc?.majority, JSON.stringify(lc));
  const grown = await api(`/api/players/${P.grown}/guardians`, { method: "POST", token: reg, body: { guardianId: U.gmum, relationship: "parent" } });
  ok("a parent cannot be linked to a pupil of eighteen, at school or not",
     grown.status === 422 && grown.body?.error === "player_is_an_adult", JSON.stringify(grown.body));
  ok("...and the refusal leaves no assignment behind",
     (await q(`select count(*)::int n from role_assignment where person_id = $1`, [U.gmum]))[0].n === 0);

  // Before eighteen: his mother says yes to health monitoring, his father to
  // his name on public pages.
  const hyes = await api(`/api/players/${P.pupil}/consents/health`, { method: "POST", token: mum, body: { yes: true, version: HEALTH } });
  ok("his mother says yes to health monitoring at seventeen", hyes.status === 200 && await healthLive(P.pupil), JSON.stringify(hyes.body));
  const [dyes] = await as(U.dad, `select * from public_name_consent_set($1, true, $2)`, [P.pupil, NAME]);
  ok("his father says yes to his name on public pages at seventeen", dyes?.ok === true, JSON.stringify(dyes));

  // ── 2. His birthday ────────────────────────────────────────────
  group("2. His eighteenth birthday, at school and at a club");
  await turnEighteen(P.pupil);
  await turnEighteen(P.club);
  ok("his mother still reads him on his eighteenth birthday", await reads(mum, P.pupil));
  ok("...through a link that is still open", (await link(P.pupil, U.mum))?.open === true);
  ok("...and her pre-18 health yes still counts", await healthLive(P.pupil));
  const consentsRow = (await api("/api/read/consents", { token: mum })).body?.rows?.find((r) => r.player_id === P.pupil);
  ok("...on her consents screen too: given, live, hers to stop and not to give",
     consentsRow?.state === "given" && consentsRow?.live === true && consentsRow?.can_say_no === true && consentsRow?.can_say_yes === false,
     JSON.stringify(consentsRow));
  ok("the club member's mother reads nothing of him on his birthday", !(await reads(cmum, P.club)));
  const hyes2 = await api(`/api/players/${P.pupil}/consents/health`, { method: "POST", token: mum, body: { yes: true, version: HEALTH + "-b" } });
  ok("her health yes after eighteen is refused, for the reason",
     hyes2.status === 422 && hyes2.body?.error === "adult_consents_for_himself", JSON.stringify(hyes2.body));

  // ── 3. A move ──────────────────────────────────────────────────
  group("3. Moved between sides as an adult, he keeps his parent");
  // Ten days past his birthday, so a link ended on the moving day could not
  // pass for one that ended on his birthday and be re-opened.
  await older(P.pupil, 10);
  const moved = await api(`/api/players/${P.pupil}/team`, { method: "POST", token: reg, body: { teamCode: "2XI" } });
  ok("the office moves him from the 1st XI to the 2nd XI", moved.status === 200 && moved.body?.teamCode === "2XI", JSON.stringify(moved.body));
  ok("...and his mother's link is still open after the commit", (await link(P.pupil, U.mum))?.open === true,
     JSON.stringify(await link(P.pupil, U.mum)));
  ok("...and she still reads him", await reads(mum, P.pupil));

  // ── 4. The public name, option C ───────────────────────────────
  group("4. After eighteen a parent may take his name off, never put it on");
  const { sa: on } = await today();
  const facts = async () => ({
    ...(await q(`select public_name_facts($1) as f`, [P.pupil]))[0].f,
    on, fullName: "Pieter Linkeighteen", surname: "Linkeighteen", typed: false, schoolOnPlatform: true, schoolPublished: true,
  });
  ok("his father's standing pre-18 yes names him", publicName(await facts()) === "P Linkeighteen", publicName(await facts()));
  const [myes] = await as(U.mum, `select * from public_name_consent_set($1, true, $2)`, [P.pupil, NAME]);
  ok("his mother's yes after eighteen is refused", myes?.ok === false && myes?.reason === "adult_consents_for_himself", JSON.stringify(myes));
  const [mno] = await as(U.mum, `select * from public_name_consent_set($1, false, $2)`, [P.pupil, NAME]);
  ok("his mother's no after eighteen, while he is at school, is taken", mno?.ok === true, JSON.stringify(mno));
  const afterNo = await facts();
  ok("...and beats his father's yes: publicName() gives a position, not a name",
     publicName(afterNo) === "Player", `${publicName(afterNo)} ${JSON.stringify(afterNo.consents)}`);
  const [hisYes] = await as(U.self, `select * from public_name_consent_set($1, true, $2)`, [P.pupil, NAME]);
  ok("his own yes at eighteen names him over her no", hisYes?.ok === true && publicName(await facts()) === "P Linkeighteen",
     `${JSON.stringify(hisYes)} ${publicName(await facts())}`);
  const [laterNo] = await as(U.mum, `select * from public_name_consent_set($1, false, $2)`, [P.pupil, NAME]);
  ok("...and her later no does not undo his yes", laterNo?.ok === true && publicName(await facts()) === "P Linkeighteen",
     `${JSON.stringify(laterNo)} ${publicName(await facts())}`);

  // ── 5. Leaving ─────────────────────────────────────────────────
  group("5. Leaving: a minor keeps his parent to his birthday; an adult takes her access with him");
  // There is no route for leaving the school system (the move route always
  // names a side): the roster's team_code cleared, as the owner, one commit.
  await q(`update player set team_code = null where id = $1`, [P.minor]);
  const lm = await link(P.minor, U.mmum);
  ok("a minor who leaves keeps his parent until his birthday", lm?.until === lm?.majority, JSON.stringify(lm));
  ok("...and she still reads him", await reads(mmum, P.minor));
  const back = await api(`/api/players/${P.minor}/team`, { method: "POST", token: reg, body: { teamCode: "1XI" } });
  ok("he is put back in a side, and his link is open again", back.status === 200 && (await link(P.minor, U.mmum))?.open === true,
     JSON.stringify(await link(P.minor, U.mmum)));
  await q(`update player set team_code = null where id = $1`, [P.pupil]);
  const la = await link(P.pupil, U.mum);
  const { d } = await today();
  ok("the adult pupil who leaves: his mother's link ends that day", la?.until === d, JSON.stringify(la));
  ok("...she reads nothing of him", !(await reads(mum, P.pupil)));
  ok("...and her health consent, which ran through it, is dead", !(await healthLive(P.pupil)));
  const [gone] = await as(U.mum, `select * from public_name_consent_set($1, false, $2)`, [P.pupil, NAME]);
  ok("...and his public name is no longer hers to answer for", gone?.ok === false && gone?.reason === "not_permitted", JSON.stringify(gone));
  const rejoin = await api(`/api/players/${P.pupil}/team`, { method: "POST", token: reg, body: { teamCode: "1XI" } });
  ok("coming back does not bring an adult's ended link back", rejoin.status === 200 && (await link(P.pupil, U.mum))?.until === d,
     JSON.stringify(await link(P.pupil, U.mum)));

  // ── 6. db/10 ───────────────────────────────────────────────────
  group("6. db/10 is unchanged");
  const hash = createHash("sha256").update(readFileSync("db/10_guardian_majority.sql")).digest("hex");
  const shipped = readFileSync("db/SHIPPED.sha256", "utf8").split("\n").find((l) => l.endsWith("db/10_guardian_majority.sql"));
  const ledger = (await q(`select sha256 from schema_migration where name = '10_guardian_majority.sql'`))[0]?.sha256;
  ok("its hash is the one db/SHIPPED.sha256 records and this database's ledger ran",
     shipped?.startsWith(hash) && ledger === hash, `${hash} ${shipped} ${ledger}`);
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.message);
} finally {
  await cleanup().catch((e) => console.log("  (cleanup:", e.message + ")"));
  server.kill();
  await owner.end();
  await app.end();
}
if (fail && serverErr.length) console.log(serverErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nLINK PAST EIGHTEEN SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

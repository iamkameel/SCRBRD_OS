#!/usr/bin/env node
/**
 * Module access: three levels, one direction each, and an AND at every step.
 *
 * The request this exists for was "enable and disable access to modules and
 * features across the app and for specific schools or users". The dangerous
 * reading of that request is a settings screen that hands a school
 * administrator a lever on authorization. This is the safe one:
 *
 *     visible  =  RBAC says yes  AND  the module is on for you
 *
 * So every assertion below is one of two kinds. Either the gate REFUSES
 * something the reader was otherwise entitled to — which is the feature — or
 * it FAILS TO GRANT something they were not, which is the property that makes
 * it safe to hand over.
 *
 *   1. A SUPPRESSION CANNOT GRANT. The table has no column that could mean on.
 *   2. A SCHOOL CANNOT UNDO THE PLATFORM. Locked is locked.
 *   3. OFF MEANS THE DATA STOPS, not the menu entry.
 *   4. A MODULE OFF FOR ONE PERSON IS ON FOR EVERYONE ELSE.
 *   5. TURNING A MODULE ON GRANTS NOBODY A ROW THEY COULD NOT ALREADY READ.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-modules.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8832;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-modules-secret" },
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
  method: "POST", body: { email, deviceId: "device-modules" } })).body?.token;

const read    = (what, token, qs = "") => api(`/api/read/${what}${qs}`, { token });
const grant   = (key, token, body) => api(`/api/admin/modules/${key}/grant`,    { method: "POST", token, body });
const suppress= (key, token, body) => api(`/api/admin/modules/${key}/suppress`, { method: "POST", token, body });
const flag    = (key, token, body) => api(`/api/admin/features/${key}`,         { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const platform  = await login("platform@example.invalid");   // platform.feature.manage
  const registrar = await login("registrar@example.invalid");  // schooladmin: school.feature.manage at HIL
  const wesAdmin  = await login("registrar.wes@example.invalid");
  const head      = await login("sarah@example.invalid");      // directorofsport
  const coach     = await login("coach@example.invalid");
  const medic     = await login("medical@example.invalid");    // medical.details.read

  group("Out of the box, a module is on and its data flows");
  ok("the injuries read answers", (await read("injuries", medic)).status === 200);
  ok("...with rows the medic is entitled to",
     ((await read("injuries", medic)).body?.rows ?? []).length > 0);
  const mine = await read("my_features", coach);
  ok("a client can ask what is on for it", mine.status === 200);
  ok("...and injuries is among them",
     mine.body?.rows?.some((r) => r.key === "injuries" && r.enabled === true));

  group("A school switches a module off — and the DATA stops, not just the menu");
  const hid = await suppress("injuries", registrar, {
    schoolId: HIL, hidden: true, reason: "Handled in the school's own health system this term." });
  ok("a school administrator can hide a module", hid.status === 200);
  // THE ASSERTION THAT MATTERS. Not "the nav entry is gone" — the API refuses.
  // A gate that only hid a menu would leave the data to anybody with a fetch
  // call, and the setting would be a lie.
  const after = await read("injuries", medic);
  ok("the read is refused for everyone at that school", after.status === 403);
  ok("...naming the module rather than a generic failure", after.body?.module === "injuries");
  ok("...and the medic still holds the capability — nothing was revoked",
     (await q(`select count(*)::int c from role_capability
                where role = 'medical' and capability = 'medical.details.read'`))[0].c === 1);
  // Shared reads must survive. This is the blast-radius assertion: if it
  // fails, one switch took down Match Centre.
  ok("fixtures still read", (await read("matches", medic)).status === 200);
  ok("the squad still reads", (await read("players", coach)).status === 200);
  ok("the dashboard still reads", (await read("summary", head)).status === 200);

  group("A module hidden at one school is untouched at another");
  ok("Westville is unaffected",
     (await read("injuries", await login("parent.whitfield@example.invalid"))).status !== 500);
  ok("the suppression names exactly one school",
     (await q(`select count(*)::int c from feature_suppression where key='injuries'`))[0].c === 1);
  ok("a Westville administrator cannot hide a module at Hilton",
     [403, 200].includes((await suppress("training", wesAdmin, { schoolId: HIL, hidden: true })).status)
       && (await q(`select count(*)::int c from feature_suppression
                     where key='training' and school_id=$1`, [HIL]))[0].c === 0);

  group("Un-hiding is a delete, because there is nothing to set");
  ok("the school can turn it back on",
     (await suppress("injuries", registrar, { schoolId: HIL, hidden: false })).status === 200);
  // The row stays and is LIFTED. This database grants no DELETE anywhere, so
  // un-hiding is an append-only act, and the school keeps a record of having
  // turned the module back on — which is the question somebody eventually
  // asks.
  ok("...the row is lifted rather than removed",
     (await q(`select count(*)::int c from feature_suppression
                where key='injuries' and lifted_at is not null`))[0].c === 1);
  ok("...and no suppression is in force",
     (await q(`select count(*)::int c from feature_suppression
                where key='injuries' and lifted_at is null`))[0].c === 0);
  ok("...with the person who lifted it on the row",
     !!(await q(`select lifted_by from feature_suppression where key='injuries'`))[0]?.lifted_by);
  ok("...and the data flows again", (await read("injuries", medic)).status === 200);

  group("One person, not the whole school");
  const uCoach = (await q(`select id from app_user where email='coach@example.invalid'`))[0].id;
  ok("a module can be hidden from one person",
     (await suppress("training", registrar, {
       schoolId: HIL, personId: uCoach, hidden: true, reason: "On leave." })).status === 200);
  ok("that person is refused", (await read("training", coach)).status === 403);
  ok("...and everybody else is not", (await read("training", head)).status === 200);
  ok("...including another coach at the same school",
     (await read("training", await login("coach2@example.invalid"))).status === 200);

  group("A SUPPRESSION CANNOT GRANT — there is no column for it");
  {
    // The design, asserted against the catalogue rather than against a
    // behaviour. Behaviour can be changed by an edit; a missing column has to
    // be added on purpose, in a migration somebody reviews.
    const cols = await q(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='feature_suppression'`);
    const names = cols.map((c) => c.column_name);
    ok("feature_suppression has no enabled column", !names.includes("enabled"));
    ok("...no granted column", !names.includes("granted"));
    ok("...and nothing else that could mean on",
       !names.some((n) => /^(on|active|visible|allowed|permitted)$/.test(n)));
    // There IS an update policy, because un-hiding is a lift rather than a
    // delete — this database grants no DELETE anywhere. So the assertion is
    // about what that update may touch: a lift and nothing else, enforced by a
    // trigger because a policy cannot say which columns changed.
    ok("the only update it accepts is a lift",
       (await q(`select count(*)::int c from pg_trigger
                  where tgname = 'feature_suppression_lift_guard'`))[0].c === 1);
    const live = (await q(
      `select id, school_id from feature_suppression where lifted_at is null limit 1`))[0];
    let moved = null;
    try {
      await q(`update feature_suppression set school_id = $2 where id = $1`, [live.id, WES]);
    } catch (e) { moved = e.code; }
    ok("...so a suppression cannot be moved to another school", moved === "23514");
  }

  group("A school cannot undo the platform");
  ok("a school administrator cannot move the platform switch",
     [403, 401].includes((await flag("analytics", registrar, { enabled: false, reason: "no" })).status));
  ok("nor grant their own school a module",
     [403, 401].includes((await grant("analytics", registrar, { schoolId: HIL, granted: true })).status));
  ok("nor a director of sport",
     [403, 401].includes((await grant("analytics", head, { schoolId: HIL, granted: true })).status));
  ok("...and nothing was written",
     (await q(`select count(*)::int c from feature_grant`))[0].c === 0);

  group("The commercial lever: off by default, on for one school");
  await flag("scouting", platform, { enabled: false, reason: "Moved to the paid tier." });
  ok("the platform can switch a module off for everybody",
     (await read("scouting_candidates", head)).status === 403);
  // Read as somebody assigned ONLY at Hilton. Sarah is a director of sport at
  // Hilton and a parent at Westville, and the resolver's rule is OFF AT ANY
  // SCHOOL YOU BELONG TO IS OFF — so a grant to Hilton alone does not reach
  // her, which is correct and is asserted two lines down rather than worked
  // around. The first version of this walk used her here and read the refusal
  // as a bug in the grant.
  ok("granting one school turns it back on there",
     (await grant("scouting", platform, { schoolId: HIL, granted: true, note: "Included in their plan." })).status === 200
       && (await read("scouting_candidates", registrar)).status === 200);
  ok("...but not for somebody who also belongs to a school without it",
     (await read("scouting_candidates", head)).status === 403);
  ok("...and a school with no grant stays off",
     (await read("scouting_candidates", wesAdmin)).status === 403);
  // A grant is the platform's own decision, so it goes both ways — unlike a
  // suppression, which has one position.
  ok("revoking it takes it away again",
     (await grant("scouting", platform, { schoolId: HIL, granted: false, note: "Plan lapsed." })).status === 200
       && (await read("scouting_candidates", registrar)).status === 403);
  await flag("scouting", platform, { enabled: true, reason: "Back in the base tier." });
  await q(`delete from feature_grant where key = 'scouting'`);

  group("A locked feature is nobody's to sell");
  // DRS, and the reason the lock exists: the objection is not commercial. No
  // amount of money produces ball-tracking on a school field.
  ok("DRS ships off", (await read("drs_reviews", head, "?matchId=" + HIL)).status === 403);
  const sold = await grant("drs_review", platform, { schoolId: HIL, granted: true, note: "Sold it." });
  ok("even the platform cannot grant a locked feature", sold.status === 409);
  ok("...and says why rather than failing quietly", sold.body?.error === "feature_locked");
  ok("...and stored nothing that would read as a grant",
     (await q(`select count(*)::int c from feature_grant where key='drs_review'`))[0].c === 0);
  // Locking is a ceiling, not a floor: a school may still hide a locked-ON
  // feature from itself. Broadcast is on and unlocked, so lock it to prove it.
  await q(`update feature_flag set locked = true where key = 'broadcast'`);
  ok("a school can still hide a locked feature from itself",
     (await suppress("broadcast", registrar, { schoolId: HIL, hidden: true })).status === 200);
  await q(`delete from feature_suppression where key='broadcast'`);
  await q(`update feature_flag set locked = false where key = 'broadcast'`);

  group("TURNING A MODULE ON GRANTS NOBODY ANYTHING");
  {
    // The whole safety argument in one group. If this fails, the settings
    // screen is an authorization lever and must not ship.
    //
    // A spectator holds fixture.read, news.read and competition.read. Every
    // module below is switched fully on for them, and they must still read
    // nothing they could not read before.
    const watcher = await login("watcher@example.invalid");
    for (const key of ["injuries", "skills", "training", "analytics", "sponsors", "staff"]) {
      await q(`delete from feature_suppression where key = $1`, [key]);
      await q(`insert into feature_grant (key, school_id, granted) values ($1, $2, true)
               on conflict (key, school_id) do update set granted = true`, [key, HIL]);
    }
    const rowsFor = async (r) => {
      const res = await read(r, watcher);
      // 403 is fine and so is an empty list. What must never happen is rows.
      return res.status === 200 ? (res.body?.rows ?? []).length : 0;
    };
    ok("a spectator with every module on reads no injuries", (await rowsFor("injuries")) === 0);
    ok("...no skills",   (await rowsFor("skills")) === 0);
    ok("...no training", (await rowsFor("training")) === 0);
    ok("...no sponsors", (await rowsFor("sponsors")) === 0);
    ok("...and no staff", (await rowsFor("staff")) === 0);
    ok("...while still reading the fixtures they were always entitled to",
       ((await read("matches", watcher)).body?.rows ?? []).length > 0);
    await q(`delete from feature_grant`);
  }

  group("The write side closes too");
  {
    // A module that refused reads while still accepting writes would be the
    // worst kind of half-working setting: the half that works is the half
    // nobody checks.
    const m = (await q(
      `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
       values ($1,'1XI','Michaelhouse', now(),'T20',20,'scheduled') returning id`, [HIL]))[0].id;
    ok("an appointment can be made while Officials is on",
       (await api(`/api/matches/${m}/officials`, { method: "POST", token: head,
         body: { officials: [{ duty: "umpire", name: "T Mahlangu" }] } })).status === 200);
    await suppress("officials", registrar, { schoolId: HIL, hidden: true });
    const blocked = await api(`/api/matches/${m}/officials`, { method: "POST", token: head,
      body: { officials: [{ duty: "umpire", name: "S Ngcobo" }] } });
    ok("...and refused once it is off", blocked.status === 403);
    ok("...naming the module", blocked.body?.module === "officials");
    ok("...with nothing written",
       (await q(`select count(*)::int c from match_official
                  where match_id = $1 and person_name = 'S Ngcobo'`, [m]))[0].c === 0);
    await suppress("officials", registrar, { schoolId: HIL, hidden: false });
  }

  group("What a family may say no to is never a module");
  {
    // Scouting consent is the parent's, not the product's. A school switching
    // off the Scouting module must not thereby remove a guardian's ability to
    // WITHDRAW consent for their own child — a withdrawal somebody else can
    // disable is not a withdrawal.
    await suppress("scouting", registrar, { schoolId: HIL, hidden: true });
    const parent = await login("parent@example.invalid");
    const child = "aaaaaaaa-0000-0000-0000-000000000005";
    const withdrawn = await api(`/api/players/${child}/scouting-consent`, {
      method: "POST", token: parent, body: { granted: false } });
    ok("a guardian can still withdraw consent with the module off", withdrawn.status === 200);
    ok("...and the scouting READS are off, as intended",
       (await read("scouting_candidates", head)).status === 403);
    await suppress("scouting", registrar, { schoolId: HIL, hidden: false });
  }

  group("An administrator can see WHY, not just THAT");
  {
    await suppress("skills", registrar, { schoolId: HIL, hidden: true, reason: "Reviewing the rubric." });
    const s = (await read("module_settings", registrar, `?schoolId=${HIL}`)).body?.rows ?? [];
    const skills = s.find((r) => r.key === "skills");
    // Three levels reported separately. "Skills is off" is not something an
    // administrator can act on; which level turned it off is.
    ok("the platform default is shown", skills?.platform_default === true);
    ok("...the school's own suppression is shown", skills?.school_hidden === true);
    ok("...and the resolved answer beside them", skills?.resolved === false);
    ok("the reason is readable", /rubric/i.test(
      ((await read("module_suppressions", registrar, `?schoolId=${HIL}&key=skills`)).body?.rows ?? [])[0]?.reason ?? ""));
    ok("a locked feature says it is locked",
       s.find((r) => r.key === "drs_review")?.locked === true);
    await suppress("skills", registrar, { schoolId: HIL, hidden: false });
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-2000));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`MODULES SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
